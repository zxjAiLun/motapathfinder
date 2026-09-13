"use strict";
/**
 * PR-5.25s - Bounded Retention Contract micro.
 *
 * Locks the cap-retention contract against the guided scheduler with a fully
 * controlled stub world, and documents the bug it repairs.
 *
 * PROVEN PRE-REPAIR BEHAVIOR (recorded in docs/260912/5-25s.md):
 *   pendingRank() gave rank 10 to EVERY child with frontierGuided=true.
 *   paretoAdmitted=true was only assigned inside the frontier-match branch,
 *   so paretoAdmitted => frontierGuided and the documented rank-20 Pareto
 *   retention tier was unreachable. A frontier-matched child that the
 *   resource skyline DOMINATED never entered the guided heap (the scheduler
 *   treated it as neutral) yet still carried frontierGuided=true, so bounded
 *   cap retention kept it as a rank-10 VIP over neutral candidates.
 *
 * Scenario (stub world, generation order A, C, B, pendingCandidateCap = 2):
 *   Root (MT1, hp 100, money 0) offers three strategic actions:
 *     e1 -> A: hp 102,  identity event:MT1:1,1  (in frontier; first skyline
 *               insert => nondominated => guided heap => rank 10)
 *     e3 -> C: money 1, identity event:MT1:3,1  (NOT in frontier => neutral;
 *               expanding C is the ONLY path to the goal)
 *     e2 -> B: hp 101,  identity event:MT1:2,1  (in frontier; same structural
 *               key as A, strictly worse hp => skyline dominated => scheduler
 *               neutral; pre-repair still retention rank 10 - the bug)
 *   A and B share one structural state key (same loc/flags; only hp differs).
 *   C's state offers e4 -> the MT2 goal state.
 *
 *   Pre-repair retention keeps {A, B} (rank 10 + index) and drops C, so the
 *   goal is unreachable (found=false) even though a neutral candidate held
 *   the only goal path.
 *   Corrected retention keeps {A (guidedAdmitted), C (neutral, earlier index)}
 *   and drops B (dominated => neutral), so the goal is found.
 *
 * LOCKED CONTRACT (as of PR-5.26a):
 *   CAP_RETENTION = GOAL > ACTUALLY_GUIDED_ADMITTED > RANK20_PARETO_NONDOMINATED
 *                   > RANK20_PARETO_DOMINATED > ORDINARY_NEUTRAL
 *   frontierGuided = structural classification (identity in autonomous frontier)
 *   guidedAdmitted = frontierGuided AND passed resource skyline admission
 *                    AND inserted into the guided heap
 *   rank 20 = combatProgress (permanent combat-stat growth), and WITHIN rank 20
 *             the tie-break is trim-time dynamic Pareto status by
 *             (semanticIdentity + structural state key), then insertion order.
 *             It is a RETENTION TIE-BREAK ONLY: never a promotion into rank 10,
 *             never a demotion to rank 30, never a hard prune of a dominated
 *             candidate at generation time.
 *   paretoAdmitted (the skyline query inside the frontier branch) is still the
 *   rank-10 admission signal; the rank-20 mechanism is a separate trim-time
 *   reclassification and deliberately does NOT reuse that append-only skyline,
 *   because a prior-seen skyline cannot demote a variant dominated by a LATER
 *   arrival.
 */

const fs = require("fs");
const path = require("path");

const { cloneState } = require("./lib/state");
const { buildStateKey } = require("./lib/state-key");
const { createTransportCollapsedSearch } = require("./lib/transport-collapse");

const DEFAULT_OUT = path.resolve(__dirname, "routes", "generated", "pr525s-bounded-retention-contract.json");

function stubState() {
  return {
    floorId: "MT1",
    hero: {
      hp: 100, hpmax: 100, mana: 0, manamax: 0, atk: 1, def: 0, mdef: 0, money: 0, exp: 0, lv: 1,
      loc: { x: 0, y: 0, direction: "down" },
      equipment: [], followers: [],
    },
    inventory: {}, flags: {}, floorStates: {}, triggeredAutoEvents: {}, visitedFloors: { MT1: true },
    route: [], notes: [], meta: { decisionDepth: 0, rawRouteLength: 0 },
  };
}

function stubAction(summary, x, y, apply) {
  return { kind: "event", summary, x, y, stance: { x: 0, y: 0 }, __apply: apply };
}

function createStubSimulator() {
  return {
    project: {},
    enumeratePrimitiveActions(state) {
      if (state.floorId === "MT1" && state.hero.hp === 100 && (state.hero.money || 0) === 0) {
        return { actions: [
          stubAction("e1:hp+2", 1, 1, (s) => { s.hero.hp += 2; }),   // -> A (frontier, nondominated)
          stubAction("e3:pathC", 3, 1, (s) => { s.hero.money += 1; }), // -> C (neutral, only goal path)
          stubAction("e2:hp+1", 2, 1, (s) => { s.hero.hp += 1; }),   // -> B (frontier, dominated by A)
        ] };
      }
      if (state.floorId === "MT1" && (state.hero.money || 0) === 1) {
        return { actions: [
          stubAction("e4:goal", 4, 1, (s) => { s.floorId = "MT2"; s.hero.money += 1; }),
        ] };
      }
      return { actions: [] };
    },
    applyAction(state, action) {
      const next = cloneState(state);
      if (typeof action.__apply === "function") action.__apply(next);
      return next;
    },
  };
}

function runScenario() {
  const simulator = createStubSimulator();
  const search = createTransportCollapsedSearch(simulator);
  const frontierSet = new Set(["event:MT1:1,1", "event:MT1:2,1"]);
  return search.search(stubState(), {
    isGoalState: (state) => state.floorId === "MT2",
    frontierSet,
    resourceSkylinePriority: true,
    pendingCandidateCap: 2,
    maxExpansions: 1000,
    maxRuntimeMs: 10000,
    maxClosureStates: 1000,
  });
}

function runScenarioWithObserver(onCandidateLifecycle) {
  const simulator = createStubSimulator();
  const search = createTransportCollapsedSearch(simulator);
  const frontierSet = new Set(["event:MT1:1,1", "event:MT1:2,1"]);
  return search.search(stubState(), {
    isGoalState: (state) => state.floorId === "MT2",
    frontierSet,
    resourceSkylinePriority: true,
    pendingCandidateCap: 2,
    maxExpansions: 1000,
    maxRuntimeMs: 10000,
    maxClosureStates: 1000,
    onCandidateLifecycle,
  });
}

// --- PR-5.25u fairness-starvation scenario --------------------------------
//
// cap = 6, neutralEvery = 5. The root generates F first (a FIFO-only
// candidate whose expansion is the ONLY path to the goal) and then six
// guidedAdmitted dead ends (distinct structural keys, so none is
// skyline-dominated). The scheduler promises a neutral FIFO turn every 6
// expansions, but the pre-reserve trim sorts by (rank, insertion), keeps the
// six guided candidates and drops F - the promised FIFO opportunity no
// longer exists at scheduling time. The corrected FIFO reserve retains the
// oldest pending candidate(s) so F survives and the goal is found.

function starvationStubState() {
  return {
    floorId: "MT1",
    hero: {
      hp: 100, hpmax: 100, mana: 0, manamax: 0, atk: 1, def: 0, mdef: 0, money: 0, exp: 0, lv: 1,
      loc: { x: 0, y: 0, direction: "down" },
      equipment: [], followers: [],
    },
    inventory: {}, flags: {}, floorStates: {}, triggeredAutoEvents: {}, visitedFloors: { MT1: true },
    route: [], notes: [], meta: { decisionDepth: 0, rawRouteLength: 0 },
  };
}

function starvationAction(summary, x, y, apply) {
  return { kind: "event", summary, x, y, stance: { x: 0, y: 0 }, __apply: apply };
}

function createStarvationSimulator() {
  return {
    project: {},
    enumeratePrimitiveActions(state) {
      if (state.floorId === "MT1" && state.hero.hp === 100 && (state.hero.money || 0) === 0) {
        const actions = [starvationAction("f:path", 3, 0, (s) => { s.hero.money += 1; })];
        for (let i = 1; i <= 6; i += 1) {
          actions.push(starvationAction(`g${i}:dead`, 1, i, (s) => { s.hero.hp += 1; s.flags.g = i; }));
        }
        return { actions };
      }
      if (state.floorId === "MT1" && (state.hero.money || 0) === 1) {
        return { actions: [starvationAction("fgoal:goal", 3, 1, (s) => { s.floorId = "MT2"; s.hero.money += 1; })] };
      }
      return { actions: [] };
    },
    applyAction(state, action) {
      const next = cloneState(state);
      if (typeof action.__apply === "function") action.__apply(next);
      return next;
    },
  };
}

function runStarvationScenario(onCandidateLifecycle) {
  const simulator = createStarvationSimulator();
  const search = createTransportCollapsedSearch(simulator);
  const frontierSet = new Set(["event:MT1:1,1", "event:MT1:1,2", "event:MT1:1,3", "event:MT1:1,4", "event:MT1:1,5", "event:MT1:1,6"]);
  return search.search(starvationStubState(), {
    isGoalState: (state) => state.floorId === "MT2",
    frontierSet,
    resourceSkylinePriority: true,
    pendingCandidateCap: 6,
    neutralEvery: 5,
    maxExpansions: 1000,
    maxRuntimeMs: 10000,
    maxClosureStates: 1000,
    onCandidateLifecycle,
  });
}

// --- PR-5.25v FIFO head turnover scenario ----------------------------------
//
// cap = 2. Root generates H (guidedAdmitted dead end) and G1 (guidedAdmitted,
// dead end that generates the next wave). Both are consumed via the guided
// heap BEFORE any contested trim. G1's wave - enumerated C1 first - then
// overflows the pool: the contested trim's head is C1, a MID-RUN-created
// neutral candidate that the pure (rank, insertion) fill would drop behind
// G2/G3. Head protection must advance to C1 and keep it; the goal is
// reachable only through C1. This proves the protection tracks the neutral
// queue contract (whoever is next), not a fixed node or an action class.

function turnoverStubState() {
  return {
    floorId: "MT1",
    hero: {
      hp: 100, hpmax: 100, mana: 0, manamax: 0, atk: 1, def: 0, mdef: 0, money: 0, exp: 0, lv: 1,
      loc: { x: 0, y: 0, direction: "down" },
      equipment: [], followers: [],
    },
    inventory: {}, flags: {}, floorStates: {}, triggeredAutoEvents: {}, visitedFloors: { MT1: true },
    route: [], notes: [], meta: { decisionDepth: 0, rawRouteLength: 0 },
  };
}

function createTurnoverSimulator() {
  return {
    project: {},
    enumeratePrimitiveActions(state) {
      if (state.floorId === "MT1" && !state.flags.h && !state.flags.g1 && (state.hero.money || 0) === 0) {
        return { actions: [
          starvationAction("h:dead", 1, 0, (s) => { s.flags.h = 1; }),
          starvationAction("g1:wave", 1, 1, (s) => { s.flags.g1 = 1; }),
        ] };
      }
      if (state.floorId === "MT1" && state.flags.g1 === 1 && !state.flags.g2 && !state.flags.g3 && (state.hero.money || 0) === 0) {
        return { actions: [
          starvationAction("c1:path", 3, 0, (s) => { s.hero.money += 1; }),
          starvationAction("g2:dead", 1, 2, (s) => { s.flags.g2 = 1; }),
          starvationAction("g3:dead", 1, 3, (s) => { s.flags.g3 = 1; }),
        ] };
      }
      if (state.floorId === "MT1" && (state.hero.money || 0) === 1) {
        return { actions: [starvationAction("cgoal:goal", 3, 1, (s) => { s.floorId = "MT2"; s.hero.money += 1; })] };
      }
      return { actions: [] };
    },
    applyAction(state, action) {
      const next = cloneState(state);
      if (typeof action.__apply === "function") action.__apply(next);
      return next;
    },
  };
}

function runTurnoverScenario(onCandidateLifecycle) {
  const simulator = createTurnoverSimulator();
  const search = createTransportCollapsedSearch(simulator);
  const frontierSet = new Set(["event:MT1:1,0", "event:MT1:1,1", "event:MT1:1,2", "event:MT1:1,3"]);
  return search.search(turnoverStubState(), {
    isGoalState: (state) => state.floorId === "MT2",
    frontierSet,
    resourceSkylinePriority: true,
    pendingCandidateCap: 2,
    neutralEvery: 5,
    maxExpansions: 1000,
    maxRuntimeMs: 10000,
    maxClosureStates: 1000,
    onCandidateLifecycle,
  });
}

// --- PR-5.25x combat-progress rank-20 scenario ------------------------------
//
// cap = 2. Root generates G (guidedAdmitted dead end), N1 (ordinary neutral
// dead end), R (a transition that permanently raises ATK - the only path to
// the goal), N2 (ordinary neutral dead end), in that order. Under the pure
// (rank, insertion) fill with the PR-5.25x rank-20 class, the contested trim
// keeps {G, R} and drops both ordinary neutrals; R is then expanded through
// the neutral/FIFO lane (it never enters the guided heap) and the goal is
// found. Without the rank-20 class R was an ordinary neutral and the fill
// kept N1 instead - the goal was unreachable.

function combatProgressStubState() {
  return {
    floorId: "MT1",
    hero: {
      hp: 100, hpmax: 100, mana: 0, manamax: 0, atk: 1, def: 0, mdef: 0, money: 0, exp: 0, lv: 1,
      loc: { x: 0, y: 0, direction: "down" },
      equipment: [], followers: [],
    },
    inventory: {}, flags: {}, floorStates: {}, triggeredAutoEvents: {}, visitedFloors: { MT1: true },
    route: [], notes: [], meta: { decisionDepth: 0, rawRouteLength: 0 },
  };
}

function createCombatProgressSimulator() {
  return {
    project: {},
    enumeratePrimitiveActions(state) {
      if (state.floorId === "MT1" && !state.flags.g && !state.flags.r && (state.hero.money || 0) === 0 && state.hero.atk === 1) {
        return { actions: [
          starvationAction("g:dead", 1, 0, (s) => { s.flags.g = 1; }),
          starvationAction("n1:dead", 2, 0, (s) => { s.hero.money += 1; }),
          starvationAction("r:invest", 3, 0, (s) => { s.hero.atk += 1; s.flags.r = 1; }),
          starvationAction("n2:dead", 4, 0, (s) => { s.hero.money += 2; }),
        ] };
      }
      if (state.floorId === "MT1" && state.flags.r === 1) {
        return { actions: [starvationAction("rgoal:goal", 3, 1, (s) => { s.floorId = "MT2"; s.hero.money += 1; })] };
      }
      return { actions: [] };
    },
    applyAction(state, action) {
      const next = cloneState(state);
      if (typeof action.__apply === "function") action.__apply(next);
      return next;
    },
  };
}

function runCombatProgressScenario(onCandidateLifecycle, extraOptions) {
  const simulator = createCombatProgressSimulator();
  const search = createTransportCollapsedSearch(simulator);
  const frontierSet = new Set(["event:MT1:1,0"]);
  return search.search(combatProgressStubState(), {
    isGoalState: (state) => state.floorId === "MT2",
    frontierSet,
    resourceSkylinePriority: true,
    pendingCandidateCap: 2,
    neutralEvery: 5,
    maxExpansions: 1000,
    maxRuntimeMs: 10000,
    maxClosureStates: 1000,
    onCandidateLifecycle,
    ...(extraOptions || {}),
  });
}

/** Bounded-pool invariant from the observer event stream: after every trim
 * (dropped-event batch) and at the end, the live pending count must be within
 * the configured cap. Transient registration overflow is by design - the cap
 * is enforced after each expansion completes. */
function maxPendingFromEvents(events) {
  let registered = 0;
  let dropped = 0;
  let expanded = 0;
  let max = 0;
  for (const event of events) {
    if (event.type === "registered") registered += 1;
    else if (event.type === "dropped") {
      dropped += 1;
      const live = Math.max(0, registered - dropped - expanded);
      if (live > max) max = live;
    } else if (event.type === "expanded") expanded += 1;
  }
  const finalLive = Math.max(0, registered - dropped - expanded);
  if (finalLive > max) max = finalLive;
  return max;
}

function main() {
  const outPath = (() => {
    const arg = process.argv.slice(2).find((t) => t.startsWith("--out="));
    return arg ? path.resolve(arg.slice("--out=".length)) : DEFAULT_OUT;
  })();

  const result = runScenario();
  const routeSummaries = Array.isArray(result.route) ? result.route : [];

  // PR-5.25t observer-inertness micro: the same scenario run with a lifecycle
  // observer that returns arbitrary junk must produce IDENTICAL results. This
  // permanently locks ORACLE_KEYS_AFFECT_SEARCH_DECISIONS = FALSE: the
  // observation channel can record, never steer.
  const observerEvents = [];
  const junkReturns = [false, 0, "", { steer: "attempt" }, NaN, undefined, () => "junk"];
  const observed = runScenarioWithObserver((event) => {
    observerEvents.push(event.type);
    return junkReturns[observerEvents.length % junkReturns.length];
  });
  const inertnessFailures = [];
  const inertnessFields = [
    "found", "route", "candidatesDropped", "strategicExpansions", "stoppedReason", "searchComplete",
    "frontierGuidedGenerated", "guidedAdmittedGenerated", "frontierGuidedDominatedGenerated",
  ];
  for (const field of inertnessFields) {
    const a = JSON.stringify(result[field]);
    const b = JSON.stringify(observed[field]);
    if (a !== b) inertnessFailures.push({ label: `observer-inert-${field}`, detail: `baseline=${a} observed=${b}` });
  }
  if (observerEvents.length === 0) inertnessFailures.push({ label: "observer-saw-events", detail: "observer recorded nothing" });

  const failures = [];
  let pr526aLateDominator = null;
  let pr526aIncomparable = null;
  const check = (ok, label, detail) => {
    if (!ok) failures.push({ label, detail });
    return ok;
  };
  failures.push(...inertnessFailures);

  // Cap invariant on the PR-5.25s scenario from the observer stream.
  const maxPendingDominated = maxPendingFromEvents(observerEvents);
  check(maxPendingDominated <= 2, "cap-invariant-dominated-frontier", `maxPending=${maxPendingDominated} cap=2`);

  // PR-5.25u fairness-starvation micro, restated under the PR-5.25v head
  // contract: F is the earliest FIFO candidate and the only goal path, so the
  // next live neutralQueue head IS F, and head survival must keep it alive.
  const starvationEvents = [];
  const starvation = runStarvationScenario((event) => {
    starvationEvents.push(event);
    return null;
  });
  const starvationRoute = Array.isArray(starvation.route) ? starvation.route : [];
  check(starvation.found === true, "fifo-lane-survives-cap",
    `found=${starvation.found} stopped=${starvation.stoppedReason} dropped=${starvation.candidatesDropped}`);
  check(JSON.stringify(starvationRoute) === JSON.stringify(["f:path", "fgoal:goal"]),
    "route-through-fifo-candidate", JSON.stringify(starvationRoute));
  check(starvation.candidatesDropped === 1, "starvation-exactly-one-drop", `dropped=${starvation.candidatesDropped}`);
  check(starvation.fifoHeadProtectionOpportunities >= 1 && starvation.fifoHeadProtected >= 1,
    "fifo-head-protected", `opportunities=${starvation.fifoHeadProtectionOpportunities} protected=${starvation.fifoHeadProtected}`);
  check(starvation.fifoHeadWouldHaveDroppedWithoutProtection >= 1,
    "fifo-head-would-have-dropped", `got=${starvation.fifoHeadWouldHaveDroppedWithoutProtection}`);
  check(starvation.fifoProtectedNodeWasGuided === 0,
    "protected-head-was-non-guided", `got=${starvation.fifoProtectedNodeWasGuided}`);
  // PR-5.25y Repair 1: the starvation drop must be POSITIVELY attributed to FIFO
  // head displacement, not left ambiguous. Under the pre-repair telemetry this
  // node reports `rankClass=10, dropped, seq <= cutoff`, which is exactly the
  // signature that could be misread as a retention anomaly (Case C). The repair
  // shows the truth: the node survived the PURE FILL (rank0+rank10 = 6 = cap)
  // and was then evicted by head protection, so it is Case C, a designed
  // consequence of the FIFO guarantee.
  {
    const dropped = starvationEvents.filter((e) => e.type === "dropped");
    check(dropped.length === 1, "starvation-one-dropped-event", `got=${dropped.length}`);
    const d = dropped[0];
    check(d.pureFillKept === true, "starvation-drop-survived-pure-fill", `pureFillKept=${d.pureFillKept}`);
    check(d.displacedByFifoHeadProtection === true, "starvation-drop-is-head-displacement",
      `displaced=${d.displacedByFifoHeadProtection}`);
    const t = d.trim;
    check(t && t.pureFillRankCounts != null && t.keptRankCounts != null,
      "starvation-trim-has-both-fill-and-keep-counts", JSON.stringify(t && Object.keys(t)));
    // The pure fill kept 6 and the final keep kept 6, but they are NOT the same
    // set: head protection swapped one rank-10 node out for the rank-30 head.
    check(t.pureFillKeptCount === t.finalKeepCount,
      "starvation-cap-preserved-across-displacement",
      `pureFillKeptCount=${t.pureFillKeptCount} finalKeepCount=${t.finalKeepCount}`);
    check(Array.isArray(t.fifoHeadDisplacedIds) && t.fifoHeadDisplacedIds.length === 1,
      "starvation-exactly-one-displaced-id", JSON.stringify(t.fifoHeadDisplacedIds));
    check(t.fifoHeadProtectedThisTrim === true, "starvation-head-protected-this-trim",
      `got=${t.fifoHeadProtectedThisTrim}`);
    check(t.rank0PlusRank10Pending >= 6 && t.rank20CapacityUnderPureFill === 0,
      "starvation-higher-ranks-exhaust-cap",
      `base=${t.rank0PlusRank10Pending} rank20Capacity=${t.rank20CapacityUnderPureFill}`);
    check(t.pureFillRankCounts[10] === 6 && t.keptRankCounts[10] === 5,
      "starvation-rank10-swapped-for-head",
      `pureFillRank10=${t.pureFillRankCounts[10]} keptRank10=${t.keptRankCounts[10]}`);
  }
  const maxPendingStarvation = maxPendingFromEvents(starvationEvents);
  check(maxPendingStarvation <= 6, "cap-invariant-starvation", `maxPending=${maxPendingStarvation} cap=6`);

  // PR-5.25v FIFO head turnover micro: the first-generation FIFO candidates
  // (H, G1 - both guidedAdmitted) are consumed via the guided heap BEFORE the
  // contested trim even happens; the trim's head is C1, a MID-RUN-created
  // neutral candidate that the pure fill would drop (two guided candidates
  // out-rank it). Protection must advance to C1 - the queue contract, not a
  // fixed node or an action class - and the goal is reachable only through it.
  const turnoverEvents = [];
  const turnover = runTurnoverScenario((event) => {
    turnoverEvents.push(event);
    return null;
  });
  const turnoverRoute = Array.isArray(turnover.route) ? turnover.route : [];
  check(turnover.found === true, "fifo-head-turnover-goal-found",
    `found=${turnover.found} stopped=${turnover.stoppedReason} dropped=${turnover.candidatesDropped}`);
  check(JSON.stringify(turnoverRoute) === JSON.stringify(["g1:wave", "c1:path", "cgoal:goal"]),
    "turnover-route-through-mid-run-head", JSON.stringify(turnoverRoute));
  check(turnover.candidatesDropped === 1, "turnover-exactly-one-drop", `dropped=${turnover.candidatesDropped}`);
  check(turnover.fifoHeadProtected >= 1 && turnover.fifoHeadWouldHaveDroppedWithoutProtection >= 1,
    "turnover-head-protection-mattered",
    `protected=${turnover.fifoHeadProtected} wouldHaveDropped=${turnover.fifoHeadWouldHaveDroppedWithoutProtection}`);
  const firstDepth1Expanded = turnoverEvents.findIndex((e) => e.type === "expanded" && e.depth === 1);
  const firstDepth2Registered = turnoverEvents.findIndex((e) => e.type === "registered" && e.depth === 2);
  check(firstDepth1Expanded !== -1 && firstDepth2Registered !== -1 && firstDepth1Expanded < firstDepth2Registered,
    "turnover-head-created-after-first-generation-consumed",
    `firstDepth1Expanded=${firstDepth1Expanded} firstDepth2Registered=${firstDepth2Registered}`);
  const maxPendingTurnover = maxPendingFromEvents(turnoverEvents);
  check(maxPendingTurnover <= 2, "cap-invariant-turnover", `maxPending=${maxPendingTurnover} cap=2`);

  // PR-5.25x combat-progress rank-20 micro: under capacity pressure the keep
  // set is {G (rank 10), R (rank 20)} and both ordinary neutrals drop; R is
  // expanded only through the neutral/FIFO lane and is the only goal path.
  const combatEvents = [];
  const combat = runCombatProgressScenario((event) => {
    combatEvents.push(event);
    return null;
  });
  const combatRoute = Array.isArray(combat.route) ? combat.route : [];
  check(combat.found === true, "combat-progress-rank20-goal-found",
    `found=${combat.found} stopped=${combat.stoppedReason} dropped=${combat.candidatesDropped}`);
  check(JSON.stringify(combatRoute) === JSON.stringify(["r:invest", "rgoal:goal"]),
    "combat-progress-route-through-r", JSON.stringify(combatRoute));
  check(combat.candidatesDropped === 2, "combat-progress-both-neutrals-dropped", `dropped=${combat.candidatesDropped}`);
  check(combat.combatProgressGenerated === 1 && combat.combatProgressAdmittedGenerated === 1,
    "combat-progress-counters", `generated=${combat.combatProgressGenerated} admitted=${combat.combatProgressAdmittedGenerated}`);
  // PR-5.25y Repair 1, Case A/B path: these two drops must be classified as
  // PURE-FILL drops (the fill alone never admitted them), the opposite of the
  // starvation scenario's displacement. Together the two micros pin BOTH
  // branches of the pureFillKept / displacedByFifoHeadProtection matrix.
  {
    const dropped = combatEvents.filter((e) => e.type === "dropped");
    check(dropped.length === 2, "combat-progress-two-dropped-events", `got=${dropped.length}`);
    for (const d of dropped) {
      check(d.pureFillKept === false, "combat-progress-drop-is-pure-fill-drop",
        `key=${d.exactKey && d.exactKey.slice(0, 40)} pureFillKept=${d.pureFillKept}`);
      check(d.displacedByFifoHeadProtection === false, "combat-progress-drop-not-displacement",
        `displaced=${d.displacedByFifoHeadProtection}`);
      check(d.trim && d.trim.fifoHeadDisplacedIds.length === 0,
        "combat-progress-no-displaced-ids", JSON.stringify(d.trim && d.trim.fifoHeadDisplacedIds));
      // Rank-20 competition: the kept rank-20 node (R) exists and its cutoff is
      // recorded; the count of OLDER rank-20 pending nodes distinguishes "lost
      // the insertion race to an earlier peer" from "everything rank-20 lost".
      // Here rank0+rank10 = 1 < cap = 2, so capacity existed and rank-20 was
      // not saturated - the neutral simply lost on rank.
      check(d.trim.pureFillRank20Ids.length === 1 && d.trim.rank20PendingCount === 1,
        "combat-progress-rank20-peer-kept",
        `pureFillRank20Ids=${JSON.stringify(d.trim.pureFillRank20Ids)} rank20Pending=${d.trim.rank20PendingCount}`);
      check(d.trim.rank0PlusRank10Pending < 2,
        "combat-progress-rank20-capacity-existed",
        `base=${d.trim.rank0PlusRank10Pending} cap=2`);
      check(typeof d.olderRank20PendingCount === "number" && d.olderRank20PendingCount >= 0,
        "combat-progress-older-rank20-count-present", `got=${d.olderRank20PendingCount}`);
    }
  }
  const rClassified = combatEvents.find((e) => e.type === "classified" && e.combatProgress === true);
  check(rClassified && rClassified.frontierGuided === false && rClassified.guidedAdmitted === false,
    "combat-progress-not-guided-not-in-heap",
    rClassified ? `frontierGuided=${rClassified.frontierGuided} guidedAdmitted=${rClassified.guidedAdmitted}` : "no flagged classified event");
  const maxPendingCombat = maxPendingFromEvents(combatEvents);
  check(maxPendingCombat <= 2, "cap-invariant-combat-progress", `maxPending=${maxPendingCombat} cap=2`);

  // PR-5.25z: the observational peer-composition extension must be INERT - turning
  // it on may not change the search outcome, the drop count, or the route - and
  // when on it must report a self-consistent rank-20 composition.
  {
    const plainEvents = [];
    const plain = runCombatProgressScenario((event) => { plainEvents.push(event); return null; });
    const observedEvents = [];
    const observed = runCombatProgressScenario(
      (event) => { observedEvents.push(event); return null; },
      { lifecyclePeerComposition: true },
    );
    check(plain.found === observed.found,
      "peer-composition-inert-found", `plain=${plain.found} observed=${observed.found}`);
    check(plain.candidatesDropped === observed.candidatesDropped,
      "peer-composition-inert-drop-count",
      `plain=${plain.candidatesDropped} observed=${observed.candidatesDropped}`);
    check(JSON.stringify(plain.route) === JSON.stringify(observed.route),
      "peer-composition-inert-route",
      `plain=${JSON.stringify(plain.route)} observed=${JSON.stringify(observed.route)}`);
    const observedDrops = observedEvents.filter((e) => e.type === "dropped");
    check(observedDrops.length === plain.candidatesDropped,
      "peer-composition-drop-events-match",
      `events=${observedDrops.length} counter=${plain.candidatesDropped}`);
    const withComposition = observedDrops.filter((e) => e.trim && e.trim.rank20Composition);
    check(withComposition.length === observedDrops.length,
      "peer-composition-present-on-every-drop",
      `${withComposition.length}/${observedDrops.length}`);
    check(observedDrops.every((e) => e.sameIdentityPeers != null),
      "peer-composition-same-identity-present",
      observedDrops.map((e) => e.sameIdentityPeers == null).join(","));
    check(observedDrops.every((e) => typeof e.semanticIdentity === "string" && e.semanticIdentity.length > 0),
      "peer-composition-semantic-identity-present",
      observedDrops.map((e) => String(e.semanticIdentity)).join(","));
    // Self-consistency of the emitted composition.
    for (const d of withComposition) {
      const c = d.trim.rank20Composition;
      const kindSum = Object.values(c.byKind).reduce((a, b) => a + b, 0);
      const floorSum = Object.values(c.byFloor).reduce((a, b) => a + b, 0);
      check(kindSum === c.rank20Pending && floorSum === c.rank20Pending,
        "peer-composition-kind-floor-sums",
        `pending=${c.rank20Pending} kindSum=${kindSum} floorSum=${floorSum}`);
      const identSum = Object.entries(c.multiplicityHistogram)
        .reduce((a, [mult, n]) => a + Number(mult) * n, 0);
      check(identSum === c.rank20Pending,
        "peer-composition-multiplicity-sums", `pending=${c.rank20Pending} identSum=${identSum}`);
      check(c.rank20DistinctIdentities + c.rank20DuplicateIdentities ===
        Object.values(c.multiplicityHistogram).reduce((a, b) => a + b, 0),
        "peer-composition-distinct-plus-duplicate",
        `distinct=${c.rank20DistinctIdentities} dup=${c.rank20DuplicateIdentities}`);
    }
    // Peer counters must be internally consistent for the dropped node.
    for (const d of observedDrops) {
      const p = d.sameIdentityPeers;
      check(p.sameGroupKeptCount <= p.structuralGroupSize,
        "peer-composition-group-kept-le-size",
        `kept=${p.sameGroupKeptCount} size=${p.structuralGroupSize}`);
      check((p.dominatedByRetainedCount + p.dominatesRetainedCount + p.incomparableRetainedCount) === 0 ||
            (p.dominatedByRetainedCount + p.dominatesRetainedCount + p.incomparableRetainedCount) === p.sameGroupKeptCount,
        "peer-composition-pareto-partition",
        `dom=${p.dominatedByRetainedCount} dominates=${p.dominatesRetainedCount} inc=${p.incomparableRetainedCount} kept=${p.sameGroupKeptCount}`);
      check(p.pureFillKeptCount <= p.pendingCount,
        "peer-composition-kept-le-pending", `kept=${p.pureFillKeptCount} pending=${p.pendingCount}`);
    }
    // And with the flag OFF the extension must not appear at all.
    const offDrop = plainEvents.find((e) => e.type === "dropped");
    check(offDrop && offDrop.sameIdentityPeers == null,
      "peer-composition-off-by-default",
      offDrop ? String(offDrop.sameIdentityPeers) : "no drop event");
  }

  // Corrected contract: the neutral goal-path candidate survives the cap, the
  // dominated frontier candidate does not.
  check(result.found === true, "goal-found-through-neutral-candidate",
    `found=${result.found} stopped=${result.stoppedReason} dropped=${result.candidatesDropped}`);
  check(JSON.stringify(routeSummaries) === JSON.stringify(["e3:pathC", "e4:goal"]),
    "route-goes-through-neutral-candidate", JSON.stringify(routeSummaries));
  check(result.candidatesDropped === 1, "exactly-one-dominated-candidate-dropped", `dropped=${result.candidatesDropped}`);

  // Lightweight counters lock the per-class admission semantics.
  check(result.frontierGuidedGenerated === 2, "frontier-guided-generated", `got=${result.frontierGuidedGenerated}`);
  check(result.guidedAdmittedGenerated === 1, "guided-admitted-generated", `got=${result.guidedAdmittedGenerated}`);
  check(result.frontierGuidedDominatedGenerated === 1, "frontier-guided-dominated-generated", `got=${result.frontierGuidedDominatedGenerated}`);
  const byKindEvent = (result.frontierGuidedByKind && result.frontierGuidedByKind.event) || 0;
  const admittedByKindEvent = (result.guidedAdmittedByKind && result.guidedAdmittedByKind.event) || 0;
  const dominatedByKindEvent = (result.frontierGuidedDominatedByKind && result.frontierGuidedDominatedByKind.event) || 0;
  check(byKindEvent === 2 && admittedByKindEvent === 1 && dominatedByKindEvent === 1,
    "per-kind-event-admission-triple", `frontierGuided=${byKindEvent} guidedAdmitted=${admittedByKindEvent} dominated=${dominatedByKindEvent}`);

  // --- PR-5.26a dynamic rank-20 Pareto retention scenarios -----------------
  //
  // Group key = semantic identity + structural state key. Every stub action
  // below sits on the SAME tile (so actionToSemanticIdentity yields one shared
  // identity) and leaves hero.loc untouched (so buildStructuralStateKey yields
  // one shared structural key). The variants therefore differ ONLY in resource
  // vector - exactly the shape PR-5.25z found at the cp#9 drop, where 29 nodes
  // shared a structural key and only HP differed.
  //
  // The frontier set is EMPTY, so every variant is frontierGuided=false. They are
  // rank 20 because ATK increases (combatProgress), not rank 10.
  const rank20ParetoStubState = () => {
    const s = stubState();
    s.hero.hp = 50;
    s.hero.atk = 1;
    return s;
  };

  const createRank20ParetoSimulator = (specs) => ({
    project: {},
    enumeratePrimitiveActions(state) {
      if (state.floorId === "MT1" && state.hero.atk === 1 && state.hero.hp === 50) {
        return {
          actions: specs.map((spec) => stubAction(spec.summary, 1, 1, (s) => {
            s.hero.hp = spec.hp;
            s.hero.atk = spec.atk;
          })),
        };
      }
      return { actions: [] };
    },
    applyAction(state, action) {
      const next = cloneState(state);
      if (typeof action.__apply === "function") action.__apply(next);
      return next;
    },
  });

  const runRank20ParetoScenario = (specs, opts) => {
    const simulator = createRank20ParetoSimulator(specs);
    const options = opts || {};
    const base = rank20ParetoStubState();
    const keysBySummary = {};
    for (const action of simulator.enumeratePrimitiveActions(base).actions) {
      keysBySummary[action.summary] = buildStateKey(simulator.applyAction(base, action));
    }
    const events = [];
    const search = createTransportCollapsedSearch(simulator);
    const result = search.search(base, {
      isGoalState: (state) => state.floorId === "MT_NONE",
      frontierSet: new Set(),
      resourceSkylinePriority: true,
      pendingCandidateCap: options.cap,
      maxExpansions: 50,
      maxRuntimeMs: 10000,
      maxClosureStates: 500,
      onCandidateLifecycle: (event) => { events.push(event); return null; },
      ...(options.rank20DynamicPareto === undefined ? {} : { rank20DynamicPareto: options.rank20DynamicPareto }),
    });
    const droppedKeys = new Set(events.filter((e) => e.type === "dropped").map((e) => e.exactKey));
    return { result, events, keysBySummary, droppedKeys };
  };

  // Scenario 1 - LATE DOMINATOR. Generation order D1(hp100) D2(hp120) L(hp200),
  // all ATK 2, all one identity and one structural key. L arrives last and
  // Pareto-dominates both. An append-only prior-seen skyline cannot demote D1/D2,
  // so this is precisely the case that motivated trim-time reclassification.
  {
    const specs = [
      { summary: "p:D1", hp: 100, atk: 2 },
      { summary: "p:D2", hp: 120, atk: 2 },
      { summary: "p:L", hp: 200, atk: 2 },
    ];
    const dynamic = runRank20ParetoScenario(specs, { cap: 2 });
    const legacy = runRank20ParetoScenario(specs, { cap: 2, rank20DynamicPareto: false });
    const dynamicDroppedL = dynamic.droppedKeys.has(dynamic.keysBySummary["p:L"]);
    const legacyDroppedL = legacy.droppedKeys.has(legacy.keysBySummary["p:L"]);
    check(dynamic.result.candidatesDropped === 1 && legacy.result.candidatesDropped === 1,
      "late-dominator-exactly-one-drop",
      `dynamic=${dynamic.result.candidatesDropped} legacy=${legacy.result.candidatesDropped}`);
    check(legacyDroppedL === true, "late-dominator-legacy-drops-strong-variant",
      `legacyDroppedL=${legacyDroppedL}`);
    check(dynamicDroppedL === false, "late-dominator-dynamic-keeps-strong-variant",
      `dynamicDroppedL=${dynamicDroppedL}`);
    check(dynamic.result.rank20ParetoRescuedTotal >= 1,
      "late-dominator-rescue-counted", `rescued=${dynamic.result.rank20ParetoRescuedTotal}`);
    check(dynamic.result.rank20ParetoChangedTrims >= 1,
      "late-dominator-changed-a-trim", `changedTrims=${dynamic.result.rank20ParetoChangedTrims}`);
    // The dropped node must be one of the DOMINATED ones, never the dominator.
    const dynamicDroppedLabels = Object.keys(dynamic.keysBySummary)
      .filter((label) => dynamic.droppedKeys.has(dynamic.keysBySummary[label]));
    check(dynamicDroppedLabels.length === 1 && dynamicDroppedLabels[0] !== "p:L",
      "late-dominator-dropped-a-dominated-variant", JSON.stringify(dynamicDroppedLabels));
    // The legacy path must classify nothing as dominated, because the rank-20
    // Pareto flag is simply not computed when the mechanism is off.
    check(legacy.result.rank20ParetoNondominatedPendingTotal === 0 &&
      legacy.result.rank20ParetoDominatedPendingTotal === 0,
      "late-dominator-legacy-computes-no-pareto",
      `nd=${legacy.result.rank20ParetoNondominatedPendingTotal} dom=${legacy.result.rank20ParetoDominatedPendingTotal}`);
    check(dynamic.result.rank20ParetoDominatedPendingTotal >= 1 &&
      dynamic.result.rank20ParetoNondominatedPendingTotal >= 1,
      "late-dominator-dynamic-classifies-both-classes",
      `nd=${dynamic.result.rank20ParetoNondominatedPendingTotal} dom=${dynamic.result.rank20ParetoDominatedPendingTotal}`);
    pr526aLateDominator = {
      dynamicDroppedL,
      legacyDroppedL,
      rescued: dynamic.result.rank20ParetoRescuedTotal,
      changedTrims: dynamic.result.rank20ParetoChangedTrims,
      dynamicNondominatedPending: dynamic.result.rank20ParetoNondominatedPendingTotal,
      dynamicDominatedPending: dynamic.result.rank20ParetoDominatedPendingTotal,
      dynamicDroppedLabels,
    };
  }

  // Scenario 2 - INCOMPARABLE TRADE-OFF / NO SCALAR WEIGHTING. A(hp200 atk2) and
  // B(hp100 atk5) are mutually incomparable: more HP vs more ATK. No weighting
  // may invent a winner, so BOTH must classify nondominated, and with cap=1 the
  // survivor must follow INSERTION order - flipping when the generation order
  // flips. A hidden scalar preference would pick the same winner both ways.
  {
    const specsAB = [
      { summary: "p:A", hp: 200, atk: 2 },
      { summary: "p:B", hp: 100, atk: 5 },
    ];
    const runAB = runRank20ParetoScenario(specsAB, { cap: 1 });
    const runBA = runRank20ParetoScenario([specsAB[1], specsAB[0]], { cap: 1 });
    check(runAB.result.rank20ParetoDominatedPendingTotal === 0,
      "incomparable-no-fabricated-domination",
      `dominatedPending=${runAB.result.rank20ParetoDominatedPendingTotal}`);
    check(runAB.result.rank20ParetoNondominatedPendingTotal === 2,
      "incomparable-both-nondominated",
      `nondominatedPending=${runAB.result.rank20ParetoNondominatedPendingTotal}`);
    check(runAB.result.rank20ParetoRescuedTotal === 0,
      "incomparable-rescues-nothing", `rescued=${runAB.result.rank20ParetoRescuedTotal}`);
    const abDroppedA = runAB.droppedKeys.has(runAB.keysBySummary["p:A"]);
    const abDroppedB = runAB.droppedKeys.has(runAB.keysBySummary["p:B"]);
    const baDroppedA = runBA.droppedKeys.has(runBA.keysBySummary["p:A"]);
    const baDroppedB = runBA.droppedKeys.has(runBA.keysBySummary["p:B"]);
    check(runAB.result.candidatesDropped === 1 && runBA.result.candidatesDropped === 1,
      "incomparable-exactly-one-drop-each",
      `ab=${runAB.result.candidatesDropped} ba=${runBA.result.candidatesDropped}`);
    // Generation A,B -> B is dropped (A earlier). Generation B,A -> A is dropped.
    check(abDroppedB === true && abDroppedA === false,
      "incomparable-ab-order-keeps-first", `droppedA=${abDroppedA} droppedB=${abDroppedB}`);
    check(baDroppedA === true && baDroppedB === false,
      "incomparable-ba-order-keeps-first", `droppedA=${baDroppedA} droppedB=${baDroppedB}`);
    pr526aIncomparable = {
      dominatedPending: runAB.result.rank20ParetoDominatedPendingTotal,
      nondominatedPending: runAB.result.rank20ParetoNondominatedPendingTotal,
      rescued: runAB.result.rank20ParetoRescuedTotal,
      abDroppedA,
      abDroppedB,
      baDroppedA,
      baDroppedB,
    };
  }

  const summary = {
    milestone: "PR-5.25s",
    check: "BOUNDED_RETENTION_CONTRACT",
    searchRun: true,
    scenario: "A(frontier,nondominated) C(neutral,goal-path) B(frontier,dominated); cap=2",
    found: result.found,
    route: routeSummaries,
    candidatesDropped: result.candidatesDropped,
    stoppedReason: result.stoppedReason,
    searchComplete: result.searchComplete,
    frontierGuidedGenerated: result.frontierGuidedGenerated,
    guidedAdmittedGenerated: result.guidedAdmittedGenerated,
    frontierGuidedDominatedGenerated: result.frontierGuidedDominatedGenerated,
    frontierGuidedByKind: result.frontierGuidedByKind,
    guidedAdmittedByKind: result.guidedAdmittedByKind,
    frontierGuidedDominatedByKind: result.frontierGuidedDominatedByKind,
    observerEventsRecorded: observerEvents.length,
    observerInertness: inertnessFailures.length === 0,
    starvation: {
      found: starvation.found,
      route: starvationRoute,
      candidatesDropped: starvation.candidatesDropped,
      fifoHeadProtectionOpportunities: starvation.fifoHeadProtectionOpportunities,
      fifoHeadProtected: starvation.fifoHeadProtected,
      fifoHeadWouldHaveDroppedWithoutProtection: starvation.fifoHeadWouldHaveDroppedWithoutProtection,
      maxPendingObserved: maxPendingStarvation,
    },
    turnover: {
      found: turnover.found,
      route: turnoverRoute,
      candidatesDropped: turnover.candidatesDropped,
      fifoHeadProtected: turnover.fifoHeadProtected,
      fifoHeadWouldHaveDroppedWithoutProtection: turnover.fifoHeadWouldHaveDroppedWithoutProtection,
      maxPendingObserved: maxPendingTurnover,
    },
    combatProgress: {
      found: combat.found,
      route: combatRoute,
      candidatesDropped: combat.candidatesDropped,
      generated: combat.combatProgressGenerated,
      admitted: combat.combatProgressAdmittedGenerated,
      maxPendingObserved: maxPendingCombat,
    },
    rank20DynamicPareto: {
      lateDominator: pr526aLateDominator,
      incomparable: pr526aIncomparable,
    },
    failures,
    ok: failures.length === 0,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`);

  console.log("PR-5.25s bounded retention contract micro");
  console.log(`  found=${result.found} route=${JSON.stringify(routeSummaries)} dropped=${result.candidatesDropped}`);
  console.log(`  counters: frontierGuided=${result.frontierGuidedGenerated} guidedAdmitted=${result.guidedAdmittedGenerated} dominated=${result.frontierGuidedDominatedGenerated}`);
  console.log(`  byKind(event): frontierGuided=${byKindEvent} guidedAdmitted=${admittedByKindEvent} dominated=${dominatedByKindEvent}`);
  console.log(`  observer inertness: ${inertnessFailures.length === 0 ? "ok" : "FAIL"} (${observerEvents.length} events recorded, returns ignored)`);
  console.log(`  starvation (cap=6, neutralEvery=5): found=${starvation.found} route=${JSON.stringify(starvationRoute)} dropped=${starvation.candidatesDropped} headProtected=${starvation.fifoHeadProtected}/${starvation.fifoHeadProtectionOpportunities} wouldHaveDropped=${starvation.fifoHeadWouldHaveDroppedWithoutProtection}`);
  console.log(`  turnover (cap=2): found=${turnover.found} route=${JSON.stringify(turnoverRoute)} dropped=${turnover.candidatesDropped} headProtected=${turnover.fifoHeadProtected} wouldHaveDropped=${turnover.fifoHeadWouldHaveDroppedWithoutProtection}`);
  console.log(`  combatProgress (cap=2): found=${combat.found} route=${JSON.stringify(combatRoute)} dropped=${combat.candidatesDropped} generated=${combat.combatProgressGenerated} admitted=${combat.combatProgressAdmittedGenerated}`);
  if (pr526aLateDominator) {
    console.log(`  rank20Pareto late-dominator (cap=2): dynamicDroppedL=${pr526aLateDominator.dynamicDroppedL} ` +
      `legacyDroppedL=${pr526aLateDominator.legacyDroppedL} rescued=${pr526aLateDominator.rescued} ` +
      `changedTrims=${pr526aLateDominator.changedTrims} dropped=${JSON.stringify(pr526aLateDominator.dynamicDroppedLabels)}`);
  }
  if (pr526aIncomparable) {
    console.log(`  rank20Pareto incomparable (cap=1): AB dropsB=${pr526aIncomparable.abDroppedB} BA dropsA=${pr526aIncomparable.baDroppedA} ` +
      `dominatedPending=${pr526aIncomparable.dominatedPending} (insertion order decides; no scalar weighting)`);
  }
  if (failures.length > 0) {
    console.log(`  FAIL (${failures.length}):`);
    for (const f of failures) console.log(`    ${f.label}: ${f.detail}`);
    console.log("  (pre-repair this demonstrates the rank-10 VIP retention of scheduler-dominated frontier candidates)");
  } else {
    console.log("  PASS");
  }
  if (failures.length > 0) process.exitCode = 1;
}

main();
