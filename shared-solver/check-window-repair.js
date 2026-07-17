"use strict";

const assert = require("node:assert");
const path = require("node:path");

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const {
  buildStageGoals,
  buildPortalTransitions,
  collectRemovedTilesDelta,
  countPortalTransitionOverlap,
  deduplicateAndSortCandidates,
  compareCandidates,
  candidateSortKey,
  runRouteWindowRepair,
  validateCandidateFully,
} = require("./lib/route-window-repair");
const { loadProject } = require("./lib/project-loader");
const { readRouteFile } = require("./lib/route-store");
const { StaticSimulator } = require("./lib/simulator");

const PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const MT5_ROUTE_FILE = path.join(
  __dirname,
  "routes",
  "latest",
  "mt5-problem-before-9-10.route.json",
);

function makeContext() {
  const project = loadProject(PROJECT_ROOT);
  const simulator = new StaticSimulator(project, {
    battleResolver: new FunctionBackedBattleResolver(project),
  });
  const route = readRouteFile(MT5_ROUTE_FILE);
  return { project, simulator, route };
}

// ── Pure synthetic (no project load) ─────────────────────────────────

function checkRemovedTilesDelta() {
  const start = {
    floorStates: {
      MT4: { removed: { "1,1": true, "2,2": true }, replaced: {} },
      MT5: { removed: { "3,3": true }, replaced: {} },
    },
  };
  const end = {
    floorStates: {
      MT4: { removed: { "1,1": true, "2,2": true, "4,4": true, "5,5": true }, replaced: {} },
      MT5: { removed: { "3,3": true, "6,6": true }, replaced: {} },
    },
  };
  const delta = collectRemovedTilesDelta(start, end, ["MT4", "MT5"]);
  assert.equal(delta.length, 3, "delta should contain 3 new removals");
  const empty = collectRemovedTilesDelta(start, start, ["MT4"]);
  assert.equal(empty.length, 0, "identical states → empty delta");
  const filtered = collectRemovedTilesDelta(start, end, ["MT4"]);
  assert.equal(filtered.length, 2, "floor filter should exclude MT5");
  return { deltaCount: delta.length };
}

function checkStageGoalProgression() {
  const finalGoal = {
    minHero: { atk: 1097, def: 915, mdef: 6310, lv: 7, exp: 315 },
    equipmentIncludes: ["I893"],
    removedTiles: [{ floorId: "MT4", x: 1, y: 1 }],
    floorId: "MT5",
  };
  const s0 = buildStageGoals(0, finalGoal, null);
  assert.equal(s0.minHero.lv, 7);
  assert.ok(!s0.minHero.atk, "stage 0 should not require atk");
  const s1 = buildStageGoals(1, finalGoal, null);
  assert.equal(s1.minHero.atk, 907);
  assert.equal(s1.minHero.def, 775);
  const s2 = buildStageGoals(2, finalGoal, null);
  assert.deepEqual(s2, finalGoal);
  const overrides = [
    { minHero: { lv: 5 } },
    { minHero: { atk: 800, def: 600, mdef: 5000, lv: 6 } },
    null,
  ];
  assert.equal(buildStageGoals(0, finalGoal, overrides).minHero.lv, 5);
  assert.equal(buildStageGoals(1, finalGoal, overrides).minHero.atk, 800);
  assert.deepEqual(buildStageGoals(2, finalGoal, overrides), finalGoal);
  return { ok: true };
}

// ── Role-aware deduplication (pure synthetic) ─────────────────────────

function makeSyntheticCandidate(id, hp, atk, def, mdef, lv, routeLength) {
  const route = [];
  for (let i = 0; i < routeLength; i++) {
    route.push({ summary: `${id}-step-${i}` });
  }
  const state = {
    floorId: "MT5",
    hero: {
      loc: { x: 6, y: 12, direction: "down" },
      hp,
      hpmax: 99999,
      mana: 0,
      manamax: 0,
      atk,
      def,
      mdef,
      money: 0,
      exp: 0,
      lv,
      equipment: [],
      followers: [],
    },
    inventory: {},
    flags: {},
    visitedFloors: { MT5: true },
    floorStates: {
      MT4: { removed: {}, replaced: {} },
      MT5: { removed: {}, replaced: {} },
    },
    route: route.slice(),
    progress: { stageIndex: 0, milestoneMask: 0, visitedFloorMask: 0, bestFloorRank: 5 },
    meta: {},
  };
  return {
    id,
    state,
    route,
    hero: { hp, atk, def, mdef, lv, exp: 0 },
    effectiveHero: { atk, def, mdef },
    tags: [],
  };
}

function checkDeduplicateRoleAware() {
  // Six candidates with distinct role winners.
  // combatScore = hp + atk*10 + def*10 + mdef + lv*100
  //   c-hp:   100 + 500 + 500 + 50 + 500   = 1650
  //   c-atk:   80 + 900 + 500 + 50 + 500   = 2030
  //   c-def:   70 + 800 + 1000 + 50 + 500  = 2420
  //   c-mdef:  60 + 700 + 800 + 100 + 500  = 2160
  //   c-lv:    50 + 600 + 700 + 80 + 10000 = 11430  ← best-combat winner
  //   c-short: 40 + 500 + 600 + 70 + 9000  = 10210
  const candidates = [
    makeSyntheticCandidate("c-hp", 100, 50, 50, 50, 5, 10),
    makeSyntheticCandidate("c-atk", 80, 90, 50, 50, 5, 10),
    makeSyntheticCandidate("c-def", 70, 80, 100, 50, 5, 10),
    makeSyntheticCandidate("c-mdef", 60, 70, 80, 100, 5, 10),
    makeSyntheticCandidate("c-lv", 50, 60, 70, 80, 100, 10),
    makeSyntheticCandidate("c-short", 40, 50, 60, 70, 90, 1),
  ];

  // limit=4: role winners fill all slots.
  // ROLE_PICKERS order: highest-hp, best-combat, fewest-floorFly,
  // highest-atk, shortest. In this fixture fewest-floorFly duplicates c-hp,
  // so highest-atk and shortest still fill the 3rd/4th slots.
  const result4 = deduplicateAndSortCandidates(candidates, 0, 4);
  assert.equal(result4.length, 4, "should return 4 candidates");
  assert.equal(result4[0].id, "c-hp", "first pick should be highest-hp winner");
  assert.equal(result4[1].id, "c-lv", "second pick should be best-combat winner");
  assert.equal(result4[2].id, "c-atk", "third pick should be highest-atk winner");
  assert.equal(result4[3].id, "c-short", "fourth pick should be shortest winner");
  assert.ok(result4[0].tags.includes("highest-hp"), "c-hp should have highest-hp tag");
  assert.ok(result4[0].tags.includes("fewest-floorFly"), "c-hp should have fewest-floorFly tag");
  assert.ok(result4[1].tags.includes("best-combat"), "c-lv should have best-combat tag");
  assert.ok(result4[2].tags.includes("highest-atk"), "c-atk should have highest-atk tag");
  assert.ok(result4[3].tags.includes("shortest"), "c-short should have shortest tag");

  // limit=7: all role winners, plus composite-sort fill.
  // ROLE_PICKERS order includes fewest-floorFly, which duplicates c-hp here.
  // highest-lv also duplicates c-lv.
  const cFill = makeSyntheticCandidate("c-fill", 30, 40, 50, 60, 80, 10);
  const result7 = deduplicateAndSortCandidates(candidates.concat([cFill]), 0, 7);
  assert.equal(result7.length, 7, "should return all 7");
  // First 6 are role winners (in role order).
  assert.equal(result7[0].id, "c-hp");
  assert.equal(result7[1].id, "c-lv");
  assert.equal(result7[2].id, "c-atk");
  assert.equal(result7[3].id, "c-short");
  assert.equal(result7[4].id, "c-def");
  assert.equal(result7[5].id, "c-mdef");
  // 7th is composite-sort fill (highest-lv winner is c-lv, already selected).
  assert.equal(result7[6].id, "c-fill", "7th slot should be composite fill");

  const flyHp = makeSyntheticCandidate("fly-hp", 200, 50, 50, 50, 5, 2);
  flyHp.route[0] = { summary: "floorFly:MT5@MT4:1,1" };
  flyHp.state.route = flyHp.route.slice();
  const flyCombat = makeSyntheticCandidate("fly-combat", 100, 120, 120, 120, 5, 2);
  flyCombat.route[0] = { summary: "floorFly:MT5@MT4:2,1" };
  flyCombat.state.route = flyCombat.route.slice();
  const noFly = makeSyntheticCandidate("no-fly", 90, 40, 40, 40, 5, 4);
  const floorFlyResult = deduplicateAndSortCandidates([flyHp, flyCombat, noFly], 0, 3);
  assert.equal(floorFlyResult[0].id, "fly-hp");
  assert.equal(floorFlyResult[1].id, "fly-combat");
  assert.equal(floorFlyResult[2].id, "no-fly", "fewest-floorFly should preserve no-fly route");
  assert.ok(floorFlyResult[2].tags.includes("fewest-floorFly"));

  const baselinePortal = buildPortalTransitions(
    ["changeFloor@MT4:6,12", "changeFloor@MT5:6,12"],
    "MT4",
    ["MT4", "MT5"],
  );
  const candidatePortal = buildPortalTransitions(
    ["floorFly:MT5@MT4:3,3", "floorFly:MT4@MT5:2,11"],
    "MT4",
    ["MT4", "MT5"],
  );
  assert.deepEqual(
    baselinePortal.map((entry) => `${entry.from}->${entry.to}`),
    ["MT4->MT5", "MT5->MT4"],
  );
  assert.equal(
    countPortalTransitionOverlap(candidatePortal, baselinePortal),
    2,
    "floorFly and changeFloor should match by portal transition direction",
  );

  // Global IDs assigned correctly.
  for (let i = 0; i < result7.length; i++) {
    assert.ok(
      result7[i]._globalId.startsWith("stage-1-candidate-"),
      `global ID should start with stage-1-candidate-, got: ${result7[i]._globalId}`,
    );
  }

  // Deduplication: identical state+route → single entry.
  const dupResult = deduplicateAndSortCandidates(
    [candidates[0], { ...candidates[0] }],
    0,
    4,
  );
  assert.equal(dupResult.length, 1, "identical candidates should be deduped to 1");

  return { result4Count: result4.length, result7Count: result7.length };
}

function checkCompareCandidates() {
  const high = makeSyntheticCandidate("high", 200, 100, 100, 100, 10, 5);
  const low = makeSyntheticCandidate("low", 100, 50, 50, 50, 5, 5);
  assert.ok(compareCandidates(high, low) < 0, "higher HP should sort first");
  assert.ok(compareCandidates(low, high) > 0, "lower HP should sort after");

  const sameHpShort = makeSyntheticCandidate("short", 100, 50, 50, 50, 5, 3);
  const sameHpLong = makeSyntheticCandidate("long", 100, 50, 50, 50, 5, 10);
  assert.ok(
    compareCandidates(sameHpShort, sameHpLong) < 0,
    "shorter route should sort first when HP ties",
  );

  const key = candidateSortKey(high);
  assert.equal(key.hp, 200);
  assert.equal(key.atk, 100);
  assert.equal(key.routeLength, 5);
  // combatScore = hp + atk*10 + def*10 + mdef + lv*100
  // = 200 + 1000 + 1000 + 100 + 1000 = 3300
  assert.equal(key.combatScore, 3300, "combatScore should be hp+atk*10+def*10+mdef+lv*100");

  return { ok: true };
}

// ── Synthetic validation (needs project for getTileDefinitionAt) ──────

function checkValidateCandidateFullySynthetic() {
  const { project } = makeContext();
  const state = {
    floorId: "MT5",
    hero: {
      atk: 1100, def: 920, mdef: 6400, lv: 7, exp: 320,
      equipment: ["I893"], loc: { x: 6, y: 12 },
    },
    inventory: {},
    flags: {},
    visitedFloors: { MT5: true },
    floorStates: {
      MT4: { removed: { "4,7": true }, replaced: {} },
      MT5: { removed: {}, replaced: {} },
    },
    route: [],
    meta: {},
  };
  const goal = {
    floorId: "MT5",
    minHero: { atk: 1097, def: 915, mdef: 6310, lv: 7 },
    equipmentIncludes: ["I893"],
    removedTiles: [{ floorId: "MT4", x: 4, y: 7 }],
  };
  const pass = validateCandidateFully(project, state, goal);
  assert.equal(pass.length, 0, "synthetic state should pass all goal checks");

  const wrongFloor = validateCandidateFully(project, { ...state, floorId: "MT4" }, goal);
  assert.ok(wrongFloor.some((f) => f.field === "floorId"), "wrong floor should fail");

  const lowAtk = validateCandidateFully(project, {
    ...state, hero: { ...state.hero, atk: 900 },
  }, goal);
  assert.ok(lowAtk.some((f) => f.field === "hero.atk"), "low atk should fail");

  const noEquip = validateCandidateFully(project, {
    ...state, hero: { ...state.hero, equipment: [] },
  }, goal);
  assert.ok(noEquip.some((f) => f.field === "equipment"), "missing equipment should fail");

  return {
    passCount: pass.length,
    wrongFloorFailures: wrongFloor.length,
    lowAtkFailures: lowAtk.length,
    noEquipFailures: noEquip.length,
  };
}

// ── Route-dependent structural checks (fast, no DP search) ────────────

function checkFixtureShape() {
  const { route } = makeContext();
  const decisions = route.decisions || [];
  assert.equal(decisions.length, 80, "fixture should have exactly 80 decisions");
  assert.equal(route.final.floorId, "MT5");
  assert.equal(route.final.snapshot.hero.hp, 48049);
  assert.ok(decisions[59].summary.includes("MT4"), "step 60 (idx 59) should be on MT4");
  return { decisionCount: decisions.length, finalHp: route.final.snapshot.hero.hp };
}

function checkInvalidWindowRejection() {
  const { project, simulator, route } = makeContext();
  const r1 = runRouteWindowRepair(project, simulator, route, { id: "t" }, {
    windowStart: 0, windowEnd: 10, windowFloors: ["MT4"],
  });
  assert.equal(r1.ok, false);
  assert.equal(r1.stoppedReason, "invalid-window");
  const r2 = runRouteWindowRepair(project, simulator, route, { id: "t" }, {
    windowStart: 60, windowEnd: 200, windowFloors: ["MT4"],
  });
  assert.equal(r2.ok, false);
  assert.equal(r2.stoppedReason, "invalid-window");
  return { ok: true };
}

function checkDisableFloorFlyPolicy() {
  const { project, simulator, route } = makeContext();
  const profile = {
    id: "t-fly",
    windowStart: 60,
    windowEnd: 80,
    floors: ["MT4", "MT5"],
  };

  // With disableFloorFly: true, "floorFly" should NOT be in actionKinds.
  const rDisabled = runRouteWindowRepair(project, simulator, route, profile, {
    disableFloorFly: true,
    windowMaxExpansions: 1,
    windowMaxRuntimeMs: 100,
  });
  const apDisabled = (rDisabled.debugTrace || []).find(
    (entry) => entry.label === "action-policy",
  );
  assert.ok(apDisabled, "debug trace should contain an action-policy entry");
  assert.equal(apDisabled.disableFloorFly, true, "disableFloorFly should be true");
  assert.ok(
    !apDisabled.actionKinds.includes("floorFly"),
    "floorFly should be excluded from actionKinds when disableFloorFly is true",
  );

  // With disableFloorFly: false (default), "floorFly" should be in actionKinds.
  const rEnabled = runRouteWindowRepair(project, simulator, route, profile, {
    preserveWindowPrefix: 1,
    windowMaxExpansions: 1,
    windowMaxRuntimeMs: 100,
  });
  const apEnabled = (rEnabled.debugTrace || []).find(
    (entry) => entry.label === "action-policy",
  );
  assert.ok(apEnabled, "debug trace should contain an action-policy entry");
  assert.equal(apEnabled.disableFloorFly, false, "disableFloorFly should be false by default");
  assert.equal(apEnabled.preserveWindowPrefix, 1, "preserveWindowPrefix should be reflected in debug trace");
  assert.ok(
    apEnabled.actionKinds.includes("floorFly"),
    "floorFly should be included in actionKinds by default",
  );

  // maxFloorFlyPerTarget should appear when explicitly set.
  const rCapped = runRouteWindowRepair(project, simulator, route, profile, {
    maxFloorFlyPerTarget: 2,
    windowMaxExpansions: 1,
    windowMaxRuntimeMs: 100,
  });
  const apCapped = (rCapped.debugTrace || []).find(
    (entry) => entry.label === "action-policy",
  );
  assert.ok(apCapped, "debug trace should contain an action-policy entry");
  assert.equal(apCapped.maxFloorFlyPerTarget, 2, "maxFloorFlyPerTarget should be 2");

  // enableFloorFlyFinalStage: when true with disableFloorFly, the action
  // policy should show the flag, and the final stage should get a
  // stage-action-policy-override with floorFly re-enabled.
  const rFinalFly = runRouteWindowRepair(project, simulator, route, profile, {
    disableFloorFly: true,
    enableFloorFlyFinalStage: true,
    maxFloorFlyPerTarget: 2,
    windowMaxExpansions: 1,
    windowMaxRuntimeMs: 100,
  });
  const apFinalFly = (rFinalFly.debugTrace || []).find(
    (entry) => entry.label === "action-policy",
  );
  assert.ok(apFinalFly, "debug trace should contain an action-policy entry");
  assert.equal(apFinalFly.disableFloorFly, true, "disableFloorFly should be true");
  assert.equal(apFinalFly.enableFloorFlyFinalStage, true, "enableFloorFlyFinalStage should be true");
  assert.equal(
    apFinalFly.maxFloorFlyPerTarget,
    2,
    "maxFloorFlyPerTarget should be preserved for final-stage override",
  );
  assert.ok(
    !apFinalFly.actionKinds.includes("floorFly"),
    "base actionKinds should still exclude floorFly",
  );
  // The stage-action-policy-override entry is only pushed when the final
  // stage is reached.  With a tiny budget, earlier stages may return early.
  // Verify the override exists if stage 2 was reached.
  const override = (rFinalFly.debugTrace || []).find(
    (entry) => entry.label === "stage-action-policy-override",
  );
  if (override) {
    assert.ok(
      override.actionKinds.includes("floorFly"),
      "override actionKinds should include floorFly",
    );
    assert.equal(
      override.maxFloorFlyPerTarget,
      2,
      "override should inherit maxFloorFlyPerTarget",
    );
  }

  return { ok: true };
}

// ── Main ──────────────────────────────────────────────────────────────

function main() {
  const removedDelta = checkRemovedTilesDelta();
  const stageGoals = checkStageGoalProgression();
  const roleAware = checkDeduplicateRoleAware();
  const compare = checkCompareCandidates();
  const fixtureShape = checkFixtureShape();
  const invalidWindow = checkInvalidWindowRejection();
  const disableFloorFly = checkDisableFloorFlyPolicy();
  const validateSynthetic = checkValidateCandidateFullySynthetic();
  console.log(JSON.stringify({
    removedDelta,
    stageGoals,
    roleAware,
    compare,
    fixtureShape,
    invalidWindow,
    disableFloorFly,
    validateSynthetic,
  }, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  }
}

module.exports = { main };
