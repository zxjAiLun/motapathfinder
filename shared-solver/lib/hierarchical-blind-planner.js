"use strict";

const crypto = require("node:crypto");

const { buildAutomaticMacroGraph } = require("./automatic-macro-graph");
const { searchSegmentDP } = require("./segment-dp");
const { buildStateKey } = require("./state-key");

const SCHEMA = "motapathfinder.hierarchical-blind-planner.v1";

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function summarizeEntryState(state) {
  const hero = (state || {}).hero || {};
  return {
    floorId: (state || {}).floorId || null,
    hp: number(hero.hp, 0),
    atk: number(hero.atk, 0),
    def: number(hero.def, 0),
    mdef: number(hero.mdef, 0),
    lv: number(hero.lv, 0),
    exp: number(hero.exp, 0),
    equipment: Array.isArray(hero.equipment) ? hero.equipment.slice() : [],
    inventory: { ...((state || {}).inventory || {}) },
    decisionDepth: number(((state || {}).meta || {}).decisionDepth, 0),
  };
}

function stateFingerprint(state) {
  return crypto.createHash("sha256").update(buildStateKey(state)).digest("hex").slice(0, 16);
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

function runFailureTriggeredMacroBacktracking(options) {
  const config = options || {};
  const { project, simulator, initialState, terminalGoal } = config;
  if (!project || !simulator || !initialState || !terminalGoal) {
    throw new Error("Failure-triggered planner requires project, simulator, initialState, and terminalGoal");
  }
  const graph = config.graph || buildAutomaticMacroGraph(project, initialState, terminalGoal, {
    towerId: config.towerId || "blind-tower",
  });
  const stages = compileAutomaticStages(graph);
  const maxExpansions = Math.max(1, number(config.maxExpansions, 1000));
  const probeExpansions = Math.max(1, number(config.probeExpansions, 128));
  const alternativeCollectionExpansions = Math.max(0, number(config.alternativeCollectionExpansions, 32));
  const alternativeLimit = Math.max(1, number(config.alternativeLimit, 4));
  const alternativeProbeExpansions = Math.max(1, number(config.alternativeProbeExpansions, 32));
  const checkpointContinuationExpansions = Math.max(1, number(config.checkpointContinuationExpansions, 128));
  let remainingExpansions = maxExpansions;
  let current = {
    state: initialState,
    route: Array.isArray(initialState.route) ? initialState.route.slice() : [],
  };
  const history = [];
  const attempts = [];
  const executeStage = (stage, start, cap, phase) => {
    const effectiveCap = Math.max(0, Math.min(remainingExpansions, Math.floor(cap)));
    if (effectiveCap <= 0) return null;
    const result = searchSegmentDP(simulator, start.state, stage, {
      prefixRoute: start.route,
      candidateLimit: number(config.candidateLimit, 8),
      preserveSkylineRoles: true,
      dpPriorityMode: "goal-directed",
      dpOverrides: {
        maxExpansions: effectiveCap,
        maxRuntimeMs: 0,
        maxHeapMb: number(config.maxHeapMb, 2048),
        maxRssMb: number(config.maxRssMb, 0),
        goalSkylineLimit: number(config.goalSkylineLimit, 8),
        landmarkArchiveLimit: number(config.landmarkArchiveLimit, 16),
        dpSkylineMax: 1,
        stopOnFirstGoal: phase !== "collect-alternatives",
        maxExpansionsAfterFirstGoal: phase === "collect-alternatives"
          ? alternativeCollectionExpansions
          : null,
        priorityMode: "goal-directed",
      },
    });
    const dp = (result.diagnostics || {}).dp || {};
    const expansions = number(dp.expansions, 0);
    remainingExpansions = Math.max(0, remainingExpansions - expansions);
    attempts.push({
      phase,
      stageId: stage.id,
      startStateFingerprint: stateFingerprint(start.state),
      startState: summarizeEntryState(start.state),
      found: result.found,
      expansions,
      remainingExpansions,
      candidateCount: (result.goalSkyline || []).length,
      frontierSize: number(dp.frontierSize, 0),
      firstGoalExpansion: dp.firstGoalExpansion == null ? null : number(dp.firstGoalExpansion, 0),
      stoppedReason: dp.stoppedReason || null,
      bestProgressFloorId: (result.bestProgress || result.bestSeen || {}).floorId || null,
      maxDecisionDepth: number((((result.deepestExpanded || {}).meta || {}).decisionDepth), 0),
      landmarks: (result.landmarkArchive || []).map((landmark) => ({
        role: landmark.role,
        actionSummary: landmark.actionSummary,
        stateFingerprint: stateFingerprint(landmark.state),
        state: summarizeEntryState(landmark.state),
      })),
    });
    return result;
  };

  for (let stageIndex = 0; stageIndex < stages.length && remainingExpansions > 0; stageIndex += 1) {
    const stage = stages[stageIndex];
    const anchor = { state: current.state, route: current.route.slice() };
    const primaryCap = stageIndex < 2 ? remainingExpansions : Math.min(remainingExpansions, probeExpansions);
    let result = executeStage(stage, anchor, primaryCap, "primary");
    let winner = result && result.goalSkyline && result.goalSkyline[0];
    let selectedBy = "primary";
    if (!winner && stageIndex > 0 && remainingExpansions > 0) {
      const checkpointCandidates = (result.landmarkArchive || [])
        .filter((landmark) => landmark && landmark.state)
        .filter((landmark, index, list) => list.findIndex((candidate) =>
          stateFingerprint(candidate.state) === stateFingerprint(landmark.state)) === index)
        .slice(0, alternativeLimit);
      attempts[attempts.length - 1].checkpoints = checkpointCandidates.map((checkpoint, index) => ({
        index,
        role: checkpoint.role,
        actionSummary: checkpoint.actionSummary,
        stateFingerprint: stateFingerprint(checkpoint.state),
        state: summarizeEntryState(checkpoint.state),
      }));
      const checkpointProbes = [];
      for (let index = 0; index < checkpointCandidates.length && remainingExpansions > 0 && !winner; index += 1) {
        const checkpoint = checkpointCandidates[index];
        result = executeStage(stage, {
          state: checkpoint.state,
          route: Array.isArray(checkpoint.state.route) ? checkpoint.state.route.slice() : [],
        }, Math.min(alternativeProbeExpansions, remainingExpansions), "probe-checkpoint");
        const attempt = attempts[attempts.length - 1];
        attempt.checkpointIndex = index;
        attempt.checkpointRole = checkpoint.role;
        attempt.entryState = summarizeEntryState(checkpoint.state);
        winner = result && result.goalSkyline && result.goalSkyline[0];
        if (winner) {
          selectedBy = "failure-checkpoint-probe";
        } else if (result) {
          const bestState = result.deepestExpanded || result.bestProgress || result.bestSeen || checkpoint.state;
          checkpointProbes.push({
            checkpoint,
            bestState,
            route: Array.isArray(bestState.route) ? bestState.route.slice() : checkpoint.state.route || [],
            maxDecisionDepth: number(((bestState.meta || {}).decisionDepth), 0),
            hp: number(((bestState || {}).hero || {}).hp, 0),
            atk: number(((bestState || {}).hero || {}).atk, 0),
            def: number(((bestState || {}).hero || {}).def, 0),
            mdef: number(((bestState || {}).hero || {}).mdef, 0),
          });
        }
      }
      checkpointProbes.sort((left, right) =>
        right.maxDecisionDepth - left.maxDecisionDepth ||
        right.atk - left.atk ||
        right.def - left.def ||
        right.mdef - left.mdef ||
        right.hp - left.hp,
      );
      for (let index = 0; index < checkpointProbes.length && remainingExpansions > 0 && !winner; index += 1) {
        const selected = checkpointProbes[index];
        result = executeStage(stage, {
          state: selected.bestState,
          route: selected.route,
        }, Math.min(checkpointContinuationExpansions, remainingExpansions), "continue-checkpoint");
        const attempt = attempts[attempts.length - 1];
        attempt.checkpointRank = index;
        attempt.checkpointRole = selected.checkpoint.role;
        winner = result && result.goalSkyline && result.goalSkyline[0];
        if (winner) selectedBy = "failure-checkpoint-ranked";
      }
    }
    if (!winner && stageIndex > 0 && remainingExpansions > 0) {
      const previous = history[stageIndex - 1];
      const collectionCap = Math.min(
        remainingExpansions,
        Math.max(probeExpansions, previous.primaryExpansions + alternativeCollectionExpansions),
      );
      const collected = executeStage(previous.stage, previous.anchor, collectionCap, "collect-alternatives");
      const primaryKey = buildStateKey(previous.winner.state);
      const alternatives = (collected && collected.goalSkyline || [])
        .filter((candidate) => candidate && candidate.state && buildStateKey(candidate.state) !== primaryKey)
        .slice(0, alternativeLimit);
      const collectionAttempt = attempts[attempts.length - 1];
      collectionAttempt.alternatives = alternatives.map((candidate, index) => ({
        index,
        stateFingerprint: stateFingerprint(candidate.state),
        roles: Array.isArray(candidate.tags) ? candidate.tags.slice() : [],
        state: summarizeEntryState(candidate.state),
      }));
      const probes = [];
      for (let index = 0; index < alternatives.length && remainingExpansions > 0 && !winner; index += 1) {
        const candidate = alternatives[index];
        result = executeStage(stage, {
          state: candidate.state,
          route: Array.isArray(candidate.route) ? candidate.route.slice() : [],
        }, Math.min(alternativeProbeExpansions, remainingExpansions), "probe-alternative");
        attempts[attempts.length - 1].alternativeIndex = index;
        attempts[attempts.length - 1].entryState = summarizeEntryState(candidate.state);
        winner = result && result.goalSkyline && result.goalSkyline[0];
        if (winner) {
          previous.winner = candidate;
          previous.selectedBy = "downstream-probe";
          selectedBy = "previous-entry-alternative";
        } else if (result) {
          const bestState = result.deepestExpanded || result.bestProgress || result.bestSeen || candidate.state;
          probes.push({
            candidate,
            bestState,
            route: Array.isArray(bestState.route) ? bestState.route.slice() : candidate.route || [],
            maxDecisionDepth: number(((bestState.meta || {}).decisionDepth), 0),
            hp: number(((bestState || {}).hero || {}).hp, 0),
            atk: number(((bestState || {}).hero || {}).atk, 0),
            def: number(((bestState || {}).hero || {}).def, 0),
            mdef: number(((bestState || {}).hero || {}).mdef, 0),
          });
        }
      }
      if (!winner && probes.length > 0 && remainingExpansions > 0) {
        probes.sort((left, right) =>
          right.maxDecisionDepth - left.maxDecisionDepth ||
          right.atk - left.atk ||
          right.def - left.def ||
          right.mdef - left.mdef ||
          right.hp - left.hp,
        );
        const selected = probes[0];
        result = executeStage(stage, {
          state: selected.bestState,
          route: selected.route,
        }, remainingExpansions, "continue-best-probe");
        winner = result && result.goalSkyline && result.goalSkyline[0];
        if (winner) {
          previous.winner = selected.candidate;
          previous.selectedBy = "downstream-probe-ranked";
          selectedBy = "previous-entry-alternative-ranked";
        }
      }
    }
    if (!winner) break;
    const primaryAttempt = attempts.filter((attempt) =>
      attempt.phase === "primary" && attempt.stageId === stage.id).slice(-1)[0];
    history[stageIndex] = {
      stage,
      anchor,
      winner,
      primaryExpansions: primaryAttempt ? primaryAttempt.expansions : 0,
      selectedBy,
    };
    current = {
      state: winner.state,
      route: Array.isArray(winner.route) ? winner.route.slice() : [],
    };
    current.state.route = current.route.slice();
  }
  const found = history.length === stages.length;
  return {
    schema: SCHEMA,
    strategy: "failure-triggered-macro-backtracking-v1",
    inputContract: {
      knownRouteUsed: false,
      milestoneUsed: false,
      authoredResourceThresholdUsed: false,
      authoredEventOrderUsed: false,
    },
    graph,
    stages,
    attempts,
    history: history.map((entry) => ({
      stageId: entry.stage.id,
      selectedBy: entry.selectedBy,
      finalStateFingerprint: stateFingerprint(entry.winner.state),
      finalState: summarizeEntryState(entry.winner.state),
    })),
    found,
    finalState: found ? current.state : null,
    bestState: current.state,
    route: current.route,
    budget: {
      maxExpansions,
      consumedExpansions: maxExpansions - remainingExpansions,
      remainingExpansions,
      probeExpansions,
      alternativeCollectionExpansions,
      alternativeLimit,
      alternativeProbeExpansions,
      checkpointContinuationExpansions,
    },
    verdict: found
      ? "FAILURE_TRIGGERED_BLIND_GOAL_FOUND"
      : "FAILURE_TRIGGERED_BLIND_GOAL_NOT_FOUND_WITHIN_BUDGET",
  };
}

module.exports = {
  SCHEMA,
  compileAutomaticStages,
  runFailureTriggeredMacroBacktracking,
  runHierarchicalBlindPlanner,
  stateFingerprint,
  summarizeEntryState,
};
