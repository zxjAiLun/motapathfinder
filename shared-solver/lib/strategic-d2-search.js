"use strict";

const crypto = require("node:crypto");

const { strictReplayRoute } = require("./agenda-policy-evaluation");
const { buildSegmentGoalPredicate } = require("./segment-dp");
const { buildRouteRecord, recordedActionVariantIdentity } = require("./route-store");
const { buildStateKey } = require("./state-key");
const { cloneState } = require("./state");
const { diffStrategicOptionMaps } = require("./strategic-option-map");
const {
  aggregateVariantsIntoTransitions,
  createStrategicStateIndexCache,
  diffReachablePoiSets,
  explicitActionTargetKey,
  futureOptionScore,
  mutationCount,
  selectCanonicalPostState,
  summarizeResourceDelta,
  terminalBattleProjection,
} = require("./strategic-transition");
const {
  buildTerminalChoiceTarget,
  runLocalConnector,
  verifyConnectorChain,
} = require("./strategic-connector");
const {
  analyzeTerminalBlocker,
  runBlockerDerivedConnector,
} = require("./strategic-blocker");
const {
  compileDependenciesFromTransitions,
  compileUnreachableTerminalDependencies,
  createDependencyAttemptDedupe,
  dependencyAttemptId,
  runDependencyConnector,
  selectFeedbackAwareDependencyAttempts,
} = require("./strategic-dependency");
const { LazyWorkQueue } = require("./strategic-lazy-work");
const {
  createChildNode,
  createRootNode,
  reconstructActionEntries,
} = require("./search-nodes");

const SCHEMA = "motapathfinder.strategic-d2-search.v3";

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}

class BinaryHeap {
  constructor(compare) {
    this.compare = compare;
    this.items = [];
  }

  push(item) {
    this.items.push(item);
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.compare(this.items[index], this.items[parent]) <= 0) break;
      [this.items[index], this.items[parent]] = [this.items[parent], this.items[index]];
      index = parent;
    }
  }

  pop() {
    if (this.items.length === 0) return null;
    const first = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0) {
      this.items[0] = last;
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        let best = index;
        if (left < this.items.length && this.compare(this.items[left], this.items[best]) > 0) best = left;
        if (right < this.items.length && this.compare(this.items[right], this.items[best]) > 0) best = right;
        if (best === index) break;
        [this.items[index], this.items[best]] = [this.items[best], this.items[index]];
        index = best;
      }
    }
    return first;
  }

  get length() {
    return this.items.length;
  }
}

function heroScore(state) {
  const hero = (state || {}).hero || {};
  return number(hero.atk, 0) * 1000000 +
    number(hero.def, 0) * 1000000 +
    number(hero.mdef, 0) * 1000 +
    number(hero.lv, 0) * 100000 +
    number(hero.exp, 0);
}

function goalPriority(simulator, state, terminalGoal) {
  const projection = terminalBattleProjection(simulator, state, terminalGoal);
  const onGoalFloor = state.floorId === terminalGoal.floorId ? 1 : 0;
  const progress = projection && projection.progressScore != null
    ? projection.progressScore
    : -1000000000;
  return onGoalFloor * 10000000000000 + progress + heroScore(state);
}

function incomingBlockerBonus(node) {
  const transition = node.strategicTransition;
  if (!transition || !transition.terminalBlockerDelta || transition.terminalBlockerDelta.delta == null) {
    return 0;
  }
  return transition.terminalBlockerDelta.delta > 0 ? 1000000 : 0;
}

function terminalProgressTerm(simulator, state, terminalGoal) {
  const projection = terminalBattleProjection(simulator, state, terminalGoal);
  return projection && projection.progressScore != null ? projection.progressScore : -1000000000;
}

function compareBy(score) {
  return (left, right) => score(left) - score(right) || right.order - left.order;
}

function makeAgenda(simulator, terminalGoal) {
  const definitions = [
    {
      id: "terminal-blocker-progress",
      compare: compareBy((node) =>
        goalPriority(simulator, node.state, terminalGoal) + incomingBlockerBonus(node)),
    },
    {
      id: "survival",
      compare: compareBy((node) => number((node.state.hero || {}).hp, 0)),
    },
    {
      id: "combat-power",
      compare: compareBy((node) => heroScore(node.state)),
    },
    {
      id: "future-reachable-options",
      compare: compareBy((node) =>
        futureOptionScore(node.reachablePoi) * 1000000 +
        terminalProgressTerm(simulator, node.state, terminalGoal)),
    },
    {
      id: "low-irreversible-cost",
      compare: compareBy((node) => {
        const cost = (node.strategicTransition && node.strategicTransition.irreversibleCost) ||
          { total: 0 };
        return -number(cost.total, 0) * 1000000 - node.depth;
      }),
    },
    {
      id: "novel-semantic-state",
      compare: compareBy((node) => {
        const transition = node.strategicTransition;
        if (!transition) return 0;
        return (transition.newlyDiscoveredPOIs || []).length * 1000000000 -
          (transition.noLongerReachablePOIs || []).length * 1000 +
          node.depth;
      }),
    },
  ];
  return {
    definitions,
    queues: definitions.map((definition) => new BinaryHeap(definition.compare)),
    cursor: 0,
    push(node) {
      this.queues.forEach((queue) => queue.push(node));
    },
    pop(expanded) {
      for (let attempts = 0; attempts < this.queues.length; attempts += 1) {
        const queueIndex = this.cursor % this.queues.length;
        this.cursor += 1;
        const queue = this.queues[queueIndex];
        let node = queue.pop();
        while (node && expanded.has(node.nodeId)) node = queue.pop();
        if (node) return { node, queueId: this.definitions[queueIndex].id };
      }
      return null;
    },
    activeSize(expanded) {
      const ids = new Set();
      this.queues.forEach((queue) => queue.items.forEach((node) => {
        if (!expanded.has(node.nodeId)) ids.add(node.nodeId);
      }));
      return ids.size;
    },
  };
}

function compactWitness(simulator, terminalGoal, nodes, node, role) {
  const hero = (node.state || {}).hero || {};
  const transition = node.strategicTransition;
  return {
    role,
    nodeId: node.nodeId,
    depth: node.depth,
    floorId: node.state.floorId,
    hero: {
      hp: number(hero.hp, 0),
      atk: number(hero.atk, 0),
      def: number(hero.def, 0),
      mdef: number(hero.mdef, 0),
      lv: number(hero.lv, 0),
      exp: number(hero.exp, 0),
      equipment: Array.isArray(hero.equipment) ? hero.equipment.slice() : [],
    },
    optionCounts: { ...node.optionMap.counts },
    optionMapFingerprint: node.optionMap.fingerprint,
    reachablePoiCounts: node.reachablePoi ? { ...node.reachablePoi.counts } : null,
    reachablePoiFingerprint: node.reachablePoi ? node.reachablePoi.fingerprint : null,
    mutationCount: mutationCount(node.state),
    terminalBattle: terminalBattleProjection(simulator, node.state, terminalGoal),
    incomingTransition: transition ? {
      choice: transition.choiceLabel,
      targetPOI: transition.targetPOI,
      travelVariantCount: transition.travelVariantCount,
      exactPostStateCount: transition.exactPostStateCount,
      selectedVariant: transition.selectedVariant,
      newlyReachablePOIs: transition.newlyReachablePOIs,
      newlyDiscoveredPOIs: transition.newlyDiscoveredPOIs,
      noLongerReachablePOIs: transition.noLongerReachablePOIs,
      consumedOpportunities: transition.consumedOpportunities,
      irreversibleCost: transition.irreversibleCost,
      terminalBlockerDelta: transition.terminalBlockerDelta,
    } : null,
    lastActions: reconstructActionEntries(nodes, node)
      .slice(-6)
      .map((entry) => entry.summary),
  };
}

function enumerateStrategicActions(simulator, state, options) {
  const config = options || {};
  const raw = simulator.enumeratePrimitiveActions(state).actions || [];
  const additions = [];
  if (config.includeInteractPickup !== false && typeof simulator.enumerateInteractPickupActions === "function") {
    additions.push(...(simulator.enumerateInteractPickupActions(state) || []));
  }
  if (config.includeFloorFly === true && typeof simulator.enumerateFloorFlyActions === "function") {
    additions.push(...(simulator.enumerateFloorFlyActions(state) || []));
  }
  const byVariant = new Map();
  raw.concat(additions).forEach((action) => {
    if (!action) return;
    const key = recordedActionVariantIdentity(action);
    if (!byVariant.has(key)) byVariant.set(key, action);
  });
  const compareLegacyFilter = Boolean(config.compareLegacyFilter);
  const filtered = compareLegacyFilter
    ? simulator.sortActions(state, Array.from(byVariant.values()))
    : Array.from(byVariant.values());
  const filteredVariants = new Set(filtered.map(recordedActionVariantIdentity));
  return {
    actions: Array.from(byVariant.values()),
    rawVariantCount: byVariant.size,
    rawChoiceCount: new Set(Array.from(byVariant.values()).map((action) =>
      simulator.getActionFingerprint(action) || action.summary)).size,
    legacyVisibleVariantCount: filteredVariants.size,
    recoveredFromLegacyHeuristicFilter: Array.from(byVariant.keys())
      .filter((key) => !filteredVariants.has(key)).length,
  };
}

function compactTransition(transition, post, newlyDiscoveredPOIs) {
  return {
    schema: transition.schema,
    choice: transition.choice,
    choiceLabel: transition.choiceLabel,
    kind: transition.kind,
    targetPOI: transition.targetPOI,
    travelVariantCount: transition.travelVariantCount,
    exactPostStateCount: transition.exactPostStateCount,
    selectedVariant: post.appliedBy.summary,
    resourceDelta: post.resourceDelta,
    terminalBlockerDelta: post.terminalBlockerDelta,
    irreversibleCost: post.irreversibleCost,
    consumedOpportunities: post.consumedOpportunities,
    newlyReachablePOIs: post.newlyReachablePOIs,
    newlyDiscoveredPOIs,
    noLongerReachablePOIs: post.noLongerReachablePOIs,
    stillPresentButUnreachable: post.stillPresentButUnreachable,
  };
}

function compactPostTransition(post, choiceLabel, targetPOI) {
  return {
    schema: "motapathfinder.strategic-transition.v1",
    choice: choiceLabel,
    choiceLabel,
    kind: post.appliedBy ? post.appliedBy.kind : "unknown",
    targetPOI,
    travelVariantCount: 1,
    exactPostStateCount: 1,
    selectedVariant: post.appliedBy ? post.appliedBy.summary : null,
    resourceDelta: post.resourceDelta,
    terminalBlockerDelta: post.terminalBlockerDelta,
    irreversibleCost: post.irreversibleCost,
    consumedOpportunities: post.consumedOpportunities,
    newlyReachablePOIs: post.newlyReachablePOIs,
    noLongerReachablePOIs: post.noLongerReachablePOIs,
    stillPresentButUnreachable: post.stillPresentButUnreachable,
  };
}

function chainIrreversibleCost(chain) {
  const result = { battles: 0, doors: 0, events: 0, consumedItems: 0, consumedTools: 0, total: 0 };
  (chain || []).forEach((action) => {
    const kind = action && action.kind;
    if (kind === "battle") result.battles += 1;
    else if (kind === "openDoor") result.doors += 1;
    else if (kind === "event") result.events += 1;
    else if (kind === "pickup" || kind === "interactPickup") result.consumedItems += 1;
    else if (kind === "useTool") result.consumedTools += 1;
  });
  result.total = result.battles + result.doors + result.events + result.consumedItems + result.consumedTools;
  return result;
}

function hasTerminalBattleAction(actions, terminalGoal) {
  return (actions || []).some((action) =>
    action.kind === "battle" &&
    (action.floorId || (action.travelState && action.travelState.floorId)) === terminalGoal.floorId &&
    Number(action.x != null ? action.x : (action.target || {}).x) === Number(terminalGoal.x) &&
    Number(action.y != null ? action.y : (action.target || {}).y) === Number(terminalGoal.y));
}

function buildStrictReplayEvidence(project, simulatorFactory, projectRoot, initialState, goalNode, nodes, stats) {
  if (!goalNode) return null;
  const entries = reconstructActionEntries(nodes, goalNode);
  const finalState = cloneState(goalNode.state);
  finalState.route = entries;
  const routeRecord = buildRouteRecord({
    project,
    simulator: simulatorFactory(),
    initialState,
    finalState,
    options: {
      projectRoot,
      solver: "strategic-d2-search",
      profile: "terminal-only-strategic-frontier-v3",
      rank: ((initialState.meta || {}).rank) || "chaos",
      toFloor: goalNode.state.floorId,
      goalType: "bossDefeated",
      snapshotFloors: Object.keys(goalNode.state.visitedFloors || {}),
      expanded: stats.expansions,
      generated: stats.generated,
      metadata: {
        allowedInputs: ["tower", "route-free-current-state", "terminal-goal"],
        strategicDecisionCount: entries.length,
      },
    },
  });
  const replay = strictReplayRoute(project, simulatorFactory(), routeRecord);
  return {
    valid: Boolean(replay.valid),
    stepsAttempted: number(replay.stepsAttempted, 0),
    stepsCompleted: number(replay.stepsCompleted, 0),
    failureReason: replay.failureReason || null,
    routeRecord,
  };
}

function runStrategicD2Search(options) {
  const config = options || {};
  const { project, projectRoot, initialState, terminalGoal } = config;
  const simulatorFactory = config.simulatorFactory;
  if (!project || !initialState || !terminalGoal || typeof simulatorFactory !== "function") {
    throw new Error("Strategic D2 search requires project, projectRoot, initialState, terminalGoal, and simulatorFactory");
  }
  const simulator = simulatorFactory();
  const goalPredicate = buildSegmentGoalPredicate(project, { goal: terminalGoal }, simulator);
  const floorIds = Array.from(new Set([
    ...Object.keys(initialState.visitedFloors || {}),
    initialState.floorId,
    terminalGoal.floorId,
  ].filter(Boolean)));
  const stateIndex = createStrategicStateIndexCache(project, simulator, { floorIds });
  const rootState = cloneState(initialState);
  rootState.route = [];
  const rootKey = buildStateKey(rootState);
  const root = createRootNode(rootState, rootKey);
  const rootIndex = stateIndex.get(rootState);
  root.optionMap = rootIndex.optionMap;
  root.reachablePoi = rootIndex.reachablePoi;
  root.seenReachablePoiKeys = new Set(root.reachablePoi.entries.map((entry) => entry.key));
  root.order = 0;
  const agenda = makeAgenda(simulator, terminalGoal);
  agenda.push(root);
  const nodes = new Map([[root.nodeId, root]]);
  const seenExact = new Map([[rootKey, root.nodeId]]);
  const expanded = new Set();
  const maxExpansions = Math.max(1, number(config.maxExpansions, 1000));
  const startedAt = Date.now();
  const enableLazyWork = config.enableLazyWork !== false;
  const enableConnector = config.enableConnector !== false;
  const connectorMaxExpansions = Math.max(1, number(config.connectorMaxExpansions, 128));
  const connectorMaxDepth = Math.max(1, number(config.connectorMaxDepth, 8));
  const connectorMaxCalls = Math.max(0, number(config.connectorMaxCalls, 16));
  const lazyDrainEvery = Math.max(1, number(config.lazyDrainEvery, 8));
  const floorFlyMode = config.floorFlyMode === "lazy" ? "lazy" : "off";
  const connectorMode = config.connectorMode === "dependency-derived"
    ? "dependency-derived"
    : config.connectorMode === "blocker-derived" ? "blocker-derived" : "terminal";
  const dependencyConnectorMaxCalls = Math.max(0, number(
    config.dependencyConnectorMaxCalls,
    connectorMaxCalls,
  ));
  const dependencyConnectorMaxCandidatesPerNode = Math.max(1, number(
    config.dependencyConnectorMaxCandidatesPerNode,
    4,
  ));
  const dependencyAttemptMaxOutstanding = Math.max(1, number(
    config.dependencyAttemptMaxOutstanding,
    1,
  ));
  const maxTotalSearchExpansions = config.maxTotalSearchExpansions == null
    ? null
    : Math.max(0, number(config.maxTotalSearchExpansions, 0));
  const lazyWork = new LazyWorkQueue();
  const stats = {
    expansions: 0,
    generated: 0,
    accepted: 0,
    exactMerged: 0,
    applyRejected: 0,
    rawVariants: 0,
    legacyVisibleVariants: 0,
    recoveredFromLegacyHeuristicFilter: 0,
    optionMapsObserved: 1,
    optionChangingTransitions: 0,
    implicitOptionConsumptions: 0,
    implicitOptionConsumptionSamples: [],
    expandedByQueue: {},
    generatedByKind: {},
    uniqueChoiceCount: 0,
    travelVariantAliasCount: 0,
    terminalActionGenerated: 0,
    maxStrategicDepth: 0,
    maxFrontierSize: 1,
    deferredPostStates: 0,
    canonicalSelectionReasons: {},
    transitionsWithNewlyReachable: 0,
    transitionsWithLostReachability: 0,
    transitionsConsumingOpportunities: 0,
    transitionsWithTerminalBlockerImprovement: 0,
    transitionsWithLineageNovelty: 0,
    connectorCalls: 0,
    connectorResolved: 0,
    connectorBudgetExhausted: 0,
    connectorFrontierExhausted: 0,
    connectorFrontierTrimmed: 0,
    connectorExpansions: 0,
    connectorChainActions: 0,
    lazyDeferredPostsMaterialized: 0,
    lazyFloorFlyChoicesMaterialized: 0,
    lazyFloorFlyVariantsEnumerated: 0,
    lazyFloorFlyExactPostsObserved: 0,
    lazyFloorFlyExactPostsDeferred: 0,
    lazyConnectorChoicesMaterialized: 0,
    blockerConnectorCalls: 0,
    blockerConnectorImproved: 0,
    blockerConnectorNoImprovement: 0,
    blockerConnectorExpansions: 0,
    blockerConnectorBudgetExhausted: 0,
    blockerConnectorFrontierExhausted: 0,
    blockerConnectorFrontierTrimmed: 0,
    blockerConnectorChainActions: 0,
    dependencyCompiledCandidates: 0,
    dependencyConnectorCalls: 0,
    dependencyConnectorSatisfied: 0,
    dependencyConnectorNoSatisfied: 0,
    dependencyConnectorExpansions: 0,
    dependencyConnectorBudgetExhausted: 0,
    dependencyConnectorFrontierExhausted: 0,
    dependencyConnectorFrontierTrimmed: 0,
    dependencyConnectorChainActions: 0,
    terminalPrerequisiteSatisfied: 0,
    dependencySatisfied: 0,
    dependencyStateCreated: 0,
    dependencyGlobalBlockerAdvanced: 0,
    newTerminalRelevantDependencyReached: 0,
    dependencyWitnesses: [],
    dependencyAttemptWitnesses: [],
  };
  const observedChoices = new Set();
  const dependencyAttemptDedupe = createDependencyAttemptDedupe();
  const bestByRole = new Map(agenda.definitions.map((definition) => [definition.id, root]));
  const bestTerminalBlocker = { progressScore: null, attackMargin: null, stage: null, nodeId: null };
  function observeTerminalBlocker(node, projection) {
    if (!projection) return;
    const score = projection.progressScore;
    if (score != null && (bestTerminalBlocker.progressScore == null || score > bestTerminalBlocker.progressScore)) {
      bestTerminalBlocker.progressScore = score;
      bestTerminalBlocker.attackMargin = projection.attackMargin;
      bestTerminalBlocker.stage = projection.stage;
      bestTerminalBlocker.nodeId = node.nodeId;
    }
  }
  const totalSearchWork = () =>
    stats.expansions + stats.connectorExpansions + stats.blockerConnectorExpansions +
    stats.dependencyConnectorExpansions;
  const remainingTotalSearchWork = () => maxTotalSearchExpansions == null
    ? Infinity
    : Math.max(0, maxTotalSearchExpansions - totalSearchWork());
  const hasRemainingTotalSearchBudget = () =>
    maxTotalSearchExpansions == null || totalSearchWork() < maxTotalSearchExpansions;
  const connectorExpansionBudget = () => {
    if (maxTotalSearchExpansions == null) return connectorMaxExpansions;
    return Math.max(0, Math.min(
      connectorMaxExpansions,
      Math.floor(remainingTotalSearchWork()),
    ));
  };
  observeTerminalBlocker(root, terminalBattleProjection(simulator, root.state, terminalGoal));
  let nextNodeId = 1;
  let goalNode = goalPredicate(root.state) ? root : null;
  let firstGoalExpansion = goalNode ? 0 : null;

  function acceptLazyChild(parentNode, afterState, action, strategicTransition) {
    const exactKey = buildStateKey(afterState);
    if (seenExact.has(exactKey)) {
      return { node: nodes.get(seenExact.get(exactKey)), created: false, exactKey };
    }
    const child = createChildNode(
      parentNode,
      afterState,
      exactKey,
      {
        ...action,
        fingerprint: simulator.getActionFingerprint(action),
      },
      nextNodeId,
      nextNodeId,
    );
    nextNodeId += 1;
    const indexed = stateIndex.get(afterState);
    child.optionMap = indexed.optionMap;
    child.reachablePoi = indexed.reachablePoi;
    const newlyDiscoveredPOIs = indexed.reachablePoi.entries
      .filter((entry) => !parentNode.seenReachablePoiKeys.has(entry.key));
    child.seenReachablePoiKeys = new Set(parentNode.seenReachablePoiKeys);
    newlyDiscoveredPOIs.forEach((entry) => child.seenReachablePoiKeys.add(entry.key));
    if (strategicTransition) strategicTransition.newlyDiscoveredPOIs = newlyDiscoveredPOIs;
    child.strategicTransition = strategicTransition;
    if (strategicTransition && strategicTransition.terminalBlockerDelta) {
      observeTerminalBlocker(child, strategicTransition.terminalBlockerDelta.after);
    }
    nodes.set(child.nodeId, child);
    seenExact.set(exactKey, child.nodeId);
    agenda.push(child);
    stats.accepted += 1;
    stats.maxStrategicDepth = Math.max(stats.maxStrategicDepth, child.depth);
    if (newlyDiscoveredPOIs.length > 0) stats.transitionsWithLineageNovelty += 1;
    agenda.definitions.forEach((definition) => {
      const existing = bestByRole.get(definition.id);
      if (!existing || definition.compare(child, existing) > 0) {
        bestByRole.set(definition.id, child);
      }
    });
    return { node: child, created: true, exactKey };
  }

  function buildMacroTransition(beforeNode, afterState, chain, terminalGoalArg) {
    const indexed = stateIndex.get(afterState);
    const beforeOptionMap = beforeNode.optionMap;
    const beforeReachable = beforeNode.reachablePoi;
    const optionDelta = diffStrategicOptionMaps(beforeOptionMap, indexed.optionMap);
    const reachableDelta = diffReachablePoiSets(beforeReachable, indexed.reachablePoi, {
      project: simulator.project,
      state: afterState,
    });
    const beforeProjection = terminalBattleProjection(simulator, beforeNode.state, terminalGoalArg);
    const afterProjection = terminalBattleProjection(simulator, afterState, terminalGoalArg);
    const beforeScore = beforeProjection && beforeProjection.progressScore != null
      ? beforeProjection.progressScore
      : null;
    const afterScore = afterProjection && afterProjection.progressScore != null
      ? afterProjection.progressScore
      : null;
    const lastAction = chain && chain.length > 0 ? chain[chain.length - 1] : null;
    const beforeReachableKeys = new Set((beforeReachable.entries || []).map((entry) => entry.key));
    return {
      schema: "motapathfinder.strategic-transition.v1",
      choice: lastAction ? lastAction.summary : `connector-chain(${chain.length})`,
      choiceLabel: lastAction ? lastAction.summary : `connector-chain(${chain.length})`,
      kind: lastAction ? lastAction.kind : "connector-chain",
      targetPOI: lastAction ? explicitActionTargetKey(lastAction) : null,
      travelVariantCount: 1,
      exactPostStateCount: 1,
      selectedVariant: lastAction ? lastAction.summary : null,
      resourceDelta: summarizeResourceDelta(beforeNode.state, afterState),
      terminalBlockerDelta: {
        before: beforeProjection,
        after: afterProjection,
        delta: beforeScore != null && afterScore != null ? afterScore - beforeScore : null,
        improved: beforeScore != null && afterScore != null && afterScore > beforeScore,
        supported: Boolean(beforeProjection && afterProjection && beforeProjection.supported && afterProjection.supported),
      },
      irreversibleCost: chainIrreversibleCost(chain),
      consumedOpportunities: optionDelta.consumed.map((entry) => ({
        key: entry.key,
        kind: entry.kind,
        tileId: entry.tileId,
        role: "implicit",
        wasReachableBefore: beforeReachableKeys.has(entry.key),
      })),
      newlyReachablePOIs: reachableDelta.newlyReachable,
      noLongerReachablePOIs: reachableDelta.noLongerReachable,
      stillPresentButUnreachable: reachableDelta.stillPresentButUnreachable,
    };
  }

  function materializeConnectorChain(sourceNode, connectorResult) {
    const replay = verifyConnectorChain(simulator, sourceNode.state, connectorResult);
    if (!replay.valid) {
      return { ok: false, reason: replay.failureReason || "strict-replay-failed" };
    }
    let current = sourceNode;
    const steps = replay.replaySteps || [];
    const macroTransition = buildMacroTransition(
      sourceNode,
      replay.finalState,
      connectorResult.chain,
      terminalGoal,
    );
    let finalCreated = false;
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index];
      const accepted = acceptLazyChild(
        current,
        step.state,
        step.action,
        index === steps.length - 1 ? macroTransition : null,
      );
      current = accepted.node;
      if (index === steps.length - 1) finalCreated = accepted.created;
    }
    return steps.length > 0
      ? { ok: true, finalNode: current, finalState: current.state, finalCreated }
      : { ok: false, reason: "empty-chain" };
  }

  function drainOneLazyItem() {
    const queuedDependency = connectorMode === "dependency-derived"
      ? lazyWork.queued().find((item) =>
        item.kind === "dependency-connector-choice" &&
        item.sourceNodeId != null &&
        nodes.has(item.sourceNodeId))
      : null;
    const work = queuedDependency || lazyWork.dequeue((item) =>
      item.sourceNodeId != null && !nodes.has(item.sourceNodeId));
    if (!work) return false;

    if (work.kind === "deferred-exact-post") {
      const parentNode = nodes.get(work.sourceNodeId);
      const post = work.post;
      if (!parentNode || !post) {
        lazyWork.reject(work, "missing-source-or-post");
        return true;
      }
      if (seenExact.has(post.stateKey)) {
        lazyWork.reject(work, "exact-state-already-seen");
        return true;
      }
      const strategicTransition = compactPostTransition(post, work.choiceLabel, work.targetPOI);
      const accepted = acceptLazyChild(parentNode, post.state, post.appliedBy, strategicTransition);
      if (!accepted.created) {
        lazyWork.reject(work, "exact-state-merged");
        return true;
      }
      if (goalPredicate(post.state)) {
        goalNode = accepted.node;
        firstGoalExpansion = stats.expansions;
      }
      stats.lazyDeferredPostsMaterialized += 1;
      lazyWork.resolve(work, "materialized-deferred-post");
      return true;
    }

    if (work.kind === "floorfly-choice") {
      const sourceNode = nodes.get(work.sourceNodeId);
      if (!sourceNode) {
        lazyWork.reject(work, "missing-source");
        return true;
      }
      let actions = [];
      try {
        actions = (simulator.enumerateFloorFlyActions(sourceNode.state) || [])
          .filter((action) => action.targetFloorId === work.targetFloorId);
      } catch (_error) {
        actions = [];
      }
      if (actions.length === 0) {
        lazyWork.reject(work, "no-floorfly-variants");
        return true;
      }
      stats.lazyFloorFlyVariantsEnumerated += actions.length;
      const aggregation = aggregateVariantsIntoTransitions({
        simulator,
        state: sourceNode.state,
        actions,
        terminalGoal,
        stateIndex,
        beforeOptionMap: sourceNode.optionMap,
        beforeReachable: sourceNode.reachablePoi,
        choiceKeyBuilder: () => `floorFly|targetFloor:${work.targetFloorId}`,
        choiceLabelBuilder: () => `floorFly:${work.targetFloorId}`,
        targetPOIBuilder: () => `floor:${work.targetFloorId}`,
      });
      stats.lazyFloorFlyExactPostsObserved += aggregation.transitions.reduce(
        (sum, transition) => sum + transition.postStates.length,
        0,
      );
      let materialized = 0;
      for (const transition of aggregation.transitions) {
        const selection = selectCanonicalPostState(transition, { goalPredicate });
        if (!selection) continue;
        for (const post of transition.postStates) {
          if (post.stateKey === selection.postState.stateKey || seenExact.has(post.stateKey)) continue;
          lazyWork.enqueue({
            kind: "deferred-exact-post",
            sourceNodeId: sourceNode.nodeId,
            choiceLabel: transition.choiceLabel,
            targetPOI: transition.targetPOI,
            post,
          });
          stats.deferredPostStates += 1;
          stats.lazyFloorFlyExactPostsDeferred += 1;
        }
        const post = selection.postState;
        const strategicTransition = compactTransition(transition, post, []);
        const accepted = acceptLazyChild(sourceNode, post.state, post.appliedBy, strategicTransition);
        materialized += 1;
        if (goalPredicate(post.state)) {
          goalNode = accepted.node;
          firstGoalExpansion = stats.expansions;
          break;
        }
      }
      if (materialized === 0) {
        lazyWork.reject(work, "no-applicable-floorfly-posts");
        return true;
      }
      stats.lazyFloorFlyChoicesMaterialized += 1;
      lazyWork.resolve(work, "resolved-floorfly-choice");
      return true;
    }

    if (work.kind === "connector-choice") {
      const sourceNode = nodes.get(work.sourceNodeId);
      if (!sourceNode) {
        lazyWork.reject(work, "missing-source");
        return true;
      }
      if (stats.connectorCalls >= connectorMaxCalls) {
        lazyWork.reject(work, "connector-call-cap");
        return true;
      }
      const budget = connectorExpansionBudget();
      if (budget <= 0) {
        lazyWork.reject(work, "connector-total-search-budget-exhausted");
        return true;
      }
      stats.connectorCalls += 1;
      const result = runLocalConnector({
        simulator,
        sourceState: sourceNode.state,
        target: work.target,
        maxExpansions: budget,
        maxDepth: connectorMaxDepth,
      });
      stats.connectorExpansions += result.expansions;
      if (result.status !== "resolved") {
        if (result.status === "budget-exhausted") stats.connectorBudgetExhausted += 1;
        else if (result.status === "frontier-exhausted") stats.connectorFrontierExhausted += 1;
        else if (result.status === "frontier-trimmed") stats.connectorFrontierTrimmed += 1;
        lazyWork.reject(work, `connector-${result.status}`);
        return true;
      }
      const materialized = materializeConnectorChain(sourceNode, result);
      if (!materialized.ok) {
        lazyWork.reject(work, `connector-chain-apply-error:${materialized.reason}`);
        return true;
      }
      stats.connectorResolved += 1;
      stats.connectorChainActions += result.chain.length;
      if (goalPredicate(materialized.finalState)) {
        goalNode = materialized.finalNode;
        firstGoalExpansion = stats.expansions;
      }
      stats.lazyConnectorChoicesMaterialized += 1;
      lazyWork.resolve(work, materialized.finalCreated ? "connector-chain-materialized" : "connector-chain-merged");
      return true;
    }

    if (work.kind === "blocker-connector-choice") {
      const sourceNode = nodes.get(work.sourceNodeId);
      if (!sourceNode) {
        lazyWork.reject(work, "missing-source");
        return true;
      }
      if (stats.blockerConnectorCalls >= connectorMaxCalls) {
        lazyWork.reject(work, "blocker-connector-call-cap");
        return true;
      }
      const budget = connectorExpansionBudget();
      if (budget <= 0) {
        lazyWork.reject(work, "blocker-connector-total-search-budget-exhausted");
        return true;
      }
      stats.blockerConnectorCalls += 1;
      const result = runBlockerDerivedConnector({
        simulator,
        sourceState: sourceNode.state,
        terminalGoal,
        maxExpansions: budget,
        maxDepth: connectorMaxDepth,
      });
      stats.blockerConnectorExpansions += result.expansions;
      if (result.stoppedReason === "budget-exhausted") stats.blockerConnectorBudgetExhausted += 1;
      else if (result.stoppedReason === "frontier-exhausted") stats.blockerConnectorFrontierExhausted += 1;
      else if (result.stoppedReason === "frontier-trimmed") stats.blockerConnectorFrontierTrimmed += 1;
      if (result.status === "improved") stats.blockerConnectorImproved += 1;
      else stats.blockerConnectorNoImprovement += 1;
      if (result.chain.length === 0) {
        lazyWork.reject(work, `blocker-connector-${result.status}`);
        return true;
      }
      const materialized = materializeConnectorChain(sourceNode, result);
      if (!materialized.ok) {
        lazyWork.reject(work, `blocker-connector-chain-apply-error:${materialized.reason}`);
        return true;
      }
      stats.blockerConnectorChainActions += result.chain.length;
      if (goalPredicate(materialized.finalState)) {
        goalNode = materialized.finalNode;
        firstGoalExpansion = stats.expansions;
      }
      lazyWork.resolve(work, materialized.finalCreated
        ? "blocker-connector-chain-materialized"
        : "blocker-connector-chain-merged");
      return true;
    }

    if (work.kind === "dependency-connector-choice") {
      const sourceNode = nodes.get(work.sourceNodeId);
      const dependency = work.dependency;
      if (!sourceNode || !dependency || typeof dependency.completionPredicate !== "function") {
        lazyWork.reject(work, "missing-source-or-dependency");
        return true;
      }
      if (stats.dependencyConnectorCalls >= dependencyConnectorMaxCalls) {
        lazyWork.reject(work, "dependency-connector-call-cap");
        return true;
      }
      const budget = connectorExpansionBudget();
      if (budget <= 0) {
        lazyWork.reject(work, "dependency-connector-total-search-budget-exhausted");
        return true;
      }
      stats.dependencyConnectorCalls += 1;
      const result = runDependencyConnector({
        simulator,
        sourceState: sourceNode.state,
        dependency,
        maxExpansions: budget,
        maxDepth: connectorMaxDepth,
      });
      if (stats.dependencyAttemptWitnesses.length < dependencyConnectorMaxCalls) {
        stats.dependencyAttemptWitnesses.push({
          semanticDependencyId: dependency.id,
          attemptId: dependencyAttemptId(dependency, sourceNode.state),
          sourceNodeId: sourceNode.nodeId,
          sourceExactStateFingerprint: dependency.provenance &&
            dependency.provenance.sourceExactStateFingerprint,
          kind: dependency.kind,
          capability: dependency.capability,
          target: dependency.target,
          status: result.status,
          stoppedReason: result.stoppedReason,
          expansions: result.expansions,
        });
      }
      stats.dependencyConnectorExpansions += result.expansions;
      if (result.stoppedReason === "budget-exhausted") stats.dependencyConnectorBudgetExhausted += 1;
      else if (result.stoppedReason === "frontier-exhausted") stats.dependencyConnectorFrontierExhausted += 1;
      else if (result.stoppedReason === "frontier-trimmed") stats.dependencyConnectorFrontierTrimmed += 1;
      if (result.status !== "satisfied") {
        stats.dependencyConnectorNoSatisfied += 1;
        lazyWork.reject(work, `dependency-connector-${result.stoppedReason}`);
        return true;
      }
      if (result.chain.length === 0) {
        lazyWork.reject(work, "dependency-connector-empty-chain");
        return true;
      }
      const bestBeforeMaterialize = bestTerminalBlocker.progressScore;
      const materialized = materializeConnectorChain(sourceNode, result);
      if (!materialized.ok) {
        lazyWork.reject(work, `dependency-connector-chain-apply-error:${materialized.reason}`);
        return true;
      }
      let completionStillTrue = false;
      try {
        completionStillTrue = dependency.completionPredicate(materialized.finalState);
      } catch (_error) {
        completionStillTrue = false;
      }
      if (!completionStillTrue) {
        lazyWork.reject(work, "dependency-completion-not-preserved-after-replay");
        return true;
      }
      stats.dependencyConnectorSatisfied += 1;
      stats.terminalPrerequisiteSatisfied += 1;
      stats.dependencySatisfied += 1;
      stats.dependencyConnectorChainActions += result.chain.length;
      if (materialized.finalCreated) stats.dependencyStateCreated += 1;
      const finalProjection = terminalBattleProjection(simulator, materialized.finalState, terminalGoal);
      const reachedNewBest = materialized.finalCreated &&
        bestBeforeMaterialize != null &&
        finalProjection && finalProjection.progressScore != null &&
        finalProjection.progressScore > bestBeforeMaterialize;
      if (reachedNewBest) {
        stats.dependencyGlobalBlockerAdvanced += 1;
        stats.newTerminalRelevantDependencyReached += 1;
      }
      if (stats.dependencyWitnesses.length < 8) {
        stats.dependencyWitnesses.push({
          dependencyId: dependency.id,
          kind: dependency.kind,
          capability: dependency.capability,
          target: dependency.target,
          sourceNodeId: sourceNode.nodeId,
          chainActions: result.chain.length,
          beforeProgressScore: dependency.beforeBlocker && dependency.beforeBlocker.progressScore,
          afterProgressScore: finalProjection && finalProjection.progressScore,
          expectedProgressScore: dependency.afterBlocker && dependency.afterBlocker.progressScore,
          finalCreated: materialized.finalCreated,
          reachedNewBest,
          sourceStateFingerprint: dependency.provenance &&
            dependency.provenance.sourceExactStateFingerprint,
          acquisitionMechanism: dependency.target && dependency.target.acquisition
            ? dependency.target.acquisition.mechanism
            : null,
        });
      }
      if (goalPredicate(materialized.finalState)) {
        goalNode = materialized.finalNode;
        firstGoalExpansion = stats.expansions;
      }
      lazyWork.resolve(work, materialized.finalCreated
        ? "dependency-prerequisite-materialized"
        : "dependency-prerequisite-merged");
      return true;
    }

    lazyWork.reject(work, "unknown-kind");
    return true;
  }

  while (!goalNode && stats.expansions < maxExpansions && hasRemainingTotalSearchBudget()) {
    if (enableLazyWork && lazyWork.activeSize() > 0 && stats.expansions > 0 &&
        stats.expansions % lazyDrainEvery === 0) {
      drainOneLazyItem();
      if (goalNode || !hasRemainingTotalSearchBudget()) break;
    }
    let selected = agenda.pop(expanded);
    if (!selected && enableLazyWork && lazyWork.activeSize() > 0 && hasRemainingTotalSearchBudget()) {
      drainOneLazyItem();
      if (goalNode || !hasRemainingTotalSearchBudget()) break;
      selected = agenda.pop(expanded);
    }
    if (!selected || !hasRemainingTotalSearchBudget()) break;
    const node = selected.node;
    if (!hasRemainingTotalSearchBudget()) break;
    expanded.add(node.nodeId);
    stats.expansions += 1;
    stats.expandedByQueue[selected.queueId] = number(stats.expandedByQueue[selected.queueId], 0) + 1;
    let enumerated;
    try {
      enumerated = enumerateStrategicActions(simulator, node.state, {
        compareLegacyFilter: stats.expansions === 1,
        includeFloorFly: false,
      });
    } catch (_error) {
      continue;
    }
    stats.rawVariants += enumerated.rawVariantCount;
    stats.legacyVisibleVariants += enumerated.legacyVisibleVariantCount;
    stats.recoveredFromLegacyHeuristicFilter += enumerated.recoveredFromLegacyHeuristicFilter;
    const aggregation = aggregateVariantsIntoTransitions({
      simulator,
      state: node.state,
      actions: enumerated.actions,
      terminalGoal,
      stateIndex,
      beforeOptionMap: node.optionMap,
      beforeReachable: node.reachablePoi,
    });
    stats.applyRejected += aggregation.rejectedVariantCount;
    stats.travelVariantAliasCount += Math.max(0, aggregation.variantCount - aggregation.choiceCount);
    for (const transition of aggregation.transitions) {
      stats.generated += 1;
      observedChoices.add(transition.choice);
      for (const variant of transition.travelVariants) {
        const kind = variant.kind || "unknown";
        stats.generatedByKind[kind] = number(stats.generatedByKind[kind], 0) + 1;
        if (
          variant.kind === "battle" &&
          variant.floorId === terminalGoal.floorId &&
          Number(variant.x) === Number(terminalGoal.x) &&
          Number(variant.y) === Number(terminalGoal.y)
        ) stats.terminalActionGenerated += 1;
      }
      const unionNewlyReachable = new Set();
      const unionNoLongerReachable = new Set();
      let transitionConsumesOpportunities = false;
      let transitionTerminalBlockerImproved = false;
      for (const post of transition.postStates) {
        post.newlyReachablePOIs.forEach((entry) => unionNewlyReachable.add(entry.key));
        post.noLongerReachablePOIs.forEach((entry) => unionNoLongerReachable.add(entry.key));
        if (post.consumedOpportunities.length > 0) transitionConsumesOpportunities = true;
        if (post.terminalBlockerDelta && post.terminalBlockerDelta.improved) {
          transitionTerminalBlockerImproved = true;
        }
        const implicit = post.consumedOpportunities.filter((entry) => entry.role === "implicit");
        if (implicit.length > 0) {
          stats.implicitOptionConsumptions += implicit.length;
          if (stats.implicitOptionConsumptionSamples.length < 12) {
            stats.implicitOptionConsumptionSamples.push({
              action: transition.choiceLabel,
              explicitTarget: transition.targetPOI,
              consumed: implicit.map((entry) => ({ key: entry.key, kind: entry.kind, tileId: entry.tileId })),
            });
          }
        }
      }
      if (unionNewlyReachable.size > 0) stats.transitionsWithNewlyReachable += 1;
      if (unionNoLongerReachable.size > 0) stats.transitionsWithLostReachability += 1;
      if (transitionConsumesOpportunities) stats.transitionsConsumingOpportunities += 1;
      if (transitionTerminalBlockerImproved) stats.transitionsWithTerminalBlockerImprovement += 1;
      if (transition.postStates.some((post) =>
        post.optionDelta.consumed.length > 0 || post.optionDelta.created.length > 0)) {
        stats.optionChangingTransitions += 1;
      }
      const selection = selectCanonicalPostState(transition, { goalPredicate });
      if (!selection) continue;
      const post = selection.postState;
      stats.canonicalSelectionReasons[selection.reason] =
        number(stats.canonicalSelectionReasons[selection.reason], 0) + 1;
      const exactKey = post.stateKey;
      // 5.18c: non-canonical exact posts become recoverable lazy work instead of
      // a silently discarded count.
      if (enableLazyWork) {
        for (const candidate of transition.postStates) {
          if (candidate.stateKey === exactKey) continue;
          if (seenExact.has(candidate.stateKey)) continue;
          lazyWork.enqueue({
            kind: "deferred-exact-post",
            sourceNodeId: node.nodeId,
            choiceLabel: transition.choiceLabel,
            targetPOI: transition.targetPOI,
            post: candidate,
          });
          stats.deferredPostStates += 1;
        }
      } else {
        stats.deferredPostStates += transition.postStates
          .filter((candidate) => candidate.stateKey !== exactKey && !seenExact.has(candidate.stateKey))
          .length;
      }
      if (seenExact.has(exactKey)) {
        stats.exactMerged += 1;
        continue;
      }
      const child = createChildNode(
        node,
        post.state,
        exactKey,
        {
          ...post.appliedBy,
          fingerprint: simulator.getActionFingerprint(post.appliedBy),
        },
        nextNodeId,
        nextNodeId,
      );
      nextNodeId += 1;
      child.optionMap = post.optionMap;
      child.reachablePoi = post.reachablePoi;
      const newlyDiscoveredPOIs = post.reachablePoi.entries
        .filter((entry) => !node.seenReachablePoiKeys.has(entry.key));
      child.seenReachablePoiKeys = new Set(node.seenReachablePoiKeys);
      newlyDiscoveredPOIs.forEach((entry) => child.seenReachablePoiKeys.add(entry.key));
      if (newlyDiscoveredPOIs.length > 0) stats.transitionsWithLineageNovelty += 1;
      child.strategicTransition = compactTransition(transition, post, newlyDiscoveredPOIs);
      if (child.strategicTransition && child.strategicTransition.terminalBlockerDelta) {
        observeTerminalBlocker(child, child.strategicTransition.terminalBlockerDelta.after);
      }
      nodes.set(child.nodeId, child);
      seenExact.set(exactKey, child.nodeId);
      agenda.push(child);
      stats.accepted += 1;
      stats.maxStrategicDepth = Math.max(stats.maxStrategicDepth, child.depth);
      agenda.definitions.forEach((definition) => {
        const existing = bestByRole.get(definition.id);
        if (!existing || definition.compare(child, existing) > 0) {
          bestByRole.set(definition.id, child);
        }
      });
      if (selection.reason === "goal-reached") {
        goalNode = child;
        firstGoalExpansion = stats.expansions;
        break;
      }
    }

    // 5.18c/5.18d/5.18e: enqueue the selected connector work.
    if (enableConnector && enableLazyWork) {
      if (connectorMode === "dependency-derived") {
        const queuedCount = lazyWork.queued()
          .filter((work) => work.kind === "dependency-connector-choice").length;
        const remainingSlots = dependencyConnectorMaxCalls -
          stats.dependencyConnectorCalls - queuedCount;
        if (remainingSlots > 0) {
          const reachableCandidates = compileDependenciesFromTransitions({
            project,
            simulator,
            terminalGoal,
            state: node.state,
            transitions: aggregation.transitions,
            maxCandidates: dependencyConnectorMaxCandidatesPerNode,
          });
          const unreachableCandidates = compileUnreachableTerminalDependencies({
            project,
            simulator,
            terminalGoal,
            state: node.state,
            reachablePoi: node.reachablePoi,
            optionMap: node.optionMap,
            maxCandidates: dependencyConnectorMaxCandidatesPerNode,
          });
          const candidates = unreachableCandidates
            .concat(reachableCandidates)
            .sort((left, right) => {
              const leftReachable = left.provenance.reachableAtCompileTime ? 1 : 0;
              const rightReachable = right.provenance.reachableAtCompileTime ? 1 : 0;
              return leftReachable - rightReachable ||
                ((right.provenance.expectedCapabilityDelta.progressScore || 0) -
                  (left.provenance.expectedCapabilityDelta.progressScore || 0)) ||
                left.id.localeCompare(right.id);
            });
          stats.dependencyCompiledCandidates += candidates.length;
          const queuedCount = lazyWork.queued()
            .filter((work) => work.kind === "dependency-connector-choice").length;
          const selectedAttempts = selectFeedbackAwareDependencyAttempts({
            candidates,
            sourceState: node.state,
            dedupe: dependencyAttemptDedupe,
            maxCalls: dependencyConnectorMaxCalls,
            callsExecuted: stats.dependencyConnectorCalls,
            queuedCount,
            maxOutstanding: dependencyAttemptMaxOutstanding,
          });
          for (const dependency of selectedAttempts) {
            lazyWork.enqueue({
              kind: "dependency-connector-choice",
              sourceNodeId: node.nodeId,
              dependency,
            });
          }
        }
      } else if (connectorMode === "blocker-derived") {
        if (stats.blockerConnectorCalls < connectorMaxCalls) {
          const blocker = analyzeTerminalBlocker(simulator, node.state, terminalGoal);
          if (blocker.stage === "attack-blocked" || blocker.stage === "lethal") {
            lazyWork.enqueue({
              kind: "blocker-connector-choice",
              sourceNodeId: node.nodeId,
            });
          }
        }
      } else if (stats.connectorCalls < connectorMaxCalls &&
          !hasTerminalBattleAction(enumerated.actions, terminalGoal)) {
        lazyWork.enqueue({
          kind: "connector-choice",
          sourceNodeId: node.nodeId,
          target: buildTerminalChoiceTarget(terminalGoal),
        });
      }
    }
    if (enableLazyWork && floorFlyMode === "lazy" &&
        typeof simulator.enumerateFloorFlyActions === "function") {
      const flyTargets = new Set();
      try {
        simulator.enumerateFloorFlyActions(node.state).forEach((action) => {
          if (action.targetFloorId) flyTargets.add(action.targetFloorId);
        });
      } catch (_error) {
        // leave empty
      }
      for (const targetFloorId of flyTargets) {
        lazyWork.enqueue({
          kind: "floorfly-choice",
          sourceNodeId: node.nodeId,
          targetFloorId,
        });
      }
    }

    stats.maxFrontierSize = Math.max(stats.maxFrontierSize, agenda.activeSize(expanded));
  }
  stats.optionMapsObserved = stateIndex.optionMaps.size;
  stats.uniqueChoiceCount = observedChoices.size;
  stats.totalSearchExpansions = totalSearchWork();
  const frontierSize = agenda.activeSize(expanded);
  const activeLazyWork = lazyWork.activeSize();
  const strategicBudgetExhausted = !goalNode && stats.expansions >= maxExpansions &&
    (frontierSize > 0 || activeLazyWork > 0);
  const totalSearchBudgetExhausted = !goalNode && maxTotalSearchExpansions != null &&
    stats.totalSearchExpansions >= maxTotalSearchExpansions &&
    (frontierSize > 0 || activeLazyWork > 0);
  const budgetExhausted = strategicBudgetExhausted || totalSearchBudgetExhausted;
  const frontierExhausted = !goalNode && frontierSize === 0;
  const deferredWorkRemaining = !goalNode && activeLazyWork > 0;
  let stoppedReason = "frontier-exhausted";
  if (goalNode) stoppedReason = "goal-found";
  else if (strategicBudgetExhausted && totalSearchBudgetExhausted) stoppedReason = "strategic-and-total-search-budget";
  else if (strategicBudgetExhausted) stoppedReason = "strategic-budget";
  else if (totalSearchBudgetExhausted) stoppedReason = "total-search-budget";
  else if (deferredWorkRemaining) stoppedReason = "deferred-work-remaining";
  const replay = goalNode
    ? buildStrictReplayEvidence(
        project,
        simulatorFactory,
        projectRoot,
        initialState,
        goalNode,
        nodes,
        stats,
      )
    : null;
  return {
    schema: SCHEMA,
    inputContract: {
      allowedInputs: ["tower", "route-free-current-state", "terminal-goal"],
      forbiddenInputs: [
        "route-fixture",
        "route-prefix",
        "intermediate-milestone",
        "authored-event-order",
        "authored-resource-threshold",
      ],
      knownRouteUsed: false,
    },
    controls: {
      maxExpansions,
      maxRuntimeMs: 0,
      actionSource: "complete-primitive-actions-before-legacy-heuristic-filter",
      supplementalActionKinds: {
        interactPickup: "enabled",
        floorFly: floorFlyMode === "lazy"
          ? "lazy-choice-level-resolution"
          : "deferred-from-minimal-D2-vertical-slice",
      },
      pruning: ["exact-state-merge-only"],
      agendaQueues: agenda.definitions.map((definition) => definition.id),
      optionMap: "base-2d-grid-plus-sparse-state-mutations",
      reachablePoi: "walk-reachability-adjacency-index-with-before-after-diff",
      transitionContract: {
        choiceAggregation: "path-independent-action-fingerprint",
        travelVariants: "kept-inside-transition-one-frontier-slot-per-choice",
        reachablePoiDiff: "newly-reachable-vs-no-longer-reachable-poi-diff",
        opportunityCost: "active-vs-implicit-consumption-plus-still-present-but-unreachable",
        terminalBlockerDelta: "terminal-battle-stage-and-progress-before-after",
        retentionRule: "goal-state > future-reachable-positive-options > terminal-blocker-progress > hp > fewer-mutations > deterministic-state-key",
      },
      lazyResolution: {
        enabled: enableLazyWork,
        deferredExactPosts: enableLazyWork ? "recoverable-via-lazy-queue" : "recorded-not-expanded",
        floorFly: floorFlyMode === "lazy" ? "lazy-choice-level-resolution" : "off",
        localDpConnector: enableConnector
          ? "enabled-bounded-local-primitive-connector"
          : "disabled",
      },
      connector: {
        enabled: enableConnector,
        mode: connectorMode,
        maxExpansions: connectorMaxExpansions,
        maxDepth: connectorMaxDepth,
        maxCalls: connectorMaxCalls,
        target: connectorMode === "dependency-derived"
          ? "dependency-compiled-discrete-prerequisite"
          : connectorMode === "blocker-derived"
            ? "blocker-derived-intermediate-optimizer"
            : "terminal-boss-choice-when-not-directly-enumerable",
        budgetScope: maxTotalSearchExpansions == null
          ? "connector-expansions-are-additional-to-strategic-frontier-expansions"
          : "shared-total-search-work-budget",
        maxTotalSearchExpansions,
        dependencyConnector: connectorMode === "dependency-derived" ? {
          maxCalls: dependencyConnectorMaxCalls,
          maxCandidatesPerNode: dependencyConnectorMaxCandidatesPerNode,
          maxOutstandingAttempts: dependencyAttemptMaxOutstanding,
          scheduling: "feedback-aware-one-outstanding-attempt",
          vocabulary: ["equipment-acquisition", "resource/power-opportunity-acquisition"],
          successCondition: "dependency-completionPredicate-only-not-scalar-optimization",
        } : null,
      },
      completenessLimitations: [
        "exact-state-merge-only-no-dominance",
        "connector-is-bounded-local-search-not-canonical-correctness-proof",
        "lazy-resolution-is-demand-driven-not-exhaustive",
      ],
    },
    outcome: {
      goalFound: Boolean(goalNode),
      frontierExhausted,
      strategicBudgetExhausted,
      totalSearchBudgetExhausted,
      budgetExhausted,
      stoppedReason,
      deferredWorkRemaining,
      searchComplete: Boolean(goalNode || (frontierExhausted && !deferredWorkRemaining)),
      firstGoalExpansion,
      frontierSize,
      wallMs: Date.now() - startedAt,
    },
    stats,
    bestTerminalBlocker: {
      progressScore: bestTerminalBlocker.progressScore,
      attackMargin: bestTerminalBlocker.attackMargin,
      stage: bestTerminalBlocker.stage,
      nodeId: bestTerminalBlocker.nodeId,
    },
    lazyWork: lazyWork.snapshot(),
    frontierWitnesses: agenda.definitions.map((definition) =>
      compactWitness(
        simulator,
        terminalGoal,
        nodes,
        bestByRole.get(definition.id),
        definition.id,
      )),
    best: goalNode ? {
      nodeId: goalNode.nodeId,
      exactStateFingerprint: hash(goalNode.stateKey),
      strategicDecisionCount: reconstructActionEntries(nodes, goalNode).length,
      hero: { ...(goalNode.state.hero || {}) },
      optionCounts: goalNode.optionMap.counts,
      incomingTransition: goalNode.strategicTransition ? compactWitness(
        simulator,
        terminalGoal,
        nodes,
        goalNode,
        "best",
      ).incomingTransition : null,
    } : null,
    replay: replay ? {
      valid: replay.valid,
      stepsAttempted: replay.stepsAttempted,
      stepsCompleted: replay.stepsCompleted,
      failureReason: replay.failureReason,
      routeFingerprint: hash(JSON.stringify(replay.routeRecord.decisions.map((decision) => decision.summary))),
    } : null,
    routeRecord: replay && replay.routeRecord,
    verdict: goalNode && replay && replay.valid
      ? "D2_STRATEGIC_SEARCH_STRICT_REPLAY_VERIFIED"
      : goalNode
        ? "D2_STRATEGIC_SEARCH_REPLAY_FAILED"
        : budgetExhausted
          ? "D2_STRATEGIC_SEARCH_INCOMPLETE_WITHIN_BUDGET"
          : deferredWorkRemaining
            ? "D2_STRATEGIC_SEARCH_INCOMPLETE_WITH_DEFERRED_WORK"
          : "D2_STRATEGIC_SEARCH_FRONTIER_EXHAUSTED",
  };
}

module.exports = {
  enumerateStrategicActions,
  runStrategicD2Search,
};
