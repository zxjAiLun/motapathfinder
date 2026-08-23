"use strict";

/**
 * TEST GRADE: real-fixture-causal-repair
 *
 * PR-5.8b changes one production checkpoint dependency: collect the +500 DEF
 * behind MT6:2,1 before fighting the second center guard at MT6:6,8. Search
 * budgets and core DP semantics remain identical to the approved 5.8a baseline.
 */

const assert = require("node:assert");

const { getMilestoneSpec } = require("./lib/milestone-spec");
const { loadProject } = require("./lib/project-loader");
const {
  EXPECTED_FAILURE,
  EXPECTED_POST_MT5_EXPANSIONS,
  EXPECTED_REACHED,
  EXPECTED_TOTAL_EXPANSIONS,
  MAX_EXPANSIONS_PER_SEGMENT,
  MT4_START,
  MT5_START,
  PROJECT_ROOT,
  ROUTE_NAME,
  buildHistoricalCoarseSpec,
  buildStrictReplayEvidence,
  runGraph,
  summarizeSegments,
  totalExpansions,
} = require("./check-post-mt5-long-chain-baseline");
const {
  makeSimulator,
  replayFixture,
} = require("./check-mt5-third-gate-resource-timing");

const TARGET = "mt7-special80-ready";
const EXPECTED_POST_MT5_REPAIRED_EXPANSIONS = 507;
const EXPECTED_REPAIRED_ROUTE_FINGERPRINT =
  "e0ea77ee5dc4faa829d0a897dfd5a6fc7f6d1c1b08371789b01b9b7d3912d64a";
const EXPECTED_REPAIRED_STATE_FINGERPRINT = "9011327802de85c9";
const EXPECTED_REPAIRED_ORDER = Object.freeze([
  "mt6-upper-left-blueking",
  "mt6-upper-right-blueking",
  "mt6-lower-attack-pair",
  "mt6-first-center-guard",
  "mt7-mt6-defense-sweep",
  "mt6-second-center-guard",
  "mt7-entry-after-mt6-sweep",
  "mt7-mt6-right-crystal-sweep",
  "mt7-bottom-double-fairy",
  "mt7-special80-ready",
]);
const CHANGED_MILESTONES = new Set([
  "mt7-mt6-defense-sweep",
  "mt6-second-center-guard",
  "mt7-mt6-right-crystal-sweep",
]);

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function stripPropagation(milestone) {
  const result = cloneJson(milestone);
  result.goal.presentTiles = (result.goal.presentTiles || []).filter(
    (tile) => !tile.propagatedFromMilestone,
  );
  return result;
}

function milestoneMap(spec) {
  return new Map(spec.milestones.map((milestone) => [
    milestone.id,
    stripPropagation(milestone),
  ]));
}

function assertMinimalCausalDelta(currentSpec, historicalSpec) {
  const current = milestoneMap(currentSpec);
  const historical = milestoneMap(historicalSpec);
  assert.deepStrictEqual([...current.keys()].sort(), [...historical.keys()].sort());
  for (const [id, milestone] of current) {
    if (CHANGED_MILESTONES.has(id)) continue;
    assert.deepStrictEqual(milestone, historical.get(id), `${id} must be unchanged`);
  }

  const currentDefense = current.get("mt7-mt6-defense-sweep");
  const oldDefense = historical.get("mt7-mt6-defense-sweep");
  assert.deepStrictEqual(currentDefense.dp, oldDefense.dp, "defense DP options unchanged");
  assert.deepStrictEqual(
    currentDefense.actionPolicy,
    oldDefense.actionPolicy,
    "defense action scope unchanged",
  );
  assert.strictEqual(currentDefense.startFrom, "mt6-first-center-guard");
  assert.strictEqual(oldDefense.startFrom, "mt7-entry-after-mt6-sweep");
  const currentDefenseGoalInvariant = {
    ...currentDefense.goal,
    minHero: oldDefense.goal.minHero,
    presentTiles: oldDefense.goal.presentTiles,
  };
  assert.deepStrictEqual(
    currentDefenseGoalInvariant,
    oldDefense.goal,
    "defense goal changes only its timing-derived hero floor and protected successor",
  );
  assert.ok(
    currentDefense.goal.presentTiles.some(
      (tile) => tile.floorId === "MT6" && tile.x === 6 && tile.y === 8,
    ),
    "repaired defense checkpoint must protect the second center guard",
  );

  const currentSecond = current.get("mt6-second-center-guard");
  const oldSecond = historical.get("mt6-second-center-guard");
  assert.deepStrictEqual(currentSecond.dp, oldSecond.dp, "second-center DP options unchanged");
  assert.deepStrictEqual(
    currentSecond.actionPolicy,
    oldSecond.actionPolicy,
    "second-center action scope unchanged",
  );
  assert.strictEqual(currentSecond.startFrom, "mt7-mt6-defense-sweep");
  assert.strictEqual(oldSecond.startFrom, "mt6-first-center-guard");
  const currentSecondGoalInvariant = {
    ...currentSecond.goal,
    minHero: oldSecond.goal.minHero,
    presentTiles: oldSecond.goal.presentTiles,
  };
  assert.deepStrictEqual(
    currentSecondGoalInvariant,
    oldSecond.goal,
    "second-center goal changes only timing-derived hero floor and consumed protection",
  );
  assert.strictEqual(
    currentSecond.goal.presentTiles.some(
      (tile) => tile.floorId === "MT6" && tile.x === 2 && tile.y === 1,
    ),
    false,
  );

  const currentRight = current.get("mt7-mt6-right-crystal-sweep");
  const oldRight = historical.get("mt7-mt6-right-crystal-sweep");
  const currentRightComparable = { ...currentRight, startFrom: oldRight.startFrom };
  assert.deepStrictEqual(
    currentRightComparable,
    oldRight,
    "right sweep changes only its predecessor edge",
  );

  return {
    changedMilestones: [...CHANGED_MILESTONES],
    productionDpKeyUnchanged: true,
    productionDominanceUnchanged: true,
    productionSelectionUnchanged: true,
    candidateLimit: 8,
    perSegmentMaxExpansions: MAX_EXPANSIONS_PER_SEGMENT,
    maxRuntimeMs: 0,
    priorityMode: "goal-directed",
  };
}

function actionIndex(candidate, summary) {
  return (candidate.route || []).findIndex((action) => action.summary === summary);
}

function main() {
  const project = loadProject(PROJECT_ROOT);
  const currentSpec = getMilestoneSpec(project, ROUTE_NAME);
  const historicalSpec = buildHistoricalCoarseSpec(currentSpec);
  const causalControls = assertMinimalCausalDelta(currentSpec, historicalSpec);
  const trackedInitialState = replayFixture(makeSimulator(project));

  const mt5Result = runGraph(
    makeSimulator(project),
    trackedInitialState,
    MT4_START,
    MT5_START,
    currentSpec,
  );
  assert.strictEqual(mt5Result.found, true, "MT5 qualification prefix");
  const mt5Expansions = totalExpansions(summarizeSegments(mt5Result));
  assert.strictEqual(mt5Expansions, 655, "MT5 prefix scale");

  const postMt5InitialState = mt5Result.finalCandidate.state;
  const startedAt = Date.now();
  const result = runGraph(
    makeSimulator(project),
    postMt5InitialState,
    MT5_START,
    TARGET,
    currentSpec,
  );
  const wallMs = Date.now() - startedAt;
  const segments = summarizeSegments(result);
  assert.deepStrictEqual(
    segments.map((segment) => segment.id),
    EXPECTED_REPAIRED_ORDER,
    "repaired post-MT5 milestone order",
  );
  const postMt5Expansions = totalExpansions(segments);
  assert.strictEqual(result.found, true, "single timing repair must reach special80");
  assert.strictEqual(result.reachedMilestone, TARGET);
  assert.strictEqual(result.failedSegment, null);
  assert.strictEqual(
    postMt5Expansions,
    EXPECTED_POST_MT5_REPAIRED_EXPANSIONS,
    "repaired post-MT5 scale",
  );

  const finalCandidate = result.found
    ? result.finalCandidate
    : result.finalCandidates[0];
  assert.ok(finalCandidate && finalCandidate.state, "observable final candidate");
  const defenseIndex = actionIndex(finalCandidate, "battle:evilFairy@MT6:2,1");
  const secondCenterIndex = actionIndex(finalCandidate, "battle:silverSlime@MT6:6,8");
  assert.ok(defenseIndex >= 0 && secondCenterIndex >= 0);
  assert.ok(defenseIndex < secondCenterIndex, "causal repair action order");

  const strictReplay = buildStrictReplayEvidence(
    project,
    postMt5InitialState,
    { ...result, finalCandidate },
  );
  assert.strictEqual(strictReplay.valid, true);
  assert.strictEqual(strictReplay.decisionCount, 24);
  assert.strictEqual(
    strictReplay.routeFingerprint,
    EXPECTED_REPAIRED_ROUTE_FINGERPRINT,
  );
  assert.strictEqual(
    strictReplay.finalExactStateFingerprint,
    EXPECTED_REPAIRED_STATE_FINGERPRINT,
  );
  assert.deepStrictEqual(
    {
      hp: Number(finalCandidate.state.hero.hp),
      atk: Number(finalCandidate.state.hero.atk),
      def: Number(finalCandidate.state.hero.def),
      mdef: Number(finalCandidate.state.hero.mdef),
      lv: Number(finalCandidate.state.hero.lv),
      exp: Number(finalCandidate.state.hero.exp),
    },
    { hp: 2672845, atk: 5767, def: 5535, mdef: 30010, lv: 9, exp: 881 },
  );

  process.stdout.write(`${JSON.stringify({
    schema: "motapathfinder.mt6-defense-timing-causal-repair.v1",
    status: "passed",
    controls: causalControls,
    historical58a: {
      reachedMilestone: EXPECTED_REACHED,
      failedSegment: EXPECTED_FAILURE,
      postMt5Expansions: EXPECTED_POST_MT5_EXPANSIONS,
      trackedMt4TotalExpansions: EXPECTED_TOTAL_EXPANSIONS,
      special80Reached: false,
    },
    repaired: {
      found: result.found,
      reachedMilestone: result.reachedMilestone,
      failedSegment: result.failedSegment && result.failedSegment.segmentId,
      wallMs,
      postMt5Expansions,
      trackedMt4TotalExpansions: mt5Expansions + postMt5Expansions,
      finalHero: {
        hp: Number(finalCandidate.state.hero.hp),
        atk: Number(finalCandidate.state.hero.atk),
        def: Number(finalCandidate.state.hero.def),
        mdef: Number(finalCandidate.state.hero.mdef),
        lv: Number(finalCandidate.state.hero.lv),
        exp: Number(finalCandidate.state.hero.exp),
      },
      actionOrder: {
        defensePickupIndex: defenseIndex,
        secondCenterIndex,
      },
      strictReplay,
      segments,
    },
    verdict: "CAUSAL_ROOT_CAUSE",
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { assertMinimalCausalDelta, main };
