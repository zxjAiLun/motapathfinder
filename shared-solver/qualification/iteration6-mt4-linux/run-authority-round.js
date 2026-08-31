"use strict";

/**
 * PR-5.24b Iteration 6 Qualification — baseline vs candidate authority rounds.
 *
 * Two fresh-process rounds on the same commit (a22f7e3 solver behavior):
 *   BASELINE : enableFailureIntentRanking = false  (pre-iteration-6 order;
 *              reproduces ad324b8 rollback behavior)
 *   CANDIDATE: enableFailureIntentRanking = true   (failure-conditioned
 *              investment ranking active)
 * Frozen contracts: 30s / 50k / 256MB stop / 260 hard / candidateLimit 8 /
 * adaptiveDepth 3 / no OFF-ON diversity comparison (Iteration 5 closed).
 *
 * Qualification-only fixes over the previous runner (per authorization):
 *   - verifyCandidateStrictReplay wires the SAME choiceResolver instance
 *     into the simulator (no resolver bypass);
 *   - classifyRun checks RESOURCE_LIMITED before INCOMPLETE_SCOPE so the
 *     INCOMPLETE_SCOPE branch is reachable.
 */

const path = require("node:path");
const assert = require("node:assert");
const { spawnSync } = require("node:child_process");

// ---------------------------------------------------------------------------
// Single-round child, spawned fresh per round.
// ---------------------------------------------------------------------------
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
const ENABLE_INTENT = process.argv[2] === "candidate";
const LABEL = process.argv[3] || (ENABLE_INTENT ? "CANDIDATE" : "BASELINE");

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
  // Qualification fix: ONE resolver, wired into the simulator that replays.
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
  return {
    passed: true,
    decisionsReplayed,
    finalFloorId: replayState.floorId,
    exactStateKey: replayedStateKey,
  };
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
    enableFailureIntentRanking: ENABLE_INTENT,
    captureSelectionAudit: true,
  });
  const wallMs = Date.now() - startedAt;
  assert.strictEqual(choiceResolver.unresolved.length, 0, "main run must leave no unresolved choices");

  const cls = classifyRun(result);
  const failed = result.failedSegment || null;
  const backtrack = (failed && failed.backtrack) || null;
  const intentRanking = backtrack && backtrack.failureIntentRanking ? {
    anchor: backtrack.failureIntentRanking.anchor,
    replay: backtrack.failureIntentRanking.replay,
  } : null;

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

  const ledger = result.executionCompletionLedger || [];
  const adaptivePhases = {};
  ledger.forEach((e) => { adaptivePhases[e.phase] = (adaptivePhases[e.phase] || 0) + 1; });

  process.stdout.write(JSON.stringify({
    label: LABEL,
    enableFailureIntentRanking: ENABLE_INTENT,
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
    },
    failureIntentRanking: intentRanking,
    strictReplay,
    reachedMT4,
  }) + "\\n");
}

main();
`;

const fs = require("node:fs");
const os = require("node:os");
const CHILD_PATH = path.join(os.tmpdir(), "iteration6b-round-child.js");
fs.writeFileSync(CHILD_PATH, CHILD_SOURCE);

function runRound(label, mode) {
  const res = spawnSync(
    process.execPath,
    ["--expose-gc", CHILD_PATH, mode, label],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 180000, env: { ...process.env, SOLVER_DIR: path.resolve(__dirname, "..", "..") } },
  );
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`round ${label} failed (${res.status}): ${res.stderr}\n${res.stdout}`);
  }
  const lines = res.stdout.trim().split("\n");
  return JSON.parse(lines[lines.length - 1]);
}

function main() {
  const baseline = runRound("BASELINE", "baseline");
  process.stderr.write(
    `BASELINE: found=${baseline.found} outcome=${baseline.finalCanonicalOutcome} ` +
    `stop=${baseline.budget.stoppedReason} exp=${baseline.budget.consumedExpansions} ` +
    `wall=${baseline.wallMs} tree=${baseline.processTree.peakRssMb} ` +
    `pend=${baseline.runWide.finalPending} waves=${baseline.adaptive.waveAttempts}\n`,
  );
  const candidate = runRound("CANDIDATE", "candidate");
  process.stderr.write(
    `CANDIDATE: found=${candidate.found} outcome=${candidate.finalCanonicalOutcome} ` +
    `stop=${candidate.budget.stoppedReason} exp=${candidate.budget.consumedExpansions} ` +
    `wall=${candidate.wallMs} tree=${candidate.processTree.peakRssMb} ` +
    `pend=${candidate.runWide.finalPending} waves=${candidate.adaptive.waveAttempts}\n`,
  );

  const aggregate = {
    schema: "motapathfinder.iteration6-baseline-vs-candidate.v1",
    baseCommit: "a22f7e3 (dev; failure-conditioned investment)",
    config: {
      route: "onlyup-chaos-mt1-mt4",
      searchIntent: "adaptive-feasible",
      adaptiveBacktrackDepth: 3,
      budgetScope: "global-run",
      maxExpansions: 50000,
      maxRuntimeMs: 30000,
      maxRssMb: 256,
      processTreeHardMb: 260,
      candidateLimit: 8,
      freshProcessPerRound: true,
    },
    baseline,
    candidate,
  };
  process.stdout.write(JSON.stringify(aggregate, null, 2) + "\n");
}

main();
