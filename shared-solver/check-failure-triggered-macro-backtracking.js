"use strict";

/** TEST GRADE: unit-plus-micro */

const assert = require("node:assert");
const path = require("node:path");

const { makeBlindSimulator, readBlindGoal } = require("./lib/blind-discovery-baseline");
const {
  compileAutomaticStages,
  runFailureTriggeredMacroBacktracking,
  stateFingerprint,
} = require("./lib/hierarchical-blind-planner");
const { loadProject } = require("./lib/project-loader");
const { searchSegmentDP } = require("./lib/segment-dp");

function main() {
  const project = loadProject(path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1"));
  const blindGoal = readBlindGoal(path.resolve(__dirname, "blind-goals", "onlyup-mt5-blueking.json"));
  const simulator = makeBlindSimulator(project);
  const initialState = simulator.createInitialState({ rank: blindGoal.rank });
  const stages = compileAutomaticStages({ floorCorridor: { floorIds: ["MT1", "MT2"] }, source: { target: blindGoal.goal } });
  const collection = searchSegmentDP(simulator, initialState, stages[0], {
    candidateLimit: 8,
    preserveSkylineRoles: true,
    dpPriorityMode: "goal-directed",
    dpOverrides: {
      maxExpansions: 65,
      maxRuntimeMs: 0,
      maxHeapMb: 2048,
      goalSkylineLimit: 8,
      stopOnFirstGoal: false,
      maxExpansionsAfterFirstGoal: 2,
      priorityMode: "goal-directed",
    },
  });
  assert.strictEqual(collection.found, true);
  assert.strictEqual(collection.diagnostics.dp.firstGoalExpansion, 62);
  assert.strictEqual(collection.diagnostics.dp.expansions, 64);
  assert.strictEqual(collection.diagnostics.dp.stoppedReason, "goal-collection-limit");
  assert.ok(collection.deepestExpanded);

  const result = runFailureTriggeredMacroBacktracking({
    project,
    simulator,
    initialState,
    terminalGoal: blindGoal.goal,
    towerId: blindGoal.project,
    maxExpansions: 8,
  });
  assert.strictEqual(result.inputContract.knownRouteUsed, false);
  assert.strictEqual(result.inputContract.milestoneUsed, false);
  assert.strictEqual(result.budget.consumedExpansions, 8);
  assert.strictEqual(result.found, false);
  assert.match(stateFingerprint(initialState), /^[0-9a-f]{16}$/);
  process.stdout.write(`${JSON.stringify({
    status: "passed",
    collection: {
      firstGoalExpansion: collection.diagnostics.dp.firstGoalExpansion,
      expansions: collection.diagnostics.dp.expansions,
      stoppedReason: collection.diagnostics.dp.stoppedReason,
    },
    strategy: result.strategy,
    verdict: result.verdict,
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main };
