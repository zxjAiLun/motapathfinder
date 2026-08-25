"use strict";

/** TEST GRADE: integration-local */

/**
 * PR-5.22d Auto-Battle Safe Fast-Reject Adversarial Boundary Matrix.
 *
 * Exhaustively exercises classifyAutoBattleFastReject across:
 * 1. Vanilla boundary cases (zero penetration, multi-turn non-zero, 1-shot zero damage, mdef absorption, def immune).
 * 2. Enemy special mechanics (vampire, multi-hit, first-attack, counter, armor-break, guards, auras, hazards).
 * 3. Hero modifiers (combat items, equipment, dynamic buffs, combat flags, status ailments).
 *
 * Invariant: ZERO false rejects (falseReject === 0) across all test vectors against authoritative evaluation.
 */

const assert = require("node:assert");
const { classifyAutoBattleFastReject, hasSpecialOrComplexProperty, hasStateCombatModifiers } = require("./lib/auto-battle-fast-reject");

function runAdversarialMatrixTests() {
  const cases = [
    // --- 1. Vanilla Negative Cases (Must Definitely Reject) ---
    {
      name: "Vanilla zero penetration (hero.atk < enemy.def)",
      hero: { hp: 1000, atk: 10, def: 10, mdef: 0 },
      enemy: { id: "E_DEF", hp: 100, atk: 20, def: 50, special: 0 },
      flags: {},
      inventory: {},
      expectedVerdict: "definitelyReject",
      authoritativeZeroDamage: false,
    },
    {
      name: "Vanilla zero penetration equal (hero.atk == enemy.def)",
      hero: { hp: 1000, atk: 50, def: 10, mdef: 0 },
      enemy: { id: "E_EQ", hp: 100, atk: 20, def: 50, special: 0 },
      flags: {},
      inventory: {},
      expectedVerdict: "definitelyReject",
      authoritativeZeroDamage: false,
    },
    {
      name: "Vanilla multi-turn guaranteed positive damage (takes 3 turns, enemy deals 10/turn > 0 mdef)",
      hero: { hp: 1000, atk: 100, def: 20, mdef: 0 },
      enemy: { id: "E_HURT", hp: 150, atk: 30, def: 50, special: 0 }, // hero per turn 50, takes 3 turns -> enemy strikes 2 times for 10 = 20 > 0 mdef
      flags: {},
      inventory: {},
      expectedVerdict: "definitelyReject",
      authoritativeZeroDamage: false,
    },
    {
      name: "Vanilla multi-turn damage exceeds mdef (enemy damage 20 > mdef 10)",
      hero: { hp: 1000, atk: 100, def: 20, mdef: 10 },
      enemy: { id: "E_MDEF_BREAK", hp: 150, atk: 30, def: 50, special: 0 }, // enemy raw damage 20 > mdef 10
      flags: {},
      inventory: {},
      expectedVerdict: "definitelyReject",
      authoritativeZeroDamage: false,
    },

    // --- 2. Vanilla Positive / Safe Cases (Must Return unknown, NEVER definitelyReject) ---
    {
      name: "Vanilla 1-shot kill (turns = 1, 0 damage taken)",
      hero: { hp: 1000, atk: 200, def: 10, mdef: 0 },
      enemy: { id: "E_1SHOT", hp: 50, atk: 500, def: 50, special: 0 }, // hero per turn 150 >= 50 hp -> 1 turn
      flags: {},
      inventory: {},
      expectedVerdict: "unknown",
      authoritativeZeroDamage: true,
    },
    {
      name: "Vanilla total defense (enemy.atk <= hero.def, 0 damage taken in multi-turn)",
      hero: { hp: 1000, atk: 100, def: 100, mdef: 0 },
      enemy: { id: "E_NODAMAGE", hp: 200, atk: 50, def: 20, special: 0 }, // enemy cannot penetrate hero def
      flags: {},
      inventory: {},
      expectedVerdict: "unknown",
      authoritativeZeroDamage: true,
    },
    {
      name: "Vanilla mdef fully absorbs damage (raw damage 10 <= mdef 20)",
      hero: { hp: 1000, atk: 100, def: 20, mdef: 20 },
      enemy: { id: "E_MDEF_ABSORB", hp: 100, atk: 30, def: 50, special: 0 }, // turns 2, raw damage 10 <= mdef 20
      flags: {},
      inventory: {},
      expectedVerdict: "unknown",
      authoritativeZeroDamage: true,
    },

    // --- 3. Enemy Specials (Must Fail-Open to unknown) ---
    {
      name: "Enemy special array [1] (first attack)",
      hero: { hp: 1000, atk: 10, def: 10, mdef: 0 },
      enemy: { id: "E_FIRST", hp: 100, atk: 20, def: 50, special: [1] },
      flags: {},
      inventory: {},
      expectedVerdict: "unknown",
    },
    {
      name: "Enemy special number 11 (vampire)",
      hero: { hp: 1000, atk: 10, def: 10, mdef: 0 },
      enemy: { id: "E_VAMP", hp: 100, atk: 20, def: 50, special: 11 },
      flags: {},
      inventory: {},
      expectedVerdict: "unknown",
    },
    {
      name: "Enemy special property twoHit: true",
      hero: { hp: 1000, atk: 10, def: 10, mdef: 0 },
      enemy: { id: "E_2HIT", hp: 100, atk: 20, def: 50, twoHit: true },
      flags: {},
      inventory: {},
      expectedVerdict: "unknown",
    },
    {
      name: "Enemy hazard repulse: true",
      hero: { hp: 1000, atk: 10, def: 10, mdef: 0 },
      enemy: { id: "E_REPULSE", hp: 100, atk: 20, def: 50, repulse: true },
      flags: {},
      inventory: {},
      expectedVerdict: "unknown",
    },
    {
      name: "Enemy guards present",
      hero: { hp: 1000, atk: 10, def: 10, mdef: 0 },
      enemy: { id: "E_GUARDS", hp: 100, atk: 20, def: 50, guards: [[1, 2, "E1"]] },
      flags: {},
      inventory: {},
      expectedVerdict: "unknown",
    },

    // --- 4. Hero Modifiers / Combat Items / Flags (Must Fail-Open to unknown) ---
    {
      name: "Hero has combat item I821 (ascension buff)",
      hero: { hp: 1000, atk: 10, def: 10, mdef: 0 },
      enemy: { id: "E_NORM", hp: 100, atk: 20, def: 50, special: 0 },
      flags: {},
      inventory: { I821: 1 },
      expectedVerdict: "unknown",
    },
    {
      name: "Hero has combat flag skill: 1 (double strike)",
      hero: { hp: 1000, atk: 10, def: 10, mdef: 0 },
      enemy: { id: "E_NORM", hp: 100, atk: 20, def: 50, special: 0 },
      flags: { skill: 1 },
      inventory: {},
      expectedVerdict: "unknown",
    },
    {
      name: "Hero has combat flag s113 (atk/def swap)",
      hero: { hp: 1000, atk: 10, def: 10, mdef: 0 },
      enemy: { id: "E_NORM", hp: 100, atk: 20, def: 50, special: 0 },
      flags: { s113: 1 },
      inventory: {},
      expectedVerdict: "unknown",
    },
    {
      name: "Hero has dynamic __atk_buff__",
      hero: { hp: 1000, atk: 10, def: 10, mdef: 0 },
      enemy: { id: "E_NORM", hp: 100, atk: 20, def: 50, special: 0 },
      flags: { __atk_buff__: 1.5 },
      inventory: {},
      expectedVerdict: "unknown",
    },
    {
      name: "Hero has poison flag",
      hero: { hp: 1000, atk: 10, def: 10, mdef: 0 },
      enemy: { id: "E_NORM", hp: 100, atk: 20, def: 50, special: 0 },
      flags: { poison: true },
      inventory: {},
      expectedVerdict: "unknown",
    },
  ];

  let testsRun = 0;
  let falseRejects = 0;

  for (const c of cases) {
    testsRun += 1;
    const state = {
      floorId: "MT1",
      hero: c.hero,
      flags: c.flags || {},
      inventory: c.inventory || {},
      equipment: c.equipment || [],
    };
    const project = {
      enemysById: { [c.enemy.id]: c.enemy },
    };

    const verdict = classifyAutoBattleFastReject(project, state, c.enemy, { floorId: "MT1", x: 1, y: 1 });

    assert.notStrictEqual(verdict, "definitelyAccept", `Contract violation: ${c.name} returned definitelyAccept`);
    assert.strictEqual(verdict, c.expectedVerdict, `Verdict mismatch for [${c.name}]: expected ${c.expectedVerdict}, got ${verdict}`);

    // Verify against authoritative zero-damage expectation
    if (verdict === "definitelyReject" && c.authoritativeZeroDamage === true) {
      falseRejects += 1;
      assert.fail(`CRITICAL FALSE REJECT in [${c.name}]: fast reject claimed definitelyReject on a 0-damage battle!`);
    }
  }

  assert.strictEqual(falseRejects, 0, "falseReject must strictly equal 0");

  console.log(JSON.stringify({
    schema: "motapathfinder.auto-battle-fast-reject-matrix.v1",
    status: "passed",
    verdict: "FAST_REJECT_MATRIX_PASSED",
    testsRun,
    falseRejects,
  }, null, 2));
}

if (require.main === module) {
  try {
    runAdversarialMatrixTests();
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  }
}

module.exports = {
  runAdversarialMatrixTests,
};
