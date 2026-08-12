"use strict";

/**
 * TEST GRADE: unit-plus-micro
 *
 * Reachability Reuse Attribution — observation only.
 *
 * Runs the approved MT1 candidate-default workload with the existing exact
 * reachability cache unchanged. For each exact-cache miss, an optional
 * simulator recorder groups already-proven safe-fast builds by their topology
 * inputs and compares the normalized path skeleton. No group is reused here.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { EXPERIMENTAL_PROFILE } = require("./lib/guarded-candidate-key");
const { createPerfTracker, setActivePerfTracker } = require("./lib/perf");
const { loadProject } = require("./lib/project-loader");
const { buildReplayRouteFingerprint } = require("./lib/replay-resume-artifact");
const { executeSolveJob, exactStateFingerprint, makeSimulator } = require("./lib/solver-job");
const { compileExecutableSolveTask } = require("./lib/solve-task");

const ROOT = path.resolve(__dirname, "..");
const ONLY_UP_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");
const SMOKE_SPEC_FILE = path.join(ROOT, "towers", "onlyup", "region-specs", "region-output-contract-smoke.json");

const EXPECTED_WINNER_EXACT = "a2ff379819ac9003";
const EXPECTED_ROUTE_SHA256 = "c0adb2d921e84cab097c034bf7b6f8fdb5a344a0cb21f66ea3b7f707a4ebec13";
const EXPECTED_OBJECTIVE_VALUE = 1346;

function buildTask() {
  const spec = JSON.parse(fs.readFileSync(SMOKE_SPEC_FILE, "utf8"));
  spec.goal = { type: "heroAtLeast", floorId: "MT1", minHero: { exp: 9 } };
  return compileExecutableSolveTask({
    schema: "motapathfinder.solve-task.v1",
    tower: { id: "onlyup-smoke", projectRoot: ONLY_UP_ROOT, region: { spec } },
    objective: { mode: "max-final-hp" },
    search: {
      algorithm: "segment-dp",
      maxExpansions: 3000,
      maxRuntimeMs: 0,
      candidateLimit: 2,
      goalSkylineLimit: 8,
    },
    verification: { strictReplay: true },
  });
}

async function main() {
  const task = buildTask();
  const defaultSimulator = makeSimulator(
    loadProject(ONLY_UP_ROOT),
    task.normalizedTask.tower.region.spec,
    task,
  );
  assert.strictEqual(defaultSimulator.getReachabilityReuseAttribution(), null,
    "reuse attribution must remain default-off outside an explicit diagnostic run");
  const tracker = createPerfTracker({ enabled: true });
  setActivePerfTracker(tracker);
  let execution;
  try {
    const originalLog = console.log;
    console.log = () => {};
    try {
      execution = await executeSolveJob(task, {
        jobId: "reachability-reuse-attribution",
        onProgress: () => {},
        shouldStop: () => false,
        context: { reachabilityReuseAttribution: true },
      });
    } finally {
      console.log = originalLog;
    }
  } finally {
    setActivePerfTracker(null);
  }

  const attempt = (execution.result.segmentResults || [])[0] &&
    (execution.result.segmentResults[0].attempts || [])[0];
  const dp = attempt && attempt.diagnostics && attempt.diagnostics.dp;
  const winnerState = execution.result.finalCandidate && execution.result.finalCandidate.state;
  const routeFingerprint = buildReplayRouteFingerprint(execution.routeRecord);
  const attribution = execution.simulator.getReachabilityReuseAttribution();
  const cacheStats = execution.simulator.getReachabilityCacheStats();
  const perf = tracker.snapshot();

  assert.strictEqual(execution.result.found, true);
  assert.strictEqual(execution.strictReplayVerified, true);
  assert.strictEqual(execution.profileSelection.effectiveProfile, EXPERIMENTAL_PROFILE);
  assert.strictEqual(exactStateFingerprint(winnerState), EXPECTED_WINNER_EXACT);
  assert.strictEqual(routeFingerprint.sha256, EXPECTED_ROUTE_SHA256);
  assert.strictEqual(execution.objectiveValue.value, EXPECTED_OBJECTIVE_VALUE);
  assert.ok(attribution, "attribution must be enabled on the solve simulator");
  assert.strictEqual(attribution.requests, Number(cacheStats.hits) + Number(cacheStats.misses));
  assert.strictEqual(attribution.exactCacheHits, Number(cacheStats.hits));
  assert.strictEqual(attribution.exactCacheMisses, Number(cacheStats.misses));
  assert.strictEqual(attribution.safeFastMisses + attribution.legacyExactMisses, attribution.exactCacheMisses);
  assert.ok(attribution.safeTopologyRepeatedGroups > 0, "real corpus must contain repeated safe topology projections");
  assert.ok(attribution.safeTopologyReusableMisses > 0, "real corpus must contain attributable reusable safe-fast misses");
  assert.strictEqual(attribution.closureMismatchGroupCount, 0,
    "same safe topology projection must produce one normalized closure fingerprint");
  assert.ok(attribution.theoreticalSafeFastBuildsAfterSkeletonReuse < attribution.safeFastMisses);
  assert.strictEqual(Number(dp.expansions), 116);

  process.stdout.write(JSON.stringify({
    schema: "motapathfinder.reachability-reuse-attribution-check.v1",
    status: "passed",
    controls: {
      productionCacheBehaviorUntouched: true,
      attributionDefaultOff: true,
      safeClassificationStillRunsPerExactMiss: true,
      normalizedClosureParity: attribution.closureMismatchGroupCount === 0,
      strictReplayVerified: execution.strictReplayVerified,
      pinnedWinnerRouteObjective: true,
    },
    workload: {
      id: "onlyup-mt1-exp9-candidate-default",
      effectiveProfile: execution.profileSelection.effectiveProfile,
      expansions: Number(dp.expansions),
      winnerExactFingerprint: exactStateFingerprint(winnerState),
      routeFingerprint: routeFingerprint.sha256,
      objectiveValue: execution.objectiveValue.value,
    },
    timing: {
      wallMs: Number(perf.wallMs.toFixed(2)),
      reachabilityMs: Number((perf.phaseMs.reachability || 0).toFixed(2)),
      reachabilityComputations: Number(perf.phaseCounts.reachability || 0),
      directionalOnly: true,
    },
    cacheStats,
    attribution,
    verdict: attribution.closureMismatchGroupCount === 0 && attribution.safeTopologyReusableMisses > 0
      ? "SAFE_FAST_SKELETON_REUSE_CANDIDATE"
      : "NO_REUSE_CANDIDATE",
  }, null, 2) + "\n");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  });
}

module.exports = { main };
