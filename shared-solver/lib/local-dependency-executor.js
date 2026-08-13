"use strict";

const crypto = require("node:crypto");

const { strictReplayRoute } = require("./agenda-policy-evaluation");
const { makeBlindSimulator } = require("./blind-discovery-baseline");
const { buildRouteRecord } = require("./route-store");
const { searchSegmentDP } = require("./segment-dp");
const { cloneState } = require("./state");
const { buildStateKey } = require("./state-key");

const SCHEMA = "motapathfinder.local-dependency-execution.v1";

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}

function stateFingerprint(state) {
  return hash(buildStateKey(state));
}

function selectExecutablePrerequisite(dependencyPlan) {
  for (const alternative of dependencyPlan.alternatives || []) {
    const prerequisite = (alternative.prerequisites || [])[0];
    if (prerequisite && ((prerequisite.evidence || {}).status) === "viable-at-current-state") {
      return { alternative, prerequisite };
    }
  }
  return null;
}

function materializeDirectTargetPlan(dependencyPlan, subgoal) {
  const direct = (dependencyPlan.alternatives || []).find((alternative) =>
    (alternative.prerequisites || []).length === 0);
  if (!direct || !subgoal || !subgoal.goal) return dependencyPlan;
  return {
    ...dependencyPlan,
    alternatives: [
      {
        ...direct,
        prerequisites: [{
          id: `execute-${subgoal.sourceNodeId || subgoal.id}`,
          kind: "target",
          relation: "AND",
          order: 0,
          sourceNodeId: subgoal.sourceNodeId || subgoal.id,
          actionGoal: { ...subgoal.goal },
          target: { ...(subgoal.target || {}) },
          evidence: {
            kind: "topology-target-reachability",
            status: "viable-at-current-state",
            reason: "dependency-alternative-has-no-unresolved-prerequisite",
          },
          provenance: "automatic-dependency-plan-direct-target",
        }],
      },
      ...(dependencyPlan.alternatives || []).filter((alternative) => alternative !== direct),
    ],
  };
}

function compactHero(state) {
  const hero = (state || {}).hero || {};
  return {
    hp: number(hero.hp, 0),
    atk: number(hero.atk, 0),
    def: number(hero.def, 0),
    mdef: number(hero.mdef, 0),
    lv: number(hero.lv, 0),
    exp: number(hero.exp, 0),
    equipment: Array.isArray(hero.equipment) ? hero.equipment.slice() : [],
  };
}

function compactProgressState(state) {
  if (!state) return null;
  const route = Array.isArray(state.route) ? state.route : [];
  return {
    floorId: state.floorId || null,
    hero: compactHero(state),
    routeLength: route.length,
    lastDecisions: route.slice(-6).map((entry) => entry.summary),
  };
}

function semanticSignature(record) {
  const state = record.state || {};
  return JSON.stringify({
    floorId: state.floorId || null,
    hero: compactHero(state),
    inventory: state.inventory || {},
  });
}

function incrementalRoute(initialState, candidate) {
  const before = Array.isArray(initialState.route) ? initialState.route : [];
  const after = Array.isArray(candidate.route) ? candidate.route : [];
  if (before.length === 0) return after.slice();
  const retainsPrefix = before.every((entry, index) =>
    JSON.stringify(entry) === JSON.stringify(after[index]));
  return retainsPrefix ? after.slice(before.length) : after.slice();
}

function checkpointRecord(
  project,
  projectRoot,
  initialState,
  candidate,
  target,
  goal,
  index,
  sharedSimulator,
  makeSimulator,
  reuseSimulator,
) {
  const finalState = candidate.state;
  finalState.route = Array.isArray(candidate.route) ? candidate.route.slice() : [];
  const recordFinalState = cloneState(finalState);
  recordFinalState.route = incrementalRoute(initialState, candidate);
  const simulator = reuseSimulator ? sharedSimulator : makeSimulator();
  const routeRecord = buildRouteRecord({
    project,
    simulator,
    initialState,
    finalState: recordFinalState,
    options: {
      projectRoot,
      solver: "local-dependency-executor",
      profile: "automatic-prerequisite-multi-role",
      rank: ((initialState.meta || {}).rank) || "chaos",
      toFloor: target.floorId,
      goalType: (goal || {}).type || "automatic",
      snapshotFloors: Object.keys(initialState.visitedFloors || {}),
      metadata: {
        target,
        candidateIndex: index,
        roles: (candidate.tags || []).slice(),
        allowedInputs: ["tower", "route-free-current-state", "automatic-dependency-prerequisite"],
      },
    },
  });
  const replaySimulator = reuseSimulator ? sharedSimulator : makeSimulator();
  const replay = strictReplayRoute(project, replaySimulator, routeRecord);
  return {
    id: `checkpoint-${index + 1}`,
    roles: (candidate.tags || []).slice().sort(),
    exactStateFingerprint: stateFingerprint(finalState),
    routeFingerprint: hash(JSON.stringify(routeRecord.decisions.map((decision) => decision.summary))),
    decisionCount: routeRecord.decisions.length,
    hero: compactHero(finalState),
    floorId: finalState.floorId || null,
    semanticSignature: semanticSignature(candidate),
    replay: {
      valid: Boolean(replay.valid),
      stepsAttempted: number(replay.stepsAttempted, 0),
      stepsCompleted: number(replay.stepsCompleted, 0),
      failureReason: replay.failureReason || null,
    },
    state: finalState,
    routeRecord,
  };
}

function executeLocalDependency(project, projectRoot, initialState, dependencyPlan, options) {
  if (!project || !initialState || !dependencyPlan) {
    throw new Error("Local dependency executor requires project, initialState, and dependencyPlan");
  }
  const selected = selectExecutablePrerequisite(dependencyPlan);
  if (!selected) {
    return {
      schema: SCHEMA,
      inputContract: {
        inputs: ["tower-project", "route-free-current-state", "automatic-dependency-plan"],
        forbidden: ["route-fixture", "route-prefix", "authored-milestone", "authored-event-order", "authored-resource-threshold"],
        knownRouteUsed: false,
      },
      selected: null,
      outcome: { goalFound: false, searchComplete: true, reason: "no-currently-viable-prerequisite" },
      checkpoints: [],
      verdict: "NO_CURRENTLY_VIABLE_DEPENDENCY_PREREQUISITE",
    };
  }
  const config = options || {};
  const maxExpansions = Math.max(1, number(config.maxExpansions, 64));
  const candidateLimit = Math.max(2, number(config.candidateLimit, 8));
  let simulatorInstanceCount = 0;
  const simulatorFactory = typeof config.simulatorFactory === "function"
    ? config.simulatorFactory
    : () => makeBlindSimulator(project);
  const makeSimulator = () => {
    simulatorInstanceCount += 1;
    return simulatorFactory();
  };
  const simulator = makeSimulator();
  const reuseCheckpointSimulator = config.reuseCheckpointSimulator !== false;
  const segment = {
    id: `auto-local-${selected.alternative.id}-${selected.prerequisite.sourceNodeId}`,
    label: "Automatically compiled local dependency prerequisite",
    goal: { ...selected.prerequisite.actionGoal },
    actionPolicy: {},
    dp: {},
  };
  const startedAt = Date.now();
  const result = searchSegmentDP(simulator, initialState, segment, {
    candidateLimit,
    preserveSkylineRoles: true,
    preserveFirstGoalCheckpoint: true,
    dpPriorityMode: "goal-directed",
    dpOverrides: {
      maxExpansions,
      maxRuntimeMs: 0,
      maxHeapMb: number(config.maxHeapMb, 2048),
      goalSkylineLimit: candidateLimit,
      landmarkArchiveLimit: 0,
      stopOnFirstGoal: false,
      preserveGoalArchive: true,
      priorityMode: "goal-directed",
    },
  });
  const searchedAt = Date.now();
  const dp = (result.diagnostics || {}).dp || {};
  const goalCandidates = result.goalSkyline || [];
  const bestProgressImproved = result.bestProgress && (
    number((result.bestProgress.hero || {}).lv, 0) > number((initialState.hero || {}).lv, 0) ||
    (number((result.bestProgress.hero || {}).lv, 0) === number((initialState.hero || {}).lv, 0) &&
      number((result.bestProgress.hero || {}).exp, 0) > number((initialState.hero || {}).exp, 0))
  );
  const retainedCandidates = goalCandidates.length === 0 &&
      config.retainBestProgressOnFailure === true &&
      bestProgressImproved
    ? [{
        state: result.bestProgress,
        route: Array.isArray(result.bestProgress.route) ? result.bestProgress.route : [],
        tags: ["best-progress"],
      }]
    : goalCandidates;
  const retainedBestProgress = goalCandidates.length === 0 && retainedCandidates.length > 0;
  const checkpoints = retainedCandidates.map((candidate, index) =>
    checkpointRecord(
      project,
      projectRoot,
      initialState,
      candidate,
      selected.prerequisite.target,
      segment.goal,
      index,
      simulator,
      makeSimulator,
      reuseCheckpointSimulator,
    ));
  const completedAt = Date.now();
  const exactStateCount = new Set(checkpoints.map((checkpoint) => checkpoint.exactStateFingerprint)).size;
  const semanticStateCount = new Set(checkpoints.map((checkpoint) => checkpoint.semanticSignature)).size;
  const routeCount = new Set(checkpoints.map((checkpoint) => checkpoint.routeFingerprint)).size;
  const roles = Array.from(new Set(checkpoints.flatMap((checkpoint) => checkpoint.roles))).sort();
  const allStrictReplay = checkpoints.length > 0 && checkpoints.every((checkpoint) => checkpoint.replay.valid);
  return {
    schema: SCHEMA,
    inputContract: {
      inputs: ["tower-project", "route-free-current-state", "automatic-dependency-plan"],
      forbidden: ["route-fixture", "route-prefix", "authored-milestone", "authored-event-order", "authored-resource-threshold"],
      knownRouteUsed: false,
      authoredGoalUsed: false,
    },
    selected: {
      alternativeId: selected.alternative.id,
      prerequisite: selected.prerequisite,
      selection: "first-ranked-alternative-with-viable-leading-prerequisite",
    },
    controls: {
      maxExpansions,
      maxRuntimeMs: 0,
      candidateLimit,
      stopOnFirstGoal: false,
      productionKeyChanged: false,
      productionDominanceChanged: false,
      productionSelectionChanged: false,
      reuseCheckpointSimulator,
      retainBestProgressOnFailure: config.retainBestProgressOnFailure === true,
      simulatorInstanceCount,
    },
    outcome: {
      found: Boolean(result.found),
      goalFound: Boolean((result.searchOutcome || {}).goalFound),
      frontierExhausted: Boolean((result.searchOutcome || {}).frontierExhausted),
      budgetExhausted: Boolean((result.searchOutcome || {}).budgetExhausted),
      searchComplete: Boolean((result.searchOutcome || {}).searchComplete),
      expansions: number(dp.expansions, 0),
      firstGoalExpansion: dp.firstGoalExpansion == null ? null : number(dp.firstGoalExpansion, 0),
      generated: Object.values(dp.actionsExpandedByKind || {}).reduce((sum, count) => sum + number(count, 0), 0),
      accepted: Math.max(0, number(dp.acceptedStates, 0) - 1),
      rejected: Object.values(dp.actionsDominatedByKind || {}).reduce((sum, count) => sum + number(count, 0), 0),
      frontierSize: number(dp.frontierSize, 0),
      wallMs: completedAt - startedAt,
      timing: {
        searchMs: searchedAt - startedAt,
        checkpointReplayMs: completedAt - searchedAt,
        totalWallMs: completedAt - startedAt,
      },
      rawGoalCandidateCount: number(dp.goalNodeCount, number(((result.goalSkyline || {}).goalArchiveCandidateCount), 0)),
      retainedCheckpointCount: checkpoints.length,
      retainedBestProgress,
      bestProgress: compactProgressState(result.bestProgress || result.bestSeen),
    },
    checkpointDiversity: {
      roles,
      roleCount: roles.length,
      exactStateCount,
      semanticStateCount,
      routeCount,
      allStrictReplay,
      distinctStrategicOutcomes: semanticStateCount >= 2 && roles.length >= 2,
    },
    checkpoints,
    verdict: result.found && allStrictReplay && semanticStateCount >= 2 && roles.length >= 2
      ? "LOCAL_DEPENDENCY_MULTI_ROLE_CHECKPOINTS_VERIFIED"
      : result.found && allStrictReplay
        ? "LOCAL_DEPENDENCY_SINGLE_ROLE_CHECKPOINT_VERIFIED"
        : "LOCAL_DEPENDENCY_EXECUTION_OPEN",
  };
}

module.exports = {
  SCHEMA,
  executeLocalDependency,
  materializeDirectTargetPlan,
  selectExecutablePrerequisite,
  stateFingerprint,
};
