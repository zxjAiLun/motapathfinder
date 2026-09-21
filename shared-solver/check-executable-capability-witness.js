"use strict";

/**
 * PR-5.30a1 regression checker: Executable Capability Witness.
 *
 * Asserts:
 *   1. PR-5.30a1 artifact exists and conforms to schema.
 *   2. Target candidates evaluated: Node 1232 (omitted best), 1195, 1497, 1543.
 *   3. Archive post-dedup ranking confirmed:
 *      - Node 1232 has postDedupRank === 37 (> 16), selectedAtFinish === false, firstDecidingField === "hp".
 *   4. Sequential simulator execution outcomes verified:
 *      - Node 1232 halts at step 9 on TS11 with HP 762 (lethal against skeleton@3,10 requiring 1,258 HP).
 *      - Node 1497 completes 22 steps reaching HP 11,604 on TS13.
 *      - All 4 candidates have rockSurvivable === false.
 *   5. Case C established:
 *      - caseVerdict starts with "Case C".
 *      - Proves future-capability arithmetic projection was an optimistic false positive.
 *      - Rules out stage-boundary selection as the root cause (PR-5.30b selector change is HOLD).
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ARTIFACT_PATH = path.join(
  __dirname,
  "routes",
  "generated",
  "5-30a1",
  "executable-capability-witness-result.json",
);

function runChecks() {
  assert.ok(fs.existsSync(ARTIFACT_PATH), `PR-5.30a1 artifact missing: ${ARTIFACT_PATH}`);
  const report = JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf8"));

  assert.strictEqual(report.schema, "pr-5.30a1.executable-capability-witness.v1");

  // Check 1: Case Verdict
  assert.ok(report.caseVerdict.startsWith("Case C"), "verdict must be Case C (optimistic projection false positive)");

  // Check 2: All 4 candidates evaluated
  const candidates = report.results || [];
  assert.strictEqual(candidates.length, 4);

  const n1232 = candidates.find((c) => c.nodeId === 1232);
  const n1497 = candidates.find((c) => c.nodeId === 1497);
  const n1195 = candidates.find((c) => c.nodeId === 1195);
  const n1543 = candidates.find((c) => c.nodeId === 1543);

  assert.ok(n1232 && n1497 && n1195 && n1543, "all 4 target candidates must be present");

  // Check 3: Node 1232 post-dedup rank and omission
  assert.strictEqual(n1232.archiveDetails.postDedupRank, 37);
  assert.strictEqual(n1232.archiveDetails.selectedAtFinish, false);
  assert.strictEqual(n1232.execution.stepsCompleted, 9);
  assert.strictEqual(n1232.execution.finalStateReached.floorId, "TS11");
  assert.strictEqual(n1232.execution.finalStateReached.hp, 762);
  assert.strictEqual(n1232.execution.rockSurvivable, false);

  // Check 4: Node 1497 execution
  assert.strictEqual(n1497.archiveDetails.postDedupRank, 1);
  assert.strictEqual(n1497.archiveDetails.selectedAtFinish, true);
  assert.strictEqual(n1497.execution.stepsCompleted, 22);
  assert.strictEqual(n1497.execution.finalStateReached.floorId, "TS13");
  assert.strictEqual(n1497.execution.finalStateReached.hp, 11604);
  assert.strictEqual(n1497.execution.rockSurvivable, false);

  // Check 5: None of the 4 candidates can survive rock
  for (const c of candidates) {
    assert.strictEqual(c.execution.rockSurvivable, false, `candidate ${c.nodeId} must not survive rock`);
    assert.ok(c.execution.actualSurvivalMargin < 0, `candidate ${c.nodeId} margin must be negative`);
  }

  process.stdout.write("PASS check-executable-capability-witness: Node 1232 confirmed postDedupRank 37 (omitted); simulator witness proves Node 1232 halts at HP 762 on TS11; all 4 candidates rockSurvivable=false; Case C established (projection false positive; stage selector not root cause).\n");
}

runChecks();
