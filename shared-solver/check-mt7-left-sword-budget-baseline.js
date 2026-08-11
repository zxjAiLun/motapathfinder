"use strict";

/**
 * TEST GRADE: real-fixture-failure-baseline
 *
 * PR-5.8c starts from the strict-replay-qualified special80 state produced by
 * PR-5.8b and observes mt7-left-sword under the same deterministic 500
 * expansion budget. The goal is found while the skyline remains incomplete.
 * This check records the live frontier and goal-progress diagnostics without
 * changing checkpoint, budget, key, dominance, or selection behavior.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { getMilestoneSpec } = require("./lib/milestone-spec");
const { loadProject } = require("./lib/project-loader");
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

const SPECIAL80 = "mt7-special80-ready";
const TARGET = "mt7-left-sword";
const EXPECTED_SPECIAL80_FINGERPRINT = "0564b870200d0113";
const EXPECTED_SPECIAL80_ROUTE_FINGERPRINT =
  "e0ea77ee5dc4faa829d0a897dfd5a6fc7f6d1c1b08371789b01b9b7d3912d64a";
const EXPECTED_MT5_EXPANSIONS = 645;
const EXPECTED_SPECIAL80_EXPANSIONS = 508;
const USER_BASELINE_FILE = path.join(
  __dirname,
  "fixtures",
  "onlyup-mt7-user-baseline.json",
);

function sumValues(record) {
  return Object.values(record || {}).reduce(
    (sum, value) => sum + Number(value || 0),
    0,
  );
}

function failedSegmentId(result) {
  return typeof result.failedSegment === "string"
    ? result.failedSegment
    : result.failedSegment && result.failedSegment.segmentId;
}

function summarizeAttempt(attempt) {
  const diagnostics = attempt.diagnostics || {};
  const dp = diagnostics.dp || {};
  const failure = diagnostics.failure || {};
  const statProgress = dp.statProgress || {};
  const closestGoalState = statProgress.closestGoalState || null;
  return {
    found: attempt.found === true,
    expansions: Number(dp.expansions || 0),
    generated: sumValues(dp.actionsGeneratedByKind),
    accepted: Number(dp.acceptedStates || 0),
    dominanceRejected:
      Number(dp.rejectedByHigherHp || 0) + Number(dp.sameHpRejected || 0),
    rejectedByHigherHp: Number(dp.rejectedByHigherHp || 0),
    sameHpRejected: Number(dp.sameHpRejected || 0),
    frontierSize: Number(dp.frontierSize || 0),
    wallMs: Number(dp.wallMs || 0),
    maxExpansions: Number(dp.maxExpansions || 0),
    maxRuntimeMs: Number(dp.maxRuntimeMs || 0),
    stoppedReason: dp.stoppedReason || null,
    actionTrimmed: Number(diagnostics.actionTrimmed || dp.actionTrimmed || 0),
    expansionBudgetExhausted: dp.expansionBudgetExhausted === true,
    searchOutcome: dp.searchOutcome || null,
    uniqueBattleTargets: Number(diagnostics.uniqueBattleTargets || 0),
    uniquePortalEntries: Number(diagnostics.uniquePortalEntries || 0),
    actionsGeneratedByKind: diagnostics.actionsGeneratedByKind || {},
    actionsExpandedByKind: diagnostics.actionsExpandedByKind || {},
    actionsKeptByKind: diagnostics.actionsKeptByKind || {},
    actionsDominatedByKind: diagnostics.actionsDominatedByKind || {},
    foundFirstGoal: dp.foundFirstGoal === true,
    firstGoalExpansion: dp.firstGoalExpansion == null
      ? null
      : Number(dp.firstGoalExpansion),
    goalSkylineCount: Number(dp.goalSkylineCount || 0),
    activeGoalCount: Number(dp.activeGoalCount || 0),
    goalNodeCount: Number(dp.goalNodeCount || 0),
    goalArchiveTrimmed: dp.goalArchiveTrimmed === true,
    goalProgress: closestGoalState
      ? {
          missingFieldCount: Number(closestGoalState.missingFieldCount || 0),
          deficitVector: closestGoalState.deficitVector || {},
          normalizedDeficitVector:
            closestGoalState.normalizedDeficitVector || {},
          hp: Number(closestGoalState.hp || 0),
          decisionDepth: Number(closestGoalState.decisionDepth || 0),
          routeTail: closestGoalState.routeTail || [],
        }
      : null,
    statProgress: {
      maxHeroSeen: statProgress.maxHeroSeen || {},
      firstStatGainExpansion: statProgress.firstStatGainExpansion || {},
      firstStatGainAction: statProgress.firstStatGainAction || {},
      acceptedStatesMeeting: statProgress.acceptedStatesMeeting || {},
      firstExpansionMeeting: statProgress.firstExpansionMeeting || {},
      maxHpAmongStatesMeeting: statProgress.maxHpAmongStatesMeeting || {},
    },
    resourceTiming: dp.resourceTiming || null,
    landmarkArchiveCount: Number(dp.landmarkArchiveCount || 0),
    failure: {
      failureClass: failure.failureClass || null,
      failureReason: failure.failureReason || null,
      missingGoalFields: failure.missingGoalFields || [],
      bestSeen: failure.bestSeen || null,
      preferredCandidateTags: failure.preferredCandidateTags || [],
      recommendedRepair: failure.recommendedRepair || null,
      failurePropagation: failure.failurePropagation || null,
      upstreamCheckpointIncompatible:
        failure.upstreamCheckpointIncompatible || [],
    },
  };
}

function knownRouteSuffix() {
  const fixture = JSON.parse(fs.readFileSync(USER_BASELINE_FILE, "utf8"));
  const route = Array.isArray(fixture.route) ? fixture.route : [];
  const start = route.indexOf("battle:redSwordsman@MT7:3,10");
  return {
    fixture: "fixtures/onlyup-mt7-user-baseline.json",
    diagnosticOnly: true,
    actionSuffix: route.slice(Math.max(0, start)),
  };
}

function captureStrictReplayEvidence(project, initialState, result) {
  try {
    return {
      attempted: true,
      ...buildStrictReplayEvidence(project, initialState, result),
      error: null,
    };
  } catch (error) {
    return {
      attempted: true,
      valid: false,
      error: String(error && error.message || error),
    };
  }
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
  assert.strictEqual(mt5Result.found, true, "tracked MT4 fixture closes MT5");
  const mt5Expansions = totalExpansions(summarizeSegments(mt5Result));
  assert.strictEqual(mt5Expansions, EXPECTED_MT5_EXPANSIONS, "MT5 prefix scale");

  const postMt5InitialState = mt5Result.finalCandidate.state;
  const specialResult = runGraph(
    makeSimulator(project),
    postMt5InitialState,
    MT5_START,
    SPECIAL80,
    spec,
  );
  assert.strictEqual(specialResult.found, true, "5.8b special80 checkpoint");
  assert.strictEqual(specialResult.reachedMilestone, SPECIAL80);
  const specialExpansions = totalExpansions(summarizeSegments(specialResult));
  assert.strictEqual(
    specialExpansions,
    EXPECTED_SPECIAL80_EXPANSIONS,
    "special80 prefix scale",
  );
  const specialReplay = buildStrictReplayEvidence(
    project,
    postMt5InitialState,
    specialResult,
  );
  assert.strictEqual(specialReplay.valid, true);
  assert.strictEqual(specialReplay.decisionCount, 24);
  assert.strictEqual(
    specialReplay.routeFingerprint,
    EXPECTED_SPECIAL80_ROUTE_FINGERPRINT,
  );
  const specialState = specialResult.finalCandidate.state;
  assert.strictEqual(
    exactStateFingerprint(specialState),
    EXPECTED_SPECIAL80_FINGERPRINT,
  );

  const isolatedStartedAt = Date.now();
  const isolatedResult = runGraph(
    makeSimulator(project),
    specialState,
    SPECIAL80,
    TARGET,
    spec,
  );
  const isolatedWallMs = Date.now() - isolatedStartedAt;
  assert.strictEqual(
    isolatedResult.found,
    true,
    "left-sword as terminal target closes from the exact special80 state",
  );
  assert.strictEqual(isolatedResult.reachedMilestone, TARGET);
  assert.strictEqual(isolatedResult.failedSegment, null);
  assert.strictEqual(isolatedResult.segmentResults.length, 1);
  const isolated = isolatedResult.segmentResults[0];
  assert.strictEqual(isolated.segmentId, TARGET);
  assert.strictEqual(isolated.found, true);
  const isolatedAttempts = isolated.attempts.map(summarizeAttempt);
  assert.strictEqual(isolatedAttempts.length, 1, "one exact frozen start state");
  assert.strictEqual(isolatedAttempts[0].actionTrimmed, 0);
  assert.notStrictEqual(isolatedAttempts[0].stoppedReason, "time-limit");
  assert.strictEqual(isolatedAttempts[0].expansionBudgetExhausted, true);
  assert.deepStrictEqual(isolatedAttempts[0].searchOutcome, {
    goalFound: true,
    frontierExhausted: false,
    budgetExhausted: true,
    searchComplete: false,
    outcomeClass: "goal-found-search-incomplete",
  });
  assert.strictEqual(isolatedAttempts[0].expansions, MAX_EXPANSIONS_PER_SEGMENT);
  assert.ok(isolatedAttempts[0].frontierSize > 0);
  const isolatedReplay = buildStrictReplayEvidence(
    project,
    specialState,
    isolatedResult,
  );
  assert.strictEqual(isolatedReplay.valid, true);
  assert.strictEqual(isolatedReplay.decisionCount, 8);
  assert.strictEqual(
    isolatedReplay.routeFingerprint,
    "a36088b72c1f0f28587f50cc9818b7a83171282fca99b8f272311bd1de926b84",
  );
  assert.strictEqual(
    isolatedReplay.finalExactStateFingerprint,
    "22e75aa45404c026",
  );
  assert.strictEqual(isolatedAttempts[0].generated, 2275);
  assert.strictEqual(isolatedAttempts[0].accepted, 799);
  assert.strictEqual(isolatedAttempts[0].dominanceRejected, 1477);
  assert.strictEqual(isolatedAttempts[0].frontierSize, 201);
  assert.strictEqual(
    isolatedAttempts[0].statProgress.acceptedStatesMeeting.fullGoal,
    158,
  );

  const runLongHorizon = process.argv.includes("--long-horizon");
  let longHorizonControl = {
    diagnosticOnly: true,
    run: false,
    requestedTarget: MT8_TARGET,
  };
  if (runLongHorizon) {
    const horizonStartedAt = Date.now();
    const result = runGraph(
      makeSimulator(project),
      specialState,
      SPECIAL80,
      MT8_TARGET,
      spec,
    );
    const horizonWallMs = Date.now() - horizonStartedAt;
    assert.ok(result.segmentResults.length >= 1, "long-horizon segment evidence");
    const leftSword = result.segmentResults[0];
    assert.strictEqual(leftSword.segmentId, TARGET);
    assert.strictEqual(leftSword.found, true, "left-sword is feasible in long horizon");
    assert.strictEqual(leftSword.attempts.length, 1, "one exact frozen start state");
    const attempt = summarizeAttempt(leftSword.attempts[0]);
    assert.strictEqual(attempt.expansions, MAX_EXPANSIONS_PER_SEGMENT);
    assert.strictEqual(attempt.maxRuntimeMs, 0);
    assert.strictEqual(attempt.actionTrimmed, 0);
    assert.strictEqual(attempt.expansionBudgetExhausted, true);
    assert.ok(attempt.frontierSize > 0, "live frontier remains at budget stop");
    assert.strictEqual(result.found, true, "diagnostic horizon reaches MT8 entry");
    assert.strictEqual(result.reachedMilestone, MT8_TARGET);
    assert.strictEqual(result.failedSegment, null);
    longHorizonControl = {
      diagnosticOnly: true,
      run: true,
      found: result.found,
      reachedMilestone: result.reachedMilestone,
      failedSegment: failedSegmentId(result),
      requestedTarget: MT8_TARGET,
      wallMs: horizonWallMs,
      strictReplay: captureStrictReplayEvidence(project, specialState, result),
      segments: result.segmentResults.map((segment) => ({
        id: segment.segmentId,
        found: segment.found,
        startCandidatesTried: segment.startCandidatesTried,
        startCandidatesAvailable: segment.startCandidatesAvailable,
        attempts: (segment.attempts || []).map(summarizeAttempt),
      })),
    };
  }

  process.stdout.write(`${JSON.stringify({
    schema: "motapathfinder.mt7-left-sword-budget-baseline.v1",
    status: "passed",
    controls: {
      trackedFixture: "routes/fixtures/mt1-mt4-hp6428-best.route.json",
      frozenStartMilestone: SPECIAL80,
      frozenStartExactStateFingerprint: EXPECTED_SPECIAL80_FINGERPRINT,
      candidateLimit: 8,
      goalSkylineLimit: 8,
      perSegmentMaxExpansions: MAX_EXPANSIONS_PER_SEGMENT,
      maxRuntimeMs: 0,
      stopOnFirstGoal: false,
      preserveSkylineRoles: true,
      priorityMode: "goal-directed",
      productionMilestoneGraphChanged: false,
      productionDpKeyChanged: false,
      productionDominanceChanged: false,
      productionSelectionChanged: false,
      timingDirectionalNotPinned: true,
    },
    frozenStart: {
      mt5Expansions,
      special80Expansions: specialExpansions,
      trackedMt4TotalExpansions: mt5Expansions + specialExpansions,
      strictReplay: specialReplay,
      hero: {
        hp: Number(specialState.hero.hp),
        atk: Number(specialState.hero.atk),
        def: Number(specialState.hero.def),
        mdef: Number(specialState.hero.mdef),
        lv: Number(specialState.hero.lv),
        exp: Number(specialState.hero.exp),
      },
    },
    isolatedTerminalControl: {
      found: isolatedResult.found,
      reachedMilestone: isolatedResult.reachedMilestone,
      wallMs: isolatedWallMs,
      strictReplay: isolatedReplay,
      finalExactStateFingerprint:
        exactStateFingerprint(isolatedResult.finalCandidate.state),
      startCandidatesTried: isolated.startCandidatesTried,
      startCandidatesAvailable: isolated.startCandidatesAvailable,
      candidates: isolated.candidates || [],
      attempts: isolatedAttempts,
    },
    longHorizonControl,
    knownRouteOrderingHypothesis: knownRouteSuffix(),
    attribution: {
      verdict: "FEASIBLE_GOAL_FOUND_WITH_INCOMPLETE_SKYLINE",
      isolatedLeftSwordReached: true,
      longHorizonLeftSwordReached: runLongHorizon ? true : null,
      noActionTrimming: true,
      liveFrontierAtBudgetStop: true,
      noWallTimeout: true,
      notANotFoundFailure: true,
      outcomeTaxonomyQualified: true,
      leftSwordStrictReplayQualified: true,
      longHorizonStrictReplayDeferred: true,
      repairDeferred: true,
    },
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = {
  EXPECTED_SPECIAL80_FINGERPRINT,
  SPECIAL80,
  TARGET,
  main,
  summarizeAttempt,
};
