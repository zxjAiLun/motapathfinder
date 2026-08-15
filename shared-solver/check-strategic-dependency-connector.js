"use strict";

/** TEST GRADE: integration-local */

const assert = require("node:assert");
const path = require("node:path");

const { makeBlindSimulator, readBlindGoal } = require("./lib/blind-discovery-baseline");
const { loadProject } = require("./lib/project-loader");
const {
  compileTerminalDependencies,
  compileUnreachableTerminalDependencies,
  createDependencyAttemptDedupe,
  runDependencyConnector,
  selectNewDependencyAttempts,
} = require("./lib/strategic-dependency");
const { verifyConnectorChain } = require("./lib/strategic-connector");
const { createStrategicStateIndexCache } = require("./lib/strategic-transition");
const { runStrategicD2Search } = require("./lib/strategic-d2-search");
const { createMt5EntryState, detachCheckpoint } = require("./qualify-blind-discovery");

const ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");
const GOAL_FILE = path.join(__dirname, "blind-goals", "onlyup-mt5-blueking.json");

function makeGraphSimulator() {
  const edges = {
    0: [{ kind: "a", to: 1 }],
    1: [{ kind: "b", to: 2 }],
    2: [{ kind: "c", to: 3 }],
    3: [],
  };
  return {
    enumeratePrimitiveActions(state) {
      return {
        actions: (edges[state.value] || []).map((action) => ({
          ...action,
          summary: `${action.kind}:${state.value}->${action.to}`,
        })),
      };
    },
    applyAction(_state, action) {
      return { value: action.to };
    },
    getActionFingerprint(action) {
      return `${action.kind}|${action.to}`;
    },
  };
}

function makeTerminalSimulator(improves) {
  const states = {
    0: {
      value: 0,
      floorId: "F",
      hero: { hp: 20, atk: 2, def: 0, mdef: 0, lv: 1, exp: 0, equipment: [] },
      inventory: {},
      flags: {},
      visitedFloors: { F: true },
    },
    1: {
      value: 1,
      floorId: "F",
      hero: { hp: 20, atk: improves ? 12 : 2, def: 0, mdef: 0, lv: 1, exp: 0, equipment: [] },
      inventory: {},
      flags: {},
      visitedFloors: { F: true },
    },
  };
  return {
    enumeratePrimitiveActions(state) {
      if (state.value !== 0) {
        return { actions: [{ kind: "noop", summary: "noop:0->1", to: 1 }] };
      }
      return {
        actions: [{
          kind: "pickup",
          floorId: "F",
          x: 0,
          y: 0,
          itemId: "powerItem",
          target: { x: 0, y: 0, itemId: "powerItem" },
          summary: "pickup:powerItem@F:0,0",
          to: 1,
        }],
      };
    },
    applyAction(_state, action) {
      return { ...states[action.to] };
    },
    getActionFingerprint(action) {
      return `${action.kind}|${action.summary}`;
    },
    battleResolver: {
      evaluateBattle(state) {
        if (Number(state.hero.atk) < 10) {
          return { supported: true, damageInfo: null, enemyInfo: { def: 10 } };
        }
        return { supported: true, damageInfo: { damage: 5 }, enemyInfo: { def: 10 } };
      },
    },
  };
}

function makeEquipmentSimulator() {
  const source = {
    value: 0,
    floorId: "F",
    hero: { hp: 20, atk: 2, def: 0, mdef: 0, lv: 1, exp: 0, equipment: [] },
    inventory: {},
    flags: {},
    visitedFloors: { F: true },
  };
  const afterPickup = {
    value: 1,
    floorId: "F",
    hero: { hp: 20, atk: 2, def: 0, mdef: 0, lv: 1, exp: 0, equipment: [] },
    inventory: { powerSword: 1 },
    flags: {},
    visitedFloors: { F: true },
  };
  const afterEquip = {
    value: 2,
    floorId: "F",
    hero: { hp: 20, atk: 12, def: 0, mdef: 0, lv: 1, exp: 0, equipment: ["powerSword"] },
    inventory: {},
    flags: {},
    visitedFloors: { F: true },
  };
  return {
    source,
    afterPickup,
    afterEquip,
    enumeratePrimitiveActions(state) {
      if (state.value === 0) {
        return {
          actions: [{
            kind: "pickup",
            floorId: "F",
            x: 0,
            y: 0,
            itemId: "powerSwordPickup",
            target: { x: 0, y: 0, itemId: "powerSwordPickup" },
            summary: "pickup:powerSwordPickup@F:0,0",
            to: 1,
          }],
        };
      }
      if (state.value === 1) {
        return {
          actions: [{
            kind: "equip",
            equipId: "powerSword",
            equipType: 0,
            summary: "equip:powerSword",
            to: 2,
          }],
        };
      }
      return { actions: [] };
    },
    applyAction(_state, action) {
      if (action.kind === "pickup") return { ...this.afterPickup };
      if (action.kind === "equip") return { ...this.afterEquip };
      return { ...this.source };
    },
    getActionFingerprint(action) {
      return `${action.kind}|${action.equipId || action.itemId || action.summary}`;
    },
    battleResolver: {
      evaluateBattle(state) {
        if (Number(state.hero.atk) < 10) {
          return { supported: true, damageInfo: null, enemyInfo: { def: 10 } };
        }
        return { supported: true, damageInfo: { damage: 5 }, enemyInfo: { def: 10 } };
      },
    },
  };
}

function makeSyntheticProject() {
  return {
    floorsById: {
      F: { width: 3, height: 3, map: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], changeFloor: {}, afterGetItem: {}, afterBattle: {} },
    },
    mapTilesByNumber: {},
  };
}

function main() {
  const includeQualification1000 = process.argv.includes("--qualification-1000");
  const project = loadProject(PROJECT_ROOT);
  const initialState = detachCheckpoint(createMt5EntryState(project));
  const terminalGoal = readBlindGoal(GOAL_FILE).goal;
  const simulator = makeBlindSimulator(project);
  const floorIds = Array.from(new Set([
    ...Object.keys(initialState.visitedFloors || {}),
    initialState.floorId,
    terminalGoal.floorId,
  ].filter(Boolean)));
  const rootIndex = createStrategicStateIndexCache(project, simulator, { floorIds }).get(initialState);

  // --- Synthetic connector: completionPredicate is the only success condition --
  const graphSimulator = makeGraphSimulator();
  const syntheticDependency = {
    id: "synthetic-dependency",
    kind: "resource/power-opportunity-acquisition",
    capability: "combat-power",
    target: { type: "synthetic", mechanism: "graph-goal" },
    completionPredicate: (state) => state.value === 3,
  };
  const syntheticConnector = runDependencyConnector({
    simulator: graphSimulator,
    sourceState: { value: 0 },
    dependency: syntheticDependency,
    maxExpansions: 20,
    maxDepth: 5,
    keyState: (state) => String(state.value),
    copyState: (state) => ({ value: state.value }),
  });
  assert.strictEqual(syntheticConnector.status, "satisfied");
  assert.strictEqual(syntheticConnector.stoppedReason, "satisfied");
  assert.strictEqual(syntheticConnector.chain.length, 3);
  const syntheticReplay = verifyConnectorChain(graphSimulator, { value: 0 }, syntheticConnector, {
    keyState: (state) => String(state.value),
    copyState: (state) => ({ value: state.value }),
  });
  assert.strictEqual(syntheticReplay.valid, true);
  assert.strictEqual(syntheticReplay.postExactStateKey, "3");

  // --- Synthetic compiler: real enumerated pickup action + terminal blocker ---
  const syntheticProject = makeSyntheticProject();
  const positiveSynthetic = makeTerminalSimulator(true);
  const positiveGoal = { type: "bossDefeated", floorId: "F", x: 1, y: 1, enemyId: "boss" };
  const positiveCandidates = compileTerminalDependencies({
    project: syntheticProject,
    simulator: positiveSynthetic,
    state: { value: 0, floorId: "F", hero: { hp: 20, atk: 2, def: 0, mdef: 0, lv: 1, exp: 0, equipment: [] }, inventory: {}, flags: {}, visitedFloors: { F: true } },
    terminalGoal: positiveGoal,
    maxCandidates: 4,
  });
  assert.strictEqual(positiveCandidates.length, 1);
  assert.strictEqual(positiveCandidates[0].kind, "resource/power-opportunity-acquisition");
  assert.strictEqual(positiveCandidates[0].target.itemId, "powerItem");
  assert.ok(positiveCandidates[0].provenance.expectedCapabilityDelta.progressScore > 0);
  assert.strictEqual(positiveCandidates[0].provenance.knownRouteUsed, false);
  assert.strictEqual(positiveCandidates[0].provenance.authoredIdUsed, false);

  // --- Synthetic compiler: equipment-acquisition vocabulary -----------------
  const equipmentSimulator = makeEquipmentSimulator();
  const equipmentCandidates = compileTerminalDependencies({
    project: syntheticProject,
    simulator: equipmentSimulator,
    state: equipmentSimulator.source,
    terminalGoal: positiveGoal,
    maxCandidates: 4,
  });
  assert.strictEqual(equipmentCandidates.length, 1);
  assert.strictEqual(equipmentCandidates[0].kind, "equipment-acquisition");
  assert.strictEqual(equipmentCandidates[0].target.equipId, "powerSword");
  assert.strictEqual(equipmentCandidates[0].target.mechanism, "pickup-then-equip");
  assert.strictEqual(equipmentCandidates[0].target.acquisition.itemId, "powerSwordPickup");
  assert.strictEqual(equipmentCandidates[0].provenance.sourceAction.acquisition.kind, "pickup");
  assert.strictEqual(equipmentCandidates[0].provenance.sourceAction.completion.kind, "equip");
  assert.ok(equipmentCandidates[0].provenance.expectedCapabilityDelta.progressScore > 0);
  assert.strictEqual(equipmentCandidates[0].completionPredicate(equipmentSimulator.afterEquip), true);
  assert.strictEqual(equipmentCandidates[0].completionPredicate(equipmentSimulator.afterPickup), false);
  const equipmentConnector = runDependencyConnector({
    simulator: equipmentSimulator,
    sourceState: equipmentSimulator.source,
    dependency: equipmentCandidates[0],
    maxExpansions: 8,
    maxDepth: 4,
    keyState: (state) => String(state.value),
    copyState: (state) => ({ ...state, hero: { ...state.hero } }),
  });
  assert.strictEqual(equipmentConnector.status, "satisfied");
  assert.strictEqual(equipmentConnector.chain.length, 2);
  const equipmentReplay = verifyConnectorChain(
    equipmentSimulator,
    equipmentSimulator.source,
    equipmentConnector,
    {
      keyState: (state) => String(state.value),
      copyState: (state) => ({ ...state, hero: { ...state.hero } }),
    },
  );
  assert.strictEqual(equipmentReplay.valid, true);

  // --- Scheduler contract: semantic dependency id != attempt identity --------
  const schedulerDedupe = createDependencyAttemptDedupe();
  const semanticTarget = {
    id: "semantic-T",
    kind: "resource/power-opportunity-acquisition",
    capability: "combat-power",
    target: { type: "acquire-option", mechanism: "pickup", floorId: "F", x: 1, y: 1, itemId: "T" },
  };
  const farSource = { value: "far", hero: { atk: 1 }, floorId: "F" };
  const nearSource = { value: "near", hero: { atk: 1 }, floorId: "F" };
  const farAttempt = selectNewDependencyAttempts({
    candidates: [semanticTarget],
    sourceState: farSource,
    dedupe: schedulerDedupe,
    slotsLeft: 8,
  });
  assert.strictEqual(farAttempt.length, 1);
  assert.strictEqual(selectNewDependencyAttempts({
    candidates: [semanticTarget],
    sourceState: farSource,
    dedupe: schedulerDedupe,
    slotsLeft: 8,
  }).length, 0);
  const nearAttempt = selectNewDependencyAttempts({
    candidates: [semanticTarget],
    sourceState: nearSource,
    dedupe: schedulerDedupe,
    slotsLeft: 7,
  });
  assert.strictEqual(nearAttempt.length, 1);
  assert.strictEqual(selectNewDependencyAttempts({
    candidates: [semanticTarget],
    sourceState: nearSource,
    dedupe: schedulerDedupe,
    slotsLeft: 7,
  }).length, 0);

  // A pickup that does not move the terminal blocker must not become a
  // dependency, even though the action itself is legal.
  const flatSynthetic = makeTerminalSimulator(false);
  const flatCandidates = compileTerminalDependencies({
    project: syntheticProject,
    simulator: flatSynthetic,
    state: { value: 0, floorId: "F", hero: { hp: 20, atk: 2, def: 0, mdef: 0, lv: 1, exp: 0, equipment: [] }, inventory: {}, flags: {}, visitedFloors: { F: true } },
    terminalGoal: positiveGoal,
    maxCandidates: 4,
  });
  assert.strictEqual(flatCandidates.length, 0);

  // --- Real unreachable-option compiler control -------------------------------
  const unreachableCandidates = compileUnreachableTerminalDependencies({
    project,
    simulator,
    state: initialState,
    terminalGoal,
    reachablePoi: rootIndex.reachablePoi,
    optionMap: rootIndex.optionMap,
    maxCandidates: 6,
  });
  assert.ok(unreachableCandidates.length > 0);
  unreachableCandidates.forEach((candidate) => {
    assert.strictEqual(candidate.provenance.reachableAtCompileTime, false);
    assert.strictEqual(candidate.provenance.knownRouteUsed, false);
    assert.ok(candidate.provenance.expectedCapabilityDelta.progressScore > 0);
    assert.ok(["equipment-acquisition", "resource/power-opportunity-acquisition"].includes(candidate.kind));
    assert.strictEqual(typeof candidate.completionPredicate, "function");
  });

  // --- Shared total-work edge controls for dependency connector ----------------
  const runSharedBudgetCase = (options) => runStrategicD2Search({
    project,
    projectRoot: PROJECT_ROOT,
    initialState,
    terminalGoal,
    simulatorFactory: () => makeBlindSimulator(project),
    connectorMode: "dependency-derived",
    enableConnector: true,
    lazyDrainEvery: 1,
    ...options,
  });

  const zeroCap = runSharedBudgetCase({
    maxExpansions: 8,
    connectorMaxExpansions: 20,
    connectorMaxCalls: 4,
    maxTotalSearchExpansions: 0,
  });
  assert.strictEqual(zeroCap.stats.totalSearchExpansions, 0);
  assert.strictEqual(zeroCap.stats.expansions, 0);
  assert.strictEqual(zeroCap.stats.dependencyConnectorCalls, 0);
  assert.strictEqual(zeroCap.outcome.totalSearchBudgetExhausted, true);
  assert.strictEqual(zeroCap.outcome.budgetExhausted, true);
  assert.strictEqual(zeroCap.outcome.frontierExhausted, false);
  assert.strictEqual(zeroCap.outcome.searchComplete, false);
  assert.strictEqual(zeroCap.outcome.stoppedReason, "total-search-budget");

  const remainingOne = runSharedBudgetCase({
    maxExpansions: 8,
    connectorMaxExpansions: 20,
    connectorMaxCalls: 4,
    maxTotalSearchExpansions: 2,
  });
  assert.strictEqual(remainingOne.stats.totalSearchExpansions, 2);
  assert.strictEqual(remainingOne.stats.expansions, 1);
  assert.strictEqual(remainingOne.stats.dependencyConnectorCalls, 1);
  assert.strictEqual(remainingOne.stats.dependencyConnectorExpansions, 1);
  assert.strictEqual(remainingOne.outcome.totalSearchBudgetExhausted, true);
  assert.strictEqual(remainingOne.outcome.strategicBudgetExhausted, false);
  assert.strictEqual(remainingOne.outcome.budgetExhausted, true);
  assert.strictEqual(remainingOne.outcome.frontierExhausted, false);
  assert.strictEqual(remainingOne.outcome.searchComplete, false);
  assert.strictEqual(remainingOne.outcome.stoppedReason, "total-search-budget");

  const remainingZero = runSharedBudgetCase({
    maxExpansions: 8,
    connectorMaxExpansions: 20,
    connectorMaxCalls: 4,
    maxTotalSearchExpansions: 1,
  });
  assert.strictEqual(remainingZero.stats.totalSearchExpansions, 1);
  assert.strictEqual(remainingZero.stats.expansions, 1);
  assert.strictEqual(remainingZero.stats.dependencyConnectorCalls, 0);
  assert.strictEqual(remainingZero.stats.dependencyConnectorExpansions, 0);
  assert.strictEqual(remainingZero.outcome.totalSearchBudgetExhausted, true);
  assert.strictEqual(remainingZero.outcome.budgetExhausted, true);
  assert.strictEqual(remainingZero.outcome.stoppedReason, "total-search-budget");

  const remainingThree = runSharedBudgetCase({
    maxExpansions: 8,
    connectorMaxExpansions: 20,
    connectorMaxCalls: 4,
    maxTotalSearchExpansions: 4,
  });
  assert.strictEqual(remainingThree.stats.totalSearchExpansions, 4);
  assert.strictEqual(remainingThree.stats.expansions, 1);
  assert.strictEqual(remainingThree.stats.dependencyConnectorCalls, 1);
  assert.strictEqual(remainingThree.stats.dependencyConnectorExpansions, 3);
  assert.strictEqual(remainingThree.outcome.totalSearchBudgetExhausted, true);
  assert.strictEqual(remainingThree.outcome.frontierExhausted, false);
  assert.strictEqual(remainingThree.outcome.searchComplete, false);
  assert.strictEqual(remainingThree.outcome.stoppedReason, "total-search-budget");

  const sharedBudgetEdgeControls = [
    zeroCap,
    remainingOne,
    remainingZero,
    remainingThree,
  ].map((result) => ({
    totalSearchExpansions: result.stats.totalSearchExpansions,
    strategicExpansions: result.stats.expansions,
    dependencyConnectorCalls: result.stats.dependencyConnectorCalls,
    dependencyConnectorExpansions: result.stats.dependencyConnectorExpansions,
    outcome: {
      totalSearchBudgetExhausted: result.outcome.totalSearchBudgetExhausted,
      strategicBudgetExhausted: result.outcome.strategicBudgetExhausted,
      budgetExhausted: result.outcome.budgetExhausted,
      frontierExhausted: result.outcome.frontierExhausted,
      searchComplete: result.outcome.searchComplete,
      stoppedReason: result.outcome.stoppedReason,
    },
  }));

  // --- Same-total-work A/B ----------------------------------------------------
  const run = (label, options) => {
    const result = runStrategicD2Search({
      project,
      projectRoot: PROJECT_ROOT,
      initialState,
      terminalGoal,
      simulatorFactory: () => makeBlindSimulator(project),
      ...options,
    });
    return {
      label,
      totalSearchExpansions: result.stats.totalSearchExpansions,
      strategicExpansions: result.stats.expansions,
      dependencyConnectorExpansions: result.stats.dependencyConnectorExpansions,
      dependencyConnectorCalls: result.stats.dependencyConnectorCalls,
      dependencyConnectorSatisfied: result.stats.dependencyConnectorSatisfied,
      dependencyConnectorNoSatisfied: result.stats.dependencyConnectorNoSatisfied,
      terminalPrerequisiteSatisfied: result.stats.terminalPrerequisiteSatisfied,
      dependencySatisfied: result.stats.dependencySatisfied,
      dependencyStateCreated: result.stats.dependencyStateCreated,
      dependencyGlobalBlockerAdvanced: result.stats.dependencyGlobalBlockerAdvanced,
      newTerminalRelevantDependencyReached: result.stats.newTerminalRelevantDependencyReached,
      dependencyWitnesses: result.stats.dependencyWitnesses,
      bestAttackMargin: result.bestTerminalBlocker.attackMargin,
      bestStage: result.bestTerminalBlocker.stage,
      goalFound: result.outcome.goalFound,
      terminalActionGenerated: result.stats.terminalActionGenerated,
      budgetExhausted: result.outcome.budgetExhausted,
      strategicBudgetExhausted: result.outcome.strategicBudgetExhausted,
      totalSearchBudgetExhausted: result.outcome.totalSearchBudgetExhausted,
      stoppedReason: result.outcome.stoppedReason,
      wallMs: result.outcome.wallMs,
    };
  };

  const baseline = run("baseline-strategic-200", { maxExpansions: 200, enableConnector: false });
  const candidate = run("candidate-dependency-200", {
    maxExpansions: 200,
    connectorMode: "dependency-derived",
    connectorMaxExpansions: 20,
    connectorMaxCalls: 4,
    lazyDrainEvery: 8,
    maxTotalSearchExpansions: 200,
  });
  assert.strictEqual(candidate.totalSearchExpansions, baseline.totalSearchExpansions);
  assert.strictEqual(candidate.dependencyConnectorCalls, 4);
  assert.ok(candidate.bestAttackMargin >= baseline.bestAttackMargin);

  let qualification1000WorkAb = null;
  if (includeQualification1000) {
    const baseline1000 = run("baseline-strategic-1000", {
      maxExpansions: 1000,
      enableConnector: false,
      maxTotalSearchExpansions: 1000,
    });
    const candidate1000 = run("candidate-dependency-1000", {
      maxExpansions: 1000,
      connectorMode: "dependency-derived",
      connectorMaxExpansions: 50,
      connectorMaxCalls: 8,
      lazyDrainEvery: 8,
      maxTotalSearchExpansions: 1000,
    });
    assert.strictEqual(baseline1000.totalSearchExpansions, 1000);
    assert.strictEqual(candidate1000.totalSearchExpansions, 1000);
    assert.strictEqual(candidate1000.dependencyConnectorCalls, 8);
    qualification1000WorkAb = { baseline: baseline1000, candidate: candidate1000 };
  }

  process.stdout.write(`${JSON.stringify({
    status: "passed",
    syntheticConnector: {
      status: syntheticConnector.status,
      stoppedReason: syntheticConnector.stoppedReason,
      chainLength: syntheticConnector.chain.length,
      replayValid: syntheticReplay.valid,
    },
    syntheticCompiler: {
      positiveCandidates: positiveCandidates.length,
      positiveKind: positiveCandidates[0].kind,
      positiveTargetItemId: positiveCandidates[0].target.itemId,
      positiveExpectedDelta: positiveCandidates[0].provenance.expectedCapabilityDelta.progressScore,
      equipmentCandidates: equipmentCandidates.length,
      equipmentKind: equipmentCandidates[0].kind,
      equipmentMechanism: equipmentCandidates[0].target.mechanism,
      equipmentTargetEquipId: equipmentCandidates[0].target.equipId,
      equipmentChainLength: equipmentConnector.chain.length,
      equipmentConnectorStatus: equipmentConnector.status,
      equipmentReplayValid: equipmentReplay.valid,
      flatCandidates: flatCandidates.length,
    },
    schedulerContract: {
      farAttemptSelected: farAttempt.length,
      farRepeatSelected: 0,
      nearAttemptSelected: nearAttempt.length,
      nearRepeatSelected: 0,
    },
    realUnreachableCompiler: {
      candidateCount: unreachableCandidates.length,
      allMarkedUnreachable: unreachableCandidates.every((entry) =>
        entry.provenance.reachableAtCompileTime === false),
      kinds: unreachableCandidates.map((entry) => entry.kind),
    },
    sharedBudgetEdgeControls,
    sameTotalWorkAb: { baseline, candidate },
    qualification1000WorkAb,
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main };
