"use strict";

/** TEST GRADE: integration-local */

const assert = require("node:assert");
const path = require("node:path");

const { makeBlindSimulator, readBlindGoal } = require("./lib/blind-discovery-baseline");
const { loadProject } = require("./lib/project-loader");
const {
  analyzeBoundaryTargetRelevance,
  buildTargetMetrics,
  classifyFrontierBoundary,
  createDependencyAccessObserver,
} = require("./lib/strategic-dependency-attribution");
const { runStrategicD2Search } = require("./lib/strategic-d2-search");
const { createMt5EntryState, detachCheckpoint } = require("./qualify-blind-discovery");

const ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");
const GOAL_FILE = path.join(__dirname, "blind-goals", "onlyup-mt5-blueking.json");

function makeSyntheticProject(tileNumber, tile, changeFloorKey) {
  const floor = {
    width: 3,
    height: 3,
    map: [[0, tileNumber || 0, 0], [0, 0, 0], [0, 0, 0]],
    changeFloor: {},
    afterGetItem: {},
    afterBattle: {},
  };
  if (changeFloorKey) floor.changeFloor[changeFloorKey] = { toFloorId: "G", floorId: "G" };
  return {
    floorsById: { F: floor, G: { width: 3, height: 3, map: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], changeFloor: {}, afterGetItem: {}, afterBattle: {} } },
    floorOrder: ["F", "G"],
    mapTilesByNumber: { [String(tileNumber)]: tile },
  };
}

function makeState(overrides) {
  return {
    floorId: "F",
    hero: {
      hp: 20,
      atk: 2,
      def: 0,
      mdef: 0,
      lv: 1,
      exp: 0,
      equipment: [],
      loc: { x: 0, y: 0, direction: "right" },
    },
    inventory: {},
    flags: {},
    visitedFloors: { F: true },
    floorStates: {},
    ...overrides,
  };
}

function makeBoundarySimulator(options) {
  const config = options || {};
  return {
    getWalkReachability() {
      return { visited: { "0,0": { x: 0, y: 0 } } };
    },
    enumeratePrimitiveActions() {
      return { actions: config.actions || [] };
    },
    battleResolver: config.battleResolver || {
      evaluateBattle() {
        return { supported: true, damageInfo: { damage: 5 }, enemyInfo: { def: 0 } };
      },
    },
  };
}

function main() {
  const includeQualification1000 = process.argv.includes("--qualification-1000");
  const project = loadProject(PROJECT_ROOT);
  const initialState = detachCheckpoint(createMt5EntryState(project));
  const terminalGoal = readBlindGoal(GOAL_FILE).goal;

  // --- Distance metrics -------------------------------------------------------
  const metricProject = makeSyntheticProject(1, { id: "item1", cls: "items" }, null);
  const metricTarget = { type: "acquire-option", mechanism: "pickup", floorId: "F", x: 1, y: 0, itemId: "item1" };
  const metricState = makeState();
  const metricActions = [{
    kind: "pickup",
    floorId: "F",
    x: 1,
    y: 0,
    itemId: "item1",
    target: { x: 1, y: 0, itemId: "item1" },
  }];
  const metrics = buildTargetMetrics({
    project: metricProject,
    state: metricState,
    actions: metricActions,
    target: metricTarget,
  });
  assert.strictEqual(metrics.sameFloor, true);
  assert.strictEqual(metrics.manhattanDistance, 1);
  assert.strictEqual(metrics.targetAdjacent, true);
  assert.strictEqual(metrics.targetActionAvailable, true);
  const observer = createDependencyAccessObserver({ project: metricProject, target: metricTarget, maxApproaches: 2 });
  observer.observe({
    state: makeState(),
    key: "near",
    chain: [{ summary: "a" }],
    actions: metricActions,
    expansions: 1,
  });
  observer.observe({
    state: makeState({ floorId: "G" }),
    key: "far",
    chain: [{ summary: "b" }],
    actions: [],
    expansions: 2,
  });
  assert.strictEqual(observer.report()[0].state.floorId, "F");

  // --- Target-relevance / access-cut analysis --------------------------------
  const corridorProject = {
    floorsById: {
      F: { width: 5, height: 1, map: [[0, 0, 2, 0, 1]], changeFloor: {}, afterGetItem: {}, afterBattle: {} },
    },
    floorOrder: ["F"],
    mapTilesByNumber: {
      "1": { id: "targetItem", cls: "items" },
      "2": { id: "enemyOnPath", cls: "enemy01" },
    },
  };
  const corridorState = makeState();
  const corridorTarget = { type: "acquire-option", mechanism: "pickup", floorId: "F", x: 4, y: 0, itemId: "targetItem" };
  const corridorBoundary = { target: { floorId: "F", x: 2, y: 0, enemyId: "enemyOnPath" } };
  const corridorRelevance = analyzeBoundaryTargetRelevance({
    project: corridorProject,
    simulator: makeBoundarySimulator(),
    state: corridorState,
    target: corridorTarget,
    boundary: corridorBoundary,
  });
  assert.strictEqual(corridorRelevance.floorScoped, true);
  assert.strictEqual(corridorRelevance.minAccessBlockers, 1);
  assert.strictEqual(corridorRelevance.onMinimumBlockerPath, true);
  assert.strictEqual(corridorRelevance.targetSideReachableIfRemoved, true);
  assert.strictEqual(corridorRelevance.reducesTopologicalBlockerDistance, true);
  assert.strictEqual(corridorRelevance.separatesCurrentComponentFromTarget, true);

  const irrelevantProject = {
    floorsById: {
      F: { width: 5, height: 2, map: [[0, 0, 0, 0, 1], [0, 0, 2, 0, 0]], changeFloor: {}, afterGetItem: {}, afterBattle: {} },
    },
    floorOrder: ["F"],
    mapTilesByNumber: {
      "1": { id: "targetItem", cls: "items" },
      "2": { id: "irrelevantEnemy", cls: "enemy01" },
    },
  };
  const irrelevantRelevance = analyzeBoundaryTargetRelevance({
    project: irrelevantProject,
    simulator: makeBoundarySimulator(),
    state: makeState(),
    target: corridorTarget,
    boundary: { target: { floorId: "F", x: 2, y: 1, enemyId: "irrelevantEnemy" } },
  });
  assert.strictEqual(irrelevantRelevance.minAccessBlockers, 0);
  assert.strictEqual(irrelevantRelevance.onMinimumBlockerPath, false);
  assert.strictEqual(irrelevantRelevance.targetSideReachableIfRemoved, false);
  assert.strictEqual(irrelevantRelevance.reducesTopologicalBlockerDistance, false);
  assert.strictEqual(irrelevantRelevance.separatesCurrentComponentFromTarget, false);

  // --- Boundary classification -------------------------------------------------
  const budgetBoundary = classifyFrontierBoundary({
    project: metricProject,
    simulator: makeBoundarySimulator(),
    state: metricState,
    target: metricTarget,
    actions: [],
    stoppedReason: "budget-exhausted",
  });
  assert.strictEqual(budgetBoundary.kind, "budget-incomplete");
  assert.strictEqual(budgetBoundary.proofStrength, "hypothesis");

  const battleProject = makeSyntheticProject(1, { id: "skeleton", cls: "enemy01" }, null);
  const battleSimulator = makeBoundarySimulator({
    battleResolver: {
      evaluateBattle() {
        return { supported: true, damageInfo: { damage: 25 }, enemyInfo: { def: 0 } };
      },
    },
  });
  const battleBoundary = classifyFrontierBoundary({
    project: battleProject,
    simulator: battleSimulator,
    state: makeState(),
    target: { type: "acquire-option", mechanism: "battle", floorId: "F", x: 1, y: 0, enemyId: "skeleton" },
    actions: [],
    stoppedReason: "frontier-exhausted",
  });
  assert.strictEqual(battleBoundary.kind, "battle-unsurvivable");
  assert.strictEqual(battleBoundary.proofStrength, "observed");

  const doorProject = makeSyntheticProject(1, {
    id: "yellowDoor",
    cls: "animates",
    trigger: "openDoor",
    doorInfo: { keys: { yellowKey: 1 } },
  }, null);
  const doorBoundary = classifyFrontierBoundary({
    project: doorProject,
    simulator: makeBoundarySimulator(),
    state: makeState({ inventory: {} }),
    target: { type: "acquire-option", mechanism: "pickup", floorId: "F", x: 2, y: 0, itemId: "T" },
    actions: [],
    stoppedReason: "frontier-exhausted",
  });
  assert.strictEqual(doorBoundary.kind, "missing-key");
  assert.deepStrictEqual(doorBoundary.evidence.missingKeys[0], { keyId: "yellowKey", required: 1 });

  const eventProject = makeSyntheticProject(1, { id: "scripted", cls: "terrains", trigger: "script" }, null);
  const eventBoundary = classifyFrontierBoundary({
    project: eventProject,
    simulator: makeBoundarySimulator(),
    state: makeState(),
    target: { type: "acquire-option", mechanism: "pickup", floorId: "F", x: 2, y: 0, itemId: "T" },
    actions: [],
    stoppedReason: "frontier-exhausted",
  });
  assert.strictEqual(eventBoundary.kind, "event-condition");

  const changeProject = makeSyntheticProject(null, null, "1,0");
  const changeBoundary = classifyFrontierBoundary({
    project: changeProject,
    simulator: makeBoundarySimulator(),
    state: makeState(),
    target: { type: "acquire-option", mechanism: "pickup", floorId: "G", x: 0, y: 0, itemId: "T" },
    actions: [],
    stoppedReason: "frontier-exhausted",
  });
  assert.strictEqual(changeBoundary.kind, "topology/changeFloor");

  // --- Observation must not change D2 search ----------------------------------
  const runOptions = {
    project,
    projectRoot: PROJECT_ROOT,
    initialState,
    terminalGoal,
    simulatorFactory: () => makeBlindSimulator(project),
    connectorMode: "dependency-derived",
    enableConnector: true,
    maxExpansions: 64,
    connectorMaxExpansions: 20,
    connectorMaxCalls: 4,
    lazyDrainEvery: 8,
    maxTotalSearchExpansions: 200,
  };
  const observed = runStrategicD2Search({
    ...runOptions,
    enableDependencyAccessAttribution: true,
  });
  const unobserved = runStrategicD2Search({
    ...runOptions,
    enableDependencyAccessAttribution: false,
  });
  const deterministicStats = [
    "expansions",
    "generated",
    "accepted",
    "exactMerged",
    "dependencyConnectorCalls",
    "dependencyConnectorSatisfied",
    "dependencyConnectorNoSatisfied",
    "dependencyConnectorExpansions",
    "dependencySatisfied",
    "dependencyStateCreated",
    "dependencyGlobalBlockerAdvanced",
    "totalSearchExpansions",
  ];
  deterministicStats.forEach((key) => {
    assert.strictEqual(observed.stats[key], unobserved.stats[key], `attribution changed stats.${key}`);
  });
  assert.strictEqual(observed.outcome.stoppedReason, unobserved.outcome.stoppedReason);
  assert.strictEqual(observed.bestTerminalBlocker.attackMargin, unobserved.bestTerminalBlocker.attackMargin);
  assert.strictEqual(observed.stats.dependencyAccessAttributions.length, observed.stats.dependencyAttemptWitnesses.length);
  observed.stats.dependencyAccessAttributions.forEach((attribution) => {
    assert.ok(attribution.attemptId);
    assert.ok(attribution.semanticDependencyId);
    assert.ok(attribution.sourceExactStateFingerprint);
    assert.ok(attribution.bestApproaches.length > 0);
    assert.ok(attribution.firstUnresolvedAccessBoundary.kind);
    assert.ok(["proven", "observed", "hypothesis", "unknown"].includes(
      attribution.firstUnresolvedAccessBoundary.proofStrength,
    ));
    assert.ok(attribution.targetRelevantBoundary);
    assert.ok(attribution.targetRelevantBoundary.targetRelevance);
  });

  let qualificationAttribution = null;
  if (includeQualification1000) {
    const qualified = runStrategicD2Search({
      ...runOptions,
      maxExpansions: 1000,
      connectorMaxExpansions: 50,
      connectorMaxCalls: 8,
      maxTotalSearchExpansions: 1000,
    });
    assert.strictEqual(qualified.stats.dependencyConnectorCalls, 8);
    assert.strictEqual(qualified.stats.dependencyAttemptWitnesses.length, 8);
    assert.strictEqual(qualified.stats.dependencyAccessAttributions.length, 8);
    assert.strictEqual(new Set(qualified.stats.dependencyAttemptWitnesses.map((entry) =>
      entry.sourceExactStateFingerprint)).size, 8);
    assert.strictEqual(new Set(qualified.stats.dependencyAttemptWitnesses.map((entry) =>
      entry.semanticDependencyId)).size, 1);
    assert.strictEqual(qualified.stats.dependencySatisfied, 0);
    assert.strictEqual(qualified.stats.dependencyStateCreated, 0);
    assert.strictEqual(qualified.stats.dependencyGlobalBlockerAdvanced, 0);
    qualified.stats.dependencyAccessAttributions.forEach((entry) => {
      const relevance = entry.targetRelevantBoundary.targetRelevance;
      assert.ok(relevance);
      assert.strictEqual(relevance.floorScoped, true);
      assert.strictEqual(typeof relevance.onMinimumBlockerPath, "boolean");
      assert.strictEqual(typeof relevance.reducesTopologicalBlockerDistance, "boolean");
      assert.strictEqual(typeof relevance.separatesCurrentComponentFromTarget, "boolean");
    });
    const targetRelevanceSummary = {
      onMinimumBlockerPath: qualified.stats.dependencyAccessAttributions
        .filter((entry) => entry.targetRelevantBoundary.targetRelevance.onMinimumBlockerPath).length,
      reducesTopologicalBlockerDistance: qualified.stats.dependencyAccessAttributions
        .filter((entry) => entry.targetRelevantBoundary.targetRelevance.reducesTopologicalBlockerDistance).length,
      separatesCurrentComponentFromTarget: qualified.stats.dependencyAccessAttributions
        .filter((entry) => entry.targetRelevantBoundary.targetRelevance.separatesCurrentComponentFromTarget).length,
      minAccessBlockers: qualified.stats.dependencyAccessAttributions
        .map((entry) => entry.targetRelevantBoundary.targetRelevance.minAccessBlockers),
    };
    qualificationAttribution = {
      totalSearchExpansions: qualified.stats.totalSearchExpansions,
      strategicExpansions: qualified.stats.expansions,
      dependencyConnectorExpansions: qualified.stats.dependencyConnectorExpansions,
      calls: qualified.stats.dependencyConnectorCalls,
      semanticDependencies: new Set(qualified.stats.dependencyAttemptWitnesses.map((entry) =>
        entry.semanticDependencyId)).size,
      distinctSources: new Set(qualified.stats.dependencyAttemptWitnesses.map((entry) =>
        entry.sourceExactStateFingerprint)).size,
      boundaryKinds: qualified.stats.dependencyAccessAttributions.map((entry) =>
        entry.firstUnresolvedAccessBoundary.kind),
      proofStrengths: qualified.stats.dependencyAccessAttributions.map((entry) =>
        entry.firstUnresolvedAccessBoundary.proofStrength),
      targetRelevanceSummary,
    };
  }

  process.stdout.write(`${JSON.stringify({
    status: "passed",
    metrics: {
      sameFloor: metrics.sameFloor,
      manhattanDistance: metrics.manhattanDistance,
      targetAdjacent: metrics.targetAdjacent,
      targetActionAvailable: metrics.targetActionAvailable,
      bestApproachFloor: observer.report()[0].state.floorId,
    },
    targetRelevance: {
      relevant: corridorRelevance,
      irrelevant: irrelevantRelevance,
    },
    boundaries: {
      budget: budgetBoundary,
      battle: battleBoundary,
      door: doorBoundary,
      event: eventBoundary,
      changeFloor: changeBoundary,
    },
    noSemanticChange: {
      observedCalls: observed.stats.dependencyConnectorCalls,
      unobservedCalls: unobserved.stats.dependencyConnectorCalls,
      observedTotal: observed.stats.totalSearchExpansions,
      unobservedTotal: unobserved.stats.totalSearchExpansions,
      attributionCount: observed.stats.dependencyAccessAttributions.length,
    },
    qualificationAttribution,
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main };
