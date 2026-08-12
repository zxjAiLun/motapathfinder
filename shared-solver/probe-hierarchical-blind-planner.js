"use strict";

const path = require("node:path");

const { makeBlindSimulator, readBlindGoal } = require("./lib/blind-discovery-baseline");
const { runHierarchicalBlindPlanner } = require("./lib/hierarchical-blind-planner");
const { loadProject } = require("./lib/project-loader");

const projectRoot = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const goal = readBlindGoal(path.resolve(__dirname, "blind-goals", "onlyup-mt5-blueking.json"));
const project = loadProject(projectRoot);
const simulator = makeBlindSimulator(project);
const result = runHierarchicalBlindPlanner({
  project,
  simulator,
  initialState: simulator.createInitialState({ rank: goal.rank }),
  terminalGoal: goal.goal,
  towerId: goal.project,
  maxExpansions: 1000,
});
process.stdout.write(`${JSON.stringify({
  verdict: result.verdict,
  budget: result.budget,
  stages: result.stageResults.map((stage) => ({
    stageId: stage.stageId,
    found: stage.found,
    expansions: stage.expansions,
    remainingExpansions: stage.remainingExpansions,
    frontierSize: stage.frontierSize,
    acceptedStates: stage.acceptedStates,
    candidateCount: stage.candidateCount,
  })),
  finalFloorId: (result.bestState || {}).floorId || null,
  routeLength: result.route.length,
}, null, 2)}\n`);
