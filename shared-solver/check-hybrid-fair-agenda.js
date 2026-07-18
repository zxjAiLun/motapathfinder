"use strict";

/**
 * TEST GRADE: unit
 *
 * Synthetic contract checks for the optional hybrid-fair DP agenda. These
 * tests intentionally do not load a tower project or a teacher route.
 */

const assert = require("node:assert");

const { syncProgress } = require("./lib/progress");
const { searchDP } = require("./lib/dp-search");

function makeState(route, hp, loc) {
  const state = {
    floorId: "SYNTHETIC",
    hero: {
      hp: hp == null ? 50 : hp,
      hpmax: 100,
      atk: 1,
      def: 1,
      mdef: 0,
      lv: 1,
      exp: 0,
      money: 0,
      mana: 0,
      manamax: 0,
      loc: loc || { x: 1, y: 1, direction: "down" },
      equipment: [],
      followers: [],
    },
    inventory: {},
    flags: {},
    visitedFloors: { SYNTHETIC: true },
    floorStates: { SYNTHETIC: { removed: {}, replaced: {} } },
    route: Array.isArray(route) ? route.slice() : [],
    notes: [],
    meta: { decisionDepth: Array.isArray(route) ? route.length : 0 },
  };
  syncProgress(state);
  return state;
}

function makeSimulator() {
  return {
    project: {
      floorsById: {
        SYNTHETIC: {
          floorId: "SYNTHETIC",
          width: 64,
          height: 3,
          map: [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
          changeFloor: {},
        },
      },
    },
    getActionFingerprint: (action) => `fp:${action.summary}`,
    enumeratePrimitiveActions: () => ({ actions: [] }),
    applyAction: (state, action) => {
      const route = state.route.concat(action.summary);
      const x = action.summary === "old" ? 2 : Math.min(60, route.length + 2);
      return makeState(route, state.hero.hp, { x, y: 1, direction: "down" });
    },
  };
}

function hotAction(summary) {
  return {
    kind: "battle",
    summary,
    estimate: { segmentPreviewScore: 1000000 },
  };
}

function buildStarvationOptions(events, providerCalls, overrides) {
  return {
    maxExpansions: 7,
    maxActionsPerState: 10,
    dpSkylineMax: 1,
    stopOnFirstGoal: false,
    goalPredicate: () => false,
    actionProvider: (simulator, state, entry) => {
      providerCalls[entry.nodeId] = (providerCalls[entry.nodeId] || 0) + 1;
      if (state.route.length === 0) {
        return [
          { kind: "battle", summary: "old", estimate: { damage: 1 } },
          hotAction("hot-1"),
        ];
      }
      if (state.route[0] !== "old" && state.route.length < 6) {
        return [hotAction(`hot-${state.route.length + 1}`)];
      }
      return [];
    },
    observer: { onEvent: (event) => events.push(event) },
    ...(overrides || {}),
  };
}

function runStarvation(mode, fairnessEvery) {
  const events = [];
  const providerCalls = {};
  const result = searchDP(makeSimulator(), makeState([], 50), buildStarvationOptions(
    events,
    providerCalls,
    { agendaMode: mode, fairnessEvery },
  ));
  return { result, events, providerCalls };
}

function checkStarvationAndCadence() {
  const best = runStarvation("best-first", 4);
  const hybrid = runStarvation("hybrid-fair", 4);
  const bestPopped = best.events
    .filter((event) => event.eventType === "agendaPopped")
    .map((event) => event.action && event.action.summary);
  const hybridPopped = hybrid.events
    .filter((event) => event.eventType === "agendaPopped")
    .map((event) => event.action && event.action.summary);
  assert(!bestPopped.includes("old"), "best-first synthetic branch should starve old node");
  const fairOldIndex = hybridPopped.indexOf("old");
  assert.equal(fairOldIndex, 3, "hybrid should pop the old node at the fourth expansion");
  const fairOldEvent = hybrid.events.find(
    (event) => event.eventType === "agendaPopped" && event.action && event.action.summary === "old",
  );
  assert(fairOldEvent, "hybrid should emit a fair pop for the starved node");
  assert.equal(fairOldEvent.popSource, "fair-oldest");
  assert.equal(fairOldEvent.fairnessEvery, 4);
  assert.equal(fairOldEvent.expansionOrdinal, 4);
  const hybridPops = hybrid.events.filter((event) => event.eventType === "agendaPopped");
  assert.deepEqual(
    hybridPops.map((event) => event.expansionOrdinal),
    hybridPops.map((event) => event.expansionOrdinal).sort((left, right) => left - right),
    "expansion ordinals must be monotonic",
  );
  Object.values(hybrid.providerCalls).forEach((count) => {
    assert(count <= 1, "hybrid must expand each node at most once");
  });
  const fairness = hybrid.result.diagnostics.dp.agendaFairness;
  assert.equal(fairness.enabled, true);
  assert.equal(fairness.fairnessEvery, 4);
  assert(fairness.fairPops >= 1, "hybrid should record a fair pop");
  assert(fairness.bestPops >= 1, "hybrid should retain best-first pops");
  assert(fairness.maxFairQueueAgeExpansions >= 0);
}

function checkStaleFairEntries() {
  const events = [];
  const simulator = makeSimulator();
  const result = searchDP(simulator, makeState([], 50), {
    maxExpansions: 3,
    maxActionsPerState: 10,
    dpSkylineMax: 2,
    agendaMode: "hybrid-fair",
    fairnessEvery: 2,
    stopOnFirstGoal: false,
    goalPredicate: () => false,
    dominanceConfig: { compare: (left, right) => left.hero.hp - right.hero.hp },
    skylineCompare: (left, right) => left.hero.hp - right.hero.hp,
    actionProvider: (searchSimulator, state) => state.route.length === 0
      ? [
          { kind: "battle", summary: "low", estimate: { damage: 1 } },
          { kind: "battle", summary: "mid", estimate: { damage: 2 } },
          { kind: "battle", summary: "high", estimate: { damage: 3 } },
        ]
      : [],
    actionApplier: (state, action) => makeState(
      state.route.concat(action.summary),
      action.summary === "low" ? 40 : action.summary === "mid" ? 60 : 80,
      { x: 2, y: 1, direction: "down" },
    ),
    observer: { onEvent: (event) => events.push(event) },
  });
  const fairness = result.diagnostics.dp.agendaFairness;
  assert(fairness.skippedInactive > 0, "stale fair entries must be skipped");
  const popped = events
    .filter((event) => event.eventType === "agendaPopped")
    .map((event) => event.action && event.action.summary)
    .filter(Boolean);
  assert(!popped.includes("low"), "skyline-evicted node must not be expanded");
  assert(result.expansions >= 2, "stale fair entries must not stop the search early");
}

function checkLegacyModesAndObserverParity() {
  ["best-first", "fifo"].forEach((agendaMode) => {
    const observed = runStarvation(agendaMode, 4);
    const plain = searchDP(makeSimulator(), makeState([], 50), {
      ...buildStarvationOptions([], {}, { agendaMode, fairnessEvery: 4 }),
      observer: undefined,
    });
    assert.equal(observed.result.expansions, plain.expansions, `${agendaMode} expansion count changed with observer`);
    assert.deepEqual(observed.result.bestSeenState && observed.result.bestSeenState.route,
      plain.bestSeenState && plain.bestSeenState.route,
      `${agendaMode} best-seen route changed with observer`);
    assert.equal(observed.result.diagnostics.dp.agendaFairness.enabled, false);
    assert.equal(observed.result.diagnostics.dp.agendaFairness.bestPops, 0);
    assert.equal(observed.result.diagnostics.dp.agendaFairness.fairPops, 0);
  });
}

function main() {
  checkStarvationAndCadence();
  checkStaleFairEntries();
  checkLegacyModesAndObserverParity();
  console.log("check-hybrid-fair-agenda: ok");
}

if (require.main === module) main();

module.exports = {
  main,
  checkStarvationAndCadence,
  checkStaleFairEntries,
  checkLegacyModesAndObserverParity,
};
