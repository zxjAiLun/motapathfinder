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
  // Same test seam as the loop: defaults are the real modules.
  const executor = typeof config.executeLocalDependency === "function"
    ? config.executeLocalDependency
    : executeLocalDependency;
  const contextBuilder = typeof config.buildDependencyContext === "function"
    ? config.buildDependencyContext
    : buildDependencyContext;
  const evaluations = (localExecution.checkpoints || [])
    .map((checkpoint) => evaluateCheckpoint(project, terminalGoal, checkpoint, { ...config, contextBuilder }))
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
  const rounds = [];
  const visitedExactCheckpointStates = new Set();
  const attemptedExperimentKeys = new Set();
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

    const portfolio = buildPortfolio();
    const feedback = runDependencyFeedback(project, projectRoot, terminalGoal, { checkpoints: portfolio }, {
      ...contextOptions,
      excludedExperimentKeys: attemptedExperimentKeys,
      maxExpansions: effectiveLocalBudget(),
      candidateLimit,
      simulatorFactory: config.simulatorFactory,
      // Forward the test seam so a synthetic world can drive the whole stack.
      buildDependencyContext: buildContext,
      executeLocalDependency: executeLocal,
    });
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
    const accepted = terminalEntry
      ? openedChildren.find((entry) => entry.checkpoint === terminalEntry.checkpoint)
      : openedChildren[0] || null;

    // Branch status: only a PROVEN dead end marks a branch exhausted. A branch
    // that merely cannot advance right now stays open, because whether it can
    // advance is a function of the attempted-experiment set, which grows.
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
      roundCount: stepRounds.length,
      totalLocalExpansions,
      totalLocalExpansionsWithinBudget: totalLocalExpansions <= maxTotalLocalExpansions,
      attemptedExperimentKeyCount: attemptedExperimentKeys.size,
      attemptedExperimentKeys: Array.from(attemptedExperimentKeys).sort(),
      visitedExactCheckpointStateCount: visitedExactCheckpointStates.size,
      visitedExactCheckpointStates: Array.from(visitedExactCheckpointStates).sort(),
      experimentKeyReuseCount: rounds.filter((round) => round.experimentKeyReused === true).length,
      branchCount: branches.size,
      openBranchCount: openBranches().length,
      exhaustedBranchCount: Array.from(branches.values())
        .filter((branch) => branch.status === "exhausted").length,
      backtrackCount: stepRounds.filter((round) => round.backtrackedToOlderBranch === true).length,
      branchIds: Array.from(branches.keys()),
    },
    branches: Array.from(branches.values()).map((branch) => ({
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
    } : null,
    allAcceptedCheckpointsStrictReplay: roundStrictReplay,
    acceptedCheckpoints: acceptedRounds.map((round) => round.acceptedCheckpointLabel),
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
