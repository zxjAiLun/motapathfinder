"use strict";

/** TEST GRADE: local-regression */

/**
 * PR-5.23a Real First-Region (MT1 -> MT6) Production Requalification Gate.
 *
 * Runs the direct unaided first-region search from real MT1 start state to MT6 target
 * under full promoted production configuration:
 *   - autoBattleFastRejectEnabled: true (Promoted PR-5.22e)
 *   - enableFastHazardBlockIndex: true (Promoted PR-5.22g)
 *   - enableCompiledEffectCache: false (Rejected PR-5.22f, fail-closed native VM)
 *
 * Strict Fixed Budgets (Unchanged):
 *   - maxExpandedStates: 50,000
 *   - wallLimitMs: 30,000 (30s)
 *   - rssLimitBytes: 256 MB
 *   - start: REAL MT1 (x: 6, y: 7)
 *   - target: MT6
 *   - difficulty: CHAOS
 *   - route prefix: NONE
 */

const assert = require("node:assert");
const {
  EVIDENCE_SCHEMA,
  FIRST_REGION_TARGET_FLOOR_ID,
  MAX_EXPANDED_STATES,
  RSS_LIMIT_BYTES,
  WALL_LIMIT_MS,
  runOnlyUpFirstRegionRealRouteGate,
} = require("./lib/onlyup-mt1-real-route-gate");

const EXPECTED_TITLE = "Only Up";
const EXPECTED_START_FLOOR = "MT1";
const EXPECTED_START_X = 6;
const EXPECTED_START_Y = 7;
const CHAOS_DIFFICULTY = { I581: 0, I582: 0, "flag:level0": 0 };

function main() {
  const result = runOnlyUpFirstRegionRealRouteGate({
    autoBattleFastRejectEnabled: true,
    enableFastHazardBlockIndex: true,
    enableCompiledEffectCache: false,
  });

  // --- Gate contract integrity checks (independent of pass/fail) ---------------
  assert.strictEqual(result.evidenceSchema, EVIDENCE_SCHEMA);
  assert.strictEqual(result.targetFloorId, FIRST_REGION_TARGET_FLOOR_ID);
  assert.strictEqual(result.targetFloorId, "MT6");
  assert.strictEqual(result.source.title, EXPECTED_TITLE, "wrong project loaded");
  assert.strictEqual(result.source.startFloorId, EXPECTED_START_FLOOR, "must start on MT1");
  assert.strictEqual(result.source.startLoc.x, EXPECTED_START_X);
  assert.strictEqual(result.source.startLoc.y, EXPECTED_START_Y);
  assert.strictEqual(result.source.targetFloorId, "MT6");
  assert.strictEqual(result.initial.floorId, EXPECTED_START_FLOOR);
  assert.deepStrictEqual(
    result.initial.difficulty,
    CHAOS_DIFFICULTY,
    "the corpus must start on Chaos difficulty"
  );
  assert.strictEqual(result.initial.accounting.decisionDepth, 0);
  assert.strictEqual(
    result.initial.accounting.rawRouteLength,
    result.initial.accounting.autoStepCount
  );
  assert.strictEqual(result.metrics.searchChoiceUnresolved, 0);

  // Budget invariance
  assert.strictEqual(result.budget.maxExpandedStates, MAX_EXPANDED_STATES);
  assert.strictEqual(result.budget.maxExpandedStates, 50000);
  assert.strictEqual(result.budget.wallLimitMs, WALL_LIMIT_MS);
  assert.strictEqual(result.budget.wallLimitMs, 30000);
  assert.strictEqual(result.budget.rssLimitBytes, RSS_LIMIT_BYTES);
  assert.strictEqual(result.budget.rssLimitBytes, 256 * 1048576);

  assert.ok(
    result.verdict === "REAL_FIRST_REGION_GATE_PASSED" ||
    result.verdict === "REAL_FIRST_REGION_GATE_FAILED",
    `Unexpected gate verdict: ${result.verdict}`
  );

  const isPassed = result.verdict === "REAL_FIRST_REGION_GATE_PASSED";

  if (isPassed) {
    // If passed, enforce strict replay invariants and identity accounting
    assert.strictEqual(result.failureReason, null);
    assert.strictEqual(result.searchFinal.floorId, "MT6");
    assert.strictEqual(result.replayFinal.floorId, "MT6");
    assert.deepStrictEqual(result.mismatches, []);
    assert.strictEqual(result.searchFinal.exactStateKey, result.replayFinal.exactStateKey);
    assert.strictEqual(result.metrics.searchRawRouteLength, result.metrics.replayRawRouteLength);
    assert.strictEqual(
      result.metrics.identityGradedDecisionCount,
      result.metrics.decisionsReplayed
    );
  } else {
    // Strict contract for the expected current production failure outcome
    assert.strictEqual(result.verdict, "REAL_FIRST_REGION_GATE_FAILED");
    assert.strictEqual(
      result.failureReason,
      "RESOURCE_LIMIT",
      `Expected failureReason RESOURCE_LIMIT, got ${result.failureReason}`
    );
    assert.ok(
      ["rss", "wall"].includes(result.bindingConstraint),
      `Binding constraint must be rss or wall, got ${result.bindingConstraint}`
    );
    assert.ok(
      result.metrics.expansions < MAX_EXPANDED_STATES / 10,
      `Expansions (${result.metrics.expansions}) must not be the limiting constraint (cap: ${MAX_EXPANDED_STATES})`
    );
    assert.ok(result.bestProgress, "bestProgress state snapshot must be present");
    assert.strictEqual(
      result.bestProgress.floorId,
      "MT2",
      `Expected deepest progress on MT2, got ${result.bestProgress.floorId}`
    );
    assert.strictEqual(result.searchFinal, undefined);
    assert.strictEqual(result.replayFinal, undefined);

    if (result.bindingConstraint === "rss") {
      assert.ok(
        result.metrics.peakRssMb * 1048576 >= RSS_LIMIT_BYTES,
        `Peak RSS (${result.metrics.peakRssMb} MB) must reach or exceed ${RSS_LIMIT_BYTES / 1048576} MB`
      );
    } else {
      assert.ok(
        result.metrics.wallMs >= WALL_LIMIT_MS,
        `Wall time (${result.metrics.wallMs} ms) must reach or exceed ${WALL_LIMIT_MS} ms`
      );
    }
  }

  const summary = {
    schema: "motapathfinder.first-region-production-requalification.v1",
    contractStatus: "passed",
    capabilityVerdict: result.verdict,
    capabilityPassed: isPassed,
    failureReason: result.failureReason || null,
    bindingConstraint: result.bindingConstraint || null,
    capNotRaised: true,
    routePrefixUsed: false,
    stitchingUsed: false,
    initial: {
      floorId: result.initial.floorId,
      difficulty: result.initial.difficulty,
      accounting: result.initial.accounting,
    },
    productionConfiguration: {
      autoBattleFastRejectEnabled: true,
      enableFastHazardBlockIndex: true,
      enableCompiledEffectCache: false,
    },
    budget: {
      maxExpandedStates: result.budget.maxExpandedStates,
      wallLimitMs: result.budget.wallLimitMs,
      rssLimitBytes: result.budget.rssLimitBytes,
    },
    metrics: result.metrics,
    bestProgress: result.bestProgress ? {
      floorId: result.bestProgress.floorId,
      hero: result.bestProgress.hero,
      accounting: result.bestProgress.accounting,
      flags: result.bestProgress.flags,
    } : null,
  };

  console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  }
}

module.exports = {
  main,
};
