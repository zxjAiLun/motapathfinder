"use strict";

/** TEST GRADE: real-fixture-plus-bounded-search */

const assert = require("node:assert");
const path = require("node:path");

const { readBlindGoal } = require("./lib/blind-discovery-baseline");
const { runD2BlindFailureAttribution } = require("./lib/d2-blind-failure-attribution");
const { loadProject } = require("./lib/project-loader");
const { createMt5EntryState, detachCheckpoint } = require("./qualify-blind-discovery");

const ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");
const GOAL_FILE = path.join(__dirname, "blind-goals", "onlyup-mt5-blueking.json");

function main() {
  const project = loadProject(PROJECT_ROOT);
  const blindGoal = readBlindGoal(GOAL_FILE);
  const maxExpansions = Number(process.env.D2_ATTRIBUTION_MAX_EXPANSIONS || 1000);
  const report = runD2BlindFailureAttribution({
    project,
    initialState: detachCheckpoint(createMt5EntryState(project)),
    terminalGoal: blindGoal.goal,
    towerId: blindGoal.project,
    maxExpansions,
    checkpointStateProvenance: "tracked-fixture-replay-for-test-state-construction-then-history-detached",
  });
  assert.strictEqual(report.inputContract.checkpointHistoryDetached, true);
  assert.strictEqual(report.inputContract.knownRouteUsedBySearch, false);
  assert.deepStrictEqual(report.automaticGraph.floorCorridor.floorIds, ["MT5"]);
  assert.ok(report.automaticGraph.coverage.equipmentCandidates.some((entry) => entry.itemId === "I894"));
  assert.ok(report.automaticGraph.coverage.candidateResourceCount > 0);
  assert.ok(report.automaticGraph.coverage.candidateCombatCount > 0);
  assert.strictEqual(report.automaticGraph.coverage.resourceToBossEdgeCount, 0);
  assert.strictEqual(report.automaticGraph.coverage.terminalDependencyCompiled, false);
  assert.strictEqual(report.runtime.outcome.expansions, maxExpansions);
  assert.strictEqual(report.runtime.outcome.goalFound, false);
  assert.strictEqual(report.runtime.outcome.frontierExhausted, false);
  assert.strictEqual(report.runtime.outcome.budgetExhausted, true);
  assert.strictEqual(report.runtime.outcome.searchComplete, false);
  assert.strictEqual(report.runtime.outcome.actionTrimmed, 0);
  assert.ok(report.runtime.trace.expandedByFloor.MT4 > 0);
  assert.strictEqual(report.runtime.floorLocalControl.goalFound, false);
  assert.strictEqual(report.runtime.floorLocalControl.frontierExhausted, true);
  assert.strictEqual(report.runtime.floorLocalControl.searchComplete, true);
  assert.ok(report.runtime.floorLocalControl.expansions < 10);
  assert.strictEqual(report.attribution.openBudgetSurface, true);
  assert.strictEqual(report.attribution.missingDependencySignal, true);
  assert.strictEqual(report.attribution.planningEnvelopeOmission, true);
  assert.ok(report.attribution.expandedOutsideGraphFloors.some((entry) => entry.floorId === "MT4"));
  assert.strictEqual(
    report.attribution.firstFailureSurface,
    "AUTOMATIC_PLANNING_ENVELOPE_OMITS_REVISITABLE_PREREQUISITE_FLOORS",
  );
  assert.strictEqual(
    report.verdict,
    "D2_FIRST_FAILURE_ATTRIBUTED_TO_INCOMPLETE_AUTOMATIC_PLANNING_ENVELOPE",
  );
  process.stdout.write(`${JSON.stringify({
    status: "passed",
    maxExpansions,
    outcome: report.runtime.outcome,
    graphCoverage: report.automaticGraph.coverage,
    trace: report.runtime.trace,
    distinctGoalRankTupleCount: report.runtime.distinctGoalRankTupleCount,
    i894Landmarks: report.runtime.i894Landmarks,
    floorLocalControl: report.runtime.floorLocalControl,
    attribution: report.attribution,
    verdict: report.verdict,
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main };
