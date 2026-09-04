"use strict";

const path = require("node:path");
const assert = require("node:assert");
const {
  executeIsolatedSegment,
  executeIsolatedSegmentBatch,
} = require("./lib/isolated-segment-executor");
const { runMilestoneGraph } = require("./lib/segment-dp");
const { loadProject } = require("./lib/project-loader");
const { StaticSimulator } = require("./lib/simulator");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { buildStateKey } = require("./lib/state-key");

const PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");

function createTestHarness() {
  const project = loadProject(PROJECT_ROOT);
  const simulator = new StaticSimulator(project, {
    stopFloorId: "MT2",
    battleResolver: new FunctionBackedBattleResolver(project, { enableFastReject: true }),
    autoBattleFastRejectEnabled: true,
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFastHazardBlockIndex: true,
    enableCompiledEffectCache: false,
  });
  return { project, simulator };
}

// G25-A: Equivalence Gate: same synthetic jobs run via legacy vs batch have identical output identity
function gateG25A_Equivalence() {
  const { simulator } = createTestHarness();
  const s0 = simulator.createInitialState();

  const segment = {
    id: "equiv-seg",
    label: "Equiv Segment",
    goal: { floorId: "MT1", minHero: { money: 100 } },
    actionPolicy: { allowedFloors: ["MT1"] },
    dp: { maxExpansions: 15, maxRuntimeMs: 2000 },
  };

  const jobs = [
    {
      jobId: "jobA",
      segment,
      inputFrontier: [{ id: "c0", state: s0 }],
    },
    {
      jobId: "jobB",
      segment,
      inputFrontier: [{ id: "c1", state: s0 }],
    },
  ];

  const config = {
    projectRoot: PROJECT_ROOT,
    maxExpansions: 500,
    maxRuntimeMs: 10000,
    maxRssMb: 2048,
  };

  // Run legacy
  const leg0 = executeIsolatedSegment({
    simulator,
    segment,
    frontier: jobs[0].inputFrontier,
    config,
  });
  const leg1 = executeIsolatedSegment({
    simulator,
    segment,
    frontier: jobs[1].inputFrontier,
    config,
  });

  // Run batch
  const batchRes = executeIsolatedSegmentBatch({
    simulator,
    jobs,
    config,
  });

  assert.strictEqual(batchRes.length, 2, "G25-A: batch must return 2 results");

  // Compare job 0
  assert.strictEqual(batchRes[0].summary.found, leg0.summary.found, "G25-A: job 0 found match");
  assert.strictEqual(batchRes[0].summary.failureClass, leg0.summary.failureClass, "G25-A: job 0 failureClass match");
  assert.strictEqual(
    batchRes[0].summary.candidateSliceTelemetry.candidateSliceSearchComplete,
    leg0.summary.candidateSliceTelemetry.candidateSliceSearchComplete,
    "G25-A: job 0 searchComplete match",
  );
  assert.strictEqual(
    batchRes[0].summary.candidateSliceTelemetry.candidateSliceFinalPending,
    leg0.summary.candidateSliceTelemetry.candidateSliceFinalPending,
    "G25-A: job 0 finalPending match",
  );
  assert.strictEqual(batchRes[0].merged.length, leg0.merged.length, "G25-A: job 0 merged count match");
  assert.deepStrictEqual(
    batchRes[0].merged.map((c) => buildStateKey(c.state)).sort(),
    leg0.merged.map((c) => buildStateKey(c.state)).sort(),
    "G25-A: job 0 output state keys match",
  );

  // Compare job 1
  assert.strictEqual(batchRes[1].summary.found, leg1.summary.found, "G25-A: job 1 found match");
  assert.strictEqual(batchRes[1].summary.failureClass, leg1.summary.failureClass, "G25-A: job 1 failureClass match");
  assert.strictEqual(
    batchRes[1].summary.candidateSliceTelemetry.candidateSliceSearchComplete,
    leg1.summary.candidateSliceTelemetry.candidateSliceSearchComplete,
    "G25-A: job 1 searchComplete match",
  );
  assert.strictEqual(batchRes[1].merged.length, leg1.merged.length, "G25-A: job 1 merged count match");
  assert.deepStrictEqual(
    batchRes[1].merged.map((c) => buildStateKey(c.state)).sort(),
    leg1.merged.map((c) => buildStateKey(c.state)).sort(),
    "G25-A: job 1 output state keys match",
  );

  return {
    jobsChecked: 2,
    equivalenceExact: true,
  };
}

// G25-B: Global-stop Gate: jobs after global budget runs out must return executed=false, searchComplete=false
function gateG25B_GlobalStop() {
  const { simulator } = createTestHarness();
  const s0 = simulator.createInitialState();

  const segment = {
    id: "stop-seg",
    label: "Stop Segment",
    goal: { floorId: "MT1", minHero: { money: 100 } },
    actionPolicy: { allowedFloors: ["MT1"] },
    dp: { maxExpansions: 50, maxRuntimeMs: 2000 },
  };

  const jobs = [
    { jobId: "jA", segment, inputFrontier: [{ id: "cA", state: s0 }], probeExpansionCap: 50, probeDeadlineMs: Date.now() + 2000 },
    { jobId: "jB", segment, inputFrontier: [{ id: "cB", state: s0 }], probeExpansionCap: 50, probeDeadlineMs: Date.now() + 2000 },
    { jobId: "jC", segment, inputFrontier: [{ id: "cC", state: s0 }], probeExpansionCap: 50, probeDeadlineMs: Date.now() + 2000 },
  ];

  // Budget allows jA to run, but runs out before jB or jC
  const batchRes = executeIsolatedSegmentBatch({
    simulator,
    jobs,
    config: {
      projectRoot: PROJECT_ROOT,
      maxExpansions: 15, // job A takes ~15 expansions, then budget exhausted
      maxRuntimeMs: 5000,
    },
  });

  assert.strictEqual(batchRes.length, 3, "G25-B: must return 3 results");
  assert.strictEqual(batchRes[0].telemetry.executed, true, "G25-B: job A executed");

  // Job C was never executed due to budget exhaustion
  const lastJob = batchRes[2];
  assert.strictEqual(lastJob.telemetry.executed, false, "G25-B: job C not executed");
  assert.strictEqual(
    lastJob.summary.candidateSliceTelemetry.candidateSliceSearchComplete,
    false,
    "G25-B: unexecuted job must have searchComplete=false",
  );
  assert.ok(
    lastJob.summary.candidateSliceTelemetry.candidateSliceFinalPending > 0,
    "G25-B: unexecuted job must have finalPending > 0",
  );
  assert.notStrictEqual(
    lastJob.summary.failurePropagation.failureClass,
    "exhausted",
    "G25-B: unexecuted job must NEVER report exhausted",
  );

  return {
    preSpawnOrMidBatchStopEnforced: true,
    unexecutedJobNeverExhausted: true,
  };
}

// G25-C: State leakage Gate: Job A modifies state; Job B from independent state has no leakage
function gateG25C_StateIsolation() {
  const { simulator } = createTestHarness();
  const s0 = simulator.createInitialState();

  // State with modified flags/mutations
  const modifiedState = JSON.parse(JSON.stringify(s0));
  modifiedState.hero.hp = 9999;
  modifiedState.hero.atk = 888;
  modifiedState.flags.customFlag = "jobA_taint";
  modifiedState.floorStates.MT1.removed["5,5"] = true;

  const segment = {
    id: "iso-seg",
    label: "Isolation Segment",
    goal: { floorId: "MT1", minHero: { money: 1 } },
    actionPolicy: { allowedFloors: ["MT1"] },
    dp: { maxExpansions: 20, maxRuntimeMs: 1000 },
  };

  const jobs = [
    { jobId: "taintJob", segment, inputFrontier: [{ id: "mod", state: modifiedState }], probeExpansionCap: 20, probeDeadlineMs: Date.now() + 1000 },
    { jobId: "cleanJob", segment, inputFrontier: [{ id: "clean", state: s0 }], probeExpansionCap: 20, probeDeadlineMs: Date.now() + 1000 },
  ];

  const config = { projectRoot: PROJECT_ROOT, maxExpansions: 500, maxRuntimeMs: 5000 };

  // Fresh-process legacy run of cleanJob
  const legClean = executeIsolatedSegment({
    simulator,
    segment,
    frontier: [{ id: "clean", state: s0 }],
    config,
  });

  // Batch run of taintJob followed by cleanJob
  const batchRes = executeIsolatedSegmentBatch({
    simulator,
    jobs,
    config,
  });

  const batchClean = batchRes[1];
  assert.strictEqual(batchClean.merged.length, legClean.merged.length, "G25-C: merged count match");
  assert.deepStrictEqual(
    batchClean.merged.map((c) => buildStateKey(c.state)),
    legClean.merged.map((c) => buildStateKey(c.state)),
    "G25-C: clean job in batch must match fresh legacy job with zero state taint",
  );

  return {
    stateIsolationVerified: true,
    zeroTaintDetected: true,
  };
}

// G25-D: Performance Gate: 8 independent probes: batch wall time < legacy wall time, launches 1 vs 8
function gateG25D_Performance() {
  const { simulator } = createTestHarness();
  const s0 = simulator.createInitialState();

  const segment = {
    id: "perf-seg",
    label: "Perf Segment",
    goal: { floorId: "MT1", minHero: { money: 10 } },
    actionPolicy: { allowedFloors: ["MT1"] },
    dp: { maxExpansions: 50, maxRuntimeMs: 2000 },
  };

  const N = 4; // 4 independent probes for deterministic, fast test
  const jobs = [];
  for (let i = 0; i < N; i += 1) {
    jobs.push({
      jobId: `job_${i}`,
      segment,
      inputFrontier: [{ id: `c_${i}`, state: s0 }],
      probeExpansionCap: 50,
      probeDeadlineMs: Date.now() + 2000,
    });
  }

  const config = { projectRoot: PROJECT_ROOT, maxExpansions: 5000, maxRuntimeMs: 30000 };

  // Legacy N launches
  const startLeg = Date.now();
  for (let i = 0; i < N; i += 1) {
    executeIsolatedSegment({
      simulator,
      segment,
      frontier: jobs[i].inputFrontier,
      config,
    });
  }
  const legacyWallMs = Date.now() - startLeg;

  // Batch 1 launch
  const startBatch = Date.now();
  const batchRes = executeIsolatedSegmentBatch({
    simulator,
    jobs,
    config,
  });
  const batchWallMs = Date.now() - startBatch;

  assert.strictEqual(batchRes.length, N, "G25-D: all jobs returned");
  assert.ok(
    batchWallMs < legacyWallMs,
    `G25-D: batch wall (${batchWallMs} ms) must be faster than legacy wall (${legacyWallMs} ms)`,
  );

  const speedupRatio = Math.round((legacyWallMs / batchWallMs) * 10) / 10;
  assert.ok(
    speedupRatio >= 2.0,
    `G25-D: microbench speedup ratio (${speedupRatio}x) must be >= 2.0x`,
  );

  return {
    speedupLabel: "MICROBENCH_SPEEDUP",
    jobsCount: N,
    legacyLaunches: N,
    batchLaunches: 1,
    legacyWallMs,
    batchWallMs,
    speedupRatio,
    faster: true,
  };
}

// G25-E: Telemetry Gate
function gateG25E_Telemetry() {
  const { simulator } = createTestHarness();
  const s0 = simulator.createInitialState();

  const segment = {
    id: "telem-seg",
    label: "Telem Segment",
    goal: { floorId: "MT1" },
    actionPolicy: { allowedFloors: ["MT1"] },
    dp: { maxExpansions: 20, maxRuntimeMs: 1000 },
  };

  const jobs = [
    { jobId: "j1", segment, inputFrontier: [{ id: "c1", state: s0 }], probeExpansionCap: 20, probeDeadlineMs: Date.now() + 1000 },
    { jobId: "j2", segment, inputFrontier: [{ id: "c2", state: s0 }], probeExpansionCap: 20, probeDeadlineMs: Date.now() + 1000 },
  ];

  const batchRes = executeIsolatedSegmentBatch({
    simulator,
    jobs,
    config: { projectRoot: PROJECT_ROOT, maxExpansions: 100, maxRuntimeMs: 5000 },
  });

  const telem = batchRes[0].telemetry && batchRes[0].telemetry.isolatedBatch;
  assert.ok(telem, "G25-E: isolatedBatch telemetry required");
  assert.strictEqual(telem.jobsRequested, 2, "G25-E: jobsRequested");
  assert.strictEqual(telem.jobsExecuted, 2, "G25-E: jobsExecuted");
  assert.strictEqual(telem.processLaunches, 1, "G25-E: processLaunches");
  assert.ok(typeof telem.processWallMs === "number", "G25-E: processWallMs number");
  assert.ok(typeof telem.searchWallMs === "number", "G25-E: searchWallMs number");
  assert.ok(typeof telem.serializationWallMs === "number", "G25-E: serializationWallMs number");

  return {
    telemetryComplete: true,
    processLaunches: telem.processLaunches,
  };
}

// G25-F: Production Wiring Gate
// First-probe tranches in runMilestoneGraph execute via executeIsolatedSegmentBatch in a single child process.
function gateG25F_ProductionWiring() {
  const { simulator } = createTestHarness();
  const s0 = simulator.createInitialState();

  const spec = {
    routeName: "g25-f-spec",
    milestones: [
      { id: "seg1", label: "Anchor", goal: { floorId: "MT1", minHero: { hp: 1000 } }, actionPolicy: { allowedFloors: ["MT1"] }, dp: { maxExpansions: 30, maxRuntimeMs: 2000, candidateLimit: 4 } },
      { id: "seg2", label: "Gated", startFrom: "seg1", goal: { floorId: "MT1", minHero: { money: 1000 } }, actionPolicy: { allowedFloors: ["MT1"] }, dp: { maxExpansions: 20, maxRuntimeMs: 2000 } },
    ],
  };

  const res = runMilestoneGraph(simulator, s0, spec, {
    searchIntent: "adaptive-feasible",
    segmentExecutionMode: "isolated-process",
    enableFailureBacktracking: true,
    adaptiveBacktrackDepth: 1,
    budgetScope: "global-run",
    maxExpansions: 5000,
    maxRuntimeMs: 30000,
    maxRssMb: 2048,
    candidateLimit: 4,
    initialFrontier: [{ id: "root", state: s0 }],
    enableBudgetedRepairScheduling: true,
    enableBudgetedRepairContinuation: true,
    adaptiveHypothesisProbeExpansions: 20,
    projectRoot: PROJECT_ROOT,
  });

  const bfp = res.batchFirstProbe;
  assert.ok(bfp, "G25-F: batchFirstProbe telemetry must exist on result");
  assert.ok(bfp.primary.jobsRequested >= 4, `G25-F: jobsRequested (${bfp.primary.jobsRequested}) must be >= 4`);
  assert.ok(bfp.primary.jobsExecuted >= 4, `G25-F: jobsExecuted (${bfp.primary.jobsExecuted}) must be >= 4`);
  assert.strictEqual(bfp.primary.processLaunches, 1, "G25-F: primary tranche must execute in exactly 1 process launch");

  const primaryTickets = res.repairScheduling.hypotheses.filter((h) => h.depth === 1 && h.anchorOutputRank < 4);
  assert.ok(primaryTickets.length >= 4, "G25-F: at least 4 primary tickets generated");
  assert.ok(primaryTickets.every((t) => t.probeCount >= 1), "G25-F: all primary tickets must have probeCount >= 1");

  return {
    productionWiringVerified: true,
    jobsRequested: bfp.primary.jobsRequested,
    jobsExecuted: bfp.primary.jobsExecuted,
    processLaunches: bfp.primary.processLaunches,
  };
}

// G25-G: Per-Job Wall Rebase Gate
// Each job in a batch receives its full allocated probe wall budget rebased at its start time.
function gateG25G_PerJobWallRebase() {
  const { simulator } = createTestHarness();
  const s0 = simulator.createInitialState();

  const segment = {
    id: "rebase-seg",
    label: "Rebase Segment",
    goal: { floorId: "MT1", minHero: { money: 1000 } },
    actionPolicy: { allowedFloors: ["MT1"] },
    dp: { maxExpansions: 50, maxRuntimeMs: 2000 },
  };

  const requestedProbeWallMs = 600;
  const jobs = [
    { jobId: "j1", segment, inputFrontier: [{ id: "c1", state: s0 }], probeExpansionCap: 50, probeWallMs: requestedProbeWallMs },
    { jobId: "j2", segment, inputFrontier: [{ id: "c2", state: s0 }], probeExpansionCap: 50, probeWallMs: requestedProbeWallMs },
    { jobId: "j3", segment, inputFrontier: [{ id: "c3", state: s0 }], probeExpansionCap: 50, probeWallMs: requestedProbeWallMs },
  ];

  const batchRes = executeIsolatedSegmentBatch({
    simulator,
    jobs,
    config: { projectRoot: PROJECT_ROOT, maxExpansions: 5000, maxRuntimeMs: 30000 },
  });

  assert.strictEqual(batchRes.length, 3, "G25-G: all 3 jobs returned");
  for (let i = 0; i < batchRes.length; i += 1) {
    const r = batchRes[i];
    assert.strictEqual(r.telemetry.executed, true, `G25-G: job ${i} executed`);
    assert.strictEqual(r.telemetry.allocatedProbeWallMs, requestedProbeWallMs, `G25-G: job ${i} allocatedProbeWallMs match`);
    assert.ok(typeof r.telemetry.jobStartWallMs === "number", `G25-G: job ${i} jobStartWallMs is number`);
    assert.ok(typeof r.telemetry.effectiveProbeDeadlineMs === "number", `G25-G: job ${i} effectiveProbeDeadlineMs is number`);
    assert.ok(
      Math.abs(r.telemetry.effectiveProbeDeadlineMs - (r.telemetry.jobStartWallMs + requestedProbeWallMs)) < 50,
      `G25-G: job ${i} effective deadline must be approximately jobStartWallMs + allocatedProbeWallMs`,
    );
    if (i > 0) {
      assert.ok(
        r.telemetry.jobStartWallMs >= batchRes[i - 1].telemetry.jobStartWallMs,
        `G25-G: job ${i} started at or after job ${i - 1}`,
      );
    }
  }

  return {
    perJobWallRebaseVerified: true,
    allocatedProbeWallMs: requestedProbeWallMs,
    jobsChecked: 3,
  };
}

// G25-H: Production Equivalence Gate
// Unbatched Arm A (disableBatchFirstProbe: true) vs Batched Arm B (disableBatchFirstProbe: false) produces identical tickets, progress, and outcomes.
function gateG25H_ProductionEquivalence() {
  const { simulator } = createTestHarness();
  const s0 = simulator.createInitialState();

  const spec = {
    routeName: "g25-h-spec",
    milestones: [
      { id: "seg1", label: "Anchor", goal: { floorId: "MT1", minHero: { hp: 1000 } }, actionPolicy: { allowedFloors: ["MT1"] }, dp: { maxExpansions: 30, maxRuntimeMs: 2000, candidateLimit: 4 } },
      { id: "seg2", label: "Gated", startFrom: "seg1", goal: { floorId: "MT1", minHero: { money: 1000 } }, actionPolicy: { allowedFloors: ["MT1"] }, dp: { maxExpansions: 20, maxRuntimeMs: 2000 } },
    ],
  };

  const baseOpts = {
    searchIntent: "adaptive-feasible",
    segmentExecutionMode: "isolated-process",
    enableFailureBacktracking: true,
    adaptiveBacktrackDepth: 1,
    budgetScope: "global-run",
    maxExpansions: 5000,
    maxRuntimeMs: 30000,
    maxRssMb: 2048,
    candidateLimit: 4,
    initialFrontier: [{ id: "root", state: s0 }],
    enableBudgetedRepairScheduling: true,
    enableBudgetedRepairContinuation: true,
    adaptiveHypothesisProbeExpansions: 20,
    projectRoot: PROJECT_ROOT,
  };

  const resA = runMilestoneGraph(simulator, s0, spec, { ...baseOpts, disableBatchFirstProbe: true });
  const resB = runMilestoneGraph(simulator, s0, spec, { ...baseOpts, disableBatchFirstProbe: false });

  assert.strictEqual(resA.batchFirstProbe.primary.processLaunches, 4, "G25-H: Arm A uses 4 process launches");
  assert.strictEqual(resB.batchFirstProbe.primary.processLaunches, 1, "G25-H: Arm B uses 1 process launch");

  const ticketsA = resA.repairScheduling.hypotheses.filter((h) => h.depth === 1);
  const ticketsB = resB.repairScheduling.hypotheses.filter((h) => h.depth === 1);
  assert.strictEqual(ticketsA.length, ticketsB.length, "G25-H: ticket count match");

  for (let i = 0; i < ticketsA.length; i += 1) {
    assert.strictEqual(ticketsA[i].hypothesisId, ticketsB[i].hypothesisId, `G25-H: ticket ${i} id match`);
    assert.strictEqual(ticketsA[i].status, ticketsB[i].status, `G25-H: ticket ${i} status match`);
    assert.strictEqual(ticketsA[i].stopReason, ticketsB[i].stopReason, `G25-H: ticket ${i} stopReason match`);
    assert.strictEqual(ticketsA[i].probeCount, ticketsB[i].probeCount, `G25-H: ticket ${i} probeCount match`);
    assert.strictEqual(ticketsA[i].progressClass, ticketsB[i].progressClass, `G25-H: ticket ${i} progressClass match`);
    if (ticketsA[i].effectiveDp && ticketsB[i].effectiveDp) {
      assert.strictEqual(ticketsA[i].effectiveDp.stopOnFirstGoal, ticketsB[i].effectiveDp.stopOnFirstGoal, `G25-H: ticket ${i} stopOnFirstGoal match`);
      assert.strictEqual(ticketsA[i].effectiveDp.goalSkylineLimit, ticketsB[i].effectiveDp.goalSkylineLimit, `G25-H: ticket ${i} goalSkylineLimit match`);
    }
  }

  const keysA = (resA.finalCandidates || []).map((c) => buildStateKey(c.state)).sort();
  const keysB = (resB.finalCandidates || []).map((c) => buildStateKey(c.state)).sort();
  assert.deepStrictEqual(keysA, keysB, "G25-H: final frontier state-key multiset match");

  const repCountA = resA.failedSegment && resA.failedSegment.backtrack && resA.failedSegment.backtrack.depthSummaries[0]
    ? resA.failedSegment.backtrack.depthSummaries[0].anchorExpandedCandidates : null;
  const repCountB = resB.failedSegment && resB.failedSegment.backtrack && resB.failedSegment.backtrack.depthSummaries[0]
    ? resB.failedSegment.backtrack.depthSummaries[0].anchorExpandedCandidates : null;
  assert.strictEqual(repCountA, repCountB, "G25-H: repair finalFrontier count match");

  return {
    productionEquivalenceVerified: true,
    armALaunches: resA.batchFirstProbe.primary.processLaunches,
    armBLaunches: resB.batchFirstProbe.primary.processLaunches,
    ticketsCompared: ticketsA.length,
    finalFrontierStateKeysCount: keysA.length,
    repairFinalFrontierCount: repCountA,
  };
}

// G25-I: Global Stop Mid-Batch Production Path Gate
// When global budget is exhausted mid-batch on the production path, executed jobs produce normal results, unstarted jobs return PROBE_PENDING with depthExhausted: false, and final outcome is not EXHAUSTED.
function gateG25I_GlobalStopMidBatchProductionPath() {
  const { simulator } = createTestHarness();
  const s0 = simulator.createInitialState();

  const spec = {
    routeName: "g25-i-spec",
    milestones: [
      { id: "seg1", label: "Anchor", goal: { floorId: "MT1", minHero: { hp: 1000 } }, actionPolicy: { allowedFloors: ["MT1"] }, dp: { maxExpansions: 30, maxRuntimeMs: 2000, candidateLimit: 4 } },
      { id: "seg2", label: "Gated", startFrom: "seg1", goal: { floorId: "MT1", minHero: { money: 1000 } }, actionPolicy: { allowedFloors: ["MT1"] }, dp: { maxExpansions: 20, maxRuntimeMs: 2000 } },
    ],
  };

  const res = runMilestoneGraph(simulator, s0, spec, {
    searchIntent: "adaptive-feasible",
    segmentExecutionMode: "isolated-process",
    enableFailureBacktracking: true,
    adaptiveBacktrackDepth: 1,
    budgetScope: "global-run",
    maxExpansions: 112, // tuned to exhaust during batch execution of seg2
    maxRuntimeMs: 30000,
    maxRssMb: 2048,
    candidateLimit: 4,
    initialFrontier: [{ id: "root", state: s0 }],
    enableBudgetedRepairScheduling: true,
    enableBudgetedRepairContinuation: true,
    adaptiveHypothesisProbeExpansions: 20,
    projectRoot: PROJECT_ROOT,
  });

  const bfp = res.batchFirstProbe;
  assert.ok(bfp.primary.jobsRequested >= 4, "G25-I: jobsRequested >= 4");
  assert.ok(bfp.primary.jobsExecuted >= 1, "G25-I: at least 1 job executed before budget exhaustion");
  assert.ok(
    bfp.primary.jobsExecuted < bfp.primary.jobsRequested,
    `G25-I: mid-batch stop occurred (${bfp.primary.jobsExecuted} < ${bfp.primary.jobsRequested})`,
  );

  const tickets = res.repairScheduling.hypotheses.filter((h) => h.depth === 1);
  const executedTickets = tickets.filter((t) => t.probeCount >= 1);
  const unstartedTickets = tickets.filter((t) => t.probeCount === 0);

  assert.ok(executedTickets.length >= 1, "G25-I: at least 1 ticket executed");
  assert.ok(unstartedTickets.length >= 1, "G25-I: at least 1 ticket unstarted");
  assert.ok(
    unstartedTickets.every((t) => t.status === "PROBE_PENDING"),
    "G25-I: all unstarted tickets have status PROBE_PENDING",
  );

  const ds = res.failedSegment.backtrack.depthSummaries[0];
  assert.notStrictEqual(ds.depthOutcome, "exhausted", "G25-I: depthOutcome must not be exhausted");
  assert.strictEqual(ds.depthExhausted, false, "G25-I: depthExhausted must be false");
  assert.notStrictEqual(res.finalCanonicalOutcome, "EXHAUSTED", "G25-I: finalCanonicalOutcome must not be EXHAUSTED");

  return {
    midBatchGlobalStopVerified: true,
    jobsRequested: bfp.primary.jobsRequested,
    jobsExecuted: bfp.primary.jobsExecuted,
    executedTicketsCount: executedTickets.length,
    unstartedTicketsCount: unstartedTickets.length,
    depthOutcome: ds.depthOutcome,
    depthExhausted: ds.depthExhausted,
  };
}

// G25-J: Frozen Backtrack DP Authority Gate
// Assert effective authority in production runMilestoneGraph:
// stopOnFirstGoal = false, goalSkylineLimit = backtrackCandidateLimit, backtrack dpOverrides present.
// Identical in Batch ON and OFF.
function gateG25J_FrozenBacktrackDpAuthority() {
  const { simulator } = createTestHarness();
  const s0 = simulator.createInitialState();

  const spec = {
    routeName: "g25-j-spec",
    milestones: [
      { id: "seg1", label: "Anchor", goal: { floorId: "MT1", minHero: { hp: 1000 } }, actionPolicy: { allowedFloors: ["MT1"] }, dp: { maxExpansions: 30, maxRuntimeMs: 2000, candidateLimit: 4 } },
      { id: "seg2", label: "Gated", startFrom: "seg1", goal: { floorId: "MT1", minHero: { money: 1000 } }, actionPolicy: { allowedFloors: ["MT1"] }, dp: { maxExpansions: 20, maxRuntimeMs: 2000 } },
    ],
  };

  const baseOpts = {
    searchIntent: "adaptive-feasible",
    segmentExecutionMode: "isolated-process",
    enableFailureBacktracking: true,
    adaptiveBacktrackDepth: 1,
    budgetScope: "global-run",
    maxExpansions: 5000,
    maxRuntimeMs: 30000,
    maxRssMb: 2048,
    candidateLimit: 4,
    initialFrontier: [{ id: "root", state: s0 }],
    enableBudgetedRepairScheduling: true,
    enableBudgetedRepairContinuation: true,
    adaptiveHypothesisProbeExpansions: 20,
    projectRoot: PROJECT_ROOT,
  };

  const resOff = runMilestoneGraph(simulator, s0, spec, { ...baseOpts, disableBatchFirstProbe: true });
  const resOn = runMilestoneGraph(simulator, s0, spec, { ...baseOpts, disableBatchFirstProbe: false });

  const tOff = resOff.repairScheduling.hypotheses.filter((h) => h.depth === 1);
  const tOn = resOn.repairScheduling.hypotheses.filter((h) => h.depth === 1);

  [tOff, tOn].forEach((tickets, armIdx) => {
    assert.ok(tickets.length >= 4, `G25-J arm ${armIdx}: at least 4 tickets`);
    tickets.forEach((t, i) => {
      assert.ok(t.effectiveDp, `G25-J ticket ${i}: effectiveDp required`);
      assert.strictEqual(t.effectiveDp.stopOnFirstGoal, false, `G25-J ticket ${i}: stopOnFirstGoal must be false`);
      assert.strictEqual(t.effectiveDp.goalSkylineLimit, 8, `G25-J ticket ${i}: goalSkylineLimit must equal backtrackCandidateLimit (8)`);
      assert.ok(t.effectiveDp.dpOverrides != null, `G25-J ticket ${i}: dpOverrides required`);
      assert.strictEqual(t.effectiveDp.dpOverrides.stopOnFirstGoal, false, `G25-J ticket ${i}: dpOverrides.stopOnFirstGoal must be false`);
      assert.strictEqual(t.effectiveDp.dpOverrides.goalSkylineLimit, 8, `G25-J ticket ${i}: dpOverrides.goalSkylineLimit must match`);
    });
  });

  assert.deepStrictEqual(tOff[0].effectiveDp, tOn[0].effectiveDp, "G25-J: Batch ON and OFF must have identical effective authority");

  return {
    frozenBacktrackDpAuthorityVerified: true,
    stopOnFirstGoal: false,
    goalSkylineLimit: 8,
    batchOffAndOnIdentical: true,
  };
}

// G25-K: Sibling Goal Independence Gate
// 3 batch first-probe jobs: Job A reaches current replay segment goal, Job B and C are valid independent jobs.
// Global budget is sufficient. All 3 must execute (executed=true). B/C must NOT be short-circuited with notRunReason=goal-found.
function gateG25K_SiblingGoalIndependence() {
  const { simulator } = createTestHarness();
  const s0 = simulator.createInitialState();

  const sA = JSON.parse(JSON.stringify(s0));
  sA.hero.hp = 1500;
  const seg = {
    id: "sibling-goal-seg",
    goal: { floorId: "MT1", minHero: { hp: 1000 } },
    actionPolicy: { allowedFloors: ["MT1"] },
    dp: { maxExpansions: 20, maxRuntimeMs: 2000 },
  };

  const jobs = [
    { jobId: "jA", segment: seg, inputFrontier: [{ id: "cA", state: sA }], probeExpansionCap: 20, probeWallMs: 2000 },
    { jobId: "jB", segment: seg, inputFrontier: [{ id: "cB", state: s0 }], probeExpansionCap: 20, probeWallMs: 2000 },
    { jobId: "jC", segment: seg, inputFrontier: [{ id: "cC", state: s0 }], probeExpansionCap: 20, probeWallMs: 2000 },
  ];

  const config = { projectRoot: PROJECT_ROOT, maxExpansions: 5000, maxRuntimeMs: 30000 };
  const batchRes = executeIsolatedSegmentBatch({ simulator, jobs, config });

  assert.strictEqual(batchRes[0].telemetry.executed, true, "G25-K: job A executed");
  assert.strictEqual(batchRes[0].summary.found, true, "G25-K: job A found goal");
  assert.strictEqual(batchRes[1].telemetry.executed, true, "G25-K: job B executed independently");
  assert.strictEqual(batchRes[2].telemetry.executed, true, "G25-K: job C executed independently");
  assert.notStrictEqual(batchRes[1].telemetry.notRunReason, "goal-found", "G25-K: job B not cancelled on goal-found");
  assert.notStrictEqual(batchRes[2].telemetry.notRunReason, "goal-found", "G25-K: job C not cancelled on goal-found");

  return {
    siblingGoalIndependenceVerified: true,
    jobAFound: batchRes[0].summary.found,
    allSiblingsExecuted: true,
  };
}

// G25-L: Repair Frontier Width Frozen Gate
// When graph candidateLimit = 4, adaptiveRepair.finalFrontier = >4 exact states,
// assert that returned frontier behavior matches 0abec39 frozen contract (no narrowing .slice()).
function gateG25L_RepairFrontierWidthFrozen() {
  const { simulator } = createTestHarness();
  const s0 = simulator.createInitialState();

  const spec = {
    routeName: "g25-l-spec",
    milestones: [
      { id: "seg1", label: "Anchor", goal: { floorId: "MT1", minHero: { hp: 1000 } }, actionPolicy: { allowedFloors: ["MT1"] }, dp: { maxExpansions: 30, maxRuntimeMs: 2000, candidateLimit: 4 } },
      { id: "seg2", label: "Gated", startFrom: "seg1", goal: { floorId: "MT1", minHero: { money: 1000 } }, actionPolicy: { allowedFloors: ["MT1"] }, dp: { maxExpansions: 20, maxRuntimeMs: 2000 } },
    ],
  };

  const res = runMilestoneGraph(simulator, s0, spec, {
    searchIntent: "adaptive-feasible",
    segmentExecutionMode: "isolated-process",
    enableFailureBacktracking: true,
    adaptiveBacktrackDepth: 1,
    budgetScope: "global-run",
    maxExpansions: 5000,
    maxRuntimeMs: 30000,
    maxRssMb: 2048,
    candidateLimit: 4,
    initialFrontier: [{ id: "root", state: s0 }],
    enableBudgetedRepairScheduling: true,
    enableBudgetedRepairContinuation: true,
    adaptiveHypothesisProbeExpansions: 20,
    projectRoot: PROJECT_ROOT,
  });

  const ds = res.failedSegment.backtrack.depthSummaries[0];
  assert.ok(ds.normalAdmission.retainedCount > 4, "G25-L: retained count must exceed candidateLimit (4)");
  assert.strictEqual(ds.anchorExpandedCandidates, 5, "G25-L: anchor expanded candidates must be exactly 5, not sliced to 4");

  return {
    repairFrontierWidthFrozenVerified: true,
    retainedCount: ds.normalAdmission.retainedCount,
    anchorExpandedCandidates: ds.anchorExpandedCandidates,
    noArbitrarySlice: true,
  };
}

function main() {
  const g25A = gateG25A_Equivalence();
  const g25B = gateG25B_GlobalStop();
  const g25C = gateG25C_StateIsolation();
  const g25D = gateG25D_Performance();
  const g25E = gateG25E_Telemetry();
  const g25F = gateG25F_ProductionWiring();
  const g25G = gateG25G_PerJobWallRebase();
  const g25H = gateG25H_ProductionEquivalence();
  const g25I = gateG25I_GlobalStopMidBatchProductionPath();
  const g25J = gateG25J_FrozenBacktrackDpAuthority();
  const g25K = gateG25K_SiblingGoalIndependence();
  const g25L = gateG25L_RepairFrontierWidthFrozen();

  const report = {
    schema: "motapathfinder.isolated-batch.v2",
    contractStatus: "passed",
    gates: {
      "G25-A": g25A,
      "G25-B": g25B,
      "G25-C": g25C,
      "G25-D": g25D,
      "G25-E": g25E,
      "G25-F": g25F,
      "G25-G": g25G,
      "G25-H": g25H,
      "G25-I": g25I,
      "G25-J": g25J,
      "G25-K": g25K,
      "G25-L": g25L,
    },
  };
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = {
  main,
  gateG25A_Equivalence,
  gateG25B_GlobalStop,
  gateG25C_StateIsolation,
  gateG25D_Performance,
  gateG25E_Telemetry,
  gateG25F_ProductionWiring,
  gateG25G_PerJobWallRebase,
  gateG25H_ProductionEquivalence,
  gateG25I_GlobalStopMidBatchProductionPath,
  gateG25J_FrozenBacktrackDpAuthority,
  gateG25K_SiblingGoalIndependence,
  gateG25L_RepairFrontierWidthFrozen,
};
