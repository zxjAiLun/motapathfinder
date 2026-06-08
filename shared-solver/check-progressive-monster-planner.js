"use strict";

const assert = require("node:assert");

const {
  runProgressiveMonsterPlanner,
  __testHooks,
} = require("./lib/progressive-monster-planner");
const currentReachable = require("./lib/current-reachable-battle");
const reachOracle = require("./lib/reach-and-battle-oracle");
const { __testHooks: segmentHooks } = require("./lib/segment-dp");
const {
  buildResourceIntentMilestones,
  validateMilestones,
} = require("./check-progressive-to-milestone");

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
  const base = makeSyntheticSimulator();
  // Extend map: 3x2 so hero at (0,0) can reach both targets adjacently
  const project = {
    data: { firstData: { title: "synthetic-batch", floorId: "SYN", hero: {} } },
    floorsById: {
      SYN: {
        width: 3,
        height: 2,
        map: [
          [0, 101, 0],
          [102, 0, 0],
        ],
        changeFloor: {},
      },
    },
    mapTilesByNumber: {
      101: { id: "hpBat", cls: "enemys" },
      102: { id: "atkBat", cls: "enemys" },
    },
    floorOrder: ["SYN"],
  };
  const simulator = {
    ...base,
    project,
    getWalkReachability(state) {
      return {
        visited: {
          "0,0": {
            state: { ...state, hero: { ...state.hero, loc: { x: 0, y: 0 } } },
          },
          "1,0": {
            state: { ...state, hero: { ...state.hero, loc: { x: 1, y: 0 } } },
          },
        },
      };
    },
    applyAction(state, action, options) {
      // Extend to handle both target positions
      const next = clone(state);
      next.meta = next.meta || {};
      next.meta.decisionDepth = Number(next.meta.decisionDepth || 0) + 1;
      const summary = action && action.summary;
      const ensureFloorState = (s, fid) => {
        if (!s.floorStates[fid])
          s.floorStates[fid] = { removed: {}, replaced: {} };
        return s.floorStates[fid];
      };
      if (summary === "battle:hpBat@SYN:1,0") {
        next.hero.hp = (next.hero.hp || 0) + 100;
        ensureFloorState(next, "SYN").removed["1,0"] = true;
      } else if (summary === "battle:atkBat@SYN:0,1") {
        next.hero.hp = (next.hero.hp || 0) - 20;
        next.hero.atk = (next.hero.atk || 0) + 10;
        ensureFloorState(next, "SYN").removed["0,1"] = true;
      } else if (summary === "battle:atkBat@SYN:2,0") {
        next.hero.hp = (next.hero.hp || 0) - 20;
        next.hero.atk = (next.hero.atk || 0) + 10;
        ensureFloorState(next, "SYN").removed["2,0"] = true;
      } else {
        throw new Error(`unexpected synthetic action ${summary}`);
      }
      return next;
    },
  };
  const initialState = {
    ...makeInitialState(),
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
  };
  const segment = { goal: {}, actionPolicy: { allowedFloors: ["SYN"] } };
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
      summary: "battle:atkBat@SYN:0,1",
      floorId: "SYN",
      x: 0,
      y: 1,
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
    perTarget.has("battle:atkBat@SYN:0,1"),
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

function checkTargetedBattleMatcher() {
  // Verify: with 10 enemies on map but only 2 floorTargets, batch oracle
  // does NOT call primitive enumeration, and battleEvaluateCalls stays
  // proportional to targets (not full enemy count).
  const base = makeSyntheticSimulator();
  const project = {
    data: {
      firstData: { title: "synthetic-battle", floorId: "SYN", hero: {} },
    },
    floorsById: {
      SYN: {
        width: 12,
        height: 1,
        map: [[0, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111]],
        changeFloor: {},
      },
    },
    mapTilesByNumber: {
      101: { id: "hpBat", cls: "enemys" },
      102: { id: "atkBat", cls: "enemys" },
      103: { id: "a", cls: "enemys" },
      104: { id: "b", cls: "enemys" },
      105: { id: "c", cls: "enemys" },
      106: { id: "d", cls: "enemys" },
      107: { id: "e", cls: "enemys" },
      108: { id: "f", cls: "enemys" },
      109: { id: "g", cls: "enemys" },
      110: { id: "h", cls: "enemys" },
      111: { id: "i", cls: "enemys" },
    },
    floorOrder: ["SYN"],
  };
  const projectSim = {
    ...base,
    project,
    getWalkReachability(state) {
      return {
        visited: {
          "0,0": {
            state: { ...state, hero: { ...state.hero, loc: { x: 0, y: 0 } } },
          },
        },
      };
    },
    applyAction(state, action, options) {
      const next = clone(state);
      next.meta = next.meta || {};
      next.meta.decisionDepth = Number(next.meta.decisionDepth || 0) + 1;
      return next;
    },
    enumeratePrimitiveActions(state) {
      // Return all 10 enemies as battle actions
      const actions = [];
      for (let x = 1; x <= 11; x++) {
        const tile = project.mapTilesByNumber[String(x + 100)];
        if (tile) {
          actions.push({
            kind: "battle",
            summary: `battle:${tile.id}@SYN:${x},0`,
            floorId: "SYN",
            target: { x, y: 0 },
            enemyId: tile.id,
            estimate: { damage: 1 },
          });
        }
      }
      return { actions };
    },
  };

  const initialState = {
    ...makeInitialState(),
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
  };
  const segment = { goal: {}, actionPolicy: { allowedFloors: ["SYN"] } };
  // Only 2 of 10 enemies are targets
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
    projectSim,
    initialState,
    targets,
    segment,
    { maxSuccessorsPerTarget: 1 },
    stats,
  );

  assert.equal(result.ok, true);
  assert.equal(
    result.diagnostics.primitiveEnumerations,
    0,
    "targeted matcher must not call enumeratePrimitiveActions",
  );
  assert.equal(result.diagnostics.reachabilityCalls, 1);
  assert.ok(result.results.length >= 1, "target(s) should have successors");
  assert.ok(result.diagnostics.battleEvaluateCalls > 0);

  return {
    primitiveEnumerations: result.diagnostics.primitiveEnumerations,
    battleMatchNodes: result.diagnostics.battleMatchNodes,
    battleTargetChecks: result.diagnostics.battleTargetChecks,
    battleEvaluateCalls: result.diagnostics.battleEvaluateCalls,
    totalResults: result.results.length,
  };
}

function checkBatchVsLegacyCompatibility() {
  const base = makeSyntheticSimulator();
  const simulator = {
    ...base,
    getWalkReachability(state) {
      return {
        visited: {
          "0,0": {
            state: { ...state, hero: { ...state.hero, loc: { x: 0, y: 0 } } },
          },
          "1,0": {
            state: { ...state, hero: { ...state.hero, loc: { x: 1, y: 0 } } },
          },
        },
      };
    },
  };
  const initialState = makeInitialState();
  const segment = { goal: {}, actionPolicy: { allowedFloors: ["SYN"] } };
  const target = {
    kind: "battle",
    summary: "battle:atkBat@SYN:2,0",
    floorId: "SYN",
    x: 2,
    y: 0,
    enemyId: "atkBat",
  };

  const legacy = reachOracle.tryReachAndBattle(
    simulator,
    initialState,
    target,
    segment,
    { maxSuccessorsPerTarget: 1 },
    new Map(),
    {},
  );
  assert.equal(legacy.ok, true, "legacy should reach target");
  assert.ok(legacy.results.length >= 1, "legacy should have results");

  const batch = reachOracle.tryReachAndBattleBatch(
    simulator,
    initialState,
    [target],
    segment,
    { maxSuccessorsPerTarget: 1 },
    {},
  );
  assert.equal(batch.ok, true, "batch should reach target");
  assert.ok(batch.results.length >= 1, "batch should have results");

  const legacyBest = legacy.results[0];
  const batchBest = batch.results[0];

  const legacyPatch = (legacyBest.routePatch || []).map((a) => a.summary || a);
  const batchPatch = (batchBest.routePatch || []).map((a) => a.summary || a);
  assert.deepEqual(
    legacyPatch,
    batchPatch,
    "routePatch summaries must match legacy vs batch",
  );

  const lh = legacyBest.postState.hero || {};
  const bh = batchBest.postState.hero || {};
  assert.equal(lh.hp, bh.hp, "postState.hp must match");
  assert.equal(lh.atk, bh.atk, "postState.atk must match");
  assert.equal(lh.def, bh.def, "postState.def must match");

  const lRemoved =
    (legacyBest.postState.floorStates || {}).SYN &&
    (legacyBest.postState.floorStates.SYN.removed || {});
  const bRemoved =
    (batchBest.postState.floorStates || {}).SYN &&
    (batchBest.postState.floorStates.SYN.removed || {});
  assert.deepEqual(
    Object.keys(lRemoved || {}).sort(),
    Object.keys(bRemoved || {}).sort(),
    "removedTiles must match legacy vs batch",
  );

  return {
    legacyPatch,
    batchPatch,
    legacyHp: lh.hp,
    batchHp: bh.hp,
    legacyAtk: lh.atk,
    batchAtk: bh.atk,
  };
}

function checkPortalDiscoveryCompatibility() {
  // Verify: legacy enumeratePrimitiveActions changeFloor vs fast
  // discoverChangeFloorActions must produce matching summaries.
  const base = makeSyntheticSimulator();
  const changeFloorMap = { "1,0": { floorId: "NEXT", stair: "downFloor" } };
  const project = {
    data: { firstData: { title: "portal-test", floorId: "SYN", hero: {} } },
    floorsById: {
      SYN: {
        width: 3,
        height: 1,
        map: [[0, 0, 0]],
        changeFloor: changeFloorMap,
      },
      NEXT: { width: 1, height: 1, map: [[0]], changeFloor: {} },
    },
    mapTilesByNumber: {},
    floorOrder: ["SYN", "NEXT"],
  };
  const simulator = {
    ...base,
    project,
    enumeratePrimitiveActions(state) {
      // Simulate legacy: return a changeFloor action at adjacent tile
      const loc = (state.hero && state.hero.loc) || {};
      const actions = [];
      if (loc.x === 0 && loc.y === 0 && changeFloorMap["1,0"]) {
        actions.push({
          kind: "changeFloor",
          floorId: state.floorId,
          stance: { x: 0, y: 0 },
          direction: "right",
          x: 1,
          y: 0,
          changeFloor: changeFloorMap["1,0"],
          summary: "changeFloor@SYN:1,0",
        });
      }
      return { actions };
    },
  };
  const state = {
    ...makeInitialState(),
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
  };

  // Legacy: via enumeratePrimitiveActions
  const legacy = simulator
    .enumeratePrimitiveActions(state)
    .actions.filter((a) => a.kind === "changeFloor")
    .map((a) => a.summary);

  // Fast: via discoverChangeFloorActions
  const fast = reachOracle
    .discoverChangeFloorActions(simulator, state)
    .map((a) => a.summary);

  assert.deepEqual(
    legacy.sort(),
    fast.sort(),
    "fast portal discovery must match legacy changeFloor summaries",
  );

  return { legacy, fast };
}

function checkPortalDedupSafety() {
  // Verify: default "summary" mode does NOT merge floorFly actions
  // with the same target floor but different summaries/landing positions.
  const base = makeSyntheticSimulator();
  const project = {
    data: { firstData: { title: "fly-test", floorId: "SYN" } },
    floorsById: {
      SYN: { width: 1, height: 1, map: [[0]], changeFloor: {} },
      T1: { width: 1, height: 1, map: [[0]], changeFloor: {} },
    },
    mapTilesByNumber: {},
    floorOrder: ["SYN", "T1"],
  };
  const simulator = {
    ...base,
    project,
    enumerateFloorFlyActions(state) {
      return [
        {
          kind: "floorFly",
          summary: "fly@T1-3,7",
          targetFloorId: "T1",
          path: ["a"],
          stance: { x: 3, y: 7 },
        },
        {
          kind: "floorFly",
          summary: "fly@T1-5,9",
          targetFloorId: "T1",
          path: ["b"],
          stance: { x: 5, y: 9 },
        },
      ];
    },
  };
  const state = {
    ...makeInitialState(),
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
  };
  const segment = { goal: {}, actionPolicy: {} };

  // Default mode ("summary"): both should survive (different summaries)
  const r1 = reachOracle.oracleFindFloorStates(
    simulator,
    state,
    "T1",
    segment,
    { portalDedupMode: "summary", maxPortalDepth: 1, maxOracleFloorEntries: 2 },
  );
  assert.ok(r1._portalDiagnostics, "should have portal diagnostics");
  // Both actions have different summaries — neither should be skipped
  assert.equal(
    r1._portalDiagnostics.portalDuplicateSkips,
    0,
    "summary mode: no duplicate skips for different summaries",
  );

  // Aggressive target-floor mode: only shortest-path fly survives
  const r2 = reachOracle.oracleFindFloorStates(
    simulator,
    state,
    "T1",
    segment,
    {
      portalDedupMode: "target-floor",
      maxPortalDepth: 1,
      maxOracleFloorEntries: 2,
    },
  );
  // At least one dedup skip should occur (same target floor)
  assert.ok(
    r2._portalDiagnostics.portalDuplicateSkips >= 1,
    "target-floor mode: should dedup same-target-floor fly actions",
  );

  return {
    summaryDupSkips: r1._portalDiagnostics.portalDuplicateSkips,
    targetFloorDupSkips: r2._portalDiagnostics.portalDuplicateSkips,
  };
}

function checkMobilityTargetFloorFilter() {
  const base = makeSyntheticSimulator();
  const state = makeInitialState();
  const applied = [];
  const simulator = {
    ...base,
    enumeratePrimitiveActions() {
      return {
        actions: [
          {
            kind: "changeFloor",
            floorId: "SYN",
            stance: { x: 0, y: 0 },
            x: 1,
            y: 0,
            changeFloor: { floorId: "T1" },
            summary: "changeFloor@SYN:1,0",
          },
          {
            kind: "changeFloor",
            floorId: "SYN",
            stance: { x: 0, y: 0 },
            x: 2,
            y: 0,
            changeFloor: { floorId: "T2" },
            summary: "changeFloor@SYN:2,0",
          },
        ],
      };
    },
    enumerateFloorFlyActions() {
      return [
        { kind: "floorFly", targetFloorId: "T2", summary: "floorFly:T2" },
      ];
    },
    applyAction(current, action) {
      applied.push(action.summary);
      const next = clone(current);
      next.floorId = action.changeFloor
        ? action.changeFloor.floorId
        : action.targetFloorId;
      next.route = (next.route || []).concat(action.summary);
      return next;
    },
  };
  const result = currentReachable.enumerateMobilitySuccessors(
    simulator,
    state,
    { targetFloorId: "T1", onlyTargetFloor: true },
  );
  assert.deepEqual(
    applied,
    ["changeFloor@SYN:1,0"],
    "target-floor mobility should not apply unrelated mobility actions",
  );
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].postState.floorId, "T1");
  return { applied, results: result.results.length };
}

function checkCurrentReachableTargetCache() {
  currentReachable.__testHooks.clearTargetCache();
  const simulator = makeSyntheticSimulator();
  const initialState = makeInitialState();
  const segment = { goal: {}, actionPolicy: { allowedFloors: ["SYN"] } };
  const first = currentReachable.fetchCurrentFloorTargets(
    simulator,
    initialState,
    segment,
    { maxTargetsPerState: 4 },
  );
  const second = currentReachable.fetchCurrentFloorTargets(
    simulator,
    initialState,
    segment,
    { maxTargetsPerState: 4 },
  );
  const mutated = clone(initialState);
  mutated.floorStates.SYN.removed["1,0"] = true;
  const third = currentReachable.fetchCurrentFloorTargets(
    simulator,
    mutated,
    segment,
    { maxTargetsPerState: 4 },
  );
  const stats = currentReachable.__testHooks.getTargetCacheStats();
  assert.equal(first.length, 2, "first scan should see both targets");
  assert.equal(second.length, 2, "cached scan should preserve both targets");
  assert.equal(third.length, 1, "mutation signature should invalidate target cache");
  assert.equal(stats.floorScans, 2, "same floor/mutation should scan once, new mutation scans again");
  assert.ok(stats.hits >= 1, "second same-state fetch should hit cache");
  return stats;
}

function checkCurrentReachableSpecialTargetPriority() {
  currentReachable.__testHooks.clearTargetCache();
  const simulator = makeSyntheticSimulator();
  const initialState = makeInitialState();
  const targets = currentReachable.fetchCurrentFloorTargets(
    simulator,
    initialState,
    { goal: {}, actionPolicy: { allowedFloors: ["SYN"] } },
    {
      maxTargetsPerState: 1,
      specialTargets: ["battle:atkBat@SYN:2,0"],
    },
  );
  assert.equal(
    targets.length,
    2,
    "current-floor fetch should not cap before reachability matching",
  );
  assert.equal(
    targets[0].summary,
    "battle:atkBat@SYN:2,0",
    "current-reachable target fetch should preserve special target priority",
  );
  return { targetSummary: targets[0].summary };
}

function checkCurrentReachableCapAfterReachability() {
  currentReachable.__testHooks.clearTargetCache();
  const simulator = makeSyntheticSimulator();
  simulator.project.floorsById.SYN = {
    width: 4,
    height: 2,
    map: [
      [101, 101, 0, 102],
      [0, 0, 0, 0],
    ],
    changeFloor: {},
  };
  simulator.getWalkReachability = (state) => ({
    visited: { "3,1": { state } },
  });
  simulator.applyAction = (state, action) => {
    if (action.summary !== "battle:atkBat@SYN:3,0") {
      throw new Error(`unexpected cap test action ${action.summary}`);
    }
    const next = clone(state);
    next.hero.hp -= 20;
    next.hero.atk += 10;
    next.meta.decisionDepth = Number(next.meta.decisionDepth || 0) + 1;
    next.floorStates.SYN.removed["3,0"] = true;
    return next;
  };
  const initialState = makeInitialState();
  initialState.hero.loc = { x: 3, y: 1 };
  const targets = currentReachable.fetchCurrentFloorTargets(
    simulator,
    initialState,
    { goal: {}, actionPolicy: { allowedFloors: ["SYN"] } },
    { maxTargetsPerState: 1 },
  );
  assert.equal(
    targets.length,
    3,
    "floor target fetch should return all floor candidates despite planner cap",
  );
  const result = currentReachable.enumerateCurrentReachableBattleSuccessors(
    simulator,
    initialState,
    targets,
    {
      maxReachableTargetsPerState: 1,
      maxSuccessorsPerTarget: 1,
    },
  );
  assert.equal(result.results.length, 1);
  assert.equal(
    result.results[0].battleAction.summary,
    "battle:atkBat@SYN:3,0",
    "reachable target cap should be applied after adjacency matching",
  );
  return {
    floorTargets: targets.length,
    reachableTargets: result.diagnostics.reachableTargets,
    selected: result.results[0].battleAction.summary,
  };
}

function checkCurrentReachableTargetCacheOff() {
  currentReachable.__testHooks.clearTargetCache();
  const simulator = makeSyntheticSimulator();
  const initialState = makeInitialState();
  const segment = { goal: {}, actionPolicy: { allowedFloors: ["SYN"] } };
  currentReachable.fetchCurrentFloorTargets(
    simulator,
    initialState,
    segment,
    { targetCacheMode: "off" },
  );
  currentReachable.fetchCurrentFloorTargets(
    simulator,
    initialState,
    segment,
    { targetCacheMode: "off" },
  );
  const stats = currentReachable.__testHooks.getTargetCacheStats();
  assert.equal(stats.hits, 0, "targetCacheMode=off should not hit cache");
  assert.equal(stats.floorScans, 2, "targetCacheMode=off should rescan each call");
  return stats;
}

function checkMobilityLimitAllowsZero() {
  const normalized = __testHooks.normalizeOptions({
    maxMobilitySuccessorsPerState: 0,
  });
  assert.equal(
    normalized.maxMobilitySuccessorsPerState,
    0,
    "maxMobilitySuccessorsPerState=0 should disable mobility lane",
  );
  return { maxMobilitySuccessorsPerState: normalized.maxMobilitySuccessorsPerState };
}

function makeIntentSimulator() {
  const base = makeSyntheticSimulator();
  const project = {
    data: { firstData: { title: "intent-test", floorId: "SYN", hero: {} } },
    floorsById: {
      SYN: { width: 2, height: 1, map: [[0, 201]], changeFloor: {}, ratio: 1 },
    },
    mapTilesByNumber: {
      201: { id: "redPotion", cls: "items" },
    },
    itemsById: {
      redPotion: { itemEffect: "core.status.hero.hp += 100;" },
    },
    enemysById: {},
    floorOrder: ["SYN"],
  };
  return {
    ...base,
    project,
    enumeratePrimitiveActions() {
      return {
        actions: [{
          kind: "pickup",
          summary: "pickup:redPotion@SYN:1,0",
          floorId: "SYN",
          x: 1,
          y: 0,
          itemId: "redPotion",
          target: { x: 1, y: 0 },
        }],
      };
    },
    applyAction(state, action) {
      if (action.summary !== "pickup:redPotion@SYN:1,0") {
        return base.applyAction(state, action);
      }
      const next = clone(state);
      next.hero.hp += 100;
      next.meta.decisionDepth = Number(next.meta.decisionDepth || 0) + 1;
      next.route = (next.route || []).concat(action.summary);
      return next;
    },
  };
}

function checkResourceIntentBridge() {
  const simulator = makeIntentSimulator();
  const initialState = makeInitialState();
  const plannerResult = {
    frontier: [{ id: "frontier#0", state: initialState, route: [] }],
    diagnostics: {
      stoppedReason: "no-progress",
      specialTargets: { required: [], missing: [] },
    },
    bestState: initialState,
  };
  const result = buildResourceIntentMilestones(simulator, plannerResult, {
    existingMilestoneIds: new Set(),
    failure: {
      failureClass: "hp-deficit",
      missingGoalFields: [{ field: "hero.hp", expected: 200, actual: 100 }],
    },
  });
  assert.ok(result.intents.length >= 1, "bridge should emit at least one resource intent");
  assert.ok(result.milestones.length >= 1, "bridge should convert intent to candidate milestone");
  assert.equal(
    result.milestones[0]._meta.source,
    "resource-intent",
    "resource intent milestone should carry source metadata",
  );
  return {
    intentCount: result.intents.length,
    milestoneId: result.milestones[0].id,
    topIntentKind: result.diagnostics.topIntentKind,
  };
}

function checkValidationDoctorLine() {
  const simulator = makeSyntheticSimulator();
  const initialState = makeInitialState();
  const validation = validateMilestones(
    simulator,
    initialState,
    [{
      id: "impossible-floor",
      label: "Impossible floor",
      goal: { floorId: "NOPE" },
      actionPolicy: { actionKinds: ["battle"], forbidUnsupportedEvents: true },
      dp: { maxExpansions: 4, maxRuntimeMs: 100 },
      _meta: { source: "resource-intent", generatedBy: "test" },
    }],
    { maxExpansions: 4, maxRuntimeMs: 100 },
  );
  assert.equal(validation.length, 1);
  assert.equal(validation[0].found, false, "impossible milestone should fail validation");
  assert.equal(validation[0].source, "resource-intent");
  assert.ok(
    validation[0].doctor && validation[0].doctor.line,
    "failed validation should include solver doctor line",
  );
  return {
    source: validation[0].source,
    doctor: validation[0].doctor.line,
  };
}

function main() {
  const synthetic = checkSyntheticSmoke();
  const oracle = checkOracleCompatibility();
  const archive = checkArchivePruning();
  const specialPriority = checkSpecialTargetPriority();
  const batchCap = checkBatchPerTargetCap();
  const battleMatcher = checkTargetedBattleMatcher();
  const legacyCompat = checkBatchVsLegacyCompatibility();
  const portalCompat = checkPortalDiscoveryCompatibility();
  const portalDedup = checkPortalDedupSafety();
  const currentCache = checkCurrentReachableTargetCache();
  const currentSpecialPriority = checkCurrentReachableSpecialTargetPriority();
  const currentCapAfterReachability = checkCurrentReachableCapAfterReachability();
  const currentCacheOff = checkCurrentReachableTargetCacheOff();
  const mobilityLimitZero = checkMobilityLimitAllowsZero();
  const mobilityTargetFloorFilter = checkMobilityTargetFloorFilter();
  const resourceIntentBridge = checkResourceIntentBridge();
  const validationDoctor = checkValidationDoctorLine();
  console.log(
    JSON.stringify(
      {
        synthetic,
        oracle,
        archive,
        specialPriority,
        batchCap,
        battleMatcher,
        legacyCompat,
        portalCompat,
        portalDedup,
        currentCache,
        currentSpecialPriority,
        currentCapAfterReachability,
        currentCacheOff,
        mobilityLimitZero,
        mobilityTargetFloorFilter,
        resourceIntentBridge,
        validationDoctor,
      },
      null,
      2,
    ),
  );
}

main();
