"use strict";

/**
 * PR-5.30a2 regression checker: Candidate-Specific Executable Closure Audit.
 *
 * Asserts:
 *   1. PR-5.30a2 artifact exists and conforms to schema.
 *   2. Evaluates 4 structurally different representative seeds:
 *      - Node 1497 (Selected HP-top: HP 1369, ATK 6)
 *      - Node 1232 (Omitted best-projected: HP 477, ATK 7)
 *      - Node 1195 (Selected best-projected: HP 1337, ATK 6)
 *      - Node 1543 (Selected low-margin: HP 1337, ATK 6)
 *   3. Dual-mode closure evaluation confirmed:
 *      - 32,000 expansions autonomous DP closure search with goal "make any rock survivable".
 *      - Candidate-specific sequential simulator trajectory execution.
 *   4. Exhaustive negative closure outcome:
 *      - All 4 candidates have search32k.foundGoal === false.
 *      - All 4 candidates have trajectory.rockSurvivable === false.
 *      - All 4 candidates have trajectory.actualSurvivalMargin < 0.
 *   5. Formally establishes Case C:
 *      - Confirms that stage-boundary selection is NOT the causal blocker.
 *      - Directs next investigation to PR-5.30c (Earliest Feasibility Loss Audit).
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ARTIFACT_PATH = path.join(
  __dirname,
  "routes",
  "generated",
  "5-30a2",
  "candidate-specific-closure-result.json",
);

function runChecks() {
  assert.ok(fs.existsSync(ARTIFACT_PATH), `PR-5.30a2 artifact missing: ${ARTIFACT_PATH}`);
  const report = JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf8"));

  assert.strictEqual(report.schema, "pr-5.30a2.candidate-specific-closure-audit.v1");

  // Check 1: Case C formally established
  assert.ok(report.caseVerdict.startsWith("Case C"), "verdict must be Case C");

  // Check 2: All 4 candidates evaluated
  const results = report.results || [];
  assert.strictEqual(results.length, 4, "expected exactly 4 representative candidates evaluated");

  const n1497 = results.find((r) => r.nodeId === 1497);
  const n1232 = results.find((r) => r.nodeId === 1232);
  const n1195 = results.find((r) => r.nodeId === 1195);
  const n1543 = results.find((r) => r.nodeId === 1543);

  assert.ok(n1497 && n1232 && n1195 && n1543, "all 4 representative candidates must be present");

  // Check 3: Dual-mode closure negative across all 4 candidates
  for (const r of results) {
    assert.strictEqual(r.search32k.foundGoal, false, `candidate ${r.nodeId} 32k search must not find goal`);
    assert.strictEqual(r.trajectory.rockSurvivable, false, `candidate ${r.nodeId} trajectory must not survive rock`);
    assert.ok(r.trajectory.actualSurvivalMargin < 0, `candidate ${r.nodeId} survival margin must be negative`);
  }

  // Check 4: Node 1497 best-achieved trajectory stats
  assert.strictEqual(n1497.trajectory.stepsCompleted, 22);
  assert.strictEqual(n1497.trajectory.actualHpBeforeRock, 11604);
  assert.strictEqual(n1497.trajectory.actualSurvivalMargin, -2432);

  // Check 5: Node 1232 trajectory stats
  assert.strictEqual(n1232.trajectory.stepsCompleted, 9);
  assert.strictEqual(n1232.trajectory.actualHpBeforeRock, 762);
  assert.strictEqual(n1232.trajectory.actualSurvivalMargin, -13274);

  process.stdout.write("PASS check-candidate-specific-closure: All 4 representative seeds evaluated across 32k searchDP and sequential simulator trajectory; rockSurvivable=false across all candidates; Case C formally established; selector cleared as bottleneck.\n");
}

runChecks();
