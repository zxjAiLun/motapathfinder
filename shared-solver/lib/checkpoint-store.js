"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { combatSignature, createCheckpointPool, summarizeCheckpointPool } = require("./floor-checkpoints");
const { cloneState } = require("./state");

const SLOT_TAGS = {
  highestHp: "skyline-highest-hp",
  shortestRoute: "skyline-shortest-route",
  nearLevel: "skyline-near-level",
  mostKeys: "skyline-most-keys",
  bestScout: "skyline-best-scout",
};

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function hashJson(value) {
  return crypto.createHash("sha1").update(JSON.stringify(value)).digest("hex");
}

function buildRouteFingerprint(project, routeContext) {
  return hashJson({
    title: project && project.data && project.data.firstData && project.data.firstData.title,
    floorOrder: routeContext && routeContext.floorOrder,
    floors: Object.keys((project || {}).floorsById || {}).sort(),
  });
}

function emptyStore(projectId, profile, routeFingerprint) {
  return {
    version: 1,
    projectId,
    profile,
    routeFingerprint,
    updatedAt: new Date().toISOString(),
    edges: {},
  };
}

function loadCheckpointStore(filePath, context) {
  const routeFingerprint = context.routeFingerprint || buildRouteFingerprint(context.project, context.routeContext);
  if (!filePath || !fs.existsSync(filePath)) {
    return {
      filePath,
      usable: true,
      stale: false,
      store: emptyStore(context.projectId, context.profile, routeFingerprint),
      loadError: null,
    };
  }
  try {
    const store = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const stale = store.routeFingerprint !== routeFingerprint;
    return {
      filePath,
      usable: !stale,
      stale,
      store,
      loadError: null,
    };
  } catch (error) {
    return {
      filePath,
      usable: false,
      stale: false,
      store: emptyStore(context.projectId, context.profile, routeFingerprint),
      loadError: error.message,
    };
  }
}

function compactCheckpoint(checkpoint) {
  return {
    id: checkpoint.id,
    edge: checkpoint.edge,
    fromFloorId: checkpoint.fromFloorId,
    toFloorId: checkpoint.toFloorId,
    routeLength: checkpoint.routeLength,
    decisionDepth: checkpoint.decisionDepth,
    hero: cloneJson(checkpoint.hero),
    equipment: cloneJson(checkpoint.equipment),
    inventory: cloneJson(checkpoint.inventory),
    tags: Array.isArray(checkpoint.tags) ? checkpoint.tags.slice() : [],
    skylineKey: checkpoint.skylineKey || combatSignature(checkpoint),
    scout: cloneJson(checkpoint.scout),
    score: checkpoint.score,
    route: Array.isArray(checkpoint.route) ? checkpoint.route.slice() : [],
    state: checkpoint.state ? cloneState(checkpoint.state) : null,
  };
}

function shouldReplace(slot, candidate, role) {
  if (!slot) return true;
  const leftHp = Number((candidate.hero || {}).hp || 0);
  const rightHp = Number((slot.hero || {}).hp || 0);
  if (role === "shortestRoute") {
    if (Number(candidate.routeLength || 0) !== Number(slot.routeLength || 0)) {
      return Number(candidate.routeLength || 0) < Number(slot.routeLength || 0);
    }
    return leftHp > rightHp;
  }
  if (role === "nearLevel") {
    if (Number((candidate.hero || {}).exp || 0) !== Number((slot.hero || {}).exp || 0)) {
      return Number((candidate.hero || {}).exp || 0) > Number((slot.hero || {}).exp || 0);
    }
    return leftHp > rightHp;
  }
  if (role === "mostKeys") {
    const keyCount = (checkpoint) => Object.values((checkpoint || {}).inventory || {}).reduce((sum, value) => sum + Number(value || 0), 0);
    if (keyCount(candidate) !== keyCount(slot)) return keyCount(candidate) > keyCount(slot);
    return leftHp > rightHp;
  }
  if (role === "bestScout") {
    if (Number((candidate.scout || {}).score || 0) !== Number((slot.scout || {}).score || 0)) {
      return Number((candidate.scout || {}).score || 0) > Number((slot.scout || {}).score || 0);
    }
    return leftHp > rightHp;
  }
  return leftHp > rightHp || (leftHp === rightHp && Number(candidate.routeLength || 0) < Number(slot.routeLength || 0));
}

function putCheckpoint(edgeRecord, checkpoint) {
  const key = checkpoint.skylineKey || combatSignature(checkpoint);
  if (!edgeRecord.buckets[key]) edgeRecord.buckets[key] = {};
  const bucket = edgeRecord.buckets[key];
  Object.entries(SLOT_TAGS).forEach(([role, tag]) => {
    if (!(checkpoint.tags || []).includes(tag) && role !== "highestHp") return;
    if (shouldReplace(bucket[role], checkpoint, role)) bucket[role] = checkpoint;
  });
}

function mergeCheckpointPoolIntoStore(store, checkpointPool, context) {
  if (!store || !checkpointPool || !checkpointPool.edges) return store;
  const next = {
    ...store,
    version: 1,
    projectId: context.projectId || store.projectId,
    profile: context.profile || store.profile,
    routeFingerprint: context.routeFingerprint || store.routeFingerprint,
    updatedAt: new Date().toISOString(),
    edges: cloneJson(store.edges || {}),
  };
  Object.entries(checkpointPool.edges || {}).forEach(([edge, list]) => {
    if (!next.edges[edge]) next.edges[edge] = { buckets: {} };
    (list || []).forEach((checkpoint) => putCheckpoint(next.edges[edge], compactCheckpoint(checkpoint)));
  });
  return next;
}

function saveCheckpointStore(filePath, store) {
  if (!filePath || !store) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function flattenStoredCheckpoints(store) {
  const byKey = new Map();
  Object.entries((store || {}).edges || {}).forEach(([edge, edgeRecord]) => {
    Object.entries((edgeRecord || {}).buckets || {}).forEach(([skylineKey, bucket]) => {
      Object.entries(bucket || {}).forEach(([role, checkpoint]) => {
        if (!checkpoint || !checkpoint.state) return;
        const key = `${edge}|${checkpoint.id || ""}|${checkpoint.routeLength || 0}|${skylineKey}`;
        const strategy = `stored:${role}`;
        const existing = byKey.get(key);
        if (existing) {
          if (!existing.repairStrategies.includes(strategy)) existing.repairStrategies.push(strategy);
          return;
        }
        byKey.set(key, {
          ...checkpoint,
          id: checkpoint.id || `${edge}:${skylineKey}:${role}`,
          edge,
          skylineKey,
          repairStrategy: strategy,
          repairStrategies: [strategy],
        });
      });
    });
  });
  return Array.from(byKey.values());
}

function checkpointPoolFromStore(store) {
  const pool = createCheckpointPool();
  flattenStoredCheckpoints(store).forEach((checkpoint) => {
    if (!pool.edges[checkpoint.edge]) pool.edges[checkpoint.edge] = [];
    pool.edges[checkpoint.edge].push(checkpoint);
  });
  return pool;
}

function selectCheckpointSeeds(store, routeContext, targetFloorId, options) {
  const maxSeeds = Number((options || {}).maxSeeds || 8);
  const getOrder = routeContext && routeContext.getFloorOrder ? routeContext.getFloorOrder : () => -1;
  const targetOrder = getOrder(targetFloorId);
  const candidates = flattenStoredCheckpoints(store)
    .filter((checkpoint) => checkpoint.state && checkpoint.toFloorId && getOrder(checkpoint.toFloorId) <= targetOrder)
    .sort((left, right) => {
      const floorDiff = getOrder(right.toFloorId) - getOrder(left.toFloorId);
      if (floorDiff !== 0) return floorDiff;
      const leftHp = Number((left.hero || {}).hp || 0);
      const rightHp = Number((right.hero || {}).hp || 0);
      if (leftHp !== rightHp) return rightHp - leftHp;
      return Number(left.routeLength || 0) - Number(right.routeLength || 0);
    });
  const seen = new Set();
  const seeds = [];
  candidates.forEach((checkpoint) => {
    if (seeds.length >= maxSeeds) return;
    const key = checkpoint.stateKey || `${checkpoint.edge}|${checkpoint.skylineKey}|${checkpoint.routeLength}|${(checkpoint.hero || {}).hp}`;
    if (seen.has(key)) return;
    seen.add(key);
    seeds.push(checkpoint);
  });
  return seeds;
}

function summarizeStore(store) {
  return {
    version: store && store.version,
    projectId: store && store.projectId,
    profile: store && store.profile,
    updatedAt: store && store.updatedAt,
    checkpointPool: summarizeCheckpointPool(checkpointPoolFromStore(store), { limit: 4 }),
  };
}

module.exports = {
  buildRouteFingerprint,
  checkpointPoolFromStore,
  loadCheckpointStore,
  mergeCheckpointPoolIntoStore,
  saveCheckpointStore,
  selectCheckpointSeeds,
  summarizeStore,
};
