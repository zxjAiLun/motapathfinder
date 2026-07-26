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
const { searchDP } = require("./lib/dp-search");
const {
  aggregateLedgerCosts,
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
  applyLedgerBackedMetrics,
  buildMatrix,
  determineStoppedReason,
  hasMatrixProvenanceMismatch,
  isChildMemoryLimit,
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
      maxHeapMb: 1400,
      maxRssMb: 1800,
      memoryCheckIntervalExpansions: 1,
      memoryCheckIntervalActions: 2,
      childOldSpaceMb: 1600,
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
  assert(args.includes("--max-heap-mb=1400"));
  assert(args.includes("--max-rss-mb=1800"));
  assert(args.includes("--memory-check-interval-expansions=1"));
  assert(args.includes("--memory-check-interval-actions=2"));
  assert(args.includes("--child-old-space-mb=1600"));
  assert(args.includes("--out=C:/out.route.json"));
}

function makeMemorySearchSimulator() {
  const action = {
    kind: "event",
    summary: "event:advance@F1:1,1",
    floorId: "F1",
    x: 1,
    y: 1,
  };
  const project = {
    floorsById: {
      F1: {
        floorId: "F1",
        width: 3,
        height: 3,
        map: [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
        changeFloor: {},
      },
    },
  };
  return {
    project,
    stopFloorId: "F1",
    getActionFingerprint: (value) => value.summary,
    enumeratePrimitiveActions: (state) => ({
      actions: state.step === 0 ? [action] : [],
    }),
    applyAction: (state) => ({
      ...state,
      step: 1,
      hero: { ...state.hero, hp: 200 },
      route: [],
    }),
    isTerminal: (state) => state.step === 1,
  };
}

function makeMemorySearchState() {
  return {
    floorId: "F1",
    step: 0,
    hero: {
      hp: 100,
      hpmax: 200,
      atk: 1,
      def: 1,
      mdef: 1,
      lv: 1,
      exp: 0,
      money: 0,
      mana: 0,
      equipment: [],
      followers: [],
      loc: { x: 1, y: 1 },
    },
    inventory: {},
    flags: {},
    visitedFloors: { F1: true },
    floorStates: {},
    route: [],
  };
}

function mb(value) {
  return value * 1024 * 1024;
}

function checkMemoryBudgetSearch() {
  const simulator = makeMemorySearchSimulator();
  let disabledSamples = 0;
  const disabled = searchDP(simulator, makeMemorySearchState(), {
    maxExpansions: 1,
    maxRuntimeMs: 1000,
    maxHeapMb: 0,
    maxRssMb: 0,
    memoryCheckIntervalExpansions: 1,
    memoryCheckIntervalActions: 1,
    memoryUsageProvider: () => {
      disabledSamples += 1;
      return { heapUsed: mb(10), rss: mb(20) };
    },
    actionProvider: () => Array.from({ length: 5 }, (_, index) => ({
      kind: "event",
      summary: `event:multi-${index}@F1:1,1`,
      floorId: "F1",
    })),
    actionApplier: (state) => ({ ...state, step: 1, route: [] }),
    goalPredicate: () => false,
  });
  assert.equal(disabled.diagnostics.dp.memory.memoryLimitsEnabled, false);
  assert(disabledSamples <= 3, `disabled caps must sample per expansion, got ${disabledSamples}`);

  const before = searchDP(simulator, makeMemorySearchState(), {
    maxExpansions: 10,
    maxRuntimeMs: 1000,
    maxHeapMb: 100,
    maxRssMb: 0,
    memoryCheckIntervalExpansions: 1,
    memoryCheckIntervalActions: 1,
    memoryUsageProvider: () => ({ heapUsed: mb(101), rss: mb(20) }),
    goalPredicate: (state) => state.step === 1,
  });
  assert.equal(before.expansions, 0);
  assert.equal(before.foundGoal, false);
  assert.equal(before.diagnostics.dp.stoppedReason, "heap-limit");
  assert.equal(before.diagnostics.dp.memory.stoppedAtPhase, "before-expansion");
  assert.equal(before.diagnostics.dp.memory.stoppedAtExpansion, 0);

  let actionProviderCalls = 0;
  const afterAction = searchDP(simulator, makeMemorySearchState(), {
    maxExpansions: 10,
    maxRuntimeMs: 1000,
    maxHeapMb: 100,
    memoryCheckIntervalExpansions: 1,
    memoryCheckIntervalActions: 1,
    memoryUsageProvider: () => {
      actionProviderCalls += 1;
      return { heapUsed: mb(actionProviderCalls === 1 ? 10 : 101), rss: mb(20) };
    },
    goalPredicate: (state) => state.step === 1,
  });
  assert.equal(afterAction.diagnostics.dp.stoppedReason, "heap-limit");
  assert.equal(afterAction.diagnostics.dp.memory.stoppedAtPhase, "after-action-provider");
  assert.equal(afterAction.diagnostics.generated, 0);

  let successorSamples = 0;
  const afterSuccessor = searchDP(simulator, makeMemorySearchState(), {
    maxExpansions: 10,
    maxRuntimeMs: 1000,
    maxHeapMb: 0,
    maxRssMb: 100,
    memoryCheckIntervalExpansions: 99,
    memoryCheckIntervalActions: 1,
    memoryUsageProvider: () => {
      successorSamples += 1;
      return {
        heapUsed: mb(10),
        rss: mb(successorSamples === 2 ? 101 : 20),
      };
    },
    goalPredicate: (state) => state.step === 1,
    stopOnFirstGoal: false,
  });
  assert.equal(afterSuccessor.foundGoal, true, "goal skyline must survive a post-enqueue memory stop");
  assert.equal(afterSuccessor.route.length, 1);
  assert.equal(afterSuccessor.diagnostics.dp.stoppedReason, "rss-limit");
  assert.equal(afterSuccessor.diagnostics.dp.memory.stoppedAtPhase, "after-successor-enqueue");
  assert.equal(afterSuccessor.diagnostics.dp.memory.rssOvershootMb, 1);
}

function checkMemoryRepairAndChildClassification() {
  const simulator = makeMemorySearchSimulator();
  let calls = 0;
  const result = require("./lib/segment-dp").runMilestoneGraph(
    simulator,
    makeMemorySearchState(),
    {
      milestones: [
        { id: "s1", label: "first", goal: { floorId: "F1", minHero: { hp: 200 } } },
        {
          id: "s2",
          label: "second",
          repairStartFrom: "s1",
          goal: { floorId: "F1", minHero: { hp: 300 } },
        },
      ],
    },
    {
      maxExpansions: 10,
      maxRuntimeMs: 1000,
      maxHeapMb: 100,
      memoryCheckIntervalExpansions: 1,
      memoryUsageProvider: () => {
        calls += 1;
        return { heapUsed: mb(calls <= 4 ? 10 : 101), rss: mb(20) };
      },
      enableFailureBacktracking: true,
      budgetScope: "per-attempt",
    },
  );
  assert.equal(result.found, false);
  assert.equal(result.memory.searchCompletion, "memory-limited");
  assert.equal(result.segmentResults[1].memory.limited, true);
  assert.equal(result.evaluationAttemptLedger.some((entry) => entry.phase !== "initial"), false);

  assert.equal(isChildMemoryLimit({ status: 1, stderr: "FATAL ERROR: JavaScript heap out of memory" }), true);
  assert.equal(isChildMemoryLimit({ status: 1, stderr: "ordinary child failure" }), false);
}

function runRetainedRepairMemoryGraph(options) {
  const config = options || {};
  let primitiveCalls = 0;
  let memorySamples = 0;
  const simulator = makeMemorySearchSimulator();
  simulator.enumeratePrimitiveActions = () => {
    primitiveCalls += 1;
    if (primitiveCalls === 2) return { actions: [] };
    return {
      actions: [{
        kind: "event",
        summary: "event:advance@F1:1,1",
        floorId: "F1",
      }],
    };
  };
  simulator.applyAction = (state) => ({
    ...state,
    step: 1,
    hero: { ...state.hero, hp: Number(state.hero.hp || 0) + 100 },
    route: [],
  });
  const milestones = [
    {
      id: "s1",
      label: "first",
      goal: { floorId: "F1", minHero: { hp: 200 } },
      dp: { maxExpansions: 10 },
    },
    {
      id: "s2",
      label: "second",
      ...(config.configured ? { repairStartFrom: "s1" } : {}),
      dp: { repairMaxExpansions: 10 },
      goal: { floorId: "F1", minHero: { hp: 300 } },
    },
  ];
  if (config.includeFollowingSegment) {
    milestones.push({
      id: "s3",
      label: "following",
      goal: { floorId: "F1", minHero: { hp: 400 } },
    });
  }
  const highSample = config.configured ? 12 : 17;
  const result = require("./lib/segment-dp").runMilestoneGraph(
    simulator,
    makeMemorySearchState(),
    { milestones },
    {
      maxExpansions: 20,
      maxRuntimeMs: 10000,
      maxHeapMb: 100,
      maxRssMb: 0,
      memoryCheckIntervalExpansions: 1,
      memoryCheckIntervalActions: 1,
      memoryUsageProvider: () => {
        memorySamples += 1;
        return {
          heapUsed: mb(memorySamples >= highSample ? 101 : 10),
          rss: mb(20),
        };
      },
      enableFailureBacktracking: true,
      budgetScope: config.budgetScope,
    },
  );
  return { result, primitiveCalls, memorySamples };
}

function checkRetainedRepairMemoryStops() {
  ["per-attempt", "global-run"].forEach((budgetScope) => {
    const configured = runRetainedRepairMemoryGraph({
      budgetScope,
      configured: true,
      includeFollowingSegment: true,
    });
    assert.equal(configured.result.found, false);
    assert.equal(configured.result.reachedMilestone, "s2");
    assert.equal(configured.result.memory.searchCompletion, "memory-limited");
    assert.equal(configured.result.segmentResults.some((segment) => segment.segmentId === "s3"), false);
    assert.equal(configured.result.evaluationAttemptLedger.some((entry) => entry.segmentId === "s3"), false);
    assert(configured.result.finalCandidates[0].route.length >= 2, "configured repair must retain its goal route");
    assert(configured.result.evaluationAttemptLedger.some((entry) => entry.phase === "configured-repair"));
    if (budgetScope === "global-run") {
      assert.equal(configured.result.budget.stoppedReason, "heap-limit");
    } else {
      assert.equal(configured.result.budget, null);
    }

    const retry = runRetainedRepairMemoryGraph({
      budgetScope,
      configured: false,
      includeFollowingSegment: true,
    });
    assert.equal(retry.result.found, false);
    assert.equal(retry.result.reachedMilestone, "s2");
    assert.equal(retry.result.memory.searchCompletion, "memory-limited");
    assert.equal(retry.result.segmentResults.some((segment) => segment.segmentId === "s3"), false);
    assert.equal(retry.result.evaluationAttemptLedger.some((entry) => entry.segmentId === "s3"), false);
    assert(retry.result.finalCandidates[0].route.length >= 2, "retry-current must retain its goal route");
    assert(retry.result.evaluationAttemptLedger.some((entry) => entry.phase === "retry-current"));
    if (budgetScope === "global-run") {
      assert.equal(retry.result.budget.stoppedReason, "heap-limit");
    } else {
      assert.equal(retry.result.budget, null);
    }
  });

  const final = runRetainedRepairMemoryGraph({
    budgetScope: "per-attempt",
    configured: true,
    includeFollowingSegment: false,
  });
  assert.equal(final.result.found, true, "final retained repair goal must remain a valid result");
  assert.equal(final.result.memory.searchCompletion, "memory-limited");
  assert(final.result.finalCandidate.state.route.length >= 2);
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
  assert.equal(classifyRun({
    ...base,
    reportStatus: "valid",
    found: true,
    strictReplay: { performed: true, valid: true },
    memory: { searchCompletion: "memory-limited" },
  }), "completed-memory-limited");
  assert.equal(classifyRun({
    ...base,
    reportStatus: "valid",
    childMemoryLimited: true,
  }), "child-memory-limit");
}

function checkRepeatAndRegression() {
  assert.equal(median([1, 3, 5]), 3);
  assert.equal(median([1, 3, 5, 7]), 4);
  assert.deepEqual(range([5, 1, 9]), { min: 1, max: 9, median: 5, sampleCount: 3, missingCount: 0 });
  const runs = [
    { found: true, strictReplay: { valid: true }, metrics: { expansions: 10, wallMs: 20 } },
    { found: false, strictReplay: { valid: false }, metrics: { expansions: 30, wallMs: 40 } },
  ];
  const repeats = aggregateRepeats(runs);
  assert.equal(repeats.count, 2);
  assert.equal(repeats.foundCount, 1);
  assert.deepEqual(repeats.metrics.expansions, { min: 10, max: 30, median: 20, sampleCount: 2, missingCount: 0 });
  const runsWithNull = [
    { found: true, strictReplay: { valid: true }, metrics: { expansions: 10, wallMs: 20, expansionsToFinalRequestedMilestone: 120 } },
    { found: false, strictReplay: { valid: false }, metrics: { expansions: 30, wallMs: 40, expansionsToFinalRequestedMilestone: null } },
    { found: true, strictReplay: { valid: true }, metrics: { expansions: 20, wallMs: 30, expansionsToFinalRequestedMilestone: 130 } },
  ];
  const repeatsWithNull = aggregateRepeats(runsWithNull);
  assert.deepEqual(repeatsWithNull.metrics.expansionsToFinalRequestedMilestone, {
    min: 120, max: 130, median: 125, sampleCount: 2, missingCount: 1,
  });
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

function checkMultiSegmentCumulative() {
  const report = {
    found: true,
    reachedMilestone: "synthetic-milestone",
    failedSegmentId: null,
    failedSegment: null,
    segmentResults: [
      {
        segmentId: "seg-a",
        found: true,
        attempts: [
          {
            startCandidateId: "a#0",
            found: true,
            goalCount: 3,
            diagnostics: {
              dp: {
                expansions: 500,
                wallMs: 1000,
                acceptedStates: 100,
                rejectedByHigherHp: 0,
                sameHpRejected: 0,
                replacedLowerHp: 0,
                actionTrimmed: 0,
                frontierSize: 10,
                heapUsedMb: 50,
                rssMb: 80,
                fairPops: 0,
                firstGoalExpansion: 20,
                firstGoalElapsedMs: 40,
                completeWithinActionSet: true,
                stoppedReason: null,
                agendaFairness: {
                  fairPops: 0, bestPops: 500, fairFallbacks: 0,
                  bestFallbacks: 0, maxFairQueueAgeExpansions: 0,
                },
              },
            },
          },
        ],
      },
      {
        segmentId: "seg-b",
        found: true,
        attempts: [
          {
            startCandidateId: "b#0",
            found: true,
            goalCount: 1,
            diagnostics: {
              dp: {
                expansions: 80,
                wallMs: 200,
                acceptedStates: 20,
                rejectedByHigherHp: 0,
                sameHpRejected: 0,
                replacedLowerHp: 0,
                actionTrimmed: 0,
                frontierSize: 5,
                heapUsedMb: 30,
                rssMb: 60,
                fairPops: 0,
                firstGoalExpansion: 30,
                firstGoalElapsedMs: 60,
                completeWithinActionSet: true,
                stoppedReason: null,
                agendaFairness: {
                  fairPops: 0, bestPops: 80, fairFallbacks: 0,
                  bestFallbacks: 0, maxFairQueueAgeExpansions: 0,
                },
              },
            },
          },
        ],
      },
    ],
  };
  const aggregate = aggregateSegmentReport(report);
  assert.equal(aggregate.segments[0].metrics.cumulativeExpansionsToFirstGoal, 20);
  assert.equal(aggregate.segments[0].metrics.expansions, 500);
  assert.equal(aggregate.segments[1].metrics.cumulativeExpansionsToFirstGoal, 30);
  assert.equal(
    aggregate.metrics.expansionsToFinalRequestedMilestone,
    530,
    "prior segment total (500) + final segment first-goal (30) = 530, not 20+30=50",
  );
  assert.equal(
    aggregate.metrics.wallMsToFinalRequestedMilestone,
    1060,
    "prior segment wallMs (1000) + final segment first-goal wallMs (60) = 1060",
  );
  assert.equal(
    aggregate.metrics.attemptsToFinalRequestedMilestone,
    2,
    "prior segment attempts (1) + final segment attemptsBeforeFirstGoal (0) + 1 = 2",
  );
}

function checkNullHandlingInRange() {
  assert.deepEqual(range([120, null, 130]), {
    min: 120, max: 130, median: 125, sampleCount: 2, missingCount: 1,
  });
  assert.deepEqual(range([null, null, null]), {
    min: null, max: null, median: null, sampleCount: 0, missingCount: 3,
  });
  assert.deepEqual(range(["", 5, null, 10]), {
    min: 5, max: 10, median: 7.5, sampleCount: 2, missingCount: 2,
  });
  assert.equal(median([null, 3, null, 7]), 5);
  assert.equal(median([null, null]), null);
}

function checkBaselineOnlySegmentRegression() {
  const currentSegments = [
    {
      segmentId: "s1", found: true, finalHp: 80,
      metrics: { expansions: 30, wallMs: 40, cumulativeExpansionsToFirstGoal: 12, cumulativeWallMsToFirstGoal: 16, frontierSize: 4 },
    },
    {
      segmentId: "s2", found: true, finalHp: 70,
      metrics: { expansions: 50, wallMs: 60, cumulativeExpansionsToFirstGoal: 20, cumulativeWallMsToFirstGoal: 25, frontierSize: 6 },
    },
  ];
  const baselineSegments = [
    {
      segmentId: "s1", found: true, finalHp: 90,
      metrics: { expansions: 20, wallMs: 30, cumulativeExpansionsToFirstGoal: 10, cumulativeWallMsToFirstGoal: 12, frontierSize: 3 },
    },
    {
      segmentId: "s2", found: true, finalHp: 85,
      metrics: { expansions: 40, wallMs: 50, cumulativeExpansionsToFirstGoal: 18, cumulativeWallMsToFirstGoal: 22, frontierSize: 5 },
    },
    {
      segmentId: "s3", found: true, finalHp: 60,
      metrics: { expansions: 100, wallMs: 120, cumulativeExpansionsToFirstGoal: 50, cumulativeWallMsToFirstGoal: 60, frontierSize: 8 },
    },
  ];
  const regression = buildSegmentRegressionFromBaseline(currentSegments, baselineSegments);
  assert.equal(regression.s1.foundDelta, 0);
  assert.equal(regression.s1.expansionsDelta, 10);
  assert.equal(regression.s2.foundDelta, 0);
  assert(regression.s3, "baseline-only segment s3 must appear in regression");
  assert.equal(regression.s3.currentMissing, true);
  assert.equal(regression.s3.baselineFound, true);
  assert.equal(regression.s3.foundDelta, -1);
  assert.equal(regression.s3.expansionsDelta, undefined, "no numeric delta for missing segment");
}

function checkLeaveLocSnapshotRoundtrip() {
  const project = {
    floorsById: {
      F1: { floorId: "F1", width: 3, height: 3, map: [[0,0,0],[0,0,0],[0,0,0]], changeFloor: {} },
    },
    mapNumbersById: {},
    data: { firstData: { title: "Test" } },
  };
  const state = {
    floorId: "F1",
    hero: {
      hp: 100, hpmax: 100, mana: 0, manamax: 0, atk: 10, def: 5, mdef: 3,
      money: 50, exp: 20, lv: 2,
      loc: { x: 1, y: 1, direction: "up" },
      equipment: [], followers: [],
    },
    inventory: { I100: 2 },
    flags: {
      __leaveLoc__: { F0: { x: 3, y: 5, direction: "down" } },
      __atk_buff__: 1.5,
      autoBattle: 1,
    },
    visitedFloors: { F1: true },
    floorStates: { F1: { removed: {}, replaced: {} } },
    route: [],
  };
  syncProgress(state);
  const snapshot = buildSolverSnapshot(project, state);
  assert(snapshot.flags.__leaveLoc__, "__leaveLoc__ must be preserved in snapshot");
  assert.deepEqual(snapshot.flags.__leaveLoc__, { F0: { x: 3, y: 5, direction: "down" } });
  assert.equal(snapshot.flags.__atk_buff__, 1.5, "_buff__ flags preserved");
  assert.equal(snapshot.flags.autoBattle, 1, "normal flags preserved");
  const restored = createStateFromSnapshot(project, snapshot, { rank: "chaos" });
  syncProgress(restored);
  assert.deepEqual(restored.flags.__leaveLoc__, state.flags.__leaveLoc__);
  assert.equal(buildStateKey(restored), buildStateKey(state), "exact state key must match after roundtrip");
  const transientState = JSON.parse(JSON.stringify(state));
  transientState.flags.__temporary__ = "should-be-excluded";
  const transientSnapshot = buildSolverSnapshot(project, transientState);
  assert.equal(transientSnapshot.flags.__temporary__, undefined, "other __ flags excluded from snapshot");
  const emptyLeaveState = JSON.parse(JSON.stringify(state));
  emptyLeaveState.flags.__leaveLoc__ = {};
  const emptySnapshot = buildSolverSnapshot(project, emptyLeaveState);
  assert.equal(emptySnapshot.flags.__leaveLoc__, undefined, "empty __leaveLoc__ not written");
}

function checkLedgerCosts() {
  const ledger = [
    { segmentId: "s1", phase: "initial", startCandidateId: "a#0", found: false, goalCount: 0,
      diagnostics: { dp: { expansions: 100, wallMs: 500, firstGoalExpansion: null } } },
    { segmentId: "s1", phase: "configured-repair", startCandidateId: "b#0", found: true, goalCount: 2,
      diagnostics: { dp: { expansions: 80, wallMs: 300, firstGoalExpansion: 30, firstGoalElapsedMs: 100 } } },
    { segmentId: "s2", phase: "initial", startCandidateId: "c#0", found: true, goalCount: 1,
      diagnostics: { dp: { expansions: 50, wallMs: 200, firstGoalExpansion: 20, firstGoalElapsedMs: 80 } } },
  ];
  const costs = aggregateLedgerCosts(ledger);
  assert.equal(costs.totalExpansions, 230);
  assert.equal(costs.totalWallMs, 1000);
  assert.equal(costs.attemptCount, 3);
  assert.equal(costs.repairOverhead, 80, "only non-initial phase counts as overhead");
  assert.equal(costs.byPhase["initial"].expansions, 150);
  assert.equal(costs.byPhase["configured-repair"].expansions, 80);
  assert.equal(costs.bySegment["s1"].expansions, 180);
  assert.equal(costs.bySegment["s2"].expansions, 50);
  assert.equal(costs.expansionsToFirstGoal, 130, "100 (prior) + 30 (firstGoalExpansion)");
  assert.equal(costs.wallMsToFirstGoal, 600, "500 (prior) + 100 (firstGoalElapsedMs)");
  const finalCosts = aggregateLedgerCosts(ledger, { finalSegmentId: "s2" });
  assert.equal(finalCosts.expansionsToFinalRequestedMilestone, 200);
  assert.equal(finalCosts.wallMsToFinalRequestedMilestone, 880);
  assert.equal(finalCosts.attemptsToFinalRequestedMilestone, 3);
  assert.equal(finalCosts.finalRequestedMilestoneGoal.segmentId, "s2");
  assert.equal(finalCosts.bySegment.s1.expansionsToFirstGoal, 130);
  assert.equal(finalCosts.bySegment.s2.expansionsToFirstGoal, 20);
  const chronology = aggregateLedgerCosts([
    { segmentId: "s1", phase: "initial", found: true, goalCount: 1, diagnostics: { dp: { expansions: 500, wallMs: 100, firstGoalExpansion: 20, firstGoalElapsedMs: 10 } } },
    { segmentId: "s2", phase: "initial", found: true, goalCount: 1, diagnostics: { dp: { expansions: 30, wallMs: 20, firstGoalExpansion: 30, firstGoalElapsedMs: 12 } } },
  ], { finalSegmentId: "s2" });
  assert.equal(chronology.expansionsToFirstGoal, 20);
  assert.equal(chronology.expansionsToFinalRequestedMilestone, 530);
  assert.equal(chronology.wallMsToFinalRequestedMilestone, 112);
  assert.equal(aggregateLedgerCosts([]), null);
  assert.equal(aggregateLedgerCosts(null), null);
}

function checkLedgerBackedProjection() {
  const aggregate = {
    metrics: {
      expansions: 120,
      wallMs: 12,
      expansionsToFinalRequestedMilestone: 120,
      wallMsToFinalRequestedMilestone: 12,
      attemptsToFinalRequestedMilestone: 1,
    },
    segments: [{
      segmentId: "s1",
      found: true,
      attempts: 1,
      finalHp: 90,
      metrics: {
        expansions: 120,
        wallMs: 12,
        cumulativeExpansionsToFirstGoal: 120,
        cumulativeWallMsToFirstGoal: 12,
      },
    }],
  };
  const ledgerCosts = aggregateLedgerCosts([{
    segmentId: "s1",
    phase: "initial",
    found: true,
    goalCount: 1,
    diagnostics: { dp: { expansions: 200, wallMs: 20, firstGoalExpansion: 200, firstGoalElapsedMs: 20 } },
  }], { finalSegmentId: "s1" });
  const projected = applyLedgerBackedMetrics(aggregate, ledgerCosts);
  assert.equal(projected.metrics.expansions, 200);
  assert.equal(projected.metrics.wallMs, 20);
  assert.equal(projected.metrics.expansionsToFinalRequestedMilestone, 200);
  assert.equal(projected.segmentMetrics[0].metrics.expansions, 200);
  assert.equal(projected.segmentMetrics[0].metrics.wallMs, 20);
  const repeats = aggregateRepeats([{ metrics: projected.metrics, found: true }]);
  assert.deepEqual(repeats.metrics.expansions, { min: 200, max: 200, median: 200, sampleCount: 1, missingCount: 0 });
  const baseline = { found: true, strictReplay: { valid: true }, finalState: { hero: { hp: 90 } }, metrics: { expansions: 150, wallMs: 15 } };
  const current = { found: true, strictReplay: { valid: true }, finalState: { hero: { hp: 90 } }, metrics: projected.metrics };
  assert.equal(buildRegressionFromBaseline(current, baseline).expansionsDelta, 50);
}

function checkRequestedMilestoneLedgerSemantics() {
  const s2Only = aggregateLedgerCosts([{
    segmentId: "s2",
    phase: "initial",
    found: true,
    goalCount: 1,
    diagnostics: { dp: { expansions: 40, wallMs: 8, firstGoalExpansion: 12, firstGoalElapsedMs: 3 } },
  }], { finalSegmentId: "s3" });
  assert.equal(s2Only.finalRequestedMilestoneGoal, null);
  assert.equal(s2Only.expansionsToFinalRequestedMilestone, null);
  assert.equal(s2Only.wallMsToFinalRequestedMilestone, null);
  assert.equal(s2Only.attemptsToFinalRequestedMilestone, null);

  const oldAggregate = {
    metrics: {
      expansions: 99,
      wallMs: 9,
      expansionsToFinalRequestedMilestone: 99,
      wallMsToFinalRequestedMilestone: 9,
      attemptsToFinalRequestedMilestone: 1,
      cumulativeFirstGoalExpansion: 99,
      cumulativeFirstGoalWallMs: 9,
    },
    segments: [{
      segmentId: "s2",
      metrics: {
        expansions: 40,
        wallMs: 8,
        cumulativeExpansionsToFirstGoal: 40,
        cumulativeWallMsToFirstGoal: 8,
      },
    }],
  };
  const projected = applyLedgerBackedMetrics(oldAggregate, s2Only);
  assert.equal(projected.metrics.expansionsToFinalRequestedMilestone, null);
  assert.equal(projected.metrics.wallMsToFinalRequestedMilestone, null);
  assert.equal(projected.metrics.attemptsToFinalRequestedMilestone, null);
  assert.equal(projected.metrics.cumulativeFirstGoalExpansion, null);
  assert.equal(projected.metrics.cumulativeFirstGoalWallMs, null);

  const transientThenRepair = aggregateLedgerCosts([
    {
      segmentId: "s1",
      phase: "initial",
      found: true,
      goalCount: 1,
      diagnostics: { dp: { expansions: 500, wallMs: 100, firstGoalExpansion: null } },
    },
    {
      segmentId: "s3",
      phase: "initial",
      found: false,
      goalCount: 0,
      diagnostics: { dp: { expansions: 30, wallMs: 20, firstGoalExpansion: 30, firstGoalElapsedMs: 12 } },
    },
    {
      segmentId: "s3",
      phase: "configured-repair",
      found: true,
      goalCount: 1,
      diagnostics: { dp: { expansions: 40, wallMs: 30, firstGoalExpansion: 10, firstGoalElapsedMs: 5 } },
    },
  ], { finalSegmentId: "s3" });
  assert.equal(transientThenRepair.expansionsToFinalRequestedMilestone, 540);
  assert.equal(transientThenRepair.wallMsToFinalRequestedMilestone, 125);
  assert.equal(transientThenRepair.attemptsToFinalRequestedMilestone, 3);
  assert.equal(transientThenRepair.finalRequestedMilestoneGoal.phase, "configured-repair");

  assert.equal(
    hasMatrixProvenanceMismatch("A", "B", [
      { provenance: { solverCommit: "A", commitStable: true } },
      { provenance: { solverCommit: "B", commitStable: true } },
    ]),
    true,
  );
  assert.equal(
    determineStoppedReason([
      { runStatus: "completed" },
    ], { matrixProvenanceMismatch: true }),
    "provenance-mismatch",
  );
}

function checkLedgerConsistencyClassification() {
  const base = {
    found: true,
    strictReplay: { performed: true, valid: true },
    process: { status: 0 },
    reportStatus: "valid",
  };
  assert.equal(
    classifyRun({ ...base, ledgerConsistency: { match: true } }),
    "completed",
  );
  assert.equal(
    classifyRun({ ...base, ledgerConsistency: { match: false, delta: 600 } }),
    "ledger-consistency-failure",
  );
  assert.equal(
    classifyRun({ ...base, ledgerConsistency: null }),
    "completed",
  );
  assert.equal(
    classifyRun({ ...base, provenance: { commitStable: false }, ledgerConsistency: { match: true } }),
    "provenance-mismatch",
  );
  assert.equal(
    determineStoppedReason([{ runStatus: "ledger-consistency-failure" }]),
    "ledger-consistency-failure",
  );
  const matrix = buildMatrix([{
    policy: "best-first",
    budget: { kind: "expansions", value: 1 },
    repeat: 1,
    found: true,
    strictReplay: { valid: true },
    runStatus: "completed",
    metrics: { expansions: 200, wallMs: 20 },
    segmentMetrics: [],
    ledgerCosts: { totalExpansions: 200 },
    ledgerConsistency: { match: true },
  }]);
  assert.equal(matrix.summaries["best-first"]["expansions:1"].runs[0].ledgerCosts.totalExpansions, 200);
  assert.equal(matrix.summaries["best-first"]["expansions:1"].runs[0].ledgerConsistency.match, true);
}

function checkMemoryMatrixSummary() {
  const matrix = buildMatrix([{
    policy: "best-first",
    budget: { kind: "expansions", value: 500 },
    repeat: 1,
    found: true,
    strictReplay: { performed: true, valid: true },
    runStatus: "completed-memory-limited",
    metrics: { expansions: 10, wallMs: 20 },
    segmentMetrics: [],
    memory: {
      searchCompletion: "memory-limited",
      heapLimitedCount: 1,
      rssLimitedCount: 0,
      childMemoryLimited: false,
      peakHeapUsedMb: 101,
      peakRssMb: 120,
    },
    childMemoryLimited: false,
  }]);
  const summary = matrix.summaries["best-first"]["expansions:500"].memory;
  assert.equal(summary.heapLimitedCount, 1);
  assert.equal(summary.rssLimitedCount, 0);
  assert.equal(summary.childMemoryLimitedCount, 0);
  assert.equal(summary.peakHeapUsedMb.max, 101);
  assert.equal(summary.peakRssMb.max, 120);
}

function main() {
  checkPolicyMatrix();
  checkBudgetAndArgs();
  checkAggregation();
  checkRepeatAndRegression();
  checkStrictReplay();
  checkGlobalBudgetAndFailureClassification();
  checkMemoryBudgetSearch();
  checkMemoryRepairAndChildClassification();
  checkRetainedRepairMemoryStops();
  checkMultiSegmentCumulative();
  checkNullHandlingInRange();
  checkBaselineOnlySegmentRegression();
  checkLeaveLocSnapshotRoundtrip();
  checkLedgerCosts();
  checkLedgerBackedProjection();
  checkRequestedMilestoneLedgerSemantics();
  checkLedgerConsistencyClassification();
  checkMemoryMatrixSummary();
  console.log("check-agenda-policy-evaluation: 18/18 passed");
}

if (require.main === module) main();

module.exports = {
  checkAggregation,
  checkBudgetAndArgs,
  checkPolicyMatrix,
  checkRepeatAndRegression,
  checkStrictReplay,
  checkGlobalBudgetAndFailureClassification,
  checkMemoryBudgetSearch,
  checkMemoryRepairAndChildClassification,
  checkRetainedRepairMemoryStops,
  checkMultiSegmentCumulative,
  checkNullHandlingInRange,
  checkBaselineOnlySegmentRegression,
  checkLeaveLocSnapshotRoundtrip,
  checkLedgerCosts,
  checkLedgerBackedProjection,
  checkRequestedMilestoneLedgerSemantics,
  checkLedgerConsistencyClassification,
  checkMemoryMatrixSummary,
  main,
};
