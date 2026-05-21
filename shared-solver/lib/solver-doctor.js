"use strict";

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compactObject(object) {
  return Object.fromEntries(
    Object.entries(object || {}).filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0;
      return Boolean(value);
    })
  );
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function failureClassOf(segment) {
  const propagation = (segment && segment.failurePropagation) || {};
  return (segment && segment.failureClass) ||
    propagation.failureClass ||
    propagation.primaryFailureClass ||
    null;
}

function segmentAttempts(segment) {
  return Array.isArray(segment && segment.attempts) ? segment.attempts : [];
}

function attemptDp(attempt) {
  const diagnostics = (attempt && attempt.diagnostics) || {};
  return diagnostics.dp || diagnostics || {};
}

function sumAttemptMetric(attempts, name) {
  return attempts.reduce((sum, attempt) => sum + number(attemptDp(attempt)[name]), 0);
}

function maxAttemptMetric(attempts, name) {
  return attempts.reduce((max, attempt) => Math.max(max, number(attemptDp(attempt)[name])), 0);
}

function expansionBudgetExhaustedCount(attempts) {
  return attempts.filter((attempt) => Boolean(attemptDp(attempt).expansionBudgetExhausted)).length;
}

function stoppedReasons(attempts) {
  return unique(attempts.map((attempt) => attemptDp(attempt).stoppedReason));
}

function doctorRecommendation(failureClass, evidence) {
  const reasons = new Set(evidence.stoppedReasons || []);
  if (reasons.has("time-limit")) return "raise maxRuntimeMs or narrow the segment after checking whether the frontier was still live";
  if (reasons.has("memory-limit")) return "raise maxHeapMb or reduce the segment/action scope";
  if (evidence.actionTrimmed > 0) return "raise maxActionsPerState or widen the action policy before treating this as impossible";
  if (evidence.expansionBudgetExhaustedAttempts > 0) return "raise maxExpansions or split the milestone because the frontier was not exhausted";
  if (failureClass === "target-action-unreachable" || failureClass === "floor-scope-mismatch") {
    return "check allowedFloors, allowChangeFloors, presentTiles, and action scope";
  }
  if (failureClass === "present-tile-overconstrained") {
    return "relax non-essential presentTiles into preferredPresentTiles";
  }
  if (failureClass === "life-limit-hp-deficit" || failureClass === "action-survivability-deficit" || failureClass === "hp-deficit") {
    return "retry from prior milestones with higher HP/defense skyline candidates and larger candidateLimit";
  }
  if (failureClass === "atk-deficit" || failureClass === "def-deficit" || failureClass === "mdef-deficit") {
    return "retry from prior milestones with best-combat and stat-specific skyline candidates";
  }
  if (failureClass === "route-quality-floor-not-met") return "backtrack earlier and preserve quality-floor skyline roles";
  return "inspect action scope and budget before concluding the segment is impossible";
}

function likelyCause(failureClass, evidence) {
  if ((evidence.stoppedReasons || []).length > 0) return "runtime limit stopped the search";
  if (evidence.actionTrimmed > 0) return "action cap may have dropped required actions";
  if (evidence.expansionBudgetExhaustedAttempts > 0) return "expansion budget ended with live frontier";
  if (failureClass === "target-action-unreachable" || failureClass === "floor-scope-mismatch" || failureClass === "present-tile-overconstrained") {
    return "goal is unreachable under the current action scope";
  }
  if (failureClass === "life-limit-hp-deficit" || failureClass === "action-survivability-deficit" || failureClass === "hp-deficit") {
    return "survivability candidate quality is too low";
  }
  if (failureClass === "atk-deficit" || failureClass === "def-deficit" || failureClass === "mdef-deficit" || failureClass === "equipment-missing") {
    return "required combat/resource state was not preserved";
  }
  if (failureClass === "route-quality-floor-not-met") return "final candidate failed the configured quality floor";
  return "no goal state was found under the current segment policy";
}

function buildDoctorLine(report) {
  if (!report || report.status === "solved") return "Doctor: solved.";
  const evidenceParts = [];
  const evidence = report.evidence || {};
  if ((evidence.stoppedReasons || []).length > 0) evidenceParts.push(`stoppedReason=${evidence.stoppedReasons.join(",")}`);
  if (evidence.actionTrimmed > 0) evidenceParts.push(`actionTrimmed=${evidence.actionTrimmed}`);
  if (evidence.expansionBudgetExhaustedAttempts > 0) evidenceParts.push(`expansionBudgetExhausted=${evidence.expansionBudgetExhaustedAttempts}`);
  if (evidence.frontierSizeMax > 0) evidenceParts.push(`frontierSizeMax=${evidence.frontierSizeMax}`);
  if (evidence.rejectedByHigherHp > 0) evidenceParts.push(`rejectedByHigherHp=${evidence.rejectedByHigherHp}`);
  if (evidence.sameHpRejected > 0) evidenceParts.push(`sameHpRejected=${evidence.sameHpRejected}`);
  if (evidence.uniqueBattleTargetsMax > 0) evidenceParts.push(`uniqueBattleTargetsMax=${evidence.uniqueBattleTargetsMax}`);
  if (evidence.uniquePortalEntriesMax > 0) evidenceParts.push(`uniquePortalEntriesMax=${evidence.uniquePortalEntriesMax}`);
  const evidenceText = evidenceParts.length > 0 ? ` Evidence: ${evidenceParts.join(", ")}.` : "";
  return `Doctor: ${report.failedSegmentId || "unknown segment"} failed as ${report.failureClass || "unknown"}; likely ${report.likelyCause}. ${report.recommendation}.${evidenceText}`;
}

function buildSolverDoctorReport(result) {
  const failedSegment = (result && result.failedSegment) || null;
  if (!failedSegment) {
    return {
      status: result && result.found === false ? "failed" : "solved",
      line: result && result.found === false ? "Doctor: failed before a segment failure was available." : "Doctor: solved.",
    };
  }
  const attempts = segmentAttempts(failedSegment);
  const failureClass = failureClassOf(failedSegment) || "unknown";
  const evidence = compactObject({
    attempts: attempts.length,
    stoppedReasons: stoppedReasons(attempts),
    actionTrimmed: sumAttemptMetric(attempts, "actionTrimmed"),
    expansionBudgetExhaustedAttempts: expansionBudgetExhaustedCount(attempts),
    frontierSizeMax: maxAttemptMetric(attempts, "frontierSize"),
    rejectedByHigherHp: sumAttemptMetric(attempts, "rejectedByHigherHp"),
    sameHpRejected: sumAttemptMetric(attempts, "sameHpRejected"),
    uniqueBattleTargetsMax: maxAttemptMetric(attempts, "uniqueBattleTargets"),
    uniquePortalEntriesMax: maxAttemptMetric(attempts, "uniquePortalEntries"),
  });
  const report = {
    status: "failed",
    failedSegmentId: failedSegment.segmentId || failedSegment.failedSegmentId || null,
    failureClass,
    likelyCause: likelyCause(failureClass, evidence),
    recommendation: doctorRecommendation(failureClass, evidence),
    evidence,
  };
  report.line = buildDoctorLine(report);
  return report;
}

module.exports = {
  buildDoctorLine,
  buildSolverDoctorReport,
};
