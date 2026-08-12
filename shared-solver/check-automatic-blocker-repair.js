"use strict";

/** TEST GRADE: real-fixture-plus-counterfactual-access */

const assert = require("node:assert");
const path = require("node:path");

const {
  compileAutomaticBlockerRepairs,
  compileRepairDependencyPlan,
} = require("./lib/automatic-blocker-repair");
const { buildDependencyContext, runDependencyFeedback } = require("./lib/dependency-feedback-controller");
const { readBlindGoal } = require("./lib/blind-discovery-baseline");
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
  const report = compileAutomaticBlockerRepairs(project, terminalGoal, portfolio.checkpoints, {
    towerId: "onlyup",
    excludeTargetNodeId: "MT5:item:11,5:I894",
    candidateLimit: 512,
  });
  assert.strictEqual(report.inputContract.knownRouteUsed, false);
  assert.ok(report.candidateCount > 100);
  assert.ok(report.candidatesEvaluatedForAccess > 1);
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
