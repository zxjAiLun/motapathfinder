"use strict";

const { computeFrontierFeatures } = require("./frontier-features");
const { getProgress } = require("./progress");

function actionEndpoint(action) {
  if (!action) return null;
  if (action.target) return action.target;
  if (action.x != null && action.y != null) return { x: action.x, y: action.y };
  return null;
}

function actionDistance(action) {
  if (Array.isArray(action.path)) return action.path.length;
  return Number.POSITIVE_INFINITY;
}

function scoreActionLandmark(action) {
  if (!action) return 0;
  if (action.kind === "changeFloor") return 100000 - actionDistance(action) * 1000;
  if (action.kind === "resourcePocket") return 80000 + Number((action.estimate || {}).score || 0);
  if (action.kind === "fightToLevelUp") return 75000 - Number((action.estimate || {}).damage || 0) + Number((action.estimate || {}).exp || 0) * 1000;
  if (action.kind === "event" && action.hasStateChange) return 65000 - actionDistance(action) * 500;
  if (action.kind === "openDoor") return 58000 - actionDistance(action) * 500;
  if (action.kind === "pickup") return 52000 - actionDistance(action) * 500;
  if (action.kind === "battle") {
    const damage = Number((action.estimate || {}).damage || 0);
    const exp = Number((action.estimate || {}).exp || 0);
    return 48000 + exp * 500 - damage;
  }
  return 1000 - actionDistance(action);
}

function classifyLandmark(action) {
  if (!action) return "unknown";
  if (action.kind === "changeFloor") return "target-stair";
  if (action.kind === "resourcePocket") return "resource-pocket";
  if (action.kind === "fightToLevelUp") return "level-threshold";
  if (action.kind === "event") return action.hasStateChange ? "required-event" : "event";
  if (action.kind === "openDoor") return "gate-unlock";
  if (action.kind === "pickup") return "key-or-item";
  if (action.kind === "battle") return Number((action.estimate || {}).damage || 0) <= 50 ? "low-damage-fight" : "fight";
  return action.kind || "misc";
}

function summarizeLandmarks(simulator, state, options) {
  if (!simulator || !state) return { phase: null, landmarks: [] };
  const actions = simulator.enumerateActions(state);
  const features = computeFrontierFeatures(simulator.project, state, { battleResolver: simulator.battleResolver });
  const landmarks = actions
    .map((action) => ({
      kind: classifyLandmark(action),
      actionKind: action.kind,
      summary: action.summary,
      score: scoreActionLandmark(action),
      distance: actionDistance(action),
      endpoint: actionEndpoint(action),
      estimate: action.estimate ? {
        damage: action.estimate.damage,
        exp: action.estimate.exp,
        money: action.estimate.money,
        score: action.estimate.score,
        stopReasons: action.estimate.stopReasons,
      } : undefined,
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, Number((options || {}).limit || 12));
  return {
    floorId: state.floorId,
    progress: getProgress(state),
    nearestNextFloorDistance: features.nearestNextFloorDistance,
    nextFloorCount: features.nextFloorCount,
    battleFrontierCount: features.battleFrontierCount,
    resourcePocketCount: actions.filter((action) => action.kind === "resourcePocket").length,
    landmarks,
  };
}

module.exports = {
  summarizeLandmarks,
};
