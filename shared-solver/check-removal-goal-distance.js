"use strict";

const assert = require("node:assert/strict");
const { estimateGoalRelativeDistance, estimateNextFloorDistance } = require("./lib/score");

const floor = (floorId, changeFloor = {}) => ({
  floorId, width: 4, height: 2, map: [[0, 0, 0, 0], [0, 0, 0, 0]], changeFloor,
});
const project = {
  floorsById: {
    P1: floor("P1", { "3,1": { floorId: ":next" } }),
    P2: floor("P2", { "0,0": { floorId: ":before" } }),
    ReturnLobby: floor("ReturnLobby"),
  },
  mapTilesByNumber: {},
};
const state = { floorId: "P2", hero: { loc: { x: 0, y: 0 } }, floorStates: {} };
const goal = { floorId: "ReturnLobby", removed: { floorId: "P2", x: 3, y: 1 } };
const original = JSON.stringify({ state, goal, project });
assert.equal(estimateNextFloorDistance(state, project), Infinity, "terminal room has no next stair");
assert.equal(estimateGoalRelativeDistance(state, project, goal), 4, "pending removal is the goal even when victory returns elsewhere");
assert.equal(estimateGoalRelativeDistance({ ...state, hero: { loc: { x: 2, y: 1 } } }, project, goal), 1);
assert.equal(estimateGoalRelativeDistance({ ...state, hero: { loc: { x: 3, y: 1 } } }, project, goal), 0);
const lower = { ...state, floorId: "P1" };
assert.equal(estimateGoalRelativeDistance(lower, project, goal), 4, "lower floors project toward removal floor");
const cleared = { ...state, floorStates: { P2: { removed: { "3,1": true } } } };
assert.equal(estimateGoalRelativeDistance(cleared, project, goal), Infinity, "completed anchor must not keep attracting service");
assert.equal(estimateGoalRelativeDistance(lower, project, { floorId: "P2" }), 4, "normal floor-only behavior unchanged");
assert.equal(estimateGoalRelativeDistance(state, project, { floorId: "P2" }), Infinity);
assert.equal(estimateGoalRelativeDistance(lower, project, null), 4);
for (const removed of [null, {}, { floorId: "absent", x: 1, y: 1 }, { floorId: "P2", x: -1, y: 1 }, { floorId: "P2", x: 4, y: 1 }, { floorId: "P2", x: 1.5, y: 1 }, { floorId: "P2", x: 1, y: 2 }]) {
  assert.equal(estimateGoalRelativeDistance(state, project, { floorId: "ReturnLobby", removed }), Infinity, "invalid anchor cannot manufacture a finite distance");
}
assert.equal(JSON.stringify({ state, goal, project }), original, "projection must be read-only");
console.log("removal-goal distance PASS: event-return terminal, no next stair, pending/completed/invalid anchors, cross-floor projection and floor-only parity");
