"use strict";

/**
 * TEST GRADE: integration-local
 *
 * PR-5.3c live job smoke: a real short Only Up SolveTask runs queued ->
 * completed through the job pipeline, then the produced route is strictly
 * replayed in a real Chromium browser and the objective value is recomputed.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { compileSolveTask, SOLVE_TASK_SCHEMA } = require("./lib/solve-task");
const { SolverJobManager } = require("./lib/solver-job-manager");
const { findBrowserExecutable, replayRouteFile, verifyRouteObjective } = require("./lib/live-replay");

const ROOT = path.resolve(__dirname, "..");
const SMOKE_SPEC_FILE = path.join(ROOT, "towers", "onlyup", "region-specs", "region-output-contract-smoke.json");
const ONLY_UP_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");

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

async function main() {
  assert.ok(findBrowserExecutable(), "Chrome/Edge executable is required for SolverJob live replay");
  const spec = JSON.parse(fs.readFileSync(SMOKE_SPEC_FILE, "utf8"));
  const task = compileSolveTask({
    schema: SOLVE_TASK_SCHEMA,
    tower: { id: "onlyup-smoke", projectRoot: ONLY_UP_ROOT, region: { spec } },
    objective: { mode: "max-final-hp" },
    search: { algorithm: "segment-dp", maxExpansions: 1000, maxRuntimeMs: 10000, candidateLimit: 2 },
  });
  const manager = new SolverJobManager({ maxConcurrentJobs: 1 });
  const job = manager.submit(task);
  const phases = [];
  manager.subscribe(job.id, (snapshot) => phases.push(snapshot.phase));
  const settled = await waitForJob(manager, job.id, 120000);
  assert.strictEqual(settled.state, "completed", "live job must complete");
  ["preflight", "segment-search", "strict-replay", "finalizing"].forEach((phase) => {
    assert.ok(phases.includes(phase), `live progress must pass through ${phase}`);
  });
  assert.ok(phases.includes("completed") || phases.includes("finalizing"));
  assert.strictEqual(settled.result.found, true);
  const routeRecord = settled.result.route.record;
  assert.ok(routeRecord, "completed job must carry a route artifact");
  await replayRouteFile(routeRecord, {
    projectRoot: ONLY_UP_ROOT,
    headless: "1",
    keepOpen: false,
    timeoutMs: 30000,
    stepDelayMs: 0,
    fastForwardDelayMs: 0,
    runtimeAutoBattle: 1,
  });
  const objective = verifyRouteObjective(routeRecord, routeRecord.final.snapshot, routeRecord.decisions.length);
  assert.strictEqual(objective.matches, true);
  process.stdout.write(JSON.stringify({
    schema: "motapathfinder.pr-5.3c-solver-job-live.v1",
    status: "passed",
    taskFingerprint: task.taskFingerprint,
    jobId: job.id,
    phases: [...new Set(phases)],
    routeDecisionCount: routeRecord.decisions.length,
    strictReplayRecomputed: true,
    objectiveFingerprint: objective.fingerprint,
  }, null, 2) + "\n");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  });
}

module.exports = { main };
