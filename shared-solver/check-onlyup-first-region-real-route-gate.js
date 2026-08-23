"use strict";

/** TEST GRADE: integration-local */

/**
 * PR-5.21a Real OnlyUp first-region (MT1 -> MT6) direct gate checker.
 *
 * ONE direct search. It does not solve MT2/MT3/MT4/MT5 first and it does not stitch
 * intermediate results into an MT6 route: the question is whether the existing
 * canonical DP reaches MT6 unaided from the real MT1 start state inside the same
 * fixed budget the MT2 gate used.
 *
 * This checker validates the GATE and freezes the RESULT. The current frozen result
 * is a FAILURE -- REAL_FIRST_REGION_GATE_FAILED / RESOURCE_LIMIT, binding constraint
 * RSS -- and that is recorded as data, not smoothed over. The checker therefore
 * exits 0 when the gate behaves correctly and reports the truth; it fails only if
 * the gate's own contract is violated (wrong project, tampered budget, or a PASS
 * that cannot survive strict replay).
 *
 * Per the round's authorization: no cap may be raised, and searchDP / simulator /
 * battle / event runtime may not be touched to make this pass.
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

const COMPACT_STDOUT_LIMIT = 5120;
const EXPECTED_TITLE = "Only Up";
const EXPECTED_START_FLOOR = "MT1";
const EXPECTED_START_X = 6;
const EXPECTED_START_Y = 7;
const CHAOS_DIFFICULTY = { I581: 0, I582: 0, "flag:level0": 0 };

// Frozen outcome for this corpus at this budget. If a future change genuinely makes
// MT6 reachable, this expectation must be re-baselined DELIBERATELY rather than
// loosened in passing.
const FROZEN_VERDICT = "REAL_FIRST_REGION_GATE_FAILED";
const FROZEN_FAILURE_REASON = "RESOURCE_LIMIT";
// RSS and the 30s wall trip almost simultaneously on this corpus, so which one wins
// varies run to run (observed: rss @849-2127 expansions, wall @2706). What is stable
// -- and what actually matters -- is that the EXPANSION cap is never the limiter.
const FROZEN_BINDING_CONSTRAINTS = ["rss", "wall"];
const FROZEN_DEEPEST_FLOOR = "MT2";

function main() {
  const result = runOnlyUpFirstRegionRealRouteGate({});

  // --- gate contract, independent of the outcome -----------------------------
  assert.strictEqual(result.evidenceSchema, EVIDENCE_SCHEMA);
  assert.strictEqual(result.targetFloorId, FIRST_REGION_TARGET_FLOOR_ID);
  assert.strictEqual(result.targetFloorId, "MT6");
  assert.strictEqual(result.source.title, EXPECTED_TITLE, "wrong project loaded");
  assert.strictEqual(result.source.startFloorId, EXPECTED_START_FLOOR, "must start on MT1");
  assert.strictEqual(result.source.startLoc.x, EXPECTED_START_X);
  assert.strictEqual(result.source.startLoc.y, EXPECTED_START_Y);
  assert.strictEqual(result.source.targetFloorId, "MT6");
  assert.strictEqual(result.initial.floorId, EXPECTED_START_FLOOR);
  // Always from the real firstData start state: never a checkpoint or route prefix.
  assert.deepStrictEqual(
    result.initial.difficulty,
    CHAOS_DIFFICULTY,
    "the corpus must start on Chaos difficulty",
  );
  // "No route prefix" means no DECISIONS have been taken. The real initial state is
  // not empty: createInitialState runs firstArrive and auto stabilization, so its
  // raw route legitimately holds those auto steps and nothing else.
  assert.strictEqual(result.initial.accounting.decisionDepth, 0, "must start at decision depth 0");
  assert.strictEqual(
    result.initial.accounting.rawRouteLength,
    result.initial.accounting.autoStepCount,
    "every initial route entry must be an auto stabilization step, never a decision",
  );

  // The budget is the SAME one the MT2 gate passed under, and must not be raised.
  assert.strictEqual(result.budget.maxExpandedStates, MAX_EXPANDED_STATES);
  assert.strictEqual(result.budget.maxExpandedStates, 50000);
  assert.strictEqual(result.budget.wallLimitMs, WALL_LIMIT_MS);
  assert.strictEqual(result.budget.wallLimitMs, 30000);
  assert.strictEqual(result.budget.rssLimitBytes, RSS_LIMIT_BYTES);
  assert.strictEqual(result.budget.rssLimitBytes, 256 * 1024 * 1024);
  // No difficulty lever was used, and no required choice was guessed.
  assert.ok(
    Number.isInteger(result.metrics.difficultyGuardBlocked) && result.metrics.difficultyGuardBlocked >= 0,
    "difficultyGuardBlocked must be a non-negative integer",
  );
  assert.strictEqual(result.metrics.searchChoiceUnresolved, 0);

  assert.ok(
    result.verdict === "REAL_FIRST_REGION_GATE_PASSED" ||
      result.verdict === "REAL_FIRST_REGION_GATE_FAILED",
    `unexpected verdict ${result.verdict}`,
  );

  if (result.verdict === "REAL_FIRST_REGION_GATE_PASSED") {
    // Should MT6 ever become reachable, it only counts under the full contract.
    assert.strictEqual(result.searchFinal.floorId, "MT6");
    assert.strictEqual(result.replayFinal.floorId, "MT6");
    assert.deepStrictEqual(result.mismatches, []);
    assert.strictEqual(result.replayFinal.exactStateKey, result.searchFinal.exactStateKey);
    assert.deepStrictEqual(result.replayFinal.difficulty, CHAOS_DIFFICULTY);
    assert.strictEqual(
      result.metrics.identityGradedDecisionCount,
      result.metrics.decisionsReplayed,
    );
    assert.strictEqual(result.metrics.searchRawRouteLength, result.metrics.replayRawRouteLength);
    assert.fail(
      "MT6 is now reachable: this is a real capability change, so re-baseline the " +
        "frozen first-region expectation deliberately instead of letting it drift.",
    );
  }

  // --- frozen failure, reported honestly -------------------------------------
  assert.strictEqual(result.verdict, FROZEN_VERDICT);
  assert.strictEqual(result.failureReason, FROZEN_FAILURE_REASON);
  assert.ok(
    FROZEN_BINDING_CONSTRAINTS.includes(result.bindingConstraint),
    `binding constraint changed to ${result.bindingConstraint}; expected one of ` +
      FROZEN_BINDING_CONSTRAINTS.join("/"),
  );
  // The decisive fact: the expansion cap is NOT what stopped it. Memory and wall
  // clock run out with the cap barely touched, so "raise maxExpandedStates" would
  // not help and is not authorized anyway.
  assert.ok(
    result.metrics.expansions < MAX_EXPANDED_STATES / 10,
    `expansions ${result.metrics.expansions} should be far below the ${MAX_EXPANDED_STATES} cap`,
  );
  if (result.bindingConstraint === "rss") {
    assert.ok(
      result.metrics.peakRssMb * 1024 * 1024 >= RSS_LIMIT_BYTES,
      "an rss-bound failure must actually have reached the rss ceiling",
    );
  } else {
    assert.ok(
      result.metrics.wallMs >= WALL_LIMIT_MS,
      "a wall-bound failure must actually have reached the wall limit",
    );
  }
  assert.ok(result.bestProgress || result.bestSeen, "a failed gate must still report its best progress or best seen state");
  const progressState = result.bestProgress || result.bestSeen;
  assert.strictEqual(
    progressState.floorId,
    FROZEN_DEEPEST_FLOOR,
    `deepest reached floor changed to ${progressState.floorId}`,
  );
  assert.deepStrictEqual(
    progressState.difficulty,
    CHAOS_DIFFICULTY,
    "even the best progress state must not have drifted difficulty",
  );
  // Nothing was replayed, because there is no route to replay.
  assert.strictEqual(result.searchFinal, undefined);
  assert.strictEqual(result.replayFinal, undefined);

  const compact = {
    status: "passed",
    schema: "motapathfinder.onlyup-first-region-real-route-gate-check.v1",
    evidenceSchema: result.evidenceSchema,
    note: "gate contract verified; MT6 outcome frozen as a real failure",
    verdict: result.verdict,
    failureReason: result.failureReason,
    bindingConstraint: result.bindingConstraint,
    source: result.source,
    initial: {
      floorId: result.initial.floorId,
      hero: result.initial.hero,
      difficulty: result.initial.difficulty,
    },
    budget: {
      maxExpandedStates: result.budget.maxExpandedStates,
      wallLimitMs: result.budget.wallLimitMs,
      rssLimitMb: result.budget.rssLimitBytes / (1024 * 1024),
    },
    metrics: result.metrics,
    bestProgress: {
      floorId: progressState.floorId,
      hero: progressState.hero,
      difficulty: progressState.difficulty,
      accounting: progressState.accounting,
    },
    observedVariance: {
      note: "environmental variance across runs; expansion cap never binds",
      bindingConstraintsSeen: FROZEN_BINDING_CONSTRAINTS,
      expansionsObservedRange: "849-2706",
    },
    capNotRaised: true,
    stitchingUsed: false,
    intermediateTargetsUsed: false,
  };
  const serialized = `${JSON.stringify(compact, null, 2)}\n`;
  assert.ok(
    serialized.length < COMPACT_STDOUT_LIMIT,
    `compact stdout ${serialized.length}B exceeded ${COMPACT_STDOUT_LIMIT}B`,
  );
  process.stdout.write(serialized);
}

main();
