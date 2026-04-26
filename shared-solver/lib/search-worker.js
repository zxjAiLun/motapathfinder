"use strict";

const { parentPort, workerData } = require("node:worker_threads");
const { FunctionBackedBattleResolver } = require("./battle-resolver");
const { loadProject } = require("./project-loader");
const { normalizeActionEntry } = require("./search-nodes");
const { createSearchProfile } = require("./search-profiles");
const { getDecisionDepth } = require("./state");
const { StaticSimulator } = require("./simulator");
const { buildStateKey } = require("./state-key");

const project = loadProject(workerData.projectRoot);
const simulator = new StaticSimulator(project, {
  stopFloorId: workerData.stopFloorId,
  battleResolver: new FunctionBackedBattleResolver(project, {
    enableBattleEstimateCache: workerData.enableBattleEstimateCache !== false,
    battleEstimateCacheLimit: workerData.battleEstimateCacheLimit,
  }),
  autoPickupEnabled: workerData.autoPickupEnabled !== false,
  autoBattleEnabled: workerData.autoBattleEnabled !== false,
  enableFightToLevelUp: Boolean(workerData.enableFightToLevelUp),
  enableResourcePocket: Boolean(workerData.enableResourcePocket),
  enableResourceChain: Boolean(workerData.enableResourceChain),
  enableResourceCluster: Boolean(workerData.enableResourceCluster),
  searchGraphMode: workerData.searchGraphMode || workerData.searchGraph,
  primitiveFallbackMode: workerData.primitiveFallbackMode,
  resourcePocketSearchOptions: workerData.resourcePocketSearchOptions,
  resourceChainOptions: workerData.resourceChainOptions,
  resourceClusterOptions: workerData.resourceClusterOptions,
  enableActionExpansionCache: workerData.enableActionExpansionCache !== false,
  actionExpansionCacheLimit: workerData.actionExpansionCacheLimit,
});

const profile = workerData.profileName
  ? createSearchProfile(workerData.profileName, simulator, {
      targetFloorId: workerData.targetFloorId || workerData.stopFloorId,
      maxActionsPerState: workerData.maxActionsPerState,
      perStateLimit: workerData.perStateLimit,
    })
  : null;

const actionAllowlist = Array.isArray(workerData.actionAllowlist) && workerData.actionAllowlist.length > 0
  ? new Set(workerData.actionAllowlist)
  : null;
const floorScope = Array.isArray(workerData.floorScope) && workerData.floorScope.length > 0
  ? new Set(workerData.floorScope)
  : null;
const regionScopes = Array.isArray(workerData.regionScopes) ? workerData.regionScopes : [];

function actionAllowed(action) {
  return !actionAllowlist || actionAllowlist.has(action.kind);
}

function stateInRegionScope(state) {
  if (regionScopes.length === 0) return true;
  const loc = (state.hero || {}).loc || {};
  const matchingRegions = regionScopes.filter((region) => region.floorId === state.floorId);
  if (matchingRegions.length === 0) return true;
  return matchingRegions.some((region) => (
    Number(loc.x) >= region.x1 && Number(loc.x) <= region.x2 &&
    Number(loc.y) >= region.y1 && Number(loc.y) <= region.y2
  ));
}

function stateAllowed(state) {
  if (floorScope && !floorScope.has(state.floorId)) return false;
  return stateInRegionScope(state);
}

function selectActions(state, actions) {
  if (workerData.maxDepth != null && getDecisionDepth(state) >= Number(workerData.maxDepth)) return [];
  if (profile && typeof profile.selectStateActions === "function") {
    return profile.selectStateActions(state, actions, {
      maxActionsPerState: workerData.maxActionsPerState != null ? Number(workerData.maxActionsPerState) : profile.maxActionsPerState,
    });
  }
  if (workerData.maxActionsPerState != null) return actions.slice(0, Number(workerData.maxActionsPerState));
  return actions;
}

function expandNode(node) {
  const enumerateStartedAt = Date.now();
  const graph = {
    mode: workerData.searchGraphMode || workerData.searchGraph || "hybrid",
    statesWithMacroActions: 0,
    primitiveFallbackStates: 0,
    primitiveActionsSuppressed: 0,
    expandedByKind: {},
  };
  const allActions = simulator.enumerateActions(node.state, {
    searchGraphMode: workerData.searchGraphMode || workerData.searchGraph,
    primitiveFallbackMode: workerData.primitiveFallbackMode,
    graphStats: graph,
  });
  const actions = selectActions(node.state, allActions);
  const enumerateMs = Date.now() - enumerateStartedAt;
  const candidates = [];
  const stats = { actionFiltered: 0, scopeFiltered: 0, enumerateMs, applyMs: 0, graph };
  for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
    const action = actions[actionIndex];
    if (!actionAllowed(action)) {
      stats.actionFiltered += 1;
      continue;
    }
    try {
      const applyStartedAt = Date.now();
      const nextState = simulator.applyAction(node.state, action, { storeRoute: false });
      stats.applyMs += Date.now() - applyStartedAt;
      if (!stateAllowed(nextState)) {
        stats.scopeFiltered += 1;
        continue;
      }
      candidates.push({
        parentId: node.nodeId,
        parentOrder: node.order,
        parentDepth: node.depth,
        actionIndex,
        actionEntry: normalizeActionEntry(action),
        state: nextState,
        stateKey: buildStateKey(nextState),
        floorId: nextState.floorId,
      });
    } catch (error) {
      candidates.push({
        parentId: node.nodeId,
        parentOrder: node.order,
        parentDepth: node.depth,
        actionIndex,
        invalid: true,
        error: error && error.message ? error.message : String(error),
      });
    }
  }
  return { candidates, stats };
}

function diffCacheStats(before, after) {
  const result = {};
  const keys = new Set([
    ...Object.keys(before || {}),
    ...Object.keys(after || {}),
  ]);
  keys.forEach((key) => {
    if (["size", "hitRate", "avgComputeMs", "avgMsSaved"].includes(key)) return;
    const beforeValue = before ? before[key] : undefined;
    const afterValue = after ? after[key] : undefined;
    if (typeof afterValue === "number") {
      const diff = afterValue - (typeof beforeValue === "number" ? beforeValue : 0);
      if (diff !== 0) result[key] = diff;
      return;
    }
    if (afterValue && typeof afterValue === "object" && !Array.isArray(afterValue)) {
      const child = diffCacheStats(
        beforeValue && typeof beforeValue === "object" ? beforeValue : {},
        afterValue
      );
      if (Object.keys(child).length > 0) result[key] = child;
    }
  });
  return result;
}

function mergeNumeric(target, source) {
  if (!source || typeof source !== "object") return target;
  Object.entries(source).forEach(([key, value]) => {
    if (key === "mode") {
      target.mode = value;
      return;
    }
    if (typeof value === "number") {
      target[key] = Number(target[key] || 0) + value;
      return;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (!target[key] || typeof target[key] !== "object" || Array.isArray(target[key])) target[key] = {};
      mergeNumeric(target[key], value);
    }
  });
  return target;
}

parentPort.on("message", (message) => {
  if (!message || message.type !== "expandBatch") return;
  try {
    const beforeCacheStats = typeof simulator.getActionExpansionCacheStats === "function"
      ? simulator.getActionExpansionCacheStats()
      : null;
    const candidates = [];
    let expanded = 0;
    let actionFiltered = 0;
    let scopeFiltered = 0;
    let enumerateMs = 0;
    let applyMs = 0;
    const graph = {
      mode: workerData.searchGraphMode || workerData.searchGraph || "hybrid",
      statesWithMacroActions: 0,
      primitiveFallbackStates: 0,
      primitiveActionsSuppressed: 0,
      expandedByKind: {},
    };
    for (const node of message.nodes || []) {
      const expandedNode = expandNode(node);
      candidates.push(...expandedNode.candidates);
      actionFiltered += expandedNode.stats.actionFiltered;
      scopeFiltered += expandedNode.stats.scopeFiltered;
      enumerateMs += expandedNode.stats.enumerateMs;
      applyMs += expandedNode.stats.applyMs;
      mergeNumeric(graph, expandedNode.stats.graph);
      expanded += 1;
    }
    const afterCacheStats = typeof simulator.getActionExpansionCacheStats === "function"
      ? simulator.getActionExpansionCacheStats()
      : null;
    parentPort.postMessage({
      jobId: message.jobId,
      candidates,
      stats: {
        expanded,
        generated: candidates.length,
        actionFiltered,
        scopeFiltered,
        enumerateMs,
        applyMs,
        graph,
        cacheStats: diffCacheStats(beforeCacheStats, afterCacheStats),
      },
    });
  } catch (error) {
    parentPort.postMessage({
      jobId: message.jobId,
      error: error && error.stack ? error.stack : String(error),
    });
  }
});
