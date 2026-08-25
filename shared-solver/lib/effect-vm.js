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

const SCRIPT_CACHE_MAX_ENTRIES = 1024;
const COMPILED_SCRIPT_CACHE = new Map();

function clearCompiledScriptCache() {
  COMPILED_SCRIPT_CACHE.clear();
}

function getCompiledEffectScript(code) {
  if (typeof code !== "string") return null;
  let script = COMPILED_SCRIPT_CACHE.get(code);
  if (script === undefined) {
    try {
      script = new vm.Script(code);
    } catch (error) {
      script = null;
    }
    if (COMPILED_SCRIPT_CACHE.size >= SCRIPT_CACHE_MAX_ENTRIES) {
      const firstKey = COMPILED_SCRIPT_CACHE.keys().next().value;
      COMPILED_SCRIPT_CACHE.delete(firstKey);
    }
    COMPILED_SCRIPT_CACHE.set(code, script);
  }
  return script;
}

function executeItemEffect(project, state, item, options = {}) {
  if (!item || !item.itemEffect) return;
  const timeout = typeof options.timeoutMs === "number" ? options.timeoutMs : 1000;
  const context = {
    core: buildEffectCore(project, state),
    Math,
  };
  const useFastPath = Boolean(options.enableCompiledEffectCache);

  if (useFastPath) {
    const script = getCompiledEffectScript(item.itemEffect);
    if (script) {
      script.runInNewContext(context, { timeout });
      return;
    }
  }

  vm.runInNewContext(item.itemEffect, context, { timeout });
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
  clearCompiledScriptCache,
  executeItemEffect,
  getCompiledEffectScript,
};
