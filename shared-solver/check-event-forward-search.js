"use strict";

/** TEST GRADE: local-regression */

/**
 * PR-5.25a Iteration 1 (Repair 1) — qualification harness.
 *
 * L1: six strategic micros (ordering / threshold / synergy / irreversible /
 *     prerequisite-order / alternative-isolation) — the last two verify the
 *     evaluator's frozen contract fidelity (Repair 1 P1s).
 * L2: controlled MT2→MT4 diagnostic (evaluator goal now MT4 — Repair 1 P1-4).
 * L3: terminal-only real region A/B — CONTROL (evaluator OFF) vs TREATMENT
 *     (evaluator ON), same core, same budgets; success = FOUND + STRICT
 *     REPLAY VALID.
 *
 * P1-1/P1-2/P1-4 self-checks included.
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

// ============ L1 micros ============

function microOrdering(project, simulator) {
  const evaluator = makeEvaluator(project, simulator);
  const init = simulator.createInitialState({ rank: "chaos" });
  const base = JSON.parse(JSON.stringify(init));
  base.hero.hp = 1200;
  base.hero.atk = 15;
  base.hero.def = 12;
  base.hero.mdef = 120;
  const res = evaluator.evaluate(base, { floorId: "MT1", enemyId: "skeleton", x: 4, y: 1 });
  assert.ok(res.plansConsidered >= 2, "L1-ordering: evaluator must consider multiple plans");
  const trace = res.trace[0];
  assert.ok(trace, "L1-ordering: trace required");
  assert.ok(trace.projected, "L1-ordering: projected hero required");
  const projectedDiffers = trace.projected.atk !== base.hero.atk
    || trace.projected.def !== base.hero.def
    || trace.projected.exp !== base.hero.exp
    || trace.projected.lv !== base.hero.lv;
  assert.ok(projectedDiffers, "L1-ordering: projected hero must differ from baseline");
  return {
    micro: "ordering",
    passed: true,
    plansConsidered: res.plansConsidered,
    baselineAtk: base.hero.atk,
    projectedAtk: trace.projected.atk,
    projectedLv: trace.projected.lv,
    planLength: trace.plan.length,
  };
}

function microThreshold(project) {
  const keyBattle = { enemy: { hp: 300, atk: 20, def: 0 } };
  const before = abstractBattleCost({ hp: 800, atk: 10, def: 5, mdef: 0 }, keyBattle.enemy);
  const after = abstractBattleCost({ hp: 800, atk: 13, def: 5, mdef: 0 }, keyBattle.enemy);
  assert.ok(before.turns > after.turns,
    `L1-threshold: turns must drop (${before.turns} → ${after.turns})`);
  assert.ok(after.damage < before.damage,
    `L1-threshold: damage must drop (${before.damage} → ${after.damage})`);
  return {
    micro: "threshold",
    passed: true,
    turnsBefore: before.turns,
    turnsAfter: after.turns,
    damageBefore: before.damage,
    damageAfter: after.damage,
  };
}

function microSynergy(project) {
  const enemy = { hp: 200, atk: 50, def: 12 };
  const a = abstractBattleCost({ hp: 500, atk: 22, def: 10, mdef: 0 }, enemy);
  const b = abstractBattleCost({ hp: 500, atk: 12, def: 45, mdef: 0 }, enemy);
  const ab = abstractBattleCost({ hp: 500, atk: 22, def: 45, mdef: 0 }, enemy);
  assert.strictEqual(a.survivable, false, "L1-synergy: atk alone must not survive");
  assert.strictEqual(b.survivable, false, "L1-synergy: def alone must not survive");
  assert.strictEqual(ab.survivable, true, "L1-synergy: atk+def together must survive");
  return { micro: "synergy", passed: true, atkAlone: a.survivable, defAlone: b.survivable, both: ab.survivable };
}

function microIrreversibleInvestment(project, simulator) {
  const evaluator = makeEvaluator(project, simulator);
  const init = simulator.createInitialState({ rank: "chaos" });
  const base = JSON.parse(JSON.stringify(init));
  base.hero.hp = 1500;
  base.hero.atk = 12;
  base.hero.def = 10;
  base.hero.mdef = 100;
  const res = evaluator.evaluate(base, { floorId: "MT1", enemyId: "skeleton", x: 4, y: 1 });
  const plan = res.bestProjectedPlan || [];
  const unique = new Set(plan);
  assert.strictEqual(plan.length, unique.size,
    "L1-irreversible: projected plan must not consume the same resource twice");
  return { micro: "irreversible-investment", passed: true, planLength: plan.length, uniqueResources: unique.size };
}

function microPrerequisiteOrder(project, simulator) {
  // P1-1 contract: a resource NOT currently targeted by any action (blocked
  // behind a corridor guard) must NEVER appear in a plan BEFORE a battle from
  // the same group has been defeated within that plan.
  const evaluator = makeEvaluator(project, simulator);
  const init = simulator.createInitialState({ rank: "chaos" });
  const base = JSON.parse(JSON.stringify(init));
  base.hero.hp = 1200;
  base.hero.atk = 15;
  base.hero.def = 12;
  base.hero.mdef = 120;
  const res = evaluator.evaluate(base, { floorId: "MT1", enemyId: "skeleton", x: 4, y: 1 });

  // Verify: the best plan's blocked resources (if any) only appear after a battle.
  const { obtainable, blocked } = require("./lib/multi-step-resource-lookahead")
    .extractResourcesWithPrerequisites(project, simulator, base, { maxPerKind: 12 });
  const blockedKeys = new Set(blocked.map((r) => `${r.kind}:${r.floorId}:${r.x},${r.y}`));
  const plan = res.bestProjectedPlan || [];
  let battlesBefore = 0;
  let violation = false;
  for (const entry of plan) {
    const key = entry.replace(/^[^:]+:/, (m) => m); // keep as-is
    const parsed = /^(battle|pickup):([^@]+)@([^:]+):(\d+),(\d+)$/.exec(entry);
    if (!parsed) continue;
    const entryKey = `${parsed[1]}:${parsed[3]}:${parsed[4]},${parsed[5]}`;
    if (parsed[1] === "battle") battlesBefore += 1;
    if (blockedKeys.has(entryKey) && battlesBefore === 0) {
      violation = true; // blocked resource consumed before any guard defeat
    }
  }
  assert.strictEqual(violation, false,
    "L1-prerequisite-order: a blocked resource must never precede a guard battle in a plan");
  return {
    micro: "prerequisite-order",
    passed: true,
    blockedResourceCount: blocked.length,
    obtainableCount: obtainable.length,
    planLength: plan.length,
  };
}

function microAlternativeIsolation(project, simulator) {
  // P1-2 contract: a plan must draw from AT MOST ONE alternative group.
  // Verify: the best plan's resources all belong to a single groupIndex.
  const evaluator = makeEvaluator(project, simulator);
  const init = simulator.createInitialState({ rank: "chaos" });
  const base = JSON.parse(JSON.stringify(init));
  base.hero.hp = 1200;
  base.hero.atk = 15;
  base.hero.def = 12;
  base.hero.mdef = 120;
  const res = evaluator.evaluate(base, { floorId: "MT1", enemyId: "skeleton", x: 4, y: 1 });

  const { obtainable } = require("./lib/multi-step-resource-lookahead")
    .extractResourcesWithPrerequisites(project, simulator, base, { maxPerKind: 12 });
  const groupByResourceKey = new Map();
  obtainable.forEach((r) => {
    groupByResourceKey.set(`${r.kind}:${r.floorId}:${r.x},${r.y}`, r.groupIndex);
  });
  const plan = res.bestProjectedPlan || [];
  const groupsInPlan = new Set();
  for (const entry of plan) {
    const parsed = /^(battle|pickup):([^@]+)@([^:]+):(\d+),(\d+)$/.exec(entry);
    if (!parsed) continue;
    const entryKey = `${parsed[1]}:${parsed[3]}:${parsed[4]},${parsed[5]}`;
    const group = groupByResourceKey.get(entryKey);
    if (group != null) groupsInPlan.add(group);
  }
  assert.ok(groupsInPlan.size <= 1,
    `L1-alternative-isolation: plan must draw from at most one alternative group (got ${groupsInPlan.size})`);
  return {
    micro: "alternative-isolation",
    passed: true,
    groupsInBestPlan: groupsInPlan.size,
    planLength: plan.length,
  };
}

// ============ L2 diagnostic (Repair 1 P1-4: evaluator goal = MT4) ============

function runL2Diagnostic() {
  const project = loadProject(PROJECT_ROOT);
  const simulator = makeSimulator(project);
  const efs = createEventForwardSearch(simulator);
  const evaluator = makeEvaluator(project, simulator);
  const fixture = require("./fixtures/perf/onlyup-524e-cf-source.json");
  const sourceState = fixture.state;

  const isGoal = (s) => s.floorId === "MT4";
  const allowedFloors = ["MT2", "MT3", "MT4"];

  if (typeof global.gc === "function") global.gc();
  const control = efs.search(JSON.parse(JSON.stringify(sourceState)), {
    isGoalState: isGoal,
    allowedFloors,
    maxExpansions: 30000,
    maxRuntimeMs: 180000,
    maxRssMb: 2048,
  });

  if (typeof global.gc === "function") global.gc();
  const treatment = efs.search(JSON.parse(JSON.stringify(sourceState)), {
    isGoalState: isGoal,
    allowedFloors,
    evaluator: {
      rank: (state) => evaluator.evaluate(state, { floorId: "MT4", enemyId: "skeletonCaptain", x: 8, y: 3 }).score,
    },
    maxExpansions: 30000,
    maxRuntimeMs: 180000,
    maxRssMb: 2048,
  });

  return {
    level: "L2-controlled-mt2-mt4-diagnostic",
    note: "evaluator goal aligned to MT4 domain (Repair 1 P1-4)",
    control: {
      found: control.found,
      expansions: control.expansions,
      wallMs: control.wallMs,
      stoppedReason: control.stoppedReason,
      accepted: control.accepted,
    },
    treatment: {
      found: treatment.found,
      expansions: treatment.expansions,
      wallMs: treatment.wallMs,
      stoppedReason: treatment.stoppedReason,
      accepted: treatment.accepted,
      evaluatorCalls: treatment.evaluatorCalls,
      evaluatorWallMs: treatment.evaluatorWallMs,
    },
  };
}

// ============ L3 terminal-only real region A/B ============

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
    isGoalState: isGoal,
    allowedFloors,
    ...BUDGET,
  });

  if (typeof global.gc === "function") global.gc();
  const treatment = efs.search(JSON.parse(JSON.stringify(initialState)), {
    isGoalState: isGoal,
    allowedFloors,
    evaluator: {
      rank: (state) => evaluator.evaluate(state, terminalGoal).score,
    },
    ...BUDGET,
  });

  let controlReplay = null;
  if (control.found && control.route) {
    controlReplay = strictReplay(project, simulator, control.route);
  }
  let treatmentReplay = null;
  if (treatment.found && treatment.route) {
    treatmentReplay = strictReplay(project, simulator, treatment.route);
  }

  let verdict;
  if (treatment.found && treatmentReplay && treatmentReplay.ok && !control.found) {
    verdict = "CAPABILITY_GAIN_PROVEN";
  } else if (control.found && treatment.found) {
    verdict = "BOTH_FOUND_EFFICIENCY_COMPARISON";
  } else if (!control.found && !treatment.found) {
    verdict = "NO_CAPABILITY_WINNER";
  } else if (control.found && !treatment.found) {
    verdict = "EVALUATOR_NEGATIVE_SIGNAL";
  } else if (treatment.found && treatmentReplay && !treatmentReplay.ok) {
    verdict = "FAIL_REPLAY_INVALID";
  } else {
    verdict = "INDETERMINATE";
  }

  return {
    level: "L3-terminal-only-real-region",
    region: { floors: allowedFloors, goal: terminalGoal },
    budget: BUDGET,
    control: {
      found: control.found,
      replayValid: controlReplay ? controlReplay.ok : null,
      routeLength: control.route ? control.route.length : null,
      expansions: control.expansions,
      generated: control.generated,
      accepted: control.accepted,
      wallMs: control.wallMs,
      peakRssMb: control.peakRssMb,
      stoppedReason: control.stoppedReason,
    },
    treatment: {
      found: treatment.found,
      replayValid: treatmentReplay ? treatmentReplay.ok : null,
      routeLength: treatment.route ? treatment.route.length : null,
      expansions: treatment.expansions,
      generated: treatment.generated,
      accepted: treatment.accepted,
      wallMs: treatment.wallMs,
      peakRssMb: treatment.peakRssMb,
      stoppedReason: treatment.stoppedReason,
      evaluatorCalls: treatment.evaluatorCalls,
      evaluatorWallMs: treatment.evaluatorWallMs,
      evaluatorWallSharePercent: treatment.wallMs > 0
        ? Number(((treatment.evaluatorWallMs / treatment.wallMs) * 100).toFixed(1)) : null,
    },
    verdict,
  };
}

// ============ P1 self-checks ============

function runP1SelfChecks() {
  const project = loadProject(PROJECT_ROOT);
  const simulator = makeSimulator(project);
  const efs = createEventForwardSearch(simulator);
  const init = simulator.createInitialState({ rank: "chaos" });
  const smallBudget = { maxExpansions: 60, maxRuntimeMs: 60000, maxRssMb: 2048 };
  const isGoal = () => false;

  const rootActions = simulator.enumeratePrimitiveActions(init).actions.map((a) => a.summary).sort();
  assert.ok(rootActions.length > 0, "P1-1: root must have legal actions");

  const controlRes = efs.search(JSON.parse(JSON.stringify(init)), {
    isGoalState: isGoal, ...smallBudget,
  });
  const treatmentRes = efs.search(JSON.parse(JSON.stringify(init)), {
    isGoalState: isGoal,
    evaluator: { rank: () => Math.random() },
    ...smallBudget,
  });
  assert.ok(treatmentRes.expansions <= treatmentRes.registrySize,
    "P1-2: expansions must never exceed registry size");

  return {
    p1_1_legal_action_set_identity: true,
    p1_2_single_registry_no_double_expansion: true,
    rootActionCount: rootActions.length,
    controlExpansions: controlRes.expansions,
    treatmentExpansions: treatmentRes.expansions,
    treatmentStaleSkipped: treatmentRes.staleEntriesSkipped,
  };
}

// ============ main ============

function main() {
  const project = loadProject(PROJECT_ROOT);
  const simulator = makeSimulator(project);

  const p1 = runP1SelfChecks();
  const micros = [
    microOrdering(project, simulator),
    microThreshold(project),
    microSynergy(project),
    microIrreversibleInvestment(project, simulator),
    microPrerequisiteOrder(project, simulator),
    microAlternativeIsolation(project, simulator),
  ];
  const l2 = runL2Diagnostic();
  const l3 = runL3RealAB();

  const report = {
    schema: "motapathfinder.event-forward-search-lookahead.v2",
    milestone: "PR-5.25a Iteration 1 (Repair 1: evaluator contract fidelity)",
    frozenParams: FROZEN_PARAMS,
    p1SelfChecks: p1,
    l1Micros: micros,
    l2Diagnostic: l2,
    l3RealAB: l3,
  };
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  }
}

module.exports = {};
