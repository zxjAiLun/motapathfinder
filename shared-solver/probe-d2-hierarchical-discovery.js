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
  const result = runHierarchicalDiscovery(project, PROJECT_ROOT, initialState, terminalGoal, {
    towerId: "onlyup",
    maxRounds: Number(process.env.MOTAPATHFIND_D2_ROUNDS || 12),
    initialMaxExpansions: 64,
    localMaxExpansions: 32,
    candidateLimit: 8,
    repairCandidateLimit: 16,
    excludeTargetNodeId: "MT5:item:11,5:I894",
  });
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
