"use strict";

const LAZY_WORK_SCHEMA = "motapathfinder.strategic-lazy-work.v1";

const ALLOWED_KINDS = new Set([
  "deferred-exact-post",
  "floorfly-choice",
  "connector-choice",
  "blocker-connector-choice",
  "dependency-connector-choice",
  "battle-access-prerequisite-choice",
]);

const ALLOWED_STATUS = new Set(["queued", "resolved", "rejected"]);

/**
 * Lazy strategic work lifecycle. Items are queued first and resolved on
 * demand; nothing may disappear without moving to `resolved` or `rejected`.
 *
 * A work item carries the minimal payload needed to materialize it later:
 *
 *   { kind, sourceNodeId, sourceState, stateKey, action, choiceLabel,
 *     target, ... }
 *
 * Kinds:
 *   - deferred-exact-post: a non-canonical exact post state from a transition.
 *   - floorfly-choice:       a per-target-floor floorFly choice (variants lazy).
 *   - connector-choice:      a direct-unavailable strategic choice for the
 *                            local DP connector.
 */
class LazyWorkQueue {
  constructor() {
    this.items = [];
    this.indexById = new Map();
    this.cursor = 0;
    this.nextId = 1;
    this.counts = { queued: 0, resolved: 0, rejected: 0 };
    this.resolvedByKind = {};
    this.rejectedByKind = {};
    this.rejectionReasons = {};
  }

  enqueue(payload) {
    const kind = payload && payload.kind;
    if (!ALLOWED_KINDS.has(kind)) {
      throw new Error(`Unsupported lazy work kind: ${kind}`);
    }
    const work = {
      ...payload,
      schema: LAZY_WORK_SCHEMA,
      id: `lazy-${this.nextId}`,
      kind,
      status: "queued",
      reason: null,
    };
    this.nextId += 1;
    this.items.push(work);
    this.indexById.set(work.id, work);
    this.counts.queued += 1;
    return work;
  }

  dequeue(isStale) {
    const filter = typeof isStale === "function" ? isStale : () => false;
    for (let attempts = 0; attempts < this.items.length; attempts += 1) {
      const index = this.cursor % this.items.length;
      this.cursor += 1;
      const work = this.items[index];
      if (work.status !== "queued") continue;
      if (filter(work)) {
        this.reject(work, "stale-on-dequeue");
        continue;
      }
      return work;
    }
    return null;
  }

  resolve(work, reason) {
    if (!work || work.status !== "queued") return work;
    work.status = "resolved";
    work.reason = reason || "resolved";
    this.counts.queued -= 1;
    this.counts.resolved += 1;
    this.resolvedByKind[work.kind] = number(this.resolvedByKind[work.kind], 0) + 1;
    return work;
  }

  reject(work, reason) {
    if (!work || work.status !== "queued") return work;
    work.status = "rejected";
    work.reason = reason || "rejected";
    this.counts.queued -= 1;
    this.counts.rejected += 1;
    this.rejectedByKind[work.kind] = number(this.rejectedByKind[work.kind], 0) + 1;
    this.rejectionReasons[reason || "rejected"] =
      number(this.rejectionReasons[reason || "rejected"], 0) + 1;
    return work;
  }

  activeSize() {
    return this.items.reduce((sum, work) => sum + (work.status === "queued" ? 1 : 0), 0);
  }

  queued() {
    return this.items.filter((work) => work.status === "queued");
  }

  snapshot() {
    return {
      schema: LAZY_WORK_SCHEMA,
      active: this.activeSize(),
      total: this.items.length,
      counts: { ...this.counts },
      resolvedByKind: { ...this.resolvedByKind },
      rejectedByKind: { ...this.rejectedByKind },
      rejectionReasons: { ...this.rejectionReasons },
    };
  }
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

module.exports = {
  ALLOWED_KINDS,
  ALLOWED_STATUS,
  LAZY_WORK_SCHEMA,
  LazyWorkQueue,
};
