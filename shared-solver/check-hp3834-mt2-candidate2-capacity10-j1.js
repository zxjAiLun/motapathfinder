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

assert.strictEqual(report.status, "completed-with-contract-gaps");
assert.strictEqual(report.auditStatus, "completed-with-contract-gaps");
assert.deepStrictEqual(report.j1FailedGates, [
  "winningLocalMatchesTeacherDecision14",
  "winningRouteContainsTeacherEntryExact",
  "winningRouteContainsTeacherLocalExact",
  "knownExactWitnessCapacityRecoveryEstablished",
]);
assert.strictEqual(report.firstExactLineageDropContract, true);
assert.strictEqual(report.knownExactWitnessCapacityRecoveryEstablished, false);
assert.strictEqual(report.j1Gates.firstExactLineageDropContract, true);
assert.strictEqual(report.j1Gates.winningHpAttemptIdentified, true);
assert.strictEqual(report.j1Gates.winningLocalCheckpointIdentified, true);
assert.strictEqual(report.j1Gates.winningLocalMatchesTeacherDecision14, false);
assert.strictEqual(report.j1Gates.winningRouteContainsTeacherEntryExact, false);
assert.strictEqual(report.j1Gates.winningRouteContainsTeacherLocalExact, false);
assert.strictEqual(report.j1Gates.winningRouteFinalMatchesTeacherDecision23, true);
assert.strictEqual(report.j1Gates.winningRouteStrictReplayAttempted, true);
assert.strictEqual(report.j1Gates.winningRouteStrictReplayCompleted, true);
assert.strictEqual(report.j1Gates.winningRouteStrictReplayValid, true);
assert.strictEqual(report.j1Gates.hardTilesExactSeven, true);
assert.strictEqual(report.j1Gates.retainedMatrixInconclusive, true);
assert.strictEqual(report.j1Gates.globalDefaultNotEstablished, true);
assert.strictEqual(report.winningAncestry.winningHpAttemptStartCandidateId, "mt2-local-3582:candidate-6");
assert.strictEqual(report.winningAncestry.exactTeacherLocalCheckpointCandidateId, "mt2-local-3582:candidate-7");
assert.strictEqual(report.winningAncestry.winningAttemptStartedFromExactTeacherLocal, false);
assert.strictEqual(report.winningAncestry.winningRouteStrictReplay.stepsAttempted, 13);
assert.strictEqual(report.winningAncestry.winningRouteStrictReplay.stepsCompleted, 13);
assert.strictEqual(
  report.exactLifecycleOutcome.firstExactLineageDrop.classification,
  "pre-state-replaced-by-continuation-compatible-witness",
);
assert.strictEqual(report.exactLifecycleOutcome.firstExactLineageDrop.decisionIndex, 15);
const decision15 = report.exactLifecycleOutcome.decisions13To23.find((entry) => entry.decisionIndex === 15);
assert.strictEqual(decision15.generated, false);
assert.strictEqual(decision15.postRejoined, true);
assert.ok(report.exactLifecycleOutcome.exactRejoinDecisions.includes(15));

console.log("hp3834 candidate-2 PR-4.4j1 diagnostic checks: passed; winning ancestry gap recorded");
