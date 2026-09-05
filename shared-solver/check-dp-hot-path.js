"use strict";

/** TEST GRADE: local-regression */

/**
 * PR-5.24g — Profile-Guided Canonical DP Hot-Path Optimization.
 *
 * G26 Gate Suite:
 *   G26-A: True Exact Search Equivalence (Arm A cache OFF vs Arm B cache ON)
 *   G26-B: True Expansion-Order Equivalence (Arm A cache OFF vs Arm B cache ON, first 100 expansions)
 *   G26-C1: State-Key Mutation Sensitivity (state-key invalidation across all mutation dimensions)
 *   G26-C2: Cached Block Index Mutation Invalidation (same floorState mutation advances epoch, avoids stale cache hit)
 *   G26-C3: Real Stabilization Mutation Path (in-place auto-action mutation produces exact uncached hazards)
 *   G26-D: Committed Reproducible Performance A/B (interleaved warm runs: OFF vs ON)
 *
 * Fixture: real OnlyUp canonical simulator, mt2-to-mt3 segment from real
 * MT1 state, frontier-exhausted deterministic completion (~520 expansions).
 */

const path = require("node:path");
const assert = require("node:assert");
const { loadProject } = require("./lib/project-loader");
const { StaticSimulator } = require("./lib/simulator");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { getMilestoneSpec } = require("./lib/milestone-spec");
const { searchSegmentDP } = require("./lib/segment-dp");
const { buildStateKey } = require("./lib/state-key");
const { buildMovementHazards } = require("./lib/movement-hazards");
const {
  getFloorMutationEpoch,
  getTileDefinitionAt,
  removeTileAt,
  replaceTileAt,
} = require("./lib/state");
const { createPerfTracker, setActivePerfTracker, getActivePerfTracker } = require("./lib/perf");
const {
  FIRST_REGION_TARGET_FLOOR_ID,
  createNoStateChangeChoiceResolver,
} = require("./lib/onlyup-mt1-real-route-gate");

const PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const PAIRS_COUNT = 4; // 1 warmup pair + 4 reporting pairs (8 runs total)

function createSimulator(memoizationEnabled = true) {
  const project = loadProject(PROJECT_ROOT);
  const simulator = new StaticSimulator(project, {
    stopFloorId: FIRST_REGION_TARGET_FLOOR_ID,
    battleResolver: new FunctionBackedBattleResolver(project, { enableFastReject: true }),
    autoBattleFastRejectEnabled: true,
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFastHazardBlockIndex: true,
    enableHazardBlockIndexMemoization: memoizationEnabled !== false,
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

function runFixtureWithPerf(simulator, startState, segment) {
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
    const result = runFixture(simulator, startState, segment, {});
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

// ========== G26-A: True Exact Search Equivalence (Arm A OFF vs Arm B ON) ==========
function gateG26A_ExactSearchEquivalence() {
  const { simulator: simOff } = createSimulator(false);
  const { simulator: simOn } = createSimulator(true);
  const { spec, startState } = getFixtureStartState(simOff);
  const segment = getFixtureSegment(spec);

  const startStateA = JSON.parse(JSON.stringify(startState));
  const startStateB = JSON.parse(JSON.stringify(startState));

  const resultA = runFixture(simOff, startStateA, segment, {});
  const resultB = runFixture(simOn, startStateB, segment, {});

  assert.strictEqual(resultA.found, resultB.found, "G26-A: found match");
  assert.strictEqual(resultA.expansions, resultB.expansions, "G26-A: expansions match");
  assert.strictEqual(resultA.frontierSize, resultB.frontierSize, "G26-A: frontierSize match");
  assert.strictEqual(resultA.stoppedReason, resultB.stoppedReason, "G26-A: stoppedReason match");
  assert.strictEqual(resultA.acceptedStates, resultB.acceptedStates, "G26-A: acceptedStates match");
  assert.strictEqual(resultA.generated, resultB.generated, "G26-A: generated match");
  assert.strictEqual(resultA.registered, resultB.registered, "G26-A: registered match");
  assert.strictEqual(resultA.goalSkylineCount, resultB.goalSkylineCount, "G26-A: goalSkyline count match");
  assert.deepStrictEqual(resultA.goalSkylineKeys, resultB.goalSkylineKeys, "G26-A: goalSkyline state-key multiset match");

  if (resultA.route && resultB.route) {
    const traceA = resultA.route.map((step) => typeof step === "string" ? step : step.summary);
    const traceB = resultB.route.map((step) => typeof step === "string" ? step : step.summary);
    assert.deepStrictEqual(traceA, traceB, "G26-A: action trace summaries match");
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(resultA.route)),
      JSON.parse(JSON.stringify(resultB.route)),
      "G26-A: full action route objects match",
    );
  }

  assert.deepStrictEqual(
    resultA.raw.diagnostics.dp.searchOutcome,
    resultB.raw.diagnostics.dp.searchOutcome,
    "G26-A: searchOutcome match",
  );

  return {
    exactSearchEquivalence: true,
    armA_off_expansions: resultA.expansions,
    armB_on_expansions: resultB.expansions,
    found: resultA.found,
    frontierSize: resultA.frontierSize,
    stoppedReason: resultA.stoppedReason,
    acceptedStates: resultA.acceptedStates,
    goalSkylineCount: resultA.goalSkylineCount,
    cacheOffAndOnIdentical: true,
  };
}

// ========== G26-B: True Expansion-Order Equivalence (Arm A OFF vs Arm B ON) ==========
function gateG26B_ExpansionOrderEquivalence() {
  const { simulator: simOff } = createSimulator(false);
  const { simulator: simOn } = createSimulator(true);
  const { spec, startState } = getFixtureStartState(simOff);
  const segment = getFixtureSegment(spec);

  const observerConfig = {
    captureExpandedStates: true,
    captureExpandedStateLimit: 100,
  };

  const startStateA = JSON.parse(JSON.stringify(startState));
  const startStateB = JSON.parse(JSON.stringify(startState));

  const resultA = runFixture(simOff, startStateA, segment, observerConfig);
  const resultB = runFixture(simOn, startStateB, segment, observerConfig);

  const orderA = resultA.capturedExpandedStates.map((s) => buildStateKey(s));
  const orderB = resultB.capturedExpandedStates.map((s) => buildStateKey(s));

  const n = Math.min(100, orderA.length, orderB.length);
  assert.ok(n >= 50, `G26-B: need at least 50 expansions to compare (got ${n})`);
  for (let i = 0; i < n; i++) {
    assert.strictEqual(orderA[i], orderB[i], `G26-B: expansion ${i} DP key mismatch`);
  }

  return {
    expansionOrderEquivalence: true,
    expansionsCompared: n,
    cacheOffAndOnOrderIdentical: true,
  };
}

// ========== G26-C1: State-Key Mutation Sensitivity ==========
function gateG26C1_StateKeyMutationSensitivity() {
  const { simulator } = createSimulator();
  const s0 = simulator.createInitialState();

  // 1. Same object repeated reads
  const key1 = buildStateKey(s0);
  const key2 = buildStateKey(s0);
  assert.strictEqual(key1, key2, "G26-C1: same object repeated read must give same key");

  // 2. Different objects with same state
  const s0Clone = JSON.parse(JSON.stringify(s0));
  assert.strictEqual(key1, buildStateKey(s0Clone), "G26-C1: different object same state must give same key");

  // 3. HP change
  const sHP = JSON.parse(JSON.stringify(s0));
  sHP.hero.hp = 999999;
  assert.notStrictEqual(key1, buildStateKey(sHP), "G26-C1: HP change must produce different key");

  // 4. Flags change
  const sFlags = JSON.parse(JSON.stringify(s0));
  sFlags.flags.customTestFlag = "test";
  assert.notStrictEqual(key1, buildStateKey(sFlags), "G26-C1: flags change must produce different key");

  // 5. Inventory change
  const sInv = JSON.parse(JSON.stringify(s0));
  sInv.inventory.newItem = 1;
  assert.notStrictEqual(key1, buildStateKey(sInv), "G26-C1: inventory change must produce different key");

  // 6. Floor mutation change (via floorStates)
  const sMut = JSON.parse(JSON.stringify(s0));
  if (!sMut.floorStates) sMut.floorStates = {};
  if (!sMut.floorStates.MT1) sMut.floorStates.MT1 = { removed: {}, replaced: {} };
  sMut.floorStates.MT1.removed["99,99"] = true;
  assert.notStrictEqual(key1, buildStateKey(sMut), "G26-C1: floor mutation change must produce different key");

  // 7. Equipment change
  const sEq = JSON.parse(JSON.stringify(s0));
  sEq.hero.equipment = ["testItem"];
  assert.notStrictEqual(key1, buildStateKey(sEq), "G26-C1: equipment change must produce different key");

  // 8. Visited floors change
  const sVF = JSON.parse(JSON.stringify(s0));
  if (!sVF.visitedFloors) sVF.visitedFloors = {};
  sVF.visitedFloors["MT99"] = true;
  assert.notStrictEqual(key1, buildStateKey(sVF), "G26-C1: visitedFloors change must produce different key");

  return {
    stateKeyMutationSensitivityVerified: true,
    sameObjectConsistent: true,
    differentObjectSameState: true,
    allMutationsDiffer: true,
  };
}

// ========== G26-C2: Cached Block Index Mutation Invalidation ==========
function gateG26C2_CachedBlockIndexMutationInvalidation() {
  const { project, simulator } = createSimulator(true);
  const s0 = simulator.createInitialState();
  const floorId = "MT1";

  // 1. Initial build: warms the cache on s0's floorState for MT1
  const tracker = createPerfTracker({ enabled: true });
  setActivePerfTracker(tracker);

  const hazardsBefore = buildMovementHazards(project, s0, {
    floorId,
    perfTracker: tracker,
    enableFastHazardBlockIndex: true,
    enableHazardBlockIndexMemoization: true,
  });

  const floorState = s0.floorStates && s0.floorStates[floorId];
  assert.ok(floorState, "G26-C2: floorState must exist for MT1");
  const initialEpoch = getFloorMutationEpoch(floorState);

  const cachedRecord = floorState.__blockIndexCache;
  assert.ok(cachedRecord && cachedRecord.blocks, "G26-C2: cache record must be populated");
  assert.strictEqual(cachedRecord.epoch, initialEpoch, `G26-C2: cache record must be bound to initial epoch (${initialEpoch})`);

  // Choose an existing enemy tile on MT1: (8,7) blackSlime
  const targetX = 8, targetY = 7;
  const tileBefore = getTileDefinitionAt(project, s0, floorId, targetX, targetY);
  assert.ok(tileBefore != null, `G26-C2: tile at (${targetX},${targetY}) must exist initially`);
  const locKey = `${targetX},${targetY}`;
  assert.ok(cachedRecord.blocks[locKey] != null, `G26-C2: cached blocks must contain (${targetX},${targetY})`);

  // 2. In-place mutation on SAME state / SAME floorState reference
  removeTileAt(s0, floorId, targetX, targetY);

  const mutatedEpoch = getFloorMutationEpoch(floorState);
  assert.strictEqual(mutatedEpoch, initialEpoch + 1, "G26-C2: epoch must increment by 1 after removeTileAt");
  assert.strictEqual(floorState.__blockIndexCache, undefined, "G26-C2: defensive cleanup deletes stale cache property");

  // 3. Rebuild hazards on SAME state
  const hitsBefore = (tracker.snapshot().semanticCounters && tracker.snapshot().semanticCounters.hazardBlockIndexCacheHits) || 0;
  const hazardsAfter = buildMovementHazards(project, s0, {
    floorId,
    perfTracker: tracker,
    enableFastHazardBlockIndex: true,
    enableHazardBlockIndexMemoization: true,
  });
  const hitsAfter = (tracker.snapshot().semanticCounters && tracker.snapshot().semanticCounters.hazardBlockIndexCacheHits) || 0;
  assert.strictEqual(hitsAfter, hitsBefore, "G26-C2: cache hit must NOT occur at stale epoch");

  // Rebuilt cache must be bound to updated epoch, and removed tile must NOT be in blocks
  const newCachedRecord = floorState.__blockIndexCache;
  assert.ok(newCachedRecord && newCachedRecord.blocks, "G26-C2: new cache record must be populated");
  assert.strictEqual(newCachedRecord.epoch, initialEpoch + 1, `G26-C2: new cache record must be bound to epoch ${initialEpoch + 1}`);
  assert.strictEqual(newCachedRecord.blocks[locKey], undefined, `G26-C2: removed tile (${targetX},${targetY}) must NOT be in rebuilt blocks`);

  // 4. Test replaceTileAt on SAME floorState
  const replaceX = 5, replaceY = 5;
  const newNumber = 1; // yellowWall / blocker
  replaceTileAt(s0, floorId, replaceX, replaceY, newNumber);
  assert.strictEqual(getFloorMutationEpoch(floorState), initialEpoch + 2, "G26-C2: epoch must increment after replaceTileAt");

  const hazardsAfterReplace = buildMovementHazards(project, s0, {
    floorId,
    perfTracker: tracker,
    enableFastHazardBlockIndex: true,
    enableHazardBlockIndexMemoization: true,
  });
  const replaceCached = floorState.__blockIndexCache;
  assert.ok(replaceCached && replaceCached.blocks, "G26-C2: cache after replace must exist");
  assert.strictEqual(replaceCached.epoch, initialEpoch + 2, `G26-C2: cache after replace must be bound to epoch ${initialEpoch + 2}`);
  assert.strictEqual(replaceCached.blocks[`${replaceX},${replaceY}`].id, "yellowWall", "G26-C2: replaced tile definition must be active");

  setActivePerfTracker(null);
  return {
    cachedBlockIndexMutationInvalidationVerified: true,
    initialEpoch,
    mutatedEpoch,
    replaceEpoch: initialEpoch + 2,
    staleCacheHitPrevented: true,
    tileRemovedFromRebuiltBlocks: true,
    tileReplacedInRebuiltBlocks: true,
  };
}

// ========== G26-C3: Real Stabilization Mutation Path ==========
function gateG26C3_RealStabilizationMutationPath() {
  const { project, simulator } = createSimulator(true);
  const s0 = simulator.createInitialState();

  // Warm hazards on clean initial state (establishes initial cache)
  simulator.autoResolver.buildHazards(project, s0, simulator.battleResolver, null);

  // Run stabilization on s0: auto-pickup / auto-battle mutates state in-place
  const stabilizedState = simulator.stabilizeState(s0);

  // Post-mutation hazards on the mutated state (with memoization enabled)
  const cachedPostHazards = simulator.autoResolver.buildHazards(project, stabilizedState, simulator.battleResolver, null);

  // Fresh cloned state without any prior cache, with memoization OFF
  const { simulator: uncachedSim } = createSimulator(false);
  const freshClonedState = JSON.parse(JSON.stringify(stabilizedState));
  const freshUncachedHazards = uncachedSim.autoResolver.buildHazards(project, freshClonedState, uncachedSim.battleResolver, null);

  // Compare damage, repulse, ambush, betweenAttackLocs
  assert.deepStrictEqual(cachedPostHazards.damage, freshUncachedHazards.damage, "G26-C3: damage match");
  assert.deepStrictEqual(cachedPostHazards.repulse, freshUncachedHazards.repulse, "G26-C3: repulse match");
  assert.deepStrictEqual(cachedPostHazards.ambush, freshUncachedHazards.ambush, "G26-C3: ambush match");
  assert.deepStrictEqual(cachedPostHazards.betweenAttackLocs, freshUncachedHazards.betweenAttackLocs, "G26-C3: betweenAttackLocs match");

  return {
    realStabilizationMutationPathVerified: true,
    damageMatch: true,
    repulseMatch: true,
    ambushMatch: true,
    betweenAttackLocsMatch: true,
  };
}

// ========== G26-D: Committed Reproducible Performance A/B ==========
function gateG26D_Performance() {
  const { simulator: simOff } = createSimulator(false);
  const { simulator: simOn } = createSimulator(true);
  const { spec, startState } = getFixtureStartState(simOff);
  const segment = getFixtureSegment(spec);

  // Warmup interleaved
  runFixtureWithPerf(simOff, JSON.parse(JSON.stringify(startState)), segment);
  runFixtureWithPerf(simOn, JSON.parse(JSON.stringify(startState)), segment);

  // Interleaved reporting runs (avoid temperature/JIT drift)
  const offRuns = [];
  const onRuns = [];

  for (let pair = 0; pair < PAIRS_COUNT; pair++) {
    const resOff = runFixtureWithPerf(simOff, JSON.parse(JSON.stringify(startState)), segment);
    const resOn = runFixtureWithPerf(simOn, JSON.parse(JSON.stringify(startState)), segment);
    offRuns.push(resOff);
    onRuns.push(resOn);
  }

  const medianWallOff = median(offRuns.map((r) => r.wallMs));
  const medianCpuOff = median(offRuns.map((r) => r.cpuMs));
  const medianEpsOff = median(offRuns.map((r) => r.result.expansions / (r.wallMs / 1000)));

  const medianWallOn = median(onRuns.map((r) => r.wallMs));
  const medianCpuOn = median(onRuns.map((r) => r.cpuMs));
  const medianEpsOn = median(onRuns.map((r) => r.result.expansions / (r.wallMs / 1000)));

  const lastSnapOff = offRuns[offRuns.length - 1].tracker.snapshot();
  const lastSnapOn = onRuns[onRuns.length - 1].tracker.snapshot();

  const hazardBlockIndexMsOff = (lastSnapOff.stabilizationSubphasesMs && lastSnapOff.stabilizationSubphasesMs.hazardBlockIndex) || 0;
  const hazardBlockIndexMsOn = (lastSnapOn.stabilizationSubphasesMs && lastSnapOn.stabilizationSubphasesMs.hazardBlockIndex) || 0;

  const cellsScannedOff = (lastSnapOff.semanticCounters && lastSnapOff.semanticCounters.hazardCellsScanned) || 0;
  const cellsScannedOn = (lastSnapOn.semanticCounters && lastSnapOn.semanticCounters.hazardCellsScanned) || 0;
  const cacheHitsOn = (lastSnapOn.semanticCounters && lastSnapOn.semanticCounters.hazardBlockIndexCacheHits) || 0;

  const overallWallImprovement = Math.round(((medianWallOff - medianWallOn) / medianWallOff) * 1000) / 10;
  const targetBucketImprovement = hazardBlockIndexMsOff > 0
    ? Math.round(((hazardBlockIndexMsOff - hazardBlockIndexMsOn) / hazardBlockIndexMsOff) * 1000) / 10
    : 0;

  return {
    performanceMeasured: true,
    pairsCount: PAIRS_COUNT,
    armA_off: {
      medianWallMs: Math.round(medianWallOff),
      medianCpuMs: Math.round(medianCpuOff * 1000) / 1000,
      medianExpansionsPerSec: Math.round(medianEpsOff),
      hazardBlockIndexMs: hazardBlockIndexMsOff,
      hazardCellsScanned: cellsScannedOff,
      individualWallMs: offRuns.map((r) => r.wallMs),
    },
    armB_on: {
      medianWallMs: Math.round(medianWallOn),
      medianCpuMs: Math.round(medianCpuOn * 1000) / 1000,
      medianExpansionsPerSec: Math.round(medianEpsOn),
      hazardBlockIndexMs: hazardBlockIndexMsOn,
      hazardCellsScanned: cellsScannedOn,
      hazardBlockIndexCacheHits: cacheHitsOn,
      individualWallMs: onRuns.map((r) => r.wallMs),
    },
    overallWallImprovementPercent: overallWallImprovement,
    targetBucketImprovementPercent: targetBucketImprovement,
    faster: medianWallOn < medianWallOff,
  };
}

// ========== Main ==========
function main() {
  const g26a = gateG26A_ExactSearchEquivalence();
  const g26b = gateG26B_ExpansionOrderEquivalence();
  const g26c1 = gateG26C1_StateKeyMutationSensitivity();
  const g26c2 = gateG26C2_CachedBlockIndexMutationInvalidation();
  const g26c3 = gateG26C3_RealStabilizationMutationPath();
  const g26d = gateG26D_Performance();

  const report = {
    schema: "motapathfinder.dp-hot-path.v2",
    contractStatus: "passed",
    fixture: {
      tower: "OnlyUp",
      segment: "mt2-to-mt3 (from real MT1 state)",
      completion: "frontier-exhausted (deterministic)",
      pairsCount: PAIRS_COUNT,
    },
    gates: {
      "G26-A": g26a,
      "G26-B": g26b,
      "G26-C1": g26c1,
      "G26-C2": g26c2,
      "G26-C3": g26c3,
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
  gateG26C1_StateKeyMutationSensitivity,
  gateG26C2_CachedBlockIndexMutationInvalidation,
  gateG26C3_RealStabilizationMutationPath,
  gateG26D_Performance,
  createSimulator,
  getFixtureStartState,
  getFixtureSegment,
  runFixture,
  runFixtureWithPerf,
};
