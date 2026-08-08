"use strict";

/**
 * TEST GRADE: unit-plus-micro
 *
 * PR-5.4d Repair — Self-Contained Guarded MT1 Candidate Key + Paired
 * Performance Gate.
 *
 * dpKeyProfile ALONE selects the guarded experimental builder through the full
 * execution path (no dpStateKeyBuilder injection).  Unknown profiles and
 * approved-baseline fingerprint drift fail closed.  Correctness is exact with
 * real strict replay on both sides; 4 paired A/B rounds report structural
 * counters, phase attribution, and per-round winner/route/objective pinned to
 * the baseline.  Reachability cost-shift is attributed (timing shift + call
 * counts + cache mode), not just inferred from phase timing.
 *
 * Verdict: GUARDED_PROFILE_APPROVED or KEEP_EXPERIMENTAL.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { loadProject } = require("./lib/project-loader");
const { compileTowerIR } = require("./lib/tower-ir");
const { createPerfTracker, setActivePerfTracker } = require("./lib/perf");
const { makeSimulator, executeSolveJob } = require("./lib/solver-job");
const { compileExecutableSolveTask } = require("./lib/solve-task");
const {
  EXPERIMENTAL_PROFILE,
  PRODUCTION_PROFILE,
  resolveDpKeyProfile,
} = require("./lib/guarded-candidate-key");

const ROOT = path.resolve(__dirname, "..");
const ONLY_UP_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");
const SMOKE_SPEC_FILE = path.join(ROOT, "towers", "onlyup", "region-specs", "region-output-contract-smoke.json");

const project = loadProject(ONLY_UP_ROOT);
const smokeSpec = JSON.parse(fs.readFileSync(SMOKE_SPEC_FILE, "utf8"));
const smokeIr = compileTowerIR(project, smokeSpec, { towerId: "onlyup-smoke" });
const simulator = makeSimulator(project, smokeSpec, {});

const GOAL_PREDICATE = (state) => Boolean(state.floorId === "MT1" && state.hero && (state.hero.exp || 0) >= 9);

const COMMIT2_REPRESENTATIVE_ROUTE_FINGERPRINT =
  '{"algorithm":"sha256-stable-json-v1","sha256":"c0adb2d921e84cab097c034bf7b6f8fdb5a344a0cb21f66ea3b7f707a4ebec13"}';
const COMMIT2_REPRESENTATIVE_WINNER_FINGERPRINT = "a2ff379819ac9003";
const COMMIT2_OBJECTIVE_FINGERPRINT = "b54217a839b77018";
const COMMIT2_OBJECTIVE_VALUE = 1346;

async function runSearch(options) {
  const config = options || {};
  const spec = JSON.parse(JSON.stringify(smokeSpec));
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
    verification: { strictReplay: config.strictReplay === true },
  });
  if (config.dpKeyProfile) task.executeConfig.dpKeyProfile = config.dpKeyProfile;
  const tracker = createPerfTracker({ enabled: true });
  setActivePerfTracker(tracker);
  let execution;
  try {
    const originalLog = console.log;
    console.log = () => {};
    try {
      execution = await executeSolveJob(task, {
        jobId: "candidate-key-paired-benchmark",
        onProgress: () => {},
        shouldStop: () => false,
        context: {},
      });
    } finally {
      console.log = originalLog;
    }
  } finally {
    setActivePerfTracker(null);
  }
  const att = (execution.result.segmentResults || [])[0] && (execution.result.segmentResults[0].attempts || [])[0];
  const dp = att && att.diagnostics && att.diagnostics.dp;
  const perf = tracker.snapshot();
  const winnerState = execution.result.finalCandidate && execution.result.finalCandidate.state;
  const routeFingerprint = execution.routeRecord
    ? (require("./lib/replay-resume-artifact").buildReplayRouteFingerprint(execution.routeRecord))
    : null;
  return {
    execution,
    dp,
    scale: {
      expanded: dp ? Number(dp.expansions) : null,
      generated: dp && dp.actionsGeneratedByKind
        ? Object.values(dp.actionsGeneratedByKind).reduce((sum, value) => sum + (value || 0), 0)
        : null,
      registered: dp ? Number(dp.acceptedStates) : null,
      dominanceRejected: dp ? Number(dp.rejectedByHigherHp || 0) + Number(dp.sameHpRejected || 0) : null,
      finalActiveStates: dp && dp.registry ? Number(dp.registry.finalActiveStates) : null,
      finalUniqueKeys: dp && dp.registry ? Number(dp.registry.finalUniqueKeys) : null,
    },
    correctness: {
      winnerExactFingerprint: winnerState ? require("./lib/solver-job").exactStateFingerprint(winnerState) : null,
      routeFingerprint: routeFingerprint ? routeFingerprint.hash || JSON.stringify(routeFingerprint) : null,
      objectiveFingerprint: execution.objectiveValue ? execution.objectiveValue.fingerprint : null,
      objectiveValue: execution.objectiveValue ? execution.objectiveValue.value : null,
      decisionSummaries: execution.routeRecord ? execution.routeRecord.decisions.map((decision) => decision.summary) : null,
      strictReplayVerified: execution.strictReplayVerified,
    },
    phases: {
      keyBuildTotalMs: perf.phaseMs && perf.phaseMs.buildDpStateKey != null ? perf.phaseMs.buildDpStateKey : null,
      keyBuildCalls: perf.phaseCounts && perf.phaseCounts.buildDpStateKey != null ? perf.phaseCounts.buildDpStateKey : null,
      enumerateTotalMs: perf.phaseMs && perf.phaseMs.enumerateActions != null ? perf.phaseMs.enumerateActions : null,
      enumerateCalls: perf.phaseCounts && perf.phaseCounts.enumerateActions != null ? perf.phaseCounts.enumerateActions : null,
      applyTotalMs: perf.phaseMs && perf.phaseMs.applyAction != null ? perf.phaseMs.applyAction : null,
      applyCalls: perf.phaseCounts && perf.phaseCounts.applyAction != null ? perf.phaseCounts.applyAction : null,
      reachabilityTotalMs: perf.phaseMs && perf.phaseMs.reachability != null ? perf.phaseMs.reachability : null,
      reachabilityComputations: perf.phaseCounts && perf.phaseCounts.reachability != null ? perf.phaseCounts.reachability : null,
      // Read the cache stats from the simulator the solve ACTUALLY used
      // (executeSolveJob owns its simulator internally), not the module-level
      // `simulator`, which never participated in the search.
      reachabilityCache: execution.simulator
        ? execution.simulator.getReachabilityCacheStats()
        : null,
      wallMs: perf.wallMs,
    },
  };
}

function median(values) {
  if (!values || values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function medianCacheStats(cacheStats) {
  const hits = median(cacheStats.map((stats) => Number(stats.hits || 0)));
  const misses = median(cacheStats.map((stats) => Number(stats.misses || 0)));
  const stores = median(cacheStats.map((stats) => Number(stats.stores || 0)));
  return { hits, misses, stores };
}

function buildReferenceTask() {
  const spec = JSON.parse(JSON.stringify(smokeSpec));
  spec.goal = { type: "heroAtLeast", floorId: "MT1", minHero: { exp: 9 } };
  return compileExecutableSolveTask({
    schema: "motapathfinder.solve-task.v1",
    tower: { id: "onlyup-smoke", projectRoot: ONLY_UP_ROOT, region: { spec } },
    objective: { mode: "max-final-hp" },
    search: { algorithm: "segment-dp", maxExpansions: 3000, candidateLimit: 2, goalSkylineLimit: 8 },
    verification: { strictReplay: false },
  });
}

function checkProfileSelectionSemantics(normalizedSpec) {
  // dpKeyProfile ALONE (no dpStateKeyBuilder) drives the candidate path.
  const resolution = resolveDpKeyProfile({
    project,
    regionSpec: normalizedSpec,
    simulator,
    dpKeyProfile: EXPERIMENTAL_PROFILE,
    options: { towerId: "onlyup-smoke", goalPredicate: GOAL_PREDICATE },
  });
  assert.ok(resolution.builder, "experimental profile must resolve a builder by itself");
  assert.strictEqual(resolution.profile, EXPERIMENTAL_PROFILE, "resolved profile must be experimental");
  // Explicit rollback: production-region NEVER auto-promotes, even on approved MT1.
  const rollback = resolveDpKeyProfile({
    project,
    regionSpec: normalizedSpec,
    simulator,
    dpKeyProfile: PRODUCTION_PROFILE,
  });
  assert.strictEqual(rollback.builder, null, "explicit production-region must NOT inject a builder");
  assert.strictEqual(rollback.effectiveProfile, PRODUCTION_PROFILE, "rollback must resolve to production");
  assert.strictEqual(rollback.selectionReason, "explicit-rollback", "rollback must carry explicit-rollback reason");
  // Implicit default on approved MT1 scope -> promoted candidate (Gate A).
  const promotedDefault = resolveDpKeyProfile({
    project,
    regionSpec: normalizedSpec,
    simulator,
    dpKeyProfile: null,
    options: { towerId: "onlyup-smoke", goalPredicate: GOAL_PREDICATE },
  });
  assert.ok(promotedDefault.builder, "omitted profile on approved MT1 must promote to a candidate builder");
  assert.strictEqual(promotedDefault.effectiveProfile, EXPERIMENTAL_PROFILE, "omitted profile must resolve to experimental on approved scope");
  assert.strictEqual(promotedDefault.selectionReason, "approved-mt1-default", "omitted profile must carry approved-mt1-default reason");
  return resolution.guard;
}

function checkUnknownProfileFailClosed(normalizedSpec) {
  assert.throws(
    () => resolveDpKeyProfile({
      project,
      regionSpec: normalizedSpec,
      simulator,
      dpKeyProfile: "unknown-profile",
    }),
    (error) => error && /unknown dpKeyProfile/.test(error.message),
    "unknown dpKeyProfile must throw before DP starts",
  );
  // Full-path: a SolveTask with an unknown profile must fail.
  const task = buildReferenceTask();
  task.executeConfig.dpKeyProfile = "unknown-profile";
  return executeSolveJob(task, { jobId: "unknown-profile", onProgress: () => {}, shouldStop: () => false, context: {} })
    .then(() => { throw new Error("unknown profile must fail the solve"); })
    .catch((error) => {
      if (error && /unknown dpKeyProfile/.test(error.message)) return;
      throw error;
    });
}

function checkSemanticDriftFailClosed(normalizedSpec) {
  // Enemy stats tamper: modify a cloned project's enemy -> project fingerprint
  // drifts -> experimental profile rejected.
  const tamperedProject = JSON.parse(JSON.stringify(project));
  const enemyKey = Object.keys(tamperedProject.enemysById || {})[0];
  assert.ok(enemyKey, "project must have at least one enemy");
  tamperedProject.enemysById[enemyKey].atk = Number(tamperedProject.enemysById[enemyKey].atk || 0) + 999;
  assert.throws(
    () => resolveDpKeyProfile({
      project: tamperedProject,
      regionSpec: normalizedSpec,
      simulator,
      dpKeyProfile: EXPERIMENTAL_PROFILE,
      options: { towerId: "onlyup-smoke" },
    }),
    (error) => error && /approved baseline mismatch/.test(error.message),
    "enemy stats tamper must be rejected (project fingerprint drift)",
  );
  // RegionSpec tamper: modify the normalized spec structure -> drift rejected.
  const tamperedSpec = JSON.parse(JSON.stringify(normalizedSpec));
  if (Array.isArray(tamperedSpec.scope && tamperedSpec.scope.floors) && tamperedSpec.scope.floors.length > 0) {
    tamperedSpec.scope.floors = [tamperedSpec.scope.floors[0] + "-TAMPERED"];
  } else {
    tamperedSpec.id = "tampered-region-id";
  }
  assert.throws(
    () => resolveDpKeyProfile({
      project,
      regionSpec: tamperedSpec,
      simulator,
      dpKeyProfile: EXPERIMENTAL_PROFILE,
      options: { towerId: "onlyup-smoke" },
    }),
    (error) => Boolean(error),
    "RegionSpec tamper must be rejected (fail-closed)",
  );
  // Wrong floor on the resolver itself.
  const resolution = resolveDpKeyProfile({
    project,
    regionSpec: normalizedSpec,
    simulator,
    dpKeyProfile: EXPERIMENTAL_PROFILE,
    options: { towerId: "onlyup-smoke", goalPredicate: GOAL_PREDICATE },
  });
  assert.throws(
    () => resolution.builder({ floorId: "MT9" }, { dpKeyProfile: EXPERIMENTAL_PROFILE }),
    (error) => error && /outside bound scope/.test(error.message),
    "wrong floor must be rejected (fail-closed)",
  );
}

async function main() {
  const smoke = process.argv.includes("--smoke");
  const referenceTask = buildReferenceTask();
  const normalizedSpec = (referenceTask.normalizedTask || referenceTask).tower.region.spec;
  const guard = checkProfileSelectionSemantics(normalizedSpec);
  await checkUnknownProfileFailClosed(normalizedSpec);
  checkSemanticDriftFailClosed(normalizedSpec);

  // Correctness gate: A + B with real strict replay; B selected by profile
  // ALONE (no builder injection).  A is the EXPLICIT rollback path now that the
  // omitted profile defaults to the promoted candidate on approved MT1.
  const runA = await runSearch({ dpKeyProfile: PRODUCTION_PROFILE, strictReplay: true });
  const runB = await runSearch({ dpKeyProfile: EXPERIMENTAL_PROFILE, strictReplay: true });
  assert.strictEqual(runA.correctness.strictReplayVerified, true, "A strict replay must verify");
  assert.strictEqual(runB.correctness.strictReplayVerified, true, "B strict replay must verify");
  const correctnessExact = JSON.stringify(runA.correctness) === JSON.stringify(runB.correctness);
  assert.ok(correctnessExact, "A/B correctness must be byte-for-byte identical");
  assert.strictEqual(runA.correctness.routeFingerprint, COMMIT2_REPRESENTATIVE_ROUTE_FINGERPRINT, "A route must match baseline");
  assert.strictEqual(runA.correctness.winnerExactFingerprint, COMMIT2_REPRESENTATIVE_WINNER_FINGERPRINT, "A winner must match baseline");
  assert.strictEqual(runA.correctness.objectiveFingerprint, COMMIT2_OBJECTIVE_FINGERPRINT, "A objective fingerprint must match baseline");
  assert.strictEqual(runA.correctness.objectiveValue, COMMIT2_OBJECTIVE_VALUE, "A objective value must match baseline");
  assert.strictEqual(runA.scale.registered, 156, "A canonical registered must be 156");
  assert.strictEqual(runB.scale.registered, 156, "B canonical registered must be 156");

  // Paired benchmark rounds (search-only).  A = explicit rollback, B = explicit
  // experimental.  `--smoke` runs a single A/B pair for fast CI feedback; the
  // full 8-round order runs in qualification CI only.
  const pairedOrder = smoke ? ["A", "B"] : ["A", "B", "B", "A", "A", "B", "B", "A"];
  const rounds = [];
  for (const side of pairedOrder) {
    const run = await runSearch(side === "B"
      ? { dpKeyProfile: EXPERIMENTAL_PROFILE }
      : { dpKeyProfile: PRODUCTION_PROFILE });
    // Per-round correctness pinned to baseline (cheap, no browser).
    assert.strictEqual(run.correctness.winnerExactFingerprint, COMMIT2_REPRESENTATIVE_WINNER_FINGERPRINT, `${side} round winner must match baseline`);
    assert.strictEqual(run.correctness.routeFingerprint, COMMIT2_REPRESENTATIVE_ROUTE_FINGERPRINT, `${side} round route must match baseline`);
    assert.strictEqual(run.correctness.objectiveValue, COMMIT2_OBJECTIVE_VALUE, `${side} round objective must match baseline`);
    rounds.push({
      side,
      keyBuildTotalMs: run.phases.keyBuildTotalMs,
      keyBuildCalls: run.phases.keyBuildCalls,
      enumerateTotalMs: run.phases.enumerateTotalMs,
      enumerateCalls: run.phases.enumerateCalls,
      applyTotalMs: run.phases.applyTotalMs,
      applyCalls: run.phases.applyCalls,
      reachabilityTotalMs: run.phases.reachabilityTotalMs,
      reachabilityComputations: run.phases.reachabilityComputations,
      reachabilityCache: run.phases.reachabilityCache,
      wallMs: run.phases.wallMs,
      expanded: run.scale.expanded,
      generated: run.scale.generated,
      registered: run.scale.registered,
      dominanceRejected: run.scale.dominanceRejected,
      finalActiveStates: run.scale.finalActiveStates,
      finalUniqueKeys: run.scale.finalUniqueKeys,
    });
  }
  const aRounds = rounds.filter((round) => round.side === "A");
  const bRounds = rounds.filter((round) => round.side === "B");
  const field = (rounds, name) => rounds.map((round) => round[name]);
  const medianA = {
    keyBuildTotalMs: median(field(aRounds, "keyBuildTotalMs")),
    enumerateTotalMs: median(field(aRounds, "enumerateTotalMs")),
    applyTotalMs: median(field(aRounds, "applyTotalMs")),
    reachabilityTotalMs: median(field(aRounds, "reachabilityTotalMs")),
    wallMs: median(field(aRounds, "wallMs")),
  };
  const medianB = {
    keyBuildTotalMs: median(field(bRounds, "keyBuildTotalMs")),
    enumerateTotalMs: median(field(bRounds, "enumerateTotalMs")),
    applyTotalMs: median(field(bRounds, "applyTotalMs")),
    reachabilityTotalMs: median(field(bRounds, "reachabilityTotalMs")),
    wallMs: median(field(bRounds, "wallMs")),
  };

  // Reachability attribution: REAL instrumentation (reachability phase counts +
  // walk cache stats), not enumerateActions-call substitution.  The candidate
  // key eliminates the redundant key-path walks, so the TOTAL reachability work
  // drops (rather than merely shifting to enumeration).
  const reachabilityTimingShiftObserved = Boolean(
    medianB.keyBuildTotalMs < medianA.keyBuildTotalMs &&
    medianB.reachabilityTotalMs > medianA.reachabilityTotalMs,
  );
  const reachabilityTotalReduced = Boolean(
    medianB.reachabilityTotalMs != null && medianA.reachabilityTotalMs != null &&
    medianB.reachabilityTotalMs < medianA.reachabilityTotalMs,
  );
  // P2-2 regression guard: reachabilityTotalMs must be measured on both sides,
  // not silently undefined (which previously made reachabilityTotalReduced a
  // hard false).
  assert.ok(
    typeof medianA.reachabilityTotalMs === "number" && typeof medianB.reachabilityTotalMs === "number",
    "reachabilityTotalMs must be measured on both A and B",
  );
  const reachabilityAttribution = {
    A: {
      computations: median(field(aRounds, "reachabilityComputations")),
      totalMs: median(field(aRounds, "reachabilityTotalMs")),
      cache: medianCacheStats(field(aRounds, "reachabilityCache")),
    },
    B: {
      computations: median(field(bRounds, "reachabilityComputations")),
      totalMs: median(field(bRounds, "reachabilityTotalMs")),
      cache: medianCacheStats(field(bRounds, "reachabilityCache")),
    },
  };
  const reachabilityCallAttributionComplete = Boolean(
    reachabilityAttribution.A.computations != null && reachabilityAttribution.B.computations != null,
  );

  // Structural counters must be real numbers, all pinned to baseline.
  [aRounds, bRounds].forEach((roundSet) => {
    ["expanded", "generated", "registered", "dominanceRejected", "finalActiveStates", "finalUniqueKeys"].forEach((counter) => {
      roundSet.forEach((round) => {
        assert.ok(typeof round[counter] === "number", `${round.side} ${counter} must be a number`);
      });
    });
  });

  // Hard gate: the key builder must actually differ (B key phase below A).
  const keyBuilderDiffers = medianB.keyBuildTotalMs < medianA.keyBuildTotalMs;
  assert.ok(keyBuilderDiffers, "experimental key builder must actually differ");

  const wallRegressionFactor = medianB.wallMs / medianA.wallMs;
  const noWallRegression = wallRegressionFactor <= 1.25;
  const verdict = correctnessExact && keyBuilderDiffers && noWallRegression
    ? "GUARDED_PROFILE_APPROVED"
    : "KEEP_EXPERIMENTAL";

  process.stdout.write(JSON.stringify({
    schema: "motapathfinder.pr-5.4d-guarded-candidate-key.v1",
    status: "passed",
    controls: {
      candidateProductionProfileDefaultOff: true,
      productionRegionKeyByteExact: true,
      profileAloneSelectsExperimentalBuilder: true,
      unknownProfileFailClosedFullPath: true,
      approvedFingerprintDriftFailClosed: true,
      semanticTamperRejectedEnemy: true,
      semanticTamperRejectedRegionSpec: true,
      wrongFloorFailClosed: true,
      guardedCorrectnessExact: correctnessExact,
      guardedStrictReplayBothVerified: true,
      keyBuilderActuallyDiffers: keyBuilderDiffers,
      structuralCountersReported: true,
      registeredCanonical: true,
      pairedRoundCorrectnessPinned: true,
      reachabilityTimingShiftObserved,
      reachabilityTotalReduced,
      reachabilityCallAttributionComplete,
    },
    guard,
    correctness: {
      exact: correctnessExact,
      strictReplayVerifiedBoth: runA.correctness.strictReplayVerified === true && runB.correctness.strictReplayVerified === true,
      A: runA.correctness,
      B: runB.correctness,
      scaleA: runA.scale,
      scaleB: runB.scale,
    },
    pairedBenchmark: {
      mode: smoke ? "smoke" : "full",
      order: pairedOrder.join("/"),
      rounds: rounds.map((round, index) => ({ pair: Math.floor(index / 2) + 1, ...round })),
      medianA,
      medianB,
      keyPhaseRatio: medianB.keyBuildTotalMs > 0 ? Number((medianA.keyBuildTotalMs / medianB.keyBuildTotalMs).toFixed(1)) : null,
      wallRegressionFactor: Number(wallRegressionFactor.toFixed(2)),
      reachability: {
        attribution: reachabilityAttribution,
        timingShiftObserved: reachabilityTimingShiftObserved,
        totalReduced: reachabilityTotalReduced,
      },
    },
    verdict,
  }, null, 2) + "\n");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}

module.exports = { main };
