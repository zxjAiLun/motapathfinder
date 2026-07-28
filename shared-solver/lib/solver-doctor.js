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
    }),
  );
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function mergeKindCounts(target, source) {
  if (!source || typeof source !== "object") return;
  Object.entries(source).forEach(([kind, count]) => {
    target[kind] = (target[kind] || 0) + (Number(count) || 0);
  });
}

function sumKindCounts(counts) {
  return Object.values(counts || {}).reduce(
    (sum, count) => sum + (Number(count) || 0),
    0,
  );
}

function buildDeficitDetail(failedSegment) {
  // Primary: missingGoalFields on the failed segment itself
  const primary = (failedSegment && failedSegment.missingGoalFields) || [];
  if (primary.length > 0) {
    const parts = primary.map((entry) => {
      const field = (entry && entry.field) || "?";
      const expected = entry && entry.expected;
      const actual = entry && entry.actual;
      return `${field}: need ${expected}, have ${actual}`;
    });
    return parts.join("; ");
  }
  // Fallback: search attempts for failure.missingGoalFields
  const attempts = segmentAttempts(failedSegment);
  for (const attempt of attempts) {
    const failure =
      (attempt && attempt.diagnostics && attempt.diagnostics.failure) || null;
    const missing = (failure && failure.missingGoalFields) || [];
    if (missing.length > 0) {
      const parts = missing.map((entry) => {
        const field = (entry && entry.field) || "?";
        const expected = entry && entry.expected;
        const actual = entry && entry.actual;
        return `${field}: need ${expected}, have ${actual}`;
      });
      return parts.join("; ");
    }
  }
  return null;
}

function buildCandidateQuality(failedSegment) {
  const attempts = segmentAttempts(failedSegment);

  // Primary: goalSkyline candidates from attempts
  const goalSkylines = attempts
    .map(
      (attempt) =>
        (attempt && attempt.diagnostics && attempt.diagnostics.goalSkyline) ||
        null,
    )
    .filter(Boolean);

  // If no goal skyline, fallback to bestSeen / bestProgress from diagnostics.failure
  let bestSeenHero = null;
  let bestSeenEffective = null;
  if (goalSkylines.length === 0) {
    for (const attempt of attempts) {
      const failure =
        (attempt && attempt.diagnostics && attempt.diagnostics.failure) || null;
      if (failure && failure.bestSeen) {
        bestSeenHero = failure.bestSeen.hero || bestSeenHero;
        bestSeenEffective = failure.bestSeen.effectiveHero || bestSeenEffective;
      }
      const dp = attemptDp(attempt);
      if (dp.bestSeenState && dp.bestSeenState.hero) {
        bestSeenHero = bestSeenHero || dp.bestSeenState.hero;
      }
    }
  }

  if (goalSkylines.length === 0 && !bestSeenHero) return null;

  let maxHp = -Infinity;
  let maxAtk = -Infinity;
  let maxDef = -Infinity;
  let maxMdef = -Infinity;
  let minRoute = Infinity;

  if (goalSkylines.length > 0) {
    goalSkylines.forEach((skyline) => {
      (skyline.candidates || []).forEach((candidate) => {
        const hero = (candidate && candidate.hero) || {};
        const effective = (candidate && candidate.effectiveHero) || {};
        const hp = Number(hero.hp || 0);
        const atk = Number(effective.atk || hero.atk || 0);
        const def = Number(effective.def || hero.def || 0);
        const mdef = Number(effective.mdef || hero.mdef || 0);
        const routeLen = Number(candidate.routeLength || 0);
        if (hp > maxHp) maxHp = hp;
        if (atk > maxAtk) maxAtk = atk;
        if (def > maxDef) maxDef = def;
        if (mdef > maxMdef) maxMdef = mdef;
        if (routeLen > 0 && routeLen < minRoute) minRoute = routeLen;
      });
    });
  } else if (bestSeenHero) {
    const h = bestSeenHero;
    const e = bestSeenEffective || {};
    maxHp = Number(h.hp || 0);
    maxAtk = Number(e.atk || h.atk || 0);
    maxDef = Number(e.def || h.def || 0);
    maxMdef = Number(e.mdef || h.mdef || 0);
  }

  const parts = [];
  if (maxHp > -Infinity) parts.push(`bestHP=${maxHp}`);
  if (maxAtk > -Infinity) parts.push(`bestAtk=${maxAtk}`);
  if (maxDef > -Infinity) parts.push(`bestDef=${maxDef}`);
  if (maxMdef > -Infinity) parts.push(`bestMdef=${maxMdef}`);
  if (minRoute < Infinity) parts.push(`shortestRoute=${minRoute}`);
  return parts.length > 0 ? parts.join(", ") : null;
}

function failureClassOf(segment) {
  const propagation = (segment && segment.failurePropagation) || {};
  return (
    (segment && segment.failureClass) ||
    propagation.failureClass ||
    propagation.primaryFailureClass ||
    null
  );
}

function segmentAttempts(segment) {
  return Array.isArray(segment && segment.attempts) ? segment.attempts : [];
}

function attemptDp(attempt) {
  const diagnostics = (attempt && attempt.diagnostics) || {};
  return diagnostics.dp || diagnostics || {};
}

function sumAttemptMetric(attempts, name) {
  return attempts.reduce(
    (sum, attempt) => sum + number(attemptDp(attempt)[name]),
    0,
  );
}

function maxAttemptMetric(attempts, name) {
  return attempts.reduce(
    (max, attempt) => Math.max(max, number(attemptDp(attempt)[name])),
    0,
  );
}

function expansionBudgetExhaustedCount(attempts) {
  return attempts.filter((attempt) =>
    Boolean(attemptDp(attempt).expansionBudgetExhausted),
  ).length;
}

function stoppedReasons(attempts) {
  return unique(attempts.map((attempt) => attemptDp(attempt).stoppedReason));
}

function doctorRecommendation(failureClass, evidence) {
  const reasons = new Set(evidence.stoppedReasons || []);
  if (reasons.has("time-limit"))
    return "raise maxRuntimeMs or narrow the segment after checking whether the frontier was still live";
  if (reasons.has("heap-limit") || reasons.has("rss-limit"))
    return "raise maxHeapMb/maxRssMb or reduce the segment/action scope";
  if (evidence.actionTrimmed > 0)
    return "raise maxActionsPerState or widen the action policy before treating this as impossible";
  if (evidence.expansionBudgetExhaustedAttempts > 0)
    return "raise maxExpansions or split the milestone because the frontier was not exhausted";
  if (
    failureClass === "target-action-unreachable" ||
    failureClass === "floor-scope-mismatch"
  ) {
    return "check allowedFloors, allowChangeFloors, presentTiles, and action scope";
  }
  if (failureClass === "upstream-checkpoint-incompatible") {
    return "backtrack to the previous milestone and regenerate a checkpoint preserving required hard presentTiles";
  }
  if (failureClass === "present-tile-overconstrained") {
    return "relax non-essential presentTiles into preferredPresentTiles";
  }
  if (
    failureClass === "life-limit-hp-deficit" ||
    failureClass === "action-survivability-deficit" ||
    failureClass === "hp-deficit"
  ) {
    return "retry from prior milestones with higher HP/defense skyline candidates and larger candidateLimit";
  }
  if (
    failureClass === "atk-deficit" ||
    failureClass === "def-deficit" ||
    failureClass === "mdef-deficit"
  ) {
    return "retry from prior milestones with best-combat and stat-specific skyline candidates";
  }
  if (failureClass === "route-quality-floor-not-met")
    return "backtrack earlier and preserve quality-floor skyline roles";
  return "inspect action scope and budget before concluding the segment is impossible";
}

function likelyCause(failureClass, evidence) {
  if ((evidence.stoppedReasons || []).length > 0)
    return "runtime limit stopped the search";
  if (evidence.actionTrimmed > 0)
    return "action cap may have dropped required actions";
  if (evidence.expansionBudgetExhaustedAttempts > 0)
    return "expansion budget ended with live frontier";
  if (
    failureClass === "target-action-unreachable" ||
    failureClass === "floor-scope-mismatch" ||
    failureClass === "present-tile-overconstrained"
  ) {
    return "goal is unreachable under the current action scope";
  }
  if (failureClass === "upstream-checkpoint-incompatible") {
    return "upstream checkpoint already consumed a required hard present tile";
  }
  if (
    failureClass === "life-limit-hp-deficit" ||
    failureClass === "action-survivability-deficit" ||
    failureClass === "hp-deficit"
  ) {
    return "survivability candidate quality is too low";
  }
  if (
    failureClass === "atk-deficit" ||
    failureClass === "def-deficit" ||
    failureClass === "mdef-deficit" ||
    failureClass === "equipment-missing"
  ) {
    return "required combat/resource state was not preserved";
  }
  if (failureClass === "route-quality-floor-not-met")
    return "final candidate failed the configured quality floor";
  return "no goal state was found under the current segment policy";
}

function buildDoctorLine(report) {
  if (!report || report.status === "solved") return "Doctor: solved.";
  const evidenceParts = [];
  const evidence = report.evidence || {};
  if ((evidence.stoppedReasons || []).length > 0)
    evidenceParts.push(`stoppedReason=${evidence.stoppedReasons.join(",")}`);
  if (evidence.actionTrimmed > 0)
    evidenceParts.push(`actionTrimmed=${evidence.actionTrimmed}`);
  if (evidence.expansionBudgetExhaustedAttempts > 0)
    evidenceParts.push(
      `expansionBudgetExhausted=${evidence.expansionBudgetExhaustedAttempts}`,
    );
  if (evidence.frontierSizeMax > 0)
    evidenceParts.push(`frontierSizeMax=${evidence.frontierSizeMax}`);
  if (evidence.rejectedByHigherHp > 0)
    evidenceParts.push(`rejectedByHigherHp=${evidence.rejectedByHigherHp}`);
  if (evidence.sameHpRejected > 0)
    evidenceParts.push(`sameHpRejected=${evidence.sameHpRejected}`);
  if (evidence.uniqueBattleTargetsMax > 0)
    evidenceParts.push(
      `uniqueBattleTargetsMax=${evidence.uniqueBattleTargetsMax}`,
    );
  if (evidence.uniquePortalEntriesMax > 0)
    evidenceParts.push(
      `uniquePortalEntriesMax=${evidence.uniquePortalEntriesMax}`,
    );
  if (evidence.generatedActions > 0)
    evidenceParts.push(`generatedActions=${evidence.generatedActions}`);
  if (evidence.keptActions > 0)
    evidenceParts.push(`keptActions=${evidence.keptActions}`);
  if (evidence.dominatedActions > 0)
    evidenceParts.push(`dominatedActions=${evidence.dominatedActions}`);
  const evidenceText =
    evidenceParts.length > 0 ? ` Evidence: ${evidenceParts.join(", ")}.` : "";
  const deficitText = report.deficitDetail
    ? ` Deficit: ${report.deficitDetail}.`
    : "";
  return `Doctor: ${report.failedSegmentId || "unknown segment"} failed as ${report.failureClass || "unknown"}; likely ${report.likelyCause}. ${report.recommendation}.${evidenceText}${deficitText}`;
}

function buildSolverDoctorReport(result) {
  const failedSegment = (result && result.failedSegment) || null;
  if (!failedSegment) {
    return {
      status: result && result.found === false ? "failed" : "solved",
      line:
        result && result.found === false
          ? "Doctor: failed before a segment failure was available."
          : "Doctor: solved.",
    };
  }
  const attempts = segmentAttempts(failedSegment);
  const failureClass = failureClassOf(failedSegment) || "unknown";

  // Extract action scope diagnostics from attempt dp diagnostics
  const actionsGeneratedByKind = {};
  const actionsKeptByKind = {};
  const actionsDominatedByKind = {};
  attempts.forEach((attempt) => {
    const dp = attemptDp(attempt);
    mergeKindCounts(actionsGeneratedByKind, dp.actionsGeneratedByKind);
    mergeKindCounts(actionsKeptByKind, dp.actionsKeptByKind);
    mergeKindCounts(actionsDominatedByKind, dp.actionsDominatedByKind);
  });
  const generatedTotal = sumKindCounts(actionsGeneratedByKind);
  const keptTotal = sumKindCounts(actionsKeptByKind);
  const dominatedTotal = sumKindCounts(actionsDominatedByKind);

  // Extract deficit detail from missing goal fields
  const deficitDetail = buildDeficitDetail(failedSegment);

  // Extract candidate quality from goal skyline
  const candidateQuality = buildCandidateQuality(failedSegment);
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
    generatedActions: generatedTotal,
    keptActions: keptTotal,
    dominatedActions: dominatedTotal,
    actionsGeneratedByKind,
    actionsKeptByKind,
    actionsDominatedByKind,
    candidateQuality,
  });
  const report = {
    status: "failed",
    failedSegmentId:
      failedSegment.segmentId || failedSegment.failedSegmentId || null,
    failureClass,
    likelyCause: likelyCause(failureClass, evidence),
    recommendation: doctorRecommendation(failureClass, evidence),
    deficitDetail,
    candidateQuality,
    evidence,
  };
  report.line = buildDoctorLine(report);
  return report;
}

module.exports = {
  buildDoctorLine,
  buildSolverDoctorReport,
};
