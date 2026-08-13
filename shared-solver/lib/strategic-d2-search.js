"use strict";

const crypto = require("node:crypto");

const { strictReplayRoute } = require("./agenda-policy-evaluation");
const { buildSegmentGoalPredicate } = require("./segment-dp");
const { buildRouteRecord, recordedActionVariantIdentity } = require("./route-store");
const { buildStateKey } = require("./state-key");
const { cloneState, listFloorMutationSummary } = require("./state");
const {
  createStrategicOptionMapCache,
  diffStrategicOptionMaps,
} = require("./strategic-option-map");
const {
  createChildNode,
  createRootNode,
  normalizeActionEntry,
  reconstructActionEntries,
} = require("./search-nodes");

const SCHEMA = "motapathfinder.strategic-d2-search.v1";

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

function mutationCount(state) {
  return listFloorMutationSummary((state || {}).floorStates || {})
    .reduce((sum, floor) => sum + (floor.removed || []).length + (floor.replaced || []).length, 0);
}

function heroScore(state) {
  const hero = (state || {}).hero || {};
  return number(hero.atk, 0) * 1000000 +
    number(hero.def, 0) * 1000000 +
    number(hero.mdef, 0) * 1000 +
    number(hero.lv, 0) * 100000 +
    number(hero.exp, 0);
}

function terminalBattleProjection(simulator, state, terminalGoal) {
  if (!terminalGoal || terminalGoal.type !== "bossDefeated") return null;
  try {
    const evaluation = simulator.battleResolver.evaluateBattle(
      state,
      terminalGoal.floorId,
      terminalGoal.x,
      terminalGoal.y,
      terminalGoal.enemyId,
    );
    const damage = evaluation && evaluation.damageInfo && evaluation.damageInfo.damage;
    return {
      supported: Boolean(evaluation && evaluation.supported),
      damage: damage == null ? null : number(damage, null),
      margin: damage == null ? null : number((state.hero || {}).hp, 0) - number(damage, 0),
    };
  } catch (_error) {
    return null;
  }
}

function goalPriority(simulator, state, terminalGoal) {
  const projection = terminalBattleProjection(simulator, state, terminalGoal);
  const onGoalFloor = state.floorId === terminalGoal.floorId ? 1 : 0;
  const margin = projection && projection.margin != null
    ? Math.max(-1000000000, projection.margin)
    : -1000000000;
  return onGoalFloor * 1000000000000 + margin + heroScore(state);
}

function compareBy(score) {
  return (left, right) => score(left) - score(right) || right.order - left.order;
}

function makeAgenda(simulator, terminalGoal, initialOptionCount) {
  const definitions = [
    {
      id: "goal-progress",
      compare: compareBy((node) => goalPriority(simulator, node.state, terminalGoal)),
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
      id: "resource-options",
      compare: compareBy((node) =>
        node.optionMap.counts.item * 100000000 +
        (initialOptionCount - node.optionMap.counts.total) * 10000 +
        mutationCount(node.state)),
    },
    {
      id: "novel-progress",
      compare: compareBy((node) =>
        Object.keys(node.state.visitedFloors || {}).length * 100000000 +
        mutationCount(node.state) * 1000 +
        node.depth),
    },
    {
      id: "low-commitment",
      compare: compareBy((node) => -node.depth),
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
    mutationCount: mutationCount(node.state),
    terminalBattle: terminalBattleProjection(simulator, node.state, terminalGoal),
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
  const rawChoices = new Set(Array.from(byVariant.values()).map((action) =>
    simulator.getActionFingerprint(action) || action.summary));
  return {
    actions: Array.from(byVariant.values()),
    rawVariantCount: byVariant.size,
    rawChoiceCount: rawChoices.size,
    legacyVisibleVariantCount: filteredVariants.size,
    recoveredFromLegacyHeuristicFilter: Array.from(byVariant.keys())
      .filter((key) => !filteredVariants.has(key)).length,
  };
}

function explicitActionTargetKey(action) {
  if (!action) return null;
  const floorId = action.floorId || (action.travelState && action.travelState.floorId);
  const target = action.target || {};
  const x = action.x != null ? action.x : target.x;
  const y = action.y != null ? action.y : target.y;
  return floorId && x != null && y != null ? `${floorId}:${x},${y}` : null;
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
      profile: "terminal-only-strategic-frontier-v1",
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
  const optionMaps = createStrategicOptionMapCache(project, { floorIds });
  const rootState = cloneState(initialState);
  rootState.route = [];
  const rootKey = buildStateKey(rootState);
  const root = createRootNode(rootState, rootKey);
  root.optionMap = optionMaps.get(rootState);
  root.order = 0;
  const agenda = makeAgenda(simulator, terminalGoal, root.optionMap.counts.total);
  agenda.push(root);
  const nodes = new Map([[root.nodeId, root]]);
  const seenExact = new Map([[rootKey, root.nodeId]]);
  const expanded = new Set();
  const maxExpansions = Math.max(1, number(config.maxExpansions, 1000));
  const startedAt = Date.now();
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
  };
  const observedChoices = new Set();
  const bestByRole = new Map(agenda.definitions.map((definition) => [definition.id, root]));
  let nextNodeId = 1;
  let goalNode = goalPredicate(root.state) ? root : null;
  let firstGoalExpansion = goalNode ? 0 : null;
  while (!goalNode && stats.expansions < maxExpansions) {
    const selected = agenda.pop(expanded);
    if (!selected) break;
    const node = selected.node;
    expanded.add(node.nodeId);
    stats.expansions += 1;
    stats.expandedByQueue[selected.queueId] = number(stats.expandedByQueue[selected.queueId], 0) + 1;
    let enumerated;
    try {
      enumerated = enumerateStrategicActions(simulator, node.state, {
        compareLegacyFilter: stats.expansions === 1,
        includeFloorFly: config.includeFloorFly === true,
      });
    } catch (_error) {
      continue;
    }
    stats.rawVariants += enumerated.rawVariantCount;
    stats.travelVariantAliasCount += Math.max(
      0,
      enumerated.rawVariantCount - enumerated.rawChoiceCount,
    );
    stats.legacyVisibleVariants += enumerated.legacyVisibleVariantCount;
    stats.recoveredFromLegacyHeuristicFilter += enumerated.recoveredFromLegacyHeuristicFilter;
    for (const action of enumerated.actions) {
      stats.generated += 1;
      const choiceFingerprint = simulator.getActionFingerprint(action) || action.summary;
      observedChoices.add(choiceFingerprint);
      if (
        action.kind === "battle" &&
        (action.floorId || (action.travelState && action.travelState.floorId)) === terminalGoal.floorId &&
        Number(action.x != null ? action.x : (action.target || {}).x) === Number(terminalGoal.x) &&
        Number(action.y != null ? action.y : (action.target || {}).y) === Number(terminalGoal.y)
      ) stats.terminalActionGenerated += 1;
      const kind = action.kind || "unknown";
      stats.generatedByKind[kind] = number(stats.generatedByKind[kind], 0) + 1;
      let nextState;
      try {
        nextState = simulator.applyAction(node.state, action, { storeRoute: false });
      } catch (_error) {
        stats.applyRejected += 1;
        continue;
      }
      nextState.route = [];
      const exactKey = buildStateKey(nextState);
      if (seenExact.has(exactKey)) {
        stats.exactMerged += 1;
        continue;
      }
      const child = createChildNode(
        node,
        nextState,
        exactKey,
        {
          ...action,
          fingerprint: simulator.getActionFingerprint(action),
        },
        nextNodeId,
        nextNodeId,
      );
      nextNodeId += 1;
      child.optionMap = optionMaps.get(nextState);
      const optionDelta = diffStrategicOptionMaps(node.optionMap, child.optionMap);
      child.optionDelta = optionDelta;
      if (optionDelta.consumed.length > 0 || optionDelta.created.length > 0) {
        stats.optionChangingTransitions += 1;
      }
      const explicitTarget = explicitActionTargetKey(action);
      const implicit = optionDelta.consumed.filter((entry) => entry.key !== explicitTarget);
      if (implicit.length > 0) {
        stats.implicitOptionConsumptions += implicit.length;
        if (stats.implicitOptionConsumptionSamples.length < 12) {
          stats.implicitOptionConsumptionSamples.push({
            action: action.summary,
            explicitTarget,
            consumed: implicit.map((entry) => ({ key: entry.key, kind: entry.kind, tileId: entry.tileId })),
          });
        }
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
      if (goalPredicate(nextState)) {
        goalNode = child;
        firstGoalExpansion = stats.expansions;
        break;
      }
    }
    stats.maxFrontierSize = Math.max(stats.maxFrontierSize, agenda.activeSize(expanded));
  }
  stats.optionMapsObserved = optionMaps.size;
  stats.uniqueChoiceCount = observedChoices.size;
  const frontierSize = agenda.activeSize(expanded);
  const budgetExhausted = !goalNode && stats.expansions >= maxExpansions && frontierSize > 0;
  const frontierExhausted = !goalNode && frontierSize === 0;
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
        floorFly: config.includeFloorFly === true
          ? "enabled"
          : "deferred-from-minimal-D2-vertical-slice",
      },
      pruning: ["exact-state-merge-only"],
      agendaQueues: agenda.definitions.map((definition) => definition.id),
      optionMap: "base-2d-grid-plus-sparse-state-mutations",
    },
    outcome: {
      goalFound: Boolean(goalNode),
      frontierExhausted,
      budgetExhausted,
      searchComplete: Boolean(goalNode || frontierExhausted),
      firstGoalExpansion,
      frontierSize,
      wallMs: Date.now() - startedAt,
    },
    stats,
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
          : "D2_STRATEGIC_SEARCH_FRONTIER_EXHAUSTED",
  };
}

module.exports = {
  SCHEMA,
  enumerateStrategicActions,
  runStrategicD2Search,
};
