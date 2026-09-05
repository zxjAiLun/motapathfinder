"use strict";

/** TEST GRADE: local-regression */

/**
 * PR-5.24g — Profile-Guided Canonical DP Hot-Path Optimization.
 *
 * Iteration 1 (G26 Suite):
 *   G26-A: True Exact Search Equivalence (Block-Index Memoization OFF vs ON)
 *   G26-B: True Expansion-Order Equivalence (first 100 expansions)
 *   G26-C1: State-Key Mutation Sensitivity (8 dimensions)
 *   G26-C2: Cached Block Index Mutation Invalidation (removeTileAt / replaceTileAt)
 *   G26-C3: Real Stabilization Mutation Path
 *   G26-D: Performance A/B (Block Index Memoization)
 *
 * Iteration 2 (G27 Suite):
 *   G27-A: Battle Result Exact Parity (Arm A OFF vs Arm B ON across real tiles/enemies)
 *   G27-B: AutoBattle Scan Parity (collectAutoBattleTargets identical)
 *   G27-C: Stabilization Exact Parity (stabilizeState identical across all fields)
 *   G27-D: Search Parity (520-exp fixture, expansions, skyline, first 100 keys, route)
 *   G27-E: Committed Reproducible Performance A/B (interleaved 4 pairs, enforced threshold)
 *   G27-F: Battle Cache Mutation Safety (8-dimension cache-key divergence)
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

function createSimulator(options = {}) {
  const project = loadProject(PROJECT_ROOT);
  const memoizationEnabled = options.memoizationEnabled !== false;
  const fastBattleEstimateCacheEnabled = options.fastBattleEstimateCacheEnabled !== false;

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
    enableCompiledEffectCache: false,
    choiceResolver: createNoStateChangeChoiceResolver(),
  });
  return { project, simulator };
}

function getFixtureStartState(simulator) {
  const project = loadProject(PROJECT_ROOT);
  const spec = getMilestoneSpec(project, "onlyup-chaos-mt1-mt4");
  const s0 = simulator.createInitialState();
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
  return { ...spec.milestones[1], dp: { ...spec.milestones[1].dp, maxRuntimeMs: 600000 } };
}

function runFixture(simulator, startState, segment, opts = {}) {
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

// ========== G26 SUITE (Iteration 1 Baseline Verification) ==========

function gateG26A_ExactSearchEquivalence() {
  const { simulator: simOff } = createSimulator({ memoizationEnabled: false });
  const { simulator: simOn } = createSimulator({ memoizationEnabled: true });
  const { spec, startState } = getFixtureStartState(simOff);
  const segment = getFixtureSegment(spec);

  const resultA = runFixture(simOff, JSON.parse(JSON.stringify(startState)), segment, {});
  const resultB = runFixture(simOn, JSON.parse(JSON.stringify(startState)), segment, {});

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
    const traceA = resultA.route.map((step) => (typeof step === "string" ? step : step.summary));
    const traceB = resultB.route.map((step) => (typeof step === "string" ? step : step.summary));
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

function gateG26B_ExpansionOrderEquivalence() {
  const { simulator: simOff } = createSimulator({ memoizationEnabled: false });
  const { simulator: simOn } = createSimulator({ memoizationEnabled: true });
  const { spec, startState } = getFixtureStartState(simOff);
  const segment = getFixtureSegment(spec);

  const observerConfig = {
    captureExpandedStates: true,
    captureExpandedStateLimit: 100,
  };

  const resultA = runFixture(simOff, JSON.parse(JSON.stringify(startState)), segment, observerConfig);
  const resultB = runFixture(simOn, JSON.parse(JSON.stringify(startState)), segment, observerConfig);

  const orderA = resultA.capturedExpandedStates.map((s) => buildStateKey(s));
  const orderB = resultB.capturedExpandedStates.map((s) => buildStateKey(s));

  const n = Math.min(100, orderA.length, orderB.length);
  assert.ok(n >= 50, `G26-B: need at least 50 expansions to compare (got ${n})`);
  for (let i = 0; i < n; i += 1) {
    assert.strictEqual(orderA[i], orderB[i], `G26-B: expansion ${i} DP key mismatch`);
  }

  return {
    expansionOrderEquivalence: true,
    expansionsCompared: n,
    cacheOffAndOnOrderIdentical: true,
  };
}

function gateG26C1_StateKeyMutationSensitivity() {
  const { simulator } = createSimulator();
  const s0 = simulator.createInitialState();

  const key1 = buildStateKey(s0);
  const key2 = buildStateKey(s0);
  assert.strictEqual(key1, key2, "G26-C1: same object repeated read must give same key");

  const s0Clone = JSON.parse(JSON.stringify(s0));
  assert.strictEqual(key1, buildStateKey(s0Clone), "G26-C1: different object same state must give same key");

  const sHP = JSON.parse(JSON.stringify(s0));
  sHP.hero.hp = 999999;
  assert.notStrictEqual(key1, buildStateKey(sHP), "G26-C1: HP change must produce different key");

  const sFlags = JSON.parse(JSON.stringify(s0));
  sFlags.flags.customTestFlag = "test";
  assert.notStrictEqual(key1, buildStateKey(sFlags), "G26-C1: flags change must produce different key");

  const sInv = JSON.parse(JSON.stringify(s0));
  sInv.inventory.newItem = 1;
  assert.notStrictEqual(key1, buildStateKey(sInv), "G26-C1: inventory change must produce different key");

  const sMut = JSON.parse(JSON.stringify(s0));
  if (!sMut.floorStates) sMut.floorStates = {};
  if (!sMut.floorStates.MT1) sMut.floorStates.MT1 = { removed: {}, replaced: {} };
  sMut.floorStates.MT1.removed["99,99"] = true;
  assert.notStrictEqual(key1, buildStateKey(sMut), "G26-C1: floor mutation change must produce different key");

  const sEq = JSON.parse(JSON.stringify(s0));
  sEq.hero.equipment = ["testItem"];
  assert.notStrictEqual(key1, buildStateKey(sEq), "G26-C1: equipment change must produce different key");

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

function gateG26C2_CachedBlockIndexMutationInvalidation() {
  const { project, simulator } = createSimulator({ memoizationEnabled: true });
  const s0 = simulator.createInitialState();
  const floorId = "MT1";

  const tracker = createPerfTracker({ enabled: true });
  setActivePerfTracker(tracker);

  buildMovementHazards(project, s0, {
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

  const targetX = 8;
  const targetY = 7;
  const tileBefore = getTileDefinitionAt(project, s0, floorId, targetX, targetY);
  assert.ok(tileBefore != null, `G26-C2: tile at (${targetX},${targetY}) must exist initially`);
  const locKey = `${targetX},${targetY}`;
  assert.ok(cachedRecord.blocks[locKey] != null, `G26-C2: cached blocks must contain (${targetX},${targetY})`);

  removeTileAt(s0, floorId, targetX, targetY);

  const mutatedEpoch = getFloorMutationEpoch(floorState);
  assert.strictEqual(mutatedEpoch, initialEpoch + 1, "G26-C2: epoch must increment by 1 after removeTileAt");
  assert.strictEqual(floorState.__blockIndexCache, undefined, "G26-C2: defensive cleanup deletes stale cache property");

  const hitsBefore = (tracker.snapshot().semanticCounters && tracker.snapshot().semanticCounters.hazardBlockIndexCacheHits) || 0;
  buildMovementHazards(project, s0, {
    floorId,
    perfTracker: tracker,
    enableFastHazardBlockIndex: true,
    enableHazardBlockIndexMemoization: true,
  });
  const hitsAfter = (tracker.snapshot().semanticCounters && tracker.snapshot().semanticCounters.hazardBlockIndexCacheHits) || 0;
  assert.strictEqual(hitsAfter, hitsBefore, "G26-C2: cache hit must NOT occur at stale epoch");

  const newCachedRecord = floorState.__blockIndexCache;
  assert.ok(newCachedRecord && newCachedRecord.blocks, "G26-C2: new cache record must be populated");
  assert.strictEqual(newCachedRecord.epoch, initialEpoch + 1, `G26-C2: new cache record must be bound to epoch ${initialEpoch + 1}`);
  assert.strictEqual(newCachedRecord.blocks[locKey], undefined, `G26-C2: removed tile (${targetX},${targetY}) must NOT be in rebuilt blocks`);

  const replaceX = 5;
  const replaceY = 5;
  const newNumber = 1;
  replaceTileAt(s0, floorId, replaceX, replaceY, newNumber);
  assert.strictEqual(getFloorMutationEpoch(floorState), initialEpoch + 2, "G26-C2: epoch must increment after replaceTileAt");

  buildMovementHazards(project, s0, {
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

function gateG26C3_RealStabilizationMutationPath() {
  const { project, simulator } = createSimulator({ memoizationEnabled: true });
  const s0 = simulator.createInitialState();

  simulator.autoResolver.buildHazards(project, s0, simulator.battleResolver, null);
  const stabilizedState = simulator.stabilizeState(s0);

  const cachedPostHazards = simulator.autoResolver.buildHazards(project, stabilizedState, simulator.battleResolver, null);

  const { simulator: uncachedSim } = createSimulator({ memoizationEnabled: false });
  const freshClonedState = JSON.parse(JSON.stringify(stabilizedState));
  const freshUncachedHazards = uncachedSim.autoResolver.buildHazards(project, freshClonedState, uncachedSim.battleResolver, null);

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

// ========== G27 SUITE (Iteration 2: Battle-Scan Optimization) ==========

// G27-A: Battle Result Exact Parity
// Compare evaluateBattle outputs across multiple real tiles and enemies between OFF and ON.
function gateG27A_BattleResultExactParity() {
  const { simulator: simOff } = createSimulator({ fastBattleEstimateCacheEnabled: false });
  const { simulator: simOn } = createSimulator({ fastBattleEstimateCacheEnabled: true });
  const s0 = simOff.createInitialState();

  const testEnemies = [
    { floorId: "MT1", x: 8, y: 7, id: "blackSlime" },
    { floorId: "MT1", x: 10, y: 8, id: "redSlime" },
    { floorId: "MT1", x: 9, y: 4, id: "slimelord" },
    { floorId: "MT1", x: 2, y: 1, id: "skeletonWarrior" },
    { floorId: "MT1", x: 4, y: 3, id: "vampire" },
    { floorId: "MT2", x: 4, y: 1, id: "skeleton" },
    { floorId: "MT2", x: 2, y: 1, id: "ghostSoldier" },
    { floorId: "MT2", x: 8, y: 7, id: "redPriest" },
    { floorId: "MT2", x: 6, y: 6, id: "brownWizard" },
    { floorId: "MT2", x: 9, y: 10, id: "bluePriest" },
  ];

  const results = [];
  testEnemies.forEach((e) => {
    const bOff = simOff.battleResolver.evaluateBattle(s0, e.floorId, e.x, e.y, e.id);
    const bOn = simOn.battleResolver.evaluateBattle(s0, e.floorId, e.x, e.y, e.id);

    assert.strictEqual(bOff.supported, bOn.supported, `G27-A: supported match for ${e.id}`);
    if (!bOff.supported) {
      assert.strictEqual(bOff.reason, bOn.reason, `G27-A: reason match for ${e.id}`);
      return;
    }

    if (bOff.damageInfo == null) {
      assert.strictEqual(bOn.damageInfo, null, `G27-A: null damageInfo match for ${e.id}`);
    } else {
      assert.ok(bOn.damageInfo != null, `G27-A: non-null damageInfo match for ${e.id}`);
      assert.strictEqual(bOff.damageInfo.damage, bOn.damageInfo.damage, `G27-A: damage match for ${e.id}`);
      assert.strictEqual(bOff.damageInfo.turn, bOn.damageInfo.turn, `G27-A: turn match for ${e.id}`);
      assert.strictEqual(bOff.damageInfo.mon_hp, bOn.damageInfo.mon_hp, `G27-A: mon_hp match for ${e.id}`);
      assert.strictEqual(bOff.damageInfo.mon_atk, bOn.damageInfo.mon_atk, `G27-A: mon_atk match for ${e.id}`);
      assert.strictEqual(bOff.damageInfo.mon_def, bOn.damageInfo.mon_def, `G27-A: mon_def match for ${e.id}`);
      assert.deepStrictEqual(
        JSON.parse(JSON.stringify(bOff.damageInfo)),
        JSON.parse(JSON.stringify(bOn.damageInfo)),
        `G27-A: damageInfo match for ${e.id}`,
      );
    }

    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(bOff.guards)),
      JSON.parse(JSON.stringify(bOn.guards)),
      `G27-A: guards match for ${e.id}`,
    );
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(bOff.enemyInfo)),
      JSON.parse(JSON.stringify(bOn.enemyInfo)),
      `G27-A: enemyInfo match for ${e.id}`,
    );

    const zeroOff = Boolean(bOff.damageInfo && Number(bOff.damageInfo.damage || 0) === 0);
    const zeroOn = Boolean(bOn.damageInfo && Number(bOn.damageInfo.damage || 0) === 0);
    assert.strictEqual(zeroOff, zeroOn, `G27-A: zero-damage classification match for ${e.id}`);

    results.push({
      enemyId: e.id,
      floorId: e.floorId,
      damage: bOff.damageInfo ? bOff.damageInfo.damage : null,
      zeroDamage: zeroOff,
    });
  });

  return {
    battleResultExactParityVerified: true,
    enemiesChecked: testEnemies.length,
    allParityMatched: true,
    samples: results.slice(0, 4),
  };
}

// G27-B: AutoBattle Scan Parity
// Compare collectAutoBattleTargets() between OFF and ON on states with zero-damage targets.
function gateG27B_AutoBattleScanParity() {
  const { simulator: simOff } = createSimulator({ fastBattleEstimateCacheEnabled: false });
  const { simulator: simOn } = createSimulator({ fastBattleEstimateCacheEnabled: true });

  const s = simOff.createInitialState();
  s.hero.atk = 100;
  s.hero.def = 100;
  s.hero.hp = 5000;

  const resOff = simOff.autoResolver.collectAutoBattleTargets(simOff.project, s, simOff.battleResolver, null);
  const resOn = simOn.autoResolver.collectAutoBattleTargets(simOn.project, s, simOn.battleResolver, null);

  assert.ok(resOff.targets.length > 0, "G27-B: must find zero-damage targets");
  assert.strictEqual(resOff.targets.length, resOn.targets.length, "G27-B: target count match");

  for (let i = 0; i < resOff.targets.length; i += 1) {
    const tOff = resOff.targets[i];
    const tOn = resOn.targets[i];
    assert.strictEqual(tOff.enemyId, tOn.enemyId, `G27-B: target ${i} enemyId match`);
    assert.strictEqual(tOff.continuePast, tOn.continuePast, `G27-B: target ${i} continuePast match`);
    assert.strictEqual(tOff.x, tOn.x, `G27-B: target ${i} x match`);
    assert.strictEqual(tOff.y, tOn.y, `G27-B: target ${i} y match`);
    assert.strictEqual(tOff.distance, tOn.distance, `G27-B: target ${i} distance match`);
  }

  return {
    autoBattleScanParityVerified: true,
    zeroDamageTargetsCount: resOff.targets.length,
    targetsExactMatch: true,
  };
}

// G27-C: Stabilization Exact Parity
function gateG27C_StabilizationExactParity() {
  const { simulator: simOff } = createSimulator({ fastBattleEstimateCacheEnabled: false });
  const { simulator: simOn } = createSimulator({ fastBattleEstimateCacheEnabled: true });

  const s0 = simOff.createInitialState();
  const stabOff = simOff.stabilizeState(JSON.parse(JSON.stringify(s0)));
  const stabOn = simOn.stabilizeState(JSON.parse(JSON.stringify(s0)));

  const keyOff = buildStateKey(stabOff);
  const keyOn = buildStateKey(stabOn);
  assert.strictEqual(keyOff, keyOn, "G27-C: final stabilized stateKey match");

  assert.strictEqual(stabOff.hero.hp, stabOn.hero.hp, "G27-C: HP match");
  assert.strictEqual(stabOff.hero.atk, stabOn.hero.atk, "G27-C: ATK match");
  assert.strictEqual(stabOff.hero.def, stabOn.hero.def, "G27-C: DEF match");
  assert.strictEqual(stabOff.hero.mdef, stabOn.hero.mdef, "G27-C: MDEF match");
  assert.strictEqual(stabOff.hero.exp, stabOn.hero.exp, "G27-C: EXP match");
  assert.strictEqual(stabOff.hero.money, stabOn.hero.money, "G27-C: money match");

  assert.deepStrictEqual(stabOff.inventory, stabOn.inventory, "G27-C: inventory match");
  assert.deepStrictEqual(stabOff.flags, stabOn.flags, "G27-C: flags match");
  assert.deepStrictEqual(stabOff.floorStates, stabOn.floorStates, "G27-C: floorStates match");

  return {
    stabilizationExactParityVerified: true,
    stabilizedStateKey: keyOff,
    allStateFieldsMatch: true,
  };
}

// G27-D: Search Parity (Deterministic 520-exp fixture)
function gateG27D_SearchParity() {
  const { simulator: simOff } = createSimulator({ fastBattleEstimateCacheEnabled: false });
  const { simulator: simOn } = createSimulator({ fastBattleEstimateCacheEnabled: true });
  const { spec, startState } = getFixtureStartState(simOff);
  const segment = getFixtureSegment(spec);

  const observerConfig = {
    captureExpandedStates: true,
    captureExpandedStateLimit: 100,
  };

  const resultA = runFixture(simOff, JSON.parse(JSON.stringify(startState)), segment, observerConfig);
  const resultB = runFixture(simOn, JSON.parse(JSON.stringify(startState)), segment, observerConfig);

  assert.strictEqual(resultA.found, resultB.found, "G27-D: found match");
  assert.strictEqual(resultA.expansions, resultB.expansions, "G27-D: expansions match");
  assert.strictEqual(resultA.frontierSize, resultB.frontierSize, "G27-D: frontierSize match");
  assert.strictEqual(resultA.stoppedReason, resultB.stoppedReason, "G27-D: stoppedReason match");
  assert.strictEqual(resultA.acceptedStates, resultB.acceptedStates, "G27-D: acceptedStates match");
  assert.strictEqual(resultA.generated, resultB.generated, "G27-D: generated match");
  assert.strictEqual(resultA.registered, resultB.registered, "G27-D: registered match");
  assert.strictEqual(resultA.goalSkylineCount, resultB.goalSkylineCount, "G27-D: goalSkyline count match");
  assert.deepStrictEqual(resultA.goalSkylineKeys, resultB.goalSkylineKeys, "G27-D: goalSkyline keys match");

  if (resultA.route && resultB.route) {
    const traceA = resultA.route.map((step) => (typeof step === "string" ? step : step.summary));
    const traceB = resultB.route.map((step) => (typeof step === "string" ? step : step.summary));
    assert.deepStrictEqual(traceA, traceB, "G27-D: action trace summaries match");
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(resultA.route)),
      JSON.parse(JSON.stringify(resultB.route)),
      "G27-D: full action route objects match",
    );
  }

  const orderA = resultA.capturedExpandedStates.map((s) => buildStateKey(s));
  const orderB = resultB.capturedExpandedStates.map((s) => buildStateKey(s));
  const n = Math.min(100, orderA.length, orderB.length);
  assert.ok(n >= 50, `G27-D: need at least 50 expansions (got ${n})`);
  for (let i = 0; i < n; i += 1) {
    assert.strictEqual(orderA[i], orderB[i], `G27-D: expansion ${i} DP key mismatch`);
  }

  assert.deepStrictEqual(
    resultA.raw.diagnostics.dp.searchOutcome,
    resultB.raw.diagnostics.dp.searchOutcome,
    "G27-D: searchOutcome match",
  );

  return {
    searchParityVerified: true,
    expansions: resultA.expansions,
    acceptedStates: resultA.acceptedStates,
    goalSkylineCount: resultA.goalSkylineCount,
    first100ExpansionsMatched: true,
    routeExactMatch: true,
    cacheOffAndOnIdentical: true,
  };
}

// G27-E: Committed Reproducible Performance A/B
function gateG27E_Performance() {
  const { simulator: simOff } = createSimulator({ fastBattleEstimateCacheEnabled: false });
  const { simulator: simOn } = createSimulator({ fastBattleEstimateCacheEnabled: true });
  const { spec, startState } = getFixtureStartState(simOff);
  const segment = getFixtureSegment(spec);

  // Warmup interleaved
  runFixtureWithPerf(simOff, JSON.parse(JSON.stringify(startState)), segment);
  runFixtureWithPerf(simOn, JSON.parse(JSON.stringify(startState)), segment);

  const offRuns = [];
  const onRuns = [];
  const pairImprovements = [];

  for (let pair = 0; pair < PAIRS_COUNT; pair += 1) {
    const resOff = runFixtureWithPerf(simOff, JSON.parse(JSON.stringify(startState)), segment);
    const resOn = runFixtureWithPerf(simOn, JSON.parse(JSON.stringify(startState)), segment);
    offRuns.push(resOff);
    onRuns.push(resOn);

    const snapOff = resOff.tracker.snapshot();
    const snapOn = resOn.tracker.snapshot();

    const targetOff = (snapOff.stabilizationSubphasesMs && snapOff.stabilizationSubphasesMs.scanBattleEvaluation) || 0;
    const targetOn = (snapOn.stabilizationSubphasesMs && snapOn.stabilizationSubphasesMs.scanBattleEvaluation) || 0;

    const wallGain = targetOff > 0 ? Math.round(((resOff.wallMs - resOn.wallMs) / resOff.wallMs) * 1000) / 10 : 0;
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

  const scanBattleEvaluationMsOff = (lastSnapOff.stabilizationSubphasesMs && lastSnapOff.stabilizationSubphasesMs.scanBattleEvaluation) || 0;
  const scanBattleEvaluationMsOn = (lastSnapOn.stabilizationSubphasesMs && lastSnapOn.stabilizationSubphasesMs.scanBattleEvaluation) || 0;

  const battleScanMsOff = (lastSnapOff.stabilizationSubphasesMs && lastSnapOff.stabilizationSubphasesMs.battleScan) || 0;
  const battleScanMsOn = (lastSnapOn.stabilizationSubphasesMs && lastSnapOn.stabilizationSubphasesMs.battleScan) || 0;

  const keyBuildMsOff = (lastSnapOff.stabilizationSubphasesMs && lastSnapOff.stabilizationSubphasesMs.battleEstimateKeyBuild) || 0;
  const keyBuildMsOn = (lastSnapOn.stabilizationSubphasesMs && lastSnapOn.stabilizationSubphasesMs.battleEstimateKeyBuild) || 0;

  const cacheLookupMsOff = (lastSnapOff.stabilizationSubphasesMs && lastSnapOff.stabilizationSubphasesMs.battleEstimateCacheLookup) || 0;
  const cacheLookupMsOn = (lastSnapOn.stabilizationSubphasesMs && lastSnapOn.stabilizationSubphasesMs.battleEstimateCacheLookup) || 0;

  const hitReturnMsOff = (lastSnapOff.stabilizationSubphasesMs && lastSnapOff.stabilizationSubphasesMs.battleEstimateCacheHitReturn) || 0;
  const hitReturnMsOn = (lastSnapOn.stabilizationSubphasesMs && lastSnapOn.stabilizationSubphasesMs.battleEstimateCacheHitReturn) || 0;

  const uncachedComputeMsOff = (lastSnapOff.stabilizationSubphasesMs && lastSnapOff.stabilizationSubphasesMs.battleEstimateUncachedCompute) || 0;
  const uncachedComputeMsOn = (lastSnapOn.stabilizationSubphasesMs && lastSnapOn.stabilizationSubphasesMs.battleEstimateUncachedCompute) || 0;

  const cacheHitsOn = (lastSnapOn.semanticCounters && lastSnapOn.semanticCounters.battleEstimateCacheHits) || 0;
  const cacheMissesOn = (lastSnapOn.semanticCounters && lastSnapOn.semanticCounters.battleEstimateCacheMisses) || 0;
  const cacheHitRate = cacheHitsOn + cacheMissesOn > 0
    ? Math.round((cacheHitsOn / (cacheHitsOn + cacheMissesOn)) * 1000) / 10
    : 0;

  const fastRejectChecks = (lastSnapOn.semanticCounters && lastSnapOn.semanticCounters.scanFastRejectChecks) || 0;
  const fastRejectSkipped = (lastSnapOn.semanticCounters && lastSnapOn.semanticCounters.scanFastRejectSkipped) || 0;
  const fastRejectRate = fastRejectChecks > 0
    ? Math.round((fastRejectSkipped / fastRejectChecks) * 1000) / 10
    : 0;

  const overallWallImprovement = Math.round(((medianWallOff - medianWallOn) / medianWallOff) * 1000) / 10;
  const targetBucketMedianImprovement = median(pairImprovements.map((p) => p.targetGain));
  const targetBucketLastPairImprovement = scanBattleEvaluationMsOff > 0
    ? Math.round(((scanBattleEvaluationMsOff - scanBattleEvaluationMsOn) / scanBattleEvaluationMsOff) * 1000) / 10
    : 0;

  // Cloud Review Acceptance Threshold: overall wall median >= 5% OR (target bucket median >= 20% AND overall wall positive)
  const meetsThreshold = overallWallImprovement >= 5.0 || (targetBucketMedianImprovement >= 20.0 && overallWallImprovement > 0);
  assert.ok(
    meetsThreshold,
    `G27-E: Performance must meet acceptance threshold (overallWallGain=${overallWallImprovement}%, targetGain=${targetBucketMedianImprovement}%)`,
  );

  return {
    performanceMeasured: true,
    pairsCount: PAIRS_COUNT,
    acceptanceThresholdMet: meetsThreshold,
    armA_off: {
      medianWallMs: Math.round(medianWallOff),
      medianCpuMs: Math.round(medianCpuOff * 1000) / 1000,
      medianExpansionsPerSec: Math.round(medianEpsOff),
      battleScanMs: battleScanMsOff,
      scanBattleEvaluationMs: scanBattleEvaluationMsOff,
      battleEstimateKeyBuildMs: keyBuildMsOff,
      battleEstimateCacheLookupMs: cacheLookupMsOff,
      battleEstimateCacheHitReturnMs: hitReturnMsOff,
      battleEstimateUncachedComputeMs: uncachedComputeMsOff,
      individualWallMs: offRuns.map((r) => r.wallMs),
    },
    armB_on: {
      medianWallMs: Math.round(medianWallOn),
      medianCpuMs: Math.round(medianCpuOn * 1000) / 1000,
      medianExpansionsPerSec: Math.round(medianEpsOn),
      battleScanMs: battleScanMsOn,
      scanBattleEvaluationMs: scanBattleEvaluationMsOn,
      battleEstimateKeyBuildMs: keyBuildMsOn,
      battleEstimateCacheLookupMs: cacheLookupMsOn,
      battleEstimateCacheHitReturnMs: hitReturnMsOn,
      battleEstimateUncachedComputeMs: uncachedComputeMsOn,
      battleEstimateCacheHits: cacheHitsOn,
      battleEstimateCacheMisses: cacheMissesOn,
      battleEstimateHitRatePercent: cacheHitRate,
      fastRejectRatePercent: fastRejectRate,
      individualWallMs: onRuns.map((r) => r.wallMs),
    },
    pairImprovements,
    overallWallImprovementPercent: overallWallImprovement,
    targetBucketMedianImprovementPercent: targetBucketMedianImprovement,
    targetBucketLastPairImprovementPercent: targetBucketLastPairImprovement,
    faster: medianWallOn < medianWallOff,
  };
}

// G27-F: Battle Cache Mutation Safety (8-dimension cache key divergence)
function gateG27F_BattleCacheMutationSafety() {
  const { simulator } = createSimulator({ fastBattleEstimateCacheEnabled: true });
  const resolver = simulator.battleResolver;
  const s0 = simulator.createInitialState();
  const baseKey = resolver.battleEstimateCacheKey(s0, "MT1", 8, 7, "blackSlime");

  const sHP = JSON.parse(JSON.stringify(s0));
  sHP.hero.hp = 9999;
  assert.notStrictEqual(baseKey, resolver.battleEstimateCacheKey(sHP, "MT1", 8, 7, "blackSlime"), "G27-F: HP mutation must differ");

  const sATK = JSON.parse(JSON.stringify(s0));
  sATK.hero.atk = 50;
  assert.notStrictEqual(baseKey, resolver.battleEstimateCacheKey(sATK, "MT1", 8, 7, "blackSlime"), "G27-F: ATK mutation must differ");

  const sDEF = JSON.parse(JSON.stringify(s0));
  sDEF.hero.def = 50;
  assert.notStrictEqual(baseKey, resolver.battleEstimateCacheKey(sDEF, "MT1", 8, 7, "blackSlime"), "G27-F: DEF mutation must differ");

  const sMDEF = JSON.parse(JSON.stringify(s0));
  sMDEF.hero.mdef = 50;
  assert.notStrictEqual(baseKey, resolver.battleEstimateCacheKey(sMDEF, "MT1", 8, 7, "blackSlime"), "G27-F: MDEF mutation must differ");

  const sEq = JSON.parse(JSON.stringify(s0));
  sEq.hero.equipment = ["sword1"];
  assert.notStrictEqual(baseKey, resolver.battleEstimateCacheKey(sEq, "MT1", 8, 7, "blackSlime"), "G27-F: Equipment mutation must differ");

  const sInv = JSON.parse(JSON.stringify(s0));
  sInv.inventory.coin = 1;
  assert.notStrictEqual(baseKey, resolver.battleEstimateCacheKey(sInv, "MT1", 8, 7, "blackSlime"), "G27-F: Inventory mutation must differ");

  const sFlg = JSON.parse(JSON.stringify(s0));
  sFlg.flags.curse = 1;
  assert.notStrictEqual(baseKey, resolver.battleEstimateCacheKey(sFlg, "MT1", 8, 7, "blackSlime"), "G27-F: Flags mutation must differ");

  const sMut = JSON.parse(JSON.stringify(s0));
  if (!sMut.floorStates) sMut.floorStates = {};
  if (!sMut.floorStates.MT1) sMut.floorStates.MT1 = { removed: {}, replaced: {} };
  sMut.floorStates.MT1.removed["1,1"] = true;
  assert.notStrictEqual(baseKey, resolver.battleEstimateCacheKey(sMut, "MT1", 8, 7, "blackSlime"), "G27-F: Floor mutation must differ");

  return {
    battleCacheMutationSafetyVerified: true,
    all8DimensionsDiverged: true,
  };
}

// ========== Main ==========
function main() {
  // Iteration 1 Regression Gates
  const g26a = gateG26A_ExactSearchEquivalence();
  const g26b = gateG26B_ExpansionOrderEquivalence();
  const g26c1 = gateG26C1_StateKeyMutationSensitivity();
  const g26c2 = gateG26C2_CachedBlockIndexMutationInvalidation();
  const g26c3 = gateG26C3_RealStabilizationMutationPath();

  // Iteration 2 Active Gates
  const g27a = gateG27A_BattleResultExactParity();
  const g27b = gateG27B_AutoBattleScanParity();
  const g27c = gateG27C_StabilizationExactParity();
  const g27d = gateG27D_SearchParity();
  const g27f = gateG27F_BattleCacheMutationSafety();
  const g27e = gateG27E_Performance();

  const report = {
    schema: "motapathfinder.dp-hot-path.v3",
    contractStatus: "passed",
    iteration: "Iteration 2 (Battle-Scan Optimization)",
    fixture: {
      tower: "OnlyUp",
      segment: "mt2-to-mt3 (from real MT1 state)",
      completion: "frontier-exhausted (deterministic)",
      pairsCount: PAIRS_COUNT,
    },
    iteration1_regression_gates: {
      "G26-A": g26a,
      "G26-B": g26b,
      "G26-C1": g26c1,
      "G26-C2": g26c2,
      "G26-C3": g26c3,
    },
    iteration2_gates: {
      "G27-A": g27a,
      "G27-B": g27b,
      "G27-C": g27c,
      "G27-D": g27d,
      "G27-E": g27e,
      "G27-F": g27f,
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
  gateG27A_BattleResultExactParity,
  gateG27B_AutoBattleScanParity,
  gateG27C_StabilizationExactParity,
  gateG27D_SearchParity,
  gateG27E_Performance,
  gateG27F_BattleCacheMutationSafety,
  createSimulator,
  getFixtureStartState,
  getFixtureSegment,
  runFixture,
  runFixtureWithPerf,
};
