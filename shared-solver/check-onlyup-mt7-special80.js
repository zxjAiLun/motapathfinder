"use strict";

const assert = require("node:assert");
const path = require("node:path");

const { runAdaptiveSegmentPlanner } = require("./lib/adaptive-segment-planner");
const { estimateBattleSurvivability } = require("./lib/battle-thresholds");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { getMilestoneSpec } = require("./lib/milestone-spec");
const { loadProject } = require("./lib/project-loader");
const { readRouteFile } = require("./lib/route-store");
const { scanResourceIntents } = require("./lib/resource-intent-scanner");
const { getTileDefinitionAt } = require("./lib/state");
const { StaticSimulator } = require("./lib/simulator");

const PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const ROUTE_NAME = "onlyup-chaos-mt5-blueking";
const START_ROUTE = path.join(__dirname, "routes", "latest", "segmented-mt7-right-exp-crystal.route.json");
const ADAPTIVE_START_ROUTE = path.join(__dirname, "routes", "latest", "checkpoints", "onlyup-chaos-mt5-blueking", "mt7-bottom-double-fairy.route.json");

function makeSimulator() {
  const project = loadProject(PROJECT_ROOT);
  return new StaticSimulator(project, {
    stopFloorId: "MT11",
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

function enumerateAllActions(simulator, state) {
  const actions = [];
  const seen = new Set();
  const add = (list) => {
    (list || []).forEach((action) => {
      if (!action || !action.summary || seen.has(action.summary)) return;
      seen.add(action.summary);
      actions.push(action);
    });
  };
  try {
    add(simulator.enumeratePrimitiveActions(state).actions || []);
  } catch (error) {
  }
  try {
    add(simulator.enumerateActions(state) || []);
  } catch (error) {
  }
  try {
    if (typeof simulator.enumerateInteractPickupActions === "function") add(simulator.enumerateInteractPickupActions(state) || []);
  } catch (error) {
  }
  try {
    if (typeof simulator.enumerateFloorFlyActions === "function") add(simulator.enumerateFloorFlyActions(state) || []);
  } catch (error) {
  }
  return actions;
}

function findAction(simulator, state, summary) {
  return enumerateAllActions(simulator, state).find((action) => action.summary === summary) || null;
}

function replayRoute(simulator, routeFile) {
  const record = readRouteFile(routeFile);
  let state = simulator.createInitialState({ rank: "chaos" });
  for (const decision of record.decisions || []) {
    const action = findAction(simulator, state, decision.summary);
    assert.ok(action, `missing replay action ${decision.index}: ${decision.summary}`);
    state = simulator.applyAction(state, action);
  }
  return state;
}

function actionSurvivableMissing(threshold) {
  return {
    field: "actionSurvivable",
    expected: `hp > ${threshold.currentDamage}`,
    actual: threshold.currentHp,
    action: "battle:poisonZombie@MT7:1,11",
    damage: threshold.currentDamage,
    enemyId: threshold.enemyId,
    enemyLabel: threshold.enemyLabel,
    riskTags: threshold.riskTags,
    minHpToSurvive: threshold.minHpToSurvive,
  };
}

function assertRemoved(project, state, floorId, x, y, label) {
  assert.equal(getTileDefinitionAt(project, state, floorId, x, y), null, `${label} should be removed`);
}

function checkThreshold(simulator, state) {
  const threshold = estimateBattleSurvivability(simulator, state, {
    floorId: "MT7",
    x: 1,
    y: 11,
    enemyId: "poisonZombie",
  });
  assert.equal(threshold.supported, true, `threshold should be supported: ${JSON.stringify(threshold)}`);
  assert.equal(threshold.enemyId, "poisonZombie");
  assert.match(threshold.enemyLabel, /废墟入土魂灵/);
  assert.ok((threshold.riskTags || []).includes("life-limit"), `expected life-limit risk: ${JSON.stringify(threshold.riskTags)}`);
  assert.ok(threshold.currentHp < threshold.currentDamage, `expected current HP below damage: ${JSON.stringify(threshold)}`);
  assert.ok(threshold.minHpToSurvive > threshold.currentHp, `expected finite higher threshold: ${JSON.stringify(threshold)}`);
  assert.ok(Number.isFinite(threshold.minHpToSurvive), `expected finite minHpToSurvive: ${JSON.stringify(threshold)}`);
  return threshold;
}

function checkResourceIntent(simulator, state, threshold) {
  const intents = scanResourceIntents(simulator, [{
    id: "mt7-current",
    state,
    route: Array.isArray(state.route) ? state.route.slice() : [],
  }], {
    failureClass: "life-limit-hp-deficit",
    missingGoalFields: [actionSurvivableMissing(threshold)],
  }, {
    maxIntentRecords: 32,
    recordsPerIntent: 8,
    maxIntents: 6,
    intentDepth: 3,
    maxIntentNodes: 120,
    targetBattle: { floorId: "MT7", x: 1, y: 11, enemyId: "poisonZombie" },
  });
  assert.ok(intents.length > 0, "expected at least one resource intent");
  assert.ok(
    ["life-limit-hp-prep", "stat-hp", "path-blocker", "path-blocker-chain", "blocked-hp-resource"].includes(intents[0].kind),
    `unexpected first intent: ${JSON.stringify(intents[0], null, 2)}`
  );
  assert.ok(
    intents[0].goal.actionSurvivable || intents[0].goal.minHero || intents[0].goal.anyRemovedTiles,
    `intent should produce a concrete goal: ${JSON.stringify(intents[0].goal)}`
  );
  assert.ok(
    (intents[0].actionPolicy.allowedFloors || []).includes("MT7"),
    `intent action scope should include MT7: ${JSON.stringify(intents[0].actionPolicy)}`
  );
  return intents;
}

function checkAdaptiveBranch(simulator) {
  const startState = replayRoute(simulator, ADAPTIVE_START_ROUTE);
  const spec = getMilestoneSpec(simulator.project, ROUTE_NAME);
  const result = runAdaptiveSegmentPlanner(simulator, startState, spec, {
    fromMilestoneId: "mt7-bottom-double-fairy",
    toMilestoneId: "mt7-left-sword",
    candidateLimit: 4,
    maxAdaptiveRepairs: 1,
    maxExpansions: 250,
    maxRuntimeMs: 2000,
    repairBranchLimit: 3,
    intentDepth: 3,
    intentNodeLimit: 120,
    repairMaxExpansions: 250,
    repairMaxRuntimeMs: 2000,
    repairGoalSkylineLimit: 4,
  });
  if (result.found) {
    const finalState = result.finalCandidate.state;
    assert.ok(Number(finalState.hero.atk || 0) >= 8767, `expected atk >= 8767, got ${finalState.hero.atk}`);
    assertRemoved(simulator.project, finalState, "MT7", 1, 11, "poisonZombie@MT7:1,11");
    assertRemoved(simulator.project, finalState, "MT7", 0, 11, "I616@MT7:0,11");
    const route = (result.finalCandidate.route || []).map((action) => action.summary || action);
    assert.ok(route.includes("battle:poisonZombie@MT7:1,11"), "route should battle poisonZombie@MT7:1,11");
    assert.ok(route.some((summary) => /I616@MT7:0,11/.test(summary)), "route should pick I616@MT7:0,11");
  } else {
    assert.ok(result.failedSegment && result.failedSegment.segmentId, "failed run should report failedSegmentId");
    const failureClass = result.failedSegment.failureClass ||
      (result.failedSegment.failurePropagation && result.failedSegment.failurePropagation.failureClass) ||
      (result.failedSegment.failurePropagation && result.failedSegment.failurePropagation.primaryFailureClass);
    assert.ok(
      ["life-limit-hp-deficit", "target-action-unreachable", "budget-or-action-scope-exhausted", "hp-deficit"].includes(failureClass),
      `unexpected failureClass: ${failureClass}`
    );
    const missing = JSON.stringify(result.failedSegment.missingGoalFields || result.failedSegment);
    assert.match(missing, /actionSurvivable|minHpToSurvive|life-limit|poisonZombie/);
    assert.ok(
      ((result.adaptive || {}).insertedSegments || []).length > 0 || ((result.adaptive || {}).repairBranches || []).length > 0,
      "adaptive planner should generate repair evidence"
    );
  }
  return result;
}

function main() {
  const simulator = makeSimulator();
  const startState = replayRoute(simulator, START_ROUTE);
  const threshold = checkThreshold(simulator, startState);
  const intents = checkResourceIntent(simulator, startState, threshold);
  const adaptive = checkAdaptiveBranch(simulator);
  console.log(JSON.stringify({
    threshold: {
      enemyLabel: threshold.enemyLabel,
      currentHp: threshold.currentHp,
      currentDamage: threshold.currentDamage,
      minHpToSurvive: threshold.minHpToSurvive,
      riskTags: threshold.riskTags,
    },
    firstIntent: {
      kind: intents[0].kind,
      goal: intents[0].goal,
      actionPolicy: intents[0].actionPolicy,
    },
    adaptive: {
      found: adaptive.found,
      reachedMilestone: adaptive.reachedMilestone,
      failedSegmentId: adaptive.failedSegment && adaptive.failedSegment.segmentId,
      insertedSegments: ((adaptive.adaptive || {}).insertedSegments || []).map((segment) => segment.id),
      repairBranches: (adaptive.adaptive || {}).repairBranches || [],
    },
  }, null, 2));
}

main();
