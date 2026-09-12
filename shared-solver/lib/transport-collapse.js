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
const { resolveRelativeFloor } = require("./floor-transitions");
const { createResourceSkylineSet, analyzeResourceVariantPressure } = require("./resource-skyline");
const { normalizeAction } = require("./route-store");

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

function actionToSemanticIdentity(action, state, nextState, project) {
  const floorId = action.floorId || (state && state.floorId) || "";
  const target = action.target || action.stance || {};
  const x = target.x;
  const y = target.y;
  if (action.kind === "battle") {
    return `battle:${floorId}:${x},${y}:${action.enemyId || ""}`;
  }
  if (action.kind === "openDoor") {
    return `door:${floorId}:${x},${y}:${action.doorId || ""}`;
  }
  if (action.kind === "pickup" || action.kind === "interactPickup") {
    return `item:${floorId}:${x},${y}:${action.itemId || ""}`;
  }
  if (action.kind === "changeFloor") {
    let targetFloor = (nextState && nextState.floorId) || (action.changeFloor && action.changeFloor.floorId) || "";
    if (project && typeof targetFloor === "string" && targetFloor.startsWith(":")) {
      try {
        targetFloor = resolveRelativeFloor(project, floorId, targetFloor);
      } catch (_) {
        // fallback
      }
    }
    return `changeFloor:${floorId}:${x},${y}->${targetFloor}`;
  }
  if (action.kind === "event") {
    return `event:${floorId}:${x},${y}`;
  }
  return `${action.kind}:${floorId}:${x},${y}`;
}

function poiToSemanticIdentity(poi, project) {
  const floorId = poi.floorId;
  const x = poi.x;
  const y = poi.y;
  if (poi.kind === "mutation") {
    return `mutation:${poi.hook || "hook"}:${floorId}:${poi.at || "arrival"}`;
  }
  if (poi.kind === "enemy") {
    return `battle:${floorId}:${x},${y}:${poi.tileId || ""}`;
  }
  if (poi.kind === "door") {
    return `door:${floorId}:${x},${y}:${poi.tileId || ""}`;
  }
  if (poi.kind === "item") {
    return `item:${floorId}:${x},${y}:${poi.tileId || ""}`;
  }
  if (poi.kind === "changeFloor") {
    let targetFloor = (poi.transition && poi.transition.targetFloorId) || (poi.transition && poi.transition.floorId) || "";
    if (project && typeof targetFloor === "string" && targetFloor.startsWith(":")) {
      try {
        targetFloor = resolveRelativeFloor(project, floorId, targetFloor);
      } catch (_) {
        // fallback
      }
    }
    return `changeFloor:${floorId}:${x},${y}->${targetFloor}`;
  }
  if (poi.kind === "event") {
    return `event:${floorId}:${x},${y}`;
  }
  return `${poi.kind}:${floorId}:${x},${y}`;
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

    const frontierSet = config.frontierSet instanceof Set ? config.frontierSet : null;
    const priorityMap = config.priorityMap instanceof Map ? config.priorityMap : null;
    const neutralEvery = config.neutralEvery == null ? 5 : Number(config.neutralEvery);
    const resourceSkylinePriority = config.resourceSkylinePriority === true;
    const skylineSet = resourceSkylinePriority ? createResourceSkylineSet() : null;

    const trackResourcePressure = config.trackResourcePressure === true;
    const mt2ExpandedStates = trackResourcePressure ? [] : null;

    // PR-5.25o bounded candidate search: cap on pending candidates.
    const pendingCandidateCap = Number.isFinite(config.pendingCandidateCap) && config.pendingCandidateCap > 0
      ? Math.floor(config.pendingCandidateCap)
      : null;
    const pending = [];
    let pendingSeq = 0;

    /**
     * PR-5.25o retention rank: lower is retained.
     *
     * Deliberately inherits ordering information the search already has.
     * No new score and no hand-authored weights.
     */
    const pendingRank = (node) => {
      if (node.rankValue != null) return node.rankValue;
      let rank = 30;
      if (node.state && isGoalState(node.state)) rank = 0;
      else if (node.frontierGuided) rank = 10;
      else if (node.paretoAdmitted) rank = 20;
      node.rankValue = rank;
      return rank;
    };
    let frontierHead = 0;

    // CONTROL: pure FIFO
    const frontier = frontierSet ? null : [rootNode.id];

    // TREATMENT: bounded-fair dual queue
    const guidedHeap = frontierSet ? [] : null;
    const neutralQueue = frontierSet ? [rootNode.id] : null;
    let neutralHead = 0;
    const expanded = frontierSet ? new Set() : null;
    let neutralSinceGuided = 0;
    let guidedExpansions = 0;
    let neutralExpansions = 0;

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

    let strategicExpansions = 0;
    let strategicBranches = 0;
    let exactSuccessors = 0;
    let duplicatesSkipped = 0;
    let candidatesDropped = 0;
    let deadEndActions = 0;
    let transportClosureVisited = 0;
    let transportClosureExpansionRuns = 0;
    let transportActionsAbsorbed = 0;
    let closureTruncations = 0;
    let closureStateVisitsTotal = 0;
    const globalClosureExactKeys = new Set();
    const closureExactKeyVisitCounts = new Map();
    // Mechanism explanation only: how much of the wall goes into deciding
    // transport-vs-strategic. The abstraction only pays off if the branching it
    // removes costs more than these deltas.
    let signatureCalls = 0;
    let signatureWallMs = 0;
    let deepestFloorOrdinal = 0;
    let deepestReachedFloorOrdinal = 0;
    let deepestStrategicDepth = 0;
    const deepestFloorHistogram = {};
    const deepestReachedFloorHistogram = {};
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

    const recordReachedNode = (node) => {
      const floorId = node.state.floorId;
      const match = /^MT(\d+)$/.exec(String(floorId || ""));
      const ordinal = match ? Number(match[1]) : 0;
      deepestReachedFloorHistogram[floorId] = (deepestReachedFloorHistogram[floorId] || 0) + 1;
      if (ordinal > deepestReachedFloorOrdinal) deepestReachedFloorOrdinal = ordinal;
    };

    const recordNode = (node) => {
      recordReachedNode(node);
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
      visited.set(startKey, { state: startState, chain: [], trace: [] });
      const queue = [{ state: startState, chain: [], trace: [], signature: signaturesByKey.get(startKey) }];
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
            const child = {
              state: next,
              chain: entry.chain.concat([summaryOf(action)]),
              trace: entry.trace.concat([{ action: normalizeAction(action), postExactStateKey: key }]),
            };
            visited.set(key, child);
            queue.push({ state: next, chain: child.chain, trace: child.trace, signature });
          } else {
            strategic.push({ state: entry.state, chain: entry.chain, trace: entry.trace, action, next, key });
          }
        }
      }
      return { states: visited, strategic, absorbed, truncated, expansionRuns: queue.length, signatureCalls: closureSignatureCalls, signatureWallMs: closureSignatureWallMs };
    };

    while (budgetLeft()) {
      sampleRss();
      if (stoppedReason) break;

      let node = null;
      if (!frontierSet) {
        while (frontierHead < frontier.length) {
          const candidate = nodesById.get(frontier[frontierHead]);
          frontierHead += 1;
          if (candidate) {
            node = candidate;
            break;
          }
        }
      } else {
        while (true) {
          const neutralDue = neutralSinceGuided >= neutralEvery || guidedHeap.length === 0;
          let candidateId = null;
          if (neutralDue && neutralHead < neutralQueue.length) {
            candidateId = neutralQueue[neutralHead++];
            if (candidateId && !expanded.has(candidateId)) {
              const candidate = nodesById.get(candidateId);
              if (candidate && !candidate.closed) {
                node = candidate;
                neutralSinceGuided = 0;
                neutralExpansions += 1;
                break;
              }
            }
          } else if (guidedHeap.length > 0) {
            const entry = heapPop();
            if (entry && !expanded.has(entry.nodeId)) {
              const candidate = nodesById.get(entry.nodeId);
              if (candidate && !candidate.closed) {
                node = candidate;
                neutralSinceGuided += 1;
                guidedExpansions += 1;
                break;
              }
            }
          } else if (neutralHead < neutralQueue.length) {
            candidateId = neutralQueue[neutralHead++];
            if (candidateId && !expanded.has(candidateId)) {
              const candidate = nodesById.get(candidateId);
              if (candidate && !candidate.closed) {
                node = candidate;
                neutralSinceGuided = 0;
                neutralExpansions += 1;
                break;
              }
            }
          } else {
            break;
          }
        }
        if (node) {
          expanded.add(node.id);
          const at = pending.indexOf(node.id);
          if (at >= 0) pending.splice(at, 1);
        }
      }
      if (!node) break;
      if (trackResourcePressure && node.state && node.state.floorId === "MT2") {
        mt2ExpandedStates.push({ id: node.id, key: node.key, state: cloneState(node.state) });
      }

      if (isGoalState(node.state)) {
        recordReachedNode(node);
        goalNode = node;
        break;
      }

      recordNode(node);
      strategicExpansions += 1;
      const closure = transportClosure(node.state, node.key);
      transportClosureVisited += closure.states.size;
      transportClosureExpansionRuns += closure.expansionRuns;
      transportActionsAbsorbed += closure.absorbed;
      closureStateVisitsTotal += closure.states.size;
      for (const key of closure.states.keys()) {
        globalClosureExactKeys.add(key);
        closureExactKeyVisitCounts.set(key, (closureExactKeyVisitCounts.get(key) || 0) + 1);
      }
      if (closure.truncated) {
        closureTruncations += 1;
        if (!stoppedReason) stoppedReason = "closure-limit";
      }
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
          // PR-5.25o Repair 1: structured replay trace. The summary string alone
          // cannot uniquely identify an action variant (several walk paths to the
          // same battle share one summary AND one fingerprint). Keep the
          // normalized action entry plus its resulting exact state key so the
          // existing route-store resolver can disambiguate on replay.
          macroTrace: candidate.trace.concat([
            { action: normalizeAction(candidate.action), postExactStateKey: candidate.key },
          ]),
          depth: node.depth + 1,
        };
        nodesById.set(child.id, child);
        registry.set(child.key, child);
        exactSuccessors += 1;
        child.frontierGuided = false;
        child.paretoAdmitted = false;
        child.pendingSeq = pendingSeq++;
        pending.push(child.id);

        if (!frontierSet) {
          frontier.push(child.id);
        } else {
          neutralQueue.push(child.id);
          const identity = actionToSemanticIdentity(candidate.action, candidate.state, candidate.next, simulator.project);
          if (frontierSet.has(identity)) {
            child.frontierGuided = true;
            let isDominated = false;
            if (resourceSkylinePriority) {
              const query = skylineSet.query(candidate.next, child.id, candidate.key);
              isDominated = query.isDominated;
              skylineSet.insert(candidate.next, child.id, candidate.key);
            }
            child.paretoAdmitted = !isDominated;
            if (!isDominated) {
              if (resourceSkylinePriority) child.paretoAdmitted = true;
              const score = (priorityMap && priorityMap.get(identity)) || 100;
              heapPush({ nodeId: child.id, score });
            }
          }
        }
      }

      // PR-5.25o: bounded candidate drop. Enforce the cap AFTER the expansion is
      // complete so the currently-expanded node's own children are never dropped
      // before they can ever be considered. Dropped candidates are removed from
      // BOTH the guided heap and the neutral queue — they never return.
      if (pendingCandidateCap != null && pending.length > pendingCandidateCap) {
        const scored = pending
          .map((id, index) => ({ id, index, node: nodesById.get(id) }))
          .filter((e) => e.node && !e.node.closed)
          .map((e) => ({ id: e.id, index: e.index, rank: pendingRank(e.node) }))
          .sort((a, b) => (a.rank - b.rank) || (a.index - b.index));
        const keep = new Set(scored.slice(0, pendingCandidateCap).map((e) => e.id));
        const droppedIds = scored.slice(pendingCandidateCap).map((e) => e.id);
        for (const id of droppedIds) {
          const dn = nodesById.get(id);
          if (dn) dn.dropped = true;
        }
        candidatesDropped += droppedIds.length;
        pending.length = 0;
        for (const e of scored) if (keep.has(e.id)) pending.push(e.id);
        if (guidedHeap) {
          for (let i = guidedHeap.length - 1; i >= 0; i -= 1) {
            if (!keep.has(guidedHeap[i].nodeId)) guidedHeap.splice(i, 1);
          }
        }
        if (neutralQueue) {
          for (let i = neutralQueue.length - 1; i >= neutralHead; i -= 1) {
            if (!keep.has(neutralQueue[i])) neutralQueue.splice(i, 1);
          }
        }
      }

      // CLOSED: release the full state, keep only the chain-relevant fields.
      node.closed = true;
      node.state = null;
    }

    let route = null;
    let routeTrace = null;
    let finalState = null;
    if (goalNode) {
      const chain = [];
      const trace = [];
      let cursor = goalNode;
      const segments = [];
      while (cursor && cursor.parentId != null) {
        segments.push({ chain: cursor.macroChain || [], trace: cursor.macroTrace || [] });
        cursor = nodesById.get(cursor.parentId);
      }
      segments.reverse();
      for (const segment of segments) {
        chain.push(...segment.chain);
        trace.push(...segment.trace);
      }
      route = chain;
      routeTrace = trace;
      finalState = goalNode.state;
    }

    const frontierOpen = frontierSet
      ? (guidedHeap.length > 0 || neutralQueue.length - neutralHead > 0)
      : (frontier.length - frontierHead > 0);
    const distinctClosureExactKeysGlobal = globalClosureExactKeys.size;
    const repeatedClosureExactKeyVisits = closureStateVisitsTotal - distinctClosureExactKeysGlobal;
    const repeatFraction = closureStateVisitsTotal > 0 ? repeatedClosureExactKeyVisits / closureStateVisitsTotal : 0;
    const topRepeatedExactKeys = [...closureExactKeyVisitCounts.entries()]
      .filter(([, count]) => count > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([key, count]) => ({ key, count }));

    const resourceVariantPressure = trackResourcePressure
      ? analyzeResourceVariantPressure(mt2ExpandedStates)
      : null;

    return {
      found: Boolean(goalNode),
      route,
      routeTrace,
      finalState,
      // strategic search accounting
      strategicExpansions,
      strategicBranches,
      exactSuccessors,
      duplicatesSkipped,
      candidatesDropped,
      pendingCandidateCap,
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
      closureStateVisitsTotal,
      distinctClosureExactKeysGlobal,
      repeatedClosureExactKeyVisits,
      repeatFraction,
      topRepeatedExactKeys,
      deepestFloorOrdinal,
      deepestFloorHistogram,
      deepestExpandedNonGoalFloorOrdinal: deepestFloorOrdinal,
      deepestExpandedNonGoalFloorHistogram: deepestFloorHistogram,
      deepestReachedFloorOrdinal,
      deepestReachedFloorHistogram,
      stoppedReason,
      guidedExpansions,
      neutralExpansions,
      resourceVariantPressure,
      searchComplete: !goalNode && !stoppedReason && !frontierOpen && closureTruncations === 0,
      wallMs: Date.now() - startedAt,
      peakRssMb: Math.round(peakRssMb * 10) / 10,
      maxClosureStates,
    };
  }

  return { search };
}

module.exports = {
  actionToSemanticIdentity,
  canonicalJson,
  createTransportCollapsedSearch,
  flatPairs,
  poiToSemanticIdentity,
  stableFlags,
  transportSignature,
};
