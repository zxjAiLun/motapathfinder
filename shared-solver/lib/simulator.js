"use strict";

const { applyPickup } = require("./effect-vm");
const { AutoActionResolver } = require("./auto-actions");
const { EquipmentResolver } = require("./equipment-resolver");
const { EventResolver } = require("./event-resolver");
const { evaluateExpression } = require("./expression");
const { applyFloorArrival, executeActionList, runAutoEvents } = require("./events");
const { resolveChangeFloorTarget } = require("./floor-transitions");
const { computeFrontierFeatures } = require("./frontier-features");
const { scoutChangeFloor } = require("./floor-scout");
const { createResourceLookaheadCache, evaluateActionResourceLookahead } = require("./resource-lookahead");
const { enumerateResourceClusterActions } = require("./resource-cluster");
const { buildSearchConfluenceKey: buildSharedSearchConfluenceKey, compareConfluenceResources } = require("./confluence-key");
const { DIRECTIONS, DIRECTION_DELTAS, coordinateKey, isDoorTile, isEnemyTile } = require("./reachability");
const { UnsupportedBattleResolver } = require("./battle-resolver");
const { buildDominanceBucketKey, buildDominanceSummary, dominatesSummary } = require("./dominance");
const { GenericDoorResolver } = require("./door-resolver");
const { compareScore, compareSearchRank, defaultScore, defaultSearchRank, getFloorOrder } = require("./score");
const { buildStateKey } = require("./state-key");
const { getFrontierFeatures, getScore, getSearchRank } = require("./search-cache");
const { buildWalkReachability, stepOntoTile } = require("./step-simulator");
const { ToolRegistry } = require("./tool-registry");
const { syncProgress } = require("./progress");
const {
  appendRouteStep,
  cloneState,
  createInitialState,
  getDecisionDepth,
  getTileDefinitionAt,
  getInventoryCount,
  removeTileAt,
} = require("./state");

function keepShortestAction(actionsByKey, key, action) {
  const existing = actionsByKey.get(key);
  if (!existing) {
    actionsByKey.set(key, action);
    return;
  }
  const existingHp = Number((existing.travelState || {}).hero ? existing.travelState.hero.hp : 0);
  const actionHp = Number((action.travelState || {}).hero ? action.travelState.hero.hp : 0);
  if (actionHp > existingHp || (actionHp === existingHp && existing.path.length > action.path.length)) {
    actionsByKey.set(key, action);
  }
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

function stableFloorState(floorState) {
  const removed = Object.keys((floorState || {}).removed || {}).sort();
  const replaced = Object.keys((floorState || {}).replaced || {})
    .sort()
    .map((key) => `${key}:${floorState.replaced[key]}`);
  return { removed, replaced };
}

function compareNumbersDescending(left, right) {
  const diff = Number(right || 0) - Number(left || 0);
  if (diff !== 0) return diff;
  return 0;
}

function compareInventoryDominance(leftInventory, rightInventory) {
  const itemIds = Object.keys({ ...(leftInventory || {}), ...(rightInventory || {}) });
  let leftDominates = true;
  let rightDominates = true;
  itemIds.forEach((itemId) => {
    const left = Number((leftInventory || {})[itemId] || 0);
    const right = Number((rightInventory || {})[itemId] || 0);
    if (left < right) leftDominates = false;
    if (right < left) rightDominates = false;
  });
  if (leftDominates && !rightDominates) return -1;
  if (rightDominates && !leftDominates) return 1;
  return 0;
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function findAdjacencyActions(project, reachability, predicate, buildAction) {
  const actionsByKey = new Map();

  Object.values(reachability.visited).forEach((node) => {
    DIRECTIONS.forEach((direction) => {
      const delta = DIRECTION_DELTAS[direction];
      const targetX = node.x + delta.x;
      const targetY = node.y + delta.y;
      const tile = getTileDefinitionAt(project, node.state, node.state.floorId, targetX, targetY);
      if (!predicate(node, tile, targetX, targetY)) return;

      const built = buildAction(node, direction, targetX, targetY, tile, node.path, node.state);
      const builtActions = Array.isArray(built) ? built : [built];
      builtActions.filter(Boolean).forEach((action) => {
        const stateKey = buildStateKey(action.travelState || node.state);
        keepShortestAction(actionsByKey, `${targetX},${targetY}:${action.kind}:${action.summary || ""}:${stateKey}`, action);
      });
    });
  });

  return Array.from(actionsByKey.values());
}

function containsComplexDominanceFeature(value) {
  if (value == null) return false;
  if (Array.isArray(value)) return value.some((item) => containsComplexDominanceFeature(item));
  if (typeof value === "object") {
    return Object.entries(value).some(([key, child]) => {
      if (["choices", "shop", "condition", "status", "setValue", "setHero", "setEnemy", "if", "switch", "while"].includes(key)) return true;
      if (key === "type" && ["choices", "shop", "if", "confirm", "input", "setValue", "setHero", "setEnemy"].includes(child)) return true;
      return containsComplexDominanceFeature(child);
    });
  }
  if (typeof value !== "string") return false;
  return /core\.(status|openShop|insertAction|setValue|setHero|setEnemy)|\b(shop|choices|condition|if)\b/.test(value);
}

function buildUnsafeDominanceFloors(project) {
  const floors = new Set();
  Object.values((project || {}).floorsById || {}).forEach((floor) => {
    const complex = [
      floor.autoEvent,
      floor.events,
      floor.beforeBattle,
      floor.afterBattle,
      floor.afterGetItem,
      floor.afterOpenDoor,
      floor.firstArrive,
      floor.eachArrive,
      floor.parallelDo,
    ].some((section) => containsComplexDominanceFeature(section));
    if (complex) floors.add(floor.floorId);
  });
  return floors;
}


class StaticSimulator {
  constructor(project, options) {
    const config = options || {};
    this.project = project;
    this.unsafeDominanceFloors = buildUnsafeDominanceFloors(project);
    this.stopFloorId = config.stopFloorId || "MT11";
    this.scoreFn = config.scoreFn || defaultScore;
    this.searchRankFn = config.searchRankFn || defaultSearchRank;
    this.dominanceBucketKeyFn = config.dominanceBucketKeyFn || buildDominanceBucketKey;
    this.dominanceSummaryFn = config.dominanceSummaryFn || buildDominanceSummary;
    this.dominatesFn = config.dominatesFn || dominatesSummary;
    this.battleResolver = config.battleResolver || new UnsupportedBattleResolver();
    this.doorResolver = config.doorResolver || new GenericDoorResolver();
    this.equipmentResolver = config.equipmentResolver || new EquipmentResolver();
    this.eventResolver = config.eventResolver || new EventResolver({
      includeUnsupportedExperiments: config.includeUnsupportedEventExperiments,
    });
    this.toolRegistry = config.toolRegistry || new ToolRegistry();
    this.autoResolver = config.autoResolver || new AutoActionResolver({
      autoPickupEnabled: config.autoPickupEnabled,
      autoBattleEnabled: config.autoBattleEnabled,
      repeatUntilStable: config.autoRepeatUntilStable !== false,
    });
    this.choiceResolver = config.choiceResolver;
    this.enableFightToLevelUp = Boolean(config.enableFightToLevelUp);
    this.enableResourcePocket = Boolean(config.enableResourcePocket);
    this.enableResourceChain = Boolean(config.enableResourceChain);
    this.enableResourceCluster = Boolean(config.enableResourceCluster);
    this.searchGraphMode = config.searchGraphMode || config.searchGraph || "hybrid";
    this.primitiveFallbackMode = config.primitiveFallbackMode || "auto";
    this.resourcePocketSearchOptions = config.resourcePocketSearchOptions || {};
    this.resourceClusterOptions = config.resourceClusterOptions || {};
    this.resourceClusterStats = {
      enabled: Boolean(config.enableResourceCluster),
      clustersEnumerated: 0,
      dpStates: 0,
      skylineRejected: 0,
      skylineReplaced: 0,
      actionsOutput: 0,
      examples: [],
    };
    this.enableActionExpansionCache = config.enableActionExpansionCache !== false;
    this.actionExpansionCacheLimit = Number(config.actionExpansionCacheLimit || 1024);
    this.actionExpansionCaches = {
      reachability: new Map(),
      primitiveActions: new Map(),
      resourceCluster: new Map(),
      resourcePreviewApply: new Map(),
      resourceLookahead: createResourceLookaheadCache(),
      searchConfluence: new Map(),
    };
    this.actionExpansionCacheStats = Object.keys(this.actionExpansionCaches).reduce((stats, name) => {
      stats[name] = { hits: 0, misses: 0, stores: 0, evictions: 0 };
      return stats;
    }, {});
  }

  cacheLimitFor(name) {
    if (name === "resourcePreviewApply") return Math.max(64, this.actionExpansionCacheLimit * 4);
    if (name === "searchConfluence") return Math.max(64, this.actionExpansionCacheLimit * 4);
    return this.actionExpansionCacheLimit;
  }

  cacheGet(name, key, cloneValue) {
    if (!this.enableActionExpansionCache || !key) return undefined;
    const cache = this.actionExpansionCaches[name];
    const stats = this.actionExpansionCacheStats[name];
    if (!cache || !cache.has(key)) {
      if (stats) stats.misses += 1;
      return undefined;
    }
    const value = cache.get(key);
    cache.delete(key);
    cache.set(key, value);
    if (stats) stats.hits += 1;
    return typeof cloneValue === "function" ? cloneValue(value) : value;
  }

  cacheSet(name, key, value, cloneValue) {
    if (!this.enableActionExpansionCache || !key) return value;
    const cache = this.actionExpansionCaches[name];
    const stats = this.actionExpansionCacheStats[name];
    if (!cache) return value;
    cache.set(key, typeof cloneValue === "function" ? cloneValue(value) : value);
    if (stats) stats.stores += 1;
    const limit = this.cacheLimitFor(name);
    while (limit > 0 && cache.size > limit) {
      const firstKey = cache.keys().next().value;
      cache.delete(firstKey);
      if (stats) stats.evictions += 1;
    }
    return value;
  }

  getActionExpansionCacheStats() {
    const stats = cloneJson(this.actionExpansionCacheStats);
    Object.entries(this.actionExpansionCaches || {}).forEach(([name, cache]) => {
      if (!stats[name]) stats[name] = { hits: 0, misses: 0, stores: 0, evictions: 0 };
      stats[name].size = cache.size;
    });
    if (this.battleResolver && typeof this.battleResolver.getCacheStats === "function") {
      stats.battleResolver = this.battleResolver.getCacheStats();
    }
    stats.resourceClusterDiagnostics = this.getResourceClusterDiagnostics();
    return stats;
  }

  getResourceClusterDiagnostics() {
    return cloneJson(this.resourceClusterStats || {});
  }

  getWalkReachability(state) {
    const key = buildStateKey(state);
    const cached = this.cacheGet("reachability", key);
    if (cached) return cached;
    const reachability = buildWalkReachability(this.project, state, {
      battleResolver: this.battleResolver,
      executeActionList,
      choiceResolver: this.choiceResolver,
      stabilizeState: (nextState) => this.stabilizeState(nextState),
    });
    return this.cacheSet("reachability", key, reachability);
  }

  clonePrimitiveActions(value) {
    return cloneState(value);
  }

  createInitialState(options) {
    const state = createInitialState(this.project, options);
    this.autoResolver.initializeFlags(state);
    applyFloorArrival(this.project, state, state.floorId, { choiceResolver: this.choiceResolver });
    return this.stabilizeState(state);
  }

  isTerminal(state) {
    return state.floorId === this.stopFloorId;
  }

  score(state) {
    return this.scoreFn(state);
  }

  compareRanks(left, right) {
    const scoreDiff = compareScore(left.score, right.score);
    if (scoreDiff !== 0) return scoreDiff;
    if (left.decisionDepth !== right.decisionDepth) return right.decisionDepth - left.decisionDepth;
    return right.routeLength - left.routeLength;
  }

  compareResultStates(left, right) {
    return this.compareRanks(
      { score: getScore(this, left), decisionDepth: getDecisionDepth(left), routeLength: Array.isArray(left.route) && left.route.length > 0 ? left.route.length : getDecisionDepth(left) },
      { score: getScore(this, right), decisionDepth: getDecisionDepth(right), routeLength: Array.isArray(right.route) && right.route.length > 0 ? right.route.length : getDecisionDepth(right) }
    );
  }

  compareSearchStates(left, right) {
    const leftScore = getScore(this, left);
    const rightScore = getScore(this, right);
    return compareSearchRank(
      getSearchRank(this, left, leftScore, { project: this.project, battleResolver: this.battleResolver }),
      getSearchRank(this, right, rightScore, { project: this.project, battleResolver: this.battleResolver })
    );
  }

  compareStates(left, right) {
    return this.compareSearchStates(left, right);
  }

  getFrontierBucketKey(state) {
    const features = getFrontierFeatures(this.project, state, { battleResolver: this.battleResolver });
    return `${features.regionKey}|band:${features.targetBandKey}`;
  }

  buildDominanceBucketKey(state) {
    return this.dominanceBucketKeyFn(state);
  }

  buildDominanceSummary(state, score) {
    return this.dominanceSummaryFn(state, score);
  }

  dominates(leftSummary, rightSummary) {
    return this.dominatesFn(leftSummary, rightSummary);
  }

  requiresExactDominance(state) {
    return Boolean(state && this.unsafeDominanceFloors && this.unsafeDominanceFloors.has(state.floorId));
  }

  enumeratePrimitiveActions(state) {
    const cacheKey = buildStateKey(state);
    const cached = this.cacheGet("primitiveActions", cacheKey, (value) => this.clonePrimitiveActions(value));
    if (cached) return cached;
    const floor = this.project.floorsById[state.floorId];
    const reachability = this.getWalkReachability(state);
    const actions = [];
    const helper = {
      findAdjacencyActions: (predicate, buildAction) =>
        findAdjacencyActions(this.project, reachability, predicate, buildAction),
    };

    actions.push(
      ...helper.findAdjacencyActions(
        (node, tile) => tile && tile.cls === "items",
        (node, direction, targetX, targetY, tile, path, nodeState) => ({
          kind: "pickup",
          floorId: nodeState.floorId,
          stance: { x: node.x, y: node.y },
          direction,
          x: targetX,
          y: targetY,
          path,
          travelState: nodeState,
          summary: `pickup:${tile.id}@${nodeState.floorId}:${targetX},${targetY}`,
        })
      )
    );

    actions.push(
      ...helper.findAdjacencyActions(
        (node, tile, targetX, targetY) => Boolean((floor.changeFloor || {})[coordinateKey(targetX, targetY)]),
        (node, direction, targetX, targetY, tile, path, nodeState) => ({
          kind: "changeFloor",
          floorId: nodeState.floorId,
          stance: { x: node.x, y: node.y },
          direction,
          x: targetX,
          y: targetY,
          path,
          travelState: nodeState,
          changeFloor: (floor.changeFloor || {})[coordinateKey(targetX, targetY)],
          summary: `changeFloor@${nodeState.floorId}:${targetX},${targetY}`,
        })
      )
    );

    actions.push(...this.doorResolver.enumerateActions({ project: this.project, state, reachability, helper }));
    actions.push(...this.equipmentResolver.enumerateActions({ project: this.project, state, floor, reachability, helper }));
    actions.push(...this.eventResolver.enumerateActions({ project: this.project, state, floor, reachability, helper }));
    actions.push(...this.toolRegistry.enumerateActions({ project: this.project, state, floor, reachability, helper }));

    const battleActions = this.battleResolver.enumerateActions({
      project: this.project,
      state,
      reachability,
    });
    actions.push(...battleActions);

    const result = { actions, battleActions };
    return this.cacheSet("primitiveActions", cacheKey, result, (value) => this.clonePrimitiveActions(value));
  }

  enumerateMacroActions(state, primitiveActions, battleActions) {
    const actions = [];
    const sourceActions = primitiveActions || [];
    const sourceBattleActions = battleActions || sourceActions.filter((action) => action.kind === "battle");

    if (this.enableFightToLevelUp) {
      const fightToLevelUpAction = this.enumerateFightToLevelUpAction(state, sourceBattleActions);
      if (fightToLevelUpAction) actions.push(fightToLevelUpAction);
    }
    if (this.enableResourceCluster) {
      actions.push(...this.enumerateResourceClusterActions(state, sourceActions));
    }
    if (this.enableResourcePocket && this.shouldEnumerateResourcePocket(state, sourceActions.concat(actions))) {
      actions.push(...this.enumerateResourcePocketActions(state, sourceActions.concat(actions)));
    }
    if (this.enableResourceChain) actions.push(...this.enumerateResourceChainActions(state, sourceActions.concat(actions)));
    return actions;
  }

  isMacroGraphPrimitiveAction(action) {
    if (!action) return false;
    if (action.kind === "battle") return false;
    return true;
  }

  selectGraphActions(state, primitiveActions, macroActions, options) {
    const config = options || {};
    const mode = config.searchGraphMode || config.searchGraph || this.searchGraphMode || "hybrid";
    const graphStats = config.graphStats || config.__graphStats;
    const primitives = primitiveActions || [];
    const macros = macroActions || [];
    if (graphStats) graphStats.mode = mode;
    if (mode === "primitive") return primitives;
    if (mode !== "macro") return primitives.concat(macros);

    const nonBattlePrimitives = primitives.filter((action) => this.isMacroGraphPrimitiveAction(action));
    const selected = nonBattlePrimitives.concat(macros);
    if (graphStats && macros.length > 0) graphStats.statesWithMacroActions += 1;
    const suppressed = primitives.length - nonBattlePrimitives.length;
    const shouldFallback = selected.length === 0 && (config.primitiveFallbackMode || this.primitiveFallbackMode) !== "off";
    if (shouldFallback) {
      if (graphStats) graphStats.primitiveFallbackStates += 1;
      return primitives.concat(macros);
    }
    if (graphStats && suppressed > 0) graphStats.primitiveActionsSuppressed += suppressed;
    return selected;
  }

  enumerateActions(state, options) {
    const primitive = this.enumeratePrimitiveActions(state);
    const macroActions = this.enumerateMacroActions(state, primitive.actions, primitive.battleActions);
    const actions = this.selectGraphActions(state, primitive.actions, macroActions, options);

    return this.sortActions(state, actions);
  }

  enumerateResourceChainActions(state, actions) {
    if (getFloorOrder(state.floorId) !== 2) return [];
    const cache = this.actionExpansionCaches.resourceLookahead || createResourceLookaheadCache();
    return (actions || [])
      .filter((action) => action.kind === "battle" || action.kind === "equip")
      .map((action) => {
        const preview = evaluateActionResourceLookahead(this, state, action, {
          cache,
          maxDepth: 9,
          maxNodes: 24,
          branchLimit: 4,
          frontierLimit: 8,
          includeResourcePocket: false,
          includeFightToLevelUp: false,
        });
        if (!preview || !preview.valid || Number(preview.score || 0) < 180000) return null;
        const planEntries = preview.bestPlanEntries || [];
        if (planEntries.length <= 1) return null;
        return {
          kind: "resourceChain",
          floorId: state.floorId,
          path: [],
          plan: planEntries.map((entry) => entry.summary),
          planEntries,
          estimate: {
            ...preview.delta,
            hpAfter: preview.bestStateSummary && preview.bestStateSummary.hp,
            score: preview.score,
            gainedEquipment: preview.gainedEquipment,
            openedResourceChain: preview.openedResourceChain,
            reachedForwardFloor: preview.reachedForwardFloor,
            returnedToPreviousFloor: preview.returnedToPreviousFloor,
          },
          summary: `resourceChain:${state.floorId}:${planEntries.length}steps:${planEntries[0].summary}`,
        };
      })
      .filter(Boolean)
      .sort((left, right) => Number((right.estimate || {}).score || 0) - Number((left.estimate || {}).score || 0))
      .slice(0, 3);
  }

  enumerateResourceClusterActions(state, actions) {
    const key = this.buildResourceClusterCacheKey(state, actions);
    const cached = this.cacheGet("resourceCluster", key, cloneJson);
    if (cached) return cached;
    const result = enumerateResourceClusterActions(this, state, actions, {
      ...this.resourceClusterOptions,
      diagnostics: this.resourceClusterStats,
    });
    return this.cacheSet("resourceCluster", key, result, cloneJson);
  }

  buildResourceClusterCacheKey(state, actions) {
    const hero = state.hero || {};
    const actionKey = (actions || [])
      .filter((action) => action && (action.kind === "battle" || action.kind === "pickup" || action.kind === "equip" || action.kind === "event"))
      .map((action) => this.getActionFingerprint(action) || action.summary || action.kind)
      .sort()
      .join("|");
    return JSON.stringify({
      floorId: state.floorId,
      loc: hero.loc ? { x: hero.loc.x, y: hero.loc.y } : null,
      hp: Number(hero.hp || 0),
      combat: this.getCombatSignature(state),
      equipment: Array.isArray(hero.equipment) ? hero.equipment.slice().sort() : [],
      inventory: stableObject(state.inventory),
      flags: stableObject(state.flags),
      localMutations: stableFloorState(((state.floorStates || {})[state.floorId]) || {}),
      actions: actionKey,
    });
  }

  summarizeResourceDelta(before, after) {
    const inventoryDelta = Object.keys({ ...(before.inventory || {}), ...(after.inventory || {}) })
      .sort()
      .reduce((result, itemId) => {
        const delta = Number((after.inventory || {})[itemId] || 0) - Number((before.inventory || {})[itemId] || 0);
        if (delta !== 0) result[itemId] = delta;
        return result;
      }, {});
    return {
      hp: Number((after.hero || {}).hp || 0) - Number((before.hero || {}).hp || 0),
      atk: Number((after.hero || {}).atk || 0) - Number((before.hero || {}).atk || 0),
      def: Number((after.hero || {}).def || 0) - Number((before.hero || {}).def || 0),
      mdef: Number((after.hero || {}).mdef || 0) - Number((before.hero || {}).mdef || 0),
      money: Number((after.hero || {}).money || 0) - Number((before.hero || {}).money || 0),
      exp: Number((after.hero || {}).exp || 0) - Number((before.hero || {}).exp || 0),
      lv: Number((after.hero || {}).lv || 0) - Number((before.hero || {}).lv || 0),
      inventory: inventoryDelta,
    };
  }

  scoreResourceDelta(delta) {
    const inventoryGain = Object.values(delta.inventory || {}).reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0);
    return (
      delta.hp * 0.2 +
      delta.atk * 1200 +
      delta.def * 1000 +
      delta.mdef * 220 +
      delta.exp * 700 +
      delta.money * 25 +
      delta.lv * 200000 +
      inventoryGain * 400
    );
  }

  isPocketPrimitiveAction(action) {
    return Boolean(action) && (
      action.kind === "battle" ||
      action.kind === "openDoor" ||
      action.kind === "useTool" ||
      action.kind === "pickup" ||
      action.kind === "equip" ||
      (action.kind === "event" && action.hasStateChange)
    );
  }

  shouldEnumerateResourcePocket(state, actions) {
    if ((actions || []).some((action) => this.isForwardChangeFloorAction(state, action))) return false;
    const floorOrder = getFloorOrder(state.floorId);
    const levelValue = Number((state.hero || {}).lv || 0);
    if (floorOrder < 2 && levelValue >= 3) return false;
    const level = this.getNextLevelInfo(state);
    if (level && Number(level.deficit || 0) <= (floorOrder >= 2 ? 30 : 12)) return true;
    return floorOrder >= 2 && (actions || []).some((action) => action.kind === "openDoor" || action.kind === "useTool");
  }

  isForwardChangeFloorAction(state, action) {
    if (!action || action.kind !== "changeFloor") return false;
    const currentFloorOrder = getFloorOrder(state.floorId);
    const targetFloorId = action.changeFloor && action.changeFloor.floorId;
    if (targetFloorId === ":next") return true;
    return getFloorOrder(targetFloorId) > currentFloorOrder;
  }

  getForwardChangeFloorActions(state) {
    return this.enumeratePrimitiveActions(state).actions.filter((action) => this.isForwardChangeFloorAction(state, action));
  }

  summarizePocketPreparation(baseState, planState) {
    let baseAction = null;
    let planAction = null;
    try {
      baseAction = this.getForwardChangeFloorActions(baseState)[0] || null;
    } catch (error) {
      baseAction = null;
    }
    try {
      planAction = this.getForwardChangeFloorActions(planState)[0] || null;
    } catch (error) {
      planAction = null;
    }
    if (!baseAction && !planAction) return null;
    let baseScout = null;
    let planScout = null;
    try {
      if (baseAction) baseScout = scoutChangeFloor(this, baseState, baseAction);
    } catch (error) {
      baseScout = null;
    }
    try {
      if (planAction) planScout = scoutChangeFloor(this, planState, planAction);
    } catch (error) {
      planScout = null;
    }
    const edge = `${baseState.floorId}->${(planScout && planScout.toFloorId) || (baseScout && baseScout.toFloorId) || "unknown"}`;
    const baseDeficits = baseScout && baseScout.deficits || {};
    const planDeficits = planScout && planScout.deficits || {};
    return {
      edge,
      hpDeficitReduced: Math.max(0, Number(baseDeficits.hpDeficit || 0) - Number(planDeficits.hpDeficit || 0)),
      atkDeficitReduced: Math.max(0, Number(baseDeficits.atkDeficit || 0) - Number(planDeficits.atkDeficit || 0)),
      defDeficitReduced: Math.max(0, Number(baseDeficits.defDeficit || 0) - Number(planDeficits.defDeficit || 0)),
      mdefDeficitReduced: Math.max(0, Number(baseDeficits.mdefDeficit || 0) - Number(planDeficits.mdefDeficit || 0)),
      meetsGateRequirement: Boolean(planScout && planScout.verdict && !planScout.verdict.likelyBlocked),
    };
  }

  hasForwardChangeFloorAction(state) {
    return this.getForwardChangeFloorActions(state).length > 0;
  }

  isLargeResourceDelta(delta) {
    const inventoryGain = Object.values(delta.inventory || {}).reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0);
    return (
      Number(delta.lv || 0) > 0 ||
      Number(delta.atk || 0) >= 5 ||
      Number(delta.def || 0) >= 5 ||
      Number(delta.mdef || 0) >= 50 ||
      Number(delta.hp || 0) >= 500 ||
      inventoryGain > 0
    );
  }

  scorePocketCandidate(baseState, currentState, nextState, action) {
    const stepDelta = this.summarizeResourceDelta(currentState, nextState);
    const baseDelta = this.summarizeResourceDelta(baseState, nextState);
    let score = this.scoreResourceDelta(baseDelta) + this.scoreResourceDelta(stepDelta) * 0.4;
    const beforeLevel = Number((currentState.hero || {}).lv || 0);
    const afterLevel = Number((nextState.hero || {}).lv || 0);
    if (afterLevel > beforeLevel) score += 300000 + afterLevel * 20000;

    const beforeNeed = this.getNextLevelInfo(currentState);
    const afterNeed = this.getNextLevelInfo(nextState);
    if (beforeNeed && afterNeed) {
      const deficitClosed = Math.max(0, Number(beforeNeed.deficit || 0) - Number(afterNeed.deficit || 0));
      score += deficitClosed * (Number(beforeNeed.deficit || 0) <= 15 ? 18000 : 8000);
      if (Number(afterNeed.deficit || 0) <= 3) score += 35000;
    }
    if (this.isLargeResourceDelta(stepDelta)) score += 90000;
    if (action.kind === "openDoor") score += 30000;
    if (action.kind === "useTool") score += 22000;
    if (action.kind === "pickup") score += 26000;
    if (action.kind === "equip") score += 18000;
    if (action.kind === "event") score += action.unsupported ? -100000 : (action.hasStateChange ? 38000 : -5000);
    if (action.kind === "battle") {
      score += Number((action.estimate || {}).exp || 0) * 12000;
      score -= Math.min(18000, Number((action.estimate || {}).damage || 0) * 2);
    }
    return score;
  }

  rankPocketActionForPreview(state, action) {
    if (!this.isPocketPrimitiveAction(action)) return Number.NEGATIVE_INFINITY;
    if (action.kind === "pickup") return 70000;
    if (action.kind === "equip") return 60000;
    if (action.kind === "event") return action.unsupported || !action.hasStateChange ? Number.NEGATIVE_INFINITY : 56000;
    if (action.kind === "openDoor") return 50000;
    if (action.kind === "useTool") return 42000;
    if (action.kind === "battle") {
      const exp = Number((action.estimate || {}).exp || 0);
      const damage = Number((action.estimate || {}).damage || 0);
      const level = this.getNextLevelInfo(state);
      const nearLevelBonus = level && level.deficit <= 15 ? exp * 9000 : exp * 3500;
      return 30000 + nearLevelBonus - Math.min(18000, damage * 2);
    }
    return 0;
  }

  summarizePocketStopReason(baseState, currentState, nextState) {
    const delta = this.summarizeResourceDelta(currentState, nextState);
    if (Number((nextState.hero || {}).lv || 0) > Number((baseState.hero || {}).lv || 0)) return "levelUp";
    if (this.hasForwardChangeFloorAction(nextState)) return "forwardChangeFloor";
    if (this.isLargeResourceDelta(delta)) return "keyItem";
    return null;
  }

  getResourcePocketSearchOptions(state, floorOrder) {
    const defaults = floorOrder < 2
      ? {
          maxDepth: 12,
          maxNodes: 500,
          branchLimit: 14,
          frontierLimit: 64,
          resultLimit: 8,
          continueAfterForwardChangeFloor: false,
          preserveConfluenceSkyline: false,
          representativesPerConfluence: 2,
          hpWeight: 24,
          confluenceHpWeight: 80,
        }
      : {
          maxDepth: 8,
          maxNodes: 100,
          branchLimit: 10,
          frontierLimit: 24,
          resultLimit: 8,
          continueAfterForwardChangeFloor: false,
          preserveConfluenceSkyline: true,
          representativesPerConfluence: 2,
          hpWeight: 24,
          confluenceHpWeight: 80,
        };
    const configured = typeof this.resourcePocketSearchOptions === "function"
      ? this.resourcePocketSearchOptions(state, floorOrder, defaults) || {}
      : this.resourcePocketSearchOptions || {};
    const byFloor = (configured.byFloor && configured.byFloor[state.floorId]) || {};
    return { ...defaults, ...configured, ...byFloor };
  }

  getActionFingerprint(action) {
    if (!action) return "";
    const floorId = action.floorId || "";
    if (action.kind === "battle") {
      const target = action.target || {};
      return `battle|${floorId}|${target.x}|${target.y}|${action.enemyId || ""}`;
    }
    if (action.kind === "pickup") {
      return `pickup|${floorId}|${action.x}|${action.y}|${action.itemId || ""}`;
    }
    if (action.kind === "openDoor") {
      const target = action.target || {};
      return `openDoor|${floorId}|${target.x}|${target.y}|${action.doorId || ""}`;
    }
    if (action.kind === "useTool") {
      const target = action.target || {};
      return `useTool|${floorId}|${action.tool || ""}|${target.x ?? ""}|${target.y ?? ""}`;
    }
    if (action.kind === "equip") {
      return `equip|${floorId}|${action.equipId || action.itemId || ""}`;
    }
    if (action.kind === "event") {
      const choicePath = Array.isArray(action.choicePath) ? action.choicePath.join(".") : "";
      return `event|${floorId}|${action.x}|${action.y}|${action.summary || ""}|${choicePath}`;
    }
    return `${action.kind}|${action.summary || ""}`;
  }

  buildActionPreviewCacheKey(state, action) {
    return `${buildStateKey(state)}|${this.getActionFingerprint(action) || action.summary || ""}`;
  }

  applyActionPreview(state, action) {
    const key = this.buildActionPreviewCacheKey(state, action);
    const cached = this.cacheGet("resourcePreviewApply", key);
    if (cached) {
      if (!cached.valid) throw new Error(cached.error || "cached invalid action preview");
      return cloneState(cached.state);
    }
    try {
      const nextState = this.applyAction(state, action, { storeRoute: false });
      this.cacheSet("resourcePreviewApply", key, { valid: true, state: cloneState(nextState) });
      return nextState;
    } catch (error) {
      this.cacheSet("resourcePreviewApply", key, {
        valid: false,
        error: error && error.message ? error.message : String(error),
      });
      throw error;
    }
  }

  normalizePocketStep(action) {
    const entry = {
      kind: action.kind,
      summary: action.summary,
      fingerprint: this.getActionFingerprint(action),
      floorId: action.floorId,
    };
    if (action.x != null) entry.x = action.x;
    if (action.y != null) entry.y = action.y;
    if (action.target) entry.target = { x: action.target.x, y: action.target.y };
    if (action.enemyId) entry.enemyId = action.enemyId;
    if (action.itemId) entry.itemId = action.itemId;
    if (action.equipId) entry.equipId = action.equipId;
    if (action.tool) entry.tool = action.tool;
    return entry;
  }

  findPrimitiveByPlanEntry(actions, entry) {
    if (!entry) return null;
    if (entry.fingerprint) {
      const matched = (actions || []).find((action) => this.getActionFingerprint(action) === entry.fingerprint);
      if (matched) return matched;
    }
    if (entry.summary) return (actions || []).find((action) => action.summary === entry.summary) || null;
    return null;
  }

  getCombatSignature(state) {
    const hero = state.hero || {};
    return [
      Number(hero.atk || 0),
      Number(hero.def || 0),
      Number(hero.mdef || 0),
      Number(hero.lv || 0),
      Number(hero.exp || 0),
    ].join("|");
  }

  scorePocketPlan(baseState, node, options) {
    const delta = this.summarizeResourceDelta(baseState, node.state);
    const hero = node.state.hero || {};
    const hp = Number(hero.hp || 0);
    const hpWeight = Number((options || {}).hpWeight || 24);
    let score = 0;
    score += Number(delta.atk || 0) * 120000;
    score += Number(delta.def || 0) * 100000;
    score += Number(delta.mdef || 0) * 8000;
    score += Number(delta.lv || 0) * 300000;
    score += Number(delta.exp || 0) * 6000;
    score += hp * hpWeight;
    score -= Number((node.planEntries || []).length || 0) * 300;
    if ((node.stopReasons || []).includes("forwardChangeFloor")) score += 350000;
    if ((node.stopReasons || []).includes("levelUp")) score += 120000;
    if ((node.stopReasons || []).includes("keyItem")) score += 80000;
    return score;
  }

  comparePocketPlans(baseState, left, right) {
    const leftCombat = this.getCombatSignature(left.state);
    const rightCombat = this.getCombatSignature(right.state);
    if (leftCombat === rightCombat) {
      const hpDiff = Number((right.state.hero || {}).hp || 0) - Number((left.state.hero || {}).hp || 0);
      if (hpDiff !== 0) return hpDiff;
    }
    const scoreDiff = Number(right.score || 0) - Number(left.score || 0);
    if (scoreDiff !== 0) return scoreDiff;
    return Number((left.planEntries || []).length || 0) - Number((right.planEntries || []).length || 0);
  }

  classifyPocketAction(currentState, action) {
    if (!action || action.kind !== "battle") {
      return { role: action && action.kind, highRisk: false, prep: true };
    }
    const damage = Number((action.estimate || {}).damage || 0);
    const exp = Number((action.estimate || {}).exp || 0);
    const hp = Number((currentState.hero || {}).hp || 0);
    const level = this.getNextLevelInfo(currentState);
    const closesLevel = Boolean(level && exp >= Number(level.deficit || 0));
    const damageRatio = hp > 0 ? damage / hp : 1;
    const lowDamage = damage <= 30 || damageRatio <= 0.03;
    return {
      role: "battle",
      damage,
      exp,
      closesLevel,
      damageRatio,
      highRisk: damage >= 120 || damageRatio >= 0.12,
      lowDamage,
      prep: lowDamage || closesLevel,
    };
  }

  takeRankedPocketActions(baseState, currentState, actions, limit) {
    if (!limit || limit <= 0) return [];
    return (actions || [])
      .map((action) => {
        const rank = this.rankPocketActionForPreview(currentState, action);
        if (!Number.isFinite(rank)) return null;
        try {
          const nextState = this.applyActionPreview(currentState, action);
          const cls = this.classifyPocketAction(currentState, action);
          const damage = Number((action.estimate || {}).damage || 0);
          const riskPenalty = action.kind === "battle" && cls.highRisk ? damage * 250 : 0;
          return {
            action,
            rank,
            score: this.scorePocketCandidate(baseState, currentState, nextState, action) - riskPenalty,
          };
        } catch (error) {
          return { action, rank, score: Number.NEGATIVE_INFINITY };
        }
      })
      .filter(Boolean)
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        return right.rank - left.rank;
      })
      .slice(0, limit)
      .map((entry) => entry.action);
  }

  dedupePocketActions(actions) {
    const seen = new Set();
    const result = [];
    (actions || []).forEach((action) => {
      const key = this.getActionFingerprint(action) || action.summary;
      if (seen.has(key)) return;
      seen.add(key);
      result.push(action);
    });
    return result;
  }

  selectPocketExpansionCandidates(baseState, currentState, actions, options) {
    const buckets = {
      item: [],
      doorToolEvent: [],
      lowDamageBattle: [],
      levelBattle: [],
      mediumBattle: [],
      highRiskBattle: [],
    };

    (actions || []).forEach((action) => {
      const cls = this.classifyPocketAction(currentState, action);
      if (action.kind === "pickup" || action.kind === "equip") buckets.item.push(action);
      else if (action.kind === "openDoor" || action.kind === "useTool" || action.kind === "event") buckets.doorToolEvent.push(action);
      else if (action.kind === "battle" && cls.lowDamage) buckets.lowDamageBattle.push(action);
      else if (action.kind === "battle" && cls.closesLevel) buckets.levelBattle.push(action);
      else if (action.kind === "battle" && cls.highRisk) buckets.highRiskBattle.push(action);
      else buckets.mediumBattle.push(action);
    });

    const hasPrepCandidate =
      buckets.item.length > 0 ||
      buckets.doorToolEvent.length > 0 ||
      buckets.lowDamageBattle.length > 0 ||
      buckets.levelBattle.length > 0;

    return this.dedupePocketActions([
      ...this.takeRankedPocketActions(baseState, currentState, buckets.item, 4),
      ...this.takeRankedPocketActions(baseState, currentState, buckets.doorToolEvent, 4),
      ...this.takeRankedPocketActions(baseState, currentState, buckets.lowDamageBattle, 8),
      ...this.takeRankedPocketActions(baseState, currentState, buckets.levelBattle, 4),
      ...this.takeRankedPocketActions(baseState, currentState, buckets.mediumBattle, 5),
      ...this.takeRankedPocketActions(baseState, currentState, buckets.highRiskBattle, hasPrepCandidate ? 2 : 5),
    ]).slice(0, options.branchLimit);
  }

  mergePocketStopReasons(baseState, currentState, nextState, previousReasons) {
    const reasons = Array.isArray(previousReasons) ? previousReasons.slice() : [];
    const reason = this.summarizePocketStopReason(baseState, currentState, nextState);
    if (reason && !reasons.includes(reason)) reasons.push(reason);
    return reasons;
  }

  shouldStopPocketExpansion(baseState, node, options) {
    if (node.depth >= options.maxDepth) return true;
    if ((node.stopReasons || []).includes("forwardChangeFloor") && options.continueAfterForwardChangeFloor !== true) return true;
    return false;
  }

  isUsefulPocketResult(baseState, node) {
    if (!node || !Array.isArray(node.planEntries) || node.planEntries.length <= 1) return false;
    const delta = this.summarizeResourceDelta(baseState, node.state);
    const score = this.scoreResourceDelta(delta);
    if (score > 0) return true;
    return (node.stopReasons || []).some((reason) => reason === "levelUp" || reason === "forwardChangeFloor" || reason === "keyItem");
  }

  buildPocketNodeKey(node) {
    const state = node.state;
    const hero = state.hero || {};
    return [
      state.floorId,
      hero.loc && hero.loc.x,
      hero.loc && hero.loc.y,
      this.getCombatSignature(state),
      Object.keys(state.inventory || {}).sort().map((key) => `${key}:${state.inventory[key]}`).join(","),
      JSON.stringify((state.floorStates || {})[state.floorId] || {}),
    ].join("|");
  }

  buildReachableRegionSignature(state) {
    try {
      const floor = this.project.floorsById[state.floorId];
      const reachability = this.getWalkReachability(state);
      const coordinates = Object.values(reachability.visited || {})
        .map((node) => `${node.x},${node.y}`)
        .sort();
      const endpoints = [];
      Object.values(reachability.visited || {}).forEach((node) => {
        DIRECTIONS.forEach((direction) => {
          const delta = DIRECTION_DELTAS[direction];
          const x = node.x + delta.x;
          const y = node.y + delta.y;
          const key = coordinateKey(x, y);
          const tile = getTileDefinitionAt(this.project, node.state, node.state.floorId, x, y);
          const changeFloor = (floor.changeFloor || {})[key];
          if (changeFloor) endpoints.push(`changeFloor:${x},${y}->${changeFloor.floorId || changeFloor.stair || ""}`);
          if (!tile) return;
          if (tile.cls === "items") endpoints.push(`pickup:${tile.id}@${x},${y}`);
          else if (isEnemyTile(tile)) endpoints.push(`battle:${tile.id}@${x},${y}`);
          else if (isDoorTile(tile)) endpoints.push(`door:${tile.id}@${x},${y}`);
          else if ((floor.events || {})[key]) endpoints.push(`event:${x},${y}`);
        });
      });
      const uniqueEndpoints = Array.from(new Set(endpoints)).sort();
      return {
        regionKey: coordinates.join("|"),
        reachableEndpointsKey: uniqueEndpoints.join("|"),
        counts: {
          tiles: coordinates.length,
          battles: uniqueEndpoints.filter((entry) => entry.startsWith("battle:")).length,
          pickups: uniqueEndpoints.filter((entry) => entry.startsWith("pickup:")).length,
          events: uniqueEndpoints.filter((entry) => entry.startsWith("event:")).length,
          doors: uniqueEndpoints.filter((entry) => entry.startsWith("door:")).length,
          changeFloors: uniqueEndpoints.filter((entry) => entry.startsWith("changeFloor:")).length,
        },
      };
    } catch (error) {
      const hero = state.hero || {};
      return {
        regionKey: `${state.floorId}:${hero.loc && hero.loc.x},${hero.loc && hero.loc.y}`,
        reachableEndpointsKey: "",
        counts: { tiles: 0, battles: 0, pickups: 0, events: 0, doors: 0, changeFloors: 0 },
      };
    }
  }

  buildPocketLocalMutationSignature(baseState, state) {
    const floorIds = Array.from(new Set([baseState.floorId, state.floorId].filter(Boolean))).sort();
    return floorIds.map((floorId) => ({
      floorId,
      ...stableFloorState((state.floorStates || {})[floorId] || {}),
    }));
  }

  buildPocketForwardAvailability(state, region) {
    try {
      const endpoints = String((region || {}).reachableEndpointsKey || "").split("|").filter(Boolean);
      let hasForwardChangeFloor = false;
      let hasBackwardChangeFloor = false;
      let battleFrontierCount = 0;
      let pickupFrontierCount = 0;
      let changeFloorCount = 0;
      const currentOrder = getFloorOrder(state.floorId);
      endpoints.forEach((endpoint) => {
        if (endpoint.startsWith("battle:")) battleFrontierCount += 1;
        if (endpoint.startsWith("pickup:")) pickupFrontierCount += 1;
        if (!endpoint.startsWith("changeFloor:")) return;
        changeFloorCount += 1;
        const targetFloorId = endpoint.split("->")[1] || "";
        const targetOrder = targetFloorId === ":next"
          ? currentOrder + 1
          : targetFloorId === ":before"
            ? currentOrder - 1
            : getFloorOrder(targetFloorId);
        if (targetOrder > currentOrder) hasForwardChangeFloor = true;
        if (targetOrder < currentOrder) hasBackwardChangeFloor = true;
      });
      return { hasForwardChangeFloor, hasBackwardChangeFloor, battleFrontierCount, pickupFrontierCount, changeFloorCount };
    } catch (error) {
      return { hasForwardChangeFloor: false, hasBackwardChangeFloor: false, battleFrontierCount: 0, pickupFrontierCount: 0, changeFloorCount: 0 };
    }
  }

  buildPocketConfluenceSignature(baseState, node) {
    const state = node.state;
    const cache = node.__confluenceCache || null;
    const cacheKey = cache ? buildStateKey(state) : null;
    if (cache && cache.has(cacheKey)) return cache.get(cacheKey);
    const region = this.buildReachableRegionSignature(state);
    const signature = JSON.stringify({
      floorId: state.floorId,
      regionKey: region.regionKey,
      reachableEndpointsKey: region.reachableEndpointsKey,
      combatSignature: this.getCombatSignature(state),
      inventory: stableObject(state.inventory),
      flags: stableObject(state.flags),
      visitedFloors: Object.keys(state.visitedFloors || {}).sort(),
      localMutations: this.buildPocketLocalMutationSignature(baseState, state),
      forwardAvailability: this.buildPocketForwardAvailability(state, region),
    });
    if (cache) cache.set(cacheKey, signature);
    return signature;
  }

  comparePocketConfluenceNodes(baseState, left, right) {
    const leftHero = left.state.hero || {};
    const rightHero = right.state.hero || {};
    for (const field of ["hp", "atk", "def", "mdef", "lv", "exp"]) {
      const diff = compareNumbersDescending(leftHero[field], rightHero[field]);
      if (diff !== 0) return diff;
    }
    const inventoryDiff = compareInventoryDominance(left.state.inventory, right.state.inventory);
    if (inventoryDiff !== 0) return inventoryDiff;
    const lengthDiff = Number((left.planEntries || []).length || 0) - Number((right.planEntries || []).length || 0);
    if (lengthDiff !== 0) return lengthDiff;
    return this.comparePocketPlans(baseState, left, right);
  }

  selectPocketConfluenceSkyline(baseState, nodes, options) {
    const limit = Number((options || {}).representativesPerConfluence || 2);
    const cache = new Map();
    const bySignature = new Map();
    (nodes || []).forEach((node) => {
      node.__confluenceCache = cache;
      const signature = this.buildPocketConfluenceSignature(baseState, node);
      delete node.__confluenceCache;
      const list = bySignature.get(signature) || [];
      list.push(node);
      bySignature.set(signature, list);
    });
    const selected = [];
    bySignature.forEach((list, signature) => {
      list.sort((left, right) => this.comparePocketConfluenceNodes(baseState, left, right));
      list.slice(0, Math.max(1, limit)).forEach((node, index) => {
        node.confluence = {
          signature,
          hpRank: index + 1,
          dominatedEquivalentCount: Math.max(0, list.length - 1),
          representativeCount: Math.min(list.length, Math.max(1, limit)),
        };
        selected.push(node);
      });
    });
    return selected;
  }

  buildSearchConfluenceKey(state) {
    const stateKey = buildStateKey(state);
    const cached = this.cacheGet("searchConfluence", stateKey);
    if (cached) return cached;
    const key = buildSharedSearchConfluenceKey(this, state);
    return this.cacheSet("searchConfluence", stateKey, key);
  }

  compareSearchConfluenceStates(left, right) {
    const resourceComparison = compareConfluenceResources(left, right);
    if (resourceComparison != null) return resourceComparison;
    const leftHero = left.hero || {};
    const rightHero = right.hero || {};
    for (const field of ["hp", "atk", "def", "mdef", "lv", "exp"]) {
      const diff = compareNumbersDescending(leftHero[field], rightHero[field]);
      if (diff !== 0) return diff;
    }
    const inventoryDiff = compareInventoryDominance(left.inventory, right.inventory);
    if (inventoryDiff !== 0) return inventoryDiff;
    const leftEquipment = new Set((leftHero.equipment || []));
    const rightEquipment = new Set((rightHero.equipment || []));
    const leftHasAll = Array.from(rightEquipment).every((itemId) => leftEquipment.has(itemId));
    const rightHasAll = Array.from(leftEquipment).every((itemId) => rightEquipment.has(itemId));
    if (leftHasAll && !rightHasAll) return -1;
    if (rightHasAll && !leftHasAll) return 1;
    return getDecisionDepth(left) - getDecisionDepth(right);
  }

  prunePocketFrontier(baseState, nodes, options) {
    const exactBest = new Map();
    (nodes || []).forEach((node) => {
      const key = this.buildPocketNodeKey(node);
      const existing = exactBest.get(key);
      if (!existing || this.comparePocketPlans(baseState, node, existing) < 0) exactBest.set(key, node);
    });
    const representatives = options.preserveConfluenceSkyline === false
      ? Array.from(exactBest.values())
      : this.selectPocketConfluenceSkyline(baseState, Array.from(exactBest.values()), options);
    representatives.sort((left, right) => this.comparePocketPlans(baseState, left, right));
    return representatives.slice(0, options.frontierLimit);
  }

  selectBestPocketPlans(baseState, results, resultLimit, options) {
    const candidates = options && options.preserveConfluenceSkyline === false
      ? (results || [])
      : this.selectPocketConfluenceSkyline(baseState, results || [], options || {});
    const byCombat = new Map();
    candidates.forEach((node) => {
      const combatKey = this.getCombatSignature(node.state);
      const existing = byCombat.get(combatKey);
      if (!existing || this.comparePocketPlans(baseState, node, existing) < 0) {
        byCombat.set(combatKey, node);
      }
    });

    const selected = [];
    const seenPlans = new Set();
    const addNode = (node) => {
      if (!node || selected.length >= resultLimit) return;
      const key = (node.planEntries || []).map((entry) => entry.fingerprint || entry.summary).join("|");
      if (seenPlans.has(key)) return;
      seenPlans.add(key);
      selected.push(node);
    };

    Array.from(byCombat.values()).forEach(addNode);
    candidates
      .slice()
      .sort((left, right) => this.comparePocketPlans(baseState, left, right))
      .forEach(addNode);
    return selected.slice(0, resultLimit);
  }


  buildGreedyPocketPlans(baseState, initialActions, options) {
    let state = cloneState(baseState);
    const planEntries = [];
    let stopReasons = [];
    const results = [];
    for (let depth = 0; depth < options.maxDepth; depth += 1) {
      const primitiveActions = (depth === 0 && Array.isArray(initialActions)
        ? initialActions
        : this.enumeratePrimitiveActions(state).actions).filter((action) => this.isPocketPrimitiveAction(action));
      const candidates = this.selectPocketExpansionCandidates(baseState, state, primitiveActions, options);
      const action = candidates[0] || null;
      if (!action) break;
      let nextState;
      try {
        nextState = this.applyActionPreview(state, action);
      } catch (error) {
        break;
      }
      stopReasons = this.mergePocketStopReasons(baseState, state, nextState, stopReasons);
      planEntries.push(this.normalizePocketStep(action));
      state = nextState;
      const node = {
        state,
        planEntries: planEntries.slice(),
        stopReasons: stopReasons.slice(),
        depth: depth + 1,
      };
      node.score = this.scorePocketPlan(baseState, node, options);
      if (this.isUsefulPocketResult(baseState, node)) results.push(node);
      if (this.shouldStopPocketExpansion(baseState, node, options)) break;
    }
    return results;
  }


  searchResourcePocketPlans(baseState, initialActions, options) {
    const root = {
      state: cloneState(baseState),
      planEntries: [],
      stopReasons: [],
      depth: 0,
      score: 0,
    };
    let frontier = [root];
    const results = [];
    results.push(...this.buildGreedyPocketPlans(baseState, initialActions, options));
    const primitiveActionCache = new Map();
    const getPocketPrimitiveActions = (nodeState) => {
      const key = buildStateKey(nodeState);
      if (!primitiveActionCache.has(key)) {
        primitiveActionCache.set(
          key,
          this.enumeratePrimitiveActions(nodeState).actions.filter((action) => this.isPocketPrimitiveAction(action))
        );
      }
      return primitiveActionCache.get(key);
    };
    const applyPocketActionPreview = (nodeState, action) => {
      try {
        return this.applyActionPreview(nodeState, action);
      } catch (error) {
        return null;
      }
    };
    let expanded = 0;

    for (let depth = 0; depth < options.maxDepth && frontier.length > 0; depth += 1) {
      const nextFrontier = [];
      for (const node of frontier) {
        if (expanded >= options.maxNodes) break;
        expanded += 1;
        const primitiveActions = node === root && Array.isArray(initialActions)
          ? initialActions.filter((action) => this.isPocketPrimitiveAction(action))
          : getPocketPrimitiveActions(node.state);
        const candidates = this.selectPocketExpansionCandidates(baseState, node.state, primitiveActions, options);

        candidates.forEach((action) => {
          const nextState = applyPocketActionPreview(node.state, action);
          if (!nextState) return;
          const stopReasons = this.mergePocketStopReasons(baseState, node.state, nextState, node.stopReasons);
          const nextNode = {
            state: nextState,
            planEntries: node.planEntries.concat([this.normalizePocketStep(action)]),
            stopReasons,
            depth: node.depth + 1,
          };
          nextNode.score = this.scorePocketPlan(baseState, nextNode, options);
          if (this.isUsefulPocketResult(baseState, nextNode)) results.push(nextNode);
          if (!this.shouldStopPocketExpansion(baseState, nextNode, options)) nextFrontier.push(nextNode);
        });
      }
      if (expanded >= options.maxNodes) break;
      frontier = this.prunePocketFrontier(baseState, nextFrontier, options);
    }

    return this.selectBestPocketPlans(baseState, results, options.resultLimit, options);
  }

  buildResourcePocketActionsFromPlans(baseState, plans, resultLimit) {
    return (plans || []).slice(0, resultLimit).map((planNode) => {
      const delta = this.summarizeResourceDelta(baseState, planNode.state);
      const preparesFor = this.summarizePocketPreparation(baseState, planNode.state);
      if (preparesFor && preparesFor.meetsGateRequirement) planNode.score = Number(planNode.score || 0) + 500000;
      if (preparesFor && Number(preparesFor.hpDeficitReduced || 0) > 0) planNode.score = Number(planNode.score || 0) + Number(preparesFor.hpDeficitReduced || 0) * 80;
      const planEntries = planNode.planEntries || [];
      const plan = planEntries.map((entry) => entry.summary);
      const confluence = planNode.confluence || null;
      const confluenceReason = confluence && Number(confluence.hpRank || 0) === 1 && Number(confluence.dominatedEquivalentCount || 0) > 0
        ? "highest-hp"
        : confluence && Number(confluence.hpRank || 0) > 1
          ? "representative"
          : "best-score";
      return {
        kind: "resourcePocket",
        floorId: baseState.floorId,
        path: [],
        plan,
        planEntries,
        estimate: {
          ...delta,
          damage: Math.max(0, Number((baseState.hero || {}).hp || 0) - Number((planNode.state.hero || {}).hp || 0)),
          hpAfter: Number((planNode.state.hero || {}).hp || 0),
          hpDelta: delta.hp,
          score: planNode.score,
          stopReasons: planNode.stopReasons,
          preparesFor,
          confluence,
        },
        debug: {
          confluenceSignature: confluence && confluence.signature,
          confluenceReason,
        },
        summary: `resourcePocket:${baseState.floorId}:${plan.length}steps:${planNode.stopReasons.join(",") || "resource"}:${plan[0]}`,
      };
    });
  }

  enumerateResourcePocketActions(state, actions) {
    const floorOrder = getFloorOrder(state.floorId);
    const options = this.getResourcePocketSearchOptions(state, floorOrder);
    const plans = this.searchResourcePocketPlans(state, actions, options);
    return this.buildResourcePocketActionsFromPlans(state, plans, options.resultLimit);
  }

  getNextLevelInfo(state) {
    const entries = (((this.project || {}).data || {}).firstData || {}).levelUp || [];
    const level = Number((state.hero || {}).lv || 0);
    const next = entries[level] || null;
    if (!next) return null;
    const need = Number(evaluateExpression(next.need, this.project, state, { floorId: state.floorId }) || 0);
    const exp = Number((state.hero || {}).exp || 0);
    return {
      level,
      exp,
      need,
      deficit: Math.max(0, need - exp),
    };
  }

  enumerateBattleActionsOnly(state) {
    const reachability = this.getWalkReachability(state);
    return this.battleResolver.enumerateActions({
      project: this.project,
      state,
      reachability,
    });
  }

  chooseLevelUpBattle(state, battleActions) {
    const levelInfo = this.getNextLevelInfo(state);
    const deficit = levelInfo ? Number(levelInfo.deficit || 0) : Number.POSITIVE_INFINITY;
    return (battleActions || [])
      .filter((action) => Number((action.estimate || {}).exp || 0) > 0)
      .slice()
      .sort((left, right) => {
        const leftExp = Number((left.estimate || {}).exp || 0);
        const rightExp = Number((right.estimate || {}).exp || 0);
        const leftDamage = Number((left.estimate || {}).damage || 0);
        const rightDamage = Number((right.estimate || {}).damage || 0);
        const leftCompletes = leftExp >= deficit ? 1 : 0;
        const rightCompletes = rightExp >= deficit ? 1 : 0;
        if (leftCompletes !== rightCompletes) return rightCompletes - leftCompletes;
        const leftEfficiency = leftExp * 10000 - leftDamage;
        const rightEfficiency = rightExp * 10000 - rightDamage;
        if (leftEfficiency !== rightEfficiency) return rightEfficiency - leftEfficiency;
        return leftDamage - rightDamage;
      })[0] || null;
  }

  enumerateFightToLevelUpAction(state, initialBattleActions) {
    const startInfo = this.getNextLevelInfo(state);
    if (!startInfo || startInfo.deficit <= 0 || startInfo.deficit > 30) return null;
    const visibleExp = (initialBattleActions || []).reduce((sum, action) => sum + Number((action.estimate || {}).exp || 0), 0);
    if (visibleExp < startInfo.deficit) return null;

    let preview = cloneState(state);
    const plan = [];
    let totalDamage = 0;
    let totalExp = 0;
    const startLevel = Number((preview.hero || {}).lv || 0);

    for (let index = 0; index < 6; index += 1) {
      const info = this.getNextLevelInfo(preview);
      if (!info || info.deficit <= 0 || Number((preview.hero || {}).lv || 0) > startLevel) break;
      const battleActions = index === 0 ? initialBattleActions : this.enumerateBattleActionsOnly(preview);
      const action = this.chooseLevelUpBattle(preview, battleActions);
      if (!action) break;
      plan.push(action.summary);
      totalDamage += Number((action.estimate || {}).damage || 0);
      totalExp += Number((action.estimate || {}).exp || 0);
      preview = this.applyAction(preview, action, { storeRoute: false });
      if (Number((preview.hero || {}).lv || 0) > startLevel) break;
    }

    if (Number((preview.hero || {}).lv || 0) <= startLevel) return null;
    return {
      kind: "fightToLevelUp",
      floorId: state.floorId,
      path: [],
      travelState: state,
      plan,
      estimate: {
        damage: totalDamage,
        exp: totalExp,
        targetLevel: Number((preview.hero || {}).lv || 0),
      },
      summary: `fightToLevelUp:${state.floorId}:lv${startLevel}->${Number((preview.hero || {}).lv || 0)}:${plan.length}fights`,
    };
  }

  sortActions(state, actions) {
    const frontierFeatures = computeFrontierFeatures(this.project, state, { battleResolver: this.battleResolver });
    const doorFilteredActions = this.deferRareDoorActions(state, actions, frontierFeatures);
    const filteredActions = this.deferCostlyBattleActions(state, doorFilteredActions, frontierFeatures);
    const decorated = filteredActions.map((action, index) => ({
      action,
      index,
      priority: this.getActionPriority(state, action, frontierFeatures),
    }));
    decorated.sort((left, right) => {
      if (left.priority !== right.priority) return right.priority - left.priority;
      return left.index - right.index;
    });
    return decorated.map((entry) => entry.action);
  }

  isRareDoorAction(state, action) {
    if (!action || action.kind !== "openDoor") return false;
    if (action.doorId === "blueDoor" || action.doorId === "redDoor") return true;
    const requirements = action.requirements || {};
    return Boolean(requirements.blueKey || requirements.redKey);
  }

  shouldKeepRareDoorAction(state, action, frontierFeatures) {
    if (!this.isRareDoorAction(state, action)) return true;
    if (frontierFeatures && frontierFeatures.preferredChangeFloor && action.target) {
      const distanceToPreferred = Math.abs(action.target.x - frontierFeatures.preferredChangeFloor.x) + Math.abs(action.target.y - frontierFeatures.preferredChangeFloor.y);
      if (distanceToPreferred <= 1) return true;
    }
    const requirements = action.requirements || {};
    if (requirements.blueKey && getInventoryCount(state, "blueKey") > Number(requirements.blueKey || 0)) return true;
    if (requirements.redKey && getInventoryCount(state, "redKey") > Number(requirements.redKey || 0)) return true;
    return false;
  }

  deferRareDoorActions(state, actions, frontierFeatures) {
    const rareDoors = actions.filter((action) => this.isRareDoorAction(state, action));
    if (rareDoors.length === 0) return actions;
    const nonRareActions = actions.filter((action) => !this.isRareDoorAction(state, action));
    const hasUsefulAlternative = nonRareActions.some((action) => (
      action.kind === "changeFloor" ||
      action.kind === "pickup" ||
      action.kind === "battle" ||
      action.kind === "resourcePocket" ||
      action.kind === "fightToLevelUp" ||
      (action.kind === "openDoor" && !this.isRareDoorAction(state, action))
    ));
    if (!hasUsefulAlternative) return actions;
    const keptRareDoors = rareDoors.filter((action) => this.shouldKeepRareDoorAction(state, action, frontierFeatures));
    return nonRareActions.concat(keptRareDoors);
  }

  isZeroDamageResourceBattle(action, frontierFeatures) {
    if (!action || action.kind !== "battle") return false;
    if (Number((action.estimate || {}).damage || 0) !== 0) return false;
    const targetKey = action.target ? coordinateKey(action.target.x, action.target.y) : null;
    const preview = targetKey && frontierFeatures && frontierFeatures.battleOpportunities
      ? frontierFeatures.battleOpportunities[targetKey]
      : null;
    return Boolean(preview && (Number(preview.itemCount || 0) > 0 || Number(preview.score || 0) >= 120));
  }

  deferCostlyBattleActions(state, actions, frontierFeatures) {
    const zeroResourceBattles = actions.filter((action) => this.isZeroDamageResourceBattle(action, frontierFeatures));
    if (zeroResourceBattles.length === 0) return actions;
    const filtered = actions.filter((action) => {
      if (action && action.kind === "changeFloor") return false;
      if (!action || action.kind !== "battle") return true;
      if (this.isZeroDamageResourceBattle(action, frontierFeatures)) return true;
      return Number((action.estimate || {}).damage || 0) <= 25;
    });
    return filtered.length > 0 ? filtered : actions;
  }

  getActionPriority(state, action, frontierFeatures) {
    switch (action.kind) {
      case "changeFloor": {
        const targetFloorId = action.changeFloor && action.changeFloor.floorId;
        const unvisited = targetFloorId && targetFloorId !== ":next" && targetFloorId !== ":before"
          ? !state.visitedFloors[targetFloorId]
          : false;
        const locKey = coordinateKey(action.x, action.y);
        const targetInfo = frontierFeatures && frontierFeatures.changeFloorTargets
          ? frontierFeatures.changeFloorTargets[locKey]
          : null;
        const preview = targetInfo && targetInfo.preview ? targetInfo.preview : {};
        const previewScore = Number(preview.score || 0);
        const previewItems = Number(preview.itemCount || 0);
        const previewZeroDamage = Number(preview.zeroDamageBattleCount || 0);
        const isPreferred = Boolean(
          frontierFeatures &&
          frontierFeatures.preferredChangeFloor &&
          frontierFeatures.preferredChangeFloor.x === action.x &&
          frontierFeatures.preferredChangeFloor.y === action.y
        );
        let priority = targetFloorId === ":next" ? 780 : 720;
        if (unvisited) priority += 80;
        priority += Math.min(220, Math.floor(previewScore / 2));
        priority += Math.min(60, previewItems * 18);
        priority += Math.min(50, previewZeroDamage * 12);
        if (isPreferred) priority += 30;
        if ((action.path || []).length === 0) priority += 40;
        return priority;
      }
      case "battle": {
        const damage = Number(action.estimate && action.estimate.damage || 0);
        const preferredChange = frontierFeatures ? frontierFeatures.preferredChangeFloor : null;
        const targetKey = action.target ? coordinateKey(action.target.x, action.target.y) : null;
        const preview = targetKey && frontierFeatures && frontierFeatures.battleOpportunities
          ? frontierFeatures.battleOpportunities[targetKey]
          : null;
        let priority = 700;
        if (damage === 0) priority += 120;
        if (preview) {
          if (action.estimate) action.estimate.unlockPreview = preview;
          priority += Math.min(260, Math.floor(Number(preview.score || 0) / 2));
          priority += Math.min(160, Number(preview.itemCount || 0) * 45);
          priority += Math.min(120, Number(preview.zeroDamageChainCount || 0) * 35);
          priority += Math.min(90, Number(preview.lowDamageBattleCount || 0) * 25);
          priority += Math.min(120, Number(preview.changeFloorCount || 0) * 60);
        }
        priority += Math.min(60, Number(action.estimate && action.estimate.exp || 0));
        priority += Math.min(60, Number(action.estimate && action.estimate.money || 0));
        if (preferredChange && action.target) {
          const distanceToPreferred = Math.abs(action.target.x - preferredChange.x) + Math.abs(action.target.y - preferredChange.y);
          const preferredPreviewScore = Number(((preferredChange.preview || {}).score) || 0);
          priority += Math.max(0, 120 - distanceToPreferred * 12);
          priority += Math.min(100, Math.floor(preferredPreviewScore / 6));
          if (distanceToPreferred <= 2) priority += 40;
        }
        priority -= Math.min(200, damage);
        return priority;
      }
      case "openDoor": {
        let priority = 500;
        const requirements = action.requirements || {};
        if (requirements.blueKey || action.doorId === "blueDoor") {
          const blueKeys = getInventoryCount(state, "blueKey");
          priority -= blueKeys <= Number(requirements.blueKey || 1) ? 180 : 80;
          if (frontierFeatures && frontierFeatures.preferredChangeFloor && action.target) {
            const distanceToPreferred = Math.abs(action.target.x - frontierFeatures.preferredChangeFloor.x) + Math.abs(action.target.y - frontierFeatures.preferredChangeFloor.y);
            if (distanceToPreferred <= 2) priority += 120;
          }
        }
        return priority;
      }
      case "useTool":
        return 420;
      case "equip":
        return 320;
      case "event":
        return action.unsupported ? 10 : (action.hasStateChange ? 360 : 40);
      case "pickup":
        return 200;
      default:
        return 0;
    }
  }

  moveHero(state, path, destination, direction) {
    (path || []).forEach((stepDirection) => {
      const delta = DIRECTION_DELTAS[stepDirection];
      state.hero.loc.x += delta.x;
      state.hero.loc.y += delta.y;
      state.hero.loc.direction = stepDirection;
      state.hero.steps = (state.hero.steps || 0) + 1;
    });
    if (destination) {
      state.hero.loc.x = destination.x;
      state.hero.loc.y = destination.y;
    }
    if (direction) state.hero.loc.direction = direction;
  }

  applyAction(state, action, options) {
    const config = options || {};
    let nextState = action.travelState ? cloneState(action.travelState) : cloneState(state);
    if (!action.travelState) {
      this.moveHero(
        nextState,
        action.path,
        action.kind === "pickup" || action.kind === "changeFloor" ? { x: action.x, y: action.y } : action.stance,
        action.direction
      );
    }
    if (action.travelState && action.direction && (action.kind === "battle" || action.kind === "openDoor" || action.kind === "useTool")) {
      nextState.hero.loc.direction = action.direction;
    }

    switch (action.kind) {
      case "pickup":
        nextState = this.applyPickupAction(nextState, action);
        break;
      case "changeFloor":
        nextState = this.applyChangeFloorAction(nextState, action);
        break;
      case "openDoor":
        this.applyDoorAction(nextState, action);
        break;
      case "useTool":
        this.applyToolAction(nextState, action);
        break;
      case "equip":
        this.applyEquipAction(nextState, action);
        break;
      case "event":
        nextState = this.applyEventAction(nextState, action);
        break;
      case "battle":
        this.battleResolver.applyAction({
          project: this.project,
          state: nextState,
          action,
          executeActionList,
          choiceResolver: this.choiceResolver,
        });
        break;
      case "fightToLevelUp":
        return this.applyFightToLevelUpAction(nextState, action, config);
      case "resourcePocket":
        return this.applyResourcePocketAction(nextState, action, config);
      case "resourceChain":
        return this.applyResourcePocketAction(nextState, action, config);
      case "resourceCluster":
        return this.applyResourcePocketAction(nextState, action, config);
      default:
        throw new Error(`Unsupported action kind: ${action.kind}`);
    }

    const suppressRoute = config.storeRoute === false;
    if (suppressRoute) nextState.meta.__storeRoute = false;
    appendRouteStep(nextState, action.summary, { storeRoute: !suppressRoute });
    runAutoEvents(this.project, nextState, { choiceResolver: this.choiceResolver });
    syncProgress(nextState);
    const stabilized = this.stabilizeState(nextState);
    if (suppressRoute && stabilized.meta) delete stabilized.meta.__storeRoute;
    return stabilized;
  }

  stepIntoEndpoint(state, action, hooks) {
    if (!action.direction) return state;
    const nextState = stepOntoTile(
      this.project,
      state,
      action.direction,
      {
        battleResolver: this.battleResolver,
        executeActionList,
        choiceResolver: this.choiceResolver,
        predicate: (project, currentState, floorId, x, y) => x === action.x && y === action.y,
        beforeHazards: hooks && hooks.beforeHazards,
        afterHazards: hooks && hooks.afterHazards,
      },
      new Map()
    );
    if (!nextState) {
      throw new Error(`Failed to step onto ${action.floorId}:${action.x},${action.y} for ${action.kind}.`);
    }
    return nextState;
  }

  resolvePickupAt(state, x, y) {
    const tile = getTileDefinitionAt(this.project, state, state.floorId, x, y);
    if (!tile || tile.cls !== "items") {
      throw new Error(`No pickup item at ${state.floorId}:${x},${y}`);
    }
    removeTileAt(state, state.floorId, x, y);
    applyPickup(this.project, state, tile.id);

    const floor = this.project.floorsById[state.floorId];
    const afterGetItem = (floor.afterGetItem || {})[coordinateKey(x, y)];
    if (!afterGetItem) return;

    executeActionList(
      this.project,
      state,
      afterGetItem,
      { floorId: state.floorId, eventLoc: { x, y } },
      { choiceResolver: this.choiceResolver }
    );
  }

  resolvePickupOnCurrentTile(state, action) {
    this.resolvePickupAt(state, action.x, action.y);
  }

  applyPickupAction(state, action) {
    const floor = this.project.floorsById[state.floorId];
    const hasAfterGetItem = Boolean((floor.afterGetItem || {})[coordinateKey(action.x, action.y)]);

    if (!action.direction) {
      this.resolvePickupOnCurrentTile(state, action);
      return state;
    }

    return this.stepIntoEndpoint(state, action, {
      beforeHazards: hasAfterGetItem
        ? null
        : (nextState) => {
            this.resolvePickupOnCurrentTile(nextState, action);
            return true;
          },
      afterHazards: hasAfterGetItem
        ? (nextState) => {
            this.resolvePickupOnCurrentTile(nextState, action);
            return true;
          }
        : null,
    });
  }

  applyChangeFloorAction(state, action) {
    const applyTransition = (nextState) => {
      const target = resolveChangeFloorTarget(this.project, nextState, action.changeFloor);
      nextState.floorId = target.floorId;
      nextState.hero.loc.x = target.x;
      nextState.hero.loc.y = target.y;
      nextState.hero.loc.direction = target.direction;
      applyFloorArrival(this.project, nextState, nextState.floorId, { choiceResolver: this.choiceResolver });
      return true;
    };

    if (!action.direction) {
      applyTransition(state);
      return state;
    }

    return this.stepIntoEndpoint(state, action, {
      afterHazards: applyTransition,
    });
  }

  applyDoorAction(state, action) {
    this.doorResolver.applyAction({
      project: this.project,
      state,
      action,
      executeActionList,
      choiceResolver: this.choiceResolver,
    });
  }

  applyToolAction(state, action) {
    this.toolRegistry.applyAction({ project: this.project, state, action });
  }

  applyEquipAction(state, action) {
    this.equipmentResolver.applyAction({ project: this.project, state, action });
  }

  applyEventAction(state, action) {
    const runEvent = (nextState) => {
      this.eventResolver.applyAction({
        project: this.project,
        state: nextState,
        action,
        stabilizeState: (stableState) => this.stabilizeState(stableState),
      });
      return true;
    };

    if (!action.direction) {
      runEvent(state);
      return state;
    }

    return this.stepIntoEndpoint(state, action, {
      afterHazards: runEvent,
    });
  }

  applyFightToLevelUpAction(state, action, options) {
    const config = options || {};
    let nextState = state;
    (action.plan || []).forEach((summary) => {
      const battleAction = this.enumerateBattleActionsOnly(nextState).find((candidate) => candidate.summary === summary);
      if (!battleAction) {
        throw new Error(`Unable to replay fightToLevelUp step: ${summary}`);
      }
      nextState = this.applyAction(nextState, battleAction, { storeRoute: config.storeRoute !== false });
    });
    return nextState;
  }

  applyResourcePocketAction(state, action, options) {
    const config = options || {};
    let nextState = state;
    const entries = Array.isArray(action.planEntries)
      ? action.planEntries
      : (action.plan || []).map((summary) => ({ summary }));
    entries.forEach((entry) => {
      const primitiveActions = this.enumeratePrimitiveActions(nextState).actions;
      const primitiveAction = this.findPrimitiveByPlanEntry(primitiveActions, entry);
      if (!primitiveAction) {
        throw new Error(`Unable to replay resourcePocket step: ${entry.summary || entry.fingerprint}`);
      }
      nextState = this.applyAction(nextState, primitiveAction, { storeRoute: config.storeRoute !== false });
    });
    return nextState;
  }

  stabilizeState(state) {
    const stabilized = this.autoResolver.stabilizeState({
      project: this.project,
      state,
      battleResolver: this.battleResolver,
      executeActionList,
      choiceResolver: this.choiceResolver,
      resolvePickupAt: (currentState, x, y) => this.resolvePickupAt(currentState, x, y),
    });
    syncProgress(stabilized);
    return stabilized;
  }
}

module.exports = {
  StaticSimulator,
};
