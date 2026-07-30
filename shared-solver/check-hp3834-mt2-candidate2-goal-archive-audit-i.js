"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const reportFile = path.resolve(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "mt2-candidate2-goal-archive-audit-i.json",
);

assert.strictEqual(fs.existsSync(reportFile), true, "PR-4.4i report must exist");
const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
assert.strictEqual(report.status, "completed");
assert.strictEqual(report.auditStatus, "completed");
assert.strictEqual(report.teacherEntryArchiveOutcome, "rejected-by-goal-archive-capacity");
assert.strictEqual(report.boundaryWitnessContinuation, "inconclusive");
assert.strictEqual(report.productionSemanticChange, false);
assert.strictEqual(report.pipelineEvidence.firstAbsentPipelineStage, "raw-dp-goal-archive");
assert.strictEqual(report.pipelineEvidence.goalAccepted, true);
assert.strictEqual(
  report.pipelineEvidence.stages.find((stage) => stage.id === "raw-dp-goal-archive").present,
  false,
);
assert.strictEqual(report.goalArchiveAudit.entryStage != null, true);
assert.strictEqual(report.goalArchiveAudit.teacherEntry != null, true);
const teacherEntry = report.goalArchiveAudit.teacherEntry;
const entryStage = report.goalArchiveAudit.entryStage;
assert.strictEqual(teacherEntry.insertionCount, 1);
assert.strictEqual(teacherEntry.archiveDecision, "rejected-by-goal-archive-capacity");
assert.strictEqual(teacherEntry.witnessKind, "goal-archive-capacity-boundary");
assert.strictEqual(teacherEntry.activeAtFinish, true);
assert.strictEqual(teacherEntry.selectedAtFinish, false);
assert.deepStrictEqual(teacherEntry.evictions, []);
assert.deepStrictEqual(teacherEntry.rejections, []);
assert.strictEqual(teacherEntry.actualReplacementWitness, null);
assert.ok(teacherEntry.capacityBoundaryWitness);
assert.ok(teacherEntry.capacityBoundaryWitness.state);
assert.deepStrictEqual(teacherEntry.rawSortRanks, [9]);
assert.deepStrictEqual(teacherEntry.selectedArchiveRanks, []);
assert.strictEqual(report.goalArchiveAudit.entryStage.goalNodesSeen, 10);
assert.strictEqual(report.goalArchiveAudit.entryStage.goalArchiveCapacity, 8);
assert.strictEqual(entryStage.activeGoalNodes, 10);
assert.strictEqual(entryStage.selectedGoalNodes, 8);
assert.strictEqual(entryStage.activeCandidates.length, 10);
const boundary = entryStage.activeCandidates.find((entry) => entry.rawSortRank === 7);
assert.ok(boundary);
assert.strictEqual(boundary.selected, true);
assert.strictEqual(boundary.selectedArchiveRank, 7);
assert.deepStrictEqual(boundary.candidate.hero, {
  hp: 1970,
  hpmax: 9999,
  atk: 21,
  def: 17,
  mdef: 130,
  lv: 3,
  exp: 7,
  money: 0,
  loc: { x: 6, y: 0 },
});
assert.strictEqual(teacherEntry.capacityBoundaryWitness.nodeId, boundary.candidate.nodeId);
assert.strictEqual(teacherEntry.comparison.result, -369);
assert.strictEqual(teacherEntry.comparison.hpDiff, -369);
assert.strictEqual(teacherEntry.comparison.effectiveAtkDiff, 0);
assert.strictEqual(teacherEntry.comparison.effectiveDefDiff, 0);
assert.strictEqual(teacherEntry.comparison.effectiveMdefDiff, 0);
assert.strictEqual(teacherEntry.comparison.rawExpDiff, -1);
assert.strictEqual(teacherEntry.comparison.routeLengthDiff, -3);
assert.strictEqual(teacherEntry.comparison.firstDecidingField, "hp");
const continuation = report.goalArchiveAudit.actualWitnessContinuation;
assert.strictEqual(continuation.executed, true);
assert.strictEqual(continuation.search.found, false);
assert.strictEqual(continuation.reachedMt2Hp3834, false);
assert.strictEqual(continuation.search.completion.classification, "inconclusive");
const localAttempt = continuation.search.segmentResults
  .find((segment) => segment.segmentId === "mt2-local-3582").attempts[0];
const hpAttempt = continuation.search.segmentResults
  .find((segment) => segment.segmentId === "mt2-hp3834").attempts[0];
assert.strictEqual(localAttempt.expansions, 160);
assert.strictEqual(localAttempt.frontierSize, 0);
assert.strictEqual(hpAttempt.expansions, 900);
assert.strictEqual(hpAttempt.frontierSize, 31);
assert.strictEqual(hpAttempt.expansionBudgetExhausted, true);
assert.strictEqual(hpAttempt.actionTrimmed, 0);

console.log("hp3834 candidate-2 PR-4.4i goal archive audit checks: passed");
