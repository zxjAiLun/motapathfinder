"use strict";

/** TEST GRADE: integration-local */

const assert = require("node:assert");
const path = require("node:path");

const { makeBlindSimulator, readBlindGoal } = require("./lib/blind-discovery-baseline");
const {
  executeLevelProgressSearch,
  rankHistoricalPortfolios,
  runHierarchicalDiscovery,
} = require("./lib/hierarchical-discovery-engine");
const { loadProject } = require("./lib/project-loader");
const { summarizeFinalState } = require("./probe-d2-hierarchical-discovery");
const { createMt5EntryState, detachCheckpoint } = require("./qualify-blind-discovery");

const ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");
const GOAL_FILE = path.join(__dirname, "blind-goals", "onlyup-mt5-blueking.json");

function main() {
  const syntheticHistory = [
    { checkpoints: [{ state: { hero: { lv: 7, exp: 400 }, route: [1] } }] },
    { checkpoints: [{ state: { hero: { lv: 8, exp: 10 }, route: [1, 2] } }] },
    { checkpoints: [{ state: { hero: { lv: 7, exp: 500 }, route: [1, 2, 3] } }] },
    { checkpoints: [{ state: { hero: { lv: 0, exp: 0 }, route: [] } }] },
  ];
  assert.deepStrictEqual(
    rankHistoricalPortfolios(syntheticHistory, "blocker-first").map((entry) => entry.index),
    [0, 1, 2],
  );
  assert.deepStrictEqual(
    rankHistoricalPortfolios(syntheticHistory, "level-progress-first")
      .map((entry) => entry.index),
    [1, 2, 0],
  );
  const project = loadProject(PROJECT_ROOT);
  const terminalGoal = readBlindGoal(GOAL_FILE).goal;
  const initialState = detachCheckpoint(createMt5EntryState(project));
  const result = runHierarchicalDiscovery(project, PROJECT_ROOT, initialState, terminalGoal, {
    towerId: "onlyup",
    maxRounds: 6,
    initialMaxExpansions: 64,
    localMaxExpansions: 32,
    candidateLimit: 8,
    repairCandidateLimit: 16,
    excludeTargetNodeId: "MT5:item:11,5:I894",
  });

  assert.strictEqual(result.inputContract.knownRouteUsed, false);
  assert.strictEqual(result.controls.maxRuntimeMs, 0);
  assert.deepStrictEqual(result.rounds.map((round) => round.kind), [
    "terminal-dependency",
    "terminal-dependency",
    "terminal-dependency",
    "blocker-repair",
    "blocker-repair",
    "blocker-repair-rejected",
    "blocker-repair",
  ]);
  assert.deepStrictEqual(result.rounds.slice(0, 5).map((round) => round.completedPrerequisiteId), [
    "MT5:enemy:8,11:skeletonKing",
    "MT5:enemy:4,11:skeletonKing",
    "MT5:enemy:3,10:skeletonPresbyter",
    "MT4:enemy:11,11:skeletonPriest",
    "MT5:enemy:1,11:skeletonKnight",
  ]);
  assert.deepStrictEqual(result.rounds.slice(3, 5).map((round) => round.repair.sourceNodeId), [
    "MT4:item:12,11:I1013",
    "MT5:item:0,11:I1013",
  ]);
  assert.deepStrictEqual(result.rounds[1].feedbackSelection.roles, ["first-goal", "shortest"]);
  assert.strictEqual(result.rounds.slice(0, 5).every((round) => round.outcome.goalFound), true);
  assert.strictEqual(result.rounds.slice(0, 5).every((round) => round.outcome.strictReplay), true);
  assert.strictEqual(result.rounds[5].repair.sourceNodeId, "MT4:item:7,3:I621");
  assert.strictEqual(result.rounds[5].repairClosure.complete, false);
  assert.strictEqual(result.rounds[5].repairVerification.actual, null);
  assert.strictEqual(result.rounds[5].outcome.searchComplete, true);
  assert.strictEqual(result.rounds[5].outcome.frontierExhausted, true);
  assert.strictEqual(result.rounds[5].outcome.goalFound, false);
  assert.strictEqual(result.rounds[5].retainedPortfolioFingerprint.length > 0, true);
  assert.strictEqual(result.rounds[6].repair.sourceNodeId, "MT5:item:12,11:I1014");
  assert.strictEqual(result.rounds[6].repairClosure.complete, true);
  assert.ok(result.rounds[6].repairVerification.actual);
  assert.strictEqual(result.rounds[6].repairVerification.netImprovement, true);
  assert.strictEqual(
    result.rounds[6].repairVerification.closureClass,
    "improved-but-still-blocked",
  );
  assert.strictEqual(
    result.rounds[6].repairVerification.actual.status,
    "lethal-at-current-hp",
  );
  assert.strictEqual(result.rounds[6].repairCompilationCost.graphBuildCount, 0);
  assert.strictEqual(result.rounds[6].repairCompilationCost.checkpointAnalysisCacheHits, 5);
  assert.strictEqual(
    result.rounds[6].repairCompilationCost.graphReuseCount +
      result.rounds[6].repairCompilationCost.accessCacheHits,
    result.rounds[6].repairCompilationCost.uniqueAccessProbeCount,
  );
  assert.strictEqual(
    result.rounds[6].repairVerification.actual.predictedSurvivalMargin,
    result.rounds[6].repair.repairs.survivalMargin,
  );
  assert.ok(result.rounds[6].repairVerification.actual.predictionError < 0);
  assert.deepStrictEqual(result.totals, {
    expansions: 220,
    generated: 694,
    accepted: 488,
    rejected: 206,
  });
  assert.strictEqual(result.stoppedReason, "max-rounds");
  assert.strictEqual(result.rejectedRepairExperimentCount, 1);
  assert.ok(result.repairCompilationCache.checkpointAnalysisCount > 0);
  assert.ok(result.repairCompilationCache.accessCount > 0);
  assert.strictEqual(result.finalPortfolio.checkpoints.length, 2);
  const levelProgressProbe = executeLevelProgressSearch(
    project,
    PROJECT_ROOT,
    result.finalPortfolio,
    { localMaxExpansions: 32, candidateLimit: 8 },
    new Set(),
  );
  assert.ok(levelProgressProbe);
  assert.strictEqual(levelProgressProbe.targetLevel, 8);
  assert.strictEqual(
    levelProgressProbe.execution.selected.prerequisite.actionGoal.minHero.lv,
    8,
  );
  assert.strictEqual(levelProgressProbe.execution.outcome.goalFound, false);
  assert.strictEqual(levelProgressProbe.execution.outcome.searchComplete, true);

  const simulator = makeBlindSimulator(project);
  const finalStates = result.finalPortfolio.checkpoints.map((checkpoint) =>
    summarizeFinalState(simulator, checkpoint));

  process.stdout.write(`${JSON.stringify({
    status: "passed",
    completedPrerequisites: result.rounds
      .filter((round) => round.completedPrerequisiteId)
      .map((round) => round.completedPrerequisiteId),
    acceptedRepairs: result.rounds
      .filter((round) => round.kind === "blocker-repair")
      .map((round) => round.repair.sourceNodeId),
    rejectedRepair: result.rounds[5].repair.sourceNodeId,
    acceptedRepairVerification: result.rounds[6].repairVerification,
    totals: result.totals,
    finalHeroes: finalStates.map((entry) => entry.hero),
    levelProgressProbe: {
      input: levelProgressProbe.progress,
      targetLevel: levelProgressProbe.targetLevel,
      outcome: levelProgressProbe.execution.outcome,
    },
    stoppedReason: result.stoppedReason,
    comparison: {
      before: "unreachable counterfactual repair discarded the active portfolio",
      after: "unreachable repair is rejected and the unchanged portfolio selects the next candidate",
    },
    verdict: result.verdict,
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main };
