"use strict";

/** TEST GRADE: integration-local */

const assert = require("node:assert");
const path = require("node:path");

const { makeBlindSimulator, readBlindGoal } = require("./lib/blind-discovery-baseline");
const { loadProject } = require("./lib/project-loader");
const { createSurvivalEdgeObserver } = require("./lib/strategic-survival-edge-observer");
const {
  attributeResidualPaidWitnessGraph,
  firstPrefixCompatibleReplayValidResidual,
} = require("./lib/strategic-survival-residual-attribution");
const { buildStateKey } = require("./lib/state-key");
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

function makeResidualReplaySimulator() {
  function state(value) {
    return {
      floorId: "F",
      floorStates: { F: { removed: {}, replaced: {} } },
      hero: {
        hp: 100 + value,
        atk: 10,
        def: 0,
        mdef: 0,
        lv: 1,
        exp: value,
        loc: { x: value, y: 0, direction: "right" },
        equipment: [],
        followers: [],
      },
      flags: { residualValue: value },
      inventory: {},
      visitedFloors: ["F"],
    };
  }
  const states = [0, 1, 2, 3, 4, 5].map(state);
  const transitions = new Map();
  function action(kind, summary, from, to, enemyId) {
    return { kind, summary, floorId: "F", x: to, y: 0, from, to, enemyId: enemyId || null };
  }
  transitions.set(0, [
    action("battle", "battle:O2@F:0,0", 0, 1, "O2"),
    action("event", "event:branch-to-O4", 0, 3),
    action("event", "event:reroot-to-O3", 0, 1),
  ]);
  transitions.set(1, [
    action("battle", "battle:O3@F:1,0", 1, 2, "O3"),
    action("battle", "battle:O4-prefix@F:1,0", 1, 2, "O4-prefix"),
    action("battle", "battle:broken@F:1,0", 1, 5, "broken"),
  ]);
  transitions.set(3, [action("battle", "battle:O4@F:3,0", 3, 4, "O4")]);
  transitions.set(2, []);
  transitions.set(4, []);
  transitions.set(5, []);
  return {
    states,
    enumeratePrimitiveActions(current) {
      return { actions: transitions.get(current.flags.residualValue) || [] };
    },
    applyAction(_current, nextAction) {
      const next = states[nextAction.to];
      return {
        ...next,
        hero: { ...next.hero, loc: { ...next.hero.loc } },
        flags: { ...next.flags },
        floorStates: { F: { removed: {}, replaced: {} } },
      };
    },
    getActionFingerprint(nextAction) {
      return `${nextAction.kind}|${nextAction.summary}`;
    },
  };
}

function makeObservedEdge(simulator, action, from, to, witnessEdges, ordinal, delta) {
  const keys = simulator.states.map(buildStateKey);
  return {
    discoveryOrdinal: ordinal,
    expansion: ordinal,
    depth: witnessEdges.length - 1,
    preExactStateKey: keys[from],
    postExactStateKey: keys[to],
    sourceExactStateKey: keys[0],
    witnessEdges,
    action,
    actionTargetSignature: `${action.kind}|${action.summary}`,
    deltaSurvivalMargin: delta,
  };
}

function makeRawEdge(simulator, action, from, to) {
  const keys = simulator.states.map(buildStateKey);
  return {
    action,
    fingerprint: simulator.getActionFingerprint(action),
    preExactStateKey: keys[from],
    postExactStateKey: keys[to],
  };
}

function runResidualSyntheticContracts() {
  const simulator = makeResidualReplaySimulator();
  const rawO2 = makeRawEdge(simulator, simulator.enumeratePrimitiveActions(simulator.states[0]).actions[0], 0, 1);
  const rawBranch = makeRawEdge(simulator, simulator.enumeratePrimitiveActions(simulator.states[0]).actions[1], 0, 3);
  const rawReroot = makeRawEdge(simulator, simulator.enumeratePrimitiveActions(simulator.states[0]).actions[2], 0, 1);
  const rawO3 = makeRawEdge(simulator, simulator.enumeratePrimitiveActions(simulator.states[1]).actions[0], 1, 2);
  const rawO4Prefix = makeRawEdge(simulator, simulator.enumeratePrimitiveActions(simulator.states[1]).actions[1], 1, 2);
  const rawBroken = makeRawEdge(simulator, simulator.enumeratePrimitiveActions(simulator.states[1]).actions[2], 1, 5);
  const rawBrokenRecorded = { ...rawBroken, postExactStateKey: "broken-post-key" };
  const rawO4 = makeRawEdge(simulator, simulator.enumeratePrimitiveActions(simulator.states[3]).actions[0], 3, 4);
  const selectedWitness = {
    discoveryOrdinal: 1,
    postExactStateKey: rawO2.postExactStateKey,
    witnessEdges: [rawO2],
  };

  const prefixCandidate = makeObservedEdge(
    simulator,
    rawO3.action,
    1,
    2,
    [rawO2, rawO3],
    2,
    1,
  );
  const highMarginPrefixCandidate = makeObservedEdge(
    simulator,
    rawO4Prefix.action,
    1,
    2,
    [rawO2, rawO4Prefix],
    3,
    1000,
  );
  const branchCandidate = makeObservedEdge(
    simulator,
    rawO4.action,
    3,
    4,
    [rawBranch, rawO4],
    4,
    20,
  );
  const rerootCandidate = makeObservedEdge(
    simulator,
    rawO3.action,
    1,
    2,
    [rawReroot, rawO3],
    5,
    30,
  );
  const brokenCandidate = makeObservedEdge(
    simulator,
    rawBrokenRecorded.action,
    1,
    5,
    [rawO2, rawBrokenRecorded],
    6,
    40,
  );
  brokenCandidate.postExactStateKey = rawBrokenRecorded.postExactStateKey;

  const r1 = attributeResidualPaidWitnessGraph({
    simulator,
    selectedWitness,
    selectedPostState: simulator.states[1],
    snapshot: {
      edges: [
        makeObservedEdge(simulator, rawO2.action, 0, 1, [rawO2], 1, 10),
        prefixCandidate,
        highMarginPrefixCandidate,
      ],
      edgesObserved: 3,
      maxEdges: 10,
      captureComplete: true,
    },
  });
  assert.strictEqual(r1.classification, "R1");
  assert.deepStrictEqual(
    r1.candidates.map((candidate) => candidate.candidateDiscoveryOrdinal),
    [2, 3],
  );
  assert.strictEqual(r1.candidates[0].compatibilityKind, "prefix-compatible");
  assert.strictEqual(r1.candidates[0].suffixReplayValid, true);
  assert.strictEqual(r1.candidates[1].suffixReplayValid, true);
  const selectedResidual = firstPrefixCompatibleReplayValidResidual({
    simulator,
    selectedWitness,
    selectedPostState: simulator.states[1],
    snapshot: {
      edges: [
        makeObservedEdge(simulator, rawO2.action, 0, 1, [rawO2], 1, 10),
        prefixCandidate,
        highMarginPrefixCandidate,
      ],
      edgesObserved: 3,
      maxEdges: 10,
      captureComplete: true,
    },
  });
  assert.ok(selectedResidual);
  assert.strictEqual(selectedResidual.edge.action.enemyId, "O3");
  assert.strictEqual(selectedResidual.discoveryOrdinal, 2);
  assert.strictEqual(selectedResidual.suffix.length, 1);
  assert.strictEqual(selectedResidual.replay.valid, true);

  const reroot = attributeResidualPaidWitnessGraph({
    simulator,
    selectedWitness,
    selectedPostState: simulator.states[1],
    snapshot: {
      edges: [makeObservedEdge(simulator, rawO2.action, 0, 1, [rawO2], 1, 10), rerootCandidate],
      edgesObserved: 2,
      maxEdges: 10,
      captureComplete: true,
    },
  });
  assert.strictEqual(reroot.classification, "R1");
  assert.strictEqual(reroot.candidates[0].compatibilityKind, "exact-state-reroot-compatible");
  assert.strictEqual(reroot.candidates[0].suffixReplayValid, true);
  assert.strictEqual(firstPrefixCompatibleReplayValidResidual({
    simulator,
    selectedWitness,
    selectedPostState: simulator.states[1],
    snapshot: {
      edges: [makeObservedEdge(simulator, rawO2.action, 0, 1, [rawO2], 1, 10), rerootCandidate],
      edgesObserved: 2,
      maxEdges: 10,
      captureComplete: true,
    },
  }), null);

  const r2 = attributeResidualPaidWitnessGraph({
    simulator,
    selectedWitness,
    selectedPostState: simulator.states[1],
    snapshot: {
      edges: [makeObservedEdge(simulator, rawO2.action, 0, 1, [rawO2], 1, 10), branchCandidate],
      edgesObserved: 2,
      maxEdges: 10,
      captureComplete: true,
    },
  });
  assert.strictEqual(r2.classification, "R2");
  assert.strictEqual(r2.candidates[0].replayFailureReason, "branch-incompatible");
  assert.strictEqual(firstPrefixCompatibleReplayValidResidual({
    simulator,
    selectedWitness,
    selectedPostState: simulator.states[1],
    snapshot: {
      edges: [makeObservedEdge(simulator, rawO2.action, 0, 1, [rawO2], 1, 10), branchCandidate],
      edgesObserved: 2,
      maxEdges: 10,
      captureComplete: true,
    },
  }), null);

  const r3 = attributeResidualPaidWitnessGraph({
    simulator,
    selectedWitness,
    selectedPostState: simulator.states[1],
    snapshot: {
      edges: [makeObservedEdge(simulator, rawO2.action, 0, 1, [rawO2], 1, 10), brokenCandidate],
      edgesObserved: 2,
      maxEdges: 10,
      captureComplete: true,
    },
  });
  assert.strictEqual(r3.classification, "R3");
  assert.strictEqual(r3.candidates[0].compatibilityKind, "prefix-compatible");
  assert.strictEqual(r3.candidates[0].suffixReplayValid, false);

  const r4 = attributeResidualPaidWitnessGraph({
    simulator,
    selectedWitness,
    selectedPostState: simulator.states[1],
    snapshot: {
      edges: [makeObservedEdge(simulator, rawO2.action, 0, 1, [rawO2], 1, 10)],
      edgesObserved: 1,
      maxEdges: 10,
      captureComplete: true,
    },
  });
  assert.strictEqual(r4.classification, "R4");
  assert.strictEqual(r4.laterPositiveOpportunityCount, 0);

  const incomplete = attributeResidualPaidWitnessGraph({
    simulator,
    selectedWitness,
    selectedPostState: simulator.states[1],
    snapshot: {
      edges: [makeObservedEdge(simulator, rawO2.action, 0, 1, [rawO2], 1, 10)],
      edgesObserved: 2,
      maxEdges: 1,
      captureComplete: false,
    },
  });
  assert.strictEqual(incomplete.classification, "CAPTURE-INCOMPLETE");

  return {
    r1: r1.classification,
    reroot: reroot.classification,
    r2: r2.classification,
    r3: r3.classification,
    r4: r4.classification,
    incomplete: incomplete.classification,
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
  assert.strictEqual(syntheticReport.aggregate.capturedEdges, 1);
  assert.strictEqual(syntheticReport.aggregate.captureComplete, true);
  const residualSynthetic = runResidualSyntheticContracts();

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
      residualContracts: residualSynthetic,
    },
    qualificationEdge,
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main };
