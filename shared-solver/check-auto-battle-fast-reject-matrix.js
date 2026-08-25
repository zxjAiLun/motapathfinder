"use strict";

/** TEST GRADE: integration-local */

/**
 * PR-5.22d1 Auto-Battle Safe Fast-Reject Adversarial Boundary Matrix.
 *
 * Verifies classifyAutoBattleFastReject against live FunctionBackedBattleResolver:
 * 1. Real OnlyUp project monsters under vanilla conditions (zero penetration, multi-turn damage, 1-shot 0-damage, defense immune).
 * 2. Injected special mechanics (first attack, vampire, multi-hit, repulse, guards) -> must fail-open to "unknown".
 * 3. Explicit I602 / I755 damage-reduction item counterexample regressions -> must fail-open to "unknown".
 * 4. Non-whitelisted items, combat flags, and equipment -> must fail-open to "unknown".
 *
 * HARD INVARIANTS:
 * - NO test vector uses synthetic mock booleans; authoritative oracle is live evaluateBattle().
 * - falseReject strictly equals 0 across all vectors.
 * - definitelyAccept is strictly forbidden.
 */

const path = require("node:path");
const assert = require("node:assert");
const { loadProject } = require("./lib/project-loader");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");

const PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");

function runAuthoritativeAdversarialMatrixTests() {
  const project = loadProject(PROJECT_ROOT);

  // Clone and inject synthetic test enemies into project for boundary testing
  const syntheticProject = {
    ...project,
    enemysById: {
      ...project.enemysById,
      SYN_FIRST_ATTACK: { id: "SYN_FIRST_ATTACK", name: "FirstAttacker", hp: 100, atk: 50, def: 10, special: [1] },
      SYN_VAMPIRE: { id: "SYN_VAMPIRE", name: "Vampire", hp: 100, atk: 50, def: 10, special: 11, value: 0.2 },
      SYN_TWOHIT: { id: "SYN_TWOHIT", name: "TwoHitter", hp: 100, atk: 50, def: 10, special: 4 },
      SYN_REPULSE: { id: "SYN_REPULSE", name: "Repulser", hp: 100, atk: 50, def: 10, repulse: true },
      SYN_GUARD: { id: "SYN_GUARD", name: "Guarded", hp: 100, atk: 50, def: 10, guards: [[1, 2, "greenSlime"]] },
      SYN_VANILLA_STRONG: { id: "SYN_VANILLA_STRONG", name: "VanillaStrong", hp: 150, atk: 30, def: 50, special: 0 },
      SYN_VANILLA_WEAK: { id: "SYN_VANILLA_WEAK", name: "VanillaWeak", hp: 50, atk: 10, def: 0, special: 0 },
    },
  };

  const battleResolver = new FunctionBackedBattleResolver(syntheticProject);

  const vectors = [
    // --- 1. Real & Synthetic Vanilla Negative Cases (Must Definitely Reject) ---
    {
      name: "Zero penetration on real bat (hero atk 1 <= bat def 1)",
      enemyId: "bat",
      hero: { hp: 1000, atk: 1, def: 0, mdef: 10 },
      flags: { autoBattle: 1, shiqu: 1 },
      inventory: { yellowKey: 1 },
      expectedFastVerdict: "definitelyReject",
    },
    {
      name: "Zero penetration equal (hero atk 50 <= SYN_VANILLA_STRONG def 50)",
      enemyId: "SYN_VANILLA_STRONG",
      hero: { hp: 1000, atk: 50, def: 20, mdef: 0 },
      flags: { autoBattle: 1 },
      inventory: { blueKey: 1 },
      expectedFastVerdict: "definitelyReject",
    },
    {
      name: "Multi-turn positive damage (hero atk 100 vs SYN_VANILLA_STRONG def 50, 3 turns, enemy deals 20 > 0 mdef)",
      enemyId: "SYN_VANILLA_STRONG",
      hero: { hp: 1000, atk: 100, def: 20, mdef: 0 },
      flags: { autoBattle: 1 },
      inventory: { redKey: 1 },
      expectedFastVerdict: "definitelyReject",
    },
    {
      name: "Multi-turn damage on real bigBat (hero atk 10 vs bigBat hp 99 atk 19 def 3, deals 266 > mdef 10)",
      enemyId: "bigBat",
      hero: { hp: 1000, atk: 10, def: 0, mdef: 10 },
      flags: { autoBattle: 1 },
      inventory: { steelKey: 1 },
      expectedFastVerdict: "definitelyReject",
    },

    // --- 2. Real & Synthetic Vanilla 0-Damage Cases (Must Return unknown, NEVER definitelyReject) ---
    {
      name: "1-shot 0-damage kill on greenSlime (hero atk 25 >= greenSlime hp 21 + def 0)",
      enemyId: "greenSlime",
      hero: { hp: 1000, atk: 25, def: 0, mdef: 0 },
      flags: { autoBattle: 1 },
      inventory: { yellowKey: 2 },
      expectedFastVerdict: "unknown",
      assertAuthoritativeDamageZero: true,
    },
    {
      name: "Total defense 0-damage (hero def 100 >= SYN_VANILLA_WEAK atk 10)",
      enemyId: "SYN_VANILLA_WEAK",
      hero: { hp: 1000, atk: 10, def: 100, mdef: 0 },
      flags: { autoBattle: 1 },
      inventory: { yellowKey: 1 },
      expectedFastVerdict: "unknown",
      assertAuthoritativeDamageZero: true,
    },
    {
      name: "Mdef absorbs all damage (turns 2, enemy raw damage 10 <= mdef 20)",
      enemyId: "SYN_VANILLA_STRONG",
      hero: { hp: 1000, atk: 100, def: 20, mdef: 20 },
      flags: { autoBattle: 1 },
      inventory: { greenKey: 1 },
      expectedFastVerdict: "unknown",
      assertAuthoritativeDamageZero: true,
    },

    // --- 3. Explicit I602 / Damage Reduction Counterexample Regressions ---
    {
      name: "EXPLICIT REGRESSION: I602 held reduces damage to 0 on otherwise positive battle -> must fail-open to unknown",
      enemyId: "SYN_VANILLA_STRONG", // without I602, damage is 20. With I602, damage -= (30+50)*1.6 = -108 -> 0!
      hero: { hp: 1000, atk: 100, def: 20, mdef: 0 },
      flags: { autoBattle: 1 },
      inventory: { I602: 1 },
      expectedFastVerdict: "unknown",
      assertAuthoritativeDamageZero: true,
    },
    {
      name: "EXPLICIT REGRESSION: I755 held (damage reduction) -> must fail-open to unknown",
      enemyId: "SYN_VANILLA_STRONG",
      hero: { hp: 1000, atk: 100, def: 20, mdef: 0 },
      flags: { autoBattle: 1 },
      inventory: { I755: 1 },
      expectedFastVerdict: "unknown",
    },
    {
      name: "Non-whitelisted item I821 (ascension) -> must fail-open to unknown",
      enemyId: "SYN_VANILLA_STRONG",
      hero: { hp: 1000, atk: 100, def: 20, mdef: 0 },
      flags: { autoBattle: 1 },
      inventory: { I821: 1 },
      expectedFastVerdict: "unknown",
    },
    {
      name: "Non-whitelisted item cross -> must fail-open to unknown",
      enemyId: "SYN_VANILLA_STRONG",
      hero: { hp: 1000, atk: 100, def: 20, mdef: 0 },
      flags: { autoBattle: 1 },
      inventory: { cross: 1 },
      expectedFastVerdict: "unknown",
    },

    // --- 4. Non-Whitelisted Flags, Equipment, and Buffs ---
    {
      name: "Non-whitelisted flag skill: 1 (double strike) -> must fail-open to unknown",
      enemyId: "SYN_VANILLA_STRONG",
      hero: { hp: 1000, atk: 30, def: 20, mdef: 0 },
      flags: { autoBattle: 1, skill: 1 },
      inventory: {},
      expectedFastVerdict: "unknown",
    },
    {
      name: "Non-whitelisted flag s113 (atk/def swap) -> must fail-open to unknown",
      enemyId: "SYN_VANILLA_STRONG",
      hero: { hp: 1000, atk: 10, def: 100, mdef: 0 },
      flags: { autoBattle: 1, s113: 1 },
      inventory: {},
      expectedFastVerdict: "unknown",
    },
    {
      name: "Non-whitelisted flag __atk_buff__: 2.0 -> must fail-open to unknown",
      enemyId: "SYN_VANILLA_STRONG",
      hero: { hp: 1000, atk: 30, def: 20, mdef: 0 },
      flags: { autoBattle: 1, __atk_buff__: 2.0 },
      inventory: {},
      expectedFastVerdict: "unknown",
    },
    {
      name: "State has equipment -> must fail-open to unknown",
      enemyId: "SYN_VANILLA_STRONG",
      hero: { hp: 1000, atk: 100, def: 20, mdef: 0 },
      flags: { autoBattle: 1 },
      inventory: {},
      equipment: ["I893"],
      expectedFastVerdict: "unknown",
    },

    // --- 5. Real & Synthetic Special Mechanics (All Must Fail-Open to unknown) ---
    {
      name: "Real slimelord has firstAttack (special 1) -> must fail-open to unknown",
      enemyId: "slimelord",
      hero: { hp: 1000, atk: 100, def: 20, mdef: 0 },
      flags: { autoBattle: 1 },
      inventory: {},
      expectedFastVerdict: "unknown",
    },
    {
      name: "Real redBat has magicAttack (special 2) -> must fail-open to unknown",
      enemyId: "redBat",
      hero: { hp: 1000, atk: 100, def: 20, mdef: 0 },
      flags: { autoBattle: 1 },
      inventory: {},
      expectedFastVerdict: "unknown",
    },
    {
      name: "Synthetic vampire (special 11) -> must fail-open to unknown",
      enemyId: "SYN_VAMPIRE",
      hero: { hp: 1000, atk: 100, def: 20, mdef: 0 },
      flags: { autoBattle: 1 },
      inventory: {},
      expectedFastVerdict: "unknown",
    },
    {
      name: "Synthetic twoHit (special 4) -> must fail-open to unknown",
      enemyId: "SYN_TWOHIT",
      hero: { hp: 1000, atk: 100, def: 20, mdef: 0 },
      flags: { autoBattle: 1 },
      inventory: {},
      expectedFastVerdict: "unknown",
    },
    {
      name: "Synthetic repulse hazard -> must fail-open to unknown",
      enemyId: "SYN_REPULSE",
      hero: { hp: 1000, atk: 100, def: 20, mdef: 0 },
      flags: { autoBattle: 1 },
      inventory: {},
      expectedFastVerdict: "unknown",
    },
    {
      name: "Synthetic guards present -> must fail-open to unknown",
      enemyId: "SYN_GUARD",
      hero: { hp: 1000, atk: 100, def: 20, mdef: 0 },
      flags: { autoBattle: 1 },
      inventory: {},
      expectedFastVerdict: "unknown",
    },
  ];

  let testsRun = 0;
  let falseRejects = 0;

  for (const v of vectors) {
    testsRun += 1;
    const state = {
      floorId: "MT1",
      hero: v.hero,
      flags: v.flags || {},
      inventory: v.inventory || {},
      equipment: v.equipment || [],
      floorStates: { MT1: { removed: [], replaced: {} } },
    };

    // 1. Run fast reject
    const fastVerdict = battleResolver.classifyAutoBattleFastReject(state, "MT1", 1, 1, v.enemyId);

    // Assert definitelyAccept is strictly forbidden
    assert.notStrictEqual(fastVerdict, "definitelyAccept", `Contract violation: ${v.name} returned definitelyAccept`);
    assert.strictEqual(fastVerdict, v.expectedFastVerdict, `Fast reject mismatch on [${v.name}]: expected ${v.expectedFastVerdict}, got ${fastVerdict}`);

    // 2. Run live authoritative evaluation
    const authoritativeResult = battleResolver.evaluateBattle(state, "MT1", 1, 1, v.enemyId);
    const isAuthoritativeZeroDamage = Boolean(
      authoritativeResult &&
      authoritativeResult.supported &&
      authoritativeResult.damageInfo &&
      Number(authoritativeResult.damageInfo.damage || 0) === 0
    );

    // If fast verdict says definitelyReject, authoritative evaluation MUST NOT be 0-damage!
    if (fastVerdict === "definitelyReject" && isAuthoritativeZeroDamage) {
      falseRejects += 1;
      assert.fail(`CRITICAL FALSE REJECT in [${v.name}]: fast reject claimed definitelyReject, but authoritative evaluateBattle returned 0 damage!`);
    }

    // Special check for explicit regression cases
    if (v.assertAuthoritativeDamageZero) {
      assert.strictEqual(isAuthoritativeZeroDamage, true, `Authoritative evaluation on [${v.name}] must result in 0 damage`);
    }
  }

  assert.strictEqual(falseRejects, 0, "falseReject must strictly equal 0 across all authoritative vectors");

  console.log(JSON.stringify({
    schema: "motapathfinder.auto-battle-fast-reject-safety-closure.v1",
    status: "passed",
    verdict: "AUTHORITATIVE_FAST_REJECT_MATRIX_PASSED",
    testsRun,
    falseRejects,
  }, null, 2));
}

if (require.main === module) {
  try {
    runAuthoritativeAdversarialMatrixTests();
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  }
}

module.exports = {
  runAuthoritativeAdversarialMatrixTests,
};
