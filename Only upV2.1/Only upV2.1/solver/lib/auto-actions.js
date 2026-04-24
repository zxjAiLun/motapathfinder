"use strict";

const { runAutoEvents } = require("./events");
const { buildMovementHazards } = require("./movement-hazards");
const { DIRECTIONS, DIRECTION_DELTAS, coordinateKey, isDoorTile, isEnemyTile } = require("./reachability");
const { appendRouteStep, floorHasCoordinate, getTileDefinitionAt } = require("./state");

const AUTO_BATTLE_BLOCKED_SPECIALS = [
  25, 18, 85, 86, 88, 113, 114, 120, 121, 115, 116, 126, 89, 70, 67,
  141, 142, 143, 145, 146, 153, 154, 156, 157, 158, 159, 26, 81,
];

function hasSpecial(special, test) {
  if (special == null) return false;
  if (Array.isArray(special)) return special.includes(test);
  if (typeof special === "number") return special === test;
  if (typeof special === "object" && special.special != null) return hasSpecial(special.special, test);
  return false;
}

function hasAnySpecial(enemy, specials) {
  const target = enemy || {};
  return specials.some((special) => hasSpecial(target.special, special));
}

function hasHazardAt(hazards, x, y, options) {
  const key = coordinateKey(x, y);
  const flags = options || {};
  const damage = Number(hazards.damage[key] || 0);
  if (flags.damage !== false && damage > 0) return true;
  if (flags.repulse !== false && Array.isArray(hazards.repulse[key]) && hazards.repulse[key].length > 0) return true;
  if (flags.ambush !== false && Array.isArray(hazards.ambush[key]) && hazards.ambush[key].length > 0) return true;
  return false;
}

function isAutoTraverseTile(project, state, floorId, x, y) {
  if (!floorHasCoordinate(project, floorId, x, y)) return false;
  const floor = project.floorsById[floorId];
  if ((floor.changeFloor || {})[coordinateKey(x, y)]) return false;

  const tile = getTileDefinitionAt(project, state, floorId, x, y);
  if (tile == null) return true;
  if (isEnemyTile(tile)) return false;
  if (isDoorTile(tile)) return false;
  if (tile.cls === "items") return true;
  if (tile.trigger != null && tile.trigger !== "null" && tile.trigger !== "passNet") return false;
  return tile.canPass === true;
}

function isAutoPickupTile(tile) {
  return tile != null && tile.cls === "items" && (tile.trigger == null || tile.trigger === "getItem");
}

function isAutoBattleTile(tile) {
  return isEnemyTile(tile) && (tile.trigger == null || tile.trigger === "battle");
}

function collectTargets(project, state, options) {
  const queue = [{ x: state.hero.loc.x, y: state.hero.loc.y, distance: 0 }];
  const visited = new Set([coordinateKey(state.hero.loc.x, state.hero.loc.y)]);
  const targets = [];

  while (queue.length > 0) {
    const current = queue.shift();

    DIRECTIONS.forEach((direction) => {
      const delta = DIRECTION_DELTAS[direction];
      const x = current.x + delta.x;
      const y = current.y + delta.y;
      const key = coordinateKey(x, y);
      if (visited.has(key)) return;
      if (!floorHasCoordinate(project, state.floorId, x, y)) return;

      const tile = getTileDefinitionAt(project, state, state.floorId, x, y);
      const target = options.evaluateTarget(project, state, tile, x, y);
      if (target) {
        targets.push({
          ...target,
          x,
          y,
          distance: current.distance + 1,
          approach: direction,
        });
        if (target.continuePast === true) {
          visited.add(key);
          queue.push({ x, y, distance: current.distance + 1 });
        }
        return;
      }

      if (!isAutoTraverseTile(project, state, state.floorId, x, y)) return;
      visited.add(key);
      queue.push({ x, y, distance: current.distance + 1 });
    });
  }

  return targets;
}

function collectNearTargets(project, state, options) {
  const targets = [];
  DIRECTIONS.forEach((direction) => {
    const delta = DIRECTION_DELTAS[direction];
    const x = state.hero.loc.x + delta.x;
    const y = state.hero.loc.y + delta.y;
    if (!floorHasCoordinate(project, state.floorId, x, y)) return;
    const tile = getTileDefinitionAt(project, state, state.floorId, x, y);
    const target = options.evaluateTarget(project, state, tile, x, y);
    if (!target) return;
    targets.push({
      ...target,
      x,
      y,
      distance: 1,
      approach: direction,
    });
  });
  return targets;
}

class AutoActionResolver {
  constructor(options) {
    const config = options || {};
    this.autoPickupEnabled = config.autoPickupEnabled !== false;
    this.autoBattleEnabled = config.autoBattleEnabled !== false;
    this.repeatUntilStable = config.repeatUntilStable === true;
    this.maxPasses = Number(config.maxPasses || 256);
  }

  initializeFlags(state) {
    state.flags.shiqu = this.autoPickupEnabled ? 1 : 0;
    state.flags.autoBattle = this.autoBattleEnabled ? 1 : 0;
  }

  canAutoPickup(state) {
    return this.autoPickupEnabled && Number(state.flags.shiqu == null ? 1 : state.flags.shiqu) !== 0;
  }

  canAutoBattle(state) {
    return this.autoBattleEnabled && Number(state.flags.autoBattle == null ? 1 : state.flags.autoBattle) !== 0;
  }

  buildHazards(project, state, battleResolver) {
    return buildMovementHazards(project, state, {
      floorId: state.floorId,
      battleResolver,
    });
  }

  evaluateAutoBattleTarget(project, state, battleResolver, hazards, tile, x, y) {
    if (!isAutoBattleTile(tile)) return null;
    const enemy = project.enemysById[tile.id];
    if (hasAnySpecial(enemy, AUTO_BATTLE_BLOCKED_SPECIALS)) return null;
    if (!battleResolver || typeof battleResolver.evaluateBattle !== "function") return null;

    const battle = battleResolver.evaluateBattle(state, state.floorId, x, y, tile.id);
    if (!battle.supported || !battle.damageInfo || battle.damageInfo.damage == null) return null;
    if (Number(battle.damageInfo.damage || 0) !== 0) return null;

    return {
      enemyId: tile.id,
      continuePast: !hasHazardAt(hazards, x, y, { damage: true, repulse: true, ambush: true }),
    };
  }

  collectAutoPickupTargets(project, state, battleResolver) {
    const hazards = this.buildHazards(project, state, battleResolver);
    if (hasHazardAt(hazards, state.hero.loc.x, state.hero.loc.y, { damage: true, repulse: true, ambush: true })) {
      return [];
    }

    return collectTargets(project, state, {
      evaluateTarget: (_, __, tile, x, y) => {
        if (!isAutoPickupTile(tile)) return null;
        return {
          itemId: tile.id,
          continuePast: !hasHazardAt(hazards, x, y, { damage: true, repulse: false, ambush: true }),
        };
      },
    });
  }

  collectAutoBattleTargets(project, state, battleResolver) {
    const hazards = this.buildHazards(project, state, battleResolver);
    const nearOnly = hasHazardAt(hazards, state.hero.loc.x, state.hero.loc.y, { damage: true, repulse: true, ambush: true });
    const collector = nearOnly ? collectNearTargets : collectTargets;

    return collector(project, state, {
      evaluateTarget: (currentProject, currentState, tile, x, y) =>
        this.evaluateAutoBattleTarget(currentProject, currentState, battleResolver, hazards, tile, x, y),
    });
  }

  runAutoPickupPass(context) {
    const { project, state, battleResolver, resolvePickupAt, choiceResolver } = context;
    if (!this.canAutoPickup(state)) return false;

    const targets = this.collectAutoPickupTargets(project, state, battleResolver);
    if (targets.length === 0) return false;

    let changed = false;
    for (const target of targets) {
      if (state.floorId == null || state.hero.hp <= 0) break;
      const tile = getTileDefinitionAt(project, state, state.floorId, target.x, target.y);
      if (!isAutoPickupTile(tile)) continue;
      resolvePickupAt(state, target.x, target.y);
      appendRouteStep(state, `auto:pickup:${tile.id}@${state.floorId}:${target.x},${target.y}`, {
        decision: false,
        auto: "pickup",
      });
      runAutoEvents(project, state, { choiceResolver });
      changed = true;
    }
    return changed;
  }

  runAutoBattlePass(context) {
    const { project, state, battleResolver, executeActionList, choiceResolver } = context;
    if (!this.canAutoBattle(state)) return false;
    if (!battleResolver || typeof battleResolver.applyBattleAt !== "function") return false;

    const targets = this.collectAutoBattleTargets(project, state, battleResolver);
    if (targets.length === 0) return false;

    let changed = false;
    for (const target of targets) {
      if (state.floorId == null || state.hero.hp <= 0) break;
      const tile = getTileDefinitionAt(project, state, state.floorId, target.x, target.y);
      if (!isAutoBattleTile(tile)) continue;

      const verified = this.evaluateAutoBattleTarget(project, state, battleResolver, this.buildHazards(project, state, battleResolver), tile, target.x, target.y);
      if (!verified) continue;

      battleResolver.applyBattleAt({
        project,
        state,
        floorId: state.floorId,
        x: target.x,
        y: target.y,
        enemyId: tile.id,
        executeActionList,
        choiceResolver,
      });
      appendRouteStep(state, `auto:battle:${tile.id}@${state.floorId}:${target.x},${target.y}`, {
        decision: false,
        auto: "battle",
      });
      runAutoEvents(project, state, { choiceResolver });
      changed = true;
    }
    return changed;
  }

  stabilizeState(context) {
    const { state } = context;
    if (!this.repeatUntilStable) {
      this.runAutoPickupPass(context);
      if (state.floorId == null || state.hero.hp <= 0) return state;
      this.runAutoBattlePass(context);
      return state;
    }

    let passes = 0;
    while (passes < this.maxPasses) {
      let changed = false;
      changed = this.runAutoPickupPass(context) || changed;
      if (state.floorId == null || state.hero.hp <= 0) return state;
      changed = this.runAutoBattlePass(context) || changed;
      if (!changed) return state;
      passes += 1;
    }
    state.notes.push(`Auto action pass limit (${this.maxPasses}) reached at ${state.floorId}.`);
    return state;
  }
}

module.exports = {
  AUTO_BATTLE_BLOCKED_SPECIALS,
  AutoActionResolver,
};
