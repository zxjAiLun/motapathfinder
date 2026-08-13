"use strict";

const crypto = require("node:crypto");

function coordinateKey(x, y) {
  return `${x},${y}`;
}

function tileDefinitionAt(project, state, floorId, x, y) {
  const floor = project.floorsById[floorId];
  if (!floor || x < 0 || y < 0 || x >= floor.width || y >= floor.height) return null;
  const floorState = ((state || {}).floorStates || {})[floorId] || {};
  const key = coordinateKey(x, y);
  if ((floorState.removed || {})[key]) return null;
  const tileNumber = Object.prototype.hasOwnProperty.call(floorState.replaced || {}, key)
    ? floorState.replaced[key]
    : floor.map[y][x];
  if (tileNumber == null || Number(tileNumber) === 0) return null;
  return project.mapTilesByNumber[String(tileNumber)] || {
    id: `X${tileNumber}`,
    cls: "unknown",
    number: tileNumber,
  };
}

function optionKind(tile) {
  if (!tile) return null;
  if (tile.cls === "items") return "item";
  if (String(tile.cls || "").startsWith("enemy")) return "enemy";
  return null;
}

function normalizeFloorIds(project, state, floorIds) {
  const requested = Array.isArray(floorIds) && floorIds.length > 0
    ? floorIds
    : [
        ...Object.keys((state || {}).visitedFloors || {}),
        (state || {}).floorId,
      ];
  return Array.from(new Set(requested.filter((floorId) => project.floorsById[floorId])))
    .sort((left, right) => {
      const leftIndex = (project.floorOrder || []).indexOf(left);
      const rightIndex = (project.floorOrder || []).indexOf(right);
      return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) -
        (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex) ||
        left.localeCompare(right);
    });
}

function buildStrategicOptionMap(project, state, options) {
  const floorIds = normalizeFloorIds(project, state, (options || {}).floorIds);
  const entries = [];
  const floors = {};
  for (const floorId of floorIds) {
    const floor = project.floorsById[floorId];
    const grid = Array.from({ length: floor.height }, () =>
      Array.from({ length: floor.width }, () => null));
    for (let y = 0; y < floor.height; y += 1) {
      for (let x = 0; x < floor.width; x += 1) {
        const tile = tileDefinitionAt(project, state, floorId, x, y);
        const kind = optionKind(tile);
        if (!kind) continue;
        const entry = {
          key: `${floorId}:${x},${y}`,
          floorId,
          x,
          y,
          kind,
          tileId: tile.id || null,
        };
        entries.push(entry);
        grid[y][x] = `${kind}:${entry.tileId}`;
      }
    }
    floors[floorId] = {
      width: floor.width,
      height: floor.height,
      grid,
    };
  }
  entries.sort((left, right) => left.key.localeCompare(right.key));
  const counts = entries.reduce((result, entry) => {
    result.total += 1;
    result[entry.kind] += 1;
    return result;
  }, { total: 0, item: 0, enemy: 0 });
  const fingerprint = crypto.createHash("sha256")
    .update(JSON.stringify(entries.map((entry) => [entry.key, entry.kind, entry.tileId])))
    .digest("hex")
    .slice(0, 16);
  return {
    schema: "motapathfinder.strategic-option-map.v1",
    floorIds,
    fingerprint,
    counts,
    entries,
    floors,
  };
}

function diffStrategicOptionMaps(before, after) {
  const beforeByKey = new Map((before.entries || []).map((entry) => [entry.key, entry]));
  const afterByKey = new Map((after.entries || []).map((entry) => [entry.key, entry]));
  return {
    consumed: Array.from(beforeByKey.values())
      .filter((entry) => !afterByKey.has(entry.key))
      .sort((left, right) => left.key.localeCompare(right.key)),
    created: Array.from(afterByKey.values())
      .filter((entry) => !beforeByKey.has(entry.key))
      .sort((left, right) => left.key.localeCompare(right.key)),
  };
}

function createStrategicOptionMapCache(project, options) {
  const cache = new Map();
  const floorIds = normalizeFloorIds(project, {}, (options || {}).floorIds);
  const cacheKey = (state) => JSON.stringify(floorIds.map((floorId) => {
    const floorState = ((state || {}).floorStates || {})[floorId] || {};
    return [
      floorId,
      Object.keys(floorState.removed || {}).filter((key) => floorState.removed[key]).sort(),
      Object.entries(floorState.replaced || {}).sort(([left], [right]) => left.localeCompare(right)),
    ];
  }));
  return {
    get(state) {
      const key = cacheKey(state);
      const existing = cache.get(key);
      if (existing) return existing;
      const map = buildStrategicOptionMap(project, state, { floorIds });
      cache.set(key, map);
      return map;
    },
    get size() {
      return cache.size;
    },
  };
}

module.exports = {
  buildStrategicOptionMap,
  createStrategicOptionMapCache,
  diffStrategicOptionMaps,
  optionKind,
  tileDefinitionAt,
};
