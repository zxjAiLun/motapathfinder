"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildReport,
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

assert.strictEqual(fs.existsSync(REPORT), true, "PR-4.5b report must exist");
assert.strictEqual(fs.existsSync(MARKDOWN), true, "PR-4.5b markdown report must exist");

const report = JSON.parse(fs.readFileSync(REPORT, "utf8"));
assert.strictEqual(report.schema, "motapathfinder.pr-4.5b-bounded-abstraction-counterexample-search.v1");
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
  assert.strictEqual(root.initialPair.projectionEqual, true);
  assert.ok(root.expandedPairCount > 0);
});

assert.strictEqual(report.negativeControls.expectedOutcome, "mismatch-witness");
assert.strictEqual(report.negativeControls.outcome, "mismatch-witness");
assert.strictEqual(report.negativeControls.entries.length, 1);
const negative = report.negativeControls.entries[0];
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
assert.strictEqual(report.summary.positiveCorpusEquivalent, true);
assert.strictEqual(report.summary.negativeControlFoundWitness, true);
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

// The fixture is checked against a live rebuild so a stale generated report
// cannot mask a change in the bounded search implementation.
const rebuilt = buildReport();
assert.strictEqual(rebuilt.status, "completed");
assert.strictEqual(rebuilt.positiveCorpus.outcome, "equivalent");
assert.strictEqual(rebuilt.negativeControls.outcome, "mismatch-witness");
assert.strictEqual(rebuilt.positiveCorpus.entries[0].rootCount, 7);
assert.strictEqual(rebuilt.negativeControls.entries[0].witness.firstUnmatched.actionId, "historical-tile@MT1");
assert.strictEqual(rebuilt.provenance.manifestSha256, report.provenance.manifestSha256);
assert.strictEqual(rebuilt.provenance.productionStateKeySha256, report.provenance.productionStateKeySha256);

console.log("PR-4.5b bounded abstraction counterexample checks: passed");
