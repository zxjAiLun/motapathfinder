"use strict";

const { buildDominanceKey, buildStateKey } = require("./state-key");
const { getDecisionDepth } = require("./state");
const { compareProgress, getProgress } = require("./progress");

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
  const allActions = simulator.enumerateActions(state);
  if (options && options.__stats) options.__stats.perf.timeInGenerateActionsMs += nowMs() - startedAt;
  let actions = allActions;
  if (actionOptions && typeof actionOptions.sortStateActions === "function") {
    actions = actionOptions.sortStateActions(state, actions.slice());
  }
  if (options && options.__stats) {
    actions.forEach((action) => recordActionStat(options.__stats, action, "generated"));
  }
  if (actionOptions && typeof actionOptions.selectStateActions === "function") {
    actions = actionOptions.selectStateActions(state, actions.slice(), actionOptions);
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
  return {
    score: score || simulator.score(state),
    decisionDepth: getDecisionDepth(state),
    routeLength: state.route.length,
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
  frontier.sort((left, right) => compareFrontierStates(simulator, options, right, left));
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
    const score = simulator.score(state);
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
}

function rebuildFrontierState(simulator, frontier, expandedStateKeys, options) {
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
  const score = simulator.score(state);
  const rank = createRank(simulator, state, score);
  const stateKey = buildStateKey(state);
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
  const dominanceKey = buildDominanceKey(state);
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

function maybeAutoExpandForwardChangeFloors(simulator, parentState, frontier, activeRecords, dominanceBuckets, bestByDominanceKey, expandedStateKeys, stats, config, updateBest) {
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
    const childState = simulator.applyAction(parentState, action);
    stats.perf.timeInApplyActionMs += nowMs() - applyStartedAt;
    childState.__sourceAction = compactAction(action);
    if (!registerState(simulator, activeRecords, dominanceBuckets, bestByDominanceKey, expandedStateKeys, childState, stats, config)) return;
    updateBest(childState);
    frontier.push(childState);
  });
}

function searchTopK(simulator, initialState, options) {
  const config = options || {};
  const frontier = [initialState];
  const results = [];
  let activeRecords = new Map();
  let dominanceBuckets = new Map();
  let bestByDominanceKey = new Map();
  const expandedStateKeys = new Set();
  const maxExpansions = config.maxExpansions || 200;
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
    },
  };
  config.__stats = stats;
  let bestSeenState = initialState;
  let bestProgressState = initialState;
  let goalState = null;
  let expansions = 0;
  const updateBestState = (candidateState) => {
    if (compareFrontierStates(simulator, config, candidateState, bestSeenState) > 0) {
      bestSeenState = candidateState;
    }
    const candidateProgressDiff = compareProgress(candidateState, bestProgressState);
    if (candidateProgressDiff > 0 || (candidateProgressDiff === 0 && compareFrontierStates(simulator, config, candidateState, bestProgressState) > 0)) {
      bestProgressState = candidateState;
    }
  };

  registerState(simulator, activeRecords, dominanceBuckets, bestByDominanceKey, expandedStateKeys, initialState, stats, config);

  while (frontier.length > 0 && expansions < maxExpansions) {
    sortFrontier(simulator, frontier, config);
    const state = frontier.shift();
    const stateKey = buildStateKey(state);
    if (!activeRecords.has(stateKey)) continue;
    activeRecords.delete(stateKey);
    expandedStateKeys.add(stateKey);
    expansions += 1;
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
      recordFloor(stats, state, "generated");
      recordActionStat(stats, action, "expanded");
      const applyStartedAt = nowMs();
      const nextState = simulator.applyAction(state, action);
      stats.perf.timeInApplyActionMs += nowMs() - applyStartedAt;
      nextState.__sourceAction = compactAction(action);
      if (!registerState(simulator, activeRecords, dominanceBuckets, bestByDominanceKey, expandedStateKeys, nextState, stats, config)) return;
      updateBestState(nextState);
      frontier.push(nextState);
      maybeAutoExpandForwardChangeFloors(simulator, nextState, frontier, activeRecords, dominanceBuckets, bestByDominanceKey, expandedStateKeys, stats, config, updateBestState);
    });
    stats.perf.maxFrontierSize = Math.max(stats.perf.maxFrontierSize, frontier.length);

    const trimmedFrontier = trimFrontier(simulator, frontier, config);
    if (trimmedFrontier !== frontier) {
      const rebuilt = rebuildFrontierState(simulator, trimmedFrontier, expandedStateKeys, config);
      frontier.length = 0;
      frontier.push(...rebuilt.frontier);
      activeRecords = rebuilt.activeRecords;
      dominanceBuckets = rebuilt.dominanceBuckets;
      bestByDominanceKey = rebuilt.bestByDominanceKey;
    }
    stats.perf.maxFrontierSize = Math.max(stats.perf.maxFrontierSize, frontier.length);
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

  return {
    foundGoal: Boolean(goalState),
    goalState,
    bestSeenState,
    bestProgressState,
    fallbackState: null,
    route: goalState ? goalState.route : null,
    fallbackRoute: null,
    expansions,
    frontierSize: frontier.length,
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
        topBuckets: summarizeFrontierBuckets(simulator, frontier, config),
      },
      perf: stats.perf,
      pruneReasons: stats.pruneReasons,
      suspicious: stats.suspicious,
      safeDominance: stats.safeDominance,
      best: {
        bestSeenFloor: bestSeenState && bestSeenState.floorId,
        bestSeenStage: bestSeenState ? getProgress(bestSeenState).stageIndex : null,
        bestSeenRouteLength: bestSeenState && bestSeenState.route ? bestSeenState.route.length : null,
        bestProgressFloor: bestProgressState && bestProgressState.floorId,
        bestProgressStage: bestProgressState ? getProgress(bestProgressState).stageIndex : null,
      },
    },
    results,
  };
}

module.exports = {
  searchTopK,
};
