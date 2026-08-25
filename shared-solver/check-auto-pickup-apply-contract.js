"use strict";

/** TEST GRADE: local-regression */

/**
 * PR-5.22f Auto-Pickup Apply Cost Decomposition & Precompiled VM Script Fast Path Contract.
 *
 * Verifies:
 * 1. Adversarial parity matrix between native VM sandbox (OFF) and precompiled function cache (ON):
 *    - HP/ATK/DEF/MDEF attribute items & map ratio calculations
 *    - Percentage & multiplication modifiers
 *    - Key & inventory additions (core.addItem)
 *    - Flag operations (getFlag, setFlag, addFlag)
 *    - Equipment queries (hasEquip, getEquip)
 *    - Sequential cross-state execution (zero state leakage / crosstalk)
 *    - AfterGetItem event triggers
 *    - EXP pickups triggering runLevelUps
 *    - Fallback on dynamic / invalid syntax
 * 2. 100% exact deterministic search parity between OFF and ON on frozen 100-expansion search.
 * 3. MT1 Real Route Gate in ON mode: 10/10 decisions fingerprint-matched with 0 replay mismatches.
 * 4. Paired A/B benchmark (5 alternating pairs) on 400 expansions workload verifying significant speedup.
 */

const path = require("node:path");
const assert = require("node:assert");
const vm = require("node:vm");
const { loadProject } = require("./lib/project-loader");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { StaticSimulator } = require("./lib/simulator");
const { searchDP } = require("./lib/dp-search");
const { createNoStateChangeChoiceResolver, runOnlyUpMt1RealRouteGate } = require("./lib/onlyup-mt1-real-route-gate");
const { buildEffectCore, executeItemEffect, applyPickup, clearCompiledScriptCache } = require("./lib/effect-vm");
const { buildStateKey } = require("./lib/state-key");
const { createPerfTracker, setActivePerfTracker } = require("./lib/perf");

const PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");

function makeTestState(custom = {}) {
  return {
    floorId: "MT1",
    hero: {
      hp: 1000,
      atk: 10,
      def: 10,
      mdef: 10,
      money: 100,
      exp: 0,
      lv: 1,
      equipment: ["I600", "I601"],
      ...(custom.hero || {}),
    },
    inventory: {
      yellowKey: 1,
      blueKey: 0,
      redKey: 0,
      ...(custom.inventory || {}),
    },
    flags: {
      questStage: 2,
      counter: 10,
      ...(custom.flags || {}),
    },
    notes: [],
    ...(custom.state || {}),
  };
}

function runFrozen100Search(project, enableCompiled) {
  const choiceResolver = createNoStateChangeChoiceResolver();
  const sim = new StaticSimulator(project, {
    stopFloorId: "MT6",
    battleResolver: new FunctionBackedBattleResolver(project, { enableFastReject: true }),
    autoBattleFastRejectEnabled: true,
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableCompiledEffectCache: enableCompiled,
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

function runFixedWorkloadBenchmark(project, enableCompiled, maxExpansions = 400) {
  const choiceResolver = createNoStateChangeChoiceResolver();
  const sim = new StaticSimulator(project, {
    stopFloorId: "MT6",
    battleResolver: new FunctionBackedBattleResolver(project, { enableFastReject: true }),
    autoBattleFastRejectEnabled: true,
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableCompiledEffectCache: enableCompiled,
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
    pickupApplyMs: sub.subphases.pickupApplyMs,
    pickupItemEffectMs: sub.subphases.pickupItemEffectMs,
    pickupTileLookupMs: sub.subphases.pickupTileLookupMs,
    pickupTileRemoveMs: sub.subphases.pickupTileRemoveMs,
    pickupLevelUpMs: sub.subphases.pickupLevelUpMs,
    pickupApplyCalls: cnt.pickupApplyCalls,
    pickupItemEffectCalls: cnt.pickupItemEffectCalls,
    stabilizationMs: sub.totalMs,
  };
}

function main() {
  const project = loadProject(PROJECT_ROOT);

  // -------------------------------------------------------------------------
  // 1. Adversarial Parity Matrix
  // -------------------------------------------------------------------------
  clearCompiledScriptCache();
  const adversarialCases = [
    {
      name: "HP / ATK / DEF / MDEF Gem & Potion arithmetic with map ratio",
      code: "core.status.hero.atk += core.values.redGem * core.status.thisMap.ratio; core.status.hero.def += core.values.blueGem * core.status.thisMap.ratio; core.status.hero.hp += core.values.yellowPotion * core.status.thisMap.ratio;",
    },
    {
      name: "Percentage multipliers",
      code: "core.status.hero.atk *= 1.05; core.status.hero.def *= 1.10; core.status.hero.hp *= 1.5;",
    },
    {
      name: "Inventory and addItem calls",
      code: "core.addItem('yellowKey', 3); core.addItem('blueKey', 2); core.addItem('customItem', 1);",
    },
    {
      name: "Flag reads, writes, and addFlag",
      code: "core.setFlag('newFlag', 42); core.addFlag('counter', 5); if (core.getFlag('questStage') === 2) core.setFlag('questPassed', true);",
    },
    {
      name: "Equipment queries (hasEquip / getEquip)",
      code: "if (core.hasEquip('I600')) { core.status.hero.atk += 50; } if (core.getEquip(1) === 'I601') { core.status.hero.def += 30; }",
    },
  ];

  for (const tc of adversarialCases) {
    const item = { id: "test_item", cls: "items", itemEffect: tc.code };

    const stateVM = makeTestState();
    executeItemEffect(project, stateVM, item, { enableCompiledEffectCache: false });

    const stateCompiled = makeTestState();
    executeItemEffect(project, stateCompiled, item, { enableCompiledEffectCache: true });

    assert.deepStrictEqual(stateCompiled, stateVM, `Adversarial parity mismatch on case: ${tc.name}`);
  }

  // Cross-State Sequential Execution & Zero State Crosstalk Test
  const stateA1 = makeTestState({ hero: { hp: 100, atk: 5 } });
  const stateB1 = makeTestState({ hero: { hp: 5000, atk: 200 }, flags: { secret: 99 } });
  const stateA2 = makeTestState({ hero: { hp: 100, atk: 5 } });
  const stateB2 = makeTestState({ hero: { hp: 5000, atk: 200 }, flags: { secret: 99 } });

  const dynamicItem = { id: "shared_effect", cls: "items", itemEffect: "core.status.hero.hp += 50; core.addFlag('counter', core.status.hero.atk);" };

  // Sequential execution in compiled mode
  executeItemEffect(project, stateA1, dynamicItem, { enableCompiledEffectCache: true });
  executeItemEffect(project, stateB1, dynamicItem, { enableCompiledEffectCache: true });

  // Sequential execution in VM mode
  executeItemEffect(project, stateA2, dynamicItem, { enableCompiledEffectCache: false });
  executeItemEffect(project, stateB2, dynamicItem, { enableCompiledEffectCache: false });

  assert.deepStrictEqual(stateA1, stateA2, "State A crosstalk parity mismatch");
  assert.deepStrictEqual(stateB1, stateB2, "State B crosstalk parity mismatch");

  // Host / Realm isolation assertions (typeof process & globalThis.process must be undefined)
  const hostIsolationItem = {
    id: "host_isolation_check",
    cls: "items",
    itemEffect: "core.setFlag('typeofProcess', typeof process); core.setFlag('typeofGlobalThisProcess', typeof globalThis.process);",
  };
  const stateHostIsolationON = makeTestState();
  const stateHostIsolationOFF = makeTestState();
  executeItemEffect(project, stateHostIsolationON, hostIsolationItem, { enableCompiledEffectCache: true });
  executeItemEffect(project, stateHostIsolationOFF, hostIsolationItem, { enableCompiledEffectCache: false });
  assert.strictEqual(stateHostIsolationON.flags.typeofProcess, "undefined", "Host process must not leak into compiled VM script");
  assert.strictEqual(stateHostIsolationOFF.flags.typeofProcess, "undefined", "Host process must not leak into native VM context");
  assert.strictEqual(stateHostIsolationON.flags.typeofGlobalThisProcess, "undefined", "globalThis.process must not exist in compiled VM script");
  assert.deepStrictEqual(stateHostIsolationON, stateHostIsolationOFF, "Host isolation parity mismatch");

  // Fresh globalThis isolation per execution (no persistent global mutation)
  const freshGlobalItem = {
    id: "fresh_global_check",
    cls: "items",
    itemEffect: "globalThis.counter = (globalThis.counter || 0) + 1; core.setFlag('counter', globalThis.counter);",
  };
  const stateGlobal1 = makeTestState();
  const stateGlobal2 = makeTestState();
  executeItemEffect(project, stateGlobal1, freshGlobalItem, { enableCompiledEffectCache: true });
  executeItemEffect(project, stateGlobal2, freshGlobalItem, { enableCompiledEffectCache: true });
  assert.strictEqual(stateGlobal1.flags.counter, 1, "First execution must see fresh global (counter=1)");
  assert.strictEqual(stateGlobal2.flags.counter, 1, "Second execution must also see fresh global (counter=1)");

  // Top-level return grammar assertion (Script grammar rejects top-level return with SyntaxError)
  const topLevelReturnItem = {
    id: "top_level_return",
    cls: "items",
    itemEffect: "return 1;",
  };
  let onReturnError = null;
  let offReturnError = null;
  try {
    executeItemEffect(project, makeTestState(), topLevelReturnItem, { enableCompiledEffectCache: true });
  } catch (err) {
    onReturnError = err;
  }
  try {
    executeItemEffect(project, makeTestState(), topLevelReturnItem, { enableCompiledEffectCache: false });
  } catch (err) {
    offReturnError = err;
  }
  assert.ok(onReturnError && onReturnError.name === "SyntaxError", "Compiled VM script must throw SyntaxError on top-level return");
  assert.ok(offReturnError && offReturnError.name === "SyntaxError", "Native VM script must throw SyntaxError on top-level return");

  // Invalid syntax parity
  const invalidSyntaxItem = {
    id: "invalid_syntax",
    cls: "items",
    itemEffect: "const a = ;",
  };
  let onSyntaxError = null;
  let offSyntaxError = null;
  try {
    executeItemEffect(project, makeTestState(), invalidSyntaxItem, { enableCompiledEffectCache: true });
  } catch (err) {
    onSyntaxError = err;
  }
  try {
    executeItemEffect(project, makeTestState(), invalidSyntaxItem, { enableCompiledEffectCache: false });
  } catch (err) {
    offSyntaxError = err;
  }
  assert.ok(onSyntaxError && onSyntaxError.name === "SyntaxError", "Compiled script must throw SyntaxError on invalid syntax");
  assert.ok(offSyntaxError && offSyntaxError.name === "SyntaxError", "Native VM script must throw SyntaxError on invalid syntax");

  // Timeout budget enforcement (infinite loop must time out without hanging)
  const timeoutItem = {
    id: "timeout_item",
    cls: "items",
    itemEffect: "while (true) {}",
  };
  let onTimeoutError = null;
  let offTimeoutError = null;
  const timeoutStartON = Date.now();
  try {
    executeItemEffect(project, makeTestState(), timeoutItem, { enableCompiledEffectCache: true, timeoutMs: 20 });
  } catch (err) {
    onTimeoutError = err;
  }
  const timeoutElapsedON = Date.now() - timeoutStartON;

  const timeoutStartOFF = Date.now();
  try {
    executeItemEffect(project, makeTestState(), timeoutItem, { enableCompiledEffectCache: false, timeoutMs: 20 });
  } catch (err) {
    offTimeoutError = err;
  }
  const timeoutElapsedOFF = Date.now() - timeoutStartOFF;

  assert.ok(onTimeoutError && /timed out/i.test(onTimeoutError.message), "Compiled VM script must enforce timeout");
  assert.ok(offTimeoutError && /timed out/i.test(offTimeoutError.message), "Native VM script must enforce timeout");
  assert.ok(timeoutElapsedON < 500, `Timeout ON took too long: ${timeoutElapsedON}ms`);
  assert.ok(timeoutElapsedOFF < 500, `Timeout OFF took too long: ${timeoutElapsedOFF}ms`);

  // AfterGetItem and LevelUp execution through simulator
  const levelUpItem = {
    id: "I_test_exp_potion",
    cls: "items",
    itemEffect: "core.status.hero.exp += 5;",
  };
  const syntheticProject = {
    ...project,
    itemsById: {
      ...project.itemsById,
      I_test_exp_potion: levelUpItem,
    },
    mapTilesByNumber: {
      ...project.mapTilesByNumber,
      "999": {
        number: 999,
        id: "I_test_exp_potion",
        cls: "items",
        canPass: true,
      },
    },
    floorsById: {
      ...project.floorsById,
      TEST_FLOOR: {
        width: 2,
        height: 2,
        ratio: 1,
        map: [[999, 0], [0, 0]],
        afterGetItem: {
          "0,0": [
            { type: "setValue", name: "flag:afterGetTriggered", value: "1" },
          ],
        },
      },
    },
  };
  const simSynthON = new StaticSimulator(syntheticProject, { enableCompiledEffectCache: true });
  const simSynthOFF = new StaticSimulator(syntheticProject, { enableCompiledEffectCache: false });

  const makeSynthState = (sim) => {
    const s = sim.createInitialState();
    s.floorId = "TEST_FLOOR";
    s.hero.lv = 1;
    s.hero.exp = 0;
    s.hero.atk = 10;
    return s;
  };

  const stateSynthON = makeSynthState(simSynthON);
  simSynthON.resolvePickupAt(stateSynthON, 0, 0);

  const stateSynthOFF = makeSynthState(simSynthOFF);
  simSynthOFF.resolvePickupAt(stateSynthOFF, 0, 0);

  assert.strictEqual(stateSynthON.flags.afterGetTriggered, 1, "afterGetItem must execute on pickup in ON mode");
  assert.strictEqual(stateSynthON.hero.lv, 2, "EXP pickup must trigger level-up to lv 2 in ON mode");
  assert.strictEqual(stateSynthON.hero.exp, 2, "EXP pickup must deduct cleared exp in ON mode");
  assert.strictEqual(stateSynthON.hero.atk, 11, "Level-up action must grant +1 ATK in ON mode");
  assert.deepStrictEqual(stateSynthON, stateSynthOFF, "Synthetic afterGetItem & levelUp parity mismatch between ON and OFF");

  // -------------------------------------------------------------------------
  // 2. Frozen 100-expansion Deterministic Parity
  // -------------------------------------------------------------------------
  const runOFF = runFrozen100Search(project, false);
  const runON = runFrozen100Search(project, true);

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

  // -------------------------------------------------------------------------
  // 3. MT1 Real Route Gate in Production ON Mode
  // -------------------------------------------------------------------------
  const gateResult = runOnlyUpMt1RealRouteGate({ autoBattleFastRejectEnabled: true, enableCompiledEffectCache: true });
  assert.strictEqual(gateResult.verdict, "REAL_MT1_GATE_PASSED", "MT1 gate verdict mismatch");
  assert.strictEqual(gateResult.failureReason, null, "MT1 gate failureReason must be null");
  assert.deepStrictEqual(gateResult.mismatches, [], "MT1 gate strict replay reported mismatches");
  assert.strictEqual(gateResult.metrics.fingerprintMatchedDecisionCount, 10, "MT1 gate must match 10/10 decisions");

  // -------------------------------------------------------------------------
  // 4. Paired A/B Benchmark (5 Alternating Pairs)
  // -------------------------------------------------------------------------
  // JIT Warmup
  runFixedWorkloadBenchmark(project, false, 150);
  runFixedWorkloadBenchmark(project, true, 150);

  const pairs = [];
  const PAIR_COUNT = 5;
  const WORKLOAD_EXPANSIONS = 400;

  for (let i = 1; i <= PAIR_COUNT; i++) {
    let offMetrics;
    let onMetrics;
    if (i % 2 === 1) {
      offMetrics = runFixedWorkloadBenchmark(project, false, WORKLOAD_EXPANSIONS);
      onMetrics = runFixedWorkloadBenchmark(project, true, WORKLOAD_EXPANSIONS);
    } else {
      onMetrics = runFixedWorkloadBenchmark(project, true, WORKLOAD_EXPANSIONS);
      offMetrics = runFixedWorkloadBenchmark(project, false, WORKLOAD_EXPANSIONS);
    }

    // Exact parity per pair
    assert.strictEqual(onMetrics.expansions, offMetrics.expansions, `Pair ${i}: expansions mismatch`);
    assert.strictEqual(onMetrics.generated, offMetrics.generated, `Pair ${i}: generated count mismatch`);
    assert.strictEqual(onMetrics.registered, offMetrics.registered, `Pair ${i}: registered count mismatch`);
    assert.strictEqual(onMetrics.frontierSize, offMetrics.frontierSize, `Pair ${i}: frontier size mismatch`);
    assert.strictEqual(onMetrics.stoppedReason, offMetrics.stoppedReason, `Pair ${i}: stopped reason mismatch`);
    assert.strictEqual(onMetrics.bestProgressStateKey, offMetrics.bestProgressStateKey, `Pair ${i}: best progress stateKey mismatch`);
    assert.strictEqual(onMetrics.bestProgressMeta, offMetrics.bestProgressMeta, `Pair ${i}: best progress meta mismatch`);

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
    schema: "motapathfinder.auto-pickup-apply-contract.v1",
    status: "passed",
    verdict: isPromoted ? "PICKUP_APPLY_FAST_PATH_PROMOTED" : "PICKUP_APPLY_FAST_PATH_NOT_PROMOTED",
    adversarialParity: {
      casesChecked: adversarialCases.length,
      crossStateCrosstalkChecked: true,
      hostIsolationChecked: true,
      freshGlobalChecked: true,
      scriptGrammarChecked: true,
      timeoutEnforcementChecked: true,
      afterGetItemChecked: true,
      levelUpTriggerChecked: true,
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
      pickupItemEffectMsBefore: runOFF.snapshot.expansionCost.timingDirectional.inclusiveSubsystems.stabilizeState.subphases.pickupItemEffectMs,
      pickupItemEffectMsAfter: runON.snapshot.expansionCost.timingDirectional.inclusiveSubsystems.stabilizeState.subphases.pickupItemEffectMs,
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
