"use strict";

/** TEST GRADE: real-fixture-plus-ab-plus-strict-replay */

const assert = require("node:assert");
const path = require("node:path");

const { buildDependencyContext, runDependencyFeedback } = require("./lib/dependency-feedback-controller");
const { readBlindGoal } = require("./lib/blind-discovery-baseline");
const { executeLocalDependency } = require("./lib/local-dependency-executor");
const { loadProject } = require("./lib/project-loader");
const { createMt5EntryState, detachCheckpoint } = require("./qualify-blind-discovery");

const ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");
const GOAL_FILE = path.join(__dirname, "blind-goals", "onlyup-mt5-blueking.json");

function compactEvaluation(entry) {
  return {
    checkpointId: entry.checkpointId,
    roles: entry.roles,
    canAdvance: entry.canAdvance,
    feedbackClass: entry.feedbackClass,
    selectedAlternative: entry.selectedAlternative,
  };
}

function main() {
  const project = loadProject(PROJECT_ROOT);
  const terminalGoal = readBlindGoal(GOAL_FILE).goal;
  const initialState = detachCheckpoint(createMt5EntryState(project));
  const context = buildDependencyContext(project, initialState, terminalGoal, { towerId: "onlyup" });
  const local = executeLocalDependency(project, PROJECT_ROOT, initialState, context.plan, {
    maxExpansions: 64,
    candidateLimit: 8,
  });
  assert.strictEqual(local.verdict, "LOCAL_DEPENDENCY_MULTI_ROLE_CHECKPOINTS_VERIFIED");

  const singleCheckpoint = {
    ...local,
    checkpoints: [local.checkpoints[0]],
  };
  const before = runDependencyFeedback(project, PROJECT_ROOT, terminalGoal, singleCheckpoint, {
    towerId: "onlyup",
    maxExpansions: 32,
    candidateLimit: 8,
  });
  assert.strictEqual(before.baseline.checkpointId, "checkpoint-1");
  assert.strictEqual(before.baseline.canAdvance, false);
  assert.strictEqual(before.selection, null);
  assert.strictEqual(before.nextExecution, null);
  assert.strictEqual(before.verdict, "DEPENDENCY_FEEDBACK_REQUIRES_NEW_SUBGOAL");

  const after = runDependencyFeedback(project, PROJECT_ROOT, terminalGoal, local, {
    towerId: "onlyup",
    maxExpansions: 32,
    candidateLimit: 8,
  });
  assert.strictEqual(after.baseline.canAdvance, false);
  assert.strictEqual(after.selection.checkpointId, "checkpoint-5");
  assert.deepStrictEqual(after.selection.roles, ["highest-mdef"]);
  assert.strictEqual(after.selection.changedCheckpoint, true);
  assert.strictEqual(after.selection.changedAlternative, true);
  assert.strictEqual(after.selection.alternative.alternativeId, "alternative-2");
  assert.strictEqual(after.selection.alternative.leadingPrerequisiteId, "MT5:enemy:3,10:skeletonPresbyter");
  assert.strictEqual(after.selection.alternative.leadingStatus, "viable-at-current-state");
  assert.ok(after.selection.alternative.leadingSurvivalMargin > 0);
  assert.strictEqual(after.nextExecution.selected.alternativeId, "alternative-2");
  assert.strictEqual(
    after.nextExecution.selected.prerequisite.sourceNodeId,
    "MT5:enemy:3,10:skeletonPresbyter",
  );
  assert.strictEqual(after.nextExecution.outcome.goalFound, true);
  assert.strictEqual(after.nextExecution.outcome.firstGoalExpansion, 1);
  assert.strictEqual(after.nextExecution.checkpoints.length, 8);
  assert.strictEqual(after.nextExecution.checkpointDiversity.allStrictReplay, true);
  assert.ok(after.nextExecution.checkpoints.every((checkpoint) => checkpoint.replay.valid));
  assert.ok(after.nextExecution.checkpoints.every((checkpoint) =>
    checkpoint.state.route.length > checkpoint.routeRecord.decisions.length));
  assert.strictEqual(after.verdict, "DEPENDENCY_FEEDBACK_ADVANCED_WITH_STRICT_REPLAY");

  process.stdout.write(`${JSON.stringify({
    status: "passed",
    comparison: {
      before: {
        retainedCheckpointCount: 1,
        checkpointId: before.baseline.checkpointId,
        canAdvance: before.baseline.canAdvance,
        outcome: before.verdict,
      },
      after: {
        retainedCheckpointCount: local.checkpoints.length,
        selectedCheckpointId: after.selection.checkpointId,
        selectedRoles: after.selection.roles,
        selectedAlternativeId: after.selection.alternative.alternativeId,
        nextPrerequisiteId: after.selection.alternative.leadingPrerequisiteId,
        nextGoalFound: after.nextExecution.outcome.goalFound,
        nextFirstGoalExpansion: after.nextExecution.outcome.firstGoalExpansion,
        strictReplay: after.nextExecution.checkpointDiversity.allStrictReplay,
        outcome: after.verdict,
      },
    },
    evaluations: after.evaluations.map(compactEvaluation),
    verdict: after.verdict,
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main };
