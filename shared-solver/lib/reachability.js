"use strict";

const { floorHasCoordinate, getTileDefinitionAt } = require("./state");

const DIRECTIONS = ["up", "right", "down", "left"];
const DIRECTION_DELTAS = {
  up: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

function coordinateKey(x, y) {
  return `${x},${y}`;
}

function isEnemyTile(tile) {
  return tile != null && typeof tile.cls === "string" && tile.cls.indexOf("enemy") === 0;
}

function isDoorTile(tile) {
  return tile != null && tile.trigger === "openDoor";
}

function isPassableTile(project, state, floorId, x, y) {
  const tile = getTileDefinitionAt(project, state, floorId, x, y);
  if (tile == null) return true;
  if (isEnemyTile(tile)) return false;
  if (isDoorTile(tile)) return false;
  if (tile.cls === "items") return true;
  if (tile.canPass === true) return true;
  return false;
}

// h5mota cannotIn names the side entered FROM, unlike cannotOut which
// names the movement direction. Keep occupancy separate for bump actions.
function canTraverseEdge(project, state, floorId, x, y, direction) {
  const delta = DIRECTION_DELTAS[direction];
  if (!delta || !floorHasCoordinate(project, floorId, x, y)) return false;
  const nx = x + delta.x, ny = y + delta.y;
  if (!floorHasCoordinate(project, floorId, nx, ny)) return false;
  const opposite = DIRECTIONS[(DIRECTIONS.indexOf(direction) + 2) % 4];
  const floor = project.floorsById[floorId];
  const source = getTileDefinitionAt(project, state, floorId, x, y);
  const target = getTileDefinitionAt(project, state, floorId, nx, ny);
  const blocked = (values, value) => Array.isArray(values) && values.includes(value);
  return !blocked((floor.cannotMove || {})[coordinateKey(x, y)], direction)
    && !blocked((floor.cannotMoveIn || {})[coordinateKey(nx, ny)], opposite)
    && !blocked(source && source.cannotOut, direction)
    && !blocked(target && target.cannotIn, opposite);
}

function buildReachability(project, state) {
  const floor = project.floorsById[state.floorId];
  const start = { x: state.hero.loc.x, y: state.hero.loc.y };
  const startKey = coordinateKey(start.x, start.y);
  const queue = [start];
  const visited = {
    [startKey]: {
      x: start.x,
      y: start.y,
      distance: 0,
      previous: null,
      direction: null,
    },
  };

  while (queue.length > 0) {
    const current = queue.shift();
    const currentKey = coordinateKey(current.x, current.y);
    const currentState = visited[currentKey];

    DIRECTIONS.forEach((direction) => {
      const delta = DIRECTION_DELTAS[direction];
      const nextX = current.x + delta.x;
      const nextY = current.y + delta.y;
      if (nextX < 0 || nextY < 0 || nextX >= floor.width || nextY >= floor.height) return;
      if (!canTraverseEdge(project, state, state.floorId, current.x, current.y, direction)) return;
      if (!isPassableTile(project, state, state.floorId, nextX, nextY)) return;

      const nextKey = coordinateKey(nextX, nextY);
      if (visited[nextKey]) return;

      visited[nextKey] = {
        x: nextX,
        y: nextY,
        distance: currentState.distance + 1,
        previous: currentKey,
        direction,
      };
      queue.push({ x: nextX, y: nextY });
    });
  }

  return {
    start,
    visited,
  };
}

function reconstructPath(reachability, x, y) {
  const targetKey = coordinateKey(x, y);
  if (!reachability.visited[targetKey]) return null;

  const steps = [];
  let currentKey = targetKey;
  while (currentKey) {
    const node = reachability.visited[currentKey];
    if (node.direction) steps.push(node.direction);
    currentKey = node.previous;
  }
  steps.reverse();
  return steps;
}

module.exports = {
  DIRECTIONS,
  DIRECTION_DELTAS,
  buildReachability,
  canTraverseEdge,
  coordinateKey,
  isDoorTile,
  isEnemyTile,
  isPassableTile,
  reconstructPath,
};
