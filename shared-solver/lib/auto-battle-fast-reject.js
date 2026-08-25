"use strict";

/**
 * PR-5.22d Auto-Battle Safe Fast-Reject Predicate.
 *
 * Designed to conservatively identify candidate enemy battles that DEFINITELY cannot
 * result in 0 damage, without performing full JSON cache key stringify and battle simulation.
 *
 * CONTRACT RULES:
 * 1. ONLY returns "definitelyReject" or "unknown". NEVER returns "definitelyAccept".
 * 2. Fail-Open: If an enemy has ANY special ability, guard, aura, buff, or if the hero has special
 *    equipment/flags/items that might alter combat rules, it MUST return "unknown".
 * 3. Shadow-Only: This module does NOT alter production routes or decisions.
 */

const SAFE_EMPTY_SPECIALS = new Set([0, null, undefined, "", "0"]);

// Combat items in Mota / OnlyUp that can modify combat calculation
const KNOWN_COMBAT_ITEMS = new Set([
  "I589", "I590", "I591", "I592", "I596", "I597", "I603",
  "I729", "I746", "I747", "I748", "I749", "I750", "I751", "I767", "I768", "I792", "I793",
  "I821", "I832", "I833", "I834", "I835", "I836", "I837", "I838", "I839", "I840", "I841",
  "I842", "I843", "I844", "I845", "I846", "I847", "I848", "I849", "I850", "I851",
  "I1491", "I1492", "I1493", "cross", "pickaxe", "centerFly",
]);

// Combat flags in Mota / OnlyUp that can modify combat calculation
const KNOWN_COMBAT_FLAGS = [
  "s113", "s114", "s120", "s121", "s141", "s142", "s143", "s157",
  "skill", "magicAtk", "lasthp", "__extraTurn__",
  "poison", "weak", "curse",
];

/**
 * Checks if enemy has any special ability, guards, auras, or complex properties.
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

  // Check for other potential dynamic combat attributes
  if (enemy.zone || enemy.repulse || enemy.laser || enemy.ambush || enemy.betweenAttack) return true;
  if (enemy.critical || enemy.defBreak || enemy.purify || enemy.vampire || enemy.poison || enemy.weak) return true;
  if (enemy.twoHit || enemy.nHit || enemy.counter || enemy.firstAttack || enemy.bomb || enemy.notBomb) return true;
  if (enemy.add || enemy.value || enemy.n || enemy.atkValue || enemy.defValue) return true;
  if (enemy.guards && Array.isArray(enemy.guards) && enemy.guards.length > 0) return true;

  return false;
}

/**
 * Checks if state has any combat item, equipment, or active combat flags.
 */
function hasStateCombatModifiers(state) {
  if (!state) return false;

  // Check equipment
  const equip = state.equipment || (state.hero && state.hero.equipment);
  if (equip && (Array.isArray(equip) ? equip.length > 0 : Object.keys(equip).length > 0)) {
    return true;
  }

  // Check inventory for combat items
  const inventory = state.inventory;
  if (inventory) {
    for (const itemId of Object.keys(inventory)) {
      if (Number(inventory[itemId] || 0) > 0 && KNOWN_COMBAT_ITEMS.has(itemId)) {
        return true;
      }
    }
  }

  // Check flags
  const flags = state.flags;
  if (flags) {
    if (flags.__atk_buff__ != null || flags.__def_buff__ != null || flags.__mdef_buff__ != null) {
      return true;
    }
    for (let i = 0; i < KNOWN_COMBAT_FLAGS.length; i++) {
      const flagName = KNOWN_COMBAT_FLAGS[i];
      if (flags[flagName] != null && flags[flagName] !== 0 && flags[flagName] !== false) {
        return true;
      }
    }
    // Guard flags check
    for (const key of Object.keys(flags)) {
      if (key.startsWith("__guards__")) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Conservative fast-reject predicate.
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

  // 1. Fail-open if enemy has ANY special ability or mechanics
  if (hasSpecialOrComplexProperty(enemy)) {
    return "unknown";
  }

  // 2. Fail-open if state hero has active buffs/debuffs, combat items, or complex combat flags
  if (hasStateCombatModifiers(state)) {
    return "unknown";
  }

  const hero = state.hero;
  const heroAtk = Number(hero.atk || 0);
  const heroDef = Number(hero.def || 0);
  const heroMdef = Number(hero.mdef || 0);
  const enemyAtk = Number(enemy.atk || 0);
  const enemyDef = Number(enemy.def || 0);
  const enemyHp = Number(enemy.hp || 0);

  // 3. Rule 1 (Cannot Penetrate Defense): If hero ATK <= enemy DEF, hero deals <= 0 damage per turn.
  // In vanilla Mota, if you cannot penetrate defense, damage is 0 per turn -> battle cannot be won / unsupported.
  if (heroAtk <= enemyDef) {
    return "definitelyReject";
  }

  // 4. Rule 2 (Enemy Can Damage & Survives 1 Turn):
  // If hero cannot 1-shot the enemy (heroDamagePerTurn < enemyHp),
  // the enemy will attack at least (turns - 1) times.
  // If that raw damage exceeds heroMdef, hero takes strictly > 0 net damage -> not a 0-damage battle!
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
  hasStateCombatModifiers,
};
