"use strict";

/** TEST GRADE: integration-local */

const assert = require("node:assert");
const path = require("node:path");

const { makeBlindSimulator, readBlindGoal } = require("./lib/blind-discovery-baseline");
const { loadProject } = require("./lib/project-loader");
const {
  compileBattleAccessPrerequisite,
  evaluateBattleViability,
} = require("./lib/strategic-access-prerequisite");
const { verifyConnectorChain } = require("./lib/strategic-connector");
const { runDependencyConnector } = require("./lib/strategic-dependency");
const { runStrategicD2Search } = require("./lib/strategic-d2-search");
const { createMt5EntryState, detachCheckpoint } = require("./qualify-blind-discovery");

const ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");
const GOAL_FILE = path.join(__dirname, "blind-goals", "onlyup-mt5-blueking.json");

function makeSyntheticHealSimulator() {
  const source = {
    value: 0,
    floorId: "F",
    hero: { hp: 20, atk: 2, def: 0, mdef: 0, lv: 1, exp: 0, equipment: [], loc: { x: 0, y: 0, direction: "right" } },
    inventory: {},
    flags: {},
    visitedFloors: { F: true },
  };
  const healed = {
    value: 1,
    floorId: "F",
    hero: { hp: 100, atk: 2, def: 0, mdef: 0, lv: 1, exp: 0, equipment: [], loc: { x: 1, y: 0, direction: "right" } },
    inventory: {},
    flags: {},
    visitedFloors: { F: true },
  };
  return {
    source,
    healed,
    enumeratePrimitiveActions(state) {
      if (state.value !== 0) return { actions: [] };
      return {
        actions: [{
          kind: "event",
          floorId: "F",
          x: 1,
          y: 0,
          summary: "event:heal",
          to: 1,
        }],
      };
    },
    applyAction(_state, action) {
      return { ...this.healed };
    },
    getActionFingerprint(action) {
      return `event|${action.summary}`;
    },
    battleResolver: {
      evaluateBattle(state, floorId, x, y, enemyId) {
        if (!enemyId || enemyId !== "evilHero") {
          return { supported: false, reason: "unknown-enemy" };
        }
        return {
          supported: true,
          damageInfo: { damage: 30 },
          enemyInfo: { def: 0 },
        };
      },
    },
  };
}

function main() {
  const includeQualification1000 = process.argv.includes("--qualification-1000");
  const project = loadProject(PROJECT_ROOT);
  const initialState = detachCheckpoint(createMt5EntryState(project));
  const terminalGoal = readBlindGoal(GOAL_FILE).goal;

  // --- Synthetic compile + connector ------------------------------------------
  const syntheticSimulator = makeSyntheticHealSimulator();
  const boundary = { floorId: "F", x: 1, y: 0, enemyId: "evilHero" };
  const parentDependency = {
    id: "parent-T",
    kind: "resource/power-opportunity-acquisition",
    capability: "combat-power",
    target: { type: "acquire-option", mechanism: "pickup", floorId: "F", x: 2, y: 0, itemId: "T" },
  };
  const structuralAccess = {
    floorScoped: true,
    minStructuralBoundaryCrossings: 2,
    structuralMinimumPathBoundaries: [
      { kind: "enemy", tileId: "evilHero", floorId: "F", x: 1, y: 0 },
      { kind: "enemy", tileId: "secondEnemy", floorId: "F", x: 2, y: 1 },
    ],
    firstObservedUnresolvedBoundary: {
      kind: "enemy",
      tileId: "evilHero",
      floorId: "F",
      x: 1,
      y: 0,
      exactStateClassification: {
        kind: "battle-unsurvivable",
        target: boundary,
        proofStrength: "observed",
      },
    },
  };
  const prerequisite = compileBattleAccessPrerequisite({
    project: { floorsById: {} },
    simulator: syntheticSimulator,
    state: syntheticSimulator.source,
    parentDependency,
    structuralAccess,
    sourceAttemptId: "attempt-0",
    sourceExactStateFingerprint: "fp0",
  });
  assert.ok(prerequisite);
  assert.strictEqual(prerequisite.kind, "battle-access-prerequisite");
  assert.deepStrictEqual(prerequisite.boundary, boundary);
  assert.strictEqual(prerequisite.completionPredicate(syntheticSimulator.source), false);
  assert.strictEqual(prerequisite.completionPredicate(syntheticSimulator.healed), true);
  assert.strictEqual(prerequisite.parentDependency.id, "parent-T");
  assert.strictEqual(prerequisite.provenance.structuralPathEvidence.length, 2);
  assert.strictEqual(prerequisite.provenance.knownRouteUsed, false);
  assert.strictEqual(prerequisite.provenance.authoredIdUsed, false);
  // One-layer discipline: compiler only uses first boundary.
  assert.strictEqual(prerequisite.boundary.enemyId, "evilHero");
  assert.notStrictEqual(prerequisite.boundary.enemyId, "secondEnemy");

  const syntheticConnector = runDependencyConnector({
    simulator: syntheticSimulator,
    sourceState: syntheticSimulator.source,
    dependency: prerequisite,
    maxExpansions: 8,
    maxDepth: 4,
    keyState: (state) => String(state.value),
    copyState: (state) => ({ ...state, hero: { ...state.hero } }),
  });
  assert.strictEqual(syntheticConnector.status, "satisfied");
  assert.strictEqual(syntheticConnector.chain.length, 1);
  const syntheticReplay = verifyConnectorChain(
    syntheticSimulator,
    syntheticSimulator.source,
    syntheticConnector,
    {
      keyState: (state) => String(state.value),
      copyState: (state) => ({ ...state, hero: { ...state.hero } }),
    },
  );
  assert.strictEqual(syntheticReplay.valid, true);

  // --- Shared-budget edge controls -------------------------------------------
  const runSharedBudgetCase = (options) => runStrategicD2Search({
    project,
    projectRoot: PROJECT_ROOT,
    initialState,
    terminalGoal,
    simulatorFactory: () => makeBlindSimulator(project),
    connectorMode: "battle-access-prerequisite",
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
  assert.strictEqual(zeroCap.stats.battleAccessPrerequisiteCalls, 0);
  assert.strictEqual(zeroCap.outcome.totalSearchBudgetExhausted, true);
  assert.strictEqual(zeroCap.outcome.stoppedReason, "total-search-budget");

  const remainingOne = runSharedBudgetCase({
    maxExpansions: 8,
    connectorMaxExpansions: 20,
    connectorMaxCalls: 4,
    maxTotalSearchExpansions: 2,
  });
  assert.strictEqual(remainingOne.stats.totalSearchExpansions, 2);
  assert.strictEqual(remainingOne.stats.expansions, 1);
  assert.strictEqual(remainingOne.stats.battleAccessPrerequisiteCalls, 1);
  assert.strictEqual(remainingOne.stats.battleAccessPrerequisiteExpansions, 1);

  const remainingZero = runSharedBudgetCase({
    maxExpansions: 8,
    connectorMaxExpansions: 20,
    connectorMaxCalls: 4,
    maxTotalSearchExpansions: 1,
  });
  assert.strictEqual(remainingZero.stats.totalSearchExpansions, 1);
  assert.strictEqual(remainingZero.stats.battleAccessPrerequisiteCalls, 0);

  const remainingThree = runSharedBudgetCase({
    maxExpansions: 8,
    connectorMaxExpansions: 20,
    connectorMaxCalls: 4,
    maxTotalSearchExpansions: 4,
  });
  assert.strictEqual(remainingThree.stats.totalSearchExpansions, 4);
  assert.strictEqual(remainingThree.stats.expansions, 1);
  assert.strictEqual(remainingThree.stats.battleAccessPrerequisiteExpansions, 3);

  // --- Focused real control ---------------------------------------------------
  const focused = runStrategicD2Search({
    project,
    projectRoot: PROJECT_ROOT,
    initialState,
    terminalGoal,
    simulatorFactory: () => makeBlindSimulator(project),
    connectorMode: "battle-access-prerequisite",
    enableConnector: true,
    maxExpansions: 64,
    connectorMaxExpansions: 20,
    connectorMaxCalls: 4,
    lazyDrainEvery: 8,
    maxTotalSearchExpansions: 200,
  });
  assert.ok(focused.stats.battleAccessPrerequisiteCompiled > 0);
  assert.ok(focused.stats.battleAccessPrerequisiteCalls > 0);
  assert.strictEqual(focused.stats.totalSearchExpansions,
    focused.stats.expansions + focused.stats.battleAccessPrerequisiteExpansions);

  let qualificationAb = null;
  if (includeQualification1000) {
    const baseline = runStrategicD2Search({
      project,
      projectRoot: PROJECT_ROOT,
      initialState,
      terminalGoal,
      simulatorFactory: () => makeBlindSimulator(project),
      maxExpansions: 1000,
      enableConnector: false,
      maxTotalSearchExpansions: 1000,
    });
    const candidate = runStrategicD2Search({
      project,
      projectRoot: PROJECT_ROOT,
      initialState,
      terminalGoal,
      simulatorFactory: () => makeBlindSimulator(project),
      connectorMode: "battle-access-prerequisite",
      enableConnector: true,
      maxExpansions: 1000,
      connectorMaxExpansions: 50,
      connectorMaxCalls: 8,
      lazyDrainEvery: 8,
      maxTotalSearchExpansions: 1000,
    });
    assert.strictEqual(baseline.stats.totalSearchExpansions, 1000);
    assert.strictEqual(candidate.stats.totalSearchExpansions, 1000);
    assert.strictEqual(candidate.stats.battleAccessPrerequisiteCalls, 8);
    qualificationAb = {
      baseline: {
        totalSearchExpansions: baseline.stats.totalSearchExpansions,
        strategicExpansions: baseline.stats.expansions,
        bestAttackMargin: baseline.bestTerminalBlocker.attackMargin,
        terminalActionGenerated: baseline.stats.terminalActionGenerated,
      },
      candidate: {
        totalSearchExpansions: candidate.stats.totalSearchExpansions,
        strategicExpansions: candidate.stats.expansions,
        battleAccessPrerequisiteExpansions: candidate.stats.battleAccessPrerequisiteExpansions,
        compiled: candidate.stats.battleAccessPrerequisiteCompiled,
        calls: candidate.stats.battleAccessPrerequisiteCalls,
        satisfied: candidate.stats.battleAccessPrerequisiteSatisfied,
        noSatisfied: candidate.stats.battleAccessPrerequisiteNoSatisfied,
        stateCreated: candidate.stats.battleAccessPrerequisiteStateCreated,
        globalBlockerAdvanced: candidate.stats.battleAccessPrerequisiteGlobalBlockerAdvanced,
        witnesses: candidate.stats.battleAccessPrerequisiteWitnesses,
        bestAttackMargin: candidate.bestTerminalBlocker.attackMargin,
        terminalActionGenerated: candidate.stats.terminalActionGenerated,
        goalFound: candidate.outcome.goalFound,
        stoppedReason: candidate.outcome.stoppedReason,
      },
    };
  }

  process.stdout.write(`${JSON.stringify({
    status: "passed",
    syntheticCompile: {
      kind: prerequisite.kind,
      boundary: prerequisite.boundary,
      completionPredicateBefore: prerequisite.completionPredicate(syntheticSimulator.source),
      completionPredicateAfter: prerequisite.completionPredicate(syntheticSimulator.healed),
      connectorStatus: syntheticConnector.status,
      chainLength: syntheticConnector.chain.length,
      replayValid: syntheticReplay.valid,
    },
    sharedBudgetEdgeControls: {
      zeroCap: {
        total: zeroCap.stats.totalSearchExpansions,
        calls: zeroCap.stats.battleAccessPrerequisiteCalls,
      },
      remainingOne: {
        total: remainingOne.stats.totalSearchExpansions,
        strategic: remainingOne.stats.expansions,
        calls: remainingOne.stats.battleAccessPrerequisiteCalls,
        connectorExpansions: remainingOne.stats.battleAccessPrerequisiteExpansions,
      },
      remainingZero: {
        total: remainingZero.stats.totalSearchExpansions,
        calls: remainingZero.stats.battleAccessPrerequisiteCalls,
      },
      remainingThree: {
        total: remainingThree.stats.totalSearchExpansions,
        strategic: remainingThree.stats.expansions,
        connectorExpansions: remainingThree.stats.battleAccessPrerequisiteExpansions,
      },
    },
    focused: {
      totalSearchExpansions: focused.stats.totalSearchExpansions,
      strategicExpansions: focused.stats.expansions,
      compiled: focused.stats.battleAccessPrerequisiteCompiled,
      calls: focused.stats.battleAccessPrerequisiteCalls,
      satisfied: focused.stats.battleAccessPrerequisiteSatisfied,
    },
    qualificationAb,
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main };
