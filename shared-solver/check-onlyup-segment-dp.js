"use strict";

const assert = require("node:assert");
const path = require("node:path");

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { getMilestoneById, getMilestoneSpec } = require("./lib/milestone-spec");
const { loadProject } = require("./lib/project-loader");
const { readRouteFile } = require("./lib/route-store");
const { runMilestoneGraph, searchSegmentDP } = require("./lib/segment-dp");
const { StaticSimulator } = require("./lib/simulator");

const PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const MT2_HP3834_FIXTURE = path.join(__dirname, "routes", "fixtures", "mt1-mt2-hp3834.route.json");
const MT4_HP6428_FIXTURE = path.join(__dirname, "routes", "fixtures", "mt1-mt4-hp6428-best.route.json");

const MT5_THIRD_GATE_SUFFIX = [
  "battle:greenKing@MT4:4,1",
  "battle:blueKnight@MT4:2,1",
  "changeFloor@MT4:6,0",
  "changeFloor@MT3:6,0",
  "battle:goldSlime@MT4:4,7",
  "battle:poisonSkeleton@MT4:6,6",
  "battle:poisonSkeleton@MT4:10,8",
  "battle:poisonSkeleton@MT4:2,8",
  "battle:poisonSkeleton@MT4:3,10",
  "battle:poisonBat@MT4:4,11",
  "changeFloor@MT4:6,12",
  "changeFloor@MT5:6,12",
  "battle:skeletonPriest@MT4:11,11",
  "battle:poisonBat@MT4:6,8",
  "battle:skeletonKing@MT4:4,3",
  "changeFloor@MT4:6,12",
  "battle:skeletonKing@MT5:4,11",
  "battle:skeletonPresbyter@MT5:3,10",
  "battle:skeletonKing@MT5:8,11",
  "battle:devilWarrior@MT5:11,11",
  "battle:skeletonKnight@MT5:1,11",
  "changeFloor@MT5:6,12",
  "battle:skeletonKing@MT4:8,3",
  "changeFloor@MT4:6,12",
  "changeFloor@MT5:6,12",
  "battle:devilWarrior@MT4:10,5",
  "changeFloor@MT4:6,12",
  "battle:evilHero@MT5:9,10",
];

function makeSimulator() {
  const project = loadProject(PROJECT_ROOT);
  return new StaticSimulator(project, {
    stopFloorId: "MT6",
    battleResolver: new FunctionBackedBattleResolver(project),
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFightToLevelUp: false,
    enableResourcePocket: false,
    enableResourceCluster: false,
    enableResourceChain: false,
    searchGraphMode: "primitive",
  });
}

function findAction(simulator, state, summary) {
  return (simulator.enumeratePrimitiveActions(state).actions || []).find((action) => action.summary === summary)
    || simulator.enumerateActions(state).find((action) => action.summary === summary)
    || null;
}

function replayRoute(simulator, filePath) {
  const route = readRouteFile(filePath);
  let state = simulator.createInitialState({ rank: "chaos" });
  for (const decision of route.decisions || []) {
    const action = findAction(simulator, state, decision.summary);
    assert.ok(action, `missing replay action ${decision.summary}`);
    state = simulator.applyAction(state, action);
  }
  return state;
}

function applySummary(simulator, state, summary) {
  const action = findAction(simulator, state, summary);
  assert.ok(action, `missing replay action ${summary}`);
  return simulator.applyAction(state, action);
}

function replaySummaries(simulator, startState, summaries) {
  return summaries.reduce((state, summary) => applySummary(simulator, state, summary), startState);
}

function loadMt5ThirdGateState(simulator) {
  return replaySummaries(simulator, replayRoute(simulator, MT4_HP6428_FIXTURE), MT5_THIRD_GATE_SUFFIX);
}

function assertNoMacroRoute(state, label) {
  const route = (state.route || [])
    .map((step) => String(step && (step.summary || step)))
    .filter((step) => !step.startsWith("auto:"));
  for (const step of route) {
    assert.ok(
      !step.startsWith("resourcePocket:") &&
      !step.startsWith("resourceChain:") &&
      !step.startsWith("resourceCluster:"),
      `${label}: route should not contain macro action ${step}`
    );
  }
}

function routeSummaries(state) {
  return (state.route || []).map((step) => String(step && (step.summary || step)));
}

function tileKey(tile) {
  return `${tile.floorId}:${tile.x},${tile.y}`;
}

function checkMilestoneSafetyAnnotations(simulator) {
  const spec = getMilestoneSpec(simulator.project, "onlyup-chaos-mt5-blueking");
  for (const milestone of spec.milestones || []) {
    const dp = milestone.dp || {};
    if ((dp.keyMode || dp.dpKeyMode) === "mutation") {
      assert.ok(
        typeof dp.safeReason === "string" && dp.safeReason.trim().length > 0,
        `${milestone.id}: mutation keyMode must include dp.safeReason`
      );
    }
    if (dp.stopOnFirstGoal === true) {
      assert.ok(
        typeof dp.firstGoalSafeReason === "string" && dp.firstGoalSafeReason.trim().length > 0,
        `${milestone.id}: stopOnFirstGoal=true must include dp.firstGoalSafeReason`
      );
    }
    const hard = new Set(((milestone.goal || {}).presentTiles || []).map(tileKey));
    for (const preferred of ((milestone.goal || {}).preferredPresentTiles || [])) {
      assert.ok(
        !hard.has(tileKey(preferred)),
        `${milestone.id}: preferredPresentTiles must not duplicate hard presentTiles: ${tileKey(preferred)}`
      );
    }
  }
  return {
    milestones: (spec.milestones || []).length,
    mutationMilestones: (spec.milestones || []).filter((milestone) => ((milestone.dp || {}).keyMode || (milestone.dp || {}).dpKeyMode) === "mutation").length,
    firstGoalMilestones: (spec.milestones || []).filter((milestone) => (milestone.dp || {}).stopOnFirstGoal === true).length,
  };
}

function checkMt5ThirdGateToBlueKing(simulator) {
  const project = simulator.project;
  const spec = getMilestoneSpec(project, "onlyup-chaos-mt5-blueking");
  const start = loadMt5ThirdGateState(simulator);
  const result = runMilestoneGraph(simulator, start, spec, {
    fromMilestoneId: "mt5-third-gate",
    toMilestoneId: "mt5-blueking-kill",
    candidateLimit: 4,
    maxRuntimeMs: 12000,
  });
  assert.equal(result.found, true, `MT5 segment graph should defeat blueKing: ${JSON.stringify(result.failedSegment || null)}`);
  const final = result.finalCandidate && result.finalCandidate.state;
  assert.ok(final, "MT5 segment graph should return a final candidate");
  assert.equal(final.floorId, "MT5");
  assert.ok(final.hero.hp >= 1, `expected positive HP after blueKing, got ${final.hero.hp}`);
  const completedSegments = (result.segmentResults || []).filter((segment) => segment.found).map((segment) => segment.segmentId);
  for (const segmentId of [
    "mt5-sustain-balance",
    "mt5-i894-equipped",
    "mt5-final-stats-before-hp",
    "mt5-before-blueking",
    "mt5-blueking-kill",
  ]) {
    assert.ok(completedSegments.includes(segmentId), `MT5 segment graph should complete ${segmentId}`);
  }
  const route = routeSummaries(final);
  for (const summary of [
    "battle:skeletonPresbyter@MT5:3,6",
    "battle:goldHornSlime@MT5:10,5",
    "equip:I894",
    "battle:redKing@MT5:4,7",
    "battle:demonPriest@MT5:8,3",
    "battle:blueKing@MT5:6,7",
  ]) {
    assert.ok(route.includes(summary), `MT5 route should include ${summary}`);
  }
  assertNoMacroRoute(final, "MT5 segment graph");
  const mt6Result = runMilestoneGraph(simulator, final, spec, {
    fromMilestoneId: "mt5-blueking-kill",
    toMilestoneId: "mt6-upper-right-blueking",
    candidateLimit: 4,
    maxRuntimeMs: 15000,
  });
  assert.equal(mt6Result.found, true, `MT6 getNext segment should pass: ${JSON.stringify(mt6Result.failedSegment || null)}`);
  const mt6Final = mt6Result.finalCandidate && mt6Result.finalCandidate.state;
  assert.ok(mt6Final, "MT6 getNext segment should return a final candidate");
  const mt6Route = routeSummaries(mt6Final);
  assert.ok(mt6Route.includes("getNext:weakWine@MT6:7,7"), "MT6 route should use getNext for the 7,7 weakWine pickup");
  assert.ok(!mt6Route.includes("pickup:weakWine@MT6:7,7"), "MT6 route should not step onto the 7,7 weakWine tile");
  assertNoMacroRoute(mt6Final, "MT6 getNext segment graph");
  const mt7Result = runMilestoneGraph(simulator, final, spec, {
    fromMilestoneId: "mt5-blueking-kill",
    toMilestoneId: "mt7-entry-after-mt6-sweep",
    candidateLimit: 4,
    maxRuntimeMs: 20000,
  });
  assert.equal(mt7Result.found, true, `MT6->MT7 segment graph should pass: ${JSON.stringify(mt7Result.failedSegment || null)}`);
  const mt7Final = mt7Result.finalCandidate && mt7Result.finalCandidate.state;
  assert.ok(mt7Final, "MT6->MT7 segment graph should return a final candidate");
  const mt7Route = routeSummaries(mt7Final);
  const getNextIndex = mt7Route.indexOf("getNext:weakWine@MT6:7,7");
  const leftAttackIndex = mt7Route.indexOf("battle:whiteHornSlime@MT6:1,11");
  const rightAttackIndex = mt7Route.indexOf("battle:whiteHornSlime@MT6:10,8");
  const centerGuardIndex = mt7Route.indexOf("battle:silverSlime@MT6:6,6");
  assert.ok(getNextIndex >= 0, "MT6->MT7 route should include explicit 7,7 getNext");
  assert.ok(leftAttackIndex > getNextIndex, "MT6->MT7 route should take 1,11 attack resource after getNext");
  assert.ok(rightAttackIndex > getNextIndex, "MT6->MT7 route should take 10,8 attack resource after getNext");
  assert.ok(centerGuardIndex > leftAttackIndex && centerGuardIndex > rightAttackIndex, "MT6->MT7 route should delay 6,6 center guard until after both attack resources");
  assert.equal(mt7Route[mt7Route.length - 1], "changeFloor@MT6:6,12", "MT7 entry route should stop at the MT7 staircase instead of consuming MT7 fights");
  assert.ok(!mt7Route.some((summary) => /^battle:[^@]+@MT7:/.test(String(summary))), "MT7 entry segment should not include MT7 battles");
  assertNoMacroRoute(mt7Final, "MT6->MT7 segment graph");
  const mt7RightExpResult = runMilestoneGraph(simulator, final, spec, {
    fromMilestoneId: "mt5-blueking-kill",
    toMilestoneId: "mt7-right-exp-crystal",
    candidateLimit: 4,
    maxRuntimeMs: 22000,
  });
  assert.equal(mt7RightExpResult.found, true, `MT6->MT7 right exp crystal graph should pass: ${JSON.stringify(mt7RightExpResult.failedSegment || null)}`);
  const mt7RightExpFinal = mt7RightExpResult.finalCandidate && mt7RightExpResult.finalCandidate.state;
  assert.ok(mt7RightExpFinal, "MT6->MT7 right exp crystal graph should return a final candidate");
  assert.equal(mt7RightExpFinal.floorId, "MT7");
  assert.ok(mt7RightExpFinal.hero.hp >= 298478, `expected MT7 right exp hp >= 298478, got ${mt7RightExpFinal.hero.hp}`);
  assert.ok(mt7RightExpFinal.hero.def >= 5535, `expected MT7 right exp def >= 5535, got ${mt7RightExpFinal.hero.def}`);
  assert.ok(mt7RightExpFinal.hero.exp >= 1855, `expected MT7 right exp exp >= 1855, got ${mt7RightExpFinal.hero.exp}`);
  const mt7RightExpRoute = routeSummaries(mt7RightExpFinal);
  const mt6DefenseIndex = mt7RightExpRoute.indexOf("battle:evilFairy@MT6:2,1");
  const mt6SilverIndex = mt7RightExpRoute.indexOf("battle:silverSlime@MT6:9,10");
  const mt6PriestIndex = mt7RightExpRoute.indexOf("battle:yellowPriest@MT6:11,11");
  const mt7LeftFairyIndex = mt7RightExpRoute.indexOf("battle:evilFairy@MT7:4,11");
  const mt7RightFairyIndex = mt7RightExpRoute.indexOf("battle:evilFairy@MT7:8,11");
  const mt7PriestIndex = mt7RightExpRoute.indexOf("battle:yellowPriest@MT7:11,11");
  assert.ok(mt6DefenseIndex >= 0, "MT7 route should return to MT6 and clear 2,1 defense resource");
  assert.ok(mt6SilverIndex > mt6DefenseIndex, "MT7 route should clear MT6 9,10 after MT6 2,1 defense resource");
  assert.ok(mt6PriestIndex > mt6SilverIndex, "MT7 route should clear MT6 11,11 after MT6 9,10 sustain pickup");
  assert.ok(mt7LeftFairyIndex > mt6PriestIndex, "MT7 route should delay MT7 left fairy until after MT6 right crystal sweep");
  assert.ok(mt7RightFairyIndex > mt6PriestIndex, "MT7 route should delay MT7 right fairy until after MT6 right crystal sweep");
  assert.ok(mt7PriestIndex > mt7LeftFairyIndex && mt7PriestIndex > mt7RightFairyIndex, "MT7 route should clear both bottom fairies before MT7 11,11 crystal guard");
  assertNoMacroRoute(mt7RightExpFinal, "MT6->MT7 right exp crystal graph");
  return {
    reachedMilestone: result.reachedMilestone,
    completedSegments,
    hp: final.hero.hp,
    atk: final.hero.atk,
    def: final.hero.def,
    mdef: final.hero.mdef,
    routeLength: (result.finalCandidate.route || []).length,
    mt6GetNext: {
      reachedMilestone: mt6Result.reachedMilestone,
      hp: mt6Final.hero.hp,
      atk: mt6Final.hero.atk,
      def: mt6Final.hero.def,
      mdef: mt6Final.hero.mdef,
      routeLength: (mt6Result.finalCandidate.route || []).length,
    },
    mt7Entry: {
      reachedMilestone: mt7Result.reachedMilestone,
      hp: mt7Final.hero.hp,
      atk: mt7Final.hero.atk,
      def: mt7Final.hero.def,
      mdef: mt7Final.hero.mdef,
      routeLength: (mt7Result.finalCandidate.route || []).length,
    },
    mt7RightExp: {
      reachedMilestone: mt7RightExpResult.reachedMilestone,
      hp: mt7RightExpFinal.hero.hp,
      atk: mt7RightExpFinal.hero.atk,
      def: mt7RightExpFinal.hero.def,
      mdef: mt7RightExpFinal.hero.mdef,
      exp: mt7RightExpFinal.hero.exp,
      routeLength: (mt7RightExpResult.finalCandidate.route || []).length,
    },
  };
}

function checkMt2Hp3834ToI893(simulator) {
  const project = simulator.project;
  const spec = getMilestoneSpec(project, "onlyup-chaos-mt5-blueking");
  const start = replayRoute(simulator, MT2_HP3834_FIXTURE);
  const result = runMilestoneGraph(simulator, start, spec, {
    fromMilestoneId: "mt2-hp3834",
    toMilestoneId: "mt3-i893-hp8425",
    candidateLimit: 4,
    maxRuntimeMs: 6000,
  });
  assert.equal(result.found, true, `MT2 segment graph should reach MT3 I893: ${JSON.stringify(result.failedSegment || null)}`);
  const final = result.finalCandidate && result.finalCandidate.state;
  assert.ok(final, "MT2 segment graph should return a final candidate");
  assert.equal(final.floorId, "MT3");
  assert.ok(final.hero.hp >= 8425, `expected hp >= 8425, got ${final.hero.hp}`);
  assert.ok(final.hero.atk >= 107, `expected atk >= 107, got ${final.hero.atk}`);
  assert.ok(final.hero.def >= 100, `expected def >= 100, got ${final.hero.def}`);
  assert.ok(final.hero.mdef >= 510, `expected mdef >= 510, got ${final.hero.mdef}`);
  assert.ok((final.hero.equipment || []).includes("I893"), "expected equipment to include I893");
  assertNoMacroRoute(final, "MT2 segment graph");
  return {
    reachedMilestone: result.reachedMilestone,
    hp: final.hero.hp,
    atk: final.hero.atk,
    def: final.hero.def,
    mdef: final.hero.mdef,
    routeLength: (result.finalCandidate.route || []).length,
  };
}

function checkFailureDiagnostics(simulator) {
  const project = simulator.project;
  const segment = getMilestoneById(project, "onlyup-chaos-mt5-blueking", "mt5-blueking-kill");
  const start = loadMt5ThirdGateState(simulator);
  start.hero.hp = 1;
  const result = searchSegmentDP(simulator, start, segment, {
    candidateId: "synthetic-low-hp",
    candidateLimit: 2,
    dpOverrides: {
      maxExpansions: 10,
      maxRuntimeMs: 1000,
      stopOnFirstGoal: false,
    },
  });
  assert.equal(result.found, false, "low-HP synthetic start should fail the boss segment");
  assert.ok(result.diagnostics.failure, "failed segment should include failure diagnostics");
  assert.ok(result.diagnostics.failure.missingGoalFields.length > 0, "failure diagnostics should include missing goal fields");
  assert.ok(result.diagnostics.failure.failureClass, "failure diagnostics should classify the failure");
  assert.ok(
    Array.isArray(result.diagnostics.failure.preferredCandidateTags) &&
      result.diagnostics.failure.preferredCandidateTags.length > 0,
    "failure diagnostics should recommend rollback candidate tags"
  );
  assert.ok(result.diagnostics.failure.recommendedRepair, "failure diagnostics should recommend a repair direction");
  return result.diagnostics.failure;
}

function makeSyntheticBacktrackSimulator() {
  const project = {
    data: { firstData: { title: "synthetic", floorId: "SYN", hero: {} } },
    floorsById: { SYN: { width: 3, height: 1, map: [[0, 0, 0]], changeFloor: {} } },
    mapTilesByNumber: {},
    floorOrder: ["SYN"],
  };
  const clone = (value) => JSON.parse(JSON.stringify(value));
  return {
    project,
    stopFloorId: "SYN",
    buildReachableRegionSignature(state) {
      return {
        regionKey: `${state.floorId}:region`,
        reachableEndpointsKey: "",
        counts: {},
      };
    },
    enumerateActions(state) {
      return this.enumeratePrimitiveActions(state).actions;
    },
    enumeratePrimitiveActions(state) {
      const flags = state.flags || {};
      if (flags.aHp || flags.zAtk) return { actions: [] };
      return {
        actions: [
          { kind: "pickup", summary: "pickup:aHp@SYN:0,0", floorId: "SYN", itemId: "aHp" },
          { kind: "pickup", summary: "pickup:zAtk@SYN:1,0", floorId: "SYN", itemId: "zAtk" },
        ],
      };
    },
    applyAction(state, action) {
      const next = clone(state);
      next.route = Array.isArray(next.route) ? next.route.slice() : [];
      next.route.push(action.summary);
      next.flags = next.flags || {};
      next.meta = next.meta || {};
      next.meta.decisionDepth = Number(next.meta.decisionDepth || 0) + 1;
      if (action.summary === "pickup:aHp@SYN:0,0") {
        next.flags.aHp = true;
        next.hero.hp = 200;
        next.hero.exp = 1;
      } else if (action.summary === "pickup:zAtk@SYN:1,0") {
        next.flags.zAtk = true;
        next.hero.hp = 80;
        next.hero.atk = 10;
        next.hero.exp = 1;
      } else {
        throw new Error(`unexpected synthetic action ${action.summary}`);
      }
      return next;
    },
  };
}

function checkFailureBacktracking() {
  const simulator = makeSyntheticBacktrackSimulator();
  const initialState = {
    floorId: "SYN",
    hero: { hp: 100, atk: 1, def: 1, mdef: 1, lv: 1, exp: 0, money: 0, equipment: [] },
    inventory: {},
    flags: {},
    visitedFloors: {},
    floorStates: {},
    route: [],
    meta: { decisionDepth: 0 },
  };
  const spec = {
    routeName: "synthetic-backtrack",
    milestones: [
      {
        id: "prep",
        label: "Synthetic prep",
        goal: { type: "heroAtLeast", floorId: "SYN", minHero: { exp: 1 } },
        actionPolicy: { allowedFloors: ["SYN"], actionKinds: ["pickup"] },
        dp: {
          keyMode: "location",
          stopOnFirstGoal: true,
          firstGoalSafeReason: "Synthetic test intentionally forces first-goal repair coverage.",
          maxExpansions: 4,
          maxRuntimeMs: 1000,
          goalSkylineLimit: 1,
        },
      },
      {
        id: "gate",
        label: "Synthetic atk gate",
        startFrom: "prep",
        goal: { type: "heroAtLeast", floorId: "SYN", minHero: { atk: 10 } },
        actionPolicy: { allowedFloors: ["SYN"], actionKinds: ["pickup"] },
        dp: {
          keyMode: "location",
          stopOnFirstGoal: true,
          firstGoalSafeReason: "Synthetic gate is already satisfied by the repaired prep candidate.",
          maxExpansions: 2,
          maxRuntimeMs: 1000,
          goalSkylineLimit: 1,
        },
      },
    ],
  };

  const withoutRepair = runMilestoneGraph(simulator, initialState, spec, {
    candidateLimit: 1,
    enableFailureBacktracking: false,
  });
  assert.equal(withoutRepair.found, false, "synthetic graph should fail without failure backtracking");
  assert.equal(withoutRepair.failedSegment.segmentId, "gate");

  const withRepair = runMilestoneGraph(simulator, initialState, spec, {
    candidateLimit: 1,
    enableFailureBacktracking: true,
  });
  assert.equal(withRepair.found, true, `synthetic graph should repair from previous milestone: ${JSON.stringify(withRepair.failedSegment || null)}`);
  assert.equal(withRepair.reachedMilestone, "gate");
  const repairedRoute = (withRepair.finalCandidate.route || []).map((entry) => String(entry && (entry.summary || entry)));
  assert.ok(withRepair.finalCandidate.state.hero.atk >= 10, "repair should select the highest-atk prep candidate");
  assert.ok(repairedRoute.includes("pickup:zAtk@SYN:1,0"), "repair route should use the high-atk branch");
  assert.ok((withRepair.segmentResults[0] || {}).backtrack, "previous segment should record backtrack expansion metadata");
  assert.ok((withRepair.segmentResults[1] || {}).backtrack, "current segment should record retry metadata");
  return {
    withoutRepair: {
      found: withoutRepair.found,
      failedSegmentId: withoutRepair.failedSegment.segmentId,
    },
    withRepair: {
      found: withRepair.found,
      reachedMilestone: withRepair.reachedMilestone,
      route: repairedRoute,
      backtrack: withRepair.segmentResults.map((segment) => segment.backtrack || null),
    },
  };
}

function main() {
  const simulator = makeSimulator();
  const safety = checkMilestoneSafetyAnnotations(simulator);
  const mt2 = checkMt2Hp3834ToI893(simulator);
  const mt5 = checkMt5ThirdGateToBlueKing(simulator);
  const failure = checkFailureDiagnostics(simulator);
  const backtracking = checkFailureBacktracking();
  console.log(JSON.stringify({ safety, mt2, mt5, failure, backtracking }, null, 2));
}

main();
