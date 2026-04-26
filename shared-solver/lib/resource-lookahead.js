"use strict";

const { getFloorOrder } = require("./score");
const { buildStateKey } = require("./state-key");
const { cloneState } = require("./state");

const DEFAULT_OPTIONS = {
  maxDepth: 8,
  maxNodes: 8,
  branchLimit: 3,
  frontierLimit: 5,
  allowBackwardChangeFloor: true,
  allowForwardChangeFloor: true,
  maxFloorOrderDelta: 1,
  includeResourcePocket: false,
  includeFightToLevelUp: false,
  hpWeight: 3,
  atkWeight: 9000,
  defWeight: 8000,
  mdefWeight: 800,
  expWeight: 600,
  equipmentWeight: 60000,
  forwardReadyWeight: 100000,
  returnResourceWeight: 80000,
  followupWeight: 0.2,
  unlockFollowupWeight: 0.85,
  followupLimit: 8,
};

function createResourceLookaheadCache() {
  const cache = new Map();
  cache.stats = { hits: 0, misses: 0, stores: 0, evictions: 0, computeMs: 0, estimatedMsSaved: 0 };
  return cache;
}

function recordCacheHit(cache) {
  if (!cache || !cache.stats) return;
  const stats = cache.stats;
  stats.hits += 1;
  const avgComputeMs = stats.stores > 0 ? Number(stats.computeMs || 0) / stats.stores : 0;
  stats.estimatedMsSaved = Number(stats.estimatedMsSaved || 0) + avgComputeMs;
}

function storeCacheResult(cache, key, result, startedAt) {
  if (!cache || !key) return result;
  cache.set(key, result);
  if (cache.stats) {
    cache.stats.stores += 1;
    cache.stats.computeMs = Number(cache.stats.computeMs || 0) + Math.max(0, Date.now() - startedAt);
  }
  return result;
}

function heroSummary(state) {
  const hero = state.hero || {};
  return {
    floorId: state.floorId,
    hp: Number(hero.hp || 0),
    atk: Number(hero.atk || 0),
    def: Number(hero.def || 0),
    mdef: Number(hero.mdef || 0),
    lv: Number(hero.lv || 0),
    exp: Number(hero.exp || 0),
    equipment: Array.isArray(hero.equipment) ? hero.equipment.slice() : [],
  };
}

function deltaSummary(before, after) {
  const beforeHero = before.hero || {};
  const afterHero = after.hero || {};
  return {
    hp: Number(afterHero.hp || 0) - Number(beforeHero.hp || 0),
    atk: Number(afterHero.atk || 0) - Number(beforeHero.atk || 0),
    def: Number(afterHero.def || 0) - Number(beforeHero.def || 0),
    mdef: Number(afterHero.mdef || 0) - Number(beforeHero.mdef || 0),
    lv: Number(afterHero.lv || 0) - Number(beforeHero.lv || 0),
    exp: Number(afterHero.exp || 0) - Number(beforeHero.exp || 0),
    money: Number(afterHero.money || 0) - Number(beforeHero.money || 0),
  };
}

function gainedEquipment(before, after) {
  const beforeSet = new Set((before.hero && before.hero.equipment) || []);
  return ((after.hero && after.hero.equipment) || []).filter((itemId) => !beforeSet.has(itemId));
}

function isForwardChangeFloor(state, action) {
  if (!action || action.kind !== "changeFloor") return false;
  const target = action.changeFloor && action.changeFloor.floorId;
  const currentOrder = getFloorOrder(state.floorId);
  if (target === ":next") return true;
  return getFloorOrder(target) > currentOrder;
}

function isBackwardChangeFloor(state, action) {
  if (!action || action.kind !== "changeFloor") return false;
  const target = action.changeFloor && action.changeFloor.floorId;
  const currentOrder = getFloorOrder(state.floorId);
  if (target === ":before") return true;
  return getFloorOrder(target) < currentOrder;
}

function targetFloorOrder(state, action) {
  if (!action || action.kind !== "changeFloor") return getFloorOrder(state.floorId);
  const target = action.changeFloor && action.changeFloor.floorId;
  const current = getFloorOrder(state.floorId);
  if (target === ":next") return current + 1;
  if (target === ":before") return current - 1;
  return getFloorOrder(target);
}

function isAllowedLookaheadAction(baseState, currentState, action, options) {
  if (!action) return false;
  if (action.kind === "resourcePocket") return options.includeResourcePocket === true;
  if (action.kind === "fightToLevelUp") return options.includeFightToLevelUp === true;
  if (action.kind === "event") return action.hasStateChange && !action.unsupported;
  if (!["battle", "pickup", "equip", "openDoor", "useTool", "changeFloor"].includes(action.kind)) return false;
  if (action.kind !== "changeFloor") return true;
  if (isForwardChangeFloor(currentState, action) && options.allowForwardChangeFloor === false) return false;
  if (isBackwardChangeFloor(currentState, action) && options.allowBackwardChangeFloor === false) return false;
  const delta = Math.abs(targetFloorOrder(currentState, action) - getFloorOrder(baseState.floorId));
  return delta <= Number(options.maxFloorOrderDelta || 1);
}

function positiveResourceScore(delta, options) {
  return (
    Math.max(0, Number((delta || {}).atk || 0)) * options.atkWeight +
    Math.max(0, Number((delta || {}).def || 0)) * options.defWeight +
    Math.max(0, Number((delta || {}).mdef || 0)) * options.mdefWeight +
    Math.max(0, Number((delta || {}).exp || 0)) * options.expWeight +
    Math.max(0, Number((delta || {}).lv || 0)) * 60000 +
    Math.max(0, Number((delta || {}).money || 0)) * 50
  );
}

function bestImmediateFollowupScore(simulator, baseState, nextState, options) {
  const weight = Number(options.followupWeight || 0);
  if (weight <= 0) return 0;
  let actions;
  try {
    actions = simulator.enumeratePrimitiveActions(nextState).actions;
  } catch (error) {
    return 0;
  }
  let best = 0;
  actions
    .filter((candidate) => isAllowedLookaheadAction(baseState, nextState, candidate, options))
    .slice(0, Math.max(1, Number(options.followupLimit || DEFAULT_OPTIONS.followupLimit)))
    .forEach((candidate) => {
      try {
        const followState = applyActionPreview(simulator, nextState, candidate);
        best = Math.max(best, positiveResourceScore(deltaSummary(nextState, followState), options));
      } catch (error) {
        // Ignore invalid preview candidates.
      }
    });
  return best * weight;
}

function actionKey(simulator, action) {
  if (!action) return "";
  if (simulator && typeof simulator.getActionFingerprint === "function") {
    return simulator.getActionFingerprint(action) || action.summary || "";
  }
  return action.summary || `${action.kind || ""}:${action.floorId || ""}`;
}

function bestUnlockedFollowupScore(simulator, baseState, currentState, nextState, options) {
  const weight = Number(options.unlockFollowupWeight || 0);
  if (weight <= 0) return 0;
  let beforeActions;
  let afterActions;
  try {
    beforeActions = simulator.enumeratePrimitiveActions(currentState).actions;
    afterActions = simulator.enumeratePrimitiveActions(nextState).actions;
  } catch (error) {
    return 0;
  }
  const beforeKeys = new Set((beforeActions || []).map((action) => actionKey(simulator, action)).filter(Boolean));
  let best = 0;
  (afterActions || [])
    .filter((candidate) => !beforeKeys.has(actionKey(simulator, candidate)))
    .filter((candidate) => isAllowedLookaheadAction(baseState, nextState, candidate, options))
    .forEach((candidate) => {
      try {
        const followState = applyActionPreview(simulator, nextState, candidate);
        best = Math.max(best, positiveResourceScore(deltaSummary(nextState, followState), options));
      } catch (error) {
        // Ignore invalid preview candidates.
      }
    });
  return best * weight;
}

function localActionScore(simulator, baseState, currentState, action, options) {
  let score = 0;
  if (action.kind === "pickup") score += 90000;
  if (action.kind === "equip") score += 110000;
  if (action.kind === "openDoor" || action.kind === "useTool") score += 30000;
  if (action.kind === "changeFloor") {
    if (isForwardChangeFloor(currentState, action)) score += 55000;
    else if (isBackwardChangeFloor(currentState, action)) score += 25000;
    else score += 15000;
  }
  if (action.kind === "battle") {
    const damage = Number((action.estimate || {}).damage || 0);
    const hp = Number((currentState.hero || {}).hp || 0);
    const ratio = hp > 0 ? damage / hp : 1;
    score += Number((action.estimate || {}).exp || 0) * 1800;
    if (damage === 0) score += 55000;
    else if (ratio <= 0.12) score += 32000;
    else if (ratio <= 0.45) score += 12000;
    score -= Math.min(90000, damage * 10);
  }
  try {
    const nextState = applyActionPreview(simulator, currentState, action);
    const stepDelta = deltaSummary(currentState, nextState);
    const totalDelta = deltaSummary(baseState, nextState);
    score += positiveResourceScore(stepDelta, options);
    score += positiveResourceScore(totalDelta, options) * 0.15;
    score += gainedEquipment(currentState, nextState).length * 60000;
    score += bestUnlockedFollowupScore(simulator, baseState, currentState, nextState, options);
    score += bestImmediateFollowupScore(simulator, baseState, nextState, options);
  } catch (error) {
    score -= 1000000;
  }
  return score;
}

function applyActionPreview(simulator, state, action) {
  if (simulator && typeof simulator.applyActionPreview === "function") {
    return simulator.applyActionPreview(state, action);
  }
  return simulator.applyAction(state, action, { storeRoute: false });
}

function hasForwardPrimitive(simulator, state) {
  try {
    return simulator.enumeratePrimitiveActions(state).actions.some((action) => isForwardChangeFloor(state, action));
  } catch (error) {
    return false;
  }
}

function computeLookaheadScore(simulator, baseState, firstState, node, options) {
  const final = node.state;
  const delta = deltaSummary(baseState, final);
  const equipment = gainedEquipment(baseState, final);
  const baseOrder = getFloorOrder(baseState.floorId);
  const finalOrder = getFloorOrder(final.floorId);
  const reachedForwardFloor = node.reachedForwardFloor || finalOrder > baseOrder;
  const returnedToPreviousFloor = node.returnedToPreviousFloor || (node.reachedForwardFloor && final.floorId === baseState.floorId);
  const openedResourceChain = Boolean(
    delta.atk > 0 || delta.def > 0 || delta.mdef > 0 || equipment.length > 0 || reachedForwardFloor || hasForwardPrimitive(simulator, final)
  );
  const immediateDamage = Math.max(0, Number((baseState.hero || {}).hp || 0) - Number((firstState.hero || {}).hp || 0));
  let score = 0;
  score += Math.max(0, delta.atk) * options.atkWeight;
  score += Math.max(0, delta.def) * options.defWeight;
  score += Math.max(0, delta.mdef) * options.mdefWeight;
  score += Math.max(0, delta.exp) * options.expWeight;
  score += Number((final.hero || {}).hp || 0) * options.hpWeight;
  score += equipment.length * options.equipmentWeight;
  if (reachedForwardFloor) score += options.forwardReadyWeight;
  if (returnedToPreviousFloor && openedResourceChain) score += options.returnResourceWeight;
  if (openedResourceChain) score += 120000;
  score -= immediateDamage * 40;
  score -= (node.planEntries || []).length * 1000;
  return { score, delta, equipment, reachedForwardFloor, returnedToPreviousFloor, openedResourceChain };
}

function compareNodes(simulator, baseState, left, right, options) {
  const leftScore = computeLookaheadScore(simulator, baseState, left.firstState, left, options).score;
  const rightScore = computeLookaheadScore(simulator, baseState, right.firstState, right, options).score;
  if (leftScore !== rightScore) return rightScore - leftScore;
  return Number((right.state.hero || {}).hp || 0) - Number((left.state.hero || {}).hp || 0);
}

function combatKey(state) {
  const hero = (state || {}).hero || {};
  return [
    (state || {}).floorId || "",
    Number(hero.atk || 0),
    Number(hero.def || 0),
    Number(hero.mdef || 0),
    Number(hero.lv || 0),
    Number(hero.exp || 0),
  ].join("|");
}

function selectLookaheadFrontier(simulator, baseState, nodes, options) {
  const limit = Math.max(1, Number(options.frontierLimit || DEFAULT_OPTIONS.frontierLimit));
  const selected = [];
  const seen = new Set();
  const add = (node) => {
    if (!node || selected.length >= limit) return;
    const key = buildStateKey(node.state);
    if (seen.has(key)) return;
    seen.add(key);
    selected.push(node);
  };
  const byScore = (nodes || []).slice().sort((left, right) => compareNodes(simulator, baseState, left, right, options));
  byScore.slice(0, Math.max(1, Math.ceil(limit * 0.6))).forEach(add);
  (nodes || [])
    .slice()
    .sort((left, right) =>
      Number((right.state.hero || {}).hp || 0) - Number((left.state.hero || {}).hp || 0) ||
      compareNodes(simulator, baseState, left, right, options)
    )
    .slice(0, Math.max(1, Math.ceil(limit * 0.25)))
    .forEach(add);
  const bestByCombat = new Map();
  (nodes || []).forEach((node) => {
    const key = combatKey(node.state);
    const existing = bestByCombat.get(key);
    if (!existing || Number((node.state.hero || {}).hp || 0) > Number((existing.state.hero || {}).hp || 0)) {
      bestByCombat.set(key, node);
    }
  });
  Array.from(bestByCombat.values())
    .sort((left, right) => compareNodes(simulator, baseState, left, right, options))
    .forEach(add);
  byScore.forEach(add);
  return selected;
}

function evaluateActionResourceLookahead(simulator, state, action, providedOptions) {
  const options = { ...DEFAULT_OPTIONS, ...(providedOptions || {}) };
  const cache = options.cache;
  const fingerprint = simulator.getActionFingerprint ? simulator.getActionFingerprint(action) : action.summary;
  const cacheKey = cache ? `${buildStateKey(state)}|${fingerprint || action.summary || ""}` : null;
  if (cache && cache.has(cacheKey)) {
    recordCacheHit(cache);
    return cache.get(cacheKey);
  }
  if (cache && cache.stats) cache.stats.misses += 1;
  const startedAt = Date.now();

  const invalid = (reason) => ({ valid: false, score: 0, reason, depth: 0, expanded: 0, bestPlan: [], bestPlanEntries: [] });
  if (!isAllowedLookaheadAction(state, state, action, options)) {
    const result = invalid("action-not-allowed");
    return storeCacheResult(cache, cacheKey, result, startedAt);
  }

  let firstState;
  try {
    firstState = applyActionPreview(simulator, state, action);
  } catch (error) {
    const result = invalid("first-action-failed");
    return storeCacheResult(cache, cacheKey, result, startedAt);
  }

  const firstReachedForward = action.kind === "changeFloor" && isForwardChangeFloor(state, action);
  const firstReturned = action.kind === "changeFloor" && isBackwardChangeFloor(state, action);
  const firstEntry = simulator.normalizePocketStep ? simulator.normalizePocketStep(action) : { kind: action.kind, summary: action.summary };
  const root = {
    state: firstState,
    firstState,
    planEntries: [firstEntry],
    depth: 1,
    reachedForwardFloor: firstReachedForward || getFloorOrder(firstState.floorId) > getFloorOrder(state.floorId),
    returnedToPreviousFloor: firstReturned,
  };
  let frontier = [root];
  let best = root;
  let expanded = 0;
  const seen = new Map();

  for (let depth = 1; depth < options.maxDepth && frontier.length > 0 && expanded < options.maxNodes; depth += 1) {
    const nextFrontier = [];
    for (const node of frontier) {
      if (expanded >= options.maxNodes) break;
      expanded += 1;
      let actions;
      try {
        actions = simulator.enumeratePrimitiveActions(node.state).actions;
      } catch (error) {
        continue;
      }
      actions
        .filter((candidate) => isAllowedLookaheadAction(state, node.state, candidate, options))
        .map((candidate) => ({ action: candidate, score: localActionScore(simulator, state, node.state, candidate, options) }))
        .sort((left, right) => right.score - left.score)
        .slice(0, options.branchLimit)
        .forEach((candidate) => {
          let nextState;
          try {
            nextState = applyActionPreview(simulator, node.state, candidate.action);
          } catch (error) {
            return;
          }
          const key = buildStateKey(nextState);
          const previous = seen.get(key);
          if (previous && Number((previous.hero || {}).hp || 0) >= Number((nextState.hero || {}).hp || 0)) return;
          seen.set(key, cloneState(nextState));
          const nextOrder = getFloorOrder(nextState.floorId);
          const baseOrder = getFloorOrder(state.floorId);
          const nextNode = {
            state: nextState,
            firstState,
            planEntries: node.planEntries.concat([
              simulator.normalizePocketStep ? simulator.normalizePocketStep(candidate.action) : { kind: candidate.action.kind, summary: candidate.action.summary },
            ]),
            depth: node.depth + 1,
            reachedForwardFloor: node.reachedForwardFloor || nextOrder > baseOrder,
            returnedToPreviousFloor: node.returnedToPreviousFloor || (node.reachedForwardFloor && nextState.floorId === state.floorId) || (candidate.action.kind === "changeFloor" && isBackwardChangeFloor(node.state, candidate.action)),
          };
          if (compareNodes(simulator, state, nextNode, best, options) < 0) best = nextNode;
          nextFrontier.push(nextNode);
        });
    }
    frontier = selectLookaheadFrontier(simulator, state, nextFrontier, options);
  }

  const computed = computeLookaheadScore(simulator, state, firstState, best, options);
  const result = {
    valid: true,
    score: computed.score,
    depth: best.depth,
    expanded,
    bestPlan: best.planEntries.map((entry) => entry.summary),
    bestPlanEntries: best.planEntries,
    bestStateSummary: heroSummary(best.state),
    delta: computed.delta,
    gainedEquipment: computed.equipment,
    reachedForwardFloor: computed.reachedForwardFloor,
    returnedToPreviousFloor: computed.returnedToPreviousFloor,
    openedResourceChain: computed.openedResourceChain,
    reason: computed.openedResourceChain ? "resource-chain" : "best-preview",
  };
  return storeCacheResult(cache, cacheKey, result, startedAt);
}

module.exports = {
  createResourceLookaheadCache,
  evaluateActionResourceLookahead,
};
