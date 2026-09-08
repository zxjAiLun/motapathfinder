"use strict";

/** TEST GRADE: local-regression */

/**
 * PR-5.25a Iteration 2 — qualification harness.
 *
 * New in Iteration 2 (memory representation reduction):
 *   G33-REPR: LEGACY vs COMPACT representation equivalence on fixed work —
 *     identical expanded exact keys sequence, accepted keys, duplicate
 *     decisions, goal result, route reconstruction.
 *   Memory telemetry: fullStatesRetained ≈ OPEN (not ALL accepted), RSS per
 *     accepted / per open, closed/open counts.
 *
 * L1 micros / L2 / L3 carried from Iteration 1 (same evaluator, same budgets).
 */

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert");
const { loadProject } = require("./lib/project-loader");
const { StaticSimulator } = require("./lib/simulator");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { createEventForwardSearch } = require("./lib/event-forward-search");
const {
  createMultiStepResourceLookahead,
  abstractBattleCost,
  FROZEN_PARAMS,
} = require("./lib/multi-step-resource-lookahead");
const { buildStateKey } = require("./lib/state-key");

const PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");

function makeSimulator(project) {
  return new StaticSimulator(project, {
    stopFloorId: "MT11",
    battleResolver: new FunctionBackedBattleResolver(project),
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    searchGraphMode: "primitive",
    walkReachabilityMode: "safe-fast",
  });
}

function makeEvaluator(project, simulator) {
  return createMultiStepResourceLookahead(project, { simulator });
}

// ============ G33-REPR: TRUE legacy vs compact representation equivalence ============
// Run the SAME fixed-work search in legacy mode (retains state+action on
// close) vs compact mode (releases both). Compare:
//   - expanded exact-key sequence
//   - accepted exact-key sequence
//   - duplicate-decision key sequence
//   - found / route (on a small goal case)
//   - memory contract: compact CLOSED nodes have 0 states + 0 actions retained
function gateRepresentationEquivalence(project, simulator) {
  const efs = createEventForwardSearch(simulator);
  const init = simulator.createInitialState({ rank: "chaos" });
  const FIXED = { maxExpansions: 500, maxRuntimeMs: 60000, maxRssMb: 2048, trackKeyDigest: true };
  const isGoal = () => false; // run to budget

  if (typeof global.gc === "function") global.gc();
  const legacy = efs.search(JSON.parse(JSON.stringify(init)), {
    isGoalState: isGoal, representation: "legacy", ...FIXED,
  });
  if (typeof global.gc === "function") global.gc();
  const compact = efs.search(JSON.parse(JSON.stringify(init)), {
    isGoalState: isGoal, representation: "compact", ...FIXED,
  });

  // G33-1: expanded exact-key sequence identical.
  assert.deepStrictEqual(compact.digest.expandedKeys, legacy.digest.expandedKeys,
    "G33: expanded exact-key sequence must be identical between legacy and compact");

  // G33-2: accepted exact-key sequence identical.
  assert.deepStrictEqual(compact.digest.acceptedKeys, legacy.digest.acceptedKeys,
    "G33: accepted exact-key sequence must be identical");

  // G33-3: duplicate-decision key sequence identical.
  assert.deepStrictEqual(compact.digest.duplicateDecisionKeys, legacy.digest.duplicateDecisionKeys,
    "G33: duplicate-decision sequence must be identical");

  // G33-4: counts identical.
  assert.strictEqual(compact.expansions, legacy.expansions);
  assert.strictEqual(compact.accepted, legacy.accepted);
  assert.strictEqual(compact.duplicatesSkipped, legacy.duplicatesSkipped);

  // G33-5: compact CLOSED nodes have 0 full states + 0 full actions retained.
  assert.strictEqual(compact.memory.fullStatesRetained, compact.memory.openNodes,
    `G33: compact fullStatesRetained (${compact.memory.fullStatesRetained}) must equal openNodes (${compact.memory.openNodes})`);
  assert.strictEqual(compact.memory.fullActionsRetained, 0,
    `G33: compact fullActionsRetained must be 0 (got ${compact.memory.fullActionsRetained})`);
  assert.strictEqual(compact.memory.closedNodes, compact.expansions);
  assert.ok(compact.memory.fullStatesRetained < compact.accepted);

  // G33-6: legacy mode retains states on close (validates the test actually
  // exercised the different representation).
  assert.strictEqual(legacy.memory.closedNodes, legacy.expansions);
  assert.ok(legacy.registrySize > 0);

  // G33-7: route reconstruction identical on a small goal case.
  const legacyGoal = efs.search(JSON.parse(JSON.stringify(init)), {
    isGoalState: (s) => s.hero.exp >= 1, maxExpansions: 50, maxRuntimeMs: 30000,
    representation: "legacy",
  });
  const compactGoal = efs.search(JSON.parse(JSON.stringify(init)), {
    isGoalState: (s) => s.hero.exp >= 1, maxExpansions: 50, maxRuntimeMs: 30000,
    representation: "compact",
  });
  assert.strictEqual(compactGoal.found, legacyGoal.found, "G33: small goal found must match");
  assert.deepStrictEqual(compactGoal.route, legacyGoal.route, "G33: route must match");
  assert.ok(compactGoal.route.length > 0, "G33: route must be non-empty");

  return {
    gate: "representation-equivalence",
    passed: true,
    legacy: {
      expansions: legacy.expansions,
      accepted: legacy.accepted,
      duplicatesSkipped: legacy.duplicatesSkipped,
      fullStatesRetained: legacy.memory.fullStatesRetained,
      fullActionsRetained: legacy.memory.fullActionsRetained,
    },
    compact: {
      expansions: compact.expansions,
      accepted: compact.accepted,
      duplicatesSkipped: compact.duplicatesSkipped,
      fullStatesRetained: compact.memory.fullStatesRetained,
      fullActionsRetained: compact.memory.fullActionsRetained,
    },
    expandedKeysIdentical: true,
    acceptedKeysIdentical: true,
    duplicateDecisionsIdentical: true,
    routeReconstructionIdentical: true,
    compactClosedStateRefs: 0,
    compactRetainedFullActionObjects: 0,
  };
}

// ============ Memory qualification (fixed-work, both arms) ============
function runMemoryQualification() {
  const project = loadProject(PROJECT_ROOT);
  const simulator = makeSimulator(project);
  const efs = createEventForwardSearch(simulator);
  const evaluator = makeEvaluator(project, simulator);
  const init = simulator.createInitialState({ rank: "chaos" });
  const FIXED = { maxExpansions: 2000, maxRuntimeMs: 180000, maxRssMb: 2048 };
  const isGoal = () => false;

  if (typeof global.gc === "function") global.gc();
  const control = efs.search(JSON.parse(JSON.stringify(init)), {
    isGoalState: isGoal, ...FIXED,
  });
  if (typeof global.gc === "function") { global.gc(); global.gc(); }
  const treatment = efs.search(JSON.parse(JSON.stringify(init)), {
    isGoalState: isGoal,
    evaluator: { rank: (state) => evaluator.evaluate(state, { floorId: "MT5", enemyId: "blueKing", x: 6, y: 7 }).score },
    ...FIXED,
  });

  return {
    level: "memory-qualification-fixed-work",
    control: {
      expansions: control.expansions,
      accepted: control.accepted,
      wallMs: control.wallMs,
      peakRssMb: control.peakRssMb,
      stoppedReason: control.stoppedReason,
      memory: control.memory,
    },
    treatment: {
      expansions: treatment.expansions,
      accepted: treatment.accepted,
      wallMs: treatment.wallMs,
      peakRssMb: treatment.peakRssMb,
      stoppedReason: treatment.stoppedReason,
      evaluatorCalls: treatment.evaluatorCalls,
      evaluatorWallMs: treatment.evaluatorWallMs,
      memory: treatment.memory,
    },
  };
}

// ============ L1 micros (from Iteration 1, unchanged) ============
function microOrdering(project, simulator) {
  const evaluator = makeEvaluator(project, simulator);
  const init = simulator.createInitialState({ rank: "chaos" });
  const res = evaluator.evaluate(init, { floorId: "MT1", enemyId: "skeleton", x: 4, y: 1 });
  assert.ok(res.plansConsidered >= 2);
  const trace = res.trace[0];
  assert.ok(trace && trace.projected);
  return { micro: "ordering", passed: true, plansConsidered: res.plansConsidered };
}
function microThreshold() {
  const before = abstractBattleCost({ hp: 800, atk: 10, def: 5, mdef: 0 }, { hp: 300, atk: 20, def: 0 });
  const after = abstractBattleCost({ hp: 800, atk: 13, def: 5, mdef: 0 }, { hp: 300, atk: 20, def: 0 });
  assert.ok(before.turns > after.turns && after.damage < before.damage);
  return { micro: "threshold", passed: true };
}
function microSynergy() {
  const enemy = { hp: 200, atk: 50, def: 12 };
  assert.strictEqual(abstractBattleCost({ hp: 500, atk: 22, def: 10, mdef: 0 }, enemy).survivable, false);
  assert.strictEqual(abstractBattleCost({ hp: 500, atk: 12, def: 45, mdef: 0 }, enemy).survivable, false);
  assert.strictEqual(abstractBattleCost({ hp: 500, atk: 22, def: 45, mdef: 0 }, enemy).survivable, true);
  return { micro: "synergy", passed: true };
}
function microIrreversible(project, simulator) {
  const evaluator = makeEvaluator(project, simulator);
  const init = simulator.createInitialState({ rank: "chaos" });
  const res = evaluator.evaluate(init, { floorId: "MT1", enemyId: "skeleton", x: 4, y: 1 });
  const plan = res.bestProjectedPlan || [];
  assert.strictEqual(plan.length, new Set(plan).size);
  return { micro: "irreversible-investment", passed: true };
}

// ============ L2 / L3 (same budgets as Iteration 1) ============
function runL2Diagnostic() {
  const project = loadProject(PROJECT_ROOT);
  const simulator = makeSimulator(project);
  const efs = createEventForwardSearch(simulator);
  const evaluator = makeEvaluator(project, simulator);
  const fixture = require("./fixtures/perf/onlyup-524e-cf-source.json");
  const isGoal = (s) => s.floorId === "MT4";
  const allowedFloors = ["MT2", "MT3", "MT4"];
  const BUDGET = { maxExpansions: 10000, maxRuntimeMs: 120000, maxRssMb: 2048 };

  if (typeof global.gc === "function") global.gc();
  const control = efs.search(JSON.parse(JSON.stringify(fixture.state)), {
    isGoalState: isGoal, allowedFloors, ...BUDGET,
  });
  if (typeof global.gc === "function") { global.gc(); global.gc(); }
  const treatment = efs.search(JSON.parse(JSON.stringify(fixture.state)), {
    isGoalState: isGoal, allowedFloors,
    evaluator: { rank: (state) => evaluator.evaluate(state, { floorId: "MT4", enemyId: "skeletonCaptain", x: 8, y: 3 }).score },
    ...BUDGET,
  });

  return {
    level: "L2-controlled-mt2-mt4-diagnostic",
    control: { found: control.found, expansions: control.expansions, wallMs: control.wallMs, stoppedReason: control.stoppedReason, accepted: control.accepted, memory: control.memory },
    treatment: { found: treatment.found, expansions: treatment.expansions, wallMs: treatment.wallMs, stoppedReason: treatment.stoppedReason, accepted: treatment.accepted, evaluatorCalls: treatment.evaluatorCalls, evaluatorWallMs: treatment.evaluatorWallMs, memory: treatment.memory },
  };
}

function strictReplay(project, simulator, routeEntries) {
  let state = simulator.createInitialState({ rank: "chaos" });
  for (const summary of routeEntries) {
    const actions = simulator.enumeratePrimitiveActions(state).actions;
    const matching = actions.find((a) => a.summary === summary);
    if (!matching) return { ok: false, reason: `action-not-enumerated: ${summary}` };
    state = simulator.applyAction(state, matching, { storeRoute: true });
  }
  return { ok: true, finalFloor: state.floorId, finalHero: state.hero };
}

function runL3RealAB() {
  const project = loadProject(PROJECT_ROOT);
  const simulator = makeSimulator(project);
  const efs = createEventForwardSearch(simulator);
  const evaluator = makeEvaluator(project, simulator);
  const initialState = simulator.createInitialState({ rank: "chaos" });
  const terminalGoal = { type: "bossDefeated", floorId: "MT5", x: 6, y: 7, enemyId: "blueKing" };
  const isGoal = (state) => {
    if (state.floorId !== terminalGoal.floorId) return false;
    const fs = (state.floorStates || {})[terminalGoal.floorId] || {};
    return Boolean(fs.removed && fs.removed[`${terminalGoal.x},${terminalGoal.y}`]);
  };
  const allowedFloors = ["MT1", "MT2", "MT3", "MT4", "MT5"];
  const BUDGET = { maxExpansions: 120000, maxRuntimeMs: 180000, maxRssMb: 2048 };

  if (typeof global.gc === "function") global.gc();
  const control = efs.search(JSON.parse(JSON.stringify(initialState)), {
    isGoalState: isGoal, allowedFloors, ...BUDGET,
  });
  if (typeof global.gc === "function") { global.gc(); global.gc(); }
  const treatment = efs.search(JSON.parse(JSON.stringify(initialState)), {
    isGoalState: isGoal, allowedFloors,
    evaluator: { rank: (state) => evaluator.evaluate(state, terminalGoal).score },
    ...BUDGET,
  });

  let controlReplay = null;
  if (control.found && control.route) controlReplay = strictReplay(project, simulator, control.route);
  let treatmentReplay = null;
  if (treatment.found && treatment.route) treatmentReplay = strictReplay(project, simulator, treatment.route);

  let verdict;
  if (treatment.found && treatmentReplay && treatmentReplay.ok && !control.found) verdict = "CAPABILITY_GAIN_PROVEN";
  else if (control.found && treatment.found) verdict = "BOTH_FOUND_EFFICIENCY_COMPARISON";
  else if (!control.found && !treatment.found) verdict = "NO_CAPABILITY_WINNER";
  else if (control.found && !treatment.found) verdict = "EVALUATOR_NEGATIVE_SIGNAL";
  else if (treatment.found && treatmentReplay && !treatmentReplay.ok) verdict = "FAIL_REPLAY_INVALID";
  else verdict = "INDETERMINATE";

  return {
    level: "L3-terminal-only-real-region",
    budget: BUDGET,
    control: {
      found: control.found, replayValid: controlReplay ? controlReplay.ok : null,
      routeLength: control.route ? control.route.length : null,
      expansions: control.expansions, accepted: control.accepted,
      wallMs: control.wallMs, peakRssMb: control.peakRssMb, stoppedReason: control.stoppedReason,
      memory: control.memory,
    },
    treatment: {
      found: treatment.found, replayValid: treatmentReplay ? treatmentReplay.ok : null,
      routeLength: treatment.route ? treatment.route.length : null,
      expansions: treatment.expansions, accepted: treatment.accepted,
      wallMs: treatment.wallMs, peakRssMb: treatment.peakRssMb, stoppedReason: treatment.stoppedReason,
      evaluatorCalls: treatment.evaluatorCalls, evaluatorWallMs: treatment.evaluatorWallMs,
      evaluatorWallSharePercent: treatment.wallMs > 0 ? Number(((treatment.evaluatorWallMs / treatment.wallMs) * 100).toFixed(1)) : null,
      memory: treatment.memory,
    },
    verdict,
  };
}

function main() {
  const project = loadProject(PROJECT_ROOT);
  const simulator = makeSimulator(project);

  const g33 = gateRepresentationEquivalence(project, simulator);
  const memQual = runMemoryQualification();
  const micros = [
    microOrdering(project, simulator),
    microThreshold(),
    microSynergy(),
    microIrreversible(project, simulator),
  ];
  const l2 = runL2Diagnostic();
  const l3 = runL3RealAB();

  const report = {
    schema: "motapathfinder.event-forward-search-lookahead.v5",
    milestone: "PR-5.25a Iteration 2 (memory representation reduction)",
    frozenParams: FROZEN_PARAMS,
    g33RepresentationEquivalence: g33,
    memoryQualification: memQual,
    l1Micros: micros,
    l2Diagnostic: l2,
    l3RealAB: l3,
  };
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  }
}

module.exports = {};
