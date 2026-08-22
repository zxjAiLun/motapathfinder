"use strict";

/** TEST GRADE: closure */

/**
 * PR-5.20d Real OnlyUp MT1 route Go/No-Go gate checker.
 *
 * This is the decisive gate for the 5.20 line, so the checker is deliberately
 * unforgiving. It locks the SOURCE identity (this really is the real Only Up
 * project, starting where the project says the hero starts) and the PASS contract,
 * but it never locks route content, route length or monster order -- the search is
 * supposed to decide those, and pinning them would turn a discovery test into a
 * recorded-answer test.
 *
 * Single process, no worker pool, no disk frontier. A failure here is reported as
 * REAL_MT1_GATE_FAILED and means the 5.20 static promotion is frozen; it is not an
 * invitation to raise the cap or add another attribution round.
 */

const assert = require("node:assert");

const {
  MAX_EXPANDED_STATES,
  RSS_LIMIT_BYTES,
  TARGET_FLOOR_ID,
  WALL_LIMIT_MS,
  createNoStateChangeChoiceResolver,
  runOnlyUpMt1RealRouteGate,
  touchesDifficulty,
} = require("./lib/onlyup-mt1-real-route-gate");

const COMPACT_STDOUT_LIMIT = 5120;
const EXPECTED_TITLE = "Only Up";
const EXPECTED_START_FLOOR = "MT1";
const EXPECTED_START_X = 6;
const EXPECTED_START_Y = 7;

function main() {
  // --- unit contracts on the two guards -------------------------------------
  // Difficulty levers must be refused wherever they appear in an action.
  ["I581", "I582", "level0"].forEach((token) => {
    assert.strictEqual(
      touchesDifficulty({ kind: "event", eventId: token }),
      true,
      `${token} must be guarded`,
    );
    assert.strictEqual(
      touchesDifficulty({ kind: "event", nested: { deep: [`set:${token}`] } }),
      true,
      `${token} must be guarded when nested`,
    );
  });
  assert.strictEqual(touchesDifficulty({ kind: "battle", enemyId: "greenSlime" }), false);
  assert.strictEqual(touchesDifficulty(null), false);

  // The choice resolver may only take a unique no-state-change branch, and must
  // refuse rather than guess anywhere else. No coordinates, no option text.
  const resolver = createNoStateChangeChoiceResolver();
  const uniqueNoOp = resolver({ choices: [{ action: [] }, { action: [{ type: "setValue" }] }] });
  assert.ok(uniqueNoOp, "a unique no-op branch must be accepted");
  assert.deepStrictEqual(uniqueNoOp.action, []);
  assert.strictEqual(resolver.unresolved.length, 0);
  // Two no-op branches is ambiguous: refuse.
  assert.strictEqual(resolver({ choices: [{ action: [] }, { action: [] }] }), null);
  // No no-op branch at all: refuse.
  assert.strictEqual(
    resolver({ choices: [{ action: [{ type: "setValue" }] }, { action: [{ type: "hide" }] }] }),
    null,
  );
  assert.strictEqual(resolver({ choices: [] }), null);
  assert.strictEqual(resolver.unresolved.length, 3, "each refusal must be recorded");
  // A resolver that picked by option text would accept this; ours must not.
  const textResolver = createNoStateChangeChoiceResolver();
  assert.strictEqual(
    textResolver({
      choices: [
        { text: "取消", action: [{ type: "setValue" }] },
        { text: "确定", action: [{ type: "setValue" }] },
      ],
    }),
    null,
    "the resolver must not choose by option text",
  );

  // --- the gate itself -------------------------------------------------------
  const result = runOnlyUpMt1RealRouteGate({});

  // Source identity: this must be the real project, from its own declared start.
  assert.strictEqual(result.source.title, EXPECTED_TITLE, "wrong project loaded");
  assert.strictEqual(result.source.startFloorId, EXPECTED_START_FLOOR);
  assert.ok(result.source.startLoc, "start location must be reported");
  assert.strictEqual(result.source.startLoc.x, EXPECTED_START_X);
  assert.strictEqual(result.source.startLoc.y, EXPECTED_START_Y);
  assert.strictEqual(result.source.targetFloorId, TARGET_FLOOR_ID);
  assert.strictEqual(result.initial.floorId, EXPECTED_START_FLOOR);

  // Budget contract is fixed, not negotiable per run.
  assert.strictEqual(result.budget.maxExpandedStates, MAX_EXPANDED_STATES);
  assert.strictEqual(result.budget.maxExpandedStates, 50000);
  assert.strictEqual(result.budget.wallLimitMs, WALL_LIMIT_MS);
  assert.strictEqual(result.budget.wallLimitMs, 30000);
  assert.strictEqual(result.budget.rssLimitBytes, RSS_LIMIT_BYTES);
  assert.strictEqual(result.budget.rssLimitBytes, 256 * 1024 * 1024);

  assert.strictEqual(
    result.verdict,
    "REAL_MT1_GATE_PASSED",
    `REAL_MT1_GATE_FAILED (${result.failureReason}): 5.20 static promotion is frozen. ` +
      `metrics=${JSON.stringify(result.metrics)}`,
  );
  assert.strictEqual(result.failureReason, null);

  // Every PASS condition, asserted individually.
  assert.ok(result.routeLength > 0, "a route must exist");
  assert.ok(result.decisionCount > 0, "the route must contain real decisions");
  assert.strictEqual(result.searchFinal.floorId, TARGET_FLOOR_ID, "search must end on MT2");
  assert.strictEqual(result.replayFinal.floorId, TARGET_FLOOR_ID, "replay must end on MT2");
  assert.deepStrictEqual(result.mismatches, [], "strict replay must not diverge");
  ["hp", "atk", "def", "mdef", "exp", "lv"].forEach((key) => {
    assert.strictEqual(
      result.replayFinal.hero[key],
      result.searchFinal.hero[key],
      `replayed hero.${key} differs`,
    );
  });
  assert.deepStrictEqual(result.replayFinal.inventory, result.searchFinal.inventory);
  assert.deepStrictEqual(result.replayFinal.flags, result.searchFinal.flags);
  assert.deepStrictEqual(result.replayFinal.floorMutations, result.searchFinal.floorMutations);
  // The exact state key covers hero, inventory, flags AND floor mutations at once.
  assert.strictEqual(
    result.replayFinal.exactStateKey,
    result.searchFinal.exactStateKey,
    "replayed exact state key differs",
  );
  assert.ok(result.metrics.decisionsReplayed > 0, "decisions must be re-derived, not assumed");
  assert.strictEqual(
    result.metrics.decisionsReplayed,
    result.decisionCount,
    "every recorded decision must be replayed",
  );
  // No difficulty action was taken, and no required choice was guessed.
  assert.strictEqual(result.metrics.searchChoiceUnresolved, 0);
  assert.ok(
    Number.isInteger(result.metrics.difficultyGuardBlocked) &&
      result.metrics.difficultyGuardBlocked >= 0,
  );

  // All three budgets respected.
  assert.ok(
    result.metrics.expansions <= MAX_EXPANDED_STATES,
    `expansions ${result.metrics.expansions} exceeded ${MAX_EXPANDED_STATES}`,
  );
  assert.ok(
    result.metrics.wallMs < WALL_LIMIT_MS,
    `wall ${result.metrics.wallMs}ms exceeded ${WALL_LIMIT_MS}ms`,
  );
  assert.ok(
    result.metrics.peakRssMb * 1024 * 1024 < RSS_LIMIT_BYTES,
    `peak RSS ${result.metrics.peakRssMb}MB exceeded ${RSS_LIMIT_BYTES / (1024 * 1024)}MB`,
  );

  const compact = {
    status: "passed",
    schema: "motapathfinder.onlyup-mt1-real-route-gate-check.v1",
    verdict: result.verdict,
    source: result.source,
    initial: {
      floorId: result.initial.floorId,
      hero: result.initial.hero,
    },
    budget: {
      maxExpandedStates: result.budget.maxExpandedStates,
      wallLimitMs: result.budget.wallLimitMs,
      rssLimitMb: result.budget.rssLimitBytes / (1024 * 1024),
    },
    metrics: result.metrics,
    route: {
      totalEntries: result.routeLength,
      decisions: result.decisionCount,
      autoEntries: result.routeLength - result.decisionCount,
    },
    finalFloorId: result.searchFinal.floorId,
    finalHero: result.searchFinal.hero,
    strictReplay: {
      decisionsReplayed: result.metrics.decisionsReplayed,
      mismatches: result.mismatches,
      exactStateKeyIdentical: true,
    },
  };
  const serialized = `${JSON.stringify(compact, null, 2)}\n`;
  assert.ok(
    serialized.length < COMPACT_STDOUT_LIMIT,
    `compact stdout ${serialized.length}B exceeded ${COMPACT_STDOUT_LIMIT}B`,
  );
  process.stdout.write(serialized);
}

main();
