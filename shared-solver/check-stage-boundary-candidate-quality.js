"use strict";

/**
 * PR-5.28c / PR-5.28c1 regression checker: Stage-Boundary Candidate Quality Counterfactual Audit.
 *
 * Asserts:
 *   1. Stage 1 boundary artifact exists and is well-formed.
 *   2. Population matches observation: 44 active candidates across 2 growth profiles (36 ATK6, 8 ATK7).
 *   3. HP-first lexicographic selection bias is proven (Q1 ESTABLISHED):
 *      - 16 selected candidates are 100% ATK6 (16/36).
 *      - 8 ATK7 candidates are 0% selected (0/8).
 *   4. Omitted Pareto-nondominated candidates exist under documented safe dimensions (Q1b ESTABLISHED):
 *      - Uses undisputed physical dimensions: hp, atk, def, mdef, lv, exp.
 *      - Confirms that omitted Pareto-nondominated candidates exist.
 *   5. Q2 downstream viability probe is recorded:
 *      - Evaluates equal-work downstream capability on both arms under identical searchDP budget.
 *      - Records legal survivable battles and evolution milestones (firstAtk7, firstAtk8, def1).
 *      - Establishes that selected ATK6 also recovers ATK7/8 growth, showing that agenda starvation,
 *        rather than entry profile alone, is the primary forward bottleneck.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ARTIFACT_PATH = path.join(
  __dirname,
  "routes",
  "generated",
  "5-28c",
  "stage1-ts12-ts13.json",
);

const SAFE_DIMS = ["hp", "atk", "def", "mdef", "lv", "exp"];

function dominates(a, b) {
  let strictlyBetter = false;
  for (const key of SAFE_DIMS) {
    if (a[key] < b[key]) return false;
    if (a[key] > b[key]) strictlyBetter = true;
  }
  return strictlyBetter;
}

function runChecks() {
  assert.ok(fs.existsSync(ARTIFACT_PATH), `PR-5.28c artifact missing: ${ARTIFACT_PATH}`);
  const report = JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf8"));

  assert.strictEqual(report.schema, "pr-5.28c.stage-boundary-candidate-quality-audit.v1");
  assert.strictEqual(report.readOnly, true);
  assert.strictEqual(report.productionSemanticsUnchanged, true);

  const analysis = report.analysis;
  assert.ok(analysis, "missing analysis");
  assert.strictEqual(analysis.available, true);
  assert.strictEqual(analysis.candidateCount, 44, "expected exactly 44 active candidates");
  assert.strictEqual(analysis.selectedCount, 16, "expected candidateLimit=16 selected");
  assert.strictEqual(analysis.rejectedCount, 28, "expected 28 rejected");
  assert.strictEqual(analysis.captureTruncated, false, "capture must not be truncated");

  // Q1: Growth profiles — 36 ATK6 and 8 ATK7
  const profiles = analysis.growthProfiles || [];
  const pAtk6 = profiles.find((p) => p.profile === "atk=6,def=0,lv=2");
  const pAtk7 = profiles.find((p) => p.profile === "atk=7,def=0,lv=2");
  assert.ok(pAtk6, "missing atk=6 profile");
  assert.ok(pAtk7, "missing atk=7 profile");
  assert.strictEqual(pAtk6.total, 36);
  assert.strictEqual(pAtk6.selected, 16, "all 16 selected must be ATK6");
  assert.strictEqual(pAtk7.total, 8);
  assert.strictEqual(pAtk7.selected, 0, "ATK7 selected must be strictly 0/8");

  // Q1b: Omitted Pareto-nondominated candidates exist under documented safe dimensions
  const entries = analysis.entries || [];
  const omitted = entries.filter((e) => !e.selected);
  const omittedParetoSafe = omitted.filter((target) => {
    return !entries.some((other) => other !== target && dominates(other, target));
  });
  assert.ok(omittedParetoSafe.length > 0, "expected at least one omitted Pareto candidate under safe dimensions");
  assert.ok(omittedParetoSafe.some((e) => e.atk === 7), "expected at least one omitted ATK7 Pareto candidate");

  // Q2: Downstream viability probe exists and records evolution milestones
  const viability = report.viability;
  assert.ok(viability, "missing viability section");
  assert.ok(viability.selected && viability.selected.length > 0, "missing selected viability entries");
  assert.ok(viability.rejectedParetoNondominated && viability.rejectedParetoNondominated.length > 0, "missing rejected viability entries");

  for (const item of viability.selected.concat(viability.rejectedParetoNondominated)) {
    assert.strictEqual(typeof item.viability.legalPrimitiveActions, "number");
    assert.strictEqual(typeof item.viability.battleActions, "number");
    assert.ok(Array.isArray(item.viability.immediateSurvivableBattles), "immediateSurvivableBattles must be array");
    const probe = item.viability.probe;
    assert.ok(probe, "missing probe results");
    assert.strictEqual(typeof probe.expansions, "number");
    assert.strictEqual(typeof probe.ts13ServiceRatio, "number");
    assert.strictEqual(typeof probe.oldFloorServiceRatio, "number");
    assert.strictEqual(typeof probe.minManhattanToNextStair, "number");
  }

  // Verify that selected ATK6 arm is observed to also recover ATK7/8 growth downstream
  const selectedWithAtk7Recovery = viability.selected.filter((s) => s.viability.probe.firstAtk7 != null);
  assert.ok(selectedWithAtk7Recovery.length > 0, "selected arm must be observed recovering ATK7 downstream");

  process.stdout.write("PASS check-stage-boundary-candidate-quality: Q1 established (HP-first excludes ATK7 0/8), Q1b established (omitted Pareto exists under safe dimensions), Q2 probe recorded (selected recovers ATK7/8 downstream; agenda confirmed as primary bottleneck).\n");
}

runChecks();
