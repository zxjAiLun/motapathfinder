"use strict";

/** TEST GRADE: integration-local */

const assert = require("node:assert");
const path = require("node:path");

const { makeBlindSimulator, readBlindGoal } = require("./lib/blind-discovery-baseline");
const { loadProject } = require("./lib/project-loader");
const { createSurvivalEdgeObserver } = require("./lib/strategic-survival-edge-observer");
const { runStrategicD2Search } = require("./lib/strategic-d2-search");
const { createMt5EntryState, detachCheckpoint } = require("./qualify-blind-discovery");

const ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");
const GOAL_FILE = path.join(__dirname, "blind-goals", "onlyup-mt5-blueking.json");

function makeSyntheticEdgeSimulator() {
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

  // --- Synthetic edge observer ------------------------------------------------
  const synthetic = makeSyntheticEdgeSimulator();
  const boundary = { floorId: "F", x: 1, y: 0, enemyId: "evilHero" };
  const observer = createSurvivalEdgeObserver({
    simulator: synthetic,
    sourceState: synthetic.source,
    boundary,
  });
  observer.observeState({
    state: synthetic.source,
    key: "source-key",
    chain: [],
    actions: synthetic.enumeratePrimitiveActions(synthetic.source).actions,
  });
  observer.observeEdge({
    expansion: 1,
    depth: 0,
    preState: synthetic.source,
    postState: synthetic.improved,
    preExactStateKey: "source-key",
    postExactStateKey: "improved-key",
    postAlreadySeen: false,
    chainBefore: [],
    action: synthetic.enumeratePrimitiveActions(synthetic.source).actions[0],
  });
  const syntheticReport = observer.report();
  assert.strictEqual(syntheticReport.aggregate.edgesObserved, 1);
  assert.strictEqual(syntheticReport.aggregate.positiveSurvivalEdges, 1);
  assert.strictEqual(syntheticReport.aggregate.positiveByActionKind.event, 1);
  assert.strictEqual(syntheticReport.aggregate.positiveUniqueActionTargets, 1);
  assert.strictEqual(syntheticReport.aggregate.topPositiveEdges[0].deltaSurvivalMargin, 300);

  let qualificationEdge = null;
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
      enableSurvivalEdgeAttribution: enable,
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

    assert.strictEqual(on.stats.lethalSurvivalEdgeAttributions.length, 1);
    const attribution = on.stats.lethalSurvivalEdgeAttributions[0];
    assert.strictEqual(attribution.hierarchyLevel, 2);
    assert.strictEqual(attribution.boundary.enemyId, "evilHero");
    assert.strictEqual(attribution.aggregate.edgesObserved, 124);
    assert.strictEqual(attribution.aggregate.positiveSurvivalEdges, 42);
    assert.strictEqual(attribution.aggregate.neutralEdges, 82);
    assert.strictEqual(attribution.aggregate.negativeSurvivalEdges, 0);
    assert.strictEqual(attribution.aggregate.positiveByActionKind.battle, 42);
    assert.strictEqual(attribution.aggregate.positiveUniqueActionTargets, 6);

    const top = attribution.aggregate.topPositiveEdges[0];
    assert.strictEqual(top.action.summary, "battle:devilWarrior@MT5:11,11");
    assert.strictEqual(top.deltaSurvivalMargin, 279323);
    assert.strictEqual(top.deltaDamage, -379125);
    assert.strictEqual(top.resourceDelta.def, 100);

    assert.strictEqual(attribution.bestChainEdgeDecomposition.length, 4);
    const [e1, e2, e3, e4] = attribution.bestChainEdgeDecomposition;
    assert.strictEqual(e1.action.summary, "battle:skeletonKing@MT5:8,11");
    assert.strictEqual(e1.deltaSurvivalMargin, 90953);
    assert.strictEqual(e1.resourceDelta.hp, 90953);
    assert.strictEqual(e2.action.summary, "battle:devilWarrior@MT5:11,11");
    assert.strictEqual(e2.deltaSurvivalMargin, 279323);
    assert.strictEqual(e2.deltaDamage, -379125);
    assert.strictEqual(e3.action.summary, "changeFloor@MT5:6,12");
    assert.strictEqual(e3.deltaSurvivalMargin, 0);
    assert.strictEqual(e4.action.summary, "battle:skeletonKing@MT4:8,3");
    assert.strictEqual(e4.deltaSurvivalMargin, 97453);
    assert.strictEqual(e4.resourceDelta.hp, 97453);

    qualificationEdge = {
      noSemanticChange: {
        offTotal: off.stats.totalSearchExpansions,
        onTotal: on.stats.totalSearchExpansions,
        offCalls: off.stats.battleAccessPrerequisiteCalls,
        onCalls: on.stats.battleAccessPrerequisiteCalls,
      },
      aggregate: attribution.aggregate,
      bestChainEdgeDecomposition: attribution.bestChainEdgeDecomposition,
      classification: "edge-level-named-survival-opportunities-identified",
    };
  }

  process.stdout.write(`${JSON.stringify({
    status: "passed",
    syntheticEdgeObserver: {
      edgesObserved: syntheticReport.aggregate.edgesObserved,
      positiveEdges: syntheticReport.aggregate.positiveSurvivalEdges,
      positiveByKind: syntheticReport.aggregate.positiveByActionKind,
      topDeltaSurvivalMargin: syntheticReport.aggregate.topPositiveEdges[0].deltaSurvivalMargin,
    },
    qualificationEdge,
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main };
