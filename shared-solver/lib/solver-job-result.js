"use strict";

const { buildReplayRouteFingerprint } = require("./replay-resume-artifact");

const SOLVER_JOB_RESULT_SCHEMA = "motapathfinder.solver-job-result.v1";

const FAILURE_CLASSES = [
  "INVALID_TASK",
  "GOAL_NOT_REACHED",
  "EXPANSION_BUDGET_EXHAUSTED",
  "RUNTIME_BUDGET_EXHAUSTED",
  "MEMORY_BUDGET_EXHAUSTED",
  "ACTION_SCOPE_INCOMPLETE",
  "ACTION_TRIMMED",
  "POLICY_FILTERED",
  "MILESTONE_OVERCONSTRAINED",
  "STRICT_REPLAY_FAILED",
  "CANCELLED",
  "INTERNAL_ERROR",
];

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function attemptDpDiagnostics(result) {
  const items = [];
  for (const segment of (result || {}).segmentResults || []) {
    for (const attempt of segment.attempts || []) {
      items.push(((attempt.diagnostics || {}).dp) || {});
    }
  }
  return items;
}

function collectStoppedReasons(result) {
  const reasons = new Set();
  attemptDpDiagnostics(result).forEach((dp) => {
    if (dp.stoppedReason) reasons.add(String(dp.stoppedReason));
  });
  return [...reasons];
}

// Failure classification must never equate "budget exhausted", "action
// trimming", "policy filtering", or an over-constrained milestone with a proven
// no-route result.  Those are incomplete-search diagnostics and are retryable.
function classifyJobFailure({ result, proofClaim }) {
  const found = Boolean(result && result.found);
  if (found) return null;
  const cancelled = Boolean(result && (result.cancelled === true ||
    result.stoppedReason === "cancel-requested" ||
    collectStoppedReasons(result).includes("cancel-requested")));
  if (cancelled) {
    return {
      failureClass: "CANCELLED",
      message: "The job was cancelled by request.",
      retryable: false,
      details: {},
    };
  }
  const dpDiagnostics = attemptDpDiagnostics(result);
  const expansionBudgetExhausted = dpDiagnostics.some((dp) => dp.expansionBudgetExhausted === true);
  const actionTrimmed = dpDiagnostics.some((dp) => Number(dp.actionTrimmed || 0) > 0);
  const stoppedReasons = collectStoppedReasons(result);
  const memoryLimited = Boolean(result && (result.memoryLimited === true ||
    (result.budget && result.budget.memoryLimited) ||
    stoppedReasons.some((reason) => /memory/.test(String(reason)))));
  const failedSegment = (result && result.failedSegment) || {};
  const failedClass = String(failedSegment.failureClass || failedSegment.primaryFailureClass || "");

  const details = {
    expansions: dpDiagnostics.reduce((sum, dp) => sum + Number(dp.expansions || 0), 0),
    frontierSize: dpDiagnostics.reduce((sum, dp) => sum + Number(dp.frontierSize || 0), 0),
    actionTrimmed: dpDiagnostics.reduce((sum, dp) => sum + Number(dp.actionTrimmed || 0), 0),
    stoppedReasons,
    failureClass: failedClass || null,
  };

  if (memoryLimited) {
    return {
      failureClass: "MEMORY_BUDGET_EXHAUSTED",
      message: "Search stopped before exhausting the retained frontier because a memory budget was hit.",
      retryable: true,
      details,
    };
  }
  if (stoppedReasons.includes("time-limit") || (proofClaim && proofClaim.budget && proofClaim.budget.runtimeBudgetExhausted)) {
    return {
      failureClass: "RUNTIME_BUDGET_EXHAUSTED",
      message: "Search stopped before exhausting the retained frontier because the runtime budget was hit.",
      retryable: true,
      details,
    };
  }
  if (expansionBudgetExhausted) {
    return {
      failureClass: "EXPANSION_BUDGET_EXHAUSTED",
      message: "Search stopped before exhausting the retained frontier.",
      retryable: true,
      details,
    };
  }
  if (actionTrimmed) {
    return {
      failureClass: "ACTION_TRIMMED",
      message: "The action scope was trimmed; this does not prove the goal is unreachable.",
      retryable: true,
      details,
    };
  }
  if (/milestone|overconstrain/i.test(failedClass)) {
    return {
      failureClass: "MILESTONE_OVERCONSTRAINED",
      message: "A milestone was over-constrained; the goal may still be reachable with a wider policy.",
      retryable: true,
      details,
    };
  }
  if (/policy|filter/i.test(failedClass)) {
    return {
      failureClass: "POLICY_FILTERED",
      message: "Candidates were filtered by policy; this does not prove the goal is unreachable.",
      retryable: true,
      details,
    };
  }
  return {
    failureClass: "GOAL_NOT_REACHED",
    message: proofClaim && proofClaim.completeWithinActionSet
      ? "The goal was not reached within the complete action set."
      : "The goal was not reached; the search scope may be incomplete.",
    retryable: proofClaim ? !proofClaim.completeWithinActionSet : true,
    details,
  };
}

function buildSolverJobResult({
  jobId,
  task,
  status,
  createdAt,
  startedAt,
  finishedAt,
  found,
  failure,
  proofClaim,
  objective,
  routeRecord,
  strictReplayVerified,
  diagnostics,
}) {
  const started = startedAt ? Date.parse(startedAt) : null;
  const finished = finishedAt ? Date.parse(finishedAt) : null;
  const routeFingerprint = routeRecord && typeof buildReplayRouteFingerprint === "function"
    ? buildReplayRouteFingerprint(routeRecord)
    : null;
  return {
    schema: SOLVER_JOB_RESULT_SCHEMA,
    jobId,
    taskFingerprint: task && task.taskFingerprint || null,
    status,
    createdAt: createdAt || new Date().toISOString(),
    startedAt: startedAt || null,
    finishedAt: finishedAt || null,
    durationMs: started && finished ? Math.max(0, finished - started) : null,
    found: Boolean(found),
    failure: failure ? cloneJson(failure) : null,
    proof: proofClaim ? cloneJson(proofClaim) : null,
    objective: objective
      ? {
          fingerprint: objective.fingerprint,
          value: objective.value,
          comparisonTrace: objective.comparisonTrace || [],
        }
      : null,
    route: routeRecord
      ? {
          record: cloneJson(routeRecord),
          strictReplayVerified: Boolean(strictReplayVerified),
          fingerprint: routeFingerprint,
        }
      : null,
    identity: {
      taskFingerprint: task && task.taskFingerprint || null,
      towerFingerprint: task && task.towerFingerprint || null,
      solverModelFingerprint: task && task.solverModelFingerprint || null,
      objectiveFingerprint: task && task.objectiveFingerprint || null,
      routeFingerprint,
    },
    diagnostics: diagnostics ? cloneJson(diagnostics) : null,
  };
}

function serializeError(error) {
  return {
    name: error && error.name || "Error",
    code: error && error.code || null,
    message: error && error.message ? error.message : String(error),
    stack: error && error.stack ? error.stack : null,
  };
}

module.exports = {
  FAILURE_CLASSES,
  SOLVER_JOB_RESULT_SCHEMA,
  buildSolverJobResult,
  classifyJobFailure,
  serializeError,
};
