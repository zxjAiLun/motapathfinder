"use strict";

const { coordinateKey, isEnemyTile } = require("./reachability");
const { floorHasCoordinate, forEachMaterializedFloorTile, getTileDefinitionAt, hasItem } = require("./state");
const { getActivePerfTracker } = require("./perf");

const SCAN4 = {
  up: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

const SCAN8 = {
  ...SCAN4,
  leftup: { x: -1, y: -1 },
  rightup: { x: 1, y: -1 },
  leftdown: { x: -1, y: 1 },
  rightdown: { x: 1, y: 1 },
};

function hasSpecial(special, test) {
  if (special == null) return false;
  if (Array.isArray(special)) return special.includes(test);
  if (typeof special === "number") return special === test;
  if (typeof special === "object" && special.special != null) return hasSpecial(special.special, test);
  return false;
}

function addDamage(damage, type, loc, value, label) {
  if (!value) return;
  damage[loc] = Number(damage[loc] || 0) + Number(value);
  type[loc] = type[loc] || {};
  type[loc][label] = true;
}

function buildBlockIndex(project, state, floorId, perfTracker, options = {}) {
  const blocks = {};
  const useFastPath = options.enableFastHazardBlockIndex !== false;

  if (useFastPath) {
    if (perfTracker && typeof perfTracker.increment === "function") {
      const floor = project.floorsById[floorId];
      if (floor) {
        perfTracker.increment("hazardCellsScanned", floor.width * floor.height);
      }
    }

    forEachMaterializedFloorTile(project, state, floorId, (tile, x, y, locKey) => {
      if (perfTracker && typeof perfTracker.increment === "function") {
        perfTracker.increment("hazardBlocksMaterialized", 1);
      }
      blocks[locKey] = {
        x,
        y,
        id: tile.id,
        tile,
      };
    });
    return blocks;
  }

  const floor = project.floorsById[floorId];
  for (let y = 0; y < floor.height; y += 1) {
    for (let x = 0; x < floor.width; x += 1) {
      if (perfTracker && typeof perfTracker.increment === "function") {
        perfTracker.increment("hazardCellsScanned", 1);
      }
      const tile = getTileDefinitionAt(project, state, floorId, x, y);
      if (!tile) continue;
      if (perfTracker && typeof perfTracker.increment === "function") {
        perfTracker.increment("hazardBlocksMaterialized", 1);
      }
      blocks[coordinateKey(x, y)] = {
        x,
        y,
        id: tile.id,
        tile,
      };
    }
  }

  return blocks;
}

function getEnemyId(block) {
  if (!block || !block.tile || !isEnemyTile(block.tile)) return null;
  return block.id;
}

function getEnemyDefinition(project, enemyId) {
  if (enemyId == null) return null;
  return project.enemysById[enemyId] || null;
}

function getScan(zoneSquare) {
  return zoneSquare ? SCAN8 : SCAN4;
}

function canMoveBetween(project, state, floorId, x, y, delta, perfTracker) {
  const targetX = x + delta.x;
  const targetY = y + delta.y;
  if (!floorHasCoordinate(project, floorId, targetX, targetY)) return false;

  if (perfTracker && typeof perfTracker.increment === "function") {
    perfTracker.increment("hazardSecondaryTileLookups", 1);
  }
  const tile = getTileDefinitionAt(project, state, floorId, targetX, targetY);
  if (tile == null) return true;
  if (isEnemyTile(tile)) return false;
  if (tile.trigger === "openDoor") return false;
  if (tile.cls === "items") return true;
  return tile.canPass === true;
}

function reverseDirection(direction) {
  switch (direction) {
    case "up":
      return "down";
    case "down":
      return "up";
    case "left":
      return "right";
    case "right":
      return "left";
    case "leftup":
      return "rightdown";
    case "rightup":
      return "leftdown";
    case "leftdown":
      return "rightup";
    case "rightdown":
      return "leftup";
    default:
      return direction;
  }
}

function buildMovementHazards(project, state, options) {
  const config = options || {};
  const perfTracker = config.perfTracker || getActivePerfTracker();
  const floorId = config.floorId || state.floorId;
  const floor = project.floorsById[floorId];

  let blocks;
  if (perfTracker && typeof perfTracker.timeStabilizationSubphase === "function") {
    perfTracker.increment("hazardBlockIndexCalls", 1);
    blocks = perfTracker.timeStabilizationSubphase("hazardBlockIndex", () => buildBlockIndex(project, state, floorId, perfTracker, config));
  } else {
    blocks = buildBlockIndex(project, state, floorId, perfTracker, config);
  }

  const damage = {};
  const type = {};
  const repulse = {};
  const ambush = {};
  const betweenAttackLocs = {};
  const battleResolver = config.battleResolver;

  const runSpecialScan = () => {
    for (const loc in blocks) {
      const block = blocks[loc];
      const { x, y, id, tile } = block;
      type[loc] = type[loc] || {};

      if (id === "lavaNet" && !hasItem(state, "amulet")) {
        addDamage(damage, type, loc, project.values.lavaDamage, `${tile.name || "lavaNet"}Damage`);
      }

      if (!isEnemyTile(tile)) continue;
      const enemy = project.enemysById[id];
      if (!enemy || !enemy.special) continue;

      if (hasSpecial(enemy.special, 15) && !state.flags.no_zone) {
        if (perfTracker && typeof perfTracker.increment === "function") {
          perfTracker.increment("hazardZoneEnemies", 1);
        }
        const range = enemy.range || 1;
        const zoneSquare = enemy.zoneSquare === true;
        for (let dx = -range; dx <= range; dx += 1) {
          for (let dy = -range; dy <= range; dy += 1) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (!floorHasCoordinate(project, floorId, nx, ny)) continue;
            if (!zoneSquare && Math.abs(dx) + Math.abs(dy) > range) continue;
            addDamage(damage, type, coordinateKey(nx, ny), enemy.value || 0, "zoneDamage");
          }
        }
      }

      if (hasSpecial(enemy.special, 18) && !state.flags.no_repulse) {
        if (perfTracker && typeof perfTracker.increment === "function") {
          perfTracker.increment("hazardRepulseEnemies", 1);
        }
        const scan = getScan(enemy.zoneSquare === true);
        Object.entries(scan).forEach(([direction, delta]) => {
          const nx = x + delta.x;
          const ny = y + delta.y;
          if (!floorHasCoordinate(project, floorId, nx, ny)) return;

          const currLoc = coordinateKey(nx, ny);
          addDamage(damage, type, currLoc, enemy.zuji || 0, "repulseDamage");

          const backward = reverseDirection(direction);
          const nextDelta = scan[backward];
          if (!nextDelta) return;
          const rnx = x + nextDelta.x;
          const rny = y + nextDelta.y;
          if (!floorHasCoordinate(project, floorId, rnx, rny)) return;
          if (perfTracker && typeof perfTracker.increment === "function") {
            perfTracker.increment("hazardSecondaryTileLookups", 1);
          }
          if (getTileDefinitionAt(project, state, floorId, rnx, rny) != null) return;
          if (SCAN4[backward] && !canMoveBetween(project, state, floorId, x, y, nextDelta, perfTracker)) return;
          repulse[currLoc] = (repulse[currLoc] || []).concat([[x, y, id, backward, rnx, rny]]);
        });
      }

      if (hasSpecial(enemy.special, 24) && !state.flags.no_laser) {
        if (perfTracker && typeof perfTracker.increment === "function") {
          perfTracker.increment("hazardLaserEnemies", 1);
        }
        for (let nx = 0; nx < floor.width; nx += 1) {
          if (nx === x) continue;
          addDamage(damage, type, coordinateKey(nx, y), enemy.value || 0, "laserDamage");
        }
        for (let ny = 0; ny < floor.height; ny += 1) {
          if (ny === y) continue;
          addDamage(damage, type, coordinateKey(x, ny), enemy.value || 0, "laserDamage");
        }
      }

      if (hasSpecial(enemy.special, 27) && !state.flags.no_ambush) {
        if (perfTracker && typeof perfTracker.increment === "function") {
          perfTracker.increment("hazardAmbushEnemies", 1);
        }
        const scan = getScan(enemy.zoneSquare === true);
        Object.entries(scan).forEach(([direction, delta]) => {
          const nx = x + delta.x;
          const ny = y + delta.y;
          if (!floorHasCoordinate(project, floorId, nx, ny)) return;
          if (SCAN4[direction] && !canMoveBetween(project, state, floorId, x, y, delta, perfTracker)) return;

          const currLoc = coordinateKey(nx, ny);
          ambush[currLoc] = (ambush[currLoc] || []).concat([[x, y, id, direction]]);
        });
      }

      if (hasSpecial(enemy.special, 16) && !state.flags.no_betweenAttack) {
        if (perfTracker && typeof perfTracker.increment === "function") {
          perfTracker.increment("hazardBetweenAttackEnemies", 1);
        }
        Object.values(SCAN4).forEach((delta) => {
          const nx = x + delta.x;
          const ny = y + delta.y;
          if (!floorHasCoordinate(project, floorId, nx, ny)) return;
          betweenAttackLocs[coordinateKey(nx, ny)] = true;
        });
      }
    }
  };

  if (perfTracker && typeof perfTracker.timeStabilizationSubphase === "function") {
    perfTracker.timeStabilizationSubphase("hazardSpecialScan", runSpecialScan);
  } else {
    runSpecialScan();
  }

  const runBetweenAttack = () => {
    Object.keys(betweenAttackLocs).forEach((loc) => {
      const [x, y] = loc.split(",").map(Number);
      let enemyId1 = null;
      let enemyId2 = null;
      let enemyLoc1 = null;
      let enemyLoc2 = null;

      const leftBlock = blocks[coordinateKey(x - 1, y)];
      const rightBlock = blocks[coordinateKey(x + 1, y)];
      const leftId = getEnemyId(leftBlock);
      const rightId = getEnemyId(rightBlock);
      const leftEnemy = getEnemyDefinition(project, leftId);
      if (leftBlock && rightBlock && leftId != null && leftId === rightId && hasSpecial(leftEnemy && leftEnemy.special, 16)) {
        enemyId1 = leftId;
        enemyLoc1 = { x: leftBlock.x, y: leftBlock.y };
      }

      const topBlock = blocks[coordinateKey(x, y - 1)];
      const bottomBlock = blocks[coordinateKey(x, y + 1)];
      const topId = getEnemyId(topBlock);
      const bottomId = getEnemyId(bottomBlock);
      const topEnemy = getEnemyDefinition(project, topId);
      if (topBlock && bottomBlock && topId != null && topId === bottomId && hasSpecial(topEnemy && topEnemy.special, 16)) {
        enemyId2 = topId;
        enemyLoc2 = { x: topBlock.x, y: topBlock.y };
      }

      if (enemyId1 == null && enemyId2 == null) return;

      const leftHp = Number(state.hero.hp || 0) - Number(damage[loc] || 0);
      if (leftHp <= 1) return;

      let value = Math.floor(leftHp / 2);
      if (project.defaultFlags.betweenAttackMax && battleResolver && typeof battleResolver.evaluateBattle === "function") {
        [
          enemyId1 && enemyLoc1 ? { enemyId: enemyId1, enemyLoc: enemyLoc1 } : null,
          enemyId2 && enemyLoc2 ? { enemyId: enemyId2, enemyLoc: enemyLoc2 } : null,
        ]
          .filter(Boolean)
          .forEach(({ enemyId, enemyLoc }) => {
            let battle;
            if (perfTracker && typeof perfTracker.timeStabilizationSubphase === "function") {
              perfTracker.increment("hazardBetweenAttackBattleEvalCalls", 1);
              battle = perfTracker.timeStabilizationSubphase("hazardBetweenAttackBattleEval", () =>
                battleResolver.evaluateBattle(state, floorId, enemyLoc.x, enemyLoc.y, enemyId)
              );
            } else {
              battle = battleResolver.evaluateBattle(state, floorId, enemyLoc.x, enemyLoc.y, enemyId);
            }
            const enemyDamage = battle && battle.supported && battle.damageInfo ? battle.damageInfo.damage : null;
            if (enemyDamage != null && enemyDamage < value) value = enemyDamage;
          });
      }

      if (value > 0) addDamage(damage, type, loc, value, "betweenAttackDamage");
    });
  };

  if (perfTracker && typeof perfTracker.timeStabilizationSubphase === "function") {
    perfTracker.timeStabilizationSubphase("hazardBetweenAttack", runBetweenAttack);
  } else {
    runBetweenAttack();
  }

  return {
    damage,
    type,
    repulse,
    ambush,
    betweenAttackLocs,
  };
}

module.exports = {
  buildMovementHazards,
};
