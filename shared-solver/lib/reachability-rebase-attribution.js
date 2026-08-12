"use strict";

class ReachabilityRebaseAttribution {
  constructor() {
    this.currentConsumer = "unscoped";
    this.nextRebaseId = 1;
    this.instrumented = new WeakSet();
    this.stateOwners = new WeakMap();
    this.rebases = new Map();
    this.consumerStats = new Map();
    this.totalStateAccesses = 0;
    this.totalKeyAccesses = 0;
    this.totalEmittedActions = 0;
  }

  consumer(name) {
    const key = String(name || "unscoped");
    if (!this.consumerStats.has(key)) {
      this.consumerStats.set(key, {
        stateAccesses: 0,
        stateNodes: new Set(),
        keyAccesses: 0,
        keyNodes: new Set(),
        emittedActions: 0,
        travelStateNodes: new Set(),
      });
    }
    return this.consumerStats.get(key);
  }

  withConsumer(name, callback) {
    const previous = this.currentConsumer;
    this.currentConsumer = String(name || "unscoped");
    try {
      return callback();
    } finally {
      this.currentConsumer = previous;
    }
  }

  instrumentReachability(reachability) {
    if (!reachability || this.instrumented.has(reachability)) return reachability;
    this.instrumented.add(reachability);
    const diagnostics = reachability.diagnostics || {};
    if (diagnostics.mode !== "safe-fast") return reachability;
    const rebaseId = this.nextRebaseId;
    this.nextRebaseId += 1;
    const record = {
      id: rebaseId,
      skeletonCacheHit: diagnostics.skeletonCacheHit === true,
      skeletonBuilt: diagnostics.skeletonBuilt === true,
      nodeCount: 0,
      stateNodes: new Set(),
      keyNodes: new Set(),
      travelStateNodes: new Set(),
    };
    this.rebases.set(rebaseId, record);

    Object.values(reachability.visited || {}).forEach((node, index) => {
      record.nodeCount += 1;
      const nodeId = `${rebaseId}:${index}`;
      let stateValue = node.state;
      let keyValue = node.key;
      if (stateValue && typeof stateValue === "object") {
        this.stateOwners.set(stateValue, { rebaseId, nodeId });
      }
      Object.defineProperty(node, "state", {
        configurable: true,
        enumerable: true,
        get: () => {
          this.totalStateAccesses += 1;
          record.stateNodes.add(nodeId);
          const consumer = this.consumer(this.currentConsumer);
          consumer.stateAccesses += 1;
          consumer.stateNodes.add(nodeId);
          return stateValue;
        },
        set: (value) => {
          stateValue = value;
          if (value && typeof value === "object") {
            this.stateOwners.set(value, { rebaseId, nodeId });
          }
        },
      });
      Object.defineProperty(node, "key", {
        configurable: true,
        enumerable: true,
        get: () => {
          this.totalKeyAccesses += 1;
          record.keyNodes.add(nodeId);
          const consumer = this.consumer(this.currentConsumer);
          consumer.keyAccesses += 1;
          consumer.keyNodes.add(nodeId);
          return keyValue;
        },
        set: (value) => { keyValue = value; },
      });
    });
    return reachability;
  }

  recordEmittedActions(name, actions) {
    const consumer = this.consumer(name);
    (actions || []).forEach((action) => {
      if (!action || !action.travelState || typeof action.travelState !== "object") return;
      const owner = this.stateOwners.get(action.travelState);
      if (!owner) return;
      this.totalEmittedActions += 1;
      consumer.emittedActions += 1;
      consumer.travelStateNodes.add(owner.nodeId);
      const rebase = this.rebases.get(owner.rebaseId);
      if (rebase) rebase.travelStateNodes.add(owner.nodeId);
    });
  }

  report() {
    const rebases = Array.from(this.rebases.values());
    const materializedNodes = rebases.reduce((sum, rebase) => sum + rebase.nodeCount, 0);
    const stateNodes = new Set();
    const keyNodes = new Set();
    const travelStateNodes = new Set();
    rebases.forEach((rebase) => {
      rebase.stateNodes.forEach((id) => stateNodes.add(id));
      rebase.keyNodes.forEach((id) => keyNodes.add(id));
      rebase.travelStateNodes.forEach((id) => travelStateNodes.add(id));
    });
    const consumers = {};
    Array.from(this.consumerStats.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .forEach(([name, stats]) => {
        consumers[name] = {
          stateAccesses: stats.stateAccesses,
          uniqueStateNodes: stats.stateNodes.size,
          keyAccesses: stats.keyAccesses,
          uniqueKeyNodes: stats.keyNodes.size,
          emittedActions: stats.emittedActions,
          uniqueTravelStateNodes: stats.travelStateNodes.size,
        };
      });
    return {
      schema: "motapathfinder.reachability-rebase-attribution.v1",
      rebases: rebases.length,
      skeletonBuildRebases: rebases.filter((rebase) => rebase.skeletonBuilt).length,
      skeletonHitRebases: rebases.filter((rebase) => rebase.skeletonCacheHit).length,
      materializedNodes,
      stateCloneLowerBound: materializedNodes,
      dominanceKeyBuilds: materializedNodes,
      stateAccesses: this.totalStateAccesses,
      uniqueStateAccessedNodes: stateNodes.size,
      nodeKeyPropertyAccesses: this.totalKeyAccesses,
      uniqueNodeKeyAccessedNodes: keyNodes.size,
      emittedActionsWithTravelState: this.totalEmittedActions,
      uniqueTravelStateNodes: travelStateNodes.size,
      materializedNodesWithoutTravelStateEscape: materializedNodes - travelStateNodes.size,
      travelStateEscapeRatio: materializedNodes > 0 ? travelStateNodes.size / materializedNodes : 0,
      consumers,
    };
  }
}

module.exports = { ReachabilityRebaseAttribution };
