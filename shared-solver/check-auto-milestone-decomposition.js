"use strict";

/**
 * TEST GRADE: unit-plus-micro
 * Serialization/budget/branch/minimizer checks plus a tiny direct-goal case.
 * Not a 51533→I894 closure test.
 * See solver-manifest.json tests entry.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const {
  BudgetLedger,
  CACHE_SCHEMA,
  SegmentSearchCache,
  buildLandmarkGoal,
  inferAllowedFloors,
  isCombatStateTransition,
  isDeferredHpResourceDelta,
  isMeaningfulLandmark,
  minimizeMilestones,
  propagateFuturePresentTiles,
  refineMilestoneHpFloors,
  runMilestoneDecomposer,
  selectBranchCandidates,
  selectNextDecompositionNodes,
  selectDeferredDecompositionNodes,
  findPreMobilityPreparationId,
  selectProbeCandidates,
  shouldReplaceCheckpointState,
  shouldEscalate,
  stableStringify,
} = require("./lib/milestone-decomposer");
const { loadProject } = require("./lib/project-loader");
const {
  buildSegmentGoalPredicate,
  __testHooks: segmentDpTestHooks,
} = require("./lib/segment-dp");
const { StaticSimulator } = require("./lib/simulator");

const PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");

function makeSimulator() {
  const project = loadProject(PROJECT_ROOT);
  return new StaticSimulator(project, {
    stopFloorId: "MT11",
    battleResolver: new FunctionBackedBattleResolver(project),
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFightToLevelUp: false,
    enableResourcePocket: false,
    enableResourceCluster: false,
    enableResourceChain: false,
    searchGraphMode: "primitive",
  });
}

function checkStableSerialization() {
  assert.equal(stableStringify({ b: 2, a: { d: 4, c: 3 } }), stableStringify({ a: { c: 3, d: 4 }, b: 2 }));
  return "stable cache serialization";
}

function checkBudgetLedger() {
  const ledger = new BudgetLedger({ maxRuntimeMs: 10000, maxHeapMb: 4096, maxNodes: 1 });
  assert.equal(ledger.beginNode(), true);
  assert.equal(ledger.canContinue(), true, "current node should keep its remaining global budget");
  assert.equal(ledger.beginNode(), false);
  assert.equal(ledger.stoppedReason, "decomposition-node-limit");
  return "global node budget";
}

function checkFailureEscalation() {
  assert.equal(shouldEscalate({ diagnostics: { dp: { stoppedReason: "time-limit", frontierSize: 3, actionTrimmed: 0 } } }), true);
  assert.equal(shouldEscalate({ diagnostics: { dp: { frontierSize: 0, completeWithinActionSet: true, actionTrimmed: 0 } } }), false);
  assert.equal(shouldEscalate({ diagnostics: { dp: { frontierSize: 4, actionTrimmed: 2 } } }), false);
  return "failure-directed escalation";
}

function checkAllowedFloorInference(simulator) {
  assert.deepEqual(inferAllowedFloors(simulator.project, "MT4", "MT5"), ["MT3", "MT4", "MT5"]);
  assert.deepEqual(inferAllowedFloors(simulator.project, "MT5", "MT5"), ["MT3", "MT4", "MT5"]);
  return "portal re-entry rollback scope";
}

function checkCausalLandmarkGoal() {
  const before = {
    floorId: "MT4",
    hero: { hp: 100, atk: 10, def: 10, mdef: 0, lv: 1, exp: 0, equipment: [], loc: { x: 1, y: 1 } },
  };
  const after = {
    floorId: "MT4",
    hero: { hp: 150, atk: 20, def: 10, mdef: 5, lv: 1, exp: 0, equipment: [], loc: { x: 2, y: 1 } },
  };
  const finalGoal = { presentTiles: [{ floorId: "MT5", x: 3, y: 4 }] };
  const goal = buildLandmarkGoal(before, after, "battle:testEnemy@MT4:2,1", finalGoal);
  assert.deepEqual(goal.removedTiles, [{ floorId: "MT4", x: 2, y: 1 }]);
  assert.deepEqual(goal.minHero, { atk: 20, mdef: 5 });
  assert.deepEqual(goal.preferredPresentTiles, finalGoal.presentTiles);
  assert.equal(goal.presentTiles, undefined, "generated checkpoints must not harden final resource preferences");
  const hpResourceGoal = buildLandmarkGoal(before, {
    ...before,
    hero: { ...before.hero, hp: 60100 },
  }, "battle:healEnemy@MT4:2,1", {});
  assert.equal(hpResourceGoal.minHero.hp, 60100);
  const costlyPrep = buildLandmarkGoal(before, {
    ...after,
    hero: { ...after.hero, hp: 50, atk: 20 },
  }, "battle:prepEnemy@MT4:3,1", {});
  assert.equal(costlyPrep.minHero.hp, undefined, "stat preparation checkpoints must not freeze post-battle HP");
  assert.equal(isMeaningfulLandmark({ floorId: "MT5", minHero: { hp: 100 } }, {
    floorChanged: true,
    hp: 0,
    atk: 0,
    def: 0,
    mdef: 0,
    lv: 0,
    equipmentAdded: [],
  }), false, "a pure floor transition must remain part of a trace instead of becoming a checkpoint");
  return "minimal causal landmark";
}

function checkBundledHpResourceDetection() {
  assert.equal(isDeferredHpResourceDelta({ hp: 100000, mdef: 200, equipmentAdded: [] }), true);
  assert.equal(isDeferredHpResourceDelta({ hp: 50000, atk: 100, mdef: 1000, equipmentAdded: [] }), false);
  assert.equal(isDeferredHpResourceDelta({ hp: 500, atk: 10, equipmentAdded: [] }), false);
  assert.equal(isDeferredHpResourceDelta({ hp: -1, equipmentAdded: [] }), false);
  return "bundled HP resource detection";
}

function checkPreferredPresentIsSoft(simulator) {
  const state = simulator.createInitialState({ rank: "chaos" });
  const predicate = buildSegmentGoalPredicate(simulator.project, {
    goal: {
      floorId: state.floorId,
      preferredPresentTiles: [{ floorId: state.floorId, x: 999, y: 999 }],
    },
  }, simulator);
  assert.equal(predicate(state), true, "preferredPresentTiles must not become a hard goal predicate");
  return "soft preferred present tile";
}

function checkProtectedTileActionPolicy(simulator) {
  const state = simulator.createInitialState({ rank: "chaos" });
  const tile = { floorId: state.floorId, x: 4, y: 5 };
  const action = {
    kind: "battle",
    floorId: state.floorId,
    x: tile.x,
    y: tile.y,
    summary: `battle:testEnemy@${tile.floorId}:${tile.x},${tile.y}`,
  };
  assert.equal(segmentDpTestHooks.isAllowedAction(action, state, {
    actionPolicy: {
      allowedFloors: [state.floorId],
      protectedTiles: [tile],
    },
  }, simulator), false, "protected resources must not be consumable during the search");
  assert.equal(segmentDpTestHooks.isAllowedAction(action, state, {
    actionPolicy: { allowedFloors: [state.floorId] },
  }, simulator), true, "the same action should remain available without counterfactual protection");
  return "hard counterfactual action protection";
}

function checkBranchRoleIsolation() {
  const propagated = propagateFuturePresentTiles([
    { id: "before", goal: {}, actionPolicy: {} },
    { id: "protect", goal: { presentTiles: [{ floorId: "F1", x: 1, y: 1 }] }, actionPolicy: {} },
    { id: "after", goal: {}, actionPolicy: {} },
  ]);
  assert.equal(propagated[0].actionPolicy.protectedTiles.length, 1);
  assert.equal(propagated[1].goal.presentTiles.length, 1);
  assert.equal((propagated[2].goal.presentTiles || []).length, 0, "a consumed resource must not remain protected after its checkpoint");
  const refined = refineMilestoneHpFloors([{
    id: "generated",
    generated: true,
    generatedBy: { selectedStateHp: 123 },
    goal: { minHero: { atk: 10 } },
  }]);
  assert.equal(refined[0].goal.minHero.hp, 123);
  assert.equal(refined[0].generatedBy.validationRefinement, "hp-counterexample");
  assert.equal(shouldReplaceCheckpointState({ hero: { hp: 100, atk: 1 } }, { hero: { hp: 90, atk: 100 } }, { minHero: { atk: 100 } }), false, "checkpoint optimization must not replace a verified state with lower HP");
  assert.equal(shouldReplaceCheckpointState({ hero: { hp: 100, atk: 1 } }, { hero: { hp: 110, atk: 1 } }, { minHero: { atk: 100 } }), true);
  assert.equal(shouldReplaceCheckpointState({ hero: { hp: 1000 } }, { hero: { hp: 100 } }, {}, 1, 0), true, "preserving a deferred HP resource outranks current HP");
  assert.equal(isCombatStateTransition({ values: { hatred: 2 } }, "battle:normal@F1:1,1", { hatred: 2 }), false);
  assert.equal(isCombatStateTransition({ values: { hatred: 2 } }, "battle:special@F1:1,1", { hatred: -48 }), true);
  const baseState = { hero: { hp: 10 } };
  const candidates = [
    { signature: "early", decisionIndex: 0, downstreamScore: 1, branchScore: 1, causalScore: 1, state: baseState },
    { signature: "downstream", decisionIndex: 1, downstreamScore: 100, branchScore: 100, causalScore: 2, state: { hero: { hp: 5 } } },
    { signature: "hp", decisionIndex: 2, downstreamScore: 2, branchScore: 2, causalScore: 3, state: { hero: { hp: 50 } } },
  ];
  const selected = selectBranchCandidates(candidates, 3);
  assert.deepEqual(selected.map((entry) => entry.signature), ["downstream", "hp", "early"]);
  selected[0].state.hero.hp = 999;
  assert.equal(candidates[1].state.hero.hp, 999, "selection is a metadata view; state cloning happens at child creation");
  assert.notEqual(candidates[0].state.hero.hp, 999, "candidate states must remain isolated from each other");
  const resourceAware = selectBranchCandidates([
    { signature: "best", sourceRole: "current-frontier", branchScore: 100, causalScore: 10, consumedHpResources: 0, state: { hero: { hp: 100 } } },
    { signature: "current", sourceRole: "current-frontier", branchScore: 90, causalScore: 9, consumedHpResources: 0, state: { hero: { hp: 90 } } },
    { signature: "one-resource", sourceRole: "resource-gain", branchScore: 80, causalScore: 8, balanceRatio: 0.4, consumedHpResources: 1, state: { hero: { hp: 80 } } },
    { signature: "one-balanced-resource", sourceRole: "resource-gain", branchScore: 70, causalScore: 7, balanceRatio: 0.6, consumedHpResources: 1, state: { hero: { hp: 70 } } },
    { signature: "two-resources", sourceRole: "resource-gain", branchScore: 95, causalScore: 9, consumedHpResources: 2, state: { hero: { hp: 95 } } },
  ], 3);
  assert.deepEqual(resourceAware.map((entry) => entry.signature), ["best", "one-balanced-resource", "current"]);
  const probes = selectProbeCandidates([
    { signature: "current-a", sourceRole: "current-frontier", causalScore: 100, decisionIndex: 0, summary: "a", state: { hero: { hp: 10 } } },
    { signature: "current-b", sourceRole: "current-frontier", causalScore: 90, decisionIndex: 1, summary: "b", state: { hero: { hp: 9 } } },
    { signature: "mobility", sourceRole: "mobility", causalScore: 80, decisionIndex: 2, summary: "c", state: { hero: { hp: 8 } } },
    { signature: "survival", sourceRole: "survival", causalScore: 70, decisionIndex: 3, summary: "d", state: { hero: { hp: 7 } } },
    { signature: "high-hp", sourceRole: "archive", causalScore: 60, decisionIndex: 4, summary: "e", state: { hero: { hp: 100 } } },
    { signature: "protected", sourceRole: "counterfactual-protected", protectedResourceGain: 100000, causalScore: 1, decisionIndex: 5, summary: "f", state: { hero: { hp: 1 } } },
    { signature: "protected-combat", sourceRole: "counterfactual-protected", protectedResourceGain: 90000, causalScore: 1, decisionIndex: 6, summary: "g", state: { hero: { hp: 1, atk: 100 } } },
  ], 6);
  assert.ok(probes.some((entry) => entry.signature === "protected"), "verified counterfactual candidates need a probe role");
  assert.ok(probes.some((entry) => entry.signature === "protected-combat"), "counterfactual combat timing needs a distinct probe role");
  const protectedBranches = selectBranchCandidates([
    { signature: "ordinary", sourceRole: "current-frontier", branchScore: 100, state: { hero: { hp: 100 } } },
    { signature: "protected-balance", sourceRole: "counterfactual-protected", protectedBalanceRatio: 0.7, branchScore: 80, state: { hero: { hp: 80, atk: 10 } } },
    { signature: "protected-combat", sourceRole: "counterfactual-protected", protectedBalanceRatio: 0.6, branchScore: 70, state: { hero: { hp: 70, atk: 20 } } },
  ], 3);
  assert.deepEqual(protectedBranches.map((entry) => entry.signature), ["ordinary", "protected-balance", "protected-combat"]);
  const combatTransition = {
    signature: "hatred-transition",
    sourceRole: "archive",
    summary: "battle:testEnemy@F1:1,1",
    delta: { hatred: 1 },
    combatStateTransition: true,
    downstreamScore: 50,
    branchScore: 10,
    causalScore: 5,
    decisionIndex: 1,
    state: { hero: { hp: 50 } },
  };
  const transitionProbes = selectProbeCandidates([
    { signature: "ordinary-probe", sourceRole: "archive", summary: "battle:other@F1:2,2", delta: {}, downstreamScore: 100, branchScore: 100, causalScore: 10, decisionIndex: 0, state: { hero: { hp: 100 } } },
    combatTransition,
  ], 2);
  assert.ok(transitionProbes.some((entry) => entry.signature === "hatred-transition"), "combat-state transitions need a dedicated probe role");
  const transitionBranches = selectBranchCandidates([
    { signature: "ordinary-branch", sourceRole: "archive", summary: "battle:other@F1:2,2", delta: {}, downstreamScore: 100, branchScore: 100, causalScore: 10, decisionIndex: 0, state: { hero: { hp: 100 } } },
    combatTransition,
  ], 2);
  assert.deepEqual(transitionBranches.map((entry) => entry.signature), ["ordinary-branch", "hatred-transition"]);
  const preparationBranches = selectBranchCandidates([
    { signature: "large-direct-gain", sourceRole: "archive", summary: "battle:large@F1:1,1", delta: { atk: 100 }, preparationEfficiency: 10, downstreamScore: 100, branchScore: 100, causalScore: 100, state: { hero: { hp: 20 } } },
    { signature: "efficient-preparation", sourceRole: "archive", summary: "battle:prep@F1:2,2", delta: { atk: 50 }, preparationEfficiency: 50, downstreamScore: 90, branchScore: 90, causalScore: 50, state: { hero: { hp: 80 } } },
    { signature: "combat-transition", sourceRole: "archive", summary: "battle:transition@F1:3,3", delta: { hatred: 1 }, combatStateTransition: true, preparationEfficiency: 0, downstreamScore: 80, branchScore: 80, causalScore: 10, state: { hero: { hp: 70 } } },
  ], 3);
  assert.deepEqual(preparationBranches.map((entry) => entry.signature), ["large-direct-gain", "efficient-preparation", "combat-transition"]);
  return "branch role diversity";
}

function checkLineageBeamIsolation() {
  const makeNode = (id, lineage, role, score) => ({
    id,
    lineage,
    selectedRole: role,
    score,
    state: {
      floorId: "MT4",
      hero: {
        loc: { x: 1, y: 1, direction: "up" },
        hp: score,
        hpmax: 999,
        mana: 0,
        manamax: 0,
        atk: 10,
        def: 10,
        mdef: 0,
        money: 0,
        exp: 0,
        lv: 1,
        equipment: [],
        followers: [],
      },
      inventory: {},
      flags: {},
      visitedFloors: { MT4: true },
      floorStates: {},
    },
    milestones: [{ id: `${id}-milestone`, goal: { removedTiles: [{ floorId: "MT4", x: score, y: 1 }] } }],
  });
  const selected = selectNextDecompositionNodes([
    makeNode("a-best", "a", "best-downstream", 100),
    makeNode("a-current", "a", "current-frontier-causal", 90),
    makeNode("b-current", "b", "current-frontier-causal", 80),
    makeNode("c-current", "c", "current-frontier-causal", 70),
  ], 3);
  assert.deepEqual(new Set(selected.map((node) => node.lineage)), new Set(["a", "b", "c"]));
  assert.equal(selected.find((node) => node.lineage === "a").id, "a-best");
  const atkNode = makeNode("atk", "atk", "best-downstream", 60);
  Object.assign(atkNode, { nearTarget: true, combatRole: { atk: 100, def: 10 }, balanceScore: 60, resourceCost: 0, consumedHpResourceKeys: [] });
  const defNode = makeNode("def", "def", "best-downstream", 59);
  Object.assign(defNode, { nearTarget: true, combatRole: { atk: 10, def: 100 }, balanceScore: 59, resourceCost: 0, consumedHpResourceKeys: [] });
  const mt4Resource = makeNode("mt4-resource", "mt4", "resource-timing-diversity", 58);
  Object.assign(mt4Resource, { nearTarget: true, combatRole: { atk: 20, def: 20 }, balanceScore: 58, resourceCost: 1, consumedHpResourceKeys: ["battle:heal@MT4:1,1"] });
  const mt5Resource = makeNode("mt5-resource", "mt5", "resource-timing-diversity", 57);
  Object.assign(mt5Resource, { nearTarget: true, combatRole: { atk: 20, def: 20 }, balanceScore: 80, resourceCost: 1, consumedHpResourceKeys: ["battle:heal@MT5:1,1"] });
  const resourceSelected = selectNextDecompositionNodes([atkNode, defNode, mt4Resource, mt5Resource], 3);
  assert.deepEqual(resourceSelected.map((node) => node.id), ["atk", "def", "mt5-resource"]);
  const mobility = makeNode("mobility", "mobility", "mobility", 100);
  Object.assign(mobility, { nearTarget: true, selectedRole: "mobility", resourceCost: 0, combatRole: { atk: 100, def: 100 } });
  mobility.state.floorId = "MT5";
  mobility.state.visitedFloors = { MT4: true, MT5: true };
  const preparation = makeNode("preparation", "preparation", "best-downstream", 90);
  Object.assign(preparation, { nearTarget: false, selectedRole: "best-downstream", resourceCost: 0 });
  preparation.state.floorId = "MT4";
  preparation.state.visitedFloors = { MT4: true };
  const alternateMobility = makeNode("alternate-mobility", "alternate-mobility", "mobility", 80);
  Object.assign(alternateMobility, { nearTarget: true, selectedRole: "mobility", resourceCost: 0, combatRole: { atk: 10, def: 200 } });
  alternateMobility.state.floorId = "MT5";
  alternateMobility.state.visitedFloors = { MT4: true, MT5: true };
  const phaseSelected = selectNextDecompositionNodes([mobility, preparation, alternateMobility], 3);
  assert.equal(phaseSelected[0].id, "preparation");
  assert.equal(phaseSelected[0].beamRole, "pre-mobility-preparation");
  assert.ok(phaseSelected.some((node) => node.id === "mobility"));
  assert.equal(findPreMobilityPreparationId([
    { id: "weak-prep", selectedRole: "best-downstream", preparationEfficiency: 10, branchScore: 10, consumedHpResources: 0, state: { floorId: "MT4", visitedFloors: { MT4: true } } },
    { id: "strong-prep", selectedRole: "best-downstream", preparationEfficiency: 20, branchScore: 20, consumedHpResources: 0, state: { floorId: "MT4", visitedFloors: { MT4: true } } },
    { id: "mobility-goal", selectedRole: "mobility", preparationEfficiency: 0, consumedHpResources: 0, state: { floorId: "MT5", visitedFloors: { MT4: true, MT5: true } } },
  ]), "strong-prep");
  assert.equal(findPreMobilityPreparationId([
    { id: "selected-prep", selectedRole: "best-downstream", preparationEfficiency: 20, branchScore: 20, consumedHpResources: 0, state: { floorId: "MT4", visitedFloors: { MT4: true } } },
  ], [
    { id: "raw-mobility", sourceRole: "mobility", state: { floorId: "MT5", visitedFloors: { MT4: true, MT5: true } } },
  ]), "selected-prep");
  assert.equal(findPreMobilityPreparationId([
    { id: "target-floor-prep", selectedRole: "best-downstream", preparationEfficiency: 20, branchScore: 20, consumedHpResources: 0, state: { floorId: "MT4", visitedFloors: { MT4: true } } },
  ], [], "MT5"), "target-floor-prep");
  const highHpResource = makeNode("high-hp-resource", "high-hp", "resource-timing-diversity", 56);
  Object.assign(highHpResource, { nearTarget: true, combatRole: { atk: 20, def: 20 }, balanceScore: 50, resourceCost: 2, consumedHpResourceKeys: ["first-heal", "second-heal"] });
  Object.assign(highHpResource.state.hero, { hp: 1000, atk: 20, def: 20 });
  const lowHpBalancedResource = makeNode("low-hp-balanced-resource", "balanced", "counterfactual-balance", 55);
  Object.assign(lowHpBalancedResource, { nearTarget: true, combatRole: { atk: 30, def: 30 }, balanceScore: 100, resourceCost: 2, consumedHpResourceKeys: ["first-heal", "second-heal"] });
  Object.assign(lowHpBalancedResource.state.hero, { hp: 100, atk: 30, def: 30 });
  const preparedAtk = { ...atkNode, resourceCost: 1, consumedHpResourceKeys: ["first-heal"] };
  const preparedDef = { ...defNode, resourceCost: 1, consumedHpResourceKeys: ["first-heal"] };
  const timingSelected = selectNextDecompositionNodes([preparedAtk, preparedDef, highHpResource, lowHpBalancedResource], 3);
  assert.ok(timingSelected.some((node) => node.id === "high-hp-resource"), "large HP timing gains must survive the global beam");
  const intermediateResource = makeNode("intermediate-resource", "intermediate", "resource-timing-diversity", 60);
  Object.assign(intermediateResource, { nearTarget: true, resourceCost: 2, consumedHpResourceKeys: ["first-heal", "second-heal"], combatRole: { atk: 50, def: 50 }, balanceScore: 200 });
  Object.assign(intermediateResource.state.hero, { atk: 50, def: 50 });
  const furthestResource = makeNode("furthest-resource", "furthest", "resource-timing-diversity", 40);
  Object.assign(furthestResource, { nearTarget: true, resourceCost: 3, consumedHpResourceKeys: ["first-heal", "second-heal", "third-heal"], combatRole: { atk: 40, def: 40 }, balanceScore: 100 });
  Object.assign(furthestResource.state.hero, { atk: 40, def: 40 });
  const stagedSelected = selectNextDecompositionNodes([preparedAtk, preparedDef, intermediateResource, furthestResource], 3);
  assert.ok(stagedSelected.some((node) => node.id === "intermediate-resource"), "resource stages must advance one irreversible resource at a time");
  assert.ok(!stagedSelected.some((node) => node.id === "furthest-resource"), "the beam must not skip an unresolved resource stage");
  const sameTierHp = makeNode("same-tier-hp", "same-tier-hp", "highest-hp", 30);
  Object.assign(sameTierHp, { nearTarget: true, resourceCost: 2, consumedHpResourceKeys: ["first-heal", "second-heal"], combatRole: { atk: 20, def: 20 }, balanceScore: 20 });
  sameTierHp.state.hero.hp = 5000;
  const sameTierAtk = makeNode("same-tier-atk", "same-tier-atk", "best-downstream", 50);
  Object.assign(sameTierAtk, { nearTarget: true, resourceCost: 2, consumedHpResourceKeys: ["first-heal", "second-heal"], combatRole: { atk: 100, def: 20 }, balanceScore: 50 });
  const sameTierDef = makeNode("same-tier-def", "same-tier-def", "best-downstream", 49);
  Object.assign(sameTierDef, { nearTarget: true, resourceCost: 2, consumedHpResourceKeys: ["first-heal", "second-heal"], combatRole: { atk: 20, def: 100 }, balanceScore: 49 });
  const sameTierSelected = selectNextDecompositionNodes([sameTierAtk, sameTierDef, sameTierHp], 3);
  assert.deepEqual(sameTierSelected.map((node) => node.id), ["same-tier-atk", "same-tier-def", "same-tier-hp"]);
  const tiedAtkLowHp = makeNode("tied-atk-low-hp", "tied-low", "best-downstream", 100);
  Object.assign(tiedAtkLowHp, { nearTarget: true, resourceCost: 0, consumedHpResourceKeys: [], combatRole: { atk: 100, def: 20 } });
  tiedAtkLowHp.state.hero.hp = 10;
  const tiedAtkHighHp = makeNode("tied-atk-high-hp", "tied-high", "best-downstream", 1);
  Object.assign(tiedAtkHighHp, { nearTarget: true, resourceCost: 0, consumedHpResourceKeys: [], combatRole: { atk: 100, def: 20 } });
  tiedAtkHighHp.state.hero.hp = 100;
  assert.equal(selectNextDecompositionNodes([tiedAtkLowHp, tiedAtkHighHp], 1)[0].id, "tied-atk-high-hp");
  const counterfactualBalance = makeNode("counterfactual-balance", "cf-balance", "counterfactual-balance", 50);
  Object.assign(counterfactualBalance, { nearTarget: true, combatRole: { atk: 20, def: 30 }, resourceCost: 1, consumedHpResourceKeys: ["heal"], selectedRole: "counterfactual-balance" });
  const counterfactualCombat = makeNode("counterfactual-combat", "cf-combat", "counterfactual-combat", 49);
  Object.assign(counterfactualCombat, { nearTarget: true, combatRole: { atk: 40, def: 20 }, resourceCost: 1, consumedHpResourceKeys: ["heal"], selectedRole: "counterfactual-combat" });
  const laterResource = makeNode("later-resource", "later", "ranked", 40);
  Object.assign(laterResource, { nearTarget: true, combatRole: { atk: 30, def: 30 }, resourceCost: 2, consumedHpResourceKeys: ["heal", "later-heal"] });
  const protectedSelected = selectNextDecompositionNodes([counterfactualBalance, counterfactualCombat, laterResource], 3);
  assert.ok(protectedSelected.some((node) => node.id === "counterfactual-balance"));
  assert.ok(protectedSelected.some((node) => node.id === "counterfactual-combat"));
  const shallowConservative = makeNode("shallow-conservative", "shallow", "ranked", 1000);
  Object.assign(shallowConservative, { balanceScore: 10, resourceCost: 0 });
  const deepBalanced = makeNode("deep-balanced", "deep", "ranked", 100);
  Object.assign(deepBalanced, { balanceScore: 1000, resourceCost: 2 });
  const deferredSelected = selectDeferredDecompositionNodes([shallowConservative, deepBalanced], 1);
  assert.equal(deferredSelected[0].id, "deep-balanced");
  return "lineage beam isolation";
}

function checkPersistentCache(simulator) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "motapathfinder-decompose-cache-"));
  try {
    const cache = new SegmentSearchCache({ directory, projectSignature: "fixture-project" });
    const state = simulator.createInitialState({ rank: "chaos" });
    const segment = { id: "cache-goal", goal: { floorId: state.floorId }, actionPolicy: { allowedFloors: [state.floorId] } };
    const dp = { maxExpansions: 1, maxRuntimeMs: 1 };
    assert.equal(cache.get(state, segment, dp), null);
    cache.put(state, segment, dp, { found: true, goalSkyline: [], diagnostics: {} });
    assert.equal(cache.get(state, segment, dp).found, true);
    const differentHpState = JSON.parse(JSON.stringify(state));
    differentHpState.hero.hp += 1;
    assert.equal(cache.get(differentHpState, segment, dp), null, "cache entries must not cross HP-dependent start states");
    const file = fs.readdirSync(directory).map((name) => path.join(directory, name))[0];
    const record = JSON.parse(fs.readFileSync(file, "utf8"));
    record.schema = `${CACHE_SCHEMA}.stale`;
    fs.writeFileSync(file, JSON.stringify(record));
    assert.equal(cache.get(state, segment, dp), null);
    assert.ok(cache.stats.hits >= 1);
    assert.ok(cache.stats.invalid >= 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  return "persistent cache hit and invalidation";
}

function checkMilestoneMinimizer() {
  const milestones = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const result = minimizeMilestones(null, null, milestones, { id: "target" }, {
    validateGeneratedSpecFn: (simulator, initial, candidate) => ({
      spec: {},
      result: { found: candidate.length >= 1, failedSegment: null },
    }),
  });
  assert.equal(result.milestones.length, 1);
  assert.equal(result.attempts.length, 3);
  return "fixed-budget milestone minimizer";
}

function checkDirectGoalDoesNotSplit(simulator) {
  const state = simulator.createInitialState({ rank: "chaos" });
  const result = runMilestoneDecomposer(simulator, state, {
    id: "already-satisfied",
    label: "Already satisfied",
    goal: { floorId: state.floorId, minHero: { hp: 1 } },
    actionPolicy: { allowedFloors: [state.floorId] },
  }, {
    routeName: "auto-decompose-direct-check",
    globalRuntimeMs: 3000,
    globalMaxHeapMb: 1024,
    maxNodes: 2,
    maxDepth: 2,
    branchWidth: 2,
    cacheEnabled: false,
    minimize: false,
    tiers: {
      probe: { maxExpansions: 5, maxRuntimeMs: 500 },
      normal: { maxExpansions: 5, maxRuntimeMs: 500 },
      escalated: { maxExpansions: 5, maxRuntimeMs: 500 },
    },
  });
  assert.equal(result.found, true);
  assert.deepEqual(result.decomposition.generatedMilestonesBeforeMinimize, []);
  assert.equal(result.decomposition.strictReplay.passed, true);
  return "direct goal without decomposition";
}

function main() {
  const simulator = makeSimulator();
  const checks = [
    checkStableSerialization(),
    checkBudgetLedger(),
    checkFailureEscalation(),
    checkAllowedFloorInference(simulator),
    checkCausalLandmarkGoal(),
    checkBundledHpResourceDetection(),
    checkPreferredPresentIsSoft(simulator),
    checkProtectedTileActionPolicy(simulator),
    checkBranchRoleIsolation(),
    checkLineageBeamIsolation(),
    checkPersistentCache(simulator),
    checkMilestoneMinimizer(),
    checkDirectGoalDoesNotSplit(simulator),
  ];
  console.log(`auto milestone decomposition checks passed (${checks.length})`);
  checks.forEach((label) => console.log(`- ${label}`));
}

main();
