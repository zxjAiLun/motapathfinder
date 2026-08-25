"use strict";

/** TEST GRADE: local-regression */

/**
 * PR-5.22g Movement Hazard Fast Path & Block Materialization Qualification Contract.
 *
 * Verifies:
 * 1. Synthetic Hazard-Family Coverage Matrix comparing OFF (legacy cell-by-cell) vs ON (fast materialized traversal):
 *    - Case 1a: lavaNet without amulet (applies lavaDamage)
 *    - Case 1b: lavaNet with amulet (amulet immunity)
 *    - Case 2: Special 15 zone (diamond shape vs zoneSquare)
 *    - Case 3: Special 18 repulse (backward knockback & block check)
 *    - Case 4: Special 24 laser (row & column beam)
 *    - Case 5: Special 27 ambush (directional surprise attack)
 *    - Case 6: Special 16 betweenAttack (flanked by identical enemies)
 *    - Case 7: betweenAttackMax=true with authoritative evaluateBattle
 *    - Case 8: no_zone, no_repulse, no_laser, no_ambush, no_betweenAttack flags
 *    - Case 9: Floor mutations: removed tiles
 *    - Case 10: Floor mutations: replaced tiles
 *    - Case 11: Unknown tile handling
 *    - Case 12: Sequential state mutations across multi-step build/rebuild cycles
 * 2. 100% exact deterministic search parity between OFF and ON on frozen 100-expansion search.
 * 3. Path polarity verification (OFF: fastCalls === 0, legacyCalls > 0; ON: fastCalls > 0, legacyCalls === 0).
 * 4. MT1 Real Route Gate in production ON mode: 10/10 decisions matched, 0 replay mismatches.
 * 5. Paired A/B benchmark (5 alternating pairs) on 400-expansion workload with strict qualification assertion.
 */

const path = require("node:path");
const assert = require("node:assert");
const { loadProject } = require("./lib/project-loader");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { StaticSimulator } = require("./lib/simulator");
const { searchDP } = require("./lib/dp-search");
const { createNoStateChangeChoiceResolver, runOnlyUpMt1RealRouteGate } = require("./lib/onlyup-mt1-real-route-gate");
const { buildMovementHazards } = require("./lib/movement-hazards");
const { buildStateKey } = require("./lib/state-key");
const { createPerfTracker, setActivePerfTracker } = require("./lib/perf");
const { removeTileAt, replaceTileAt } = require("./lib/state");

const PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");

function createSyntheticHazardFixture(baseProject) {
  const project = {
    ...baseProject,
    values: {
      ...baseProject.values,
      lavaDamage: 50,
    },
    defaultFlags: {
      ...baseProject.defaultFlags,
      betweenAttackMax: true,
    },
    enemysById: {
      ...baseProject.enemysById,
      E_zone_diamond: { id: "E_zone_diamond", special: 15, value: 30, range: 2, zoneSquare: false },
      E_zone_square: { id: "E_zone_square", special: 15, value: 40, range: 1, zoneSquare: true },
      E_repulse: { id: "E_repulse", special: 18, zuji: 25, zoneSquare: false },
      E_laser: { id: "E_laser", special: 24, value: 60 },
      E_ambush: { id: "E_ambush", special: 27, zoneSquare: false },
      E_between: { id: "E_between", special: 16 },
    },
    mapTilesByNumber: {
      ...baseProject.mapTilesByNumber,
      "900": { number: 900, id: "lavaNet", cls: "constants", name: "lavaNet" },
      "901": { number: 901, id: "E_zone_diamond", cls: "enemys" },
      "902": { number: 902, id: "E_zone_square", cls: "enemys" },
      "903": { number: 903, id: "E_repulse", cls: "enemys" },
      "904": { number: 904, id: "E_laser", cls: "enemys" },
      "905": { number: 905, id: "E_ambush", cls: "enemys" },
      "906": { number: 906, id: "E_between", cls: "enemys" },
      "907": { number: 907, id: "yellowDoor", cls: "doors", trigger: "openDoor" },
      "908": { number: 908, id: "yellowKey", cls: "items" },
    },
    floorsById: {
      ...baseProject.floorsById,
      SYNTH_HAZARD: {
        width: 7,
        height: 7,
        ratio: 1,
        map: [
          [0,   900, 0,   901, 0,   902, 0],
          [0,   0,   0,   0,   0,   0,   0],
          [0,   903, 0,   904, 0,   905, 0],
          [0,   0,   0,   0,   0,   0,   0],
          [906, 0,   906, 0,   907, 0,   908],
          [0,   0,   0,   0,   0,   0,   0],
          [0,   0,   0,   999, 0,   0,   0], // 999 is unknown tile
        ],
      },
    },
  };
  return project;
}

function runFrozen100Search(project, enableFast) {
  const choiceResolver = createNoStateChangeChoiceResolver();
  const sim = new StaticSimulator(project, {
    stopFloorId: "MT6",
    battleResolver: new FunctionBackedBattleResolver(project, { enableFastReject: true }),
    autoBattleFastRejectEnabled: true,
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFastHazardBlockIndex: enableFast,
    choiceResolver,
  });

  const tracker = createPerfTracker({ enabled: true, profileExpansionCost: true });
  setActivePerfTracker(tracker);
  const startedAt = process.hrtime.bigint();
  let result;
  try {
    result = searchDP(sim, sim.createInitialState(), {
      maxExpansions: 100,
      stopFloorId: "MT6",
      targetFloorId: "MT6",
    });
  } finally {
    setActivePerfTracker(null);
  }
  const wallMs = Number((process.hrtime.bigint() - startedAt) / 1000000n);
  const snapshot = tracker.snapshot({
    expanded: result.expansions,
    generated: result.diagnostics.generated,
    registered: result.diagnostics.registered,
    duplicates: result.diagnostics.skipped["dp-lower-hp-same-state"] + result.diagnostics.skipped["dp-same-hp-not-shorter"],
    frontierSize: result.frontierSize,
    simulatorCacheStats: sim.getActionExpansionCacheStats(),
  });

  return { result, sim, wallMs, snapshot };
}

function runFixedWorkloadBenchmark(project, enableFast, maxExpansions = 400) {
  const choiceResolver = createNoStateChangeChoiceResolver();
  const sim = new StaticSimulator(project, {
    stopFloorId: "MT6",
    battleResolver: new FunctionBackedBattleResolver(project, { enableFastReject: true }),
    autoBattleFastRejectEnabled: true,
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFastHazardBlockIndex: enableFast,
    choiceResolver,
  });

  const tracker = createPerfTracker({ enabled: true, profileExpansionCost: true });
  setActivePerfTracker(tracker);
  const startedAt = process.hrtime.bigint();
  let result;
  try {
    result = searchDP(sim, sim.createInitialState(), {
      maxExpansions,
      stopFloorId: "MT6",
      targetFloorId: "MT6",
    });
  } finally {
    setActivePerfTracker(null);
  }
  const wallMs = Number((process.hrtime.bigint() - startedAt) / 1000000n);
  const snapshot = tracker.snapshot({
    expanded: result.expansions,
    generated: result.diagnostics.generated,
    registered: result.diagnostics.registered,
    duplicates: result.diagnostics.skipped["dp-lower-hp-same-state"] + result.diagnostics.skipped["dp-same-hp-not-shorter"],
    frontierSize: result.frontierSize,
    simulatorCacheStats: sim.getActionExpansionCacheStats(),
  });

  const sub = snapshot.expansionCost.timingDirectional.inclusiveSubsystems.stabilizeState;
  const cnt = sub.counters;

  return {
    wallMs,
    expansions: result.expansions,
    generated: result.diagnostics.generated,
    registered: result.diagnostics.registered,
    frontierSize: result.frontierSize,
    stoppedReason: result.stoppedReason,
    bestProgressStateKey: buildStateKey(result.bestProgressState),
    bestProgressMeta: JSON.stringify(result.bestProgressState && result.bestProgressState.meta),
    msPerExpansion: result.expansions > 0 ? wallMs / result.expansions : 0,
    hazardBuildMs: sub.subphases.hazardBuildMs,
    hazardBlockIndexMs: sub.subphases.hazardBlockIndexMs,
    hazardSpecialScanMs: sub.subphases.hazardSpecialScanMs,
    hazardBuildCalls: cnt.hazardBuildCalls,
    hazardBlockIndexCalls: cnt.hazardBlockIndexCalls,
    hazardBlockIndexFastCalls: cnt.hazardBlockIndexFastCalls,
    hazardBlockIndexLegacyCalls: cnt.hazardBlockIndexLegacyCalls,
    hazardCellsScanned: cnt.hazardCellsScanned,
    hazardBlocksMaterialized: cnt.hazardBlocksMaterialized,
    stabilizationMs: sub.totalMs,
  };
}

function main() {
  const baseProject = loadProject(PROJECT_ROOT);
  const synthProject = createSyntheticHazardFixture(baseProject);

  const mockBattleResolver = {
    evaluateBattle: (state, floorId, x, y, enemyId) => ({
      supported: true,
      damageInfo: { damage: 15 },
    }),
  };

  // -------------------------------------------------------------------------
  // 1. Synthetic Hazard-Family Coverage Matrix (Cases 1-11)
  // -------------------------------------------------------------------------
  const sim = new StaticSimulator(synthProject);

  const makeBaseState = () => {
    const s = sim.createInitialState();
    s.floorId = "SYNTH_HAZARD";
    s.hero.hp = 1000;
    return s;
  };

  const testCases = [
    { name: "Case 1a: LavaNet without amulet", stateMutator: (s) => {} },
    { name: "Case 1b: LavaNet with amulet", stateMutator: (s) => { s.inventory.amulet = 1; } },
    { name: "Case 2: Special 15 Zone (diamond vs square)", stateMutator: (s) => {} },
    { name: "Case 3: Special 18 Repulse", stateMutator: (s) => {} },
    { name: "Case 4: Special 24 Laser", stateMutator: (s) => {} },
    { name: "Case 5: Special 27 Ambush", stateMutator: (s) => {} },
    { name: "Case 6: Special 16 BetweenAttack", stateMutator: (s) => {} },
    { name: "Case 7: BetweenAttackMax with evaluateBattle", stateMutator: (s) => {}, resolver: mockBattleResolver },
    {
      name: "Case 8: All no_* immunity flags active",
      stateMutator: (s) => {
        s.flags.no_zone = 1;
        s.flags.no_repulse = 1;
        s.flags.no_laser = 1;
        s.flags.no_ambush = 1;
        s.flags.no_betweenAttack = 1;
      },
    },
    {
      name: "Case 9: Floor mutations - removed tiles",
      stateMutator: (s) => {
        removeTileAt(s, "SYNTH_HAZARD", 1, 0); // remove lavaNet
        removeTileAt(s, "SYNTH_HAZARD", 3, 0); // remove E_zone_diamond
      },
    },
    {
      name: "Case 10: Floor mutations - replaced tiles",
      stateMutator: (s) => {
        replaceTileAt(s, "SYNTH_HAZARD", 0, 0, 904); // place laser at 0,0
      },
    },
    { name: "Case 11: Unknown tile handling (tile 999 at 3,6)", stateMutator: (s) => {} },
  ];

  for (const tc of testCases) {
    const stateOFF = makeBaseState();
    tc.stateMutator(stateOFF);
    const hazardsOFF = buildMovementHazards(synthProject, stateOFF, {
      floorId: "SYNTH_HAZARD",
      battleResolver: tc.resolver || null,
      enableFastHazardBlockIndex: false,
    });

    const stateON = makeBaseState();
    tc.stateMutator(stateON);
    const hazardsON = buildMovementHazards(synthProject, stateON, {
      floorId: "SYNTH_HAZARD",
      battleResolver: tc.resolver || null,
      enableFastHazardBlockIndex: true,
    });

    assert.deepStrictEqual(hazardsON.damage, hazardsOFF.damage, `${tc.name}: damage mismatch`);
    assert.deepStrictEqual(hazardsON.type, hazardsOFF.type, `${tc.name}: type mismatch`);
    assert.deepStrictEqual(hazardsON.repulse, hazardsOFF.repulse, `${tc.name}: repulse mismatch`);
    assert.deepStrictEqual(hazardsON.ambush, hazardsOFF.ambush, `${tc.name}: ambush mismatch`);
    assert.deepStrictEqual(hazardsON.betweenAttackLocs, hazardsOFF.betweenAttackLocs, `${tc.name}: betweenAttackLocs mismatch`);
  }

  // Case 12: Sequential multi-step mutation & hazard rebuild cycle
  {
    const stateOFF = makeBaseState();
    const stateON = makeBaseState();

    // Step 1: Initial hazard build
    let hOFF = buildMovementHazards(synthProject, stateOFF, { floorId: "SYNTH_HAZARD", enableFastHazardBlockIndex: false });
    let hON = buildMovementHazards(synthProject, stateON, { floorId: "SYNTH_HAZARD", enableFastHazardBlockIndex: true });
    assert.deepStrictEqual(hON.damage, hOFF.damage, "Case 12 Step 1 damage mismatch");
    assert.deepStrictEqual(hON.type, hOFF.type, "Case 12 Step 1 type mismatch");

    // Mutation 1: remove lavaNet and between attack enemy
    removeTileAt(stateOFF, "SYNTH_HAZARD", 1, 0);
    removeTileAt(stateOFF, "SYNTH_HAZARD", 0, 4);
    removeTileAt(stateON, "SYNTH_HAZARD", 1, 0);
    removeTileAt(stateON, "SYNTH_HAZARD", 0, 4);

    // Step 2: Rebuild after mutation 1
    hOFF = buildMovementHazards(synthProject, stateOFF, { floorId: "SYNTH_HAZARD", enableFastHazardBlockIndex: false });
    hON = buildMovementHazards(synthProject, stateON, { floorId: "SYNTH_HAZARD", enableFastHazardBlockIndex: true });
    assert.deepStrictEqual(hON.damage, hOFF.damage, "Case 12 Step 2 damage mismatch");
    assert.deepStrictEqual(hON.betweenAttackLocs, hOFF.betweenAttackLocs, "Case 12 Step 2 betweenAttackLocs mismatch");

    // Mutation 2: replace tile with laser
    replaceTileAt(stateOFF, "SYNTH_HAZARD", 3, 3, 904);
    replaceTileAt(stateON, "SYNTH_HAZARD", 3, 3, 904);

    // Step 3: Rebuild after mutation 2
    hOFF = buildMovementHazards(synthProject, stateOFF, { floorId: "SYNTH_HAZARD", enableFastHazardBlockIndex: false });
    hON = buildMovementHazards(synthProject, stateON, { floorId: "SYNTH_HAZARD", enableFastHazardBlockIndex: true });
    assert.deepStrictEqual(hON.damage, hOFF.damage, "Case 12 Step 3 damage mismatch");
    assert.deepStrictEqual(hON.type, hOFF.type, "Case 12 Step 3 type mismatch");
  }

  // -------------------------------------------------------------------------
  // 2. Frozen 100-expansion Deterministic Parity & Path Polarity Verification
  // -------------------------------------------------------------------------
  const runOFF = runFrozen100Search(baseProject, false);
  const runON = runFrozen100Search(baseProject, true);

  const resOFF = runOFF.result;
  const resON = runON.result;

  assert.strictEqual(resON.expansions, 100, "ON expansions must equal 100");
  assert.strictEqual(resON.expansions, resOFF.expansions, "Expansions parity mismatch");
  assert.strictEqual(resON.diagnostics.generated, resOFF.diagnostics.generated, "Generated count parity mismatch");
  assert.strictEqual(resON.diagnostics.registered, resOFF.diagnostics.registered, "Registered count parity mismatch");
  assert.strictEqual(resON.frontierSize, resOFF.frontierSize, "Frontier size parity mismatch");
  assert.strictEqual(resON.stoppedReason, resOFF.stoppedReason, "Stopped reason parity mismatch");

  const bestKeyOFF = buildStateKey(resOFF.bestProgressState);
  const bestKeyON = buildStateKey(resON.bestProgressState);
  assert.strictEqual(bestKeyON, bestKeyOFF, "Best progress stateKey parity mismatch");

  const metaOFF = JSON.stringify(resOFF.bestProgressState && resOFF.bestProgressState.meta);
  const metaON = JSON.stringify(resON.bestProgressState && resON.bestProgressState.meta);
  assert.strictEqual(metaON, metaOFF, "Best progress meta parity mismatch");

  // Path polarity verification on frozen 100 search
  const cntOFF = runOFF.snapshot.expansionCost.timingDirectional.inclusiveSubsystems.stabilizeState.counters;
  const cntON = runON.snapshot.expansionCost.timingDirectional.inclusiveSubsystems.stabilizeState.counters;

  assert.strictEqual(cntOFF.hazardBlockIndexFastCalls, 0, "OFF mode must execute 0 fast hazard block index calls");
  assert.ok(cntOFF.hazardBlockIndexLegacyCalls > 0, "OFF mode must execute >0 legacy hazard block index calls");
  assert.strictEqual(cntON.hazardBlockIndexLegacyCalls, 0, "ON mode must execute 0 legacy hazard block index calls");
  assert.ok(cntON.hazardBlockIndexFastCalls > 0, "ON mode must execute >0 fast hazard block index calls");

  // -------------------------------------------------------------------------
  // 3. MT1 Real Route Gate in Production ON Mode
  // -------------------------------------------------------------------------
  const gateResult = runOnlyUpMt1RealRouteGate({ autoBattleFastRejectEnabled: true, enableFastHazardBlockIndex: true });
  assert.strictEqual(gateResult.verdict, "REAL_MT1_GATE_PASSED", "MT1 gate verdict mismatch");
  assert.strictEqual(gateResult.failureReason, null, "MT1 gate failureReason must be null");
  assert.deepStrictEqual(gateResult.mismatches, [], "MT1 gate strict replay reported mismatches");
  assert.strictEqual(gateResult.metrics.fingerprintMatchedDecisionCount, 10, "MT1 gate must match 10/10 decisions");

  // -------------------------------------------------------------------------
  // 4. Paired A/B Benchmark (5 Alternating Pairs, 400 Expansions)
  // -------------------------------------------------------------------------
  // JIT Warmup (2 rounds of alternating warmup to stabilize V8 baseline & turbo optimization)
  runFixedWorkloadBenchmark(baseProject, false, 200);
  runFixedWorkloadBenchmark(baseProject, true, 200);
  runFixedWorkloadBenchmark(baseProject, false, 200);
  runFixedWorkloadBenchmark(baseProject, true, 200);

  const pairs = [];
  const PAIR_COUNT = 5;
  const WORKLOAD_EXPANSIONS = 400;

  for (let i = 1; i <= PAIR_COUNT; i++) {
    let offMetrics;
    let onMetrics;
    if (i % 2 === 1) {
      offMetrics = runFixedWorkloadBenchmark(baseProject, false, WORKLOAD_EXPANSIONS);
      onMetrics = runFixedWorkloadBenchmark(baseProject, true, WORKLOAD_EXPANSIONS);
    } else {
      onMetrics = runFixedWorkloadBenchmark(baseProject, true, WORKLOAD_EXPANSIONS);
      offMetrics = runFixedWorkloadBenchmark(baseProject, false, WORKLOAD_EXPANSIONS);
    }

    // Exact parity per pair
    assert.strictEqual(onMetrics.expansions, offMetrics.expansions, `Pair ${i}: expansions mismatch`);
    assert.strictEqual(onMetrics.generated, offMetrics.generated, `Pair ${i}: generated count mismatch`);
    assert.strictEqual(onMetrics.registered, offMetrics.registered, `Pair ${i}: registered count mismatch`);
    assert.strictEqual(onMetrics.frontierSize, offMetrics.frontierSize, `Pair ${i}: frontier size mismatch`);
    assert.strictEqual(onMetrics.stoppedReason, offMetrics.stoppedReason, `Pair ${i}: stopped reason mismatch`);
    assert.strictEqual(onMetrics.bestProgressStateKey, offMetrics.bestProgressStateKey, `Pair ${i}: best progress stateKey mismatch`);
    assert.strictEqual(onMetrics.bestProgressMeta, offMetrics.bestProgressMeta, `Pair ${i}: best progress meta mismatch`);

    // Path polarity verification per pair
    assert.strictEqual(offMetrics.hazardBlockIndexFastCalls, 0, `Pair ${i}: OFF mode must have 0 fast calls`);
    assert.ok(offMetrics.hazardBlockIndexLegacyCalls > 0, `Pair ${i}: OFF mode must have >0 legacy calls`);
    assert.strictEqual(onMetrics.hazardBlockIndexLegacyCalls, 0, `Pair ${i}: ON mode must have 0 legacy calls`);
    assert.ok(onMetrics.hazardBlockIndexFastCalls > 0, `Pair ${i}: ON mode must have >0 fast calls`);

    const msPerExpDelta = offMetrics.msPerExpansion - onMetrics.msPerExpansion;
    const msPerExpRatio = offMetrics.msPerExpansion > 0 ? msPerExpDelta / offMetrics.msPerExpansion : 0;
    const wallRatio = offMetrics.wallMs > 0 ? (offMetrics.wallMs - onMetrics.wallMs) / offMetrics.wallMs : 0;

    pairs.push({
      pair: i,
      order: i % 2 === 1 ? "OFF->ON" : "ON->OFF",
      off: offMetrics,
      on: onMetrics,
      speedupMsPerExpansion: msPerExpDelta,
      improvementRatio: msPerExpRatio,
      wallImprovementRatio: wallRatio,
    });
  }

  const sortedRatios = pairs.map((p) => p.improvementRatio).sort((a, b) => a - b);
  const medianImprovementRatio = sortedRatios[Math.floor(sortedRatios.length / 2)];
  const positivePairs = pairs.filter((p) => p.improvementRatio > 0).length;
  const isPromoted = medianImprovementRatio >= 0.03 && positivePairs >= 4;

  const summary = {
    schema: "motapathfinder.movement-hazard-fast-path-contract.v1",
    status: "passed",
    verdict: isPromoted ? "HAZARD_BUILD_FAST_PATH_PROMOTED" : "HAZARD_BUILD_FAST_PATH_NOT_PROMOTED",
    adversarialParity: {
      casesChecked: testCases.length + 1, // 11 matrix cases + 1 sequential rebuild case
      exactParityVerified: true,
    },
    frozen100Parity: {
      expansions: resON.expansions,
      generated: resON.diagnostics.generated,
      registered: resON.diagnostics.registered,
      frontierSize: resON.frontierSize,
      stoppedReason: resON.stoppedReason,
      exactBestProgressKeyMatched: true,
      exactMetaMatched: true,
      pathPolarityVerified: {
        offFastCalls: cntOFF.hazardBlockIndexFastCalls,
        offLegacyCalls: cntOFF.hazardBlockIndexLegacyCalls,
        onFastCalls: cntON.hazardBlockIndexFastCalls,
        onLegacyCalls: cntON.hazardBlockIndexLegacyCalls,
      },
      hazardBuildMsBefore: runOFF.snapshot.expansionCost.timingDirectional.inclusiveSubsystems.stabilizeState.subphases.hazardBuildMs,
      hazardBuildMsAfter: runON.snapshot.expansionCost.timingDirectional.inclusiveSubsystems.stabilizeState.subphases.hazardBuildMs,
    },
    mt1GateVerified: {
      verdict: gateResult.verdict,
      decisionsReplayed: gateResult.recordedDecisionCount,
      strictReplayClean: gateResult.mismatches.length === 0,
    },
    pairedBenchmark: {
      pairCount: PAIR_COUNT,
      workloadExpansions: WORKLOAD_EXPANSIONS,
      positivePairs,
      medianImprovementRatio: Number(medianImprovementRatio.toFixed(4)),
      pairs,
    },
    promotionDecision: {
      criteriaMet: isPromoted,
      verdict: isPromoted ? "PROMOTE" : "REJECT",
      reason: `median=${(medianImprovementRatio * 100).toFixed(2)}%, positive=${positivePairs}/${PAIR_COUNT}`,
    },
  };

  console.log(JSON.stringify(summary, null, 2));

  assert.ok(
    isPromoted,
    `Hazard fast path failed qualification: median=${(medianImprovementRatio * 100).toFixed(2)}%, positive=${positivePairs}/${PAIR_COUNT}`
  );
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
};
