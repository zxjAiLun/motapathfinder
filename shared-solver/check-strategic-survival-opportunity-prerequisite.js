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
const {
  runStrategicD2Search,
  buildRootRetryShadowCallBudgetAttribution,
  classifyPreHierarchyRootRetryNovelty,
  classifyRootAttemptSeparability,
  classifyRootRetryOfflineVerdict,
  classifyStageConditionalRootRetryComparability,
  classifyStageConditionalRootRetryOfflineVerdict,
} = require("./lib/strategic-d2-search");
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
  const includeRootAttemptSeparability = process.argv.includes("--root-attempt-separability");
  const includeRootRetryNovelty = process.argv.includes("--root-retry-novelty");
  const includeRootRetryMetricApplicability =
    process.argv.includes("--root-retry-metric-applicability");
  const includeRootRetryShadowCallBudget =
    process.argv.includes("--root-retry-shadow-call-budget");
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
      enableRootAttemptSeparabilityAttribution: includeRootAttemptSeparability && enable,
      enableRootRetryNoveltyAttribution: includeRootRetryNovelty && enable,
      enableRootRetryMetricApplicabilityAttribution:
        includeRootRetryMetricApplicability && enable,
      enableRootRetryShadowCallBudgetAttribution:
        includeRootRetryShadowCallBudget && enable,
      enablePostResidualAttribution: includePostO3Observation && enable,
    });

    // 5.19u Repair 1: isolation A/B for separability is decoupled from the
    // second-residual feature A/B. Both runs enable the identical
    // q/second-residual/hierarchy-attribution/chronology behavior; only the
    // separability observation flag toggles.
    const runWithSeparabilityIsolation = (enableSeparability) => runStrategicD2Search({
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
      enableSurvivalResidualAttribution: true,
      enableSurvivalResidualRecovery: true,
      enableSecondSurvivalResidualRecovery: true,
      enableO4ContinuationAttribution: false,
      enableHierarchyCallAttribution: true,
      enableHierarchyCallChronology: true,
      enableRootAttemptSeparabilityAttribution: enableSeparability,
      enablePostResidualAttribution: false,
    });

    // 5.19v: retry-novelty isolation keeps separability collection on in both
    // runs (it is the shared charge-record source) and toggles only the retry
    // attribution flag. Nothing else differs between control and candidate.
    const runWithRetryNoveltyIsolation = (enableRetry) => runStrategicD2Search({
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
      enableSurvivalResidualAttribution: true,
      enableSurvivalResidualRecovery: true,
      enableSecondSurvivalResidualRecovery: true,
      enableO4ContinuationAttribution: false,
      enableHierarchyCallAttribution: true,
      enableHierarchyCallChronology: true,
      enableRootAttemptSeparabilityAttribution: true,
      enableRootRetryNoveltyAttribution: enableRetry,
      enablePostResidualAttribution: false,
    });

    // 5.19w: metric-applicability isolation mirrors the generic candidate's
    // search / second-residual / hierarchy configuration exactly (so the
    // generic candidate can be reused as the candidate side, keeping this
    // checker at 3 total 1000-work runs) and toggles only the stage-conditional
    // observation flag.
    const runWithMetricApplicabilityIsolation = (enableMetricApplicability) =>
      runStrategicD2Search({
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
        enableSurvivalResidualAttribution: true,
        enableSurvivalResidualRecovery: includeSecondResidualRecovery || includeResidualRecovery,
        enableSecondSurvivalResidualRecovery: includeSecondResidualRecovery ||
          includeO4ContinuationAttribution,
        enableO4ContinuationAttribution: includeO4ContinuationAttribution,
        enableHierarchyCallAttribution: includeHierarchyCallAttribution,
        enableHierarchyCallChronology: includeHierarchyCallChronology,
        enableRootAttemptSeparabilityAttribution: includeRootAttemptSeparability,
        enableRootRetryNoveltyAttribution: includeRootRetryNovelty,
        enableRootRetryMetricApplicabilityAttribution: enableMetricApplicability,
        enablePostResidualAttribution: includePostO3Observation,
      });

    // 5.19x: shadow call-budget isolation mirrors the generic candidate field
    // for field (so the generic candidate is the candidate side and the checker
    // stays at 3 total 1000-work runs) and toggles only the ledger observation.
    const runWithShadowCallBudgetIsolation = (enableShadowCallBudget) =>
      runStrategicD2Search({
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
        enableSurvivalResidualAttribution: true,
        enableSurvivalResidualRecovery: includeSecondResidualRecovery || includeResidualRecovery,
        enableSecondSurvivalResidualRecovery: includeSecondResidualRecovery ||
          includeO4ContinuationAttribution,
        enableO4ContinuationAttribution: includeO4ContinuationAttribution,
        enableHierarchyCallAttribution: includeHierarchyCallAttribution,
        enableHierarchyCallChronology: includeHierarchyCallChronology,
        enableRootAttemptSeparabilityAttribution: includeRootAttemptSeparability,
        enableRootRetryNoveltyAttribution: includeRootRetryNovelty,
        enableRootRetryMetricApplicabilityAttribution: includeRootRetryMetricApplicability,
        enableRootRetryShadowCallBudgetAttribution: enableShadowCallBudget,
        enablePostResidualAttribution: includePostO3Observation,
      });

    const control = runWithResidualObservation(false);
    const candidate = runWithResidualObservation(true);    const sameOutcomeFields = includeSecondResidualRecovery
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
      assert.strictEqual(checkpoints.firstContinuationCreated.callOrdinal, 5);
      assert.strictEqual(checkpoints.firstContinuationCreated.rootCallsSpent, 5);
      assert.strictEqual(checkpoints.firstContinuationCreated.callsRemaining, 3);
      assert.strictEqual(checkpoints.firstHierarchyActivation.callOrdinal, 5);
      assert.strictEqual(checkpoints.firstHierarchyActivation.rootCallsSpent, 5);
      assert.strictEqual(checkpoints.firstHierarchyActivation.callsRemaining, 3);
      assert.strictEqual(checkpoints.firstLevelOneCallCharged.callOrdinal, 6);
      assert.strictEqual(checkpoints.firstLevelOneCallCharged.rootCallsSpent, 5);
      assert.strictEqual(checkpoints.firstLevelOneCallCharged.callsRemaining, 2);
      const rootChronologyCalls = chronology.calls.filter((entry) => entry.hierarchyLevel === 0);
      assert.strictEqual(rootChronologyCalls.length, 5);
      assert.deepStrictEqual(
        rootChronologyCalls.map((entry) => entry.productive),
        [false, false, false, false, true],
      );
      assert.ok(rootChronologyCalls.every((entry) =>
        entry.firstHierarchyActivationOccurred === false));
    }

    if (includeRootAttemptSeparability) {
      const isolationControl = runWithSeparabilityIsolation(false);
      const isolationCandidate = candidate;
      const stripWall = (outcome) => {
        const copy = { ...outcome };
        delete copy.wallMs;
        return copy;
      };
      assert.deepStrictEqual(
        stripWall(isolationCandidate.outcome),
        stripWall(isolationControl.outcome),
        "separability observation changed outcome",
      );
      assert.deepStrictEqual(
        isolationCandidate.bestTerminalBlocker,
        isolationControl.bestTerminalBlocker,
        "separability observation changed bestTerminalBlocker",
      );
      [
        "totalSearchExpansions",
        "expansions",
        "battleAccessPrerequisiteCalls",
        "rootLevelCalls",
        "continuationDerivedCalls",
      ].forEach((field) => {
        assert.strictEqual(
          isolationControl.stats[field],
          isolationCandidate.stats[field],
          `${field} changed with separability observation`,
        );
      });
      assert.deepStrictEqual(
        isolationCandidate.stats.battleAccessPrerequisiteWitnesses.map((w) => w.attemptId),
        isolationControl.stats.battleAccessPrerequisiteWitnesses.map((w) => w.attemptId),
        "charged witness identities changed with separability observation",
      );
      const compactResiduals = (stats) => stats.survivalOpportunityResidualRecoveries.map((r) => ({
        recoveryIndex: r.recoveryIndex,
        target: r.selectedResidualTarget ? r.selectedResidualTarget.enemyId : null,
        materialized: r.materialized,
        parentContinuationCreated: r.parentContinuationCreated,
      }));
      assert.deepStrictEqual(
        compactResiduals(isolationCandidate.stats),
        compactResiduals(isolationControl.stats),
        "residual/materialization results changed with separability observation",
      );
      assert.deepStrictEqual(
        [
          isolationCandidate.stats.survivalOpportunityPrerequisitesCompiled,
          isolationCandidate.stats.survivalOpportunityPrerequisitesWitnessBacked,
          isolationCandidate.stats.survivalOpportunityPrerequisitesSatisfied,
        ],
        [
          isolationControl.stats.survivalOpportunityPrerequisitesCompiled,
          isolationControl.stats.survivalOpportunityPrerequisitesWitnessBacked,
          isolationControl.stats.survivalOpportunityPrerequisitesSatisfied,
        ],
        "survival-opportunity counts changed with separability observation",
      );

      assert.strictEqual(isolationControl.stats.rootAttemptSeparabilityAttribution, null);
      const attribution = isolationCandidate.stats.rootAttemptSeparabilityAttribution;
      assert.ok(attribution);
      assert.strictEqual(
        attribution.schema,
        "motapathfinder.strategic-root-attempt-separability-attribution.v3",
      );
      assert.ok(Array.isArray(attribution.rootCompileEvents));
      assert.ok(attribution.rootCompileEvents.length >= 5);
      assert.ok(Array.isArray(attribution.rootCalls));
      assert.strictEqual(attribution.rootCalls.length, 5);
      assert.ok(Array.isArray(attribution.chargedToSelectedCandidate));
      assert.strictEqual(attribution.chargedToSelectedCandidate.length, 5);
      assert.ok(Array.isArray(attribution.chargedEventSummaries));
      assert.strictEqual(attribution.chargedEventSummaries.length, 5);
      assert.ok(attribution.availability);

      const uniqueAttemptIds = new Set(attribution.rootCalls.map((entry) => entry.attemptId));
      assert.strictEqual(uniqueAttemptIds.size, 5);

      for (const entry of attribution.rootCalls) {
        assert.ok(entry.attemptId);
        assert.ok(entry.semantic);
        assert.ok(entry.temporal);
        assert.ok(entry.label);
        assert.strictEqual(typeof entry.label.productive, "boolean");
        assert.strictEqual(typeof entry.label.directSatisfied, "boolean");
        const semanticKeys = Object.keys(entry.semantic);
        assert.ok(semanticKeys.includes("prerequisiteKind"));
        assert.ok(semanticKeys.includes("attackMargin"));
        assert.ok(semanticKeys.includes("damage"));
        assert.ok(semanticKeys.includes("survivalMargin"));
        assert.ok(semanticKeys.includes("sourceTerminalProgressScore"));
        assert.ok(semanticKeys.includes("compiledCandidateRank"));
        assert.ok(!semanticKeys.some((key) => /satisfied|expansion|productive|continuation|materializ/i.test(key)));
        assert.ok(!semanticKeys.some((key) => /O1|O2|O3|O4/i.test(key)));
      }

      for (const linkage of attribution.chargedToSelectedCandidate) {
        assert.strictEqual(linkage.matchedSelectedCandidateCount, 1);
        assert.strictEqual(linkage.matchedSemanticEqual, true);
      }

      for (const event of attribution.rootCompileEvents) {
        assert.strictEqual(typeof event.compileEventOrdinal, "number");
        assert.strictEqual(typeof event.expansionAtCompile, "number");
        assert.strictEqual(typeof event.callsExecuted, "number");
        assert.strictEqual(typeof event.callsRemainingBefore, "number");
        assert.strictEqual(typeof event.queuedCount, "number");
        assert.strictEqual(typeof event.maxOutstanding, "number");
        assert.ok(Array.isArray(event.candidates));
        const ranks = event.candidates.map((candidate) => candidate.localRank);
        assert.deepStrictEqual(
          ranks,
          Array.from({ length: event.candidates.length }, (_, index) => index + 1),
        );
        assert.strictEqual(
          event.selectedCount,
          event.candidates.filter((candidate) => candidate.selected).length,
        );
        for (const candidate of event.candidates) {
          assert.strictEqual(typeof candidate.dependencyAttemptId, "string");
          assert.strictEqual(typeof candidate.prerequisiteId, "string");
          assert.strictEqual(typeof candidate.dedupeSeenBeforeSelection, "boolean");
          assert.ok(candidate.identity);
          assert.ok(candidate.semantic);
        }
      }

      assert.deepStrictEqual(
        attribution.rootCalls.map((entry) => entry.label.productive),
        [false, false, false, false, true],
      );
      assert.deepStrictEqual(
        attribution.rootCalls.map((entry) => entry.label.directSatisfied),
        [false, false, false, false, true],
      );
      assert.deepStrictEqual(
        attribution.rootCalls.map((entry) => entry.temporal.expansionAtCharge),
        [8, 16, 24, 32, 40],
      );
      assert.deepStrictEqual(
        attribution.chargedEventSummaries.map((summary) => [
          summary.selectedLocalRank,
          summary.candidateCount,
        ]),
        [[1, 4], [1, 4], [1, 4], [1, 4], [1, 4]],
      );

      const separability = attribution.separability;
      assert.ok(separability);
      assert.strictEqual(separability.classification, "U1");
      assert.strictEqual(separability.productiveRootCount, 1);
      assert.strictEqual(separability.failedRootCount, 4);
      assert.ok(separability.singleFeatureSeparators.includes("attackMargin"));
      assert.ok(separability.vectorEqualityDetails);
      assert.strictEqual(separability.vectorEqualityDetails.anyCollision, false);

      const availability = attribution.availability;
      assert.strictEqual(availability.productiveAttemptId, "3632e7cfab66d64b@69c2c78b137e0442");
      assert.strictEqual(availability.productiveEventOrdinal, 5);
      assert.strictEqual(availability.productiveEventExpansion, 36);
      assert.strictEqual(availability.earlierEventCount, 4);
      assert.strictEqual(availability.earlierCandidateCount, 16);
      assert.strictEqual(availability.positiveAttackMarginCandidateCount, 0);
      assert.strictEqual(availability.sameAttemptCandidateCount, 0);
      assert.strictEqual(availability.sameBoundaryIdentityCandidateCount, 0);
      assert.strictEqual(availability.samePrerequisiteIdCandidateCount, 0);
      assert.strictEqual(availability.signalDefinition.name, "positive-attack-margin");
      assert.strictEqual(availability.signalDefinition.definition, "attackMargin > 0");
      assert.strictEqual(
        availability.verdict,
        "NO-EARLIER-POSITIVE-ATTACK-MARGIN-OR-EXACT-ATTEMPT-EVIDENCE",
      );
      assert.deepStrictEqual(
        attribution.chargedEventSummaries.map((summary) =>
          summary.positiveAttackMarginCandidateCount),
        [0, 0, 0, 0, 4],
      );

      const syntheticClassification = (productiveSemantic, failedSemantics, options) => {
        const config = options || {};
        const productiveTemporal = config.productiveTemporal ||
          { callOrdinal: 5, expansionAtCharge: 40 };
        const failedTemporals = config.failedTemporals || failedSemantics.map((_, index) => ({
          callOrdinal: index + 1,
          expansionAtCharge: (index + 1) * 8,
        }));
        const productive = {
          attemptId: "P",
          callOrdinal: productiveTemporal.callOrdinal,
          semantic: productiveSemantic,
          temporal: { expansionAtCharge: productiveTemporal.expansionAtCharge },
        };
        const failed = failedSemantics.map((semantic, index) => ({
          attemptId: `F${index}`,
          callOrdinal: failedTemporals[index].callOrdinal,
          semantic,
          temporal: { expansionAtCharge: failedTemporals[index].expansionAtCharge },
        }));
        return classifyRootAttemptSeparability(productive, failed);
      };
      const baseSemantic = {
        prerequisiteKind: "battle-access-prerequisite",
        stageGoal: null,
        parentDependencyKind: "resource/power-opportunity-acquisition",
        parentDependencyCapability: "combat-power",
        reachableAtCompileTime: false,
        sourceDepth: 1,
        sourceFloor: "MT5",
        beforeStage: "lethal",
        attackMargin: 377,
        damage: 39321,
        survivalMargin: -26036,
        sourceTerminalProgressScore: 999999998777,
        compiledCandidateRank: 1,
        compiledCandidateCount: 4,
      };
      const u3 = syntheticClassification(baseSemantic, [
        { ...baseSemantic },
        { ...baseSemantic },
      ]);
      assert.strictEqual(u3.classification, "U3");
      assert.strictEqual(u3.vectorEqualityDetails.allFailedEqualToProductive, true);
      assert.ok(u3.singleTemporalSeparators.includes("callOrdinal"));
      assert.ok(u3.vectorEqualityDetails.temporalProvided);
      const u4NoTemporalSeparator = syntheticClassification(baseSemantic, [
        { ...baseSemantic },
        { ...baseSemantic },
      ], {
        productiveTemporal: { callOrdinal: 5, expansionAtCharge: 40 },
        failedTemporals: [
          { callOrdinal: 5, expansionAtCharge: 40 },
          { callOrdinal: 5, expansionAtCharge: 40 },
        ],
      });
      assert.strictEqual(u4NoTemporalSeparator.classification, "U4");
      assert.strictEqual(
        u4NoTemporalSeparator.reason,
        "semantic-collision-without-temporal-separator",
      );
      const u2 = syntheticClassification(baseSemantic, [
        { ...baseSemantic, sourceDepth: 9 },
        { ...baseSemantic },
        { ...baseSemantic, attackMargin: -100 },
      ]);
      assert.strictEqual(u2.classification, "U2");
      assert.strictEqual(u2.collisionAttemptIds.length, 1);
      assert.strictEqual(u2.vectorEqualityDetails.anyCollision, true);
      assert.strictEqual(u2.vectorEqualityDetails.allFailedEqualToProductive, false);
      const u1 = syntheticClassification(baseSemantic, [
        { ...baseSemantic, attackMargin: -273, sourceDepth: 0 },
        { ...baseSemantic, attackMargin: -173, damage: 1978814, sourceDepth: 5 },
      ]);
      assert.strictEqual(u1.classification, "U1");
      assert.ok(u1.singleFeatureSeparators.includes("attackMargin"));
      const objectValueEqual = syntheticClassification(
        { ...baseSemantic, nested: { a: 1, b: { c: 2 } } },
        [{ ...baseSemantic, nested: { a: 1, b: { c: 2 } } }],
      );
      assert.strictEqual(objectValueEqual.classification, "U3");
      const combinationOnly = syntheticClassification(baseSemantic, [
        { ...baseSemantic, attackMargin: -273 },
        { ...baseSemantic, sourceDepth: 9 },
      ]);
      assert.strictEqual(combinationOnly.classification, "U1-COMBINATION-ONLY");
      const nestedVector = syntheticClassification(
        { nested: { k: 1 }, a: 1, b: 1 },
        [
          { nested: { k: 1 }, a: 2, b: 1 },
          { nested: { k: 1 }, a: 1, b: 2 },
        ],
      );
      assert.strictEqual(nestedVector.classification, "U1-COMBINATION-ONLY");
      assert.ok(!nestedVector.singleFeatureSeparators.includes("nested"));
      assert.ok(!nestedVector.singleFeatureSeparators.includes("a"));
      assert.ok(!nestedVector.singleFeatureSeparators.includes("b"));
      const reorderedKeyFingerprint = syntheticClassification(
        { z: 1, a: { m: 1, n: 2 }, b: 3 },
        [{ a: { n: 2, m: 1 }, b: 3, z: 1 }],
      );
      assert.strictEqual(reorderedKeyFingerprint.vectorEqualityDetails.anyCollision, true);
      assert.strictEqual(
        reorderedKeyFingerprint.vectorEqualityDetails.productiveSemanticFingerprint,
        reorderedKeyFingerprint.vectorEqualityDetails.failedSemanticFingerprints[0].fingerprint,
      );
    }

    if (includeRootRetryNovelty) {
      const retryControl = runWithRetryNoveltyIsolation(false);
      const retryCandidate = candidate;
      const retryStripWall = (outcome) => {
        const copy = { ...outcome };
        delete copy.wallMs;
        return copy;
      };
      assert.deepStrictEqual(
        retryStripWall(retryCandidate.outcome),
        retryStripWall(retryControl.outcome),
        "retry observation changed outcome",
      );
      assert.deepStrictEqual(
        retryCandidate.bestTerminalBlocker,
        retryControl.bestTerminalBlocker,
        "retry observation changed bestTerminalBlocker",
      );
      [
        "totalSearchExpansions",
        "expansions",
        "battleAccessPrerequisiteCalls",
        "rootLevelCalls",
        "continuationDerivedCalls",
      ].forEach((field) => {
        assert.strictEqual(
          retryControl.stats[field],
          retryCandidate.stats[field],
          `${field} changed with retry observation`,
        );
      });
      assert.deepStrictEqual(
        retryCandidate.stats.battleAccessPrerequisiteWitnesses.map((w) => w.attemptId),
        retryControl.stats.battleAccessPrerequisiteWitnesses.map((w) => w.attemptId),
        "charged witness identities changed with retry observation",
      );
      const retryCompactResiduals = (stats) => stats.survivalOpportunityResidualRecoveries.map((r) => ({
        recoveryIndex: r.recoveryIndex,
        target: r.selectedResidualTarget ? r.selectedResidualTarget.enemyId : null,
        materialized: r.materialized,
        parentContinuationCreated: r.parentContinuationCreated,
      }));
      assert.deepStrictEqual(
        retryCompactResiduals(retryCandidate.stats),
        retryCompactResiduals(retryControl.stats),
        "residual/materialization results changed with retry observation",
      );

      assert.strictEqual(retryControl.stats.rootRetryNoveltyAttribution, null);
      const retryAttribution = retryCandidate.stats.rootRetryNoveltyAttribution;
      assert.ok(retryAttribution);
      assert.strictEqual(
        retryAttribution.schema,
        "motapathfinder.strategic-root-retry-novelty-attribution.v2",
      );
      assert.strictEqual(retryAttribution.rootCallCount, 5);
      assert.ok(Array.isArray(retryAttribution.preChargeComparisons));
      assert.ok(Array.isArray(retryAttribution.postSearchEvaluation));
      assert.strictEqual(retryAttribution.postSearchEvaluation.length, 5);
      assert.ok([
        "TRACE-LOCAL-NONPRODUCTIVE-DOMINATED-RETRY-OBSERVED",
        "PRODUCTIVE-ROOT-WOULD-BE-FLAGGED",
        "NO-PRECHARGE-NONIMPROVING-RETRY",
        "EVIDENCE-INCOMPLETE",
      ].includes(retryAttribution.verdict));

      for (const comparison of retryAttribution.preChargeComparisons) {
        const keys = Object.keys(comparison);
        assert.ok(!keys.some((key) => /productive|directSatisfied|satisfied|materializ|continuation/i.test(key)),
          `post-hoc field leaked into preChargeComparisons: ${keys.join(",")}`);
        assert.ok([
          "FIRST-SEEN",
          "EXACT-SEMANTIC-RETRY",
          "METRIC-TIE-CONTEXT-ONLY",
          "PRIOR-ATTEMPT-DOMINATES",
          "CURRENT-ATTEMPT-IMPROVES",
          "MIXED-TRADEOFF",
          "EVIDENCE-INCOMPLETE",
        ].includes(comparison.classification));
      }
      assert.deepStrictEqual(
        retryAttribution.postSearchEvaluation.map((entry) => entry.productive),
        [false, false, false, false, true],
      );
      assert.deepStrictEqual(retryAttribution.productiveFlaggedCallOrdinals, []);
      assert.deepStrictEqual(retryAttribution.nonProductiveFlaggedCallOrdinals, []);
      assert.deepStrictEqual(retryAttribution.incompleteCallOrdinals, [2, 4]);
      assert.deepStrictEqual(retryAttribution.missingEvaluationCallOrdinals, []);
      assert.strictEqual(retryAttribution.repeatGroupCount, 1);
      assert.strictEqual(
        retryAttribution.preChargeComparisons.map((entry) => entry.classification).join(","),
        "FIRST-SEEN,EVIDENCE-INCOMPLETE,EVIDENCE-INCOMPLETE,FIRST-SEEN,FIRST-SEEN",
      );
      assert.deepStrictEqual(
        retryAttribution.preChargeComparisons.map((entry) => entry.callOrdinal),
        [1, 2, 4, 3, 5],
      );
      const retryComparison4 = retryAttribution.preChargeComparisons.find(
        (entry) => entry.callOrdinal === 4,
      );
      assert.ok(retryComparison4);
      assert.ok(retryComparison4.improvedFields.includes("attackMargin"));
      assert.ok(retryComparison4.improvedFields.includes("sourceTerminalProgressScore"));
      assert.strictEqual(retryAttribution.verdict, "EVIDENCE-INCOMPLETE");
      const retryComparison2 = retryAttribution.preChargeComparisons.find(
        (entry) => entry.callOrdinal === 2,
      );
      assert.ok(retryComparison2);
      assert.deepStrictEqual([...retryComparison2.missingFields].sort(), ["damage", "survivalMargin"]);
      assert.deepStrictEqual([...retryComparison4.missingFields].sort(), ["damage", "survivalMargin"]);
      assert.ok(retryComparison2.pairwiseComparisons[0].missingFields.includes("damage"));
      assert.ok(!("rootCompileEvents" in retryAttribution));

      const syntheticRetry = (calls) => classifyPreHierarchyRootRetryNovelty(calls);
      const baseRetrySemantic = {
        attackMargin: -273,
        survivalMargin: -1000,
        sourceTerminalProgressScore: 999999998777,
        damage: 5000,
        reachableAtCompileTime: false,
        sourceDepth: 0,
        sourceFloor: "MT5",
        beforeStage: "attack-blocked",
        stageGoal: null,
        compiledCandidateRank: 1,
        compiledCandidateCount: 4,
      };
      const mkRetryCall = (callOrdinal, semantic, extra) => ({
        callOrdinal,
        attemptId: `A${callOrdinal}`,
        prerequisiteId: "P1",
        parentDependencyId: "D1",
        identity: { floorId: "MT5", enemyId: "evilHero", x: 9, y: 10 },
        semantic,
        temporal: { firstHierarchyActivationOccurred: false },
        ...extra,
      });
      const firstSeen = syntheticRetry([mkRetryCall(1, baseRetrySemantic)]);
      assert.strictEqual(firstSeen.comparisons[0].classification, "FIRST-SEEN");
      const exactRetry = syntheticRetry([
        mkRetryCall(1, baseRetrySemantic),
        mkRetryCall(2, { ...baseRetrySemantic }),
      ]);
      assert.strictEqual(exactRetry.comparisons[1].classification, "EXACT-SEMANTIC-RETRY");
      const metricTie = syntheticRetry([
        mkRetryCall(1, baseRetrySemantic),
        mkRetryCall(2, { ...baseRetrySemantic, sourceDepth: 2, compiledCandidateRank: 2 }),
      ]);
      assert.strictEqual(metricTie.comparisons[1].classification, "METRIC-TIE-CONTEXT-ONLY");
      const dominated = syntheticRetry([
        mkRetryCall(1, baseRetrySemantic),
        mkRetryCall(2, { ...baseRetrySemantic, attackMargin: -400 }),
      ]);
      assert.strictEqual(dominated.comparisons[1].classification, "PRIOR-ATTEMPT-DOMINATES");
      const improved = syntheticRetry([
        mkRetryCall(1, baseRetrySemantic),
        mkRetryCall(2, { ...baseRetrySemantic, attackMargin: -100 }),
      ]);
      assert.strictEqual(improved.comparisons[1].classification, "CURRENT-ATTEMPT-IMPROVES");
      const mixed = syntheticRetry([
        mkRetryCall(1, baseRetrySemantic),
        mkRetryCall(2, { ...baseRetrySemantic, attackMargin: -100, survivalMargin: -2000 }),
      ]);
      assert.strictEqual(mixed.comparisons[1].classification, "MIXED-TRADEOFF");
      const missingMetric = syntheticRetry([
        mkRetryCall(1, baseRetrySemantic),
        mkRetryCall(2, { ...baseRetrySemantic, damage: null }),
      ]);
      assert.strictEqual(missingMetric.comparisons[1].classification, "EVIDENCE-INCOMPLETE");
      const contextOnly = syntheticRetry([
        mkRetryCall(1, baseRetrySemantic),
        mkRetryCall(2, { ...baseRetrySemantic, beforeStage: "lethal" }),
      ]);
      assert.strictEqual(
        contextOnly.comparisons[1].contextDifferenceKeys.includes("beforeStage"),
        true,
      );
      assert.strictEqual(contextOnly.comparisons[1].classification, "METRIC-TIE-CONTEXT-ONLY");
      const exactNullVector = syntheticRetry([
        mkRetryCall(1, { ...baseRetrySemantic, damage: null, survivalMargin: null }),
        mkRetryCall(2, { ...baseRetrySemantic, damage: null, survivalMargin: null }),
      ]);
      assert.strictEqual(exactNullVector.comparisons[1].classification, "EXACT-SEMANTIC-RETRY");
      assert.ok(exactNullVector.comparisons[1].exactSemanticEqual);
      const dominatedWithMissing = syntheticRetry([
        mkRetryCall(1, { ...baseRetrySemantic, attackMargin: -100, damage: 1000 }),
        mkRetryCall(2, { ...baseRetrySemantic, damage: null }),
        mkRetryCall(3, { ...baseRetrySemantic, attackMargin: -400, damage: 1000 }),
      ]);
      assert.strictEqual(dominatedWithMissing.comparisons[2].classification, "PRIOR-ATTEMPT-DOMINATES");
      assert.deepStrictEqual(dominatedWithMissing.comparisons[2].decisiveEarlierCallOrdinals, [1]);
      const improvesButDominated = syntheticRetry([
        mkRetryCall(1, { ...baseRetrySemantic, attackMargin: -400 }),
        mkRetryCall(2, { ...baseRetrySemantic, attackMargin: -100 }),
        mkRetryCall(3, baseRetrySemantic),
      ]);
      assert.strictEqual(improvesButDominated.comparisons[2].classification, "PRIOR-ATTEMPT-DOMINATES");
      assert.deepStrictEqual(improvesButDominated.comparisons[2].decisiveEarlierCallOrdinals, [2]);
      const allImproved = syntheticRetry([
        mkRetryCall(1, { ...baseRetrySemantic, attackMargin: -400 }),
        mkRetryCall(2, { ...baseRetrySemantic, attackMargin: -350 }),
        mkRetryCall(3, { ...baseRetrySemantic, attackMargin: -100 }),
      ]);
      assert.strictEqual(allImproved.comparisons[2].classification, "CURRENT-ATTEMPT-IMPROVES");
      const productiveVsIncomplete = classifyRootRetryOfflineVerdict(
        [
          { callOrdinal: 1, classification: "EVIDENCE-INCOMPLETE" },
          { callOrdinal: 2, classification: "PRIOR-ATTEMPT-DOMINATES" },
        ],
        [
          { callOrdinal: 1, productive: false },
          { callOrdinal: 2, productive: true },
        ],
      );
      assert.strictEqual(productiveVsIncomplete.verdict, "PRODUCTIVE-ROOT-WOULD-BE-FLAGGED");
      assert.deepStrictEqual(productiveVsIncomplete.productiveFlaggedCallOrdinals, [2]);

      const nonProductiveWithIncomplete = classifyRootRetryOfflineVerdict(
        [
          { callOrdinal: 1, classification: "EVIDENCE-INCOMPLETE" },
          { callOrdinal: 2, classification: "PRIOR-ATTEMPT-DOMINATES" },
        ],
        [
          { callOrdinal: 1, productive: false },
          { callOrdinal: 2, productive: false },
        ],
      );
      assert.strictEqual(nonProductiveWithIncomplete.verdict, "EVIDENCE-INCOMPLETE");
      assert.deepStrictEqual(nonProductiveWithIncomplete.productiveFlaggedCallOrdinals, []);
      assert.deepStrictEqual(nonProductiveWithIncomplete.nonProductiveFlaggedCallOrdinals, [2]);
      assert.deepStrictEqual(nonProductiveWithIncomplete.incompleteCallOrdinals, [1]);
      assert.deepStrictEqual(nonProductiveWithIncomplete.missingEvaluationCallOrdinals, []);

      const missingEvaluation = classifyRootRetryOfflineVerdict(
        [{ callOrdinal: 2, classification: "PRIOR-ATTEMPT-DOMINATES" }],
        [],
      );
      assert.strictEqual(missingEvaluation.verdict, "EVIDENCE-INCOMPLETE");
      assert.deepStrictEqual(missingEvaluation.missingEvaluationCallOrdinals, [2]);
      assert.deepStrictEqual(missingEvaluation.nonProductiveFlaggedCallOrdinals, []);

      const nonBooleanEvaluation = classifyRootRetryOfflineVerdict(
        [{ callOrdinal: 2, classification: "PRIOR-ATTEMPT-DOMINATES" }],
        [{ callOrdinal: 2, productive: "false" }],
      );
      assert.strictEqual(nonBooleanEvaluation.verdict, "EVIDENCE-INCOMPLETE");
      assert.deepStrictEqual(nonBooleanEvaluation.missingEvaluationCallOrdinals, [2]);
      assert.deepStrictEqual(nonBooleanEvaluation.nonProductiveFlaggedCallOrdinals, []);

      const duplicateEvaluation = classifyRootRetryOfflineVerdict(
        [{ callOrdinal: 2, classification: "PRIOR-ATTEMPT-DOMINATES" }],
        [
          { callOrdinal: 2, productive: false },
          { callOrdinal: 2, productive: false },
        ],
      );
      assert.strictEqual(duplicateEvaluation.verdict, "EVIDENCE-INCOMPLETE");
      assert.deepStrictEqual(duplicateEvaluation.missingEvaluationCallOrdinals, [2]);
      assert.deepStrictEqual(duplicateEvaluation.nonProductiveFlaggedCallOrdinals, []);

      const productiveWithLinkageIncomplete = classifyRootRetryOfflineVerdict(
        [
          { callOrdinal: 1, classification: "EVIDENCE-INCOMPLETE" },
          { callOrdinal: 2, classification: "PRIOR-ATTEMPT-DOMINATES" },
          { callOrdinal: 3, classification: "PRIOR-ATTEMPT-DOMINATES" },
        ],
        [
          { callOrdinal: 1, productive: false },
          { callOrdinal: 2, productive: true },
        ],
      );
      assert.strictEqual(
        productiveWithLinkageIncomplete.verdict,
        "PRODUCTIVE-ROOT-WOULD-BE-FLAGGED",
      );
      assert.deepStrictEqual(productiveWithLinkageIncomplete.productiveFlaggedCallOrdinals, [2]);
      assert.deepStrictEqual(productiveWithLinkageIncomplete.incompleteCallOrdinals, [1]);
      assert.deepStrictEqual(productiveWithLinkageIncomplete.missingEvaluationCallOrdinals, [3]);

      const completeNonProductive = classifyRootRetryOfflineVerdict(
        [{ callOrdinal: 2, classification: "PRIOR-ATTEMPT-DOMINATES" }],
        [{ callOrdinal: 2, productive: false }],
      );
      assert.strictEqual(
        completeNonProductive.verdict,
        "TRACE-LOCAL-NONPRODUCTIVE-DOMINATED-RETRY-OBSERVED",
      );
      assert.deepStrictEqual(completeNonProductive.nonProductiveFlaggedCallOrdinals, [2]);
    }

    if (includeRootRetryMetricApplicability) {
      const applicabilityControl = runWithMetricApplicabilityIsolation(false);
      const applicabilityCandidate = candidate;
      const applicabilityStripWall = (outcome) => {
        const copy = { ...outcome };
        delete copy.wallMs;
        return copy;
      };
      assert.deepStrictEqual(
        applicabilityStripWall(applicabilityCandidate.outcome),
        applicabilityStripWall(applicabilityControl.outcome),
        "metric applicability observation changed outcome",
      );
      assert.deepStrictEqual(
        applicabilityCandidate.bestTerminalBlocker,
        applicabilityControl.bestTerminalBlocker,
        "metric applicability observation changed bestTerminalBlocker",
      );
      [
        "totalSearchExpansions",
        "expansions",
        "battleAccessPrerequisiteCalls",
        "rootLevelCalls",
        "continuationDerivedCalls",
      ].forEach((field) => {
        assert.strictEqual(
          applicabilityControl.stats[field],
          applicabilityCandidate.stats[field],
          `${field} changed with metric applicability observation`,
        );
      });
      assert.deepStrictEqual(
        applicabilityCandidate.stats.battleAccessPrerequisiteWitnesses.map((w) => w.attemptId),
        applicabilityControl.stats.battleAccessPrerequisiteWitnesses.map((w) => w.attemptId),
        "charged witness identities changed with metric applicability observation",
      );
      const applicabilityCompactResiduals = (stats) =>
        stats.survivalOpportunityResidualRecoveries.map((r) => ({
          recoveryIndex: r.recoveryIndex,
          target: r.selectedResidualTarget ? r.selectedResidualTarget.enemyId : null,
          materialized: r.materialized,
          parentContinuationCreated: r.parentContinuationCreated,
        }));
      assert.deepStrictEqual(
        applicabilityCompactResiduals(applicabilityCandidate.stats),
        applicabilityCompactResiduals(applicabilityControl.stats),
        "residual/materialization results changed with metric applicability observation",
      );

      assert.strictEqual(
        applicabilityControl.stats.rootRetryMetricApplicabilityAttribution,
        null,
      );
      const applicability = applicabilityCandidate.stats.rootRetryMetricApplicabilityAttribution;
      assert.ok(applicability);
      assert.strictEqual(
        applicability.schema,
        "motapathfinder.strategic-root-retry-metric-applicability-attribution.v1",
      );
      assert.strictEqual(applicability.rootCallCount, 5);
      assert.ok(Array.isArray(applicability.preChargeComparisons));
      assert.ok(Array.isArray(applicability.postSearchEvaluation));
      assert.strictEqual(applicability.postSearchEvaluation.length, 5);
      assert.ok([
        "PRODUCTIVE-ROOT-WOULD-BE-FLAGGED",
        "STAGE-CONDITIONAL-EVIDENCE-INCOMPLETE",
        "TRACE-LOCAL-STAGE-CONDITIONAL-NONIMPROVING-RETRY-OBSERVED",
        "NO-STAGE-CONDITIONAL-NONIMPROVING-RETRY",
      ].includes(applicability.verdict));
      const applicabilityClassifications = [
        "FIRST-SEEN",
        "EXACT-OBSERVABLE-RETRY",
        "STAGE-PROGRESS",
        "STAGE-REGRESSION",
        "SAME-STAGE-PRIOR-DOMINATES",
        "SAME-STAGE-CURRENT-IMPROVES",
        "SAME-STAGE-METRIC-TIE-CONTEXT-ONLY",
        "SAME-STAGE-MIXED-TRADEOFF",
        "INCOMPARABLE-UNSUPPORTED",
        "UNEXPECTED-MISSING-APPLICABLE-METRIC",
      ];
      for (const comparison of applicability.preChargeComparisons) {
        const keys = Object.keys(comparison);
        assert.ok(
          !keys.some((key) => /productive|directSatisfied|satisfied|materializ|continuation/i.test(key)),
          `post-hoc field leaked into preChargeComparisons: ${keys.join(",")}`,
        );
        assert.ok(applicabilityClassifications.includes(comparison.classification));
        for (const pair of comparison.pairwiseComparisons || []) {
          assert.ok(applicabilityClassifications.includes(pair.classification));
          assert.ok(["same", "progress", "regression", "incomparable"].includes(pair.stageRelation));
          // damage/survivalMargin can never be both not-applicable and missing.
          for (const metric of pair.notApplicableMetrics) {
            assert.ok(
              !pair.unexpectedMissingMetrics.includes(metric),
              `${metric} reported as both not-applicable and unexpectedly missing`,
            );
            assert.ok(
              !pair.applicableMetrics.includes(metric),
              `${metric} reported as both not-applicable and applicable`,
            );
          }
          // attack-blocked on either side must never demand damage/survivalMargin.
          if (pair.earlierStage === "attack-blocked" || pair.currentStage === "attack-blocked") {
            assert.deepStrictEqual(
              [...pair.notApplicableMetrics].sort(),
              ["damage", "survivalMargin"],
            );
            assert.ok(!pair.applicableMetrics.includes("damage"));
            assert.ok(!pair.applicableMetrics.includes("survivalMargin"));
          }
        }
      }
      assert.deepStrictEqual(
        applicability.postSearchEvaluation.map((entry) => entry.productive),
        [false, false, false, false, true],
      );
      assert.ok(!("rootCompileEvents" in applicability));

      // --- 5.19w frozen real corpus facts -------------------------------------
      assert.strictEqual(applicability.repeatGroupCount, 1);
      assert.deepStrictEqual(applicability.repeatGroups.map((group) => ({
        groupKey: group.groupKey,
        callOrdinals: group.callOrdinals,
        stages: group.stages,
      })), [{
        groupKey: "e9c03049d436f6f2|MT5|evilHero|9|10",
        callOrdinals: [1, 2, 4],
        stages: ["attack-blocked", "attack-blocked", "lethal"],
      }]);
      assert.deepStrictEqual(
        applicability.preChargeComparisons.map((entry) => entry.callOrdinal),
        [1, 2, 4, 3, 5],
      );
      assert.strictEqual(
        applicability.preChargeComparisons.map((entry) => entry.classification).join(","),
        "FIRST-SEEN,SAME-STAGE-METRIC-TIE-CONTEXT-ONLY,STAGE-PROGRESS,FIRST-SEEN,FIRST-SEEN",
      );
      assert.deepStrictEqual(
        applicability.preChargeComparisons.map((entry) => entry.stage),
        ["attack-blocked", "attack-blocked", "lethal", "attack-blocked", "lethal"],
      );
      assert.strictEqual(
        applicability.verdict,
        "TRACE-LOCAL-STAGE-CONDITIONAL-NONIMPROVING-RETRY-OBSERVED",
      );
      assert.deepStrictEqual(applicability.productiveFlaggedCallOrdinals, []);
      assert.deepStrictEqual(applicability.nonProductiveFlaggedCallOrdinals, [2]);
      assert.deepStrictEqual(applicability.incompleteCallOrdinals, []);
      assert.deepStrictEqual(applicability.missingEvaluationCallOrdinals, []);
      // The whole frozen trace is NOT-APPLICABLE, never unexpectedly missing:
      // this is the PR-5.19w answer to the PR-5.19v EVIDENCE-INCOMPLETE result.
      assert.deepStrictEqual(
        applicability.preChargeComparisons.flatMap((entry) =>
          (entry.pairwiseComparisons || []).flatMap((pair) => pair.unexpectedMissingMetrics)),
        [],
      );
      const applicabilityComparison2 = applicability.preChargeComparisons.find(
        (entry) => entry.callOrdinal === 2,
      );
      assert.ok(applicabilityComparison2);
      assert.deepStrictEqual(applicabilityComparison2.decisiveEarlierCallOrdinals, [1]);
      assert.strictEqual(applicabilityComparison2.pairwiseComparisons.length, 1);
      const applicabilityPair2 = applicabilityComparison2.pairwiseComparisons[0];
      assert.strictEqual(applicabilityPair2.stageRelation, "same");
      assert.strictEqual(applicabilityPair2.earlierStage, "attack-blocked");
      assert.strictEqual(applicabilityPair2.currentStage, "attack-blocked");
      assert.strictEqual(applicabilityPair2.classification, "SAME-STAGE-METRIC-TIE-CONTEXT-ONLY");
      assert.deepStrictEqual(
        applicabilityPair2.applicableMetrics,
        ["attackMargin", "sourceTerminalProgressScore", "reachableAtCompileTime"],
      );
      assert.deepStrictEqual(applicabilityPair2.notApplicableMetrics, ["damage", "survivalMargin"]);
      assert.deepStrictEqual(applicabilityPair2.improvedFields, []);
      assert.deepStrictEqual(applicabilityPair2.regressedFields, []);
      assert.deepStrictEqual(applicabilityPair2.contextDifferenceKeys, ["sourceDepth"]);
      assert.strictEqual(applicabilityPair2.exactObservableVectorEqual, false);
      const applicabilityComparison4 = applicability.preChargeComparisons.find(
        (entry) => entry.callOrdinal === 4,
      );
      assert.ok(applicabilityComparison4);
      assert.strictEqual(applicabilityComparison4.classification, "STAGE-PROGRESS");
      assert.deepStrictEqual(applicabilityComparison4.decisiveEarlierCallOrdinals, [1, 2]);
      assert.strictEqual(applicabilityComparison4.pairwiseComparisons.length, 2);
      for (const pair of applicabilityComparison4.pairwiseComparisons) {
        assert.strictEqual(pair.stageRelation, "progress");
        assert.strictEqual(pair.earlierStage, "attack-blocked");
        assert.strictEqual(pair.currentStage, "lethal");
        assert.strictEqual(pair.classification, "STAGE-PROGRESS");
        assert.deepStrictEqual(
          pair.improvedFields,
          ["attackMargin", "sourceTerminalProgressScore"],
        );
        assert.deepStrictEqual(pair.regressedFields, []);
        assert.deepStrictEqual(pair.notApplicableMetrics, ["damage", "survivalMargin"]);
      }
      // Productive root #5 is still FIRST-SEEN under the stage-conditional contract.
      const applicabilityComparison5 = applicability.preChargeComparisons.find(
        (entry) => entry.callOrdinal === 5,
      );
      assert.ok(applicabilityComparison5);
      assert.strictEqual(applicabilityComparison5.classification, "FIRST-SEEN");
      assert.deepStrictEqual(applicabilityComparison5.pairwiseComparisons, []);

      // --- 5.19w pure-helper synthetics ---------------------------------------
      const stageBaseSemantic = {
        prerequisiteKind: "battle-access-prerequisite",
        stageGoal: null,
        parentDependencyKind: "battle-access",
        parentDependencyCapability: null,
        reachableAtCompileTime: false,
        sourceDepth: 0,
        sourceFloor: "MT5",
        beforeStage: "attack-blocked",
        attackMargin: -273,
        damage: null,
        survivalMargin: null,
        sourceTerminalProgressScore: 999999998777,
        compiledCandidateRank: 1,
        compiledCandidateCount: 4,
      };
      const stageLethalSemantic = {
        ...stageBaseSemantic,
        beforeStage: "lethal",
        attackMargin: -173,
        damage: 1978814,
        survivalMargin: -1741823,
      };
      const mkStageCall = (callOrdinal, semantic) => ({
        callOrdinal,
        attemptId: `A${callOrdinal}`,
        prerequisiteId: "P1",
        parentDependencyId: "D1",
        identity: { floorId: "MT5", enemyId: "evilHero", x: 9, y: 10 },
        semantic,
        temporal: { firstHierarchyActivationOccurred: false },
      });
      const stagePair = (earlier, current) => classifyStageConditionalRootRetryComparability(
        [mkStageCall(1, earlier), mkStageCall(2, current)],
      ).comparisons[1];
      const stagePairwise = (earlier, current) => stagePair(earlier, current).pairwiseComparisons[0];

      // attack-blocked same stage: damage/survivalMargin NOT-APPLICABLE, never missing.
      const stageAttackBlockedTie = stagePairwise(
        stageBaseSemantic,
        { ...stageBaseSemantic, sourceDepth: 2 },
      );
      assert.strictEqual(stageAttackBlockedTie.classification, "SAME-STAGE-METRIC-TIE-CONTEXT-ONLY");
      assert.deepStrictEqual(stageAttackBlockedTie.notApplicableMetrics, ["damage", "survivalMargin"]);
      assert.deepStrictEqual(stageAttackBlockedTie.unexpectedMissingMetrics, []);
      assert.deepStrictEqual(
        stageAttackBlockedTie.applicableMetrics,
        ["attackMargin", "sourceTerminalProgressScore", "reachableAtCompileTime"],
      );
      assert.deepStrictEqual(stageAttackBlockedTie.contextDifferenceKeys, ["sourceDepth"]);
      // beforeStage is the stage axis now, never a context key.
      assert.ok(!stageAttackBlockedTie.contextDifferenceKeys.includes("beforeStage"));

      // attack-blocked -> lethal/viable = STAGE-PROGRESS; reverse = STAGE-REGRESSION.
      assert.strictEqual(
        stagePairwise(stageBaseSemantic, stageLethalSemantic).classification,
        "STAGE-PROGRESS",
      );
      assert.strictEqual(
        stagePairwise(
          stageBaseSemantic,
          { ...stageLethalSemantic, beforeStage: "viable", survivalMargin: 50 },
        ).classification,
        "STAGE-PROGRESS",
      );
      assert.strictEqual(
        stagePairwise(stageLethalSemantic, stageBaseSemantic).classification,
        "STAGE-REGRESSION",
      );
      assert.strictEqual(
        stagePairwise(stageLethalSemantic, { ...stageLethalSemantic, beforeStage: "viable", survivalMargin: 50 })
          .classification,
        "STAGE-PROGRESS",
      );

      // Same damageable stage: dominance / improvement / mixed / tie.
      assert.strictEqual(
        stagePairwise(stageLethalSemantic, { ...stageLethalSemantic, attackMargin: -400 }).classification,
        "SAME-STAGE-PRIOR-DOMINATES",
      );
      assert.strictEqual(
        stagePairwise(stageLethalSemantic, { ...stageLethalSemantic, attackMargin: -100 }).classification,
        "SAME-STAGE-CURRENT-IMPROVES",
      );
      assert.strictEqual(
        stagePairwise(
          stageLethalSemantic,
          { ...stageLethalSemantic, attackMargin: -100, damage: 2000000 },
        ).classification,
        "SAME-STAGE-MIXED-TRADEOFF",
      );
      assert.strictEqual(
        stagePairwise(stageLethalSemantic, { ...stageLethalSemantic, sourceDepth: 3 }).classification,
        "SAME-STAGE-METRIC-TIE-CONTEXT-ONLY",
      );
      const stageLethalDominance = stagePairwise(
        stageLethalSemantic,
        { ...stageLethalSemantic, attackMargin: -400 },
      );
      assert.deepStrictEqual(stageLethalDominance.notApplicableMetrics, []);
      assert.deepStrictEqual(
        stageLethalDominance.applicableMetrics,
        ["attackMargin", "damage", "survivalMargin", "sourceTerminalProgressScore", "reachableAtCompileTime"],
      );

      // Only a damageable stage can be UNEXPECTED-MISSING for damage.
      const stageUnexpectedMissing = stagePairwise(
        stageLethalSemantic,
        { ...stageLethalSemantic, damage: null, sourceDepth: 1 },
      );
      assert.strictEqual(stageUnexpectedMissing.classification, "UNEXPECTED-MISSING-APPLICABLE-METRIC");
      assert.deepStrictEqual(stageUnexpectedMissing.unexpectedMissingMetrics, ["damage"]);
      assert.strictEqual(
        stagePairwise(stageLethalSemantic, { ...stageLethalSemantic, attackMargin: null }).classification,
        "UNEXPECTED-MISSING-APPLICABLE-METRIC",
      );

      // unsupported never enters an ordered comparison.
      assert.strictEqual(
        stagePairwise(stageBaseSemantic, { ...stageBaseSemantic, beforeStage: "unsupported" }).classification,
        "INCOMPARABLE-UNSUPPORTED",
      );
      assert.strictEqual(
        stagePairwise({ ...stageBaseSemantic, beforeStage: "unsupported" }, stageBaseSemantic).classification,
        "INCOMPARABLE-UNSUPPORTED",
      );
      assert.strictEqual(
        stagePairwise(stageBaseSemantic, { ...stageBaseSemantic, beforeStage: null }).classification,
        "INCOMPARABLE-UNSUPPORTED",
      );
      const stageIncomparable = stagePairwise(
        stageBaseSemantic,
        { ...stageBaseSemantic, beforeStage: "unsupported" },
      );
      assert.deepStrictEqual(stageIncomparable.applicableMetrics, []);
      assert.deepStrictEqual(stageIncomparable.improvedFields, []);
      assert.deepStrictEqual(stageIncomparable.regressedFields, []);

      // Exact observable retry outranks everything, including all-null metrics.
      assert.strictEqual(
        stagePairwise(stageBaseSemantic, { ...stageBaseSemantic }).classification,
        "EXACT-OBSERVABLE-RETRY",
      );
      const stageUnsupportedExact = {
        ...stageBaseSemantic,
        beforeStage: "unsupported",
        attackMargin: null,
        sourceTerminalProgressScore: null,
      };
      assert.strictEqual(
        stagePairwise(stageUnsupportedExact, { ...stageUnsupportedExact }).classification,
        "EXACT-OBSERVABLE-RETRY",
      );

      // Retry-level: a dominance witness outranks a stage-progress witness and
      // keeps full pairwise provenance.
      const stageThreeCalls = classifyStageConditionalRootRetryComparability([
        mkStageCall(1, stageLethalSemantic),
        mkStageCall(2, stageBaseSemantic),
        mkStageCall(3, { ...stageLethalSemantic, attackMargin: -400 }),
      ]);
      const stageRetryThree = stageThreeCalls.comparisons[2];
      assert.strictEqual(stageRetryThree.classification, "SAME-STAGE-PRIOR-DOMINATES");
      assert.deepStrictEqual(stageRetryThree.decisiveEarlierCallOrdinals, [1]);
      assert.strictEqual(stageRetryThree.pairwiseComparisons.length, 2);
      assert.strictEqual(stageRetryThree.pairwiseComparisons[1].classification, "STAGE-PROGRESS");
      assert.deepStrictEqual(
        stageThreeCalls.repeatGroups[0].stages,
        ["lethal", "attack-blocked", "lethal"],
      );
      assert.strictEqual(
        classifyStageConditionalRootRetryComparability([mkStageCall(1, stageBaseSemantic)])
          .comparisons[0].classification,
        "FIRST-SEEN",
      );

      // Offline verdict: productive false-positive wins, audit arrays survive.
      const stageProductivePriority = classifyStageConditionalRootRetryOfflineVerdict(
        [
          { callOrdinal: 1, classification: "INCOMPARABLE-UNSUPPORTED" },
          { callOrdinal: 2, classification: "SAME-STAGE-PRIOR-DOMINATES" },
          { callOrdinal: 3, classification: "STAGE-REGRESSION" },
          { callOrdinal: 4, classification: "EXACT-OBSERVABLE-RETRY" },
        ],
        [{ callOrdinal: 2, productive: true }, { callOrdinal: 3, productive: false }],
      );
      assert.strictEqual(stageProductivePriority.verdict, "PRODUCTIVE-ROOT-WOULD-BE-FLAGGED");
      assert.deepStrictEqual(stageProductivePriority.productiveFlaggedCallOrdinals, [2]);
      assert.deepStrictEqual(stageProductivePriority.nonProductiveFlaggedCallOrdinals, [3]);
      assert.deepStrictEqual(stageProductivePriority.incompleteCallOrdinals, [1]);
      assert.deepStrictEqual(stageProductivePriority.missingEvaluationCallOrdinals, [4]);

      // STAGE-PROGRESS / SAME-STAGE-CURRENT-IMPROVES are never suppression candidates.
      assert.strictEqual(
        classifyStageConditionalRootRetryOfflineVerdict(
          [
            { callOrdinal: 2, classification: "STAGE-PROGRESS" },
            { callOrdinal: 3, classification: "SAME-STAGE-CURRENT-IMPROVES" },
            { callOrdinal: 4, classification: "SAME-STAGE-MIXED-TRADEOFF" },
          ],
          [
            { callOrdinal: 2, productive: false },
            { callOrdinal: 3, productive: false },
            { callOrdinal: 4, productive: false },
          ],
        ).verdict,
        "NO-STAGE-CONDITIONAL-NONIMPROVING-RETRY",
      );
      const stageTraceLocal = classifyStageConditionalRootRetryOfflineVerdict(
        [{ callOrdinal: 2, classification: "SAME-STAGE-METRIC-TIE-CONTEXT-ONLY" }],
        [{ callOrdinal: 2, productive: false }],
      );
      assert.strictEqual(
        stageTraceLocal.verdict,
        "TRACE-LOCAL-STAGE-CONDITIONAL-NONIMPROVING-RETRY-OBSERVED",
      );
      assert.deepStrictEqual(stageTraceLocal.nonProductiveFlaggedCallOrdinals, [2]);

      // Fail-closed linkage: missing / duplicate / non-boolean evaluation.
      [
        [],
        [{ callOrdinal: 2, productive: "false" }],
        [{ callOrdinal: 2, productive: false }, { callOrdinal: 2, productive: false }],
      ].forEach((evaluation, index) => {
        const failClosed = classifyStageConditionalRootRetryOfflineVerdict(
          [{ callOrdinal: 2, classification: "SAME-STAGE-PRIOR-DOMINATES" }],
          evaluation,
        );
        assert.strictEqual(
          failClosed.verdict,
          "STAGE-CONDITIONAL-EVIDENCE-INCOMPLETE",
          `evaluation case ${index} did not fail closed`,
        );
        assert.deepStrictEqual(failClosed.missingEvaluationCallOrdinals, [2]);
        assert.deepStrictEqual(failClosed.nonProductiveFlaggedCallOrdinals, []);
      });

      // Unexpected-missing / incomparable force incomplete but keep the witness.
      const stageIncompleteKeepsWitness = classifyStageConditionalRootRetryOfflineVerdict(
        [
          { callOrdinal: 1, classification: "UNEXPECTED-MISSING-APPLICABLE-METRIC" },
          { callOrdinal: 2, classification: "SAME-STAGE-PRIOR-DOMINATES" },
        ],
        [{ callOrdinal: 1, productive: false }, { callOrdinal: 2, productive: false }],
      );
      assert.strictEqual(
        stageIncompleteKeepsWitness.verdict,
        "STAGE-CONDITIONAL-EVIDENCE-INCOMPLETE",
      );
      assert.deepStrictEqual(stageIncompleteKeepsWitness.nonProductiveFlaggedCallOrdinals, [2]);
      assert.deepStrictEqual(stageIncompleteKeepsWitness.incompleteCallOrdinals, [1]);
      assert.deepStrictEqual(stageIncompleteKeepsWitness.missingEvaluationCallOrdinals, []);
    }

    if (includeRootRetryShadowCallBudget) {
      const shadowControl = runWithShadowCallBudgetIsolation(false);
      const shadowCandidate = candidate;
      const shadowStripWall = (outcome) => {
        const copy = { ...outcome };
        delete copy.wallMs;
        return copy;
      };
      assert.deepStrictEqual(
        shadowStripWall(shadowCandidate.outcome),
        shadowStripWall(shadowControl.outcome),
        "shadow call-budget observation changed outcome",
      );
      assert.deepStrictEqual(
        shadowCandidate.bestTerminalBlocker,
        shadowControl.bestTerminalBlocker,
        "shadow call-budget observation changed bestTerminalBlocker",
      );
      [
        "totalSearchExpansions",
        "expansions",
        "battleAccessPrerequisiteCalls",
        "rootLevelCalls",
        "continuationDerivedCalls",
        "parentDependencyContinuationNextPrerequisiteCompiled",
        "childPrerequisitesScheduled",
      ].forEach((field) => {
        assert.strictEqual(
          shadowControl.stats[field],
          shadowCandidate.stats[field],
          `${field} changed with shadow call-budget observation`,
        );
      });
      assert.deepStrictEqual(
        shadowCandidate.stats.battleAccessPrerequisiteWitnesses.map((w) => w.attemptId),
        shadowControl.stats.battleAccessPrerequisiteWitnesses.map((w) => w.attemptId),
        "charged witness identities changed with shadow call-budget observation",
      );
      const shadowCompactResiduals = (stats) =>
        stats.survivalOpportunityResidualRecoveries.map((r) => ({
          recoveryIndex: r.recoveryIndex,
          target: r.selectedResidualTarget ? r.selectedResidualTarget.enemyId : null,
          materialized: r.materialized,
          parentContinuationCreated: r.parentContinuationCreated,
        }));
      assert.deepStrictEqual(
        shadowCompactResiduals(shadowCandidate.stats),
        shadowCompactResiduals(shadowControl.stats),
        "residual/materialization results changed with shadow call-budget observation",
      );
      const shadowCompactContinuations = (stats) =>
        stats.parentDependencyContinuationWitnesses.map((w) => ({
          continuationId: w.continuationId,
          status: w.status,
          statusReason: w.statusReason,
          nextPrerequisiteId: w.nextPrerequisiteId == null ? null : w.nextPrerequisiteId,
        }));
      assert.deepStrictEqual(
        shadowCompactContinuations(shadowCandidate.stats),
        shadowCompactContinuations(shadowControl.stats),
        "continuation witnesses changed with shadow call-budget observation",
      );

      assert.strictEqual(shadowControl.stats.rootRetryShadowCallBudgetAttribution, null);
      const shadow = shadowCandidate.stats.rootRetryShadowCallBudgetAttribution;
      assert.ok(shadow);
      assert.strictEqual(
        shadow.schema,
        "motapathfinder.strategic-root-retry-shadow-call-budget-attribution.v2",
      );
      // The 5.19w stats must stay untouched unless its own flag is on.
      if (!includeRootRetryMetricApplicability) {
        assert.strictEqual(shadowCandidate.stats.rootRetryMetricApplicabilityAttribution, null);
      }
      assert.ok([
        "PRODUCTIVE-ROOT-WOULD-BE-SHADOW-FLAGGED",
        "SHADOW-CALL-BUDGET-EVIDENCE-INCOMPLETE",
        "TRACE-LOCAL-SHADOW-SLOT-REACHES-CAP-BLOCKED-DERIVED-WORK",
        "SHADOW-SLOT-RECLAIMED-NO-ELIGIBLE-CAP-BLOCK",
        "NO-PRECHARGE-NONIMPROVING-ROOT-RETRY",
      ].includes(shadow.verdict));
      for (const comparison of shadow.preChargeComparisons) {
        const keys = Object.keys(comparison);
        assert.ok(
          !keys.some((key) => /productive|directSatisfied|satisfied|materializ|continuation/i.test(key)),
          `post-hoc field leaked into preChargeComparisons: ${keys.join(",")}`,
        );
      }
      assert.ok(!("rootCompileEvents" in shadow));
      // Timeline must account for every charged call exactly once, and shadow
      // ordinals must be a gap-free 1..N sequence over the surviving calls.
      assert.strictEqual(shadow.actualChargedCallCount, shadow.shadowTimeline.length);
      assert.strictEqual(
        shadow.actualChargedCallCount,
        shadowCandidate.stats.battleAccessPrerequisiteCalls,
      );
      assert.deepStrictEqual(
        shadow.shadowTimeline.map((entry) => entry.callOrdinal),
        shadow.shadowTimeline.map((_entry, index) => index + 1),
      );
      assert.deepStrictEqual(
        shadow.shadowTimeline.filter((entry) => entry.shadowCharged)
          .map((entry) => entry.shadowOrdinal),
        shadow.shadowTimeline.filter((entry) => entry.shadowCharged)
          .map((_entry, index) => index + 1),
      );
      shadow.shadowTimeline.forEach((entry) => {
        assert.strictEqual(
          entry.shadowCharged,
          !shadow.preChargeFlaggedRootCallOrdinals.includes(entry.callOrdinal),
        );
        if (!entry.shadowCharged) assert.strictEqual(entry.shadowOrdinal, null);
      });
      assert.strictEqual(
        shadow.reclaimedSlots,
        shadow.actualChargedCallCount - shadow.shadowChargedCallCount,
      );
      // No call was executed for the shadow: the real ledger is the only ledger.
      assert.strictEqual(shadow.maxCalls, 8);
      assert.ok(shadow.actualChargedCallCount <= shadow.maxCalls);
      for (const event of shadow.continuationSelectionEvents) {
        assert.ok(["boolean"].includes(typeof event.shadowWouldBeSelectable));
        if (event.shadowWouldBeSelectable) {
          assert.strictEqual(event.actualBlockingReason, "call-cap-exhausted");
          assert.ok(event.shadowCapacity > 0);
          assert.ok(event.queuedCount < event.maxOutstanding);
          assert.strictEqual(event.dedupeSeenBeforeSelection, false);
          assert.strictEqual(event.evidenceComplete, true);
        }
        if (event.evidenceComplete) {
          assert.strictEqual(
            event.shadowCallsExecuted,
            event.actualCallsExecuted - event.flaggedBeforeEvent.length,
          );
          assert.strictEqual(
            event.shadowCapacity,
            event.maxCalls - event.shadowCallsExecuted - event.queuedCount,
          );
          event.flaggedBeforeEvent.forEach((callOrdinal) => {
            assert.ok(callOrdinal <= event.actualCallsExecuted);
            assert.ok(shadow.preChargeFlaggedRootCallOrdinals.includes(callOrdinal));
          });
        }
      }

      // --- 5.19x frozen real corpus facts -------------------------------------
      // Repair 1: the real evidence must be clean on every hardened check, so a
      // positive verdict can only come from fully validated evidence.
      assert.strictEqual(shadow.accountingEvidenceComplete, true);
      assert.strictEqual(shadow.evidenceAudit.maxCallsValid, true);
      assert.strictEqual(shadow.evidenceAudit.preChargeComparisonsComplete, true);
      assert.strictEqual(shadow.evidenceAudit.chargedLedgerComplete, true);
      assert.strictEqual(shadow.evidenceAudit.continuationSelectionEventsComplete, true);
      assert.strictEqual(shadow.evidenceAudit.chargedOrdinalsContiguous, true);
      assert.strictEqual(shadow.evidenceAudit.chargedWithinCap, true);
      assert.strictEqual(shadow.evidenceAudit.chargedRemainingConsistent, true);
      assert.strictEqual(shadow.evidenceAudit.chargedExpansionMonotone, true);
      assert.strictEqual(shadow.evidenceAudit.flaggedCallsChargedAtRootLevel, true);
      [
        "invalidPreChargeComparisonIndexes",
        "duplicatePreChargeCallOrdinals",
        "invalidChargedCallIndexes",
        "duplicateChargedCallOrdinals",
        "invalidContinuationSelectionEventIndexes",
        "duplicateContinuationSelectionEventOrdinals",
      ].forEach((field) => {
        assert.deepStrictEqual(shadow.evidenceAudit[field], [], `${field} must be empty`);
      });
      shadow.continuationSelectionEvents.forEach((event) => {
        assert.strictEqual(event.evidenceComplete, true);
        assert.strictEqual(event.accountable, true);
      });
      assert.strictEqual(shadow.maxCalls, 8);
      assert.strictEqual(shadow.actualChargedCallCount, 8);
      assert.strictEqual(shadow.shadowChargedCallCount, 7);
      assert.strictEqual(shadow.reclaimedSlots, 1);
      assert.deepStrictEqual(shadow.preChargeFlaggedRootCallOrdinals, [2]);
      assert.deepStrictEqual(shadow.productiveFlaggedCallOrdinals, []);
      assert.deepStrictEqual(shadow.nonProductiveFlaggedCallOrdinals, [2]);
      assert.deepStrictEqual(shadow.incompleteCallOrdinals, []);
      assert.deepStrictEqual(shadow.missingEvaluationCallOrdinals, []);
      assert.deepStrictEqual(shadow.unchargedFlaggedCallOrdinals, []);
      assert.deepStrictEqual(shadow.evidenceIncompleteEventOrdinals, []);
      // Productive root #5 is never shadow-flagged.
      assert.ok(!shadow.preChargeFlaggedRootCallOrdinals.includes(5));
      assert.strictEqual(
        shadow.preChargeComparisons.find((entry) => entry.callOrdinal === 5).classification,
        "FIRST-SEEN",
      );
      // Real ledger: 5 root calls then 3 derived calls at levels 1/2/3.
      assert.deepStrictEqual(
        shadow.shadowTimeline.map((entry) => entry.hierarchyLevel),
        [0, 0, 0, 0, 0, 1, 2, 3],
      );
      assert.strictEqual(
        shadow.shadowTimeline.filter((entry) => entry.hierarchyLevel === 0).length,
        5,
      );
      assert.strictEqual(
        shadow.shadowTimeline.filter((entry) => entry.hierarchyLevel > 0).length,
        3,
      );
      assert.deepStrictEqual(
        shadow.shadowTimeline.map((entry) => entry.shadowOrdinal),
        [1, null, 2, 3, 4, 5, 6, 7],
      );
      assert.deepStrictEqual(
        shadow.shadowTimeline.map((entry) => entry.shadowCharged),
        [true, false, true, true, true, true, true, true],
      );
      // Four continuation selections happened; only the last one hit the cap.
      assert.strictEqual(shadow.continuationSelectionEvents.length, 4);
      assert.deepStrictEqual(
        shadow.continuationSelectionEvents.map((event) => event.actualSelected),
        [true, true, true, false],
      );
      assert.deepStrictEqual(
        shadow.continuationSelectionEvents.map((event) => event.actualBlockingReason),
        [null, null, null, "call-cap-exhausted"],
      );
      assert.deepStrictEqual(
        shadow.continuationSelectionEvents.map((event) => event.hierarchyLevel),
        [1, 2, 3, 4],
      );
      assert.deepStrictEqual(
        shadow.continuationSelectionEvents.map((event) => event.actualCallsExecuted),
        [5, 6, 7, 8],
      );
      assert.deepStrictEqual(
        shadow.continuationSelectionEvents.map((event) => event.shadowCallsExecuted),
        [4, 5, 6, 7],
      );
      assert.deepStrictEqual(
        shadow.continuationSelectionEvents.map((event) => event.shadowCapacity),
        [4, 3, 2, 1],
      );
      assert.deepStrictEqual(
        shadow.continuationSelectionEvents.map((event) => event.shadowWouldBeSelectable),
        [false, false, false, true],
      );
      const shadowCapBlockedEvent = shadow.continuationSelectionEvents[3];
      assert.strictEqual(shadowCapBlockedEvent.eventOrdinal, 4);
      assert.strictEqual(shadowCapBlockedEvent.queuedCount, 0);
      assert.strictEqual(shadowCapBlockedEvent.maxOutstanding, 1);
      assert.strictEqual(shadowCapBlockedEvent.dedupeSeenBeforeSelection, false);
      assert.strictEqual(shadowCapBlockedEvent.evidenceComplete, true);
      assert.deepStrictEqual(shadowCapBlockedEvent.flaggedBeforeEvent, [2]);
      assert.strictEqual(shadowCapBlockedEvent.continuationId, "859c7785d5c70f85");
      assert.strictEqual(shadowCapBlockedEvent.nextPrerequisiteId, "cb70ef61ad4b231a");
      assert.deepStrictEqual(shadow.shadowSelectableEventOrdinals, [4]);
      assert.deepStrictEqual(shadow.shadowSelectableContinuationIds, ["859c7785d5c70f85"]);
      assert.deepStrictEqual(shadow.shadowSelectableNextPrerequisiteIds, ["cb70ef61ad4b231a"]);
      // ev#2 and ev#4 compile the SAME nextPrerequisiteId, yet dedupe was false at
      // both: the attempt identities differ because the source states differ.
      // Repair 1 keeps that identity instead of collapsing it.
      const shadowEventTwo = shadow.continuationSelectionEvents[1];
      assert.strictEqual(shadowEventTwo.nextPrerequisiteId, "cb70ef61ad4b231a");
      assert.strictEqual(shadowCapBlockedEvent.nextPrerequisiteId, "cb70ef61ad4b231a");
      assert.ok(
        typeof shadowEventTwo.nextPrerequisiteAttemptId === "string" &&
          shadowEventTwo.nextPrerequisiteAttemptId.length > 0,
      );
      assert.ok(
        typeof shadowCapBlockedEvent.nextPrerequisiteAttemptId === "string" &&
          shadowCapBlockedEvent.nextPrerequisiteAttemptId.length > 0,
      );
      assert.notStrictEqual(
        shadowEventTwo.nextPrerequisiteAttemptId,
        shadowCapBlockedEvent.nextPrerequisiteAttemptId,
        "same prerequisite at ev#2/ev#4 must carry distinct source-state attempt ids",
      );
      assert.strictEqual(shadowEventTwo.dedupeSeenBeforeSelection, false);
      assert.strictEqual(shadowCapBlockedEvent.dedupeSeenBeforeSelection, false);
      assert.deepStrictEqual(
        shadow.shadowSelectableNextPrerequisiteAttemptIds,
        [shadowCapBlockedEvent.nextPrerequisiteAttemptId],
      );
      assert.strictEqual(
        shadow.verdict,
        "TRACE-LOCAL-SHADOW-SLOT-REACHES-CAP-BLOCKED-DERIVED-WORK",
      );

      // --- 5.19x Repair 1 pure-helper synthetics --------------------------------
      // Every fabricated ledger/event below is internally consistent with the
      // live gate chain unless the case is specifically testing a contradiction.
      const mkShadowCharged = (count, cap) => Array.from(
        { length: count },
        (_value, index) => ({
          callOrdinal: index + 1,
          hierarchyLevel: index < 5 ? 0 : 1,
          attemptId: `SA${index + 1}`,
          expansionAtCharge: 8 + index * 8,
          callsRemainingAfter: cap - (index + 1),
        }),
      );
      const mkShadowFlag = (callOrdinal) => ({
        callOrdinal,
        classification: "SAME-STAGE-METRIC-TIE-CONTEXT-ONLY",
      });
      const mkShadowEvaluation = (pairs) => pairs.map(([callOrdinal, productive]) => ({
        callOrdinal,
        productive,
      }));
      const mkShadowCapEvent = (overrides) => ({
        eventOrdinal: 1,
        expansionAtSelection: 120,
        continuationId: "SC1",
        hierarchyLevel: 4,
        nextPrerequisiteId: "SP9",
        nextPrerequisiteAttemptId: "SAP9",
        actualCallsExecuted: 8,
        maxCalls: 8,
        queuedCount: 0,
        maxOutstanding: 1,
        dedupeSeenBeforeSelection: false,
        actualSelected: false,
        actualBlockingReason: "call-cap-exhausted",
        ...overrides,
      });
      const buildShadow = (overrides) => buildRootRetryShadowCallBudgetAttribution({
        maxCalls: 8,
        chargedCalls: mkShadowCharged(8, 8),
        preChargeComparisons: [mkShadowFlag(2)],
        postSearchEvaluation: mkShadowEvaluation([[2, false]]),
        continuationSelectionEvents: [mkShadowCapEvent({})],
        ...overrides,
      });

      // Baseline: one flag, cap-blocked event, slot reaches it.
      const shadowReclaim = buildShadow({
        postSearchEvaluation: mkShadowEvaluation([
          [1, false], [2, false], [3, false], [4, false], [5, true],
        ]),
      });
      assert.deepStrictEqual(shadowReclaim.preChargeFlaggedRootCallOrdinals, [2]);
      assert.deepStrictEqual(shadowReclaim.nonProductiveFlaggedCallOrdinals, [2]);
      assert.deepStrictEqual(shadowReclaim.productiveFlaggedCallOrdinals, []);
      assert.strictEqual(shadowReclaim.actualChargedCallCount, 8);
      assert.strictEqual(shadowReclaim.shadowChargedCallCount, 7);
      assert.strictEqual(shadowReclaim.reclaimedSlots, 1);
      assert.strictEqual(shadowReclaim.accountingEvidenceComplete, true);
      assert.deepStrictEqual(
        shadowReclaim.shadowTimeline.map((entry) =>
          [entry.callOrdinal, entry.shadowCharged, entry.shadowOrdinal]),
        [
          [1, true, 1], [2, false, null], [3, true, 2], [4, true, 3],
          [5, true, 4], [6, true, 5], [7, true, 6], [8, true, 7],
        ],
      );
      const shadowReclaimEvent = shadowReclaim.continuationSelectionEvents[0];
      assert.deepStrictEqual(shadowReclaimEvent.flaggedBeforeEvent, [2]);
      assert.strictEqual(shadowReclaimEvent.shadowCallsExecuted, 7);
      assert.strictEqual(shadowReclaimEvent.shadowCapacity, 1);
      assert.strictEqual(shadowReclaimEvent.shadowWouldBeSelectable, true);
      assert.strictEqual(
        shadowReclaim.verdict,
        "TRACE-LOCAL-SHADOW-SLOT-REACHES-CAP-BLOCKED-DERIVED-WORK",
      );
      assert.deepStrictEqual(shadowReclaim.shadowSelectableEventOrdinals, [1]);
      assert.deepStrictEqual(shadowReclaim.shadowSelectableContinuationIds, ["SC1"]);
      assert.deepStrictEqual(shadowReclaim.shadowSelectableNextPrerequisiteIds, ["SP9"]);
      assert.deepStrictEqual(shadowReclaim.shadowSelectableNextPrerequisiteAttemptIds, ["SAP9"]);

      // No flag at all: nothing reclaimed, nothing selectable, evidence still complete.
      const shadowNoFlag = buildShadow({
        preChargeComparisons: [],
        postSearchEvaluation: mkShadowEvaluation([[1, false]]),
      });
      assert.strictEqual(shadowNoFlag.verdict, "NO-PRECHARGE-NONIMPROVING-ROOT-RETRY");
      assert.deepStrictEqual(shadowNoFlag.preChargeFlaggedRootCallOrdinals, []);
      assert.strictEqual(shadowNoFlag.reclaimedSlots, 0);
      assert.strictEqual(shadowNoFlag.shadowChargedCallCount, 8);
      assert.strictEqual(shadowNoFlag.accountingEvidenceComplete, true);
      assert.strictEqual(shadowNoFlag.continuationSelectionEvents[0].shadowCapacity, 0);
      assert.strictEqual(
        shadowNoFlag.continuationSelectionEvents[0].shadowWouldBeSelectable,
        false,
      );

      // LOCKED REGRESSION (a): queued=1 / maxOutstanding=2 leaves capacity at 0
      // even though a slot was reclaimed, so nothing becomes selectable.
      const shadowQueuedOne = buildShadow({
        continuationSelectionEvents: [mkShadowCapEvent({ queuedCount: 1, maxOutstanding: 2 })],
      });
      assert.strictEqual(shadowQueuedOne.reclaimedSlots, 1);
      assert.strictEqual(shadowQueuedOne.accountingEvidenceComplete, true);
      assert.strictEqual(
        shadowQueuedOne.continuationSelectionEvents[0].shadowCallsExecuted,
        7,
      );
      assert.strictEqual(shadowQueuedOne.continuationSelectionEvents[0].shadowCapacity, 0);
      assert.strictEqual(
        shadowQueuedOne.continuationSelectionEvents[0].shadowWouldBeSelectable,
        false,
      );
      assert.strictEqual(shadowQueuedOne.verdict, "SHADOW-SLOT-RECLAIMED-NO-ELIGIBLE-CAP-BLOCK");

      // LOCKED REGRESSION (b): two identical #2 flags must not reclaim twice.
      // Before Repair 1 this produced shadowCalls=6 / capacity=1 and a false
      // positive selectable event.
      const shadowDuplicateFlag = buildShadow({
        preChargeComparisons: [mkShadowFlag(2), mkShadowFlag(2)],
        continuationSelectionEvents: [mkShadowCapEvent({ queuedCount: 1, maxOutstanding: 2 })],
      });
      assert.deepStrictEqual(shadowDuplicateFlag.preChargeFlaggedRootCallOrdinals, [2]);
      assert.deepStrictEqual(
        shadowDuplicateFlag.evidenceAudit.duplicatePreChargeCallOrdinals,
        [2],
      );
      assert.strictEqual(
        shadowDuplicateFlag.evidenceAudit.preChargeComparisonsComplete,
        false,
      );
      assert.deepStrictEqual(
        shadowDuplicateFlag.continuationSelectionEvents[0].flaggedBeforeEvent,
        [2],
      );
      assert.notStrictEqual(
        shadowDuplicateFlag.continuationSelectionEvents[0].shadowCapacity,
        1,
        "duplicate flag must not inflate shadow capacity",
      );
      assert.strictEqual(shadowDuplicateFlag.continuationSelectionEvents[0].shadowCapacity, 0);
      assert.strictEqual(
        shadowDuplicateFlag.continuationSelectionEvents[0].shadowWouldBeSelectable,
        false,
      );
      assert.strictEqual(shadowDuplicateFlag.reclaimedSlots, 1);
      assert.strictEqual(shadowDuplicateFlag.accountingEvidenceComplete, false);
      assert.strictEqual(
        shadowDuplicateFlag.verdict,
        "SHADOW-CALL-BUDGET-EVIDENCE-INCOMPLETE",
      );

      // Strict typing on maxCalls: no coercion of strings/booleans/NaN/negatives.
      ["8", true, NaN, Infinity, -1, 1.5, null, undefined].forEach((badMaxCalls) => {
        const strict = buildShadow({ maxCalls: badMaxCalls });
        assert.strictEqual(
          strict.evidenceAudit.maxCallsValid,
          false,
          `maxCalls ${String(badMaxCalls)} was accepted`,
        );
        assert.strictEqual(strict.maxCalls, null);
        assert.strictEqual(strict.verdict, "SHADOW-CALL-BUDGET-EVIDENCE-INCOMPLETE");
      });

      // Strict typing on event numbers.
      [
        { actualCallsExecuted: "8" },
        { queuedCount: true },
        { maxOutstanding: 0 },
        { maxOutstanding: 1.5 },
        { hierarchyLevel: -1 },
        { expansionAtSelection: NaN },
        { expansionAtSelection: Infinity },
        { eventOrdinal: 0 },
        { eventOrdinal: "1" },
        { maxCalls: "eight" },
      ].forEach((overrides) => {
        const strict = buildShadow({
          continuationSelectionEvents: [mkShadowCapEvent(overrides)],
        });
        assert.deepStrictEqual(
          strict.evidenceAudit.invalidContinuationSelectionEventIndexes,
          [0],
          `event ${JSON.stringify(overrides)} was accepted`,
        );
        assert.strictEqual(strict.continuationSelectionEvents[0].shadowCapacity, null);
        assert.strictEqual(
          strict.continuationSelectionEvents[0].shadowWouldBeSelectable,
          false,
        );
        assert.strictEqual(strict.verdict, "SHADOW-CALL-BUDGET-EVIDENCE-INCOMPLETE");
      });

      // Strict typing on charged ledger entries.
      [
        { callOrdinal: "8" },
        { hierarchyLevel: 1.5 },
        { attemptId: "" },
        { attemptId: 7 },
        { expansionAtCharge: -1 },
        { callsRemainingAfter: NaN },
      ].forEach((overrides) => {
        const ledger = mkShadowCharged(8, 8);
        const strict = buildShadow({
          chargedCalls: [...ledger.slice(0, 7), { ...ledger[7], ...overrides }],
        });
        assert.ok(
          strict.evidenceAudit.invalidChargedCallIndexes.length > 0,
          `charged ${JSON.stringify(overrides)} was accepted`,
        );
        assert.strictEqual(strict.evidenceAudit.chargedLedgerComplete, false);
        // An untrustworthy ledger must not yield any shadow figure at all.
        assert.strictEqual(strict.continuationSelectionEvents[0].shadowCallsExecuted, null);
        assert.strictEqual(strict.continuationSelectionEvents[0].shadowCapacity, null);
        assert.strictEqual(
          strict.continuationSelectionEvents[0].shadowWouldBeSelectable,
          false,
        );
        assert.strictEqual(strict.verdict, "SHADOW-CALL-BUDGET-EVIDENCE-INCOMPLETE");
      });

      // Ledger structure: duplicate ordinal, gap, over-cap, wrong remaining,
      // non-monotone expansion, flag on a derived call, flag never charged.
      const shadowDuplicateCharged = buildShadow({
        chargedCalls: [...mkShadowCharged(8, 8), mkShadowCharged(8, 8)[1]],
      });
      assert.deepStrictEqual(
        shadowDuplicateCharged.evidenceAudit.duplicateChargedCallOrdinals,
        [2],
      );
      assert.strictEqual(
        shadowDuplicateCharged.verdict,
        "SHADOW-CALL-BUDGET-EVIDENCE-INCOMPLETE",
      );
      const shadowLedgerGap = buildShadow({
        chargedCalls: mkShadowCharged(8, 8).filter((call) => call.callOrdinal !== 5),
      });
      assert.strictEqual(shadowLedgerGap.evidenceAudit.chargedOrdinalsContiguous, false);
      assert.strictEqual(shadowLedgerGap.verdict, "SHADOW-CALL-BUDGET-EVIDENCE-INCOMPLETE");
      // Individually well-formed entries, but more of them than the cap allows.
      const shadowOverCap = buildRootRetryShadowCallBudgetAttribution({
        maxCalls: 4,
        chargedCalls: mkShadowCharged(8, 8),
        preChargeComparisons: [mkShadowFlag(2)],
        postSearchEvaluation: mkShadowEvaluation([[2, false]]),
        continuationSelectionEvents: [],
      });
      assert.deepStrictEqual(shadowOverCap.evidenceAudit.invalidChargedCallIndexes, []);
      assert.strictEqual(shadowOverCap.actualChargedCallCount, 8);
      assert.strictEqual(shadowOverCap.evidenceAudit.chargedWithinCap, false);
      assert.strictEqual(shadowOverCap.verdict, "SHADOW-CALL-BUDGET-EVIDENCE-INCOMPLETE");
      const shadowBadRemaining = buildShadow({
        chargedCalls: mkShadowCharged(8, 8).map((call, index) =>
          (index === 3 ? { ...call, callsRemainingAfter: 9 } : call)),
      });
      assert.strictEqual(shadowBadRemaining.evidenceAudit.chargedRemainingConsistent, false);
      assert.strictEqual(shadowBadRemaining.verdict, "SHADOW-CALL-BUDGET-EVIDENCE-INCOMPLETE");
      const shadowNonMonotone = buildShadow({
        chargedCalls: mkShadowCharged(8, 8).map((call, index) =>
          (index === 4 ? { ...call, expansionAtCharge: 1 } : call)),
      });
      assert.strictEqual(shadowNonMonotone.evidenceAudit.chargedExpansionMonotone, false);
      assert.strictEqual(shadowNonMonotone.verdict, "SHADOW-CALL-BUDGET-EVIDENCE-INCOMPLETE");
      const shadowFlaggedDerived = buildShadow({
        preChargeComparisons: [mkShadowFlag(7)],
        postSearchEvaluation: mkShadowEvaluation([[7, false]]),
      });
      assert.strictEqual(
        shadowFlaggedDerived.evidenceAudit.flaggedCallsChargedAtRootLevel,
        false,
      );
      assert.strictEqual(
        shadowFlaggedDerived.verdict,
        "SHADOW-CALL-BUDGET-EVIDENCE-INCOMPLETE",
      );
      const shadowUncharged = buildRootRetryShadowCallBudgetAttribution({
        maxCalls: 8,
        chargedCalls: mkShadowCharged(4, 8),
        preChargeComparisons: [mkShadowFlag(7)],
        postSearchEvaluation: mkShadowEvaluation([[7, false]]),
        continuationSelectionEvents: [],
      });
      assert.deepStrictEqual(shadowUncharged.unchargedFlaggedCallOrdinals, [7]);
      assert.strictEqual(shadowUncharged.evidenceAudit.chargedLedgerComplete, false);
      assert.strictEqual(shadowUncharged.verdict, "SHADOW-CALL-BUDGET-EVIDENCE-INCOMPLETE");

      // Event identity must be present; cap must agree with the ledger cap;
      // ordinals must be unique; callsExecuted must fit the ledger.
      [
        { continuationId: "" },
        { continuationId: null },
        { nextPrerequisiteId: "" },
        { nextPrerequisiteAttemptId: "" },
        { nextPrerequisiteAttemptId: null },
        { maxCalls: 9 },
        { actualCallsExecuted: 9 },
      ].forEach((overrides) => {
        const strict = buildShadow({
          continuationSelectionEvents: [mkShadowCapEvent(overrides)],
        });
        assert.deepStrictEqual(
          strict.evidenceAudit.invalidContinuationSelectionEventIndexes,
          [0],
          `event ${JSON.stringify(overrides)} was accepted`,
        );
        assert.strictEqual(strict.verdict, "SHADOW-CALL-BUDGET-EVIDENCE-INCOMPLETE");
      });
      const shadowDuplicateEvent = buildShadow({
        continuationSelectionEvents: [mkShadowCapEvent({}), mkShadowCapEvent({})],
      });
      assert.deepStrictEqual(
        shadowDuplicateEvent.evidenceAudit.duplicateContinuationSelectionEventOrdinals,
        [1],
      );
      assert.strictEqual(
        shadowDuplicateEvent.verdict,
        "SHADOW-CALL-BUDGET-EVIDENCE-INCOMPLETE",
      );

      // selected/reason and reason/gate-snapshot contradictions all fail closed.
      [
        { actualSelected: true, actualBlockingReason: "call-cap-exhausted" },
        { actualSelected: true, actualBlockingReason: null },
        { actualSelected: true, actualBlockingReason: null, actualCallsExecuted: 5, dedupeSeenBeforeSelection: true },
        { actualSelected: true, actualBlockingReason: null, actualCallsExecuted: 5, queuedCount: 1, maxOutstanding: 1 },
        { actualSelected: false, actualBlockingReason: "mystery-reason" },
        { actualSelected: false, actualBlockingReason: null },
        { actualSelected: false, actualBlockingReason: "call-cap-exhausted", actualCallsExecuted: 5 },
        { actualSelected: false, actualBlockingReason: "outstanding-barrier" },
        {
          actualSelected: false, actualBlockingReason: "outstanding-barrier",
          actualCallsExecuted: 5, queuedCount: 0, maxOutstanding: 1,
        },
        { actualSelected: false, actualBlockingReason: "attempt-deduplicated" },
        {
          actualSelected: false, actualBlockingReason: "attempt-deduplicated",
          actualCallsExecuted: 5, dedupeSeenBeforeSelection: false,
        },
        { actualSelected: false, actualBlockingReason: "no-selection" },
        {
          actualSelected: false, actualBlockingReason: "no-selection",
          actualCallsExecuted: 5, dedupeSeenBeforeSelection: true,
        },
      ].forEach((overrides) => {
        const strict = buildShadow({
          continuationSelectionEvents: [mkShadowCapEvent(overrides)],
        });
        assert.deepStrictEqual(
          strict.evidenceAudit.invalidContinuationSelectionEventIndexes,
          [0],
          `contradictory event ${JSON.stringify(overrides)} was accepted`,
        );
        assert.strictEqual(
          strict.continuationSelectionEvents[0].shadowWouldBeSelectable,
          false,
        );
        assert.strictEqual(strict.verdict, "SHADOW-CALL-BUDGET-EVIDENCE-INCOMPLETE");
      });
      // One consistent snapshot per live gate outcome must still be accepted.
      [
        { actualSelected: true, actualBlockingReason: null, actualCallsExecuted: 5 },
        { actualSelected: false, actualBlockingReason: "call-cap-exhausted", actualCallsExecuted: 8 },
        {
          actualSelected: false, actualBlockingReason: "outstanding-barrier",
          actualCallsExecuted: 5, queuedCount: 1, maxOutstanding: 1,
        },
        {
          actualSelected: false, actualBlockingReason: "attempt-deduplicated",
          actualCallsExecuted: 5, dedupeSeenBeforeSelection: true,
        },
        {
          actualSelected: false, actualBlockingReason: "no-selection",
          actualCallsExecuted: 7, queuedCount: 1, maxOutstanding: 2,
        },
      ].forEach((overrides) => {
        const consistent = buildShadow({
          continuationSelectionEvents: [mkShadowCapEvent(overrides)],
        });
        assert.deepStrictEqual(
          consistent.evidenceAudit.invalidContinuationSelectionEventIndexes,
          [],
          `consistent event ${JSON.stringify(overrides)} was rejected`,
        );
        assert.strictEqual(consistent.accountingEvidenceComplete, true);
      });

      // Unknown / malformed pre-charge classification is schema drift.
      const shadowUnknownClass = buildShadow({
        preChargeComparisons: [
          mkShadowFlag(2),
          { callOrdinal: 3, classification: "SOMETHING-NEW" },
        ],
      });
      assert.deepStrictEqual(
        shadowUnknownClass.evidenceAudit.invalidPreChargeComparisonIndexes,
        [1],
      );
      assert.strictEqual(
        shadowUnknownClass.evidenceAudit.preChargeComparisonsComplete,
        false,
      );
      assert.strictEqual(
        shadowUnknownClass.verdict,
        "SHADOW-CALL-BUDGET-EVIDENCE-INCOMPLETE",
      );
      const shadowBadComparisonOrdinal = buildShadow({
        preChargeComparisons: [
          mkShadowFlag(2),
          { callOrdinal: "3", classification: "FIRST-SEEN" },
        ],
      });
      assert.deepStrictEqual(
        shadowBadComparisonOrdinal.evidenceAudit.invalidPreChargeComparisonIndexes,
        [1],
      );

      // A flag charged AFTER the event cannot free a slot for that event.
      const shadowLaterFlag = buildShadow({
        preChargeComparisons: [mkShadowFlag(5)],
        postSearchEvaluation: mkShadowEvaluation([[5, false]]),
        continuationSelectionEvents: [mkShadowCapEvent({
          actualCallsExecuted: 4,
          actualSelected: false,
          actualBlockingReason: "no-selection",
          queuedCount: 4,
          maxOutstanding: 5,
        })],
      });
      assert.strictEqual(shadowLaterFlag.accountingEvidenceComplete, true);
      assert.deepStrictEqual(
        shadowLaterFlag.continuationSelectionEvents[0].flaggedBeforeEvent,
        [],
      );
      assert.strictEqual(
        shadowLaterFlag.continuationSelectionEvents[0].shadowCallsExecuted,
        4,
      );
      assert.strictEqual(
        shadowLaterFlag.continuationSelectionEvents[0].shadowWouldBeSelectable,
        false,
      );

      // Outstanding and dedupe barriers are never reclaimable.
      const shadowOutstanding = buildShadow({
        continuationSelectionEvents: [mkShadowCapEvent({
          actualCallsExecuted: 5,
          queuedCount: 1,
          maxOutstanding: 1,
          actualBlockingReason: "outstanding-barrier",
        })],
      });
      assert.strictEqual(
        shadowOutstanding.continuationSelectionEvents[0].shadowWouldBeSelectable,
        false,
      );
      assert.strictEqual(
        shadowOutstanding.verdict,
        "SHADOW-SLOT-RECLAIMED-NO-ELIGIBLE-CAP-BLOCK",
      );
      const shadowDedupeBarrier = buildShadow({
        continuationSelectionEvents: [mkShadowCapEvent({ dedupeSeenBeforeSelection: true })],
      });
      assert.strictEqual(
        shadowDedupeBarrier.continuationSelectionEvents[0].shadowWouldBeSelectable,
        false,
      );
      assert.strictEqual(
        shadowDedupeBarrier.verdict,
        "SHADOW-SLOT-RECLAIMED-NO-ELIGIBLE-CAP-BLOCK",
      );

      // Fail-closed post-search linkage: missing / duplicate / non-boolean.
      [
        [],
        mkShadowEvaluation([[2, false], [2, false]]),
        [{ callOrdinal: 2, productive: "false" }],
      ].forEach((evaluation, index) => {
        const failClosed = buildShadow({ postSearchEvaluation: evaluation });
        assert.strictEqual(
          failClosed.verdict,
          "SHADOW-CALL-BUDGET-EVIDENCE-INCOMPLETE",
          `shadow evaluation case ${index} did not fail closed`,
        );
        assert.deepStrictEqual(failClosed.missingEvaluationCallOrdinals, [2]);
        assert.deepStrictEqual(failClosed.nonProductiveFlaggedCallOrdinals, []);
      });
      const shadowPreChargeIncomplete = buildShadow({
        preChargeComparisons: [
          { callOrdinal: 3, classification: "UNEXPECTED-MISSING-APPLICABLE-METRIC" },
          mkShadowFlag(2),
        ],
      });
      assert.strictEqual(
        shadowPreChargeIncomplete.verdict,
        "SHADOW-CALL-BUDGET-EVIDENCE-INCOMPLETE",
      );
      assert.deepStrictEqual(shadowPreChargeIncomplete.incompleteCallOrdinals, [3]);
      assert.deepStrictEqual(
        shadowPreChargeIncomplete.nonProductiveFlaggedCallOrdinals,
        [2],
      );

      // Productive false-positive keeps the top priority even with dirty evidence.
      const shadowProductive = buildShadow({
        preChargeComparisons: [
          mkShadowFlag(2),
          mkShadowFlag(2),
          { callOrdinal: 5, classification: "EXACT-OBSERVABLE-RETRY" },
        ],
        postSearchEvaluation: mkShadowEvaluation([[2, false], [5, true]]),
      });
      assert.strictEqual(shadowProductive.verdict, "PRODUCTIVE-ROOT-WOULD-BE-SHADOW-FLAGGED");
      assert.deepStrictEqual(shadowProductive.productiveFlaggedCallOrdinals, [5]);
      assert.deepStrictEqual(shadowProductive.nonProductiveFlaggedCallOrdinals, [2]);

      // Inputs must never be sorted or otherwise mutated; the internal copy is
      // what gets ordered.
      const shadowUnsorted = [
        mkShadowCharged(3, 8)[2], mkShadowCharged(3, 8)[0], mkShadowCharged(3, 8)[1],
      ];
      const shadowComparisonsInput = [mkShadowFlag(2)];
      const shadowEvaluationInput = mkShadowEvaluation([[2, false]]);
      const shadowEventsInput = [mkShadowCapEvent({})];
      const shadowInputSnapshot = JSON.stringify([
        shadowUnsorted, shadowComparisonsInput, shadowEvaluationInput, shadowEventsInput,
      ]);
      const shadowUnsortedResult = buildRootRetryShadowCallBudgetAttribution({
        maxCalls: 8,
        chargedCalls: shadowUnsorted,
        preChargeComparisons: shadowComparisonsInput,
        postSearchEvaluation: shadowEvaluationInput,
        continuationSelectionEvents: shadowEventsInput,
      });
      assert.strictEqual(
        JSON.stringify([
          shadowUnsorted, shadowComparisonsInput, shadowEvaluationInput, shadowEventsInput,
        ]),
        shadowInputSnapshot,
        "shadow helper mutated its inputs",
      );
      assert.deepStrictEqual(
        shadowUnsortedResult.shadowTimeline.map((entry) => entry.callOrdinal),
        [1, 2, 3],
      );
      assert.deepStrictEqual(
        shadowUnsortedResult.shadowTimeline.map((entry) => entry.shadowOrdinal),
        [1, null, 2],
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
      compactRootAttemptSeparabilityAttribution: includeRootAttemptSeparability
        ? (() => {
          const full = candidate.stats.rootAttemptSeparabilityAttribution;
          if (!full) return null;
          const compact = {
            schema: full.schema,
            rootCompileEventCount: full.rootCompileEvents.length,
            capturedCandidateCount: full.rootCompileEvents.reduce(
              (sum, event) => sum + event.candidates.length,
              0,
            ),
            chargedEventSummaries: full.chargedEventSummaries,
            rootCalls: full.rootCalls.map((entry) => ({
              callOrdinal: entry.callOrdinal,
              attemptId: entry.attemptId,
              identity: entry.identity,
              label: entry.label,
              semantic: entry.semantic,
              temporal: {
                expansionAtCharge: entry.temporal.expansionAtCharge,
                callsRemainingAfter: entry.temporal.callsRemainingAfter,
              },
            })),
            separability: full.separability,
            availability: full.availability,
          };
          assert.ok(!("rootCompileEvents" in compact));
          assert.ok(!("candidates" in compact));
          assert.ok(
            !compact.rootCalls.some((entry) => "rootCompileEvents" in entry),
            "compact rootCalls must not carry raw compile events",
          );
          const compactLength = JSON.stringify(compact).length;
          assert.ok(
            compactLength < 20000,
            `compactRootAttemptSeparabilityAttribution too large: ${compactLength}`,
          );
          return compact;
        })()
        : null,
      compactRootRetryNoveltyAttribution: includeRootRetryNovelty
        ? (() => {
          const full = candidate.stats.rootRetryNoveltyAttribution;
          if (!full) return null;
          const beforeStable = JSON.stringify(full);
          const compact = {
            schema: full.schema,
            rootCallCount: full.rootCallCount,
            repeatGroupCount: full.repeatGroupCount,
            comparisons: full.preChargeComparisons.map((entry) => ({
              callOrdinal: entry.callOrdinal,
              attemptId: entry.attemptId,
              groupKey: entry.groupKey,
              classification: entry.classification,
              improvedFields: entry.improvedFields,
              regressedFields: entry.regressedFields,
              missingFields: [...entry.missingFields],
              contextDifferenceKeys: entry.contextDifferenceKeys,
              exactSemanticEqual: entry.exactSemanticEqual,
              comparedCallOrdinals: entry.comparedCallOrdinals,
              decisiveEarlierCallOrdinals: entry.decisiveEarlierCallOrdinals,
              pairwiseComparisons: (entry.pairwiseComparisons || []).map((pair) => ({
                earlierCallOrdinal: pair.earlierCallOrdinal,
                classification: pair.classification,
                improvedFields: pair.improvedFields,
                regressedFields: pair.regressedFields,
                missingFields: [...pair.missingFields],
                exactSemanticEqual: pair.exactSemanticEqual,
              })),
            })),
            postSearchEvaluation: full.postSearchEvaluation,
            verdict: full.verdict,
            productiveFlaggedCallOrdinals: [...full.productiveFlaggedCallOrdinals],
            nonProductiveFlaggedCallOrdinals: [...full.nonProductiveFlaggedCallOrdinals],
            incompleteCallOrdinals: [...full.incompleteCallOrdinals],
            missingEvaluationCallOrdinals: [...full.missingEvaluationCallOrdinals],
          };
          assert.ok(!("rootCompileEvents" in compact));
          assert.ok(!("candidates" in compact));
          assert.strictEqual(JSON.stringify(full), beforeStable);
          const compactLength = JSON.stringify(compact).length;
          assert.ok(
            compactLength < 20000,
            `compactRootRetryNoveltyAttribution too large: ${compactLength}`,
          );
          return compact;
        })()
        : null,
      compactRootRetryMetricApplicabilityAttribution: includeRootRetryMetricApplicability
        ? (() => {
          const full = candidate.stats.rootRetryMetricApplicabilityAttribution;
          if (!full) return null;
          const beforeStable = JSON.stringify(full);
          const compact = {
            schema: full.schema,
            rootCallCount: full.rootCallCount,
            repeatGroupCount: full.repeatGroupCount,
            repeatGroups: full.repeatGroups.map((group) => ({
              groupKey: group.groupKey,
              callOrdinals: [...group.callOrdinals],
              stages: [...group.stages],
            })),
            comparisons: full.preChargeComparisons.map((entry) => ({
              callOrdinal: entry.callOrdinal,
              attemptId: entry.attemptId,
              groupKey: entry.groupKey,
              stage: entry.stage,
              classification: entry.classification,
              comparedCallOrdinals: entry.comparedCallOrdinals,
              decisiveEarlierCallOrdinals: entry.decisiveEarlierCallOrdinals,
              pairwiseComparisons: (entry.pairwiseComparisons || []).map((pair) => ({
                earlierCallOrdinal: pair.earlierCallOrdinal,
                earlierStage: pair.earlierStage,
                currentStage: pair.currentStage,
                stageRelation: pair.stageRelation,
                classification: pair.classification,
                applicableMetrics: [...pair.applicableMetrics],
                notApplicableMetrics: [...pair.notApplicableMetrics],
                unexpectedMissingMetrics: [...pair.unexpectedMissingMetrics],
                improvedFields: [...pair.improvedFields],
                regressedFields: [...pair.regressedFields],
                contextDifferenceKeys: [...pair.contextDifferenceKeys],
                exactObservableVectorEqual: pair.exactObservableVectorEqual,
              })),
            })),
            postSearchEvaluation: full.postSearchEvaluation,
            verdict: full.verdict,
            productiveFlaggedCallOrdinals: [...full.productiveFlaggedCallOrdinals],
            nonProductiveFlaggedCallOrdinals: [...full.nonProductiveFlaggedCallOrdinals],
            incompleteCallOrdinals: [...full.incompleteCallOrdinals],
            missingEvaluationCallOrdinals: [...full.missingEvaluationCallOrdinals],
          };
          assert.ok(!("rootCompileEvents" in compact));
          assert.ok(!("candidates" in compact));
          assert.strictEqual(JSON.stringify(full), beforeStable);
          const compactLength = JSON.stringify(compact).length;
          assert.ok(
            compactLength < 20000,
            `compactRootRetryMetricApplicabilityAttribution too large: ${compactLength}`,
          );
          return compact;
        })()
        : null,
      compactRootRetryShadowCallBudgetAttribution: includeRootRetryShadowCallBudget
        ? (() => {
          const full = candidate.stats.rootRetryShadowCallBudgetAttribution;
          if (!full) return null;
          const beforeStable = JSON.stringify(full);
          const compact = {
            schema: full.schema,
            maxCalls: full.maxCalls,
            rootCallCount: full.rootCallCount,
            repeatGroupCount: full.repeatGroupCount,
            actualChargedCallCount: full.actualChargedCallCount,
            shadowChargedCallCount: full.shadowChargedCallCount,
            reclaimedSlots: full.reclaimedSlots,
            preChargeFlaggedRootCallOrdinals: [...full.preChargeFlaggedRootCallOrdinals],
            productiveFlaggedCallOrdinals: [...full.productiveFlaggedCallOrdinals],
            nonProductiveFlaggedCallOrdinals: [...full.nonProductiveFlaggedCallOrdinals],
            incompleteCallOrdinals: [...full.incompleteCallOrdinals],
            missingEvaluationCallOrdinals: [...full.missingEvaluationCallOrdinals],
            unchargedFlaggedCallOrdinals: [...full.unchargedFlaggedCallOrdinals],
            evidenceIncompleteEventOrdinals: [...full.evidenceIncompleteEventOrdinals],
            accountingEvidenceComplete: full.accountingEvidenceComplete,
            evidenceAudit: {
              maxCallsValid: full.evidenceAudit.maxCallsValid,
              preChargeComparisonsComplete: full.evidenceAudit.preChargeComparisonsComplete,
              chargedLedgerComplete: full.evidenceAudit.chargedLedgerComplete,
              continuationSelectionEventsComplete:
                full.evidenceAudit.continuationSelectionEventsComplete,
              chargedOrdinalsContiguous: full.evidenceAudit.chargedOrdinalsContiguous,
              chargedWithinCap: full.evidenceAudit.chargedWithinCap,
              chargedRemainingConsistent: full.evidenceAudit.chargedRemainingConsistent,
              chargedExpansionMonotone: full.evidenceAudit.chargedExpansionMonotone,
              flaggedCallsChargedAtRootLevel: full.evidenceAudit.flaggedCallsChargedAtRootLevel,
              invalidPreChargeComparisonIndexes:
                [...full.evidenceAudit.invalidPreChargeComparisonIndexes],
              duplicatePreChargeCallOrdinals:
                [...full.evidenceAudit.duplicatePreChargeCallOrdinals],
              invalidChargedCallIndexes: [...full.evidenceAudit.invalidChargedCallIndexes],
              duplicateChargedCallOrdinals: [...full.evidenceAudit.duplicateChargedCallOrdinals],
              invalidContinuationSelectionEventIndexes:
                [...full.evidenceAudit.invalidContinuationSelectionEventIndexes],
              duplicateContinuationSelectionEventOrdinals:
                [...full.evidenceAudit.duplicateContinuationSelectionEventOrdinals],
            },
            preChargeClassifications: full.preChargeComparisons.map((entry) => ({
              callOrdinal: entry.callOrdinal,
              stage: entry.stage,
              classification: entry.classification,
            })),
            shadowTimeline: full.shadowTimeline.map((entry) => ({
              callOrdinal: entry.callOrdinal,
              hierarchyLevel: entry.hierarchyLevel,
              attemptId: entry.attemptId,
              expansionAtCharge: entry.expansionAtCharge,
              callsRemainingAfter: entry.callsRemainingAfter,
              shadowCharged: entry.shadowCharged,
              shadowOrdinal: entry.shadowOrdinal,
            })),
            continuationSelectionEvents: full.continuationSelectionEvents.map((event) => ({
              eventOrdinal: event.eventOrdinal,
              expansionAtSelection: event.expansionAtSelection,
              continuationId: event.continuationId,
              hierarchyLevel: event.hierarchyLevel,
              nextPrerequisiteId: event.nextPrerequisiteId,
              nextPrerequisiteAttemptId: event.nextPrerequisiteAttemptId,
              actualCallsExecuted: event.actualCallsExecuted,
              queuedCount: event.queuedCount,
              maxOutstanding: event.maxOutstanding,
              dedupeSeenBeforeSelection: event.dedupeSeenBeforeSelection,
              actualSelected: event.actualSelected,
              actualBlockingReason: event.actualBlockingReason,
              evidenceComplete: event.evidenceComplete,
              accountable: event.accountable,
              flaggedBeforeEvent: [...event.flaggedBeforeEvent],
              shadowCallsExecuted: event.shadowCallsExecuted,
              shadowCapacity: event.shadowCapacity,
              shadowWouldBeSelectable: event.shadowWouldBeSelectable,
            })),
            shadowSelectableEventOrdinals: [...full.shadowSelectableEventOrdinals],
            shadowSelectableContinuationIds: [...full.shadowSelectableContinuationIds],
            shadowSelectableNextPrerequisiteIds: [...full.shadowSelectableNextPrerequisiteIds],
            shadowSelectableNextPrerequisiteAttemptIds:
              [...full.shadowSelectableNextPrerequisiteAttemptIds],
            postSearchEvaluation: full.postSearchEvaluation,
            verdict: full.verdict,
          };
          assert.ok(!("rootCompileEvents" in compact));
          assert.ok(!("candidates" in compact));
          assert.ok(!("preChargeComparisons" in compact));
          assert.strictEqual(JSON.stringify(full), beforeStable);
          const compactLength = JSON.stringify(compact).length;
          assert.ok(
            compactLength < 20000,
            `compactRootRetryShadowCallBudgetAttribution too large: ${compactLength}`,
          );
          return compact;
        })()
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
