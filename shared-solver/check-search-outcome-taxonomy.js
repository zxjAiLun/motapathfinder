"use strict";

const assert = require("node:assert");

const {
  buildResultSearchOutcome,
  buildSearchOutcome,
} = require("./lib/search-outcome");
const { buildSolverDoctorReport } = require("./lib/solver-doctor");
const { buildDiagnosticsSummary } = require("./lib/solver-job");
const { buildSolverJobResult } = require("./lib/solver-job-result");

function assertOutcome(input, expected) {
  assert.deepStrictEqual(buildSearchOutcome(input), expected);
}

function attempt(found, fields) {
  return {
    found,
    diagnostics: {
      dp: { ...fields },
    },
  };
}

function checkTruthTable() {
  assertOutcome(
    {
      goalFound: true,
      frontierSize: 201,
      expansionBudgetExhausted: true,
    },
    {
      goalFound: true,
      frontierExhausted: false,
      budgetExhausted: true,
      searchComplete: false,
      outcomeClass: "goal-found-search-incomplete",
    },
  );
  assertOutcome(
    { goalFound: true, frontierSize: 0 },
    {
      goalFound: true,
      frontierExhausted: true,
      budgetExhausted: false,
      searchComplete: true,
      outcomeClass: "goal-found-search-complete",
    },
  );
  assertOutcome(
    { goalFound: false, frontierSize: 0 },
    {
      goalFound: false,
      frontierExhausted: true,
      budgetExhausted: false,
      searchComplete: true,
      outcomeClass: "goal-not-found-search-complete",
    },
  );
  assertOutcome(
    {
      goalFound: false,
      frontierSize: 8,
      stoppedReason: "time-limit",
    },
    {
      goalFound: false,
      frontierExhausted: false,
      budgetExhausted: true,
      searchComplete: false,
      outcomeClass: "goal-not-found-search-incomplete",
    },
  );
  assert.strictEqual(buildSearchOutcome({
    goalFound: true,
    frontierSize: 9,
    stopOnFirstGoal: true,
  }).searchComplete, false);
  assert.strictEqual(buildSearchOutcome({
    goalFound: false,
    frontierSize: 0,
    actionTrimmed: 1,
  }).searchComplete, false);
  assert.strictEqual(buildSearchOutcome({
    goalFound: false,
    frontierSize: 3,
    stoppedReason: "rss-limit",
  }).budgetExhausted, true);
}

function checkAggregationAndDoctor() {
  const result = {
    found: true,
    segmentResults: [
      {
        segmentId: "mt7-left-sword",
        attempts: [attempt(true, {
          expansions: 500,
          frontierSize: 201,
          expansionBudgetExhausted: true,
          actionTrimmed: 0,
          stoppedReason: null,
        })],
      },
    ],
  };
  assert.deepStrictEqual(buildResultSearchOutcome(result), {
    goalFound: true,
    frontierExhausted: false,
    budgetExhausted: true,
    searchComplete: false,
    outcomeClass: "goal-found-search-incomplete",
  });
  const doctor = buildSolverDoctorReport(result);
  assert.strictEqual(doctor.status, "feasible-incomplete");
  assert.strictEqual(doctor.searchOutcome.goalFound, true);
  assert.strictEqual(doctor.searchOutcome.searchComplete, false);
  assert.ok(doctor.line.includes("goal found; search incomplete"));
  assert.ok(doctor.line.includes("The recorded route is feasible"));
  assert.ok(!doctor.line.includes(" failed as "));

  const completeDoctor = buildSolverDoctorReport({
    found: true,
    segmentResults: [{
      segmentId: "complete",
      attempts: [attempt(true, { frontierSize: 0 })],
    }],
  });
  assert.strictEqual(completeDoctor.status, "solved");
  assert.strictEqual(completeDoctor.searchOutcome.searchComplete, true);
}

function checkJobResultProjection() {
  const result = {
    found: true,
    reachedMilestone: "mt7-left-sword",
    segmentResults: [{
      segmentId: "mt7-left-sword",
      attempts: [attempt(true, {
        frontierSize: 201,
        expansionBudgetExhausted: true,
      })],
    }],
  };
  const diagnostics = buildDiagnosticsSummary(result, { found: true });
  assert.strictEqual(diagnostics.goalFound, true);
  assert.strictEqual(diagnostics.frontierExhausted, false);
  assert.strictEqual(diagnostics.budgetExhausted, true);
  assert.strictEqual(diagnostics.searchComplete, false);
  const envelope = buildSolverJobResult({
    jobId: "taxonomy-contract",
    task: null,
    status: "completed",
    found: true,
    failure: null,
    diagnostics,
  });
  assert.deepStrictEqual(envelope.searchOutcome, diagnostics.searchOutcome);
  assert.strictEqual(envelope.failure, null);
  assert.strictEqual(envelope.status, "completed");
}

function main() {
  checkTruthTable();
  checkAggregationAndDoctor();
  checkJobResultProjection();
  process.stdout.write(`${JSON.stringify({
    schema: "motapathfinder.search-outcome-taxonomy.v1",
    status: "passed",
    contract: {
      dimensions: [
        "goalFound",
        "frontierExhausted",
        "budgetExhausted",
        "searchComplete",
      ],
      goalFoundIncompleteIsFailure: false,
      doctorStatus: "feasible-incomplete",
      searchBehaviorChanged: false,
    },
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main };
