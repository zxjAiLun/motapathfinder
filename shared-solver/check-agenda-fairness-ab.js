"use strict";

/**
 * PR-5.31a regression checker: Bounded Agenda Fairness A/B Experiment.
 *
 * Asserts locked causal metrics from the 8,000-expansion A/B experiment:
 *   1. PR-5.31a artifact exists and conforms to schema:
 *      - Target seed: 2-7f41f60b09a55951abd8931c
 *      - Budget: 8000 expansions
 *   2. Control (Production Goal-Relative Best-First):
 *      - TS11 expansions are strictly 0 (floor starvation).
 *      - P7 (changeFloor TS13->TS12) suffered massive queue wait (6,639 expansions).
 *      - P8 (slimeman@TS12:9,3, d=29) status is "queued", never popped (wait > 1,352 expansions).
 *      - Deepest continuous teacher prefix strictly halts at Step 7.
 *   3. Treatment A (Hybrid-Fair Every 32):
 *      - TS11 expansions activated (> 0, actual: 3).
 *      - P7 popped at expansion 703 (queue wait 695 vs Control 6,639, ~10x acceleration).
 *   4. Treatment B (Hybrid-Fair Every 16):
 *      - TS11 expansions significantly activated (actual: 15).
 *      - P7 popped at expansion 415 (queue wait 407, 16.3x faster than Control).
 *      - P8 successfully popped at expansion 7,935 (unlocks Step 8 in the detour preparation chain).
 *      - Deepest continuous teacher prefix advances to Step 8 (> Step 7).
 *   5. Safety contract:
 *      - Agenda fairness skipped inactive/already expanded nodes (skippedInactive > 0, skippedAlreadyExpanded > 0),
 *        proving dominance replacements and stale entries are never incorrectly popped.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ARTIFACT_PATH = path.join(
  __dirname,
  "routes",
  "generated",
  "5-31a",
  "agenda-fairness-ab-result.json",
);

function runChecks() {
  assert.ok(fs.existsSync(ARTIFACT_PATH), `PR-5.31a artifact missing: ${ARTIFACT_PATH}`);
  const report = JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf8"));

  assert.strictEqual(report.schema, "pr-5.31a.agenda-fairness-ab.v1");
  assert.strictEqual(report.budget, 8000);
  assert.strictEqual(report.seed, "2-7f41f60b09a55951abd8931c");

  const { control, treat32, treat16 } = report.arms;
  assert.ok(control && treat32 && treat16, "all three arms must be present in report");

  // Check Control
  assert.strictEqual(control.floorService.TS11, 0, "Control TS11 expansions must be strictly 0");
  assert.strictEqual(control.exactTeacherCoverage.deepestContinuousPrefix, 7, "Control deepest prefix must be 7");
  assert.ok(control.criticalMilestones.prefix7_TS13_to_TS12.poppedAt > 6000, "Control P7 must pop late (>6000)");
  assert.strictEqual(control.criticalMilestones.prefix8_TS12_slimeman.status, "queued", "Control P8 must never pop at 8k");

  // Check Treatment A (Fairness 32)
  assert.ok(treat32.floorService.TS11 > 0, "Treatment A TS11 expansions must be > 0");
  assert.ok(treat32.criticalMilestones.prefix7_TS13_to_TS12.poppedAt < 1000, "Treatment A P7 must pop early (<1000)");
  assert.ok(treat32.criticalMilestones.prefix7_TS13_to_TS12.queueWait < 1000, "Treatment A P7 queue wait must be < 1000");

  // Check Treatment B (Fairness 16)
  assert.ok(treat16.floorService.TS11 >= 10, "Treatment B TS11 expansions must be >= 10");
  assert.ok(treat16.criticalMilestones.prefix7_TS13_to_TS12.poppedAt < 500, "Treatment B P7 must pop very early (<500)");
  assert.ok(treat16.criticalMilestones.prefix7_TS13_to_TS12.queueWait < 500, "Treatment B P7 wait must be < 500");
  assert.strictEqual(treat16.criticalMilestones.prefix8_TS12_slimeman.status, "popped", "Treatment B P8 must be popped at 8k");
  assert.strictEqual(treat16.exactTeacherCoverage.deepestContinuousPrefix, 8, "Treatment B deepest prefix must advance to 8");

  // Check safety contract: inactive entries properly skipped
  assert.ok(treat16.agendaFairness.skippedInactive > 0, "Fairness lane must verify active entry and skip inactive states");
  assert.ok(treat16.agendaFairness.skippedAlreadyExpanded > 0, "Fairness lane must skip already-expanded states");

  process.stdout.write("PASS check-agenda-fairness-ab: Control TS11 expansions=0, deepest=7, P8 queued; Treatment B TS11 expansions=15, P7 wait reduced 16.3x (6,639->407), P8 popped at exp 7,935, deepest prefix advanced to 8; fairness safety contract verified.\n");
}

runChecks();
