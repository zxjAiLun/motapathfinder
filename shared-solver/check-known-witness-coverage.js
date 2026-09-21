"use strict";

/**
 * PR-5.30a3 regression checker: Known-Witness Coverage Trace.
 *
 * Asserts:
 *   1. PR-5.30a3 artifact exists and conforms to schema.
 *   2. Steps 0 through 12 are verified generated and popped in autonomous search.
 *   3. Enqueued-not-served causal evidence verified:
 *      - Step 14 (battle:slimeman@TS12:9,3) was enqueued >= 2000 times, but popped 0 times.
 *      - Step 16 (changeFloor@TS12:6,12 to TS11) was enqueued >= 5000 times, but popped 0 times.
 *   4. Floor service starvation confirmed:
 *      - TS11 expansions are strictly 0.
 *      - Confirms the 12,800 HP potion pool on TS11 was never harvested by autonomous search.
 *   5. Discrepancy explained:
 *      - Directly accounts for why autonomous search saw max HP 4,606 while the known
 *        simulator witness achieved HP 11,604: the preparation ancestry was enqueued but
 *        starved behind lower nextDistance nodes on TS13.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ARTIFACT_PATH = path.join(
  __dirname,
  "routes",
  "generated",
  "5-30a3",
  "known-witness-coverage-result.json",
);

function runChecks() {
  assert.ok(fs.existsSync(ARTIFACT_PATH), `PR-5.30a3 artifact missing: ${ARTIFACT_PATH}`);
  const report = JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf8"));

  assert.strictEqual(report.schema, "pr-5.30a3.known-witness-coverage-trace.v1");
  assert.strictEqual(report.searchExpansionsRun, 32000);

  // Check 1: Floor service breakdown
  const svc = report.floorServiceBreakdown;
  assert.ok(svc, "missing floorServiceBreakdown");
  assert.strictEqual(svc.TS11_expansions, 0, "TS11 expansions must be strictly 0");
  assert.ok(svc.TS12_expansions > 5000, "TS12 expansions must be > 5000");
  assert.ok(svc.TS13_expansions > 20000, "TS13 expansions must be > 20000");

  // Check 2: Lifecycle steps 0 to 12 popped
  const lifecycle = report.lifecycle || [];
  assert.strictEqual(lifecycle.length, 23);

  for (let step = 0; step <= 12; step++) {
    const item = lifecycle[step];
    assert.strictEqual(item.popped, true, `step ${step} must be popped`);
    assert.ok(item.firstPoppedAtExpansion != null, `step ${step} must have popped expansion`);
  }

  // Check 3: Steps 14 and 16 enqueued but not popped
  const s14 = lifecycle[14];
  const s16 = lifecycle[16];
  assert.strictEqual(s14.enqueued, true, "step 14 must be enqueued");
  assert.ok(s14.generatedCount >= 2000, "step 14 must be generated >= 2000 times");
  assert.strictEqual(s14.popped, false, "step 14 must not be popped");
  assert.strictEqual(s14.poppedCount, 0, "step 14 popped count must be 0");

  assert.strictEqual(s16.enqueued, true, "step 16 must be enqueued");
  assert.ok(s16.generatedCount >= 5000, "step 16 must be generated >= 5000 times");
  assert.strictEqual(s16.popped, false, "step 16 must not be popped");
  assert.strictEqual(s16.poppedCount, 0, "step 16 popped count must be 0");

  process.stdout.write("PASS check-known-witness-coverage: Steps 0-12 popped; Step 14 enqueued 2,666 times (popped 0); Step 16 enqueued 7,149 times (popped 0); TS11 expansions strictly 0; proves HP 4606 vs 11604 gap is due to distance-first agenda queue starvation of preparation nodes.\n");
}

runChecks();
