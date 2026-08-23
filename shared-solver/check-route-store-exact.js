"use strict";

/**
 * TEST GRADE: unit
 *
 * Ensures route construction rejects a reconstructed final state that only
 * matches the legacy dominance key while differing in exact HP identity.
 */

const assert = require("node:assert");

const {
  buildRouteRecord,
  composeRouteRecords,
  resolveRecordedAction,
  ROUTE_SCHEMA,
} = require("./lib/route-store");

function makeState(hp, route) {
  return {
    floorId: "SYNTHETIC",
    hero: {
      hp,
      hpmax: 100,
      atk: 10,
      def: 10,
      mdef: 0,
      lv: 1,
      exp: 0,
      money: 0,
      mana: 0,
      manamax: 0,
      loc: { x: 1, y: 1, direction: "down" },
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
}

function makeProject() {
  return {
    data: { firstData: { title: "Synthetic" } },
    floorsById: {
      SYNTHETIC: {
        floorId: "SYNTHETIC",
        width: 3,
        height: 3,
        map: [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
      },
    },
    mapTilesByNumber: {},
    mapNumbersById: {},
  };
}

function checkExactFinalMismatch() {
  const project = makeProject();
  const summary = "battle:shared@SYNTHETIC:1,1";
  const simulator = {
    project,
    createInitialState: () => makeState(50, []),
    enumeratePrimitiveActions: (state) => state.route.length > 0
      ? { actions: [] }
      : {
          actions: [
            { kind: "battle", summary, target: { x: 1, y: 1 }, enemyId: "wrong-path" },
            { kind: "battle", summary, target: { x: 1, y: 1 }, enemyId: "correct-path" },
          ],
        },
    applyAction: (state, action) => makeState(
      action.enemyId === "correct-path" ? 40 : 10,
      state.route.concat(summary),
    ),
  };
  const initialState = makeState(50, []);
  const expectedFinalState = makeState(40, [summary]);
  assert.throws(
    () => buildRouteRecord({
      project,
      simulator,
      initialState,
      finalState: expectedFinalState,
      options: { rank: "chaos", toFloor: "SYNTHETIC" },
    }),
    /reconstructed exact state differs from source final state/,
    "dominance-only reconstruction must not be accepted",
  );
}

function checkStartSnapshotDoesNotMarkUnvisitedFloors() {
  const project = makeProject();
  project.floorsById.EXTRA = {
    floorId: "EXTRA",
    width: 3,
    height: 3,
    map: [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
  };
  const simulator = {
    project,
    createInitialState: () => makeState(50, []),
    enumeratePrimitiveActions: () => ({ actions: [] }),
    applyAction: (state) => state,
  };
  const initialState = makeState(50, []);
  const routeRecord = buildRouteRecord({
    project,
    simulator,
    initialState,
    finalState: initialState,
    options: {
      snapshotFloors: ["SYNTHETIC", "EXTRA"],
      toFloor: "EXTRA",
    },
  });
  assert.deepEqual(Object.keys(routeRecord.start.snapshot.floors), ["SYNTHETIC"]);
  assert.deepEqual(Object.keys(routeRecord.final.snapshot.floors), ["SYNTHETIC", "EXTRA"]);
  assert.deepEqual(JSON.parse(routeRecord.start.exactStateKey).visitedFloors, ["SYNTHETIC"]);
}

function checkComposedRouteBoundary() {
  const boundary = "boundary-exact";
  const prefix = {
    schema: ROUTE_SCHEMA,
    source: { commit: "prefix" },
    goal: { type: "milestone", floorId: "MT2" },
    stats: { expanded: null, generated: null },
    start: { exactStateKey: "initial-exact", snapshot: { floorId: "MT1" } },
    final: { exactStateKey: boundary, snapshot: { floorId: "MT2" } },
    decisions: [
      { index: 1, summary: "prefix-1", preExactStateKey: "initial-exact", postExactStateKey: boundary },
    ],
    rawRoute: ["prefix-1"],
  };
  const suffix = {
    schema: ROUTE_SCHEMA,
    source: { commit: "suffix" },
    goal: { type: "milestone", floorId: "MT2" },
    stats: { expanded: null, generated: null },
    start: { exactStateKey: boundary, snapshot: { floorId: "MT2" } },
    final: { exactStateKey: "final-exact", snapshot: { floorId: "MT2" } },
    decisions: [
      { index: 1, summary: "suffix-1", preExactStateKey: boundary, postExactStateKey: "final-exact" },
    ],
    rawRoute: ["suffix-1"],
  };
  const composed = composeRouteRecords(prefix, suffix, {
    commit: "composed",
    prefixFile: "prefix.route.json",
    suffixFile: "suffix.route.json",
  });
  assert.equal(composed.source.commit, "composed");
  assert.equal(composed.decisions.length, 2);
  assert.deepEqual(composed.decisions.map((decision) => decision.index), [1, 2]);
  assert.equal(composed.decisions[1].preExactStateKey, boundary);
  assert.equal(composed.final.exactStateKey, "final-exact");
  assert.equal(composed.metadata.kind, "composed-route");
  assert.equal(composed.metadata.composedFrom.prefixDecisionCount, 1);
  assert.throws(
    () => composeRouteRecords(prefix, {
      ...suffix,
      start: { ...suffix.start, exactStateKey: "wrong-boundary" },
    }),
    /exact boundary mismatch/,
  );
}

function checkFingerprintDialectAndStrictRejection() {
  const project = makeProject();
  const simulator = {
    project,
    createInitialState: () => makeState(50, []),
    getActionFingerprint: (action) => {
      if (action.kind === "battle") return `battle|${action.floorId}|${action.target.x}|${action.target.y}|${action.enemyId}`;
      if (action.kind === "changeFloor") return `changeFloor|${action.summary}`;
      return `${action.kind}|${action.summary || ""}`;
    },
  };
  const state = makeState(50, []);
  const battleCandidate = {
    kind: "battle",
    floorId: "SYNTHETIC",
    target: { x: 1, y: 1 },
    enemyId: "slime",
    path: [{ x: 1, y: 1 }],
    summary: "battle:slime@SYNTHETIC:1,1",
  };
  const changeFloorCandidate = {
    kind: "changeFloor",
    floorId: "SYNTHETIC",
    target: { x: 2, y: 2 },
    path: [{ x: 2, y: 2 }],
    changeFloor: { floorId: "NEXT", x: 0, y: 0 },
    summary: "changeFloor@SYNTHETIC:2,2",
  };

  const candidates = [battleCandidate, changeFloorCandidate];

  // 1. Battle dialect test: simulator format ("battle|SYNTHETIC|1|1|slime")
  const simBattleDecision = {
    kind: "battle",
    fingerprint: "battle|SYNTHETIC|1|1|slime",
    path: [{ x: 1, y: 1 }],
  };
  const resSimBattle = resolveRecordedAction(simulator, state, simBattleDecision, {
    candidates,
    requireFingerprintMatch: true,
  });
  assert.ok(resSimBattle.action, "simulator dialect battle must resolve");
  assert.strictEqual(resSimBattle.fingerprintMatches, true);
  assert.strictEqual(resSimBattle.matchType, "fingerprint");
  assert.strictEqual(resSimBattle.action.enemyId, "slime");

  // 2. Battle dialect test: route-store format ("battle|SYNTHETIC|1,1|slime")
  const rsBattleDecision = {
    kind: "battle",
    fingerprint: "battle|SYNTHETIC|1,1|slime",
    path: [{ x: 1, y: 1 }],
  };
  const resRsBattle = resolveRecordedAction(simulator, state, rsBattleDecision, {
    candidates,
    requireFingerprintMatch: true,
  });
  assert.ok(resRsBattle.action, "route-store dialect battle must resolve");
  assert.strictEqual(resRsBattle.fingerprintMatches, true);
  assert.strictEqual(resRsBattle.matchType, "fingerprint");

  // 3. ChangeFloor dialect test: simulator format ("changeFloor|changeFloor@SYNTHETIC:2,2")
  const simChangeFloorDecision = {
    kind: "changeFloor",
    fingerprint: "changeFloor|changeFloor@SYNTHETIC:2,2",
    path: [{ x: 2, y: 2 }],
  };
  const resSimFloor = resolveRecordedAction(simulator, state, simChangeFloorDecision, {
    candidates,
    requireFingerprintMatch: true,
  });
  assert.ok(resSimFloor.action, "simulator dialect changeFloor must resolve");
  assert.strictEqual(resSimFloor.fingerprintMatches, true);
  assert.strictEqual(resSimFloor.matchType, "fingerprint");

  // 4. ChangeFloor dialect test: route-store format ("changeFloor|SYNTHETIC|2,2|NEXT|0,0")
  const rsChangeFloorDecision = {
    kind: "changeFloor",
    fingerprint: "changeFloor|SYNTHETIC|2,2|NEXT|0,0",
    path: [{ x: 2, y: 2 }],
  };
  const resRsFloor = resolveRecordedAction(simulator, state, rsChangeFloorDecision, {
    candidates,
    requireFingerprintMatch: true,
  });
  assert.ok(resRsFloor.action, "route-store dialect changeFloor must resolve");
  assert.strictEqual(resRsFloor.fingerprintMatches, true);
  assert.strictEqual(resRsFloor.matchType, "fingerprint");

  // 5. Forged fingerprint with matching path must be rejected under requireFingerprintMatch: true
  const forgedDecision = {
    kind: "battle",
    fingerprint: "battle|SYNTHETIC|1|1|forgedSlime",
    path: ["up"], // matching path
    summary: "battle:forgedSlime@SYNTHETIC:1,1",
  };
  battleCandidate.path = ["up"];
  const resForged = resolveRecordedAction(simulator, state, forgedDecision, {
    candidates,
    requireFingerprintMatch: true,
  });
  assert.strictEqual(resForged.action, null, "forged fingerprint must be rejected even if path matches");
  assert.strictEqual(resForged.reason, "recorded-action-not-matched");

  // Under loose mode (requireFingerprintMatch: false), path match may fall back
  const resForgedLoose = resolveRecordedAction(simulator, state, forgedDecision, {
    candidates,
    requireFingerprintMatch: false,
  });
  assert.ok(resForgedLoose.action, "loose mode falls back to path");
  assert.strictEqual(resForgedLoose.matchType, "path");
  assert.strictEqual(resForgedLoose.fingerprintMatches, false);
}

function main() {
  checkExactFinalMismatch();
  checkStartSnapshotDoesNotMarkUnvisitedFloors();
  checkComposedRouteBoundary();
  checkFingerprintDialectAndStrictRejection();
  console.log("check-route-store-exact: ok");
}

if (require.main === module) main();

module.exports = {
  main,
  checkExactFinalMismatch,
  checkStartSnapshotDoesNotMarkUnvisitedFloors,
  checkComposedRouteBoundary,
  checkFingerprintDialectAndStrictRejection,
};
