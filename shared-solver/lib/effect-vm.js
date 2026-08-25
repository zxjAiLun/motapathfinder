"use strict";

const vm = require("vm");

const { addItem, getInventoryCount } = require("./state");

function buildEffectCore(project, state) {
  const floor = project.floorsById[state.floorId];

  return {
    status: {
      hero: state.hero,
      thisMap: {
        ratio: floor.ratio || 1,
      },
    },
    values: project.values,
    addItem(itemId, amount) {
      addItem(state, itemId, amount || 1);
    },
    itemCount(itemId) {
      return getInventoryCount(state, itemId);
    },
    hasItem(itemId) {
      return getInventoryCount(state, itemId) > 0;
    },
    getFlag(name, defaultValue) {
      return Object.prototype.hasOwnProperty.call(state.flags, name) ? state.flags[name] : defaultValue;
    },
    setFlag(name, value) {
      state.flags[name] = value;
    },
    addFlag(name, value) {
      state.flags[name] = (state.flags[name] || 0) + value;
    },
    hasEquip(itemId) {
      return (state.hero.equipment || []).includes(itemId);
    },
    getEquip(equipType) {
      return (state.hero.equipment || [])[equipType] || null;
    },
  };
}

const COMPILED_EFFECT_CACHE = new Map();

function clearCompiledEffectCache() {
  COMPILED_EFFECT_CACHE.clear();
}

function getCompiledEffectFunction(code) {
  if (typeof code !== "string") return null;
  let fn = COMPILED_EFFECT_CACHE.get(code);
  if (fn === undefined) {
    try {
      fn = new Function("core", "Math", code);
    } catch (error) {
      fn = null;
    }
    COMPILED_EFFECT_CACHE.set(code, fn);
  }
  return fn;
}

function executeItemEffect(project, state, item, options = {}) {
  if (!item || !item.itemEffect) return;
  const core = buildEffectCore(project, state);
  const useFastPath = options.enableCompiledEffectCache !== false;

  if (useFastPath) {
    const compiledFn = getCompiledEffectFunction(item.itemEffect);
    if (typeof compiledFn === "function") {
      compiledFn(core, Math);
      return;
    }
  }

  const context = {
    core,
    Math,
  };
  vm.runInNewContext(item.itemEffect, context, { timeout: 1000 });
}

function applyPickup(project, state, itemId, options = {}) {
  const item = project.itemsById[itemId];
  if (!item) {
    state.notes.push(`Unknown item pickup: ${itemId}`);
    return;
  }

  if (item.cls === "items") {
    executeItemEffect(project, state, item, options);
    return;
  }

  addItem(state, itemId, 1);
}

module.exports = {
  applyPickup,
  buildEffectCore,
  clearCompiledEffectCache,
  executeItemEffect,
  getCompiledEffectFunction,
};
