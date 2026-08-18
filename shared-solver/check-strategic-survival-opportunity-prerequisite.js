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
  const includeResidualRecovery = process.argv.includes("--residual-recovery");
  const includeSecondResidualRecovery = process.argv.includes("--second-residual-recovery");
  const includePostO3Observation = process.argv.includes("--post-o3-observation");
  const includeO4ContinuationAttribution = process.argv.includes("--o4-continuation-attribution");
  const includeHierarchyCallAttribution = process.argv.includes("--hierarchy-call-attribution");
  const includeHierarchyCallChronology = process.argv.includes("--hierarchy-call-chronology");
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
    const runWithResidualObservation = (enable) => runStrategicD2Search({
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
      enableSurvivalOpportunityPrerequisite: true,
      enableSurvivalResidualAttribution: includeResidualRecovery || includeSecondResidualRecovery
        ? true
        : enable,
      enableSurvivalResidualRecovery: includeSecondResidualRecovery
        ? true
        : includeResidualRecovery && enable,
      enableSecondSurvivalResidualRecovery: (includeSecondResidualRecovery ||
          includeO4ContinuationAttribution) && enable,
      enableO4ContinuationAttribution: includeO4ContinuationAttribution && enable,
      enableHierarchyCallAttribution: includeHierarchyCallAttribution && enable,
      enableHierarchyCallChronology: includeHierarchyCallChronology && enable,
      enablePostResidualAttribution: includePostO3Observation && enable,
    });

    const control = runWithResidualObservation(false);
    const candidate = runWithResidualObservation(true);
    const sameOutcomeFields = includeSecondResidualRecovery
      ? ["totalSearchExpansions", "expansions", "battleAccessPrerequisiteCalls"]
      : [
        "totalSearchExpansions",
        "expansions",
        "generated",
        "accepted",
        "exactMerged",
        "battleAccessPrerequisiteExpansions",
        "battleAccessPrerequisiteCalls",
        "rootLevelCalls",
        "continuationDerivedCalls",
        "terminalActionGenerated",
      ];
    sameOutcomeFields.forEach((field) => {
      assert.strictEqual(control.stats[field], candidate.stats[field], `${field} changed with residual observation`);
    });
    if (!includeSecondResidualRecovery) {
      const controlOutcome = { ...control.outcome };
      const candidateOutcome = { ...candidate.outcome };
      delete controlOutcome.wallMs;
      delete candidateOutcome.wallMs;
      assert.deepStrictEqual(candidateOutcome, controlOutcome);
      assert.deepStrictEqual(candidate.bestTerminalBlocker, control.bestTerminalBlocker);
    }
    assert.strictEqual(
      control.stats.survivalOpportunityResidualAttributions.length,
      includeResidualRecovery ? 2 : 0,
    );
    assert.strictEqual(candidate.stats.totalSearchExpansions, 1000);
    assert.strictEqual(candidate.stats.battleAccessPrerequisiteCalls, 8);
    assert.strictEqual(
      candidate.stats.rootLevelCalls + candidate.stats.continuationDerivedCalls,
      8,
    );
    const expectedOpportunityCount = includeSecondResidualRecovery
      ? 4
      : includeResidualRecovery ? 3 : 2;
    assert.strictEqual(candidate.stats.survivalOpportunityPrerequisitesCompiled, expectedOpportunityCount);
    assert.strictEqual(candidate.stats.survivalOpportunityPrerequisitesWitnessBacked, expectedOpportunityCount);
    assert.strictEqual(candidate.stats.survivalOpportunityPrerequisitesSatisfied, expectedOpportunityCount);
    assert.strictEqual(candidate.stats.survivalOpportunityPrerequisiteStateCreated, 0);
    assert.strictEqual(candidate.stats.survivalOpportunityWitnesses.length, 2);
    if (!includeSecondResidualRecovery) {
      assert.strictEqual(candidate.bestTerminalBlocker.attackMargin, -903);
      assert.strictEqual(candidate.stats.terminalActionGenerated, 0);
    }
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

    assert.strictEqual(candidate.stats.survivalOpportunityResidualAttributions.length, 2);
    const secondResidual = candidate.stats.survivalOpportunityResidualAttributions
      .find((entry) => entry.target && entry.target.enemyId === "devilWarrior");
    assert.ok(secondResidual);
    assert.strictEqual(secondResidual.classification, "R1");
    assert.strictEqual(secondResidual.captureComplete, true);
    assert.strictEqual(secondResidual.observedEdges, 130);
    assert.strictEqual(secondResidual.laterPositiveOpportunityCount, 46);
    assert.strictEqual(secondResidual.candidates.filter((entry) =>
      entry.compatibilityKind && entry.suffixReplayValid === true).length, 6);
    assert.strictEqual(secondResidual.candidates.filter((entry) => !entry.compatibilityKind).length, 40);
    assert.strictEqual(secondResidual.candidates.filter((entry) => entry.suffixReplayValid === false).length, 0);
    const firstResidual = secondResidual.candidates.find((entry) => entry.suffixReplayValid === true);
    assert.ok(firstResidual);
    assert.strictEqual(
      firstResidual.candidateTarget,
      "battle|battle:skeletonPresbyter@MT5:3,10|MT5|3|10|skeletonPresbyter",
    );
    assert.strictEqual(firstResidual.candidateDiscoveryExpansion, 3);
    assert.strictEqual(firstResidual.candidateDiscoveryDepth, 1);
    assert.strictEqual(firstResidual.compatibilityKind, "prefix-compatible");
    assert.strictEqual(firstResidual.suffixLength, 1);
    assert.strictEqual(firstResidual.suffixReplayValid, true);
    assert.ok(secondResidual.candidates.every((entry, index, rows) =>
      index === 0 || rows[index - 1].candidateDiscoveryOrdinal < entry.candidateDiscoveryOrdinal));
    const nextPrerequisiteBreakpoint = candidate.stats.parentDependencyContinuationWitnesses
      .find((entry) => entry.continuationId === secondWitness.parentContinuationId &&
        entry.status === "next-prerequisite-not-schedulable");
    assert.ok(nextPrerequisiteBreakpoint);
    assert.strictEqual(nextPrerequisiteBreakpoint.statusReason, "call-cap-exhausted");

    if (includeResidualRecovery && !includeSecondResidualRecovery) {
      assert.strictEqual(control.stats.survivalOpportunityResidualRecoverySelected, 0);
      assert.strictEqual(candidate.stats.survivalOpportunityResidualRecoverySelected, 1);
      assert.strictEqual(candidate.stats.survivalOpportunityResidualReplayValid, 1);
      assert.strictEqual(candidate.stats.survivalOpportunityResidualPrerequisiteSatisfied, 1);
      assert.strictEqual(candidate.stats.survivalOpportunityResidualPrerequisiteStateCreated, 0);
      assert.strictEqual(candidate.stats.survivalOpportunityResidualRecoveries.length, 1);
      const residualRecovery = candidate.stats.survivalOpportunityResidualRecoveries[0];
      assert.strictEqual(residualRecovery.sourceType, "paid-residual-witness-suffix");
      assert.strictEqual(
        residualRecovery.selectionPolicy,
        "first-prefix-compatible-replay-valid-residual-by-bfs-discovery",
      );
      assert.strictEqual(residualRecovery.originSnapshotCaptureComplete, true);
      assert.strictEqual(residualRecovery.residualRecoverySelected, true);
      assert.strictEqual(residualRecovery.residualReplayValid, true);
      assert.strictEqual(residualRecovery.residualPrerequisiteSatisfied, true);
      assert.strictEqual(residualRecovery.selectedResidualTarget.enemyId, "skeletonPresbyter");
      assert.strictEqual(residualRecovery.selectedResidualTarget.floorId, "MT5");
      assert.strictEqual(residualRecovery.selectedResidualTarget.x, 3);
      assert.strictEqual(residualRecovery.selectedResidualTarget.y, 10);
      assert.strictEqual(residualRecovery.suffixLength, 1);
      assert.strictEqual(residualRecovery.materialized, true);
      assert.strictEqual(residualRecovery.parentContinuationCreated, true);
      assert.strictEqual(residualRecovery.residualSearchExpansions, 0);
      assert.strictEqual(residualRecovery.connectorCallsCharged, 0);
      const residualContinuation = candidate.stats.parentDependencyContinuationWitnesses
        .find((entry) => entry.continuationId === residualRecovery.parentContinuationId);
      assert.ok(residualContinuation);
      assert.strictEqual(residualContinuation.status, "next-prerequisite-not-schedulable");
      assert.strictEqual(residualContinuation.statusReason, "call-cap-exhausted");
      assert.deepStrictEqual(
        candidate.stats.survivalOpportunityResidualRecoveries.map((entry) => entry.selectedResidualTarget.enemyId),
        ["skeletonPresbyter"],
      );
    }

    if (includePostO3Observation) {
      assert.strictEqual(control.stats.survivalOpportunityPostResidualAttributions.length, 0);
      assert.strictEqual(candidate.stats.survivalOpportunityPostResidualAttributions.length, 1);
      const postO3 = candidate.stats.survivalOpportunityPostResidualAttributions[0];
      assert.strictEqual(postO3.originSnapshotCaptureComplete, true);
      assert.strictEqual(postO3.selectedPrefixLength, 2);
      assert.strictEqual(typeof postO3.selectedPrefixPostExactStateKey, "string");
      assert.ok(["P1", "P2", "P3", "P4"].includes(postO3.classification));
      assert.ok(postO3.candidates.every((entry, index, rows) =>
        index === 0 || rows[index - 1].candidateDiscoveryOrdinal < entry.candidateDiscoveryOrdinal));
      assert.ok(postO3.candidates.every((entry) =>
        entry.compatibilityKind === null || entry.compatibilityKind === "exact-prefix-only"));
    }

    if (includeSecondResidualRecovery) {
      assert.strictEqual(control.stats.paidResidualRecoveriesUsed, 1);
      assert.strictEqual(candidate.stats.paidResidualRecoveriesUsed, 2);
      assert.strictEqual(control.stats.survivalOpportunityResidualRecoveries.length, 1);
      assert.strictEqual(candidate.stats.survivalOpportunityResidualRecoveries.length, 2);
      assert.strictEqual(control.stats.survivalOpportunitySecondResidualRecoverySelected, 0);
      assert.strictEqual(control.stats.survivalOpportunitySecondResidualReplayValid, 0);
      assert.strictEqual(control.stats.survivalOpportunitySecondResidualMaterialized, 0);
      assert.ok(control.stats.survivalOpportunityResidualRecoveries.every((entry) =>
        entry.recoveryIndex !== 2));
      assert.strictEqual(candidate.stats.survivalOpportunitySecondResidualRecoverySelected, 1);
      assert.strictEqual(candidate.stats.survivalOpportunitySecondResidualReplayValid, 1);
      assert.strictEqual(candidate.stats.survivalOpportunitySecondResidualPrerequisiteSatisfied, 1);
      assert.strictEqual(candidate.stats.survivalOpportunitySecondResidualMaterialized, 1);
      assert.strictEqual(candidate.stats.survivalOpportunityResidualRecoveries.filter((entry) =>
        entry.materialized === true).length, 2);
      const firstRecovery = candidate.stats.survivalOpportunityResidualRecoveries
        .find((entry) => entry.recoveryIndex === 1);
      const secondRecovery = candidate.stats.survivalOpportunityResidualRecoveries
        .find((entry) => entry.recoveryIndex === 2);
      assert.ok(firstRecovery);
      assert.ok(secondRecovery);
      assert.strictEqual(firstRecovery.selectedResidualTarget.enemyId, "skeletonPresbyter");
      assert.strictEqual(firstRecovery.materialized, true);
      assert.strictEqual(firstRecovery.supersededBySecondResidual, true);
      assert.strictEqual(firstRecovery.parentContinuationCreated, false);
      assert.strictEqual(secondRecovery.recoveryIndex, 2);
      assert.strictEqual(secondRecovery.selectedResidualTarget.enemyId, "skeletonKing");
      assert.strictEqual(secondRecovery.selectedResidualTarget.floorId, "MT4");
      assert.strictEqual(secondRecovery.selectedResidualTarget.x, 8);
      assert.strictEqual(secondRecovery.selectedResidualTarget.y, 3);
      assert.strictEqual(secondRecovery.candidateDiscoveryOrdinal, 63);
      assert.strictEqual(secondRecovery.candidateDiscoveryExpansion, 25);
      assert.strictEqual(secondRecovery.candidateDiscoveryDepth, 3);
      assert.strictEqual(secondRecovery.suffixLength, 2);
      assert.strictEqual(secondRecovery.residualReplayValid, true);
      assert.strictEqual(secondRecovery.residualPrerequisiteSatisfied, true);
      assert.strictEqual(secondRecovery.residualSearchExpansions, 0);
      assert.strictEqual(secondRecovery.connectorCallsCharged, 0);
      assert.strictEqual(secondRecovery.materialized, true);
      assert.strictEqual(secondRecovery.parentContinuationCreated, true);
      assert.ok(secondRecovery.parentContinuationId);
      const secondContinuation = candidate.stats.parentDependencyContinuationWitnesses
        .find((entry) => entry.continuationId === secondRecovery.parentContinuationId);
      assert.ok(secondContinuation);
      assert.ok(secondContinuation.status);
      assert.ok(secondContinuation.statusReason);
      assert.strictEqual(candidate.stats.survivalOpportunityResidualRecoveries
        .filter((entry) => entry.selectedResidualTarget && entry.selectedResidualTarget.enemyId === "skeletonKing")
        .length, 1);
      assert.strictEqual(candidate.stats.survivalOpportunityPrerequisitesCompiled, 4);
      assert.strictEqual(candidate.stats.survivalOpportunityPrerequisitesWitnessBacked, 4);
      assert.strictEqual(candidate.stats.survivalOpportunityPrerequisitesSatisfied, 4);
      assert.strictEqual(candidate.stats.battleAccessPrerequisiteCalls, 8);
      assert.strictEqual(candidate.stats.rootLevelCalls + candidate.stats.continuationDerivedCalls, 8);
      assert.strictEqual(candidate.stats.rootLevelCalls, 5);
      assert.strictEqual(candidate.stats.continuationDerivedCalls, 3);
      assert.strictEqual(control.stats.rootLevelCalls, 5);
      assert.strictEqual(control.stats.continuationDerivedCalls, 3);
      assert.strictEqual(candidate.stats.totalSearchExpansions, 1000);
    }

    if (includeHierarchyCallAttribution) {
      assert.strictEqual(control.stats.hierarchyCallAllocationAttribution, null);
      const attribution = candidate.stats.hierarchyCallAllocationAttribution;
      assert.ok(attribution);
      assert.strictEqual(
        attribution.schema,
        "motapathfinder.strategic-hierarchy-call-allocation-attribution.v2",
      );
      assert.strictEqual(attribution.charged.total, candidate.stats.battleAccessPrerequisiteCalls);
      assert.strictEqual(attribution.charged.rootLevel, candidate.stats.rootLevelCalls);
      assert.strictEqual(attribution.charged.childLevel, candidate.stats.continuationDerivedCalls);
      assert.strictEqual(attribution.charged.rootLevel + attribution.charged.childLevel, 8);
      assert.ok(Array.isArray(attribution.perCall));
      assert.strictEqual(attribution.perCall.length, 8);
      for (const entry of attribution.perCall) {
        assert.ok(entry.attemptId);
        assert.strictEqual(typeof entry.hierarchyLevel, "number");
        assert.strictEqual(typeof entry.connectorOutcome.satisfied, "boolean");
        assert.ok(typeof entry.connectorOutcome.expansions === "number");
        assert.ok(typeof entry.derivedProgress.opportunityMaterializations === "number");
        assert.ok(typeof entry.derivedProgress.residualMaterializations === "number");
        assert.ok(typeof entry.derivedProgress.finalContinuationCreated === "number");
        assert.strictEqual(typeof entry.productive, "boolean");
      }
      for (const key of ["0", "1", "2+"]) {
        const bucket = attribution.byLevel[key];
        assert.ok(bucket);
        assert.strictEqual(bucket.calls, bucket.directSatisfied + bucket.connectorNotSatisfied);
        assert.strictEqual(
          bucket.connectorNotSatisfied,
          bucket.failedWithRecoveredProgress + bucket.failedWithoutRecoveredProgress,
        );
        assert.ok(typeof bucket.expansions === "number");
        assert.ok(typeof bucket.chainActions === "number");
        assert.ok(attribution.metricsPerLevel[key]);
        assert.ok("directConnectorSatisfactionRate" in attribution.metricsPerLevel[key]);
        assert.ok("productiveCallRate" in attribution.metricsPerLevel[key]);
      }
      const totalCalls = Object.values(attribution.byLevel)
        .reduce((sum, bucket) => sum + bucket.calls, 0);
      assert.strictEqual(totalCalls, 8);
      const rootCompiledNotSelected = attribution.unchargedAttempts.rootCompiledNotSelected;
      assert.ok(rootCompiledNotSelected);
      assert.strictEqual(typeof rootCompiledNotSelected.capBlockedSelectionEvents, "number");
      assert.strictEqual(typeof rootCompiledNotSelected.capBlockedCompiledCandidateInstances, "number");
      assert.ok(attribution.unchargedAttempts.continuationBlocks);
      assert.ok(attribution.unchargedAttempts.rejectedQueuedWork);
      const rootBucket = attribution.byLevel["0"];
      const levelOneBucket = attribution.byLevel["1"];
      const deepBucket = attribution.byLevel["2+"];
      assert.strictEqual(rootBucket.calls, 5);
      assert.strictEqual(rootBucket.directSatisfied, 1);
      assert.strictEqual(rootBucket.failedWithoutRecoveredProgress, 4);
      assert.strictEqual(rootBucket.failedWithRecoveredProgress, 0);
      assert.strictEqual(attribution.metricsPerLevel["0"].productiveCallRate, 0.2);
      assert.strictEqual(levelOneBucket.calls, 1);
      assert.strictEqual(attribution.metricsPerLevel["1"].productiveCallRate, 1);
      assert.strictEqual(deepBucket.calls, 2);
      assert.strictEqual(deepBucket.directSatisfied, 0);
      assert.strictEqual(deepBucket.failedWithRecoveredProgress, 2);
      assert.strictEqual(deepBucket.failedWithoutRecoveredProgress, 0);
      assert.strictEqual(attribution.metricsPerLevel["2+"].productiveCallRate, 1);
      const o1Attempt = attribution.perCall.find((entry) =>
        entry.attemptId === "cb70ef61ad4b231a@f35ece354048abe0");
      const o2Attempt = attribution.perCall.find((entry) =>
        entry.attemptId === "e9c03049d436f6f2@8bf509342ae539d2");
      assert.ok(o1Attempt);
      assert.ok(o2Attempt);
      assert.strictEqual(o1Attempt.hierarchyLevel, 2);
      assert.strictEqual(o1Attempt.connectorOutcome.satisfied, false);
      assert.strictEqual(o1Attempt.derivedProgress.opportunityMaterializations, 1);
      assert.strictEqual(o1Attempt.productive, true);
      assert.strictEqual(o2Attempt.hierarchyLevel, 3);
      assert.strictEqual(o2Attempt.connectorOutcome.satisfied, false);
      assert.strictEqual(o2Attempt.derivedProgress.opportunityMaterializations, 1);
      assert.strictEqual(o2Attempt.derivedProgress.residualMaterializations, 2);
      assert.strictEqual(o2Attempt.productive, true);
    }

    if (includeHierarchyCallChronology) {
      assert.strictEqual(control.stats.hierarchyCallChronology, null);
      const chronology = candidate.stats.hierarchyCallChronology;
      assert.ok(chronology);
      assert.strictEqual(
        chronology.schema,
        "motapathfinder.strategic-hierarchy-call-chronology-attribution.v1",
      );
      assert.ok(Array.isArray(chronology.calls));
      assert.strictEqual(chronology.calls.length, 8);
      chronology.calls.forEach((entry, index) => {
        assert.strictEqual(entry.callOrdinal, index + 1);
        assert.strictEqual(typeof entry.hierarchyLevel, "number");
        assert.ok(entry.attemptId);
        assert.strictEqual(typeof entry.expansionAtCharge, "number");
        assert.strictEqual(typeof entry.callsRemainingAfter, "number");
        assert.strictEqual(typeof entry.firstHierarchyActivationOccurred, "boolean");
        assert.strictEqual(typeof entry.productive, "boolean");
        assert.strictEqual(typeof entry.directSatisfied, "boolean");
      });
      const checkpoints = chronology.checkpoints;
      for (const key of ["firstContinuationCreated", "firstHierarchyActivation", "firstLevelOneCallCharged"]) {
        const checkpoint = checkpoints[key];
        assert.ok(checkpoint);
        assert.strictEqual(typeof checkpoint.expansion, "number");
        assert.strictEqual(typeof checkpoint.callOrdinal, "number");
        assert.strictEqual(typeof checkpoint.callsSpent, "number");
        assert.strictEqual(typeof checkpoint.rootCallsSpent, "number");
        assert.strictEqual(typeof checkpoint.callsRemaining, "number");
      }
      const rootAnalysis = chronology.rootCallsAnalysis;
      assert.ok(rootAnalysis);
      assert.strictEqual(rootAnalysis.total, 5);
      assert.strictEqual(rootAnalysis.byOrdinal.length, 5);
      assert.strictEqual(typeof rootAnalysis.beforeFirstHierarchyActivation, "number");
      assert.strictEqual(typeof rootAnalysis.afterFirstHierarchyActivation, "number");
      const hierarchyCalls = chronology.calls.filter((entry) => entry.hierarchyLevel >= 1);
      assert.strictEqual(hierarchyCalls.length, 3);
      const level1Call = hierarchyCalls.find((entry) => entry.hierarchyLevel === 1);
      assert.ok(level1Call);
      assert.strictEqual(
        level1Call.callOrdinal,
        checkpoints.firstLevelOneCallCharged.callOrdinal,
      );
    }

    if (includeO4ContinuationAttribution) {
      assert.strictEqual(control.stats.o4ContinuationAttributions.length, 0);
      assert.strictEqual(candidate.stats.o4ContinuationAttributions.length, 1);
      const boundary = candidate.stats.o4ContinuationAttributions[0];
      assert.strictEqual(boundary.schema, "motapathfinder.strategic-o4-continuation-boundary-attribution.v1");
      assert.strictEqual(typeof boundary.continuationId, "string");
      assert.strictEqual(boundary.o4FloorId, "MT4");
      assert.strictEqual(boundary.parentTargetFloorId, "MT5");
      assert.strictEqual(typeof boundary.o4ExactStateKey, "string");
      assert.ok(boundary.successorAttribution);
      assert.strictEqual(boundary.successorAttribution.supported, true);
      assert.ok(boundary.successorAttribution.rawActionVariantCount >= 0);
      assert.ok(boundary.successorAttribution.transitionsTotal >= 0);
      assert.strictEqual(typeof boundary.o4NodeExpanded, "boolean");
      assert.ok(Array.isArray(boundary.continuationWitnesses));
      assert.ok(Array.isArray(boundary.anchorExpansionWitnesses));
      assert.strictEqual(typeof boundary.searchEndExpansions, "number");
      const materializedRecord = candidate.stats.survivalOpportunityResidualRecoveries
        .find((entry) => entry.recoveryIndex === 2);
      assert.ok(materializedRecord);
      assert.strictEqual(materializedRecord.parentContinuationId, boundary.continuationId);
    }

    const secondResidualRecord = includeSecondResidualRecovery
      ? candidate.stats.survivalOpportunityResidualRecoveries
        .find((entry) => entry.recoveryIndex === 2)
      : null;
    const secondResidualContinuation = secondResidualRecord && secondResidualRecord.parentContinuationId
      ? candidate.stats.parentDependencyContinuationWitnesses
        .find((entry) => entry.continuationId === secondResidualRecord.parentContinuationId) || null
      : null;
    qualificationOpportunity = {
      controlCalls: control.stats.battleAccessPrerequisiteCalls,
      candidateCalls: candidate.stats.battleAccessPrerequisiteCalls,
      candidateRootCalls: candidate.stats.rootLevelCalls,
      candidateChildCalls: candidate.stats.continuationDerivedCalls,
      candidateOutcome: candidate.outcome,
      candidateBestTerminalBlocker: candidate.bestTerminalBlocker,
      survivalOpportunityPrerequisites: {
        compiled: candidate.stats.survivalOpportunityPrerequisitesCompiled,
        witnessBacked: candidate.stats.survivalOpportunityPrerequisitesWitnessBacked,
        satisfied: candidate.stats.survivalOpportunityPrerequisitesSatisfied,
        stateCreated: candidate.stats.survivalOpportunityPrerequisiteStateCreated,
      },
      witnesses: candidate.stats.survivalOpportunityWitnesses,
      residualAttributions: candidate.stats.survivalOpportunityResidualAttributions.map((entry) => ({
        target: entry.target,
        classification: entry.classification,
        captureComplete: entry.captureComplete,
        observedEdges: entry.observedEdges,
        laterPositiveOpportunityCount: entry.laterPositiveOpportunityCount,
        strictReplayPassCount: entry.candidates.filter((candidate) =>
          candidate.suffixReplayValid === true).length,
        strictReplayFailureCount: entry.candidates.filter((candidate) =>
          candidate.suffixReplayValid === false).length,
        compatibleCandidates: entry.candidates
          .filter((candidate) => candidate.compatibilityKind)
          .map((candidate) => ({
            candidateTarget: candidate.candidateTarget,
            candidateDiscoveryOrdinal: candidate.candidateDiscoveryOrdinal,
            candidateDiscoveryExpansion: candidate.candidateDiscoveryExpansion,
            candidateDiscoveryDepth: candidate.candidateDiscoveryDepth,
            compatibilityKind: candidate.compatibilityKind,
            compatibilityStartEdge: candidate.compatibilityStartEdge,
            suffixLength: candidate.suffixLength,
            suffixReplayValid: candidate.suffixReplayValid,
            replayFailureReason: candidate.replayFailureReason,
          })),
        })),
      residualRecovery: includeResidualRecovery
        ? candidate.stats.survivalOpportunityResidualRecoveries
        : null,
      secondResidualRecovery: includeSecondResidualRecovery
        ? candidate.stats.survivalOpportunityResidualRecoveries.map((entry) => ({
          recoveryIndex: entry.recoveryIndex || 1,
          target: entry.selectedResidualTarget,
          status: entry.status,
          statusReason: entry.statusReason,
          candidateDiscoveryOrdinal: entry.candidateDiscoveryOrdinal,
          candidateDiscoveryExpansion: entry.candidateDiscoveryExpansion,
          candidateDiscoveryDepth: entry.candidateDiscoveryDepth,
          suffixLength: entry.suffixLength,
          residualReplayValid: entry.residualReplayValid,
          residualPrerequisiteSatisfied: entry.residualPrerequisiteSatisfied,
          residualSearchExpansions: entry.residualSearchExpansions,
          connectorCallsCharged: entry.connectorCallsCharged,
          materialized: entry.materialized,
          parentContinuationCreated: entry.parentContinuationCreated,
          supersededBySecondResidual: Boolean(entry.supersededBySecondResidual),
        }))
        : null,
      secondResidualContinuation: secondResidualContinuation
        ? {
          continuationId: secondResidualContinuation.continuationId,
          status: secondResidualContinuation.status,
          statusReason: secondResidualContinuation.statusReason,
          currentFloorId: secondResidualContinuation.currentFloorId,
          targetFloorId: secondResidualContinuation.targetFloorId,
          nextPrerequisiteId: secondResidualContinuation.nextPrerequisiteId,
          prerequisiteKind: secondResidualContinuation.prerequisiteKind,
          nextBoundary: secondResidualContinuation.nextBoundary,
        }
        : null,
      o4ContinuationAttribution: includeO4ContinuationAttribution
        ? candidate.stats.o4ContinuationAttributions[0]
        : null,
      hierarchyCallAllocationAttribution: includeHierarchyCallAttribution
        ? candidate.stats.hierarchyCallAllocationAttribution
        : null,
      hierarchyCallChronology: includeHierarchyCallChronology
        ? candidate.stats.hierarchyCallChronology
        : null,
      postO3ResidualAttribution: includePostO3Observation
        ? candidate.stats.survivalOpportunityPostResidualAttributions.map((entry) => ({
          originFailedAttemptId: entry.originFailedAttemptId,
          originO2OpportunityId: entry.originO2OpportunityId,
          originO3OpportunityId: entry.originO3OpportunityId,
          originSnapshotCaptureComplete: entry.originSnapshotCaptureComplete,
          selectedPrefixLength: entry.selectedPrefixLength,
          classification: entry.classification,
          captureComplete: entry.captureComplete,
          observedEdges: entry.observedEdges,
          laterPositiveOpportunityCount: entry.laterPositiveOpportunityCount,
          strictReplayPassCount: entry.candidates.filter((candidate) =>
            candidate.suffixReplayValid === true).length,
          strictReplayFailureCount: entry.candidates.filter((candidate) =>
            candidate.suffixReplayValid === false).length,
          candidates: entry.candidates.map((candidate) => ({
            candidateTarget: candidate.candidateTarget,
            candidateDiscoveryOrdinal: candidate.candidateDiscoveryOrdinal,
            candidateDiscoveryExpansion: candidate.candidateDiscoveryExpansion,
            candidateDiscoveryDepth: candidate.candidateDiscoveryDepth,
            compatibilityKind: candidate.compatibilityKind,
            suffixLength: candidate.suffixLength,
            suffixReplayValid: candidate.suffixReplayValid,
            replayFailureReason: candidate.replayFailureReason,
          })),
        }))
        : null,
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
