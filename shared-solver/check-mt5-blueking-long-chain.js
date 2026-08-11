"use strict";

/**
 * TEST GRADE: real-fixture-plus-long-chain-closure
 *
 * PR-5.7c requalifies the complete MT4 checkpoint -> MT5 blueKing chain after
 * PR-5.7b made resource timing explicit. This is a closure contract, not a
 * request for wider search budgets or a production search-semantic change.
 */

const assert = require("node:assert");
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
const FROM_MILESTONE_ID = "mt4-hp4459";
const TO_MILESTONE_ID = "mt5-blueking-kill";
const MAX_EXPANSIONS_PER_SEGMENT = 500;
const TOTAL_EXPANSION_CEILING = 650;
const POST_THIRD_GATE_EXPANSIONS = 38;

const EXPECTED_SEGMENTS = Object.freeze([
  "mt4-pre-entry-openers",
  "mt4-pre-entry-left-detour",
  "mt4-pre-entry-right-detour",
  "mt4-pre-entry-detour",
  "mt5-early-gem-entry",
  "mt5-return-prep-before-first-sweep",
  "mt5-first-entry-with-delayed-heal",
  "mt5-first-sweep-left-king",
  "mt5-first-sweep-presbyter",
  "mt5-first-sweep",
  "mt5-bottom-pair-before-delayed-heal",
  "mt4-delayed-heal-before-third-gate",
  "mt5-third-gate",
  "mt5-sustain-balance",
  "mt5-i894-equipped",
  "mt5-final-stats-before-hp",
  "mt5-before-blueking",
  "mt5-blueking-kill",
]);

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
      assert.ok(
        expansions <= MAX_EXPANSIONS_PER_SEGMENT,
        `${segment.segmentId} exceeded the per-segment ceiling`,
      );
      return {
        found: attempt.found,
        expansions,
        wallMs: Number(dp.wallMs || 0),
        frontierSize: Number(dp.frontierSize || 0),
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

function buildStrictReplayEvidence(project, initialState, result) {
  assert.ok(result.finalCandidate && result.finalCandidate.state, "final candidate state");
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
      solver: "mt5-blueking-long-chain-closure",
      profile: "tracked-mt4-resource-timing",
      rank: "chaos",
      toFloor: "MT5",
      goalType: "bossDefeated",
      snapshotFloors: ["MT4", "MT5"],
      metadata: {
        milestone: TO_MILESTONE_ID,
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
    routeFingerprint: fingerprint.hash || JSON.stringify(fingerprint),
    finalExactStateFingerprint: exactStateFingerprint(finalState),
  };
}

function main() {
  const project = loadProject(PROJECT_ROOT);
  const initialState = replayFixture(makeSimulator(project));
  const startedAt = Date.now();
  const result = runMilestoneGraph(
    makeSimulator(project),
    initialState,
    getMilestoneSpec(project, ROUTE_NAME),
    {
      fromMilestoneId: FROM_MILESTONE_ID,
      toMilestoneId: TO_MILESTONE_ID,
      candidateLimit: 8,
      goalSkylineLimit: 8,
      maxExpansions: MAX_EXPANSIONS_PER_SEGMENT,
      maxRuntimeMs: 0,
      stopOnFirstGoal: false,
      preserveSkylineRoles: true,
      dpPriorityMode: "goal-directed",
    },
  );
  const wallMs = Date.now() - startedAt;
  assert.strictEqual(result.found, true, "complete MT5 blueKing chain must close");
  assert.strictEqual(result.reachedMilestone, TO_MILESTONE_ID);
  assert.strictEqual(result.failedSegment, null);

  const segments = summarizeSegments(result);
  assert.deepStrictEqual(
    segments.map((segment) => segment.id),
    EXPECTED_SEGMENTS,
    "long-chain milestone order",
  );
  assert.ok(segments.every((segment) => segment.found), "every segment must close");
  const expansions = totalExpansions(segments);
  assert.ok(
    expansions <= TOTAL_EXPANSION_CEILING,
    `long-chain expansions ${expansions} exceeded ${TOTAL_EXPANSION_CEILING}`,
  );
  const thirdGateIndex = segments.findIndex((segment) => segment.id === "mt5-third-gate");
  const postThirdGateExpansions = totalExpansions(segments.slice(thirdGateIndex + 1));
  assert.strictEqual(
    postThirdGateExpansions,
    POST_THIRD_GATE_EXPANSIONS,
    "post-third-gate chain scale",
  );

  const finalState = result.finalCandidate.state;
  assert.strictEqual(finalState.floorId, "MT5");
  assert.strictEqual(
    Boolean(finalState.floorStates.MT5.removed["6,7"]),
    true,
    "blueKing tile must be removed",
  );
  assert.ok(finalState.hero.hp > 0, "hero must survive blueKing");
  const strictReplay = buildStrictReplayEvidence(project, initialState, result);

  const historicalCoarse = {
    found: false,
    reachedMilestone: "mt5-first-sweep",
    failedSegment: "mt5-third-gate",
    wallMs: 158867,
    totalExpansions: 4050,
  };
  process.stdout.write(`${JSON.stringify({
    schema: "motapathfinder.mt5-blueking-long-chain.v1",
    status: "passed",
    controls: {
      trackedFixture: "routes/fixtures/mt1-mt4-hp6428-best.route.json",
      productionDpKeyUnchanged: true,
      productionDominanceUnchanged: true,
      productionSelectionUnchanged: true,
      candidateLimit: 8,
      perSegmentMaxExpansions: MAX_EXPANSIONS_PER_SEGMENT,
      maxRuntimeMs: 0,
      timingDirectionalNotPinned: true,
    },
    historicalCoarse,
    current: {
      found: result.found,
      reachedMilestone: result.reachedMilestone,
      wallMs,
      totalExpansions: expansions,
      postThirdGateExpansions,
      finalHero: {
        hp: Number(finalState.hero.hp),
        atk: Number(finalState.hero.atk),
        def: Number(finalState.hero.def),
        mdef: Number(finalState.hero.mdef),
        lv: Number(finalState.hero.lv),
        exp: Number(finalState.hero.exp),
        equipment: Array.isArray(finalState.hero.equipment)
          ? finalState.hero.equipment.slice()
          : [],
      },
      strictReplay,
      segments,
    },
    comparison: {
      historicalFailureNowClosesAtBlueKing: true,
      expansionReduction: historicalCoarse.totalExpansions - expansions,
      expansionReductionPercent: Number(
        ((1 - expansions / historicalCoarse.totalExpansions) * 100).toFixed(1),
      ),
      directionalWallSpeedup: Number((historicalCoarse.wallMs / wallMs).toFixed(2)),
    },
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main };
