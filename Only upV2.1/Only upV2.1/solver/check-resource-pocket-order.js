"use strict";

const assert = require("node:assert");

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { loadProject } = require("./lib/project-loader");
const { StaticSimulator } = require("./lib/simulator");

const EXPECTED_PLAN = [
  "battle:blackSlime@MT1:8,7",
  "battle:redSlime@MT1:2,8",
  "battle:blackSlime@MT1:3,10",
  "battle:slimelord@MT1:9,4",
  "battle:slimelord@MT1:3,4",
  "battle:bat@MT1:4,11",
  "battle:bat@MT1:8,11",
  "battle:bigBat@MT1:11,11",
  "battle:skeletonWarrior@MT1:2,1",
  "battle:redBat@MT1:10,1",
];

const PREFIX_PLAN = [
  "battle:blackSlime@MT1:8,7",
  "battle:redSlime@MT1:2,8",
];

const BAD_SUFFIX_PLAN = [
  "battle:blackSlime@MT1:3,10",
  "battle:slimelord@MT1:9,4",
  "battle:bigBat@MT1:11,11",
  "battle:skeletonWarrior@MT1:2,1",
  "battle:redBat@MT1:10,1",
];

function makeSimulator() {
  const project = loadProject(__dirname + "/..");
  return new StaticSimulator(project, {
    stopFloorId: "MT3",
    battleResolver: new FunctionBackedBattleResolver(project),
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFightToLevelUp: true,
    enableResourcePocket: true,
  });
}

function applySummary(simulator, state, summary) {
  const action = simulator.enumeratePrimitiveActions(state).actions.find((candidate) => candidate.summary === summary);
  assert(action, `expected primitive action to be available: ${summary}`);
  return simulator.applyAction(state, action);
}

function replayPlan(simulator, plan) {
  return plan.reduce(
    (state, summary) => applySummary(simulator, state, summary),
    simulator.createInitialState({ rank: "chaos" })
  );
}

function replayFromState(simulator, state, plan) {
  return plan.reduce((current, summary) => applySummary(simulator, current, summary), state);
}

function assertHighHpMt1Preparation(state) {
  assert.equal(state.hero.hp, 1559, "expected high-HP MT1 preparation hp");
  assert.equal(state.hero.atk, 17, "expected high-HP MT1 preparation atk");
  assert.equal(state.hero.def, 8, "expected high-HP MT1 preparation def");
  assert.equal(state.hero.mdef, 130, "expected high-HP MT1 preparation mdef");
  assert.equal(state.hero.lv, 3, "expected high-HP MT1 preparation lv");
  assert.equal(state.hero.exp, 5, "expected high-HP MT1 preparation exp");
}

function hasTargetCombat(state) {
  return state.hero.atk === 17 &&
    state.hero.def === 8 &&
    state.hero.mdef === 130 &&
    state.hero.lv === 3 &&
    state.hero.exp === 5;
}

function checkManualPlan() {
  const simulator = makeSimulator();
  const state = replayPlan(simulator, EXPECTED_PLAN);
  assertHighHpMt1Preparation(state);
  return { hp: state.hero.hp, routeLength: state.route.length };
}

function checkGreedyBadPlan() {
  const simulator = makeSimulator();
  const baseState = replayPlan(simulator, PREFIX_PLAN);
  const state = replayFromState(simulator, baseState, BAD_SUFFIX_PLAN);
  assert.ok(state.hero.hp < 1559, `expected bad greedy order to be lower than 1559 hp, got ${state.hero.hp}`);
  return { hp: state.hero.hp, routeLength: state.route.length };
}

function checkPocketPlans() {
  const simulator = makeSimulator();
  const baseState = replayPlan(simulator, PREFIX_PLAN);
  const pocketActions = simulator.enumerateActions(baseState).filter((action) => action.kind === "resourcePocket");
  assert.ok(pocketActions.length > 0, "expected resourcePocket actions from MT1 prefix state");

  const previews = pocketActions.map((action, index) => ({
    action,
    index,
    state: simulator.applyAction(baseState, action),
  }));
  const high = previews.find((entry) => entry.state.hero.hp >= 1559 && hasTargetCombat(entry.state));
  assert.ok(high, "resourcePocket should preserve the high-HP MT1 preparation route");
  assert.ok(Array.isArray(high.action.planEntries), "resourcePocket should include planEntries");
  assert.ok(high.action.planEntries.every((entry) => entry.fingerprint), "resourcePocket planEntries should include fingerprints");

  const low = previews.find((entry) => entry.state.hero.hp < 1559 && hasTargetCombat(entry.state));
  if (low) {
    assert.ok(high.index < low.index, `high-HP plan should rank before low-HP plan: high=${high.index}, low=${low.index}`);
  }

  return {
    total: pocketActions.length,
    highIndex: high.index,
    highHp: high.state.hero.hp,
    lowIndex: low ? low.index : null,
    lowHp: low ? low.state.hero.hp : null,
    highPlan: high.action.plan,
  };
}

function main() {
  const manual = checkManualPlan();
  const bad = checkGreedyBadPlan();
  const pocket = checkPocketPlans();
  console.log(JSON.stringify({ manual, bad, pocket }, null, 2));
}

main();
