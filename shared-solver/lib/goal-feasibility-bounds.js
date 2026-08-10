"use strict";

const { getInventoryCount, getTileDefinitionAt } = require("./state");

const STAT_FIELDS = ["hp", "atk", "def", "mdef", "lv", "exp", "money", "mana"];

function finiteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function effectiveHeroValue(state, field) {
  const hero = (state || {}).hero || {};
  const flags = (state || {}).flags || {};
  return Math.floor(
    finiteNumber(hero[field], 0) * finiteNumber(flags[`__${field}_buff__`], 1),
  );
}

function tileKey(tile) {
  return `${tile.floorId}:${tile.x},${tile.y}`;
}

function compileFloorGraph(spec) {
  if (!spec || spec.complete !== true) return null;
  const adjacency = new Map();
  Object.entries(spec.edges || {}).forEach(([from, targets]) => {
    adjacency.set(String(from), new Set((targets || []).map(String)));
  });
  return {
    complete: true,
    floorFly: spec.floorFly === true,
    adjacency,
  };
}

function floorReachable(graph, from, target) {
  if (!graph || graph.floorFly || !from || !target) return null;
  if (from === target) return true;
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length > 0) {
    const floorId = queue.shift();
    for (const next of graph.adjacency.get(floorId) || []) {
      if (next === target) return true;
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return false;
}

function normalizeEquipmentSources(spec) {
  const result = new Map();
  Object.entries(spec || {}).forEach(([itemId, entry]) => {
    if (!entry || entry.complete !== true) return;
    result.set(String(itemId), {
      complete: true,
      tiles: (entry.tiles || []).filter((tile) =>
        tile && tile.floorId != null && tile.x != null && tile.y != null,
      ),
    });
  });
  return result;
}

function normalizeGainBounds(spec) {
  const result = {};
  STAT_FIELDS.forEach((field) => {
    if (Number.isFinite(Number((spec || {})[field]))) {
      result[field] = Math.max(0, Number(spec[field]));
    }
  });
  return result;
}

function failure(reason, current, target, bound, witness) {
  return {
    feasible: false,
    reason,
    current,
    target,
    bound,
    witness,
  };
}

function compileAdmissibleFeasibilityBounds(project, segment) {
  const goal = (segment || {}).goal || {};
  const spec = (segment || {}).admissibleBounds || {};
  const floorGraph = compileFloorGraph(spec.floorGraph);
  const equipmentSources = normalizeEquipmentSources(spec.equipmentSources);
  const optimisticHeroGain = normalizeGainBounds(spec.optimisticHeroGain);
  const optimisticEffectiveHeroGain = normalizeGainBounds(spec.optimisticEffectiveHeroGain);
  const protectedTiles = (goal.presentTiles || []).filter((tile) =>
    tile && tile.floorId != null && tile.x != null && tile.y != null,
  );

  return {
    mode: "admissible-v1",
    evidence: {
      protectedTiles: protectedTiles.map(tileKey),
      floorGraphComplete: Boolean(floorGraph),
      equipmentSourceItems: Array.from(equipmentSources.keys()).sort(),
      optimisticHeroGain: { ...optimisticHeroGain },
      optimisticEffectiveHeroGain: { ...optimisticEffectiveHeroGain },
    },
    evaluate(state) {
      for (const tile of protectedTiles) {
        if (getTileDefinitionAt(project, state, tile.floorId, tile.x, tile.y) != null) continue;
        return failure(
          "required-tile-irreversibly-cleared",
          "removed",
          "present",
          "tile restoration is outside the declared goal model",
          { tile: tileKey(tile) },
        );
      }

      if (floorGraph && goal.floorId) {
        const reachable = floorReachable(floorGraph, state.floorId, String(goal.floorId));
        if (reachable === false) {
          return failure(
            "target-floor-unreachable",
            state.floorId,
            String(goal.floorId),
            "complete declared floor graph has no path",
            {
              from: state.floorId,
              visited: Array.from(floorGraph.adjacency.keys()).sort(),
            },
          );
        }
      }

      for (const itemId of goal.equipmentIncludes || []) {
        if (((state.hero || {}).equipment || []).includes(itemId)) continue;
        if (getInventoryCount(state, itemId) > 0) continue;
        const sources = equipmentSources.get(String(itemId));
        if (!sources) continue;
        const remaining = sources.tiles.filter((tile) => {
          const definition = getTileDefinitionAt(project, state, tile.floorId, tile.x, tile.y);
          return definition && definition.id === itemId;
        });
        if (remaining.length > 0) continue;
        return failure(
          "required-equipment-unavailable",
          0,
          1,
          "all complete declared sources are exhausted",
          { itemId, sources: sources.tiles.map(tileKey) },
        );
      }

      for (const [field, required] of Object.entries(goal.minHero || {})) {
        if (!Object.prototype.hasOwnProperty.call(optimisticHeroGain, field)) continue;
        const current = finiteNumber(((state || {}).hero || {})[field], 0);
        const upperBound = current + optimisticHeroGain[field];
        if (upperBound >= Number(required)) continue;
        return failure(
          "optimistic-hero-bound-below-goal",
          current,
          Number(required),
          upperBound,
          { field, optimisticRemainingGain: optimisticHeroGain[field] },
        );
      }

      for (const [field, required] of Object.entries(goal.minEffectiveHero || {})) {
        if (!Object.prototype.hasOwnProperty.call(optimisticEffectiveHeroGain, field)) continue;
        const current = effectiveHeroValue(state, field);
        const upperBound = current + optimisticEffectiveHeroGain[field];
        if (upperBound >= Number(required)) continue;
        return failure(
          "optimistic-effective-hero-bound-below-goal",
          current,
          Number(required),
          upperBound,
          { field, optimisticRemainingGain: optimisticEffectiveHeroGain[field] },
        );
      }

      return {
        feasible: true,
        unknown: !floorGraph && equipmentSources.size === 0 &&
          Object.keys(optimisticHeroGain).length === 0 &&
          Object.keys(optimisticEffectiveHeroGain).length === 0,
      };
    },
  };
}

module.exports = {
  compileAdmissibleFeasibilityBounds,
  floorReachable,
};
