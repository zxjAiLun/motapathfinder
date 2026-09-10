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
  // Iteration 2 (final): 32 → 96 total decision actions per simulation
  // (selection + expansion + rollout combined). 96 is chosen because the
  // strict-valid witness route is 92 decisions — placing the sampling
  // horizon at the same order of magnitude as the known solvable route.
  // NOT a sweep value.
  TOTAL_DECISIONS_PER_SIMULATION: 96,
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

// PR-5.25k: search-REGION-RELATIVE progress resolution.
//
// The 5.25b comment declared "MT1 = 0.0 ... MT5 = 1.0", but the implementation
// used ABSOLUTE project floorOrder indices (idx / indexOf(goalFloor)).  That
// gave MT1 a non-zero reward and compressed the MT1->MT5 dynamic range, which
// matters because auxProgress is backed up into edge.W_aux and consumed by UCT
// whenever goalReward is 0.
//
// Correct contract: progress is measured across the search region
// [startFloorId .. goalFloorId], so a chaos-MT1 -> MT5 run gives MT1 = 0.00,
// MT2 = 0.25, MT3 = 0.50, MT4 = 0.75, MT5 = 1.00.  The region is the contiguous
// floorOrder slice [startIndex..goalIndex], so region ordinal and index
// difference coincide and non-contiguous towers are still handled.
//
// Fail-closed: a missing start/goal floor, a goal that does not come after the
// start, or an unmappable current floor throws instead of falling back to a
// global index.
function createRegionProgressResolver(floorOrder, startFloorId, goalFloorId) {
  if (!Array.isArray(floorOrder) || floorOrder.length === 0) {
    throw new Error("region progress requires a non-empty floorOrder (fail closed)");
  }
  if (!startFloorId) throw new Error("region progress requires a start floor id (fail closed)");
  if (!goalFloorId) throw new Error("region progress requires a goal floor id (fail closed)");
  const startIndex = floorOrder.indexOf(startFloorId);
  if (startIndex < 0) throw new Error(`region start floor ${startFloorId} is not in floorOrder (fail closed)`);
  const goalIndex = floorOrder.indexOf(goalFloorId);
  if (goalIndex < 0) throw new Error(`region goal floor ${goalFloorId} is not in floorOrder (fail closed)`);
  if (goalIndex <= startIndex) {
    throw new Error(`region goal floor ${goalFloorId} must come after start floor ${startFloorId} (fail closed)`);
  }
  const span = goalIndex - startIndex;
  return {
    startFloorId,
    goalFloorId,
    startIndex,
    goalIndex,
    span,
    regionFloors: floorOrder.slice(startIndex, goalIndex + 1),
    progressOf(floorId) {
      const index = floorOrder.indexOf(floorId);
      if (index < 0) throw new Error(`current floor ${floorId} cannot be mapped into floorOrder (fail closed)`);
      return Math.min(1, Math.max(0, (index - startIndex) / span));
    },
  };
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
  // PR-5.25j: optional injected proposer for choosing WHICH untried action to
  // expand first.  When absent the default uniform pick below is used verbatim,
  // so existing behaviour is unchanged.  The proposer only reorders untried
  // exploration; it can never make a legal action permanently unexpanded.
  const untriedActionProposer = typeof config.untriedActionProposer === "function"
    ? config.untriedActionProposer
    : null;

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

    // PR-5.25k: region-relative floor normalization for auxProgress.
    const floorOrder = (simulator.project && simulator.project.floorOrder) || [];
    const region = createRegionProgressResolver(
      floorOrder,
      initialState && initialState.floorId,
      terminalGoal && terminalGoal.floorId,
    );

    const auxProgressOf = (state) => region.progressOf(state.floorId);

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
    const startingRssMb = Math.round((process.memoryUsage().rss / (1024 * 1024)) * 10) / 10;
    // PR-5.25k mechanism telemetry: confirm the repaired progress values really
    // enter the search (one entry per simulation backup).
    const auxProgressValueHistogram = {};
    // PR-5.25j telemetry: which action kinds got expanded (untried proposer
    // effect), and the deepest floor actually reached.
    const expandedActionKindHistogram = {};

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
    // Default is the original uniform pick; PR-5.25j may inject a proposer that
    // is applied ONLY to the untried subset (no top-k / threshold pruning).
    const selectUntriedAction = (node, actions, simIndex) => {
      const triedIdentities = new Set(node.edges.keys());
      const untried = actions.filter((a) => !triedIdentities.has(actionIdentityOf(a)));
      if (untried.length === 0) return null;
      // Stable random per (seed, parentExactKey, simIndex): same state → same pick.
      // This is the isolated untried-selection stream; both arms derive it
      // identically so the proposer cannot perturb the rollout RNG (C3).
      const rng = createSeededRng(seed ^ hashStringToInt(node.exactKey) ^ (simIndex * 2654435761));
      if (untriedActionProposer) {
        let selected = null;
        try {
          selected = untriedActionProposer({
            state: node.state,
            untriedActions: untried,
            allActions: actions,
            seed,
            simulationIndex: simIndex,
            exactKey: node.exactKey,
            rng,
            actionIdentity: actionIdentityOf,
          });
        } catch (error) {
          selected = null;
        }
        // Fail-soft: only a genuine untried action is accepted, otherwise the
        // default uniform pick is used (never "skip exploration").
        if (selected && untried.includes(selected)) return selected;
      }
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
    // Repair 1: (a) carries pathExactKeys for CYCLE_TRUNCATED during graph
    // selection (design contract: single trajectory must not revisit an exact
    // key, not just during rollout); (b) tracks deepestAux across all
    // selection-visited states for simulation-wide deepest progress.
    const graphSelection = (simIndex, pathKeys) => {
      const trajectory = [];
      let current = rootNode;
      let decisions = 0;
      let selectionDeepestAux = auxProgressOf(rootNode.state);
      const pathExactKeys = pathKeys || new Set([rootNode.exactKey]);
      while (decisions < MCGS_PARAMS.TOTAL_DECISIONS_PER_SIMULATION) {
        const actions = enumerateActions(current.state);
        if (actions.length === 0) {
          return { trajectory, currentNode: current, remainingDecisions: MCGS_PARAMS.TOTAL_DECISIONS_PER_SIMULATION - decisions, noActions: true, selectionDeepestAux, pathExactKeys };
        }
        const untried = selectUntriedAction(current, actions, simIndex);
        if (untried !== null) {
          return { trajectory, currentNode: current, remainingDecisions: MCGS_PARAMS.TOTAL_DECISIONS_PER_SIMULATION - decisions, expandAction: untried, selectionDeepestAux, pathExactKeys };
        }
        const edge = mode === "treatment" ? selectUctEdge(current) : selectUniformEdge(current, simIndex);
        if (!edge) {
          return { trajectory, currentNode: current, remainingDecisions: MCGS_PARAMS.TOTAL_DECISIONS_PER_SIMULATION - decisions, noActions: true, selectionDeepestAux, pathExactKeys };
        }
        const action = enumerateActions(current.state).find((a) => actionIdentityOf(a) === edge.identity);
        if (!action) {
          return { trajectory, currentNode: current, remainingDecisions: MCGS_PARAMS.TOTAL_DECISIONS_PER_SIMULATION - decisions, noActions: true, selectionDeepestAux, pathExactKeys };
        }
        let childState = null;
        try {
          childState = simulator.applyAction(current.state, action, { storeRoute: false });
          applyActionCalls += 1;
        } catch (_) {
          childState = null;
        }
        if (!childState || !childState.hero || (childState.hero.hp != null && childState.hero.hp <= 0)) {
          trajectory.push({ node: current, edge });
          return { trajectory, currentNode: current, remainingDecisions: MCGS_PARAMS.TOTAL_DECISIONS_PER_SIMULATION - decisions - 1, deadEnd: true, selectionDeepestAux, pathExactKeys };
        }
        const childKey = buildStateKey(childState);
        if (pathExactKeys.has(childKey)) {
          trajectory.push({ node: current, edge });
          return { trajectory, currentNode: current, remainingDecisions: MCGS_PARAMS.TOTAL_DECISIONS_PER_SIMULATION - decisions - 1, cycleTruncated: true, selectionDeepestAux, pathExactKeys };
        }
        const { node: childNode } = getOrCreateNode(childState);
        trajectory.push({ node: current, edge });
        pathExactKeys.add(childKey);
        current = childNode;
        const aux = auxProgressOf(childState);
        if (aux > selectionDeepestAux) selectionDeepestAux = aux;
        decisions += 1;
      }
      return { trajectory, currentNode: current, remainingDecisions: 0, horizonTruncated: true, selectionDeepestAux, pathExactKeys };
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
      const expandKind = expandAction.kind || "unknown";
      expandedActionKindHistogram[expandKind] = (expandedActionKindHistogram[expandKind] || 0) + 1;

      // Record the graph edge for backup.
      const trajectoryEdge = { node, edge };

      // Repair 2 (P1-2): EXPANSION TRANSITION CYCLE CHECK.
      // Design contract: one simulation may not revisit an exact key.
      // If the expansion child's exact key is already in the current
      // trajectory (from graph selection), this simulation has a cycle.
      // The edge is still a legal graph edge (global graph may contain
      // cycles), but this simulation terminates CYCLE_TRUNCATED with no
      // rollout.
      if (pathExactKeys.has(childKey)) {
        return {
          goalReward: 0,
          auxProgress: Math.max(auxProgressOf(node.state), auxProgressOf(childState)),
          termination: "CYCLE_TRUNCATED",
          rolloutActions: [],
          trajectoryEdge,
          childKey,
        };
      }

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

      const sel = graphSelection(simIndex);

      // Path keys from graph selection (now carried by graphSelection itself).
      const pathExactKeys = sel.pathExactKeys;

      let goalReward = 0;
      // Simulation-wide deepest progress: max(selection deepest, expansion+rollout deepest).
      let auxProgress = sel.selectionDeepestAux || 0;
      let termination = "HORIZON_TRUNCATED";
      let trajectoryEdges = sel.trajectory.map((step) => ({ node: step.node, edge: step.edge }));
      let rolloutActions = [];
      let fullActionSummaries = sel.trajectory.map((step) => step.edge.actionSummary);

      if (sel.noActions) {
        termination = "DEAD_END";
      } else if (sel.deadEnd) {
        termination = "DEAD_END";
      } else if (sel.cycleTruncated) {
        termination = "CYCLE_TRUNCATED";
      } else if (sel.horizonTruncated) {
        termination = "HORIZON_TRUNCATED";
      } else if (sel.expandAction) {
        const result = expansionAndRollout(sel.currentNode, sel.expandAction, sel.remainingDecisions, simIndex, pathExactKeys);
        goalReward = result.goalReward;
        // Take max of selection deepest and rollout deepest (design: "deepest
        // actual floor progress observed" across the ENTIRE simulation).
        if (result.auxProgress > auxProgress) auxProgress = result.auxProgress;
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

      const auxKey = String(auxProgress);
      auxProgressValueHistogram[auxKey] = (auxProgressValueHistogram[auxKey] || 0) + 1;

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
    const maxAux = auxProgresses.length > 0 ? Math.max(...auxProgresses) : 0;
    const deepestFloorIndex = Math.round(maxAux * region.span) + region.startIndex;
    const deepestFloorId = floorOrder[deepestFloorIndex] || null;
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
      startingRssMb,
      region: {
        startFloorId: region.startFloorId,
        goalFloorId: region.goalFloorId,
        startIndex: region.startIndex,
        goalIndex: region.goalIndex,
        span: region.span,
        regionFloors: region.regionFloors,
      },
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
        expandedActionKindHistogram,
        deepestFloorOrdinal: deepestFloorIndex,
        deepestFloorId,
        auxProgressValueHistogram,
        distinctAuxProgressValues: Object.keys(auxProgressValueHistogram).length,
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
  createRegionProgressResolver,
  createSeededRng,
  hashStringToInt,
};
