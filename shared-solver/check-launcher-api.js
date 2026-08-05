"use strict";

/**
 * TEST GRADE: unit-plus-micro
 *
 * PR-5.3d Launcher API contract: tower registry path safety, task preflight,
 * job lifecycle endpoints, SSE progress, terminal/cancel semantics, and
 * restart persistence.  Runs the real launcher server in-process with the
 * canonical Only Up tower.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { createLauncherServer } = require("./launcher/server");
const { FileJobStore } = require("./lib/file-job-store");

const ROOT = path.resolve(__dirname, "..");
const SMOKE_SPEC_FILE = path.join(ROOT, "towers", "onlyup", "region-specs", "region-output-contract-smoke.json");
const ONLY_UP_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");

function baseTask() {
  const spec = JSON.parse(fs.readFileSync(SMOKE_SPEC_FILE, "utf8"));
  return {
    schema: "motapathfinder.solve-task.v1",
    tower: {
      id: "onlyup-v2.1",
      projectRoot: ONLY_UP_ROOT,
      region: { spec },
    },
    objective: { mode: "max-final-hp" },
    search: {
      algorithm: "segment-dp",
      maxExpansions: 1000,
      maxRuntimeMs: 10000,
      candidateLimit: 2,
      goalSkylineLimit: 8,
    },
    verification: { strictReplay: false },
  };
}

async function jsonFetch(base, method, route, body) {
  const options = { method, headers: {} };
  if (body !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${base}${route}`, options);
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch (error) {
    payload = null;
  }
  return { status: response.status, payload, text };
}

async function waitFor(condition, timeoutMs, intervalMs) {
  const started = Date.now();
  for (;;) {
    const value = await condition();
    if (value) return value;
    if (Date.now() - started > timeoutMs) {
      throw new Error("timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs || 100));
  }
}

async function readSse(base, jobId, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 15000);
  let text = "";
  try {
    const response = await fetch(`${base}/api/jobs/${encodeURIComponent(jobId)}/events`, {
      headers: { "Last-Event-ID": "0" },
      signal: controller.signal,
    });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (text.includes("\nevent: terminal")) break;
    }
  } catch (error) {
    // aborted after terminal
  } finally {
    clearTimeout(timer);
  }
  return text;
}

async function main() {
  const jobsRoot = path.join(__dirname, "routes", "generated", "launcher-api-check");
  fs.rmSync(jobsRoot, { recursive: true, force: true });
  const launcher = createLauncherServer({
    port: 0,
    jobsRoot,
    maxConcurrentJobs: 1,
  });
  const port = await launcher.listen();
  const base = `http://127.0.0.1:${port}`;

  // 1. Health + tower registry.
  const health = await jsonFetch(base, "GET", "/api/health");
  assert.strictEqual(health.status, 200);
  assert.strictEqual(health.payload.status, "ok");

  const towers = await jsonFetch(base, "GET", "/api/towers");
  assert.strictEqual(towers.status, 200);
  const tower = towers.payload.towers.find((entry) => entry.id === "onlyup-v2.1");
  assert.ok(tower, "the Only Up tower must be registered");
  assert.ok(tower.projectFingerprint, "tower must expose a real project fingerprint");

  // Registry path traversal must not read arbitrary files.
  const escape1 = await jsonFetch(base, "GET", "/api/towers/onlyup-v2.1/regions/..%2F..%2Fpackage.json");
  assert.ok([400, 404].includes(escape1.status), "region path traversal must be rejected");
  const escape2 = await jsonFetch(base, "GET", "/api/towers/onlyup-v2.1/regions/%2e%2e%2f%2e%2e%2fpackage");
  assert.ok([400, 404].includes(escape2.status), "encoded path traversal must be rejected");

  // 2. Task validate returns normalized task + fingerprints.
  const validated = await jsonFetch(base, "POST", "/api/tasks/validate", baseTask());
  assert.strictEqual(validated.status, 200);
  assert.strictEqual(validated.payload.valid, true);
  assert.ok(validated.payload.identity.taskFingerprint, "validate must return a task fingerprint");
  assert.strictEqual(validated.payload.objective.explicit, true);

  // 3. Invalid ObjectiveSpec -> structured 400.
  const invalidTask = baseTask();
  invalidTask.objective = { mode: "maximize", field: "hero.hpmax" };
  const rejected = await jsonFetch(base, "POST", "/api/tasks/validate", invalidTask);
  assert.strictEqual(rejected.status, 400);
  assert.strictEqual(rejected.payload.valid, false);
  assert.strictEqual(rejected.payload.failure.failureClass, "INVALID_TASK");
  assert.ok(rejected.payload.failure.code, "structured error must carry a code");

  // 2a. Planning preflight failure must not be silently valid: a task with
  //     an existing-but-unloadable projectRoot gets a structured 400.
  const malformedRoot = path.join(__dirname, "routes", "generated", "launcher-malformed-project");
  fs.mkdirSync(malformedRoot, { recursive: true });
  fs.writeFileSync(path.join(malformedRoot, "not-a-project.txt"), "x", "utf8");
  const malformedTask = baseTask();
  malformedTask.tower.projectRoot = malformedRoot;
  malformedTask.tower.projectFingerprint = "deadbeefdeadbeef";
  const malformedValidate = await jsonFetch(base, "POST", "/api/tasks/validate", malformedTask);
  assert.strictEqual(malformedValidate.status, 400, "planning preflight failure must return 400, not valid:true");
  assert.strictEqual(malformedValidate.payload.valid, false);
  assert.strictEqual(malformedValidate.payload.failure.failureClass, "PLANNING_PREFLIGHT_FAILED");

  // 2b. Validate returns effective per-segment budgets with the manual search
  //     override applied (not the RegionSpec's own budgets).
  const budgetTask = baseTask();
  budgetTask.search = { ...budgetTask.search, maxExpansions: 50000, maxRuntimeMs: 0 };
  const budgetValidate = await jsonFetch(base, "POST", "/api/tasks/validate", budgetTask);
  assert.strictEqual(budgetValidate.status, 200);
  assert.ok(budgetValidate.payload.effectiveSegments, "validate must return effectiveSegments");
  assert.ok(budgetValidate.payload.effectiveSegments.length >= 1);
  budgetValidate.payload.effectiveSegments.forEach((entry) => {
    assert.strictEqual(entry.budgetScope, "per-attempt", "effective budgets must declare per-attempt scope");
    assert.strictEqual(entry.perAttempt.maxExpansions, 50000, "manual maxExpansions must appear as the per-attempt cap");
    assert.strictEqual(entry.perAttempt.maxRuntimeMs, 0, "manual maxRuntimeMs=0 must appear as the per-attempt cap");
    assert.ok(entry.maxStartAttempts >= 1, "effective budgets must report the start-candidate (attempt) cap");
  });

  // 2c. maxRuntimeMs=0 job must never be RUNTIME_BUDGET_EXHAUSTED through the API.
  const unlimitedJob = await jsonFetch(base, "POST", "/api/jobs", budgetTask);
  assert.strictEqual(unlimitedJob.status, 202);
  await waitFor(async () => {
    const result = await jsonFetch(base, "GET", `/api/jobs/${unlimitedJob.payload.job.id}/result`);
    return result.payload && result.payload.result && result.payload.state === "completed";
  }, 120000, 100);
  const unlimitedResult = await jsonFetch(base, "GET", `/api/jobs/${unlimitedJob.payload.job.id}/result`);
  assert.strictEqual(unlimitedResult.payload.result.found, true);
  assert.notStrictEqual(
    unlimitedResult.payload.result.failure && unlimitedResult.payload.result.failure.failureClass,
    "RUNTIME_BUDGET_EXHAUSTED",
    "maxRuntimeMs=0 must never be classified as runtime budget exhausted",
  );

  // 4. POST job -> 202.
  // 4. POST job -> 202.
  const created = await jsonFetch(base, "POST", "/api/jobs", baseTask());
  assert.strictEqual(created.status, 202);
  assert.ok(created.payload.job.id, "created job must carry an id");
  const jobId = created.payload.job.id;

  // 5+6. SSE: monotonic sequence + terminal event.
  await waitFor(async () => {
    const result = await jsonFetch(base, "GET", `/api/jobs/${jobId}/result`);
    return result.payload && result.payload.result && result.payload.state === "completed";
  }, 120000, 100);
  const sseText = await readSse(base, jobId, 15000);
  assert.ok(sseText.includes("\nevent: terminal\n"), "SSE must emit a terminal event");
  const ids = sseText.split("\n").filter((line) => line.startsWith("id: ")).map((line) => Number(line.slice(4)));
  let previous = 0;
  ids.forEach((id) => {
    assert.ok(id > previous, "SSE sequence must be strictly monotonic");
    previous = id;
  });

  // 7. Cancelling a terminal job -> 409.
  const cancelTerminal = await jsonFetch(base, "POST", `/api/jobs/${jobId}/cancel`);
  assert.strictEqual(cancelTerminal.status, 409);
  assert.strictEqual(cancelTerminal.payload.failure.failureClass, "JOB_INVALID_STATE_TRANSITION");

  // 8. result and route endpoints stay distinct.
  const resultResponse = await jsonFetch(base, "GET", `/api/jobs/${jobId}/result`);
  assert.strictEqual(resultResponse.status, 200);
  assert.ok(resultResponse.payload.result.route, "result must carry the route artifact");
  const routeResponse = await fetch(`${base}/api/jobs/${jobId}/route`);
  assert.strictEqual(routeResponse.status, 200);
  const routeJson = JSON.parse(await routeResponse.text());
  assert.strictEqual(routeJson.schema, "motapathfinder.route.v1", "route endpoint must return the route artifact only");

  // 9. Server restart: terminal jobs must still be readable from the store.
  await launcher.close();
  const restarted = createLauncherServer({ port: 0, jobsRoot, maxConcurrentJobs: 1 });
  const restartedPort = await restarted.listen();
  const restartedBase = `http://127.0.0.1:${restartedPort}`;
  const jobsAfterRestart = await jsonFetch(restartedBase, "GET", "/api/jobs");
  const restored = jobsAfterRestart.payload.jobs.find((job) => job.id === jobId);
  assert.ok(restored, "terminal jobs must be recoverable after server restart");
  assert.strictEqual(restored.state, "completed", "restored terminal job must not be shown as interrupted");

  // 10. A stale queued/running record must be shown as interrupted, never
  //     as still running.
  const staleJobId = "job-stale-running";
  const store = new FileJobStore({ root: jobsRoot });
  store.saveStatus(staleJobId, {
    id: staleJobId,
    state: "running",
    taskFingerprint: "stale-fp",
    createdAt: new Date().toISOString(),
    lastProgress: { sequence: 3, phase: "segment-search" },
  });
  const staleJobs = await jsonFetch(restartedBase, "GET", "/api/jobs");
  const stale = staleJobs.payload.jobs.find((job) => job.id === staleJobId);
  assert.ok(stale, "stale job must appear in the list");
  assert.strictEqual(stale.state, "interrupted", "a stale running job must be shown as interrupted");
  assert.strictEqual(stale.interrupted, true);
  const staleDetail = await jsonFetch(restartedBase, "GET", `/api/jobs/${staleJobId}`);
  assert.strictEqual(staleDetail.payload.job.state, "interrupted");

  await restarted.close();

  process.stdout.write(JSON.stringify({
    schema: "motapathfinder.pr-5.3d1-launcher-api.v1",
    status: "passed",
    controls: {
      registryPathTraversalRejected: true,
      validateReturnsEffectiveSegmentBudgets: true,
      planningPreflightFailureNotSilentlyValid: true,
      effectiveSegmentsPerAttemptScope: true,
      maxRuntimeMsZeroNotExhausted: true,
      taskValidateReturnsFingerprints: true,
      invalidObjectiveStructured400: true,
      jobCreate202: true,
      sseSequenceMonotonic: true,
      sseTerminalEventPresent: true,
      cancelTerminal409: true,
      resultRouteEndpointsDistinct: true,
      restartRecoversTerminalJobs: true,
      staleRunningShownAsInterrupted: true,
    },
  }, null, 2) + "\n");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  });
}

module.exports = { main };
