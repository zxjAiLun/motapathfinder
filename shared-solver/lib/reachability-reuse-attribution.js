"use strict";

const { fingerprintJson } = require("./solve-task");
const { listFloorMutationSummary } = require("./state");

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableValue(value[key]);
    return result;
  }, {});
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function currentFloorMutations(state) {
  const floorId = state && state.floorId;
  const floorState = floorId && state.floorStates && state.floorStates[floorId];
  if (!floorId || !floorState) return [];
  return listFloorMutationSummary({ [floorId]: floorState });
}

function offFloorMutations(state) {
  const floorId = state && state.floorId;
  const other = Object.keys(state && state.floorStates || {}).reduce((result, id) => {
    if (id !== floorId) result[id] = state.floorStates[id];
    return result;
  }, {});
  return listFloorMutationSummary(other);
}

// A safe-fast walk skeleton is topology-only after classifySafeStaticWalk has
// independently proved the exact input state has no poison, directional tool,
// live auto event, movement hazard, or stabilization side effect.  The future
// reuse candidate therefore groups only already-eligible builds by the current
// floor, start coordinate, and current-floor mutations.  It does NOT skip or
// cache the safety classification itself.
function safeTopologyProjection(state) {
  const loc = state && state.hero && state.hero.loc || {};
  return {
    floorId: state && state.floorId || null,
    start: { x: Number(loc.x), y: Number(loc.y) },
    currentFloorMutations: currentFloorMutations(state),
  };
}

function closureProjection(reachability) {
  return Object.values(reachability && reachability.visited || {})
    .map((node) => ({
      x: Number(node.x),
      y: Number(node.y),
      distance: Number(node.distance),
      path: Array.isArray(node.path) ? node.path.slice() : [],
    }))
    .sort((left, right) =>
      left.x - right.x || left.y - right.y || left.distance - right.distance ||
      stableJson(left.path).localeCompare(stableJson(right.path)));
}

function stateDimensions(state) {
  const hero = state && state.hero || {};
  return {
    heroHp: stableJson({ hp: hero.hp, hpmax: hero.hpmax }),
    heroStats: stableJson({
      atk: hero.atk,
      def: hero.def,
      mdef: hero.mdef,
      mana: hero.mana,
      manamax: hero.manamax,
      money: hero.money,
      exp: hero.exp,
      lv: hero.lv,
      equipment: hero.equipment || [],
      followers: hero.followers || [],
    }),
    inventory: stableJson(state && state.inventory || {}),
    flags: stableJson(state && state.flags || {}),
    visitedFloors: stableJson(Object.keys(state && state.visitedFloors || {}).sort()),
    offFloorMutations: stableJson(offFloorMutations(state)),
    triggeredAutoEvents: stableJson(state && state.triggeredAutoEvents || {}),
    progress: stableJson(state && state.progress || null),
  };
}

class ReachabilityReuseAttribution {
  constructor() {
    this.requests = 0;
    this.exactCacheHits = 0;
    this.exactCacheMisses = 0;
    this.safeFastMisses = 0;
    this.legacyExactMisses = 0;
    this.groups = new Map();
    this.eligibilityReasons = new Map();
  }

  recordHit() {
    this.requests += 1;
    this.exactCacheHits += 1;
  }

  recordMiss(state, exactKey, reachability) {
    this.requests += 1;
    this.exactCacheMisses += 1;
    const diagnostics = reachability && reachability.diagnostics || {};
    const reason = diagnostics.eligibilityReason || "unknown";
    this.eligibilityReasons.set(reason, Number(this.eligibilityReasons.get(reason) || 0) + 1);
    if (diagnostics.mode !== "safe-fast") {
      this.legacyExactMisses += 1;
      return;
    }
    this.safeFastMisses += 1;
    const projection = safeTopologyProjection(state);
    const projectionKey = fingerprintJson(projection);
    const closure = closureProjection(reachability);
    const closureFingerprint = fingerprintJson(closure);
    if (!this.groups.has(projectionKey)) {
      this.groups.set(projectionKey, {
        projection,
        exactKeys: new Set(),
        closureFingerprints: new Set(),
        dimensions: {},
        requests: 0,
        nodeCount: closure.length,
      });
    }
    const group = this.groups.get(projectionKey);
    group.requests += 1;
    group.exactKeys.add(exactKey);
    group.closureFingerprints.add(closureFingerprint);
    const dimensions = stateDimensions(state);
    Object.entries(dimensions).forEach(([name, value]) => {
      if (!group.dimensions[name]) group.dimensions[name] = new Set();
      group.dimensions[name].add(value);
    });
  }

  report() {
    const groups = Array.from(this.groups.entries()).map(([projectionKey, group]) => ({
      projectionKey,
      projection: group.projection,
      requests: group.requests,
      uniqueExactKeys: group.exactKeys.size,
      reusableMisses: Math.max(0, group.requests - 1),
      closureFingerprintCount: group.closureFingerprints.size,
      closureFingerprint: group.closureFingerprints.size === 1
        ? Array.from(group.closureFingerprints)[0]
        : null,
      nodeCount: group.nodeCount,
      varyingDimensions: Object.keys(group.dimensions)
        .filter((name) => group.dimensions[name].size > 1)
        .sort(),
    })).sort((left, right) =>
      right.reusableMisses - left.reusableMisses || left.projectionKey.localeCompare(right.projectionKey));
    const repeated = groups.filter((group) => group.requests > 1);
    const reusableMisses = groups.reduce((sum, group) => sum + group.reusableMisses, 0);
    const closureMismatchGroups = repeated.filter((group) => group.closureFingerprintCount !== 1);
    const varyingDimensionGroups = {};
    repeated.forEach((group) => {
      group.varyingDimensions.forEach((name) => {
        varyingDimensionGroups[name] = Number(varyingDimensionGroups[name] || 0) + 1;
      });
    });
    return {
      schema: "motapathfinder.reachability-reuse-attribution.v1",
      requests: this.requests,
      exactCacheHits: this.exactCacheHits,
      exactCacheMisses: this.exactCacheMisses,
      safeFastMisses: this.safeFastMisses,
      legacyExactMisses: this.legacyExactMisses,
      safeTopologyUniqueProjections: groups.length,
      safeTopologyRepeatedGroups: repeated.length,
      safeTopologyReusableMisses: reusableMisses,
      theoreticalSafeFastBuildsAfterSkeletonReuse: this.safeFastMisses - reusableMisses,
      theoreticalSafeFastBuildReductionRatio: this.safeFastMisses > 0
        ? reusableMisses / this.safeFastMisses
        : 0,
      closureMismatchGroupCount: closureMismatchGroups.length,
      eligibilityReasons: Object.fromEntries(Array.from(this.eligibilityReasons.entries()).sort()),
      varyingDimensionGroups,
      repeatedGroups: repeated.slice(0, 20),
    };
  }
}

module.exports = {
  ReachabilityReuseAttribution,
  closureProjection,
  safeTopologyProjection,
};
