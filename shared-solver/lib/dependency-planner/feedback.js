"use strict";

// Single-checkpoint evaluation and one feedback step. Cross-round state belongs
// to dependency-feedback-controller, which must never be imported from here.
const { compileAutomaticDependencyPlan } = require("../automatic-dependency-planner");
const { compileAutomaticFeasibilitySubgoals } = require("../automatic-feasibility-subgoals");
const { buildAutomaticMacroGraph } = require("../automatic-macro-graph");
const { makeBlindSimulator } = require("../blind-discovery-baseline");
const { executeLocalDependency, materializeDirectTargetPlan } = require("../local-dependency-executor");
const {
  evaluateResourceRepairTrigger,
  isBattleRelevantRepairIntent,
  buildResourceRepairExperiments,
} = require("./repair-experiments");

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

/**
 * PR-5.27f Phase 0A - The branch experiment universe.
 *
 * One branch's executable experiments are `normal alternatives UNION repair
 * experiments`. Every lifecycle decision (portfolio selection, monotonic
 * exhaustion, preferred-cohort collapse, final sweep) must ask THIS object, not
 * the bare normal evaluation, otherwise a branch with a live repair experiment
 * is still recorded as exhausted.
 */
function evaluateBranchExperiments(project, terminalGoal, checkpoint, options) {
  const config = options || {};
  const normalEvaluation = evaluateCheckpoint(project, terminalGoal, checkpoint, config);
  const repairEnabled = config.failureConditionedResourceRepair === true;
  const trigger = repairEnabled
    ? evaluateResourceRepairTrigger(normalEvaluation)
    : {
      triggered: false,
      reason: config.failureConditionedResourceRepair === true
        ? "unexpected"
        : "failure-conditioned-resource-repair-disabled",
      blockedStatuses: [],
      blockedPrerequisites: [],
    };
  let repairExperiments = [];
  const repairRejected = [];
  if (trigger.triggered) {
    const simulator = typeof config.simulatorProvider === "function"
      ? config.simulatorProvider()
      : (typeof config.simulatorFactory === "function" ? config.simulatorFactory() : null);
    if (simulator) {
      const generated = buildResourceRepairExperiments({
        simulator,
        checkpoint,
        trigger,
        candidateLimit: number(config.candidateLimit, 8),
      });
      for (const experiment of generated) {
        if (config.battleRelevantRepairOnly === true) {
          const verdict = isBattleRelevantRepairIntent(experiment);
          if (!verdict.relevant) {
            repairRejected.push({
              intentId: experiment.intentId,
              kind: experiment.kind,
              reason: verdict.reason,
            });
            continue;
          }
        }
        repairExperiments.push(experiment);
      }
    }
  }
  const normalCanAdvance = Boolean(normalEvaluation.canAdvance);
  const effectiveCanAdvance = normalCanAdvance || repairExperiments.length > 0;
  const effectiveFeedbackClass = normalCanAdvance
    ? normalEvaluation.feedbackClass
    : repairExperiments.length > 0
      ? "repair-experiment-available"
      : normalEvaluation.feedbackClass;
  return {
    ...normalEvaluation,
    normalCanAdvance,
    normalFeedbackClass: normalEvaluation.feedbackClass,
    // `canAdvance` / `feedbackClass` now describe the EFFECTIVE universe, so all
    // existing lifecycle passes read the right value without special cases.
    canAdvance: effectiveCanAdvance,
    feedbackClass: effectiveFeedbackClass,
    effectiveCanAdvance,
    effectiveFeedbackClass,
    repairTrigger: {
      triggered: trigger.triggered,
      reason: trigger.reason,
      blockedStatuses: trigger.blockedStatuses.slice(),
      blockedPrerequisites: trigger.blockedPrerequisites.map((entry) => ({ ...entry })),
    },
    repairExperiments,
    repairExperimentCount: repairExperiments.length,
    repairRejected,
  };
}

function summarizeAlternative(alternative) {
  const prerequisites = (alternative.prerequisites || []).slice();
  const leading = prerequisites[0] || null;
  const leadingEvidence = (leading || {}).evidence || {};
  const leadingStatus = leadingEvidence.status || "complete";
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
    // PR-5.27d Phase 1 attribution: the planner already computed the full
    // counterfactual evidence for the leading prerequisite; keep it so a blocked
    // branch can be attributed to "no executable prerequisite" versus "every
    // executable prerequisite was already attempted", with the target floor and
    // evidence status visible instead of inferred.
    leadingPrerequisite: leading ? {
      sourceNodeId: leading.sourceNodeId || null,
      kind: leading.kind || null,
      targetFloorId: ((leading.target || {}).floorId) || null,
      targetX: (leading.target || {}).x == null ? null : number((leading.target || {}).x, null),
      targetY: (leading.target || {}).y == null ? null : number((leading.target || {}).y, null),
      actionGoal: leading.actionGoal ? { ...leading.actionGoal } : null,
      evidence: { ...leadingEvidence },
    } : null,
    tailPrerequisiteIds: prerequisites.slice(1).map((entry) => entry.sourceNodeId || null),
    tailPrerequisiteFloors: prerequisites.slice(1).map((entry) => ((entry.target || {}).floorId) || null),
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
  const config = options || {};
  const buildContext = typeof config.contextBuilder === "function"
    ? config.contextBuilder
    : buildDependencyContext;
  const context = buildContext(project, checkpoint.state, terminalGoal, options);
  const excluded = config.excludedExperimentKeys || new Set();
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
  const hasExecutableAlternative = alternatives.some((entry) =>
    entry.complete || entry.executable);
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
      : hasExecutableAlternative
        ? "all-executable-experiments-already-attempted"
        : "no-currently-executable-leading-prerequisite",
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
  // Same test seam as the loop: defaults are the real modules.
  const executor = typeof config.executeLocalDependency === "function"
    ? config.executeLocalDependency
    : executeLocalDependency;
  const contextBuilder = typeof config.buildDependencyContext === "function"
    ? config.buildDependencyContext
    : buildDependencyContext;
  // PR-5.27f Phase 0A: every checkpoint is scored on its EFFECTIVE experiment
  // universe (normal alternatives UNION repair experiments), not on the normal
  // alternatives alone.
  let repairSimulator = null;
  const repairSimulatorProvider = () => {
    if (!repairSimulator) {
      repairSimulator = typeof config.simulatorFactory === "function"
        ? config.simulatorFactory()
        : makeBlindSimulator(project);
    }
    return repairSimulator;
  };
  const evaluations = (localExecution.checkpoints || [])
    .map((checkpoint) => evaluateBranchExperiments(project, terminalGoal, checkpoint, {
      ...config,
      contextBuilder,
      simulatorProvider: repairSimulatorProvider,
    }))
    .sort((left, right) => {
      if (config.preferFirstGoalCheckpoint === true) {
        const leftFirst = left.roles.includes("first-goal") ? 1 : 0;
        const rightFirst = right.roles.includes("first-goal") ? 1 : 0;
        if (leftFirst !== rightFirst) return rightFirst - leftFirst;
      }
      return compareCheckpoint(left, right);
    });
  // `selected` remains the NORMAL selection. The repair selection is drawn from
  // the same effective-universe ordering, but the two paths must stay distinct:
  // a repair branch has no normal alternative to materialize a plan from.
  const selected = evaluations.find((entry) => entry.normalCanAdvance) || null;
  const baselineCheckpointId = ((localExecution.checkpoints || [])[0] || {}).id || null;
  const baseline = evaluations.find((entry) => entry.checkpointId === baselineCheckpointId) || null;

  // PR-5.27f Phase 0A: repair experiments were already generated as part of each
  // branch's effective universe during evaluation. Selection is a single pass
  // over that universe - first a normal alternative if one exists, otherwise the
  // branch's own repair experiment. There is no separate side-selection path.
  const resourceRepairEnabled = config.failureConditionedResourceRepair === true;
  const repairTriggers = evaluations.map((evaluation) => ({
    checkpointId: evaluation.checkpointId,
    triggered: evaluation.repairTrigger.triggered,
    reason: evaluation.repairTrigger.reason,
    blockedStatuses: evaluation.repairTrigger.blockedStatuses.slice(),
    blockedPrerequisiteIds: evaluation.repairTrigger.blockedPrerequisites
      .map((entry) => entry.identity).filter(Boolean),
    rejectedIntentIds: (evaluation.repairRejected || []).map((entry) => entry.intentId),
  }));
  const selectedEvaluation = evaluations.find((entry) => entry.canAdvance) || null;
  const selectedRepairCandidate = selectedEvaluation
    ? (selectedEvaluation.normalCanAdvance
      ? null
      : (selectedEvaluation.repairExperiments || [])[0] || null)
    : null;
  const repairRejected = evaluations.reduce((sum, entry) => sum + ((entry.repairRejected || []).length), 0);

  const selectedRepair = selectedRepairCandidate;
  const selectedCheckpoint = selected
    ? (localExecution.checkpoints || []).find((entry) => entry.id === selected.checkpointId) || null
    : selectedRepair
      ? (localExecution.checkpoints || []).find((entry) => entry.id === selectedRepair.originCheckpointId) || null
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
  // A repair experiment is executed through the SAME local executor, using the
  // concrete goal + action policy the repair generator synthesized. It is not a
  // bypass: the resulting checkpoints become ordinary child branches, and the
  // next round replans from the child's exact state.
  const repairPlan = selectedRepair
    ? {
      objective: {
        selectedFeasibilitySubgoal: {
          id: selectedRepair.intentId,
          sourceNodeId: selectedRepair.intentId,
          goal: { ...selectedRepair.goal },
          target: { floorId: selectedRepair.goal.floorId },
        },
      },
      alternatives: [
        {
          id: selectedRepair.intentId,
          relation: "OR",
          rank: 1,
          prerequisites: [{
            id: `repair-${selectedRepair.intentId}`,
            kind: "target",
            relation: "AND",
            order: 0,
            sourceNodeId: selectedRepair.intentId,
            actionGoal: { type: "resourceRepair", ...selectedRepair.goal },
            target: { floorId: selectedRepair.goal.floorId },
            evidence: {
              kind: selectedRepair.kind,
              status: "viable-at-current-state",
              reason: "failure-conditioned-resource-repair",
            },
            provenance: "counterfactual-repair-intent",
          }],
          actionPolicy: selectedRepair.actionPolicy,
        },
      ],
    }
    : null;
  const nextExecution = selectedPlan
    ? executor(
      project,
      projectRoot,
      selectedCheckpoint.state,
      selectedPlan,
      {
        maxExpansions: number(config.maxExpansions, 32),
        candidateLimit: number(config.candidateLimit, 8),
      },
    )
    : repairPlan
      ? executor(
        project,
        projectRoot,
        selectedCheckpoint.state,
        repairPlan,
        {
          maxExpansions: number(config.maxExpansions, 32),
          candidateLimit: number(config.candidateLimit, 8),
          goalOverride: { ...selectedRepair.goal },
          actionPolicy: selectedRepair.actionPolicy,
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
    } : (selectedRepair ? {
      // A reuse of the same selection envelope, so the loop's downstream handling
      // (experiment-key burning, branch registration, replanning) is unchanged.
      checkpointId: selectedRepair.originCheckpointId,
      roles: ["resource-repair"],
      alternative: {
        alternativeId: selectedRepair.intentId,
        experimentKey: [
          (selectedCheckpoint || {}).exactStateFingerprint || null,
          selectedRepair.intentId,
          `repair:${selectedRepair.kind}`,
        ].join("|"),
        kind: selectedRepair.kind,
        executable: true,
        complete: false,
        leadingPrerequisiteId: selectedRepair.intentId,
        leadingStatus: "viable-at-current-state",
      },
      changedCheckpoint: selectedRepair.originCheckpointId !== baselineCheckpointId,
      changedAlternative: true,
      reason: "failure-conditioned-resource-repair-selected-because-dependency-universe-is-unattainable",
      experimentKey: [
        (selectedCheckpoint || {}).exactStateFingerprint || null,
        selectedRepair.intentId,
        `repair:${selectedRepair.kind}`,
      ].join("|"),
      resourceRepair: true,
      repairKind: selectedRepair.kind,
      blockedStatuses: selectedRepair.blockedStatuses,
      blockedPrerequisiteIds: (selectedRepair.blockedPrerequisites || [])
        .map((entry) => entry.identity).filter(Boolean),
      blockedPrerequisites: (selectedRepair.blockedPrerequisites || []).map((entry) => ({ ...entry })),
    } : null),
    resourceRepair: {
      enabled: resourceRepairEnabled,
      generatedCount: evaluations.reduce((sum, entry) => sum + (entry.repairExperimentCount || 0), 0),
      generatedIntentIds: evaluations.flatMap((entry) => (entry.repairExperiments || []).map((experiment) => experiment.intentId)),
      selectedIntentId: selectedRepair ? selectedRepair.intentId : null,
      blockedPrerequisiteIds: selectedRepair
        ? (selectedRepair.blockedPrerequisites || []).map((entry) => entry.identity).filter(Boolean)
        : [],
      rejectedCount: repairRejected,
      rejectedByRelevance: repairRejected,
      triggers: repairTriggers,
    },
    nextExecution,
    timing: {
      evaluationAndPlanningMs: plannedAt - startedAt,
      nextExecutionMs: completedAt - plannedAt,
      totalWallMs: completedAt - startedAt,
    },
    verdict: !selected && !selectedRepair
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
  evaluateBranchExperiments,
  summarizeAlternative,
  runDependencyFeedback,
};
