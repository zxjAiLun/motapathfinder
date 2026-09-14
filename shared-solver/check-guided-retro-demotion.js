"use strict";
/**
 * PR-5.26g - Retroactive guided skyline demotion micros.
 *
 * THE ASYMMETRY BEING REPAIRED
 *   The frontier skyline is append-only. `query()` asks only "did any
 *   previously SEEN state dominate this one?" and `insert()` never retracts an
 *   admission a later stronger state supersedes. So
 *
 *     weak then strong -> {weak, strong} both guided
 *     strong then weak -> {strong} guided, weak rejected
 *
 *   and the ACTIVE guided set depends on arrival order. The mechanism demotes
 *   the older LIVE weak node when a newly admitted state dominates it.
 *
 * THE CONTRACT LOCKED HERE
 *   - same structural skyline group only
 *   - LIVE nodes only (retained, not expanded, not dropped)
 *   - NOT a prune: the demoted node stays pending and neutral-searchable
 *   - the cached rank is invalidated, never hard-written to 30
 *   - permanent for guided eligibility: no re-promotion
 *   - a demoted node's stale guided-heap entry is skipped, not heap-deleted
 *
 * Stub world notes: children are frontier-guided by placing their identity in
 * the frontier set `event:MT1:1,1`. Actions leave hero.loc untouched unless
 * `moveTo` is given, so same-round children share one structural skyline group
 * unless deliberately moved apart. Wave 1 runs at hero.lv === 1 and emits
 * children at lv 2; wave 2 is enumerated only for lv === 2 parents, which gives
 * a controlled two-wave search. Base ATK is 1, so atk >= 2 is a combatProgress
 * transition and therefore rank 20 once demoted - which makes "must not
 * hard-write rank 30" observable.
 */

const fs = require("fs");
const path = require("path");

const { cloneState } = require("./lib/state");
const { buildStateKey } = require("./lib/state-key");
const { createTransportCollapsedSearch } = require("./lib/transport-collapse");

const DEFAULT_OUT = path.resolve(__dirname, "routes", "generated", "pr526g-guided-retro-demotion.json");
const GUIDED_IDENTITY = "event:MT1:1,1";

const failures = [];
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures.push({ label, detail: `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}` });
  return ok;
};

function stubState() {
  return {
    floorId: "MT1",
    hero: {
      hp: 50, hpmax: 50, mana: 0, manamax: 0, atk: 1, def: 0, mdef: 0, money: 0, exp: 0, lv: 1,
      loc: { x: 0, y: 0, direction: "down" },
      equipment: [], followers: [],
    },
    inventory: {}, flags: {}, floorStates: {}, triggeredAutoEvents: {}, visitedFloors: { MT1: true },
    route: [], notes: [], meta: { decisionDepth: 0, rawRouteLength: 0 },
  };
}

function stubAction(spec, lv) {
  return {
    kind: "event",
    summary: spec.summary,
    x: 1,
    y: 1,
    stance: { x: 0, y: 0 },
    __apply: (s) => {
      s.hero.hp = spec.hp;
      s.hero.atk = spec.atk;
      s.hero.lv = lv;
      if (spec.moveTo) s.hero.loc = { x: spec.moveTo.x, y: spec.moveTo.y, direction: "down" };
    },
  };
}

function createGuidedSimulator(wave1Specs, wave2Specs) {
  const wave2 = wave2Specs || [];
  return {
    project: {},
    enumeratePrimitiveActions(state) {
      if (state.floorId !== "MT1") return { actions: [] };
      if (state.hero.lv === 1) return { actions: wave1Specs.map((spec) => stubAction(spec, 2)) };
      if (state.hero.lv === 2 && wave2.length > 0) return { actions: wave2.map((spec) => stubAction(spec, 3)) };
      return { actions: [] };
    },
    applyAction(state, action) {
      const next = cloneState(state);
      if (typeof action.__apply === "function") action.__apply(next);
      return next;
    },
  };
}

function runScenario(wave1Specs, opts, wave2Specs) {
  const options = opts || {};
  const simulator = createGuidedSimulator(wave1Specs, wave2Specs);
  const base = stubState();
  const summariesByKey = {};
  const baseActions = simulator.enumeratePrimitiveActions(base).actions;
  for (const action of baseActions) {
    summariesByKey[buildStateKey(simulator.applyAction(base, action))] = action.summary;
  }
  // Label wave-2 nodes as well so expansion order stays readable in the log.
  for (const action of baseActions) {
    const mid = simulator.applyAction(base, action);
    for (const inner of simulator.enumeratePrimitiveActions(mid).actions) {
      summariesByKey[buildStateKey(simulator.applyAction(mid, inner))] = inner.summary;
    }
  }
  const events = [];
  let result = null;
  let runError = null;
  try {
    result = createTransportCollapsedSearch(simulator).search(base, {
      isGoalState: () => false,
      frontierSet: new Set([GUIDED_IDENTITY]),
      resourceSkylinePriority: true,
      pendingCandidateCap: options.cap == null ? 50 : options.cap,
      maxExpansions: options.maxExpansions == null ? 50 : options.maxExpansions,
      maxRuntimeMs: 10000,
      maxClosureStates: 500,
      retroactiveGuidedSkylineDemotion: options.retro === true,
      guidedGroupSweepThreshold: options.sweepThreshold,
      emitPendingSnapshot: options.snapshot === true,
      onCandidateLifecycle: (event) => { events.push(event); return null; },
    });
  } catch (error) {
    runError = `${error.name}: ${error.message}`;
  }
  const expansionOrder = events
    .filter((e) => e.type === "expanded")
    .map((e) => summariesByKey[e.exactKey])
    .filter((s) => s !== undefined);
  const retroDemotionOrder = events
    .filter((e) => e.type === "guidedRetroDemotion")
    .map((e) => summariesByKey[e.exactKey] || e.exactKey);
  const droppedOrder = events
    .filter((e) => e.type === "dropped")
    .map((e) => summariesByKey[e.exactKey] || e.exactKey);
  const pendingView = {};
  if (result && result.pendingSnapshot) {
    for (const node of result.pendingSnapshot.nodes) {
      const label = summariesByKey[node.exactKey];
      if (label === undefined) continue;
      pendingView[label] = { rank: node.rankClass, guided: node.guidedAdmitted };
    }
  }
  return { result, runError, events, expansionOrder, retroDemotionOrder, droppedOrder, pendingView };
}

const WEAK = { summary: "W:weak", hp: 100, atk: 2 };
const STRONG = { summary: "S:strong", hp: 200, atk: 2 };

function main() {
  console.log("PR-5.26g retroactive guided skyline demotion micros");

  // --- CASE A / B: ORDER INVARIANCE ---------------------------------------
  const weakFirst = [WEAK, STRONG];
  const strongFirst = [STRONG, WEAK];

  const legacyA = runScenario(weakFirst, { retro: false });
  const legacyB = runScenario(strongFirst, { retro: false });
  const retroA = runScenario(weakFirst, { retro: true });
  const retroB = runScenario(strongFirst, { retro: true });

  console.log(`  legacy weak-then-strong order = ${JSON.stringify(legacyA.expansionOrder)}`);
  console.log(`  legacy strong-then-weak order = ${JSON.stringify(legacyB.expansionOrder)}`);
  console.log(`  retro  weak-then-strong order = ${JSON.stringify(retroA.expansionOrder)}`);
  console.log(`  retro  strong-then-weak order = ${JSON.stringify(retroB.expansionOrder)}`);

  check("legacy: weak-first admits BOTH (W then S)", legacyA.expansionOrder, ["W:weak", "S:strong"]);
  check("legacy: strong-first admits only S first", legacyB.expansionOrder, ["S:strong", "W:weak"]);
  check("legacy is arrival-order sensitive (A order != B order)",
    JSON.stringify(legacyA.expansionOrder) === JSON.stringify(legacyB.expansionOrder), false);

  check("retro: weak-first demotes the older weak node",
    retroA.retroDemotionOrder, ["W:weak"]);
  check("retro: weak-first now serves S before W, matching strong-first",
    retroA.expansionOrder, ["S:strong", "W:weak"]);
  check("retro: strong-first needs no demotion (weak never admitted)",
    retroB.retroDemotionOrder, []);
  check("retro is arrival-order INVARIANT (A order == B order)",
    JSON.stringify(retroA.expansionOrder), JSON.stringify(retroB.expansionOrder));
  check("retro: weak-first demotion counter is 1", retroA.result.guidedRetroDemotions, 1);
  check("retro: strong-first demotion counter is 0", retroB.result.guidedRetroDemotions, 0);

  // --- LIVE GUIDED SET (the quantity the asymmetry actually distorts) -----
  // Stopping after the FIRST child expansion (maxExpansions = 2) is the earliest
  // point at which both children exist; the retained view of the pending pool at
  // that point is the direct observable of "who still holds guided status, and
  // at which rank".
  const liveLegacyA = runScenario(weakFirst, { retro: false, maxExpansions: 2, snapshot: true });
  const liveLegacyB = runScenario(strongFirst, { retro: false, maxExpansions: 2, snapshot: true });
  const liveRetroA = runScenario(weakFirst, { retro: true, maxExpansions: 2, snapshot: true });
  const liveRetroB = runScenario(strongFirst, { retro: true, maxExpansions: 2, snapshot: true });
  const legacyViewA = JSON.stringify(liveLegacyA.pendingView);
  const legacyViewB = JSON.stringify(liveLegacyB.pendingView);
  const retroViewA = JSON.stringify(liveRetroA.pendingView);
  const retroViewB = JSON.stringify(liveRetroB.pendingView);
  console.log(`  retained view  legacy: A=${legacyViewA} B=${legacyViewB}`);
  console.log(`  retained view  retro : A=${retroViewA} B=${retroViewB}`);

  check("legacy: retained guided state IS arrival-order sensitive", legacyViewA === legacyViewB, false);
  check("retro: retained guided state is arrival-order INVARIANT", retroViewA, retroViewB);
  check("retro weak-first: demoted node is still pending",
    liveRetroA.result.retroDemotedStillPendingAtEnd, 1);
  check("retro strong-first: nothing was demoted",
    liveRetroB.result.retroDemotedStillPendingAtEnd, 0);
  check("retro: live guided count agrees across both arrival orders",
    [liveRetroA.result.liveGuidedPendingAtEnd, liveRetroB.result.liveGuidedPendingAtEnd], [0, 0]);
  check("legacy: live guided count differs across arrival orders",
    [liveLegacyA.result.liveGuidedPendingAtEnd, liveLegacyB.result.liveGuidedPendingAtEnd], [1, 0]);
  check("retro: derived rank10 count agrees with the guided flag",
    liveRetroA.result.rank10PendingAtEnd, liveRetroA.result.liveGuidedPendingAtEnd);
  check("retro: cumulative admissions still differ (the counter is NOT repaired)",
    [liveRetroA.result.guidedAdmittedGenerated, liveRetroB.result.guidedAdmittedGenerated], [2, 1]);
  check("retro: guidedActivePeak still records the transient admission",
    [liveRetroA.result.guidedActivePeak, liveRetroB.result.guidedActivePeak], [2, 1]);

  // --- NOT A PRUNE: demoted node stays pending and neutral-searchable -----
  // Read defensively so a broken implementation reports a check failure rather
  // than crashing on the missing key.
  const demotedView = liveRetroA.pendingView["W:weak"] === undefined ? null : liveRetroA.pendingView["W:weak"];
  check("retro: demoted W is still retained in the pending pool", demotedView !== null, true);
  check("retro: demoted W is no longer guided in the retained view",
    demotedView === null ? "ABSENT" : demotedView.guided, false);
  check("retro: demoted W keeps its combatProgress rank 20 (never hard-written to 30)",
    demotedView === null ? "ABSENT" : demotedView.rank, 20);
  check("retro: nothing is dropped", liveRetroA.result.candidatesDropped, 0);
  check("retro: demoted W still gets expanded in the full run",
    retroA.expansionOrder.includes("W:weak"), true);

  // --- LIVENESS 1: an EXPANDED node is never demoted ----------------------
  // Wave 1 admits A (guided); A is then expanded, which releases its state. Its
  // wave-2 child D dominates A and lands in the SAME structural group, so the
  // scan reaches a dead node whose state no longer exists.
  const expandedRun = runScenario(
    [{ summary: "A:weak", hp: 100, atk: 2 }],
    { retro: true },
    [{ summary: "D:strong", hp: 300, atk: 9 }],
  );
  console.log(`  expanded-node run: order=${JSON.stringify(expandedRun.expansionOrder)} demotions=${expandedRun.result && expandedRun.result.guidedRetroDemotions} scans=${expandedRun.result && expandedRun.result.guidedRetroDemotionScans} err=${expandedRun.runError}`);
  check("liveness/expanded: the search run does not throw", expandedRun.runError, null);
  check("liveness/expanded: D was admitted after A was expanded",
    expandedRun.result && expandedRun.result.guidedAdmittedGenerated, 2);
  check("liveness/expanded: the scan did reach the shared group",
    expandedRun.result && expandedRun.result.guidedRetroDemotionScans >= 2, true);
  check("liveness/expanded: the already-expanded node is NOT demoted",
    expandedRun.result && expandedRun.result.guidedRetroDemotions, 0);
  const expandedLegacy = runScenario(
    [{ summary: "A:weak", hp: 100, atk: 2 }],
    { retro: false },
    [{ summary: "D:strong", hp: 300, atk: 9 }],
  );
  check("liveness/expanded: nothing happens with the mechanism off",
    expandedLegacy.result && expandedLegacy.result.guidedRetroDemotions, 0);

  // --- LIVENESS 2: a DROPPED node is never demoted ------------------------
  // Wave 1 admits A and B into DIFFERENT structural groups, so neither can
  // demote the other; the cap of 1 forces the trim to drop the later one (B).
  // B keeps guidedAdmitted === true and a live state, so only the liveness gate
  // can tell it apart from a serveable guided node. A is then expanded and its
  // wave-2 child D lands in B's group.
  const droppedRun = runScenario(
    [
      { summary: "A:first", hp: 100, atk: 2 },
      { summary: "B:second", hp: 100, atk: 5, moveTo: { x: 6, y: 6 } },
    ],
    { retro: true, cap: 1 },
    [{ summary: "D:dominator", hp: 300, atk: 9, moveTo: { x: 6, y: 6 } }],
  );
  console.log(`  dropped-node run: dropped=${JSON.stringify(droppedRun.droppedOrder)} demotions=${droppedRun.result && droppedRun.result.guidedRetroDemotions} scans=${droppedRun.result && droppedRun.result.guidedRetroDemotionScans} err=${droppedRun.runError}`);
  check("liveness/dropped: the setup really dropped the later node", droppedRun.droppedOrder, ["B:second"]);
  check("liveness/dropped: both wave-1 nodes were guided-admitted first (peak 2)",
    droppedRun.result && droppedRun.result.guidedActivePeak, 2);
  check("liveness/dropped: the search run does not throw", droppedRun.runError, null);
  check("liveness/dropped: the scan did reach the dropped node's group",
    droppedRun.result && droppedRun.result.guidedRetroDemotionScans >= 3, true);
  check("liveness/dropped: the dropped node is NOT demoted",
    droppedRun.result && droppedRun.result.guidedRetroDemotions, 0);
  check("liveness/dropped: no stale-guided bookkeeping drift",
    droppedRun.result && droppedRun.result.liveGuidedPendingAtEnd, 0);

  // --- BOUNDED MEMBERSHIP: the sweep reclaims ids of dead nodes -----------
  // Same shape as the dropped-node run, but with a sweep threshold of 1 so the
  // trim after wave 1 must reclaim the dropped node's id. Without the sweep the
  // bookkeeping would grow with total admissions instead of with the live pool.
  const boundedRun = runScenario(
    [
      { summary: "A:first", hp: 100, atk: 2 },
      { summary: "B:second", hp: 100, atk: 5, moveTo: { x: 6, y: 6 } },
    ],
    { retro: true, cap: 1, sweepThreshold: 1 },
    [{ summary: "D:dominator", hp: 300, atk: 9, moveTo: { x: 6, y: 6 } }],
  );
  console.log(`  bounded-membership run: sweeps=${boundedRun.result && boundedRun.result.guidedGroupSweeps} tracked=${boundedRun.result && boundedRun.result.guidedGroupTrackedIds} demotions=${boundedRun.result && boundedRun.result.guidedRetroDemotions}`);
  check("bounded: the sweep ran exactly once", boundedRun.result && boundedRun.result.guidedGroupSweeps, 1);
  check("bounded: tracked ids shrink to the live members after the sweep",
    boundedRun.result && boundedRun.result.guidedGroupTrackedIds, 2);
  check("bounded: the sweep does not change scheduling",
    boundedRun.result && boundedRun.result.guidedRetroDemotions, 0);

  // --- STALE HEAP ENTRY IS SKIPPED, NOT DELETED ---------------------------
  check("retro: stale demoted heap entry was skipped at least once",
    retroA.result.guidedHeapStaleDemotionSkips >= 1, true);
  check("legacy: no stale skips without the mechanism",
    legacyA.result.guidedHeapStaleDemotionSkips, 0);
  check("retro: all four order runs completed without throwing",
    [legacyA.runError, legacyB.runError, retroA.runError, retroB.runError], [null, null, null, null]);

  // --- INCOMPARABLE: neither dominates, both stay guided ------------------
  const incomparableA = { summary: "A:bulk", hp: 200, atk: 2 };
  const incomparableB = { summary: "B:power", hp: 100, atk: 5 };
  const incForward = runScenario([incomparableA, incomparableB], { retro: true });
  const incReverse = runScenario([incomparableB, incomparableA], { retro: true });
  console.log(`  incomparable retro: forward=${JSON.stringify(incForward.expansionOrder)} reverse=${JSON.stringify(incReverse.expansionOrder)}`);
  check("incomparable: no demotion in either generation order",
    [incForward.result.guidedRetroDemotions, incReverse.result.guidedRetroDemotions], [0, 0]);
  check("incomparable: both remain guided in both orders",
    [incForward.result.liveGuidedPendingAtEnd, incReverse.result.liveGuidedPendingAtEnd], [0, 0]);

  // --- CROSS GROUP: different structural key never demotes ----------------
  const crossGroup = runScenario([
    { summary: "W:moved", hp: 100, atk: 2, moveTo: { x: 5, y: 5 } },
    { summary: "S:same", hp: 200, atk: 2 },
  ], { retro: true });
  console.log(`  cross-group retro order = ${JSON.stringify(crossGroup.expansionOrder)}`);
  check("cross-group: no demotion across different structural keys",
    crossGroup.result.guidedRetroDemotions, 0);

  // --- CONTROL: mechanism off by default, legacy order preserved ----------
  const control = runScenario(weakFirst, {});
  check("control: mechanism is off by default", control.result.retroactiveGuidedSkylineDemotion, false);
  check("control: legacy order preserved by default", control.expansionOrder, ["W:weak", "S:strong"]);
  check("control: no demotions by default", control.result.guidedRetroDemotions, 0);
  check("control: no group bookkeeping at all by default",
    [control.result.guidedGroupTrackedIds, control.result.guidedGroupSweeps], [0, 0]);

  const artifact = {
    milestone: "PR-5.26g",
    micro: "RETROACTIVE_GUIDED_SKYLINE_DEMOTION",
    orderInvariance: {
      legacyWeakFirst: legacyA.expansionOrder,
      legacyStrongFirst: legacyB.expansionOrder,
      retroWeakFirst: retroA.expansionOrder,
      retroStrongFirst: retroB.expansionOrder,
      retroDemotedInWeakFirst: retroA.retroDemotionOrder,
    },
    liveRetainedView: {
      legacy: [legacyViewA, legacyViewB],
      retro: [retroViewA, retroViewB],
      legacySensitive: legacyViewA !== legacyViewB,
      retroInvariant: retroViewA === retroViewB,
    },
    demotedNodeFacts: {
      stillPending: liveRetroA.result.retroDemotedStillPendingAtEnd,
      guidedInRetainedView: demotedView === null ? "ABSENT" : demotedView.guided,
      rankInRetainedView: demotedView === null ? "ABSENT" : demotedView.rank,
      dropped: liveRetroA.result.candidatesDropped,
      expandedInFullRun: retroA.expansionOrder.includes("W:weak"),
      guidedActivePeakCountsTransientAdmissionBeforeDemotion: true,
    },
    liveness: {
      expanded: {
        admissions: expandedRun.result && expandedRun.result.guidedAdmittedGenerated,
        scans: expandedRun.result && expandedRun.result.guidedRetroDemotionScans,
        demotions: expandedRun.result && expandedRun.result.guidedRetroDemotions,
        runError: expandedRun.runError,
      },
      dropped: {
        dropped: droppedRun.droppedOrder,
        peak: droppedRun.result && droppedRun.result.guidedActivePeak,
        scans: droppedRun.result && droppedRun.result.guidedRetroDemotionScans,
        demotions: droppedRun.result && droppedRun.result.guidedRetroDemotions,
        runError: droppedRun.runError,
      },
      boundedMembership: {
        sweeps: boundedRun.result && boundedRun.result.guidedGroupSweeps,
        trackedIds: boundedRun.result && boundedRun.result.guidedGroupTrackedIds,
        threshold: boundedRun.result && boundedRun.result.guidedGroupSweepThreshold,
      },
    },
    staleHeapSkips: { retro: retroA.result.guidedHeapStaleDemotionSkips, legacy: legacyA.result.guidedHeapStaleDemotionSkips },
    incomparable: { forwardDemotions: incForward.result.guidedRetroDemotions, reverseDemotions: incReverse.result.guidedRetroDemotions },
    crossGroupDemotions: crossGroup.result.guidedRetroDemotions,
    failures,
  };
  fs.mkdirSync(path.dirname(DEFAULT_OUT), { recursive: true });
  fs.writeFileSync(DEFAULT_OUT, `${JSON.stringify(artifact, null, 2)}\n`);

  if (failures.length > 0) {
    console.log(`  FAIL (${failures.length}):`);
    for (const f of failures) console.log(`    ${f.label}: ${f.detail}`);
  } else {
    console.log("  PASS");
  }
  if (failures.length > 0) process.exitCode = 1;
}

main();
