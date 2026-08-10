"use strict";

const assert = require("node:assert");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { searchDP } = require("./lib/dp-search");
const { compileAdmissibleFeasibilityBounds } = require("./lib/goal-feasibility-bounds");
const { cloneState, removeTileAt } = require("./lib/state");

function baseProject() {
  return {
    floorsById: {
      F1: { width: 2, height: 1, map: [[1, 2]], changeFloor: {} },
      F2: { width: 1, height: 1, map: [[0]], changeFloor: {} },
      F3: { width: 1, height: 1, map: [[0]], changeFloor: {} },
    },
    mapTilesByNumber: {
      "1": { id: "guard", cls: "enemy", canPass: false },
      "2": { id: "sword", cls: "equips", canPass: false },
    },
  };
}

function baseState() {
  return {
    floorId: "F1",
    hero: {
      hp: 100,
      atk: 10,
      def: 5,
      mdef: 0,
      lv: 1,
      exp: 0,
      money: 0,
      mana: 0,
      equipment: [],
      loc: { x: 0, y: 0 },
    },
    inventory: {},
    flags: {},
    visitedFloors: { F1: true },
    floorStates: {},
    route: [],
    notes: [],
    meta: { decisionDepth: 0, rawRouteLength: 0 },
  };
}

function compile(overrides) {
  return compileAdmissibleFeasibilityBounds(baseProject(), {
    id: "goal",
    goal: {
      type: "heroAtLeast",
      floorId: "F3",
      minHero: { atk: 20 },
      minEffectiveHero: { def: 12 },
      equipmentIncludes: ["sword"],
      presentTiles: [{ floorId: "F1", x: 0, y: 0 }],
    },
    admissibleBounds: {
      floorGraph: {
        complete: true,
        floorFly: false,
        edges: { F1: ["F2"], F2: [] },
      },
      optimisticHeroGain: { atk: 5 },
      optimisticEffectiveHeroGain: { def: 4 },
      equipmentSources: {
        sword: { complete: true, tiles: [{ floorId: "F1", x: 1, y: 0 }] },
      },
      ...(overrides || {}),
    },
  });
}

function assertReason(compiled, state, reason) {
  const verdict = compiled.evaluate(state);
  assert.strictEqual(verdict.feasible, false);
  assert.strictEqual(verdict.reason, reason);
  assert.ok(Object.prototype.hasOwnProperty.call(verdict, "current"));
  assert.ok(Object.prototype.hasOwnProperty.call(verdict, "target"));
  assert.ok(Object.prototype.hasOwnProperty.call(verdict, "bound"));
  assert.ok(verdict.witness);
  return verdict;
}

function checkNecessaryBounds() {
  const project = baseProject();

  const clearedProtected = baseState();
  removeTileAt(clearedProtected, "F1", 0, 0);
  assertReason(compile(), clearedProtected, "required-tile-irreversibly-cleared");

  assertReason(compile(), baseState(), "target-floor-unreachable");

  const exhaustedEquipment = baseState();
  exhaustedEquipment.floorId = "F3";
  removeTileAt(exhaustedEquipment, "F1", 1, 0);
  assertReason(
    compile({ floorGraph: { complete: true, floorFly: false, edges: { F3: [] } } }),
    exhaustedEquipment,
    "required-equipment-unavailable",
  );

  const lowStats = baseState();
  lowStats.floorId = "F3";
  lowStats.hero.equipment = ["sword"];
  const heroBound = assertReason(
    compile({ floorGraph: { complete: true, floorFly: false, edges: { F3: [] } } }),
    lowStats,
    "optimistic-hero-bound-below-goal",
  );
  assert.strictEqual(heroBound.bound, 15);

  const lowEffective = cloneState(lowStats);
  lowEffective.hero.atk = 20;
  const effectiveBound = assertReason(
    compile({ floorGraph: { complete: true, floorFly: false, edges: { F3: [] } } }),
    lowEffective,
    "optimistic-effective-hero-bound-below-goal",
  );
  assert.strictEqual(effectiveBound.bound, 9);

  const unknown = compileAdmissibleFeasibilityBounds(project, {
    id: "unknown",
    goal: { type: "heroAtLeast", floorId: "F3", minHero: { atk: 9999 } },
  }).evaluate(baseState());
  assert.deepStrictEqual(unknown, { feasible: true, unknown: true });

  return {
    protectedTile: "required-tile-irreversibly-cleared",
    floor: "target-floor-unreachable",
    equipment: "required-equipment-unavailable",
    hero: heroBound.reason,
    effectiveHero: effectiveBound.reason,
    incompleteEvidence: "unknown-kept",
  };
}

function checkDiagnosticWitness() {
  const state = baseState();
  const predicate = () => ({
    feasible: false,
    reason: "optimistic-hero-bound-below-goal",
    current: 10,
    target: 20,
    bound: 15,
    witness: { field: "atk", optimisticRemainingGain: 5 },
  });
  const simulator = {
    project: baseProject(),
    getAvailableActions: () => [],
    applyAction: () => null,
    getActionFingerprint: (action) => action && action.summary,
    getActionExpansionCacheStats: () => ({}),
  };
  const result = searchDP(simulator, state, {
    maxExpansions: 1,
    stateFeasibilityPredicate: predicate,
    goalPredicate: () => false,
  });
  assert.strictEqual(result.diagnostics.dp.goalFeasibility.pruned, 1);
  assert.deepStrictEqual(result.diagnostics.dp.goalFeasibility.samples, [{
    reason: "optimistic-hero-bound-below-goal",
    current: 10,
    target: 20,
    bound: 15,
    witness: { field: "atk", optimisticRemainingGain: 5 },
  }]);
  return result.diagnostics.dp.goalFeasibility;
}

function checkTrackedUnknownKeepsRoute() {
  const harness = path.join(__dirname, "check-real-route-performance-qualification.js");
  const run = spawnSync(process.execPath, [
    harness,
    "--case=mt2-to-mt3-i893",
    "--order=B",
    "--max-expansions=100",
    "--walk-mode=safe-fast",
    "--search-intent=first-feasible",
    "--goal-feasibility-mode=admissible-v1",
  ], {
    cwd: __dirname,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.strictEqual(run.status, 0, run.stderr || run.stdout);
  const report = JSON.parse(run.stdout);
  const result = report.results[0].runs[0];
  assert.strictEqual(result.found, true);
  assert.strictEqual(result.strictReplay.verified, true);
  assert.strictEqual(result.scale.goalFeasibilityPruned, 0);
  return {
    case: report.results[0].id,
    found: result.found,
    strictReplayVerified: result.strictReplay.verified,
    goalFeasibilityPruned: result.scale.goalFeasibilityPruned,
  };
}

function main() {
  process.stdout.write(`${JSON.stringify({
    bounds: checkNecessaryBounds(),
    diagnostics: checkDiagnosticWitness(),
    trackedUnknownEvidence: checkTrackedUnknownKeepsRoute(),
  }, null, 2)}\n`);
}

if (require.main === module) main();
