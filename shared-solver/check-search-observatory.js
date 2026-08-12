"use strict";

/** TEST GRADE: real-fixture-plus-bounded-search */

const assert = require("node:assert");

const { compareSearchObservatories } = require("./lib/search-observatory");
const { buildD2Observatory } = require("./observe-d2-search");

function main() {
  const maxExpansions = Number(process.env.D2_OBSERVATORY_MAX_EXPANSIONS || 32);
  const report = buildD2Observatory({ maxExpansions });
  const selected = report.hypothesisBoard.find((entry) => entry.selected);
  assert.strictEqual(report.interpretationBoundary.productionSearchChanged, false);
  assert.strictEqual(report.interpretationBoundary.knownRouteUsedBySearch, false);
  assert.strictEqual(report.outcome.expansions, maxExpansions);
  assert.strictEqual(report.budgetLedger.expansions, report.outcome.expansions);
  assert.strictEqual(
    report.budgetLedger.byFloor.reduce((sum, entry) => sum + entry.count, 0),
    report.budgetLedger.expansions,
  );
  assert.ok(report.budgetLedger.generated > 0);
  assert.strictEqual(
    report.budgetLedger.accepted + report.budgetLedger.rejected,
    report.budgetLedger.generated,
  );
  assert.strictEqual(selected.target.itemId, "I894");
  assert.strictEqual(selected.status, "not-generated");
  assert.ok(report.reviewCandidates.some((entry) => entry.id === "selected-feasibility-subgoal-never-generated"));
  assert.ok(report.reviewCandidates.every((entry) => entry.wasteProven === false));
  assert.strictEqual(report.dependencyBoard.rootRelation, "OR");
  assert.strictEqual(report.dependencyBoard.alternativeRelation, "AND");
  assert.ok(report.dependencyBoard.alternativeCount >= 2);
  assert.strictEqual(report.nextExperiment.id, "execute-local-dependency-checkpoint");
  assert.strictEqual(report.verdict, "SEARCH_INTENT_AND_COST_BASELINE_VISIBLE");

  const after = JSON.parse(JSON.stringify(report));
  after.hypothesisBoard.find((entry) => entry.selected).runtimeEvidence.candidatesGenerated = 1;
  const comparison = compareSearchObservatories(report, after);
  assert.strictEqual(comparison.comparable, true);
  assert.strictEqual(
    comparison.metrics.find((entry) => entry.id === "selectedSubgoalCandidates").direction,
    "improved",
  );
  after.controls.maxExpansions += 1;
  assert.strictEqual(compareSearchObservatories(report, after).comparable, false);
  process.stdout.write(`${JSON.stringify({
    status: "passed",
    selectedHypothesis: selected,
    budgetLedger: report.budgetLedger,
    progressSignal: report.progressSignal,
    reviewCandidates: report.reviewCandidates,
    nextExperiment: report.nextExperiment,
    comparison,
    verdict: report.verdict,
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main };
