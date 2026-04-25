"use strict";

const path = require("node:path");

const { getDecisionDepth } = require("./state");
const { compareProgress, getProgress } = require("./progress");
const { BinaryHeap } = require("./priority-queue");
const { createPerfTracker, setActivePerfTracker } = require("./perf");
const { attachRouteToState, createChildNode, createRootNode, reconstructRoute } = require("./search-nodes");
const { getDominanceKey, getScore, getStateKey } = require("./search-cache");
const { createCheckpointPool, hydrateCheckpointPool, recordFloorEntryCheckpoint, summarizeCheckpointPool } = require("./floor-checkpoints");
const { WorkerPool } = require("./worker-pool");
const { chunk, serializeNodeForWorker, stableMergeResults } = require("./parallel-expander");

function nowMs() {
  const [seconds, nanoseconds] = process.hrtime();
  return seconds * 1000 + nanoseconds / 1e6;
}

function actionType(action) {
  if (!action) return "unknown";
  if (action.kind === "changeFloor") return "changeFloor";
  if (action.kind === "useTool" && action.tool === "centerFly") return "centerFly";
  if (action.kind === "openDoor") return "door";
  if (action.kind === "battle") return "monster";
  if (action.kind === "fightToLevelUp") return "fightToLevelUp";
  if (action.kind === "resourcePocket") return "resourcePocket";
  if (action.kind === "event") return action.unsupported ? "unsupportedEvent" : "event";
  if (action.kind === "pickup") return "item";
  if (action.kind === "useTool") return "tool";
  return action.kind || "misc";
}

function actionRole(action) {
  if (!action) return "unknown";
  if (isProgressAction(action)) return "progress";
  if (action.kind === "pickup") return "resource";
  if (action.kind === "resourcePocket") return "resource";
  if (action.kind === "battle" && Number((action.estimate || {}).exp || 0) > 0) return "exp";
  if (action.kind === "fightToLevelUp") return "exp";
  if (action.kind === "battle") return "fight";
  if (action.kind === "openDoor") return "unlock";
  if (action.kind === "event") return action.unsupported ? "unsupported" : "event";
  if (action.kind === "useTool") return "tool";
  return action.kind || "misc";
}

function isProgressAction(action) {
  return actionType(action) === "changeFloor" || actionType(action) === "centerFly";
}

function ensureActionStats(stats, type) {
  if (!stats) return null;
  if (!stats.byActionType[type]) {
    stats.byActionType[type] = { generated: 0, kept: 0, trimmed: 0, dominated: 0, expanded: 0, invalid: 0, beamDropped: 0 };
  }
  return stats.byActionType[type];
}

function recordActionStat(stats, action, field) {
  const bucket = ensureActionStats(stats, actionType(action));
  if (!bucket) return;
  bucket[field] = Number(bucket[field] || 0) + 1;
  if (!stats.byActionRole) return;
  const role = actionRole(action);
  if (!stats.byActionRole[role]) {
    stats.byActionRole[role] = { generated: 0, kept: 0, trimmed: 0, dominated: 0, expanded: 0, invalid: 0, beamDropped: 0 };
  }
  stats.byActionRole[role][field] = Number(stats.byActionRole[role][field] || 0) + 1;
}

function compareFrontierStates(simulator, options, left, right) {
  if (options && typeof options.compareFrontierStates === "function") {
    return options.compareFrontierStates(left, right);
  }
  return simulator.compareSearchStates(left, right);
}

function getFrontierBucketKey(simulator, options, state) {
  if (options && typeof options.getFrontierBucketKey === "function") {
    return options.getFrontierBucketKey(state);
  }
  if (typeof simulator.getFrontierBucketKey === "function") {
    return simulator.getFrontierBucketKey(state);
  }
  return state.floorId || "";
}


function compactAction(action) {
  if (!action) return null;
  const compact = {
    type: actionType(action),
    kind: action.kind,
  };
  if (action.x != null && action.y != null) {
    compact.x = action.x;
    compact.y = action.y;
  }
  if (action.target) compact.target = action.target;
  if (action.changeFloor) compact.changeFloor = action.changeFloor;
  if (action.tool) compact.tool = action.tool;
  if (action.id) compact.id = action.id;
  if (action.eventId) compact.eventId = action.eventId;
  if (action.estimate) {
    compact.estimate = {
      damage: action.estimate.damage,
      exp: action.estimate.exp,
      money: action.estimate.money,
      score: action.estimate.score,
      stopReasons: action.estimate.stopReasons,
    };
  }
  return compact;
}

function compactState(state) {
  if (!state) return null;
  const hero = state.hero || {};
  const progress = getProgress(state);
  return {
    floorId: state.floorId,
    x: state.heroLoc && state.heroLoc.x,
    y: state.heroLoc && state.heroLoc.y,
    hp: hero.hp,
    atk: hero.atk,
    def: hero.def,
    mdef: hero.mdef,
    lv: hero.lv,
    exp: hero.exp,
    money: hero.money,
    routeLength: Array.isArray(state.route) ? state.route.length : 0,
    stageIndex: progress.stageIndex,
    bestFloorRank: progress.bestFloorRank,
  };
}

function pushLimitedSample(list, sample, limit) {
  if (!Array.isArray(list)) return;
  const max = limit || 20;
  if (list.length < max) list.push(sample);
}

function recordDroppedActionSample(stats, reason, state, action) {
  if (!stats || !action) return;
  const type = actionType(action);
  const progressLike = isProgressAction(action) || type === "changeFloor";
  if (!progressLike) return;
  stats.droppedProgressActions.total += 1;
  stats.droppedProgressActions.byReason[reason] = Number(stats.droppedProgressActions.byReason[reason] || 0) + 1;
  pushLimitedSample(stats.droppedProgressActions.samples, {
    reason,
    state: compactState(state),
    action: compactAction(action),
  }, stats.sampleLimit);
}

function resolveStateActionOptions(options, state) {
  const resolved = { ...(options || {}) };
  if (options && typeof options.getMaxActionsPerState === "function") {
    const maxActions = options.getMaxActionsPerState(state, options);
    if (maxActions != null) resolved.maxActionsPerState = maxActions;
  }
  if (options && typeof options.getActionQuotasForState === "function") {
    Object.assign(resolved, options.getActionQuotasForState(state, resolved) || {});
  }
  return resolved;
}

function getStateActions(simulator, options, state) {
  const actionOptions = resolveStateActionOptions(options, state);
  const startedAt = nowMs();
  const tracker = options && options.__perfTracker;
  const allActions = tracker && tracker.enabled
    ? tracker.timePhase("enumerateActions", () => simulator.enumerateActions(state))
    : simulator.enumerateActions(state);
  if (options && options.__stats) options.__stats.perf.timeInGenerateActionsMs += nowMs() - startedAt;
  let actions = allActions;
  if (actionOptions && typeof actionOptions.sortStateActions === "function") {
    const sortActions = () => actionOptions.sortStateActions(state, actions.slice());
    actions = tracker && tracker.enabled ? tracker.timePhase("sortActions", sortActions) : sortActions();
  }
  if (options && options.__stats) {
    actions.forEach((action) => recordActionStat(options.__stats, action, "generated"));
  }
  if (actionOptions && typeof actionOptions.selectStateActions === "function") {
    const selectActions = () => actionOptions.selectStateActions(state, actions.slice(), actionOptions);
    actions = tracker && tracker.enabled ? tracker.timePhase("sortActions", selectActions) : selectActions();
  } else if (actionOptions && actionOptions.maxActionsPerState != null) {
    const maxActions = Number(actionOptions.maxActionsPerState);
    if (actionOptions.reserveProgressActions) {
      actions = selectActionsByQuota(actions, {
        maxActions,
        progressActionQuota: actionOptions.progressActionQuota,
        unlockActionQuota: actionOptions.unlockActionQuota,
        itemActionQuota: actionOptions.itemActionQuota,
        resourceActionQuota: actionOptions.resourceActionQuota,
        expActionQuota: actionOptions.expActionQuota,
        fightActionQuota: actionOptions.fightActionQuota,
        shopActionQuota: actionOptions.shopActionQuota,
      });
    } else {
      actions = actions.slice(0, maxActions);
    }
  }
  if (options && options.__stats) {
    const kept = new Set(actions);
    actions.forEach((action) => recordActionStat(options.__stats, action, "kept"));
    allActions.forEach((action) => {
      if (kept.has(action)) return;
      recordActionStat(options.__stats, action, "trimmed");
      recordFloor(options.__stats, state, "trimmed");
      if (isProgressAction(action)) {
        options.__stats.suspicious.progressActionTrimmed += 1;
        recordDroppedActionSample(options.__stats, "actionTrimmed", state, action);
      }
    });
  }
  return actions;
}

function takeQuota(actions, predicate, quota, kept, selected) {
  if (!quota || quota <= 0) return;
  actions.forEach((action) => {
    if (selected.length >= quota) return;
    if (kept.has(action) || !predicate(action)) return;
    kept.add(action);
    selected.push(action);
  });
}

function selectActionsByQuota(actions, options) {
  const maxActions = Number(options.maxActions || actions.length);
  if (!Number.isFinite(maxActions) || maxActions <= 0 || actions.length <= maxActions) return actions;
  const kept = new Set();
  const selected = [];
  takeQuota(actions, isProgressAction, options.progressActionQuota || 8, kept, selected);
  takeQuota(actions, (action) => action.kind === "fightToLevelUp" || actionRole(action) === "exp", options.expActionQuota || 6, kept, selected);
  takeQuota(actions, (action) => action.kind === "resourcePocket" || actionRole(action) === "resource", options.resourceActionQuota || 8, kept, selected);
  takeQuota(actions, (action) => actionType(action) === "door", options.unlockActionQuota || 6, kept, selected);
  takeQuota(actions, (action) => actionType(action) === "item", options.itemActionQuota || 6, kept, selected);
  takeQuota(actions, (action) => actionType(action) === "monster", options.fightActionQuota || 6, kept, selected);
  takeQuota(actions, (action) => actionType(action) === "shop", options.shopActionQuota || 3, kept, selected);
  actions.forEach((action) => {
    if (selected.length >= maxActions) return;
    if (kept.has(action)) return;
    kept.add(action);
    selected.push(action);
  });
  return selected.slice(0, maxActions);
}

function createRank(simulator, state, score) {
  const decisionDepth = getDecisionDepth(state);
  return {
    score: score || getScore(simulator, state),
    decisionDepth,
    routeLength: Array.isArray(state.route) && state.route.length > 0 ? state.route.length : decisionDepth,
  };
}

function recordSkip(stats, reason) {
  if (!stats) return;
  stats.skipped[reason] = Number(stats.skipped[reason] || 0) + 1;
  stats.pruneReasons[reason] = Number(stats.pruneReasons[reason] || 0) + 1;
}

function recordFloor(stats, state, field, amount) {
  if (!stats || !state) return;
  const floorId = state.floorId || "unknown";
  if (!stats.byFloor[floorId]) {
    stats.byFloor[floorId] = { expanded: 0, generated: 0, kept: 0, trimmed: 0, dominated: 0, beamDropped: 0 };
  }
  stats.byFloor[floorId][field] = Number(stats.byFloor[floorId][field] || 0) + Number(amount || 1);
}

function recordStage(stats, state, field, amount) {
  if (!stats || !state) return;
  const stage = String(getProgress(state).stageIndex || 0);
  if (!stats.byStage[stage]) {
    stats.byStage[stage] = { expanded: 0, reachedGoalCandidates: 0, keptGoalCandidates: 0 };
  }
  stats.byStage[stage][field] = Number(stats.byStage[stage][field] || 0) + Number(amount || 1);
}

function sortFrontier(simulator, frontier, options) {
  const tracker = options && options.__perfTracker;
  const run = () => frontier.sort((left, right) => compareFrontierStates(simulator, options, right, left));
  if (tracker && tracker.enabled) return tracker.timePhase("sortFrontier", run);
  return run();
}

function trimFrontierPerFloor(simulator, frontier, perFloorBeamWidth, options) {
  if (!perFloorBeamWidth || frontier.length <= perFloorBeamWidth) return frontier;
  const grouped = new Map();
  frontier.forEach((state) => {
    const floorId = state.floorId || "";
    if (!grouped.has(floorId)) grouped.set(floorId, []);
    grouped.get(floorId).push(state);
  });

  const trimmed = [];
  grouped.forEach((states) => {
    sortFrontier(simulator, states, options);
    trimmed.push(...states.slice(0, perFloorBeamWidth));
  });
  return trimmed;
}

function trimFrontierPerRegion(simulator, frontier, perRegionBeamWidth, options) {
  if (!perRegionBeamWidth || frontier.length <= perRegionBeamWidth) return frontier;
  const grouped = new Map();
  frontier.forEach((state) => {
    const key = getFrontierBucketKey(simulator, options, state);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(state);
  });

  const trimmed = [];
  grouped.forEach((states) => {
    sortFrontier(simulator, states, options);
    trimmed.push(...states.slice(0, perRegionBeamWidth));
  });
  return trimmed;
}


function resolveBeamLimits(simulator, frontier, options) {
  const config = options || {};
  const needsDynamic = config.perRegionBeamWidth == null || config.perFloorBeamWidth == null || config.beamWidth == null;
  const dynamic = needsDynamic && typeof config.getBeamLimits === "function" ? (config.getBeamLimits(frontier, config, simulator) || {}) : {};
  return {
    perRegionBeamWidth: config.perRegionBeamWidth != null ? config.perRegionBeamWidth : dynamic.perRegionBeamWidth,
    perFloorBeamWidth: config.perFloorBeamWidth != null ? config.perFloorBeamWidth : dynamic.perFloorBeamWidth,
    beamWidth: config.beamWidth != null ? config.beamWidth : dynamic.beamWidth,
  };
}

function recordFrontierDrops(stats, before, after, reason) {
  if (!stats || before === after || before.length === 0) return;
  const kept = new Set(after);
  before.forEach((state) => {
    if (kept.has(state)) return;
    recordFloor(stats, state, "beamDropped");
    recordActionStat(stats, state.__sourceAction, "beamDropped");
    recordDroppedActionSample(stats, reason || "beamDropped", state, state.__sourceAction);
    const floorId = state.floorId || "unknown";
    stats.frontier.beamDroppedByFloor[floorId] = Number(stats.frontier.beamDroppedByFloor[floorId] || 0) + 1;
    const stage = String(getProgress(state).stageIndex || 0);
    stats.frontier.beamDroppedByStage[stage] = Number(stats.frontier.beamDroppedByStage[stage] || 0) + 1;
  });
}


function summarizeFrontierBuckets(simulator, frontier, options) {
  const buckets = new Map();
  (frontier || []).forEach((state) => {
    const progress = getProgress(state);
    const regionKey = getFrontierBucketKey(simulator, options, state);
    const key = `${state.floorId || "unknown"}|stage:${progress.stageIndex || 0}|${regionKey}`;
    const score = getScore(simulator, state);
    const bucket = buckets.get(key) || {
      key,
      floorId: state.floorId || "unknown",
      stageIndex: progress.stageIndex || 0,
      regionKey,
      count: 0,
      bestScore: null,
      bestRouteLength: null,
      bestState: null,
      __bestRawState: null,
    };
    bucket.count += 1;
    if (!bucket.__bestRawState || compareFrontierStates(simulator, options, state, bucket.__bestRawState) > 0) {
      bucket.bestScore = score;
      bucket.bestRouteLength = Array.isArray(state.route) ? state.route.length : 0;
      bucket.bestState = compactState(state);
      bucket.__bestRawState = state;
    }
    buckets.set(key, bucket);
  });
  return Array.from(buckets.values())
    .map((bucket) => {
      const { __bestRawState, ...publicBucket } = bucket;
      return publicBucket;
    })
    .sort((left, right) => {
      if (left.count !== right.count) return right.count - left.count;
      if (left.floorId !== right.floorId) return left.floorId.localeCompare(right.floorId);
      return String(left.regionKey).localeCompare(String(right.regionKey));
    })
    .slice(0, 16);
}

function trimFrontier(simulator, frontier, options) {
  const config = options || {};
  const tracker = config.__perfTracker;
  const run = () => {
  const limits = resolveBeamLimits(simulator, frontier, config);
  let nextFrontier = frontier;
  const beforeLength = frontier.length;
  const derivedPerRegionBeamWidth = limits.perRegionBeamWidth != null
    ? limits.perRegionBeamWidth
    : (limits.perFloorBeamWidth ? Math.max(24, Math.floor(limits.perFloorBeamWidth / 3)) : undefined);
  if (derivedPerRegionBeamWidth) {
    const before = nextFrontier;
    nextFrontier = trimFrontierPerRegion(simulator, nextFrontier, derivedPerRegionBeamWidth, config);
    recordFrontierDrops(config.__stats, before, nextFrontier, "perRegionBeamDropped");
  }
  if (limits.perFloorBeamWidth) {
    const before = nextFrontier;
    nextFrontier = trimFrontierPerFloor(simulator, nextFrontier, limits.perFloorBeamWidth, config);
    recordFrontierDrops(config.__stats, before, nextFrontier, "perFloorBeamDropped");
  }
  if (limits.beamWidth && nextFrontier.length > limits.beamWidth) {
    const before = nextFrontier;
    sortFrontier(simulator, nextFrontier, config);
    nextFrontier = nextFrontier.slice(0, limits.beamWidth);
    recordFrontierDrops(config.__stats, before, nextFrontier, "globalBeamDropped");
  }
  if (config.__stats && nextFrontier.length < beforeLength) {
    config.__stats.trimmed += beforeLength - nextFrontier.length;
    config.__stats.pruneReasons.beamDropped = Number(config.__stats.pruneReasons.beamDropped || 0) + beforeLength - nextFrontier.length;
    config.__stats.frontier.beamDropped += beforeLength - nextFrontier.length;
  }
  return nextFrontier;
  };
  return tracker && tracker.enabled ? tracker.timePhase("trimFrontier", run) : run();
}

function rebuildFrontierState(simulator, frontier, expandedStateKeys, options) {
  const tracker = options && options.__perfTracker;
  const run = () => {
  const activeRecords = new Map();
  const dominanceBuckets = new Map();
  const bestByDominanceKey = new Map();
  const rebuiltFrontier = [];

  sortFrontier(simulator, frontier, options);
  frontier.forEach((state) => {
    if (!registerState(simulator, activeRecords, dominanceBuckets, bestByDominanceKey, expandedStateKeys, state, null, options)) return;
    rebuiltFrontier.push(state);
  });

  return {
    activeRecords,
    bestByDominanceKey,
    dominanceBuckets,
    frontier: rebuiltFrontier,
  };
  };
  return tracker && tracker.enabled ? tracker.timePhase("rebuildFrontier", run) : run();
}

function usesExactDominance(simulator, config, state) {
  if (!config || config.safeDominanceMode === false || config.safeDominanceMode === "0" || config.safeDominanceMode === "off") return false;
  return typeof simulator.requiresExactDominance === "function" && simulator.requiresExactDominance(state);
}

function registerExactState(activeRecords, stateKey, rank, score, stats, state) {
  const existing = activeRecords.get(stateKey);
  if (existing && existing.rank && existing.rank.score && rank && rank.score) {
    if (existing.rank.routeLength <= rank.routeLength) {
      recordSkip(stats, "safe-exact-same-state");
      return false;
    }
  } else if (existing) {
    recordSkip(stats, "safe-exact-same-state");
    return false;
  }
  const record = {
    bucketKey: stateKey,
    dominanceKey: stateKey,
    rank,
    stateKey,
    summary: { stateKey, score },
    exactOnly: true,
  };
  activeRecords.set(stateKey, record);
  if (stats) {
    stats.registered += 1;
    stats.safeDominance.exactOnly += 1;
  }
  recordFloor(stats, state, "kept");
  return true;
}

function getActiveBestRecord(bestByDominanceKey, activeRecords, dominanceKey, stats) {
  const record = bestByDominanceKey.get(dominanceKey);
  if (!record) return null;
  if (activeRecords.get(record.stateKey) === record) return record;
  bestByDominanceKey.delete(dominanceKey);
  if (stats) stats.safeDominance.staleBestRecords += 1;
  return null;
}

function registerState(simulator, activeRecords, dominanceBuckets, bestByDominanceKey, expandedStateKeys, state, stats, options) {
  const startedAt = stats ? nowMs() : 0;
  const config = options || {};
  const score = getScore(simulator, state);
  const rank = createRank(simulator, state, score);
  const keyStartedAt = stats && config.__perfTracker && config.__perfTracker.enabled ? nowMs() : 0;
  const stateKey = getStateKey(state);
  if (stats && config.__perfTracker && config.__perfTracker.enabled) config.__perfTracker.addPhase("buildStateKey", nowMs() - keyStartedAt);
  if (expandedStateKeys.has(stateKey)) {
    recordSkip(stats, "expanded");
    if (stats) stats.perf.timeInDominanceMs += nowMs() - startedAt;
    return false;
  }
  if (config.disableDominance || config.dominanceMode === "off") {
    const summary = simulator.buildDominanceSummary(state, score);
    const record = { bucketKey: stateKey, dominanceKey: stateKey, rank, stateKey, summary };
    activeRecords.set(stateKey, record);
    if (stats) stats.registered += 1;
    recordFloor(stats, state, "kept");
    if (stats) stats.perf.timeInDominanceMs += nowMs() - startedAt;
    return true;
  }
  if (usesExactDominance(simulator, config, state)) {
    const registered = registerExactState(activeRecords, stateKey, rank, score, stats, state);
    if (stats) stats.perf.timeInDominanceMs += nowMs() - startedAt;
    return registered;
  }
  const dominanceKey = getDominanceKey(state);
  const bestRecord = getActiveBestRecord(bestByDominanceKey, activeRecords, dominanceKey, stats);
  const summary = simulator.buildDominanceSummary(state, score);
  if (bestRecord) {
    if (bestRecord.stateKey === stateKey && simulator.compareRanks(bestRecord.rank, rank) >= 0) {
      recordSkip(stats, "same-state");
      if (stats) stats.perf.timeInDominanceMs += nowMs() - startedAt;
      return false;
    }
    if (simulator.dominates(bestRecord.summary, summary)) {
      if (stats && Number(((bestRecord.summary.progress || {}).stageIndex) || 0) < Number((summary.progress || {}).stageIndex || 0)) {
        stats.suspicious.higherStageDominatedByLowerStage += 1;
      }
      recordSkip(stats, "best-dominates");
      recordFloor(stats, state, "dominated");
      recordActionStat(stats, state.__sourceAction, "dominated");
      if (stats) stats.perf.timeInDominanceMs += nowMs() - startedAt;
      return false;
    }
  }
  const bucketKey = simulator.buildDominanceBucketKey(state);
  const bucket = dominanceBuckets.get(bucketKey) || [];

  for (const record of bucket) {
    if (record.stateKey === stateKey) {
      if (simulator.compareRanks(record.rank, rank) >= 0) {
        recordSkip(stats, "same-state");
        if (stats) stats.perf.timeInDominanceMs += nowMs() - startedAt;
        return false;
      }
      continue;
    }
    if (simulator.dominates(record.summary, summary)) {
      if (stats && Number(((record.summary.progress || {}).stageIndex) || 0) < Number((summary.progress || {}).stageIndex || 0)) {
        stats.suspicious.higherStageDominatedByLowerStage += 1;
      }
      recordSkip(stats, "bucket-dominates");
      recordFloor(stats, state, "dominated");
      recordActionStat(stats, state.__sourceAction, "dominated");
      if (stats) stats.perf.timeInDominanceMs += nowMs() - startedAt;
      return false;
    }
  }

  const nextBucket = [];
  bucket.forEach((record) => {
    if (record.stateKey === stateKey) {
      activeRecords.delete(record.stateKey);
      return;
    }
    if (simulator.dominates(summary, record.summary)) {
      activeRecords.delete(record.stateKey);
      if (bestByDominanceKey.get(record.dominanceKey) === record) bestByDominanceKey.delete(record.dominanceKey);
      return;
    }
    nextBucket.push(record);
  });

  const nextRecord = {
    bucketKey,
    dominanceKey,
    rank,
    stateKey,
    summary,
  };
  nextBucket.push(nextRecord);
  dominanceBuckets.set(bucketKey, nextBucket);
  activeRecords.set(stateKey, nextRecord);
  if (!bestRecord || simulator.dominates(summary, bestRecord.summary) || simulator.compareRanks(rank, bestRecord.rank) > 0) {
    bestByDominanceKey.set(dominanceKey, nextRecord);
  }
  if (stats) stats.registered += 1;
  recordFloor(stats, state, "kept");
  if (stats) stats.perf.timeInDominanceMs += nowMs() - startedAt;
  return true;
}

function maybeAutoExpandForwardChangeFloors(simulator, parentNode, parentState, frontier, heap, activeRecords, dominanceBuckets, bestByDominanceKey, expandedStateKeys, stats, config, updateBest, registerChild) {
  if (!config.forwardChangeFloorAutoExpand || typeof simulator.getForwardChangeFloorActions !== "function") return;
  if (simulator.isTerminal(parentState)) return;
  let actions = [];
  try {
    actions = simulator.getForwardChangeFloorActions(parentState);
  } catch (error) {
    return;
  }
  actions.slice(0, 3).forEach((action) => {
    stats.generated += 1;
    recordFloor(stats, parentState, "generated");
    recordActionStat(stats, action, "expanded");
    const applyStartedAt = nowMs();
    const tracker = config && config.__perfTracker;
    const childState = tracker && tracker.enabled
      ? tracker.timePhase("applyAction", () => simulator.applyAction(parentState, action, { storeRoute: false }))
      : simulator.applyAction(parentState, action, { storeRoute: false });
    stats.perf.timeInApplyActionMs += nowMs() - applyStartedAt;
    childState.__sourceAction = compactAction(action);
    const childNode = registerChild(parentNode, childState, action);
    if (!childNode) return;
    updateBest(childState);
    frontier.push(childState);
    heap.push(childState);
  });
}

function searchTopKSerial(simulator, initialState, options) {
  const config = options || {};
  const perfEnabled = config.perf === true || config.perf === "1" || config.perf === "true" || config.perf === "on";
  const perfTracker = createPerfTracker({ enabled: perfEnabled, outputPath: config.perfOutputPath });
  config.__perfTracker = perfTracker;
  setActivePerfTracker(perfTracker);

  const frontier = [];
  const heap = new BinaryHeap((left, right) => compareFrontierStates(simulator, config, left, right));
  const results = [];
  let activeRecords = new Map();
  let dominanceBuckets = new Map();
  let bestByDominanceKey = new Map();
  const expandedStateKeys = new Set();
  const nodes = new Map();
  const stateKeyToNodeId = new Map();
  const maxExpansions = config.maxExpansions || 200;
  const trimInterval = Number(config.trimInterval || 32);
  const beamOverflowRatio = Number(config.beamOverflowRatio || 1.5);
  const hardFrontierLimit = Number(config.hardFrontierLimit || 0);
  const startedAt = nowMs();
  const startedCpu = process.cpuUsage();
  const stats = {
    registered: 0,
    skipped: {},
    trimmed: 0,
    generated: 0,
    byActionType: {},
    byActionRole: {},
    byFloor: {},
    byStage: {},
    droppedProgressActions: {
      total: 0,
      byReason: {},
      samples: [],
    },
    frontier: {
      beamDropped: 0,
      beamDroppedByFloor: {},
      beamDroppedByStage: {},
    },
    sampleLimit: Number(config.sampleLimit || 20),
    pruneReasons: {},
    suspicious: {
      higherStageDominatedByLowerStage: 0,
      progressActionTrimmed: 0,
      goalCandidateGeneratedButDropped: 0,
      fallbackUsedWhenStrictGoalRequired: 0,
    },
    safeDominance: {
      exactOnly: 0,
      staleBestRecords: 0,
    },
    perf: {
      wallMs: 0,
      cpuUserMs: 0,
      cpuSystemMs: 0,
      eventLoopUtilization: null,
      expansionsPerSec: 0,
      generatedPerSec: 0,
      timeInGenerateActionsMs: 0,
      timeInApplyActionMs: 0,
      timeInDominanceMs: 0,
      timeInScoringMs: 0,
      timeInLoggingMs: 0,
      maxFrontierSize: frontier.length,
      avgBranchingFactor: 0,
      expandedStates: 0,
      generatedActions: 0,
      keptActions: 0,
      phaseMs: {},
      phaseCounts: {},
    },
    checkpointPool: createCheckpointPool(config.checkpointOptions),
  };
  config.__stats = stats;
  let bestSeenState = initialState;
  let bestProgressState = initialState;
  let goalState = null;
  let expansions = 0;
  let nextNodeId = 1;
  let nextNodeOrder = 1;

  const rootStateKey = getStateKey(initialState);
  const rootNode = createRootNode(initialState, rootStateKey);
  nodes.set(rootNode.nodeId, rootNode);
  stateKeyToNodeId.set(rootStateKey, rootNode.nodeId);
  frontier.push(initialState);
  heap.push(initialState);

  const getNodeForState = (state) => nodes.get(stateKeyToNodeId.get(getStateKey(state)));
  const hydrateState = (state) => {
    if (!state) return null;
    return attachRouteToState(nodes, getNodeForState(state)) || state;
  };
  const hydrateStates = (states) => states.map((state) => hydrateState(state)).filter(Boolean);
  const updateBestState = (candidateState) => {
    if (compareFrontierStates(simulator, config, candidateState, bestSeenState) > 0) {
      bestSeenState = candidateState;
    }
    const candidateProgressDiff = compareProgress(candidateState, bestProgressState);
    if (candidateProgressDiff > 0 || (candidateProgressDiff === 0 && compareFrontierStates(simulator, config, candidateState, bestProgressState) > 0)) {
      bestProgressState = candidateState;
    }
  };
  const registerChild = (parentNode, childState, action) => {
    const childStateKey = getStateKey(childState);
    if (!registerState(simulator, activeRecords, dominanceBuckets, bestByDominanceKey, expandedStateKeys, childState, stats, config)) return null;
    const existingId = stateKeyToNodeId.get(childStateKey);
    if (existingId != null) nodes.delete(existingId);
    const childNode = createChildNode(parentNode, childState, childStateKey, action, nextNodeId, nextNodeOrder);
    nextNodeId += 1;
    nextNodeOrder += 1;
    nodes.set(childNode.nodeId, childNode);
    stateKeyToNodeId.set(childStateKey, childNode.nodeId);
    if (parentNode && parentNode.state) {
      recordFloorEntryCheckpoint(stats.checkpointPool, simulator, parentNode.state, childState, action);
    }
    return childNode;
  };
  const shouldTrim = () => {
    if (frontier.length === 0) return false;
    if (trimInterval > 0 && expansions > 0 && expansions % trimInterval === 0) return true;
    const limits = resolveBeamLimits(simulator, frontier, config);
    if (limits.beamWidth && frontier.length > limits.beamWidth * beamOverflowRatio) return true;
    if (hardFrontierLimit > 0 && frontier.length > hardFrontierLimit) return true;
    return false;
  };

  registerState(simulator, activeRecords, dominanceBuckets, bestByDominanceKey, expandedStateKeys, initialState, stats, config);

  try {
    while (heap.size > 0 && expansions < maxExpansions) {
      const state = heap.pop();
      const stateKey = getStateKey(state);
      if (!activeRecords.has(stateKey)) continue;
      const parentNode = getNodeForState(state);
      activeRecords.delete(stateKey);
      expandedStateKeys.add(stateKey);
      expansions += 1;
      perfTracker.increment("expanded");
      recordFloor(stats, state, "expanded");
      recordStage(stats, state, "expanded");
      if (compareFrontierStates(simulator, config, state, bestSeenState) > 0) {
        bestSeenState = state;
      }
      const progressDiff = compareProgress(state, bestProgressState);
      if (progressDiff > 0 || (progressDiff === 0 && compareFrontierStates(simulator, config, state, bestProgressState) > 0)) {
        bestProgressState = state;
      }

      if (simulator.isTerminal(state)) {
        goalState = goalState && simulator.compareResultStates(goalState, state) >= 0 ? goalState : state;
        recordStage(stats, state, "reachedGoalCandidates");
        recordStage(stats, state, "keptGoalCandidates");
        results.push(state);
        results.sort((left, right) => simulator.compareResultStates(right, left));
        if (results.length > (config.topK || 3)) results.length = config.topK || 3;
        continue;
      }

      const actions = getStateActions(simulator, config, state);
      stats.perf.generatedActions += actions.length;
      actions.forEach((action) => {
        stats.generated += 1;
        perfTracker.increment("generated");
        recordFloor(stats, state, "generated");
        recordActionStat(stats, action, "expanded");
        const applyStartedAt = nowMs();
        const nextState = perfTracker.enabled
          ? perfTracker.timePhase("applyAction", () => simulator.applyAction(state, action, { storeRoute: false }))
          : simulator.applyAction(state, action, { storeRoute: false });
        stats.perf.timeInApplyActionMs += nowMs() - applyStartedAt;
        nextState.__sourceAction = compactAction(action);
        const childNode = registerChild(parentNode, nextState, action);
        if (!childNode) return;
        perfTracker.increment("registered");
        updateBestState(nextState);
        frontier.push(nextState);
        heap.push(nextState);
        maybeAutoExpandForwardChangeFloors(simulator, childNode, nextState, frontier, heap, activeRecords, dominanceBuckets, bestByDominanceKey, expandedStateKeys, stats, config, updateBestState, registerChild);
      });
      stats.perf.maxFrontierSize = Math.max(stats.perf.maxFrontierSize, frontier.length);
      perfTracker.maybePrintLive({ expanded: expansions, generated: stats.generated, registered: stats.registered, duplicates: Number(stats.skipped["same-state"] || 0) });

      if (shouldTrim()) {
        const activeFrontier = frontier.filter((item) => activeRecords.has(getStateKey(item)));
        const trimmedFrontier = trimFrontier(simulator, activeFrontier, config);
        const rebuilt = rebuildFrontierState(simulator, trimmedFrontier, expandedStateKeys, config);
        frontier.length = 0;
        frontier.push(...rebuilt.frontier);
        heap.rebuild(rebuilt.frontier);
        activeRecords = rebuilt.activeRecords;
        dominanceBuckets = rebuilt.dominanceBuckets;
        bestByDominanceKey = rebuilt.bestByDominanceKey;
      }
      stats.perf.maxFrontierSize = Math.max(stats.perf.maxFrontierSize, frontier.length);
    }
  } finally {
    setActivePerfTracker(null);
  }

  const wallMs = nowMs() - startedAt;
  const cpu = process.cpuUsage(startedCpu);
  stats.perf.wallMs = wallMs;
  stats.perf.cpuUserMs = cpu.user / 1000;
  stats.perf.cpuSystemMs = cpu.system / 1000;
  stats.perf.expandedStates = expansions;
  stats.perf.keptActions = stats.generated;
  stats.perf.expansionsPerSec = wallMs > 0 ? expansions / (wallMs / 1000) : 0;
  stats.perf.generatedPerSec = wallMs > 0 ? stats.generated / (wallMs / 1000) : 0;
  stats.perf.avgBranchingFactor = expansions > 0 ? stats.generated / expansions : 0;
  const perfSummary = perfTracker.finish({ expanded: expansions, generated: stats.generated, registered: stats.registered, duplicates: Number(stats.skipped["same-state"] || 0) });
  stats.perf = { ...stats.perf, ...perfSummary };

  const hydratedGoalState = hydrateState(goalState);
  const hydratedBestSeenState = hydrateState(bestSeenState);
  const hydratedBestProgressState = hydrateState(bestProgressState);
  const hydratedResults = hydrateStates(results);
  hydrateCheckpointPool(stats.checkpointPool, hydrateState);
  const activeFrontier = frontier.filter((item) => activeRecords.has(getStateKey(item)));

  return {
    foundGoal: Boolean(hydratedGoalState),
    goalState: hydratedGoalState,
    bestSeenState: hydratedBestSeenState,
    bestProgressState: hydratedBestProgressState,
    fallbackState: null,
    route: hydratedGoalState ? hydratedGoalState.route : null,
    fallbackRoute: null,
    expansions,
    frontierSize: activeFrontier.length,
    diagnostics: {
      registered: stats.registered,
      skipped: stats.skipped,
      trimmed: stats.trimmed,
      generated: stats.generated,
      byFloor: stats.byFloor,
      byStage: stats.byStage,
      byActionType: stats.byActionType,
      byActionRole: stats.byActionRole,
      droppedProgressActions: stats.droppedProgressActions,
      frontier: {
        ...stats.frontier,
        topBuckets: summarizeFrontierBuckets(simulator, activeFrontier, config),
      },
      perf: stats.perf,
      pruneReasons: stats.pruneReasons,
      suspicious: stats.suspicious,
      safeDominance: stats.safeDominance,
      checkpoints: summarizeCheckpointPool(stats.checkpointPool),
      best: {
        bestSeenFloor: hydratedBestSeenState && hydratedBestSeenState.floorId,
        bestSeenStage: hydratedBestSeenState ? getProgress(hydratedBestSeenState).stageIndex : null,
        bestSeenRouteLength: hydratedBestSeenState && hydratedBestSeenState.route ? hydratedBestSeenState.route.length : null,
        bestProgressFloor: hydratedBestProgressState && hydratedBestProgressState.floorId,
        bestProgressStage: hydratedBestProgressState ? getProgress(hydratedBestProgressState).stageIndex : null,
      },
    },
    checkpointPool: stats.checkpointPool,
    results: hydratedResults,
  };
}

async function searchTopKParallel(simulator, initialState, options) {
  const config = options || {};
  const perfEnabled = config.perf === true || config.perf === "1" || config.perf === "true" || config.perf === "on";
  const perfTracker = createPerfTracker({ enabled: perfEnabled, outputPath: config.perfOutputPath });
  config.__perfTracker = perfTracker;
  setActivePerfTracker(perfTracker);

  const frontier = [];
  const heap = new BinaryHeap((left, right) => compareFrontierStates(simulator, config, left, right));
  const results = [];
  let activeRecords = new Map();
  let dominanceBuckets = new Map();
  let bestByDominanceKey = new Map();
  const expandedStateKeys = new Set();
  const nodes = new Map();
  const stateKeyToNodeId = new Map();
  const maxExpansions = config.maxExpansions || 200;
  const trimInterval = Number(config.trimInterval || 32);
  const beamOverflowRatio = Number(config.beamOverflowRatio || 1.5);
  const hardFrontierLimit = Number(config.hardFrontierLimit || 0);
  const startedAt = nowMs();
  const startedCpu = process.cpuUsage();
  const stats = {
    registered: 0,
    skipped: {},
    trimmed: 0,
    generated: 0,
    byActionType: {},
    byActionRole: {},
    byFloor: {},
    byStage: {},
    droppedProgressActions: {
      total: 0,
      byReason: {},
      samples: [],
    },
    frontier: {
      beamDropped: 0,
      beamDroppedByFloor: {},
      beamDroppedByStage: {},
    },
    sampleLimit: Number(config.sampleLimit || 20),
    pruneReasons: {},
    suspicious: {
      higherStageDominatedByLowerStage: 0,
      progressActionTrimmed: 0,
      goalCandidateGeneratedButDropped: 0,
      fallbackUsedWhenStrictGoalRequired: 0,
    },
    safeDominance: {
      exactOnly: 0,
      staleBestRecords: 0,
    },
    perf: {
      wallMs: 0,
      cpuUserMs: 0,
      cpuSystemMs: 0,
      eventLoopUtilization: null,
      expansionsPerSec: 0,
      generatedPerSec: 0,
      timeInGenerateActionsMs: 0,
      timeInApplyActionMs: 0,
      timeInDominanceMs: 0,
      timeInScoringMs: 0,
      timeInLoggingMs: 0,
      maxFrontierSize: frontier.length,
      avgBranchingFactor: 0,
      expandedStates: 0,
      generatedActions: 0,
      keptActions: 0,
      phaseMs: {},
      phaseCounts: {},
    },
    checkpointPool: createCheckpointPool(config.checkpointOptions),
  };
  config.__stats = stats;
  let bestSeenState = initialState;
  let bestProgressState = initialState;
  let goalState = null;
  let expansions = 0;
  let nextNodeId = 1;
  let nextNodeOrder = 1;

  const rootStateKey = getStateKey(initialState);
  const rootNode = createRootNode(initialState, rootStateKey);
  nodes.set(rootNode.nodeId, rootNode);
  stateKeyToNodeId.set(rootStateKey, rootNode.nodeId);
  frontier.push(initialState);
  heap.push(initialState);

  const getNodeForState = (state) => nodes.get(stateKeyToNodeId.get(getStateKey(state)));
  const hydrateState = (state) => {
    if (!state) return null;
    return attachRouteToState(nodes, getNodeForState(state)) || state;
  };
  const hydrateStates = (states) => states.map((state) => hydrateState(state)).filter(Boolean);
  const updateBestState = (candidateState) => {
    if (compareFrontierStates(simulator, config, candidateState, bestSeenState) > 0) {
      bestSeenState = candidateState;
    }
    const candidateProgressDiff = compareProgress(candidateState, bestProgressState);
    if (candidateProgressDiff > 0 || (candidateProgressDiff === 0 && compareFrontierStates(simulator, config, candidateState, bestProgressState) > 0)) {
      bestProgressState = candidateState;
    }
  };
  const registerChild = (parentNode, childState, action) => {
    const childStateKey = getStateKey(childState);
    if (!registerState(simulator, activeRecords, dominanceBuckets, bestByDominanceKey, expandedStateKeys, childState, stats, config)) return null;
    const existingId = stateKeyToNodeId.get(childStateKey);
    if (existingId != null) nodes.delete(existingId);
    const childNode = createChildNode(parentNode, childState, childStateKey, action, nextNodeId, nextNodeOrder);
    nextNodeId += 1;
    nextNodeOrder += 1;
    nodes.set(childNode.nodeId, childNode);
    stateKeyToNodeId.set(childStateKey, childNode.nodeId);
    if (parentNode && parentNode.state) {
      recordFloorEntryCheckpoint(stats.checkpointPool, simulator, parentNode.state, childState, action);
    }
    return childNode;
  };
  const shouldTrim = () => {
    if (frontier.length === 0) return false;
    if (trimInterval > 0 && expansions > 0 && expansions % trimInterval === 0) return true;
    const limits = resolveBeamLimits(simulator, frontier, config);
    if (limits.beamWidth && frontier.length > limits.beamWidth * beamOverflowRatio) return true;
    if (hardFrontierLimit > 0 && frontier.length > hardFrontierLimit) return true;
    return false;
  };

  registerState(simulator, activeRecords, dominanceBuckets, bestByDominanceKey, expandedStateKeys, initialState, stats, config);

  const workers = Math.max(1, Number(config.workers || 1));
  const topKBatchSize = Math.max(1, Number(config.topKBatchSize || 128));
  const workerChunkSize = Math.max(1, Number(config.workerChunkSize || 8));
  const pool = new WorkerPool(path.join(__dirname, "search-worker.js"), {
    workers,
    workerData: {
      projectRoot: config.projectRoot || path.resolve(__dirname, ".."),
      stopFloorId: simulator.stopFloorId,
      autoPickupEnabled: config.autoPickupEnabled !== false,
      autoBattleEnabled: config.autoBattleEnabled !== false,
      enableFightToLevelUp: Boolean(config.enableFightToLevelUp),
      enableResourcePocket: Boolean(config.enableResourcePocket),
      resourcePocketSearchOptions: config.resourcePocketSearchOptions,
      profileName: config.profileName || "stage-mt1-mt11",
      targetFloorId: config.targetFloorId || simulator.stopFloorId,
      maxActionsPerState: config.maxActionsPerState,
      perStateLimit: config.perStateLimit,
      maxDepth: config.maxDepth,
    },
  });

  const popBatch = () => {
    const batch = [];
    while (heap.size > 0 && batch.length < topKBatchSize && expansions + batch.length < maxExpansions) {
      const state = heap.pop();
      const stateKey = getStateKey(state);
      if (!activeRecords.has(stateKey)) continue;
      const parentNode = getNodeForState(state);
      activeRecords.delete(stateKey);
      expandedStateKeys.add(stateKey);
      batch.push({ state, stateKey, parentNode });
    }
    return batch;
  };

  try {
    while (heap.size > 0 && expansions < maxExpansions) {
      const batch = popBatch();
      if (batch.length === 0) continue;
      const expandable = [];
      batch.forEach((entry) => {
        const state = entry.state;
        expansions += 1;
        perfTracker.increment("expanded");
        recordFloor(stats, state, "expanded");
        recordStage(stats, state, "expanded");
        updateBestState(state);

        if (simulator.isTerminal(state)) {
          goalState = goalState && simulator.compareResultStates(goalState, state) >= 0 ? goalState : state;
          recordStage(stats, state, "reachedGoalCandidates");
          recordStage(stats, state, "keptGoalCandidates");
          results.push(state);
          results.sort((left, right) => simulator.compareResultStates(right, left));
          if (results.length > (config.topK || 3)) results.length = config.topK || 3;
          return;
        }
        if (entry.parentNode) expandable.push(entry.parentNode);
      });

      if (expandable.length > 0) {
        const jobs = chunk(expandable.map((node, order) => serializeNodeForWorker(node, order)), workerChunkSize);
        const resultsFromWorkers = await pool.map(jobs, (nodesForWorker) => ({ type: "expandBatch", nodes: nodesForWorker }));
        resultsFromWorkers.forEach((result) => {
          if (result && result.stats) {
            stats.perf.timeInGenerateActionsMs += Number(result.stats.enumerateMs || 0);
            stats.perf.timeInApplyActionMs += Number(result.stats.applyMs || 0);
          }
        });
        const candidates = stableMergeResults(resultsFromWorkers);
        const parentById = new Map(expandable.map((node) => [node.nodeId, node]));
        candidates.forEach((candidate) => {
          const parentNode = parentById.get(candidate.parentId);
          const parentState = parentNode && parentNode.state;
          const action = candidate.actionEntry || { kind: "unknown", summary: "unknown" };
          stats.generated += 1;
          stats.perf.generatedActions += 1;
          perfTracker.increment("generated");
          if (parentState) recordFloor(stats, parentState, "generated");
          recordActionStat(stats, action, candidate.invalid ? "invalid" : "expanded");
          if (candidate.invalid || !candidate.state) return;
          const nextState = candidate.state;
          nextState.__sourceAction = compactAction(action);
          const childNode = registerChild(parentNode, nextState, action);
          if (!childNode) return;
          perfTracker.increment("registered");
          updateBestState(nextState);
          frontier.push(nextState);
          heap.push(nextState);
          maybeAutoExpandForwardChangeFloors(simulator, childNode, nextState, frontier, heap, activeRecords, dominanceBuckets, bestByDominanceKey, expandedStateKeys, stats, config, updateBestState, registerChild);
        });
      }

      stats.perf.maxFrontierSize = Math.max(stats.perf.maxFrontierSize, frontier.length);
      perfTracker.maybePrintLive({ expanded: expansions, generated: stats.generated, registered: stats.registered, duplicates: Number(stats.skipped["same-state"] || 0) });

      if (shouldTrim()) {
        const activeFrontier = frontier.filter((item) => activeRecords.has(getStateKey(item)));
        const trimmedFrontier = trimFrontier(simulator, activeFrontier, config);
        const rebuilt = rebuildFrontierState(simulator, trimmedFrontier, expandedStateKeys, config);
        frontier.length = 0;
        frontier.push(...rebuilt.frontier);
        heap.rebuild(rebuilt.frontier);
        activeRecords = rebuilt.activeRecords;
        dominanceBuckets = rebuilt.dominanceBuckets;
        bestByDominanceKey = rebuilt.bestByDominanceKey;
      }
      stats.perf.maxFrontierSize = Math.max(stats.perf.maxFrontierSize, frontier.length);
    }
  } finally {
    await pool.close();
    setActivePerfTracker(null);
  }

  const wallMs = nowMs() - startedAt;
  const cpu = process.cpuUsage(startedCpu);
  stats.perf.wallMs = wallMs;
  stats.perf.cpuUserMs = cpu.user / 1000;
  stats.perf.cpuSystemMs = cpu.system / 1000;
  stats.perf.expandedStates = expansions;
  stats.perf.keptActions = stats.generated;
  stats.perf.expansionsPerSec = wallMs > 0 ? expansions / (wallMs / 1000) : 0;
  stats.perf.generatedPerSec = wallMs > 0 ? stats.generated / (wallMs / 1000) : 0;
  stats.perf.avgBranchingFactor = expansions > 0 ? stats.generated / expansions : 0;
  const perfSummary = perfTracker.finish({ expanded: expansions, generated: stats.generated, registered: stats.registered, duplicates: Number(stats.skipped["same-state"] || 0) });
  stats.perf = { ...stats.perf, ...perfSummary };

  const hydratedGoalState = hydrateState(goalState);
  const hydratedBestSeenState = hydrateState(bestSeenState);
  const hydratedBestProgressState = hydrateState(bestProgressState);
  const hydratedResults = hydrateStates(results);
  hydrateCheckpointPool(stats.checkpointPool, hydrateState);
  const activeFrontier = frontier.filter((item) => activeRecords.has(getStateKey(item)));

  return {
    foundGoal: Boolean(hydratedGoalState),
    goalState: hydratedGoalState,
    bestSeenState: hydratedBestSeenState,
    bestProgressState: hydratedBestProgressState,
    fallbackState: null,
    route: hydratedGoalState ? hydratedGoalState.route : null,
    fallbackRoute: null,
    expansions,
    frontierSize: activeFrontier.length,
    diagnostics: {
      registered: stats.registered,
      skipped: stats.skipped,
      trimmed: stats.trimmed,
      generated: stats.generated,
      byFloor: stats.byFloor,
      byStage: stats.byStage,
      byActionType: stats.byActionType,
      byActionRole: stats.byActionRole,
      droppedProgressActions: stats.droppedProgressActions,
      frontier: {
        ...stats.frontier,
        topBuckets: summarizeFrontierBuckets(simulator, activeFrontier, config),
      },
      perf: stats.perf,
      pruneReasons: stats.pruneReasons,
      suspicious: stats.suspicious,
      safeDominance: stats.safeDominance,
      checkpoints: summarizeCheckpointPool(stats.checkpointPool),
      best: {
        bestSeenFloor: hydratedBestSeenState && hydratedBestSeenState.floorId,
        bestSeenStage: hydratedBestSeenState ? getProgress(hydratedBestSeenState).stageIndex : null,
        bestSeenRouteLength: hydratedBestSeenState && hydratedBestSeenState.route ? hydratedBestSeenState.route.length : null,
        bestProgressFloor: hydratedBestProgressState && hydratedBestProgressState.floorId,
        bestProgressStage: hydratedBestProgressState ? getProgress(hydratedBestProgressState).stageIndex : null,
      },
    },
    checkpointPool: stats.checkpointPool,
    results: hydratedResults,
  };
}

function isParallelTopKEnabled(options) {
  const value = options && options.parallel;
  return value === true || value === "1" || value === "true" || value === "on";
}

function searchTopK(simulator, initialState, options) {
  if (isParallelTopKEnabled(options)) return searchTopKParallel(simulator, initialState, options);
  return searchTopKSerial(simulator, initialState, options);
}

module.exports = {
  searchTopK,
  searchTopKParallel,
  searchTopKSerial,
};
