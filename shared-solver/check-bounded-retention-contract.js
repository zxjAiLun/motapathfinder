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

function main() {
  const outPath = (() => {
    const arg = process.argv.slice(2).find((t) => t.startsWith("--out="));
    return arg ? path.resolve(arg.slice("--out=".length)) : DEFAULT_OUT;
  })();

  const result = runScenario();
  const routeSummaries = Array.isArray(result.route) ? result.route : [];

  const failures = [];
  const check = (ok, label, detail) => {
    if (!ok) failures.push({ label, detail });
    return ok;
  };

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
    failures,
    ok: failures.length === 0,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`);

  console.log("PR-5.25s bounded retention contract micro");
  console.log(`  found=${result.found} route=${JSON.stringify(routeSummaries)} dropped=${result.candidatesDropped}`);
  console.log(`  counters: frontierGuided=${result.frontierGuidedGenerated} guidedAdmitted=${result.guidedAdmittedGenerated} dominated=${result.frontierGuidedDominatedGenerated}`);
  console.log(`  byKind(event): frontierGuided=${byKindEvent} guidedAdmitted=${admittedByKindEvent} dominated=${dominatedByKindEvent}`);
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
