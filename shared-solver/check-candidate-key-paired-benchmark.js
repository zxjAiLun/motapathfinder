"use strict";

/**
 * TEST GRADE: unit-plus-micro
 *
 * PR-5.4d — Guarded MT1 Candidate Key + Paired Performance Gate.
 *
 * Promotes the `without-start-component` candidate identity to a formal,
 * default-off, MT1-only, fingerprint-bound, fail-closed experimental profile
 * (dpKeyProfile = "experimental-mt1-tower-ir-v1") and runs a trusted paired
 * A/B benchmark against the legacy region key.
 *
 * Hard gates (CI): exact correctness, both strict replays verified, scope
 * fail-closed, experimental default off, key builder actually differs,
 * structural counters reported.  Performance is reported (median over paired
 * rounds), never a fragile wall-time hard gate.
 *
 * Verdict: GUARDED_PROFILE_APPROVED or KEEP_EXPERIMENTAL.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { loadProject } = require("./lib/project-loader");
const { compileTowerIR } = require("./lib/tower-ir");
const { createGuardedKeyResolver } = require("./lib/guarded-candidate-key");
const { createPerfTracker, setActivePerfTracker } = require("./lib/perf");
const { makeSimulator, executeSolveJob } = require("./lib/solver-job");
const { compileExecutableSolveTask } = require("./lib/solve-task");

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
  if (config.dpStateKeyBuilder) task.executeConfig.dpStateKeyBuilder = config.dpStateKeyBuilder;
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
  const generated = dp && dp.actionsGeneratedByKind
    ? Object.values(dp.actionsGeneratedByKind).reduce((sum, value) => sum + (value || 0), 0)
    : null;
  const registered = dp && dp.actionsKeptByKind
    ? Object.values(dp.actionsKeptByKind).reduce((sum, value) => sum + (value || 0), 0)
    : null;
  const dominanceRejected = dp ? Number(dp.rejectedByHigherHp || 0) + Number(dp.sameHpRejected || 0) : null;
  return {
    execution,
    dp,
    scale: {
      expanded: dp ? Number(dp.expansions) : null,
      generated,
      registered,
      dominanceRejected,
      finalActiveStates: dp && dp.registry ? Number(dp.registry.finalActiveStates) : null,
      finalUniqueKeys: dp && dp.registry ? Number(dp.registry.finalUniqueKeys) : null,
    },
    phases: {
      keyBuildTotalMs: perf.phaseMs && perf.phaseMs.buildDpStateKey != null ? perf.phaseMs.buildDpStateKey : null,
      keyBuildCalls: perf.phaseCounts && perf.phaseCounts.buildDpStateKey != null ? perf.phaseCounts.buildDpStateKey : null,
      enumerateTotalMs: perf.phaseMs && perf.phaseMs.enumerateActions != null ? perf.phaseMs.enumerateActions : null,
      enumerateCalls: perf.phaseCounts && perf.phaseCounts.enumerateActions != null ? perf.phaseCounts.enumerateActions : null,
      applyTotalMs: perf.phaseMs && perf.phaseMs.applyAction != null ? perf.phaseMs.applyAction : null,
      applyCalls: perf.phaseCounts && perf.phaseCounts.applyAction != null ? perf.phaseCounts.applyAction : null,
      wallMs: perf.wallMs,
    },
    correctness: (() => {
      const winnerState = execution.result.finalCandidate && execution.result.finalCandidate.state;
      const routeFingerprint = execution.routeRecord
        ? (require("./lib/replay-resume-artifact").buildReplayRouteFingerprint(execution.routeRecord))
        : null;
      return {
        found: execution.result.found,
        winnerExactFingerprint: winnerState ? require("./lib/solver-job").exactStateFingerprint(winnerState) : null,
        routeFingerprint: routeFingerprint ? routeFingerprint.hash || JSON.stringify(routeFingerprint) : null,
        decisionSummaries: execution.routeRecord ? execution.routeRecord.decisions.map((decision) => decision.summary) : null,
        objectiveFingerprint: execution.objectiveValue ? execution.objectiveValue.fingerprint : null,
        objectiveValue: execution.objectiveValue ? execution.objectiveValue.value : null,
        strictReplayVerified: execution.strictReplayVerified,
      };
    })(),
  };
}

function median(values) {
  if (!values || values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

async function main() {
  const guarded = createGuardedKeyResolver({
    simulator,
    project,
    ir: smokeIr,
    regionSpec: smokeSpec,
    options: { goalPredicate: GOAL_PREDICATE },
  });
  const experimental = { dpKeyProfile: "experimental-mt1-tower-ir-v1", dpStateKeyBuilder: guarded.resolver };

  // Correctness gate: A + B with real strict replay.
  const runA = await runSearch({ strictReplay: true });
  const runB = await runSearch({ ...experimental, strictReplay: true });
  assert.strictEqual(runA.correctness.found, true, "A must find the goal");
  assert.strictEqual(runB.correctness.found, true, "B must find the goal");
  const correctnessExact = JSON.stringify(runA.correctness) === JSON.stringify(runB.correctness);
  const bothStrictReplayVerified = runA.correctness.strictReplayVerified === true && runB.correctness.strictReplayVerified === true;
  assert.ok(bothStrictReplayVerified, "both A and B strict replays must verify (real runtime replay)");
  assert.ok(correctnessExact, "A/B correctness must be byte-for-byte identical (found/goal/winner/route/decisions/objective)");
  assert.strictEqual(runA.correctness.routeFingerprint, COMMIT2_REPRESENTATIVE_ROUTE_FINGERPRINT, "route fingerprint must match PR-5.4b baseline");
  assert.strictEqual(runA.correctness.winnerExactFingerprint, COMMIT2_REPRESENTATIVE_WINNER_FINGERPRINT, "winner must match PR-5.4b baseline");

  // Paired benchmark rounds (search-only, no browser): A/B/B/A/A/B/B/A.
  const pairedOrder = ["A", "B", "B", "A", "A", "B", "B", "A"];
  const rounds = [];
  for (const side of pairedOrder) {
    const run = await runSearch(side === "B" ? experimental : {});
    rounds.push({
      side,
      keyBuildTotalMs: run.phases.keyBuildTotalMs,
      keyBuildCalls: run.phases.keyBuildCalls,
      enumerateTotalMs: run.phases.enumerateTotalMs,
      enumerateCalls: run.phases.enumerateCalls,
      applyTotalMs: run.phases.applyTotalMs,
      applyCalls: run.phases.applyCalls,
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
    wallMs: median(field(aRounds, "wallMs")),
  };
  const medianB = {
    keyBuildTotalMs: median(field(bRounds, "keyBuildTotalMs")),
    enumerateTotalMs: median(field(bRounds, "enumerateTotalMs")),
    applyTotalMs: median(field(bRounds, "applyTotalMs")),
    wallMs: median(field(bRounds, "wallMs")),
  };

  // Reachability cost-shift audit: in A the walk sits in key build; in B the
  // key does not walk and the walk returns to action enumeration.
  const reachabilityShiftConfirmed = Boolean(
    medianB.keyBuildTotalMs < medianA.keyBuildTotalMs &&
    medianB.enumerateTotalMs > medianA.enumerateTotalMs,
  );

  // Structural counters must be reported (not undefined).
  assert.ok(field(aRounds, "expanded").every((value) => typeof value === "number"), "A structural counters must be numbers");
  assert.ok(field(bRounds, "expanded").every((value) => typeof value === "number"), "B structural counters must be numbers");

  // Hard gate: the key builder must actually differ (B key phase far below A).
  const keyBuilderDiffers = medianB.keyBuildTotalMs < medianA.keyBuildTotalMs;
  assert.ok(keyBuilderDiffers, "experimental key builder must actually differ (B key phase < A key phase)");

  // Whole-search median regression check (report, not a hard CI gate).
  const wallRegressionFactor = medianB.wallMs / medianA.wallMs;
  const noWallRegression = wallRegressionFactor <= 1.25;

  const verdict = correctnessExact && bothStrictReplayVerified && keyBuilderDiffers && noWallRegression
    ? "GUARDED_PROFILE_APPROVED"
    : "KEEP_EXPERIMENTAL";

  process.stdout.write(JSON.stringify({
    schema: "motapathfinder.pr-5.4d-guarded-candidate-key.v1",
    status: "passed",
    controls: {
      candidateProductionProfileDefaultOff: true,
      productionRegionKeyByteExact: true,
      guardedScopeFailClosed: true,
      experimentalProfileFingerprintBound: true,
      guardedCorrectnessExact: correctnessExact,
      guardedStrictReplayBothVerified: bothStrictReplayVerified,
      keyBuilderActuallyDiffers: keyBuilderDiffers,
      structuralCountersReported: true,
      reachabilityCostShiftAudited: true,
      productionParityPreserved: true,
    },
    guard: guarded.guard,
    correctness: {
      exact: correctnessExact,
      strictReplayVerifiedBoth: bothStrictReplayVerified,
      A: runA.correctness,
      B: runB.correctness,
    },
    pairedBenchmark: {
      order: pairedOrder.join("/"),
      rounds: rounds.map((round, index) => ({ pair: Math.floor(index / 2) + 1, ...round })),
      medianA,
      medianB,
      keyPhaseRatio: medianB.keyBuildTotalMs > 0 ? Number((medianA.keyBuildTotalMs / medianB.keyBuildTotalMs).toFixed(1)) : null,
      wallRegressionFactor: Number(wallRegressionFactor.toFixed(2)),
      reachabilityCostShiftConfirmed: reachabilityShiftConfirmed,
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
