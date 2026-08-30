"use strict";

/** TEST GRADE: local-regression */

/**
 * PR-5.24b Iteration 2b Repair 1/2 – Thin Canonical Planner Gate
 *
 * Verifies (whole lifecycle):
 *  - Clean thin runtime measured in an isolated child that never imports heavy modules
 *    (neverLoadsProject/neverConstructsSimulator are computed from require.cache, not self-attested)
 *  - Whole-run budget: bootstrap + segment graph share ONE 30s deadline (budget identity,
 *    requestedRuntimeMs reported as original 30000, overallWallMs hard-gated)
 *  - Bootstrap process-tree memory = concurrent sum (planner at spawn + worker peak),
 *    overall peak = max(bootstrap aggregate, segment aggregate), gated ≤260/4
 *  - Thin MT1→MT3 capability lock (Repair 2): frozen 5.24a semantics (depth=2) must still
 *    find MT3 through the thin lifecycle, with fresh strict replay from real MT1
 *  - MT1→MT4 final-failure semantics (Repair 2): initial MT2→MT3 frontier exhaustion is
 *    reported separately from the canonical final outcome (RESOURCE_LIMITED vs EXHAUSTED)
 *  - Thin normalized milestones === heavy getMilestoneSpec(project).milestones (deep equal)
 *  - Successor presentTiles propagation semantics locked by micro fixture
 *  - Thin-vs-current isolated parity for MT1→MT2 (same initialState, segment, budget)
 *  - Envelope is mandatory fail-closed in segment worker (negative probes)
 *  - Global budget authority / StateKey / Profile / projectIdentity pass via thin path
 */

const assert = require("node:assert");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { loadProject } = require("./lib/project-loader");
const { StaticSimulator } = require("./lib/simulator");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { buildStateKey } = require("./lib/state-key");
const { getMilestoneSpec, propagateSuccessorHardPresentTiles } = require("./lib/milestone-spec");
const { runSegmentAgainstFrontier, runSegmentAgainstFrontierLocal } = require("./lib/segment-dp");
const { loadMilestoneSpecThin } = require("./lib/thin-planner");
const { FIRST_REGION_TARGET_FLOOR_ID, createNoStateChangeChoiceResolver } = require("./lib/onlyup-mt1-real-route-gate");

const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");

function runCleanThinRuntimeChild(config) {
  const childScript = path.resolve(__dirname, "check-thin-planner-runtime-child.js");
  const payload = JSON.stringify(config);
  const res = spawnSync(process.execPath, ["--expose-gc", childScript], {
    input: payload,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
    timeout: 120000,
  });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`Clean thin runtime child failed code=${res.status} stderr=${(res.stderr||"").slice(0,3000)} stdout=${(res.stdout||"").slice(0,2000)}`);
  }
  const lines = res.stdout.trim().split("\n");
  return { thinResult: JSON.parse(lines[lines.length - 1]), runtimeEvidence: res.stderr };
}

/**
 * Repair 2 – Final-failure semantics for a thin runMilestoneGraph result.
 *
 * Separates:
 *  - INITIAL_<seg>_OUTCOME: the first attempt on the failed segment (may be frontier-exhausted)
 *  - ADAPTIVE_ROLLBACK_TRIGGERED / waves / downstream replays
 *  - ADAPTIVE_RESOURCE_LIMITED: any adaptive wave/replay stopped on rss/heap/time/expansion
 *  - FINAL_CANONICAL_OUTCOME: RESOURCE_LIMITED | EXHAUSTED | FOUND | CANCELLED
 *
 * This prevents interpreting "initial frontier exhausted" as "canonical search space exhausted".
 */
function extractFinalFailureSemantics(thinResult) {
  const failed = thinResult.failedSegment || null;
  const backtrack = (failed && failed.backtrack) || null;
  const ledger = thinResult.evaluationAttemptLedger || [];
  const segments = thinResult.segmentResults || [];

  const initialAttempts = ledger.filter((att) => att.phase === "initial" && failed && att.segmentId === failed.segmentId);
  const initialOutcome = initialAttempts.length > 0
    ? (() => {
      const dp = initialAttempts[0].diagnostics && initialAttempts[0].diagnostics.dp;
      const outcome = dp && dp.searchOutcome ? dp.searchOutcome.outcomeClass : null;
      if (outcome) return outcome;
      return initialAttempts[0].found ? "FOUND" : "NOT_FOUND";
    })()
    : (failed && failed.failureClass) || "UNKNOWN";
  const initialStopReason = (() => {
    const dp = initialAttempts.length > 0 && initialAttempts[0].diagnostics && initialAttempts[0].diagnostics.dp;
    return (dp && dp.stoppedReason) || null;
  })();

  const adaptiveLedger = ledger.filter((att) => att.phase === "adaptive-expand" || att.phase === "adaptive-replay");
  const adaptiveRollbackTriggered = Boolean(backtrack && backtrack.attempted) || adaptiveLedger.length > 0;
  const resourceStopReasons = new Set(["rss-limit", "heap-limit", "time-limit", "expansion-limit"]);
  // Iteration 4 Repair 3 – RUN-WIDE completion authority.
  // The executionCompletionLedger records the final candidate completion of
  // EVERY real execution (initial / configured-repair / adaptive-expand /
  // adaptive-replay / expanded-previous / retry-current), including adaptive
  // executions that never reach segmentResults. Run-wide exhaustion semantics
  // must read THIS ledger, not the (upsert-overwritten) segmentResults.
  const completionLedger = Array.isArray(thinResult.executionCompletionLedger)
    ? thinResult.executionCompletionLedger
    : [];
  // Iteration 5 (P2) – unknown completion fails closed: an entry with a null
  // searchComplete has UNKNOWN final completion and must count as terminal
  // incompleteness (INCOMPLETE_SCOPE), never as 0/complete.
  const runWideUnknownCompletion = completionLedger.filter(
    (e) => e.searchComplete !== true && e.searchComplete !== false,
  ).length;
  const runWidePending = completionLedger.reduce((sum, e) => sum + Number(e.finalPending || 0), 0);
  const runWideTerminalIncomplete = completionLedger.reduce(
    (sum, e) => sum + Number(e.terminalIncomplete || 0),
    0,
  ) + runWideUnknownCompletion;
  const runWideFinalFound = completionLedger.reduce((sum, e) => sum + Number(e.finalFound || 0), 0);
  const runWideFinalComplete = completionLedger.reduce((sum, e) => sum + Number(e.finalComplete || 0), 0);
  const runWideHistoricalLocalStops = completionLedger.reduce(
    (sum, e) => sum + Number(e.historicalLocalTimeouts || 0) + Number(e.historicalLocalExpansionStops || 0),
    0,
  );
  // Fallback telemetry for runs produced before the ledger existed.
  const sliceTelemetry = (thinResult.segmentResults || [])
    .map((seg) => seg && seg.candidateSliceTelemetry)
    .filter(Boolean);
  const finalPending = completionLedger.length > 0
    ? runWidePending
    : sliceTelemetry.reduce((sum, t) => sum + Number(t.candidateSliceFinalPending || 0), 0);
  const terminalIncomplete = completionLedger.length > 0
    ? runWideTerminalIncomplete
    : sliceTelemetry.reduce((sum, t) => sum + Number(t.candidateSliceTerminalIncomplete || 0), 0);
  // Unrecovered memory/global hard stops still count as resource limitation.
  const memoryOrHardStop = ledger.some((att) => {
    const dp = att.diagnostics && att.diagnostics.dp;
    return dp && (dp.stoppedReason === "rss-limit" || dp.stoppedReason === "heap-limit");
  }) || Boolean(backtrack && backtrack.attempts && backtrack.attempts.some((att) => {
    const reason = att.depthStopReason || att.stopReason;
    return reason === "rss-limit" || reason === "heap-limit";
  }));

  const budgetStopped = thinResult.budget && thinResult.budget.stoppedReason;
  const memoryLimitedFailed = Boolean(failed && failed.failureClass === "memory-limited");
  // Legacy per-segment incomplete counter (kept as a secondary invariant).
  const incompleteSlices = sliceTelemetry.reduce((sum, t) => sum + Number(t.candidateSliceStillIncompleteAtGlobalStop || 0), 0);

  let finalCanonicalOutcome;
  if (thinResult.found) {
    finalCanonicalOutcome = "FOUND";
  } else if (
    memoryLimitedFailed ||
    memoryOrHardStop ||
    finalPending > 0 ||
    incompleteSlices > 0 ||
    (budgetStopped && resourceStopReasons.has(budgetStopped))
  ) {
    finalCanonicalOutcome = "RESOURCE_LIMITED";
  } else if (terminalIncomplete > 0) {
    // Trimmed action scope (actionTrimmed>0 etc.) is not a cancellation and not
    // a resource limit: the action scope itself was incomplete.
    finalCanonicalOutcome = "INCOMPLETE_SCOPE";
  } else if (thinResult.cancelled) {
    finalCanonicalOutcome = "CANCELLED";
  } else {
    finalCanonicalOutcome = "EXHAUSTED";
  }

  const depthSummaries = (backtrack && (backtrack.depthSummaries || backtrack.depths)) || [];
  return {
    failedSegmentId: failed ? failed.segmentId : null,
    initialOutcome,
    initialStopReason,
    initialFrontierExhausted: initialOutcome === "goal-not-found-search-complete" || initialOutcome === "frontier-exhausted",
    incompleteCandidateSlices: incompleteSlices,
    runWideCandidateCompletion: {
      executions: completionLedger.length,
      finalFound: runWideFinalFound,
      finalComplete: runWideFinalComplete,
      finalPending: runWidePending,
      terminalIncomplete: runWideTerminalIncomplete,
      unknownCompletion: runWideUnknownCompletion,
      historicalLocalStops: runWideHistoricalLocalStops,
      searchComplete: runWidePending === 0 && runWideTerminalIncomplete === 0,
    },
    adaptiveRollbackTriggered,
    adaptiveWavesAttempted: adaptiveLedger.filter((att) => att.phase === "adaptive-expand").length,
    adaptiveDownstreamReplayCount: adaptiveLedger.filter((att) => att.phase === "adaptive-replay").length,
    depthSummaries: depthSummaries.map((d) => ({
      depth: d.depth,
      depthOutcome: d.depthOutcome || null,
      depthExhausted: Boolean(d.depthExhausted),
      wavesAttempted: d.wavesAttempted != null ? d.wavesAttempted : undefined,
      wavesCompleted: d.wavesCompleted != null ? d.wavesCompleted : undefined,
      downstreamReplayCount: d.downstreamReplayCount != null ? d.downstreamReplayCount : undefined,
      stopReason: d.stopReason != null ? d.stopReason : (d.depthStopReason || null),
    })),
    // Final semantics no longer equate historical local slice stops with final
    // resource limitation; recovered stops are folded into authoritative
    // completion. Kept as diagnostics for the report only.
    adaptiveResourceLimited: Boolean(
      (budgetStopped && resourceStopReasons.has(budgetStopped)) ||
      finalPending > 0 ||
      memoryOrHardStop ||
      memoryLimitedFailed,
    ),
    budgetStoppedReason: budgetStopped || null,
    finalCanonicalOutcome,
  };
}

function main() {
  console.log("== Thin Planner Clean Runtime (isolated child, no heavy imports) ==");
  const { thinResult, runtimeEvidence } = runCleanThinRuntimeChild({
    routeName: "onlyup-chaos-mt1-mt4",
    maxExpansions: 50000,
    maxRuntimeMs: 30000,
    maxRssMb: 256,
    adaptiveBacktrackDepth: 3,
    searchIntent: "adaptive-feasible",
    budgetScope: "global-run",
    stopFloorId: FIRST_REGION_TARGET_FLOOR_ID,
    projectRoot: DEFAULT_PROJECT_ROOT,
  });
  console.log(`Child runtime evidence: ${runtimeEvidence.trim().split("\n").pop()}`);

  const bootstrap = thinResult.bootstrap;
  assert.ok(bootstrap && bootstrap.simulatorProfile, "Bootstrap must return simulatorProfile");
  assert.ok(bootstrap.initialStateKey, "Bootstrap must have initialStateKey");

  // --- P1-1: whole-run budget identity (bootstrap included in 30s) ---
  assert.ok(thinResult.budget, "Thin must have budget");
  assert.strictEqual(thinResult.budget.scope, "global-run");
  assert.strictEqual(thinResult.budget.requestedRuntimeMs, 30000, "requestedRuntimeMs must report original 30000, not post-bootstrap remainder");
  assert.ok(thinResult.overallStartedAt && thinResult.overallDeadlineMs, "Thin must expose whole-run deadline");
  assert.ok(thinResult.lifecycleTelemetry.overallWallMs > 0, "overallWallMs must be measured");
  assert.ok(
    thinResult.lifecycleTelemetry.overallWallMs <= 30000,
    `Whole-run wall (bootstrap + graph) ${thinResult.lifecycleTelemetry.overallWallMs}ms exceeds 30000ms`,
  );
  assert.ok(
    thinResult.lifecycleTelemetry.overallWallMs >= thinResult.lifecycleTelemetry.bootstrapWallMs,
    "overallWallMs must include bootstrap wall time",
  );

  // --- P1-2: overall process-tree peak (phase-correct, Iteration 2c) ---
  const thinProcessTree = thinResult.processTreeMemory;
  assert.ok(thinProcessTree, "Thin result must have processTreeMemory");
  assert.ok(
    thinProcessTree.bootstrapConcurrentUpperBoundMb >=
      Math.round((Math.max(bootstrap.plannerRssAtBootstrapSpawnMb || 0, 0) + bootstrap.bootstrapPeakRssMb) * 10) / 10 - 0.5,
    `bootstrapConcurrentUpperBoundMb ${thinProcessTree.bootstrapConcurrentUpperBoundMb} must be the child-live concurrent sum (plannerAtSpawn + workerPeak)`,
  );
  assert.ok(
    thinProcessTree.maxConcurrentProcessTreeRssMb >= thinProcessTree.bootstrapOverallPeakMb - 0.5,
    "overall peak must include bootstrap overall (phase-correct) peak",
  );
  assert.ok(
    thinProcessTree.maxConcurrentProcessTreeRssMb >= thinProcessTree.segmentMaxAggregateConcurrentRssUpperBoundMb - 0.5,
    "overall peak must include segment aggregate",
  );
  assert.ok(thinProcessTree.maxConcurrentProcessTreeRssMb <= 260, `Thin overall processTree ${thinProcessTree.maxConcurrentProcessTreeRssMb} > 260`);
  assert.ok(thinProcessTree.overshootMb <= 4, `Thin overall overshoot ${thinProcessTree.overshootMb} > 4`);
  assert.strictEqual(thinProcessTree.qualified, true, "Overall process-tree qualification must pass");

  // --- P1-3: clean RSS + computed (not self-attested) heavy-module evidence ---
  const plannerBaseline = thinResult.lifecycleTelemetry.plannerBaselineRssMb;
  assert.ok(typeof plannerBaseline === "number" && plannerBaseline > 0, "plannerBaselineRssMb must be measured");
  assert.ok(plannerBaseline < 65, `Clean thin planner baseline ${plannerBaseline} not thin (<65) – heavy ~70`);
  if (plannerBaseline > 45) {
    console.warn(`Clean thin planner baseline ${plannerBaseline}MB above 45MB target (heavy ~70MB) – optimization candidate, not hard failure`);
  }
  assert.strictEqual(thinResult.lifecycleTelemetry.thinPlannerNeverLoadsProject, true, "Computed evidence: project-loader must not be in planner require.cache");
  assert.strictEqual(thinResult.lifecycleTelemetry.thinPlannerNeverConstructsSimulator, true, "Computed evidence: simulator must not be in planner require.cache");
  assert.deepStrictEqual(
    thinResult.lifecycleTelemetry.heavyModulesLoadedInPlannerProcess,
    [],
    "No heavy module may be loaded in the thin planner process",
  );

  // --- Isolated invocation identity gates via thin path ---
  assert.ok(thinResult.isolatedProcessTreeTelemetry.isolatedInvocationCount > 0, "Thin must have isolated invocations");
  const thinRecords = thinResult.isolatedProcessTreeTelemetry.records || [];
  thinRecords.forEach((rec) => {
    // Pre-spawn budget-exhausted invocations never ran a worker: identity flags are
    // "not run" (executed=false, zero verified counts), not verification failures.
    const notRun = rec.executed === false && rec.inputStateKeysVerified === 0 && rec.outputStateKeysVerified === 0 && Number(rec.consumedExpansions || 0) === 0;
    if (notRun) return;
    assert.strictEqual(rec.stateRoundTripIdentity, true, `Thin record ${rec.segmentId} stateRoundTripIdentity false`);
    assert.strictEqual(rec.simulatorProfileIdentity, true, `Thin record ${rec.segmentId} profileIdentity false`);
    if (rec.expectedProjectIdentity) {
      assert.strictEqual(rec.projectIdentityMatch, true, `Thin record ${rec.segmentId} projectIdentityMatch false`);
      assert.ok(rec.appliedProjectIdentity, `Thin record ${rec.segmentId} missing appliedProjectIdentity`);
    }
  });
  const executedThinRecords = thinRecords.filter((rec) => !(rec.executed === false && rec.inputStateKeysVerified === 0 && rec.outputStateKeysVerified === 0));
  assert.ok(executedThinRecords.length > 0, "Thin must have at least one executed isolated invocation");

  // --- Repair 2: MT1→MT4 final-failure semantics (initial vs canonical final outcome) ---
  console.log("== Thin MT1→MT4 Final-Failure Semantics ==");
  const mt4Semantics = extractFinalFailureSemantics(thinResult);
  console.log(JSON.stringify(mt4Semantics));
  assert.ok(mt4Semantics.finalCanonicalOutcome, "Final canonical outcome must be classified");
  // Initial MT2→MT3 frontier exhaustion must be recorded distinctly from the final outcome
  if (mt4Semantics.failedSegmentId === "mt2-to-mt3" && mt4Semantics.initialFrontierExhausted) {
    assert.strictEqual(
      mt4Semantics.initialStopReason,
      null,
      "Initial MT2→MT3 frontier exhaustion must have no stop reason (non-resource)",
    );
    // The canonical final outcome must NOT be claimed as EXHAUSTED while adaptive repair
    // was itself resource-truncated.
    if (mt4Semantics.adaptiveResourceLimited) {
      assert.notStrictEqual(
        mt4Semantics.finalCanonicalOutcome,
        "EXHAUSTED",
        "Adaptive repair was resource-limited; final outcome must be RESOURCE_LIMITED, not EXHAUSTED",
      );
    }
  }
  // --- Iteration 2c Repair 1: MT1→MT4 RSS-to-wall transfer contract ---
  // MT4 may legitimately fail (not found yet), but the binding constraint must be
  // wall time, NOT RSS/heap/expansions. A regression back to rss-limit must turn
  // this gate red immediately. When MT4 is eventually found, only the resource
  // prohibition below still applies.
  if (!thinResult.found) {
    const mt4LedgerStops = (thinResult.evaluationAttemptLedger || [])
      .map((att) => att.diagnostics && att.diagnostics.dp && att.diagnostics.dp.stoppedReason)
      .filter(Boolean);
    assert.ok(!mt4LedgerStops.includes("rss-limit"), `MT1→MT4 must not regress to rss-limit (ledger stops: ${mt4LedgerStops.join(",") || "none"})`);
    assert.ok(!mt4LedgerStops.includes("heap-limit"), `MT1→MT4 must not regress to heap-limit (ledger stops: ${mt4LedgerStops.join(",") || "none"})`);
    assert.ok(!mt4LedgerStops.includes("expansion-limit"), `MT1→MT4 must not regress to expansion-limit (ledger stops: ${mt4LedgerStops.join(",") || "none"})`);
    assert.ok(
      thinResult.budget.stoppedReason == null || thinResult.budget.stoppedReason === "time-limit",
      `MT1→MT4 global stop reason must be time-limit (or null), got ${thinResult.budget.stoppedReason}`,
    );
  }

  // --- Iteration 2c Repair 1: Thin MT1→MT3 restored capability is a CONTRACT ---
  // The capability was empirically restored by phase-correct RSS + wave live-set
  // flattening (8/8 found, peak 243-245, wall ~17s). This gate now fail-closes:
  // any regression back to envelope/rss-limit forms is a TEST FAILURE, not a
  // diagnostic classification. extractFinalFailureSemantics() is retained for
  // diagnostics only.
  console.log("== Thin MT1→MT3 Restored Capability Contract (clean child, depth=2) ==");
  const { thinResult: thinMt3 } = runCleanThinRuntimeChild({
    routeName: "onlyup-chaos-mt1-mt3",
    maxExpansions: 50000,
    maxRuntimeMs: 30000,
    maxRssMb: 256,
    adaptiveBacktrackDepth: 2,
    searchIntent: "adaptive-feasible",
    budgetScope: "global-run",
    stopFloorId: FIRST_REGION_TARGET_FLOOR_ID,
    projectRoot: DEFAULT_PROJECT_ROOT,
  });
  const mt3Records = thinMt3.isolatedProcessTreeTelemetry.records || [];
  mt3Records.forEach((rec) => {
    const notRun = rec.executed === false && rec.inputStateKeysVerified === 0 && rec.outputStateKeysVerified === 0 && Number(rec.consumedExpansions || 0) === 0;
    if (notRun) return;
    assert.strictEqual(rec.stateRoundTripIdentity, true, `Thin MT1→MT3 record ${rec.segmentId} stateRoundTripIdentity false`);
    assert.strictEqual(rec.simulatorProfileIdentity, true, `Thin MT1→MT3 record ${rec.segmentId} profileIdentity false`);
    if (rec.expectedProjectIdentity) {
      assert.strictEqual(rec.projectIdentityMatch, true, `Thin MT1→MT3 record ${rec.segmentId} projectIdentityMatch false`);
    }
  });
  // Hard contract: capability MUST be found
  assert.strictEqual(thinMt3.found, true, `Thin MT1→MT3 restored capability is a contract: found=false (regression to ${extractFinalFailureSemantics(thinMt3).finalCanonicalOutcome})`);
  assert.strictEqual(thinMt3.reachedMilestone, "mt2-to-mt3", `Thin MT1→MT3 reachedMilestone must be mt2-to-mt3, got ${thinMt3.reachedMilestone}`);
  assert.ok(thinMt3.finalCandidates && thinMt3.finalCandidates.length > 0, "Thin MT1→MT3 must produce final candidates");
  // Whole-run budget + process-tree hard gates
  assert.strictEqual(thinMt3.budget.requestedRuntimeMs, 30000, "Thin MT1→MT3 requestedRuntimeMs must report original 30000");
  assert.ok(thinMt3.budget.consumedExpansions <= 50000, `Thin MT1→MT3 consumed expansions ${thinMt3.budget.consumedExpansions} > 50000`);
  assert.ok(thinMt3.lifecycleTelemetry.overallWallMs <= 30000, `Thin MT1→MT3 whole-run wall ${thinMt3.lifecycleTelemetry.overallWallMs}ms exceeded 30000`);
  assert.ok(thinMt3.processTreeMemory.maxConcurrentProcessTreeRssMb <= 260, `Thin MT1→MT3 processTree ${thinMt3.processTreeMemory.maxConcurrentProcessTreeRssMb} > 260`);
  assert.ok(thinMt3.processTreeMemory.overshootMb <= 4, `Thin MT1→MT3 overshoot ${thinMt3.processTreeMemory.overshootMb} > 4`);
  // Hard contract: NO resource stops of any kind
  const mt3LedgerStops = (thinMt3.evaluationAttemptLedger || [])
    .map((att) => att.diagnostics && att.diagnostics.dp && att.diagnostics.dp.stoppedReason)
    .filter(Boolean);
  assert.ok(!mt3LedgerStops.includes("rss-limit"), `Thin MT1→MT3 must not be rss-limited (ledger stops: ${mt3LedgerStops.join(",") || "none"})`);
  assert.ok(!mt3LedgerStops.includes("heap-limit"), `Thin MT1→MT3 must not be heap-limited (ledger stops: ${mt3LedgerStops.join(",") || "none"})`);
  assert.ok(!mt3LedgerStops.includes("expansion-limit"), `Thin MT1→MT3 must not be expansion-limited (ledger stops: ${mt3LedgerStops.join(",") || "none"})`);
  assert.notStrictEqual(thinMt3.budget.stoppedReason, "rss-limit", "Thin MT1→MT3 global budget must not be rss-limited");
  assert.notStrictEqual(thinMt3.budget.stoppedReason, "heap-limit", "Thin MT1→MT3 global budget must not be heap-limited");
  assert.notStrictEqual(thinMt3.budget.stoppedReason, "expansion-limit", "Thin MT1→MT3 global budget must not be expansion-limited");

  const mt3Semantics = extractFinalFailureSemantics(thinMt3);
  const thinMt3CapabilityRetained = true;
  let mt3StrictReplayPassed = 0;
  const mt3ReplayedCandidates = [];
  console.log(JSON.stringify({
    thinMt1ToMt3Found: true,
    capabilityRetained: true,
    classification: "CAPABILITY_RETAINED",
    finalCanonicalOutcome: mt3Semantics.finalCanonicalOutcome,
    ledgerStops: mt3LedgerStops,
    workerPeaks: mt3Records.map((rec) => rec.workerPeakRssMb),
    workerEnvelopes: mt3Records.map((rec) => rec.workerMaxRssMb),
  }));

  // --- Heavy side (separate from clean thin measurement) ---
  console.log("== Thin Milestone Normalization Parity (MT1→MT4) ==");
  const project = loadProject(DEFAULT_PROJECT_ROOT);
  const heavySpec = getMilestoneSpec(project, "onlyup-chaos-mt1-mt4");
  const thinSpec = loadMilestoneSpecThin("onlyup-chaos-mt1-mt4");
  assert.deepStrictEqual(
    thinSpec.milestones,
    heavySpec.milestones,
    "Thin (project=null) milestones must deep-equal heavy getMilestoneSpec(project).milestones",
  );

  // --- Micro fixture: successor presentTiles propagation semantics ---
  const fixture = [
    { id: "m1", label: "M1", goal: { floorId: "MT1", presentTiles: [{ floorId: "MT1", x: 1, y: 1 }] } },
    { id: "m2", label: "M2", startFrom: "m1", goal: { floorId: "MT2", presentTiles: [{ floorId: "MT2", x: 2, y: 2 }] } },
  ];
  const propagated = propagateSuccessorHardPresentTiles(fixture);
  const m1Tiles = propagated[0].goal.presentTiles;
  assert.strictEqual(m1Tiles.length, 2, "Successor hard presentTiles must propagate to predecessor");
  assert.ok(m1Tiles.some((t) => t.propagatedFromMilestone === "m2"), "Propagated tile must carry propagatedFromMilestone");
  assert.ok(m1Tiles.some((t) => t.floorId === "MT1" && t.x === 1 && t.y === 1), "Original tile preserved");
  assert.ok(!m1Tiles.some((t) => t.floorId === "MT2" && !t.propagatedFromMilestone), "Successor tile only appears via propagation");
  const noPropagate = propagateSuccessorHardPresentTiles([
    { id: "m1", label: "M1", goal: { floorId: "MT1" } },
    { id: "m2", label: "M2", startFrom: "m1", goal: { floorId: "MT2", presentTiles: [{ floorId: "MT2", x: 2, y: 2 }] } },
  ]);
  assert.ok(!Array.isArray(noPropagate[0].goal.presentTiles) || noPropagate[0].goal.presentTiles.length === 1,
    "Unrelated successor tiles still propagate into predecessor's presentTiles list");

  console.log("== Thin-vs-Current Isolated Parity (MT1→MT2) ==");
  const heavySimulator = new StaticSimulator(project, {
    stopFloorId: FIRST_REGION_TARGET_FLOOR_ID,
    battleResolver: new FunctionBackedBattleResolver(project, { enableFastReject: true }),
    autoBattleFastRejectEnabled: true,
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFastHazardBlockIndex: true,
    enableCompiledEffectCache: false,
    choiceResolver: createNoStateChangeChoiceResolver(),
  });
  const heavyInitialState = heavySimulator.createInitialState();
  const heavyKey = buildStateKey(heavyInitialState);
  assert.strictEqual(heavyKey, bootstrap.initialStateKey, "Heavy vs bootstrap initial StateKey must match (same Chaos start)");

  const spec = heavySpec;
  const mt1ToMt2 = spec.milestones.find((s) => s.id === "mt1-to-mt2");
  const frontier = [{ id: "initial#0", state: heavyInitialState, tags: ["initial"] }];
  const probeConfig = { maxExpansions: 8000, maxRuntimeMs: 30000, maxRssMb: 1024, candidateLimit: 8, segmentExecutionMode: "isolated-process" };
  const heavyIsolated = runSegmentAgainstFrontier(heavySimulator, mt1ToMt2, frontier, probeConfig, {});
  const thinDescriptor = { projectRoot: bootstrap.projectRoot, simulatorProfile: bootstrap.simulatorProfile, projectIdentity: bootstrap.projectIdentity };
  const thinIsolated = runSegmentAgainstFrontier(null, mt1ToMt2, frontier, { ...probeConfig, isolatedRuntimeDescriptor: thinDescriptor }, {});
  assert.strictEqual(heavyIsolated.merged.length, thinIsolated.merged.length, `Thin vs heavy goalCount mismatch heavy=${heavyIsolated.merged.length} thin=${thinIsolated.merged.length}`);
  const heavyKeys = heavyIsolated.merged.map((c) => buildStateKey(c.state)).sort();
  const thinKeys = thinIsolated.merged.map((c) => buildStateKey(c.state)).sort();
  assert.deepStrictEqual(heavyKeys, thinKeys, "Thin vs heavy sorted StateKeys mismatch");
  assert.strictEqual(heavyIsolated.memoryLimited, thinIsolated.memoryLimited, "Thin vs heavy memoryLimited mismatch");
  assert.strictEqual(heavyIsolated.memoryStopReason, thinIsolated.memoryStopReason, "Thin vs heavy stopReason mismatch");
  const heavyFailure = heavyIsolated.summary && heavyIsolated.summary.failurePropagation ? heavyIsolated.summary.failurePropagation.failureClass : null;
  const thinFailure = thinIsolated.summary && thinIsolated.summary.failurePropagation ? thinIsolated.summary.failurePropagation.failureClass : null;
  assert.strictEqual(heavyFailure, thinFailure, "Thin vs heavy failureClass mismatch");
  assert.strictEqual(thinIsolated.telemetry.simulatorProfileIdentity, true);
  assert.strictEqual(thinIsolated.telemetry.projectIdentityMatch, true, "Thin isolated telemetry must verify projectIdentity");
  assert.ok(thinIsolated.telemetry.appliedProjectIdentity, "Thin isolated telemetry must return appliedProjectIdentity");

  console.log("== Envelope Fail-Closed Negative Probes ==");
  const os = require("node:os");
  const fs = require("node:fs");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "envelope-probe-"));
  const workerScript = path.resolve(__dirname, "segment-worker.js");
  const inputPath = path.join(tmpDir, "input.json");
  const outputPath = path.join(tmpDir, "output.json");
  const envelopePath = path.join(tmpDir, "envelope.json");
  fs.writeFileSync(inputPath, JSON.stringify({
    invocationId: "probe-1",
    projectRoot: DEFAULT_PROJECT_ROOT,
    simulatorProfile: { stopFloorId: "MT6" },
    segment: { id: "probe", label: "probe" },
    inputFrontier: [],
    parentInputStateKeys: [],
  }));
  try {
    // Probe 1: isolated invocation without envelope -> protocol error
    const probe1 = spawnSync(process.execPath, [workerScript, inputPath, outputPath], { encoding: "utf8", timeout: 20000 });
    assert.strictEqual(probe1.status, 5, `Missing envelope must exit 5, got ${probe1.status}`);
    assert.match(probe1.stderr || "", /Missing required envelope/, "Missing envelope must be diagnosed");
    // Probe 2: envelope invocationId mismatch -> protocol error
    fs.writeFileSync(envelopePath, JSON.stringify({ invocationId: "other", workerMaxRssMb: 100, workerHardCeilingMb: 104 }));
    const probe2 = spawnSync(process.execPath, [workerScript, inputPath, outputPath, envelopePath], { encoding: "utf8", timeout: 20000 });
    assert.strictEqual(probe2.status, 5, `invocationId mismatch must exit 5, got ${probe2.status}`);
    assert.match(probe2.stderr || "", /invocationId mismatch/, "invocationId mismatch must be diagnosed");
    // Probe 3: invalid workerMaxRssMb (0) -> protocol error
    fs.writeFileSync(envelopePath, JSON.stringify({ invocationId: "probe-1", workerMaxRssMb: 0, workerHardCeilingMb: 104 }));
    const probe3 = spawnSync(process.execPath, [workerScript, inputPath, outputPath, envelopePath], { encoding: "utf8", timeout: 20000 });
    assert.strictEqual(probe3.status, 5, `Invalid workerMaxRssMb must exit 5, got ${probe3.status}`);
    assert.match(probe3.stderr || "", /Invalid envelope workerMaxRssMb/, "Invalid workerMaxRssMb must be diagnosed");
    // Probe 4: NaN workerHardCeilingMb -> protocol error
    fs.writeFileSync(envelopePath, JSON.stringify({ invocationId: "probe-1", workerMaxRssMb: 100, workerHardCeilingMb: "abc" }));
    const probe4 = spawnSync(process.execPath, [workerScript, inputPath, outputPath, envelopePath], { encoding: "utf8", timeout: 20000 });
    assert.strictEqual(probe4.status, 5, `Invalid workerHardCeilingMb must exit 5, got ${probe4.status}`);
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }

  console.log(`Parity heavy vs thin MT1→MT2: both found ${heavyIsolated.merged.length} candidates, keys identical`);

  // --- Repair 2: fresh strict replay of Thin MT1→MT3 final candidates (only when retained) ---
  if (thinMt3CapabilityRetained) {
    console.log("== Thin MT1→MT3 Fresh Strict Replay (real MT1, fresh simulator) ==");
    const { verifyCandidateStrictReplay } = require("./check-onlyup-adaptive-mt1-mt3");
    thinMt3.finalCandidates.forEach((cand) => {
      const replay = verifyCandidateStrictReplay(project, cand);
      if (replay.passed) {
        mt3StrictReplayPassed += 1;
        if (replay.finalFloorId === "MT3") {
          mt3ReplayedCandidates.push({
            candidateId: cand.id,
            finalFloorId: replay.finalFloorId,
            decisionsReplayed: replay.decisionsReplayed,
            identityGradedDecisions: replay.identityGradedDecisions,
            finalHero: replay.finalHero,
          });
        }
      }
    });
    assert.strictEqual(
      mt3StrictReplayPassed,
      thinMt3.finalCandidates.length,
      `Thin MT1→MT3 strict replay ${mt3StrictReplayPassed}/${thinMt3.finalCandidates.length} failed`,
    );
    assert.ok(mt3ReplayedCandidates.length > 0, "At least one replayed Thin MT1→MT3 candidate must reach MT3");
  }

  const summary = {
    schema: "motapathfinder.thin-planner.v1",
    contractStatus: "passed",
    thinPlanner: {
      neverLoadsProject: thinResult.lifecycleTelemetry.thinPlannerNeverLoadsProject,
      neverConstructsSimulator: thinResult.lifecycleTelemetry.thinPlannerNeverConstructsSimulator,
      heavyModulesLoadedInPlannerProcess: thinResult.lifecycleTelemetry.heavyModulesLoadedInPlannerProcess,
      plannerBaselineRssMb: plannerBaseline,
      maxConcurrentProcessTreeRssMb: thinProcessTree.maxConcurrentProcessTreeRssMb,
      bootstrapPeakRssMb: bootstrap.bootstrapPeakRssMb,
      bootstrapConcurrentUpperBoundMb: thinProcessTree.bootstrapConcurrentUpperBoundMb,
      bootstrapOverallPeakMb: thinProcessTree.bootstrapOverallPeakMb,
      isolatedInvocationCount: thinResult.isolatedProcessTreeTelemetry.isolatedInvocationCount,
      processTreeQualified: thinProcessTree.qualified,
    },
    thinMt1ToMt3Capability: {
      found: thinMt3.found,
      classification: "CAPABILITY_RETAINED",
      contract: "fail-closed (restored capability is a regression gate)",
      reachedMilestone: thinMt3.reachedMilestone,
      overallWallMs: thinMt3.lifecycleTelemetry.overallWallMs,
      maxConcurrentProcessTreeRssMb: thinMt3.processTreeMemory.maxConcurrentProcessTreeRssMb,
      consumedExpansions: thinMt3.budget.consumedExpansions,
      finalCanonicalOutcome: mt3Semantics.finalCanonicalOutcome,
      ledgerStops: mt3LedgerStops,
      workerPeaksRssMb: mt3Records.map((rec) => rec.workerPeakRssMb),
      workerEnvelopesRssMb: mt3Records.map((rec) => rec.workerMaxRssMb),
      strictReplayPassed: mt3StrictReplayPassed === thinMt3.finalCandidates.length && mt3StrictReplayPassed > 0,
      replayedCandidates: mt3ReplayedCandidates,
    },
    mt1ToMt4FinalFailure: mt4Semantics,
    mt1ToMt4ResourceBinding: thinResult.found
      ? "FOUND"
      : (thinResult.budget.stoppedReason === "time-limit"
        ? "TIME_LIMIT (rss/heap/expansion prohibited)"
        : (mt4Semantics.finalCanonicalOutcome === "EXHAUSTED"
          ? "SEARCH_EXHAUSTED (canonical search graph completed without MT4 – algorithm phase)"
          : `INDETERMINATE (stop=${thinResult.budget.stoppedReason}, outcome=${mt4Semantics.finalCanonicalOutcome})`)),
    lifecycleBudget: {
      requestedRuntimeMs: thinResult.budget.requestedRuntimeMs,
      overallWallMs: thinResult.lifecycleTelemetry.overallWallMs,
      bootstrapWallMs: thinResult.lifecycleTelemetry.bootstrapWallMs,
      wholeRunWithinDeadline: thinResult.lifecycleTelemetry.overallWallMs <= 30000,
    },
    milestoneParity: {
      thinVsHeavyMilestonesDeepEqual: true,
      successorPresentTilesPropagationLocked: true,
    },
    parity: {
      heavyVsThinStateKeyIdentity: true,
      mt1ToMt2GoalCount: heavyIsolated.merged.length,
      projectIdentityMatch: true,
    },
    run: {
      found: thinResult.found,
      reachedMilestone: thinResult.reachedMilestone,
      segmentSummaries: thinResult.segmentResults.map((s) => ({ id: s.segmentId, found: s.found, candidates: (s.candidates || []).length })),
    },
  };
  console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) {
  try { main(); } catch (e) { console.error(e && e.stack ? e.stack : String(e)); process.exit(1); }
}
module.exports = { main };
