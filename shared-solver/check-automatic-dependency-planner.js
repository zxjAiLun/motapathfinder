"use strict";

/** TEST GRADE: real-fixture-plus-contract */

const assert = require("node:assert");
const path = require("node:path");

const { compileAutomaticDependencyPlan } = require("./lib/automatic-dependency-planner");
const { compileAutomaticFeasibilitySubgoals } = require("./lib/automatic-feasibility-subgoals");
const { buildAutomaticMacroGraph } = require("./lib/automatic-macro-graph");
const { readBlindGoal } = require("./lib/blind-discovery-baseline");
const { loadProject } = require("./lib/project-loader");
const { createMt5EntryState, detachCheckpoint } = require("./qualify-blind-discovery");

const ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");
const GOAL_FILE = path.join(__dirname, "blind-goals", "onlyup-mt5-blueking.json");

function main() {
  const project = loadProject(PROJECT_ROOT);
  const terminalGoal = readBlindGoal(GOAL_FILE).goal;
  const state = detachCheckpoint(createMt5EntryState(project));
  const graph = buildAutomaticMacroGraph(project, state, terminalGoal, {
    towerId: "onlyup",
    envelopeMode: "state-visible-revisitable",
  });
  const feasibility = compileAutomaticFeasibilitySubgoals(project, state, terminalGoal, graph);
  const plan = compileAutomaticDependencyPlan(project, state, terminalGoal, graph, feasibility, {
    alternativeLimit: 6,
  });
  const repeat = compileAutomaticDependencyPlan(project, state, terminalGoal, graph, feasibility, {
    alternativeLimit: 6,
  });
  assert.strictEqual(plan.inputContract.knownRouteUsed, false);
  assert.strictEqual(plan.inputContract.authoredSequenceUsed, false);
  assert.strictEqual(plan.objective.selectedFeasibilitySubgoal.target.itemId, "I894");
  assert.strictEqual(plan.logic.rootRelation, "OR");
  assert.strictEqual(plan.logic.alternativeRelation, "AND");
  assert.ok(plan.alternatives.length >= 2);
  assert.ok(plan.alternatives.every((alternative) => alternative.prerequisites.length > 0));
  assert.ok(plan.alternatives.every((alternative) =>
    alternative.prerequisites.every((entry) => entry.relation === "AND")));
  assert.ok(plan.logic.commonPrerequisiteIds.includes("MT5:enemy:10,5:goldHornSlime"));
  assert.ok(plan.alternatives[0].pathEdgeIds.some((id) => id.startsWith("poi-contact:")));
  assert.ok(plan.summary.viableNow.length > 0);
  assert.ok(plan.summary.blockedNow.length > 0);
  assert.ok(plan.alternatives.some((alternative) => alternative.prerequisites.some((entry) =>
    entry.evidence.status === "unbeatable-at-current-stats")));
  assert.ok(plan.alternatives.some((alternative) => alternative.prerequisites.some((entry) =>
    entry.evidence.status === "lethal-at-current-hp")));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(plan)), JSON.parse(JSON.stringify(repeat)));
  assert.strictEqual(plan.verdict, "AUTOMATIC_AND_OR_DEPENDENCY_PLAN_COMPILED");

  const disconnectedGraph = {
    ...graph,
    edges: graph.edges.filter((edge) => edge.kind !== "poi-contact"),
  };
  const disconnected = compileAutomaticDependencyPlan(
    project,
    state,
    terminalGoal,
    disconnectedGraph,
    feasibility,
  );
  assert.strictEqual(disconnected.alternatives.length, 0);
  assert.strictEqual(disconnected.verdict, "AUTOMATIC_DEPENDENCY_TARGET_DISCONNECTED");

  const noSelected = compileAutomaticDependencyPlan(project, state, terminalGoal, graph, {
    selectedSubgoals: [],
  });
  assert.strictEqual(noSelected.alternatives.length, 0);
  assert.strictEqual(noSelected.verdict, "NO_SELECTED_FEASIBILITY_SUBGOAL");

  process.stdout.write(`${JSON.stringify({
    status: "passed",
    objective: plan.objective,
    logic: plan.logic,
    alternatives: plan.alternatives.map((alternative) => ({
      id: alternative.id,
      blockerCount: alternative.blockerCount,
      topologyHops: alternative.topologyHops,
      prerequisites: alternative.prerequisites.map((entry) => ({
        sourceNodeId: entry.sourceNodeId,
        status: entry.evidence.status,
        damage: entry.evidence.damage == null ? null : entry.evidence.damage,
      })),
    })),
    summary: plan.summary,
    disconnectedControl: disconnected.verdict,
    noSelectedControl: noSelected.verdict,
    verdict: plan.verdict,
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main };
