"use strict";

/**
 * PR-5.24b Iteration 6 Final Authority — three fresh-process arms.
 *
 *   A = anchor OFF / replay OFF          (baseline)
 *   E = anchor breadth wave-ordered ON / replay OFF
 *   F = anchor breadth wave-ordered ON / replay breadth top-n ON
 *
 * Frozen contracts: 30s / 50k / 256MB stop / 260 hard / candidateLimit 8 /
 * adaptiveDepth 3 / adaptiveWaveBatchSize production default (unset) /
 * milestoneFrontierResourceDiversity=true. ubuntu-24.04 / Node 20.20.2.
 *
 * This IS a capability authority round: FOUND triggers a fresh strict replay
 * (fresh simulator, correctly-wired choiceResolver, fingerprint match, exact
 * final StateKey, no difficulty drift, zero unresolved choices, MT4 reached).
 *
 * Intent-alternative execution proof (hard requirement):
 *   INTENT_ALTERNATIVE_INJECTED  — an anchor event injected a candidate;
 *   INTENT_ALTERNATIVE_WAVE_ATTEMPTED — that candidate appears in an adaptive
 *   attempt's anchorInputCandidateIds (the wave actually ran).
 * Without both, a "shape unchanged" E/F result is INVALID as repair evidence.
 */

const path = require("node:path");
const assert = require("node:assert");
const { spawnSync } = require("node:child_process");

const CHILD_SOURCE = `
"use strict";
const path = require("node:path");
const assert = require("node:assert");
const SOLVER_LIB = path.join(process.env.SOLVER_DIR, "lib");
const { loadProject } = require(path.join(SOLVER_LIB, "project-loader"));
const { StaticSimulator } = require(path.join(SOLVER_LIB, "simulator"));
const { FunctionBackedBattleResolver } = require(path.join(SOLVER_LIB, "battle-resolver"));
const { getMilestoneSpec } = require(path.join(SOLVER_LIB, "milestone-spec"));
const { runMilestoneGraph } = require(path.join(SOLVER_LIB, "segment-dp"));
const { buildStateKey } = require(path.join(SOLVER_LIB, "state-key"));
const { resolveRecordedAction } = require(path.join(SOLVER_LIB, "route-store"));
const {
  FIRST_REGION_TARGET_FLOOR_ID,
  createNoStateChangeChoiceResolver,
  difficultySnapshot,
  isDecisionEntry,
} = require(path.join(SOLVER_LIB, "onlyup-mt1-real-route-gate"));

const PROJECT_ROOT = path.resolve(process.env.SOLVER_DIR, "..", "Only upV2.1", "Only upV2.1");
const CHAOS_DIFFICULTY = { I581: 0, I582: 0, "flag:level0": 0 };
const TARGET_FLOOR_ID = "MT4";
const ARM = process.argv[2] || "A";
const ARMS = {
  A: { anchor: false, replay: false },
  E: { anchor: true, replay: false },
  F: { anchor: true, replay: true },
};
const arm = ARMS[ARM] || ARMS.A;

function buildSimulator(project, choiceResolver) {
  return new StaticSimulator(project, {
    stopFloorId: FIRST_REGION_TARGET_FLOOR_ID,
    battleResolver: new FunctionBackedBattleResolver(project, { enableFastReject: true }),
    autoBattleFastRejectEnabled: true,
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFastHazardBlockIndex: true,
    enableCompiledEffectCache: false,
    choiceResolver,
  });
}

function classifyRun(result) {
  const ledger = result.executionCompletionLedger || [];
  const pending = ledger.reduce((s, e) => s + Number(e.finalPending || 0), 0);
  const terminal = ledger.reduce((s, e) => s + Number(e.terminalIncomplete || 0), 0);
  const unknown = ledger.filter(
    (e) => e.searchComplete !== true && e.searchComplete !== false,
  ).length;
  const budgetStop = result.budget && result.budget.stoppedReason;
  const evalStops = new Set(
    (result.evaluationAttemptLedger || [])
      .map((att) => att.diagnostics && att.diagnostics.dp && att.diagnostics.dp.stoppedReason)
      .filter(Boolean),
  );
  const memoryStop = evalStops.has("rss-limit") || evalStops.has("heap-limit");
  const resourceStops = new Set(["rss-limit", "heap-limit", "time-limit", "expansion-limit"]);
  let finalCanonicalOutcome;
  if (result.found) finalCanonicalOutcome = "FOUND";
  else if (
    memoryStop || pending > 0 || (budgetStop && resourceStops.has(budgetStop))
  ) finalCanonicalOutcome = "RESOURCE_LIMITED";
  else if (terminal > 0 || unknown > 0) finalCanonicalOutcome = "INCOMPLETE_SCOPE";
  else if (result.cancelled) finalCanonicalOutcome = "CANCELLED";
  else finalCanonicalOutcome = "EXHAUSTED";
  return { pending, terminal, unknown, budgetStop, finalCanonicalOutcome };
}

function verifyCandidateStrictReplay(project, candidate) {
  const choiceResolver = createNoStateChangeChoiceResolver();
  const simulator = buildSimulator(project, choiceResolver);
  let replayState = simulator.createInitialState();
  assert.deepStrictEqual(
    difficultySnapshot(replayState),
    CHAOS_DIFFICULTY,
    "Replay must start on Chaos difficulty",
  );
  const route = Array.isArray(candidate.route) ? candidate.route : [];
  assert.ok(route.length > 0, "Candidate must have a non-empty route");
  let decisionsReplayed = 0;
  for (let index = 0; index < route.length; index += 1) {
    const entry = route[index];
    if (!isDecisionEntry(entry)) continue;
    const resolved = resolveRecordedAction(simulator, replayState, entry, {
      requireFingerprintMatch: true,
    });
    assert.ok(
      resolved != null && resolved.action != null,
      "Replay action not enumerated at step " + index + " for candidate " + candidate.id,
    );
    decisionsReplayed += 1;
    replayState = simulator.applyAction(replayState, resolved.action, { storeRoute: true });
  }
  assert.strictEqual(replayState.floorId, candidate.state.floorId, "Floor mismatch on candidate " + candidate.id);
  const replayedStateKey = buildStateKey(replayState);
  const targetStateKey = buildStateKey(candidate.state);
  assert.strictEqual(replayedStateKey, targetStateKey, "StateKey mismatch on candidate " + candidate.id);
  assert.deepStrictEqual(difficultySnapshot(replayState), CHAOS_DIFFICULTY, "Difficulty drift detected during replay");
  assert.strictEqual(
    choiceResolver.unresolved.length,
    0,
    "Unresolved choice decisions during replay of candidate " + candidate.id,
  );
  return { passed: true, decisionsReplayed, finalFloorId: replayState.floorId };
}

function main() {
  const project = loadProject(PROJECT_ROOT);
  const choiceResolver = createNoStateChangeChoiceResolver();
  const simulator = buildSimulator(project, choiceResolver);
  const spec = getMilestoneSpec(project, "onlyup-chaos-mt1-mt4");
  const initialState = simulator.createInitialState();

  const startedAt = Date.now();
  const result = runMilestoneGraph(simulator, initialState, spec, {
    searchIntent: "adaptive-feasible",
    segmentExecutionMode: "isolated-process",
    enableFailureBacktracking: true,
    adaptiveBacktrackDepth: 3,
    budgetScope: "global-run",
    maxExpansions: 50000,
    maxRuntimeMs: 30000,
    maxRssMb: 256,
    memoryCheckIntervalExpansions: 1,
    memoryCheckIntervalActions: 1,
    candidateLimit: 8,
    milestoneFrontierResourceDiversity: true,
    enableFailureIntentAnchorRanking: arm.anchor,
    enableFailureIntentReplayRanking: arm.replay,
    captureSelectionAudit: true,
  });
  const wallMs = Date.now() - startedAt;
  assert.strictEqual(choiceResolver.unresolved.length, 0, "main run must leave no unresolved choices");

  const cls = classifyRun(result);
  const failed = result.failedSegment || null;
  const backtrack = (failed && failed.backtrack) || null;
  const intentRanking = backtrack && backtrack.failureIntentRanking
    ? {
        anchorActivated: backtrack.failureIntentRanking.anchor
          ? Boolean(backtrack.failureIntentRanking.anchor.activated) : false,
        replayActivated: backtrack.failureIntentRanking.replay
          ? Boolean(backtrack.failureIntentRanking.replay.activated) : false,
        events: (backtrack.failureIntentRanking.events || []).map((e) => ({
          phase: e.phase,
          depth: e.depth,
          waveIndex: e.waveIndex,
          replaySegmentId: e.replaySegmentId,
          inputCandidateCount: e.inputCandidateCount,
          candidateLimit: e.candidateLimit,
          activated: e.activated,
          reason: e.reason || null,
          consumptionMode: e.consumptionMode || null,
          injectedCandidateId: e.injectedCandidateId || null,
          injectedIndex: e.injectedIndex != null ? e.injectedIndex : null,
          protectedLegacyPrefixSize: e.protectedLegacyPrefixSize != null ? e.protectedLegacyPrefixSize : null,
          firstEligibleWaveIndex: e.firstEligibleWaveIndex != null ? e.firstEligibleWaveIndex : null,
          waveBatchSize: e.waveBatchSize != null ? e.waveBatchSize : null,
          topCandidateBefore: e.topCandidateBefore,
          topCandidateAfter: e.topCandidateAfter,
          promotedCandidateIds: e.promotedCandidateIds,
          selectedCandidateIds: e.selectedCandidateIds,
          rankedCandidateIds: e.rankedCandidateIds || null,
          evidenceCandidates: e.evidenceCandidates || [],
        })),
      }
    : null;

  // ---- intent-alternative execution proof ----
  const injectedIds = new Set();
  (intentRanking ? intentRanking.events : []).forEach((event) => {
    if (event.phase === "adaptive-expand" && event.injectedCandidateId) {
      injectedIds.add(event.injectedCandidateId);
    }
  });
  const attemptCandidateIds = new Set();
  ((backtrack && backtrack.attempts) || []).forEach((attempt) => {
    (attempt.anchorInputCandidateIds || []).forEach((id) => attemptCandidateIds.add(id));
  });
  const attemptedInjected = Array.from(injectedIds).filter((id) => attemptCandidateIds.has(id));

  const ledger = result.executionCompletionLedger || [];
  const adaptivePhases = {};
  ledger.forEach((e) => { adaptivePhases[e.phase] = (adaptivePhases[e.phase] || 0) + 1; });

  let strictReplay = null;
  let reachedMT4 = false;
  if (result.found && result.finalCandidates && result.finalCandidates.length > 0) {
    const replays = [];
    for (const cand of result.finalCandidates) {
      const r = verifyCandidateStrictReplay(project, cand);
      replays.push({
        candidateId: cand.id,
        finalFloorId: r.finalFloorId,
        decisionsReplayed: r.decisionsReplayed,
      });
      if (r.finalFloorId === TARGET_FLOOR_ID) reachedMT4 = true;
    }
    strictReplay = { allPassed: true, candidates: replays, reachedMT4 };
  }

  process.stdout.write(JSON.stringify({
    arm,
    anchorIntent: arm.anchor,
    replayIntent: arm.replay,
    found: Boolean(result.found),
    finalCanonicalOutcome: cls.finalCanonicalOutcome,
    reachedMilestone: result.reachedMilestone || null,
    failedSegment: failed
      ? {
          segmentId: failed.segmentId || null,
          failureClass: failed.failureClass ||
            (failed.failurePropagation && failed.failurePropagation.primaryFailureClass) || null,
        }
      : null,
    budget: {
      stoppedReason: cls.budgetStop || null,
      consumedExpansions: result.budget ? result.budget.consumedExpansions : null,
    },
    wallMs,
    processTree: {
      peakRssMb: result.processTreeMemory
        ? result.processTreeMemory.maxAggregateConcurrentRssUpperBoundMb : null,
      qualified: result.processTreeMemory ? result.processTreeMemory.qualified : null,
    },
    runWide: {
      executions: ledger.length,
      finalPending: cls.pending,
      terminalIncomplete: cls.terminal,
      unknownCompletion: cls.unknown,
    },
    adaptive: {
      triggered: Boolean(backtrack && backtrack.attempted),
      phases: adaptivePhases,
      waveAttempts: (backtrack && backtrack.attempts) ? backtrack.attempts.length : 0,
      attemptAnchorInputCandidateIds: ((backtrack && backtrack.attempts) || [])
        .map((attempt) => attempt.anchorInputCandidateIds || []),
    },
    failureIntentRanking: intentRanking,
    intentAlternativeProof: {
      injected: injectedIds.size > 0,
      injectedCandidateIds: Array.from(injectedIds),
      waveAttempted: attemptedInjected.length > 0,
      attemptedInjectedCandidateIds: attemptedInjected,
    },
    strictReplay,
    reachedMT4,
  }) + "\\n");
}

main();
`;

const fs = require("node:fs");
const os = require("node:os");
const CHILD_PATH = path.join(os.tmpdir(), "iteration6d-final-child.js");
fs.writeFileSync(CHILD_PATH, CHILD_SOURCE);

function runRound(arm) {
  const res = spawnSync(
    process.execPath,
    ["--expose-gc", CHILD_PATH, arm],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 180000, env: { ...process.env, SOLVER_DIR: path.resolve(__dirname, "..", "..") } },
  );
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`arm ${arm} failed (${res.status}): ${res.stderr}\n${res.stdout}`);
  }
  const lines = res.stdout.trim().split("\n");
  return JSON.parse(lines[lines.length - 1]);
}

function main() {
  const arms = {};
  for (const arm of ["A", "E", "F"]) {
    const record = runRound(arm);
    arms[arm] = record;
    const proof = record.intentAlternativeProof || {};
    process.stderr.write(
      `${arm} (anchor=${record.anchorIntent}/replay=${record.replayIntent}): ` +
      `found=${record.found} outcome=${record.finalCanonicalOutcome} ` +
      `stop=${record.budget.stoppedReason} exp=${record.budget.consumedExpansions} ` +
      `wall=${record.wallMs} tree=${record.processTree.peakRssMb} ` +
      `pend=${record.runWide.finalPending} waves=${record.adaptive.waveAttempts} ` +
      `failed=${record.failedSegment ? record.failedSegment.segmentId + ":" + record.failedSegment.failureClass : "none"} ` +
      `intentInjected=${proof.injected} intentWaveAttempted=${proof.waveAttempted}\n`,
    );
  }

  const aggregate = {
    schema: "motapathfinder.iteration6-final-authority.v1",
    baseCommit: "734be0a (dev; iteration-6 repair 2a: scheduler-aware breadth injection)",
    config: {
      route: "onlyup-chaos-mt1-mt4",
      searchIntent: "adaptive-feasible",
      adaptiveBacktrackDepth: 3,
      adaptiveWaveBatchSize: "production default (unset)",
      budgetScope: "global-run",
      maxExpansions: 50000,
      maxRuntimeMs: 30000,
      maxRssMb: 256,
      processTreeHardMb: 260,
      candidateLimit: 8,
      milestoneFrontierResourceDiversity: true,
      freshProcessPerArm: true,
      purpose: "CAPABILITY AUTHORITY (strict replay restored; intent-execution proof required)",
    },
    arms,
  };
  process.stdout.write(JSON.stringify(aggregate, null, 2) + "\n");
}

main();
