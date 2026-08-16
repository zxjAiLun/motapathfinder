"use strict";

/** TEST GRADE: integration-local */

const assert = require("node:assert");
const path = require("node:path");

const { makeBlindSimulator, readBlindGoal } = require("./lib/blind-discovery-baseline");
const { loadProject } = require("./lib/project-loader");
const { compileBattleAccessPrerequisite } = require("./lib/strategic-access-prerequisite");
const { compileBattleStagePrerequisite } = require("./lib/strategic-battle-stage-prerequisite");
const { runDependencyConnector } = require("./lib/strategic-dependency");
const { verifyConnectorChain } = require("./lib/strategic-connector");
const { runStrategicD2Search } = require("./lib/strategic-d2-search");
const { createMt5EntryState, detachCheckpoint } = require("./qualify-blind-discovery");

const ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");
const GOAL_FILE = path.join(__dirname, "blind-goals", "onlyup-mt5-blueking.json");

function makeSyntheticStageSimulator(initialBattleStage) {
  const source = {
    value: 0,
    floorId: "F",
    hero: { hp: 20, atk: 5, def: 0, mdef: 0, lv: 1, exp: 0, equipment: [], loc: { x: 0, y: 0, direction: "right" } },
    inventory: {},
    flags: {},
    visitedFloors: { F: true },
  };
  const after = {
    value: 1,
    floorId: "F",
    hero: { hp: 20, atk: 30, def: 0, mdef: 0, lv: 1, exp: 0, equipment: [], loc: { x: 1, y: 0, direction: "right" } },
    inventory: {},
    flags: {},
    visitedFloors: { F: true },
  };
  return {
    source,
    after,
    enumeratePrimitiveActions(state) {
      if (state.value !== 0) return { actions: [] };
      return {
        actions: [{
          kind: "event",
          floorId: "F",
          x: 1,
          y: 0,
          summary: "event:damageable-boost",
          to: 1,
        }],
      };
    },
    applyAction(_state, action) {
      return { ...this.after };
    },
    getActionFingerprint(action) {
      return `event|${action.summary}`;
    },
    battleResolver: {
      evaluateBattle(state, _floorId, _x, _y, enemyId) {
        if (enemyId !== "evilHero") return { supported: false, reason: "unknown-enemy" };
        const sourceStage = initialBattleStage === "attack-blocked" ? "attack-blocked" : "lethal";
        const stage = state.value === 0 ? sourceStage : "lethal";
        if (stage === "attack-blocked") {
          return { supported: true, damageInfo: {}, enemyInfo: { def: 10 } };
        }
        return { supported: true, damageInfo: { damage: 30 }, enemyInfo: { def: 10 } };
      },
    },
  };
}

function main() {
  const includeQualification1000 = process.argv.includes("--qualification-1000");
  const project = loadProject(PROJECT_ROOT);
  const initialState = detachCheckpoint(createMt5EntryState(project));
  const terminalGoal = readBlindGoal(GOAL_FILE).goal;

  // --- Synthetic compile ------------------------------------------------------
  const attackBlockedSimulator = makeSyntheticStageSimulator("attack-blocked");
  const boundary = { floorId: "F", x: 1, y: 0, enemyId: "evilHero" };
  const parentDependency = {
    id: "parent-T",
    kind: "resource/power-opportunity-acquisition",
    capability: "combat-power",
    target: { type: "acquire-option", mechanism: "pickup", floorId: "F", x: 2, y: 0, itemId: "T" },
  };
  const structuralAccess = {
    floorScoped: true,
    minStructuralBoundaryCrossings: 1,
    structuralMinimumPathBoundaries: [
      { kind: "enemy", tileId: "evilHero", floorId: "F", x: 1, y: 0 },
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
  const stagePrerequisite = compileBattleStagePrerequisite({
    project: { floorsById: {} },
    simulator: attackBlockedSimulator,
    state: attackBlockedSimulator.source,
    parentDependency,
    structuralAccess,
    sourceAttemptId: "continuation-1",
    sourceExactStateFingerprint: "fp-source",
    stageGoal: "damageable",
  });
  const genericPrerequisite = compileBattleAccessPrerequisite({
    project: { floorsById: {} },
    simulator: attackBlockedSimulator,
    state: attackBlockedSimulator.source,
    parentDependency,
    structuralAccess,
  });
  assert.ok(stagePrerequisite);
  assert.ok(genericPrerequisite);
  assert.strictEqual(stagePrerequisite.kind, "battle-stage-prerequisite");
  assert.strictEqual(stagePrerequisite.stageGoal, "damageable");
  assert.strictEqual(stagePrerequisite.boundary.enemyId, "evilHero");
  assert.strictEqual(stagePrerequisite.parentDependency.id, "parent-T");
  assert.notStrictEqual(stagePrerequisite.id, genericPrerequisite.id);
  assert.strictEqual(stagePrerequisite.completionPredicate(attackBlockedSimulator.source), false);
  assert.strictEqual(stagePrerequisite.completionPredicate(attackBlockedSimulator.after), true);

  const stageConnector = runDependencyConnector({
    simulator: attackBlockedSimulator,
    sourceState: attackBlockedSimulator.source,
    dependency: stagePrerequisite,
    maxExpansions: 8,
    maxDepth: 4,
    keyState: (state) => String(state.value),
    copyState: (state) => ({ ...state, hero: { ...state.hero } }),
  });
  assert.strictEqual(stageConnector.status, "satisfied");
  assert.strictEqual(stageConnector.chain.length, 1);
  const stageReplay = verifyConnectorChain(
    attackBlockedSimulator,
    attackBlockedSimulator.source,
    stageConnector,
    {
      keyState: (state) => String(state.value),
      copyState: (state) => ({ ...state, hero: { ...state.hero } }),
    },
  );
  assert.strictEqual(stageReplay.valid, true);

  // Lethal is out of scope for 5.19f first version.
  const lethalSimulator = makeSyntheticStageSimulator("lethal");
  assert.strictEqual(compileBattleStagePrerequisite({
    project: { floorsById: {} },
    simulator: lethalSimulator,
    state: lethalSimulator.source,
    parentDependency,
    structuralAccess,
  }), null);

  let qualificationStage = null;
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
    const run5_19e = runStrategicD2Search({
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
      enableParentDependencyContinuation: true,
      enableHierarchicalCallAllocation: true,
      enableBattleStagePrerequisiteDecomposition: false,
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
      enableParentDependencyContinuation: true,
      enableHierarchicalCallAllocation: true,
      enableBattleStagePrerequisiteDecomposition: true,
    });

    assert.strictEqual(baseline.stats.totalSearchExpansions, 1000);
    assert.strictEqual(run5_19e.stats.totalSearchExpansions, 1000);
    assert.strictEqual(candidate.stats.totalSearchExpansions, 1000);
    assert.strictEqual(run5_19e.stats.battleAccessPrerequisiteCalls, 8);
    assert.strictEqual(candidate.stats.battleAccessPrerequisiteCalls, 6);
    assert.strictEqual(candidate.stats.rootLevelCalls, 5);
    assert.strictEqual(candidate.stats.continuationDerivedCalls, 1);
    assert.strictEqual(candidate.stats.battleStagePrerequisitesCompiled, 1);
    assert.strictEqual(candidate.stats.battleStagePrerequisitesScheduled, 1);
    assert.strictEqual(candidate.stats.battleStagePrerequisitesExecuted, 1);
    assert.strictEqual(candidate.stats.battleStagePrerequisitesSatisfied, 1);
    assert.strictEqual(candidate.bestTerminalBlocker.attackMargin, -903);
    assert.strictEqual(candidate.stats.terminalActionGenerated, 0);
    assert.strictEqual(candidate.outcome.goalFound, false);

    const controlChild = run5_19e.stats.battleAccessPrerequisiteWitnesses
      .find((witness) => witness.hierarchyLevel === 1);
    assert.ok(controlChild);
    assert.strictEqual(controlChild.prerequisiteId, "cb70ef61ad4b231a");

    const stageChild = candidate.stats.battleAccessPrerequisiteWitnesses
      .find((witness) => witness.hierarchyLevel === 1);
    assert.ok(stageChild);
    assert.strictEqual(stageChild.prerequisiteKind, "battle-stage-prerequisite");
    assert.strictEqual(stageChild.stageGoal, "damageable");
    assert.strictEqual(stageChild.boundary.floorId, "MT5");
    assert.strictEqual(stageChild.boundary.x, 2);
    assert.strictEqual(stageChild.boundary.y, 8);
    assert.strictEqual(stageChild.boundary.enemyId, "evilHero");
    assert.strictEqual(stageChild.beforeStage, "attack-blocked");
    assert.strictEqual(stageChild.status, "satisfied");
    assert.strictEqual(stageChild.afterStage, "lethal");
    assert.strictEqual(stageChild.battleBefore.attackMargin, -273);
    assert.strictEqual(stageChild.battleBefore.damage, null);
    assert.ok(stageChild.battleAfter.attackMargin > stageChild.battleBefore.attackMargin);
    assert.ok(stageChild.battleAfter.damage != null);
    assert.ok(Array.isArray(stageChild.chainSummary));
    assert.ok(stageChild.chainSummary.length > 0);
    assert.ok(stageChild.resourceDelta);
    assert.ok(stageChild.parentDependencyContinuationId);

    qualificationStage = {
      baseline: {
        totalSearchExpansions: baseline.stats.totalSearchExpansions,
        strategicExpansions: baseline.stats.expansions,
        bestAttackMargin: baseline.bestTerminalBlocker.attackMargin,
        terminalActionGenerated: baseline.stats.terminalActionGenerated,
      },
      control5_19e: {
        totalSearchExpansions: run5_19e.stats.totalSearchExpansions,
        strategicExpansions: run5_19e.stats.expansions,
        battleAccessPrerequisiteExpansions: run5_19e.stats.battleAccessPrerequisiteExpansions,
        calls: run5_19e.stats.battleAccessPrerequisiteCalls,
        child: controlChild,
        bestAttackMargin: run5_19e.bestTerminalBlocker.attackMargin,
      },
      candidate5_19f: {
        totalSearchExpansions: candidate.stats.totalSearchExpansions,
        strategicExpansions: candidate.stats.expansions,
        battleAccessPrerequisiteExpansions: candidate.stats.battleAccessPrerequisiteExpansions,
        calls: candidate.stats.battleAccessPrerequisiteCalls,
        rootLevelCalls: candidate.stats.rootLevelCalls,
        continuationDerivedCalls: candidate.stats.continuationDerivedCalls,
        stagePrerequisitesCompiled: candidate.stats.battleStagePrerequisitesCompiled,
        stagePrerequisitesScheduled: candidate.stats.battleStagePrerequisitesScheduled,
        stagePrerequisitesExecuted: candidate.stats.battleStagePrerequisitesExecuted,
        stagePrerequisitesSatisfied: candidate.stats.battleStagePrerequisitesSatisfied,
        stageChild,
        bestAttackMargin: candidate.bestTerminalBlocker.attackMargin,
        terminalActionGenerated: candidate.stats.terminalActionGenerated,
        goalFound: candidate.outcome.goalFound,
        stoppedReason: candidate.outcome.stoppedReason,
      },
    };
  }

  process.stdout.write(`${JSON.stringify({
    status: "passed",
    syntheticStageCompile: {
      kind: stagePrerequisite.kind,
      stageGoal: stagePrerequisite.stageGoal,
      genericId: genericPrerequisite.id,
      stageId: stagePrerequisite.id,
      distinctIdentity: stagePrerequisite.id !== genericPrerequisite.id,
      beforeDamageable: stagePrerequisite.completionPredicate(attackBlockedSimulator.source),
      afterDamageable: stagePrerequisite.completionPredicate(attackBlockedSimulator.after),
      connectorStatus: stageConnector.status,
      chainLength: stageConnector.chain.length,
      replayValid: stageReplay.valid,
      lethalCompileReturnsNull: true,
    },
    qualificationStage,
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main };
