"use strict";

// PR-5.32f: exercise real production enqueue/dominance/agenda paths on a small
// transposition graph. No witness nodes, tower-specific IDs or custom DP keys.
const assert = require("node:assert/strict");
const { searchDP, searchDPMultiRoot } = require("./lib/dp-search");
const { getDecisionDepth, getRawRouteLength } = require("./lib/state");

function initialState() {
  return {
    floorId: "F1",
    hero: { hp: 50, hpmax: 1000, atk: 1, def: 1, mdef: 0, lv: 1, exp: 0,
      money: 0, mana: 0, equipment: [], followers: [], loc: { x: 0, y: 0 } },
    inventory: {}, flags: {}, visitedFloors: { F1: true }, floorStates: {}, route: [],
    meta: { decisionDepth: 0, rawRouteLength: 0 },
  };
}
function makeSimulator(settings) {
  const cfg = settings || {};
  const edge = (name, target, hp) => ({ kind: "event", summary: name, floorId: "F1", x: target, y: 0, hp });
  const targetHp = cfg.expandedTarget ? 200 : 10;
  return {
    project: { floorsById: { F1: { floorId: "F1", width: 100, height: 1,
      map: [Array(100).fill(0)], changeFloor: {} } } },
    getActionFingerprint: a => a.summary,
    enumeratePrimitiveActions(state) {
      const x = state.hero.loc.x;
      let actions = [];
      if (x === 0) actions = [edge("a-fair-root", 1, 20), edge("b-old-target", 2, targetHp), edge("c-greedy", 10, 100)];
      else if (x === 1) actions = [edge("a-confluence", 2, cfg.nonExact ? 9 : targetHp),
        edge("b-duplicate-confluence", 2, cfg.nonExact ? 9 : targetHp), edge("c-cycle-fair", 1, 20)];
      else if (x === 2) actions = [edge("a-goal", 90, targetHp), edge("b-cycle-target", 2, state.hero.hp)];
      else if (x >= 10 && x < 60) {
        actions = [edge(`greedy-${x + 1}`, x + 1, 100)];
        if (cfg.evictedTarget && x === 10) actions.push(edge("upgrade-target", 2, 15));
      }
      return { actions };
    },
    applyAction(state, action) {
      return { ...state, hero: { ...state.hero, hp: action.hp, loc: { x: action.x, y: 0 } }, route: [],
        meta: { ...state.meta, decisionDepth: getDecisionDepth(state) + 1, rawRouteLength: getRawRouteLength(state) + 1 } };
    },
    isTerminal: () => false,
  };
}
function options(slice, budget, observer, settings) {
  return { goalPredicate: s => !settings?.noGoal && s.hero.loc.x === 90,
    dpAgendaMode: "hybrid-fair", fairnessEvery: 4, maxExpansions: budget || 6,
    maxRuntimeMs: 0, maxHeapMb: 0, maxRssMb: 0, maxActionsPerState: 256,
    dpSkylineMax: settings?.skylineMax || 1, stopOnFirstGoal: false, captureTrace: true,
    continuationSlice: slice, ...(observer ? { observer } : {}) };
}
function run(flag, settings = {}) {
  const events = [];
  const slice = { enabled: settings.sliceEnabled !== false, budget: settings.k || 4,
    ...(flag === undefined ? {} : { exactConfluenceHandoff: flag }) };
  const observer = settings.noObserver ? null : {
    eventTypes: ["skylineInserted", "skylineEvicted", "candidateRejected", "agendaPopped", "continuationHandoff"],
    includeExactStateKey: true,
    onEvent: e => events.push(e),
  };
  const result = searchDP(makeSimulator(settings), initialState(), options(slice, settings.budget, observer, settings));
  return { result, events, af: result.diagnostics.dp.agendaFairness };
}
const pops = r => r.events.filter(e => e.eventType === "agendaPopped");
const handoffs = r => r.events.filter(e => e.eventType === "continuationHandoff");
function content(r) {
  return { found: r.result.foundGoal, expansions: r.result.expansions, frontier: r.result.frontierSize,
    goals: r.result.goalSkylineStates.map(s => ({ hero: s.hero, route: s.route })),
    pops: pops(r).map(e => [e.nodeId, e.parentId, e.popSource, e.agendaRank]) };
}
function checkBudgetAndUniquePops(r, k) {
  let count = 0;
  const seen = new Set();
  for (const e of pops(r)) {
    assert.ok(!seen.has(e.nodeId), "a canonical node may not expand twice"); seen.add(e.nodeId);
    if (e.popSource === "fair-oldest") count = 1;
    else if (e.popSource === "continuation-slice") { assert.ok(count > 0); count += 1; assert.ok(count <= k); }
    else count = 0;
  }
  assert.equal(r.af.continuationSliceLocalExpansions,
    r.af.continuationSlicesOpened + pops(r).filter(e => e.popSource === "continuation-slice").length);
}
function main() {
  const off = run();
  assert.deepEqual(content(run(false)), content(off), "explicit OFF == legacy absent flag");
  assert.equal(off.result.foundGoal, false, "legacy slice must miss the unserved transposition in this bounded graph");
  assert.equal(handoffs(off).length, 0);
  const on = run(true);
  assert.equal(on.result.foundGoal, true, "handoff must let the borrowed representative generate the goal");
  assert.deepEqual(content(run(true)), content(on), "deterministic repeated run");
  assert.equal(on.result.expansions, 6);
  assert.equal(on.result.expansions, off.result.expansions, "same global budget, no additional work");
  assert.equal(handoffs(on).length, 1, "two real duplicate edges borrow only one representative");
  const handoff = handoffs(on)[0];
  assert.equal(handoff.parentId, 0, "original parent must not be replaced with the local fair parent");
  assert.notEqual(handoff.continuationParentNodeId, handoff.parentId);
  const targetInsert = on.events.find(e => e.eventType === "skylineInserted" && e.nodeId === handoff.nodeId);
  const targetPop = pops(on).find(e => e.nodeId === handoff.nodeId);
  assert.ok(targetInsert.enqueueExpansion < handoff.expansions);
  assert.equal(targetPop.popSource, "continuation-slice");
  assert.deepEqual(targetPop.agendaRank, targetInsert.agendaRank, "borrowed rank must not change");
  assert.equal(targetPop.parentId, targetInsert.parentId);
  assert.equal(on.events.filter(e => e.eventType === "skylineInserted" && e.nodeId === handoff.nodeId).length, 1);
  const goalInsert = on.events.find(e => e.eventType === "skylineInserted" && e.hero.loc.x === 90);
  assert.equal(goalInsert.parentId, handoff.nodeId, "goal provenance must descend from the original representative");
  assert.equal(on.af.continuationConfluenceHandoffs, 1);
  assert.equal(on.af.continuationConfluencePops, 1);
  assert.equal(on.af.continuationConfluenceAlreadyInView, 1);
  checkBudgetAndUniquePops(on, 4);
  const withoutObserver = run(true, { noObserver: true });
  assert.equal(withoutObserver.result.foundGoal, on.result.foundGoal);
  assert.equal(withoutObserver.result.frontierSize, on.result.frontierSize);
  assert.equal(withoutObserver.af.continuationConfluenceHandoffs, 1, "handoff may not depend on observer capture");

  assert.deepEqual(content(run(true, { k: 1 })), content(run(false, { k: 1 })), "K=1 identity");
  assert.deepEqual(content(run(true, { sliceEnabled: false })), content(run(false, { sliceEnabled: false })), "disabled slice identity");
  const nonExact = run(true, { nonExact: true });
  assert.equal(handoffs(nonExact).length, 0, "same-DP-key/higher-HP representative is not an exact-state match");
  assert.equal(nonExact.result.foundGoal, false);
  const expanded = run(true, { expandedTarget: true, noGoal: true });
  assert.equal(handoffs(expanded).length, 0, "already expanded representative must not be re-served");
  const evicted = run(true, { evictedTarget: true });
  assert.ok(evicted.events.some(e => e.eventType === "skylineEvicted" && e.hero.hp === 10));
  assert.equal(handoffs(evicted).length, 0, "inactive exact representative in stale heap must not be borrowed");
  assert.equal(evicted.result.foundGoal, false);
  for (const skylineMax of [1, 4]) {
    const long = run(true, { budget: 160, skylineMax });
    checkBudgetAndUniquePops(long, 4);
    assert.ok(long.result.expansions <= 160);
    assert.equal(long.result.frontierSize, 0, "finite cyclic graph must drain; no K reset or repeated expansion");
  }
  assert.throws(() => run("true"), /unsupported continuationSlice.exactConfluenceHandoff/);
  const multiOptions = options({ enabled: true, budget: 4, exactConfluenceHandoff: true }, 6);
  assert.throws(() => searchDPMultiRoot(makeSimulator(), [{ state: initialState() }, { state: initialState() }], multiOptions), /requires single-root/);
  console.log("PASS continuation-confluence-contract: default OFF / real duplicate handoff / exact-live-unexpanded guards / immutable rank and parent / shared K / view dedup / cycle drain / observer independence");
}
main();
