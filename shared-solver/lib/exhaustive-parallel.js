"use strict";

const os = require("node:os");
const path = require("path");

const { WorkerPool } = require("./worker-pool");
const { chunk, serializeNodeForWorker, stableMergeResults } = require("./parallel-expander");
const { reconstructActionEntries, reconstructNodeChain, reconstructRoute } = require("./search-nodes");
const { buildStateKey } = require("./state-key");

function nowMs() {
  const [seconds, nanoseconds] = process.hrtime();
  return seconds * 1000 + nanoseconds / 1e6;
}

function createStats(workers, chunkSize) {
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
    workers,
    chunkSize,
    workerExpanded: 0,
    workerGenerated: 0,
    ipcWaitMs: 0,
    mergeMs: 0,
    actionFiltered: 0,
    scopeFiltered: 0,
    frontierDropped: 0,
    incomplete: false,
    incompleteReason: null,
  };
}

function buildGoalPredicate(options) {
  const config = options || {};
  if (!config.toFloor) throw new Error("Missing goal: pass toFloor.");
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

function attachRoute(nodes, node) {
  if (!node || !node.state) return null;
  node.state.route = reconstructRoute(nodes, node);
  return node.state;
}

async function searchExhaustiveParallel(simulator, initialState, options) {
  const config = options || {};
  const workers = Math.max(1, Number(config.workers || Math.max(1, (os.availableParallelism ? os.availableParallelism() : os.cpus().length) - 1)));
  const chunkSize = Math.max(1, Number(config.workerChunkSize || 32));
  const maxExpanded = Number(config.maxExpanded == null ? 200000 : config.maxExpanded);
  const maxDepth = Number(config.maxDepth == null ? 300 : config.maxDepth);
  const frontierCap = config.frontierCap == null ? 0 : Number(config.frontierCap);
  const goalPredicate = config.goalPredicate || buildGoalPredicate(config);
  const startedAt = nowMs();
  const stats = createStats(workers, chunkSize);
  const nodes = new Map();
  const visited = new Set();
  let nextNodeId = 1;
  let frontier = [];
  const initialKey = buildStateKey(initialState);
  const root = { nodeId: 0, id: 0, parentId: null, depth: 0, order: 0, state: initialState, stateKey: initialKey, actionEntry: null };
  nodes.set(0, root);
  visited.add(initialKey);
  frontier.push(root);

  const pool = new WorkerPool(path.join(__dirname, "search-worker.js"), {
    workers,
    workerData: {
      projectRoot: config.projectRoot || path.resolve(__dirname, ".."),
      stopFloorId: config.toFloor || simulator.stopFloorId,
      autoPickupEnabled: config.autoPickupEnabled !== false,
      autoBattleEnabled: config.autoBattleEnabled !== false,
      enableFightToLevelUp: Boolean(config.enableFightToLevelUp),
      enableResourcePocket: Boolean(config.enableResourcePocket),
      actionAllowlist: config.actionAllowlist || null,
      floorScope: config.floorScope || null,
      regionScopes: config.regionScopes || null,
    },
  });

  const finish = async (stopReason, goalNode) => {
    stats.stopReason = stopReason;
    stats.frontierSize = frontier.length;
    stats.elapsedMs = nowMs() - startedAt;
    await pool.close();
    return {
      foundGoal: Boolean(goalNode),
      goalState: attachRoute(nodes, goalNode),
      finalState: attachRoute(nodes, goalNode),
      searchNodes: goalNode ? reconstructNodeChain(nodes, goalNode) : [],
      actionEntries: goalNode ? reconstructActionEntries(nodes, goalNode) : [],
      route: goalNode ? reconstructRoute(nodes, goalNode) : null,
      expansions: stats.expanded,
      stats,
    };
  };

  try {
    for (let depth = 0; frontier.length > 0; depth += 1) {
      stats.maxDepthReached = Math.max(stats.maxDepthReached, depth);
      const existingGoal = frontier.find((node) => goalPredicate(node.state));
      if (existingGoal) return await finish("goal", existingGoal);
      if (depth >= maxDepth) return await finish("max-depth", null);
      if (stats.expanded >= maxExpanded) return await finish("max-expanded", null);

      const expandable = frontier.slice(0, Math.max(0, maxExpanded - stats.expanded));
      const jobs = chunk(expandable.map((node, order) => serializeNodeForWorker(node, order)), chunkSize);
      const waitStartedAt = nowMs();
      const results = await pool.map(jobs, (nodesForWorker) => ({ type: "expandBatch", nodes: nodesForWorker }));
      stats.ipcWaitMs += nowMs() - waitStartedAt;
      results.forEach((result) => {
        stats.workerExpanded += Number((result.stats || {}).expanded || 0);
        stats.workerGenerated += Number((result.stats || {}).generated || 0);
        stats.actionFiltered += Number((result.stats || {}).actionFiltered || 0);
        stats.scopeFiltered += Number((result.stats || {}).scopeFiltered || 0);
      });

      const mergeStartedAt = nowMs();
      const candidates = stableMergeResults(results);
      const nextFrontier = [];
      const parentById = new Map(expandable.map((node) => [node.nodeId, node]));
      stats.expanded += expandable.length;
      for (const candidate of candidates) {
        stats.generated += 1;
        if (candidate.invalid) {
          stats.invalid += 1;
          continue;
        }
        if (visited.has(candidate.stateKey)) {
          stats.duplicate += 1;
          continue;
        }
        visited.add(candidate.stateKey);
        const parent = parentById.get(candidate.parentId);
        const node = {
          nodeId: nextNodeId,
          id: nextNodeId,
          parentId: candidate.parentId,
          depth: parent ? parent.depth + 1 : depth + 1,
          order: nextNodeId,
          state: candidate.state,
          stateKey: candidate.stateKey,
          actionEntry: candidate.actionEntry,
        };
        nextNodeId += 1;
        nodes.set(node.nodeId, node);
        stats.enqueued += 1;
        if (config.stopOnFirst !== false && goalPredicate(node.state)) return await finish("goal", node);
        nextFrontier.push(node);
      }
      stats.mergeMs += nowMs() - mergeStartedAt;
      if (frontierCap > 0 && nextFrontier.length > frontierCap) {
        stats.frontierDropped += nextFrontier.length - frontierCap;
        stats.incomplete = true;
        stats.incompleteReason = "frontier-cap";
        frontier = nextFrontier.slice(0, frontierCap);
      } else {
        frontier = nextFrontier;
      }
      stats.frontierSize = frontier.length;
      stats.elapsedMs = nowMs() - startedAt;
      if (config.perf) {
        console.log(`Parallel BFS live: ${JSON.stringify({ depth, expanded: stats.expanded, generated: stats.generated, frontierSize: stats.frontierSize, workers, chunkSize, elapsedMs: Math.round(stats.elapsedMs) })}`);
      }
    }
    return await finish("frontier-empty", null);
  } catch (error) {
    await pool.close();
    throw error;
  }
}

module.exports = {
  searchExhaustiveParallel,
};
