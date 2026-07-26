"use strict";

const { buildSolverSnapshot } = require("./route-snapshot");
const {
  createStateFromSnapshot,
  resolveRecordedAction,
} = require("./route-store");
const { syncProgress } = require("./progress");
const { buildStateKey } = require("./state-key");

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
  if (value == null || value === "") return null;
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

function finiteValues(values) {
  return (values || [])
    .filter((value) => value != null && value !== "")
    .map(Number)
    .filter(Number.isFinite);
}

function median(values) {
  const sorted = finiteValues(values)
    .sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function range(values) {
  const raw = values || [];
  const finite = finiteValues(raw);
  const missingCount = raw.length - finite.length;
  return {
    min: finite.length > 0 ? Math.min(...finite) : null,
    max: finite.length > 0 ? Math.max(...finite) : null,
    median: median(finite),
    sampleCount: finite.length,
    missingCount,
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
    `--memory-check-interval-expansions=${config.memoryCheckIntervalExpansions == null ? 1 : config.memoryCheckIntervalExpansions}`,
    `--memory-check-interval-actions=${config.memoryCheckIntervalActions == null ? 1 : config.memoryCheckIntervalActions}`,
    `--budget-scope=${config.budgetScope || "per-attempt"}`,
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
  if (config.maxHeapMb != null) args.push(`--max-heap-mb=${config.maxHeapMb}`);
  if (config.maxRssMb != null) args.push(`--max-rss-mb=${config.maxRssMb}`);
  if (config.childOldSpaceMb != null) args.push(`--child-old-space-mb=${config.childOldSpaceMb}`);
  if (outPath) args.push(`--out=${outPath}`);
  return args;
}

function compactReplayState(state) {
  if (!state) return null;
  return {
    floorId: state.floorId || null,
    hero: state.hero || null,
    inventory: state.inventory || null,
    flags: state.flags || null,
    stateKey: buildStateKey(state),
  };
}

function exactStateKeyFromSnapshot(project, snapshot) {
  if (!snapshot) return null;
  try {
    const state = createStateFromSnapshot(project, snapshot, { rank: "chaos" });
    syncProgress(state);
    return buildStateKey(state);
  } catch (error) {
    return null;
  }
}

function strictReplayFailure(result, step, reason, expectedStateKey, actualStateKey, error) {
  return {
    performed: true,
    valid: false,
    stepsAttempted: result.stepsAttempted,
    stepsCompleted: result.stepsCompleted,
    failureStep: step,
    failureReason: reason,
    expectedStateKey: expectedStateKey || null,
    actualStateKey: actualStateKey || null,
    finalState: compactReplayState(result.state),
    error: error ? String(error.message || error) : null,
  };
}

function strictReplayRoute(project, simulator, routeRecord) {
  const record = routeRecord || {};
  const startSnapshot = record.start && record.start.snapshot;
  if (!startSnapshot) {
    return {
      performed: true,
      valid: false,
      stepsAttempted: 0,
      stepsCompleted: 0,
      failureStep: null,
      failureReason: "missing-start-snapshot",
      expectedStateKey: record.start && (record.start.exactStateKey || record.start.stateKey) || null,
      actualStateKey: null,
      finalState: null,
      error: null,
    };
  }
  let state;
  try {
    state = createStateFromSnapshot(project, startSnapshot, {
      rank: record.source && record.source.rank || "chaos",
      route: [],
      decisionDepth: 0,
    });
    syncProgress(state);
  } catch (error) {
    return {
      performed: true,
      valid: false,
      stepsAttempted: (record.decisions || []).length,
      stepsCompleted: 0,
      failureStep: null,
      failureReason: "start-snapshot-restore-failed",
      expectedStateKey: record.start && (record.start.exactStateKey || record.start.stateKey) || null,
      actualStateKey: null,
      finalState: null,
      error: String(error.message || error),
    };
  }
  const result = {
    state,
    stepsAttempted: Array.isArray(record.decisions) ? record.decisions.length : 0,
    stepsCompleted: 0,
  };
  const decisions = Array.isArray(record.decisions) ? record.decisions : [];
  const startExpected = record.start && (
    record.start.exactStateKey || exactStateKeyFromSnapshot(project, startSnapshot)
  );
  if (startExpected && buildStateKey(state) !== startExpected) {
    return strictReplayFailure(
      result,
      null,
      "start-exact-state-mismatch",
      startExpected,
      buildStateKey(state),
    );
  }
  for (let index = 0; index < decisions.length; index += 1) {
    const decision = decisions[index] || {};
    const step = decision.index == null ? index + 1 : decision.index;
    const actualPreStateKey = buildStateKey(state);
    const expectedPreStateKey = decision.preExactStateKey ||
      exactStateKeyFromSnapshot(project, decision.preSnapshot);
    const expectedPostStateKey = decision.postExactStateKey ||
      exactStateKeyFromSnapshot(project, decision.postSnapshot);
    const effectiveDecision = {
      ...decision,
      preExactStateKey: expectedPreStateKey,
      postExactStateKey: expectedPostStateKey,
    };
    if (!expectedPreStateKey) {
      return strictReplayFailure(
        result,
        step,
        "missing-pre-exact-state-key",
        null,
        actualPreStateKey,
      );
    }
    if (actualPreStateKey !== expectedPreStateKey) {
      return strictReplayFailure(
        result,
        step,
        "pre-exact-state-mismatch",
        expectedPreStateKey,
        actualPreStateKey,
      );
    }
    let resolved;
    try {
      resolved = resolveRecordedAction(simulator, state, effectiveDecision, { project });
    } catch (error) {
      return strictReplayFailure(
        result,
        step,
        "action-resolution-error",
        expectedPostStateKey,
        actualPreStateKey,
        error,
      );
    }
    if (!resolved || !resolved.action) {
      return strictReplayFailure(
        result,
        step,
        `action-unavailable:${resolved && resolved.reason || "unknown"}`,
        expectedPostStateKey,
        actualPreStateKey,
      );
    }
    try {
      state = simulator.applyAction(state, resolved.action);
    } catch (error) {
      result.state = state;
      return strictReplayFailure(
        result,
        step,
        "action-apply-error",
        expectedPostStateKey,
        actualPreStateKey,
        error,
      );
    }
    result.state = state;
    const actualPostStateKey = buildStateKey(state);
    if (!expectedPostStateKey) {
      return strictReplayFailure(
        result,
        step,
        "missing-post-exact-state-key",
        null,
        actualPostStateKey,
      );
    }
    if (actualPostStateKey !== expectedPostStateKey) {
      return strictReplayFailure(
        result,
        step,
        "post-exact-state-mismatch",
        expectedPostStateKey,
        actualPostStateKey,
      );
    }
    result.stepsCompleted += 1;
  }
  const expectedFinal = record.final || {};
  const actualFinalStateKey = buildStateKey(state);
  const expectedFinalStateKey = expectedFinal.exactStateKey || expectedFinal.stateKey ||
    exactStateKeyFromSnapshot(project, expectedFinal.snapshot);
  if (!expectedFinalStateKey) {
    return strictReplayFailure(
      result,
      null,
      "missing-final-state-key",
      null,
      actualFinalStateKey,
    );
  }
  if (actualFinalStateKey !== expectedFinalStateKey) {
    return strictReplayFailure(
      result,
      null,
      "final-exact-state-mismatch",
      expectedFinalStateKey,
      actualFinalStateKey,
    );
  }
  const expectedFinalSnapshot = expectedFinal.snapshot;
  if (!expectedFinalSnapshot) {
    return strictReplayFailure(
      result,
      null,
      "missing-final-snapshot",
      expectedFinalStateKey,
      actualFinalStateKey,
    );
  }
  try {
    const actualSnapshot = buildSolverSnapshot(project, state, {
      floorIds: Object.keys(expectedFinalSnapshot.floors || {}),
    });
    if (JSON.stringify(actualSnapshot) !== JSON.stringify(expectedFinalSnapshot)) {
      return strictReplayFailure(
        result,
        null,
        "final-snapshot-mismatch",
        expectedFinalStateKey,
        actualFinalStateKey,
      );
    }
  } catch (error) {
    return strictReplayFailure(
      result,
      null,
      "final-snapshot-compare-error",
      expectedFinalStateKey,
      actualFinalStateKey,
      error,
    );
  }
  return {
    performed: true,
    valid: true,
    stepsAttempted: result.stepsAttempted,
    stepsCompleted: result.stepsCompleted,
    failureStep: null,
    failureReason: null,
    expectedStateKey: expectedFinalStateKey,
    actualStateKey: actualFinalStateKey,
    finalState: compactReplayState(state),
    error: null,
  };
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
    heapUsedMb: max(list.map((attempt) => attempt.diagnostics.memory && attempt.diagnostics.memory.peakHeapUsedMb != null
      ? attempt.diagnostics.memory.peakHeapUsedMb
      : attempt.diagnostics.heapUsedMb)),
    rssMb: max(list.map((attempt) => attempt.diagnostics.memory && attempt.diagnostics.memory.peakRssMb != null
      ? attempt.diagnostics.memory.peakRssMb
      : attempt.diagnostics.rssMb)),
    peakHeapUsedMb: max(list.map((attempt) => attempt.diagnostics.memory && attempt.diagnostics.memory.peakHeapUsedMb != null
      ? attempt.diagnostics.memory.peakHeapUsedMb
      : attempt.diagnostics.heapUsedMb)),
    peakRssMb: max(list.map((attempt) => attempt.diagnostics.memory && attempt.diagnostics.memory.peakRssMb != null
      ? attempt.diagnostics.memory.peakRssMb
      : attempt.diagnostics.rssMb)),
    fairPops: sum(fairness.map((item) => item.fairPops)),
    bestPops: sum(fairness.map((item) => item.bestPops)),
    fairFallbacks: sum(fairness.map((item) => item.fairFallbacks)),
    bestFallbacks: sum(fairness.map((item) => item.bestFallbacks)),
    maxFairQueueAgeExpansions: max(fairness.map((item) => item.maxFairQueueAgeExpansions)),
    minLocalFirstGoalExpansion: firstGoalExpansions.length > 0
      ? Math.min(...firstGoalExpansions)
      : null,
  };
}

function aggregateMemoryReport(report, options) {
  const attempts = attemptDiagnostics(report);
  const diagnostics = attempts.map((attempt) => attempt.diagnostics || {});
  const heapLimitedCount = diagnostics.filter((dp) => dp.stoppedReason === "heap-limit").length;
  const rssLimitedCount = diagnostics.filter((dp) => dp.stoppedReason === "rss-limit").length;
  const peakHeapUsedMb = Math.max(
    max(diagnostics.map((dp) => dp.memory && dp.memory.peakHeapUsedMb != null
      ? dp.memory.peakHeapUsedMb
      : dp.heapUsedMb)),
    number((report && report.memory || {}).peakHeapUsedMb, 0),
  );
  const peakRssMb = Math.max(
    max(diagnostics.map((dp) => dp.memory && dp.memory.peakRssMb != null
      ? dp.memory.peakRssMb
      : dp.rssMb)),
    number((report && report.memory || {}).peakRssMb, 0),
  );
  const firstMemory = diagnostics.find((dp) => dp.memory) || {};
  const requested = (report && report.memory) || {};
  return {
    maxHeapMb: requested.maxHeapMb != null
      ? requested.maxHeapMb
      : options && options.maxHeapMb != null
        ? options.maxHeapMb
        : firstMemory.memory && firstMemory.memory.maxHeapMb != null
          ? firstMemory.memory.maxHeapMb
          : null,
    maxRssMb: requested.maxRssMb != null
      ? requested.maxRssMb
      : options && options.maxRssMb != null
        ? options.maxRssMb
        : firstMemory.memory && firstMemory.memory.maxRssMb != null
          ? firstMemory.memory.maxRssMb
          : null,
    memoryCheckIntervalExpansions: requested.memoryCheckIntervalExpansions != null
      ? requested.memoryCheckIntervalExpansions
      : options && options.memoryCheckIntervalExpansions != null
        ? options.memoryCheckIntervalExpansions
        : firstMemory.memory && firstMemory.memory.memoryCheckIntervalExpansions != null
          ? firstMemory.memory.memoryCheckIntervalExpansions
          : 1,
    memoryCheckIntervalActions: requested.memoryCheckIntervalActions != null
      ? requested.memoryCheckIntervalActions
      : options && options.memoryCheckIntervalActions != null
        ? options.memoryCheckIntervalActions
        : firstMemory.memory && firstMemory.memory.memoryCheckIntervalActions != null
          ? firstMemory.memory.memoryCheckIntervalActions
          : 1,
    peakHeapUsedMb,
    peakRssMb,
    heapLimitedCount,
    rssLimitedCount,
    childMemoryLimitedCount: 0,
    searchCompletion: heapLimitedCount > 0 || rssLimitedCount > 0
      ? "memory-limited"
      : "completed",
  };
}

function firstGoalSummary(attempts) {
  let cumulativeExpansions = 0;
  let cumulativeWallMs = 0;
  for (let index = 0; index < (attempts || []).length; index += 1) {
    const attempt = attempts[index];
    const diagnostics = attempt.diagnostics || {};
    const localExpansions = number(diagnostics.expansions);
    const localWallMs = number(diagnostics.wallMs);
    const firstGoal = finiteOrNull(diagnostics.firstGoalExpansion);
    if (firstGoal != null) {
      return {
        attemptsBeforeFirstGoal: index,
        cumulativeExpansionsToFirstGoal: cumulativeExpansions + firstGoal,
        cumulativeWallMsToFirstGoal: cumulativeWallMs + number(
          diagnostics.firstGoalElapsedMs,
          localWallMs,
        ),
        minLocalFirstGoalExpansion: firstGoal,
      };
    }
    cumulativeExpansions += localExpansions;
    cumulativeWallMs += localWallMs;
  }
  return {
    attemptsBeforeFirstGoal: null,
    cumulativeExpansionsToFirstGoal: null,
    cumulativeWallMsToFirstGoal: null,
    minLocalFirstGoalExpansion: null,
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
    const firstGoal = firstGoalSummary(segmentAttempts);
    return {
      segmentId: segment.segmentId,
      label: segment.label || null,
      found: Boolean(segment.found),
      attempts: segmentAttempts.length,
      finalHp: segment.candidates && segment.candidates[0] && segment.candidates[0].hero
        ? number(segment.candidates[0].hero.hp, null)
        : null,
      metrics: {
        ...aggregateAttemptMetrics(segmentAttempts),
        ...firstGoal,
      },
      stoppedReasons: stoppedReasonsForAttempts(segmentAttempts),
      progress: segment.failurePropagation || null,
    };
  });
  const metrics = aggregateAttemptMetrics(attempts);
  const memory = aggregateMemoryReport(report);
  const finalSegment = segmentMetrics[segmentMetrics.length - 1] || null;
  const finalSegmentIndex = segmentMetrics.length - 1;
  const priorSegments = finalSegmentIndex > 0
    ? segmentMetrics.slice(0, finalSegmentIndex)
    : [];
  const finalGoalKnown = Boolean(
    finalSegment &&
    finalSegment.metrics.cumulativeExpansionsToFirstGoal != null &&
    finalSegment.metrics.cumulativeWallMsToFirstGoal != null,
  );
  const cumulativeExpansionsToFinal = finalGoalKnown
    ? sum(priorSegments.map((segment) => segment.metrics.expansions)) +
      finalSegment.metrics.cumulativeExpansionsToFirstGoal
    : null;
  const cumulativeWallMsToFinal = finalGoalKnown
    ? sum(priorSegments.map((segment) => segment.metrics.wallMs)) +
      finalSegment.metrics.cumulativeWallMsToFirstGoal
    : null;
  metrics.attemptsBeforeFirstGoal = finalSegment && finalSegment.metrics
    ? finalSegment.metrics.attemptsBeforeFirstGoal
    : null;
  metrics.cumulativeFirstGoalExpansion = cumulativeExpansionsToFinal;
  metrics.cumulativeFirstGoalWallMs = cumulativeWallMsToFinal;
  metrics.attemptsToFinalRequestedMilestone = finalGoalKnown
    ? sum(priorSegments.map((segment) => segment.attempts)) +
      finalSegment.metrics.attemptsBeforeFirstGoal + 1
    : null;
  metrics.expansionsToFinalRequestedMilestone = cumulativeExpansionsToFinal;
  metrics.wallMsToFinalRequestedMilestone = cumulativeWallMsToFinal;
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
    memory,
    searchCompletion: memory.searchCompletion,
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

function nullableDelta(left, right) {
  return left == null || right == null ? null : number(left) - number(right);
}

function buildRegressionFromBaseline(current, baseline) {
  if (!baseline) return null;
  const currentMetrics = current.metrics || {};
  const baselineMetrics = baseline.metrics || {};
  return {
    foundDelta: Number(current.found) - Number(baseline.found),
    replayValidDelta: Number(Boolean(current.strictReplay && current.strictReplay.valid)) -
      Number(Boolean(baseline.strictReplay && baseline.strictReplay.valid)),
    finalHpDelta: nullableDelta(
      current.finalState && current.finalState.hero && current.finalState.hero.hp,
      baseline.finalState && baseline.finalState.hero && baseline.finalState.hero.hp,
    ),
    expansionsDelta: number(currentMetrics.expansions) - number(baselineMetrics.expansions),
    wallMsDelta: number(currentMetrics.wallMs) - number(baselineMetrics.wallMs),
  };
}

function buildSegmentRegressionFromBaseline(currentSegments, baselineSegments) {
  const baselineById = new Map(
    (baselineSegments || []).map((segment) => [segment.segmentId, segment]),
  );
  const currentById = new Map(
    (currentSegments || []).map((segment) => [segment.segmentId, segment]),
  );
  const allSegmentIds = [...new Set([
    ...(currentSegments || []).map((segment) => segment.segmentId),
    ...(baselineSegments || []).map((segment) => segment.segmentId),
  ])];
  return Object.fromEntries(
    allSegmentIds.map((segmentId) => {
      const current = currentById.get(segmentId);
      const baseline = baselineById.get(segmentId);
      if (!current && baseline) {
        return [segmentId, {
          currentMissing: true,
          baselineFound: Boolean(baseline.found),
          foundDelta: 0 - Number(Boolean(baseline.found)),
        }];
      }
      if (!baseline) {
        return [segmentId, { baselineMissing: true }];
      }
      const currentMetrics = current.metrics || {};
      const baselineMetrics = baseline.metrics || {};
      return [segmentId, {
        foundDelta: Number(current.found) - Number(Boolean(baseline.found)),
        expansionsDelta: number(currentMetrics.expansions) - number(baselineMetrics.expansions),
        wallMsDelta: number(currentMetrics.wallMs) - number(baselineMetrics.wallMs),
        firstGoalExpansionDelta: nullableDelta(
          currentMetrics.cumulativeExpansionsToFirstGoal,
          baselineMetrics.cumulativeExpansionsToFirstGoal,
        ),
        frontierSizeDelta: nullableDelta(currentMetrics.frontierSize, baselineMetrics.frontierSize),
        finalHpDelta: nullableDelta(current.finalHp, baseline.finalHp),
      }];
    }),
  );
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
    "attemptsToFinalRequestedMilestone",
    "expansionsToFinalRequestedMilestone",
    "wallMsToFinalRequestedMilestone",
  ];
  const metrics = {};
  numericFields.forEach((field) => {
    const values = list.map((run) => run.metrics && run.metrics[field]);
    metrics[field] = range(values);
  });
  return {
    count: list.length,
    foundCount: list.filter((run) => run.found).length,
    replayValidCount: list.filter((run) => run.strictReplay && run.strictReplay.valid).length,
    metrics,
  };
}

function aggregateLedgerCosts(ledger, options) {
  const entries = ledger || [];
  if (entries.length === 0) return null;
  const config = options || {};
  const finalSegmentId = config.finalSegmentId ||
    entries[entries.length - 1].segmentId || null;
  let totalExpansions = 0;
  let totalWallMs = 0;
  const byPhase = {};
  const bySegment = {};
  let firstGoal = null;
  let finalRequestedMilestoneGoal = null;
  let expansionsBeforeFirstGoal = 0;
  let wallMsBeforeFirstGoal = 0;
  let expansionsBeforeFinalGoal = 0;
  let wallMsBeforeFinalGoal = 0;
  let attemptsBeforeFinalGoal = 0;
  const segmentProgress = new Map();
  for (const entry of entries) {
    const dp = entry.diagnostics && entry.diagnostics.dp || {};
    const exp = number(dp.expansions);
    const wall = number(dp.wallMs);
    totalExpansions += exp;
    totalWallMs += wall;
    const phase = entry.phase || "unknown";
    if (!byPhase[phase]) byPhase[phase] = { expansions: 0, wallMs: 0, attempts: 0 };
    byPhase[phase].expansions += exp;
    byPhase[phase].wallMs += wall;
    byPhase[phase].attempts += 1;
    const segId = entry.segmentId || "unknown";
    if (!bySegment[segId]) {
      bySegment[segId] = {
        expansions: 0,
        wallMs: 0,
        attempts: 0,
        expansionsToFirstGoal: null,
        wallMsToFirstGoal: null,
        attemptsToFirstGoal: null,
        firstGoal: null,
      };
      segmentProgress.set(segId, {
        expansions: 0,
        wallMs: 0,
        attempts: 0,
      });
    }
    bySegment[segId].expansions += exp;
    bySegment[segId].wallMs += wall;
    bySegment[segId].attempts += 1;
    const progress = segmentProgress.get(segId);
    const firstGoalExpansion = finiteOrNull(dp.firstGoalExpansion);
    if (firstGoalExpansion != null) {
      const firstGoalElapsedMs = dp.firstGoalElapsedMs == null
        ? wall
        : number(dp.firstGoalElapsedMs);
      const segmentGoal = {
        expansions: progress.expansions + firstGoalExpansion,
        wallMs: progress.wallMs + firstGoalElapsedMs,
        attempts: progress.attempts + 1,
        segmentId: segId,
        phase: entry.phase || "unknown",
      };
      if (!bySegment[segId].firstGoal) {
        bySegment[segId].expansionsToFirstGoal = segmentGoal.expansions;
        bySegment[segId].wallMsToFirstGoal = segmentGoal.wallMs;
        bySegment[segId].attemptsToFirstGoal = segmentGoal.attempts;
        bySegment[segId].firstGoal = segmentGoal;
      }
      if (!firstGoal) {
        firstGoal = {
          ...segmentGoal,
          expansions: expansionsBeforeFirstGoal + firstGoalExpansion,
          wallMs: wallMsBeforeFirstGoal + firstGoalElapsedMs,
        };
      }
      const retainedGoal = entry.found === true || Number(entry.goalCount || 0) > 0;
      if (
        segId === finalSegmentId &&
        retainedGoal &&
        !finalRequestedMilestoneGoal
      ) {
        finalRequestedMilestoneGoal = {
          segmentId: segId,
          phase: entry.phase || "unknown",
          attempts: attemptsBeforeFinalGoal + 1,
          expansions: expansionsBeforeFinalGoal + firstGoalExpansion,
          wallMs: wallMsBeforeFinalGoal + firstGoalElapsedMs,
        };
      }
    }
    progress.expansions += exp;
    progress.wallMs += wall;
    progress.attempts += 1;
    expansionsBeforeFirstGoal += exp;
    wallMsBeforeFirstGoal += wall;
    if (!finalRequestedMilestoneGoal) {
      expansionsBeforeFinalGoal += exp;
      wallMsBeforeFinalGoal += wall;
      attemptsBeforeFinalGoal += 1;
    }
  }
  const repairOverhead = entries
    .filter((entry) => entry.phase !== "initial")
    .reduce((total, entry) => {
      const dp = entry.diagnostics && entry.diagnostics.dp || {};
      return total + number(dp.expansions);
    }, 0);
  return {
    totalExpansions,
    totalWallMs,
    byPhase,
    bySegment,
    repairOverhead,
    firstGoal,
    finalRequestedMilestoneGoal,
    expansionsToFirstGoal: firstGoal ? firstGoal.expansions : null,
    wallMsToFirstGoal: firstGoal ? firstGoal.wallMs : null,
    expansionsToFinalRequestedMilestone: finalRequestedMilestoneGoal
      ? finalRequestedMilestoneGoal.expansions
      : null,
    wallMsToFinalRequestedMilestone: finalRequestedMilestoneGoal
      ? finalRequestedMilestoneGoal.wallMs
      : null,
    attemptsToFinalRequestedMilestone: finalRequestedMilestoneGoal
      ? finalRequestedMilestoneGoal.attempts
      : null,
    attemptCount: entries.length,
  };
}

module.exports = {
  DEFAULT_POLICIES,
  aggregateLedgerCosts,
  aggregateMemoryReport,
  aggregateRepeats,
  aggregateSegmentReport,
  buildBudgetPlan,
  buildRegressionFromBaseline,
  buildSegmentRegressionFromBaseline,
  buildSegmentedChildArgs,
  getPolicyMatrix,
  median,
  range,
  normalizeFirstGoalExpansion,
  nullableDelta,
  strictReplayRoute,
};
