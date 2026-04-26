"use strict";

const { getFrontierFeatures } = require("./search-cache");
const { evaluateExpression } = require("./expression");
const { getProgress } = require("./progress");
const { getDecisionDepth } = require("./state");
const { getFloorOrder, getProgressFloorOrder } = require("./score");
const {
  compareStageObjectiveStates,
  getStageActionScore: getPolicyStageActionScore,
  sortStagePolicyActions,
} = require("./stage-policy");
const {
  compareCandidateActions,
  compareCandidateStates,
} = require("./updown-candidate-policy");

function compareNumbers(left, right) {
  if (left === right) return 0;
  return left > right ? 1 : -1;
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function getActionEndpoint(action) {
  if (action.kind === "battle" || action.kind === "openDoor" || action.kind === "useTool") {
    return action.target || null;
  }
  if (action.kind === "pickup" || action.kind === "changeFloor" || action.kind === "event") {
    return { x: action.x, y: action.y };
  }
  return null;
}

function distanceTo(point, target) {
  if (!point || !target) return Number.POSITIVE_INFINITY;
  return Math.abs(point.x - target.x) + Math.abs(point.y - target.y);
}


function floorQuotaOverrides(floorId, base, mode) {
  const resourceHeavy = mode === "resource-prep";
  const defaults = {
    maxActionsPerState: resourceHeavy ? 48 : 32,
    progressActionQuota: 8,
    unlockActionQuota: resourceHeavy ? 8 : 6,
    itemActionQuota: resourceHeavy ? 16 : 6,
    resourceActionQuota: resourceHeavy ? 18 : 12,
    expActionQuota: resourceHeavy ? 24 : 12,
    fightActionQuota: resourceHeavy ? 24 : 10,
    shopActionQuota: resourceHeavy ? 6 : 3,
  };
  const floorOverrides = {
    MT1: resourceHeavy
      ? { maxActionsPerState: 42, resourceActionQuota: 14, expActionQuota: 18, fightActionQuota: 18 }
      : { maxActionsPerState: 28, resourceActionQuota: 10, expActionQuota: 10, fightActionQuota: 8 },
    MT2: resourceHeavy
      ? { maxActionsPerState: 56, progressActionQuota: 10, unlockActionQuota: 10, resourceActionQuota: 22, expActionQuota: 26, fightActionQuota: 26 }
      : { maxActionsPerState: 36, progressActionQuota: 10, unlockActionQuota: 8, resourceActionQuota: 14, expActionQuota: 14, fightActionQuota: 12 },
    MT3: resourceHeavy
      ? { maxActionsPerState: 52, progressActionQuota: 10, resourceActionQuota: 18, expActionQuota: 22, fightActionQuota: 22 }
      : { maxActionsPerState: 36, progressActionQuota: 10, resourceActionQuota: 12, expActionQuota: 14, fightActionQuota: 12 },
    MT4: { maxActionsPerState: resourceHeavy ? 50 : 34, progressActionQuota: 10, resourceActionQuota: resourceHeavy ? 18 : 12, fightActionQuota: resourceHeavy ? 20 : 12 },
    MT5: { maxActionsPerState: resourceHeavy ? 54 : 38, progressActionQuota: 10, resourceActionQuota: resourceHeavy ? 20 : 13, fightActionQuota: resourceHeavy ? 22 : 14 },
  };
  const override = floorOverrides[floorId] || {};
  return { ...defaults, ...base, ...override };
}

function createAdaptiveActionQuotaGetter(config, mode) {
  return (state, current) => {
    const explicitMax = config.maxActionsPerState;
    const quotas = floorQuotaOverrides(state.floorId, current, mode);
    if (explicitMax != null) quotas.maxActionsPerState = explicitMax;
    return quotas;
  };
}

function createAdaptiveBeamGetter(config, mode) {
  return (frontier) => {
    const resourceHeavy = mode === "resource-prep";
    let maxFloorOrder = 0;
    let branchyStateCount = 0;
    frontier.forEach((state) => {
      maxFloorOrder = Math.max(maxFloorOrder, getFloorOrder(state.floorId));
      const features = getFrontierFeatures(config.project, state, {
        battleResolver: config.battleResolver,
      });
      const branchScore = Number(features.battleFrontierCount || 0) + Number(features.resourcePocketCount || 0) + Number(features.changeFloorCount || 0);
      if (branchScore >= 6 || state.floorId === "MT2" || state.floorId === "MT3") branchyStateCount += 1;
    });
    const branchy = branchyStateCount > Math.max(3, Math.floor(frontier.length / 5));
    const lowFloor = maxFloorOrder <= 1;
    const base = resourceHeavy
      ? { beamWidth: 360, perFloorBeamWidth: 160, perRegionBeamWidth: 64 }
      : { beamWidth: 260, perFloorBeamWidth: 120, perRegionBeamWidth: 48 };
    if (lowFloor && !branchy) {
      return resourceHeavy
        ? { beamWidth: 220, perFloorBeamWidth: 100, perRegionBeamWidth: 40 }
        : { beamWidth: 160, perFloorBeamWidth: 72, perRegionBeamWidth: 30 };
    }
    if (branchy || maxFloorOrder >= 2) return base;
    return resourceHeavy
      ? { beamWidth: 280, perFloorBeamWidth: 128, perRegionBeamWidth: 52 }
      : { beamWidth: 210, perFloorBeamWidth: 96, perRegionBeamWidth: 40 };
  };
}


function getStageRank(simulator, state) {
  const score = simulator.score(state);
  const frontier = getFrontierFeatures(simulator.project, state, {
    battleResolver: simulator.battleResolver,
  });
  const preferred = frontier.preferredChangeFloor || null;
  const preferredPreview = preferred && preferred.preview ? preferred.preview : {};

  return {
    stageIndex: getProgress(state).stageIndex,
    bestFloorRank: getProgress(state).bestFloorRank,
    terminal: simulator.isTerminal(state) ? 1 : 0,
    progressFloor: getProgressFloorOrder(state),
    currentFloor: getFloorOrder(state.floorId),
    nextReady: Number(frontier.adjacentChangeFloorCount || 0),
    nextOpportunity: Number(frontier.bestNextFloorOpportunity || 0),
    changeOpportunity: Number(frontier.bestChangeFloorOpportunity || 0),
    preferredItems: Number(preferredPreview.itemCount || 0),
    preferredZeroDamage: Number(preferredPreview.zeroDamageBattleCount || 0),
    zeroDamageBattle: Number(frontier.zeroDamageBattleCount || 0),
    battleFrontier: Number(frontier.battleFrontierCount || 0),
    nextDistance: finiteNumber(frontier.nearestNextFloorDistance, Number.POSITIVE_INFINITY),
    changeDistance: finiteNumber(frontier.nearestChangeFloorDistance, Number.POSITIVE_INFINITY),
    level: Number((state.hero || {}).lv || 0),
    exp: Number((state.hero || {}).exp || 0),
    expReadiness: (() => {
      const nextLevel = getNextLevelInfo(simulator.project, state);
      if (!nextLevel) return 0;
      return nextLevel.deficit <= 0 ? 10000 : Math.max(0, 10000 - nextLevel.deficit * 300);
    })(),
    combat: Number(state.hero.atk || 0) + Number(state.hero.def || 0) + Number(state.hero.mdef || 0),
    hp: Number(state.hero.hp || 0),
    primary: Number(score.primary || 0),
    tertiary: Number(score.tertiary || 0),
    routeLength: Array.isArray(state.route) && state.route.length > 0 ? state.route.length : getDecisionDepth(state),
  };
}

function compareStageStates(simulator, left, right) {
  const leftRank = getStageRank(simulator, left);
  const rightRank = getStageRank(simulator, right);

  const primaryHighWins = [
    "terminal",
    "stageIndex",
    "bestFloorRank",
    "progressFloor",
    "nextOpportunity",
    "changeOpportunity",
    "nextReady",
    "currentFloor",
    "level",
    "expReadiness",
  ];
  for (const key of primaryHighWins) {
    const diff = compareNumbers(leftRank[key], rightRank[key]);
    if (diff !== 0) return diff;
  }

  const nextDistanceDiff = compareNumbers(rightRank.nextDistance, leftRank.nextDistance);
  if (nextDistanceDiff !== 0) return nextDistanceDiff;
  const changeDistanceDiff = compareNumbers(rightRank.changeDistance, leftRank.changeDistance);
  if (changeDistanceDiff !== 0) return changeDistanceDiff;

  const secondaryHighWins = [
    "combat",
    "exp",
    "preferredItems",
    "preferredZeroDamage",
    "zeroDamageBattle",
    "battleFrontier",
    "hp",
    "primary",
    "tertiary",
  ];
  for (const key of secondaryHighWins) {
    const diff = compareNumbers(leftRank[key], rightRank[key]);
    if (diff !== 0) return diff;
  }
  return compareNumbers(rightRank.routeLength, leftRank.routeLength);
}

function getStageActionScore(simulator, state, action, index) {
  const frontier = getFrontierFeatures(simulator.project, state, {
    battleResolver: simulator.battleResolver,
  });
  const preferred = frontier.preferredChangeFloor || null;
  const currentFloorOrder = getFloorOrder(state.floorId);
  const endpoint = getActionEndpoint(action);
  let score = Math.max(0, 1000 - index);

  if (action.kind === "changeFloor") {
    const targetFloorId = action.changeFloor && action.changeFloor.floorId;
    const targetOrder = targetFloorId && targetFloorId.indexOf(":") !== 0
      ? getFloorOrder(targetFloorId)
      : (targetFloorId === ":next" ? currentFloorOrder + 1 : targetFloorId === ":before" ? currentFloorOrder - 1 : -1);
    score += 12000;
    if (targetFloorId === ":next") score += 5000;
    if (targetFloorId === ":before") score += 1800;
    if (targetOrder > currentFloorOrder) score += 2500 + targetOrder * 100;
    if (preferred && preferred.x === action.x && preferred.y === action.y) score += 2500;
    const targetInfo = frontier.changeFloorTargets && frontier.changeFloorTargets[`${action.x},${action.y}`];
    if (targetInfo && targetInfo.preview) {
      score += Math.min(3000, Number(targetInfo.preview.score || 0));
      score += Number(targetInfo.preview.itemCount || 0) * 100;
      score += Number(targetInfo.preview.zeroDamageBattleCount || 0) * 80;
    }
  } else if (action.kind === "battle") {
    const damage = Number((action.estimate || {}).damage || 0);
    const exp = Number((action.estimate || {}).exp || 0);
    const nextLevel = getNextLevelInfo(simulator.project, state);
    score += 8000;
    if (damage === 0) score += 1600;
    score -= Math.min(2500, damage * 4);
    score += Math.min(900, exp * 5);
    score += Math.min(600, Number((action.estimate || {}).money || 0) * 3);
    if (nextLevel && nextLevel.deficit > 0 && exp >= nextLevel.deficit) {
      score += 60000;
      score -= Math.min(12000, damage * 3);
    } else if (nextLevel && nextLevel.deficit > 0 && nextLevel.deficit <= 3 && exp > 0) {
      score += 12000 * exp;
      score -= Math.min(6000, damage * 2);
    }
    if (damage <= 25 && exp > 0) score += 18000;
  } else if (action.kind === "fightToLevelUp") {
    score += 45000;
    score += Number((action.estimate || {}).exp || 0) * 8000;
    score += Number((action.estimate || {}).targetLevel || 0) * 8000;
    score -= Math.min(9000, Number((action.estimate || {}).damage || 0));
  } else if (action.kind === "resourcePocket" || action.kind === "resourceCluster") {
    const stopReasons = (action.estimate || {}).stopReasons || [];
    score += 9500;
    if (stopReasons.includes("levelUp")) score += 22000;
    if (stopReasons.includes("forwardChangeFloor")) score += 30000;
    if (stopReasons.includes("keyItem")) score += 12000;
    score += Math.min(9000, Number((action.estimate || {}).score || 0));
  } else if (action.kind === "event") {
    score += action.unsupported ? 50 : (action.hasStateChange ? 6100 : 200);
  } else if (action.kind === "openDoor") {
    score += 6200;
  } else if (action.kind === "useTool") {
    score += 5600;
  } else if (action.kind === "equip") {
    score += 5000;
  } else if (action.kind === "pickup") {
    score += 4200;
  }

  if (preferred && endpoint) {
    const distance = distanceTo(endpoint, preferred);
    score += Math.max(0, 2000 - distance * 120);
    if (distance <= 1) score += 500;
  }
  if ((action.path || []).length === 0) score += 150;
  return score;
}

function getNextLevelInfo(project, state) {
  const entries = (((project || {}).data || {}).firstData || {}).levelUp || [];
  const level = Number((state.hero || {}).lv || 0);
  const next = entries[level] || null;
  if (!next) return null;
  const need = Number(evaluateExpression(next.need, project, state, { floorId: state.floorId }) || 0);
  const exp = Number((state.hero || {}).exp || 0);
  return {
    level,
    exp,
    need,
    deficit: Math.max(0, need - exp),
  };
}

function getResourcePrepRank(simulator, state) {
  const stageRank = getStageRank(simulator, state);
  const nextLevel = getNextLevelInfo(simulator.project, state) || { level: Number((state.hero || {}).lv || 0), exp: Number((state.hero || {}).exp || 0), deficit: 9999 };
  return {
    ...stageRank,
    level: Number((state.hero || {}).lv || 0),
    atk: Number((state.hero || {}).atk || 0),
    def: Number((state.hero || {}).def || 0),
    mdef: Number((state.hero || {}).mdef || 0),
    exp: Number((state.hero || {}).exp || 0),
    hasEquipment: ((state.hero || {}).equipment || []).length > 0 ? 1 : 0,
    expReadiness: nextLevel.deficit <= 0 ? 10000 : Math.max(0, 10000 - nextLevel.deficit * 200),
    money: Number((state.hero || {}).money || 0),
  };
}

function compareResourcePrepStates(simulator, left, right) {
  const leftRank = getResourcePrepRank(simulator, left);
  const rightRank = getResourcePrepRank(simulator, right);
  const highWins = [
    "terminal",
    "bestFloorRank",
    "stageIndex",
    "hasEquipment",
    "level",
    "combat",
    "hp",
    "atk",
    "def",
    "mdef",
    "expReadiness",
    "exp",
    "money",
    "nextOpportunity",
    "changeOpportunity",
    "battleFrontier",
  ];
  for (const key of highWins) {
    const diff = compareNumbers(leftRank[key], rightRank[key]);
    if (diff !== 0) return diff;
  }
  return compareNumbers(rightRank.routeLength, leftRank.routeLength);
}

function getResourcePrepActionScore(simulator, state, action, index) {
  let score = getPolicyStageActionScore(simulator, state, action, index, {
    policyMode: "resource-prep",
    enableResourceLookahead: true,
  });
  const nextLevel = getNextLevelInfo(simulator.project, state);
  if (action.kind === "battle") {
    const damage = Number((action.estimate || {}).damage || 0);
    const exp = Number((action.estimate || {}).exp || 0);
    score += 10000 + exp * 5000 - Math.min(5000, damage);
    if (nextLevel && exp >= nextLevel.deficit) score += 50000;
    else if (nextLevel && nextLevel.deficit <= 15) score += exp * 8000;
  } else if (action.kind === "fightToLevelUp") {
    score += 80000;
    score += Number((action.estimate || {}).targetLevel || 0) * 10000;
    score -= Math.min(10000, Number((action.estimate || {}).damage || 0));
  } else if (action.kind === "resourcePocket" || action.kind === "resourceCluster") {
    score += 50000;
    score += Math.min(20000, Number((action.estimate || {}).score || 0));
  } else if (action.kind === "pickup") {
    score += 12000;
  } else if (action.kind === "changeFloor") {
    const targetFloorId = action.changeFloor && action.changeFloor.floorId;
    if (targetFloorId === ":before") score -= 4000;
  }
  return score;
}

function sortResourcePrepActions(simulator, state, actions) {
  return actions
    .map((action, index) => ({ action, index, score: getResourcePrepActionScore(simulator, state, action, index) }))
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      return left.index - right.index;
    })
    .map((entry) => entry.action);
}

function sortStageActions(simulator, state, actions) {
  return actions
    .map((action, index) => ({ action, index, score: getStageActionScore(simulator, state, action, index) }))
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      return left.index - right.index;
    })
    .map((entry) => entry.action);
}

function createDefaultProfile() {
  return {};
}

function compareCanonicalBfsStates(left, right) {
  const leftDepth = getDecisionDepth(left);
  const rightDepth = getDecisionDepth(right);
  if (leftDepth !== rightDepth) return rightDepth - leftDepth;
  const progressDiff = getProgressFloorOrder(left) - getProgressFloorOrder(right);
  if (progressDiff !== 0) return progressDiff;
  const leftHero = left.hero || {};
  const rightHero = right.hero || {};
  const highWins = ["hp", "atk", "def", "mdef", "lv", "exp", "money"];
  for (const key of highWins) {
    const diff = compareNumbers(Number(leftHero[key] || 0), Number(rightHero[key] || 0));
    if (diff !== 0) return diff;
  }
  const leftRoute = Array.isArray(left.route) ? left.route.length : leftDepth;
  const rightRoute = Array.isArray(right.route) ? right.route.length : rightDepth;
  return rightRoute - leftRoute;
}

function canonicalActionPriority(action) {
  if (!action) return 99;
  if (action.kind === "pickup" || action.kind === "equip") return 0;
  if (action.kind === "battle") return 1;
  if (action.kind === "openDoor" || action.kind === "useTool") return 2;
  if (action.kind === "event") return 3;
  if (action.kind === "changeFloor") return 4;
  if (action.kind === "fightToLevelUp") return 5;
  if (action.kind === "resourcePocket" || action.kind === "resourceChain" || action.kind === "resourceCluster") return 6;
  return 50;
}

function sortCanonicalBfsActions(actions) {
  return actions.slice().sort((left, right) => {
    const priorityDiff = canonicalActionPriority(left) - canonicalActionPriority(right);
    if (priorityDiff !== 0) return priorityDiff;
    return String(left.summary || "").localeCompare(String(right.summary || ""));
  });
}

function createCanonicalBfsProfile() {
  return {
    compareFrontierStates: (left, right) => compareCanonicalBfsStates(left, right),
    sortStateActions: (state, actions) => sortCanonicalBfsActions(actions),
    maxActionsPerState: 128,
    progressActionQuota: 24,
    unlockActionQuota: 24,
    itemActionQuota: 32,
    resourceActionQuota: 24,
    expActionQuota: 64,
    fightActionQuota: 64,
    shopActionQuota: 8,
    reserveProgressActions: true,
    searchGraphMode: "hybrid",
    enableConfluenceHpDominance: true,
    confluenceRoutePolicy: "ignore-length",
    confluenceRepresentatives: 1,
    confluenceMinFloorOrder: 1,
  };
}

function createUpDownMt1Mt3Profile(simulator, options) {
  const config = options || {};
  return {
    compareFrontierStates: (left, right) => compareCandidateStates(simulator, left, right),
    sortStateActions: (state, actions) =>
      actions
        .slice()
        .sort((left, right) => compareCandidateActions(simulator, state, right, left)),
    getFrontierBucketKey: (state) => {
      const progress = require("./updown-candidate-policy").summarizeCandidateProgress(state);
      return `${progress.phase}|${simulator.getFrontierBucketKey(state)}`;
    },
    maxActionsPerState: config.maxActionsPerState || config.perStateLimit,
  };
}

function createStageMt1Mt11Profile(simulator, options) {
  const config = { ...(options || {}), project: simulator.project, battleResolver: simulator.battleResolver };
  return {
    compareFrontierStates: (left, right) => compareStageObjectiveStates(simulator, left, right, config),
    sortStateActions: (state, actions) => sortStagePolicyActions(simulator, state, actions, config),
    getFrontierBucketKey: (state) => {
      const features = getFrontierFeatures(simulator.project, state, {
        battleResolver: simulator.battleResolver,
      });
      const progress = getProgress(state);
      return `${progress.stageIndex}|${state.floorId}|${features.regionKey}|${features.targetBandKey}`;
    },
    targetFloorId: config.targetFloorId || simulator.stopFloorId,
    maxActionsPerState: config.maxActionsPerState || 32,
    progressActionQuota: config.progressActionQuota || 8,
    unlockActionQuota: config.unlockActionQuota || 6,
    itemActionQuota: config.itemActionQuota || 6,
    resourceActionQuota: config.resourceActionQuota || 12,
    expActionQuota: config.expActionQuota || 12,
    fightActionQuota: config.fightActionQuota || 10,
    shopActionQuota: config.shopActionQuota || 3,
    getActionQuotasForState: createAdaptiveActionQuotaGetter(config, "stage"),
    getBeamLimits: createAdaptiveBeamGetter(config, "stage"),
    reserveProgressActions: true,
    forwardChangeFloorAutoExpand: true,
  };
}

function createStageMt1Mt11ResourcePrepProfile(simulator, options) {
  const config = { ...(options || {}), project: simulator.project, battleResolver: simulator.battleResolver };
  const policyConfig = { ...config, policyMode: "resource-prep", enableResourceLookahead: true };
  return {
    compareFrontierStates: (left, right) => compareResourcePrepStates(simulator, left, right),
    sortStateActions: (state, actions) => sortStagePolicyActions(simulator, state, actions, policyConfig),
    getFrontierBucketKey: (state) => {
      const features = getFrontierFeatures(simulator.project, state, {
        battleResolver: simulator.battleResolver,
      });
      const progress = getProgress(state);
      const hpBucket = Math.floor(Number((state.hero || {}).hp || 0) / 500);
      const combatBucket = Math.floor((Number((state.hero || {}).atk || 0) + Number((state.hero || {}).def || 0)) / 10);
      const expBucket = Math.floor(Number((state.hero || {}).exp || 0) / 5);
      return `${progress.stageIndex}|${state.floorId}|hp${hpBucket}|c${combatBucket}|e${expBucket}|${features.targetBandKey}`;
    },
    maxActionsPerState: config.maxActionsPerState || 48,
    progressActionQuota: config.progressActionQuota || 8,
    unlockActionQuota: config.unlockActionQuota || 8,
    itemActionQuota: config.itemActionQuota || 16,
    resourceActionQuota: config.resourceActionQuota || 18,
    expActionQuota: config.expActionQuota || 24,
    fightActionQuota: config.fightActionQuota || 24,
    shopActionQuota: config.shopActionQuota || 6,
    getActionQuotasForState: createAdaptiveActionQuotaGetter(config, "resource-prep"),
    getBeamLimits: createAdaptiveBeamGetter(config, "resource-prep"),
    reserveProgressActions: true,
    forwardChangeFloorAutoExpand: true,
    enableConfluenceHpDominance: config.enableConfluenceHpDominance !== false,
    confluenceRoutePolicy: config.confluenceRoutePolicy || "slack",
    confluenceRouteSlack: config.confluenceRouteSlack || 12,
    confluenceRepresentatives: config.confluenceRepresentatives || 3,
    confluenceMinFloorOrder: config.confluenceMinFloorOrder || 1,
  };
}

function createSearchProfile(name, simulator, options) {
  switch (name || "default") {
    case "default":
      return createDefaultProfile(simulator, options);
    case "updown-mt1-mt3":
      return createUpDownMt1Mt3Profile(simulator, options);
    case "debug-local-resource":
      return {
        ...createStageMt1Mt11ResourcePrepProfile(simulator, {
          ...(options || {}),
          maxActionsPerState: (options && options.maxActionsPerState) || 32,
        }),
        searchGraphMode: (options && options.searchGraphMode) || "hybrid",
      };
    case "canonical-bfs":
      return createCanonicalBfsProfile(simulator, options);
    case "canonical-dp":
      return {
        ...createCanonicalBfsProfile(simulator, options),
        searchAlgorithm: "dp",
        searchGraphMode: "primitive",
        dpAgendaMode: "best-first",
        dpKeyMode: "mutation",
      };
    case "resource-prep-main":
      return createStageMt1Mt11ResourcePrepProfile(simulator, options);
    case "stage-mt1-mt11":
      return createStageMt1Mt11Profile(simulator, options);
    case "stage-mt1-mt11-resource-prep":
    case "debug-exp-farming":
      return createStageMt1Mt11ResourcePrepProfile(simulator, options);
    case "linear-main":
      return {
        ...createStageMt1Mt11ResourcePrepProfile(simulator, options),
        searchGraphMode: "macro",
      };
    default:
      throw new Error(`Unknown search profile: ${name}`);
  }
}

module.exports = {
  compareStageStates,
  createSearchProfile,
};
