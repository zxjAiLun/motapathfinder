"use strict";

const assert = require("node:assert");

const { runProgressiveMonsterPlanner, __testHooks } = require("./lib/progressive-monster-planner");
const reachOracle = require("./lib/reach-and-battle-oracle");
const { __testHooks: segmentHooks } = require("./lib/segment-dp");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeSyntheticSimulator() {
  const project = {
    data: { firstData: { title: "synthetic-progressive", floorId: "SYN", hero: {} } },
    floorsById: {
      SYN: {
        width: 3,
        height: 1,
        map: [[0, 101, 102]],
        changeFloor: {},
      },
    },
    mapTilesByNumber: {
      101: { id: "hpBat", cls: "enemys" },
      102: { id: "atkBat", cls: "enemys" },
    },
    floorOrder: ["SYN"],
  };
  const ensureFloorState = (state, floorId) => {
    if (!state.floorStates[floorId]) state.floorStates[floorId] = { removed: {}, replaced: {} };
    return state.floorStates[floorId];
  };
  const removed = (state, x, y) => Boolean(((state.floorStates.SYN || {}).removed || {})[`${x},${y}`]);
  const actionFor = (state, x, y, enemyId) => removed(state, x, y)
    ? null
    : {
      kind: "battle",
      summary: `battle:${enemyId}@SYN:${x},${y}`,
      floorId: "SYN",
      target: { x, y },
      enemyId,
      estimate: { damage: enemyId === "atkBat" ? 20 : 5 },
    };
  return {
    project,
    buildReachableRegionSignature() {
      return { regionKey: "SYN:all", reachableEndpointsKey: "", counts: {} };
    },
    enumerateActions(state) {
      return this.enumeratePrimitiveActions(state).actions;
    },
    enumeratePrimitiveActions(state) {
      return {
        actions: [
          actionFor(state, 1, 0, "hpBat"),
          actionFor(state, 2, 0, "atkBat"),
        ].filter(Boolean),
      };
    },
    getWalkReachability(state) {
      return { visited: { "0,0": { state } } };
    },
    applyAction(state, action, options) {
      const next = clone(state);
      next.meta.decisionDepth = Number(next.meta.decisionDepth || 0) + 1;
      const summary = action && action.summary;
      if (summary === "battle:hpBat@SYN:1,0") {
        next.hero.hp += 100;
        next.hero.exp += 1;
        ensureFloorState(next, "SYN").removed["1,0"] = true;
      } else if (summary === "battle:atkBat@SYN:2,0") {
        next.hero.hp -= 20;
        next.hero.atk += 10;
        next.hero.exp += 2;
        ensureFloorState(next, "SYN").removed["2,0"] = true;
      } else {
        throw new Error(`unexpected synthetic action ${summary}`);
      }
      if (!options || options.storeRoute !== false) {
        next.route = (next.route || []).concat(summary);
      }
      return next;
    },
  };
}

function makeInitialState() {
  return {
    floorId: "SYN",
    hero: { hp: 100, atk: 1, def: 1, mdef: 1, lv: 1, exp: 0, money: 0, equipment: [], loc: { x: 0, y: 0 } },
    inventory: {},
    flags: {},
    visitedFloors: { SYN: true },
    floorStates: { SYN: { removed: {}, replaced: {} } },
    route: [],
    meta: { decisionDepth: 0 },
  };
}

function replaySummaries(simulator, state, route) {
  let current = clone(state);
  for (const summary of route) {
    const action = simulator.enumeratePrimitiveActions(current).actions.find((entry) => entry.summary === summary);
    assert.ok(action, `replay should find ${summary}`);
    current = simulator.applyAction(current, action);
  }
  return current;
}

function checkSyntheticSmoke() {
  const simulator = makeSyntheticSimulator();
  const initialState = makeInitialState();
  const result = runProgressiveMonsterPlanner(simulator, initialState, {
    allowedFloors: ["SYN"],
    maxRounds: 2,
    beamWidth: 4,
    maxTargetsPerState: 2,
    maxSuccessorsPerTarget: 2,
    noProgressRounds: 2,
    maxHeapMb: 256,
  });
  assert.ok(result.bestRoute.length > 0, "planner should produce a route without a hand-written segment goal");
  const replayed = replaySummaries(simulator, initialState, result.bestRoute);
  assert.equal(replayed.hero.hp, result.bestState.hero.hp, "replayed HP should match planner best state");
  assert.equal(replayed.hero.atk, result.bestState.hero.atk, "replayed atk should match planner best state");
  assert.ok(result.diagnostics.successorsAccepted > 0, "planner should accept successors");
  return {
    route: result.bestRoute,
    bestHero: result.bestState.hero,
    diagnostics: {
      rounds: result.diagnostics.rounds,
      successorsAccepted: result.diagnostics.successorsAccepted,
      archiveKeys: result.diagnostics.archiveKeys,
    },
  };
}

function checkOracleCompatibility() {
  const simulator = makeSyntheticSimulator();
  const initialState = makeInitialState();
  const segment = { goal: {}, actionPolicy: { allowedFloors: ["SYN"] } };
  const config = { maxSuccessorsPerTarget: 2 };
  const target = { kind: "battle", summary: "battle:atkBat@SYN:2,0", floorId: "SYN", x: 2, y: 0, enemyId: "atkBat" };
  const direct = reachOracle.tryReachAndBattle(simulator, initialState, target, segment, config, new Map(), {});
  const viaSegmentHook = segmentHooks.tryReachAndBattle(simulator, initialState, target, segment, config, new Map(), {});
  assert.equal(direct.ok, true, "direct oracle should reach target");
  assert.equal(viaSegmentHook.ok, true, "segment hook oracle should reach target");
  assert.deepEqual(
    direct.results.map((entry) => entry.routePatch.map((action) => action.summary)),
    viaSegmentHook.results.map((entry) => entry.routePatch.map((action) => action.summary)),
    "segment-dp hook should expose the extracted oracle behavior"
  );
  return {
    routePatch: direct.results[0].routePatch.map((action) => action.summary),
    hp: direct.results[0].postState.hero.hp,
    atk: direct.results[0].postState.hero.atk,
  };
}

function checkArchivePruning() {
  const simulator = makeSyntheticSimulator();
  const archive = new __testHooks.StateArchive(simulator, { bucketLimit: 4 });
  const base = makeInitialState();
  const strong = { id: "strong", state: { ...clone(base), hero: { ...base.hero, hp: 120, atk: 10 } }, route: ["a"], score: 10 };
  const weak = { id: "weak", state: { ...clone(base), hero: { ...base.hero, hp: 100, atk: 10 } }, route: ["a", "b"], score: 1 };
  const tradeoff = { id: "tradeoff", state: { ...clone(base), hero: { ...base.hero, hp: 140, atk: 5 } }, route: ["c"], score: 5 };
  assert.equal(archive.accept(strong), true, "strong candidate should be accepted");
  assert.equal(archive.accept(weak), false, "dominated candidate should be rejected");
  assert.equal(archive.accept(tradeoff), true, "non-dominated tradeoff candidate should be accepted");
  return {
    accepted: archive.accepted,
    rejectedDominated: archive.rejectedDominated,
    keys: archive.byKey.size,
  };
}

function main() {
  const synthetic = checkSyntheticSmoke();
  const oracle = checkOracleCompatibility();
  const archive = checkArchivePruning();
  console.log(JSON.stringify({ synthetic, oracle, archive }, null, 2));
}

main();
