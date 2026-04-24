"use strict";

const { applyPickup } = require("./effect-vm");
const { resolveChangeFloorTarget } = require("./floor-transitions");
const { DIRECTION_DELTAS, DIRECTIONS, coordinateKey, isDoorTile, isEnemyTile } = require("./reachability");
const { cloneState, ensureMeta, floorHasCoordinate, getTileDefinitionAt } = require("./state");

function isRegionTraverseTile(project, state, floorId, x, y) {
  if (!floorHasCoordinate(project, floorId, x, y)) return false;
  const floor = project.floorsById[floorId];
  if ((floor.changeFloor || {})[coordinateKey(x, y)]) return false;

  const tile = getTileDefinitionAt(project, state, floorId, x, y);
  if (tile == null) return true;
  if (isEnemyTile(tile)) return false;
  if (isDoorTile(tile)) return false;
  if (tile.cls === "items") return false;
  if (tile.trigger != null && tile.trigger !== "null" && tile.trigger !== "passNet") return false;
  return tile.canPass === true;
}

function getFeatureCache(state) {
  const meta = ensureMeta(state);
  if (!meta.__frontierFeatures) meta.__frontierFeatures = {};
  return meta.__frontierFeatures;
}

function bucketDistance(distance) {
  if (!Number.isFinite(distance)) return "far";
  if (distance <= 1) return "1";
  if (distance <= 2) return "2";
  if (distance <= 4) return "4";
  return "far";
}

function bucketOpportunity(score) {
  if (!Number.isFinite(score) || score <= 0) return "0";
  if (score <= 80) return "80";
  if (score <= 200) return "200";
  if (score <= 500) return "500";
  return "high";
}

function compareTargetRecords(left, right) {
  const leftScore = Number(((left.preview || {}).score) || 0);
  const rightScore = Number(((right.preview || {}).score) || 0);
  if (leftScore !== rightScore) return rightScore - leftScore;
  const leftZeroDamage = Number(((left.preview || {}).zeroDamageBattleCount) || 0);
  const rightZeroDamage = Number(((right.preview || {}).zeroDamageBattleCount) || 0);
  if (leftZeroDamage !== rightZeroDamage) return rightZeroDamage - leftZeroDamage;
  const leftItemCount = Number(((left.preview || {}).itemCount) || 0);
  const rightItemCount = Number(((right.preview || {}).itemCount) || 0);
  if (leftItemCount !== rightItemCount) return rightItemCount - leftItemCount;
  const leftKind = left.kind === "next" ? 0 : left.kind === "before" ? 1 : 2;
  const rightKind = right.kind === "next" ? 0 : right.kind === "before" ? 1 : 2;
  if (leftKind !== rightKind) return leftKind - rightKind;
  if (left.distance !== right.distance) return left.distance - right.distance;
  if (left.locKey !== right.locKey) return left.locKey.localeCompare(right.locKey);
  return left.targetFloorId.localeCompare(right.targetFloorId);
}

function evaluateBattleFrontier(project, state, battleResolver, floorId, x, y, tile) {
  if (!battleResolver || typeof battleResolver.evaluateBattle !== "function") return null;
  const result = battleResolver.evaluateBattle(state, floorId, x, y, tile.id);
  if (!result.supported || !result.damageInfo || result.damageInfo.damage == null) return null;
  if (Number(result.damageInfo.damage || 0) >= Number(state.hero.hp || 0)) return null;
  return result;
}

function countInventory(inventory) {
  return Object.values(inventory || {}).reduce((sum, value) => sum + Number(value || 0), 0);
}

function getItemPreviewUtility(project, state, floorId, itemId) {
  const previewState = cloneState(state);
  previewState.floorId = floorId;
  const beforeInventory = countInventory(previewState.inventory);
  const beforeFlags = {
    curse: Boolean(previewState.flags.curse),
    poison: Boolean(previewState.flags.poison),
    weak: Boolean(previewState.flags.weak),
  };
  const before = {
    hp: Number(previewState.hero.hp || 0),
    atk: Number(previewState.hero.atk || 0),
    def: Number(previewState.hero.def || 0),
    mdef: Number(previewState.hero.mdef || 0),
    money: Number(previewState.hero.money || 0),
    exp: Number(previewState.hero.exp || 0),
  };
  applyPickup(project, previewState, itemId);
  const afterInventory = countInventory(previewState.inventory);
  let score = 0;
  score += (Number(previewState.hero.atk || 0) - before.atk) * 70;
  score += (Number(previewState.hero.def || 0) - before.def) * 60;
  score += (Number(previewState.hero.mdef || 0) - before.mdef) * 20;
  score += (Number(previewState.hero.hp || 0) - before.hp) * 0.03;
  score += (Number(previewState.hero.money || 0) - before.money) * 1.5;
  score += (Number(previewState.hero.exp || 0) - before.exp) * 8;
  score += (afterInventory - beforeInventory) * 120;
  if (itemId === "centerFly") score += 280;
  else if (itemId === "pickaxe" || itemId === "bomb") score += 180;
  else if (itemId === "fly" || itemId === "book") score += 120;
  if (!beforeFlags.poison && previewState.flags.poison) score -= 280;
  if (!beforeFlags.weak && previewState.flags.weak) score -= 220;
  if (!beforeFlags.curse && previewState.flags.curse) score -= 260;
  return score;
}

function isTargetTraverseTile(project, state, floorId, x, y) {
  if (!floorHasCoordinate(project, floorId, x, y)) return false;
  const tile = getTileDefinitionAt(project, state, floorId, x, y);
  if (tile == null) return true;
  if (isEnemyTile(tile)) return false;
  if (isDoorTile(tile)) return false;
  if (tile.cls === "items") return true;
  if (tile.trigger != null && tile.trigger !== "null" && tile.trigger !== "passNet") return false;
  return tile.canPass === true;
}

function estimateTargetFloorOpportunity(project, state, battleResolver, floorId, startX, startY) {
  if (!project.floorsById[floorId] || !floorHasCoordinate(project, floorId, startX, startY)) {
    return {
      score: 0,
      itemCount: 0,
      battleFrontierCount: 0,
      zeroDamageBattleCount: 0,
    };
  }
  const targetState = cloneState(state);
  targetState.floorId = floorId;
  targetState.hero.loc.x = startX;
  targetState.hero.loc.y = startY;

  const queue = [{ x: startX, y: startY }];
  const visited = new Set([coordinateKey(startX, startY)]);
  const seenItems = new Set();
  const seenBattle = new Set();
  let score = 0;
  let itemCount = 0;
  let battleFrontierCount = 0;
  let zeroDamageBattleCount = 0;

  while (queue.length > 0) {
    const current = queue.shift();
    DIRECTIONS.forEach((direction) => {
      const delta = DIRECTION_DELTAS[direction];
      const x = current.x + delta.x;
      const y = current.y + delta.y;
      if (!floorHasCoordinate(project, floorId, x, y)) return;
      const locKey = coordinateKey(x, y);
      const tile = getTileDefinitionAt(project, targetState, floorId, x, y);

      if (tile && tile.cls === "items" && (tile.trigger == null || tile.trigger === "getItem") && !seenItems.has(locKey)) {
        seenItems.add(locKey);
        itemCount += 1;
        score += getItemPreviewUtility(project, targetState, floorId, tile.id);
      }

      if (isEnemyTile(tile)) {
        if (seenBattle.has(locKey)) return;
        seenBattle.add(locKey);
        battleFrontierCount += 1;
        if (battleResolver && typeof battleResolver.evaluateBattle === "function") {
          const battle = battleResolver.evaluateBattle(targetState, floorId, x, y, tile.id);
          if (battle.supported && battle.damageInfo && Number(battle.damageInfo.damage || 0) === 0) {
            zeroDamageBattleCount += 1;
            score += 30;
          }
        }
        return;
      }

      if (!isTargetTraverseTile(project, targetState, floorId, x, y)) return;
      if (visited.has(locKey)) return;
      visited.add(locKey);
      queue.push({ x, y });
    });
  }

  return {
    score,
    itemCount,
    battleFrontierCount,
    zeroDamageBattleCount,
  };
}

function computeFrontierFeatures(project, state, options) {
  const cache = getFeatureCache(state);
  const battleResolver = options && options.battleResolver;
  const cacheKey = battleResolver ? "withBattle" : "withoutBattle";
  if (cache[cacheKey]) return cache[cacheKey];

  const floor = project.floorsById[state.floorId];
  const start = { x: state.hero.loc.x, y: state.hero.loc.y, distance: 0 };
  const queue = [start];
  const visited = new Map([[coordinateKey(start.x, start.y), start]]);
  const regionMembers = [];
  const battleFrontier = new Map();
  const zeroDamageFrontier = new Map();
  const changeFloorFrontier = new Map();
  const nextFloorFrontier = new Map();

  while (queue.length > 0) {
    const current = queue.shift();
    const currentKey = coordinateKey(current.x, current.y);
    regionMembers.push(currentKey);

    DIRECTIONS.forEach((direction) => {
      const delta = DIRECTION_DELTAS[direction];
      const x = current.x + delta.x;
      const y = current.y + delta.y;
      if (!floorHasCoordinate(project, state.floorId, x, y)) return;
      const locKey = coordinateKey(x, y);

      const changeFloor = (floor.changeFloor || {})[locKey];
      if (changeFloor) {
        const distance = current.distance + 1;
        const target = resolveChangeFloorTarget(project, state, changeFloor);
        const kind = changeFloor.floorId === ":next" ? "next" : changeFloor.floorId === ":before" ? "before" : "other";
        const record = {
          x,
          y,
          distance,
          changeFloor,
          kind,
          locKey,
          targetFloorId: target.floorId,
          targetX: target.x,
          targetY: target.y,
          preview: estimateTargetFloorOpportunity(project, state, battleResolver, target.floorId, target.x, target.y),
        };
        changeFloorFrontier.set(locKey, record);
        if (changeFloor.floorId === ":next") nextFloorFrontier.set(locKey, record);
        return;
      }

      const tile = getTileDefinitionAt(project, state, state.floorId, x, y);
      if (isEnemyTile(tile)) {
        const battle = evaluateBattleFrontier(project, state, battleResolver, state.floorId, x, y, tile);
        if (battle) {
          const record = {
            x,
            y,
            distance: current.distance + 1,
            enemyId: tile.id,
            damage: Number(battle.damageInfo.damage || 0),
          };
          battleFrontier.set(locKey, record);
          if (record.damage === 0) zeroDamageFrontier.set(locKey, record);
        }
        return;
      }

      if (!isRegionTraverseTile(project, state, state.floorId, x, y)) return;
      if (visited.has(locKey)) return;
      const node = { x, y, distance: current.distance + 1 };
      visited.set(locKey, node);
      queue.push(node);
    });
  }

  regionMembers.sort();
  const stairTargets = Array.from(changeFloorFrontier.values()).sort(compareTargetRecords);
  const preferredTarget = stairTargets[0] || null;
  const targetBandKey = preferredTarget
    ? `${preferredTarget.kind}:${preferredTarget.locKey}->${preferredTarget.targetFloorId}:${preferredTarget.targetX},${preferredTarget.targetY}:d${bucketDistance(preferredTarget.distance)}:o${bucketOpportunity(Number(((preferredTarget.preview || {}).score) || 0))}`
    : "none";
  const changeFloorTargets = {};
  changeFloorFrontier.forEach((record, locKey) => {
    changeFloorTargets[locKey] = {
      kind: record.kind,
      distance: record.distance,
      targetFloorId: record.targetFloorId,
      targetX: record.targetX,
      targetY: record.targetY,
      preview: record.preview,
    };
  });
  const features = {
    floorId: state.floorId,
    regionKey: `${state.floorId}:${regionMembers.join("|")}`,
    targetBandKey,
    regionSize: regionMembers.length,
    battleFrontierCount: battleFrontier.size,
    zeroDamageBattleCount: zeroDamageFrontier.size,
    changeFloorCount: changeFloorFrontier.size,
    nextFloorCount: nextFloorFrontier.size,
    bestChangeFloorOpportunity: changeFloorFrontier.size > 0
      ? Math.max(...Array.from(changeFloorFrontier.values()).map((item) => Number(((item.preview || {}).score) || 0)))
      : 0,
    bestNextFloorOpportunity: nextFloorFrontier.size > 0
      ? Math.max(...Array.from(nextFloorFrontier.values()).map((item) => Number(((item.preview || {}).score) || 0)))
      : 0,
    nearestChangeFloorDistance: changeFloorFrontier.size > 0
      ? Math.min(...Array.from(changeFloorFrontier.values()).map((item) => item.distance))
      : Number.POSITIVE_INFINITY,
    nearestNextFloorDistance: nextFloorFrontier.size > 0
      ? Math.min(...Array.from(nextFloorFrontier.values()).map((item) => item.distance))
      : Number.POSITIVE_INFINITY,
    adjacentChangeFloorCount: Array.from(changeFloorFrontier.values()).filter((item) => item.distance === 1).length,
    adjacentBattleCount: Array.from(battleFrontier.values()).filter((item) => item.distance === 1).length,
    changeFloorTargets,
    preferredChangeFloor: preferredTarget ? {
      kind: preferredTarget.kind,
      x: preferredTarget.x,
      y: preferredTarget.y,
      distance: preferredTarget.distance,
      targetFloorId: preferredTarget.targetFloorId,
      targetX: preferredTarget.targetX,
      targetY: preferredTarget.targetY,
      preview: preferredTarget.preview,
    } : null,
  };

  cache[cacheKey] = features;
  return features;
}

module.exports = {
  computeFrontierFeatures,
};
