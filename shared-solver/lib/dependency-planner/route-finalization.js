"use strict";

const { verifyStrictReplay } = require("../strict-replay");
const { makeBlindSimulator } = require("../blind-discovery-baseline");

// Terminal semantics are shared by the loop and its final replay. This is not a
// winner selector: the caller has already selected a terminal branch.
function terminalGoalReached(project, state, terminalGoal) {
  if (!state || !terminalGoal) return false;
  if (state.floorId !== terminalGoal.floorId) return false;
  if (terminalGoal.type === "floorReached") return true;
  if (terminalGoal.type !== "bossDefeated") return false;
  const floor = ((project || {}).floors || {})[terminalGoal.floorId];
  if (!floor) return false;
  const targetX = Number(terminalGoal.x);
  const targetY = Number(terminalGoal.y);
  const pois = Array.isArray(floor.pois) ? floor.pois : [];
  const poi = pois.find((entry) => Number(entry.x) === targetX && Number(entry.y) === targetY);
  if (!poi) return false;
  // The target is defeated when its poi is no longer reported on the map.
  const survivors = typeof floor.currentPois === "function" ? floor.currentPois(state) : null;
  if (Array.isArray(survivors)) {
    return !survivors.some((entry) => Number(entry.x) === targetX && Number(entry.y) === targetY);
  }
  const triggered = (state.triggeredAutoEvents || {});
  const key = `${terminalGoal.floorId}:${targetX},${targetY}`;
  return triggered[key] === true;
}

function finalizeDependencyRoute({
  project,
  initialState,
  terminalGoal,
  reachedTerminal,
  terminalBranch,
  stepRounds,
  getSimulatorFactory,
}) {
  const acceptedRounds = stepRounds.filter((round) => round.acceptedBranchId != null);
  const roundStrictReplay = acceptedRounds.every((round) => round.acceptedStrictReplay === true);
  // Decisions belong to the winning lineage, not the latest local execution.
  const route = reachedTerminal && terminalBranch ? terminalBranch.cumulativeDecisions.slice() : null;

  // Per-segment replay flags cannot replace replay from the original state.
  // Keep the existing empty-route and missing-simulator behavior fail-closed.
  let fullRouteStrictReplay = null;
  if (reachedTerminal && Array.isArray(route) && route.length > 0) {
    try {
      let replaySim = null;
      const simulatorFactory = typeof getSimulatorFactory === "function" ? getSimulatorFactory() : null;
      if (typeof simulatorFactory === "function") {
        replaySim = simulatorFactory();
      } else if (project && project.floorsById && Object.keys(project.floorsById).length > 0) {
        replaySim = makeBlindSimulator(project);
      }
      if (replaySim && typeof replaySim.enumeratePrimitiveActions === "function" && typeof replaySim.applyAction === "function") {
        const summaries = route.map((d) => d && (d.summary || d.kind));
        fullRouteStrictReplay = verifyStrictReplay(replaySim, summaries, {
          initialState,
          isGoalState: (s) => terminalGoalReached(project, s, terminalGoal),
        });
      }
    } catch (error) {
      fullRouteStrictReplay = { ok: false, reason: `full-route-replay-exception: ${error.message}` };
    }
  }

  return {
    route,
    routeProvenance: reachedTerminal ? {
      startsAtOriginalInitialState: true,
      localSegmentCount: acceptedRounds.length,
      cumulativeDecisionCount: terminalBranch ? terminalBranch.cumulativeDecisions.length : 0,
      fullRouteStrictReplayValid: fullRouteStrictReplay ? fullRouteStrictReplay.ok === true : null,
      fullRouteStrictReplayReason: fullRouteStrictReplay ? (fullRouteStrictReplay.reason || null) : null,
    } : null,
    allAcceptedCheckpointsStrictReplay: roundStrictReplay,
    fullRouteStrictReplay,
    acceptedCheckpoints: acceptedRounds.map((round) => round.acceptedCheckpointLabel),
    verdict: reachedTerminal
      ? (roundStrictReplay && fullRouteStrictReplay && fullRouteStrictReplay.ok === true
        ? "DEPENDENCY_FEEDBACK_LOOP_REACHED_TERMINAL_WITH_STRICT_REPLAY"
        : "DEPENDENCY_FEEDBACK_LOOP_REACHED_TERMINAL_REPLAY_UNVERIFIED")
      : "DEPENDENCY_FEEDBACK_LOOP_UNKNOWN_UNDER_THIS_BUDGET",
  };
}

module.exports = { terminalGoalReached, finalizeDependencyRoute };
