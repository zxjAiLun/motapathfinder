"use strict";

const { getProgress, compareProgress } = require("./progress");
const { estimateNextFloorDistance, getFloorOrder } = require("./score");
const { getDecisionDepth, listFloorMutationSummary } = require("./state");
const { createCheckpointPool } = require("./floor-checkpoints");

function stableArray(array) {
  return Array.isArray(array) ? array.slice().sort() : [];
}

function stableObject(object) {
  return Object.keys(object || {})
    .sort()
    .reduce((result, key) => {
      const value = object[key];
      if (value == null || value === 0) return result;
      result[key] = value;
      return result;
    }, {});
}

function buildDpStateKey(simulator, state, options) {
  const config = options || {};
  const keyMode = String(config.dpKeyMode || config.keyMode || "location");
  const hero = state.hero || {};
  let region = null;
  if (keyMode === "region") {
    try {
      region = simulator.buildReachableRegionSignature(state);
    } catch (error) {
      region = null;
    }
  }
  return JSON.stringify({
    floorId: state.floorId,
    keyMode,
    regionKey: region
      ? region.regionKey
      : keyMode === "mutation"
        ? ""
        : `${state.floorId}:${hero.loc && hero.loc.x},${hero.loc && hero.loc.y}`,
    reachableEndpointsKey: region ? region.reachableEndpointsKey : "",
    hero: {
      atk: Number(hero.atk || 0),
      def: Number(hero.def || 0),
      mdef: Number(hero.mdef || 0),
      lv: Number(hero.lv || 0),
      exp: Number(hero.exp || 0),
      money: Number(hero.money || 0),
      mana: Number(hero.mana || 0),
      equipment: stableArray(hero.equipment),
      followers: stableArray(hero.followers),
    },
    inventory: stableObject(state.inventory),
    flags: stableObject(state.flags),
    visitedFloors: Object.keys(state.visitedFloors || {}).sort(),
    mutations: listFloorMutationSummary(state.floorStates || {}),
  });
}

function heroHp(state) {
  return Number(((state || {}).hero || {}).hp || 0);
}

class BinaryHeap {
  constructor(compare) {
    this.compare = compare;
    this.items = [];
  }

  get length() {
    return this.items.length;
  }

  push(item) {
    this.items.push(item);
    this.bubbleUp(this.items.length - 1);
  }

  pop() {
    if (this.items.length === 0) return null;
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0) {
      this.items[0] = last;
      this.sinkDown(0);
    }
    return top;
  }

  bubbleUp(index) {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.compare(this.items[index], this.items[parent]) <= 0) break;
      const tmp = this.items[parent];
      this.items[parent] = this.items[index];
      this.items[index] = tmp;
      index = parent;
    }
  }

  sinkDown(index) {
    const length = this.items.length;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let best = index;
      if (left < length && this.compare(this.items[left], this.items[best]) > 0) best = left;
      if (right < length && this.compare(this.items[right], this.items[best]) > 0) best = right;
      if (best === index) break;
      const tmp = this.items[index];
      this.items[index] = this.items[best];
      this.items[best] = tmp;
      index = best;
    }
  }

  activeCount(isActive) {
    return this.items.reduce((count, item) => count + (isActive(item) ? 1 : 0), 0);
  }
}

function isBetterForSameDpKey(left, right) {
  if (!right) return true;
  const hpDiff = heroHp(left) - heroHp(right);
  if (hpDiff !== 0) return hpDiff > 0;
  const leftDepth = getDecisionDepth(left);
  const rightDepth = getDecisionDepth(right);
  if (leftDepth !== rightDepth) return leftDepth < rightDepth;
  const leftRoute = Array.isArray(left.route) ? left.route.length : leftDepth;
  const rightRoute = Array.isArray(right.route) ? right.route.length : rightDepth;
  return leftRoute < rightRoute;
}

function compareDpBest(left, right) {
  if (!right) return 1;
  if (!left) return -1;
  const progressDiff = compareProgress(left, right);
  if (progressDiff !== 0) return progressDiff;
  const leftHero = left.hero || {};
  const rightHero = right.hero || {};
  const hpDiff = heroHp(left) - heroHp(right);
  if (hpDiff !== 0) return hpDiff;
  const resourceFields = ["atk", "def", "mdef", "lv", "exp"];
  for (const field of resourceFields) {
    const diff = Number(leftHero[field] || 0) - Number(rightHero[field] || 0);
    if (diff !== 0) return diff;
  }
  return getDecisionDepth(right) - getDecisionDepth(left);
}

function actionPriority(action) {
  if (!action) return 99;
  if (action.kind === "pickup" || action.kind === "equip") return 0;
  if (action.kind === "event") return action.unsupported ? 8 : 1;
  if (action.kind === "changeFloor") return 2;
  if (action.kind === "battle") return 3;
  if (action.kind === "openDoor" || action.kind === "useTool") return 2;
  return 9;
}

function sortDpActions(actions) {
  return (actions || []).slice().sort((left, right) => {
    const priorityDiff = actionPriority(left) - actionPriority(right);
    if (priorityDiff !== 0) return priorityDiff;
    const leftUnlock = Number((((left || {}).estimate || {}).unlockPreview || {}).score || 0);
    const rightUnlock = Number((((right || {}).estimate || {}).unlockPreview || {}).score || 0);
    if ((leftUnlock || rightUnlock) && leftUnlock !== rightUnlock) return rightUnlock - leftUnlock;
    const leftDamage = Number(((left || {}).estimate || {}).damage || 0);
    const rightDamage = Number(((right || {}).estimate || {}).damage || 0);
    if ((left.kind === "battle" || right.kind === "battle") && leftDamage !== rightDamage) {
      return leftDamage - rightDamage;
    }
    return String(left.summary || "").localeCompare(String(right.summary || ""));
  });
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function sourceActionRank(action) {
  if (!action) return 0;
  if (action.kind === "changeFloor") return 8;
  if (action.kind === "pickup" || action.kind === "equip") return 7;
  if (action.kind === "openDoor" || action.kind === "useTool") return 6;
  if (action.kind === "battle") {
    const estimate = (action || {}).estimate || {};
    const unlock = estimate.unlockPreview || {};
    const damage = Number(estimate.damage || 0);
    const unlockValue =
      Math.min(10, Number(unlock.score || 0) / 500) +
      Number(unlock.itemCount || 0) * 3 +
      Number(unlock.changeFloorCount || 0) * 4 +
      Number(unlock.zeroDamageChainCount || 0) * 2 +
      Number(unlock.lowDamageBattleCount || 0);
    return Math.max(0, 5 + unlockValue - Math.min(6, damage / 800));
  }
  if (action.kind === "event" && !action.unsupported) return 4;
  return 1;
}

function buildDpAgendaRank(simulator, state, sourceAction, sequence) {
  const progress = getProgress(state);
  const hero = state.hero || {};
  const nextDistance = estimateNextFloorDistance(state, simulator.project);
  const routeLength = Array.isArray(state.route) ? state.route.length : getDecisionDepth(state);
  return {
    bestFloorRank: Number(progress.bestFloorRank || 0),
    finiteNextDistance: Number.isFinite(nextDistance) ? 1 : 0,
    nextDistance: finiteNumber(nextDistance, 9999),
    currentFloorRank: getFloorOrder(state.floorId),
    hp: Number(hero.hp || 0),
    atk: Number(hero.atk || 0),
    def: Number(hero.def || 0),
    mdef: Number(hero.mdef || 0),
    lv: Number(hero.lv || 0),
    exp: Number(hero.exp || 0),
    sourceActionRank: sourceActionRank(sourceAction),
    decisionDepth: getDecisionDepth(state),
    routeLength,
    sequence,
  };
}

function compareDpAgendaRank(left, right) {
  const highWins = [
    "bestFloorRank",
    "finiteNextDistance",
  ];
  for (const field of highWins) {
    const diff = Number(left[field] || 0) - Number(right[field] || 0);
    if (diff !== 0) return diff;
  }
  if (left.nextDistance !== right.nextDistance) return right.nextDistance - left.nextDistance;
  const remainingHighWins = [
    "currentFloorRank",
    "sourceActionRank",
    "hp",
    "atk",
    "def",
    "mdef",
    "lv",
    "exp",
  ];
  for (const field of remainingHighWins) {
    const diff = Number(left[field] || 0) - Number(right[field] || 0);
    if (diff !== 0) return diff;
  }
  if (left.decisionDepth !== right.decisionDepth) return right.decisionDepth - left.decisionDepth;
  if (left.routeLength !== right.routeLength) return right.routeLength - left.routeLength;
  return right.sequence - left.sequence;
}

function emptyActionStats() {
  return {
    byActionType: {},
    byActionRole: {},
  };
}

function actionType(action) {
  if (!action) return "unknown";
  if (action.kind === "battle") return "monster";
  if (action.kind === "pickup") return "item";
  if (action.kind === "changeFloor") return "changeFloor";
  if (action.kind === "openDoor") return "door";
  if (action.kind === "useTool") return "tool";
  return action.kind || "misc";
}

function recordAction(stats, action, field) {
  const type = actionType(action);
  if (!stats.byActionType[type]) stats.byActionType[type] = { generated: 0, kept: 0, dominated: 0, invalid: 0, expanded: 0 };
  stats.byActionType[type][field] = Number(stats.byActionType[type][field] || 0) + 1;
}

function searchDP(simulator, initialState, options) {
  const config = options || {};
  const maxExpansions = Number(config.maxExpansions || 1000);
  const maxActionsPerState = Number(config.maxActionsPerState || 256);
  const agendaMode = String(config.dpAgendaMode || config.agendaMode || "best-first");
  const stopOnFirstGoal = config.stopOnFirstGoal !== false;
  const fifoEntries = [];
  const heap = agendaMode === "fifo"
    ? null
    : new BinaryHeap((left, right) => compareDpAgendaRank(left.rank, right.rank));
  const bestByKey = new Map();
  const actionStats = emptyActionStats();
  const startedAt = Date.now();
  let expansions = 0;
  let generated = 0;
  let registered = 0;
  let rejectedByDp = 0;
  let invalid = 0;
  let goalState = null;
  let bestSeenState = initialState;
  let bestProgressState = initialState;
  let sequence = 0;
  const isGoalState = typeof config.goalPredicate === "function"
    ? config.goalPredicate
    : (state) => simulator.isTerminal(state);

  const isActiveEntry = (entry) => {
    const active = bestByKey.get(entry.key);
    return Boolean(active && active.state === entry.state && !isGoalState(entry.state));
  };

  const enqueue = (state, sourceAction) => {
    const key = buildDpStateKey(simulator, state, config);
    const existing = bestByKey.get(key);
    if (!isBetterForSameDpKey(state, existing && existing.state)) {
      rejectedByDp += 1;
      return false;
    }
    bestByKey.set(key, { state, key });
    const entry = {
      state,
      key,
      rank: buildDpAgendaRank(simulator, state, sourceAction, sequence),
    };
    sequence += 1;
    if (heap) heap.push(entry);
    else fifoEntries.push(entry);
    registered += 1;
    if (compareDpBest(state, bestSeenState) > 0) bestSeenState = state;
    const progressDiff = compareProgress(state, bestProgressState);
    if (progressDiff > 0 || (progressDiff === 0 && compareDpBest(state, bestProgressState) > 0)) {
      bestProgressState = state;
    }
    if (isGoalState(state)) {
      if (!goalState || compareDpBest(state, goalState) > 0) goalState = state;
    }
    return true;
  };

  enqueue(initialState);

  let cursor = 0;
  const popNext = () => {
    if (heap) {
      while (heap.length > 0) {
        const entry = heap.pop();
        if (isActiveEntry(entry)) return entry;
      }
      return null;
    }
    while (cursor < fifoEntries.length) {
      const entry = fifoEntries[cursor];
      cursor += 1;
      if (isActiveEntry(entry)) return entry;
    }
    return null;
  };

  while (expansions < maxExpansions) {
    if (stopOnFirstGoal && goalState) break;
    const entry = popNext();
    if (!entry) break;
    const active = bestByKey.get(entry.key);
    if (!active || active.state !== entry.state) continue;
    const state = entry.state;
    if (isGoalState(state)) continue;
    expansions += 1;
    let actions = [];
    try {
      actions = simulator.enumeratePrimitiveActions(state).actions;
    } catch (error) {
      invalid += 1;
      continue;
    }
    sortDpActions(actions)
      .slice(0, maxActionsPerState)
      .forEach((action) => {
        generated += 1;
        recordAction(actionStats, action, "expanded");
        let nextState;
        try {
          nextState = simulator.applyAction(state, action);
        } catch (error) {
          invalid += 1;
          recordAction(actionStats, action, "invalid");
          return;
        }
        if (enqueue(nextState, action)) recordAction(actionStats, action, "kept");
        else recordAction(actionStats, action, "dominated");
      });
  }

  const frontierSize = heap
    ? heap.activeCount(isActiveEntry)
    : fifoEntries.slice(cursor).filter(isActiveEntry).length;

  return {
    foundGoal: Boolean(goalState),
    goalState,
    bestSeenState,
    bestProgressState,
    fallbackState: null,
    route: goalState ? goalState.route : null,
    fallbackRoute: null,
    expansions,
    frontierSize,
    checkpointPool: createCheckpointPool(config.checkpointOptions),
    results: goalState ? [goalState] : [],
    diagnostics: {
      algorithm: "dp",
      registered,
      generated,
      trimmed: 0,
      skipped: {
        "dp-lower-hp-same-state": rejectedByDp,
        invalid,
      },
      byActionType: actionStats.byActionType,
      byActionRole: actionStats.byActionRole,
      byFloor: {},
      byStage: {},
      droppedProgressActions: { total: 0, byReason: {}, samples: [] },
      quota: { dropped: 0, byActionType: {} },
      graph: {
        mode: "primitive-dp",
        statesWithMacroActions: 0,
        primitiveFallbackStates: 0,
        primitiveActionsSuppressed: 0,
        primitiveActionsSuppressedByMacroPlan: 0,
        expandedByKind: {},
      },
      frontier: { beamDropped: 0, beamDroppedByFloor: {}, beamDroppedByStage: {}, topBuckets: [] },
      perf: {
        wallMs: Date.now() - startedAt,
        expandedStates: expansions,
        generatedActions: generated,
        keptActions: registered,
        expansionsPerSec: expansions > 0 ? expansions / Math.max(0.001, (Date.now() - startedAt) / 1000) : 0,
      },
      pruneReasons: { "dp-lower-hp-same-state": rejectedByDp },
      suspicious: {},
      safeDominance: {},
      confluenceDominance: {
        enabled: true,
        routePolicy: "dp-key",
        replacedLowerHp: registered,
        rejectedByHigherHp: rejectedByDp,
        ignoredRouteLengthRejects: 0,
        ignoredRouteLengthReplacements: 0,
        unsafeFloorDowngrades: 0,
        nonWhitelistedFloorDowngrades: 0,
        representativesByKeyMax: 1,
        byFloor: {},
        examples: [],
      },
      actionExpansionCache: {
        mode: "dp",
        main: simulator.getActionExpansionCacheStats ? simulator.getActionExpansionCacheStats() : {},
      },
      checkpoints: {},
      best: {
        bestSeenFloor: bestSeenState && bestSeenState.floorId,
        bestSeenStage: bestSeenState ? getProgress(bestSeenState).stageIndex : null,
        bestSeenRouteLength: bestSeenState && bestSeenState.route ? bestSeenState.route.length : null,
        bestProgressFloor: bestProgressState && bestProgressState.floorId,
        bestProgressStage: bestProgressState ? getProgress(bestProgressState).stageIndex : null,
      },
      dp: {
        keys: bestByKey.size,
        agendaMode,
        stopOnFirstGoal,
        keyMode: String(config.dpKeyMode || config.keyMode || "location"),
        targetFloorOrder: getFloorOrder(config.targetFloorId || simulator.stopFloorId),
      },
    },
  };
}

module.exports = {
  buildDpStateKey,
  compareDpBest,
  searchDP,
};
