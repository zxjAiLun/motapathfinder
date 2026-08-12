"use strict";

/**
 * TEST GRADE: real-fixture-performance-attribution
 *
 * PR-5.10a re-profiles the current production solver after the PR-5.9
 * reachability line closed.  It is observation-only: no key, dominance,
 * budget, milestone, action representation, or selection semantics change.
 *
 * Each workload runs in a fresh child process so peak memory and directional
 * wall time are not polluted by an earlier workload.  Deterministic search
 * scale and strict replay are correctness gates; wall time is not.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { strictReplayRoute } = require("./lib/agenda-policy-evaluation");
const { getMilestoneSpec } = require("./lib/milestone-spec");
const { createPerfTracker, setActivePerfTracker } = require("./lib/perf");
const { loadProject } = require("./lib/project-loader");
const { buildReplayRouteFingerprint } = require("./lib/replay-resume-artifact");
const { buildRouteRecord } = require("./lib/route-store");
const { compileExecutableSolveTask } = require("./lib/solve-task");
const { executeSolveJob, exactStateFingerprint } = require("./lib/solver-job");
const {
  collectResultParity,
} = require("./bench-perf-baseline");
const {
  MT4_START,
  MT5_START,
  MT8_TARGET,
  PROJECT_ROOT,
  ROUTE_NAME,
  runGraph,
  summarizeSegments,
  totalExpansions,
} = require("./check-post-mt5-long-chain-baseline");
const {
  makeSimulator,
  replayFixture,
} = require("./check-mt5-third-gate-resource-timing");
const {
  EXPECTED_SPECIAL80_FINGERPRINT,
  SPECIAL80,
} = require("./check-mt7-left-sword-budget-baseline");

const SAMPLE_PREFIX = "PR510_SAMPLE=";
const EXPECTED_MT5_EXPANSIONS = 645;
const EXPECTED_SPECIAL80_EXPANSIONS = 508;
const ROOT = path.resolve(__dirname, "..");
const MT1_SPEC_FILE = path.join(ROOT, "towers", "onlyup", "region-specs", "region-output-contract-smoke.json");
const ONLY_UP_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");

function cacheDelta(after, before) {
  return Object.keys(after || {}).reduce((result, key) => {
    result[key] = Number(after[key] || 0) - Number((before || {})[key] || 0);
    return result;
  }, {});
}

function perfSummary(perf, scale, reachabilityCache) {
  const phaseSelfMs = { ...(perf.phaseSelfMs || {}) };
  const phaseMs = { ...(perf.phaseMs || {}) };
  const phaseCounts = { ...(perf.phaseCounts || {}) };
  const rankedSelfPhases = Object.entries(phaseSelfMs)
    .map(([phase, ms]) => ({
      phase,
      ms: Number(ms),
      count: Number(phaseCounts[phase] || 0),
      shareOfWall: perf.wallMs > 0 ? Number(ms) / Number(perf.wallMs) : 0,
    }))
    .filter((entry) => entry.ms > 0)
    .sort((left, right) => right.ms - left.ms || left.phase.localeCompare(right.phase));
  const attributedSelfMs = rankedSelfPhases.reduce((sum, entry) => sum + entry.ms, 0);
  return {
    wallMs: Number(perf.wallMs),
    cpuUserMs: Number(perf.cpuUserMs),
    cpuSystemMs: Number(perf.cpuSystemMs),
    peakRssMb: Number(perf.peakRssMb),
    peakHeapUsedMb: Number(perf.peakHeapUsedMb),
    memorySampleCount: Number(perf.memorySampleCount || 0),
    scale,
    phaseMs,
    phaseSelfMs,
    phaseCounts,
    rankedSelfPhases,
    attributedSelfMs,
    unattributedWallMs: Math.max(0, Number(perf.wallMs) - attributedSelfMs),
    selfTimeCoverage: perf.wallMs > 0 ? attributedSelfMs / Number(perf.wallMs) : 0,
    reachabilityCache,
  };
}

function genericStrictReplay(project, initialState, result, profile, snapshotFloors) {
  assert.ok(result.finalCandidate && result.finalCandidate.state, `${profile}: final state`);
  const finalState = result.finalCandidate.state;
  const prefixLength = Array.isArray(initialState.route) ? initialState.route.length : 0;
  const fullRoute = Array.isArray(result.finalCandidate.route) ? result.finalCandidate.route : [];
  finalState.route = fullRoute.slice(prefixLength);
  const simulator = makeSimulator(project);
  const record = buildRouteRecord({
    project,
    simulator,
    initialState,
    finalState,
    options: {
      projectRoot: PROJECT_ROOT,
      solver: "full-solve-hotspot-reprofiling",
      profile,
      rank: "chaos",
      toFloor: finalState.floorId,
      goalType: "milestoneReached",
      snapshotFloors,
      metadata: {
        observationOnly: true,
        productionSearchSemanticsChanged: false,
      },
    },
  });
  const replay = strictReplayRoute(project, makeSimulator(project), record, {
    reuseResolvedPostState: true,
  });
  assert.strictEqual(replay.valid, true, replay.failureReason || `${profile}: strict replay`);
  assert.strictEqual(replay.stepsCompleted, replay.stepsAttempted);
  const fingerprint = buildReplayRouteFingerprint(record);
  return {
    valid: replay.valid,
    decisionCount: record.decisions.length,
    routeFingerprint: fingerprint.sha256 || fingerprint.hash || JSON.stringify(fingerprint),
    finalExactStateFingerprint: exactStateFingerprint(finalState),
  };
}

function summarizeProfileSegments(result) {
  return (result.segmentResults || []).map((segment) => ({
    id: segment.segmentId,
    found: Boolean(segment.found),
    attempts: (segment.attempts || []).map((attempt) => {
      const diagnostics = attempt.diagnostics || {};
      const dp = diagnostics.dp || {};
      const outcome = dp.searchOutcome || {};
      return {
        found: Boolean(attempt.found),
        expansions: Number(dp.expansions || 0),
        actionTrimmed: Number(diagnostics.actionTrimmed || dp.actionTrimmed || 0),
        frontierSize: Number(dp.frontierSize || 0),
        expansionBudgetExhausted: dp.expansionBudgetExhausted === true,
        goalFound: outcome.goalFound == null ? Boolean(attempt.found) : outcome.goalFound === true,
        frontierExhausted: outcome.frontierExhausted === true,
        budgetExhausted: outcome.budgetExhausted === true || dp.expansionBudgetExhausted === true,
        searchComplete: outcome.searchComplete === true,
        stoppedReason: dp.stoppedReason || null,
      };
    }),
  }));
}

function profileExpansionTotal(segments) {
  return segments.reduce(
    (sum, segment) => sum + segment.attempts.reduce(
      (attemptSum, attempt) => attemptSum + Number(attempt.expansions || 0),
      0,
    ),
    0,
  );
}

function profileGraph(project, initialState, fromMilestoneId, toMilestoneId, spec) {
  const simulator = makeSimulator(project);
  const cacheBefore = simulator.getReachabilityCacheStats();
  const tracker = createPerfTracker({ enabled: true });
  setActivePerfTracker(tracker);
  let result;
  try {
    result = runGraph(simulator, initialState, fromMilestoneId, toMilestoneId, spec);
  } finally {
    setActivePerfTracker(null);
  }
  const perf = tracker.snapshot();
  const segments = summarizeProfileSegments(result);
  return {
    result,
    segments,
    performance: perfSummary(
      perf,
      {
        attempts: segments.reduce((sum, segment) => sum + segment.attempts.length, 0),
        expansions: profileExpansionTotal(segments),
        segments: segments.length,
        goalFoundWithIncompleteSearch: segments.some((segment) => segment.attempts.some(
          (attempt) => attempt.goalFound && !attempt.searchComplete,
        )),
      },
      cacheDelta(simulator.getReachabilityCacheStats(), cacheBefore),
    ),
  };
}

async function sampleMt1() {
  const spec = JSON.parse(fs.readFileSync(MT1_SPEC_FILE, "utf8"));
  spec.goal = { type: "heroAtLeast", floorId: "MT1", minHero: { exp: 9 } };
  const task = compileExecutableSolveTask({
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
  // executeSolveJob performs runtime replay after search.  Profile the search
  // only by stopping the tracker as soon as the canonical result transitions
  // into route construction; strict replay still runs and remains a gate.
  const tracker = createPerfTracker({ enabled: true });
  let searchPerf = null;
  setActivePerfTracker(tracker);
  let execution;
  try {
    execution = await executeSolveJob(task, {
      jobId: "pr-5.10a-mt1",
      onProgress: (event) => {
        if (!searchPerf && event && event.phase === "route-build") {
          searchPerf = tracker.snapshot();
          setActivePerfTracker(null);
        }
      },
      shouldStop: () => false,
      context: {},
    });
  } finally {
    setActivePerfTracker(null);
  }
  const perf = searchPerf || tracker.snapshot();
  const parity = collectResultParity(execution, task);
  assert.strictEqual(parity.found, true);
  assert.strictEqual(parity.winnerExactFingerprint, "a2ff379819ac9003");
  assert.ok(execution.routeRecord, "MT1 route record");
  assert.strictEqual(execution.strictReplayVerified, true, "MT1 strict replay");
  return {
    id: "representative-mt1-exp9",
    kind: "canonical-segment-dp",
    correctness: {
      found: parity.found,
      winnerExactFingerprint: parity.winnerExactFingerprint,
      routeFingerprint: parity.routeFingerprint,
      strictReplayVerified: execution.strictReplayVerified,
    },
    performance: perfSummary(
      perf,
      {
        expansions: Number(perf.expanded || 0),
        generated: Number(perf.generated || 0),
        acceptedStates: Number(perf.registered || 0),
      },
      null,
    ),
  };
}

function sampleMt4Entry() {
  const harness = path.join(__dirname, "check-real-route-performance-qualification.js");
  const child = spawnSync(process.execPath, [
    harness,
    "--case=mt4-manual-to-mt5-entry",
    "--order=A",
  ], {
    cwd: __dirname,
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 32 * 1024 * 1024,
  });
  assert.strictEqual(child.status, 0, child.stderr || child.stdout);
  const report = JSON.parse(child.stdout);
  const run = report.results[0].runs[0];
  assert.strictEqual(run.found, true);
  assert.strictEqual(run.strictReplay.verified, true);
  assert.strictEqual(run.finalExactStateFingerprint, "c5ce3f54a7196bd2");
  const perf = run.performance;
  return {
    id: "tracked-mt4-to-mt5-entry",
    kind: "tracked-real-route-search",
    correctness: {
      found: run.found,
      winnerExactFingerprint: run.finalExactStateFingerprint,
      routeFingerprint: run.strictReplay.routeFingerprint,
      strictReplayVerified: run.strictReplay.verified,
    },
    performance: perfSummary(
      {
        ...perf,
        phaseSelfMs: perf.phaseSelfMs,
        phaseMs: perf.phaseMs,
        phaseCounts: perf.phaseCounts,
        cpuUserMs: 0,
        cpuSystemMs: 0,
        memorySampleCount: 0,
      },
      run.scale,
      perf.reachabilityCache,
    ),
  };
}

function sampleMt5Closure() {
  const project = loadProject(PROJECT_ROOT);
  const spec = getMilestoneSpec(project, ROUTE_NAME);
  const initialState = replayFixture(makeSimulator(project));
  const sample = profileGraph(project, initialState, MT4_START, MT5_START, spec);
  assert.strictEqual(sample.result.found, true);
  assert.strictEqual(sample.result.reachedMilestone, MT5_START);
  assert.strictEqual(sample.performance.scale.expansions, EXPECTED_MT5_EXPANSIONS);
  const replay = genericStrictReplay(
    project,
    initialState,
    sample.result,
    "tracked-mt4-to-mt5-closure",
    ["MT4", "MT5"],
  );
  return {
    id: "tracked-mt4-to-mt5-blueking",
    kind: "full-milestone-closure",
    correctness: {
      found: true,
      winnerExactFingerprint: replay.finalExactStateFingerprint,
      routeFingerprint: replay.routeFingerprint,
      strictReplayVerified: replay.valid,
    },
    performance: sample.performance,
  };
}

function sampleMt8Closure() {
  const project = loadProject(PROJECT_ROOT);
  const spec = getMilestoneSpec(project, ROUTE_NAME);
  const trackedInitialState = replayFixture(makeSimulator(project));
  const mt5 = runGraph(makeSimulator(project), trackedInitialState, MT4_START, MT5_START, spec);
  assert.strictEqual(mt5.found, true);
  assert.strictEqual(totalExpansions(summarizeSegments(mt5)), EXPECTED_MT5_EXPANSIONS);
  const postMt5State = mt5.finalCandidate.state;
  const special = runGraph(makeSimulator(project), postMt5State, MT5_START, SPECIAL80, spec);
  assert.strictEqual(special.found, true);
  assert.strictEqual(totalExpansions(summarizeSegments(special)), EXPECTED_SPECIAL80_EXPANSIONS);
  const specialState = special.finalCandidate.state;
  assert.strictEqual(exactStateFingerprint(specialState), EXPECTED_SPECIAL80_FINGERPRINT);
  const sample = profileGraph(project, specialState, SPECIAL80, MT8_TARGET, spec);
  assert.strictEqual(sample.result.found, true);
  assert.strictEqual(sample.result.reachedMilestone, MT8_TARGET);
  const replay = genericStrictReplay(
    project,
    specialState,
    sample.result,
    "special80-to-mt8-closure",
    ["MT6", "MT7", "MT8"],
  );
  return {
    id: "special80-to-mt8-entry",
    kind: "full-milestone-closure",
    correctness: {
      found: true,
      winnerExactFingerprint: replay.finalExactStateFingerprint,
      routeFingerprint: replay.routeFingerprint,
      strictReplayVerified: replay.valid,
    },
    performance: sample.performance,
  };
}

async function runChildSample(id) {
  if (id === "mt1") return sampleMt1();
  if (id === "mt4-entry") return sampleMt4Entry();
  if (id === "mt5-closure") return sampleMt5Closure();
  if (id === "mt8-closure") return sampleMt8Closure();
  throw new Error(`unknown PR-5.10a sample: ${id}`);
}

function spawnSample(id) {
  const child = spawnSync(process.execPath, [__filename, `--sample=${id}`], {
    cwd: __dirname,
    encoding: "utf8",
    timeout: 900000,
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.strictEqual(child.status, 0, `${id}: ${child.stderr || child.stdout}`);
  const line = child.stdout.split(/\r?\n/).find((entry) => entry.startsWith(SAMPLE_PREFIX));
  assert.ok(line, `${id}: missing sample payload`);
  return JSON.parse(line.slice(SAMPLE_PREFIX.length));
}

function assertPerfContract(sample) {
  assert.strictEqual(sample.correctness.found, true, `${sample.id}: found`);
  assert.strictEqual(sample.correctness.strictReplayVerified, true, `${sample.id}: strict replay`);
  assert.ok(sample.correctness.winnerExactFingerprint, `${sample.id}: exact winner`);
  assert.ok(sample.correctness.routeFingerprint, `${sample.id}: route fingerprint`);
  const perf = sample.performance;
  assert.ok(perf.wallMs > 0, `${sample.id}: wall`);
  assert.ok(perf.peakRssMb > 0 && perf.peakHeapUsedMb > 0, `${sample.id}: peak memory`);
  ["cloneState", "reachability", "buildDpStateKey", "enumerateActions", "applyAction", "sortActions"]
    .forEach((phase) => {
      assert.strictEqual(typeof perf.phaseMs[phase], "number", `${sample.id}: inclusive ${phase}`);
      assert.strictEqual(typeof perf.phaseSelfMs[phase], "number", `${sample.id}: self ${phase}`);
      assert.ok(
        perf.phaseMs[phase] + 1e-6 >= perf.phaseSelfMs[phase],
        `${sample.id}: inclusive ${phase} must cover self time`,
      );
    });
  assert.ok(perf.attributedSelfMs <= perf.wallMs * 1.05, `${sample.id}: self time double counted`);
  assert.ok(perf.rankedSelfPhases[0], `${sample.id}: ranked self phase`);
}

async function main() {
  const sampleArg = process.argv.find((arg) => arg.startsWith("--sample="));
  if (sampleArg) {
    const sample = await runChildSample(sampleArg.slice("--sample=".length));
    process.stdout.write(`${SAMPLE_PREFIX}${JSON.stringify(sample)}\n`);
    return;
  }

  const samples = ["mt1", "mt4-entry", "mt5-closure", "mt8-closure"].map(spawnSample);
  samples.forEach(assertPerfContract);
  const byId = Object.fromEntries(samples.map((sample) => [sample.id, sample]));
  assert.deepStrictEqual(byId["representative-mt1-exp9"].performance.scale, {
    expansions: 116,
    generated: 267,
    acceptedStates: 156,
  });
  assert.strictEqual(byId["tracked-mt4-to-mt5-entry"].performance.scale.expanded, 319);
  assert.strictEqual(byId["tracked-mt4-to-mt5-blueking"].performance.scale.expansions, 645);
  assert.strictEqual(byId["special80-to-mt8-entry"].performance.scale.expansions, 5634);
  const mt8Sample = samples.find((sample) => sample.id === "special80-to-mt8-entry");
  assert.strictEqual(mt8Sample.performance.scale.goalFoundWithIncompleteSearch, true);
  assert.ok(Number(mt8Sample.performance.reachabilityCache.legacyExactBuilds) > 0);
  assert.ok(Number(mt8Sample.performance.reachabilityCache.stateClones) > 100000);
  const aggregateByPhase = {};
  samples.forEach((sample) => {
    Object.entries(sample.performance.phaseSelfMs).forEach(([phase, ms]) => {
      aggregateByPhase[phase] = Number(aggregateByPhase[phase] || 0) + Number(ms || 0);
    });
  });
  const aggregateRank = Object.entries(aggregateByPhase)
    .map(([phase, ms]) => ({ phase, ms }))
    .sort((left, right) => right.ms - left.ms || left.phase.localeCompare(right.phase));
  assert.ok(aggregateRank.length > 0, "aggregate phase rank");
  const cloneCalls = samples.reduce(
    (sum, sample) => sum + Number(sample.performance.phaseCounts.cloneState || 0),
    0,
  );
  const actionCalls = samples.reduce(
    (sum, sample) => sum + Number(sample.performance.phaseCounts.applyAction || 0),
    0,
  );

  process.stdout.write(`${JSON.stringify({
    schema: "motapathfinder.full-solve-hotspot-reprofiling.v1",
    status: "passed",
    controls: {
      observationOnly: true,
      productionSearchSemanticsChanged: false,
      independentProcessPerWorkload: true,
      inclusivePhaseCompatibilityPreserved: true,
      exclusiveSelfTimePreventsNestedDoubleCount: true,
      unattributedResidualReported: true,
      deterministicScaleGated: true,
      strictReplayEveryWorkload: true,
      wallTimingDirectionalOnly: true,
      goalFoundSeparatedFromSearchComplete: true,
      representationRepairNotAuthorized: true,
    },
    samples,
    aggregate: {
      rankedSelfPhases: aggregateRank,
      cloneStateCalls: cloneCalls,
      applyActionCalls: actionCalls,
      topHotspotByWorkload: Object.fromEntries(samples.map((sample) => [
        sample.id,
        sample.performance.rankedSelfPhases[0].phase,
      ])),
      allocationProxy: "cloneState call count plus isolated-process peak heap/RSS; no byte-allocation claim",
    },
    conclusion: {
      verdict: "HOTSPOT_SPLIT_BY_WORKLOAD_SCALE",
      reachabilityLineRemainsClosed: true,
      nextStep: "attribute short/medium applyAction self time and MT8 legacy-exact reachability plus clone amplification as separate causal branches before authorizing a repair",
      forbiddenInference: "self-time ranking does not authorize CompactState, Rust, action representation, key, dominance, selection, or budget changes",
    },
  }, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}

module.exports = { main };
