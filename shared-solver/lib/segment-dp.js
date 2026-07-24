"use strict";

const { buildDpStateKey, compareDpBest, searchDP } = require("./dp-search");
const { estimateBattleSurvivability } = require("./battle-thresholds");
const {
  annotateStateResourceTiming,
  buildResourceTimingOptions,
  compareResourceTimingStates,
  getTiming,
  hasTimingConflict,
  resourceTimingRoles,
} = require("./resource-timing-model");
const { formatActionLabel } = require("./enemy-labels");
const { buildSolverSnapshot } = require("./route-snapshot");
const {
  cloneState,
  getDecisionDepth,
  getTileDefinitionAt,
} = require("./state");
const { getFloorOrder } = require("./floor-id");
const reachAndBattleOracle = require("./reach-and-battle-oracle");

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function heroHp(state) {
  return number(((state || {}).hero || {}).hp, 0);
}

function effectiveHeroValue(state, field) {
  const hero = (state || {}).hero || {};
  const flags = (state || {}).flags || {};
  return Math.floor(
    number(hero[field], 0) * number(flags[`__${field}_buff__`], 1),
  );
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
  return (
    Array.isArray(((state || {}).hero || {}).equipment) &&
    state.hero.equipment.includes(itemId)
  );
}

function findPrimitiveAction(simulator, state, summary) {
  try {
    return (
      (simulator.enumeratePrimitiveActions(state).actions || []).find(
        (action) => action.summary === summary,
      ) || null
    );
  } catch (error) {
    return null;
  }
}

function checkMinFields(actual, expected, prefix, missing) {
  Object.entries(expected || {}).forEach(([field, value]) => {
    const got = number(actual[field], 0);
    if (got < Number(value)) {
      missing.push({
        field: `${prefix}.${field}`,
        expected: Number(value),
        actual: got,
      });
    }
  });
}

function buildActionSurvivableMissing(simulator, state, summary, action) {
  const threshold = estimateBattleSurvivability(
    simulator,
    state,
    action || summary,
  );
  const currentHp = number((state.hero || {}).hp, 0);
  const damage =
    threshold && threshold.supported
      ? number(threshold.currentDamage, Number.POSITIVE_INFINITY)
      : number(
          ((action || {}).estimate || {}).damage,
          Number.POSITIVE_INFINITY,
        );
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
    missing.push({
      field: "floorId",
      expected: goal.floorId,
      actual: state.floorId,
    });
  }
  checkMinFields(summarizeHero(state), goal.minHero, "hero", missing);
  checkMinFields(
    summarizeEffectiveHero(state),
    goal.minEffectiveHero,
    "effectiveHero",
    missing,
  );
  (goal.equipmentIncludes || []).forEach((itemId) => {
    if (!hasEquipment(state, itemId))
      missing.push({
        field: "equipment",
        expected: itemId,
        actual: summarizeHero(state).equipment,
      });
  });
  if (goal.type === "bossDefeated" || goal.type === "tileRemoved") {
    const tile = getTileDefinitionAt(
      project,
      state,
      goal.floorId,
      goal.x,
      goal.y,
    );
    if (tile != null) {
      missing.push({
        field: "tileRemoved",
        expected: `${goal.floorId}:${goal.x},${goal.y}=removed`,
        actual: tile.id || tile.number,
      });
    }
  }
  (goal.removedTiles || []).forEach((required) => {
    const tile = getTileDefinitionAt(
      project,
      state,
      required.floorId,
      required.x,
      required.y,
    );
    if (tile != null) {
      missing.push({
        field: "removedTiles",
        expected: `${required.floorId}:${required.x},${required.y}=removed`,
        actual: tile.id || tile.number,
      });
    }
  });
  if (Array.isArray(goal.anyRemovedTiles) && goal.anyRemovedTiles.length > 0) {
    const matched = goal.anyRemovedTiles.some(
      (required) =>
        getTileDefinitionAt(
          project,
          state,
          required.floorId,
          required.x,
          required.y,
        ) == null,
    );
    if (!matched) {
      missing.push({
        field: "anyRemovedTiles",
        expected: goal.anyRemovedTiles.map(
          (tile) => `${tile.floorId}:${tile.x},${tile.y}=removed`,
        ),
        actual: "all-present",
      });
    }
  }
  (goal.presentTiles || []).forEach((required) => {
    const tile = getTileDefinitionAt(
      project,
      state,
      required.floorId,
      required.x,
      required.y,
    );
    if (tile == null) {
      missing.push({
        field: "presentTiles",
        expected: `${required.floorId}:${required.x},${required.y}=present`,
        actual: "removed-or-missing",
      });
    }
  });
  if (goal.resourceDeferral) {
    const deferral = goal.resourceDeferral;
    const resourceSummary = deferral.resourceSummary || deferral.summary;
    if (resourceSummary && /^battle:/.test(resourceSummary)) {
      const threshold = estimateBattleSurvivability(simulator, state, resourceSummary, {
        skipMinHp: true,
      });
      if (!threshold || !threshold.supported) {
        missing.push({
          field: "resourceDeferral",
          expected: resourceSummary,
          actual: "unsupported-resource-target",
        });
      } else {
        const maxDamage = deferral.maxDamage != null
          ? Number(deferral.maxDamage)
          : Number.POSITIVE_INFINITY;
        if (Number(threshold.currentDamage) > maxDamage) {
          missing.push({
            field: "resourceDeferral.damage",
            expected: `<= ${maxDamage}`,
            actual: threshold.currentDamage,
            baselineDamage: deferral.baselineDamage,
            saving: Number(deferral.baselineDamage || 0) - Number(threshold.currentDamage || 0),
          });
        }
        if (deferral.requireSurvivable !== false && !threshold.survivable) {
          missing.push({
            field: "resourceDeferral.survivable",
            expected: `hp > ${threshold.currentDamage}`,
            actual: number((state.hero || {}).hp, 0),
            damage: threshold.currentDamage,
          });
        }
      }
    }
  }
  if (goal.actionSurvivable && goal.actionSurvivable.summary) {
    if (
      actionTargetAlreadyRemovedByGoal(
        project,
        state,
        goal,
        goal.actionSurvivable.summary,
      )
    ) {
      return missing;
    }
    const action = findPrimitiveAction(
      simulator,
      state,
      goal.actionSurvivable.summary,
    );
    if (!action) {
      if (!diagnostic) {
        missing.push({
          field: "actionSurvivable",
          expected: goal.actionSurvivable.summary,
          actual: "missing-action",
        });
      } else {
        const threshold = estimateBattleSurvivability(
          simulator,
          state,
          goal.actionSurvivable.summary,
        );
        if (threshold && threshold.supported && !threshold.survivable) {
          missing.push(
            buildActionSurvivableMissing(
              simulator,
              state,
              goal.actionSurvivable.summary,
              null,
            ),
          );
        } else {
          missing.push({
            field: "actionSurvivable",
            expected: goal.actionSurvivable.summary,
            actual: "missing-action",
          });
        }
      }
    } else {
      const damage = number(
        (action.estimate || {}).damage,
        Number.POSITIVE_INFINITY,
      );
      if (
        goal.actionSurvivable.exactDamage != null &&
        damage !== Number(goal.actionSurvivable.exactDamage)
      ) {
        missing.push({
          field: "actionDamage",
          expected: Number(goal.actionSurvivable.exactDamage),
          actual: damage,
        });
      }
      if (!(number((state.hero || {}).hp, 0) > damage)) {
        if (diagnostic) {
          missing.push(
            buildActionSurvivableMissing(
              simulator,
              state,
              goal.actionSurvivable.summary,
              action,
            ),
          );
        } else {
          missing.push({
            field: "actionSurvivable",
            expected: Number.isFinite(damage)
              ? `hp > ${damage}`
              : goal.actionSurvivable.summary,
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
  return (state) =>
    missingGoalFields(project, simulator, state, segment, { diagnostic: false })
      .length === 0;
}

function parseActionTileKey(summary) {
  const match = /^[^@]+@([^:]+):(\d+),(\d+)(?:\b|$)/.exec(
    String(summary || ""),
  );
  if (!match) return null;
  return `${match[1]}:${match[2]},${match[3]}`;
}

function parseTileKeyParts(tileKey) {
  const match = /^([^:]+):(\d+),(\d+)$/.exec(String(tileKey || ""));
  if (!match) return null;
  return { floorId: match[1], x: Number(match[2]), y: Number(match[3]) };
}

function segmentProtectedTiles(segment) {
  const goal = (segment || {}).goal || {};
  const policy = (segment || {}).actionPolicy || {};
  const byKey = new Map();
  [...(goal.presentTiles || []), ...(policy.protectedTiles || [])].forEach(
    (tile) => {
      if (!tile || tile.floorId == null || tile.x == null || tile.y == null)
        return;
      byKey.set(`${tile.floorId}:${tile.x},${tile.y}`, tile);
    },
  );
  return Array.from(byKey.values());
}

function actionTargetsProtectedTile(action, segment) {
  const actionTileKey = parseActionTileKey(action && action.summary);
  if (!actionTileKey) return false;
  return segmentProtectedTiles(segment).some(
    (tile) => `${tile.floorId}:${tile.x},${tile.y}` === actionTileKey,
  );
}

function isRequiredTileStillPresent(project, state, required) {
  return (
    getTileDefinitionAt(
      project,
      state,
      required.floorId,
      required.x,
      required.y,
    ) != null
  );
}

function actionTargetAlreadyRemovedByGoal(project, state, goal, summary) {
  const actionTileKey = parseActionTileKey(summary);
  if (!actionTileKey) return false;
  const requiredTiles = [];
  if (
    (goal.type === "bossDefeated" || goal.type === "tileRemoved") &&
    goal.floorId != null &&
    goal.x != null &&
    goal.y != null
  ) {
    requiredTiles.push({ floorId: goal.floorId, x: goal.x, y: goal.y });
  }
  (goal.removedTiles || []).forEach((tile) => requiredTiles.push(tile));
  return requiredTiles.some(
    (tile) =>
      `${tile.floorId}:${tile.x},${tile.y}` === actionTileKey &&
      getTileDefinitionAt(project, state, tile.floorId, tile.x, tile.y) == null,
  );
}

function goalActionScore(simulator, state, action, segment) {
  const goal = (segment || {}).goal || {};
  let score = 0;
  const actionTileKey = parseActionTileKey(action && action.summary);
  for (const required of goal.removedTiles || []) {
    const requiredKey = `${required.floorId}:${required.x},${required.y}`;
    if (
      actionTileKey === requiredKey &&
      isRequiredTileStillPresent(simulator.project, state, required)
    ) {
      score += 10000000;
    }
  }
  for (const required of goal.anyRemovedTiles || []) {
    const requiredKey = `${required.floorId}:${required.x},${required.y}`;
    if (
      actionTileKey === requiredKey &&
      isRequiredTileStillPresent(simulator.project, state, required)
    ) {
      score += 8000000;
    }
  }
  for (const preserved of goal.presentTiles || []) {
    const preservedKey = `${preserved.floorId}:${preserved.x},${preserved.y}`;
    if (
      actionTileKey === preservedKey &&
      isRequiredTileStillPresent(simulator.project, state, preserved)
    ) {
      score -= 10000000;
    }
  }
  for (const preferred of goal.preferredPresentTiles || []) {
    const preferredKey = `${preferred.floorId}:${preferred.x},${preferred.y}`;
    if (
      actionTileKey === preferredKey &&
      isRequiredTileStillPresent(simulator.project, state, preferred)
    ) {
      score -= 1000000;
    }
  }
  if (action && action.kind === "equip") {
    for (const itemId of goal.equipmentIncludes || []) {
      if (
        String(action.summary || "") === `equip:${itemId}` &&
        !hasEquipment(state, itemId)
      )
        score += 12000000;
    }
  }
  if (
    action &&
    action.kind === "changeFloor" &&
    goal.floorId &&
    action.changeFloor &&
    action.changeFloor.floorId === goal.floorId
  ) {
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
    const equipmentGain = afterHero.equipment.filter(
      (itemId) => !beforeHero.equipment.includes(itemId),
    ).length;
    return Math.max(
      0,
      afterHero.hp -
        beforeHero.hp +
        (afterEffective.atk - beforeEffective.atk) * 50000 +
        (afterEffective.def - beforeEffective.def) * 40000 +
        (afterEffective.mdef - beforeEffective.mdef) * 5000 +
        (afterHero.exp - beforeHero.exp) * 1500 +
        equipmentGain * 300000,
    );
  } catch (error) {
    return 0;
  }
}

function actionSurvivablePrepScore(simulator, state, action, segment) {
  const goal = (segment || {}).goal || {};
  if (!goal.actionSurvivable || !goal.actionSurvivable.summary || !action)
    return 0;
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
    const equipmentGain = afterHero.equipment.filter(
      (itemId) => !beforeHero.equipment.includes(itemId),
    ).length;
    const positivePrep =
      hpGain > 0 ||
      atkGain > 0 ||
      defGain > 0 ||
      mdefGain > 0 ||
      expGain > 0 ||
      equipmentGain > 0;
    if (!positivePrep) return 0;
    const damage = number((action.estimate || {}).damage, 0);
    return Math.max(
      0,
      hpGain * 8 +
        atkGain * 30000 +
        defGain * 140000 +
        mdefGain * 5000 +
        expGain * 2500 +
        equipmentGain * 500000 -
        Math.max(0, damage) * 0.2,
    );
  } catch (error) {
    return 0;
  }
}

function resourceTimingLookaheadScore(simulator, state, action, segment) {
  const dpConfig = (segment || {}).dp || {};
  if (dpConfig.resourceLookahead !== true) return 0;
  if (
    !action ||
    action.kind === "changeFloor" ||
    action.kind === "floorFly" ||
    action.kind === "equip"
  )
    return 0;
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
      nextActions = nextActions.concat(
        simulator.enumerateInteractPickupActions(preview) || [],
      );
    } catch (error) {}
  }
  const candidates = nextActions
    .filter((nextAction) => nextAction && nextAction.summary !== action.summary)
    .filter(
      (nextAction) =>
        nextAction.kind !== "changeFloor" && nextAction.kind !== "floorFly",
    )
    .filter((nextAction) =>
      isAllowedAction(nextAction, preview, segment, simulator),
    )
    .map((nextAction) => ({
      action: nextAction,
      prepScore: actionSurvivablePrepScore(
        simulator,
        preview,
        nextAction,
        segment,
      ),
      previewScore: segmentPreviewScore(simulator, preview, nextAction),
      damage: number((nextAction.estimate || {}).damage, 0),
    }))
    .filter((record) => record.prepScore > 0 || record.previewScore > 0)
    .sort(
      (left, right) =>
        right.prepScore +
          right.previewScore -
          (left.prepScore + left.previewScore) || left.damage - right.damage,
    )
    .slice(0, number(dpConfig.resourceLookaheadActions, 8));
  let best = 0;
  for (const record of candidates) {
    let second = null;
    try {
      second = simulator.applyAction(preview, record.action, {
        storeRoute: false,
      });
    } catch (error) {
      continue;
    }
    const afterHero = summarizeHero(second);
    const afterEffective = summarizeEffectiveHero(second);
    const hpDelta = number(afterHero.hp, 0) - number(beforeHero.hp, 0);
    const atkDelta =
      number(afterEffective.atk, 0) - number(beforeEffective.atk, 0);
    const defDelta =
      number(afterEffective.def, 0) - number(beforeEffective.def, 0);
    const mdefDelta =
      number(afterEffective.mdef, 0) - number(beforeEffective.mdef, 0);
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
  return (
    dpConfig.resourceTimingMode === "sustain-prep" ||
    policy.resourceTimingMode === "sustain-prep"
  );
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
  const prepScore = actionSurvivablePrepScore(
    simulator,
    state,
    action,
    segment,
  );
  const lookaheadScore = resourceTimingLookaheadScore(
    simulator,
    state,
    action,
    segment,
  );
  const previewScore =
    dpConfig.enablePreviewScore === false
      ? 0
      : dpConfig.enablePreviewScore === "required"
        ? goalScore > 0 || prepScore > 0 || lookaheadScore > 0
          ? segmentPreviewScore(simulator, state, action) +
            prepScore +
            lookaheadScore
          : 0
        : segmentPreviewScore(simulator, state, action);
  const score =
    goalScore +
    previewScore +
    (dpConfig.enablePreviewScore === "required"
      ? 0
      : prepScore + lookaheadScore);
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
  if (policy.allowedFloors && !policy.allowedFloors.includes(floorId))
    return false;
  const targetFloor = action.changeFloor && action.changeFloor.floorId;
  return (
    !targetFloor ||
    !policy.allowedFloors ||
    policy.allowedFloors.includes(targetFloor)
  );
}

function isAllowedAction(action, state, segment, simulator) {
  const policy = (segment || {}).actionPolicy || {};
  const goal = (segment || {}).goal || {};
  const allowedKinds = new Set(
    policy.actionKinds || [
      "battle",
      "pickup",
      "equip",
      "openDoor",
      "useTool",
      "changeFloor",
      "event",
    ],
  );
  if (!action || !allowedKinds.has(action.kind)) return false;
  if (
    action.kind === "resourcePocket" ||
    action.kind === "resourceCluster" ||
    action.kind === "resourceChain" ||
    action.kind === "fightToLevelUp"
  )
    return false;
  if (
    action.kind === "event" &&
    policy.forbidUnsupportedEvents !== false &&
    (action.unsupported || action.hasStateChange === false)
  )
    return false;
  if (actionTargetsProtectedTile(action, segment)) return false;
  const actionTileKey = parseActionTileKey(action.summary);
  for (const preserved of goal.presentTiles || []) {
    const preservedKey = `${preserved.floorId}:${preserved.x},${preserved.y}`;
    if (
      actionTileKey === preservedKey &&
      isRequiredTileStillPresent(simulator.project, state, preserved)
    )
      return false;
  }
  if (action.kind === "changeFloor")
    return isAllowedChangeFloor(action, state, policy);
  if (action.kind === "floorFly") {
    const targetFloor =
      action.targetFloorId || (action.target && action.target.floorId);
    return (
      !policy.allowedFloors ||
      (policy.allowedFloors.includes(action.floorId || state.floorId) &&
        policy.allowedFloors.includes(targetFloor))
    );
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
    const targetFloor =
      action.targetFloorId || (action.target && action.target.floorId) || "?";
    if (!floorFlyGroups.has(targetFloor)) floorFlyGroups.set(targetFloor, []);
    floorFlyGroups.get(targetFloor).push(action);
  }
  floorFlyGroups.forEach((group) => {
    group
      .slice()
      .sort(
        (left, right) => (left.path || []).length - (right.path || []).length,
      )
      .slice(0, maxPerTarget)
      .forEach((action) => kept.push(action));
  });
  return kept;
}

function actionTravelHp(action) {
  return number((((action || {}).travelState || {}).hero || {}).hp, 0);
}

function compareSegmentActionRepresentatives(left, right) {
  const leftScore = number(
    ((left || {}).estimate || {}).segmentPreviewScore,
    0,
  );
  const rightScore = number(
    ((right || {}).estimate || {}).segmentPreviewScore,
    0,
  );
  if (leftScore !== rightScore) return rightScore - leftScore;
  const leftDamage = number(((left || {}).estimate || {}).damage, 0);
  const rightDamage = number(((right || {}).estimate || {}).damage, 0);
  if (leftDamage !== rightDamage) return leftDamage - rightDamage;
  const hpDiff = actionTravelHp(right) - actionTravelHp(left);
  if (hpDiff !== 0) return hpDiff;
  return ((left || {}).path || []).length - ((right || {}).path || []).length;
}

function deduplicateSegmentActions(actions) {
  const bySummary = new Map();
  const passthrough = [];
  for (const action of actions || []) {
    const summary = action && action.summary;
    if (!summary) {
      passthrough.push(action);
      continue;
    }
    const existing = bySummary.get(summary);
    if (
      !existing ||
      compareSegmentActionRepresentatives(action, existing) < 0
    ) {
      bySummary.set(summary, action);
    }
  }
  return passthrough.concat(Array.from(bySummary.values()));
}

function buildSegmentActionProvider(simulator, segment) {
  return (unusedSimulator, state) => {
    const policy = (segment || {}).actionPolicy || {};
    const allowedKinds = new Set(
      policy.actionKinds || [
        "battle",
        "pickup",
        "equip",
        "openDoor",
        "useTool",
        "changeFloor",
        "event",
      ],
    );
    const primitive = simulator.enumeratePrimitiveActions(state).actions || [];
    let actions = primitive;
    if (
      allowedKinds.has("interactPickup") &&
      typeof simulator.enumerateInteractPickupActions === "function"
    ) {
      actions = actions.concat(simulator.enumerateInteractPickupActions(state));
    }
    if (
      allowedKinds.has("floorFly") &&
      typeof simulator.enumerateFloorFlyActions === "function"
    ) {
      actions = actions.concat(simulator.enumerateFloorFlyActions(state));
    }
    const filtered = trimFloorFlyActions(actions, policy)
      .filter((action) => isAllowedAction(action, state, segment, simulator))
      .filter((action) =>
        isResourceTimingAction(simulator, state, action, segment),
      )
      .map((action) =>
        annotateSegmentAction(simulator, state, action, segment),
      );
    return deduplicateSegmentActions(filtered);
  };
}

function closeStateForBattleFrontier(simulator, state, segment) {
  const closed = cloneState(state);
  if (typeof simulator.stabilizeState !== "function") return closed;
  const saved = protectPresentTiles(simulator.project, closed, segment);
  try {
    return simulator.stabilizeState(closed);
  } finally {
    restorePresentTiles(saved);
  }
}

function deduplicatePortalActions(actions) {
  const battles = [];
  const portalsByTarget = new Map();
  const others = [];
  for (const action of actions || []) {
    if (!action) continue;
    if (action.kind === "battle") {
      battles.push(action);
    } else if (action.kind === "changeFloor" || action.kind === "floorFly") {
      const targetFloor =
        action.kind === "floorFly"
          ? action.targetFloorId ||
            (action.target && action.target.floorId) ||
            "?"
          : (action.changeFloor && action.changeFloor.floorId) || "?";
      const existing = portalsByTarget.get(targetFloor);
      if (
        !existing ||
        (action.path || []).length < (existing.path || []).length
      ) {
        portalsByTarget.set(targetFloor, action);
      }
    } else {
      others.push(action);
    }
  }
  return [...battles, ...portalsByTarget.values(), ...others];
}

const BLOCKER_TILE_NUMBER = 1;

function isTileBlocking(project, tileNumber) {
  const def = project.mapTilesByNumber[String(tileNumber)];
  if (!def) return false;
  if (def.cls && def.cls.indexOf("enemy") === 0) return false;
  if (def.trigger === "openDoor") return false;
  if (def.cls === "items") return false;
  return def.canPass !== true;
}

function protectPresentTiles(project, state, segment) {
  const saved = [];
  for (const required of segmentProtectedTiles(segment)) {
    const floorState = (state.floorStates || {})[required.floorId];
    if (!floorState) continue;
    const key = `${required.x},${required.y}`;
    if (floorState.removed[key]) continue;
    const tileNum = Object.prototype.hasOwnProperty.call(
      floorState.replaced,
      key,
    )
      ? floorState.replaced[key]
      : null;
    const tile =
      tileNum != null
        ? project.mapTilesByNumber[String(tileNum)]
        : getTileDefinitionAt(
            project,
            state,
            required.floorId,
            required.x,
            required.y,
          );
    if (!tile) continue;
    if (!isTileBlocking(project, BLOCKER_TILE_NUMBER)) {
      throw new Error(
        `protectPresentTiles: tile ${BLOCKER_TILE_NUMBER} is not a blocking tile`,
      );
    }
    const wasRemoved = floorState.removed[key];
    const wasReplaced = floorState.replaced[key];
    saved.push({
      floorId: required.floorId,
      key,
      wasRemoved,
      wasReplaced,
      floorState,
    });
    delete floorState.removed[key];
    floorState.replaced[key] = BLOCKER_TILE_NUMBER;
  }
  return saved;
}

function restorePresentTiles(saved) {
  for (const entry of saved) {
    if (entry.wasRemoved) {
      entry.floorState.removed[entry.key] = true;
    } else {
      delete entry.floorState.removed[entry.key];
    }
    if (entry.wasReplaced !== undefined) {
      entry.floorState.replaced[entry.key] = entry.wasReplaced;
    } else {
      delete entry.floorState.replaced[entry.key];
    }
  }
}

function enumerateMonsterTargets(simulator, state, segment) {
  const policy = (segment || {}).actionPolicy || {};
  const goal = (segment || {}).goal || {};
  const allowedFloors = policy.allowedFloors || [];
  const project = simulator.project;
  const targets = [];

  for (const floorId of allowedFloors) {
    const floor = project.floorsById[floorId];
    if (!floor) continue;
    const height =
      floor.height || (Array.isArray(floor.map) ? floor.map.length : 0);
    const width = floor.width || 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const tile = getTileDefinitionAt(project, state, floorId, x, y);
        if (!tile || !tile.cls || tile.cls.indexOf("enemy") !== 0) continue;
        const enemyId = tile.id;
        if (!enemyId) continue;

        const preservedKey = `${floorId}:${x},${y}`;
        const isProtected = segmentProtectedTiles(segment).some(
          (p) => `${p.floorId}:${p.x},${p.y}` === preservedKey,
        );
        if (isProtected) continue;

        const target = {
          kind: "battle",
          summary: `battle:${enemyId}@${floorId}:${x},${y}`,
          floorId,
          x,
          y,
          enemyId,
          monsterTarget: true,
        };
        targets.push(target);
      }
    }
  }

  return targets;
}

function isAllowedPortalAction(action, state, policy) {
  if (action.kind === "changeFloor")
    return isAllowedChangeFloor(action, state, policy);
  if (action.kind === "floorFly") {
    const targetFloor =
      action.targetFloorId || (action.target && action.target.floorId);
    if (policy.allowedFloors && !policy.allowedFloors.includes(targetFloor))
      return false;
    return true;
  }
  return true;
}

function oracleFindFloorState(
  simulator,
  state,
  targetFloorId,
  segment,
  config,
) {
  const states = oracleFindFloorStates(
    simulator,
    state,
    targetFloorId,
    segment,
    config,
  );
  return states[0] || null;
}

function floorResultIdentity(result) {
  const state = result && result.state ? result.state : {};
  const hero = state.hero || {};
  return JSON.stringify({
    floorId: state.floorId,
    loc: hero.loc || null,
    hp: number(hero.hp, 0),
    atk: number(hero.atk, 0),
    def: number(hero.def, 0),
    mdef: number(hero.mdef, 0),
    lv: number(hero.lv, 0),
    exp: number(hero.exp, 0),
    equipment: Array.isArray(hero.equipment)
      ? hero.equipment.slice().sort()
      : [],
  });
}

function selectOracleFloorResults(results, maxEntries) {
  const candidates = results.map((result) => {
    const hero = summarizeHero(result.state);
    const effective = summarizeEffectiveHero(result.state);
    const travelLength = Array.isArray(result.travelActions)
      ? result.travelActions.length
      : 0;
    return {
      ...result,
      _roleScores: {
        highestHp: hero.hp,
        shortestTravel: -travelLength,
        bestCombatStats:
          effective.atk * 100000 +
          effective.def * 80000 +
          effective.mdef * 8000 +
          hero.exp * 1000 +
          hero.hp,
        highestEffectiveDef: effective.def,
      },
    };
  });
  const selected = [];
  const seen = new Set();
  const add = (candidate) => {
    if (!candidate || selected.length >= maxEntries) return false;
    const key = floorResultIdentity(candidate);
    if (seen.has(key)) return false;
    seen.add(key);
    selected.push(candidate);
    return true;
  };
  for (const role of [
    "highestHp",
    "shortestTravel",
    "bestCombatStats",
    "highestEffectiveDef",
  ]) {
    candidates
      .slice()
      .sort((left, right) => {
        const diff = right._roleScores[role] - left._roleScores[role];
        if (diff !== 0) return diff;
        return (
          (left.travelActions || []).length - (right.travelActions || []).length
        );
      })
      .some(add);
  }
  candidates
    .slice()
    .sort((left, right) => {
      const leftHero = summarizeHero(left.state);
      const rightHero = summarizeHero(right.state);
      return rightHero.hp - leftHero.hp;
    })
    .forEach(add);
  return selected;
}

function oracleFindFloorStates(
  simulator,
  state,
  targetFloorId,
  segment,
  config,
) {
  const maxSteps = number((config || {}).maxPortalDepth, 10) * 50;
  const maxEntries = number((config || {}).maxOracleFloorEntries, 4);
  const policy = (segment || {}).actionPolicy || {};
  const goal = (segment || {}).goal || {};

  // BFS including walking, portals, and floorFly to navigate to target floor
  const queue = [{ state: cloneState(state), steps: 0, actions: [] }];
  const visited = new Set();
  const results = [];
  const posKey = (s) =>
    `${s.floorId}:${(s.hero.loc || {}).x},${(s.hero.loc || {}).y}`;
  visited.add(posKey(state));

  while (queue.length > 0) {
    const { state: current, steps, actions } = queue.shift();

    if (current.floorId === targetFloorId) {
      const closed = closeStateForBattleFrontier(simulator, current, segment);
      results.push({ state: closed, travelActions: actions });
      continue;
    }

    if (steps >= maxSteps) continue;

    // Collect portal actions: primitive changeFloor + floorFly
    let portalActions = [];
    const primitive =
      simulator.enumeratePrimitiveActions(current).actions || [];
    portalActions = portalActions.concat(
      primitive.filter((a) => a.kind === "changeFloor"),
    );
    if (typeof simulator.enumerateFloorFlyActions === "function") {
      portalActions = portalActions.concat(
        simulator.enumerateFloorFlyActions(current),
      );
    }

    for (const action of portalActions) {
      if (!isAllowedPortalAction(action, current, policy)) continue;
      // Check presentTiles: don't traverse through protected tiles
      const actionTileKey = parseActionTileKey(action.summary);
      const hitsProtected = segmentProtectedTiles(segment).some(
        (p) => `${p.floorId}:${p.x},${p.y}` === actionTileKey,
      );
      if (hitsProtected) continue;

      try {
        const next = simulator.applyAction(current, action, {
          storeRoute: false,
        });
        const key = posKey(next);
        if (visited.has(key)) continue;
        visited.add(key);
        queue.push({
          state: next,
          steps: steps + 1,
          actions: actions.concat(action),
        });
      } catch (error) {
        /* skip */
      }
    }
  }

  return selectOracleFloorResults(results, maxEntries);
}

function battleMarginForGoal(simulator, state, segment) {
  const goal = (segment || {}).goal || {};
  const targetSummary = goal.actionSurvivable && goal.actionSurvivable.summary;
  if (!targetSummary) return Number.NEGATIVE_INFINITY;
  try {
    const threshold = estimateBattleSurvivability(
      simulator,
      state,
      targetSummary,
      { skipMinHp: true },
    );
    if (!threshold || !threshold.supported) return Number.NEGATIVE_INFINITY;
    return (
      number(((state || {}).hero || {}).hp, 0) -
      number(threshold.currentDamage, Number.POSITIVE_INFINITY)
    );
  } catch (error) {
    return Number.NEGATIVE_INFINITY;
  }
}

function successorIdentity(candidate) {
  const state = candidate && candidate.postState ? candidate.postState : {};
  const hero = state.hero || {};
  return JSON.stringify({
    floorId: state.floorId,
    loc: hero.loc || null,
    hp: number(hero.hp, 0),
    atk: number(hero.atk, 0),
    def: number(hero.def, 0),
    mdef: number(hero.mdef, 0),
    lv: number(hero.lv, 0),
    exp: number(hero.exp, 0),
    equipment: Array.isArray(hero.equipment)
      ? hero.equipment.slice().sort()
      : [],
  });
}

function selectMonsterOnlySuccessors(
  simulator,
  results,
  segment,
  maxSuccessors,
  stats,
) {
  const candidates = results.map((candidate) => {
    const state = candidate.postState;
    const hero = summarizeHero(state);
    const effective = summarizeEffectiveHero(state);
    const routePatchLength = Array.isArray(candidate.routePatch)
      ? candidate.routePatch.length
      : 0;
    return {
      ...candidate,
      _roleScores: {
        highestPostHp: hero.hp,
        bestTargetMargin: battleMarginForGoal(simulator, state, segment),
        highestEffectiveDef: effective.def,
        highestEffectiveMdef: effective.mdef,
        highestCombatStats:
          effective.atk * 100000 +
          effective.def * 80000 +
          effective.mdef * 8000 +
          hero.exp * 1000 +
          hero.hp,
        shortestRoute: -routePatchLength,
      },
    };
  });
  const roles = [
    "highestPostHp",
    "bestTargetMargin",
    "highestEffectiveDef",
    "highestEffectiveMdef",
    "highestCombatStats",
    "shortestRoute",
  ];
  const selected = [];
  const seen = new Set();
  const add = (candidate, role) => {
    if (!candidate || selected.length >= maxSuccessors) return;
    const key = successorIdentity(candidate);
    if (seen.has(key)) return;
    seen.add(key);
    candidate._selectedRole = role;
    selected.push(candidate);
  };
  for (const role of roles) {
    candidates
      .slice()
      .sort((left, right) => {
        const diff = right._roleScores[role] - left._roleScores[role];
        if (diff !== 0) return diff;
        return right.preHp - left.preHp;
      })
      .some((candidate) => {
        const before = selected.length;
        add(candidate, role);
        return selected.length > before;
      });
  }
  candidates
    .slice()
    .sort((left, right) => right.preHp - left.preHp)
    .forEach((candidate) => add(candidate, "highestPreHpFallback"));
  const capped = selected.slice(0, maxSuccessors);
  if (stats) {
    if (!stats.successorSelectedByRole) stats.successorSelectedByRole = {};
    capped.forEach((candidate) => {
      const role = candidate._selectedRole || "unknown";
      stats.successorSelectedByRole[role] =
        Number(stats.successorSelectedByRole[role] || 0) + 1;
    });
  }
  return capped;
}

function tryReachAndBattle(
  simulator,
  state,
  target,
  segment,
  config,
  oracleCache,
  stats,
) {
  // First navigate to the target floor (with optional memoization)
  let floorResults;
  if (oracleCache && oracleCache.has(target.floorId)) {
    floorResults = oracleCache.get(target.floorId);
  } else {
    const floorStartedAt = Date.now();
    floorResults = oracleFindFloorStates(
      simulator,
      state,
      target.floorId,
      segment,
      config,
    );
    if (stats)
      stats.oracleFloorSearchMs =
        Number(stats.oracleFloorSearchMs || 0) + (Date.now() - floorStartedAt);
    if (oracleCache) oracleCache.set(target.floorId, floorResults);
  }
  if (!Array.isArray(floorResults) || floorResults.length === 0)
    return { ok: false, reason: "unreachable-floor" };
  if (stats) {
    stats.floorEntriesReturned =
      Number(stats.floorEntriesReturned || 0) + floorResults.length;
    stats.maxFloorEntriesReturned = Math.max(
      Number(stats.maxFloorEntriesReturned || 0),
      floorResults.length,
    );
  }
  const maxSuccessors = number((config || {}).maxSuccessorsPerTarget, 4);

  // Collect all valid postStates from different positions
  const results = [];
  for (const floorResult of floorResults) {
    const closed = floorResult.state;
    const travelActions = floorResult.travelActions;

    // Use walk reachability to find the battle action from any reachable position
    const reachabilityStartedAt = Date.now();
    const reachability = simulator.getWalkReachability(closed);
    if (stats)
      stats.oracleBattleReachabilityMs =
        Number(stats.oracleBattleReachabilityMs || 0) +
        (Date.now() - reachabilityStartedAt);
    const visited = reachability.visited || {};
    if (stats) {
      const visitedCount = Object.keys(visited).length;
      stats.reachabilityNodes =
        Number(stats.reachabilityNodes || 0) + visitedCount;
      stats.maxReachabilityNodes = Math.max(
        Number(stats.maxReachabilityNodes || 0),
        visitedCount,
      );
    }

    for (const node of Object.values(visited)) {
      const nodeState = node.state;
      const primitive =
        simulator.enumeratePrimitiveActions(nodeState).actions || [];
      const battleAction = primitive.find(
        (action) =>
          action.kind === "battle" && action.summary === target.summary,
      );
      if (!battleAction) continue;

      try {
        const postState = simulator.applyAction(nodeState, battleAction, {
          storeRoute: false,
        });
        // Build routePatch: travel actions + battle action (no walk pseudo action)
        const routePatch = travelActions.concat(battleAction);
        results.push({
          postState,
          battleAction,
          routePatch,
          preHp: nodeState.hero ? nodeState.hero.hp : 0,
        });
      } catch (error) {
        continue;
      }
    }
  }

  if (results.length === 0)
    return { ok: false, reason: "battle-not-reachable" };
  if (stats) {
    stats.successorCandidatesBeforeCap =
      Number(stats.successorCandidatesBeforeCap || 0) + results.length;
  }
  const cappedResults = selectMonsterOnlySuccessors(
    simulator,
    results,
    segment,
    maxSuccessors,
    stats,
  );
  if (stats) {
    stats.successorCandidatesAfterCap =
      Number(stats.successorCandidatesAfterCap || 0) + cappedResults.length;
    stats.successorCapDrops =
      Number(stats.successorCapDrops || 0) +
      Math.max(0, results.length - cappedResults.length);
  }
  return { ok: true, results: cappedResults };
}

function scoreMonsterTarget(simulator, target, state, segment) {
  const threshold = (() => {
    try {
      return estimateBattleSurvivability(simulator, state, target, {
        skipMinHp: true,
      });
    } catch (error) {
      return null;
    }
  })();
  // Prefer current floor targets (reachable without portal)
  const currentFloor = state.floorId === target.floorId ? 10000 : 0;
  const reachableNow = target.reachableNow ? 1000000 : 0;
  const damage =
    threshold && threshold.supported ? number(threshold.currentDamage, 0) : 0;
  const hp = number(((state || {}).hero || {}).hp, 0);
  const survivable =
    threshold && threshold.supported && hp > damage ? 50000 : 0;
  const lowDamage =
    threshold && threshold.supported ? Math.max(0, hp - damage) : 0;
  const goal = (segment || {}).goal || {};
  const goalTarget = parseTileKeyParts(
    parseActionTileKey(goal.actionSurvivable && goal.actionSurvivable.summary),
  );
  const distanceToGoalTarget =
    goalTarget && target.floorId === goalTarget.floorId
      ? 1000 -
        Math.abs(target.x - goalTarget.x) -
        Math.abs(target.y - goalTarget.y)
      : 0;
  // Prefer enemies on higher floors (closer to goal)
  const floorScore = getFloorOrder(target.floorId) * 10;
  return (
    reachableNow +
    survivable +
    currentFloor +
    lowDamage +
    distanceToGoalTarget +
    floorScore
  );
}

function buildMonsterOnlyActionProvider(simulator, segment, config, stats) {
  const policy = (segment || {}).actionPolicy || {};
  const goal = (segment || {}).goal || {};
  const maxTargets = number((config || {}).maxMonsterTargets, 64);

  return (unusedSimulator, state) => {
    const project = simulator.project;
    const allowedFloors =
      policy.allowedFloors || Object.keys(project.floorsById || {});
    const reachableBattleSummaries = new Set();
    try {
      (simulator.enumeratePrimitiveActions(state).actions || [])
        .filter((action) => action.kind === "battle" && action.summary)
        .forEach((action) => reachableBattleSummaries.add(action.summary));
    } catch (error) {
      /* ignore */
    }
    const targets = [];
    for (const floorId of allowedFloors) {
      const floor = project.floorsById[floorId];
      if (!floor) continue;
      const height =
        floor.height || (Array.isArray(floor.map) ? floor.map.length : 0);
      const width = floor.width || 0;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const tile = getTileDefinitionAt(project, state, floorId, x, y);
          if (!tile || !tile.cls || tile.cls.indexOf("enemy") !== 0) continue;
          const enemyId = tile.id;
          if (!enemyId) continue;
          const preservedKey = `${floorId}:${x},${y}`;
          const isProtected = segmentProtectedTiles(segment).some(
            (p) => `${p.floorId}:${p.x},${p.y}` === preservedKey,
          );
          if (isProtected) continue;
          const summary = `battle:${enemyId}@${floorId}:${x},${y}`;
          targets.push({
            kind: "battle",
            summary,
            floorId,
            x,
            y,
            enemyId,
            reachableNow: reachableBattleSummaries.has(summary),
            monsterTarget: true,
          });
        }
      }
    }
    targets.sort(
      (a, b) =>
        scoreMonsterTarget(simulator, b, state, segment) -
        scoreMonsterTarget(simulator, a, state, segment),
    );
    const cappedTargets = targets.slice(0, maxTargets);
    if (stats) {
      stats.targetsGenerated =
        Number(stats.targetsGenerated || 0) + targets.length;
      stats.targetsAfterCap =
        Number(stats.targetsAfterCap || 0) + cappedTargets.length;
      stats.reachableTargetsGenerated =
        Number(stats.reachableTargetsGenerated || 0) +
        targets.filter((target) => target.reachableNow).length;
      stats.reachableTargetsAfterCap =
        Number(stats.reachableTargetsAfterCap || 0) +
        cappedTargets.filter((target) => target.reachableNow).length;
      stats.targetCapDrops =
        Number(stats.targetCapDrops || 0) +
        Math.max(0, targets.length - cappedTargets.length);
      stats.maxTargetsGeneratedForState = Math.max(
        Number(stats.maxTargetsGeneratedForState || 0),
        targets.length,
      );
      stats.maxTargetsAfterCapForState = Math.max(
        Number(stats.maxTargetsAfterCapForState || 0),
        cappedTargets.length,
      );
      if (targets.length > maxTargets) stats.statesWithTargetCap += 1;
    }
    return cappedTargets;
  };
}

function routeLength(state) {
  return Array.isArray((state || {}).route) ? state.route.length : 0;
}

function goalCandidateScore(state) {
  const hero = summarizeHero(state);
  const effective = summarizeEffectiveHero(state);
  return (
    hero.hp +
    effective.atk * 100000 +
    effective.def * 80000 +
    effective.mdef * 8000 +
    hero.exp * 1000 -
    routeLength(state) * 10
  );
}

function candidateOutcomeScore(candidate) {
  const state = candidate && candidate.state ? candidate.state : candidate;
  const hero = summarizeHero(state);
  const effective = summarizeEffectiveHero(state);
  return (
    hero.hp * 1000000 +
    hero.lv * 100000000000 +
    hero.exp * 10000000 +
    effective.atk * 10000 +
    effective.def * 8000 +
    effective.mdef * 1000 -
    routeLength(state)
  );
}

function compareCandidateStates(left, right) {
  if (!right) return -1;
  if (!left) return 1;
  const leftHero = summarizeHero(left);
  const rightHero = summarizeHero(right);
  const hpDiff = rightHero.hp - leftHero.hp;
  if (hpDiff !== 0) return hpDiff;
  for (const field of ["atk", "def", "mdef"]) {
    const diff =
      effectiveHeroValue(right, field) - effectiveHeroValue(left, field);
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
  const snapshot = buildSolverSnapshot(project, state, {
    floorIds: [state.floorId].filter(Boolean),
  });
  snapshot.partial = true;
  return snapshot;
}

function compactTraceEntry(project, entry) {
  if (!entry || !entry.actionEntry) return null;
  const preSnapshot =
    entry.preSnapshot || buildTraceSnapshot(project, entry.preState);
  const postSnapshot =
    entry.postSnapshot || buildTraceSnapshot(project, entry.postState);
  return {
    actionEntry: entry.actionEntry,
    preSnapshot,
    postSnapshot,
    preStateKey: entry.preStateKey || null,
    postStateKey: entry.postStateKey || null,
  };
}

function selectGoalSkyline(simulator, states, segment, options) {
  const config = options || {};
  const limit = Math.max(
    1,
    number(
      config.candidateLimit || (segment.dp || {}).goalSkylineLimit,
      8,
    ),
  );
  const keyMode = (segment.dp || {}).keyMode || "region";
  const byKey = new Map();
  (states || []).filter(Boolean).forEach((state) => {
    const stateKey = buildDpStateKey(simulator, state, { dpKeyMode: keyMode });
    const traceKey = config.preserveGoalArchive === true && Array.isArray(state.routeTrace)
      ? state.routeTrace.map((entry) =>
          (entry && (entry.fingerprint || entry.summary || entry.kind)) || "unknown"
        ).join("\n")
      : null;
    const key = traceKey == null ? stateKey : `${stateKey}\ntrace:${traceKey}`;
    const existing = byKey.get(key);
    if (!existing || compareCandidateStates(state, existing) < 0)
      byKey.set(key, state);
  });
  const goal = (segment || {}).goal || {};
  const actionSurvivableTarget =
    goal.actionSurvivable && goal.actionSurvivable.summary
      ? goal.actionSurvivable.summary
      : null;
  const records = Array.from(byKey.values()).map((state, index) => {
    const trace = Array.isArray(state.routeTrace)
      ? state.routeTrace
          .map((entry) => compactTraceEntry(simulator.project, entry))
          .filter(Boolean)
      : [];
    if (Object.prototype.hasOwnProperty.call(state, "routeTrace"))
      delete state.routeTrace;
    let targetMargin = null;
    if (actionSurvivableTarget) {
      try {
        const threshold = estimateBattleSurvivability(
          simulator,
          state,
          actionSurvivableTarget,
          { skipMinHp: true },
        );
        if (threshold && threshold.supported) {
          targetMargin = {
            survivable: threshold.survivable,
            margin:
              number(threshold.currentHp, 0) -
              number(threshold.currentDamage, Number.POSITIVE_INFINITY),
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
    [
      "highest-hp",
      (left, right) =>
        summarizeHero(right.state).hp - summarizeHero(left.state).hp,
    ],
    ["best-combat", (left, right) => right.score - left.score],
    [
      "highest-atk",
      (left, right) => right.effectiveHero.atk - left.effectiveHero.atk,
    ],
    [
      "highest-def",
      (left, right) => right.effectiveHero.def - left.effectiveHero.def,
    ],
    [
      "highest-mdef",
      (left, right) => right.effectiveHero.mdef - left.effectiveHero.mdef,
    ],
    ["highest-exp", (left, right) => right.hero.exp - left.hero.exp],
    ["shortest", (left, right) => left.route.length - right.route.length],
  ];
  if (actionSurvivableTarget) {
    rolePickers.push([
      "best-target-margin",
      (left, right) => {
        const leftMargin = left.targetMargin
          ? left.targetMargin.margin
          : -Infinity;
        const rightMargin = right.targetMargin
          ? right.targetMargin.margin
          : -Infinity;
        return rightMargin - leftMargin;
      },
    ]);
    rolePickers.push([
      "target-survivable",
      (left, right) => {
        const leftOk =
          left.targetMargin && left.targetMargin.survivable ? 1 : 0;
        const rightOk =
          right.targetMargin && right.targetMargin.survivable ? 1 : 0;
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
    if (!record || selectedIds.has(record.id) || selected.length >= limit)
      return;
    selectedIds.add(record.id);
    selected.push(record);
  };
  rolePickers.forEach(([tag, compare]) => {
    const winner = records.slice().sort(compare)[0];
    if (winner) addTag(winner, tag);
  });
  if (config.preserveSkylineRoles === true) {
    rolePickers.forEach(([, compare]) =>
      keepCandidate(records.slice().sort(compare)[0]),
    );
  }
  records.sort(compareGoalRecords).forEach(keepCandidate);
  return selected.slice(0, limit).sort(compareGoalRecords);
}

function normalizeCandidateRecord(candidate, index, fallbackSegmentId) {
  const state = candidate && candidate.state;
  return {
    id:
      candidate && candidate.id
        ? candidate.id
        : `${fallbackSegmentId || "segment"}#${index}`,
    state,
    route: Array.isArray(candidate && candidate.route)
      ? candidate.route.slice()
      : Array.isArray(state && state.route)
        ? state.route.slice()
        : [],
    trace: Array.isArray(candidate && candidate.trace)
      ? candidate.trace.slice()
      : [],
    hero: (candidate && candidate.hero) || summarizeHero(state),
    effectiveHero:
      (candidate && candidate.effectiveHero) || summarizeEffectiveHero(state),
    score: number(candidate && candidate.score, goalCandidateScore(state)),
    tags: Array.isArray(candidate && candidate.tags)
      ? candidate.tags.slice()
      : [],
  };
}

function selectCandidateSkyline(simulator, candidates, segment, options) {
  const limit = Math.max(
    1,
    number(
      (options || {}).candidateLimit || (segment.dp || {}).goalSkylineLimit,
      8,
    ),
  );
  const keyMode = (segment.dp || {}).keyMode || "region";
  const byKey = new Map();
  (candidates || [])
    .filter((candidate) => candidate && candidate.state)
    .forEach((candidate) => {
      const key = buildDpStateKey(simulator, candidate.state, {
        dpKeyMode: keyMode,
      });
      const existing = byKey.get(key);
      if (
        !existing ||
        compareCandidateStates(candidate.state, existing.state) < 0
      )
        byKey.set(key, candidate);
    });
  const goal = (segment || {}).goal || {};
  const actionSurvivableTarget =
    goal.actionSurvivable && goal.actionSurvivable.summary
      ? goal.actionSurvivable.summary
      : null;
  const records = Array.from(byKey.values()).map((candidate, index) => {
    const record = normalizeCandidateRecord(candidate, index, segment.id);
    if (actionSurvivableTarget) {
      try {
        const threshold = estimateBattleSurvivability(
          simulator,
          record.state,
          actionSurvivableTarget,
          { skipMinHp: true },
        );
        if (threshold && threshold.supported) {
          record.targetMargin = {
            survivable: threshold.survivable,
            margin:
              number(threshold.currentHp, 0) -
              number(threshold.currentDamage, Number.POSITIVE_INFINITY),
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
    [
      "highest-hp",
      (left, right) =>
        summarizeHero(right.state).hp - summarizeHero(left.state).hp,
    ],
    ["best-combat", (left, right) => right.score - left.score],
    [
      "highest-atk",
      (left, right) => right.effectiveHero.atk - left.effectiveHero.atk,
    ],
    [
      "highest-def",
      (left, right) => right.effectiveHero.def - left.effectiveHero.def,
    ],
    [
      "highest-mdef",
      (left, right) => right.effectiveHero.mdef - left.effectiveHero.mdef,
    ],
    ["highest-exp", (left, right) => right.hero.exp - left.hero.exp],
    ["shortest", (left, right) => left.route.length - right.route.length],
  ];
  if (actionSurvivableTarget) {
    rolePickers.push([
      "best-target-margin",
      (left, right) => {
        const leftMargin = left.targetMargin
          ? left.targetMargin.margin
          : -Infinity;
        const rightMargin = right.targetMargin
          ? right.targetMargin.margin
          : -Infinity;
        return rightMargin - leftMargin;
      },
    ]);
    rolePickers.push([
      "target-survivable",
      (left, right) => {
        const leftOk =
          left.targetMargin && left.targetMargin.survivable ? 1 : 0;
        const rightOk =
          right.targetMargin && right.targetMargin.survivable ? 1 : 0;
        return rightOk - leftOk;
      },
    ]);
  }
  const selected = [];
  const selectedIds = new Set();
  const keepCandidate = (record) => {
    if (!record || selectedIds.has(record.id) || selected.length >= limit)
      return;
    selectedIds.add(record.id);
    selected.push(record);
  };
  rolePickers.forEach(([tag, compare]) => {
    const winner = records.slice().sort(compare)[0];
    if (winner) addTag(winner, tag);
  });
  if ((options || {}).preserveSkylineRoles === true) {
    rolePickers.forEach(([, compare]) =>
      keepCandidate(records.slice().sort(compare)[0]),
    );
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
  return (missing || []).some((entry) =>
    predicate(String((entry || {}).field || ""), entry || {}),
  );
}

function classifySegmentFailure(missing, segment) {
  const missingFields = missing || [];
  const classes = [];
  const preferredCandidateTags = [];
  const recommendedNext = [];
  const addClass = (failureClass, reason, tags, recommendation) => {
    classes.push({ failureClass, reason, recommendation });
    (tags || []).forEach((tag) => {
      if (!preferredCandidateTags.includes(tag))
        preferredCandidateTags.push(tag);
    });
    if (recommendation && !recommendedNext.includes(recommendation))
      recommendedNext.push(recommendation);
  };

  if (hasMissingField(missingFields, (field) => field === "presentTiles")) {
    addClass(
      "present-tile-overconstrained",
      "hard presentTiles constraint was violated before this milestone goal",
      ["best-combat", "shortest"],
      "relax non-essential presentTiles into preferredPresentTiles or add an explicit reason if it is a required later resource",
    );
  }

  if (
    hasMissingField(
      missingFields,
      (field, entry) =>
        field === "actionSurvivable" && entry.actual === "missing-action",
    )
  ) {
    addClass(
      "target-action-unreachable",
      "required target action is absent from the current primitive action set",
      ["shortest", "best-combat"],
      "check allowedFloors, allowChangeFloors, presentTiles, and local action scope for this segment",
    );
  }

  if (
    hasMissingField(
      missingFields,
      (field) => field === "hero.atk" || field === "effectiveHero.atk",
    )
  ) {
    addClass(
      "atk-deficit",
      "attack threshold is not met",
      ["highest-atk", "best-combat"],
      "backtrack to the previous milestone and try highest-atk or best-combat candidates",
    );
  }

  if (
    hasMissingField(
      missingFields,
      (field) => field === "hero.def" || field === "effectiveHero.def",
    )
  ) {
    addClass(
      "def-deficit",
      "defense threshold is not met",
      ["highest-def", "best-combat"],
      "backtrack to the previous milestone and try highest-def or best-combat candidates",
    );
  }

  if (
    hasMissingField(
      missingFields,
      (field) => field === "hero.mdef" || field === "effectiveHero.mdef",
    )
  ) {
    addClass(
      "mdef-deficit",
      "magic-defense threshold is not met",
      ["highest-mdef", "best-combat"],
      "backtrack to the previous milestone and try highest-mdef or best-combat candidates",
    );
  }

  if (
    hasMissingField(
      missingFields,
      (field, entry) =>
        field === "actionSurvivable" &&
        (entry.riskTags || []).includes("life-limit"),
    )
  ) {
    addClass(
      "life-limit-hp-deficit",
      "life-limit battle threshold is not survivable at current HP",
      ["highest-hp", "highest-def", "best-combat"],
      "scan HP/def sustain resources before retrying the life-limit battle",
    );
  }

  if (hasMissingField(missingFields, (field) => field === "hero.hp")) {
    addClass(
      "hp-deficit",
      "HP threshold is not met",
      ["highest-hp"],
      "backtrack to the previous milestone and try highest-hp candidates",
    );
  }

  if (
    hasMissingField(
      missingFields,
      (field, entry) =>
        field === "actionSurvivable" && entry.actual !== "missing-action",
    )
  ) {
    addClass(
      "action-survivability-deficit",
      "required action exists but current HP cannot survive it",
      ["highest-hp", "best-combat", "highest-def", "highest-atk"],
      "backtrack to the previous milestone and try higher-HP or stronger-combat candidates",
    );
  }

  if (hasMissingField(missingFields, (field) => field === "equipment")) {
    addClass(
      "equipment-missing",
      "required equipment is not equipped",
      ["best-combat", "shortest"],
      "check whether equip actions or the required item pickup are allowed in this segment",
    );
  }

  if (
    hasMissingField(
      missingFields,
      (field) =>
        field === "tileRemoved" ||
        field === "removedTiles" ||
        field === "anyRemovedTiles",
    )
  ) {
    addClass(
      "target-tile-not-cleared",
      "required tile remains present at the best seen state",
      ["best-combat", "highest-atk"],
      "retry this segment with a candidate that has stronger combat or verify the target tile is reachable under the action policy",
    );
  }

  if (hasMissingField(missingFields, (field) => field === "floorId")) {
    addClass(
      "floor-scope-mismatch",
      "best seen state did not reach the target floor",
      ["shortest", "best-combat"],
      "check allowedFloors and allowChangeFloors for the segment",
    );
  }

  if (classes.length === 0) {
    addClass(
      "budget-or-action-scope-exhausted",
      "no goal state was found under the current segment budget and action policy",
      ["best-combat", "highest-hp"],
      "increase segment budget, widen action scope, or rerun the previous milestone with location key",
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
  const primary = classes
    .slice()
    .sort(
      (left, right) =>
        number(failurePriority[right.failureClass], 0) -
        number(failurePriority[left.failureClass], 0),
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
  const best =
    (result && (result.bestProgressState || result.bestSeenState)) || null;
  const missing = best
    ? missingGoalFields(project, simulator, best, segment)
    : [{ field: "state", expected: "reachable", actual: "none" }];
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
      actionTrimmed:
        result &&
        result.diagnostics &&
        result.diagnostics.dp &&
        result.diagnostics.dp.actionTrimmed,
      frontierRemaining: result && result.frontierSize,
      rejectedByHigherHp:
        result &&
        result.diagnostics &&
        result.diagnostics.dp &&
        result.diagnostics.dp.rejectedByHigherHp,
      replacedLowerHp:
        result &&
        result.diagnostics &&
        result.diagnostics.dp &&
        result.diagnostics.dp.replacedLowerHp,
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
  const prefixRoute = Array.isArray(config.prefixRoute)
    ? config.prefixRoute
    : Array.isArray(startState.route)
      ? startState.route
      : [];
  const captureTrace = config.captureTrace === true;
  const prefixTrace = captureTrace
    ? Array.isArray(config.prefixTrace)
      ? config.prefixTrace
      : Array.isArray(startState.routeTrace)
        ? startState.routeTrace
        : []
    : [];
  const seed = cloneStateWithoutRouteTrace(startState);
  seed.route = prefixRoute.slice();
  const resourceTimingOptions = buildResourceTimingOptions(
    dpConfig,
    segment,
    config,
  );
  const resourceTimingRequested =
    dpConfig.resourceTimingModel != null ||
    config.resourceTimingModel != null ||
    dpConfig.resourceTimingPolicy != null ||
    config.resourceTimingEnabled === true;
  const resourceTimingEnabled = resourceTimingRequested && resourceTimingOptions.model !== "off";
  const resourceTimingCache = new Map();
  const goal = (segment || {}).goal || {};
  const actionSurvivableTarget =
    goal.actionSurvivable && goal.actionSurvivable.summary;
  let dominanceConfig = null;
  if (actionSurvivableTarget) {
    dominanceConfig = {
      targetSummary: actionSurvivableTarget,
      mode: "action-survivable",
      compare: (left, right) => {
        const leftHp = heroHp(left);
        const rightHp = heroHp(right);
        let leftMargin = null;
        let rightMargin = null;
        try {
          const leftThreshold = estimateBattleSurvivability(
            simulator,
            left,
            actionSurvivableTarget,
            { skipMinHp: true },
          );
          if (leftThreshold && leftThreshold.supported) {
            leftMargin =
              leftHp -
              number(leftThreshold.currentDamage, Number.POSITIVE_INFINITY);
          }
        } catch (error) {
          /* ignore */
        }
        try {
          const rightThreshold = estimateBattleSurvivability(
            simulator,
            right,
            actionSurvivableTarget,
            { skipMinHp: true },
          );
          if (rightThreshold && rightThreshold.supported) {
            rightMargin =
              rightHp -
              number(rightThreshold.currentDamage, Number.POSITIVE_INFINITY);
          }
        } catch (error) {
          /* ignore */
        }
        if (
          leftMargin != null &&
          rightMargin != null &&
          leftMargin !== rightMargin
        ) {
          return leftMargin > rightMargin;
        }
        if (leftHp !== rightHp) return leftHp > rightHp;
        const leftDepth = getDecisionDepth(left);
        const rightDepth = getDecisionDepth(right);
        if (leftDepth !== rightDepth) return leftDepth < rightDepth;
        const leftRoute = Array.isArray(left.route)
          ? left.route.length
          : leftDepth;
        const rightRoute = Array.isArray(right.route)
          ? right.route.length
          : rightDepth;
        return leftRoute < rightRoute;
      },
      describeComparison: (left, right) => {
        const margin = (state) => {
          try {
            const threshold = estimateBattleSurvivability(
              simulator,
              state,
              actionSurvivableTarget,
              { skipMinHp: true },
            );
            return threshold && threshold.supported
              ? number(state && state.hero && state.hero.hp, 0) - number(threshold.currentDamage, Number.POSITIVE_INFINITY)
              : null;
          } catch (error) {
            return null;
          }
        };
        const candidateMargin = margin(left);
        const witnessMargin = margin(right);
        return {
          mode: "action-survivable",
          targetMarginDiff: candidateMargin != null && witnessMargin != null
            ? candidateMargin - witnessMargin
            : null,
          targetMarginCandidate: candidateMargin,
          targetMarginWitness: witnessMargin,
        };
      },
    };
  }
  const originalDominanceCompare = dominanceConfig && typeof dominanceConfig.compare === "function"
    ? dominanceConfig.compare
    : null;
  const baseDominanceCompare = originalDominanceCompare
    ? (left, right) => (originalDominanceCompare(left, right) ? 1 : -1)
    : compareDpBest;
  const baseDominanceDescribe = dominanceConfig && typeof dominanceConfig.describeComparison === "function"
    ? dominanceConfig.describeComparison
    : null;
  const resourceTimingDominance = resourceTimingEnabled
    ? {
        mode: "resource-timing",
        compare: (left, right) => compareResourceTimingStates(
          left,
          right,
          baseDominanceCompare,
          resourceTimingOptions,
        ),
        hasConflict: (left, right) => hasTimingConflict(left, right, resourceTimingOptions),
        describeComparison: (left, right) => ({
          mode: "resource-timing",
          timingConflict: hasTimingConflict(left, right, resourceTimingOptions),
          timingRoles: {
            candidate: resourceTimingRoles(left),
            witness: resourceTimingRoles(right),
          },
          base: baseDominanceDescribe
            ? baseDominanceDescribe(left, right)
            : null,
        }),
      }
    : null;
  if (resourceTimingDominance) {
    dominanceConfig = {
      ...(dominanceConfig || {}),
      ...resourceTimingDominance,
    };
  }
  const actionProviderMode = String(
    dpConfig.actionProviderMode ||
      (segment.actionPolicy && segment.actionPolicy.actionProviderMode) ||
      "",
  );
  let actionProvider;
  let actionApplier = null;
  let oracleDiagnostics = null;
  if (actionProviderMode === "monster-only") {
    // Cache oracle results per floor within a single DP expansion (state is fixed)
    let oracleCache = null;
    let oracleCacheState = null;
    const oracleStats = {
      targetsGenerated: 0,
      targetsAfterCap: 0,
      reachableTargetsGenerated: 0,
      reachableTargetsAfterCap: 0,
      targetCapDrops: 0,
      statesWithTargetCap: 0,
      maxTargetsGeneratedForState: 0,
      maxTargetsAfterCapForState: 0,
      floorSearches: 0,
      floorCacheHits: 0,
      oracleCacheHitRate: 0,
      oracleFloorSearchMs: 0,
      floorEntriesReturned: 0,
      maxFloorEntriesReturned: 0,
      oracleBattleReachabilityMs: 0,
      reachabilityNodes: 0,
      maxReachabilityNodes: 0,
      battleCandidates: 0,
      successorCandidatesBeforeCap: 0,
      successorCandidatesAfterCap: 0,
      successorCapDrops: 0,
      successorSelectedByRole: {},
      successorsReturned: 0,
      routePatchTotalLength: 0,
      routePatchAvgLength: 0,
      routePatchMaxLength: 0,
      rejectedByReason: {},
    };
    oracleDiagnostics = oracleStats;
    actionProvider = reachAndBattleOracle.buildMonsterOnlyActionProvider(
      simulator,
      segment,
      dpConfig,
      oracleStats,
    );
    actionApplier = (state, target) => {
      // Reset cache if state changed (new DP expansion)
      if (state !== oracleCacheState) {
        oracleCache = new Map();
        oracleCacheState = state;
      }
      const cached = oracleCache.has(target.floorId);
      const result = reachAndBattleOracle.tryReachAndBattle(
        simulator,
        state,
        target,
        segment,
        dpConfig,
        oracleCache,
        oracleStats,
      );
      if (cached) oracleStats.floorCacheHits += 1;
      else oracleStats.floorSearches += 1;
      const floorLookups =
        oracleStats.floorSearches + oracleStats.floorCacheHits;
      oracleStats.oracleCacheHitRate =
        floorLookups > 0 ? oracleStats.floorCacheHits / floorLookups : 0;
      if (!result.ok) {
        oracleStats.rejectedByReason[result.reason] =
          (oracleStats.rejectedByReason[result.reason] || 0) + 1;
        throw new Error(`monster-only applier failed: ${result.reason}`);
      }
      oracleStats.battleCandidates += result.results.length;
      // Attach compressed routePatch (summary strings only) to each postState
      const postStates = result.results.map((r) => {
        r.postState._routePatch = r.routePatch
          .map((entry) =>
            typeof entry === "string" ? entry : entry && entry.summary,
          )
          .filter(Boolean);
        oracleStats.routePatchTotalLength += r.postState._routePatch.length;
        oracleStats.routePatchMaxLength = Math.max(
          oracleStats.routePatchMaxLength,
          r.postState._routePatch.length,
        );
        return r.postState;
      });
      oracleStats.successorsReturned += postStates.length;
      oracleStats.routePatchAvgLength =
        oracleStats.successorsReturned > 0
          ? oracleStats.routePatchTotalLength / oracleStats.successorsReturned
          : 0;
      return postStates;
    };
  } else {
    actionProvider = buildSegmentActionProvider(simulator, segment);
  }
  const result = searchDP(simulator, seed, {
    targetFloorId: segment.goal && segment.goal.floorId,
    maxExpansions,
    maxActionsPerState,
    maxRuntimeMs,
    maxHeapMb: number(dpConfig.maxHeapMb, 0),
    dpKeyMode: dpConfig.keyMode || dpConfig.dpKeyMode || "region",
    dpAgendaMode: dpConfig.agendaMode || "best-first",
    fairnessEvery: number(dpConfig.fairnessEvery, 32),
    dpPriorityMode:
      usesResourceTimingMode(segment) &&
      (!dpConfig.priorityMode || dpConfig.priorityMode === "default") &&
      !dpConfig.dpPriorityMode
        ? "resource-first"
        : dpConfig.priorityMode || dpConfig.dpPriorityMode || "default",
    actionProviderMode: actionProviderMode || "segment-provider",
    observerCaptureMode: dpConfig.observerCaptureMode || config.observerCaptureMode || "off",
    observerCaptureDominanceWitnesses: dpConfig.observerCaptureDominanceWitnesses === true || config.observerCaptureDominanceWitnesses === true,
    observerCaptureWitnessStates: dpConfig.observerCaptureWitnessStates === true || config.observerCaptureWitnessStates === true,
    stopOnFirstGoal: dpConfig.stopOnFirstGoal === true,
    continueAfterGoal: dpConfig.continueAfterGoal === true,
    captureTrace,
    initialRouteTracePrefix: prefixTrace,
    goalSkylineLimit: number(dpConfig.goalSkylineLimit, 8),
    landmarkArchiveLimit: number(dpConfig.landmarkArchiveLimit, 0),
    dpSkylineMax: resourceTimingEnabled
      ? Math.max(
        number(dpConfig.dpSkylineMax, resourceTimingOptions.skylineMax),
        resourceTimingOptions.skylineMax,
      )
      : number(dpConfig.dpSkylineMax, 1),
    preserveGoalArchive: dpConfig.preserveGoalArchive === true,
    preserveSkylineAlternatives: dpConfig.preserveSkylineAlternatives === true,
    dominanceConfig,
    skylineCompare: resourceTimingEnabled
      ? (left, right) => compareResourceTimingStates(
        left,
        right,
        baseDominanceCompare,
        resourceTimingOptions,
      )
      : null,
    skylineRoles: resourceTimingEnabled ? resourceTimingRoles : null,
    stateAnnotator: resourceTimingEnabled
      ? (nextState) => annotateStateResourceTiming(
        simulator,
        nextState,
        segment,
        resourceTimingOptions,
        { cache: resourceTimingCache },
      )
      : null,
    actionProvider,
    actionApplier,
    observer: config.observer,
    observerIncludeExactStateKey: config.observerIncludeExactStateKey === true,
    goalPredicate: buildSegmentGoalPredicate(
      simulator.project,
      segment,
      simulator,
    ),
  });
  const baseDpDiagnostics = (result.diagnostics && result.diagnostics.dp) || {};
  const expansionBudgetExhausted =
    Number(result.expansions || 0) >= maxExpansions &&
    Number(result.frontierSize || 0) > 0 &&
    !baseDpDiagnostics.stoppedReason;
  const goalStates =
    Array.isArray(result.goalSkylineStates) &&
    result.goalSkylineStates.length > 0
      ? result.goalSkylineStates
      : [result.bestGoalState || result.goalState || result.firstGoalState].filter(Boolean);
  const goalSkyline = selectGoalSkyline(simulator, goalStates, segment, {
    candidateLimit: config.candidateLimit || dpConfig.goalSkylineLimit,
    preserveSkylineRoles:
      config.preserveSkylineRoles === true ||
      dpConfig.preserveSkylineRoles === true,
    preserveGoalArchive: dpConfig.preserveGoalArchive === true,
  });
  return {
    segmentId: segment.id,
    found: goalSkyline.length > 0,
    startCandidateId: config.candidateId || null,
    goalSkyline,
    bestSeen: result.bestSeenState,
    bestProgress: result.bestProgressState,
    landmarkArchive: result.landmarkArchive || [],
    diagnostics: {
      dp: {
        ...baseDpDiagnostics,
        expansions: result.expansions,
        frontierSize: result.frontierSize,
        maxExpansions,
        maxRuntimeMs,
        maxActionsPerState,
        expansionBudgetExhausted,
        oracle: oracleDiagnostics || null,
        resourceTiming: resourceTimingEnabled
          ? {
              model: resourceTimingOptions.model,
              targetLimit: resourceTimingOptions.targetLimit,
              resourceLimit: resourceTimingOptions.resourceLimit,
              thresholdLimit: resourceTimingOptions.thresholdLimit,
              skylineMax: resourceTimingOptions.skylineMax,
              analyzedStates: resourceTimingCache.size,
            }
          : { model: "off" },
      },
      actionTrimmed:
        result.diagnostics &&
        result.diagnostics.dp &&
        result.diagnostics.dp.actionTrimmed,
      rejectedByHigherHp:
        result.diagnostics &&
        result.diagnostics.dp &&
        result.diagnostics.dp.rejectedByHigherHp,
      replacedLowerHp:
        result.diagnostics &&
        result.diagnostics.dp &&
        result.diagnostics.dp.replacedLowerHp,
      actionsGeneratedByKind:
        result.diagnostics &&
        result.diagnostics.dp &&
        result.diagnostics.dp.actionsGeneratedByKind,
      actionsExpandedByKind:
        result.diagnostics &&
        result.diagnostics.dp &&
        result.diagnostics.dp.actionsExpandedByKind,
      actionsKeptByKind:
        result.diagnostics &&
        result.diagnostics.dp &&
        result.diagnostics.dp.actionsKeptByKind,
      actionsDominatedByKind:
        result.diagnostics &&
        result.diagnostics.dp &&
        result.diagnostics.dp.actionsDominatedByKind,
      uniqueBattleTargets:
        result.diagnostics &&
        result.diagnostics.dp &&
        result.diagnostics.dp.uniqueBattleTargets,
      uniquePortalEntries:
        result.diagnostics &&
        result.diagnostics.dp &&
        result.diagnostics.dp.uniquePortalEntries,
      failure:
        goalSkyline.length > 0
          ? null
          : summarizeSegmentFailure(
              simulator.project,
              segment,
              result,
              simulator,
            ),
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
  const fromIndex = fromMilestoneId
    ? milestones.findIndex((milestone) => milestone.id === fromMilestoneId)
    : -1;
  const toIndex = toMilestoneId
    ? milestones.findIndex((milestone) => milestone.id === toMilestoneId)
    : -1;
  if (fromMilestoneId && fromIndex < 0) return [];
  if (toMilestoneId && toIndex < 0) return [];
  const startIndex = fromMilestoneId ? fromIndex + 1 : 0;
  const endIndex = toMilestoneId ? toIndex : milestones.length - 1;
  if (startIndex < 0 || endIndex < 0 || startIndex > endIndex) return [];
  return milestones.slice(startIndex, endIndex + 1);
}

function milestoneRangeError(milestoneSpec, fromMilestoneId, toMilestoneId) {
  const milestones = milestoneSpec.milestones || [];
  const fromIndex = fromMilestoneId
    ? milestones.findIndex((milestone) => milestone.id === fromMilestoneId)
    : -1;
  const toIndex = toMilestoneId
    ? milestones.findIndex((milestone) => milestone.id === toMilestoneId)
    : -1;
  if (fromMilestoneId && fromIndex < 0)
    return `Unknown fromMilestoneId: ${fromMilestoneId}`;
  if (toMilestoneId && toIndex < 0)
    return `Unknown toMilestoneId: ${toMilestoneId}`;
  const startIndex = fromMilestoneId ? fromIndex + 1 : 0;
  const endIndex = toMilestoneId ? toIndex : milestones.length - 1;
  if (startIndex > endIndex)
    return `Invalid milestone range: ${fromMilestoneId || "start"} is not before ${toMilestoneId || "end"}`;
  return null;
}

function mergeMilestoneFrontier(simulator, candidates, segment, options) {
  const selected = selectCandidateSkyline(
    simulator,
    candidates || [],
    segment,
    options,
  );
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
    .map(
      (attempt) =>
        attempt && attempt.diagnostics && attempt.diagnostics.failure,
    )
    .filter(Boolean);
  if (failures.length === 0) return null;
  const classCounts = {};
  const preferredCandidateTags = [];
  const recommendedNext = [];
  failures.forEach((failure) => {
    const failureClass = failure.failureClass || "unknown";
    classCounts[failureClass] = Number(classCounts[failureClass] || 0) + 1;
    (failure.preferredCandidateTags || []).forEach((tag) => {
      if (!preferredCandidateTags.includes(tag))
        preferredCandidateTags.push(tag);
    });
    (failure.recommendedNext || []).forEach((recommendation) => {
      if (!recommendedNext.includes(recommendation))
        recommendedNext.push(recommendation);
    });
  });
  const primaryFailureClass = Object.entries(classCounts).sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  )[0][0];
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
  if (!state || !Object.prototype.hasOwnProperty.call(state, "routeTrace"))
    return cloneState(state);
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
    numericOption(
      config && config.candidateLimit,
      numericOption(segment && segment.dp && segment.dp.goalSkylineLimit, 8),
    ),
  );
}

function segmentDpOverrides(segment, config, overrides) {
  const dpConfig = (segment || {}).dp || {};
  const repair = (overrides && overrides.dpOverrides) || {};
  const generatedSegment = Boolean(segment && segment.generated);
  return {
    ...(config && config.dpKeyMode && !generatedSegment
      ? { keyMode: config.dpKeyMode }
      : {}),
    ...(config && config.maxExpansions && !generatedSegment
      ? { maxExpansions: config.maxExpansions }
      : {}),
    ...(config && config.maxRuntimeMs && !generatedSegment
      ? { maxRuntimeMs: config.maxRuntimeMs }
      : {}),
    ...(config && config.stopOnFirstGoal != null
      ? { stopOnFirstGoal: config.stopOnFirstGoal }
      : {}),
    ...(config && config.goalSkylineLimit != null && !generatedSegment
      ? { goalSkylineLimit: config.goalSkylineLimit }
      : {}),
    ...(config && config.dpSkylineMax != null && !generatedSegment
      ? { dpSkylineMax: config.dpSkylineMax }
      : {}),
    ...(config && config.fairnessEvery != null && !generatedSegment
      ? { fairnessEvery: config.fairnessEvery }
      : {}),
    ...(config && config.agendaMode != null && !generatedSegment
      ? { agendaMode: config.agendaMode }
      : {}),
    ...(config && config.maxActionsPerState != null && !generatedSegment
      ? { maxActionsPerState: config.maxActionsPerState }
      : {}),
    ...(config && config.resourceTimingModel != null
      ? { resourceTimingModel: config.resourceTimingModel }
      : {}),
    ...(config && config.resourceTimingTargetLimit != null
      ? { resourceTimingTargetLimit: config.resourceTimingTargetLimit }
      : {}),
    ...(config && config.resourceTimingResourceLimit != null
      ? { resourceTimingResourceLimit: config.resourceTimingResourceLimit }
      : {}),
    ...(config && config.resourceTimingThresholdLimit != null
      ? { resourceTimingThresholdLimit: config.resourceTimingThresholdLimit }
      : {}),
    ...(config && config.resourceTimingSkylineMax != null
      ? { resourceTimingSkylineMax: config.resourceTimingSkylineMax }
      : {}),
    ...(config && config.resourceTimingCalculateThresholds != null
      ? { resourceTimingCalculateThresholds: config.resourceTimingCalculateThresholds }
      : {}),
    ...(repair.stopOnFirstGoal != null
      ? { stopOnFirstGoal: repair.stopOnFirstGoal }
      : {}),
    ...(repair.maxExpansions != null
      ? { maxExpansions: repair.maxExpansions }
      : {}),
    ...(repair.maxRuntimeMs != null
      ? { maxRuntimeMs: repair.maxRuntimeMs }
      : {}),
    ...(repair.keyMode != null ? { keyMode: repair.keyMode } : {}),
    ...(repair.dpKeyMode != null ? { dpKeyMode: repair.dpKeyMode } : {}),
    ...(repair.priorityMode != null
      ? { priorityMode: repair.priorityMode }
      : {}),
    ...(repair.dpPriorityMode != null
      ? { dpPriorityMode: repair.dpPriorityMode }
      : {}),
    ...(repair.goalSkylineLimit != null
      ? { goalSkylineLimit: repair.goalSkylineLimit }
      : {}),
    ...(repair.dpSkylineMax != null
      ? { dpSkylineMax: repair.dpSkylineMax }
      : {}),
    ...(repair.maxActionsPerState != null
      ? { maxActionsPerState: repair.maxActionsPerState }
      : {}),
    ...(repair.agendaMode != null ? { agendaMode: repair.agendaMode } : {}),
    ...(repair.dpAgendaMode != null
      ? { dpAgendaMode: repair.dpAgendaMode }
      : {}),
    ...(repair.fairnessEvery != null
      ? { fairnessEvery: repair.fairnessEvery }
      : {}),
    ...(repair.maxRuntimeMs == null && overrides && overrides.expandRuntime
      ? {
          maxRuntimeMs: Math.max(
            numericOption(dpConfig.maxRuntimeMs, 0),
            numericOption(dpConfig.maxRuntimeMs, 0) * 2,
          ),
        }
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
    resourceTiming: getTiming(candidate.state)
      ? {
          retainedOptionValue: getTiming(candidate.state).retainedOptionValue,
          projectedDamageSaving: getTiming(candidate.state).projectedDamageSaving,
          newlySurvivableTargets: getTiming(candidate.state).newlySurvivableTargets,
          roles: getTiming(candidate.state).roles,
        }
      : null,
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

function allocateGlobalAttemptBudget(options) {
  const config = options || {};
  const remainingCandidates = Math.max(1, number(config.remainingCandidates, 1));
  const allocation = {};
  if (config.remainingExpansions != null) {
    allocation.maxExpansions = Math.max(
      1,
      Math.min(
        number(config.segmentMaxExpansions, config.remainingExpansions),
        Math.floor(number(config.remainingExpansions, 0) / remainingCandidates) || 1,
      ),
    );
  }
  if (config.remainingRuntimeMs != null) {
    allocation.maxRuntimeMs = Math.max(
      1,
      Math.min(
        number(config.segmentMaxRuntimeMs, config.remainingRuntimeMs),
        Math.floor(number(config.remainingRuntimeMs, 0) / remainingCandidates) || 1,
      ),
    );
  }
  return allocation;
}

function runSegmentAgainstFrontier(
  simulator,
  segment,
  frontier,
  config,
  overrides,
) {
  const candidateLimit = segmentCandidateLimit(
    segment,
    config || {},
    overrides || {},
  );
  const startLimit = numericOption(
    overrides && overrides.startCandidateLimit,
    numericOption(
      config && config.startCandidateLimit,
      (frontier || []).length || 1,
    ),
  );
  const inputFrontier = (frontier || []).slice(0, startLimit);
  const globalBudget = config && config.globalBudget;
  const nextCandidates = [];
  const attempts = [];
  for (const [candidateIndex, candidate] of inputFrontier.entries()) {
    const configuredRemainingRuntimeMs = config && config.deadlineMs
      ? Math.max(0, number(config.deadlineMs, 0) - Date.now())
      : null;
    const globalRemainingRuntimeMs = globalBudget && globalBudget.requestedRuntimeMs > 0
      ? Math.max(0, globalBudget.deadlineMs - Date.now())
      : null;
    const remainingRuntimeMs = configuredRemainingRuntimeMs == null
      ? globalRemainingRuntimeMs
      : globalRemainingRuntimeMs == null
        ? configuredRemainingRuntimeMs
        : Math.min(configuredRemainingRuntimeMs, globalRemainingRuntimeMs);
    const globalRemainingExpansions = globalBudget && globalBudget.requestedExpansions > 0
      ? Math.max(0, globalBudget.requestedExpansions - globalBudget.consumedExpansions)
      : null;
    if (globalBudget && (
      (globalRemainingExpansions != null && globalRemainingExpansions <= 0) ||
      (globalRemainingRuntimeMs != null && globalRemainingRuntimeMs <= 0)
    )) {
      globalBudget.stoppedReason = globalRemainingRuntimeMs != null && globalRemainingRuntimeMs <= 0
        ? "time-limit"
        : "expansion-limit";
      break;
    }
    if (remainingRuntimeMs != null && remainingRuntimeMs <= 0) break;
    const heapUsedMb = process.memoryUsage().heapUsed / 1024 / 1024;
    if (
      config &&
      config.maxHeapMb &&
      heapUsedMb >= number(config.maxHeapMb, Number.POSITIVE_INFINITY)
    ) break;
    const dpOverrides = segmentDpOverrides(segment, config || {}, overrides || {});
    const remainingCandidates = Math.max(1, inputFrontier.length - candidateIndex);
    const globalAllocation = allocateGlobalAttemptBudget({
      remainingExpansions: globalRemainingExpansions,
      remainingRuntimeMs,
      remainingCandidates,
      segmentMaxExpansions: dpOverrides.maxExpansions,
      segmentMaxRuntimeMs: dpOverrides.maxRuntimeMs,
    });
    if (globalAllocation.maxExpansions != null)
      dpOverrides.maxExpansions = globalAllocation.maxExpansions;
    if (remainingRuntimeMs != null) {
      const fairCandidateRuntimeMs = globalAllocation.maxRuntimeMs || Math.max(
        1,
        Math.floor(remainingRuntimeMs / remainingCandidates),
      );
      dpOverrides.maxRuntimeMs = Math.max(1, Math.min(
        number(dpOverrides.maxRuntimeMs, fairCandidateRuntimeMs),
        fairCandidateRuntimeMs,
      ));
    }
    if (config && config.maxHeapMb) {
      dpOverrides.maxHeapMb = number(config.maxHeapMb, 1024);
    }
    const result = searchSegmentDP(simulator, candidate.state, segment, {
      candidateId: candidate.id,
      prefixRoute: candidate.route,
      prefixTrace:
        config && config.captureTrace === true ? candidate.trace : [],
      candidateLimit,
      preserveSkylineRoles: Boolean(
        (config || {}).preserveSkylineRoles ||
        (config || {}).qualityFloor ||
        (overrides || {}).preserveSkylineRoles,
      ),
      captureTrace: config && config.captureTrace === true,
      dpOverrides,
    });
    attempts.push(result);
    if (globalBudget) {
      const dp = result && result.diagnostics && result.diagnostics.dp;
      globalBudget.consumedExpansions += number(dp && dp.expansions, 0);
      globalBudget.consumedWallMs = Math.max(
        globalBudget.consumedWallMs,
        Date.now() - globalBudget.startedAt,
      );
    }
    result.goalSkyline.forEach((goal) =>
      nextCandidates.push({
        ...goal,
        id: `${segment.id}:${candidate.id}:${goal.id}`,
      }),
    );
    if (typeof global.gc === "function") global.gc();
  }
  const merged = mergeMilestoneFrontier(simulator, nextCandidates, segment, {
    candidateLimit,
    preserveSkylineRoles: Boolean(
      (config || {}).preserveSkylineRoles ||
      (config || {}).qualityFloor ||
      (overrides || {}).preserveSkylineRoles,
    ),
  });
  const failurePropagation = mergeFailurePropagation(attempts);
  const summary = {
    segmentId: segment.id,
    label: segment.label,
    found: merged.length > 0,
    startCandidatesTried: attempts.length,
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
  return (preferredTags || []).reduce(
    (score, tag, index) =>
      score + (tags.has(tag) ? Math.max(1, preferredTags.length - index) : 0),
    0,
  );
}

function rankCandidatesByPreferredTags(candidates, preferredTags) {
  return (candidates || []).slice().sort((left, right) => {
    const tagDiff =
      preferredTagScore(right, preferredTags) -
      preferredTagScore(left, preferredTags);
    if (tagDiff !== 0) return tagDiff;
    const stateDiff = compareCandidateStates(
      left && left.state,
      right && right.state,
    );
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
  if (
    qualityFloor.mustReachSameFloor !== false &&
    floorId &&
    state.floorId !== floorId
  ) {
    missing.push({
      field: "floorId",
      expected: floorId,
      actual: state.floorId,
    });
  }
  qualityFloorFields(qualityFloor).forEach((field) => {
    const expected = Number(expectedHero[field] || 0);
    if (expected > 0 && Number(hero[field] || 0) < expected) {
      missing.push({
        field: `hero.${field}`,
        expected,
        actual: Number(hero[field] || 0),
      });
    }
  });
  if (qualityFloor.sameLevelMustNotLoseExp !== false) {
    const expectedLv = Number(expectedHero.lv || 0);
    const expectedExp = Number(expectedHero.exp || 0);
    if (
      expectedLv > 0 &&
      expectedExp > 0 &&
      Number(hero.lv || 0) === expectedLv &&
      Number(hero.exp || 0) < expectedExp
    ) {
      missing.push({
        field: "hero.exp",
        expected: expectedExp,
        actual: Number(hero.exp || 0),
        reason: "same-level exp should not regress below quality floor",
      });
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
    const stateDiff = compareCandidateStates(
      left && left.state,
      right && right.state,
    );
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
    : [
        {
          field: "candidate",
          expected: "route meeting quality floor",
          actual: "none",
        },
      ];
  return {
    segmentId: segment && segment.id,
    label: segment && segment.label,
    found: false,
    failureClass: "route-quality-floor-not-met",
    failureReason: `best route does not meet quality floor${qualityFloor && qualityFloor.label ? `: ${qualityFloor.label}` : ""}`,
    bestSeen: best && compactState(best.state),
    missingGoalFields: missing,
    preferredCandidateTags: ["highest-hp", "highest-def", "best-combat"],
    recommendedRepair:
      "expand previous skyline and prefer higher-HP sustain/resource timing candidates before accepting this milestone",
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
  const base = numericOption(
    config && config.candidateLimit,
    numericOption(segment && segment.dp && segment.dp.goalSkylineLimit, 4),
  );
  return Math.max(
    base + 1,
    numericOption(config && config.backtrackCandidateLimit, base * 2),
    8,
  );
}

function backtrackDpOverrides(segment, config) {
  const dpConfig = (segment || {}).dp || {};
  return {
    stopOnFirstGoal: false,
    goalSkylineLimit: backtrackCandidateLimit(segment, config || {}),
    maxExpansions: numericOption(
      config && config.backtrackMaxExpansions,
      Math.max(
        numericOption(dpConfig.maxExpansions, 1000),
        numericOption(dpConfig.maxExpansions, 1000) * 2,
      ),
    ),
    maxRuntimeMs: numericOption(
      config && config.backtrackMaxRuntimeMs,
      Math.max(
        numericOption(dpConfig.maxRuntimeMs, 5000),
        numericOption(dpConfig.maxRuntimeMs, 5000) * 2,
      ),
    ),
  };
}

function tryRepairFromPreviousMilestone(
  simulator,
  segments,
  segmentIndex,
  history,
  failedExecution,
  config,
) {
  if ((config || {}).enableFailureBacktracking === false) return null;
  if (!Array.isArray(history) || history.length === 0 || segmentIndex <= 0)
    return null;
  const previous = history[history.length - 1];
  if (!previous || previous.repairExpanded) return null;
  const failedSummary = failedExecution && failedExecution.summary;
  const preferredTags =
    ((failedSummary || {}).failurePropagation || {}).preferredCandidateTags ||
    [];
  if (preferredTags.length === 0) return null;

  const previousSegment = previous.segment;
  const currentSegment = segments[segmentIndex];
  const expandedPrevious = runSegmentAgainstFrontier(
    simulator,
    previousSegment,
    previous.inputFrontier,
    config || {},
    {
      candidateLimit: backtrackCandidateLimit(previousSegment, config || {}),
      dpOverrides: backtrackDpOverrides(previousSegment, config || {}),
      preserveSkylineRoles: true,
    },
  );
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

  const rankedFrontier = rankCandidatesByPreferredTags(
    expandedPrevious.merged,
    preferredTags,
  ).slice(0, backtrackCandidateLimit(currentSegment, config || {}));
  const repairedCurrent = runSegmentAgainstFrontier(
    simulator,
    currentSegment,
    rankedFrontier,
    config || {},
    {
      preserveSkylineRoles: true,
    },
  );
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

function configuredRepairStartFrom(segment) {
  const dp = (segment || {}).dp || {};
  return (segment && segment.repairStartFrom) || dp.repairStartFrom || null;
}

function tryRepairFromConfiguredMilestone(
  simulator,
  segments,
  segmentIndex,
  history,
  failedExecution,
  config,
) {
  if ((config || {}).enableFailureBacktracking === false) return null;
  if (!Array.isArray(history) || history.length === 0) return null;
  const currentSegment = segments[segmentIndex];
  const repairStartFrom = configuredRepairStartFrom(currentSegment);
  if (!repairStartFrom) return null;
  const start = history.find(
    (entry) => entry && entry.segment && entry.segment.id === repairStartFrom,
  );
  if (!start || !Array.isArray(start.merged) || start.merged.length === 0)
    return null;

  const dpConfig = (currentSegment || {}).dp || {};
  const repairedCurrent = runSegmentAgainstFrontier(
    simulator,
    currentSegment,
    start.merged,
    config || {},
    {
      candidateLimit: numericOption(
        dpConfig.repairCandidateLimit,
        numericOption(dpConfig.goalSkylineLimit, 8),
      ),
      startCandidateLimit: numericOption(
        dpConfig.repairStartCandidateLimit,
        start.merged.length,
      ),
      preserveSkylineRoles: true,
      dpOverrides: {
        stopOnFirstGoal: false,
        keyMode: dpConfig.keyMode,
        dpKeyMode: dpConfig.dpKeyMode,
        priorityMode: dpConfig.priorityMode,
        dpPriorityMode: dpConfig.dpPriorityMode,
        maxExpansions: numericOption(
          dpConfig.repairMaxExpansions,
          numericOption(dpConfig.maxExpansions, 0),
        ),
        maxRuntimeMs: numericOption(
          dpConfig.repairMaxRuntimeMs,
          numericOption(dpConfig.maxRuntimeMs, 0),
        ),
        goalSkylineLimit: numericOption(
          dpConfig.repairGoalSkylineLimit,
          numericOption(dpConfig.goalSkylineLimit, 8),
        ),
        maxActionsPerState: dpConfig.maxActionsPerState,
        agendaMode: dpConfig.agendaMode,
        dpAgendaMode: dpConfig.dpAgendaMode,
        fairnessEvery: dpConfig.fairnessEvery,
      },
    },
  );
  repairedCurrent.summary.backtrack = {
    mode: "configured-milestone-window",
    repairedFromMilestone: repairStartFrom,
    triggeredBySegment: currentSegment.id,
    failedSegment:
      failedExecution &&
      failedExecution.summary &&
      failedExecution.summary.segmentId,
    startCandidateCount: start.merged.length,
    repairedCandidateCount: repairedCurrent.merged.length,
  };
  return {
    found: repairedCurrent.merged.length > 0,
    repairedCurrent,
  };
}

function createGlobalBudget(config) {
  if (!config || config.budgetScope !== "global-run") return null;
  const startedAt = Date.now();
  const requestedRuntimeMs = Math.max(0, number(config.maxRuntimeMs, 0));
  return {
    scope: "global-run",
    startedAt,
    deadlineMs: requestedRuntimeMs > 0 ? startedAt + requestedRuntimeMs : Number.POSITIVE_INFINITY,
    requestedExpansions: Math.max(0, number(config.maxExpansions, 0)),
    requestedRuntimeMs,
    consumedExpansions: 0,
    consumedWallMs: 0,
    stoppedReason: null,
  };
}

function summarizeGlobalBudget(budget) {
  if (!budget) return null;
  const consumedWallMs = Math.max(
    budget.consumedWallMs,
    Date.now() - budget.startedAt,
  );
  if (!budget.stoppedReason) {
    if (
      budget.requestedRuntimeMs > 0 &&
      consumedWallMs >= budget.requestedRuntimeMs
    ) {
      budget.stoppedReason = "time-limit";
    } else if (
      budget.requestedExpansions > 0 &&
      budget.consumedExpansions >= budget.requestedExpansions
    ) {
      budget.stoppedReason = "expansion-limit";
    }
  }
  return {
    scope: budget.scope,
    requestedExpansions: budget.requestedExpansions,
    requestedRuntimeMs: budget.requestedRuntimeMs,
    consumedExpansions: budget.consumedExpansions,
    consumedWallMs,
    stoppedReason: budget.stoppedReason,
  };
}

function runMilestoneGraph(simulator, initialState, milestoneSpec, options) {
  const config = options || {};
  const globalBudget = config.globalBudget || createGlobalBudget(config);
  const graphConfig = globalBudget ? { ...config, globalBudget } : config;
  const finishResult = (result) => ({
    ...result,
    budget: summarizeGlobalBudget(globalBudget),
  });
  const rangeError = milestoneRangeError(
    milestoneSpec,
    config.fromMilestoneId,
    config.toMilestoneId,
  );
  if (rangeError) {
    return finishResult({
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
          recommendedNext: [
            "choose a toMilestone that appears after fromMilestone in the route spec",
          ],
        },
      },
      finalCandidates: [],
      segmentResults: [],
      checkpointResults: [],
      evaluationAttemptLedger: [],
    });
  }
  const segments = milestoneRange(
    milestoneSpec,
    config.fromMilestoneId,
    config.toMilestoneId,
  );
  const checkpointResults = [];
  const initialFrontierState = cloneStateWithoutRouteTrace(initialState);
  let frontier = [
    {
      id: "initial#0",
      state: initialFrontierState,
      route: Array.isArray(initialState.route)
        ? initialState.route.slice()
        : [],
      trace:
        config.captureTrace === true && Array.isArray(initialState.routeTrace)
          ? initialState.routeTrace.slice()
          : [],
      hero: summarizeHero(initialState),
      effectiveHero: summarizeEffectiveHero(initialState),
      tags: ["initial"],
      score: goalCandidateScore(initialState),
    },
  ];
  const segmentResults = [];
  const evaluationAttemptLedger = [];
  const appendLedger = (execution, phase) => {
    const summary = execution && execution.summary;
    if (!summary) return;
    (summary.attempts || []).forEach((attempt) => {
      evaluationAttemptLedger.push({
        segmentId: summary.segmentId,
        phase,
        startCandidateId: attempt.startCandidateId,
        found: attempt.found,
        goalCount: attempt.goalCount,
        diagnostics: attempt.diagnostics,
      });
    });
  };
  const history = [];
  for (
    let segmentIndex = 0;
    segmentIndex < segments.length;
    segmentIndex += 1
  ) {
    const segment = segments[segmentIndex];
    const execution = runSegmentAgainstFrontier(
      simulator,
      segment,
      frontier,
      graphConfig,
      {},
    );
    appendLedger(execution, "initial");
    if (execution.merged.length === 0) {
      const configuredRepair = tryRepairFromConfiguredMilestone(
        simulator,
        segments,
        segmentIndex,
        history,
        execution,
        graphConfig,
      );
      if (configuredRepair && configuredRepair.found) {
        appendLedger(configuredRepair.repairedCurrent, "configured-repair");
        checkpointResults.push(
          buildMilestoneCheckpoint(segment, configuredRepair.repairedCurrent),
        );
        segmentResults.push(configuredRepair.repairedCurrent.summary);
        history.push({
          segment,
          inputFrontier: configuredRepair.repairedCurrent.inputFrontier,
          merged: configuredRepair.repairedCurrent.merged,
          summary: configuredRepair.repairedCurrent.summary,
          repairExpanded: true,
        });
        frontier = configuredRepair.repairedCurrent.merged;
        continue;
      }
      const repair = tryRepairFromPreviousMilestone(
        simulator,
        segments,
        segmentIndex,
        history,
        execution,
        graphConfig,
      );
      if (repair && repair.found) {
        appendLedger(repair.expandedPrevious, "expanded-previous");
        appendLedger(repair.repairedCurrent, "retry-current");
        if (checkpointResults.length > 0) checkpointResults.pop();
        checkpointResults.push(
          buildMilestoneCheckpoint(
            repair.expandedPrevious.segment,
            repair.expandedPrevious,
          ),
        );
        checkpointResults.push(
          buildMilestoneCheckpoint(segment, repair.repairedCurrent),
        );
        const previousIndex = segmentResults.length - 1;
        if (previousIndex >= 0)
          segmentResults[previousIndex] = repair.expandedPrevious.summary;
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
      if (configuredRepair) {
        failedSummary.backtrack = {
          attempted: true,
          repaired: false,
          mode: "configured-milestone-window",
          repairedCurrent: configuredRepair.repairedCurrent && {
            segmentId: configuredRepair.repairedCurrent.segment.id,
            found: configuredRepair.repairedCurrent.merged.length > 0,
          },
        };
      }
      if (repair) {
        failedSummary.backtrack = {
          attempted: true,
          repaired: false,
          expandedPrevious: repair.expandedPrevious && {
            segmentId: repair.expandedPrevious.segment.id,
            candidates: compactSegmentCandidates(
              repair.expandedPrevious.merged,
            ),
          },
          repairedCurrent: repair.repairedCurrent && {
            segmentId: repair.repairedCurrent.segment.id,
            found: repair.repairedCurrent.merged.length > 0,
          },
        };
      }
      segmentResults.push(failedSummary);
      return finishResult({
        found: false,
        reachedMilestone: segment.startFrom || null,
        failedSegment: segmentResults[segmentResults.length - 1],
        finalCandidates: frontier,
        segmentResults,
        checkpointResults,
        evaluationAttemptLedger,
      });
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
  if (
    final &&
    config.qualityFloor &&
    !candidateMeetsQualityFloor(final, config.qualityFloor)
  ) {
    const finalSegment = segments[segments.length - 1] || null;
    const failedSummary = buildQualityFloorFailure(
      finalSegment,
      frontier,
      config.qualityFloor,
    );
    segmentResults.push(failedSummary);
    return finishResult({
      found: false,
      reachedMilestone: finalSegment && (finalSegment.startFrom || null),
      failedSegment: failedSummary,
      finalCandidates: frontier,
      segmentResults,
      checkpointResults,
      evaluationAttemptLedger,
      qualityFloor: {
        passed: false,
        floor: config.qualityFloor,
      },
    });
  }
  return finishResult({
    found: Boolean(final),
    reachedMilestone: segments.length ? segments[segments.length - 1].id : null,
    failedSegment: null,
    finalCandidate: final,
    finalCandidates: frontier,
    segmentResults,
    checkpointResults,
    evaluationAttemptLedger,
    qualityFloor: config.qualityFloor
      ? {
          passed: Boolean(final),
          floor: config.qualityFloor,
        }
      : null,
  });
}

module.exports = {
  buildSegmentActionProvider,
  buildSegmentGoalPredicate,
  runMilestoneGraph,
  searchSegmentDP,
  summarizeEffectiveHero,
  summarizeHero,
  summarizeSegmentFailure,
  __testHooks: {
    allocateGlobalAttemptBudget,
    BLOCKER_TILE_NUMBER: reachAndBattleOracle.BLOCKER_TILE_NUMBER,
    isTileBlocking: reachAndBattleOracle.isTileBlocking,
    closeStateForBattleFrontier:
      reachAndBattleOracle.closeStateForBattleFrontier,
    protectPresentTiles: reachAndBattleOracle.protectPresentTiles,
    restorePresentTiles: reachAndBattleOracle.restorePresentTiles,
    enumerateMonsterTargets: reachAndBattleOracle.enumerateMonsterTargets,
    oracleFindFloorState: reachAndBattleOracle.oracleFindFloorState,
    oracleFindFloorStates: reachAndBattleOracle.oracleFindFloorStates,
    tryReachAndBattle: reachAndBattleOracle.tryReachAndBattle,
    buildMonsterOnlyActionProvider:
      reachAndBattleOracle.buildMonsterOnlyActionProvider,
    actionTargetsProtectedTile,
    isAllowedAction,
  },
};
