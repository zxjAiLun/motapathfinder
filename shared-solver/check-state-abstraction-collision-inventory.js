"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const {
  makeSyntheticDepthBoundaryControl,
  makeSyntheticExecutionErrorControl,
  makeSyntheticNegativeControl,
  makeSyntheticOffDiagonalControl,
  runPairedExpansion,
} = require("./bounded-abstraction-counterexample-search");
const {
  buildReport: buildInventoryReport,
  extractSourceRecords,
} = require("./mine-state-abstraction-collisions");

function normalizeSelectedPairs(report) {
  return report.pairs.map((pair) => JSON.parse(JSON.stringify({
    id: pair.id,
    groupId: pair.groupId,
    signatureId: pair.signatureId,
    outcome: pair.outcome,
    left: pair.left,
    right: pair.right,
    initialPair: pair.initialPair,
    riskLabels: pair.riskLabels,
    depth: pair.depth,
    depthReached: pair.depthReached,
    expandedPairCount: pair.expandedPairCount,
    generatedPairCount: pair.generatedPairCount,
    budgetExhausted: pair.budgetExhausted,
    exhaustedReason: pair.exhaustedReason,
    incompleteReason: pair.incompleteReason,
    branchCap: pair.branchCap,
    stateCap: pair.stateCap,
    multiSuccessorActionCount: pair.multiSuccessorActionCount,
    maxSuccessorsPerAction: pair.maxSuccessorsPerAction,
    generatedCrossProductPairCount: pair.generatedCrossProductPairCount,
    exactRejoinObserved: pair.exactRejoinObserved,
    executionErrors: pair.executionErrors,
    levels: pair.levels,
    witness: pair.witness,
  })));
}

const MANIFEST = path.resolve(__dirname, "profiles", "state-abstraction-mining-sources.json");
const REPORT = path.resolve(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "pr-4.5c-state-abstraction-collision-inventory.json",
);
const MARKDOWN = path.resolve(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "pr-4.5c-state-abstraction-collision-inventory.md",
);

assert.strictEqual(fs.existsSync(MANIFEST), true, "PR-4.5c source manifest must exist");
assert.strictEqual(fs.existsSync(REPORT), true, "PR-4.5c inventory report must exist");
assert.strictEqual(fs.existsSync(MARKDOWN), true, "PR-4.5c inventory markdown must exist");

const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
const report = JSON.parse(fs.readFileSync(REPORT, "utf8"));

assert.strictEqual(report.schema, "motapathfinder.pr-4.5c1-state-abstraction-collision-inventory.v1");
assert.strictEqual(report.status, "completed");
assert.strictEqual(report.scope.shadowOnly, true);
assert.strictEqual(report.scope.productionSemanticChange, false);
assert.deepStrictEqual(report.scope.productionChanges, []);
assert.strictEqual(report.scope.productionDpKeyChanged, false);
assert.strictEqual(report.scope.productionDominanceChanged, false);
assert.strictEqual(report.scope.productionAgendaChanged, false);
assert.strictEqual(report.scope.productionCapacityChanged, false);
assert.strictEqual(report.scope.productionDefaultStrategyChanged, false);
assert.strictEqual(report.search.depth, 2);
assert.strictEqual(report.search.branchCap, 32);
assert.strictEqual(report.search.stateCap, 256);
assert.strictEqual(report.provenance.relationEvaluator, "bounded-abstraction-counterexample-search.runPairedExpansion");
assert.ok(report.provenance.productionStateKeySha256);

assert.strictEqual(report.summary.sourceArtifactCount, 2);
assert.strictEqual(report.summary.statesScanned, 40);
assert.strictEqual(report.summary.collisionOccurrenceCount, 12);
assert.strictEqual(report.summary.uniqueCollisionSignatureCount, 7);
assert.strictEqual(report.summary.duplicateSignatureOccurrenceCount, 5);
assert.strictEqual(report.summary.exactDistinctPairCount, 12);
assert.strictEqual(report.summary.selectedPairOccurrenceCount, 8);
assert.strictEqual(report.summary.selectedUniqueSignatureCount, 5);
assert.strictEqual(report.summary.repeatedSignatureSelectionCount, 3);
assert.strictEqual(report.summary.signatureIdsWithSkippedOccurrences, 3);
assert.strictEqual(report.summary.unselectedUniqueSignatureCount, 2);
assert.strictEqual(report.summary.uniqueSignaturesSkippedByCap, 3);
assert.strictEqual(report.summary.pairsSelected, 8);
assert.strictEqual(report.summary.pairsSkippedByCap, 4);
assert.deepStrictEqual(report.summary.outcomeCounts, {
  equivalent: 2,
  "mismatch-witness": 6,
  incomplete: 0,
});
assert.strictEqual(report.summary.fixedCandidate67Equivalent, true);
assert.strictEqual(report.summary.anyIncomplete, false);

const expectedSources = [
  {
    id: "mt2-candidate2-natural-search-audit",
    artifact: "shared-solver/routes/generated/agenda-policy-evaluation/mt2-candidate2-natural-search-audit.json",
    sha256: "7cece9af208b52e99ac63c6b379df1893ea65902aec4d0dd2c3fb04d4270d813",
    statesScanned: 20,
    collisionOccurrenceCount: 5,
    uniqueCollisionSignatureCount: 5,
    pairsSelected: 4,
    pairsSkippedByCap: 1,
  },
  {
    id: "mt2-candidate2-capacity10-j",
    artifact: "shared-solver/routes/generated/agenda-policy-evaluation/mt2-candidate2-capacity10-j.json",
    sha256: "63ef50026429386fac62c2d40558f2bc7ff0e1168b5450c0783016fac6f9ce74",
    statesScanned: 20,
    collisionOccurrenceCount: 7,
    uniqueCollisionSignatureCount: 7,
    pairsSelected: 4,
    pairsSkippedByCap: 3,
  },
];
assert.deepStrictEqual(report.sources.map((source) => ({
  id: source.id,
  artifact: source.artifact.replaceAll("\\", "/"),
  sha256: source.sourceSha256,
  statesScanned: source.statesScanned,
  collisionOccurrenceCount: source.collisionOccurrenceCount,
  uniqueCollisionSignatureCount: source.uniqueCollisionSignatureCount,
  pairsSelected: source.pairsSelected,
  pairsSkippedByCap: source.pairsSkippedByCap,
})), expectedSources);
report.sources.forEach((source) => {
  assert.strictEqual(source.sourceSha256MatchesManifest, true);
  assert.strictEqual(source.declaredSourceSha256, source.sourceSha256);
  assert.strictEqual(source.extractionErrors.length, 0);
  source.collections.forEach((collection) => assert.ok(collection.stateExtractionMode));
});
assert.deepStrictEqual(
  manifest.sources.map((source) => ({ id: source.id, artifact: source.artifact, sourceSha256: source.sourceSha256 })),
  expectedSources.map((source) => ({ id: source.id, artifact: source.artifact.replaceAll("\\", "/"), sourceSha256: source.sha256 })),
);

const expectedGroups = [
  "occurrence-072f4759ab7dae16|signature-73cf9485b7f59b61|mt2-candidate2-capacity10-j|mt2-candidate2-checkpoints::mt2-local-3582",
  "occurrence-1b2ab894fe0b15b9|signature-525cbdbf6523c718|mt2-candidate2-capacity10-j|mt2-candidate2-checkpoints::mt2-entry",
  "occurrence-3c5ed53a4315754c|signature-3736d53c669215b6|mt2-candidate2-natural-search-audit|mt2-entry-and-local-3582::mt2-local-3582",
  "occurrence-59e1c6a98c0e68d2|signature-df6047f6355f4711|mt2-candidate2-natural-search-audit|mt2-entry-and-local-3582::mt2-local-3582",
  "occurrence-742c9e9020b6974c|signature-65d161c7f079815f|mt2-candidate2-natural-search-audit|mt2-entry-and-local-3582::mt2-entry",
  "occurrence-795d4bf97484ddc2|signature-1981d0728653eb7b|mt2-candidate2-natural-search-audit|mt2-entry-and-local-3582::mt2-entry",
  "occurrence-8dad8dacc9ed379c|signature-1aeddbf2e6765b01|mt2-candidate2-capacity10-j|mt2-candidate2-checkpoints::mt2-entry",
  "occurrence-b3a8e97e9e72b1b9|signature-65d161c7f079815f|mt2-candidate2-capacity10-j|mt2-candidate2-checkpoints::mt2-entry",
  "occurrence-c71b42f739f3372f|signature-525cbdbf6523c718|mt2-candidate2-natural-search-audit|mt2-entry-and-local-3582::mt2-entry",
  "occurrence-ea97de6b89731723|signature-1981d0728653eb7b|mt2-candidate2-capacity10-j|mt2-candidate2-checkpoints::mt2-entry",
  "occurrence-eb861b415eab0de8|signature-3736d53c669215b6|mt2-candidate2-capacity10-j|mt2-candidate2-checkpoints::mt2-local-3582",
  "occurrence-f789863786707354|signature-df6047f6355f4711|mt2-candidate2-capacity10-j|mt2-candidate2-checkpoints::mt2-local-3582",
];
assert.deepStrictEqual(
  report.collisionGroups.map((group) => `${group.id}|${group.signatureId}|${group.sourceId}|${group.scopeKey}`),
  expectedGroups,
);
assert.strictEqual(new Set(report.collisionGroups.map((group) => group.id)).size, report.collisionGroups.length);
const groupById = new Map(report.collisionGroups.map((group) => [group.id, group]));

const expectedPairIds = [
  "pair-11cec6a5f310031c",
  "pair-130c13a9af1762d4",
  "pair-49f587da8e0c8c54",
  "pair-5bc2408a0ea338e4",
  "pair-5bee390b0cf25ff2",
  "pair-6ced6eb6087fc42c",
  "pair-a1d7bd817cb51d1f",
  "pair-d34460544b8e66ff",
];
assert.deepStrictEqual(report.pairs.map((pair) => pair.id), expectedPairIds);
report.pairs.forEach((pair) => {
  assert.ok(groupById.has(pair.groupId));
  assert.strictEqual(pair.signatureId, groupById.get(pair.groupId).signatureId);
  [pair.left, pair.right].forEach((record) => {
    assert.strictEqual(record.stateId, [record.sourceId, record.collectionId, record.checkpointId, record.candidateId].join("::"));
  });
  assert.strictEqual(pair.initialPair.projectionEqual, true);
  assert.notStrictEqual(pair.initialPair.exactKeyHashes.left, pair.initialPair.exactKeyHashes.right);
  assert.ok(pair.riskLabels);
  [
    "nonCurrentFloorMutationDiff",
    "currentFloorMutationDiff",
    "leaveLocOrDirectionDiff",
    "triggeredAutoEventsPresent",
    "crossFloorActionAvailable",
    "multiSuccessorObserved",
    "exactRejoinObserved",
  ].forEach((label) => assert.ok(["true", "false", "unknown"].includes(pair.riskLabels[label])));
  if (pair.outcome === "mismatch-witness") {
    assert.strictEqual(pair.executionErrors, null, `execution errors cannot be a mismatch witness: ${pair.id}`);
    assert.ok(pair.witness);
    assert.ok(pair.witness.initialPair);
    assert.ok(pair.witness.currentPair);
    assert.ok(Array.isArray(pair.witness.sharedActionSequence));
    assert.ok(pair.witness.firstUnmatched);
    const firstUnmatched = pair.witness.firstUnmatched;
    if (firstUnmatched.kind === "projected-successor-relation-mismatch") {
      assert.ok(firstUnmatched.successorMismatch);
      assert.strictEqual(firstUnmatched.successorMismatch.projectedEqual, false);
      assert.strictEqual(firstUnmatched.actionId, firstUnmatched.successorMismatch.id);
    } else {
      assert.strictEqual(firstUnmatched.kind, "action-set-mismatch");
      assert.strictEqual(firstUnmatched.successorMismatch, null);
      assert.ok(firstUnmatched.leftOnlyActions.includes(firstUnmatched.actionId) || firstUnmatched.rightOnlyActions.includes(firstUnmatched.actionId));
    }
  }
});
const missingCheckpointProbe = extractSourceRecords({
  id: "probe-source",
  collections: [{
    id: "probe-collection",
    path: "checkpoints",
    checkpointIds: ["missing-checkpoint"],
    candidateLimit: 1,
    statePath: "state",
  }],
}, { checkpoints: [{ segmentId: "present-checkpoint", candidates: [] }] });
assert.ok(missingCheckpointProbe.errors.some((error) => error.reason === "checkpoint-id-not-found"));
assert.deepStrictEqual(report.selectedPairRiskStrata.nonCurrentFloorMutationDiff, { true: 8, false: 0, unknown: 0 });
assert.deepStrictEqual(report.selectedPairRiskStrata.currentFloorMutationDiff, { true: 0, false: 8, unknown: 0 });
assert.deepStrictEqual(report.selectedPairRiskStrata.crossFloorActionAvailable, { true: 8, false: 0, unknown: 0 });
assert.deepStrictEqual(report.selectedPairRiskStrata.exactRejoinObserved, { true: 2, false: 6, unknown: 0 });
assert.deepStrictEqual(report.fixedControlRiskStrata.exactRejoinObserved, { true: 1, false: 0, unknown: 0 });
assert.deepStrictEqual(report.allEvaluatedRiskStrata.exactRejoinObserved, { true: 3, false: 6, unknown: 0 });

assert.strictEqual(report.fixedControls.length, 1);
const fixed = report.fixedControls[0];
assert.strictEqual(fixed.id, "candidate-6-7-local-control");
assert.strictEqual(fixed.sourceId, "mt2-candidate2-capacity10-j");
assert.strictEqual(fixed.collectionId, "mt2-candidate2-checkpoints");
assert.strictEqual(fixed.checkpointId, "mt2-local-3582");
assert.strictEqual(fixed.leftCandidateId, "mt2-local-3582:candidate-6");
assert.strictEqual(fixed.rightCandidateId, "mt2-local-3582:candidate-7");
assert.strictEqual(fixed.groupId, "occurrence-072f4759ab7dae16");
assert.strictEqual(fixed.signatureId, "signature-73cf9485b7f59b61");
assert.strictEqual(fixed.pairId, "pair-02d64376fd4f33c5");
assert.strictEqual(fixed.expectedOutcome, "equivalent");
assert.strictEqual(fixed.outcome, "equivalent");
assert.strictEqual(fixed.initialPair.projectionEqual, true);
assert.notStrictEqual(fixed.initialPair.exactKeyHashes.left, fixed.initialPair.exactKeyHashes.right);
assert.strictEqual(fixed.initialPair.projectionKeyHashes.left, "cc9e3675eb9ea718");
assert.strictEqual(fixed.initialPair.projectionKeyHashes.right, "cc9e3675eb9ea718");
assert.strictEqual(fixed.left.exactKeyHash, "4c07c9e40535fbf8");
assert.strictEqual(fixed.right.exactKeyHash, "5fcb8937e15bd360");
assert.strictEqual(fixed.left.candidateId, fixed.leftCandidateId);
assert.strictEqual(fixed.right.candidateId, fixed.rightCandidateId);
assert.strictEqual(fixed.exactRejoinObserved, true);
assert.strictEqual(fixed.executionErrors, null);
assert.strictEqual(fixed.budgetExhausted, false);
const manifestFixedControl = manifest.sources.find((source) => source.id === fixed.sourceId).fixedControls;
assert.deepStrictEqual(manifestFixedControl, [{
  id: "candidate-6-7-local-control",
  collectionId: "mt2-candidate2-checkpoints",
  checkpointId: "mt2-local-3582",
  leftCandidateId: "mt2-local-3582:candidate-6",
  rightCandidateId: "mt2-local-3582:candidate-7",
  expectedOutcome: "equivalent",
}]);

const syntheticNegative = makeSyntheticNegativeControl();
const syntheticNegativeResult = runPairedExpansion(syntheticNegative.root, syntheticNegative.adapter, {
  depth: 2,
  branchCap: 32,
  stateCap: 256,
});
assert.strictEqual(syntheticNegativeResult.outcome, "mismatch-witness");
assert.ok(syntheticNegativeResult.witness.currentPair);
assert.strictEqual(syntheticNegativeResult.witness.firstUnmatched.kind, "action-set-mismatch");
assert.strictEqual(syntheticNegativeResult.witness.firstUnmatched.successorMismatch, null);
assert.ok(syntheticNegativeResult.witness.firstUnmatched.rightOnlyActions.includes(syntheticNegativeResult.witness.firstUnmatched.actionId));

const syntheticDepthBoundary = makeSyntheticDepthBoundaryControl();
const syntheticDepthResult = runPairedExpansion(syntheticDepthBoundary.root, syntheticDepthBoundary.adapter, {
  depth: 2,
  branchCap: 32,
  stateCap: 256,
});
assert.strictEqual(syntheticDepthResult.outcome, "mismatch-witness");
assert.strictEqual(syntheticDepthResult.witness.firstUnmatched.depth, 2);
assert.strictEqual(syntheticDepthResult.witness.firstUnmatched.kind, "action-set-mismatch");
assert.strictEqual(syntheticDepthResult.witness.firstUnmatched.successorMismatch, null);

const syntheticOffDiagonal = makeSyntheticOffDiagonalControl();
const syntheticOffDiagonalResult = runPairedExpansion(syntheticOffDiagonal.root, syntheticOffDiagonal.adapter, {
  depth: 2,
  branchCap: 32,
  stateCap: 256,
});
assert.strictEqual(syntheticOffDiagonalResult.outcome, "mismatch-witness");
assert.strictEqual(syntheticOffDiagonalResult.generatedCrossProductPairCount, 4);
assert.strictEqual(syntheticOffDiagonalResult.multiSuccessorActionCount, 1);
assert.strictEqual(syntheticOffDiagonalResult.maxSuccessorsPerAction, 2);
assert.strictEqual(syntheticOffDiagonalResult.witness.firstUnmatched.kind, "action-set-mismatch");
assert.strictEqual(syntheticOffDiagonalResult.witness.firstUnmatched.successorMismatch, null);
assert.ok(syntheticOffDiagonalResult.witness.firstUnmatched.leftOnlyActions.includes(syntheticOffDiagonalResult.witness.firstUnmatched.actionId) ||
  syntheticOffDiagonalResult.witness.firstUnmatched.rightOnlyActions.includes(syntheticOffDiagonalResult.witness.firstUnmatched.actionId));
for (const variant of [["L1", "R1"], ["L2", "R2"]]) {
  const diagonal = runPairedExpansion({
    left: { ...syntheticOffDiagonal.root.left, variant: variant[0] },
    right: { ...syntheticOffDiagonal.root.right, variant: variant[1] },
  }, syntheticOffDiagonal.adapter, { depth: 0, branchCap: 32, stateCap: 256 });
  assert.strictEqual(diagonal.outcome, "equivalent");
}

for (const kind of ["enumeration-error", "action-application-error", "duplicate-action-id"]) {
  const control = makeSyntheticExecutionErrorControl(kind);
  const result = runPairedExpansion(control.root, control.adapter, { depth: 2, branchCap: 32, stateCap: 256 });
  assert.strictEqual(result.outcome, "incomplete");
  assert.notStrictEqual(result.outcome, "mismatch-witness");
  assert.strictEqual(result.witness, null);
}
const stateCap = runPairedExpansion(syntheticNegative.root, syntheticNegative.adapter, { depth: 2, branchCap: 32, stateCap: 1 });
assert.strictEqual(stateCap.outcome, "incomplete");
assert.strictEqual(stateCap.incompleteReason, "state-cap");
const branchCap = runPairedExpansion(syntheticNegative.root, syntheticNegative.adapter, { depth: 2, branchCap: 1, stateCap: 256 });
assert.strictEqual(branchCap.outcome, "incomplete");
assert.strictEqual(branchCap.incompleteReason, "branch-cap");

assert.ok(fs.readFileSync(MARKDOWN, "utf8").includes("candidate-6/7"));
const rebuilt = buildInventoryReport();
assert.strictEqual(rebuilt.status, "completed");
assert.strictEqual(rebuilt.schema, "motapathfinder.pr-4.5c1-state-abstraction-collision-inventory.v1");
assert.strictEqual(rebuilt.summary.statesScanned, report.summary.statesScanned);
assert.strictEqual(rebuilt.summary.collisionOccurrenceCount, report.summary.collisionOccurrenceCount);
assert.strictEqual(rebuilt.summary.uniqueCollisionSignatureCount, report.summary.uniqueCollisionSignatureCount);
assert.strictEqual(rebuilt.summary.exactDistinctPairCount, report.summary.exactDistinctPairCount);
assert.strictEqual(rebuilt.summary.signatureIdsWithSkippedOccurrences, report.summary.signatureIdsWithSkippedOccurrences);
assert.strictEqual(rebuilt.summary.unselectedUniqueSignatureCount, report.summary.unselectedUniqueSignatureCount);
assert.strictEqual(rebuilt.summary.pairsSelected, report.summary.pairsSelected);
assert.strictEqual(rebuilt.summary.pairsSkippedByCap, report.summary.pairsSkippedByCap);
assert.deepStrictEqual(rebuilt.pairs.map((pair) => pair.id), expectedPairIds);
assert.deepStrictEqual(normalizeSelectedPairs(rebuilt), normalizeSelectedPairs(report));
assert.deepStrictEqual(
  rebuilt.collisionGroups.map((group) => group.id),
  report.collisionGroups.map((group) => group.id),
);
assert.deepStrictEqual(rebuilt.selectedPairRiskStrata, report.selectedPairRiskStrata);
assert.strictEqual(rebuilt.fixedControls[0].outcome, "equivalent");
assert.strictEqual(rebuilt.fixedControls[0].leftCandidateId, "mt2-local-3582:candidate-6");
assert.strictEqual(rebuilt.fixedControls[0].rightCandidateId, "mt2-local-3582:candidate-7");
assert.strictEqual(rebuilt.provenance.manifestSha256, report.provenance.manifestSha256);
assert.strictEqual(rebuilt.provenance.productionStateKeySha256, report.provenance.productionStateKeySha256);

console.log("PR-4.5c1 state abstraction collision inventory checks: passed");
