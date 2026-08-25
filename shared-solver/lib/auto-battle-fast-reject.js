"use strict";

/**
 * PR-5.22d1 Auto-Battle Safe Fast-Reject Predicate (Closed-World Whitelist Model).
 *
 * Conservatively identifies candidate enemy battles that DEFINITELY cannot result
 * in 0 damage, with a mathematically strict Closed-World Whitelist security architecture:
 *
 * CONTRACT RULES:
 * 1. ONLY returns "definitelyReject" or "unknown". NEVER returns "definitelyAccept".
 * 2. Closed-World Whitelist:
 *    - If the state hero holds ANY item not in SAFE_NON_COMBAT_ITEMS, FAIL-OPEN to "unknown".
 *    - If the state flags contain ANY flag not in SAFE_NON_COMBAT_FLAGS, FAIL-OPEN to "unknown".
 *    - If the hero has any equipment, FAIL-OPEN to "unknown".
 *    - If the enemy has ANY special, guard, aura, hazard, or non-vanilla property, FAIL-OPEN to "unknown".
 * 3. Math Rules (Strictly bounded to vanilla mechanics under closed-world qualification):
 *    - Rule 1 (Zero Penetration): hero.atk <= enemy.def -> hero deals <= 0 damage/turn -> cannot win / unsupported -> definitelyReject.
 *    - Rule 2 (Net Positive Damage): turnsNeeded > 1 AND (turnsNeeded - 1) * max(0, enemy.atk - hero.def) > hero.mdef -> hero takes > 0 net damage -> definitelyReject.
 * 4. Zero False Rejects: GUARANTEED by fail-open on any unknown state modification.
 */

const SAFE_EMPTY_SPECIALS = new Set([0, null, undefined, "", "0"]);

// Strict closed-world whitelist of non-combat items that NEVER participate in combat calculations
const SAFE_NON_COMBAT_ITEMS = new Set([
  "yellowKey",
  "blueKey",
  "redKey",
  "greenKey",
  "steelKey",
  "specialKey",
  "book",
  "fly",
  "I600",
]);

// Strict closed-world whitelist of system non-combat flags
const SAFE_NON_COMBAT_FLAGS = new Set([
  "autoBattle",
  "shiqu",
  "level0",
  "floor",
  "floorId",
  "hero",
  "debug",
  "hatred",
  "__leaveLoc__",
]);

/**
 * Checks if enemy has any special ability, guards, auras, or non-vanilla properties.
 */
function hasSpecialOrComplexProperty(enemy) {
  if (!enemy) return true;
  const special = enemy.special;
  if (Array.isArray(special)) {
    if (special.length > 0) return true;
  } else if (typeof special === "object" && special != null) {
    return true;
  } else if (!SAFE_EMPTY_SPECIALS.has(special)) {
    return true;
  }

  // Fail-open on map hazards, guards, auras or dynamic mechanics
  if (enemy.zone || enemy.repulse || enemy.laser || enemy.ambush || enemy.betweenAttack) return true;
  if (enemy.guards && Array.isArray(enemy.guards) && enemy.guards.length > 0) return true;

  return false;
}

/**
 * Checks if state contains any non-whitelisted item, equipment, or non-whitelisted flag.
 * Closed-world: ANY unrecognized item or flag immediately triggers fail-open.
 */
function hasUnqualifiedStateModifiers(state) {
  if (!state) return true;

  // 1. Equipment check: any equipment must fail-open
  const equip = state.equipment || (state.hero && state.hero.equipment);
  if (equip && (Array.isArray(equip) ? equip.length > 0 : Object.keys(equip).length > 0)) {
    return true;
  }

  // 2. Inventory check: ANY item not in the safe non-combat whitelist must fail-open
  const inventory = state.inventory;
  if (inventory) {
    for (const itemId of Object.keys(inventory)) {
      if (Number(inventory[itemId] || 0) > 0 && !SAFE_NON_COMBAT_ITEMS.has(itemId)) {
        return true;
      }
    }
  }

  // 3. Flags check: ANY flag not in the safe non-combat whitelist with a truthy/non-zero value must fail-open
  const flags = state.flags;
  if (flags) {
    for (const flagKey of Object.keys(flags)) {
      const val = flags[flagKey];
      if (val != null && val !== 0 && val !== false && !SAFE_NON_COMBAT_FLAGS.has(flagKey)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Closed-world fast-reject predicate.
 *
 * @param {object} project Loaded project definition
 * @param {object} state Current search state
 * @param {object} enemy Enemy definition object
 * @param {object} options Extra context (e.g. floorId, x, y)
 * @returns {"definitelyReject" | "unknown"}
 */
function classifyAutoBattleFastReject(project, state, enemy, options) {
  if (!enemy) return "unknown";
  if (!state || !state.hero) return "unknown";

  // 1. Closed-world qualification: enemy must be strictly vanilla with no specials or mechanics
  if (hasSpecialOrComplexProperty(enemy)) {
    return "unknown";
  }

  // 2. Closed-world qualification: state must have ONLY whitelisted non-combat items & flags, and no equipment
  if (hasUnqualifiedStateModifiers(state)) {
    return "unknown";
  }

  const hero = state.hero;
  const heroAtk = Number(hero.atk || 0);
  const heroDef = Number(hero.def || 0);
  const heroMdef = Number(hero.mdef || 0);
  const enemyAtk = Number(enemy.atk || 0);
  const enemyDef = Number(enemy.def || 0);
  const enemyHp = Number(enemy.hp || 0);

  // 3. Rule 1 (Zero Penetration): If hero ATK <= enemy DEF, hero deals <= 0 damage per turn.
  // In vanilla Mota, if you cannot penetrate defense, battle cannot be won / damageInfo is null.
  if (heroAtk <= enemyDef) {
    return "definitelyReject";
  }

  // 4. Rule 2 (Net Positive Damage):
  // Hero deals heroDamagePerTurn = heroAtk - enemyDef > 0.
  // If hero cannot 1-shot the enemy (turnsNeeded > 1), enemy attacks at least (turnsNeeded - 1) times.
  // Total raw enemy damage = (turnsNeeded - 1) * max(0, enemyAtk - heroDef).
  // If total raw damage > heroMdef, hero takes strictly > 0 net damage (not a 0-damage battle!).
  const heroDamagePerTurn = heroAtk - enemyDef;
  if (heroDamagePerTurn > 0) {
    const turnsNeeded = Math.ceil(enemyHp / heroDamagePerTurn);
    if (turnsNeeded > 1) {
      const enemyRawDamagePerTurn = Math.max(0, enemyAtk - heroDef);
      const enemyTotalRawDamage = (turnsNeeded - 1) * enemyRawDamagePerTurn;
      if (enemyTotalRawDamage > heroMdef) {
        return "definitelyReject";
      }
    }
  }

  return "unknown";
}

module.exports = {
  classifyAutoBattleFastReject,
  hasSpecialOrComplexProperty,
  hasUnqualifiedStateModifiers,
  SAFE_NON_COMBAT_ITEMS,
  SAFE_NON_COMBAT_FLAGS,
};
