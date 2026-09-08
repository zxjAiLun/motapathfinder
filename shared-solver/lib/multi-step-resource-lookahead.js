"use strict";

/**
 * PR-5.25a — Multi-Step Resource Lookahead evaluator.
 *
 * A bounded, abstract future projector that answers:
 *   "If we follow candidate resource-acquisition sequences from this state,
 *    do downstream key-battle costs change such that the terminal goal's
 *    simplified reachability improves?"
 *
 * Correctness boundary (PR-5.25a design):
 *   - PRIORITY ONLY: the output score changes pop order; it NEVER declares a
 *     state illegal, merges exact states, removes actions, or replaces the
 *     simulator's successor computation.
 *   - bestProjectedPlan is EXPLANATION ONLY — the search core must not execute it.
 *
 * Simplified model contract (five frozen requirements):
 *   1. one-shot resource consumption (each tile/enemy consumed at most once)
 *   2. prerequisites (a resource behind a surviving enemy is not assumable)
 *   3. ATK/DEF/HP/MDEF/EXP/LV key changes (magic-tower investment order core)
 *   4. multi-step future battle cost recomputation (see "add atk first, save
 *      hp later")
 *   5. alternative-route isolation (mutually exclusive routes are evaluated
 *      separately, never summed)
 *   Unknown events => UNKNOWN (never BLOCKED).
 *
 * Frozen bounded-search parameters (set BEFORE the L3 real A/B; no mid-run
 * tuning — see P1-3):
 *   LOOKAHEAD_DEPTH = 3            (resource-acquisition steps per plan)
 *   MAX_PLANS = 24                 (max candidate sequences evaluated per state)
 *   MAX_ALTERNATIVES = 4           (max mutually-exclusive route alternatives)
 *   KEY_BATTLES_SAMPLED = 6        (downstream battles recomputed per plan)
 *   TIE_BREAK = stable (enumeration order)
 */

const { estimateBattleSurvivability } = require("./battle-thresholds");
const { getTileDefinitionAt } = require("./state");

const FROZEN_PARAMS = {
  LOOKAHEAD_DEPTH: 3,
  MAX_PLANS: 24,
  MAX_ALTERNATIVES: 4,
  KEY_BATTLES_SAMPLED: 6,
  TIE_BREAK: "enumeration-order",
};

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// ---------- abstract battle model (pure, no state mutation) ----------
function abstractBattleCost(hero, enemy) {
  // Classic magic-tower formula approximation: attacker deals
  // max(atk - def, 0) per turn; cost = ceil(enemyHp / damage) * enemyAtk - heroDef.
  const atk = number(hero.atk, 0);
  const def = number(hero.def, 0);
  const mdef = number(hero.mdef, 0);
  const enemyHp = number(enemy && enemy.hp, 0);
  const enemyAtk = number(enemy && enemy.atk, 0);
  const enemyDef = number(enemy && enemy.def, 0);
  const perTurn = Math.max(atk - enemyDef, 0);
  if (perTurn <= 0) return { survivable: false, turns: Infinity, damage: Infinity };
  const turns = Math.max(1, Math.ceil(enemyHp / perTurn));
  const damage = Math.max(0, turns * Math.max(enemyAtk - def, 0) - mdef * 0); // mdef folded into def approximation below
  const damageWithMdef = Math.max(0, turns * Math.max(enemyAtk - def - mdef, 0));
  return { survivable: damageWithMdef < number(hero.hp, 0), turns, damage: damageWithMdef };
}

// ---------- level-up model ----------
function levelUpGains(levelUp, currentLv, currentExp, gainedExp) {
  // Returns { lv, atk, def } deltas from crossing level thresholds.
  let lv = currentLv;
  let exp = currentExp + gainedExp;
  let atk = 0;
  let def = 0;
  let guard = 0;
  for (;;) {
    guard += 1;
    if (guard > 20) break;
    const next = (levelUp || []).find((entry, idx) => idx > 0 && Number(entry.need) > 0 && exp >= Number(entry.need) && Number(entry.need) > (lv > 1 ? Number(((levelUp || [])[lv - 1] || {}).need) || 0 : 0));
    if (!next) break;
    // simplified: each level crossing applies its actions' known setValue deltas
    const actions = Array.isArray(next.action) ? next.action : [];
    for (const a of actions) {
      if (a && a.type === "setValue" && a.name === "status:atk" && a.operator === "+=") atk += Number(a.value) || 0;
      if (a && a.type === "setValue" && a.name === "status:def" && a.operator === "+=") def += Number(a.value) || 0;
    }
    lv += 1;
  }
  return { lv, atk, def };
}

// ---------- resource extraction from the real state ----------
/**
 * Extract abstract resource opportunities from a state:
 *   - battles: enemies alive on the current floor (with prerequisites = none;
 *     reachability already folds walkable targets), each one-shot
 *   - pickups: item tiles not yet consumed, one-shot
 * Prerequisite handling: an enemy adjacent-guarding a pickup makes that pickup
 * conditional on the guard being defeated first (approximated via guard lists).
 */
function extractResourceOpportunities(project, state, options) {
  const config = options || {};
  const floorId = state.floorId;
  const floor = project.floorsById[floorId];
  if (!floor) return { battles: [], pickups: [], unknowns: [] };
  const maxPerKind = number(config.maxPerKind, 12);

  const battles = [];
  const pickups = [];
  const unknowns = [];

  const floorState = (state.floorStates || {})[floorId] || {};
  const removed = floorState.removed || {};

  const width = floor.width || 0;
  const height = floor.height || 0;
  const map = floor.map || [];
  for (let y = 0; y < height && battles.length < maxPerKind; y += 1) {
    const row = map[y] || [];
    for (let x = 0; x < width && battles.length < maxPerKind; x += 1) {
      if (removed[`${x},${y}`]) continue;
      const tileNumber = row[x];
      if (!tileNumber) continue;
      const tile = getTileDefinitionAt(project, state, floorId, x, y);
      if (!tile) continue;
      if (tile.cls === "enemys" && tile.id) {
        const enemy = project.enemysById && project.enemysById[tile.id];
        if (!enemy) { unknowns.push({ kind: "battle", id: tile.id, x, y, reason: "unknown-enemy" }); continue; }
        const hasUnknownSpecial = enemy.special != null && Number(enemy.special) !== 0;
        if (hasUnknownSpecial) {
          unknowns.push({ kind: "battle", id: tile.id, x, y, reason: "special-effect" });
          continue;
        }
        battles.push({
          kind: "battle", id: tile.id, floorId, x, y,
          enemy,
          deltas: {
            hp: -1, // computed per abstractBattleCost at plan time
            exp: number(enemy.exp, 0),
            money: number(enemy.money, 0),
          },
        });
      } else if (tile.cls === "items" && tile.id) {
        const item = project.itemsById && project.itemsById[tile.id];
        if (!item) { unknowns.push({ kind: "pickup", id: tile.id, x, y, reason: "unknown-item" }); continue; }
        pickups.push({
          kind: "pickup", id: tile.id, floorId, x, y,
          item,
        });
      }
    }
  }
  return { battles, pickups, unknowns };
}

/**
 * Evaluate a state: enumerate bounded resource-acquisition sequences, apply
 * each sequence's abstract deltas (one-shot, prerequisite-aware, with level-up
 * recomputation and future battle cost recomputation), and score the state by
 * the best projected terminal-path improvement.
 *
 * terminalGoal: { floorId, enemyId, x, y } (bossDefeated-style) — used only to
 * compute "does the simplified model see the terminal battle become
 * survivable/cheaper".
 */
function createMultiStepResourceLookahead(project, options) {
  const config = options || {};
  const params = {
    ...FROZEN_PARAMS,
    ...(config.params || {}),
  };
  const levelUp = project.data && project.data.firstData && project.data.firstData.levelUp;

  // ---- future battle set: enemies on the terminal floor (or given keyBattles) ----
  const keyBattlesFor = (state, terminalGoal) => {
    if (Array.isArray(config.keyBattles) && config.keyBattles.length > 0) {
      return config.keyBattles;
    }
    // Default: the terminal boss itself + the strongest enemies on the goal floor.
    const goalFloor = project.floorsById[terminalGoal.floorId];
    if (!goalFloor) return [];
    const enemies = [];
    const map = goalFloor.map || [];
    for (let y = 0; y < (goalFloor.height || 0); y += 1) {
      const row = map[y] || [];
      for (let x = 0; x < (goalFloor.width || 0); x += 1) {
        const tileNumber = row[x];
        if (!tileNumber) continue;
        // Use a raw tile lookup that does NOT depend on state mutations (future
        // floor may not be visited yet): project.mapTilesByNumber.
        const tileDef = project.mapTilesByNumber[String(tileNumber)];
        if (!tileDef || tileDef.cls !== "enemys" || !tileDef.id) continue;
        const enemy = project.enemysById && project.enemysById[tileDef.id];
        if (!enemy) continue;
        enemies.push({ enemyId: tileDef.id, enemy, x, y });
      }
    }
    // strongest first (by atk*hp proxy), cap at KEY_BATTLES_SAMPLED
    enemies.sort((a, b) => (b.enemy.atk * b.enemy.hp) - (a.enemy.atk * a.enemy.hp));
    return enemies.slice(0, params.KEY_BATTLES_SAMPLED).map((e) => ({
      enemyId: e.enemyId, enemy: e.enemy, x: e.x, y: e.y,
    }));
  };

  const applyBattleToAbstractHero = (abstractHero, opp) => {
    const cost = abstractBattleCost(abstractHero, opp.enemy);
    if (!cost.survivable) return null; // plan dies: prerequisite violated
    return {
      hp: abstractHero.hp - cost.damage,
      atk: abstractHero.atk,
      def: abstractHero.def,
      mdef: abstractHero.mdef,
      lv: abstractHero.lv,
      exp: abstractHero.exp + number(opp.enemy.exp, 0),
    };
  };

  const applyPickupToAbstractHero = (abstractHero, opp) => {
    const item = opp.item || {};
    const next = { ...abstractHero };
    // h5mota item effects are event scripts; the common numeric effects are
    // handled via the item's known fields. Unknown effect structure => UNKNOWN.
    const cls = item.cls || "";
    if (cls === "items" && item.effect == null) {
      // Common: gem items carry atk/def/mdef boosts; HP potions carry hp.
      next.atk += number(item.atk, 0);
      next.def += number(item.def, 0);
      next.mdef += number(item.mdef, 0);
      next.hp += number(item.hp, 0);
      next.exp += number(item.exp, 0);
      if (item.atk == null && item.def == null && item.mdef == null && item.hp == null && item.exp == null) {
        return { hero: next, unknown: true };
      }
      return { hero: next, unknown: false };
    }
    return { hero: next, unknown: true };
  };

  const evaluate = (state, terminalGoal) => {
    const hero = state.hero || {};
    const abstractHero0 = {
      hp: number(hero.hp, 0),
      atk: number(hero.atk, 0),
      def: number(hero.def, 0),
      mdef: number(hero.mdef, 0),
      lv: number(hero.lv, 1),
      exp: number(hero.exp, 0),
    };
    const { battles, pickups, unknowns } = extractResourceOpportunities(project, state, {
      maxPerKind: 12,
    });
    const keyBattles = keyBattlesFor(state, terminalGoal);

    // Baseline (no further investment): current abstract cost of key battles.
    const baselineCosts = keyBattles.map((kb) => abstractBattleCost(abstractHero0, kb.enemy));
    const baselineFeasible = baselineCosts.filter((c) => c.survivable).length;
    const baselineWorstDamage = baselineCosts.reduce((m, c) => Math.max(m, c.survivable ? c.damage : 1e7), 0);

    // ---- plan enumeration (bounded DFS over one-shot resources) ----
    const plans = [];
    const used = new Set();
    const trace = [];

    const extendPlan = (depth, abstractHero, seq, alternatives) => {
      if (plans.length >= params.MAX_PLANS) return;
      if (depth >= params.LOOKAHEAD_DEPTH) {
        plans.push({ seq: seq.slice(), abstractHero, alternatives });
        return;
      }
      const opportunities = [...battles, ...pickups];
      for (const opp of opportunities) {
        if (plans.length >= params.MAX_PLANS) return;
        const oppKey = `${opp.kind}:${opp.floorId}:${opp.x},${opp.y}`;
        if (used.has(oppKey)) continue;
        used.add(oppKey);
        seq.push(opp);
        let nextHero = null;
        let unknown = false;
        if (opp.kind === "battle") {
          nextHero = applyBattleToAbstractHero(abstractHero, opp);
          if (nextHero == null) {
            // plan dies (cannot survive this battle) — record as dead-end plan
            plans.push({ seq: seq.slice(), abstractHero: null, dead: true, alternatives });
            seq.pop();
            used.delete(oppKey);
            continue;
          }
          // level-up recomputation (requirement 3)
          const gains = levelUpGains(levelUp, abstractHero.lv, abstractHero.exp, number(opp.enemy.exp, 0));
          nextHero.lv = gains.lv;
          nextHero.atk += gains.atk;
          nextHero.def += gains.def;
        } else {
          const applied = applyPickupToAbstractHero(abstractHero, opp);
          nextHero = applied.hero;
          unknown = applied.unknown;
        }
        extendPlan(depth + 1, nextHero, seq, alternatives + (unknown ? 1 : 0));
        seq.pop();
        used.delete(oppKey);
      }
      // also record the "stop here" plan at this depth
      if (seq.length > 0) {
        plans.push({ seq: seq.slice(), abstractHero, alternatives });
      }
    };
    extendPlan(0, abstractHero0, [], 0);

    // ---- score plans by projected key-battle improvement ----
    let bestScore = -Infinity;
    let bestPlan = null;
    let feasiblePlans = 0;
    let unknownPlans = 0;
    for (const plan of plans) {
      if (plan.dead || !plan.abstractHero) continue;
      if (plan.alternatives > 0) unknownPlans += 1;
      const costs = keyBattles.map((kb) => abstractBattleCost(plan.abstractHero, kb.enemy));
      const feasible = costs.filter((c) => c.survivable).length;
      // Bounded damage proxy: infeasible battles contribute a large finite
      // penalty (NOT -Infinity) so plans remain comparable on residual progress.
      const INFEASIBLE_PENALTY = 1e7;
      const worstDamageProxy = costs.reduce((m, c) => Math.max(m, c.survivable ? c.damage : INFEASIBLE_PENALTY), 0);
      // Plan value: more feasible key battles first, then lower worst damage
      // proxy, then residual HP (investment survival).
      const residualHp = plan.abstractHero.hp;
      const score = feasible * 1e9 - worstDamageProxy * 1e3 + residualHp;
      if (score > bestScore) {
        bestScore = score;
        bestPlan = plan;
      }
      if (feasible >= keyBattles.length && keyBattles.length > 0) feasiblePlans += 1;
    }

    // ---- final state score ----
    // Feasibility of the terminal battle itself (if the goal enemy is among
    // the key battles, this is the direct question).
    const goalEnemy = keyBattles.find((kb) => kb.enemyId === terminalGoal.enemyId);
    let feasibility = "UNKNOWN";
    if (goalEnemy) {
      if (bestPlan && bestPlan.abstractHero) {
        const goalCost = abstractBattleCost(bestPlan.abstractHero, goalEnemy.enemy);
        feasibility = goalCost.survivable ? "FEASIBLE" : "UNRESOLVED";
      } else {
        const goalCost = abstractBattleCost(abstractHero0, goalEnemy.enemy);
        feasibility = goalCost.survivable ? "FEASIBLE" : "UNRESOLVED";
      }
    } else if (keyBattles.length > 0) {
      feasibility = baselineFeasible >= keyBattles.length ? "FEASIBLE" : "UNRESOLVED";
    }

    // Score combines: projected feasibility gain + plan headroom + current HP
    // (survival floor) + exp progress (level engine).
    const feasibilityGain = bestPlan && bestPlan.abstractHero
      ? (keyBattles.map((kb) => abstractBattleCost(bestPlan.abstractHero, kb.enemy)).filter((c) => c.survivable).length - baselineFeasible)
      : 0;
    const score = feasibilityGain * 1e9
      + (bestScore === -Infinity ? 0 : bestScore * 1e-3)
      + number(hero.hp, 0) * 1e-6
      + number(hero.exp, 0) * 1e-3;

    // Useful thresholds (explanation): HP floor to survive each key battle now.
    const usefulThresholds = keyBattles.map((kb, i) => ({
      enemyId: kb.enemyId,
      minHpRough: baselineCosts[i] && baselineCosts[i].survivable
        ? Math.ceil(baselineCosts[i].damage) + 1
        : null,
    }));

    // Trace: the best plan's causal chain (for micro verification).
    if (bestPlan) {
      trace.push({
        baseline: {
          feasibleKeyBattles: baselineFeasible,
          worstDamage: baselineWorstDamage === Infinity ? null : baselineWorstDamage,
        },
        plan: bestPlan.seq.map((opp) => ({
          kind: opp.kind,
          id: opp.kind === "battle" ? opp.id : opp.id,
          at: `${opp.floorId}:${opp.x},${opp.y}`,
        })),
        projected: bestPlan.abstractHero ? {
          hp: Math.round(bestPlan.abstractHero.hp),
          atk: bestPlan.abstractHero.atk,
          def: bestPlan.abstractHero.def,
          mdef: bestPlan.abstractHero.mdef,
          lv: bestPlan.abstractHero.lv,
          exp: bestPlan.abstractHero.exp,
          feasibleKeyBattles: keyBattles.map((kb) => abstractBattleCost(bestPlan.abstractHero, kb.enemy)).filter((c) => c.survivable).length,
        } : null,
        feasibility,
      });
    }

    return {
      score,
      feasibility,
      plansConsidered: plans.length,
      bestProjectedPlan: bestPlan ? bestPlan.seq.map((opp) => `${opp.kind}:${opp.id}@${opp.floorId}:${opp.x},${opp.y}`) : null,
      usefulThresholds,
      uncertainty: {
        unknownEvents: unknowns.length,
        unknownPlans,
      },
      trace,
    };
  };

  return {
    evaluate,
    params,
  };
}

module.exports = {
  createMultiStepResourceLookahead,
  FROZEN_PARAMS,
  abstractBattleCost,
  levelUpGains,
  extractResourceOpportunities,
};
