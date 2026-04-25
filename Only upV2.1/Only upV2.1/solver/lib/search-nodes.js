"use strict";

function createRootNode(state, stateKey) {
  return {
    nodeId: 0,
    parentId: null,
    state,
    stateKey,
    rank: null,
    depth: 0,
    order: 0,
    actionEntry: null,
  };
}

function normalizeActionEntry(action) {
  if (!action) return null;
  return {
    summary: action.summary || action.kind || "unknown",
    kind: action.kind || null,
    fingerprint: action.fingerprint || null,
    floorId: action.floorId || (action.travelState && action.travelState.floorId) || null,
    x: action.x != null ? action.x : null,
    y: action.y != null ? action.y : null,
    target: action.target || null,
    stance: action.stance || null,
    path: Array.isArray(action.path) ? action.path.slice() : [],
    direction: action.direction || null,
    tool: action.tool || null,
    equipId: action.equipId || null,
    equipType: action.equipType == null ? null : action.equipType,
    enemyId: action.enemyId || null,
    itemId: action.itemId || null,
    doorId: action.doorId || null,
    eventId: action.eventId || null,
    changeFloor: action.changeFloor || null,
    estimate: action.estimate || null,
    plan: Array.isArray(action.plan) ? action.plan.slice() : null,
    planEntries: Array.isArray(action.planEntries) ? action.planEntries.slice() : null,
  };
}

function createChildNode(parentNode, state, stateKey, action, nodeId, order) {
  return {
    nodeId,
    parentId: parentNode ? parentNode.nodeId : null,
    state,
    stateKey,
    rank: null,
    depth: parentNode ? parentNode.depth + 1 : 0,
    order: order == null ? nodeId : order,
    actionEntry: normalizeActionEntry(action),
  };
}

function reconstructRoute(nodes, goalNodeOrId) {
  const route = [];
  let node = typeof goalNodeOrId === "object" ? goalNodeOrId : nodes.get(goalNodeOrId);
  while (node && node.parentId != null) {
    if (node.actionEntry && node.actionEntry.summary) route.push(node.actionEntry.summary);
    node = nodes.get(node.parentId);
  }
  return route.reverse();
}

function reconstructNodeChain(nodes, goalNodeOrId) {
  const chain = [];
  let node = typeof goalNodeOrId === "object" ? goalNodeOrId : nodes.get(goalNodeOrId);
  while (node) {
    chain.push(node);
    node = nodes.get(node.parentId);
  }
  return chain.reverse();
}

function reconstructActionEntries(nodes, goalNodeOrId) {
  return reconstructNodeChain(nodes, goalNodeOrId)
    .slice(1)
    .map((node) => node.actionEntry)
    .filter(Boolean);
}

function attachRouteToState(nodes, nodeOrId) {
  const node = typeof nodeOrId === "object" ? nodeOrId : nodes.get(nodeOrId);
  if (!node || !node.state) return null;
  node.state.route = reconstructRoute(nodes, node);
  return node.state;
}

module.exports = {
  attachRouteToState,
  createChildNode,
  createRootNode,
  normalizeActionEntry,
  reconstructActionEntries,
  reconstructNodeChain,
  reconstructRoute,
};
