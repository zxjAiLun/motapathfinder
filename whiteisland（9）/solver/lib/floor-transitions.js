"use strict";

const { evaluateExpression } = require("./expression");
const { getTileDefinitionAt } = require("./state");

function resolveRelativeFloor(project, currentFloorId, targetFloorId) {
  if (targetFloorId !== ":before" && targetFloorId !== ":next") {
    return targetFloorId;
  }

  const index = project.floorOrder.indexOf(currentFloorId);
  if (index < 0) {
    throw new Error(`Floor ${currentFloorId} is not present in floor order.`);
  }

  if (targetFloorId === ":before") {
    if (index === 0) throw new Error(`Floor ${currentFloorId} has no previous floor.`);
    return project.floorOrder[index - 1];
  }

  if (index >= project.floorOrder.length - 1) {
    throw new Error(`Floor ${currentFloorId} has no next floor.`);
  }
  return project.floorOrder[index + 1];
}

function findTilePositionById(project, state, floorId, tileId) {
  const floor = project.floorsById[floorId];
  for (let y = 0; y < floor.height; y += 1) {
    for (let x = 0; x < floor.width; x += 1) {
      const tile = getTileDefinitionAt(project, state, floorId, x, y);
      if (tile && tile.id === tileId) {
        return { x, y };
      }
    }
  }
  return null;
}

function resolveLandingLocation(project, state, targetFloorId, changeData) {
  if (Array.isArray(changeData.loc) && changeData.loc.length === 2) {
    return {
      x: Number(evaluateExpression(changeData.loc[0], project, state)),
      y: Number(evaluateExpression(changeData.loc[1], project, state)),
    };
  }

  if (changeData.stair) {
    const landing = findTilePositionById(project, state, targetFloorId, changeData.stair);
    if (landing) return landing;
  }

  return { x: state.hero.loc.x, y: state.hero.loc.y };
}

function resolveChangeFloorTarget(project, state, changeData) {
  const targetFloorId = resolveRelativeFloor(project, state.floorId, changeData.floorId);
  const targetLoc = resolveLandingLocation(project, state, targetFloorId, changeData);
  return {
    floorId: targetFloorId,
    x: targetLoc.x,
    y: targetLoc.y,
    direction: changeData.direction || state.hero.loc.direction || "down",
  };
}

module.exports = {
  resolveChangeFloorTarget,
  resolveRelativeFloor,
};
