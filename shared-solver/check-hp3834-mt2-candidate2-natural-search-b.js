"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { hardTilesMatchExpected } = require("./audit-hp3834-mt2-candidate2-natural-search");

const reportFile = path.resolve(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "mt2-candidate2-natural-search-audit-b.json",
);
assert.strictEqual(fs.existsSync(reportFile), true, "PR-4.4h-b report must exist");
const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
assert.strictEqual(report.schema, "motapathfinder.hp3834-mt2-candidate2-natural-search-audit.v3");
assert.strictEqual(report.failedGates.length, 0);
assert.strictEqual(report.gates.allLocalSnapshotRoundTripsExact, true);
assert.strictEqual(report.gates.allLocalWorkersExitedCleanly, true);
assert.strictEqual(report.gates.allLocalWorkersProducedValidReports, true);
assert.strictEqual(report.gates.allEntryReplacementsExecute13To14, true);
assert.strictEqual(report.gates.allEntryReplacementSuffixesComplete, true);
assert.strictEqual(report.gates.allEntryReplacementOraclesFailureFree, true);
assert.strictEqual(report.oracle.hardTiles.length, 7);
assert.strictEqual(report.oracle.allHardTilesPresent, true);
assert.strictEqual(hardTilesMatchExpected(report.oracle.hardTiles), true);
assert.strictEqual(report.counterfactualEnabled, true);
assert.strictEqual(report.counterfactuals.exactTeacherLocal.snapshotRoundTripExact, true);
assert.strictEqual(report.counterfactuals.exactTeacherEntry.snapshotRoundTripExact, true);
assert.strictEqual(report.counterfactuals.exactTeacherLocal.search.found, true);
assert.strictEqual(report.counterfactuals.exactTeacherEntry.search.found, true);
assert.strictEqual(report.counterfactuals.exactTeacherLocal.search.reachedMilestone, "mt2-hp3834");
assert.strictEqual(report.counterfactuals.exactTeacherEntry.search.reachedMilestone, "mt2-hp3834");
const expectedHp3834Exact = report.lifecycleCoverage.records["decision-23"].expectedPostExactStateKey;
assert.ok(expectedHp3834Exact, "expected HP3834 exact state key must be present");
assert.strictEqual(
  report.counterfactuals.exactTeacherLocal.search.finalCandidate.exactStateKey,
  expectedHp3834Exact,
);
assert.strictEqual(
  report.counterfactuals.exactTeacherEntry.search.finalCandidate.exactStateKey,
  expectedHp3834Exact,
);
assert.strictEqual(report.gates.exactTeacherLocalCounterfactualExecuted, true);
assert.strictEqual(report.gates.exactTeacherEntryCounterfactualExecuted, true);
assert.strictEqual(report.gates.counterfactualWorkersExitedCleanly, true);
assert.strictEqual(report.gates.counterfactualSnapshotRoundTripsExact, true);
assert.strictEqual(report.gates.exactTeacherLocalCounterfactualFound, true);
assert.strictEqual(report.gates.exactTeacherEntryCounterfactualFound, true);
assert.strictEqual(report.gates.exactTeacherLocalReachedHp3834, true);
assert.strictEqual(report.gates.exactTeacherEntryReachedHp3834, true);
assert.strictEqual(report.gates.exactTeacherLocalFinalExactMatched, true);
assert.strictEqual(report.gates.exactTeacherEntryFinalExactMatched, true);
assert.strictEqual(report.gates.knownExactWitnessCausalityEstablished, true);
assert.strictEqual(report.exactCounterfactualReachability, "success");
assert.strictEqual(report.knownExactWitnessCausality, "established");
assert.strictEqual(report.retainedCheckpointMatrixOutcome, "inconclusive");
assert.strictEqual(report.provenance.artifactPublicationCommit.length, 40);
assert.strictEqual(report.provenance.provenanceFinalizationCommit.length, 40);

console.log("hp3834 candidate-2 PR-4.4h-b artifact checks: passed");
