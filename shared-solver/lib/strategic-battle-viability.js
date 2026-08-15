"use strict";

/**
 * PR-5.19c observation-only battle viability deficit attribution.
 *
 * This module deliberately does not add any search capability. It is a small,
 * read-only classifier for an arbitrary access battle described by a boundary.
 * It splits the former battle-unsurvivable umbrella into:
 *
 *   unsupported     -> battle resolver does not support/probe the enemy
 *   attack-blocked  -> supported, but no damage can be dealt (damage == null)
 *   lethal          -> supported and damage is known, but damage >= hero HP
 *   viable          -> supported and damage < hero HP
 */

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function analyzeBattleViabilityBlocker(simulator, state, boundary) {
  if (!simulator || !simulator.battleResolver || typeof simulator.battleResolver.evaluateBattle !== "function") {
    return {
      stage: "unsupported",
      supported: false,
      attackMargin: null,
      damage: null,
      heroHp: null,
      survivalMargin: null,
      enemyDef: null,
      reason: "battle-resolver-unavailable",
    };
  }

  const hero = (state && state.hero) || {};
  const heroHp = number(hero.hp, 0);
  const heroAtk = number(hero.atk, 0);
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
      attackMargin: null,
      damage: null,
      heroHp,
      survivalMargin: null,
      enemyDef: null,
      reason: error && error.message ? error.message : "battle-evaluation-error",
    };
  }

  if (!evaluation || !evaluation.supported) {
    return {
      stage: "unsupported",
      supported: false,
      attackMargin: null,
      damage: null,
      heroHp,
      survivalMargin: null,
      enemyDef: null,
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
  if (damage == null) {
    stage = "attack-blocked";
  } else if (damage >= heroHp) {
    stage = "lethal";
  } else {
    stage = "viable";
  }

  return {
    stage,
    supported: true,
    attackMargin,
    damage,
    heroHp,
    survivalMargin,
    enemyDef,
    reason: evaluation.reason ? evaluation.reason : null,
  };
}

module.exports = {
  analyzeBattleViabilityBlocker,
};
