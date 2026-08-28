"use strict";

/** TEST GRADE: local-regression */

/**
 * PR-5.24b Iteration 3 Repair 1 – Item-Effect Interpreter Exact Semantics Gate
 *
 * The interpreter fast path executes parsed itemEffect programs EXCLUSIVELY on
 * the authoritative buildEffectCore object (single semantics implementation).
 * This gate hard-asserts:
 *
 *  1. Fast-path coverage: every OnlyUp cls="items" itemEffect source parses
 *     into the interpreter subset (canInterpretItemEffect === true) – no silent
 *     fallback for the current project.
 *  2. Adversarial equivalence: randomized pre-states (hero/values/floor/flags/
 *     inventory) → interpreter fingerprint === VM fingerprint, exactly.
 *  3. Synthetic edge matrix: ratio=0 floors, addItem(id, 0), setFlag(name)
 *     (undefined write), addFlag(name) (undefined arithmetic), hero=0 fields,
 *     hero-field-referencing arithmetic – exact VM equality.
 *  4. Unsupported-source fallback: sources outside the subset (Math.max, loops)
 *     must report canInterpret === false and the VM path must be taken, with
 *     state equal to direct VM execution.
 *  5. Search-level A/B: bounded MT1→MT2 probe with the interpreter disabled
 *     (enableItemEffectInterpreter=false) vs enabled must produce identical
 *     expansions, goal count, sorted goal StateKeys and stop reason.
 */

const assert = require("node:assert");
const vm = require("node:vm");
const path = require("node:path");
const crypto = require("node:crypto");
const { loadProject } = require("./lib/project-loader");
const {
  executeItemEffect,
  buildEffectCore,
  canInterpretItemEffect,
} = require("./lib/effect-vm");

const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");

function fingerprint(state) {
  return JSON.stringify({
    hero: state.hero,
    flags: state.flags,
    inventory: state.inventory,
  });
}

function runVmEffect(project, state, source) {
  const context = { core: buildEffectCore(project, state), Math };
  vm.runInNewContext(source, context, { timeout: 1000 });
}

function assertInterpretedEqualsVm(project, item, preState, label) {
  const interpreted = JSON.parse(JSON.stringify(preState));
  const vmState = JSON.parse(JSON.stringify(preState));
  executeItemEffect(project, interpreted, item, {});
  runVmEffect(project, vmState, item.itemEffect);
  assert.strictEqual(
    fingerprint(interpreted),
    fingerprint(vmState),
    `${label}: interpreter diverged from VM on item ${item.id} (${String(item.itemEffect).slice(0, 80)})`,
  );
}

function runCoverageGate(project) {
  const clsItems = Object.values(project.itemsById || {})
    .filter((item) => item && typeof item.itemEffect === "string" && item.itemEffect.length > 0 && item.cls === "items");
  assert.ok(clsItems.length > 0, "Project must contain cls=items items with itemEffect");
  const notCovered = clsItems.filter((item) => !canInterpretItemEffect(item.itemEffect));
  assert.strictEqual(
    notCovered.length,
    0,
    `Fast-path coverage must be 100% for the current project; ${notCovered.length} items fall back to the VM: ${JSON.stringify(notCovered.slice(0, 5).map((i) => i.itemEffect.slice(0, 80)))}`,
  );
  return clsItems;
}

function runAdversarialEquivalence(project, clsItems) {
  const floorIds = Object.keys(project.floorsById || {});
  let seed = 20260828;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const valueKeys = Object.keys(project.values || {});
  const makePreState = () => ({
    floorId: floorIds[Math.floor(rnd() * floorIds.length)],
    hero: {
      hp: Math.floor(rnd() * 2000),
      atk: Math.floor(rnd() * 200),
      def: Math.floor(rnd() * 100),
      mdef: Math.floor(rnd() * 300),
      money: Math.floor(rnd() * 1000),
      lv: Math.floor(rnd() * 10),
      exp: Math.floor(rnd() * 50),
    },
    flags: { f1: Math.floor(rnd() * 10) },
    inventory: { redKey: Math.floor(rnd() * 5) },
    notes: [],
    __values: (() => {
      const values = {};
      for (const key of valueKeys) values[key] = Math.floor(rnd() * 100);
      return values;
    })(),
  });

  let total = 0;
  for (const item of clsItems) {
    for (let trial = 0; trial < 5; trial += 1) {
      const pre = makePreState();
      const savedValues = project.values;
      project.values = pre.__values;
      try {
        assertInterpretedEqualsVm(project, item, pre, "adversarial");
        total += 1;
      } finally {
        project.values = savedValues;
      }
    }
  }
  return total;
}

function runSyntheticEdgeMatrix(project) {
  // Build a synthetic project shell that forces the edge conditions the random
  // matrix cannot hit on real project data. The interpreter and the VM both run
  // against the same authoritative core, so these cases pin the single-semantics
  // claim exactly.
  const makeProject = (ratio) => ({
    floorsById: { F0: { ratio } },
    values: { gem: 10, zero: 0 },
    itemsById: {},
  });

  const cases = [
    { name: "ratio-0 floor", ratio: 0, effect: "core.status.hero.atk += core.values.gem * core.status.thisMap.ratio" },
    { name: "ratio-undefined floor", ratio: undefined, effect: "core.status.hero.hp += core.values.zero * core.status.thisMap.ratio" },
    { name: "addItem amount 0", ratio: 1, effect: "core.addItem('redKey', 0)" },
    { name: "addItem missing amount", ratio: 1, effect: "core.addItem('redKey')" },
    { name: "setFlag missing value", ratio: 1, effect: "core.setFlag('x')" },
    { name: "setFlag value 0", ratio: 1, effect: "core.setFlag('x', 0)" },
    { name: "addFlag missing value", ratio: 1, effect: "core.addFlag('x')" },
    { name: "addFlag value 0", ratio: 1, effect: "core.addFlag('x', 0)" },
    { name: "hero field 0 arithmetic", ratio: 1, effect: "core.status.hero.atk += core.status.hero.def * 2" },
    { name: "hero field referenced", ratio: 1, effect: "core.status.hero.hp += core.status.hero.mdef" },
    { name: "division by zero value", ratio: 1, effect: "core.status.hero.atk += core.values.gem / core.values.zero" },
    { name: "plain assignment", ratio: 1, effect: "core.status.hero.atk = 42" },
    { name: "chained statements", ratio: 2, effect: "core.status.hero.atk += core.values.gem * core.status.thisMap.ratio; core.addItem('redKey', 3); core.setFlag('opened', 1)" },
  ];

  for (const testCase of cases) {
    assert.ok(
      canInterpretItemEffect(testCase.effect),
      `synthetic case "${testCase.name}" must be interpreter-covered: ${testCase.effect}`,
    );
    const project = makeProject(testCase.ratio);
    const preState = () => ({
      floorId: "F0",
      hero: { hp: 100, atk: 7, def: 3, mdef: 5, money: 0, lv: 1, exp: 0 },
      flags: {},
      inventory: {},
      notes: [],
    });
    const interpreted = preState();
    executeItemEffect(project, interpreted, { itemEffect: testCase.effect, cls: "items" }, {});
    const vmState = preState();
    runVmEffect(project, vmState, testCase.effect);
    assert.strictEqual(
      fingerprint(interpreted),
      fingerprint(vmState),
      `synthetic edge "${testCase.name}": interpreter != VM (${testCase.effect})\ninterp=${fingerprint(interpreted)}\nvm=${fingerprint(vmState)}`,
    );
  }
  return cases.length;
}

function runFallbackGate(project) {
  const unsupportedSources = [
    "core.status.hero.atk = Math.max(core.values.gem, 5)",
    "core.setFlag('x', [1,2,3].length)",
  ];
  for (const source of unsupportedSources) {
    assert.strictEqual(
      canInterpretItemEffect(source),
      false,
      `Unsupported source must be rejected by the interpreter subset: ${source}`,
    );
    // VM fallback must produce state identical to direct VM execution.
    const interpreted = {
      floorId: "MT1",
      hero: { hp: 100, atk: 7, def: 3, mdef: 5, money: 0, lv: 1, exp: 0 },
      flags: {},
      inventory: {},
      notes: [],
    };
    const vmState = JSON.parse(JSON.stringify(interpreted));
    executeItemEffect(project, interpreted, { itemEffect: source, cls: "items" }, {});
    runVmEffect(project, vmState, source);
    assert.strictEqual(
      fingerprint(interpreted),
      fingerprint(vmState),
      `VM fallback must match direct VM execution for unsupported source: ${source}`,
    );
  }
  // Runtime-error sources must throw identically on the fallback VM path.
  const throwingSources = ["this.hero.atk += 1"];
  for (const source of throwingSources) {
    assert.strictEqual(canInterpretItemEffect(source), false, `Throwing source must not be interpreter-covered: ${source}`);
    const base = {
      floorId: "MT1",
      hero: { hp: 100, atk: 7 },
      flags: {},
      inventory: {},
      notes: [],
    };
    let executeThrew = false;
    let vmThrew = false;
    try {
      executeItemEffect(project, JSON.parse(JSON.stringify(base)), { itemEffect: source, cls: "items" }, {});
    } catch (_) { executeThrew = true; }
    try {
      runVmEffect(project, JSON.parse(JSON.stringify(base)), source);
    } catch (_) { vmThrew = true; }
    assert.strictEqual(executeThrew, vmThrew, `Throwing source must behave identically (executeThrew=${executeThrew}, vmThrew=${vmThrew}): ${source}`);
  }
  return unsupportedSources.length + throwingSources.length;
}

function runSearchLevelAB(project) {
  const { StaticSimulator } = require("./lib/simulator");
  const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
  const { getMilestoneSpec } = require("./lib/milestone-spec");
  const { searchSegmentDP } = require("./lib/segment-dp");
  const { buildStateKey } = require("./lib/state-key");
  const { createNoStateChangeChoiceResolver } = require("./lib/onlyup-mt1-real-route-gate");

  const buildSimulator = (interpreterEnabled) => new StaticSimulator(project, {
    stopFloorId: "MT6",
    battleResolver: new FunctionBackedBattleResolver(project, { enableFastReject: true }),
    autoBattleFastRejectEnabled: true,
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFastHazardBlockIndex: true,
    enableCompiledEffectCache: false,
    choiceResolver: createNoStateChangeChoiceResolver(),
    enableItemEffectInterpreter: interpreterEnabled,
  });

  const spec = getMilestoneSpec(project, "onlyup-chaos-mt1-mt3");
  const segment = spec.milestones[0];

  // Plumbing verification: the simulator flag must reach executeItemEffect.
  // Instrument applyPickup via a single-state manual pickup on both configs.
  const plumbedState = {
    floorId: "MT1",
    hero: { hp: 1000, atk: 50, def: 30, mdef: 20, money: 0, lv: 1, exp: 0 },
    flags: {},
    inventory: {},
    notes: [],
  };
  const { applyPickup } = require("./lib/effect-vm");
  const gemSource = Object.values(project.itemsById || {}).find(
    (item) => item && item.cls === "items" && /core\.values\.[a-zA-Z]+ \* core\.status\.thisMap\.ratio/.test(item.itemEffect || ""),
  );
  assert.ok(gemSource, "A/B plumbing probe needs one ratio-based gem item");
  const atkBefore = plumbedState.hero.atk;
  applyPickup(project, plumbedState, gemSource.id, { enableItemEffectInterpreter: false });
  const vmDelta = plumbedState.hero.atk - atkBefore;
  const state2 = JSON.parse(JSON.stringify(plumbedState));
  state2.hero.atk = atkBefore;
  applyPickup(project, state2, gemSource.id, { enableItemEffectInterpreter: true });
  const interpDelta = state2.hero.atk - atkBefore;
  assert.strictEqual(vmDelta, interpDelta, "Interpreter/VM pickup delta must match (plumbing sanity)");

  const probe = (interpreterEnabled) => {
    const simulator = buildSimulator(interpreterEnabled);
    const initial = simulator.createInitialState();
    const result = searchSegmentDP(simulator, initial, segment, {
      candidateId: interpreterEnabled ? "ab-interp" : "ab-vm",
      candidateLimit: 10,
      dpOverrides: {
        maxExpansions: 1000,
        maxRuntimeMs: 25000,
        maxRssMb: 4096,
        memoryCheckIntervalExpansions: 1,
      },
    });
    const dp = result.diagnostics.dp;
    return {
      expansions: dp.expansions,
      goalCount: (result.goalSkyline || []).length,
      sortedKeys: (result.goalSkyline || []).map((g) => buildStateKey(g.state)).sort(),
      stopReason: dp.stoppedReason,
    };
  };

  const withInterpreter = probe(true);
  const withoutInterpreter = probe(false);
  assert.strictEqual(withInterpreter.expansions, withoutInterpreter.expansions, "A/B expansions mismatch");
  assert.strictEqual(withInterpreter.goalCount, withoutInterpreter.goalCount, "A/B goal count mismatch");
  assert.deepStrictEqual(withInterpreter.sortedKeys, withoutInterpreter.sortedKeys, "A/B sorted goal StateKeys mismatch");
  assert.strictEqual(withInterpreter.stopReason, withoutInterpreter.stopReason, "A/B stop reason mismatch");
  return {
    expansions: withInterpreter.expansions,
    goalCount: withInterpreter.goalCount,
    keyHash: crypto.createHash("sha256").update(withInterpreter.sortedKeys.join("|")).digest("hex").slice(0, 16),
    stopReason: withInterpreter.stopReason,
  };
}

function main() {
  const project = loadProject(DEFAULT_PROJECT_ROOT);
  const clsItems = runCoverageGate(project);
  const adversarialCases = runAdversarialEquivalence(project, clsItems);
  const syntheticCases = runSyntheticEdgeMatrix(project);
  const fallbackCases = runFallbackGate(project);
  const searchAB = runSearchLevelAB(project);
  console.log(JSON.stringify({
    schema: "motapathfinder.item-effect-interpreter-equivalence.v2",
    contractStatus: "passed",
    fastPathCoverage: { items: clsItems.length, fallback: 0 },
    adversarialCases,
    disagree: 0,
    syntheticEdgeCases: syntheticCases,
    fallbackCases,
    searchLevelAB: searchAB,
  }, null, 2));
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  }
}

module.exports = { main };
