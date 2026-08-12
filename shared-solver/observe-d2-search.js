"use strict";

const path = require("node:path");

const { buildAutomaticMacroGraph } = require("./lib/automatic-macro-graph");
const { compileAutomaticFeasibilitySubgoals } = require("./lib/automatic-feasibility-subgoals");
const { readBlindGoal } = require("./lib/blind-discovery-baseline");
const { runD2BlindFailureAttribution } = require("./lib/d2-blind-failure-attribution");
const { loadProject } = require("./lib/project-loader");
const { buildSearchObservatory, renderSearchObservatoryMarkdown } = require("./lib/search-observatory");
const { createMt5EntryState, detachCheckpoint } = require("./qualify-blind-discovery");

const ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");
const GOAL_FILE = path.join(__dirname, "blind-goals", "onlyup-mt5-blueking.json");

function buildD2Observatory(options) {
  const config = options || {};
  const project = loadProject(PROJECT_ROOT);
  const blindGoal = readBlindGoal(GOAL_FILE);
  const initialState = detachCheckpoint(createMt5EntryState(project));
  const searchReport = runD2BlindFailureAttribution({
    project,
    initialState,
    terminalGoal: blindGoal.goal,
    towerId: blindGoal.project,
    maxExpansions: Number(config.maxExpansions || process.env.D2_OBSERVATORY_MAX_EXPANSIONS || 1000),
    checkpointStateProvenance: "tracked-fixture-replay-for-test-state-construction-then-history-detached",
  });
  const graph = buildAutomaticMacroGraph(project, initialState, blindGoal.goal, {
    towerId: blindGoal.project,
    envelopeMode: "state-visible-revisitable",
  });
  const feasibility = compileAutomaticFeasibilitySubgoals(project, initialState, blindGoal.goal, graph);
  const report = buildSearchObservatory(searchReport, feasibility);
  return report;
}

function main() {
  const report = buildD2Observatory();
  process.stdout.write(`${renderSearchObservatoryMarkdown(report)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (require.main === module) main();

module.exports = { buildD2Observatory, main };
