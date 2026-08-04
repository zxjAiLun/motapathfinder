"use strict";

// Child-process job worker.  Receives a serialized SolveTask, executes the
// existing solver pipeline, and reports progress/result/failure back to the
// parent.  The worker never reimplements search; it drives runMilestoneGraph.
//
// Cancellation uses a synchronous cancel-token FILE: the parent atomically
// creates the token, and the worker's shouldStop() checks fs.existsSync() so
// cancellation is honored even while the event loop is blocked by the CPU-bound
// search.  IPC "cancel" is still accepted for pre-start cancellation.
const fs = require("node:fs");
const { compileSolveTask } = require("./lib/solve-task");
const { executeSolveJob } = require("./lib/solver-job");
const { serializeError } = require("./lib/solver-job-result");

let stopRequested = false;
let cancelTokenPath = null;

function isStopRequested() {
  if (stopRequested) return true;
  if (cancelTokenPath && fs.existsSync(cancelTokenPath)) {
    stopRequested = true;
    return true;
  }
  return false;
}

function cleanupToken() {
  if (cancelTokenPath) {
    try {
      fs.unlinkSync(cancelTokenPath);
    } catch (error) {
      // best-effort token cleanup
    }
  }
}

process.on("message", async (message) => {
  if (!message || typeof message !== "object") return;
  if (message.type === "cancel") {
    stopRequested = true;
    return;
  }
  if (message.type !== "start") return;
  const { jobId, task, cancelTokenPath: tokenPath } = message;
  cancelTokenPath = tokenPath || null;
  try {
    let compiledTask = task;
    if (!task || !task.compiled || !task.objective) {
      compiledTask = compileSolveTask(task, {
        projectRoot: task && task.tower && task.tower.projectRoot || null,
      });
    }
    const execution = await executeSolveJob(compiledTask, {
      jobId,
      onProgress: (snapshot) => {
        if (!isStopRequested()) {
          process.send({ type: "progress", jobId, payload: snapshot });
        }
      },
      shouldStop: () => isStopRequested(),
    });
    if (isStopRequested() || execution.cancelled) {
      process.send({ type: "failed", jobId, error: {
        name: "Error",
        code: "CANCELLED",
        message: "The job was cancelled by request.",
        stack: null,
      } });
      return;
    }
    process.send({ type: "completed", jobId, result: execution });
  } catch (error) {
    process.send({ type: "failed", jobId, error: serializeError(error) });
  } finally {
    cleanupToken();
  }
});

process.on("SIGTERM", () => {
  stopRequested = true;
});
