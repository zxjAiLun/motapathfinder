"use strict";

const path = require("node:path");
const assert = require("node:assert");
const {
  executeIsolatedSegment,
  executeIsolatedSegmentBatch,
} = require("./lib/isolated-segment-executor");
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

  return {
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

function main() {
  const g25A = gateG25A_Equivalence();
  const g25B = gateG25B_GlobalStop();
  const g25C = gateG25C_StateIsolation();
  const g25D = gateG25D_Performance();
  const g25E = gateG25E_Telemetry();

  const report = {
    schema: "motapathfinder.isolated-batch.v1",
    contractStatus: "passed",
    gates: {
      "G25-A": g25A,
      "G25-B": g25B,
      "G25-C": g25C,
      "G25-D": g25D,
      "G25-E": g25E,
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
};
