"use strict";

const assert = require("node:assert");

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { resolveProjectRoot } = require("./lib/cli-options");
const { combatSignature, createCheckpointPool, recordFloorEntryCheckpoint, selectRepairCheckpoints } = require("./lib/floor-checkpoints");
const { loadProject } = require("./lib/project-loader");
const { analyzeProgressBlocker } = require("./lib/progress-blockers");
const { repairFromCheckpoints } = require("./lib/checkpoint-repair");
const { StaticSimulator } = require("./lib/simulator");

function makeSimulator() {
  const project = loadProject(resolveProjectRoot(process.argv.slice(2), __dirname + "/.."));
  return new StaticSimulator(project, {
    stopFloorId: "MT5",
    battleResolver: new FunctionBackedBattleResolver(project),
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableResourcePocket: true,
  });
}

function applySummary(simulator, state, summary) {
  const action = simulator.enumeratePrimitiveActions(state).actions.find((candidate) => candidate.summary === summary);
  assert(action, `expected action to be available: ${summary}`);
  return { action, state: simulator.applyAction(state, action) };
}

function makeSyntheticState(floorId, routeLength, hero, inventory) {
  return {
    floorId,
    hero: {
      loc: { x: 6, y: 6, direction: "up" },
      hp: 100,
      atk: 10,
      def: 10,
      mdef: 10,
      lv: 2,
      exp: 0,
      money: 0,
      equipment: ["I100"],
      ...(hero || {}),
    },
    inventory: inventory || { yellowKey: 1 },
    flags: {},
    visitedFloors: { [floorId]: true },
    floorStates: { [floorId]: { removed: {}, replaced: {} } },
    route: Array.from({ length: routeLength }, (_, index) => `step:${index}`),
    meta: { decisionDepth: routeLength },
  };
}

function checkCheckpointSkyline() {
  const pool = createCheckpointPool({ checkpointLimitPerEdge: 16 });
  const action = {
    kind: "changeFloor",
    floorId: "MT1",
    changeFloor: { floorId: "MT2", loc: [6, 12] },
    summary: "changeFloor@MT1:6,0",
  };
  const simulator = {
    project: null,
    applyAction: (state) => makeSyntheticState("MT2", (state.route || []).length + 1, state.hero, state.inventory),
  };
  const parent = makeSyntheticState("MT1", 1, {}, { yellowKey: 1 });
  [
    makeSyntheticState("MT2", 10, { hp: 100, exp: 2 }, { yellowKey: 1 }),
    makeSyntheticState("MT2", 12, { hp: 120, exp: 2 }, { yellowKey: 1 }),
    makeSyntheticState("MT2", 5, { hp: 90, exp: 4 }, { yellowKey: 1 }),
    makeSyntheticState("MT2", 13, { hp: 80, exp: 1 }, { yellowKey: 1 }),
  ].forEach((child) => recordFloorEntryCheckpoint(pool, simulator, parent, child, action));

  const checkpoints = pool.edges["MT1->MT2"] || [];
  const summaries = checkpoints.map((checkpoint) => ({ hp: checkpoint.hero.hp, routeLength: checkpoint.routeLength, exp: checkpoint.hero.exp, tags: checkpoint.tags }));
  assert.ok(checkpoints.some((checkpoint) => checkpoint.tags.includes("skyline-highest-hp") && checkpoint.hero.hp === 120), "skyline should keep highest HP representative");
  assert.ok(checkpoints.some((checkpoint) => checkpoint.tags.includes("skyline-shortest-route") && checkpoint.routeLength === 5), "skyline should keep shortest route representative");
  assert.ok(checkpoints.some((checkpoint) => checkpoint.tags.includes("skyline-near-level") && checkpoint.hero.exp === 4), "skyline should keep near-level representative");
  assert.ok(!checkpoints.some((checkpoint) => checkpoint.hero.hp === 80), `dominated checkpoint should be pruned: ${JSON.stringify(summaries)}`);
  assert.equal(new Set(checkpoints.map(combatSignature)).size, 1, "synthetic checkpoints should share one skyline key");
  return { pool, summaries };
}

async function checkCheckpointRepairPlanner(pool) {
  const blocker = {
    blockerType: "hp-deficit",
    deficits: { hp: 5 },
    recommendedRepair: {
      fromEdge: "MT1->MT2",
      minHero: { hp: 115, atk: 10, def: 10, mdef: 10 },
      preferTags: ["skyline-shortest-route", "skyline-best-scout"],
    },
  };
  const originalBest = makeSyntheticState("MT2", 20, { hp: 70, atk: 10, def: 10, mdef: 10, exp: 0 }, { yellowKey: 1 });
  const result = await repairFromCheckpoints({
    compareSearchStates: (left, right) => (left.hero.hp || 0) - (right.hero.hp || 0),
  }, {
    checkpointPool: pool,
    bestProgressState: originalBest,
    bestSeenState: originalBest,
    profile: { parallel: true, workers: 4, topKBatchSize: 16, workerChunkSize: 2 },
  }, blocker, {
    maxRepairAttempts: 4,
    repairExpansionsPerAttempt: 7,
    topK: 1,
    searchFn: async (_simulator, startState, options) => {
      assert.deepEqual(startState.route, [], "repair short search should start with an empty suffix route");
      assert.equal(options.maxExpansions, 7);
      assert.equal(options.parallel, true, "repair short search should inherit parallel TopK mode");
      assert.equal(options.workers, 4);
      return {
        expansions: 3,
        goalState: {
          ...makeSyntheticState("MT3", 1, { ...startState.hero, hp: startState.hero.hp + 1 }, startState.inventory),
          route: ["repair-step"],
          visitedFloors: { MT1: true, MT2: true, MT3: true },
        },
      };
    },
    analyzeProgressBlocker: () => ({ blockerType: "cleared", deficits: { hp: 0 } }),
    targetFloorId: "MT3",
  });
  assert.equal(result.repaired, true, "checkpoint repair should accept a goal found from short search");
  assert.ok(result.candidatePlan.length >= 2, "repair should build a multi-strategy candidate plan");
  assert.ok(result.candidatePlan.some((candidate) => candidate.strategy === "preferred:skyline-shortest-route" || candidate.strategy === "fastest-route"), "repair should include fastest route strategy");
  assert.ok(result.candidatePlan.some((candidate) => candidate.strategy === "preferred:skyline-best-scout" || candidate.strategy === "best-scout"), "repair should include best scout strategy");
  assert.ok(result.candidatePlan.some((candidate) => (candidate.strategies || []).includes("closest-requirement")), "repair should retain coalesced closest-requirement strategy");
  assert.ok(result.repairedState.route.length > 1, "repair should stitch checkpoint prefix with short-search suffix");
  assert.equal(result.repairedState.route[result.repairedState.route.length - 1], "repair-step");
  return {
    selectedCheckpointId: result.selectedCheckpointId,
    candidatePlan: result.candidatePlan.map((candidate) => ({
      checkpointId: candidate.checkpointId,
      strategy: candidate.strategy,
      strategies: candidate.strategies,
      requirementDeficit: candidate.requirementDeficit,
    })),
    routeLength: result.repairedState.route.length,
  };
}

async function main() {
  const skylineCheck = checkCheckpointSkyline();
  const repairPlanner = await checkCheckpointRepairPlanner(skylineCheck.pool);
  const simulator = makeSimulator();
  const pool = createCheckpointPool();
  let state = simulator.createInitialState({ rank: "chaos" });
  for (const summary of [
    "battle:blackSlime@MT1:8,7",
    "battle:redSlime@MT1:9,6",
    "battle:slimelord@MT1:9,4",
    "battle:slimelord@MT1:3,4",
    "battle:skeletonWarrior@MT1:2,1",
    "battle:vampire@MT1:4,3",
    "battle:skeletonCaptain@MT1:8,3",
    "battle:skeletonCaptain@MT1:2,5",
    "battle:skeleton@MT1:4,1",
  ]) {
    state = applySummary(simulator, state, summary).state;
  }
  const changeFloorAction = simulator.enumeratePrimitiveActions(state).actions.find((action) => action.kind === "changeFloor" && action.changeFloor && action.changeFloor.floorId === ":next");
  assert(changeFloorAction, "expected forward changeFloor from MT1");
  const mt2 = simulator.applyAction(state, changeFloorAction);
  recordFloorEntryCheckpoint(pool, simulator, state, mt2, changeFloorAction);


  let highState = simulator.createInitialState({ rank: "chaos" });
  for (const summary of [
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
    "battle:skeletonCaptain@MT1:8,3",
    "battle:skeletonCaptain@MT1:2,5",
    "battle:skeleton@MT1:4,1",
  ]) {
    highState = applySummary(simulator, highState, summary).state;
  }
  const highChangeFloor = simulator.enumeratePrimitiveActions(highState).actions.find((action) => action.kind === "changeFloor" && action.changeFloor && action.changeFloor.floorId === ":next");
  assert(highChangeFloor, "expected high-state forward changeFloor from MT1");
  const highMt2 = simulator.applyAction(highState, highChangeFloor);
  recordFloorEntryCheckpoint(pool, simulator, highState, highMt2, highChangeFloor);

  const blocker = analyzeProgressBlocker(simulator, mt2, {});
  if (!blocker.recommendedRepair) blocker.recommendedRepair = { fromEdge: "MT1->MT2", minHero: { hp: 1559, atk: 17, def: 8, mdef: 130 } };
  else blocker.recommendedRepair.fromEdge = "MT1->MT2";
  const candidates = selectRepairCheckpoints(pool, blocker, { maxRepairAttempts: 2 });
  assert.ok(candidates.length > 0, "expected repair candidates");
  assert.ok(candidates[0].hero.hp >= 1559, `expected highest-priority repair candidate to preserve high HP, got ${candidates[0].hero.hp}`);

  console.log(JSON.stringify({
    skyline: skylineCheck.summaries,
    repairPlanner,
    blocker: blocker.blockerType,
    candidates: candidates.map((candidate) => ({ id: candidate.id, hero: candidate.hero, tags: candidate.tags })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
