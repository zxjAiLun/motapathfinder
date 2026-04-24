"use strict";

const { coordinateKey, isDoorTile } = require("./reachability");
const { consumeItem, getInventoryCount, removeTileAt } = require("./state");

function countRequiredItems(requirements, state) {
  return Object.entries(requirements || {}).every(([itemId, amount]) => getInventoryCount(state, itemId) >= amount);
}

class GenericDoorResolver {
  canOpenDoor(context) {
    const { state, tile } = context;
    if (!isDoorTile(tile)) return false;
    return countRequiredItems(tile.doorInfo && tile.doorInfo.keys, state);
  }

  buildAction(context) {
    const { state, direction, targetX, targetY, tile, path } = context;
    return {
      kind: "openDoor",
      floorId: state.floorId,
      stance: { x: context.node.x, y: context.node.y },
      direction,
      target: { x: targetX, y: targetY },
      doorId: tile.id,
      requirements: { ...((tile.doorInfo && tile.doorInfo.keys) || {}) },
      doorAfterOpenDoor: tile.doorInfo && tile.doorInfo.afterOpenDoor,
      path,
      travelState: state,
      summary: `openDoor:${tile.id}@${state.floorId}:${targetX},${targetY}`,
    };
  }

  enumerateActions(context) {
    const { project, helper } = context;
    return helper.findAdjacencyActions(
      (node, tile, targetX, targetY) => this.canOpenDoor({ project, state: node.state, tile, targetX, targetY }),
      (node, direction, targetX, targetY, tile, path) =>
        this.buildAction({ project, state: node.state, node, direction, targetX, targetY, tile, path })
    );
  }

  applyAction(context) {
    const { project, state, action, executeActionList, choiceResolver } = context;

    Object.entries(action.requirements || {}).forEach(([itemId, amount]) => {
      consumeItem(state, itemId, amount);
    });
    removeTileAt(state, state.floorId, action.target.x, action.target.y);

    if (Array.isArray(action.doorAfterOpenDoor)) {
      executeActionList(
        project,
        state,
        action.doorAfterOpenDoor,
        { floorId: state.floorId, eventLoc: { x: action.target.x, y: action.target.y } },
        { choiceResolver }
      );
    }

    const floor = project.floorsById[state.floorId];
    const afterOpenDoor = (floor.afterOpenDoor || {})[coordinateKey(action.target.x, action.target.y)];
    if (!afterOpenDoor) return;

    executeActionList(
      project,
      state,
      afterOpenDoor,
      { floorId: state.floorId, eventLoc: { x: action.target.x, y: action.target.y } },
      { choiceResolver }
    );
  }
}

module.exports = {
  GenericDoorResolver,
};
