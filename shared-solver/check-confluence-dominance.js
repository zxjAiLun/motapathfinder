"use strict";

const assert = require("node:assert");

const { buildConfluenceDominanceOptions } = require("./lib/cli-options");
const { compareConfluenceResources, dominatesAtConfluence, effectiveRouteLength } = require("./lib/confluence-key");

function makeState(overrides) {
  const config = overrides || {};
  const routeLength = Number(config.routeLength || 0);
  const route = Array.from({ length: routeLength }, (_, index) => `step-${index}`);
  return {
    floorId: "MT1",
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

function testCliPolicy() {
  assert.strictEqual(buildConfluenceDominanceOptions({ "confluence-route-policy": "ignore-length" }, true).confluenceRoutePolicy, "ignore-length");
  assert.strictEqual(buildConfluenceDominanceOptions({}, true, "ignore-length").confluenceRoutePolicy, "ignore-length");
  assert.throws(() => buildConfluenceDominanceOptions({ "confluence-route-policy": "unknown" }, true), /Invalid --confluence-route-policy/);
}

function main() {
  testIgnoreLengthDominatesLongerHighHp();
  testTieBreakKeepsShorterRoute();
  testDifferentFutureStatesDoNotMerge();
  testCliPolicy();
  console.log(JSON.stringify({
    ok: true,
    checks: [
      "ignore-length dominance",
      "slack compatibility",
      "short-route tie-break",
      "future-state isolation",
      "cli policy",
    ],
  }, null, 2));
}

if (require.main === module) {
  main();
}
