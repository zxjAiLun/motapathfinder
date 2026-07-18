"use strict";

/**
 * TEST GRADE: local-regression
 * Real OnlyUp teacher prefix + hand-written atk/def threshold.
 * Proves local deferral, not automatic full-route closure.
 * Depends on local generated teacher route (not clean-checkout safe).
 * See solver-manifest.json tests entry.
 */

const assert = require("node:assert");
const path = require("node:path");

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const {
  findResourceDeferralProof,
  evaluateResourceCost,
} = require("./lib/resource-deferral-planner");
const { loadProject } = require("./lib/project-loader");
const { readRouteFile } = require("./lib/route-store");
const { StaticSimulator } = require("./lib/simulator");

const PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const TEACHER_ROUTE = path.join(
  __dirname,
  "routes",
  "generated",
  "mt5-51533-prefix59-to-i894.full.route.json",
);
const RESOURCE = "battle:skeletonKing@MT4:8,3";

function findAction(simulator, state, summary) {
  const actions = [];
  actions.push(...((simulator.enumeratePrimitiveActions(state) || {}).actions || []));
  actions.push(...(simulator.enumerateActions(state) || []));
  return actions.find((action) => action && action.summary === summary) || null;
}

function replayPrefix(simulator, route, count) {
  let state = simulator.createInitialState({ rank: "chaos" });
  for (const decision of (route.decisions || []).slice(0, count)) {
    const action = findAction(simulator, state, decision.summary);
    assert.ok(action, `teacher prefix action missing: ${decision.summary}`);
    state = simulator.applyAction(state, action);
  }
  return state;
}

function checkBreakpointV2OnMt5() {
  const project = loadProject(PROJECT_ROOT);
  const simulator = new StaticSimulator(project, {
    stopFloorId: "MT6",
    battleResolver: new FunctionBackedBattleResolver(project),
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFightToLevelUp: false,
    enableResourcePocket: false,
    enableResourceCluster: false,
    enableResourceChain: false,
    searchGraphMode: "primitive",
  });
  const route = readRouteFile(TEACHER_ROUTE);
  const start = replayPrefix(simulator, route, 70);
  const baseline = evaluateResourceCost(simulator, start, RESOURCE);
  assert.equal(baseline.supported, true, "step 70 resource cost should be supported");
  assert.equal(baseline.damage, 11697, "teacher breakpoint baseline damage should be 11697");

  const proof = findResourceDeferralProof(simulator, start, {
    summary: RESOURCE,
    allowedFloors: ["MT4", "MT5"],
    minHero: { atk: 1077, def: 895 },
  }, {
    maxExpansions: 2000,
    maxRuntimeMs: 15000,
    minDamageSaving: 5000,
    allowedFloors: ["MT4", "MT5"],
    goalSkylineLimit: 4,
    dpSkylineMax: 4,
  });
  assert.equal(proof.model, "breakpoint-v2");
  assert.ok(Array.isArray(proof.proofs), "V2 should expose proof skyline");
  assert.ok(proof.proofs.length > 0, `expected breakpoint proof, got ${proof.stoppedReason}`);
  const best = proof.proofs[0];
  const thresholdProof = proof.proofs.find((candidate) =>
    candidate.hero.atk >= 1077 && candidate.hero.def >= 895,
  );
  assert.ok(best.damageSaving >= 5000, "proof must meet minimum damage saving");
  assert.ok(best.deferredDamage <= 6697, "deferred damage must be below breakpoint cap");
  assert.ok(best.survivable, "retained resource must remain survivable");
  assert.ok(thresholdProof, "proof skyline should preserve the teacher attack/defense threshold role");
  assert.ok(thresholdProof.hp > thresholdProof.deferredDamage, "threshold proof HP must exceed resource damage");
  return {
    baselineDamage: baseline.damage,
    deferredDamage: best.deferredDamage,
    damageSaving: best.damageSaving,
    hp: best.hp,
    atk: thresholdProof.hero.atk,
    def: thresholdProof.hero.def,
    routeLength: best.routeLength,
  };
}

function main() {
  const result = checkBreakpointV2OnMt5();
  console.log(`resource deferral checks passed: ${JSON.stringify(result)}`);
}

if (require.main === module) main();

module.exports = { checkBreakpointV2OnMt5 };
