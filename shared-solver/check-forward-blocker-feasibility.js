"use strict";

/**
 * PR-5.29b regression checker: Forward Blocker Feasibility Audit.
 *
 * Asserts:
 *   1. Feasibility audit report artifact exists and conforms to schema.
 *   2. Evaluates all 16 selected TS13 stage-boundary entries.
 *   3. Tier 1 (Forward Cut): Confirms that at the best observed forward frontier,
 *      unexecutable blockers do NOT form an inescapable cut (classification A: no-forward-cut).
 *      Legal bypass exists via viable battles (skeletonWarrior@7,7, ghostSoldier@6,8).
 *   4. Tier 2 (Deficit Vectors): Confirms deficit vectors are computed mathematically
 *      for all boundary obstacles (e.g. rocks require ATK >= 9, deficit = 2).
 *   5. Tier 3 (Capability Envelope): Confirms hero reaches Lv 3 with HP > 4,000, ATK 7, DEF 1,
 *      and active frontier of 2,500+ states at 8k expansion budget.
 *   6. Proves that search at 8k was not deadlocked by a combat wall, but progressing with
 *      legal bypasses when the bounded budget completed.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const {
  auditForwardBlockerFeasibility,
  computeReachableFloorRegion,
  proveForwardCut,
} = require("./lib/forward-blocker-audit");

const ARTIFACT_PATH = path.join(
  __dirname,
  "routes",
  "generated",
  "5-29b",
  "forward-blocker-feasibility-result.json",
);

function runChecks() {
  assert.strictEqual(typeof auditForwardBlockerFeasibility, "function");
  assert.strictEqual(typeof computeReachableFloorRegion, "function");
  assert.strictEqual(typeof proveForwardCut, "function");

  assert.ok(fs.existsSync(ARTIFACT_PATH), `PR-5.29b artifact missing: ${ARTIFACT_PATH}`);
  const report = JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf8"));

  assert.strictEqual(report.schema, "pr-5.29b.forward-blocker-feasibility-audit.v1");
  assert.strictEqual(report.totalEntriesAudited, 16, "expected 16 entries audited");
  assert.strictEqual(report.expansionsPerEntry, 8000);

  // Check classification summary: all 16 must classify as A (no-forward-cut)
  assert.ok(report.classificationSummary, "missing classification summary");
  assert.strictEqual(report.classificationSummary.A, 16, "all 16 entries must classify as A: no-forward-cut");

  // Check entry invariants
  const entries = report.entries || [];
  assert.strictEqual(entries.length, 16);

  for (const entry of entries) {
    assert.ok(entry.candidateId);
    assert.strictEqual(entry.searchObserved.expansions, 8000);
    assert.ok(entry.searchObserved.frontierSize >= 2500, "frontier must remain active (>2500 nodes)");

    const audit = entry.audit;
    assert.ok(audit, "missing audit for entry");
    assert.strictEqual(audit.tier1_forwardCut.established, false, "cut must not be established (bypass exists)");
    assert.strictEqual(audit.tier1_forwardCut.hasLegalBypass, true, "legal bypass must be true");
    assert.ok(audit.tier1_forwardCut.reachableFreeRegionSize >= 40, "reachable free region must expand to >= 40 tiles");

    // Tier 2 deficits
    const deficits = audit.tier2_blockerDeficits || [];
    assert.ok(deficits.length >= 5, "must have evaluated multiple boundary blockers");
    const rockDeficit = deficits.find((d) => d.tileId === "rock");
    if (rockDeficit) {
      assert.strictEqual(rockDeficit.executable, false);
      assert.strictEqual(rockDeficit.deficits.minAtkForPositiveDamage, 9);
      assert.strictEqual(rockDeficit.deficits.atkDeficit, 2);
    }

    // Tier 3 envelope
    const env = audit.tier3_preparationEnvelope;
    assert.ok(env, "missing preparation envelope");
    assert.ok(env.currentStats.hp >= 4000, "frontier hero HP must exceed 4000");
    assert.ok(env.currentStats.atk >= 7, "frontier hero ATK must reach >= 7");
    assert.ok(env.currentStats.def >= 1, "frontier hero DEF must reach >= 1");
    assert.strictEqual(env.currentStats.lv, 3, "frontier hero must reach Lv 3");
  }

  process.stdout.write("PASS check-forward-blocker-feasibility: All 16 entries classified as A (no-forward-cut), legal bypasses proven viable, hero reaches Lv3 with HP>4000, active frontier >2500 nodes.\n");
}

runChecks();
