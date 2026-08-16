"use strict";

/** TEST GRADE: integration-local */

const assert = require("node:assert");
const path = require("node:path");

const { makeBlindSimulator, readBlindGoal } = require("./lib/blind-discovery-baseline");
const { loadProject } = require("./lib/project-loader");
const { createSurvivalEdgeObserver } = require("./lib/strategic-survival-edge-observer");
const {
  compileSurvivalOpportunityPrerequisite,
  opportunityTargetSignature,
} = require("./lib/strategic-survival-opportunity-prerequisite");
const { verifyConnectorChain } = require("./lib/strategic-connector");
const { buildStateKey } = require("./lib/state-key");
const { runStrategicD2Search } = require("./lib/strategic-d2-search");
const { createMt5EntryState, detachCheckpoint } = require("./qualify-blind-discovery");

const ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");
const GOAL_FILE = path.join(__dirname, "blind-goals", "onlyup-mt5-blueking.json");

function makeSyntheticProject() {
  return {
    floorsById: {
      F: { id: "F", width: 4, height: 2, map: [[1, 0, 0, 0], [0, 0, 0, 0]] },
    },
    mapTilesByNumber: {
      "1": { id: "skeletonKing", cls: "enemy", number: 1 },
    },
    enemysById: {
      skeletonKing: { id: "skeletonKing" },
    },
  };
}

function makeSyntheticState(floorId, x, y, removed) {
  const floorStates = {};
  floorStates[floorId] = { removed: {}, replaced: {} };
  if (removed) floorStates[floorId].removed[`${x},${y}`] = true;
  return {
    floorId,
    floorStates,
    hero: {
      hp: 100,
      def: 0,
      atk: 0,
      mdef: 0,
      lv: 1,
      exp: 0,
      loc: { x: 0, y: 0, direction: "right" },
      equipment: [],
      followers: [],
    },
    flags: {},
    visitedFloors: [floorId],
  };
}

function main() {
  const includeQualification1000 = process.argv.includes("--qualification-1000");
  const project = loadProject(PROJECT_ROOT);
  const initialState = detachCheckpoint(createMt5EntryState(project));
  const terminalGoal = readBlindGoal(GOAL_FILE).goal;

  // --- Synthetic compiler ----------------------------------------------------
  const syntheticProject = makeSyntheticProject();
  const before = makeSyntheticState("F", 0, 0, false);
  const after = makeSyntheticState("F", 0, 0, true);
  const parentDependency = { id: "P1", target: { floorId: "F", x: 0, y: 0 } };
  const witness = {
    action: {
      kind: "battle",
      summary: "battle:skeletonKing@F:0,0",
      floorId: "F",
      x: 0,
      y: 0,
      enemyId: "skeletonKing",
    },
    deltaSurvivalMargin: 10,
    deltaHP: 10,
    deltaDamage: 0,
    resourceDelta: { hp: 10, def: 0 },
    witnessChain: [{ kind: "battle", summary: "battle:skeletonKing@F:0,0", floorId: "F", x: 0, y: 0, enemyId: "skeletonKing" }],
    witnessChainSummary: ["battle:skeletonKing@F:0,0"],
  };
  const prereq = compileSurvivalOpportunityPrerequisite({
    project: syntheticProject,
    parentDependency,
    boundary: { floorId: "F", x: 0, y: 0, enemyId: "evilHero" },
    witness,
  });
  assert.ok(prereq);
  assert.strictEqual(prereq.kind, "survival-opportunity-prerequisite");
  assert.strictEqual(prereq.selectionPolicy, "first-positive-named-opportunity-by-bfs-discovery");
  assert.strictEqual(opportunityTargetSignature(prereq.target), "battle|F|0|0|skeletonKing");
  assert.strictEqual(prereq.completionPredicate(before), false);
  assert.strictEqual(prereq.completionPredicate(after), true);
  assert.ok(!prereq.id.includes("90953"));
  assert.ok(!prereq.id.includes("source"));

  // --- Synthetic depth>0 full witness-chain replay ---------------------------
  const depthProject = makeSyntheticProject();
  const depthSim = {
    project: depthProject,
    states: {
      s0: { ...makeSyntheticState("F", 0, 0, false), value: 0 },
      s1: { ...makeSyntheticState("F", 0, 0, false), value: 1 },
      s2: { ...makeSyntheticState("F", 0, 0, false), value: 2 },
      s3: { ...makeSyntheticState("F", 0, 0, true), value: 3, hero: { ...makeSyntheticState("F", 0, 0, true).hero, hp: 200 } },
    },
    enumeratePrimitiveActions(state) {
      if (state.value === 0) {
        return { actions: [{ kind: "neutral", summary: "A", floorId: "F", x: 0, y: 0, next: "s1" }] };
      }
      if (state.value === 1) {
        return { actions: [{ kind: "neutral", summary: "B", floorId: "F", x: 0, y: 0, next: "s2" }] };
      }
      if (state.value === 2) {
        return { actions: [{ kind: "battle", summary: "battle:skeletonKing@F:0,0", floorId: "F", x: 0, y: 0, enemyId: "skeletonKing", next: "s3" }] };
      }
      return { actions: [] };
    },
    applyAction(state, action) {
      const target = this.states[action.next];
      return { ...target, floorStates: JSON.parse(JSON.stringify(target.floorStates)) };
    },
    getActionFingerprint(action) {
      return `${action.kind}|${action.summary}`;
    },
    battleResolver: {
      evaluateBattle(state, _floorId, _x, _y, enemyId) {
        if (enemyId !== "evilHero") return { supported: false, reason: "unknown-enemy" };
        const removed = ((state.floorStates || {}).F || {}).removed || {};
        const damage = removed["0,0"] ? 150 : 250;
        return { supported: true, damageInfo: { damage }, enemyInfo: { def: 20 } };
      },
    },
  };
  const depthObserver = createSurvivalEdgeObserver({
    simulator: depthSim,
    sourceState: depthSim.states.s0,
    boundary: { floorId: "F", x: 0, y: 0, enemyId: "evilHero" },
  });
  const s0 = depthSim.states.s0;
  const s1 = depthSim.states.s1;
  const s2 = depthSim.states.s2;
  const s3 = depthSim.states.s3;
  const key0 = buildStateKey(s0); const key1 = buildStateKey(s1);
  const key2 = buildStateKey(s2); const key3 = buildStateKey(s3);
  const a1 = depthSim.enumeratePrimitiveActions(s0).actions[0];
  const a2 = depthSim.enumeratePrimitiveActions(s1).actions[0];
  const a3 = depthSim.enumeratePrimitiveActions(s2).actions[0];
  const e1 = { action: a1, fingerprint: "neutral|A", preExactStateKey: key0, postExactStateKey: key1 };
  const e2 = { action: a2, fingerprint: "neutral|B", preExactStateKey: key1, postExactStateKey: key2 };
  const e3 = { action: a3, fingerprint: "battle|battle:skeletonKing@F:0,0", preExactStateKey: key2, postExactStateKey: key3 };
  depthObserver.observeState({ state: s0, key: key0, chain: [], actions: [a1] });
  depthObserver.observeEdge({
    expansion: 1, depth: 0, preState: s0, postState: s1,
    preExactStateKey: key0, postExactStateKey: key1, postAlreadySeen: false,
    chainBefore: [], action: a1, witnessEdges: [e1], sourceExactStateKey: key0,
  });
  depthObserver.observeEdge({
    expansion: 2, depth: 1, preState: s1, postState: s2,
    preExactStateKey: key1, postExactStateKey: key2, postAlreadySeen: false,
    chainBefore: [a1], action: a2, witnessEdges: [e1, e2], sourceExactStateKey: key0,
  });
  depthObserver.observeEdge({
    expansion: 3, depth: 2, preState: s2, postState: s3,
    preExactStateKey: key2, postExactStateKey: key3, postAlreadySeen: false,
    chainBefore: [a1, a2], action: a3, witnessEdges: [e1, e2, e3], sourceExactStateKey: key0,
  });
  const depthWitness = depthObserver.firstPositiveOpportunityWitness();
  assert.ok(depthWitness);
  assert.strictEqual(depthWitness.discoveryDepth, 2);
  assert.strictEqual(depthWitness.witnessEdges.length, 3);
  assert.strictEqual(depthWitness.sourceExactStateKey, key0);
  assert.strictEqual(depthWitness.witnessChain.length, 3);

  const fullReplay = verifyConnectorChain(depthSim, s0, depthWitness.witnessEdges, {
    expectedPostExactStateKey: depthWitness.postExactStateKey,
  });
  assert.strictEqual(fullReplay.valid, true);
  const depthPrereq = compileSurvivalOpportunityPrerequisite({
    project: depthProject,
    parentDependency,
    boundary: { floorId: "F", x: 0, y: 0, enemyId: "evilHero" },
    witness: depthWitness,
  });
  assert.ok(depthPrereq);
  assert.strictEqual(depthPrereq.completionPredicate(fullReplay.finalState), true);

  const badSingleEdgeReplay = verifyConnectorChain(depthSim, s0, [e3], {
    expectedPostExactStateKey: key3,
  });
  assert.strictEqual(badSingleEdgeReplay.valid, false);

  let qualificationOpportunity = null;
  if (includeQualification1000) {
    const runWithFeature = (enable) => runStrategicD2Search({
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
      enableSurvivalOpportunityPrerequisite: enable,
    });

    const control = runWithFeature(false);
    const candidate = runWithFeature(true);
    assert.strictEqual(candidate.stats.totalSearchExpansions, 1000);
    assert.strictEqual(candidate.stats.battleAccessPrerequisiteCalls, 8);
    assert.strictEqual(
      candidate.stats.rootLevelCalls + candidate.stats.continuationDerivedCalls,
      8,
    );
    assert.strictEqual(candidate.stats.survivalOpportunityPrerequisitesCompiled, 2);
    assert.strictEqual(candidate.stats.survivalOpportunityPrerequisitesWitnessBacked, 2);
    assert.strictEqual(candidate.stats.survivalOpportunityPrerequisitesSatisfied, 2);
    assert.strictEqual(candidate.stats.survivalOpportunityPrerequisiteStateCreated, 0);
    assert.strictEqual(candidate.stats.survivalOpportunityWitnesses.length, 2);
    assert.strictEqual(candidate.bestTerminalBlocker.attackMargin, -903);
    assert.strictEqual(candidate.stats.terminalActionGenerated, 0);
    assert.strictEqual(candidate.outcome.goalFound, false);

    const originalLethalChild = candidate.stats.battleAccessPrerequisiteWitnesses
      .find((entry) => entry.prerequisiteId === "cb70ef61ad4b231a");
    assert.ok(originalLethalChild);
    assert.strictEqual(originalLethalChild.status, "not-satisfied");
    assert.strictEqual(originalLethalChild.stoppedReason, "budget-exhausted");

    const firstWitness = candidate.stats.survivalOpportunityWitnesses[0];
    const secondWitness = candidate.stats.survivalOpportunityWitnesses[1];
    assert.strictEqual(firstWitness.target.enemyId, "skeletonKing");
    assert.strictEqual(firstWitness.target.floorId, "MT5");
    assert.strictEqual(firstWitness.deltaSurvivalMargin, 90953);
    assert.strictEqual(firstWitness.replayValid, true);
    assert.strictEqual(firstWitness.completionAfterReplay, true);
    assert.strictEqual(firstWitness.materialized, true);
    assert.ok(firstWitness.parentContinuationId);
    assert.strictEqual(secondWitness.target.enemyId, "devilWarrior");
    assert.strictEqual(secondWitness.target.floorId, "MT5");
    assert.strictEqual(secondWitness.deltaSurvivalMargin, 279323);
    assert.strictEqual(secondWitness.replayValid, true);
    assert.strictEqual(secondWitness.completionAfterReplay, true);
    assert.strictEqual(secondWitness.materialized, true);
    assert.ok(secondWitness.parentContinuationId);

    qualificationOpportunity = {
      controlCalls: control.stats.battleAccessPrerequisiteCalls,
      candidateCalls: candidate.stats.battleAccessPrerequisiteCalls,
      candidateRootCalls: candidate.stats.rootLevelCalls,
      candidateChildCalls: candidate.stats.continuationDerivedCalls,
      survivalOpportunityPrerequisites: {
        compiled: candidate.stats.survivalOpportunityPrerequisitesCompiled,
        witnessBacked: candidate.stats.survivalOpportunityPrerequisitesWitnessBacked,
        satisfied: candidate.stats.survivalOpportunityPrerequisitesSatisfied,
        stateCreated: candidate.stats.survivalOpportunityPrerequisiteStateCreated,
      },
      witnesses: candidate.stats.survivalOpportunityWitnesses,
      classification: "witness-backed-discrete-survival-opportunity-progression",
    };
  }

  process.stdout.write(`${JSON.stringify({
    status: "passed",
    syntheticCompiler: {
      kind: prereq && prereq.kind,
      selectionPolicy: prereq && prereq.selectionPolicy,
      targetSignature: prereq && opportunityTargetSignature(prereq.target),
      beforeConsumed: prereq ? prereq.completionPredicate(before) : null,
      afterConsumed: prereq ? prereq.completionPredicate(after) : null,
    },
    qualificationOpportunity,
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main };
