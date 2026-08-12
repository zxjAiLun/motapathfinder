"use strict";

const COMPARABLE_CONTROL_FIELDS = [
  "maxExpansions",
  "maxRuntimeMs",
  "maxHeapMb",
  "candidateLimit",
  "goalSkylineLimit",
  "stopOnFirstGoal",
  "priorityMode",
];

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function percent(value) {
  return `${(number(value, 0) * 100).toFixed(1)}%`;
}

function sortedEntries(value) {
  return Object.entries(value || {}).sort((left, right) =>
    number(right[1], 0) - number(left[1], 0) || left[0].localeCompare(right[0]),
  );
}

function topEntries(value, limit) {
  return sortedEntries(value).slice(0, limit || 8).map(([name, count]) => ({
    name,
    count: number(count, 0),
  }));
}

function depthRows(report) {
  const byDepth = (((report || {}).traceSummary || {}).byDecisionDepth) || {};
  return Object.entries(byDepth)
    .map(([decisionDepth, record]) => ({
      decisionDepth: number(decisionDepth, 0),
      expanded: number(record.expanded, 0),
      actionSets: number(record.actionSets, 0),
      generated: number(record.generated, 0),
      rejected: number(record.rejected, 0),
      maxFrontierSize: number(record.maxFrontierSize, 0),
      floors: topEntries(record.byFloor, 4),
      generatedByKind: topEntries(record.generatedByKind, 6),
      rejectionReasons: topEntries(record.rejectionReasons, 6),
    }))
    .sort((left, right) => left.decisionDepth - right.decisionDepth);
}

function buildReviewBuckets(report) {
  const outcome = (report || {}).outcome || {};
  const trace = (report || {}).traceSummary || {};
  const generated = number(outcome.generated, 0);
  const dominanceRejected = number((trace.rejectionReasons || {})["dominance-rejected"], 0);
  const trimmed = number(outcome.actionTrimmed, 0);
  const changeFloor = number((trace.generatedByKind || {}).changeFloor, 0);
  const deepest = trace.deepestFloorId || (outcome.bestProgress || {}).floorId || null;
  const floors = sortedEntries(trace.expandedByFloor).map(([floorId, count]) => ({
    floorId,
    expansions: number(count, 0),
  }));
  const buckets = [
    {
      id: "dominance-rejected-successors",
      evidenceType: "hard-count",
      count: dominanceRejected,
      shareOfGenerated: generated > 0 ? dominanceRejected / generated : 0,
      interpretation: "These successors were generated and applied before the current DP identity rejected them.",
      humanQuestion: "Do repeated rejection patterns reveal a cheaper pre-apply equivalence or ordering rule?",
      optimizationClaim: false,
    },
    {
      id: "unresolved-live-frontier",
      evidenceType: "hard-count",
      count: number(outcome.frontierSize, 0),
      shareOfGenerated: generated > 0 ? number(outcome.frontierSize, 0) / generated : 0,
      interpretation: outcome.searchComplete
        ? "No unresolved frontier remained."
        : "Search stopped while candidates remained; not-found is not a no-route proof.",
      humanQuestion: "Which macro choices make these live states meaningfully different?",
      optimizationClaim: false,
    },
    {
      id: "floor-transition-ordering-branches",
      evidenceType: "inspection-candidate",
      count: changeFloor,
      shareOfGenerated: generated > 0 ? changeFloor / generated : 0,
      interpretation: "changeFloor candidates expose alternative visit/return orderings, but are not automatically waste.",
      humanQuestion: "Can transition choices be represented once at macro level instead of rediscovered in many local states?",
      optimizationClaim: false,
    },
    {
      id: "action-trimming",
      evidenceType: "hard-count",
      count: trimmed,
      shareOfGenerated: generated > 0 ? trimmed / generated : 0,
      interpretation: trimmed > 0
        ? "The action cap removed candidates, so the search is incomplete for an additional reason."
        : "No candidate was lost to maxActionsPerState.",
      humanQuestion: trimmed > 0 ? "Which action kinds were trimmed?" : "No action-scope repair is indicated by this run.",
      optimizationClaim: false,
    },
  ];
  return { deepestFloorId: deepest, floorExpansionDistribution: floors, buckets };
}

function buildSearchTraceExplanation(report) {
  const outcome = (report || {}).outcome || {};
  const review = buildReviewBuckets(report);
  return {
    schema: "motapathfinder.search-trace-explanation.v1",
    sourceSchema: report && report.schema || null,
    grade: report && report.grade || null,
    goalId: report && report.goalId || null,
    outcome: {
      found: Boolean(outcome.found),
      goalFound: Boolean(outcome.goalFound),
      searchComplete: Boolean(outcome.searchComplete),
      budgetExhausted: Boolean(outcome.budgetExhausted),
      expansions: number(outcome.expansions, 0),
      generated: number(outcome.generated, 0),
      accepted: number(outcome.accepted, 0),
      frontierSize: number(outcome.frontierSize, 0),
      wallMs: number(outcome.wallMs, 0),
      activeKeys: number((outcome.registry || {}).finalActiveStates, 0),
      deepestFloorId: review.deepestFloorId,
      maxDecisionDepth: number(((report || {}).traceSummary || {}).maxDecisionDepth, 0),
      verdict: report && report.verdict || null,
    },
    decisionDepthTrace: depthRows(report),
    decisionDepthSemantics: {
      expandedAndGenerated: "parent decision depth",
      rejected: "reported state depth; dominance and skyline rejection usually describe the successor",
      rejectionRateIntentionallyOmitted: true,
    },
    floorExpansionDistribution: review.floorExpansionDistribution,
    generatedActionKinds: topEntries(((report || {}).traceSummary || {}).generatedByKind, 12),
    rejectionReasons: topEntries(((report || {}).traceSummary || {}).rejectionReasons, 12),
    reviewBuckets: review.buckets,
    interpretationBoundary: {
      hardEvidence: "Counts, outcome flags, floors, depths, action kinds, and rejection reason codes are observed.",
      hypotheses: "Whether a counted branch is useless requires human review or a causal A/B control.",
      knownRouteUsed: false,
    },
  };
}

function controlDiff(before, after) {
  const left = (before || {}).controls || {};
  const right = (after || {}).controls || {};
  return COMPARABLE_CONTROL_FIELDS
    .filter((field) => JSON.stringify(left[field]) !== JSON.stringify(right[field]))
    .map((field) => ({ field, before: left[field], after: right[field] }));
}

function metricDelta(before, after, field, lowerIsBetter) {
  const left = number(before[field], 0);
  const right = number(after[field], 0);
  const delta = right - left;
  const deltaPercent = left === 0 ? null : delta / left;
  return {
    field,
    before: left,
    after: right,
    delta,
    deltaPercent,
    direction: delta === 0
      ? "unchanged"
      : (lowerIsBetter ? delta < 0 : delta > 0)
        ? "improved"
        : "regressed",
  };
}

function compareSearchTraceReports(beforeReport, afterReport) {
  const before = buildSearchTraceExplanation(beforeReport);
  if (!afterReport) {
    return {
      schema: "motapathfinder.search-trace-comparison.v1",
      comparable: false,
      status: "awaiting-after-run",
      before,
      after: null,
      controlDifferences: [],
      metrics: [],
      outcomeTransition: null,
      conclusion: "A before baseline exists; no optimization claim is possible until a same-control after run is supplied.",
    };
  }
  const after = buildSearchTraceExplanation(afterReport);
  const differences = controlDiff(beforeReport, afterReport);
  const metrics = [
    metricDelta(before.outcome, after.outcome, "wallMs", true),
    metricDelta(before.outcome, after.outcome, "expansions", true),
    metricDelta(before.outcome, after.outcome, "generated", true),
    metricDelta(before.outcome, after.outcome, "accepted", true),
    metricDelta(before.outcome, after.outcome, "frontierSize", true),
    metricDelta(before.outcome, after.outcome, "activeKeys", true),
    metricDelta(before.outcome, after.outcome, "maxDecisionDepth", false),
  ];
  const comparable = differences.length === 0;
  return {
    schema: "motapathfinder.search-trace-comparison.v1",
    comparable,
    status: comparable ? "same-controls" : "control-mismatch",
    before,
    after,
    controlDifferences: differences,
    metrics,
    outcomeTransition: {
      beforeVerdict: before.outcome.verdict,
      afterVerdict: after.outcome.verdict,
      goalFound: `${before.outcome.goalFound} -> ${after.outcome.goalFound}`,
      searchComplete: `${before.outcome.searchComplete} -> ${after.outcome.searchComplete}`,
      deepestFloor: `${before.outcome.deepestFloorId} -> ${after.outcome.deepestFloorId}`,
    },
    conclusion: comparable
      ? "Controls match; metric deltas are eligible for causal review, but correctness still requires goal/replay gates."
      : "Controls differ; do not attribute metric deltas to the implementation change.",
  };
}

function markdownTable(headers, rows) {
  const line = (cells) => `| ${cells.join(" | ")} |`;
  return [line(headers), line(headers.map(() => "---")), ...rows.map(line)].join("\n");
}

function renderSearchTraceMarkdown(comparison) {
  const before = comparison.before;
  const lines = [
    "# Search Trace Comparison",
    "",
    `Status: ${comparison.status}`,
    "",
    "## Before",
    "",
    markdownTable(
      ["goal", "found", "complete", "expansions", "generated", "frontier", "active keys", "deepest", "wall ms"],
      [[
        before.goalId || "-",
        String(before.outcome.goalFound),
        String(before.outcome.searchComplete),
        String(before.outcome.expansions),
        String(before.outcome.generated),
        String(before.outcome.frontierSize),
        String(before.outcome.activeKeys),
        before.outcome.deepestFloorId || "-",
        String(before.outcome.wallMs),
      ]],
    ),
    "",
    "## Human Review Buckets",
    "",
    markdownTable(
      ["bucket", "count", "share generated", "evidence", "question"],
      before.reviewBuckets.map((bucket) => [
        bucket.id,
        String(bucket.count),
        percent(bucket.shareOfGenerated),
        bucket.evidenceType,
        bucket.humanQuestion,
      ]),
    ),
  ];
  if (comparison.after) {
    lines.push(
      "",
      "## Same-Control Deltas",
      "",
      markdownTable(
        ["metric", "before", "after", "delta", "direction"],
        comparison.metrics.map((metric) => [
          metric.field,
          String(metric.before),
          String(metric.after),
          String(metric.delta),
          metric.direction,
        ]),
      ),
    );
  } else {
    lines.push("", "## After", "", "No same-control after run has been supplied.");
  }
  lines.push("", comparison.conclusion, "");
  return lines.join("\n");
}

module.exports = {
  COMPARABLE_CONTROL_FIELDS,
  buildReviewBuckets,
  buildSearchTraceExplanation,
  compareSearchTraceReports,
  depthRows,
  renderSearchTraceMarkdown,
};
