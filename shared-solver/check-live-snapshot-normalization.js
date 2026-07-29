"use strict";

const assert = require("node:assert");

const { diffRouteSnapshot, routeSnapshotFloors } = require("./lib/live-replay");

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeSnapshot() {
  return {
    hero: { hp: 100, atk: 10, def: 5, mdef: 20, exp: 0, money: 0, loc: { x: 1, y: 1, direction: "down" } },
    inventory: {},
    flags: {},
    floors: {
      MT1: { removed: ["1,1"], replaced: [] },
      MT2: { removed: [], replaced: [] },
    },
  };
}

function main() {
  const expected = makeSnapshot();
  const actual = cloneJson(expected);
  delete actual.floors.MT2;

  assert.equal(
    diffRouteSnapshot(expected, actual, { runtimeAutoBattle: true }, ["step"]),
    null,
    "a missing runtime floor with no mutations should match an explicit empty floor record"
  );

  const mutatedExpected = makeSnapshot();
  mutatedExpected.floors.MT2.removed = ["2,2"];
  assert.match(
    diffRouteSnapshot(mutatedExpected, actual, { runtimeAutoBattle: true }, ["step"]),
    /floors\.MT2/,
    "a missing runtime floor with expected mutations must remain a mismatch"
  );

  const actualWithEmptyExtraFloor = cloneJson(expected);
  delete actualWithEmptyExtraFloor.floors.MT2;
  actualWithEmptyExtraFloor.floors.MT3 = { removed: [], replaced: [] };
  assert.equal(
    diffRouteSnapshot(expected, actualWithEmptyExtraFloor, { runtimeAutoBattle: true }, ["step"]),
    null,
    "an extra empty runtime floor should also be harmless"
  );

  const collectedFloors = routeSnapshotFloors({
    start: { snapshot: { floors: { MT1: { removed: [], replaced: [] } } } },
    decisions: [{ postSnapshot: { floors: { MT2: { removed: ["2,2"], replaced: [] } } } }],
    final: { snapshot: { floors: { MT3: { removed: [], replaced: [] } } } },
  });
  assert.deepEqual(collectedFloors, ["MT1", "MT2", "MT3"]);

  console.log("live snapshot normalization: 4/4 passed");
}

if (require.main === module) main();

module.exports = { main };
