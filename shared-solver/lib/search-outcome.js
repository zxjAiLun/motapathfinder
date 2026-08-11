"use strict";

const BUDGET_STOP_REASONS = new Set([
  "expansion-limit",
  "time-limit",
  "global-time-limit",
  "heap-limit",
  "rss-limit",
  "memory-limit",
  "global-memory-limit",
]);

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function outcomeClass({ goalFound, searchComplete }) {
  if (goalFound) {
    return searchComplete
      ? "goal-found-search-complete"
      : "goal-found-search-incomplete";
  }
  return searchComplete
    ? "goal-not-found-search-complete"
    : "goal-not-found-search-incomplete";
}

function buildSearchOutcome(input) {
  const fields = input || {};
  const goalFound = fields.goalFound === true;
  const frontierExhausted = fields.frontierSize != null &&
    number(fields.frontierSize) === 0;
  const stoppedReason = fields.stoppedReason == null
    ? null
    : String(fields.stoppedReason);
  const budgetExhausted = fields.expansionBudgetExhausted === true ||
    BUDGET_STOP_REASONS.has(stoppedReason);
  const cancelled = fields.cancelled === true || stoppedReason === "cancel-requested";
  const actionScopeComplete = number(fields.actionTrimmed) === 0;
  const stoppedEarlyForGoal = fields.stopOnFirstGoal === true && goalFound;
  const searchComplete = frontierExhausted &&
    !budgetExhausted &&
    !cancelled &&
    !stoppedReason &&
    actionScopeComplete &&
    !stoppedEarlyForGoal;
  const outcome = {
    goalFound,
    frontierExhausted,
    budgetExhausted,
    searchComplete,
  };
  return {
    ...outcome,
    outcomeClass: outcomeClass(outcome),
  };
}

function outcomeFromAttempt(attempt) {
  const diagnostics = (attempt && attempt.diagnostics) || {};
  const dp = diagnostics.dp || diagnostics;
  if (dp.searchOutcome) return { ...dp.searchOutcome };
  return buildSearchOutcome({
    goalFound: attempt && attempt.found === true,
    frontierSize: dp.frontierSize,
    expansionBudgetExhausted: dp.expansionBudgetExhausted,
    stoppedReason: dp.stoppedReason,
    cancelled: dp.cancelled,
    actionTrimmed: diagnostics.actionTrimmed == null
      ? dp.actionTrimmed
      : diagnostics.actionTrimmed,
    stopOnFirstGoal: dp.stopOnFirstGoal,
  });
}

function resultAttempts(result) {
  const attempts = [];
  for (const segment of (result && result.segmentResults) || []) {
    for (const attempt of segment.attempts || []) attempts.push(attempt);
  }
  return attempts;
}

function buildResultSearchOutcome(result) {
  const found = Boolean(result && result.found);
  const attempts = resultAttempts(result);
  if (attempts.length === 0) {
    const explicit = result && result.searchOutcome;
    if (explicit) {
      return {
        ...explicit,
        goalFound: found,
        outcomeClass: outcomeClass({
          goalFound: found,
          searchComplete: explicit.searchComplete === true,
        }),
      };
    }
    return buildSearchOutcome({
      goalFound: found,
      frontierSize: result && result.frontierSize,
      expansionBudgetExhausted: result && result.expansionBudgetExhausted,
      stoppedReason: result && result.stoppedReason,
      cancelled: result && result.cancelled,
      actionTrimmed: result && result.actionTrimmed,
      stopOnFirstGoal: result && result.stopOnFirstGoal,
    });
  }
  const outcomes = attempts.map(outcomeFromAttempt);
  const aggregate = {
    goalFound: found,
    frontierExhausted: outcomes.every((outcome) => outcome.frontierExhausted),
    budgetExhausted: outcomes.some((outcome) => outcome.budgetExhausted),
    searchComplete: outcomes.every((outcome) => outcome.searchComplete),
  };
  return {
    ...aggregate,
    outcomeClass: outcomeClass(aggregate),
  };
}

module.exports = {
  BUDGET_STOP_REASONS,
  buildResultSearchOutcome,
  buildSearchOutcome,
  outcomeFromAttempt,
};
