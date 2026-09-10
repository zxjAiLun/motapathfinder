"use strict";

/**
 * PR-5.25l — Transport-Collapsed Irreversible Decision Search.
 *
 * The ONLY primary change versus PR-5.25a:
 *
 *   EVERY_PRIMITIVE_EVENT_IS_A_SEARCH_BRANCH
 *   ->
 *   TRANSPORT_ONLY_ACTIONS_FORM_LOCAL_CLOSURE
 *   AND_ONLY_STATE_CHANGING_ACTIONS_BRANCH
 *
 * PR-5.25i measured why that matters: on-policy rollouts spent 98.6% of their
 * floor changes immediately reversing, and the MT2->MT3 stair was available in
 * only 2% of MT2 decisions, so the search kept paying a strategic branch for
 * navigation that changes nothing.
 *
 * Transport is decided by the SIMULATED STATE DELTA, never by action kind:
 * `transportSignature(before) === transportSignature(after)` means transport-only.
 * A `changeFloor` that triggers firstArrive / a flag / an item / a tile mutation
 * therefore remains a strategic branch. An `irreversibleKinds` whitelist would
 * silently swallow those.
 *
 * Boundaries:
 *   MACRO_SEARCH_IS_CORRECTNESS_SOURCE = FALSE
 *   SIMULATOR = LEGALITY_SOURCE
 *   STRICT_REPLAY = FINAL_AUTHORITY
 *   GLOBAL_STATE_MERGE = NONE — every strategic successor is registered by its
 *     own exact state key; no SCC canonicalization, no world-state quotient and
 *     no dominance merge in this iteration.
 *   HEURISTIC = NONE, LEARNED_POLICY = NONE, MANUAL_SUBGOALS = NONE, ROUTE_HINTS = NONE.
 *
 * The transport closure is only a *successor generator*. One-way stairs are safe
 * by construction, because a closure only ever follows directions that actually
 * apply from the current state; it never assumes it can come back.
 */

const { buildStateKey } = require("./state-key");
const { cloneState, listFloorMutationSummary } = require("./state");

/**
 * Flag keys that describe navigation position or pure caches rather than world
 * state. `__leaveLoc__` records where the hero stepped off each floor, so it
 * changes on every floor change and must not make transport look strategic;
 * `__frontierFeatures` is a search cache.
 */
const TRANSPORT_IGNORED_FLAG_KEYS = new Set(["__leaveLoc__", "__frontierFeatures"]);

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const body = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",");
    return `{${body}}`;
  }
  if (value === undefined) return "null";
  return JSON.stringify(value);
}

function stableObject(object) {
  return Object.keys(object || {})
    .sort()
    .reduce((result, key) => {
      const value = object[key];
      if (value == null) return result;
      if (value === 0) return result;
      result[key] = value;
      return result;
    }, {});
}

function stableFlags(flags) {
  return Object.keys(flags || {})
    .sort()
    .reduce((result, key) => {
      if (TRANSPORT_IGNORED_FLAG_KEYS.has(key)) return result;
      // Other double-underscore keys are internal caches; `*_buff__` is game
      // state and must never be dropped.
      if (key.startsWith("__") && !key.endsWith("_buff__")) return result;
      const value = flags[key];
      if (value == null || value === 0) return result;
      result[key] = value;
      return result;
    }, {});
}

function flatPairs(object) {
  return Object.keys(object || {})
    .sort()
    .map((key) => {
      const value = object[key];
      return `${key}=${value && typeof value === "object" ? canonicalJson(value) : value}`;
    })
    .join(";");
}

/**
 * Everything a pure navigation move is allowed to change is excluded; everything
 * the world can remember is included.
 *
 * Excluded: current floor, hero position/direction, route, notes, meta counters
 * and the derived `progress` cache.
 * Included: hero stats/equipment/followers, inventory, flags (minus navigation
 * and caches), `visitedFloors` (the first-arrival signal), tile/door/enemy
 * mutations and triggered auto events.
 *
 * Built by flat string concatenation rather than recursive canonical JSON: this
 * runs several times per generated action, so its cost is on the critical path.
 */
function transportSignature(state) {
  const hero = state.hero || {};
  return [
    hero.hp,
    hero.hpmax,
    hero.mana,
    hero.manamax,
    hero.atk,
    hero.def,
    hero.mdef,
    hero.money,
    hero.exp,
    hero.lv,
    Array.isArray(hero.equipment) ? hero.equipment.join(",") : "",
    Array.isArray(hero.followers) ? hero.followers.join(",") : "",
    "|",
    flatPairs(stableObject(state.inventory)),
    "|",
    flatPairs(stableFlags(state.flags)),
    "|",
    Object.keys(state.visitedFloors || {}).sort().join(","),
    "|",
    JSON.stringify(listFloorMutationSummary(state.floorStates || {})),
    "|",
    flatPairs(stableObject(state.triggeredAutoEvents)),
  ].join("~");
}

function summaryOf(action) {
  return action ? action.summary || action.kind || "unknown" : "unknown";
}

function createTransportCollapsedSearch(simulator) {
  const enumerateActions = (state) => {
    const result = simulator.enumeratePrimitiveActions(state);
    return (result && result.actions) || [];
  };

  /**
   * options:
   *   initialState        canonical start state (route stripped)
   *   isGoalState(state)  terminal predicate
   *   allowedFloors       region restriction (optional; null = all)
   *   maxExpansions       ceiling on STRATEGIC expansions
   *   maxClosureStates    ceiling on transport states per closure (guard)
   *   maxRuntimeMs        wall ceiling
   *   maxRssMb            RSS ceiling (0 = unlimited)
   *   onTrace             optional (record) => {} hook
   */
  function search(initialState, options) {
    const config = options || {};
    const allowedFloors = Array.isArray(config.allowedFloors) ? new Set(config.allowedFloors) : null;
    const maxExpansions = Number(config.maxExpansions || 100000);
    const maxClosureStates = Number(config.maxClosureStates || 20000);
    const maxRuntimeMs = Number(config.maxRuntimeMs || 0);
    const maxRssMb = Number(config.maxRssMb || 0);
    const isGoalState = typeof config.isGoalState === "function"
      ? config.isGoalState
      : (state) => simulator.isTerminal(state);
    const onTrace = typeof config.onTrace === "function" ? config.onTrace : null;

    const startedAt = Date.now();
    let stoppedReason = null;
    let peakRssMb = 0;

    const rootState = cloneState(initialState);
    rootState.route = [];
    if (!rootState.meta) rootState.meta = {};
    const rootNode = {
      id: 1,
      parentId: null,
      state: rootState,
      key: buildStateKey(rootState),
      macroChain: [],
      depth: 0,
    };

    const nodesById = new Map([[rootNode.id, rootNode]]);
    const registry = new Map([[rootNode.key, rootNode]]);
    const frontier = [rootNode.id];
    let frontierHead = 0;
    let nextNodeId = 2;

    let strategicExpansions = 0;
    let strategicBranches = 0;
    let exactSuccessors = 0;
    let duplicatesSkipped = 0;
    let deadEndActions = 0;
    let transportClosureVisited = 0;
    let transportClosureExpansionRuns = 0;
    let transportActionsAbsorbed = 0;
    let closureTruncations = 0;
    // Mechanism explanation only: how much of the wall goes into deciding
    // transport-vs-strategic. The abstraction only pays off if the branching it
    // removes costs more than these deltas.
    let signatureCalls = 0;
    let signatureWallMs = 0;
    let deepestFloorOrdinal = 0;
    let deepestStrategicDepth = 0;
    const deepestFloorHistogram = {};
    let goalNode = null;

    const sampleRss = () => {
      if (maxRssMb <= 0) return;
      const rssMb = process.memoryUsage().rss / (1024 * 1024);
      if (rssMb > peakRssMb) peakRssMb = rssMb;
      if (rssMb >= maxRssMb) stoppedReason = "rss-limit";
    };

    const budgetLeft = () => {
      if (stoppedReason) return false;
      if (strategicExpansions >= maxExpansions) {
        stoppedReason = "expansion-limit";
        return false;
      }
      if (maxRuntimeMs > 0 && Date.now() - startedAt >= maxRuntimeMs) {
        stoppedReason = "time-limit";
        return false;
      }
      return true;
    };

    const allowedActions = (state) => {
      let actions = enumerateActions(state);
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
    };

    const recordNode = (node) => {
      const floorId = node.state.floorId;
      const match = /^MT(\d+)$/.exec(String(floorId || ""));
      const ordinal = match ? Number(match[1]) : 0;
      deepestFloorHistogram[floorId] = (deepestFloorHistogram[floorId] || 0) + 1;
      if (ordinal > deepestFloorOrdinal) deepestFloorOrdinal = ordinal;
      if (node.depth > deepestStrategicDepth) deepestStrategicDepth = node.depth;
    };

    /**
     * Local transport closure, used purely as a successor generator.
     *
     * A per-closure exact-key visited set is sound here: two states with the same
     * exact key are the same world state, so their closure is identical. Nothing
     * is merged globally — only the strategic successors are registered.
     *
     * Each entry carries its own signature, and the per-closure map memoises by
     * exact key, so no state is signatured twice inside one closure and the
     * already-applied successor state is handed to the caller instead of being
     * applied a second time.
     */
    const transportClosure = (startState, startKey) => {
      const signaturesByKey = new Map();
      signaturesByKey.set(startKey, transportSignature(startState));
      const visited = new Map();
      visited.set(startKey, { state: startState, chain: [] });
      const queue = [{ state: startState, chain: [], signature: signaturesByKey.get(startKey) }];
      let head = 0;
      const strategic = [];
      let absorbed = 0;
      let truncated = false;
      let closureSignatureCalls = 0;
      let closureSignatureWallMs = 0;

      const signatureFor = (key, state) => {
        const cached = signaturesByKey.get(key);
        if (cached !== undefined) return cached;
        const t0 = Date.now();
        const signature = transportSignature(state);
        closureSignatureWallMs += Date.now() - t0;
        closureSignatureCalls += 1;
        signaturesByKey.set(key, signature);
        return signature;
      };

      while (head < queue.length) {
        if (!budgetLeft()) break;
        if (visited.size > maxClosureStates) {
          truncated = true;
          break;
        }
        const entry = queue[head];
        head += 1;
        for (const action of allowedActions(entry.state)) {
          let next = null;
          try {
            next = simulator.applyAction(entry.state, action, { storeRoute: false });
          } catch (_) {
            next = null;
          }
          if (!next || !next.hero || (next.hero.hp != null && next.hero.hp <= 0)) {
            deadEndActions += 1;
            continue;
          }
          const key = buildStateKey(next);
          const signature = signatureFor(key, next);
          if (signature === entry.signature) {
            absorbed += 1;
            if (visited.has(key)) continue;
            const child = { state: next, chain: entry.chain.concat([summaryOf(action)]) };
            visited.set(key, child);
            queue.push({ state: next, chain: child.chain, signature });
          } else {
            strategic.push({ state: entry.state, chain: entry.chain, action, next, key });
          }
        }
      }
      return { states: visited, strategic, absorbed, truncated, expansionRuns: queue.length, signatureCalls: closureSignatureCalls, signatureWallMs: closureSignatureWallMs };
    };

    while (budgetLeft()) {
      sampleRss();
      if (stoppedReason) break;

      let node = null;
      while (frontierHead < frontier.length) {
        const candidate = nodesById.get(frontier[frontierHead]);
        frontierHead += 1;
        if (candidate) {
          node = candidate;
          break;
        }
      }
      if (!node) break;

      if (isGoalState(node.state)) {
        goalNode = node;
        break;
      }

      recordNode(node);
      strategicExpansions += 1;
      const closure = transportClosure(node.state, node.key);
      transportClosureVisited += closure.states.size;
      transportClosureExpansionRuns += closure.expansionRuns;
      transportActionsAbsorbed += closure.absorbed;
      if (closure.truncated) closureTruncations += 1;
      signatureCalls += closure.signatureCalls;
      signatureWallMs += closure.signatureWallMs;

      if (onTrace) {
        onTrace({
          strategicExpansion: strategicExpansions,
          nodeId: node.id,
          closureStates: closure.states.size,
          transportActionsAbsorbed: closure.absorbed,
          strategicActions: closure.strategic.length,
        });
      }

      for (const candidate of closure.strategic) {
        strategicBranches += 1;
        const next = candidate.next;
        if (registry.has(candidate.key)) {
          duplicatesSkipped += 1;
          continue;
        }
        const child = {
          id: nextNodeId++,
          parentId: node.id,
          state: next,
          key: candidate.key,
          // The full replay chain: transport summaries then the strategic action.
          // Macro search is not the correctness source, but the chain must be
          // complete for strict replay to be the final authority.
          macroChain: candidate.chain.concat([summaryOf(candidate.action)]),
          depth: node.depth + 1,
        };
        nodesById.set(child.id, child);
        registry.set(child.key, child);
        frontier.push(child.id);
        exactSuccessors += 1;
      }

      // CLOSED: release the full state, keep only the chain-relevant fields.
      node.closed = true;
      node.state = null;
    }

    let route = null;
    let finalState = null;
    if (goalNode) {
      const chain = [];
      let cursor = goalNode;
      const segments = [];
      while (cursor && cursor.parentId != null) {
        segments.push(cursor.macroChain || []);
        cursor = nodesById.get(cursor.parentId);
      }
      segments.reverse();
      for (const segment of segments) chain.push(...segment);
      route = chain;
      finalState = goalNode.state;
    }

    const frontierOpen = frontier.length - frontierHead > 0;
    return {
      found: Boolean(goalNode),
      route,
      finalState,
      // strategic search accounting
      strategicExpansions,
      strategicBranches,
      exactSuccessors,
      duplicatesSkipped,
      deadEndActions,
      registrySize: registry.size,
      deepestStrategicDepth,
      // transport-collapse accounting (mechanism explanation only)
      transportClosureVisited,
      transportClosureExpansionRuns,
      transportActionsAbsorbed,
      signatureCalls,
      signatureWallMs,
      closureTruncations,
      deepestFloorOrdinal,
      deepestFloorHistogram,
      stoppedReason,
      searchComplete: !goalNode && !stoppedReason && !frontierOpen,
      wallMs: Date.now() - startedAt,
      peakRssMb: Math.round(peakRssMb * 10) / 10,
      maxClosureStates,
    };
  }

  return { search };
}

module.exports = {
  canonicalJson,
  createTransportCollapsedSearch,
  flatPairs,
  stableFlags,
  transportSignature,
};
