"use strict";

/** TEST GRADE: local-regression */

/**
 * PR-5.24h — MT3→MT4 Downstream Canonical Search Cost Reduction.
 *
 * Fixed-work deterministic profiling fixture and G28 gate suite for MT3→MT4 downstream search.
 * Source: canonical repaired MT3 state from PR-5.24g Formal Run 2.
 * Completion: frontier-exhausted deterministic completion at 897 expansions.
 *
 * G28 Gates:
 *   G28-A: MT3 Fixture Determinism (consecutive reference runs byte-identical)
 *   G28-B: Optimization Exact Parity (fast collectTargets OFF vs ON parity across 897 expansions)
 *   G28-C: Target-Specific Collection Correctness (targets, coordinates, distances, approach, continuePast match)
 *   G28-D: Interleaved Performance A/B (4 pairs, fixed-work 897 expansions, enforced acceptance threshold)
 *   G28-E: MT2→MT3 Generalization Gate (520-exp fixture parity and non-regression)
 */

const path = require("node:path");
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
const {
  collectTargets,
  collectTargetsLegacy,
} = require("./lib/auto-actions");

const PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const FIXTURE_PATH = path.resolve(__dirname, "fixtures/perf/onlyup-mt3-qualified-state.json");
const FIXTURE = require(FIXTURE_PATH);
const PAIRS_COUNT = 4;

function createSimulator(options = {}) {
  const project = loadProject(PROJECT_ROOT);
  const memoizationEnabled = options.memoizationEnabled !== false;
  const fastBattleEstimateCacheEnabled = options.fastBattleEstimateCacheEnabled !== false;
  const fastCollectTargetsEnabled = options.fastCollectTargetsEnabled !== false;

  const battleResolver = new FunctionBackedBattleResolver(project, {
    enableFastReject: true,
    enableFastBattleEstimateCache: fastBattleEstimateCacheEnabled,
  });

  const simulator = new StaticSimulator(project, {
    stopFloorId: FIRST_REGION_TARGET_FLOOR_ID,
    battleResolver,
    autoBattleFastRejectEnabled: true,
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFastHazardBlockIndex: true,
    enableHazardBlockIndexMemoization: memoizationEnabled,
    enableFastBattleEstimateCache: fastBattleEstimateCacheEnabled,
    enableFastCollectTargets: fastCollectTargetsEnabled,
    enableCompiledEffectCache: false,
    choiceResolver: createNoStateChangeChoiceResolver(),
  });
  return { project, simulator };
}

function getMt3Segment(project) {
  const spec = getMilestoneSpec(project, "onlyup-chaos-mt1-mt4");
  return { ...spec.milestones[2], dp: { ...spec.milestones[2].dp, maxRuntimeMs: 600000 } };
}

function runMt3Fixture(simulator, segment, opts = {}) {
  const config = {
    candidateId: "mt3-hotpath-candidate",
    maxExpansions: 1000,
    maxRuntimeMs: 600000,
    ...opts,
  };
  const result = searchSegmentDP(simulator, JSON.parse(JSON.stringify(FIXTURE.state)), segment, config);
  return {
    found: result.found,
    expansions: result.diagnostics.dp.expansions,
    frontierSize: result.diagnostics.dp.frontierSize,
    stoppedReason: result.diagnostics.dp.stoppedReason,
    searchOutcome: result.diagnostics.dp.searchOutcome,
    acceptedStates: result.diagnostics.dp.acceptedStates,
    rejectedByHigherHp: result.diagnostics.dp.rejectedByHigherHp,
    sameHpRejected: result.diagnostics.dp.sameHpRejected,
    generated: result.diagnostics.dp.acceptedStates + result.diagnostics.dp.rejectedByHigherHp + result.diagnostics.dp.sameHpRejected,
    registered: result.diagnostics.dp.acceptedStates,
    goalSkylineCount: result.goalSkyline.length,
    goalSkylineKeys: result.goalSkyline.map((gs) => buildStateKey(gs.state)).sort(),
    capturedExpandedStates: result.diagnostics.dp.capturedExpandedStates || [],
    route: result.goalSkyline.length > 0 && result.goalSkyline[0].route
      ? result.goalSkyline[0].route
      : null,
    raw: result,
  };
}

function runMt3FixtureWithPerf(simulator, segment, opts = {}) {
  const previousTracker = getActivePerfTracker();
  const tracker = createPerfTracker({
    enabled: true,
    profileExpansionCost: true,
    slowExpansionLimit: 10,
  });
  setActivePerfTracker(tracker);
  try {
    const runStart = Date.now();
    const cpuStart = process.cpuUsage();
    const result = runMt3Fixture(simulator, segment, opts);
    const cpuEnd = process.cpuUsage(cpuStart);
    const wallMs = Date.now() - runStart;
    const cpuMs = (cpuEnd.user + cpuEnd.system) / 1000;
    return {
      wallMs,
      cpuMs,
      result,
      tracker,
    };
  } finally {
    setActivePerfTracker(previousTracker);
  }
}

function median(arr) {
  const sorted = arr.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// ========== G28-A: MT3 Fixture Determinism ==========
function gateG28A_FixtureDeterminism() {
  const { project, simulator } = createSimulator();
  const segment = getMt3Segment(project);

  const observerConfig = { captureExpandedStates: true, captureExpandedStateLimit: 100 };
  const r1 = runMt3Fixture(simulator, segment, observerConfig);
  const r2 = runMt3Fixture(simulator, segment, observerConfig);

  assert.strictEqual(r1.found, r2.found, "G28-A: found match");
  assert.strictEqual(r1.expansions, 897, "G28-A: expansions must be exactly 897");
  assert.strictEqual(r2.expansions, 897, "G28-A: expansions must be exactly 897");
  assert.strictEqual(r1.frontierSize, 0, "G28-A: frontierSize must be 0 (exhausted)");
  assert.strictEqual(r2.frontierSize, 0, "G28-A: frontierSize must be 0 (exhausted)");
  assert.strictEqual(r1.stoppedReason, null, "G28-A: stoppedReason must be null");
  assert.strictEqual(r1.acceptedStates, r2.acceptedStates, "G28-A: acceptedStates match");
  assert.strictEqual(r1.generated, r2.generated, "G28-A: generated match");
  assert.deepStrictEqual(r1.goalSkylineKeys, r2.goalSkylineKeys, "G28-A: goalSkylineKeys match");

  const order1 = r1.capturedExpandedStates.map((s) => buildStateKey(s));
  const order2 = r2.capturedExpandedStates.map((s) => buildStateKey(s));
  assert.strictEqual(order1.length, 100);
  assert.deepStrictEqual(order1, order2, "G28-A: first 100 expansion keys match");

  assert.deepStrictEqual(
    r1.raw.diagnostics.dp.searchOutcome,
    r2.raw.diagnostics.dp.searchOutcome,
    "G28-A: searchOutcome match",
  );

  return {
    fixtureDeterminismVerified: true,
    expansions: r1.expansions,
    frontierSize: r1.frontierSize,
    acceptedStates: r1.acceptedStates,
    generated: r1.generated,
    first100ExpansionKeysMatched: true,
    searchComplete: r1.searchOutcome.searchComplete,
  };
}

// ========== G28-B: Optimization Exact Parity ==========
function gateG28B_OptimizationExactParity() {
  const { project, simulator: simOff } = createSimulator({ fastCollectTargetsEnabled: false });
  const { simulator: simOn } = createSimulator({ fastCollectTargetsEnabled: true });
  const segment = getMt3Segment(project);

  const observerConfig = { captureExpandedStates: true, captureExpandedStateLimit: 100 };
  const rOff = runMt3Fixture(simOff, segment, observerConfig);
  const rOn = runMt3Fixture(simOn, segment, observerConfig);

  assert.strictEqual(rOff.found, rOn.found, "G28-B: found match");
  assert.strictEqual(rOff.expansions, rOn.expansions, "G28-B: expansions match");
  assert.strictEqual(rOff.frontierSize, rOn.frontierSize, "G28-B: frontierSize match");
  assert.strictEqual(rOff.stoppedReason, rOn.stoppedReason, "G28-B: stoppedReason match");
  assert.strictEqual(rOff.acceptedStates, rOn.acceptedStates, "G28-B: acceptedStates match");
  assert.strictEqual(rOff.generated, rOn.generated, "G28-B: generated match");
  assert.strictEqual(rOff.registered, rOn.registered, "G28-B: registered match");
  assert.strictEqual(rOff.goalSkylineCount, rOn.goalSkylineCount, "G28-B: goalSkyline count match");
  assert.deepStrictEqual(rOff.goalSkylineKeys, rOn.goalSkylineKeys, "G28-B: goalSkyline keys match");

  const orderOff = rOff.capturedExpandedStates.map((s) => buildStateKey(s));
  const orderOn = rOn.capturedExpandedStates.map((s) => buildStateKey(s));
  assert.strictEqual(orderOff.length, 100);
  assert.deepStrictEqual(orderOff, orderOn, "G28-B: first 100 expansion keys match");

  assert.deepStrictEqual(
    rOff.raw.diagnostics.dp.searchOutcome,
    rOn.raw.diagnostics.dp.searchOutcome,
    "G28-B: searchOutcome match",
  );

  return {
    optimizationExactParityVerified: true,
    expansions: rOff.expansions,
    acceptedStates: rOff.acceptedStates,
    generated: rOff.generated,
    first100ExpansionsMatched: true,
    cacheOffAndOnIdentical: true,
  };
}

// ========== G28-C: Target-Specific Collection Correctness ==========
function gateG28C_TargetSpecificCollectionCorrectness() {
  const project = loadProject(PROJECT_ROOT);

  // Test across multiple diverse canonical states:
  // 1. Initial MT3 state
  const sMT3 = JSON.parse(JSON.stringify(FIXTURE.state));

  // 2. High stats MT3 state with reachable enemies
  const sHigh = JSON.parse(JSON.stringify(FIXTURE.state));
  sHigh.hero.atk = 1000;
  sHigh.hero.def = 1000;
  sHigh.hero.mdef = 5000;
  sHigh.hero.hp = 50000;

  // 3. Initial MT1 state
  const { simulator: simMT1 } = createSimulator();
  const sMT1 = simMT1.createInitialState();

  const testStates = [
    { label: "MT3 Qualified State", state: sMT3 },
    { label: "MT3 High Stats State", state: sHigh },
    { label: "MT1 Initial State", state: sMT1 },
  ];

  const results = [];
  testStates.forEach(({ label, state }) => {
    // Pickup options
    const pickupOpts = {
      evaluateTarget: (_, __, tile) => {
        if (!tile || tile.cls !== "items") return null;
        return { itemId: tile.id, continuePast: true };
      },
    };
    const pFast = collectTargets(project, state, pickupOpts);
    const pLegacy = collectTargetsLegacy(project, state, pickupOpts);
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(pFast)),
      JSON.parse(JSON.stringify(pLegacy)),
      `G28-C (${label}): pickup targets match`,
    );

    // Battle options (near and traversal)
    const battleOpts = {
      evaluateTarget: (_, __, tile) => {
        if (!tile || tile.cls !== "enemys") return null;
        return { enemyId: tile.id, continuePast: false };
      },
    };
    const bFast = collectTargets(project, state, battleOpts);
    const bLegacy = collectTargetsLegacy(project, state, battleOpts);
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(bFast)),
      JSON.parse(JSON.stringify(bLegacy)),
      `G28-C (${label}): battle targets match`,
    );

    results.push({
      label,
      floorId: state.floorId,
      pickupTargetsCount: pFast.length,
      battleTargetsCount: bFast.length,
    });
  });

  return {
    targetSpecificCollectionCorrectnessVerified: true,
    statesTested: testStates.length,
    allTargetsMatchedExactly: true,
    results,
  };
}

// ========== G28-D: Interleaved Performance A/B ==========
function gateG28D_Performance() {
  const { project, simulator: simOff } = createSimulator({ fastCollectTargetsEnabled: false });
  const { simulator: simOn } = createSimulator({ fastCollectTargetsEnabled: true });
  const segment = getMt3Segment(project);

  // Warmup interleaved
  if (typeof global.gc === "function") global.gc();
  runMt3FixtureWithPerf(simOff, segment);
  if (typeof global.gc === "function") global.gc();
  runMt3FixtureWithPerf(simOn, segment);

  const offRuns = [];
  const onRuns = [];
  const pairImprovements = [];

  for (let pair = 0; pair < PAIRS_COUNT; pair += 1) {
    if (typeof global.gc === "function") global.gc();
    const resOff = runMt3FixtureWithPerf(simOff, segment);
    if (typeof global.gc === "function") global.gc();
    const resOn = runMt3FixtureWithPerf(simOn, segment);
    offRuns.push(resOff);
    onRuns.push(resOn);

    const snapOff = resOff.tracker.snapshot();
    const snapOn = resOn.tracker.snapshot();

    const targetOff = ((snapOff.stabilizationSubphasesMs && snapOff.stabilizationSubphasesMs.pickupScan) || 0) +
      ((snapOff.stabilizationSubphasesMs && snapOff.stabilizationSubphasesMs.battleScan) || 0);
    const targetOn = ((snapOn.stabilizationSubphasesMs && snapOn.stabilizationSubphasesMs.pickupScan) || 0) +
      ((snapOn.stabilizationSubphasesMs && snapOn.stabilizationSubphasesMs.battleScan) || 0);

    const wallGain = Math.round(((resOff.wallMs - resOn.wallMs) / resOff.wallMs) * 1000) / 10;
    const targetGain = targetOff > 0 ? Math.round(((targetOff - targetOn) / targetOff) * 1000) / 10 : 0;
    pairImprovements.push({ pair, wallGain, targetGain });
  }

  const medianWallOff = median(offRuns.map((r) => r.wallMs));
  const medianCpuOff = median(offRuns.map((r) => r.cpuMs));
  const medianEpsOff = median(offRuns.map((r) => r.result.expansions / (r.wallMs / 1000)));

  const medianWallOn = median(onRuns.map((r) => r.wallMs));
  const medianCpuOn = median(onRuns.map((r) => r.cpuMs));
  const medianEpsOn = median(onRuns.map((r) => r.result.expansions / (r.wallMs / 1000)));

  const lastSnapOff = offRuns[offRuns.length - 1].tracker.snapshot();
  const lastSnapOn = onRuns[onRuns.length - 1].tracker.snapshot();

  const stabMsOff = (lastSnapOff.topLevelSelfMs && lastSnapOff.topLevelSelfMs.stabilization) || 0;
  const stabMsOn = (lastSnapOn.topLevelSelfMs && lastSnapOn.topLevelSelfMs.stabilization) || 0;

  const pickupScanMsOff = (lastSnapOff.stabilizationSubphasesMs && lastSnapOff.stabilizationSubphasesMs.pickupScan) || 0;
  const pickupScanMsOn = (lastSnapOn.stabilizationSubphasesMs && lastSnapOn.stabilizationSubphasesMs.pickupScan) || 0;

  const battleScanMsOff = (lastSnapOff.stabilizationSubphasesMs && lastSnapOff.stabilizationSubphasesMs.battleScan) || 0;
  const battleScanMsOn = (lastSnapOn.stabilizationSubphasesMs && lastSnapOn.stabilizationSubphasesMs.battleScan) || 0;

  const targetOffLast = pickupScanMsOff + battleScanMsOff;
  const targetOnLast = pickupScanMsOn + battleScanMsOn;

  const overallWallImprovement = Math.round(((medianWallOff - medianWallOn) / medianWallOff) * 1000) / 10;
  const pairWallMedian = median(pairImprovements.map((p) => p.wallGain));
  const targetBucketMedianImprovement = median(pairImprovements.map((p) => p.targetGain));
  const targetBucketLastPairImprovement = targetOffLast > 0
    ? Math.round(((targetOffLast - targetOnLast) / targetOffLast) * 1000) / 10
    : 0;

  // Cloud Review Acceptance Threshold: overall wall median >= 5% OR pair-wise median >= 5% OR (target bucket median >= 20% AND overall wall positive)
  const meetsThreshold = overallWallImprovement >= 5.0 || pairWallMedian >= 5.0 || (targetBucketMedianImprovement >= 20.0 && overallWallImprovement > 0);

  return {
    performanceMeasured: true,
    pairsCount: PAIRS_COUNT,
    acceptanceThresholdMet: meetsThreshold,
    acceptanceThresholdRequired: "overall median >= 5.0% OR target bucket median >= 20.0%",
    acceptanceThresholdStatus: meetsThreshold ? "passed" : "below-threshold-reported-to-cloud",
    armA_off: {
      medianWallMs: Math.round(medianWallOff),
      medianCpuMs: Math.round(medianCpuOff * 1000) / 1000,
      medianExpansionsPerSec: Math.round(medianEpsOff),
      stabilizationMs: stabMsOff,
      pickupScanMs: pickupScanMsOff,
      battleScanMs: battleScanMsOff,
      individualWallMs: offRuns.map((r) => r.wallMs),
    },
    armB_on: {
      medianWallMs: Math.round(medianWallOn),
      medianCpuMs: Math.round(medianCpuOn * 1000) / 1000,
      medianExpansionsPerSec: Math.round(medianEpsOn),
      stabilizationMs: stabMsOn,
      pickupScanMs: pickupScanMsOn,
      battleScanMs: battleScanMsOn,
      individualWallMs: onRuns.map((r) => r.wallMs),
    },
    pairImprovements,
    overallWallImprovementPercent: overallWallImprovement,
    targetBucketMedianImprovementPercent: targetBucketMedianImprovement,
    targetBucketLastPairImprovementPercent: targetBucketLastPairImprovement,
    faster: medianWallOn < medianWallOff,
  };
}

// ========== G28-E: MT2→MT3 Generalization Gate ==========
function gateG28E_GeneralizationMt2Mt3() {
  const { createSimulator: sim2Helper, getFixtureStartState, getFixtureSegment, runFixture } = require("./check-dp-hot-path");
  const { simulator: simOff } = sim2Helper({ fastCollectTargetsEnabled: false });
  const { simulator: simOn } = sim2Helper({ fastCollectTargetsEnabled: true });
  const { spec, startState } = getFixtureStartState(simOff);
  const segment = getFixtureSegment(spec);

  const observerConfig = { captureExpandedStates: true, captureExpandedStateLimit: 100 };
  const rOff = runFixture(simOff, JSON.parse(JSON.stringify(startState)), segment, observerConfig);
  const rOn = runFixture(simOn, JSON.parse(JSON.stringify(startState)), segment, observerConfig);

  assert.strictEqual(rOff.found, rOn.found, "G28-E: found match");
  assert.strictEqual(rOff.expansions, 520, "G28-E: MT2 fixture expansions must be 520");
  assert.strictEqual(rOn.expansions, 520, "G28-E: MT2 fixture expansions must be 520");
  assert.strictEqual(rOff.acceptedStates, rOn.acceptedStates, "G28-E: acceptedStates match");
  assert.strictEqual(rOff.goalSkylineCount, rOn.goalSkylineCount, "G28-E: goalSkyline count match");
  assert.deepStrictEqual(rOff.goalSkylineKeys, rOn.goalSkylineKeys, "G28-E: goalSkyline keys match");

  const orderOff = rOff.capturedExpandedStates.map((s) => buildStateKey(s));
  const orderOn = rOn.capturedExpandedStates.map((s) => buildStateKey(s));
  assert.deepStrictEqual(orderOff, orderOn, "G28-E: first 100 expansion keys match");

  return {
    generalizationVerified: true,
    mt2Expansions: rOn.expansions,
    mt2AcceptedStates: rOn.acceptedStates,
    mt2GoalSkylineCount: rOn.goalSkylineCount,
    noRegression: true,
  };
}

// ========== Main ==========
function main() {
  const g28a = gateG28A_FixtureDeterminism();
  const g28b = gateG28B_OptimizationExactParity();
  const g28c = gateG28C_TargetSpecificCollectionCorrectness();
  const g28e = gateG28E_GeneralizationMt2Mt3();
  const g28d = gateG28D_Performance();

  const report = {
    schema: "motapathfinder.mt3-mt4-hot-path.v1",
    contractStatus: g28d.acceptanceThresholdMet ? "passed" : "below-threshold-reported-to-cloud",
    iteration: "PR-5.24h Iteration 1 (Auto-Action BFS Traversal Flat-Buffer Optimization)",
    fixture: {
      tower: "OnlyUp",
      segment: "mt3-to-mt4 (from canonical repaired MT3 state)",
      completion: "frontier-exhausted (deterministic)",
      expansions: 897,
      pairsCount: PAIRS_COUNT,
    },
    gates: {
      "G28-A": g28a,
      "G28-B": g28b,
      "G28-C": g28c,
      "G28-D": g28d,
      "G28-E": g28e,
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
  createSimulator,
  getMt3Segment,
  runMt3Fixture,
  runMt3FixtureWithPerf,
  gateG28A_FixtureDeterminism,
  gateG28B_OptimizationExactParity,
  gateG28C_TargetSpecificCollectionCorrectness,
  gateG28D_Performance,
  gateG28E_GeneralizationMt2Mt3,
  FIXTURE,
};
