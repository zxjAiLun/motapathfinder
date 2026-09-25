"use strict";

/**
 * TEST GRADE: unit (clean-checkout, no tower project loaded)
 *
 * Contract (PR-5.33a): one-shot (non-multiExecute) auto-event history is part
 * of a state's identity. Two states that are byte-identical except for which
 * one-time auto-events have already fired must NOT collapse to the same exact
 * or DP key, because their futures diverge (a consumed one-time HP grant cannot
 * be collected again). Empty history stays byte-identical to the legacy key so
 * towers without auto-events and existing fixtures are unaffected.
 */

const assert = require("node:assert");

const { buildStateKey, buildDominanceKey } = require("./lib/state-key");
const { buildDpStateKey, searchDP } = require("./lib/dp-search");
const { buildSolverSnapshot } = require("./lib/route-snapshot");
const { createStateFromSnapshot } = require("./lib/route-store");

function baseState(overrides) {
  const config = overrides || {};
  const loc = config.loc || { x: 1, y: 1 };
  const state = {
    floorId: "F",
    hero: { hp: config.hp == null ? 100 : config.hp, hpmax: 500, atk: 10, def: 10, mdef: 0, lv: 1, exp: 0, money: 0, mana: 0, manamax: 0, loc: { x: loc.x, y: loc.y, direction: "down" } },
    inventory: { yellowKey: 1 },
    flags: {},
    visitedFloors: { F: true },
    floorStates: { F: { removed: {}, replaced: {} } },
    triggeredAutoEvents: config.triggeredAutoEvents || {},
    phase: config.phase,
    route: [],
    notes: [],
    meta: { decisionDepth: 0 },
  };
  return state;
}

function checkKeyIdentityAndBackCompat() {
  const noHistory = baseState();
  const withHistory = baseState({ triggeredAutoEvents: { "F:1,1:0": true } });

  // Everything except one-shot history is identical.
  assert.deepStrictEqual(
    { ...noHistory, triggeredAutoEvents: undefined },
    { ...withHistory, triggeredAutoEvents: undefined },
  );

  const exactNo = buildStateKey(noHistory);
  const exactWith = buildStateKey(withHistory);
  const dpNo = buildDpStateKey(null, noHistory, { keyMode: "location" });
  const dpWith = buildDpStateKey(null, withHistory, { keyMode: "location" });

  assert.notStrictEqual(exactNo, exactWith, "exact keys must diverge on one-shot auto-event history");
  assert.notStrictEqual(dpNo, dpWith, "DP keys must diverge on one-shot auto-event history");

  // Back-compat: empty history omits the field entirely (byte-identical to the
  // legacy format), non-empty history appends it.
  assert.ok(!/triggeredAutoEvents/.test(exactNo), "empty history must not add the field to the exact key");
  assert.ok(/triggeredAutoEvents/.test(exactWith), "non-empty history must appear in the exact key");
  assert.ok(!/triggeredAutoEvents/.test(dpNo), "empty history must not add the field to the DP key");
  assert.ok(/triggeredAutoEvents/.test(dpWith), "non-empty history must appear in the DP key");

  // Dominance key (HP-ignoring) is derived from the same serializer, so it also
  // separates distinct histories.
  assert.notStrictEqual(buildDominanceKey(noHistory), buildDominanceKey(withHistory));

  // Order independence: the same set of fired events yields the same key.
  const orderA = baseState({ triggeredAutoEvents: { "F:1,1:0": true, "F:2,2:1": true } });
  const orderB = baseState({ triggeredAutoEvents: { "F:2,2:1": true, "F:1,1:0": true } });
  assert.strictEqual(buildStateKey(orderA), buildStateKey(orderB), "history key must be order independent");
  // A falsy entry is treated as not-fired (no phantom identity).
  const falsy = baseState({ triggeredAutoEvents: { "F:1,1:0": false } });
  assert.strictEqual(buildStateKey(falsy), buildStateKey(noHistory), "unfired entries must not change identity");
}

// A synthetic simulator that models a one-time HP grant: arriving with the
// auto-event unfired grants +150 HP and marks it fired; arriving with it already
// fired grants nothing. Phases sit on DISTINCT tiles so the DP key (which omits
// hp and the custom phase marker) separates them; the two split children share
// a tile and differ ONLY by one-shot history. The losing (already-fired) child
// is returned FIRST, so pre-fix it registered first and the winning unfired
// child collided on the same key and was rejected by same-hp dominance, hiding
// the +150 branch. With the identity fix the two children get distinct DP keys
// and both survive. (Search states are route-free internally, so phases are
// driven off the preserved `phase` marker, never off state.route.)
function makeAutoEventSimulator() {
  return {
    project: { floorsById: { F: { floorId: "F", width: 5, height: 5, map: [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]], changeFloor: {} } } },
    createInitialState: () => baseState({ phase: "root", loc: { x: 1, y: 1 } }),
    getActionFingerprint: (action) => `fp:${action.summary}`,
    enumeratePrimitiveActions: (state) => {
      if (state.phase === "root") return { actions: [{ kind: "walk", summary: "split@F:1,1" }] };
      if (state.phase === "arrived") return { actions: [{ kind: "walk", summary: "arrive@F:2,2" }] };
      return { actions: [] };
    },
    applyAction: (state, action) => {
      if (action.summary.startsWith("split")) {
        // Same tile, same hp, identical identity EXCEPT one-shot auto-event
        // history. Losing child (already fired) first on purpose.
        const fired = baseState({ phase: "arrived", loc: { x: 2, y: 2 }, triggeredAutoEvents: { "F:auto": true } });
        const unfired = baseState({ phase: "arrived", loc: { x: 2, y: 2 }, triggeredAutoEvents: {} });
        return [fired, unfired];
      }
      // "arrive": one-time grant only if the auto-event has not fired yet.
      const alreadyFired = Boolean((state.triggeredAutoEvents || {})["F:auto"]);
      return baseState({
        phase: "done",
        loc: { x: 3, y: 3 },
        hp: alreadyFired ? 100 : 250,
        triggeredAutoEvents: { "F:auto": true },
      });
    },
  };
}

function checkSearchKeepsDistinctHistories() {
  const simulator = makeAutoEventSimulator();
  const result = searchDP(simulator, simulator.createInitialState(), {
    maxExpansions: 50,
    maxActionsPerState: 10,
    dpSkylineMax: 1,
    stopOnFirstGoal: false,
    goalPredicate: (state) => state.hero.hp >= 250,
  });
  // With the fix the unfired-history arrival survives as its own DP bucket and
  // reaches the +150 grant, so the >=250 goal is found. Pre-fix both arrival
  // states shared one key and the winning branch could be dropped.
  assert(result.bestGoalState, "distinct one-shot histories must both survive so the winning branch is found");
  assert.strictEqual(result.bestGoalState.hero.hp, 250);
  assert.strictEqual(result.modelErrors, 0, "no model errors expected in this synthetic tower");
}

function checkSnapshotRoundTrip() {
  const project = {
    floorsById: { F: { floorId: "F", width: 5, height: 5, map: [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]], changeFloor: {} } },
    mapTilesByNumber: {},
    mapNumbersById: {},
    data: { firstData: { floorId: "F", hero: { hp: 100, hpmax: 500, atk: 10, def: 10, mdef: 0, lv: 1, exp: 0, money: 0, mana: 0, manamax: 0, loc: { x: 1, y: 1, direction: "down" } } } },
  };

  const empty = baseState();
  const emptySnapshot = buildSolverSnapshot(project, empty, {});
  assert.ok(!("triggeredAutoEvents" in emptySnapshot), "empty history must not be persisted in the snapshot");
  const emptyRestored = createStateFromSnapshot(project, emptySnapshot, {});
  assert.deepStrictEqual(emptyRestored.triggeredAutoEvents, {}, "empty history restores as empty map");

  const withHistory = baseState({ triggeredAutoEvents: { "F:1,1:0": true, "F:2,2:1": true } });
  const snapshot = buildSolverSnapshot(project, withHistory, {});
  assert.deepStrictEqual(snapshot.triggeredAutoEvents, ["F:1,1:0", "F:2,2:1"], "non-empty history persists as a sorted array");
  const restored = createStateFromSnapshot(project, snapshot, {});
  assert.deepStrictEqual(
    restored.triggeredAutoEvents,
    { "F:1,1:0": true, "F:2,2:1": true },
    "restored state must not re-fire already-consumed one-shot auto-events",
  );
  // Identity survives the round trip.
  assert.strictEqual(buildStateKey(restored), buildStateKey(withHistory));
}

function main() {
  checkKeyIdentityAndBackCompat();
  checkSearchKeepsDistinctHistories();
  checkSnapshotRoundTrip();
  console.log("check-state-identity-auto-events: ok (one-shot auto-event history is part of state identity + snapshot round trip)");
}

if (require.main === module) main();

module.exports = { main };
