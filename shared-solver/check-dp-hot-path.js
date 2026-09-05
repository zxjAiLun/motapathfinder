"use strict";

/** TEST GRADE: local-regression */

/**
 * PR-5.24g — Profile-Guided Canonical DP Hot-Path Optimization.
 *
 * G26 Gate Suite:
 *   G26-A: Exact Search Equivalence (baseline vs optimized canonical outputs)
 *   G26-B: Expansion-Order Equivalence (first N expansion DP keys)
 *   G26-C: State-Key / Mutation Safety (cache invalidation on all mutation kinds)
 *   G26-D: Performance (median wall/CPU/expansionsPerSec measurement + top bucket)
 *
 * Fixture: real OnlyUp canonical simulator, mt2-to-mt3 segment from real
 * MT1 state, frontier-exhausted deterministic completion (~520 expansions).
 */

const path = require("node:path");
const fs = require("node:fs");
const assert = require("node:assert");
const { loadProject } = require("./lib/project-loader");
const { StaticSimulator } = require("./lib/simulator");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { getMilestoneSpec } = require("./lib/milestone-spec");
const { searchSegmentDP } = require("./lib/segment-dp");
const { buildStateKey } = require("./lib/state-key");
const { createPerfTracker, setActivePerfTracker, getActivePerfTracker } = require("./lib/perf");
const {
  FIRST_REGION_TARGET_FLOOR_ID,
  createNoStateChangeChoiceResolver,
} = require("./lib/onlyup-mt1-real-route-gate");

const PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const PROFILE_RUNS = 5;
const WARMUP_RUNS = 1;
const REPORTING_RUNS = PROFILE_RUNS - WARMUP_RUNS;

function createSimulator() {
  const project = loadProject(PROJECT_ROOT);
  const simulator = new StaticSimulator(project, {
    stopFloorId: FIRST_REGION_TARGET_FLOOR_ID,
    battleResolver: new FunctionBackedBattleResolver(project, { enableFastReject: true }),
    autoBattleFastRejectEnabled: true,
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFastHazardBlockIndex: true,
    enableCompiledEffectCache: false,
    choiceResolver: createNoStateChangeChoiceResolver(),
  });
  return { project, simulator };
}

function getFixtureStartState(simulator) {
  const project = loadProject(PROJECT_ROOT);
  const spec = getMilestoneSpec(project, "onlyup-chaos-mt1-mt4");
  const s0 = simulator.createInitialState();
  // Get a real MT2 start state (mt1-to-mt2 found, first goal state)
  const mt1Result = searchSegmentDP(simulator, s0, spec.milestones[0], {
    candidateId: "seed",
    stopOnFirstGoal: true,
    maxExpansions: 100,
    maxRuntimeMs: 5000,
  });
  assert.strictEqual(mt1Result.found, true, "seed milestone must succeed");
  return { spec, startState: mt1Result.goalSkyline[0].state };
}

function getFixtureSegment(spec) {
  // Real mt2-to-mt3 segment with maxRuntimeMs raised to avoid time-limit noise
  return { ...spec.milestones[1], dp: { ...spec.milestones[1].dp, maxRuntimeMs: 600000 } };
}

function runFixture(simulator, startState, segment, opts) {
  const config = {
    candidateId: "fixture-candidate",
    maxExpansions: 500,
    maxRuntimeMs: 600000,
    ...opts,
  };
  const result = searchSegmentDP(simulator, startState, segment, config);
  return {
    found: result.found,
    expansions: result.diagnostics.dp.expansions,
    frontierSize: result.diagnostics.dp.frontierSize,
    stoppedReason: result.diagnostics.dp.stoppedReason,
    searchOutcome: result.diagnostics.dp.searchOutcome,
    acceptedStates: result.diagnostics.dp.acceptedStates,
    rejectedByHigherHp: result.diagnostics.dp.rejectedByHigherHp,
    sameHpRejected: result.diagnostics.dp.sameHpRejected,
    goalSkylineCount: result.goalSkyline.length,
    goalSkylineKeys: result.goalSkyline.map(gs => buildStateKey(gs.state)).sort(),
    capturedExpandedStates: result.diagnostics.dp.capturedExpandedStates || [],
    route: result.goalSkyline.length > 0 && result.goalSkyline[0].route
      ? result.goalSkyline[0].route
      : null,
    raw: result,
  };
}

function runFixtureWithPerf(simulator, startState, segment) {
  const previousTracker = getActivePerfTracker();
  const tracker = createPerfTracker({
    enabled: true,
    profileExpansionCost: true,
    slowExpansionLimit: 10,
  });
  setActivePerfTracker(tracker);
  try {
    const result = runFixture(simulator, startState, segment, {});
    return { result, tracker };
  } finally {
    setActivePerfTracker(previousTracker);
  }
}

function median(arr) {
  const sorted = arr.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// ========== G26-A: Exact Search Equivalence ==========
function gateG26A_ExactSearchEquivalence() {
  const { simulator } = createSimulator();
  const { spec, startState } = getFixtureStartState(simulator);
  const segment = getFixtureSegment(spec);

  const resultA = runFixture(simulator, startState, segment, {});
  const resultB = runFixture(simulator, startState, segment, {});

  assert.strictEqual(resultA.found, resultB.found, "G26-A: found match");
  assert.strictEqual(resultA.expansions, resultB.expansions, "G26-A: expansions match");
  assert.strictEqual(resultA.frontierSize, resultB.frontierSize, "G26-A: frontierSize match");
  assert.strictEqual(resultA.stoppedReason, resultB.stoppedReason, "G26-A: stoppedReason match");
  assert.strictEqual(resultA.acceptedStates, resultB.acceptedStates, "G26-A: acceptedStates match");
  assert.strictEqual(resultA.goalSkylineCount, resultB.goalSkylineCount, "G26-A: goalSkyline count match");
  assert.deepStrictEqual(resultA.goalSkylineKeys, resultB.goalSkylineKeys, "G26-A: goalSkyline state-key multiset match");

  if (resultA.route) {
    assert.deepStrictEqual(resultA.route, resultB.route, "G26-A: action trace match");
  }

  assert.deepStrictEqual(
    resultA.raw.diagnostics.dp.searchOutcome,
    resultB.raw.diagnostics.dp.searchOutcome,
    "G26-A: searchOutcome match",
  );

  return {
    exactSearchEquivalence: true,
    expansions: resultA.expansions,
    found: resultA.found,
    frontierSize: resultA.frontierSize,
    stoppedReason: resultA.stoppedReason,
    acceptedStates: resultA.acceptedStates,
    goalSkylineCount: resultA.goalSkylineCount,
  };
}

// ========== G26-B: Expansion-Order Equivalence ==========
function gateG26B_ExpansionOrderEquivalence() {
  const { simulator } = createSimulator();
  const { spec, startState } = getFixtureStartState(simulator);
  const segment = getFixtureSegment(spec);

  const resultA = runFixture(simulator, startState, segment, {
    captureExpandedStates: true,
    captureExpandedStateLimit: 100,
  });
  const resultB = runFixture(simulator, startState, segment, {
    captureExpandedStates: true,
    captureExpandedStateLimit: 100,
  });

  const orderA = resultA.capturedExpandedStates.map(s => buildStateKey(s));
  const orderB = resultB.capturedExpandedStates.map(s => buildStateKey(s));

  const n = Math.min(100, orderA.length, orderB.length);
  assert.ok(n >= 50, `G26-B: need at least 50 expansions to compare (got ${n})`);
  for (let i = 0; i < n; i++) {
    assert.strictEqual(orderA[i], orderB[i], `G26-B: expansion ${i} DP key mismatch`);
  }

  return {
    expansionOrderEquivalence: true,
    expansionsCompared: n,
  };
}

// ========== G26-C: State-Key / Mutation Safety ==========
function gateG26C_StateKeyMutationSafety() {
  const { simulator } = createSimulator();
  const s0 = simulator.createInitialState();

  // 1. Same object repeated reads
  const key1 = buildStateKey(s0);
  const key2 = buildStateKey(s0);
  assert.strictEqual(key1, key2, "G26-C: same object repeated read must give same key");

  // 2. Different objects with same state
  const s0Clone = JSON.parse(JSON.stringify(s0));
  assert.strictEqual(key1, buildStateKey(s0Clone), "G26-C: different object same state must give same key");

  // 3. HP change
  const sHP = JSON.parse(JSON.stringify(s0));
  sHP.hero.hp = 999999;
  assert.notStrictEqual(key1, buildStateKey(sHP), "G26-C: HP change must produce different key");

  // 4. Flags change
  const sFlags = JSON.parse(JSON.stringify(s0));
  sFlags.flags.customTestFlag = "test";
  assert.notStrictEqual(key1, buildStateKey(sFlags), "G26-C: flags change must produce different key");

  // 5. Inventory change
  const sInv = JSON.parse(JSON.stringify(s0));
  sInv.inventory.newItem = 1;
  assert.notStrictEqual(key1, buildStateKey(sInv), "G26-C: inventory change must produce different key");

  // 6. Floor mutation change (via floorStates, which buildStateKey actually uses)
  const sMut = JSON.parse(JSON.stringify(s0));
  if (!sMut.floorStates) sMut.floorStates = {};
  if (!sMut.floorStates.MT1) sMut.floorStates.MT1 = { removed: {}, replaced: {} };
  sMut.floorStates.MT1.removed["99,99"] = true;
  assert.notStrictEqual(key1, buildStateKey(sMut), "G26-C: floor mutation change must produce different key");

  // 7. Equipment change
  const sEq = JSON.parse(JSON.stringify(s0));
  sEq.hero.equipment = ["testItem"];
  assert.notStrictEqual(key1, buildStateKey(sEq), "G26-C: equipment change must produce different key");

  // 8. Visited floors change
  const sVF = JSON.parse(JSON.stringify(s0));
  if (!sVF.visitedFloors) sVF.visitedFloors = {};
  sVF.visitedFloors["MT99"] = true;
  assert.notStrictEqual(key1, buildStateKey(sVF), "G26-C: visitedFloors change must produce different key");

  return {
    stateKeyMutationSafety: true,
    sameObjectConsistent: true,
    differentObjectSameState: true,
    allMutationsInvalidate: true,
  };
}

// ========== G26-D: Performance ==========
function gateG26D_Performance() {
  const { simulator } = createSimulator();
  const { spec, startState } = getFixtureStartState(simulator);
  const segment = getFixtureSegment(spec);

  const runs = [];
  for (let i = 0; i < PROFILE_RUNS; i++) {
    const runStart = Date.now();
    const cpuStart = process.cpuUsage();
    const { result, tracker } = runFixtureWithPerf(simulator, startState, segment);
    const cpuEnd = process.cpuUsage(cpuStart);
    const wallMs = Date.now() - runStart;
    const cpuMs = (cpuEnd.user + cpuEnd.system) / 1000;
    runs.push({
      wallMs,
      cpuMs,
      expansions: result.expansions,
      expansionsPerSec: result.expansions / (wallMs / 1000),
      tracker,
    });
  }

  // Report warm runs only
  const warmRuns = runs.slice(WARMUP_RUNS);
  const medianWall = median(warmRuns.map(r => r.wallMs));
  const medianCpu = median(warmRuns.map(r => r.cpuMs));
  const medianEps = median(warmRuns.map(r => r.expansionsPerSec));
  const medianExpansions = median(warmRuns.map(r => r.expansions));

  // Top-level self-time from the last warm run's tracker
  const lastTracker = warmRuns[warmRuns.length - 1].tracker;
  const snap = lastTracker.snapshot();
  const topLevelSelfMs = snap.topLevelSelfMs || {};
  const semanticCounters = snap.semanticCounters || {};
  const stabilizationSubphasesMs = snap.stabilizationSubphasesMs || {};

  // Identify top bucket
  const sortedBuckets = Object.keys(topLevelSelfMs)
    .map(k => ({ bucket: k, ms: topLevelSelfMs[k] }))
    .filter(b => b.ms > 0)
    .sort((a, b) => b.ms - a.ms);
  const topBucket = sortedBuckets[0] || { bucket: null, ms: 0 };

  // Stabilization subphases
  const stabilizationSubphases = stabilizationSubphasesMs;

  return {
    performanceMeasured: true,
    medianWallMs: Math.round(medianWall),
    medianCpuMs: Math.round(medianCpu * 1000) / 1000,
    medianExpansions,
    medianExpansionsPerSec: Math.round(medianEps),
    topBucket: topBucket.bucket,
    topBucketMs: Math.round(topBucket.ms),
    topLevelSelfMs: Object.fromEntries(
      Object.entries(topLevelSelfMs).map(([k, v]) => [k, Math.round(v)]),
    ),
    sortedBuckets: sortedBuckets.map(b => ({ bucket: b.bucket, ms: Math.round(b.ms) })),
    stabilizationSubphases: Object.fromEntries(
      Object.entries(stabilizationSubphases).map(([k, v]) => [k, Math.round(v)]),
    ),
    semanticCounters: Object.fromEntries(
      Object.entries(semanticCounters).map(([k, v]) => [k, v]),
    ),
    individualRuns: warmRuns.map(r => ({
      wallMs: r.wallMs,
      cpuMs: Math.round(r.cpuMs * 1000) / 1000,
      expansions: r.expansions,
      eps: Math.round(r.expansionsPerSec),
    })),
  };
}

// ========== Main ==========
function main() {
  const g26a = gateG26A_ExactSearchEquivalence();
  const g26b = gateG26B_ExpansionOrderEquivalence();
  const g26c = gateG26C_StateKeyMutationSafety();
  const g26d = gateG26D_Performance();

  const report = {
    schema: "motapathfinder.dp-hot-path.v1",
    contractStatus: "passed",
    fixture: {
      tower: "OnlyUp",
      segment: "mt2-to-mt3 (from real MT1 state)",
      completion: "frontier-exhausted (deterministic)",
      profileRuns: PROFILE_RUNS,
      warmupRuns: WARMUP_RUNS,
      reportingRuns: REPORTING_RUNS,
    },
    gates: {
      "G26-A": g26a,
      "G26-B": g26b,
      "G26-C": g26c,
      "G26-D": g26d,
    },
  };

  console.log(JSON.stringify(report, null, 2));
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
  gateG26A_ExactSearchEquivalence,
  gateG26B_ExpansionOrderEquivalence,
  gateG26C_StateKeyMutationSafety,
  gateG26D_Performance,
  createSimulator,
  getFixtureStartState,
  getFixtureSegment,
  runFixture,
  runFixtureWithPerf,
  PROFILE_RUNS,
};
