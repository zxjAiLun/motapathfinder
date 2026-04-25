"use strict";

const { getTileNumberAt } = require("./state");

const DEFAULT_HERO_FIELDS = ["hp", "hpmax", "mana", "manamax", "atk", "def", "mdef", "money", "exp", "lv"];

function stableObject(object) {
  return Object.keys(object || {})
    .sort()
    .reduce((result, key) => {
      const value = object[key];
      if (value == null) return result;
      if (value === 0) return result;
      if (Array.isArray(value) && value.length === 0) return result;
      if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) return result;
      result[key] = value;
      return result;
    }, {});
}

function normalizeFlags(flags) {
  return Object.keys(flags || {})
    .sort()
    .reduce((result, key) => {
      if (key === "__frontierFeatures") return result;
      if (key.startsWith("__") && !key.endsWith("_buff__")) return result;
      const value = flags[key];
      if (value == null || value === 0) return result;
      if (typeof value === "object") return result;
      result[key] = value;
      return result;
    }, {});
}

function normalizeHero(hero, heroFields) {
  const fields = heroFields || DEFAULT_HERO_FIELDS;
  const normalized = fields.reduce((result, field) => {
    result[field] = Number((hero || {})[field] || 0);
    return result;
  }, {});
  normalized.loc = {
    x: Number((((hero || {}).loc || {}).x) || 0),
    y: Number((((hero || {}).loc || {}).y) || 0),
    direction: ((((hero || {}).loc || {}).direction) || "down"),
  };
  normalized.equipment = Array.isArray((hero || {}).equipment) ? hero.equipment.slice() : [];
  return normalized;
}

function tileNumberToSnapshotId(project, number) {
  if (number == null || number === 0) return null;
  const definition = project.mapTilesByNumber[String(number)];
  if (definition && definition.id != null) return definition.id;
  return `X${number}`;
}

function getBaseTileId(project, floorId, x, y) {
  const floor = project.floorsById[floorId];
  if (!floor || !floor.map[y]) return null;
  return tileNumberToSnapshotId(project, floor.map[y][x]);
}

function getCurrentTileId(project, state, floorId, x, y) {
  const number = getTileNumberAt(project, state, floorId, x, y);
  return tileNumberToSnapshotId(project, number);
}

function buildSolverFloorMutationSnapshot(project, state, floorId) {
  const floor = project.floorsById[floorId];
  if (!floor) return { removed: [], replaced: [] };
  const removed = [];
  const replaced = [];
  for (let y = 0; y < floor.height; y += 1) {
    for (let x = 0; x < floor.width; x += 1) {
      const baseId = getBaseTileId(project, floorId, x, y);
      const currentId = getCurrentTileId(project, state, floorId, x, y);
      if (currentId === baseId) continue;
      const loc = `${x},${y}`;
      if (currentId == null) removed.push(loc);
      else replaced.push(`${loc}=${currentId}`);
    }
  }
  return { removed, replaced };
}

function buildSolverSnapshot(project, state, options) {
  const config = options || {};
  const floorIds = config.floorIds || Object.keys(project.floorsById || {});
  const floors = {};
  floorIds.forEach((floorId) => {
    floors[floorId] = buildSolverFloorMutationSnapshot(project, state, floorId);
  });
  return {
    floorId: state.floorId,
    hero: normalizeHero(state.hero, config.heroFields),
    inventory: stableObject(state.inventory),
    flags: normalizeFlags(state.flags),
    floors,
  };
}

function summarizeSnapshot(snapshot) {
  return {
    floorId: snapshot && snapshot.floorId,
    hero: snapshot && snapshot.hero,
    inventory: snapshot && snapshot.inventory,
    flags: snapshot && snapshot.flags,
    floors: Object.keys((snapshot && snapshot.floors) || {}).reduce((result, floorId) => {
      const floor = snapshot.floors[floorId] || {};
      result[floorId] = {
        removedCount: Array.isArray(floor.removed) ? floor.removed.length : 0,
        replacedCount: Array.isArray(floor.replaced) ? floor.replaced.length : 0,
        removedPreview: Array.isArray(floor.removed) ? floor.removed.slice(0, 12) : [],
        replacedPreview: Array.isArray(floor.replaced) ? floor.replaced.slice(0, 12) : [],
      };
      return result;
    }, {}),
  };
}

function diffSnapshots(expected, actual, pathSegments) {
  const prefix = pathSegments || [];
  if (typeof expected !== typeof actual) {
    return `${prefix.join(".")}: type mismatch (${typeof expected} !== ${typeof actual})`;
  }
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) return `${prefix.join(".")}: array mismatch`;
    if (expected.length !== actual.length) return `${prefix.join(".")}: length mismatch (${expected.length} !== ${actual.length})`;
    for (let index = 0; index < expected.length; index += 1) {
      const mismatch = diffSnapshots(expected[index], actual[index], prefix.concat(String(index)));
      if (mismatch) return mismatch;
    }
    return null;
  }
  if (expected && typeof expected === "object") {
    const keys = Array.from(new Set([...Object.keys(expected), ...Object.keys(actual || {})])).sort();
    for (const key of keys) {
      const mismatch = diffSnapshots(expected[key], actual[key], prefix.concat(key));
      if (mismatch) return mismatch;
    }
    return null;
  }
  if (expected !== actual) return `${prefix.join(".")}: ${JSON.stringify(expected)} !== ${JSON.stringify(actual)}`;
  return null;
}

module.exports = {
  DEFAULT_HERO_FIELDS,
  buildSolverSnapshot,
  diffSnapshots,
  normalizeHero,
  summarizeSnapshot,
};
