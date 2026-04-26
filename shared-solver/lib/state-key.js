"use strict";

const { listFloorMutationSummary } = require("./state");
const { getProgressSignature } = require("./progress");

const DIRECTIONAL_STATE_ITEMS = ["pickaxe", "bomb"];

function stableArray(array) {
  return Array.isArray(array) ? array.slice() : [];
}

function stableObject(object) {
  return Object.keys(object || {})
    .sort()
    .reduce((result, key) => {
      const value = object[key];
      if (value == null) return result;
      if (value === 0) return result;
      result[key] = value;
      return result;
    }, {});
}

function hasDirectionalStateSensitivity(state) {
  return DIRECTIONAL_STATE_ITEMS.some((itemId) => Number((state.inventory || {})[itemId] || 0) > 0);
}

function serializeStateKey(state, options) {
  const config = options || {};
  const includeDirection = hasDirectionalStateSensitivity(state);
  return JSON.stringify({
    floorId: state.floorId,
    progressSig: getProgressSignature(state),
    hero: {
      x: state.hero.loc.x,
      y: state.hero.loc.y,
      direction: includeDirection ? state.hero.loc.direction : null,
      hp: config.ignoreHp ? null : state.hero.hp,
      hpmax: config.ignoreHp ? null : state.hero.hpmax,
      mana: state.hero.mana,
      manamax: config.ignoreHp ? null : state.hero.manamax,
      atk: state.hero.atk,
      def: state.hero.def,
      mdef: state.hero.mdef,
      money: state.hero.money,
      exp: state.hero.exp,
      lv: state.hero.lv,
      equipment: stableArray(state.hero.equipment),
      followers: stableArray(state.hero.followers),
    },
    inventory: stableObject(state.inventory),
    flags: stableObject(state.flags),
    visitedFloors: Object.keys(state.visitedFloors || {}).sort(),
    mutations: listFloorMutationSummary(state.floorStates || {}),
  });
}

function buildStateKey(state) {
  return serializeStateKey(state);
}

function buildDominanceKey(state) {
  return serializeStateKey(state, { ignoreHp: true });
}

module.exports = {
  buildDominanceKey,
  buildStateKey,
  hasDirectionalStateSensitivity,
};
