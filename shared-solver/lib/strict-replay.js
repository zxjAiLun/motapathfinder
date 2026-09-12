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
const { cloneState } = require("./state");
const { resolveRecordedAction } = require("./route-store");

/**
 * Strict replay of a SEARCH-PRODUCED route (string summaries + optional structured trace).
 *
 * The trace entries are `{ action: normalizeAction(action), postExactStateKey }`.
 * When a trace entry is present we delegate action identity to the existing
 * route-store resolver, which uses exact post-state identity as primary evidence
 * and treats the recorded travel variant as disambiguating evidence. That is the
 * only sound way to separate variants that share both a summary AND a fingerprint
 * (e.g. two walk paths to the same battle).
 *
 * Fail-closed: any step that cannot be resolved to a single action fails the gate.
 */
/**
 * Resolve one replay step. When a structured trace entry exists we hand the
 * decision to the existing route-store resolver (exact post-state is primary
 * evidence; the recorded travel variant disambiguates aliases). Without a
 * trace entry we fall back to fail-closed unique summary resolution so that
 * legacy string-only routes are still validated, never silently accepted.
 */
function resolveReplayStep(simulator, state, actions, step, index, entry) {
  if (entry && entry.action) {
    const decision = {
      ...entry.action,
      postExactStateKey: entry.postExactStateKey || null,
    };
    let resolved;
    try {
      resolved = resolveRecordedAction(simulator, state, decision, {
        candidates: actions,
      });
    } catch (error) {
      return { error: { ok: false, reason: `step-${index}-resolver-error: ${step}`, step: index, message: error.message } };
    }
    if (!resolved || !resolved.action) {
      return {
        error: {
          ok: false,
          reason: `step-${index}-unresolved-recorded-action: ${step}`,
          step: index,
          unresolvedReason: (resolved && resolved.reason) || 'unknown',
          ambiguous: Boolean(resolved && resolved.ambiguous),
          candidates: resolved ? resolved.candidates : null,
        },
      };
    }
    return {
      action: resolved.action,
      recordedPostExactStateKey: entry.postExactStateKey || null,
    };
  }
  return resolveUniqueAction(simulator, state, actions, step, index);
}

/**
 * Fail-closed unique resolution for legacy string-only routes.
 *
 * Multiple summary matches are ambiguous and fail closed, UNLESS every
 * candidate produces the same post-state key (true alias of one logical
 * action). If there are no summary matches, fall back to exact kind.
 */
function resolveUniqueAction(simulator, state, actions, step, index) {
  const summaryMatches = actions.filter((a) => a.summary === step);
  if (summaryMatches.length > 1) {
    const keys = summaryMatches.map((a) => buildStateKey(simulator.applyAction(state, a, { storeRoute: false })));
    if (!keys.every((k) => k === keys[0])) {
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

  return { error: { ok: false, reason: `step-${index}-diverged: ${step}`, step: index } };
}
function verifyStrictReplay(simulator, route, options) {
  const config = options || {};
  const isGoalState = typeof config.isGoalState === "function" ? config.isGoalState : null;
  const trace = Array.isArray(config.routeTrace) ? config.routeTrace : null;
  if (!Array.isArray(route) || route.length === 0) {
    return { ok: false, reason: "empty-or-non-array-route" };
  }
  if (trace && trace.length !== route.length) {
    return { ok: false, reason: "trace-length-mismatch", routeLength: route.length, traceLength: trace.length };
  }
  if (trace) {
    for (let i = 0; i < trace.length; i += 1) {
      const entry = trace[i];
      if (!entry || !entry.action) {
        return { ok: false, reason: `step-${i}-incomplete-structured-trace`, step: i, missing: "action" };
      }
      if (typeof entry.postExactStateKey !== "string" || entry.postExactStateKey.length === 0) {
        return { ok: false, reason: `step-${i}-incomplete-structured-trace`, step: i, missing: "postExactStateKey" };
      }
    }
  }

  let state = config.initialState
    ? cloneState(config.initialState)
    : simulator.createInitialState({ rank: config.rank || "chaos" });
  for (let i = 0; i < route.length; i += 1) {
    const step = route[i];
    const actions = (simulator.enumeratePrimitiveActions(state) || {}).actions || [];
    const resolved = resolveReplayStep(simulator, state, actions, step, i, trace ? trace[i] : null);
    if (resolved.error) return resolved.error;
    state = simulator.applyAction(state, resolved.action, { storeRoute: true });
    if (!state || !state.hero || state.hero.hp <= 0) {
      return { ok: false, reason: `step-${i}-lethal: ${step}`, step: i };
    }
    if (resolved.recordedPostExactStateKey) {
      const actualPostKey = buildStateKey(state);
      if (actualPostKey !== resolved.recordedPostExactStateKey) {
        return { ok: false, reason: `step-${i}-recorded-post-state-mismatch: ${step}`, step: i };
      }
    }
  }

  const finalKey = buildStateKey(state);
  if (config.expectedFinalState) {
    const expectedKey = buildStateKey(config.expectedFinalState);
    if (expectedKey !== finalKey) {
      return {
        ok: false,
        reason: "terminal-state-mismatch",
        expectedFinalKey: expectedKey,
        actualFinalKey: finalKey,
      };
    }
  }
  if (isGoalState && !isGoalState(state)) {
    return { ok: false, reason: "goal-not-satisfied-after-replay", finalFloorId: state.floorId };
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

module.exports = { verifyStrictReplay };
