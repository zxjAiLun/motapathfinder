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

function checkMt4Mt3ExperienceDetour(simulator) {
  const { state: mt4State } = replayRouteRecord(simulator, FIXTURES.mt4Hp6428);
  const afterLocalGems = replaySummaries(simulator, [
    "battle:greenKing@MT4:4,1",
    "battle:blueKnight@MT4:2,1",
  ], mt4State);

  const detour = replaySummaries(simulator, [
    "changeFloor@MT4:6,0",
    "changeFloor@MT3:6,0",
  ], afterLocalGems);
  assert.equal(detour.floorId, "MT4");
  assert.equal(detour.hero.exp, afterLocalGems.hero.exp + 16, "MT4->MT3 detour should collect 16 zero-damage exp");
  assert.equal(detour.hero.hp, afterLocalGems.hero.hp, "MT4->MT3 detour should not spend hp");

  const sharedSuffix = [
    "battle:goldSlime@MT4:4,7",
    "battle:poisonSkeleton@MT4:6,6",
    "battle:poisonSkeleton@MT4:10,8",
    "battle:poisonSkeleton@MT4:2,8",
    "battle:poisonSkeleton@MT4:3,10",
  ];
  const noDetourBeforeGate = replaySummaries(simulator, sharedSuffix, afterLocalGems);
  const noDetourGate = findAction(simulator, noDetourBeforeGate, "battle:poisonSkeleton@MT4:1,11");
  assert.ok(noDetourGate, "no-detour route should still need MT4:1,11");
  assert.equal(Number((noDetourGate.estimate || {}).damage || 0), 688);
  const noDetourAfterGate = simulator.applyAction(noDetourBeforeGate, noDetourGate);

  const detourAfterShared = replaySummaries(simulator, sharedSuffix, detour);
  const detourGate = findAction(simulator, detourAfterShared, "battle:poisonSkeleton@MT4:1,11");
  assert.equal(detourGate, null, "detour route should auto-clear MT4:1,11 after earlier MT3 exp");
  assert.ok(
    detourAfterShared.hero.hp >= noDetourAfterGate.hero.hp + 688,
    `detour should preserve at least 688 hp: detour=${detourAfterShared.hero.hp}, noDetour=${noDetourAfterGate.hero.hp}`
  );

  return {
    afterLocalGems: {
      hp: afterLocalGems.hero.hp,
      atk: afterLocalGems.hero.atk,
      def: afterLocalGems.hero.def,
      mdef: afterLocalGems.hero.mdef,
      exp: afterLocalGems.hero.exp,
    },
    detourGain: {
      exp: detour.hero.exp - afterLocalGems.hero.exp,
      hpCost: afterLocalGems.hero.hp - detour.hero.hp,
      savedHpAtGate: detourAfterShared.hero.hp - noDetourAfterGate.hero.hp,
    },
    noDetourGate: formatActionLabel(simulator.project, "battle:poisonSkeleton@MT4:1,11"),
  };
}

const MT4_MT5_DETOUR_PREFIX = [
  "battle:greenKing@MT4:4,1",
  "battle:blueKnight@MT4:2,1",
  "changeFloor@MT4:6,0",
  "changeFloor@MT3:6,0",
  "battle:goldSlime@MT4:4,7",
  "battle:poisonSkeleton@MT4:6,6",
  "battle:poisonSkeleton@MT4:10,8",
  "battle:poisonSkeleton@MT4:2,8",
  "battle:poisonSkeleton@MT4:3,10",
];

const MT4_MT5_FIRST_ENTRY_PREFIX = [
  ...MT4_MT5_DETOUR_PREFIX,
  "battle:poisonBat@MT4:4,11",
  "changeFloor@MT4:6,12",
];

function checkMt5SegmentedResourceRoute(simulator) {
  const { state: mt4State } = replayRouteRecord(simulator, FIXTURES.mt4Hp6428);
  const afterDetourPrefix = replaySummaries(simulator, MT4_MT5_DETOUR_PREFIX, mt4State);
  assert.equal(afterDetourPrefix.floorId, "MT4");
  assertHeroAtLeast(afterDetourPrefix, { hp: 44773, atk: 737, def: 705, mdef: 4210, lv: 7, exp: 61 }, "MT4/MT5 detour prefix");

  const earlyEntry = replaySummaries(simulator, [
    "battle:poisonBat@MT4:4,11",
    "changeFloor@MT4:6,12",
  ], afterDetourPrefix);
  assert.equal(earlyEntry.floorId, "MT5");
  assertHeroAtLeast(earlyEntry, { hp: 44471, atk: 777, def: 745, mdef: 4910, exp: 77 }, "MT5 early gem entry");

  const returnedEarlyEntry = replaySummaries(simulator, [
    "changeFloor@MT5:6,12",
  ], earlyEntry);
  assert.equal(returnedEarlyEntry.floorId, "MT4");

  const decisionState = replaySummaries(simulator, [
    "battle:skeletonPriest@MT4:11,11",
    "battle:poisonBat@MT4:6,8",
  ], returnedEarlyEntry);
  assert.equal(decisionState.floorId, "MT4");
  assertHeroAtLeast(decisionState, { hp: 93836, atk: 927, def: 745, mdef: 5910, exp: 141 }, "MT4/MT5 first decision state");

  const firstEntry = replaySummaries(simulator, [
    "battle:skeletonKing@MT4:4,3",
    "changeFloor@MT4:6,12",
  ], decisionState);
  assert.equal(firstEntry.floorId, "MT5");
  assertHeroAtLeast(firstEntry, { hp: 78915, atk: 927, def: 795, mdef: 5910, exp: 173 }, "MT5 first entry");

  const firstSweep = replaySummaries(simulator, [
    "battle:skeletonKing@MT5:4,11",
    "battle:skeletonPresbyter@MT5:3,10",
    "battle:skeletonKing@MT5:8,11",
  ], firstEntry);
  assert.equal(firstSweep.floorId, "MT5");
  assertHeroAtLeast(firstSweep, { hp: 136514, atk: 977, def: 795, mdef: 6110, exp: 221 }, "MT5 first sweep");

  const afterSecondGroup = replaySummaries(simulator, [
    "battle:devilWarrior@MT5:11,11",
    "battle:skeletonKnight@MT5:1,11",
    "changeFloor@MT5:6,12",
    "battle:skeletonKing@MT4:8,3",
    "changeFloor@MT4:6,12",
  ], firstSweep);
  assertHeroAtLeast(afterSecondGroup, { hp: 105876, atk: 1077, def: 895, mdef: 6110, exp: 289 }, "MT5 second group");

  const afterThirdGate = replaySummaries(simulator, [
    "changeFloor@MT5:6,12",
    "battle:devilWarrior@MT4:10,5",
    "changeFloor@MT4:6,12",
    "battle:evilHero@MT5:9,10",
  ], afterSecondGroup);
  assertHeroAtLeast(afterThirdGate, { hp: 105138, atk: 1097, def: 965, mdef: 6310, exp: 367 }, "MT5 third gate");

  const afterSustainBalance = replaySummaries(simulator, [
    "battle:skeletonPresbyter@MT5:3,6",
  ], afterThirdGate);
  assertEffectiveHeroAtLeast(afterSustainBalance, { hp: 94905, atk: 1621, def: 1456, mdef: 7887 }, "MT5 sustain/forward balance");

  const beforeFinalHpPickup = replaySummaries(simulator, [
    "battle:devilWarrior@MT5:9,6",
    "battle:skeletonPresbyter@MT5:9,4",
    "battle:goldHornSlime@MT5:10,5",
    "equip:I894",
    "battle:goldHornSlime@MT5:3,4",
    "battle:redKing@MT5:4,7",
  ], afterSustainBalance);
  assertEffectiveHeroAtLeast(beforeFinalHpPickup, { hp: 417246, atk: 3147, def: 3096, mdef: 20816 }, "MT5 final stats before HP pickup");

  const beforeBlueKing = replaySummaries(simulator, [
    "battle:demonPriest@MT5:8,3",
  ], beforeFinalHpPickup);
  assertEffectiveHeroAtLeast(beforeBlueKing, { hp: 1098112, atk: 3147, def: 3096, mdef: 20816 }, "MT5 before blueKing");
  const blueKing = findAction(simulator, beforeBlueKing, "battle:blueKing@MT5:6,7");
  assert.ok(blueKing, `expected ${formatActionLabel(simulator.project, "battle:blueKing@MT5:6,7")} to be reachable`);
  assert.ok(
    beforeBlueKing.hero.hp > Number((blueKing.estimate || {}).damage || 0),
    `expected blueKing to be survivable: hp=${beforeBlueKing.hero.hp}, damage=${(blueKing.estimate || {}).damage}`
  );
  const afterBlueKing = simulator.applyAction(beforeBlueKing, blueKing);
  assertEffectiveHeroAtLeast(afterBlueKing, { hp: 4464, atk: 3467, def: 3416, mdef: 20816 }, "MT5 after blueKing");

  return {
    detourPrefix: {
      hp: afterDetourPrefix.hero.hp,
      atk: afterDetourPrefix.hero.atk,
      def: afterDetourPrefix.hero.def,
      mdef: afterDetourPrefix.hero.mdef,
      exp: afterDetourPrefix.hero.exp,
    },
    earlyEntry: {
      hp: earlyEntry.hero.hp,
      atk: earlyEntry.hero.atk,
      def: earlyEntry.hero.def,
      mdef: earlyEntry.hero.mdef,
      exp: earlyEntry.hero.exp,
    },
    firstDecision: {
      hp: decisionState.hero.hp,
      atk: decisionState.hero.atk,
      def: decisionState.hero.def,
      mdef: decisionState.hero.mdef,
      exp: decisionState.hero.exp,
    },
    firstSweep: {
      hp: firstSweep.hero.hp,
      atk: firstSweep.hero.atk,
      def: firstSweep.hero.def,
      mdef: firstSweep.hero.mdef,
      exp: firstSweep.hero.exp,
    },
    secondGroup: {
      required: [
        formatActionLabel(simulator.project, "battle:devilWarrior@MT5:11,11"),
        formatActionLabel(simulator.project, "battle:skeletonKnight@MT5:1,11"),
        "changeFloor@MT5:6,12",
        formatActionLabel(simulator.project, "battle:skeletonKing@MT4:8,3"),
        "changeFloor@MT4:6,12",
      ],
      final: {
        hp: afterSecondGroup.hero.hp,
        atk: afterSecondGroup.hero.atk,
        def: afterSecondGroup.hero.def,
        mdef: afterSecondGroup.hero.mdef,
        exp: afterSecondGroup.hero.exp,
      },
    },
    thirdGate: {
      required: [
        "changeFloor@MT5:6,12",
        formatActionLabel(simulator.project, "battle:devilWarrior@MT4:10,5"),
        "changeFloor@MT4:6,12",
        formatActionLabel(simulator.project, "battle:evilHero@MT5:9,10"),
      ],
      final: {
        hp: afterThirdGate.hero.hp,
        atk: afterThirdGate.hero.atk,
        def: afterThirdGate.hero.def,
        mdef: afterThirdGate.hero.mdef,
        exp: afterThirdGate.hero.exp,
      },
    },
    finalBoss: {
      required: [
        formatActionLabel(simulator.project, "battle:skeletonPresbyter@MT5:3,6"),
        formatActionLabel(simulator.project, "battle:devilWarrior@MT5:9,6"),
        formatActionLabel(simulator.project, "battle:skeletonPresbyter@MT5:9,4"),
        formatActionLabel(simulator.project, "battle:goldHornSlime@MT5:10,5"),
        "equip:I894",
        formatActionLabel(simulator.project, "battle:goldHornSlime@MT5:3,4"),
        formatActionLabel(simulator.project, "battle:redKing@MT5:4,7"),
        formatActionLabel(simulator.project, "battle:demonPriest@MT5:8,3"),
        formatActionLabel(simulator.project, "battle:blueKing@MT5:6,7"),
      ],
      beforeBlueKing: {
        hp: beforeBlueKing.hero.hp,
        effective: effectiveHero(beforeBlueKing),
        damage: Number((blueKing.estimate || {}).damage || 0),
      },
      final: {
        hp: afterBlueKing.hero.hp,
        atk: afterBlueKing.hero.atk,
        def: afterBlueKing.hero.def,
        mdef: afterBlueKing.hero.mdef,
        exp: afterBlueKing.hero.exp,
        effective: effectiveHero(afterBlueKing),
      },
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
      mt4Mt3ExperienceDetour: checkMt4Mt3ExperienceDetour(simulator),
      mt5SegmentedResourceRoute: checkMt5SegmentedResourceRoute(simulator),
      mt5BlueKingDoors: checkMt5BlueKingOpensMechanismDoors(simulator),
    },
  };
  console.log(JSON.stringify(result, null, 2));
}

main();
