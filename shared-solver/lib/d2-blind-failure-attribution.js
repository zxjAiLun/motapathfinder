"use strict";

const crypto = require("node:crypto");

const { buildAutomaticMacroGraph } = require("./automatic-macro-graph");
const { makeBlindSimulator } = require("./blind-discovery-baseline");
const { searchSegmentDP } = require("./segment-dp");
const { buildStateKey } = require("./state-key");

const SCHEMA = "motapathfinder.d2-blind-failure-attribution.v1";

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function increment(record, key, amount) {
  const normalized = key || "unknown";
  record[normalized] = number(record[normalized], 0) + number(amount, 1);
}

function stateFingerprint(state) {
  return crypto.createHash("sha256").update(buildStateKey(state)).digest("hex").slice(0, 16);
}

function summarizeState(state) {
  if (!state) return null;
  const hero = state.hero || {};
  return {
    floorId: state.floorId || null,
    hp: number(hero.hp, 0),
    atk: number(hero.atk, 0),
    def: number(hero.def, 0),
    mdef: number(hero.mdef, 0),
    lv: number(hero.lv, 0),
    exp: number(hero.exp, 0),
    equipment: Array.isArray(hero.equipment) ? hero.equipment.slice() : [],
    inventory: { ...(state.inventory || {}) },
    decisionDepth: number((state.meta || {}).decisionDepth, 0),
    exactStateFingerprint: stateFingerprint(state),
  };
}

function goalRankKey(rank) {
  const value = rank || {};
  return JSON.stringify({
    goalFeasible: value.goalFeasible == null ? null : value.goalFeasible,
    goalCompletion: value.goalCompletion == null ? null : value.goalCompletion,
    goalRequirementsMet: value.goalRequirementsMet == null ? null : value.goalRequirementsMet,
    goalRequirementsTotal: value.goalRequirementsTotal == null ? null : value.goalRequirementsTotal,
    goalFloorMatch: value.goalFloorMatch == null ? null : value.goalFloorMatch,
    finiteNextDistance: value.finiteNextDistance == null ? null : value.finiteNextDistance,
    nextDistance: value.nextDistance == null ? null : value.nextDistance,
  });
}

function createAttributionObserver() {
  const counters = {
    expandedByFloor: {},
    expandedByIncomingKind: {},
    expandedByIncomingSummary: {},
    generatedByKind: {},
    generatedBattleTargets: {},
    rejectionReasons: {},
    goalRankTuples: {},
    bossCandidatesGenerated: 0,
    equipmentCandidatesGenerated: 0,
    equipmentStatesExpanded: 0,
    maximumDecisionDepth: 0,
    maximumFrontierSize: 0,
  };
  return {
    counters,
    observer: {
      eventTypes: [
        "agendaPopped",
        "actionSetGenerated",
        "candidateGenerated",
        "candidateRejected",
        "goalAccepted",
        "budgetStopped",
      ],
      onEvent(event) {
        counters.maximumDecisionDepth = Math.max(
          counters.maximumDecisionDepth,
          number(event.decisionDepth, 0),
        );
        counters.maximumFrontierSize = Math.max(
          counters.maximumFrontierSize,
          number(event.frontierSize, event.agendaSize || 0),
        );
        if (event.eventType === "agendaPopped") {
          const action = event.action || {};
          increment(counters.expandedByFloor, event.floorId);
          increment(counters.expandedByIncomingKind, action.kind || "initial");
          if (action.summary) increment(counters.expandedByIncomingSummary, action.summary);
          if (action.kind === "equip") counters.equipmentStatesExpanded += 1;
          increment(counters.goalRankTuples, goalRankKey(event.agendaRank));
        }
        if (event.eventType === "candidateGenerated") {
          const action = event.action || {};
          increment(counters.generatedByKind, action.kind);
          if (action.kind === "battle" && action.summary) {
            increment(counters.generatedBattleTargets, action.summary);
          }
          if (action.summary === "battle:blueKing@MT5:6,7") counters.bossCandidatesGenerated += 1;
          if (action.kind === "equip" && String(action.summary || "").includes("I894")) {
            counters.equipmentCandidatesGenerated += 1;
          }
        }
        if (event.eventType === "candidateRejected") {
          increment(counters.rejectionReasons, event.reasonCode);
        }
      },
    },
  };
}

function graphCoverage(graph) {
  const bossId = graph.summary.targetPoiId;
  const equipment = graph.nodes.filter((node) => node.role === "equipment");
  const candidateResources = graph.nodes.filter((node) => [
    "equipment",
    "consumable-resource",
    "permanent-item",
    "key-or-tool",
  ].includes(node.role));
  const candidateCombat = graph.nodes.filter((node) => node.role === "combat-gate-candidate");
  const bossPrerequisiteEdges = graph.edges.filter((edge) =>
    edge.to === bossId && !["static-adjacency", "script-trigger"].includes(edge.kind));
  const resourceToBossEdges = graph.edges.filter((edge) =>
    edge.to === bossId && candidateResources.some((node) => node.id === edge.from));
  return {
    bossNodeId: bossId,
    equipmentCandidates: equipment.map((node) => ({
      nodeId: node.id,
      itemId: node.tileId,
      floorId: node.floorId,
      x: node.x,
      y: node.y,
    })),
    candidateResourceCount: candidateResources.length,
    candidateCombatCount: candidateCombat.length,
    bossPrerequisiteEdgeCount: bossPrerequisiteEdges.length,
    resourceToBossEdgeCount: resourceToBossEdges.length,
    terminalDependencyCompiled: bossPrerequisiteEdges.length > 0,
    dependencyCompleteness: graph.summary.dependencyCompleteness,
  };
}

function runFloorLocalControl(project, initialState, terminalGoal, maxExpansions) {
  const observed = createAttributionObserver();
  const startedAt = Date.now();
  const result = searchSegmentDP(makeBlindSimulator(project), initialState, {
    id: "d2-mt5-only-diagnostic-control",
    goal: { ...terminalGoal },
    actionPolicy: { allowedFloors: [initialState.floorId] },
    dp: {},
  }, {
    candidateLimit: 8,
    preserveSkylineRoles: true,
    dpPriorityMode: "goal-directed",
    observer: observed.observer,
    dpOverrides: {
      maxExpansions,
      maxRuntimeMs: 0,
      maxHeapMb: 2048,
      goalSkylineLimit: 8,
      stopOnFirstGoal: true,
      priorityMode: "goal-directed",
    },
  });
  const dp = (result.diagnostics || {}).dp || {};
  const outcome = result.searchOutcome || {};
  return {
    purpose: "diagnostic-control-only-not-planner-input",
    allowedFloors: [initialState.floorId],
    found: result.found,
    goalFound: Boolean(outcome.goalFound),
    frontierExhausted: Boolean(outcome.frontierExhausted),
    budgetExhausted: Boolean(outcome.budgetExhausted),
    searchComplete: Boolean(outcome.searchComplete),
    expansions: number(dp.expansions, 0),
    frontierSize: number(dp.frontierSize, 0),
    wallMs: Date.now() - startedAt,
    trace: observed.counters,
  };
}

function runD2BlindFailureAttribution(options) {
  const config = options || {};
  const { project, initialState, terminalGoal } = config;
  if (!project || !initialState || !terminalGoal) {
    throw new Error("D2 attribution requires project, initialState, and terminalGoal");
  }
  const maxExpansions = Math.max(1, number(config.maxExpansions, 1000));
  const simulator = config.simulator || makeBlindSimulator(project);
  const graph = buildAutomaticMacroGraph(project, initialState, terminalGoal, {
    towerId: config.towerId || "blind-tower",
  });
  const coverage = graphCoverage(graph);
  const observed = createAttributionObserver();
  const startedAt = Date.now();
  const result = searchSegmentDP(simulator, initialState, {
    id: "d2-blind-first-failure-attribution",
    goal: { ...terminalGoal },
    actionPolicy: {},
    dp: {},
  }, {
    candidateLimit: 8,
    preserveSkylineRoles: true,
    dpPriorityMode: "goal-directed",
    observer: observed.observer,
    dpOverrides: {
      maxExpansions,
      maxRuntimeMs: 0,
      maxHeapMb: 2048,
      goalSkylineLimit: 8,
      landmarkArchiveLimit: number(config.landmarkArchiveLimit, 24),
      stopOnFirstGoal: true,
      priorityMode: "goal-directed",
    },
  });
  const dp = (result.diagnostics || {}).dp || {};
  const outcome = result.searchOutcome || {};
  const landmarks = (result.landmarkArchive || []).map((landmark) => ({
    role: landmark.role,
    actionSummary: landmark.actionSummary,
    state: summarizeState(landmark.state),
  }));
  const i894Landmarks = landmarks.filter((landmark) =>
    String(landmark.actionSummary || "").includes("I894") ||
      ((landmark.state || {}).equipment || []).includes("I894"));
  const distinctGoalRankTupleCount = Object.keys(observed.counters.goalRankTuples).length;
  const floorLocalControl = runFloorLocalControl(
    project,
    initialState,
    terminalGoal,
    maxExpansions,
  );
  const graphFloors = new Set(graph.floorCorridor.floorIds);
  const expandedOutsideGraphFloors = Object.entries(observed.counters.expandedByFloor)
    .filter(([floorId, count]) => !graphFloors.has(floorId) && count > 0)
    .map(([floorId, count]) => ({ floorId, expansions: count }));
  const revisitExpansionCount = expandedOutsideGraphFloors
    .reduce((sum, entry) => sum + entry.expansions, 0);
  const planningEnvelopeOmission = expandedOutsideGraphFloors.length > 0 &&
    floorLocalControl.searchComplete && !floorLocalControl.goalFound;
  const runtimeShowsUsefulCandidate = i894Landmarks.length > 0 ||
    observed.counters.equipmentCandidatesGenerated > 0;
  const openBudgetSurface = !outcome.goalFound && !outcome.frontierExhausted &&
    outcome.budgetExhausted && !outcome.searchComplete;
  const missingDependencySignal = !coverage.terminalDependencyCompiled &&
    coverage.candidateResourceCount > 0 && coverage.candidateCombatCount > 0;
  return {
    schema: SCHEMA,
    inputContract: {
      allowedInputs: ["tower", "detached-mt5-entry-state", "terminal-boss-goal"],
      forbiddenInputs: [
        "route-fixture-as-search-input",
        "route-prefix",
        "intermediate-milestone",
        "authored-event-order",
        "authored-resource-threshold",
      ],
      checkpointHistoryDetached: Array.isArray(initialState.route) && initialState.route.length === 0 &&
        number((initialState.meta || {}).decisionDepth, 0) === 0,
      checkpointStateProvenance: config.checkpointStateProvenance || "caller-provided-detached-state",
      knownRouteUsedBySearch: false,
      actionPolicy: {},
      dpHints: {},
    },
    controls: {
      maxExpansions,
      maxRuntimeMs: 0,
      candidateLimit: 8,
      goalSkylineLimit: 8,
      priorityMode: "goal-directed",
      productionKeyChanged: false,
      productionDominanceChanged: false,
      productionSelectionChanged: false,
    },
    automaticGraph: {
      graphFingerprint: graph.graphFingerprint,
      floorCorridor: graph.floorCorridor,
      summary: graph.summary,
      coverage,
    },
    runtime: {
      startState: summarizeState(initialState),
      outcome: {
        found: result.found,
        goalFound: Boolean(outcome.goalFound),
        frontierExhausted: Boolean(outcome.frontierExhausted),
        budgetExhausted: Boolean(outcome.budgetExhausted),
        searchComplete: Boolean(outcome.searchComplete),
        expansions: number(dp.expansions, 0),
        frontierSize: number(dp.frontierSize, 0),
        stoppedReason: dp.stoppedReason || null,
        wallMs: Date.now() - startedAt,
        actionTrimmed: number(dp.actionTrimmed, 0),
      },
      trace: observed.counters,
      distinctGoalRankTupleCount,
      landmarks,
      i894Landmarks,
      deepestExpanded: summarizeState(result.deepestExpanded),
      bestProgress: summarizeState(result.bestProgress || result.bestSeen),
      floorLocalControl,
    },
    attribution: {
      openBudgetSurface,
      runtimeShowsUsefulCandidate,
      missingDependencySignal,
      planningEnvelopeOmission,
      expandedOutsideGraphFloors,
      revisitExpansionCount,
      revisitExpansionShare: number(dp.expansions, 0) > 0
        ? revisitExpansionCount / number(dp.expansions, 1)
        : 0,
      firstFailureSurface: planningEnvelopeOmission && missingDependencySignal && openBudgetSurface
        ? "AUTOMATIC_PLANNING_ENVELOPE_OMITS_REVISITABLE_PREREQUISITE_FLOORS"
        : "D2_FIRST_FAILURE_SURFACE_NOT_ISOLATED",
      excludedPrimaryCauses: {
        routeHistoryRequiredBySearch: false,
        actionTrimming: number(dp.actionTrimmed, 0) > 0,
        frontierExhaustion: Boolean(outcome.frontierExhausted),
        completedNoRouteProof: Boolean(outcome.searchComplete && !outcome.goalFound),
      },
      nextRepair: "expand the automatic graph to revisit-capable state-visible floors, then compile and execute simulator-validated boss-feasibility dependency subgoals",
    },
    verdict: planningEnvelopeOmission && missingDependencySignal && openBudgetSurface
      ? "D2_FIRST_FAILURE_ATTRIBUTED_TO_INCOMPLETE_AUTOMATIC_PLANNING_ENVELOPE"
      : "D2_ATTRIBUTION_OPEN",
  };
}

module.exports = {
  SCHEMA,
  createAttributionObserver,
  graphCoverage,
  runFloorLocalControl,
  runD2BlindFailureAttribution,
  summarizeState,
};
