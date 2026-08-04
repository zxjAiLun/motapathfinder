"use strict";

/**
 * TEST GRADE: unit-plus-micro
 *
 * PR-5.3c SolverJob contract: state machine transitions, cooperative cancel,
 * honest progress (monotonic sequence, no fake percent), failure
 * classification (budget exhaustion is not no-route), result identity binding,
 * and a real Only Up micro job from queued to completed.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { compileSolveTask, SOLVE_TASK_SCHEMA } = require("./lib/solve-task");
const {
  SolverJob,
  SolverJobError,
  assertValidTransition,
} = require("./lib/solver-job");
const { SolverJobManager } = require("./lib/solver-job-manager");
const { createWorkerExecutor } = require("./lib/solver-worker-runner");
const { classifyJobFailure, buildSolverJobResult } = require("./lib/solver-job-result");
const { SolverProgressAccumulator } = require("./lib/solver-progress");
const { compileObjectiveSpec } = require("./lib/objective-spec");

const ROOT = path.resolve(__dirname, "..");
const SMOKE_SPEC_FILE = path.join(ROOT, "towers", "onlyup", "region-specs", "region-output-contract-smoke.json");
const ONLY_UP_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");

function baseRegionSpec() {
  return {
    id: "synthetic-region",
    tower: "onlyup",
    rank: "chaos",
    scope: { floors: ["MT1"] },
    goal: { type: "heroAtLeast", floorId: "MT1", minHero: { exp: 2 } },
    start: { type: "initial", floorId: "MT1" },
    search: { algorithm: "segment-dp", dpKeyMode: "region", candidateLimit: 2 },
    expectedRegressionTraps: ["synthetic-control"],
    resourceTimingPolicy: { mode: "unspecified" },
    actionPolicy: {
      actionKinds: ["battle", "pickup", "interactPickup", "equip", "openDoor", "useTool", "changeFloor", "floorFly", "event"],
    },
  };
}

function baseTask(overrides) {
  return {
    schema: SOLVE_TASK_SCHEMA,
    tower: {
      id: "onlyup-synthetic",
      projectRoot: ONLY_UP_ROOT,
      region: { spec: baseRegionSpec() },
    },
    objective: { mode: "max-final-hp" },
    search: {
      algorithm: "segment-dp",
      maxExpansions: 1000,
      maxRuntimeMs: 10000,
      candidateLimit: 2,
      goalSkylineLimit: 8,
    },
    verification: { strictReplay: true },
    ...(overrides || {}),
  };
}

function waitForJob(manager, id, timeoutMs) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      const job = manager.getJob(id);
      if (job && (job.state === "completed" || job.state === "failed" || job.state === "cancelled")) {
        resolve(job);
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`timed out waiting for job ${id}`));
        return;
      }
      setTimeout(poll, 20);
    };
    poll();
  });
}

function checkStateMachine() {
  const job = new SolverJob({ id: "sm-job", task: { taskFingerprint: "abc" } });
  assert.strictEqual(job.state, "queued");
  job.transition("running");
  assert.strictEqual(job.state, "running");
  assert.throws(() => job.transition("running"), (error) => error.code === "JOB_INVALID_STATE_TRANSITION");
  assert.throws(() => job.transition("queued"), (error) => error.code === "JOB_INVALID_STATE_TRANSITION");
  assert.throws(() => job.requestPause(), (error) => error.code === "JOB_PAUSE_UNSUPPORTED");
  job.transition("completed");
  assert.throws(() => job.transition("running"), (error) => error.code === "JOB_INVALID_STATE_TRANSITION");
  assert.throws(() => job.transition("cancelled"), (error) => error.code === "JOB_INVALID_STATE_TRANSITION");
  // queued -> cancelled is legal.
  const queued = new SolverJob({ id: "sm-queued", task: { taskFingerprint: "x" } });
  queued.transition("cancelled");
  assert.strictEqual(queued.state, "cancelled");
  // running -> failed legal.
  const running = new SolverJob({ id: "sm-running", task: { taskFingerprint: "x" } });
  running.transition("running");
  running.transition("failed");
  assert.strictEqual(running.state, "failed");
}

function checkProgressContract() {
  const published = [];
  const accumulator = new SolverProgressAccumulator({
    jobId: "job-p",
    taskFingerprint: "fp-p",
    onPublish: (snapshot) => published.push(snapshot),
    throttleMs: 0,
    expansionEvery: 2,
    maxExpansions: 1000,
  });
  accumulator.setStatus("running");
  accumulator.setPhase("preflight");
  for (let index = 0; index < 5; index += 1) {
    accumulator.handleDpEvent({ eventType: "agendaPopped" });
    accumulator.handleDpEvent({ eventType: "candidateGenerated" });
    accumulator.handleDpEvent({ eventType: "goalAccepted" });
  }
  accumulator.setPhase("segment-search");
  accumulator.setBestKnown({ kind: "goal-candidate", goalReached: true, objectiveValue: 100 });
  accumulator.setPhase("completed");
  accumulator.flush();
  let lastSequence = 0;
  published.forEach((snapshot) => {
    assert.strictEqual(typeof snapshot.sequence, "number");
    assert.ok(snapshot.sequence > lastSequence, "progress sequence must be strictly monotonic");
    lastSequence = snapshot.sequence;
    assert.strictEqual(snapshot.percent, undefined, "progress must never contain a fake percent field");
    assert.strictEqual(snapshot.schema, "motapathfinder.solver-progress.v1");
  });
  const budgetSnapshot = published.find((snapshot) => snapshot.phase === "segment-search");
  assert.strictEqual(budgetSnapshot.search.expansions, 5);
  assert.strictEqual(budgetSnapshot.budget.expansionBudgetUsedRatio, 0.005);
  assert.ok(budgetSnapshot.budget.expansionBudgetExhausted === false);
}

function checkFailureClassification() {
  const dp = (fields) => ({ diagnostics: { dp: { actionTrimmed: 0, stoppedReason: null, expansionBudgetExhausted: false, ...fields } } });
  // Budget exhausted is retryable, never a no-route proof.
  const budgetFailure = classifyJobFailure({
    result: {
      found: false,
      segmentResults: [{ segmentId: "s", attempts: [{ diagnostics: { dp: { expansionBudgetExhausted: true, expansions: 50000, frontierSize: 284 } } }] }],
    },
    proofClaim: { completeWithinActionSet: false },
  });
  assert.strictEqual(budgetFailure.failureClass, "EXPANSION_BUDGET_EXHAUSTED");
  assert.strictEqual(budgetFailure.retryable, true);
  // Runtime budget exhausted.
  const runtimeFailure = classifyJobFailure({
    result: { found: false, segmentResults: [{ segmentId: "s", attempts: [{ diagnostics: { dp: { stoppedReason: "time-limit" } } }] }] },
    proofClaim: { completeWithinActionSet: false },
  });
  assert.strictEqual(runtimeFailure.failureClass, "RUNTIME_BUDGET_EXHAUSTED");
  assert.strictEqual(runtimeFailure.retryable, true);
  // Action trimmed is retryable, not a no-route proof.
  const trimFailure = classifyJobFailure({
    result: { found: false, segmentResults: [{ segmentId: "s", attempts: [{ diagnostics: { dp: { actionTrimmed: 12 } } }] }] },
    proofClaim: { completeWithinActionSet: false },
  });
  assert.strictEqual(trimFailure.failureClass, "ACTION_TRIMMED");
  assert.strictEqual(trimFailure.retryable, true);
  // Cancelled.
  const cancelFailure = classifyJobFailure({
    result: { found: false, cancelled: true, stoppedReason: "cancel-requested" },
    proofClaim: null,
  });
  assert.strictEqual(cancelFailure.failureClass, "CANCELLED");
  assert.strictEqual(cancelFailure.retryable, false);
  // Found -> no failure.
  assert.strictEqual(classifyJobFailure({ result: { found: true } }), null);
  // Genuine complete-action-set no-route.
  const noRoute = classifyJobFailure({
    result: { found: false, segmentResults: [{ segmentId: "s", attempts: [dp({})] }] },
    proofClaim: { completeWithinActionSet: true },
  });
  assert.strictEqual(noRoute.failureClass, "GOAL_NOT_REACHED");
  assert.strictEqual(noRoute.retryable, false);
  void dp;
}

function checkResultIdentityBinding() {
  const task = compileSolveTask(baseTask());
  const objective = compileObjectiveSpec({ mode: "max-final-hp" }, null);
  const result = buildSolverJobResult({
    jobId: "job-r",
    task,
    status: "completed",
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    found: true,
    failure: null,
    proofClaim: { found: true },
    objective: { fingerprint: objective.fingerprint, value: 100, comparisonTrace: [] },
    routeRecord: null,
    strictReplayVerified: false,
    diagnostics: {},
  });
  assert.strictEqual(result.taskFingerprint, task.taskFingerprint);
  assert.strictEqual(result.identity.taskFingerprint, task.taskFingerprint);
  assert.strictEqual(result.identity.solverModelFingerprint, task.solverModelFingerprint);
  assert.strictEqual(result.identity.objectiveFingerprint, task.objectiveFingerprint);
  assert.strictEqual(result.schema, "motapathfinder.solver-job-result.v1");
}

async function checkMicroJobLifecycle() {
  const spec = JSON.parse(fs.readFileSync(SMOKE_SPEC_FILE, "utf8"));
  const task = compileSolveTask({
    schema: SOLVE_TASK_SCHEMA,
    tower: { id: "onlyup-smoke", projectRoot: ONLY_UP_ROOT, region: { spec } },
    objective: { mode: "max-final-hp" },
    search: { algorithm: "segment-dp", maxExpansions: 1000, maxRuntimeMs: 10000, candidateLimit: 2 },
  });
  const manager = new SolverJobManager({ maxConcurrentJobs: 1 });
  const job = manager.submit(task);
  const phases = [];
  let lastSequence = 0;
  let mono = true;
  manager.subscribe(job.id, (snapshot) => {
    phases.push(snapshot.phase);
    if (snapshot.sequence <= lastSequence) mono = false;
    lastSequence = snapshot.sequence;
    if (snapshot.percent !== undefined) mono = false;
  });
  const settled = await waitForJob(manager, job.id, 120000);
  assert.strictEqual(settled.state, "completed", "micro job must complete");
  assert.strictEqual(mono, true, "progress sequence must be monotonic without a fake percent");
  ["preflight", "segment-search", "route-build", "strict-replay"].forEach((phase) => {
    assert.ok(phases.includes(phase), `progress must pass through ${phase}`);
  });
  assert.strictEqual(settled.result.found, true);
  assert.strictEqual(settled.result.route.strictReplayVerified, true);
  assert.strictEqual(settled.result.identity.taskFingerprint, task.taskFingerprint);
  const expectedValue = settled.result.route.record.metadata.finalObjectiveValue;
  assert.strictEqual(settled.result.objective.value, expectedValue, "bestKnown/objective value must agree with the ObjectiveSpec evaluation");
}

async function checkCancelQueued() {
  const task = compileSolveTask(baseTask());
  const manager = new SolverJobManager({ maxConcurrentJobs: 1 });
  const job = manager.submit(task);
  const cancelled = manager.cancel(job.id);
  assert.strictEqual(cancelled, true);
  assert.strictEqual(manager.getJob(job.id).state, "cancelled");
}

async function checkWorkerCancel() {
  // A worker job with a large budget is cancelled mid-run; the settled state
  // must be cancelled and never completed.
  const spec = JSON.parse(fs.readFileSync(SMOKE_SPEC_FILE, "utf8"));
  const task = compileSolveTask({
    schema: SOLVE_TASK_SCHEMA,
    tower: { id: "onlyup-smoke", projectRoot: ONLY_UP_ROOT, region: { spec } },
    objective: { mode: "max-final-hp" },
    search: { algorithm: "segment-dp", maxExpansions: 100000000, maxRuntimeMs: 0, candidateLimit: 2 },
  });
  const manager = new SolverJobManager({
    maxConcurrentJobs: 1,
    createExecutor: createWorkerExecutor,
  });
  const job = manager.submit(task);
  setTimeout(() => {
    try {
      manager.cancel(job.id);
    } catch (error) {
      // the job may already have settled; ignore
    }
  }, 300);
  const settled = await waitForJob(manager, job.id, 120000);
  assert.strictEqual(settled.state, "cancelled", "cancel must settle to cancelled");
  assert.ok(settled.result === null || settled.result.status !== "completed", "a cancelled job must never output completed");
}

async function main() {
  checkStateMachine();
  checkProgressContract();
  checkFailureClassification();
  checkResultIdentityBinding();
  await checkMicroJobLifecycle();
  await checkCancelQueued();
  await checkWorkerCancel();
  process.stdout.write(JSON.stringify({
    schema: "motapathfinder.pr-5.3c-solver-job-contract.v1",
    status: "passed",
    controls: {
      stateMachineTransitions: true,
      pauseRejectedAsUnsupported: true,
      progressSequenceMonotonic: true,
      progressNoFakePercent: true,
      budgetExhaustedRetryable: true,
      actionTrimmedRetryable: true,
      cancelIsCancelledNotCompleted: true,
      workerCancelSettlesCancelled: true,
      resultIdentityBoundToTask: true,
      microJobQueuedToCompleted: true,
      phasesIncludePreflightSegmentStrictReplay: true,
    },
  }, null, 2) + "\n");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  });
}

module.exports = { main };
