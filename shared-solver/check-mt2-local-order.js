"use strict";

const assert = require("node:assert");
const path = require("node:path");

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { buildDominanceSummary, dominatesSummary } = require("./lib/dominance");
const { searchDP } = require("./lib/dp-search");
const { formatActionLabel } = require("./lib/enemy-labels");
const { loadProject } = require("./lib/project-loader");
const { StaticSimulator } = require("./lib/simulator");
const { cloneState } = require("./lib/state");

const PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");

const MT2_LEFT_ENTRY_PREFIX = [
  "battle:blackSlime@MT1:8,7",
  "battle:redSlime@MT1:9,6",
  "battle:blackSlime@MT1:3,10",
  "battle:slimelord@MT1:9,4",
  "battle:slimelord@MT1:3,4",
  "battle:bat@MT1:4,11",
  "battle:bat@MT1:8,11",
  "battle:bigBat@MT1:11,11",
  "battle:skeletonWarrior@MT1:2,1",
  "battle:redBat@MT1:10,1",
  "battle:skeleton@MT1:8,1",
  "changeFloor@MT1:6,0",
  "battle:skeleton@MT2:4,1",
  "battle:ghostSoldier@MT2:2,1",
];

const RIGHT_FIRST_SUFFIX = [
  "changeFloor@MT2:6,0",
  "changeFloor@MT1:6,0",
  "battle:zombie@MT2:8,3",
  "battle:zombieKnight@MT2:9,4",
  "battle:ghostSoldier@MT2:10,5",
  "battle:slimeman@MT2:2,5",
  "battle:zombieKnight@MT2:4,3",
  "battle:rock@MT2:10,1",
  "battle:rock@MT2:3,6",
];

const LEFT_FIRST_SUFFIX = [
  "battle:zombie@MT2:8,3",
  "battle:zombieKnight@MT2:4,3",
  "changeFloor@MT2:6,0",
  "changeFloor@MT1:6,0",
  "battle:zombieKnight@MT2:9,4",
  "battle:slimeman@MT2:2,5",
  "battle:rock@MT2:10,1",
  "battle:rock@MT2:3,6",
];

function makeSimulator() {
  const project = loadProject(PROJECT_ROOT);
  return new StaticSimulator(project, {
    stopFloorId: "MT5",
    battleResolver: new FunctionBackedBattleResolver(project),
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFightToLevelUp: false,
    enableResourcePocket: false,
    enableResourceCluster: false,
    enableResourceChain: true,
    searchGraphMode: "macro",
    resourceChainOptions: {
      floorIds: ["MT2"],
      lookaheadMaxDepth: 11,
      lookaheadMaxNodes: 140,
      lookaheadBranchLimit: 8,
      lookaheadFrontierLimit: 32,
    },
  });
}

function applySummary(simulator, state, summary) {
  const action = simulator.enumeratePrimitiveActions(state).actions.find((candidate) => candidate.summary === summary);
  assert.ok(action, `missing action: ${formatActionLabel(simulator.project, summary)}`);
  return simulator.applyAction(state, action);
}

function replayPlan(simulator, plan, state) {
  return plan.reduce((current, summary) => applySummary(simulator, current, summary), state || simulator.createInitialState({ rank: "chaos" }));
}

function indexOfPlan(plan, summary) {
  return (plan || []).indexOf(summary);
}

function assertOrdered(plan, left, right) {
  const leftIndex = indexOfPlan(plan, left);
  const rightIndex = indexOfPlan(plan, right);
  assert.ok(leftIndex >= 0, `expected plan to include ${left}`);
  assert.ok(rightIndex >= 0, `expected plan to include ${right}`);
  assert.ok(leftIndex < rightIndex, `expected ${left} before ${right}; plan=${JSON.stringify(plan)}`);
}

function main() {
  const simulator = makeSimulator();
  const base = replayPlan(simulator, MT2_LEFT_ENTRY_PREFIX);
  assert.equal(base.floorId, "MT2");
  assert.equal(base.hero.hp, 3582);
  assert.equal(base.hero.atk, 31);
  assert.equal(base.hero.def, 19);
  assert.equal(base.hero.mdef, 250);

  const rightFirst = replayPlan(simulator, RIGHT_FIRST_SUFFIX, base);
  const leftFirst = replayPlan(simulator, LEFT_FIRST_SUFFIX, base);
  assert.ok(rightFirst.hero.hp >= 3834, `right-first baseline should keep hp >= 3834, got ${rightFirst.hero.hp}`);
  assert.ok(
    rightFirst.hero.hp - leftFirst.hero.hp >= 500,
    `right-first route should beat left-first route by about 600 hp: right=${rightFirst.hero.hp}, left=${leftFirst.hero.hp}`
  );
  const lowerHpSamePosition = cloneState(rightFirst);
  lowerHpSamePosition.hero.hp = rightFirst.hero.hp - 600;
  lowerHpSamePosition.meta.decisionDepth = rightFirst.meta.decisionDepth - 3;
  assert.equal(
    simulator.buildSearchConfluenceKey(rightFirst),
    simulator.buildSearchConfluenceKey(lowerHpSamePosition),
    "canonical confluence key should ignore hp and decision depth"
  );
  assert.ok(
    simulator.compareSearchConfluenceStates(rightFirst, lowerHpSamePosition) < 0,
    "canonical confluence comparison should prefer higher hp for the same local state"
  );
  assert.ok(
    dominatesSummary(buildDominanceSummary(rightFirst, 0), buildDominanceSummary(lowerHpSamePosition, 0)),
    "dominance should allow a higher-hp equivalent state to dominate even when its route is longer"
  );

  const returnAction = simulator.enumeratePrimitiveActions(base).actions.find((action) => action.summary === "changeFloor@MT2:6,0");
  assert.ok(returnAction, "expected MT2 return stair to be available");
  const chains = simulator.enumerateResourceChainActions(base, [returnAction]);
  assert.ok(chains.length > 0, "expected resourceChain actions at MT2 local-order checkpoint");
  const bestChain = chains[0];
  const preview = simulator.applyAction(base, bestChain, { storeRoute: false });
  assert.ok(
    preview.hero.hp >= 3834 && preview.hero.atk >= 72 && preview.hero.def >= 35 && preview.hero.mdef >= 290,
    `best resourceChain should preserve the high-HP right-first branch, got hp=${preview.hero.hp} atk=${preview.hero.atk} def=${preview.hero.def} mdef=${preview.hero.mdef}`
  );
  assertOrdered(bestChain.plan, "battle:zombie@MT2:8,3", "battle:zombieKnight@MT2:9,4");
  assertOrdered(bestChain.plan, "battle:zombieKnight@MT2:9,4", "battle:ghostSoldier@MT2:10,5");
  assertOrdered(bestChain.plan, "battle:ghostSoldier@MT2:10,5", "battle:zombieKnight@MT2:4,3");

  const dpResult = searchDP(simulator, base, {
    maxExpansions: 450,
    dpKeyMode: "mutation",
    goalPredicate: (state) =>
      state.floorId === "MT2" &&
      Number((state.hero || {}).hp || 0) >= 3834 &&
      Number((state.hero || {}).atk || 0) >= 72 &&
      Number((state.hero || {}).def || 0) >= 35 &&
      Number((state.hero || {}).mdef || 0) >= 290,
  });
  assert.ok(dpResult.goalState, "DP should find the MT2 right-first high-HP confluence branch from the 3582 checkpoint");

  console.log(JSON.stringify({
    base: { hp: base.hero.hp, atk: base.hero.atk, def: base.hero.def, mdef: base.hero.mdef },
    rightFirst: { hp: rightFirst.hero.hp, atk: rightFirst.hero.atk, def: rightFirst.hero.def, mdef: rightFirst.hero.mdef },
    leftFirst: { hp: leftFirst.hero.hp, atk: leftFirst.hero.atk, def: leftFirst.hero.def, mdef: leftFirst.hero.mdef },
    bestChain: {
      summary: bestChain.summary,
      hp: preview.hero.hp,
      atk: preview.hero.atk,
      def: preview.hero.def,
      mdef: preview.hero.mdef,
      plan: bestChain.plan,
    },
    dp: {
      found: Boolean(dpResult.goalState),
      hp: dpResult.goalState && dpResult.goalState.hero.hp,
      atk: dpResult.goalState && dpResult.goalState.hero.atk,
      def: dpResult.goalState && dpResult.goalState.hero.def,
      mdef: dpResult.goalState && dpResult.goalState.hero.mdef,
      expansions: dpResult.expansions,
      route: dpResult.goalState && (dpResult.goalState.route || []).filter((step) => !String(step).startsWith("auto:")),
    },
  }, null, 2));
}

main();
