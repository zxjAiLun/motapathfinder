"use strict";

const { compareProgress } = require("./progress");
const { selectRepairCheckpoints } = require("./floor-checkpoints");

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function blockerCleared(before, after) {
  if (!before || !after) return false;
  if (before.blockerType !== after.blockerType) return true;
  if (number(after.deficits && after.deficits.hp, 0) < number(before.deficits && before.deficits.hp, 0)) return true;
  return false;
}

async function repairFromCheckpoints(simulator, searchContext, blocker, options) {
  const config = options || {};
  const searchFn = config.searchFn;
  const analyzeProgressBlocker = config.analyzeProgressBlocker;
  if (typeof searchFn !== "function") {
    return { attempted: false, repaired: false, reason: "missing-search-function" };
  }
  if (!blocker || !blocker.recommendedRepair || !blocker.recommendedRepair.fromEdge) {
    return { attempted: false, repaired: false, reason: "missing-recommended-repair" };
  }
  const checkpointPool = searchContext && searchContext.checkpointPool;
  const candidates = selectRepairCheckpoints(checkpointPool, blocker, {
    maxRepairAttempts: number(config.maxRepairAttempts, 6),
  });
  if (candidates.length === 0) {
    return { attempted: true, repaired: false, reason: "no-checkpoint-for-edge", attempts: [] };
  }

  const attempts = [];
  const originalBest = searchContext.bestProgressState || searchContext.bestSeenState;
  for (const checkpoint of candidates) {
    if (!checkpoint.state) {
      attempts.push({ checkpointId: checkpoint.id, repaired: false, reason: "checkpoint-missing-state" });
      continue;
    }
    const result = await searchFn(simulator, checkpoint.state, {
      ...(searchContext.profile || {}),
      maxExpansions: number(config.repairExpansionsPerAttempt, 120),
      topK: number(config.topK, 1),
      disableDominance: false,
      safeDominanceMode: true,
      parallel: false,
      checkpointRepair: false,
      targetFloorId: config.targetFloorId || simulator.stopFloorId,
    });
    const repairedState = result.goalState || result.bestProgressState || result.bestSeenState;
    if (repairedState && Array.isArray(checkpoint.route)) {
      const suffix = Array.isArray(repairedState.route) ? repairedState.route : [];
      repairedState.route = checkpoint.route.concat(suffix);
    }
    const afterBlocker = typeof analyzeProgressBlocker === "function" && repairedState
      ? analyzeProgressBlocker(simulator, repairedState, {})
      : null;
    const progressImproved = repairedState && originalBest && compareProgress(repairedState, originalBest) > 0;
    const sameProgressBetter = repairedState && originalBest && compareProgress(repairedState, originalBest) === 0 && simulator.compareSearchStates(repairedState, originalBest) > 0;
    const cleared = blockerCleared(blocker, afterBlocker);
    const foundGoal = Boolean(result.goalState);
    const repaired = Boolean(foundGoal || progressImproved || sameProgressBetter || cleared);
    const attempt = {
      checkpointId: checkpoint.id,
      edge: checkpoint.edge,
      hero: checkpoint.hero,
      foundGoal,
      repaired,
      progressImproved,
      blockerCleared: cleared,
      finalFloorId: repairedState && repairedState.floorId,
      result,
      blocker: afterBlocker,
    };
    attempts.push(attempt);
    if (repaired) {
      return {
        attempted: true,
        repaired: true,
        selectedCheckpointId: checkpoint.id,
        repairedState,
        result,
        blocker: afterBlocker,
        attempts: attempts.map(summarizeAttempt),
        reason: foundGoal ? "goal-found" : progressImproved ? "progress-improved" : cleared ? "blocker-cleared" : "same-progress-better",
      };
    }
  }

  return {
    attempted: true,
    repaired: false,
    reason: "repair-search-no-improvement",
    attempts: attempts.map(summarizeAttempt),
  };
}

function summarizeAttempt(attempt) {
  return {
    checkpointId: attempt.checkpointId,
    edge: attempt.edge,
    hero: attempt.hero,
    foundGoal: attempt.foundGoal,
    repaired: attempt.repaired,
    progressImproved: attempt.progressImproved,
    blockerCleared: attempt.blockerCleared,
    finalFloorId: attempt.finalFloorId,
    blockerType: attempt.blocker && attempt.blocker.blockerType,
  };
}

module.exports = {
  repairFromCheckpoints,
};
