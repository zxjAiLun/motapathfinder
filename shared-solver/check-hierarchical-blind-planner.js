"use strict";

/** TEST GRADE: unit-plus-micro */

const assert = require("node:assert");
const path = require("node:path");

const { makeBlindSimulator, readBlindGoal } = require("./lib/blind-discovery-baseline");
const { compileAutomaticStages, runHierarchicalBlindPlanner } = require("./lib/hierarchical-blind-planner");
const { loadProject } = require("./lib/project-loader");

function main() {
  const project = loadProject(path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1"));
  const goal = readBlindGoal(path.resolve(__dirname, "blind-goals", "onlyup-mt5-blueking.json"));
  const simulator = makeBlindSimulator(project);
  const result = runHierarchicalBlindPlanner({
    project,
    simulator,
    initialState: simulator.createInitialState({ rank: goal.rank }),
    terminalGoal: goal.goal,
    towerId: goal.project,
    maxExpansions: 8,
  });
  assert.deepStrictEqual(
    compileAutomaticStages(result.graph).map((stage) => stage.goal.floorId),
    ["MT2", "MT3", "MT4", "MT5", "MT5"],
  );
  assert.strictEqual(result.inputContract.knownRouteUsed, false);
  assert.strictEqual(result.inputContract.milestoneUsed, false);
  assert.strictEqual(result.budget.consumedExpansions, 8);
  assert.strictEqual(result.found, false);
  assert.ok(result.stageResults.length >= 1);
  process.stdout.write(`${JSON.stringify({
    status: "passed",
    strategy: result.strategy,
    stages: result.stages.map((stage) => ({ id: stage.id, goal: stage.goal })),
    budget: result.budget,
    verdict: result.verdict,
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main };
