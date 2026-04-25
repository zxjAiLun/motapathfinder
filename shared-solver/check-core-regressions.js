"use strict";

const assert = require("node:assert");

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { resolveProjectRoot } = require("./lib/cli-options");
const { executeActionList } = require("./lib/events");
const { loadProject } = require("./lib/project-loader");
const { coordinateKey } = require("./lib/reachability");
const { createSearchProfile } = require("./lib/search-profiles");
const { StaticSimulator } = require("./lib/simulator");
const { getTileDefinitionAt, cloneState } = require("./lib/state");
const { buildMovementHazards } = require("./lib/movement-hazards");
const { stepOntoTile } = require("./lib/step-simulator");

function makeContext(options) {
  const project = loadProject(resolveProjectRoot(process.argv.slice(2), __dirname + "/.."));
  if (options && options.enableAddPoint) project.defaultFlags.enableAddPoint = true;
  const battleResolver = new FunctionBackedBattleResolver(project);
  const simulator = new StaticSimulator(project, {
    stopFloorId: "MT3",
    battleResolver,
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFightToLevelUp: true,
    enableResourcePocket: true,
  });
  return {
    project,
    battleResolver,
    simulator,
    initialState: simulator.createInitialState({ rank: "chaos" }),
  };
}

function getTileId(project, state, floorId, x, y) {
  const tile = getTileDefinitionAt(project, state, floorId, x, y);
  return tile && tile.id;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeFloorState(initialState, floorId, hero) {
  const state = cloneState(initialState);
  state.floorId = floorId;
  state.flags.poison = false;
  Object.assign(state.hero, hero || {});
  return state;
}

function findEnemyTiles(project, predicate) {
  const samples = [];
  Object.values(project.floorsById).forEach((floor) => {
    (floor.map || []).forEach((row, y) => {
      (row || []).forEach((number, x) => {
        const tile = project.mapTilesByNumber[number];
        const id = tile && tile.id;
        const enemy = id && project.enemysById[id];
        if (!enemy || !predicate(enemy, { floor, x, y, id, tile })) return;
        samples.push({ floorId: floor.floorId, x, y, id });
      });
    });
  });
  return samples;
}

function checkEventMacroMatrix() {
  const { simulator, initialState } = makeContext();
  const actions = simulator.enumerateActions(initialState).filter((action) => action.kind === "event");
  assert(actions.length > 0, "expected event macro actions");
  const samples = actions.slice(0, 5).map((eventAction) => {
    assert.strictEqual(eventAction.unsupported, false, `event should choose supported branch: ${eventAction.summary}`);
    const nextState = simulator.applyAction(initialState, eventAction);
    assert(nextState.route.includes(eventAction.summary), "event action should be appended to route");
    assert.deepStrictEqual(nextState.notes.filter((note) => /Unsupported event/i.test(note)), [], "event should not emit unsupported UI notes");
    return { summary: eventAction.summary, choicePath: eventAction.choicePath || [], notes: nextState.notes.length };
  });
  return { total: actions.length, samples };
}

function discoverRepulseLandingSamples(project, battleResolver, initialState, limit) {
  const samples = [];
  Object.values(project.floorsById).forEach((floor) => {
    if (samples.length >= limit) return;
    const baseState = makeFloorState(initialState, floor.floorId, { hp: 1e30, atk: 9999, def: 9999 });
    const hazards = buildMovementHazards(project, baseState, { floorId: floor.floorId, battleResolver });
    Object.keys(hazards.repulse || {}).forEach((loc) => {
      if (samples.length >= limit) return;
      const [targetX, targetY] = loc.split(",").map(Number);
      const adjacentStarts = [
        { x: targetX, y: targetY - 1, direction: "down" },
        { x: targetX, y: targetY + 1, direction: "up" },
        { x: targetX - 1, y: targetY, direction: "right" },
        { x: targetX + 1, y: targetY, direction: "left" },
      ];
      const replayable = adjacentStarts.map((start) => {
        if (getTileDefinitionAt(project, baseState, floor.floorId, start.x, start.y) != null) return null;
        const probe = makeFloorState(initialState, floor.floorId, { hp: 1e30, atk: 9999, def: 9999 });
        probe.hero.loc.x = start.x;
        probe.hero.loc.y = start.y;
        const nextState = stepOntoTile(project, probe, start.direction, { battleResolver, executeActionList }, new Map());
        if (!nextState) return null;
        const movedCount = (hazards.repulse[loc] || []).filter(([x, y, id, direction, repulseX, repulseY]) =>
          getTileId(project, nextState, floor.floorId, repulseX, repulseY) === id
        ).length;
        return movedCount > 0 ? { start, movedCount } : null;
      }).filter(Boolean)[0];
      if (!replayable) return;
      samples.push({ floorId: floor.floorId, targetX, targetY, start: replayable.start, entries: hazards.repulse[loc] });
    });
  });
  return samples;
}

function checkRepulseMoveMatrix() {
  const { project, battleResolver, initialState } = makeContext();
  const samples = discoverRepulseLandingSamples(project, battleResolver, initialState, 4);
  assert(samples.length > 0, "expected at least one repulse sample");
  return samples.map((sample) => {
    const state = makeFloorState(initialState, sample.floorId, { hp: 1e30, atk: 9999, def: 9999 });
    state.hero.loc.x = sample.start.x;
    state.hero.loc.y = sample.start.y;
    const before = sample.entries.map(([x, y, id, direction, targetX, targetY]) => ({ x, y, id, direction, targetX, targetY }));
    const nextState = stepOntoTile(project, state, sample.start.direction, { battleResolver, executeActionList }, new Map());
    assert(nextState, `repulse landing should be simulated for ${sample.floorId}:${sample.targetX},${sample.targetY}`);
    const moved = before.filter((entry) => getTileId(project, nextState, sample.floorId, entry.targetX, entry.targetY) === entry.id);
    assert(moved.length > 0, "at least one repulse monster should move");
    assert(Number(((nextState.meta || {}).hazardStats || {}).repulseMoves || 0) >= moved.length, "repulseMoves stat should be recorded");
    return {
      floorId: sample.floorId,
      landing: `${sample.targetX},${sample.targetY}`,
      start: sample.start,
      moved,
      hazardStats: nextState.meta.hazardStats,
    };
  });
}

function checkSyntheticGuardFullApply() {
  const { project } = makeContext();
  project.enemysById.E442 = { ...project.enemysById.E442, hp: 10, atk: 1, def: 0, money: 3, exp: 5, special: 0 };
  project.enemysById.E444 = { ...project.enemysById.E444, hp: 10, atk: 1, def: 0, money: 7, exp: 11, special: 26 };

  const floor = cloneJson(project.floorsById.MT35);
  floor.floorId = "SYN_GUARD";
  floor.title = "Synthetic Guard Regression";
  floor.name = "Synthetic Guard Regression";
  floor.width = 5;
  floor.height = 5;
  floor.map = Array.from({ length: 5 }, () => Array(5).fill(0));
  floor.map[2][2] = 442;
  floor.map[3][2] = 444;
  floor.events = {};
  floor.changeFloor = {};
  floor.beforeBattle = {};
  floor.afterBattle = {};
  floor.firstArrive = [];
  floor.eachArrive = [];
  project.floorsById[floor.floorId] = floor;
  project.floorOrder = (project.floorOrder || []).concat(floor.floorId);

  const battleResolver = new FunctionBackedBattleResolver(project);
  const simulator = new StaticSimulator(project, { battleResolver });
  const state = simulator.createInitialState({ rank: "chaos" });
  state.floorId = floor.floorId;
  state.hero.hp = 1000;
  state.hero.atk = 100;
  state.hero.def = 10;
  state.hero.mdef = 0;

  const battle = battleResolver.evaluateBattle(state, floor.floorId, 2, 2, "E442");
  assert.strictEqual(battle.supported, true, "synthetic guard battle should evaluate");
  assert((battle.guards || []).length > 0, "synthetic guard battle should include guard metadata");
  assert(battle.damageInfo && battle.damageInfo.damage != null, "synthetic guard battle should have non-null damage");

  battleResolver.applyBattleAt({ project, state, floorId: floor.floorId, x: 2, y: 2, enemyId: "E442" });
  assert.strictEqual(getTileDefinitionAt(project, state, floor.floorId, 2, 2), null, "synthetic guard target should be removed");
  assert.strictEqual(getTileDefinitionAt(project, state, floor.floorId, 2, 3), null, "synthetic guard helper should be removed");
  assert(Number(state.hero.money || 0) >= 10, "synthetic guard rewards should aggregate money");

  return {
    floorId: floor.floorId,
    target: "E442@2,2",
    guard: "E444@2,3",
    damage: battle.damageInfo.damage,
    guards: battle.guards.length,
    moneyAfter: state.hero.money,
    expAfter: state.hero.exp,
    targetRemoved: true,
    guardRemoved: true,
  };
}

function checkGuardBattleMatrix() {
  const { project, battleResolver, initialState } = makeContext();
  const guardTiles = findEnemyTiles(project, () => true).map((sample) => {
    const state = makeFloorState(initialState, sample.floorId, { hp: 1e30, atk: 999999, def: 999999, mdef: 999999 });
    const battle = battleResolver.evaluateBattle(state, sample.floorId, sample.x, sample.y, sample.id);
    if (!battle.supported || !(battle.guards || []).length) return null;
    return {
      ...sample,
      guards: battle.guards.length,
      damage: battle.damageInfo && battle.damageInfo.damage,
      applyable: battle.damageInfo && battle.damageInfo.damage != null && battle.damageInfo.damage < state.hero.hp,
    };
  }).filter(Boolean);
  assert(guardTiles.length > 0, "expected guard-linked battle recognition samples");

  const applyable = guardTiles.find((sample) => sample.applyable) || null;
  let applyResult = null;
  if (applyable) {
    const state = makeFloorState(initialState, applyable.floorId, { hp: 1e30, atk: 999999, def: 999999, mdef: 999999 });
    battleResolver.applyBattleAt({ project, state, floorId: applyable.floorId, x: applyable.x, y: applyable.y, enemyId: applyable.id });
    assert.strictEqual(getTileDefinitionAt(project, state, applyable.floorId, applyable.x, applyable.y), null, "guard target should be removed after battle");
    applyResult = { sample: applyable, hp: state.hero.hp, exp: state.hero.exp, money: state.hero.money };
  }

  const syntheticApplyResult = checkSyntheticGuardFullApply();
  return {
    recognitionCount: guardTiles.length,
    metadataSamples: guardTiles.slice(0, 8),
    naturalApplyableCount: guardTiles.filter((sample) => sample.applyable).length,
    naturalApplyResult: applyResult,
    syntheticApplyResult,
    coverageNote: applyable ? "natural-guard-full-apply-covered" : "synthetic-guard-full-apply-covered-natural-no-damage-non-null-sample-found",
  };
}

function checkAddPointMatrix() {
  const { project, battleResolver, initialState } = makeContext({ enableAddPoint: true });
  const pointEnemies = findEnemyTiles(project, (enemy) => Number(enemy.point || 0) > 0).slice(0, 8);
  assert(pointEnemies.length > 0, "expected add-point enemy samples");
  return pointEnemies.map((sample) => {
    const state = makeFloorState(initialState, sample.floorId, { hp: 1e9, atk: 9999, def: 9999 });
    const beforeAtk = state.hero.atk;
    battleResolver.applyBattleAt({ project, state, floorId: sample.floorId, x: sample.x, y: sample.y, enemyId: sample.id });
    assert(state.hero.atk > beforeAtk, "add-point should apply default attack branch");
    return { ...sample, beforeAtk, afterAtk: state.hero.atk, notes: state.notes.slice(-2) };
  });
}

function checkMacroActionMatrix() {
  const { simulator, initialState } = makeContext();
  const actions = simulator.enumerateActions(initialState);
  const grouped = actions.reduce((result, action) => {
    result[action.kind] = Number(result[action.kind] || 0) + 1;
    return result;
  }, {});
  assert(Number(grouped.resourcePocket || 0) > 0, "expected resourcePocket macro actions");
  const profile = createSearchProfile("stage-mt1-mt11", simulator, { targetFloorId: "MT3" });
  assert.strictEqual(typeof profile.compareFrontierStates, "function", "stage profile needs comparator");
  assert.strictEqual(typeof profile.sortStateActions, "function", "stage profile needs action sorter");
  assert.strictEqual(typeof profile.getActionQuotasForState, "function", "stage profile needs adaptive quotas");
  assert.strictEqual(typeof profile.getBeamLimits, "function", "stage profile needs adaptive beam");
  return {
    initialActionCounts: grouped,
    targetFloorId: profile.targetFloorId,
    hasAdaptiveQuotas: true,
    hasAdaptiveBeam: true,
  };
}

function main() {
  const results = {
    eventMacro: checkEventMacroMatrix(),
    repulseMove: checkRepulseMoveMatrix(),
    guardBattle: checkGuardBattleMatrix(),
    addPoint: checkAddPointMatrix(),
    macroActionsAndStageProfile: checkMacroActionMatrix(),
  };
  console.log(JSON.stringify(results, null, 2));
}

main();
