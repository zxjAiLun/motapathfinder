"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { fork } = require("node:child_process");
const { loadProject } = require("./lib/project-loader");
const d = require("./lib/durable-search");

function argumentsOf(argv) {
  const result = {};
  for (const arg of argv) {
    const match = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (!match) throw new Error(`use --name=value: ${arg}`);
    result[match[1]] = match[2];
  }
  return result;
}
function acquireLock(dir, name = "runner.lock") {
  const file = path.join(dir, name);
  if (fs.existsSync(file)) {
    const old = d.readJson(file);
    if (old.host !== os.hostname()) throw new Error("lock belongs to another host");
    let alive = true;
    try { process.kill(old.pid, 0); } catch (error) { if (error.code === "ESRCH") alive = false; }
    if (alive) throw new Error(`runner already active: ${old.pid}`);
    fs.unlinkSync(file);
  }
  const fd = fs.openSync(file, "wx");
  fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, host: os.hostname() }));
  fs.closeSync(fd);
  return () => { if (fs.existsSync(file) && d.readJson(file).pid === process.pid) fs.unlinkSync(file); };
}
async function main(argv = process.argv.slice(2)) {
  const args = argumentsOf(argv);
  if (args.worker) {
    const spec = d.readJson(args.worker);
    const releaseWorker = acquireLock(spec.dir, "worker.lock");
    try {
      const result = d.runAttempt(spec.config, spec.towerRoot, spec.dir, spec.task, (value) => {
        if (process.connected) process.send(value);
      });
      d.atomicJson(spec.output, result);
    } finally { releaseWorker(); }
    return;
  }
  if (!args.config || !args["tower-root"] || !args["run-dir"]) throw new Error("--config= --tower-root= --run-dir= required");
  const config = d.readJson(path.resolve(args.config));
  d.validateConfig(config);
  const towerRoot = path.resolve(args["tower-root"]);
  const dir = path.resolve(args["run-dir"]);
  fs.mkdirSync(dir, { recursive: true });
  const release = acquireLock(dir);
  let timer;
  try {
    // A killed coordinator must not start a second task beside its orphaned worker.
    const workerProbe = acquireLock(dir, "worker.lock");
    workerProbe();
    const identity = d.identityOf(config, towerRoot);
    const journalPath = path.join(dir, "journal.json");
    let journal;
    if (fs.existsSync(journalPath)) journal = d.recoverJournal(d.readJson(journalPath), identity);
    else {
      const project = loadProject(towerRoot);
      const state = d.initialState(project, d.makeSimulator(project, config), config);
      journal = d.newJournal(identity, config, state);
      d.atomicJson(path.join(dir, "initial.json"), state);
      d.atomicJson(path.join(dir, "states", `${journal.nodes[0].id}.json`), state);
    }
    let telemetry = null;
    let task = null;
    const sessionStart = Date.now();
    const previousElapsed = journal.elapsedMs || 0;
    const publish = () => {
      journal.elapsedMs = previousElapsed + Date.now() - sessionStart;
      d.atomicJson(path.join(dir, "status.json"), {
        title: config.title, state: journal.state, heartbeatAt: new Date().toISOString(),
        createdAt: journal.createdAt, elapsedMs: journal.elapsedMs, maxRuntimeMs: config.maxRuntimeMs,
        initial: journal.initial, initialFlags: journal.initialFlags, protectedItems: config.protectedItems,
        totalExpansions: journal.totalExpansions, completedAttempts: journal.completedAttempts,
        candidates: journal.nodes.length, pending: journal.nodes.filter((n) => n.status === "pending").length,
        stages: config.stages, current: task && { id: task.id, stage: task.stage, tier: task.tier, entry: task.summary },
        telemetry, best: journal.best, error: journal.error || null,
        history: journal.history.slice(-30).map(({ diagnostics, ...row }) => row),
        limits: { heapMb: config.heapMb, maxRssMb: config.maxRssMb },
        resumeBoundary: "已完成局部任务持久化；在途 DP 从该局部起点重跑，不是 frontier 续跑。",
        optimalityProven: false,
      });
    };
    const save = () => { publish(); d.atomicJson(journalPath, journal); };
    const stop = () => { fs.writeFileSync(path.join(dir, "STOP"), "operator stop\n"); journal.state = "stopping"; publish(); };
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
    timer = setInterval(publish, 3000);
    if (journal.best) { journal.state = "verified_route"; save(); return; }
    journal.state = "running";
    delete journal.error;
    save();
    let sessionAttempts = 0;
    const attemptLimit = args["attempt-limit"] == null ? Infinity : Number(args["attempt-limit"]);
    if (!(attemptLimit > 0)) throw new Error("attempt-limit must be positive");
    while (journal.elapsedMs < config.maxRuntimeMs && sessionAttempts < attemptLimit && !fs.existsSync(path.join(dir, "STOP"))) {
      task = d.pickTask(journal);
      if (!task) { journal.state = "bounded_not_found"; break; }
      const originalTier = task.tier;
      const output = path.join(dir, "attempts", `${task.id}-${task.tier}.json`);
      const specPath = path.join(dir, "tasks", `${task.id}-${task.tier}.json`);
      task.status = "running";
      telemetry = null;
      save();
      const remainingMs = config.maxRuntimeMs - journal.elapsedMs;
      const workerConfig = JSON.parse(JSON.stringify(config));
      workerConfig.budgets[task.tier].runtimeMs = Math.min(workerConfig.budgets[task.tier].runtimeMs, remainingMs);
      d.atomicJson(specPath, { config: workerConfig, towerRoot, dir, task, output });
      try {
        if (!fs.existsSync(output)) await new Promise((resolve, reject) => {
          const log = fs.openSync(path.join(dir, "worker.log"), "a");
          const child = fork(__filename, [`--worker=${specPath}`], {
            execArgv: [`--max-old-space-size=${config.heapMb}`], stdio: ["ignore", log, log, "ipc"],
          });
          fs.closeSync(log);
          const deadline = setTimeout(() => child.kill("SIGKILL"), workerConfig.budgets[task.tier].runtimeMs + 120000);
          child.on("message", (message) => { telemetry = message; publish(); });
          child.once("error", (error) => { clearTimeout(deadline); reject(error); });
          child.once("exit", (code, signal) => {
            clearTimeout(deadline);
            if (code === 0 && fs.existsSync(output)) resolve();
            else reject(new Error(`worker failed code=${code} signal=${signal}; inspect worker.log`));
          });
        });
        const result = d.readJson(output);
        d.integrate(journal, task, result, config, dir);
        sessionAttempts += 1;
        if (result.stats.stoppedReason === "cancel-requested") { task.tier = originalTier; task.status = "pending"; fs.unlinkSync(output); }
        save();
        // The durable states + journal now own the result; avoid retaining a
        // second full copy of candidate route traces for every attempt.
        if (fs.existsSync(output)) fs.unlinkSync(output);
        if (journal.best) break;
      } catch (error) {
        task.status = "pending";
        journal.state = "error";
        journal.error = error.message;
        save();
        process.exitCode = 1;
        break;
      }
    }
    if (["running", "stopping"].includes(journal.state)) journal.state = fs.existsSync(path.join(dir, "STOP")) || sessionAttempts >= attemptLimit ? "paused" : "run_budget_reached";
    task = null;
    save();
  } finally { clearInterval(timer); release(); }
}
if (require.main === module) main().catch((error) => { console.error(error.stack); process.exitCode = 1; });
module.exports = { main, argumentsOf, acquireLock };
