"use strict";

const assert = require("node:assert");

const { buildConfluenceDominanceOptions } = require("./lib/cli-options");
const { buildSearchConfluenceKey, compareConfluenceResources, dominatesAtConfluence, effectiveRouteLength } = require("./lib/confluence-key");
const { __testing: searchTesting } = require("./lib/search");

function makeState(overrides) {
  const config = overrides || {};
  const routeLength = Number(config.routeLength || 0);
  const route = Array.from({ length: routeLength }, (_, index) => `step-${index}`);
  return {
    floorId: config.floorId || "MT1",
    hero: {
      loc: { x: 1, y: 1 },
      hp: Number(config.hp || 0),
      hpmax: 1000,
      mana: 0,
      manamax: 0,
      atk: 10,
      def: 8,
      mdef: 2,
      money: Number(config.money || 0),
      exp: 0,
      lv: 1,
      equipment: config.equipment || [],
      followers: [],
    },
    inventory: config.inventory || {},
    flags: config.flags || {},
    visitedFloors: { MT1: true },
    floorStates: {
      MT1: {
        removed: config.removed || { A: true, B: true, C: true },
        replaced: {},
      },
    },
    route,
    meta: { decisionDepth: route.length },
  };
}

function makeSimulator() {
  return {
    buildReachableRegionSignature(state) {
      const loc = state.hero.loc;
      return {
        regionKey: `${state.floorId}:${loc.x},${loc.y}`,
        reachableEndpointsKey: "local-resource-region",
      };
    },
    getCombatSignature(state) {
      const hero = state.hero || {};
      return [hero.atk, hero.def, hero.mdef, hero.lv, hero.exp].join("|");
    },
    compareSearchConfluenceStates(leftState, rightState) {
      return compareConfluenceResources(leftState, rightState);
    },
  };
}

function dominatesWithPolicy(simulator, leftState, rightState, options) {
  const policy = options.policy || "slack";
  if (policy === "ignore-length") return dominatesAtConfluence(simulator, leftState, rightState);
  const slack = Number(options.slack || 0);
  const leftLength = effectiveRouteLength(leftState);
  const rightLength = effectiveRouteLength(rightState);
  return leftLength <= rightLength + slack && simulator.compareSearchConfluenceStates(leftState, rightState) < 0;
}

function testIgnoreLengthDominatesLongerHighHp() {
  const simulator = makeSimulator();
  const shortLowHp = makeState({ hp: 200, routeLength: 2 });
  const longHighHp = makeState({ hp: 500, routeLength: 20 });
  assert.strictEqual(
    dominatesWithPolicy(simulator, longHighHp, shortLowHp, { policy: "ignore-length" }),
    true,
    "ignore-length should let high-HP equivalent states dominate even when route is longer"
  );
  assert.strictEqual(
    dominatesWithPolicy(simulator, longHighHp, shortLowHp, { policy: "slack", slack: 3 }),
    false,
    "slack policy should keep old route-length protection when the route is outside slack"
  );
  assert.strictEqual(
    dominatesWithPolicy(simulator, longHighHp, shortLowHp, { policy: "slack", slack: 30 }),
    true,
    "slack policy should still allow dominance when the longer route is inside slack"
  );
}

function testTieBreakKeepsShorterRoute() {
  const simulator = makeSimulator();
  const shortRoute = makeState({ hp: 500, routeLength: 4 });
  const longRoute = makeState({ hp: 500, routeLength: 9 });
  assert.strictEqual(dominatesAtConfluence(simulator, shortRoute, longRoute), true);
  assert.strictEqual(dominatesAtConfluence(simulator, longRoute, shortRoute), false);
}

function testDifferentFutureStatesDoNotMerge() {
  const simulator = makeSimulator();
  const base = makeState({ hp: 500, routeLength: 5 });
  const differentMutation = makeState({ hp: 700, routeLength: 6, removed: { A: true, B: true } });
  const differentInventory = makeState({ hp: 700, routeLength: 6, inventory: { yellowKey: 1 } });
  const differentFlags = makeState({ hp: 700, routeLength: 6, flags: { openedSecret: true } });
  assert.strictEqual(dominatesAtConfluence(simulator, differentMutation, base), false);
  assert.strictEqual(dominatesAtConfluence(simulator, differentInventory, base), false);
  assert.strictEqual(dominatesAtConfluence(simulator, differentFlags, base), false);
}

function testSafeKeyFiltersDebugFlagsOnly() {
  const simulator = makeSimulator();
  const base = makeState({ hp: 500, flags: { storyGate: 1, "debug:expanded": 1 } });
  const sameFuture = makeState({ hp: 600, flags: { storyGate: 1, "debug:expanded": 2 } });
  const differentFuture = makeState({ hp: 700, flags: { storyGate: 2, "debug:expanded": 1 } });
  assert.strictEqual(buildSearchConfluenceKey(simulator, base, { mode: "safe" }), buildSearchConfluenceKey(simulator, sameFuture, { mode: "safe" }));
  assert.notStrictEqual(buildSearchConfluenceKey(simulator, base, { mode: "safe" }), buildSearchConfluenceKey(simulator, differentFuture, { mode: "safe" }));
}

function testCliPolicy() {
  assert.strictEqual(buildConfluenceDominanceOptions({ "confluence-route-policy": "ignore-length" }, true).confluenceRoutePolicy, "ignore-length");
  assert.strictEqual(buildConfluenceDominanceOptions({}, true, "ignore-length").confluenceRoutePolicy, "ignore-length");
  assert.deepStrictEqual(
    buildConfluenceDominanceOptions({ "confluence-ignore-length-floors": "MT1,MT3" }, true).confluenceIgnoreLengthFloors,
    ["MT1", "MT3"]
  );
  assert.throws(() => buildConfluenceDominanceOptions({ "confluence-route-policy": "unknown" }, true), /Invalid --confluence-route-policy/);
}

function testEffectivePolicyWhitelistAndUnsafeDowngrade() {
  const simulator = {
    requiresExactDominance(state) {
      return state && state.floorId === "MT9";
    },
  };
  const baseConfig = {
    ...buildConfluenceDominanceOptions({
      "confluence-route-policy": "ignore-length",
      "confluence-ignore-length-floors": "MT1,MT2,MT9",
    }, true),
    profileName: "debug-local-resource",
  };
  const stats = { sampleLimit: 8 };
  assert.strictEqual(
    searchTesting.getEffectiveConfluenceRoutePolicy(simulator, makeState({ floorId: "MT1" }), stats, baseConfig, true),
    "ignore-length",
    "whitelisted floors should keep ignore-length"
  );
  assert.strictEqual(
    searchTesting.getEffectiveConfluenceRoutePolicy(simulator, makeState({ floorId: "MT3" }), stats, baseConfig, true),
    "slack",
    "non-whitelisted floors should downgrade to slack"
  );
  assert.strictEqual(stats.confluenceDominance.nonWhitelistedFloorDowngrades, 1);
  assert.strictEqual(
    searchTesting.getEffectiveConfluenceRoutePolicy(simulator, makeState({ floorId: "MT9" }), stats, baseConfig, true),
    "slack",
    "unsafe floors should downgrade even when whitelisted"
  );
  assert.strictEqual(stats.confluenceDominance.unsafeFloorDowngrades, 1);
  const profileConfig = {
    ...buildConfluenceDominanceOptions({ "confluence-route-policy": "ignore-length" }, true),
    profileName: "linear-main",
  };
  assert.strictEqual(
    searchTesting.getEffectiveConfluenceRoutePolicy(simulator, makeState({ floorId: "MT4" }), { sampleLimit: 8 }, profileConfig, true),
    "ignore-length",
    "linear-main may opt into ignore-length when no floor whitelist is configured"
  );
}

function main() {
  testIgnoreLengthDominatesLongerHighHp();
  testTieBreakKeepsShorterRoute();
  testDifferentFutureStatesDoNotMerge();
  testSafeKeyFiltersDebugFlagsOnly();
  testCliPolicy();
  testEffectivePolicyWhitelistAndUnsafeDowngrade();
  console.log(JSON.stringify({
    ok: true,
    checks: [
      "ignore-length dominance",
      "slack compatibility",
      "short-route tie-break",
      "future-state isolation",
      "safe-key debug flag filtering",
      "cli policy",
      "effective policy whitelist",
      "unsafe floor downgrade",
    ],
  }, null, 2));
}

if (require.main === module) {
  main();
}
