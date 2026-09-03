"use strict";

const { buildDpStateKey } = require("./dp-search");

/**
 * PR-5.24e — Counterfactual Resource-Investment Repair Generation.
 *
 * When normal "HP-conserving" repair histories fail to advance downstream,
 * this module scans for investment opportunities (willing to spend HP, money,
 * or keys to gain ATK, DEF, MDEF, EXP, LV, equipment, or path openings),
 * performs unweighted Pareto trade-off filtering and intent-kind coverage,
 * and synthesizes concrete canonical subgoals to be realized by canonical DP.
 */

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Checks whether opportunity A Pareto-dominates opportunity B.
 * Direction:
 *   Gains (atk, def, mdef, lv, exp, equipCount, pathOpportunity): larger is better.
 *   Costs (hpCost, moneyCost, keyCost): smaller is better.
 * A dominates B iff A is no worse in all dimensions and strictly better in at least one.
 */
function paretoDominates(a, b) {
  const aGain = a.gain || {};
  const bGain = b.gain || {};
  const aCost = a.cost || {};
  const bCost = b.cost || {};

  const gainKeys = ["atk", "def", "mdef", "lv", "exp", "equipCount", "pathOpportunity"];
  const costKeys = ["hpCost", "moneyCost", "keyCost"];

  let strictlyBetter = false;

  for (const k of costKeys) {
    const cA = number(aCost[k], 0);
    const cB = number(bCost[k], 0);
    if (cA > cB) return false; // A has higher cost -> cannot dominate
    if (cA < cB) strictlyBetter = true;
  }

  for (const k of gainKeys) {
    const gA = number(aGain[k], 0);
    const gB = number(bGain[k], 0);
    if (gA < gB) return false; // A has smaller gain -> cannot dominate
    if (gA > gB) strictlyBetter = true;
  }

  return strictlyBetter;
}

/**
 * Filters an array of opportunities to the Pareto non-dominated subset.
 * No scalar weighting or scoring is used.
 */
function filterParetoOpportunities(opportunities) {
  const list = Array.isArray(opportunities) ? opportunities.filter(Boolean) : [];
  return list.filter((oppA, idxA) => {
    // Check if any other opportunity B strictly dominates oppA
    for (let idxB = 0; idxB < list.length; idxB += 1) {
      if (idxA === idxB) continue;
      if (paretoDominates(list[idxB], oppA)) {
        return false; // oppA is dominated by list[idxB]
      }
    }
    return true;
  });
}

/**
 * Verifies that a synthesized goal has at least one concrete constraint,
 * preventing empty or no-op goals.
 */
function isConcreteGoal(goal) {
  if (!goal || typeof goal !== "object") return false;
  if (goal.floorId == null) return false;
  const hasMinHero = goal.minHero && Object.keys(goal.minHero).some((k) => number(goal.minHero[k], 0) > 0);
  const hasMinEffective = goal.minEffectiveHero && Object.keys(goal.minEffectiveHero).some((k) => number(goal.minEffectiveHero[k], 0) > 0);
  const hasEquipment = Array.isArray(goal.equipmentIncludes) && goal.equipmentIncludes.length > 0;
  const hasTiles = (Array.isArray(goal.removedTiles) && goal.removedTiles.length > 0) ||
                   (Array.isArray(goal.presentTiles) && goal.presentTiles.length > 0);
  const hasAction = goal.actionSurvivable && (goal.actionSurvivable.summary || goal.actionSurvivable.action);
  return Boolean(hasMinHero || hasMinEffective || hasEquipment || hasTiles || hasAction);
}

/**
 * Scans actions from a candidate state and extracts persistent investment opportunities.
 */
function extractCandidateOpportunities(simulator, candidate, triggerFailure) {
  const state = candidate && candidate.state ? candidate.state : candidate;
  if (!state || !state.hero) return [];

  const actions = [];
  try {
    if (typeof simulator.enumeratePrimitiveActions === "function") {
      const res = simulator.enumeratePrimitiveActions(state);
      if (res && Array.isArray(res.actions)) actions.push(...res.actions);
    }
    if (typeof simulator.enumerateInteractPickupActions === "function") {
      const res = simulator.enumerateInteractPickupActions(state);
      if (Array.isArray(res)) actions.push(...res);
    }
  } catch (_) {}

  const opportunities = [];
  const seenActionSummaries = new Set();

  for (const action of actions) {
    if (!action || !action.summary || seenActionSummaries.has(action.summary)) continue;
    seenActionSummaries.add(action.summary);

    let after = null;
    try {
      after = simulator.applyAction(state, action, { storeRoute: false });
    } catch (_) {
      after = null;
    }
    if (!after || !after.hero || (after.hero.hp != null && after.hero.hp <= 0)) continue;

    const sHero = state.hero || {};
    const aHero = after.hero || {};

    const hpDelta = number(aHero.hp, 0) - number(sHero.hp, 0);
    const atkDelta = number(aHero.atk, 0) - number(sHero.atk, 0);
    const defDelta = number(aHero.def, 0) - number(sHero.def, 0);
    const mdefDelta = number(aHero.mdef, 0) - number(sHero.mdef, 0);
    const lvDelta = number(aHero.lv, 0) - number(sHero.lv, 0);
    const expDelta = number(aHero.exp, 0) - number(sHero.exp, 0);
    const moneyDelta = number(aHero.money, 0) - number(sHero.money, 0);

    const sEquip = Array.isArray(sHero.equipment) ? sHero.equipment : [];
    const aEquip = Array.isArray(aHero.equipment) ? aHero.equipment : [];
    const equipGained = aEquip.filter((item) => !sEquip.includes(item));

    // Path / Unlock / Transition opportunities
    let pathOpportunity = 0;
    if (after.floorId !== state.floorId) pathOpportunity += 1;
    if (action.kind === "openDoor" || action.kind === "useTool") pathOpportunity += 1;

    // Costs (must be non-negative)
    const hpCost = Math.max(0, -hpDelta);
    const moneyCost = Math.max(0, -moneyDelta);
    const keyCost = 0; // standard keys tracked in inventory if applicable

    // Gains (must be positive)
    const gain = {
      atk: Math.max(0, atkDelta),
      def: Math.max(0, defDelta),
      mdef: Math.max(0, mdefDelta),
      lv: Math.max(0, lvDelta),
      exp: Math.max(0, expDelta),
      equipCount: equipGained.length,
      pathOpportunity,
    };
    const cost = {
      hpCost,
      moneyCost,
      keyCost,
    };

    // An investment opportunity MUST yield a persistent positive gain
    const hasGain = gain.atk > 0 || gain.def > 0 || gain.mdef > 0 ||
                    gain.lv > 0 || gain.exp > 0 || gain.equipCount > 0 ||
                    gain.pathOpportunity > 0 || moneyDelta > 0;
    if (!hasGain) continue; // Pure loss or zero delta is not an investment

    // Classify intent kind
    let kind = "stat";
    if (gain.equipCount > 0 || action.kind === "equip") {
      kind = "equipment";
    } else if (gain.lv > 0 || gain.exp > 0) {
      kind = "exp/level";
    } else if (gain.pathOpportunity > 0 || action.kind === "openDoor" || action.kind === "useTool" || action.kind === "changeFloor") {
      kind = "path/unlock";
    } else if (gain.atk > 0 || gain.def > 0 || gain.mdef > 0) {
      kind = "stat";
    } else {
      kind = "item/resource";
    }

    opportunities.push({
      startCandidate: candidate,
      action,
      afterState: after,
      gain,
      cost,
      kind,
      structuralDelta: {
        hp: hpDelta,
        atk: atkDelta,
        def: defDelta,
        mdef: mdefDelta,
        lv: lvDelta,
        exp: expDelta,
        money: moneyDelta,
        equipment: equipGained,
        pathOpportunity,
      },
    });
  }

  return opportunities;
}

/**
 * Synthesizes a concrete Goal and ActionPolicy for an investment opportunity.
 */
function synthesizeGoalAndPolicy(opp) {
  const after = opp.afterState;
  const action = opp.action;
  const delta = opp.structuralDelta;

  const goal = {
    floorId: after.floorId || "F1",
    minHero: {},
  };

  if (delta.exp > 0) goal.minHero.exp = number(after.hero.exp, 0);
  if (delta.lv > 0) goal.minHero.lv = number(after.hero.lv, 0);
  if (delta.atk > 0) goal.minHero.atk = number(after.hero.atk, 0);
  if (delta.def > 0) goal.minHero.def = number(after.hero.def, 0);
  if (delta.mdef > 0) goal.minHero.mdef = number(after.hero.mdef, 0);

  if (delta.equipment && delta.equipment.length > 0) {
    goal.equipmentIncludes = delta.equipment.slice();
  }

  if (action && action.target && action.target.x != null && action.target.y != null) {
    goal.removedTiles = [{
      floorId: action.floorId || after.floorId,
      x: action.target.x,
      y: action.target.y,
    }];
  }

  const actionPolicy = {
    allowedFloors: [after.floorId || "F1"],
    actionKinds: action && action.kind ? [action.kind] : ["battle", "pickup", "equip", "openDoor", "useTool"],
  };

  return { goal, actionPolicy };
}

/**
 * Builds counterfactual repair intents for the given start candidates and failure context.
 * Performs opportunity extraction, Pareto trade-off filtering, intent-kind coverage,
 * and concrete goal validation.
 */
function buildCounterfactualRepairIntents({
  simulator,
  startCandidates,
  triggerFailure,
  failedSegment,
  candidateLimit,
}) {
  const candidates = Array.isArray(startCandidates) ? startCandidates.filter(Boolean) : [];
  if (candidates.length === 0 || !simulator) return [];

  const limit = Math.max(1, number(candidateLimit, 8));

  // 1. Extract investment opportunities from all start candidates
  const allOpportunities = [];
  for (const cand of candidates) {
    const opps = extractCandidateOpportunities(simulator, cand, triggerFailure);
    allOpportunities.push(...opps);
  }

  if (allOpportunities.length === 0) return [];

  // 2. Filter by Pareto dominance (no scalar weights)
  const nondominated = filterParetoOpportunities(allOpportunities);

  // 3. Ensure intent-kind coverage across diverse categories
  const byKind = new Map();
  for (const opp of nondominated) {
    if (!byKind.has(opp.kind)) byKind.set(opp.kind, []);
    byKind.get(opp.kind).push(opp);
  }

  const selected = [];
  // Round-robin selection across available kinds to ensure coverage
  const kinds = Array.from(byKind.keys());
  let added = true;
  let round = 0;
  while (added && selected.length < limit) {
    added = false;
    for (const k of kinds) {
      const list = byKind.get(k);
      if (round < list.length && selected.length < limit) {
        selected.push(list[round]);
        added = true;
      }
    }
    round += 1;
  }

  // 4. Synthesize concrete goals and build descriptors
  const intents = [];
  selected.forEach((opp, index) => {
    const { goal, actionPolicy } = synthesizeGoalAndPolicy(opp);
    if (!isConcreteGoal(goal)) return; // Fail closed on non-concrete goals

    const candId = opp.startCandidate && opp.startCandidate.id != null
      ? String(opp.startCandidate.id)
      : `cand-${index}`;
    const intentId = `cf-d${index}-${opp.kind.replace(/[^a-zA-Z0-9]/g, "_")}`;

    intents.push({
      intentId,
      kind: opp.kind,
      startCandidateId: candId,
      startCandidate: opp.startCandidate,
      goal,
      actionPolicy,
      structuralDelta: opp.structuralDelta,
      cost: opp.cost,
      gain: opp.gain,
      action: opp.action,
      evidenceAfter: opp.afterState,
    });
  });

  return intents.slice(0, limit);
}

module.exports = {
  buildCounterfactualRepairIntents,
  filterParetoOpportunities,
  paretoDominates,
  isConcreteGoal,
};
