"use strict";

const path = require("node:path");

const { makeBlindSimulator, readBlindGoal } = require("./lib/blind-discovery-baseline");
const { loadProject } = require("./lib/project-loader");
const { runStrategicD2Search } = require("./lib/strategic-d2-search");
const { createMt5EntryState, detachCheckpoint } = require("./qualify-blind-discovery");

const ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");
const GOAL_FILE = path.join(__dirname, "blind-goals", "onlyup-mt5-blueking.json");

function main() {
  const project = loadProject(PROJECT_ROOT);
  const initialState = detachCheckpoint(createMt5EntryState(project));
  const terminalGoal = readBlindGoal(GOAL_FILE).goal;
  const result = runStrategicD2Search({
    project,
    projectRoot: PROJECT_ROOT,
    initialState,
    terminalGoal,
    simulatorFactory: () => makeBlindSimulator(project),
    maxExpansions: Number(process.env.STRATEGIC_D2_MAX_EXPANSIONS || 1000),
    includeFloorFly: process.env.STRATEGIC_D2_INCLUDE_FLOOR_FLY === "1",
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main };
