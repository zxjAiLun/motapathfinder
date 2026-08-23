"use strict";

const { getProgress, compareProgress } = require("./progress");
const { estimateNextFloorDistance, getFloorOrder } = require("./score");
const { cloneState, getDecisionDepth, getRawRouteLength, listFloorMutationSummary } = require("./state");
const { buildStateKey } = require("./state-key");
const {
  SOLVER_HERO_FIELDS,
  getSolverModel,
} = require("./solver-model");
const { createCheckpointPool } = require("./floor-checkpoints");
const {
  createChildNode,
  createRootNode,
  normalizeActionEntry,
  reconstructActionTrace,
  reconstructMaterializedActionEntries,
} = require("./search-nodes");
const { getActivePerfTracker, timeActivePhase } = require("./perf");
const { buildSearchOutcome } = require("./search-outcome");

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

function buildModelHeroKey(hero, model) {
  return SOLVER_HERO_FIELDS.reduce((result, field) => {
    if (((model.heroFields || {})[field]) !== "key") return result;
    if (field === "equipment" || field === "followers") {
      result[field] = stableArray(hero[field]);
    } else {
      result[field] = Number(hero[field] || 0);
    }
    return result;
  }, {});
}

function buildDpStateKey(simulator, state, options) {
  const config = options || {};
  const keyMode = String(config.dpKeyMode || config.keyMode || "location");
  const hero = state.hero || {};
  const solverModel = getSolverModel(
    state,
    config.solverModel || config.model,
    simulator && simulator.solverModel,
  );
  let region = null;
  if (keyMode === "region") {
    try {
      region = simulator.buildReachableRegionSignature(state);
    } catch (error) {
      region = null;
    }
  }
  const baseKey = {
    floorId: state.floorId,
    keyMode,
    regionKey: region
      ? region.regionKey
      : keyMode === "mutation"
        ? ""
        : `${state.floorId}:${hero.loc && hero.loc.x},${hero.loc && hero.loc.y}`,
    reachableEndpointsKey: region ? region.reachableEndpointsKey : "",
    hero: solverModel.explicit
      ? buildModelHeroKey(hero, solverModel)
      : {
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
  };
  if (solverModel.explicit) baseKey.solverModel = solverModel.fingerprint;
  return JSON.stringify(baseKey);
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
  return getRawRouteLength(state);
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

// The goal-state comparator is a pure terminal hook.  It orders which reached
// goal states are retained in the goal archive / bestGoalNode / final goal
// result, and may be replaced per-segment (e.g. with an ObjectiveSpec-aware
// comparator on the final segment).  It must never be used for bestByKey,
// isBetterForSameDpKey, the agenda, action ranking, or intermediate pruning.
// The default delegates to compareGoalStates and tolerates both raw states and
// node/candidate records.
function resolveGoalStateComparator(config) {
  const custom = config && config.goalStateComparator;
  if (typeof custom === "function") return custom;
  return (left, right) => {
    const leftState = left && left.state ? left.state : left;
    const rightState = right && right.state ? right.state : right;
    return compareGoalStates(leftState, rightState);
  };
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
  const leftRoute = getRawRouteLength(left);
  const rightRoute = getRawRouteLength(right);
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

function projectGoalProgress(goalProgressProjector, state) {
  try {
    const projected = goalProgressProjector(state) || {};
    return {
      feasible: projected.feasible !== false ? 1 : 0,
      completion: Math.max(0, Math.min(1, finiteNumber(projected.completion, 0))),
      requirementsMet: Math.max(0, finiteNumber(projected.requirementsMet, 0)),
      requirementsTotal: Math.max(0, finiteNumber(projected.requirementsTotal, 0)),
      floorMatch: projected.floorMatch === true ? 1 : 0,
      downstreamCompletion: Math.max(0, Math.min(1, finiteNumber(projected.downstreamCompletion, 0))),
      downstreamRequirementsMet: Math.max(0, finiteNumber(projected.downstreamRequirementsMet, 0)),
      irreversibleLandmarksMet: Math.max(0, finiteNumber(projected.irreversibleLandmarksMet, 0)),
      nextLandmarkReachable: projected.nextLandmarkReachable !== false ? 1 : 0,
      nextLandmarkDistance: finiteNumber(projected.nextLandmarkDistance, 9999),
      statDeficit: Math.max(0, finiteNumber(projected.statDeficit, 0)),
    };
  } catch (error) {
    return null;
  }
}

function buildDpAgendaRank(simulator, state, sourceAction, sequence, options) {
  const config = options || {};
  const progress = getProgress(state);
  const hero = state.hero || {};
  const nextDistance = estimateNextFloorDistance(state, simulator.project);
  const routeLength = getRawRouteLength(state);
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

function buildGoalDirectedDpAgendaRank(simulator, state, sourceAction, sequence, options) {
  const rank = buildDpAgendaRank(simulator, state, sourceAction, sequence, options);
  const goalProgress = projectGoalProgress(options.goalProgressProjector, state);
  if (goalProgress) {
    rank.goalFeasible = goalProgress.feasible;
    rank.goalCompletion = goalProgress.completion;
    rank.goalRequirementsMet = goalProgress.requirementsMet;
    rank.goalRequirementsTotal = goalProgress.requirementsTotal;
    rank.goalFloorMatch = goalProgress.floorMatch;
    rank.goalDownstreamCompletion = goalProgress.downstreamCompletion;
    rank.goalDownstreamRequirementsMet = goalProgress.downstreamRequirementsMet;
    rank.goalIrreversibleLandmarksMet = goalProgress.irreversibleLandmarksMet;
    rank.goalNextLandmarkReachable = goalProgress.nextLandmarkReachable;
    rank.goalNextLandmarkDistance = goalProgress.nextLandmarkDistance;
    rank.goalStatDeficit = goalProgress.statDeficit;
  }
  return rank;
}

function compareGoalDirectedDpAgendaRank(left, right) {
  const goalHighWins = [
    "goalFeasible",
    "goalCompletion",
    "goalRequirementsMet",
    "goalIrreversibleLandmarksMet",
    "goalDownstreamCompletion",
    "goalDownstreamRequirementsMet",
    "goalNextLandmarkReachable",
    "sourceActionRank",
    "bestFloorRank",
    "currentFloorRank",
    "hp",
    "atk",
    "def",
    "mdef",
    "lv",
    "exp",
    "finiteNextDistance",
  ];
  for (const field of goalHighWins) {
    const diff = Number(left[field] || 0) - Number(right[field] || 0);
    if (diff !== 0) return diff;
  }
  if (left.goalNextLandmarkDistance !== right.goalNextLandmarkDistance) {
    return right.goalNextLandmarkDistance - left.goalNextLandmarkDistance;
  }
  if (left.goalStatDeficit !== right.goalStatDeficit) {
    return right.goalStatDeficit - left.goalStatDeficit;
  }
  if (left.nextDistance !== right.nextDistance) return right.nextDistance - left.nextDistance;
  if (left.decisionDepth !== right.decisionDepth) return right.decisionDepth - left.decisionDepth;
  if (left.routeLength !== right.routeLength) return right.routeLength - left.routeLength;
  return right.sequence - left.sequence;
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
  const goalComparator = resolveGoalStateComparator(config);
  // Terminal ordering MUST compare materialized states (detached clones carrying
  // real route arrays) so route-length objectives see the real entry count, not
  // the canonical empty route.  `stateForNode` supplies those clones; without it
  // the comparator falls back to node.state (which stays route-free).
  const stateOf = typeof config.stateForNode === "function"
    ? config.stateForNode
    : (node) => node && node.state;
  const sorted = (goalNodes || [])
    .filter(Boolean)
    .slice()
    .sort((left, right) => goalComparator(stateOf(right), stateOf(left)));
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

function compactGoalArchiveNode(simulator, node, config, stateOverride) {
  if (!node || (!node.state && !stateOverride)) return null;
  const state = stateOverride || node.state;
  return {
    nodeId: node.nodeId,
    parentId: node.parentId == null ? null : node.parentId,
    exactStateKey: buildStateKey(state),
    dpKey: node.key || node.stateKey || null,
    state: cloneState(state),
    hero: compactObserverHero(state),
    inventory: stableObject(state.inventory),
    flags: stableObject(state.flags),
    visitedFloors: Object.keys(state.visitedFloors || {}).sort(),
    mutations: listFloorMutationSummary(state.floorStates || {}),
    routeLength: routeLengthOfState(state),
    decisionDepth: getDecisionDepth(state),
    action: compactObserverAction(simulator, node.actionEntry || node.action),
    skylineRoles: observerRoles(config, state),
  };
}

function describeGoalArchiveComparison(left, right, goalComparator) {
  if (!left || !right) return null;
  const customComparator = typeof goalComparator === "function";
  const compare = customComparator ? goalComparator : compareGoalStates;
  const fields = [
    "hp",
    "effectiveAtk",
    "effectiveDef",
    "effectiveMdef",
    "rawLv",
    "rawExp",
    "rawAtk",
    "rawDef",
    "rawMdef",
    "routeLength",
  ];
  const comparison = {
    comparator: customComparator ? "goalStateComparator" : "compareGoalStates",
    result: compare(left, right),
    hpDiff: heroHp(left) - heroHp(right),
    effectiveAtkDiff: effectiveHeroValue(left, "atk") - effectiveHeroValue(right, "atk"),
    effectiveDefDiff: effectiveHeroValue(left, "def") - effectiveHeroValue(right, "def"),
    effectiveMdefDiff: effectiveHeroValue(left, "mdef") - effectiveHeroValue(right, "mdef"),
    rawLvDiff: Number((left.hero || {}).lv || 0) - Number((right.hero || {}).lv || 0),
    rawExpDiff: Number((left.hero || {}).exp || 0) - Number((right.hero || {}).exp || 0),
    rawAtkDiff: Number((left.hero || {}).atk || 0) - Number((right.hero || {}).atk || 0),
    rawDefDiff: Number((left.hero || {}).def || 0) - Number((right.hero || {}).def || 0),
    rawMdefDiff: Number((left.hero || {}).mdef || 0) - Number((right.hero || {}).mdef || 0),
    routeLengthDiff: routeLengthOfState(right) - routeLengthOfState(left),
    firstDecidingField: null,
  };
  for (const field of fields) {
    const diff = field === "hp"
      ? comparison.hpDiff
      : field === "effectiveAtk"
        ? comparison.effectiveAtkDiff
        : field === "effectiveDef"
          ? comparison.effectiveDefDiff
          : field === "effectiveMdef"
            ? comparison.effectiveMdefDiff
            : comparison[`${field.replace("effective", "").replace(/^raw/, "raw")}Diff`] || comparison[`${field}Diff`];
    if (diff !== 0) {
      comparison.firstDecidingField = field;
      break;
    }
  }
  if (!comparison.firstDecidingField && comparison.routeLengthDiff !== 0) {
    comparison.firstDecidingField = "routeLength";
  }
  return comparison;
}

function buildGoalArchiveAudit({
  simulator,
  config,
  goalNodes,
  activeGoalNodes,
  selectedGoalNodes,
  accepted,
  events,
  captureTruncated,
}) {
  if (!config || !config.goalArchiveAudit) return null;
  const captureAllGoalCandidates = config.goalArchiveAudit.captureAllGoalCandidates === true;
  const configuredTargetKeys = Array.isArray(config.goalArchiveAudit.targetExactStateKeys)
    ? config.goalArchiveAudit.targetExactStateKeys.filter(Boolean)
    : [];
  const capturedKeys = captureAllGoalCandidates
    ? accepted.map((entry) => entry && entry.exactStateKey).concat(
      events.flatMap((event) => [event.candidate, event.evicted, event.replacement])
        .map((entry) => entry && entry.exactStateKey),
    ).filter(Boolean)
    : [];
  const targetKeys = Array.from(new Set(configuredTargetKeys.concat(capturedKeys)));
  const activeNodeIds = new Set(activeGoalNodes.map((node) => node.nodeId));
  const selectedNodeIds = new Set(selectedGoalNodes.map((node) => node.nodeId));
  const goalArchiveCapacity = Math.max(1, Number(config.goalSkylineLimit || 8));
  const goalComparator = resolveGoalStateComparator(config);
  const sortedActive = activeGoalNodes
    .slice()
    .sort((left, right) => goalComparator(right, left));
  const sortedIndex = new Map(sortedActive.map((node, index) => [node.nodeId, index]));
  const selectedIndex = new Map(selectedGoalNodes.map((node, index) => [node.nodeId, index]));
  const targetRecords = targetKeys.map((exactStateKey) => {
    const insertions = accepted.filter((entry) => entry.exactStateKey === exactStateKey);
    const evictions = events.filter((event) => (
      event.eventType === "goal-archive-evicted" &&
      event.evicted && event.evicted.exactStateKey === exactStateKey
    ));
    const rejections = events.filter((event) => (
      event.eventType === "goal-candidate-rejected" &&
      event.candidate && event.candidate.exactStateKey === exactStateKey
    ));
    const nodeIds = insertions.map((entry) => entry.nodeId);
    const activeInsertions = insertions.filter((entry) => activeNodeIds.has(entry.nodeId));
    const selectedInsertions = insertions.filter((entry) => selectedNodeIds.has(entry.nodeId));
    const firstEviction = evictions[0] || null;
    const firstInsertion = insertions[0] || null;
    const targetNode = activeGoalNodes.find((node) => node.nodeId === (firstInsertion && firstInsertion.nodeId));
    const targetPosition = targetNode ? sortedIndex.get(targetNode.nodeId) : null;
    const targetKey = targetNode && (config.preserveGoalArchive ? `goal:${targetNode.nodeId}` : targetNode.key || targetNode.stateKey || `node:${targetNode.nodeId}`);
    const selectedTargetKey = targetKey && selectedGoalNodes.some((node) => (
      (config.preserveGoalArchive ? `goal:${node.nodeId}` : node.key || node.stateKey || `node:${node.nodeId}`) === targetKey
    ));
    const capacityBoundaryNode = targetPosition != null && !selectedInsertions.length && !selectedTargetKey
      ? selectedGoalNodes[selectedGoalNodes.length - 1]
      : null;
    const capacityBoundaryWitness = capacityBoundaryNode
      ? compactGoalArchiveNode(simulator, capacityBoundaryNode, config)
      : null;
    return {
      exactStateKey,
      label: config.goalArchiveAudit.targetLabels && config.goalArchiveAudit.targetLabels[exactStateKey] || null,
      insertionCount: insertions.length,
      insertions,
      nodeIds,
      activeAtFinish: activeInsertions.length > 0,
      selectedAtFinish: selectedInsertions.length > 0,
      rawSortRanks: activeInsertions.map((entry) => sortedIndex.get(entry.nodeId)).filter((index) => index != null),
      selectedArchiveRanks: selectedInsertions.map((entry) => selectedIndex.get(entry.nodeId)).filter((index) => index != null),
      archiveDecision: firstEviction
        ? "evicted-by-skyline-replacement"
        : rejections.length > 0
          ? rejections[0].reasonCode === "skyline-capacity-rejected"
            ? "rejected-by-dp-skyline-capacity"
            : "rejected-by-dominance"
          : capacityBoundaryWitness
            ? "rejected-by-goal-archive-capacity"
            : selectedInsertions.length > 0
            ? "selected"
            : activeInsertions.length > 0
              ? "rejected-by-goal-archive-capacity-or-deduplication"
              : "inactive-without-captured-replacement",
      evictions,
      rejections,
      witnessKind: firstEviction
        ? "goal-archive-eviction-replacement"
        : capacityBoundaryWitness
          ? "goal-archive-capacity-boundary"
          : null,
      actualReplacementWitness: firstEviction && firstEviction.replacement || null,
      capacityBoundaryWitness,
      comparison: firstEviction && firstEviction.comparison || capacityBoundaryNode
        ? describeGoalArchiveComparison(
          targetNode && targetNode.state,
          capacityBoundaryNode && capacityBoundaryNode.state,
          goalComparator,
        )
        : null,
      initialInsertion: firstInsertion || null,
    };
  });
  return {
    enabled: true,
    captureAllGoalCandidates,
    targetExactStateKeys: targetKeys,
    acceptedCandidates: accepted.slice(),
    acceptedCandidateCount: accepted.length,
    captureTruncated: captureTruncated === true,
    goalNodesSeen: goalNodes.length,
    activeGoalNodes: activeGoalNodes.length,
    selectedGoalNodes: selectedGoalNodes.length,
    goalArchiveCapacity,
    dpSkylineCapacity: Number(config.dpSkylineMax || 1),
    goalArchiveRole: config.goalArchiveAudit.role || "raw-dp-goal-archive",
    activeCandidates: sortedActive.map((node, index) => ({
      rawSortRank: index,
      selectedArchiveRank: selectedIndex.has(node.nodeId) ? selectedIndex.get(node.nodeId) : null,
      selected: selectedNodeIds.has(node.nodeId),
      candidate: compactGoalArchiveNode(simulator, node, config),
    })),
    targetRecords,
    events: events.slice(),
  };
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
  "goalFeasible",
  "goalCompletion",
  "goalRequirementsMet",
  "goalRequirementsTotal",
  "goalFloorMatch",
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
  // PR-5.4b perf hooks: only active when a perf tracker is installed (the
  // benchmark sets one); zero measurable overhead in normal search.
  const perfTracker = getActivePerfTracker();
  const perfActive = Boolean(perfTracker && perfTracker.enabled);
  const profileExpansion = Boolean(perfActive && perfTracker.profileExpansionCost);
  const trackPerfCount = (name, amount) => {
    if (!perfActive) return;
    perfTracker.increment(name, amount);
  };
  const trackPerfPhase = (name, fn) => (perfActive ? timeActivePhase(name, fn) : fn());
  let depthSum = 0;
  let depthMax = 0;
  // Route-free invariant diagnostics: canonical search states must never carry
  // a non-empty materialized route array (the search applies with
  // storeRoute:false and the enqueue copy drops the route field entirely).
  let nonEmptyRouteStateCount = 0;
  let maxRawRouteLength = 0;
  // Test-mode state corpus capture (TowerIR shadow contract): records a capped,
  // deduped set of expanded states for shadow evaluation.
  const captureEnabled = config.captureExpandedStates === true;
  const captureLimit = Math.max(1, Number(config.captureExpandedStateLimit || 0));
  const capturedExpandedStates = [];
  const capturedStateKeys = new Set();
  // TowerIR shadow observation hook (test/diagnostic only): runs per expanded
  // state, NEVER affects the search.  Any throw is swallowed.
  const shadowCheckState = typeof config.towerIrShadowCheckState === "function"
    ? config.towerIrShadowCheckState
    : null;
  // Dual-key shadow recorder (observation only): records each enqueue decision
  // (state + exact key + production keep/reject/replace) for the post-search
  // candidate-key shadow.  Never affects the search; throws are swallowed.
  const candidateKeyShadowRecorder = typeof config.candidateKeyShadowRecorder === "function"
    ? config.candidateKeyShadowRecorder
    : null;
  const observer = createDpObserver(config);
  const goalStateComparator = resolveGoalStateComparator(config);
  const shouldStop = typeof config.shouldStop === "function"
    ? config.shouldStop
    : () => false;
  const maxExpansions = Number(config.maxExpansions || 1000);
  const maxActionsPerState = Number(config.maxActionsPerState || 256);
  const agendaMode = String(config.dpAgendaMode || config.agendaMode || "best-first");
  const fairnessEvery = Math.max(1, Math.floor(number(config.fairnessEvery, 32)));
  const fairnessEnabled = agendaMode === "hybrid-fair";
  const stopOnFirstGoal = config.stopOnFirstGoal !== false;
  const maxExpansionsAfterFirstGoal = config.maxExpansionsAfterFirstGoal == null
    ? null
    : Math.max(0, Math.floor(number(config.maxExpansionsAfterFirstGoal, 0)));
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
    : config.dpPriorityMode === "goal-directed"
      ? new BinaryHeap((left, right) => compareGoalDirectedDpAgendaRank(left.rank, right.rank))
      : new BinaryHeap((left, right) => compareDpAgendaRank(left.rank, right.rank));
  const initialRoutePrefix = Array.isArray(initialState.route) ? initialState.route.slice() : [];
  const captureTrace = config.captureTrace === true;
  const initialRouteTracePrefix = captureTrace && Array.isArray(config.initialRouteTracePrefix)
    ? config.initialRouteTracePrefix
    : [];
  const rootState = cloneState(initialState);
  rootState.route = [];
  // The carried route prefix's length survives on the canonical state as the
  // raw route length; the in-search state itself stays route-free.  The true
  // cumulative raw length (decisions + auto steps) from the caller's state is
  // authoritative and must NEVER be re-derived from the materialized prefix.
  if (!rootState.meta) rootState.meta = {};
  rootState.meta.rawRouteLength = Math.max(
    getRawRouteLength(initialState),
    initialRoutePrefix.length,
  );
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
  let goalFeasibilityPruned = 0;
  const goalFeasibilityPrunedByReason = {};
  const goalFeasibilitySamples = [];
  let firstGoalNode = null;
  let firstGoalExpansion = null;
  let firstGoalElapsedMs = null;
  let bestGoalNode = null;
  let deepestExpandedNode = null;
  const goalNodes = [];
  const goalArchiveAuditConfig = config.goalArchiveAudit && typeof config.goalArchiveAudit === "object"
    ? config.goalArchiveAudit
    : null;
  const goalArchiveTargetExactStateKeys = new Set(
    goalArchiveAuditConfig && Array.isArray(goalArchiveAuditConfig.targetExactStateKeys)
      ? goalArchiveAuditConfig.targetExactStateKeys.filter(Boolean)
      : [],
  );
  const goalArchiveCaptureAll = Boolean(
    goalArchiveAuditConfig && goalArchiveAuditConfig.captureAllGoalCandidates === true,
  );
  const goalArchiveAuditMaxCandidates = Math.max(
    1,
    Number(
      goalArchiveAuditConfig && goalArchiveAuditConfig.maxCandidates ||
      (goalArchiveCaptureAll ? 256 : Number.MAX_SAFE_INTEGER),
    ),
  );
  const goalArchiveAuditMaxEvents = Math.max(
    1,
    Number(
      goalArchiveAuditConfig && goalArchiveAuditConfig.maxEvents ||
      (goalArchiveCaptureAll ? 512 : 200),
    ),
  );
  const goalArchiveAuditAccepted = [];
  const goalArchiveAuditEvents = [];
  const goalArchiveAuditRelevantNodeIds = new Set();
  let goalArchiveAuditCaptureTruncated = false;
  const goalArchiveAuditMatches = (exactStateKey) =>
    goalArchiveCaptureAll || goalArchiveTargetExactStateKeys.has(exactStateKey);
  const materializeAuditState = (state, parentNode, sourceAction) => {
    if (!state) return null;
    const materialized = cloneState(state);
    const ephemeralNode = {
      parentId: parentNode ? parentNode.nodeId : null,
      state,
      actionEntry: normalizeActionEntry(sourceAction),
    };
    materialized.route = initialRoutePrefix.concat(
      reconstructMaterializedActionEntries(nodes, ephemeralNode),
    );
    if (!materialized.meta) materialized.meta = {};
    materialized.meta.rawRouteLength = getRawRouteLength(state);
    return materialized;
  };
  const goalArchiveAuditEvent = (event) => {
    if (!goalArchiveAuditConfig) return;
    if (goalArchiveAuditEvents.length >= goalArchiveAuditMaxEvents) {
      goalArchiveAuditCaptureTruncated = true;
      return;
    }
    goalArchiveAuditEvents.push(event);
  };
  const goalArchiveRecordAccepted = (node) => {
    if (!goalArchiveAuditConfig || !node || !node.state) return;
    const exactStateKey = buildStateKey(node.state);
    if (!goalArchiveAuditMatches(exactStateKey)) return;
    if (goalArchiveAuditAccepted.length >= goalArchiveAuditMaxCandidates) {
      goalArchiveAuditCaptureTruncated = true;
      return;
    }
    goalArchiveAuditRelevantNodeIds.add(node.nodeId);
    const materializedState = materializeAuditState(
      node.state,
      node.parentId == null ? null : nodes.get(node.parentId),
      node.actionEntry || node.action,
    );
    goalArchiveAuditAccepted.push({
      ...compactGoalArchiveNode(simulator, node, config, materializedState),
      expansion: expansions,
      elapsedMs: Date.now() - startedAt,
    });
  };
  const statProgressBaseline = {
    hp: number(rootState.hero && rootState.hero.hp, 0),
    atk: number(rootState.hero && rootState.hero.atk, 0),
    def: number(rootState.hero && rootState.hero.def, 0),
    mdef: number(rootState.hero && rootState.hero.mdef, 0),
    exp: number(rootState.hero && rootState.hero.exp, 0),
  };
  const statProgress = {
    maxHeroSeen: { ...statProgressBaseline },
    firstStatGainExpansion: { atk: null, def: null, mdef: null },
    acceptedStatGainStates: { atk: 0, def: 0, mdef: 0 },
    firstStatGainAction: { atk: null, def: null, mdef: null },
  };
  const progressGoal = config.progressGoal || null;
  const progressMinHero = (progressGoal && progressGoal.minHero) || {};
  const progressFields = ["hp", "atk", "def", "mdef", "exp"].filter(
    (field) => Number.isFinite(Number(progressMinHero[field])),
  );
  const progressMeetings = {
    atk: ["atk"],
    def: ["def"],
    mdef: ["mdef"],
    "atk+def": ["atk", "def"],
    "atk+mdef": ["atk", "mdef"],
    "def+mdef": ["def", "mdef"],
    "atk+def+mdef": ["atk", "def", "mdef"],
    fullMinHero: progressFields,
  };
  const acceptedStatesMeeting = Object.fromEntries(
    Object.keys(progressMeetings).map((name) => [name, 0]),
  );
  acceptedStatesMeeting.fullGoal = 0;
  const firstExpansionMeeting = Object.fromEntries(
    Object.keys(acceptedStatesMeeting).map((name) => [name, null]),
  );
  const maxHpAmongStatesMeeting = Object.fromEntries(
    Object.keys(acceptedStatesMeeting).map((name) => [name, null]),
  );
  let bestWitnessMeetingAtkDefMdefNode = null;
  let closestGoalNode = null;
  let closestGoalMetrics = null;
  const statsOf = (state) => {
    const hero = (state && state.hero) || {};
    return {
      hp: number(hero.hp, 0),
      atk: number(hero.atk, 0),
      def: number(hero.def, 0),
      mdef: number(hero.mdef, 0),
      exp: number(hero.exp, 0),
    };
  };
  const recordStatProgress = (state, sourceAction, parentNode, node) => {
    const postStats = statsOf(state);
    Object.keys(statProgress.maxHeroSeen).forEach((field) => {
      if (postStats[field] > statProgress.maxHeroSeen[field]) {
        statProgress.maxHeroSeen[field] = postStats[field];
      }
    });
    ["atk", "def", "mdef"].forEach((field) => {
      if (postStats[field] <= statProgressBaseline[field]) return;
      statProgress.acceptedStatGainStates[field] += 1;
      if (statProgress.firstStatGainExpansion[field] != null) return;
      statProgress.firstStatGainExpansion[field] = expansions;
      statProgress.firstStatGainAction[field] = {
        summary: sourceAction && sourceAction.summary || null,
        kind: sourceAction && sourceAction.kind || null,
        preStats: parentNode ? statsOf(parentNode.state) : null,
        postStats,
      };
    });
    recordGoalProgress(state, node);
  };
  let bestSeenNode = null;
  let bestProgressNode = null;
  const landmarkArchiveLimit = Math.max(0, number(config.landmarkArchiveLimit, 0));
  const landmarkArchiveByKey = new Map();
  let sequence = 0;
  let stoppedReason = null;
  const isGoalState = typeof config.goalPredicate === "function"
    ? config.goalPredicate
    : (state) => simulator.isTerminal(state);

  const routeTailOfNode = (node) => initialRoutePrefix
    .concat(reconstructMaterializedActionEntries(nodes, node))
    .slice(-12)
    .map((entry) => (typeof entry === "string" ? entry : entry && entry.summary))
    .filter(Boolean);
  const exactStateKeyOf = (state) => {
    try {
      return buildStateKey(state);
    } catch (error) {
      return null;
    }
  };
  const witnessOfNode = (node) => {
    if (!node || !node.state) return null;
    const stats = statsOf(node.state);
    return {
      hp: stats.hp,
      atk: stats.atk,
      def: stats.def,
      mdef: stats.mdef,
      exp: stats.exp,
      exactStateKey: exactStateKeyOf(node.state),
      decisionDepth: getDecisionDepth(node.state),
      routeTail: routeTailOfNode(node),
    };
  };
  const meetsProgressFields = (stats, fields) =>
    fields.length > 0 && fields.every(
      (field) => stats[field] >= Number(progressMinHero[field]),
    );
  const goalDistanceOf = (stats) => {
    if (!progressGoal || progressFields.length === 0) return null;
    const deficitVector = {};
    const normalizedDeficitVector = {};
    let missingFieldCount = 0;
    let normalizedTotal = 0;
    progressFields.forEach((field) => {
      const deficit = Math.max(0, Number(progressMinHero[field]) - stats[field]);
      if (deficit > 0) missingFieldCount += 1;
      const normalized = deficit / Math.max(1, Math.abs(Number(progressMinHero[field])));
      deficitVector[field] = deficit;
      normalizedDeficitVector[field] = Number(normalized.toFixed(4));
      normalizedTotal += normalized;
    });
    return {
      missingFieldCount,
      deficitVector,
      normalizedDeficitVector,
      normalizedTotal,
    };
  };
  function recordGoalProgress(state, node) {
    if (!progressGoal || progressFields.length === 0) return;
    const stats = statsOf(state);
    const meetings = Object.fromEntries(
      Object.entries(progressMeetings).map(([name, fields]) => [
        name,
        meetsProgressFields(stats, fields),
      ]),
    );
    meetings.fullGoal = isGoalState(state);
    Object.entries(meetings).forEach(([name, met]) => {
      if (!met) return;
      acceptedStatesMeeting[name] += 1;
      if (firstExpansionMeeting[name] == null) firstExpansionMeeting[name] = expansions;
      if (
        maxHpAmongStatesMeeting[name] == null ||
        stats.hp > maxHpAmongStatesMeeting[name]
      ) {
        maxHpAmongStatesMeeting[name] = stats.hp;
      }
    });
    if (meetings["atk+def+mdef"] &&
        (!bestWitnessMeetingAtkDefMdefNode ||
          stats.hp > statsOf(bestWitnessMeetingAtkDefMdefNode.state).hp ||
          (stats.hp === statsOf(bestWitnessMeetingAtkDefMdefNode.state).hp &&
            compareDpBest(state, bestWitnessMeetingAtkDefMdefNode.state) > 0))) {
      bestWitnessMeetingAtkDefMdefNode = node;
    }
    const distance = goalDistanceOf(stats);
    if (
      distance &&
      (!closestGoalMetrics ||
        distance.missingFieldCount < closestGoalMetrics.missingFieldCount ||
        (distance.missingFieldCount === closestGoalMetrics.missingFieldCount &&
          (distance.normalizedTotal < closestGoalMetrics.normalizedTotal ||
            (distance.normalizedTotal === closestGoalMetrics.normalizedTotal &&
              (stats.hp > closestGoalMetrics.hp ||
                (stats.hp === closestGoalMetrics.hp &&
                  compareDpBest(state, closestGoalNode.state) > 0))))))
    ) {
      closestGoalNode = node;
      closestGoalMetrics = {
        ...distance,
        hp: stats.hp,
      };
    }
  }

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
    // Route-free invariant (compat mode): canonical states must not carry a
    // NON-EMPTY materialized route array.  The search applies with
    // storeRoute:false, so real states keep an empty route field; synthetic
    // tests may carry one and are only counted here for diagnostics.
    if (Array.isArray(state.route) && state.route.length > 0) {
      nonEmptyRouteStateCount += 1;
    }
    const rawLength = getRawRouteLength(state);
    if (rawLength > maxRawRouteLength) maxRawRouteLength = rawLength;
    let key;
    let existingSkyline = null;
    let timingConflict = false;
    let adaptiveTiming = false;
    let dominated = false;

    if (profileExpansion) {
      perfTracker.increment("dpKeyBuildCalls");
      perfTracker.increment("dominanceLookupCalls");
      perfTracker.beginTopLevelPhase("stateKeyAndDominance");
      try {
        key = typeof config.dpStateKeyBuilder === "function"
          ? config.dpStateKeyBuilder(state, config)
          : buildDpStateKey(simulator, state, config);
        existingSkyline = bestByKey instanceof SkylineSet ? bestByKey.getAll(key) : null;
        timingConflict = existingSkyline &&
          config.dominanceConfig &&
          typeof config.dominanceConfig.hasConflict === "function" &&
          existingSkyline.some((candidate) => config.dominanceConfig.hasConflict(state, candidate.state));
        adaptiveTiming = Boolean(
          config.dominanceConfig &&
          typeof config.dominanceConfig.hasConflict === "function",
        );
        const preserveAlternative = existingSkyline &&
          (config.preserveSkylineAlternatives === true || timingConflict === true) &&
          existingSkyline.length < skylineMax;
        dominated = bestByKey instanceof SkylineSet
          ? existingSkyline.length > 0 && !preserveAlternative && (
              adaptiveTiming && timingConflict
                ? existingSkyline.every((n) => !isBetterForSameDpKey(state, n.state, config.dominanceConfig))
                : adaptiveTiming
                  ? !isBetterForSameDpKey(state, existingSkyline[0].state, config.dominanceConfig)
                  : existingSkyline.every((n) => !isBetterForSameDpKey(state, n.state, config.dominanceConfig))
            )
          : !isBetterForSameDpKey(state, bestByKey.get(key) && bestByKey.get(key).state, config.dominanceConfig);
      } finally {
        perfTracker.endTopLevelPhase("stateKeyAndDominance");
      }
      if (dominated) {
        perfTracker.increment("dominanceRejects");
      }
    } else {
      key = trackPerfPhase("buildDpStateKey", () => (
        typeof config.dpStateKeyBuilder === "function"
          ? config.dpStateKeyBuilder(state, config)
          : buildDpStateKey(simulator, state, config)
      ));
      existingSkyline = bestByKey instanceof SkylineSet ? bestByKey.getAll(key) : null;
      timingConflict = existingSkyline &&
        config.dominanceConfig &&
        typeof config.dominanceConfig.hasConflict === "function" &&
        existingSkyline.some((candidate) => config.dominanceConfig.hasConflict(state, candidate.state));
      adaptiveTiming = Boolean(
        config.dominanceConfig &&
        typeof config.dominanceConfig.hasConflict === "function",
      );
      const preserveAlternative = existingSkyline &&
        (config.preserveSkylineAlternatives === true || timingConflict === true) &&
        existingSkyline.length < skylineMax;
      dominated = bestByKey instanceof SkylineSet
        ? existingSkyline.length > 0 && !preserveAlternative && (
            adaptiveTiming && timingConflict
              ? existingSkyline.every((n) => !isBetterForSameDpKey(state, n.state, config.dominanceConfig))
              : adaptiveTiming
                ? !isBetterForSameDpKey(state, existingSkyline[0].state, config.dominanceConfig)
                : existingSkyline.every((n) => !isBetterForSameDpKey(state, n.state, config.dominanceConfig))
          )
        : !isBetterForSameDpKey(state, bestByKey.get(key) && bestByKey.get(key).state, config.dominanceConfig);
    }
    if (candidateKeyShadowRecorder) {
      try {
        const existingForRecorder = bestByKey instanceof SkylineSet ? bestByKey.get(key) : bestByKey.get(key);
        const existingStateForRecorder = existingForRecorder && existingForRecorder.state;
        const hpDiffForRecorder = existingStateForRecorder ? heroHp(state) - heroHp(existingStateForRecorder) : null;
        const productionDecision = dominated
          ? "reject"
          : (!existingStateForRecorder ? "keep-new" : (hpDiffForRecorder > 0 ? "replace" : "keep-same-hp"));
        candidateKeyShadowRecorder({
          state: cloneState(state),
          exactDpKey: key,
          productionDecision,
          // Observation-only transition provenance (never enters keys, pruning
          // or solver behavior): the parent state key, the parent inventory /
          // mutation snapshots and the action that PRODUCED this state.  Used by
          // research hole-closure detectors to prove acquire/consume happened
          // on a REAL parent -> action -> child edge, not on arbitrary state
          // pairs.  Wrapped in try/catch like the rest of the recorder.
          parentStateKey: parentNode && parentNode.state
            ? (() => { try { return buildStateKey(parentNode.state); } catch (error) { return null; } })()
            : null,
          parentInventory: parentNode && parentNode.state && parentNode.state.inventory
            ? JSON.parse(JSON.stringify(parentNode.state.inventory))
            : null,
          parentMutations: parentNode && parentNode.state
            ? (() => { try { return JSON.stringify(listFloorMutationSummary(parentNode.state.floorStates || {})); } catch (error) { return null; } })()
            : null,
          parentFloorId: parentNode && parentNode.state
            ? parentNode.state.floorId || null
            : null,
          parentVisitedFloors: parentNode && parentNode.state
            ? Object.keys(parentNode.state.visitedFloors || {}).sort()
            : null,
          actionKind: sourceAction ? sourceAction.kind : null,
          actionSummary: sourceAction ? (sourceAction.summary || null) : null,
        });
      } catch (error) {
        // Observation must never affect the search.
      }
    }
    if (dominated) {
      trackPerfCount("dominanceRejected");
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
      if (goalArchiveAuditConfig && isGoalState(state)) {
        const exactStateKey = buildStateKey(state);
        if (goalArchiveAuditMatches(exactStateKey)) {
          const materializedState = materializeAuditState(state, parentNode, sourceAction);
          goalArchiveAuditEvent({
            eventType: "goal-candidate-rejected",
            reasonCode: "dominance-rejected",
            candidate: compactGoalArchiveNode(simulator, {
              nodeId: null,
              parentId: parentNode && parentNode.nodeId,
              key,
              state,
              action: sourceAction,
            }, config, materializedState),
            witness: existingState ? compactGoalArchiveNode(simulator, existing, config) : null,
            comparison: existingState ? describeGoalArchiveComparison(state, existingState) : null,
            archiveSizeAtEvent: goalNodes.length,
            goalArchiveCapacity: Number(config.goalSkylineLimit || 0),
            dpSkylineCapacity: skylineMax,
          });
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
    if (profileExpansion) {
      perfTracker.increment("frontierRankCalls");
      perfTracker.beginTopLevelPhase("frontierQueue");
      try {
        node.rank = config.dpPriorityMode === "goal-directed"
          ? buildGoalDirectedDpAgendaRank(simulator, state, sourceAction, sequence, config)
          : buildDpAgendaRank(simulator, state, sourceAction, sequence, config);
      } finally {
        perfTracker.endTopLevelPhase("frontierQueue");
      }
    } else {
      node.rank = config.dpPriorityMode === "goal-directed"
        ? buildGoalDirectedDpAgendaRank(simulator, state, sourceAction, sequence, config)
        : buildDpAgendaRank(simulator, state, sourceAction, sequence, config);
    }
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
      trackPerfCount("skylineCapacityRejected");
      if (observer) {
        observer.emit("candidateRejected", () => observerStatePayload(simulator, state, { key }, config, {
          reasonCode: "skyline-capacity-rejected",
          key,
          action: compactObserverAction(simulator, sourceAction),
          candidateId: sourceAction && sourceAction.__observerCandidateId || null,
          successorId: sourceAction && sourceAction.__observerSuccessorId || null,
        }));
      }
      if (goalArchiveAuditConfig && isGoalState(state)) {
        const exactStateKey = buildStateKey(state);
        if (goalArchiveAuditMatches(exactStateKey)) {
          const materializedState = materializeAuditState(state, parentNode, sourceAction);
          goalArchiveAuditEvent({
            eventType: "goal-candidate-rejected",
            reasonCode: "skyline-capacity-rejected",
            candidate: compactGoalArchiveNode(simulator, {
              nodeId: null,
              parentId: parentNode && parentNode.nodeId,
              key,
              state,
              action: sourceAction,
            }, config, materializedState),
            witness: null,
            comparison: null,
            archiveSizeAtEvent: goalNodes.length,
            goalArchiveCapacity: Number(config.goalSkylineLimit || 0),
            dpSkylineCapacity: skylineMax,
          });
        }
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
    const evictedSkylineIds = beforeSkylineIds
      .filter((nodeId) => !afterSkylineIds.includes(nodeId));
    evictedSkylineIds.forEach((nodeId) => {
      const evictedNode = nodes.get(nodeId);
      if (goalArchiveAuditConfig && evictedNode && evictedNode.state && isGoalState(evictedNode.state)) {
        const evictedExactStateKey = buildStateKey(evictedNode.state);
        if (goalArchiveAuditMatches(evictedExactStateKey)) {
          goalArchiveAuditRelevantNodeIds.add(node.nodeId);
          goalArchiveAuditEvent({
            eventType: "goal-archive-evicted",
            reasonCode: "skyline-replaced",
            evicted: compactGoalArchiveNode(
              simulator,
              evictedNode,
              config,
              materializeAuditState(
                evictedNode.state,
                evictedNode.parentId == null ? null : nodes.get(evictedNode.parentId),
                evictedNode.actionEntry,
              ),
            ),
            replacement: compactGoalArchiveNode(
              simulator,
              node,
              config,
              materializeAuditState(state, parentNode, actionForEntry),
            ),
            comparison: describeGoalArchiveComparison(evictedNode.state, node.state),
            archiveSizeAtEvent: goalNodes.length,
            goalArchiveCapacity: Number(config.goalSkylineLimit || 0),
            dpSkylineCapacity: skylineMax,
          });
        }
      }
    });
    if (observer) {
      evictedSkylineIds.forEach((nodeId) => {
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
    if (profileExpansion) {
      perfTracker.increment("frontierPushCalls");
      perfTracker.beginTopLevelPhase("frontierQueue");
    }
    if (heap) heap.push(node);
    else fifoEntries.push(node);
    if (fairEntries) {
      fairEntries.push(node);
      fairEnqueueExpansions.set(node.nodeId, expansions);
    }
    if (profileExpansion) {
      perfTracker.endTopLevelPhase("frontierQueue");
    }
    registered += 1;
    trackPerfCount("registered");
    recordStatProgress(state, actionForEntry, parentNode, node);
    if (!bestSeenNode || compareDpBest(state, bestSeenNode.state) > 0) bestSeenNode = node;
    const progressDiff = bestProgressNode ? compareProgress(state, bestProgressNode.state) : 1;
    if (!bestProgressNode || progressDiff > 0 || (progressDiff === 0 && compareDpBest(state, bestProgressNode.state) > 0)) {
      bestProgressNode = node;
    }
    if (isGoalState(state)) {
      if (!firstGoalNode) {
        firstGoalNode = node;
        firstGoalExpansion = expansions;
        firstGoalElapsedMs = Date.now() - startedAt;
      }
      goalNodes.push(node);
      goalArchiveRecordAccepted(node);
      const improvedGoal = !bestGoalNode || goalStateComparator(state, bestGoalNode.state) > 0;
      if (improvedGoal) bestGoalNode = node;
      if (observer && improvedGoal) {
        observer.emit("goalCandidateImproved", () => observerStatePayload(simulator, state, node, config, {
          reasonCode: "goal-candidate-improved",
          ...(typeof config.objectiveProjector === "function"
            ? config.objectiveProjector(state)
            : {}),
        }));
      }
      if (observer) {
        emitStateEvent("goalAccepted", state, node, () => ({
          reasonCode: "goal-predicate-accepted",
          action: compactObserverAction(simulator, sourceAction),
        }));
      }
    }
    return node;
  };

  const enqueueCandidate = typeof config.stateFeasibilityPredicate !== "function"
    ? enqueue
    : (state, sourceAction, parentNode) => {
        let verdict = null;
        try {
          verdict = config.stateFeasibilityPredicate(
            state,
            sourceAction,
            parentNode && parentNode.state,
          );
        } catch (error) {
          verdict = { feasible: true, diagnosticError: error && error.message || String(error) };
        }
        if (verdict !== false && (!verdict || verdict.feasible !== false)) {
          return enqueue(state, sourceAction, parentNode);
        }
        const reason = verdict && verdict.reason || "goal-necessary-condition-failed";
        goalFeasibilityPruned += 1;
        goalFeasibilityPrunedByReason[reason] = Number(goalFeasibilityPrunedByReason[reason] || 0) + 1;
        if (goalFeasibilitySamples.length < 8) {
          goalFeasibilitySamples.push(jsonDiagnosticValue({
            reason,
            current: verdict && verdict.current,
            target: verdict && verdict.target,
            bound: verdict && verdict.bound,
            witness: verdict && verdict.witness,
          }));
        }
        trackPerfCount("goalFeasibilityPruned");
        if (observer) observer.emit("candidateRejected", () => observerStatePayload(
          simulator,
          state,
          { nodeId: null, key: null },
          config,
          {
            reasonCode: "goal-necessary-condition-failed",
            feasibilityReason: reason,
            action: compactObserverAction(simulator, sourceAction),
          },
        ));
        return false;
      };

  enqueueCandidate(rootState);

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
  const memoryCheckIntervalActions = Math.max(
    1,
    Math.floor(number(config.memoryCheckIntervalActions, 1)),
  );
  const memoryLimitsEnabled = maxHeapMb > 0 || maxRssMb > 0;
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
    if (!memoryLimitsEnabled) return false;
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
    if (shouldStop()) {
      stoppedReason = "cancel-requested";
      break;
    }
    if (stopForMemoryIfNeeded("before-expansion", expansions, expansions + 1, expansions === 0)) break;
    if (stopOnFirstGoal && firstGoalNode) break;
    if (
      !stopOnFirstGoal &&
      firstGoalNode &&
      maxExpansionsAfterFirstGoal != null &&
      expansions >= number(firstGoalExpansion, expansions) + maxExpansionsAfterFirstGoal
    ) {
      stoppedReason = "goal-collection-limit";
      break;
    }
    let selected;
    if (profileExpansion) {
      perfTracker.beginTopLevelPhase("frontierQueue");
      selected = popNext();
      perfTracker.endTopLevelPhase("frontierQueue");
      if (selected) perfTracker.increment("frontierPopCalls");
    } else {
      selected = popNext();
    }
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

    const frontierBefore = heap ? heap.length : Math.max(0, fifoEntries.length - cursor);
    if (profileExpansion) {
      const simStats = simulator.getActionExpansionCacheStats ? simulator.getActionExpansionCacheStats() : {};
      const reachableNodes = simStats.reachability ? simStats.reachability.nodesExpanded : 0;
      const battleMisses = simStats.battleResolver && simStats.battleResolver.battleEstimate
        ? simStats.battleResolver.battleEstimate.misses
        : 0;
      perfTracker.beginExpansion(expansions + 1, state, frontierBefore, {
        reachableNodes,
        battleEstimateMisses: battleMisses,
      });
    }

    expansions += 1;
    const expandedNode = nodes.get(entry.nodeId);
    if (!deepestExpandedNode || number(expandedNode && expandedNode.depth, 0) > number(deepestExpandedNode.depth, 0)) {
      deepestExpandedNode = expandedNode || entry;
    }
    trackPerfCount("expanded");
    if (profileExpansion) {
      perfTracker.increment("expansions");
    }
    if (shadowCheckState) {
      try {
        shadowCheckState(state);
      } catch (error) {
        // Observation must never affect the search.
      }
    }
    if (captureEnabled && capturedExpandedStates.length < captureLimit) {
      const captureKey = getDecisionDepth(state) + ":" + getRawRouteLength(state) + ":" + buildStateKey(state);
      if (!capturedStateKeys.has(captureKey)) {
        capturedStateKeys.add(captureKey);
        capturedExpandedStates.push(state);
      }
    }
    if (perfActive) {
      // Node depth (from search-nodes) is authoritative here: the segment-DP
      // states do not carry meta.decisionDepth (the DP tracks depth on nodes).
      const entryNode = expandedNode;
      const nodeDepth = entryNode && typeof entryNode.depth === "number"
        ? entryNode.depth
        : getDecisionDepth(state);
      depthSum += nodeDepth;
      if (nodeDepth > depthMax) depthMax = nodeDepth;
      // Synchronous in-search memory sampling: process.memoryUsage() cannot run
      // on the event loop during the search, so sample here at intervals.
      if (expansions % 32 === 0) {
        perfTracker.recordMemorySample(process.memoryUsage());
      }
    }
    let actions = [];
    if (profileExpansion) {
      perfTracker.increment("primitiveEnumerationCalls");
      perfTracker.beginTopLevelPhase("primitiveEnumeration");
      try {
        actions = typeof config.actionProvider === "function"
          ? config.actionProvider(simulator, state, entry)
          : simulator.enumeratePrimitiveActions(state).actions;
      } catch (error) {
        perfTracker.endTopLevelPhase("primitiveEnumeration");
        invalid += 1;
        if (observer) observer.emit("actionProviderError", () => observerStatePayload(simulator, state, entry, config, {
          reasonCode: "action-provider-error",
          error: { name: error && error.name || "Error", message: error && error.message || String(error) },
        }));
        if (stopForMemoryIfNeeded("after-action-provider", expansions, expansionOrdinal)) break;
        continue;
      }
      perfTracker.endTopLevelPhase("primitiveEnumeration");
    } else {
      try {
        actions = typeof config.actionProvider === "function"
          ? config.actionProvider(simulator, state, entry)
          : (perfActive
              ? trackPerfPhase("enumerateActions", () => simulator.enumeratePrimitiveActions(state)).actions
              : simulator.enumeratePrimitiveActions(state).actions);
      } catch (error) {
        invalid += 1;
        if (observer) observer.emit("actionProviderError", () => observerStatePayload(simulator, state, entry, config, {
          reasonCode: "action-provider-error",
          error: { name: error && error.name || "Error", message: error && error.message || String(error) },
        }));
        if (stopForMemoryIfNeeded("after-action-provider", expansions, expansionOrdinal)) break;
        continue;
      }
    }
    if (typeof config.actionFilter === "function") {
      actions = actions.filter((action) => config.actionFilter(action, state));
    }
    if (stopForMemoryIfNeeded("after-action-provider", expansions, expansionOrdinal)) break;
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
    let sortedActions;
    if (profileExpansion) {
      perfTracker.beginTopLevelPhase("actionEvaluation");
      sortedActions = sortDpActions(actions);
      perfTracker.endTopLevelPhase("actionEvaluation");
    } else if (perfActive) {
      sortedActions = trackPerfPhase("sortActions", () => sortDpActions(actions));
    } else {
      sortedActions = sortDpActions(actions);
    }
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
        trackPerfCount("generated");
        if (profileExpansion) perfTracker.increment("generated");
        recordAction(actionStats, action, "expanded");
        const candidateId = `${entry.nodeId}:${actionIndex}`;
        if (observer) observer.emit("candidateGenerated", () => observerStatePayload(simulator, state, entry, config, {
          reasonCode: "candidate-generated",
          candidateId,
          action: compactObserverAction(simulator, action),
        }));
        let nextStates;
        if (profileExpansion) {
          perfTracker.increment("applyActionCalls");
          perfTracker.beginTopLevelPhase("applyAction");
          try {
            const applier = typeof config.actionApplier === "function"
              ? config.actionApplier
              : (s, a) => simulator.applyAction(s, a, { storeRoute: false });
            const result = applier(state, action);
            nextStates = Array.isArray(result) ? result : [result];
          } catch (error) {
            perfTracker.endTopLevelPhase("applyAction");
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
          perfTracker.endTopLevelPhase("applyAction");
        } else {
          try {
            const applier = typeof config.actionApplier === "function"
              ? config.actionApplier
              : (perfActive
                  ? (s, a) => trackPerfPhase("applyAction", () => simulator.applyAction(s, a, { storeRoute: false }))
                  : (s, a) => simulator.applyAction(s, a, { storeRoute: false }));
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
          const childNode = enqueueCandidate(nextState, observedAction, entry);
          if (childNode) recordAction(actionStats, action, "kept");
          else recordAction(actionStats, action, "dominated");
        });
        const actionOrdinal = actionIndex + 1;
        if (
          memoryLimitsEnabled &&
          actionOrdinal % memoryCheckIntervalActions === 0 &&
          stopForMemoryIfNeeded(
            "after-successor-enqueue",
            expansions,
            expansionOrdinal,
            true,
          )
        ) {
          stopAfterSuccessorBatch = true;
        }
      });

    if (profileExpansion) {
      const simStats = simulator.getActionExpansionCacheStats ? simulator.getActionExpansionCacheStats() : {};
      const endReachableNodes = simStats.reachability ? simStats.reachability.nodesExpanded : 0;
      const endBattleMisses = simStats.battleResolver && simStats.battleResolver.battleEstimate
        ? simStats.battleResolver.battleEstimate.misses
        : 0;
      perfTracker.endExpansion(expansions, state, heap ? heap.length : Math.max(0, fifoEntries.length - cursor), {
        actionsGenerated: actions.length,
        reachableNodes: endReachableNodes,
        battleEstimateMisses: endBattleMisses,
        decisionDepth: expandedNode && typeof expandedNode.depth === "number" ? expandedNode.depth : getDecisionDepth(state),
      });
    }

    if (stopAfterSuccessorBatch) break;
    if (!memoryLimitsEnabled) {
      recordMemoryUsage("after-expansion", expansions, false);
    }
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
            memoryCheckIntervalActions,
            memoryLimitsEnabled,
            memory: {
              maxHeapMb,
              maxRssMb,
              memoryCheckIntervalExpansions,
              memoryCheckIntervalActions,
              memoryLimitsEnabled,
              successorCheckGranularity: "action-batch",
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
  const activeGoalNodes = goalNodes.filter((node) => {
    if (!isGoalState(node.state)) return false;
    if (config.preserveGoalArchive === true) return true;
    if (bestByKey instanceof SkylineSet) {
      return bestByKey.isActive(node.key, node.nodeId);
    }
    const active = bestByKey.get(node.key);
    return Boolean(active && active.nodeId === node.nodeId);
  });
  // Route materialization returns a DETACHED clone: the canonical node.state in
  // the nodes Map must never gain a materialized route array.  The parent
  // pointer chain + each node's actionEntry/state _routePatch remain the only
  // reconstruction source.  state.route.length is the materialized
  // decision/replay-entry
  // count; meta.rawRouteLength is the decision+auto cumulative step count and
  // must NOT be overwritten by the shorter materialized route length.
  const attachRouteToNodeState = (node) => {
    if (!node || !node.state) return null;
    const canonicalRawRouteLength = getRawRouteLength(node.state);
    const materialized = cloneState(node.state);
    materialized.route = initialRoutePrefix.concat(reconstructMaterializedActionEntries(nodes, node));
    if (captureTrace) {
      materialized.routeTrace = initialRouteTracePrefix.concat(reconstructActionTrace(nodes, node));
    } else if (Object.prototype.hasOwnProperty.call(materialized, "routeTrace")) {
      delete materialized.routeTrace;
    }
    materialized.meta.rawRouteLength = canonicalRawRouteLength;
    return materialized;
  };
  const goalSkylineNodes = selectGoalSkylineNodes(activeGoalNodes, {
    ...config,
    // Terminal ordering must compare detached materialized clones so
    // route-length objectives see the real materialized entry count; the
    // canonical node states stay route-free.
    stateForNode: (node) => {
      if (!node) return null;
      const materialized = attachRouteToNodeState(node);
      return materialized || node.state;
    },
  });
  // Re-derive bestGoalNode from the route-attached, objective-ordered archive.
  // bestGoalNode was captured at enqueue time when state.route was still empty
  // (production applyAction uses storeRoute:false), so route-length-sensitive
  // objectives could have selected the wrong winner.  The top of the ordered
  // archive is the objective winner; fall back to the enqueue-time node only if
  // no active goal state survived.
  if (goalSkylineNodes.length > 0) bestGoalNode = goalSkylineNodes[0];
  const goalArchiveLimit = Math.max(1, Number(config.goalSkylineLimit || 8));
  const goalArchiveObjectiveAware = typeof config.goalStateComparator === "function";
  const goalArchiveTrimmed = activeGoalNodes.length > goalArchiveLimit ||
    goalSkylineNodes.length < activeGoalNodes.length;
  const goalArchiveEvictedCount = Math.max(0, goalNodes.length - activeGoalNodes.length);
  const goalArchiveAudit = buildGoalArchiveAudit({
    simulator,
    config,
    goalNodes,
    activeGoalNodes,
    selectedGoalNodes: goalSkylineNodes,
    accepted: goalArchiveAuditAccepted,
    events: goalArchiveAuditEvents,
    captureTruncated: goalArchiveAuditCaptureTruncated,
  });

  const firstGoalState = attachRouteToNodeState(firstGoalNode);
  const bestGoalState = attachRouteToNodeState(bestGoalNode);
  const goalSkylineStates = goalSkylineNodes
    .map((node) => attachRouteToNodeState(node))
    .filter(Boolean);
  const bestSeenState = attachRouteToNodeState(bestSeenNode);
  const bestProgressState = attachRouteToNodeState(bestProgressNode);
  const deepestExpandedState = attachRouteToNodeState(deepestExpandedNode);
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
  const searchOutcome = buildSearchOutcome({
    goalFound: Boolean(bestGoalState),
    frontierSize,
    expansionBudgetExhausted,
    stoppedReason,
    cancelled: stoppedReason === "cancel-requested",
    actionTrimmed,
    stopOnFirstGoal,
  });

  return {
    foundGoal: Boolean(bestGoalState),
    goalState: bestGoalState,
    firstGoalState,
    bestGoalState,
    goalSkylineStates,
    goalArchiveAudit,
    bestSeenState,
    bestProgressState,
    deepestExpandedState,
    landmarkArchive,
    fallbackState: null,
    route: bestGoalState ? bestGoalState.route : null,
    fallbackRoute: null,
    expansions,
    frontierSize,
    stoppedReason,
    cancelled: stoppedReason === "cancel-requested",
    searchOutcome,
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
        "goal-necessary-condition-failed": goalFeasibilityPruned,
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
      depth: {
        avgDecisionDepth: expansions > 0 ? depthSum / expansions : 0,
        maxDecisionDepth: depthMax,
      },
      routeFree: {
        nonEmptyRouteStateCount,
        maxRawRouteLength,
      },
      capturedExpandedStates: captureEnabled ? capturedExpandedStates.slice() : [],
      registry: (() => {
        let finalUniqueKeys = 0;
        let finalActiveStates = 0;
        if (bestByKey instanceof SkylineSet) {
          finalUniqueKeys = bestByKey.map.size;
          bestByKey.map.forEach((entries) => { finalActiveStates += entries.length; });
        } else {
          finalUniqueKeys = bestByKey.size;
          finalActiveStates = bestByKey.size;
        }
        return { finalUniqueKeys, finalActiveStates };
      })(),
      pruneReasons: {
        "dp-lower-hp-same-state": rejectedByHigherHp,
        "dp-same-hp-not-shorter": sameHpRejected,
        "goal-necessary-condition-failed": goalFeasibilityPruned,
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
        cancelled: stoppedReason === "cancel-requested",
        maxRuntimeMs,
        maxHeapMb,
        maxRssMb,
        memoryCheckIntervalExpansions,
        memoryCheckIntervalActions,
        memoryLimitsEnabled,
        wallMs: Date.now() - startedAt,
        heapUsedMb: Number(maxHeapUsedMb.toFixed(1)),
        rssMb: Number(peakRssMb.toFixed(1)),
        memory: {
          maxHeapMb,
          maxRssMb,
          memoryCheckIntervalExpansions,
          memoryCheckIntervalActions,
          memoryLimitsEnabled,
          successorCheckGranularity: "action-batch",
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
        searchOutcome,
        goalFound: searchOutcome.goalFound,
        frontierExhausted: searchOutcome.frontierExhausted,
        budgetExhausted: searchOutcome.budgetExhausted,
        searchComplete: searchOutcome.searchComplete,
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
        goalFeasibility: {
          enabled: typeof config.stateFeasibilityPredicate === "function",
          pruned: goalFeasibilityPruned,
          byReason: { ...goalFeasibilityPrunedByReason },
          samples: goalFeasibilitySamples.slice(),
        },
        agendaMode,
        fairnessEvery,
        stopOnFirstGoal,
        continueAfterGoal,
        keyMode: String(config.dpKeyMode || config.keyMode || "location"),
        targetFloorOrder: getFloorOrder(config.targetFloorId || simulator.stopFloorId),
        foundFirstGoal: Boolean(firstGoalState),
        firstGoalExpansion,
        firstGoalElapsedMs,
        statProgress: {
          maxHeroSeen: { ...statProgress.maxHeroSeen },
          firstStatGainExpansion: { ...statProgress.firstStatGainExpansion },
          acceptedStatGainStates: { ...statProgress.acceptedStatGainStates },
          firstStatGainAction: { ...statProgress.firstStatGainAction },
          acceptedStatesMeeting: { ...acceptedStatesMeeting },
          firstExpansionMeeting: { ...firstExpansionMeeting },
          maxHpAmongStatesMeeting: { ...maxHpAmongStatesMeeting },
          bestWitnessMeetingAtkDefMdef: witnessOfNode(
            bestWitnessMeetingAtkDefMdefNode,
          ),
          closestGoalState: closestGoalNode
            ? {
                missingFieldCount: closestGoalMetrics.missingFieldCount,
                deficitVector: { ...closestGoalMetrics.deficitVector },
                normalizedDeficitVector: {
                  ...closestGoalMetrics.normalizedDeficitVector,
                },
                hp: closestGoalMetrics.hp,
                exactStateKey: exactStateKeyOf(closestGoalNode.state),
                decisionDepth: getDecisionDepth(closestGoalNode.state),
                routeTail: routeTailOfNode(closestGoalNode),
              }
            : null,
        },
        foundBestGoal: Boolean(bestGoalState),
        goalSkylineLimit: Math.max(1, Number(config.goalSkylineLimit || 8)),
        goalSkylineCount: goalSkylineStates.length,
        goalArchiveObjectiveAware,
        goalArchiveTrimmed,
        goalArchiveEvictedCount,
        activeGoalCount: activeGoalNodes.length,
        goalNodeCount: goalNodes.length,
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
  compareGoalStates,
  routeLengthOfState,
  searchDP,
};
