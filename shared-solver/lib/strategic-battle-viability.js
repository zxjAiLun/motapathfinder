"use strict";

/**
 * PR-5.19c observation-only battle viability deficit attribution.
 *
 * This module deliberately does not add any search capability. It is a small,
 * read-only classifier for an arbitrary access battle described by a boundary.
 * It splits the former battle-unsurvivable umbrella into:
 *
 *   unsupported     -> resolver cannot support/probe the enemy, or damage is
 *                      unresolved without evidence that ATK < DEF
 *   attack-blocked  -> supported and damage is null with a negative attack
 *                      margin (hero ATK < enemy DEF)
 *   lethal          -> supported and damage is known, but damage >= hero HP
 *   viable          -> supported and damage < hero HP
 *
 * The damage==null case is intentionally not treated as proven attack-blocked
 * when enemy DEF is unavailable or attackMargin >= 0; it is reported as
 * unsupported/unresolved so future compilers do not blindly add ATK.
 */

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function analyzeBattleViabilityBlocker(simulator, state, boundary) {
  const hero = (state && state.hero) || {};
  const heroHp = number(hero.hp, 0);
  const heroAtk = number(hero.atk, 0);

  if (!simulator || !simulator.battleResolver || typeof simulator.battleResolver.evaluateBattle !== "function") {
    return {
      stage: "unsupported",
      supported: false,
      heroHp,
      heroAtk,
      enemyDef: null,
      attackMargin: null,
      damage: null,
      survivalMargin: null,
      reason: "battle-resolver-unavailable",
    };
  }

  let evaluation;
  try {
    evaluation = simulator.battleResolver.evaluateBattle(
      state,
      boundary.floorId,
      boundary.x,
      boundary.y,
      boundary.enemyId,
    );
  } catch (error) {
    return {
      stage: "unsupported",
      supported: false,
      heroHp,
      heroAtk,
      enemyDef: null,
      attackMargin: null,
      damage: null,
      survivalMargin: null,
      reason: error && error.message ? error.message : "battle-evaluation-error",
    };
  }

  if (!evaluation || !evaluation.supported) {
    return {
      stage: "unsupported",
      supported: false,
      heroHp,
      heroAtk,
      enemyDef: null,
      attackMargin: null,
      damage: null,
      survivalMargin: null,
      reason: evaluation && evaluation.reason ? evaluation.reason : "unsupported-battle",
    };
  }

  const damageInfo = evaluation.damageInfo || {};
  const enemyInfo = evaluation.enemyInfo || {};
  const damage = damageInfo.damage == null ? null : number(damageInfo.damage, null);
  const enemyDef = enemyInfo.def == null ? null : number(enemyInfo.def, null);
  const attackMargin = enemyDef == null ? null : heroAtk - enemyDef;
  const survivalMargin = damage == null ? null : heroHp - damage;

  let stage;
  let reason = evaluation.reason ? evaluation.reason : null;
  if (damage != null) {
    if (damage >= heroHp) {
      stage = "lethal";
    } else {
      stage = "viable";
    }
  } else if (attackMargin != null && attackMargin < 0) {
    stage = "attack-blocked";
  } else {
    stage = "unsupported";
    reason = reason || "unresolved-no-damage";
  }

  return {
    stage,
    supported: true,
    heroHp,
    heroAtk,
    enemyDef,
    attackMargin,
    damage,
    survivalMargin,
    reason,
  };
}

module.exports = {
  analyzeBattleViabilityBlocker,
};
