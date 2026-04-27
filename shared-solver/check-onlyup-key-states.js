"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { formatActionLabel } = require("./lib/enemy-labels");
const { loadProject } = require("./lib/project-loader");
const { readRouteFile } = require("./lib/route-store");
const { StaticSimulator } = require("./lib/simulator");

const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");

const MT1_1559_PREFIX = [
  "battle:blackSlime@MT1:8,7",
  "battle:redSlime@MT1:9,6",
  "battle:blackSlime@MT1:3,10",
  "battle:slimelord@MT1:9,4",
  "battle:slimelord@MT1:3,4",
  "battle:bat@MT1:4,11",
  "battle:bat@MT1:8,11",
  "battle:bigBat@MT1:11,11",
  "battle:skeletonWarrior@MT1:2,1",
  "battle:redBat@MT1:10,1",
];

const MT2_ENTRY_PREFIX = [
  ...MT1_1559_PREFIX,
  "battle:skeleton@MT1:8,1",
  "changeFloor@MT1:6,0",
];

const FIXTURES = {
  mt2Hp3834: path.join(__dirname, "routes", "fixtures", "mt1-mt2-hp3834.route.json"),
  mt3I893Hp8425: path.join(__dirname, "routes", "fixtures", "mt1-mt3-i893-hp8425.route.json"),
  mt4Hp4459: path.join(__dirname, "routes", "fixtures", "mt1-mt4-hp4459-atk421-def318-mdef5012.route.json"),
  mt4Hp6428: path.join(__dirname, "routes", "fixtures", "mt1-mt4-hp6428-best.route.json"),
};

const MT4_TO_MT5_BLOCKER_SUFFIX = [
  "battle:greenKing@MT4:4,1",
  "battle:blueKnight@MT4:2,1",
  "battle:goldSlime@MT4:4,7",
  "battle:poisonSkeleton@MT4:2,8",
  "battle:poisonSkeleton@MT4:6,6",
  "battle:goldSlime@MT4:8,7",
  "battle:poisonSkeleton@MT4:10,8",
  "battle:poisonSkeleton@MT4:3,10",
  "battle:poisonBat@MT4:4,11",
  "battle:skeletonPriest@MT4:2,5",
  "battle:skeletonPriest@MT4:10,1",
  "battle:skeletonPriest@MT4:11,11",
  "battle:poisonBat@MT4:8,11",
  "battle:poisonBat@MT4:6,8",
  "battle:skeletonKing@MT4:8,3",
  "battle:devilWarrior@MT4:10,5",
  "battle:skeletonKing@MT4:4,3",
  "changeFloor@MT4:6,12",
  "battle:skeletonKing@MT5:8,11",
  "battle:devilWarrior@MT5:11,11",
  "battle:skeletonKing@MT5:4,11",
  "battle:skeletonPresbyter@MT5:3,10",
];

function parseArgs(argv) {
  const result = {};
  for (const arg of argv) {
    if (arg.startsWith("--project-root=")) result.projectRoot = path.resolve(arg.slice("--project-root=".length));
  }
  return result;
}

function makeSimulator(projectRoot) {
  const project = loadProject(projectRoot);
  return new StaticSimulator(project, {
    stopFloorId: "MT5",
    battleResolver: new FunctionBackedBattleResolver(project),
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFightToLevelUp: false,
    enableResourcePocket: false,
    enableResourceCluster: false,
    enableResourceChain: false,
    searchGraphMode: "macro",
  });
}

function primitiveActions(simulator, state) {
  return (simulator.enumeratePrimitiveActions(state).actions || []);
}

function findAction(simulator, state, summary) {
  return primitiveActions(simulator, state).find((candidate) => candidate.summary === summary)
    || simulator.enumerateActions(state).find((candidate) => candidate.summary === summary)
    || null;
}

function applySummary(simulator, state, summary) {
  const action = findAction(simulator, state, summary);
  assert.ok(action, `missing action: ${formatActionLabel(simulator.project, summary)}`);
  return simulator.applyAction(state, action);
}

function replaySummaries(simulator, summaries, startState) {
  return summaries.reduce(
    (current, summary) => applySummary(simulator, current, summary),
    startState || simulator.createInitialState({ rank: "chaos" })
  );
}

function replayRouteRecord(simulator, routePath) {
  if (!fs.existsSync(routePath)) throw new Error(`missing route fixture: ${path.relative(__dirname, routePath)}`);
  const record = readRouteFile(routePath);
  const summaries = (record.decisions || []).map((decision) => decision.summary);
  return {
    record,
    summaries,
    state: replaySummaries(simulator, summaries),
  };
}

function assertHeroAtLeast(state, expected, label) {
  for (const [field, value] of Object.entries(expected)) {
    assert.ok(
      Number((state.hero || {})[field] || 0) >= value,
      `${label}: expected hero.${field} >= ${value}, got ${(state.hero || {})[field]}`
    );
  }
}

function effectiveHero(state) {
  const flags = state.flags || {};
  const hero = state.hero || {};
  const scale = (field) => {
    const buff = Number(flags[`__${field}_buff__`] || 1);
    return Math.floor(Number(hero[field] || 0) * buff);
  };
  return {
    hp: Number(hero.hp || 0),
    atk: scale("atk"),
    def: scale("def"),
    mdef: scale("mdef"),
    exp: Number(hero.exp || 0),
    lv: Number(hero.lv || 0),
  };
}

function assertEffectiveHeroAtLeast(state, expected, label) {
  const effective = effectiveHero(state);
  for (const [field, value] of Object.entries(expected)) {
    assert.ok(
      Number(effective[field] || 0) >= value,
      `${label}: expected effective ${field} >= ${value}, got ${effective[field]}`
    );
  }
}

function checkMt1Gate1559(simulator) {
  const state = replaySummaries(simulator, MT1_1559_PREFIX);
  assert.equal(state.floorId, "MT1");
  assertHeroAtLeast(state, { hp: 1559, atk: 19, def: 10, mdef: 130, exp: 5 }, "MT1 1559 gate");

  const gateSummary = "battle:skeleton@MT1:8,1";
  const action = findAction(simulator, state, gateSummary);
  assert.ok(action, `missing MT1 gate action: ${formatActionLabel(simulator.project, gateSummary)}`);
  const damage = Number((action.estimate || {}).damage || action.damage || 0);
  assert.equal(damage, 1558, `expected ${formatActionLabel(simulator.project, gateSummary)} damage to be 1558`);
  assert.ok(state.hero.hp > damage, `expected hp=${state.hero.hp} to survive damage=${damage}`);

  return {
    floorId: state.floorId,
    hp: state.hero.hp,
    atk: state.hero.atk,
    def: state.hero.def,
    mdef: state.hero.mdef,
    exp: state.hero.exp,
    gate: formatActionLabel(simulator.project, gateSummary),
    damage,
  };
}

function checkMt2ShortVsDeepOrder(simulator) {
  const entry = replaySummaries(simulator, MT2_ENTRY_PREFIX);
  assert.equal(entry.floorId, "MT2");
  assertHeroAtLeast(entry, { hp: 1601, atk: 21, def: 17, mdef: 130, exp: 6 }, "MT2 entry");

  const shortRightFirst = replaySummaries(simulator, [
    "battle:skeleton@MT2:8,1",
    "battle:skeleton@MT2:4,1",
  ], entry);
  const shortLeftFirst = replaySummaries(simulator, [
    "battle:skeleton@MT2:4,1",
    "battle:skeleton@MT2:8,1",
  ], entry);
  assert.ok(
    shortRightFirst.hero.hp > shortLeftFirst.hero.hp,
    `short-term order should prefer 8,1 -> 4,1: rightFirst=${shortRightFirst.hero.hp}, leftFirst=${shortLeftFirst.hero.hp}`
  );

  const deepShortBest = replaySummaries(simulator, [
    "battle:skeleton@MT2:8,1",
    "battle:skeleton@MT2:4,1",
    "battle:ghostSoldier@MT2:2,1",
  ], entry);
  const deepBest = replaySummaries(simulator, [
    "battle:skeleton@MT2:4,1",
    "battle:ghostSoldier@MT2:2,1",
  ], entry);
  assert.ok(
    deepBest.hero.hp > deepShortBest.hero.hp,
    `deeper order should prefer 4,1 -> 2,1 -> auto 8,1: deepBest=${deepBest.hero.hp}, shortBest=${deepShortBest.hero.hp}`
  );
  assertHeroAtLeast(deepBest, { hp: 3582, atk: 31, def: 19, mdef: 250, exp: 9 }, "MT2 deeper order");

  return {
    entry: { hp: entry.hero.hp, atk: entry.hero.atk, def: entry.hero.def, mdef: entry.hero.mdef, exp: entry.hero.exp },
    shortTerm: {
      rightFirstHp: shortRightFirst.hero.hp,
      leftFirstHp: shortLeftFirst.hero.hp,
    },
    deeper: {
      goodHp: deepBest.hero.hp,
      badHp: deepShortBest.hero.hp,
      hpGain: deepBest.hero.hp - deepShortBest.hero.hp,
      atk: deepBest.hero.atk,
      def: deepBest.hero.def,
      mdef: deepBest.hero.mdef,
      exp: deepBest.hero.exp,
    },
  };
}

function checkMt2Hp3834Fixture(simulator) {
  const { state, summaries } = replayRouteRecord(simulator, FIXTURES.mt2Hp3834);
  assert.equal(state.floorId, "MT2");
  assertHeroAtLeast(state, { hp: 3834, atk: 72, def: 35, mdef: 290, exp: 1 }, "MT2 hp3834 fixture");

  return {
    routeFile: path.relative(__dirname, FIXTURES.mt2Hp3834),
    decisions: summaries.length,
    final: { floorId: state.floorId, hp: state.hero.hp, atk: state.hero.atk, def: state.hero.def, mdef: state.hero.mdef, exp: state.hero.exp },
  };
}

function checkMt3I893Hp8425Fixture(simulator) {
  const required = [
    "battle:bluePriest@MT2:2,8",
    "battle:brownWizard@MT2:3,10",
    "battle:slimeman@MT2:4,11",
    "battle:redWizard@MT2:11,11",
    "battle:brownWizard@MT2:6,6",
    "battle:yellowGateKeeper@MT2:6,8",
    "equip:I893",
  ];
  const { state, summaries } = replayRouteRecord(simulator, FIXTURES.mt3I893Hp8425);
  assert.equal(state.floorId, "MT3");
  assertHeroAtLeast(state, { hp: 8425, atk: 107, def: 100, mdef: 510, exp: 31 }, "MT3 I893 fixture");
  assert.ok((state.hero.equipment || []).includes("I893"), "MT3 I893 fixture: expected equipment to include I893");
  for (const summary of required) {
    assert.ok(summaries.includes(summary), `MT3 I893 fixture should include ${formatActionLabel(simulator.project, summary)}`);
  }

  return {
    routeFile: path.relative(__dirname, FIXTURES.mt3I893Hp8425),
    decisions: summaries.length,
    final: {
      floorId: state.floorId,
      hp: state.hero.hp,
      atk: state.hero.atk,
      def: state.hero.def,
      mdef: state.hero.mdef,
      exp: state.hero.exp,
      equipment: state.hero.equipment || [],
    },
    required: required.map((summary) => formatActionLabel(simulator.project, summary)),
  };
}

function checkMt4Hp4459Fixture(simulator) {
  const { state, summaries } = replayRouteRecord(simulator, FIXTURES.mt4Hp4459);
  assert.equal(state.floorId, "MT4");
  assertHeroAtLeast(state, { hp: 4459, atk: 337, def: 255, mdef: 4010, exp: 5, lv: 6 }, "MT4 hp4459 fixture raw");
  assertEffectiveHeroAtLeast(state, { hp: 4459, atk: 421, def: 318, mdef: 5012 }, "MT4 hp4459 fixture effective");
  return {
    routeFile: path.relative(__dirname, FIXTURES.mt4Hp4459),
    decisions: summaries.length,
    final: {
      floorId: state.floorId,
      hp: state.hero.hp,
      atk: state.hero.atk,
      def: state.hero.def,
      mdef: state.hero.mdef,
      exp: state.hero.exp,
      lv: state.hero.lv,
      effective: effectiveHero(state),
      equipment: state.hero.equipment || [],
    },
  };
}

function tileIdAt(simulator, state, floorId, x, y) {
  const floor = simulator.project.floorsById[floorId];
  const floorState = (state.floorStates || {})[floorId] || {};
  if ((floorState.removed || {})[`${x},${y}`]) return null;
  const replacement = (floorState.replaced || {})[`${x},${y}`];
  if (replacement != null) {
    const replacementTile = simulator.project.mapTilesByNumber[String(replacement)];
    return replacementTile && replacementTile.id;
  }
  const number = floor && floor.map[y] ? floor.map[y][x] : 0;
  const tile = simulator.project.mapTilesByNumber[String(number)];
  return tile && tile.id;
}

function checkMt5BlueKingOpensMechanismDoors(simulator) {
  const { state: mt4State } = replayRouteRecord(simulator, FIXTURES.mt4Hp6428);
  const blocker = replaySummaries(simulator, MT4_TO_MT5_BLOCKER_SUFFIX, mt4State);
  assert.equal(blocker.floorId, "MT5");
  assert.equal(tileIdAt(simulator, blocker, "MT5", 4, 1), "specialDoor");
  assert.equal(tileIdAt(simulator, blocker, "MT5", 8, 1), "specialDoor");

  blocker.hero.hp = 999999999;
  blocker.hero.atk = 999999;
  blocker.hero.def = 999999;
  blocker.hero.mdef = 999999;
  const afterBoss = simulator.applyAction(blocker, {
    kind: "battle",
    floorId: "MT5",
    target: { x: 6, y: 7 },
    enemyId: "blueKing",
    summary: "battle:blueKing@MT5:6,7",
    path: [],
    stance: { x: 6, y: 8 },
    direction: "up",
  });
  assert.equal(tileIdAt(simulator, afterBoss, "MT5", 6, 7), null);
  assert.equal(tileIdAt(simulator, afterBoss, "MT5", 4, 1), null, "blueKing should open MT5 mechanism door at 4,1");
  assert.equal(tileIdAt(simulator, afterBoss, "MT5", 8, 1), null, "blueKing should open MT5 mechanism door at 8,1");

  return {
    blocker: {
      floorId: blocker.floorId,
      hp: blocker.hero.hp,
      atk: blocker.hero.atk,
      def: blocker.hero.def,
      mdef: blocker.hero.mdef,
      lv: blocker.hero.lv,
      exp: blocker.hero.exp,
    },
    boss: "battle:blueKing（织光仙子）@MT5:6,7",
    openedDoors: ["MT5:4,1", "MT5:8,1"],
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const simulator = makeSimulator(args.projectRoot || DEFAULT_PROJECT_ROOT);
  const result = {
    projectRoot: simulator.project.root,
    keyStates: {
      mt1Gate1559: checkMt1Gate1559(simulator),
      mt2ShortVsDeepOrder: checkMt2ShortVsDeepOrder(simulator),
      mt2Hp3834: checkMt2Hp3834Fixture(simulator),
      mt3I893Hp8425: checkMt3I893Hp8425Fixture(simulator),
      mt4Hp4459: checkMt4Hp4459Fixture(simulator),
      mt5BlueKingDoors: checkMt5BlueKingOpensMechanismDoors(simulator),
    },
  };
  console.log(JSON.stringify(result, null, 2));
}

main();
