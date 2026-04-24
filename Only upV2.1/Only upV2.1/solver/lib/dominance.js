"use strict";

const { listFloorMutationSummary } = require("./state");
const { buildStateKey, hasDirectionalStateSensitivity } = require("./state-key");
const { getDecisionDepth } = require("./state");
const { getProgress, getProgressSignature } = require("./progress");

const HERO_RESOURCE_FIELDS = ["hp", "hpmax", "mana", "manamax", "atk", "def", "mdef", "money", "exp", "lv"];

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

function stableArray(array) {
  return Array.isArray(array) ? array.slice() : [];
}

function buildDominanceBucketKey(state) {
  const includeDirection = hasDirectionalStateSensitivity(state);
  return JSON.stringify({
    floorId: state.floorId,
    progressSig: getProgressSignature(state),
    hero: {
      x: state.hero.loc.x,
      y: state.hero.loc.y,
      direction: includeDirection ? state.hero.loc.direction : null,
      equipment: stableArray(state.hero.equipment),
      followers: stableArray(state.hero.followers),
    },
    flags: stableObject(state.flags),
    visitedFloors: Object.keys(state.visitedFloors || {}).sort(),
    mutations: listFloorMutationSummary(state.floorStates || {}),
  });
}

function buildDominanceSummary(state, score) {
  const hero = HERO_RESOURCE_FIELDS.reduce((result, field) => {
    result[field] = Number(state.hero[field] || 0);
    return result;
  }, {});

  return {
    stateKey: buildStateKey(state),
    progress: getProgress(state),
    progressSig: getProgressSignature(state),
    hero,
    inventory: stableObject(state.inventory),
    score,
    decisionDepth: getDecisionDepth(state),
    routeLength: state.route.length,
  };
}

function dominatesInventory(leftInventory, rightInventory) {
  return Object.entries(rightInventory || {}).every(([itemId, amount]) => Number((leftInventory || {})[itemId] || 0) >= Number(amount || 0));
}

function dominatesSummary(leftSummary, rightSummary) {
  if ((leftSummary.progressSig || "") !== (rightSummary.progressSig || "")) return false;
  if (Number(((leftSummary.progress || {}).stageIndex) || 0) < Number(((rightSummary.progress || {}).stageIndex) || 0)) return false;
  if (Number(leftSummary.decisionDepth || 0) > Number(rightSummary.decisionDepth || 0)) return false;
  if (
    Number(leftSummary.decisionDepth || 0) === Number(rightSummary.decisionDepth || 0) &&
    Number(leftSummary.routeLength || 0) > Number(rightSummary.routeLength || 0)
  ) {
    return false;
  }
  const heroDominates = HERO_RESOURCE_FIELDS.every((field) => Number(leftSummary.hero[field] || 0) >= Number(rightSummary.hero[field] || 0));
  if (!heroDominates) return false;
  return dominatesInventory(leftSummary.inventory, rightSummary.inventory);
}

module.exports = {
  buildDominanceBucketKey,
  buildDominanceSummary,
  dominatesSummary,
};
