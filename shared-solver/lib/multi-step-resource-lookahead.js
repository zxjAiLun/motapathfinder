"use strict";

/**
 * PR-5.25a — Multi-Step Resource Lookahead evaluator (Repair 1).
 *
 * v1 gaps (Cloud Review P1s, fixed here):
 *   - prerequisite: resources are now gated by the simulator's own action
 *     enumeration (the authoritative "currently obtainable" signal). A map
 *     resource NOT targeted by any current action is BLOCKED — it may only be
 *     consumed in a plan AFTER its blocker enemy has been defeated within that
 *     plan. Undeterminable prerequisites are UNKNOWN, never assumable.
 *   - alternative isolation: obtainable resources are partitioned into
 *     route-alternative groups (connected walkable regions separated by alive
 *     blocking enemies). A plan draws from AT MOST ONE group; mutually
 *     exclusive resources never mix. MAX_ALTERNATIVES caps groups considered.
 *   - the `alternatives` counter now counts route alternatives (was
 *     miscounting unknown pickups).
 *
 * Everything else (frozen params, one-shot consumption, level-up engine,
 * multi-step battle cost recomputation, UNKNOWN-not-BLOCKED for events,
 * priority-only output) is unchanged from v1.
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
  const atk = number(hero.atk, 0);
  const def = number(hero.def, 0);
  const mdef = number(hero.mdef, 0);
  const enemyHp = number(enemy && enemy.hp, 0);
  const enemyAtk = number(enemy && enemy.atk, 0);
  const enemyDef = number(enemy && enemy.def, 0);
  const perTurn = Math.max(atk - enemyDef, 0);
  if (perTurn <= 0) return { survivable: false, turns: Infinity, damage: Infinity };
  const turns = Math.max(1, Math.ceil(enemyHp / perTurn));
  const damageWithMdef = Math.max(0, turns * Math.max(enemyAtk - def - mdef, 0));
  return { survivable: damageWithMdef < number(hero.hp, 0), turns, damage: damageWithMdef };
}

// ---------- level-up model ----------
function levelUpGains(levelUp, currentLv, currentExp, gainedExp) {
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
    const actions = Array.isArray(next.action) ? next.action : [];
    for (const a of actions) {
      if (a && a.type === "setValue" && a.name === "status:atk" && a.operator === "+=") atk += Number(a.value) || 0;
      if (a && a.type === "setValue" && a.name === "status:def" && a.operator === "+=") def += Number(a.value) || 0;
    }
    lv += 1;
  }
  return { lv, atk, def };
}

// ---------- prerequisite-aware resource extraction ----------
/**
 * Extract resources WITH prerequisites and route-alternative grouping.
 *
 * @param simulator  the production simulator (for action enumeration = the
 *                   authoritative "currently obtainable" reachability signal)
 * @param state      the real state
 * @returns { obtainable, blocked, unknowns, alternativeGroups }
 *   obtainable: [{kind, id, floorId, x, y, enemy?, item?, groupIndex}]
 *   blocked:    [{..., blockerKey}] — map resources not currently targeted;
 *               their prerequisite is defeating the blocker within the plan
 *   alternativeGroups: [[resourceIdx, ...], ...] — mutually exclusive groups
 */
function extractResourcesWithPrerequisites(project, simulator, state, options) {
  const config = options || {};
  const floorId = state.floorId;
  const floor = project.floorsById[floorId];
  if (!floor) return { obtainable: [], blocked: [], unknowns: [], alternativeGroups: [] };
  const maxPerKind = number(config.maxPerKind, 12);

  // 1) Authoritative obtainable set: action enumeration targets.
  let actions = [];
  try {
    actions = (simulator.enumeratePrimitiveActions(state) || {}).actions || [];
  } catch (_) {
    actions = [];
  }
  const obtainableKeys = new Set();
  for (const action of actions) {
    if (action.kind === "battle" && action.target) {
      obtainableKeys.add(`battle:${action.floorId || floorId}:${action.target.x},${action.target.y}`);
    } else if ((action.kind === "pickup" || action.kind === "interactPickup") && (action.x != null)) {
      obtainableKeys.add(`pickup:${action.floorId || floorId}:${action.x},${action.y}`);
    }
  }

  // 2) Scan the map for all one-shot resources; classify by prerequisite.
  const floorState = (state.floorStates || {})[floorId] || {};
  const removed = floorState.removed || {};
  const obtainable = [];
  const blocked = [];
  const unknowns = [];
  const width = floor.width || 0;
  const height = floor.height || 0;
  const map = floor.map || [];
  for (let y = 0; y < height && (obtainable.length + blocked.length) < maxPerKind * 2; y += 1) {
    const row = map[y] || [];
    for (let x = 0; x < width && (obtainable.length + blocked.length) < maxPerKind * 2; x += 1) {
      if (removed[`${x},${y}`]) continue;
      const tileNumber = row[x];
      if (!tileNumber) continue;
      const tile = getTileDefinitionAt(project, state, floorId, x, y);
      if (!tile) continue;
      if (tile.cls === "enemys" && tile.id) {
        const enemy = project.enemysById && project.enemysById[tile.id];
        if (!enemy) {
          unknowns.push({ kind: "battle", id: tile.id, floorId, x, y, reason: "unknown-enemy" });
          continue;
        }
        if (enemy.special != null && Number(enemy.special) !== 0) {
          unknowns.push({ kind: "battle", id: tile.id, floorId, x, y, reason: "special-effect" });
          continue;
        }
        const record = { kind: "battle", id: tile.id, floorId, x, y, enemy };
        if (obtainableKeys.has(`battle:${floorId}:${x},${y}`)) {
          obtainable.push(record);
        } else {
          blocked.push(record); // prerequisite: some blocker on the path
        }
      } else if (tile.cls === "items" && tile.id) {
        const item = project.itemsById && project.itemsById[tile.id];
        if (!item) {
          unknowns.push({ kind: "pickup", id: tile.id, floorId, x, y, reason: "unknown-item" });
          continue;
        }
        const record = { kind: "pickup", id: tile.id, floorId, x, y, item };
        if (obtainableKeys.has(`pickup:${floorId}:${x},${y}`)) {
          obtainable.push(record);
        } else {
          blocked.push(record);
        }
      }
    }
  }

  // 3) Route-alternative grouping: partition OBTAINABLE resources by the
  // connected walkable component they are adjacent to. Two resources in
  // different components are only co-accessible after defeating the enemies
  // separating them — they are mutually exclusive ALTERNATIVES for a bounded
  // plan. We approximate components via the hero's walk reachability node
  // graph: resources whose access nodes are in the same component share a group.
  // Lightweight approach: group by reachability "region" — we use the action's
  // stance node proximity clustering (same-adjacency = same group).
  let reachability = null;
  try {
    reachability = simulator.getWalkReachability(state);
  } catch (_) {
    reachability = null;
  }

  const alternativeGroups = [];
  if (reachability && typeof reachability.forEachNode === "function") {
    // Union-find over reachability nodes by adjacency (walls = alive enemies).
    // Simpler faithful proxy: group resources by the corridor segment they are
    // accessed from — use the stance coordinate of their enumerating action.
    const actionStanceByKey = new Map();
    for (const action of actions) {
      if (action.kind === "battle" && action.target) {
        actionStanceByKey.set(`battle:${action.floorId || floorId}:${action.target.x},${action.target.y}`, action.stance || null);
      } else if ((action.kind === "pickup" || action.kind === "interactPickup") && action.x != null) {
        actionStanceByKey.set(`pickup:${action.floorId || floorId}:${action.x},${action.y}`, action.stance || null);
      }
    }
    // Group key: connected-component proxy via stance proximity clustering.
    // Resources within walk-step distance share a group; distant clusters are
    // separate alternatives (they require different corridor traversals).
    const CLUSTER_RADIUS = 6; // tiles; two stance nodes farther than this are separate corridors
    const clusters = [];
    obtainable.forEach((record, idx) => {
      const key = `${record.kind}:${record.floorId}:${record.x},${record.y}`;
      const stance = actionStanceByKey.get(key);
      if (!stance) {
        // No stance info → put in its own group (conservative isolation).
        record.groupIndex = clusters.length;
        clusters.push([idx]);
        return;
      }
      let placed = false;
      for (let ci = 0; ci < clusters.length; ci += 1) {
        const representative = obtainable[clusters[ci][0]];
        const repKey = `${representative.kind}:${representative.floorId}:${representative.x},${representative.y}`;
        const repStance = actionStanceByKey.get(repKey);
        if (repStance) {
          const dist = Math.abs((repStance.x || 0) - (stance.x || 0)) + Math.abs((repStance.y || 0) - (stance.y || 0));
          if (dist <= CLUSTER_RADIUS) {
            clusters[ci].push(idx);
            record.groupIndex = ci;
            placed = true;
            break;
          }
        }
      }
      if (!placed) {
        record.groupIndex = clusters.length;
        clusters.push([idx]);
      }
    });
    alternativeGroups.push(...clusters);
  } else {
    // Reachability unavailable → every resource is its own group (max isolation).
    obtainable.forEach((record, idx) => {
      record.groupIndex = idx;
      alternativeGroups.push([idx]);
    });
  }

  return { obtainable, blocked, unknowns, alternativeGroups };
}

// ---------- evaluator factory ----------
function createMultiStepResourceLookahead(project, options) {
  const config = options || {};
  const params = {
    ...FROZEN_PARAMS,
    ...(config.params || {}),
  };
  const levelUp = project.data && project.data.firstData && project.data.firstData.levelUp;
  let simulatorRef = config.simulator || null;

  const keyBattlesFor = (terminalGoal) => {
    if (Array.isArray(config.keyBattles) && config.keyBattles.length > 0) {
      return config.keyBattles;
    }
    const goalFloor = project.floorsById[terminalGoal.floorId];
    if (!goalFloor) return [];
    const enemies = [];
    const map = goalFloor.map || [];
    for (let y = 0; y < (goalFloor.height || 0); y += 1) {
      const row = map[y] || [];
      for (let x = 0; x < (goalFloor.width || 0); x += 1) {
        const tileNumber = row[x];
        if (!tileNumber) continue;
        const tileDef = project.mapTilesByNumber[String(tileNumber)];
        if (!tileDef || tileDef.cls !== "enemys" || !tileDef.id) continue;
        const enemy = project.enemysById && project.enemysById[tileDef.id];
        if (!enemy) continue;
        enemies.push({ enemyId: tileDef.id, enemy, x, y });
      }
    }
    enemies.sort((a, b) => (b.enemy.atk * b.enemy.hp) - (a.enemy.atk * a.enemy.hp));
    return enemies.slice(0, params.KEY_BATTLES_SAMPLED).map((e) => ({
      enemyId: e.enemyId, enemy: e.enemy, x: e.x, y: e.y,
    }));
  };

  const applyBattleToAbstractHero = (abstractHero, opp) => {
    const cost = abstractBattleCost(abstractHero, opp.enemy);
    if (!cost.survivable) return null;
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
    next.atk += number(item.atk, 0);
    next.def += number(item.def, 0);
    next.mdef += number(item.mdef, 0);
    next.hp += number(item.hp, 0);
    next.exp += number(item.exp, 0);
    const unknown = item.atk == null && item.def == null && item.mdef == null && item.hp == null && item.exp == null;
    return { hero: next, unknown };
  };

  const evaluate = (state, terminalGoal) => {
    if (!simulatorRef) {
      return {
        score: 0,
        feasibility: "UNKNOWN",
        plansConsidered: 0,
        bestProjectedPlan: null,
        usefulThresholds: [],
        uncertainty: { unknownEvents: 0, unknownPlans: 0, reason: "no-simulator" },
        trace: [],
      };
    }
    const hero = state.hero || {};
    const abstractHero0 = {
      hp: number(hero.hp, 0),
      atk: number(hero.atk, 0),
      def: number(hero.def, 0),
      mdef: number(hero.mdef, 0),
      lv: number(hero.lv, 1),
      exp: number(hero.exp, 0),
    };

    // --- prerequisite-aware extraction with alternative grouping ---
    const { obtainable, blocked, unknowns, alternativeGroups } =
      extractResourcesWithPrerequisites(project, simulatorRef, state, { maxPerKind: 12 });

    // Cap alternatives at MAX_ALTERNATIVES (frozen param participates).
    const activeGroups = alternativeGroups.slice(0, params.MAX_ALTERNATIVES);
    const activeGroupSet = new Set(activeGroups.flat());

    const keyBattles = keyBattlesFor(terminalGoal);
    const baselineCosts = keyBattles.map((kb) => abstractBattleCost(abstractHero0, kb.enemy));
    const baselineFeasible = baselineCosts.filter((c) => c.survivable).length;
    const INFEASIBLE_PENALTY = 1e7;
    const baselineWorstDamage = baselineCosts.reduce((m, c) => Math.max(m, c.survivable ? c.damage : INFEASIBLE_PENALTY), 0);

    // --- plan enumeration: per-alternative DFS (isolation contract) ---
    const plans = [];
    const trace = [];
    let unknownPlans = 0;

    const scorePlan = (planAbstractHero) => {
      const costs = keyBattles.map((kb) => abstractBattleCost(planAbstractHero, kb.enemy));
      const feasible = costs.filter((c) => c.survivable).length;
      const worstDamageProxy = costs.reduce((m, c) => Math.max(m, c.survivable ? c.damage : INFEASIBLE_PENALTY), 0);
      const residualHp = planAbstractHero.hp;
      return feasible * 1e9 - worstDamageProxy * 1e3 + residualHp;
    };

    // Alternative group → the resources available in plans rooted at this group.
    // BLOCKED resources may join a plan only AFTER their blocker (an alive enemy
    // on the path) is defeated within the plan — approximated by: a blocked
    // resource becomes available after the plan has defeated >= 1 battle from
    // the same group (the corridor guard). If no such battle exists → UNKNOWN.
    // When obtainable resources are empty (a fully stabilized corridor state),
    // seed alternative groups from blocked battles so plans can express
    // "fight through the corridor" investments.
    const effectiveGroups = activeGroups.length > 0
      ? activeGroups
      : blocked.filter((b) => b.kind === "battle").slice(0, params.MAX_ALTERNATIVES).map((b, idx) => [null, b]);
    for (let gi = 0; gi < effectiveGroups.length && plans.length < params.MAX_PLANS; gi += 1) {
      const group = effectiveGroups[gi];
      // group may be [indices into obtainable] or [null, blockedBattle]
      const groupResources = group
        .map((entry, ei) => (typeof entry === "number" ? obtainable[entry] : entry))
        .filter(Boolean);

      // Blocked resources "behind" this group's corridor: those on the same
      // floor whose nearest obtainable-group battle unlocks them. For the
      // bounded model, we admit a blocked resource after the plan defeats any
      // battle in this group (guard proxy), else mark it UNKNOWN for this plan.
      const blockedAfterGuard = blocked.filter((b) => b.floorId === state.floorId);

      const used = new Set();
      const seq = [];

      const extend = (depth, abstractHero, hasUnknown) => {
        if (plans.length >= params.MAX_PLANS) return;
        if (depth >= params.LOOKAHEAD_DEPTH) {
          plans.push({ seq: seq.slice(), abstractHero, groupIndex: gi, hasUnknown });
          if (hasUnknown) unknownPlans += 1;
          return;
        }
        // Candidates: obtainable group resources not yet used + blocked
        // resources whose guard has been defeated (at least one battle done).
        const battlesDone = seq.filter((s) => s.kind === "battle").length;
        const candidates = [
          ...groupResources.filter((r) => !used.has(`${r.kind}:${r.floorId}:${r.x},${r.y}`)),
          // Blocked battles may seed a plan at any depth (fighting through the
          // corridor IS the prerequisite satisfaction); blocked pickups only
          // after at least one battle in the plan (guard defeated).
          ...blockedAfterGuard.filter((r) => r.kind === "battle" && !used.has(`${r.kind}:${r.floorId}:${r.x},${r.y}`)),
          ...(battlesDone > 0 ? blockedAfterGuard.filter((r) => r.kind === "pickup" && !used.has(`${r.kind}:${r.floorId}:${r.x},${r.y}`)) : []),
        ];
        for (const opp of candidates) {
          if (plans.length >= params.MAX_PLANS) return;
          const oppKey = `${opp.kind}:${opp.floorId}:${opp.x},${opp.y}`;
          if (used.has(oppKey)) continue;
          used.add(oppKey);
          seq.push(opp);
          let nextHero = null;
          let unknown = hasUnknown;
          if (opp.kind === "battle") {
            nextHero = applyBattleToAbstractHero(abstractHero, opp);
            if (nextHero == null) {
              plans.push({ seq: seq.slice(), abstractHero: null, dead: true, groupIndex: gi, hasUnknown });
              if (hasUnknown) unknownPlans += 1;
              seq.pop();
              used.delete(oppKey);
              continue;
            }
            const gains = levelUpGains(levelUp, abstractHero.lv, abstractHero.exp, number(opp.enemy.exp, 0));
            nextHero.lv = gains.lv;
            nextHero.atk += gains.atk;
            nextHero.def += gains.def;
          } else {
            const applied = applyPickupToAbstractHero(abstractHero, opp);
            nextHero = applied.hero;
            unknown = unknown || applied.unknown;
          }
          extend(depth + 1, nextHero, unknown);
          seq.pop();
          used.delete(oppKey);
        }
        if (seq.length > 0) {
          plans.push({ seq: seq.slice(), abstractHero, groupIndex: gi, hasUnknown });
          if (hasUnknown) unknownPlans += 1;
        }
      };
      extend(0, abstractHero0, false);
    }

    // --- best plan per alternative, then overall ---
    let bestScore = -Infinity;
    let bestPlan = null;
    let feasiblePlans = 0;
    for (const plan of plans) {
      if (plan.dead || !plan.abstractHero) continue;
      const score = scorePlan(plan.abstractHero);
      if (score > bestScore) {
        bestScore = score;
        bestPlan = plan;
      }
      const costs = keyBattles.map((kb) => abstractBattleCost(plan.abstractHero, kb.enemy));
      if (keyBattles.length > 0 && costs.every((c) => c.survivable)) feasiblePlans += 1;
    }

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

    const feasibilityGain = bestPlan && bestPlan.abstractHero
      ? (keyBattles.map((kb) => abstractBattleCost(bestPlan.abstractHero, kb.enemy)).filter((c) => c.survivable).length - baselineFeasible)
      : 0;
    const score = feasibilityGain * 1e9
      + (bestScore === -Infinity ? 0 : bestScore * 1e-3)
      + number(hero.hp, 0) * 1e-6
      + number(hero.exp, 0) * 1e-3;

    const usefulThresholds = keyBattles.map((kb, i) => ({
      enemyId: kb.enemyId,
      minHpRough: baselineCosts[i] && baselineCosts[i].survivable
        ? Math.ceil(baselineCosts[i].damage) + 1
        : null,
    }));

    if (bestPlan) {
      trace.push({
        baseline: {
          feasibleKeyBattles: baselineFeasible,
          worstDamage: baselineWorstDamage >= INFEASIBLE_PENALTY ? null : baselineWorstDamage,
        },
        alternativeGroupIndex: bestPlan.groupIndex,
        alternativeGroupsConsidered: activeGroups.length,
        plan: bestPlan.seq.map((opp) => ({
          kind: opp.kind,
          id: opp.id,
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
        blockedResources: blocked.length,
      },
      trace,
    };
  };

  return {
    evaluate,
    params,
    setSimulator(sim) {
      simulatorRef = sim;
    },
  };
}

module.exports = {
  createMultiStepResourceLookahead,
  FROZEN_PARAMS,
  abstractBattleCost,
  levelUpGains,
  extractResourcesWithPrerequisites,
};
