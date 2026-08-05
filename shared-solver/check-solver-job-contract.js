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
const { composeRouteRecords, ROUTE_SCHEMA } = require("./lib/route-store");
const { effectiveSegmentBudgets, manualSearchOverrides, withManualBudgetAuthority } = require("./lib/segment-dp");
const { compileExecutableSolveTask } = require("./lib/solve-task");
const { FileJobStore } = require("./lib/file-job-store");

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

function executableTask(overrides) {
  const spec = JSON.parse(fs.readFileSync(SMOKE_SPEC_FILE, "utf8"));
  return {
    schema: SOLVE_TASK_SCHEMA,
    tower: { id: "onlyup-smoke", projectRoot: ONLY_UP_ROOT, region: { spec } },
    objective: { mode: "max-final-hp" },
    search: {
      algorithm: "segment-dp",
      maxExpansions: 1000,
      maxRuntimeMs: 10000,
      candidateLimit: 2,
      goalSkylineLimit: 8,
    },
    verification: { strictReplay: false },
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
  // Per-attempt budget scope: an attempt starts with a fresh counter; the
  // ratio divides the ATTEMPT's own expansions by the per-attempt cap.
  accumulator.handleDpEvent({ eventType: "segmentStarted", segmentId: "seg-1", segmentIndex: 0, segmentTotal: 2 });
  accumulator.handleDpEvent({ eventType: "attemptStarted", segmentId: "seg-1", segmentIndex: 0, segmentTotal: 2, attempt: 1 });
  for (let index = 0; index < 5; index += 1) {
    accumulator.handleDpEvent({ eventType: "agendaPopped" });
    accumulator.handleDpEvent({ eventType: "candidateGenerated" });
    accumulator.handleDpEvent({ eventType: "goalAccepted" });
  }
  accumulator.flush();
  const firstAttemptSnapshot = published[published.length - 1];
  // A second attempt must reset the per-attempt counter; the ratio never
  // exceeds 1 while the total continues to accumulate.
  accumulator.handleDpEvent({ eventType: "attemptStarted", segmentId: "seg-1", segmentIndex: 0, segmentTotal: 2, attempt: 2 });
  for (let index = 0; index < 7; index += 1) {
    accumulator.handleDpEvent({ eventType: "agendaPopped" });
  }
  accumulator.flush();
  const secondAttemptSnapshot = published[published.length - 1];
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
  // Flushed right after attempt 1's 5 expansions: current==total==5.
  assert.strictEqual(firstAttemptSnapshot.search.expansions, 5);
  assert.strictEqual(firstAttemptSnapshot.budget.scope, "per-attempt");
  assert.strictEqual(firstAttemptSnapshot.budget.current.expansions, 5, "current tracks the active attempt's own expansions");
  assert.strictEqual(firstAttemptSnapshot.budget.current.expansionBudgetUsedRatio, 0.005);
  assert.strictEqual(firstAttemptSnapshot.budget.total.expansions, 5, "total accumulates across the job");
  assert.strictEqual(firstAttemptSnapshot.budget.current.expansionBudgetExhausted, false);
  // After a second attempt (7 more), the total continues but the current ratio
  // reflects only the active attempt, so it never exceeds 1.
  assert.strictEqual(secondAttemptSnapshot.budget.current.expansions, 7, "the second attempt resets its own counter");
  assert.strictEqual(secondAttemptSnapshot.budget.current.expansionBudgetUsedRatio, 0.007);
  assert.ok(secondAttemptSnapshot.budget.current.expansionBudgetUsedRatio <= 1, "per-attempt ratio must never exceed 1");
  assert.strictEqual(secondAttemptSnapshot.budget.total.expansions, 12, "total counters accumulate independently");
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
  let finalBestKnownKind = null;
  manager.subscribe(job.id, (snapshot) => {
    phases.push(snapshot.phase);
    if (snapshot.sequence <= lastSequence) mono = false;
    lastSequence = snapshot.sequence;
    if (snapshot.percent !== undefined) mono = false;
    if (snapshot.phase === "completed") terminalSeen = true;
    if (snapshot.bestKnown && (snapshot.phase === "strict-replay" || snapshot.phase === "finalizing" || snapshot.phase === "completed")) {
      finalBestKnownKind = snapshot.bestKnown.kind;
    }
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
  assert.notStrictEqual(finalBestKnownKind, "verified-route", "strictReplay=false must never publish a verified-route bestKnown");
  assert.strictEqual(settled.result.identity.taskFingerprint, task.taskFingerprint);
  const expectedValue = settled.result.route.record.metadata.finalObjectiveValue;
  assert.strictEqual(settled.result.objective.value, expectedValue, "objective value must agree with the ObjectiveSpec evaluation");
}

async function checkCancelQueued() {
  const manager = new SolverJobManager({ maxConcurrentJobs: 1, allowInProcess: true });
  const job = manager.submit(executableTask());
  const cancelled = manager.cancel(job.id);
  assert.strictEqual(cancelled, true);
  assert.strictEqual(manager.getJob(job.id).state, "cancelled");
}

async function checkCancelReservedDoesNotStarveQueue() {
  // Cancel a job that has a starting slot reserved but has not yet started;
  // the queued successor must eventually run.
  const manager = new SolverJobManager({ maxConcurrentJobs: 1, allowInProcess: true });
  const jobA = manager.submit(executableTask());
  const jobB = manager.submit(executableTask());
  // jobA's _startReserved is deferred via setImmediate; cancel before it fires.
  manager.cancel(jobA.id);
  assert.strictEqual(manager.getJob(jobA.id).state, "cancelled");
  const settled = await waitForJob(manager, jobB.id, 120000);
  assert.ok(["completed", "failed"].includes(settled.state), `job B must eventually start and settle, got ${settled.state}`);
  assert.notStrictEqual(settled.state, "queued");
}

async function checkExecutorSyncThrow() {
  // A synchronous executor creation/start throw must become an INTERNAL_ERROR
  // result envelope, not an uncaught exception.
  const manager = new SolverJobManager({
    maxConcurrentJobs: 1,
    allowInProcess: true,
    createExecutor: () => {
      throw new Error("fork resource failure");
    },
  });
  const job = manager.submit(executableTask());
  const settled = await waitForJob(manager, job.id, 10000);
  assert.strictEqual(settled.state, "failed");
  assert.strictEqual(settled.failure.failureClass, "INTERNAL_ERROR");
  assert.strictEqual(settled.result.status, "failed");
  assert.strictEqual(settled.result.identity.taskFingerprint, job.task.taskFingerprint);
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
  const jobA = manager.submit(executableTask());
  const jobB = manager.submit(executableTask());
  const jobC = manager.submit(executableTask());
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
  const published = [];
  const accumulator = new SolverProgressAccumulator({
    jobId: "job-lifecycle",
    taskFingerprint: "fp-lifecycle",
    onPublish: (snapshot) => published.push(snapshot),
    throttleMs: 0,
    expansionEvery: 1000,
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
  // Realtime goal-candidate improvement is accepted directly from the search's
  // projection; the accumulator must not re-derive improvement with >=.
  accumulator.handleDpEvent({
    eventType: "goalCandidateImproved",
    floorId: "MT3",
    hero: { hp: 150, atk: 5, def: 1 },
    decisionDepth: 6,
    objectiveFingerprint: "fp-min",
    objectiveValue: 8,
    objectiveValueExact: true,
  });
  snapshot = published[published.length - 1];
  assert.strictEqual(snapshot.bestKnown.kind, "goal-candidate");
  assert.strictEqual(snapshot.bestKnown.goalReached, true);
  assert.strictEqual(snapshot.bestKnown.floorId, "MT3");
  assert.strictEqual(snapshot.bestKnown.objectiveValue, 8);
  assert.strictEqual(snapshot.bestKnown.decisionDepth, 6, "realtime candidate must carry the decision depth");
  assert.strictEqual(snapshot.bestKnown.routeLength, null, "realtime candidate must not fake a route length from decision depth");
  assert.strictEqual(snapshot.bestKnown.routeLengthExact, false, "realtime candidate route length must be marked inexact");
  // A later min-direction improvement with a SMALLER value must be accepted
  // (the search comparator confirmed it), not rejected by a >= check.
  accumulator.handleDpEvent({
    eventType: "goalCandidateImproved",
    floorId: "MT4",
    hero: { hp: 140, atk: 6, def: 1 },
    decisionDepth: 7,
    objectiveFingerprint: "fp-min",
    objectiveValue: 5,
    objectiveValueExact: true,
  });
  snapshot = published[published.length - 1];
  assert.strictEqual(snapshot.bestKnown.objectiveValue, 5, "min-direction improvement with a smaller value must be accepted");
  // Lexicographic values are projected as-is by the search, never compared
  // with array coercion in the accumulator.
  accumulator.handleDpEvent({
    eventType: "goalCandidateImproved",
    floorId: "MT4",
    hero: { hp: 140, atk: 6, def: 1 },
    decisionDepth: 7,
    objectiveFingerprint: "fp-lex",
    objectiveValue: [100, 4],
    objectiveValueExact: true,
  });
  snapshot = published[published.length - 1];
  assert.deepStrictEqual(snapshot.bestKnown.objectiveValue, [100, 4], "lexicographic objective values must be projected verbatim");
  // route.length objectives are marked inexact during enqueue (route not yet
  // rebuilt) and only the post-search publish carries the accurate value.
  accumulator.handleDpEvent({
    eventType: "goalCandidateImproved",
    floorId: "MT5",
    hero: { hp: 130, atk: 7, def: 1 },
    decisionDepth: 9,
    objectiveFingerprint: "fp-route",
    objectiveValue: null,
    objectiveValueExact: false,
  });
  snapshot = published[published.length - 1];
  assert.strictEqual(snapshot.bestKnown.objectiveValueExact, false, "route.length candidates must be marked inexact at enqueue time");
  assert.strictEqual(snapshot.bestKnown.objectiveValue, null, "inexact candidates must not fake an objective value");
  accumulator.setBestKnown({
    kind: "goal-candidate",
    goalReached: true,
    verified: false,
    floorId: "MT5",
    decisionDepth: 9,
    routeLength: 14,
    routeLengthExact: true,
    objectiveValue: -14,
    objectiveValueExact: true,
  });
  snapshot = published[published.length - 1];
  assert.strictEqual(snapshot.bestKnown.objectiveValue, -14, "the post-rebuild accurate goal candidate must replace the inexact one");
  assert.strictEqual(snapshot.bestKnown.routeLength, 14, "the post-rebuild candidate must carry the real route length");
  assert.strictEqual(snapshot.bestKnown.routeLengthExact, true, "the post-rebuild route length must be marked exact");
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
  const manager = new SolverJobManager({
    maxConcurrentJobs: 1,
    allowInProcess: true,
    createExecutor: () => ({
      execute: () => Promise.reject(Object.assign(new Error("tampered route"), { code: "STRICT_REPLAY_FAILED" })),
      cancel() {}, dispose() {},
    }),
  });
  const job = manager.submit(executableTask());
  const settled = await waitForJob(manager, job.id, 5000);
  assert.strictEqual(settled.state, "failed");
  assert.strictEqual(settled.failure.failureClass, "STRICT_REPLAY_FAILED");
  assert.strictEqual(settled.result.status, "failed");
  assert.strictEqual(settled.result.found, false);
}

function checkComposedRouteKeepsFullRouteLength() {
  const objective = compileObjectiveSpec({
    mode: "maximize-score",
    terms: [{ path: "route.length", weight: -1 }],
  }, null);
  const fingerprint = objective.fingerprint;
  const spec = objective.toJSON();
  const makeSnapshot = (floorId, hp) => ({
    floorId,
    hero: { hp, atk: 10, def: 10, mdef: 0, lv: 1, exp: 0, money: 0, loc: { x: 1, y: 1, direction: "down" }, equipment: [] },
    inventory: {},
    flags: {},
    floors: {},
  });
  const makeDecision = (index, pre, post, summary) => ({
    index,
    summary,
    preExactStateKey: pre,
    postExactStateKey: post,
    fingerprint: `fp:${summary}`,
  });
  const prefix = {
    schema: ROUTE_SCHEMA,
    source: { commit: "x", solver: "solve-task", rank: "chaos" },
    goal: { type: "region", floorId: "MT2" },
    metadata: { objectiveSpec: spec, objectiveFingerprint: fingerprint },
    start: { snapshot: makeSnapshot("MT1", 100), exactStateKey: "k0" },
    final: { snapshot: makeSnapshot("MT2", 80), exactStateKey: "k1" },
    decisions: [makeDecision(1, "k0", "k1", "a")],
    rawRoute: ["a1", "a2"],
  };
  const suffix = {
    schema: ROUTE_SCHEMA,
    source: { commit: "x", solver: "solve-task", rank: "chaos" },
    goal: { type: "region", floorId: "MT3" },
    metadata: {
      objectiveSpec: spec,
      objectiveFingerprint: fingerprint,
      finalObjectiveValue: -3,
      objectiveComparisonTrace: [],
    },
    start: { snapshot: makeSnapshot("MT2", 80), exactStateKey: "k1" },
    final: { snapshot: makeSnapshot("MT3", 60), exactStateKey: "k2" },
    decisions: [makeDecision(1, "k1", "k2", "b")],
    rawRoute: ["b1", "b2", "b3"],
  };
  const composed = composeRouteRecords(prefix, suffix);
  assert.strictEqual(composed.decisions.length, 2, "composed decision count is the sum of decision steps");
  assert.strictEqual(composed.rawRoute.length, 5);
  assert.strictEqual(composed.stats.routeLength, 5, "composed routeLength must be the full rawRoute length (auto-steps included)");
  assert.strictEqual(composed.metadata.finalObjectiveValue, -5, "composed route-length objective must reflect the full route length, not the decision count");
}

function checkExecutablePreflightRejectsMalformedProject() {
  // An existing-but-malformed projectRoot with a supplied fingerprint must be
  // rejected: the supplied fingerprint cannot substitute for the real project.
  const malformedRoot = path.join(__dirname, "routes", "generated", "c2-malformed-project");
  fs.mkdirSync(malformedRoot, { recursive: true });
  fs.writeFileSync(path.join(malformedRoot, "not-a-project.txt"), "placeholder", "utf8");
  const rawTask = {
    schema: SOLVE_TASK_SCHEMA,
    tower: {
      id: "malformed",
      projectRoot: malformedRoot,
      projectFingerprint: "deadbeefdeadbeef",
      region: { spec: baseRegionSpec() },
    },
    search: { maxExpansions: 100 },
    verification: { strictReplay: false },
  };
  assert.throws(
    () => compileExecutableSolveTask(rawTask),
    (error) => error && error.code === "INVALID_TASK",
    "a malformed existing projectRoot must fail executable preflight even with a supplied fingerprint",
  );
}


async function checkManualBudgetOverridesSegmentBudget() {
  // The task search budget is the execution authority.  A segment-local dp
  // budget must be overridden by the manual budget, and maxRuntimeMs=0
  // (unlimited) must never produce RUNTIME_BUDGET_EXHAUSTED.
  const spec = JSON.parse(fs.readFileSync(SMOKE_SPEC_FILE, "utf8"));
  spec.dp = { maxExpansions: 100000, maxRuntimeMs: 1 };
  const manager = new SolverJobManager({ maxConcurrentJobs: 1, allowInProcess: true });
  const job = manager.submit({
    schema: SOLVE_TASK_SCHEMA,
    tower: { id: "onlyup-smoke", projectRoot: ONLY_UP_ROOT, region: { spec } },
    objective: { mode: "max-final-hp" },
    search: { algorithm: "segment-dp", maxExpansions: 1000, maxRuntimeMs: 0, candidateLimit: 2 },
    verification: { strictReplay: false },
  });
  const settled = await waitForJob(manager, job.id, 120000);
  assert.strictEqual(settled.state, "completed", "maxRuntimeMs=0 must override the segment-local 1ms budget");
  assert.strictEqual(settled.result.found, true);
  assert.notStrictEqual(
    settled.result.failure && settled.result.failure.failureClass,
    "RUNTIME_BUDGET_EXHAUSTED",
    "maxRuntimeMs=0 must never be classified as runtime budget exhausted",
  );
}

function checkEffectiveSegmentBudgetsReflectManual() {
  const milestoneSpec = {
    milestones: [
      { id: "seg-1", dp: { maxExpansions: 300, maxRuntimeMs: 15000 } },
      { id: "seg-2", dp: { maxExpansions: 400, maxRuntimeMs: 20000 } },
    ],
  };
  // The budget applies per candidate attempt, so effective segments must state
  // the per-attempt scope explicitly and the start-candidate cap (attempts).
  const overridden = effectiveSegmentBudgets(milestoneSpec, { maxExpansions: 50000, maxRuntimeMs: 0, candidateLimit: 8 });
  assert.strictEqual(overridden.length, 2);
  assert.strictEqual(overridden[0].budgetScope, "per-attempt", "effective budgets must declare per-attempt scope");
  assert.strictEqual(overridden[0].perAttempt.maxExpansions, 50000, "manual maxExpansions must override segment budgets");
  assert.strictEqual(overridden[0].perAttempt.maxRuntimeMs, 0, "manual maxRuntimeMs=0 must override segment budgets");
  assert.strictEqual(overridden[1].perAttempt.maxExpansions, 50000);
  assert.ok(overridden[1].maxStartAttempts >= 1, "effective budgets must report the start-candidate (attempt) cap");
  const defaults = effectiveSegmentBudgets(milestoneSpec, {});
  assert.strictEqual(defaults[0].perAttempt.maxExpansions, 300, "without manual config the segment budget stays");
  assert.strictEqual(defaults[0].perAttempt.maxRuntimeMs, 15000);
}

function checkProgressBudgetSourceAndCompatAliases() {
  // d1 established budget.source and the flat per-attempt aliases; d2 moved the
  // fields under current/total.  The schema must keep source and the aliases so
  // pre-d2 consumers do not silently lose the budget contract.
  const published = [];
  const accumulator = new SolverProgressAccumulator({
    jobId: "job-budget-src",
    taskFingerprint: "fp-budget-src",
    onPublish: (snapshot) => published.push(snapshot),
    throttleMs: 0,
    expansionEvery: 1,
    maxExpansions: 1000,
    maxRuntimeMs: 100,
    budgetSource: "launcher-override",
  });
  accumulator.setStatus("running");
  accumulator.setPhase("segment-search");
  accumulator.handleDpEvent({ eventType: "segmentStarted", segmentId: "s", segmentIndex: 0, segmentTotal: 1 });
  accumulator.handleDpEvent({ eventType: "attemptStarted", segmentId: "s", segmentIndex: 0, segmentTotal: 1, attempt: 1 });
  accumulator.handleDpEvent({ eventType: "agendaPopped" });
  accumulator.flush();
  const snapshot = published[published.length - 1];
  assert.strictEqual(snapshot.budget.source, "launcher-override", "budget.source must be preserved");
  assert.strictEqual(snapshot.budget.scope, "per-attempt");
  assert.strictEqual(snapshot.budget.current.expansions, 1);
  assert.strictEqual(snapshot.budget.total.expansions, 1);
  assert.strictEqual(snapshot.budget.expansions, 1, "deprecated flat alias must mirror current");
  assert.strictEqual(snapshot.budget.expansionBudgetUsedRatio, 0.001, "deprecated flat alias must mirror current ratio");
  // Runtime ratio is clamped to <=1.
  assert.ok(snapshot.budget.current.runtimeBudgetUsedRatio == null || snapshot.budget.current.runtimeBudgetUsedRatio <= 1);
}
function checkManualBudgetAuthorityAppliesToRepairOverrides() {
  // The task search budget is the authority for every segment DP execution,
  // including configured-repair and backtrack retry paths: their own
  // (repair/backtrack) overrides are merged first, then the manual overrides
  // are applied last, so maxRuntimeMs=0 stays unlimited on repairs.
  const config = {
    maxExpansions: 50000,
    maxRuntimeMs: 0,
    maxActionsPerState: 256,
    goalSkylineLimit: 8,
    dpSkylineMax: 1,
    stopOnFirstGoal: false,
  };
  const configuredRepair = withManualBudgetAuthority(config, {
    dpOverrides: {
      stopOnFirstGoal: false,
      maxExpansions: 300,
      maxRuntimeMs: 1,
      goalSkylineLimit: 4,
    },
  });
  assert.strictEqual(configuredRepair.dpOverrides.maxRuntimeMs, 0, "manual maxRuntimeMs=0 must override the configured-repair runtime");
  assert.strictEqual(configuredRepair.dpOverrides.maxExpansions, 50000, "manual maxExpansions must override the configured-repair expansions");
  assert.strictEqual(configuredRepair.dpOverrides.goalSkylineLimit, 8, "manual goalSkylineLimit must override the repair value");
  // Backtrack-style overrides (local budget + backtrack doubling) also get the
  // manual authority applied last.
  const backtrack = withManualBudgetAuthority(config, {
    candidateLimit: 4,
    dpOverrides: {
      stopOnFirstGoal: false,
      maxExpansions: 2400,
      maxRuntimeMs: 10000,
      goalSkylineLimit: 8,
    },
  });
  assert.strictEqual(backtrack.dpOverrides.maxRuntimeMs, 0, "manual maxRuntimeMs=0 must override backtrack runtime");
  assert.strictEqual(backtrack.dpOverrides.maxExpansions, 50000, "manual maxExpansions must override backtrack expansions");
  // A caller without a manual budget keeps the repair/backtrack values.
  const noManual = withManualBudgetAuthority({}, {
    dpOverrides: { maxExpansions: 300, maxRuntimeMs: 1 },
  });
  assert.strictEqual(noManual.dpOverrides.maxRuntimeMs, 1, "without a manual budget the repair budget stays");
  assert.strictEqual(noManual.dpOverrides.maxExpansions, 300);
}

async function checkConfiguredRepairUnlimitedRuntime() {
  // End-to-end: a segment that requires a configured-repair re-run must NOT be
  // classified RUNTIME_BUDGET_EXHAUSTED when the task sets maxRuntimeMs=0.
  const base = JSON.parse(fs.readFileSync(SMOKE_SPEC_FILE, "utf8"));
  const spec = {
    ...base,
    id: "onlyup-repair-unlimited",
    segments: [
      {
        id: "seg-a",
        label: "seg-a",
        goal: { type: "heroAtLeast", floorId: "MT1", minHero: { exp: 1 } },
        dp: { maxExpansions: 1000, maxRuntimeMs: 100 },
      },
      {
        id: "seg-b",
        label: "seg-b",
        repairStartFrom: "seg-a",
        goal: { type: "heroAtLeast", floorId: "MT1", minHero: { exp: 999 } },
        dp: {
          maxExpansions: 1000,
          maxRuntimeMs: 50,
          repairMaxExpansions: 300,
          repairMaxRuntimeMs: 1,
        },
      },
    ],
  };
  const manager = new SolverJobManager({ maxConcurrentJobs: 1, allowInProcess: true });
  const job = manager.submit({
    schema: SOLVE_TASK_SCHEMA,
    tower: { id: "onlyup-smoke", projectRoot: ONLY_UP_ROOT, region: { spec } },
    objective: { mode: "max-final-hp" },
    search: { algorithm: "segment-dp", maxExpansions: 2000, maxRuntimeMs: 0, candidateLimit: 2 },
    verification: { strictReplay: false },
  });
  const settled = await waitForJob(manager, job.id, 120000);
  assert.notStrictEqual(
    settled.result.failure && settled.result.failure.failureClass,
    "RUNTIME_BUDGET_EXHAUSTED",
    "repair execution with maxRuntimeMs=0 must never be runtime budget exhausted",
  );
}

async function checkTerminalProgressPersisted() {
  const storeRoot = path.join(__dirname, "routes", "generated", "c2-job-store");
  const jobStore = new FileJobStore({ root: storeRoot });
  const spec = JSON.parse(fs.readFileSync(SMOKE_SPEC_FILE, "utf8"));
  const task = compileSolveTask({
    schema: SOLVE_TASK_SCHEMA,
    tower: { id: "onlyup-smoke", projectRoot: ONLY_UP_ROOT, region: { spec } },
    objective: { mode: "max-final-hp" },
    search: { algorithm: "segment-dp", maxExpansions: 1000, maxRuntimeMs: 10000, candidateLimit: 2 },
    verification: { strictReplay: false },
  });
  const manager = new SolverJobManager({ maxConcurrentJobs: 1, allowInProcess: true, jobStore });
  const job = manager.submit(task);
  const settled = await waitForJob(manager, job.id, 120000);
  assert.ok(["completed", "failed", "cancelled"].includes(settled.state));
  const lines = jobStore.readProgressLines(job.id);
  assert.ok(lines.length >= 2, "progress.ndjson must contain progress events");
  const last = lines[lines.length - 1];
  assert.strictEqual(last.phase, settled.state, "the last persisted progress line must be the terminal event");
  assert.strictEqual(last.status, settled.state);
  assert.strictEqual(last.jobId, job.id);
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
  await checkCancelReservedDoesNotStarveQueue();
  await checkExecutorSyncThrow();
  await checkWorkerCancel();
  await checkConcurrencyBarrier();
  await checkFailedJobResultEnvelope();
  await checkRouteLengthObjectiveResult();
  await checkStrictReplayFailureMapping();
  checkComposedRouteKeepsFullRouteLength();
  checkExecutablePreflightRejectsMalformedProject();
  await checkTerminalProgressPersisted();
  checkEffectiveSegmentBudgetsReflectManual();
  checkProgressBudgetSourceAndCompatAliases();
  await checkManualBudgetOverridesSegmentBudget();
  checkManualBudgetAuthorityAppliesToRepairOverrides();
  await checkConfiguredRepairUnlimitedRuntime();
  process.stdout.write(JSON.stringify({
    schema: "motapathfinder.pr-5.3d1-solver-job-contract.v1",
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
      cancelReservedQueuedDoesNotStarveQueue: true,
      executorSyncThrowBecomesInternalError: true,
      progressStateGoalReachedFalse: true,
      realtimeGoalCandidatePublished: true,
      minDirectionImprovementAccepted: true,
      lexicographicValueProjectedVerbatim: true,
      routeLengthInexactThenAccurate: true,
      segmentIndexTotalAttemptAdvance: true,
      actionTrimmingReflectedInProgress: true,
      terminalCompletedProgressPublished: true,
      strictReplayFalseNeverVerifiedRoute: true,
      failedResultEnvelopeUnified: true,
      strictReplayFailedMappedCorrectly: true,
      routeLengthObjectiveValueConsistent: true,
      composedRouteKeepsFullRouteLength: true,
      realtimeCandidateRouteLengthInexact: true,
      postRebuildRouteLengthExact: true,
      malformedProjectRejectedByExecutablePreflight: true,
      terminalProgressPersistedToNdjson: true,
      effectiveSegmentBudgetsReflectManual: true,
      manualBudgetOverridesSegmentBudget: true,
      maxRuntimeMsZeroNeverRuntimeExhausted: true,
      repairBacktrackBudgetAuthority: true,
      effectiveSegmentsPerAttemptScope: true,
      progressBudgetSourcePreserved: true,
      progressBudgetCompatAliases: true,
      configuredRepairUnlimitedRuntime: true,
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
