"use strict";

const { computeFrontierFeatures } = require("./frontier-features");
const { getProgress } = require("./progress");
const { getFloorOrder, getProgressFloorOrder } = require("./score");
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
  if (action.kind === "pickup" || action.kind === "changeFloor") {
    return { x: action.x, y: action.y };
  }
  return null;
}

function distanceTo(point, target) {
  if (!point || !target) return Number.POSITIVE_INFINITY;
  return Math.abs(point.x - target.x) + Math.abs(point.y - target.y);
}

function getStageRank(simulator, state) {
  const score = simulator.score(state);
  const frontier = computeFrontierFeatures(simulator.project, state, {
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
    combat: Number(state.hero.atk || 0) + Number(state.hero.def || 0) + Number(state.hero.mdef || 0),
    hp: Number(state.hero.hp || 0),
    primary: Number(score.primary || 0),
    tertiary: Number(score.tertiary || 0),
    routeLength: Array.isArray(state.route) ? state.route.length : 0,
  };
}

function compareStageStates(simulator, left, right) {
  const leftRank = getStageRank(simulator, left);
  const rightRank = getStageRank(simulator, right);

  const highWins = [
    "terminal",
    "stageIndex",
    "bestFloorRank",
    "progressFloor",
    "nextOpportunity",
    "changeOpportunity",
    "nextReady",
    "preferredItems",
    "preferredZeroDamage",
    "zeroDamageBattle",
    "battleFrontier",
    "currentFloor",
    "combat",
    "hp",
    "primary",
    "tertiary",
  ];
  for (const key of highWins) {
    const diff = compareNumbers(leftRank[key], rightRank[key]);
    if (diff !== 0) return diff;
  }

  const nextDistanceDiff = compareNumbers(rightRank.nextDistance, leftRank.nextDistance);
  if (nextDistanceDiff !== 0) return nextDistanceDiff;
  const changeDistanceDiff = compareNumbers(rightRank.changeDistance, leftRank.changeDistance);
  if (changeDistanceDiff !== 0) return changeDistanceDiff;
  return compareNumbers(rightRank.routeLength, leftRank.routeLength);
}

function getStageActionScore(simulator, state, action, index) {
  const frontier = computeFrontierFeatures(simulator.project, state, {
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
    score += 8000;
    if (damage === 0) score += 1600;
    score -= Math.min(2500, damage * 4);
    score += Math.min(900, Number((action.estimate || {}).exp || 0) * 5);
    score += Math.min(600, Number((action.estimate || {}).money || 0) * 3);
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
  const config = options || {};
  return {
    compareFrontierStates: (left, right) => compareStageStates(simulator, left, right),
    sortStateActions: (state, actions) => sortStageActions(simulator, state, actions),
    getFrontierBucketKey: (state) => {
      const features = computeFrontierFeatures(simulator.project, state, {
        battleResolver: simulator.battleResolver,
      });
      const progress = getProgress(state);
      return `${progress.stageIndex}|${state.floorId}|${features.regionKey}|${features.targetBandKey}`;
    },
    maxActionsPerState: config.maxActionsPerState || 24,
    progressActionQuota: config.progressActionQuota || 8,
    unlockActionQuota: config.unlockActionQuota || 6,
    itemActionQuota: config.itemActionQuota || 6,
    fightActionQuota: config.fightActionQuota || 6,
    shopActionQuota: config.shopActionQuota || 3,
    reserveProgressActions: true,
  };
}

function createSearchProfile(name, simulator, options) {
  switch (name || "default") {
    case "default":
      return createDefaultProfile(simulator, options);
    case "updown-mt1-mt3":
      return createUpDownMt1Mt3Profile(simulator, options);
    case "stage-mt1-mt11":
      return createStageMt1Mt11Profile(simulator, options);
    default:
      throw new Error(`Unknown search profile: ${name}`);
  }
}

module.exports = {
  compareStageStates,
  createSearchProfile,
};
