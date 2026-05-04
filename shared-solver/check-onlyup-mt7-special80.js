"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { runAdaptiveSegmentPlanner } = require("./lib/adaptive-segment-planner");
const { estimateBattleSurvivability } = require("./lib/battle-thresholds");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { getMilestoneSpec } = require("./lib/milestone-spec");
const { loadProject } = require("./lib/project-loader");
const { fingerprintAction, readRouteFile } = require("./lib/route-store");
const { scanResourceIntents } = require("./lib/resource-intent-scanner");
const { BLOCKER_TILE_NUMBER, closeStateForBattleFrontier, isTileBlocking, protectPresentTiles, restorePresentTiles, searchSegmentDP, summarizeHero } = require("./lib/segment-dp");
const { buildDominanceKey } = require("./lib/state-key");
const { getTileDefinitionAt } = require("./lib/state");
const { StaticSimulator } = require("./lib/simulator");

const PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const ROUTE_NAME = "onlyup-chaos-mt5-blueking";
const START_ROUTE = path.join(__dirname, "routes", "latest", "segmented-mt7-right-exp-crystal.route.json");
const LATEST_LEFT_SWORD_ROUTE = path.join(__dirname, "routes", "latest", "adaptive-mt7-left-sword.route.json");
const LATEST_MT8_QUALITY_ROUTE = path.join(__dirname, "routes", "latest", "adaptive-mt8-entry-quality-floor.route.json");
const LATEST_MT8_QUALITY_WINDOW_ROUTE = path.join(__dirname, "routes", "latest", "adaptive-mt8-entry-from-quality-window.route.json");
const LATEST_MT8_SUFFIX_ROUTE = path.join(__dirname, "routes", "latest", "adaptive-mt8-entry-from-mt6-window-suffix.route.json");
const LATEST_MT8_WINDOW_ROUTE = path.join(__dirname, "routes", "latest", "adaptive-mt8-entry-from-mt6-window.route.json");
const USER_BASELINE_ROUTE = path.join(__dirname, "fixtures", "onlyup-mt7-user-baseline.json");
const ADAPTIVE_START_ROUTE = path.join(__dirname, "routes", "latest", "checkpoints", "onlyup-chaos-mt5-blueking", "mt7-bottom-double-fairy.route.json");
const WINDOW_START_ROUTE = path.join(__dirname, "routes", "latest", "checkpoints", "onlyup-chaos-mt5-blueking", "mt6-first-center-guard.route.json");

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
  const add = (list) => {
    (list || []).forEach((action) => {
      if (action && action.summary) actions.push(action);
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

function samePath(left, right) {
  const leftPath = Array.isArray(left) ? left : [];
  const rightPath = Array.isArray(right) ? right : [];
  if (leftPath.length !== rightPath.length) return false;
  for (let index = 0; index < leftPath.length; index += 1) {
    if (leftPath[index] !== rightPath[index]) return false;
  }
  return true;
}

function findAction(simulator, state, expected) {
  const summary = typeof expected === "string" ? expected : expected && expected.summary;
  const matching = enumerateAllActions(simulator, state).filter((action) => action.summary === summary);
  if (matching.length <= 1) return matching[0] || null;
  return matching
    .map((action) => {
      let score = 0;
      if (expected && typeof expected !== "string") {
        if (expected.fingerprint && fingerprintAction(action) === expected.fingerprint) score += 500000;
        if (samePath(action.path, expected.path)) score += 50000;
        if (expected.postStateKey) {
          try {
            const postState = simulator.applyAction(state, action, { storeRoute: false });
            if (buildDominanceKey(postState) === expected.postStateKey) score += 1000000;
          } catch (error) {
            score -= 1000000;
          }
        }
      }
      return { action, score };
    })
    .sort((left, right) => right.score - left.score)[0].action;
}

function replayRoute(simulator, routeFile) {
  const record = readRouteFile(routeFile);
  let state = simulator.createInitialState({ rank: "chaos" });
  for (const decision of record.decisions || []) {
    const action = findAction(simulator, state, decision);
    assert.ok(action, `missing replay action ${decision.index}: ${decision.summary}`);
    state = simulator.applyAction(state, action);
  }
  return state;
}

function replaySummaries(simulator, startState, summaries) {
  let state = JSON.parse(JSON.stringify(startState));
  for (const [index, summary] of summaries.entries()) {
    const action = findAction(simulator, state, summary);
    assert.ok(action, `user baseline action ${index + 1} is not replayable from ${state.floorId}: ${summary}`);
    state = simulator.applyAction(state, action);
  }
  return state;
}

function heroSummary(stateOrSnapshot) {
  const hero = (stateOrSnapshot && stateOrSnapshot.hero) || {};
  return {
    hp: Number(hero.hp || 0),
    atk: Number(hero.atk || 0),
    def: Number(hero.def || 0),
    mdef: Number(hero.mdef || 0),
    lv: Number(hero.lv || 0),
    exp: Number(hero.exp || 0),
  };
}

function routeFinalStateFromRecord(routeFile) {
  const record = readRouteFile(routeFile);
  const snapshot = record.final && record.final.snapshot;
  assert.ok(snapshot && snapshot.hero, `route has no final snapshot: ${routeFile}`);
  return {
    floorId: snapshot.floorId || (record.final && record.final.floorId),
    hero: snapshot.hero,
    routeFile,
  };
}

function compareRouteAgainstBaseline(candidate, baseline, compareConfig) {
  const candidateHero = heroSummary(candidate);
  const baselineHero = heroSummary(baseline);
  if ((compareConfig || {}).mustReachSameFloor !== false) {
    assert.equal(candidate.floorId, baseline.floorId, `candidate route should reach baseline floor ${baseline.floorId}, got ${candidate.floorId}`);
  }
  for (const field of ((compareConfig || {}).mustNotLoseFields || ["hp", "atk", "def", "mdef", "lv"])) {
    assert.ok(
      candidateHero[field] >= baselineHero[field],
      `candidate route is worse than user baseline on ${field}: candidate=${candidateHero[field]}, baseline=${baselineHero[field]}, file=${candidate.routeFile || "in-memory"}`
    );
  }
  if ((compareConfig || {}).sameLevelMustNotLoseExp !== false && candidateHero.lv === baselineHero.lv) {
    assert.ok(
      candidateHero.exp >= baselineHero.exp,
      `candidate route is worse than user baseline on exp at same lv: candidate=${candidateHero.exp}, baseline=${baselineHero.exp}, file=${candidate.routeFile || "in-memory"}`
    );
  }
}

function checkUserBaselineOracle(simulator) {
  const fixture = JSON.parse(fs.readFileSync(USER_BASELINE_ROUTE, "utf8"));
  assert.equal(fixture.schema, "motapathfinder.baseline-route.v1");
  const startRoute = path.resolve(__dirname, fixture.startRoute || "");
  const startState = replayRoute(simulator, startRoute);
  const baselineState = replaySummaries(simulator, startState, fixture.route || []);
  assert.equal(baselineState.floorId, fixture.target && fixture.target.floorId, `user baseline should reach ${fixture.target && fixture.target.floorId}`);

  const candidateRoute = [LATEST_MT8_QUALITY_ROUTE, LATEST_MT8_QUALITY_WINDOW_ROUTE, LATEST_MT8_SUFFIX_ROUTE, LATEST_MT8_WINDOW_ROUTE]
    .find((routeFile) => fs.existsSync(routeFile));
  assert.ok(fs.existsSync(candidateRoute), `missing latest MT8 route to compare against user baseline: ${candidateRoute}`);
  const candidate = routeFinalStateFromRecord(candidateRoute);
  compareRouteAgainstBaseline(candidate, baselineState, fixture.compare || {});
  return {
    fixtureId: fixture.id,
    candidateRoute: path.relative(__dirname, candidateRoute),
    baseline: heroSummary(baselineState),
    candidate: heroSummary(candidate),
    route: fixture.route,
  };
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
      ["life-limit-hp-deficit", "target-action-unreachable", "budget-or-action-scope-exhausted", "hp-deficit", "action-survivability-deficit"].includes(failureClass),
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

function routeIndex(route, summary) {
  return (route || []).findIndex((entry) => String(entry && (entry.summary || entry)) === summary);
}

function routeSummaries(record) {
  return (record.decisions || []).map((entry) => String(entry && (entry.summary || entry)));
}

function checkLatestLeftSwordOrdering() {
  if (!fs.existsSync(LATEST_LEFT_SWORD_ROUTE)) return null;
  const route = routeSummaries(readRouteFile(LATEST_LEFT_SWORD_ROUTE));
  const redSwordsman = routeIndex(route, "battle:redSwordsman@MT7:3,10");
  const mt6LifeLimit = routeIndex(route, "battle:poisonZombie@MT6:10,5");
  const mt7LifeLimit = routeIndex(route, "battle:poisonZombie@MT7:1,11");
  const rightDef = routeIndex(route, "battle:whiteSlimeman@MT7:9,10");
  const rightMdef = routeIndex(route, "battle:redSwordsman@MT7:10,8");
  const leftHp = routeIndex(route, "battle:whiteSlimeman@MT7:2,8");
  assert.ok(redSwordsman >= 0, `latest left-sword route should include MT7:3,10: ${route.join(" | ")}`);
  assert.ok(mt6LifeLimit > redSwordsman, `MT6:10,5 sustain should happen after MT7:3,10: ${route.join(" | ")}`);
  assert.ok(mt6LifeLimit < mt7LifeLimit, `MT6:10,5 sustain should happen before MT7:1,11: ${route.join(" | ")}`);
  assert.ok(
    rightDef > mt6LifeLimit && rightDef < rightMdef && rightMdef < leftHp && leftHp < mt7LifeLimit,
    `expected DP-selected sustain branch MT7:9,10 -> MT7:10,8 -> MT7:2,8 before MT7:1,11: ${route.join(" | ")}`
  );
  return {
    redSwordsman,
    mt6LifeLimit,
    rightDef,
    rightMdef,
    leftHp,
    mt7LifeLimit,
  };
}

function checkResourceTimingWindow(simulator) {
  const startState = replayRoute(simulator, WINDOW_START_ROUTE);
  const segment = {
    id: "test-mt7-special80-resource-window",
    label: "MT7 special80 sustain prep window",
    goal: {
      type: "heroAtLeast",
      floorId: "MT7",
      minHero: {
        hp: 1,
        atk: 5767,
        def: 5535,
        mdef: 30010,
        lv: 9,
      },
      equipmentIncludes: ["I894"],
      presentTiles: [
        { floorId: "MT7", x: 1, y: 11, reason: "keep life-limit blocker until prep is complete" },
        { floorId: "MT7", x: 0, y: 11, reason: "keep sword reward until blocker is killed" },
      ],
      actionSurvivable: {
        summary: "battle:poisonZombie@MT7:1,11",
      },
    },
    actionPolicy: {
      allowedFloors: ["MT6", "MT7"],
      actionKinds: ["battle", "pickup", "interactPickup", "equip", "changeFloor"],
      allowChangeFloors: ["MT7:6,12", "MT6:6,12", "MT6:6,0", "MT7:6,0"],
      forbidUnsupportedEvents: true,
      resourceTimingMode: "sustain-prep",
    },
    dp: {
      keyMode: "region",
      priorityMode: "default",
      resourceTimingMode: "sustain-prep",
      enablePreviewScore: "required",
      stopOnFirstGoal: false,
      maxExpansions: 20000,
      maxRuntimeMs: 60000,
      goalSkylineLimit: 8,
    },
  };
  const result = searchSegmentDP(simulator, startState, segment, { candidateLimit: 8 });
  assert.equal(result.found, true, `resource timing window should find a special80 prep route: ${JSON.stringify(result.diagnostics.failure || result.diagnostics.dp)}`);
  const candidate = result.goalSkyline[0];
  const finalState = candidate.state;
  const suffix = candidate.route.slice(startState.route.length);
  const summaries = suffix.map((entry) => String(entry && (entry.summary || entry)));
  assert.ok(Number(finalState.hero.hp || 0) >= 2500000, `expected HP enough for life-limit battle, got ${finalState.hero.hp}`);
  assertRemoved(simulator.project, finalState, "MT7", 3, 10, "redSwordsman@MT7:3,10");
  assertRemoved(simulator.project, finalState, "MT7", 3, 9, "I619@MT7:3,9");
  assert.ok(summaries.includes("battle:redSwordsman@MT7:3,10"), `expected redSwordsman prep route: ${summaries.join(" | ")}`);

  const defenseFirst = routeIndex(summaries, "battle:evilFairy@MT6:2,1");
  const centerSecond = routeIndex(summaries, "battle:silverSlime@MT6:6,8");
  const firstUp = summaries.findIndex((summary) => summary === "changeFloor@MT6:6,12");
  assert.ok(defenseFirst >= 0 && centerSecond >= 0, `expected MT6 defense/center comparison route: ${summaries.join(" | ")}`);
  assert.ok(defenseFirst < centerSecond, `expected DP to prefer MT6:2,1 before MT6:6,8 by HP dominance: ${summaries.join(" | ")}`);
  assert.ok(firstUp < 0 || firstUp > centerSecond, `expected no early upstairs before MT6:2,1 and MT6:6,8 are resolved: ${summaries.join(" | ")}`);

  const poisonThreshold = estimateBattleSurvivability(simulator, finalState, {
    floorId: "MT7",
    x: 1,
    y: 11,
    enemyId: "poisonZombie",
  });
  assert.equal(poisonThreshold.survivable, true, `expected poisonZombie survivable after prep: ${JSON.stringify(poisonThreshold)}`);
  return {
    hero: {
      hp: finalState.hero.hp,
      atk: finalState.hero.atk,
      def: finalState.hero.def,
      mdef: finalState.hero.mdef,
      exp: finalState.hero.exp,
    },
    suffix: summaries,
    expansions: result.diagnostics.dp.expansions,
    stoppedReason: result.diagnostics.dp.stoppedReason,
  };
}

function checkProtectedItemClosure(simulator) {
  const startState = replayRoute(simulator, WINDOW_START_ROUTE);
  const project = simulator.project;

  const segment = {
    id: "test-protected-item-closure",
    goal: {
      presentTiles: [
        { floorId: "MT7", x: 0, y: 11, reason: "I616 sword" },
        { floorId: "MT7", x: 1, y: 11, reason: "poisonZombie blocker" },
      ],
    },
  };

  const state = JSON.parse(JSON.stringify(startState));
  if (!state.floorStates) state.floorStates = {};
  if (!state.floorStates.MT7) state.floorStates.MT7 = { removed: {}, replaced: {} };

  const mt7 = state.floorStates.MT7;
  assert.equal(mt7.removed["0,11"], undefined, "I616 should not be removed initially");
  assert.equal(mt7.replaced["0,11"], undefined, "I616 should not be replaced initially");

  const tileBefore = getTileDefinitionAt(project, state, "MT7", 0, 11);
  assert.ok(tileBefore, "I616 tile should exist at MT7:0,11");
  assert.equal(tileBefore.cls, "items", "I616 should be an item");

  const saved = protectPresentTiles(project, state, segment);

  assert.equal(mt7.removed["0,11"], undefined, "protected item should NOT be marked removed");
  assert.equal(mt7.replaced["0,11"], BLOCKER_TILE_NUMBER, "protected item should be replaced with blocker tile");

  const tileDuring = getTileDefinitionAt(project, state, "MT7", 0, 11);
  assert.ok(tileDuring, "protected position should have a tile during closure");
  assert.equal(tileDuring.number, BLOCKER_TILE_NUMBER, "protected position should be blocker tile during closure");
  assert.ok(isTileBlocking(project, tileDuring.number), "blocker tile should block traversal");

  assert.equal(mt7.replaced["1,11"], BLOCKER_TILE_NUMBER, "protected enemy should be replaced with blocker tile");

  restorePresentTiles(saved);

  assert.equal(mt7.removed["0,11"], undefined, "I616 should not be removed after restore");
  assert.equal(mt7.replaced["0,11"], undefined, "I616 should not be replaced after restore");

  const tileAfter = getTileDefinitionAt(project, state, "MT7", 0, 11);
  assert.ok(tileAfter, "I616 tile should exist after restore");
  assert.equal(tileAfter.cls, "items", "I616 should be an item after restore");

  console.log("PASS: protected item closure - item blocked during closure, restored after");
}

function checkBattleFrontierMode(simulator) {
  const startState = replayRoute(simulator, WINDOW_START_ROUTE);
  const segment = {
    id: "test-battle-frontier",
    label: "battle-frontier mode test",
    goal: {
      type: "heroAtLeast",
      floorId: "MT7",
      minHero: {
        hp: 1,
        atk: 5767,
        def: 5535,
        mdef: 30010,
        lv: 9,
      },
      equipmentIncludes: ["I894"],
      presentTiles: [
        { floorId: "MT7", x: 1, y: 11, reason: "keep life-limit blocker" },
        { floorId: "MT7", x: 0, y: 11, reason: "keep sword reward" },
      ],
      actionSurvivable: {
        summary: "battle:poisonZombie@MT7:1,11",
      },
    },
    actionPolicy: {
      allowedFloors: ["MT6", "MT7"],
      actionKinds: ["battle", "changeFloor"],
      allowChangeFloors: ["MT7:6,12", "MT6:6,12", "MT6:6,0", "MT7:6,0"],
      forbidUnsupportedEvents: true,
    },
    dp: {
      keyMode: "region",
      priorityMode: "default",
      actionProviderMode: "battle-frontier",
      enablePreviewScore: "required",
      stopOnFirstGoal: false,
      maxExpansions: 20000,
      maxRuntimeMs: 60000,
      goalSkylineLimit: 8,
    },
  };
  const result = searchSegmentDP(simulator, startState, segment, { candidateLimit: 8 });
  const diag = result.diagnostics || {};
  const dpDiag = diag.dp || {};
  const expandedByKind = dpDiag.actionsExpandedByKind || {};
  assert.equal(expandedByKind.pickup || 0, 0, "battle-frontier should not expand pickup actions");
  assert.equal(expandedByKind.interactPickup || 0, 0, "battle-frontier should not expand interactPickup actions");
  assert.ok(dpDiag.uniqueBattleTargets > 0, "battle-frontier should see battle targets");
  assert.ok(dpDiag.expansions <= 20000, `battle-frontier expansions should be bounded: ${dpDiag.expansions}`);
  assert.ok(!dpDiag.expansionBudgetExhausted, "battle-frontier should finish without exhausting budget");

  const portalExpanded = (expandedByKind.changeFloor || 0) + (expandedByKind.floorFly || 0);
  assert.ok(portalExpanded <= 500, `battle-frontier portal expansions should be bounded: changeFloor=${expandedByKind.changeFloor || 0}, floorFly=${expandedByKind.floorFly || 0}`);

  let hero = null;
  let route = null;
  if (result.found) {
    const candidate = result.goalSkyline[0];
    const finalState = candidate.state;
    route = (candidate.route || []).map((entry) => String(entry && (entry.summary || entry)));
    assert.ok(route.includes("battle:poisonZombie@MT7:1,11"), `battle-frontier route should include poisonZombie battle: ${route.join(" | ")}`);

    hero = summarizeHero(finalState);
    assert.ok(hero.atk >= 5767, `battle-frontier hero atk should meet goal: ${hero.atk}`);
    assert.ok(hero.def >= 5535, `battle-frontier hero def should meet goal: ${hero.def}`);

    const poisonThreshold = estimateBattleSurvivability(simulator, finalState, {
      floorId: "MT7",
      x: 1,
      y: 11,
      enemyId: "poisonZombie",
    });
    assert.equal(poisonThreshold.survivable, true, `battle-frontier final state should survive poisonZombie: ${JSON.stringify(poisonThreshold)}`);

    const mt7State = (finalState.floorStates || {}).MT7 || { removed: {}, replaced: {} };
    assert.ok(!mt7State.removed["0,11"], "I616 should not be picked up in battle-frontier route");
    assert.ok(!route.some((s) => /I616@MT7:0,11/.test(s)), "route should not include pickup of protected I616");
  } else {
    assert.ok(
      dpDiag.stoppedReason === "time-limit" || dpDiag.frontierSize === 0,
      `battle-frontier should stop gracefully: stoppedReason=${dpDiag.stoppedReason}, frontierSize=${dpDiag.frontierSize}`
    );
  }

  return {
    found: result.found,
    expansions: dpDiag.expansions || 0,
    actionsGeneratedByKind: dpDiag.actionsGeneratedByKind || {},
    actionsExpandedByKind: expandedByKind,
    uniqueBattleTargets: dpDiag.uniqueBattleTargets || 0,
    uniquePortalEntries: dpDiag.uniquePortalEntries || 0,
    frontierSize: dpDiag.frontierSize || 0,
    hero,
    route,
  };
}

function checkBlockerTileAssumption(project) {
  assert.ok(isTileBlocking(project, BLOCKER_TILE_NUMBER), `tile ${BLOCKER_TILE_NUMBER} must be a blocking tile`);
  const tile1 = project.mapTilesByNumber[String(BLOCKER_TILE_NUMBER)];
  assert.ok(tile1, `tile ${BLOCKER_TILE_NUMBER} should exist in project data`);
  assert.notEqual(tile1.cls, "items", `tile ${BLOCKER_TILE_NUMBER} should not be an item`);
  assert.ok(!tile1.trigger || tile1.trigger !== "openDoor", `tile ${BLOCKER_TILE_NUMBER} should not be a door`);
  assert.ok(tile1.canPass !== true, `tile ${BLOCKER_TILE_NUMBER} should not have canPass=true`);
}

function main() {
  const simulator = makeSimulator();
  checkBlockerTileAssumption(simulator.project);
  checkProtectedItemClosure(simulator);
  const startState = replayRoute(simulator, START_ROUTE);
  const threshold = checkThreshold(simulator, startState);
  const intents = checkResourceIntent(simulator, startState, threshold);
  const battleFrontier = checkBattleFrontierMode(simulator);
  const window = checkResourceTimingWindow(simulator);
  const adaptive = checkAdaptiveBranch(simulator);
  const latestOrdering = checkLatestLeftSwordOrdering();
  const userBaseline = checkUserBaselineOracle(simulator);
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
    resourceTimingWindow: {
      hero: window.hero,
      expansions: window.expansions,
      stoppedReason: window.stoppedReason,
      suffix: window.suffix,
    },
    battleFrontier: {
      found: battleFrontier.found,
      expansions: battleFrontier.expansions,
      actionsGeneratedByKind: battleFrontier.actionsGeneratedByKind,
      uniqueBattleTargets: battleFrontier.uniqueBattleTargets,
      uniquePortalEntries: battleFrontier.uniquePortalEntries,
      hero: battleFrontier.hero,
      route: battleFrontier.route,
    },
    adaptive: {
      found: adaptive.found,
      reachedMilestone: adaptive.reachedMilestone,
      failedSegmentId: adaptive.failedSegment && adaptive.failedSegment.segmentId,
      insertedSegments: ((adaptive.adaptive || {}).insertedSegments || []).map((segment) => segment.id),
      repairBranches: (adaptive.adaptive || {}).repairBranches || [],
    },
    latestOrdering,
    userBaseline,
  }, null, 2));
}

main();
