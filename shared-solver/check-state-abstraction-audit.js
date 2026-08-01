"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { buildReport } = require("./audit-state-abstraction");

const ROOT = path.resolve(__dirname, "..");
const REPORT = path.resolve(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "pr-4.5a-state-abstraction-audit.json",
);
const MARKDOWN = path.resolve(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "pr-4.5a-state-abstraction-audit.md",
);

assert.strictEqual(fs.existsSync(REPORT), true, "PR-4.5a report must exist");
assert.strictEqual(fs.existsSync(MARKDOWN), true, "PR-4.5a markdown report must exist");

const report = JSON.parse(fs.readFileSync(REPORT, "utf8"));
assert.strictEqual(report.schema, "motapathfinder.pr-4.5a1-state-abstraction-audit.v1");
assert.strictEqual(report.status, "completed");
assert.strictEqual(report.evidenceOutcome, "equivalent");
assert.strictEqual(report.scope.shadowOnly, true);
assert.strictEqual(report.scope.productionSemanticChange, false);
assert.strictEqual(report.scope.productionDpKeyChanged, false);
assert.strictEqual(report.scope.productionDominanceChanged, false);
assert.strictEqual(report.scope.productionAgendaChanged, false);
assert.strictEqual(report.scope.productionCapacityChanged, false);
assert.strictEqual(report.scope.productionDefaultStrategyChanged, false);
assert.strictEqual(report.corpus.leftCandidateId, "mt2-local-3582:candidate-6");
assert.strictEqual(report.corpus.rightCandidateId, "mt2-local-3582:candidate-7");
assert.strictEqual(report.corpus.decisionStart, 14);
assert.strictEqual(report.corpus.decisionEnd, 20);
assert.strictEqual(report.corpus.sourceCandidateExactKeysMatchArtifact, true);
assert.strictEqual(report.replay.errors.length, 0);
assert.strictEqual(report.replay.exactRejoinAtDecision20, true);
assert.strictEqual(report.actionSuccessorAudit.projection.name, "current-floor-mutation-only-v1-shadow");
assert.strictEqual(report.actionSuccessorAudit.projectedCollisionCount, 7);
assert.strictEqual(report.actionSuccessorAudit.actionSetEquivalentAtAllCollisions, true);
assert.strictEqual(report.actionSuccessorAudit.projectedSuccessorSetEquivalentAtAllCollisions, true);
assert.strictEqual(report.actionSuccessorAudit.projectedSuccessorRelationEquivalentAtAllCollisions, true);
assert.strictEqual(report.actionSuccessorAudit.allActionsEnumeratedWithoutErrorAtAllCollisions, true);
assert.strictEqual(report.actionSuccessorAudit.allActionsAppliedWithoutErrorAtAllCollisions, true);
assert.deepStrictEqual(
  report.actionSuccessorAudit.decisionChecks.map((entry) => entry.decision),
  [14, 15, 16, 17, 18, 19, 20],
);
report.actionSuccessorAudit.decisionChecks.forEach((entry) => {
  assert.strictEqual(entry.projectedCollision, true, `decision ${entry.decision} must be a projection collision`);
  assert.strictEqual(entry.actionSet.actionSetEquivalent, true, `decision ${entry.decision} action sets must match`);
  assert.strictEqual(entry.actionSet.projectedSuccessorRelationEquivalent, true, `decision ${entry.decision} projected relation must match`);
  assert.strictEqual(entry.actionSet.noEnumerationErrors, true, `decision ${entry.decision} must enumerate without errors`);
  assert.strictEqual(entry.actionSet.noActionApplicationErrors, true, `decision ${entry.decision} must apply actions without errors`);
  assert.strictEqual(entry.enumeration.leftErrors.length, 0);
  assert.strictEqual(entry.enumeration.rightErrors.length, 0);
  assert.strictEqual(entry.enumeration.leftActionErrors, 0);
  assert.strictEqual(entry.enumeration.rightActionErrors, 0);
});
report.actionSuccessorAudit.decisionChecks.slice(0, 6).forEach((entry) => {
  assert.strictEqual(entry.exactKeyEqual, false, `decision ${entry.decision} must retain exact-key distinction`);
  assert.strictEqual(entry.actionSet.exactSuccessorRelationEquivalent, false, `decision ${entry.decision} exact relation must differ`);
});
const decision20 = report.actionSuccessorAudit.decisionChecks[6];
assert.strictEqual(decision20.exactKeyEqual, true);
assert.strictEqual(decision20.actionSet.exactSuccessorRelationEquivalent, true);
assert.strictEqual(report.gates.sourceCandidatesMatched, true);
assert.strictEqual(report.gates.replayComplete, true);
assert.strictEqual(report.gates.expectedCollisionWindowCovered, true);
assert.strictEqual(report.gates.allActionsEnumeratedWithoutError, true);
assert.strictEqual(report.gates.allActionsAppliedWithoutError, true);
assert.strictEqual(report.gates.projectedActionRelationEquivalent, true);
assert.strictEqual(report.gates.decision20ExactRejoin, true);
assert.ok(Array.isArray(report.exactKeySplitContribution.topLevel));
assert.ok(report.exactKeySplitContribution.topLevel.some((field) => field.field === "mutations"));
assert.ok(report.exactKeySplitContribution.topLevel.some((field) => field.field === "mutations" && field.exclusiveSplitPairCount > 0));
const nestedMutationStats = report.exactKeySplitContribution.nested;
const mutationMt1 = nestedMutationStats.find((field) => field.field === "mutations.MT1");
const mutationMt2 = nestedMutationStats.find((field) => field.field === "mutations.MT2");
const mutationMt1Removed = nestedMutationStats.find((field) => field.field === "mutations.MT1.removed");
const mutationMt2Removed = nestedMutationStats.find((field) => field.field === "mutations.MT2.removed");
assert.ok(mutationMt1, "mutations.MT1 nested split must be reported");
assert.ok(mutationMt2, "mutations.MT2 nested split must be reported");
assert.ok(mutationMt1Removed, "mutations.MT1.removed nested split must be reported");
assert.ok(mutationMt2Removed, "mutations.MT2.removed nested split must be reported");
assert.ok(mutationMt1.exclusiveSplitPairCount > 0);
assert.strictEqual(mutationMt2.exclusiveSplitPairCount, 0);
assert.ok(mutationMt1Removed.exclusiveSplitPairCount > 0);
assert.strictEqual(mutationMt2Removed.exclusiveSplitPairCount, 0);
assert.ok(report.triggeredAutoEvents.classification);
assert.ok(report.directionDependencyRegistry.registry.some((entry) => entry.id === "floor-transition.change-floor-fallback"));
assert.ok(report.directionDependencyRegistry.coverage.scanned.includes("firstArrive"));
assert.ok(report.directionDependencyRegistry.coverage.scanned.includes("eachArrive"));
assert.ok(report.directionDependencyRegistry.coverage.scanned.includes("autoEvent"));
[
  "events",
  "beforeBattle",
  "afterBattle",
  "afterGetItem",
  "afterOpenDoor",
  "changeFloor",
  "parallelDo",
  "project functions and plugins",
].forEach((item) => assert.ok(report.directionDependencyRegistry.coverage.notScannedOrNotProven.includes(item)));
assert.ok(report.provenance.productionStateKeySha256);
[
  "sourceReportSha256",
  "ancestryReportSha256",
  "productionStateKeySha256",
].forEach((field) => assert.ok(report.provenance[field], `provenance.${field} must be locked`));

// The fixture is a report artifact; this live rebuild proves the audit code
// still agrees with it without changing any production solver behavior.
const rebuilt = buildReport();
assert.strictEqual(rebuilt.scope.productionSemanticChange, false);
assert.strictEqual(rebuilt.status, "completed");
assert.strictEqual(rebuilt.evidenceOutcome, "equivalent");
assert.strictEqual(rebuilt.replay.exactRejoinAtDecision20, true);
assert.strictEqual(rebuilt.actionSuccessorAudit.projectedCollisionCount, 7);
assert.strictEqual(rebuilt.actionSuccessorAudit.actionSetEquivalentAtAllCollisions, true);
assert.strictEqual(rebuilt.actionSuccessorAudit.projectedSuccessorSetEquivalentAtAllCollisions, true);
assert.strictEqual(rebuilt.actionSuccessorAudit.projectedSuccessorRelationEquivalentAtAllCollisions, true);
assert.strictEqual(rebuilt.actionSuccessorAudit.exactSuccessorRelationEquivalentAtAllCollisions, false);
assert.strictEqual(rebuilt.provenance.sourceReportSha256, report.provenance.sourceReportSha256);
assert.strictEqual(rebuilt.provenance.ancestryReportSha256, report.provenance.ancestryReportSha256);
assert.strictEqual(rebuilt.provenance.productionStateKeySha256, report.provenance.productionStateKeySha256);

console.log("PR-4.5a1 state abstraction audit checks: passed");
