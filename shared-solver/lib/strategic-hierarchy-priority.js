"use strict";

/**
 * PR-5.19e hierarchical connector call allocation.
 *
 * This is scheduler bookkeeping only. It does not add connector capability,
 * does not change connector per-call budget, and does not alter game state,
 * exact-state keys, or DP keys.
 *
 * Semantics:
 *   - activate: a P(B) success produced a parent continuation that may later
 *     need a deeper connector call. New root/sibling connector attempts must
 *     stop taking call slots while at least one continuation is active.
 *   - releaseForCall: the deeper attempt for originContinuationId received
 *     real connector feedback (success, failure, frontier, or budget).
 *   - releaseContinuation: the continuation became blocked, unsupported,
 *     parent-reachable/completable, or otherwise no longer needs a call.
 */
class HierarchyPriorityController {
  constructor() {
    this.active = new Set();
  }

  activate(continuationId) {
    if (!continuationId || this.active.has(continuationId)) return false;
    this.active.add(continuationId);
    return true;
  }

  releaseForCall(originContinuationId) {
    if (!originContinuationId) return false;
    return this.active.delete(originContinuationId);
  }

  releaseContinuation(continuationId) {
    if (!continuationId) return false;
    return this.active.delete(continuationId);
  }

  isActive() {
    return this.active.size > 0;
  }

  activeContinuationIds() {
    return Array.from(this.active).sort();
  }

  get activeCount() {
    return this.active.size;
  }
}

module.exports = {
  HierarchyPriorityController,
};
