"use strict";

const { getFrontierFeatures } = require("./search-cache");
const { getDecisionDepth } = require("./state");
const { evaluateExpression } = require("./expression");
const { getProgress } = require("./progress");
const { getFloorOrder } = require("./score");
const { getCachedChangeFloorScout } = require("./floor-scout");
const { createResourceLookaheadCache, evaluateActionResourceLookahead } = require("./resource-lookahead");

function compareNumbers(left, right) {
  if (left === right) return 0;
  return left > right ? 1 : -1;
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function getNextFloorTargets(project, floorId) {
  const floor = project.floorsById[floorId];
  if (!floor) return [];
  return Object.entries(floor.changeFloor || {})
    .filter(([, changeFloor]) => changeFloor && changeFloor.floorId === ":next")
    .map(([loc, changeFloor]) => {
      const [x, y] = loc.split(",").map(Number);
      return { x, y, changeFloor };
    });
}

function getActionEndpoint(action) {
  if (!action) return null;
  if (action.kind === "battle" || action.kind === "openDoor" || action.kind === "useTool") return action.target || null;
  if (action.kind === "pickup" || action.kind === "changeFloor" || action.kind === "event") return { x: action.x, y: action.y };
  return null;
}

function distanceTo(point, target) {
  if (!point || !target) return Number.POSITIVE_INFINITY;
  return Math.abs(point.x - target.x) + Math.abs(point.y - target.y);
}

function nearestDistance(point, targets) {
  return (targets || []).reduce((best, target) => Math.min(best, distanceTo(point, target)), Number.POSITIVE_INFINITY);
}

function getNextLevelInfo(project, state) {
  const entries = (((project || {}).data || {}).firstData || {}).levelUp || [];
  const level = Number((state.hero || {}).lv || 0);
  const next = entries[level] || null;
  if (!next) return null;
  const need = Number(evaluateExpression(next.need, project, state, { floorId: state.floorId }) || 0);
  const exp = Number((state.hero || {}).exp || 0);
  return { level, exp, need, deficit: Math.max(0, need - exp) };
}

function isForwardChangeFloor(state, action) {
  if (!action || action.kind !== "changeFloor") return false;
  const targetFloorId = action.changeFloor && action.changeFloor.floorId;
  if (targetFloorId === ":next") return true;
  return getFloorOrder(targetFloorId) > getFloorOrder(state.floorId);
}

function isBackwardChangeFloor(state, action) {
  if (!action || action.kind !== "changeFloor") return false;
  const targetFloorId = action.changeFloor && action.changeFloor.floorId;
  if (targetFloorId === ":before") return true;
  return getFloorOrder(targetFloorId) < getFloorOrder(state.floorId);
}

function getPolicyLookaheadOptions(options, rank) {
  const base = {
    cache: options && options.__resourceLookaheadCache,
    maxDepth: 8,
    maxNodes: 8,
    branchLimit: 3,
    frontierLimit: 5,
    includeResourcePocket: false,
    includeFightToLevelUp: false,
  };
  if (rank && rank.phase === "mt2-resource-return-or-mt3") {
    return { ...base, maxDepth: 9, maxNodes: 8, branchLimit: 3, frontierLimit: 5 };
  }
  return base;
}

function shouldUseResourceLookahead(rank, action, options) {
  if (options && options.enableResourceLookahead === false) return false;
  if (!rank || rank.phase !== "mt2-resource-return-or-mt3") return false;
  if (action.kind === "battle") {
    const hp = Number((rank && rank.hp) || 0);
    const damage = Number((action.estimate || {}).damage || 0);
    const damageRatio = hp > 0 ? damage / hp : 1;
    if (damage >= hp) return false;
    if (damageRatio > 0.55) return false;
  }
  if (Number(rank.battleFrontier || 0) > 8) return false;
  return ["battle", "equip", "fightToLevelUp", "changeFloor"].includes(action.kind);
}

function getActionResourceLookahead(simulator, state, action, rank, options) {
  if (!shouldUseResourceLookahead(rank, action, options)) return null;
  if (action.kind === "resourcePocket" || action.kind === "resourceCluster") return null;
  if (!options.__resourceLookaheadCache) options.__resourceLookaheadCache = createResourceLookaheadCache();
  return evaluateActionResourceLookahead(simulator, state, action, getPolicyLookaheadOptions(options, rank));
}

function hasPositiveLocalResourceLookahead(simulator, state, rank, options) {
  if (!rank || rank.phase !== "mt2-resource-return-or-mt3") return false;
  if (options.__positiveResourceLookaheadByState && options.__positiveResourceLookaheadByState.has(state)) {
    return options.__positiveResourceLookaheadByState.get(state);
  }
  if (!options.__positiveResourceLookaheadByState) options.__positiveResourceLookaheadByState = new WeakMap();
  let positive = false;
  try {
    const actions = simulator.enumeratePrimitiveActions(state).actions;
    positive = actions.some((action) => ["battle", "equip", "pickup", "openDoor", "useTool"].includes(action.kind));
  } catch (error) {
    positive = false;
  }
  options.__positiveResourceLookaheadByState.set(state, positive);
  return positive;
}

function getPolicyPhase(state, targetFloorOrder) {
  const current = getFloorOrder(state.floorId);
  const best = Number((getProgress(state) || {}).bestFloorRank || current);
  if (targetFloorOrder > 0 && best >= targetFloorOrder) return "target-reached";
  if (current <= 1) return "mt1-open-mt2";
  if (current === 2) return "mt2-resource-return-or-mt3";
  if (current >= 3 && current <= 5) return "mt3-mt5-local-forward";
  return "mt6plus-forward";
}

function getStageObjectiveRank(simulator, state, options) {
  const project = simulator.project;
  const targetFloorOrder = getFloorOrder((options && options.targetFloorId) || simulator.stopFloorId);
  const progress = getProgress(state);
  const currentFloorOrder = getFloorOrder(state.floorId);
  const features = getFrontierFeatures(project, state, { battleResolver: simulator.battleResolver });
  const nextTargets = getNextFloorTargets(project, state.floorId);
  const heroPoint = { x: Number((state.hero.loc || {}).x || 0), y: Number((state.hero.loc || {}).y || 0) };
  const directNextDistance = nearestDistance(heroPoint, nextTargets);
  const nextDistance = Math.min(finiteNumber(features.nearestNextFloorDistance, Number.POSITIVE_INFINITY), directNextDistance);
  const nextLevel = getNextLevelInfo(project, state);
  const phase = getPolicyPhase(state, targetFloorOrder);
  const forwardReady = Number(features.nextFloorCount || 0) > 0 ? 1 : 0;
  const adjacentForwardReady = Object.values(features.changeFloorTargets || {})
    .some((target) => target.kind === "next" && Number(target.distance || 0) <= 1) ? 1 : 0;
  const combat = Number((state.hero || {}).atk || 0) + Number((state.hero || {}).def || 0) + Number((state.hero || {}).mdef || 0);

  return {
    phase,
    phaseRank: ["mt1-open-mt2", "mt2-resource-return-or-mt3", "mt3-mt5-local-forward", "mt6plus-forward", "target-reached"].indexOf(phase),
    terminal: simulator.isTerminal(state) ? 1 : 0,
    stageIndex: progress.stageIndex,
    bestFloorRank: progress.bestFloorRank,
    currentFloorOrder,
    targetFloorOrder,
    forwardReady,
    adjacentForwardReady,
    nextOpportunity: Number(features.bestNextFloorOpportunity || 0),
    changeOpportunity: Number(features.bestChangeFloorOpportunity || 0),
    zeroDamageBattle: Number(features.zeroDamageBattleCount || 0),
    battleFrontier: Number(features.battleFrontierCount || 0),
    minBattleDamage: features.minBattleDamage == null ? null : Number(features.minBattleDamage),
    maxBattleDamage: features.maxBattleDamage == null ? null : Number(features.maxBattleDamage),
    minBattleDamageRatio: features.minBattleDamageRatio == null ? null : Number(features.minBattleDamageRatio),
    maxBattleDamageRatio: features.maxBattleDamageRatio == null ? null : Number(features.maxBattleDamageRatio),
    nextDistance,
    changeDistance: finiteNumber(features.nearestChangeFloorDistance, Number.POSITIVE_INFINITY),
    level: Number((state.hero || {}).lv || 0),
    expReadiness: nextLevel ? (nextLevel.deficit <= 0 ? 10000 : Math.max(0, 10000 - nextLevel.deficit * 250)) : 0,
    combat,
    hp: Number((state.hero || {}).hp || 0),
    routeLength: Array.isArray(state.route) && state.route.length > 0 ? state.route.length : getDecisionDepth(state),
  };
}

function compareStageObjectiveStates(simulator, left, right, options) {
  const leftRank = getStageObjectiveRank(simulator, left, options);
  const rightRank = getStageObjectiveRank(simulator, right, options);
  const highWins = [
    "terminal",
    "stageIndex",
    "bestFloorRank",
    "adjacentForwardReady",
    "forwardReady",
  ];
  for (const key of highWins) {
    const diff = compareNumbers(leftRank[key], rightRank[key]);
    if (diff !== 0) return diff;
  }
  const nextDistanceDiff = compareNumbers(rightRank.nextDistance, leftRank.nextDistance);
  if (nextDistanceDiff !== 0) return nextDistanceDiff;
  const changeDistanceDiff = compareNumbers(rightRank.changeDistance, leftRank.changeDistance);
  if (changeDistanceDiff !== 0) return changeDistanceDiff;
  const objectiveHighWins = ["nextOpportunity", "changeOpportunity", "level", "expReadiness"];
  for (const key of objectiveHighWins) {
    const diff = compareNumbers(leftRank[key], rightRank[key]);
    if (diff !== 0) return diff;
  }
  const floorOrderDiff = compareNumbers(leftRank.currentFloorOrder, rightRank.currentFloorOrder);
  const secondaryHighWins = ["zeroDamageBattle", "battleFrontier", "combat", "hp"];
  for (const key of secondaryHighWins) {
    const diff = compareNumbers(leftRank[key], rightRank[key]);
    if (diff !== 0) return diff;
  }
  if (floorOrderDiff !== 0) return floorOrderDiff;
  return compareNumbers(rightRank.routeLength, leftRank.routeLength);
}

function getStageActionScore(simulator, state, action, index, options) {
  options = options || {};
  const project = simulator.project;
  const rank = getStageObjectiveRank(simulator, state, options);
  const nextTargets = getNextFloorTargets(project, state.floorId);
  const endpoint = getActionEndpoint(action);
  const currentDistance = rank.nextDistance;
  const endpointDistance = nearestDistance(endpoint, nextTargets);
  let score = Math.max(0, 1000 - index);

  if (isForwardChangeFloor(state, action)) {
    score += 250000;
    if (rank.phase === "mt3-mt5-local-forward" || rank.phase === "mt6plus-forward") score += 50000;
    const scout = getCachedChangeFloorScout(simulator, state, action, (options && options.scoutOptions) || {});
    if (scout && scout.verdict) {
      if (scout.verdict.canProgressImmediately) score += 180000;
      if (!scout.verdict.likelyBlocked) score += 80000;
    }
    if (scout) {
      score += Math.min(120000, Math.max(0, Number(scout.score || 0)));
      const deficits = scout.deficits || {};
      score -= Math.min(220000, Number(deficits.hpDeficit || 0) * 120);
      score -= Math.min(160000, Number(deficits.atkDeficit || 0) * 40000);
      score -= Math.min(160000, Number(deficits.defDeficit || 0) * 40000);
      score -= Math.min(100000, Number(deficits.mdefDeficit || 0) * 10000);
    }
  } else if (action.kind === "changeFloor") {
    score += 45000;
    const targetFloorId = action.changeFloor && action.changeFloor.floorId;
    if (targetFloorId === ":before" && rank.phase === "mt2-resource-return-or-mt3") score += 16000;
    if (isBackwardChangeFloor(state, action) && rank.phase === "mt2-resource-return-or-mt3" && hasPositiveLocalResourceLookahead(simulator, state, rank, options)) score -= 90000;
    if (targetFloorId === ":before" && (rank.phase === "mt3-mt5-local-forward" || rank.phase === "mt6plus-forward")) {
      score += 60000;
      if (!rank.forwardReady && Number(rank.battleFrontier || 0) === 0) score += 120000;
      if (!rank.forwardReady && Number(rank.battleFrontier || 0) > 0) {
        const maxDamageRatio = Number(rank.maxBattleDamageRatio || 0);
        const minDamageRatio = Number(rank.minBattleDamageRatio || 0);
        if (maxDamageRatio >= 0.3) score += 140000;
        else if (maxDamageRatio >= 0.18) score += 80000;
        if (minDamageRatio >= 0.18) score += 90000;
      }
    }
  }

  if (Number.isFinite(currentDistance) && Number.isFinite(endpointDistance)) {
    const improvement = currentDistance - endpointDistance;
    if (improvement > 0) score += improvement * 18000;
    if (endpointDistance <= 4) score += 16000;
    if (endpointDistance <= 2) score += 50000;
    if (endpointDistance <= 1) score += 80000;
  }

  if (action.kind === "battle") {
    const damage = Number((action.estimate || {}).damage || 0);
    const exp = Number((action.estimate || {}).exp || 0);
    const guards = Number((action.estimate || {}).guards || 0);
    const nextLevel = getNextLevelInfo(project, state);
    const hp = Number((state.hero || {}).hp || 0);
    const damageRatio = hp > 0 ? damage / hp : 1;
    const lookahead = getActionResourceLookahead(simulator, state, action, rank, options);
    score += 18000 + exp * 1800;
    if (lookahead && lookahead.valid && Number(lookahead.score || 0) >= 160000) {
      score -= Math.min(70000, damage * 20);
    } else if (damageRatio >= 0.6) score -= 260000;
    else if (damageRatio >= 0.35) score -= 150000;
    else if (damageRatio >= 0.2) score -= 70000;
    if (rank.phase === "mt3-mt5-local-forward" && !rank.forwardReady && damageRatio >= 0.18) score -= 90000;
    if (damage === 0) score += 12000;
    if (damage <= 25 && exp > 0) score += 45000;
    score -= Math.min(25000, damage * 3);
    if (guards > 0) score += 8000 + guards * 4000;
    if (nextLevel && nextLevel.deficit > 0 && exp >= nextLevel.deficit) score += 90000;
    else if (nextLevel && nextLevel.deficit > 0 && nextLevel.deficit <= 5 && exp > 0) score += exp * 28000;
    if (lookahead && lookahead.valid && Number(lookahead.score || 0) > 0) {
      score += Math.min(260000, Number(lookahead.score || 0));
      if ((lookahead.gainedEquipment || []).length > 0) score += 80000;
      if (lookahead.openedResourceChain) score += 70000;
      if (lookahead.returnedToPreviousFloor) score += 40000;
    }
  } else if (action.kind === "fightToLevelUp") {
    score += 100000 + Number((action.estimate || {}).targetLevel || 0) * 12000;
    score -= Math.min(30000, Number((action.estimate || {}).damage || 0) * 2);
  } else if (action.kind === "resourcePocket" || action.kind === "resourceChain" || action.kind === "resourceCluster") {
    const estimate = action.estimate || {};
    const stopReasons = estimate.stopReasons || [];
    const pocketScore = Number(estimate.score || 0);
    const compressedPocketScore = Math.min(120000, Math.log10(Math.max(1, pocketScore)) * 22000);
    const confluence = estimate.confluence || {};
    score += 60000 + compressedPocketScore;
    if (Number(confluence.hpRank || 0) === 1) score += 45000;
    score += Math.min(40000, Number(confluence.dominatedEquivalentCount || 0) * 10000);
    score += Math.min(40000, Number(estimate.dominatedPlans || 0) * 8000);
    if (action.kind === "resourceCluster") {
      if (estimate.representativeRole === "highestHp") score += 28000;
      score += Math.min(45000, Number(estimate.rejectedByClusterDominance || 0) * 7000);
      score += Math.min(16000, Number(estimate.skylineSize || 0) * 3000);
    }
    if (stopReasons.includes("forwardChangeFloor")) score += 120000;
    if (stopReasons.includes("levelUp")) score += 90000;
    if (stopReasons.includes("keyItem")) score += 45000;
    if (rank.phase === "mt2-resource-return-or-mt3") {
      score += Math.min(70000, Number(estimate.hpAfter || 0) * 8);
      score += Number(estimate.atk || 0) * 18000;
      score += Number(estimate.def || 0) * 14000;
      score += Number(estimate.mdef || 0) * 1200;
    }
  } else if (action.kind === "openDoor") {
    score += 28000;
  } else if (action.kind === "pickup") {
    score += 22000;
  } else if (action.kind === "useTool") {
    score += action.tool === "centerFly" ? 35000 : 26000;
  } else if (action.kind === "equip") {
    score += 24000;
  } else if (action.kind === "event") {
    score += action.hasStateChange ? 24000 : 200;
  }

  if (options.policyMode === "resource-prep") {
    const lookahead = getActionResourceLookahead(simulator, state, action, rank, options);
    if (lookahead && lookahead.valid && Number(lookahead.score || 0) > 0) {
      score += Math.min(260000, Number(lookahead.score || 0));
      if (lookahead.openedResourceChain) score += 140000;
      if ((lookahead.gainedEquipment || []).length > 0) score += 120000;
      if (lookahead.reachedForwardFloor && lookahead.returnedToPreviousFloor) score += 90000;
    }
    if (rank.phase === "mt2-resource-return-or-mt3" && isBackwardChangeFloor(state, action)) score -= 70000;
  }

  if (rank.phase === "mt1-open-mt2" && action.kind === "battle") score += 8000;
  if (rank.phase === "mt2-resource-return-or-mt3" && (action.kind === "resourcePocket" || action.kind === "resourceChain" || action.kind === "resourceCluster" || action.kind === "fightToLevelUp")) score += 35000;
  if (rank.phase === "mt3-mt5-local-forward" && (action.kind === "openDoor" || action.kind === "pickup")) score += 12000;
  if ((action.path || []).length === 0) score += 500;
  return score;
}

function sortStagePolicyActions(simulator, state, actions, options) {
  return actions
    .map((action, index) => ({ action, index, score: getStageActionScore(simulator, state, action, index, options) }))
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      return left.index - right.index;
    })
    .map((entry) => entry.action);
}

function summarizeStageObjective(simulator, state, options) {
  if (!state) return null;
  const rank = getStageObjectiveRank(simulator, state, options);
  return {
    phase: rank.phase,
    floor: state.floorId,
    bestFloorRank: rank.bestFloorRank,
    currentFloorOrder: rank.currentFloorOrder,
    forwardReady: rank.forwardReady,
    adjacentForwardReady: rank.adjacentForwardReady,
    nextDistance: Number.isFinite(rank.nextDistance) ? rank.nextDistance : null,
    nextOpportunity: rank.nextOpportunity,
    battleFrontier: rank.battleFrontier,
    zeroDamageBattle: rank.zeroDamageBattle,
    minBattleDamage: rank.minBattleDamage,
    maxBattleDamage: rank.maxBattleDamage,
    minBattleDamageRatio: rank.minBattleDamageRatio,
    maxBattleDamageRatio: rank.maxBattleDamageRatio,
    level: rank.level,
    expReadiness: rank.expReadiness,
  };
}

module.exports = {
  compareStageObjectiveStates,
  getStageActionScore,
  getStageObjectiveRank,
  sortStagePolicyActions,
  summarizeStageObjective,
};
