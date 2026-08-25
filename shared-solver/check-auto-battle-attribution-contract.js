"use strict";

/** TEST GRADE: integration-local */

/**
 * PR-5.22c2 Auto-Battle Attribution Contract & Reverify Rejection Fixture.
 *
 * Objectives:
 * 1. Test measurement conservation on a synthetic auto-battle sequence.
 * 2. Deliberately construct a scenario where:
 *    - Battle #1 (E2) succeeds (triggering changed = true and state mutation).
 *    - Next target #2 (E3) in the loop fails reverification (state change makes it non-0-damage or unsupported).
 *    - Target #3 (E1) follows in the same pass.
 * 3. Verify that `hazardRebuildWithoutInterveningMutation` counter is properly incremented
 *    when target #3 is evaluated without intervening mutation after target #2's rejection.
 * 4. Ensure 100% contract adherence and demonstrate counter is live (not dead code).
 */

const assert = require("node:assert");
const { AutoActionResolver } = require("./lib/auto-actions");
const { createPerfTracker } = require("./lib/perf");

function runSyntheticReverifyRejectionTest() {
  const perfTracker = createPerfTracker({ enabled: true, profileExpansionCost: true });

  // Minimal synthetic project with 3 enemy tiles adjacent to hero (2,2)
  // Queue collection order: DIRECTIONS = ["up", "right", "down", "left"]
  // (3,2) Right -> E2 (first target processed in loop)
  // (2,3) Down  -> E3 (second target processed in loop)
  // (1,2) Left  -> E1 (third target processed in loop)
  const project = {
    floorsById: {
      MT1: {
        width: 5,
        height: 5,
        defaultTile: "0",
        map: [
          ["0", "0", "0", "0", "0"],
          ["0", "0", "0", "0", "0"],
          ["0", "201", "0", "202", "0"],
          ["0", "0", "203", "0", "0"],
          ["0", "0", "0", "0", "0"],
        ],
      },
    },
    mapTilesByNumber: {
      "201": { id: "E1", cls: "enemys", number: 201 },
      "202": { id: "E2", cls: "enemys", number: 202 },
      "203": { id: "E3", cls: "enemys", number: 203 },
    },
    enemysById: {
      E1: { id: "E1", name: "Slime", hp: 10, atk: 1, def: 0, money: 1, exp: 1 },
      E2: { id: "E2", name: "Magician", hp: 20, atk: 50, def: 0, money: 2, exp: 2 },
      E3: { id: "E3", name: "Bat", hp: 10, atk: 1, def: 0, money: 1, exp: 1 },
    },
  };

  const state = {
    floorId: "MT1",
    hero: {
      loc: { x: 2, y: 2, direction: "down" },
      hp: 1000,
      atk: 100,
      def: 100,
      mdef: 0,
      money: 0,
      exp: 0,
    },
    flags: {
      autoBattle: 1,
      shiqu: 0,
    },
    floorStates: {
      MT1: { removed: [], replaced: {} },
    },
    routes: [],
    notes: [],
  };

  // Mock battleResolver with state-dependent outcome
  const mockBattleResolver = {
    evaluateBattle(currentState, floorId, x, y, enemyId) {
      if (enemyId === "E2") {
        // Target 1: Always 0 damage (first to execute)
        return { supported: true, damageInfo: { damage: 0, turn: 1 } };
      }
      if (enemyId === "E3") {
        // Target 2: 0 damage initially in scan, but 50 damage after battle 1 mutates money (rejected on reverify!)
        if (state.hero.money > 0) {
          return { supported: true, damageInfo: { damage: 50, turn: 1 } };
        }
        return { supported: true, damageInfo: { damage: 0, turn: 1 } };
      }
      if (enemyId === "E1") {
        // Target 3: Always 0 damage (evaluated after E3 rejection -> triggers hazardRebuildWithoutInterveningMutation)
        return { supported: true, damageInfo: { damage: 0, turn: 1 } };
      }
      return { supported: false };
    },
    applyBattleAt(options) {
      const { enemyId } = options;
      state.hero.money += 1;
      if (enemyId === "E2") {
        state.floorStates.MT1.removed.push("3,2");
      } else if (enemyId === "E1") {
        state.floorStates.MT1.removed.push("1,2");
      }
    },
  };

  const resolver = new AutoActionResolver({
    autoPickupEnabled: false,
    autoBattleEnabled: true,
    repeatUntilStable: false,
  });

  const context = {
    project,
    state,
    battleResolver: mockBattleResolver,
    executeActionList: () => {},
    choiceResolver: () => {},
    perfTracker,
  };

  // Run auto-battle pass
  resolver.runAutoBattlePass(context, null);

  const snapshot = perfTracker.snapshot({
    expanded: 1,
    generated: 1,
    registered: 1,
    duplicates: 0,
    frontierSize: 1,
  });

  const counters = snapshot.expansionCost.timingDirectional.inclusiveSubsystems.stabilizeState.counters;

  // Assertions
  assert.ok(counters.battleCandidateChecks >= 3, "Should have checked at least 3 candidates");
  assert.strictEqual(counters.scanBattleResolverEvaluateCalls, 3, "Initial scan should evaluate 3 targets");
  assert.strictEqual(counters.reverifyBattleResolverEvaluateCalls, 2, "Target #2 (E3) and Target #3 (E1) should undergo reverification");
  assert.strictEqual(counters.battleReverificationCalls, 2, "Target #2 and Target #3 should undergo reverification calls");
  assert.strictEqual(counters.battleReverificationRejected, 1, "Target #2 (E3) should be rejected on reverify");
  assert.strictEqual(counters.hazardRebuildWithoutInterveningMutation, 1, "Target #3 (E1) should trigger hazardRebuildWithoutInterveningMutation = 1");
  assert.strictEqual(counters.battleApplyCalls, 2, "Target #1 (E2) and Target #3 (E1) should be applied");

  // Verify counter conservation
  assert.strictEqual(
    counters.battleCandidateChecks,
    counters.scanBattleCandidateChecks + counters.reverifyBattleCandidateChecks,
  );
  assert.strictEqual(
    counters.battleResolverEvaluateCalls,
    counters.scanBattleResolverEvaluateCalls + counters.reverifyBattleResolverEvaluateCalls,
  );
  assert.strictEqual(
    counters.reverifyBattleResolverEvaluateCalls,
    counters.reverifyBattleRejectedNonZeroDamage + counters.reverifyBattleAcceptedZeroDamage,
  );

  console.log(JSON.stringify({
    schema: "motapathfinder.auto-battle-attribution-contract.v1",
    status: "passed",
    verdict: "AUTO_BATTLE_ATTRIBUTION_CONTRACT_VERIFIED",
    verifiedCounters: {
      battleCandidateChecks: counters.battleCandidateChecks,
      scanBattleCandidateChecks: counters.scanBattleCandidateChecks,
      reverifyBattleCandidateChecks: counters.reverifyBattleCandidateChecks,
      scanBattleResolverEvaluateCalls: counters.scanBattleResolverEvaluateCalls,
      reverifyBattleResolverEvaluateCalls: counters.reverifyBattleResolverEvaluateCalls,
      battleReverificationCalls: counters.battleReverificationCalls,
      battleReverificationRejected: counters.battleReverificationRejected,
      hazardRebuildWithoutInterveningMutation: counters.hazardRebuildWithoutInterveningMutation,
      battleApplyCalls: counters.battleApplyCalls,
    },
  }, null, 2));
}

if (require.main === module) {
  try {
    runSyntheticReverifyRejectionTest();
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  }
}

module.exports = {
  runSyntheticReverifyRejectionTest,
};
