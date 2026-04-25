"use strict";

const { scoutChangeFloor } = require("./floor-scout");
const { getFloorOrder } = require("./score");
const { cloneState, getDecisionDepth } = require("./state");

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function heroSnapshot(state) {
  const hero = state.hero || {};
  return {
    hp: number(hero.hp, 0),
    atk: number(hero.atk, 0),
    def: number(hero.def, 0),
    mdef: number(hero.mdef, 0),
    lv: number(hero.lv, 0),
    exp: number(hero.exp, 0),
    money: number(hero.money, 0),
  };
}

function combatScore(hero) {
  return number(hero.atk, 0) * 100000 + number(hero.def, 0) * 90000 + number(hero.mdef, 0) * 8000 + number(hero.lv, 0) * 150000 + number(hero.hp, 0);
}

function keySignature(inventory) {
  return Object.entries(inventory || {})
    .filter(([key]) => /key/i.test(key) || key === "yellowKey" || key === "blueKey" || key === "redKey")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}:${value}`)
    .join(",");
}

function combatSignature(checkpoint) {
  const hero = checkpoint.hero || {};
  const expBucket = Math.floor(number(hero.exp, 0) / 5) * 5;
  return [hero.atk, hero.def, hero.mdef, hero.lv, expBucket, keySignature(checkpoint.inventory)].join("|");
}

function checkpointScore(checkpoint) {
  const hero = checkpoint.hero || {};
  const scoutScore = number(checkpoint.scout && checkpoint.scout.score, 0);
  return combatScore(hero) + scoutScore * 4 - number(checkpoint.routeLength, 0) * 200;
}

function isForwardChangeFloor(parentState, childState, action) {
  if (!action || action.kind !== "changeFloor") return false;
  if (!parentState || !childState || parentState.floorId === childState.floorId) return false;
  return getFloorOrder(childState.floorId) > getFloorOrder(parentState.floorId);
}

function createCheckpointPool(options) {
  return {
    edges: {},
    options: {
      checkpointLimitPerEdge: 24,
      representativesPerCombatSignature: 2,
      ...(options || {}),
    },
  };
}

function buildCheckpoint(simulator, parentState, childState, action, index) {
  const edge = `${parentState.floorId}->${childState.floorId}`;
  let scout = null;
  try {
    scout = scoutChangeFloor(simulator, parentState, action);
  } catch (error) {
    scout = {
      score: -100000,
      verdict: { canProgressImmediately: false, likelyBlocked: true, reasons: ["scout-failed"] },
      unsupportedNotes: [error.message],
    };
  }
  return {
    id: `${edge}#${index}`,
    edge,
    fromFloorId: parentState.floorId,
    toFloorId: childState.floorId,
    route: Array.isArray(childState.route) ? childState.route.slice() : [],
    routeLength: Array.isArray(childState.route) ? childState.route.length : 0,
    decisionDepth: getDecisionDepth(childState),
    hero: heroSnapshot(childState),
    inventory: cloneJson(childState.inventory || {}),
    tags: [],
    scout,
    state: childState,
    score: 0,
  };
}

function tagCheckpoints(list) {
  list.forEach((checkpoint) => { checkpoint.tags = []; checkpoint.score = checkpointScore(checkpoint); });
  const tagBest = (tag, compare) => {
    const best = list.slice().sort(compare)[0];
    if (best && !best.tags.includes(tag)) best.tags.push(tag);
  };
  tagBest("highest-hp", (left, right) => right.hero.hp - left.hero.hp);
  tagBest("highest-atk", (left, right) => right.hero.atk - left.hero.atk);
  tagBest("highest-def", (left, right) => right.hero.def - left.hero.def);
  tagBest("highest-mdef", (left, right) => right.hero.mdef - left.hero.mdef);
  tagBest("highest-combat", (left, right) => combatScore(right.hero) - combatScore(left.hero));
  tagBest("near-levelup", (left, right) => right.hero.exp - left.hero.exp);
  tagBest("fastest", (left, right) => left.routeLength - right.routeLength);
  tagBest("best-scout", (left, right) => number(right.scout && right.scout.score, 0) - number(left.scout && left.scout.score, 0));
  tagBest("shortest-route", (left, right) => left.routeLength - right.routeLength);
}

function pruneEdgeCheckpoints(list, options) {
  tagCheckpoints(list);
  const keep = [];
  const seenIds = new Set();
  const add = (checkpoint) => {
    if (!checkpoint || seenIds.has(checkpoint.id)) return;
    seenIds.add(checkpoint.id);
    keep.push(checkpoint);
  };

  list.filter((checkpoint) => (checkpoint.tags || []).length > 0).forEach(add);

  const bySignature = new Map();
  list.forEach((checkpoint) => {
    const key = combatSignature(checkpoint);
    const bucket = bySignature.get(key) || [];
    bucket.push(checkpoint);
    bySignature.set(key, bucket);
  });
  bySignature.forEach((bucket) => {
    bucket
      .slice()
      .sort((left, right) => right.hero.hp - left.hero.hp || right.score - left.score)
      .slice(0, number(options.representativesPerCombatSignature, 2))
      .forEach(add);
  });

  list.slice().sort((left, right) => right.score - left.score).forEach(add);
  keep.length = Math.min(keep.length, number(options.checkpointLimitPerEdge, 24));
  tagCheckpoints(keep);
  return keep;
}

function recordFloorEntryCheckpoint(pool, simulator, parentState, childState, action) {
  if (!pool || !isForwardChangeFloor(parentState, childState, action)) return null;
  const edge = `${parentState.floorId}->${childState.floorId}`;
  const list = pool.edges[edge] || [];
  const checkpoint = buildCheckpoint(simulator, parentState, childState, action, list.length);
  list.push(checkpoint);
  pool.edges[edge] = pruneEdgeCheckpoints(list, pool.options || {});
  return checkpoint;
}

function hydrateCheckpointPool(pool, hydrateState) {
  if (!pool || !pool.edges) return pool;
  Object.values(pool.edges).forEach((list) => {
    list.forEach((checkpoint) => {
      if (checkpoint.state && hydrateState) {
        checkpoint.state = hydrateState(checkpoint.state) || checkpoint.state;
        checkpoint.route = Array.isArray(checkpoint.state.route) ? checkpoint.state.route.slice() : checkpoint.route;
        checkpoint.routeLength = Array.isArray(checkpoint.state.route) ? checkpoint.state.route.length : checkpoint.routeLength;
        checkpoint.decisionDepth = getDecisionDepth(checkpoint.state);
      }
    });
  });
  return pool;
}

function summarizeCheckpoint(checkpoint) {
  return {
    id: checkpoint.id,
    edge: checkpoint.edge,
    fromFloorId: checkpoint.fromFloorId,
    toFloorId: checkpoint.toFloorId,
    routeLength: checkpoint.routeLength,
    decisionDepth: checkpoint.decisionDepth,
    hero: checkpoint.hero,
    tags: checkpoint.tags,
    score: checkpoint.score,
    scout: checkpoint.scout ? {
      score: checkpoint.scout.score,
      reachable: checkpoint.scout.reachable,
      deficits: checkpoint.scout.deficits,
      verdict: checkpoint.scout.verdict,
      entry: checkpoint.scout.entry,
    } : null,
  };
}

function summarizeCheckpointPool(pool, options) {
  const limit = number(options && options.limit, 8);
  const edges = {};
  if (!pool || !pool.edges) return { edges };
  Object.entries(pool.edges).forEach(([edge, list]) => {
    edges[edge] = list
      .slice()
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
      .map(summarizeCheckpoint);
  });
  return { edges };
}

function selectRepairCheckpoints(pool, blocker, options) {
  const edge = blocker && blocker.recommendedRepair && blocker.recommendedRepair.fromEdge;
  const list = edge && pool && pool.edges ? (pool.edges[edge] || []) : [];
  const minHero = blocker && blocker.recommendedRepair && blocker.recommendedRepair.minHero || {};
  return list
    .slice()
    .sort((left, right) => {
      const leftMeets = meetsMinHero(left.hero, minHero) ? 1 : 0;
      const rightMeets = meetsMinHero(right.hero, minHero) ? 1 : 0;
      if (leftMeets !== rightMeets) return rightMeets - leftMeets;
      if (left.hero.hp !== right.hero.hp) return right.hero.hp - left.hero.hp;
      const scoutDiff = number(right.scout && right.scout.score, 0) - number(left.scout && left.scout.score, 0);
      if (scoutDiff !== 0) return scoutDiff;
      const combatDiff = combatScore(right.hero) - combatScore(left.hero);
      if (combatDiff !== 0) return combatDiff;
      return left.routeLength - right.routeLength;
    })
    .slice(0, number(options && options.maxRepairAttempts, 6));
}

function meetsMinHero(hero, minHero) {
  return number(hero.hp, 0) >= number(minHero.hp, 0) &&
    number(hero.atk, 0) >= number(minHero.atk, 0) &&
    number(hero.def, 0) >= number(minHero.def, 0) &&
    number(hero.mdef, 0) >= number(minHero.mdef, 0);
}

module.exports = {
  combatScore,
  combatSignature,
  createCheckpointPool,
  hydrateCheckpointPool,
  recordFloorEntryCheckpoint,
  selectRepairCheckpoints,
  summarizeCheckpointPool,
};
