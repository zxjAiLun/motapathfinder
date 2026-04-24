"use strict";

const { isEnemyTile } = require("./reachability");
const { consumeItem, hasItem, removeTileAt } = require("./state");

class ToolRegistry {
  constructor(handlers) {
    this.handlers = new Map();
    (handlers || createDefaultHandlers()).forEach((handler) => {
      this.handlers.set(handler.id, handler);
    });
  }

  register(handler) {
    if (!handler || !handler.id) {
      throw new Error("Tool handler must provide an id.");
    }
    this.handlers.set(handler.id, handler);
  }

  enumerateActions(context) {
    const actions = [];
    this.handlers.forEach((handler) => {
      if (typeof handler.isAvailable === "function" && !handler.isAvailable(context)) return;
      if (typeof handler.enumerateActions !== "function") return;
      actions.push(...handler.enumerateActions(context));
    });
    return actions;
  }

  applyAction(context) {
    const handler = this.handlers.get(context.action.tool);
    if (!handler || typeof handler.applyAction !== "function") {
      throw new Error(`Unsupported tool action: ${context.action.tool}`);
    }
    handler.applyAction(context);
  }
}

function createPickaxeHandler() {
  return {
    id: "pickaxe",
    isAvailable: ({ state }) => hasItem(state, "pickaxe"),
    enumerateActions: ({ helper }) =>
      helper.findAdjacencyActions(
        (node, tile) => hasItem(node.state, "pickaxe") && tile != null && tile.canBreak === true,
        (node, direction, targetX, targetY, tile, path) => ({
          kind: "useTool",
          tool: "pickaxe",
          floorId: node.state.floorId,
          stance: { x: node.x, y: node.y },
          direction,
          target: { x: targetX, y: targetY },
          tileId: tile.id,
          path,
          travelState: node.state,
          summary: `use:pickaxe@${node.state.floorId}:${targetX},${targetY}`,
        })
      ),
    applyAction: ({ state, action }) => {
      consumeItem(state, "pickaxe", 1);
      removeTileAt(state, state.floorId, action.target.x, action.target.y);
    },
  };
}

function createBombHandler() {
  return {
    id: "bomb",
    isAvailable: ({ state }) => hasItem(state, "bomb"),
    enumerateActions: ({ project, helper }) =>
      helper.findAdjacencyActions(
        (node, tile) => {
          if (!hasItem(node.state, "bomb")) return false;
          if (!isEnemyTile(tile)) return false;
          const enemy = project.enemysById[tile.id];
          return !enemy || enemy.notBomb !== true;
        },
        (node, direction, targetX, targetY, tile, path) => ({
          kind: "useTool",
          tool: "bomb",
          floorId: node.state.floorId,
          stance: { x: node.x, y: node.y },
          direction,
          target: { x: targetX, y: targetY },
          enemyId: tile.id,
          path,
          travelState: node.state,
          summary: `use:bomb@${node.state.floorId}:${targetX},${targetY}`,
        })
      ),
    applyAction: ({ project, state, action }) => {
      consumeItem(state, "bomb", 1);
      const enemy = project.enemysById[action.enemyId] || {};
      state.hero.money += Number(enemy.money || 0);
      state.hero.exp += Number(enemy.exp || 0);
      removeTileAt(state, state.floorId, action.target.x, action.target.y);
    },
  };
}

function createCenterFlyHandler() {
  return {
    id: "centerFly",
    isAvailable: ({ state }) => hasItem(state, "centerFly"),
    enumerateActions: ({ state, floor }) => {
      const mirroredX = floor.width - 1 - state.hero.loc.x;
      const mirroredY = floor.height - 1 - state.hero.loc.y;
      return [
        {
          kind: "useTool",
          tool: "centerFly",
          floorId: state.floorId,
          target: { x: mirroredX, y: mirroredY },
          path: [],
          summary: `use:centerFly@${state.floorId}:${mirroredX},${mirroredY}`,
        },
      ];
    },
    applyAction: ({ state, action }) => {
      consumeItem(state, "centerFly", 1);
      state.hero.loc.x = action.target.x;
      state.hero.loc.y = action.target.y;
    },
  };
}

function createDefaultHandlers() {
  return [createPickaxeHandler(), createBombHandler(), createCenterFlyHandler()];
}

module.exports = {
  ToolRegistry,
  createDefaultHandlers,
};
