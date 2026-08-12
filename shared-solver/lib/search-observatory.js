"use strict";

const SCHEMA = "motapathfinder.search-observatory.v1";

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sumValues(record) {
  return Object.values(record || {}).reduce((sum, value) => sum + number(value, 0), 0);
}

function rankedCounts(record, total, limit) {
  return Object.entries(record || {})
    .map(([id, count]) => ({
      id,
      count: number(count, 0),
      share: total > 0 ? number(count, 0) / total : 0,
    }))
    .sort((left, right) => right.count - left.count || left.id.localeCompare(right.id))
    .slice(0, limit || 8);
}

function terminalHypothesis(searchReport) {
  const runtime = searchReport.runtime || {};
  const trace = runtime.trace || {};
  const outcome = runtime.outcome || {};
  const goal = ((searchReport.inputContract || {}).terminalGoal) ||
    (((searchReport.automaticGraph || {}).summary || {}).terminalGoal) || null;
  return {
    id: "terminal-goal",
    kind: "terminal-goal",
    target: goal,
    expectedEffect: "satisfy-final-goal",
    status: outcome.goalFound
      ? "reached"
      : number(trace.bossCandidatesGenerated, 0) > 0
        ? "generated-not-reached"
        : "not-generated",
    runtimeEvidence: {
      candidatesGenerated: number(trace.bossCandidatesGenerated, 0),
      goalFound: Boolean(outcome.goalFound),
    },
  };
}

function feasibilityHypotheses(searchReport, feasibilityReport) {
  const trace = ((searchReport || {}).runtime || {}).trace || {};
  return (feasibilityReport.equipmentCandidates || []).slice(0, 5).map((candidate, index) => {
    const selected = index === 0;
    const targetId = ((candidate.target || {}).itemId) || null;
    const matchingLandmarkCount = (((searchReport || {}).runtime || {}).landmarks || [])
      .filter((landmark) =>
        String(landmark.actionSummary || "").includes(targetId) ||
        (((landmark.state || {}).equipment) || []).includes(targetId))
      .length;
    const matchingCandidates = Object.entries(trace.generatedBySummary || {})
      .filter(([summary]) => String(summary).includes(targetId))
      .reduce((sum, [, count]) => sum + number(count, 0), 0);
    return {
      id: candidate.id,
      kind: candidate.kind,
      target: candidate.target,
      selected,
      expectedEffect: {
        attackDeficitReduction: number((candidate.score || {}).attackDeficitReduction, 0),
        defenseDeficitReduction: number((candidate.score || {}).defenseDeficitReduction, 0),
        effectiveGain: number((candidate.score || {}).effectiveGain, 0),
      },
      status: matchingLandmarkCount > 0
        ? "reached-as-checkpoint"
        : matchingCandidates > 0
          ? "generated-not-kept-as-checkpoint"
          : "not-generated",
      runtimeEvidence: {
        candidatesGenerated: matchingCandidates,
        checkpointCount: matchingLandmarkCount,
      },
      provenance: candidate.provenance,
    };
  });
}

function buildBudgetLedger(searchReport) {
  const runtime = searchReport.runtime || {};
  const trace = runtime.trace || {};
  const outcome = runtime.outcome || {};
  const expansions = number(outcome.expansions, 0);
  const generated = number(outcome.generated, sumValues(trace.generatedByKind));
  const rejected = number(outcome.rejected, sumValues(trace.rejectionReasons));
  const accepted = number(outcome.accepted, Math.max(0, generated - rejected));
  return {
    expansions,
    generated,
    accepted,
    rejected,
    unresolvedFrontier: number(outcome.frontierSize, 0),
    byFloor: rankedCounts(trace.expandedByFloor, expansions, 12),
    byIncomingKind: rankedCounts(trace.expandedByIncomingKind, expansions, 12),
    topIncomingActions: rankedCounts(trace.expandedByIncomingSummary, expansions, 12),
    generatedByKind: rankedCounts(trace.generatedByKind, generated, 12),
    rejectionReasons: rankedCounts(trace.rejectionReasons, generated, 12),
  };
}

function buildPlateauEvidence(searchReport) {
  const runtime = searchReport.runtime || {};
  const trace = runtime.trace || {};
  const expansions = number((runtime.outcome || {}).expansions, 0);
  const tuples = rankedCounts(trace.goalRankTuples, expansions, 8);
  return {
    distinctGoalRankTuples: number(runtime.distinctGoalRankTupleCount, tuples.length),
    topGoalRankTuples: tuples,
    largestTupleShare: tuples.length > 0 ? tuples[0].share : 0,
    interpretation: "A repeated rank tuple is a progress-signal plateau, not proof that every state inside it is equivalent or useless.",
  };
}

function buildReviewCandidates(searchReport, budget, plateau, hypotheses) {
  const attribution = searchReport.attribution || {};
  const runtime = searchReport.runtime || {};
  const trace = runtime.trace || {};
  const selected = hypotheses.find((hypothesis) => hypothesis.selected);
  const rows = [];
  if (number(attribution.revisitExpansionCount, 0) > 0) {
    rows.push({
      id: "unguided-revisit-expansions",
      evidence: "observed",
      count: number(attribution.revisitExpansionCount, 0),
      shareOfExpansions: number(attribution.revisitExpansionShare, 0),
      whyFlagged: "Search spends budget outside the old planning envelope without a compiled prerequisite signal.",
      humanQuestion: "Are these revisits buying a required resource, or merely cycling through locally attractive states?",
      wasteProven: false,
    });
  }
  if (plateau.largestTupleShare > 0) {
    rows.push({
      id: "goal-rank-plateau",
      evidence: "observed",
      count: (plateau.topGoalRankTuples[0] || {}).count || 0,
      shareOfExpansions: plateau.largestTupleShare,
      whyFlagged: "Many expanded states receive the same goal-directed rank tuple.",
      humanQuestion: "Which dependency or resource fact should distinguish useful states inside this plateau?",
      wasteProven: false,
    });
  }
  if (selected && selected.status === "not-generated") {
    rows.push({
      id: "selected-feasibility-subgoal-never-generated",
      evidence: "causal-gap",
      count: 0,
      shareOfExpansions: 0,
      whyFlagged: `The highest-ranked automatic feasibility target ${selected.target.itemId} never became a candidate.`,
      humanQuestion: "Which topology blockers prevent the local executor from generating this action?",
      wasteProven: false,
    });
  }
  const topRepeatedAction = budget.topIncomingActions.find((entry) => entry.count > 1);
  if (topRepeatedAction) {
    rows.push({
      id: "repeated-incoming-action-family",
      evidence: "inspection-candidate",
      count: topRepeatedAction.count,
      shareOfExpansions: topRepeatedAction.share,
      whyFlagged: `Many expanded states entered through ${topRepeatedAction.id}.`,
      humanQuestion: "Do these states represent distinct strategic outcomes, or should they be summarized as one macro alternative?",
      wasteProven: false,
    });
  }
  if (number(trace.bossCandidatesGenerated, 0) === 0) {
    rows.push({
      id: "terminal-action-never-generated",
      evidence: "hard-count",
      count: 0,
      shareOfExpansions: 0,
      whyFlagged: "No terminal Boss action entered the candidate funnel.",
      humanQuestion: "Which unresolved prerequisite is closest to making the terminal action reachable?",
      wasteProven: false,
    });
  }
  return rows;
}

function nextExperiment(reviewCandidates, hypotheses) {
  const selected = hypotheses.find((hypothesis) => hypothesis.selected);
  if (selected && selected.status === "not-generated") {
    return {
      id: "compile-selected-subgoal-predecessors",
      hypothesis: `Topology-derived predecessor stages will make ${selected.target.itemId} enter the candidate funnel within the same expansion budget.`,
      change: "Add automatic graph predecessor compilation only; keep DP key, dominance, selection, and total budget unchanged.",
      successEvidence: [
        `${selected.target.itemId} candidatesGenerated > 0`,
        `${selected.target.itemId} reached-as-checkpoint or reached`,
        "same-control expansions and budget",
      ],
      failureEvidence: [
        `${selected.target.itemId} candidatesGenerated == 0`,
        "predecessor stage cannot be executed",
        "target appears only after changing the budget",
      ],
    };
  }
  return {
    id: "review-largest-observed-bucket",
    hypothesis: reviewCandidates.length > 0
      ? `The ${reviewCandidates[0].id} bucket contains a removable search cost.`
      : "No specific removable cost has been isolated.",
    change: "Run one narrowly isolated same-control A/B experiment.",
    successEvidence: ["goal/replay outcome preserved or improved", "target bucket decreases"],
    failureEvidence: ["outcome regresses", "target bucket unchanged"],
  };
}

function buildSearchObservatory(searchReport, feasibilityReport) {
  if (!searchReport || !feasibilityReport) {
    throw new Error("Search observatory requires one search report and one feasibility report");
  }
  const hypotheses = [
    terminalHypothesis(searchReport),
    ...feasibilityHypotheses(searchReport, feasibilityReport),
  ];
  const budget = buildBudgetLedger(searchReport);
  const plateau = buildPlateauEvidence(searchReport);
  const reviewCandidates = buildReviewCandidates(searchReport, budget, plateau, hypotheses);
  return {
    schema: SCHEMA,
    grade: "diagnostic-baseline",
    objective: hypotheses[0],
    hypothesisBoard: hypotheses,
    budgetLedger: budget,
    progressSignal: plateau,
    reviewCandidates,
    nextExperiment: nextExperiment(reviewCandidates, hypotheses),
    outcome: { ...((searchReport.runtime || {}).outcome || {}) },
    controls: { ...(searchReport.controls || {}) },
    interpretationBoundary: {
      observed: "Counts and target-generation status come from the same blind search run.",
      inferred: "Expected feasibility benefit comes from simulator-backed counterfactual evaluation.",
      notYetProven: "A review candidate is not called waste until a same-control causal A/B removes it without harming goal/replay outcome.",
      productionSearchChanged: false,
      knownRouteUsedBySearch: false,
    },
    verdict: "SEARCH_INTENT_AND_COST_BASELINE_VISIBLE",
  };
}

function controlDifferences(before, after) {
  const fields = ["maxExpansions", "maxRuntimeMs", "candidateLimit", "goalSkylineLimit", "priorityMode"];
  return fields
    .filter((field) => JSON.stringify((before.controls || {})[field]) !== JSON.stringify((after.controls || {})[field]))
    .map((field) => ({ field, before: (before.controls || {})[field], after: (after.controls || {})[field] }));
}

function compareSearchObservatories(before, after) {
  const differences = controlDifferences(before, after);
  const beforeSelected = before.hypothesisBoard.find((entry) => entry.selected);
  const afterSelected = after.hypothesisBoard.find((entry) => entry.selected);
  const metric = (id, left, right, lowerIsBetter) => ({
    id,
    before: number(left, 0),
    after: number(right, 0),
    delta: number(right, 0) - number(left, 0),
    direction: number(left, 0) === number(right, 0)
      ? "unchanged"
      : (lowerIsBetter ? number(right, 0) < number(left, 0) : number(right, 0) > number(left, 0))
        ? "improved"
        : "regressed",
  });
  return {
    schema: "motapathfinder.search-observatory-comparison.v1",
    comparable: differences.length === 0,
    controlDifferences: differences,
    outcomeTransition: {
      goalFound: `${Boolean(before.outcome.goalFound)} -> ${Boolean(after.outcome.goalFound)}`,
      searchComplete: `${Boolean(before.outcome.searchComplete)} -> ${Boolean(after.outcome.searchComplete)}`,
    },
    metrics: [
      metric("wallMs", before.outcome.wallMs, after.outcome.wallMs, true),
      metric("expansions", before.budgetLedger.expansions, after.budgetLedger.expansions, true),
      metric("generated", before.budgetLedger.generated, after.budgetLedger.generated, true),
      metric(
        "selectedSubgoalCandidates",
        ((beforeSelected || {}).runtimeEvidence || {}).candidatesGenerated,
        ((afterSelected || {}).runtimeEvidence || {}).candidatesGenerated,
        false,
      ),
      metric("largestGoalRankPlateauSharePpm", before.progressSignal.largestTupleShare * 1000000, after.progressSignal.largestTupleShare * 1000000, true),
    ],
    correctnessGate: {
      goalFoundRequired: true,
      strictReplayRequiredWhenFound: true,
      fasterNotFoundIsNotSuccess: true,
    },
  };
}

function markdownTable(headers, rows) {
  const line = (cells) => `| ${cells.join(" | ")} |`;
  return [line(headers), line(headers.map(() => "---")), ...rows.map(line)].join("\n");
}

function percent(value) {
  return `${(number(value, 0) * 100).toFixed(1)}%`;
}

function renderSearchObservatoryMarkdown(report) {
  const selected = report.hypothesisBoard.filter((entry) => entry.selected || entry.kind === "terminal-goal");
  return [
    "# Search Observatory",
    "",
    `Verdict: ${report.verdict}`,
    "",
    "## What the machine is trying",
    "",
    markdownTable(
      ["hypothesis", "target", "status", "expected attack/defense reduction", "runtime candidates"],
      selected.map((entry) => [
        entry.kind,
        ((entry.target || {}).itemId) || ((entry.target || {}).enemyId) || "terminal",
        entry.status,
        typeof entry.expectedEffect === "object"
          ? `${entry.expectedEffect.attackDeficitReduction}/${entry.expectedEffect.defenseDeficitReduction}`
          : entry.expectedEffect,
        String((entry.runtimeEvidence || {}).candidatesGenerated || 0),
      ]),
    ),
    "",
    "## Where the budget went",
    "",
    markdownTable(
      ["floor", "expansions", "share"],
      report.budgetLedger.byFloor.map((entry) => [entry.id, String(entry.count), percent(entry.share)]),
    ),
    "",
    "## Human review candidates",
    "",
    markdownTable(
      ["candidate", "evidence", "count", "share", "question", "waste proven"],
      report.reviewCandidates.map((entry) => [
        entry.id,
        entry.evidence,
        String(entry.count),
        percent(entry.shareOfExpansions),
        entry.humanQuestion,
        String(entry.wasteProven),
      ]),
    ),
    "",
    "## Next falsifiable experiment",
    "",
    `Hypothesis: ${report.nextExperiment.hypothesis}`,
    "",
    `Change: ${report.nextExperiment.change}`,
    "",
    report.interpretationBoundary.notYetProven,
    "",
  ].join("\n");
}

module.exports = {
  SCHEMA,
  buildSearchObservatory,
  compareSearchObservatories,
  renderSearchObservatoryMarkdown,
};
