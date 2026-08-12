"use strict";

/** TEST GRADE: integration-local */

const assert = require("node:assert");
const path = require("node:path");

const { makeBlindSimulator, readBlindGoal } = require("./lib/blind-discovery-baseline");
const { runHierarchicalDiscovery } = require("./lib/hierarchical-discovery-engine");
const { loadProject } = require("./lib/project-loader");
const { summarizeFinalState } = require("./probe-d2-hierarchical-discovery");
const { createMt5EntryState, detachCheckpoint } = require("./qualify-blind-discovery");

const ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");
const GOAL_FILE = path.join(__dirname, "blind-goals", "onlyup-mt5-blueking.json");

function main() {
  const project = loadProject(PROJECT_ROOT);
  const terminalGoal = readBlindGoal(GOAL_FILE).goal;
  const initialState = detachCheckpoint(createMt5EntryState(project));
  const result = runHierarchicalDiscovery(project, PROJECT_ROOT, initialState, terminalGoal, {
    towerId: "onlyup",
    maxRounds: 12,
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
    "blocker-repair",
    "blocker-repair",
    "blocker-repair",
    "blocked",
  ]);
  assert.deepStrictEqual(result.rounds.slice(0, 5).map((round) => round.completedPrerequisiteId), [
    "MT5:enemy:8,11:skeletonKing",
    "MT5:enemy:3,10:skeletonPresbyter",
    "MT5:enemy:11,11:devilWarrior",
    "MT5:enemy:1,11:skeletonKnight",
    "MT4:enemy:10,5:devilWarrior",
  ]);
  assert.deepStrictEqual(result.rounds.slice(2, 5).map((round) => round.repair.sourceNodeId), [
    "MT5:item:12,11:I1014",
    "MT5:item:0,11:I1013",
    "MT4:item:11,5:I642",
  ]);
  assert.strictEqual(result.rounds.slice(0, 5).every((round) => round.outcome.goalFound), true);
  assert.strictEqual(result.rounds.slice(0, 5).every((round) => round.outcome.strictReplay), true);
  assert.deepStrictEqual(result.totals, {
    expansions: 156,
    generated: 423,
    accepted: 325,
    rejected: 98,
  });
  assert.strictEqual(result.stoppedReason, "NO_AUTOMATIC_BLOCKER_REPAIR_IDENTIFIED");
  assert.strictEqual(result.finalPortfolio.checkpoints.length, 2);

  const simulator = makeBlindSimulator(project);
  const finalStates = result.finalPortfolio.checkpoints.map((checkpoint) =>
    summarizeFinalState(simulator, checkpoint));
  assert.deepStrictEqual(finalStates.map((entry) => entry.hero), [
    { hp: 40578, atk: 1097, def: 915, mdef: 6310, lv: 7, exp: 315, equipment: ["I893"] },
    { hp: 40578, atk: 1097, def: 915, mdef: 6310, lv: 7, exp: 315, equipment: ["I893"] },
  ]);
  assert.deepStrictEqual(finalStates.map((entry) => entry.nextLevel), [
    { level: 7, exp: 315, need: 600, deficit: 285 },
    { level: 7, exp: 315, need: 600, deficit: 285 },
  ]);
  assert.strictEqual(finalStates.every((entry) => entry.visibleBattleExp === 0), true);
  assert.strictEqual(finalStates.every((entry) => entry.actionCounts.changeFloor === 2), true);
  assert.strictEqual(finalStates.every((entry) => entry.fightToLevelUp.length === 0), true);
  assert.deepStrictEqual(finalStates.map((entry) => entry.exactStateFingerprint), [
    "3226510d0bf012b4",
    "bf015727d8313a75",
  ]);

  const blocked = result.rounds[result.rounds.length - 1];
  const topRepair = blocked.reviewCandidates[0];
  assert.strictEqual(blocked.repairCandidateCount, 120);
  assert.strictEqual(blocked.candidatesEvaluatedForAccess, 40);
  assert.strictEqual(topRepair.sourceNodeId, "MT5:item:7,3:I1009");
  assert.strictEqual(topRepair.repairs.beforeSurvivalMargin, -19875);
  assert.strictEqual(topRepair.access.startable, false);

  process.stdout.write(`${JSON.stringify({
    status: "passed",
    completedPrerequisites: result.rounds.slice(0, 5).map((round) => round.completedPrerequisiteId),
    repairs: result.rounds.slice(2, 5).map((round) => round.repair.sourceNodeId),
    totals: result.totals,
    finalStates,
    stoppedReason: result.stoppedReason,
    nextRequiredRepairClass: "cross-floor-exp-or-composite-resource-chain",
    verdict: result.verdict,
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main };
