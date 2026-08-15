"use strict";

const crypto = require("node:crypto");

const { cloneState } = require("./state");
const { isDoorTile, isEnemyTile, isPassableTile } = require("./reachability");
const { tileDefinitionAt } = require("./strategic-option-map");

const ATTRIBUTION_SCHEMA = "motapathfinder.strategic-dependency-attribution.v1";

const ADJACENCY = [[0, 0], [0, -1], [1, 0], [0, 1], [-1, 0]];

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function actionFloor(action) {
  return action.floorId || (action.travelState && action.travelState.floorId) || null;
}

function actionX(action) {
  return action.x != null ? action.x : ((action.target || {}).x != null ? action.target.x : null);
}

function actionY(action) {
  return action.y != null ? action.y : ((action.target || {}).y != null ? action.target.y : null);
}

function actionMatchesAcquireTarget(action, target) {
  if (!action || !target || target.type !== "acquire-option") return false;
  const sameLocation = actionFloor(action) === target.floorId &&
    Number(actionX(action)) === Number(target.x) &&
    Number(actionY(action)) === Number(target.y);
  if (!sameLocation) return false;
  if (target.itemId) {
    return action.itemId === target.itemId ||
      (action.kind === "pickup" || action.kind === "interactPickup");
  }
  if (target.enemyId) {
    return action.enemyId === target.enemyId ||
      ((action.target || {}).enemyId) === target.enemyId ||
      action.kind === "battle";
  }
  return true;
}

function actionMatchesTarget(action, target) {
  if (!action || !target) return false;
  if (target.type === "equip-item") {
    return action.kind === "equip" && (action.equipId || action.itemId) === target.equipId;
  }
  if (target.type === "acquire-option") return actionMatchesAcquireTarget(action, target);
  if (target.type === "synthetic") return false;
  return false;
}

function targetFloorId(target) {
  return (target && (target.floorId || (target.acquisition && target.acquisition.floorId))) || null;
}

function floorDistance(project, fromFloorId, toFloorId) {
  if (fromFloorId == null || toFloorId == null) return null;
  if (fromFloorId === toFloorId) return 0;
  const order = project && Array.isArray(project.floorOrder) ? project.floorOrder : [];
  const from = order.indexOf(fromFloorId);
  const to = order.indexOf(toFloorId);
  if (from < 0 || to < 0) return null;
  return Math.abs(to - from);
}

function manhattanDistance(state, target) {
  const hero = (state || {}).hero || {};
  const loc = hero.loc || {};
  if (loc.x == null || loc.y == null || target.x == null || target.y == null) return null;
  return Math.abs(Number(loc.x) - Number(target.x)) + Math.abs(Number(loc.y) - Number(target.y));
}

function buildTargetMetrics(options) {
  const { project, state, actions, target } = options;
  const targetFloor = targetFloorId(target);
  const sameFloor = targetFloor != null && state.floorId === targetFloor;
  const distance = sameFloor ? manhattanDistance(state, target) : null;
  const matchingActions = (actions || []).filter((action) => actionMatchesTarget(action, target));
  return {
    sameFloor,
    floorDistance: floorDistance(project, state.floorId, targetFloor),
    manhattanDistance: distance,
    targetActionAvailable: matchingActions.length > 0,
    targetAdjacent: sameFloor && distance === 1,
    matchingActionKinds: matchingActions.slice(0, 4).map((action) => action.kind || "unknown"),
  };
}

function compareMetrics(left, right) {
  const leftTargetAction = left.targetActionAvailable ? 1 : 0;
  const rightTargetAction = right.targetActionAvailable ? 1 : 0;
  if (leftTargetAction !== rightTargetAction) return rightTargetAction - leftTargetAction;
  const leftSameFloor = left.sameFloor ? 1 : 0;
  const rightSameFloor = right.sameFloor ? 1 : 0;
  if (leftSameFloor !== rightSameFloor) return rightSameFloor - leftSameFloor;
  if (left.floorDistance != null && right.floorDistance != null && left.floorDistance !== right.floorDistance) {
    return left.floorDistance - right.floorDistance;
  }
  if (left.floorDistance == null && right.floorDistance != null) return 1;
  if (left.floorDistance != null && right.floorDistance == null) return -1;
  if (left.manhattanDistance != null && right.manhattanDistance != null && left.manhattanDistance !== right.manhattanDistance) {
    return left.manhattanDistance - right.manhattanDistance;
  }
  if (left.primitiveDepth !== right.primitiveDepth) return left.primitiveDepth - right.primitiveDepth;
  return (left.expansions || 0) - (right.expansions || 0);
}

function compactState(state) {
  if (!state) return null;
  const hero = state.hero || {};
  return {
    floorId: state.floorId || null,
    loc: hero.loc ? { x: hero.loc.x, y: hero.loc.y, direction: hero.loc.direction } : null,
    hero: {
      hp: number(hero.hp, 0),
      atk: number(hero.atk, 0),
      def: number(hero.def, 0),
      mdef: number(hero.mdef, 0),
      lv: number(hero.lv, 0),
      exp: number(hero.exp, 0),
    },
  };
}

/**
 * Observation-only sampler. It keeps the top-K states that are closest to the
 * dependency target according to a diagnostic distance vector. It never
 * affects search order, budget, predicate, or retention.
 */
function createDependencyAccessObserver(options) {
  const config = options || {};
  const project = config.project;
  const target = config.target;
  const maxApproaches = Math.max(1, number(config.maxApproaches, 3));
  let best = [];

  function insert(entry) {
    best = best.concat([entry]).sort((left, right) => compareMetrics(left.metrics, right.metrics)).slice(0, maxApproaches);
  }

  return {
    observe(entry) {
      if (!entry || !target) return;
      const metrics = buildTargetMetrics({
        project,
        state: entry.state,
        actions: entry.actions || [],
        target,
      });
      const approach = {
        state: entry.state,
        stateKey: entry.key || null,
        metrics: {
          ...metrics,
          primitiveDepth: (entry.chain || []).length,
          expansions: number(entry.expansions, 0),
        },
      };
      insert(approach);
    },
    report() {
      return best.map((approach) => ({
        state: compactState(approach.state),
        stateKey: approach.stateKey,
        metrics: approach.metrics,
      }));
    },
    _approaches() {
      return best.slice();
    },
  };
}

function battleBoundary(options) {
  const { project, simulator, state, floorId, x, y, enemyId } = options;
  const resolver = simulator && simulator.battleResolver;
  if (!resolver || typeof resolver.evaluateBattle !== "function") return null;
  const probeState = cloneState(state);
  if (probeState.hero && probeState.hero.loc) {
    probeState.hero.loc = { ...(probeState.hero.loc || {}), x, y };
  }
  let evaluation;
  try {
    evaluation = resolver.evaluateBattle(probeState, floorId, x, y, enemyId);
  } catch (_error) {
    return null;
  }
  const damage = evaluation && evaluation.damageInfo && evaluation.damageInfo.damage;
  const hp = number((state.hero || {}).hp, 0);
  const blocked = !evaluation || !evaluation.supported || damage == null || Number(damage) >= hp;
  if (!blocked) return null;
  return {
    kind: "battle-unsurvivable",
    target: { floorId, x, y, enemyId },
    evidence: {
      supported: Boolean(evaluation && evaluation.supported),
      damage: damage == null ? null : number(damage, null),
      heroHp: hp,
      reason: evaluation && evaluation.reason ? evaluation.reason : null,
    },
    proofStrength: "observed",
  };
}

function hasDoorKey(state, keyId, amount) {
  return number((state.inventory || {})[keyId], 0) >= number(amount, 1);
}

function doorBoundary(options) {
  const { project, simulator, state, floorId, x, y, tile } = options;
  const actionAvailable = (simulator.enumeratePrimitiveActions(state).actions || [])
    .some((action) => action.kind === "openDoor" &&
      actionFloor(action) === floorId &&
      Number(actionX(action)) === Number(x) &&
      Number(actionY(action)) === Number(y));
  if (actionAvailable) return null;
  const keys = (tile && tile.doorInfo && tile.doorInfo.keys) || {};
  const missingKeys = Object.entries(keys)
    .filter(([keyId, amount]) => !hasDoorKey(state, keyId, amount))
    .map(([keyId, amount]) => ({ keyId, required: number(amount, 1) }));
  return {
    kind: missingKeys.length > 0 ? "missing-key" : "closed-door",
    target: { floorId, x, y, tileId: tile && tile.id },
    evidence: {
      missingKeys,
      tileId: tile && tile.id,
      openDoorActionAvailable: false,
    },
    proofStrength: "observed",
  };
}

function classifyFrontierBoundary(options) {
  const {
    project,
    simulator,
    state,
    target,
    actions,
    stoppedReason,
  } = options;
  let scan;
  try {
    scan = simulator.getWalkReachability(state);
  } catch (_error) {
    scan = null;
  }
  const candidates = [];
  const visited = Object.values((scan && scan.visited) || {});
  if (visited.length === 0 && target && targetFloorId(target) !== state.floorId) {
    candidates.push({
      kind: "topology/changeFloor",
      target: { floorId: targetFloorId(target) },
      evidence: {
        currentFloor: state.floorId,
        targetFloor: targetFloorId(target),
        changeFloorActionAvailable: (actions || []).some((action) => action.kind === "changeFloor"),
      },
      proofStrength: "observed",
    });
  }
  const scanned = new Set();
  visited.forEach((node) => {
    ADJACENCY.forEach(([deltaX, deltaY]) => {
      const x = node.x + deltaX;
      const y = node.y + deltaY;
      const key = `${x},${y}`;
      if (scanned.has(key)) return;
      scanned.add(key);
      const floor = project.floorsById && project.floorsById[state.floorId];
      if (floor && (x < 0 || y < 0 || x >= floor.width || y >= floor.height)) return;
      if (floor && floor.changeFloor && floor.changeFloor[key]) {
        const hasChangeFloorAction = (actions || []).some((action) =>
          action.kind === "changeFloor" &&
          actionFloor(action) === state.floorId &&
          Number(actionX(action)) === x &&
          Number(actionY(action)) === y);
        if (!hasChangeFloorAction && target && targetFloorId(target) !== state.floorId) {
          candidates.push({
            kind: "topology/changeFloor",
            target: { floorId: state.floorId, x, y },
            evidence: {
              changeFloorActionAvailable: hasChangeFloorAction,
              currentFloor: state.floorId,
              targetFloor: targetFloorId(target),
            },
            proofStrength: "observed",
          });
        }
      }
      const tile = tileDefinitionAt(project, state, state.floorId, x, y);
      if (!tile) return;
      if (isEnemyTile(tile)) {
        const boundary = battleBoundary({
          project,
          simulator,
          state,
          floorId: state.floorId,
          x,
          y,
          enemyId: tile.id,
        });
        if (boundary) candidates.push(boundary);
      } else if (isDoorTile(tile)) {
        const boundary = doorBoundary({
          project,
          simulator,
          state,
          floorId: state.floorId,
          x,
          y,
          tile,
        });
        if (boundary) candidates.push(boundary);
      } else if (tile.trigger != null && tile.trigger !== "null" && tile.trigger !== "passNet") {
        candidates.push({
          kind: "event-condition",
          target: { floorId: state.floorId, x, y, tileId: tile.id },
          evidence: {
            trigger: tile.trigger,
            tileId: tile.id,
          },
          proofStrength: "observed",
        });
      }
    });
  });

  if (candidates.length === 0) {
    return {
      kind: stoppedReason === "budget-exhausted" ? "budget-incomplete" : "no-path-under-current-action-scope",
      target: target || null,
      evidence: {
        reason: stoppedReason === "budget-exhausted"
          ? "connector stopped before exhausting the legal frontier; no root-cause claim"
          : "no unresolved boundary observed in the current reachable component",
        scannedReachableAdjacency: scanned.size,
        visitedNodes: visited.length,
        currentFloor: state.floorId,
        targetFloor: target ? targetFloorId(target) : null,
      },
      proofStrength: stoppedReason === "budget-exhausted" ? "hypothesis" : "hypothesis",
    };
  }
  const hero = (state.hero || {}).loc || {};
  candidates.sort((left, right) => {
    const leftX = left.target && left.target.x != null ? left.target.x : Infinity;
    const rightX = right.target && right.target.x != null ? right.target.x : Infinity;
    const leftY = left.target && left.target.y != null ? left.target.y : Infinity;
    const rightY = right.target && right.target.y != null ? right.target.y : Infinity;
    const leftDistance = Math.abs(leftX - number(hero.x, 0)) + Math.abs(leftY - number(hero.y, 0));
    const rightDistance = Math.abs(rightX - number(hero.x, 0)) + Math.abs(rightY - number(hero.y, 0));
    return leftDistance - rightDistance || left.kind.localeCompare(right.kind);
  });
  if (stoppedReason === "budget-exhausted") {
    return {
      kind: "budget-incomplete",
      target: target || null,
      evidence: {
        reason: "connector stopped before exhausting the legal frontier; no root-cause claim",
        observedActions: (actions || []).length,
        nearestBoundaryCount: candidates.length,
      },
      nearbyBoundaries: candidates.slice(0, 3),
      proofStrength: "hypothesis",
    };
  }
  return {
    ...candidates[0],
    nearbyBoundaries: candidates.slice(0, 3),
  };
}

function topologicalCellKind(project, state, floorId, x, y, tile) {
  const key = `${x},${y}`;
  const floor = project.floorsById && project.floorsById[floorId];
  if (floor && floor.changeFloor && floor.changeFloor[key]) return "changeFloor";
  if (isEnemyTile(tile)) return "enemy";
  if (isDoorTile(tile)) return "door";
  if (tile && tile.trigger != null && tile.trigger !== "null" && tile.trigger !== "passNet") return "event";
  return null;
}

function buildTopologicalCells(project, state, floorId, target) {
  const floor = project.floorsById && project.floorsById[floorId];
  if (!floor) return { cells: new Map() };
  const cells = new Map();
  for (let y = 0; y < floor.height; y += 1) {
    for (let x = 0; x < floor.width; x += 1) {
      const key = `${x},${y}`;
      const tile = tileDefinitionAt(project, state, floorId, x, y);
      const kind = topologicalCellKind(project, state, floorId, x, y, tile);
      let passable = true;
      if (!kind && tile) passable = isPassableTile(project, state, floorId, x, y);
      if (!tile && !kind) passable = true;
      if (!passable) continue;
      const isTarget = target && target.floorId === floorId &&
        Number(target.x) === x && Number(target.y) === y;
      cells.set(key, {
        x,
        y,
        key,
        kind,
        tileId: tile ? tile.id : null,
        passable,
        isTarget: Boolean(isTarget),
        cost: kind && !isTarget ? 1 : 0,
      });
    }
  }
  return { floor, cells };
}

function runTopologicalAccessBfs(options) {
  const { cells, seeds, targetKey, blockedKey, costOverrideKey } = options;
  const target = cells.get(targetKey);
  if (!target) return { reached: false, distance: Infinity, path: [], blockers: [] };
  const dist = new Map();
  const prev = new Map();
  const queue = [];
  seeds.forEach((seedKey) => {
    if (!cells.has(seedKey)) return;
    dist.set(seedKey, 0);
    queue.push(seedKey);
  });
  let reached = false;
  while (queue.length > 0) {
    const currentKey = queue.shift();
    const current = cells.get(currentKey);
    if (currentKey === targetKey) {
      reached = true;
      break;
    }
    const currentDist = dist.get(currentKey);
    [[0, -1], [1, 0], [0, 1], [-1, 0]].forEach(([deltaX, deltaY]) => {
      const nextKey = `${current.x + deltaX},${current.y + deltaY}`;
      if (blockedKey && nextKey === blockedKey) return;
      const next = cells.get(nextKey);
      if (!next) return;
      const nextCost = costOverrideKey && nextKey === costOverrideKey ? 0 : next.cost;
      const nextDist = currentDist + nextCost;
      const known = dist.has(nextKey) ? dist.get(nextKey) : Infinity;
      if (nextDist >= known) return;
      dist.set(nextKey, nextDist);
      prev.set(nextKey, currentKey);
      if (nextCost === 0) queue.push(nextKey);
      else queue.unshift(nextKey);
    });
  }
  if (!reached || !dist.has(targetKey)) {
    return { reached: false, distance: Infinity, path: [], blockers: [] };
  }
  const path = [];
  let cursorKey = targetKey;
  while (cursorKey != null) {
    const cell = cells.get(cursorKey);
    if (!cell) break;
    path.push(cell);
    cursorKey = prev.get(cursorKey) || null;
  }
  path.reverse();
  return {
    reached: true,
    distance: dist.get(targetKey),
    path,
    blockers: path.filter((cell) => cell.kind && !cell.isTarget),
  };
}

/**
 * Read-only topological access-cut analysis. It does not mutate state, kill
 * monsters, open doors, or enter the solver frontier; it only asks whether a
 * specific boundary is structurally related to the dependency target in a
 * counterfactual grid observation.
 */
function analyzeBoundaryTargetRelevance(options) {
  const config = options || {};
  const { project, simulator, state, target, boundary } = config;
  const targetFloor = target ? targetFloorId(target) : null;
  const boundaryTarget = boundary && boundary.target;
  if (!target || targetFloor == null || boundaryTarget == null || targetFloor !== state.floorId) {
    return {
      floorScoped: false,
      minAccessBlockers: null,
      targetSideReachableIfRemoved: false,
      reducesTopologicalBlockerDistance: false,
      onMinimumBlockerPath: false,
      separatesCurrentComponentFromTarget: false,
      evidence: { reason: "target relevance is only computed on the current floor" },
    };
  }
  let scan;
  try {
    scan = simulator.getWalkReachability(state);
  } catch (_error) {
    scan = null;
  }
  const { cells } = buildTopologicalCells(project, state, state.floorId, target);
  const seedSet = new Set();
  Object.values((scan && scan.visited) || {}).forEach((node) => {
    if (node && node.x != null && node.y != null) seedSet.add(`${node.x},${node.y}`);
  });
  const seeds = Array.from(seedSet);
  const targetKey = `${target.x},${target.y}`;
  const boundaryKey = `${boundaryTarget.x},${boundaryTarget.y}`;
  const original = runTopologicalAccessBfs({ cells, seeds, targetKey });
  if (!original.reached) {
    return {
      floorScoped: true,
      minAccessBlockers: null,
      targetSideReachableIfRemoved: false,
      reducesTopologicalBlockerDistance: false,
      onMinimumBlockerPath: false,
      separatesCurrentComponentFromTarget: false,
      evidence: { reason: "no topological path from current reachable component to target" },
    };
  }
  const withoutBoundary = runTopologicalAccessBfs({
    cells,
    seeds,
    targetKey,
    costOverrideKey: boundaryKey,
  });
  const separated = runTopologicalAccessBfs({
    cells,
    seeds,
    targetKey,
    blockedKey: boundaryKey,
  });
  const minAccessBlockers = original.distance;
  const minWithoutBoundary = withoutBoundary.reached ? withoutBoundary.distance : Infinity;
  const onMinimumBlockerPath = original.blockers.some((cell) => cell.key === boundaryKey);
  return {
    floorScoped: true,
    minAccessBlockers,
    minAccessBlockersWithoutBoundary: minWithoutBoundary === Infinity ? null : minWithoutBoundary,
    blockerDistanceReduction: minWithoutBoundary === Infinity ? null : minAccessBlockers - minWithoutBoundary,
    targetSideReachableIfRemoved: original.distance > 0 && minWithoutBoundary === 0,
    reducesTopologicalBlockerDistance: minWithoutBoundary < minAccessBlockers,
    onMinimumBlockerPath,
    separatesCurrentComponentFromTarget: !separated.reached,
    minimumPathBlockers: original.blockers.slice(0, 6).map((cell) => ({
      kind: cell.kind,
      tileId: cell.tileId,
      floorId: state.floorId,
      x: cell.x,
      y: cell.y,
    })),
    evidence: {
      topologicalModel: "static-grid-walk-adjacency-counterfactual",
      counterfactualOnly: true,
      seeds: seeds.length,
      targetKey,
      boundaryKey,
    },
  };
}

function buildDependencyAccessAttribution(options) {
  const config = options || {};
  const {
    project,
    simulator,
    dependency,
    connectorResult,
    observer,
    attemptId,
    sourceNodeId,
    sourceExactStateFingerprint,
  } = config;
  if (!project || !simulator || !dependency || !connectorResult || !observer) {
    throw new Error("buildDependencyAccessAttribution requires project, simulator, dependency, connectorResult, and observer");
  }
  const approaches = observer._approaches();
  const bestApproaches = approaches.map((approach) => {
    let actions = [];
    try {
      actions = simulator.enumeratePrimitiveActions(approach.state).actions || [];
    } catch (_error) {
      actions = [];
    }
    const boundary = classifyFrontierBoundary({
      project,
      simulator,
      state: approach.state,
      target: dependency.target,
      actions,
      stoppedReason: connectorResult.stoppedReason,
    });
    const candidateBoundaries = [];
    if (boundary.kind !== "budget-incomplete" && boundary.target && boundary.target.x != null) {
      candidateBoundaries.push(boundary);
    }
    ((boundary && boundary.nearbyBoundaries) || []).forEach((candidate) => {
      if (candidate.kind !== "budget-incomplete" &&
          candidate.target && candidate.target.x != null && candidate.target.y != null) {
        candidateBoundaries.push(candidate);
      }
    });
    const analyzedCandidates = candidateBoundaries.map((candidate) => {
      let targetRelevance = null;
      try {
        targetRelevance = analyzeBoundaryTargetRelevance({
          project,
          simulator,
          state: approach.state,
          target: dependency.target,
          boundary: candidate,
        });
      } catch (_error) {
        targetRelevance = null;
      }
      return { candidate, targetRelevance };
    }).filter((entry) => entry.targetRelevance && entry.targetRelevance.floorScoped);
    const candidateRank = (entry) => {
      const tr = entry.targetRelevance;
      return (tr.separatesCurrentComponentFromTarget ? 4000 : 0) +
        (tr.targetSideReachableIfRemoved ? 3000 : 0) +
        (tr.onMinimumBlockerPath ? 2000 : 0) +
        (tr.reducesTopologicalBlockerDistance ? 1000 : 0) -
        (tr.minAccessBlockers == null ? 0 : tr.minAccessBlockers);
    };
    analyzedCandidates.sort((left, right) => candidateRank(right) - candidateRank(left));
    const targetRelevantBoundary = analyzedCandidates.length > 0
      ? {
          ...analyzedCandidates[0].candidate,
          targetRelevance: analyzedCandidates[0].targetRelevance,
        }
      : null;
    return {
      state: compactState(approach.state),
      stateFingerprint: approach.stateKey ? hash(approach.stateKey) : null,
      metrics: approach.metrics,
      observedActions: actions.slice(0, 8).map((action) => ({
        kind: action.kind || null,
        summary: action.summary || null,
        floorId: actionFloor(action),
        x: actionX(action),
        y: actionY(action),
      })),
      boundary,
      targetRelevantBoundary,
    };
  });
  const bestRelevantBoundary = bestApproaches
    .map((approach) => approach.targetRelevantBoundary)
    .filter(Boolean)
    .sort((left, right) => {
      const score = (entry) => {
        const tr = entry.targetRelevance;
        return (tr.separatesCurrentComponentFromTarget ? 4000 : 0) +
          (tr.targetSideReachableIfRemoved ? 3000 : 0) +
          (tr.onMinimumBlockerPath ? 2000 : 0) +
          (tr.reducesTopologicalBlockerDistance ? 1000 : 0) -
          (tr.minAccessBlockers == null ? 0 : tr.minAccessBlockers);
      };
      return score(right) - score(left);
    })[0] || null;
  return {
    schema: ATTRIBUTION_SCHEMA,
    attemptId: attemptId || null,
    sourceNodeId: sourceNodeId != null ? sourceNodeId : null,
    semanticDependencyId: dependency.id || null,
    sourceExactStateFingerprint: sourceExactStateFingerprint || null,
    target: dependency.target,
    connectorStatus: connectorResult.status,
    connectorStoppedReason: connectorResult.stoppedReason,
    connectorExpansions: connectorResult.expansions,
    bestApproaches,
    targetRelevantBoundary: bestRelevantBoundary,
    firstUnresolvedAccessBoundary: bestApproaches.length > 0
      ? bestApproaches[0].boundary
      : {
          kind: "unknown",
          target: dependency.target,
          evidence: { reason: "no-best-approach-observed" },
          proofStrength: "unknown",
        },
  };
}

module.exports = {
  ATTRIBUTION_SCHEMA,
  analyzeBoundaryTargetRelevance,
  buildDependencyAccessAttribution,
  buildTargetMetrics,
  classifyFrontierBoundary,
  createDependencyAccessObserver,
};
