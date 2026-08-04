"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { fork } = require("node:child_process");

const WORKER_PATH = path.join(__dirname, "..", "solver-job-worker.js");

const CANCEL_GRACE_MS = 5000;

function cancelTokenPathFor(jobId) {
  return path.join(os.tmpdir(), `motapath-cancel-${String(jobId).replace(/[^A-Za-z0-9_-]/g, "_")}.token`);
}

// Spawns a dedicated child process for a solve job so the Launcher/GUI/API
// main thread is never blocked by CPU-bound search.  Cancellation writes a
// cancel-token file that the worker's synchronous shouldStop() can observe even
// while the worker's event loop is blocked; a grace period then force-kills the
// worker.
function createWorkerExecutor({ job, task, onProgress, context }) {
  const jobId = job && job.id || "job-unknown";
  const cancelTokenPath = cancelTokenPathFor(jobId);
  const child = fork(WORKER_PATH, [], {
    stdio: ["ignore", "ignore", "inherit", "ipc"],
    windowsHide: true,
  });
  let settled = false;
  let cancelRequested = false;
  let graceTimer = null;
  const payload = {
    type: "start",
    jobId,
    cancelTokenPath,
    task: task && task.compiled ? task.toJSON() : task,
  };
  const promise = new Promise((resolve, reject) => {
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      if (graceTimer) clearTimeout(graceTimer);
      try {
        fs.unlinkSync(cancelTokenPath);
      } catch (error) {
        // best-effort token cleanup
      }
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
      // Atomically create the cancel token so the worker's synchronous
      // shouldStop() sees it even while the search blocks the event loop.
      try {
        fs.writeFileSync(cancelTokenPath, "cancel\n", "utf8");
      } catch (error) {
        // ignore; the IPC cancel below remains as a fallback
      }
      try {
        if (child.connected) child.send({ type: "cancel" });
      } catch (error) {
        // ignore
      }
      if (!graceTimer) {
        graceTimer = setTimeout(() => {
          try {
            child.kill();
          } catch (error) {
            // ignore
          }
        }, CANCEL_GRACE_MS);
      }
    },
    dispose: () => {
      if (graceTimer) clearTimeout(graceTimer);
      try {
        child.kill();
      } catch (error) {
        // ignore
      }
    },
  };
}

module.exports = { CANCEL_GRACE_MS, createWorkerExecutor };
