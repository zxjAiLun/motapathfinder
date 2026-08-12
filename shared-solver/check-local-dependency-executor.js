"use strict";

/** TEST GRADE: real-fixture-plus-strict-replay */

const assert = require("node:assert");
const path = require("node:path");

const { compileAutomaticDependencyPlan } = require("./lib/automatic-dependency-planner");
const { compileAutomaticFeasibilitySubgoals } = require("./lib/automatic-feasibility-subgoals");
const { buildAutomaticMacroGraph } = require("./lib/automatic-macro-graph");
const { readBlindGoal } = require("./lib/blind-discovery-baseline");
const { executeLocalDependency, selectExecutablePrerequisite } = require("./lib/local-dependency-executor");
const { loadProject } = require("./lib/project-loader");
const { createMt5EntryState, detachCheckpoint } = require("./qualify-blind-discovery");

const ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");
const GOAL_FILE = path.join(__dirname, "blind-goals", "onlyup-mt5-blueking.json");

function buildInputs() {
  const project = loadProject(PROJECT_ROOT);
  const terminalGoal = readBlindGoal(GOAL_FILE).goal;
  const state = detachCheckpoint(createMt5EntryState(project));
  const graph = buildAutomaticMacroGraph(project, state, terminalGoal, {
    towerId: "onlyup",
    envelopeMode: "state-visible-revisitable",
  });
  const feasibility = compileAutomaticFeasibilitySubgoals(project, state, terminalGoal, graph);
  const dependencyPlan = compileAutomaticDependencyPlan(project, state, terminalGoal, graph, feasibility);
  return { project, state, dependencyPlan };
}

function fingerprintSummary(result) {
  return result.checkpoints.map((checkpoint) => ({
    roles: checkpoint.roles,
    exactStateFingerprint: checkpoint.exactStateFingerprint,
    routeFingerprint: checkpoint.routeFingerprint,
    decisionCount: checkpoint.decisionCount,
    hero: checkpoint.hero,
  }));
}

function main() {
  const { project, state, dependencyPlan } = buildInputs();
  const result = executeLocalDependency(project, PROJECT_ROOT, state, dependencyPlan, {
    maxExpansions: 64,
    candidateLimit: 8,
  });
  assert.strictEqual(result.inputContract.knownRouteUsed, false);
  assert.strictEqual(result.inputContract.authoredGoalUsed, false);
  assert.strictEqual(result.selected.alternativeId, "alternative-1");
  assert.strictEqual(result.selected.prerequisite.sourceNodeId, "MT5:enemy:8,11:skeletonKing");
  assert.deepStrictEqual(result.selected.prerequisite.actionGoal, {
    type: "tileRemoved",
    floorId: "MT5",
    x: 8,
    y: 11,
  });
  assert.strictEqual(result.outcome.goalFound, true);
  assert.strictEqual(result.outcome.expansions, 64);
  assert.strictEqual(result.outcome.firstGoalExpansion, 1);
  assert.ok(result.outcome.timing.searchMs >= 0);
  assert.ok(result.outcome.timing.checkpointReplayMs >= 0);
  assert.strictEqual(result.outcome.timing.totalWallMs, result.outcome.wallMs);
  assert.strictEqual(result.outcome.generated, result.outcome.accepted + result.outcome.rejected);
  assert.ok(result.outcome.rawGoalCandidateCount > result.outcome.retainedCheckpointCount);
  assert.strictEqual(result.checkpoints.length, 8);
  assert.strictEqual(result.checkpointDiversity.allStrictReplay, true);
  assert.strictEqual(result.checkpointDiversity.distinctStrategicOutcomes, true);
  assert.ok(result.checkpointDiversity.roleCount >= 5);
  assert.ok(result.checkpointDiversity.exactStateCount >= 5);
  assert.ok(result.checkpointDiversity.semanticStateCount >= 5);
  assert.ok(result.checkpointDiversity.routeCount >= 5);
  assert.ok(result.checkpoints.every((checkpoint) =>
    checkpoint.replay.valid && checkpoint.replay.stepsCompleted === checkpoint.decisionCount));
  assert.ok(result.checkpoints.some((checkpoint) => checkpoint.roles.includes("highest-hp")));
  assert.ok(result.checkpoints.some((checkpoint) => checkpoint.roles.includes("shortest")));
  assert.ok(result.checkpoints.some((checkpoint) => checkpoint.roles.includes("highest-def")));
  assert.notStrictEqual(
    result.checkpoints.find((checkpoint) => checkpoint.roles.includes("highest-hp")).exactStateFingerprint,
    result.checkpoints.find((checkpoint) => checkpoint.roles.includes("shortest")).exactStateFingerprint,
  );
  assert.strictEqual(result.verdict, "LOCAL_DEPENDENCY_MULTI_ROLE_CHECKPOINTS_VERIFIED");

  const ordered = selectExecutablePrerequisite({
    alternatives: [
      {
        id: "blocked-first",
        prerequisites: [
          { sourceNodeId: "blocked-leading", evidence: { status: "unbeatable-at-current-stats" } },
          { sourceNodeId: "viable-but-not-leading", evidence: { status: "viable-at-current-state" } },
        ],
      },
      {
        id: "runnable-second",
        prerequisites: [
          { sourceNodeId: "viable-leading", evidence: { status: "viable-at-current-state" } },
        ],
      },
    ],
  });
  assert.strictEqual(ordered.alternative.id, "runnable-second");
  assert.strictEqual(ordered.prerequisite.sourceNodeId, "viable-leading");

  const blockedPlan = JSON.parse(JSON.stringify(dependencyPlan));
  blockedPlan.alternatives.forEach((alternative) => {
    alternative.prerequisites.forEach((prerequisite) => {
      prerequisite.evidence.status = "unbeatable-at-current-stats";
    });
  });
  const blocked = executeLocalDependency(project, PROJECT_ROOT, state, blockedPlan, { maxExpansions: 64 });
  assert.strictEqual(blocked.selected, null);
  assert.strictEqual(blocked.outcome.reason, "no-currently-viable-prerequisite");
  assert.strictEqual(blocked.verdict, "NO_CURRENTLY_VIABLE_DEPENDENCY_PREREQUISITE");

  const repeat = executeLocalDependency(project, PROJECT_ROOT, state, dependencyPlan, {
    maxExpansions: 64,
    candidateLimit: 8,
  });
  assert.deepStrictEqual(fingerprintSummary(result), fingerprintSummary(repeat));

  process.stdout.write(`${JSON.stringify({
    status: "passed",
    selected: result.selected,
    controls: result.controls,
    outcome: result.outcome,
    checkpointDiversity: result.checkpointDiversity,
    checkpoints: fingerprintSummary(result),
    blockedControl: blocked.verdict,
    verdict: result.verdict,
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main };
