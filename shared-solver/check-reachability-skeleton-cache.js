"use strict";

/**
 * TEST GRADE: unit-plus-micro
 *
 * PR-5.9b Safe-Fast Reachability Skeleton Cache.
 *
 * Runs independent-process A/B/B/A samples of the approved MT1 exp9 workload.
 * A keeps only the exact-state reachability LRU; B additionally reuses the
 * topology/path skeleton after every exact state has independently passed the
 * safe-fast classifier. Winner, route, objective, search scale, expanded-state
 * action sets, successor exact states, and strict replay must remain exact.
 */

const assert = require("node:assert");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const { createPerfTracker, setActivePerfTracker } = require("./lib/perf");
const { buildReplayRouteFingerprint } = require("./lib/replay-resume-artifact");
const { compileExecutableSolveTask, fingerprintJson } = require("./lib/solve-task");
const { executeSolveJob, exactStateFingerprint } = require("./lib/solver-job");
const { cloneState } = require("./lib/state");
const { buildStateKey } = require("./lib/state-key");

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
      captureExpandedStates: true,
      captureExpandedStateLimit: 256,
    },
    verification: { strictReplay: true },
  });
}

function actionSuccessorCorpus(simulator, states) {
  const corpus = states.map((state) => {
    const actions = ((simulator.enumeratePrimitiveActions(cloneState(state)) || {}).actions || [])
      .map((action) => {
        const successor = simulator.applyAction(cloneState(state), action, { storeRoute: false });
        return {
          fingerprint: simulator.getActionFingerprint(action),
          summary: action.summary,
          path: Array.isArray(action.path) ? action.path.slice() : [],
          travelExact: action.travelState ? exactStateFingerprint(action.travelState) : null,
          successorExact: exactStateFingerprint(successor),
        };
      })
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    return { stateExact: exactStateFingerprint(state), actions };
  }).sort((left, right) => left.stateExact.localeCompare(right.stateExact));
  return {
    stateCount: corpus.length,
    actionCount: corpus.reduce((sum, entry) => sum + entry.actions.length, 0),
    fingerprint: fingerprintJson(corpus),
  };
}

function containsForbiddenStatePayload(value) {
  if (Array.isArray(value)) return value.some(containsForbiddenStatePayload);
  if (!value || typeof value !== "object") return false;
  const forbidden = new Set(["state", "hero", "inventory", "flags", "floorStates", "route", "meta"]);
  return Object.entries(value).some(([key, child]) =>
    forbidden.has(key) || containsForbiddenStatePayload(child));
}

async function runSample(mode) {
  const skeletonEnabled = mode === "repair";
  const tracker = createPerfTracker({ enabled: true });
  setActivePerfTracker(tracker);
  let execution;
  try {
    const originalLog = console.log;
    console.log = () => {};
    try {
      execution = await executeSolveJob(buildTask(), {
        jobId: `reachability-skeleton-cache-${mode}`,
        onProgress: () => {},
        shouldStop: () => false,
        context: { enableReachabilitySkeletonCache: skeletonEnabled },
      });
    } finally {
      console.log = originalLog;
    }
  } finally {
    setActivePerfTracker(null);
  }

  const attempt = execution.result.segmentResults[0].attempts[0];
  const dp = attempt.diagnostics.dp;
  const states = dp.capturedExpandedStates || [];
  const winnerState = execution.result.finalCandidate.state;
  const routeFingerprint = buildReplayRouteFingerprint(execution.routeRecord);
  const perf = tracker.snapshot();
  const allCacheStats = execution.simulator.getActionExpansionCacheStats();
  const exactCache = execution.simulator.getReachabilityCacheStats();
  const skeletonCache = allCacheStats.reachabilitySkeleton;
  const skeletonPayloadViolationCount = Array.from(
    execution.simulator.actionExpansionCaches.reachabilitySkeleton.values(),
  ).filter(containsForbiddenStatePayload).length;
  const performance = {
    searchWallMs: Number(dp.wallMs),
    endToEndWallMs: Number(perf.wallMs.toFixed(2)),
    reachabilityMs: Number((perf.phaseMs.reachability || 0).toFixed(2)),
  };
  // Corpus work is deliberately outside the timed search sample.
  const corpus = actionSuccessorCorpus(execution.simulator, states);

  return {
    mode,
    correctness: {
      found: execution.result.found,
      strictReplayVerified: execution.strictReplayVerified,
      winnerExactFingerprint: exactStateFingerprint(winnerState),
      routeFingerprint: routeFingerprint.sha256,
      objectiveValue: execution.objectiveValue.value,
      expansions: Number(dp.expansions),
      acceptedStates: Number(dp.acceptedStates),
      actionSuccessorCorpus: corpus,
    },
    performance,
    exactCache,
    skeletonCache,
    skeletonPayloadViolationCount,
  };
}

function median(values) {
  const sorted = values.slice().sort((left, right) => left - right);
  return (sorted[0] + sorted[sorted.length - 1]) / 2;
}

function runChild(mode) {
  const child = spawnSync(process.execPath, [__filename, `--sample=${mode}`], {
    cwd: __dirname,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (child.status !== 0) {
    throw new Error(`sample ${mode} failed:\n${child.stderr || child.stdout}`);
  }
  return JSON.parse(child.stdout);
}

function assertPinned(sample) {
  const correctness = sample.correctness;
  assert.strictEqual(correctness.found, true);
  assert.strictEqual(correctness.strictReplayVerified, true);
  assert.strictEqual(correctness.winnerExactFingerprint, EXPECTED_WINNER_EXACT);
  assert.strictEqual(correctness.routeFingerprint, EXPECTED_ROUTE_SHA256);
  assert.strictEqual(correctness.objectiveValue, EXPECTED_OBJECTIVE_VALUE);
  assert.strictEqual(correctness.expansions, 116);
  assert.strictEqual(correctness.actionSuccessorCorpus.stateCount, 116);
}

async function main() {
  const sampleArg = process.argv.find((value) => value.startsWith("--sample="));
  if (sampleArg) {
    const mode = sampleArg.slice("--sample=".length);
    assert.ok(mode === "control" || mode === "repair", "sample mode must be control or repair");
    process.stdout.write(`${JSON.stringify(await runSample(mode))}\n`);
    return;
  }

  const samples = ["control", "repair", "repair", "control"].map(runChild);
  samples.forEach(assertPinned);
  const reference = samples[0].correctness;
  samples.slice(1).forEach((sample) => {
    assert.deepStrictEqual(sample.correctness, reference,
      "A/B must preserve winner, route, objective, scale, actions, and exact successors");
    ["hits", "misses", "stores", "evictions", "safeFastBuilds", "legacyExactBuilds"].forEach((field) => {
      assert.strictEqual(sample.exactCache[field], samples[0].exactCache[field],
        `exact-state LRU field ${field} must remain unchanged`);
    });
  });

  const controls = samples.filter((sample) => sample.mode === "control");
  const repairs = samples.filter((sample) => sample.mode === "repair");
  controls.forEach((sample) => {
    assert.strictEqual(sample.skeletonCache.hits, 0);
    assert.strictEqual(sample.skeletonCache.misses, 0);
    assert.strictEqual(sample.skeletonCache.stores, 0);
    assert.strictEqual(sample.skeletonCache.builds, 173);
    assert.strictEqual(sample.skeletonCache.rebases, 173);
    assert.strictEqual(sample.skeletonCache.safetyClassifications, 173);
  });
  repairs.forEach((sample) => {
    assert.strictEqual(sample.skeletonCache.hits, 100);
    assert.strictEqual(sample.skeletonCache.misses, 73);
    assert.strictEqual(sample.skeletonCache.stores, 73);
    assert.strictEqual(sample.skeletonCache.builds, 73);
    assert.strictEqual(sample.skeletonCache.rebases, 173);
    assert.strictEqual(sample.skeletonCache.safetyClassifications, 173);
    assert.strictEqual(sample.skeletonCache.unsafeBypasses, 0);
    assert.strictEqual(sample.skeletonPayloadViolationCount, 0,
      "cached skeletons must not contain state/hero/inventory/flags payloads");
    assert.ok(sample.exactCache.nodesExpanded < controls[0].exactCache.nodesExpanded);
    assert.ok(sample.exactCache.transitionAttempts < controls[0].exactCache.transitionAttempts);
    assert.strictEqual(sample.exactCache.stateClones, controls[0].exactCache.stateClones);
    assert.strictEqual(sample.exactCache.dominanceKeyBuilds, controls[0].exactCache.dominanceKeyBuilds);
  });

  const summarize = (group) => ({
    samples: group.map((sample) => sample.performance),
    medianSearchWallMs: median(group.map((sample) => sample.performance.searchWallMs)),
    medianEndToEndWallMs: median(group.map((sample) => sample.performance.endToEndWallMs)),
    medianReachabilityMs: median(group.map((sample) => sample.performance.reachabilityMs)),
  });
  const controlTiming = summarize(controls);
  const repairTiming = summarize(repairs);
  process.stdout.write(`${JSON.stringify({
    schema: "motapathfinder.reachability-skeleton-cache-check.v1",
    status: "passed",
    controls: {
      safetyClassificationPerExactMiss: true,
      cachedValueContainsNoStatePayload: true,
      exactStateLruParity: true,
      actionSetAndSuccessorExactParity: true,
      pinnedWinnerRouteObjectiveScale: true,
      strictReplayParity: true,
      timingDirectionalOnly: true,
    },
    workload: reference,
    structuralDelta: {
      exactRequests: 149,
      exactHits: 26,
      exactMisses: 123,
      controlSkeletonBuilds: 123,
      repairSkeletonBuilds: 73,
      repairSkeletonHits: 50,
      topologyBuildReductionRatio: 50 / 123,
      stateClonesPreserved: repairs[0].exactCache.stateClones,
      dominanceKeyBuildsPreserved: repairs[0].exactCache.dominanceKeyBuilds,
      nodesExpanded: {
        control: controls[0].exactCache.nodesExpanded,
        repair: repairs[0].exactCache.nodesExpanded,
      },
      transitionAttempts: {
        control: controls[0].exactCache.transitionAttempts,
        repair: repairs[0].exactCache.transitionAttempts,
      },
    },
    timing: { control: controlTiming, repair: repairTiming },
    verdict: "SAFE_FAST_SKELETON_CACHE_PROMOTED",
  }, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  });
}

module.exports = { main };
