"use strict";

const path = require("node:path");

const { makeBlindSimulator, readBlindGoal } = require("./lib/blind-discovery-baseline");
const { runHierarchicalDiscovery } = require("./lib/hierarchical-discovery-engine");
const { loadProject } = require("./lib/project-loader");
const { createMt5EntryState, detachCheckpoint } = require("./qualify-blind-discovery");

const ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");
const GOAL_FILE = path.join(__dirname, "blind-goals", "onlyup-mt5-blueking.json");

function summarizeFinalState(simulator, checkpoint) {
  const state = checkpoint.state;
  const actions = simulator.enumerateActions(state);
  const battles = actions
    .filter((action) => action.kind === "battle")
    .map((action) => ({
      summary: action.summary,
      damage: Number((action.estimate || {}).damage || 0),
      exp: Number((action.estimate || {}).exp || 0),
    }));
  const actionCounts = actions.reduce((counts, action) => {
    counts[action.kind] = Number(counts[action.kind] || 0) + 1;
    return counts;
  }, {});
  return {
    id: checkpoint.id,
    roles: checkpoint.roles,
    hero: checkpoint.hero,
    exactStateFingerprint: checkpoint.exactStateFingerprint,
    routeLength: (state.route || []).length,
    route: (state.route || []).map((entry) => entry.summary),
    nextLevel: simulator.getNextLevelInfo(state),
    actionCounts,
    visibleBattleExp: battles.reduce((sum, battle) => sum + battle.exp, 0),
    lowestDamageBattles: battles
      .slice()
      .sort((left, right) => left.damage - right.damage || right.exp - left.exp)
      .slice(0, 8),
    fightToLevelUp: actions
      .filter((action) => action.kind === "fightToLevelUp")
      .map((action) => ({
        summary: action.summary,
        plan: action.plan,
        estimate: action.estimate,
      })),
  };
}

function main() {
  const project = loadProject(PROJECT_ROOT);
  const simulator = makeBlindSimulator(project);
  const terminalGoal = readBlindGoal(GOAL_FILE).goal;
  const initialState = detachCheckpoint(createMt5EntryState(project));
  const stream = process.env.MOTAPATHFIND_D2_STREAM === "1";
  const streamStartedAt = Date.now();
  let previousEventAt = streamStartedAt;
  const result = runHierarchicalDiscovery(project, PROJECT_ROOT, initialState, terminalGoal, {
    towerId: "onlyup",
    maxRounds: Number(process.env.MOTAPATHFIND_D2_ROUNDS || 12),
    initialMaxExpansions: 64,
    localMaxExpansions: 32,
    candidateLimit: 8,
    repairCandidateLimit: 16,
    excludeTargetNodeId: "MT5:item:11,5:I894",
    reuseRepairCompilationCache: process.env.MOTAPATHFIND_D2_REPAIR_CACHE !== "0",
    includeCombatRewardRepairs: process.env.MOTAPATHFIND_D2_COMBAT_REPAIRS !== "0",
    onRound: stream ? (round) => {
      const now = Date.now();
      process.stdout.write(`${JSON.stringify({
        event: "hierarchical-round",
        round: round.round,
        kind: round.kind,
        elapsedMs: now - streamStartedAt,
        roundWallMs: now - previousEventAt,
        completed: round.completedPrerequisiteId || null,
        repair: round.repair ? round.repair.sourceNodeId : null,
        repairKind: round.repair ? round.repair.resourceKind : null,
        repairCandidateKinds: round.repairCandidateKinds || null,
        repairPriorityMode: round.repairPriorityMode || null,
        targetLevel: round.targetLevel || null,
        levelProgressInput: round.levelProgressInput || null,
        levelProgressPotential: round.levelProgressPotential || null,
        levelProgressOutput: round.levelProgressOutput || null,
        progressAdvanced: round.progressAdvanced === true,
        topRepairReview: round.reviewCandidates && round.reviewCandidates[0]
          ? {
            sourceNodeId: round.reviewCandidates[0].sourceNodeId,
            resourceKind: round.reviewCandidates[0].resourceKind,
            access: round.reviewCandidates[0].access,
          }
          : null,
        rejectionReason: round.rejectionReason || null,
        predictedMargin: round.repairVerification
          ? round.repairVerification.predicted.survivalMargin
          : null,
        actualMargin: round.repairVerification && round.repairVerification.actual
          ? round.repairVerification.actual.survivalMargin
          : null,
        closureClass: round.repairVerification
          ? round.repairVerification.closureClass
          : null,
        actualDelta: round.repairVerification && round.repairVerification.actual
          ? round.repairVerification.actual.acquisitionDelta
          : null,
        expansions: round.outcome ? round.outcome.expansions : 0,
        phaseTiming: round.outcome ? round.outcome.timing : null,
        feedbackTiming: round.feedbackTiming || null,
        repairCompilationCost: round.repairCompilationCost || null,
        goalFound: round.outcome ? round.outcome.goalFound : null,
      })}\n`);
      previousEventAt = now;
    } : null,
  });
  if (process.env.MOTAPATHFIND_D2_REPAIR_AUDIT === "1") {
    const repairRounds = result.rounds
      .filter((round) => round.repair)
      .map((round) => ({
        round: round.round,
        kind: round.kind,
        repair: round.repair.sourceNodeId,
        resourceKind: round.repair.resourceKind,
        repairPriorityMode: round.repairPriorityMode || null,
        acquisitionExperimentKey: round.repair.acquisitionExperimentKey,
        experimentKey: round.repair.experimentKey,
        rejectionReason: round.rejectionReason || null,
        predictedMargin: round.repairVerification
          ? round.repairVerification.predicted.survivalMargin
          : null,
        actualMargin: round.repairVerification && round.repairVerification.actual
          ? round.repairVerification.actual.survivalMargin
          : null,
        closureClass: round.repairVerification
          ? round.repairVerification.closureClass
          : null,
        progressImprovement: round.repairVerification
          ? round.repairVerification.progressImprovement
          : false,
        actualDelta: round.repairVerification && round.repairVerification.actual
          ? round.repairVerification.actual.acquisitionDelta
          : null,
      }));
    const experimentCounts = repairRounds.reduce((counts, round) => {
      counts[round.experimentKey] = Number(counts[round.experimentKey] || 0) + 1;
      return counts;
    }, {});
    const repairCompilationTotals = result.rounds.reduce((totals, round) => {
      const cost = round.repairCompilationCost || {};
      for (const field of [
        "graphBuildCount",
        "graphReuseCount",
        "checkpointAnalysisCacheHits",
        "accessCacheHits",
        "uniqueAccessProbeCount",
        "wallMs",
      ]) totals[field] += Number(cost[field] || 0);
      return totals;
    }, {
      graphBuildCount: 0,
      graphReuseCount: 0,
      checkpointAnalysisCacheHits: 0,
      accessCacheHits: 0,
      uniqueAccessProbeCount: 0,
      wallMs: 0,
    });
    const levelProgressRounds = result.rounds
      .filter((round) => round.kind.includes("level-progress-search"))
      .map((round) => ({
        round: round.round,
        kind: round.kind,
        experimentKey: round.levelProgressExperimentKey,
        input: round.levelProgressInput,
        potential: round.levelProgressPotential || null,
        output: round.levelProgressOutput || null,
        progressAdvanced: round.progressAdvanced === true,
        historyIndex: round.historyIndex,
        historyProgress: round.historyProgress || null,
        targetLevel: round.targetLevel,
        outcome: round.outcome,
      }));
    process.stdout.write(`${JSON.stringify({
      rounds: result.rounds.length,
      repairRounds,
      levelProgressRounds,
      repeatedSemanticExperiments: Object.entries(experimentCounts)
        .filter((entry) => entry[1] > 1)
        .map(([experimentKey, count]) => ({ experimentKey, count })),
      blockerUnblockedCount: repairRounds
        .filter((round) => round.closureClass === "blocker-unblocked").length,
      totals: result.totals,
      stoppedReason: result.stoppedReason,
      attemptedRepairExperimentCount: result.attemptedRepairExperimentCount,
      rejectedRepairAcquisitionCount: result.rejectedRepairAcquisitionCount,
      rejectedRepairExperimentCount: result.rejectedRepairExperimentCount,
      attemptedLevelProgressStateCount: result.attemptedLevelProgressStateCount,
      historicalLevelProgressProbeCount: result.historicalLevelProgressProbeCount,
      repairCompilationTotals,
      repairCompilationCache: result.repairCompilationCache,
      repairPriorityMode: result.repairPriorityMode,
      finalFrontier: result.finalPortfolio.checkpoints.map((checkpoint) => ({
        id: checkpoint.id,
        roles: checkpoint.roles,
        hero: checkpoint.hero,
        routeLength: (checkpoint.state.route || []).length,
        lastDecisions: (checkpoint.state.route || []).slice(-6).map((entry) => entry.summary),
      })),
    }, null, 2)}\n`);
    return;
  }
  if (process.env.MOTAPATHFIND_D2_SUMMARY === "1") {
    process.stdout.write(`${JSON.stringify({
      rounds: result.rounds.map((round) => ({
        round: round.round,
        kind: round.kind,
        completed: round.completedPrerequisiteId || null,
        repair: round.repair ? round.repair.sourceNodeId : null,
        predictedMargin: round.repairVerification
          ? round.repairVerification.predicted.survivalMargin
          : null,
        actualMargin: round.repairVerification && round.repairVerification.actual
          ? round.repairVerification.actual.survivalMargin
          : null,
        closureClass: round.repairVerification
          ? round.repairVerification.closureClass
          : null,
        expansions: round.outcome ? round.outcome.expansions : 0,
        goalFound: round.outcome ? round.outcome.goalFound : null,
        selectedAlternative: round.feedbackSelection
          ? round.feedbackSelection.alternative.alternativeId
          : null,
        selectedRoles: round.feedbackSelection ? round.feedbackSelection.roles : null,
      })),
      totals: result.totals,
      stoppedReason: result.stoppedReason,
      historyPortfolioCount: result.historyPortfolioCount,
      attemptedExperimentCount: result.attemptedExperimentCount,
      attemptedRepairExperimentCount: result.attemptedRepairExperimentCount,
      rejectedRepairAcquisitionCount: result.rejectedRepairAcquisitionCount,
      rejectedRepairExperimentCount: result.rejectedRepairExperimentCount,
      final: result.finalPortfolio.checkpoints.map((checkpoint) => ({
        id: checkpoint.id,
        roles: checkpoint.roles,
        hero: checkpoint.hero,
        routeLength: (checkpoint.state.route || []).length,
        lastDecisions: (checkpoint.state.route || []).slice(-6).map((entry) => entry.summary),
      })),
    }, null, 2)}\n`);
    return;
  }
  if (process.env.MOTAPATHFIND_D2_COMPACT === "1") {
    process.stdout.write(`${JSON.stringify({
      controls: result.controls,
      rounds: result.rounds.map((round) => ({
        round: round.round,
        kind: round.kind,
        completedPrerequisiteId: round.completedPrerequisiteId || null,
        selectedCheckpointId: round.feedbackSelection
          ? round.feedbackSelection.checkpointId
          : null,
        selectedRoles: round.feedbackSelection
          ? round.feedbackSelection.roles
          : null,
        selectedAlternative: round.feedbackSelection
          ? round.feedbackSelection.alternative
          : null,
        repair: round.repair ? {
          checkpointId: round.repair.checkpointId,
          checkpointRoles: round.repair.checkpointRoles,
          sourceNodeId: round.repair.sourceNodeId,
          target: round.repair.target,
          repairs: round.repair.repairs,
        } : null,
        repairClosure: round.repairClosure || null,
        repairVerification: round.repairVerification || null,
        repairCompilationCost: round.repairCompilationCost || null,
        outcome: round.outcome || null,
        stoppedReason: round.stoppedReason || null,
      })),
      totals: result.totals,
      stoppedReason: result.stoppedReason,
      historyPortfolioCount: result.historyPortfolioCount,
      attemptedExperimentCount: result.attemptedExperimentCount,
      attemptedRepairExperimentCount: result.attemptedRepairExperimentCount,
      rejectedRepairAcquisitionCount: result.rejectedRepairAcquisitionCount,
      rejectedRepairExperimentCount: result.rejectedRepairExperimentCount,
      finalCheckpoints: result.finalPortfolio.checkpoints.map((checkpoint) => {
        const summary = summarizeFinalState(simulator, checkpoint);
        return {
          id: summary.id,
          roles: summary.roles,
          hero: summary.hero,
          exactStateFingerprint: summary.exactStateFingerprint,
          routeLength: summary.routeLength,
          route: summary.route,
          nextLevel: summary.nextLevel,
          actionCounts: summary.actionCounts,
          visibleBattleExp: summary.visibleBattleExp,
          lowestDamageBattles: summary.lowestDamageBattles,
        };
      }),
      verdict: result.verdict,
    }, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify({
    schema: result.schema,
    controls: result.controls,
    rounds: result.rounds,
    totals: result.totals,
    stoppedReason: result.stoppedReason,
    finalCheckpointCount: result.finalPortfolio.checkpoints.length,
    finalCheckpoints: result.finalPortfolio.checkpoints.map((checkpoint) =>
      summarizeFinalState(simulator, checkpoint)),
    verdict: result.verdict,
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main, summarizeFinalState };
