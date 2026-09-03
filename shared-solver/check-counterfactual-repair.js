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
 * PR-5.24e — Counterfactual Resource-Investment Repair Generation Gates (G24 A-J).
 *
 * G24-A: HP-for-EXP investment generates valid intent and canonical DP realization yields HP 70 / EXP 10.
 * G24-B: Counterfactual investment history unlocks downstream segment, delivering top-level FOUND.
 * G24-C: Normal path priority: when normal path succeeds, counterfactual generation is not triggered.
 * G24-C2: Normal-first barrier: all normal tickets must complete first probe before counterfactual can trigger.
 * G24-C3: Empty placeholder cannot trigger: placeholder tickets (anchorOutputStateKey=null) cannot trigger CF.
 * G24-D: Unweighted Pareto dominance trade-off filtering (no scalar scores).
 * G24-E: Non-stat generic investment (equipment & path unlock).
 * G24-F: Boundedness and single-round non-recursion.
 * G24-G: Completion authority (G1 indeterminate stops trigger, G2 determinate proof triggers).
 * G24-H: Generic key/resource Pareto dominance and pickup opportunity extraction.
 * G24-I: Cross-floor canonical realization with transition action policy.
 * G24-J: Cross-origin Pareto isolation (different baseline start states cannot dominate each other).
 * G24-J2: Same-origin Pareto dominance still active.
 * G24-J3: Bounded 2D round-robin origin coverage + kind coverage.
 */

// G24-D: Unweighted Pareto trade-off filtering
function gateG24D_ParetoTradeOff() {
  const oppA = { id: "A", cost: { hpCost: 20, moneyCost: 0 }, gain: { atk: 2 } };
  const oppB = { id: "B", cost: { hpCost: 40, moneyCost: 0 }, gain: { atk: 2 } };
  const oppC = { id: "C", cost: { hpCost: 30, moneyCost: 0 }, gain: { atk: 4 } };

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
        actions.push({ kind: "conserve", summary: "conserve:bypass@F1:0,1", floorId: "F1", target: { x: 0, y: 1 } });
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

// G24-C2: Normal-first barrier: all normal tickets must complete first probe before counterfactual can trigger
function gateG24C2_NormalFirstBarrier() {
  function buildMultiCandidateSimulator() {
    const project = {
      floorOrder: ["F1"],
      floorsById: { F1: { floorId: "F1", width: 2, height: 2, map: [[0, 0], [0, 0]], changeFloor: {} } },
      mapTilesByNumber: { "0": { id: "empty", cls: "terrains", canPass: true } },
      enemysById: { monster: { id: "monster", hp: 10, exp: 10, atk: 5 } },
    };
    return {
      project,
      stopFloorId: "F1",
      createInitialState() {
        return {
          floorId: "F1",
          hero: { loc: { x: 0, y: 0, direction: "down" }, hp: 100, atk: 5, def: 0, mdef: 0, lv: 1, exp: 0, money: 0, equipment: [] },
          inventory: {},
          flags: { branch: "none", stones: 0 },
          visitedFloors: { F1: true },
          floorStates: { F1: { removed: {}, replaced: {} } },
          route: [],
        };
      },
      buildReachableRegionSignature(state) {
        return { regionKey: `F1|b=${state.flags.branch}|s=${state.flags.stones}`, reachableEndpointsKey: "F1:0,0" };
      },
      stabilizeState(state) { return JSON.parse(JSON.stringify(state)); },
      isTerminal() { return false; },
      enumeratePrimitiveActions(state) {
        if (state.flags.branch === "none") {
          return { actions: [
            { kind: "conserve", branch: "A", summary: "branch:A", floorId: "F1", target: { x: 0, y: 1 } },
            { kind: "conserve", branch: "B", summary: "branch:B", floorId: "F1", target: { x: 1, y: 0 } },
            { kind: "conserve", branch: "C", summary: "branch:C", floorId: "F1", target: { x: 1, y: 1 } },
            { kind: "battle", branch: "inv", summary: "battle:monster@F1:0,0", floorId: "F1", target: { x: 0, y: 0 } },
          ]};
        }
        if (state.flags.stones < 20) {
          return { actions: [{ kind: "stone", summary: `stone:${state.flags.stones}`, floorId: "F1", target: { x: 0, y: 0 } }] };
        }
        return { actions: [] };
      },
      applyAction(state, action) {
        const next = JSON.parse(JSON.stringify(state));
        next.hero.money = 1;
        next.route.push(action.summary);
        if (action.branch === "A") { next.flags.branch = "A"; next.hero.hp = 2000; return next; }
        if (action.branch === "B") { next.flags.branch = "B"; next.hero.hp = 1500; next.hero.def = 10; return next; }
        if (action.branch === "C") { next.flags.branch = "C"; next.hero.hp = 1200; next.hero.mdef = 10; return next; }
        if (action.branch === "inv") { next.hero.hp -= 20; next.hero.atk = 15; next.flags.branch = "inv"; return next; }
        next.flags.stones += 1;
        return next;
      },
    };
  }

  const sim = buildMultiCandidateSimulator();
  const spec = {
    routeName: "g24-c2-spec",
    milestones: [
      { id: "seg1", label: "Anchor", goal: { floorId: "F1", minHero: { money: 1 } }, actionPolicy: { allowedFloors: ["F1"], actionKinds: ["conserve"] }, dp: { maxExpansions: 100 } },
      { id: "seg2", label: "Gated", startFrom: "seg1", goal: { floorId: "F1", minHero: { atk: 15 } }, actionPolicy: { allowedFloors: ["F1"], actionKinds: ["stone"] }, dp: { maxExpansions: 100 } },
    ],
  };

  // Subcase 1: Candidate C has no headroom (probeCount = 0) -> CF must NOT trigger!
  const resIncomplete = runMilestoneGraph(sim, sim.createInitialState(), spec, {
    searchIntent: "adaptive-feasible", enableFailureBacktracking: true, adaptiveBacktrackDepth: 1, budgetScope: "global-run",
    maxExpansions: 30, maxRuntimeMs: 60000, candidateLimit: 1, initialFrontier: [{ id: "root", state: sim.createInitialState() }],
    enableBudgetedRepairScheduling: true, enableBudgetedRepairContinuation: true, adaptiveHypothesisProbeExpansions: 4,
  });
  const rsIncomp = resIncomplete.repairScheduling || ((resIncomplete.failedSegment || {}).backtrack || {}).repairScheduling;
  assert.ok(rsIncomp, "G24-C2: scheduling telemetry required");
  assert.strictEqual(rsIncomp.hypotheses[2].probeCount, 0, "G24-C2: candidate C has probeCount 0");
  const cfIncomp = resIncomplete.counterfactualRepair || ((resIncomplete.failedSegment || {}).backtrack || {}).counterfactualRepair;
  assert.strictEqual(cfIncomp ? cfIncomp.triggered : false, false, "G24-C2: CF must NOT trigger when normal first round is incomplete");

  // Subcase 2: All candidates A, B, C completed probeCount=1 with NO_PROGRESS -> CF triggers!
  const resComplete = runMilestoneGraph(sim, sim.createInitialState(), spec, {
    searchIntent: "adaptive-feasible", enableFailureBacktracking: true, adaptiveBacktrackDepth: 1, budgetScope: "global-run",
    maxExpansions: 50000, maxRuntimeMs: 60000, candidateLimit: 1, initialFrontier: [{ id: "root", state: sim.createInitialState() }],
    enableBudgetedRepairScheduling: true, enableBudgetedRepairContinuation: true, adaptiveHypothesisProbeExpansions: 4,
  });
  const cfComp = resComplete.counterfactualRepair || ((resComplete.failedSegment || {}).backtrack || {}).counterfactualRepair;
  assert.ok(cfComp, "G24-C2: counterfactual telemetry required for complete run");
  assert.strictEqual(cfComp.triggered, true, "G24-C2: CF MUST trigger when all normal candidates completed first round with no progress");

  return {
    normalFirstRoundIncompleteBlocksCF: true,
    normalFirstRoundCompleteTriggersCF: true,
  };
}

// G24-C3: Empty placeholder cannot trigger counterfactual repair
function gateG24C3_EmptyPlaceholderCannotTrigger() {
  function buildG24C3Simulator() {
    let initialPassDone = false;
    const project = {
      floorOrder: ["F1"],
      floorsById: { F1: { floorId: "F1", width: 2, height: 2, map: [[0, 0], [0, 0]], changeFloor: {} } },
      mapTilesByNumber: { "0": { id: "empty", cls: "terrains", canPass: true } },
      enemysById: { monster: { id: "monster", hp: 10, exp: 10, atk: 5 } },
    };
    return {
      project,
      stopFloorId: "F1",
      createInitialState() {
        return {
          floorId: "F1",
          hero: { loc: { x: 0, y: 0, direction: "down" }, hp: 100, atk: 5, def: 0, mdef: 0, lv: 1, exp: 0, money: 0, equipment: [] },
          inventory: {},
          flags: { step: 0, stones: 0 },
          visitedFloors: { F1: true },
          floorStates: { F1: { removed: {}, replaced: {} } },
          route: [],
        };
      },
      buildReachableRegionSignature(state) {
        return { regionKey: `F1|s=${state.flags.stones}|h=${state.hero.hp}`, reachableEndpointsKey: "F1:0,0" };
      },
      stabilizeState(state) { return JSON.parse(JSON.stringify(state)); },
      isTerminal() { return false; },
      enumeratePrimitiveActions(state) {
        if (state.flags.step === 0) {
          if (!initialPassDone) {
            return { actions: [
              { kind: "conserve", summary: "conserve:bypass@F1:0,1", floorId: "F1", target: { x: 0, y: 1 } },
            ]};
          }
          // During re-expansion of seg1: return empty actions so merged = []!
          return { actions: [] };
        }
        // seg2
        initialPassDone = true;
        if (state.flags.stones < 10) {
          return { actions: [{ kind: "stone", summary: `stone:${state.flags.stones}`, floorId: "F1", target: { x: 0, y: 0 } }] };
        }
        return { actions: [] };
      },
      applyAction(state, action) {
        const next = JSON.parse(JSON.stringify(state));
        next.flags.step += 1;
        next.hero.money = 1;
        next.route.push(action.summary);
        if (action.kind === "conserve") return next;
        next.flags.stones += 1;
        return next;
      },
    };
  }

  const sim = buildG24C3Simulator();
  const spec = {
    routeName: "g24-c3-spec",
    milestones: [
      { id: "seg1", label: "Anchor", goal: { floorId: "F1", minHero: { money: 1 } }, actionPolicy: { allowedFloors: ["F1"], actionKinds: ["conserve"] }, dp: { maxExpansions: 100 } },
      { id: "seg2", label: "Gated", startFrom: "seg1", goal: { floorId: "F1", minHero: { atk: 15 } }, actionPolicy: { allowedFloors: ["F1"], actionKinds: ["stone"] }, dp: { maxExpansions: 100 } },
    ],
  };

  const res = runMilestoneGraph(sim, sim.createInitialState(), spec, {
    searchIntent: "adaptive-feasible",
    enableFailureBacktracking: true,
    adaptiveBacktrackDepth: 1,
    budgetScope: "global-run",
    maxExpansions: 5000,
    maxRuntimeMs: 60000,
    candidateLimit: 1,
    initialFrontier: [{ id: "root", state: sim.createInitialState() }],
    enableBudgetedRepairScheduling: true,
    enableBudgetedRepairContinuation: true,
    adaptiveHypothesisProbeExpansions: 4,
  });

  const cf = res.counterfactualRepair;
  const rs = res.repairScheduling;

  assert.ok(rs, "G24-C3: repairScheduling required");
  assert.strictEqual(rs.hypotheses.length, 1, "G24-C3: exactly 1 hypothesis (placeholder)");
  assert.strictEqual(rs.hypotheses[0].anchorOutputStateKey, null, "G24-C3: placeholder has anchorOutputStateKey === null");
  assert.strictEqual(rs.hypotheses[0].probeCount, 1, "G24-C3: placeholder completed first probe (probeCount === 1)");

  assert.ok(cf, "G24-C3: counterfactual telemetry required");
  assert.strictEqual(cf.triggered, false, "G24-C3: CF must NOT trigger on empty placeholder");
  assert.strictEqual(cf.intentsGenerated, 0, "G24-C3: intentsGenerated must be 0");

  return {
    emptyPlaceholderBlocksCF: true,
    placeholderHasNullStateKey: true,
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
  assert.strictEqual(isConcreteGoal(equipIntent.goal, equipIntent), true, "G24-E: equip goal must be concrete");
  assert.strictEqual(isConcreteGoal(pathIntent.goal, pathIntent), true, "G24-E: path goal must be concrete");

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

// G24-G: Completion authority (G1 indeterminate stops trigger, G2 determinate proof triggers)
function gateG24G_CompletionAuthority() {
  function buildG24GSimulator(maxStones) {
    const stonesCap = maxStones || 20;
    const project = {
      floorOrder: ["F1"],
      floorsById: { F1: { floorId: "F1", width: 2, height: 2, map: [[0, 0], [0, 0]], changeFloor: {} } },
      mapTilesByNumber: { "0": { id: "empty", cls: "terrains", canPass: true } },
      enemysById: { monster: { id: "monster", hp: 10, exp: 10, atk: 5 } },
    };
    return {
      project,
      stopFloorId: "F1",
      createInitialState() {
        return {
          floorId: "F1",
          hero: { loc: { x: 0, y: 0, direction: "down" }, hp: 100, atk: 5, def: 0, mdef: 0, lv: 1, exp: 0, money: 0, equipment: [] },
          inventory: {},
          flags: { step: 0, stones: 0 },
          visitedFloors: { F1: true },
          floorStates: { F1: { removed: {}, replaced: {} } },
          route: [],
        };
      },
      buildReachableRegionSignature(state) {
        return { regionKey: `F1|s=${state.flags.stones}|h=${state.hero.hp}`, reachableEndpointsKey: "F1:0,0" };
      },
      stabilizeState(state) { return JSON.parse(JSON.stringify(state)); },
      isTerminal() { return false; },
      enumeratePrimitiveActions(state) {
        if (state.flags.step === 0) {
          return { actions: [
            { kind: "conserve", summary: "conserve:bypass@F1:0,1", floorId: "F1", target: { x: 0, y: 1 } },
            { kind: "battle", summary: "battle:monster@F1:0,0", floorId: "F1", target: { x: 0, y: 0 } },
          ]};
        }
        if (state.flags.stones < stonesCap) {
          return { actions: [{ kind: "stone", summary: `stone:${state.flags.stones}`, floorId: "F1", target: { x: 0, y: 0 } }] };
        }
        return { actions: [] };
      },
      applyAction(state, action) {
        const next = JSON.parse(JSON.stringify(state));
        next.flags.step += 1;
        next.hero.money = 1;
        next.route.push(action.summary);
        if (action.kind === "conserve") return next;
        if (action.kind === "battle") { next.hero.hp -= 20; next.hero.atk = 15; return next; }
        next.flags.stones += 1;
        return next;
      },
    };
  }

  // Subcase G1: failedExecution has maxExpansions so small that searchComplete is false
  const simG1 = buildG24GSimulator(1000);
  const specG1 = {
    routeName: "test-g1",
    milestones: [
      { id: "seg1", label: "Anchor", goal: { floorId: "F1", minHero: { money: 1 } }, actionPolicy: { allowedFloors: ["F1"], actionKinds: ["conserve"] }, dp: { maxExpansions: 100 } },
      { id: "seg2", label: "Gated", startFrom: "seg1", goal: { floorId: "F1", minHero: { atk: 15 } }, actionPolicy: { allowedFloors: ["F1"], actionKinds: ["stone"] }, dp: { maxExpansions: 50 } },
    ],
  };

  const resG1 = runMilestoneGraph(simG1, simG1.createInitialState(), specG1, {
    searchIntent: "adaptive-feasible",
    enableFailureBacktracking: true,
    adaptiveBacktrackDepth: 1,
    budgetScope: "global-run",
    maxExpansions: 20,
    maxRuntimeMs: 60000,
    candidateLimit: 1,
    initialFrontier: [{ id: "root", state: simG1.createInitialState() }],
    enableBudgetedRepairScheduling: true,
    enableBudgetedRepairContinuation: true,
    adaptiveHypothesisProbeExpansions: 4,
  });
  const cfG1 = resG1.counterfactualRepair || ((resG1.failedSegment || {}).backtrack || {}).counterfactualRepair;
  assert.strictEqual(cfG1 ? cfG1.triggered : false, false, "G24-G1: CF must NOT trigger when failure is indeterminate (searchComplete=false)");

  // Subcase G2: failedExecution has determinate completion proof -> CF triggers
  const simG2 = buildG24GSimulator(20);
  const specG2 = {
    routeName: "test-g2",
    milestones: [
      { id: "seg1", label: "Anchor", goal: { floorId: "F1", minHero: { money: 1 } }, actionPolicy: { allowedFloors: ["F1"], actionKinds: ["conserve"] }, dp: { maxExpansions: 100 } },
      { id: "seg2", label: "Gated", startFrom: "seg1", goal: { floorId: "F1", minHero: { atk: 15 } }, actionPolicy: { allowedFloors: ["F1"], actionKinds: ["stone"] }, dp: { maxExpansions: 100 } },
    ],
  };

  const resG2 = runMilestoneGraph(simG2, simG2.createInitialState(), specG2, {
    searchIntent: "adaptive-feasible",
    enableFailureBacktracking: true,
    adaptiveBacktrackDepth: 1,
    budgetScope: "global-run",
    maxExpansions: 5000,
    maxRuntimeMs: 60000,
    candidateLimit: 1,
    initialFrontier: [{ id: "root", state: simG2.createInitialState() }],
    enableBudgetedRepairScheduling: true,
    enableBudgetedRepairContinuation: true,
    adaptiveHypothesisProbeExpansions: 4,
  });
  const cfG2 = resG2.counterfactualRepair || ((resG2.failedSegment || {}).backtrack || {}).counterfactualRepair;
  assert.strictEqual(cfG2 ? cfG2.triggered : false, true, "G24-G2: CF MUST trigger when failure has determinate completion proof");

  return {
    indeterminateFailureBlocksCF: true,
    determinateFailureTriggersCF: true,
  };
}

// G24-H: Generic key/resource Pareto dominance and pickup opportunity extraction
function gateG24H_GenericKeyResourcePareto() {
  // Subcase 1: B dominates A in inventory cost
  const oppA = {
    id: "A",
    cost: { hpCost: 0, moneyCost: 0, inventoryCost: { yellowKey: 1 } },
    gain: { atk: 0, def: 0, mdef: 0, lv: 0, exp: 0, equipCount: 0, pathOpportunity: 1 },
  };
  const oppB = {
    id: "B",
    cost: { hpCost: 0, moneyCost: 0, inventoryCost: { yellowKey: 0 } },
    gain: { atk: 0, def: 0, mdef: 0, lv: 0, exp: 0, equipCount: 0, pathOpportunity: 1 },
  };

  assert.strictEqual(paretoDominates(oppB, oppA), true, "G24-H: B (0 yellowKey) must dominate A (1 yellowKey) for same gain");
  assert.strictEqual(paretoDominates(oppA, oppB), false, "G24-H: A cannot dominate B");
  const filtered = filterParetoOpportunities([oppA, oppB]);
  assert.strictEqual(filtered.length, 1);
  assert.strictEqual(filtered[0], oppB);

  // Subcase 2: Key pickup (yellowKey 0 -> 1) with 0 stat/exp/path gains recognized as item/resource opportunity
  const simKey = {
    project: {
      floorOrder: ["F1"],
      floorsById: { F1: { floorId: "F1", width: 2, height: 2, map: [[0, 0]], changeFloor: {} } },
      mapTilesByNumber: { "0": { id: "empty", canPass: true } },
    },
    createInitialState() {
      return {
        floorId: "F1",
        hero: { loc: { x: 0, y: 0 }, hp: 100, atk: 5, def: 0, mdef: 0, lv: 1, exp: 0, money: 0, equipment: [] },
        inventory: { yellowKey: 0 },
        flags: { pickedKey: false },
        visitedFloors: { F1: true },
        floorStates: { F1: { removed: {}, replaced: {} } },
        route: [],
      };
    },
    enumeratePrimitiveActions(state) {
      if (!state.flags.pickedKey) {
        return { actions: [{ kind: "pickup", summary: "pickup:yellowKey@F1:1,0", floorId: "F1", target: { x: 1, y: 0 } }] };
      }
      return { actions: [] };
    },
    applyAction(state, action) {
      const next = JSON.parse(JSON.stringify(state));
      next.flags.pickedKey = true;
      next.inventory.yellowKey = 1;
      next.floorStates.F1.removed["1,0"] = true;
      next.route.push(action.summary);
      return next;
    },
  };

  const keyState = simKey.createInitialState();
  const intents = buildCounterfactualRepairIntents({
    simulator: simKey,
    startCandidates: [{ id: "root", state: keyState }],
    triggerFailure: { failureClass: "frontier-exhausted" },
    failedSegment: { id: "seg2" },
    candidateLimit: 8,
  });

  assert.strictEqual(intents.length, 1);
  const keyIntent = intents[0];
  assert.strictEqual(keyIntent.kind, "item/resource", "G24-H: key pickup classified as item/resource");
  assert.strictEqual(keyIntent.gain.inventoryGain.yellowKey, 1, "G24-H: inventoryGain yellowKey recognized");
  assert.deepStrictEqual(keyIntent.goal.removedTiles, [{ floorId: "F1", x: 1, y: 0 }], "G24-H: concrete removedTiles goal synthesized");

  return {
    componentWiseInventoryCostDominance: true,
    pureKeyPickupOpportunityRecognized: true,
  };
}

// G24-I: Cross-floor canonical realization with transition action policy
function gateG24I_CrossFloorCanonicalRealization() {
  function buildCrossFloorSimulator() {
    const project = {
      floorOrder: ["F1", "F2"],
      floorsById: {
        F1: { floorId: "F1", width: 2, height: 2, map: [[0, 0], [0, 0]], changeFloor: { "0,1": { floorId: "F2", x: 0, y: 0 } } },
        F2: { floorId: "F2", width: 2, height: 2, map: [[0, 0], [0, 0]], changeFloor: {} },
      },
      mapTilesByNumber: { "0": { id: "empty", canPass: true } },
      enemysById: {},
    };
    return {
      project,
      stopFloorId: "F2",
      createInitialState() {
        return {
          floorId: "F1",
          hero: { loc: { x: 0, y: 0, direction: "down" }, hp: 100, atk: 5, def: 0, mdef: 0, lv: 1, exp: 0, money: 0, equipment: [] },
          inventory: {},
          flags: { step: 0, stones: 0 },
          visitedFloors: { F1: true },
          floorStates: { F1: { removed: {}, replaced: {} }, F2: { removed: {}, replaced: {} } },
          route: [],
        };
      },
      buildReachableRegionSignature(state) {
        return { regionKey: `${state.floorId}|s=${state.flags.step}|st=${state.flags.stones}`, reachableEndpointsKey: `${state.floorId}:0,0` };
      },
      stabilizeState(state) { return JSON.parse(JSON.stringify(state)); },
      isTerminal() { return false; },
      enumeratePrimitiveActions(state) {
        const actions = [];
        if (state.floorId === "F1") {
          if (state.flags.step === 0) {
            actions.push({ kind: "conserve", summary: "conserve:stay@F1:1,0", floorId: "F1", target: { x: 1, y: 0 } });
            actions.push({ kind: "changeFloor", summary: "changeFloor:up@F1:0,1", floorId: "F1", target: { x: 0, y: 1 }, changeFloor: { floorId: "F2", x: 0, y: 0 } });
          } else if (state.flags.stones < 20) {
            actions.push({ kind: "stone", summary: `stone:${state.flags.stones}`, floorId: "F1", target: { x: 0, y: 0 } });
          }
        }
        return { actions };
      },
      applyAction(state, action) {
        const next = JSON.parse(JSON.stringify(state));
        next.flags.step += 1;
        next.hero.money = 1;
        next.route.push(action.summary);
        if (action.kind === "conserve") return next;
        if (action.kind === "stone") { next.flags.stones += 1; return next; }
        if (action.kind === "changeFloor") {
          next.floorId = "F2";
          next.hero.loc = { x: 0, y: 0, direction: "down" };
          next.visitedFloors.F2 = true;
          return next;
        }
        return null;
      },
    };
  }

  const sim = buildCrossFloorSimulator();
  const spec = {
    routeName: "g24-cross-floor",
    milestones: [
      {
        id: "seg1",
        label: "Anchor (stay on F1)",
        goal: { minHero: { money: 1 } },
        actionPolicy: { allowedFloors: ["F1"], actionKinds: ["conserve"] },
        dp: { maxExpansions: 100 },
      },
      {
        id: "seg2",
        label: "Gated on F2",
        startFrom: "seg1",
        goal: { floorId: "F2" },
        actionPolicy: { allowedFloors: ["F1", "F2"], allowChangeFloors: ["F1:0,1"], actionKinds: ["stone"] },
        dp: { maxExpansions: 100 },
      },
    ],
  };

  const res = runMilestoneGraph(sim, sim.createInitialState(), spec, {
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

  assert.strictEqual(res.found, true, "G24-I: cross-floor counterfactual must find goal");
  assert.ok(res.finalCandidate, "G24-I: finalCandidate required");
  assert.strictEqual(res.finalCandidate.state.floorId, "F2", "G24-I: final state floorId must be F2");
  assert.strictEqual(res.counterfactualRepair.triggered, true, "G24-I: CF must be triggered");
  assert.ok(res.counterfactualRepair.intentsRealized >= 1, "G24-I: cross-floor intent realized");

  return {
    crossFloorIntentRealized: true,
    finalStateFloorId: "F2",
    canonicalDpExecuted: true,
  };
}

// G24-J: Cross-origin Pareto isolation (different baseline start states cannot dominate each other)
function gateG24J_CrossOriginParetoIsolation() {
  const sim = {
    project: {
      floorOrder: ["F1"],
      floorsById: { F1: { floorId: "F1", width: 2, height: 2, map: [[0, 0]], changeFloor: {} } },
      mapTilesByNumber: { "0": { id: "empty", canPass: true } },
    },
    enumeratePrimitiveActions(state) {
      if (state.id === "candA") {
        return { actions: [{ kind: "battle", summary: "battle:A@F1:0,1", floorId: "F1", target: { x: 0, y: 1 } }] };
      }
      if (state.id === "candB") {
        return { actions: [{ kind: "battle", summary: "battle:B@F1:1,0", floorId: "F1", target: { x: 1, y: 0 } }] };
      }
      return { actions: [] };
    },
    applyAction(state, action) {
      const next = JSON.parse(JSON.stringify(state));
      if (state.id === "candA") {
        next.hero.hp -= 20;
        next.hero.atk += 2;
      } else if (state.id === "candB") {
        next.hero.hp -= 10;
        next.hero.atk += 2;
      }
      next.route.push(action.summary);
      return next;
    }
  };

  const candidateA = {
    id: "candA",
    state: {
      id: "candA",
      floorId: "F1",
      hero: { loc: { x: 0, y: 0 }, hp: 1000, atk: 5, def: 0, mdef: 0, lv: 1, exp: 0, money: 0, equipment: [] },
      inventory: {},
      visitedFloors: { F1: true },
      floorStates: { F1: { removed: {}, replaced: {} } },
      route: [],
    }
  };

  const candidateB = {
    id: "candB",
    state: {
      id: "candB",
      floorId: "F1",
      hero: { loc: { x: 0, y: 0 }, hp: 30, atk: 5, def: 0, mdef: 0, lv: 1, exp: 0, money: 0, equipment: [] },
      inventory: {},
      visitedFloors: { F1: true },
      floorStates: { F1: { removed: {}, replaced: {} } },
      route: [],
    }
  };

  const intents = buildCounterfactualRepairIntents({
    simulator: sim,
    startCandidates: [candidateA, candidateB],
    triggerFailure: { failureClass: "frontier-exhausted" },
    failedSegment: { id: "seg2" },
    candidateLimit: 8,
  });

  assert.strictEqual(intents.length, 2, "G24-J: Both A and B opportunities must survive (no cross-origin dominance)");
  const candIds = intents.map((i) => i.startCandidateId);
  assert.ok(candIds.includes("candA"), "G24-J: candidate A opportunity retained");
  assert.ok(candIds.includes("candB"), "G24-J: candidate B opportunity retained");

  return {
    crossOriginDominancePrevented: true,
    differentBaselinesPreserved: true,
  };
}

// G24-J2: Same-origin Pareto dominance still active
function gateG24J2_SameOriginDominance() {
  const sim = {
    project: {
      floorOrder: ["F1"],
      floorsById: { F1: { floorId: "F1", width: 2, height: 2, map: [[0, 0]], changeFloor: {} } },
      mapTilesByNumber: { "0": { id: "empty", canPass: true } },
    },
    enumeratePrimitiveActions() {
      return { actions: [
        { kind: "battle", summary: "battle:A1@F1:0,1", floorId: "F1", target: { x: 0, y: 1 }, cost: 20 },
        { kind: "battle", summary: "battle:A2@F1:1,0", floorId: "F1", target: { x: 1, y: 0 }, cost: 40 },
      ]};
    },
    applyAction(state, action) {
      const next = JSON.parse(JSON.stringify(state));
      next.hero.hp -= action.cost;
      next.hero.atk += 2;
      next.route.push(action.summary);
      return next;
    }
  };

  const candidateA = {
    id: "candA",
    state: {
      id: "candA",
      floorId: "F1",
      hero: { loc: { x: 0, y: 0 }, hp: 1000, atk: 5, def: 0, mdef: 0, lv: 1, exp: 0, money: 0, equipment: [] },
      inventory: {},
      visitedFloors: { F1: true },
      floorStates: { F1: { removed: {}, replaced: {} } },
      route: [],
    }
  };

  const intents = buildCounterfactualRepairIntents({
    simulator: sim,
    startCandidates: [candidateA],
    triggerFailure: { failureClass: "frontier-exhausted" },
    failedSegment: { id: "seg2" },
    candidateLimit: 8,
  });

  assert.strictEqual(intents.length, 1, "G24-J2: A1 must dominate A2 on same origin");
  assert.strictEqual(intents[0].cost.hpCost, 20, "G24-J2: surviving intent is A1 (cost 20)");

  return {
    sameOriginDominanceActive: true,
    inferiorCandidateFiltered: true,
  };
}

// G24-J3: Bounded 2D round-robin origin coverage + kind coverage
function gateG24J3_BoundedOriginCoverage() {
  const sim = {
    project: {
      floorOrder: ["F1"],
      floorsById: { F1: { floorId: "F1", width: 10, height: 10, map: [[0, 0]], changeFloor: {} } },
      mapTilesByNumber: { "0": { id: "empty", canPass: true } },
    },
    enumeratePrimitiveActions(state) {
      if (state.id === "A") {
        return { actions: [
          { kind: "battle", summary: "A1@1,0", target: { x: 1, y: 0 }, gain: { atk: 1 }, cost: 10 },
          { kind: "battle", summary: "A2@2,0", target: { x: 2, y: 0 }, gain: { def: 1 }, cost: 10 },
          { kind: "battle", summary: "A3@3,0", target: { x: 3, y: 0 }, gain: { mdef: 1 }, cost: 10 },
          { kind: "battle", summary: "A4@4,0", target: { x: 4, y: 0 }, gain: { exp: 10 }, cost: 10 },
          { kind: "battle", summary: "A5@5,0", target: { x: 5, y: 0 }, gain: { money: 10 }, cost: 10 },
        ]};
      }
      if (state.id === "B") {
        return { actions: [
          { kind: "battle", summary: "B1@1,1", target: { x: 1, y: 1 }, gain: { atk: 2 }, cost: 10 },
          { kind: "battle", summary: "B2@2,1", target: { x: 2, y: 1 }, gain: { def: 2 }, cost: 10 },
        ]};
      }
      if (state.id === "C") {
        return { actions: [
          { kind: "battle", summary: "C1@1,2", target: { x: 1, y: 2 }, gain: { atk: 3 }, cost: 10 },
          { kind: "battle", summary: "C2@2,2", target: { x: 2, y: 2 }, gain: { def: 3 }, cost: 10 },
        ]};
      }
      return { actions: [] };
    },
    applyAction(state, action) {
      const next = JSON.parse(JSON.stringify(state));
      next.hero.hp -= action.cost;
      if (action.gain.atk) next.hero.atk += action.gain.atk;
      if (action.gain.def) next.hero.def += action.gain.def;
      if (action.gain.mdef) next.hero.mdef += action.gain.mdef;
      if (action.gain.exp) next.hero.exp += action.gain.exp;
      if (action.gain.money) next.hero.money += action.gain.money;
      next.route.push(action.summary);
      return next;
    }
  };

  function makeCand(id) {
    return {
      id,
      state: {
        id, floorId: "F1",
        hero: { loc: { x: 0, y: 0 }, hp: 100, atk: 5, def: 0, mdef: 0, lv: 1, exp: 0, money: 0, equipment: [] },
        inventory: {}, visitedFloors: { F1: true }, floorStates: { F1: { removed: {}, replaced: {} } }, route: [],
      }
    };
  }

  const intents = buildCounterfactualRepairIntents({
    simulator: sim,
    startCandidates: [makeCand("A"), makeCand("B"), makeCand("C")],
    triggerFailure: { failureClass: "frontier-exhausted" },
    failedSegment: { id: "seg2" },
    candidateLimit: 3,
  });

  assert.strictEqual(intents.length, 3, "G24-J3: selected count must equal candidateLimit (3)");
  const originIds = intents.map((i) => i.startCandidateId);
  assert.ok(originIds.includes("A"), "G24-J3: origin A represented");
  assert.ok(originIds.includes("B"), "G24-J3: origin B represented");
  assert.ok(originIds.includes("C"), "G24-J3: origin C represented");

  return {
    originCoveragePreserved: true,
    candidateLimitHonored: true,
  };
}

function main() {
  const g24D = gateG24D_ParetoTradeOff();
  const g24AB = gateG24A_B_InvestmentAndDownstreamUnlock();
  const g24C = gateG24C_NormalPathPriority();
  const g24C2 = gateG24C2_NormalFirstBarrier();
  const g24C3 = gateG24C3_EmptyPlaceholderCannotTrigger();
  const g24E = gateG24E_NonStatGenericCase();
  const g24F = gateG24F_BoundednessAndNonRecursion();
  const g24G = gateG24G_CompletionAuthority();
  const g24H = gateG24H_GenericKeyResourcePareto();
  const g24I = gateG24I_CrossFloorCanonicalRealization();
  const g24J = gateG24J_CrossOriginParetoIsolation();
  const g24J2 = gateG24J2_SameOriginDominance();
  const g24J3 = gateG24J3_BoundedOriginCoverage();

  const report = {
    schema: "motapathfinder.counterfactual-repair.v1",
    contractStatus: "passed",
    gates: {
      "G24-A_B": g24AB,
      "G24-C": g24C,
      "G24-C2": g24C2,
      "G24-C3": g24C3,
      "G24-D": g24D,
      "G24-E": g24E,
      "G24-F": g24F,
      "G24-G": g24G,
      "G24-H": g24H,
      "G24-I": g24I,
      "G24-J": g24J,
      "G24-J2": g24J2,
      "G24-J3": g24J3,
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
  gateG24C2_NormalFirstBarrier,
  gateG24C3_EmptyPlaceholderCannotTrigger,
  gateG24E_NonStatGenericCase,
  gateG24F_BoundednessAndNonRecursion,
  gateG24G_CompletionAuthority,
  gateG24H_GenericKeyResourcePareto,
  gateG24I_CrossFloorCanonicalRealization,
  gateG24J_CrossOriginParetoIsolation,
  gateG24J2_SameOriginDominance,
  gateG24J3_BoundedOriginCoverage,
};
