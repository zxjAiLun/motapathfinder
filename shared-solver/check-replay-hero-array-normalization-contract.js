"use strict";

// PR-5.31i gate: a route record may omit an unset hero array field (e.g.
// `followers`) that captureRuntimeSnapshot always emits as `[]`.
// normalizeRuntimeSnapshotPair must equalize such missing-vs-empty pairs so the
// initial-snapshot diff does not report a spurious `undefined !== object`
// mismatch. A NON-empty array on either side must still surface as a real
// difference (never masked). Engine-internal / unrelated fields are untouched.

const assert = require("node:assert/strict");
const {
  normalizeRuntimeSnapshotPair,
  equalizeEmptyHeroArrayFields,
  diffRouteSnapshot,
} = require("./lib/live-replay");

function baseSnapshot(hero) {
  return {
    floorId: "TS11",
    hero: Object.assign(
      { hp: 100, hpmax: 9999, atk: 1, def: 0, mdef: 0, money: 0, exp: 0, lv: 1, loc: { x: 6, y: 1, direction: "down" } },
      hero,
    ),
    inventory: {},
    flags: { saltygreen: 2 },
    floors: {},
  };
}

function main() {
  // G1: expected omits followers; actual capture emits followers:[] -> equalized,
  // no diff. This is the exact production symptom that blocked the witness.
  {
    const expected = baseSnapshot({ equipment: [] }); // no followers key
    const actual = baseSnapshot({ equipment: [], followers: [] });
    const mismatch = diffRouteSnapshot(expected, actual, {}, ["initial"]);
    assert.equal(mismatch, null, `G1 FAIL: missing-vs-empty followers must equalize, got: ${mismatch}`);
  }

  // G1b: symmetric — actual omits, expected has empty array.
  {
    const expected = baseSnapshot({ equipment: [], followers: [] });
    const actual = baseSnapshot({ equipment: [] });
    const mismatch = diffRouteSnapshot(expected, actual, {}, ["initial"]);
    assert.equal(mismatch, null, `G1b FAIL: symmetric missing-vs-empty must equalize, got: ${mismatch}`);
  }

  // G2: a NON-empty actual array with expected missing the key must STILL be a
  // mismatch — equalization only bridges empty arrays, it never hides content.
  {
    const expected = baseSnapshot({ equipment: [] }); // no followers
    const actual = baseSnapshot({ equipment: [], followers: [{ id: "dragon" }] });
    const mismatch = diffRouteSnapshot(expected, actual, {}, ["initial"]);
    assert.ok(mismatch && /followers/.test(mismatch),
      `G2 FAIL: non-empty actual followers vs missing expected must surface, got: ${mismatch}`);
  }

  // G2b: both present but differing content still mismatches (equalizer inert).
  {
    const expected = baseSnapshot({ followers: [{ id: "a" }] });
    const actual = baseSnapshot({ followers: [{ id: "b" }] });
    const mismatch = diffRouteSnapshot(expected, actual, {}, ["initial"]);
    assert.ok(mismatch && /followers/.test(mismatch),
      `G2b FAIL: differing non-empty followers must surface, got: ${mismatch}`);
  }

  // G3: pure equalizer unit — only bridges empty arrays, mutates in place, and
  // leaves non-array / non-empty values alone.
  {
    const expHero = { equipment: [] };
    const actHero = { equipment: [], followers: [] };
    equalizeEmptyHeroArrayFields(expHero, actHero);
    assert.deepEqual(expHero.followers, [], "G3 FAIL: expected.followers must be filled to []");

    const expHero2 = { followers: [{ id: "x" }] };
    const actHero2 = {};
    equalizeEmptyHeroArrayFields(expHero2, actHero2);
    assert.equal(Object.prototype.hasOwnProperty.call(actHero2, "followers"), false,
      "G3 FAIL: non-empty expected must NOT be bridged onto actual");

    // Safe on null/undefined heroes.
    equalizeEmptyHeroArrayFields(null, undefined);
    equalizeEmptyHeroArrayFields(undefined, {});
  }

  // G4: equalizer does not invent keys neither side has, and does not touch
  // scalar hero fields.
  {
    const expHero = { hp: 100 };
    const actHero = { hp: 100 };
    equalizeEmptyHeroArrayFields(expHero, actHero);
    assert.equal(Object.prototype.hasOwnProperty.call(expHero, "followers"), false, "G4 FAIL: must not invent followers");
    assert.equal(Object.prototype.hasOwnProperty.call(expHero, "equipment"), false, "G4 FAIL: must not invent equipment");
    assert.equal(expHero.hp, 100, "G4 FAIL: scalar untouched");
  }

  // G5: normalizeRuntimeSnapshotPair returns the equalized heroes (integration
  // shape used by diffRouteSnapshot / identity paths).
  {
    const expected = baseSnapshot({ equipment: [] });
    const actual = baseSnapshot({ equipment: [], followers: [] });
    const pair = normalizeRuntimeSnapshotPair(expected, actual, {});
    assert.deepEqual(pair.expected.hero.followers, [], "G5 FAIL: pair.expected.hero.followers must be []");
    assert.deepEqual(pair.actual.hero.followers, [], "G5 FAIL: pair.actual.hero.followers must be []");
  }

  console.log("PASS replay-hero-array-normalization-contract: missing-vs-empty hero array fields (equipment/followers) equalized; non-empty differences still surface; equalizer inert on scalars/absent keys");
}

main();
