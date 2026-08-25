"use strict";

const { runAutoEvents } = require("./events");
const { buildMovementHazards } = require("./movement-hazards");
const { DIRECTIONS, DIRECTION_DELTAS, coordinateKey, isDoorTile, isEnemyTile } = require("./reachability");
const { buildDominanceKey, buildStateKey, hasDirectionalStateSensitivity } = require("./state-key");
const {
  cloneState,
  floorHasCoordinate,
  getTileDefinitionAt,
  listFloorMutationSummary,
  removeTileAt,
  replaceTileAt,
} = require("./state");

function isEndpointTile(project, state, floorId, x, y) {
  const floor = project.floorsById[floorId];
  if ((floor.changeFloor || {})[coordinateKey(x, y)]) return true;

  const tile = getTileDefinitionAt(project, state, floorId, x, y);
  if (!tile) return false;
  if (tile.cls === "items") return true;
  if (tile.trigger != null && tile.trigger !== "null" && tile.trigger !== "passNet") return true;
  return false;
}

function isTransitTile(project, state, floorId, x, y) {
  if (!floorHasCoordinate(project, floorId, x, y)) return false;
  if (isEndpointTile(project, state, floorId, x, y)) return false;

  const tile = getTileDefinitionAt(project, state, floorId, x, y);
  if (tile == null) return true;
  if (isEnemyTile(tile)) return false;
  if (isDoorTile(tile)) return false;
  return tile.canPass === true;
}

function isStepPassableTile(project, state, floorId, x, y) {
  if (!floorHasCoordinate(project, floorId, x, y)) return false;

  const tile = getTileDefinitionAt(project, state, floorId, x, y);
  if (tile == null) return true;
  if (isEnemyTile(tile)) return false;
  if (isDoorTile(tile)) return false;
  if (tile.cls === "items") return true;
  return tile.canPass === true;
}

function getHazardsForState(project, state, options, cache) {
  const key = buildStateKey(state);
  if (!cache.has(key)) {
    cache.set(
      key,
      buildMovementHazards(project, state, {
        floorId: state.floorId,
        battleResolver: options.battleResolver,
        enableFastHazardBlockIndex: options.enableFastHazardBlockIndex,
      })
    );
  }
  return cache.get(key);
}

function applyPoison(project, state) {
  if (!state.flags.poison) return true;
  const poisonDamage = Number(project.values.poisonDamage || 0);
  if (!state.hero.statistics) state.hero.statistics = {};
  state.hero.statistics.poisonDamage = Number(state.hero.statistics.poisonDamage || 0) + poisonDamage;
  state.hero.hp = Number(state.hero.hp || 0) - poisonDamage;
  return state.hero.hp > 0;
}

function ensureHazardStats(state) {
  if (!state.meta) state.meta = {};
  if (!state.meta.hazardStats) {
    state.meta.hazardStats = {
      damage: 0,
      zone: 0,
      laser: 0,
      repulseDamage: 0,
      betweenAttack: 0,
      lava: 0,
      repulseMoves: 0,
      ambushBattles: 0,
    };
  }
  return state.meta.hazardStats;
}

function recordHazardDamage(state, hazards, loc, damage) {
  if (!damage) return;
  const stats = ensureHazardStats(state);
  stats.damage = Number(stats.damage || 0) + Number(damage);
  const type = (hazards.type || {})[loc] || {};
  if (type.zoneDamage) stats.zone = Number(stats.zone || 0) + 1;
  if (type.laserDamage) stats.laser = Number(stats.laser || 0) + 1;
  if (type.repulseDamage) stats.repulseDamage = Number(stats.repulseDamage || 0) + 1;
  if (type.betweenAttackDamage) stats.betweenAttack = Number(stats.betweenAttack || 0) + 1;
  Object.keys(type).forEach((key) => {
    if (/lava|血网|熔岩/i.test(key)) stats.lava = Number(stats.lava || 0) + 1;
  });
}

function applyRepulseMoves(project, state, repulse) {
  (repulse || []).forEach((entry) => {
    const [x, y, enemyId, direction, targetX, targetY] = entry;
    if (targetX == null || targetY == null) {
      state.notes.push(`Repulse at ${state.floorId}:${x},${y} lacks target; skipped.`);
      return;
    }
    const tile = getTileDefinitionAt(project, state, state.floorId, x, y);
    if (!tile || tile.id !== enemyId) return;
    if (getTileDefinitionAt(project, state, state.floorId, targetX, targetY) != null) return;
    removeTileAt(state, state.floorId, x, y);
    replaceTileAt(state, state.floorId, targetX, targetY, tile.number);
    const stats = ensureHazardStats(state);
    stats.repulseMoves = Number(stats.repulseMoves || 0) + 1;
    state.notes.push(`Repulse moved ${enemyId}@${state.floorId}:${x},${y} ${direction} -> ${targetX},${targetY}`);
  });
}

function applyLandingHazards(project, state, options, hazardCache) {
  const hazards = getHazardsForState(project, state, options, hazardCache);
  const loc = coordinateKey(state.hero.loc.x, state.hero.loc.y);
  const damage = Number(hazards.damage[loc] || 0);
  if (damage > 0) {
    if (!state.hero.statistics) state.hero.statistics = {};
    state.hero.statistics.extraDamage = Number(state.hero.statistics.extraDamage || 0) + damage;
    state.hero.hp = Number(state.hero.hp || 0) - damage;
    recordHazardDamage(state, hazards, loc, damage);
    if (state.hero.hp <= 0) return false;
  }

  const ambush = hazards.ambush[loc] || [];
  for (const [x, y, enemyId] of ambush) {
    const stats = ensureHazardStats(state);
    stats.ambushBattles = Number(stats.ambushBattles || 0) + 1;
    options.battleResolver.applyBattleAt({
      project,
      state,
      floorId: state.floorId,
      x,
      y,
      enemyId,
      executeActionList: options.executeActionList,
      choiceResolver: options.choiceResolver,
    });
    if (state.floorId == null || state.hero.hp <= 0) return false;
  }

  applyRepulseMoves(project, state, hazards.repulse[loc] || []);
  runAutoEvents(project, state, { choiceResolver: options.choiceResolver });
  return state.hero.hp > 0;
}

function stepOntoTile(project, state, direction, options, hazardCache) {
  const config = options || {};
  const delta = DIRECTION_DELTAS[direction];
  const nextX = state.hero.loc.x + delta.x;
  const nextY = state.hero.loc.y + delta.y;
  const predicate = config.predicate || isStepPassableTile;
  if (!predicate(project, state, state.floorId, nextX, nextY)) return null;

  const nextState = cloneState(state);
  nextState.hero.loc.x = nextX;
  nextState.hero.loc.y = nextY;
  nextState.hero.loc.direction = direction;
  nextState.hero.steps = Number(nextState.hero.steps || 0) + 1;

  if (!applyPoison(project, nextState)) return null;
  if (typeof config.beforeHazards === "function") {
    const shouldContinue = config.beforeHazards(nextState);
    if (shouldContinue === false || nextState.hero.hp <= 0) return null;
  }
  if (!applyLandingHazards(project, nextState, options, hazardCache)) return null;
  if (typeof config.afterHazards === "function") {
    const shouldContinue = config.afterHazards(nextState);
    if (shouldContinue === false || nextState.hero.hp <= 0) return null;
  }
  if (typeof config.stabilizeState === "function") {
    const stabilizedState = config.stabilizeState(nextState);
    if (!stabilizedState || stabilizedState.floorId == null || stabilizedState.hero.hp <= 0) return null;
    return stabilizedState;
  }
  return nextState;
}

function simulateTransitStep(project, state, direction, options, hazardCache) {
  return stepOntoTile(
    project,
    state,
    direction,
    {
      ...options,
      predicate: isTransitTile,
    },
    hazardCache
  );
}

const WALK_REACHABILITY_MODES = new Set(["safe-fast", "legacy-exact"]);

function normalizeWalkReachabilityMode(value) {
  const mode = String(value || "safe-fast").trim();
  if (WALK_REACHABILITY_MODES.has(mode)) return mode;
  throw new Error(
    `Invalid walk reachability mode: ${mode}. Expected safe-fast or legacy-exact.`,
  );
}

function hasLiveAutoEvents(floor) {
  return Object.values((floor && floor.autoEvent) || {}).some((entries) =>
    Object.values(entries || {}).some(Boolean),
  );
}

function hasMovementHazards(hazards) {
  const value = hazards || {};
  return ["damage", "repulse", "ambush", "betweenAttackLocs"].some(
    (field) => Object.keys(value[field] || {}).length > 0,
  );
}

function classifySafeStaticWalk(project, state, options) {
  const config = options || {};
  const startedAt = process.hrtime.bigint();
  const reject = (reason, extra) => ({
    eligible: false,
    reason,
    safetyProbeMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
    ...(extra || {}),
  });

  if (normalizeWalkReachabilityMode(config.walkReachabilityMode) === "legacy-exact") {
    return reject("legacy-exact-requested");
  }
  if (typeof config.beforeHazards === "function" || typeof config.afterHazards === "function") {
    return reject("custom-step-hooks");
  }
  if (state && state.flags && state.flags.poison) return reject("poison-active");
  if (hasDirectionalStateSensitivity(state)) return reject("direction-sensitive-inventory");

  const floor = project.floorsById[state.floorId];
  if (!floor) return reject("unknown-floor");
  if (hasLiveAutoEvents(floor)) return reject("live-auto-events");

  const hazardStartedAt = process.hrtime.bigint();
  const hazards = buildMovementHazards(project, state, {
    floorId: state.floorId,
    battleResolver: config.battleResolver,
    enableFastHazardBlockIndex: config.enableFastHazardBlockIndex,
  });
  const hazardScanMs = Number(process.hrtime.bigint() - hazardStartedAt) / 1e6;
  if (hasMovementHazards(hazards)) {
    return reject("movement-hazards", { hazardScanMs });
  }

  let stabilityProbeClones = 0;
  if (typeof config.stabilizeState === "function") {
    try {
      const probe = cloneState(state);
      stabilityProbeClones += 1;
      const stabilized = config.stabilizeState(probe);
      if (!stabilized || buildStateKey(stabilized) !== buildStateKey(state)) {
        return reject("state-not-stable", { hazardScanMs, stabilityProbeClones });
      }
    } catch (error) {
      return reject("stability-probe-error", { hazardScanMs, stabilityProbeClones });
    }
  }

  return {
    eligible: true,
    reason: "safe-static-walk",
    hazards,
    hazardScanMs,
    safetyProbeMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
    stabilityProbeClones,
  };
}

function safeTopologyProjection(state) {
  const loc = state && state.hero && state.hero.loc || {};
  const floorId = state && state.floorId || null;
  const floorState = floorId && state.floorStates && state.floorStates[floorId];
  return {
    floorId,
    start: { x: Number(loc.x), y: Number(loc.y) },
    currentFloorMutations: floorId && floorState
      ? listFloorMutationSummary({ [floorId]: floorState })
      : [],
  };
}

function safeTopologyCacheKey(state) {
  return JSON.stringify(safeTopologyProjection(state));
}

function buildExactWalkReachability(project, state, options, eligibility) {
  const config = options || {};
  const initialState = cloneState(state);
  const initialKey = buildDominanceKey(initialState);
  const hazardCache = new Map();
  const queue = [
    {
      key: initialKey,
      x: initialState.hero.loc.x,
      y: initialState.hero.loc.y,
      distance: 0,
      path: [],
      state: initialState,
    },
  ];
  const visited = {
    [initialKey]: queue[0],
  };
  const bestHpByKey = {
    [initialKey]: Number(initialState.hero.hp || 0),
  };
  const diagnostics = {
    mode: "legacy-exact",
    eligibilityReason: eligibility && eligibility.reason || "legacy-exact-requested",
    nodesExpanded: 0,
    transitionAttempts: 0,
    stateClones: 1 + Number(eligibility && eligibility.stabilityProbeClones || 0),
    dominanceKeyBuilds: 1,
    hazardScanMs: Number(eligibility && eligibility.hazardScanMs || 0),
    safetyProbeMs: Number(eligibility && eligibility.safetyProbeMs || 0),
  };

  while (queue.length > 0) {
    const node = queue.shift();
    if (visited[node.key] !== node) continue;
    diagnostics.nodesExpanded += 1;

    DIRECTIONS.forEach((direction) => {
      diagnostics.transitionAttempts += 1;
      const nextState = simulateTransitStep(project, node.state, direction, config, hazardCache);
      if (!nextState) return;
      diagnostics.stateClones += 1;
      if (nextState.floorId !== state.floorId) return;

      const key = buildDominanceKey(nextState);
      diagnostics.dominanceKeyBuilds += 1;
      const nextHp = Number(nextState.hero.hp || 0);
      if (bestHpByKey[key] != null && bestHpByKey[key] >= nextHp) return;
      bestHpByKey[key] = nextHp;

      visited[key] = {
        key,
        x: nextState.hero.loc.x,
        y: nextState.hero.loc.y,
        distance: node.distance + 1,
        path: node.path.concat(direction),
        state: nextState,
      };
      queue.push(visited[key]);
    });
  }

  return {
    start: { x: state.hero.loc.x, y: state.hero.loc.y },
    visited,
    diagnostics,
  };
}

function buildSafeWalkSkeleton(project, state) {
  const root = {
    x: state.hero.loc.x,
    y: state.hero.loc.y,
    distance: 0,
    path: [],
    direction: null,
  };
  const queue = [root];
  let cursor = 0;
  const seenCoordinates = new Set([coordinateKey(root.x, root.y)]);
  let nodesExpanded = 0;
  let transitionAttempts = 0;

  while (cursor < queue.length) {
    const node = queue[cursor];
    cursor += 1;
    nodesExpanded += 1;

    DIRECTIONS.forEach((direction) => {
      transitionAttempts += 1;
      const delta = DIRECTION_DELTAS[direction];
      const nextX = node.x + delta.x;
      const nextY = node.y + delta.y;
      const coordinate = coordinateKey(nextX, nextY);
      if (seenCoordinates.has(coordinate)) return;
      if (!isTransitTile(project, state, state.floorId, nextX, nextY)) return;
      seenCoordinates.add(coordinate);

      const distance = node.distance + 1;
      const nextNode = {
        x: nextX,
        y: nextY,
        distance,
        path: node.path.concat(direction),
        direction,
      };
      queue.push(nextNode);
    });
  }

  return {
    start: { x: state.hero.loc.x, y: state.hero.loc.y },
    nodes: queue,
    diagnostics: { nodesExpanded, transitionAttempts },
  };
}

function rebaseSafeWalkSkeleton(state, skeleton, eligibility, cacheDiagnostics, options) {
  const config = options || {};
  if (config.topologyFirstMaterialization === true) {
    return buildTopologyFirstWalkReachability(state, skeleton, eligibility, cacheDiagnostics, config);
  }
  const initialState = cloneState(state);
  const visited = {};
  const nodes = Array.isArray(skeleton && skeleton.nodes) ? skeleton.nodes : [];
  nodes.forEach((skeletonNode, index) => {
    const nextState = index === 0 ? initialState : cloneState(initialState);
    if (index > 0) {
      nextState.hero.loc.x = skeletonNode.x;
      nextState.hero.loc.y = skeletonNode.y;
      nextState.hero.loc.direction = skeletonNode.direction;
      nextState.hero.steps = Number(initialState.hero.steps || 0) + skeletonNode.distance;
    }
    const key = buildDominanceKey(nextState);
    visited[key] = {
      key,
      x: skeletonNode.x,
      y: skeletonNode.y,
      distance: skeletonNode.distance,
      path: skeletonNode.path.slice(),
      state: nextState,
    };
  });
  const cache = cacheDiagnostics || {};
  const built = cache.hit !== true;
  return {
    start: { ...skeleton.start },
    visited,
    diagnostics: {
      mode: "safe-fast",
      eligibilityReason: eligibility.reason,
      nodesExpanded: built ? Number(skeleton.diagnostics.nodesExpanded || 0) : 0,
      transitionAttempts: built ? Number(skeleton.diagnostics.transitionAttempts || 0) : 0,
      stateClones: nodes.length + Number(eligibility.stabilityProbeClones || 0),
      dominanceKeyBuilds: nodes.length,
      hazardScanMs: Number(eligibility.hazardScanMs || 0),
      safetyProbeMs: Number(eligibility.safetyProbeMs || 0),
      skeletonCacheEnabled: cache.enabled === true,
      skeletonCacheHit: cache.hit === true,
      skeletonBuilt: built,
      skeletonNodeCount: nodes.length,
      skeletonBuildMs: Number(cache.buildMs || 0),
    },
  };
}

function buildTopologyFirstWalkReachability(state, skeleton, eligibility, cacheDiagnostics, options) {
  const config = options || {};
  const cache = cacheDiagnostics || {};
  const built = cache.hit !== true;
  const nodes = Array.isArray(skeleton && skeleton.nodes) ? skeleton.nodes : [];
  const visited = {};
  const diagnostics = {
    mode: "safe-fast",
    eligibilityReason: eligibility.reason,
    nodesExpanded: built ? Number(skeleton.diagnostics.nodesExpanded || 0) : 0,
    transitionAttempts: built ? Number(skeleton.diagnostics.transitionAttempts || 0) : 0,
    stateClones: Number(eligibility.stabilityProbeClones || 0),
    dominanceKeyBuilds: 0,
    hazardScanMs: Number(eligibility.hazardScanMs || 0),
    safetyProbeMs: Number(eligibility.safetyProbeMs || 0),
    skeletonCacheEnabled: cache.enabled === true,
    skeletonCacheHit: cache.hit === true,
    skeletonBuilt: built,
    skeletonNodeCount: nodes.length,
    skeletonBuildMs: Number(cache.buildMs || 0),
    topologyFirstMaterialization: true,
    materializedNodeCount: 0,
  };

  const notify = (event) => {
    if (typeof config.onTopologyNodeCost === "function") config.onTopologyNodeCost(event);
  };

  nodes.forEach((skeletonNode, index) => {
    let materializedState = null;
    let dominanceKey = null;
    let accessObserver = null;
    const node = {
      x: skeletonNode.x,
      y: skeletonNode.y,
      distance: skeletonNode.distance,
      path: skeletonNode.path.slice(),
    };
    const materializeState = () => {
      if (!materializedState) {
        materializedState = cloneState(state);
        materializedState.hero.loc.x = skeletonNode.x;
        materializedState.hero.loc.y = skeletonNode.y;
        if (index > 0) materializedState.hero.loc.direction = skeletonNode.direction;
        materializedState.hero.steps = Number(state.hero.steps || 0) + skeletonNode.distance;
        diagnostics.stateClones += 1;
        diagnostics.materializedNodeCount += 1;
        notify({ type: "state-clone", node });
      }
      return materializedState;
    };
    const materializeKey = () => {
      if (dominanceKey == null) {
        dominanceKey = buildDominanceKey(materializeState());
        diagnostics.dominanceKeyBuilds += 1;
        notify({ type: "dominance-key", node });
      }
      return dominanceKey;
    };
    Object.defineProperties(node, {
      state: {
        configurable: true,
        enumerable: true,
        get: () => {
          const value = materializeState();
          if (accessObserver) accessObserver("state", value);
          return value;
        },
      },
      key: {
        configurable: true,
        enumerable: true,
        get: () => {
          const value = materializeKey();
          if (accessObserver) accessObserver("key", value);
          return value;
        },
      },
      __topologyFirstMaterialization: {
        enumerable: false,
        value: {
          materializeState,
          materializeKey,
          peekState: () => materializedState,
          peekKey: () => dominanceKey,
          setAccessObserver: (observer) => { accessObserver = observer; },
        },
      },
    });
    visited[coordinateKey(skeletonNode.x, skeletonNode.y)] = node;
  });

  const reachability = {
    start: { ...skeleton.start },
    visited,
    diagnostics,
  };
  Object.defineProperties(reachability, {
    getLookupState: {
      enumerable: false,
      value: () => state,
    },
    materializeNodeState: {
      enumerable: false,
      value: (node) => node && node.state,
    },
  });
  return reachability;
}

function buildStaticWalkReachability(project, state, eligibility) {
  const startedAt = process.hrtime.bigint();
  const skeleton = buildSafeWalkSkeleton(project, state);
  return rebaseSafeWalkSkeleton(state, skeleton, eligibility, {
    enabled: false,
    hit: false,
    buildMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
  });
}

function buildWalkReachability(project, state, options) {
  const config = options || {};
  const eligibility = classifySafeStaticWalk(project, state, config);
  if (eligibility.eligible) {
    const cache = config.safeWalkSkeletonCache || null;
    const cacheKey = safeTopologyCacheKey(state);
    let skeleton = cache && typeof cache.get === "function" ? cache.get(cacheKey) : null;
    const cacheHit = Boolean(skeleton);
    let buildMs = 0;
    if (!skeleton) {
      const startedAt = process.hrtime.bigint();
      skeleton = buildSafeWalkSkeleton(project, state);
      buildMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      if (cache && typeof cache.set === "function") cache.set(cacheKey, skeleton, buildMs);
    }
    return rebaseSafeWalkSkeleton(state, skeleton, eligibility, {
      enabled: Boolean(cache),
      hit: cacheHit,
      buildMs,
    }, config);
  }
  return buildExactWalkReachability(project, state, config, eligibility);
}

module.exports = {
  buildWalkReachability,
  normalizeWalkReachabilityMode,
  isEndpointTile,
  isStepPassableTile,
  isTransitTile,
  safeTopologyProjection,
  stepOntoTile,
  __testing: {
    buildExactWalkReachability,
    buildSafeWalkSkeleton,
    buildTopologyFirstWalkReachability,
    buildStaticWalkReachability,
    classifySafeStaticWalk,
    hasLiveAutoEvents,
    hasMovementHazards,
    rebaseSafeWalkSkeleton,
    safeTopologyCacheKey,
    safeTopologyProjection,
  },
};
