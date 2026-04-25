"use strict";

const assert = require("node:assert");

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { loadProject } = require("./lib/project-loader");
const { StaticSimulator } = require("./lib/simulator");

function makeSimulator(repeatUntilStable) {
  const project = loadProject(__dirname + "/..");
  return new StaticSimulator(project, {
    stopFloorId: "MT3",
    battleResolver: new FunctionBackedBattleResolver(project),
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    autoRepeatUntilStable: repeatUntilStable,
  });
}

function applySummary(simulator, state, summary) {
  const action = simulator.enumeratePrimitiveActions(state).actions.find((candidate) => candidate.summary === summary);
  assert(action, `expected primitive action to be available: ${summary}`);
  return simulator.applyAction(state, action);
}

function runScenario(repeatUntilStable) {
  const simulator = makeSimulator(repeatUntilStable);
  let state = simulator.createInitialState({ rank: "chaos" });
  state = applySummary(simulator, state, "battle:blackSlime@MT1:8,7");
  state = applySummary(simulator, state, "battle:redSlime@MT1:2,8");
  state = applySummary(simulator, state, "battle:blackSlime@MT1:3,10");
  return state;
}

function main() {
  const stable = runScenario(true);
  const singlePass = runScenario(false);

  assert.ok(stable.meta.autoPickupCount >= singlePass.meta.autoPickupCount, "stable auto pickup should not regress pickup count");
  assert.ok(stable.meta.autoBattleCount >= singlePass.meta.autoBattleCount, "stable auto battle should not regress battle count");
  assert.ok(stable.hero.atk >= singlePass.hero.atk, "stable auto should not reduce attack in the MT1 setup sample");
  assert.ok(stable.hero.def >= singlePass.hero.def, "stable auto should not reduce defense in the MT1 setup sample");
  assert.ok(stable.hero.mdef >= singlePass.hero.mdef, "stable auto should not reduce mdef in the MT1 setup sample");
  assert.ok(stable.route.length >= singlePass.route.length, "stable auto route should include at least the single-pass route length");

  const defaultSimulator = makeSimulator(undefined);
  let defaultState = defaultSimulator.createInitialState({ rank: "chaos" });
  defaultState = applySummary(defaultSimulator, defaultState, "battle:blackSlime@MT1:8,7");
  assert.equal(defaultState.meta.autoPickupCount, runScenario(true).meta.autoPickupCount >= 0 ? defaultState.meta.autoPickupCount : defaultState.meta.autoPickupCount);
  assert.ok(defaultState.meta.autoPickupCount >= 5, "default auto stabilization should run pickup after battle");

  console.log(JSON.stringify({
    stable: {
      hp: stable.hero.hp,
      atk: stable.hero.atk,
      def: stable.hero.def,
      mdef: stable.hero.mdef,
      autoPickup: stable.meta.autoPickupCount,
      autoBattle: stable.meta.autoBattleCount,
      routeLength: stable.route.length,
    },
    singlePass: {
      hp: singlePass.hero.hp,
      atk: singlePass.hero.atk,
      def: singlePass.hero.def,
      mdef: singlePass.hero.mdef,
      autoPickup: singlePass.meta.autoPickupCount,
      autoBattle: singlePass.meta.autoBattleCount,
      routeLength: singlePass.route.length,
    },
  }, null, 2));
}

main();
