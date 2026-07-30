"use strict";

const assert = require("assert");

const {
  annotateLifecycleCoverage,
  classifySearch,
  classifyIsolatedSearch,
  exactLineagePipelineEvidence,
  hardTilesMatchExpected,
  summarizePipelineStages,
} = require("./audit-hp3834-mt2-candidate2-natural-search");

function attempt(overrides) {
  return {
    found: true,
    diagnostics: {
      dp: {
        expansions: 3,
        frontierSize: 0,
        stoppedReason: null,
        actionTrimmed: 0,
        expansionBudgetExhausted: false,
      },
    },
    ...overrides,
  };
}

const completeRun = classifySearch({
  found: true,
  segmentResults: [{ attempts: [attempt({})] }],
});
assert.strictEqual(completeRun.classification, "success");
assert.strictEqual(completeRun.completeWithinConfiguredActionSet, true);

const failedRun = classifySearch({
  found: false,
  segmentResults: [{ attempts: [attempt({ found: false })] }],
});
assert.strictEqual(failedRun.classification, "failed");

const inconclusiveRun = classifySearch({
  found: false,
  segmentResults: [{ attempts: [attempt({
    diagnostics: {
      dp: {
        expansions: 900,
        frontierSize: 4,
        stoppedReason: null,
        actionTrimmed: 0,
        expansionBudgetExhausted: true,
      },
    },
  })] }],
});
assert.strictEqual(inconclusiveRun.classification, "inconclusive");
assert.deepStrictEqual(inconclusiveRun.incompleteAttempts[0].incompleteReasons, [
  "frontier-nonempty",
  "expansion-budget-exhausted",
]);

const stages = summarizePipelineStages({
  attempts: [{
    segmentId: "mt2-entry",
    candidateId: "candidate-2",
    rawGoalSkylineStates: [{ id: "raw-1" }],
    segmentGoalSkyline: [{ id: "segment-1" }],
  }],
  merges: [{
    segmentId: "mt2-entry",
    merged: [{ id: "merged-1" }],
  }],
}, ["mt2-entry", "mt2-local-3582"]);
assert.strictEqual(stages[0].observed, true);
assert.strictEqual(stages[0].productionSuccessor.attemptsObserved, 1);
assert.strictEqual(stages[0].rawDpGoalArchive.candidateCount, 1);
assert.strictEqual(stages[0].segmentGoalCandidates.candidateCount, 1);
assert.strictEqual(stages[0].mergedCheckpointFrontier.candidateCount, 1);
assert.strictEqual(stages[1].observed, false);

const hardTiles = [
  ["MT2", 4, 7],
  ["MT2", 8, 7],
  ["MT2", 10, 8],
  ["MT2", 11, 11],
  ["MT2", 6, 6],
  ["MT2", 6, 8],
  ["MT2", 6, 9],
].map(([floorId, x, y]) => ({ floorId, x, y, present: true }));
assert.strictEqual(hardTilesMatchExpected(hardTiles), true);
assert.strictEqual(hardTilesMatchExpected(hardTiles.slice(0, -1)), false);

const lifecycleRecords = {};
for (let decision = 11; decision <= 23; decision += 1) {
  lifecycleRecords[`decision-${decision}`] = {
    decisionIndex: decision,
    generated: decision <= 12,
    successorGenerated: decision <= 12,
    skylineInserted: decision <= 12,
    agendaPopped: decision <= 12,
    goalAccepted: decision === 12,
    postRejoined: decision <= 12,
    events: decision <= 12 ? [{ eventType: "candidateGenerated" }] : [],
    classification: decision <= 12 ? "goal-accepted" : "candidate-not-generated",
  };
}
const coverage = annotateLifecycleCoverage(
  { records: lifecycleRecords, eventCounts: {}, goalEvents: [], gateGoalEvents: [] },
  { goalAccepted: true, firstAbsentPipelineStage: "raw-dp-goal-archive" },
);
assert.strictEqual(coverage.decisionTargetsDefined, true);
assert.strictEqual(coverage.lastNaturallyTrackedDecision, 12);
assert.strictEqual(coverage.firstUnobservedDecision, 13);
assert.strictEqual(coverage.postDropDecisionsClassifiedNotApplicable, true);
assert.strictEqual(coverage.records["decision-13"].classification, "not-applicable-exact-lineage-absent");

const pipelineEvidence = exactLineagePipelineEvidence(
  null,
  {
    attempts: [{
      segmentId: "mt2-entry",
      rawGoalSkylineStates: [{ exactStateKey: "other" }, { exactStateKey: "teacher" }],
      segmentGoalSkyline: [{ exactStateKey: "other" }],
    }],
    rawMerges: [{ segmentId: "mt2-entry", merged: [{ id: "replacement", exactStateKey: "replacement" }] }],
  },
  { id: "mt2-entry" },
  "teacher",
);
assert.strictEqual(pipelineEvidence.stages[0].present, true);
assert.strictEqual(pipelineEvidence.stages[1].present, false);
assert.strictEqual(pipelineEvidence.firstAbsentPipelineStage, "segment-goal-skyline");
assert.strictEqual(pipelineEvidence.replacingCandidates[0].id, "replacement");

const isolatedClassification = classifyIsolatedSearch([
  { search: { found: false, completion: inconclusiveRun } },
  { search: { found: true, completion: completeRun } },
]);
assert.strictEqual(isolatedClassification.classification, "inconclusive");

console.log("hp3834 candidate-2 natural search audit checks: 25/25 passed");
