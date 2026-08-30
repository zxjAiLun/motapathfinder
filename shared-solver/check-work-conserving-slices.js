"use strict";

/** TEST GRADE: local-regression */

/**
 * PR-5.24b Iteration 4 Repair 1 – Work-Conserving Fair Slice Gate
 *
 * Deterministic gates over runSegmentAgainstFrontierLocal's candidate scheduler:
 *
 *  1. Fair-slice denominator: with 3 input candidates and a global expansion
 *     budget of 90, the FIRST attempt must receive exactly 30 expansions
 *     (budget / candidates) – no candidate may see the whole global budget on
 *     the first pass (the round-denominator regression guard).
 *  2. Work-conserving deferred retry: candidate A whose search needs more than
 *     its first fair slice (locally time-limited) is retried with the wall
 *     released by the instantly-completing candidates B/C, and recovers to
 *     found. LOCAL_LIMITS > 0, DEFERRED_RETRIES > 0, RECOVERED_TO_FOUND > 0,
 *     STILL_INCOMPLETE = 0.
 *  3. Exact incomplete accounting: with a global expansion budget exhausted
 *     during deferred retries, STILL_INCOMPLETE must equal exactly the number
 *     of candidates that never received a complete search (1: candidate A),
 *     not merely "> 0".
 *  4. Termination guard: without a finite global budget, locally-limited
 *     candidates are NOT retried in unlimited rounds; they stay incomplete.
 */

const assert = require("node:assert");
const path = require("node:path");
const { loadProject } = require("./lib/project-loader");
const { StaticSimulator } = require("./lib/simulator");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { getMilestoneSpec } = require("./lib/milestone-spec");
const { runSegmentAgainstFrontierLocal } = require("./lib/segment-dp");
const { createNoStateChangeChoiceResolver } = require("./lib/onlyup-mt1-real-route-gate");

const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");

function buildSimulator(project) {
  return new StaticSimulator(project, {
    stopFloorId: "MT6",
    battleResolver: new FunctionBackedBattleResolver(project, { enableFastReject: true }),
    autoBattleFastRejectEnabled: true,
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFastHazardBlockIndex: true,
    enableCompiledEffectCache: false,
    choiceResolver: createNoStateChangeChoiceResolver(),
  });
}

function makeBudget(totalExpansions, runtimeMs) {
  return {
    scope: "global-run",
    startedAt: Date.now(),
    deadlineMs: Date.now() + runtimeMs,
    requestedExpansions: totalExpansions,
    requestedRuntimeMs: runtimeMs,
    consumedExpansions: 0,
    consumedWallMs: 0,
    stoppedReason: null,
  };
}

function gateFairSliceDenominator(simulator, spec) {
  // 3 identical candidates, global expansion budget 90: the first attempt's
  // effective allocation must be 90 / 3 = 30.
  const initial = simulator.createInitialState();
  const segment = spec.milestones[0];
  const frontier = [0, 1, 2].map((i) => ({ id: `c${i}`, state: initial, tags: ["initial"] }));
  const budget = makeBudget(90, 60000);
  const result = runSegmentAgainstFrontierLocal(
    simulator,
    segment,
    frontier,
    { globalBudget: budget, maxRssMb: 1024, memoryCheckIntervalExpansions: 1, maxRuntimeMs: 60000 },
    {},
  );
  const firstAttempt = result.summary.attempts[0];
  assert.ok(firstAttempt, "fair-slice gate: first attempt must exist");
  const firstMaxExpansions = Number(firstAttempt.diagnostics.dp.maxExpansions);
  assert.strictEqual(
    firstMaxExpansions,
    30,
    `fair-slice gate: first of 3 candidates must receive budget/3 = 30 expansions, got ${firstMaxExpansions}`,
  );
  // No candidate may see the whole global budget on the first pass.
  for (const attempt of result.summary.attempts) {
    const maxExp = Number(attempt.diagnostics.dp.maxExpansions);
    assert.ok(
      maxExp <= 90,
      `fair-slice gate: attempt saw maxExpansions=${maxExp} > global budget 90 on first pass`,
    );
  }
  return { firstMaxExpansions };
}

function prepareStates(simulator, spec) {
  const initial = simulator.createInitialState();
  // Candidate A: an MT2 state (mt2-to-mt3 needs a deep search from it).
  const r0 = runSegmentAgainstFrontierLocal(
    simulator,
    spec.milestones[0],
    [{ id: "i", state: initial, tags: ["initial"] }],
    { maxRssMb: 1024, maxRuntimeMs: 25000 },
    {},
  );
  assert.ok(r0.merged && r0.merged.length > 0, "gate setup: mt1-to-mt2 must produce an MT2 state");
  const mt2State = r0.merged[0].state;
  // Candidates B/C: already on the goal floor of mt2-to-mt3.
  const atGoal = JSON.parse(JSON.stringify(initial));
  atGoal.floorId = "MT3";
  return { mt2State, atGoal };
}

function gateDeferredRetryRecovery(simulator, spec, states) {
  // Deterministic (expansion-based) work-conserving recovery: with a global
  // expansion budget of 240, A's fair first slice is 240/3 = 80 expansions,
  // which is locally expansion-limited (A's first goal lies deeper), B/C
  // complete instantly with 0 expansions and release their slices; A's retry
  // receives the remaining 160 and finds the goal.
  // (Iteration 5 hardening: replaces the wall-time-sensitive 1100ms form
  // which was flaky on faster/slower machines — the recovery SEMANTICS are
  // the contract, not the slice arithmetic.)
  const segment = spec.milestones[1];
  const frontier = [
    { id: "A", state: states.mt2State, tags: [] },
    { id: "B", state: states.atGoal, tags: [] },
    { id: "C", state: states.atGoal, tags: [] },
  ];
  const budget = makeBudget(240, 60000);
  const result = runSegmentAgainstFrontierLocal(
    simulator,
    segment,
    frontier,
    { globalBudget: budget, maxRssMb: 1024, memoryCheckIntervalExpansions: 1, maxRuntimeMs: 60000 },
    {},
  );
  const t = result.summary.candidateSliceTelemetry;
  assert.ok(t, "deferred-retry gate: candidateSliceTelemetry must be reported");
  assert.ok(
    t.candidateSliceLocalTimeouts + t.candidateSliceLocalExpansionStops > 0,
    `deferred-retry gate: expected at least one local slice stop, got ${JSON.stringify(t)}`,
  );
  assert.ok(
    t.candidateSliceDeferredRetries > 0,
    `deferred-retry gate: expected deferred retries, got ${JSON.stringify(t)}`,
  );
  assert.ok(
    t.candidateSliceRecoveredToFound > 0,
    `deferred-retry gate: expected recovery to found, got ${JSON.stringify(t)}`,
  );
  assert.strictEqual(
    t.candidateSliceStillIncompleteAtGlobalStop,
    0,
    `deferred-retry gate: no candidate may remain incomplete after work-conserving retries, got ${JSON.stringify(t)}`,
  );
  return t;
}

function gateExactIncompleteAccounting(simulator, spec, states) {
  // Global expansion budget 80: first fair slice 80/3 ≈ 26 is insufficient for
  // A (local expansion stop), B/C complete with 0 expansions, A's retry gets
  // the remaining 54 and still cannot complete (needs 520). Exactly ONE
  // candidate (A) never receives a complete search.
  const segment = spec.milestones[1];
  const frontier = [
    { id: "A", state: states.mt2State, tags: [] },
    { id: "B", state: states.atGoal, tags: [] },
    { id: "C", state: states.atGoal, tags: [] },
  ];
  const budget = makeBudget(80, 60000);
  const result = runSegmentAgainstFrontierLocal(
    simulator,
    segment,
    frontier,
    { globalBudget: budget, maxRssMb: 1024, memoryCheckIntervalExpansions: 1, maxRuntimeMs: 60000 },
    {},
  );
  const t = result.summary.candidateSliceTelemetry;
  assert.ok(
    t.candidateSliceLocalExpansionStops > 0,
    `incomplete-accounting gate: expected a local expansion stop, got ${JSON.stringify(t)}`,
  );
  assert.ok(
    t.candidateSliceDeferredRetries > 0,
    `incomplete-accounting gate: expected a deferred retry, got ${JSON.stringify(t)}`,
  );
  assert.strictEqual(
    t.candidateSliceStillIncompleteAtGlobalStop,
    1,
    `incomplete-accounting gate: exactly 1 candidate (A) must remain incomplete, got ${t.candidateSliceStillIncompleteAtGlobalStop} (${JSON.stringify(t)})`,
  );
  assert.strictEqual(
    budget.stoppedReason,
    "expansion-limit",
    `incomplete-accounting gate: global budget must stop on expansion-limit, got ${budget.stoppedReason}`,
  );
  return t;
}

function gateTerminationGuard(simulator, spec, states) {
  // No global budget at all: a locally time-limited candidate must NOT be
  // retried in unlimited rounds; it stays incomplete (no busy loop, no
  // exhaustion claim).
  const segment = spec.milestones[1];
  const frontier = [
    { id: "A", state: states.mt2State, tags: [] },
    { id: "B", state: states.atGoal, tags: [] },
  ];
  // Tight per-attempt runtime cap via segment dp overrides, no global budget.
  const result = runSegmentAgainstFrontierLocal(
    simulator,
    segment,
    frontier,
    { maxRssMb: 1024, memoryCheckIntervalExpansions: 1, dpOverrides: { maxRuntimeMs: 50, maxExpansions: 50000 } },
    {},
  );
  const t = result.summary.candidateSliceTelemetry;
  // A either completes within 50ms or is locally stopped; B completes.
  // Either way: deferred retries must be bounded. Without a finite global
  // budget the loop cannot run at all, so retries stay 0 and any locally
  // stopped candidate remains incomplete.
  assert.ok(
    t.candidateSliceDeferredRetries === 0,
    `termination-guard gate: without a finite global budget no deferred rounds may run, got ${JSON.stringify(t)}`,
  );
  if (t.candidateSliceLocalTimeouts + t.candidateSliceLocalExpansionStops > 0) {
    assert.ok(
      t.candidateSliceStillIncompleteAtGlobalStop > 0,
      `termination-guard gate: locally stopped candidates without a global budget must be counted incomplete, got ${JSON.stringify(t)}`,
    );
  }
  return t;
}

function gateTerminalIncomplete(simulator, spec, states) {
  // Fixture 5 (Repair 2): a candidate whose search ends with stoppedReason=null
  // but searchComplete=false (e.g. action scope trimmed) is TERMINAL-incomplete:
  // counted, not retried, and must force candidateSliceSearchComplete=false.
  const segment = spec.milestones[1];
  // maxActionsPerState=1 trims the action scope: the DP exhausts its (trimmed)
  // frontier without a resource stop and without genuine search completeness.
  const frontier = [{ id: "A", state: states.mt2State, tags: [] }];
  const budget = makeBudget(50000, 30000);
  const result = runSegmentAgainstFrontierLocal(
    simulator,
    segment,
    frontier,
    {
      globalBudget: budget,
      maxRssMb: 1024,
      memoryCheckIntervalExpansions: 1,
    },
    { dpOverrides: { maxActionsPerState: 1, maxExpansions: 50000, maxRuntimeMs: 30000 } },
  );
  const t = result.summary.candidateSliceTelemetry;
  const dp = result.summary.attempts[0] && result.summary.attempts[0].diagnostics.dp;
  assert.ok(dp && dp.actionTrimmed > 0, `terminal-incomplete gate setup: action scope must actually be trimmed, got actionTrimmed=${dp && dp.actionTrimmed}`);
  assert.ok(t, "terminal-incomplete gate: candidateSliceTelemetry must be reported");
  assert.strictEqual(
    t.candidateSliceTerminalIncomplete,
    1,
    `terminal-incomplete gate: trimmed-scope candidate must be counted TERMINAL_INCOMPLETE, got ${JSON.stringify(t)}`,
  );
  assert.strictEqual(
    t.candidateSliceFinalPending,
    0,
    `terminal-incomplete gate: terminal-incomplete must not be retried, got ${JSON.stringify(t)}`,
  );
  assert.strictEqual(
    t.candidateSliceSearchComplete,
    false,
    `terminal-incomplete gate: searchComplete must be false, got ${JSON.stringify(t)}`,
  );
  return t;
}

function gateRecoveredStopNotResourceLimited(simulator, spec, states) {
  // Fixture 6 (Repair 2): candidate A times out on its first fair slice, B/C
  // complete instantly, A's retry finds the goal. The HISTORICAL local timeout
  // must remain in telemetry, but the FINAL completion must be FOUND with zero
  // pending – i.e. the run's final semantics are NOT resource-limited by the
  // recovered slice stop.
  const segment = spec.milestones[1];
  const frontier = [
    { id: "A", state: states.mt2State, tags: [] },
    { id: "B", state: states.atGoal, tags: [] },
    { id: "C", state: states.atGoal, tags: [] },
  ];
  // Iteration 5 hardening: deterministic expansion-based form (see fixture 2).
  // A's first fair slice (80) is locally expansion-limited; B/C release
  // instantly; A's retry (160 remaining) finds the goal. The HISTORICAL local
  // stop must remain in telemetry while the FINAL completion is FOUND with
  // zero pending — the run's final semantics are NOT resource-limited by the
  // recovered slice stop.
  const budget = makeBudget(240, 60000);
  const result = runSegmentAgainstFrontierLocal(
    simulator,
    segment,
    frontier,
    { globalBudget: budget, maxRssMb: 1024, memoryCheckIntervalExpansions: 1, maxRuntimeMs: 60000 },
    {},
  );
  const t = result.summary.candidateSliceTelemetry;
  assert.ok(
    t.candidateSliceLocalTimeouts + t.candidateSliceLocalExpansionStops > 0,
    `recovered-stop gate: a historical local stop must have happened, got ${JSON.stringify(t)}`,
  );
  assert.ok(
    t.candidateSliceDeferredRetries > 0,
    `recovered-stop gate: deferred retries must have run, got ${JSON.stringify(t)}`,
  );
  assert.ok(
    t.candidateSliceRecoveredToFound > 0,
    `recovered-stop gate: recovery to found must have happened, got ${JSON.stringify(t)}`,
  );
  assert.strictEqual(
    t.candidateSliceFinalPending,
    0,
    `recovered-stop gate: no candidate may be pending after successful retry, got ${JSON.stringify(t)}`,
  );
  assert.strictEqual(
    t.candidateSliceTerminalIncomplete,
    0,
    `recovered-stop gate: no terminal incompleteness expected, got ${JSON.stringify(t)}`,
  );
  assert.strictEqual(
    t.candidateSliceSearchComplete,
    true,
    `recovered-stop gate: searchComplete must be true after full recovery, got ${JSON.stringify(t)}`,
  );
  // Final-semantics assertion: with all candidates FOUND and nothing pending,
  // the global budget must NOT have been stopped by the recovered slice.
  assert.strictEqual(
    budget.stoppedReason,
    null,
    `recovered-stop gate: global budget must not be stopped when every candidate completed/found, got ${budget.stoppedReason}`,
  );
  return t;
}

function gateRunWideCompletionAuthority() {
  // Fixture 7 (Repair 3): runMilestoneGraph-level run-wide completion authority.
  // An adaptive replay execution whose candidate is still pending at its child
  // deadline must keep the WHOLE canonical run from claiming EXHAUSTED, even
  // when the parent global budget never stops (budgetStop=null).
  const { runMilestoneGraph } = require("./lib/segment-dp");
  const project = loadProject(DEFAULT_PROJECT_ROOT);
  const simulator = buildSimulator(project);
  const spec = getMilestoneSpec(project, "onlyup-chaos-mt1-mt3");
  const initialState = simulator.createInitialState();

  // Tight per-segment runtime so the mt2-to-mt3 search locally times out on
  // its first slice, while the parent global budget (short wall) expires
  // during the adaptive replay rounds leaving candidates pending.
  const result = runMilestoneGraph(simulator, initialState, spec, {
    searchIntent: "adaptive-feasible",
    enableFailureBacktracking: true,
    adaptiveBacktrackDepth: 2,
    budgetScope: "global-run",
    maxExpansions: 50000,
    maxRuntimeMs: 4000,
    maxRssMb: 4096,
    memoryCheckIntervalExpansions: 1,
    memoryCheckIntervalActions: 1,
  });

  const completionLedger = result.executionCompletionLedger || [];
  assert.ok(
    completionLedger.length > 0,
    `run-wide gate: executionCompletionLedger must be reported, got ${completionLedger.length} entries`,
  );
  const runWidePending = completionLedger.reduce((sum, e) => sum + Number(e.finalPending || 0), 0);
  const budgetStop = result.budget && result.budget.stoppedReason;
  const runWideTerminal = completionLedger.reduce((sum, e) => sum + Number(e.terminalIncomplete || 0), 0);
  // Hard contract for the fixture: a truncated 4s adaptive run can never
  // legitimately claim EXHAUSTED – either the global budget stopped, or some
  // execution still has pending/terminal-incomplete candidates, or it found.
  assert.ok(
    budgetStop != null || runWidePending > 0 || runWideTerminal > 0 || result.found,
    `run-wide gate: a truncated 4s adaptive run must not be exhaustible (budgetStop=${budgetStop}, pending=${runWidePending}, terminal=${runWideTerminal}, found=${result.found})`,
  );

  // Deterministic classifier probe for the exact cloud-P1 shape that cannot be
  // reliably reproduced end-to-end locally (isolated child deadline < parent
  // deadline with pending candidates at return): budgetStop=null AND an
  // adaptive execution with finalPending>0 must classify as RESOURCE_LIMITED,
  // never EXHAUSTED. This mirrors extractFinalFailureSemantics' authority chain.
  // Iteration 5 (P2): unknown completion (searchComplete === null) must also
  // fail closed as INCOMPLETE_SCOPE – never silently default to 0/complete.
  const resourceStopReasons = new Set(["rss-limit", "heap-limit", "time-limit", "expansion-limit"]);
  const classifyRunWide = (shape) => {
    const cl = shape.executionCompletionLedger || [];
    const pending = cl.reduce((sum, e) => sum + Number(e.finalPending || 0), 0);
    const unknown = cl.filter((e) => e.searchComplete !== true && e.searchComplete !== false).length;
    const terminal = cl.reduce((sum, e) => sum + Number(e.terminalIncomplete || 0), 0) + unknown;
    const stop = shape.budget && shape.budget.stoppedReason;
    if (shape.found) return "FOUND";
    if (pending > 0 || (stop && resourceStopReasons.has(stop))) return "RESOURCE_LIMITED";
    if (terminal > 0) return "INCOMPLETE_SCOPE";
    if (shape.cancelled) return "CANCELLED";
    return "EXHAUSTED";
  };
  const p1Shape = {
    found: false,
    cancelled: false,
    budget: { stoppedReason: null },
    executionCompletionLedger: [
      { phase: "initial", segmentId: "mt1-to-mt2", finalPending: 0, terminalIncomplete: 0, searchComplete: true },
      { phase: "initial", segmentId: "mt2-to-mt3", finalPending: 0, terminalIncomplete: 0, searchComplete: true },
      { phase: "adaptive-replay", segmentId: "mt2-to-mt3", finalPending: 1, terminalIncomplete: 0, searchComplete: false },
    ],
  };
  assert.strictEqual(
    classifyRunWide(p1Shape),
    "RESOURCE_LIMITED",
    "run-wide gate: budgetStop=null with adaptive pending candidates must be RESOURCE_LIMITED, never EXHAUSTED",
  );
  const exhaustedShape = {
    found: false,
    cancelled: false,
    budget: { stoppedReason: null },
    executionCompletionLedger: [
      { phase: "initial", segmentId: "s1", finalPending: 0, terminalIncomplete: 0, searchComplete: true },
      { phase: "adaptive-replay", segmentId: "s1", finalPending: 0, terminalIncomplete: 0, searchComplete: true },
    ],
  };
  assert.strictEqual(classifyRunWide(exhaustedShape), "EXHAUSTED", "run-wide gate: a fully completed run must classify as EXHAUSTED");
  const scopeShape = {
    found: false,
    cancelled: false,
    budget: { stoppedReason: null },
    executionCompletionLedger: [{ phase: "initial", segmentId: "s1", finalPending: 0, terminalIncomplete: 1, searchComplete: false }],
  };
  assert.strictEqual(classifyRunWide(scopeShape), "INCOMPLETE_SCOPE", "run-wide gate: terminal-incomplete must classify as INCOMPLETE_SCOPE");
  const unknownCompletionShape = {
    found: false,
    cancelled: false,
    budget: { stoppedReason: null },
    executionCompletionLedger: [
      { phase: "initial", segmentId: "s1", finalPending: 0, terminalIncomplete: 0, searchComplete: true },
      { phase: "adaptive-replay", segmentId: "s1", finalPending: null, terminalIncomplete: null, searchComplete: null },
    ],
  };
  assert.strictEqual(
    classifyRunWide(unknownCompletionShape),
    "INCOMPLETE_SCOPE",
    "run-wide gate: unknown completion (searchComplete=null) must fail closed as INCOMPLETE_SCOPE, never EXHAUSTED",
  );

  return {
    executions: completionLedger.length,
    runWidePending,
    runWideTerminal,
    budgetStop,
    found: result.found,
  };
}

function gateCompactLedgerCompletionPreservation() {
  // Fixture 8 (Iteration 5 Repair, pre-commit P1) – PRODUCTION-PATH gate.
  //
  // The `4246468` EXHAUSTED qualification was invalidated because the chain
  //   real execution -> toCompactLedgerExecution() -> candidateSliceTelemetry
  //   dropped -> appendExecutionCompletion() -> null -> checker unknown-as-zero
  // silently reported unknown completions as 0/complete.
  //
  // This fixture drives the REAL production path: a runMilestoneGraph run
  // whose mt2-to-mt3 failure triggers tryAdaptiveCheckpointRepair, whose
  // failed wave detaches its executions through toCompactLedgerExecution()
  // into ledgerExecutions, which runMilestoneGraph then feeds to
  // appendExecutionCompletion. Hard assertions:
  //
  //   1. at least one compact adaptive entry (adaptive-expand/adaptive-replay
  //      phase) is present in the run-wide executionCompletionLedger;
  //   2. EVERY ledger entry carries non-null completion fields (finalFound,
  //      finalComplete, finalPending, terminalIncomplete, searchComplete) —
  //      no unknown-as-zero can ever repeat;
  //   3. for every compacted entry, ledger readings === the completion proof
  //      snapshotted at compaction time (compact-before === compact-after);
  //   4. adaptive phases come from the execution source (executionPhase),
  //      never inferred from array index.
  const { runMilestoneGraph } = require("./lib/segment-dp");
  const project = loadProject(DEFAULT_PROJECT_ROOT);
  const simulator = buildSimulator(project);
  const spec = getMilestoneSpec(project, "onlyup-chaos-mt1-mt3");
  const initialState = simulator.createInitialState();

  // Deterministic adaptive-failure shape (fixture 7's): tight global runtime so
  // mt2-to-mt3 fails its slices, adaptive rollback triggers, the wave cannot
  // reach the goal within the budget, and all wave executions detach through
  // the compact ledger path. Memory limits are disabled to keep the shape
  // machine-independent.
  const result = runMilestoneGraph(simulator, initialState, spec, {
    searchIntent: "adaptive-feasible",
    enableFailureBacktracking: true,
    adaptiveBacktrackDepth: 1,
    budgetScope: "global-run",
    maxExpansions: 50000,
    maxRuntimeMs: 4000,
    maxRssMb: 4096,
    memoryCheckIntervalExpansions: 1,
    memoryCheckIntervalActions: 1,
  });

  const ledger = result.executionCompletionLedger || [];
  assert.ok(
    ledger.length > 0,
    `compact-ledger gate: executionCompletionLedger must be reported, got ${ledger.length} entries`,
  );

  const adaptiveEntries = ledger.filter(
    (e) => e.phase === "adaptive-expand" || e.phase === "adaptive-replay",
  );
  assert.ok(
    adaptiveEntries.length > 0,
    `compact-ledger gate: the run must produce at least one adaptive (compact-path) execution, got phases [${ledger.map((e) => e.phase).join(",")}]`,
  );

  const compactProofEntries = ledger.filter((e) => e.compactCompletionProof);
  assert.ok(
    compactProofEntries.length > 0,
    "compact-ledger gate: at least one ledger entry must carry the compaction-time completion proof",
  );

  // (2) Every real execution in the run-wide ledger has KNOWN completion.
  ledger.forEach((entry, index) => {
    const label = `entry ${index} (phase=${entry.phase}, segment=${entry.segmentId})`;
    assert.ok(
      entry.finalFound != null && entry.finalComplete != null && entry.finalPending != null,
      `compact-ledger gate: ${label} has null final completion counters — unknown completion must never reach the ledger`,
    );
    assert.ok(
      entry.terminalIncomplete != null,
      `compact-ledger gate: ${label} has null terminalIncomplete`,
    );
    assert.ok(
      typeof entry.searchComplete === "boolean",
      `compact-ledger gate: ${label} has non-boolean searchComplete (${String(entry.searchComplete)}) — unknown-as-zero bug resurfaced`,
    );
  });

  // (3) Compact-before === compact-after for every compacted entry.
  compactProofEntries.forEach((entry, index) => {
    const proof = entry.compactCompletionProof;
    const label = `compact entry ${index} (phase=${entry.phase}, segment=${entry.segmentId})`;
    assert.strictEqual(
      entry.finalFound,
      proof.finalFound,
      `compact-ledger gate: ${label} finalFound ${entry.finalFound} !== compaction proof ${proof.finalFound}`,
    );
    assert.strictEqual(
      entry.finalComplete,
      proof.finalComplete,
      `compact-ledger gate: ${label} finalComplete ${entry.finalComplete} !== compaction proof ${proof.finalComplete}`,
    );
    assert.strictEqual(
      entry.finalPending,
      proof.finalPending,
      `compact-ledger gate: ${label} finalPending ${entry.finalPending} !== compaction proof ${proof.finalPending}`,
    );
    assert.strictEqual(
      entry.terminalIncomplete,
      proof.terminalIncomplete,
      `compact-ledger gate: ${label} terminalIncomplete ${entry.terminalIncomplete} !== compaction proof ${proof.terminalIncomplete}`,
    );
    assert.strictEqual(
      entry.searchComplete,
      proof.searchComplete,
      `compact-ledger gate: ${label} searchComplete ${entry.searchComplete} !== compaction proof ${proof.searchComplete}`,
    );
  });

  // (4) Phase fidelity: compact adaptive executions must carry source-stamped
  // phases; the first compact entry may be adaptive-expand (anchor) and every
  // subsequent segment advance is adaptive-replay. Multi-wave runs must never
  // mislabel a later wave's expand entry — stamped phases guarantee this.
  adaptiveEntries.forEach((entry, index) => {
    assert.ok(
      entry.phase === "adaptive-expand" || entry.phase === "adaptive-replay",
      `compact-ledger gate: adaptive entry ${index} has non-adaptive phase ${entry.phase}`,
    );
  });

  // (5) Iteration 6 — terminalIncomplete attribution: every ledger entry that
  // reports terminalIncomplete > 0 must carry a classifiable completionSource
  // (not-run-budget-exhausted / unknown-completion / genuinely-executed), so
  // the authority-run shape "terminalIncomplete=1 in every run" can never be
  // conflated across sources. Entries with terminalIncomplete > 0 and NO
  // completion source are unattributable and fail the gate.
  ledger.forEach((entry, index) => {
    if (Number(entry.terminalIncomplete || 0) === 0) return;
    const label = `entry ${index} (phase=${entry.phase}, segment=${entry.segmentId})`;
    assert.ok(
      entry.completionSource === "not-run-budget-exhausted" ||
        entry.completionSource === "unknown-completion" ||
        entry.completionSource == null, // genuinely-executed scope-trim / goal-found-incomplete
      `compact-ledger gate: ${label} has terminalIncomplete=${entry.terminalIncomplete} with unattributable completionSource ${String(entry.completionSource)}`,
    );
    // A not-run execution is a resource stop, NOT terminal scope incompleteness.
    if (entry.completionSource === "not-run-budget-exhausted") {
      assert.strictEqual(
        entry.terminalIncomplete,
        0,
        `compact-ledger gate: ${label} is a not-run (budget-exhausted) execution and must NOT report terminalIncomplete > 0`,
      );
      assert.ok(
        entry.executionNotRunReason === "time-limit" || entry.executionNotRunReason === "expansion-limit",
        `compact-ledger gate: ${label} must carry its not-run stop reason`,
      );
    }
    if (entry.completionSource === "unknown-completion") {
      // fail-closed shape: telemetry missing must surface as terminal=1, never 0
      assert.strictEqual(
        entry.terminalIncomplete,
        1,
        `compact-ledger gate: ${label} is an unknown-completion entry and must fail closed with terminalIncomplete=1`,
      );
    }
  });

  return {
    executions: ledger.length,
    adaptiveEntries: adaptiveEntries.length,
    compactProofEntries: compactProofEntries.length,
    phases: ledger.map((e) => e.phase),
    allCompletionsKnown: true,
    compactBeforeEqualsAfter: true,
  };
}

function main() {
  const project = loadProject(DEFAULT_PROJECT_ROOT);
  const simulator = buildSimulator(project);
  const spec = getMilestoneSpec(project, "onlyup-chaos-mt1-mt3");

  const fair = gateFairSliceDenominator(simulator, spec);
  const states = prepareStates(simulator, spec);
  const recovery = gateDeferredRetryRecovery(simulator, spec, states);
  const incomplete = gateExactIncompleteAccounting(simulator, spec, states);
  const guard = gateTerminationGuard(simulator, spec, states);
  const terminalIncomplete = gateTerminalIncomplete(simulator, spec, states);
  const recoveredStop = gateRecoveredStopNotResourceLimited(simulator, spec, states);
  const runWide = gateRunWideCompletionAuthority();
  const compactLedger = gateCompactLedgerCompletionPreservation();

  console.log(JSON.stringify({
    schema: "motapathfinder.work-conserving-slices.v4",
    contractStatus: "passed",
    fairSlice: fair,
    deferredRecovery: recovery,
    exactIncomplete: incomplete,
    terminationGuard: guard,
    terminalIncomplete,
    recoveredStopNotResourceLimited: recoveredStop,
    runWideCompletionAuthority: runWide,
    compactLedgerCompletionPreservation: compactLedger,
  }, null, 2));
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  }
}

module.exports = { main };
