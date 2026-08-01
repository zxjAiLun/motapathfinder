"use strict";

const { cloneState, ensureFloorState, removeTileAt } = require("./lib/state");
const { syncProgress } = require("./lib/progress");

const FLOOR_IDS = ["S1", "S2"];

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function makeFloor(id) {
  return {
    floorId: id,
    width: 3,
    height: 1,
    map: [[0, 0, 0]],
    changeFloor: {},
  };
}

function makeProject() {
  const project = {
    floorOrder: FLOOR_IDS.slice(),
    floorsById: {
      S1: makeFloor("S1"),
      S2: makeFloor("S2"),
    },
    mapTilesByNumber: {
      "0": { id: "empty", cls: "terrains", canPass: true },
      "2": { id: "attackCrystal", cls: "items", canPass: true },
      "3": { id: "survivor", cls: "enemy48", canPass: false },
      "4": { id: "target", cls: "enemy48", canPass: false },
    },
  };
  project.floorsById.S1.map[0][1] = 2;
  project.floorsById.S1.map[0][2] = 3;
  project.floorsById.S1.changeFloor["0,0"] = { floorId: "S2" };
  project.floorsById.S2.map[0][1] = 4;
  return project;
}

function makeInitialState(scenario) {
  const state = {
    floorId: "S1",
    hero: {
      loc: { x: 0, y: 0 },
      hp: 100,
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
  if (scenario === "present") removeTileAt(state, "S1", 1, 0);
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

class AdaptiveRepairSyntheticSimulator {
  constructor(scenario) {
    this.scenario = scenario;
    this.project = makeProject();
  }

  initialState() {
    return makeInitialState(this.scenario);
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
    if (this.scenario === "attack" && state.floorId === "S1" && !state.flags.attackPicked) {
      actions.push({
        kind: "pickup",
        summary: "pickup:attack-crystal@S1:1,0",
        floorId: "S1",
        x: 1,
        y: 0,
        estimate: { atkGain: 20 },
      });
    }
    if (this.scenario === "survivability") {
      actions.push({
        kind: "battle",
        summary: "battle:survivor@S1:2,0",
        floorId: "S1",
        x: 2,
        y: 0,
        enemyId: "survivor",
        estimate: { damage: 100, turn: 1 },
      });
    }
    if (this.scenario === "target") {
      if (state.floorId === "S1") {
        actions.push({
          kind: "changeFloor",
          summary: "changeFloor@S1:0,0",
          floorId: "S1",
          x: 0,
          y: 0,
          changeFloor: { floorId: "S2" },
          path: ["S1:0,0"],
        });
      } else if (state.floorId === "S2") {
        actions.push({
          kind: "battle",
          summary: "battle:target@S2:1,0",
          floorId: "S2",
          x: 1,
          y: 0,
          enemyId: "target",
          estimate: { damage: 20, turn: 1 },
        });
      }
    }
    return { actions };
  }

  applyAction(state, action) {
    const summary = action && action.summary;
    if (!summary) throw new Error("synthetic action requires summary");
    const next = appendAction(state, action);
    if (summary === "pickup:attack-crystal@S1:1,0") {
      next.flags.attackPicked = true;
      next.hero.atk += 20;
      removeTileAt(next, "S1", 1, 0);
    } else if (summary === "changeFloor@S1:0,0") {
      next.floorId = "S2";
      next.hero.loc = { x: 0, y: 0 };
      next.visitedFloors.S2 = true;
    } else if (summary === "battle:survivor@S1:2,0") {
      // The synthetic survivor action is deliberately non-progressing: the
      // repair window does not admit the HP resource that would be needed.
      next.hero.hp = Math.max(1, next.hero.hp);
    } else if (summary === "battle:target@S2:1,0") {
      next.flags.targetActionExecuted = true;
    } else {
      throw new Error(`unknown synthetic action: ${summary}`);
    }
    syncProgress(next);
    return next;
  }
}

function createSyntheticScenario(scenario) {
  const simulator = new AdaptiveRepairSyntheticSimulator(scenario);
  return { simulator, initialState: simulator.initialState() };
}

module.exports = {
  AdaptiveRepairSyntheticSimulator,
  FLOOR_IDS,
  createSyntheticScenario,
  makeInitialState,
  makeProject,
};
