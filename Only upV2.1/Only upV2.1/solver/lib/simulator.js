"use strict";

const { applyPickup } = require("./effect-vm");
const { AutoActionResolver } = require("./auto-actions");
const { EquipmentResolver } = require("./equipment-resolver");
const { applyFloorArrival, executeActionList, runAutoEvents } = require("./events");
const { resolveChangeFloorTarget } = require("./floor-transitions");
const { computeFrontierFeatures } = require("./frontier-features");
const { DIRECTIONS, DIRECTION_DELTAS, coordinateKey } = require("./reachability");
const { UnsupportedBattleResolver } = require("./battle-resolver");
const { buildDominanceBucketKey, buildDominanceSummary, dominatesSummary } = require("./dominance");
const { GenericDoorResolver } = require("./door-resolver");
const { compareScore, compareSearchRank, defaultScore, defaultSearchRank } = require("./score");
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

      const action = buildAction(node, direction, targetX, targetY, tile, node.path, node.state);
      const stateKey = buildStateKey(action.travelState || node.state);
      keepShortestAction(actionsByKey, `${targetX},${targetY}:${action.kind}:${stateKey}`, action);
    });
  });

  return Array.from(actionsByKey.values());
}

class StaticSimulator {
  constructor(project, options) {
    const config = options || {};
    this.project = project;
    this.stopFloorId = config.stopFloorId || "MT11";
    this.scoreFn = config.scoreFn || defaultScore;
    this.searchRankFn = config.searchRankFn || defaultSearchRank;
    this.dominanceBucketKeyFn = config.dominanceBucketKeyFn || buildDominanceBucketKey;
    this.dominanceSummaryFn = config.dominanceSummaryFn || buildDominanceSummary;
    this.dominatesFn = config.dominatesFn || dominatesSummary;
    this.battleResolver = config.battleResolver || new UnsupportedBattleResolver();
    this.doorResolver = config.doorResolver || new GenericDoorResolver();
    this.equipmentResolver = config.equipmentResolver || new EquipmentResolver();
    this.toolRegistry = config.toolRegistry || new ToolRegistry();
    this.autoResolver = config.autoResolver || new AutoActionResolver({
      autoPickupEnabled: config.autoPickupEnabled,
      autoBattleEnabled: config.autoBattleEnabled,
    });
    this.choiceResolver = config.choiceResolver;
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

  enumerateActions(state) {
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
    actions.push(...this.toolRegistry.enumerateActions({ project: this.project, state, floor, reachability, helper }));

    const battleActions = this.battleResolver.enumerateActions({
      project: this.project,
      state,
      reachability,
    });
    actions.push(...battleActions);

    return this.sortActions(state, actions);
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
      case "battle":
        this.battleResolver.applyAction({
          project: this.project,
          state: nextState,
          action,
          executeActionList,
          choiceResolver: this.choiceResolver,
        });
        break;
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
