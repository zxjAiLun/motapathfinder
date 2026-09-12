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
 * LOCKED CONTRACT:
 *   CAP_RETENTION = GOAL > ACTUALLY_GUIDED_ADMITTED > NEUTRAL
 *   frontierGuided = structural classification (identity in autonomous frontier)
 *   guidedAdmitted = frontierGuided AND passed resource skyline admission
 *                    AND inserted into the guided heap
 *   There is NO rank-20 Pareto retention tier; paretoAdmitted is telemetry only.
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

/** Bounded-pool invariant from the observer event stream: pending can never
 * exceed the configured cap. registered - dropped - expanded approximates the
 * live pending count (the unregistered root expansion is clamped at zero). */
function maxPendingFromEvents(events) {
  let registered = 0;
  let dropped = 0;
  let expanded = 0;
  let max = 0;
  for (const event of events) {
    if (event.type === "registered") registered += 1;
    else if (event.type === "dropped") dropped += 1;
    else if (event.type === "expanded") expanded += 1;
    const live = Math.max(0, registered - dropped - expanded);
    if (live > max) max = live;
  }
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
