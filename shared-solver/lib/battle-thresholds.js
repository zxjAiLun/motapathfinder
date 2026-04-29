"use strict";

const { formatEnemyLabel, getEnemyName } = require("./enemy-labels");
const { cloneState } = require("./state");

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function hasSpecial(special, test) {
  if (special == null) return false;
  if (Array.isArray(special)) return special.includes(test);
  if (typeof special === "number") return special === test;
  if (typeof special === "object" && special.special != null) return hasSpecial(special.special, test);
  return false;
}

function parseBattleSummary(summary) {
  const match = /^battle:([^@]+)@([^:]+):(\d+),(\d+)$/.exec(String(summary || ""));
  if (!match) return null;
  return {
    enemyId: match[1],
    floorId: match[2],
    x: Number(match[3]),
    y: Number(match[4]),
  };
}

function normalizeTarget(actionOrTarget) {
  if (!actionOrTarget) return null;
  if (typeof actionOrTarget === "string") return parseBattleSummary(actionOrTarget);
  if (actionOrTarget.summary) {
    const parsed = parseBattleSummary(actionOrTarget.summary);
    if (parsed) return parsed;
  }
  const target = actionOrTarget.target || actionOrTarget;
  const floorId = actionOrTarget.floorId || target.floorId;
  const x = target.x != null ? Number(target.x) : Number(actionOrTarget.x);
  const y = target.y != null ? Number(target.y) : Number(actionOrTarget.y);
  const enemyId = actionOrTarget.enemyId || target.enemyId;
  if (!floorId || !enemyId || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { floorId, x, y, enemyId };
}

function evaluateAtHp(simulator, state, target, hp) {
  if (!simulator || !simulator.battleResolver || typeof simulator.battleResolver.evaluateBattle !== "function") return null;
  const next = cloneState(state);
  next.hero = next.hero || {};
  next.hero.hp = Math.max(1, Math.floor(number(hp, 1)));
  try {
    const battle = simulator.battleResolver.evaluateBattle(next, target.floorId, target.x, target.y, target.enemyId);
    if (!battle || !battle.supported || !battle.damageInfo || battle.damageInfo.damage == null) {
      return {
        supported: false,
        reason: battle && battle.reason,
        battle,
      };
    }
    const damage = number(battle.damageInfo.damage, Number.POSITIVE_INFINITY);
    return {
      supported: true,
      hp: next.hero.hp,
      damage,
      turn: number(battle.damageInfo.turn, 0),
      survivable: next.hero.hp > damage,
      battle,
    };
  } catch (error) {
    return {
      supported: false,
      reason: error && error.message ? error.message : String(error),
    };
  }
}

function compactSample(sample) {
  if (!sample) return null;
  return {
    hp: sample.hp,
    damage: sample.damage,
    turn: sample.turn,
    survivable: sample.survivable,
  };
}

function estimateMinHpToSurvive(simulator, state, target, current, options) {
  const config = options || {};
  const maxHp = Math.max(1, number(config.maxHp, 1000000000));
  if (!current || !current.supported || !Number.isFinite(current.damage)) return { minHpToSurvive: null, samples: [] };
  if (current.survivable) return { minHpToSurvive: current.hp, samples: [compactSample(current)] };

  const samples = [compactSample(current)];
  let low = Math.max(1, Math.floor(current.hp));
  let high = Math.max(low + 1, low * 2);
  let previousDamage = current.damage;
  let nonMonotonic = false;

  while (high <= maxHp) {
    const probe = evaluateAtHp(simulator, state, target, high);
    if (!probe || !probe.supported || !Number.isFinite(probe.damage)) {
      return { minHpToSurvive: null, samples, nonMonotonic: false };
    }
    samples.push(compactSample(probe));
    if (probe.damage > previousDamage) nonMonotonic = true;
    previousDamage = probe.damage;
    if (probe.survivable) break;
    low = high;
    high *= 2;
  }

  if (nonMonotonic || high > maxHp) {
    return { minHpToSurvive: null, samples, nonMonotonic };
  }

  let best = high;
  while (low + 1 < high) {
    const mid = Math.floor((low + high) / 2);
    const probe = evaluateAtHp(simulator, state, target, mid);
    if (!probe || !probe.supported || !Number.isFinite(probe.damage)) {
      return { minHpToSurvive: null, samples, nonMonotonic: false };
    }
    if (probe.survivable) {
      best = mid;
      high = mid;
    } else {
      low = mid;
    }
  }
  samples.push(compactSample(evaluateAtHp(simulator, state, target, best)));
  return {
    minHpToSurvive: best,
    samples: samples.filter(Boolean),
    nonMonotonic: false,
  };
}

function estimateBattleSurvivability(simulator, state, actionOrTarget, options) {
  const config = options || {};
  const target = normalizeTarget(actionOrTarget);
  if (!target) {
    return {
      supported: false,
      reason: "missing-battle-target",
    };
  }

  const currentHp = number(((state || {}).hero || {}).hp, 0);
  const current = evaluateAtHp(simulator, state, target, currentHp);
  if (!current || !current.supported) {
    return {
      supported: false,
      ...target,
      reason: current && current.reason,
    };
  }

  const enemy = current.battle && current.battle.enemy;
  const riskTags = [];
  if (hasSpecial(enemy && enemy.special, 80)) {
    riskTags.push("life-limit", "hp-scaled-damage");
  }

  const threshold = config.skipMinHp
    ? { minHpToSurvive: null, samples: [compactSample(current)].filter(Boolean), nonMonotonic: false }
    : estimateMinHpToSurvive(simulator, state, target, current, config);
  const enemyName = getEnemyName(simulator && simulator.project, target.enemyId);
  return {
    supported: true,
    ...target,
    enemyName,
    enemyLabel: formatEnemyLabel(simulator && simulator.project, target.enemyId),
    currentHp,
    currentDamage: current.damage,
    currentTurn: current.turn,
    damage: current.damage,
    turn: current.turn,
    survivable: current.survivable,
    minHpToSurvive: threshold.minHpToSurvive,
    riskTags,
    special: enemy && enemy.special,
    nonMonotonic: Boolean(threshold.nonMonotonic),
    samples: threshold.samples || [compactSample(current)].filter(Boolean),
  };
}

module.exports = {
  estimateBattleSurvivability,
  parseBattleSummary,
};
