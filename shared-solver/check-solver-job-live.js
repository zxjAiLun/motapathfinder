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
const { findBrowserExecutable, replayRouteFile, verifyRouteObjective, launchRuntimeSession, captureRuntimeSnapshot, prepareReplayRouteRecord } = require("./lib/live-replay");

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

async function checkRouteMetricsStrictReplay(objective, label) {
  const spec = JSON.parse(fs.readFileSync(SMOKE_SPEC_FILE, "utf8"));
  const task = compileSolveTask({
    schema: SOLVE_TASK_SCHEMA,
    tower: { id: "onlyup-smoke", projectRoot: ONLY_UP_ROOT, region: { spec } },
    objective,
    search: { algorithm: "segment-dp", maxExpansions: 1000, maxRuntimeMs: 10000, candidateLimit: 2 },
    verification: { strictReplay: true },
  });
  const manager = new SolverJobManager({ maxConcurrentJobs: 1, allowInProcess: true });
  const job = manager.submit(task);
  const settled = await waitForJob(manager, job.id, 180000);
  assert.strictEqual(settled.state, "completed", `${label} job must complete with strictReplay:true`);
  assert.strictEqual(settled.result.route.strictReplayVerified, true, `${label} must be runtime verified`);
  assert.strictEqual(settled.result.route.verificationStatus, "verified");
  const metadataValue = settled.result.route.record.metadata.finalObjectiveValue;
  assert.strictEqual(
    settled.result.objective.value,
    metadataValue,
    `${label}: result objective value must equal the route artifact metadata value`,
  );
  return settled.result.route.record;
}

async function main() {
  assert.ok(findBrowserExecutable(), "Chrome/Edge executable is required for SolverJob live replay");
  const spec = JSON.parse(fs.readFileSync(SMOKE_SPEC_FILE, "utf8"));
  const task = compileSolveTask({
    schema: SOLVE_TASK_SCHEMA,
    tower: { id: "onlyup-smoke", projectRoot: ONLY_UP_ROOT, region: { spec } },
    objective: { mode: "max-final-hp" },
    search: { algorithm: "segment-dp", maxExpansions: 1000, maxRuntimeMs: 10000, candidateLimit: 2 },
    verification: { strictReplay: true },
  });
  const manager = new SolverJobManager({ maxConcurrentJobs: 1, allowInProcess: true });
  const job = manager.submit(task);
  const phases = [];
  manager.subscribe(job.id, (snapshot) => phases.push(snapshot.phase));
  const settled = await waitForJob(manager, job.id, 180000);
  assert.strictEqual(settled.state, "completed", "live job must complete");
  ["preflight", "segment-search", "strict-replay", "finalizing"].forEach((phase) => {
    assert.ok(phases.includes(phase), `live progress must pass through ${phase}`);
  });
  assert.strictEqual(settled.result.found, true);
  assert.strictEqual(
    settled.result.route.strictReplayVerified,
    true,
    "the job itself must perform the real strict runtime replay and verify it",
  );
  assert.strictEqual(settled.result.route.verificationStatus, "verified");
  const routeRecord = settled.result.route.record;
  assert.ok(routeRecord, "completed job must carry a route artifact");
  // The job already ran the real Chromium replay internally; re-run it here as
  // an independent confirmation of the strict-replay authority.
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

  // Auto-step routes distinguish decisionDepth from the full routeLength.
  const routeLengthRecord = await checkRouteMetricsStrictReplay(
    { mode: "maximize-score", terms: [{ path: "route.length", weight: -1 }] },
    "route.length",
  );
  assert.ok(
    routeLengthRecord.stats.routeLength > routeLengthRecord.decisions.length,
    `auto-step routes must have routeLength > decisions.length (got ${routeLengthRecord.stats.routeLength} vs ${routeLengthRecord.decisions.length})`,
  );
  assert.strictEqual(
    routeLengthRecord.metadata.finalObjectiveValue,
    -Number(routeLengthRecord.stats.routeLength),
    "route-length objective metadata must reflect the full route length, not the decision count",
  );

  await checkRouteMetricsStrictReplay(
    { mode: "maximize-score", terms: [{ path: "decisionDepth", weight: -1 }] },
    "decisionDepth",
  );

  // Legacy task without an explicit ObjectiveSpec must still complete with a
  // successful runtime replay; objective stays null.
  const legacyTask = compileSolveTask({
    schema: SOLVE_TASK_SCHEMA,
    tower: { id: "onlyup-smoke", projectRoot: ONLY_UP_ROOT, region: { spec } },
    search: { algorithm: "segment-dp", maxExpansions: 1000, maxRuntimeMs: 10000, candidateLimit: 2 },
    verification: { strictReplay: true },
  });
  assert.strictEqual(legacyTask.objective.explicit, false, "legacy task must have no explicit objective");
  const legacyManager = new SolverJobManager({ maxConcurrentJobs: 1, allowInProcess: true });
  const legacyJob = legacyManager.submit(legacyTask);
  const legacySettled = await waitForJob(legacyManager, legacyJob.id, 180000);
  assert.strictEqual(legacySettled.state, "completed", "legacy objective-less job must complete after a successful runtime replay");
  assert.strictEqual(legacySettled.result.objective, null, "legacy job result objective must be null");
  assert.strictEqual(legacySettled.result.route.strictReplayVerified, true);
  assert.strictEqual(legacySettled.result.route.verificationStatus, "verified");

  // PR-5.4a Commit 3: two-region composite strict replay in the real runtime.
  const { compileSolveTaskV2 } = require("./lib/solve-task-v2");
  const regionBSpec = JSON.parse(JSON.stringify(spec));
  regionBSpec.id = "onlyup-region-b";
  regionBSpec.actionPolicy = { actionKinds: ["pickup", "interactPickup", "equip", "openDoor", "useTool", "changeFloor", "floorFly", "event"] };
  regionBSpec.goal = { type: "heroAtLeast", floorId: "MT1", minHero: { exp: 2 } };
  const multiRegionTask = compileSolveTaskV2({
    schema: "motapathfinder.solve-task.v2",
    tower: {
      id: "onlyup-v2.1",
      projectRoot: ONLY_UP_ROOT,
      regions: [{ spec }, { spec: regionBSpec }],
    },
    model: legacyTask.normalizedTask.model || JSON.parse(JSON.stringify(spec.model)),
    objective: { mode: "max-final-hp" },
    search: { algorithm: "segment-dp", maxExpansions: 1000, maxRuntimeMs: 10000, candidateLimit: 2, regionCandidateLimit: 8 },
    verification: { strictReplay: true },
  });
  const multiManager = new SolverJobManager({ maxConcurrentJobs: 1, allowInProcess: true });
  const multiJob = multiManager.submit(multiRegionTask);
  const multiSettled = await waitForJob(multiManager, multiJob.id, 180000);
  assert.strictEqual(multiSettled.state, "completed", "two-region composite strict replay must complete");
  assert.strictEqual(multiSettled.result.route.record.schema, "motapathfinder.multi-region-route.v1");
  assert.strictEqual(multiSettled.result.route.record.boundaryFingerprintsMatch, true);
  assert.strictEqual(multiSettled.result.route.verificationStatus, "verified");
  assert.strictEqual(multiSettled.result.route.strictReplayVerified, true);
  assert.strictEqual(multiSettled.result.regions.length, 2);
  assert.ok(multiSettled.result.regions.every((r) => r.status === "completed"));

  // Repair 5b: followers restore -> capture round-trip through the real game
  // page.  A route start snapshot carrying followers must survive
  // restoreRuntimeSnapshotStart and come back unchanged from
  // captureRuntimeSnapshot (the array must not be coerced to a number).
  // Reuse the proven replay path (replayRouteFile restores the start snapshot
  // in the real game page and captures the runtime final): a 0-step record
  // whose start snapshot carries followers must round-trip them through the
  // restore -> capture chain, proving the followers array is not dropped.
  const followersRoundTrip = JSON.parse(JSON.stringify(multiSettled.result.route.record.regions[0].record));
  followersRoundTrip.decisions = [];
  followersRoundTrip.final = JSON.parse(JSON.stringify(followersRoundTrip.start));
  followersRoundTrip.start.snapshot.hero.followers = [];
  const rtResult = await replayRouteFile(followersRoundTrip, {
    projectRoot: ONLY_UP_ROOT,
    headless: "1",
    keepOpen: false,
    timeoutMs: 60000,
    stepDelayMs: 0,
    fastForwardDelayMs: 0,
    runtimeAutoBattle: 1,
  });
  // The game project always runs with an empty followers list, so the round-trip
  // signal is that the runtime capture keeps the array shape (never coerces it
  // to a number, which is exactly what the pre-fix capture did).
  assert.ok(
    Array.isArray(rtResult.finalRuntimeSnapshot.hero.followers),
    "captured followers must stay an array through the restore -> capture chain",
  );
  assert.deepStrictEqual(
    rtResult.finalRuntimeSnapshot.hero.followers,
    [],
    "restored empty followers must round-trip unchanged",
  );
  assert.ok(
    Array.isArray(rtResult.finalRuntimeSnapshot.hero.equipment),
    "captured equipment must stay an array through the restore -> capture chain",
  );

  process.stdout.write(JSON.stringify({
    schema: "motapathfinder.pr-5.4a-solver-job-live.v1",
    status: "passed",
    taskFingerprint: task.taskFingerprint,
    jobId: job.id,
    phases: [...new Set(phases)],
    routeDecisionCount: routeRecord.decisions.length,
    strictReplayVerifiedInsideJob: true,
    strictReplayRecomputed: true,
    autoStepRouteLength: routeLengthRecord.stats.routeLength,
    autoStepDecisions: routeLengthRecord.decisions.length,
    legacyObjectiveOmittedCompleted: true,
    multiRegionCompositeReplayVerified: true,
    followersRestoreCaptureRoundTrip: true,
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
