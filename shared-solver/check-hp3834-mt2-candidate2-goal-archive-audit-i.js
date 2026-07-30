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
assert.strictEqual(report.pipelineEvidence.firstAbsentPipelineStage, "raw-dp-goal-archive");
assert.strictEqual(report.pipelineEvidence.goalAccepted, true);
assert.strictEqual(
  report.pipelineEvidence.stages.find((stage) => stage.id === "raw-dp-goal-archive").present,
  false,
);
assert.strictEqual(report.goalArchiveAudit.entryStage != null, true);
assert.strictEqual(report.goalArchiveAudit.teacherEntry != null, true);
assert.ok(report.goalArchiveAudit.teacherEntry.insertionCount > 0);
assert.ok(
  [
    "evicted-by-skyline-replacement",
    "rejected-by-goal-archive-capacity",
    "rejected-by-dp-skyline-capacity",
    "rejected-by-dominance",
  ].includes(report.goalArchiveAudit.teacherEntry.archiveDecision),
  `unexpected archive decision: ${report.goalArchiveAudit.teacherEntry.archiveDecision}`,
);
assert.strictEqual(report.goalArchiveAudit.teacherEntry.actualReplacementWitness != null, true);
assert.ok(report.goalArchiveAudit.teacherEntry.actualReplacementWitness.state);
assert.strictEqual(report.goalArchiveAudit.teacherEntry.comparison.firstDecidingField, "hp");
assert.strictEqual(report.goalArchiveAudit.entryStage.goalNodesSeen, 10);
assert.strictEqual(report.goalArchiveAudit.entryStage.goalArchiveCapacity, 8);
assert.strictEqual(report.goalArchiveAudit.entryStage.activeCandidates.length, 10);
assert.strictEqual(report.goalArchiveAudit.actualWitnessContinuation.executed, true);
assert.strictEqual(report.goalArchiveAudit.actualWitnessContinuation.search != null, true);
assert.ok(report.goalArchiveAudit.actualWitnessContinuation.search.completion);

console.log("hp3834 candidate-2 PR-4.4i goal archive audit checks: passed");
