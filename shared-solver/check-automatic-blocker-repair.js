"use strict";

/** TEST GRADE: real-fixture-plus-counterfactual-access */

const assert = require("node:assert");
const path = require("node:path");

const {
  blockerProjectionFingerprint,
  compileAutomaticBlockerRepairs,
  compileRepairDependencyPlan,
  counterfactualCombatReward,
  makeRepairCompilationCache,
  repairProjectionFingerprint,
} = require("./lib/automatic-blocker-repair");
const { buildDependencyContext, runDependencyFeedback } = require("./lib/dependency-feedback-controller");
const { makeBlindSimulator, readBlindGoal } = require("./lib/blind-discovery-baseline");
const {
  executeLocalDependency,
  materializeDirectTargetPlan,
} = require("./lib/local-dependency-executor");
const { loadProject } = require("./lib/project-loader");
const { createMt5EntryState, detachCheckpoint } = require("./qualify-blind-discovery");

const ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");
const GOAL_FILE = path.join(__dirname, "blind-goals", "onlyup-mt5-blueking.json");

function buildBlockedPortfolio(project, terminalGoal, initialState) {
  const context = buildDependencyContext(project, initialState, terminalGoal, { towerId: "onlyup" });
  const first = executeLocalDependency(project, PROJECT_ROOT, initialState, context.plan, {
    maxExpansions: 64,
    candidateLimit: 8,
  });
  const firstFeedback = runDependencyFeedback(project, PROJECT_ROOT, terminalGoal, first, {
    towerId: "onlyup",
    maxExpansions: 32,
    candidateLimit: 8,
  });
  assert.ok(firstFeedback.nextExecution);
  const blocked = runDependencyFeedback(
    project,
    PROJECT_ROOT,
    terminalGoal,
    firstFeedback.nextExecution,
    { towerId: "onlyup", maxExpansions: 32, candidateLimit: 8 },
  );
  assert.strictEqual(blocked.selection, null);
  return firstFeedback.nextExecution;
}

function main() {
  const project = loadProject(PROJECT_ROOT);
  const terminalGoal = readBlindGoal(GOAL_FILE).goal;
  const initialState = detachCheckpoint(createMt5EntryState(project));
  const portfolio = buildBlockedPortfolio(project, terminalGoal, initialState);
  const blockerBase = {
    target: { floorId: "MT5", x: 9, y: 10, tileId: "evilHero", role: "combat-gate-candidate" },
    evidence: { status: "lethal-at-current-hp", damage: 1000, currentHp: 500 },
  };
  assert.strictEqual(
    blockerProjectionFingerprint(blockerBase),
    blockerProjectionFingerprint({
      target: { ...blockerBase.target, x: 2, y: 8 },
      evidence: { ...blockerBase.evidence },
    }),
  );
  assert.notStrictEqual(
    blockerProjectionFingerprint(blockerBase),
    blockerProjectionFingerprint({
      target: { ...blockerBase.target, x: 2, y: 8 },
      evidence: { ...blockerBase.evidence, damage: 999 },
    }),
  );
  const projectionSimulator = makeBlindSimulator(project);
  const projectionState = portfolio.checkpoints[0].state;
  const reachable = Object.values(projectionSimulator.getWalkReachability(projectionState).visited)
    .find((entry) => entry.x !== projectionState.hero.loc.x || entry.y !== projectionState.hero.loc.y);
  assert.ok(reachable);
  const relocated = JSON.parse(JSON.stringify(projectionState));
  relocated.hero.loc.x = reachable.x;
  relocated.hero.loc.y = reachable.y;
  relocated.flags.__leaveLoc__ = {
    ...(relocated.flags.__leaveLoc__ || {}),
    [relocated.floorId]: { x: reachable.x, y: reachable.y, direction: "left" },
  };
  assert.notStrictEqual(portfolio.checkpoints[0].exactStateFingerprint, "");
  assert.strictEqual(
    repairProjectionFingerprint(projectionState),
    repairProjectionFingerprint(relocated),
  );
  const relevantFlagChange = JSON.parse(JSON.stringify(relocated));
  relevantFlagChange.flags.hatred = Number(relevantFlagChange.flags.hatred || 0) + 1;
  assert.notStrictEqual(
    repairProjectionFingerprint(projectionState),
    repairProjectionFingerprint(relevantFlagChange),
  );
  const visitedFloorChange = JSON.parse(JSON.stringify(relocated));
  visitedFloorChange.visitedFloors.__semantic_control__ = true;
  assert.notStrictEqual(
    repairProjectionFingerprint(projectionState),
    repairProjectionFingerprint(visitedFloorChange),
  );
  const compilationCache = makeRepairCompilationCache();
  const report = compileAutomaticBlockerRepairs(project, terminalGoal, portfolio.checkpoints, {
    towerId: "onlyup",
    excludeTargetNodeId: "MT5:item:11,5:I894",
    candidateLimit: 512,
    compilationCache,
  });
  assert.strictEqual(report.inputContract.knownRouteUsed, false);
  assert.ok(report.candidateCount > 100);
  assert.ok(report.candidatesEvaluatedForAccess > 1);
  assert.strictEqual(
    report.compilationCost.graphBuildCount + report.compilationCost.checkpointAnalysisCacheHits,
    8,
  );
  assert.ok(report.compilationCost.checkpointAnalysisCacheHits > 0);
  assert.strictEqual(report.compilationCost.graphReuseCount, 9);
  assert.strictEqual(report.compilationCost.checkpointCount, 8);
  assert.strictEqual(report.compilationCost.uniqueAccessProbeCount, 9);
  assert.ok(report.compilationCost.wallMs >= 0);
  assert.strictEqual(report.selected.checkpointId, "checkpoint-1");
  assert.strictEqual(report.selected.checkpointRoles.includes("first-goal"), true);
  assert.strictEqual(report.selected.sourceNodeId, "MT5:item:12,11:I1014");
  assert.deepStrictEqual(report.selected.goal, {
    type: "tileRemoved",
    floorId: "MT5",
    x: 12,
    y: 11,
  });
  assert.strictEqual(report.selected.repairs.beforeStatus, "lethal-at-current-hp");
  assert.strictEqual(report.selected.repairs.afterStatus, "lethal-at-current-hp");
  assert.ok(report.selected.repairs.damageReduction > 0);
  assert.ok(report.selected.repairs.survivalMargin < 0);
  assert.strictEqual(report.selected.access.startable, true);
  assert.strictEqual(report.selected.access.alternatives[0].leadingPrerequisiteId, "MT5:enemy:11,11:devilWarrior");
  assert.strictEqual(report.selected.access.alternatives[0].leadingStatus, "viable-at-current-state");
  const cachedRepeat = compileAutomaticBlockerRepairs(project, terminalGoal, portfolio.checkpoints, {
    towerId: "onlyup",
    excludeTargetNodeId: "MT5:item:11,5:I894",
    candidateLimit: 512,
    compilationCache,
  });
  assert.strictEqual(cachedRepeat.selected.experimentKey, report.selected.experimentKey);
  assert.strictEqual(cachedRepeat.candidateCount, report.candidateCount);
  assert.strictEqual(cachedRepeat.compilationCost.graphBuildCount, 0);
  assert.strictEqual(cachedRepeat.compilationCost.checkpointAnalysisCacheHits, 8);
  assert.strictEqual(
    cachedRepeat.compilationCost.accessCacheHits,
    cachedRepeat.compilationCost.uniqueAccessProbeCount,
  );
  const combatRewardState = counterfactualCombatReward(
    project,
    projectionSimulator,
    initialState,
    { floorId: "MT5", x: 8, y: 11, tileId: "skeletonKing", kind: "enemy" },
  );
  assert.ok(combatRewardState);
  assert.ok(combatRewardState.hero.exp > initialState.hero.exp);
  const combatRewardAudit = compileAutomaticBlockerRepairs(
    project,
    terminalGoal,
    portfolio.checkpoints,
    {
      towerId: "onlyup",
      excludeTargetNodeId: "MT5:item:11,5:I894",
      candidateLimit: 5000,
      includeCombatRewardRepairs: true,
    },
  );
  assert.ok(combatRewardAudit.candidateKinds["combat-reward"] > 0);
  const combatProgressCandidate = combatRewardAudit.candidates.find((candidate) =>
    candidate.resourceKind === "combat-reward" && candidate.repairs.levelProgress);
  assert.ok(combatProgressCandidate);
  assert.ok(combatProgressCandidate.repairs.expGain > 0);
  assert.strictEqual(combatRewardAudit.selected.resourceKind, "item");
  const levelProgressControl = compileAutomaticBlockerRepairs(
    project,
    terminalGoal,
    portfolio.checkpoints,
    {
      towerId: "onlyup",
      excludeTargetNodeId: "MT5:item:11,5:I894",
      candidateLimit: 5000,
      includeCombatRewardRepairs: true,
      repairPriorityMode: "level-progress-first",
    },
  );
  assert.strictEqual(
    levelProgressControl.selectionPolicy,
    "level-progress-before-first-goal-and-counterfactual-margin",
  );
  assert.strictEqual(levelProgressControl.selected.resourceKind, "combat-reward");
  assert.strictEqual(levelProgressControl.selected.repairs.levelProgress, true);
  assert.ok(levelProgressControl.selected.repairs.expAfter > 0);
  const immediateMarginControl = compileAutomaticBlockerRepairs(
    project,
    terminalGoal,
    portfolio.checkpoints,
    {
      towerId: "onlyup",
      excludeTargetNodeId: "MT5:item:11,5:I894",
      candidateLimit: 16,
      preferFirstGoalCheckpoint: false,
    },
  );
  assert.strictEqual(immediateMarginControl.selected.checkpointId, "checkpoint-7");
  assert.strictEqual(
    immediateMarginControl.selected.checkpointRoles.includes("first-goal"),
    false,
  );
  assert.strictEqual(immediateMarginControl.selected.sourceNodeId, "MT5:item:12,11:I1014");
  assert.strictEqual(
    immediateMarginControl.selected.repairs.afterStatus,
    "viable-at-current-state",
  );
  assert.ok(immediateMarginControl.selected.repairs.survivalMargin > 0);
  const uncachedControl = compileAutomaticBlockerRepairs(
    project,
    terminalGoal,
    portfolio.checkpoints,
    {
      towerId: "onlyup",
      excludeTargetNodeId: "MT5:item:11,5:I894",
      candidateLimit: 512,
      reuseCheckpointGraph: false,
    },
  );
  assert.strictEqual(uncachedControl.selected.experimentKey, report.selected.experimentKey);
  assert.strictEqual(uncachedControl.candidateCount, report.candidateCount);
  assert.strictEqual(uncachedControl.compilationCost.graphBuildCount, 17);
  assert.strictEqual(uncachedControl.compilationCost.graphReuseCount, 0);
  assert.strictEqual(uncachedControl.compilationCost.checkpointCount, 8);
  assert.strictEqual(uncachedControl.compilationCost.uniqueAccessProbeCount, 9);
  const circular = immediateMarginControl.candidates.find((candidate) =>
    candidate.sourceNodeId === "MT5:item:7,3:I1009" && candidate.checkpointId === "checkpoint-2");
  assert.ok(circular);
  assert.strictEqual(circular.repairs.survivalMargin > report.selected.repairs.survivalMargin, true);
  assert.strictEqual(circular.access.startable, false);
  assert.notStrictEqual(report.selected.sourceNodeId, circular.sourceNodeId);

  const checkpoint = portfolio.checkpoints.find((entry) => entry.id === report.selected.checkpointId);
  const dependency = compileRepairDependencyPlan(project, terminalGoal, checkpoint, report.selected, {
    towerId: "onlyup",
  });
  const plan = materializeDirectTargetPlan(dependency.plan, report.selected);
  const execution = executeLocalDependency(project, PROJECT_ROOT, checkpoint.state, plan, {
    maxExpansions: 32,
    candidateLimit: 8,
  });
  assert.strictEqual(execution.selected.prerequisite.sourceNodeId, "MT5:enemy:11,11:devilWarrior");
  assert.strictEqual(execution.outcome.goalFound, true);
  assert.strictEqual(execution.outcome.firstGoalExpansion, 1);
  assert.strictEqual(execution.checkpointDiversity.allStrictReplay, true);

  const none = compileAutomaticBlockerRepairs(project, terminalGoal, [], { towerId: "onlyup" });
  assert.strictEqual(none.selected, null);
  assert.strictEqual(none.verdict, "NO_AUTOMATIC_BLOCKER_REPAIR_IDENTIFIED");

  process.stdout.write(`${JSON.stringify({
    status: "passed",
    candidateCount: report.candidateCount,
    candidatesEvaluatedForAccess: report.candidatesEvaluatedForAccess,
    rejectedCircularHighBenefit: {
      sourceNodeId: circular.sourceNodeId,
      survivalMargin: circular.repairs.survivalMargin,
      startable: circular.access.startable,
    },
    selected: report.selected,
    immediateMarginControl: {
      checkpointId: immediateMarginControl.selected.checkpointId,
      sourceNodeId: immediateMarginControl.selected.sourceNodeId,
    },
    levelProgressControl: {
      sourceNodeId: levelProgressControl.selected.sourceNodeId,
      resourceKind: levelProgressControl.selected.resourceKind,
      expGain: levelProgressControl.selected.repairs.expGain,
      expAfter: levelProgressControl.selected.repairs.expAfter,
      levelAfter: levelProgressControl.selected.repairs.levelAfter,
      selectionPolicy: levelProgressControl.selectionPolicy,
    },
    graphCompilationComparison: {
      before: uncachedControl.compilationCost,
      after: report.compilationCost,
      selectedExperimentUnchanged: true,
    },
    firstExecution: {
      prerequisiteId: execution.selected.prerequisite.sourceNodeId,
      outcome: execution.outcome,
      strictReplay: execution.checkpointDiversity.allStrictReplay,
    },
    negativeControl: none.verdict,
    verdict: report.verdict,
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main };
