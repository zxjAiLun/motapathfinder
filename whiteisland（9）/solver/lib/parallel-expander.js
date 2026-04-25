"use strict";

function chunk(items, size) {
  const chunkSize = Math.max(1, Number(size || 32));
  const chunks = [];
  for (let index = 0; index < items.length; index += chunkSize) chunks.push(items.slice(index, index + chunkSize));
  return chunks;
}

function compactStateForWorker(state) {
  return {
    floorId: state.floorId,
    hero: state.hero,
    inventory: state.inventory,
    flags: state.flags,
    floorStates: state.floorStates,
    visitedFloors: state.visitedFloors,
    triggeredAutoEvents: state.triggeredAutoEvents,
    notes: [],
    route: [],
    meta: {
      rank: state.meta && state.meta.rank,
      decisionDepth: state.meta && state.meta.decisionDepth,
      autoStepCount: state.meta && state.meta.autoStepCount,
      autoPickupCount: state.meta && state.meta.autoPickupCount,
      autoBattleCount: state.meta && state.meta.autoBattleCount,
    },
  };
}

function serializeNodeForWorker(node, order) {
  return {
    nodeId: node.nodeId == null ? node.id : node.nodeId,
    order: order == null ? node.order : order,
    depth: node.depth,
    state: compactStateForWorker(node.state),
  };
}

function stableMergeResults(results) {
  const candidates = [];
  results.forEach((result) => {
    (result.candidates || []).forEach((candidate) => candidates.push(candidate));
  });
  candidates.sort((left, right) => {
    if (left.parentOrder !== right.parentOrder) return left.parentOrder - right.parentOrder;
    return left.actionIndex - right.actionIndex;
  });
  return candidates;
}

module.exports = {
  chunk,
  compactStateForWorker,
  serializeNodeForWorker,
  stableMergeResults,
};
