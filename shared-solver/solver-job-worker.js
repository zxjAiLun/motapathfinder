"use strict";

// Child-process job worker.  Receives a serialized SolveTask, executes the
// existing solver pipeline, and reports progress/result/failure back to the
// parent.  The worker never reimplements search; it drives runMilestoneGraph.
const { compileSolveTask } = require("./lib/solve-task");
const { executeSolveJob } = require("./lib/solver-job");
const { serializeError } = require("./lib/solver-job-result");

let stopRequested = false;

process.on("message", async (message) => {
  if (!message || typeof message !== "object") return;
  if (message.type === "cancel") {
    stopRequested = true;
    return;
  }
  if (message.type !== "start") return;
  const { jobId, task } = message;
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
        if (!stopRequested) {
          process.send({ type: "progress", jobId, payload: snapshot });
        }
      },
      shouldStop: () => stopRequested,
    });
    if (stopRequested || execution.cancelled) {
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
  }
});

process.on("SIGTERM", () => {
  stopRequested = true;
});
