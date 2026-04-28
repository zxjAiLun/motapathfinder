"use strict";

const { getTileDefinitionAt } = require("./state");

const DEFAULT_ACTION_KINDS = ["battle", "pickup", "equip", "openDoor", "useTool", "changeFloor", "event"];

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

function tileKey(tile) {
  return `${tile.floorId}:${tile.x},${tile.y}`;
}

function actionChangeFloorKey(action) {
  const tile = actionTile(action);
  return tile ? tileKey(tile) : null;
}

function floorOrder(project, floorId) {
  const index = (project.floorOrder || []).indexOf(floorId);
  return index < 0 ? 0 : index;
}

function previewAction(simulator, state, action) {
  try {
    return simulator.applyAction(state, action, { storeRoute: false });
  } catch (error) {
    return null;
  }
}

function enumeratePrimitive(simulator, state) {
  try {
    return simulator.enumeratePrimitiveActions(state).actions || [];
  } catch (error) {
    return [];
  }
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
    if (field === "floorId" || field === "tileRemoved" || field === "removedTiles" || field === "anyRemovedTiles" || field === "actionSurvivable") stats.add("path");
  });
  if (failureClass === "atk-deficit") stats.add("atk");
  if (failureClass === "def-deficit") stats.add("def");
  if (failureClass === "mdef-deficit") stats.add("mdef");
  if (failureClass === "hp-deficit" || failureClass === "action-survivability-deficit") stats.add("hp");
  if (failureClass === "equipment-missing") stats.add("equipment");
  if (failureClass === "target-action-unreachable" || failureClass === "target-tile-not-cleared" || failureClass === "floor-scope-mismatch") stats.add("path");
  if (stats.size === 0) ["atk", "def", "mdef", "hp", "path"].forEach((stat) => stats.add(stat));
  return Array.from(stats);
}

function targetFloorFromMissing(missingGoalFields) {
  const floorMissing = (missingGoalFields || []).find((entry) => String((entry || {}).field || "") === "floorId");
  return floorMissing && floorMissing.expected ? String(floorMissing.expected) : null;
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
  const frontier = record.frontierDelta || {};
  const damage = number(record.damage, 0);
  const includes = (stat) => desiredStats.includes(stat);
  let score = 0;
  if (includes("atk")) score += Math.max(0, delta.atk) * 160000 + Math.max(0, delta.lv) * 80000 + Math.max(0, delta.exp) * 1400;
  if (includes("def")) score += Math.max(0, delta.def) * 130000 + Math.max(0, delta.lv) * 70000 + Math.max(0, delta.exp) * 1200;
  if (includes("mdef")) score += Math.max(0, delta.mdef) * 16000 + Math.max(0, delta.lv) * 50000 + Math.max(0, delta.exp) * 1200;
  if (includes("hp")) score += Math.max(0, delta.hp) * 3 + Math.max(0, delta.def) * 60000 + Math.max(0, delta.mdef) * 5000;
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
  return score;
}

function classifyIntent(record, desiredStats) {
  const delta = record.delta || {};
  const frontier = record.frontierDelta || {};
  if ((delta.equipment || []).length > 0 || record.actionKind === "equip" || desiredStats.includes("equipment")) return "equipment";
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
  const tileRecords = intent.records.filter((record) =>
    record.tile && record.actionKind !== "changeFloor"
  );
  if (tileRecords.length > 0) {
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
      .map(actionChangeFloorKey)
      .filter(Boolean)
      .forEach((key) => changeFloors.add(key));
  }
  intent.records.forEach((record) => {
    if (record.before && record.before.floorId) floors.add(record.before.floorId);
    if (record.after && record.after.floorId) floors.add(record.after.floorId);
    if (record.tile && record.tile.floorId) floors.add(record.tile.floorId);
    if (record.actionKind === "changeFloor" && record.tile) changeFloors.add(tileKey(record.tile));
  });
  return {
    actionKinds: DEFAULT_ACTION_KINDS.slice(),
    forbidUnsupportedEvents: true,
    allowedFloors: Array.from(floors).sort(),
    allowChangeFloors: Array.from(changeFloors).sort(),
  };
}

function scanResourceIntents(simulator, candidates, failure, options) {
  const config = options || {};
  const failureClass = (failure && failure.failureClass) || "unknown";
  const missingGoalFields = (failure && failure.missingGoalFields) || [];
  const desiredStats = desiredStatsFromFailure(failureClass, missingGoalFields);
  const goalTargets = goalTargetsFromMissing(missingGoalFields);
  const targetFloor = targetFloorFromMissing(missingGoalFields);
  const maxRecords = Math.max(1, number(config.maxIntentRecords, 24));
  const records = [];
  const seen = new Set();
  for (const candidate of candidates || []) {
    const state = candidate && candidate.state;
    if (!state) continue;
    const beforeActions = enumeratePrimitive(simulator, state);
    for (const action of beforeActions) {
      if (!action || !DEFAULT_ACTION_KINDS.includes(action.kind)) continue;
      if (action.kind === "event" && (action.unsupported || action.hasStateChange === false)) continue;
      const tile = actionTile(action);
      if (tile && getTileDefinitionAt(simulator.project, state, tile.floorId, tile.x, tile.y) == null) continue;
      const key = tile ? `${action.kind}:${tileKey(tile)}` : action.summary;
      if (seen.has(key)) continue;
      const after = previewAction(simulator, state, action);
      if (!after) continue;
      seen.add(key);
      const delta = computeDeltas(state, after);
      const frontierDelta = computeFrontierDelta(simulator, state, after, beforeActions, targetFloor);
      const record = {
        key,
        actionSummary: action.summary,
        actionKind: action.kind,
        tile,
        damage: number((action.estimate || {}).damage, 0),
        startCandidateId: candidate.id,
        before: state,
        after,
        beforeSummary: {
          floorId: state.floorId,
          hero: summarizeHero(state),
          effectiveHero: summarizeEffectiveHero(state),
        },
        afterSummary: {
          floorId: after.floorId,
          hero: summarizeHero(after),
          effectiveHero: summarizeEffectiveHero(after),
        },
        delta,
        frontierDelta,
      };
      record.kind = classifyIntent(record, desiredStats);
      record.score = scoreIntentRecord(record, desiredStats);
      if (record.score > 0) records.push(record);
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
    if (kind === "path-blocker") {
      const removable = topRecords.filter((record) => record.tile && record.actionKind !== "changeFloor");
      if (removable.length > 0) topRecords = removable;
    }
    const intent = {
      simulator,
      kind,
      primaryStat,
      score: topRecords.reduce((sum, record, index) => sum + record.score / (index + 1), 0),
      desiredStats,
      goalTargets,
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
      goal: intent.goal,
      actionPolicy: intent.actionPolicy,
      records: intent.records.map((record) => ({
        actionSummary: record.actionSummary,
        actionKind: record.actionKind,
        tile: record.tile,
        score: Math.round(record.score),
        damage: record.damage,
        startCandidateId: record.startCandidateId,
        before: record.beforeSummary,
        after: record.afterSummary,
        delta: record.delta,
        frontierDelta: record.frontierDelta,
      })),
    }));
}

module.exports = {
  scanResourceIntents,
};
