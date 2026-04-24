"use strict";

const { applyPickup } = require("./effect-vm");
const { AutoActionResolver } = require("./auto-actions");
const { EquipmentResolver } = require("./equipment-resolver");
const { EventResolver } = require("./event-resolver");
const { evaluateExpression } = require("./expression");
const { applyFloorArrival, executeActionList, runAutoEvents } = require("./events");
const { resolveChangeFloorTarget } = require("./floor-transitions");
const { computeFrontierFeatures } = require("./frontier-features");
const { DIRECTIONS, DIRECTION_DELTAS, coordinateKey } = require("./reachability");
const { UnsupportedBattleResolver } = require("./battle-resolver");
const { buildDominanceBucketKey, buildDominanceSummary, dominatesSummary } = require("./dominance");
const { GenericDoorResolver } = require("./door-resolver");
const { compareScore, compareSearchRank, defaultScore, defaultSearchRank, getFloorOrder } = require("./score");
const { buildStateKey } = require("./state-key");
const { buildWalkReachability, stepOntoTile } = require("./step-simulator");
const { ToolRegistry } = require("./tool-registry");
const { syncProgress } = require("./progress");
const {
  appendRouteStep,
  cloneState,
  createInitialState,
  getDecisionDepth,
  getTileDefinitionAt,
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
    });
    this.choiceResolver = config.choiceResolver;
    this.enableFightToLevelUp = Boolean(config.enableFightToLevelUp);
    this.enableResourcePocket = Boolean(config.enableResourcePocket);
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
      { score: this.score(left), decisionDepth: getDecisionDepth(left), routeLength: left.route.length },
      { score: this.score(right), decisionDepth: getDecisionDepth(right), routeLength: right.route.length }
    );
  }

  compareSearchStates(left, right) {
    const leftScore = this.score(left);
    const rightScore = this.score(right);
    return compareSearchRank(
      this.searchRankFn(left, leftScore, { project: this.project, battleResolver: this.battleResolver }),
      this.searchRankFn(right, rightScore, { project: this.project, battleResolver: this.battleResolver })
    );
  }

  compareStates(left, right) {
    return this.compareSearchStates(left, right);
  }

  getFrontierBucketKey(state) {
    const features = computeFrontierFeatures(this.project, state, { battleResolver: this.battleResolver });
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
    const floor = this.project.floorsById[state.floorId];
    const reachability = buildWalkReachability(this.project, state, {
      battleResolver: this.battleResolver,
      executeActionList,
      choiceResolver: this.choiceResolver,
      stabilizeState: (nextState) => this.stabilizeState(nextState),
    });
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

    return { actions, battleActions };
  }

  enumerateActions(state) {
    const primitive = this.enumeratePrimitiveActions(state);
    const actions = primitive.actions;
    const battleActions = primitive.battleActions;

    if (this.enableFightToLevelUp) {
      const fightToLevelUpAction = this.enumerateFightToLevelUpAction(state, battleActions);
      if (fightToLevelUpAction) actions.push(fightToLevelUpAction);
    }
    if (this.enableResourcePocket && this.shouldEnumerateResourcePocket(state, actions)) {
      actions.push(...this.enumerateResourcePocketActions(state, actions));
    }

    return this.sortActions(state, actions);
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

  enumerateResourcePocketActions(state, actions) {
    const floorOrder = getFloorOrder(state.floorId);
    const seedLimit = floorOrder >= 2 ? 3 : 2;
    const chainLimit = floorOrder >= 2 ? 6 : 4;
    const candidateLimit = floorOrder >= 2 ? 6 : 5;
    const seedActions = (actions || [])
      .filter((action) => this.isPocketPrimitiveAction(action))
      .map((action) => {
        try {
          const nextPreview = this.applyAction(state, action);
          return { action, nextPreview, score: this.scorePocketCandidate(state, state, nextPreview, action) };
        } catch (error) {
          return null;
        }
      })
      .filter((entry) => entry && entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, seedLimit);
    return seedActions
      .map((seed) => {
        let preview = seed.nextPreview;
        const plan = [seed.action.summary];
        const stopReasons = [];
        const seedReason = this.summarizePocketStopReason(state, state, preview);
        if (seedReason) stopReasons.push(seedReason);
        try {
          for (let index = 0; index < chainLimit; index += 1) {
            if (stopReasons.includes("levelUp") || stopReasons.includes("forwardChangeFloor")) break;
            const candidates = this.enumeratePrimitiveActions(preview).actions
              .filter((action) => this.isPocketPrimitiveAction(action))
              .map((action) => ({ action, rank: this.rankPocketActionForPreview(preview, action) }))
              .filter((entry) => Number.isFinite(entry.rank))
              .sort((left, right) => right.rank - left.rank)
              .slice(0, candidateLimit)
              .map((entry) => {
                try {
                  const nextPreview = this.applyAction(preview, entry.action);
                  return { action: entry.action, nextPreview, score: this.scorePocketCandidate(state, preview, nextPreview, entry.action) };
                } catch (error) {
                  return null;
                }
              })
              .filter((entry) => entry && entry.score > 0)
              .sort((left, right) => right.score - left.score);
            const best = candidates[0] || null;
            if (!best) break;
            const reason = this.summarizePocketStopReason(state, preview, best.nextPreview);
            preview = best.nextPreview;
            plan.push(best.action.summary);
            if (reason) stopReasons.push(reason);
          }
        } catch (error) {
          return null;
        }
        const delta = this.summarizeResourceDelta(state, preview);
        let score = this.scoreResourceDelta(delta);
        if (stopReasons.includes("levelUp")) score += 300000;
        if (stopReasons.includes("forwardChangeFloor")) score += 350000;
        if (stopReasons.includes("keyItem")) score += 120000;
        if (score <= 0 || plan.length <= 1) return null;
        return {
          kind: "resourcePocket",
          floorId: state.floorId,
          path: [],
          plan,
          estimate: {
            ...delta,
            damage: Math.max(0, -Number(delta.hp || 0)),
            hpDelta: delta.hp,
            score,
            stopReasons,
          },
          summary: `resourcePocket:${state.floorId}:${plan.length}steps:${stopReasons.join(",") || "resource"}:${seed.action.summary}`,
        };
      })
      .filter(Boolean)
      .sort((left, right) => Number((right.estimate || {}).score || 0) - Number((left.estimate || {}).score || 0))
      .slice(0, 8);
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
    const reachability = buildWalkReachability(this.project, state, {
      battleResolver: this.battleResolver,
      executeActionList,
      choiceResolver: this.choiceResolver,
      stabilizeState: (nextState) => this.stabilizeState(nextState),
    });
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
      preview = this.applyAction(preview, action);
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
    const decorated = actions.map((action, index) => ({
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
        let priority = 700;
        if (damage === 0) priority += 120;
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
      case "openDoor":
        return 500;
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

  applyAction(state, action) {
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
        return this.applyFightToLevelUpAction(nextState, action);
      case "resourcePocket":
        return this.applyResourcePocketAction(nextState, action);
      default:
        throw new Error(`Unsupported action kind: ${action.kind}`);
    }

    appendRouteStep(nextState, action.summary);
    runAutoEvents(this.project, nextState, { choiceResolver: this.choiceResolver });
    syncProgress(nextState);
    return this.stabilizeState(nextState);
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

  applyFightToLevelUpAction(state, action) {
    let nextState = state;
    (action.plan || []).forEach((summary) => {
      const battleAction = this.enumerateBattleActionsOnly(nextState).find((candidate) => candidate.summary === summary);
      if (!battleAction) {
        throw new Error(`Unable to replay fightToLevelUp step: ${summary}`);
      }
      nextState = this.applyAction(nextState, battleAction);
    });
    return nextState;
  }

  applyResourcePocketAction(state, action) {
    let nextState = state;
    (action.plan || []).forEach((summary) => {
      const primitiveAction = this.enumeratePrimitiveActions(nextState).actions.find((candidate) => candidate.summary === summary);
      if (!primitiveAction) {
        throw new Error(`Unable to replay resourcePocket step: ${summary}`);
      }
      nextState = this.applyAction(nextState, primitiveAction);
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
