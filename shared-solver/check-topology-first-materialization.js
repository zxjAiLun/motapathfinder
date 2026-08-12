"use strict";

/**
 * TEST GRADE: unit-plus-micro
 *
 * PR-5.9d Topology-First Travel-State Materialization.
 *
 * Runs the approved MT1 exp9 workload in independent control/repair processes.
 * The control preserves PR-5.9c eager rebase; repair keeps safe-fast skeleton
 * nodes topology-only and materializes current-state travel nodes on demand.
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

const ROOT = path.resolve(__dirname, "..");
const ONLY_UP_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");
const SMOKE_SPEC_FILE = path.join(ROOT, "towers", "onlyup", "region-specs", "region-output-contract-smoke.json");
const EXPECTED_WINNER_EXACT = "a2ff379819ac9003";
const EXPECTED_ROUTE_SHA256 = "c0adb2d921e84cab097c034bf7b6f8fdb5a344a0cb21f66ea3b7f707a4ebec13";
const EXPECTED_OBJECTIVE_VALUE = 1346;
const EXPECTED_CORPUS = "2ac91e5d1ce0aed2";

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
      .map((action) => ({
        fingerprint: simulator.getActionFingerprint(action),
        summary: action.summary,
        path: Array.isArray(action.path) ? action.path.slice() : [],
        travelExact: action.travelState ? exactStateFingerprint(action.travelState) : null,
        successorExact: exactStateFingerprint(simulator.applyAction(cloneState(state), action, { storeRoute: false })),
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    return { stateExact: exactStateFingerprint(state), actions };
  }).sort((left, right) => left.stateExact.localeCompare(right.stateExact));
  return {
    stateCount: corpus.length,
    actionCount: corpus.reduce((sum, entry) => sum + entry.actions.length, 0),
    fingerprint: fingerprintJson(corpus),
  };
}

async function runSample(mode) {
  const repair = mode === "repair";
  const tracker = createPerfTracker({ enabled: true });
  setActivePerfTracker(tracker);
  let execution;
  try {
    const originalLog = console.log;
    console.log = () => {};
    try {
      execution = await executeSolveJob(buildTask(), {
        jobId: `topology-first-materialization-${mode}`,
        onProgress: () => {},
        shouldStop: () => false,
        context: {
          reachabilityRebaseAttribution: true,
          enableReachabilitySkeletonCache: true,
          enableTopologyFirstMaterialization: repair,
        },
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
  const correctness = {
    found: execution.result.found,
    strictReplayVerified: execution.strictReplayVerified,
    winnerExactFingerprint: exactStateFingerprint(winnerState),
    routeFingerprint: routeFingerprint.sha256,
    objectiveValue: execution.objectiveValue.value,
    expansions: Number(dp.expansions),
    acceptedStates: Number(dp.acceptedStates),
  };
  const performance = {
    searchWallMs: Number(dp.wallMs),
    endToEndWallMs: Number(perf.wallMs.toFixed(2)),
    reachabilityMs: Number((perf.phaseMs.reachability || 0).toFixed(2)),
    enumerateActionsMs: Number((perf.phaseMs.enumerateActions || 0).toFixed(2)),
  };
  const searchAttribution = execution.simulator.getReachabilityRebaseAttribution();
  const searchCache = execution.simulator.getReachabilityCacheStats();
  const skeletonCache = execution.simulator.getActionExpansionCacheStats().reachabilitySkeleton;
  const corpus = actionSuccessorCorpus(execution.simulator, states);

  return { mode, correctness, corpus, performance, searchAttribution, searchCache, skeletonCache };
}

function runChild(mode) {
  const child = spawnSync(process.execPath, [__filename, `--sample=${mode}`], {
    cwd: __dirname,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (child.status !== 0) throw new Error(`sample ${mode} failed:\n${child.stderr || child.stdout}`);
  return JSON.parse(child.stdout);
}

function median(values) {
  const sorted = values.slice().sort((left, right) => left - right);
  return (sorted[0] + sorted[sorted.length - 1]) / 2;
}

function assertPinned(sample) {
  assert.deepStrictEqual(sample.correctness, {
    found: true,
    strictReplayVerified: true,
    winnerExactFingerprint: EXPECTED_WINNER_EXACT,
    routeFingerprint: EXPECTED_ROUTE_SHA256,
    objectiveValue: EXPECTED_OBJECTIVE_VALUE,
    expansions: 116,
    acceptedStates: 156,
  });
  assert.deepStrictEqual(sample.corpus, {
    stateCount: 116,
    actionCount: 434,
    fingerprint: EXPECTED_CORPUS,
  });
}

async function main() {
  const sampleArg = process.argv.find((value) => value.startsWith("--sample="));
  if (sampleArg) {
    const mode = sampleArg.slice("--sample=".length);
    assert.ok(mode === "control" || mode === "repair");
    process.stdout.write(`${JSON.stringify(await runSample(mode))}\n`);
    return;
  }

  const samples = ["control", "repair", "repair", "control"].map(runChild);
  samples.forEach(assertPinned);
  const controls = samples.filter((sample) => sample.mode === "control");
  const repairs = samples.filter((sample) => sample.mode === "repair");
  const reference = samples[0];
  samples.slice(1).forEach((sample) => {
    assert.deepStrictEqual(sample.correctness, reference.correctness);
    assert.deepStrictEqual(sample.corpus, reference.corpus);
  });
  controls.forEach((sample) => {
    assert.strictEqual(sample.searchAttribution.materializedNodes, 6526);
    assert.strictEqual(sample.searchAttribution.dominanceKeyBuilds, 6526);
    assert.strictEqual(sample.searchCache.stateClones, 6649);
  });
  repairs.forEach((sample) => {
    assert.strictEqual(sample.searchAttribution.topologyFirstRebases, 123);
    assert.strictEqual(sample.searchAttribution.topologyNodes, 6526);
    assert.ok(sample.searchAttribution.materializedNodes < 1000);
    assert.strictEqual(sample.searchAttribution.dominanceKeyBuilds, 0);
    assert.strictEqual(sample.searchCache.stateClones,
      sample.searchAttribution.materializedNodes + 123);
    assert.strictEqual(sample.searchCache.dominanceKeyBuilds, 0);
    assert.strictEqual(sample.skeletonCache.nodesRebased, 6526);
    assert.strictEqual(sample.skeletonCache.nodesMaterialized, sample.searchAttribution.materializedNodes);
    assert.ok(!Object.prototype.hasOwnProperty.call(sample.searchAttribution.consumers, "unscoped"));
  });

  const timing = (group) => ({
    samples: group.map((sample) => sample.performance),
    medianSearchWallMs: median(group.map((sample) => sample.performance.searchWallMs)),
    medianEndToEndWallMs: median(group.map((sample) => sample.performance.endToEndWallMs)),
    medianReachabilityMs: median(group.map((sample) => sample.performance.reachabilityMs)),
    medianEnumerateActionsMs: median(group.map((sample) => sample.performance.enumerateActionsMs)),
  });
  const controlAttribution = controls[0].searchAttribution;
  const repairAttribution = repairs[0].searchAttribution;
  process.stdout.write(`${JSON.stringify({
    schema: "motapathfinder.topology-first-materialization-check.v1",
    status: "passed",
    controls: {
      legacyExactPathUnchanged: true,
      safetyClassificationPerExactMiss: true,
      actionSuccessorExactParity: true,
      winnerRouteObjectiveScalePinned: true,
      strictReplayParity: true,
      timingDirectionalOnly: true,
    },
    workload: reference.correctness,
    corpus: reference.corpus,
    structuralDelta: {
      topologyNodes: repairAttribution.topologyNodes,
      materializedNodes: {
        control: controlAttribution.materializedNodes,
        repair: repairAttribution.materializedNodes,
      },
      stateClones: {
        control: controls[0].searchCache.stateClones,
        repair: repairs[0].searchCache.stateClones,
      },
      dominanceKeyBuilds: {
        control: controlAttribution.dominanceKeyBuilds,
        repair: repairAttribution.dominanceKeyBuilds,
      },
      repairConsumers: repairAttribution.consumers,
    },
    timing: { control: timing(controls), repair: timing(repairs) },
    verdict: "TOPOLOGY_FIRST_MATERIALIZATION_PROMOTED",
  }, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  });
}

module.exports = { main };
