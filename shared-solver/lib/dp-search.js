"use strict";

const { getProgress, compareProgress } = require("./progress");
const { estimateNextFloorDistance, getFloorOrder } = require("./score");
const { cloneState, getDecisionDepth, listFloorMutationSummary } = require("./state");
const { buildStateKey } = require("./state-key");
const { createCheckpointPool } = require("./floor-checkpoints");
const { createChildNode, createRootNode, reconstructActionEntries, reconstructActionTrace } = require("./search-nodes");

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

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

function effectiveHeroValue(state, field) {
  const hero = (state || {}).hero || {};
  const flags = (state || {}).flags || {};
  const buff = Number(flags[`__${field}_buff__`] || 1);
  return Math.floor(Number(hero[field] || 0) * buff);
}

function routeLengthOfState(state) {
  return Array.isArray((state || {}).route)
    ? state.route.length
    : getDecisionDepth(state);
}

function compareGoalStates(left, right) {
  if (!right) return 1;
  if (!left) return -1;
  const hpDiff = heroHp(left) - heroHp(right);
  if (hpDiff !== 0) return hpDiff;
  for (const field of ["atk", "def", "mdef"]) {
    const diff = effectiveHeroValue(left, field) - effectiveHeroValue(right, field);
    if (diff !== 0) return diff;
  }
  const leftHero = left.hero || {};
  const rightHero = right.hero || {};
  for (const field of ["lv", "exp", "atk", "def", "mdef"]) {
    const diff = Number(leftHero[field] || 0) - Number(rightHero[field] || 0);
    if (diff !== 0) return diff;
  }
  return routeLengthOfState(right) - routeLengthOfState(left);
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

class SkylineSet {
  constructor(maxPerKey) {
    this.maxPerKey = Math.max(1, maxPerKey || 1);
    this.map = new Map();
  }

  get(key) {
    const arr = this.map.get(key);
    return arr && arr.length > 0 ? arr[0] : undefined;
  }

  getAll(key) {
    return this.map.get(key) || [];
  }

  has(key) {
    const arr = this.map.get(key);
    return Boolean(arr && arr.length > 0);
  }

  isActive(key, nodeId) {
    const arr = this.map.get(key);
    return Boolean(arr && arr.some((n) => n.nodeId === nodeId));
  }

  add(key, node, compareFn, roleFn) {
    let arr = this.map.get(key);
    if (!arr) {
      arr = [node];
      this.map.set(key, arr);
      return true;
    }
    if (arr.length < this.maxPerKey) {
      arr.push(node);
      arr.sort((a, b) => compareFn(b.state, a.state));
      return true;
    }
    if (typeof roleFn === "function") {
      const incomingRoles = new Set(roleFn(node.state) || []);
      const roleCounts = new Map();
      arr.forEach((item) => {
        (roleFn(item.state) || []).forEach((role) => roleCounts.set(role, Number(roleCounts.get(role) || 0) + 1));
      });
      const replaceable = arr.filter((item) =>
        (roleFn(item.state) || []).every((role) => Number(roleCounts.get(role) || 0) > 1),
      );
      const hasNewRole = Array.from(incomingRoles).some((role) => Number(roleCounts.get(role) || 0) === 0);
      if (hasNewRole && replaceable.length > 0) {
        const worstReplaceable = replaceable
          .slice()
          .sort((left, right) => compareFn(right.state, left.state))[replaceable.length - 1];
        arr[arr.indexOf(worstReplaceable)] = node;
        arr.sort((a, b) => compareFn(b.state, a.state));
        return true;
      }
    }
    const worst = arr[arr.length - 1];
    if (compareFn(node.state, worst.state) > 0) {
      arr[arr.length - 1] = node;
      arr.sort((a, b) => compareFn(b.state, a.state));
      return true;
    }
    return false;
  }

  replace(key, node) {
    this.map.set(key, [node]);
    return true;
  }

  get size() {
    return this.map.size;
  }
}

function isBetterForSameDpKey(left, right, dominanceConfig) {
  if (!right) return true;
  if (dominanceConfig && typeof dominanceConfig.compare === "function") {
    const comparison = dominanceConfig.compare(left, right);
    return typeof comparison === "number" ? comparison > 0 : comparison === true;
  }
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
  if (action.kind === "pickup" || action.kind === "interactPickup" || action.kind === "equip") return 0;
  if (action.kind === "event") return action.unsupported ? 8 : 1;
  if (action.kind === "changeFloor" || action.kind === "floorFly") return 2;
  if (action.kind === "battle") return 3;
  if (action.kind === "openDoor" || action.kind === "useTool") return 2;
  return 9;
}

function sortDpActions(actions) {
  return (actions || []).slice().sort((left, right) => {
    const leftSegment = Number((((left || {}).estimate || {}).segmentPreviewScore) || 0);
    const rightSegment = Number((((right || {}).estimate || {}).segmentPreviewScore) || 0);
    if ((leftSegment || rightSegment) && leftSegment !== rightSegment) return rightSegment - leftSegment;
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
  const segmentScore = Number((((action || {}).estimate || {}).segmentPreviewScore) || 0);
  if (segmentScore !== 0) return 10 + Math.max(-20, Math.min(100, segmentScore / 1000000));
  if (action.kind === "changeFloor" || action.kind === "floorFly") return 8;
  if (action.kind === "pickup" || action.kind === "interactPickup" || action.kind === "equip") return 7;
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

function buildDpAgendaRank(simulator, state, sourceAction, sequence, options) {
  const config = options || {};
  const progress = getProgress(state);
  const hero = state.hero || {};
  const nextDistance = estimateNextFloorDistance(state, simulator.project);
  const routeLength = Array.isArray(state.route) ? state.route.length : getDecisionDepth(state);
  return {
    priorityMode: String(config.dpPriorityMode || "default"),
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
  if (left.priorityMode === "resource-first" || right.priorityMode === "resource-first") {
    const resourceHighWins = ["sourceActionRank", "atk", "def", "mdef", "lv", "exp", "hp", "bestFloorRank", "currentFloorRank", "finiteNextDistance"];
    for (const field of resourceHighWins) {
      const diff = Number(left[field] || 0) - Number(right[field] || 0);
      if (diff !== 0) return diff;
    }
    if (left.nextDistance !== right.nextDistance) return right.nextDistance - left.nextDistance;
    if (left.decisionDepth !== right.decisionDepth) return right.decisionDepth - left.decisionDepth;
    if (left.routeLength !== right.routeLength) return right.routeLength - left.routeLength;
    return right.sequence - left.sequence;
  }
  const highWins = [
    "bestFloorRank",
    "finiteNextDistance",
  ];
  for (const field of highWins) {
    const diff = Number(left[field] || 0) - Number(right[field] || 0);
    if (diff !== 0) return diff;
  }
  if (left.nextDistance !== right.nextDistance) return right.nextDistance - left.nextDistance;
  const remainingHighWins = left.priorityMode === "combat-first"
    ? ["currentFloorRank", "sourceActionRank", "atk", "def", "mdef", "lv", "exp", "hp"]
    : ["currentFloorRank", "sourceActionRank", "hp", "atk", "def", "mdef", "lv", "exp"];
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
    byKind: {},
    uniqueBattleTargets: new Set(),
    uniquePortalEntries: new Set(),
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
  const kind = (action && action.kind) || "unknown";
  if (!stats.byKind[kind]) stats.byKind[kind] = { generated: 0, kept: 0, dominated: 0, invalid: 0, expanded: 0 };
  stats.byKind[kind][field] = Number(stats.byKind[kind][field] || 0) + 1;
  if (field === "generated" || field === "expanded") {
    if (kind === "battle" && action && action.summary) {
      stats.uniqueBattleTargets.add(action.summary);
    }
    if ((kind === "changeFloor" || kind === "floorFly") && action && action.summary) {
      stats.uniquePortalEntries.add(action.summary);
    }
  }
}

function selectGoalSkylineNodes(goalNodes, options) {
  const config = options || {};
  const limit = Math.max(1, Number(config.goalSkylineLimit || 8));
  const preserveGoalArchive = config.preserveGoalArchive === true;
  const sorted = (goalNodes || [])
    .filter(Boolean)
    .slice()
    .sort((left, right) => compareGoalStates(right.state, left.state));
  const selected = [];
  const seenKeys = new Set();
  for (const node of sorted) {
    const key = preserveGoalArchive
      ? `goal:${node.nodeId}`
      : node.key || node.stateKey || `node:${node.nodeId}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    selected.push(node);
    if (selected.length >= limit) break;
  }
  return selected;
}

const DP_OBSERVER_EVENT_VERSION = "dp-observer.v1";

function compactObserverHero(state) {
  const hero = (state && state.hero) || {};
  return {
    hp: Number(hero.hp || 0),
    hpmax: Number(hero.hpmax || 0),
    atk: Number(hero.atk || 0),
    def: Number(hero.def || 0),
    mdef: Number(hero.mdef || 0),
    lv: Number(hero.lv || 0),
    exp: Number(hero.exp || 0),
    money: Number(hero.money || 0),
    loc: hero.loc ? { x: hero.loc.x, y: hero.loc.y } : null,
  };
}

function compactObserverAction(action) {
  if (!action) return null;
  return {
    kind: action.kind || null,
    summary: action.summary || null,
    fingerprint: action.fingerprint || null,
  };
}

function observerRoles(config, state) {
  if (typeof config.skylineRoles !== "function") return [];
  try {
    const roles = config.skylineRoles(state);
    return Array.isArray(roles) ? roles.slice() : [];
  } catch (error) {
    return [];
  }
}

function observerStatePayload(simulator, state, node, config, extra) {
  const payload = {
    ...(extra || {}),
    floorId: state && state.floorId,
    dpKey: node && (node.key || node.stateKey) || null,
    hero: compactObserverHero(state),
    decisionDepth: getDecisionDepth(state),
    skylineRoles: observerRoles(config, state),
  };
  const includeExact = config.observerIncludeExactStateKey === true ||
    (config.observer && config.observer.includeExactStateKey === true);
  if (includeExact && state) {
    try {
      payload.exactStateKey = buildStateKey(state);
    } catch (error) {
      payload.exactStateKey = null;
    }
  }
  void simulator;
  return payload;
}

function createDpObserver(config) {
  const configured = config && config.observer;
  if (!configured) return null;
  let callback = null;
  if (typeof configured === "function") callback = configured;
  else if (configured && typeof configured.onEvent === "function") callback = configured.onEvent.bind(configured);
  if (!callback && (!configured || typeof configured !== "object")) return null;
  const eventFilter = typeof configured === "object" && typeof configured.eventFilter === "function"
    ? configured.eventFilter.bind(configured)
    : null;
  const eventTypes = typeof configured === "object" && Array.isArray(configured.eventTypes)
    ? configured.eventTypes.slice()
    : null;
  let errors = 0;
  return {
    get errorCount() {
      return errors;
    },
    emit(eventType, payload) {
      const event = {
        eventVersion: DP_OBSERVER_EVENT_VERSION,
        eventType,
        ...payload,
      };
      if (eventFilter) {
        try {
          if (!eventFilter(event)) return;
        } catch (error) {
          errors += 1;
          return;
        }
      }
      if (eventTypes && !eventTypes.includes(eventType)) return;
      const handler = typeof configured === "function"
        ? callback
        : (configured && typeof configured[`on${eventType[0].toUpperCase()}${eventType.slice(1)}`] === "function"
          ? configured[`on${eventType[0].toUpperCase()}${eventType.slice(1)}`].bind(configured)
          : callback);
      if (!handler) return;
      try {
        handler(event);
      } catch (error) {
        errors += 1;
      }
    },
  };
}

function searchDP(simulator, initialState, options) {
  const config = options || {};
  const observer = createDpObserver(config);
  const maxExpansions = Number(config.maxExpansions || 1000);
  const maxActionsPerState = Number(config.maxActionsPerState || 256);
  const agendaMode = String(config.dpAgendaMode || config.agendaMode || "best-first");
  const stopOnFirstGoal = config.stopOnFirstGoal !== false;
  const continueAfterGoal = config.continueAfterGoal === true;
  const maxRuntimeMs = Number(config.maxRuntimeMs || config.timeLimitMs || 0);
  const fifoEntries = [];
  const heap = agendaMode === "fifo"
    ? null
    : new BinaryHeap((left, right) => compareDpAgendaRank(left.rank, right.rank));
  const initialRoutePrefix = Array.isArray(initialState.route) ? initialState.route.slice() : [];
  const captureTrace = config.captureTrace === true;
  const initialRouteTracePrefix = captureTrace && Array.isArray(config.initialRouteTracePrefix)
    ? config.initialRouteTracePrefix
    : [];
  const rootState = cloneState(initialState);
  rootState.route = [];
  if (typeof config.stateAnnotator === "function") {
    try {
      config.stateAnnotator(rootState, null, null);
    } catch (error) {
      // Timing annotations are diagnostic and must not make the search fail.
    }
  }
  const nodes = new Map();
  let nextNodeId = 1;
  const skylineMax = number(config.dpSkylineMax, 1);
  const bestByKey = skylineMax > 1 ? new SkylineSet(skylineMax) : new Map();
  const actionStats = emptyActionStats();
  const startedAt = Date.now();
  let expansions = 0;
  let generated = 0;
  let registered = 0;
  let newKeys = 0;
  let replacedLowerHp = 0;
  let sameHpShorterRoute = 0;
  let rejectedByHigherHp = 0;
  let sameHpRejected = 0;
  let actionTrimmed = 0;
  let statesWithActionTrim = 0;
  let maxActionsGeneratedForState = 0;
  let invalid = 0;
  let firstGoalNode = null;
  let bestGoalNode = null;
  const goalNodes = [];
  let bestSeenNode = null;
  let bestProgressNode = null;
  const landmarkArchiveLimit = Math.max(0, number(config.landmarkArchiveLimit, 0));
  const landmarkArchiveByKey = new Map();
  let sequence = 0;
  let stoppedReason = null;
  const isGoalState = typeof config.goalPredicate === "function"
    ? config.goalPredicate
    : (state) => simulator.isTerminal(state);

  const emitStateEvent = (eventType, state, node, extra) => {
    if (!observer) return;
    observer.emit(eventType, observerStatePayload(simulator, state, node, config, extra));
  };

  const isActiveEntry = (entry) => {
    if (bestByKey instanceof SkylineSet) {
      if (!bestByKey.isActive(entry.key, entry.nodeId)) return false;
    } else {
      const active = bestByKey.get(entry.key);
      if (!active || active.nodeId !== entry.nodeId) return false;
    }
    return continueAfterGoal || !isGoalState(entry.state);
  };

  const archiveLandmark = (node, sourceAction, parentNode) => {
    if (landmarkArchiveLimit <= 0 || !node || !sourceAction) return;
    const kind = sourceAction.kind || "unknown";
    const floorChanged = Boolean(parentNode && parentNode.state.floorId !== node.state.floorId);
    const beforeHero = (parentNode && parentNode.state && parentNode.state.hero) || {};
    const afterHero = (node.state && node.state.hero) || {};
    const statGain =
      Math.max(0, number(afterHero.atk, 0) - number(beforeHero.atk, 0)) * 100000 +
      Math.max(0, number(afterHero.def, 0) - number(beforeHero.def, 0)) * 120000 +
      Math.max(0, number(afterHero.mdef, 0) - number(beforeHero.mdef, 0)) * 10000 +
      Math.max(0, number(afterHero.hp, 0) - number(beforeHero.hp, 0));
    const irreversible = ["battle", "pickup", "equip", "openDoor", "event", "changeFloor", "floorFly"].includes(kind);
    if (!irreversible && !floorChanged && statGain <= 0) return;
    const role = floorChanged || kind === "changeFloor" || kind === "floorFly"
      ? "mobility"
      : kind === "equip"
        ? "equipment"
        : statGain > 0
          ? "resource-gain"
          : "irreversible";
    const key = `${role}|${node.state.floorId}|${sourceAction.summary || kind}`;
    const score =
      (role === "mobility" ? 1000000000000 : 0) +
      (role === "equipment" ? 900000000000 : 0) +
      statGain +
      heroHp(node.state);
    const existing = landmarkArchiveByKey.get(key);
    if (!existing || score > existing.score) {
      landmarkArchiveByKey.set(key, {
        node,
        role,
        actionSummary: sourceAction.summary || null,
        score,
      });
    }
    if (irreversible) {
      const survivalKey = `survival|${node.state.floorId}`;
      const survivalScore = heroHp(node.state);
      const survivalExisting = landmarkArchiveByKey.get(survivalKey);
      if (!survivalExisting || survivalScore > survivalExisting.score) {
        landmarkArchiveByKey.set(survivalKey, {
          node,
          role: "survival",
          actionSummary: sourceAction.summary || null,
          score: survivalScore,
        });
      }
    }
    if (landmarkArchiveByKey.size > landmarkArchiveLimit * 3) {
      const kept = Array.from(landmarkArchiveByKey.entries())
        .sort((left, right) => right[1].score - left[1].score)
        .slice(0, landmarkArchiveLimit * 2);
      landmarkArchiveByKey.clear();
      kept.forEach(([entryKey, record]) => landmarkArchiveByKey.set(entryKey, record));
    }
  };

  const enqueue = (state, sourceAction, parentNode) => {
    const key = buildDpStateKey(simulator, state, config);
    const existingSkyline = bestByKey instanceof SkylineSet ? bestByKey.getAll(key) : null;
    const timingConflict = existingSkyline &&
      config.dominanceConfig &&
      typeof config.dominanceConfig.hasConflict === "function" &&
      existingSkyline.some((candidate) => config.dominanceConfig.hasConflict(state, candidate.state));
    const adaptiveTiming = Boolean(
      config.dominanceConfig &&
      typeof config.dominanceConfig.hasConflict === "function",
    );
    const preserveAlternative = existingSkyline &&
      (config.preserveSkylineAlternatives === true || timingConflict === true) &&
      existingSkyline.length < skylineMax;
    const dominated = bestByKey instanceof SkylineSet
      ? existingSkyline.length > 0 && !preserveAlternative && (
          adaptiveTiming && timingConflict
            ? existingSkyline.every((n) => !isBetterForSameDpKey(state, n.state, config.dominanceConfig))
            : adaptiveTiming
              ? !isBetterForSameDpKey(state, existingSkyline[0].state, config.dominanceConfig)
              : existingSkyline.every((n) => !isBetterForSameDpKey(state, n.state, config.dominanceConfig))
        )
      : !isBetterForSameDpKey(state, bestByKey.get(key) && bestByKey.get(key).state, config.dominanceConfig);
    if (dominated) {
      const existing = bestByKey instanceof SkylineSet ? bestByKey.get(key) : bestByKey.get(key);
      const existingState = existing && existing.state;
      const hpDiff = existingState ? heroHp(state) - heroHp(existingState) : null;
      if (hpDiff === 0) sameHpRejected += 1;
      else rejectedByHigherHp += 1;
      emitStateEvent("candidateRejected", state, { key }, {
        reasonCode: "dominance-rejected",
        action: compactObserverAction(sourceAction),
        candidateId: sourceAction && sourceAction.__observerCandidateId || null,
        successorId: sourceAction && sourceAction.__observerSuccessorId || null,
      });
      return false;
    }
    const existing = bestByKey instanceof SkylineSet ? bestByKey.get(key) : bestByKey.get(key);
    const existingState = existing && existing.state;
    const hpDiff = existingState ? heroHp(state) - heroHp(existingState) : null;
    if (!existingState) newKeys += 1;
    else if (hpDiff > 0) replacedLowerHp += 1;
    else if (hpDiff === 0) sameHpShorterRoute += 1;
    const actionForEntry = sourceAction && !sourceAction.fingerprint && typeof simulator.getActionFingerprint === "function"
      ? { ...sourceAction, fingerprint: simulator.getActionFingerprint(sourceAction) }
      : sourceAction;
    const node = parentNode
      ? createChildNode(parentNode, state, key, actionForEntry, nextNodeId++, sequence)
      : createRootNode(state, key);
    node.key = key;
    node.rank = buildDpAgendaRank(simulator, state, sourceAction, sequence, config);
    sequence += 1;
    nodes.set(node.nodeId, node);
    archiveLandmark(node, actionForEntry, parentNode);
    let skylineInserted = true;
    const beforeSkylineIds = bestByKey instanceof SkylineSet
      ? (existingSkyline || []).map((candidate) => candidate.nodeId)
      : (existing ? [existing.nodeId] : []);
    if (bestByKey instanceof SkylineSet) {
      if (existingSkyline.length > 0 && adaptiveTiming && timingConflict !== true) {
        bestByKey.replace(key, node);
      } else {
        skylineInserted = bestByKey.add(
          key,
          node,
          typeof config.skylineCompare === "function" ? config.skylineCompare : compareDpBest,
          config.skylineRoles,
        );
      }
    } else {
      bestByKey.set(key, node);
    }
    const afterSkylineIds = bestByKey instanceof SkylineSet
      ? bestByKey.getAll(key).map((candidate) => candidate.nodeId)
      : [node.nodeId];
    if (observer) {
      beforeSkylineIds
        .filter((nodeId) => !afterSkylineIds.includes(nodeId))
        .forEach((nodeId) => observer.emit("skylineEvicted", observerStatePayload(simulator, state, node, config, {
          reasonCode: "skyline-replaced",
          key,
          evictedNodeId: nodeId,
          action: compactObserverAction(sourceAction),
          candidateId: sourceAction && sourceAction.__observerCandidateId || null,
          successorId: sourceAction && sourceAction.__observerSuccessorId || null,
        })));
      if (!skylineInserted) {
        observer.emit("candidateRejected", observerStatePayload(simulator, state, { key }, config, {
          reasonCode: "skyline-capacity-rejected",
          key,
          action: compactObserverAction(sourceAction),
          candidateId: sourceAction && sourceAction.__observerCandidateId || null,
          successorId: sourceAction && sourceAction.__observerSuccessorId || null,
        }));
      } else {
        emitStateEvent("skylineInserted", state, node, {
          reasonCode: "skyline-inserted",
          key,
          action: compactObserverAction(sourceAction),
          nodeId: node.nodeId,
          parentId: node.parentId,
          candidateId: sourceAction && sourceAction.__observerCandidateId || null,
          successorId: sourceAction && sourceAction.__observerSuccessorId || null,
        });
      }
    }
    if (heap) heap.push(node);
    else fifoEntries.push(node);
    registered += 1;
    if (!bestSeenNode || compareDpBest(state, bestSeenNode.state) > 0) bestSeenNode = node;
    const progressDiff = bestProgressNode ? compareProgress(state, bestProgressNode.state) : 1;
    if (!bestProgressNode || progressDiff > 0 || (progressDiff === 0 && compareDpBest(state, bestProgressNode.state) > 0)) {
      bestProgressNode = node;
    }
    if (isGoalState(state)) {
      if (!firstGoalNode) firstGoalNode = node;
      goalNodes.push(node);
      if (!bestGoalNode || compareGoalStates(state, bestGoalNode.state) > 0) bestGoalNode = node;
      emitStateEvent("goalAccepted", state, node, {
        reasonCode: "goal-predicate-accepted",
        action: compactObserverAction(sourceAction),
      });
    }
    return node;
  };

  enqueue(rootState);

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

  const maxHeapMb = Number(config.maxHeapMb || 0);
  let maxHeapUsedMb = 0;
  let maxRssMb = 0;
  const recordMemoryUsage = () => {
    const memory = process.memoryUsage();
    const heapUsedMb = memory.heapUsed / 1024 / 1024;
    const rssMb = memory.rss / 1024 / 1024;
    maxHeapUsedMb = Math.max(maxHeapUsedMb, heapUsedMb);
    maxRssMb = Math.max(maxRssMb, rssMb);
    return { heapUsedMb, rssMb };
  };
  while (expansions < maxExpansions) {
    if (maxRuntimeMs > 0 && Date.now() - startedAt >= maxRuntimeMs) {
      stoppedReason = "time-limit";
      break;
    }
    if (maxHeapMb > 0 && expansions % 100 === 0) {
      const { heapUsedMb } = recordMemoryUsage();
      if (heapUsedMb > maxHeapMb) {
        stoppedReason = "memory-limit";
        break;
      }
    }
    if (stopOnFirstGoal && firstGoalNode) break;
    const entry = popNext();
    if (!entry) break;
    emitStateEvent("agendaPopped", entry.state, entry, {
      nodeId: entry.nodeId,
      parentId: entry.parentId,
      agendaSize: heap ? heap.length : Math.max(0, fifoEntries.length - cursor),
      reasonCode: "agenda-pop",
    });
    if (bestByKey instanceof SkylineSet) {
      if (!bestByKey.isActive(entry.key, entry.nodeId)) continue;
    } else {
      const active = bestByKey.get(entry.key);
      if (!active || active.nodeId !== entry.nodeId) continue;
    }
    const state = entry.state;
    if (!continueAfterGoal && isGoalState(state)) continue;
    expansions += 1;
    let actions = [];
    try {
      actions = typeof config.actionProvider === "function"
        ? config.actionProvider(simulator, state, entry)
        : simulator.enumeratePrimitiveActions(state).actions;
    } catch (error) {
      invalid += 1;
      if (observer) observer.emit("actionProviderError", observerStatePayload(simulator, state, entry, config, {
        reasonCode: "action-provider-error",
        error: { name: error && error.name || "Error", message: error && error.message || String(error) },
      }));
      continue;
    }
    if (typeof config.actionFilter === "function") {
      actions = actions.filter((action) => config.actionFilter(action, state));
    }
    maxActionsGeneratedForState = Math.max(maxActionsGeneratedForState, actions.length);
    if (observer) observer.emit("actionSetGenerated", observerStatePayload(simulator, state, entry, config, {
      reasonCode: "action-set-generated",
      actionCount: actions.length,
      selectedActionCount: Math.min(actions.length, maxActionsPerState),
      trimmedCount: Math.max(0, actions.length - maxActionsPerState),
      maxActionsPerState,
      expansions,
      frontierSize: heap ? heap.length : Math.max(0, fifoEntries.length - cursor),
    }));
    for (const action of actions) {
      recordAction(actionStats, action, "generated");
    }
    if (actions.length > maxActionsPerState) {
      actionTrimmed += actions.length - maxActionsPerState;
      statesWithActionTrim += 1;
    }
    const sortedActions = sortDpActions(actions);
    if (observer && sortedActions.length > maxActionsPerState) {
      sortedActions.slice(maxActionsPerState).forEach((action, index) => observer.emit(
        "candidateRejected",
        observerStatePayload(simulator, state, entry, config, {
          reasonCode: "action-trimmed",
          candidateId: `${entry.nodeId}:trimmed:${index}`,
          action: compactObserverAction(action),
        }),
      ));
    }
    sortedActions
      .slice(0, maxActionsPerState)
      .forEach((action, actionIndex) => {
        generated += 1;
        recordAction(actionStats, action, "expanded");
        const candidateId = `${entry.nodeId}:${actionIndex}`;
        if (observer) observer.emit("candidateGenerated", observerStatePayload(simulator, state, entry, config, {
          reasonCode: "candidate-generated",
          candidateId,
          action: compactObserverAction(action),
        }));
        let nextStates;
        try {
          const applier = typeof config.actionApplier === "function"
            ? config.actionApplier
            : (s, a) => simulator.applyAction(s, a, { storeRoute: false });
          const result = applier(state, action);
          nextStates = Array.isArray(result) ? result : [result];
        } catch (error) {
          invalid += 1;
          recordAction(actionStats, action, "invalid");
          if (observer) observer.emit("candidateRejected", observerStatePayload(simulator, state, entry, config, {
            reasonCode: "action-apply-error",
            candidateId,
            action: compactObserverAction(action),
            error: { name: error && error.name || "Error", message: error && error.message || String(error) },
          }));
          return;
        }
        nextStates.forEach((nextState, successorIndex) => {
          if (typeof config.stateAnnotator === "function") {
            try {
              config.stateAnnotator(nextState, state, action);
            } catch (error) {
              // Timing annotations are diagnostic and must not make the search fail.
            }
          }
          const observedAction = observer
            ? { ...action, __observerCandidateId: candidateId, __observerSuccessorId: `${candidateId}:${successorIndex}` }
            : action;
          const childNode = enqueue(nextState, observedAction, entry);
          if (childNode) recordAction(actionStats, action, "kept");
          else recordAction(actionStats, action, "dominated");
        });
      });
  }

  const frontierSize = heap
    ? heap.activeCount(isActiveEntry)
    : fifoEntries.slice(cursor).filter(isActiveEntry).length;
  recordMemoryUsage();
  if (observer) {
    const budgetReason = stoppedReason || (
      expansions >= maxExpansions && frontierSize > 0 ? "expansion-limit" : null
    );
    if (budgetReason) observer.emit(
      "budgetStopped",
      observerStatePayload(
        simulator,
        bestSeenNode ? bestSeenNode.state : initialState,
        bestSeenNode,
        config,
        {
          reasonCode: budgetReason,
          expansions,
          frontierSize,
          maxExpansions,
          maxRuntimeMs,
          maxHeapMb,
        },
      ),
    );
  }
  const goalSkylineNodes = selectGoalSkylineNodes(
    goalNodes.filter((node) => {
      if (!isGoalState(node.state)) return false;
      if (config.preserveGoalArchive === true) return true;
      if (bestByKey instanceof SkylineSet) {
        return bestByKey.isActive(node.key, node.nodeId);
      }
      const active = bestByKey.get(node.key);
      return Boolean(active && active.nodeId === node.nodeId);
    }),
    config
  );

  const attachRouteToNodeState = (node) => {
    if (!node || !node.state) return null;
    node.state.route = initialRoutePrefix.concat(reconstructActionEntries(nodes, node));
    if (captureTrace) {
      node.state.routeTrace = initialRouteTracePrefix.concat(reconstructActionTrace(nodes, node));
    } else if (Object.prototype.hasOwnProperty.call(node.state, "routeTrace")) {
      delete node.state.routeTrace;
    }
    return node.state;
  };
  const firstGoalState = attachRouteToNodeState(firstGoalNode);
  const bestGoalState = attachRouteToNodeState(bestGoalNode);
  const goalSkylineStates = goalSkylineNodes
    .map((node) => attachRouteToNodeState(node))
    .filter(Boolean);
  const bestSeenState = attachRouteToNodeState(bestSeenNode);
  const bestProgressState = attachRouteToNodeState(bestProgressNode);
  const rankedLandmarks = Array.from(landmarkArchiveByKey.values())
    .sort((left, right) => right.score - left.score || String(left.actionSummary || "").localeCompare(String(right.actionSummary || "")));
  const roleLandmarks = new Map();
  rankedLandmarks.forEach((record) => {
    if (!roleLandmarks.has(record.role)) roleLandmarks.set(record.role, record);
  });
  const selectedLandmarks = Array.from(roleLandmarks.values());
  const selectedLandmarkRecords = new Set(selectedLandmarks);
  rankedLandmarks.forEach((record) => {
    if (selectedLandmarks.length >= landmarkArchiveLimit || selectedLandmarkRecords.has(record)) return;
    selectedLandmarks.push(record);
    selectedLandmarkRecords.add(record);
  });
  const landmarkArchive = selectedLandmarks
    .slice(0, landmarkArchiveLimit)
    .map((record) => ({
      role: record.role,
      actionSummary: record.actionSummary,
      score: record.score,
      state: attachRouteToNodeState(record.node),
    }));
  const expansionBudgetExhausted = expansions >= maxExpansions &&
    frontierSize > 0 &&
    !stoppedReason &&
    !(stopOnFirstGoal && firstGoalState);

  return {
    foundGoal: Boolean(bestGoalState),
    goalState: bestGoalState,
    firstGoalState,
    bestGoalState,
    goalSkylineStates,
    bestSeenState,
    bestProgressState,
    landmarkArchive,
    fallbackState: null,
    route: bestGoalState ? bestGoalState.route : null,
    fallbackRoute: null,
    expansions,
    frontierSize,
    checkpointPool: createCheckpointPool(config.checkpointOptions),
    results: [bestGoalState, firstGoalState, ...goalSkylineStates].filter((state, index, list) => state && list.indexOf(state) === index),
    diagnostics: {
      algorithm: "dp",
      registered,
      generated,
      trimmed: actionTrimmed,
      skipped: {
        "dp-lower-hp-same-state": rejectedByHigherHp,
        "dp-same-hp-not-shorter": sameHpRejected,
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
      pruneReasons: {
        "dp-lower-hp-same-state": rejectedByHigherHp,
        "dp-same-hp-not-shorter": sameHpRejected,
      },
      suspicious: {},
      safeDominance: {},
      confluenceDominance: {
        enabled: true,
        routePolicy: "dp-key",
        acceptedStates: registered,
        newKeys,
        replacedLowerHp,
        sameHpShorterRoute,
        rejectedByHigherHp,
        sameHpRejected,
        ignoredRouteLengthRejects: 0,
        ignoredRouteLengthReplacements: 0,
        unsafeFloorDowngrades: 0,
        nonWhitelistedFloorDowngrades: 0,
        representativesByKeyMax: skylineMax,
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
        stoppedReason,
        maxRuntimeMs,
        maxHeapMb,
        heapUsedMb: Number(maxHeapUsedMb.toFixed(1)),
        rssMb: Number(maxRssMb.toFixed(1)),
        maxExpansions,
        expansions,
        frontierSize,
        expansionBudgetExhausted,
        completeWithinActionSet: actionTrimmed === 0,
        maxActionsPerState,
        actionTrimmed,
        statesWithActionTrim,
        maxActionsGeneratedForState,
        actionsGeneratedByKind: Object.fromEntries(
          Object.entries(actionStats.byKind).map(([kind, stats]) => [kind, stats.generated || 0])
        ),
        actionsExpandedByKind: Object.fromEntries(
          Object.entries(actionStats.byKind).map(([kind, stats]) => [kind, stats.expanded || 0])
        ),
        actionsKeptByKind: Object.fromEntries(
          Object.entries(actionStats.byKind).map(([kind, stats]) => [kind, stats.kept || 0])
        ),
        actionsDominatedByKind: Object.fromEntries(
          Object.entries(actionStats.byKind).map(([kind, stats]) => [kind, stats.dominated || 0])
        ),
        uniqueBattleTargets: actionStats.uniqueBattleTargets.size,
        uniquePortalEntries: actionStats.uniquePortalEntries.size,
        acceptedStates: registered,
        newKeys,
        replacedLowerHp,
        sameHpShorterRoute,
        rejectedByHigherHp,
        sameHpRejected,
        agendaMode,
        stopOnFirstGoal,
        continueAfterGoal,
        keyMode: String(config.dpKeyMode || config.keyMode || "location"),
        targetFloorOrder: getFloorOrder(config.targetFloorId || simulator.stopFloorId),
        foundFirstGoal: Boolean(firstGoalState),
        foundBestGoal: Boolean(bestGoalState),
        goalSkylineLimit: Math.max(1, Number(config.goalSkylineLimit || 8)),
        goalSkylineCount: goalSkylineStates.length,
        observerEnabled: Boolean(observer),
        observerErrors: observer ? observer.errorCount : 0,
        landmarkArchiveCount: landmarkArchive.length,
        firstGoal: firstGoalState ? {
          floorId: firstGoalState.floorId,
          hp: heroHp(firstGoalState),
          routeLength: Array.isArray(firstGoalState.route) ? firstGoalState.route.length : getDecisionDepth(firstGoalState),
          decisionDepth: getDecisionDepth(firstGoalState),
        } : null,
        bestGoal: bestGoalState ? {
          floorId: bestGoalState.floorId,
          hp: heroHp(bestGoalState),
          routeLength: Array.isArray(bestGoalState.route) ? bestGoalState.route.length : getDecisionDepth(bestGoalState),
          decisionDepth: getDecisionDepth(bestGoalState),
        } : null,
      },
    },
  };
}

module.exports = {
  buildDpStateKey,
  compareDpBest,
  searchDP,
};
