"use strict";

const { resolveChangeFloorTarget } = require("./floor-transitions");
const { DIRECTION_DELTAS, DIRECTIONS, coordinateKey, isDoorTile, isEnemyTile } = require("./reachability");
const { getFloorOrder } = require("./score");
const { cloneState, floorHasCoordinate, getTileDefinitionAt } = require("./state");

const DEFAULT_SCOUT_OPTIONS = {
  maxTiles: 300,
  maxActions: 80,
  maxBattleSamples: 30,
  includeUnsupportedNotes: true,
};

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function heroSummary(state) {
  const hero = state && state.hero || {};
  return {
    hp: number(hero.hp, 0),
    atk: number(hero.atk, 0),
    def: number(hero.def, 0),
    mdef: number(hero.mdef, 0),
    lv: number(hero.lv, 0),
    exp: number(hero.exp, 0),
    money: number(hero.money, 0),
  };
}

function isForwardFloor(project, fromFloorId, toFloorId) {
  return getFloorOrder(toFloorId) > getFloorOrder(fromFloorId);
}

function isTraverseTile(project, state, floorId, x, y) {
  if (!floorHasCoordinate(project, floorId, x, y)) return false;
  const floor = project.floorsById[floorId];
  if ((floor.changeFloor || {})[coordinateKey(x, y)]) return true;
  const tile = getTileDefinitionAt(project, state, floorId, x, y);
  if (tile == null) return true;
  if (tile.cls === "items") return true;
  if (isEnemyTile(tile)) return false;
  if (isDoorTile(tile)) return false;
  if (tile.trigger != null && tile.trigger !== "null" && tile.trigger !== "passNet") return false;
  return tile.canPass === true;
}

function scanReachable(project, state, options) {
  const maxTiles = number(options.maxTiles, DEFAULT_SCOUT_OPTIONS.maxTiles);
  const floorId = state.floorId;
  const start = { x: state.hero.loc.x, y: state.hero.loc.y, distance: 0 };
  const queue = [start];
  const visited = new Set([coordinateKey(start.x, start.y)]);
  const frontier = [];
  while (queue.length > 0 && visited.size < maxTiles) {
    const current = queue.shift();
    frontier.push(current);
    for (const direction of DIRECTIONS) {
      const delta = DIRECTION_DELTAS[direction];
      const x = current.x + delta.x;
      const y = current.y + delta.y;
      const key = coordinateKey(x, y);
      if (visited.has(key)) continue;
      if (!floorHasCoordinate(project, floorId, x, y)) continue;
      const tile = getTileDefinitionAt(project, state, floorId, x, y);
      if (isTraverseTile(project, state, floorId, x, y)) {
        visited.add(key);
        queue.push({ x, y, distance: current.distance + 1 });
        continue;
      }
      if (tile) frontier.push({ x, y, distance: current.distance + 1, boundary: true });
    }
  }
  return { visited, frontier };
}

function actionResourceEntry(baseHero, action) {
  const estimate = action.estimate || {};
  return {
    kind: action.kind,
    summary: action.summary,
    hpDelta: number(estimate.hpDelta, 0),
    atkDelta: number(estimate.atk, 0),
    defDelta: number(estimate.def, 0),
    mdefDelta: number(estimate.mdef, 0),
    expDelta: number(estimate.exp, 0),
    score: number(estimate.score, 0),
  };
}

function summarizeActions(simulator, entryState, baseState, options) {
  let actions = [];
  try {
    actions = simulator.enumeratePrimitiveActions(entryState).actions || [];
  } catch (error) {
    return { actions: [], error };
  }
  const maxActions = number(options.maxActions, DEFAULT_SCOUT_OPTIONS.maxActions);
  return { actions: actions.slice(0, maxActions), error: null };
}

function classifyActions(simulator, entryState, baseState, actions) {
  const project = simulator.project;
  const fromFloorId = baseState.floorId;
  const hero = heroSummary(entryState);
  const reachable = {
    tileCount: 0,
    itemCount: 0,
    battleCount: 0,
    zeroDamageBattleCount: 0,
    eventCount: 0,
    doorCount: 0,
    changeFloorCount: 0,
  };
  const forwardGates = [];
  const battleFrontier = [];
  const resourceFrontier = [];
  const unsupportedNotes = [];

  for (const action of actions) {
    if (action.kind === "pickup") {
      reachable.itemCount += 1;
      resourceFrontier.push(actionResourceEntry(hero, action));
    } else if (action.kind === "resourcePocket" || action.kind === "fightToLevelUp") {
      resourceFrontier.push(actionResourceEntry(hero, action));
    } else if (action.kind === "battle") {
      reachable.battleCount += 1;
      const damage = number((action.estimate || {}).damage, 0);
      if (damage === 0) reachable.zeroDamageBattleCount += 1;
      battleFrontier.push({
        enemyId: action.enemyId,
        floorId: entryState.floorId,
        x: action.target && action.target.x,
        y: action.target && action.target.y,
        damage,
        hpAfter: hero.hp - damage,
        exp: number((action.estimate || {}).exp, 0),
        money: number((action.estimate || {}).money, 0),
        guards: number((action.estimate || {}).guards, 0),
        lethal: damage >= hero.hp,
        supported: true,
      });
    } else if (action.kind === "openDoor") {
      reachable.doorCount += 1;
    } else if (action.kind === "event") {
      reachable.eventCount += 1;
      if (action.unsupported) unsupportedNotes.push(action.summary || "unsupported event");
    } else if (action.kind === "changeFloor") {
      reachable.changeFloorCount += 1;
      let target = null;
      try {
        target = resolveChangeFloorTarget(project, entryState, action.changeFloor);
      } catch (error) {
        unsupportedNotes.push(`changeFloor target failed: ${error.message}`);
      }
      const forward = target && isForwardFloor(project, entryState.floorId, target.floorId);
      if (forward) {
        forwardGates.push({
          kind: "changeFloor",
          floorId: entryState.floorId,
          x: action.x,
          y: action.y,
          targetFloorId: target.floorId,
          distance: Array.isArray(action.path) ? action.path.length : null,
          reachableNow: true,
          blockers: [],
        });
      }
    }
  }

  return { reachable, forwardGates, battleFrontier, resourceFrontier, unsupportedNotes };
}

function computeDeficits(entryState, classified) {
  const hero = heroSummary(entryState);
  const battleFrontier = classified.battleFrontier || [];
  const lethal = battleFrontier.filter((battle) => battle.lethal || number(battle.damage, 0) >= hero.hp);
  const nonLethal = battleFrontier.filter((battle) => !battle.lethal && number(battle.damage, 0) < hero.hp);
  const minLethalDamage = lethal.length > 0 ? Math.min(...lethal.map((battle) => number(battle.damage, 0))) : null;
  const minHpToAnyForwardBattle = minLethalDamage == null ? null : minLethalDamage + 1;
  const hpDeficit = nonLethal.length > 0 || minHpToAnyForwardBattle == null ? 0 : Math.max(0, minHpToAnyForwardBattle - hero.hp);
  return {
    minHpToAnyForwardBattle,
    hpDeficit,
    atkDeficit: 0,
    defDeficit: 0,
    mdefDeficit: 0,
    expDeficitToLevel: 0,
    keyDeficits: {},
  };
}

function computeVerdict(classified, deficits) {
  const reasons = [];
  if ((classified.forwardGates || []).length === 0) reasons.push("no-forward-changeFloor-reachable");
  if (deficits.hpDeficit > 0) reasons.push("hp-too-low-for-frontier-battle");
  if ((classified.unsupportedNotes || []).length > 0) reasons.push("unsupported-notes-present");
  const canProgressImmediately = (classified.forwardGates || []).some((gate) => gate.reachableNow);
  return {
    canProgressImmediately,
    likelyBlocked: !canProgressImmediately && (reasons.length > 0 || deficits.hpDeficit > 0),
    reasons,
  };
}

function computeScoutScore(classified, deficits) {
  const reachable = classified.reachable || {};
  const resourceScore = (classified.resourceFrontier || []).reduce((sum, entry) => sum + Math.max(0, number(entry.score, 0)), 0);
  const unsupportedPenalty = (classified.unsupportedNotes || []).length * 25000;
  return reachable.itemCount * 10000 +
    reachable.zeroDamageBattleCount * 12000 +
    reachable.changeFloorCount * 80000 +
    Math.min(120000, resourceScore) -
    number(deficits.hpDeficit, 0) * 500 -
    unsupportedPenalty;
}

function scoutState(simulator, entryState, baseState, options) {
  const config = { ...DEFAULT_SCOUT_OPTIONS, ...(options || {}) };
  const scanned = scanReachable(simulator.project, entryState, config);
  const actionResult = summarizeActions(simulator, entryState, baseState || entryState, config);
  const classified = classifyActions(simulator, entryState, baseState || entryState, actionResult.actions);
  classified.reachable.tileCount = scanned.visited.size;
  const deficits = computeDeficits(entryState, classified);
  const verdict = computeVerdict(classified, deficits);
  const score = computeScoutScore(classified, deficits);
  return {
    fromFloorId: baseState ? baseState.floorId : entryState.floorId,
    toFloorId: entryState.floorId,
    entry: {
      floorId: entryState.floorId,
      x: entryState.hero.loc.x,
      y: entryState.hero.loc.y,
      direction: entryState.hero.loc.direction,
    },
    reachable: classified.reachable,
    forwardGates: classified.forwardGates,
    battleFrontier: classified.battleFrontier.slice(0, number(config.maxBattleSamples, DEFAULT_SCOUT_OPTIONS.maxBattleSamples)),
    resourceFrontier: classified.resourceFrontier,
    deficits,
    verdict,
    score,
    unsupportedNotes: classified.unsupportedNotes,
  };
}

function scoutChangeFloor(simulator, state, changeFloorAction, options) {
  const baseState = cloneState(state);
  let entryState = null;
  let target = null;
  try {
    target = resolveChangeFloorTarget(simulator.project, baseState, changeFloorAction.changeFloor);
    entryState = simulator.applyAction(baseState, changeFloorAction, { storeRoute: false });
  } catch (error) {
    return {
      fromFloorId: state.floorId,
      toFloorId: target && target.floorId || null,
      entry: target,
      reachable: { tileCount: 0, itemCount: 0, battleCount: 0, zeroDamageBattleCount: 0, eventCount: 0, doorCount: 0, changeFloorCount: 0 },
      forwardGates: [],
      battleFrontier: [],
      resourceFrontier: [],
      deficits: { minHpToAnyForwardBattle: null, hpDeficit: 0, atkDeficit: 0, defDeficit: 0, mdefDeficit: 0, expDeficitToLevel: 0, keyDeficits: {} },
      verdict: { canProgressImmediately: false, likelyBlocked: true, reasons: ["changeFloor-preview-failed"] },
      score: -100000,
      unsupportedNotes: [error.message],
    };
  }
  const scout = scoutState(simulator, entryState, state, options);
  scout.fromFloorId = state.floorId;
  scout.toFloorId = entryState.floorId;
  return scout;
}

function getCachedChangeFloorScout(simulator, state, action, options) {
  if (!state.meta) state.meta = {};
  if (!state.meta.__floorScout) state.meta.__floorScout = {};
  const key = `${state.floorId}|${action.summary || ""}`;
  if (!state.meta.__floorScout[key]) {
    state.meta.__floorScout[key] = scoutChangeFloor(simulator, state, action, options);
  }
  return state.meta.__floorScout[key];
}

module.exports = {
  DEFAULT_SCOUT_OPTIONS,
  getCachedChangeFloorScout,
  scoutChangeFloor,
  scoutState,
};
