"use strict";

const { getProgress } = require("./progress");
const { getFloorOrder } = require("./score");

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function previousFloorId(project, floorId) {
  const index = project.floorOrder.indexOf(floorId);
  if (index <= 0) return null;
  return project.floorOrder[index - 1];
}

function nextFloorId(project, floorId) {
  const index = project.floorOrder.indexOf(floorId);
  if (index < 0 || index >= project.floorOrder.length - 1) return null;
  return project.floorOrder[index + 1];
}

function isForwardChangeFloorAction(state, action) {
  if (!action || action.kind !== "changeFloor") return false;
  const targetFloorId = action.changeFloor && action.changeFloor.floorId;
  if (targetFloorId === ":next") return true;
  if (!targetFloorId || targetFloorId === ":before") return false;
  return getFloorOrder(targetFloorId) > getFloorOrder(state.floorId);
}

function defaultMinHeroForEdge(edge, state) {
  if (edge === "MT1->MT2") {
    return { hp: 1559, atk: 17, def: 8, mdef: 130 };
  }
  const hero = state.hero || {};
  return {
    hp: Math.max(1, number(hero.hp, 0)),
    atk: number(hero.atk, 0),
    def: number(hero.def, 0),
    mdef: number(hero.mdef, 0),
  };
}

function makeRecommendedRepair(project, state, blockerType, deficits) {
  const before = previousFloorId(project, state.floorId);
  if (!before) return null;
  const edge = `${before}->${state.floorId}`;
  const minHero = defaultMinHeroForEdge(edge, state);
  if (deficits && deficits.hp > 0) minHero.hp = Math.max(minHero.hp, number((state.hero || {}).hp, 0) + number(deficits.hp, 0));
  return {
    fromEdge: edge,
    preferTags: blockerType === "hp-deficit" ? ["highest-hp", "best-scout"] : ["best-scout", "highest-combat"],
    minHero,
  };
}

function analyzeProgressBlocker(simulator, state, options) {
  if (!state) return null;
  const project = simulator.project;
  const progress = getProgress(state);
  let actions = [];
  const examples = { lethalBattle: null, missingDoor: null, unsupportedAction: null };
  try {
    actions = simulator.enumeratePrimitiveActions(state).actions || [];
  } catch (error) {
    return {
      floorId: state.floorId,
      stageIndex: progress.stageIndex,
      nextForwardTarget: null,
      blockerType: "unsupported-rule",
      deficits: { hp: 0, atk: 0, def: 0, mdef: 0, expToLevel: 0, yellowKey: 0, blueKey: 0 },
      recommendedRepair: makeRecommendedRepair(project, state, "unsupported-rule", {}),
      examples: { ...examples, unsupportedAction: error.message },
    };
  }

  const forwardChangeFloors = actions.filter((action) => isForwardChangeFloorAction(state, action));
  const battles = actions.filter((action) => action.kind === "battle");
  const doors = actions.filter((action) => action.kind === "openDoor");
  const unsupported = actions.find((action) => action.unsupported || action.kind === "unsupportedEvent");
  const nextFloor = nextFloorId(project, state.floorId);
  const nextForwardTarget = forwardChangeFloors[0]
    ? {
        kind: "changeFloor",
        floorId: state.floorId,
        x: forwardChangeFloors[0].x,
        y: forwardChangeFloors[0].y,
        targetFloorId: nextFloor || ((forwardChangeFloors[0].changeFloor || {}).floorId),
      }
    : null;

  let blockerType = "unknown";
  const deficits = { hp: 0, atk: 0, def: 0, mdef: 0, expToLevel: 0, yellowKey: 0, blueKey: 0 };

  if (forwardChangeFloors.length > 0) {
    blockerType = "unknown";
  } else if (battles.length > 0) {
    const heroHp = number((state.hero || {}).hp, 0);
    const maxDamage = Math.max(...battles.map((action) => number((action.estimate || {}).damage, 0)));
    if (maxDamage >= heroHp) {
      blockerType = "hp-deficit";
      deficits.hp = Math.max(1, maxDamage + 1 - heroHp);
      examples.lethalBattle = battles
        .slice()
        .sort((left, right) => number((left.estimate || {}).damage, 0) - number((right.estimate || {}).damage, 0))[0].summary;
    } else {
      blockerType = "unreachable-forward";
    }
  } else if (doors.length > 0) {
    blockerType = "key-deficit";
    deficits.yellowKey = 1;
    examples.missingDoor = doors[0].summary;
  } else if (unsupported) {
    blockerType = "unsupported-rule";
    examples.unsupportedAction = unsupported.summary;
  } else if (actions.length === 0) {
    blockerType = "no-actions";
  } else {
    blockerType = "unreachable-forward";
  }

  return {
    floorId: state.floorId,
    stageIndex: progress.stageIndex,
    nextForwardTarget,
    blockerType,
    deficits,
    recommendedRepair: makeRecommendedRepair(project, state, blockerType, deficits),
    examples,
    actionCounts: {
      total: actions.length,
      forwardChangeFloor: forwardChangeFloors.length,
      battle: battles.length,
      door: doors.length,
    },
  };
}

module.exports = {
  analyzeProgressBlocker,
};
