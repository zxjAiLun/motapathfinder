"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildReport,
  makeSyntheticDepthBoundaryControl,
  makeSyntheticExecutionErrorControl,
  makeSyntheticOffDiagonalControl,
  makeSyntheticNegativeControl,
  runPairedExpansion,
} = require("./bounded-abstraction-counterexample-search");

const REPORT = path.resolve(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "pr-4.5b-bounded-abstraction-counterexample-search.json",
);
const MARKDOWN = path.resolve(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "pr-4.5b-bounded-abstraction-counterexample-search.md",
);

function normalizeReport(value) {
  const normalized = JSON.parse(JSON.stringify(value));
  delete normalized.generatedAt;
  if (normalized.provenance) delete normalized.provenance.generationCommit;
  return normalized;
}

assert.strictEqual(fs.existsSync(REPORT), true, "PR-4.5b3 report must exist");
assert.strictEqual(fs.existsSync(MARKDOWN), true, "PR-4.5b3 markdown report must exist");

const report = JSON.parse(fs.readFileSync(REPORT, "utf8"));
assert.strictEqual(report.schema, "motapathfinder.pr-4.5b3-true-off-diagonal-regression-control.v1");
assert.strictEqual(report.status, "completed");
assert.strictEqual(report.scope.shadowOnly, true);
assert.strictEqual(report.scope.productionSemanticChange, false);
assert.strictEqual(report.scope.productionDpKeyChanged, false);
assert.strictEqual(report.scope.productionDominanceChanged, false);
assert.strictEqual(report.scope.productionAgendaChanged, false);
assert.strictEqual(report.scope.productionCapacityChanged, false);
assert.strictEqual(report.scope.productionDefaultStrategyChanged, false);
assert.strictEqual(report.search.depth, 2);
assert.strictEqual(report.search.branchCap, 32);
assert.strictEqual(report.search.stateCap, 256);

assert.strictEqual(report.positiveCorpus.expectedOutcome, "equivalent");
assert.strictEqual(report.positiveCorpus.outcome, "equivalent");
assert.strictEqual(report.positiveCorpus.entries.length, 1);
const positive = report.positiveCorpus.entries[0];
assert.strictEqual(positive.fixedPositive, true);
assert.strictEqual(positive.id, "candidate-6-7-decision-14-20");
assert.strictEqual(positive.startDecision, 14);
assert.strictEqual(positive.endDecision, 20);
assert.strictEqual(positive.expectedDecisionCount, 7);
assert.strictEqual(positive.rootCount, 7);
assert.strictEqual(positive.incompleteRootCount, 0);
assert.strictEqual(positive.outcome, "equivalent");
assert.strictEqual(positive.replayErrors.length, 0);
assert.strictEqual(positive.candidateExactKeysMatchArtifact, true);
assert.deepStrictEqual(
  positive.roots.map((root) => root.decision),
  [14, 15, 16, 17, 18, 19, 20],
);
positive.roots.forEach((root) => {
  assert.strictEqual(root.outcome, "equivalent");
  assert.strictEqual(root.depth, 2);
  assert.strictEqual(root.depthReached, 2);
  assert.strictEqual(root.budgetExhausted, false);
  assert.strictEqual(root.exhaustedReason, null);
  assert.strictEqual(root.incompleteReason, null);
  assert.strictEqual(root.initialPair.projectionEqual, true);
  assert.ok(root.expandedPairCount > 0);
  assert.strictEqual(root.expandedPairCount, root.generatedPairCount);
  assert.deepStrictEqual(root.levels.map((level) => level.depth), [0, 1, 2]);
  assert.ok(root.levels.find((level) => level.depth === 2 && level.expandedPairCount > 0));
  assert.strictEqual(root.multiSuccessorActionCount, 0);
  assert.ok(root.maxSuccessorsPerAction <= 1);
  assert.strictEqual(root.generatedCrossProductPairCount, root.generatedPairCount - 1);
});

assert.strictEqual(report.negativeControls.expectedOutcome, "mismatch-witness");
assert.strictEqual(report.negativeControls.outcome, "mismatch-witness");
assert.strictEqual(report.negativeControls.entries.length, 3);
const negative = report.negativeControls.entries.find((entry) => entry.id === "synthetic-reentry-hidden-mutation-v1");
const depthBoundary = report.negativeControls.entries.find((entry) => entry.id === "synthetic-reentry-depth-boundary-v1");
const offDiagonal = report.negativeControls.entries.find((entry) => entry.id === "synthetic-off-diagonal-successor-v1");
assert.strictEqual(negative.id, "synthetic-reentry-hidden-mutation-v1");
assert.strictEqual(negative.outcome, "mismatch-witness");
assert.strictEqual(negative.budgetExhausted, false);
assert.ok(negative.witness);
assert.strictEqual(negative.witness.initialPair.projectionEqual, true);
assert.strictEqual(negative.witness.sharedActionSequence.length, 1);
assert.strictEqual(negative.witness.sharedActionSequence[0].id, "reenter-MT1");
assert.strictEqual(negative.witness.firstUnmatched.kind, "action-set-mismatch");
assert.strictEqual(negative.witness.firstUnmatched.actionId, "historical-tile@MT1");
assert.ok(negative.witness.firstUnmatched.rightOnlyActions.includes("historical-tile@MT1"));
assert.strictEqual(depthBoundary.outcome, "mismatch-witness");
assert.strictEqual(depthBoundary.budgetExhausted, false);
assert.strictEqual(depthBoundary.witness.sharedActionSequence.length, 2);
assert.deepStrictEqual(
  depthBoundary.witness.sharedActionSequence.map((action) => action.id),
  ["reenter-MT1", "enter-history-zone"],
);
assert.strictEqual(depthBoundary.witness.firstUnmatched.depth, 2);
assert.strictEqual(depthBoundary.witness.firstUnmatched.actionId, "historical-tile@MT1");
assert.strictEqual(offDiagonal.outcome, "mismatch-witness");
assert.strictEqual(offDiagonal.witness.firstUnmatched.depth, 1);
assert.strictEqual(offDiagonal.witness.firstUnmatched.actionId, "lane-2");
assert.deepStrictEqual(offDiagonal.witness.sharedActionSequence.map((action) => action.id), ["branch"]);
assert.strictEqual(offDiagonal.witness.currentPair.projectionEqual, true);
assert.notStrictEqual(
  offDiagonal.witness.currentPair.exactKeyHashes.left,
  offDiagonal.witness.currentPair.exactKeyHashes.right,
);
assert.strictEqual(offDiagonal.multiSuccessorActionCount, 1);
assert.strictEqual(offDiagonal.maxSuccessorsPerAction, 2);
assert.strictEqual(offDiagonal.generatedCrossProductPairCount, 4);
assert.strictEqual(report.summary.positiveCorpusEquivalent, true);
assert.strictEqual(report.summary.negativeControlFoundWitness, true);
assert.strictEqual(report.summary.depthBoundaryControlFoundWitness, true);
assert.strictEqual(report.summary.offDiagonalControlFoundWitness, true);
assert.strictEqual(report.summary.anyIncomplete, false);
assert.ok(report.provenance.manifestSha256);
assert.ok(report.provenance.productionStateKeySha256);
assert.ok(fs.readFileSync(MARKDOWN, "utf8").includes("historical-tile@MT1"));

const budgetProbe = makeSyntheticNegativeControl();
const incomplete = runPairedExpansion(budgetProbe.root, budgetProbe.adapter, {
  depth: 2,
  branchCap: 32,
  stateCap: 1,
});
assert.strictEqual(incomplete.outcome, "incomplete");
assert.strictEqual(incomplete.budgetExhausted, true);
assert.strictEqual(incomplete.exhaustedReason, "state-cap");
assert.strictEqual(incomplete.incompleteReason, "state-cap");

const branchProbe = makeSyntheticNegativeControl();
const branchIncomplete = runPairedExpansion(branchProbe.root, branchProbe.adapter, {
  depth: 2,
  branchCap: 1,
  stateCap: 256,
});
assert.strictEqual(branchIncomplete.outcome, "incomplete");
assert.strictEqual(branchIncomplete.budgetExhausted, true);
assert.strictEqual(branchIncomplete.exhaustedReason, "branch-cap");
assert.strictEqual(branchIncomplete.incompleteReason, "branch-cap");

const depthZero = runPairedExpansion(budgetProbe.root, budgetProbe.adapter, {
  depth: 0,
  branchCap: 32,
  stateCap: 256,
});
assert.strictEqual(depthZero.outcome, "equivalent");
assert.strictEqual(depthZero.depthReached, 0);
assert.strictEqual(depthZero.expandedPairCount, 1);
assert.strictEqual(depthZero.generatedPairCount, 1);
assert.deepStrictEqual(depthZero.levels.map((level) => level.depth), [0]);
assert.strictEqual(depthZero.generatedCrossProductPairCount, 0);

const enumerationFailure = makeSyntheticExecutionErrorControl("enumeration-error");
const enumerationIncomplete = runPairedExpansion(enumerationFailure.root, enumerationFailure.adapter, {
  depth: 2,
  branchCap: 32,
  stateCap: 256,
});
assert.strictEqual(enumerationIncomplete.outcome, "incomplete");
assert.strictEqual(enumerationIncomplete.budgetExhausted, false);
assert.strictEqual(enumerationIncomplete.incompleteReason, "enumeration-error");
assert.strictEqual(enumerationIncomplete.witness, null);

const applicationFailure = makeSyntheticExecutionErrorControl("action-application-error");
const applicationIncomplete = runPairedExpansion(applicationFailure.root, applicationFailure.adapter, {
  depth: 2,
  branchCap: 32,
  stateCap: 256,
});
assert.strictEqual(applicationIncomplete.outcome, "incomplete");
assert.strictEqual(applicationIncomplete.budgetExhausted, false);
assert.strictEqual(applicationIncomplete.incompleteReason, "action-application-error");
assert.strictEqual(applicationIncomplete.witness, null);

const duplicateFailure = makeSyntheticExecutionErrorControl("duplicate-action-id");
const duplicateIncomplete = runPairedExpansion(duplicateFailure.root, duplicateFailure.adapter, {
  depth: 2,
  branchCap: 32,
  stateCap: 256,
});
assert.strictEqual(duplicateIncomplete.outcome, "incomplete");
assert.strictEqual(duplicateIncomplete.budgetExhausted, false);
assert.strictEqual(duplicateIncomplete.incompleteReason, "duplicate-action-id");

const directOffDiagonal = makeSyntheticOffDiagonalControl();
const diagonalL1R1 = runPairedExpansion({
  id: "synthetic-off-diagonal-diagonal-L1-R1",
  left: { ...directOffDiagonal.root.left, variant: "L1" },
  right: { ...directOffDiagonal.root.right, variant: "R1" },
}, directOffDiagonal.adapter, {
  depth: 0,
  branchCap: 32,
  stateCap: 256,
});
const diagonalL2R2 = runPairedExpansion({
  id: "synthetic-off-diagonal-diagonal-L2-R2",
  left: { ...directOffDiagonal.root.left, variant: "L2" },
  right: { ...directOffDiagonal.root.right, variant: "R2" },
}, directOffDiagonal.adapter, {
  depth: 0,
  branchCap: 32,
  stateCap: 256,
});
assert.strictEqual(diagonalL1R1.outcome, "equivalent");
assert.strictEqual(diagonalL1R1.depthReached, 0);
assert.strictEqual(diagonalL2R2.outcome, "equivalent");
assert.strictEqual(diagonalL2R2.depthReached, 0);
const directOffDiagonalResult = runPairedExpansion(directOffDiagonal.root, directOffDiagonal.adapter, {
  depth: 2,
  branchCap: 32,
  stateCap: 256,
});
assert.strictEqual(directOffDiagonalResult.outcome, "mismatch-witness");
assert.strictEqual(directOffDiagonalResult.generatedCrossProductPairCount, 4);

const depthProbe = makeSyntheticDepthBoundaryControl();
const depthProbeResult = runPairedExpansion(depthProbe.root, depthProbe.adapter, {
  depth: 2,
  branchCap: 32,
  stateCap: 256,
});
assert.strictEqual(depthProbeResult.outcome, "mismatch-witness");
assert.strictEqual(depthProbeResult.witness.firstUnmatched.depth, 2);

// The fixture is checked against a live rebuild so a stale generated report
// cannot mask a change in the bounded search implementation.
const rebuilt = buildReport();
assert.deepStrictEqual(normalizeReport(rebuilt), normalizeReport(report));
assert.strictEqual(rebuilt.status, "completed");
assert.strictEqual(rebuilt.positiveCorpus.outcome, "equivalent");
assert.strictEqual(rebuilt.negativeControls.outcome, "mismatch-witness");
assert.strictEqual(rebuilt.positiveCorpus.entries[0].rootCount, 7);
assert.strictEqual(
  rebuilt.negativeControls.entries.find((entry) => entry.id === "synthetic-reentry-depth-boundary-v1").witness.firstUnmatched.actionId,
  "historical-tile@MT1",
);
assert.strictEqual(
  rebuilt.negativeControls.entries.find((entry) => entry.id === "synthetic-off-diagonal-successor-v1").generatedCrossProductPairCount,
  4,
);
assert.strictEqual(rebuilt.provenance.manifestSha256, report.provenance.manifestSha256);
assert.strictEqual(rebuilt.provenance.productionStateKeySha256, report.provenance.productionStateKeySha256);

console.log("PR-4.5b3 bounded abstraction counterexample checks: passed");
