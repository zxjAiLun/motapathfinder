"use strict";

/**
 * TEST GRADE: unit
 *
 * Ensures route construction rejects a reconstructed final state that only
 * matches the legacy dominance key while differing in exact HP identity.
 */

const assert = require("node:assert");

const { buildRouteRecord } = require("./lib/route-store");

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

function main() {
  checkExactFinalMismatch();
  checkStartSnapshotDoesNotMarkUnvisitedFloors();
  console.log("check-route-store-exact: ok");
}

if (require.main === module) main();

module.exports = { main, checkExactFinalMismatch, checkStartSnapshotDoesNotMarkUnvisitedFloors };
