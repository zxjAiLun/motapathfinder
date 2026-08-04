"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { SolverJobManager, createSolveTaskErrorResult } = require("./lib/solver-job-manager");
const { createWorkerExecutor } = require("./lib/solver-worker-runner");
const { compileSolveTask } = require("./lib/solve-task");
const { FileJobStore } = require("./lib/file-job-store");

function parseKeyValueArgs(argv) {
  const args = {};
  for (const token of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(token);
    if (!match) continue;
    args[match[1]] = match[2];
  }
  return args;
}

function parseBoolean(value) {
  if (value == null) return false;
  if (value === "1" || value === "true" || value === "on") return true;
  if (value === "0" || value === "false" || value === "off") return false;
  return Boolean(value);
}

function main() {
  const args = parseKeyValueArgs(process.argv.slice(2));
  if (args.help || args.h || !args.task) {
    console.log([
      "Usage:",
      "  node run-solve-task.js --task=<solve-task.json> [--project-root=<tower-root>] [--progress-format=ndjson|json] [--store-root=<runs/jobs>] [--worker=1|0]",
      "",
      "Outputs line-delimited events:",
      '  {"type":"accepted","jobId":"..."}',
      '  {"type":"progress","sequence":1,"phase":"preflight"}',
      '  {"type":"completed","result":{}}',
    ].join("\n"));
    return;
  }
  const taskPath = path.resolve(args.task);
  if (!fs.existsSync(taskPath)) {
    console.error(`task file not found: ${taskPath}`);
    process.exitCode = 1;
    return;
  }
  const rawTask = JSON.parse(fs.readFileSync(taskPath, "utf8"));
  if (!rawTask.tower || !rawTask.tower.projectRoot) {
    if (args["project-root"]) rawTask.tower = rawTask.tower || {};
    if (args["project-root"]) rawTask.tower.projectRoot = path.resolve(args["project-root"]);
  }
  const progressFormat = args["progress-format"] || "ndjson";
  const useWorker = parseBoolean(args.worker == null ? "1" : args.worker);
  const storeRoot = args["store-root"] || null;
  const jobStore = storeRoot ? new FileJobStore({ root: storeRoot }) : null;

  // Preflight compile so invalid tasks fail before any job is created.
  let task;
  try {
    task = compileSolveTask(rawTask, {
      projectRoot: rawTask.tower && rawTask.tower.projectRoot || null,
    });
  } catch (error) {
    const failure = createSolveTaskErrorResult(error);
    console.error(JSON.stringify({ type: "rejected", failure }, null, 2));
    process.exitCode = 2;
    return;
  }

  const manager = new SolverJobManager({
    maxConcurrentJobs: 1,
    createExecutor: useWorker ? createWorkerExecutor : null,
    allowInProcess: !useWorker,
    jobStore,
  });
  const job = manager.submit(task);

  const emit = (payload) => {
    const line = JSON.stringify(payload);
    if (progressFormat === "json") {
      process.stdout.write(`${line}\n`);
    } else {
      process.stdout.write(`${line}\n`);
    }
  };

  emit({ type: "accepted", jobId: job.id, taskFingerprint: job.task.taskFingerprint });
  manager.subscribe(job.id, (snapshot) => {
    emit({ type: "progress", ...snapshot });
  });

  const poll = () => {
    const current = manager.getJob(job.id);
    if (current && (current.state === "completed" || current.state === "failed" || current.state === "cancelled")) {
      if (current.state === "completed") {
        emit({ type: "completed", jobId: job.id, result: current.result });
      } else {
        emit({ type: current.state, jobId: job.id, failure: current.failure });
        process.exitCode = current.state === "failed" ? 3 : 4;
      }
      return;
    }
    setTimeout(poll, 50);
  };
  poll();
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  }
}
