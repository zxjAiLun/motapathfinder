"use strict";

const vm = require("vm");

const { addItem, consumeItem, getInventoryCount } = require("./state");

const HERO_NUMERIC_FIELDS = ["hp", "hpmax", "mana", "manamax", "atk", "def", "mdef", "money", "exp", "lv"];

function getEquipNames(project) {
  return (((project.data || {}).main || {}).equipName || []).slice();
}

function getEquipType(project, state, equipId) {
  const item = project.itemsById[equipId];
  if (!item || !item.equip) return -1;
  const type = item.equip.type;
  if (typeof type === "number") return type;
  if (typeof type !== "string") return -1;

  const matches = [];
  getEquipNames(project).forEach((name, index) => {
    if (name !== type) return;
    matches.push(index);
  });
  const empty = matches.find((index) => !(state.hero.equipment || [])[index]);
  if (empty != null) return empty;
  return matches.length === 1 ? matches[0] : -1;
}

function getBuff(state, name) {
  return Number(state.flags[`__${name}_buff__`] == null ? 1 : state.flags[`__${name}_buff__`]);
}

function addBuff(state, name, delta) {
  const key = `__${name}_buff__`;
  const nextValue = parseFloat((getBuff(state, name) + Number(delta || 0)).toFixed(3));
  state.flags[key] = nextValue;
}

function buildEquipCore(project, state) {
  return {
    hasItem(itemId) {
      return getInventoryCount(state, itemId) > 0;
    },
    hasEquip(itemId) {
      return (state.hero.equipment || []).includes(itemId);
    },
    getEquip(equipType) {
      return (state.hero.equipment || [])[equipType] || null;
    },
    getFlag(name, defaultValue) {
      return Object.prototype.hasOwnProperty.call(state.flags, name) ? state.flags[name] : defaultValue;
    },
  };
}

function canEquip(project, state, equipId) {
  const item = project.itemsById[equipId];
  if (!item || item.cls !== "equips" || !item.equip) return false;
  if (getInventoryCount(state, equipId) <= 0) return false;
  if ((state.hero.equipment || []).includes(equipId)) return false;
  if (getEquipType(project, state, equipId) < 0) return false;

  if (!item.canUseItemEffect) return true;
  try {
    return Boolean(vm.runInNewContext(item.canUseItemEffect, { core: buildEquipCore(project, state), Math }, { timeout: 1000 }));
  } catch (error) {
    return false;
  }
}

function compareEquipment(project, equipId, unloadEquipId) {
  const result = { value: {}, percentage: {} };
  const first = project.itemsById[equipId];
  const second = project.itemsById[unloadEquipId];

  ["value", "percentage"].forEach((kind) => {
    HERO_NUMERIC_FIELDS.forEach((name) => {
      let delta = 0;
      if (first && first.equip && first.equip[kind]) delta += Number(first.equip[kind][name] || 0);
      if (second && second.equip && second.equip[kind]) delta -= Number(second.equip[kind][name] || 0);
      if (delta !== 0) result[kind][name] = delta;
    });
  });

  return result;
}

class EquipmentResolver {
  enumerateActions(context) {
    const { project, state } = context;
    return Object.keys(state.inventory || {})
      .filter((itemId) => canEquip(project, state, itemId))
      .map((equipId) => ({
        kind: "equip",
        equipId,
        equipType: getEquipType(project, state, equipId),
        summary: `equip:${equipId}`,
      }));
  }

  applyAction(context) {
    const { project, state, action } = context;
    const equipType = action.equipType != null ? action.equipType : getEquipType(project, state, action.equipId);
    if (equipType < 0) throw new Error(`Cannot equip ${action.equipId}.`);

    const unloadEquipId = (state.hero.equipment || [])[equipType] || null;
    const delta = compareEquipment(project, action.equipId, unloadEquipId);

    Object.entries(delta.percentage).forEach(([name, value]) => {
      addBuff(state, name, Number(value || 0) / 100);
    });
    Object.entries(delta.value).forEach(([name, value]) => {
      state.hero[name] = Number(state.hero[name] || 0) + Number(value || 0);
    });

    consumeItem(state, action.equipId, 1);
    if (unloadEquipId) addItem(state, unloadEquipId, 1);
    if (!Array.isArray(state.hero.equipment)) state.hero.equipment = [];
    state.hero.equipment[equipType] = action.equipId;
  }
}

module.exports = {
  EquipmentResolver,
  canEquip,
  compareEquipment,
  getBuff,
  getEquipType,
};
