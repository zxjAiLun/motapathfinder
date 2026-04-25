"use strict";

const assert = require("node:assert");

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { createCheckpointPool, recordFloorEntryCheckpoint, selectRepairCheckpoints } = require("./lib/floor-checkpoints");
const { loadProject } = require("./lib/project-loader");
const { analyzeProgressBlocker } = require("./lib/progress-blockers");
const { StaticSimulator } = require("./lib/simulator");

function makeSimulator() {
  const project = loadProject(__dirname + "/..");
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

function main() {
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
    blocker: blocker.blockerType,
    candidates: candidates.map((candidate) => ({ id: candidate.id, hero: candidate.hero, tags: candidate.tags })),
  }, null, 2));
}

main();
