"use strict";

/**
 * TEST GRADE: unit
 *
 * Synthetic contract checks for PR-4.2 evaluation plumbing. This check does
 * not load a tower project, teacher route, or generated search output.
 */

const assert = require("node:assert");

const { buildSolverSnapshot } = require("./lib/route-snapshot");
const { createStateFromSnapshot } = require("./lib/route-store");
const { syncProgress } = require("./lib/progress");
const { buildStateKey } = require("./lib/state-key");
const {
  __testHooks: segmentDpTestHooks,
} = require("./lib/segment-dp");
const {
  aggregateRepeats,
  aggregateSegmentReport,
  buildBudgetPlan,
  buildRegressionFromBaseline,
  buildSegmentRegressionFromBaseline,
  buildSegmentedChildArgs,
  getPolicyMatrix,
  median,
  range,
  strictReplayRoute,
} = require("./lib/agenda-policy-evaluation");
const {
  classifyRun,
} = require("./run-agenda-policy-evaluation");

function makeReport(overrides) {
  return {
    found: false,
    reachedMilestone: null,
    failedSegmentId: "synthetic-segment",
    failedSegment: {
      bestSeen: { floorId: "SYNTHETIC", hero: { hp: 80 } },
    },
    segmentResults: [
      {
        segmentId: "synthetic-segment",
        found: false,
        attempts: [
          {
            startCandidateId: "initial#0",
            found: false,
            goalCount: 0,
            diagnostics: {
              dp: {
                expansions: 4,
                wallMs: 12,
                acceptedStates: 3,
                rejectedByHigherHp: 2,
                sameHpRejected: 1,
                replacedLowerHp: 1,
                actionTrimmed: 0,
                frontierSize: 5,
                heapUsedMb: 10,
                rssMb: 20,
                fairPops: 0,
                firstGoalExpansion: null,
                completeWithinActionSet: true,
                stoppedReason: "expansion-limit",
                agendaFairness: {
                  fairPops: 0,
                  bestPops: 4,
                  fairFallbacks: 0,
                  bestFallbacks: 0,
                  maxFairQueueAgeExpansions: 0,
                },
              },
            },
          },
          {
            startCandidateId: "initial#1",
            found: true,
            goalCount: 1,
            diagnostics: {
              dp: {
                expansions: 6,
                wallMs: 18,
                acceptedStates: 5,
                rejectedByHigherHp: 1,
                sameHpRejected: 0,
                replacedLowerHp: 2,
                actionTrimmed: 1,
                frontierSize: 2,
                heapUsedMb: 12,
                rssMb: 22,
                fairPops: 2,
                bestPops: 4,
                fairFallbacks: 1,
                bestFallbacks: 0,
                maxFairQueueAgeExpansions: 5,
                firstGoalExpansion: 6,
                firstGoalElapsedMs: 7,
                completeWithinActionSet: false,
                stoppedReason: null,
                agendaFairness: {
                  fairPops: 2,
                  bestPops: 4,
                  fairFallbacks: 1,
                  bestFallbacks: 0,
                  maxFairQueueAgeExpansions: 5,
                },
              },
            },
          },
        ],
      },
    ],
    ...(overrides || {}),
  };
}

function checkPolicyMatrix() {
  const policies = getPolicyMatrix();
  assert.deepEqual(
    policies.map((policy) => policy.id),
    ["best-first", "hybrid-fair-16", "hybrid-fair-8", "hybrid-fair-4", "fifo"],
  );
  assert(!policies.some((policy) => /-2$|-1$/.test(policy.id)));
  assert.deepEqual(
    getPolicyMatrix("best,hybrid-8,fifo,hybrid-8").map((policy) => policy.id),
    ["best-first", "hybrid-fair-8", "fifo"],
  );
}

function checkBudgetAndArgs() {
  assert.deepEqual(buildBudgetPlan("expansions", 500, {}), {
    kind: "expansions",
    value: 500,
    maxExpansions: 500,
    maxRuntimeMs: 60000,
  });
  assert.deepEqual(buildBudgetPlan("time", 20000, {}), {
    kind: "time",
    value: 20000,
    maxExpansions: 1000000,
    maxRuntimeMs: 20000,
  });
  const args = buildSegmentedChildArgs(
    {
      routeName: "synthetic-route",
      projectRoot: "C:/project",
      candidateLimit: 8,
      goalSkylineLimit: 8,
      dpSkylineMax: 4,
      preserveSkylineRoles: true,
      stopOnFirstGoal: false,
      maxActionsPerState: 256,
      startRoute: "C:/route.json",
      startRouteStep: 113,
      fromMilestone: "from",
      toMilestone: "to",
    },
    { id: "hybrid-fair-8", agendaMode: "hybrid-fair", fairnessEvery: 8 },
    buildBudgetPlan("expansions", 500, {}),
    "C:/report.json",
    "C:/out.route.json",
  );
  assert(args.includes("--agenda-mode=hybrid-fair"));
  assert(args.includes("--fairness-every=8"));
  assert(args.includes("--max-expansions=500"));
  assert(args.includes("--max-actions-per-state=256"));
  assert(args.includes("--out=C:/out.route.json"));
}

function checkAggregation() {
  const aggregate = aggregateSegmentReport(makeReport());
  assert.equal(aggregate.found, false);
  assert.equal(aggregate.metrics.expansions, 10);
  assert.equal(aggregate.metrics.wallMs, 30);
  assert.equal(aggregate.metrics.acceptedStates, 8);
  assert.equal(aggregate.metrics.fairPops, 2);
  assert.equal(aggregate.metrics.bestPops, 8);
  assert.equal(aggregate.metrics.frontierSize, 5);
  assert.equal(aggregate.metrics.minLocalFirstGoalExpansion, 6);
  assert.equal(aggregate.metrics.cumulativeFirstGoalExpansion, 10);
  assert.equal(aggregate.metrics.cumulativeFirstGoalWallMs, 19);
  assert.equal(aggregate.metrics.expansionsToFinalRequestedMilestone, 10);
  assert.equal(aggregate.segments.length, 1);
  assert.equal(aggregate.segments[0].metrics.expansions, 10);
  assert.equal(aggregate.segments[0].metrics.cumulativeExpansionsToFirstGoal, 10);
  assert.equal(aggregate.segments[0].metrics.cumulativeWallMsToFirstGoal, 19);
  assert.equal(aggregate.segments[0].found, false);
  assert.deepEqual(aggregate.stoppedReasons, ["expansion-limit"]);
  assert.equal(aggregate.completeWithinActionSet, false);
  assert.equal(aggregate.progress.hero.hp, 80);
}

function makeReplayFixture(options) {
  const config = options || {};
  const project = {
    floorsById: {
      SYNTHETIC: {
        floorId: "SYNTHETIC",
        width: 3,
        height: 3,
        map: [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
        changeFloor: {},
      },
    },
    mapNumbersById: {},
    data: { firstData: { title: "Synthetic" } },
  };
  const makeState = (routeState) => {
    const state = JSON.parse(JSON.stringify(routeState));
    syncProgress(state);
    return state;
  };
  const simulator = {
    project,
    enumerateActions: (state) => config.unavailable || state.hero.loc.x !== 1
      ? []
      : [{
          kind: "battle",
          summary: "battle:test@SYNTHETIC:2,1",
          floorId: "SYNTHETIC",
          target: { floorId: "SYNTHETIC", x: 2, y: 1 },
          stance: { floorId: "SYNTHETIC", x: 1, y: 1 },
          direction: "right",
          enemyId: "test",
          path: ["right"],
        }],
    applyAction: (state, action) => {
      if (config.applyError) throw new Error("synthetic apply failure");
      const next = makeState(state);
      next.hero.loc.x = 2;
      next.hero.hp -= 1;
      next.route = (state.route || []).concat(action.summary);
      return next;
    },
  };
  const initial = makeState({
    floorId: "SYNTHETIC",
    hero: {
      hp: 10,
      hpmax: 100,
      mana: 0,
      manamax: 0,
      atk: 1,
      def: 1,
      mdef: 0,
      money: 0,
      exp: 0,
      lv: 1,
      loc: { x: 1, y: 1, direction: "right" },
      equipment: [],
      followers: [],
    },
    inventory: {},
    flags: {},
    visitedFloors: { SYNTHETIC: true },
    floorStates: { SYNTHETIC: { removed: {}, replaced: {} } },
    route: [],
    notes: [],
    meta: { decisionDepth: 0 },
  });
  const startSnapshot = buildSolverSnapshot(project, initial, { floorIds: [] });
  const restored = createStateFromSnapshot(project, startSnapshot, { rank: "chaos" });
  syncProgress(restored);
  const action = {
    kind: "battle",
    summary: "battle:test@SYNTHETIC:2,1",
    floorId: "SYNTHETIC",
    target: { floorId: "SYNTHETIC", x: 2, y: 1 },
    stance: { floorId: "SYNTHETIC", x: 1, y: 1 },
    direction: "right",
    enemyId: "test",
    path: ["right"],
  };
  const finalState = simulator.applyAction(restored, action);
  const decision = {
    index: 1,
    kind: action.kind,
    summary: action.summary,
    floorId: action.floorId,
    target: action.target,
    stance: action.stance,
    direction: action.direction,
    enemyId: action.enemyId,
    path: action.path,
    preExactStateKey: buildStateKey(restored),
    postExactStateKey: buildStateKey(finalState),
  };
  const fingerprint = require("./lib/route-store").fingerprintAction(action);
  decision.fingerprint = fingerprint;
  if (config.badPre) decision.preExactStateKey = "bad-pre";
  if (config.badPost) decision.postExactStateKey = "bad-post";
  return {
    project,
    simulator,
    record: {
      schema: "motapathfinder.route.v1",
      source: { rank: "chaos" },
      start: { snapshot: startSnapshot, exactStateKey: buildStateKey(restored) },
      decisions: [decision],
      final: {
        snapshot: buildSolverSnapshot(project, finalState, { floorIds: [] }),
        exactStateKey: buildStateKey(finalState),
      },
    },
  };
}

function checkStrictReplay() {
  const validFixture = makeReplayFixture();
  const valid = strictReplayRoute(
    validFixture.project,
    validFixture.simulator,
    validFixture.record,
  );
  assert.equal(valid.valid, true);
  assert.equal(valid.performed, true);
  assert.equal(valid.stepsAttempted, 1);
  assert.equal(valid.stepsCompleted, 1);
  assert.equal(valid.finalState.hero.hp, 9);

  const unavailable = makeReplayFixture({ unavailable: true });
  const unavailableResult = strictReplayRoute(
    unavailable.project,
    unavailable.simulator,
    unavailable.record,
  );
  assert.equal(unavailableResult.valid, false);
  assert.match(unavailableResult.failureReason, /^action-unavailable/);
  assert.equal(unavailableResult.stepsCompleted, 0);

  const badPre = makeReplayFixture({ badPre: true });
  assert.equal(strictReplayRoute(badPre.project, badPre.simulator, badPre.record).failureReason,
    "pre-exact-state-mismatch");
  const badPost = makeReplayFixture({ badPost: true });
  assert.equal(strictReplayRoute(badPost.project, badPost.simulator, badPost.record).failureReason,
    "post-exact-state-mismatch");

  const legacy = makeReplayFixture();
  delete legacy.record.start.exactStateKey;
  delete legacy.record.decisions[0].preExactStateKey;
  delete legacy.record.decisions[0].postExactStateKey;
  legacy.record.decisions[0].preSnapshot = buildSolverSnapshot(
    legacy.project,
    createStateFromSnapshot(legacy.project, legacy.record.start.snapshot, { rank: "chaos" }),
    { floorIds: [] },
  );
  legacy.record.decisions[0].postSnapshot = buildSolverSnapshot(
    legacy.project,
    legacy.simulator.applyAction(
      createStateFromSnapshot(legacy.project, legacy.record.start.snapshot, { rank: "chaos" }),
      legacy.record.decisions[0],
    ),
    { floorIds: [] },
  );
  delete legacy.record.final.exactStateKey;
  assert.equal(
    strictReplayRoute(legacy.project, legacy.simulator, legacy.record).valid,
    true,
  );
}

function checkGlobalBudgetAndFailureClassification() {
  assert.deepEqual(segmentDpTestHooks.allocateGlobalAttemptBudget({
    remainingExpansions: 500,
    remainingRuntimeMs: 20000,
    remainingCandidates: 2,
    segmentMaxExpansions: 1000,
    segmentMaxRuntimeMs: 60000,
  }), { maxExpansions: 250, maxRuntimeMs: 10000 });
  let remainingExpansions = 500;
  let remainingRuntimeMs = 20000;
  for (let candidate = 0; candidate < 8; candidate += 1) {
    const allocation = segmentDpTestHooks.allocateGlobalAttemptBudget({
      remainingExpansions,
      remainingRuntimeMs,
      remainingCandidates: 8 - candidate,
      segmentMaxExpansions: 1000,
      segmentMaxRuntimeMs: 60000,
    });
    remainingExpansions -= allocation.maxExpansions;
    remainingRuntimeMs -= allocation.maxRuntimeMs;
  }
  assert.equal(remainingExpansions, 0);
  assert.equal(remainingRuntimeMs, 0);
  assert.deepEqual(segmentDpTestHooks.allocateGlobalAttemptBudget({
    remainingExpansions: 250,
    remainingRuntimeMs: 10000,
    remainingCandidates: 1,
    segmentMaxExpansions: 1000,
    segmentMaxRuntimeMs: 60000,
  }), { maxExpansions: 250, maxRuntimeMs: 10000 });
  const base = {
    found: false,
    strictReplay: { performed: false, valid: false },
    process: { status: 0 },
  };
  assert.equal(classifyRun({ ...base, reportStatus: "missing" }), "missing-child-report");
  assert.equal(classifyRun({ ...base, reportStatus: "invalid" }), "invalid-child-report");
  assert.equal(classifyRun({ ...base, reportStatus: "valid", process: { status: 1 } }), "child-process-error");
  assert.equal(classifyRun({ ...base, reportStatus: "valid", found: true }), "strict-replay-failure");
}

function checkRepeatAndRegression() {
  assert.equal(median([1, 3, 5]), 3);
  assert.equal(median([1, 3, 5, 7]), 4);
  assert.deepEqual(range([5, 1, 9]), { min: 1, max: 9, median: 5 });
  const runs = [
    { found: true, strictReplay: { valid: true }, metrics: { expansions: 10, wallMs: 20 } },
    { found: false, strictReplay: { valid: false }, metrics: { expansions: 30, wallMs: 40 } },
  ];
  const repeats = aggregateRepeats(runs);
  assert.equal(repeats.count, 2);
  assert.equal(repeats.foundCount, 1);
  assert.deepEqual(repeats.metrics.expansions, { min: 10, max: 30, median: 20 });
  const baseline = {
    found: true,
    strictReplay: { valid: true },
    finalState: { hero: { hp: 100 } },
    metrics: { expansions: 10, wallMs: 20 },
  };
  const current = {
    found: false,
    strictReplay: { valid: false },
    finalState: { hero: { hp: 80 } },
    metrics: { expansions: 30, wallMs: 40 },
  };
  assert.deepEqual(buildRegressionFromBaseline(current, baseline), {
    foundDelta: -1,
    replayValidDelta: -1,
    finalHpDelta: -20,
    expansionsDelta: 20,
    wallMsDelta: 20,
  });
  const currentSegments = [{
    segmentId: "s1",
    found: true,
    finalHp: 80,
    metrics: {
      expansions: 30,
      wallMs: 40,
      cumulativeExpansionsToFirstGoal: 12,
      cumulativeWallMsToFirstGoal: 16,
      frontierSize: 4,
    },
  }];
  const baselineSegments = [{
    segmentId: "s1",
    found: true,
    finalHp: 90,
    metrics: {
      expansions: 20,
      wallMs: 30,
      cumulativeExpansionsToFirstGoal: 10,
      cumulativeWallMsToFirstGoal: 12,
      frontierSize: 3,
    },
  }];
  assert.deepEqual(buildSegmentRegressionFromBaseline(currentSegments, baselineSegments), {
    s1: {
      foundDelta: 0,
      expansionsDelta: 10,
      wallMsDelta: 10,
      firstGoalExpansionDelta: 2,
      frontierSizeDelta: 1,
      finalHpDelta: -10,
    },
  });
}

function main() {
  checkPolicyMatrix();
  checkBudgetAndArgs();
  checkAggregation();
  checkRepeatAndRegression();
  checkStrictReplay();
  checkGlobalBudgetAndFailureClassification();
  console.log("check-agenda-policy-evaluation: 6/6 passed");
}

if (require.main === module) main();

module.exports = {
  checkAggregation,
  checkBudgetAndArgs,
  checkPolicyMatrix,
  checkRepeatAndRegression,
  checkStrictReplay,
  checkGlobalBudgetAndFailureClassification,
  main,
};
