"use strict";

const { SolverJob, SolverJobError, executeInProcessExecutor, finalizeJob } = require("./solver-job");
const { serializeError } = require("./solver-job-result");
const { compileExecutableSolveTask, SolveTaskError } = require("./solve-task");
const { compileExecutableSolveTaskV2 } = require("./solve-task-v2");
const { createWorkerExecutor } = require("./solver-worker-runner");

let sequence = 0;

function defaultJobIdGenerator() {
  sequence += 1;
  return `job-${Date.now().toString(36)}-${sequence}`;
}

// Owns job lifecycle: queueing, worker execution, progress fan-out,
// cancellation, result capture, and optional file persistence.  It is not a
// second solver — it only drives the existing pipeline via an executor.
//
// By default jobs run in a dedicated child-process worker so the calling
// process (GUI/API/CLI main thread) is never blocked by CPU-bound search.
// `allowInProcess: true` opts into same-process execution for tests and
// embedded embedding only.
class SolverJobManager {
  constructor({
    maxConcurrentJobs = 1,
    createExecutor,
    allowInProcess = false,
    jobIdGenerator,
    jobStore,
    context,
  } = {}) {
    this.maxConcurrentJobs = Math.max(1, Number(maxConcurrentJobs) || 1);
    this.allowInProcess = Boolean(allowInProcess);
    this.createExecutor = typeof createExecutor === "function"
      ? createExecutor
      : null;
    this.executorKind = this.createExecutor
      ? "custom"
      : this.allowInProcess
        ? "in-process"
        : "worker";
    this.jobIdGenerator = jobIdGenerator || defaultJobIdGenerator;
    this.jobStore = jobStore || null;
    this.context = context || null;
    this.jobs = new Map();
    this.queue = [];
    this.runningCount = 0;
    this.startingCount = 0;
  }

  submit(rawTask, options) {
    // Executable-job preflight: projectRoot must exist and be loadable with a
    // real fingerprint before a worker is spawned.  v2 tasks compile through
    // the ordered-region contract.
    const isV2 = rawTask && rawTask.schema === "motapathfinder.solve-task.v2";
    const task = isV2
      ? compileExecutableSolveTaskV2(rawTask, this.context)
      : compileExecutableSolveTask(rawTask, this.context);
    const job = new SolverJob({
      id: this.jobIdGenerator(),
      task,
    });
    this.jobs.set(job.id, job);
    this.queue.push(job);
    if (this.jobStore) {
      this.jobStore.saveTask(job.id, task.toJSON ? task.toJSON() : task.normalizedTask).catch(() => {});
      this.jobStore.saveStatus(job.id, job.toJSON()).catch(() => {});
    }
    this._pump();
    return job;
  }

  getJob(id) {
    return this.jobs.get(id) || null;
  }

  cancel(id) {
    const job = this.jobs.get(id);
    if (!job) return false;
    if (job.state === "completed" || job.state === "failed" || job.state === "cancelled") {
      throw new SolverJobError(
        "JOB_INVALID_STATE_TRANSITION",
        `cannot cancel a job in state ${job.state}`,
        { jobId: id, from: job.state, to: "cancelled" },
      );
    }
    job.cancelRequested = true;
    if (job.state === "queued") {
      // Remove from queue and settle immediately.  A deferred _startReserved
      // will observe state !== "queued" and free its slot.
      this.queue = this.queue.filter((entry) => entry.id !== job.id);
      this._settleCancel(job);
      return true;
    }
    if (job.executor && typeof job.executor.cancel === "function") {
      job.executor.cancel();
    }
    return true;
  }

  subscribe(id, callback) {
    const job = this.jobs.get(id);
    if (!job) return () => {};
    return job.subscribe(callback);
  }

  pause(id) {
    const job = this.jobs.get(id);
    if (!job) return false;
    job.requestPause();
    return true;
  }

  _pump() {
    // Reserve starting slots synchronously so maxConcurrentJobs is honored even
    // when many jobs are submitted in the same tick: the reservation is taken
    // before any setImmediate(_startReserved) executes.
    while (
      this.runningCount + this.startingCount < this.maxConcurrentJobs &&
      this.queue.length > 0
    ) {
      const job = this.queue.shift();
      this.startingCount += 1;
      setImmediate(() => this._startReserved(job));
    }
  }

  _startReserved(job) {
    this.startingCount = Math.max(0, this.startingCount - 1);
    if (job.state !== "queued") {
      // The reserved job was cancelled while queued; release the reservation
      // and advance the queue so later jobs are not starved.
      this._pump();
      return;
    }
    this._start(job);
  }

  _start(job) {
    if (job.state !== "queued") return; // cancelled while queued; deferred start must not run
    this.runningCount += 1;
    try {
      job.transition("running");
    } catch (error) {
      this._settleError(job, error);
      return;
    }
    const onProgress = (snapshot) => {
      job.publishProgress(snapshot);
      if (this.jobStore) {
        this.jobStore.appendProgress(job.id, snapshot).catch(() => {});
      }
    };
    let executor;
    try {
      if (this.createExecutor) {
        executor = this.createExecutor({
          job,
          task: job.task,
          onProgress,
          context: this.context,
        });
      } else if (this.allowInProcess) {
        executor = executeInProcessExecutor({
          job,
          task: job.task,
          onProgress,
          context: this.context,
        });
      } else {
        executor = createWorkerExecutor({
          job,
          task: job.task,
          onProgress,
          context: this.context,
        });
      }
      job.executor = executor;
      executor.execute().then(
        (execution) => {
          this._settle(job, execution);
        },
        (error) => this._settleError(job, error),
      );
    } catch (error) {
      // Synchronous executor creation/start failures must become an
      // INTERNAL_ERROR result envelope, not an uncaught setImmediate throw.
      this._settleError(job, error);
    }
  }

  _settle(job, execution) {
    try {
      finalizeJob(job, execution);
    } catch (error) {
      this._settleError(job, error);
      return;
    }
    this._publishTerminalProgress(job);
    if (this.jobStore) {
      this.jobStore.saveResult(job.id, job.result || null).catch(() => {});
      this.jobStore.saveError(job.id, job.failure || null).catch(() => {});
      this.jobStore.saveStatus(job.id, job.toJSON()).catch(() => {});
    }
    this._finishPump();
  }

  _settleCancel(job) {
    const failure = {
      failureClass: "CANCELLED",
      message: "The job was cancelled by request.",
      retryable: false,
      details: {},
    };
    job.failure = failure;
    job.result = {
      schema: "motapathfinder.solver-job-result.v1",
      jobId: job.id,
      taskFingerprint: job.task && job.task.taskFingerprint || null,
      status: "cancelled",
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: new Date().toISOString(),
      found: false,
      failure,
      proof: null,
      objective: null,
      route: null,
      identity: {
        taskFingerprint: job.task && job.task.taskFingerprint || null,
        towerFingerprint: job.task && job.task.towerFingerprint || null,
        solverModelFingerprint: job.task && job.task.solverModelFingerprint || null,
        objectiveFingerprint: job.task && job.task.objectiveFingerprint || null,
        routeFingerprint: null,
      },
      diagnostics: null,
    };
    job.transition("cancelled");
    this._publishTerminalProgress(job);
    if (this.jobStore) {
      this.jobStore.saveResult(job.id, job.result).catch(() => {});
      this.jobStore.saveError(job.id, job.failure).catch(() => {});
      this.jobStore.saveStatus(job.id, job.toJSON()).catch(() => {});
    }
  }

  _settleError(job, error) {
    const terminal = job.state === "cancelled" || job.state === "failed" || job.state === "completed";
    let failure;
    if (job.cancelRequested || (error && (error.code === "CANCELLED" || error.message === "The job was cancelled by request."))) {
      failure = {
        failureClass: "CANCELLED",
        message: "The job was cancelled by request.",
        retryable: false,
        details: {},
      };
    } else if (error && error.code === "STRICT_REPLAY_FAILED") {
      failure = {
        failureClass: "STRICT_REPLAY_FAILED",
        message: error.message || "Strict runtime replay failed.",
        retryable: false,
        details: serializeError(error),
      };
    } else if (error && error.code === "INVALID_PROVENANCE") {
      // Fail-closed: a composite route whose winner ancestry cannot be uniquely
      // resolved must never be emitted as a verified artifact.
      failure = {
        failureClass: "INVALID_PROVENANCE",
        message: error.message || "Winner candidate provenance could not be resolved.",
        retryable: false,
        details: serializeError(error),
      };
    } else {
      failure = {
        failureClass: "INTERNAL_ERROR",
        message: error && error.message ? error.message : String(error),
        retryable: false,
        details: serializeError(error),
      };
    }
    job.failure = failure;
    job.result = {
      schema: "motapathfinder.solver-job-result.v1",
      jobId: job.id,
      taskFingerprint: job.task && job.task.taskFingerprint || null,
      status: failure.failureClass === "CANCELLED" ? "cancelled" : "failed",
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: new Date().toISOString(),
      found: false,
      failure,
      proof: null,
      objective: null,
      route: null,
      identity: {
        taskFingerprint: job.task && job.task.taskFingerprint || null,
        towerFingerprint: job.task && job.task.towerFingerprint || null,
        solverModelFingerprint: job.task && job.task.solverModelFingerprint || null,
        objectiveFingerprint: job.task && job.task.objectiveFingerprint || null,
        routeFingerprint: null,
      },
      diagnostics: null,
    };
    if (!terminal) {
      job.transition(failure.failureClass === "CANCELLED" ? "cancelled" : "failed");
    }
    this._publishTerminalProgress(job);
    if (this.jobStore) {
      this.jobStore.saveResult(job.id, job.result).catch(() => {});
      this.jobStore.saveError(job.id, job.failure).catch(() => {});
      this.jobStore.saveStatus(job.id, job.toJSON()).catch(() => {});
    }
    this._finishPump();
  }

  _publishTerminalProgress(job) {
    if (job.state === "queued" || job.state === "running") return;
    const previous = job.lastProgress || {};
    const snapshot = {
      schema: "motapathfinder.solver-progress.v1",
      jobId: job.id,
      taskFingerprint: job.task && job.task.taskFingerprint || null,
      sequence: (Number(previous.sequence) || 0) + 1,
      timestamp: new Date().toISOString(),
      status: job.state,
      phase: job.state,
      segment: null,
      region: previous.region || null,
      search: previous.search || { expansions: 0, generated: 0, accepted: 0, goalCandidates: 0, actionTrimmed: 0 },
      budget: previous.budget || null,
      bestKnown: previous.bestKnown || null,
      proof: previous.proof || null,
    };
    job.publishProgress(snapshot);
    // Terminal progress must also be persisted so progress.ndjson ends with a
    // completed/failed/cancelled event, not a stale finalizing line.
    if (this.jobStore) {
      this.jobStore.appendProgress(job.id, snapshot).catch(() => {});
    }
  }

  _finishPump() {
    this.runningCount = Math.max(0, this.runningCount - 1);
    this._pump();
  }

  get running() {
    return this.runningCount + this.startingCount;
  }

  get queued() {
    return this.queue.length;
  }

  snapshot() {
    return Array.from(this.jobs.values()).map((job) => job.toJSON());
  }
}

function createSolveTaskErrorResult(error) {
  if (error instanceof SolveTaskError) {
    return {
      failureClass: "INVALID_TASK",
      code: error.code || "INVALID_TASK",
      path: error.path || null,
      message: error.message,
      retryable: false,
      details: { code: error.code, path: error.path },
    };
  }
  return {
    failureClass: "INVALID_TASK",
    code: error && error.code || "INVALID_TASK",
    path: error && error.path || null,
    message: error && error.message ? error.message : String(error),
    retryable: false,
    details: serializeError(error),
  };
}

module.exports = {
  SolverJobManager,
  createSolveTaskErrorResult,
  defaultJobIdGenerator,
};
