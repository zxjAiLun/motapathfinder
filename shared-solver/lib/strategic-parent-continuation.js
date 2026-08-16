"use strict";

const crypto = require("node:crypto");

/**
 * PR-5.19d parent dependency continuation identity and lineage helpers.
 *
 * A parent continuation is intent bookkeeping, not game state and not part of
 * the DP key. The dedupe contract is:
 *
 *   (parentDependencyId, exactStateKey)
 *
 * so a state already created by ordinary strategic search does not drop a
 * parent intent merely because finalCreated === false.
 *
 * Repair 1 additionally anchors the continuation at the canonical post-state
 * search node and requires that any later resume candidate legally descends
 * from that anchor. anchorNodeId is provenance only and never enters game
 * state, exact state key, DP key, or continuation semantic identity.
 */

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}

function dependencyTargetFloorId(target) {
  if (!target) return null;
  if (target.floorId != null) return target.floorId;
  if (target.acquisition && target.acquisition.floorId != null) return target.acquisition.floorId;
  return null;
}

function parentContinuationKey(parentDependencyId, exactStateKey) {
  return `${parentDependencyId || "unknown-parent-dependency"}@${exactStateKey || "unknown-exact-state"}`;
}

function parentContinuationId(parentDependencyId, exactStateKey) {
  return hash(`parent-dependency-continuation|${parentContinuationKey(parentDependencyId, exactStateKey)}`);
}

function isNodeDescendantOf(nodes, candidateNode, anchorNodeId) {
  if (!nodes || !candidateNode) return false;
  const visited = new Set();
  let current = candidateNode;
  while (current) {
    if (visited.has(current.nodeId)) return false;
    if (current.nodeId === anchorNodeId) return true;
    visited.add(current.nodeId);
    if (current.parentId == null) return false;
    current = nodes.get(current.parentId);
  }
  return false;
}

module.exports = {
  dependencyTargetFloorId,
  isNodeDescendantOf,
  parentContinuationId,
  parentContinuationKey,
};
