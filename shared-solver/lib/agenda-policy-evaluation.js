"use strict";

const DEFAULT_POLICIES = Object.freeze([
  Object.freeze({ id: "best-first", agendaMode: "best-first", fairnessEvery: null }),
  Object.freeze({ id: "hybrid-fair-16", agendaMode: "hybrid-fair", fairnessEvery: 16 }),
  Object.freeze({ id: "hybrid-fair-8", agendaMode: "hybrid-fair", fairnessEvery: 8 }),
  Object.freeze({ id: "hybrid-fair-4", agendaMode: "hybrid-fair", fairnessEvery: 4 }),
  Object.freeze({ id: "fifo", agendaMode: "fifo", fairnessEvery: null }),
]);

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function finiteOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sum(values) {
  return (values || []).reduce((total, value) => total + number(value), 0);
}

function max(values) {
  const finite = (values || []).map(Number).filter(Number.isFinite);
  return finite.length > 0 ? Math.max(...finite) : 0;
}

function median(values) {
  const sorted = (values || [])
    .map(Number)
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function range(values) {
  const finite = (values || []).map(Number).filter(Number.isFinite);
  return {
    min: finite.length > 0 ? Math.min(...finite) : null,
    max: finite.length > 0 ? Math.max(...finite) : null,
    median: median(finite),
  };
}

function clonePolicy(policy) {
  return {
    id: policy.id,
    agendaMode: policy.agendaMode,
    fairnessEvery: policy.fairnessEvery,
  };
}

function getPolicyMatrix(value) {
  if (value == null || value === "") return DEFAULT_POLICIES.map(clonePolicy);
  const requested = String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const aliases = new Map([
    ["best", "best-first"],
    ["hybrid-16", "hybrid-fair-16"],
    ["hybrid-8", "hybrid-fair-8"],
    ["hybrid-4", "hybrid-fair-4"],
  ]);
  const policies = requested.map((name) => {
    const id = aliases.get(name) || name;
    const policy = DEFAULT_POLICIES.find((candidate) => candidate.id === id);
    if (!policy) throw new Error(`Unknown agenda policy: ${name}`);
    return clonePolicy(policy);
  });
  const ids = new Set();
  return policies.filter((policy) => {
    if (ids.has(policy.id)) return false;
    ids.add(policy.id);
    return true;
  });
}

function buildBudgetPlan(kind, budget, options) {
  const config = options || {};
  const parsedBudget = Math.max(1, number(budget, 1));
  if (kind === "time") {
    return {
      kind: "time",
      value: parsedBudget,
      maxExpansions: Math.max(1, number(config.maxExpansionsForTime, 1000000)),
      maxRuntimeMs: parsedBudget,
    };
  }
  return {
    kind: "expansions",
    value: parsedBudget,
    maxExpansions: parsedBudget,
    maxRuntimeMs: Math.max(1, number(config.maxRuntimeMsForExpansions, 60000)),
  };
}

function buildSegmentedChildArgs(config, policy, budgetPlan, reportPath, outPath) {
  const args = [
    `--route-name=${config.routeName}`,
    `--project-root=${config.projectRoot}`,
    `--agenda-mode=${policy.agendaMode}`,
    `--candidate-limit=${config.candidateLimit}`,
    `--goal-skyline-limit=${config.goalSkylineLimit}`,
    `--dp-skyline-max=${config.dpSkylineMax}`,
    `--preserve-skyline-roles=${config.preserveSkylineRoles ? 1 : 0}`,
    `--stop-on-first-goal=${config.stopOnFirstGoal ? 1 : 0}`,
    `--max-actions-per-state=${config.maxActionsPerState}`,
    `--max-expansions=${budgetPlan.maxExpansions}`,
    `--max-runtime-ms=${budgetPlan.maxRuntimeMs}`,
    `--report=${reportPath}`,
    `--print-failures=0`,
  ];
  if (policy.fairnessEvery != null) {
    args.push(`--fairness-every=${policy.fairnessEvery}`);
  }
  if (config.dpKeyMode) args.push(`--dp-key-mode=${config.dpKeyMode}`);
  if (config.startRoute) args.push(`--start-route=${config.startRoute}`);
  if (config.startRouteStep != null) {
    args.push(`--start-route-step=${config.startRouteStep}`);
  }
  if (config.fromMilestone) args.push(`--from-milestone=${config.fromMilestone}`);
  if (config.toMilestone) args.push(`--to-milestone=${config.toMilestone}`);
  if (outPath) args.push(`--out=${outPath}`);
  return args;
}

function attemptDiagnostics(report) {
  const attempts = [];
  (report && report.segmentResults || []).forEach((segment) => {
    (segment.attempts || []).forEach((attempt) => {
      const diagnostics = attempt.diagnostics || {};
      const dp = diagnostics.dp || diagnostics;
      attempts.push({
        segmentId: segment.segmentId,
        startCandidateId: attempt.startCandidateId || null,
        found: Boolean(attempt.found),
        goalCount: number(attempt.goalCount),
        diagnostics: dp,
      });
    });
  });
  return attempts;
}

function stoppedReasonsForAttempts(attempts) {
  return Array.from(new Set(
    (attempts || [])
      .map((attempt) => attempt.diagnostics.stoppedReason)
      .filter(Boolean),
  ));
}

function aggregateAttemptMetrics(attempts) {
  const list = attempts || [];
  const fairness = list.map((attempt) => attempt.diagnostics.agendaFairness || {});
  const firstGoalExpansions = list
    .map((attempt) => attempt.diagnostics.firstGoalExpansion)
    .filter((value) => value != null && Number.isFinite(Number(value)))
    .map(Number);
  return {
    expansions: sum(list.map((attempt) => attempt.diagnostics.expansions)),
    wallMs: sum(list.map((attempt) => attempt.diagnostics.wallMs)),
    acceptedStates: sum(list.map((attempt) => attempt.diagnostics.acceptedStates)),
    rejectedByHigherHp: sum(list.map((attempt) => attempt.diagnostics.rejectedByHigherHp)),
    sameHpRejected: sum(list.map((attempt) => attempt.diagnostics.sameHpRejected)),
    replacedLowerHp: sum(list.map((attempt) => attempt.diagnostics.replacedLowerHp)),
    actionTrimmed: sum(list.map((attempt) => attempt.diagnostics.actionTrimmed)),
    frontierSize: max(list.map((attempt) => attempt.diagnostics.frontierSize)),
    heapUsedMb: max(list.map((attempt) => attempt.diagnostics.heapUsedMb)),
    rssMb: max(list.map((attempt) => attempt.diagnostics.rssMb)),
    fairPops: sum(fairness.map((item) => item.fairPops)),
    bestPops: sum(fairness.map((item) => item.bestPops)),
    fairFallbacks: sum(fairness.map((item) => item.fairFallbacks)),
    bestFallbacks: sum(fairness.map((item) => item.bestFallbacks)),
    maxFairQueueAgeExpansions: max(fairness.map((item) => item.maxFairQueueAgeExpansions)),
    firstGoalExpansion: firstGoalExpansions.length > 0
      ? Math.min(...firstGoalExpansions)
      : null,
  };
}

function aggregateSegmentReport(report) {
  const attempts = attemptDiagnostics(report);
  const foundAttempt = attempts.find((attempt) => attempt.found);
  const failure = report && report.failedSegment;
  const bestSeen = failure && failure.bestSeen ? failure.bestSeen : null;
  const segmentMetrics = (report && report.segmentResults || []).map((segment) => {
    const segmentAttempts = attempts.filter(
      (attempt) => attempt.segmentId === segment.segmentId,
    );
    return {
      segmentId: segment.segmentId,
      label: segment.label || null,
      found: Boolean(segment.found),
      attempts: segmentAttempts.length,
      metrics: aggregateAttemptMetrics(segmentAttempts),
      stoppedReasons: stoppedReasonsForAttempts(segmentAttempts),
      progress: segment.failurePropagation || null,
    };
  });
  const metrics = aggregateAttemptMetrics(attempts);
  return {
    found: Boolean(report && report.found),
    reachedMilestone: report && report.reachedMilestone || null,
    failedSegmentId: report && report.failedSegmentId || null,
    segments: segmentMetrics,
    attempts: attempts.map((attempt) => ({
      segmentId: attempt.segmentId,
      startCandidateId: attempt.startCandidateId,
      found: attempt.found,
      goalCount: attempt.goalCount,
      stoppedReason: attempt.diagnostics.stoppedReason || null,
      expansions: number(attempt.diagnostics.expansions),
      frontierSize: number(attempt.diagnostics.frontierSize),
      firstGoalExpansion: finiteOrNull(attempt.diagnostics.firstGoalExpansion),
    })),
    metrics,
    stoppedReasons: stoppedReasonsForAttempts(attempts),
    completeWithinActionSet: attempts.every(
      (attempt) => attempt.diagnostics.completeWithinActionSet !== false,
    ),
    progress: bestSeen,
    bestAttempt: foundAttempt
      ? {
          segmentId: foundAttempt.segmentId,
          startCandidateId: foundAttempt.startCandidateId,
          goalCount: foundAttempt.goalCount,
        }
      : null,
  };
}

function normalizeFirstGoalExpansion(value) {
  return Number.isFinite(value) ? value : null;
}

function buildRegressionFromBaseline(current, baseline) {
  if (!baseline) return null;
  const currentMetrics = current.metrics || {};
  const baselineMetrics = baseline.metrics || {};
  return {
    foundDelta: Number(current.found) - Number(baseline.found),
    replayValidDelta: Number(Boolean(current.strictReplay && current.strictReplay.valid)) -
      Number(Boolean(baseline.strictReplay && baseline.strictReplay.valid)),
    finalHpDelta: number(current.finalState && current.finalState.hero && current.finalState.hero.hp) -
      number(baseline.finalState && baseline.finalState.hero && baseline.finalState.hero.hp),
    expansionsDelta: number(currentMetrics.expansions) - number(baselineMetrics.expansions),
    wallMsDelta: number(currentMetrics.wallMs) - number(baselineMetrics.wallMs),
  };
}

function aggregateRepeats(runs) {
  const list = runs || [];
  const numericFields = [
    "expansions",
    "wallMs",
    "fairPops",
    "bestPops",
    "frontierSize",
    "heapUsedMb",
    "rssMb",
    "firstGoalExpansion",
  ];
  const metrics = {};
  numericFields.forEach((field) => {
    const values = list
      .map((run) => run.metrics && run.metrics[field])
      .filter((value) => value != null);
    metrics[field] = range(values);
  });
  return {
    count: list.length,
    foundCount: list.filter((run) => run.found).length,
    replayValidCount: list.filter((run) => run.strictReplay && run.strictReplay.valid).length,
    metrics,
  };
}

module.exports = {
  DEFAULT_POLICIES,
  aggregateRepeats,
  aggregateSegmentReport,
  buildBudgetPlan,
  buildRegressionFromBaseline,
  buildSegmentedChildArgs,
  getPolicyMatrix,
  median,
  range,
  normalizeFirstGoalExpansion,
};
