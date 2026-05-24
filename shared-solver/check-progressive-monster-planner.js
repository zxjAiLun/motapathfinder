"use strict";

const assert = require("node:assert");

const {
  runProgressiveMonsterPlanner,
  __testHooks,
} = require("./lib/progressive-monster-planner");
const reachOracle = require("./lib/reach-and-battle-oracle");
const { __testHooks: segmentHooks } = require("./lib/segment-dp");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeSyntheticSimulator() {
  const project = {
    data: {
      firstData: { title: "synthetic-progressive", floorId: "SYN", hero: {} },
    },
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
    if (!state.floorStates[floorId])
      state.floorStates[floorId] = { removed: {}, replaced: {} };
    return state.floorStates[floorId];
  };
  const removed = (state, x, y) =>
    Boolean(((state.floorStates.SYN || {}).removed || {})[`${x},${y}`]);
  const actionFor = (state, x, y, enemyId) =>
    removed(state, x, y)
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
    hero: {
      hp: 100,
      atk: 1,
      def: 1,
      mdef: 1,
      lv: 1,
      exp: 0,
      money: 0,
      equipment: [],
      loc: { x: 0, y: 0 },
    },
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
    const action = simulator
      .enumeratePrimitiveActions(current)
      .actions.find((entry) => entry.summary === summary);
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
  assert.ok(
    result.bestRoute.length > 0,
    "planner should produce a route without a hand-written segment goal",
  );
  const replayed = replaySummaries(simulator, initialState, result.bestRoute);
  assert.equal(
    replayed.hero.hp,
    result.bestState.hero.hp,
    "replayed HP should match planner best state",
  );
  assert.equal(
    replayed.hero.atk,
    result.bestState.hero.atk,
    "replayed atk should match planner best state",
  );
  assert.ok(
    result.diagnostics.successorsAccepted > 0,
    "planner should accept successors",
  );
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
  const target = {
    kind: "battle",
    summary: "battle:atkBat@SYN:2,0",
    floorId: "SYN",
    x: 2,
    y: 0,
    enemyId: "atkBat",
  };
  const direct = reachOracle.tryReachAndBattle(
    simulator,
    initialState,
    target,
    segment,
    config,
    new Map(),
    {},
  );
  const viaSegmentHook = segmentHooks.tryReachAndBattle(
    simulator,
    initialState,
    target,
    segment,
    config,
    new Map(),
    {},
  );
  assert.equal(direct.ok, true, "direct oracle should reach target");
  assert.equal(
    viaSegmentHook.ok,
    true,
    "segment hook oracle should reach target",
  );
  assert.deepEqual(
    direct.results.map((entry) =>
      entry.routePatch.map((action) => action.summary),
    ),
    viaSegmentHook.results.map((entry) =>
      entry.routePatch.map((action) => action.summary),
    ),
    "segment-dp hook should expose the extracted oracle behavior",
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
  const strong = {
    id: "strong",
    state: { ...clone(base), hero: { ...base.hero, hp: 120, atk: 10 } },
    route: ["a"],
    score: 10,
  };
  const weak = {
    id: "weak",
    state: { ...clone(base), hero: { ...base.hero, hp: 100, atk: 10 } },
    route: ["a", "b"],
    score: 1,
  };
  const tradeoff = {
    id: "tradeoff",
    state: { ...clone(base), hero: { ...base.hero, hp: 140, atk: 5 } },
    route: ["c"],
    score: 5,
  };
  assert.equal(
    archive.accept(strong),
    true,
    "strong candidate should be accepted",
  );
  assert.equal(
    archive.accept(weak),
    false,
    "dominated candidate should be rejected",
  );
  assert.equal(
    archive.accept(tradeoff),
    true,
    "non-dominated tradeoff candidate should be accepted",
  );
  return {
    accepted: archive.accepted,
    rejectedDominated: archive.rejectedDominated,
    keys: archive.byKey.size,
  };
}

function checkSpecialTargetPriority() {
  // Verify: with maxTargets=1, a special target survives even when a
  // non-special target has a higher score.
  const simulator = makeSyntheticSimulator();
  const initialState = makeInitialState();
  // hpBat (x=1) gives +100 HP — very high utility.
  // atkBat (x=2) gives +10 atk — lower "utility" in scoreMonsterTarget.
  // We declare atkBat as the special target. With maxMonsterTargets=1,
  // atkBat must survive the cap despite hpBat having a higher raw score.
  const segment = {
    goal: {},
    actionPolicy: { allowedFloors: ["SYN"] },
  };
  const stats = {};
  const provider = reachOracle.buildMonsterOnlyActionProvider(
    simulator,
    segment,
    {
      maxMonsterTargets: 1,
      specialTargets: ["battle:atkBat@SYN:2,0"],
    },
    stats,
  );

  const targets = provider(simulator, initialState);
  assert.equal(
    targets.length,
    1,
    "maxMonsterTargets=1 should return exactly 1 target",
  );
  assert.equal(
    targets[0].summary,
    "battle:atkBat@SYN:2,0",
    "special target must survive when maxTargets=1 (even if normal target scores higher)",
  );
  assert.ok(
    stats.specialTargetVisible >= 1,
    "specialTargetVisible should count the special target",
  );
  assert.ok(
    stats.specialTargetAfterCap >= 1,
    "specialTargetAfterCap should confirm special target survived",
  );
  assert.equal(
    stats.specialTargetCapDrops,
    0,
    "specialTargetCapDrops should be 0 when special target is the only one returned",
  );

  return {
    targetsReturned: targets.length,
    targetSummary: targets[0].summary,
    specialVisible: stats.specialTargetVisible,
    specialAfterCap: stats.specialTargetAfterCap,
    specialCapDrops: stats.specialTargetCapDrops,
  };
}

function checkBatchPerTargetCap() {
  // Verify: with 2 targets on same floor and maxSuccessorsPerTarget=1,
  // batch returns 1 successor per target (2 total), NOT 1 total.
  // Also verify reachabilityCalls=1 (shared across targets).
  const simulator = makeSyntheticSimulator();
  const initialState = makeInitialState();
  const segment = {
    goal: {},
    actionPolicy: { allowedFloors: ["SYN"] },
  };
  const targets = [
    {
      kind: "battle",
      summary: "battle:hpBat@SYN:1,0",
      floorId: "SYN",
      x: 1,
      y: 0,
      enemyId: "hpBat",
    },
    {
      kind: "battle",
      summary: "battle:atkBat@SYN:2,0",
      floorId: "SYN",
      x: 2,
      y: 0,
      enemyId: "atkBat",
    },
  ];
  const stats = {};
  const result = reachOracle.tryReachAndBattleBatch(
    simulator,
    initialState,
    targets,
    segment,
    { maxSuccessorsPerTarget: 1 },
    stats,
  );

  assert.equal(result.ok, true, "batch should reach both targets");
  assert.ok(
    result.results.length >= 2,
    "should have at least 2 successors (1 per target)",
  );

  // Each target should have at least 1 successor
  const perTarget = new Map();
  for (const r of result.results) {
    const key = (r.target && r.target.summary) || "?";
    perTarget.set(key, (perTarget.get(key) || 0) + 1);
  }
  assert.ok(
    perTarget.has("battle:hpBat@SYN:1,0"),
    "hpBat should have a successor",
  );
  assert.ok(
    perTarget.has("battle:atkBat@SYN:2,0"),
    "atkBat should have a successor",
  );

  // Both targets on same floor: reachabilityCalls must be 1
  assert.equal(
    result.diagnostics.reachabilityCalls,
    1,
    "same-floor batch should call walk reachability exactly once",
  );
  assert.equal(
    result.diagnostics.currentFloorFastPaths,
    1,
    "current floor should use fast path",
  );

  return {
    totalResults: result.results.length,
    targetsWithResults: perTarget.size,
    reachabilityCalls: result.diagnostics.reachabilityCalls,
    fastPaths: result.diagnostics.currentFloorFastPaths,
    portalSearches: result.diagnostics.portalFloorSearches,
  };
}

function main() {
  const synthetic = checkSyntheticSmoke();
  const oracle = checkOracleCompatibility();
  const archive = checkArchivePruning();
  const specialPriority = checkSpecialTargetPriority();
  const batchCap = checkBatchPerTargetCap();
  console.log(
    JSON.stringify(
      { synthetic, oracle, archive, specialPriority, batchCap },
      null,
      2,
    ),
  );
}

main();
