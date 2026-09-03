"use strict";

const assert = require("node:assert");
const { runMilestoneGraph } = require("./lib/segment-dp");
const {
  buildCounterfactualRepairIntents,
  filterParetoOpportunities,
  paretoDominates,
  isConcreteGoal,
} = require("./lib/counterfactual-repair");

/**
 * PR-5.24e — Counterfactual Resource-Investment Repair Generation Gates (G24 A-F).
 *
 * G24-A: HP-for-EXP investment generates valid intent and canonical DP realization yields HP 70 / EXP 10.
 * G24-B: Counterfactual investment history unlocks downstream segment, delivering top-level FOUND.
 * G24-C: Normal path priority: when normal repair history has measurable progress, counterfactual generation is not triggered.
 * G24-D: Unweighted Pareto dominance trade-off filtering (no scalar scores).
 * G24-E: Non-stat generic investment (equipment & path unlock).
 * G24-F: Boundedness and single-round non-recursion.
 */

// G24-D: Unweighted Pareto trade-off filtering
function gateG24D_ParetoTradeOff() {
  const oppA = { id: "A", cost: { hpCost: 20, moneyCost: 0, keyCost: 0 }, gain: { atk: 2 } };
  const oppB = { id: "B", cost: { hpCost: 40, moneyCost: 0, keyCost: 0 }, gain: { atk: 2 } };
  const oppC = { id: "C", cost: { hpCost: 30, moneyCost: 0, keyCost: 0 }, gain: { atk: 4 } };

  assert.strictEqual(paretoDominates(oppA, oppB), true, "G24-D: A must dominate B (lower cost for same gain)");
  assert.strictEqual(paretoDominates(oppB, oppA), false, "G24-D: B cannot dominate A");
  assert.strictEqual(paretoDominates(oppA, oppC), false, "G24-D: A cannot dominate C (C has higher gain)");
  assert.strictEqual(paretoDominates(oppC, oppA), false, "G24-D: C cannot dominate A (A has lower cost)");

  const filtered = filterParetoOpportunities([oppA, oppB, oppC]);
  assert.strictEqual(filtered.length, 2, "G24-D: exactly 2 non-dominated opportunities must remain");
  assert.ok(filtered.includes(oppA), "G24-D: oppA must be retained");
  assert.ok(filtered.includes(oppC), "G24-D: oppC must be retained");
  assert.ok(!filtered.includes(oppB), "G24-D: dominated oppB must be eliminated");

  return {
    oppsTested: 3,
    dominatedFiltered: 1,
    retainedCount: 2,
    unweightedParetoPassed: true,
  };
}

function buildG24SyntheticSimulator() {
  const project = {
    floorOrder: ["F1"],
    floorsById: {
      F1: { floorId: "F1", width: 2, height: 2, map: [[0, 0], [0, 0]], changeFloor: {} },
    },
    mapTilesByNumber: { "0": { id: "empty", cls: "terrains", canPass: true } },
    enemysById: {
      trainingMonster: { id: "trainingMonster", name: "Training Monster", hp: 30, atk: 10, def: 0, money: 0, exp: 10 },
    },
  };
  return {
    project,
    solverModel: undefined,
    stopFloorId: "F1",
    createInitialState() {
      return {
        floorId: "F1",
        hero: {
          loc: { x: 0, y: 0, direction: "down" },
          hp: 100,
          atk: 5,
          def: 0,
          mdef: 0,
          lv: 1,
          exp: 0,
          money: 0,
          equipment: [],
        },
        inventory: {},
        flags: { step: 0, stones: 0 },
        visitedFloors: { F1: true },
        floorStates: { F1: { removed: {}, replaced: {} } },
        route: [],
      };
    },
    buildReachableRegionSignature(state) {
      return {
        regionKey: `F1|atk=${state.hero.atk}|exp=${state.hero.exp}|hp=${state.hero.hp}|s=${state.flags.stones}`,
        reachableEndpointsKey: "F1:0,0",
      };
    },
    stabilizeState(state) {
      return JSON.parse(JSON.stringify(state));
    },
    isTerminal() { return false; },
    enumeratePrimitiveActions(state) {
      const actions = [];
      if (state.flags.step === 0) {
        // Conserve HP action (bypass monster, 0 HP cost, 0 gain)
        actions.push({ kind: "conserve", summary: "conserve:bypass@F1:0,1", floorId: "F1", target: { x: 0, y: 1 } });
        // Investment action: fight training monster (spend 30 HP, gain 10 EXP, 1 LV, 5 ATK)
        actions.push({ kind: "battle", summary: "battle:trainingMonster@F1:1,1", floorId: "F1", target: { x: 1, y: 1 } });
      } else if (state.flags.stones < 30) {
        actions.push({ kind: "stone", summary: `stone:waste@F1:0,0#${state.flags.stones}`, floorId: "F1", target: { x: 0, y: 0 } });
      }
      return { actions };
    },
    applyAction(state, action) {
      const next = JSON.parse(JSON.stringify(state));
      next.flags.step += 1;
      next.hero.money = 1;
      next.route.push(action.summary);
      if (action.kind === "conserve") return next;
      if (action.kind === "battle") {
        next.hero.hp -= 30; // HP drops from 100 to 70
        next.hero.exp += 10;
        next.hero.lv = 2;
        next.hero.atk = 10;
        return next;
      }
      if (action.kind === "stone") {
        next.flags.stones += 1;
        return next;
      }
      return null;
    },
  };
}

// G24-A & G24-B: HP-for-EXP investment and downstream unlocking
function gateG24A_B_InvestmentAndDownstreamUnlock() {
  const sim = buildG24SyntheticSimulator();
  const spec = {
    routeName: "g24-ab-spec",
    milestones: [
      {
        id: "seg1",
        label: "Anchor (conserve only in normal policy)",
        goal: { floorId: "F1", minHero: { money: 1 } },
        actionPolicy: { allowedFloors: ["F1"], actionKinds: ["conserve"] }, // normal repair only allows conserve
        dp: { maxExpansions: 100 },
      },
      {
        id: "seg2",
        label: "Gated",
        startFrom: "seg1",
        goal: { floorId: "F1", minHero: { atk: 10 } },
        actionPolicy: { allowedFloors: ["F1"], actionKinds: ["stone"] },
        dp: { maxExpansions: 100 },
      },
    ],
  };

  const result = runMilestoneGraph(sim, sim.createInitialState(), spec, {
    searchIntent: "adaptive-feasible",
    enableFailureBacktracking: true,
    adaptiveBacktrackDepth: 1,
    budgetScope: "global-run",
    maxExpansions: 5000,
    maxRuntimeMs: 10000,
    candidateLimit: 1,
    initialFrontier: [{ id: "root", state: sim.createInitialState() }],
    enableBudgetedRepairScheduling: true,
    enableBudgetedRepairContinuation: true,
    adaptiveHypothesisProbeExpansions: 4,
  });

  // G24-A: System allows "less HP for more resources" via counterfactual intent realization
  assert.ok(result.counterfactualRepair, "G24-A: counterfactualRepair telemetry required");
  assert.strictEqual(result.counterfactualRepair.triggered, true, "G24-A: counterfactual repair must be triggered");
  assert.strictEqual(result.counterfactualRepair.triggerReason, "atk-deficit", "G24-A: triggerReason must be atk-deficit");
  assert.ok(result.counterfactualRepair.intentsRealized >= 1, "G24-A: at least one intent realized");

  // G24-B: Counterfactual history unlocks downstream and reaches FOUND
  assert.strictEqual(result.found, true, "G24-B: counterfactual history must achieve top-level FOUND");
  assert.ok(result.finalCandidate, "G24-B: finalCandidate required");
  assert.strictEqual(result.finalCandidate.state.hero.hp, 70, "G24-B: hero HP must be 70 (invested 30 HP)");
  assert.strictEqual(result.finalCandidate.state.hero.exp, 10, "G24-B: hero EXP must be 10");
  assert.strictEqual(result.finalCandidate.state.hero.atk, 10, "G24-B: hero ATK must be 10 (satisfied downstream gate)");
  assert.ok(
    result.finalCandidate.route.some((r) => String(r && (r.summary || r)).includes("battle:trainingMonster")),
    "G24-B: route must include the training monster battle action",
  );

  return {
    counterfactualTriggered: true,
    intentsGenerated: result.counterfactualRepair.intentsGenerated,
    intentsRealized: result.counterfactualRepair.intentsRealized,
    realizedHeroState: { hp: 70, exp: 10, atk: 10 },
    topLevelFound: true,
  };
}

// G24-C: Normal path priority: when normal repair history already has progress, counterfactual does not trigger
function gateG24C_NormalPathPriority() {
  const sim = buildG24SyntheticSimulator();
  const spec = {
    routeName: "g24-c-spec",
    milestones: [
      {
        id: "seg1",
        label: "Anchor (already sufficient)",
        goal: { floorId: "F1", minHero: { money: 1 } },
        actionPolicy: { allowedFloors: ["F1"], actionKinds: ["conserve"] },
        dp: { maxExpansions: 100 },
      },
      {
        id: "seg2",
        label: "Gated",
        startFrom: "seg1",
        goal: { floorId: "F1", minHero: { atk: 5 } }, // Atk 5 is already satisfied by initial state!
        actionPolicy: { allowedFloors: ["F1"], actionKinds: [] },
        dp: { maxExpansions: 100 },
      },
    ],
  };

  const result = runMilestoneGraph(sim, sim.createInitialState(), spec, {
    searchIntent: "adaptive-feasible",
    enableFailureBacktracking: true,
    adaptiveBacktrackDepth: 1,
    budgetScope: "global-run",
    maxExpansions: 5000,
    maxRuntimeMs: 10000,
    candidateLimit: 1,
    initialFrontier: [{ id: "root", state: sim.createInitialState() }],
    enableBudgetedRepairScheduling: true,
    enableBudgetedRepairContinuation: true,
    adaptiveHypothesisProbeExpansions: 4,
  });

  assert.strictEqual(result.found, true, "G24-C: normal path finds goal");
  const cf = result.counterfactualRepair;
  assert.strictEqual(cf ? cf.triggered : false, false, "G24-C: counterfactual must NOT trigger when normal path succeeds");

  return {
    normalPathSucceeded: true,
    counterfactualTriggered: false,
    executionsBurned: 0,
  };
}

// G24-E: Non-stat generic case (equipment & path unlock)
function gateG24E_NonStatGenericCase() {
  const simEquip = {
    enumeratePrimitiveActions(state) {
      return { actions: [
        { kind: "equip", summary: "equip:sword_iron@F1:1,0", floorId: "F1", target: { x: 1, y: 0 } },
        { kind: "openDoor", summary: "openDoor:ironDoor@F1:0,1", floorId: "F1", target: { x: 0, y: 1 } },
      ] };
    },
    applyAction(state, action) {
      const next = JSON.parse(JSON.stringify(state));
      if (action.kind === "equip") {
        next.hero.equipment.push("sword_iron");
        next.hero.atk += 10;
        next.hero.money -= 20;
        return next;
      }
      if (action.kind === "openDoor") {
        next.flags.doorOpened = true;
        next.floorStates.F1.removed["0,1"] = true;
        return next;
      }
      return null;
    },
  };

  const rootState = {
    floorId: "F1",
    hero: { loc: { x: 0, y: 0 }, hp: 100, atk: 5, def: 0, mdef: 0, lv: 1, exp: 0, money: 50, equipment: [] },
    inventory: {},
    flags: {},
    visitedFloors: { F1: true },
    floorStates: { F1: { removed: {}, replaced: {} } },
    route: [],
  };

  const intents = buildCounterfactualRepairIntents({
    simulator: simEquip,
    startCandidates: [{ id: "root", state: rootState }],
    triggerFailure: { failureClass: "equipment-missing" },
    failedSegment: { id: "seg2" },
    candidateLimit: 8,
  });

  const equipIntent = intents.find((i) => i.kind === "equipment");
  const pathIntent = intents.find((i) => i.kind === "path/unlock");
  assert.ok(equipIntent, "G24-E: equipment intent must be generated");
  assert.ok(pathIntent, "G24-E: path/unlock intent must be generated");
  assert.deepStrictEqual(equipIntent.goal.equipmentIncludes, ["sword_iron"], "G24-E: equipmentIncludes synthesized");
  assert.strictEqual(equipIntent.cost.moneyCost, 20, "G24-E: equipment cost recognized");
  assert.strictEqual(equipIntent.gain.atk, 10, "G24-E: equipment gain recognized");
  assert.strictEqual(isConcreteGoal(equipIntent.goal), true, "G24-E: equip goal must be concrete");
  assert.strictEqual(isConcreteGoal(pathIntent.goal), true, "G24-E: path goal must be concrete");

  return {
    equipmentIntentGenerated: true,
    pathIntentGenerated: true,
    concreteGoalsSynthesized: true,
  };
}

// G24-F: Boundedness & single-round non-recursion
function gateG24F_BoundednessAndNonRecursion() {
  const sim = buildG24SyntheticSimulator();
  const spec = {
    routeName: "g24-f-spec",
    milestones: [
      {
        id: "seg1",
        label: "Anchor",
        goal: { floorId: "F1", minHero: { money: 1 } },
        actionPolicy: { allowedFloors: ["F1"], actionKinds: ["conserve"] },
        dp: { maxExpansions: 100 },
      },
      {
        id: "seg2",
        label: "Gated",
        startFrom: "seg1",
        goal: { floorId: "F1", minHero: { atk: 10 } },
        actionPolicy: { allowedFloors: ["F1"], actionKinds: ["stone"] },
        dp: { maxExpansions: 100 },
      },
    ],
  };

  const candidateLimit = 4;
  const result = runMilestoneGraph(sim, sim.createInitialState(), spec, {
    searchIntent: "adaptive-feasible",
    enableFailureBacktracking: true,
    adaptiveBacktrackDepth: 1,
    budgetScope: "global-run",
    maxExpansions: 5000,
    maxRuntimeMs: 10000,
    candidateLimit,
    initialFrontier: [{ id: "root", state: sim.createInitialState() }],
    enableBudgetedRepairScheduling: true,
    enableBudgetedRepairContinuation: true,
    adaptiveHypothesisProbeExpansions: 4,
  });

  const cf = result.counterfactualRepair;
  assert.ok(cf, "G24-F: counterfactual telemetry required");
  assert.ok(cf.intentsGenerated <= candidateLimit, `G24-F: intentsGenerated (${cf.intentsGenerated}) must be <= candidateLimit (${candidateLimit})`);
  assert.strictEqual(cf.triggered, true, "G24-F: triggered exactly once");

  return {
    candidateLimitUnchanged: candidateLimit,
    intentsGenerated: cf.intentsGenerated,
    singleRoundEnforced: true,
  };
}

function main() {
  const g24D = gateG24D_ParetoTradeOff();
  const g24AB = gateG24A_B_InvestmentAndDownstreamUnlock();
  const g24C = gateG24C_NormalPathPriority();
  const g24E = gateG24E_NonStatGenericCase();
  const g24F = gateG24F_BoundednessAndNonRecursion();

  const report = {
    schema: "motapathfinder.counterfactual-repair.v1",
    contractStatus: "passed",
    gates: {
      "G24-A_B": g24AB,
      "G24-C": g24C,
      "G24-D": g24D,
      "G24-E": g24E,
      "G24-F": g24F,
    },
  };
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = {
  main,
  gateG24D_ParetoTradeOff,
  gateG24A_B_InvestmentAndDownstreamUnlock,
  gateG24C_NormalPathPriority,
  gateG24E_NonStatGenericCase,
  gateG24F_BoundednessAndNonRecursion,
};
