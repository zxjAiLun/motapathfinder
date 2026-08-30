"use strict";

/**
 * PR-5.24b Iteration 6 Final Authority Round — single canonical MT1→MT4.
 *
 * Per the Iteration-6 authorization (after Repair 1 + scope repair):
 *   - one full canonical MT1→MT4 run, frozen contracts
 *     (30s / 50k / 256MB stop / 260 hard / candidateLimit 8 / depth 3),
 *   - NO OFF/ON diversity comparison (Iteration 5 is closed),
 *   - if FOUND: immediate fresh strict replay on a brand-new simulator from
 *     real MT1 (Chaos, zero unresolved choices, final floor MT4, exact
 *     StateKey match),
 *   - outcome classification mirrors the frozen decision tree:
 *       FOUND | RESOURCE_LIMITED | INCOMPLETE_SCOPE | CANCELLED | EXHAUSTED.
 *
 * This file is qualification-only evidence tooling; no solver files are
 * modified. Run on: ubuntu-24.04 / Node 20.20.2 (authority environment class).
 */

const path = require("node:path");
const assert = require("node:assert");
const { loadProject } = require("../../lib/project-loader");
const { StaticSimulator } = require("../../lib/simulator");
const { FunctionBackedBattleResolver } = require("../../lib/battle-resolver");
const { getMilestoneSpec } = require("../../lib/milestone-spec");
const { runMilestoneGraph } = require("../../lib/segment-dp");
const { buildStateKey } = require("../../lib/state-key");
const { resolveRecordedAction } = require("../../lib/route-store");
const {
  FIRST_REGION_TARGET_FLOOR_ID,
  createNoStateChangeChoiceResolver,
  difficultySnapshot,
  isDecisionEntry,
} = require("../../lib/onlyup-mt1-real-route-gate");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..", "Only upV2.1", "Only upV2.1");
const CHAOS_DIFFICULTY = { I581: 0, I582: 0, "flag:level0": 0 };
const TARGET_FLOOR_ID = "MT4";

function buildSimulator(project) {
  return new StaticSimulator(project, {
    stopFloorId: FIRST_REGION_TARGET_FLOOR_ID,
    battleResolver: new FunctionBackedBattleResolver(project, { enableFastReject: true }),
    autoBattleFastRejectEnabled: true,
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFastHazardBlockIndex: true,
    enableCompiledEffectCache: false,
    choiceResolver: createNoStateChangeChoiceResolver(),
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
    memoryStop || pending > 0 || terminal > 0 || unknown > 0 ||
    (budgetStop && resourceStops.has(budgetStop))
  ) finalCanonicalOutcome = "RESOURCE_LIMITED";
  else if (terminal > 0 || unknown > 0) finalCanonicalOutcome = "INCOMPLETE_SCOPE";
  else if (result.cancelled) finalCanonicalOutcome = "CANCELLED";
  else finalCanonicalOutcome = "EXHAUSTED";
  return { pending, terminal, unknown, budgetStop, finalCanonicalOutcome };
}

function verifyCandidateStrictReplay(project, candidate) {
  const choiceResolver = createNoStateChangeChoiceResolver();
  const simulator = buildSimulator(project); // fresh simulator
  let replayState = simulator.createInitialState();
  assert.deepStrictEqual(
    difficultySnapshot(replayState),
    CHAOS_DIFFICULTY,
    "Replay must start on Chaos difficulty",
  );
  const route = Array.isArray(candidate.route) ? candidate.route : [];
  assert.ok(route.length > 0, `Candidate ${candidate.id} must have a non-empty route`);
  let decisionsReplayed = 0;
  for (let index = 0; index < route.length; index += 1) {
    const entry = route[index];
    if (!isDecisionEntry(entry)) continue;
    const resolved = resolveRecordedAction(simulator, replayState, entry, {
      requireFingerprintMatch: true,
    });
    assert.ok(
      resolved != null && resolved.action != null,
      `Replay action not enumerated at step ${index} for candidate ${candidate.id}`,
    );
    decisionsReplayed += 1;
    replayState = simulator.applyAction(replayState, resolved.action, { storeRoute: true });
  }
  assert.strictEqual(
    replayState.floorId,
    candidate.state.floorId,
    `Floor mismatch on candidate ${candidate.id}: expected ${candidate.state.floorId}, got ${replayState.floorId}`,
  );
  const replayedStateKey = buildStateKey(replayState);
  const targetStateKey = buildStateKey(candidate.state);
  assert.strictEqual(
    replayedStateKey,
    targetStateKey,
    `StateKey mismatch on candidate ${candidate.id}`,
  );
  assert.deepStrictEqual(
    difficultySnapshot(replayState),
    CHAOS_DIFFICULTY,
    "Difficulty drift detected during replay",
  );
  assert.strictEqual(
    choiceResolver.unresolved.length,
    0,
    `Unresolved choice decisions during replay of candidate ${candidate.id}`,
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
  const simulator = buildSimulator(project);
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
    captureSelectionAudit: true,
  });
  const wallMs = Date.now() - startedAt;

  const cls = classifyRun(result);
  const failed = result.failedSegment || null;

  // Strict replay only when found (per the frozen decision tree).
  let replay = null;
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
    replay = {
      allPassed: true,
      candidates: replays,
      reachedMT4,
    };
  }

  const out = {
    schema: "motapathfinder.iteration6-authority-round.v1",
    baseCommit: "ad324b8 (dev; iteration-6 repair 1 + scope repair)",
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
      diversity: "default-on (iteration 5 closed; no OFF/ON comparison)",
    },
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
      executions: (result.executionCompletionLedger || []).length,
      finalPending: cls.pending,
      terminalIncomplete: cls.terminal,
      unknownCompletion: cls.unknown,
    },
    strictReplay: replay,
    reachedMT4,
  };
  process.stdout.write(JSON.stringify(out) + "\n");
}

main();
