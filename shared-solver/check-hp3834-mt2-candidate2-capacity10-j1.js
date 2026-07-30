"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const reportFile = path.resolve(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "mt2-candidate2-capacity10-j.json",
);
assert.strictEqual(fs.existsSync(reportFile), true, "PR-4.4j1 report must exist");
const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));

assert.strictEqual(report.status, "completed");
assert.strictEqual(report.auditStatus, "completed");
assert.deepStrictEqual(report.j1FailedGates, []);
assert.strictEqual(report.firstExactLineageDropContract, true);
assert.strictEqual(report.knownExactWitnessCapacityRecoveryEstablished, true);
assert.strictEqual(report.j1Gates.firstExactLineageDropContract, true);
assert.strictEqual(report.j1Gates.winningHpAttemptIdentified, true);
assert.strictEqual(report.j1Gates.winningLocalCheckpointIdentified, true);
assert.strictEqual(report.j1Gates.winningLocalMatchesTeacherDecision14, true);
assert.strictEqual(report.j1Gates.winningRouteContainsTeacherEntryExact, true);
assert.strictEqual(report.j1Gates.winningRouteContainsTeacherLocalExact, true);
assert.strictEqual(report.j1Gates.winningRouteFinalMatchesTeacherDecision23, true);
assert.strictEqual(report.j1Gates.winningRouteStrictReplayAttempted, true);
assert.strictEqual(report.j1Gates.winningRouteStrictReplayCompleted, true);
assert.strictEqual(report.j1Gates.winningRouteStrictReplayValid, true);
assert.strictEqual(report.j1Gates.hardTilesExactSeven, true);
assert.strictEqual(report.j1Gates.retainedMatrixInconclusive, true);
assert.strictEqual(report.j1Gates.globalDefaultNotEstablished, true);
assert.strictEqual(report.winningAncestry.winningHpAttemptStartCandidateId, "mt2-local-3582:candidate-6");
assert.strictEqual(report.winningAncestry.winningRouteStrictReplay.stepsAttempted, 22);
assert.strictEqual(report.winningAncestry.winningRouteStrictReplay.stepsCompleted, 22);
assert.strictEqual(
  report.exactLifecycleOutcome.firstExactLineageDrop.classification,
  "pre-state-replaced-by-continuation-compatible-witness",
);
assert.strictEqual(report.exactLifecycleOutcome.firstExactLineageDrop.decisionIndex, 15);
const decision15 = report.exactLifecycleOutcome.decisions13To23.find((entry) => entry.decisionIndex === 15);
assert.strictEqual(decision15.generated, false);
assert.strictEqual(decision15.postRejoined, true);
assert.ok(report.exactLifecycleOutcome.exactRejoinDecisions.includes(15));

console.log("hp3834 candidate-2 PR-4.4j1 artifact contract checks: passed");
