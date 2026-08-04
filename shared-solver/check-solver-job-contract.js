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
const REGION1_SPEC_FILE = path.join(ROOT, "towers", "onlyup", "region-specs", "region-1.json");
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
    verification: { strictReplay: false },
  });
  const manager = new SolverJobManager({ maxConcurrentJobs: 1, allowInProcess: true });
  const job = manager.submit(task);
  const phases = [];
  let lastSequence = 0;
  let mono = true;
  let terminalSeen = false;
  manager.subscribe(job.id, (snapshot) => {
    phases.push(snapshot.phase);
    if (snapshot.sequence <= lastSequence) mono = false;
    lastSequence = snapshot.sequence;
    if (snapshot.percent !== undefined) mono = false;
    if (snapshot.phase === "completed") terminalSeen = true;
  });
  const settled = await waitForJob(manager, job.id, 120000);
  assert.strictEqual(settled.state, "completed", "micro job must complete");
  assert.strictEqual(mono, true, "progress sequence must be monotonic without a fake percent");
  assert.strictEqual(terminalSeen, true, "a completed terminal progress snapshot must be published");
  ["preflight", "segment-search", "route-build", "strict-replay"].forEach((phase) => {
    assert.ok(phases.includes(phase), `progress must pass through ${phase}`);
  });
  assert.strictEqual(settled.result.found, true);
  assert.strictEqual(settled.result.route.strictReplayVerified, false, "strictReplay=false must not claim verification");
  assert.strictEqual(settled.result.route.verificationStatus, "not-requested");
  assert.strictEqual(settled.result.identity.taskFingerprint, task.taskFingerprint);
  const expectedValue = settled.result.route.record.metadata.finalObjectiveValue;
  assert.strictEqual(settled.result.objective.value, expectedValue, "objective value must agree with the ObjectiveSpec evaluation");
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
  // A genuinely long worker job (region-1 with a huge budget) is cancelled; the
  // settled state must be cancelled, never completed, and the search must be
  // aborted (expansions far below the budget).
  const spec = JSON.parse(fs.readFileSync(REGION1_SPEC_FILE, "utf8"));
  const task = compileSolveTask({
    schema: SOLVE_TASK_SCHEMA,
    tower: { id: "onlyup-region1", projectRoot: ONLY_UP_ROOT, region: { spec } },
    search: { algorithm: "segment-dp", maxExpansions: 100000000, maxRuntimeMs: 0, candidateLimit: 8 },
    verification: { strictReplay: false },
  });
  const manager = new SolverJobManager({
    maxConcurrentJobs: 1,
    createExecutor: createWorkerExecutor,
  });
  const job = manager.submit(task);
  let lastExpansions = 0;
  manager.subscribe(job.id, (snapshot) => {
    lastExpansions = Math.max(lastExpansions, snapshot.search.expansions || 0);
  });
  const startedAt = Date.now();
  setTimeout(() => {
    try {
      manager.cancel(job.id);
    } catch (error) {
      // the job may already have settled; ignore
    }
  }, 300);
  const settled = await waitForJob(manager, job.id, 120000);
  assert.strictEqual(settled.state, "cancelled", "cancel must settle to cancelled");
  assert.ok(Date.now() - startedAt < 30000, "a cancelled worker job must stop within a bounded time");
  assert.ok(
    lastExpansions < 1000000,
    `cancelled search must be aborted, not naturally finished: expansions=${lastExpansions}`,
  );
  assert.ok(settled.result === null || settled.result.status !== "completed", "a cancelled job must never output completed");
  assert.strictEqual(settled.failure.failureClass, "CANCELLED");
}

async function checkConcurrencyBarrier() {
  // maxConcurrentJobs=1 must never run two executors at the same time, even
  // when jobs are submitted synchronously in the same tick.
  const task = compileSolveTask(baseTask({ verification: { strictReplay: false } }));
  const started = [];
  let releaseFirst;
  let releaseSecond;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const secondGate = new Promise((resolve) => { releaseSecond = resolve; });
  const mockExecution = { cancelled: false, result: { found: true }, proofClaim: null, objectiveValue: null, routeRecord: null, strictReplayVerified: false };
  const manager = new SolverJobManager({
    maxConcurrentJobs: 1,
    allowInProcess: true,
    createExecutor: ({ job }) => {
      started.push(job.id);
      if (started.length === 1) {
        return {
          execute: () => firstGate.then(() => mockExecution),
          cancel() {}, dispose() {},
        };
      }
      if (started.length === 2) {
        return {
          execute: () => secondGate.then(() => mockExecution),
          cancel() {}, dispose() {},
        };
      }
      return {
        execute: () => Promise.resolve(mockExecution),
        cancel() {}, dispose() {},
      };
    },
  });
  const jobA = manager.submit(task);
  const jobB = manager.submit(task);
  const jobC = manager.submit(task);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.strictEqual(started.length, 1, "only one executor may start with maxConcurrentJobs=1");
  assert.strictEqual(manager.getJob(jobA.id).state, "running");
  assert.strictEqual(manager.getJob(jobB.id).state, "queued");
  assert.strictEqual(manager.getJob(jobC.id).state, "queued");
  releaseFirst();
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.strictEqual(started.length, 2, "after releasing the first job, exactly one more executor starts");
  assert.strictEqual(manager.getJob(jobB.id).state, "running");
  assert.strictEqual(manager.getJob(jobC.id).state, "queued", "the third job must wait for the second slot");
  releaseSecond();
  await waitForJob(manager, jobA.id, 5000);
  await waitForJob(manager, jobB.id, 5000);
  await waitForJob(manager, jobC.id, 5000);
}

function checkDefaultManagerUsesWorker() {
  const workerManager = new SolverJobManager({ maxConcurrentJobs: 1 });
  assert.strictEqual(workerManager.executorKind, "worker", "the default manager must use a worker executor");
  const inProcess = new SolverJobManager({ maxConcurrentJobs: 1, allowInProcess: true });
  assert.strictEqual(inProcess.executorKind, "in-process", "allowInProcess=true opts into same-process execution");
}

function checkProgressLifecycleEvents() {
  const objective = compileObjectiveSpec({ mode: "max-final-hp" }, null);
  const published = [];
  const accumulator = new SolverProgressAccumulator({
    jobId: "job-lifecycle",
    taskFingerprint: "fp-lifecycle",
    onPublish: (snapshot) => published.push(snapshot),
    throttleMs: 0,
    expansionEvery: 1000,
    objective,
  });
  accumulator.setStatus("running");
  accumulator.setPhase("preflight");
  // segment lifecycle events
  accumulator.handleDpEvent({ eventType: "segmentStarted", segmentId: "seg-2", segmentIndex: 1, segmentTotal: 4 });
  let snapshot = published[published.length - 1];
  assert.strictEqual(snapshot.phase, "segment-search");
  assert.strictEqual(snapshot.segment.index, 1);
  assert.strictEqual(snapshot.segment.total, 4);
  assert.strictEqual(snapshot.segment.attempt, 0);
  accumulator.handleDpEvent({ eventType: "attemptStarted", segmentId: "seg-2", segmentIndex: 1, segmentTotal: 4, attempt: 2 });
  snapshot = published[published.length - 1];
  assert.strictEqual(snapshot.segment.attempt, 2, "attempt index must advance within a segment");
  // realtime goal candidate improvement is published before search ends
  accumulator.handleDpEvent({
    eventType: "goalCandidateImproved",
    floorId: "MT3",
    hero: { hp: 150, atk: 5, def: 1 },
    decisionDepth: 6,
  });
  snapshot = published[published.length - 1];
  assert.strictEqual(snapshot.bestKnown.kind, "goal-candidate");
  assert.strictEqual(snapshot.bestKnown.goalReached, true);
  assert.strictEqual(snapshot.bestKnown.floorId, "MT3");
  assert.strictEqual(snapshot.bestKnown.routeLength, 6);
  accumulator.handleDpEvent({ eventType: "segmentCompleted", segmentId: "seg-2", segmentIndex: 1, segmentTotal: 4 });
  snapshot = published[published.length - 1];
  assert.strictEqual(snapshot.segment, null, "segment must clear after segmentCompleted");
  // action trimming is counted from actionSetGenerated.trimmedCount
  accumulator.handleDpEvent({ eventType: "actionSetGenerated", trimmedCount: 7 });
  accumulator.flush();
  snapshot = published[published.length - 1];
  assert.strictEqual(snapshot.search.actionTrimmed, 7, "action trimming must be reflected in progress");
  // progress-state bestKnown must NOT claim goalReached
  accumulator.setBestKnown({
    kind: "progress-state",
    goalReached: false,
    floorId: "MT2",
    objectiveValue: 90,
    routeLength: 3,
  });
  snapshot = published[published.length - 1];
  assert.strictEqual(snapshot.bestKnown.goalReached, false, "progress-state must not look like a reached goal");
}

async function checkFailedJobResultEnvelope() {
  // A job whose search is over-constrained fails with a unified result envelope.
  const spec = JSON.parse(fs.readFileSync(SMOKE_SPEC_FILE, "utf8"));
  const task = compileSolveTask({
    schema: SOLVE_TASK_SCHEMA,
    tower: { id: "onlyup-smoke", projectRoot: ONLY_UP_ROOT, region: { spec } },
    objective: { mode: "max-final-hp" },
    search: { algorithm: "segment-dp", maxExpansions: 1, maxRuntimeMs: 0, candidateLimit: 2 },
    verification: { strictReplay: false },
  });
  const manager = new SolverJobManager({ maxConcurrentJobs: 1, allowInProcess: true });
  const job = manager.submit(task);
  const settled = await waitForJob(manager, job.id, 120000);
  assert.ok(["failed", "completed"].includes(settled.state), `expected failed (or completed) but got ${settled.state}`);
  if (settled.state === "failed") {
    assert.strictEqual(settled.result.status, "failed", "failed jobs must carry the unified result envelope");
    assert.strictEqual(settled.result.found, false);
    assert.ok(settled.result.failure, "failed result must carry the failure classification");
    assert.strictEqual(settled.result.identity.taskFingerprint, task.taskFingerprint, "failed result identity must stay bound to the task");
    assert.ok(["EXPANSION_BUDGET_EXHAUSTED", "GOAL_NOT_REACHED"].includes(settled.result.failure.failureClass));
  }
}

async function checkRouteLengthObjectiveResult() {
  // route.length objective values must be consistent between the job result,
  // the route artifact metadata, and the strict replay recomputation.
  const spec = JSON.parse(fs.readFileSync(SMOKE_SPEC_FILE, "utf8"));
  const task = compileSolveTask({
    schema: SOLVE_TASK_SCHEMA,
    tower: { id: "onlyup-smoke", projectRoot: ONLY_UP_ROOT, region: { spec } },
    objective: { mode: "maximize-score", terms: [{ path: "route.length", weight: -1 }] },
    search: { algorithm: "segment-dp", maxExpansions: 1000, maxRuntimeMs: 10000, candidateLimit: 2 },
    verification: { strictReplay: false },
  });
  const manager = new SolverJobManager({ maxConcurrentJobs: 1, allowInProcess: true });
  const job = manager.submit(task);
  const settled = await waitForJob(manager, job.id, 120000);
  assert.strictEqual(settled.state, "completed", "route-length objective job must complete");
  const metadataValue = settled.result.route.record.metadata.finalObjectiveValue;
  assert.strictEqual(
    settled.result.objective.value,
    metadataValue,
    "job result objective value must equal the route artifact metadata value",
  );
  assert.ok(
    Number(settled.result.objective.value) < 0,
    "route-length minimization must yield a negative objective value",
  );
}

async function checkStrictReplayFailureMapping() {
  // A tampered route must map to STRICT_REPLAY_FAILED, not INTERNAL_ERROR.
  const task = compileSolveTask(baseTask({ verification: { strictReplay: false } }));
  const manager = new SolverJobManager({
    maxConcurrentJobs: 1,
    allowInProcess: true,
    createExecutor: () => ({
      execute: () => Promise.reject(Object.assign(new Error("tampered route"), { code: "STRICT_REPLAY_FAILED" })),
      cancel() {}, dispose() {},
    }),
  });
  const job = manager.submit(task);
  const settled = await waitForJob(manager, job.id, 5000);
  assert.strictEqual(settled.state, "failed");
  assert.strictEqual(settled.failure.failureClass, "STRICT_REPLAY_FAILED");
  assert.strictEqual(settled.result.status, "failed");
  assert.strictEqual(settled.result.found, false);
}

async function main() {
  checkStateMachine();
  checkProgressContract();
  checkFailureClassification();
  checkResultIdentityBinding();
  checkDefaultManagerUsesWorker();
  checkProgressLifecycleEvents();
  await checkMicroJobLifecycle();
  await checkCancelQueued();
  await checkWorkerCancel();
  await checkConcurrencyBarrier();
  await checkFailedJobResultEnvelope();
  await checkRouteLengthObjectiveResult();
  await checkStrictReplayFailureMapping();
  process.stdout.write(JSON.stringify({
    schema: "motapathfinder.pr-5.3c1-solver-job-contract.v1",
    status: "passed",
    controls: {
      stateMachineTransitions: true,
      pauseRejectedAsUnsupported: true,
      progressSequenceMonotonic: true,
      progressNoFakePercent: true,
      budgetExhaustedRetryable: true,
      actionTrimmedRetryable: true,
      cancelIsCancelledNotCompleted: true,
      workerCancelStopsInBoundedTime: true,
      cancelledSearchAbortedNotNaturalFinish: true,
      defaultManagerUsesWorker: true,
      maxConcurrentSlotsHonored: true,
      progressStateGoalReachedFalse: true,
      realtimeGoalCandidatePublished: true,
      segmentIndexTotalAttemptAdvance: true,
      actionTrimmingReflectedInProgress: true,
      terminalCompletedProgressPublished: true,
      failedResultEnvelopeUnified: true,
      routeLengthObjectiveValueConsistent: true,
      strictReplayFailedMappedCorrectly: true,
      resultIdentityBoundToTask: true,
      microJobQueuedToCompleted: true,
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
