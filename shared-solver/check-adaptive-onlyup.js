"use strict";

const assert = require("node:assert");
const path = require("node:path");

const { buildRepairSegment, runAdaptiveSegmentPlanner } = require("./lib/adaptive-segment-planner");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { getMilestoneById, getMilestoneSpec } = require("./lib/milestone-spec");
const { loadProject } = require("./lib/project-loader");
const { readRouteFile } = require("./lib/route-store");
const { runMilestoneGraph } = require("./lib/segment-dp");
const { StaticSimulator } = require("./lib/simulator");

const PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const ROUTE_NAME = "onlyup-chaos-mt5-blueking";

const FIXTURES = {
  mt2Hp3834: path.join(__dirname, "routes", "fixtures", "mt1-mt2-hp3834.route.json"),
  mt4Hp6428: path.join(__dirname, "routes", "fixtures", "mt1-mt4-hp6428-best.route.json"),
  mt5BlueKing: path.join(__dirname, "routes", "latest", "mt5-blueking-kill.route.json"),
  mt7Entry: path.join(__dirname, "routes", "latest", "adaptive-mt7-entry-from-blueking.route.json"),
};

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

function findAction(simulator, state, summary) {
  return (simulator.enumeratePrimitiveActions(state).actions || []).find((action) => action.summary === summary)
    || simulator.enumerateActions(state).find((action) => action.summary === summary)
    || null;
}

function replayRoute(simulator, routeFile) {
  let state = simulator.createInitialState({ rank: "chaos" });
  for (const decision of readRouteFile(routeFile).decisions || []) {
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

function replaySummaries(simulator, state, summaries) {
  return summaries.reduce((current, summary) => applySummary(simulator, current, summary), state);
}

function loadMt5ThirdGateState(simulator) {
  return replaySummaries(simulator, replayRoute(simulator, FIXTURES.mt4Hp6428), MT5_THIRD_GATE_SUFFIX);
}

function assertHeroAtLeast(state, expected, label) {
  for (const [field, value] of Object.entries(expected || {})) {
    assert.ok(
      Number((state.hero || {})[field] || 0) >= Number(value),
      `${label}: expected hero.${field} >= ${value}, got ${(state.hero || {})[field]}`
    );
  }
}

function checkManualMilestoneOracleSegments(simulator) {
  const spec = getMilestoneSpec(simulator.project, ROUTE_NAME);
  const mt2Start = replayRoute(simulator, FIXTURES.mt2Hp3834);
  const mt2Result = runMilestoneGraph(simulator, mt2Start, spec, {
    fromMilestoneId: "mt2-hp3834",
    toMilestoneId: "mt3-i893-hp8425",
    candidateLimit: 4,
    maxRuntimeMs: 6000,
  });
  assert.equal(mt2Result.found, true, `manual oracle MT2->MT3 should pass: ${JSON.stringify(mt2Result.failedSegment || null)}`);
  assertHeroAtLeast(mt2Result.finalCandidate.state, { hp: 8425, atk: 107, def: 100, mdef: 510 }, "manual oracle MT2->MT3");
  assert.ok((mt2Result.finalCandidate.state.hero.equipment || []).includes("I893"), "manual oracle MT2->MT3 should equip I893");

  const mt5Start = loadMt5ThirdGateState(simulator);
  const mt5Result = runMilestoneGraph(simulator, mt5Start, spec, {
    fromMilestoneId: "mt5-third-gate",
    toMilestoneId: "mt5-blueking-kill",
    candidateLimit: 4,
    maxRuntimeMs: 12000,
  });
  assert.equal(mt5Result.found, true, `manual oracle MT5 third gate->blueKing should pass: ${JSON.stringify(mt5Result.failedSegment || null)}`);
  assert.equal(mt5Result.finalCandidate.state.floorId, "MT5");
  assertHeroAtLeast(mt5Result.finalCandidate.state, { hp: 1, atk: 2167, def: 2135, mdef: 13010 }, "manual oracle MT5 blueKing");

  return {
    mt2: {
      reachedMilestone: mt2Result.reachedMilestone,
      final: mt2Result.finalCandidate.hero,
    },
    mt5: {
      reachedMilestone: mt5Result.reachedMilestone,
      final: mt5Result.finalCandidate.hero,
    },
  };
}

function checkResourceIntentRepair(simulator) {
  const start = replayRoute(simulator, FIXTURES.mt7Entry);
  const spec = {
    routeName: "adaptive-onlyup-intent-check",
    milestones: [
      {
        id: "tmp-mt8",
        label: "Temporary MT8 target",
        goal: { type: "heroAtLeast", floorId: "MT8", minHero: { hp: 1 } },
        actionPolicy: {
          allowedFloors: ["MT7", "MT8"],
          actionKinds: ["battle", "pickup", "equip", "changeFloor"],
          allowChangeFloors: ["MT7:6,0", "MT7:6,12"],
        },
        dp: {
          keyMode: "mutation",
          stopOnFirstGoal: true,
          maxExpansions: 80,
          maxRuntimeMs: 3000,
          goalSkylineLimit: 4,
        },
      },
    ],
  };
  const result = runAdaptiveSegmentPlanner(simulator, start, spec, {
    maxAdaptiveRepairs: 1,
    candidateLimit: 4,
    repairMaxExpansions: 80,
    repairMaxRuntimeMs: 3000,
  });
  const inserted = result.adaptive.insertedSegments || [];
  assert.ok(inserted.length > 0, "adaptive planner should insert a resource-intent repair segment");
  const first = inserted[0];
  assert.equal(first.generatedBy.mode, "resource-intent-scanner");
  assert.ok(["path-blocker", "stat-atk", "stat-def", "stat-mdef", "stat-hp", "equipment"].includes(first.generatedBy.intentKind));
  assert.ok(
    first.goal.anyRemovedTiles || first.goal.minHero || first.goal.minEffectiveHero || first.goal.equipmentIncludes || first.goal.floorId,
    "resource-intent repair should produce a concrete subgoal"
  );
  return {
    found: result.found,
    failedSegmentId: result.failedSegment && result.failedSegment.segmentId,
    inserted: inserted.map((segment) => ({
      id: segment.id,
      label: segment.label,
      intentKind: segment.generatedBy.intentKind,
      goal: segment.goal,
    })),
  };
}

function checkPreciseStatIntent(simulator) {
  const milestone = getMilestoneById(simulator.project, ROUTE_NAME, "mt5-blueking-kill");
  const start = replayRoute(simulator, FIXTURES.mt4Hp6428);
  const directSpec = {
    routeName: "adaptive-onlyup-precise-stat-check",
    milestones: [{
      id: "direct-blueking",
      label: "Direct blueKing stat target",
      goal: milestone.goal,
      actionPolicy: {
        allowedFloors: ["MT4", "MT5"],
        actionKinds: ["battle", "pickup", "equip", "changeFloor"],
        allowChangeFloors: ["MT4:6,12", "MT5:6,12"],
      },
      dp: {
        keyMode: "mutation",
        stopOnFirstGoal: true,
        maxExpansions: 80,
        maxRuntimeMs: 3000,
        goalSkylineLimit: 4,
      },
    }],
  };
  const result = runAdaptiveSegmentPlanner(simulator, start, directSpec, {
    maxAdaptiveRepairs: 1,
    candidateLimit: 4,
    enableAutoSplit: false,
    repairMaxExpansions: 80,
    repairMaxRuntimeMs: 3000,
  });
  const inserted = result.adaptive.insertedSegments || [];
  assert.ok(inserted.length > 0, "precise stat check should insert a repair segment");
  const intents = ((inserted[0].generatedBy || {}).intents || []);
  const statIntent = intents.find((intent) => intent.kind === "stat-atk" || intent.kind === "stat-def" || intent.kind === "stat-mdef");
  assert.ok(statIntent, `expected a stat repair intent, got ${JSON.stringify(intents.map((intent) => intent.kind))}`);
  const goal = statIntent.goal || {};
  assert.ok(goal.minEffectiveHero || goal.minHero, `stat intent should include stat threshold goal: ${JSON.stringify(goal)}`);
  return {
    inserted: inserted.map((segment) => ({
      id: segment.id,
      intentKind: segment.generatedBy.intentKind,
      firstStatIntent: statIntent.kind,
      firstStatGoal: statIntent.goal,
    })),
  };
}

function checkAutoSplitRepairSegment() {
  const result = {
    failedSegment: {
      segmentId: "slow-segment",
      failureClass: "budget-or-action-scope-exhausted",
      attempts: [{
        diagnostics: {
          dp: {
            stoppedReason: "time-limit",
            actionTrimmed: 0,
            statesWithActionTrim: 0,
          },
          failure: {
            bestSeen: {
              floorId: "MTX",
              hero: {
                hp: 1234,
                atk: 56,
                def: 78,
                mdef: 90,
                lv: 3,
                exp: 12,
                equipment: ["IX"],
              },
              effectiveHero: {
                hp: 1234,
                atk: 112,
                def: 156,
                mdef: 180,
                lv: 3,
                exp: 12,
              },
            },
          },
        },
      }],
    },
  };
  const spec = {
    milestones: [{
      id: "slow-segment",
      goal: { type: "heroAtLeast", floorId: "MTY", minHero: { hp: 1 } },
      actionPolicy: {
        allowedFloors: ["MTX", "MTY"],
        actionKinds: ["battle", "pickup", "changeFloor"],
      },
      dp: {
        keyMode: "region",
        maxExpansions: 8000,
        maxRuntimeMs: 15000,
      },
    }],
  };
  const split = buildRepairSegment(null, result, {
    currentSpec: spec,
    repairIndex: 0,
    candidateLimit: 4,
    splitMaxExpansions: 300,
    splitMaxRuntimeMs: 2000,
  });
  assert.ok(split, "budget/time failure should generate an auto-split segment");
  assert.equal(split.generatedBy.mode, "auto-segment-split");
  assert.equal(split.goal.floorId, "MTX");
  assert.equal(split.goal.minHero.hp, 1234);
  assert.equal(split.goal.minEffectiveHero.atk, 112);
  assert.deepEqual(split.goal.equipmentIncludes, ["IX"]);
  assert.equal(split.dp.maxExpansions, 300);
  return {
    id: split.id,
    mode: split.generatedBy.mode,
    goal: split.goal,
    dp: split.dp,
  };
}

function main() {
  const simulator = makeSimulator();
  const known = checkManualMilestoneOracleSegments(simulator);
  const repair = checkResourceIntentRepair(simulator);
  const stat = checkPreciseStatIntent(simulator);
  const split = checkAutoSplitRepairSegment();
  console.log(JSON.stringify({ known, repair, stat, split }, null, 2));
}

main();
