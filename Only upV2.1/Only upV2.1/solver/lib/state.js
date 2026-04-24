"use strict";

function cloneState(state) {
  const cloned = typeof structuredClone === "function"
    ? structuredClone(state)
    : JSON.parse(JSON.stringify(state));
  if (cloned.meta && cloned.meta.__frontierFeatures) {
    delete cloned.meta.__frontierFeatures;
  }
  return cloned;
}

function flattenInventory(heroItems) {
  const inventory = {};
  if (heroItems == null) return inventory;

  ["tools", "constants", "equips"].forEach((bucket) => {
    Object.entries(heroItems[bucket] || {}).forEach(([itemId, amount]) => {
      if (amount > 0) inventory[itemId] = amount;
    });
  });

  return inventory;
}

function ensureMeta(state) {
  if (state.meta == null) state.meta = {};
  if (typeof state.meta.rank === "undefined") state.meta.rank = null;
  if (typeof state.meta.decisionDepth !== "number") state.meta.decisionDepth = 0;
  if (typeof state.meta.autoStepCount !== "number") state.meta.autoStepCount = 0;
  if (typeof state.meta.autoPickupCount !== "number") state.meta.autoPickupCount = 0;
  if (typeof state.meta.autoBattleCount !== "number") state.meta.autoBattleCount = 0;
  return state.meta;
}

function getDecisionDepth(state) {
  return Number(ensureMeta(state).decisionDepth || 0);
}

function createInitialState(project, options) {
  const config = options || {};
  const hero = cloneState((project.data.firstData || {}).hero || {});
  const inventory = flattenInventory(hero.items || {});
  delete hero.items;

  if (config.rank === "easy") inventory.I581 = 1;
  else if (config.rank === "hard") inventory.I582 = 1;

  return {
    floorId: project.data.firstData.floorId,
    hero,
    inventory,
    flags: cloneState(hero.flags || {}),
    floorStates: {},
    visitedFloors: {},
    triggeredAutoEvents: {},
    route: [],
    notes: [],
    meta: {
      rank: config.rank || null,
      decisionDepth: 0,
      autoStepCount: 0,
      autoPickupCount: 0,
      autoBattleCount: 0,
    },
  };
}

function ensureFloorState(state, floorId) {
  if (state.floorStates[floorId] == null) {
    state.floorStates[floorId] = {
      removed: {},
      replaced: {},
    };
  }
  return state.floorStates[floorId];
}

function hasVisitedFloor(state, floorId) {
  return Boolean(state.visitedFloors[floorId]);
}

function visitFloor(state, floorId) {
  state.visitedFloors[floorId] = true;
}

function getInventoryCount(state, itemId) {
  return Number(state.inventory[itemId] || 0);
}

function hasItem(state, itemId, amount) {
  return getInventoryCount(state, itemId) >= (amount || 1);
}

function addItem(state, itemId, amount) {
  const delta = Number(amount || 1);
  state.inventory[itemId] = getInventoryCount(state, itemId) + delta;
}

function consumeItem(state, itemId, amount) {
  const delta = Number(amount || 1);
  const nextAmount = getInventoryCount(state, itemId) - delta;
  if (nextAmount < 0) {
    throw new Error(`Cannot consume ${delta} of ${itemId}; only ${getInventoryCount(state, itemId)} available.`);
  }
  if (nextAmount === 0) delete state.inventory[itemId];
  else state.inventory[itemId] = nextAmount;
}

function floorHasCoordinate(project, floorId, x, y) {
  const floor = project.floorsById[floorId];
  return x >= 0 && y >= 0 && x < floor.width && y < floor.height;
}

function getBaseTileNumber(project, floorId, x, y) {
  const floor = project.floorsById[floorId];
  if (!floorHasCoordinate(project, floorId, x, y)) return null;
  return floor.map[y][x];
}

function getTileNumberAt(project, state, floorId, x, y) {
  if (!floorHasCoordinate(project, floorId, x, y)) return null;
  const floorState = ensureFloorState(state, floorId);
  const key = `${x},${y}`;
  if (floorState.removed[key]) return null;
  if (Object.prototype.hasOwnProperty.call(floorState.replaced, key)) {
    return floorState.replaced[key];
  }
  return getBaseTileNumber(project, floorId, x, y);
}

function getTileDefinitionAt(project, state, floorId, x, y) {
  const number = getTileNumberAt(project, state, floorId, x, y);
  if (number == null) return null;
  if (number === 0) return null;
  const definition = project.mapTilesByNumber[String(number)];
  if (definition == null) {
    return {
      number,
      id: `X${number}`,
      cls: "unknown",
      canPass: false,
      noPass: true,
    };
  }
  return {
    number,
    ...definition,
  };
}

function removeTileAt(state, floorId, x, y) {
  const floorState = ensureFloorState(state, floorId);
  const key = `${x},${y}`;
  floorState.removed[key] = true;
  delete floorState.replaced[key];
}

function replaceTileAt(state, floorId, x, y, number) {
  const floorState = ensureFloorState(state, floorId);
  const key = `${x},${y}`;
  floorState.replaced[key] = number;
  delete floorState.removed[key];
}

function appendRouteStep(state, step, options) {
  const config = options || {};
  const meta = ensureMeta(state);
  state.route.push(step);
  if (config.decision === false) {
    meta.autoStepCount += 1;
    if (config.auto === "pickup") meta.autoPickupCount += 1;
    if (config.auto === "battle") meta.autoBattleCount += 1;
    return;
  }
  meta.decisionDepth += 1;
}

function listFloorMutationSummary(floorStates) {
  return Object.keys(floorStates)
    .sort()
    .map((floorId) => {
      const floorState = floorStates[floorId];
      return {
        floorId,
        removed: Object.keys(floorState.removed || {}).sort(),
        replaced: Object.entries(floorState.replaced || {})
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, value]) => `${key}=${value}`),
      };
    });
}

module.exports = {
  addItem,
  appendRouteStep,
  cloneState,
  consumeItem,
  createInitialState,
  ensureMeta,
  ensureFloorState,
  floorHasCoordinate,
  getDecisionDepth,
  getBaseTileNumber,
  getInventoryCount,
  getTileDefinitionAt,
  getTileNumberAt,
  hasItem,
  hasVisitedFloor,
  listFloorMutationSummary,
  removeTileAt,
  replaceTileAt,
  visitFloor,
};
