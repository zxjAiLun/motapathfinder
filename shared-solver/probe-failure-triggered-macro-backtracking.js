"use strict";

const path = require("node:path");

const { makeBlindSimulator, readBlindGoal } = require("./lib/blind-discovery-baseline");
const { runFailureTriggeredMacroBacktracking } = require("./lib/hierarchical-blind-planner");
const { loadProject } = require("./lib/project-loader");

const project = loadProject(path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1"));
const goal = readBlindGoal(path.resolve(__dirname, "blind-goals", "onlyup-mt5-blueking.json"));
const simulator = makeBlindSimulator(project);
const result = runFailureTriggeredMacroBacktracking({
  project,
  simulator,
  initialState: simulator.createInitialState({ rank: goal.rank }),
  terminalGoal: goal.goal,
  towerId: goal.project,
  maxExpansions: Number(process.env.MACRO_MAX_EXPANSIONS || 1000),
  candidateLimit: Number(process.env.MACRO_CANDIDATE_LIMIT || 8),
  goalSkylineLimit: Number(process.env.MACRO_GOAL_SKYLINE_LIMIT || 8),
  landmarkArchiveLimit: Number(process.env.MACRO_LANDMARK_LIMIT || 16),
  probeExpansions: Number(process.env.MACRO_PROBE_EXPANSIONS || 128),
  alternativeCollectionExpansions: Number(process.env.MACRO_ALT_COLLECTION || 32),
  alternativeLimit: Number(process.env.MACRO_ALT_LIMIT || 4),
  alternativeProbeExpansions: Number(process.env.MACRO_ALT_PROBE || 32),
  checkpointContinuationExpansions: Number(process.env.MACRO_CHECKPOINT_CONTINUE || 128),
});
process.stdout.write(`${JSON.stringify({
  verdict: result.verdict,
  budget: result.budget,
  attempts: result.attempts.map((attempt) => ({
    phase: attempt.phase,
    stageId: attempt.stageId,
    found: attempt.found,
    expansions: attempt.expansions,
    candidateCount: attempt.candidateCount,
    frontierSize: attempt.frontierSize,
    remainingExpansions: attempt.remainingExpansions,
    bestProgressFloorId: attempt.bestProgressFloorId,
    maxDecisionDepth: attempt.maxDecisionDepth,
    alternativeIndex: attempt.alternativeIndex == null ? null : attempt.alternativeIndex,
    checkpointIndex: attempt.checkpointIndex == null ? null : attempt.checkpointIndex,
    checkpointRank: attempt.checkpointRank == null ? null : attempt.checkpointRank,
    checkpointRole: attempt.checkpointRole || null,
    entryState: attempt.entryState || null,
    alternatives: attempt.alternatives || null,
    checkpoints: attempt.checkpoints || null,
    landmarks: attempt.landmarks || null,
  })),
  history: result.history,
  bestFloorId: (result.bestState || {}).floorId || null,
  routeLength: result.route.length,
}, null, 2)}\n`);
