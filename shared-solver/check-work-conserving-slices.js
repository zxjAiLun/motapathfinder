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
  // Global wall 2.5s: first fair slice ≈ 833ms is insufficient for A
  // (local time-limit), B/C complete instantly and release their slices,
  // A's retry receives the remaining ~1.6s and finds the goal.
  const segment = spec.milestones[1];
  const frontier = [
    { id: "A", state: states.mt2State, tags: [] },
    { id: "B", state: states.atGoal, tags: [] },
    { id: "C", state: states.atGoal, tags: [] },
  ];
  const budget = makeBudget(50000, 1100);
  const result = runSegmentAgainstFrontierLocal(
    simulator,
    segment,
    frontier,
    { globalBudget: budget, maxRssMb: 1024, memoryCheckIntervalExpansions: 1 },
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
  const budget = makeBudget(50000, 1100);
  const result = runSegmentAgainstFrontierLocal(
    simulator,
    segment,
    frontier,
    { globalBudget: budget, maxRssMb: 1024, memoryCheckIntervalExpansions: 1 },
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

  console.log(JSON.stringify({
    schema: "motapathfinder.work-conserving-slices.v2",
    contractStatus: "passed",
    fairSlice: fair,
    deferredRecovery: recovery,
    exactIncomplete: incomplete,
    terminationGuard: guard,
    terminalIncomplete,
    recoveredStopNotResourceLimited: recoveredStop,
  }, null, 2));
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  }
}

module.exports = { main };
