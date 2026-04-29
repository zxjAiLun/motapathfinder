"use strict";

const { cloneState, getTileDefinitionAt } = require("./state");
const { estimateBattleSurvivability, parseBattleSummary } = require("./battle-thresholds");

const DEFAULT_ACTION_KINDS = ["battle", "pickup", "equip", "openDoor", "useTool", "changeFloor", "floorFly", "event"];

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function unique(array) {
  return Array.from(new Set((array || []).filter(Boolean)));
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

function effectiveHeroValue(state, field) {
  const hero = (state || {}).hero || {};
  const flags = (state || {}).flags || {};
  return Math.floor(number(hero[field], 0) * number(flags[`__${field}_buff__`], 1));
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

function actionTile(action) {
  if (!action) return null;
  const floorId = action.floorId || (action.target && action.target.floorId) || null;
  const target = action.target || {};
  const x = target.x != null ? target.x : action.x;
  const y = target.y != null ? target.y : action.y;
  if (!floorId || x == null || y == null) return null;
  return { floorId, x: Number(x), y: Number(y) };
}

function adjacentPoints(floorId, x, y) {
  return [
    { floorId, x: x + 1, y },
    { floorId, x: x - 1, y },
    { floorId, x, y: y + 1 },
    { floorId, x, y: y - 1 },
  ];
}

function isEnemyTile(project, tile) {
  return Boolean(tile && tile.id && project.enemysById[tile.id]);
}

function safeEvalItemExpression(project, floorId, expression) {
  const ratio = number(((project.floorsById[floorId] || {}).ratio), 1);
  const substituted = String(expression || "")
    .replace(/core\.values\.([A-Za-z0-9_]+)/g, (match, key) => String(number((project.values || {})[key], 0)))
    .replace(/core\.status\.thisMap\.ratio/g, String(ratio));
  if (!/^[0-9+\-*/ ().]+$/.test(substituted)) return 0;
  try {
    return number(Function(`"use strict"; return (${substituted});`)(), 0);
  } catch (error) {
    return 0;
  }
}

function estimateItemGain(project, floorId, itemId) {
  const item = (project.itemsById || {})[itemId] || {};
  const effect = String(item.itemEffect || "");
  const gain = {};
  const pattern = /core\.status\.hero\.(hp|atk|def|mdef)\s*\+=\s*([^;\n]+)/g;
  let match = pattern.exec(effect);
  while (match) {
    gain[match[1]] = number(gain[match[1]], 0) + safeEvalItemExpression(project, floorId, match[2]);
    match = pattern.exec(effect);
  }
  return gain;
}

function tileKey(tile) {
  return `${tile.floorId}:${tile.x},${tile.y}`;
}

function actionChangeFloorKey(action) {
  const tile = actionTile(action);
  return tile ? tileKey(tile) : null;
}

function actionDestinationFloor(action) {
  if (!action) return null;
  if (action.kind === "floorFly") return action.targetFloorId || null;
  const changeFloor = action.changeFloor || {};
  return changeFloor.floorId || changeFloor.toFloor || changeFloor.floor || null;
}

function floorOrder(project, floorId) {
  const index = (project.floorOrder || []).indexOf(floorId);
  return index < 0 ? 0 : index;
}

function isUsefulIntentAction(simulator, action, targetFloor, targetBattle) {
  if (!action) return false;
  if (action.kind !== "floorFly" && action.kind !== "changeFloor") return true;
  const destinationFloor = actionDestinationFloor(action);
  const anchorFloor = (targetBattle && targetBattle.floorId) || targetFloor;
  if (!destinationFloor || !anchorFloor) return true;
  const destinationOrder = floorOrder(simulator.project, destinationFloor);
  const anchorOrder = floorOrder(simulator.project, anchorFloor);
  return Math.abs(destinationOrder - anchorOrder) <= 1;
}

function trimIntentActions(actions) {
  const floorFlyByDestination = {};
  return (actions || []).filter((action) => {
    if (!action || action.kind !== "floorFly") return true;
    const destinationFloor = actionDestinationFloor(action) || "?";
    floorFlyByDestination[destinationFloor] = number(floorFlyByDestination[destinationFloor], 0) + 1;
    return floorFlyByDestination[destinationFloor] <= 2;
  });
}

function previewAction(simulator, state, action) {
  try {
    return simulator.applyAction(state, action, { storeRoute: false });
  } catch (error) {
    return null;
  }
}

function enumeratePrimitive(simulator, state) {
  const actions = [];
  const seen = new Set();
  const addActions = (list) => {
    (list || []).forEach((action) => {
      if (!action || !action.summary || seen.has(action.summary)) return;
      seen.add(action.summary);
      actions.push(action);
    });
  };
  try {
    addActions(simulator.enumeratePrimitiveActions(state).actions || []);
  } catch (error) {
  }
  try {
    if (typeof simulator.enumerateInteractPickupActions === "function") {
      addActions(simulator.enumerateInteractPickupActions(state) || []);
    }
  } catch (error) {
  }
  try {
    if (typeof simulator.enumerateFloorFlyActions === "function") {
      addActions(simulator.enumerateFloorFlyActions(state) || []);
    }
  } catch (error) {
  }
  return actions;
}

function actionKindCounts(actions) {
  return (actions || []).reduce((counts, action) => {
    const kind = (action && action.kind) || "unknown";
    counts[kind] = number(counts[kind], 0) + 1;
    return counts;
  }, {});
}

function computeFrontierDelta(simulator, before, after, beforeActions, targetFloor) {
  const afterActions = enumeratePrimitive(simulator, after);
  const beforeSet = new Set((beforeActions || []).map((action) => action.summary));
  const newActions = afterActions.filter((action) => !beforeSet.has(action.summary));
  const counts = actionKindCounts(newActions);
  const floorDelta = floorOrder(simulator.project, after.floorId) - floorOrder(simulator.project, before.floorId);
  const targetOrder = targetFloor ? floorOrder(simulator.project, targetFloor) : null;
  const beforeTargetDistance = targetFloor ? Math.abs(targetOrder - floorOrder(simulator.project, before.floorId)) : null;
  const afterTargetDistance = targetFloor ? Math.abs(targetOrder - floorOrder(simulator.project, after.floorId)) : null;
  return {
    targetFloor: targetFloor || null,
    targetFloorProgress: targetFloor ? beforeTargetDistance - afterTargetDistance : 0,
    floorDelta,
    newActionCount: newActions.length,
    newBattleCount: number(counts.battle, 0),
    newPickupCount: number(counts.pickup, 0),
    newChangeFloorCount: number(counts.changeFloor, 0),
    newDoorToolCount: number(counts.openDoor, 0) + number(counts.useTool, 0),
    sampleNewActions: newActions.slice(0, 8).map((action) => action.summary),
  };
}

function equipmentGained(beforeHero, afterHero) {
  return (afterHero.equipment || []).filter((itemId) => !(beforeHero.equipment || []).includes(itemId));
}

function computeDeltas(before, after) {
  const beforeHero = summarizeHero(before);
  const afterHero = summarizeHero(after);
  const beforeEffective = summarizeEffectiveHero(before);
  const afterEffective = summarizeEffectiveHero(after);
  return {
    hp: afterHero.hp - beforeHero.hp,
    atk: afterEffective.atk - beforeEffective.atk,
    def: afterEffective.def - beforeEffective.def,
    mdef: afterEffective.mdef - beforeEffective.mdef,
    rawAtk: afterHero.atk - beforeHero.atk,
    rawDef: afterHero.def - beforeHero.def,
    rawMdef: afterHero.mdef - beforeHero.mdef,
    lv: afterHero.lv - beforeHero.lv,
    exp: afterHero.exp - beforeHero.exp,
    money: afterHero.money - beforeHero.money,
    equipment: equipmentGained(beforeHero, afterHero),
  };
}

function desiredStatsFromFailure(failureClass, missingGoalFields) {
  const stats = new Set();
  const fields = missingGoalFields || [];
  fields.forEach((entry) => {
    const field = String((entry || {}).field || "");
    if (field.endsWith(".atk")) stats.add("atk");
    if (field.endsWith(".def")) stats.add("def");
    if (field.endsWith(".mdef")) stats.add("mdef");
    if (field.endsWith(".hp") || field === "actionSurvivable") stats.add("hp");
    if (field === "equipment") stats.add("equipment");
    if (
      field === "floorId" ||
      field === "tileRemoved" ||
      field === "removedTiles" ||
      field === "anyRemovedTiles" ||
      (field === "actionSurvivable" && entry.actual === "missing-action")
    ) stats.add("path");
  });
  if (failureClass === "atk-deficit") stats.add("atk");
  if (failureClass === "def-deficit") stats.add("def");
  if (failureClass === "mdef-deficit") stats.add("mdef");
  if (failureClass === "hp-deficit") stats.add("hp");
  if (failureClass === "life-limit-hp-deficit") {
    ["hp", "def", "path"].forEach((stat) => stats.add(stat));
  }
  if (failureClass === "action-survivability-deficit") {
    ["hp", "atk", "def", "mdef"].forEach((stat) => stats.add(stat));
  }
  if (failureClass === "equipment-missing") stats.add("equipment");
  if (failureClass === "target-action-unreachable" || failureClass === "target-tile-not-cleared" || failureClass === "floor-scope-mismatch") stats.add("path");
  if (stats.size === 0) ["atk", "def", "mdef", "hp", "path"].forEach((stat) => stats.add(stat));
  return Array.from(stats);
}

function targetFloorFromMissing(missingGoalFields) {
  const floorMissing = (missingGoalFields || []).find((entry) => String((entry || {}).field || "") === "floorId");
  return floorMissing && floorMissing.expected ? String(floorMissing.expected) : null;
}

function targetBattleFromMissing(missingGoalFields) {
  const actionMissing = (missingGoalFields || []).find((entry) =>
    String((entry || {}).field || "") === "actionSurvivable" && String((entry || {}).action || "").startsWith("battle:")
  );
  return actionMissing ? parseBattleSummary(actionMissing.action) : null;
}

function goalTargetsFromMissing(missingGoalFields) {
  const targets = {
    minHero: {},
    minEffectiveHero: {},
    equipmentIncludes: [],
    floorId: targetFloorFromMissing(missingGoalFields),
  };
  (missingGoalFields || []).forEach((entry) => {
    const field = String((entry || {}).field || "");
    const expected = entry && entry.expected;
    if (field.startsWith("hero.")) {
      const heroField = field.slice("hero.".length);
      if (["hp", "atk", "def", "mdef", "lv", "exp"].includes(heroField)) {
        targets.minHero[heroField] = Math.max(number(targets.minHero[heroField], 0), number(expected, 0));
      }
    }
    if (field.startsWith("effectiveHero.")) {
      const heroField = field.slice("effectiveHero.".length);
      if (["atk", "def", "mdef"].includes(heroField)) {
        targets.minEffectiveHero[heroField] = Math.max(number(targets.minEffectiveHero[heroField], 0), number(expected, 0));
      }
    }
    if (field === "equipment" && typeof expected === "string" && !targets.equipmentIncludes.includes(expected)) {
      targets.equipmentIncludes.push(expected);
    }
  });
  return targets;
}

function scoreIntentRecord(record, desiredStats) {
  const delta = record.delta || {};
  const blockedResource = record.blockedResource || {};
  const frontier = record.frontierDelta || {};
  const damage = number(record.damage, 0);
  const includes = (stat) => desiredStats.includes(stat);
  let score = 0;
  if (includes("atk")) score += Math.max(0, delta.atk) * 160000 + Math.max(0, delta.lv) * 80000 + Math.max(0, delta.exp) * 1400;
  if (includes("def")) score += Math.max(0, delta.def) * 130000 + Math.max(0, delta.lv) * 70000 + Math.max(0, delta.exp) * 1200;
  if (includes("mdef")) score += Math.max(0, delta.mdef) * 16000 + Math.max(0, delta.lv) * 50000 + Math.max(0, delta.exp) * 1200;
  if (includes("hp")) score += Math.max(0, delta.hp) * 3 + Math.max(0, delta.def) * 60000 + Math.max(0, delta.mdef) * 5000;
  if (record.failureClass === "life-limit-hp-deficit" || record.failureClass === "action-survivability-deficit" || record.failureClass === "hp-deficit") {
    score += Math.max(0, delta.hp) * 8 + Math.max(0, delta.def) * 90000 + Math.max(0, delta.atk) * 30000;
    score += Math.max(0, number(blockedResource.hpGain, 0)) * 12;
    score += Math.max(0, number(blockedResource.netHpAfterBlocker, 0)) * 4;
    if (record.targetBattleImpact && record.targetBattleImpact.damageReduced > 0) {
      score += record.targetBattleImpact.damageReduced * 2;
    }
    if (record.targetBattleImpact && record.targetBattleImpact.survivableAfter) score += 2000000;
  }
  if (includes("equipment")) score += (delta.equipment || []).length * 900000 + (record.actionKind === "equip" ? 300000 : 0);
  if (includes("path")) {
    score += Math.max(0, frontier.targetFloorProgress) * 900000;
    score += Math.max(0, frontier.floorDelta) * 700000;
    score += Math.max(0, frontier.newChangeFloorCount) * 250000;
    score += Math.max(0, frontier.newPickupCount) * 120000;
    score += Math.max(0, frontier.newBattleCount) * 80000;
    score += Math.max(0, frontier.newDoorToolCount) * 80000;
    if (record.actionKind === "battle" || record.actionKind === "openDoor" || record.actionKind === "useTool") score += 100000;
    if (frontier.targetFloor != null && frontier.targetFloorProgress <= 0 && record.actionKind === "changeFloor") score -= 500000;
  }
  if (record.actionKind === "pickup") score += 160000;
  if (record.actionKind === "equip") score += 150000;
  if (record.actionKind === "battle") score += 90000;
  if (record.actionKind === "openDoor" || record.actionKind === "useTool") score += 80000;
  if (record.actionKind === "changeFloor") score += 120000;
  score -= Math.max(0, damage) * (includes("hp") ? 1.5 : 0.4);
  score -= Math.max(0, -delta.hp) * 0.25;
  score -= Math.max(0, number(record.depth, 1) - 1) * 60000;
  return score;
}

function classifyIntent(record, desiredStats) {
  const delta = record.delta || {};
  const frontier = record.frontierDelta || {};
  if (record.blockedResource && number(record.blockedResource.hpGain, 0) > 0) return "blocked-hp-resource";
  if (record.failureClass === "life-limit-hp-deficit") {
    if (delta.hp > 0 || delta.def > 0 || (record.targetBattleImpact && record.targetBattleImpact.survivableAfter)) return "life-limit-hp-prep";
    if (frontier.floorDelta > 0 || frontier.newChangeFloorCount > 0 || frontier.newActionCount > 0) return "path-blocker-chain";
  }
  if (desiredStats.includes("equipment")) return "equipment";
  if ((delta.equipment || []).length > 0 && (
    number(delta.atk, 0) > 0 ||
    number(delta.def, 0) > 0 ||
    number(delta.mdef, 0) > 0 ||
    number(delta.hp, 0) > 0
  )) return "equipment";
  if (desiredStats.includes("atk") && delta.atk > 0) return "stat-atk";
  if (desiredStats.includes("def") && delta.def > 0) return "stat-def";
  if (desiredStats.includes("mdef") && delta.mdef > 0) return "stat-mdef";
  if (desiredStats.includes("hp") && delta.hp > 0) return "stat-hp";
  if (frontier.floorDelta > 0 || frontier.newChangeFloorCount > 0 || frontier.newActionCount > 0 || desiredStats.includes("path")) return "path-blocker";
  if (delta.exp > 0 || delta.lv > 0) return "exp";
  return "resource";
}

function buildIntentGoal(intent) {
  const top = intent.records[0];
  const targets = intent.goalTargets || {};
  const goal = {
    type: "adaptiveResourceIntent",
  };
  if (intent.kind === "life-limit-hp-prep" && intent.targetBattle) {
    goal.floorId = intent.targetBattle.floorId;
    goal.presentTiles = [{
      floorId: intent.targetBattle.floorId,
      x: intent.targetBattle.x,
      y: intent.targetBattle.y,
      reason: "keep life-limit battle until HP prep is done",
    }];
    goal.actionSurvivable = {
      summary: `battle:${intent.targetBattle.enemyId}@${intent.targetBattle.floorId}:${intent.targetBattle.x},${intent.targetBattle.y}`,
    };
    if (intent.targetBattle.minHpToSurvive != null) {
      goal.minHero = {
        ...(goal.minHero || {}),
        hp: Math.max(1, number(intent.targetBattle.minHpToSurvive, 1)),
      };
    }
  }
  if (intent.kind === "blocked-hp-resource" && top && top.blockerBattle) {
    goal.floorId = top.blockerBattle.floorId;
    goal.actionSurvivable = {
      summary: `battle:${top.blockerBattle.enemyId}@${top.blockerBattle.floorId}:${top.blockerBattle.x},${top.blockerBattle.y}`,
    };
    if (top.blockerBattle.minHpToSurvive != null) {
      goal.minHero = {
        ...(goal.minHero || {}),
        hp: Math.max(1, number(top.blockerBattle.minHpToSurvive, 1)),
      };
    }
    const presentTiles = [];
    if (intent.targetBattle) {
      presentTiles.push({
        floorId: intent.targetBattle.floorId,
        x: intent.targetBattle.x,
        y: intent.targetBattle.y,
        reason: "keep target battle until the blocked HP resource is reachable",
      });
    }
    if (top.resourceTile) {
      presentTiles.push({
        ...top.resourceTile,
        reason: "keep blocked HP resource until its blocker is survivable",
      });
    }
    if (presentTiles.length > 0) goal.presentTiles = presentTiles;
  }
  const tileRecords = intent.records.filter((record) =>
    record.tile && record.actionKind !== "changeFloor" && record.actionKind !== "floorFly"
  );
  if (tileRecords.length > 0 && intent.kind !== "blocked-hp-resource") {
    goal.anyRemovedTiles = tileRecords.map((record) => ({
      ...record.tile,
      reason: `Auto ${intent.kind} candidate from ${record.actionSummary}`,
    }));
  }
  const equipmentIds = unique(intent.records.flatMap((record) => record.delta.equipment || []));
  const equipActionIds = unique(intent.records
    .filter((record) => record.actionKind === "equip")
    .map((record) => /^equip:(.+)$/.exec(record.actionSummary || ""))
    .filter(Boolean)
    .map((match) => match[1]));
  if (intent.kind === "equipment") {
    const required = (targets.equipmentIncludes || [])[0] || equipmentIds[0] || equipActionIds[0];
    if (required) goal.equipmentIncludes = [required];
  }
  if (top && top.actionKind === "changeFloor" && tileRecords.length === 0 && top.after && top.after.floorId) {
    goal.floorId = top.after.floorId;
    goal.minHero = { hp: 1 };
  }
  if (intent.primaryStat && top && top.after) {
    if (intent.primaryStat === "hp") {
      goal.minHero = {
        ...(goal.minHero || {}),
        hp: Math.max(1, number((targets.minHero || {}).hp, 0), summarizeHero(top.after).hp),
      };
    } else {
      const exactEffectiveTarget = number((targets.minEffectiveHero || {})[intent.primaryStat], 0);
      const rawTarget = number((targets.minHero || {})[intent.primaryStat], 0);
      goal.minEffectiveHero = {
        ...(goal.minEffectiveHero || {}),
        [intent.primaryStat]: Math.max(1, exactEffectiveTarget, summarizeEffectiveHero(top.after)[intent.primaryStat]),
      };
      if (rawTarget > 0) goal.minHero = { ...(goal.minHero || {}), [intent.primaryStat]: rawTarget };
    }
  }
  if (intent.kind === "path-blocker-chain" && top && top.after && top.after.floorId) {
    goal.floorId = top.after.floorId;
    goal.minHero = { ...(goal.minHero || {}), hp: Math.max(1, summarizeHero(top.after).hp) };
  }
  return goal;
}

function buildIntentPolicy(intent, baseCandidates) {
  const floors = new Set();
  const changeFloors = new Set();
  for (const candidate of baseCandidates || []) {
    const state = candidate && candidate.state;
    if (!state) continue;
    floors.add(state.floorId);
    enumeratePrimitive(intent.simulator, state)
      .filter((action) => action.kind === "changeFloor")
      .forEach((action) => {
        const key = actionChangeFloorKey(action);
        if (key) changeFloors.add(key);
        const destinationFloor = actionDestinationFloor(action);
        if (destinationFloor && intent.simulator.project.floorsById[destinationFloor]) floors.add(destinationFloor);
        const preview = previewAction(intent.simulator, state, action);
        if (preview && preview.floorId) floors.add(preview.floorId);
      });
  }
  intent.records.forEach((record) => {
    if (record.before && record.before.floorId) floors.add(record.before.floorId);
    if (record.after && record.after.floorId) floors.add(record.after.floorId);
    if (record.tile && record.tile.floorId) floors.add(record.tile.floorId);
    (record.actionChainTiles || []).forEach((tile) => {
      if (tile && tile.floorId) floors.add(tile.floorId);
    });
    if (record.actionKind === "changeFloor" && record.tile) changeFloors.add(tileKey(record.tile));
  });
  return {
    actionKinds: DEFAULT_ACTION_KINDS.slice(),
    forbidUnsupportedEvents: true,
    allowedFloors: Array.from(floors).sort(),
    allowChangeFloors: Array.from(changeFloors).sort(),
  };
}

function recordStateKey(state) {
  const hero = summarizeHero(state);
  return JSON.stringify({
    floorId: state.floorId,
    hp: hero.hp,
    atk: hero.atk,
    def: hero.def,
    mdef: hero.mdef,
    lv: hero.lv,
    exp: hero.exp,
    equipment: hero.equipment,
  });
}

function computeTargetBattleImpact(simulator, beforeEstimate, after, targetBattle) {
  if (!targetBattle) return null;
  const afterEstimate = estimateBattleSurvivability(simulator, after, targetBattle, { skipMinHp: true });
  if (!beforeEstimate || !beforeEstimate.supported || !afterEstimate || !afterEstimate.supported) return null;
  return {
    beforeDamage: beforeEstimate.currentDamage,
    afterDamage: afterEstimate.currentDamage,
    damageReduced: number(beforeEstimate.currentDamage, 0) - number(afterEstimate.currentDamage, 0),
    survivableBefore: beforeEstimate.survivable,
    survivableAfter: afterEstimate.survivable,
    minHpToSurvive: afterEstimate.minHpToSurvive,
  };
}

function computeHypotheticalTargetImpact(simulator, state, targetBattle, hpAfterResource) {
  if (!targetBattle || !Number.isFinite(hpAfterResource)) return null;
  const beforeEstimate = estimateBattleSurvivability(simulator, state, targetBattle, { skipMinHp: true });
  const afterState = cloneState(state);
  afterState.hero.hp = Math.max(1, Math.floor(hpAfterResource));
  const afterEstimate = estimateBattleSurvivability(simulator, afterState, targetBattle, { skipMinHp: true });
  if (!beforeEstimate || !beforeEstimate.supported || !afterEstimate || !afterEstimate.supported) return null;
  return {
    beforeDamage: beforeEstimate.currentDamage,
    afterDamage: afterEstimate.currentDamage,
    damageReduced: number(beforeEstimate.currentDamage, 0) - number(afterEstimate.currentDamage, 0),
    survivableBefore: beforeEstimate.survivable,
    survivableAfter: afterEstimate.survivable,
    minHpToSurvive: null,
  };
}

function shouldComputeTargetBattleImpact(delta, action) {
  if (!delta) return false;
  if (Math.max(
    number(delta.hp, 0),
    number(delta.atk, 0),
    number(delta.def, 0),
    number(delta.mdef, 0),
    number(delta.rawAtk, 0),
    number(delta.rawDef, 0),
    number(delta.rawMdef, 0),
    number(delta.lv, 0)
  ) > 0) return true;
  if ((delta.equipment || []).length > 0) return true;
  return action && action.kind === "equip";
}

function enumerateIntentRecords(simulator, candidate, desiredStats, failureClass, targetFloor, targetBattle, options) {
  const config = options || {};
  const root = candidate && candidate.state;
  if (!root) return [];
  const maxDepth = Math.max(1, number(config.intentDepth, 1));
  const maxNodes = Math.max(1, number(config.maxIntentNodes, 80));
  const queue = [{ state: root, chain: [], chainTiles: [] }];
  const seenNodes = new Set([recordStateKey(root)]);
  const records = [];
  const rootTargetBattleEstimate = targetBattle
    ? estimateBattleSurvivability(simulator, root, targetBattle, { skipMinHp: true })
    : null;
  let cursor = 0;
  while (cursor < queue.length && cursor < maxNodes) {
    const node = queue[cursor];
    cursor += 1;
    const allBeforeActions = enumeratePrimitive(simulator, node.state);
    const beforeActions = trimIntentActions(allBeforeActions);
    for (const action of beforeActions) {
      if (!action || !DEFAULT_ACTION_KINDS.includes(action.kind)) continue;
      if (!isUsefulIntentAction(simulator, action, targetFloor, targetBattle)) continue;
      if (action.kind === "event" && (action.unsupported || action.hasStateChange === false)) continue;
      const tile = actionTile(action);
      if (tile && getTileDefinitionAt(simulator.project, node.state, tile.floorId, tile.x, tile.y) == null) continue;
      const after = previewAction(simulator, node.state, action);
      if (!after) continue;
      const chain = node.chain.concat(action.summary);
      const chainTiles = tile ? node.chainTiles.concat([tile]) : node.chainTiles.slice();
      const delta = computeDeltas(root, after);
      const frontierDelta = computeFrontierDelta(simulator, node.state, after, allBeforeActions, targetFloor);
      const record = {
        key: `${candidate.id || "candidate"}:${chain.join(">")}`,
        actionSummary: action.summary,
        actionChain: chain,
        actionChainTiles: chainTiles,
        actionKind: action.kind,
        tile,
        depth: chain.length,
        damage: number((action.estimate || {}).damage, 0),
        startCandidateId: candidate.id,
        before: node.state,
        after,
        beforeSummary: {
          floorId: node.state.floorId,
          hero: summarizeHero(node.state),
          effectiveHero: summarizeEffectiveHero(node.state),
        },
        afterSummary: {
          floorId: after.floorId,
          hero: summarizeHero(after),
          effectiveHero: summarizeEffectiveHero(after),
        },
        delta,
        frontierDelta,
        targetBattleImpact: shouldComputeTargetBattleImpact(delta, action)
          ? computeTargetBattleImpact(simulator, rootTargetBattleEstimate, after, targetBattle)
          : null,
        failureClass,
      };
      record.kind = classifyIntent(record, desiredStats);
      record.score = scoreIntentRecord(record, desiredStats);
      if (record.score > 0) records.push(record);
      if (chain.length < maxDepth && queue.length < maxNodes) {
        const key = recordStateKey(after);
        if (!seenNodes.has(key)) {
          seenNodes.add(key);
          queue.push({ state: after, chain, chainTiles });
        }
      }
    }
  }
  return records;
}

function scanBlockedResourceRecords(simulator, candidate, desiredStats, failureClass, targetFloor, targetBattle, options) {
  const config = options || {};
  if (!targetBattle || !["life-limit-hp-deficit", "action-survivability-deficit", "hp-deficit"].includes(failureClass)) return [];
  const state = candidate && candidate.state;
  if (!state) return [];
  const radius = Math.max(2, number(config.blockedResourceRadius, 4));
  const floorId = targetBattle.floorId;
  const floor = simulator.project.floorsById[floorId];
  if (!floor) return [];
  const records = [];
  for (let y = Math.max(0, targetBattle.y - radius); y <= Math.min(floor.height - 1, targetBattle.y + radius); y += 1) {
    for (let x = Math.max(0, targetBattle.x - radius); x <= Math.min(floor.width - 1, targetBattle.x + radius); x += 1) {
      const itemTile = getTileDefinitionAt(simulator.project, state, floorId, x, y);
      if (!itemTile || !itemTile.id || !(simulator.project.itemsById || {})[itemTile.id]) continue;
      const itemGain = estimateItemGain(simulator.project, floorId, itemTile.id);
      if (number(itemGain.hp, 0) <= 0 && number(itemGain.def, 0) <= 0) continue;
      for (const blockerPoint of adjacentPoints(floorId, x, y)) {
        const blockerTile = getTileDefinitionAt(simulator.project, state, blockerPoint.floorId, blockerPoint.x, blockerPoint.y);
        if (!isEnemyTile(simulator.project, blockerTile)) continue;
        if (
          blockerPoint.floorId === targetBattle.floorId &&
          blockerPoint.x === Number(targetBattle.x) &&
          blockerPoint.y === Number(targetBattle.y)
        ) {
          continue;
        }
        const blockerBattle = estimateBattleSurvivability(simulator, state, {
          ...blockerPoint,
          enemyId: blockerTile.id,
        });
        if (!blockerBattle.supported) continue;
        const blockerDamage = number(blockerBattle.currentDamage, Number.POSITIVE_INFINITY);
        const hpAfterResource = number((state.hero || {}).hp, 0) - blockerDamage + number(itemGain.hp, 0);
        const delta = {
          hp: hpAfterResource - number((state.hero || {}).hp, 0),
          atk: number(itemGain.atk, 0),
          def: number(itemGain.def, 0),
          mdef: number(itemGain.mdef, 0),
          rawAtk: number(itemGain.atk, 0),
          rawDef: number(itemGain.def, 0),
          rawMdef: number(itemGain.mdef, 0),
          lv: 0,
          exp: number(((simulator.project.enemysById || {})[blockerTile.id] || {}).exp, 0),
          money: 0,
          equipment: [],
        };
        const record = {
          key: `${candidate.id || "candidate"}:blocked:${blockerTile.id}@${floorId}:${blockerPoint.x},${blockerPoint.y}->${itemTile.id}@${floorId}:${x},${y}`,
          actionSummary: `battle:${blockerTile.id}@${floorId}:${blockerPoint.x},${blockerPoint.y}`,
          actionChain: [
            `battle:${blockerTile.id}@${floorId}:${blockerPoint.x},${blockerPoint.y}`,
            `pickup:${itemTile.id}@${floorId}:${x},${y}`,
          ],
          actionChainTiles: [blockerPoint, { floorId, x, y }],
          actionKind: "battle",
          tile: blockerPoint,
          resourceTile: { floorId, x, y },
          depth: 2,
          damage: blockerDamage,
          startCandidateId: candidate.id,
          before: state,
          after: state,
          beforeSummary: {
            floorId: state.floorId,
            hero: summarizeHero(state),
            effectiveHero: summarizeEffectiveHero(state),
          },
          afterSummary: {
            floorId,
            hero: {
              ...summarizeHero(state),
              hp: Math.max(1, Math.floor(hpAfterResource)),
              exp: number((state.hero || {}).exp, 0) + delta.exp,
            },
            effectiveHero: summarizeEffectiveHero(state),
          },
          delta,
          frontierDelta: {
            targetFloor: targetFloor || floorId,
            targetFloorProgress: 0,
            floorDelta: 0,
            newActionCount: 1,
            newBattleCount: 1,
            newPickupCount: 1,
            newChangeFloorCount: 0,
            newDoorToolCount: 0,
            sampleNewActions: [],
          },
          blockerBattle: {
            floorId,
            x: blockerPoint.x,
            y: blockerPoint.y,
            enemyId: blockerTile.id,
            enemyLabel: blockerBattle.enemyLabel,
            damage: blockerBattle.currentDamage,
            minHpToSurvive: blockerBattle.minHpToSurvive,
            survivable: blockerBattle.survivable,
          },
          blockedResource: {
            itemId: itemTile.id,
            floorId,
            x,
            y,
            hpGain: number(itemGain.hp, 0),
            defGain: number(itemGain.def, 0),
            blockerDamage,
            netHpAfterBlocker: hpAfterResource,
          },
          targetBattleImpact: computeHypotheticalTargetImpact(simulator, state, targetBattle, hpAfterResource),
          failureClass,
        };
        record.kind = classifyIntent(record, desiredStats);
        record.score = scoreIntentRecord(record, desiredStats);
        records.push(record);
      }
    }
  }
  return records;
}

function scanResourceIntents(simulator, candidates, failure, options) {
  const config = options || {};
  const failureClass = (failure && failure.failureClass) || "unknown";
  const missingGoalFields = (failure && failure.missingGoalFields) || [];
  const desiredStats = desiredStatsFromFailure(failureClass, missingGoalFields);
  const goalTargets = goalTargetsFromMissing(missingGoalFields);
  const targetFloor = targetFloorFromMissing(missingGoalFields);
  const rawTargetBattle = config.targetBattle || targetBattleFromMissing(missingGoalFields);
  const targetState = ((candidates || []).find((candidate) => candidate && candidate.state) || {}).state;
  const targetBattleEstimate = rawTargetBattle && targetState
    ? estimateBattleSurvivability(simulator, targetState, rawTargetBattle)
    : null;
  const targetBattle = rawTargetBattle ? {
    ...rawTargetBattle,
    enemyLabel: targetBattleEstimate && targetBattleEstimate.enemyLabel,
    minHpToSurvive: targetBattleEstimate && targetBattleEstimate.minHpToSurvive,
  } : null;
  const maxRecords = Math.max(1, number(config.maxIntentRecords, 24));
  const records = [];
  const seen = new Set();
  for (const candidate of candidates || []) {
    for (const record of enumerateIntentRecords(simulator, candidate, desiredStats, failureClass, targetFloor, targetBattle, config)) {
      if (seen.has(record.key)) continue;
      seen.add(record.key);
      records.push(record);
    }
    if (config.includeBlockedResources !== false) {
      for (const record of scanBlockedResourceRecords(simulator, candidate, desiredStats, failureClass, targetFloor, targetBattle, config)) {
        if (seen.has(record.key)) continue;
        seen.add(record.key);
        records.push(record);
      }
    }
  }
  const grouped = new Map();
  records
    .sort((left, right) => right.score - left.score)
    .slice(0, maxRecords)
    .forEach((record) => {
      if (!grouped.has(record.kind)) grouped.set(record.kind, []);
      grouped.get(record.kind).push(record);
    });
  const intents = Array.from(grouped.entries()).map(([kind, group]) => {
    const primaryStat = kind === "stat-atk" ? "atk"
      : kind === "stat-def" ? "def"
        : kind === "stat-mdef" ? "mdef"
          : kind === "stat-hp" ? "hp"
            : null;
    let topRecords = group
      .sort((left, right) => right.score - left.score)
      .slice(0, Math.max(1, number(config.recordsPerIntent, 6)));
    if (kind === "path-blocker" || kind === "path-blocker-chain") {
      const removable = topRecords.filter((record) =>
        record.tile && record.actionKind !== "changeFloor" && record.actionKind !== "floorFly"
      );
      if (removable.length > 0) topRecords = removable;
    }
    const intent = {
      simulator,
      kind,
      primaryStat,
      score: topRecords.reduce((sum, record, index) => sum + record.score / (index + 1), 0),
      desiredStats,
      goalTargets,
      targetBattle,
      records: topRecords,
    };
    intent.goal = buildIntentGoal(intent);
    intent.actionPolicy = buildIntentPolicy(intent, candidates);
    return intent;
  });
  return intents
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, number(config.maxIntents, 6)))
    .map((intent) => ({
      kind: intent.kind,
      primaryStat: intent.primaryStat,
      score: intent.score,
      desiredStats: intent.desiredStats,
      goalTargets: intent.goalTargets,
      targetBattle: intent.targetBattle,
      goal: intent.goal,
      actionPolicy: intent.actionPolicy,
      records: intent.records.map((record) => ({
        actionSummary: record.actionSummary,
        actionChain: record.actionChain,
        actionKind: record.actionKind,
        tile: record.tile,
        depth: record.depth,
        score: Math.round(record.score),
        damage: record.damage,
        startCandidateId: record.startCandidateId,
        before: record.beforeSummary,
        after: record.afterSummary,
        delta: record.delta,
        frontierDelta: record.frontierDelta,
        targetBattleImpact: record.targetBattleImpact,
        blockerBattle: record.blockerBattle,
        blockedResource: record.blockedResource,
        resourceTile: record.resourceTile,
      })),
    }));
}

module.exports = {
  scanResourceIntents,
};
