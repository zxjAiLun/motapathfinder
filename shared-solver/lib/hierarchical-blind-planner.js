"use strict";

const { buildAutomaticMacroGraph } = require("./automatic-macro-graph");
const { searchSegmentDP } = require("./segment-dp");

const SCHEMA = "motapathfinder.hierarchical-blind-planner.v1";

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function compileAutomaticStages(graph) {
  const floorIds = ((graph || {}).floorCorridor || {}).floorIds || [];
  if (floorIds.length === 0) throw new Error("Hierarchical planner requires a non-empty automatic floor corridor");
  const stages = floorIds.slice(1).map((floorId, index) => ({
    id: `auto-floor-entry-${index + 1}-${floorId}`,
    kind: "floor-entry",
    provenance: "automatic-macro-graph.floorCorridor",
    goal: { floorId },
    actionPolicy: {},
    dp: {},
  }));
  stages.push({
    id: "auto-terminal-goal",
    kind: "terminal-goal",
    provenance: "blind-terminal-goal",
    goal: { ...graph.source.target },
    actionPolicy: {},
    dp: {},
  });
  return stages;
}

function runHierarchicalBlindPlanner(options) {
  const config = options || {};
  const { project, simulator, initialState, terminalGoal } = config;
  if (!project || !simulator || !initialState || !terminalGoal) {
    throw new Error("Hierarchical planner requires project, simulator, initialState, and terminalGoal");
  }
  const graph = config.graph || buildAutomaticMacroGraph(project, initialState, terminalGoal, {
    towerId: config.towerId || "blind-tower",
  });
  const stages = compileAutomaticStages(graph);
  const maxExpansions = Math.max(1, number(config.maxExpansions, 1000));
  let remainingExpansions = maxExpansions;
  let state = initialState;
  let route = Array.isArray(initialState.route) ? initialState.route.slice() : [];
  const stageResults = [];
  for (const stage of stages) {
    if (remainingExpansions <= 0) break;
    const result = searchSegmentDP(simulator, state, stage, {
      prefixRoute: route,
      candidateLimit: number(config.candidateLimit, 8),
      preserveSkylineRoles: true,
      dpPriorityMode: "goal-directed",
      observer: config.observer || null,
      dpOverrides: {
        maxExpansions: remainingExpansions,
        maxRuntimeMs: 0,
        maxHeapMb: number(config.maxHeapMb, 2048),
        maxRssMb: number(config.maxRssMb, 0),
        goalSkylineLimit: number(config.goalSkylineLimit, 8),
        stopOnFirstGoal: true,
        priorityMode: "goal-directed",
      },
    });
    const dp = (result.diagnostics || {}).dp || {};
    const expansions = number(dp.expansions, 0);
    remainingExpansions = Math.max(0, remainingExpansions - expansions);
    const winner = result.goalSkyline && result.goalSkyline[0];
    stageResults.push({
      stageId: stage.id,
      kind: stage.kind,
      goal: stage.goal,
      found: result.found,
      expansions,
      remainingExpansions,
      frontierSize: number(dp.frontierSize, 0),
      generated: number(dp.generated, 0),
      acceptedStates: number(dp.acceptedStates, 0),
      candidateCount: (result.goalSkyline || []).length,
      stoppedReason: dp.stoppedReason || null,
      bestProgress: result.bestProgress || result.bestSeen || null,
    });
    if (!winner) break;
    state = winner.state;
    route = Array.isArray(winner.route) ? winner.route.slice() : route;
    state.route = route.slice();
  }
  const finalStage = stageResults[stageResults.length - 1] || null;
  const found = stageResults.length === stages.length && finalStage && finalStage.found;
  return {
    schema: SCHEMA,
    strategy: "automatic-floor-corridor-first-feasible-v1",
    inputContract: {
      knownRouteUsed: false,
      milestoneUsed: false,
      authoredResourceThresholdUsed: false,
      authoredEventOrderUsed: false,
    },
    graph,
    stages,
    stageResults,
    found: Boolean(found),
    finalState: found ? state : null,
    bestState: state,
    route,
    budget: {
      maxExpansions,
      consumedExpansions: maxExpansions - remainingExpansions,
      remainingExpansions,
    },
    verdict: found
      ? "HIERARCHICAL_BLIND_GOAL_FOUND"
      : "HIERARCHICAL_BLIND_GOAL_NOT_FOUND_WITHIN_BUDGET",
  };
}

module.exports = {
  SCHEMA,
  compileAutomaticStages,
  runHierarchicalBlindPlanner,
};
