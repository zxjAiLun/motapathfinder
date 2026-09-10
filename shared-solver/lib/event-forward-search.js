"use strict";

/**
 * PR-5.25a — Event-Level Forward Search core.
 *
 * Iteration 2: EXACT-SEMANTICS-PRESERVING SEARCH-STATE MEMORY REDUCTION.
 *
 * The ONLY change from Iteration 1 is the representation of accepted nodes
 * in memory — the search semantics (exact keys, duplicate decisions, pop
 * order, goal check, route reconstruction, budget accounting) are byte-
 * identical:
 *
 *   CLOSED nodes release their full state (state = null), retaining only:
 *     - exactKey (for duplicate detection)
 *     - parentId (for route reconstruction)
 *     - compact replay action descriptor (summary string)
 *   OPEN nodes keep their full state.
 *
 *   The guided heap and neutral queue store lightweight nodeId handles
 *   (integers), NOT node objects — stale entries cannot indirectly retain
 *   full states.
 *
 *   Route reconstruction walks parentId → node records (which carry the
 *   compact replay action), producing the identical route as Iteration 1.
 *
 * Architecture boundaries unchanged from Iteration 1:
 *   - search core → existing simulator (NOT planner → segment DP → repair)
 *   - evaluator only affects PRIORITY (P1-1: identical legal action sets)
 *   - single exact-state registry; dual-view bounded-fair scheduling
 *     (guided + neutral FIFO, NEUTRAL_EVERY=8; no reopen)
 *   - OFF/ON arms identical in exact key, duplicate policy, action
 *     generation, budget, retention, goal check (P1-4)
 */

const { buildStateKey } = require("./state-key");
const { cloneState } = require("./state");

const NEUTRAL_EVERY = 8; // frozen (no sweep)

function createEventForwardSearch(simulator) {
  const enumerateActions = (state) => {
    const result = simulator.enumeratePrimitiveActions(state);
    return (result && result.actions) || [];
  };

  /**
   * Run the unified forward search.
   *
   * options:
   *   initialState        canonical start state (route may be non-empty; stripped)
   *   isGoalState(state)  terminal predicate
   *   allowedFloors       region restriction (optional; null = all)
   *   evaluator           null (CONTROL) or { rank(state, actions) -> score }
   *   maxExpansions       shared ceiling
   *   maxRuntimeMs        shared wall (evaluator time counted when ON)
   *   maxRssMb            shared hard ceiling (0 = unlimited)
   *   onTrace             optional (record) => {} evaluator trace hook
   */
  function search(initialState, options) {
    const config = options || {};
    const evaluator = config.evaluator || null;
    const evaluatorOn = Boolean(evaluator && typeof evaluator.rank === "function");
    const allowedFloors = Array.isArray(config.allowedFloors) ? new Set(config.allowedFloors) : null;
    const maxExpansions = Number(config.maxExpansions || 100000);
    const maxRuntimeMs = Number(config.maxRuntimeMs || 0);
    const maxRssMb = Number(config.maxRssMb || 0);
    const isGoalState = typeof config.isGoalState === "function"
      ? config.isGoalState
      : (state) => simulator.isTerminal(state);
    const onTrace = typeof config.onTrace === "function" ? config.onTrace : null;

    const startedAt = Date.now();
    let evaluatorWallMs = 0;
    let evaluatorCalls = 0;

    // ---- root ----
    const rootState = cloneState(initialState);
    rootState.route = [];
    if (!rootState.meta) rootState.meta = {};
    // PR-5.25a Iteration 2 Repair 1: node records NEVER retain the full
    // simulator action object. The action's `travelState` field can carry a
    // full game state (door/tool actions), so retaining it on CLOSED nodes
    // would indirectly retain the world through the back door. Only the
    // compact `actionSummary` string is kept for route reconstruction.
    // representation="legacy" (test-only) retains state+action for G33.
    const useLegacyRepresentation = config.representation === "legacy";
    const rootNode = {
      id: 1,
      parentId: null,
      state: rootState,        // OPEN: full state retained
      key: buildStateKey(rootState),
      actionSummary: null,      // compact replay descriptor (string only)
      depth: 0,
      closed: false,
    };

    // ---- single exact registry (key -> node record) ----
    // Node records live in a Map keyed by id for parent-chain lookup, and a
    // Map keyed by exactKey for duplicate detection. Both share the SAME
    // records. CLOSED records have state=null.
    const nodesById = new Map();     // nodeId -> node record
    const registry = new Map();      // exactKey -> node record (same objects)
    nodesById.set(rootNode.id, rootNode);
    registry.set(rootNode.key, rootNode);

    // ---- lightweight frontier views (nodeId handles only) ----
    const guidedHeap = [];  // { nodeId, score } — no state references
    const neutralQueue = [rootNode.id]; // nodeId — no state references
    let neutralHead = 0;    // avoids O(n) shift on the neutral FIFO
    const expanded = new Set(); // node ids expanded exactly once
    let neutralSinceGuided = 0;

    const heapPush = (entry) => {
      guidedHeap.push(entry);
      let i = guidedHeap.length - 1;
      while (i > 0) {
        const parent = Math.floor((i - 1) / 2);
        if (guidedHeap[parent].score >= guidedHeap[i].score) break;
        const tmp = guidedHeap[parent];
        guidedHeap[parent] = guidedHeap[i];
        guidedHeap[i] = tmp;
        i = parent;
      }
    };
    const heapPop = () => {
      if (guidedHeap.length === 0) return null;
      const top = guidedHeap[0];
      const last = guidedHeap.pop();
      if (guidedHeap.length > 0) {
        guidedHeap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let best = i;
          if (l < guidedHeap.length && guidedHeap[l].score > guidedHeap[best].score) best = l;
          if (r < guidedHeap.length && guidedHeap[r].score > guidedHeap[best].score) best = r;
          if (best === i) break;
          const tmp = guidedHeap[i];
          guidedHeap[i] = guidedHeap[best];
          guidedHeap[best] = tmp;
          i = best;
        }
      }
      return top;
    };

    let nextNodeId = 2;
    let expansions = 0;
    let generated = 0;
    let accepted = 0;
    let duplicatesSkipped = 0;
    let staleEntriesSkipped = 0;
    let stoppedReason = null;
    let goalNode = null;
    let peakRssMb = 0;
    // PR-5.25l (additive telemetry only; search behaviour unchanged): deepest
    // floor reached by an expanded node, so a NOT_FOUND run can still be
    // compared against another abstraction's reach.
    let deepestFloorOrdinal = 0;
    const deepestFloorHistogram = {};

    // G33 digest tracking: expanded-key / accepted-key / duplicate-decision
    // sequences for representation equivalence comparison.
    const digestExpandedKeys = config.trackKeyDigest === true;
    const expandedKeys = [];
    const acceptedKeys = [];
    const duplicateDecisionKeys = [];

    const sampleRss = () => {
      if (maxRssMb <= 0) return;
      const rssMb = process.memoryUsage().rss / (1024 * 1024);
      if (rssMb > peakRssMb) peakRssMb = rssMb;
      if (rssMb >= maxRssMb) {
        stoppedReason = "rss-limit";
      }
    };

    const budgetLeft = () => {
      if (stoppedReason) return false;
      if (expansions >= maxExpansions) {
        stoppedReason = "expansion-limit";
        return false;
      }
      if (maxRuntimeMs > 0 && Date.now() - startedAt >= maxRuntimeMs) {
        stoppedReason = "time-limit";
        return false;
      }
      return true;
    };

    // --- Accept a successor state into the registry (shared logic for both arms).
    // Returns the new node record, or null when rejected as duplicate.
    const acceptChild = (node, action, nextState) => {
      const key = buildStateKey(nextState);
      if (registry.has(key)) {
        duplicatesSkipped += 1;
        // Record duplicate-decision digest for G33 equivalence.
        if (digestExpandedKeys) duplicateDecisionKeys.push(key);
        return null;
      }
      const childNode = {
        id: nextNodeId++,
        parentId: node.id,
        state: nextState,
        key,
        // COMPACT: only the summary string; the full action object (with its
        // potential travelState) is NEVER stored on the node.
        actionSummary: action ? (action.summary || action.kind) : null,
        depth: node.depth + 1,
        closed: false,
      };
      if (useLegacyRepresentation && action) {
        childNode.action = action; // test-only legacy mode retains the full action
      }
      nodesById.set(childNode.id, childNode);
      registry.set(key, childNode);
      accepted += 1;
      if (digestExpandedKeys) acceptedKeys.push(key);
      return childNode;
    };

    // Seed the guided view when the evaluator is ON.
    if (evaluatorOn) {
      const t0 = Date.now();
      const score = evaluator.rank(rootNode.state, []);
      evaluatorWallMs += Date.now() - t0;
      evaluatorCalls += 1;
      heapPush({ nodeId: rootNode.id, score: Number(score) || 0 });
    }

    // ---- main loop ----
    for (;;) {
      if (!budgetLeft()) break;
      sampleRss();
      if (stoppedReason) break;

      // Pick the next node via lightweight handles; resolve to record on pop.
      let nodeRecord = null;
      const neutralDue = !evaluatorOn || neutralSinceGuided >= NEUTRAL_EVERY || guidedHeap.length === 0;
      if (neutralDue && neutralHead < neutralQueue.length) {
        while (neutralHead < neutralQueue.length) {
          const candidateId = neutralQueue[neutralHead];
          neutralHead += 1;
          if (expanded.has(candidateId)) {
            staleEntriesSkipped += 1;
            continue;
          }
          const candidate = nodesById.get(candidateId);
          if (candidate && !candidate.closed) {
            nodeRecord = candidate;
            break;
          }
          staleEntriesSkipped += 1;
        }
        if (nodeRecord) neutralSinceGuided = 0;
      }
      if (!nodeRecord && evaluatorOn && guidedHeap.length > 0) {
        while (guidedHeap.length > 0) {
          const entry = heapPop();
          if (expanded.has(entry.nodeId)) {
            staleEntriesSkipped += 1;
            continue;
          }
          const candidate = nodesById.get(entry.nodeId);
          if (candidate && !candidate.closed) {
            nodeRecord = candidate;
            break;
          }
          staleEntriesSkipped += 1;
        }
        if (nodeRecord) neutralSinceGuided += 1;
      }
      if (!nodeRecord) {
        break;
      }

      // Goal check BEFORE expansion (identical for both arms).
      if (nodeRecord.state && isGoalState(nodeRecord.state)) {
        goalNode = nodeRecord;
        break;
      }

      // Expand: ALL legal actions generated in BOTH arms (P1-1).
      expanded.add(nodeRecord.id);
      expansions += 1;
      {
        const floorId = nodeRecord.state.floorId;
        const match = /^MT(\d+)$/.exec(String(floorId || ""));
        const ordinal = match ? Number(match[1]) : 0;
        deepestFloorHistogram[floorId] = (deepestFloorHistogram[floorId] || 0) + 1;
        if (ordinal > deepestFloorOrdinal) deepestFloorOrdinal = ordinal;
      }
      if (digestExpandedKeys) expandedKeys.push(nodeRecord.key);

      let actions = [];
      try {
        actions = enumerateActions(nodeRecord.state);
      } catch (_) {
        actions = [];
      }

      // Region restriction (shared config, identical in both arms).
      if (allowedFloors) {
        actions = actions.filter((action) => {
          const actionFloor = action.floorId || nodeRecord.state.floorId;
          if (!allowedFloors.has(actionFloor)) return false;
          if (action.changeFloor && action.changeFloor.floorId
            && action.changeFloor.floorId !== ":next" && action.changeFloor.floorId !== ":before") {
            return allowedFloors.has(action.changeFloor.floorId);
          }
          return true;
        });
      }

      // Rank successors when the evaluator is ON (priority only).
      if (evaluatorOn && actions.length > 0) {
        const children = [];
        for (const action of actions) {
          let nextState = null;
          try {
            nextState = simulator.applyAction(nodeRecord.state, action, { storeRoute: false });
          } catch (_) {
            nextState = null;
          }
          if (!nextState || !nextState.hero || (nextState.hero.hp != null && nextState.hero.hp <= 0)) {
            continue;
          }
          children.push({ action, nextState });
        }
        generated += children.length;

        const childScores = [];
        for (const child of children) {
          const t0 = Date.now();
          const score = evaluator.rank(child.nextState, []);
          evaluatorWallMs += Date.now() - t0;
          evaluatorCalls += 1;
          childScores.push(Number(score) || 0);
        }
        if (onTrace) {
          onTrace({
            expansion: expansions,
            nodeId: nodeRecord.id,
            actionCount: actions.length,
            generated: children.length,
            childScores: childScores.slice(0, 12),
          });
        }

        for (let ci = 0; ci < children.length; ci += 1) {
          const child = children[ci];
          const childNode = acceptChild(nodeRecord, child.action, child.nextState);
          if (!childNode) continue;
          neutralQueue.push(childNode.id);
          heapPush({ nodeId: childNode.id, score: childScores[ci] });
        }
      } else {
        for (const action of actions) {
          let nextState = null;
          try {
            nextState = simulator.applyAction(nodeRecord.state, action, { storeRoute: false });
          } catch (_) {
            nextState = null;
          }
          if (!nextState || !nextState.hero || (nextState.hero.hp != null && nextState.hero.hp <= 0)) {
            continue;
          }
          generated += 1;
          const childNode = acceptChild(nodeRecord, action, nextState);
          if (!childNode) continue;
          neutralQueue.push(childNode.id);
        }
      }

      // MEMORY REDUCTION (Iteration 2 Repair 1): this node is now CLOSED.
      // Release full state AND full action (compact mode). In legacy mode
      // (test-only), retain both for G33 comparison.
      nodeRecord.closed = true;
      if (!useLegacyRepresentation) {
        nodeRecord.state = null;
        nodeRecord.action = undefined; // ensure no indirect retention
      }
    }

    // ---- route reconstruction (compact parent chain) ----
    let route = null;
    let finalState = null;
    if (goalNode) {
      const entries = [];
      let cursor = goalNode;
      while (cursor && cursor.parentId != null) {
        entries.push(cursor.actionSummary || "unknown");
        cursor = nodesById.get(cursor.parentId);
      }
      entries.reverse();
      route = entries;
      finalState = goalNode.state; // goal node is not closed (found before expansion)
    }

    // Memory telemetry (Iteration 2).
    let fullStatesRetained = 0;
    let fullActionsRetained = 0;
    let closedNodes = 0;
    let openNodes = 0;
    registry.forEach((record) => {
      if (record.closed) {
        closedNodes += 1;
        if (record.state) fullStatesRetained += 1;
        if (record.action) fullActionsRetained += 1;
      } else {
        openNodes += 1;
        if (record.state) fullStatesRetained += 1;
        if (record.action) fullActionsRetained += 1;
      }
    });
    const queuedFrontierHandles = (neutralQueue.length - neutralHead) + guidedHeap.length;

    const frontierOpen = queuedFrontierHandles > 0;
    const searchComplete = !goalNode && !stoppedReason && !frontierOpen;

    return {
      found: Boolean(goalNode),
      route,
      finalState,
      expansions,
      generated,
      accepted,
      duplicatesSkipped,
      staleEntriesSkipped,
      registrySize: registry.size,
      stoppedReason,
      searchComplete,
      wallMs: Date.now() - startedAt,
      evaluatorOn,
      evaluatorCalls,
      evaluatorWallMs,
      peakRssMb: Math.round(peakRssMb * 10) / 10,
      deepestFloorOrdinal,
      deepestFloorHistogram,
      // Iteration 2 memory telemetry
      memory: {
        fullStatesRetained,
        fullActionsRetained,
        closedNodes,
        openNodes,
        queuedFrontierHandles,
        rssPerAccepted: accepted > 0 ? Number((peakRssMb / accepted).toFixed(3)) : null,
        rssPerOpen: openNodes > 0 ? Number((peakRssMb / openNodes).toFixed(3)) : null,
      },
      // G33 digest data (only when trackKeyDigest=true)
      ...(digestExpandedKeys ? { digest: { expandedKeys, acceptedKeys, duplicateDecisionKeys } } : {}),
    };
  }

  return { search };
}

module.exports = {
  createEventForwardSearch,
  NEUTRAL_EVERY,
};
