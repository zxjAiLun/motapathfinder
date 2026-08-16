"use strict";

const crypto = require("node:crypto");

/**
 * PR-5.19d parent dependency continuation identity helpers.
 *
 * A parent continuation is intent bookkeeping, not game state and not part of
 * the DP key. The dedupe contract is:
 *
 *   (parentDependencyId, exactStateKey)
 *
 * so a state already created by ordinary strategic search does not drop a
 * parent intent merely because finalCreated === false.
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

module.exports = {
  dependencyTargetFloorId,
  parentContinuationId,
  parentContinuationKey,
};
