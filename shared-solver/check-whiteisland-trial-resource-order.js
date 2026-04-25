"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { executeActionList } = require("./lib/events");
const { computeFrontierFeatures } = require("./lib/frontier-features");
const { loadProject } = require("./lib/project-loader");
const { readRouteFile } = require("./lib/route-store");
const { searchTopK } = require("./lib/search");
const { StaticSimulator } = require("./lib/simulator");

const PROJECT_ROOT = path.resolve(__dirname, "..", "whiteisland（9）");
const PREFIX_ROUTE = [
  "battle:greenSlime@A1:6,9",
  "openDoor:yellowDoor@A1:5,8",
  "battle:greenSlime@A1:3,8",
  "battle:greenSlime@A1:1,6",
  "battle:greenSlime@A1:1,3",
  "battle:redSlime@A1:3,2",
  "battle:blackSlime@A1:9,7",
  "openDoor:yellowDoor@A1:9,5",
  "battle:blackSlime@A1:6,1",
  "battle:greenSlime@A1:10,8",
];

function createSimulator(project) {
  return new StaticSimulator(project, {
    stopFloorId: "A3",
    battleResolver: new FunctionBackedBattleResolver(project, { autoLevelUp: false }),
    autoPickupEnabled: true,
    autoBattleEnabled: false,
  });
}

function createTrialState(project, simulator) {
  let state = simulator.createInitialState({ rank: "chaos" });
  const choiceEvent = (((project.floorsById.Start.events || {})["3,3"] || [])[0] || {}).choices || [];
  const trialChoice = choiceEvent.find((choice) => choice.text === "试炼间");
  assert.ok(trialChoice, "Start 3,3 should include 试炼间 choice");
  executeActionList(project, state, trialChoice.action || [], { floorId: "Start" }, { choiceResolver: simulator.choiceResolver });
  return simulator.stabilizeState(state);
}

function applySummary(simulator, state, summary) {
  const action = simulator.enumerateActions(state).find((candidate) => candidate.summary === summary);
  assert.ok(action, `expected replay action: ${summary}`);
  return simulator.applyAction(state, action, { storeRoute: false });
}

function buildStepElevenState(project, simulator) {
  return PREFIX_ROUTE.reduce((state, summary) => applySummary(simulator, state, summary), createTrialState(project, simulator));
}

function actionPriority(simulator, state, summary) {
  const features = computeFrontierFeatures(simulator.project, state, { battleResolver: simulator.battleResolver });
  const action = simulator.enumeratePrimitiveActions(state).actions.find((candidate) => candidate.summary === summary);
  assert.ok(action, `expected available action: ${summary}`);
  return {
    action,
    priority: simulator.getActionPriority(state, action, features),
  };
}

function assertStepElevenOrder(project) {
  const simulator = createSimulator(project);
  const state = buildStepElevenState(project, simulator);
  const redSlime = actionPriority(simulator, state, "battle:redSlime@A1:10,10");
  const slimelord = actionPriority(simulator, state, "battle:slimelord@A1:9,1");

  assert.ok(
    redSlime.priority > slimelord.priority,
    `expected A1 10,10 priority (${redSlime.priority}) > A1 9,1 priority (${slimelord.priority})`
  );

  const afterRedSlime = simulator.applyAction(state, redSlime.action, { storeRoute: false });
  assert.strictEqual(afterRedSlime.hero.hp, state.hero.hp, "A1 10,10 should be zero-damage at this state");
  assert.ok(afterRedSlime.hero.def > state.hero.def, "A1 10,10 should auto-pick the defense gem");
}

async function runSmallSearch(project) {
  const simulator = createSimulator(project);
  simulator.isTerminal = (state) => Boolean(state.meta && state.meta.winReason);
  const initialState = createTrialState(project, simulator);
  const result = await searchTopK(simulator, initialState, {
    topK: 1,
    maxExpansions: 1200,
    projectRoot: PROJECT_ROOT,
    profileName: "whiteisland-resource-order-check",
    targetFloorId: "A3",
    autoPickupEnabled: true,
    autoBattleEnabled: false,
  });

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "whiteisland-resource-order-"));
  const routePath = path.join(outDir, "whiteisland-trial-best-progress.route.json");
  const { buildRouteRecord, writeRouteFile } = require("./lib/route-store");
  writeRouteFile(routePath, buildRouteRecord({
    project,
    simulator,
    initialState,
    finalState: result.bestProgressState || result.bestSeenState,
    options: {
      projectRoot: PROJECT_ROOT,
      toFloor: "A3",
      goalType: "win",
      profile: "whiteisland-resource-order-check",
      rank: "chaos",
      solver: "whiteisland-trial-topk",
      expanded: result.expansions,
      generated: result.diagnostics && result.diagnostics.generated,
      snapshotFloors: ["Start", "A1", "A2", "A3"],
      metadata: { foundGoal: result.foundGoal },
    },
  }));
  return readRouteFile(routePath);
}

function assertRouteOrder(route) {
  const summaries = route.decisions.map((decision) => decision.summary);
  assert.strictEqual(summaries.findIndex((summary) => summary.includes("blueDoor")), -1, "route should not open the only blue door early");
  const redSlimeIndex = summaries.indexOf("battle:redSlime@A1:10,10");
  const slimelordIndex = summaries.indexOf("battle:slimelord@A1:9,1");
  assert.ok(redSlimeIndex >= 0, "route should include A1 10,10 defense gem fight");
  assert.ok(slimelordIndex < 0 || redSlimeIndex < slimelordIndex, "A1 10,10 should appear before A1 9,1 if both are present");
  ["battle:greenSlime@A1:1,6", "battle:greenSlime@A1:1,3", "battle:redSlime@A1:3,2"].forEach((summary) => {
    assert.ok(summaries.includes(summary), `route should include left resource-chain step: ${summary}`);
  });
}

async function main() {
  assert.ok(fs.existsSync(PROJECT_ROOT), `missing whiteisland project root: ${PROJECT_ROOT}`);
  const project = loadProject(PROJECT_ROOT);
  assertStepElevenOrder(project);
  const route = await runSmallSearch(project);
  assertRouteOrder(route);
  console.log("whiteisland resource order ok");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  });
}
