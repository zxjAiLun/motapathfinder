"use strict";

const { compileAutomaticDependencyPlan } = require("./automatic-dependency-planner");
const { compileAutomaticFeasibilitySubgoals } = require("./automatic-feasibility-subgoals");
const { buildAutomaticMacroGraph } = require("./automatic-macro-graph");
const crypto = require("node:crypto");
const { buildStateKey } = require("./state-key");
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

  const attemptedExperimentKeys = new Set();
  const visitedExactCheckpointStates = new Set();
  const rounds = [];
  let totalLocalExpansions = 0;
  let frontierState = initialState;
  let frontierOrigin = "route-free-initial-state";
  let previousExecution = null;

  // Round 0 treats the caller's exact state as a checkpoint portfolio of one, so
  // the very first dependency context is built from the initial state and nothing
  // else. No route, no prefix, no authored subgoal.
  const initialContext = buildDependencyContext(project, initialState, terminalGoal, contextOptions);
  const localExecutionOptions = {
    maxExpansions: localMaxExpansions,
    candidateLimit,
    simulatorFactory: config.simulatorFactory,
  };
  const initialExecution = executeLocalDependency(project, projectRoot, initialState, initialContext.plan, localExecutionOptions);
  totalLocalExpansions += number(initialExecution.outcome.expansions, 0);
  // The initial execution selects a prerequisite too, so its experiment identity
  // must be burned as well. Otherwise round 1 can legitimately re-select the very
  // same (checkpoint state, alternative, prerequisite) triple, which is exactly
  // the duplication this loop exists to prevent.
  if (initialExecution.selected) {
    attemptedExperimentKeys.add([
      stateFingerprintOf(initialState),
      initialExecution.selected.alternativeId,
      (initialExecution.selected.prerequisite || {}).sourceNodeId || "complete",
    ].join("|"));
  }
  for (const checkpoint of initialExecution.checkpoints || []) {
    visitedExactCheckpointStates.add(checkpoint.exactStateFingerprint);
  }
  rounds.push({
    round: 0,
    kind: "initial-local-execution",
    origin: frontierOrigin,
    selected: initialExecution.selected
      ? {
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
    checkpointCount: (initialExecution.checkpoints || []).length,
    checkpointDiversity: initialExecution.checkpointDiversity || null,
    verdict: initialExecution.verdict,
  });
  previousExecution = initialExecution;

  let frontierStateKey = null;
  const initialCheckpoints = initialExecution.checkpoints || [];
  const initialTerminal = initialCheckpoints.find((checkpoint) =>
    terminalGoalReached(project, checkpoint.state, terminalGoal)) || null;

  let terminationReason = null;
  let reachedTerminal = Boolean(initialTerminal);
  if (reachedTerminal) terminationReason = "terminal-goal-reached-in-initial-execution";
  else if (initialCheckpoints.length > 0) {
    frontierState = initialCheckpoints[0].state;
    frontierStateKey = initialCheckpoints[0].exactStateFingerprint;
    frontierOrigin = `initial-checkpoint:${initialCheckpoints[0].id}`;
  } else if (initialExecution.outcome.searchComplete === true) {
    terminationReason = "initial-execution-proved-no-continuation";
  }

  let roundIndex = 0;
  while (!reachedTerminal && terminationReason == null && roundIndex < maxRounds) {
    if (totalLocalExpansions >= maxTotalLocalExpansions) {
      terminationReason = "global-local-expansion-budget-exhausted";
      break;
    }
    roundIndex += 1;

    // One bounded local execution per round: ask the existing single-step
    // controller what the next prerequisite is, given everything we already tried.
    const feedback = runDependencyFeedback(project, projectRoot, terminalGoal, previousExecution, {
      ...contextOptions,
      excludedExperimentKeys: attemptedExperimentKeys,
      maxExpansions: localMaxExpansions,
      candidateLimit,
      simulatorFactory: config.simulatorFactory,
    });
    const selection = feedback.selection;
    const nextExecution = feedback.nextExecution;

    // Deduplication is the loop's own contract, not the controller's: an
    // experimentKey is burned the moment it is selected, whether or not the
    // local execution produced anything.
    let experimentKeyReused = false;
    if (selection && selection.experimentKey) {
      experimentKeyReused = attemptedExperimentKeys.has(selection.experimentKey);
      attemptedExperimentKeys.add(selection.experimentKey);
    }
    const nextCheckpoints = (nextExecution && nextExecution.checkpoints) || [];
    const nextExpansions = nextExecution ? number(nextExecution.outcome.expansions, 0) : 0;
    totalLocalExpansions += nextExpansions;

    const terminal = nextCheckpoints.find((checkpoint) =>
      terminalGoalReached(project, checkpoint.state, terminalGoal)) || null;
    const accepted = terminal || nextCheckpoints[0] || null;
    let stateAlreadyVisited = false;
    if (accepted) {
      stateAlreadyVisited = visitedExactCheckpointStates.has(accepted.exactStateFingerprint);
      visitedExactCheckpointStates.add(accepted.exactStateFingerprint);
    }

    let roundVerdict;
    if (terminal) {
      roundVerdict = "TERMINAL_GOAL_REACHED";
      frontierState = terminal.state;
      frontierStateKey = terminal.exactStateFingerprint;
      frontierOrigin = `round-${roundIndex}-terminal-checkpoint`;
      reachedTerminal = true;
      terminationReason = "terminal-goal-reached";
    } else if (!selection) {
      roundVerdict = "NO_REMAINING_EXPERIMENT";
      terminationReason = "no-remaining-unattempted-alternative";
    } else if (nextExecution == null || nextCheckpoints.length === 0) {
      roundVerdict = "LOCAL_EXECUTION_PRODUCED_NO_CHECKPOINT";
      // The key is consumed and the loop asks again; it advances to a different
      // checkpoint or alternative on the next round rather than retrying this one.
    } else if (stateAlreadyVisited) {
      roundVerdict = "CHECKPOINT_STATE_ALREADY_VISITED";
    } else {
      roundVerdict = "ADVANCED_TO_NEW_CHECKPOINT_STATE";
      frontierState = accepted.state;
      frontierStateKey = accepted.exactStateFingerprint;
      frontierOrigin = `round-${roundIndex}-checkpoint:${accepted.id}`;
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
      selected: selection ? {
        checkpointId: selection.checkpointId,
        alternativeId: selection.alternative.alternativeId,
        prerequisiteId: selection.alternative.leadingPrerequisiteId,
        experimentKey: selection.experimentKey,
        changedCheckpoint: selection.changedCheckpoint,
        changedAlternative: selection.changedAlternative,
      } : null,
      experimentKeyReused,
      outcome: nextExecution ? {
        goalFound: nextExecution.outcome.goalFound,
        expansions: nextExpansions,
        budgetExhausted: nextExecution.outcome.budgetExhausted,
        reason: nextExecution.outcome.reason || null,
      } : null,
      checkpointCount: nextCheckpoints.length,
      checkpointDiversity: nextExecution ? nextExecution.checkpointDiversity : null,
      acceptedCheckpointId: accepted ? accepted.id : null,
      acceptedStateFingerprint: accepted ? accepted.exactStateFingerprint : null,
      acceptedCheckpointLabel: accepted ? `round-${roundIndex}:${accepted.id}` : null,
      acceptedStrictReplay: accepted ? accepted.replay.valid === true : null,
      stateAlreadyVisited,
      verdict: roundVerdict,
    });

    if (nextExecution) previousExecution = nextExecution;
    else break;
  }

  const completedAt = Date.now();
  // A loop that stops without reaching the terminal goal must always say why.
  // The two budgets are distinct and either can be the binding one.
  if (!reachedTerminal && terminationReason == null) {
    terminationReason = totalLocalExpansions >= maxTotalLocalExpansions
      ? "global-local-expansion-budget-exhausted"
      : "global-round-budget-exhausted";
  }
  const acceptedCheckpoints = [];
  const acceptedCheckpointLabels = [];
  for (const round of rounds) {
    if (round.kind !== "dependency-feedback-step" || round.acceptedCheckpointId == null) continue;
    // `executeLocalDependency` numbers checkpoints per local execution, so the
    // same id recurs every round. In a loop the identity that matters is the
    // round-scoped one, otherwise "which checkpoints did we accept" is not
    // answerable and the dedup below degenerates.
    acceptedCheckpoints.push(round.acceptedCheckpointId);
    acceptedCheckpointLabels.push(`round-${round.round}:${round.acceptedCheckpointId}`);
  }
  const roundStrictReplay = rounds
    .filter((round) => round.kind === "dependency-feedback-step" && round.acceptedCheckpointId != null)
    .every((round) => round.acceptedStrictReplay === true);
  const finalExecution = previousExecution;
  const finalCheckpoints = (finalExecution && finalExecution.checkpoints) || [];
  const terminalCheckpoint = finalCheckpoints.find((checkpoint) =>
    terminalGoalReached(project, checkpoint.state, terminalGoal)) || null;
  const route = reachedTerminal
    ? (terminalCheckpoint && terminalCheckpoint.routeRecord
      ? terminalCheckpoint.routeRecord.decisions
      : finalCheckpoints.flatMap((checkpoint) => checkpoint.routeRecord.decisions))
    : null;

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
      maxRuntimeMs: 0,
      towerId: config.towerId || null,
    },
    globalState: {
      roundCount: rounds.filter((round) => round.kind === "dependency-feedback-step").length,
      totalLocalExpansions,
      attemptedExperimentKeyCount: attemptedExperimentKeys.size,
      attemptedExperimentKeys: Array.from(attemptedExperimentKeys).sort(),
      visitedExactCheckpointStateCount: visitedExactCheckpointStates.size,
      visitedExactCheckpointStates: Array.from(visitedExactCheckpointStates).sort(),
      experimentKeyReuseCount: rounds.filter((round) => round.experimentKeyReused === true).length,
      repeatedCheckpointStateCount: rounds.filter((round) => round.stateAlreadyVisited === true).length,
    },
    terminal: {
      goal: terminalGoal,
      goalType: terminalGoal.type,
      reached: reachedTerminal,
      reachedByRound: reachedTerminal
        ? (rounds.filter((round) => round.verdict === "TERMINAL_GOAL_REACHED").slice(-1)[0] || {}).round ?? 0
        : null,
      terminationReason,
      finalStateFingerprint: route != null && terminalCheckpoint
        ? terminalCheckpoint.exactStateFingerprint
        : frontierStateKey,
      finalFloorId: reachedTerminal
        ? ((terminalCheckpoint || {}).floorId || frontierState.floorId || null)
        : (frontierState ? frontierState.floorId || null : null),
      frontierOrigin,
    },
    route,
    routeValid: reachedTerminal ? Boolean(terminalCheckpoint && terminalCheckpoint.replay.valid) : null,
    acceptedCheckpoints,
    acceptedCheckpointLabels,
    allAcceptedCheckpointsStrictReplay: roundStrictReplay,
    rounds,
    timing: { totalWallMs: completedAt - startedAt },
    verdict: reachedTerminal
      ? (roundStrictReplay
        ? "DEPENDENCY_FEEDBACK_LOOP_REACHED_TERMINAL_WITH_STRICT_REPLAY"
        : "DEPENDENCY_FEEDBACK_LOOP_REACHED_TERMINAL_REPLAY_UNVERIFIED")
      : "DEPENDENCY_FEEDBACK_LOOP_UNKNOWN_UNDER_THIS_BUDGET",
  };
}

module.exports = {
  SCHEMA,
  buildDependencyContext,
  evaluateCheckpoint,
  runDependencyFeedback,
  runDependencyFeedbackLoop,
  summarizeAlternative,
  terminalGoalReached,
};
