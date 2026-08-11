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

const { strictReplayRoute } = require("./lib/agenda-policy-evaluation");
const { getMilestoneSpec } = require("./lib/milestone-spec");
const { loadProject } = require("./lib/project-loader");
const { buildReplayRouteFingerprint } = require("./lib/replay-resume-artifact");
const {
  applyResolvedAction,
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

function legacyChoiceFingerprintCandidates(simulator, state) {
  const candidates = enumerateRecordedActionCandidates(
    simulator,
    cloneState(state),
  ).actions;
  const seen = new Set();
  return candidates.filter((candidate) => {
    const fingerprint = normalizeAction(candidate).fingerprint;
    if (seen.has(fingerprint)) return false;
    seen.add(fingerprint);
    return true;
  });
}

function replayAttribution(project, initialState, decisions, options) {
  const config = options || {};
  const simulator = makeSimulator(project);
  let state = cloneState(initialState);
  const steps = [];
  let firstMismatch = null;
  for (let index = 0; index < decisions.length; index += 1) {
    const decision = decisions[index];
    const pristinePreState = cloneState(state);
    const preExactStateKey = buildStateKey(state);
    const resolved = resolveRecordedAction(simulator, state, decision, {
      project,
      candidates: config.legacyChoiceFingerprintDedup
        ? legacyChoiceFingerprintCandidates(simulator, state)
        : undefined,
    });
    const postResolveExactStateKey = buildStateKey(state);
    const resolverMutatedState = postResolveExactStateKey !== preExactStateKey;
    const actionBeforeApply = compactAction(resolved.action);
    let actualPostState = null;
    let applyError = null;
    if (resolved.action) {
      try {
        actualPostState = applyResolvedAction(simulator, state, resolved).state;
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
        choiceAliasCount: Number(resolved.choiceAliasCount || 0),
        exactPostAliasCount: Number(resolved.exactPostAliasCount || 0),
        exactPostTieBroken: resolved.exactPostTieBroken === true,
        selectedByRecordedTravelEvidence:
          resolved.selectedByRecordedTravelEvidence === true,
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

  const winnerState = result.finalCandidate.state;
  const prefixLength = specialState.route.length;
  const fullRoute = result.finalCandidate.route.slice();
  const routeSuffix = fullRoute.slice(prefixLength);
  const suffixState = cloneState(winnerState);
  suffixState.route = routeSuffix.slice();
  let observed = null;
  let routeRecordError = null;
  let suffixRouteRecord = null;
  try {
    suffixRouteRecord = buildRouteRecord({
      project,
      simulator: makeSimulator(project),
      initialState: specialState,
      finalState: suffixState,
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
  const historicalReplay = replayAttribution(
    project,
    observed.initialState,
    observed.decisions,
    { legacyChoiceFingerprintDedup: true },
  );
  const repairedReplay = replayAttribution(
    project,
    observed.initialState,
    observed.decisions,
  );
  const suffixStrictReplay = strictReplayRoute(
    project,
    makeSimulator(project),
    suffixRouteRecord,
  );

  const fullState = cloneState(winnerState);
  fullState.route = fullRoute.slice();
  const fullRouteRecord = buildRouteRecord({
    project,
    simulator: makeSimulator(project),
    initialState: postMt5State,
    finalState: fullState,
    options: {
      projectRoot: PROJECT_ROOT,
      solver: "mt7-mt8-travel-variant-replay-repair",
      profile: "post-mt5-to-mt8-full-lineage",
      rank: "chaos",
      toFloor: "MT8",
      goalType: "milestoneReached",
      snapshotFloors: ["MT5", "MT6", "MT7", "MT8"],
    },
  });
  const compareReplayFastPath = process.argv.includes("--compare-replay-fast-path");
  const legacyReplayStartedAt = Date.now();
  const legacyFullStrictReplay = compareReplayFastPath
    ? strictReplayRoute(
        project,
        makeSimulator(project),
        fullRouteRecord,
        {
          reuseResolvedPostState: false,
          applyStructuralFilterBeforeCandidateApply: false,
        },
      )
    : null;
  const legacyReplayWallMs = compareReplayFastPath
    ? Date.now() - legacyReplayStartedAt
    : null;
  const optimizedReplayStartedAt = Date.now();
  const optimizedFullStrictReplay = strictReplayRoute(
    project,
    makeSimulator(project),
    fullRouteRecord,
    { reuseResolvedPostState: true },
  );
  const optimizedReplayWallMs = Date.now() - optimizedReplayStartedAt;
  const fullStrictReplay = optimizedFullStrictReplay;

  assert.strictEqual(routeRecordError, null);
  assert.ok(suffixRouteRecord, "repaired suffix route record");
  assert.strictEqual(continuity.continuous, true);
  assert.strictEqual(continuity.summaryParity, true);
  assert.strictEqual(historicalReplay.matchedDecisionCount, 12);
  assert.strictEqual(historicalReplay.firstMismatch.decision, 13);
  assert.strictEqual(historicalReplay.firstMismatch.summary, "changeFloor@MT7:6,0");
  assert.strictEqual(historicalReplay.firstMismatch.preExactMatches, true);
  assert.strictEqual(historicalReplay.firstMismatch.resolver.stateMutated, false);
  assert.ok(
    historicalReplay.firstMismatch.aliasCollision.uniqueVariantCount > 1,
    "decision 13 fingerprint must alias multiple replay variants",
  );
  assert.ok(
    historicalReplay.firstMismatch.aliasCollision.exactPostMatchCount > 0,
    "a non-deduplicated decision 13 candidate must reproduce the winner post-state",
  );
  assert.strictEqual(repairedReplay.firstMismatch, null);
  assert.strictEqual(repairedReplay.matchedDecisionCount, 13);
  const repairedDecision13 = repairedReplay.steps[12];
  assert.strictEqual(repairedDecision13.postExactMatches, true);
  assert.strictEqual(repairedDecision13.resolver.choiceAliasCount, 3);
  assert.strictEqual(repairedDecision13.resolver.exactPostAliasCount, 1);
  assert.strictEqual(repairedDecision13.resolver.action.pathLength, 17);
  assert.strictEqual(suffixRouteRecord.decisions.length, 13);
  assert.strictEqual(suffixStrictReplay.valid, true);
  assert.strictEqual(suffixStrictReplay.stepsCompleted, 13);
  assert.strictEqual(fullRouteRecord.decisions.length, 37);
  assert.strictEqual(fullStrictReplay.valid, true);
  assert.strictEqual(fullStrictReplay.stepsCompleted, 37);
  assert.strictEqual(optimizedFullStrictReplay.valid, true);
  assert.strictEqual(optimizedFullStrictReplay.resolvedPostStatesReused, 37);
  assert.strictEqual(optimizedFullStrictReplay.resolvedPostStatesApplied, 0);
  assert.ok(
    optimizedFullStrictReplay.resolverHardFilteredBeforeApply > 0,
    "real full replay must reject structurally impossible candidates before apply",
  );
  if (compareReplayFastPath) {
    assert.strictEqual(legacyFullStrictReplay.valid, true);
    assert.strictEqual(
      legacyFullStrictReplay.actualStateKey,
      optimizedFullStrictReplay.actualStateKey,
    );
    assert.strictEqual(
      legacyFullStrictReplay.resolvedPostStatesReused,
      0,
    );
    assert.strictEqual(
      legacyFullStrictReplay.resolvedPostStatesApplied,
      37,
    );
    assert.strictEqual(
      legacyFullStrictReplay.resolverCandidateApplyCount,
      optimizedFullStrictReplay.resolverCandidateApplyCount +
        legacyFullStrictReplay.resolverHardFilteredAfterApply,
    );
  }
  assert.strictEqual(
    fullRouteRecord.final.exactStateKey,
    buildStateKey(winnerState),
  );

  const historicalVerdict = {
    cause: "recorded-action-fingerprint-alias-dedup",
    prefixOrLineageMismatch: false,
    resolverInputMutation: false,
    simulatorCannotReproduceWinnerEdge: false,
    matchingVariantExistsBeforeFingerprintDedup: true,
    detail:
      "decision 13 has multiple changeFloor candidates with the same recorded fingerprint; strict replay keeps only the first fingerprint alias, while a discarded alias reproduces the recorded winner post-state",
  };

  const repairVerdict = {
    status: "MT8_STRICT_REPLAY_CLOSED",
    choiceFingerprintChanged: false,
    travelVariantsRetainedUntilPostStateResolution: true,
    suffixStrictReplayVerified: true,
    fullLineageStrictReplayVerified: true,
    finalExactStateVerified: true,
  };

  process.stdout.write(`${JSON.stringify({
    schema: "motapathfinder.mt7-mt8-travel-variant-replay-repair.v1",
    status: "passed",
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
      finalExactStateFingerprint: exactStateFingerprint(winnerState),
    },
    routeRecord: {
      error: routeRecordError,
      reconstructedMatchesWinner:
        observed.expectedExactStateKey === observed.reconstructedExactStateKey,
      continuity,
    },
    historicalAttribution: {
      matchedDecisionCount: historicalReplay.matchedDecisionCount,
      firstMismatch: historicalReplay.firstMismatch,
      verdict: historicalVerdict,
    },
    repairClosure: {
      suffix: {
        decisionCount: suffixRouteRecord.decisions.length,
        strictReplay: suffixStrictReplay.valid,
        routeFingerprint: buildReplayRouteFingerprint(suffixRouteRecord).sha256,
        repairedDecision13: {
          summary: repairedDecision13.summary,
          pathLength: repairedDecision13.resolver.action.pathLength,
          choiceAliasCount: repairedDecision13.resolver.choiceAliasCount,
          exactPostAliasCount: repairedDecision13.resolver.exactPostAliasCount,
          postExactMatches: repairedDecision13.postExactMatches,
        },
      },
      fullLineage: {
        decisionCount: fullRouteRecord.decisions.length,
        strictReplay: fullStrictReplay.valid,
        routeFingerprint: buildReplayRouteFingerprint(fullRouteRecord).sha256,
        replayCandidateApplyFastPath: {
          legacy: {
            wallMs: legacyReplayWallMs,
            selectedActionsReapplied:
              legacyFullStrictReplay
                ? legacyFullStrictReplay.resolvedPostStatesApplied
                : null,
            resolverCandidateApplyCount:
              legacyFullStrictReplay
                ? legacyFullStrictReplay.resolverCandidateApplyCount
                : null,
            hardFilteredBeforeApply:
              legacyFullStrictReplay
                ? legacyFullStrictReplay.resolverHardFilteredBeforeApply
                : null,
            hardFilteredAfterApply:
              legacyFullStrictReplay
                ? legacyFullStrictReplay.resolverHardFilteredAfterApply
                : null,
          },
          optimized: {
            wallMs: optimizedReplayWallMs,
            selectedPostStatesReused:
              optimizedFullStrictReplay.resolvedPostStatesReused,
            resolverCandidateApplyCount:
              optimizedFullStrictReplay.resolverCandidateApplyCount,
            hardFilteredBeforeApply:
              optimizedFullStrictReplay.resolverHardFilteredBeforeApply,
            hardFilteredAfterApply:
              optimizedFullStrictReplay.resolverHardFilteredAfterApply,
          },
          exactStateParity: compareReplayFastPath ? true : null,
          comparisonRequested: compareReplayFastPath,
          timingDirectionalNotPinned: true,
        },
      },
      finalExactStateFingerprint: exactStateFingerprint(winnerState),
      verdict: repairVerdict,
    },
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = {
  main,
  replayAttribution,
};
