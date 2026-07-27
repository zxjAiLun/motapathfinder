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

function main() {
  checkExactFinalMismatch();
  checkStartSnapshotDoesNotMarkUnvisitedFloors();
  checkComposedRouteBoundary();
  console.log("check-route-store-exact: ok");
}

if (require.main === module) main();

module.exports = {
  main,
  checkExactFinalMismatch,
  checkStartSnapshotDoesNotMarkUnvisitedFloors,
  checkComposedRouteBoundary,
};
