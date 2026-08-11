"use strict";

/**
 * TEST GRADE: real-fixture-failure-attribution
 *
 * PR-5.8d observes the strict-replay failure of the special80 -> MT8 winner.
 * It does not change search budgets, milestone modeling, keys, dominance, or
 * selection. The contract separates route-prefix/lineage continuity from the
 * recorded-action resolver's behavior at the first mismatching decision.
 */

const assert = require("node:assert");
const crypto = require("node:crypto");

const { getMilestoneSpec } = require("./lib/milestone-spec");
const { loadProject } = require("./lib/project-loader");
const {
  buildRouteRecord,
  enumerateRecordedActionCandidates,
  normalizeAction,
  resolveRecordedAction,
} = require("./lib/route-store");
const { cloneState } = require("./lib/state");
const { buildStateKey } = require("./lib/state-key");
const { exactStateFingerprint } = require("./lib/solver-job");
const {
  MAX_EXPANSIONS_PER_SEGMENT,
  MT4_START,
  MT5_START,
  MT8_TARGET,
  PROJECT_ROOT,
  ROUTE_NAME,
  buildStrictReplayEvidence,
  runGraph,
  summarizeSegments,
  totalExpansions,
} = require("./check-post-mt5-long-chain-baseline");
const {
  makeSimulator,
  replayFixture,
} = require("./check-mt5-third-gate-resource-timing");
const {
  EXPECTED_SPECIAL80_FINGERPRINT,
  SPECIAL80,
  TARGET,
} = require("./check-mt7-left-sword-budget-baseline");

const EXPECTED_MT5_EXPANSIONS = 645;
const EXPECTED_SPECIAL80_EXPANSIONS = 508;

function compactAction(action) {
  if (!action) return null;
  const normalized = normalizeAction(action);
  return {
    kind: normalized.kind,
    summary: normalized.summary,
    fingerprint: normalized.fingerprint,
    floorId: normalized.floorId || null,
    target: normalized.target || null,
    stance: normalized.stance || null,
    targetFloorId: normalized.targetFloorId || null,
    pathLength: Array.isArray(normalized.path) ? normalized.path.length : 0,
    pathFingerprint: fingerprintJson(normalized.path || []),
    hasTravelState: Boolean(action.travelState),
    travelStateFingerprint: action.travelState
      ? exactStateFingerprint(action.travelState)
      : null,
  };
}

function fingerprintJson(value) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 16);
}

function enumerateAllActionCandidates(simulator, state) {
  const entries = [];
  const add = (source, actions) => {
    (actions || []).forEach((action) => {
      if (action) entries.push({ source, action });
    });
  };
  try {
    add("enumerateActions", simulator.enumerateActions(state));
  } catch (error) {
  }
  if (typeof simulator.enumeratePrimitiveActions === "function") {
    try {
      add(
        "enumeratePrimitiveActions",
        simulator.enumeratePrimitiveActions(state).actions || [],
      );
    } catch (error) {
    }
  }
  if (typeof simulator.enumerateInteractPickupActions === "function") {
    try {
      add(
        "enumerateInteractPickupActions",
        simulator.enumerateInteractPickupActions(state),
      );
    } catch (error) {
    }
  }
  if (typeof simulator.enumerateFloorFlyActions === "function") {
    try {
      add(
        "enumerateFloorFlyActions",
        simulator.enumerateFloorFlyActions(state),
      );
    } catch (error) {
    }
  }
  return entries;
}

function aliasCollisionEvidence(simulator, preState, decision) {
  const expected = normalizeAction(decision);
  const variants = enumerateAllActionCandidates(
    simulator,
    cloneState(preState),
  ).flatMap(({ source, action }) => {
    let normalized;
    try {
      normalized = normalizeAction(action);
    } catch (error) {
      return [];
    }
    if (normalized.fingerprint !== expected.fingerprint) return [];
    let postState = null;
    let applyError = null;
    try {
      postState = simulator.applyAction(cloneState(preState), action);
    } catch (error) {
      applyError = String(error && error.message || error);
    }
    const postExactStateKey = postState ? buildStateKey(postState) : null;
    return [{
      source,
      pathMatches: JSON.stringify(normalized.path) === JSON.stringify(expected.path),
      postExactMatches: postExactStateKey === decision.postExactStateKey,
      postExactStateKeyFingerprint: stateKeyFingerprint(postExactStateKey),
      applyError,
      action: compactAction(action),
    }];
  });
  const uniqueVariants = [];
  const seen = new Set();
  variants.forEach((variant) => {
    const key = JSON.stringify({
      pathFingerprint: variant.action.pathFingerprint,
      travelStateFingerprint: variant.action.travelStateFingerprint,
      postExactStateKeyFingerprint: variant.postExactStateKeyFingerprint,
      applyError: variant.applyError,
    });
    if (seen.has(key)) return;
    seen.add(key);
    uniqueVariants.push(variant);
  });
  return {
    fingerprint: expected.fingerprint,
    rawCandidateCount: variants.length,
    uniqueVariantCount: uniqueVariants.length,
    uniquePathCount: new Set(
      uniqueVariants.map((variant) => variant.action.pathFingerprint),
    ).size,
    uniqueTravelStateCount: new Set(
      uniqueVariants.map((variant) => variant.action.travelStateFingerprint),
    ).size,
    uniquePostStateCount: new Set(
      uniqueVariants.map((variant) => variant.postExactStateKeyFingerprint),
    ).size,
    pathMatchCount: variants.filter((variant) => variant.pathMatches).length,
    exactPostMatchCount: variants.filter((variant) => variant.postExactMatches).length,
    variants: uniqueVariants,
  };
}

function jsonPathDiff(left, right, prefix, result, limit) {
  if (result.length >= limit) return result;
  if (left === right) return result;
  const path = prefix || "$";
  if (
    left == null ||
    right == null ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    result.push({ path, expected: left, actual: right });
    return result;
  }
  const keys = Array.from(new Set([
    ...Object.keys(left),
    ...Object.keys(right),
  ])).sort();
  for (const key of keys) {
    jsonPathDiff(left[key], right[key], `${path}.${key}`, result, limit);
    if (result.length >= limit) break;
  }
  return result;
}

function stateKeyDiff(expectedKey, actualKey) {
  try {
    return jsonPathDiff(
      JSON.parse(expectedKey),
      JSON.parse(actualKey),
      "$",
      [],
      8,
    );
  } catch (error) {
    return [{ path: "$", expected: expectedKey, actual: actualKey }];
  }
}

function continuityEvidence(initialState, decisions, routeSuffix) {
  const summaryParity = decisions.map((decision) => decision.summary);
  const discontinuities = [];
  decisions.forEach((decision, index) => {
    const expectedPre = index === 0
      ? buildStateKey(initialState)
      : decisions[index - 1].postExactStateKey;
    if (decision.preExactStateKey !== expectedPre) {
      discontinuities.push({
        decision: index + 1,
        expectedPre,
        recordedPre: decision.preExactStateKey,
      });
    }
  });
  return {
    prefixExactStateMatches: decisions[0].preExactStateKey === buildStateKey(initialState),
    summaryParity: JSON.stringify(summaryParity) === JSON.stringify(routeSuffix),
    decisionCount: decisions.length,
    routeSuffixCount: routeSuffix.length,
    discontinuities,
    continuous: discontinuities.length === 0,
    summaries: summaryParity,
  };
}

function freshCandidateEvidence(simulator, preState, decision) {
  const candidates = enumerateRecordedActionCandidates(
    simulator,
    cloneState(preState),
  ).actions;
  return candidates
    .filter((candidate) => candidate.summary === decision.summary)
    .map((candidate) => {
      const before = compactAction(candidate);
      let postState = null;
      let error = null;
      try {
        postState = simulator.applyAction(cloneState(preState), candidate);
      } catch (caught) {
        error = String(caught && caught.message || caught);
      }
      return {
        action: before,
        postExactStateFingerprint: postState
          ? stateKeyFingerprint(buildStateKey(postState))
          : null,
        postExactMatches: Boolean(
          postState && buildStateKey(postState) === decision.postExactStateKey,
        ),
        error,
      };
    });
}

function replayAttribution(project, initialState, decisions) {
  const simulator = makeSimulator(project);
  let state = cloneState(initialState);
  const steps = [];
  let firstMismatch = null;
  for (let index = 0; index < decisions.length; index += 1) {
    const decision = decisions[index];
    const pristinePreState = cloneState(state);
    const preExactStateKey = buildStateKey(state);
    const resolved = resolveRecordedAction(simulator, state, decision, { project });
    const postResolveExactStateKey = buildStateKey(state);
    const resolverMutatedState = postResolveExactStateKey !== preExactStateKey;
    const actionBeforeApply = compactAction(resolved.action);
    let actualPostState = null;
    let applyError = null;
    if (resolved.action) {
      try {
        actualPostState = simulator.applyAction(state, resolved.action);
      } catch (error) {
        applyError = String(error && error.message || error);
      }
    }
    const actualPostExactStateKey = actualPostState
      ? buildStateKey(actualPostState)
      : null;
    const postExactMatches = actualPostExactStateKey === decision.postExactStateKey;
    const freshCandidates = postExactMatches
      ? []
      : freshCandidateEvidence(simulator, pristinePreState, decision);
    const aliasCollision = postExactMatches
      ? null
      : aliasCollisionEvidence(simulator, pristinePreState, decision);
    const step = {
      decision: index + 1,
      summary: decision.summary,
      expectedFingerprint: decision.fingerprint || null,
      expectedPreExactStateFingerprint:
        stateKeyFingerprint(decision.preExactStateKey),
      actualPreExactStateFingerprint: stateKeyFingerprint(preExactStateKey),
      preExactMatches: preExactStateKey === decision.preExactStateKey,
      resolver: {
        matched: Boolean(resolved.action),
        reason: resolved.reason || null,
        matchType: resolved.matchType || null,
        candidates: Number(resolved.candidates || 0),
        postExactStateKeyMatches: resolved.postExactStateKeyMatches === true,
        postDominanceKeyMatches: resolved.postDominanceKeyMatches === true,
        fingerprintMatches: resolved.fingerprintMatches === true,
        stateMutated: resolverMutatedState,
        action: actionBeforeApply,
      },
      applyError,
      postExactMatches,
      expectedPostExactStateFingerprint:
        stateKeyFingerprint(decision.postExactStateKey),
      actualPostExactStateFingerprint:
        stateKeyFingerprint(actualPostExactStateKey),
      stateDiff: postExactMatches || !actualPostExactStateKey
        ? []
        : stateKeyDiff(decision.postExactStateKey, actualPostExactStateKey),
      freshCandidates,
      aliasCollision,
    };
    steps.push(step);
    if (!postExactMatches) {
      firstMismatch = step;
      break;
    }
    state = actualPostState;
  }
  return {
    matchedDecisionCount: steps.filter((step) => step.postExactMatches).length,
    firstMismatch,
    steps,
  };
}

function stateKeyFingerprint(key) {
  if (!key) return null;
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 16);
}

function main() {
  const project = loadProject(PROJECT_ROOT);
  const spec = getMilestoneSpec(project, ROUTE_NAME);
  const trackedInitialState = replayFixture(makeSimulator(project));
  const mt5Result = runGraph(
    makeSimulator(project),
    trackedInitialState,
    MT4_START,
    MT5_START,
    spec,
  );
  assert.strictEqual(mt5Result.found, true);
  const mt5Expansions = totalExpansions(summarizeSegments(mt5Result));
  assert.strictEqual(mt5Expansions, EXPECTED_MT5_EXPANSIONS);

  const postMt5State = mt5Result.finalCandidate.state;
  const specialResult = runGraph(
    makeSimulator(project),
    postMt5State,
    MT5_START,
    SPECIAL80,
    spec,
  );
  assert.strictEqual(specialResult.found, true);
  const specialExpansions = totalExpansions(summarizeSegments(specialResult));
  assert.strictEqual(specialExpansions, EXPECTED_SPECIAL80_EXPANSIONS);
  const specialReplay = buildStrictReplayEvidence(
    project,
    postMt5State,
    specialResult,
  );
  assert.strictEqual(specialReplay.valid, true);
  const specialState = specialResult.finalCandidate.state;
  assert.strictEqual(
    exactStateFingerprint(specialState),
    EXPECTED_SPECIAL80_FINGERPRINT,
  );

  const startedAt = Date.now();
  const result = runGraph(
    makeSimulator(project),
    specialState,
    SPECIAL80,
    MT8_TARGET,
    spec,
  );
  const wallMs = Date.now() - startedAt;
  assert.strictEqual(result.found, true);
  assert.strictEqual(result.reachedMilestone, MT8_TARGET);
  assert.deepStrictEqual(
    result.segmentResults.map((segment) => segment.segmentId),
    [TARGET, "mt7-right-exp-crystal", MT8_TARGET],
  );

  const finalState = result.finalCandidate.state;
  const prefixLength = specialState.route.length;
  const fullRoute = result.finalCandidate.route.slice();
  const routeSuffix = fullRoute.slice(prefixLength);
  finalState.route = routeSuffix.slice();
  let observed = null;
  let routeRecordError = null;
  try {
    buildRouteRecord({
      project,
      simulator: makeSimulator(project),
      initialState: specialState,
      finalState,
      options: {
        projectRoot: PROJECT_ROOT,
        solver: "mt7-mt8-strict-replay-attribution",
        profile: "strict-special80-to-mt8",
        rank: "chaos",
        toFloor: "MT8",
        goalType: "milestoneReached",
        snapshotFloors: ["MT6", "MT7", "MT8"],
        routeRecordObserver(payload) {
          observed = payload;
        },
      },
    });
  } catch (error) {
    routeRecordError = String(error && error.message || error);
  }
  assert.ok(observed && observed.decisions, "route-record observer evidence");
  const continuity = continuityEvidence(
    observed.initialState,
    observed.decisions,
    routeSuffix.map((entry) => typeof entry === "string" ? entry : entry.summary),
  );
  const replay = replayAttribution(
    project,
    observed.initialState,
    observed.decisions,
  );
  assert.strictEqual(
    routeRecordError,
    "route-store: strict replay post-state mismatch at decision 13",
  );
  assert.strictEqual(continuity.continuous, true);
  assert.strictEqual(continuity.summaryParity, true);
  assert.strictEqual(replay.matchedDecisionCount, 12);
  assert.strictEqual(replay.firstMismatch.decision, 13);
  assert.strictEqual(replay.firstMismatch.summary, "changeFloor@MT7:6,0");
  assert.strictEqual(replay.firstMismatch.preExactMatches, true);
  assert.strictEqual(replay.firstMismatch.resolver.stateMutated, false);
  assert.ok(
    replay.firstMismatch.aliasCollision.uniqueVariantCount > 1,
    "decision 13 fingerprint must alias multiple replay variants",
  );
  assert.ok(
    replay.firstMismatch.aliasCollision.exactPostMatchCount > 0,
    "a non-deduplicated decision 13 candidate must reproduce the winner post-state",
  );

  const verdict = {
    cause: "recorded-action-fingerprint-alias-dedup",
    prefixOrLineageMismatch: false,
    resolverInputMutation: false,
    simulatorCannotReproduceWinnerEdge: false,
    matchingVariantExistsBeforeFingerprintDedup: true,
    detail:
      "decision 13 has multiple changeFloor candidates with the same recorded fingerprint; strict replay keeps only the first fingerprint alias, while a discarded alias reproduces the recorded winner post-state",
  };

  process.stdout.write(`${JSON.stringify({
    schema: "motapathfinder.mt7-mt8-strict-replay-attribution.v1",
    status: "observed",
    controls: {
      frozenStartExactStateFingerprint: EXPECTED_SPECIAL80_FINGERPRINT,
      candidateLimit: 8,
      perSegmentMaxExpansions: MAX_EXPANSIONS_PER_SEGMENT,
      maxRuntimeMs: 0,
      productionMilestoneGraphChanged: false,
      productionDpKeyChanged: false,
      productionDominanceChanged: false,
      productionSelectionChanged: false,
    },
    frozenStart: {
      mt5Expansions,
      specialExpansions,
      strictReplay: specialReplay,
    },
    search: {
      found: result.found,
      reachedMilestone: result.reachedMilestone,
      wallMs,
      segments: result.segmentResults.map((segment) => ({
        id: segment.segmentId,
        found: segment.found,
        attempts: segment.attempts.map((attempt) => ({
          found: attempt.found,
          expansions: Number((((attempt || {}).diagnostics || {}).dp || {}).expansions || 0),
          expansionBudgetExhausted:
            ((((attempt || {}).diagnostics || {}).dp || {}).expansionBudgetExhausted) === true,
        })),
      })),
      fullRouteCount: fullRoute.length,
      prefixCount: prefixLength,
      routeSuffixCount: routeSuffix.length,
      finalExactStateFingerprint: exactStateFingerprint(finalState),
    },
    routeRecord: {
      error: routeRecordError,
      reconstructedMatchesWinner:
        observed.expectedExactStateKey === observed.reconstructedExactStateKey,
      continuity,
    },
    replay: {
      matchedDecisionCount: replay.matchedDecisionCount,
      firstMismatch: replay.firstMismatch,
    },
    verdict,
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = {
  main,
  replayAttribution,
};
