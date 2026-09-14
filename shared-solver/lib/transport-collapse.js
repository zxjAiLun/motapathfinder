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
const { createResourceSkylineSet, analyzeResourceVariantPressure, buildStructuralStateKey, extractResourceVector, paretoDominates } = require("./resource-skyline");
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

function mtFloorOrdinal(floorId) {
  const match = /^MT(\d+)$/.exec(String(floorId || ""));
  return match ? Number(match[1]) : 0;
}

/**
 * PR-5.25x combat-progress signal V1: a transition that itself produces
 * PERMANENT combat-stat growth. Pure state delta - no enemy IDs, no
 * coordinates, no oracle knowledge, no weights. EXP deliberately does NOT
 * qualify (almost every battle grants EXP; EXP-based admission would
 * re-flood the high-priority class with ordinary battles).
 */
function isCombatProgressTransition(before, after) {
  if (!before || !after || !before.hero || !after.hero) return false;
  const h0 = before.hero;
  const h1 = after.hero;
  const increased = (key) => h1[key] != null && h0[key] != null && h1[key] > h0[key];
  if (increased("atk") || increased("def") || increased("mdef") || increased("hpmax") || increased("lv")) return true;
  const equipmentBefore = Array.isArray(h0.equipment) ? h0.equipment.slice().sort().join(",") : "";
  const equipmentAfter = Array.isArray(h1.equipment) ? h1.equipment.slice().sort().join(",") : "";
  return equipmentBefore !== equipmentAfter;
}

/**
 * PR-5.26f - equal-score guided service order.
 *
 * `stableTieBreak` is opt-in. When FALSE the comparator must reproduce the
 * pre-5.26f behaviour exactly: equal scores are equivalent, so the heap keeps
 * whatever shape its push/pop cycles produce and a later equal-score entry can
 * be served before an older one. When TRUE the tie is broken by `pendingSeq`
 * ascending, i.e. registration order.
 *
 * This is a TIE-BREAK only. A higher score always wins with or without the
 * flag, so the heap never degenerates into a plain FIFO.
 */
function guidedComesBefore(a, b, stableTieBreak) {
  if (a.score !== b.score) return a.score > b.score;
  if (!stableTieBreak) return false;
  const aSeq = a.pendingSeq == null ? 0 : a.pendingSeq;
  const bSeq = b.pendingSeq == null ? 0 : b.pendingSeq;
  return aSeq < bSeq;
}

function guidedHeapPush(heap, entry, stableTieBreak) {
  heap.push(entry);
  let i = heap.length - 1;
  while (i > 0) {
    const parent = Math.floor((i - 1) / 2);
    if (!guidedComesBefore(heap[i], heap[parent], stableTieBreak)) break;
    const tmp = heap[parent];
    heap[parent] = heap[i];
    heap[i] = tmp;
    i = parent;
  }
}

function guidedHeapPop(heap, stableTieBreak) {
  if (heap.length === 0) return null;
  const top = heap[0];
  const last = heap.pop();
  if (heap.length > 0) {
    heap[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let best = i;
      if (l < heap.length && guidedComesBefore(heap[l], heap[best], stableTieBreak)) best = l;
      if (r < heap.length && guidedComesBefore(heap[r], heap[best], stableTieBreak)) best = r;
      if (best === i) break;
      const tmp = heap[i];
      heap[i] = heap[best];
      heap[best] = tmp;
      i = best;
    }
  }
  return top;
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
    // PR-5.25q: enumerated changeFloor actions carry no `target`; their `x`/`y`
    // IS the stair tile the macro-graph POI uses, while `stance` is only where
    // the hero stands. Resolve coordinates explicit target -> action x/y ->
    // stance so the identity matches poiToSemanticIdentity. Other kinds keep
    // the shared extraction above.
    const stairX = (action.target && action.target.x) ?? action.x ?? (action.stance && action.stance.x);
    const stairY = (action.target && action.target.y) ?? action.y ?? (action.stance && action.stance.y);
    return `changeFloor:${floorId}:${stairX},${stairY}->${targetFloor}`;
  }
  if (action.kind === "event") {
    // PR-5.25r: enumerated event actions carry no `target`; their `x`/`y` IS
    // the event tile the macro-graph POI uses, while `stance` is only where
    // the hero stands. Same resolution order as changeFloor so the identity
    // matches poiToSemanticIdentity.
    const eventX = (action.target && action.target.x) ?? action.x ?? (action.stance && action.stance.x);
    const eventY = (action.target && action.target.y) ?? action.y ?? (action.stance && action.stance.y);
    return `event:${floorId}:${eventX},${eventY}`;
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

/**
 * PR-5.26a - dynamic rank-20 Pareto retention (helper 1 of 2).
 *
 * Group key for trim-time Pareto comparison: semantic action identity PLUS the
 * structural state key. Only variants of the SAME action in the SAME world are
 * ever compared - never "kill redBat" against "take equipment". Equipment is
 * already part of buildStructuralStateKey, so different equipment still groups
 * apart. Returns null when the node cannot be classified, and such nodes are
 * deliberately left unpenalized rather than guessed at.
 */
function rank20ParetoGroupKey(node) {
  const identity = node.semanticIdentity;
  if (typeof identity !== "string" || identity.length === 0) return null;
  if (!node.state) return null;
  let structuralKey = node.rank20StructuralKey;
  if (structuralKey === undefined) {
    structuralKey = buildStructuralStateKey(node.state);
    node.rank20StructuralKey = structuralKey;
  }
  if (typeof structuralKey !== "string" || structuralKey.length === 0) return null;
  return `${identity}\u0000${structuralKey}`;
}

/**
 * PR-5.26a - resource vector for a rank-20 node, memoized on the node because
 * the vector is immutable while the node lives and this runs under cap pressure.
 */
function rank20ResourceVector(node) {
  let vector = node.rank20ResourceVector;
  if (vector === undefined) {
    vector = extractResourceVector(node.state);
    node.rank20ResourceVector = vector;
  }
  return vector;
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
    // PR-5.25t: observational candidate-lifecycle observer. Return values are
    // completely ignored - the observer can record, never steer. Absent
    // callback = zero behavior change (one truthiness test per event site).
    // Observer exceptions are NOT swallowed: a broken recorder aborts the
    // diagnostic loudly instead of silently degrading the recording.
    const onCandidateLifecycle = typeof config.onCandidateLifecycle === "function" ? config.onCandidateLifecycle : null;
    const emitLifecycle = onCandidateLifecycle ? (event) => onCandidateLifecycle(event) : null;
    // PR-5.25z observational-only: when enabled, every drop event also carries the
    // rank-20 semantic-identity composition of the trim plus, for the dropped
    // node, the structural/resource decomposition of its same-identity peers.
    // Purely diagnostic: the fields are never read back into ranking, retention,
    // the scheduler, or termination. Off by default so normal runs pay nothing.
    const lifecyclePeerComposition = config.lifecyclePeerComposition === true;
    const PEER_VARIANT_LIMIT = config.lifecyclePeerVariantLimit == null ? 64 : Number(config.lifecyclePeerVariantLimit);
    // PR-5.26a trim-time dynamic rank-20 Pareto retention. Default ON: it is the
    // current retention contract. Set false only to reproduce the pre-5.26a
    // (rank, insertion) ordering for attribution comparisons; that flag is a
    // diagnostic switch, NOT a supported configuration.
    const rank20DynamicPareto = config.rank20DynamicPareto !== false;
    // Previous-trim membership per Pareto group, used to re-classify only groups
    // whose membership actually changed. The Pareto relation is NOT monotone: a
    // node dominated only by a peer that has since been dropped becomes
    // nondominated, so a stale classification would be wrong.
    const rank20ParetoGroups = new Map();
    let rank20ParetoRecomputedGroups = 0;
    let rank20ParetoNondominatedPendingTotal = 0;
    let rank20ParetoDominatedPendingTotal = 0;
    let rank20ParetoRescuedTotal = 0;
    let rank20ParetoChangedTrims = 0;

    /**
     * Classify every live rank-20 entry as Pareto-dominated or nondominated
     * WITHIN its own (identity, structural key) group, over the CURRENT pending
     * set. This is what makes a late, strong variant able to overtake earlier
     * weak ones, which an append-only prior-seen skyline cannot do. Results are
     * stored on the node as a transient flag used ONLY for this trim's fill
     * order; they are never folded into node.rankValue, which is cached and
     * would go stale as peers come and go.
     */
    const classifyRank20Pareto = (entries) => {
      const current = new Map();
      for (const e of entries) {
        if (e.rank !== 20) continue;
        const node = e.node;
        const key = rank20ParetoGroupKey(node);
        if (key == null) {
          node.rank20ParetoDominated = false;
          continue;
        }
        let members = current.get(key);
        if (!members) {
          members = [];
          current.set(key, members);
        }
        members.push(node);
      }
      for (const [key, members] of current) {
        const previous = rank20ParetoGroups.get(key);
        let changed = true;
        if (previous && previous.size === members.length) {
          changed = false;
          for (const n of members) {
            if (!previous.has(n.id)) { changed = true; break; }
          }
        }
        if (changed) {
          for (const n of members) n.rank20ParetoDominated = false;
          // Exact nondominated-frontier sweep instead of an O(g^2) pairwise scan.
          // Sorting by descending HP visits likely dominators first, and the
          // standard incremental skyline then costs O(g * F) with F the frontier
          // size. Eviction is sound because Pareto dominance is transitive: if n
          // dominates x and x dominates y then n dominates y. A frontier member
          // evicted by a later arrival must be re-marked dominated.
          const ordered = members.slice().sort((a, b) => {
            const va = rank20ResourceVector(a);
            const vb = rank20ResourceVector(b);
            return (vb.hp - va.hp) || (vb.atk - va.atk) || (vb.def - va.def) ||
              (vb.mdef - va.mdef) || (vb.hpmax - va.hpmax) || (vb.lv - va.lv);
          });
          const frontier = [];
          for (const n of ordered) {
            const vec = rank20ResourceVector(n);
            let dominated = false;
            for (const f of frontier) {
              if (paretoDominates(rank20ResourceVector(f), vec)) { dominated = true; break; }
            }
            if (dominated) {
              n.rank20ParetoDominated = true;
              continue;
            }
            for (let i = frontier.length - 1; i >= 0; i -= 1) {
              if (paretoDominates(vec, rank20ResourceVector(frontier[i]))) {
                frontier[i].rank20ParetoDominated = true;
                frontier.splice(i, 1);
              }
            }
            frontier.push(n);
          }
          rank20ParetoRecomputedGroups += 1;
          const next = new Set();
          for (const n of members) next.add(n.id);
          rank20ParetoGroups.set(key, next);
        }
      }
      for (const key of [...rank20ParetoGroups.keys()]) {
        if (!current.has(key)) rank20ParetoGroups.delete(key);
      }
    };

    const startedAt = Date.now();
    let stoppedReason = null;
    let peakRssMb = 0;
    let peakHeapUsedMb = 0;

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
    const emitGuidedServiceTelemetry = config.emitGuidedServiceTelemetry === true;
    /**
     * PR-5.26h - guided pool saturation composition and flow audit.
     *
     * Aggregates only, opt-in, default off. No per-node events, at most two
     * composition snapshots per run, and nothing here is read by ranking,
     * retention, scheduling, or termination. The point is to measure WHY the
     * capped pending pool tends to fill up with rank-10 work, instead of
     * inferring it from an end-of-run snapshot.
     */
    const emitGuidedPoolTelemetry = config.emitGuidedPoolTelemetry === true;
    /**
     * PR-5.26i - dropped candidate state reclamation (default on, explicit `false` rolls back).
     *
     * A candidate that the bounded cap drops can never return to `pending`, can
     * never be expanded, and keeps its duplicate-tombstone semantics purely
     * through `registry.has(key)`. Nothing about it is search-relevant any more,
     * yet its full world state stays reachable from `nodesById` - the same state
     * that only expansion otherwise releases. This releases exactly that payload.
     *
     * SEARCH_POLICY_CHANGE = NONE: it is a resource-lifecycle repair, and the
     * fixed-work A/B must show an identical trajectory.
     *
     * DEFAULT ON, with an explicit-false rollback. PR-5.26i's fixed-work A/B
     * (8000 expansions, cap 1024, stress config) produced a byte-identical
     * trajectory - result fields, lifecycle event stream, route and route trace
     * all identical - while peak heapUsed fell 1019.3 -> 575.6 MB and peak RSS
     * 1175.7 -> 717.9 MB. Since nothing search-visible depends on the payload,
     * defaulting it on only removes dead memory. Pass `false` to roll back.
     */
    const reclaimDroppedState = config.reclaimDroppedState !== false;
    let droppedStatesReclaimed = 0;
    const trackPeakHeapUsed = config.trackPeakHeapUsed === true;
    let guidedPoolTrims = 0;
    let guidedPoolRemovedByExpansion = 0;
    let guidedPoolRemovedByDrop = 0;
    let guidedPoolRank10FracSum = 0;
    let guidedPoolRank10FracMin = null;
    let guidedPoolRank10FracMax = null;
    let guidedPoolTrimsGe90 = 0;
    let guidedPoolTrimsGe99 = 0;
    let guidedPoolFirstExpansionGe90 = null;
    let guidedPoolFinalTrim = null;
    let guidedPoolFirst99Snapshot = null;
    let guidedPoolEndSnapshot = null;
    /**
     * PR-5.26f: opt-in. Only changes how EQUAL scores are ordered inside the
     * guided heap (registration order). Higher scores always win, and nothing
     * outside the guided heap reads it.
     */
    const stableGuidedTieBreak = config.stableGuidedTieBreak === true;
    const neutralEvery = config.neutralEvery == null ? 5 : Number(config.neutralEvery);
    /**
     * PR-5.26c - neutral-turn Pareto substitution.
     *
     * Off by default; the capability configuration opts in explicitly. This
     * changes only WHO one already-scheduled neutral expansion is spent on, and
     * only when the FIFO head is a rank-20 investment variant that a live
     * same-group peer strictly dominates. It never changes how often a neutral
     * turn happens, never moves a candidate into the guided heap, and never
     * deletes the dominated variant.
     */
    const neutralParetoSubstitution = config.neutralParetoSubstitution === true;
    let neutralParetoSubstitutions = 0;
    let neutralParetoSubstitutionScans = 0;
    const resourceSkylinePriority = config.resourceSkylinePriority === true;
    const skylineSet = resourceSkylinePriority ? createResourceSkylineSet() : null;
    /**
     * PR-5.26g - retroactive guided skyline demotion (opt-in, default off).
     *
     * Repairs ONE asymmetry: the frontier skyline is append-only, so a weak
     * variant that arrives BEFORE a stronger one keeps its guided admission,
     * while the same weak variant arriving after is correctly rejected. See
     * applyRetroactiveGuidedDemotion for the full contract.
     */
    const retroactiveGuidedSkylineDemotion = config.retroactiveGuidedSkylineDemotion === true;
    // structuralKey -> Set(nodeId) of guided-admitted nodes. Membership is added
    // at admission and removed on demotion; it is allowed to retain ids of
    // nodes that have since been expanded or dropped, because LIVENESS IS
    // DECIDED BY livePendingIds (the existing authoritative mirror of `pending`),
    // not by this set. That keeps one source of truth and one correctness
    // mechanism. Dead ids are reclaimed by a bounded sweep at trim time.
    const guidedGroups = retroactiveGuidedSkylineDemotion ? new Map() : null;
    let guidedGroupTrackedIds = 0;
    let guidedGroupSweeps = 0;
    let guidedRetroDemotions = 0;
    let guidedRetroDemotionScans = 0;
    let guidedHeapStaleDemotionSkips = 0;
    const guidedGroupSweepThreshold = Number.isFinite(config.guidedGroupSweepThreshold) && config.guidedGroupSweepThreshold > 0
      ? Math.floor(config.guidedGroupSweepThreshold)
      : Math.max(256, 4 * Number(config.pendingCandidateCap || 1024));
    const addGuidedGroupMember = (groupKey, nodeId) => {
      let members = guidedGroups.get(groupKey);
      if (!members) {
        members = new Set();
        guidedGroups.set(groupKey, members);
      }
      if (members.has(nodeId)) return;
      members.add(nodeId);
      guidedGroupTrackedIds += 1;
    };
    // Diagnostic only: live guided-admitted pending count and its peak. Never
    // read by ranking, retention, or the scheduler.
    let liveGuidedCount = 0;
    let guidedActivePeak = 0;
    const noteGuidedAdded = () => {
      liveGuidedCount += 1;
      if (liveGuidedCount > guidedActivePeak) guidedActivePeak = liveGuidedCount;
    };
    const noteGuidedRemoved = () => {
      if (liveGuidedCount > 0) liveGuidedCount -= 1;
    };

    const trackResourcePressure = config.trackResourcePressure === true;
    const mt2ExpandedStates = trackResourcePressure ? [] : null;

    // PR-5.25o bounded candidate search: cap on pending candidates.
    const pendingCandidateCap = Number.isFinite(config.pendingCandidateCap) && config.pendingCandidateCap > 0
      ? Math.floor(config.pendingCandidateCap)
      : null;
    const pending = [];
    let pendingSeq = 0;
    let guidedScoreHistogram = emitGuidedServiceTelemetry ? {} : null;

    /**
     * PR-5.25o retention rank: lower is retained.
     *
     * PR-5.25s contract: cap retention must match the guided scheduler.
     * PR-5.25x adds the first real rank-20 class: transitions that produced
     * permanent combat-stat growth survive cap pressure better than ordinary
     * neutrals. combatProgress candidates do NOT enter the guided heap and
     * remain schedulable only through the neutral/FIFO lane - retention
     * only, scheduler unchanged.
     */
    /**
     * PR-5.26b Repair 1: the rank classes WITHOUT caching, so telemetry can
     * read a candidate's class without mutating search state. pendingRank()
     * keeps its caching behaviour and now delegates here, so the two can never
     * drift apart.
     */
    const rankClassOf = (node) => {
      if (node.state && isGoalState(node.state)) return 0;
      if (node.guidedAdmitted) return 10;
      if (node.combatProgress) return 20;
      return 30;
    };
    const pendingRank = (node) => {
      if (node.rankValue != null) return node.rankValue;
      const rank = rankClassOf(node);
      node.rankValue = rank;
      return rank;
    };
    /**
     * PR-5.26b Repair 1: opt-in mirror of `pending`.
     *
     * `pending` is a plain array, and the enqueue telemetry needs a membership
     * test per queue entry. Maintaining a Set only when a diagnostic asks for
     * it keeps every capability run byte-for-byte unchanged: when this is null
     * the guarded updates below are no-ops. buildPendingSnapshot() cross-checks
     * the mirror against pending.length and reports any divergence rather than
     * silently trusting it.
     */
    const livePendingIds = (config.emitEnqueueTelemetry === true || config.emitPendingSnapshot === true || emitGuidedServiceTelemetry === true || retroactiveGuidedSkylineDemotion === true)
      ? new Set()
      : null;
    let frontierHead = 0;

    // CONTROL: pure FIFO
    const frontier = frontierSet ? null : [rootNode.id];

    // TREATMENT: bounded-fair dual queue
    const guidedHeap = frontierSet ? [] : null;
    const neutralQueue = frontierSet ? [rootNode.id] : null;

    /**
     * PR-5.26h: composition snapshot of the LIVE rank-10 pending pool.
     *
     * "Live" means still in `pending` and not closed. Diagnostic only, and
     * deliberately NOT hot-path - it is built at most twice per run. It reuses
     * the same three primitives the resource skyline uses and never writes a
     * node field (in particular it never touches node.rankValue or
     * node.rank20ParetoDominated, which the trim later reads).
     *
     * `dominatedWithinGroup` / `nondominatedWithinGroup` are computed with an
     * exact sorted incremental frontier sweep, not with pairwise comparison, so
     * a group with many variants stays cheap; equal resource vectors do not
     * dominate each other (paretoDominates requires a strict improvement).
     */
    const buildGuidedPoolSnapshot = (label) => {
      const guided = [];
      for (const id of pending) {
        const node = nodesById.get(id);
        if (!node || node.closed) continue;
        if (rankClassOf(node) !== 10) continue;
        guided.push(node);
      }
      const identityCounts = new Map();
      const kindCounts = new Map();
      const floorCounts = new Map();
      const structuralCounts = new Map();
      const vectorsByGroup = new Map();
      for (const node of guided) {
        const identity = node.semanticIdentity == null ? "(unknown)" : String(node.semanticIdentity);
        identityCounts.set(identity, (identityCounts.get(identity) || 0) + 1);
        const kind = node.actionKind == null ? "(unknown)" : String(node.actionKind);
        kindCounts.set(kind, (kindCounts.get(kind) || 0) + 1);
        const floor = node.state && node.state.floorId != null ? String(node.state.floorId) : "(unknown)";
        floorCounts.set(floor, (floorCounts.get(floor) || 0) + 1);
        if (!node.state) continue;
        const structuralKey = buildStructuralStateKey(node.state);
        structuralCounts.set(structuralKey, (structuralCounts.get(structuralKey) || 0) + 1);
        let vectors = vectorsByGroup.get(structuralKey);
        if (!vectors) {
          vectors = [];
          vectorsByGroup.set(structuralKey, vectors);
        }
        vectors.push(extractResourceVector(node.state));
      }
      let multiVariantStructuralGroupCount = 0;
      let maxVariantsPerStructuralGroup = 0;
      let dominatedWithinGroup = 0;
      let nondominatedWithinGroup = 0;
      for (const vectors of vectorsByGroup.values()) {
        if (vectors.length > 1) multiVariantStructuralGroupCount += 1;
        if (vectors.length > maxVariantsPerStructuralGroup) maxVariantsPerStructuralGroup = vectors.length;
        const frontier = [];
        for (const vec of vectors) {
          let dominated = false;
          for (const f of frontier) {
            if (paretoDominates(f, vec)) { dominated = true; break; }
          }
          if (dominated) continue;
          for (let i = frontier.length - 1; i >= 0; i -= 1) {
            if (paretoDominates(vec, frontier[i])) frontier.splice(i, 1);
          }
          frontier.push(vec);
        }
        const nondominated = frontier.length;
        nondominatedWithinGroup += nondominated;
        dominatedWithinGroup += vectors.length - nondominated;
      }
      const topSemanticIdentityMultiplicities = [...identityCounts.entries()]
        .sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .slice(0, 10)
        .map(([identity, count]) => ({ identity, count }));
      return {
        label,
        strategicExpansion: strategicExpansions,
        liveGuidedCount: guided.length,
        distinctSemanticIdentities: identityCounts.size,
        distinctStructuralKeys: structuralCounts.size,
        topSemanticIdentityMultiplicities,
        byActionKind: Object.fromEntries(kindCounts),
        byFloor: Object.fromEntries(floorCounts),
        multiVariantStructuralGroupCount,
        maxVariantsPerStructuralGroup,
        liveGuidedParetoDominatedWithinStructuralGroup: dominatedWithinGroup,
        liveGuidedParetoNondominatedWithinStructuralGroup: nondominatedWithinGroup,
      };
    };
    let neutralHead = 0;
    const expanded = frontierSet ? new Set() : null;
    let neutralSinceGuided = 0;
    let guidedExpansions = 0;
    let neutralExpansions = 0;
    // PR-5.25q guided-changeFloor telemetry: additive counters, no behavior change.
    // P2 naming (owner review of 5edefc4): generated/forward count CHILDREN at
    // registration; the expanded counter counts nodes flagged guided-changeFloor
    // that were later selected for expansion from EITHER queue (guided heap or
    // neutral), not expansions that were prioritized by the guided queue.
    let guidedChangeFloorGenerated = 0;
    let guidedChangeFloorNodesExpanded = 0;
    let guidedForwardFloorChildrenGenerated = 0;
    // PR-5.25s admission telemetry: structural vs scheduling-eligible vs
    // skyline-dominated frontier matches, total and per action kind.
    let frontierGuidedGenerated = 0;
    let guidedAdmittedGenerated = 0;
    let frontierGuidedDominatedGenerated = 0;
    const frontierGuidedByKind = {};
    const guidedAdmittedByKind = {};
    const frontierGuidedDominatedByKind = {};
    // PR-5.25v FIFO head survival telemetry.
    let fifoHeadProtectionOpportunities = 0;
    let fifoHeadProtected = 0;
    let fifoHeadWouldHaveDroppedWithoutProtection = 0;
    let fifoProtectedNodeWasGuided = 0;
    // PR-5.25x combat-progress telemetry.
    let combatProgressGenerated = 0;
    let combatProgressAdmittedGenerated = 0;

    const heapPush = (entry) => {
      guidedHeapPush(guidedHeap, entry, stableGuidedTieBreak);
    };

    const heapPop = () => guidedHeapPop(guidedHeap, stableGuidedTieBreak);

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
      if (maxRssMb <= 0 && !trackPeakHeapUsed) return;
      const usage = process.memoryUsage();
      if (maxRssMb > 0) {
        const rssMb = usage.rss / (1024 * 1024);
        if (rssMb > peakRssMb) peakRssMb = rssMb;
        if (rssMb >= maxRssMb) stoppedReason = "rss-limit";
      }
      // PR-5.26i diagnostic: heapUsed is a proxy, not a ceiling. V8 may release
      // objects without returning pages to the OS, so RSS remains the budget that
      // actually terminates a run.
      if (trackPeakHeapUsed) {
        const heapMb = usage.heapUsed / (1024 * 1024);
        if (heapMb > peakHeapUsedMb) peakHeapUsedMb = heapMb;
      }
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
      if (emitLifecycle) emitLifecycle({ type: "closureSeen", exactKey: startKey });
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
            if (emitLifecycle) emitLifecycle({ type: "closureSeen", exactKey: key });
            queue.push({ state: next, chain: child.chain, trace: child.trace, signature });
          } else {
            strategic.push({ state: entry.state, chain: entry.chain, trace: entry.trace, action, next, key });
          }
        }
      }
      return { states: visited, strategic, absorbed, truncated, expansionRuns: queue.length, signatureCalls: closureSignatureCalls, signatureWallMs: closureSignatureWallMs };
    };

    /**
     * PR-5.26c - choose a substitute for a neutral turn.
     *
     * Contract (owner-specified, no scalar value function anywhere):
     *   - only when the live FIFO head is rank 20 (an investment variant)
     *   - only within the SAME group: semanticIdentity + structural state key
     *   - only peers that strictly Pareto-dominate the head
     *   - among those, the CURRENT nondominated frontier (a dominator that is
     *     itself dominated by another dominator would be another wasted turn)
     *   - ties broken by insertion order (lowest pendingSeq), the SAME tie-break
     *     the retention path uses
     *
     * Dominance is recomputed here from live nodes, never read from the cached
     * node.rank20ParetoDominated: group membership changes as nodes are expanded
     * or dropped, and a node dominated at the last trim need not be dominated
     * now. Returns null when no substitution is justified.
     */
    const selectNeutralSubstitute = (head) => {
      if (!neutralParetoSubstitution) return null;
      if (rankClassOf(head) !== 20) return null;
      const headGroup = rank20ParetoGroupKey(head);
      if (headGroup == null) return null;
      neutralParetoSubstitutionScans += 1;
      const headVec = rank20ResourceVector(head);
      const dominators = [];
      for (const id of pending) {
        if (id === head.id) continue;
        const peer = nodesById.get(id);
        if (!peer || peer.closed) continue;
        if (rankClassOf(peer) !== 20) continue;
        if (rank20ParetoGroupKey(peer) !== headGroup) continue;
        if (!paretoDominates(rank20ResourceVector(peer), headVec)) continue;
        dominators.push(peer);
      }
      if (dominators.length === 0) return null;
      let best = null;
      for (const d of dominators) {
        const dv = rank20ResourceVector(d);
        let itselfDominated = false;
        for (const other of dominators) {
          if (other === d) continue;
          if (paretoDominates(rank20ResourceVector(other), dv)) { itselfDominated = true; break; }
        }
        if (itselfDominated) continue;
        if (best == null || d.pendingSeq < best.pendingSeq) best = d;
      }
      return best;
    };

    /**
     * PR-5.26g - retroactive guided skyline demotion.
     *
     * `skylineSet.query()` asks only "did any previously SEEN state dominate
     * this one?", and `skylineSet.insert()` is append-only: it never retracts a
     * guided admission that a later, stronger state supersedes. So
     *
     *   weak then strong -> {weak, strong} both guided
     *   strong then weak -> {strong} guided, weak rejected
     *
     * and the ACTIVE guided set is arrival-order sensitive. PR-5.26f made that
     * visible: changing only guided service order changed the number of guided
     * admissions (8916 -> 15792 at fixed work) and pushed MT4 into the RSS
     * limit before the wall budget was spent.
     *
     * This repairs exactly that asymmetry: when a newly admitted state
     * dominates an OLDER, STILL-LIVE guided node in the SAME structural skyline
     * group, the older node loses guided status. The group is the skyline's own
     * grouping (buildStructuralStateKey), i.e. the same grouping the admission
     * heuristic used, so the repair cancels that heuristic's asymmetry rather
     * than introducing a second notion of "the same state".
     *
     * NOT a prune: the demoted node stays pending, stays closed=false, stays in
     * the neutral queue and remains searchable. It only stops occupying a
     * rank-10 guided slot.
     *
     * Demotion is PERMANENT for guided eligibility (no re-promotion). The
     * existing skyline contract is "once a dominator has been seen, a later
     * weak variant never gets guided admission"; re-promoting would invent a
     * live dynamic skyline instead of repairing the arrival-order asymmetry.
     */
    const applyRetroactiveGuidedDemotion = (newNode, structuralKey, newVector) => {
      if (!retroactiveGuidedSkylineDemotion || !guidedGroups) return;
      const members = guidedGroups.get(structuralKey);
      if (!members || members.size === 0) return;
      guidedRetroDemotionScans += 1;
      const demote = [];
      for (const id of members) {
        if (id === newNode.id) continue;
        // LIVENESS: livePendingIds is the same mirror of `pending` that the
        // enqueue/snapshot telemetry already uses, maintained at registration,
        // expansion, and trim. A node that has been expanded or dropped is not
        // in it - which matters twice over, because an expanded node's state has
        // been released and dereferencing it would throw.
        if (livePendingIds) {
          if (!livePendingIds.has(id)) continue;
        } else if (expanded.has(id)) continue;
        const peer = nodesById.get(id);
        if (!peer) continue;
        if (peer.closed === true || peer.guidedAdmitted !== true) continue;
        // rank20ResourceVector is just extractResourceVector(node.state) with a
        // per-node memo; the name reflects where it was first used (PR-5.26a),
        // the extraction is the same one the skyline uses.
        if (!paretoDominates(newVector, rank20ResourceVector(peer))) continue;
        demote.push(peer);
      }
      for (const peer of demote) {
        // PERMANENT: no code path re-admits a node to the guided heap, and the
        // flag is recorded so an audit can tell a demoted node from a
        // never-guided one.
        peer.guidedAdmitted = false;
        peer.guidedRetroDemoted = true;
        // The rank cache may already hold 10. Drop it so the next retention
        // recomputes rankClassOf() -> combatProgress ? 20 : 30. Never write 30.
        peer.rankValue = null;
        members.delete(peer.id);
        guidedGroupTrackedIds -= 1;
        noteGuidedRemoved();
        guidedRetroDemotions += 1;
        if (emitLifecycle) {
          emitLifecycle({
            type: "guidedRetroDemotion",
            exactKey: peer.key,
            nodeId: peer.id,
            pendingSeq: peer.pendingSeq,
            demotedByExactKey: newNode.key,
            demotedByNodeId: newNode.id,
            structuralKey,
            demotedAtExpansion: strategicExpansions,
          });
        }
      }
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
            // PR-5.26c: locate the first LIVE FIFO head WITHOUT consuming it.
            // Dead entries (already expanded, or closed) are skipped and passed
            // permanently - that is the pre-existing pop-and-discard behaviour.
            // The live head is only consumed once it is actually expanded, so a
            // substitution can leave it in place at the head.
            let headIndex = neutralHead;
            while (headIndex < neutralQueue.length) {
              const id = neutralQueue[headIndex];
              const candidate = id == null ? null : nodesById.get(id);
              if (id != null && !expanded.has(id) && candidate && !candidate.closed) break;
              headIndex += 1;
            }
            if (headIndex >= neutralQueue.length) {
              // No live neutral candidate left: drop the consumed dead entries
              // and let the loop fall through to the guided heap.
              neutralHead = headIndex;
            } else {
              const head = nodesById.get(neutralQueue[headIndex]);
              const substitute = selectNeutralSubstitute(head);
              if (substitute) {
                // H stays the FIFO head: neutralHead points AT it, not past it.
                // A dominated variant is never deleted, only deferred, and it
                // becomes serveable again once its dominators are expanded.
                neutralHead = headIndex;
                node = substitute;
                neutralParetoSubstitutions += 1;
                if (emitLifecycle) {
                  emitLifecycle({
                    type: "neutralSubstitution",
                    exactKey: substitute.key,
                    nodeId: substitute.id,
                    headExactKey: head.key,
                    headNodeId: head.id,
                    headQueueIndex: headIndex,
                    substitutedAtExpansion: strategicExpansions,
                  });
                }
              } else {
                neutralHead = headIndex + 1;
                node = head;
              }
              neutralSinceGuided = 0;
              neutralExpansions += 1;
              break;
            }
          } else if (guidedHeap.length > 0) {
            const entry = heapPop();
            if (entry && !expanded.has(entry.nodeId)) {
              const candidate = nodesById.get(entry.nodeId);
              // PR-5.26g: a retro-demoted node's heap entry is deliberately left
              // in place. Arbitrary delete in a binary heap is easy to get
              // wrong; instead the entry becomes stale and is skipped here. The
              // node remains reachable through the neutral lane like any other
              // neutral work.
              const staleDemoted = retroactiveGuidedSkylineDemotion && candidate
                && candidate.closed !== true && candidate.guidedAdmitted !== true;
              if (staleDemoted) guidedHeapStaleDemotionSkips += 1;
              if (candidate && !candidate.closed && !staleDemoted) {
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
          if (node.guidedAdmitted === true) {
            noteGuidedRemoved();
            if (emitGuidedPoolTelemetry) guidedPoolRemovedByExpansion += 1;
          }
          if (node.guidedChangeFloor) guidedChangeFloorNodesExpanded += 1;
          const at = pending.indexOf(node.id);
          if (at >= 0) pending.splice(at, 1);
          if (livePendingIds) livePendingIds.delete(node.id);
        }
      }
      if (!node) break;
      if (trackResourcePressure && node.state && node.state.floorId === "MT2") {
        mt2ExpandedStates.push({ id: node.id, key: node.key, state: cloneState(node.state) });
      }

      if (isGoalState(node.state)) {
        recordReachedNode(node);
        goalNode = node;
        if (emitLifecycle) {
          emitLifecycle({ type: "goal", exactKey: node.key, depth: node.depth, floorId: node.state ? node.state.floorId : null });
        }
        break;
      }

      if (emitLifecycle) {
        emitLifecycle({
          type: "expanded",
          exactKey: node.key,
          nodeId: node.id,
          strategicExpansion: strategicExpansions,
          depth: node.depth,
          floorId: node.state ? node.state.floorId : null,
          // PR-5.26a: the node's rank-20 Pareto status as of the last trim that
          // classified its group. A node only reaches expansion by surviving
          // retention, so this records what it was holding when it won its slot.
          rank20ParetoDominated: rank20DynamicPareto && node.rank20ParetoDominated === true,
          combatProgress: node.combatProgress === true,
          // PR-5.26f diagnostic-only wait age. Emitted here (not reconstructed
          // from a lifecycle map) so the audit never has to retain per-node
          // state. Never read by ranking, retention, or the scheduler.
          guidedAdmitted: node.guidedAdmitted === true,
          guidedPendingSeq: emitGuidedServiceTelemetry && node.guidedAdmitted === true ? node.pendingSeq : null,
          guidedWaitAgeAtExpansion: emitGuidedServiceTelemetry && node.guidedAdmitted === true
            ? strategicExpansions - node.registeredAtStrategicExpansion
            : null,
        });
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
        if (emitLifecycle) {
          emitLifecycle({
            type: "strategicGenerated",
            exactKey: candidate.key,
            kind: candidate.action.kind,
            floorId: candidate.state ? candidate.state.floorId : null,
          });
        }
        const next = candidate.next;
        if (registry.has(candidate.key)) {
          duplicatesSkipped += 1;
          if (emitLifecycle) emitLifecycle({ type: "duplicateSkipped", exactKey: candidate.key, kind: candidate.action.kind });
          continue;
        }
        const child = {
          id: nextNodeId++,
          // PR-5.26b: registration FIFO age, observational only. pendingSeq is
          // the counter the retention trim already uses; the expansion index is
          // recorded so an audit can measure how long a retained node waited in
          // the neutral lane before the budget ended. Neither is read by
          // ranking, retention, or the scheduler.
          pendingSeq: pendingSeq++,
          registeredAtStrategicExpansion: strategicExpansions,
          parentId: node.id,
          state: next,
          key: candidate.key,
          actionKind: candidate.action.kind,
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
        if (emitLifecycle) {
          emitLifecycle({
            type: "registered",
            exactKey: child.key,
            nodeId: child.id,
            pendingSeq: child.pendingSeq,
            registeredAtStrategicExpansion: child.registeredAtStrategicExpansion,
            depth: child.depth,
            floorId: child.state ? child.state.floorId : null,
          });
        }
        // PR-5.25x: permanent combat-stat growth produced by this transition
        // (state delta only). Rank-20 retention class for non-guided children;
        // no scheduler change. The admitted counter is finalized after the
        // frontier branch below (guided children are rank 10).
        child.combatProgress = isCombatProgressTransition(candidate.state, candidate.next);
        if (child.combatProgress) {
          combatProgressGenerated += 1;
          if (!frontierSet) {
            combatProgressAdmittedGenerated += 1;
          }
        }
        child.frontierGuided = false;
        child.paretoAdmitted = false;
        child.guidedAdmitted = false;
        pending.push(child.id);
        if (livePendingIds) livePendingIds.add(child.id);

        if (!frontierSet) {
          frontier.push(child.id);
        } else {
          neutralQueue.push(child.id);
          // PR-5.26b Repair 1: observational enqueue-time queue attribution.
          // Emitted here because this is the moment the candidate becomes
          // schedulable. Every node READ below was registered in an EARLIER
          // loop iteration, so its guidedAdmitted/combatProgress are already
          // final - unlike THIS child, which is still pre-admission because
          // guidedAdmitted is assigned in the frontier branch further down.
          // That is why the child's own class is reported as
          // rankClassBeforeGuidedAdmission and not as a rank. Pure reads: no
          // rankValue caching, no writes to any node, no oracle input. The
          // dynamic Pareto status is deliberately NOT reported - no trim has
          // classified this group yet, so any value would be fabricated.
          if (emitLifecycle && config.emitEnqueueTelemetry === true) {
            let liveNeutralAhead = 0;
            let liveAheadGuidedAdmitted = 0;
            let liveAheadCombatProgress = 0;
            const liveAheadByRank = { 0: 0, 10: 0, 20: 0, 30: 0 };
            for (let i = neutralHead; i < neutralQueue.length - 1; i += 1) {
              const aheadId = neutralQueue[i];
              if (!livePendingIds || !livePendingIds.has(aheadId)) continue;
              const aheadNode = nodesById.get(aheadId);
              if (!aheadNode) continue;
              liveNeutralAhead += 1;
              const rank = rankClassOf(aheadNode);
              liveAheadByRank[rank] = (liveAheadByRank[rank] || 0) + 1;
              if (aheadNode.guidedAdmitted === true) liveAheadGuidedAdmitted += 1;
              if (aheadNode.combatProgress === true) liveAheadCombatProgress += 1;
            }
            emitLifecycle({
              type: "enqueued",
              exactKey: child.key,
              nodeId: child.id,
              pendingSeq: child.pendingSeq,
              // Deliberately NOT `rankClass`: guidedAdmitted is assigned in the
              // frontier branch further down, so at enqueue time every child is
              // still pre-admission. Naming it exactly keeps it honest. The
              // liveAheadByRank figures below are unaffected because those nodes
              // were registered in earlier iterations and are already final.
              rankClassBeforeGuidedAdmission: rankClassOf(child),
              neutralHeadAtEnqueue: neutralHead,
              neutralQueueAbsoluteIndexAtEnqueue: neutralQueue.length - 1,
              liveNeutralAheadAtEnqueue: liveNeutralAhead,
              liveAheadByRank,
              liveAheadGuidedAdmitted,
              liveAheadCombatProgress,
              guidedExpansionsAtEnqueue: guidedExpansions,
              neutralExpansionsAtEnqueue: neutralExpansions,
              strategicExpansionsAtEnqueue: strategicExpansions,
            });
          }
          const identity = actionToSemanticIdentity(candidate.action, candidate.state, candidate.next, simulator.project);
          // PR-5.25z: observational only - lets the rank-20 composition audit group
          // pending candidates by semantic action without any oracle knowledge.
          // Never read by ranking, retention, or the scheduler.
          child.semanticIdentity = identity;
          const identityInFrontier = frontierSet.has(identity);
          let skylineDominated = false;
          if (identityInFrontier) {
            child.frontierGuided = true;
            frontierGuidedGenerated += 1;
            frontierGuidedByKind[candidate.action.kind] = (frontierGuidedByKind[candidate.action.kind] || 0) + 1;
            if (candidate.action.kind === "changeFloor") {
              child.guidedChangeFloor = true;
              guidedChangeFloorGenerated += 1;
              if (mtFloorOrdinal(String(identity).split("->")[1]) > mtFloorOrdinal(candidate.state.floorId)) {
                guidedForwardFloorChildrenGenerated += 1;
              }
            }
            let skylineQuery = null;
            if (resourceSkylinePriority) {
              skylineQuery = skylineSet.query(candidate.next, child.id, candidate.key);
              skylineDominated = skylineQuery.isDominated;
              skylineSet.insert(candidate.next, child.id, candidate.key);
            }
            child.paretoAdmitted = !skylineDominated;
            if (!skylineDominated) {
              // PR-5.25s: guidedAdmitted marks actual guided-heap insertion -
              // the ONLY frontier property that earns cap-retention rank 10.
              const score = (priorityMap && priorityMap.get(identity)) || 100;
              heapPush({ nodeId: child.id, score, pendingSeq: child.pendingSeq });
              child.guidedAdmitted = true;
              guidedAdmittedGenerated += 1;
              guidedAdmittedByKind[candidate.action.kind] = (guidedAdmittedByKind[candidate.action.kind] || 0) + 1;
              noteGuidedAdded();
              if (retroactiveGuidedSkylineDemotion && skylineQuery) {
                addGuidedGroupMember(skylineQuery.structuralKey, child.id);
                // Remembered so the trim-time sweep can rebuild membership from
                // the live pending set without recomputing state keys.
                child.retroGuidedGroupKey = skylineQuery.structuralKey;
                applyRetroactiveGuidedDemotion(child, skylineQuery.structuralKey, skylineQuery.resourceVector);
              }
              if (emitGuidedServiceTelemetry) {
                const scoreKey = String(score);
                guidedScoreHistogram[scoreKey] = (guidedScoreHistogram[scoreKey] || 0) + 1;
                if (emitLifecycle) {
                  let guidedLiveCount = 0;
                  let guidedSameScoreLiveCount = 0;
                  for (const entry of guidedHeap) {
                    if (!livePendingIds || !livePendingIds.has(entry.nodeId)) continue;
                    guidedLiveCount += 1;
                    if (entry.score === score) guidedSameScoreLiveCount += 1;
                  }
                  emitLifecycle({
                    type: "guidedAdmitted",
                    exactKey: child.key,
                    nodeId: child.id,
                    score,
                    pendingSeq: child.pendingSeq,
                    registeredAtExpansion: child.registeredAtStrategicExpansion,
                    guidedLiveCountAtRegistration: guidedLiveCount,
                    guidedSameScoreLiveCountAtRegistration: guidedSameScoreLiveCount,
                  });
                }
              }
            } else {
              frontierGuidedDominatedGenerated += 1;
              frontierGuidedDominatedByKind[candidate.action.kind] = (frontierGuidedDominatedByKind[candidate.action.kind] || 0) + 1;
            }
          }
          if (emitLifecycle) {
            const childHero = child.state ? child.state.hero : null;
            emitLifecycle({
              type: "classified",
              exactKey: child.key,
              nodeId: child.id,
              identity,
              kind: candidate.action.kind,
              frontierGuided: child.frontierGuided === true,
              guidedAdmitted: child.guidedAdmitted === true,
              skylineDominated,
              combatProgress: child.combatProgress === true,
              depth: child.depth,
              floorId: child.state ? child.state.floorId : null,
              hero: childHero ? {
                hp: childHero.hp == null ? null : childHero.hp,
                atk: childHero.atk == null ? null : childHero.atk,
                def: childHero.def == null ? null : childHero.def,
                mdef: childHero.mdef == null ? null : childHero.mdef,
                money: childHero.money == null ? null : childHero.money,
              } : null,
            });
          }
        }
        if (frontierSet && child.combatProgress && !child.guidedAdmitted) {
          combatProgressAdmittedGenerated += 1;
        }
      }

      // PR-5.25o: bounded candidate drop. Enforce the cap AFTER the expansion is
      // complete so the currently-expanded node's own children are never dropped
      // before they can ever be considered. Dropped candidates are removed from
      // BOTH the guided heap and the neutral queue — they never return.
      // PR-5.25v bounded FIFO head survival. The scheduler's FIFO contract is
      // "when the next neutral turn comes, expand the next still-live
      // neutralQueue candidate" - it needs the lane's NEXT CANDIDATE to exist,
      // not a storage share (the PR-5.25u 171-slot reserve proved too
      // disruptive). Trim order: goal candidates first; then NEXT_FIFO_HEAD =
      // the first id from neutralHead onward that is still pending, not
      // closed, not expanded - protected if capacity remains (displacing the
      // worst kept candidate when the pure fill is full); then all remaining
      // slots filled exactly by the proven PR-5.25s semantics (guidedAdmitted
      // > neutral, same rank by insertion). The head is selected by QUEUE
      // POSITION only - never by frontierGuided, guidedAdmitted, action kind,
      // floor, or any oracle knowledge. Total kept stays <= cap.
      if (pendingCandidateCap != null && pending.length > pendingCandidateCap) {
        const entries = [];
        for (let i = 0; i < pending.length; i += 1) {
          const node = nodesById.get(pending[i]);
          if (node && !node.closed) {
            entries.push({ id: pending[i], index: i, node, rank: pendingRank(node) });
          }
        }
        const pendingIdSet = new Set(entries.map((e) => e.id));
        let fifoHeadId = null;
        if (neutralQueue) {
          for (let i = neutralHead; i < neutralQueue.length; i += 1) {
            const id = neutralQueue[i];
            const node = nodesById.get(id);
            if (pendingIdSet.has(id) && node && !node.closed && !expanded.has(id)) {
              fifoHeadId = id;
              break;
            }
          }
        }
        const goalEntries = entries.filter((e) => e.rank === 0).sort((a, b) => a.index - b.index);
        const nonGoal = entries.filter((e) => e.rank !== 0);
        // PR-5.26a: re-classify rank-20 Pareto status over the CURRENT pending set
        // before ordering the fill, so a late strong variant can overtake earlier
        // weak ones. The penalty is a pure tie-break WITHIN rank 20 - it never
        // promotes into rank 10, never demotes to rank 30, and never removes a
        // candidate outright.
        if (rank20DynamicPareto) {
          classifyRank20Pareto(entries);
        }
        const paretoPenaltyOf = (e) => (rank20DynamicPareto && e.rank === 20 && e.node.rank20ParetoDominated === true ? 1 : 0);
        const nonGoalByRank = nonGoal.slice().sort((a, b) =>
          (a.rank - b.rank) || (paretoPenaltyOf(a) - paretoPenaltyOf(b)) || (a.index - b.index));
        // The pure PR-5.25s keep set: goals, then (rank, insertion) up to cap.
        const pureFill = new Set();
        for (const e of goalEntries) {
          if (pureFill.size >= pendingCandidateCap) break;
          pureFill.add(e.id);
        }
        for (const e of nonGoalByRank) {
          if (pureFill.size >= pendingCandidateCap) break;
          pureFill.add(e.id);
        }
        // PR-5.26a light telemetry: how the rank-20 Pareto tie-break actually
        // landed, plus how many nondominated rank-20 candidates it rescued from
        // the drop the pure-insertion order would have chosen. `entries` is built
        // by walking `pending` in order, so the rank-20 subsequence is already in
        // insertion order and no extra sort is needed.
        let rank20ParetoTrimInfo = null;
        if (rank20DynamicPareto) {
          const rank20Entries = entries.filter((e) => e.rank === 20);
          const rank0Count = goalEntries.length;
          let rank10Count = 0;
          for (const e of entries) if (e.rank === 10) rank10Count += 1;
          let nondominatedPending = 0;
          let dominatedPending = 0;
          let nondominatedKept = 0;
          let dominatedKept = 0;
          for (const e of rank20Entries) {
            const dominated = e.node.rank20ParetoDominated === true;
            if (dominated) dominatedPending += 1; else nondominatedPending += 1;
            if (pureFill.has(e.id)) {
              if (dominated) dominatedKept += 1; else nondominatedKept += 1;
            }
          }
          const rank20Slots = Math.max(0,
            Math.min(rank20Entries.length, pendingCandidateCap - rank0Count - rank10Count));
          let insertionNondominatedKept = 0;
          for (let i = 0; i < rank20Slots; i += 1) {
            if (rank20Entries[i].node.rank20ParetoDominated !== true) insertionNondominatedKept += 1;
          }
          const paretoNondominatedKeptIdeal = Math.min(rank20Slots, nondominatedPending);
          const rescued = Math.max(0, paretoNondominatedKeptIdeal - insertionNondominatedKept);
          rank20ParetoTrimInfo = {
            nondominatedPending,
            dominatedPending,
            nondominatedKept,
            dominatedKept,
            rank20Slots,
            nondominatedKeptUnderInsertionOrder: insertionNondominatedKept,
            nondominatedRescuedFromDrop: rescued,
          };
          rank20ParetoNondominatedPendingTotal += nondominatedPending;
          rank20ParetoDominatedPendingTotal += dominatedPending;
          rank20ParetoRescuedTotal += rescued;
          if (rescued > 0) rank20ParetoChangedTrims += 1;
        }
        const keep = new Set(pureFill);
        if (fifoHeadId != null) {
          fifoHeadProtectionOpportunities += 1;
          if (!keep.has(fifoHeadId)) {
            // Protect the head. When the pure fill is full, displace its worst
            // kept NON-GOAL candidate; if only goals fill the cap, the head
            // cannot be protected without exceeding cap or dropping a goal.
            let displaced = false;
            if (keep.size >= pendingCandidateCap) {
              for (let i = nonGoalByRank.length - 1; i >= 0; i -= 1) {
                const e = nonGoalByRank[i];
                if (keep.has(e.id)) {
                  keep.delete(e.id);
                  displaced = true;
                  break;
                }
              }
            }
            if (displaced || keep.size < pendingCandidateCap) {
              keep.add(fifoHeadId);
              fifoHeadProtected += 1;
              fifoHeadWouldHaveDroppedWithoutProtection += 1;
              const headNode = nodesById.get(fifoHeadId);
              if (headNode && headNode.guidedAdmitted === true) fifoProtectedNodeWasGuided += 1;
            }
          }
        }
        const droppedIds = entries.filter((e) => !keep.has(e.id)).map((e) => e.id);
        let trimComposition = null;
        // Per-trim memo for the PR-5.25z peer decomposition (declared outside the
        // emitLifecycle block: the drop loop below reads it).
        let peerCache = null;
        if (emitLifecycle) {
          // PR-5.25y observational trim composition (never used for sorting):
          // per-class pending and kept counts plus the rank-20 fill boundary.
          const pendingRankCounts = { 0: 0, 10: 0, 20: 0, 30: 0 };
          const keptRankCounts = { 0: 0, 10: 0, 20: 0, 30: 0 };
          let rank20CutoffPendingSeq = null;
          for (const e of entries) {
            pendingRankCounts[e.rank] = (pendingRankCounts[e.rank] || 0) + 1;
            if (keep.has(e.id)) {
              keptRankCounts[e.rank] = (keptRankCounts[e.rank] || 0) + 1;
              if (e.rank === 20 && (rank20CutoffPendingSeq == null || e.node.pendingSeq > rank20CutoffPendingSeq)) {
                rank20CutoffPendingSeq = e.node.pendingSeq;
              }
            }
          }
          // PR-5.25y Repair 1: distinguish a PURE-FILL drop (the (rank,
          // insertion) fill alone never admitted the node) from a FIFO-HEAD
          // DISPLACEMENT (the pure fill admitted it, then head protection evicted
          // it). Without this split, a rank-20 node evicted by head protection
          // is indistinguishable from a retention anomaly. Observational only -
          // pureFill and keep are the sets the trim already computed above, and
          // none of these counters feed back into retention or scheduling.
          const pureFillRankCounts = { 0: 0, 10: 0, 20: 0, 30: 0 };
          let pureFillRank20CutoffPendingSeq = null;
          for (const e of entries) {
            if (!pureFill.has(e.id)) continue;
            pureFillRankCounts[e.rank] = (pureFillRankCounts[e.rank] || 0) + 1;
            if (e.rank === 20 && (pureFillRank20CutoffPendingSeq == null || e.node.pendingSeq > pureFillRank20CutoffPendingSeq)) {
              pureFillRank20CutoffPendingSeq = e.node.pendingSeq;
            }
          }
          const fifoHeadDisplacedIds = new Set();
          if (fifoHeadId != null && pureFill.has(fifoHeadId) === false && keep.has(fifoHeadId)) {
            for (const e of entries) {
              if (pureFill.has(e.id) && !keep.has(e.id)) fifoHeadDisplacedIds.add(e.id);
            }
          }
          const pureFillRank20Ids = entries
            .filter((e) => e.rank === 20 && pureFill.has(e.id))
            .map((e) => e);
          // PR-5.25z Phase 1 (observational only, opt-in via
          // lifecyclePeerComposition): how many DISTINCT semantic identities the
          // rank-20 class actually holds. This separates "907 different
          // investments" from "a few investments with hundreds of resource/path
          // variants". Identity strings are already stored on the nodes; nothing
          // here is read back into retention.
          let rank20Composition = null;
          if (lifecyclePeerComposition) {
            const identityCounts = new Map();
            const byKind = {};
            const byFloor = {};
            let rank20Pending = 0;
            for (const e of entries) {
              if (e.rank !== 20) continue;
              rank20Pending += 1;
              const idn = e.node.semanticIdentity || "<none>";
              identityCounts.set(idn, (identityCounts.get(idn) || 0) + 1);
              const k = e.node.actionKind || "<none>";
              byKind[k] = (byKind[k] || 0) + 1;
              const f = (e.node.state && e.node.state.floorId) || "<none>";
              byFloor[f] = (byFloor[f] || 0) + 1;
            }
            const topIdentities = [...identityCounts.entries()]
              .sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1))
              .slice(0, 25)
              .map(([identity, count]) => ({ identity, count }));
            // Identity multiplicity histogram: how many identities appear exactly
            // n times. Compact summary of the duplicate structure.
            const multiplicityHistogram = {};
            for (const count of identityCounts.values()) {
              multiplicityHistogram[count] = (multiplicityHistogram[count] || 0) + 1;
            }
            rank20Composition = {
              rank20Pending,
              rank20DistinctIdentities: identityCounts.size,
              rank20DuplicateIdentities: identityCounts.size > 0
                ? [...identityCounts.values()].filter((c) => c > 1).length
                : 0,
              topIdentities,
              multiplicityHistogram,
              byKind,
              byFloor,
            };
          }
          trimComposition = {
            pendingRankCounts,
            keptRankCounts,
            rank20CutoffPendingSeq,
            rank20Pareto: rank20ParetoTrimInfo,
            pureFillRankCounts,
            pureFillRank20CutoffPendingSeq,
            rank20Composition,
            pureFillKeptCount: pureFill.size,
            finalKeepCount: keep.size,
            fifoHeadId,
            fifoHeadProtectedThisTrim: fifoHeadId != null && pureFill.has(fifoHeadId) === false && keep.has(fifoHeadId),
            rank0PlusRank10Pending: pendingRankCounts[0] + pendingRankCounts[10],
            rank20CapacityUnderPureFill: Math.max(0, pendingCandidateCap - pendingRankCounts[0] - pendingRankCounts[10]),
            rank20PendingCount: pendingRankCounts[20],
          };
          trimComposition.fifoHeadDisplacedIds = [...fifoHeadDisplacedIds];
          trimComposition.pureFillRank20Ids = pureFillRank20Ids.map((e) => e.id);
        }
        for (const id of droppedIds) {
          const dn = nodesById.get(id);
          if (dn) {
            dn.dropped = true;
            if (emitLifecycle) {
              const pureFillKept = pureFill.has(id);
              const displaced = trimComposition ? trimComposition.fifoHeadDisplacedIds.includes(id) : false;
              let olderRank20PendingCount = null;
              if (pureFillKept === false) {
                olderRank20PendingCount = 0;
                for (const e of entries) {
                  if (e.rank === 20 && e.node.pendingSeq < dn.pendingSeq) olderRank20PendingCount += 1;
                }
              }
              // PR-5.25z Phase 2 (observational, opt-in): decompose the dropped
              // node's SAME-IDENTITY peers into structural groups and resource
              // vectors, and classify it with the unweighted Pareto comparator.
              // This answers whether the search lost a genuinely new
              // investment opportunity or merely preferred other resource-state
              // variants of the same action. Diagnostic only - no candidate is
              // removed, reordered, or promoted because of this, and a
              // structural key is NOT treated as a proven future-legality
              // equivalence.
              let sameIdentityPeers = null;
              if (lifecyclePeerComposition) {
                const identity = dn.semanticIdentity || null;
                // Per-trim memo: several dropped nodes in one trim can share an
                // identity, and recomputing every peer's structural key for each
                // of them is the dominant cost of this diagnostic. The peer set
                // depends only on (entries, identity), both fixed for the trim.
                if (!peerCache) peerCache = new Map();
                let cached = peerCache.get(identity);
                if (!cached) {
                  const structuralKeys = new Set();
                  const collected = [];
                  for (const e of entries) {
                    if (e.node === dn) continue;
                    if ((e.node.semanticIdentity || null) !== identity) continue;
                    const pk = e.node.state ? buildStructuralStateKey(e.node.state) : null;
                    if (pk != null) structuralKeys.add(pk);
                    collected.push({
                      nodePendingSeq: e.node.pendingSeq,
                      pureFillKept: pureFill.has(e.id),
                      kept: keep.has(e.id),
                      structuralKey: pk,
                      resourceVector: e.node.state ? extractResourceVector(e.node.state) : null,
                    });
                  }
                  cached = { collected, distinctStructuralKeys: structuralKeys.size };
                  peerCache.set(identity, cached);
                }
                const structuralKeyOfDropped = dn.state ? buildStructuralStateKey(dn.state) : null;
                const vecOfDropped = dn.state ? extractResourceVector(dn.state) : null;
                let pendingCount = 0;
                let pureFillKeptCount = 0;
                let droppedCount = 0;
                let structuralGroupSize = 0;
                // Complete Pareto accounting over ALL peers in the dropped node's
                // structural group (not the truncated evidence window). Counters
                // are computed over the full set so the ratio is well defined;
                // only the variant LIST is capped, and only for payload size.
                let sameGroupKeptCount = 0;
                let dominatedByRetainedCount = 0;
                let dominatesRetainedCount = 0;
                let incomparableRetainedCount = 0;
                const variants = [];
                for (const v of cached.collected) {
                  pendingCount += 1;
                  if (v.pureFillKept) pureFillKeptCount += 1;
                  if (!v.kept) droppedCount += 1;
                  const sameGroup = v.structuralKey != null && v.structuralKey === structuralKeyOfDropped;
                  if (sameGroup) {
                    structuralGroupSize += 1;
                    if (v.kept && v.resourceVector && vecOfDropped) {
                      sameGroupKeptCount += 1;
                      if (paretoDominates(v.resourceVector, vecOfDropped)) dominatedByRetainedCount += 1;
                      else if (paretoDominates(vecOfDropped, v.resourceVector)) dominatesRetainedCount += 1;
                      else incomparableRetainedCount += 1;
                    }
                  }
                  if (variants.length < PEER_VARIANT_LIMIT) {
                    variants.push({
                      nodePendingSeq: v.nodePendingSeq,
                      pureFillKept: v.pureFillKept,
                      kept: v.kept,
                      structuralKey: v.structuralKey,
                      resourceVector: v.resourceVector,
                      sameStructuralGroup: sameGroup,
                    });
                  }
                }
                sameIdentityPeers = {
                  identity,
                  pendingCount,
                  pureFillKeptCount,
                  droppedCount,
                  distinctStructuralKeys: cached.distinctStructuralKeys,
                  structuralGroupSize,
                  sameGroupKeptCount,
                  dominatedByRetainedCount,
                  dominatesRetainedCount,
                  incomparableRetainedCount,
                  variantsTruncated: pendingCount > variants.length,
                  variants,
                  droppedStructuralKey: structuralKeyOfDropped,
                  droppedResourceVector: vecOfDropped,
                };
              }
              emitLifecycle({
                type: "dropped",
                exactKey: dn.key,
                nodeId: dn.id,
                rankClass: pendingRank(dn),
                kind: dn.actionKind,
                semanticIdentity: dn.semanticIdentity || null,
                rank20ParetoDominated: rank20DynamicPareto && dn.rank20ParetoDominated === true,
                frontierGuided: dn.frontierGuided === true,
                guidedAdmitted: dn.guidedAdmitted === true,
                skylineDominated: dn.frontierGuided === true && dn.paretoAdmitted === false,
                nodePendingSeq: dn.pendingSeq,
                pureFillKept,
                displacedByFifoHeadProtection: displaced,
                olderRank20PendingCount,
                sameIdentityPeers,
                trim: trimComposition,
              });
            }
          }
        }
        candidatesDropped += droppedIds.length;
        for (const id of droppedIds) {
          const droppedNode = nodesById.get(id);
          if (droppedNode && droppedNode.guidedAdmitted === true) {
            noteGuidedRemoved();
            if (emitGuidedPoolTelemetry) guidedPoolRemovedByDrop += 1;
          }
        }
        // PR-5.26i: release the world state of dropped candidates. Deliberately
        // placed AFTER the drop lifecycle/peer-composition events above (which
        // read `dn.state` to build the same-identity variant view) and after the
        // guided counter bookkeeping, so nothing observable changes except the
        // payload's reachability.
        //
        // V1 releases the state and nothing else: `key`, `parentId`, `pendingSeq`,
        // `macroChain`, `macroTrace`, `semanticIdentity`, the rank fields, and
        // `dropped` are all kept, the registry shape is untouched, and `closed` is
        // NOT set (a dropped node is not an expanded node).
        if (reclaimDroppedState) {
          for (const id of droppedIds) {
            const droppedNode = nodesById.get(id);
            if (droppedNode && droppedNode.state) {
              droppedNode.state = null;
              droppedStatesReclaimed += 1;
            }
          }
        }
        pending.length = 0;
        for (const e of entries) if (keep.has(e.id)) pending.push(e.id);
        if (livePendingIds) {
          livePendingIds.clear();
          for (const e of entries) if (keep.has(e.id)) livePendingIds.add(e.id);
        }
        // PR-5.26h: guided-pool occupancy and composition, measured on the
        // POST-trim pool. Read-only: `entries`/`keep` are the trim's own
        // structures and rankClassOf() never caches.
        if (emitGuidedPoolTelemetry) {
          const cap = pendingCandidateCap;
          let keptTotal = 0;
          let keptRank0 = 0;
          let keptRank10 = 0;
          let keptRank20 = 0;
          let keptRank30 = 0;
          for (const e of entries) {
            if (!keep.has(e.id)) continue;
            keptTotal += 1;
            if (e.rank === 0) keptRank0 += 1;
            else if (e.rank === 10) keptRank10 += 1;
            else if (e.rank === 20) keptRank20 += 1;
            else keptRank30 += 1;
          }
          const fraction = cap > 0 ? keptRank10 / cap : 0;
          guidedPoolTrims += 1;
          guidedPoolRank10FracSum += fraction;
          if (guidedPoolRank10FracMin == null || fraction < guidedPoolRank10FracMin) guidedPoolRank10FracMin = fraction;
          if (guidedPoolRank10FracMax == null || fraction > guidedPoolRank10FracMax) guidedPoolRank10FracMax = fraction;
          if (fraction >= 0.9) {
            guidedPoolTrimsGe90 += 1;
            if (guidedPoolFirstExpansionGe90 == null) guidedPoolFirstExpansionGe90 = strategicExpansions;
          }
          if (fraction >= 0.99) {
            guidedPoolTrimsGe99 += 1;
            if (guidedPoolFirst99Snapshot == null) {
              guidedPoolFirst99Snapshot = buildGuidedPoolSnapshot("FIRST_99_PERCENT_GUIDED_SATURATION");
            }
          }
          guidedPoolFinalTrim = {
            strategicExpansion: strategicExpansions,
            cap,
            keptTotal,
            keptRank0,
            keptRank10,
            keptRank20,
            keptRank30,
            rank10OccupancyFraction: fraction,
          };
        }
        // PR-5.26g: reclaim ids of nodes that have since been expanded or
        // dropped. Amortized O(cap) and bounded; membership is never allowed to
        // grow with total admissions.
        if (guidedGroups && guidedGroupTrackedIds > guidedGroupSweepThreshold) {
          guidedGroups.clear();
          guidedGroupTrackedIds = 0;
          for (const id of livePendingIds) {
            const liveNode = nodesById.get(id);
            if (!liveNode || liveNode.guidedAdmitted !== true || liveNode.retroGuidedGroupKey == null) continue;
            addGuidedGroupMember(liveNode.retroGuidedGroupKey, id);
          }
          guidedGroupSweeps += 1;
        }
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

    /**
     * PR-5.26b diagnostic: what was still queued when the budget ended.
     *
     * Opt-in (config.emitPendingSnapshot) and built only after the search loop
     * has finished, so it cannot influence scheduling, retention, or
     * termination. Size is bounded by the candidate cap, which is the point:
     * it answers "how much backlog stood between a retained node and service".
     */
    const buildPendingSnapshot = () => {
      const liveIds = livePendingIds || new Set(pending);
      let liveNeutralPending = 0;
      const neutralIndexById = new Map();
      const liveAheadById = new Map();
      if (neutralQueue) {
        let liveAhead = 0;
        for (let i = neutralHead; i < neutralQueue.length; i += 1) {
          const id = neutralQueue[i];
          neutralIndexById.set(id, i);
          liveAheadById.set(id, liveAhead);
          if (liveIds.has(id)) {
            liveAhead += 1;
            liveNeutralPending += 1;
          }
        }
      }
      let guidedHeapLiveCount = 0;
      if (guidedHeap) {
        for (const entry of guidedHeap) if (liveIds.has(entry.nodeId)) guidedHeapLiveCount += 1;
      }
      const limit = Number.isFinite(config.pendingSnapshotLimit) && config.pendingSnapshotLimit > 0
        ? Math.floor(config.pendingSnapshotLimit)
        : 2048;
      const nodes = [];
      for (const id of pending) {
        if (nodes.length >= limit) break;
        const node = nodesById.get(id);
        if (!node) continue;
        const neutralIndex = neutralIndexById.has(id) ? neutralIndexById.get(id) : null;
        nodes.push({
          exactKey: node.key,
          nodeId: id,
          pendingSeq: node.pendingSeq,
          rankClass: pendingRank(node),
          combatProgress: node.combatProgress === true,
          guidedAdmitted: node.guidedAdmitted === true,
          registeredAtExpansion: node.registeredAtStrategicExpansion,
          depth: node.depth,
          neutralQueueAbsoluteIndex: neutralIndex,
          // Serviceable backlog ahead of this node in the neutral lane: entries
          // that are still live pending work, not consumed/closed leftovers.
          neutralQueueLiveAhead: neutralIndex == null ? null : liveAheadById.get(id),
          neutralQueueIndexFromHead: neutralIndex == null ? null : neutralIndex - neutralHead,
        });
      }
      return {
        schema: "pr526b-pending-snapshot/v1",
        nodes,
        nodesTruncated: pending.length > nodes.length,
        livePendingTotal: pending.length,
        pendingCapacityHint: pendingCandidateCap,
        // Repair 1 self-check: the opt-in mirror must agree with `pending`, or
        // every live-ahead figure derived from it would be silently wrong.
        pendingMirrorConsistent: livePendingIds ? livePendingIds.size === pending.length : null,
        guidedExpansions,
        neutralExpansions,
        neutralHead,
        neutralQueueLength: neutralQueue ? neutralQueue.length - neutralHead : null,
        liveNeutralPending,
        guidedHeapLiveCount,
        strategicExpansions,
      };
    };

    let liveGuidedPendingAtEnd = 0;
    let rank10PendingAtEnd = 0;
    let retroDemotedStillPendingAtEnd = 0;
    for (const id of pending) {
      const node = nodesById.get(id);
      if (!node || node.closed) continue;
      if (node.guidedAdmitted === true) liveGuidedPendingAtEnd += 1;
      // Derived from the rank function rather than the flag, so a divergence
      // between "is guided" and "is rank 10" would show up instead of hiding.
      if (rankClassOf(node) === 10) rank10PendingAtEnd += 1;
      if (node.guidedRetroDemoted === true) retroDemotedStillPendingAtEnd += 1;
    }

    if (emitGuidedPoolTelemetry) {
      guidedPoolEndSnapshot = buildGuidedPoolSnapshot("END");
    }

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
      rank20DynamicPareto,
      rank20ParetoRecomputedGroups,
      rank20ParetoNondominatedPendingTotal,
      rank20ParetoDominatedPendingTotal,
      rank20ParetoRescuedTotal,
      rank20ParetoChangedTrims,
      // PR-5.26c
      neutralParetoSubstitution,
      neutralParetoSubstitutions,
      neutralParetoSubstitutionScans,
      // PR-5.26b: present only when config.emitPendingSnapshot is set.
      pendingSnapshot: config.emitPendingSnapshot === true ? buildPendingSnapshot() : null,
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
      guidedChangeFloorGenerated,
      guidedChangeFloorNodesExpanded,
      guidedForwardFloorChildrenGenerated,
      frontierGuidedGenerated,
      guidedAdmittedGenerated,
      frontierGuidedDominatedGenerated,
      frontierGuidedByKind,
      guidedAdmittedByKind,
      guidedScoreHistogram: emitGuidedServiceTelemetry ? guidedScoreHistogram : null,
      guidedPriorityMapProvided: emitGuidedServiceTelemetry ? Boolean(priorityMap) : null,
      stableGuidedTieBreak,
      retroactiveGuidedSkylineDemotion,
      guidedRetroDemotions,
      guidedRetroDemotionScans,
      guidedGroupTrackedIds,
      guidedGroupSweeps,
      guidedGroupSweepThreshold,
      guidedHeapStaleDemotionSkips,
      guidedActivePeak,
      liveGuidedPendingAtEnd,
      rank10PendingAtEnd,
      retroDemotedStillPendingAtEnd,
      guidedPool: emitGuidedPoolTelemetry
        ? {
          trims: guidedPoolTrims,
          finalKeepRank: guidedPoolFinalTrim
            ? {
              rank0: guidedPoolFinalTrim.keptRank0,
              rank10: guidedPoolFinalTrim.keptRank10,
              rank20: guidedPoolFinalTrim.keptRank20,
              rank30: guidedPoolFinalTrim.keptRank30,
              keptTotal: guidedPoolFinalTrim.keptTotal,
              cap: guidedPoolFinalTrim.cap,
              strategicExpansion: guidedPoolFinalTrim.strategicExpansion,
            }
            : null,
          rank10OccupancyFraction: {
            min: guidedPoolRank10FracMin,
            max: guidedPoolRank10FracMax,
            mean: guidedPoolTrims > 0 ? guidedPoolRank10FracSum / guidedPoolTrims : null,
          },
          trimsWithRank10Ge90PercentCap: guidedPoolTrimsGe90,
          trimsWithRank10Ge99PercentCap: guidedPoolTrimsGe99,
          firstExpansionRank10Ge90PercentCap: guidedPoolFirstExpansionGe90,
          flow: {
            guidedAdmitted: guidedAdmittedGenerated,
            guidedPendingRemovedByExpansion: guidedPoolRemovedByExpansion,
            guidedPendingRemovedByDrop: guidedPoolRemovedByDrop,
            liveGuidedPendingAtEnd,
            liveGuidedCounterAtEnd: liveGuidedCount,
          },
          snapshots: {
            first99PercentGuidedSaturation: guidedPoolFirst99Snapshot,
            end: guidedPoolEndSnapshot,
          },
        }
        : null,
      frontierGuidedDominatedByKind,
      fifoHeadProtectionOpportunities,
      fifoHeadProtected,
      fifoHeadWouldHaveDroppedWithoutProtection,
      fifoProtectedNodeWasGuided,
      combatProgressGenerated,
      combatProgressAdmittedGenerated,
      resourceVariantPressure,
      searchComplete: !goalNode && !stoppedReason && !frontierOpen && closureTruncations === 0,
      wallMs: Date.now() - startedAt,
      peakRssMb: Math.round(peakRssMb * 10) / 10,
      reclaimDroppedState,
      droppedStatesReclaimed,
      peakHeapUsedMb: trackPeakHeapUsed ? Math.round(peakHeapUsedMb * 10) / 10 : null,
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
  guidedHeapPush,
  guidedHeapPop,
  guidedComesBefore,
  isCombatProgressTransition,
  poiToSemanticIdentity,
  stableFlags,
  transportSignature,
};
