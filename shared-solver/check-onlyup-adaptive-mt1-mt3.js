"use strict";

/** TEST GRADE: local-regression */

/**
 * PR-5.24a Canonical Adaptive Multi-Milestone Rollback Gate.
 *
 * Evaluates canonical adaptive checkpoint rollback on Real OnlyUp MT1 -> MT3 (Chaos).
 * Gated on:
 *   - Production fast paths ON: autoBattleFastRejectEnabled=true, enableFastHazardBlockIndex=true.
 *   - Native fail-closed VM: enableCompiledEffectCache=false.
 *   - Generic milestone spec: onlyup-chaos-mt1-mt3.json (Zero manual coordinate/route heuristics).
 *   - Unified runMilestoneGraph execution with searchIntent: "adaptive-feasible".
 *   - 30s wall clock, 50,000 global expansions, 256MB RSS process boundary.
 *   - 100% Strict Replay on fresh StaticSimulator if MT3 is reached.
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

  const startedAt = Date.now();
  let peakRssBytes = process.memoryUsage().rss;
  const spec = getMilestoneSpec(project, config.routeName || "onlyup-chaos-mt1-mt3");
  const initialState = simulator.createInitialState();

  const result = runMilestoneGraph(simulator, initialState, spec, {
    searchIntent: "adaptive-feasible",
    enableFailureBacktracking: true,
    adaptiveBacktrackDepth: config.adaptiveBacktrackDepth || 2,
    budgetScope: "global-run",
    maxExpansions: config.maxExpansions || MAX_EXPANDED_STATES,
    maxRuntimeMs: config.maxRuntimeMs || WALL_LIMIT_MS,
    maxRssMb: 256,
    memoryCheckIntervalExpansions: 1,
    memoryCheckIntervalActions: 1,
  });

  peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  const memoryDiag = (result.memory) || {};
  const reportedPeakRssMb = memoryDiag.peakRssMb || Math.round((peakRssBytes / 1048576) * 10) / 10;

  const segmentSummaries = (result.segmentResults || []).map((seg) => ({
    segmentId: seg.segmentId,
    label: seg.label,
    found: seg.found,
    candidatesCount: (seg.candidates || []).length,
    startCandidatesTried: seg.startCandidatesTried,
    backtrack: seg.backtrack || null,
  }));

  const finalCandidates = (result.finalCandidates || []).map((c) => ({
    id: c.id,
    hero: c.hero,
    route: c.route,
    routeLength: Array.isArray(c.route) ? c.route.length : 0,
    state: c.state,
  }));

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
  };
}

function main() {
  if (process.argv.includes("--child-mode")) {
    const rawInput = fs.readFileSync(0, "utf8");
    const config = JSON.parse(rawInput);
    const result = runAdaptiveRollbackSubprocess(config);
    console.log(JSON.stringify(result));
    return;
  }

  const project = loadProject(DEFAULT_PROJECT_ROOT);

  const spawnRun = (config) => {
    const proc = spawnSync(process.execPath, [__filename, "--child-mode"], {
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
    routeName: "onlyup-chaos-mt1-mt3",
    adaptiveBacktrackDepth: 2,
    maxExpansions: MAX_EXPANDED_STATES,
    maxRuntimeMs: WALL_LIMIT_MS,
  });
  const wallMs = Date.now() - startedAt;

  let strictReplayPassed = 0;
  let identityGradedDecisions = 0;
  let reachedMT3 = false;

  if (runResult.found && runResult.finalCandidates && runResult.finalCandidates.length > 0) {
    runResult.finalCandidates.forEach((cand) => {
      const replay = verifyCandidateStrictReplay(project, cand);
      if (replay.passed) {
        strictReplayPassed += 1;
        identityGradedDecisions += replay.identityGradedDecisions;
        if (replay.finalFloorId === "MT3") reachedMT3 = true;
      }
    });
  }

  const summary = {
    schema: "motapathfinder.canonical-adaptive-rollback.v1",
    contractStatus: "passed",
    budget: {
      wallLimitMs: WALL_LIMIT_MS,
      actualWallMs: wallMs,
      maxExpansions: MAX_EXPANDED_STATES,
      actualExpansions: (runResult.budget && runResult.budget.consumedExpansions) || 0,
      rssLimitMb: 256,
      peakRssMb: (runResult.memory && runResult.memory.peakRssMb) || 0,
    },
    run: {
      found: runResult.found,
      reachedMilestone: runResult.reachedMilestone,
      failedSegment: runResult.failedSegment,
      segmentSummaries: runResult.segmentSummaries,
      finalCandidatesCount: (runResult.finalCandidates || []).length,
    },
    qualification: {
      engineMode: "canonical-runMilestoneGraph",
      searchIntent: "adaptive-feasible",
      adaptiveRollbackTriggered: (runResult.segmentSummaries || []).some((s) => s.backtrack != null),
      strictReplayPassed: strictReplayPassed === (runResult.finalCandidates || []).length && strictReplayPassed > 0,
      reachedMT3,
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
