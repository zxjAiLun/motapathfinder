"use strict";

/**
 * TEST GRADE: unit-plus-micro
 *
 * Contract and bounded real-tower baseline. A not-found outcome is valid;
 * this check proves the input is terminal-only and the outcome remains
 * failure-visible instead of claiming no route exists.
 */

const assert = require("node:assert");
const path = require("node:path");

const {
  runBlindDiscoveryBaseline,
  validateBlindGoal,
} = require("./lib/blind-discovery-baseline");

const PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const GOAL_FILE = path.resolve(__dirname, "blind-goals", "onlyup-mt5-blueking.json");

function main() {
  assert.throws(
    () => validateBlindGoal({
      schema: "motapathfinder.blind-goal.v1",
      id: "bad",
      project: "onlyup",
      rank: "chaos",
      goal: { type: "bossDefeated", floorId: "MT5", x: 6, y: 7, enemyId: "blueKing" },
      milestones: [],
    }),
    /forbidden field: milestones/,
  );
  assert.throws(
    () => validateBlindGoal({
      schema: "motapathfinder.blind-goal.v1",
      id: "bad",
      project: "onlyup",
      rank: "chaos",
      goal: {
        type: "bossDefeated",
        floorId: "MT5",
        x: 6,
        y: 7,
        enemyId: "blueKing",
        minHero: { hp: 1 },
      },
    }),
    /forbidden field: minHero/,
  );

  const report = runBlindDiscoveryBaseline({
    goalFile: GOAL_FILE,
    projectRoot: PROJECT_ROOT,
    maxExpansions: 8,
    maxHeapMb: 2048,
    candidateLimit: 8,
    goalSkylineLimit: 8,
  });
  assert.strictEqual(report.schema, "motapathfinder.blind-discovery-baseline.v1");
  assert.strictEqual(report.grade, "D3");
  assert.deepStrictEqual(report.inputContract.actionPolicy, {});
  assert.deepStrictEqual(report.inputContract.dpHints, {});
  assert.strictEqual(report.inputContract.initialStateSource, "simulator.createInitialState");
  assert.strictEqual(report.controls.maxRuntimeMs, 0);
  assert.strictEqual(report.outcome.expansions, 8);
  assert.strictEqual(report.outcome.actionTrimmed, 0);
  assert.strictEqual(report.outcome.found, false);
  assert.strictEqual(report.outcome.goalFound, false);
  assert.strictEqual(report.outcome.budgetExhausted, true);
  assert.strictEqual(report.outcome.searchComplete, false);
  assert.strictEqual(report.outcome.stoppedReason, "expansion-limit");
  assert.ok(report.outcome.frontierSize > 0);
  assert.strictEqual(report.outcome.strictReplay, null);
  assert.strictEqual(report.verdict, "BLIND_GOAL_NOT_FOUND_WITHIN_BUDGET");

  process.stdout.write(`${JSON.stringify({
    status: "passed",
    grade: report.grade,
    inputContract: report.inputContract,
    outcome: report.outcome,
    traceSummary: report.traceSummary,
    verdict: report.verdict,
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main };
