"use strict";

// PR-5.32a gate: bounded continuation slice (temporal-locality probe) on the
// single-root hybrid-fair agenda.  Contract invariants:
//   G1  OFF == { enabled:false } == K=1 (population-identical pop stream and
//       projected result): machinery is inert and default-preserving.
//   G2  subtree shares ONE budget K: continuation-slice pops come only in runs
//       immediately anchored by a fair-oldest pop; each run length <= K-1 (the
//       fair-served root's own expansion is unit #1); per-slice local
//       expansions === slicesOpened + slicePopCount (one global budget).
//   G3  matched total work: same maxExpansions => identical total expansions,
//       same stoppedReason — slice never adds extra work, only reorders pops.
//   G4  huge-K dominance: after the FIRST fair pop the slice never closes, so
//       exactly ONE fair pop happens and every later pop is continuation-slice.
//   G5  determinism: identical config twice => identical pop streams/results.
//   G6  fingerprint: searchSemantics includes the local comparator mode (inherit
//       by default); resume identity sensitivity is also covered independently.
//   G7  local comparator: resource-first may reorder the shared rank view, but
//       must never mutate rank.priorityMode or change the global comparator.

const assert = require("node:assert/strict");
const {
  searchDP,
  compareDpAgendaRank,
  compareDpAgendaRankForMode,
  normalizeContinuationSliceLocalPriorityMode,
} = require("./lib/dp-search");
const { searchSemantics } = require("./lib/durable-search");

const DEPTH = 16;
const BREADTH = 3;
const BUDGET = 400;
const K = 8;

function makeBranchingSimulator(depth, breadth) {
  const action = (step, branch) => ({
    kind: "event",
    summary: `step${step}->branch${branch}@F1`,
    floorId: "F1",
    x: step + 1,
    y: branch,
    branch,
  });
  return {
    project: {
      floorsById: {
        F1: {
          floorId: "F1",
          width: depth + 2,
          height: breadth + 2,
          map: Array.from({ length: breadth + 2 },
            () => Array.from({ length: depth + 2 }, () => 0)),
          changeFloor: {},
        },
      },
    },
    stopFloorId: "F1",
    getActionFingerprint: (value) => value.summary,
    enumeratePrimitiveActions: (state) => ({
      actions: state.step < depth
        ? Array.from({ length: breadth }, (_, branch) => action(state.step, branch))
        : [],
    }),
    applyAction: (state, act) => ({
      ...state,
      step: state.step + 1,
      hero: {
        ...state.hero,
        // Location differs per (depth, branch); money encodes the FULL path so
        // every distinct route is a distinct DP key (a (step,branch)-only key
        // would collapse the tree into a 16x3 grid and drain the frontier).
        loc: { x: state.step + 1, y: Number(act.branch) },
        money: state.hero.money * 10 + Number(act.branch) + 1,
      },
      route: [],
    }),
    isTerminal: () => false,
  };
}

function makeInitialState() {
  return {
    floorId: "F1",
    step: 0,
    hero: {
      hp: 100, hpmax: 200, atk: 1, def: 1, mdef: 1, lv: 1,
      exp: 0, money: 0, mana: 0, equipment: [], followers: [],
      loc: { x: 0, y: 0 },
    },
    inventory: {},
    flags: {},
    visitedFloors: { F1: true },
    floorStates: {},
    route: [],
  };
}

function runSearch(sliceConfig) {
  const pops = [];
  const popRankModes = [];
  const result = searchDP(makeBranchingSimulator(DEPTH, BREADTH), makeInitialState(), {
    goalPredicate: () => false,
    stopOnFirstGoal: false,
    dpAgendaMode: "hybrid-fair",
    fairnessEvery: 4,
    maxExpansions: BUDGET,
    maxRuntimeMs: 0,
    maxHeapMb: 0,
    maxRssMb: 0,
    maxActionsPerState: 256,
    goalSkylineLimit: 4096,
    dpSkylineMax: 4096,
    preserveSkylineRoles: true,
    ...(sliceConfig ? { continuationSlice: sliceConfig } : {}),
    observer: {
      eventTypes: ["agendaPopped"],
      onEvent: (event) => {
        pops.push(event.popSource);
        if (event.eventType === "agendaPopped") popRankModes.push(event.agendaRank && event.agendaRank.priorityMode);
      },
    },
  });
  return { result, pops, popRankModes };
}

// Curated projection of a run: only deterministic search-content fields, never
// wall time / memory / continuation-slice diagnostics (asserted separately).
function projectRun(run) {
  const dpDiag = (run.result.diagnostics && run.result.diagnostics.dp) || {};
  const af = dpDiag.agendaFairness || {};
  const expansions = run.result.expansions;
  const stoppedReason = run.result.stoppedReason
    || (run.result.frontierSize ? "expansion-limit" : "frontier-drained");
  return {
    expansions,
    stoppedReason,
    frontierSize: run.result.frontierSize,
    fairPops: af.fairPops,
    bestPops: af.bestPops,
    fairFallbacks: af.fairFallbacks,
    bestFallbacks: af.bestFallbacks,
    maxFairQueueAgeExpansions: af.maxFairQueueAgeExpansions,
    bestSeenHero: run.result.bestSeenState ? run.result.bestSeenState.hero : null,
    deepestDepth: run.result.deepestExpandedState ? run.result.deepestExpandedState.step : null,
    pops: run.pops,
    popRankModes: run.popRankModes,
  };
}

function fairnessDiag(run) {
  const dpDiag = (run.result.diagnostics && run.result.diagnostics.dp) || {};
  return dpDiag.agendaFairness || {};
}

function sliceDiag(run) {
  const af = fairnessDiag(run);
  return {
    enabled: af.continuationSliceEnabled,
    budget: af.continuationSliceBudget,
    opened: af.continuationSlicesOpened,
    localExpansions: af.continuationSliceLocalExpansions,
    survivorsReturned: af.continuationSliceSurvivorsReturned,
  };
}

function assertLocalComparatorIsReadOnly() {
  const goalRank = Object.freeze({
    priorityMode: "goal-relative", bestFloorRank: 10, finiteNextDistance: 1, nextDistance: 1,
    currentFloorRank: 10, sourceActionRank: 0, hp: 100, atk: 1, def: 0, mdef: 0,
    lv: 1, exp: 0, decisionDepth: 4, routeLength: 8, sequence: 1,
  });
  const resourceRank = Object.freeze({
    priorityMode: "goal-relative", bestFloorRank: 9, finiteNextDistance: 1, nextDistance: 20,
    currentFloorRank: 9, sourceActionRank: 2, hp: 900, atk: 9, def: 1, mdef: 0,
    lv: 2, exp: 4, decisionDepth: 6, routeLength: 10, sequence: 2,
  });
  const beforeLeft = JSON.stringify(goalRank);
  const beforeRight = JSON.stringify(resourceRank);
  const globalBefore = compareDpAgendaRank(goalRank, resourceRank);
  const localResourceFirst = compareDpAgendaRankForMode(goalRank, resourceRank, "resource-first");
  const globalAfter = compareDpAgendaRank(goalRank, resourceRank);
  assert.ok(globalBefore > 0 && localResourceFirst < 0,
    "G7 FAIL: explicit local resource-first view must reorder the same shared rank pair");
  assert.equal(globalAfter, globalBefore,
    "G7 FAIL: invoking local comparator must not change the global comparator result");
  assert.equal(JSON.stringify(goalRank), beforeLeft, "G7 FAIL: local comparator mutated the shared left rank");
  assert.equal(JSON.stringify(resourceRank), beforeRight, "G7 FAIL: local comparator mutated the shared right rank");
}

function main() {
  assertLocalComparatorIsReadOnly();
  const off = runSearch(null);

  // G3 (matched total work): baseline fills the budget exactly and stops on the
  // expansion limit; later arms must do the same — no extra work, ever.
  assert.equal(off.result.expansions, BUDGET, "G3 FAIL: baseline must fill the expansion budget");
  assert.equal(projectRun(off).stoppedReason, "expansion-limit", "G3 FAIL: baseline must stop at expansion-limit");
  assert.ok(off.pops.length === BUDGET, "G3 FAIL: every expansion corresponds to exactly one pop");
  assert.ok(off.pops.some((p) => p === "fair-oldest"), "scenario must actually exercise fair pops");
  assert.ok(off.pops.every((p) => p !== "continuation-slice"), "baseline must contain no slice pops");

  // G1a: an explicitly-disabled slice equals an absent slice exactly.
  const disabled = runSearch({ enabled: false, budget: 99 });
  assert.deepEqual(projectRun(disabled), projectRun(off), "G1 FAIL: enabled:false must equal absent slice");
  assert.equal(sliceDiag(disabled).enabled, false, "G1 FAIL: enabled:false must report continuationSliceEnabled=false");

  // G1b: K=1 is the identity slice — the fair-served root's expansion consumes
  // the whole shared budget, so no local pops occur and the stream matches
  // the unaffected baseline bit for bit.
  const k1 = runSearch({ enabled: true, budget: 1 });
  assert.deepEqual(projectRun(k1), projectRun(off),
    "G1 FAIL: K=1 slice must be indistinguishable from slice OFF (same pop order, same result)");
  const k1d = sliceDiag(k1);
  assert.equal(k1d.enabled, true, "G1 FAIL: K=1 run must report continuationSliceEnabled=true");
  assert.equal(k1d.opened, fairnessDiag(off).fairPops, "G1 FAIL: every fair pop must open exactly one slice");
  assert.equal(k1d.localExpansions, k1d.opened, "G1 FAIL: K=1 must consume exactly one expansion per slice (the root)");
  assert.equal(k1d.survivorsReturned, 0, "G1 FAIL: K=1 closes before any child enqueues locally");

  const k1Resource = runSearch({ enabled: true, budget: 1, localPriorityMode: "resource-first" });
  assert.deepEqual(projectRun(k1Resource), projectRun(off),
    "G1 FAIL: K=1 local resource-first must preserve global pop stream and result");
  assert.ok(k1Resource.popRankModes.every((mode) => mode === "default"),
    "G7 FAIL: local mode must not overwrite priorityMode on globally shared ranks");

  // G2: subtree shares ONE budget K.  Slice pops may only appear in a run
  // immediately following a fair-oldest pop, and each run is strictly shorter
  // than K pops (root expansion is unit #1 of K).
  const sliced = runSearch({ enabled: true, budget: K });
  const slicedProjection = projectRun(sliced);
  assert.deepEqual(
    { expansions: slicedProjection.expansions, stoppedReason: slicedProjection.stoppedReason },
    { expansions: BUDGET, stoppedReason: "expansion-limit" },
    "G3 FAIL: slice must draw from the same global budget — identical total work as baseline",
  );
  const slicePops = sliced.pops.filter((p) => p === "continuation-slice").length;
  assert.ok(slicePops > 0, "G2 FAIL: slice ON must actually serve local pops");
  let previous = null;
  let currentRun = 0;
  for (const pop of sliced.pops) {
    if (pop === "continuation-slice") {
      assert.ok(previous === "fair-oldest" || previous === "continuation-slice",
        "G2 FAIL: a slice pop must follow a fair pop or another slice pop — no inherited priority");
      currentRun += 1;
      assert.ok(currentRun <= K - 1, `G2 FAIL: slice pop run length ${currentRun} exceeds K-1=${K - 1}`);
    } else {
      currentRun = 0;
    }
    previous = pop;
  }
  const sd = sliceDiag(sliced);
  assert.equal(sd.enabled, true);
  assert.equal(sd.budget, K);
  assert.ok(sd.opened >= 2, "G2 FAIL: multiple slices must open over a 400-expansion run");
  assert.equal(sd.opened, fairnessDiag(sliced).fairPops, "G2 FAIL: one slice per fair pop exactly");
  assert.equal(sd.localExpansions, sd.opened + slicePops,
    "G2 FAIL: slice-window expansions === one root expansion + local pops, sharing the single budget");
  assert.ok(sd.localExpansions <= sd.opened * K, "G2 FAIL: slice work exceeds slicesOpened * K");
  assert.ok(sd.survivorsReturned >= 0, "G2 FAIL: survivors counter must be well-formed");

  const resourceSliced = runSearch({ enabled: true, budget: K, localPriorityMode: "resource-first" });
  assert.equal(resourceSliced.result.expansions, BUDGET,
    "G7 FAIL: local resource-first must draw from the same global expansion budget");
  assert.ok(resourceSliced.pops.includes("continuation-slice"),
    "G7 FAIL: local resource-first arm must exercise local heap service");
  assert.ok(resourceSliced.popRankModes.every((mode) => mode === "default"),
    "G7 FAIL: local resource-first must leave shared rank.priorityMode unchanged");
  const resourceDiag = fairnessDiag(resourceSliced);
  assert.equal(resourceDiag.continuationSliceLocalPriorityMode, "resource-first",
    "G7 FAIL: diagnostics must identify the effective local comparator");
  assert.equal(resourceDiag.continuationSlicesOpened, resourceDiag.fairPops,
    "G7 FAIL: local comparator must preserve fair-pop-only triggering");
  const resourceRepeat = runSearch({ enabled: true, budget: K, localPriorityMode: "resource-first" });
  assert.deepEqual(projectRun(resourceRepeat), projectRun(resourceSliced),
    "G7 FAIL: local resource-first stream must be deterministic");

  // G4: huge-K dominance.  With K far beyond the budget, the FIRST fair pop's
  // slice never closes: exactly one fair pop total and every subsequent pop is
  // a continuation-slice pop (fair cadence is paused by an open slice).
  const huge = runSearch({ enabled: true, budget: 100000 });
  const hugeDiag = fairnessDiag(huge);
  assert.equal(hugeDiag.fairPops, 1, "G4 FAIL: an endless slice must pause fair cadence after one fair pop");
  assert.equal(hugeDiag.continuationSlicesOpened, 1, "G4 FAIL: exactly one slice must open");
  assert.equal(hugeDiag.continuationSliceLocalExpansions, BUDGET - (hugeDiag.bestPops),
    "G4 FAIL: slice window must own every expansion after the pre-slice best-first pops");
  assert.equal(huge.pops.filter((p) => p === "continuation-slice").length, BUDGET - hugeDiag.bestPops - 1,
    "G4 FAIL: every post-root pop must be a continuation-slice pop");
  const firstFair = huge.pops.indexOf("fair-oldest");
  assert.ok(huge.pops.slice(0, firstFair).every((p) => p === "best-first"),
    "G4 FAIL: pre-slice pops are pure best-first");
  assert.ok(huge.pops.slice(firstFair + 1).every((p) => p === "continuation-slice"),
    "G4 FAIL: after the first fair pop only slice pops must occur");

  // G5: determinism — identical config twice must produce identical streams.
  const repeat = runSearch({ enabled: true, budget: K });
  assert.deepEqual(projectRun(repeat), projectRun(sliced), "G5 FAIL: slice search must be deterministic");
  assert.deepEqual(sliceDiag(repeat), sliceDiag(sliced), "G5 FAIL: slice diagnostics must be deterministic");

  // G6: searchSemantics normalization — default off; enabling/budget changes
  // land in the semantics projection (resume-fingerprint sensitivity itself is
  // covered by check-search-semantics-identity).
  const semOff = searchSemantics({});
  assert.deepEqual(semOff.continuationSlice, {
    enabled: false, mode: null, budget: null, localPriorityMode: null,
  }, "G6 FAIL: default continuationSlice must be disabled with no local comparator");
  const semOn = searchSemantics({ continuationSlice: { enabled: true, budget: K } });
  assert.deepEqual(semOn.continuationSlice, {
    enabled: true, mode: null, budget: K, localPriorityMode: "inherit",
  }, "G6 FAIL: enabled slice must default localPriorityMode to inherit");
  const semResourceFirst = searchSemantics({ continuationSlice: {
    enabled: true, budget: K, localPriorityMode: "resource-first",
  } });
  assert.equal(semResourceFirst.continuationSlice.localPriorityMode, "resource-first");
  assert.notDeepEqual(semResourceFirst, semOn,
    "G6 FAIL: local resource-first must be represented in effective semantics");
  assert.deepEqual(searchSemantics({ continuationSlice: {
    enabled: false, budget: 999, localPriorityMode: "resource-first",
  } }), semOff, "G6 FAIL: disabled slice settings must remain semantically inert");
  assert.throws(() => normalizeContinuationSliceLocalPriorityMode("combat-first"),
    /unsupported continuationSlice/,
    "G7 FAIL: unsupported local comparator must fail closed");

  console.log(
    "PASS continuation-slice-contract: K=1 identity / shared K budget / fair-only trigger / deterministic local resource-first / immutable shared ranks / global comparator preserved / semantics fingerprint normalization",
  );
}

main();
