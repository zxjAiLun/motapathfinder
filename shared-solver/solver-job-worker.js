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
const { executeSolveJob, executeSolveJobV2 } = require("./lib/solver-job");
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

// Sends a terminal message to the parent and then actively closes the IPC
// channel and exits.  The worker must NOT rely on the parent's SIGTERM to tear
// it down: the IPC channel keeps the child's event loop alive, so without an
// explicit disconnect+exit the child process leaks and the parent CLI never
// terminates after the job completes.
function sendTerminalAndExit(message, exitCode) {
  cleanupToken();
  if (!process.connected) {
    process.exit(exitCode);
    return;
  }
  process.send(message, () => {
    try {
      process.disconnect();
    } finally {
      process.exit(exitCode);
    }
  });
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
      compiledTask = task && task.schema === "motapathfinder.solve-task.v2"
        ? require("./lib/solve-task-v2").compileSolveTaskV2(task, {
          projectRoot: task && task.tower && task.tower.projectRoot || null,
        })
        : compileSolveTask(task, {
          projectRoot: task && task.tower && task.tower.projectRoot || null,
        });
    }
    const runner = compiledTask && compiledTask.schema === "motapathfinder.solve-task.v2"
      ? executeSolveJobV2
      : executeSolveJob;
    const execution = await runner(compiledTask, {
      jobId,
      onProgress: (snapshot) => {
        if (!isStopRequested()) {
          process.send({ type: "progress", jobId, payload: snapshot });
        }
      },
      shouldStop: () => isStopRequested(),
    });
    if (isStopRequested() || execution.cancelled) {
      sendTerminalAndExit({ type: "failed", jobId, error: {
        name: "Error",
        code: "CANCELLED",
        message: "The job was cancelled by request.",
        stack: null,
      } }, 1);
      return;
    }
    sendTerminalAndExit({ type: "completed", jobId, result: execution }, 0);
  } catch (error) {
    sendTerminalAndExit({ type: "failed", jobId, error: serializeError(error) }, 1);
  }
});

process.on("SIGTERM", () => {
  // Never leave a SIGTERM unhandled: a bare "stopRequested = true" would keep
  // the IPC channel alive and leak the child process after the parent tries to
  // tear the worker down.  Clean up the token and exit.
  stopRequested = true;
  cleanupToken();
  process.exit(0);
});

process.on("SIGINT", () => {
  stopRequested = true;
  cleanupToken();
  process.exit(0);
});
