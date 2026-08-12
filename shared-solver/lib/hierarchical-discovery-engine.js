"use strict";

const {
  battleStatus,
  compileAutomaticBlockerRepairs,
  compileRepairDependencyPlan,
  statusRank,
} = require("./automatic-blocker-repair");
const { makeBlindSimulator } = require("./blind-discovery-baseline");
const { buildDependencyContext, runDependencyFeedback } = require("./dependency-feedback-controller");
const {
  executeLocalDependency,
  materializeDirectTargetPlan,
  selectExecutablePrerequisite,
  stateFingerprint,
} = require("./local-dependency-executor");
const { cloneState, getTileDefinitionAt } = require("./state");

const SCHEMA = "motapathfinder.hierarchical-discovery-run.v1";

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function compactOutcome(execution) {
  return {
    goalFound: Boolean(execution && execution.outcome && execution.outcome.goalFound),
    frontierExhausted: Boolean(execution && execution.outcome && execution.outcome.frontierExhausted),
    budgetExhausted: Boolean(execution && execution.outcome && execution.outcome.budgetExhausted),
    searchComplete: Boolean(execution && execution.outcome && execution.outcome.searchComplete),
    expansions: number(execution && execution.outcome && execution.outcome.expansions, 0),
    generated: number(execution && execution.outcome && execution.outcome.generated, 0),
    accepted: number(execution && execution.outcome && execution.outcome.accepted, 0),
    rejected: number(execution && execution.outcome && execution.outcome.rejected, 0),
    frontierSize: number(execution && execution.outcome && execution.outcome.frontierSize, 0),
    firstGoalExpansion: execution && execution.outcome
      ? execution.outcome.firstGoalExpansion
      : null,
    wallMs: number(execution && execution.outcome && execution.outcome.wallMs, 0),
    timing: execution && execution.outcome && execution.outcome.timing
      ? { ...execution.outcome.timing }
      : null,
    retainedCheckpointCount: (execution && execution.checkpoints || []).length,
    strictReplay: Boolean(
      execution && execution.checkpointDiversity && execution.checkpointDiversity.allStrictReplay,
    ),
  };
}

function checkpointFingerprint(execution) {
  return (execution.checkpoints || [])
    .map((checkpoint) => checkpoint.exactStateFingerprint)
    .sort()
    .join(",");
}

function selectedPrerequisite(execution) {
  return execution && execution.selected && execution.selected.prerequisite
    ? execution.selected.prerequisite.sourceNodeId
    : null;
}

function recordRound(rounds, record, options) {
  rounds.push(record);
  if (typeof (options || {}).onRound === "function") (options || {}).onRound(record);
  return record;
}

function repairRejectionReason(execution) {
  if (!execution || !execution.outcome || !execution.outcome.goalFound) {
    return "local-execution-did-not-produce-checkpoint";
  }
  if ((execution.checkpoints || []).length === 0) {
    return "local-execution-did-not-produce-checkpoint";
  }
  const closureClass = execution.repairVerification
    ? execution.repairVerification.closureClass
    : null;
  return closureClass === "no-net-improvement" || closureClass === "repair-target-not-realized"
    ? closureClass
    : null;
}

function historicalFeedback(project, projectRoot, terminalGoal, history, plannerOptions, attempted) {
  for (let index = 0; index < history.length - 1; index += 1) {
    const feedback = runDependencyFeedback(
      project,
      projectRoot,
      terminalGoal,
      history[index],
      {
        ...plannerOptions,
        excludedExperimentKeys: attempted,
        preferFirstGoalCheckpoint: true,
      },
    );
    if (feedback.nextExecution) return { historyIndex: index, feedback };
  }
  return null;
}

function repairGoalReached(project, state, repair) {
  const goal = (repair || {}).goal || {};
  if (Array.isArray(goal.equipmentIncludes)) {
    const equipped = (((state || {}).hero || {}).equipment) || [];
    return goal.equipmentIncludes.every((itemId) => equipped.includes(itemId));
  }
  if (goal.type === "tileRemoved") {
    return getTileDefinitionAt(project, state, goal.floorId, goal.x, goal.y) == null;
  }
  return false;
}

function addOutcome(total, execution) {
  const outcome = (execution || {}).outcome || {};
  total.expansions += number(outcome.expansions, 0);
  total.generated += number(outcome.generated, 0);
  total.accepted += number(outcome.accepted, 0);
  total.rejected += number(outcome.rejected, 0);
}

function nextRepairStep(project, terminalGoal, execution, repair, options) {
  for (const checkpoint of execution.checkpoints || []) {
    if (repairGoalReached(project, checkpoint.state, repair)) {
      return { complete: true, checkpoint, dependency: null };
    }
  }
  const ordered = (execution.checkpoints || []).slice().sort((left, right) =>
    Number(right.roles.includes("first-goal")) - Number(left.roles.includes("first-goal")) ||
    left.id.localeCompare(right.id));
  for (const checkpoint of ordered) {
    const dependency = compileRepairDependencyPlan(
      project,
      terminalGoal,
      checkpoint,
      repair,
      options,
    );
    const plan = materializeDirectTargetPlan(dependency.plan, repair);
    if (selectExecutablePrerequisite(plan)) {
      return { complete: false, checkpoint, dependency: { ...dependency, plan } };
    }
  }
  return null;
}

function heroDelta(before, after) {
  const left = (before || {}).hero || {};
  const right = (after || {}).hero || {};
  return {
    hp: number(right.hp, 0) - number(left.hp, 0),
    atk: number(right.atk, 0) - number(left.atk, 0),
    def: number(right.def, 0) - number(left.def, 0),
    mdef: number(right.mdef, 0) - number(left.mdef, 0),
    exp: number(right.exp, 0) - number(left.exp, 0),
  };
}

function verifyActualRepair(project, inputCheckpoint, repair, execution) {
  const target = ((repair || {}).repairs || {}).prerequisiteTarget;
  if (!target || !target.floorId || target.x == null || target.y == null) return null;
  const simulator = makeBlindSimulator(project);
  const candidates = (execution.checkpoints || [])
    .filter((checkpoint) => repairGoalReached(project, checkpoint.state, repair))
    .map((checkpoint) => {
      const evaluationState = cloneState(checkpoint.state);
      evaluationState.floorId = target.floorId;
      evaluationState.hero.loc = {
        ...(evaluationState.hero.loc || {}),
        x: target.x,
        y: target.y,
      };
      const evaluation = simulator.battleResolver.evaluateBattle(
        evaluationState,
        target.floorId,
        target.x,
        target.y,
        target.tileId,
      );
      const damage = evaluation.damageInfo && evaluation.damageInfo.damage;
      const status = battleStatus(evaluation, checkpoint.state.hero.hp);
      const margin = damage == null
        ? null
        : number(checkpoint.state.hero.hp, 0) - number(damage, 0);
      const beforeMargin = repair.repairs.beforeSurvivalMargin;
      return {
        checkpointId: checkpoint.id,
        checkpointRoles: checkpoint.roles.slice(),
        status,
        damage: damage == null ? null : number(damage, 0),
        survivalMargin: margin,
        actualMarginGain: beforeMargin == null || margin == null
          ? null
          : margin - number(beforeMargin, 0),
        predictedSurvivalMargin: repair.repairs.survivalMargin,
        predictionError: margin == null || repair.repairs.survivalMargin == null
          ? null
          : margin - number(repair.repairs.survivalMargin, 0),
        acquisitionDelta: heroDelta(inputCheckpoint.state, checkpoint.state),
        incrementalDecisionCount: Math.max(
          0,
          (checkpoint.state.route || []).length - (inputCheckpoint.state.route || []).length,
        ),
      };
    })
    .sort((left, right) =>
      statusRank(right.status) - statusRank(left.status) ||
      number(right.survivalMargin, -Infinity) - number(left.survivalMargin, -Infinity) ||
      left.checkpointId.localeCompare(right.checkpointId));
  const selected = candidates[0] || null;
  return {
    predicted: {
      status: repair.repairs.afterStatus,
      damage: repair.repairs.afterDamage,
      survivalMargin: repair.repairs.survivalMargin,
      marginGain: repair.repairs.survivalMarginGain,
    },
    actual: selected,
    candidateCount: candidates.length,
    netImprovement: Boolean(selected && (
      statusRank(selected.status) > statusRank(repair.repairs.beforeStatus) ||
      number(selected.actualMarginGain, 0) > 0
    )),
    closureClass: !selected
      ? "repair-target-not-realized"
      : selected.status === "viable-at-current-state"
        ? "blocker-unblocked"
        : statusRank(selected.status) > statusRank(repair.repairs.beforeStatus) ||
          number(selected.actualMarginGain, 0) > 0
          ? "improved-but-still-blocked"
          : "no-net-improvement",
  };
}

function executeRepair(project, projectRoot, terminalGoal, portfolio, repair, options) {
  const checkpoint = (portfolio.checkpoints || []).find((entry) => entry.id === repair.checkpointId);
  if (!checkpoint) throw new Error(`Repair checkpoint not found: ${repair.checkpointId}`);
  const trace = [];
  const totals = { expansions: 0, generated: 0, accepted: 0, rejected: 0 };
  let current = { checkpoints: [checkpoint] };
  const maxSteps = Math.max(1, number((options || {}).maxRepairSteps, 12));
  for (let step = 0; step < maxSteps; step += 1) {
    const next = nextRepairStep(project, terminalGoal, current, repair, options);
    if (!next || next.complete) {
      if (next && next.complete) {
        current.repairClosure = {
          complete: true,
          targetId: repair.sourceNodeId,
          steps: trace,
        };
      }
      break;
    }
    const execution = executeLocalDependency(
      project,
      projectRoot,
      next.checkpoint.state,
      next.dependency.plan,
      {
        maxExpansions: number((options || {}).localMaxExpansions, 32),
        candidateLimit: number((options || {}).candidateLimit, 8),
      },
    );
    addOutcome(totals, execution);
    trace.push({
      step,
      fromCheckpointId: next.checkpoint.id,
      completedPrerequisiteId: selectedPrerequisite(execution),
      outcome: compactOutcome(execution),
    });
    current = execution;
    if (!execution.outcome.goalFound || execution.checkpoints.length === 0) break;
  }
  current.outcome = { ...(current.outcome || {}), ...totals };
  current.repairClosure = current.repairClosure || {
    complete: (current.checkpoints || []).some((entry) =>
      repairGoalReached(project, entry.state, repair)),
    targetId: repair.sourceNodeId,
    steps: trace,
  };
  current.repairVerification = verifyActualRepair(project, checkpoint, repair, current);
  return current;
}

function runHierarchicalDiscovery(project, projectRoot, initialState, terminalGoal, options) {
  if (!project || !initialState || !terminalGoal) {
    throw new Error("Hierarchical discovery requires project, initialState, and terminalGoal");
  }
  const config = options || {};
  const plannerOptions = {
    towerId: config.towerId || "automatic",
    maxExpansions: number(config.localMaxExpansions, 32),
    localMaxExpansions: number(config.localMaxExpansions, 32),
    candidateLimit: number(config.candidateLimit, 8),
    preferFirstGoalCheckpoint: config.preferFirstGoalCheckpoint !== false,
    maxRepairSteps: number(config.maxRepairSteps, 12),
  };
  const initialContext = buildDependencyContext(project, initialState, terminalGoal, plannerOptions);
  const rootPortfolio = {
    selected: null,
    checkpoints: [{
      id: "root-checkpoint",
      roles: ["root"],
      exactStateFingerprint: stateFingerprint(initialState),
      state: initialState,
    }],
  };
  let portfolio = executeLocalDependency(project, projectRoot, initialState, initialContext.plan, {
    maxExpansions: number(config.initialMaxExpansions, 64),
    candidateLimit: plannerOptions.candidateLimit,
  });
  const rounds = [];
  recordRound(rounds, {
    round: 0,
    kind: "terminal-dependency",
    completedPrerequisiteId: selectedPrerequisite(portfolio),
    outcome: compactOutcome(portfolio),
  }, config);
  const history = [rootPortfolio, portfolio];
  const attemptedExperiments = new Set();
  const rejectedRepairExperiments = new Set();
  if (portfolio.selected && portfolio.selected.prerequisite) {
    attemptedExperiments.add([
      rootPortfolio.checkpoints[0].exactStateFingerprint,
      portfolio.selected.alternativeId,
      portfolio.selected.prerequisite.sourceNodeId,
    ].join("|"));
  }
  const seen = new Set();
  const maxRounds = Math.max(1, number(config.maxRounds, 16));
  let stoppedReason = null;
  for (let round = 1; round <= maxRounds; round += 1) {
    if (!portfolio.outcome.goalFound || portfolio.checkpoints.length === 0) {
      stoppedReason = "local-execution-did-not-produce-checkpoint";
      break;
    }
    const feedback = runDependencyFeedback(
      project,
      projectRoot,
      terminalGoal,
      portfolio,
      plannerOptions,
    );
    if (feedback.nextExecution) {
      if (feedback.selection && feedback.selection.experimentKey) {
        attemptedExperiments.add(feedback.selection.experimentKey);
      }
      portfolio = feedback.nextExecution;
      history.push(portfolio);
      recordRound(rounds, {
        round,
        kind: "terminal-dependency",
        feedbackSelection: feedback.selection,
        feedbackTiming: feedback.timing,
        completedPrerequisiteId: selectedPrerequisite(portfolio),
        outcome: compactOutcome(portfolio),
      }, config);
      continue;
    }
    const repairs = compileAutomaticBlockerRepairs(
      project,
      terminalGoal,
      portfolio.checkpoints,
      {
        ...plannerOptions,
        excludeTargetNodeId: config.excludeTargetNodeId || null,
        excludedRepairExperimentKeys: rejectedRepairExperiments,
        candidateLimit: number(config.repairCandidateLimit, 16),
      },
    );
    if (!repairs.selected) {
      const backtrack = historicalFeedback(
        project,
        projectRoot,
        terminalGoal,
        history,
        plannerOptions,
        attemptedExperiments,
      );
      if (backtrack) {
        if (backtrack.feedback.selection && backtrack.feedback.selection.experimentKey) {
          attemptedExperiments.add(backtrack.feedback.selection.experimentKey);
        }
        portfolio = backtrack.feedback.nextExecution;
        history.push(portfolio);
        recordRound(rounds, {
          round,
          kind: "historical-backtrack",
          historyIndex: backtrack.historyIndex,
          feedbackSelection: backtrack.feedback.selection,
          feedbackTiming: backtrack.feedback.timing,
          completedPrerequisiteId: selectedPrerequisite(portfolio),
          outcome: compactOutcome(portfolio),
        }, config);
        continue;
      }
      stoppedReason = repairs.verdict;
      recordRound(rounds, {
        round,
        kind: "blocked",
        repairCandidateCount: repairs.candidateCount,
        candidatesEvaluatedForAccess: repairs.candidatesEvaluatedForAccess,
        repairCompilationCost: repairs.compilationCost,
        reviewCandidates: repairs.candidates.slice(0, 8).map((candidate) => ({
          checkpointId: candidate.checkpointId,
          sourceNodeId: candidate.sourceNodeId,
          target: candidate.target,
          repairs: candidate.repairs,
          access: candidate.access || null,
        })),
        stoppedReason,
      }, config);
      break;
    }
    const cycleKey = [
      repairs.selected.checkpointId,
      repairs.selected.sourceNodeId,
      checkpointFingerprint(portfolio),
    ].join("|");
    if (seen.has(cycleKey)) {
      stoppedReason = "repair-state-cycle-detected";
      recordRound(rounds, { round, kind: "blocked", stoppedReason, repair: repairs.selected }, config);
      break;
    }
    seen.add(cycleKey);
    const repairInputPortfolio = portfolio;
    const repairExecution = executeRepair(
      project,
      projectRoot,
      terminalGoal,
      portfolio,
      repairs.selected,
      plannerOptions,
    );
    const rejectionReason = repairRejectionReason(repairExecution);
    if (rejectionReason) {
      rejectedRepairExperiments.add(repairs.selected.experimentKey);
      recordRound(rounds, {
        round,
        kind: "blocker-repair-rejected",
        rejectionReason,
        repairCandidateCount: repairs.candidateCount,
        candidatesEvaluatedForAccess: repairs.candidatesEvaluatedForAccess,
        repair: repairs.selected,
        repairClosure: repairExecution.repairClosure || null,
        repairVerification: repairExecution.repairVerification || null,
        outcome: compactOutcome(repairExecution),
        retainedPortfolioFingerprint: checkpointFingerprint(repairInputPortfolio),
      }, config);
      portfolio = repairInputPortfolio;
      continue;
    }
    portfolio = repairExecution;
    history.push(portfolio);
    recordRound(rounds, {
      round,
      kind: "blocker-repair",
      repairCandidateCount: repairs.candidateCount,
      candidatesEvaluatedForAccess: repairs.candidatesEvaluatedForAccess,
      repairCompilationCost: repairs.compilationCost,
      repair: repairs.selected,
      repairClosure: portfolio.repairClosure || null,
      repairVerification: portfolio.repairVerification || null,
      completedPrerequisiteId: selectedPrerequisite(portfolio),
      outcome: compactOutcome(portfolio),
    }, config);
  }
  if (!stoppedReason && rounds.length > maxRounds) stoppedReason = "max-rounds";
  const totals = rounds.reduce((result, round) => {
    const outcome = round.outcome || {};
    result.expansions += number(outcome.expansions, 0);
    result.generated += number(outcome.generated, 0);
    result.accepted += number(outcome.accepted, 0);
    result.rejected += number(outcome.rejected, 0);
    return result;
  }, { expansions: 0, generated: 0, accepted: 0, rejected: 0 });
  return {
    schema: SCHEMA,
    inputContract: {
      inputs: ["tower-project", "route-free-current-state", "terminal-goal"],
      forbidden: ["route-fixture", "route-prefix", "authored-milestone", "authored-event-order", "authored-resource-threshold"],
      knownRouteUsed: false,
    },
    controls: {
      maxRounds,
      initialMaxExpansions: number(config.initialMaxExpansions, 64),
      localMaxExpansions: plannerOptions.localMaxExpansions,
      candidateLimit: plannerOptions.candidateLimit,
      maxRuntimeMs: 0,
    },
    rounds,
    totals,
    stoppedReason: stoppedReason || "max-rounds",
    finalPortfolio: portfolio,
    historyPortfolioCount: history.length,
    attemptedExperimentCount: attemptedExperiments.size,
    rejectedRepairExperimentCount: rejectedRepairExperiments.size,
    verdict: "HIERARCHICAL_DISCOVERY_RUN_RECORDED",
  };
}

module.exports = {
  SCHEMA,
  compactOutcome,
  executeRepair,
  repairRejectionReason,
  runHierarchicalDiscovery,
};
