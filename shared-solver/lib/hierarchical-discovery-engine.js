"use strict";

const {
  battleStatus,
  compileAutomaticBlockerRepairs,
  compileRepairDependencyPlan,
  makeRepairCompilationCache,
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
  const closureClass = execution && execution.repairVerification
    ? execution.repairVerification.closureClass
    : null;
  if (closureClass === "repair-target-not-realized") return closureClass;
  if (!execution || !execution.outcome || !execution.outcome.goalFound) {
    return "local-execution-did-not-produce-checkpoint";
  }
  if ((execution.checkpoints || []).length === 0) {
    return "local-execution-did-not-produce-checkpoint";
  }
  return closureClass === "no-net-improvement"
    ? closureClass
    : null;
}

function portfolioProgress(portfolio) {
  return (portfolio.checkpoints || []).reduce((best, checkpoint) => {
    const hero = ((checkpoint || {}).state || {}).hero || {};
    const candidate = {
      level: number(hero.lv, 0),
      exp: number(hero.exp, 0),
      routeLength: ((((checkpoint || {}).state || {}).route) || []).length,
    };
    if (
      candidate.level > best.level ||
      (candidate.level === best.level && candidate.exp > best.exp) ||
      (candidate.level === best.level && candidate.exp === best.exp &&
        candidate.routeLength > best.routeLength)
    ) return candidate;
    return best;
  }, { level: -Infinity, exp: -Infinity, routeLength: -Infinity });
}

function rankHistoricalPortfolios(history, priorityMode) {
  const ranked = history.slice(0, -1).map((portfolio, index) => ({
    index,
    portfolio,
    progress: portfolioProgress(portfolio),
  }));
  if (priorityMode !== "level-progress-first") return ranked;
  return ranked.sort((left, right) =>
    right.progress.level - left.progress.level ||
    right.progress.exp - left.progress.exp ||
    right.progress.routeLength - left.progress.routeLength ||
    right.index - left.index);
}

function executeLevelProgressSearch(
  project,
  projectRoot,
  portfolio,
  plannerOptions,
  attemptedStates,
) {
  const checkpoints = (portfolio.checkpoints || []).slice().sort((left, right) => {
    const leftProgress = portfolioProgress({ checkpoints: [left] });
    const rightProgress = portfolioProgress({ checkpoints: [right] });
    return rightProgress.level - leftProgress.level ||
      rightProgress.exp - leftProgress.exp ||
      rightProgress.routeLength - leftProgress.routeLength ||
      left.id.localeCompare(right.id);
  });
  for (const checkpoint of checkpoints) {
    const progress = portfolioProgress({ checkpoints: [checkpoint] });
    const targetLevel = progress.level + 1;
    const experimentKey = `${checkpoint.exactStateFingerprint}|level:${targetLevel}`;
    if (attemptedStates.has(experimentKey)) continue;
    attemptedStates.add(experimentKey);
    const sourceNodeId = `automatic-level-threshold:lv${targetLevel}`;
    const plan = {
      alternatives: [{
        id: "automatic-level-progress",
        prerequisites: [{
          id: `execute-${sourceNodeId}`,
          kind: "target",
          relation: "AND",
          order: 0,
          sourceNodeId,
          actionGoal: { type: "heroAtLeast", minHero: { lv: targetLevel } },
          target: {
            floorId: checkpoint.state.floorId,
            role: "automatically-derived-level-threshold",
          },
          evidence: {
            kind: "current-state-level-progress",
            status: "viable-at-current-state",
            reason: "combat-progress-dead-end-requires-composite-exp-chain",
          },
          provenance: "automatic-current-state-next-level-threshold",
        }],
      }],
    };
    const execution = executeLocalDependency(
      project,
      projectRoot,
      checkpoint.state,
      plan,
      {
        maxExpansions: number(plannerOptions.localMaxExpansions, 32),
        candidateLimit: number(plannerOptions.candidateLimit, 8),
      },
    );
    return { checkpoint, progress, targetLevel, experimentKey, execution };
  }
  return null;
}

function historicalFeedback(
  project,
  projectRoot,
  terminalGoal,
  history,
  plannerOptions,
  attempted,
  priorityMode,
) {
  for (const historical of rankHistoricalPortfolios(history, priorityMode)) {
    const feedback = runDependencyFeedback(
      project,
      projectRoot,
      terminalGoal,
      historical.portfolio,
      {
        ...plannerOptions,
        excludedExperimentKeys: attempted,
        preferFirstGoalCheckpoint: true,
      },
    );
    if (feedback.nextExecution) return {
      historyIndex: historical.index,
      historyProgress: historical.progress,
      feedback,
    };
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
    lv: number(right.lv, 0) - number(left.lv, 0),
    money: number(right.money, 0) - number(left.money, 0),
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
  const acquisitionDelta = selected ? selected.acquisitionDelta : null;
  const progressImprovement = Boolean(
    selected &&
    repair.resourceKind === "combat-reward" &&
    (number(acquisitionDelta.lv, 0) > 0 || number(acquisitionDelta.exp, 0) > 0),
  );
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
    progressImprovement,
    closureClass: !selected
      ? "repair-target-not-realized"
      : selected.status === "viable-at-current-state"
        ? "blocker-unblocked"
        : statusRank(selected.status) > statusRank(repair.repairs.beforeStatus) ||
          number(selected.actualMarginGain, 0) > 0
          ? "improved-but-still-blocked"
          : progressImprovement
            ? "progressed-toward-level-threshold"
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
  const attemptedRepairExperiments = new Set();
  const rejectedRepairAcquisitions = new Set();
  const rejectedRepairExperiments = new Set();
  const attemptedLevelProgressStates = new Set();
  const repairCompilationCache = config.reuseRepairCompilationCache === false
    ? null
    : makeRepairCompilationCache();
  let repairPriorityMode = "blocker-first";
  if (portfolio.selected && portfolio.selected.prerequisite) {
    attemptedExperiments.add([
      rootPortfolio.checkpoints[0].exactStateFingerprint,
      portfolio.selected.alternativeId,
      portfolio.selected.prerequisite.sourceNodeId,
    ].join("|"));
  }
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
        excludedRepairExperimentKeys: attemptedRepairExperiments,
        excludedRepairAcquisitionKeys: rejectedRepairAcquisitions,
        compilationCache: repairCompilationCache,
        includeCombatRewardRepairs: config.includeCombatRewardRepairs !== false,
        repairPriorityMode,
        candidateLimit: number(config.repairCandidateLimit, 16),
      },
    );
    if (!repairs.selected) {
      const progressDeadEnd = portfolio.repairVerification &&
        portfolio.repairVerification.progressImprovement === true;
      if (progressDeadEnd) repairPriorityMode = "level-progress-first";
      if (repairPriorityMode === "level-progress-first") {
        const levelProgress = executeLevelProgressSearch(
          project,
          projectRoot,
          portfolio,
          plannerOptions,
          attemptedLevelProgressStates,
        );
        if (levelProgress) {
          const levelReached = levelProgress.execution.outcome.goalFound &&
            (levelProgress.execution.checkpoints || []).some((checkpoint) =>
              number((checkpoint.state.hero || {}).lv, 0) >= levelProgress.targetLevel);
          recordRound(rounds, {
            round,
            kind: levelReached ? "level-progress-search" : "level-progress-search-rejected",
            levelProgressExperimentKey: levelProgress.experimentKey,
            levelProgressInput: levelProgress.progress,
            targetLevel: levelProgress.targetLevel,
            completedPrerequisiteId: selectedPrerequisite(levelProgress.execution),
            outcome: compactOutcome(levelProgress.execution),
          }, config);
          if (levelReached) {
            portfolio = levelProgress.execution;
            history.push(portfolio);
            repairPriorityMode = "blocker-first";
          }
          continue;
        }
      }
      const backtrack = historicalFeedback(
        project,
        projectRoot,
        terminalGoal,
        history,
        plannerOptions,
        attemptedExperiments,
        repairPriorityMode,
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
          historyProgress: backtrack.historyProgress,
          repairCandidateCount: repairs.candidateCount,
          repairCandidateKinds: repairs.candidateKinds,
          candidatesEvaluatedForAccess: repairs.candidatesEvaluatedForAccess,
          repairCompilationCost: repairs.compilationCost,
          repairPriorityMode,
          reviewCandidates: repairs.candidates.slice(0, 8).map((candidate) => ({
            checkpointId: candidate.checkpointId,
            sourceNodeId: candidate.sourceNodeId,
            resourceKind: candidate.resourceKind,
            target: candidate.target,
            repairs: candidate.repairs,
            access: candidate.access || null,
          })),
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
        repairCandidateKinds: repairs.candidateKinds,
        candidatesEvaluatedForAccess: repairs.candidatesEvaluatedForAccess,
        repairCompilationCost: repairs.compilationCost,
        repairPriorityMode,
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
    attemptedRepairExperiments.add(repairs.selected.experimentKey);
    const repairSelectionMode = repairPriorityMode;
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
      if (rejectionReason === "repair-target-not-realized") {
        rejectedRepairAcquisitions.add(repairs.selected.acquisitionExperimentKey);
      }
      recordRound(rounds, {
        round,
        kind: "blocker-repair-rejected",
        rejectionReason,
        repairCandidateCount: repairs.candidateCount,
        repairCandidateKinds: repairs.candidateKinds,
        candidatesEvaluatedForAccess: repairs.candidatesEvaluatedForAccess,
        repairPriorityMode: repairSelectionMode,
        repair: repairs.selected,
        repairClosure: repairExecution.repairClosure || null,
        repairVerification: repairExecution.repairVerification || null,
        repairCompilationCost: repairs.compilationCost,
        outcome: compactOutcome(repairExecution),
        retainedPortfolioFingerprint: checkpointFingerprint(repairInputPortfolio),
      }, config);
      portfolio = repairInputPortfolio;
      continue;
    }
    portfolio = repairExecution;
    const actualDelta = portfolio.repairVerification && portfolio.repairVerification.actual
      ? portfolio.repairVerification.actual.acquisitionDelta
      : null;
    if (
      portfolio.repairVerification &&
      (portfolio.repairVerification.closureClass === "blocker-unblocked" ||
        number((actualDelta || {}).lv, 0) > 0)
    ) repairPriorityMode = "blocker-first";
    history.push(portfolio);
    recordRound(rounds, {
      round,
      kind: "blocker-repair",
      repairCandidateCount: repairs.candidateCount,
      repairCandidateKinds: repairs.candidateKinds,
      candidatesEvaluatedForAccess: repairs.candidatesEvaluatedForAccess,
      repairCompilationCost: repairs.compilationCost,
      repairPriorityMode: repairSelectionMode,
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
      includeCombatRewardRepairs: config.includeCombatRewardRepairs !== false,
      maxRuntimeMs: 0,
    },
    rounds,
    totals,
    stoppedReason: stoppedReason || "max-rounds",
    finalPortfolio: portfolio,
    historyPortfolioCount: history.length,
    attemptedExperimentCount: attemptedExperiments.size,
    attemptedRepairExperimentCount: attemptedRepairExperiments.size,
    rejectedRepairAcquisitionCount: rejectedRepairAcquisitions.size,
    rejectedRepairExperimentCount: rejectedRepairExperiments.size,
    attemptedLevelProgressStateCount: attemptedLevelProgressStates.size,
    repairCompilationCache: repairCompilationCache ? {
      checkpointAnalysisCount: repairCompilationCache.checkpointAnalyses.size,
      accessCount: repairCompilationCache.accessByStateAndResource.size,
    } : null,
    repairPriorityMode,
    verdict: "HIERARCHICAL_DISCOVERY_RUN_RECORDED",
  };
}

module.exports = {
  SCHEMA,
  compactOutcome,
  executeRepair,
  executeLevelProgressSearch,
  portfolioProgress,
  rankHistoricalPortfolios,
  repairRejectionReason,
  runHierarchicalDiscovery,
};
