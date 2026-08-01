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
const { buildReport: buildInventoryReport } = require("./mine-state-abstraction-collisions");

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

assert.strictEqual(report.schema, "motapathfinder.pr-4.5c-state-abstraction-collision-inventory.v1");
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
assert.strictEqual(report.summary.collisionGroupCount, 12);
assert.strictEqual(report.summary.exactDistinctPairCount, 12);
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
    collisionGroupCount: 5,
    pairsSelected: 4,
    pairsSkippedByCap: 1,
  },
  {
    id: "mt2-candidate2-capacity10-j",
    artifact: "shared-solver/routes/generated/agenda-policy-evaluation/mt2-candidate2-capacity10-j.json",
    sha256: "63ef50026429386fac62c2d40558f2bc7ff0e1168b5450c0783016fac6f9ce74",
    statesScanned: 20,
    collisionGroupCount: 7,
    pairsSelected: 4,
    pairsSkippedByCap: 3,
  },
];
assert.deepStrictEqual(report.sources.map((source) => ({
  id: source.id,
  artifact: source.artifact.replaceAll("\\", "/"),
  sha256: source.sourceSha256,
  statesScanned: source.statesScanned,
  collisionGroupCount: source.collisionGroupCount,
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

const expectedPairIds = [
  "pair-285e93d1eb45542d",
  "pair-3e9e2b6efe518b63",
  "pair-56d844bfe57f58b0",
  "pair-5aec405522f8963c",
  "pair-76ff53ff129974eb",
  "pair-98b621afcd564561",
  "pair-be97aba6dbc5ee0a",
  "pair-d89f7f8e0655b590",
];
assert.deepStrictEqual(report.pairs.map((pair) => pair.id), expectedPairIds);
report.pairs.forEach((pair) => {
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
  }
});
assert.deepStrictEqual(report.riskStrata.nonCurrentFloorMutationDiff, { true: 9, false: 0, unknown: 0 });
assert.deepStrictEqual(report.riskStrata.currentFloorMutationDiff, { true: 0, false: 9, unknown: 0 });
assert.deepStrictEqual(report.riskStrata.crossFloorActionAvailable, { true: 9, false: 0, unknown: 0 });
assert.deepStrictEqual(report.riskStrata.exactRejoinObserved, { true: 3, false: 6, unknown: 0 });

assert.strictEqual(report.fixedControls.length, 1);
const fixed = report.fixedControls[0];
assert.strictEqual(fixed.id, "candidate-6-7-local-control");
assert.strictEqual(fixed.expectedOutcome, "equivalent");
assert.strictEqual(fixed.outcome, "equivalent");
assert.strictEqual(fixed.initialPair.projectionEqual, true);
assert.strictEqual(fixed.executionErrors, null);
assert.strictEqual(fixed.budgetExhausted, false);

const syntheticNegative = makeSyntheticNegativeControl();
const syntheticNegativeResult = runPairedExpansion(syntheticNegative.root, syntheticNegative.adapter, {
  depth: 2,
  branchCap: 32,
  stateCap: 256,
});
assert.strictEqual(syntheticNegativeResult.outcome, "mismatch-witness");
assert.ok(syntheticNegativeResult.witness.currentPair);

const syntheticDepthBoundary = makeSyntheticDepthBoundaryControl();
const syntheticDepthResult = runPairedExpansion(syntheticDepthBoundary.root, syntheticDepthBoundary.adapter, {
  depth: 2,
  branchCap: 32,
  stateCap: 256,
});
assert.strictEqual(syntheticDepthResult.outcome, "mismatch-witness");
assert.strictEqual(syntheticDepthResult.witness.firstUnmatched.depth, 2);

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
assert.strictEqual(rebuilt.summary.statesScanned, report.summary.statesScanned);
assert.strictEqual(rebuilt.summary.collisionGroupCount, report.summary.collisionGroupCount);
assert.strictEqual(rebuilt.summary.exactDistinctPairCount, report.summary.exactDistinctPairCount);
assert.strictEqual(rebuilt.summary.pairsSelected, report.summary.pairsSelected);
assert.strictEqual(rebuilt.summary.pairsSkippedByCap, report.summary.pairsSkippedByCap);
assert.deepStrictEqual(rebuilt.pairs.map((pair) => pair.id), expectedPairIds);
assert.strictEqual(rebuilt.fixedControls[0].outcome, "equivalent");
assert.strictEqual(rebuilt.provenance.manifestSha256, report.provenance.manifestSha256);
assert.strictEqual(rebuilt.provenance.productionStateKeySha256, report.provenance.productionStateKeySha256);

console.log("PR-4.5c state abstraction collision inventory checks: passed");
