"use strict";

/**
 * PR-5.25n — Frontier-Conditioned Resource-State Skyline.
 *
 * Provides:
 *   1. Strict structural state key (topology, location, mutations, flags, equipment, followers)
 *      WITHOUT any scalar resources (HP, stats, mana, money, exp, inventory).
 *   2. Resource vector extraction (all stats, hp, mana, money, exp, lv, inventory counts).
 *   3. Non-scalar Pareto dominance comparator (no hand-authored weights or thresholds).
 *   4. Resource variant pressure analysis over expanded states.
 *   5. SkylineSet for search-time Pareto dominance classification.
 */

const { listFloorMutationSummary } = require("./state");

const TRANSPORT_IGNORED_FLAG_KEYS = new Set(["__leaveLoc__", "__frontierFeatures"]);

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const body = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",");
    return `{${body}}`;
  }
  if (value === undefined) return "null";
  return JSON.stringify(value);
}

function stableObject(object) {
  return Object.keys(object || {})
    .sort()
    .reduce((result, key) => {
      const value = object[key];
      if (value == null || value === 0) return result;
      result[key] = value;
      return result;
    }, {});
}

function stableFlags(flags) {
  return Object.keys(flags || {})
    .sort()
    .reduce((result, key) => {
      if (TRANSPORT_IGNORED_FLAG_KEYS.has(key)) return result;
      const value = flags[key];
      if (value == null || value === 0) return result;
      result[key] = value;
      return result;
    }, {});
}

function flatPairs(object) {
  return Object.keys(object || {})
    .sort()
    .map((key) => {
      const value = object[key];
      return `${key}=${value && typeof value === "object" ? canonicalJson(value) : value}`;
    })
    .join(";");
}

/**
 * Strict structural key: everything that determines future action legality
 * and world topology, excluding all resource quantities.
 */
function buildStructuralStateKey(state) {
  if (!state) return "";
  const hero = state.hero || {};
  const loc = hero.loc || {};
  return [
    state.floorId || "",
    loc.x == null ? "" : loc.x,
    loc.y == null ? "" : loc.y,
    loc.direction || "",
    Array.isArray(hero.equipment) ? hero.equipment.slice().sort().join(",") : "",
    Array.isArray(hero.followers) ? hero.followers.slice().sort().join(",") : "",
    "|",
    flatPairs(stableFlags(state.flags)),
    "|",
    Object.keys(state.visitedFloors || {}).sort().join(","),
    "|",
    JSON.stringify(listFloorMutationSummary(state.floorStates || {})),
    "|",
    flatPairs(stableObject(state.triggeredAutoEvents)),
  ].join("~");
}

/**
 * Resource vector: all consumable or accumulator resources.
 */
function extractResourceVector(state) {
  const hero = (state && state.hero) || {};
  const inventory = (state && state.inventory) || {};
  return {
    hp: hero.hp == null ? 0 : hero.hp,
    hpmax: hero.hpmax == null ? 0 : hero.hpmax,
    mana: hero.mana == null ? 0 : hero.mana,
    manamax: hero.manamax == null ? 0 : hero.manamax,
    atk: hero.atk == null ? 0 : hero.atk,
    def: hero.def == null ? 0 : hero.def,
    mdef: hero.mdef == null ? 0 : hero.mdef,
    money: hero.money == null ? 0 : hero.money,
    exp: hero.exp == null ? 0 : hero.exp,
    lv: hero.lv == null ? 0 : hero.lv,
    inventory: Object.assign({}, inventory),
  };
}

/**
 * Non-scalar Pareto dominance comparator:
 * Returns true iff vecA Pareto-dominates vecB:
 *   vecA[dimension] >= vecB[dimension] for all dimensions, AND
 *   vecA[dimension] >  vecB[dimension] for at least one dimension.
 *
 * Never uses scalar weighting (e.g. 1 ATK = 10 HP).
 * If vecA has more HP but vecB has more ATK, returns false (incomparable).
 */
function paretoDominates(vecA, vecB) {
  const scalarFields = ["hp", "hpmax", "mana", "manamax", "atk", "def", "mdef", "money", "exp", "lv"];
  let strictlyGreater = false;

  for (const f of scalarFields) {
    if (vecA[f] < vecB[f]) return false;
    if (vecA[f] > vecB[f]) strictlyGreater = true;
  }

  // Inventory comparison
  const allItems = new Set([...Object.keys(vecA.inventory), ...Object.keys(vecB.inventory)]);
  for (const item of allItems) {
    const countA = vecA.inventory[item] || 0;
    const countB = vecB.inventory[item] || 0;
    if (countA < countB) return false;
    if (countA > countB) strictlyGreater = true;
  }

  return strictlyGreater;
}

/**
 * Creates an in-memory Pareto Skyline set indexed by structuralKey.
 * Used both for offline pressure measurement and online priority queue routing.
 */
function createResourceSkylineSet() {
  // Map: structuralKey -> Array of { stateId, exactKey, resourceVector, state }
  const groups = new Map();

  function query(state, stateId, exactKey) {
    const structuralKey = buildStructuralStateKey(state);
    const vec = extractResourceVector(state);
    const existing = groups.get(structuralKey) || [];

    let isDominated = false;
    let dominatedBy = null;

    for (const entry of existing) {
      if (paretoDominates(entry.resourceVector, vec)) {
        isDominated = true;
        dominatedBy = entry.exactKey;
        break;
      }
    }

    return {
      structuralKey,
      resourceVector: vec,
      isDominated,
      dominatedBy,
      variantCount: existing.length,
    };
  }

  function insert(state, stateId, exactKey) {
    const structuralKey = buildStructuralStateKey(state);
    const vec = extractResourceVector(state);
    let existing = groups.get(structuralKey);
    if (!existing) {
      existing = [];
      groups.set(structuralKey, existing);
    }
    existing.push({ stateId, exactKey, resourceVector: vec });
  }

  return {
    groups,
    query,
    insert,
  };
}

/**
 * Analyzes resource variant pressure over a collection of expanded states.
 */
function analyzeResourceVariantPressure(expandedStates) {
  const groups = new Map(); // structuralKey -> Array of { exactKey, resourceVector }

  for (const s of expandedStates) {
    const sk = buildStructuralStateKey(s.state);
    const vec = extractResourceVector(s.state);
    let list = groups.get(sk);
    if (!list) {
      list = [];
      groups.set(sk, list);
    }
    list.push({ id: s.id, key: s.key, vec });
  }

  const structuralGroupCount = groups.size;
  let multiVariantGroupCount = 0;
  let resourceVariantStateCount = 0;
  let paretoDominatedCount = 0;
  let paretoNondominatedCount = 0;
  let maxVariantsInGroup = 0;

  for (const list of groups.values()) {
    if (list.length > maxVariantsInGroup) maxVariantsInGroup = list.length;
    if (list.length > 1) {
      multiVariantGroupCount += 1;
      resourceVariantStateCount += list.length;
    }

    // Classify each state in this structural group as dominated or non-dominated
    for (let i = 0; i < list.length; i += 1) {
      let isDominated = false;
      for (let j = 0; j < list.length; j += 1) {
        if (i === j) continue;
        if (paretoDominates(list[j].vec, list[i].vec)) {
          isDominated = true;
          break;
        }
      }
      if (isDominated) {
        paretoDominatedCount += 1;
      } else {
        paretoNondominatedCount += 1;
      }
    }
  }

  const mt2ExpandedStates = expandedStates.length;
  const dominatedFraction = mt2ExpandedStates > 0 ? paretoDominatedCount / mt2ExpandedStates : 0;
  const multiVariantFraction = mt2ExpandedStates > 0 ? resourceVariantStateCount / mt2ExpandedStates : 0;

  return {
    mt2ExpandedStates,
    structuralGroupCount,
    multiVariantGroupCount,
    resourceVariantStateCount,
    maxVariantsInGroup,
    paretoNondominatedCount,
    paretoDominatedCount,
    dominatedFraction,
    multiVariantFraction,
  };
}

module.exports = {
  buildStructuralStateKey,
  extractResourceVector,
  paretoDominates,
  createResourceSkylineSet,
  analyzeResourceVariantPressure,
};
