"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const { FunctionBackedBattleResolver } = require("./battle-resolver");
const { loadProject } = require("./project-loader");
const { strictReplayRoute } = require("./agenda-policy-evaluation");
const { buildRouteRecord } = require("./route-store");
const { searchSegmentDP } = require("./segment-dp");
const { StaticSimulator } = require("./simulator");
const { buildStateKey } = require("./state-key");

const SCHEMA = "motapathfinder.blind-discovery-baseline.v1";
const GOAL_SCHEMA = "motapathfinder.blind-goal.v1";
const ALLOWED_TOP_LEVEL_KEYS = new Set(["schema", "id", "project", "rank", "goal"]);
const ALLOWED_GOAL_KEYS = new Set(["type", "floorId", "x", "y", "enemyId"]);
const FORBIDDEN_SERIALIZED_KEYS = [
  "route",
  "fixture",
  "milestone",
  "startFrom",
  "minHero",
  "presentTiles",
  "removedTiles",
  "preferredPresentTiles",
  "allowedFloors",
  "allowChangeFloors",
  "region",
  "priorityMode",
];

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function assertAllowedKeys(value, allowed, label) {
  for (const key of Object.keys(value || {})) {
    if (!allowed.has(key)) throw new Error(`${label} contains forbidden field: ${key}`);
  }
}

function validateBlindGoal(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Blind goal must be an object");
  }
  assertAllowedKeys(value, ALLOWED_TOP_LEVEL_KEYS, "blind goal");
  if (value.schema !== GOAL_SCHEMA) throw new Error(`Unsupported blind goal schema: ${value.schema}`);
  if (!value.id || !value.project || !value.rank) {
    throw new Error("Blind goal requires id/project/rank");
  }
  const goal = value.goal;
  if (!goal || typeof goal !== "object" || Array.isArray(goal)) {
    throw new Error("Blind goal requires goal object");
  }
  assertAllowedKeys(goal, ALLOWED_GOAL_KEYS, "blind goal.goal");
  if (goal.type !== "bossDefeated") throw new Error("Blind baseline v1 supports bossDefeated only");
  if (!goal.floorId || goal.x == null || goal.y == null || !goal.enemyId) {
    throw new Error("bossDefeated requires floorId/x/y/enemyId");
  }
  const serialized = JSON.stringify(value);
  for (const forbidden of FORBIDDEN_SERIALIZED_KEYS) {
    if (serialized.includes(`\"${forbidden}\"`)) {
      throw new Error(`Blind goal leaks forbidden planning input: ${forbidden}`);
    }
  }
  return value;
}

function readBlindGoal(filePath) {
  return validateBlindGoal(JSON.parse(fs.readFileSync(filePath, "utf8")));
}

function makeBlindSimulator(project, options) {
  const config = options || {};
  return new StaticSimulator(project, {
    stopFloorId: config.stopFloorId || "MT11",
    battleResolver: new FunctionBackedBattleResolver(project),
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFightToLevelUp: false,
    enableResourcePocket: false,
    enableResourceCluster: false,
    enableResourceChain: false,
    searchGraphMode: "primitive",
    walkReachabilityMode: "safe-fast",
  });
}

function floorRank(project, floorId) {
  const index = (project.floorOrder || []).indexOf(floorId);
  return index < 0 ? -1 : index;
}

function createBlindObserver(project) {
  const counters = {
    eventCounts: {},
    rejectionReasons: {},
    expandedByFloor: {},
    generatedByKind: {},
    byDecisionDepth: {},
    deepestFloorId: null,
    deepestFloorRank: -1,
    maxDecisionDepth: 0,
    maxFrontierSize: 0,
    samples: [],
  };
  const sampleTypes = new Set(["budgetStopped", "goalAccepted", "actionProviderError"]);
  return {
    counters,
    observer: {
      eventTypes: [
        "actionSetGenerated",
        "candidateGenerated",
        "candidateRejected",
        "agendaPopped",
        "goalAccepted",
        "budgetStopped",
        "actionProviderError",
      ],
      onEvent(event) {
        counters.eventCounts[event.eventType] = number(counters.eventCounts[event.eventType], 0) + 1;
        const rank = floorRank(project, event.floorId);
        if (rank > counters.deepestFloorRank) {
          counters.deepestFloorRank = rank;
          counters.deepestFloorId = event.floorId || null;
        }
        counters.maxDecisionDepth = Math.max(counters.maxDecisionDepth, number(event.decisionDepth, 0));
        counters.maxFrontierSize = Math.max(counters.maxFrontierSize, number(event.frontierSize, 0));
        const depthKey = String(number(event.decisionDepth, 0));
        if (!counters.byDecisionDepth[depthKey]) {
          counters.byDecisionDepth[depthKey] = {
            expanded: 0,
            actionSets: 0,
            generated: 0,
            rejected: 0,
            maxFrontierSize: 0,
            byFloor: {},
            generatedByKind: {},
            rejectionReasons: {},
          };
        }
        const depth = counters.byDecisionDepth[depthKey];
        depth.maxFrontierSize = Math.max(depth.maxFrontierSize, number(event.frontierSize, 0));
        if (event.eventType === "agendaPopped") {
          const floor = event.floorId || "unknown";
          counters.expandedByFloor[floor] = number(counters.expandedByFloor[floor], 0) + 1;
          depth.expanded += 1;
          depth.byFloor[floor] = number(depth.byFloor[floor], 0) + 1;
        }
        if (event.eventType === "actionSetGenerated") {
          depth.actionSets += 1;
        }
        if (event.eventType === "candidateGenerated") {
          const kind = (event.action && event.action.kind) || "unknown";
          counters.generatedByKind[kind] = number(counters.generatedByKind[kind], 0) + 1;
          depth.generated += 1;
          depth.generatedByKind[kind] = number(depth.generatedByKind[kind], 0) + 1;
        }
        if (event.eventType === "candidateRejected") {
          const reason = event.reasonCode || "unknown";
          counters.rejectionReasons[reason] = number(counters.rejectionReasons[reason], 0) + 1;
          depth.rejected += 1;
          depth.rejectionReasons[reason] = number(depth.rejectionReasons[reason], 0) + 1;
        }
        if (sampleTypes.has(event.eventType) && counters.samples.length < 20) {
          counters.samples.push({
            eventType: event.eventType,
            reasonCode: event.reasonCode || null,
            floorId: event.floorId || null,
            decisionDepth: number(event.decisionDepth, 0),
            expansions: event.expansions == null ? null : number(event.expansions, 0),
            frontierSize: event.frontierSize == null ? null : number(event.frontierSize, 0),
          });
        }
      },
    },
  };
}

function compactState(state) {
  if (!state) return null;
  const hero = state.hero || {};
  return {
    floorId: state.floorId || null,
    hero: {
      hp: number(hero.hp, 0),
      atk: number(hero.atk, 0),
      def: number(hero.def, 0),
      mdef: number(hero.mdef, 0),
      lv: number(hero.lv, 0),
      exp: number(hero.exp, 0),
      equipment: Array.isArray(hero.equipment) ? hero.equipment.slice() : [],
    },
    decisionDepth: number((state.meta || {}).decisionDepth, 0),
    routeLength: Array.isArray(state.route) ? state.route.length : 0,
    exactStateFingerprint: crypto
      .createHash("sha256")
      .update(buildStateKey(state))
      .digest("hex")
      .slice(0, 16),
  };
}

function strictReplayEvidence(project, goal, initialState, result, projectRoot) {
  if (!result.found || !result.goalSkyline[0]) return null;
  const winner = result.goalSkyline[0];
  const finalState = winner.state;
  finalState.route = Array.isArray(winner.route) ? winner.route.slice() : [];
  const routeRecord = buildRouteRecord({
    project,
    simulator: makeBlindSimulator(project),
    initialState,
    finalState,
    options: {
      projectRoot,
      solver: "blind-discovery-baseline",
      profile: "D3-terminal-only",
      rank: goal.rank,
      toFloor: goal.goal.floorId,
      goalType: goal.goal.type,
      snapshotFloors: [initialState.floorId, goal.goal.floorId],
      metadata: {
        blindGoalId: goal.id,
        allowedInputs: ["tower", "canonical-initial-state", "terminal-goal"],
      },
    },
  });
  const replay = strictReplayRoute(project, makeBlindSimulator(project), routeRecord);
  return {
    valid: replay.valid,
    stepsAttempted: replay.stepsAttempted,
    stepsCompleted: replay.stepsCompleted,
    failureReason: replay.failureReason || null,
    finalExactStateFingerprint: compactState(finalState).exactStateFingerprint,
  };
}

function runBlindDiscoveryBaseline(options) {
  const config = options || {};
  const goalFile = path.resolve(config.goalFile);
  const projectRoot = path.resolve(config.projectRoot);
  const blindGoal = readBlindGoal(goalFile);
  const project = loadProject(projectRoot);
  const simulator = makeBlindSimulator(project, config);
  const initialState = simulator.createInitialState({ rank: blindGoal.rank });
  const segment = {
    id: `blind-${blindGoal.id}`,
    label: `Blind terminal goal: ${blindGoal.id}`,
    goal: { ...blindGoal.goal },
    actionPolicy: {},
    dp: {},
  };
  const observer = createBlindObserver(project);
  const startedAt = Date.now();
  const maxExpansions = number(config.maxExpansions, 1000);
  const maxHeapMb = number(config.maxHeapMb, 2048);
  const maxRssMb = number(config.maxRssMb, 0);
  const goalSkylineLimit = number(config.goalSkylineLimit, 8);
  const result = searchSegmentDP(simulator, initialState, segment, {
    candidateLimit: number(config.candidateLimit, 8),
    dpOverrides: {
      maxExpansions,
      maxRuntimeMs: 0,
      maxHeapMb,
      maxRssMb,
      goalSkylineLimit,
      stopOnFirstGoal: true,
      priorityMode: "goal-directed",
    },
    preserveSkylineRoles: true,
    dpPriorityMode: "goal-directed",
    observer: observer.observer,
  });
  const dp = (result.diagnostics || {}).dp || {};
  const best = result.bestProgress || result.bestSeen || null;
  const replay = strictReplayEvidence(project, blindGoal, initialState, result, projectRoot);
  return {
    schema: SCHEMA,
    grade: "D3",
    goalId: blindGoal.id,
    inputContract: {
      allowedInputs: ["tower", "canonical-initial-state", "terminal-goal"],
      forbiddenInputs: [
        "route-fixture",
        "route-prefix",
        "intermediate-milestone",
        "event-order",
        "resource-threshold",
        "floor-or-region-restriction",
      ],
      goal: blindGoal.goal,
      actionPolicy: segment.actionPolicy,
      dpHints: segment.dp,
      initialStateSource: "simulator.createInitialState",
    },
    controls: {
      maxExpansions,
      maxRuntimeMs: 0,
      maxHeapMb,
      candidateLimit: number(config.candidateLimit, 8),
      goalSkylineLimit,
      stopOnFirstGoal: true,
      priorityMode: "goal-directed",
      productionKeyChanged: false,
      productionDominanceChanged: false,
      productionSelectionChanged: false,
    },
    outcome: {
      found: result.found,
      goalFound: Boolean((result.searchOutcome || {}).goalFound),
      frontierExhausted: Boolean((result.searchOutcome || {}).frontierExhausted),
      budgetExhausted: Boolean((result.searchOutcome || {}).budgetExhausted),
      searchComplete: Boolean((result.searchOutcome || {}).searchComplete),
      stoppedReason: dp.stoppedReason || (dp.expansionBudgetExhausted ? "expansion-limit" : null),
      expansions: number(dp.expansions, 0),
      frontierSize: number(dp.frontierSize, 0),
      wallMs: Date.now() - startedAt,
      actionTrimmed: number((result.diagnostics || {}).actionTrimmed, 0),
      generated: number(observer.counters.eventCounts.candidateGenerated, 0),
      accepted: number(dp.acceptedStates, 0),
      registry: dp.registry || null,
      bestProgress: compactState(best),
      strictReplay: replay,
    },
    traceSummary: observer.counters,
    verdict: result.found && replay && replay.valid
      ? "BLIND_GOAL_FOUND_STRICT_REPLAY_VERIFIED"
      : (result.searchOutcome || {}).searchComplete
        ? "BLIND_GOAL_NOT_FOUND_WITHIN_COMPLETE_CURRENT_ACTION_SET"
        : "BLIND_GOAL_NOT_FOUND_WITHIN_BUDGET",
  };
}

module.exports = {
  ALLOWED_GOAL_KEYS,
  ALLOWED_TOP_LEVEL_KEYS,
  FORBIDDEN_SERIALIZED_KEYS,
  GOAL_SCHEMA,
  SCHEMA,
  makeBlindSimulator,
  readBlindGoal,
  runBlindDiscoveryBaseline,
  validateBlindGoal,
};
