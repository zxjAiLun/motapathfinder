"use strict";

/**
 * Shared strict replay gate for autonomous search qualification.
 *
 * Replaying a route and merely checking "every step was enumerated and the hero
 * did not die" is NOT sufficient to accept a found solution. That weaker check
 * proves the route is executable, but it does not prove:
 *
 *   1. the replayed terminal state is the same state the search claimed to reach
 *      (state-key equality), and
 *   2. the replayed terminal state actually satisfies the goal predicate.
 *
 * Both are required before any arm may be reported as FOUND. This module
 * implements the full gate once, so every qualification harness shares one
 * definition instead of each growing its own partial copy.
 */

const { buildStateKey } = require("./state-key");

/**
 * Replays `route` from the canonical initial state and verifies:
 *   - each step is enumerated as a legal primitive action at that point,
 *   - the hero stays alive,
 *   - the replayed terminal state key equals the searched final state key
 *     (when `expectedFinalState` is provided),
 *   - the replayed terminal state satisfies `isGoalState`
 *     (when `isGoalState` is provided).
 */
function verifyStrictReplay(simulator, route, options) {
  const config = options || {};
  const isGoalState = typeof config.isGoalState === "function" ? config.isGoalState : null;

  if (!Array.isArray(route) || route.length === 0) {
    return { ok: false, reason: "empty-or-non-array-route" };
  }

  let state = simulator.createInitialState({ rank: "chaos" });
  for (let i = 0; i < route.length; i += 1) {
    const step = route[i];
    const actions = (simulator.enumeratePrimitiveActions(state) || {}).actions || [];
    const matching = actions.find((a) => a.summary === step || a.kind === step);
    if (!matching) {
      return { ok: false, reason: `step-${i}-diverged: ${step}`, step: i, actionSummary: step };
    }
    state = simulator.applyAction(state, matching, { storeRoute: true });
    if (!state || !state.hero || state.hero.hp <= 0) {
      return { ok: false, reason: `step-${i}-lethal: ${step}`, step: i };
    }
  }

  const finalKey = buildStateKey(state);

  // Terminal-state identity: the replayed end state must be exactly the state
  // the search reported as its goal state.
  if (config.expectedFinalState) {
    const expectedKey = buildStateKey(config.expectedFinalState);
    if (expectedKey !== finalKey) {
      return {
        ok: false,
        reason: "terminal-state-mismatch",
        expectedFinalKey: expectedKey,
        replayedFinalKey: finalKey,
      };
    }
  }

  // Goal re-assertion: the replayed end state must still satisfy the goal
  // predicate when evaluated independently of the search's own bookkeeping.
  if (isGoalState && !isGoalState(state)) {
    return {
      ok: false,
      reason: "goal-not-satisfied-on-replayed-terminal-state",
      finalFloorId: state.floorId,
    };
  }

  return {
    ok: true,
    finalFloorId: state.floorId,
    finalState: state,
    finalKey,
    goalReasserted: isGoalState ? true : null,
    terminalStateMatched: config.expectedFinalState ? true : null,
  };
}

module.exports = {
  verifyStrictReplay,
};
