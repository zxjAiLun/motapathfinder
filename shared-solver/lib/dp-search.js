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
const observerExactStateKeyCache = new WeakMap();

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

function compactObserverAction(simulator, action) {
  if (!action) return null;
  let fingerprint = action.fingerprint || null;
  if (!fingerprint && simulator && typeof simulator.getActionFingerprint === "function") {
    try {
      fingerprint = simulator.getActionFingerprint(action);
    } catch (error) {
      fingerprint = null;
    }
  }
  return {
    kind: action.kind || null,
    summary: action.summary || null,
    fingerprint,
  };
}

function observerDominanceCaptureMode(config) {
  if (config && ["off", "compact", "targeted-state"].includes(config.observerCaptureMode)) {
    return config.observerCaptureMode;
  }
  if (config && config.observerCaptureWitnessStates === true) return "targeted-state";
  if (config && config.observerCaptureDominanceWitnesses === true) return "compact";
  return "off";
}

function jsonDiagnosticValue(value) {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    return String(value);
  }
}

function compactObjectDiff(candidate, witness) {
  const left = candidate && typeof candidate === "object" ? candidate : {};
  const right = witness && typeof witness === "object" ? witness : {};
  const added = {};
  const removed = {};
  const changed = {};
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  keys.forEach((key) => {
    const leftValue = left[key];
    const rightValue = right[key];
    if (JSON.stringify(leftValue) === JSON.stringify(rightValue)) return;
    if (rightValue === undefined) added[key] = jsonDiagnosticValue(leftValue);
    else if (leftValue === undefined) removed[key] = jsonDiagnosticValue(rightValue);
    else changed[key] = {
      candidate: jsonDiagnosticValue(leftValue),
      witness: jsonDiagnosticValue(rightValue),
    };
  });
  return { added, removed, changed };
}

function compactArrayDiff(candidate, witness) {
  const left = Array.isArray(candidate) ? candidate : [];
  const right = Array.isArray(witness) ? witness : [];
  const leftKeys = new Set(left.map((value) => JSON.stringify(value)));
  const rightKeys = new Set(right.map((value) => JSON.stringify(value)));
  return {
    added: left.filter((value) => !rightKeys.has(JSON.stringify(value))).map(jsonDiagnosticValue),
    removed: right.filter((value) => !leftKeys.has(JSON.stringify(value))).map(jsonDiagnosticValue),
  };
}

function normalizedVisitedFloors(state) {
  const visited = state && state.visitedFloors;
  if (Array.isArray(visited)) return visited.slice().sort();
  return Object.keys(visited || {}).filter((floorId) => visited[floorId]).sort();
}

function compactDominanceStateDiff(candidate, witness) {
  const candidateHero = (candidate && candidate.hero) || {};
  const witnessHero = (witness && witness.hero) || {};
  const diff = {};
  if ((candidate && candidate.floorId) !== (witness && witness.floorId)) {
    diff.floorId = { candidate: candidate && candidate.floorId, witness: witness && witness.floorId };
  }
  const candidateLoc = candidateHero.loc || null;
  const witnessLoc = witnessHero.loc || null;
  if (JSON.stringify(candidateLoc) !== JSON.stringify(witnessLoc)) {
    diff.loc = { candidate: jsonDiagnosticValue(candidateLoc), witness: jsonDiagnosticValue(witnessLoc) };
  }
  const heroDiff = compactObjectDiff(
    Object.fromEntries(["hp", "atk", "def", "mdef", "lv", "exp", "money", "mana"].map((field) => [field, candidateHero[field]])),
    Object.fromEntries(["hp", "atk", "def", "mdef", "lv", "exp", "money", "mana"].map((field) => [field, witnessHero[field]])),
  );
  const equipmentDiff = compactArrayDiff(candidateHero.equipment, witnessHero.equipment);
  if (Object.keys(heroDiff.added).length || Object.keys(heroDiff.removed).length || Object.keys(heroDiff.changed).length || equipmentDiff.added.length || equipmentDiff.removed.length) {
    diff.hero = { ...heroDiff, equipment: equipmentDiff };
  }
  const inventoryDiff = compactObjectDiff(candidate && candidate.inventory, witness && witness.inventory);
  if (Object.keys(inventoryDiff.added).length || Object.keys(inventoryDiff.removed).length || Object.keys(inventoryDiff.changed).length) {
    diff.inventory = inventoryDiff;
  }
  const flagsDiff = compactObjectDiff(candidate && candidate.flags, witness && witness.flags);
  if (Object.keys(flagsDiff.added).length || Object.keys(flagsDiff.removed).length || Object.keys(flagsDiff.changed).length) {
    diff.flags = flagsDiff;
  }
  const visitedDiff = compactArrayDiff(
    normalizedVisitedFloors(candidate),
    normalizedVisitedFloors(witness),
  );
  if (visitedDiff.added.length || visitedDiff.removed.length) diff.visitedFloors = visitedDiff;
  const mutationDiff = compactObjectDiff(
    Object.fromEntries(listFloorMutationSummary((candidate && candidate.floorStates) || {}).map((entry) => [entry.floorId, entry])),
    Object.fromEntries(listFloorMutationSummary((witness && witness.floorStates) || {}).map((entry) => [entry.floorId, entry])),
  );
  if (Object.keys(mutationDiff.added).length || Object.keys(mutationDiff.removed).length || Object.keys(mutationDiff.changed).length) {
    diff.floorMutations = mutationDiff;
  }
  return diff;
}

function dominanceComparison(candidate, witness, dominanceConfig) {
  const candidateHero = (candidate && candidate.hero) || {};
  const witnessHero = (witness && witness.hero) || {};
  const candidateDepth = getDecisionDepth(candidate);
  const witnessDepth = getDecisionDepth(witness);
  const candidateRoute = routeLengthOfState(candidate);
  const witnessRoute = routeLengthOfState(witness);
  const comparison = {
    mode: dominanceConfig && dominanceConfig.mode || "default-hp-depth-route",
    hpDiff: heroHp(candidate) - heroHp(witness),
    atkDiff: effectiveHeroValue(candidate, "atk") - effectiveHeroValue(witness, "atk"),
    defDiff: effectiveHeroValue(candidate, "def") - effectiveHeroValue(witness, "def"),
    mdefDiff: effectiveHeroValue(candidate, "mdef") - effectiveHeroValue(witness, "mdef"),
    lvDiff: Number(candidateHero.lv || 0) - Number(witnessHero.lv || 0),
    expDiff: Number(candidateHero.exp || 0) - Number(witnessHero.exp || 0),
    decisionDepthDiff: candidateDepth - witnessDepth,
    routeLengthDiff: candidateRoute - witnessRoute,
    targetMarginDiff: null,
    firstDecidingField: null,
  };
  if (dominanceConfig && typeof dominanceConfig.describeComparison === "function") {
    try {
      const described = dominanceConfig.describeComparison(candidate, witness) || {};
      const base = described.base;
      Object.assign(comparison, described);
      if (base && typeof base === "object") {
        comparison.baseComparison = base;
        if (base.targetMarginDiff != null) comparison.targetMarginDiff = base.targetMarginDiff;
        if (base.targetMarginCandidate != null) comparison.targetMarginCandidate = base.targetMarginCandidate;
        if (base.targetMarginWitness != null) comparison.targetMarginWitness = base.targetMarginWitness;
      }
    } catch (error) {
      comparison.descriptionError = error && error.message ? error.message : String(error);
    }
  }
  if (!comparison.firstDecidingField) {
    if (comparison.targetMarginDiff != null && comparison.targetMarginDiff !== 0) comparison.firstDecidingField = "targetMargin";
    else if (comparison.hpDiff !== 0) comparison.firstDecidingField = "hp";
    else if (comparison.decisionDepthDiff !== 0) comparison.firstDecidingField = "decisionDepth";
    else if (comparison.routeLengthDiff !== 0) comparison.firstDecidingField = "routeLength";
    else comparison.firstDecidingField = comparison.mode === "default-hp-depth-route" ? null : "custom";
  }
  return comparison;
}

function compactDominanceWitness(simulator, node, config) {
  if (!node || !node.state) return null;
  return {
    nodeId: node.nodeId,
    exactStateKey: observerIncludesExactStateKey(config) ? observerExactStateKey(node.state) : null,
    hero: compactObserverHero(node.state),
    decisionDepth: getDecisionDepth(node.state),
    routeLength: routeLengthOfState(node.state),
    agendaRank: compactObserverAgendaRank(node.rank),
    action: compactObserverAction(simulator, node.actionEntry || node.action),
    skylineRoles: observerRoles(config, node.state),
  };
}

function observerExactStateKey(state) {
  if (!state || typeof state !== "object") return null;
  const cached = observerExactStateKeyCache.get(state);
  if (cached) return cached;
  try {
    const key = buildStateKey(state);
    observerExactStateKeyCache.set(state, key);
    return key;
  } catch (error) {
    return null;
  }
}

function observerIncludesExactStateKey(config) {
  return config.observerIncludeExactStateKey === true ||
    (config.observer && config.observer.includeExactStateKey === true);
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
    nodeId: node && node.nodeId == null ? null : node && node.nodeId,
    floorId: state && state.floorId,
    dpKey: node && (node.key || node.stateKey) || null,
    hero: compactObserverHero(state),
    decisionDepth: getDecisionDepth(state),
    skylineRoles: observerRoles(config, state),
  };
  if (observerIncludesExactStateKey(config) && state) {
    payload.exactStateKey = observerExactStateKey(state);
  }
  void simulator;
  return payload;
}

const OBSERVER_AGENDA_RANK_FIELDS = [
  "priorityMode",
  "bestFloorRank",
  "finiteNextDistance",
  "nextDistance",
  "currentFloorRank",
  "hp",
  "atk",
  "def",
  "mdef",
  "lv",
  "exp",
  "sourceActionRank",
  "decisionDepth",
  "routeLength",
  "sequence",
];

function compactObserverAgendaRank(rank) {
  if (!rank || typeof rank !== "object") return null;
  return OBSERVER_AGENDA_RANK_FIELDS.reduce((copy, field) => {
    if (rank[field] !== undefined) copy[field] = rank[field];
    return copy;
  }, {});
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
    emit(eventType, payloadOrFactory) {
      if (eventTypes && !eventTypes.includes(eventType)) return;
      let payload;
      try {
        payload = typeof payloadOrFactory === "function" ? payloadOrFactory() : payloadOrFactory;
      } catch (error) {
        errors += 1;
        return;
      }
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
    shouldCaptureDominanceWitness(meta) {
      const predicate = typeof configured === "object" &&
        typeof configured.shouldCaptureDominanceWitness === "function"
        ? configured.shouldCaptureDominanceWitness.bind(configured)
        : null;
      if (!predicate) return true;
      try {
        return predicate(meta) !== false;
      } catch (error) {
        errors += 1;
        return false;
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
  const fairnessEvery = Math.max(1, Math.floor(number(config.fairnessEvery, 32)));
  const fairnessEnabled = agendaMode === "hybrid-fair";
  const stopOnFirstGoal = config.stopOnFirstGoal !== false;
  const continueAfterGoal = config.continueAfterGoal === true;
  const maxRuntimeMs = Number(config.maxRuntimeMs || config.timeLimitMs || 0);
  const fifoEntries = [];
  let cursor = 0;
  const fairEntries = fairnessEnabled ? [] : null;
  let fairCursor = 0;
  const expandedNodeIds = fairnessEnabled ? new Set() : null;
  const fairEnqueueExpansions = fairnessEnabled ? new Map() : null;
  const fairQueueOrdinals = fairnessEnabled ? new Map() : null;
  const agendaFairness = {
    enabled: fairnessEnabled,
    fairnessEvery,
    bestPops: 0,
    fairPops: 0,
    fairFallbacks: 0,
    bestFallbacks: 0,
    skippedInactive: 0,
    skippedAlreadyExpanded: 0,
    maxFairQueueAgeExpansions: 0,
  };
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
  const observerAgendaMeta = observer ? new Map() : null;
  const actionStats = emptyActionStats();
  const startedAt = Date.now();
  let observerCaptureElapsedMs = 0;
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
  let firstGoalExpansion = null;
  let firstGoalElapsedMs = null;
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
    observer.emit(eventType, () => observerStatePayload(
      simulator,
      state,
      node,
      config,
      typeof extra === "function" ? extra() : extra,
    ));
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
      if (observer) {
        const captureMode = observerDominanceCaptureMode(config);
        let captureDominanceWitnesses = false;
        if (captureMode !== "off") {
          const captureStartedAt = Date.now();
          captureDominanceWitnesses = observer.shouldCaptureDominanceWitness({
            dpKey: key,
            state,
            action: sourceAction,
            candidateId: sourceAction && sourceAction.__observerCandidateId || null,
            successorId: sourceAction && sourceAction.__observerSuccessorId || null,
          });
          observerCaptureElapsedMs += Date.now() - captureStartedAt;
        }
        const witnessCaptureStartedAt = captureDominanceWitnesses ? Date.now() : null;
        const witnessNodes = captureDominanceWitnesses
          ? bestByKey instanceof SkylineSet
            ? adaptiveTiming && timingConflict
              ? existingSkyline
                .filter((node) => !isBetterForSameDpKey(state, node.state, config.dominanceConfig))
                .slice(0, 4)
              : adaptiveTiming
                ? existingSkyline.slice(0, 1)
                : existingSkyline
                  .filter((node) => !isBetterForSameDpKey(state, node.state, config.dominanceConfig))
                  .slice(0, 4)
            : existing
              ? [existing]
              : []
          : [];
        const dominanceWitnesses = witnessNodes
          .map((node) => compactDominanceWitness(simulator, node, config))
          .filter(Boolean);
        const firstWitness = witnessNodes[0] && witnessNodes[0].state;
        emitStateEvent("candidateRejected", state, { key }, () => ({
          reasonCode: "dominance-rejected",
          action: compactObserverAction(simulator, sourceAction),
          candidateId: sourceAction && sourceAction.__observerCandidateId || null,
          successorId: sourceAction && sourceAction.__observerSuccessorId || null,
          dominanceWitnesses,
          dominanceComparison: firstWitness
            ? dominanceComparison(state, firstWitness, config.dominanceConfig)
            : null,
          dominanceStateDiff: firstWitness
            ? compactDominanceStateDiff(state, firstWitness)
            : null,
          dominanceWitnessStates: captureDominanceWitnesses &&
            observerDominanceCaptureMode(config) === "targeted-state"
            ? witnessNodes.map((node) => cloneState(node.state))
            : undefined,
        }));
        if (witnessCaptureStartedAt != null) {
          observerCaptureElapsedMs += Date.now() - witnessCaptureStartedAt;
        }
      }
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
    if (!skylineInserted) {
      if (observer) {
        observer.emit("candidateRejected", () => observerStatePayload(simulator, state, { key }, config, {
          reasonCode: "skyline-capacity-rejected",
          key,
          action: compactObserverAction(simulator, sourceAction),
          candidateId: sourceAction && sourceAction.__observerCandidateId || null,
          successorId: sourceAction && sourceAction.__observerSuccessorId || null,
        }));
      }
      return false;
    }
    nodes.set(node.nodeId, node);
    archiveLandmark(node, actionForEntry, parentNode);
    let enqueueExpansion = null;
    let enqueueElapsedMs = null;
    let agendaSizeAfterInsert = null;
    let agendaRank = null;
    let fairQueueOrdinal = null;
    let fairCursorAtEnqueue = null;
    let fairPopsAtEnqueue = null;
    if (observer) {
      enqueueExpansion = expansions;
      enqueueElapsedMs = Date.now() - startedAt;
      agendaSizeAfterInsert = heap
        ? heap.length + 1
        : Math.max(0, fifoEntries.length - cursor) + 1;
      agendaRank = compactObserverAgendaRank(node.rank);
      observerAgendaMeta.set(node.nodeId, {
        agendaRank,
        enqueueExpansion,
        enqueueElapsedMs,
      });
    }
    if (fairEntries) {
      fairQueueOrdinal = fairEntries.length;
      fairCursorAtEnqueue = fairCursor;
      fairPopsAtEnqueue = agendaFairness.fairPops;
      fairQueueOrdinals.set(node.nodeId, fairQueueOrdinal);
    }
    if (observer) {
      beforeSkylineIds
        .filter((nodeId) => !afterSkylineIds.includes(nodeId))
        .forEach((nodeId) => {
          const evictedNode = nodes.get(nodeId);
          observer.emit("skylineEvicted", () => observerStatePayload(
            simulator,
            evictedNode ? evictedNode.state : state,
            evictedNode || { key },
            config,
            {
              reasonCode: "skyline-replaced",
              key,
              evictedNodeId: nodeId,
              replacementNodeId: node.nodeId,
              replacementExactStateKey: observerIncludesExactStateKey(config)
                ? observerExactStateKey(state)
                : null,
              replacementHero: compactObserverHero(state),
              action: compactObserverAction(simulator, sourceAction),
              candidateId: sourceAction && sourceAction.__observerCandidateId || null,
              successorId: sourceAction && sourceAction.__observerSuccessorId || null,
            },
          ));
          if (observerAgendaMeta) observerAgendaMeta.delete(nodeId);
        });
      emitStateEvent("skylineInserted", state, node, () => ({
        reasonCode: "skyline-inserted",
        key,
        action: compactObserverAction(simulator, sourceAction),
        nodeId: node.nodeId,
        parentId: node.parentId,
        candidateId: sourceAction && sourceAction.__observerCandidateId || null,
        successorId: sourceAction && sourceAction.__observerSuccessorId || null,
        agendaRank,
        enqueueExpansion,
        expansionsCompletedAtEnqueue: enqueueExpansion,
        enqueueElapsedMs,
        agendaSizeAfterInsert,
        fairQueueOrdinal,
        fairCursorAtEnqueue,
        fairPopsAtEnqueue,
      }));
    }
    if (heap) heap.push(node);
    else fifoEntries.push(node);
    if (fairEntries) {
      fairEntries.push(node);
      fairEnqueueExpansions.set(node.nodeId, expansions);
    }
    registered += 1;
    if (!bestSeenNode || compareDpBest(state, bestSeenNode.state) > 0) bestSeenNode = node;
    const progressDiff = bestProgressNode ? compareProgress(state, bestProgressNode.state) : 1;
    if (!bestProgressNode || progressDiff > 0 || (progressDiff === 0 && compareDpBest(state, bestProgressNode.state) > 0)) {
      bestProgressNode = node;
    }
    if (isGoalState(state)) {
      if (!firstGoalNode) {
        firstGoalNode = node;
        firstGoalExpansion = expansions + 1;
        firstGoalElapsedMs = Date.now() - startedAt;
      }
      goalNodes.push(node);
      if (!bestGoalNode || compareGoalStates(state, bestGoalNode.state) > 0) bestGoalNode = node;
      if (observer) {
        emitStateEvent("goalAccepted", state, node, () => ({
          reasonCode: "goal-predicate-accepted",
          action: compactObserverAction(simulator, sourceAction),
        }));
      }
    }
    return node;
  };

  enqueue(rootState);

  const popNext = () => {
    const popBest = () => {
      while (heap && heap.length > 0) {
        const entry = heap.pop();
        if (!isActiveEntry(entry)) {
          if (fairnessEnabled) agendaFairness.skippedInactive += 1;
          continue;
        }
        if (expandedNodeIds && expandedNodeIds.has(entry.nodeId)) {
          agendaFairness.skippedAlreadyExpanded += 1;
          continue;
        }
        return { entry, popSource: "best-first" };
      }
      return null;
    };

    const popFair = () => {
      while (fairEntries && fairCursor < fairEntries.length) {
        const entry = fairEntries[fairCursor];
        fairCursor += 1;
        if (!isActiveEntry(entry)) {
          agendaFairness.skippedInactive += 1;
          continue;
        }
        if (expandedNodeIds && expandedNodeIds.has(entry.nodeId)) {
          agendaFairness.skippedAlreadyExpanded += 1;
          continue;
        }
        return { entry, popSource: "fair-oldest" };
      }
      return null;
    };

    if (fairnessEnabled) {
      const fairDue = (expansions + 1) % fairnessEvery === 0;
      if (fairDue) {
        const fairResult = popFair();
        if (fairResult) {
          agendaFairness.fairPops += 1;
          return fairResult;
        }
        agendaFairness.fairFallbacks += 1;
      }
      const bestResult = popBest();
      if (bestResult) {
        agendaFairness.bestPops += 1;
        return bestResult;
      }
      if (!fairDue) agendaFairness.bestFallbacks += 1;
      const fairResult = popFair();
      if (fairResult) {
        agendaFairness.fairPops += 1;
        return fairResult;
      }
      return null;
    }

    if (heap) {
      while (heap.length > 0) {
        const entry = heap.pop();
        if (isActiveEntry(entry)) return { entry, popSource: "best-first" };
      }
      return null;
    }
    while (cursor < fifoEntries.length) {
      const entry = fifoEntries[cursor];
      cursor += 1;
      if (isActiveEntry(entry)) return { entry, popSource: "fifo" };
    }
    return null;
  };

  const maxHeapMb = Number(config.maxHeapMb || 0);
  const maxRssMb = Number(config.maxRssMb || 0);
  const memoryCheckIntervalExpansions = Math.max(
    1,
    Math.floor(number(config.memoryCheckIntervalExpansions, 1)),
  );
  const memoryUsageProvider = typeof config.memoryUsageProvider === "function"
    ? config.memoryUsageProvider
    : () => process.memoryUsage();
  let maxHeapUsedMb = 0;
  let peakRssMb = 0;
  let stopHeapUsedMb = null;
  let stopRssMb = null;
  let stoppedAtExpansion = null;
  let stoppedAtPhase = null;
  let memorySampleCount = 0;
  let memoryStoppedReason = null;
  const readMemoryUsage = () => {
    let memory;
    try {
      memory = memoryUsageProvider() || {};
    } catch (error) {
      memory = process.memoryUsage();
    }
    const heapUsedMb = Number(memory.heapUsed || 0) / 1024 / 1024;
    const rssMb = Number(memory.rss || 0) / 1024 / 1024;
    return { heapUsedMb, rssMb };
  };
  const recordMemoryUsage = (phase, expansion, shouldStop = true) => {
    const usage = readMemoryUsage();
    const { heapUsedMb, rssMb } = usage;
    memorySampleCount += 1;
    maxHeapUsedMb = Math.max(maxHeapUsedMb, heapUsedMb);
    peakRssMb = Math.max(peakRssMb, rssMb);
    if (shouldStop && !memoryStoppedReason) {
      if (maxHeapMb > 0 && heapUsedMb >= maxHeapMb) {
        memoryStoppedReason = "heap-limit";
      } else if (maxRssMb > 0 && rssMb >= maxRssMb) {
        memoryStoppedReason = "rss-limit";
      }
      if (memoryStoppedReason) {
        stopHeapUsedMb = heapUsedMb;
        stopRssMb = rssMb;
        stoppedAtExpansion = expansion;
        stoppedAtPhase = phase;
      }
    }
    return usage;
  };
  const memoryCheckDue = (expansionOrdinal) =>
    expansionOrdinal <= 0 || expansionOrdinal % memoryCheckIntervalExpansions === 0;
  const stopForMemoryIfNeeded = (phase, expansion, expansionOrdinal, force = false) => {
    if (!force && !memoryCheckDue(expansionOrdinal)) return false;
    recordMemoryUsage(phase, expansion, true);
    if (memoryStoppedReason) {
      stoppedReason = memoryStoppedReason;
      return true;
    }
    return false;
  };
  while (expansions < maxExpansions) {
    if (maxRuntimeMs > 0 && Date.now() - startedAt >= maxRuntimeMs) {
      stoppedReason = "time-limit";
      break;
    }
    if (stopForMemoryIfNeeded("before-expansion", expansions, expansions + 1, expansions === 0)) break;
    if (stopOnFirstGoal && firstGoalNode) break;
    const selected = popNext();
    if (!selected) break;
    const entry = selected.entry;
    const popExpansion = observer ? expansions : null;
    const expansionOrdinal = expansions + 1;
    const popElapsedMs = observer ? Date.now() - startedAt : null;
    const enqueueMeta = observerAgendaMeta && observerAgendaMeta.get(entry.nodeId);
    const queueAgeExpansions = enqueueMeta
      ? popExpansion - enqueueMeta.enqueueExpansion
      : null;
    const queueAgeMs = enqueueMeta
      ? popElapsedMs - enqueueMeta.enqueueElapsedMs
      : null;
    const agendaRank = observer ? compactObserverAgendaRank(entry.rank) : null;
    if (fairnessEnabled && selected.popSource === "fair-oldest") {
      const enqueueExpansion = fairEnqueueExpansions.get(entry.nodeId);
      const fairQueueAge = enqueueExpansion == null
        ? 0
        : Math.max(0, expansions - enqueueExpansion);
      agendaFairness.maxFairQueueAgeExpansions = Math.max(
        agendaFairness.maxFairQueueAgeExpansions,
        fairQueueAge,
      );
    }
    if (expandedNodeIds) expandedNodeIds.add(entry.nodeId);
    emitStateEvent("agendaPopped", entry.state, entry, {
      nodeId: entry.nodeId,
      parentId: entry.parentId,
      action: compactObserverAction(simulator, entry.actionEntry || entry.action),
      agendaSize: heap ? heap.length : Math.max(0, fifoEntries.length - cursor),
      reasonCode: "agenda-pop",
      agendaRank,
      popExpansion,
      expansionsCompletedBeforePop: popExpansion,
      popElapsedMs,
      queueAgeExpansions,
      queueAgeMs,
      popSource: selected.popSource,
      fairnessEvery: fairnessEnabled ? fairnessEvery : 0,
      expansionOrdinal,
      fairQueueOrdinal: fairQueueOrdinals ? fairQueueOrdinals.get(entry.nodeId) : null,
      fairCursorAtPop: fairnessEnabled ? fairCursor : null,
      fairPopsAtPop: fairnessEnabled ? agendaFairness.fairPops : null,
    });
    if (observerAgendaMeta) observerAgendaMeta.delete(entry.nodeId);
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
      if (observer) observer.emit("actionProviderError", () => observerStatePayload(simulator, state, entry, config, {
        reasonCode: "action-provider-error",
        error: { name: error && error.name || "Error", message: error && error.message || String(error) },
      }));
      if (stopForMemoryIfNeeded("after-action-provider", expansions, expansions)) break;
      continue;
    }
    if (typeof config.actionFilter === "function") {
      actions = actions.filter((action) => config.actionFilter(action, state));
    }
    if (stopForMemoryIfNeeded("after-action-provider", expansions, expansions)) break;
    maxActionsGeneratedForState = Math.max(maxActionsGeneratedForState, actions.length);
    if (observer) observer.emit("actionSetGenerated", () => observerStatePayload(simulator, state, entry, config, {
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
        () => observerStatePayload(simulator, state, entry, config, {
          reasonCode: "action-trimmed",
          candidateId: `${entry.nodeId}:trimmed:${index}`,
          action: compactObserverAction(simulator, action),
        }),
      ));
    }
    let stopAfterSuccessorBatch = false;
    sortedActions
      .slice(0, maxActionsPerState)
      .forEach((action, actionIndex) => {
        if (stopAfterSuccessorBatch) return;
        generated += 1;
        recordAction(actionStats, action, "expanded");
        const candidateId = `${entry.nodeId}:${actionIndex}`;
        if (observer) observer.emit("candidateGenerated", () => observerStatePayload(simulator, state, entry, config, {
          reasonCode: "candidate-generated",
          candidateId,
          action: compactObserverAction(simulator, action),
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
          if (observer) observer.emit("candidateRejected", () => observerStatePayload(simulator, state, entry, config, {
            reasonCode: "action-apply-error",
            candidateId,
            action: compactObserverAction(simulator, action),
            error: { name: error && error.name || "Error", message: error && error.message || String(error) },
          }));
          return;
        }
        nextStates.forEach((nextState, successorIndex) => {
          if (stopAfterSuccessorBatch) return;
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
        if (stopForMemoryIfNeeded("after-successor-enqueue", expansions, expansions)) {
          stopAfterSuccessorBatch = true;
        }
      });
    if (stopAfterSuccessorBatch) break;
  }

  agendaFairness.fairCursor = fairnessEnabled ? fairCursor : 0;
  agendaFairness.fairQueueLength = fairnessEnabled ? fairEntries.length : 0;
  agendaFairness.fairActiveUnexpanded = fairnessEnabled
    ? fairEntries.filter((entry) => isActiveEntry(entry) && !expandedNodeIds.has(entry.nodeId)).length
    : 0;
  const frontierIsActive = (entry) => isActiveEntry(entry) &&
    (!expandedNodeIds || !expandedNodeIds.has(entry.nodeId));
  const frontierSize = heap
    ? heap.activeCount(frontierIsActive)
    : fifoEntries.slice(cursor).filter(isActiveEntry).length;
  recordMemoryUsage("between-attempts", expansions, !memoryStoppedReason);
  if (observer) {
    const budgetReason = stoppedReason || (
      expansions >= maxExpansions && frontierSize > 0 ? "expansion-limit" : null
    );
    if (budgetReason) observer.emit(
      "budgetStopped",
      () => observerStatePayload(
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
            maxRssMb,
            memoryCheckIntervalExpansions,
            memory: {
              maxHeapMb,
              maxRssMb,
              memoryCheckIntervalExpansions,
              peakHeapUsedMb: maxHeapUsedMb,
              peakRssMb,
              stopHeapUsedMb,
              stopRssMb,
              stoppedReason: memoryStoppedReason,
              stoppedAtExpansion,
              stoppedAtPhase,
              sampleCount: memorySampleCount,
              heapOvershootMb: stopHeapUsedMb == null || maxHeapMb <= 0
                ? 0
                : Math.max(0, stopHeapUsedMb - maxHeapMb),
              rssOvershootMb: stopRssMb == null || maxRssMb <= 0
                ? 0
                : Math.max(0, stopRssMb - maxRssMb),
            },
            fairCursor: fairnessEnabled ? fairCursor : null,
            fairPops: fairnessEnabled ? agendaFairness.fairPops : null,
            fairnessEvery: fairnessEnabled ? fairnessEvery : 0,
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
        priorityMode: String(config.dpPriorityMode || "default"),
        dpSkylineMax: skylineMax,
        actionProviderMode: config.actionProviderMode || "primitive",
        stoppedReason,
        maxRuntimeMs,
        maxHeapMb,
        maxRssMb,
        memoryCheckIntervalExpansions,
        wallMs: Date.now() - startedAt,
        heapUsedMb: Number(maxHeapUsedMb.toFixed(1)),
        rssMb: Number(peakRssMb.toFixed(1)),
        memory: {
          maxHeapMb,
          maxRssMb,
          memoryCheckIntervalExpansions,
          peakHeapUsedMb: Number(maxHeapUsedMb.toFixed(1)),
          peakRssMb: Number(peakRssMb.toFixed(1)),
          stopHeapUsedMb: stopHeapUsedMb == null ? null : Number(stopHeapUsedMb.toFixed(1)),
          stopRssMb: stopRssMb == null ? null : Number(stopRssMb.toFixed(1)),
          stoppedReason: memoryStoppedReason,
          stoppedAtExpansion,
          stoppedAtPhase,
          sampleCount: memorySampleCount,
          heapOvershootMb: stopHeapUsedMb == null || maxHeapMb <= 0
            ? 0
            : Number(Math.max(0, stopHeapUsedMb - maxHeapMb).toFixed(1)),
          rssOvershootMb: stopRssMb == null || maxRssMb <= 0
            ? 0
            : Number(Math.max(0, stopRssMb - maxRssMb).toFixed(1)),
        },
        maxExpansions,
        expansions,
        frontierSize,
        expansionBudgetExhausted,
        completeWithinActionSet: actionTrimmed === 0,
        maxActionsPerState,
        actionTrimmed,
        statesWithActionTrim,
        maxActionsGeneratedForState,
        observerCaptureMode: observerDominanceCaptureMode(config),
        observerCaptureElapsedMs,
        agendaFairness,
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
        fairnessEvery,
        stopOnFirstGoal,
        continueAfterGoal,
        keyMode: String(config.dpKeyMode || config.keyMode || "location"),
        targetFloorOrder: getFloorOrder(config.targetFloorId || simulator.stopFloorId),
        foundFirstGoal: Boolean(firstGoalState),
        firstGoalExpansion,
        firstGoalElapsedMs,
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
