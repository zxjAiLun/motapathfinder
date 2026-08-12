"use strict";

/** TEST GRADE: unit-plus-micro */

const assert = require("node:assert");
const path = require("node:path");

const { runBlindDiscoveryBaseline } = require("./lib/blind-discovery-baseline");
const {
  buildSearchTraceExplanation,
  compareSearchTraceReports,
  renderSearchTraceMarkdown,
} = require("./lib/search-trace-explainability");

const PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const GOAL_FILE = path.resolve(__dirname, "blind-goals", "onlyup-mt5-blueking.json");

function main() {
  const beforeReport = runBlindDiscoveryBaseline({
    goalFile: GOAL_FILE,
    projectRoot: PROJECT_ROOT,
    maxExpansions: 8,
    maxHeapMb: 2048,
    candidateLimit: 8,
    goalSkylineLimit: 8,
  });
  const explanation = buildSearchTraceExplanation(beforeReport);
  assert.strictEqual(explanation.outcome.expansions, 8);
  assert.ok(explanation.decisionDepthTrace.length > 1);
  assert.strictEqual(explanation.decisionDepthSemantics.rejectionRateIntentionallyOmitted, true);
  assert.ok(explanation.decisionDepthTrace.every((row) => row.rejectionRate == null));
  assert.strictEqual(
    explanation.decisionDepthTrace.reduce((sum, row) => sum + row.expanded, 0),
    8,
  );
  assert.strictEqual(explanation.interpretationBoundary.knownRouteUsed, false);
  assert.ok(explanation.reviewBuckets.some((bucket) => bucket.id === "unresolved-live-frontier"));
  assert.ok(explanation.reviewBuckets.every((bucket) => bucket.optimizationClaim === false));

  const awaiting = compareSearchTraceReports(beforeReport, null);
  assert.strictEqual(awaiting.status, "awaiting-after-run");
  assert.strictEqual(awaiting.comparable, false);

  const afterReport = JSON.parse(JSON.stringify(beforeReport));
  afterReport.outcome.wallMs = Math.max(0, beforeReport.outcome.wallMs - 10);
  afterReport.outcome.generated -= 2;
  afterReport.outcome.frontierSize -= 1;
  const comparison = compareSearchTraceReports(beforeReport, afterReport);
  assert.strictEqual(comparison.comparable, true);
  assert.strictEqual(comparison.status, "same-controls");
  assert.strictEqual(comparison.controlDifferences.length, 0);
  assert.strictEqual(
    comparison.metrics.find((metric) => metric.field === "generated").direction,
    "improved",
  );
  const mismatched = JSON.parse(JSON.stringify(afterReport));
  mismatched.controls.maxExpansions += 1;
  assert.strictEqual(compareSearchTraceReports(beforeReport, mismatched).comparable, false);

  const markdown = renderSearchTraceMarkdown(awaiting);
  assert.ok(markdown.includes("Human Review Buckets"));
  assert.ok(markdown.includes("No same-control after run has been supplied"));
  process.stdout.write(`${JSON.stringify({
    status: "passed",
    outcome: explanation.outcome,
    decisionDepthRows: explanation.decisionDepthTrace.length,
    reviewBuckets: explanation.reviewBuckets,
    sameControlComparison: comparison.metrics,
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main };
