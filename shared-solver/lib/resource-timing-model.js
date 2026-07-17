"use strict";

const { buildStateKey } = require("./state-key");
const {
  estimateBattleSurvivability,
  parseBattleSummary,
} = require("./battle-thresholds");

const MODEL_VERSION = "breakpoint-v1";
const TIMING_BY_STATE = new WeakMap();

const DEFAULTS = Object.freeze({
  model: MODEL_VERSION,
  targetLimit: 16,
  resourceLimit: 4,
  thresholdLimit: 3,
  skylineMax: 4,
  materialPremium: 1000,
  maxHpProbe: 1000000000,
});

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function effectiveHeroValue(state, field) {
  const hero = (state && state.hero) || {};
  const flags = (state && state.flags) || {};
  return Math.floor(number(hero[field], 0) * number(flags[`__${field}_buff__`], 1));
}

function heroSummary(state) {
  const hero = (state && state.hero) || {};
  return {
    hp: number(hero.hp, 0),
    atk: effectiveHeroValue(state, "atk"),
    def: effectiveHeroValue(state, "def"),
    mdef: effectiveHeroValue(state, "mdef"),
    lv: number(hero.lv, 0),
    equipment: Array.isArray(hero.equipment) ? hero.equipment.slice().sort() : [],
  };
}

function actionDelta(before, after) {
  const left = heroSummary(before);
  const right = heroSummary(after);
  return {
    hp: right.hp - left.hp,
    atk: right.atk - left.atk,
    def: right.def - left.def,
    mdef: right.mdef - left.mdef,
    lv: right.lv - left.lv,
    equipmentAdded: right.equipment.filter((item) => !left.equipment.includes(item)),
  };
}

function resourceKind(action, delta) {
  const change = delta || {};
  const kind = action && action.kind;
  const statGain = number(change.atk, 0) > 0 ||
    number(change.def, 0) > 0 ||
    number(change.mdef, 0) > 0 ||
    number(change.lv, 0) > 0;
  const equipmentGain = Array.isArray(change.equipmentAdded) && change.equipmentAdded.length > 0;
  const hpGain = number(change.hp, 0) > 0;
  if (!["pickup", "interactPickup", "equip", "event", "battle"].includes(kind)) return null;
  if (!hpGain && !statGain && !equipmentGain) return null;
  if (equipmentGain || kind === "equip") return "equipment";
  if (statGain) return "stat";
  return "hp";
}

function actionKey(simulator, action) {
  if (!action) return "";
  if (simulator && typeof simulator.getActionFingerprint === "function") {
    return simulator.getActionFingerprint(action) || action.summary || "";
  }
  return action.summary || `${action.kind || ""}:${action.floorId || ""}:${action.x || ""},${action.y || ""}`;
}

function targetKey(target) {
  return `${target.floorId}:${target.x},${target.y}:${target.enemyId}`;
}

function collectBattleTargets(simulator, state, segment, options) {
  const config = { ...DEFAULTS, ...(options || {}) };
  const goal = (segment && segment.goal) || {};
  const targets = new Map();
  const add = (target, priority, source, summary) => {
    if (!target || !target.floorId || !target.enemyId || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return;
    const key = targetKey(target);
    const existing = targets.get(key);
    const record = { ...target, priority, source, summary: summary || null };
    if (!existing || priority > existing.priority) targets.set(key, record);
  };
  const addSummary = (summary, priority, source) => {
    const parsed = parseBattleSummary(summary);
    if (parsed) add(parsed, priority, source, summary);
  };
  addSummary(goal.actionSurvivable && goal.actionSurvivable.summary, 100, "goal-action-survivable");
  (goal.resourceTimingTargets || []).forEach((summary) => addSummary(summary, 95, "goal-timing-target"));
  (goal.battleTargets || []).forEach((summary) => addSummary(summary, 90, "goal-battle-target"));
  let actions = [];
  try {
    actions = (simulator.enumeratePrimitiveActions(state).actions || []);
  } catch (error) {
    actions = [];
  }
  if (typeof simulator.enumerateInteractPickupActions === "function") {
    try {
      actions = actions.concat(simulator.enumerateInteractPickupActions(state) || []);
    } catch (error) {
      // Optional face-pick actions are unavailable on most floors.
    }
  }
  actions.filter((action) => action && action.kind === "battle").forEach((action, index) => {
    addSummary(action.summary, 80 - Math.min(index, 20), "reachable-frontier");
  });
  return Array.from(targets.values())
    .sort((left, right) => right.priority - left.priority || targetKey(left).localeCompare(targetKey(right)))
    .slice(0, Math.max(1, config.targetLimit));
}

function battleActionAvailable(simulator, state, target) {
  try {
    return (simulator.enumeratePrimitiveActions(state).actions || [])
      .some((action) => action && action.kind === "battle" && action.summary === target.summary);
  } catch (error) {
    return false;
  }
}

function evaluateTarget(simulator, state, target, options) {
  const config = options || {};
  const result = estimateBattleSurvivability(simulator, state, target, {
    maxHp: number(config.maxHpProbe, DEFAULTS.maxHpProbe),
    skipMinHp: config.calculateThresholds !== true,
  });
  if (!result || !result.supported) return null;
  return {
    target: {
      floorId: target.floorId,
      x: target.x,
      y: target.y,
      enemyId: target.enemyId,
      summary: target.summary || `battle:${target.enemyId}@${target.floorId}:${target.x},${target.y}`,
    },
    supported: true,
    currentHp: result.currentHp,
    damage: result.currentDamage,
    turn: result.currentTurn,
    survivable: result.survivable,
    minHpToSurvive: result.minHpToSurvive,
    nonMonotonic: result.nonMonotonic === true,
  };
}

function analyzeResourceTransition(simulator, beforeState, action, afterState, segment, options) {
  const config = { ...DEFAULTS, ...(options || {}) };
  const delta = actionDelta(beforeState, afterState);
  const kind = resourceKind(action, delta);
  if (!kind || config.model === "off") return null;
  const targets = collectBattleTargets(simulator, beforeState, segment, config);
  const afterTargets = collectBattleTargets(simulator, afterState, segment, config);
  const byKey = new Map(afterTargets.map((target) => [targetKey(target), target]));
  targets.forEach((target) => byKey.set(targetKey(target), target));
  const breakpointTargets = [];
  let projectedDamageSaving = 0;
  let projectedTurnSaving = 0;
  let newlySurvivableTargets = 0;
  let deferredReachable = false;
  let immediateReachable = false;
  for (const target of Array.from(byKey.values()).slice(0, config.targetLimit)) {
    const before = evaluateTarget(simulator, beforeState, target, config);
    const after = evaluateTarget(simulator, afterState, target, config);
    if (!before || !after) continue;
    const availableBefore = battleActionAvailable(simulator, beforeState, target);
    const availableAfter = battleActionAvailable(simulator, afterState, target);
    const newlySurvivable = !before.survivable && after.survivable;
    if (availableBefore && before.survivable) deferredReachable = true;
    if (availableAfter && after.survivable) immediateReachable = true;
    const damageSaving = Math.max(0, before.damage - after.damage);
    const turnSaving = Math.max(0, before.turn - after.turn);
    projectedDamageSaving += damageSaving;
    projectedTurnSaving += turnSaving;
    if (newlySurvivable || damageSaving > 0 || turnSaving > 0) {
      if (newlySurvivable) newlySurvivableTargets += 1;
      let beforeThreshold = before.minHpToSurvive;
      let afterThreshold = after.minHpToSurvive;
      if (config.calculateThresholds === true && (newlySurvivable || damageSaving > 0)) {
        const thresholdBefore = estimateBattleSurvivability(simulator, beforeState, target, {
          maxHp: number(config.maxHpProbe, DEFAULTS.maxHpProbe),
          skipMinHp: false,
        });
        const thresholdAfter = estimateBattleSurvivability(simulator, afterState, target, {
          maxHp: number(config.maxHpProbe, DEFAULTS.maxHpProbe),
          skipMinHp: false,
        });
        beforeThreshold = thresholdBefore && thresholdBefore.minHpToSurvive;
        afterThreshold = thresholdAfter && thresholdAfter.minHpToSurvive;
      }
      breakpointTargets.push({
        ...target,
        before: {
          damage: before.damage,
          turn: before.turn,
          survivable: before.survivable,
          minHpToSurvive: beforeThreshold,
        },
        after: {
          damage: after.damage,
          turn: after.turn,
          survivable: after.survivable,
          minHpToSurvive: afterThreshold,
        },
        availableBefore,
        availableAfter,
        newlySurvivable,
        damageSaving,
        turnSaving,
      });
    }
  }
  const retainedResourceValue = deferredReachable && (
    projectedDamageSaving > 0 || projectedTurnSaving > 0 || newlySurvivableTargets > 0
  )
    ? projectedDamageSaving * 100 + projectedTurnSaving * 1000 + newlySurvivableTargets * 100000
    : 0;
  const deferPremium = retainedResourceValue > 0 && deferredReachable && immediateReachable
    ? retainedResourceValue
    : 0;
  const roles = [];
  if (deferPremium > config.materialPremium) roles.push("retained-resource-option");
  if (newlySurvivableTargets > 0) roles.push("combat-breakpoint");
  if (projectedDamageSaving > 0 || projectedTurnSaving > 0) roles.push("future-combat-saving");
  const resource = {
    key: actionKey(simulator, action),
    summary: action.summary || null,
    kind,
    floorId: action.floorId || beforeState.floorId,
    x: action.x == null ? null : Number(action.x),
    y: action.y == null ? null : Number(action.y),
    effects: delta,
    immediateReachable,
    deferredReachable,
    retainedResourceValue,
    deferPremium,
    projectedDamageSaving,
    projectedTurnSaving,
    newlySurvivableTargets,
    breakpointTargets: breakpointTargets.slice(0, config.thresholdLimit),
    roles,
    proofActions: breakpointTargets.slice(0, config.thresholdLimit).map((entry) => entry.summary),
    stoppedReason: breakpointTargets.length === 0 ? "no-combat-breakpoint" : null,
  };
  return resource;
}

function resourceTimingScore(timing) {
  const value = timing || {};
  const retainedOptionValue = value.retainedOptionValue != null
    ? value.retainedOptionValue
    : value.retainedResourceValue != null
      ? value.retainedResourceValue
      : value.deferPremium;
  return number(retainedOptionValue, 0) +
    number(value.projectedDamageSaving, 0) * 25 +
    number(value.newlySurvivableTargets, 0) * 100000 +
    number(value.currentTargetProgress, 0) * 1000;
}

function getTiming(state) {
  if (!state) return null;
  return TIMING_BY_STATE.get(state) || state.resourceTiming || null;
}

function setTiming(state, timing) {
  if (!state || typeof state !== "object") return state;
  if (timing == null) {
    TIMING_BY_STATE.delete(state);
    return state;
  }
  TIMING_BY_STATE.set(state, timing);
  return state;
}

function timingRecords(state) {
  const timing = getTiming(state);
  return timing && Array.isArray(timing.resources) ? timing.resources : [];
}

function resourceTimingRoles(state) {
  const timing = getTiming(state);
  const roles = timing && Array.isArray(timing.roles) ? timing.roles.slice() : [];
  return roles.length > 0 ? roles : ["highest-hp"];
}

function hasTimingConflict(left, right, options) {
  const config = { ...DEFAULTS, ...(options || {}) };
  const leftRecords = timingRecords(left);
  const rightRecords = timingRecords(right);
  if (leftRecords.length === 0 && rightRecords.length === 0) return false;
  if (leftRecords.length === 0 || rightRecords.length === 0) {
    const records = leftRecords.length > 0 ? leftRecords : rightRecords;
    return Math.max(...records.map(resourceTimingScore)) > config.materialPremium;
  }
  const leftBest = Math.max(...leftRecords.map(resourceTimingScore));
  const rightBest = Math.max(...rightRecords.map(resourceTimingScore));
  const leftRoles = new Set(leftRecords.flatMap((record) => record.roles || []));
  const rightRoles = new Set(rightRecords.flatMap((record) => record.roles || []));
  const roleDifference = Array.from(new Set([...leftRoles, ...rightRoles]))
    .some((role) => leftRoles.has(role) !== rightRoles.has(role));
  return roleDifference || Math.abs(leftBest - rightBest) > config.materialPremium;
}

function compareResourceTimingStates(left, right, fallbackCompare, options) {
  if (!right) return 1;
  const config = { ...DEFAULTS, ...(options || {}) };
  const leftTiming = getTiming(left);
  const rightTiming = getTiming(right);
  if (leftTiming && rightTiming) {
    const leftScore = resourceTimingScore(leftTiming);
    const rightScore = resourceTimingScore(rightTiming);
    if (hasTimingConflict(left, right, config) && leftScore !== rightScore) return leftScore - rightScore;
  }
  if (typeof fallbackCompare === "function") return fallbackCompare(left, right);
  return number((left && left.hero && left.hero.hp), 0) - number((right && right.hero && right.hero.hp), 0);
}

function analyzeStateResourceTiming(simulator, state, segment, options, context) {
  const config = { ...DEFAULTS, ...(options || {}) };
  if (config.model === "off") return null;
  const cache = context && context.cache instanceof Map ? context.cache : null;
  let cacheKey = null;
  try {
    cacheKey = JSON.stringify({
      version: MODEL_VERSION,
      state: buildStateKey(state),
      segment: segment && segment.id,
      goal: segment && segment.goal,
      policy: segment && segment.actionPolicy,
      config: {
        model: config.model,
        targetLimit: config.targetLimit,
        resourceLimit: config.resourceLimit,
        thresholdLimit: config.thresholdLimit,
        calculateThresholds: config.calculateThresholds === true,
        maxHpProbe: config.maxHpProbe,
      },
    });
  } catch (error) {
    cacheKey = null;
  }
  if (cache && cacheKey && cache.has(cacheKey)) return cache.get(cacheKey);
  let actions = [];
  try {
    actions = (simulator.enumeratePrimitiveActions(state).actions || []);
  } catch (error) {
    actions = [];
  }
  if (typeof simulator.enumerateInteractPickupActions === "function") {
    try {
      actions = actions.concat(simulator.enumerateInteractPickupActions(state) || []);
    } catch (error) {
      // Optional face-pick actions are unavailable on most floors.
    }
  }
  const resourceActions = actions
    .filter((action) => action && ["pickup", "interactPickup", "equip", "event", "battle"].includes(action.kind))
    .sort((left, right) => {
      const priority = (action) => ["pickup", "interactPickup", "equip", "event"].includes(action.kind) ? 0 : 1;
      return priority(left) - priority(right) || String(left.summary || "").localeCompare(String(right.summary || ""));
    });
  const resources = [];
  for (const action of resourceActions.slice(0, Math.max(config.resourceLimit * 2, config.resourceLimit))) {
    let afterState;
    try {
      afterState = typeof simulator.applyActionPreview === "function"
        ? simulator.applyActionPreview(state, action)
        : simulator.applyAction(state, action, { storeRoute: false });
    } catch (error) {
      continue;
    }
    const record = analyzeResourceTransition(simulator, state, action, afterState, segment, config);
    if (record) resources.push(record);
  }
  resources.sort((left, right) => resourceTimingScore(right) - resourceTimingScore(left) || String(left.key).localeCompare(String(right.key)));
  const best = resources[0] || null;
  const summary = {
    model: config.model,
    resources,
    bestResourceKey: best && best.key,
    retainedOptionValue: best ? resourceTimingScore(best) : 0,
    projectedDamageSaving: resources.reduce((sum, record) => sum + number(record.projectedDamageSaving, 0), 0),
    newlySurvivableTargets: resources.reduce((sum, record) => sum + number(record.newlySurvivableTargets, 0), 0),
    conflict: resources.length > 1 && resources.some((record) => record.deferPremium > config.materialPremium),
    roles: Array.from(new Set(resources.flatMap((record) => record.roles || []))),
    cacheKey,
  };
  if (cache && cacheKey) cache.set(cacheKey, summary);
  return summary;
}

function annotateStateResourceTiming(simulator, state, segment, options, context) {
  if (!state || (options || {}).model === "off") return state;
  const timing = analyzeStateResourceTiming(simulator, state, segment, options, context);
  if (timing) setTiming(state, timing);
  return state;
}

function buildResourceTimingOptions(dpConfig, segment, overrides) {
  return {
    ...DEFAULTS,
    ...((segment && segment.resourceTiming) || {}),
    ...(dpConfig || {}),
    ...(overrides || {}),
    model: (overrides && overrides.resourceTimingModel) ||
      (dpConfig && dpConfig.resourceTimingModel) ||
      (segment && segment.resourceTimingModel) ||
      DEFAULTS.model,
    targetLimit: number(
      overrides && overrides.resourceTimingTargetLimit != null
        ? overrides.resourceTimingTargetLimit
        : dpConfig && dpConfig.resourceTimingTargetLimit,
      DEFAULTS.targetLimit,
    ),
    resourceLimit: number(
      overrides && overrides.resourceTimingResourceLimit != null
        ? overrides.resourceTimingResourceLimit
        : dpConfig && dpConfig.resourceTimingResourceLimit,
      DEFAULTS.resourceLimit,
    ),
    thresholdLimit: number(
      overrides && overrides.resourceTimingThresholdLimit != null
        ? overrides.resourceTimingThresholdLimit
        : dpConfig && dpConfig.resourceTimingThresholdLimit,
      DEFAULTS.thresholdLimit,
    ),
    calculateThresholds: Boolean(
      (overrides && overrides.resourceTimingCalculateThresholds) ||
      (dpConfig && dpConfig.resourceTimingCalculateThresholds) ||
      (segment && segment.goal && segment.goal.actionSurvivable),
    ),
    skylineMax: number(
      overrides && overrides.resourceTimingSkylineMax != null
        ? overrides.resourceTimingSkylineMax
        : dpConfig && dpConfig.resourceTimingSkylineMax,
      DEFAULTS.skylineMax,
    ),
  };
}

module.exports = {
  DEFAULTS,
  MODEL_VERSION,
  actionDelta,
  analyzeResourceTransition,
  analyzeStateResourceTiming,
  annotateStateResourceTiming,
  buildResourceTimingOptions,
  compareResourceTimingStates,
  collectBattleTargets,
  getTiming,
  setTiming,
  hasTimingConflict,
  resourceKind,
  resourceTimingRoles,
  resourceTimingScore,
};
