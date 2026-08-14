"use strict";

/** TEST GRADE: integration-local */

const assert = require("node:assert");
const path = require("node:path");

const { makeBlindSimulator, readBlindGoal } = require("./lib/blind-discovery-baseline");
const { loadProject } = require("./lib/project-loader");
const { cloneState, removeTileAt } = require("./lib/state");
const {
  enumerateStrategicActions,
  runStrategicD2Search,
} = require("./lib/strategic-d2-search");
const {
  buildStrategicOptionMap,
  diffStrategicOptionMaps,
} = require("./lib/strategic-option-map");
const {
  aggregateVariantsIntoTransitions,
  buildReachablePoiIndex,
  createStrategicStateIndexCache,
  diffReachablePoiSets,
  futureOptionScore,
  poiStillPresent,
  selectCanonicalPostState,
  terminalBattleProjection,
} = require("./lib/strategic-transition");
const {
  buildGoalPredicateTarget,
  buildTerminalChoiceTarget,
  runLocalConnector,
  verifyConnectorChain,
} = require("./lib/strategic-connector");
const { LazyWorkQueue } = require("./lib/strategic-lazy-work");
const { createMt5EntryState, detachCheckpoint } = require("./qualify-blind-discovery");

const ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");
const GOAL_FILE = path.join(__dirname, "blind-goals", "onlyup-mt5-blueking.json");

const AGENDA_QUEUES = [
  "terminal-blocker-progress",
  "survival",
  "combat-power",
  "future-reachable-options",
  "low-irreversible-cost",
  "novel-semantic-state",
];

function main() {
  const project = loadProject(PROJECT_ROOT);
  const initialState = detachCheckpoint(createMt5EntryState(project));
  const terminalGoal = readBlindGoal(GOAL_FILE).goal;
  const floorIds = ["MT4", "MT5"];

  // --- 5.18a regression: shared 2D option map ---------------------------------
  const initialOptions = buildStrategicOptionMap(project, initialState, { floorIds });
  assert.strictEqual(initialOptions.floors.MT4.grid[3][7], "item:I621");
  assert.strictEqual(initialOptions.floors.MT4.grid[3][8], "enemy:skeletonKing");
  const removedState = cloneState(initialState);
  removeTileAt(removedState, "MT4", 7, 3);
  const removedOptions = buildStrategicOptionMap(project, removedState, { floorIds });
  assert.strictEqual(removedOptions.floors.MT4.grid[3][7], null);
  assert.notStrictEqual(removedOptions.fingerprint, initialOptions.fingerprint);
  assert.deepStrictEqual(
    diffStrategicOptionMaps(initialOptions, removedOptions).consumed.map((entry) => entry.key),
    ["MT4:7,3"],
  );

  const simulator = makeBlindSimulator(project);

  // --- 5.18b contract: reachable POI index ------------------------------------
  const initialReachable = buildReachablePoiIndex(project, simulator, initialState);
  const initialTerminalProjection = terminalBattleProjection(simulator, initialState, terminalGoal);
  assert.ok(initialReachable.counts.total > 0);
  assert.strictEqual(initialTerminalProjection.stage, "attack-blocked");
  assert.ok(initialTerminalProjection.attackMargin < 0);
  assert.ok(Number.isFinite(initialTerminalProjection.progressScore));
  assert.ok(initialReachable.entries.some((entry) =>
    entry.key === "MT5:8,11" && entry.kind === "enemy" && entry.tileId === "skeletonKing"));
  assert.ok(initialReachable.entries.some((entry) =>
    entry.kind === "portal" && poiStillPresent(project, initialState, entry)));
  assert.deepStrictEqual(
    diffReachablePoiSets(
      { entries: [{ key: "MT4:7,3", kind: "item", tileId: "I621" }, { key: "MT4:8,3", kind: "enemy", tileId: "skeletonKing" }] },
      { entries: [{ key: "MT4:8,3", kind: "enemy", tileId: "skeletonKing" }] },
      { isPresent: (entry) => entry.key !== "MT4:7,3" },
    ).consumed.map((entry) => entry.key),
    ["MT4:7,3"],
  );
  assert.deepStrictEqual(
    diffReachablePoiSets(
      { entries: [{ key: "MT4:7,3", kind: "item", tileId: "I621" }] },
      { entries: [] },
      { isPresent: (entry) => entry.key === "MT4:7,3" },
    ).stillPresentButUnreachable.map((entry) => entry.key),
    ["MT4:7,3"],
  );
  assert.strictEqual(poiStillPresent(project, initialState, {
    key: "MT4:7,3",
    kind: "item",
    tileId: "I621",
  }), true);
  assert.strictEqual(poiStillPresent(project, removedState, {
    key: "MT4:7,3",
    kind: "item",
    tileId: "I621",
  }), false);

  // Strategic reachability may only cache by exact state. Lower-level topology
  // reuse remains the simulator's responsibility after its own safety
  // classification.
  const cacheSimulator = makeBlindSimulator(project);
  const originalGetWalkReachability = cacheSimulator.getWalkReachability.bind(cacheSimulator);
  let reachabilityCalls = 0;
  cacheSimulator.getWalkReachability = (state) => {
    reachabilityCalls += 1;
    return originalGetWalkReachability(state);
  };
  const exactStateIndex = createStrategicStateIndexCache(project, cacheSimulator, { floorIds });
  exactStateIndex.get(initialState);
  const hpChangedState = cloneState(initialState);
  hpChangedState.hero.hp -= 1;
  exactStateIndex.get(hpChangedState);
  assert.strictEqual(reachabilityCalls, 2);

  // --- 5.18b contract: choice-level transition aggregation --------------------
  const rootActions = enumerateStrategicActions(simulator, initialState, {
    compareLegacyFilter: true,
  });
  assert.ok(rootActions.actions.length > 0);
  assert.strictEqual(rootActions.actions.some((action) => action.kind === "floorFly"), false);
  const withFloorFly = enumerateStrategicActions(simulator, initialState, {
    includeFloorFly: true,
  });
  assert.ok(withFloorFly.actions.some((action) => action.kind === "floorFly"));

  const stateIndexCache = createStrategicStateIndexCache(project, simulator, { floorIds });
  const rootIndex = stateIndexCache.get(initialState);
  const aggregated = aggregateVariantsIntoTransitions({
    simulator,
    state: initialState,
    actions: rootActions.actions,
    terminalGoal,
    stateIndex: stateIndexCache,
    beforeOptionMap: rootIndex.optionMap,
    beforeReachable: rootIndex.reachablePoi,
  });
  assert.ok(aggregated.transitions.length > 0);
  assert.ok(aggregated.transitions.every((transition) =>
    transition.travelVariantCount >= 1 &&
    transition.exactPostStateCount >= 1 &&
    transition.exactPostStateCount <= transition.travelVariantCount));
  assert.ok(aggregated.transitions.every((transition) =>
    transition.postStates.every((post) =>
      post.consumedOpportunities.every((entry) => entry.role === "active" || entry.role === "implicit") &&
      Number.isFinite(post.resourceDelta.hp) &&
      typeof post.irreversibleCost.total === "number")));
  for (const transition of aggregated.transitions) {
    const selection = selectCanonicalPostState(transition, {});
    assert.ok(selection && selection.postState);
    const bestScore = transition.postStates.reduce(
      (max, post) => Math.max(max, futureOptionScore(post.reachablePoi)),
      -Infinity,
    );
    assert.strictEqual(futureOptionScore(selection.postState.reachablePoi), bestScore);
  }

  // --- 5.18c contract: lazy-work lifecycle ------------------------------------
  const lazyQueue = new LazyWorkQueue();
  const lazyA = lazyQueue.enqueue({ kind: "deferred-exact-post", sourceNodeId: 0, post: { stateKey: "s1" } });
  const lazyB = lazyQueue.enqueue({ kind: "floorfly-choice", sourceNodeId: 0, targetFloorId: "MT1" });
  const protectedWork = lazyQueue.enqueue({
    kind: "connector-choice",
    id: "caller-controlled-id",
    status: "resolved",
    schema: "caller-controlled-schema",
  });
  assert.notStrictEqual(protectedWork.id, "caller-controlled-id");
  assert.strictEqual(protectedWork.status, "queued");
  assert.strictEqual(protectedWork.schema, "motapathfinder.strategic-lazy-work.v1");
  lazyQueue.reject(protectedWork, "control-complete");
  assert.strictEqual(lazyQueue.activeSize(), 2);
  assert.strictEqual(lazyQueue.dequeue(() => false).id, lazyA.id);
  lazyQueue.resolve(lazyA, "materialized");
  assert.strictEqual(lazyQueue.snapshot().counts.queued, 1);
  assert.strictEqual(lazyQueue.snapshot().counts.resolved, 1);
  lazyQueue.reject(lazyB, "no-variants");
  assert.strictEqual(lazyQueue.snapshot().counts.rejected, 2);
  assert.strictEqual(lazyQueue.activeSize(), 0);
  assert.throws(() => lazyQueue.enqueue({ kind: "not-a-real-kind" }));

  // --- 5.18c contract: connector legality (synthetic control) -----------------
  const syntheticSimulator = {
    enumeratePrimitiveActions(state) {
      const edges = {
        0: [{ kind: "a", to: 1 }],
        1: [{ kind: "b", to: 2 }],
        2: [{ kind: "c", to: 3 }],
        3: [],
      };
      return {
        actions: (edges[state.value] || []).map((action) => ({
          ...action,
          summary: `${action.kind}:${state.value}->${action.to}`,
        })),
      };
    },
    applyAction(_state, action) {
      return { value: action.to };
    },
  };
  const syntheticKeyState = (state) => String(state.value);
  const syntheticCopyState = (state) => ({ value: state.value });
  const syntheticResult = runLocalConnector({
    simulator: syntheticSimulator,
    sourceState: { value: 0 },
    target: buildGoalPredicateTarget("synthetic-goal", (state) => state.value === 3),
    maxExpansions: 20,
    maxDepth: 5,
    keyState: syntheticKeyState,
    copyState: syntheticCopyState,
  });
  assert.strictEqual(syntheticResult.status, "resolved");
  assert.strictEqual(syntheticResult.chain.length, 3);
  const syntheticReplay = verifyConnectorChain(syntheticSimulator, { value: 0 }, syntheticResult, {
    keyState: syntheticKeyState,
    copyState: syntheticCopyState,
  });
  assert.strictEqual(syntheticReplay.valid, true);
  assert.strictEqual(syntheticReplay.postExactStateKey, "3");
  const corruptedEdges = syntheticResult.edges.map((edge, index) => ({
    ...edge,
    postExactStateKey: index === 0 ? "corrupted" : edge.postExactStateKey,
  }));
  const corruptedReplay = verifyConnectorChain(syntheticSimulator, { value: 0 }, corruptedEdges, {
    keyState: syntheticKeyState,
    copyState: syntheticCopyState,
  });
  assert.strictEqual(corruptedReplay.valid, false);
  const branchingSimulator = {
    enumeratePrimitiveActions(state) {
      return { actions: state.value === 0
        ? [1, 2, 3].map((to) => ({ kind: "branch", summary: `branch:${to}`, to }))
        : [] };
    },
    applyAction(_state, action) {
      return { value: action.to };
    },
  };
  const trimmedConnector = runLocalConnector({
    simulator: branchingSimulator,
    sourceState: { value: 0 },
    target: buildGoalPredicateTarget("unreachable", (state) => state.value === 99),
    maxExpansions: 20,
    maxDepth: 2,
    maxFrontier: 1,
    keyState: syntheticKeyState,
    copyState: syntheticCopyState,
  });
  assert.strictEqual(trimmedConnector.status, "frontier-trimmed");
  assert.ok(trimmedConnector.frontierTrimmed > 0);

  // --- 5.18c contract: connector legality (real direct-unavailable control) ---
  const realTarget = buildTerminalChoiceTarget({ floorId: "MT4", x: 8, y: 3 });
  const realConnector = runLocalConnector({
    simulator,
    sourceState: initialState,
    target: realTarget,
    maxExpansions: 400,
    maxDepth: 12,
  });
  assert.strictEqual(realConnector.status, "resolved");
  assert.ok(realConnector.chain.length >= 2);
  const realReplay = verifyConnectorChain(simulator, initialState, realConnector);
  assert.strictEqual(realReplay.valid, true);
  assert.strictEqual(realReplay.postExactStateKey, realConnector.postExactStateKey);

  // --- 5.18c contract: search runs --------------------------------------------
  const localClosure = runStrategicD2Search({
    project,
    projectRoot: PROJECT_ROOT,
    initialState,
    terminalGoal: {
      type: "bossDefeated",
      floorId: "MT5",
      x: 8,
      y: 11,
      enemyId: "skeletonKing",
    },
    simulatorFactory: () => makeBlindSimulator(project),
    maxExpansions: 4,
  });
  assert.strictEqual(localClosure.outcome.goalFound, true);
  assert.strictEqual(localClosure.outcome.firstGoalExpansion, 1);
  assert.ok(localClosure.replay && localClosure.replay.valid);
  assert.strictEqual(localClosure.verdict, "D2_STRATEGIC_SEARCH_STRICT_REPLAY_VERIFIED");
  const integratedConnectorClosure = runStrategicD2Search({
    project,
    projectRoot: PROJECT_ROOT,
    initialState,
    terminalGoal: {
      type: "bossDefeated",
      floorId: "MT4",
      x: 8,
      y: 3,
      enemyId: "skeletonKing",
    },
    simulatorFactory: () => makeBlindSimulator(project),
    maxExpansions: 8,
    connectorMaxExpansions: 400,
    connectorMaxDepth: 12,
    lazyDrainEvery: 1,
  });
  assert.ok(integratedConnectorClosure.stats.connectorResolved > 0);
  assert.strictEqual(integratedConnectorClosure.outcome.goalFound, true);
  assert.ok(integratedConnectorClosure.replay && integratedConnectorClosure.replay.valid);
  const result = runStrategicD2Search({
    project,
    projectRoot: PROJECT_ROOT,
    initialState,
    terminalGoal,
    simulatorFactory: () => makeBlindSimulator(project),
    maxExpansions: 64,
  });
  assert.strictEqual(result.schema, "motapathfinder.strategic-d2-search.v3");
  assert.strictEqual(result.inputContract.knownRouteUsed, false);
  assert.deepStrictEqual(result.controls.pruning, ["exact-state-merge-only"]);
  assert.strictEqual(result.controls.supplementalActionKinds.floorFly, "deferred-from-minimal-D2-vertical-slice");
  assert.deepStrictEqual(result.controls.agendaQueues, AGENDA_QUEUES);
  assert.ok(result.controls.transitionContract && result.controls.transitionContract.retentionRule);
  assert.strictEqual(result.controls.lazyResolution.deferredExactPosts, "recoverable-via-lazy-queue");
  assert.strictEqual(result.controls.lazyResolution.localDpConnector, "enabled-bounded-local-primitive-connector");
  assert.strictEqual(result.controls.connector.enabled, true);
  assert.ok(result.controls.completenessLimitations.includes(
    "connector-is-bounded-local-search-not-canonical-correctness-proof"));
  assert.strictEqual(result.outcome.goalFound, false);
  assert.strictEqual(result.outcome.budgetExhausted, true);
  assert.strictEqual(result.outcome.searchComplete, false);
  assert.strictEqual(result.outcome.deferredWorkRemaining, true);
  assert.strictEqual(result.stats.expansions, 64);
  assert.ok(result.stats.generated > result.stats.expansions);
  assert.ok(result.stats.optionMapsObserved > 1);
  assert.ok(result.stats.optionChangingTransitions > 0);
  assert.ok(result.stats.implicitOptionConsumptions > 0);
  assert.ok(result.stats.maxStrategicDepth > 0);
  assert.strictEqual(result.stats.generatedByKind.floorFly, undefined);
  assert.ok(result.stats.travelVariantAliasCount > 0);
  assert.ok(result.stats.transitionsWithNewlyReachable > 0);
  assert.ok(result.stats.transitionsWithLineageNovelty > 0);
  assert.ok(result.stats.transitionsWithLostReachability >= 0);
  assert.ok(result.stats.transitionsWithTerminalBlockerImprovement > 0);
  assert.ok(Object.keys(result.stats.canonicalSelectionReasons).length > 0);
  assert.ok(Number.isInteger(result.stats.deferredPostStates) && result.stats.deferredPostStates > 0);
  assert.ok(result.stats.connectorCalls > 0);
  assert.ok(result.stats.connectorBudgetExhausted > 0);
  assert.strictEqual(
    result.stats.totalSearchExpansions,
    result.stats.expansions + result.stats.connectorExpansions,
  );
  assert.ok(result.stats.lazyDeferredPostsMaterialized > 0);
  assert.ok(result.lazyWork && result.lazyWork.resolvedByKind["deferred-exact-post"] > 0);
  assert.deepStrictEqual(
    Object.keys(result.stats.expandedByQueue).sort(),
    result.controls.agendaQueues.slice().sort(),
  );
  assert.ok(result.frontierWitnesses.every((witness) =>
    witness && witness.optionMapFingerprint && witness.reachablePoiCounts));
  assert.ok(result.frontierWitnesses.some((witness) => witness.incomingTransition !== null));
  assert.ok(result.frontierWitnesses
    .find((witness) => witness.role === "novel-semantic-state")
    .incomingTransition.newlyDiscoveredPOIs.length > 0);
  assert.ok(result.stats.implicitOptionConsumptionSamples.some((sample) =>
    sample.consumed.some((entry) => entry.key === "MT4:7,3" && entry.tileId === "I621")));

  // --- 5.18c contract: lazy floorFly choice-level resolution ------------------
  const lazyFloorFlyResult = runStrategicD2Search({
    project,
    projectRoot: PROJECT_ROOT,
    initialState,
    terminalGoal,
    simulatorFactory: () => makeBlindSimulator(project),
    maxExpansions: 24,
    floorFlyMode: "lazy",
    lazyDrainEvery: 1,
  });
  assert.strictEqual(lazyFloorFlyResult.controls.supplementalActionKinds.floorFly, "lazy-choice-level-resolution");
  assert.strictEqual(lazyFloorFlyResult.stats.generatedByKind.floorFly, undefined);
  assert.ok(lazyFloorFlyResult.stats.lazyFloorFlyChoicesMaterialized > 0);
  assert.ok(lazyFloorFlyResult.stats.lazyFloorFlyVariantsEnumerated > 0);
  assert.ok(lazyFloorFlyResult.stats.lazyFloorFlyExactPostsObserved > 0);
  assert.ok(
    lazyFloorFlyResult.stats.lazyFloorFlyVariantsEnumerated >=
    lazyFloorFlyResult.stats.lazyFloorFlyExactPostsObserved,
  );
  assert.ok(lazyFloorFlyResult.lazyWork.resolvedByKind["floorfly-choice"] > 0);

  process.stdout.write(`${JSON.stringify({
    status: "passed",
    inputContract: result.inputContract,
    optionMap: {
      representation: result.controls.optionMap,
      initialFingerprint: initialOptions.fingerprint,
      initialCounts: initialOptions.counts,
      removedI621Fingerprint: removedOptions.fingerprint,
    },
    reachablePoi: {
      representation: result.controls.reachablePoi,
      initialCounts: initialReachable.counts,
      terminalBossReachableAtEntry: true,
    },
    transitionContract: result.controls.transitionContract,
    lazyResolution: result.controls.lazyResolution,
    connector: {
      controls: result.controls.connector,
      synthetic: {
        status: syntheticResult.status,
        chainLength: syntheticResult.chain.length,
        replayValid: syntheticReplay.valid,
        corruptedReplayValid: corruptedReplay.valid,
        frontierTrimmedStatus: trimmedConnector.status,
      },
      realDirectUnavailable: { status: realConnector.status, chainLength: realConnector.chain.length, replayValid: realReplay.valid },
    },
    actionBoundary: {
      primitiveVariants: rootActions.rawVariantCount,
      optionalFloorFlyVariants: withFloorFly.rawVariantCount - rootActions.rawVariantCount,
      defaultFloorFlyDeferred: true,
    },
    outcome: result.outcome,
    stats: {
      expansions: result.stats.expansions,
      generated: result.stats.generated,
      accepted: result.stats.accepted,
      exactMerged: result.stats.exactMerged,
      deferredPostStates: result.stats.deferredPostStates,
      travelVariantAliasCount: result.stats.travelVariantAliasCount,
      canonicalSelectionReasons: result.stats.canonicalSelectionReasons,
      optionMapsObserved: result.stats.optionMapsObserved,
      optionChangingTransitions: result.stats.optionChangingTransitions,
      implicitOptionConsumptions: result.stats.implicitOptionConsumptions,
      transitionsWithNewlyReachable: result.stats.transitionsWithNewlyReachable,
      transitionsWithLineageNovelty: result.stats.transitionsWithLineageNovelty,
      transitionsWithLostReachability: result.stats.transitionsWithLostReachability,
      transitionsConsumingOpportunities: result.stats.transitionsConsumingOpportunities,
      transitionsWithTerminalBlockerImprovement: result.stats.transitionsWithTerminalBlockerImprovement,
      connectorCalls: result.stats.connectorCalls,
      connectorBudgetExhausted: result.stats.connectorBudgetExhausted,
      lazyDeferredPostsMaterialized: result.stats.lazyDeferredPostsMaterialized,
      lazyWork: result.lazyWork,
      maxStrategicDepth: result.stats.maxStrategicDepth,
      expandedByQueue: result.stats.expandedByQueue,
    },
    lazyFloorFlyControl: {
      floorFlyMode: "lazy",
      lazyFloorFlyChoicesMaterialized: lazyFloorFlyResult.stats.lazyFloorFlyChoicesMaterialized,
      lazyFloorFlyVariantsEnumerated: lazyFloorFlyResult.stats.lazyFloorFlyVariantsEnumerated,
      lazyFloorFlyExactPostsObserved: lazyFloorFlyResult.stats.lazyFloorFlyExactPostsObserved,
      lazyFloorFlyExactPostsDeferred: lazyFloorFlyResult.stats.lazyFloorFlyExactPostsDeferred,
      resolvedByKind: lazyFloorFlyResult.lazyWork.resolvedByKind,
    },
    i621AutoConsumptionObserved: true,
    localStrictReplayControl: {
      goalFound: localClosure.outcome.goalFound,
      firstGoalExpansion: localClosure.outcome.firstGoalExpansion,
      replay: localClosure.replay,
    },
    integratedConnectorClosure: {
      goalFound: integratedConnectorClosure.outcome.goalFound,
      connectorResolved: integratedConnectorClosure.stats.connectorResolved,
      replay: integratedConnectorClosure.replay,
    },
    frontierWitnesses: result.frontierWitnesses,
    verdict: result.verdict,
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main };
