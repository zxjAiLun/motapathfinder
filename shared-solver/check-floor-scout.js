"use strict";

const assert = require("node:assert");

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { resolveProjectRoot } = require("./lib/cli-options");
const { loadProject } = require("./lib/project-loader");
const { scoutChangeFloor } = require("./lib/floor-scout");
const { StaticSimulator } = require("./lib/simulator");
const { buildDominanceKey } = require("./lib/state-key");

function makeSimulator() {
  const project = loadProject(resolveProjectRoot(process.argv.slice(2), __dirname + "/../Only upV2.1/Only upV2.1"));
  return new StaticSimulator(project, {
    stopFloorId: "MT5",
    battleResolver: new FunctionBackedBattleResolver(project),
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableResourcePocket: false,
  });
}

function findAction(simulator, state, predicate, description) {
  const action = simulator.enumeratePrimitiveActions(state).actions.find(predicate);
  assert(action, `expected action: ${description}`);
  return action;
}

function main() {
  const simulator = makeSimulator();
  let state = simulator.createInitialState({ rank: "chaos" });
  const beforeKey = buildDominanceKey(state);
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
    const action = findAction(simulator, state, (candidate) => candidate.summary === summary, summary);
    state = simulator.applyAction(state, action);
  }
  const changeFloor = findAction(simulator, state, (action) => action.kind === "changeFloor" && action.changeFloor && action.changeFloor.floorId === ":next", "MT1->MT2 changeFloor");
  const sourceKey = buildDominanceKey(state);
  const scout = scoutChangeFloor(simulator, state, changeFloor);

  assert.equal(scout.fromFloorId, "MT1");
  assert.equal(scout.toFloorId, "MT2");
  assert.equal(scout.entry.floorId, "MT2");
  assert.ok(scout.reachable.tileCount > 0, "scout should count reachable tiles");
  assert.ok(Array.isArray(scout.battleFrontier), "scout should include battle frontier");
  assert.ok(Array.isArray(scout.forwardGates), "scout should include forward gates");
  assert.equal(buildDominanceKey(state), sourceKey, "scout must not mutate source state");
  assert.notEqual(beforeKey, sourceKey, "scenario should mutate after battle before scout");

  console.log(JSON.stringify({
    from: scout.fromFloorId,
    to: scout.toFloorId,
    entry: scout.entry,
    reachable: scout.reachable,
    deficits: scout.deficits,
    verdict: scout.verdict,
    score: scout.score,
  }, null, 2));
}

main();
