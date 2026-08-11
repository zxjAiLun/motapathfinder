"use strict";

/**
 * TEST GRADE: real-fixture-plus-segment-closure
 *
 * PR-5.7b locks the MT5 third-gate attribution found after Candidate Quality
 * Shadow stop condition B: checkpoint retention was not the primary cause.
 * The causal variable is the timing of MT4:8,3 and its adjacent I621 pickup.
 */

const assert = require("node:assert");
const path = require("node:path");

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { getMilestoneSpec } = require("./lib/milestone-spec");
const { loadProject } = require("./lib/project-loader");
const { readRouteFile } = require("./lib/route-store");
const { runMilestoneGraph } = require("./lib/segment-dp");
const { StaticSimulator } = require("./lib/simulator");

const ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");
const FIXTURE_FILE = path.join(__dirname, "routes", "fixtures", "mt1-mt4-hp6428-best.route.json");
const ROUTE_NAME = "onlyup-chaos-mt5-blueking";

function makeSimulator(project) {
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
    walkReachabilityMode: "safe-fast",
  });
}

function findAction(simulator, state, summary) {
  return (simulator.enumeratePrimitiveActions(state).actions || [])
    .find((action) => action.summary === summary) ||
    simulator.enumerateActions(state).find((action) => action.summary === summary) ||
    null;
}

function replaySummaries(simulator, state, summaries) {
  let next = state;
  for (const summary of summaries) {
    const action = findAction(simulator, next, summary);
    assert.ok(action, `missing tracked action ${summary}`);
    next = simulator.applyAction(next, action);
  }
  return next;
}

function replayFixture(simulator) {
  const initial = simulator.createInitialState({ rank: "chaos" });
  const summaries = (readRouteFile(FIXTURE_FILE).decisions || []).map((decision) => decision.summary);
  return replaySummaries(simulator, initial, summaries);
}

function heroProjection(state) {
  return {
    floorId: state.floorId,
    hp: Number(state.hero.hp),
    atk: Number(state.hero.atk),
    def: Number(state.hero.def),
    mdef: Number(state.hero.mdef),
    exp: Number(state.hero.exp),
  };
}

function assertHero(state, expected, label) {
  assert.deepStrictEqual(heroProjection(state), expected, label);
}

function checkCausalTiming(simulator, fixtureState) {
  const common = replaySummaries(simulator, fixtureState, [
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
  ]);
  assertHero(common, {
    floorId: "MT4", hp: 93836, atk: 927, def: 745, mdef: 5910, exp: 141,
  }, "tracked common state");

  const earlyHeal = replaySummaries(simulator, common, [
    "battle:skeletonKing@MT4:8,3",
    "changeFloor@MT4:6,12",
    "changeFloor@MT5:6,12",
    "battle:skeletonKing@MT4:4,3",
    "changeFloor@MT4:6,12",
    "battle:skeletonKing@MT5:4,11",
    "battle:skeletonPresbyter@MT5:3,10",
    "battle:skeletonKing@MT5:8,11",
    "battle:devilWarrior@MT5:11,11",
    "battle:skeletonKnight@MT5:1,11",
  ]);
  const delayedHeal = replaySummaries(simulator, common, [
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
  ]);

  assertHero(earlyHeal, {
    floorId: "MT5", hp: 92030, atk: 1077, def: 895, mdef: 6110, exp: 289,
  }, "early-heal counterfactual");
  assertHero(delayedHeal, {
    floorId: "MT5", hp: 105876, atk: 1077, def: 895, mdef: 6110, exp: 289,
  }, "delayed-heal counterfactual");
  assert.strictEqual(delayedHeal.hero.hp - earlyHeal.hero.hp, 13846, "delayed heal HP advantage");

  const thirdGate = replaySummaries(simulator, delayedHeal, [
    "changeFloor@MT5:6,12",
    "battle:devilWarrior@MT4:10,5",
    "changeFloor@MT4:6,12",
    "battle:evilHero@MT5:9,10",
  ]);
  assertHero(thirdGate, {
    floorId: "MT5", hp: 105138, atk: 1097, def: 965, mdef: 6310, exp: 367,
  }, "tracked third-gate state");

  return {
    common: heroProjection(common),
    earlyHeal: heroProjection(earlyHeal),
    delayedHeal: heroProjection(delayedHeal),
    delayedHealHpAdvantage: delayedHeal.hero.hp - earlyHeal.hero.hp,
    thirdGate: heroProjection(thirdGate),
  };
}

function checkSegmentClosure(simulator, fixtureState, project, specOverride) {
  const spec = specOverride || getMilestoneSpec(project, ROUTE_NAME);
  const startedAt = Date.now();
  const result = runMilestoneGraph(simulator, fixtureState, spec, {
    fromMilestoneId: "mt4-hp4459",
    toMilestoneId: "mt5-third-gate",
    candidateLimit: 8,
    goalSkylineLimit: 8,
    maxExpansions: 500,
    maxRuntimeMs: 0,
    stopOnFirstGoal: false,
    preserveSkylineRoles: true,
    dpPriorityMode: "goal-directed",
  });
  assert.strictEqual(result.found, true, "segmented search must reach MT5 third gate");
  assert.strictEqual(result.reachedMilestone, "mt5-third-gate");

  const segments = result.segmentResults.map((segment) => ({
    id: segment.segmentId,
    found: segment.found,
    attempts: segment.attempts.map((attempt) => {
      const dp = attempt.diagnostics && attempt.diagnostics.dp || {};
      assert.strictEqual(attempt.diagnostics.actionTrimmed, 0, `${segment.segmentId} action scope`);
      assert.notStrictEqual(dp.expansionBudgetExhausted, true, `${segment.segmentId} expansion budget`);
      return {
        found: attempt.found,
        expansions: Number(dp.expansions || 0),
        wallMs: Number(dp.wallMs || 0),
      };
    }),
  }));
  return {
    found: result.found,
    reachedMilestone: result.reachedMilestone,
    wallMs: Date.now() - startedAt,
    totalExpansions: segments.reduce((sum, segment) =>
      sum + segment.attempts.reduce((inner, attempt) => inner + attempt.expansions, 0), 0),
    segments,
  };
}

function main() {
  const project = loadProject(PROJECT_ROOT);
  const simulator = makeSimulator(project);
  const fixtureState = replayFixture(simulator);
  const causal = checkCausalTiming(simulator, fixtureState);
  const closure = checkSegmentClosure(makeSimulator(project), fixtureState, project);
  process.stdout.write(`${JSON.stringify({
    schema: "motapathfinder.mt5-third-gate-resource-timing.v1",
    status: "passed",
    controls: {
      trackedFixture: path.relative(__dirname, FIXTURE_FILE).replace(/\\/g, "/"),
      productionDpKeyUnchanged: true,
      productionSelectionUnchanged: true,
      perSegmentMaxExpansions: 500,
      maxRuntimeMs: 0,
    },
    causal,
    closure,
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = {
  checkCausalTiming,
  checkSegmentClosure,
  makeSimulator,
  main,
  replayFixture,
};
