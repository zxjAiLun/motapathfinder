"use strict";

const { buildDpStateKey, searchDP } = require("./dp-search");
const { estimateBattleSurvivability } = require("./battle-thresholds");
const { formatActionLabel } = require("./enemy-labels");
const { buildSolverSnapshot } = require("./route-snapshot");
const { getTileDefinitionAt, cloneState } = require("./state");

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function effectiveHeroValue(state, field) {
  const hero = (state || {}).hero || {};
  const flags = (state || {}).flags || {};
  return Math.floor(number(hero[field], 0) * number(flags[`__${field}_buff__`], 1));
}

function summarizeHero(state) {
  const hero = (state || {}).hero || {};
  return {
    hp: number(hero.hp, 0),
    atk: number(hero.atk, 0),
    def: number(hero.def, 0),
    mdef: number(hero.mdef, 0),
    lv: number(hero.lv, 0),
    exp: number(hero.exp, 0),
    money: number(hero.money, 0),
    equipment: Array.isArray(hero.equipment) ? hero.equipment.slice() : [],
  };
}

function summarizeEffectiveHero(state) {
  const hero = summarizeHero(state);
  return {
    hp: hero.hp,
    atk: effectiveHeroValue(state, "atk"),
    def: effectiveHeroValue(state, "def"),
    mdef: effectiveHeroValue(state, "mdef"),
    lv: hero.lv,
    exp: hero.exp,
  };
}

function hasEquipment(state, itemId) {
  return Array.isArray(((state || {}).hero || {}).equipment) && state.hero.equipment.includes(itemId);
}

function findPrimitiveAction(simulator, state, summary) {
  try {
    return (simulator.enumeratePrimitiveActions(state).actions || []).find((action) => action.summary === summary) || null;
  } catch (error) {
    return null;
  }
}

function checkMinFields(actual, expected, prefix, missing) {
  Object.entries(expected || {}).forEach(([field, value]) => {
    const got = number(actual[field], 0);
    if (got < Number(value)) {
      missing.push({ field: `${prefix}.${field}`, expected: Number(value), actual: got });
    }
  });
}

function buildActionSurvivableMissing(simulator, state, summary, action) {
  const threshold = estimateBattleSurvivability(simulator, state, action || summary);
  const currentHp = number((state.hero || {}).hp, 0);
  const damage = threshold && threshold.supported
    ? number(threshold.currentDamage, Number.POSITIVE_INFINITY)
    : number(((action || {}).estimate || {}).damage, Number.POSITIVE_INFINITY);
  const entry = {
    field: "actionSurvivable",
    expected: Number.isFinite(damage) ? `hp > ${damage}` : summary,
    actual: currentHp,
    action: summary,
  };
  if (threshold && threshold.supported) {
    entry.damage = threshold.currentDamage;
    entry.turn = threshold.currentTurn;
    entry.enemyId = threshold.enemyId;
    entry.enemyName = threshold.enemyName;
    entry.enemyLabel = threshold.enemyLabel;
    entry.riskTags = threshold.riskTags;
    entry.special = threshold.special;
    entry.minHpToSurvive = threshold.minHpToSurvive;
    entry.samples = threshold.samples;
    if (threshold.nonMonotonic) entry.nonMonotonic = true;
  } else if (action && action.estimate) {
    entry.damage = damage;
    entry.turn = number(action.estimate.turn, 0);
  }
  return entry;
}

function missingGoalFields(project, simulator, state, segment, options) {
  const config = options || {};
  const diagnostic = config.diagnostic !== false;
  const goal = (segment || {}).goal || {};
  const missing = [];
  if (goal.floorId && state.floorId !== goal.floorId) {
    missing.push({ field: "floorId", expected: goal.floorId, actual: state.floorId });
  }
  checkMinFields(summarizeHero(state), goal.minHero, "hero", missing);
  checkMinFields(summarizeEffectiveHero(state), goal.minEffectiveHero, "effectiveHero", missing);
  (goal.equipmentIncludes || []).forEach((itemId) => {
    if (!hasEquipment(state, itemId)) missing.push({ field: "equipment", expected: itemId, actual: summarizeHero(state).equipment });
  });
  if (goal.type === "bossDefeated" || goal.type === "tileRemoved") {
    const tile = getTileDefinitionAt(project, state, goal.floorId, goal.x, goal.y);
    if (tile != null) {
      missing.push({
        field: "tileRemoved",
        expected: `${goal.floorId}:${goal.x},${goal.y}=removed`,
        actual: tile.id || tile.number,
      });
    }
  }
  (goal.removedTiles || []).forEach((required) => {
    const tile = getTileDefinitionAt(project, state, required.floorId, required.x, required.y);
    if (tile != null) {
      missing.push({
        field: "removedTiles",
        expected: `${required.floorId}:${required.x},${required.y}=removed`,
        actual: tile.id || tile.number,
      });
    }
  });
  if (Array.isArray(goal.anyRemovedTiles) && goal.anyRemovedTiles.length > 0) {
    const matched = goal.anyRemovedTiles.some((required) =>
      getTileDefinitionAt(project, state, required.floorId, required.x, required.y) == null
    );
    if (!matched) {
      missing.push({
        field: "anyRemovedTiles",
        expected: goal.anyRemovedTiles.map((tile) => `${tile.floorId}:${tile.x},${tile.y}=removed`),
        actual: "all-present",
      });
    }
  }
  (goal.presentTiles || []).forEach((required) => {
    const tile = getTileDefinitionAt(project, state, required.floorId, required.x, required.y);
    if (tile == null) {
      missing.push({
        field: "presentTiles",
        expected: `${required.floorId}:${required.x},${required.y}=present`,
        actual: "removed-or-missing",
      });
    }
  });
  if (goal.actionSurvivable && goal.actionSurvivable.summary) {
    if (actionTargetAlreadyRemovedByGoal(project, state, goal, goal.actionSurvivable.summary)) {
      return missing;
    }
    const action = findPrimitiveAction(simulator, state, goal.actionSurvivable.summary);
    if (!action) {
      if (!diagnostic) {
        missing.push({ field: "actionSurvivable", expected: goal.actionSurvivable.summary, actual: "missing-action" });
      } else {
        const threshold = estimateBattleSurvivability(simulator, state, goal.actionSurvivable.summary);
        if (threshold && threshold.supported && !threshold.survivable) {
          missing.push(buildActionSurvivableMissing(simulator, state, goal.actionSurvivable.summary, null));
        } else {
          missing.push({ field: "actionSurvivable", expected: goal.actionSurvivable.summary, actual: "missing-action" });
        }
      }
    } else {
      const damage = number((action.estimate || {}).damage, Number.POSITIVE_INFINITY);
      if (goal.actionSurvivable.exactDamage != null && damage !== Number(goal.actionSurvivable.exactDamage)) {
        missing.push({ field: "actionDamage", expected: Number(goal.actionSurvivable.exactDamage), actual: damage });
      }
      if (!(number((state.hero || {}).hp, 0) > damage)) {
        if (diagnostic) {
          missing.push(buildActionSurvivableMissing(simulator, state, goal.actionSurvivable.summary, action));
        } else {
          missing.push({
            field: "actionSurvivable",
            expected: Number.isFinite(damage) ? `hp > ${damage}` : goal.actionSurvivable.summary,
            actual: number((state.hero || {}).hp, 0),
            action: goal.actionSurvivable.summary,
            damage,
          });
        }
      }
    }
  }
  return missing;
}

function buildSegmentGoalPredicate(project, segment, simulator) {
  return (state) => missingGoalFields(project, simulator, state, segment, { diagnostic: false }).length === 0;
}

function parseActionTileKey(summary) {
  const match = /^[^@]+@([^:]+):(\d+),(\d+)(?:\b|$)/.exec(String(summary || ""));
  if (!match) return null;
  return `${match[1]}:${match[2]},${match[3]}`;
}

function isRequiredTileStillPresent(project, state, required) {
  return getTileDefinitionAt(project, state, required.floorId, required.x, required.y) != null;
}

function actionTargetAlreadyRemovedByGoal(project, state, goal, summary) {
  const actionTileKey = parseActionTileKey(summary);
  if (!actionTileKey) return false;
  const requiredTiles = [];
  if ((goal.type === "bossDefeated" || goal.type === "tileRemoved") && goal.floorId != null && goal.x != null && goal.y != null) {
    requiredTiles.push({ floorId: goal.floorId, x: goal.x, y: goal.y });
  }
  (goal.removedTiles || []).forEach((tile) => requiredTiles.push(tile));
  return requiredTiles.some((tile) =>
    `${tile.floorId}:${tile.x},${tile.y}` === actionTileKey &&
    getTileDefinitionAt(project, state, tile.floorId, tile.x, tile.y) == null
  );
}

function goalActionScore(simulator, state, action, segment) {
  const goal = (segment || {}).goal || {};
  let score = 0;
  const actionTileKey = parseActionTileKey(action && action.summary);
  for (const required of goal.removedTiles || []) {
    const requiredKey = `${required.floorId}:${required.x},${required.y}`;
    if (actionTileKey === requiredKey && isRequiredTileStillPresent(simulator.project, state, required)) {
      score += 10000000;
    }
  }
  for (const required of goal.anyRemovedTiles || []) {
    const requiredKey = `${required.floorId}:${required.x},${required.y}`;
    if (actionTileKey === requiredKey && isRequiredTileStillPresent(simulator.project, state, required)) {
      score += 8000000;
    }
  }
  for (const preserved of goal.presentTiles || []) {
    const preservedKey = `${preserved.floorId}:${preserved.x},${preserved.y}`;
    if (actionTileKey === preservedKey && isRequiredTileStillPresent(simulator.project, state, preserved)) {
      score -= 10000000;
    }
  }
  for (const preferred of goal.preferredPresentTiles || []) {
    const preferredKey = `${preferred.floorId}:${preferred.x},${preferred.y}`;
    if (actionTileKey === preferredKey && isRequiredTileStillPresent(simulator.project, state, preferred)) {
      score -= 1000000;
    }
  }
  if (action && action.kind === "equip") {
    for (const itemId of goal.equipmentIncludes || []) {
      if (String(action.summary || "") === `equip:${itemId}` && !hasEquipment(state, itemId)) score += 12000000;
    }
  }
  if (action && action.kind === "changeFloor" && goal.floorId && action.changeFloor && action.changeFloor.floorId === goal.floorId) {
    score += 500000;
  }
  return score;
}

function segmentPreviewScore(simulator, state, action) {
  if (!action || action.kind === "changeFloor") return 0;
  try {
    const preview = simulator.applyAction(state, action, { storeRoute: false });
    const beforeHero = summarizeHero(state);
    const afterHero = summarizeHero(preview);
    const beforeEffective = summarizeEffectiveHero(state);
    const afterEffective = summarizeEffectiveHero(preview);
    const equipmentGain = afterHero.equipment.filter((itemId) => !beforeHero.equipment.includes(itemId)).length;
    return Math.max(0,
      (afterHero.hp - beforeHero.hp) +
      (afterEffective.atk - beforeEffective.atk) * 50000 +
      (afterEffective.def - beforeEffective.def) * 40000 +
      (afterEffective.mdef - beforeEffective.mdef) * 5000 +
      (afterHero.exp - beforeHero.exp) * 1500 +
      equipmentGain * 300000
    );
  } catch (error) {
    return 0;
  }
}

function actionSurvivablePrepScore(simulator, state, action, segment) {
  const goal = (segment || {}).goal || {};
  if (!goal.actionSurvivable || !goal.actionSurvivable.summary || !action) return 0;
  if (action.kind === "changeFloor" || action.kind === "floorFly") return 0;
  try {
    const preview = simulator.applyAction(state, action, { storeRoute: false });
    const beforeHero = summarizeHero(state);
    const afterHero = summarizeHero(preview);
    const beforeEffective = summarizeEffectiveHero(state);
    const afterEffective = summarizeEffectiveHero(preview);
    const hpGain = afterHero.hp - beforeHero.hp;
    const atkGain = afterEffective.atk - beforeEffective.atk;
    const defGain = afterEffective.def - beforeEffective.def;
    const mdefGain = afterEffective.mdef - beforeEffective.mdef;
    const expGain = afterHero.exp - beforeHero.exp;
    const equipmentGain = afterHero.equipment.filter((itemId) => !beforeHero.equipment.includes(itemId)).length;
    const positivePrep =
      hpGain > 0 ||
      atkGain > 0 ||
      defGain > 0 ||
      mdefGain > 0 ||
      expGain > 0 ||
      equipmentGain > 0;
    if (!positivePrep) return 0;
    const damage = number((action.estimate || {}).damage, 0);
    return Math.max(0,
      hpGain * 8 +
      atkGain * 30000 +
      defGain * 140000 +
      mdefGain * 5000 +
      expGain * 2500 +
      equipmentGain * 500000 -
      Math.max(0, damage) * 0.2
    );
  } catch (error) {
    return 0;
  }
}

function resourceTimingLookaheadScore(simulator, state, action, segment) {
  const dpConfig = (segment || {}).dp || {};
  if (dpConfig.resourceLookahead !== true) return 0;
  if (!action || action.kind === "changeFloor" || action.kind === "floorFly" || action.kind === "equip") return 0;
  let preview = null;
  try {
    preview = simulator.applyAction(state, action, { storeRoute: false });
  } catch (error) {
    return 0;
  }
  const beforeHero = summarizeHero(state);
  const beforeEffective = summarizeEffectiveHero(state);
  let nextActions = [];
  try {
    nextActions = simulator.enumeratePrimitiveActions(preview).actions || [];
  } catch (error) {
    nextActions = [];
  }
  if (typeof simulator.enumerateInteractPickupActions === "function") {
    try {
      nextActions = nextActions.concat(simulator.enumerateInteractPickupActions(preview) || []);
    } catch (error) {
    }
  }
  const candidates = nextActions
    .filter((nextAction) => nextAction && nextAction.summary !== action.summary)
    .filter((nextAction) => nextAction.kind !== "changeFloor" && nextAction.kind !== "floorFly")
    .filter((nextAction) => isAllowedAction(nextAction, preview, segment, simulator))
    .map((nextAction) => ({
      action: nextAction,
      prepScore: actionSurvivablePrepScore(simulator, preview, nextAction, segment),
      previewScore: segmentPreviewScore(simulator, preview, nextAction),
      damage: number((nextAction.estimate || {}).damage, 0),
    }))
    .filter((record) => record.prepScore > 0 || record.previewScore > 0)
    .sort((left, right) => (right.prepScore + right.previewScore) - (left.prepScore + left.previewScore) || left.damage - right.damage)
    .slice(0, number(dpConfig.resourceLookaheadActions, 8));
  let best = 0;
  for (const record of candidates) {
    let second = null;
    try {
      second = simulator.applyAction(preview, record.action, { storeRoute: false });
    } catch (error) {
      continue;
    }
    const afterHero = summarizeHero(second);
    const afterEffective = summarizeEffectiveHero(second);
    const hpDelta = number(afterHero.hp, 0) - number(beforeHero.hp, 0);
    const atkDelta = number(afterEffective.atk, 0) - number(beforeEffective.atk, 0);
    const defDelta = number(afterEffective.def, 0) - number(beforeEffective.def, 0);
    const mdefDelta = number(afterEffective.mdef, 0) - number(beforeEffective.mdef, 0);
    const expDelta = number(afterHero.exp, 0) - number(beforeHero.exp, 0);
    const score =
      hpDelta * 120 +
      number(afterHero.hp, 0) * 3000 +
      atkDelta * 30000 +
      defDelta * 120000 +
      mdefDelta * 5000 +
      expDelta * 2500 +
      (record.prepScore + record.previewScore) * 0.25;
    if (score > best) best = score;
  }
  return Math.max(0, best);
}

function usesResourceTimingMode(segment) {
  const dpConfig = (segment || {}).dp || {};
  const policy = (segment || {}).actionPolicy || {};
  return dpConfig.resourceTimingMode === "sustain-prep" ||
    policy.resourceTimingMode === "sustain-prep";
}

function isResourceTimingAction(simulator, state, action, segment) {
  if (!usesResourceTimingMode(segment)) return true;
  if (!action) return false;
  if (action.kind === "changeFloor" || action.kind === "floorFly") return true;
  if (goalActionScore(simulator, state, action, segment) > 0) return true;
  return actionSurvivablePrepScore(simulator, state, action, segment) > 0;
}

function annotateSegmentAction(simulator, state, action, segment) {
  const goalScore = goalActionScore(simulator, state, action, segment);
  const dpConfig = (segment || {}).dp || {};
  const prepScore = actionSurvivablePrepScore(simulator, state, action, segment);
  const lookaheadScore = resourceTimingLookaheadScore(simulator, state, action, segment);
  const previewScore = dpConfig.enablePreviewScore === false
    ? 0
    : dpConfig.enablePreviewScore === "required"
      ? (goalScore > 0 || prepScore > 0 || lookaheadScore > 0 ? segmentPreviewScore(simulator, state, action) + prepScore + lookaheadScore : 0)
      : segmentPreviewScore(simulator, state, action);
  const score = goalScore + previewScore + (dpConfig.enablePreviewScore === "required" ? 0 : prepScore + lookaheadScore);
  if (score === 0) return action;
  return {
    ...action,
    estimate: {
      ...(action.estimate || {}),
      segmentPreviewScore: score,
    },
  };
}

function parseChangeFloorSummary(summary) {
  const match = /^changeFloor@([^:]+):(\d+),(\d+)$/.exec(summary || "");
  return match ? `${match[1]}:${match[2]},${match[3]}` : null;
}

function isAllowedChangeFloor(action, state, policy) {
  const allowed = new Set((policy.allowChangeFloors || []).map(String));
  const changeKey = parseChangeFloorSummary(action.summary);
  if (changeKey && allowed.has(changeKey)) return true;
  const floorId = action.floorId || state.floorId;
  if (policy.allowedFloors && !policy.allowedFloors.includes(floorId)) return false;
  const targetFloor = action.changeFloor && action.changeFloor.floorId;
  return !targetFloor || !policy.allowedFloors || policy.allowedFloors.includes(targetFloor);
}

function isAllowedAction(action, state, segment, simulator) {
  const policy = (segment || {}).actionPolicy || {};
  const goal = (segment || {}).goal || {};
  const allowedKinds = new Set(policy.actionKinds || ["battle", "pickup", "equip", "openDoor", "useTool", "changeFloor", "event"]);
  if (!action || !allowedKinds.has(action.kind)) return false;
  if (action.kind === "resourcePocket" || action.kind === "resourceCluster" || action.kind === "resourceChain" || action.kind === "fightToLevelUp") return false;
  if (action.kind === "event" && policy.forbidUnsupportedEvents !== false && (action.unsupported || action.hasStateChange === false)) return false;
  const actionTileKey = parseActionTileKey(action.summary);
  for (const preserved of goal.presentTiles || []) {
    const preservedKey = `${preserved.floorId}:${preserved.x},${preserved.y}`;
    if (actionTileKey === preservedKey && isRequiredTileStillPresent(simulator.project, state, preserved)) return false;
  }
  if (action.kind === "changeFloor") return isAllowedChangeFloor(action, state, policy);
  if (action.kind === "floorFly") {
    const targetFloor = action.targetFloorId || (action.target && action.target.floorId);
    return !policy.allowedFloors || (policy.allowedFloors.includes(action.floorId || state.floorId) && policy.allowedFloors.includes(targetFloor));
  }
  const floorId = action.floorId || state.floorId;
  return !policy.allowedFloors || policy.allowedFloors.includes(floorId);
}

function trimFloorFlyActions(actions, policy) {
  const maxPerTarget = Math.max(1, number(policy.maxFloorFlyPerTarget, 1));
  const floorFlyGroups = new Map();
  const kept = [];
  for (const action of actions || []) {
    if (!action || action.kind !== "floorFly") {
      kept.push(action);
      continue;
    }
    const targetFloor = action.targetFloorId || (action.target && action.target.floorId) || "?";
    if (!floorFlyGroups.has(targetFloor)) floorFlyGroups.set(targetFloor, []);
    floorFlyGroups.get(targetFloor).push(action);
  }
  floorFlyGroups.forEach((group) => {
    group
      .slice()
      .sort((left, right) => (left.path || []).length - (right.path || []).length)
      .slice(0, maxPerTarget)
      .forEach((action) => kept.push(action));
  });
  return kept;
}

function buildSegmentActionProvider(simulator, segment) {
  return (unusedSimulator, state) => {
    const policy = (segment || {}).actionPolicy || {};
    const allowedKinds = new Set(policy.actionKinds || ["battle", "pickup", "equip", "openDoor", "useTool", "changeFloor", "event"]);
    const primitive = (simulator.enumeratePrimitiveActions(state).actions || []);
    let actions = primitive;
    if (allowedKinds.has("interactPickup") && typeof simulator.enumerateInteractPickupActions === "function") {
      actions = actions.concat(simulator.enumerateInteractPickupActions(state));
    }
    if (allowedKinds.has("floorFly") && typeof simulator.enumerateFloorFlyActions === "function") {
      actions = actions.concat(simulator.enumerateFloorFlyActions(state));
    }
    return trimFloorFlyActions(actions, policy)
      .filter((action) => isAllowedAction(action, state, segment, simulator))
      .filter((action) => isResourceTimingAction(simulator, state, action, segment))
      .map((action) => annotateSegmentAction(simulator, state, action, segment));
  };
}

function closeStateForBattleFrontier(simulator, state) {
  if (typeof simulator.stabilizeState !== "function") return state;
  return simulator.stabilizeState(state);
}

function collapsePortalActions(actions) {
  const battles = [];
  const portalsByTarget = new Map();
  const others = [];
  for (const action of actions || []) {
    if (!action) continue;
    if (action.kind === "battle") {
      battles.push(action);
    } else if (action.kind === "changeFloor" || action.kind === "floorFly") {
      const targetFloor = action.kind === "floorFly"
        ? (action.targetFloorId || (action.target && action.target.floorId) || "?")
        : (action.changeFloor && action.changeFloor.floorId || "?");
      const existing = portalsByTarget.get(targetFloor);
      if (!existing || (action.path || []).length < (existing.path || []).length) {
        portalsByTarget.set(targetFloor, action);
      }
    } else {
      others.push(action);
    }
  }
  return [...battles, ...portalsByTarget.values(), ...others];
}

function presentTilesViolatedByClosure(project, state, segment) {
  const goal = (segment || {}).goal || {};
  for (const required of goal.presentTiles || []) {
    if (getTileDefinitionAt(project, state, required.floorId, required.x, required.y) == null) {
      return true;
    }
  }
  return false;
}

function buildBattleFrontierActionProvider(simulator, segment) {
  return (unusedSimulator, state) => {
    const policy = (segment || {}).actionPolicy || {};
    const allowedKinds = new Set(policy.actionKinds || ["battle", "changeFloor", "floorFly"]);
    const closedState = closeStateForBattleFrontier(simulator, state);
    if (presentTilesViolatedByClosure(simulator.project, closedState, segment)) {
      return [];
    }
    const primitive = (simulator.enumeratePrimitiveActions(closedState).actions || []);
    let actions = primitive;
    if (allowedKinds.has("floorFly") && typeof simulator.enumerateFloorFlyActions === "function") {
      actions = actions.concat(simulator.enumerateFloorFlyActions(closedState));
    }
    const filtered = trimFloorFlyActions(actions, policy)
      .filter((action) => isAllowedAction(action, closedState, segment, simulator))
      .filter((action) => isResourceTimingAction(simulator, closedState, action, segment))
      .map((action) => annotateSegmentAction(simulator, closedState, action, segment));
    return collapsePortalActions(filtered);
  };
}

function routeLength(state) {
  return Array.isArray((state || {}).route) ? state.route.length : 0;
}

function goalCandidateScore(state) {
  const hero = summarizeHero(state);
  const effective = summarizeEffectiveHero(state);
  return hero.hp +
    effective.atk * 100000 +
    effective.def * 80000 +
    effective.mdef * 8000 +
    hero.exp * 1000 -
    routeLength(state) * 10;
}

function candidateOutcomeScore(candidate) {
  const state = candidate && candidate.state ? candidate.state : candidate;
  const hero = summarizeHero(state);
  const effective = summarizeEffectiveHero(state);
  return hero.hp * 1000000 +
    hero.lv * 100000000000 +
    hero.exp * 10000000 +
    effective.atk * 10000 +
    effective.def * 8000 +
    effective.mdef * 1000 -
    routeLength(state);
}

function compareCandidateStates(left, right) {
  if (!right) return -1;
  if (!left) return 1;
  const leftHero = summarizeHero(left);
  const rightHero = summarizeHero(right);
  const hpDiff = rightHero.hp - leftHero.hp;
  if (hpDiff !== 0) return hpDiff;
  for (const field of ["atk", "def", "mdef"]) {
    const diff = effectiveHeroValue(right, field) - effectiveHeroValue(left, field);
    if (diff !== 0) return diff;
  }
  if (rightHero.exp !== leftHero.exp) return rightHero.exp - leftHero.exp;
  return routeLength(left) - routeLength(right);
}

function addTag(record, tag) {
  if (!record.tags.includes(tag)) record.tags.push(tag);
}

function buildTraceSnapshot(project, state) {
  if (!state) return null;
  const snapshot = buildSolverSnapshot(project, state, { floorIds: [state.floorId].filter(Boolean) });
  snapshot.partial = true;
  return snapshot;
}

function compactTraceEntry(project, entry) {
  if (!entry || !entry.actionEntry) return null;
  const preSnapshot = entry.preSnapshot || buildTraceSnapshot(project, entry.preState);
  const postSnapshot = entry.postSnapshot || buildTraceSnapshot(project, entry.postState);
  return {
    actionEntry: entry.actionEntry,
    preSnapshot,
    postSnapshot,
    preStateKey: entry.preStateKey || null,
    postStateKey: entry.postStateKey || null,
  };
}

function selectGoalSkyline(simulator, states, segment, options) {
  const limit = Math.max(1, number((options || {}).candidateLimit || (segment.dp || {}).goalSkylineLimit, 8));
  const keyMode = ((segment.dp || {}).keyMode || "region");
  const byKey = new Map();
  (states || []).filter(Boolean).forEach((state) => {
    const key = buildDpStateKey(simulator, state, { dpKeyMode: keyMode });
    const existing = byKey.get(key);
    if (!existing || compareCandidateStates(state, existing) < 0) byKey.set(key, state);
  });
  const goal = (segment || {}).goal || {};
  const actionSurvivableTarget = goal.actionSurvivable && goal.actionSurvivable.summary
    ? goal.actionSurvivable.summary
    : null;
  const records = Array.from(byKey.values()).map((state, index) => {
    const trace = Array.isArray(state.routeTrace)
      ? state.routeTrace.map((entry) => compactTraceEntry(simulator.project, entry)).filter(Boolean)
      : [];
    if (Object.prototype.hasOwnProperty.call(state, "routeTrace")) delete state.routeTrace;
    let targetMargin = null;
    if (actionSurvivableTarget) {
      try {
        const threshold = estimateBattleSurvivability(simulator, state, actionSurvivableTarget, { skipMinHp: true });
        if (threshold && threshold.supported) {
          targetMargin = {
            survivable: threshold.survivable,
            margin: number(threshold.currentHp, 0) - number(threshold.currentDamage, Number.POSITIVE_INFINITY),
            special: threshold.special,
            riskTags: threshold.riskTags,
          };
        }
      } catch (error) {
        targetMargin = null;
      }
    }
    return {
      id: `${segment.id || "segment"}#${index}`,
      state,
      route: Array.isArray(state.route) ? state.route.slice() : [],
      trace,
      hero: summarizeHero(state),
      effectiveHero: summarizeEffectiveHero(state),
      score: goalCandidateScore(state),
      tags: [],
      targetMargin,
    };
  });
  const rolePickers = [
    ["highest-hp", (left, right) => summarizeHero(right.state).hp - summarizeHero(left.state).hp],
    ["best-combat", (left, right) => right.score - left.score],
    ["highest-atk", (left, right) => right.effectiveHero.atk - left.effectiveHero.atk],
    ["highest-def", (left, right) => right.effectiveHero.def - left.effectiveHero.def],
    ["highest-mdef", (left, right) => right.effectiveHero.mdef - left.effectiveHero.mdef],
    ["highest-exp", (left, right) => right.hero.exp - left.hero.exp],
    ["shortest", (left, right) => left.route.length - right.route.length],
  ];
  if (actionSurvivableTarget) {
    rolePickers.push([
      "best-target-margin",
      (left, right) => {
        const leftMargin = left.targetMargin ? left.targetMargin.margin : -Infinity;
        const rightMargin = right.targetMargin ? right.targetMargin.margin : -Infinity;
        return rightMargin - leftMargin;
      },
    ]);
    rolePickers.push([
      "target-survivable",
      (left, right) => {
        const leftOk = left.targetMargin && left.targetMargin.survivable ? 1 : 0;
        const rightOk = right.targetMargin && right.targetMargin.survivable ? 1 : 0;
        return rightOk - leftOk;
      },
    ]);
  }
  const selected = [];
  const selectedIds = new Set();
  const compareGoalRecords = (left, right) => {
    const tagDiff = right.tags.length - left.tags.length;
    if (tagDiff !== 0) return tagDiff;
    const stateDiff = compareCandidateStates(left.state, right.state);
    if (stateDiff !== 0) return stateDiff;
    return candidateOutcomeScore(right) - candidateOutcomeScore(left);
  };
  const keepCandidate = (record) => {
    if (!record || selectedIds.has(record.id) || selected.length >= limit) return;
    selectedIds.add(record.id);
    selected.push(record);
  };
  rolePickers.forEach(([tag, compare]) => {
    const winner = records.slice().sort(compare)[0];
    if (winner) addTag(winner, tag);
  });
  if ((options || {}).preserveSkylineRoles === true) {
    rolePickers.forEach(([, compare]) => keepCandidate(records.slice().sort(compare)[0]));
  }
  records
    .sort(compareGoalRecords)
    .forEach(keepCandidate);
  return selected.slice(0, limit).sort(compareGoalRecords);
}

function normalizeCandidateRecord(candidate, index, fallbackSegmentId) {
  const state = candidate && candidate.state;
  return {
    id: candidate && candidate.id ? candidate.id : `${fallbackSegmentId || "segment"}#${index}`,
    state,
    route: Array.isArray(candidate && candidate.route)
      ? candidate.route.slice()
      : (Array.isArray(state && state.route) ? state.route.slice() : []),
    trace: Array.isArray(candidate && candidate.trace) ? candidate.trace.slice() : [],
    hero: (candidate && candidate.hero) || summarizeHero(state),
    effectiveHero: (candidate && candidate.effectiveHero) || summarizeEffectiveHero(state),
    score: number(candidate && candidate.score, goalCandidateScore(state)),
    tags: Array.isArray(candidate && candidate.tags) ? candidate.tags.slice() : [],
  };
}

function selectCandidateSkyline(simulator, candidates, segment, options) {
  const limit = Math.max(1, number((options || {}).candidateLimit || (segment.dp || {}).goalSkylineLimit, 8));
  const keyMode = ((segment.dp || {}).keyMode || "region");
  const byKey = new Map();
  (candidates || []).filter((candidate) => candidate && candidate.state).forEach((candidate) => {
    const key = buildDpStateKey(simulator, candidate.state, { dpKeyMode: keyMode });
    const existing = byKey.get(key);
    if (!existing || compareCandidateStates(candidate.state, existing.state) < 0) byKey.set(key, candidate);
  });
  const goal = (segment || {}).goal || {};
  const actionSurvivableTarget = goal.actionSurvivable && goal.actionSurvivable.summary
    ? goal.actionSurvivable.summary
    : null;
  const records = Array.from(byKey.values()).map((candidate, index) => {
    const record = normalizeCandidateRecord(candidate, index, segment.id);
    if (actionSurvivableTarget) {
      try {
        const threshold = estimateBattleSurvivability(simulator, record.state, actionSurvivableTarget, { skipMinHp: true });
        if (threshold && threshold.supported) {
          record.targetMargin = {
            survivable: threshold.survivable,
            margin: number(threshold.currentHp, 0) - number(threshold.currentDamage, Number.POSITIVE_INFINITY),
          };
        }
      } catch (error) {
        record.targetMargin = null;
      }
    }
    return record;
  });
  const compareGoalRecords = (left, right) => {
    const tagDiff = right.tags.length - left.tags.length;
    if (tagDiff !== 0) return tagDiff;
    const stateDiff = compareCandidateStates(left.state, right.state);
    if (stateDiff !== 0) return stateDiff;
    return candidateOutcomeScore(right) - candidateOutcomeScore(left);
  };
  const rolePickers = [
    ["highest-hp", (left, right) => summarizeHero(right.state).hp - summarizeHero(left.state).hp],
    ["best-combat", (left, right) => right.score - left.score],
    ["highest-atk", (left, right) => right.effectiveHero.atk - left.effectiveHero.atk],
    ["highest-def", (left, right) => right.effectiveHero.def - left.effectiveHero.def],
    ["highest-mdef", (left, right) => right.effectiveHero.mdef - left.effectiveHero.mdef],
    ["highest-exp", (left, right) => right.hero.exp - left.hero.exp],
    ["shortest", (left, right) => left.route.length - right.route.length],
  ];
  if (actionSurvivableTarget) {
    rolePickers.push([
      "best-target-margin",
      (left, right) => {
        const leftMargin = left.targetMargin ? left.targetMargin.margin : -Infinity;
        const rightMargin = right.targetMargin ? right.targetMargin.margin : -Infinity;
        return rightMargin - leftMargin;
      },
    ]);
    rolePickers.push([
      "target-survivable",
      (left, right) => {
        const leftOk = left.targetMargin && left.targetMargin.survivable ? 1 : 0;
        const rightOk = right.targetMargin && right.targetMargin.survivable ? 1 : 0;
        return rightOk - leftOk;
      },
    ]);
  }
  const selected = [];
  const selectedIds = new Set();
  const keepCandidate = (record) => {
    if (!record || selectedIds.has(record.id) || selected.length >= limit) return;
    selectedIds.add(record.id);
    selected.push(record);
  };
  rolePickers.forEach(([tag, compare]) => {
    const winner = records.slice().sort(compare)[0];
    if (winner) addTag(winner, tag);
  });
  if ((options || {}).preserveSkylineRoles === true) {
    rolePickers.forEach(([, compare]) => keepCandidate(records.slice().sort(compare)[0]));
  }
  records.sort(compareGoalRecords).forEach(keepCandidate);
  return selected.slice(0, limit).sort(compareGoalRecords);
}

function compactState(state) {
  if (!state) return null;
  return {
    floorId: state.floorId,
    hero: summarizeHero(state),
    effectiveHero: summarizeEffectiveHero(state),
    routeTail: Array.isArray(state.route) ? state.route.slice(-12) : [],
  };
}

function hasMissingField(missing, predicate) {
  return (missing || []).some((entry) => predicate(String((entry || {}).field || ""), entry || {}));
}

function classifySegmentFailure(missing, segment) {
  const missingFields = missing || [];
  const classes = [];
  const preferredCandidateTags = [];
  const recommendedNext = [];
  const addClass = (failureClass, reason, tags, recommendation) => {
    classes.push({ failureClass, reason, recommendation });
    (tags || []).forEach((tag) => {
      if (!preferredCandidateTags.includes(tag)) preferredCandidateTags.push(tag);
    });
    if (recommendation && !recommendedNext.includes(recommendation)) recommendedNext.push(recommendation);
  };

  if (hasMissingField(missingFields, (field) => field === "presentTiles")) {
    addClass(
      "present-tile-overconstrained",
      "hard presentTiles constraint was violated before this milestone goal",
      ["best-combat", "shortest"],
      "relax non-essential presentTiles into preferredPresentTiles or add an explicit reason if it is a required later resource"
    );
  }

  if (hasMissingField(missingFields, (field, entry) => field === "actionSurvivable" && entry.actual === "missing-action")) {
    addClass(
      "target-action-unreachable",
      "required target action is absent from the current primitive action set",
      ["shortest", "best-combat"],
      "check allowedFloors, allowChangeFloors, presentTiles, and local action scope for this segment"
    );
  }

  if (hasMissingField(missingFields, (field) => field === "hero.atk" || field === "effectiveHero.atk")) {
    addClass(
      "atk-deficit",
      "attack threshold is not met",
      ["highest-atk", "best-combat"],
      "backtrack to the previous milestone and try highest-atk or best-combat candidates"
    );
  }

  if (hasMissingField(missingFields, (field) => field === "hero.def" || field === "effectiveHero.def")) {
    addClass(
      "def-deficit",
      "defense threshold is not met",
      ["highest-def", "best-combat"],
      "backtrack to the previous milestone and try highest-def or best-combat candidates"
    );
  }

  if (hasMissingField(missingFields, (field) => field === "hero.mdef" || field === "effectiveHero.mdef")) {
    addClass(
      "mdef-deficit",
      "magic-defense threshold is not met",
      ["highest-mdef", "best-combat"],
      "backtrack to the previous milestone and try highest-mdef or best-combat candidates"
    );
  }

  if (hasMissingField(missingFields, (field, entry) =>
    field === "actionSurvivable" && (entry.riskTags || []).includes("life-limit")
  )) {
    addClass(
      "life-limit-hp-deficit",
      "life-limit battle threshold is not survivable at current HP",
      ["highest-hp", "highest-def", "best-combat"],
      "scan HP/def sustain resources before retrying the life-limit battle"
    );
  }

  if (hasMissingField(missingFields, (field) => field === "hero.hp")) {
    addClass(
      "hp-deficit",
      "HP threshold is not met",
      ["highest-hp"],
      "backtrack to the previous milestone and try highest-hp candidates"
    );
  }

  if (hasMissingField(missingFields, (field, entry) => field === "actionSurvivable" && entry.actual !== "missing-action")) {
    addClass(
      "action-survivability-deficit",
      "required action exists but current HP cannot survive it",
      ["highest-hp", "best-combat", "highest-def", "highest-atk"],
      "backtrack to the previous milestone and try higher-HP or stronger-combat candidates"
    );
  }

  if (hasMissingField(missingFields, (field) => field === "equipment")) {
    addClass(
      "equipment-missing",
      "required equipment is not equipped",
      ["best-combat", "shortest"],
      "check whether equip actions or the required item pickup are allowed in this segment"
    );
  }

  if (hasMissingField(missingFields, (field) => field === "tileRemoved" || field === "removedTiles" || field === "anyRemovedTiles")) {
    addClass(
      "target-tile-not-cleared",
      "required tile remains present at the best seen state",
      ["best-combat", "highest-atk"],
      "retry this segment with a candidate that has stronger combat or verify the target tile is reachable under the action policy"
    );
  }

  if (hasMissingField(missingFields, (field) => field === "floorId")) {
    addClass(
      "floor-scope-mismatch",
      "best seen state did not reach the target floor",
      ["shortest", "best-combat"],
      "check allowedFloors and allowChangeFloors for the segment"
    );
  }

  if (classes.length === 0) {
    addClass(
      "budget-or-action-scope-exhausted",
      "no goal state was found under the current segment budget and action policy",
      ["best-combat", "highest-hp"],
      "increase segment budget, widen action scope, or rerun the previous milestone with location key"
    );
  }

  const failurePriority = {
    "life-limit-hp-deficit": 100,
    "target-action-unreachable": 95,
    "present-tile-overconstrained": 90,
    "action-survivability-deficit": 85,
    "floor-scope-mismatch": 80,
    "target-tile-not-cleared": 75,
    "hp-deficit": 70,
    "def-deficit": 65,
    "mdef-deficit": 60,
    "atk-deficit": 55,
    "equipment-missing": 50,
    "budget-or-action-scope-exhausted": 10,
  };
  const primary = classes.slice().sort((left, right) =>
    number(failurePriority[right.failureClass], 0) - number(failurePriority[left.failureClass], 0)
  )[0];
  return {
    failureClass: primary.failureClass,
    failureReason: primary.reason,
    allFailureClasses: classes,
    preferredCandidateTags,
    recommendedRepair: primary.recommendation || recommendedNext[0],
    recommendedNext,
    segmentId: segment && segment.id,
  };
}

function summarizeSegmentFailure(project, segment, result, simulator) {
  const best = (result && (result.bestProgressState || result.bestSeenState)) || null;
  const missing = best ? missingGoalFields(project, simulator, best, segment) : [{ field: "state", expected: "reachable", actual: "none" }];
  const classification = classifySegmentFailure(missing, segment);
  return {
    failedSegmentId: segment.id,
    label: segment.label,
    bestSeen: compactState(best),
    missingGoalFields: missing,
    failureClass: classification.failureClass,
    failureReason: classification.failureReason,
    preferredCandidateTags: classification.preferredCandidateTags,
    recommendedRepair: classification.recommendedRepair,
    failurePropagation: classification,
    diagnostics: {
      actionTrimmed: result && result.diagnostics && result.diagnostics.dp && result.diagnostics.dp.actionTrimmed,
      frontierRemaining: result && result.frontierSize,
      rejectedByHigherHp: result && result.diagnostics && result.diagnostics.dp && result.diagnostics.dp.rejectedByHigherHp,
      replacedLowerHp: result && result.diagnostics && result.diagnostics.dp && result.diagnostics.dp.replacedLowerHp,
    },
    recommendedNext: classification.recommendedNext,
  };
}

function searchSegmentDP(simulator, startState, segment, options) {
  const config = options || {};
  const dpConfig = {
    ...(segment.dp || {}),
    ...(config.dpOverrides || {}),
  };
  const maxExpansions = number(dpConfig.maxExpansions, 8000);
  const maxRuntimeMs = number(dpConfig.maxRuntimeMs, 15000);
  const maxActionsPerState = number(dpConfig.maxActionsPerState, 9999);
  const prefixRoute = Array.isArray(config.prefixRoute) ? config.prefixRoute : (Array.isArray(startState.route) ? startState.route : []);
  const captureTrace = config.captureTrace === true;
  const prefixTrace = captureTrace
    ? (Array.isArray(config.prefixTrace) ? config.prefixTrace : (Array.isArray(startState.routeTrace) ? startState.routeTrace : []))
    : [];
  const seed = cloneStateWithoutRouteTrace(startState);
  seed.route = prefixRoute.slice();
  const result = searchDP(simulator, seed, {
    targetFloorId: segment.goal && segment.goal.floorId,
    maxExpansions,
    maxActionsPerState,
    maxRuntimeMs,
    dpKeyMode: dpConfig.keyMode || dpConfig.dpKeyMode || "region",
    dpAgendaMode: dpConfig.agendaMode || "best-first",
    dpPriorityMode: dpConfig.priorityMode || dpConfig.dpPriorityMode || "default",
    stopOnFirstGoal: dpConfig.stopOnFirstGoal === true,
    continueAfterGoal: dpConfig.continueAfterGoal === true,
    captureTrace,
    initialRouteTracePrefix: prefixTrace,
    goalSkylineLimit: number(dpConfig.goalSkylineLimit, 8),
    actionProvider: dpConfig.actionProviderMode === "battle-frontier"
      ? buildBattleFrontierActionProvider(simulator, segment)
      : buildSegmentActionProvider(simulator, segment),
    goalPredicate: buildSegmentGoalPredicate(simulator.project, segment, simulator),
  });
  const baseDpDiagnostics = (result.diagnostics && result.diagnostics.dp) || {};
  const expansionBudgetExhausted = Number(result.expansions || 0) >= maxExpansions &&
    Number(result.frontierSize || 0) > 0 &&
    !baseDpDiagnostics.stoppedReason;
  const goalStates = Array.isArray(result.goalSkylineStates) && result.goalSkylineStates.length > 0
    ? result.goalSkylineStates
    : [result.bestGoalState || result.goalState].filter(Boolean);
  const goalSkyline = selectGoalSkyline(simulator, goalStates, segment, {
    candidateLimit: config.candidateLimit || dpConfig.goalSkylineLimit,
    preserveSkylineRoles: config.preserveSkylineRoles === true || dpConfig.preserveSkylineRoles === true,
  });
  return {
    segmentId: segment.id,
    found: goalSkyline.length > 0,
    startCandidateId: config.candidateId || null,
    goalSkyline,
    bestSeen: result.bestSeenState,
    bestProgress: result.bestProgressState,
    diagnostics: {
      dp: {
        ...baseDpDiagnostics,
        expansions: result.expansions,
        frontierSize: result.frontierSize,
        maxExpansions,
        maxRuntimeMs,
        maxActionsPerState,
        expansionBudgetExhausted,
      },
      actionTrimmed: result.diagnostics && result.diagnostics.dp && result.diagnostics.dp.actionTrimmed,
      rejectedByHigherHp: result.diagnostics && result.diagnostics.dp && result.diagnostics.dp.rejectedByHigherHp,
      replacedLowerHp: result.diagnostics && result.diagnostics.dp && result.diagnostics.dp.replacedLowerHp,
      actionsGeneratedByKind: result.diagnostics && result.diagnostics.dp && result.diagnostics.dp.actionsGeneratedByKind,
      actionsKeptByKind: result.diagnostics && result.diagnostics.dp && result.diagnostics.dp.actionsKeptByKind,
      actionsDominatedByKind: result.diagnostics && result.diagnostics.dp && result.diagnostics.dp.actionsDominatedByKind,
      uniqueBattleTargets: result.diagnostics && result.diagnostics.dp && result.diagnostics.dp.uniqueBattleTargets,
      uniquePortalEntries: result.diagnostics && result.diagnostics.dp && result.diagnostics.dp.uniquePortalEntries,
      failure: goalSkyline.length > 0 ? null : summarizeSegmentFailure(simulator.project, segment, result, simulator),
      goalSkyline: {
        primaryOutput: true,
        count: goalSkyline.length,
        candidates: goalSkyline.map((candidate) => ({
          id: candidate.id,
          tags: candidate.tags,
          hero: candidate.hero,
          effectiveHero: candidate.effectiveHero,
          routeLength: candidate.route.length,
        })),
      },
      actionScope: segment.actionPolicy || {},
    },
    rawResult: result,
  };
}

function milestoneRange(milestoneSpec, fromMilestoneId, toMilestoneId) {
  const milestones = milestoneSpec.milestones || [];
  const fromIndex = fromMilestoneId ? milestones.findIndex((milestone) => milestone.id === fromMilestoneId) : -1;
  const toIndex = toMilestoneId ? milestones.findIndex((milestone) => milestone.id === toMilestoneId) : -1;
  if (fromMilestoneId && fromIndex < 0) return [];
  if (toMilestoneId && toIndex < 0) return [];
  const startIndex = fromMilestoneId ? fromIndex + 1 : 0;
  const endIndex = toMilestoneId ? toIndex : milestones.length - 1;
  if (startIndex < 0 || endIndex < 0 || startIndex > endIndex) return [];
  return milestones.slice(startIndex, endIndex + 1);
}

function milestoneRangeError(milestoneSpec, fromMilestoneId, toMilestoneId) {
  const milestones = milestoneSpec.milestones || [];
  const fromIndex = fromMilestoneId ? milestones.findIndex((milestone) => milestone.id === fromMilestoneId) : -1;
  const toIndex = toMilestoneId ? milestones.findIndex((milestone) => milestone.id === toMilestoneId) : -1;
  if (fromMilestoneId && fromIndex < 0) return `Unknown fromMilestoneId: ${fromMilestoneId}`;
  if (toMilestoneId && toIndex < 0) return `Unknown toMilestoneId: ${toMilestoneId}`;
  const startIndex = fromMilestoneId ? fromIndex + 1 : 0;
  const endIndex = toMilestoneId ? toIndex : milestones.length - 1;
  if (startIndex > endIndex) return `Invalid milestone range: ${fromMilestoneId || "start"} is not before ${toMilestoneId || "end"}`;
  return null;
}

function mergeMilestoneFrontier(simulator, candidates, segment, options) {
  const selected = selectCandidateSkyline(simulator, candidates || [], segment, options);
  return selected.map((record, index) => ({
    id: `${segment.id}:candidate-${index}`,
    state: record.state,
    route: record.route,
    trace: record.trace,
    hero: record.hero,
    effectiveHero: record.effectiveHero,
    tags: record.tags,
    score: record.score,
  }));
}

function mergeFailurePropagation(attempts) {
  const failures = (attempts || [])
    .map((attempt) => attempt && attempt.diagnostics && attempt.diagnostics.failure)
    .filter(Boolean);
  if (failures.length === 0) return null;
  const classCounts = {};
  const preferredCandidateTags = [];
  const recommendedNext = [];
  failures.forEach((failure) => {
    const failureClass = failure.failureClass || "unknown";
    classCounts[failureClass] = Number(classCounts[failureClass] || 0) + 1;
    (failure.preferredCandidateTags || []).forEach((tag) => {
      if (!preferredCandidateTags.includes(tag)) preferredCandidateTags.push(tag);
    });
    (failure.recommendedNext || []).forEach((recommendation) => {
      if (!recommendedNext.includes(recommendation)) recommendedNext.push(recommendation);
    });
  });
  const primaryFailureClass = Object.entries(classCounts)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0][0];
  return {
    primaryFailureClass,
    classCounts,
    preferredCandidateTags,
    recommendedNext,
  };
}

function numericOption(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function cloneStateWithoutRouteTrace(state) {
  if (!state || !Object.prototype.hasOwnProperty.call(state, "routeTrace")) return cloneState(state);
  const routeTrace = state.routeTrace;
  delete state.routeTrace;
  try {
    return cloneState(state);
  } finally {
    state.routeTrace = routeTrace;
  }
}

function segmentCandidateLimit(segment, config, overrides) {
  return numericOption(
    overrides && overrides.candidateLimit,
    numericOption(config && config.candidateLimit, numericOption(segment && segment.dp && segment.dp.goalSkylineLimit, 8))
  );
}

function segmentDpOverrides(segment, config, overrides) {
  const dpConfig = (segment || {}).dp || {};
  const repair = (overrides && overrides.dpOverrides) || {};
  const generatedSegment = Boolean(segment && segment.generated);
  return {
    ...(config && config.dpKeyMode && !generatedSegment ? { keyMode: config.dpKeyMode } : {}),
    ...(config && config.maxExpansions && !generatedSegment ? { maxExpansions: config.maxExpansions } : {}),
    ...(config && config.maxRuntimeMs && !generatedSegment ? { maxRuntimeMs: config.maxRuntimeMs } : {}),
    ...(config && config.stopOnFirstGoal != null ? { stopOnFirstGoal: config.stopOnFirstGoal } : {}),
    ...(repair.stopOnFirstGoal != null ? { stopOnFirstGoal: repair.stopOnFirstGoal } : {}),
    ...(repair.maxExpansions != null ? { maxExpansions: repair.maxExpansions } : {}),
    ...(repair.maxRuntimeMs != null ? { maxRuntimeMs: repair.maxRuntimeMs } : {}),
    ...(repair.keyMode != null ? { keyMode: repair.keyMode } : {}),
    ...(repair.dpKeyMode != null ? { dpKeyMode: repair.dpKeyMode } : {}),
    ...(repair.priorityMode != null ? { priorityMode: repair.priorityMode } : {}),
    ...(repair.dpPriorityMode != null ? { dpPriorityMode: repair.dpPriorityMode } : {}),
    ...(repair.goalSkylineLimit != null ? { goalSkylineLimit: repair.goalSkylineLimit } : {}),
    ...(repair.maxActionsPerState != null ? { maxActionsPerState: repair.maxActionsPerState } : {}),
    ...(repair.agendaMode != null ? { agendaMode: repair.agendaMode } : {}),
    ...(repair.dpAgendaMode != null ? { dpAgendaMode: repair.dpAgendaMode } : {}),
    ...(repair.maxRuntimeMs == null && overrides && overrides.expandRuntime
      ? { maxRuntimeMs: Math.max(numericOption(dpConfig.maxRuntimeMs, 0), numericOption(dpConfig.maxRuntimeMs, 0) * 2) }
      : {}),
  };
}

function compactSegmentCandidates(candidates) {
  return (candidates || []).map((candidate) => ({
    id: candidate.id,
    hero: candidate.hero,
    effectiveHero: candidate.effectiveHero,
    tags: candidate.tags,
    routeLength: candidate.route.length,
  }));
}

function buildMilestoneCheckpoint(segment, execution) {
  const candidates = (execution && execution.merged) || [];
  return {
    segmentId: segment.id,
    label: segment.label,
    uniqueFeasibleRoute: candidates.length === 1,
    candidateCount: candidates.length,
    candidates,
  };
}

function runSegmentAgainstFrontier(simulator, segment, frontier, config, overrides) {
  const candidateLimit = segmentCandidateLimit(segment, config || {}, overrides || {});
  const startLimit = numericOption(
    overrides && overrides.startCandidateLimit,
    numericOption(config && config.startCandidateLimit, (frontier || []).length || 1)
  );
  const inputFrontier = (frontier || []).slice(0, startLimit);
  const nextCandidates = [];
  const attempts = [];
  for (const candidate of inputFrontier) {
    const result = searchSegmentDP(simulator, candidate.state, segment, {
      candidateId: candidate.id,
      prefixRoute: candidate.route,
      prefixTrace: config && config.captureTrace === true ? candidate.trace : [],
      candidateLimit,
      preserveSkylineRoles: Boolean((config || {}).qualityFloor || (overrides || {}).preserveSkylineRoles),
      captureTrace: config && config.captureTrace === true,
      dpOverrides: segmentDpOverrides(segment, config || {}, overrides || {}),
    });
    attempts.push(result);
    result.goalSkyline.forEach((goal) => nextCandidates.push({
      ...goal,
      id: `${segment.id}:${candidate.id}:${goal.id}`,
    }));
  }
  const merged = mergeMilestoneFrontier(simulator, nextCandidates, segment, {
    candidateLimit,
    preserveSkylineRoles: Boolean((config || {}).qualityFloor || (overrides || {}).preserveSkylineRoles),
  });
  const failurePropagation = mergeFailurePropagation(attempts);
  const summary = {
    segmentId: segment.id,
    label: segment.label,
    found: merged.length > 0,
    startCandidatesTried: inputFrontier.length,
    startCandidatesAvailable: (frontier || []).length,
    candidates: compactSegmentCandidates(merged),
    attempts: attempts.map((attempt) => ({
      startCandidateId: attempt.startCandidateId,
      found: attempt.found,
      goalCount: attempt.goalSkyline.length,
      diagnostics: attempt.diagnostics,
    })),
    failurePropagation,
  };
  return { segment, inputFrontier, merged, attempts, summary, candidateLimit };
}

function preferredTagScore(candidate, preferredTags) {
  const tags = new Set((candidate && candidate.tags) || []);
  return (preferredTags || []).reduce((score, tag, index) => (
    score + (tags.has(tag) ? Math.max(1, preferredTags.length - index) : 0)
  ), 0);
}

function rankCandidatesByPreferredTags(candidates, preferredTags) {
  return (candidates || []).slice().sort((left, right) => {
    const tagDiff = preferredTagScore(right, preferredTags) - preferredTagScore(left, preferredTags);
    if (tagDiff !== 0) return tagDiff;
    const stateDiff = compareCandidateStates(left && left.state, right && right.state);
    if (stateDiff !== 0) return stateDiff;
    return candidateOutcomeScore(right) - candidateOutcomeScore(left);
  });
}

function qualityFloorHero(qualityFloor) {
  return (qualityFloor && (qualityFloor.minHero || qualityFloor.hero)) || {};
}

function qualityFloorFields(qualityFloor) {
  const configured = qualityFloor && qualityFloor.mustNotLoseFields;
  return Array.isArray(configured) && configured.length > 0
    ? configured
    : ["hp", "atk", "def", "mdef", "lv"];
}

function qualityFloorMissing(candidate, qualityFloor) {
  if (!qualityFloor || !candidate || !candidate.state) return [];
  const state = candidate.state;
  const hero = summarizeHero(state);
  const expectedHero = qualityFloorHero(qualityFloor);
  const missing = [];
  const floorId = qualityFloor.floorId || qualityFloor.targetFloorId;
  if (qualityFloor.mustReachSameFloor !== false && floorId && state.floorId !== floorId) {
    missing.push({ field: "floorId", expected: floorId, actual: state.floorId });
  }
  qualityFloorFields(qualityFloor).forEach((field) => {
    const expected = Number(expectedHero[field] || 0);
    if (expected > 0 && Number(hero[field] || 0) < expected) {
      missing.push({ field: `hero.${field}`, expected, actual: Number(hero[field] || 0) });
    }
  });
  if (qualityFloor.sameLevelMustNotLoseExp !== false) {
    const expectedLv = Number(expectedHero.lv || 0);
    const expectedExp = Number(expectedHero.exp || 0);
    if (expectedLv > 0 && expectedExp > 0 && Number(hero.lv || 0) === expectedLv && Number(hero.exp || 0) < expectedExp) {
      missing.push({ field: "hero.exp", expected: expectedExp, actual: Number(hero.exp || 0), reason: "same-level exp should not regress below quality floor" });
    }
  }
  return missing;
}

function candidateMeetsQualityFloor(candidate, qualityFloor) {
  return qualityFloorMissing(candidate, qualityFloor).length === 0;
}

function rankFinalCandidates(candidates, qualityFloor) {
  const ranked = (candidates || []).slice().sort((left, right) => {
    const leftPass = candidateMeetsQualityFloor(left, qualityFloor);
    const rightPass = candidateMeetsQualityFloor(right, qualityFloor);
    if (leftPass !== rightPass) return leftPass ? -1 : 1;
    const stateDiff = compareCandidateStates(left && left.state, right && right.state);
    if (stateDiff !== 0) return stateDiff;
    return candidateOutcomeScore(right) - candidateOutcomeScore(left);
  });
  return ranked;
}

function buildQualityFloorFailure(segment, candidates, qualityFloor) {
  const ranked = rankFinalCandidates(candidates || [], null);
  const best = ranked[0] || null;
  const missing = best
    ? qualityFloorMissing(best, qualityFloor)
    : [{ field: "candidate", expected: "route meeting quality floor", actual: "none" }];
  return {
    segmentId: segment && segment.id,
    label: segment && segment.label,
    found: false,
    failureClass: "route-quality-floor-not-met",
    failureReason: `best route does not meet quality floor${qualityFloor && qualityFloor.label ? `: ${qualityFloor.label}` : ""}`,
    bestSeen: best && compactState(best.state),
    missingGoalFields: missing,
    preferredCandidateTags: ["highest-hp", "highest-def", "best-combat"],
    recommendedRepair: "expand previous skyline and prefer higher-HP sustain/resource timing candidates before accepting this milestone",
    failurePropagation: {
      failureClass: "route-quality-floor-not-met",
      primaryFailureClass: "route-quality-floor-not-met",
      reason: "candidate route is below an explicit route-quality baseline",
      preferredCandidateTags: ["highest-hp", "highest-def", "best-combat"],
      recommendedNext: [
        "increase candidate limit for the previous milestone window",
        "rerun the window with route-quality baseline enabled",
        "preserve HP skyline candidates across floorFly/resource timing branches",
      ],
    },
    startCandidatesTried: candidates.length,
    candidates: compactSegmentCandidates(candidates),
    qualityFloor,
  };
}

function backtrackCandidateLimit(segment, config) {
  const base = numericOption(config && config.candidateLimit, numericOption(segment && segment.dp && segment.dp.goalSkylineLimit, 4));
  return Math.max(base + 1, numericOption(config && config.backtrackCandidateLimit, base * 2), 8);
}

function backtrackDpOverrides(segment, config) {
  const dpConfig = (segment || {}).dp || {};
  return {
    stopOnFirstGoal: false,
    goalSkylineLimit: backtrackCandidateLimit(segment, config || {}),
    maxExpansions: numericOption(
      config && config.backtrackMaxExpansions,
      Math.max(numericOption(dpConfig.maxExpansions, 1000), numericOption(dpConfig.maxExpansions, 1000) * 2)
    ),
    maxRuntimeMs: numericOption(
      config && config.backtrackMaxRuntimeMs,
      Math.max(numericOption(dpConfig.maxRuntimeMs, 5000), numericOption(dpConfig.maxRuntimeMs, 5000) * 2)
    ),
  };
}

function tryRepairFromPreviousMilestone(simulator, segments, segmentIndex, history, failedExecution, config) {
  if ((config || {}).enableFailureBacktracking === false) return null;
  if (!Array.isArray(history) || history.length === 0 || segmentIndex <= 0) return null;
  const previous = history[history.length - 1];
  if (!previous || previous.repairExpanded) return null;
  const failedSummary = failedExecution && failedExecution.summary;
  const preferredTags = ((failedSummary || {}).failurePropagation || {}).preferredCandidateTags || [];
  if (preferredTags.length === 0) return null;

  const previousSegment = previous.segment;
  const currentSegment = segments[segmentIndex];
  const expandedPrevious = runSegmentAgainstFrontier(simulator, previousSegment, previous.inputFrontier, config || {}, {
    candidateLimit: backtrackCandidateLimit(previousSegment, config || {}),
    dpOverrides: backtrackDpOverrides(previousSegment, config || {}),
    preserveSkylineRoles: true,
  });
  expandedPrevious.summary.backtrack = {
    mode: "expanded-previous-segment",
    triggeredBySegment: currentSegment.id,
    preferredCandidateTags: preferredTags,
    previousCandidateCount: previous.merged.length,
    expandedCandidateCount: expandedPrevious.merged.length,
  };
  if (expandedPrevious.merged.length === 0) {
    return { found: false, expandedPrevious, repairedCurrent: null };
  }

  const rankedFrontier = rankCandidatesByPreferredTags(expandedPrevious.merged, preferredTags)
    .slice(0, backtrackCandidateLimit(currentSegment, config || {}));
  const repairedCurrent = runSegmentAgainstFrontier(simulator, currentSegment, rankedFrontier, config || {}, {
    preserveSkylineRoles: true,
  });
  repairedCurrent.summary.backtrack = {
    mode: "retry-current-segment",
    repairedFromSegment: previousSegment.id,
    preferredCandidateTags: preferredTags,
    startCandidatesTried: rankedFrontier.length,
  };
  return {
    found: repairedCurrent.merged.length > 0,
    expandedPrevious,
    repairedCurrent,
  };
}

function runMilestoneGraph(simulator, initialState, milestoneSpec, options) {
  const config = options || {};
  const rangeError = milestoneRangeError(milestoneSpec, config.fromMilestoneId, config.toMilestoneId);
  if (rangeError) {
    return {
      found: false,
      reachedMilestone: config.fromMilestoneId || null,
      failedSegment: {
        segmentId: config.toMilestoneId || null,
        label: "Invalid milestone range",
        found: false,
        failureClass: "invalid-milestone-range",
        failureReason: rangeError,
        startCandidatesTried: 0,
        candidates: [],
        attempts: [],
        failurePropagation: {
          primaryFailureClass: "invalid-milestone-range",
          failureClass: "invalid-milestone-range",
          recommendedNext: ["choose a toMilestone that appears after fromMilestone in the route spec"],
        },
      },
      finalCandidates: [],
      segmentResults: [],
      checkpointResults: [],
    };
  }
  const segments = milestoneRange(milestoneSpec, config.fromMilestoneId, config.toMilestoneId);
  const checkpointResults = [];
  const initialFrontierState = cloneStateWithoutRouteTrace(initialState);
  let frontier = [{
    id: "initial#0",
    state: initialFrontierState,
    route: Array.isArray(initialState.route) ? initialState.route.slice() : [],
    trace: config.captureTrace === true && Array.isArray(initialState.routeTrace) ? initialState.routeTrace.slice() : [],
    hero: summarizeHero(initialState),
    effectiveHero: summarizeEffectiveHero(initialState),
    tags: ["initial"],
    score: goalCandidateScore(initialState),
  }];
  const segmentResults = [];
  const history = [];
  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    const segment = segments[segmentIndex];
    const execution = runSegmentAgainstFrontier(simulator, segment, frontier, config, {});
    if (execution.merged.length === 0) {
      const repair = tryRepairFromPreviousMilestone(simulator, segments, segmentIndex, history, execution, config);
      if (repair && repair.found) {
        if (checkpointResults.length > 0) checkpointResults.pop();
        checkpointResults.push(buildMilestoneCheckpoint(repair.expandedPrevious.segment, repair.expandedPrevious));
        checkpointResults.push(buildMilestoneCheckpoint(segment, repair.repairedCurrent));
        const previousIndex = segmentResults.length - 1;
        if (previousIndex >= 0) segmentResults[previousIndex] = repair.expandedPrevious.summary;
        segmentResults.push(repair.repairedCurrent.summary);
        history[history.length - 1] = {
          segment: repair.expandedPrevious.segment,
          inputFrontier: repair.expandedPrevious.inputFrontier,
          merged: repair.expandedPrevious.merged,
          summary: repair.expandedPrevious.summary,
          repairExpanded: true,
        };
        history.push({
          segment,
          inputFrontier: repair.repairedCurrent.inputFrontier,
          merged: repair.repairedCurrent.merged,
          summary: repair.repairedCurrent.summary,
        });
        frontier = repair.repairedCurrent.merged;
        continue;
      }
      const failedSummary = execution.summary;
      if (repair) {
        failedSummary.backtrack = {
          attempted: true,
          repaired: false,
          expandedPrevious: repair.expandedPrevious && {
            segmentId: repair.expandedPrevious.segment.id,
            candidates: compactSegmentCandidates(repair.expandedPrevious.merged),
          },
          repairedCurrent: repair.repairedCurrent && {
            segmentId: repair.repairedCurrent.segment.id,
            found: repair.repairedCurrent.merged.length > 0,
          },
        };
      }
      segmentResults.push(failedSummary);
      return {
        found: false,
        reachedMilestone: segment.startFrom || null,
        failedSegment: segmentResults[segmentResults.length - 1],
        finalCandidates: frontier,
        segmentResults,
        checkpointResults,
      };
    }
    segmentResults.push(execution.summary);
    checkpointResults.push(buildMilestoneCheckpoint(segment, execution));
    history.push({
      segment,
      inputFrontier: frontier,
      merged: execution.merged,
      summary: execution.summary,
    });
    frontier = execution.merged;
  }
  frontier = rankFinalCandidates(frontier, config.qualityFloor || null);
  const final = frontier[0] || null;
  if (final && config.qualityFloor && !candidateMeetsQualityFloor(final, config.qualityFloor)) {
    const finalSegment = segments[segments.length - 1] || null;
    const failedSummary = buildQualityFloorFailure(finalSegment, frontier, config.qualityFloor);
    segmentResults.push(failedSummary);
    return {
      found: false,
      reachedMilestone: finalSegment && (finalSegment.startFrom || null),
      failedSegment: failedSummary,
      finalCandidates: frontier,
      segmentResults,
      checkpointResults,
      qualityFloor: {
        passed: false,
        floor: config.qualityFloor,
      },
    };
  }
  return {
    found: Boolean(final),
    reachedMilestone: segments.length ? segments[segments.length - 1].id : null,
    failedSegment: null,
    finalCandidate: final,
    finalCandidates: frontier,
    segmentResults,
    checkpointResults,
    qualityFloor: config.qualityFloor ? {
      passed: Boolean(final),
      floor: config.qualityFloor,
    } : null,
  };
}

module.exports = {
  buildSegmentActionProvider,
  buildSegmentGoalPredicate,
  runMilestoneGraph,
  searchSegmentDP,
  summarizeEffectiveHero,
  summarizeHero,
  summarizeSegmentFailure,
};
