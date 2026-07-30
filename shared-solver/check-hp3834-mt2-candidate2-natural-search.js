"use strict";

const assert = require("assert");

const {
  classifySearch,
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

console.log("hp3834 candidate-2 natural search audit checks: 13/13 passed");
