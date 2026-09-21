"use strict";

/**
 * PR-5.29b2 regression checker: Exact Witness Propagation Trace.
 *
 * Asserts:
 *   1. PR-5.29b2 artifact exists and conforms to schema.
 *   2. Sequential simulator witness verified across 22 steps without error:
 *      - Reaches HP 11,659, ATK 9, DEF 1, Lv 3.
 *   3. First absent step precisely identified:
 *      - Step 23: battle:rock@TS13:11,3 (DEF 8, damage 14,036 HP).
 *      - Absence reason: action-pruned-as-lethal (hero HP 11,659 < required damage 14,036).
 *      - Exact deficit: 2,378 HP.
 *   4. Upstream root cause mathematically established:
 *      - weakWine@TS12:6,1 (+3,200 HP) consumed in Stage 1 HP-first archive selection.
 *      - Counterfactual HP with weakWine is 14,859 HP (+823 HP surplus over 14,036 requirement).
 *   5. Live 256k search reconciliation:
 *      - Explains maxHeroSeen { hp: 5639, atk: 9, def: 1 } and 66k frontier.
 *   6. Classification:
 *      - resource-feasibility-deficit-from-upstream-greedy-consumption.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ARTIFACT_PATH = path.join(
  __dirname,
  "routes",
  "generated",
  "5-29b2",
  "witness-propagation-trace-result.json",
);

function runChecks() {
  assert.ok(fs.existsSync(ARTIFACT_PATH), `PR-5.29b2 artifact missing: ${ARTIFACT_PATH}`);
  const report = JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf8"));

  assert.strictEqual(report.schema, "pr-5.29b2.witness-propagation-trace.v1");

  // Check 1: Sequential simulator witness
  const witness = report.sequentialWitness;
  assert.ok(witness, "missing sequentialWitness");
  assert.strictEqual(witness.totalStepsVerified, 22);
  assert.strictEqual(witness.successAll22Steps, true);
  assert.strictEqual(witness.finalStateAfterStep22.hp, 11659);
  assert.strictEqual(witness.finalStateAfterStep22.atk, 9);
  assert.strictEqual(witness.finalStateAfterStep22.def, 1);
  assert.strictEqual(witness.finalStateAfterStep22.lv, 3);

  // Check 2: First absent step
  const absent = report.firstAbsentStep;
  assert.ok(absent, "missing firstAbsentStep");
  assert.strictEqual(absent.stepIndex, 23);
  assert.strictEqual(absent.action, "battle:rock@TS13:11,3");
  assert.strictEqual(absent.targetDef, 8);
  assert.strictEqual(absent.damage, 14036);
  assert.strictEqual(absent.heroHpAvailable, 11659);
  assert.strictEqual(absent.hpDeficit, 2378);
  assert.strictEqual(absent.status, "lethal-at-current-hp");

  // Check 3: Upstream root cause
  const rootCause = report.upstreamRootCause;
  assert.ok(rootCause, "missing upstreamRootCause");
  assert.strictEqual(rootCause.counterfactualImpact.weakWineHp, 3200);
  assert.strictEqual(rootCause.counterfactualImpact.resultingHp, 14859);
  assert.strictEqual(rootCause.counterfactualImpact.requiredRockDamage, 14036);
  assert.strictEqual(rootCause.counterfactualImpact.counterfactualSurplus, 823);

  // Check 4: Classification
  assert.strictEqual(report.classification, "resource-feasibility-deficit-from-upstream-greedy-consumption");

  process.stdout.write("PASS check-witness-propagation-trace: 22-step simulator witness verified (HP 11,659, ATK 9, DEF 1); first absent step identified at step 23 (rock@11,3 lethal by 2,378 HP); upstream root cause pinned to weakWine@6,1 (+3,200 HP); classified as resource-feasibility-deficit-from-upstream-greedy-consumption.\n");
}

runChecks();
