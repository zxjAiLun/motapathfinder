"use strict";

const { cloneState, ensureFloorState, removeTileAt } = require("./lib/state");
const { syncProgress } = require("./lib/progress");

const FLOOR_IDS = ["S1", "S2"];

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function makeFloor(floorId, map) {
  return {
    floorId,
    width: map[0].length,
    height: map.length,
    map,
    changeFloor: {},
  };
}

function makeProject() {
  const project = {
    floorOrder: FLOOR_IDS.slice(),
    floorsById: {
      S1: makeFloor("S1", [[0, 2, 3, 4, 5, 6, 7, 8]]),
      S2: makeFloor("S2", [[0, 9]]),
    },
    mapTilesByNumber: {
      "0": { id: "empty", cls: "terrains", canPass: true },
      "2": { id: "attackCrystal", cls: "items", canPass: true },
      "3": { id: "trainingSword", cls: "items", canPass: true },
      "4": { id: "redPotion", cls: "items", canPass: true },
      "5": { id: "lowExpEnemy", cls: "enemy48", canPass: false },
      "6": { id: "lockedDoor", cls: "terrains", canPass: false },
      "7": { id: "deferredPotion", cls: "items", canPass: true },
      "8": { id: "deferredBlocker", cls: "enemy48", canPass: false },
      "9": { id: "targetEnemy", cls: "enemy48", canPass: false },
    },
    itemsById: {
      attackCrystal: { itemEffect: "core.status.hero.atk += 20;" },
      trainingSword: { itemEffect: "core.status.hero.atk += 15;" },
      redPotion: { itemEffect: "core.status.hero.hp += 60;" },
      deferredPotion: { itemEffect: "core.status.hero.hp += 200;" },
    },
    enemysById: {
      lowExpEnemy: { name: "low-exp training", exp: 100, damage: 3 },
      deferredBlocker: { name: "deferred blocker", exp: 0, damage: 30 },
      targetEnemy: { name: "target enemy", exp: 0, damage: 100 },
    },
    values: {},
  };
  return project;
}

function makeInitialState(scenario, options) {
  const config = options || {};
  const state = {
    floorId: "S1",
    hero: {
      loc: { x: 0, y: 0 },
      hp: scenario === "deferred-resource" ? 50 : 100,
      atk: 1,
      def: 10,
      mdef: 10,
      lv: 1,
      exp: 0,
      money: 0,
      equipment: [],
    },
    inventory: {},
    flags: {
      syntheticScenario: scenario,
      ...(config.flags || {}),
    },
    floorStates: {},
    visitedFloors: { S1: true },
    triggeredAutoEvents: {},
    route: [],
    notes: [],
    meta: {
      rank: null,
      decisionDepth: 0,
      autoStepCount: 0,
      autoPickupCount: 0,
      autoBattleCount: 0,
    },
  };
  ensureFloorState(state, "S1");
  ensureFloorState(state, "S2");
  syncProgress(state);
  return state;
}

function appendAction(state, action) {
  const next = cloneState(state);
  next.route = Array.isArray(next.route) ? next.route.concat(action.summary) : [action.summary];
  next.meta = {
    ...(next.meta || {}),
    decisionDepth: Number((next.meta || {}).decisionDepth || 0) + 1,
  };
  return next;
}

function tileAction(kind, summary, x, y, extra) {
  return {
    kind,
    summary,
    floorId: "S1",
    x,
    y,
    target: { x, y },
    ...(extra || {}),
  };
}

class ResourceIntentContractSyntheticSimulator {
  constructor(scenario) {
    this.scenario = scenario;
    this.project = makeProject();
    this.battleResolver = {
      evaluateBattle: (state, floorId, x, y, enemyId) => {
        const enemy = this.project.enemysById[enemyId];
        if (!enemy) return { supported: false, reason: `unknown enemy: ${enemyId}` };
        return {
          supported: true,
          enemy: { id: enemyId, ...enemy },
          enemyInfo: { exp: enemy.exp || 0, money: 0 },
          guards: [],
          damageInfo: {
            damage: Number(enemy.damage || 0),
            turn: 1,
          },
          state,
          floorId,
          x,
          y,
        };
      },
    };
  }

  initialState(options) {
    return makeInitialState(this.scenario, options);
  }

  buildReachableRegionSignature(state) {
    const flags = Object.keys(state.flags || {}).sort().map((key) => `${key}=${state.flags[key]}`);
    const removed = Object.keys((state.floorStates.S1 || {}).removed || {}).sort();
    return {
      regionKey: `${state.floorId}|${flags.join(",")}|removed=${removed.join(",")}`,
      reachableEndpointsKey: `${state.floorId}:0,0`,
    };
  }

  stabilizeState(state) {
    return cloneState(state);
  }

  isTerminal() {
    return false;
  }

  enumeratePrimitiveActions(state) {
    const actions = [];
    const scenario = this.scenario;
    if (scenario === "atk-pickup" && !state.flags.atkPicked) {
      actions.push(tileAction(
        "pickup",
        "pickup:attackCrystal@S1:1,0",
        1,
        0,
        { itemId: "attackCrystal", estimate: { atkGain: 20 } },
      ));
    } else if (scenario === "equipment" && !state.flags.equipmentPicked) {
      actions.push(tileAction(
        "equip",
        "equip:trainingSword@S1:2,0",
        2,
        0,
        { itemId: "trainingSword", estimate: { atkGain: 15 } },
      ));
    } else if (scenario === "hp-pickup" && !state.flags.hpPicked) {
      actions.push(tileAction(
        "pickup",
        "pickup:redPotion@S1:3,0",
        3,
        0,
        { itemId: "redPotion", estimate: { hpGain: 60 } },
      ));
    } else if ((scenario === "atk-levelup" || scenario === "hp-levelup") && !state.flags.levelupDone) {
      actions.push(tileAction(
        "battle",
        "battle:lowExpEnemy@S1:4,0",
        4,
        0,
        { enemyId: "lowExpEnemy", estimate: { damage: 3, exp: 100, turn: 1 } },
      ));
    } else if (scenario === "path-blocker") {
      if (!state.flags.doorOpened) {
        actions.push(tileAction(
          "openDoor",
          "openDoor:lockedDoor@S1:5,0",
          5,
          0,
          { estimate: { cost: 1 } },
        ));
      } else if (state.floorId === "S1") {
        actions.push({
          kind: "changeFloor",
          summary: "changeFloor:S1->S2",
          floorId: "S1",
          changeFloor: { floorId: "S2" },
          estimate: { cost: 1 },
        });
      } else if (!state.flags.targetActionExecuted) {
        actions.push(tileAction(
          "battle",
          "battle:targetEnemy@S2:1,0",
          1,
          0,
          { floorId: "S2", enemyId: "targetEnemy", estimate: { damage: 100, turn: 1 } },
        ));
      }
    } else if (scenario === "stable-order") {
      if (!state.flags.orderActionDone) {
        const high = state.flags.orderVariant === "high";
        actions.push(tileAction(
          "pickup",
          `pickup:${high ? "high" : "low"}AttackCrystal@S1:1,0`,
          1,
          0,
          { itemId: "attackCrystal", estimate: { atkGain: high ? 20 : 5 } },
        ));
      }
    }
    return { actions };
  }

  applyAction(state, action) {
    const summary = action && action.summary;
    if (!summary) throw new Error("synthetic action requires summary");
    const next = appendAction(state, action);
    if (summary === "pickup:attackCrystal@S1:1,0") {
      next.flags.atkPicked = true;
      next.hero.atk += 20;
      removeTileAt(next, "S1", 1, 0);
    } else if (summary === "equip:trainingSword@S1:2,0") {
      next.flags.equipmentPicked = true;
      next.hero.equipment = (next.hero.equipment || []).concat("trainingSword");
      next.hero.atk += 15;
      removeTileAt(next, "S1", 2, 0);
    } else if (summary === "pickup:redPotion@S1:3,0") {
      next.flags.hpPicked = true;
      next.hero.hp += 60;
      removeTileAt(next, "S1", 3, 0);
    } else if (summary === "battle:lowExpEnemy@S1:4,0") {
      next.flags.levelupDone = true;
      next.hero.hp = Math.max(1, next.hero.hp - 3);
      next.hero.exp += 100;
      next.hero.lv += 1;
      removeTileAt(next, "S1", 4, 0);
    } else if (summary === "openDoor:lockedDoor@S1:5,0") {
      next.flags.doorOpened = true;
      removeTileAt(next, "S1", 5, 0);
    } else if (summary === "changeFloor:S1->S2") {
      next.floorId = "S2";
      next.hero.loc = { x: 0, y: 0 };
      next.visitedFloors.S2 = true;
    } else if (summary === "battle:targetEnemy@S2:1,0") {
      next.flags.targetActionExecuted = true;
    } else if (summary === "pickup:highAttackCrystal@S1:1,0") {
      next.flags.orderActionDone = true;
      next.hero.atk += 20;
      removeTileAt(next, "S1", 1, 0);
    } else if (summary === "pickup:lowAttackCrystal@S1:1,0") {
      next.flags.orderActionDone = true;
      next.hero.atk += 5;
      removeTileAt(next, "S1", 1, 0);
    } else {
      throw new Error(`unknown synthetic action: ${summary}`);
    }
    syncProgress(next);
    return next;
  }
}

function createResourceIntentScenario(scenario) {
  const simulator = new ResourceIntentContractSyntheticSimulator(scenario);
  return {
    simulator,
    initialState: simulator.initialState(),
  };
}

module.exports = {
  FLOOR_IDS,
  ResourceIntentContractSyntheticSimulator,
  createResourceIntentScenario,
  makeInitialState,
  makeProject,
};
