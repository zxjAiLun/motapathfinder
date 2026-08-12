"use strict";

const path = require("node:path");

const { readBlindGoal } = require("./lib/blind-discovery-baseline");
const { runD2BlindFailureAttribution } = require("./lib/d2-blind-failure-attribution");
const { loadProject } = require("./lib/project-loader");
const { createMt5EntryState, detachCheckpoint } = require("./qualify-blind-discovery");

const ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");
const GOAL_FILE = path.join(__dirname, "blind-goals", "onlyup-mt5-blueking.json");

function main() {
  const project = loadProject(PROJECT_ROOT);
  const blindGoal = readBlindGoal(GOAL_FILE);
  const result = runD2BlindFailureAttribution({
    project,
    initialState: detachCheckpoint(createMt5EntryState(project)),
    terminalGoal: blindGoal.goal,
    towerId: blindGoal.project,
    maxExpansions: Number(process.env.D2_ATTRIBUTION_MAX_EXPANSIONS || 1000),
    checkpointStateProvenance: "tracked-fixture-replay-for-test-state-construction-then-history-detached",
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main };
