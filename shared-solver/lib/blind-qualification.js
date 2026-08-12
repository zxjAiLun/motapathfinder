"use strict";

const path = require("node:path");

const { strictReplayRoute } = require("./agenda-policy-evaluation");
const { makeBlindSimulator } = require("./blind-discovery-baseline");
const { runFailureTriggeredMacroBacktracking } = require("./hierarchical-blind-planner");
const { buildRouteRecord } = require("./route-store");
const { searchSegmentDP } = require("./segment-dp");

const SCHEMA = "motapathfinder.blind-qualification.v1";

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildStrictReplayEvidence(project, simulatorFactory, projectRoot, grade, initialState, finalState, route) {
  if (!finalState) return null;
  const replayState = finalState;
  replayState.route = Array.isArray(route) ? route.slice() : [];
  const routeRecord = buildRouteRecord({
    project,
    simulator: simulatorFactory(),
    initialState,
    finalState: replayState,
    options: {
      projectRoot,
      solver: "blind-qualification",
      profile: grade,
      rank: "chaos",
      toFloor: replayState.floorId,
      goalType: `${grade}-qualification`,
      snapshotFloors: Object.keys(replayState.visitedFloors || {}),
      metadata: { grade },
    },
  });
  const replay = strictReplayRoute(project, simulatorFactory(), routeRecord);
  return {
    valid: replay.valid,
    stepsAttempted: replay.stepsAttempted,
    stepsCompleted: replay.stepsCompleted,
    failureReason: replay.failureReason || null,
  };
}

function searchOutcome(result) {
  const outcome = (result || {}).searchOutcome || {};
  return {
    found: Boolean(result && result.found),
    goalFound: Boolean(outcome.goalFound),
    frontierExhausted: Boolean(outcome.frontierExhausted),
    budgetExhausted: Boolean(outcome.budgetExhausted),
    searchComplete: Boolean(outcome.searchComplete),
  };
}

function runBlindSegment(project, projectRoot, initialState, grade, goal, maxExpansions) {
  const simulatorFactory = () => makeBlindSimulator(project);
  const startedAt = Date.now();
  const result = searchSegmentDP(simulatorFactory(), initialState, {
    id: `blind-qualification-${grade.toLowerCase()}`,
    goal: { ...goal },
    actionPolicy: {},
    dp: {},
  }, {
    candidateLimit: 8,
    preserveSkylineRoles: true,
    dpPriorityMode: "goal-directed",
    dpOverrides: {
      maxExpansions,
      maxRuntimeMs: 0,
      maxHeapMb: 2048,
      goalSkylineLimit: 8,
      stopOnFirstGoal: true,
      priorityMode: "goal-directed",
    },
  });
  const winner = result.goalSkyline && result.goalSkyline[0];
  const prefixLength = Array.isArray(initialState.route) ? initialState.route.length : 0;
  const suffixRoute = winner && Array.isArray(winner.route)
    ? winner.route.slice(prefixLength)
    : [];
  const replay = winner
    ? buildStrictReplayEvidence(
      project,
      simulatorFactory,
      projectRoot,
      grade,
      initialState,
      winner.state,
      suffixRoute,
    )
    : null;
  const dp = (result.diagnostics || {}).dp || {};
  return {
    grade,
    inputContract: grade === "D1"
      ? ["tower", "local-start-state", "local-terminal-goal"]
      : ["tower", "floor-entry-state", "floor-boss-goal"],
    maxExpansions,
    ...searchOutcome(result),
    expansions: number(dp.expansions, 0),
    frontierSize: number(dp.frontierSize, 0),
    stoppedReason: dp.stoppedReason || null,
    wallMs: Date.now() - startedAt,
    strictReplay: replay,
    passed: Boolean(result.found && replay && replay.valid),
  };
}

function runBlindQualification(options) {
  const config = options || {};
  const { project, projectRoot, knownInitialState, knownFinalState, d1StartState, d2StartState, d3InitialState, terminalGoal } = config;
  if (!project || !projectRoot || !knownInitialState || !knownFinalState || !d1StartState || !d2StartState || !d3InitialState || !terminalGoal) {
    throw new Error("Blind qualification requires project, projectRoot, D0 states, D1/D2/D3 starts, and terminalGoal");
  }
  const simulatorFactory = () => makeBlindSimulator(project);
  const d0 = {
    grade: "D0",
    inputContract: ["tower", "known-route"],
    found: true,
    strictReplay: buildStrictReplayEvidence(
      project,
      simulatorFactory,
      path.resolve(projectRoot),
      "D0",
      knownInitialState,
      knownFinalState,
      knownFinalState.route,
    ),
  };
  d0.passed = Boolean(d0.strictReplay && d0.strictReplay.valid);
  const d1 = runBlindSegment(
    project,
    projectRoot,
    d1StartState,
    "D1",
    { floorId: "MT3" },
    number(config.d1MaxExpansions, 600),
  );
  const d2 = runBlindSegment(
    project,
    projectRoot,
    d2StartState,
    "D2",
    terminalGoal,
    number(config.d2MaxExpansions, 1000),
  );
  const d3StartedAt = Date.now();
  const d3Result = runFailureTriggeredMacroBacktracking({
    project,
    simulator: simulatorFactory(),
    initialState: d3InitialState,
    terminalGoal,
    towerId: config.towerId || "blind-tower",
    maxExpansions: number(config.d3MaxExpansions, 1000),
  });
  const d3WallMs = Date.now() - d3StartedAt;
  const d3Replay = d3Result.found
    ? buildStrictReplayEvidence(
      project,
      simulatorFactory,
      projectRoot,
      "D3",
      d3InitialState,
      d3Result.finalState,
      d3Result.route,
    )
    : null;
  const terminalAttempt = d3Result.attempts[d3Result.attempts.length - 1] || null;
  const d3FrontierExhausted = Boolean(
    !d3Result.found &&
    d3Result.budget.remainingExpansions > 0 &&
    terminalAttempt &&
    terminalAttempt.frontierSize === 0,
  );
  const d3 = {
    grade: "D3",
    inputContract: ["tower", "canonical-initial-state", "terminal-boss-goal"],
    maxExpansions: number(config.d3MaxExpansions, 1000),
    found: d3Result.found,
    goalFound: d3Result.found,
    frontierExhausted: d3FrontierExhausted,
    budgetExhausted: !d3Result.found && d3Result.budget.remainingExpansions === 0,
    searchComplete: d3FrontierExhausted,
    consumedExpansions: d3Result.budget.consumedExpansions,
    remainingExpansions: d3Result.budget.remainingExpansions,
    bestFloorId: (d3Result.bestState || {}).floorId || null,
    wallMs: d3WallMs,
    strictReplay: d3Replay,
    passed: Boolean(d3Result.found && d3Replay && d3Replay.valid),
    plannerVerdict: d3Result.verdict,
  };
  const levels = [d0, d1, d2, d3];
  const baselineD3 = config.baselineD3 || null;
  const d3Comparison = baselineD3 ? {
    before: { ...baselineD3 },
    after: {
      found: d3.found,
      maxExpansions: d3.maxExpansions,
      bestFloorId: d3.bestFloorId,
      wallMs: d3.wallMs,
    },
    sameExpansionBudget: number(baselineD3.maxExpansions, 0) === d3.maxExpansions,
    correctnessOutcomeImproved: Boolean(
      (!baselineD3.found && d3.found) || baselineD3.bestFloorId !== d3.bestFloorId,
    ),
    wallMsChangePercent: number(baselineD3.wallMs, 0) > 0
      ? Number((((d3.wallMs / number(baselineD3.wallMs, 1)) - 1) * 100).toFixed(1))
      : null,
    timingIsDirectional: true,
  } : null;
  return {
    schema: SCHEMA,
    levels,
    comparison: d3Comparison,
    autonomousDiscoveryVerified: d2.passed && d3.passed,
    verdict: d2.passed && d3.passed
      ? "AUTONOMOUS_DISCOVERY_D2_D3_VERIFIED"
      : "EXECUTION_AND_LOCAL_DISCOVERY_VERIFIED_AUTONOMOUS_DISCOVERY_OPEN",
  };
}

module.exports = {
  SCHEMA,
  runBlindQualification,
};
