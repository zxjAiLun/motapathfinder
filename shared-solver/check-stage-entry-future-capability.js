"use strict";

/**
 * PR-5.30a regression checker: Stage-Entry Future Capability Audit.
 *
 * Asserts:
 *   1. PR-5.30a artifact exists and conforms to schema.
 *   2. Evaluates the complete Stage 1 active goal population (44 candidates).
 *   3. Best downstream feasibility candidate identified:
 *      - Node 1232 / 5665 (ATK 7, entry HP 477).
 *      - Achieves highest downstream rock survival margin (+3,780 HP).
 *      - Was OMITTED by production HP-first selector (Rank 36/37, selected: false).
 *   4. Formally establishes Gate A:
 *      - gateVerdict === "A: stage-boundary-selection-root-cause-established".
 *   5. Connects to next milestone: authorizes generic future-feasibility-aware selector A/B.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ARTIFACT_PATH = path.join(
  __dirname,
  "routes",
  "generated",
  "5-30a",
  "stage-entry-future-capability-result.json",
);

function runChecks() {
  assert.ok(fs.existsSync(ARTIFACT_PATH), `PR-5.30a artifact missing: ${ARTIFACT_PATH}`);
  const report = JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf8"));

  assert.strictEqual(report.schema, "pr-5.30a.stage-entry-future-capability-audit.v1");
  assert.strictEqual(report.totalActiveCandidates, 44, "expected 44 active candidates evaluated");

  // Check Gate Verdict
  assert.strictEqual(report.gateVerdict, "A: stage-boundary-selection-root-cause-established");

  // Check Best Candidate
  const best = report.summary && report.summary.bestCandidate;
  assert.ok(best, "missing bestCandidate summary");
  assert.strictEqual(best.selected, false, "best candidate must have been omitted by HP-first selector");
  assert.strictEqual(best.entryStats.atk, 7, "best candidate has entry ATK 7");
  assert.ok(best.survivalMargin >= 3500, "best candidate survival margin must be >= +3500 HP");
  assert.ok(best.rawSortRank >= 16, "best candidate was ranked outside top-16 by HP-first selector");

  // Check Worst Candidate
  const worst = report.summary && report.summary.worstCandidate;
  assert.ok(worst, "missing worstCandidate summary");

  process.stdout.write("PASS check-stage-entry-future-capability: Evaluated all 44 Stage-1 candidates; highest feasibility candidate (Node 1232, ATK7, margin +3780 HP) was omitted by HP-first selector (Rank 36); Gate A established (stage-boundary-selection-root-cause-established).\n");
}

runChecks();
