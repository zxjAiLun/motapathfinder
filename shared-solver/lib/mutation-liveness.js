"use strict";

/**
 * PR-5.28a — Mutation Liveness Predicate (Fail-Closed)
 *
 * Evaluates whether a mutation in floorStates (removed or replaced tile)
 * can be provably dead in all future continuations from a given state.
 *
 * Core Principle:
 *   provably dead -> may drop
 *   cannot prove dead -> keep (fail-closed)
 *
 * Rules:
 * 1. Floor-Level Liveness:
 *    A floor F is unreachable if no sequence of valid transitions (changeFloor
 *    within allowedFloors, or eligible floorFly) can reach F from state.floorId.
 *    Any mutation on an unreachable floor is provably dead.
 *
 * 2. Topological Barrier Isolation:
 *    On a reachable floor F, compute the over-approximate reachability closure from
 *    all physical entry points (stair landing locations and current hero location).
 *    Treat permanent walls (unbreakable walls) and protected doors (forbidden by zero-spend)
 *    as impassable barriers.
 *    Any coordinate not reachable in this over-approximation can never be visited or observed.
 *    Any mutation at such an isolated coordinate is provably dead.
 *
 * 3. Otherwise:
 *    The mutation remains LIVE (fail-closed).
 */

const { resolveRelativeFloor, resolveChangeFloorTarget } = require("./floor-transitions");
const { buildDpStateKey } = require("./dp-search");

function computeReachableFloors(project, currentFloorId, allowedFloors) {
  const allowed = allowedFloors ? new Set(allowedFloors) : new Set(project.floorOrder || Object.keys(project.floorsById));
  const reachable = new Set([currentFloorId]);
  const queue = [currentFloorId];

  while (queue.length > 0) {
    const fid = queue.shift();
    const floor = project.floorsById[fid];
    if (!floor) continue;

    for (const [, changeData] of Object.entries(floor.changeFloor || {})) {
      if (!changeData || !changeData.floorId) continue;
      try {
        const targetId = resolveRelativeFloor(project, fid, changeData.floorId);
        if (allowed.has(targetId) && !reachable.has(targetId)) {
          reachable.add(targetId);
          queue.push(targetId);
        }
      } catch (e) {}
    }
  }
  return reachable;
}

function getFloorEntryPoints(project, floorId, currentFloorId, currentHeroLoc) {
  const points = [];
  if (floorId === currentFloorId && currentHeroLoc) {
    points.push({ x: currentHeroLoc.x, y: currentHeroLoc.y });
  }

  for (const [fid, floor] of Object.entries(project.floorsById || {})) {
    if (fid === floorId) continue;
    for (const [, changeData] of Object.entries(floor.changeFloor || {})) {
      if (!changeData || !changeData.floorId) continue;
      try {
        const targetFloorId = resolveRelativeFloor(project, fid, changeData.floorId);
        if (targetFloorId === floorId) {
          const targetFloor = project.floorsById[targetFloorId];
          if (Array.isArray(changeData.loc) && changeData.loc.length === 2) {
            points.push({ x: Number(changeData.loc[0]), y: Number(changeData.loc[1]) });
          } else if (changeData.stair && targetFloor) {
            for (let y = 0; y < targetFloor.height; y += 1) {
              for (let x = 0; x < targetFloor.width; x += 1) {
                const num = targetFloor.map[y][x];
                const t = project.mapTilesByNumber[num];
                if (t && t.id === changeData.stair) {
                  points.push({ x, y });
                }
              }
            }
          }
        }
      } catch (e) {}
    }
  }
  return points;
}

function computeTopologicalReachableTiles(project, floorId, entryPoints, config) {
  const floor = project.floorsById[floorId];
  if (!floor) return new Set();

  const reachable = new Set();
  const queue = [];

  for (const pt of entryPoints) {
    const key = `${pt.x},${pt.y}`;
    if (!reachable.has(key)) {
      reachable.add(key);
      queue.push(pt);
    }
  }

  const dirs = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];

  const protectedKeys = new Set(config.protectedItems || []);

  while (queue.length > 0) {
    const { x, y } = queue.shift();
    for (const d of dirs) {
      const nx = x + d.x;
      const ny = y + d.y;
      if (nx < 0 || ny < 0 || nx >= floor.width || ny >= floor.height) continue;
      const nKey = `${nx},${ny}`;
      if (reachable.has(nKey)) continue;

      const tileNum = floor.map[ny][nx];
      const tile = project.mapTilesByNumber[tileNum];

      if (tile) {
        // Permanent unbreakable walls
        if (tile.id === "blueWall" || tile.id === "yellowWall" || tile.id === "whiteWall") {
          if (!tile.canBreak && !tile.doorInfo) continue;
        }
        // Protected doors (forbidden by zero-spend policy)
        if (tile.doorInfo && tile.doorInfo.keys) {
          const requiresProtected = Object.keys(tile.doorInfo.keys).some((k) => protectedKeys.has(k));
          if (requiresProtected) continue;
        }
        // Permanent obstacle with no pass, no break, no trigger, not door/enemy/item
        if (tile.canPass === false && !tile.doorInfo && !tile.canBreak &&
            tile.cls !== "enemys" && tile.cls !== "enemy48" && tile.cls !== "items" && !tile.trigger) {
          continue;
        }
      }

      reachable.add(nKey);
      queue.push({ x: nx, y: ny });
    }
  }

  return reachable;
}

function buildLivenessContext(project, state, config) {
  const allowedFloors = config.allowedFloors || null;
  const reachableFloors = computeReachableFloors(project, state.floorId, allowedFloors);

  const reachableTilesByFloor = new Map();
  for (const fid of reachableFloors) {
    const entryPoints = getFloorEntryPoints(project, fid, state.floorId, state.hero ? state.hero.loc : null);
    const reachableTiles = computeTopologicalReachableTiles(project, fid, entryPoints, config);
    reachableTilesByFloor.set(fid, reachableTiles);
  }

  return { reachableFloors, reachableTilesByFloor };
}

function classifyMutationLiveness(project, floorId, coord, state, config, context) {
  const ctx = context || buildLivenessContext(project, state, config);
  if (!ctx.reachableFloors.has(floorId)) {
    return { isLive: false, reason: "floor_unreachable_in_future" };
  }

  const reachableTiles = ctx.reachableTilesByFloor.get(floorId);
  if (reachableTiles && !reachableTiles.has(coord)) {
    return { isLive: false, reason: "topologically_isolated_from_all_entry_points" };
  }

  return { isLive: true, reason: "within_future_accessible_boundary" };
}

function filterLiveFloorStates(project, state, config, context) {
  const ctx = context || buildLivenessContext(project, state, config);
  const filtered = {};

  let deadCount = 0;
  let liveCount = 0;
  const deadBreakdown = {};

  for (const [fid, fs] of Object.entries(state.floorStates || {})) {
    const liveRemoved = {};
    const liveReplaced = {};

    for (const [coord, val] of Object.entries(fs.removed || {})) {
      const { isLive, reason } = classifyMutationLiveness(project, fid, coord, state, config, ctx);
      if (isLive) {
        liveRemoved[coord] = val;
        liveCount += 1;
      } else {
        deadCount += 1;
        deadBreakdown[reason] = (deadBreakdown[reason] || 0) + 1;
      }
    }

    for (const [coord, val] of Object.entries(fs.replaced || {})) {
      const { isLive, reason } = classifyMutationLiveness(project, fid, coord, state, config, ctx);
      if (isLive) {
        liveReplaced[coord] = val;
        liveCount += 1;
      } else {
        deadCount += 1;
        deadBreakdown[reason] = (deadBreakdown[reason] || 0) + 1;
      }
    }

    if (Object.keys(liveRemoved).length > 0 || Object.keys(liveReplaced).length > 0) {
      filtered[fid] = { removed: liveRemoved, replaced: liveReplaced };
    }
  }

  return {
    filteredFloorStates: filtered,
    stats: { deadCount, liveCount, deadBreakdown },
  };
}

function computeLivenessProjectedKey(simulator, state, config, context) {
  const { filteredFloorStates } = filterLiveFloorStates(simulator.project, state, config, context);
  const shadowState = {
    ...state,
    floorStates: filteredFloorStates,
  };
  return buildDpStateKey(simulator, shadowState, config);
}

module.exports = {
  computeReachableFloors,
  getFloorEntryPoints,
  computeTopologicalReachableTiles,
  buildLivenessContext,
  classifyMutationLiveness,
  filterLiveFloorStates,
  computeLivenessProjectedKey,
};
