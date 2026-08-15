"use strict";

/** TEST GRADE: integration-local */

const assert = require("node:assert");
const path = require("node:path");

const { makeBlindSimulator, readBlindGoal } = require("./lib/blind-discovery-baseline");
const { loadProject } = require("./lib/project-loader");
const { analyzeBattleViabilityBlocker } = require("./lib/strategic-battle-viability");
const { runStrategicD2Search } = require("./lib/strategic-d2-search");
const { createMt5EntryState, detachCheckpoint } = require("./qualify-blind-discovery");

const ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");
const GOAL_FILE = path.join(__dirname, "blind-goals", "onlyup-mt5-blueking.json");

function makeClassificationSimulator(options) {
  const config = options || {};
  return {
    battleResolver: {
      evaluateBattle() {
        if (config.supported === false) {
          return { supported: false, reason: config.reason || "unsupported-enemy" };
        }
        const damageInfo = config.damage == null ? {} : { damage: config.damage };
        const enemyInfo = config.enemyDef == null ? {} : { def: config.enemyDef };
        return {
          supported: true,
          damageInfo,
          enemyInfo,
          reason: config.reason || null,
        };
      },
    },
  };
}

function makeState(overrides) {
  return {
    floorId: "F",
    hero: {
      hp: 20,
      atk: 5,
      def: 0,
      mdef: 0,
      lv: 1,
      exp: 0,
      equipment: [],
      loc: { x: 0, y: 0, direction: "right" },
    },
    inventory: {},
    flags: {},
    visitedFloors: { F: true },
    ...overrides,
  };
}

function main() {
  const includeQualification1000 = process.argv.includes("--qualification-1000");
  const project = loadProject(PROJECT_ROOT);
  const initialState = detachCheckpoint(createMt5EntryState(project));
  const terminalGoal = readBlindGoal(GOAL_FILE).goal;

  // --- Synthetic classification controls --------------------------------------
  const boundary = { floorId: "F", x: 1, y: 0, enemyId: "syntheticEnemy" };
  const state = makeState();
  const attackBlocked = analyzeBattleViabilityBlocker(
    makeClassificationSimulator({ supported: true, damage: null, enemyDef: 10 }),
    state,
    boundary,
  );
  assert.strictEqual(attackBlocked.stage, "attack-blocked");
  assert.strictEqual(attackBlocked.supported, true);
  assert.strictEqual(attackBlocked.damage, null);
  assert.strictEqual(attackBlocked.attackMargin, -5);
  assert.strictEqual(attackBlocked.survivalMargin, null);

  const lethal = analyzeBattleViabilityBlocker(
    makeClassificationSimulator({ supported: true, damage: 25, enemyDef: 3 }),
    state,
    boundary,
  );
  assert.strictEqual(lethal.stage, "lethal");
  assert.strictEqual(lethal.damage, 25);
  assert.strictEqual(lethal.survivalMargin, -5);
  assert.strictEqual(lethal.attackMargin, 2);

  const viable = analyzeBattleViabilityBlocker(
    makeClassificationSimulator({ supported: true, damage: 5, enemyDef: 2 }),
    state,
    boundary,
  );
  assert.strictEqual(viable.stage, "viable");
  assert.strictEqual(viable.survivalMargin, 15);
  assert.strictEqual(viable.attackMargin, 3);

  const unsupported = analyzeBattleViabilityBlocker(
    makeClassificationSimulator({ supported: false, reason: "no-enemy" }),
    state,
    boundary,
  );
  assert.strictEqual(unsupported.stage, "unsupported");
  assert.strictEqual(unsupported.supported, false);
  assert.strictEqual(unsupported.reason, "no-enemy");

  // --- Observation-only on/off control ----------------------------------------
  const runOptions = {
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
  };
  const observed = runStrategicD2Search({
    ...runOptions,
    enableBattleViabilityAttribution: true,
  });
  const unobserved = runStrategicD2Search({
    ...runOptions,
    enableBattleViabilityAttribution: false,
  });
  const deterministicStats = [
    "expansions",
    "generated",
    "accepted",
    "exactMerged",
    "battleAccessPrerequisiteCompiled",
    "battleAccessPrerequisiteCalls",
    "battleAccessPrerequisiteSatisfied",
    "battleAccessPrerequisiteNoSatisfied",
    "battleAccessPrerequisiteExpansions",
    "battleAccessPrerequisiteStateCreated",
    "battleAccessPrerequisiteGlobalBlockerAdvanced",
    "totalSearchExpansions",
  ];
  deterministicStats.forEach((key) => {
    assert.strictEqual(observed.stats[key], unobserved.stats[key], `battle viability attribution changed stats.${key}`);
  });
  assert.strictEqual(observed.outcome.stoppedReason, unobserved.outcome.stoppedReason);
  assert.strictEqual(observed.bestTerminalBlocker.attackMargin, unobserved.bestTerminalBlocker.attackMargin);
  assert.ok(observed.stats.battleAccessPrerequisiteWitnesses.length > 0);
  observed.stats.battleAccessPrerequisiteWitnesses.forEach((witness) => {
    assert.ok(["unsupported", "attack-blocked", "lethal", "viable"].includes(witness.beforeStage));
    assert.ok(witness.battleBefore);
    assert.strictEqual(typeof witness.battleBefore.stage, "string");
  });

  let qualificationAttribution = null;
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
      enableBattleViabilityAttribution: true,
    });
    assert.strictEqual(baseline.stats.totalSearchExpansions, 1000);
    assert.strictEqual(candidate.stats.totalSearchExpansions, 1000);
    assert.strictEqual(candidate.stats.battleAccessPrerequisiteCalls, 8);
    assert.strictEqual(candidate.stats.battleAccessPrerequisiteWitnesses.length, 8);
    assert.strictEqual(candidate.stats.battleAccessPrerequisiteSatisfied, 2);
    assert.strictEqual(candidate.stats.battleAccessPrerequisiteStateCreated, 1);
    assert.strictEqual(candidate.stats.battleAccessPrerequisiteGlobalBlockerAdvanced, 0);
    assert.strictEqual(candidate.bestTerminalBlocker.attackMargin, -903);
    assert.strictEqual(candidate.stats.terminalActionGenerated, 0);
    assert.strictEqual(candidate.outcome.goalFound, false);

    const stageCounts = {};
    candidate.stats.battleAccessPrerequisiteWitnesses.forEach((witness) => {
      stageCounts[witness.beforeStage] = (stageCounts[witness.beforeStage] || 0) + 1;
      assert.ok(["unsupported", "attack-blocked", "lethal", "viable"].includes(witness.beforeStage));
      assert.ok(witness.battleBefore);
      assert.strictEqual(typeof witness.battleBefore.stage, "string");
    });

    const successful = candidate.stats.battleAccessPrerequisiteWitnesses
      .filter((witness) => witness.status === "satisfied");
    assert.strictEqual(successful.length, 2);
    successful.forEach((witness) => {
      assert.strictEqual(witness.afterStage, "viable");
      assert.ok(Array.isArray(witness.chainSummary));
      assert.ok(witness.chainSummary.length > 0);
      assert.ok(witness.resourceDelta);
      assert.ok(witness.final);
      assert.ok(witness.final.floorId);
      assert.ok(witness.battleAfter);
      assert.strictEqual(witness.battleAfter.stage, "viable");
      assert.ok(witness.structuralAfter);
      assert.strictEqual(typeof witness.structuralAfter.unavailableReason, "string");
      assert.ok(witness.structuralAfter.unavailableReason.length > 0);
    });

    qualificationAttribution = {
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
        stageCounts,
      },
    };
  }

  process.stdout.write(`${JSON.stringify({
    status: "passed",
    syntheticClassification: {
      attackBlocked,
      lethal,
      viable,
      unsupported,
    },
    noSemanticChange: {
      observedCalls: observed.stats.battleAccessPrerequisiteCalls,
      unobservedCalls: unobserved.stats.battleAccessPrerequisiteCalls,
      observedTotal: observed.stats.totalSearchExpansions,
      unobservedTotal: unobserved.stats.totalSearchExpansions,
      witnessCount: observed.stats.battleAccessPrerequisiteWitnesses.length,
    },
    qualificationAttribution,
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main };
