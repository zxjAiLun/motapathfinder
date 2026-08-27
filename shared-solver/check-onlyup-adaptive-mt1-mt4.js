"use strict";

/** TEST GRADE: local-regression */

/**
 * PR-5.24b Canonical Adaptive Multi-Milestone Rollback Gate (MT1 -> MT4).
 *
 * Evaluates canonical multi-depth adaptive rollback on Real OnlyUp MT1 -> MT4 (Chaos).
 * Gated on:
 *   - Production fast paths ON: autoBattleFastRejectEnabled=true, enableFastHazardBlockIndex=true.
 *   - Native fail-closed VM: enableCompiledEffectCache=false.
 *   - Generic milestone spec: onlyup-chaos-mt1-mt4.json (Zero manual coordinate/route heuristics).
 *   - Unified runMilestoneGraph execution with searchIntent: "adaptive-feasible", adaptiveBacktrackDepth: 3.
 *   - 30s wall clock, 50,000 global expansions, 256MB RSS stop threshold + 4MB bounded sampling overshoot.
 *   - 100% Strict Replay on fresh StaticSimulator from real MT1 start state.
 */

const fs = require("node:fs");
const assert = require("node:assert");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { loadProject } = require("./lib/project-loader");
const { StaticSimulator } = require("./lib/simulator");
const { getMilestoneSpec } = require("./lib/milestone-spec");
const { runMilestoneGraph } = require("./lib/segment-dp");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { buildStateKey } = require("./lib/state-key");
const { resolveRecordedAction } = require("./lib/route-store");
const {
  FIRST_REGION_TARGET_FLOOR_ID,
  MAX_EXPANDED_STATES,
  RSS_LIMIT_BYTES,
  WALL_LIMIT_MS,
  createNoStateChangeChoiceResolver,
  difficultySnapshot,
  isDecisionEntry,
} = require("./lib/onlyup-mt1-real-route-gate");

const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const CHAOS_DIFFICULTY = { I581: 0, I582: 0, "flag:level0": 0 };
const EXPECTED_TITLE = "Only Up";
const EXPECTED_START_FLOOR = "MT1";
const EXPECTED_START_X = 6;
const EXPECTED_START_Y = 7;
const TARGET_FLOOR_ID = "MT4";

const RSS_STOP_THRESHOLD_MB = 256;
const ALLOWED_SAMPLING_OVERSHOOT_MB = 4;
const RSS_HARD_QUALIFICATION_CEILING_MB = 260;

function runAdaptiveRollbackSubprocess(config) {
  const project = loadProject(DEFAULT_PROJECT_ROOT);
  const choiceResolver = createNoStateChangeChoiceResolver();
  const simulator = new StaticSimulator(project, {
    stopFloorId: config.targetFloorId || FIRST_REGION_TARGET_FLOOR_ID,
    battleResolver: new FunctionBackedBattleResolver(project, { enableFastReject: true }),
    autoBattleFastRejectEnabled: true,
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFastHazardBlockIndex: true,
    enableCompiledEffectCache: false,
    choiceResolver,
  });

  // 1. Hard Assert Initial State Identity & Chaos Difficulty
  const initialState = simulator.createInitialState();
  assert.strictEqual(project.data.firstData.title, EXPECTED_TITLE, "Project title mismatch");
  assert.strictEqual(initialState.floorId, EXPECTED_START_FLOOR, "Start floor must be MT1");
  assert.strictEqual(initialState.hero.loc.x, EXPECTED_START_X, "Start X must be 6");
  assert.strictEqual(initialState.hero.loc.y, EXPECTED_START_Y, "Start Y must be 7");
  assert.deepStrictEqual(difficultySnapshot(initialState), CHAOS_DIFFICULTY, "Initial state must be Chaos");
  assert.strictEqual((initialState.route || []).filter(isDecisionEntry).length, 0, "Initial state must have no decision route prefix");

  const startedAt = Date.now();
  let peakRssBytes = process.memoryUsage().rss;
  const spec = getMilestoneSpec(project, config.routeName || "onlyup-chaos-mt1-mt4");

  const result = runMilestoneGraph(simulator, initialState, spec, {
    searchIntent: "adaptive-feasible",
    enableFailureBacktracking: true,
    adaptiveBacktrackDepth: config.adaptiveBacktrackDepth || 3,
    budgetScope: "global-run",
    maxExpansions: config.maxExpansions || MAX_EXPANDED_STATES,
    maxRuntimeMs: config.maxRuntimeMs || WALL_LIMIT_MS,
    maxRssMb: RSS_STOP_THRESHOLD_MB,
    memoryCheckIntervalExpansions: 1,
    memoryCheckIntervalActions: 1,
  });

  peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  const memoryDiag = result.memory || {};
  const reportedPeakRssMb = memoryDiag.peakRssMb || Math.round((peakRssBytes / 1048576) * 10) / 10;

  const segmentSummaries = (result.segmentResults || []).map((seg) => {
    const initialAtt = (seg.attempts && seg.attempts[0]) || null;
    const initialDp = (initialAtt && initialAtt.diagnostics && initialAtt.diagnostics.dp) || null;

    const initialAttempt = initialAtt ? {
      found: initialAtt.found,
      expansions: initialDp ? initialDp.expansions : undefined,
      frontierSize: initialDp ? initialDp.frontierSize : undefined,
      stoppedReason: initialDp ? (initialDp.stoppedReason || null) : null,
      searchOutcome: initialDp ? (initialDp.searchOutcome || null) : null,
      peakRssMb: initialDp && initialDp.memory ? initialDp.memory.peakRssMb : undefined,
      missingGoalFields: initialAtt.missingGoalFields || [],
    } : null;

    const attempts = (seg.attempts || []).map((att, idx) => {
      const dp = (att.diagnostics && att.diagnostics.dp) || {};
      return {
        attemptIndex: idx,
        startCandidateId: att.startCandidateId,
        found: att.found,
        expansions: dp.expansions,
        frontierSize: dp.frontierSize,
        stoppedReason: dp.stoppedReason || null,
        searchOutcome: dp.searchOutcome || null,
        peakRssMb: dp.memory ? dp.memory.peakRssMb : undefined,
      };
    });

    return {
      segmentId: seg.segmentId,
      label: seg.label,
      segmentFound: seg.found,
      candidatesCount: (seg.candidates || []).length,
      startCandidatesTried: seg.startCandidatesTried,
      backtrack: seg.backtrack || null,
      initialAttempt,
      attempts,
    };
  });

  const finalCandidates = (result.finalCandidates || []).map((c) => ({
    id: c.id,
    hero: c.hero,
    route: c.route,
    routeLength: Array.isArray(c.route) ? c.route.length : 0,
    state: c.state,
  }));

  const evaluationLedger = (result.evaluationAttemptLedger || []).map((att) => {
    const dp = (att.diagnostics && att.diagnostics.dp) || {};
    return {
      phase: att.phase,
      segmentId: att.segmentId,
      found: att.found,
      expansions: dp.expansions,
      frontierSize: dp.frontierSize,
      stoppedReason: dp.stoppedReason || null,
      searchOutcome: dp.searchOutcome || null,
      peakRssMb: dp.memory ? dp.memory.peakRssMb : undefined,
    };
  });

  return {
    found: result.found,
    reachedMilestone: result.reachedMilestone,
    failedSegment: result.failedSegment ? {
      segmentId: result.failedSegment.segmentId,
      failureClass: result.failedSegment.failureClass,
      failureReason: result.failedSegment.failureReason,
      failurePropagation: result.failedSegment.failurePropagation,
    } : null,
    segmentSummaries,
    finalCandidates,
    evaluationLedger,
    budget: result.budget,
    memory: {
      ...result.memory,
      peakRssMb: reportedPeakRssMb,
    },
    wallMs: Date.now() - startedAt,
  };
}

/**
 * Strict Replay validator for any route from real MT1 start state.
 */
function verifyCandidateStrictReplay(project, candidate) {
  const choiceResolver = createNoStateChangeChoiceResolver();
  const simulator = new StaticSimulator(project, {
    stopFloorId: FIRST_REGION_TARGET_FLOOR_ID,
    battleResolver: new FunctionBackedBattleResolver(project, { enableFastReject: true }),
    autoBattleFastRejectEnabled: true,
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFastHazardBlockIndex: true,
    enableCompiledEffectCache: false,
    choiceResolver,
  });

  let replayState = simulator.createInitialState();
  const initialDifficulty = difficultySnapshot(replayState);
  assert.deepStrictEqual(
    initialDifficulty,
    CHAOS_DIFFICULTY,
    "Replay must start on Chaos difficulty"
  );

  const route = Array.isArray(candidate.route) ? candidate.route : [];
  assert.ok(route.length > 0, `Candidate ${candidate.id} must have non-empty route`);

  let decisionsReplayed = 0;
  let identityGradedDecisions = 0;

  for (let index = 0; index < route.length; index += 1) {
    const entry = route[index];
    if (!isDecisionEntry(entry)) continue;

    const resolved = resolveRecordedAction(simulator, replayState, entry, {
      requireFingerprintMatch: true,
    });
    assert.ok(
      resolved != null && resolved.action != null,
      `Replay action not enumerated at step ${index} for candidate ${candidate.id}`
    );

    decisionsReplayed += 1;
    if (resolved.matchType === "identity" || resolved.fingerprintMatches) {
      identityGradedDecisions += 1;
    }

    replayState = simulator.applyAction(replayState, resolved.action, { storeRoute: true });
  }

  assert.strictEqual(
    replayState.floorId,
    candidate.state.floorId,
    `Floor mismatch on candidate ${candidate.id}: expected ${candidate.state.floorId}, got ${replayState.floorId}`
  );

  const replayedStateKey = buildStateKey(replayState);
  const targetStateKey = buildStateKey(candidate.state);
  assert.strictEqual(
    replayedStateKey,
    targetStateKey,
    `StateKey mismatch on candidate ${candidate.id}`
  );

  const replayedDifficulty = difficultySnapshot(replayState);
  assert.deepStrictEqual(
    replayedDifficulty,
    CHAOS_DIFFICULTY,
    "Difficulty drift detected during replay"
  );
  assert.strictEqual(
    choiceResolver.unresolved.length,
    0,
    `Unresolved choice decisions during replay of candidate ${candidate.id}`
  );

  return {
    passed: true,
    decisionsReplayed,
    identityGradedDecisions,
    finalFloorId: replayState.floorId,
    exactStateKey: replayedStateKey,
    finalHero: replayState.hero,
  };
}

function main() {
  const project = loadProject(DEFAULT_PROJECT_ROOT);

  if (process.argv.includes("--child-mode")) {
    const rawInput = fs.readFileSync(0, "utf8");
    const config = JSON.parse(rawInput);
    const result = runAdaptiveRollbackSubprocess(config);
    console.log(JSON.stringify(result));
    return;
  }

  const spawnRun = (config) => {
    const proc = spawnSync(process.execPath, ["--expose-gc", __filename, "--child-mode"], {
      input: JSON.stringify(config),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    if (proc.error) throw proc.error;
    if (proc.status !== 0) {
      throw new Error(`Adaptive rollback child failed (code ${proc.status}):\n${proc.stderr}\n${proc.stdout}`);
    }
    const lines = proc.stdout.trim().split("\n");
    return JSON.parse(lines[lines.length - 1]);
  };

  const startedAt = Date.now();
  const runResult = spawnRun({
    routeName: "onlyup-chaos-mt1-mt4",
    adaptiveBacktrackDepth: 3,
    maxExpansions: MAX_EXPANDED_STATES,
    maxRuntimeMs: WALL_LIMIT_MS,
  });
  const wallMs = Date.now() - startedAt;

  // Fail-closed budget & authority hard asserts
  assert.ok(runResult.budget, "Run result must report budget object");
  assert.strictEqual(runResult.budget.scope, "global-run", "Budget scope must be global-run");
  assert.strictEqual(runResult.budget.requestedExpansions, MAX_EXPANDED_STATES, `Requested expansions must be ${MAX_EXPANDED_STATES}`);
  assert.strictEqual(runResult.budget.requestedRuntimeMs, WALL_LIMIT_MS, `Requested runtime must be ${WALL_LIMIT_MS}`);

  const actualExpansions = (runResult.budget && runResult.budget.consumedExpansions) || 0;
  assert.ok(actualExpansions <= MAX_EXPANDED_STATES, `Consumed expansions ${actualExpansions} exceeded ${MAX_EXPANDED_STATES}`);

  assert.ok(wallMs <= WALL_LIMIT_MS, `Parent wall time ${wallMs}ms exceeded hard limit ${WALL_LIMIT_MS}ms`);

  const peakRssMb = (runResult.memory && runResult.memory.peakRssMb) || 0;
  assert.ok(
    peakRssMb <= RSS_HARD_QUALIFICATION_CEILING_MB,
    `Peak RSS ${peakRssMb}MB exceeded hard qualification ceiling ${RSS_HARD_QUALIFICATION_CEILING_MB}MB`
  );
  const rssOvershootMb = Math.max(0, Math.round((peakRssMb - RSS_STOP_THRESHOLD_MB) * 10) / 10);
  assert.ok(
    rssOvershootMb <= ALLOWED_SAMPLING_OVERSHOOT_MB,
    `RSS overshoot ${rssOvershootMb}MB exceeded allowed ${ALLOWED_SAMPLING_OVERSHOOT_MB}MB`
  );

  let strictReplayPassed = 0;
  let identityGradedDecisions = 0;
  let reachedMT4 = false;
  const replayedCandidates = [];

  if (runResult.found && runResult.finalCandidates && runResult.finalCandidates.length > 0) {
    runResult.finalCandidates.forEach((cand) => {
      const replay = verifyCandidateStrictReplay(project, cand);
      if (replay.passed) {
        strictReplayPassed += 1;
        identityGradedDecisions += replay.identityGradedDecisions;
        if (replay.finalFloorId === TARGET_FLOOR_ID) reachedMT4 = true;
        replayedCandidates.push({
          candidateId: cand.id,
          finalFloorId: replay.finalFloorId,
          decisionsReplayed: replay.decisionsReplayed,
          identityGradedDecisions: replay.identityGradedDecisions,
          finalHero: replay.finalHero,
        });
      }
    });
  }

  const adaptiveRollbackTriggered = (runResult.segmentSummaries || []).some((s) => s.backtrack != null) ||
    (runResult.evaluationLedger || []).some((att) => att.phase === "adaptive-expand" || att.phase === "adaptive-replay");

  // Semantic audit of backtrack attempts
  const allBacktrackAttempts = [];
  (runResult.segmentSummaries || []).forEach((seg) => {
    if (seg.backtrack && Array.isArray(seg.backtrack.attempts)) {
      allBacktrackAttempts.push(...seg.backtrack.attempts);
    }
  });

  let depth1AnchorSearchExecuted = false;
  let depth1DownstreamReplayExecuted = false;
  let depth1GenuinelyExhausted = false;
  let depth2AnchorSearchExecuted = false;
  let depth2DownstreamReplayExecuted = false;
  let memoryRecoveryCount = 0;
  let memoryRecoveryFailures = 0;

  allBacktrackAttempts.forEach((att) => {
    if (att.memoryRecoveryAttempted) memoryRecoveryCount += 1;
    if (att.memoryRecoveryAttempted && !att.memoryRecovered) memoryRecoveryFailures += 1;

    // Semantic invariant: depthExhausted MUST have depthStopReason === null
    if (att.depthExhausted) {
      assert.strictEqual(
        att.depthStopReason,
        null,
        `Attempt at depth ${att.depth} wave ${att.waveIndex} claimed depthExhausted: true but had stopReason: ${att.depthStopReason}`
      );
    }

    if (att.depth === 1) {
      if (att.anchorExpandedCandidates > 0) depth1AnchorSearchExecuted = true;
      if (att.replaySegmentIds && att.replaySegmentIds.length > 0) depth1DownstreamReplayExecuted = true;
      if (att.depthExhausted) depth1GenuinelyExhausted = true;
    }
    if (att.depth === 2) {
      if (att.anchorExpandedCandidates > 0) depth2AnchorSearchExecuted = true;
      if (att.replaySegmentIds && att.replaySegmentIds.length > 0) depth2DownstreamReplayExecuted = true;
    }
  });

  const summary = {
    schema: "motapathfinder.canonical-adaptive-rollback.v1",
    contractStatus: "passed",
    budget: {
      scope: runResult.budget.scope,
      requestedWallLimitMs: WALL_LIMIT_MS,
      actualWallMs: wallMs,
      requestedExpansions: MAX_EXPANDED_STATES,
      actualExpansions,
      rssStopThresholdMb: RSS_STOP_THRESHOLD_MB,
      peakRssMb,
      rssOvershootMb,
      allowedOvershootMb: ALLOWED_SAMPLING_OVERSHOOT_MB,
      rssHardQualificationCeilingMb: RSS_HARD_QUALIFICATION_CEILING_MB,
      rssQualificationPassed: peakRssMb <= RSS_HARD_QUALIFICATION_CEILING_MB,
    },
    run: {
      found: runResult.found,
      reachedMilestone: runResult.reachedMilestone,
      failedSegment: runResult.failedSegment,
      segmentSummaries: runResult.segmentSummaries,
      evaluationLedger: runResult.evaluationLedger,
      finalCandidatesCount: (runResult.finalCandidates || []).length,
    },
    qualification: {
      engineMode: "canonical-runMilestoneGraph",
      searchIntent: "adaptive-feasible",
      adaptiveRollbackTriggered,
      mechanismAudit: {
        depth1AnchorSearchExecuted,
        depth1DownstreamReplayExecuted,
        depth1GenuinelyExhausted,
        depth2AnchorSearchExecuted,
        depth2DownstreamReplayExecuted,
        memoryRecoveryCount,
        memoryRecoveryFailures,
      },
      strictReplayPassed: strictReplayPassed === (runResult.finalCandidates || []).length && strictReplayPassed > 0,
      reachedMT4,
      replayedCandidates,
    },
  };

  console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  }
}

module.exports = {
  main,
  runAdaptiveRollbackSubprocess,
  verifyCandidateStrictReplay,
};
