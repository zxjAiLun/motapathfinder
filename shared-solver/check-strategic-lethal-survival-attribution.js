"use strict";

/** TEST GRADE: integration-local */

const assert = require("node:assert");
const path = require("node:path");

const { makeBlindSimulator, readBlindGoal } = require("./lib/blind-discovery-baseline");
const { loadProject } = require("./lib/project-loader");
const { createLethalSurvivalObserver } = require("./lib/strategic-lethal-survival-observer");
const { runStrategicD2Search } = require("./lib/strategic-d2-search");
const { createMt5EntryState, detachCheckpoint } = require("./qualify-blind-discovery");

const ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");
const GOAL_FILE = path.join(__dirname, "blind-goals", "onlyup-mt5-blueking.json");

function makeSyntheticLethalSimulator() {
  const source = {
    value: 0,
    floorId: "F",
    hero: { hp: 100, atk: 10, def: 0, mdef: 0, lv: 1, exp: 0, equipment: [], loc: { x: 0, y: 0, direction: "right" } },
    inventory: {},
    flags: {},
    visitedFloors: { F: true },
  };
  const improved = {
    value: 1,
    floorId: "F",
    hero: { hp: 300, atk: 12, def: 5, mdef: 5, lv: 1, exp: 0, equipment: [], loc: { x: 1, y: 0, direction: "right" } },
    inventory: {},
    flags: {},
    visitedFloors: { F: true },
  };
  return {
    source,
    improved,
    enumeratePrimitiveActions(state) {
      if (state.value !== 0) return { actions: [] };
      return { actions: [{ kind: "event", floorId: "F", x: 1, y: 0, summary: "event:survival-improve", to: 1 }] };
    },
    applyAction(_state, action) {
      return { ...this.improved };
    },
    getActionFingerprint(action) {
      return `event|${action.summary}`;
    },
    battleResolver: {
      evaluateBattle(state, _floorId, _x, _y, enemyId) {
        if (enemyId !== "evilHero") return { supported: false, reason: "unknown-enemy" };
        const damage = state.value === 0 ? 250 : 150;
        return { supported: true, damageInfo: { damage }, enemyInfo: { def: 20 } };
      },
    },
  };
}

function main() {
  const includeQualification1000 = process.argv.includes("--qualification-1000");
  const project = loadProject(PROJECT_ROOT);
  const initialState = detachCheckpoint(createMt5EntryState(project));
  const terminalGoal = readBlindGoal(GOAL_FILE).goal;

  // --- Synthetic observer -----------------------------------------------------
  const synthetic = makeSyntheticLethalSimulator();
  const boundary = { floorId: "F", x: 1, y: 0, enemyId: "evilHero" };
  const observer = createLethalSurvivalObserver({
    simulator: synthetic,
    sourceState: synthetic.source,
    boundary,
  });
  observer.observe({
    state: synthetic.source,
    key: "source",
    chain: [],
    actions: synthetic.enumeratePrimitiveActions(synthetic.source).actions,
    expansions: 1,
  });
  observer.observe({
    state: synthetic.improved,
    key: "improved",
    chain: [{ kind: "event", summary: "event:survival-improve" }],
    actions: [],
    expansions: 2,
  });
  const syntheticReport = observer.report();
  assert.strictEqual(syntheticReport.aggregate.statesObserved, 2);
  assert.strictEqual(syntheticReport.aggregate.viableStateObserved, true);
  assert.strictEqual(syntheticReport.aggregate.survivalMarginImprovedStateCount, 1);
  assert.strictEqual(syntheticReport.aggregate.hpImprovedStateCount, 1);
  assert.strictEqual(syntheticReport.aggregate.damageReducedStateCount, 1);
  assert.ok(syntheticReport.aggregate.bestSurvivalMargin > syntheticReport.source.survivalMargin);

  let qualificationAttribution = null;
  if (includeQualification1000) {
    const runWithAttribution = (enable) => runStrategicD2Search({
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
      enableContinuationAnchorExpansionScheduling: true,
      enableLethalSurvivalAttribution: enable,
    });

    const off = runWithAttribution(false);
    const on = runWithAttribution(true);
    assert.strictEqual(off.stats.totalSearchExpansions, on.stats.totalSearchExpansions);
    assert.strictEqual(off.stats.expansions, on.stats.expansions);
    assert.strictEqual(off.stats.battleAccessPrerequisiteExpansions, on.stats.battleAccessPrerequisiteExpansions);
    assert.strictEqual(off.stats.battleAccessPrerequisiteCalls, on.stats.battleAccessPrerequisiteCalls);
    assert.strictEqual(off.stats.continuationDerivedCalls, on.stats.continuationDerivedCalls);
    assert.strictEqual(off.stats.battleStagePrerequisitesSatisfied, on.stats.battleStagePrerequisitesSatisfied);
    assert.strictEqual(off.bestTerminalBlocker.attackMargin, on.bestTerminalBlocker.attackMargin);
    assert.strictEqual(off.outcome.goalFound, on.outcome.goalFound);
    assert.strictEqual(off.outcome.stoppedReason, on.outcome.stoppedReason);

    assert.strictEqual(on.stats.battleAccessPrerequisiteCalls, 8);
    assert.strictEqual(on.stats.continuationDerivedCalls, 2);
    assert.strictEqual(on.stats.battleStagePrerequisitesSatisfied, 1);
    assert.strictEqual(on.stats.lethalSurvivalAttributions.length, 1);

    const attribution = on.stats.lethalSurvivalAttributions[0];
    assert.strictEqual(attribution.hierarchyLevel, 2);
    assert.strictEqual(attribution.boundary.enemyId, "evilHero");
    assert.strictEqual(attribution.connectorResult.status, "not-satisfied");
    assert.strictEqual(attribution.connectorResult.stoppedReason, "budget-exhausted");
    assert.strictEqual(attribution.connectorResult.expansions, 50);
    assert.strictEqual(attribution.connectorResult.generated, 96);
    assert.strictEqual(attribution.connectorResult.frontierSize, 47);
    assert.strictEqual(attribution.connectorResult.applyErrors, 0);
    assert.strictEqual(attribution.aggregate.statesObserved, 50);
    assert.strictEqual(attribution.aggregate.stageCounts.lethal, 50);
    assert.strictEqual(attribution.aggregate.viableStateObserved, false);
    assert.strictEqual(attribution.aggregate.bestSurvivalMargin, -150104);
    assert.strictEqual(attribution.aggregate.maxHP, 214597);
    assert.strictEqual(attribution.aggregate.minDamage, 168451);
    assert.strictEqual(attribution.aggregate.survivalMarginImprovedStateCount, 43);
    assert.strictEqual(attribution.aggregate.damageReducedStateCount, 26);
    assert.strictEqual(attribution.aggregate.hpImprovedStateCount, 25);
    assert.strictEqual(attribution.aggregate.maxDepthReached, 4);

    qualificationAttribution = {
      noSemanticChange: {
        offTotal: off.stats.totalSearchExpansions,
        onTotal: on.stats.totalSearchExpansions,
        offCalls: off.stats.battleAccessPrerequisiteCalls,
        onCalls: on.stats.battleAccessPrerequisiteCalls,
      },
      attribution,
      classification: "class-B-survival-progress-but-not-viable",
    };
  }

  process.stdout.write(`${JSON.stringify({
    status: "passed",
    syntheticObserver: {
      statesObserved: syntheticReport.aggregate.statesObserved,
      sourceMargin: syntheticReport.source.survivalMargin,
      bestSurvivalMargin: syntheticReport.aggregate.bestSurvivalMargin,
      improvedStateCount: syntheticReport.aggregate.survivalMarginImprovedStateCount,
      viableStateObserved: syntheticReport.aggregate.viableStateObserved,
    },
    qualificationAttribution,
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main };
