"use strict";

const { compareProgress } = require("./progress");
const { requirementDeficitScore, selectRepairCheckpoints } = require("./floor-checkpoints");
const { cloneState, getDecisionDepth } = require("./state");

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
  const minHero = blocker && blocker.recommendedRepair && blocker.recommendedRepair.minHero || {};
  for (const checkpoint of candidates) {
    if (!checkpoint.state) {
      attempts.push({ ...summarizeCheckpointCandidate(checkpoint, minHero), repaired: false, reason: "checkpoint-missing-state" });
      continue;
    }
    const checkpointRoute = Array.isArray(checkpoint.route) ? checkpoint.route.slice() : [];
    const startState = cloneState(checkpoint.state);
    startState.route = [];
    if (startState.meta) {
      startState.meta.decisionDepth = 0;
      startState.meta.autoStepCount = 0;
      startState.meta.autoPickupCount = 0;
      startState.meta.autoBattleCount = 0;
    }
    const result = await searchFn(simulator, startState, {
      ...(searchContext.profile || {}),
      maxExpansions: number(config.repairExpansionsPerAttempt, 30),
      topK: number(config.topK, 1),
      disableDominance: false,
      safeDominanceMode: true,
      parallel: config.parallel != null ? config.parallel : ((searchContext.profile || {}).parallel || false),
      checkpointRepair: false,
      targetFloorId: config.targetFloorId || simulator.stopFloorId,
    });
    const repairedState = result.goalState || result.bestProgressState || result.bestSeenState;
    if (repairedState) {
      const suffix = Array.isArray(repairedState.route) ? repairedState.route : [];
      const suffixDecisionDepth = getDecisionDepth(repairedState);
      repairedState.route = checkpointRoute.concat(suffix);
      if (repairedState.meta) repairedState.meta.decisionDepth = number(checkpoint.decisionDepth, checkpointRoute.length) + suffixDecisionDepth;
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
      ...summarizeCheckpointCandidate(checkpoint, minHero),
      foundGoal,
      repaired,
      progressImproved,
      blockerCleared: cleared,
      finalFloorId: repairedState && repairedState.floorId,
      suffixRouteLength: repairedState && Array.isArray(repairedState.route) ? Math.max(0, repairedState.route.length - checkpointRoute.length) : null,
      expansions: result.expansions,
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
        candidatePlan: candidates.map((candidate) => summarizeCheckpointCandidate(candidate, minHero)),
        attempts: attempts.map(summarizeAttempt),
        reason: foundGoal ? "goal-found" : progressImproved ? "progress-improved" : cleared ? "blocker-cleared" : "same-progress-better",
      };
    }
  }

  return {
    attempted: true,
    repaired: false,
    reason: "repair-search-no-improvement",
    candidatePlan: candidates.map((candidate) => summarizeCheckpointCandidate(candidate, minHero)),
    attempts: attempts.map(summarizeAttempt),
  };
}

function summarizeCheckpointCandidate(checkpoint, minHero) {
  return {
    checkpointId: checkpoint.id,
    edge: checkpoint.edge,
    strategy: checkpoint.repairStrategy || "ranked",
    strategies: checkpoint.repairStrategies || [checkpoint.repairStrategy || "ranked"],
    hero: checkpoint.hero,
    routeLength: checkpoint.routeLength,
    tags: checkpoint.tags || [],
    skylineKey: checkpoint.skylineKey || null,
    requirementDeficit: requirementDeficitScore(checkpoint, minHero || {}),
    scoutScore: number(checkpoint.scout && checkpoint.scout.score, 0),
  };
}

function summarizeAttempt(attempt) {
  return {
    checkpointId: attempt.checkpointId,
    edge: attempt.edge,
    strategy: attempt.strategy,
    strategies: attempt.strategies,
    hero: attempt.hero,
    routeLength: attempt.routeLength,
    requirementDeficit: attempt.requirementDeficit,
    scoutScore: attempt.scoutScore,
    foundGoal: attempt.foundGoal,
    repaired: attempt.repaired,
    progressImproved: attempt.progressImproved,
    blockerCleared: attempt.blockerCleared,
    finalFloorId: attempt.finalFloorId,
    suffixRouteLength: attempt.suffixRouteLength,
    expansions: attempt.expansions,
    blockerType: attempt.blocker && attempt.blocker.blockerType,
  };
}

module.exports = {
  repairFromCheckpoints,
};
