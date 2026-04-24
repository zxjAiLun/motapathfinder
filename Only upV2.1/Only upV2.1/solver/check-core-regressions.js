"use strict";

const assert = require("node:assert");

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { executeActionList } = require("./lib/events");
const { loadProject } = require("./lib/project-loader");
const { createSearchProfile } = require("./lib/search-profiles");
const { StaticSimulator } = require("./lib/simulator");
const { getTileDefinitionAt, cloneState } = require("./lib/state");
const { stepOntoTile } = require("./lib/step-simulator");

function makeContext(options) {
  const project = loadProject(__dirname + "/..");
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

function checkEventMacro() {
  const { simulator, initialState } = makeContext();
  const eventAction = simulator.enumerateActions(initialState).find((action) => action.kind === "event");
  assert(eventAction, "expected initial event macro action");
  assert.strictEqual(eventAction.unsupported, false, "initial event should choose supported branch");
  const nextState = simulator.applyAction(initialState, eventAction);
  assert(nextState.route.includes(eventAction.summary), "event action should be appended to route");
  assert.deepStrictEqual(nextState.notes.filter((note) => /Unsupported event/i.test(note)), [], "event should not emit unsupported UI notes");
  return { summary: eventAction.summary, notes: nextState.notes.length };
}

function checkRepulseMove() {
  const { project, battleResolver, initialState } = makeContext();
  const state = cloneState(initialState);
  state.floorId = "MT40";
  state.hero.hp = 1e30;
  state.hero.atk = 9999;
  state.hero.def = 9999;
  state.flags.poison = false;
  state.hero.loc.x = 7;
  state.hero.loc.y = 4;
  const nextState = stepOntoTile(project, state, "down", { battleResolver, executeActionList }, new Map());
  assert(nextState, "repulse landing should be simulated instead of blocked");
  assert.strictEqual(getTileDefinitionAt(project, nextState, "MT40", 6, 5), null, "repulsed source 6,5 should be empty");
  assert.strictEqual(getTileDefinitionAt(project, nextState, "MT40", 5, 5).id, "E461", "repulsed monster should move to 5,5");
  assert.strictEqual(getTileDefinitionAt(project, nextState, "MT40", 7, 6), null, "repulsed source 7,6 should be empty");
  assert.strictEqual(getTileDefinitionAt(project, nextState, "MT40", 7, 7).id, "E461", "repulsed monster should move to 7,7");
  assert(Number(((nextState.meta || {}).hazardStats || {}).repulseMoves || 0) >= 2, "repulseMoves stat should be recorded");
  return nextState.meta.hazardStats;
}

function checkGuardBattleEvaluation() {
  const { battleResolver, initialState } = makeContext();
  const state = cloneState(initialState);
  state.floorId = "MT35";
  state.hero.hp = 1e30;
  state.hero.atk = 999999;
  state.hero.def = 999999;
  state.hero.mdef = 999999;
  const battle = battleResolver.evaluateBattle(state, "MT35", 6, 8, "E442");
  assert.strictEqual(battle.supported, true, "guard-linked battle should evaluate as supported");
  assert((battle.guards || []).length > 0, "guard-linked battle should carry guard metadata");
  return { guards: battle.guards.length, damage: battle.damageInfo && battle.damageInfo.damage };
}

function checkAddPointReward() {
  const { project, battleResolver, initialState } = makeContext({ enableAddPoint: true });
  const state = cloneState(initialState);
  state.floorId = "MT2";
  state.hero.hp = 1e9;
  state.hero.atk = 9999;
  state.hero.def = 9999;
  const beforeAtk = state.hero.atk;
  battleResolver.applyBattleAt({ project, state, floorId: "MT2", x: 2, y: 8, enemyId: "bluePriest" });
  assert(state.hero.atk > beforeAtk, "add-point should apply default attack branch");
  return { beforeAtk, afterAtk: state.hero.atk, notes: state.notes.slice(-2) };
}

function checkStageProfileWiring() {
  const { simulator } = makeContext();
  const profile = createSearchProfile("stage-mt1-mt11", simulator, { targetFloorId: "MT3" });
  assert.strictEqual(typeof profile.compareFrontierStates, "function", "stage profile needs comparator");
  assert.strictEqual(typeof profile.sortStateActions, "function", "stage profile needs action sorter");
  assert.strictEqual(typeof profile.getActionQuotasForState, "function", "stage profile needs adaptive quotas");
  assert.strictEqual(typeof profile.getBeamLimits, "function", "stage profile needs adaptive beam");
  return {
    targetFloorId: profile.targetFloorId,
    hasAdaptiveQuotas: true,
    hasAdaptiveBeam: true,
  };
}

function main() {
  const results = {
    eventMacro: checkEventMacro(),
    repulseMove: checkRepulseMove(),
    guardBattle: checkGuardBattleEvaluation(),
    addPoint: checkAddPointReward(),
    stageProfile: checkStageProfileWiring(),
  };
  console.log(JSON.stringify(results, null, 2));
}

main();
