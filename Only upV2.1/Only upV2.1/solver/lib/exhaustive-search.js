"use strict";

const { buildStateKey } = require("./state-key");

function nowMs() {
  const [seconds, nanoseconds] = process.hrtime();
  return seconds * 1000 + nanoseconds / 1e6;
}

function actionKind(action) {
  return action && action.kind ? action.kind : "unknown";
}

function compactActionRecord(action) {
  if (!action) return null;
  return {
    kind: action.kind || null,
    summary: action.summary || null,
    floorId: action.floorId || null,
    x: action.x != null ? action.x : null,
    y: action.y != null ? action.y : null,
    target: action.target || null,
    stance: action.stance || null,
    direction: action.direction || null,
    tool: action.tool || null,
    equipId: action.equipId || null,
    enemyId: action.enemyId || null,
    eventId: action.eventId || null,
    changeFloor: action.changeFloor || null,
    estimate: action.estimate || null,
  };
}

function createStats() {
  return {
    expanded: 0,
    generated: 0,
    enqueued: 0,
    duplicate: 0,
    invalid: 0,
    maxDepthReached: 0,
    frontierSize: 0,
    elapsedMs: 0,
    stopReason: null,
    byFloor: {},
    byActionKind: {},
  };
}

function ensureFloorStats(stats, floorId) {
  const key = floorId || "unknown";
  if (!stats.byFloor[key]) {
    stats.byFloor[key] = { expanded: 0, generated: 0, enqueued: 0, duplicate: 0, invalid: 0 };
  }
  return stats.byFloor[key];
}

function ensureActionStats(stats, action) {
  const kind = actionKind(action);
  if (!stats.byActionKind[kind]) {
    stats.byActionKind[kind] = { generated: 0, enqueued: 0, duplicate: 0, invalid: 0 };
  }
  return stats.byActionKind[kind];
}

function recordFloor(stats, floorId, field) {
  const bucket = ensureFloorStats(stats, floorId);
  bucket[field] = Number(bucket[field] || 0) + 1;
}

function recordAction(stats, action, field) {
  const bucket = ensureActionStats(stats, action);
  bucket[field] = Number(bucket[field] || 0) + 1;
}

function reconstructNodes(nodes, goalNode) {
  const chain = [];
  let node = goalNode;
  while (node) {
    chain.push(node);
    node = nodes.get(node.parentId);
  }
  return chain.reverse();
}

function isDecisionStep(step) {
  return typeof step === "string" && !step.startsWith("auto:");
}

function buildRouteRecord(chain, initialState, finalState, stats, metadata) {
  const config = metadata || {};
  const route = finalState && Array.isArray(finalState.route) && finalState.route.length > 0
    ? finalState.route.slice()
    : (chain || []).slice(1).map((node) => node.actionRecord && node.actionRecord.summary).filter(Boolean);
  return {
    schemaVersion: "exhaustive-route-v1",
    createdAt: new Date().toISOString(),
    search: {
      algorithm: "bfs-decision-depth",
      rank: config.rank || null,
      startStatePath: config.startStatePath || null,
      goal: config.goal || null,
      options: config.options || {},
    },
    foundGoal: Boolean(finalState),
    route,
    decisions: route.filter(isDecisionStep),
    actions: (chain || []).slice(1).map((node) => node.actionRecord).filter(Boolean),
    initialState,
    finalState: finalState || null,
    stats,
  };
}

function buildGoalPredicate(options) {
  const config = options || {};
  if (config.goalState) {
    const goalKey = buildStateKey(config.goalState);
    return (state) => buildStateKey(state) === goalKey;
  }
  if (!config.toFloor) {
    throw new Error("Missing goal: pass goalState or toFloor.");
  }
  const targetX = config.toX != null ? Number(config.toX) : null;
  const targetY = config.toY != null ? Number(config.toY) : null;
  const needsCoordinate = Number.isFinite(targetX) && Number.isFinite(targetY);
  return (state) => {
    if (!state || state.floorId !== config.toFloor) return false;
    if (!needsCoordinate) return true;
    const loc = (state.hero || {}).loc || {};
    return Number(loc.x) === targetX && Number(loc.y) === targetY;
  };
}

function buildProgress(stats, headIndex, queueIds) {
  return {
    expanded: stats.expanded,
    generated: stats.generated,
    enqueued: stats.enqueued,
    duplicate: stats.duplicate,
    invalid: stats.invalid,
    frontierSize: Math.max(0, queueIds.length - headIndex),
    maxDepthReached: stats.maxDepthReached,
    elapsedMs: stats.elapsedMs,
  };
}

function searchExhaustive(simulator, initialState, options) {
  const config = options || {};
  if (typeof config.goalPredicate !== "function") {
    throw new Error("searchExhaustive requires options.goalPredicate.");
  }

  const maxExpanded = Number(config.maxExpanded == null ? 200000 : config.maxExpanded);
  const maxDepth = Number(config.maxDepth == null ? 300 : config.maxDepth);
  const maxRuntimeMs = Number(config.maxRuntimeMs || 0);
  const dedupe = config.dedupe || "exact";
  const saveEvery = Number(config.saveEvery == null ? 10000 : config.saveEvery);
  const startedAt = nowMs();
  const stats = createStats();
  const nodes = new Map();
  const queueIds = [];
  const initialKey = buildStateKey(initialState);
  const visited = dedupe === "exact" ? new Set([initialKey]) : null;
  let headIndex = 0;
  let nextId = 1;
  let skippedDepth = false;

  const initialNode = {
    id: 0,
    parentId: null,
    depth: 0,
    state: initialState,
    stateKey: initialKey,
    actionRecord: null,
  };
  nodes.set(initialNode.id, initialNode);
  queueIds.push(initialNode.id);

  const finish = (stopReason, goalNode) => {
    stats.stopReason = stopReason;
    stats.frontierSize = Math.max(0, queueIds.length - headIndex);
    stats.elapsedMs = nowMs() - startedAt;
    const chain = goalNode ? reconstructNodes(nodes, goalNode) : [];
    const finalState = goalNode ? goalNode.state : null;
    const routeRecord = buildRouteRecord(chain, initialState, finalState, stats, config.metadata || {});
    return {
      foundGoal: Boolean(goalNode),
      finalState,
      routeRecord,
      stats,
    };
  };

  while (headIndex < queueIds.length) {
    stats.elapsedMs = nowMs() - startedAt;
    if (maxRuntimeMs > 0 && stats.elapsedMs >= maxRuntimeMs) return finish("max-runtime-ms", null);
    if (stats.expanded >= maxExpanded) return finish("max-expanded", null);

    const node = nodes.get(queueIds[headIndex]);
    headIndex += 1;
    stats.maxDepthReached = Math.max(stats.maxDepthReached, node.depth);

    if (config.goalPredicate(node.state)) return finish("goal", node);

    if (node.depth >= maxDepth) {
      skippedDepth = true;
      continue;
    }

    stats.expanded += 1;
    recordFloor(stats, node.state.floorId, "expanded");

    let actions = simulator.enumerateActions(node.state);
    if (typeof config.sortActions === "function") {
      actions = config.sortActions(node.state, actions.slice());
    }

    for (const action of actions) {
      stats.generated += 1;
      recordFloor(stats, node.state.floorId, "generated");
      recordAction(stats, action, "generated");

      let nextState;
      try {
        nextState = simulator.applyAction(node.state, action);
      } catch (error) {
        stats.invalid += 1;
        recordFloor(stats, node.state.floorId, "invalid");
        recordAction(stats, action, "invalid");
        continue;
      }

      const key = buildStateKey(nextState);
      if (visited && visited.has(key)) {
        stats.duplicate += 1;
        recordFloor(stats, node.state.floorId, "duplicate");
        recordAction(stats, action, "duplicate");
        continue;
      }

      if (visited) visited.add(key);

      const child = {
        id: nextId,
        parentId: node.id,
        depth: node.depth + 1,
        state: nextState,
        stateKey: key,
        actionRecord: compactActionRecord(action),
      };
      nextId += 1;
      nodes.set(child.id, child);
      queueIds.push(child.id);
      stats.enqueued += 1;
      recordFloor(stats, node.state.floorId, "enqueued");
      recordAction(stats, action, "enqueued");

      if (config.stopOnFirst !== false && config.goalPredicate(child.state)) return finish("goal", child);
    }

    if (saveEvery > 0 && typeof config.onProgress === "function" && stats.expanded % saveEvery === 0) {
      stats.elapsedMs = nowMs() - startedAt;
      config.onProgress(buildProgress(stats, headIndex, queueIds));
    }
  }

  return finish(skippedDepth ? "max-depth" : "frontier-empty", null);
}

module.exports = {
  searchExhaustive,
  buildGoalPredicate,
  buildRouteRecord,
};
