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
  const entry = {
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
    targetFloorId: action.targetFloorId || null,
    enemyId: action.enemyId || null,
    itemId: action.itemId || null,
    doorId: action.doorId || null,
    eventId: action.eventId || null,
    changeFloor: action.changeFloor || null,
    estimate: action.estimate || null,
    plan: Array.isArray(action.plan) ? action.plan.slice() : null,
    planEntries: Array.isArray(action.planEntries) ? action.planEntries.slice() : null,
  };
  if (Array.isArray(action._routePatch)) {
    entry._routePatch = action._routePatch;
  }
  return entry;
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

function formatRouteEntry(entry) {
  if (typeof entry === "string") return entry;
  if (entry && entry.summary) return entry.summary;
  return null;
}

function reconstructRoute(nodes, goalNodeOrId) {
  const chunks = [];
  let node = typeof goalNodeOrId === "object" ? goalNodeOrId : nodes.get(goalNodeOrId);
  while (node && node.parentId != null) {
    const routePatch = Array.isArray(node.actionEntry && node.actionEntry._routePatch)
      ? node.actionEntry._routePatch
      : (node.state && Array.isArray(node.state._routePatch) ? node.state._routePatch : null);
    if (routePatch) {
      const entries = routePatch.map(formatRouteEntry).filter(Boolean);
      if (entries.length > 0) chunks.push(entries);
    } else if (node.actionEntry && node.actionEntry.summary) {
      chunks.push([node.actionEntry.summary]);
    }
    node = nodes.get(node.parentId);
  }
  return chunks.reverse().flat();
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

function reconstructActionTrace(nodes, goalNodeOrId) {
  const chain = reconstructNodeChain(nodes, goalNodeOrId);
  const trace = [];
  for (let index = 1; index < chain.length; index += 1) {
    const node = chain[index];
    if (!node || !node.actionEntry) continue;
    const parent = nodes.get(node.parentId);
    trace.push({
      actionEntry: node.actionEntry,
      preState: parent && parent.state,
      preStateKey: parent && parent.stateKey,
      postState: node.state,
      postStateKey: node.stateKey,
    });
  }
  return trace;
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
  reconstructActionTrace,
  reconstructNodeChain,
  reconstructRoute,
};
