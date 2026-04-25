"use strict";

const { getFrontierFeatures } = require("./search-cache");
const { getDecisionDepth } = require("./state");
const { getInventoryCount } = require("./state");
const { getFloorOrder } = require("./floor-id");

function defaultScore(state) {
  const totalInventory = Object.values(state.inventory || {}).reduce((sum, value) => sum + Number(value || 0), 0);
  return {
    primary: getInventoryCount(state, "I573"),
    secondary: state.hero.hp,
    tertiary: totalInventory,
  };
}

function getProgressFloorOrder(state) {
  const current = getFloorOrder(state.floorId);
  const visited = Object.keys(state.visitedFloors || {}).reduce((best, floorId) => Math.max(best, getFloorOrder(floorId)), current);
  return Math.max(current, visited);
}

function estimateNextFloorDistance(state, project) {
  if (!project || !project.floorsById || !project.floorsById[state.floorId]) return Number.POSITIVE_INFINITY;
  const floor = project.floorsById[state.floorId];
  const nextTargets = Object.entries(floor.changeFloor || {})
    .filter(([, changeFloor]) => changeFloor && changeFloor.floorId === ":next")
    .map(([loc]) => {
      const [x, y] = loc.split(",").map(Number);
      return { x, y };
    });
  if (nextTargets.length === 0) return Number.POSITIVE_INFINITY;

  return nextTargets.reduce((best, target) => {
    const distance = Math.abs(state.hero.loc.x - target.x) + Math.abs(state.hero.loc.y - target.y);
    return Math.min(best, distance);
  }, Number.POSITIVE_INFINITY);
}

function defaultSearchRank(state, score, context) {
  const resolvedScore = score || defaultScore(state);
  const project = context && context.project;
  const frontier = project ? getFrontierFeatures(project, state, { battleResolver: context && context.battleResolver }) : null;
  const preferredChangePreview = frontier && frontier.preferredChangeFloor && frontier.preferredChangeFloor.preview
    ? frontier.preferredChangeFloor.preview
    : null;
  return {
    progressFloor: getProgressFloorOrder(state),
    currentFloor: getFloorOrder(state.floorId),
    combat: Number(state.hero.atk || 0) + Number(state.hero.def || 0) + Number(state.hero.mdef || 0),
    hp: Number(state.hero.hp || 0),
    nextDistance: frontier ? frontier.nearestNextFloorDistance : estimateNextFloorDistance(state, project),
    changeDistance: frontier ? frontier.nearestChangeFloorDistance : Number.POSITIVE_INFINITY,
    changeReady: frontier ? frontier.adjacentChangeFloorCount : 0,
    battleFrontier: frontier ? frontier.battleFrontierCount : 0,
    zeroDamageBattle: frontier ? frontier.zeroDamageBattleCount : 0,
    nextOpportunity: frontier ? Number(frontier.bestNextFloorOpportunity || 0) : 0,
    changeOpportunity: frontier ? Number(frontier.bestChangeFloorOpportunity || 0) : 0,
    preferredChangeZeroDamage: preferredChangePreview ? Number(preferredChangePreview.zeroDamageBattleCount || 0) : 0,
    preferredChangeItems: preferredChangePreview ? Number(preferredChangePreview.itemCount || 0) : 0,
    regionSize: frontier ? frontier.regionSize : 0,
    primary: resolvedScore.primary,
    tertiary: resolvedScore.tertiary,
    decisionDepth: getDecisionDepth(state),
    routeLength: Array.isArray(state.route) && state.route.length > 0 ? state.route.length : getDecisionDepth(state),
  };
}

function compareScore(left, right) {
  if (left.primary !== right.primary) return left.primary - right.primary;
  if (left.secondary !== right.secondary) return left.secondary - right.secondary;
  if (left.tertiary !== right.tertiary) return left.tertiary - right.tertiary;
  return 0;
}

function compareSearchRank(left, right) {
  if (left.progressFloor !== right.progressFloor) return left.progressFloor - right.progressFloor;
  if (left.nextOpportunity !== right.nextOpportunity) return left.nextOpportunity - right.nextOpportunity;
  if (left.changeOpportunity !== right.changeOpportunity) return left.changeOpportunity - right.changeOpportunity;
  if (left.changeReady !== right.changeReady) return left.changeReady - right.changeReady;
  if (left.preferredChangeItems !== right.preferredChangeItems) return left.preferredChangeItems - right.preferredChangeItems;
  if (left.preferredChangeZeroDamage !== right.preferredChangeZeroDamage) {
    return left.preferredChangeZeroDamage - right.preferredChangeZeroDamage;
  }
  if (left.nextDistance !== right.nextDistance) return right.nextDistance - left.nextDistance;
  if (left.zeroDamageBattle !== right.zeroDamageBattle) return left.zeroDamageBattle - right.zeroDamageBattle;
  if (left.battleFrontier !== right.battleFrontier) return left.battleFrontier - right.battleFrontier;
  if (left.changeDistance !== right.changeDistance) return right.changeDistance - left.changeDistance;
  if (left.currentFloor !== right.currentFloor) return left.currentFloor - right.currentFloor;
  if (left.combat !== right.combat) return left.combat - right.combat;
  if (left.hp !== right.hp) return left.hp - right.hp;
  if (left.regionSize !== right.regionSize) return left.regionSize - right.regionSize;
  if (left.primary !== right.primary) return left.primary - right.primary;
  if (left.tertiary !== right.tertiary) return left.tertiary - right.tertiary;
  if (left.decisionDepth !== right.decisionDepth) return right.decisionDepth - left.decisionDepth;
  return right.routeLength - left.routeLength;
}

function formatScore(score) {
  return `${score.primary}/${score.secondary}/${score.tertiary}`;
}

module.exports = {
  compareSearchRank,
  compareScore,
  defaultScore,
  defaultSearchRank,
  estimateNextFloorDistance,
  formatScore,
  getFloorOrder,
  getProgressFloorOrder,
};
