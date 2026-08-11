"use strict";

/**
 * TEST GRADE: real-fixture-failure-baseline
 *
 * PR-5.8a observes the existing post-MT5 milestone graph with a deterministic
 * expansion budget and no wall-clock timeout. A not-found result is expected:
 * the contract pins the first real failure and its diagnostics without changing
 * DP keys, dominance, selection, candidate limits, or the milestone graph.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { strictReplayRoute } = require("./lib/agenda-policy-evaluation");
const { getMilestoneSpec } = require("./lib/milestone-spec");
const { loadProject } = require("./lib/project-loader");
const { buildReplayRouteFingerprint } = require("./lib/replay-resume-artifact");
const { buildRouteRecord } = require("./lib/route-store");
const { runMilestoneGraph } = require("./lib/segment-dp");
const { exactStateFingerprint } = require("./lib/solver-job");
const {
  makeSimulator,
  replayFixture,
} = require("./check-mt5-third-gate-resource-timing");

const ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");
const ROUTE_NAME = "onlyup-chaos-mt5-blueking";
const MT4_START = "mt4-hp4459";
const MT5_START = "mt5-blueking-kill";
const MT8_TARGET = "mt8-entry-after-mt7-left-sword";
const EXPECTED_REACHED = "mt7-bottom-double-fairy";
const EXPECTED_FAILURE = "mt7-special80-ready";
const MAX_EXPANSIONS_PER_SEGMENT = 500;
const EXPECTED_MT5_EXPANSIONS = 645;
const EXPECTED_POST_MT5_EXPANSIONS = 362;
const EXPECTED_TOTAL_EXPANSIONS = 1007;
const USER_BASELINE_FILE = path.join(
  __dirname,
  "fixtures",
  "onlyup-mt7-user-baseline.json",
);

const EXPECTED_POST_MT5_SEGMENTS = Object.freeze([
  "mt6-upper-left-blueking",
  "mt6-upper-right-blueking",
  "mt6-lower-attack-pair",
  "mt6-first-center-guard",
  "mt6-second-center-guard",
  "mt7-entry-after-mt6-sweep",
  "mt7-mt6-defense-sweep",
  "mt7-mt6-right-crystal-sweep",
  "mt7-bottom-double-fairy",
  "mt7-special80-ready",
]);

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function tileKey(tile) {
  return `${tile.floorId}:${tile.x},${tile.y}`;
}

function propagateSuccessorPresentTiles(milestones) {
  const result = milestones.map((milestone) => ({
    ...milestone,
    goal: cloneJson(milestone.goal || {}),
  }));
  for (let index = 0; index + 1 < result.length; index += 1) {
    const milestone = result[index];
    const successor = result[index + 1];
    if (successor.startFrom !== milestone.id) continue;
    const presentTiles = Array.isArray(milestone.goal.presentTiles)
      ? milestone.goal.presentTiles.slice()
      : [];
    const known = new Set(presentTiles.map(tileKey));
    for (const tile of successor.goal.presentTiles || []) {
      const key = tileKey(tile);
      if (known.has(key)) continue;
      presentTiles.push({
        ...cloneJson(tile),
        propagatedFromMilestone: successor.id,
      });
      known.add(key);
    }
    milestone.goal.presentTiles = presentTiles;
  }
  return result;
}

function buildHistoricalCoarseSpec(currentSpec) {
  const historical = cloneJson(currentSpec);
  historical.milestones = historical.milestones.map((milestone) => ({
    ...milestone,
    goal: {
      ...(milestone.goal || {}),
      presentTiles: (milestone.goal.presentTiles || []).filter(
        (tile) => !tile.propagatedFromMilestone,
      ),
    },
  }));
  const defenseIndex = historical.milestones.findIndex(
    (milestone) => milestone.id === "mt7-mt6-defense-sweep",
  );
  assert.ok(defenseIndex >= 0, "MT6 defense milestone");
  const [defense] = historical.milestones.splice(defenseIndex, 1);
  const second = historical.milestones.find(
    (milestone) => milestone.id === "mt6-second-center-guard",
  );
  const entryIndex = historical.milestones.findIndex(
    (milestone) => milestone.id === "mt7-entry-after-mt6-sweep",
  );
  const right = historical.milestones.find(
    (milestone) => milestone.id === "mt7-mt6-right-crystal-sweep",
  );
  assert.ok(second && entryIndex >= 0 && right, "historical MT6 chain");

  second.startFrom = "mt6-first-center-guard";
  second.goal.minHero = {
    hp: 557322,
    atk: 5767,
    def: 4535,
    mdef: 25010,
    lv: 9,
    exp: 519,
  };
  second.goal.presentTiles = [
    {
      floorId: "MT6",
      x: 2,
      y: 1,
      reason: "Preserve optional high-defense skyline candidate for MT7.",
    },
    ...second.goal.presentTiles,
  ];

  defense.label = "MT7 入口后回 MT6 拿左上防御资源";
  defense.startFrom = "mt7-entry-after-mt6-sweep";
  defense.goal = {
    type: "heroAtLeast",
    floorId: "MT6",
    minHero: {
      hp: 112394,
      atk: 5767,
      def: 5035,
      mdef: 30010,
      lv: 9,
      exp: 603,
    },
    equipmentIncludes: ["I894"],
    removedTiles: [{ floorId: "MT6", x: 2, y: 1 }],
    presentTiles: [
      {
        floorId: "MT6",
        x: 9,
        y: 10,
        reason: "Delay the lower-right sustain chain until after the MT6 defense pickup.",
      },
      {
        floorId: "MT6",
        x: 11,
        y: 11,
        reason: "Keep the right-side crystal guard for the next sustain segment.",
      },
      {
        floorId: "MT7",
        x: 4,
        y: 11,
        reason: "MT7 bottom fairies are the next segment, not part of this MT6 defense sweep.",
      },
      {
        floorId: "MT7",
        x: 8,
        y: 11,
        reason: "MT7 bottom fairies are the next segment, not part of this MT6 defense sweep.",
      },
    ],
  };
  right.startFrom = "mt7-mt6-defense-sweep";
  historical.milestones.splice(entryIndex + 1, 0, defense);
  historical.milestones = propagateSuccessorPresentTiles(historical.milestones);
  return historical;
}

function summarizeSegments(result) {
  return result.segmentResults.map((segment) => ({
    id: segment.segmentId,
    found: segment.found,
    attempts: segment.attempts.map((attempt) => {
      const diagnostics = attempt.diagnostics || {};
      const dp = diagnostics.dp || {};
      const expansions = Number(dp.expansions || 0);
      assert.strictEqual(
        diagnostics.actionTrimmed,
        0,
        `${segment.segmentId} must not trim actions`,
      );
      assert.notStrictEqual(
        dp.expansionBudgetExhausted,
        true,
        `${segment.segmentId} must not exhaust its expansion budget`,
      );
      assert.notStrictEqual(
        dp.stoppedReason,
        "time-limit",
        `${segment.segmentId} must not stop on wall time`,
      );
      assert.ok(
        expansions <= MAX_EXPANSIONS_PER_SEGMENT,
        `${segment.segmentId} exceeded the per-segment ceiling`,
      );
      return {
        found: attempt.found,
        expansions,
        wallMs: Number(dp.wallMs || 0),
        frontierSize: Number(dp.frontierSize || 0),
        stoppedReason: dp.stoppedReason || null,
        actionTrimmed: Number(diagnostics.actionTrimmed || 0),
        expansionBudgetExhausted: dp.expansionBudgetExhausted === true,
      };
    }),
  }));
}

function totalExpansions(segments) {
  return segments.reduce(
    (sum, segment) => sum + segment.attempts.reduce(
      (attemptSum, attempt) => attemptSum + attempt.expansions,
      0,
    ),
    0,
  );
}

function runGraph(
  simulator,
  initialState,
  fromMilestoneId,
  toMilestoneId,
  milestoneSpec,
) {
  return runMilestoneGraph(
    simulator,
    initialState,
    milestoneSpec || getMilestoneSpec(simulator.project, ROUTE_NAME),
    {
      fromMilestoneId,
      toMilestoneId,
      candidateLimit: 8,
      goalSkylineLimit: 8,
      maxExpansions: MAX_EXPANSIONS_PER_SEGMENT,
      maxRuntimeMs: 0,
      stopOnFirstGoal: false,
      preserveSkylineRoles: true,
      dpPriorityMode: "goal-directed",
    },
  );
}

function buildStrictReplayEvidence(project, initialState, result) {
  assert.ok(result.finalCandidate && result.finalCandidate.state, "reached candidate state");
  const finalState = result.finalCandidate.state;
  const prefixLength = Array.isArray(initialState.route) ? initialState.route.length : 0;
  const fullRoute = Array.isArray(result.finalCandidate.route)
    ? result.finalCandidate.route
    : [];
  finalState.route = fullRoute.slice(prefixLength);
  const routeRecord = buildRouteRecord({
    project,
    simulator: makeSimulator(project),
    initialState,
    finalState,
    options: {
      projectRoot: PROJECT_ROOT,
      solver: "post-mt5-long-chain-baseline",
      profile: "tracked-mt4-fixed-expansion",
      rank: "chaos",
      toFloor: "MT7",
      goalType: "milestoneReached",
      snapshotFloors: ["MT4", "MT5", "MT6", "MT7"],
      metadata: {
        milestone: EXPECTED_REACHED,
        expectedFailure: EXPECTED_FAILURE,
        productionSearchSemanticsChanged: false,
      },
    },
  });
  const replay = strictReplayRoute(project, makeSimulator(project), routeRecord);
  assert.strictEqual(replay.valid, true, replay.failureReason || "strict replay");
  assert.strictEqual(replay.stepsCompleted, replay.stepsAttempted);
  const fingerprint = buildReplayRouteFingerprint(routeRecord);
  return {
    valid: replay.valid,
    decisionCount: routeRecord.decisions.length,
    routeFingerprint: fingerprint.sha256 || fingerprint.hash || JSON.stringify(fingerprint),
    finalExactStateFingerprint: exactStateFingerprint(finalState),
  };
}

function actionIndex(route, summary) {
  return route.indexOf(summary);
}

function main() {
  const project = loadProject(PROJECT_ROOT);
  const historicalSpec = buildHistoricalCoarseSpec(
    getMilestoneSpec(project, ROUTE_NAME),
  );
  const trackedInitialState = replayFixture(makeSimulator(project));

  const mt5StartedAt = Date.now();
  const mt5Result = runGraph(
    makeSimulator(project),
    trackedInitialState,
    MT4_START,
    MT5_START,
    historicalSpec,
  );
  const mt5WallMs = Date.now() - mt5StartedAt;
  assert.strictEqual(mt5Result.found, true, "tracked MT4 fixture must close MT5 first");
  const mt5Segments = summarizeSegments(mt5Result);
  const mt5Expansions = totalExpansions(mt5Segments);
  assert.strictEqual(mt5Expansions, EXPECTED_MT5_EXPANSIONS, "MT5 qualification scale");

  const postMt5InitialState = mt5Result.finalCandidate.state;
  const postStartedAt = Date.now();
  const result = runGraph(
    makeSimulator(project),
    postMt5InitialState,
    MT5_START,
    MT8_TARGET,
    historicalSpec,
  );
  const postMt5WallMs = Date.now() - postStartedAt;

  assert.strictEqual(result.found, false, "5.8a records the current first failure");
  assert.strictEqual(result.reachedMilestone, EXPECTED_REACHED);
  const failedSegmentId = typeof result.failedSegment === "string"
    ? result.failedSegment
    : result.failedSegment && result.failedSegment.segmentId;
  assert.strictEqual(failedSegmentId, EXPECTED_FAILURE);
  const segments = summarizeSegments(result);
  assert.deepStrictEqual(
    segments.map((segment) => segment.id),
    EXPECTED_POST_MT5_SEGMENTS,
    "post-MT5 milestone order",
  );
  assert.ok(segments.slice(0, -1).every((segment) => segment.found));
  assert.strictEqual(segments.at(-1).found, false);
  const postMt5Expansions = totalExpansions(segments);
  assert.strictEqual(
    postMt5Expansions,
    EXPECTED_POST_MT5_EXPANSIONS,
    "post-MT5 baseline scale",
  );
  assert.strictEqual(
    mt5Expansions + postMt5Expansions,
    EXPECTED_TOTAL_EXPANSIONS,
    "tracked MT4 to first post-MT5 failure scale",
  );

  const reachedCandidate = result.finalCandidates[0];
  assert.ok(reachedCandidate && reachedCandidate.state, "last reached candidate");
  const reachedState = reachedCandidate.state;
  assert.strictEqual(reachedState.floorId, "MT7");
  assert.strictEqual(Number(reachedState.hero.hp), 499741);
  assert.strictEqual(Number(reachedState.hero.def), 5535);
  assert.strictEqual(Number(reachedState.hero.exp), 813);
  const currentRoute = (reachedCandidate.route || []).map((action) => action.summary);
  const currentSecondCenter = actionIndex(currentRoute, "battle:silverSlime@MT6:6,8");
  const currentDefensePickup = actionIndex(currentRoute, "battle:evilFairy@MT6:2,1");
  assert.ok(currentSecondCenter >= 0 && currentDefensePickup >= 0);
  assert.ok(
    currentSecondCenter < currentDefensePickup,
    "current coarse graph must preserve the observed MT6 order",
  );

  const userBaseline = JSON.parse(fs.readFileSync(USER_BASELINE_FILE, "utf8"));
  const knownRoute = userBaseline.route || [];
  const knownDefensePickup = actionIndex(knownRoute, "battle:evilFairy@MT6:2,1");
  const knownSecondCenter = actionIndex(knownRoute, "battle:silverSlime@MT6:6,8");
  assert.ok(knownDefensePickup >= 0 && knownSecondCenter >= 0);
  assert.ok(
    knownDefensePickup < knownSecondCenter,
    "tracked known route must retain the opposite resource order",
  );

  const strictReplay = buildStrictReplayEvidence(
    project,
    postMt5InitialState,
    { ...result, finalCandidate: reachedCandidate },
  );
  const failingAttempts = segments.at(-1).attempts;
  process.stdout.write(`${JSON.stringify({
    schema: "motapathfinder.post-mt5-long-chain-baseline.v1",
    status: "passed",
    controls: {
      trackedFixture: "routes/fixtures/mt1-mt4-hp6428-best.route.json",
      knownRouteFixture: "fixtures/onlyup-mt7-user-baseline.json",
      historicalCoarseGraphReconstructed: true,
      productionDpKeyUnchanged: true,
      productionDominanceUnchanged: true,
      productionSelectionUnchanged: true,
      candidateLimit: 8,
      perSegmentMaxExpansions: MAX_EXPANSIONS_PER_SEGMENT,
      maxRuntimeMs: 0,
      timingDirectionalNotPinned: true,
    },
    mt5Qualification: {
      found: mt5Result.found,
      wallMs: mt5WallMs,
      totalExpansions: mt5Expansions,
    },
    postMt5Baseline: {
      found: result.found,
      reachedMilestone: result.reachedMilestone,
      failedSegment: failedSegmentId,
      wallMs: postMt5WallMs,
      totalExpansions: postMt5Expansions,
      trackedMt4TotalExpansions: mt5Expansions + postMt5Expansions,
      reachedHero: {
        hp: Number(reachedState.hero.hp),
        atk: Number(reachedState.hero.atk),
        def: Number(reachedState.hero.def),
        mdef: Number(reachedState.hero.mdef),
        lv: Number(reachedState.hero.lv),
        exp: Number(reachedState.hero.exp),
      },
      failingAttempts,
      strictReplay,
      segments,
    },
    attribution: {
      failureClass: "strong-resource-timing-hypothesis",
      noActionTrimming: true,
      noExpansionBudgetExhaustion: true,
      noWallTimeout: true,
      currentCoarseOrder: [
        "battle:silverSlime@MT6:6,8",
        "battle:evilFairy@MT6:2,1",
      ],
      knownRouteOrder: [
        "battle:evilFairy@MT6:2,1",
        "battle:silverSlime@MT6:6,8",
      ],
      nextRefinement: "run a one-variable causal repair with the MT6 defense pickup before the second center guard",
    },
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = {
  EXPECTED_FAILURE,
  EXPECTED_POST_MT5_EXPANSIONS,
  EXPECTED_REACHED,
  EXPECTED_TOTAL_EXPANSIONS,
  MAX_EXPANSIONS_PER_SEGMENT,
  MT4_START,
  MT5_START,
  MT8_TARGET,
  PROJECT_ROOT,
  ROUTE_NAME,
  buildHistoricalCoarseSpec,
  buildStrictReplayEvidence,
  main,
  runGraph,
  summarizeSegments,
  totalExpansions,
};
