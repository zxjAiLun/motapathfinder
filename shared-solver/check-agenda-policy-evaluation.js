"use strict";

/**
 * TEST GRADE: unit
 *
 * Synthetic contract checks for PR-4.2 evaluation plumbing. This check does
 * not load a tower project, teacher route, or generated search output.
 */

const assert = require("node:assert");

const {
  aggregateRepeats,
  aggregateSegmentReport,
  buildBudgetPlan,
  buildRegressionFromBaseline,
  buildSegmentedChildArgs,
  getPolicyMatrix,
  median,
  range,
} = require("./lib/agenda-policy-evaluation");

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
  assert.equal(aggregate.metrics.firstGoalExpansion, 6);
  assert.equal(aggregate.segments.length, 1);
  assert.equal(aggregate.segments[0].metrics.expansions, 10);
  assert.equal(aggregate.segments[0].found, false);
  assert.deepEqual(aggregate.stoppedReasons, ["expansion-limit"]);
  assert.equal(aggregate.completeWithinActionSet, false);
  assert.equal(aggregate.progress.hero.hp, 80);
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
}

function main() {
  checkPolicyMatrix();
  checkBudgetAndArgs();
  checkAggregation();
  checkRepeatAndRegression();
  console.log("check-agenda-policy-evaluation: 4/4 passed");
}

if (require.main === module) main();

module.exports = {
  checkAggregation,
  checkBudgetAndArgs,
  checkPolicyMatrix,
  checkRepeatAndRegression,
  main,
};
