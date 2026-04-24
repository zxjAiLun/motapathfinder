"use strict";

const { buildDominanceKey, buildStateKey } = require("./state-key");
const { getDecisionDepth } = require("./state");

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
  let actions = simulator.enumerateActions(state);
  if (options && typeof options.sortStateActions === "function") {
    actions = options.sortStateActions(state, actions.slice());
  }
  if (options && options.maxActionsPerState != null) {
    actions = actions.slice(0, Number(options.maxActionsPerState));
  }
  return actions;
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
    if (!registerState(simulator, activeRecords, dominanceBuckets, bestByDominanceKey, expandedStateKeys, state)) return;
    rebuiltFrontier.push(state);
  });

  return {
    activeRecords,
    bestByDominanceKey,
    dominanceBuckets,
    frontier: rebuiltFrontier,
  };
}

function registerState(simulator, activeRecords, dominanceBuckets, bestByDominanceKey, expandedStateKeys, state, stats) {
  const score = simulator.score(state);
  const rank = createRank(simulator, state, score);
  const stateKey = buildStateKey(state);
  if (expandedStateKeys.has(stateKey)) {
    recordSkip(stats, "expanded");
    return false;
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
      recordSkip(stats, "best-dominates");
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
      recordSkip(stats, "bucket-dominates");
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
  };
  config.__stats = stats;
  let bestSeenState = initialState;
  let expansions = 0;

  registerState(simulator, activeRecords, dominanceBuckets, bestByDominanceKey, expandedStateKeys, initialState, stats);

  while (frontier.length > 0 && expansions < maxExpansions) {
    sortFrontier(simulator, frontier, config);
    const state = frontier.shift();
    const stateKey = buildStateKey(state);
    if (!activeRecords.has(stateKey)) continue;
    activeRecords.delete(stateKey);
    expandedStateKeys.add(stateKey);
    expansions += 1;
    if (compareFrontierStates(simulator, config, state, bestSeenState) > 0) {
      bestSeenState = state;
    }

    if (simulator.isTerminal(state)) {
      results.push(state);
      results.sort((left, right) => simulator.compareResultStates(right, left));
      if (results.length > (config.topK || 3)) results.length = config.topK || 3;
      continue;
    }

    const actions = getStateActions(simulator, config, state);
    actions.forEach((action) => {
      const nextState = simulator.applyAction(state, action);
      if (!registerState(simulator, activeRecords, dominanceBuckets, bestByDominanceKey, expandedStateKeys, nextState, stats)) return;
      if (compareFrontierStates(simulator, config, nextState, bestSeenState) > 0) {
        bestSeenState = nextState;
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
    bestSeenState,
    expansions,
    frontierSize: frontier.length,
    diagnostics: {
      registered: stats.registered,
      skipped: stats.skipped,
      trimmed: stats.trimmed,
    },
    results,
  };
}

module.exports = {
  searchTopK,
};
