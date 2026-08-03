"use strict";

const assert = require("node:assert");
const path = require("node:path");

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { buildDpStateKey } = require("./lib/dp-search");
const { loadProject } = require("./lib/project-loader");
const { loadRegionSpec } = require("./lib/region-spec");
const { StaticSimulator } = require("./lib/simulator");
const { buildStateKey } = require("./lib/state-key");
const { createInitialState } = require("./lib/state");
const {
  normalizeSolverModel,
  validateSolverModel,
} = require("./lib/solver-model");

const ROOT = path.resolve(__dirname, "..");
const ONLYUP_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");
const ONLYUP_SPEC = path.join(
  ROOT,
  "towers",
  "onlyup",
  "region-specs",
  "region-1.json",
);

function expectThrows(fn, pattern) {
  assert.throws(fn, pattern);
}

function main() {
  const spec = loadRegionSpec(ONLYUP_SPEC);
  assert.strictEqual(spec.model.explicit, true);
  assert.strictEqual(spec.model.mode, "manual");
  assert.strictEqual(spec.model.mechanics.keys, false);
  assert.strictEqual(spec.model.mechanics.doors, false);
  assert.strictEqual(spec.model.mechanics.pointAllocation, false);

  const project = loadProject(ONLYUP_ROOT);
  const legacyState = createInitialState(project, { rank: "chaos" });
  ["hpmax", "mana", "manamax", "money"].forEach((field) => {
    assert.ok(
      Object.prototype.hasOwnProperty.call(legacyState.hero, field),
      "legacy state must retain hero." + field,
    );
  });
  assert.strictEqual(legacyState.meta.solverModel, undefined);
  const legacySimulator = new StaticSimulator(project, {
    battleResolver: new FunctionBackedBattleResolver(project),
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    searchGraphMode: "primitive",
  });
  const legacyDpKey = buildDpStateKey(
    legacySimulator,
    legacySimulator.createInitialState({ rank: "chaos" }),
    { dpKeyMode: "region" },
  );
  ["mana", "money", "followers"].forEach((field) => {
    assert.strictEqual(
      legacyDpKey.includes('"' + field + '"'),
      true,
      "legacy DP key must retain hero." + field,
    );
  });

  const simulator = new StaticSimulator(project, {
    solverModel: spec.model,
    battleResolver: new FunctionBackedBattleResolver(project),
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    searchGraphMode: "primitive",
  });
  const state = simulator.createInitialState({ rank: "chaos" });
  ["hpmax", "mana", "manamax", "money", "followers"].forEach((field) => {
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(state.hero, field),
      false,
      "manual disabled field must not be maintained: hero." + field,
    );
  });
  ["hp", "atk", "def", "mdef", "lv", "exp", "equipment"].forEach((field) => {
    assert.ok(
      Object.prototype.hasOwnProperty.call(state.hero, field),
      "manual maintained field must be projected: hero." + field,
    );
  });
  assert.strictEqual(state.meta.solverModel.fingerprint, spec.model.fingerprint);

  const dpKey = buildDpStateKey(simulator, state, { dpKeyMode: "region" });
  ["hpmax", "mana", "manamax", "money", "followers"].forEach((field) => {
    assert.strictEqual(
      dpKey.includes('"' + field + '"'),
      false,
      "DP key must omit hero." + field,
    );
  });
  ["atk", "def", "mdef", "lv", "exp", "equipment"].forEach((field) => {
    assert.strictEqual(
      dpKey.includes('"' + field + '"'),
      true,
      "DP key must retain hero." + field,
    );
  });
  assert.strictEqual(
    dpKey.includes('"solverModel":"' + spec.model.fingerprint + '"'),
    true,
  );
  assert.strictEqual(buildStateKey(state).includes('"money"'), false);

  const contaminated = structuredClone(state);
  contaminated.hero.money = 99;
  contaminated.hero.mana = 4;
  const projected = simulator.stabilizeState(contaminated);
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(projected.hero, "money"),
    false,
  );
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(projected.hero, "mana"),
    false,
  );

  const legacyModel = normalizeSolverModel(null);
  assert.strictEqual(legacyModel.explicit, false);
  validateSolverModel(spec.model);
  expectThrows(
    () => validateSolverModel({ heroFields: { mana: "unsafe-mode" } }),
    /Invalid SolverModel/,
  );
 expectThrows(
   () => validateSolverModel({ heroFields: { unknown: "disabled" } }),
   /not supported/,
 );
  expectThrows(
    () => validateSolverModel({ mechanics: { shops: false } }),
    /not supported/,
  );

  process.stdout.write(JSON.stringify({
    schema: "motapathfinder.pr-5.3a-solver-model-contract.v1",
    status: "passed",
    legacyPreserved: true,
    manualModel: {
      fingerprint: spec.model.fingerprint,
      disabledHeroFields: ["hpmax", "mana", "manamax", "money", "followers"],
      keyHeroFields: ["atk", "def", "mdef", "lv", "exp", "equipment"],
      mechanics: spec.model.mechanics,
    },
    compactHeroFields: Object.keys(state.hero).sort(),
    legacyDpKeyPreserved: true,
    dpKeyOmitsDisabledFields: true,
    projectionReappliedAfterMutation: true,
    invalidModelControls: 3,
  }, null, 2) + "\n");
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  }
}

module.exports = { main };
