"use strict";

const assert = require("node:assert");

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { buildResourcePocketSearchOptions, resolveProjectRoot } = require("./lib/cli-options");
const { loadProject } = require("./lib/project-loader");
const { getStageActionScore } = require("./lib/stage-policy");
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

const MT2_ENTRY_PLAN = [
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
];

function makeSimulator() {
  const project = loadProject(resolveProjectRoot(process.argv.slice(2), __dirname + "/../Only upV2.1/Only upV2.1"));
  return new StaticSimulator(project, {
    stopFloorId: "MT3",
    battleResolver: new FunctionBackedBattleResolver(project),
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFightToLevelUp: true,
    enableResourcePocket: true,
    resourcePocketSearchOptions: {
      ...buildResourcePocketSearchOptions({ "resource-pocket-mode": "normal" }),
      byFloor: {
        MT1: { maxDepth: 12, maxNodes: 20, branchLimit: 14, frontierLimit: 32, resultLimit: 8, preserveConfluenceSkyline: false },
        MT2: { maxDepth: 8, maxNodes: 20, branchLimit: 10, frontierLimit: 16, resultLimit: 8, preserveConfluenceSkyline: true },
      },
    },
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
  assert.ok(state.hero.hp >= 1559, `expected high-HP MT1 preparation hp >= 1559, got ${state.hero.hp}`);
  assert.ok(state.hero.atk >= 17, `expected high-HP MT1 preparation atk >= 17, got ${state.hero.atk}`);
  assert.ok(state.hero.def >= 8, `expected high-HP MT1 preparation def >= 8, got ${state.hero.def}`);
  assert.ok(state.hero.mdef >= 130, `expected high-HP MT1 preparation mdef >= 130, got ${state.hero.mdef}`);
  assert.ok(state.hero.lv >= 3, `expected high-HP MT1 preparation lv >= 3, got ${state.hero.lv}`);
  assert.ok(state.hero.exp >= 5, `expected high-HP MT1 preparation exp >= 5, got ${state.hero.exp}`);
}

function meetsHighHpBaseline(state) {
  return state.hero.hp >= 1559 &&
    state.hero.atk >= 17 &&
    state.hero.def >= 8 &&
    state.hero.mdef >= 130 &&
    state.hero.lv >= 3 &&
    state.hero.exp >= 5;
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
  const high = previews.find((entry) => meetsHighHpBaseline(entry.state));
  assert.ok(high, "resourcePocket should preserve the high-HP MT1 preparation route");
  assert.ok(Array.isArray(high.action.planEntries), "resourcePocket should include planEntries");
  assert.ok(high.action.planEntries.every((entry) => entry.fingerprint), "resourcePocket planEntries should include fingerprints");

  const low = previews.find((entry) => entry.state.hero.hp < 1559 &&
    entry.state.hero.atk >= 17 &&
    entry.state.hero.def >= 8 &&
    entry.state.hero.mdef >= 130 &&
    entry.state.hero.lv >= 3 &&
    entry.state.hero.exp >= 5);
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

function planIncludes(action, summaries, preview) {
  const planText = [
    ...(action.plan || []),
    ...((preview && preview.route) || []),
  ].join("\n");
  return summaries.every((summary) => planText.includes(summary));
}

function findMt2LeftPocket(pocketActions, previews) {
  return pocketActions.find((action) => planIncludes(action, [
    "battle:skeleton@MT2:4,1",
    "battle:ghostSoldier@MT2:2,1",
    "battle:skeleton@MT2:8,1",
  ], previews && previews.get(action)));
}

function findMt2RightPocket(pocketActions) {
  return pocketActions.find((action) => planIncludes(action, [
    "battle:skeleton@MT2:8,1",
    "battle:skeleton@MT2:4,1",
  ]));
}

function checkMt2LeftLinePocket() {
  const simulator = makeSimulator();
  const mt2Entry = replayPlan(simulator, MT2_ENTRY_PLAN);
  assert.equal(mt2Entry.floorId, "MT2");
  assert.ok(mt2Entry.hero.hp >= 1601, `expected MT2 entry hp >= 1601, got ${mt2Entry.hero.hp}`);
  assert.ok(mt2Entry.hero.atk >= 21, `expected MT2 entry atk >= 21, got ${mt2Entry.hero.atk}`);
  assert.ok(mt2Entry.hero.def >= 17, `expected MT2 entry def >= 17, got ${mt2Entry.hero.def}`);
  assert.ok(mt2Entry.hero.mdef >= 130, `expected MT2 entry mdef >= 130, got ${mt2Entry.hero.mdef}`);
  assert.equal(mt2Entry.hero.lv, 3);
  assert.ok(mt2Entry.hero.exp >= 6, `expected MT2 entry exp >= 6, got ${mt2Entry.hero.exp}`);

  const pocketActions = simulator.enumerateActions(mt2Entry).filter((action) => action.kind === "resourcePocket");
  assert.ok(pocketActions.length > 0, "expected resourcePocket actions from MT2 entry state");
  const previews = new Map(pocketActions.map((action) => [action, simulator.applyAction(mt2Entry, action)]));
  const leftPocket = findMt2LeftPocket(pocketActions, previews);
  assert.ok(leftPocket, "resourcePocket should preserve MT2 left-line confluence route");
  const leftPreview = previews.get(leftPocket);
  assert.ok(leftPreview.hero.hp >= 3582, `expected MT2 left-line hp >= 3582, got ${leftPreview.hero.hp}`);
  assert.ok(leftPreview.hero.atk >= 31, `expected MT2 left-line atk >= 31, got ${leftPreview.hero.atk}`);
  assert.ok(leftPreview.hero.mdef >= 250, `expected MT2 left-line mdef >= 250, got ${leftPreview.hero.mdef}`);

  const rightPocket = findMt2RightPocket(pocketActions);
  assert.ok(rightPocket, "expected right-line pocket for score comparison");
  const leftScore = getStageActionScore(simulator, mt2Entry, leftPocket, 0, { targetFloorId: "MT5" });
  const rightScore = getStageActionScore(simulator, mt2Entry, rightPocket, 0, { targetFloorId: "MT5" });
  assert.ok(
    leftScore >= rightScore,
    `MT2 left-line pocket should rank no worse than right-line pocket: left=${leftScore}, right=${rightScore}`
  );

  const nodeLowHp = { state: JSON.parse(JSON.stringify(leftPreview)), planEntries: leftPocket.planEntries, stopReasons: [], depth: leftPocket.planEntries.length, score: 1 };
  const nodeHighHp = { state: JSON.parse(JSON.stringify(leftPreview)), planEntries: leftPocket.planEntries, stopReasons: [], depth: leftPocket.planEntries.length, score: 1 };
  nodeLowHp.state.hero.hp = 3527;
  nodeHighHp.state.hero.hp = 3582;
  const selected = simulator.selectPocketConfluenceSkyline(mt2Entry, [nodeLowHp, nodeHighHp], { representativesPerConfluence: 1 });
  assert.equal(selected[0].state.hero.hp, 3582, "confluence skyline should preserve higher HP representative");

  return {
    total: pocketActions.length,
    leftScore,
    rightScore,
    leftHp: leftPreview.hero.hp,
    leftPlan: leftPocket.plan,
  };
}

function main() {
  const manual = checkManualPlan();
  const bad = checkGreedyBadPlan();
  const pocket = checkPocketPlans();
  const mt2Left = checkMt2LeftLinePocket();
  console.log(JSON.stringify({ manual, bad, pocket, mt2Left }, null, 2));
}

main();
