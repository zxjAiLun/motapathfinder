"use strict";

const { SolverJob, SolverJobError, executeInProcessExecutor, finalizeJob } = require("./solver-job");
const { serializeError } = require("./solver-job-result");
const { compileSolveTask, SolveTaskError } = require("./solve-task");

let sequence = 0;

function defaultJobIdGenerator() {
  sequence += 1;
  return `job-${Date.now().toString(36)}-${sequence}`;
}

// Owns job lifecycle: queueing, worker execution, progress fan-out,
// cancellation, result capture, and optional file persistence.  It is not a
// second solver — it only drives the existing pipeline via an executor.
class SolverJobManager {
  constructor({
    maxConcurrentJobs = 1,
    createExecutor,
    jobIdGenerator,
    jobStore,
    context,
  } = {}) {
    this.maxConcurrentJobs = Math.max(1, Number(maxConcurrentJobs) || 1);
    this.createExecutor = typeof createExecutor === "function"
      ? createExecutor
      : null;
    this.jobIdGenerator = jobIdGenerator || defaultJobIdGenerator;
    this.jobStore = jobStore || null;
    this.context = context || null;
    this.jobs = new Map();
    this.queue = [];
    this.runningCount = 0;
  }

  submit(rawTask, options) {
    const task = compileSolveTask(rawTask, this.context);
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
      // Remove from queue and settle immediately.
      this.queue = this.queue.filter((entry) => entry.id !== job.id);
      job.failure = {
        failureClass: "CANCELLED",
        message: "The job was cancelled by request.",
        retryable: false,
        details: {},
      };
      job.transition("cancelled");
      if (this.jobStore) this.jobStore.saveStatus(job.id, job.toJSON()).catch(() => {});
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
    while (this.runningCount < this.maxConcurrentJobs && this.queue.length > 0) {
      const job = this.queue.shift();
      // Defer execution so progress subscribers (registered after submit)
      // attach before the synchronous search pipeline starts.
      setImmediate(() => this._start(job));
    }
  }

  _start(job) {
    if (job.state !== "queued") return; // cancelled while queued; deferred start must not run
    this.runningCount += 1;
    try {
      job.transition("running");
    } catch (error) {
      this.runningCount -= 1;
      this._settleFailure(job, error);
      return;
    }
    const onProgress = (snapshot) => {
      job.publishProgress(snapshot);
      if (this.jobStore) {
        this.jobStore.appendProgress(job.id, snapshot).catch(() => {});
      }
    };
    let executor;
    if (this.createExecutor) {
      executor = this.createExecutor({
        job,
        task: job.task,
        onProgress,
        context: this.context,
      });
    } else {
      executor = executeInProcessExecutor({
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
      (error) => {
        const terminal = job.state === "cancelled" || job.state === "failed" || job.state === "completed";
        if (job.cancelRequested || (error && (error.code === "CANCELLED" || error.message === "The job was cancelled by request."))) {
          job.failure = {
            failureClass: "CANCELLED",
            message: "The job was cancelled by request.",
            retryable: false,
            details: {},
          };
          if (!terminal) job.transition("cancelled");
        } else {
          job.failure = {
            failureClass: "INTERNAL_ERROR",
            message: error && error.message ? error.message : String(error),
            retryable: false,
            details: serializeError(error),
          };
          if (!terminal) job.transition("failed");
        }
        if (this.jobStore) {
          this.jobStore.saveError(job.id, job.failure).catch(() => {});
          this.jobStore.saveStatus(job.id, job.toJSON()).catch(() => {});
        }
        this._finishPump();
      },
    );
  }

  _settle(job, execution) {
    try {
      finalizeJob(job, execution);
    } catch (error) {
      job.failure = {
        failureClass: "INTERNAL_ERROR",
        message: error && error.message ? error.message : String(error),
        retryable: false,
        details: serializeError(error),
      };
      if (job.state !== "cancelled") job.transition("failed");
    }
    if (this.jobStore) {
      this.jobStore.saveResult(job.id, job.result || null).catch(() => {});
      this.jobStore.saveError(job.id, job.failure || null).catch(() => {});
      this.jobStore.saveStatus(job.id, job.toJSON()).catch(() => {});
    }
    this._finishPump();
  }

  _settleFailure(job, error) {
    job.failure = {
      failureClass: "INTERNAL_ERROR",
      message: error && error.message ? error.message : String(error),
      retryable: false,
      details: serializeError(error),
    };
    if (job.state !== "cancelled" && job.state !== "failed" && job.state !== "completed") {
      job.transition("failed");
    }
    if (this.jobStore) {
      this.jobStore.saveError(job.id, job.failure).catch(() => {});
      this.jobStore.saveStatus(job.id, job.toJSON()).catch(() => {});
    }
    this._finishPump();
  }

  _finishPump() {
    this.runningCount = Math.max(0, this.runningCount - 1);
    this._pump();
  }

  get running() {
    return this.runningCount;
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
      message: error.message,
      retryable: false,
      details: { code: error.code, path: error.path },
    };
  }
  return {
    failureClass: "INVALID_TASK",
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
