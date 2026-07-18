"use strict";

/**
 * TEST GRADE: unit
 * Synthetic resource-timing model checks. Not OnlyUp full-route closure.
 * See solver-manifest.json tests entry.
 */

const assert = require("node:assert");

const {
  analyzeResourceTransition,
  analyzeStateResourceTiming,
  annotateStateResourceTiming,
  compareResourceTimingStates,
  getTiming,
  hasTimingConflict,
} = require("./lib/resource-timing-model");
const { searchDP } = require("./lib/dp-search");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeState(overrides) {
  return {
    floorId: "SYN_TIMING",
    hero: {
      hp: 100,
      hpmax: 500,
      atk: 10,
      def: 0,
      mdef: 0,
      lv: 1,
      exp: 0,
      equipment: [],
      loc: { x: 1, y: 1 },
    },
    inventory: {},
    flags: {},
    visitedFloors: { SYN_TIMING: true },
    floorStates: { SYN_TIMING: { removed: {}, replaced: {} } },
    route: [],
    meta: { decisionDepth: 0 },
    ...(overrides || {}),
  };
}

function createSimulator() {
  return {
    project: { floorOrder: ["SYN_TIMING"] },
    getActionFingerprint(action) {
      return action.summary;
    },
    enumeratePrimitiveActions(state) {
      const actions = [];
      if (!state.flags.potionTaken) {
        actions.push({
          kind: "pickup",
          summary: "pickup:breakpointPotion@SYN_TIMING:2,1",
          floorId: "SYN_TIMING",
          x: 2,
          y: 1,
        });
      }
      actions.push({
        kind: "battle",
        summary: "battle:thresholdEnemy@SYN_TIMING:3,1",
        floorId: "SYN_TIMING",
        x: 3,
        y: 1,
      });
      return { actions };
    },
    applyActionPreview(state, action) {
      const next = clone(state);
      next.route = (next.route || []).concat(action.summary);
      if (action.kind === "pickup") {
        next.flags.potionTaken = true;
        next.hero.def += 10;
        next.hero.hp += 100;
        next.floorStates.SYN_TIMING.removed["2,1"] = true;
      }
      next.meta.decisionDepth = next.route.length;
      return next;
    },
    battleResolver: {
      evaluateBattle(state, floorId, x, y, enemyId) {
        return {
          supported: true,
          enemy: { id: enemyId, special: 0 },
          damageInfo: {
            damage: state.hero.def >= 10 ? 40 : 90,
            turn: state.hero.def >= 10 ? 1 : 2,
          },
        };
      },
    },
  };
}

function checkDeferredResourcePremium() {
  const simulator = createSimulator();
  const before = makeState();
  const action = simulator.enumeratePrimitiveActions(before).actions[0];
  const after = simulator.applyActionPreview(before, action);
  const record = analyzeResourceTransition(simulator, before, action, after, { goal: {} }, {
    calculateThresholds: true,
    targetLimit: 4,
    resourceLimit: 4,
    thresholdLimit: 3,
  });
  assert.ok(record, "resource transition should be classified");
  assert.equal(record.kind, "stat", "bundled healing and defense pickup should be a stat resource");
  assert.ok(record.effects.hp > 0, "the stat resource should still expose its HP effect");
  assert.equal(record.deferredReachable, true, "current state can survive the target without using the resource");
  assert.equal(record.immediateReachable, true, "resource use should preserve the target action");
  assert.ok(record.projectedDamageSaving > 0, "resource should reduce future combat damage");
  assert.ok(record.deferPremium > 0, "delaying the resource should have measurable option value");
  assert.ok(record.proofActions.includes("battle:thresholdEnemy@SYN_TIMING:3,1"));
  assert.ok(record.breakpointTargets[0].before.minHpToSurvive != null, "critical HP threshold should be reported");
}

function checkConflictKeepsTimingRole() {
  const left = makeState({ resourceTiming: {
    retainedOptionValue: 10000,
    projectedDamageSaving: 100,
    newlySurvivableTargets: 1,
    resources: [{ roles: ["retained-resource-option"] }],
  } });
  const right = makeState({ resourceTiming: {
    retainedOptionValue: 0,
    projectedDamageSaving: 0,
    newlySurvivableTargets: 0,
    resources: [{ roles: ["future-combat-saving"] }],
  } });
  assert.equal(hasTimingConflict(left, right), true, "different timing roles should create a skyline conflict");
  assert.ok(compareResourceTimingStates(left, right) > 0, "retained-resource role should rank above an empty timing state");
}

function checkOffIsInert() {
  const simulator = createSimulator();
  const before = makeState();
  const action = simulator.enumeratePrimitiveActions(before).actions[0];
  const after = simulator.applyActionPreview(before, action);
  assert.equal(analyzeResourceTransition(simulator, before, action, after, {}, { model: "off" }), null);
}

function checkThresholdCacheIsolation() {
  const simulator = createSimulator();
  const state = makeState();
  const context = { cache: new Map() };
  const segment = { id: "synthetic-threshold-cache", goal: {} };
  const withoutThresholds = analyzeStateResourceTiming(
    simulator,
    state,
    segment,
    { model: "breakpoint-v1", calculateThresholds: false },
    context,
  );
  const withThresholds = analyzeStateResourceTiming(
    simulator,
    state,
    segment,
    { model: "breakpoint-v1", calculateThresholds: true },
    context,
  );
  assert.ok(withoutThresholds && withThresholds, "both timing analyses should be available");
  const resource = withThresholds.resources.find((entry) => entry.kind === "stat");
  assert.ok(resource, "the synthetic stat resource should be analyzed");
  assert.ok(
    resource.breakpointTargets[0].before.minHpToSurvive != null,
    "threshold-enabled analysis should not reuse the low-cost cache result",
  );
  assert.ok(context.cache.size >= 2, "threshold mode must have a distinct cache key");
}

function checkDpPreservesTimingAlternatives() {
  const simulator = {
    project: { floorOrder: ["SYN_TIMING"] },
    isTerminal() {
      return false;
    },
  };
  const initial = makeState();
  const actions = [
    { kind: "event", summary: "a-preserve" },
    { kind: "event", summary: "b-consume" },
  ];
  const result = searchDP(simulator, initial, {
    maxExpansions: 2,
    maxActionsPerState: 4,
    stopOnFirstGoal: true,
    goalSkylineLimit: 4,
    preserveGoalArchive: true,
    dpSkylineMax: 4,
    actionProvider(currentSimulator, state) {
      return state.route.length === 0 ? actions : [];
    },
    actionApplier(state, action) {
      const next = clone(state);
      next.route = [action.summary];
      return next;
    },
    stateAnnotator(state) {
      if (state.route[0] === "a-preserve") {
        state.resourceTiming = {
          retainedOptionValue: 5000,
          resources: [{ roles: ["retained-resource-option"], retainedResourceValue: 5000 }],
        };
      } else if (state.route[0] === "b-consume") {
        state.resourceTiming = {
          retainedOptionValue: 2000,
          resources: [{ roles: ["future-combat-saving"], retainedResourceValue: 2000 }],
        };
      }
    },
    dominanceConfig: {
      compare: compareResourceTimingStates,
      hasConflict: (left, right) => hasTimingConflict(left, right),
    },
    skylineCompare: compareResourceTimingStates,
    skylineRoles(state) {
      return state.resourceTiming && state.resourceTiming.resources
        ? state.resourceTiming.resources.flatMap((record) => record.roles || [])
        : ["highest-hp"];
    },
    goalPredicate(state) {
      return state.route.length === 1;
    },
  });
  const goalRoutes = result.goalSkylineStates.map((state) => {
    const entry = state.route[0];
    return typeof entry === "string" ? entry : entry && entry.summary;
  });
  assert.ok(goalRoutes.includes("a-preserve"), "timing-preserving alternative should survive DP dominance");
  assert.ok(goalRoutes.includes("b-consume"), "the competing resource timing state should remain comparable");
}

function checkTimingMetadataIsOutOfBand() {
  const simulator = createSimulator();
  const state = makeState();
  annotateStateResourceTiming(
    simulator,
    state,
    { id: "out-of-band", goal: {} },
    { model: "breakpoint-v1", targetLimit: 2, resourceLimit: 2 },
  );
  assert.equal(state.resourceTiming, undefined, "live state should not carry the full timing report");
  assert.ok(getTiming(state), "timing report should remain available through the side table");
  assert.equal(clone(state).resourceTiming, undefined, "clone payload should not copy timing diagnostics");
}

function main() {
  checkDeferredResourcePremium();
  checkConflictKeepsTimingRole();
  checkOffIsInert();
  checkThresholdCacheIsolation();
  checkDpPreservesTimingAlternatives();
  checkTimingMetadataIsOutOfBand();
  console.log("resource timing model checks passed (6)");
}

if (require.main === module) main();
