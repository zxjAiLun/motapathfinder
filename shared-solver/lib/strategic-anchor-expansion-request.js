"use strict";

/**
 * PR-5.19i one-shot active-continuation anchor expansion request queue.
 *
 * The queue is scheduler bookkeeping only. It does not expand nodes itself;
 * the caller still runs the ordinary strategic expansion pipeline. Each
 * request can be consumed at most once, and stale/inactive requests are
 * removed without ever granting an expansion slot.
 */
class AnchorExpansionRequestQueue {
  constructor(hashFn) {
    this.hashFn = hashFn || ((value) => String(value));
    this.requests = [];
    this.nextId = 1;
  }

  request(options) {
    const config = options || {};
    const {
      continuationId,
      anchorNodeId,
      requestedAtExpansion,
      targetFloor,
      anchorExists,
      anchorExpanded,
    } = config;
    if (!continuationId || anchorNodeId == null) {
      return { accepted: false, reason: "missing-identity" };
    }
    if (!anchorExists || anchorExpanded) {
      return { accepted: false, reason: anchorExpanded ? "already-expanded" : "anchor-missing" };
    }
    const duplicate = this.requests.some((request) =>
      request.continuationId === continuationId && request.anchorNodeId === anchorNodeId);
    if (duplicate) return { accepted: false, reason: "duplicate-request" };
    const request = {
      id: `${this.nextId}`,
      fingerprint: this.hashFn(`anchor-expansion-request|${continuationId}|${anchorNodeId}`),
      continuationId,
      anchorNodeId,
      requestedAtExpansion,
      targetFloor: targetFloor || null,
    };
    this.nextId += 1;
    this.requests.push(request);
    return { accepted: true, request };
  }

  select(options) {
    const config = options || {};
    this.requests.sort((left, right) =>
      left.requestedAtExpansion - right.requestedAtExpansion || left.id.localeCompare(right.id));
    for (let index = 0; index < this.requests.length; index += 1) {
      const request = this.requests[index];
      const {
        anchorExists,
        anchorExpanded,
        continuationActive,
        continuationParked,
      } = config.evaluate(request);
      if (!anchorExists || anchorExpanded) {
        this.requests.splice(index, 1);
        return { type: "skipped", reason: "already-expanded-or-anchor-missing", request };
      }
      if (!continuationActive || !continuationParked) {
        this.requests.splice(index, 1);
        return { type: "skipped", reason: "inactive-continuation", request };
      }
      this.requests.splice(index, 1);
      return { type: "selected", request };
    }
    return { type: "none" };
  }

  pending() {
    return this.requests.slice();
  }
}

module.exports = {
  AnchorExpansionRequestQueue,
};
