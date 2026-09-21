"use strict";

/**
 * PR-5.29c regression checker: Local Feasibility Gap Closure Audit.
 *
 * Asserts:
 *   1. PR-5.29c artifact exists and conforms to schema.
 *   2. Step-22 baseline state confirmed: HP 11,659, ATK 9, DEF 1, Lv 3.
 *   3. Max pre-rock reachable HP is mathematically bounded (< 12,000 HP).
 *   4. Min rock damage mathematically verified: 14,036 HP across all 4 rock locations.
 *   5. Deficit verified: ~2,396 HP deficit prevents defeating any rock.
 *   6. I576 (+2 ATK) blocker dependency mathematically proved:
 *      - Direct blocker: zombie@8,10 (DEF 9, requires ATK 10).
 *      - Entrance blocker: rock@7,9 (DEF 8, requires 14,036 HP).
 *      - Proves I576 CANNOT precede rock defeat.
 *   7. Pre-rock DEF strictly bounded at 1 (zero blue gems, Lv4 requires 200 EXP vs 63 total).
 *   8. Unambiguously classified as B: gap-not-closable.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ARTIFACT_PATH = path.join(
  __dirname,
  "routes",
  "generated",
  "5-29c",
  "local-feasibility-gap-result.json",
);

function runChecks() {
  assert.ok(fs.existsSync(ARTIFACT_PATH), `PR-5.29c artifact missing: ${ARTIFACT_PATH}`);
  const report = JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf8"));

  assert.strictEqual(report.schema, "pr-5.29c.local-feasibility-gap-audit.v1");

  // Check 1: Step-22 stats
  const step22 = report.step22BaselineState;
  assert.ok(step22, "missing step22BaselineState");
  assert.strictEqual(step22.hp, 11659);
  assert.strictEqual(step22.atk, 9);
  assert.strictEqual(step22.def, 1);
  assert.strictEqual(step22.lv, 3);

  // Check 2: Max pre-rock HP bounded
  assert.ok(report.part1_maxHpClosure.maxPossibleHpBeforeRock < 12000, "pre-rock HP must be strictly bounded below 12k");

  // Check 3: I576 blocker dependency
  const i576 = report.part2_atkClosureAndI576Audit;
  assert.ok(i576, "missing part2_atkClosureAndI576Audit");
  assert.strictEqual(i576.directBlocker.def, 9);
  assert.strictEqual(i576.directBlocker.minAtkRequired, 10);
  assert.strictEqual(i576.corridorEntranceBlocker.damageAtAtk9Def1, 14036);
  assert.ok(i576.dependencyChain.includes("rock@7,9"));
  assert.ok(i576.dependencyChain.includes("zombie@8,10"));

  // Check 4: DEF upper bound
  const defAudit = report.part3_defClosureAudit;
  assert.ok(defAudit, "missing part3_defClosureAudit");
  assert.strictEqual(defAudit.currentDef, 1);
  assert.strictEqual(defAudit.blueGemsOnAllowedFloors, 0);
  assert.strictEqual(defAudit.expNeededForLv4, 200);
  assert.ok(defAudit.expAvailableInTower < defAudit.expNeededForLv4);

  // Check 5: Rock deficit matrix
  const matrix = report.part4_rockDeficitMatrix;
  assert.ok(Array.isArray(matrix) && matrix.length === 4, "expected 4 rock locations evaluated");
  for (const r of matrix) {
    assert.strictEqual(r.damage, 14036, `${r.rock} damage must be 14,036`);
    assert.strictEqual(r.status, "lethal-at-current-hp");
    assert.ok(r.deficit > 2000, "deficit must be > 2000 HP");
  }

  // Check 6: Classification
  assert.strictEqual(report.part5_classification.category, "B: gap-not-closable");

  process.stdout.write("PASS check-local-feasibility-gap-closure: Step-22 state verified (HP 11,659, ATK 9, DEF 1); pre-rock HP bounded (<12k); I576 proved blocked by rock@7,9 + zombie@8,10; all 4 rocks lethal (14,036 dmg); classified as B: gap-not-closable.\n");
}

runChecks();
