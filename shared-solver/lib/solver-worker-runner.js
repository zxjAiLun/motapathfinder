"use strict";

const path = require("node:path");
const { fork } = require("node:child_process");

const WORKER_PATH = path.join(__dirname, "..", "solver-job-worker.js");

// Spawns a dedicated child process for a solve job so the Launcher/GUI/API
// main thread is never blocked by CPU-bound search.
function createWorkerExecutor({ job, task, onProgress, context }) {
  const child = fork(WORKER_PATH, [], {
    stdio: ["ignore", "ignore", "inherit", "ipc"],
    windowsHide: true,
  });
  let settled = false;
  let cancelRequested = false;
  const payload = {
    type: "start",
    jobId: job && job.id || "job-unknown",
    task: task && task.compiled ? task.toJSON() : task,
  };
  const promise = new Promise((resolve, reject) => {
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      try {
        child.kill();
      } catch (error) {
        // ignore
      }
      fn(value);
    };
    child.on("message", (message) => {
      if (!message || typeof message !== "object") return;
      if (message.type === "progress" && typeof onProgress === "function") {
        onProgress(message.payload);
        return;
      }
      if (message.type === "completed") {
        settle(resolve, message.result);
      } else if (message.type === "failed") {
        const error = new Error(message.error && message.error.message || "solver job worker failed");
        error.name = message.error && message.error.name || "Error";
        error.code = message.error && message.error.code || null;
        error.stack = message.error && message.error.stack || null;
        settle(reject, error);
      }
    });
    child.on("error", (error) => {
      settle(reject, error);
    });
    child.on("exit", (code) => {
      if (cancelRequested) {
        const error = new Error("The job was cancelled by request.");
        error.code = "CANCELLED";
        settle(reject, error);
      } else if (!settled) {
        settle(reject, new Error(`solver job worker exited with code ${code}`));
      }
    });
    child.send(payload);
  });
  return {
    execute: () => promise,
    cancel: () => {
      cancelRequested = true;
      try {
        if (child.connected) child.send({ type: "cancel" });
      } catch (error) {
        // ignore
      }
    },
    dispose: () => {
      try {
        child.kill();
      } catch (error) {
        // ignore
      }
    },
  };
}

module.exports = { createWorkerExecutor };
