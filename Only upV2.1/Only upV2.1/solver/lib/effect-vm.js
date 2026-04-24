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

function executeItemEffect(project, state, item) {
  if (!item || !item.itemEffect) return;
  const context = {
    core: buildEffectCore(project, state),
    Math,
  };
  vm.runInNewContext(item.itemEffect, context, { timeout: 1000 });
}

function applyPickup(project, state, itemId) {
  const item = project.itemsById[itemId];
  if (!item) {
    state.notes.push(`Unknown item pickup: ${itemId}`);
    return;
  }

  if (item.cls === "items") {
    executeItemEffect(project, state, item);
    return;
  }

  addItem(state, itemId, 1);
}

module.exports = {
  applyPickup,
  executeItemEffect,
};
