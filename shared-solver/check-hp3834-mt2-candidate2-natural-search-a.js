"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const reportFile = path.resolve(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "mt2-candidate2-natural-search-audit-v2.json",
);

assert.strictEqual(fs.existsSync(reportFile), true, "PR-4.4h-a report must exist");
const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
assert.strictEqual(report.schema, "motapathfinder.hp3834-mt2-candidate2-natural-search-audit.v2");
assert.strictEqual(report.status, "inconclusive");
assert.deepStrictEqual(report.failedGates, []);
assert.strictEqual(report.pipelineEvidence.firstAbsentPipelineStage, "raw-dp-goal-archive");
assert.strictEqual(report.gates.teacherEntryGoalAccepted, true);
assert.strictEqual(report.gates.firstExactLineageDropClassified, true);
assert.strictEqual(report.gates.entryReplacementContinuationAudited, true);
assert.strictEqual(report.entryReplacementContinuations.length, 8);
assert.strictEqual(report.isolatedLocalCheckpoints.length, 8);
assert.strictEqual(report.gates.allLocalCheckpointsAttempted, true);
assert.strictEqual(report.gates.allLocalAttemptsProcessIsolated, true);
assert.strictEqual(report.gates.childOldSpaceActuallyApplied, true);
assert.strictEqual(report.gates.decisionTargetsDefined, true);
assert.strictEqual(report.gates.lastNaturallyTrackedDecision, true);
assert.strictEqual(report.gates.firstUnobservedDecision, true);
assert.strictEqual(report.gates.postDropDecisionsClassifiedNotApplicable, true);
assert.strictEqual(report.oracle.completeSuffix, true);
assert.strictEqual(report.oracle.allHardTilesPresent, true);
assert.strictEqual(report.provenance.dataGenerationCommit.length, 40);
assert.strictEqual(report.provenance.rendererCommit.length, 40);

console.log("hp3834 candidate-2 PR-4.4h-a artifact checks: 20/20 passed");
