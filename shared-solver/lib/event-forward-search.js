"use strict";

/**
 * PR-5.25a — Event-Level Forward Search core.
 *
 * A unified forward search over REAL exact states:
 *   node = full canonical state (hero/inventory/flags/mutations/floor/location)
 *   edge = one decision-significant simulator action (reachability folds plain moves)
 *
 * Architecture boundaries (PR-5.25a design, Cloud-Review approved):
 *   - search core → existing simulator (NOT planner → segment DP → repair)
 *   - the evaluator only affects PRIORITY, never successor existence
 *     (P1-1: legal action sets are identical with the evaluator OFF and ON)
 *   - one single exact-state registry; the guided and neutral queues are two
 *     scheduling views over the SAME nodes (P1-2). A node expanded once is
 *     never expanded again (no reopen in Iteration 1); stale entries in the
 *     other view are skipped.
 *   - dual-queue age-term exploration contract:
 *       EVALUATOR_CAN_PRIORITIZE = TRUE
 *       EVALUATOR_CAN_PERMANENTLY_STARVE_ACCEPTED_STATE = FALSE
 *     every NEUTRAL_EVERY guided pops, at least one neutral (FIFO) pop happens.
 *   - OFF/ON arms are byte-identical in exact key, duplicate policy, accepted
 *     registry, action generation, budget accounting, retention and goal check
 *     (P1-4); the ONLY difference is pop order via the evaluator priority.
 *   - no repair, no subgoals, no failure learning, no cross-state backjump.
 */

const { buildStateKey } = require("./state-key");
const { cloneState } = require("./state");

const NEUTRAL_EVERY = 8; // frozen Iteration-1 value (no sweep)

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
   *                       PRIORITY ONLY — never filters/creates actions.
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
    const rootNode = {
      id: 1,
      parentId: null,
      state: rootState,
      key: buildStateKey(rootState),
      action: null,
      depth: 0,
      enqueuedAtExpansion: 0,
    };

    // ---- single exact registry (P1-2) ----
    const registry = new Map(); // exactKey -> node (expanded or accepted-pending)
    registry.set(rootNode.key, rootNode);

    // ---- two scheduling views over the same nodes ----
    // guided: max-heap by evaluator score (only when evaluator ON)
    // neutral: FIFO by acceptance order
    const guidedHeap = []; // array-backed binary heap of { node, score }
    const neutralQueue = [rootNode];
    const expanded = new Set(); // node ids expanded exactly once
    let neutralSinceGuided = 0; // guided pops since last neutral pop

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

    // Seed the guided view when the evaluator is ON (the root participates too).
    if (evaluatorOn) {
      const t0 = Date.now();
      const score = evaluator.rank(rootNode.state, []);
      evaluatorWallMs += Date.now() - t0;
      evaluatorCalls += 1;
      heapPush({ node: rootNode, score: Number(score) || 0 });
    }

    // ---- main loop ----
    for (;;) {
      if (!budgetLeft()) break;
      sampleRss();
      if (stoppedReason) break;

      // Pick the next node: neutral every NEUTRAL_EVERY guided pops, or when
      // the guided view is empty (exploration contract: no permanent starvation).
      let node = null;
      const neutralDue = !evaluatorOn || neutralSinceGuided >= NEUTRAL_EVERY || guidedHeap.length === 0;
      if (neutralDue && neutralQueue.length > 0) {
        while (neutralQueue.length > 0) {
          const candidate = neutralQueue.shift();
          if (expanded.has(candidate.id)) {
            staleEntriesSkipped += 1; // already expanded via the other view
            continue;
          }
          node = candidate;
          break;
        }
        if (node) neutralSinceGuided = 0;
      }
      if (!node && evaluatorOn && guidedHeap.length > 0) {
        while (guidedHeap.length > 0) {
          const entry = heapPop();
          if (expanded.has(entry.node.id)) {
            staleEntriesSkipped += 1;
            continue;
          }
          node = entry.node;
          break;
        }
        if (node) neutralSinceGuided += 1;
      }
      if (!node) {
        // both views exhausted
        if (neutralQueue.length === 0 && guidedHeap.length === 0) {
          stoppedReason = stoppedReason || null; // natural exhaustion
        }
        break;
      }

      // Goal check BEFORE expansion (identical for both arms).
      if (isGoalState(node.state)) {
        goalNode = node;
        break;
      }

      // Expand: ALL legal actions are generated in BOTH arms (P1-1). The
      // evaluator only chooses the priority of the successors.
      expanded.add(node.id);
      expansions += 1;

      let actions = [];
      try {
        actions = enumerateActions(node.state);
      } catch (_) {
        actions = [];
      }

      // Region restriction is part of the shared config, identical in both arms.
      if (allowedFloors) {
        actions = actions.filter((action) => {
          const actionFloor = action.floorId || node.state.floorId;
          if (!allowedFloors.has(actionFloor)) return false;
          if (action.changeFloor && action.changeFloor.floorId
            && action.changeFloor.floorId !== ":next" && action.changeFloor.floorId !== ":before") {
            return allowedFloors.has(action.changeFloor.floorId);
          }
          return true;
        });
      }

      // Rank successors when the evaluator is ON (priority only).
      let scoredChildren = null;
      if (evaluatorOn && actions.length > 0) {
        // Build child states first (identical generation in both arms).
        scoredChildren = [];
        for (const action of actions) {
          let nextState = null;
          try {
            nextState = simulator.applyAction(node.state, action, { storeRoute: false });
          } catch (_) {
            nextState = null;
          }
          if (!nextState || !nextState.hero || (nextState.hero.hp != null && nextState.hero.hp <= 0)) {
            continue;
          }
          scoredChildren.push({ action, nextState });
        }
        generated += scoredChildren.length;

        // Evaluate each child ONCE for priority (cost counted in treatment).
        const childScores = [];
        for (const child of scoredChildren) {
          const t0 = Date.now();
          const score = evaluator.rank(child.nextState, []);
          evaluatorWallMs += Date.now() - t0;
          evaluatorCalls += 1;
          childScores.push(Number(score) || 0);
        }
        if (onTrace) {
          onTrace({
            expansion: expansions,
            nodeId: node.id,
            actionCount: actions.length,
            generated: scoredChildren.length,
            childScores: childScores.slice(0, 12),
          });
        }

        // Accept in score order into the guided view; neutral FIFO gets them
        // in generation order regardless (both views over the same nodes).
        const order = scoredChildren.map((child, idx) => ({ child, idx, score: childScores[idx] }));
        for (const { child, score } of order) {
          const key = buildStateKey(child.nextState);
          if (registry.has(key)) {
            duplicatesSkipped += 1;
            continue;
          }
          const childNode = {
            id: nextNodeId++,
            parentId: node.id,
            parent: node,
            state: child.nextState,
            key,
            action: child.action,
            depth: node.depth + 1,
            enqueuedAtExpansion: expansions,
          };
          registry.set(key, childNode);
          accepted += 1;
          neutralQueue.push(childNode); // generation order (shared)
          heapPush({ node: childNode, score }); // priority order (treatment)
        }
      } else {
        // CONTROL arm (and treatment fallback): plain generation-order acceptance.
        for (const action of actions) {
          let nextState = null;
          try {
            nextState = simulator.applyAction(node.state, action, { storeRoute: false });
          } catch (_) {
            nextState = null;
          }
          if (!nextState || !nextState.hero || (nextState.hero.hp != null && nextState.hero.hp <= 0)) {
            continue;
          }
          generated += 1;
          const key = buildStateKey(nextState);
          if (registry.has(key)) {
            duplicatesSkipped += 1;
            continue;
          }
          const childNode = {
            id: nextNodeId++,
            parentId: node.id,
            parent: node,
            state: nextState,
            key,
            action,
            depth: node.depth + 1,
            enqueuedAtExpansion: expansions,
          };
          registry.set(key, childNode);
          accepted += 1;
          neutralQueue.push(childNode);
        }
      }
    }

    // ---- route reconstruction (parent object references kept on nodes) ----
    let route = null;
    let finalState = null;
    if (goalNode) {
      const entries = [];
      let cursor = goalNode;
      while (cursor && cursor.parent != null) {
        entries.push(cursor.action ? cursor.action.summary || cursor.action.kind : "unknown");
        cursor = cursor.parent;
      }
      entries.reverse();
      route = entries;
      finalState = goalNode.state;
    }

    const frontierOpen = neutralQueue.length > 0 || guidedHeap.length > 0;
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
    };
  }

  // Wire parent references during search by monkey-patching the node creation
  // above is not possible; instead search() is self-contained. We expose a
  // helper to reconstruct the route from a found result via parent chain kept
  // on the nodes themselves (set at creation time).
  return { search };
}

module.exports = {
  createEventForwardSearch,
  NEUTRAL_EVERY,
};
