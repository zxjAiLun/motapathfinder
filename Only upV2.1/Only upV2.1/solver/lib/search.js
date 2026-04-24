"use strict";

const { buildDominanceKey, buildStateKey } = require("./state-key");
const { getDecisionDepth } = require("./state");
const { compareProgress, getProgress } = require("./progress");

function actionType(action) {
  if (!action) return "unknown";
  if (action.kind === "changeFloor") return "changeFloor";
  if (action.kind === "useTool" && action.tool === "centerFly") return "centerFly";
  if (action.kind === "openDoor") return "door";
  if (action.kind === "battle") return "monster";
  if (action.kind === "pickup") return "item";
  if (action.kind === "useTool") return "tool";
  return action.kind || "misc";
}

function isProgressAction(action) {
  return actionType(action) === "changeFloor" || actionType(action) === "centerFly";
}

function ensureActionStats(stats, type) {
  if (!stats) return null;
  if (!stats.byActionType[type]) {
    stats.byActionType[type] = { generated: 0, kept: 0, trimmed: 0, dominated: 0, expanded: 0, invalid: 0 };
  }
  return stats.byActionType[type];
}

function recordActionStat(stats, action, field) {
  const bucket = ensureActionStats(stats, actionType(action));
  if (!bucket) return;
  bucket[field] = Number(bucket[field] || 0) + 1;
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

function getStateActions(simulator, options, state) {
  const allActions = simulator.enumerateActions(state);
  let actions = allActions;
  if (options && typeof options.sortStateActions === "function") {
    actions = options.sortStateActions(state, actions.slice());
  }
  if (options && options.__stats) {
    actions.forEach((action) => recordActionStat(options.__stats, action, "generated"));
  }
  if (options && typeof options.selectStateActions === "function") {
    actions = options.selectStateActions(state, actions.slice(), options);
  } else if (options && options.maxActionsPerState != null) {
    const maxActions = Number(options.maxActionsPerState);
    if (options.reserveProgressActions) {
      actions = selectActionsByQuota(actions, {
        maxActions,
        progressActionQuota: options.progressActionQuota,
        unlockActionQuota: options.unlockActionQuota,
        itemActionQuota: options.itemActionQuota,
        fightActionQuota: options.fightActionQuota,
        shopActionQuota: options.shopActionQuota,
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
      if (isProgressAction(action)) options.__stats.suspicious.progressActionTrimmed += 1;
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

function trimFrontier(simulator, frontier, options) {
  const config = options || {};
  let nextFrontier = frontier;
  const beforeLength = frontier.length;
  const derivedPerRegionBeamWidth = config.perRegionBeamWidth != null
    ? config.perRegionBeamWidth
    : (config.perFloorBeamWidth ? Math.max(24, Math.floor(config.perFloorBeamWidth / 3)) : undefined);
  if (derivedPerRegionBeamWidth) {
    nextFrontier = trimFrontierPerRegion(simulator, nextFrontier, derivedPerRegionBeamWidth, config);
  }
  if (config.perFloorBeamWidth) {
    nextFrontier = trimFrontierPerFloor(simulator, nextFrontier, config.perFloorBeamWidth, config);
  }
  if (config.beamWidth && nextFrontier.length > config.beamWidth) {
    sortFrontier(simulator, nextFrontier, config);
    nextFrontier = nextFrontier.slice(0, config.beamWidth);
  }
  if (config.__stats && nextFrontier.length < beforeLength) {
    config.__stats.trimmed += beforeLength - nextFrontier.length;
    config.__stats.pruneReasons.beamDropped = Number(config.__stats.pruneReasons.beamDropped || 0) + beforeLength - nextFrontier.length;
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

function registerState(simulator, activeRecords, dominanceBuckets, bestByDominanceKey, expandedStateKeys, state, stats, options) {
  const config = options || {};
  const score = simulator.score(state);
  const rank = createRank(simulator, state, score);
  const stateKey = buildStateKey(state);
  if (expandedStateKeys.has(stateKey)) {
    recordSkip(stats, "expanded");
    return false;
  }
  if (config.disableDominance || config.dominanceMode === "off") {
    const summary = simulator.buildDominanceSummary(state, score);
    const record = { bucketKey: stateKey, dominanceKey: stateKey, rank, stateKey, summary };
    activeRecords.set(stateKey, record);
    if (stats) stats.registered += 1;
    recordFloor(stats, state, "kept");
    return true;
  }
  const dominanceKey = buildDominanceKey(state);
  const bestRecord = bestByDominanceKey.get(dominanceKey);
  const summary = simulator.buildDominanceSummary(state, score);
  if (bestRecord) {
    if (bestRecord.stateKey === stateKey && simulator.compareRanks(bestRecord.rank, rank) >= 0) {
      recordSkip(stats, "same-state");
      return false;
    }
    if (simulator.dominates(bestRecord.summary, summary)) {
      if (stats && Number(((bestRecord.summary.progress || {}).stageIndex) || 0) < Number((summary.progress || {}).stageIndex || 0)) {
        stats.suspicious.higherStageDominatedByLowerStage += 1;
      }
      recordSkip(stats, "best-dominates");
      recordFloor(stats, state, "dominated");
      recordActionStat(stats, state.__sourceAction, "dominated");
      return false;
    }
  }
  const bucketKey = simulator.buildDominanceBucketKey(state);
  const bucket = dominanceBuckets.get(bucketKey) || [];

  for (const record of bucket) {
    if (record.stateKey === stateKey) {
      if (simulator.compareRanks(record.rank, rank) >= 0) {
        recordSkip(stats, "same-state");
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
  return true;
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
  const stats = {
    registered: 0,
    skipped: {},
    trimmed: 0,
    generated: 0,
    byActionType: {},
    byFloor: {},
    byStage: {},
    pruneReasons: {},
    suspicious: {
      higherStageDominatedByLowerStage: 0,
      progressActionTrimmed: 0,
      goalCandidateGeneratedButDropped: 0,
      fallbackUsedWhenStrictGoalRequired: 0,
    },
  };
  config.__stats = stats;
  let bestSeenState = initialState;
  let bestProgressState = initialState;
  let goalState = null;
  let expansions = 0;

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
    if (compareProgress(state, bestProgressState) > 0) {
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
    actions.forEach((action) => {
      stats.generated += 1;
      recordFloor(stats, state, "generated");
      recordActionStat(stats, action, "expanded");
      const nextState = simulator.applyAction(state, action);
      nextState.__sourceAction = action;
      if (!registerState(simulator, activeRecords, dominanceBuckets, bestByDominanceKey, expandedStateKeys, nextState, stats, config)) return;
      delete nextState.__sourceAction;
      if (compareFrontierStates(simulator, config, nextState, bestSeenState) > 0) {
        bestSeenState = nextState;
      }
      if (compareProgress(nextState, bestProgressState) > 0) {
        bestProgressState = nextState;
      }
      frontier.push(nextState);
    });

    const trimmedFrontier = trimFrontier(simulator, frontier, config);
    if (trimmedFrontier !== frontier) {
      const rebuilt = rebuildFrontierState(simulator, trimmedFrontier, expandedStateKeys, config);
      frontier.length = 0;
      frontier.push(...rebuilt.frontier);
      activeRecords = rebuilt.activeRecords;
      dominanceBuckets = rebuilt.dominanceBuckets;
      bestByDominanceKey = rebuilt.bestByDominanceKey;
    }
  }

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
      pruneReasons: stats.pruneReasons,
      suspicious: stats.suspicious,
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
