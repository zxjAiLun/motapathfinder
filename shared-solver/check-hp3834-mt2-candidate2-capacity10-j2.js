"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const reportFile = path.resolve(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "mt2-candidate2-capacity10-j2.json",
);
const jFile = path.resolve(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "mt2-candidate2-capacity10-j.json",
);

assert.strictEqual(fs.existsSync(reportFile), true, "PR-4.4j2 report must exist");
const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
const j = JSON.parse(fs.readFileSync(jFile, "utf8"));

assert.strictEqual(report.status, "completed");
assert.strictEqual(report.auditStatus, "completed");
assert.strictEqual(report.productionSemanticChange, false);
assert.ok(report.conclusion.includes("alternate mutation ancestry"));
assert.ok(report.conclusion.includes("not-established"));

const diff = report.candidate6VsTeacherLocal;
assert.strictEqual(diff.resourceEquivalent, true);
assert.strictEqual(diff.exactEquivalent, false);
assert.deepStrictEqual(diff.heroDiff, {});
assert.deepStrictEqual(diff.inventoryDiff, {});
assert.deepStrictEqual(diff.flagsDiff, {});
assert.deepStrictEqual(diff.mt2MutationDiff, {});
assert.deepStrictEqual(diff.mutationsOnlyInWinner, ["MT1:4,1"]);
assert.deepStrictEqual(diff.mutationsOnlyInTeacher, ["MT1:8,1"]);

const ancestry = report.ancestryComparison;
assert.strictEqual(ancestry.firstDivergenceDecision, 11);
assert.strictEqual(ancestry.winningBranch.winningEntryCandidateId, "mt2-entry:candidate-0");
assert.strictEqual(ancestry.winningBranch.winningLocalCandidateId, "mt2-local-3582:candidate-6");
assert.strictEqual(ancestry.teacherLocalBranch.teacherEntryCandidateId, "mt2-entry:candidate-3");
assert.strictEqual(ancestry.teacherLocalBranch.teacherLocalCandidateId, "mt2-local-3582:candidate-7");
assert.strictEqual(ancestry.winningBranch.decision12EntryCandidateId, "mt2-entry:candidate-0");
assert.strictEqual(ancestry.teacherLocalBranch.decision12EntryCandidateId, "mt2-entry:candidate-3");
assert.strictEqual(ancestry.winningBranch.decision14LocalCandidateId, "mt2-local-3582:candidate-6");
assert.strictEqual(ancestry.teacherLocalBranch.decision14LocalCandidateId, "mt2-local-3582:candidate-7");
assert.strictEqual(ancestry.winningBranch.replay.valid, true);
assert.strictEqual(ancestry.teacherLocalBranch.replay.valid, true);
assert.strictEqual(ancestry.winningBranch.replay.stepsCompleted, 4);
assert.strictEqual(ancestry.teacherLocalBranch.replay.stepsCompleted, 4);
assert.strictEqual(ancestry.firstDivergenceActions.winnerFingerprint, "battle|MT1|4|1|skeleton");
assert.strictEqual(ancestry.firstDivergenceActions.teacherLocalFingerprint, "battle|MT1|8|1|skeleton");
assert.strictEqual(ancestry.firstDivergenceActions.winner, "battle:skeleton@MT1:4,1");
assert.strictEqual(ancestry.firstDivergenceActions.teacherLocal, "battle:skeleton@MT1:8,1");
assert.strictEqual(ancestry.sharedContinuation.winningBranch.finalMatchesTarget, true);
assert.strictEqual(ancestry.sharedContinuation.winningBranch.valid, true);
assert.strictEqual(ancestry.sharedContinuation.winningBranch.stepsAttempted, 13);
assert.strictEqual(ancestry.sharedContinuation.winningBranch.stepsCompleted, 13);
assert.strictEqual(ancestry.sharedContinuation.teacherLocalBranch.finalMatchesTarget, true);
assert.strictEqual(ancestry.sharedContinuation.teacherLocalBranch.valid, true);
assert.strictEqual(ancestry.sharedContinuation.teacherLocalBranch.stepsAttempted, 13);
assert.strictEqual(ancestry.sharedContinuation.teacherLocalBranch.stepsCompleted, 13);
assert.strictEqual(ancestry.firstExactRejoinDecision, 20);

const attribution = report.winningEntryAttribution;
assert.strictEqual(attribution.winningEntryCandidateId, "mt2-entry:candidate-0");
assert.strictEqual(attribution.winningEntrySegmentRetained, true);
assert.strictEqual(attribution.winningEntryMergedRetained, true);
assert.strictEqual(attribution.teacherEntryCandidateId, "mt2-entry:candidate-3");
assert.strictEqual(attribution.teacherEntrySegmentRetained, true);
assert.strictEqual(attribution.teacherEntryMergedRetained, true);

const baseline = report.baseline8CrossCheck;
assert.strictEqual(baseline.winnerEntry.rawGoalArchive.present, true);
assert.strictEqual(baseline.winnerEntry.segmentCheckpoint.present, true);
assert.strictEqual(baseline.winnerEntry.mergedCheckpoint.present, true);
assert.strictEqual(baseline.winnerLocal.rawGoalArchive.present, false);
assert.strictEqual(baseline.winnerLocal.segmentCheckpoint.present, false);
assert.strictEqual(baseline.winnerLocal.mergedCheckpoint.present, false);
assert.strictEqual(baseline.winnerLocalAttempt.actualWinnerLocalAttemptExecuted, false);
assert.strictEqual(baseline.entryRetainedUnder8, true);
assert.strictEqual(baseline.localRetainedUnder8, false);
assert.strictEqual(baseline.exactLocalAttemptExecutedUnder8, false);
assert.strictEqual(baseline.classification, "insufficient-existing-evidence");
assert.ok(baseline.classificationReason.includes("no exact winner-local checkpoint"));
assert.strictEqual(baseline.winnerLineageCapacityDependency, "insufficient-existing-evidence");

const workerCache = report.workerCache;
assert.strictEqual(workerCache.reused, true);
assert.strictEqual(workerCache.candidateExactKeysMatch, true);
assert.strictEqual(workerCache.configMatch, true);
assert.strictEqual(workerCache.milestoneMatch, true);
assert.strictEqual(workerCache.sourceReportShaMatch, true);
assert.strictEqual(workerCache.solverIdentityMatch, true);
assert.strictEqual(workerCache.cacheKeyMatches, true);
assert.ok(typeof workerCache.cacheKey === "string" && workerCache.cacheKey.length === 64);
assert.deepStrictEqual(workerCache.rejectionReasons, []);

assert.strictEqual(report.isolatedWorkerComparison.workerCount, 2);
assert.strictEqual(report.isolatedWorkerComparison.sameConfig, true);
assert.strictEqual(report.isolatedWorkerComparison.allReportsValid, true);
assert.deepStrictEqual(
  report.isolatedWorkerComparison.workers.map((worker) => worker.candidateId),
  ["mt2-local-3582:candidate-6", "mt2-local-3582:candidate-7"],
);
const workerTargetExactStateKey = j.winningAncestry.teacherFinalExactStateKey;
for (const worker of report.isolatedWorkerComparison.workers) {
  assert.strictEqual(worker.processIsolated, true);
  assert.strictEqual(worker.exitCode, 0);
  assert.strictEqual(worker.signal, null);
  assert.strictEqual(worker.timedOut, false);
  assert.strictEqual(worker.snapshotRoundTripExact, true);
  assert.strictEqual(worker.search.found, true);
  assert.strictEqual(worker.search.reachedMilestone, "mt2-hp3834");
  assert.strictEqual(worker.search.finalCandidate.exactStateKey, workerTargetExactStateKey);
}

assert.ok(report.j2Gates);
assert.deepStrictEqual(report.failedGates, []);
assert.ok(Object.values(report.j2Gates).every((passed) => passed === true));

assert.strictEqual(report.verdict.terminalExactConvergenceViaAlternateAncestry, true);
assert.strictEqual(report.verdict.knownExactTeacherWitnessRecovery, "not-established");
assert.strictEqual(report.verdict.winningAncestryCapacityDependency, "insufficient-existing-evidence");
assert.strictEqual(report.verdict.globalDefaultChangeRecommended, "not-established");
assert.strictEqual(j.conclusionContract.correctedBy, "PR-4.4j2");
assert.ok(j.conclusion.includes("alternate mutation ancestry"));

console.log("hp3834 candidate-2 PR-4.4j2 ancestry attribution checks: passed");
