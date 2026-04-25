"use strict";

const { getFloorOrder, parseFloorId } = require("./floor-id");

function getVisitedFloorIds(state) {
  const visited = new Set(Object.keys(state.visitedFloors || {}));
  if (state.floorId) visited.add(state.floorId);
  return Array.from(visited).sort((left, right) => {
    const leftOrder = getFloorOrder(left);
    const rightOrder = getFloorOrder(right);
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return left.localeCompare(right);
  });
}

function buildVisitedFloorMask(visitedFloorIds) {
  return visitedFloorIds
    .map((floorId) => {
      const parsed = parseFloorId(floorId);
      return parsed && parsed.family === "MT" ? `MT${parsed.level}` : floorId;
    })
    .join(",");
}

function deriveProgress(state) {
  const visitedFloorIds = getVisitedFloorIds(state);
  const currentFloorRank = getFloorOrder(state.floorId);
  const bestFloorRank = visitedFloorIds.reduce(
    (best, floorId) => Math.max(best, getFloorOrder(floorId)),
    currentFloorRank
  );
  const visitedFloorMask = buildVisitedFloorMask(visitedFloorIds);
  const stageIndex = Math.max(0, bestFloorRank - 1);
  const milestoneMask = visitedFloorMask;

  return {
    stageIndex,
    milestoneMask,
    visitedFloorMask,
    targetFloor: state.progress && state.progress.targetFloor ? state.progress.targetFloor : null,
    bestFloorRank,
    currentFloorRank,
    lastProgressActionId: state.progress && state.progress.lastProgressActionId ? state.progress.lastProgressActionId : null,
  };
}

function syncProgress(state) {
  state.progress = deriveProgress(state);
  return state.progress;
}

function getProgress(state) {
  return state.progress || deriveProgress(state);
}

function getProgressSignature(state) {
  const progress = getProgress(state);
  return [
    progress.stageIndex,
    progress.milestoneMask,
    progress.visitedFloorMask,
    progress.bestFloorRank,
  ].join(":");
}

function compareProgress(left, right) {
  const leftProgress = getProgress(left);
  const rightProgress = getProgress(right);
  if (leftProgress.stageIndex !== rightProgress.stageIndex) {
    return leftProgress.stageIndex - rightProgress.stageIndex;
  }
  if (leftProgress.bestFloorRank !== rightProgress.bestFloorRank) {
    return leftProgress.bestFloorRank - rightProgress.bestFloorRank;
  }
  if (leftProgress.currentFloorRank !== rightProgress.currentFloorRank) {
    return leftProgress.currentFloorRank - rightProgress.currentFloorRank;
  }
  if (leftProgress.visitedFloorMask !== rightProgress.visitedFloorMask) {
    return leftProgress.visitedFloorMask.length - rightProgress.visitedFloorMask.length;
  }
  return 0;
}

module.exports = {
  compareProgress,
  deriveProgress,
  getProgress,
  getProgressSignature,
  syncProgress,
};
