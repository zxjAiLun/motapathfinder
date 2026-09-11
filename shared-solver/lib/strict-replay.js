"use strict";

/**
 * Shared strict replay gate for autonomous search qualification.
 *
 * "Every step enumerated and hero survived" only proves a route is executable.
 * This gate additionally requires: every step resolves to EXACTLY ONE action
 * (ambiguous resolution fails closed), no lethal transition, replayed terminal
 * state key equals the searched final state key, and the replayed terminal
 * state satisfies isGoalState.
 */
const { buildStateKey } = require("./state-key");

/**
 * Fail-closed unique action resolution.
 *
 * `a.summary === step || a.kind === step` inside `find` is not strict: when
 * several enumerated actions share a summary it silently accepts one of them,
 * and the replay then validates a route that was never proven unique.
 *
 * Multiple summary matches are ambiguous and fail closed.
 *
 * Exception: the simulator can enumerate several distinct
 * action objects that share one `summary` (e.g. two
 * different walk paths to the same battle). These are
 * aliases of a single logical action. They are accepted
 * only when every candidate produces the SAME resulting
 * state key, in which case the choice is immaterial and
 * we take the first.
 */
function resolveUniqueAction(simulator, state, actions, step, index) {
  const summaryMatches = actions.filter((a) => a.summary === step);
  if (summaryMatches.length > 1) {
    const keys = summaryMatches.map((a) => buildStateKey(simulator.applyAction(state, a, { storeRoute: false })));
    const allSame = keys.every((k) => k === keys[0]);
    if (!allSame) {
      return { error: { ok: false, reason: `step-${index}-ambiguous-summary: ${step}`, step: index, matchCount: summaryMatches.length } };
    }
    return { action: summaryMatches[0] };
  }
  if (summaryMatches.length === 1) return { action: summaryMatches[0] };

  const kindMatches = actions.filter((a) => a.kind === step);
  if (kindMatches.length > 1) {
    const kkeys = kindMatches.map((a) => buildStateKey(simulator.applyAction(state, a, { storeRoute: false })));
    if (!kkeys.every((k) => k === kkeys[0])) {
      return { error: { ok: false, reason: `step-${index}-ambiguous-kind: ${step}`, step: index, matchCount: kindMatches.length } };
    }
    return { action: kindMatches[0] };
  }
  if (kindMatches.length === 1) return { action: kindMatches[0] };

  return {
    error: { ok: false, reason: `step-${index}-diverged: ${step}`, step: index },
  };
}

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
    const resolved = resolveUniqueAction(simulator, state, actions, step, i);
    if (resolved.error) return resolved.error;
    state = simulator.applyAction(state, resolved.action, { storeRoute: true });
    if (!state || !state.hero || state.hero.hp <= 0) {
      return { ok: false, reason: `step-${i}-lethal: ${step}`, step: i };
    }
  }

  const finalKey = buildStateKey(state);

  if (config.expectedFinalState) {
    const expectedKey = buildStateKey(config.expectedFinalState);
    if (expectedKey !== finalKey) {
      return {
        ok: false,
        reason: "terminal-state-mismatch",
        step: route.length,
        expectedFinalKey: expectedKey,
        replayFinalKey: finalKey,
      };
    }
  }

  if (isGoalState && !isGoalState(state)) {
    return {
      ok: false,
      reason: "goal-unsatisfied-after-replay",
      step: route.length,
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

module.exports = { verifyStrictReplay, resolveUniqueAction };
