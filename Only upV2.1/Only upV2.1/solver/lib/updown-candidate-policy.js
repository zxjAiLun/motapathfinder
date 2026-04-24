"use strict";

const { computeFrontierFeatures } = require("./frontier-features");

function isDecisionStep(step) {
  return typeof step === "string" && !step.startsWith("auto:");
}

function summarizeCandidateProgress(state) {
  const decisions = state.route.filter(isDecisionStep);
  const upCount = decisions.filter((step) => step.startsWith("changeFloor@MT1:")).length;
  const downCount = decisions.filter((step) => step.startsWith("changeFloor@MT2:")).length;
  const hasVisitedMT2 = Boolean(state.visitedFloors && state.visitedFloors.MT2);
  const phase = downCount > 0 ? 3 : (hasVisitedMT2 || upCount > 0 ? 2 : 1);
  return {
    decisions,
    downCount,
    hasVisitedMT2,
    phase,
    upCount,
  };
}

function summarizeCandidateObjective(simulator, state, progress) {
  const frontier = computeFrontierFeatures(simulator.project, state, { battleResolver: simulator.battleResolver });
  if (progress.phase >= 3) {
    return {
      kind: "done",
      locKey: null,
      targetDistance: 0,
      targetOpportunity: Number(frontier.bestChangeFloorOpportunity || 0),
      targetReady: 1,
    };
  }

  if (progress.phase === 1) {
    const nextTarget = Object.entries(frontier.changeFloorTargets || {})
      .filter(([, item]) => item.kind === "next")
      .sort((left, right) => {
        const leftInfo = left[1];
        const rightInfo = right[1];
        const leftScore = Number(((leftInfo.preview || {}).score) || 0);
        const rightScore = Number(((rightInfo.preview || {}).score) || 0);
        if (leftScore !== rightScore) return rightScore - leftScore;
        return Number(leftInfo.distance || Number.POSITIVE_INFINITY) - Number(rightInfo.distance || Number.POSITIVE_INFINITY);
      })[0] || null;
    const nextReady = Object.values(frontier.changeFloorTargets || {}).filter((item) => item.kind === "next" && item.distance === 1).length;
    return {
      kind: "next",
      locKey: nextTarget ? nextTarget[0] : null,
      targetDistance: Number(frontier.nearestNextFloorDistance || Number.POSITIVE_INFINITY),
      targetOpportunity: Number(frontier.bestNextFloorOpportunity || 0),
      targetReady: nextReady,
    };
  }

  const beforeEntries = Object.entries(frontier.changeFloorTargets || {}).filter(([, item]) => item.kind === "before");
  const beforeTargets = beforeEntries.map(([, item]) => item);
  const beforeTarget = beforeEntries
    .slice()
    .sort((left, right) => {
      const leftInfo = left[1];
      const rightInfo = right[1];
      const leftScore = Number(((leftInfo.preview || {}).score) || 0);
      const rightScore = Number(((rightInfo.preview || {}).score) || 0);
      if (leftScore !== rightScore) return rightScore - leftScore;
      return Number(leftInfo.distance || Number.POSITIVE_INFINITY) - Number(rightInfo.distance || Number.POSITIVE_INFINITY);
    })[0] || null;
  return {
    kind: "before",
    locKey: beforeTarget ? beforeTarget[0] : null,
    targetDistance: beforeTargets.length > 0
      ? Math.min(...beforeTargets.map((item) => Number(item.distance || Number.POSITIVE_INFINITY)))
      : Number.POSITIVE_INFINITY,
    targetOpportunity: beforeTargets.length > 0
      ? Math.max(...beforeTargets.map((item) => Number(((item.preview || {}).score) || 0)))
      : 0,
    targetReady: beforeTargets.filter((item) => item.distance === 1).length,
  };
}

function parseObjectiveLoc(locKey) {
  if (!locKey) return null;
  const parts = String(locKey).split(",").map(Number);
  if (parts.length !== 2 || parts.some((value) => Number.isNaN(value))) return null;
  return { x: parts[0], y: parts[1] };
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

function compareCandidateStates(simulator, left, right) {
  const leftProgress = summarizeCandidateProgress(left);
  const rightProgress = summarizeCandidateProgress(right);
  if (leftProgress.phase !== rightProgress.phase) return leftProgress.phase - rightProgress.phase;
  if (leftProgress.downCount !== rightProgress.downCount) return leftProgress.downCount - rightProgress.downCount;
  if (leftProgress.upCount !== rightProgress.upCount) return leftProgress.upCount - rightProgress.upCount;
  if ((left.floorId === "MT2") !== (right.floorId === "MT2")) return left.floorId === "MT2" ? 1 : -1;
  const leftObjective = summarizeCandidateObjective(simulator, left, leftProgress);
  const rightObjective = summarizeCandidateObjective(simulator, right, rightProgress);
  if (leftObjective.targetReady !== rightObjective.targetReady) return leftObjective.targetReady - rightObjective.targetReady;
  if (leftObjective.targetOpportunity !== rightObjective.targetOpportunity) {
    return leftObjective.targetOpportunity - rightObjective.targetOpportunity;
  }
  if (leftObjective.targetDistance !== rightObjective.targetDistance) {
    return rightObjective.targetDistance - leftObjective.targetDistance;
  }
  if (leftProgress.decisions.length !== rightProgress.decisions.length) {
    return rightProgress.decisions.length - leftProgress.decisions.length;
  }
  return simulator.compareSearchStates(left, right);
}

function sortCandidateFrontier(simulator, frontier) {
  frontier.sort((left, right) => compareCandidateStates(simulator, right, left));
}

function trimCandidateFrontier(simulator, frontier, options) {
  const config = options || {};
  const beamWidth = Number(config.beamWidth || 180);
  const perBucketLimit = Number(config.perBucketLimit || Math.max(8, Number(config.perStateLimit || 10) * 2));
  const perFloorLimit = Number(config.perFloorLimit || Math.max(36, Math.floor(beamWidth / 2)));
  if (frontier.length <= beamWidth) return frontier;

  const byBucket = new Map();
  frontier.forEach((state) => {
    const progress = summarizeCandidateProgress(state);
    const bucket = `${progress.phase}|${simulator.getFrontierBucketKey(state)}`;
    if (!byBucket.has(bucket)) byBucket.set(bucket, []);
    byBucket.get(bucket).push(state);
  });

  const bucketTrimmed = [];
  byBucket.forEach((states) => {
    sortCandidateFrontier(simulator, states);
    bucketTrimmed.push(...states.slice(0, perBucketLimit));
  });

  const byFloor = new Map();
  bucketTrimmed.forEach((state) => {
    const floorId = state.floorId || "";
    if (!byFloor.has(floorId)) byFloor.set(floorId, []);
    byFloor.get(floorId).push(state);
  });

  const floorTrimmed = [];
  byFloor.forEach((states) => {
    sortCandidateFrontier(simulator, states);
    floorTrimmed.push(...states.slice(0, perFloorLimit));
  });

  sortCandidateFrontier(simulator, floorTrimmed);
  return floorTrimmed.slice(0, beamWidth);
}

function compareCandidateActions(simulator, state, left, right) {
  const progress = summarizeCandidateProgress(state);
  const objective = summarizeCandidateObjective(simulator, state, progress);
  const targetLoc = parseObjectiveLoc(objective.locKey);

  const scoreAction = (action) => {
    let score = 0;
    if (objective.kind === "next" && action.kind === "changeFloor" && action.changeFloor && action.changeFloor.floorId === ":next") score += 10000;
    if (objective.kind === "before" && action.kind === "changeFloor" && action.changeFloor && action.changeFloor.floorId === ":before") score += 10000;
    if (action.kind === "battle") {
      score += 900;
      if (Number((action.estimate || {}).damage || 0) === 0) score += 220;
      score += Math.min(120, Number((action.estimate || {}).exp || 0) * 3);
      score += Math.min(80, Number((action.estimate || {}).money || 0) * 2);
    }
    const endpoint = getActionEndpoint(action);
    if (targetLoc && endpoint) {
      const distance = Math.abs(endpoint.x - targetLoc.x) + Math.abs(endpoint.y - targetLoc.y);
      score += Math.max(0, 400 - distance * 40);
      if (distance <= 1) score += 120;
      if (distance === 0) score += 80;
    }
    if ((action.path || []).length === 0) score += 40;
    return score;
  };

  const leftScore = scoreAction(left);
  const rightScore = scoreAction(right);
  if (leftScore !== rightScore) return leftScore - rightScore;
  const leftEndpoint = getActionEndpoint(left);
  const rightEndpoint = getActionEndpoint(right);
  if (targetLoc && leftEndpoint && rightEndpoint) {
    const leftDistance = Math.abs(leftEndpoint.x - targetLoc.x) + Math.abs(leftEndpoint.y - targetLoc.y);
    const rightDistance = Math.abs(rightEndpoint.x - targetLoc.x) + Math.abs(rightEndpoint.y - targetLoc.y);
    if (leftDistance !== rightDistance) return rightDistance - leftDistance;
  }
  const leftPathLength = Array.isArray(left.path) ? left.path.length : 0;
  const rightPathLength = Array.isArray(right.path) ? right.path.length : 0;
  if (leftPathLength !== rightPathLength) return rightPathLength - leftPathLength;
  return 0;
}

module.exports = {
  compareCandidateActions,
  compareCandidateStates,
  isDecisionStep,
  sortCandidateFrontier,
  summarizeCandidateObjective,
  summarizeCandidateProgress,
  trimCandidateFrontier,
};
