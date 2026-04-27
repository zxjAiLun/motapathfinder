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
  const route = (state.route || []).filter((step) => !String(step).startsWith("auto:"));
  for (const step of route) {
    assert.ok(
      !String(step).startsWith("resourcePocket:") &&
      !String(step).startsWith("resourceChain:") &&
      !String(step).startsWith("resourceCluster:"),
      `${label}: route should not contain macro action ${step}`
    );
  }
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
  const route = final.route || [];
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
  return {
    reachedMilestone: result.reachedMilestone,
    completedSegments,
    hp: final.hero.hp,
    atk: final.hero.atk,
    def: final.hero.def,
    mdef: final.hero.mdef,
    routeLength: (result.finalCandidate.route || []).length,
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

function main() {
  const simulator = makeSimulator();
  const safety = checkMilestoneSafetyAnnotations(simulator);
  const mt2 = checkMt2Hp3834ToI893(simulator);
  const mt5 = checkMt5ThirdGateToBlueKing(simulator);
  const failure = checkFailureDiagnostics(simulator);
  console.log(JSON.stringify({ safety, mt2, mt5, failure }, null, 2));
}

main();
