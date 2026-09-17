"use strict";

const { compileAutomaticDependencyPlan } = require("./automatic-dependency-planner");
const { compileAutomaticFeasibilitySubgoals } = require("./automatic-feasibility-subgoals");
const { buildAutomaticMacroGraph } = require("./automatic-macro-graph");
const crypto = require("node:crypto");
const { buildStateKey } = require("./state-key");
const { verifyStrictReplay } = require("./strict-replay");
const { makeBlindSimulator } = require("./blind-discovery-baseline");
const { buildCounterfactualRepairIntents } = require("./counterfactual-repair");
const {
  executeLocalDependency,
  materializeDirectTargetPlan,
} = require("./local-dependency-executor");

const SCHEMA = "motapathfinder.dependency-feedback.v1";

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * The checkpoint fingerprint as the one-step controller computes it. Kept in
 * lockstep with `local-dependency-executor.stateFingerprint` so the loop can
 * burn the round-0 experiment identity without having to re-run the executor.
 */
function stateFingerprintOf(state) {
  return crypto.createHash("sha256").update(buildStateKey(state)).digest("hex").slice(0, 16);
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
 * PR-5.27e - Failure-conditioned resource-repair trigger.
 *
 * A branch qualifies for resource-repair experiments ONLY when the normal
 * dependency planner has no executable prerequisite AND the blocking evidence is
 * a battle-feasibility failure with the CURRENT resources
 * (`unbeatable-at-current-stats` / `lethal-at-current-hp`).
 *
 * Deliberately narrow: if any alternative exposes an executable/complete leading
 * prerequisite, repair MUST NOT activate, otherwise the planner degenerates into
 * "always farm resources first".
 */
const RESOURCE_REPAIR_TRIGGER_STATUSES = new Set([
  "unbeatable-at-current-stats",
  "lethal-at-current-hp",
]);

/**
 * PR-5.27f - Same-prerequisite identity.
 *
 * A conversion claim is only meaningful for ONE specific battle: the same
 * prerequisite node, on the same floor, at the same coordinate. Statuses alone
 * cannot carry that, because the replan may surface an entirely different
 * battle that happens to be viable.
 */
function prerequisiteIdentityOf(identity) {
  if (!identity) return null;
  const sourceNodeId = identity.sourceNodeId != null
    ? String(identity.sourceNodeId)
    : (identity.prerequisiteId != null ? String(identity.prerequisiteId) : null);
  if (sourceNodeId == null) return null;
  const floorId = identity.floorId != null ? String(identity.floorId) : null;
  const x = identity.x == null ? null : number(identity.x, null);
  const y = identity.y == null ? null : number(identity.y, null);
  return [
    sourceNodeId,
    floorId == null ? "-" : floorId,
    x == null || y == null ? "-" : `${x},${y}`,
  ].join("|");
}

/** Normalizes either planner shape into `{ sourceNodeId, floorId, x, y }`. */
function normalizePrerequisiteIdentity(source) {
  if (!source) return null;
  const target = source.target || {};
  const sourceNodeId = source.sourceNodeId != null
    ? String(source.sourceNodeId)
    : (source.prerequisiteId != null ? String(source.prerequisiteId) : null);
  if (sourceNodeId == null) return null;
  const floorId = source.floorId != null
    ? source.floorId
    : (source.targetFloorId != null ? source.targetFloorId : (target.floorId != null ? target.floorId : null));
  const x = source.x != null ? number(source.x, null)
    : (source.targetX != null ? number(source.targetX, null) : (target.x != null ? number(target.x, null) : null));
  const y = source.y != null ? number(source.y, null)
    : (source.targetY != null ? number(source.targetY, null) : (target.y != null ? number(target.y, null) : null));
  return { sourceNodeId, floorId: floorId == null ? null : String(floorId), x, y };
}

function evaluateResourceRepairTrigger(evaluation) {
  if (!evaluation || evaluation.canAdvance) {
    return {
      triggered: false,
      reason: "normal-dependency-can-advance",
      blockedStatuses: [],
      blockedPrerequisites: [],
    };
  }
  if (evaluation.feedbackClass !== "no-currently-executable-leading-prerequisite") {
    return {
      triggered: false,
      reason: "blocked-for-a-non-viability-reason",
      blockedStatuses: [],
      blockedPrerequisites: [],
    };
  }
  const blockedStatuses = [];
  const blockedPrerequisites = [];
  for (const alternative of evaluation.alternatives || []) {
    const leading = alternative.leadingPrerequisite || null;
    const status = ((leading || {}).evidence || {}).status
      || alternative.leadingStatus
      || null;
    if (!status || !RESOURCE_REPAIR_TRIGGER_STATUSES.has(status)) continue;
    blockedStatuses.push(status);
    const normalized = normalizePrerequisiteIdentity(leading);
    blockedPrerequisites.push({
      ...(normalized || { sourceNodeId: null, floorId: null, x: null, y: null }),
      kind: leading ? (leading.kind || null) : null,
      alternativeId: alternative.alternativeId || null,
      statusBefore: status,
      identity: prerequisiteIdentityOf(normalized),
      evidenceBefore: leading ? { ...(leading.evidence || {}) } : null,
    });
  }
  if (blockedStatuses.length === 0) {
    return {
      triggered: false,
      reason: "no-battle-feasibility-blocked-prerequisite",
      blockedStatuses,
      blockedPrerequisites,
    };
  }
  return {
    triggered: true,
    reason: "battle-prerequisite-unattainable-with-current-resources",
    blockedStatuses,
    blockedPrerequisites,
  };
}

/**
 * PR-5.27f - Battle-relevance gate (narrow, first version).
 *
 * A battle-feasibility repair must make POSITIVE PERSISTENT COMBAT RESOURCE
 * PROGRESS: ATK / DEF / MDEF / HP / LV / EXP / equipment. Deliberately NOT a
 * scalar score and NOT a general "usefulness" filter: money, inventory and
 * multi-step EXP preparation all stay allowed.
 *
 * The single rejected shape is the one actually observed in 5.27e (70 of 73
 * selections): a pure path/unlock whose combat-resource delta is entirely zero,
 * which can be re-generated at every new exact state without ever touching the
 * battle that triggered the repair.
 */
function isBattleRelevantRepairIntent(intent) {
  const delta = (intent || {}).structuralDelta || {};
  const combatGain = number(delta.atk, 0) > 0
    || number(delta.def, 0) > 0
    || number(delta.mdef, 0) > 0
    || number(delta.hp, 0) > 0
    || number(delta.lv, 0) > 0
    || number(delta.exp, 0) > 0
    || (Array.isArray(delta.equipment) && delta.equipment.length > 0);
  if (combatGain) return { relevant: true, reason: "positive-combat-resource-delta" };
  const kind = String((intent || {}).kind || "");
  if (kind === "path/unlock" || /path|unlock/.test(kind)) {
    return { relevant: false, reason: "pure-path-unlock-without-combat-resource-delta" };
  }
  return { relevant: true, reason: "non-path-intent-retained" };
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

/**
 * Re-reads the SAME prerequisite identities from a replanned evaluation.
 * Reuses the planner's own battle-evidence objects; this never recomputes
 * damage, it only reports what the planner already decided.
 */
function collectReplannedPrerequisiteStatuses(afterEvaluation) {
  const statuses = new Map();
  const plan = afterEvaluation && afterEvaluation.context ? afterEvaluation.context.plan : null;
  for (const alternative of ((plan || {}).alternatives || [])) {
    for (const prereq of (alternative.prerequisites || [])) {
      const identity = prerequisiteIdentityOf(normalizePrerequisiteIdentity(prereq));
      if (!identity) continue;
      const status = ((prereq.evidence || {}).status) || "complete";
      const previous = statuses.get(identity);
      if (previous === "viable-at-current-state") continue;
      statuses.set(identity, status);
    }
  }
  return statuses;
}

/**
 * Builds the conditionally generated resource-repair experiments for a blocked
 * checkpoint. Reuses the existing counterfactual repair generator rather than
 * inventing a weighted resource score.
 */
function buildResourceRepairExperiments({
  simulator,
  checkpoint,
  trigger,
  candidateLimit,
}) {
  if (!trigger || trigger.triggered !== true) return [];
  const intents = buildCounterfactualRepairIntents({
    simulator,
    startCandidates: [{ id: checkpoint.id, state: checkpoint.state }],
    triggerFailure: "unbeatable-battle-prerequisite",
    failedSegment: null,
    candidateLimit,
  });
  return intents.map((intent, index) => ({
    ...intent,
    experimentKind: "resource-repair",
    repairIndex: index,
    blockedStatuses: trigger.blockedStatuses.slice(),
    blockedPrerequisites: (trigger.blockedPrerequisites || []).map((entry) => ({ ...entry })),
    originCheckpointId: checkpoint.id,
  }));
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

/**
 * PR-5.27a - Route-free terminal goal predicate.
 *
 * The loop must decide "has the terminal goal been reached" on its own, so this
 * is the only place that reads the goal object. It is deliberately generic and
 * mirrors the terms the macro graph already compiles target nodes from
 * (floorId, and for a boss the poi coordinate plus its defeating):
 *   - floorReached   -> the run is standing on the terminal floor
 *   - bossDefeated   -> the run is on the terminal floor and the target poi is gone
 *
 * There is no floor list, no corridor, no authored milestone and no authored
 * coordinate beyond the single terminal goal the caller passed in.
 */
function terminalGoalReached(project, state, terminalGoal) {
  if (!state || !terminalGoal) return false;
  if (state.floorId !== terminalGoal.floorId) return false;
  if (terminalGoal.type === "floorReached") return true;
  if (terminalGoal.type !== "bossDefeated") return false;
  const floor = ((project || {}).floors || {})[terminalGoal.floorId];
  if (!floor) return false;
  const targetX = Number(terminalGoal.x);
  const targetY = Number(terminalGoal.y);
  const pois = Array.isArray(floor.pois) ? floor.pois : [];
  const poi = pois.find((entry) => Number(entry.x) === targetX && Number(entry.y) === targetY);
  if (!poi) return false;
  // The target is defeated when its poi is no longer reported on the map.
  const survivors = typeof floor.currentPois === "function" ? floor.currentPois(state) : null;
  if (Array.isArray(survivors)) {
    return !survivors.some((entry) => Number(entry.x) === targetX && Number(entry.y) === targetY);
  }
  const triggered = (state.triggeredAutoEvents || {});
  const key = `${terminalGoal.floorId}:${targetX},${targetY}`;
  return triggered[key] === true;
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

function runDependencyFeedbackLoop(project, projectRoot, terminalGoal, initialState, options) {
  if (!project || !terminalGoal || !initialState) {
    throw new Error("Dependency feedback loop requires project, terminalGoal, and initialState");
  }
  const config = options || {};
  const maxRounds = Math.max(1, number(config.maxRounds, 8));
  const maxTotalLocalExpansions = Math.max(1, number(config.maxTotalLocalExpansions, 4096));
  const localMaxExpansions = Math.max(1, number(config.localMaxExpansions, 64));
  const candidateLimit = Math.max(2, number(config.candidateLimit, 8));
  const contextOptions = { towerId: config.towerId, alternativeLimit: config.alternativeLimit };
  const startedAt = Date.now();

  // Test seam: the loop's own contract (branch portfolio, backtracking, budget
  // clamping, route stitching) must be provable on a synthetic world whose shape
  // is guaranteed, not by waiting for the real tower to produce a forced
  // backtrack. Overriding these two does not change any production behaviour,
  // because their defaults are the real planner and the real executor.
  const executeLocal = typeof config.executeLocalDependency === "function"
    ? config.executeLocalDependency
    : executeLocalDependency;
  const buildContext = typeof config.buildDependencyContext === "function"
    ? config.buildDependencyContext
    : buildDependencyContext;

  // PR-5.27b: the loop keeps a PERSISTENT BRANCH PORTFOLIO instead of chaining a
  // single `previousExecution`. Each round's selection is drawn from every branch
  // that can still advance, so a blocked branch can be abandoned and an older
  // branch revisited. Without this, "the current portfolio is blocked" is
  // indistinguishable from "the search is exhausted".
  const branches = new Map();
  const attempts = [];
  // PR-5.27e: failure-conditioned resource-repair accounting.
  const battleRelevantRepairOnly = config.battleRelevantRepairOnly === true;
  const repairTelemetry = {
    generated: 0,
    selected: 0,
    checkpointsCreated: 0,
    convertedToViable: 0,
    exactSamePrerequisiteConversions: 0,
    blockedStatusesSeen: {},
    attempts: [],
    conversions: [],
    rejectedByRelevance: 0,
    rejectedIntentKinds: {},
  };
  const rounds = [];
  const visitedExactCheckpointStates = new Set();
  const attemptedExperimentKeys = new Set();
  const commitSuccessfulLineage = config.commitSuccessfulLineage === true;
  const failureConditionedResourceRepair = config.failureConditionedResourceRepair === true;
  let preferredCohortBranchIds = new Set();
  let lastEvaluationMap = new Map();
  let totalLocalExpansions = 0;
  let branchCounter = 0;
  let frontierState = initialState;
  let frontierOrigin = "route-free-initial-state";

  const newBranchId = () => {
    branchCounter += 1;
    return `branch-${branchCounter}`;
  };

  // The global expansion budget is HARD: a local call may only spend what is left
  // of it. The pre-round `>=` check alone is not enough, because issuing the next
  // call with the full local budget can overshoot the global ceiling before the
  // check is reached again.
  const remainingGlobalBudget = () => maxTotalLocalExpansions - totalLocalExpansions;
  const effectiveLocalBudget = () => Math.min(localMaxExpansions, remainingGlobalBudget());

  const registerBranch = (parentBranchId, state, cumulativeDecisions, exactStateFingerprint, via) => {
    const branchId = newBranchId();
    const parent = parentBranchId ? branches.get(parentBranchId) : null;
    const branch = {
      branchId,
      parentBranchId: parent ? parent.branchId : null,
      state,
      exactStateFingerprint,
      cumulativeDecisions: cumulativeDecisions.slice(),
      status: "open",
      depth: parent ? parent.depth + 1 : 0,
      openedByRound: rounds.length,
      openedVia: via || null,
      attemptCount: 0,
      attemptedExperimentKeys: [],
      exhaustedReason: null,
    };
    branches.set(branchId, branch);
    return branch;
  };

  // Round 0 treats the caller's exact state as a portfolio of one. No route, no
  // prefix, no authored subgoal.
  const rootBranch = registerBranch(
    null,
    initialState,
    [],
    stateFingerprintOf(initialState),
    "route-free-initial-state",
  );
  const initialContext = buildContext(project, initialState, terminalGoal, contextOptions);
  const initialExecution = executeLocal(project, projectRoot, initialState, initialContext.plan, {
    maxExpansions: effectiveLocalBudget(),
    candidateLimit,
    simulatorFactory: config.simulatorFactory,
  });
  totalLocalExpansions += number(initialExecution.outcome.expansions, 0);
  rootBranch.attemptCount += 1;
  if (initialExecution.selected) {
    // The initial execution selects a prerequisite too, so its experiment identity
    // must be burned as well. Otherwise round 1 can legitimately re-select the very
    // same (checkpoint state, alternative, prerequisite) triple, which is exactly
    // the duplication this loop exists to prevent.
    const initialKey = [
      rootBranch.exactStateFingerprint,
      initialExecution.selected.alternativeId,
      (initialExecution.selected.prerequisite || {}).sourceNodeId || "complete",
    ].join("|");
    attemptedExperimentKeys.add(initialKey);
    rootBranch.attemptedExperimentKeys.push(initialKey);
    attempts.push({
      experimentKey: initialKey,
      branchId: rootBranch.branchId,
      round: 0,
      expansions: number(initialExecution.outcome.expansions, 0),
      outcome: initialExecution.outcome.budgetExhausted === true
        ? "attempted-but-inconclusive"
        : initialExecution.outcome.frontierExhausted === true
          ? "exhausted"
          : "produced-checkpoints",
    });
  }
  const initialCheckpoints = initialExecution.checkpoints || [];
  rounds.push({
    round: 0,
    kind: "initial-local-execution",
    origin: frontierOrigin,
    branchId: rootBranch.branchId,
    selected: initialExecution.selected
      ? {
        branchId: rootBranch.branchId,
        alternativeId: initialExecution.selected.alternativeId,
        prerequisiteId: initialExecution.selected.prerequisite.sourceNodeId,
      }
      : null,
    outcome: {
      goalFound: initialExecution.outcome.goalFound,
      expansions: number(initialExecution.outcome.expansions, 0),
      budgetExhausted: initialExecution.outcome.budgetExhausted,
      frontierExhausted: initialExecution.outcome.frontierExhausted,
      reason: initialExecution.outcome.reason || null,
    },
    checkpointCount: initialCheckpoints.length,
    checkpointDiversity: initialExecution.checkpointDiversity || null,
    verdict: initialExecution.verdict,
  });

  // Each retained checkpoint from the initial execution becomes its own open
  // branch, carrying the accumulated decisions that reached it.
  const childBranches = [];
  for (const checkpoint of initialCheckpoints) {
    visitedExactCheckpointStates.add(checkpoint.exactStateFingerprint);
    const child = registerBranch(
      rootBranch.branchId,
      checkpoint.state,
      Array.isArray((checkpoint.routeRecord || {}).decisions) ? checkpoint.routeRecord.decisions : [],
      checkpoint.exactStateFingerprint,
      "initial-checkpoint",
    );
    childBranches.push({ branch: child, checkpoint });
  }

  // PR-5.27c: If round 0 opened children and commitment is enabled, seed preferred cohort
  // with those children so round 1 continues exploring the newly opened lineage.
  if (commitSuccessfulLineage && childBranches.length > 0) {
    preferredCohortBranchIds = new Set(childBranches.map((entry) => entry.branch.branchId));
  }

  let frontierStateKey = null;
  let terminationReason = null;
  let terminationClass = null;
  const initialTerminalEntry = childBranches.find((entry) =>
    terminalGoalReached(project, entry.checkpoint.state, terminalGoal)) || null;
  let reachedTerminal = Boolean(initialTerminalEntry);
  let terminalBranchId = initialTerminalEntry ? initialTerminalEntry.branch.branchId : null;
  if (reachedTerminal) {
    terminationReason = "terminal-goal-reached-in-initial-execution";
    terminationClass = "TERMINAL_GOAL_REACHED";
  } else if (childBranches.length > 0) {
    frontierState = childBranches[0].branch.state;
    frontierStateKey = childBranches[0].branch.exactStateFingerprint;
    frontierOrigin = `initial-checkpoint:${childBranches[0].checkpoint.id}`;
  } else if (initialExecution.outcome.searchComplete === true) {
    rootBranch.status = "exhausted";
    rootBranch.exhaustedReason = "initial-execution-proved-no-continuation";
    terminationReason = "initial-execution-proved-no-continuation";
    terminationClass = "GLOBAL_PORTFOLIO_EXHAUSTED";
  }

  const openBranches = () => Array.from(branches.values()).filter((branch) => branch.status !== "exhausted");

  // A portfolio of the still-open branches, shaped like the checkpoint lists the
  // one-step controller already knows how to rank. This is what makes selection
  // draw from the whole history rather than only the newest execution.
  const buildPortfolio = () => openBranches().map((branch) => ({
    id: branch.branchId,
    roles: branch.parentBranchId ? [`branch-depth-${branch.depth}`] : ["root-branch"],
    exactStateFingerprint: branch.exactStateFingerprint,
    state: branch.state,
  }));

  let roundIndex = 0;

  while (!reachedTerminal && terminationReason == null && roundIndex < maxRounds) {
    if (remainingGlobalBudget() <= 0) {
      terminationReason = "global-local-expansion-budget-exhausted";
      terminationClass = "LOCAL_BUDGET_LIMITED";
      break;
    }
    roundIndex += 1;

    // PR-5.27c: Commit-on-Success, Backtrack-on-Block.
    // When commitSuccessfulLineage is enabled and preferredCohortBranchIds contains
    // open branches, evaluate the preferred cohort first.
    // If any preferred child canAdvance, restrict selection to the cohort.
    // If all preferred children are blocked/exhausted, fall back to global historical open branches.
    let portfolio;
    let usingPreferredCohort = false;
    if (commitSuccessfulLineage && preferredCohortBranchIds.size > 0) {
      const cohortOpen = Array.from(preferredCohortBranchIds)
        .map((id) => branches.get(id))
        .filter((branch) => branch && branch.status !== "exhausted");
      if (cohortOpen.length > 0) {
        portfolio = cohortOpen.map((branch) => ({
          id: branch.branchId,
          roles: branch.parentBranchId ? [`branch-depth-${branch.depth}`] : ["root-branch"],
          exactStateFingerprint: branch.exactStateFingerprint,
          state: branch.state,
        }));
        usingPreferredCohort = true;
      } else {
        preferredCohortBranchIds.clear();
      }
    }

    if (!portfolio || portfolio.length === 0) {
      portfolio = buildPortfolio();
      usingPreferredCohort = false;
    }

    let feedback = runDependencyFeedback(project, projectRoot, terminalGoal, { checkpoints: portfolio }, {
      ...contextOptions,
      excludedExperimentKeys: attemptedExperimentKeys,
      maxExpansions: effectiveLocalBudget(),
      candidateLimit,
      simulatorFactory: config.simulatorFactory,
      failureConditionedResourceRepair,
      battleRelevantRepairOnly,
      // Forward the test seam so a synthetic world can drive the whole stack.
      buildDependencyContext: buildContext,
      executeLocalDependency: executeLocal,
    });

    // If preferred cohort was evaluated but none could advance, mark non-advancing branches
    // as exhausted under the monotonic contract, clear preferred cohort, and fall back to global portfolio.
    if (usingPreferredCohort && !feedback.selection) {
      for (const ev of feedback.evaluations || []) {
        if (!ev.canAdvance) {
          const b = branches.get(ev.checkpointId);
          if (b && b.status !== "exhausted") {
            b.status = "exhausted";
            b.exhaustedReason = ev.feedbackClass;
            b.lastEvaluationAlternatives = ev.alternatives;
          }
        }
      }
      preferredCohortBranchIds.clear();
      portfolio = buildPortfolio();
      usingPreferredCohort = false;
      feedback = runDependencyFeedback(project, projectRoot, terminalGoal, { checkpoints: portfolio }, {
        ...contextOptions,
        excludedExperimentKeys: attemptedExperimentKeys,
        maxExpansions: effectiveLocalBudget(),
        candidateLimit,
        simulatorFactory: config.simulatorFactory,
        failureConditionedResourceRepair,
        battleRelevantRepairOnly,
        buildDependencyContext: buildContext,
        executeLocalDependency: executeLocal,
      });
    }

    // Monotonic branch exhaustion: for all branches evaluated in this portfolio pass,
    // if canAdvance is false, mark exhausted under the current planner contract
    // (an immutable state's available experiments can only shrink as attemptedExperimentKeys grows).
    lastEvaluationMap.clear();
    for (const ev of feedback.evaluations || []) {
      lastEvaluationMap.set(ev.checkpointId, ev);
      if (!ev.canAdvance) {
        const b = branches.get(ev.checkpointId);
        if (b && b.status !== "exhausted") {
          b.status = "exhausted";
          b.exhaustedReason = ev.feedbackClass;
          b.lastEvaluationAlternatives = ev.alternatives;
        }
      }
    }

    const selection = feedback.selection;
    const nextExecution = feedback.nextExecution;
    const selectedBranch = selection ? branches.get(selection.checkpointId) || null : null;
    const previousStepRound = rounds.filter((entry) => entry.kind === "dependency-feedback-step").slice(-1)[0];

    // Deduplication is the loop's own contract: an experimentKey is burned the
    // moment it is selected, whether or not the local execution produced anything.
    let experimentKeyReused = false;
    if (selection && selection.experimentKey) {
      experimentKeyReused = attemptedExperimentKeys.has(selection.experimentKey);
      attemptedExperimentKeys.add(selection.experimentKey);
    }

    const nextCheckpoints = (nextExecution && nextExecution.checkpoints) || [];
    const nextExpansions = nextExecution ? number(nextExecution.outcome.expansions, 0) : 0;
    totalLocalExpansions += nextExpansions;

    const localOutcome = !nextExecution
      ? "not-executed"
      : nextExecution.outcome.budgetExhausted === true
        ? "attempted-but-inconclusive"
        : nextCheckpoints.length > 0
          ? "produced-checkpoints"
          : nextExecution.outcome.searchComplete === true
            ? "exhausted"
            : "attempted-but-inconclusive";
    if (selection && selection.experimentKey) {
      attempts.push({
        experimentKey: selection.experimentKey,
        branchId: selectedBranch ? selectedBranch.branchId : null,
        round: roundIndex,
        expansions: nextExpansions,
        outcome: localOutcome,
      });
    }
    if (selectedBranch) {
      selectedBranch.attemptCount += 1;
      if (selection && selection.experimentKey) {
        selectedBranch.attemptedExperimentKeys.push(selection.experimentKey);
      }
    }

    // PR-5.27e telemetry: the repair mechanism is only meaningful if it actually
    // converts a previously blocked battle into a viable one after replanning.
    if (feedback.resourceRepair && feedback.resourceRepair.enabled) {
      repairTelemetry.generated += number(feedback.resourceRepair.generatedCount, 0);
      repairTelemetry.rejectedByRelevance += number(feedback.resourceRepair.rejectedByRelevance, 0);
      for (const entry of (feedback.resourceRepair.triggers || [])) {
        for (const kind of (entry.rejectedIntentIds || [])) {
          const label = String(kind).replace(/^cf-d\d+-/, "");
          repairTelemetry.rejectedIntentKinds[label] =
            (repairTelemetry.rejectedIntentKinds[label] || 0) + 1;
        }
      }
      for (const status of (selection && selection.blockedStatuses) || []) {
        repairTelemetry.blockedStatusesSeen[status] =
          (repairTelemetry.blockedStatusesSeen[status] || 0) + 1;
      }
    }
    const repairSelected = Boolean(selection && selection.resourceRepair);
    if (repairSelected) {
      repairTelemetry.selected += 1;
      if (nextCheckpoints.length > 0) repairTelemetry.checkpointsCreated += nextCheckpoints.length;
      repairTelemetry.attempts.push({
        round: roundIndex,
        originBranchId: selectedBranch ? selectedBranch.branchId : null,
        originCheckpointId: selection.checkpointId,
        intentId: selection.alternative.alternativeId,
        repairKind: selection.repairKind || null,
        blockedStatuses: (selection.blockedStatuses || []).slice(),
        blockedPrerequisiteIds: (selection.blockedPrerequisiteIds || []).slice(),
        experimentKey: selection.experimentKey,
        expansions: nextExpansions,
        checkpointCount: nextCheckpoints.length,
        childBranchIds: [],
      });
    }

    const terminalEntry = nextCheckpoints
      .map((checkpoint) => ({ checkpoint }))
      .find((entry) => terminalGoalReached(project, entry.checkpoint.state, terminalGoal)) || null;

    // Child branches inherit the parent's accumulated decisions and append this
    // local segment, so the lineage is explicit rather than relying on a
    // checkpoint's own route happening to contain the prefix.
    const openedChildren = [];
    for (const checkpoint of nextCheckpoints) {
      visitedExactCheckpointStates.add(checkpoint.exactStateFingerprint);
      const child = registerBranch(
        selectedBranch ? selectedBranch.branchId : rootBranch.branchId,
        checkpoint.state,
        (selectedBranch ? selectedBranch.cumulativeDecisions : [])
          .concat(Array.isArray((checkpoint.routeRecord || {}).decisions) ? checkpoint.routeRecord.decisions : []),
        checkpoint.exactStateFingerprint,
        "dependency-feedback-step",
      );
      openedChildren.push({ branch: child, checkpoint });
    }
    if (repairSelected && repairTelemetry.attempts.length > 0) {
      const entry = repairTelemetry.attempts[repairTelemetry.attempts.length - 1];
      entry.childBranchIds = openedChildren.map((child) => child.branch.branchId);
    }
    const accepted = terminalEntry
      ? openedChildren.find((entry) => entry.checkpoint === terminalEntry.checkpoint)
      : openedChildren[0] || null;

    if (selectedBranch && nextCheckpoints.length === 0) {
      if (nextExecution && nextExecution.outcome.budgetExhausted === true) {
        selectedBranch.status = "open";
      } else if (nextExecution == null) {
        selectedBranch.status = "open";
      } else {
        selectedBranch.status = "exhausted";
        selectedBranch.exhaustedReason = nextExecution.outcome.reason || "local-execution-produced-no-checkpoint";
      }
    }

    // PR-5.27c: preferred child cohort update for commitment.
    // If local execution successfully opened new children, commit to this cohort
    // on the next round. If no children were opened, clear preferred cohort so
    // the next round falls back to global historical open branches.
    if (commitSuccessfulLineage) {
      if (openedChildren.length > 0) {
        preferredCohortBranchIds = new Set(openedChildren.map((entry) => entry.branch.branchId));
      } else {
        preferredCohortBranchIds.clear();
      }
    }

    // PR-5.27f Phase 0B: SAME-PREREQUISITE CONVERSION CHECK.
    //
    // The claim under test is
    //   before: battle X (specific node/floor/coordinate) = unbeatable | lethal
    //   repair
    //   after : THE SAME battle X = viable-at-current-state
    // A replan that merely surfaces SOME viable prerequisite is not that claim,
    // so conversion is now attributed per prerequisite IDENTITY, and a blocked
    // battle that is absent from the replan reports
    // `NOT_PRESENT_IN_REPLANNED_ALTERNATIVES` rather than counting as converted.
    if (repairSelected && openedChildren.length > 0) {
      for (const child of openedChildren.slice(0, 1)) {
        let afterEvaluation = null;
        try {
          afterEvaluation = evaluateCheckpoint(
            project,
            terminalGoal,
            {
              id: child.branch.branchId,
              roles: [`branch-depth-${child.branch.depth}`],
              exactStateFingerprint: child.branch.exactStateFingerprint,
              state: child.branch.state,
            },
            {
              ...contextOptions,
              excludedExperimentKeys: attemptedExperimentKeys,
              contextBuilder: buildContext,
            },
          );
        } catch {
          afterEvaluation = null;
        }
        const replanned = collectReplannedPrerequisiteStatuses(afterEvaluation);
        const blockedBefore = (selection.blockedPrerequisites || []).length > 0
          ? (selection.blockedPrerequisites || [])
          : (selection.blockedPrerequisiteIds || []).map((identity) => ({
            identity,
            sourceNodeId: identity,
            floorId: null,
            x: null,
            y: null,
            statusBefore: null,
          }));
        const identityConversions = blockedBefore.map((blocked) => {
          const identity = blocked.identity || prerequisiteIdentityOf(blocked);
          const afterStatus = identity && replanned.has(identity)
            ? replanned.get(identity)
            : "NOT_PRESENT_IN_REPLANNED_ALTERNATIVES";
          const beforeStatus = blocked.statusBefore || null;
          const converted = RESOURCE_REPAIR_TRIGGER_STATUSES.has(beforeStatus)
            && afterStatus === "viable-at-current-state";
          return {
            blockedPrerequisiteId: identity,
            sourceNodeId: blocked.sourceNodeId || null,
            floorId: blocked.floorId || null,
            x: blocked.x == null ? null : blocked.x,
            y: blocked.y == null ? null : blocked.y,
            beforeStatus,
            afterStatus,
            sameIdentity: true,
            converted,
          };
        });
        // `convertedToViable` (broad) is retained only for backward comparison
        // with 5.27e; the causal counter is `exactSamePrerequisiteConversions`.
        const broadConverted = Array.from(replanned.values())
          .some((status) => status === "viable-at-current-state");
        const anyExact = identityConversions.some((entry) => entry.converted);
        repairTelemetry.conversions.push({
          round: roundIndex,
          originBranchId: selectedBranch ? selectedBranch.branchId : null,
          childBranchId: child.branch.branchId,
          intentId: selection.alternative.alternativeId,
          repairKind: selection.repairKind || null,
          blockedStatusesBefore: (selection.blockedStatuses || []).slice(),
          blockedPrerequisiteIds: identityConversions.map((entry) => entry.blockedPrerequisiteId),
          identityConversions,
          replannedPrerequisiteCount: replanned.size,
          statusesAfter: Array.from(new Set(replanned.values())),
          converted: anyExact,
          convertedBroad: broadConverted,
        });
        if (anyExact) repairTelemetry.exactSamePrerequisiteConversions += 1;
        if (broadConverted) repairTelemetry.convertedToViable += 1;
      }
    }

    let roundVerdict;
    let selectedBranchParentIsPreviousRound = null;
    let backtrackedToOlderBranch = false;
    if (terminalEntry) {
      roundVerdict = "TERMINAL_GOAL_REACHED";
      frontierState = accepted.branch.state;
      frontierStateKey = accepted.branch.exactStateFingerprint;
      frontierOrigin = `round-${roundIndex}-terminal-checkpoint`;
      reachedTerminal = true;
      terminationReason = "terminal-goal-reached";
      terminationClass = "TERMINAL_GOAL_REACHED";
      terminalBranchId = accepted.branch.branchId;
    } else if (!selection) {
      // Distinguish "nothing in the current portfolio can advance" from "nothing
      // anywhere in the search tree can advance". The former is a property of the
      // attempted set at this moment; only the latter is exhaustion.
      const viable = feedback.evaluations.filter((entry) => entry.canAdvance === true);
      const openCount = openBranches().length;
      roundVerdict = "CURRENT_PORTFOLIO_BLOCKED";
      if (openCount === 0) {
        terminationReason = "global-portfolio-exhausted";
        terminationClass = "GLOBAL_PORTFOLIO_EXHAUSTED";
      } else if (viable.length > 0) {
        terminationReason = "no-unattempted-executable-experiment";
        terminationClass = "GLOBAL_PORTFOLIO_EXHAUSTED";
      } else {
        terminationReason = "all-open-branches-currently-blocked";
        terminationClass = "CURRENT_BRANCH_BLOCKED";
      }
    } else if (nextExecution == null) {
      roundVerdict = "LOCAL_EXECUTION_NOT_RUN";
    } else if (nextCheckpoints.length === 0) {
      roundVerdict = "LOCAL_EXECUTION_PRODUCED_NO_CHECKPOINT";
    } else {
      roundVerdict = "ADVANCED_TO_NEW_CHECKPOINT_STATE";
      frontierState = accepted.branch.state;
      frontierStateKey = accepted.branch.exactStateFingerprint;
      frontierOrigin = `round-${roundIndex}-checkpoint:${accepted.checkpoint.id}`;
      if (selectedBranch) {
        // Backtracking = the branch we advanced from was NOT the branch the
        // immediately preceding round advanced into. That is the observable
        // difference between "switched alternative" and "returned to an older
        // state".
        selectedBranchParentIsPreviousRound = previousStepRound
          ? selectedBranch.branchId === previousStepRound.acceptedBranchId
          : selectedBranch.branchId === rootBranch.branchId;
        backtrackedToOlderBranch = selectedBranchParentIsPreviousRound === false;
      }
    }

    const selectedEvaluation = selection
      ? feedback.evaluations.find((entry) => entry.checkpointId === selection.checkpointId)
      : null;
    rounds.push({
      round: roundIndex,
      kind: "dependency-feedback-step",
      origin: frontierOrigin,
      feedbackVerdict: feedback.verdict,
      feedbackClass: selectedEvaluation ? selectedEvaluation.feedbackClass : null,
      portfolioSize: portfolio.length,
      selected: selection ? {
        branchId: selectedBranch ? selectedBranch.branchId : null,
        checkpointId: selection.checkpointId,
        alternativeId: selection.alternative.alternativeId,
        prerequisiteId: selection.alternative.leadingPrerequisiteId,
        experimentKey: selection.experimentKey,
        changedCheckpoint: selection.changedCheckpoint,
        changedAlternative: selection.changedAlternative,
      } : null,
      experimentKeyReused,
      localOutcome,
      outcome: nextExecution ? {
        goalFound: nextExecution.outcome.goalFound,
        expansions: nextExpansions,
        budgetExhausted: nextExecution.outcome.budgetExhausted,
        reason: nextExecution.outcome.reason || null,
      } : null,
      checkpointCount: nextCheckpoints.length,
      checkpointDiversity: nextExecution ? nextExecution.checkpointDiversity : null,
      acceptedCheckpointId: accepted ? accepted.checkpoint.id : null,
      acceptedBranchId: accepted ? accepted.branch.branchId : null,
      acceptedStateFingerprint: accepted ? accepted.branch.exactStateFingerprint : null,
      acceptedCheckpointLabel: accepted
        ? `${accepted.branch.branchId}:${accepted.checkpoint.id}` : null,
      acceptedStrictReplay: accepted ? accepted.checkpoint.replay.valid === true : null,
      openedBranchIds: openedChildren.map((entry) => entry.branch.branchId),
      selectedBranchParentIsPreviousRound,
      backtrackedToOlderBranch,
      verdict: roundVerdict,
    });
  }

  // PR-5.27d Phase 0: EXACT FINAL BRANCH LIFECYCLE SWEEP.
  // The per-round `lastEvaluationMap` only ever contains the most recent portfolio
  // pass, so an open branch that was not re-evaluated in the final round would
  // otherwise be counted as advanceable by default. That made
  // `advanceableBranchCount` an UPPER BOUND rather than a measurement. Here every
  // remaining open branch is evaluated once against the final
  // `attemptedExperimentKeys`, purely as observation: no local execution, no
  // selection, no route change. Branches that prove unadvanceable are collapsed
  // under the same monotonic rule used during the loop.
  const finalSweep = {
    evaluated: 0,
    newlyExhausted: [],
    advanceable: [],
    records: [],
  };
  {
    const finalBranches = openBranches();
    // PR-5.27f Phase 0A: the final sweep must also ask the EFFECTIVE universe.
    // Otherwise a branch whose normal alternatives are all blocked but which
    // still has a live repair experiment is wrongly collapsed and reported as
    // exhausted, understating `advanceableBranchCount`.
    const finalEvaluations = finalBranches.map((branch) => evaluateBranchExperiments(
      project,
      terminalGoal,
      {
        id: branch.branchId,
        roles: branch.parentBranchId ? [`branch-depth-${branch.depth}`] : ["root-branch"],
        exactStateFingerprint: branch.exactStateFingerprint,
        state: branch.state,
      },
      {
        ...contextOptions,
        excludedExperimentKeys: attemptedExperimentKeys,
        contextBuilder: buildContext,
        failureConditionedResourceRepair,
        battleRelevantRepairOnly,
        candidateLimit,
        simulatorProvider: () => (typeof config.simulatorFactory === "function"
          ? config.simulatorFactory()
          : makeBlindSimulator(project)),
      },
    ));
    lastEvaluationMap.clear();
    finalSweep.evaluated = finalEvaluations.length;
    for (const evaluation of finalEvaluations) {
      const branch = branches.get(evaluation.checkpointId);
      lastEvaluationMap.set(evaluation.checkpointId, evaluation);
      // PR-5.27e P2: collapse first, then record, so a branch that is newly
      // exhausted by this sweep reports its POST-collapse status/reason in the
      // diagnostic dump instead of the stale pre-collapse `open` / null pair.
      let newlyExhaustedHere = false;
      if (!evaluation.effectiveCanAdvance && branch && branch.status !== "exhausted") {
        branch.status = "exhausted";
        branch.exhaustedReason = evaluation.feedbackClass;
        branch.lastEvaluationAlternatives = evaluation.alternatives;
        finalSweep.newlyExhausted.push(evaluation.checkpointId);
        newlyExhaustedHere = true;
      }
      finalSweep.records.push({
        branchId: evaluation.checkpointId,
        depth: branch ? branch.depth : null,
        status: branch ? branch.status : null,
        exhaustedReason: branch ? branch.exhaustedReason : null,
        newlyExhaustedByFinalSweep: newlyExhaustedHere,
        floorId: branch && branch.state ? branch.state.floorId || null : null,
        canAdvance: evaluation.effectiveCanAdvance,
        feedbackClass: evaluation.effectiveFeedbackClass,
        normalCanAdvance: evaluation.normalCanAdvance,
        normalFeedbackClass: evaluation.normalFeedbackClass,
        repairExperimentCount: evaluation.repairExperimentCount,
        alternatives: evaluation.alternatives,
      });
      if (evaluation.effectiveCanAdvance) {
        finalSweep.advanceable.push(evaluation.checkpointId);
      }
    }
  }

  // Attribution for branches that were already collapsed DURING the loop: their
  // state is immutable, so the evaluation recorded at the moment of collapse is
  // still the correct attribution. Phase 1 needs these, because the deepest
  // branches are precisely the ones exhausted mid-loop rather than at the end.
  for (const branch of branches.values()) {
    if (branch.status !== "exhausted") continue;
    if (finalSweep.records.some((entry) => entry.branchId === branch.branchId)) continue;
    const alternativeSummary = branch.lastEvaluationAlternatives || null;
    if (!alternativeSummary) continue;
    finalSweep.records.push({
      branchId: branch.branchId,
      depth: branch.depth,
      status: branch.status,
      exhaustedReason: branch.exhaustedReason,
      floorId: branch.state ? branch.state.floorId || null : null,
      canAdvance: false,
      feedbackClass: branch.exhaustedReason,
      alternatives: alternativeSummary,
    });
  }

  const completedAt = Date.now();
  if (!reachedTerminal && terminationReason == null) {
    if (remainingGlobalBudget() <= 0) {
      terminationReason = "global-local-expansion-budget-exhausted";
      terminationClass = "LOCAL_BUDGET_LIMITED";
    } else {
      terminationReason = "global-round-budget-exhausted";
      terminationClass = "ROUND_BUDGET_LIMITED";
    }
  }

  const stepRounds = rounds.filter((round) => round.kind === "dependency-feedback-step");
  const acceptedRounds = stepRounds.filter((round) => round.acceptedBranchId != null);
  const roundStrictReplay = acceptedRounds.every((round) => round.acceptedStrictReplay === true);

  // The returned route is the terminal branch's ACCUMULATED decisions, i.e. every
  // local segment from the original initial state, not just the last one. Each
  // checkpoint's own routeRecord is an increment relative to its local execution.
  const terminalBranch = terminalBranchId ? branches.get(terminalBranchId) : null;
  const route = reachedTerminal && terminalBranch ? terminalBranch.cumulativeDecisions.slice() : null;

  // PR-5.27c P1: True end-to-end full route strict replay verification from original initial state.
  // We do not rely only on per-segment flags or stitched route summaries; we run
  // verifyStrictReplay(simulator, routeSummaries, { initialState, isGoalState })
  // whenever a route is produced and simulatorFactory (or blind simulator) is available.
  let fullRouteStrictReplay = null;
  if (reachedTerminal && Array.isArray(route) && route.length > 0) {
    try {
      let replaySim = null;
      if (typeof config.simulatorFactory === "function") {
        replaySim = config.simulatorFactory();
      } else if (project && project.floorsById && Object.keys(project.floorsById).length > 0) {
        replaySim = makeBlindSimulator(project);
      }
      if (replaySim && typeof replaySim.enumeratePrimitiveActions === "function" && typeof replaySim.applyAction === "function") {
        const summaries = route.map((d) => d && (d.summary || d.kind));
        fullRouteStrictReplay = verifyStrictReplay(replaySim, summaries, {
          initialState,
          isGoalState: (s) => terminalGoalReached(project, s, terminalGoal),
        });
      }
    } catch (error) {
      fullRouteStrictReplay = { ok: false, reason: `full-route-replay-exception: ${error.message}` };
    }
  }

  // Telemetry: EXACT final lifecycle counts. `advanceableBranchCount` is now a
  // measurement, not an upper bound, because the final sweep above evaluated
  // every remaining open branch against the final attempted-experiment set.
  const allBranchesList = Array.from(branches.values());
  const uniqueExactStateCount = new Set(allBranchesList.map((b) => b.exactStateFingerprint)).size;
  const openBranchesList = openBranches();
  const advanceableBranchCount = openBranchesList.filter((b) => {
    const ev = lastEvaluationMap.get(b.branchId);
    return ev && ev.canAdvance === true;
  }).length;

  return {
    schema: SCHEMA,
    loop: "runDependencyFeedbackLoop",
    inputContract: {
      inputs: ["tower-project", "route-free-initial-state", "one-terminal-goal", "global-budgets"],
      forbidden: [
        "route-fixture", "route-prefix", "authored-milestone", "authored-event-order",
        "authored-resource-threshold", "authored-floor-decomposition",
      ],
      knownRouteUsed: false,
      authoredMilestoneUsed: false,
      authoredEventOrderUsed: false,
      authoredResourceThresholdUsed: false,
    },
    controls: {
      maxRounds,
      maxTotalLocalExpansions,
      localMaxExpansions,
      candidateLimit,
      commitSuccessfulLineage,
      failureConditionedResourceRepair,
      battleRelevantRepairOnly,
      maxRuntimeMs: 0,
      towerId: config.towerId || null,
    },
    globalState: {
      roundCount: stepRounds.length,
      totalLocalExpansions,
      totalLocalExpansionsWithinBudget: totalLocalExpansions <= maxTotalLocalExpansions,
      attemptedExperimentKeyCount: attemptedExperimentKeys.size,
      attemptedExperimentKeys: Array.from(attemptedExperimentKeys).sort(),
      visitedExactCheckpointStateCount: visitedExactCheckpointStates.size,
      visitedExactCheckpointStates: Array.from(visitedExactCheckpointStates).sort(),
      uniqueExactStateCount,
      experimentKeyReuseCount: rounds.filter((round) => round.experimentKeyReused === true).length,
      branchCount: branches.size,
      openBranchCount: openBranchesList.length,
      advanceableBranchCount,
      resourceRepair: {
        enabled: failureConditionedResourceRepair,
        generated: repairTelemetry.generated,
        selected: repairTelemetry.selected,
        checkpointsCreated: repairTelemetry.checkpointsCreated,
        convertedToViable: repairTelemetry.convertedToViable,
        exactSamePrerequisiteConversions: repairTelemetry.exactSamePrerequisiteConversions,
        rejectedByRelevance: repairTelemetry.rejectedByRelevance,
        rejectedIntentKinds: { ...repairTelemetry.rejectedIntentKinds },
        blockedStatusesSeen: { ...repairTelemetry.blockedStatusesSeen },
      },
      resourceRepairAttempts: repairTelemetry.attempts,
      resourceRepairConversions: repairTelemetry.conversions,
      finalBranchLifecycleSweep: {
        evaluatedOpenBranchCount: finalSweep.evaluated,
        advanceableBranchIds: finalSweep.advanceable.slice(),
        newlyExhaustedBranchIds: finalSweep.newlyExhausted.slice(),
      },
      // PR-5.27d Phase 1 (opt-in, observation only): when the caller asks for it,
      // expose the final evaluation of each branch - including each alternative's
      // leading-prerequisite evidence - so a probe can attribute WHY the branch is
      // blocked instead of inferring it. Omitted by default.
      finalEvaluationDump: config.includeFinalEvaluations === true
        ? finalSweep.records.map((entry) => ({
          branchId: entry.branchId,
          depth: entry.depth,
          status: entry.status,
          exhaustedReason: entry.exhaustedReason,
          floorId: entry.floorId,
          canAdvance: entry.canAdvance,
          feedbackClass: entry.feedbackClass,
          alternatives: entry.alternatives,
        }))
        : null,
      exhaustedBranchCount: allBranchesList
        .filter((branch) => branch.status === "exhausted").length,
      backtrackCount: stepRounds.filter((round) => round.backtrackedToOlderBranch === true).length,
      branchIds: Array.from(branches.keys()),
    },
    branches: allBranchesList.map((branch) => ({
      branchId: branch.branchId,
      parentBranchId: branch.parentBranchId,
      exactStateFingerprint: branch.exactStateFingerprint,
      floorId: (branch.state || {}).floorId || null,
      depth: branch.depth,
      status: branch.status,
      exhaustedReason: branch.exhaustedReason,
      cumulativeDecisionCount: branch.cumulativeDecisions.length,
      attemptCount: branch.attemptCount,
      openedByRound: branch.openedByRound,
      openedVia: branch.openedVia,
    })),
    attempts,
    terminal: {
      goal: terminalGoal,
      goalType: terminalGoal.type,
      reached: reachedTerminal,
      reachedByRound: reachedTerminal
        ? (rounds.filter((round) => round.verdict === "TERMINAL_GOAL_REACHED").slice(-1)[0] || {}).round ?? 0
        : null,
      terminalBranchId,
      terminationReason,
      terminationClass,
      finalStateFingerprint: reachedTerminal && terminalBranch
        ? terminalBranch.exactStateFingerprint
        : frontierStateKey,
      finalFloorId: reachedTerminal
        ? (terminalBranch && terminalBranch.state ? terminalBranch.state.floorId || null : null)
        : (frontierState ? frontierState.floorId || null : null),
      frontierOrigin,
    },
    route,
    routeProvenance: reachedTerminal ? {
      startsAtOriginalInitialState: true,
      localSegmentCount: acceptedRounds.length,
      cumulativeDecisionCount: terminalBranch ? terminalBranch.cumulativeDecisions.length : 0,
      fullRouteStrictReplayValid: fullRouteStrictReplay ? fullRouteStrictReplay.ok === true : null,
      fullRouteStrictReplayReason: fullRouteStrictReplay ? (fullRouteStrictReplay.reason || null) : null,
    } : null,
    allAcceptedCheckpointsStrictReplay: roundStrictReplay,
    fullRouteStrictReplay,
    acceptedCheckpoints: acceptedRounds.map((round) => round.acceptedCheckpointLabel),
    rounds,
    timing: { totalWallMs: completedAt - startedAt },
    verdict: reachedTerminal
      ? (roundStrictReplay && fullRouteStrictReplay && fullRouteStrictReplay.ok === true
        ? "DEPENDENCY_FEEDBACK_LOOP_REACHED_TERMINAL_WITH_STRICT_REPLAY"
        : "DEPENDENCY_FEEDBACK_LOOP_REACHED_TERMINAL_REPLAY_UNVERIFIED")
      : "DEPENDENCY_FEEDBACK_LOOP_UNKNOWN_UNDER_THIS_BUDGET",
  };
}

module.exports = {
  SCHEMA,
  buildDependencyContext,
  evaluateCheckpoint,
  evaluateBranchExperiments,
  evaluateResourceRepairTrigger,
  isBattleRelevantRepairIntent,
  prerequisiteIdentityOf,
  normalizePrerequisiteIdentity,
  collectReplannedPrerequisiteStatuses,
  runDependencyFeedback,
  runDependencyFeedbackLoop,
  summarizeAlternative,
  terminalGoalReached,
};
