"use strict";

const { compileAutomaticDependencyPlan } = require("./automatic-dependency-planner");
const { compileAutomaticFeasibilitySubgoals } = require("./automatic-feasibility-subgoals");
const { buildAutomaticMacroGraph } = require("./automatic-macro-graph");
const {
  executeLocalDependency,
  materializeDirectTargetPlan,
} = require("./local-dependency-executor");

const SCHEMA = "motapathfinder.dependency-feedback.v1";

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildDependencyContext(project, state, terminalGoal, options) {
  const graph = buildAutomaticMacroGraph(project, state, terminalGoal, {
    towerId: (options || {}).towerId || "automatic",
    envelopeMode: "state-visible-revisitable",
  });
  const feasibility = compileAutomaticFeasibilitySubgoals(project, state, terminalGoal, graph);
  const plan = compileAutomaticDependencyPlan(project, state, terminalGoal, graph, feasibility, {
    alternativeLimit: (options || {}).alternativeLimit,
  });
  return { graph, feasibility, plan };
}

function survivalMargin(prerequisite) {
  const evidence = (prerequisite || {}).evidence || {};
  if (evidence.status !== "viable-at-current-state") return null;
  if (evidence.damage == null || evidence.currentHp == null) return 0;
  return number(evidence.currentHp, 0) - number(evidence.damage, 0);
}

function summarizeAlternative(alternative) {
  const prerequisites = (alternative.prerequisites || []).slice();
  const leading = prerequisites[0] || null;
  const leadingStatus = ((leading || {}).evidence || {}).status || "complete";
  return {
    alternativeId: alternative.id,
    remainingPrerequisiteCount: prerequisites.length,
    leadingPrerequisiteId: leading ? leading.sourceNodeId : null,
    leadingStatus,
    leadingDamage: leading && leading.evidence ? leading.evidence.damage : null,
    leadingSurvivalMargin: survivalMargin(leading),
    executable: Boolean(leading && leadingStatus === "viable-at-current-state"),
    complete: prerequisites.length === 0,
    blockedTailCount: prerequisites.slice(1).filter((entry) =>
      ((entry.evidence || {}).status) !== "viable-at-current-state").length,
  };
}

function compareAlternative(left, right) {
  return Number(right.complete) - Number(left.complete) ||
    Number(right.executable) - Number(left.executable) ||
    left.remainingPrerequisiteCount - right.remainingPrerequisiteCount ||
    number(right.leadingSurvivalMargin, -Infinity) - number(left.leadingSurvivalMargin, -Infinity) ||
    left.alternativeId.localeCompare(right.alternativeId);
}

function evaluateCheckpoint(project, terminalGoal, checkpoint, options) {
  const context = buildDependencyContext(project, checkpoint.state, terminalGoal, options);
  const excluded = (options || {}).excludedExperimentKeys || new Set();
  const alternatives = (context.plan.alternatives || []).map((alternative) => {
    const summary = summarizeAlternative(alternative);
    summary.experimentKey = [
      checkpoint.exactStateFingerprint,
      summary.alternativeId,
      summary.leadingPrerequisiteId || "complete",
    ].join("|");
    summary.previouslyAttempted = excluded.has(summary.experimentKey);
    return summary;
  }).sort(compareAlternative);
  const selectedAlternative = alternatives.find((entry) =>
    (entry.complete || entry.executable) && !entry.previouslyAttempted) || null;
  return {
    checkpointId: checkpoint.id,
    roles: (checkpoint.roles || []).slice(),
    exactStateFingerprint: checkpoint.exactStateFingerprint,
    alternatives,
    selectedAlternative,
    canAdvance: Boolean(selectedAlternative),
    feedbackClass: selectedAlternative
      ? selectedAlternative.complete
        ? "dependency-target-reachable"
        : "leading-prerequisite-executable"
      : "all-leading-prerequisites-blocked",
    context,
  };
}

function compareCheckpoint(left, right) {
  const leftAlternative = left.selectedAlternative || {};
  const rightAlternative = right.selectedAlternative || {};
  return Number(right.canAdvance) - Number(left.canAdvance) ||
    Number(Boolean(rightAlternative.complete)) - Number(Boolean(leftAlternative.complete)) ||
    number(leftAlternative.remainingPrerequisiteCount, Infinity) - number(rightAlternative.remainingPrerequisiteCount, Infinity) ||
    number(rightAlternative.leadingSurvivalMargin, -Infinity) - number(leftAlternative.leadingSurvivalMargin, -Infinity) ||
    left.checkpointId.localeCompare(right.checkpointId);
}

function runDependencyFeedback(project, projectRoot, terminalGoal, localExecution, options) {
  if (!project || !terminalGoal || !localExecution) {
    throw new Error("Dependency feedback requires project, terminalGoal, and localExecution");
  }
  const config = options || {};
  const startedAt = Date.now();
  const evaluations = (localExecution.checkpoints || [])
    .map((checkpoint) => evaluateCheckpoint(project, terminalGoal, checkpoint, config))
    .sort((left, right) => {
      if (config.preferFirstGoalCheckpoint === true) {
        const leftFirst = left.roles.includes("first-goal") ? 1 : 0;
        const rightFirst = right.roles.includes("first-goal") ? 1 : 0;
        if (leftFirst !== rightFirst) return rightFirst - leftFirst;
      }
      return compareCheckpoint(left, right);
    });
  const selected = evaluations.find((entry) => entry.canAdvance) || null;
  const baselineCheckpointId = ((localExecution.checkpoints || [])[0] || {}).id || null;
  const baseline = evaluations.find((entry) => entry.checkpointId === baselineCheckpointId) || null;
  const selectedCheckpoint = selected
    ? (localExecution.checkpoints || []).find((entry) => entry.id === selected.checkpointId) || null
    : null;
  const selectedPlan = selected && selected.selectedAlternative
    ? selected.selectedAlternative.complete
      ? materializeDirectTargetPlan(
        selected.context.plan,
        selected.context.plan.objective.selectedFeasibilitySubgoal,
      )
      : {
        ...selected.context.plan,
        alternatives: selected.context.plan.alternatives
          .filter((alternative) => alternative.id === selected.selectedAlternative.alternativeId)
          .concat(selected.context.plan.alternatives.filter((alternative) =>
            alternative.id !== selected.selectedAlternative.alternativeId)),
      }
    : null;
  const plannedAt = Date.now();
  const nextExecution = selectedPlan
    ? executeLocalDependency(
      project,
      projectRoot,
      selectedCheckpoint.state,
      selectedPlan,
      {
        maxExpansions: number(config.maxExpansions, 32),
        candidateLimit: number(config.candidateLimit, 8),
      },
    )
    : null;
  const completedAt = Date.now();
  return {
    schema: SCHEMA,
    inputContract: {
      inputs: ["tower-project", "terminal-goal", "automatic-local-checkpoint-portfolio"],
      forbidden: ["route-fixture", "route-prefix", "authored-milestone", "authored-event-order", "authored-resource-threshold"],
      knownRouteUsed: false,
    },
    baseline: baseline ? {
      checkpointId: baseline.checkpointId,
      roles: baseline.roles,
      canAdvance: baseline.canAdvance,
      feedbackClass: baseline.feedbackClass,
    } : null,
    evaluations: evaluations.map((entry) => ({
      checkpointId: entry.checkpointId,
      roles: entry.roles,
      exactStateFingerprint: entry.exactStateFingerprint,
      alternatives: entry.alternatives,
      selectedAlternative: entry.selectedAlternative,
      canAdvance: entry.canAdvance,
      feedbackClass: entry.feedbackClass,
    })),
    selection: selected ? {
      checkpointId: selected.checkpointId,
      roles: selected.roles,
      alternative: selected.selectedAlternative,
      changedCheckpoint: selected.checkpointId !== baselineCheckpointId,
      changedAlternative: selected.selectedAlternative.alternativeId !==
        ((localExecution.selected || {}).alternativeId || null),
      reason: config.preferFirstGoalCheckpoint === true
        ? "historical-backtrack-prefers-first-goal-then-normal-feedback-order"
        : "fewest-remaining-runnable-alternative-then-largest-leading-survival-margin",
      experimentKey: selected.selectedAlternative.experimentKey,
    } : null,
    nextExecution,
    timing: {
      evaluationAndPlanningMs: plannedAt - startedAt,
      nextExecutionMs: completedAt - plannedAt,
      totalWallMs: completedAt - startedAt,
    },
    verdict: !selected
      ? "DEPENDENCY_FEEDBACK_REQUIRES_NEW_SUBGOAL"
      : nextExecution && nextExecution.outcome.goalFound && nextExecution.checkpointDiversity.allStrictReplay
        ? "DEPENDENCY_FEEDBACK_ADVANCED_WITH_STRICT_REPLAY"
        : "DEPENDENCY_FEEDBACK_SELECTED_NEXT_EXPERIMENT",
  };
}

module.exports = {
  SCHEMA,
  buildDependencyContext,
  evaluateCheckpoint,
  runDependencyFeedback,
  summarizeAlternative,
};
