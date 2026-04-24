"use strict";

const { runAutoEvents } = require("./events");
const { buildMovementHazards } = require("./movement-hazards");
const { DIRECTIONS, DIRECTION_DELTAS, coordinateKey, isDoorTile, isEnemyTile } = require("./reachability");
const { buildStateKey } = require("./state-key");
const { cloneState, floorHasCoordinate, getTileDefinitionAt } = require("./state");

function isEndpointTile(project, state, floorId, x, y) {
  const floor = project.floorsById[floorId];
  if ((floor.changeFloor || {})[coordinateKey(x, y)]) return true;

  const tile = getTileDefinitionAt(project, state, floorId, x, y);
  if (!tile) return false;
  if (tile.cls === "items") return true;
  if (tile.trigger != null && tile.trigger !== "null" && tile.trigger !== "passNet") return true;
  return false;
}

function isTransitTile(project, state, floorId, x, y) {
  if (!floorHasCoordinate(project, floorId, x, y)) return false;
  if (isEndpointTile(project, state, floorId, x, y)) return false;

  const tile = getTileDefinitionAt(project, state, floorId, x, y);
  if (tile == null) return true;
  if (isEnemyTile(tile)) return false;
  if (isDoorTile(tile)) return false;
  return tile.canPass === true;
}

function isStepPassableTile(project, state, floorId, x, y) {
  if (!floorHasCoordinate(project, floorId, x, y)) return false;

  const tile = getTileDefinitionAt(project, state, floorId, x, y);
  if (tile == null) return true;
  if (isEnemyTile(tile)) return false;
  if (isDoorTile(tile)) return false;
  if (tile.cls === "items") return true;
  return tile.canPass === true;
}

function getHazardsForState(project, state, options, cache) {
  const key = buildStateKey(state);
  if (!cache.has(key)) {
    cache.set(
      key,
      buildMovementHazards(project, state, {
        floorId: state.floorId,
        battleResolver: options.battleResolver,
      })
    );
  }
  return cache.get(key);
}

function applyPoison(project, state) {
  if (!state.flags.poison) return true;
  const poisonDamage = Number(project.values.poisonDamage || 0);
  if (!state.hero.statistics) state.hero.statistics = {};
  state.hero.statistics.poisonDamage = Number(state.hero.statistics.poisonDamage || 0) + poisonDamage;
  state.hero.hp = Number(state.hero.hp || 0) - poisonDamage;
  return state.hero.hp > 0;
}

function applyLandingHazards(project, state, options, hazardCache) {
  const hazards = getHazardsForState(project, state, options, hazardCache);
  const loc = coordinateKey(state.hero.loc.x, state.hero.loc.y);
  const damage = Number(hazards.damage[loc] || 0);
  if (damage > 0) {
    if (!state.hero.statistics) state.hero.statistics = {};
    state.hero.statistics.extraDamage = Number(state.hero.statistics.extraDamage || 0) + damage;
    state.hero.hp = Number(state.hero.hp || 0) - damage;
    if (state.hero.hp <= 0) return false;
  }

  const repulse = hazards.repulse[loc] || [];
  if (repulse.length > 0) {
    state.notes.push(`Repulse at ${state.floorId}:${loc} is not modeled yet.`);
    return false;
  }

  const ambush = hazards.ambush[loc] || [];
  for (const [x, y, enemyId] of ambush) {
    options.battleResolver.applyBattleAt({
      project,
      state,
      floorId: state.floorId,
      x,
      y,
      enemyId,
      executeActionList: options.executeActionList,
      choiceResolver: options.choiceResolver,
    });
    if (state.floorId == null || state.hero.hp <= 0) return false;
  }

  runAutoEvents(project, state, { choiceResolver: options.choiceResolver });
  return state.hero.hp > 0;
}

function stepOntoTile(project, state, direction, options, hazardCache) {
  const config = options || {};
  const delta = DIRECTION_DELTAS[direction];
  const nextX = state.hero.loc.x + delta.x;
  const nextY = state.hero.loc.y + delta.y;
  const predicate = config.predicate || isStepPassableTile;
  if (!predicate(project, state, state.floorId, nextX, nextY)) return null;

  const nextState = cloneState(state);
  nextState.hero.loc.x = nextX;
  nextState.hero.loc.y = nextY;
  nextState.hero.loc.direction = direction;
  nextState.hero.steps = Number(nextState.hero.steps || 0) + 1;

  if (!applyPoison(project, nextState)) return null;
  if (typeof config.beforeHazards === "function") {
    const shouldContinue = config.beforeHazards(nextState);
    if (shouldContinue === false || nextState.hero.hp <= 0) return null;
  }
  if (!applyLandingHazards(project, nextState, options, hazardCache)) return null;
  if (typeof config.afterHazards === "function") {
    const shouldContinue = config.afterHazards(nextState);
    if (shouldContinue === false || nextState.hero.hp <= 0) return null;
  }
  if (typeof config.stabilizeState === "function") {
    const stabilizedState = config.stabilizeState(nextState);
    if (!stabilizedState || stabilizedState.floorId == null || stabilizedState.hero.hp <= 0) return null;
    return stabilizedState;
  }
  return nextState;
}

function simulateTransitStep(project, state, direction, options, hazardCache) {
  return stepOntoTile(
    project,
    state,
    direction,
    {
      ...options,
      predicate: isTransitTile,
    },
    hazardCache
  );
}

function buildWalkReachability(project, state, options) {
  const config = options || {};
  const initialState = cloneState(state);
  const initialKey = buildStateKey(initialState);
  const hazardCache = new Map();
  const queue = [
    {
      x: initialState.hero.loc.x,
      y: initialState.hero.loc.y,
      distance: 0,
      path: [],
      state: initialState,
    },
  ];
  const visited = {
    [initialKey]: queue[0],
  };

  while (queue.length > 0) {
    const node = queue.shift();

    DIRECTIONS.forEach((direction) => {
      const nextState = simulateTransitStep(project, node.state, direction, config, hazardCache);
      if (!nextState) return;
      if (nextState.floorId !== state.floorId) return;

      const key = buildStateKey(nextState);
      if (visited[key]) return;

      visited[key] = {
        x: nextState.hero.loc.x,
        y: nextState.hero.loc.y,
        distance: node.distance + 1,
        path: node.path.concat(direction),
        state: nextState,
      };
      queue.push(visited[key]);
    });
  }

  return {
    start: { x: state.hero.loc.x, y: state.hero.loc.y },
    visited,
  };
}

module.exports = {
  buildWalkReachability,
  isEndpointTile,
  isStepPassableTile,
  isTransitTile,
  stepOntoTile,
};
