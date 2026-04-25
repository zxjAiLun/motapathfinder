"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const { DIRECTIONS, DIRECTION_DELTAS, isEnemyTile } = require("./reachability");
const { executeActionList, runLevelUps } = require("./events");
const { cloneState, getTileDefinitionAt, removeTileAt } = require("./state");

function hasSpecial(special, test) {
  if (special == null) return false;
  if (Array.isArray(special)) return special.includes(test);
  if (typeof special === "number") return special === test;
  if (typeof special === "object" && special.special != null) return hasSpecial(special.special, test);
  return false;
}

function loadFunctionsRuntime(project) {
  const filePath = path.join(project.projectDir, "functions.js");
  const context = {};
  const code = fs.readFileSync(filePath, "utf8");
  vm.runInNewContext(code, context, { filename: filePath });

  const key = Object.keys(context).find((name) => name.startsWith("functions_"));
  if (!key) {
    throw new Error(`Unable to load generated functions object from ${filePath}`);
  }

  const materialEnemys = {};
  Object.entries(project.enemysById).forEach(([id, enemy]) => {
    materialEnemys[id] = { id, ...enemy };
  });

  const materialItems = {};
  Object.entries(project.itemsById).forEach(([id, item]) => {
    materialItems[id] = { id, ...item };
  });

  return {
    context,
    functions: context[key],
    materialEnemys,
    materialItems,
  };
}

function createFlagsProxy(flags) {
  return new Proxy(flags, {
    get(target, property) {
      return target[property];
    },
    set(target, property, value) {
      target[property] = value;
      return true;
    },
    deleteProperty(target, property) {
      delete target[property];
      return true;
    },
    has(target, property) {
      return property in target;
    },
  });
}

function createEvaluationState(state) {
  return {
    floorId: state.floorId,
    hero: cloneState(state.hero),
    inventory: cloneState(state.inventory),
    flags: cloneState(state.flags),
    floorStates: state.floorStates,
  };
}

function buildFloorBlocks(project, state, floorId) {
  const floor = project.floorsById[floorId];
  const blocks = [];

  for (let y = 0; y < floor.height; y += 1) {
    for (let x = 0; x < floor.width; x += 1) {
      const tile = getTileDefinitionAt(project, state, floorId, x, y);
      if (!tile) continue;
      blocks.push({
        x,
        y,
        disable: false,
        event: {
          id: tile.id,
          cls: tile.cls,
          trigger: tile.trigger,
        },
      });
    }
  }

  return blocks;
}

function resolveEnemy(materialEnemys, enemy) {
  if (enemy == null) return null;
  if (typeof enemy === "string") return materialEnemys[enemy] || null;
  if (enemy.id != null) return materialEnemys[enemy.id] || enemy;
  return enemy;
}

function getInventoryCount(inventory, itemId) {
  return Number(inventory[itemId] || 0);
}

function getBuffValue(state, name) {
  return Number(state.flags[`__${name}_buff__`] == null ? 1 : state.flags[`__${name}_buff__`]);
}

function buildCoreFacade(project, runtime, state) {
  const flagsProxy = createFlagsProxy(state.flags);
  const maps = {};
  const status = {
    floorId: state.floorId,
    hero: state.hero,
    maps,
    checkBlock: {
      needCache: true,
      cache: {},
    },
  };

  const core = {
    status,
    values: project.values || {},
    flags: { ...project.defaultFlags },
    floors: project.floorsById,
    material: {
      enemys: runtime.materialEnemys,
      items: runtime.materialItems,
      animates: {},
    },
    hasSpecial,
    hasItem(itemId) {
      return getInventoryCount(state.inventory, itemId) > 0;
    },
    itemCount(itemId) {
      return getInventoryCount(state.inventory, itemId);
    },
    hasEquip(itemId) {
      const equipment = Array.isArray(state.hero.equipment) ? state.hero.equipment : [];
      return equipment.includes(itemId);
    },
    getEquip(equipType) {
      const equipment = Array.isArray(state.hero.equipment) ? state.hero.equipment : [];
      return equipment[equipType] || null;
    },
    hasFlag(name) {
      return state.flags[name] != null;
    },
    getFlag(name, defaultValue) {
      return state.flags[name] != null ? state.flags[name] : defaultValue;
    },
    setFlag(name, value) {
      state.flags[name] = value;
      return value;
    },
    addFlag(name, delta) {
      const nextValue = Number(this.getFlag(name, 0)) + Number(delta || 0);
      state.flags[name] = nextValue;
      return nextValue;
    },
    removeFlag(name) {
      delete state.flags[name];
    },
    getStatusOrDefault(hero, key) {
      const source = hero || state.hero || {};
      const value = source[key];
      return Number(value == null ? 0 : value);
    },
    getRealStatusOrDefault(hero, key) {
      return Math.floor(this.getStatusOrDefault(hero, key) * getBuffValue(state, key));
    },
    getBuff(name) {
      return getBuffValue(state, name);
    },
    setBuff(name, value) {
      state.flags[`__${name}_buff__`] = Number(value);
    },
    addBuff(name, delta) {
      const nextValue = parseFloat((this.getBuff(name) + Number(delta || 0)).toFixed(3));
      state.flags[`__${name}_buff__`] = nextValue;
      return nextValue;
    },
    getEnemyValue(enemy, key) {
      const resolved = resolveEnemy(runtime.materialEnemys, enemy);
      if (!resolved) return null;
      return resolved[key];
    },
    extractBlocks(floorId) {
      const targetFloorId = floorId || state.floorId;
      if (!maps[targetFloorId]) maps[targetFloorId] = {};
      maps[targetFloorId].blocks = buildFloorBlocks(project, state, targetFloorId);
      return maps[targetFloorId].blocks;
    },
  };

  runtime.context.core = core;
  runtime.context.flags = flagsProxy;

  core.enemys = {
    hasSpecial,
    getEnemyInfo(enemy, hero, x, y, floorId) {
      runtime.context.core = core;
      runtime.context.flags = flagsProxy;
      return runtime.functions.enemys.getEnemyInfo(enemy, hero, x, y, floorId);
    },
    getDamageInfo(enemy, hero, x, y, floorId) {
      runtime.context.core = core;
      runtime.context.flags = flagsProxy;
      return runtime.functions.enemys.getDamageInfo(enemy, hero, x, y, floorId);
    },
  };

  return core;
}

function decrementTemporaryFlags(state) {
  ["s113", "s114", "s120", "s121", "s141", "s142", "s143", "s157"].forEach((flagName) => {
    if (Number(state.flags[flagName] || 0) <= 0) return;
    state.flags[flagName] = Number(state.flags[flagName]) - 1;
    if (state.flags[flagName] <= 0) delete state.flags[flagName];
  });
}

function sumGuardEnemyValue(project, guards, key) {
  return (guards || []).reduce((sum, guard) => {
    const enemy = project.enemysById[guard[2]] || {};
    return sum + Number(enemy[key] || 0);
  }, 0);
}

function applyAddPointReward(project, state, point) {
  const value = Number(point || 0);
  if (!project.defaultFlags.enableAddPoint || value <= 0) return;
  state.hero.atk = Number(state.hero.atk || 0) + value;
  state.notes.push(`Add-point modeled as default attack choice: atk +${value}`);
}

function applyBattleRewards(project, state, enemyInfo, guards) {
  let money = Number(enemyInfo.money || 0) + sumGuardEnemyValue(project, guards, "money");
  if (getInventoryCount(state.inventory, "coin") > 0) money *= 2;
  if (state.flags.curse) money = 0;
  if (getInventoryCount(state.inventory, "I1788") > 0) {
    money *= getInventoryCount(state.inventory, "I1788") + 1;
  }

  let exp = Number(enemyInfo.exp || 0) + sumGuardEnemyValue(project, guards, "exp");
  if (state.flags.curse) exp = 0;
  if (getInventoryCount(state.inventory, "I608") > 0) {
    exp *= getInventoryCount(state.inventory, "I608");
  }

  state.hero.money = Number(state.hero.money || 0) + Math.floor(money);
  state.hero.exp = Number(state.hero.exp || 0) + Math.floor(exp);

  if (!state.hero.statistics) state.hero.statistics = {};
  state.hero.statistics.money = Number(state.hero.statistics.money || 0) + Math.floor(money);
  state.hero.statistics.exp = Number(state.hero.statistics.exp || 0) + Math.floor(exp);

  applyAddPointReward(project, state, Number(enemyInfo.point || 0) + sumGuardEnemyValue(project, guards, "point"));
}

class UnsupportedBattleResolver {
  enumerateActions() {
    return [];
  }

  applyBattleAt() {
    throw new Error("Battle resolver is not configured.");
  }

  applyAction() {
    throw new Error("Battle resolver is not configured.");
  }

  describeGap(project, state) {
    return `Battle simulation is not wired for floor ${state.floorId}. Plug an engine-backed resolver into StaticSimulator to search through enemies.`;
  }
}

class FunctionBackedBattleResolver {
  constructor(project, options) {
    this.project = project;
    this.autoLevelUp = !options || options.autoLevelUp !== false;
    this.runtime = loadFunctionsRuntime(project);
  }

  evaluateBattle(state, floorId, x, y, enemyId) {
    const evaluationState = createEvaluationState(state);
    const core = buildCoreFacade(this.project, this.runtime, evaluationState);
    const enemy = this.runtime.materialEnemys[enemyId];
    if (!enemy) {
      return {
        supported: false,
        reason: `Unknown enemy: ${enemyId}`,
      };
    }

    try {
      const enemyInfo = core.enemys.getEnemyInfo(enemy, null, x, y, floorId);
      const guards = Array.isArray(enemyInfo.guards) ? enemyInfo.guards.slice() : [];
      const damageInfo = core.enemys.getDamageInfo(enemy, null, x, y, floorId);
      return {
        supported: true,
        enemy,
        enemyInfo,
        guards,
        damageInfo,
      };
    } catch (error) {
      return {
        supported: false,
        reason: error && error.message ? error.message : String(error),
      };
    }
  }

  enumerateActions(context) {
    const { reachability } = context;
    const actionsByKey = new Map();

    Object.values(reachability.visited).forEach((node) => {
      DIRECTIONS.forEach((direction) => {
        const delta = DIRECTION_DELTAS[direction];
        const targetX = node.x + delta.x;
        const targetY = node.y + delta.y;
        const tile = getTileDefinitionAt(this.project, node.state, node.state.floorId, targetX, targetY);
        if (!isEnemyTile(tile)) return;

        const battle = this.evaluateBattle(node.state, node.state.floorId, targetX, targetY, tile.id);
        if (!battle.supported) return;
        if (!battle.damageInfo || battle.damageInfo.damage == null) return;
        if (battle.damageInfo.damage >= Number(node.state.hero.hp || 0)) return;
        const action = {
          kind: "battle",
          floorId: node.state.floorId,
          stance: { x: node.x, y: node.y },
          direction,
          target: { x: targetX, y: targetY },
          enemyId: tile.id,
          path: node.path,
          travelState: node.state,
          estimate: {
            damage: battle.damageInfo.damage,
            turn: battle.damageInfo.turn,
            money: Number(battle.enemyInfo.money || 0) + sumGuardEnemyValue(this.project, battle.guards, "money"),
            exp: Number(battle.enemyInfo.exp || 0) + sumGuardEnemyValue(this.project, battle.guards, "exp"),
            guards: (battle.guards || []).length,
          },
          summary: `battle:${tile.id}@${node.state.floorId}:${targetX},${targetY}`,
        };

        const key = `${targetX},${targetY}:battle:${node.path.join(",")}:${node.state.hero.hp}`;
        const existing = actionsByKey.get(key);
        if (!existing || existing.path.length > action.path.length) {
          actionsByKey.set(key, action);
        }
      });
    });

    return Array.from(actionsByKey.values());
  }

  applyBattleAt(context) {
    const { project, state, floorId, x, y, enemyId, executeActionList: executeActionListFn, choiceResolver } = context;
    const resolvedFloorId = floorId || state.floorId;
    const battle = this.evaluateBattle(state, resolvedFloorId, x, y, enemyId);
    if (!battle.supported) {
      throw new Error(battle.reason || `Unsupported battle at ${resolvedFloorId}:${x},${y}`);
    }
    if (!battle.damageInfo || battle.damageInfo.damage == null) {
      throw new Error(`Enemy ${enemyId} is currently unbeatable.`);
    }

    const damage = Number(battle.damageInfo.damage || 0);
    if (damage >= Number(state.hero.hp || 0)) {
      throw new Error(`Battle against ${enemyId} would be lethal.`);
    }

    state.hero.hp = Number(state.hero.hp || 0) - damage;
    if (!state.hero.statistics) state.hero.statistics = {};
    state.hero.statistics.battleDamage = Number(state.hero.statistics.battleDamage || 0) + damage;
    state.hero.statistics.battle = Number(state.hero.statistics.battle || 0) + 1;

    applyBattleRewards(project, state, battle.enemyInfo, battle.guards);
    if (context.autoLevelUp !== false && this.autoLevelUp !== false) {
      runLevelUps(project, state, { choiceResolver });
    }

    if (hasSpecial(battle.enemy.special, 17)) {
      state.flags.hatred = Math.floor(Number(state.flags.hatred || 0) / 2);
    }
    if (Number(project.values.hatred || 0) !== 0) {
      state.flags.hatred = Number(state.flags.hatred || 0) + Number(project.values.hatred || 0);
    }

    decrementTemporaryFlags(state);
    (battle.guards || []).forEach((guard) => {
      removeTileAt(state, resolvedFloorId, guard[0], guard[1]);
    });
    removeTileAt(state, resolvedFloorId, x, y);

    const floor = project.floorsById[resolvedFloorId];
    const floorAfterBattle = (floor.afterBattle || {})[`${x},${y}`];
    if (floorAfterBattle) {
      (executeActionListFn || executeActionList)(
        project,
        state,
        floorAfterBattle,
        { floorId: resolvedFloorId, eventLoc: { x, y } },
        { choiceResolver }
      );
    }

    if (Array.isArray(battle.enemy.afterBattle) && battle.enemy.afterBattle.length > 0) {
      (executeActionListFn || executeActionList)(
        project,
        state,
        battle.enemy.afterBattle,
        { floorId: resolvedFloorId, eventLoc: { x, y } },
        { choiceResolver }
      );
    }
  }

  applyAction(context) {
    const { project, state, action, executeActionList, choiceResolver } = context;
    this.applyBattleAt({
      project,
      state,
      floorId: state.floorId,
      x: action.target.x,
      y: action.target.y,
      enemyId: action.enemyId,
      executeActionList,
      choiceResolver,
    });
  }
}

module.exports = {
  FunctionBackedBattleResolver,
  UnsupportedBattleResolver,
};
