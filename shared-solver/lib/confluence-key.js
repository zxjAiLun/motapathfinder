"use strict";

const { getProgressSignature } = require("./progress");
const { listFloorMutationSummary, getDecisionDepth } = require("./state");

const RESOURCE_FIELDS = ["hp", "mana", "atk", "def", "mdef", "money", "exp", "lv"];

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function stableArray(array) {
  return Array.isArray(array) ? array.slice().sort() : [];
}

function stableObject(object) {
  return Object.keys(object || {})
    .sort()
    .reduce((result, key) => {
      const value = object[key];
      if (value == null || value === 0) return result;
      result[key] = value;
      return result;
    }, {});
}

function resourceSnapshot(state) {
  const hero = (state || {}).hero || {};
  return {
    hero: RESOURCE_FIELDS.reduce((result, field) => {
      result[field] = number(hero[field]);
      return result;
    }, {}),
    inventory: stableObject((state || {}).inventory || {}),
    equipment: stableArray(hero.equipment),
  };
}

function dominatesObject(left, right) {
  let strict = false;
  const keys = new Set([...Object.keys(left || {}), ...Object.keys(right || {})]);
  for (const key of keys) {
    const leftValue = number((left || {})[key]);
    const rightValue = number((right || {})[key]);
    if (leftValue < rightValue) return { dominates: false, strict: false };
    if (leftValue > rightValue) strict = true;
  }
  return { dominates: true, strict };
}

function dominatesEquipment(leftEquipment, rightEquipment) {
  const left = new Set(leftEquipment || []);
  const right = new Set(rightEquipment || []);
  let strict = left.size > right.size;
  for (const itemId of right) {
    if (!left.has(itemId)) return { dominates: false, strict: false };
  }
  for (const itemId of left) {
    if (!right.has(itemId)) strict = true;
  }
  return { dominates: true, strict };
}

function effectiveRouteLength(state) {
  return Array.isArray(state && state.route) && state.route.length > 0 ? state.route.length : getDecisionDepth(state);
}

function compareConfluenceResources(leftState, rightState) {
  const left = resourceSnapshot(leftState);
  const right = resourceSnapshot(rightState);
  const hero = dominatesObject(left.hero, right.hero);
  const inventory = dominatesObject(left.inventory, right.inventory);
  const equipment = dominatesEquipment(left.equipment, right.equipment);
  const reverseHero = dominatesObject(right.hero, left.hero);
  const reverseInventory = dominatesObject(right.inventory, left.inventory);
  const reverseEquipment = dominatesEquipment(right.equipment, left.equipment);
  const leftDominates = hero.dominates && inventory.dominates && equipment.dominates;
  const rightDominates = reverseHero.dominates && reverseInventory.dominates && reverseEquipment.dominates;
  const leftStrict = hero.strict || inventory.strict || equipment.strict;
  const rightStrict = reverseHero.strict || reverseInventory.strict || reverseEquipment.strict;
  if (leftDominates && (!rightDominates || leftStrict)) return -1;
  if (rightDominates && (!leftDominates || rightStrict)) return 1;
  if (leftDominates && rightDominates) {
    return effectiveRouteLength(leftState) - effectiveRouteLength(rightState);
  }
  return null;
}

function buildRegionSignature(simulator, state) {
  if (simulator && typeof simulator.buildReachableRegionSignature === "function") {
    try {
      return simulator.buildReachableRegionSignature(state);
    } catch (error) {
      // Fall through to a conservative location-only signature.
    }
  }
  const loc = ((state || {}).hero || {}).loc || {};
  return {
    regionKey: `${(state || {}).floorId || ""}:${loc.x},${loc.y}`,
    reachableEndpointsKey: "",
  };
}

function buildSearchConfluenceKey(simulator, state) {
  const hero = (state || {}).hero || {};
  const region = buildRegionSignature(simulator, state);
  const combatSignature = simulator && typeof simulator.getCombatSignature === "function"
    ? simulator.getCombatSignature(state)
    : [hero.atk, hero.def, hero.mdef, hero.lv, hero.exp].map((value) => number(value)).join("|");
  return JSON.stringify({
    floorId: state && state.floorId,
    progressSig: getProgressSignature(state),
    regionKey: region.regionKey,
    reachableEndpointsKey: region.reachableEndpointsKey,
    combatSignature,
    hero: {
      money: number(hero.money),
      mana: number(hero.mana),
      manamax: number(hero.manamax),
      equipment: stableArray(hero.equipment),
      followers: stableArray(hero.followers),
    },
    inventory: stableObject((state || {}).inventory),
    flags: stableObject((state || {}).flags),
    visitedFloors: Object.keys((state || {}).visitedFloors || {}).sort(),
    mutations: listFloorMutationSummary((state || {}).floorStates || {}),
  });
}

function buildClusterConfluenceKey(simulator, state, mask) {
  const parsed = JSON.parse(buildSearchConfluenceKey(simulator, state));
  parsed.mask = Number(mask || 0);
  return JSON.stringify(parsed);
}

function dominatesAtConfluence(simulator, leftState, rightState, options) {
  const config = options || {};
  if (config.requireSameKey !== false) {
    const leftKey = config.leftKey || buildSearchConfluenceKey(simulator, leftState);
    const rightKey = config.rightKey || buildSearchConfluenceKey(simulator, rightState);
    if (leftKey !== rightKey) return false;
  }
  const comparison = compareConfluenceResources(leftState, rightState);
  return comparison != null && comparison < 0;
}

module.exports = {
  buildClusterConfluenceKey,
  buildSearchConfluenceKey,
  compareConfluenceResources,
  dominatesAtConfluence,
  effectiveRouteLength,
};
