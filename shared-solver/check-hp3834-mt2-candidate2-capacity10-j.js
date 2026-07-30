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

assert.strictEqual(fs.existsSync(reportFile), true, "PR-4.4j report must exist");
const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));

assert.ok(
  ["completed", "completed-with-contract-gaps"].includes(report.status),
  `unexpected PR-4.4j status: ${report.status}`,
);
assert.ok(
  ["completed", "completed-with-contract-gaps"].includes(report.auditStatus),
  `unexpected PR-4.4j auditStatus: ${report.auditStatus}`,
);
assert.deepStrictEqual(report.failedGates, []);
assert.strictEqual(report.capacityCounterfactualConfigVerified, true);
assert.strictEqual(report.productionDefaultsUnchanged, true);
assert.strictEqual(report.noTeacherInjection, true);
assert.strictEqual(report.productionSemanticChange, false);
assert.strictEqual(report.globalDefaultChangeRecommended, "not-established");
assert.strictEqual(report.config.agendaMode, "best-first");
assert.strictEqual(report.config.stopOnFirstGoal, false);
assert.strictEqual(report.config.goalSkylineLimit, 10);
assert.strictEqual(report.config.candidateLimit, 10);
assert.strictEqual(report.config.dpSkylineMax, 4);
assert.strictEqual(report.config.preserveSkylineRoles, true);
assert.strictEqual(report.config.maxExpansions, 900);
assert.strictEqual(report.config.maxRuntimeMs, 900000);
assert.strictEqual(report.config.maxHeapMb, 1400);
assert.strictEqual(report.config.maxRssMb, 1800);
assert.strictEqual(report.config.childOldSpaceMb, 1600);
assert.strictEqual(report.config.memoryCheckIntervalExpansions, 1);
assert.strictEqual(report.config.memoryCheckIntervalActions, 1);
assert.strictEqual(report.source.injection.teacherActionInjection, false);
assert.strictEqual(report.source.injection.teacherStateInjection, false);
assert.strictEqual(report.source.injection.exactStatePriorityInjection, false);

assert.strictEqual(report.gates.configExactly10x10x4, true);
assert.strictEqual(report.gates.productionDefaultsUnchanged, true);
assert.strictEqual(report.gates.noTeacherInjection, true);
assert.strictEqual(report.gates.candidate2NaturalStart, true);
assert.strictEqual(report.gates.productionSearchExecuted, true);
assert.strictEqual(report.gates.teacherEntryGoalAccepted, true);
assert.strictEqual(report.gates.teacherEntryActiveAtFinish, true);
assert.strictEqual(report.gates.teacherEntryRawSelected, true);
assert.strictEqual(report.gates.teacherEntryRawSelectedArchiveRankPresent, true);
assert.strictEqual(report.gates.teacherEntrySegmentRetentionClassified, true);
assert.strictEqual(report.gates.teacherEntryMergedRetentionClassified, true);
assert.strictEqual(report.gates.downstreamSearchExecuted, true);
assert.strictEqual(report.gates.searchCompletionClassified, true);
assert.strictEqual(report.gates.exactHp3834MatchClassified, true);
assert.strictEqual(report.gates.strictRouteReplayValid, true);
assert.strictEqual(report.gates.hardTilesPreserved, true);

assert.strictEqual(report.teacherEntryRawRetention.retained, true);
assert.ok(Number.isInteger(report.teacherEntryRawRetention.rawSortRank));
assert.ok(Number.isInteger(report.teacherEntryRawRetention.selectedArchiveRank));
assert.strictEqual(report.teacherEntrySegmentRetention.retained, true);
assert.strictEqual(report.teacherEntryMergedRetention.retained, true);
assert.strictEqual(report.exactLifecycleOutcome.teacherEntry.goalAccepted, true);
assert.strictEqual(report.exactLifecycleOutcome.firstExactLineageDrop == null || typeof report.exactLifecycleOutcome.firstExactLineageDrop === "object", true);
assert.ok(report.candidate2NaturalRun);
assert.strictEqual(report.candidate2NaturalRun.pipeline.stages.length, 3);

const reachability = report.exactHp3834Reachability;
assert.ok(["success", "inconclusive", "failed"].includes(reachability.completion.classification));
if (reachability.found) {
  assert.strictEqual(reachability.reachedMilestone, "mt2-hp3834");
  assert.strictEqual(reachability.finalExactStateMatched, true);
  assert.strictEqual(report.strictRouteReplay.natural.valid, true);
  assert.strictEqual(report.hardTilesApplicable, true);
  assert.strictEqual(report.hardTilesPreserved, true);
} else if (reachability.completion.classification === "inconclusive") {
  const attempts = report.candidate2NaturalRun.search.segmentResults.flatMap((segment) => segment.attempts || []);
  assert.ok(attempts.some((attempt) => attempt.frontierSize > 0 || attempt.expansionBudgetExhausted || attempt.stoppedReason));
} else {
  assert.strictEqual(report.exactLifecycleOutcome.finalExactStateMatched, false);
}

console.log("hp3834 candidate-2 PR-4.4j capacity 10/10/4 checks: passed");
