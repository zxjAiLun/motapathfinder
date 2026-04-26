"use strict";

const { scoutChangeFloor } = require("./floor-scout");
const { getFloorOrder } = require("./score");
const { getDecisionDepth } = require("./state");

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
    equipment: Array.isArray(hero.equipment) ? hero.equipment.slice().sort() : [],
  };
}

function combatScore(hero) {
  return number(hero.atk, 0) * 100000 + number(hero.def, 0) * 90000 + number(hero.mdef, 0) * 8000 + number(hero.lv, 0) * 150000 + number(hero.hp, 0);
}

function isKeyItem(itemId) {
  return /key/i.test(itemId) || itemId === "yellowKey" || itemId === "blueKey" || itemId === "redKey";
}

function keySignature(inventory) {
  return Object.entries(inventory || {})
    .filter(([key]) => isKeyItem(key))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}:${value}`)
    .join(",");
}

function keyCount(inventory) {
  return Object.entries(inventory || {})
    .filter(([key]) => isKeyItem(key))
    .reduce((sum, [, value]) => sum + Math.max(0, number(value, 0)), 0);
}

function equipmentSignature(checkpoint) {
  const equipment = checkpoint.equipment || (checkpoint.hero && checkpoint.hero.equipment) || [];
  return Array.isArray(equipment) ? equipment.slice().sort().join(",") : "";
}

function combatSignature(checkpoint) {
  const hero = checkpoint.hero || {};
  const expBucket = Math.floor(number(hero.exp, 0) / 5) * 5;
  return [
    hero.atk,
    hero.def,
    hero.mdef,
    hero.lv,
    expBucket,
    keySignature(checkpoint.inventory),
    equipmentSignature(checkpoint),
  ].join("|");
}

function checkpointScore(checkpoint) {
  const hero = checkpoint.hero || {};
  const scoutScore = number(checkpoint.scout && checkpoint.scout.score, 0);
  return combatScore(hero) + scoutScore * 4 + keyCount(checkpoint.inventory) * 8000 - number(checkpoint.routeLength, 0) * 200;
}

function isForwardChangeFloor(parentState, childState, action) {
  if (!action || action.kind !== "changeFloor") return false;
  if (!parentState || !childState || parentState.floorId === childState.floorId) return false;
  return getFloorOrder(childState.floorId) > getFloorOrder(parentState.floorId);
}

function createCheckpointPool(options) {
  return {
    edges: {},
    nextIndexByEdge: {},
    options: {
      checkpointLimitPerEdge: 96,
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
    equipment: Array.isArray((childState.hero || {}).equipment) ? childState.hero.equipment.slice().sort() : [],
    inventory: cloneJson(childState.inventory || {}),
    tags: [],
    skylineKey: null,
    scout,
    state: childState,
    score: 0,
  };
}

function scoutScore(checkpoint) {
  return number(checkpoint && checkpoint.scout && checkpoint.scout.score, 0);
}

function compareByHp(left, right) {
  return number(right.hero && right.hero.hp, 0) - number(left.hero && left.hero.hp, 0) ||
    checkpointScore(right) - checkpointScore(left) ||
    number(left.routeLength, 0) - number(right.routeLength, 0);
}

function compareByCombat(left, right) {
  return combatScore(right.hero || {}) - combatScore(left.hero || {}) || compareByHp(left, right);
}

function compareByRoute(left, right) {
  return number(left.routeLength, 0) - number(right.routeLength, 0) ||
    number(right.hero && right.hero.hp, 0) - number(left.hero && left.hero.hp, 0) ||
    checkpointScore(right) - checkpointScore(left);
}

function compareByExp(left, right) {
  return number(right.hero && right.hero.exp, 0) - number(left.hero && left.hero.exp, 0) ||
    number(right.hero && right.hero.hp, 0) - number(left.hero && left.hero.hp, 0) ||
    checkpointScore(right) - checkpointScore(left);
}

function compareByKeys(left, right) {
  return keyCount(right.inventory) - keyCount(left.inventory) ||
    number(right.hero && right.hero.hp, 0) - number(left.hero && left.hero.hp, 0) ||
    checkpointScore(right) - checkpointScore(left);
}

function compareByScout(left, right) {
  return scoutScore(right) - scoutScore(left) ||
    number(right.hero && right.hero.hp, 0) - number(left.hero && left.hero.hp, 0) ||
    checkpointScore(right) - checkpointScore(left);
}

function addTag(checkpoint, tag) {
  if (checkpoint && !checkpoint.tags.includes(tag)) checkpoint.tags.push(tag);
}

function tagBest(list, tag, compare) {
  const best = list.slice().sort(compare)[0];
  if (best) addTag(best, tag);
  return best;
}

function dominatesCheckpoint(left, right) {
  if (left === right) return false;
  const leftHero = left.hero || {};
  const rightHero = right.hero || {};
  const comparisons = [
    number(leftHero.hp, 0) - number(rightHero.hp, 0),
    number(right.routeLength, 0) - number(left.routeLength, 0),
    number(leftHero.exp, 0) - number(rightHero.exp, 0),
    keyCount(left.inventory) - keyCount(right.inventory),
    scoutScore(left) - scoutScore(right),
  ];
  return comparisons.every((value) => value >= 0) && comparisons.some((value) => value > 0);
}

function selectBucketSkyline(bucket) {
  return bucket.filter((candidate) => !bucket.some((other) => dominatesCheckpoint(other, candidate)));
}

function tagSkylineBucket(bucket, skylineKey) {
  const skyline = selectBucketSkyline(bucket);
  skyline.forEach((checkpoint) => {
    checkpoint.skylineKey = skylineKey;
    addTag(checkpoint, "skyline");
  });
  tagBest(skyline, "skyline-highest-hp", compareByHp);
  tagBest(skyline, "skyline-highest-combat", compareByCombat);
  tagBest(skyline, "skyline-shortest-route", compareByRoute);
  tagBest(skyline, "skyline-fastest", compareByRoute);
  tagBest(skyline, "skyline-near-level", compareByExp);
  tagBest(skyline, "skyline-most-keys", compareByKeys);
  tagBest(skyline, "skyline-best-scout", compareByScout);
  return skyline;
}

function tagCheckpoints(list) {
  list.forEach((checkpoint) => { checkpoint.tags = []; checkpoint.score = checkpointScore(checkpoint); });
  tagBest(list, "highest-hp", compareByHp);
  tagBest(list, "highest-atk", (left, right) => right.hero.atk - left.hero.atk || compareByHp(left, right));
  tagBest(list, "highest-def", (left, right) => right.hero.def - left.hero.def || compareByHp(left, right));
  tagBest(list, "highest-mdef", (left, right) => right.hero.mdef - left.hero.mdef || compareByHp(left, right));
  tagBest(list, "highest-combat", (left, right) => combatScore(right.hero) - combatScore(left.hero) || compareByHp(left, right));
  tagBest(list, "near-levelup", compareByExp);
  tagBest(list, "fastest", compareByRoute);
  tagBest(list, "best-scout", compareByScout);
  tagBest(list, "shortest-route", compareByRoute);

  const bySignature = new Map();
  list.forEach((checkpoint) => {
    const key = combatSignature(checkpoint);
    checkpoint.skylineKey = key;
    const bucket = bySignature.get(key) || [];
    bucket.push(checkpoint);
    bySignature.set(key, bucket);
  });
  bySignature.forEach((bucket, skylineKey) => {
    tagSkylineBucket(bucket, skylineKey);
  });
}

function retentionPriority(checkpoint) {
  const tags = new Set(checkpoint.tags || []);
  let priority = 0;
  if (tags.has("skyline-highest-hp")) priority += 1000;
  if (tags.has("skyline-highest-combat")) priority += 950;
  if (tags.has("skyline-shortest-route")) priority += 900;
  if (tags.has("skyline-fastest")) priority += 900;
  if (tags.has("skyline-near-level")) priority += 800;
  if (tags.has("skyline-most-keys")) priority += 700;
  if (tags.has("skyline-best-scout")) priority += 600;
  if (tags.has("highest-hp")) priority += 500;
  if (tags.has("highest-combat")) priority += 450;
  if (tags.has("best-scout")) priority += 400;
  if (tags.has("fastest") || tags.has("shortest-route")) priority += 350;
  return priority + Math.min(100, (checkpoint.tags || []).length * 5);
}

function pruneEdgeCheckpoints(list, options) {
  tagCheckpoints(list);
  const keep = list
    .filter((checkpoint) => (checkpoint.tags || []).length > 0)
    .sort((left, right) => {
      const priorityDiff = retentionPriority(right) - retentionPriority(left);
      if (priorityDiff !== 0) return priorityDiff;
      return right.score - left.score || compareByHp(left, right);
    })
    .slice(0, number(options.checkpointLimitPerEdge, 96));
  tagCheckpoints(keep);
  return keep;
}

function recordFloorEntryCheckpoint(pool, simulator, parentState, childState, action) {
  if (!pool || !isForwardChangeFloor(parentState, childState, action)) return null;
  const edge = `${parentState.floorId}->${childState.floorId}`;
  const list = pool.edges[edge] || [];
  if (!pool.nextIndexByEdge) pool.nextIndexByEdge = {};
  const index = number(pool.nextIndexByEdge[edge], 0);
  pool.nextIndexByEdge[edge] = index + 1;
  const checkpoint = buildCheckpoint(simulator, parentState, childState, action, index);
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
  const tags = checkpoint.tags || [];
  return {
    id: checkpoint.id,
    edge: checkpoint.edge,
    fromFloorId: checkpoint.fromFloorId,
    toFloorId: checkpoint.toFloorId,
    routeLength: checkpoint.routeLength,
    decisionDepth: checkpoint.decisionDepth,
    hero: checkpoint.hero,
    equipment: checkpoint.equipment,
    inventoryKeySignature: keySignature(checkpoint.inventory),
    keyCount: keyCount(checkpoint.inventory),
    skylineKey: checkpoint.skylineKey || combatSignature(checkpoint),
    skylineRoles: {
      highestHp: tags.includes("skyline-highest-hp"),
      highestCombat: tags.includes("skyline-highest-combat"),
      shortestRoute: tags.includes("skyline-shortest-route"),
      fastest: tags.includes("skyline-fastest"),
      nearLevel: tags.includes("skyline-near-level"),
      mostKeys: tags.includes("skyline-most-keys"),
      bestScout: tags.includes("skyline-best-scout"),
    },
    tags,
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
  const preferTags = blocker && blocker.recommendedRepair && Array.isArray(blocker.recommendedRepair.preferTags)
    ? blocker.recommendedRepair.preferTags
    : [];
  const preferredTagScore = (checkpoint) => preferTags.reduce((sum, tag) => sum + ((checkpoint.tags || []).includes(tag) ? 1 : 0), 0);
  const baseSorted = list
    .slice()
    .sort((left, right) => {
      const leftMeets = meetsMinHero(left.hero, minHero) ? 1 : 0;
      const rightMeets = meetsMinHero(right.hero, minHero) ? 1 : 0;
      if (leftMeets !== rightMeets) return rightMeets - leftMeets;
      const tagDiff = preferredTagScore(right) - preferredTagScore(left);
      if (tagDiff !== 0) return tagDiff;
      if (left.hero.hp !== right.hero.hp) return right.hero.hp - left.hero.hp;
      const scoutDiff = number(right.scout && right.scout.score, 0) - number(left.scout && left.scout.score, 0);
      if (scoutDiff !== 0) return scoutDiff;
      const combatDiff = combatScore(right.hero) - combatScore(left.hero);
      if (combatDiff !== 0) return combatDiff;
      return left.routeLength - right.routeLength;
    });
  const maxAttempts = number(options && options.maxRepairAttempts, 6);
  const selected = [];
  const add = (checkpoint, strategy) => {
    if (!checkpoint) return;
    const existing = selected.find((candidate) => candidate.id === checkpoint.id);
    if (existing) {
      if (!existing.repairStrategies.includes(strategy)) existing.repairStrategies.push(strategy);
      return;
    }
    if (selected.length >= maxAttempts) return;
    selected.push({ ...checkpoint, repairStrategy: strategy, repairStrategies: [strategy] });
  };
  const bestBy = (strategy, candidates, compare) => {
    add((candidates && candidates.length ? candidates : list).slice().sort(compare)[0], strategy);
  };
  const byTag = (tag) => list.filter((checkpoint) => (checkpoint.tags || []).includes(tag));

  preferTags.forEach((tag) => {
    const matches = byTag(tag);
    if (matches.length > 0) bestBy(`preferred:${tag}`, matches, baseSortedComparator(baseSorted));
  });
  bestBy("closest-requirement", list, (left, right) => requirementDeficitScore(left, minHero) - requirementDeficitScore(right, minHero) || compareByHp(left, right));
  bestBy("highest-hp", byTag("skyline-highest-hp").concat(byTag("highest-hp")), compareByHp);
  bestBy("highest-combat", byTag("skyline-highest-combat").concat(byTag("highest-combat")), compareByCombat);
  bestBy("fastest-route", byTag("skyline-fastest").concat(byTag("skyline-shortest-route")).concat(byTag("shortest-route")).concat(byTag("fastest")), compareByRoute);
  bestBy("near-level", byTag("skyline-near-level").concat(byTag("near-levelup")), compareByExp);
  bestBy("most-keys", byTag("skyline-most-keys"), compareByKeys);
  bestBy("best-scout", byTag("skyline-best-scout").concat(byTag("best-scout")), compareByScout);
  baseSorted.forEach((checkpoint) => add(checkpoint, "ranked"));
  return selected.slice(0, maxAttempts);
}

function meetsMinHero(hero, minHero) {
  return number(hero.hp, 0) >= number(minHero.hp, 0) &&
    number(hero.atk, 0) >= number(minHero.atk, 0) &&
    number(hero.def, 0) >= number(minHero.def, 0) &&
    number(hero.mdef, 0) >= number(minHero.mdef, 0);
}

function requirementDeficitScore(checkpoint, minHero) {
  const hero = checkpoint.hero || {};
  return Math.max(0, number(minHero.hp, 0) - number(hero.hp, 0)) +
    Math.max(0, number(minHero.atk, 0) - number(hero.atk, 0)) * 10000 +
    Math.max(0, number(minHero.def, 0) - number(hero.def, 0)) * 9000 +
    Math.max(0, number(minHero.mdef, 0) - number(hero.mdef, 0)) * 1200;
}

function baseSortedComparator(sorted) {
  const rank = new Map((sorted || []).map((checkpoint, index) => [checkpoint.id, index]));
  return (left, right) => number(rank.get(left.id), Number.MAX_SAFE_INTEGER) - number(rank.get(right.id), Number.MAX_SAFE_INTEGER);
}

module.exports = {
  combatScore,
  combatSignature,
  createCheckpointPool,
  hydrateCheckpointPool,
  keyCount,
  keySignature,
  recordFloorEntryCheckpoint,
  requirementDeficitScore,
  selectRepairCheckpoints,
  summarizeCheckpointPool,
};
