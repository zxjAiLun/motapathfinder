"use strict";

/**
 * PR-5.25b — Feedback-Allocated Monte Carlo Graph Search (MCGS) core.
 *
 * Tests the causal hypothesis: does trajectory-outcome feedback used to
 * allocate future sampling find a valid route more effectively than sampling
 * allocation that does not use outcome feedback?
 *
 * Architecture:
 *   - Global exact registry: exactKey → StateNode (identity + expansion)
 *   - Edge-local statistics: (parentExactKey, actionIdentity) → EdgeStats
 *   - Phase boundary: GRAPH SELECTION → EXPANSION → DEFAULT ROLLOUT
 *   - Total 32 decision actions per simulation (selection+expansion+rollout)
 *   - Default rollout is UNIFORM, no heuristic; rollout actions do NOT enter
 *     the graph
 *   - Trajectory-only backup: only graph edges actually traversed
 *   - CYCLE_TRUNCATED when trajectory revisits an exact key
 *   - Dual reward: goalReward (0/1) + auxProgress (floor 0-1)
 *   - RNG streams isolated: untried-selection, control-selection, rollout
 *     are independent streams — feedback selection cannot shift the rollout
 *     random flow
 *
 * Implementation closure conditions (Cloud Review):
 *   C1: Phase boundary — selection ends at first node with untried actions,
 *       rollout starts from the expanded child's state; rollout actions are
 *       not inserted into the graph
 *   C2: actionIdentity is a stable semantic key (fingerprintAction from
 *       route-store) — same exact state enumerated twice yields identical
 *       identity sets with no duplicates
 *   C3: RNG streams isolated per (seed, simulationIndex, phase) so that
 *       CONTROL vs TREATMENT graph-selection differences do not shift the
 *       default rollout's random flow
 */

const { buildStateKey } = require("./state-key");
const { cloneState } = require("./state");
const { fingerprintAction } = require("./route-store");

const MCGS_PARAMS = {
  TOTAL_DECISIONS_PER_SIMULATION: 32,
  LAMBDA_AUX: 0.10,
  UCT_C: 1.0,
};

// Deterministic hash-based RNG (xorshift128) — stable across arms.
function createSeededRng(seed) {
  let s0 = seed >>> 0 || 1;
  let s1 = (seed * 0x9E3779B9) >>> 0 || 0x85EBCA6B;
  let s2 = (seed * 0x85EBCA6B) >>> 0 || 0xC2B2AE35;
  let s3 = (seed * 0xC2B2AE35) >>> 0 || 0x27D4EB2F;
  return {
    next() {
      // xorshift128
      const t = s3;
      const s = s0 ^ (s0 << 11) & 0xFFFFFFFF;
      s0 = s1; s1 = s2; s2 = s3;
      s3 = (s ^ (t ^ (t >>> 19))) & 0xFFFFFFFF;
      return ((s3 >>> 0) / 4294967296);
    },
  };
}

function hashStringToInt(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Create an MCGS search instance.
 *
 * simulator: StaticSimulator instance (production simulator)
 * options:
 *   isGoalState(state)  — terminal predicate
 *   allowedFloors       — region restriction (optional)
 *   maxSimulations      — total simulation budget
 *   maxRuntimeMs        — wall budget
 *   maxRssMb            — RSS hard ceiling
 *   seed                — base random seed
 *   mode                — "control" (uniform) or "treatment" (UCT)
 */
function createMCGS(simulator, options) {
  const config = options || {};
  const isGoalState = typeof config.isGoalState === "function"
    ? config.isGoalState
    : (state) => simulator.isTerminal(state);
  const allowedFloors = Array.isArray(config.allowedFloors) ? new Set(config.allowedFloors) : null;
  const maxSimulations = Number(config.maxSimulations || 10000);
  const maxRuntimeMs = Number(config.maxRuntimeMs || 0);
  const maxRssMb = Number(config.maxRssMb || 0);
  const seed = Number(config.seed || 52501);
  const mode = config.mode === "treatment" ? "treatment" : "control";

  function enumerateActions(state) {
    let actions = [];
    try {
      actions = (simulator.enumeratePrimitiveActions(state) || {}).actions || [];
    } catch (_) {
      actions = [];
    }
    if (allowedFloors) {
      actions = actions.filter((action) => {
        const actionFloor = action.floorId || state.floorId;
        if (!allowedFloors.has(actionFloor)) return false;
        if (action.changeFloor && action.changeFloor.floorId
          && action.changeFloor.floorId !== ":next" && action.changeFloor.floorId !== ":before") {
          return allowedFloors.has(action.changeFloor.floorId);
        }
        return true;
      });
    }
    return actions;
  }

  function actionIdentityOf(action) {
    return fingerprintAction(action) || action.summary || action.kind || "unknown";
  }

  /**
   * Run the full MCGS search.
   *
   * initialState: canonical start state
   * terminalGoal: { floorId } for auxProgress normalization (optional)
   */
  function search(initialState, terminalGoal) {
    const startedAt = Date.now();

    // Floor normalization for auxProgress.
    const floorOrder = (simulator.project && simulator.project.floorOrder) || [];
    const terminalFloorIndex = terminalGoal && terminalGoal.floorId
      ? floorOrder.indexOf(terminalGoal.floorId)
      : floorOrder.length > 0 ? floorOrder.length - 1 : 0;

    const auxProgressOf = (state) => {
      const idx = floorOrder.indexOf(state.floorId);
      if (idx < 0 || terminalFloorIndex <= 0) return 0;
      return Math.min(1, Math.max(0, (idx + 1) / (terminalFloorIndex + 1)));
    };

    // ---- Root ----
    const rootState = cloneState(initialState);
    rootState.route = [];
    if (!rootState.meta) rootState.meta = {};
    const rootNode = {
      exactKey: buildStateKey(rootState),
      state: rootState,
      edges: new Map(),      // actionIdentity → EdgeStats
      totalEdgeVisits: 0,    // N_parent
    };

    // ---- Global registry ----
    const nodesByExactKey = new Map();
    nodesByExactKey.set(rootNode.exactKey, rootNode);

    // ---- Telemetry ----
    let searchIterations = 0;
    let applyActionCalls = 0;
    let expandedEdges = 0;
    let rolloutCount = 0;
    let rolloutDecisionSteps = 0;
    let completeDeadEndRollouts = 0;
    let horizonTruncatedRollouts = 0;
    let cycleTruncatedRollouts = 0;
    let terminalRollouts = 0;
    let transpositionHits = 0;
    let stoppedReason = null;
    let goalFound = false;
    let goalRouteSummaries = null;
    let goalWallMs = null;
    let goalApplyActions = null;
    let goalIterations = null;
    let peakRssMb = 0;

    const goalRewards = [];      // distribution for ROLLOUT_RETURN_DIVERSITY
    const auxProgresses = [];

    const sampleRss = () => {
      if (maxRssMb <= 0) return;
      const rssMb = process.memoryUsage().rss / (1024 * 1024);
      if (rssMb > peakRssMb) peakRssMb = rssMb;
      if (rssMb >= maxRssMb) stoppedReason = "rss-limit";
    };

    const budgetLeft = () => {
      if (stoppedReason) return false;
      if (searchIterations >= maxSimulations) {
        stoppedReason = "simulation-limit";
        return false;
      }
      if (maxRuntimeMs > 0 && Date.now() - startedAt >= maxRuntimeMs) {
        stoppedReason = "time-limit";
        return false;
      }
      return true;
    };

    // ---- Get or create a node for an exact state ----
    const getOrCreateNode = (state) => {
      const key = buildStateKey(state);
      let node = nodesByExactKey.get(key);
      if (node) {
        transpositionHits += 1;
        return { node, key, existing: true };
      }
      node = { exactKey: key, state, edges: new Map(), totalEdgeVisits: 0 };
      nodesByExactKey.set(key, node);
      return { node, key, existing: false };
    };

    // ---- Get or create an edge from a parent node ----
    const getOrCreateEdge = (parentNode, action, childKey) => {
      const identity = actionIdentityOf(action);
      let edge = parentNode.edges.get(identity);
      if (!edge) {
        edge = {
          identity,
          actionSummary: action.summary || action.kind,
          childExactKey: childKey,
          N_edge: 0,
          W_goal: 0,
          W_aux: 0,
        };
        parentNode.edges.set(identity, edge);
      }
      return edge;
    };

    // ---- Deterministic untried-action selection (C3: stable per state) ----
    const selectUntriedAction = (node, actions, simIndex) => {
      const triedIdentities = new Set(node.edges.keys());
      const untried = actions.filter((a) => !triedIdentities.has(actionIdentityOf(a)));
      if (untried.length === 0) return null;
      // Stable random per (seed, parentExactKey, simIndex): same state → same pick.
      const rng = createSeededRng(seed ^ hashStringToInt(node.exactKey) ^ (simIndex * 2654435761));
      return untried[Math.floor(rng.next() * untried.length) % untried.length];
    };

    // ---- CONTROL: uniform existing-edge selection (C3: isolated stream) ----
    const selectUniformEdge = (node, simIndex) => {
      const edges = Array.from(node.edges.values());
      if (edges.length === 0) return null;
      const rng = createSeededRng(seed ^ 0xC077701 ^ (simIndex * 40503) ^ hashStringToInt(node.exactKey));
      return edges[Math.floor(rng.next() * edges.length) % edges.length];
    };

    // ---- TREATMENT: UCT existing-edge selection ----
    const selectUctEdge = (node) => {
      const edges = Array.from(node.edges.values());
      if (edges.length === 0) return null;
      const logN = Math.log(1 + node.totalEdgeVisits);
      let bestEdge = null;
      let bestScore = -Infinity;
      for (const edge of edges) {
        const qGoal = edge.N_edge > 0 ? edge.W_goal / edge.N_edge : 0;
        const qAux = edge.N_edge > 0 ? edge.W_aux / edge.N_edge : 0;
        const exploration = Math.sqrt(logN / (1 + edge.N_edge));
        const score = qGoal + MCGS_PARAMS.LAMBDA_AUX * qAux + MCGS_PARAMS.UCT_C * exploration;
        if (score > bestScore) {
          bestScore = score;
          bestEdge = edge;
        }
      }
      return bestEdge;
    };

    // ---- Phase: GRAPH SELECTION ----
    // Returns { trajectory: [{node, edge}], currentNode, remainingDecisions }
    const graphSelection = (simIndex) => {
      const trajectory = [];
      let current = rootNode;
      let decisions = 0;
      while (decisions < MCGS_PARAMS.TOTAL_DECISIONS_PER_SIMULATION) {
        const actions = enumerateActions(current.state);
        if (actions.length === 0) {
          return { trajectory, currentNode: current, remainingDecisions: MCGS_PARAMS.TOTAL_DECISIONS_PER_SIMULATION - decisions, noActions: true };
        }
        const untried = selectUntriedAction(current, actions, simIndex);
        if (untried !== null) {
          // Phase transitions to EXPANSION at this node.
          return { trajectory, currentNode: current, remainingDecisions: MCGS_PARAMS.TOTAL_DECISIONS_PER_SIMULATION - decisions, expandAction: untried };
        }
        // Fully expanded: select existing edge.
        const edge = mode === "treatment" ? selectUctEdge(current) : selectUniformEdge(current, simIndex);
        if (!edge) {
          return { trajectory, currentNode: current, remainingDecisions: MCGS_PARAMS.TOTAL_DECISIONS_PER_SIMULATION - decisions, noActions: true };
        }
        // Apply the edge's action to get the child state.
        const action = enumerateActions(current.state).find((a) => actionIdentityOf(a) === edge.identity);
        if (!action) {
          return { trajectory, currentNode: current, remainingDecisions: MCGS_PARAMS.TOTAL_DECISIONS_PER_SIMULATION - decisions, noActions: true };
        }
        let childState = null;
        try {
          childState = simulator.applyAction(current.state, action, { storeRoute: false });
          applyActionCalls += 1;
        } catch (_) {
          childState = null;
        }
        if (!childState || !childState.hero || (childState.hero.hp != null && childState.hero.hp <= 0)) {
          // Edge leads to death; update stats and stop.
          trajectory.push({ node: current, edge });
          return { trajectory, currentNode: current, remainingDecisions: MCGS_PARAMS.TOTAL_DECISIONS_PER_SIMULATION - decisions - 1, deadEnd: true };
        }
        const { node: childNode } = getOrCreateNode(childState);
        trajectory.push({ node: current, edge });
        current = childNode;
        decisions += 1;
      }
      return { trajectory, currentNode: current, remainingDecisions: 0, horizonTruncated: true };
    };

    // ---- Phase: EXPANSION + DEFAULT ROLLOUT ----
    const expansionAndRollout = (node, expandAction, remainingDecisions, simIndex, pathExactKeys) => {
      let childState = null;
      try {
        childState = simulator.applyAction(node.state, expandAction, { storeRoute: false });
        applyActionCalls += 1;
      } catch (_) {
        childState = null;
      }
      if (!childState || !childState.hero || (childState.hero.hp != null && childState.hero.hp <= 0)) {
        return { goalReward: 0, auxProgress: auxProgressOf(node.state), termination: "DEAD_END", rolloutActions: [] };
      }
      const { node: childNode, key: childKey } = getOrCreateNode(childState);
      const edge = getOrCreateEdge(node, expandAction, childKey);
      expandedEdges += 1;

      // Record the graph edge for backup.
      const trajectoryEdge = { node, edge };

      // Now DEFAULT ROLLOUT from childNode — uniform, no heuristic.
      let current = childNode;
      let steps = 0;
      const rolloutActions = [];
      const rolloutPathKeys = new Set(pathExactKeys);
      rolloutPathKeys.add(node.exactKey);
      rolloutPathKeys.add(childKey);
      let deepestAux = auxProgressOf(childState);
      let termination = "HORIZON_TRUNCATED";
      while (steps < remainingDecisions - 1) {
        if (isGoalState(current.state)) {
          termination = "TERMINAL";
          break;
        }
        const actions = enumerateActions(current.state);
        if (actions.length === 0) {
          termination = "DEAD_END";
          break;
        }
        // C3: isolated rollout RNG — per (seed, simIndex, step).
        const rng = createSeededRng(seed ^ 0x0B011 ^ (simIndex * 1103515245) ^ (steps * 12345));
        const action = actions[Math.floor(rng.next() * actions.length) % actions.length];
        let next = null;
        try {
          next = simulator.applyAction(current.state, action, { storeRoute: false });
          applyActionCalls += 1;
          rolloutDecisionSteps += 1;
        } catch (_) {
          next = null;
        }
        if (!next || !next.hero || (next.hero.hp != null && next.hero.hp <= 0)) {
          termination = "DEAD_END";
          break;
        }
        const nextKey = buildStateKey(next);
        if (rolloutPathKeys.has(nextKey)) {
          termination = "CYCLE_TRUNCATED";
          break;
        }
        rolloutActions.push(action);
        rolloutPathKeys.add(nextKey);
        const { node: nextNode } = getOrCreateNode(next);
        current = nextNode;
        steps += 1;
        const aux = auxProgressOf(next);
        if (aux > deepestAux) deepestAux = aux;
      }
      if (termination === "HORIZON_TRUNCATED" && isGoalState(current.state)) {
        termination = "TERMINAL";
      }
      return { goalReward: termination === "TERMINAL" ? 1 : 0, auxProgress: deepestAux, termination, rolloutActions, trajectoryEdge, childKey };
    };

    // ---- Main simulation loop ----
    while (budgetLeft()) {
      sampleRss();
      if (stoppedReason) break;
      searchIterations += 1;
      const simIndex = searchIterations;

      const pathExactKeys = new Set();
      pathExactKeys.add(rootNode.exactKey);

      const sel = graphSelection(simIndex);

      // Track path keys from graph selection.
      sel.trajectory.forEach((step) => {
        pathExactKeys.add(step.edge.childExactKey);
      });

      let goalReward = 0;
      let auxProgress = 0;
      let termination = "HORIZON_TRUNCATED";
      let trajectoryEdges = sel.trajectory.map((step) => ({ node: step.node, edge: step.edge }));
      let rolloutActions = [];
      let fullActionSummaries = sel.trajectory.map((step) => step.edge.actionSummary);

      if (sel.noActions) {
        termination = "DEAD_END";
        auxProgress = auxProgressOf(sel.currentNode.state);
      } else if (sel.deadEnd) {
        termination = "DEAD_END";
        auxProgress = auxProgressOf(sel.currentNode.state);
      } else if (sel.horizonTruncated) {
        termination = "HORIZON_TRUNCATED";
        auxProgress = auxProgressOf(sel.currentNode.state);
      } else if (sel.expandAction) {
        const result = expansionAndRollout(sel.currentNode, sel.expandAction, sel.remainingDecisions, simIndex, pathExactKeys);
        goalReward = result.goalReward;
        auxProgress = result.auxProgress;
        termination = result.termination;
        rolloutActions = result.rolloutActions || [];
        if (result.trajectoryEdge) {
          trajectoryEdges.push(result.trajectoryEdge);
        }
        fullActionSummaries.push(result.trajectoryEdge ? result.trajectoryEdge.edge.actionSummary : "");
        rolloutActions.forEach((a) => fullActionSummaries.push(a.summary || a.kind));
      }

      // Telemetry
      rolloutCount += 1;
      goalRewards.push(goalReward);
      auxProgresses.push(auxProgress);
      if (termination === "TERMINAL") terminalRollouts += 1;
      else if (termination === "DEAD_END") completeDeadEndRollouts += 1;
      else if (termination === "CYCLE_TRUNCATED") cycleTruncatedRollouts += 1;
      else horizonTruncatedRollouts += 1;

      // Goal found
      if (goalReward === 1 && !goalFound) {
        goalFound = true;
        goalRouteSummaries = fullActionSummaries.filter(Boolean);
        goalWallMs = Date.now() - startedAt;
        goalApplyActions = applyActionCalls;
        goalIterations = simIndex;
      }

      // BACKUP: trajectory-only — only graph edges actually traversed.
      for (let i = trajectoryEdges.length - 1; i >= 0; i--) {
        const step = trajectoryEdges[i];
        step.edge.N_edge += 1;
        step.edge.W_goal += goalReward;
        step.edge.W_aux += auxProgress;
        step.node.totalEdgeVisits += 1;
      }
    }

    // ---- ROLLOUT_RETURN_DIVERSITY diagnostics ----
    const uniqueGoalBuckets = new Set(goalRewards.map((v) => v === 1 ? "hit" : "miss"));
    const uniqueAuxBuckets = new Set(auxProgresses.map((v) => Math.round(v * 20) / 20));
    const allZeroCount = goalRewards.filter((g, i) => g === 0 && auxProgresses[i] === 0).length;
    const deepestFloorDist = {};
    auxProgresses.forEach((v) => {
      const b = Math.round(v * 20) / 20;
      deepestFloorDist[String(b)] = (deepestFloorDist[String(b)] || 0) + 1;
    });

    return {
      found: goalFound,
      goalRouteSummaries,
      mode,
      stoppedReason,
      wallMs: Date.now() - startedAt,
      peakRssMb: Math.round(peakRssMb * 10) / 10,
      telemetry: {
        searchIterations,
        applyActionCalls,
        expandedEdges,
        rolloutCount,
        rolloutDecisionSteps,
        completeDeadEndRollouts,
        horizonTruncatedRollouts,
        cycleTruncatedRollouts,
        terminalRollouts,
        uniqueExactStates: nodesByExactKey.size,
        transpositionHits,
        timeToFirstGoal: goalWallMs,
        applyActionsToFirstGoal: goalApplyActions,
        iterationsToFirstGoal: goalIterations,
      },
      rolloutReturnDiversity: {
        goalRewardHitRate: terminalRollouts / Math.max(1, rolloutCount),
        meanAuxProgress: auxProgresses.length > 0 ? auxProgresses.reduce((a, b) => a + b, 0) / auxProgresses.length : 0,
        uniqueGoalRewardBuckets: Array.from(uniqueGoalBuckets),
        uniqueAuxProgressBuckets: Array.from(uniqueAuxBuckets),
        allZeroPercentage: allZeroCount / Math.max(1, goalRewards.length),
        deepestFloorDistribution: deepestFloorDist,
      },
    };
  }

  return { search };
}

module.exports = {
  createMCGS,
  MCGS_PARAMS,
  createSeededRng,
  hashStringToInt,
};
