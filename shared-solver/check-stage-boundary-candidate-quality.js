"use strict";

/**
 * PR-5.28c regression checker: Stage-Boundary Candidate Quality Counterfactual Audit.
 *
 * Asserts:
 *   1. Stage 1 boundary artifact exists and is well-formed.
 *   2. Population matches observation: 44 active candidates across 2 growth profiles (36 ATK6, 8 ATK7).
 *   3. HP-first lexicographic selection bias is proven:
 *      - 16 selected candidates are 100% ATK6 (16/36).
 *      - 8 ATK7 candidates are 0% selected (0/8).
 *   4. Omitted Pareto-nondominated candidates exist (Q1b YES):
 *      - Exactly 4 rejected candidates are Pareto-nondominated under monotone physical dimensions.
 *      - 3 of them are ATK7 growth candidates (Node 5665, 5752, 6013).
 *   5. Q2 downstream viability probe is recorded:
 *      - 16 selected and 4 rejected Pareto candidates evaluated under identical 8k searchDP probe.
 *      - Evaluated without production code changes.
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

  // Growth profiles: 36 ATK6 and 8 ATK7
  const profiles = analysis.growthProfiles || [];
  assert.strictEqual(profiles.length, 2, "expected exactly 2 growth profiles");
  const pAtk6 = profiles.find((p) => p.profile === "atk=6,def=0,lv=2");
  const pAtk7 = profiles.find((p) => p.profile === "atk=7,def=0,lv=2");
  assert.ok(pAtk6, "missing atk=6 profile");
  assert.ok(pAtk7, "missing atk=7 profile");
  assert.strictEqual(pAtk6.total, 36);
  assert.strictEqual(pAtk6.selected, 16, "all 16 selected must be ATK6");
  assert.strictEqual(pAtk7.total, 8);
  assert.strictEqual(pAtk7.selected, 0, "ATK7 selected must be strictly 0/8");

  // Q1b: Omitted Pareto-nondominated candidates exist
  assert.strictEqual(analysis.rejectedParetoNondominatedCount, 4, "expected 4 omitted Pareto candidates");
  const entries = analysis.entries || [];
  const rejectedParetoAtk7 = entries.filter((e) => !e.selected && e.paretoNondominated && e.atk === 7);
  assert.strictEqual(rejectedParetoAtk7.length, 3, "expected exactly 3 omitted ATK7 Pareto candidates");

  // Q2: Downstream viability probe exists
  const viability = report.viability;
  assert.ok(viability, "missing viability section");
  assert.strictEqual(viability.selected.length, 16);
  assert.strictEqual(viability.rejectedParetoNondominated.length, 4);
  assert.strictEqual(viability.probeBudget.expansions, 8000);

  // Assert viability probe ran and recorded metrics
  for (const item of viability.selected.concat(viability.rejectedParetoNondominated)) {
    assert.strictEqual(typeof item.viability.legalPrimitiveActions, "number");
    assert.strictEqual(typeof item.viability.battleActions, "number");
    assert.ok(item.viability.probe, "missing probe results");
    assert.strictEqual(item.viability.probe.expansions, 8000);
  }

  process.stdout.write("PASS check-stage-boundary-candidate-quality: Q1 established (8 ATK7 discarded, 0/8 selected), Q1b established (4 omitted Pareto nondominated, 3 ATK7), Q2 probe recorded.\n");
}

runChecks();
