"use strict";

const { compileAutomaticBlockerRepairs, compileRepairDependencyPlan } = require("./automatic-blocker-repair");
const { buildDependencyContext, runDependencyFeedback } = require("./dependency-feedback-controller");
const { executeLocalDependency, materializeDirectTargetPlan } = require("./local-dependency-executor");

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

function executeRepair(project, projectRoot, terminalGoal, portfolio, repair, options) {
  const checkpoint = (portfolio.checkpoints || []).find((entry) => entry.id === repair.checkpointId);
  if (!checkpoint) throw new Error(`Repair checkpoint not found: ${repair.checkpointId}`);
  const dependency = compileRepairDependencyPlan(project, terminalGoal, checkpoint, repair, options);
  const plan = materializeDirectTargetPlan(dependency.plan, repair);
  return executeLocalDependency(project, projectRoot, checkpoint.state, plan, {
    maxExpansions: number((options || {}).localMaxExpansions, 32),
    candidateLimit: number((options || {}).candidateLimit, 8),
  });
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
  };
  const initialContext = buildDependencyContext(project, initialState, terminalGoal, plannerOptions);
  let portfolio = executeLocalDependency(project, projectRoot, initialState, initialContext.plan, {
    maxExpansions: number(config.initialMaxExpansions, 64),
    candidateLimit: plannerOptions.candidateLimit,
  });
  const rounds = [{
    round: 0,
    kind: "terminal-dependency",
    completedPrerequisiteId: selectedPrerequisite(portfolio),
    outcome: compactOutcome(portfolio),
  }];
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
      portfolio = feedback.nextExecution;
      rounds.push({
        round,
        kind: "terminal-dependency",
        feedbackSelection: feedback.selection,
        completedPrerequisiteId: selectedPrerequisite(portfolio),
        outcome: compactOutcome(portfolio),
      });
      continue;
    }
    const repairs = compileAutomaticBlockerRepairs(
      project,
      terminalGoal,
      portfolio.checkpoints,
      {
        ...plannerOptions,
        excludeTargetNodeId: config.excludeTargetNodeId || null,
        candidateLimit: number(config.repairCandidateLimit, 16),
      },
    );
    if (!repairs.selected) {
      stoppedReason = repairs.verdict;
      rounds.push({
        round,
        kind: "blocked",
        repairCandidateCount: repairs.candidateCount,
        candidatesEvaluatedForAccess: repairs.candidatesEvaluatedForAccess,
        reviewCandidates: repairs.candidates.slice(0, 8).map((candidate) => ({
          checkpointId: candidate.checkpointId,
          sourceNodeId: candidate.sourceNodeId,
          target: candidate.target,
          repairs: candidate.repairs,
          access: candidate.access || null,
        })),
        stoppedReason,
      });
      break;
    }
    const cycleKey = [
      repairs.selected.checkpointId,
      repairs.selected.sourceNodeId,
      checkpointFingerprint(portfolio),
    ].join("|");
    if (seen.has(cycleKey)) {
      stoppedReason = "repair-state-cycle-detected";
      rounds.push({ round, kind: "blocked", stoppedReason, repair: repairs.selected });
      break;
    }
    seen.add(cycleKey);
    portfolio = executeRepair(
      project,
      projectRoot,
      terminalGoal,
      portfolio,
      repairs.selected,
      plannerOptions,
    );
    rounds.push({
      round,
      kind: "blocker-repair",
      repairCandidateCount: repairs.candidateCount,
      candidatesEvaluatedForAccess: repairs.candidatesEvaluatedForAccess,
      repair: repairs.selected,
      completedPrerequisiteId: selectedPrerequisite(portfolio),
      outcome: compactOutcome(portfolio),
    });
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
    verdict: "HIERARCHICAL_DISCOVERY_RUN_RECORDED",
  };
}

module.exports = {
  SCHEMA,
  compactOutcome,
  executeRepair,
  runHierarchicalDiscovery,
};
