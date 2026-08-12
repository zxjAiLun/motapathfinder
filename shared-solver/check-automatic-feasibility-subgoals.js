"use strict";

/** TEST GRADE: real-fixture-plus-contract */

const assert = require("node:assert");
const path = require("node:path");

const { buildAutomaticMacroGraph } = require("./lib/automatic-macro-graph");
const { compileAutomaticFeasibilitySubgoals } = require("./lib/automatic-feasibility-subgoals");
const { readBlindGoal } = require("./lib/blind-discovery-baseline");
const { loadProject } = require("./lib/project-loader");
const { cloneState } = require("./lib/state");
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
  assert.strictEqual(graph.floorCorridor.selection, "state-visible-static-revisit-closure");
  assert.deepStrictEqual(graph.floorCorridor.floorIds, ["MT1", "MT2", "MT3", "MT4", "MT5"]);
  const compiled = compileAutomaticFeasibilitySubgoals(project, state, terminalGoal, graph);
  const repeat = compileAutomaticFeasibilitySubgoals(project, state, terminalGoal, graph);
  assert.strictEqual(compiled.inputContract.knownRouteUsed, false);
  assert.strictEqual(compiled.inputContract.milestoneUsed, false);
  assert.strictEqual(compiled.verdict, "AUTOMATIC_FEASIBILITY_SUBGOALS_COMPILED");
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(compiled.selectedSubgoals)),
    JSON.parse(JSON.stringify(repeat.selectedSubgoals)),
  );
  assert.strictEqual(compiled.selectedSubgoals.length, 1);
  assert.deepStrictEqual(compiled.selectedSubgoals[0].goal, { equipmentIncludes: ["I894"] });
  assert.strictEqual(compiled.selectedSubgoals[0].target.floorId, "MT5");
  assert.ok(compiled.selectedSubgoals[0].score.attackDeficitReduction > 0);
  const removed = cloneState(state);
  removed.floorStates.MT5.removed["11,5"] = true;
  const negative = compileAutomaticFeasibilitySubgoals(project, removed, terminalGoal, graph);
  assert.strictEqual(negative.equipmentCandidates.length, 0);
  assert.strictEqual(negative.verdict, "NO_AUTOMATIC_FEASIBILITY_SUBGOAL_IDENTIFIED");
  assert.throws(
    () => compileAutomaticFeasibilitySubgoals(project, state, { ...terminalGoal, enemyId: "missing-enemy" }, graph),
    /target enemy not found/,
  );
  process.stdout.write(`${JSON.stringify({
    status: "passed",
    planningEnvelope: compiled.planningEnvelope,
    baseline: compiled.baseline,
    selectedSubgoals: compiled.selectedSubgoals,
    negativeControl: negative.verdict,
    verdict: compiled.verdict,
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main };
