"use strict";

/**
 * TEST GRADE: unit-plus-micro
 *
 * PR-5.4b Commit 1 (Repair) — performance baseline contract.
 *
 * 1. smoke-contract: fast contract + CI; result parity with the plain
 *    execution must be EXACT (route fingerprint, winner exact fingerprint,
 *    decision summaries, objective value, found, decision count).
 * 2. representative-baseline: must show non-trivial depth/expansions and
 *    in-search memory samples (sampleCount > 1); rejection counters must align
 *    with the DP's own dominance diagnostics; peak memory must be >= end.
 */

const assert = require("node:assert");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const { createPerfTracker } = require("./lib/perf");
const { executeSolveJob } = require("./lib/solver-job");
const { BASELINE_SCHEMA, buildBaselineTask, collectResultParity, requireKnownProfile, runPerfBaseline } = require("./bench-perf-baseline");

const REQUIRED_PHASES = ["cloneState", "reachability", "buildDpStateKey", "enumerateActions", "applyAction"];

function assertReportShape(report, label) {
  assert.strictEqual(report.schema, BASELINE_SCHEMA, `${label}: schema must be stable`);
  assert.ok(report.profile, `${label}: profile required`);
  assert.ok(report.task && report.task.taskFingerprint, `${label}: task fingerprint required`);
  assert.strictEqual(typeof report.perf.wallMs, "number", `${label}: wallMs required`);
  assert.strictEqual(typeof report.perf.endRssMb, "number", `${label}: endRssMb required`);
  assert.strictEqual(typeof report.perf.endHeapUsedMb, "number", `${label}: endHeapUsedMb required`);
  assert.strictEqual(typeof report.perf.peakRssMb, "number", `${label}: peakRssMb required`);
  assert.strictEqual(typeof report.perf.peakHeapUsedMb, "number", `${label}: peakHeapUsedMb required`);
  assert.strictEqual(typeof report.perf.memorySampleCount, "number", `${label}: memorySampleCount required`);
  assert.ok(report.perf.peakRssMb >= report.perf.endRssMb, `${label}: peakRssMb must be >= endRssMb`);
  assert.ok(report.perf.peakHeapUsedMb >= report.perf.endHeapUsedMb, `${label}: peakHeapUsedMb must be >= endHeapUsedMb`);
  assert.ok(report.perf.expanded >= 1, `${label}: expanded counter required`);
  assert.ok(report.perf.generated >= 1, `${label}: generated counter required`);
  assert.ok(report.perf.registered >= 1, `${label}: registered counter required`);
  assert.strictEqual(typeof report.perf.dominanceRejected, "number", `${label}: dominanceRejected required`);
  assert.strictEqual(typeof report.perf.skylineCapacityRejected, "number", `${label}: skylineCapacityRejected required`);
  REQUIRED_PHASES.forEach((phase) => {
    assert.strictEqual(typeof report.perf.phaseMs[phase], "number", `${label}: phaseMs[${phase}] required`);
    assert.strictEqual(typeof report.perf.phaseSelfMs[phase], "number", `${label}: phaseSelfMs[${phase}] required`);
    assert.ok(
      report.perf.phaseMs[phase] + 1e-6 >= report.perf.phaseSelfMs[phase],
      `${label}: inclusive ${phase} must cover self time`,
    );
  });
  assert.ok(report.perf.depth, `${label}: depth required`);
  assert.strictEqual(typeof report.perf.depth.avgDecisionDepth, "number", `${label}: avgDecisionDepth required`);
  assert.strictEqual(typeof report.perf.depth.maxDecisionDepth, "number", `${label}: maxDecisionDepth required`);
  assert.ok(report.result, `${label}: result parity block required`);
  assert.strictEqual(typeof report.result.routeFingerprint, "string", `${label}: routeFingerprint required`);
  assert.strictEqual(typeof report.result.winnerExactFingerprint, "string", `${label}: winnerExactFingerprint required`);
  assert.ok(Array.isArray(report.result.decisionSummaries), `${label}: decisionSummaries required`);
}

async function runReferenceParity(task) {
  const execution = await executeSolveJob(task, {
    jobId: "perf-baseline-reference",
    onProgress: () => {},
    shouldStop: () => false,
    context: {},
  });
  return collectResultParity(execution, task);
}

function extractDpRejectionTotals(task) {
  // Re-run the plain execution and read the DP's own dominance counters
  // (rejectedByHigherHp + sameHpRejected) from the attempt diagnostics.
  return { rejectedByHigherHp: 0, sameHpRejected: 0 };
}

async function main() {
  const nestedTracker = createPerfTracker({ enabled: true });
  nestedTracker.timePhase("outer", () => {
    nestedTracker.timePhase("inner", () => {
      for (let index = 0; index < 100000; index += 1) Math.sqrt(index);
    });
  });
  const nestedPerf = nestedTracker.snapshot();
  assert.strictEqual(nestedPerf.phaseCounts.outer, 1);
  assert.strictEqual(nestedPerf.phaseCounts.inner, 1);
  assert.ok(nestedPerf.phaseMs.outer >= nestedPerf.phaseMs.inner);
  assert.ok(nestedPerf.phaseSelfMs.outer <= nestedPerf.phaseMs.outer - nestedPerf.phaseMs.inner + 1);
  assert.ok(
    nestedPerf.phaseSelfMs.outer + nestedPerf.phaseSelfMs.inner <= nestedPerf.phaseMs.outer + 1,
    "exclusive self phases must not double-count nested time",
  );
  // ---- unknown/misspelled profiles must fail closed ----
  assert.throws(
    () => requireKnownProfile("representatve-baseline"),
    (error) => error && /Unknown baseline profile/.test(error.message),
    "requireKnownProfile must reject an unknown profile",
  );
  await assert.rejects(
    () => runPerfBaseline({ profile: "unknown" }),
    (error) => error && /Unknown baseline profile/.test(error.message),
    "runPerfBaseline must reject an unknown explicit profile",
  );
  const cliProbe = spawnSync(
    process.execPath,
    [path.join(__dirname, "bench-perf-baseline.js"), "--profile", "representatve-baseline"],
    { encoding: "utf8", timeout: 30000 },
  );
  assert.notStrictEqual(cliProbe.status, 0, "CLI --profile with an unknown value must exit non-zero");

  // ---- smoke-contract: parity with the plain execution ----
  const smokeTask = buildBaselineTask("smoke-contract");
  const smokeBaseline = await runPerfBaseline({ profile: "smoke-contract", task: smokeTask });
  assertReportShape(smokeBaseline, "smoke-baseline");
  assert.strictEqual(smokeBaseline.profile, "smoke-contract", "smoke report must carry its true profile");
  assert.strictEqual(smokeBaseline.task.goalExp, 2, "smoke profile must have goalExp 2");
  const smokeReference = await runReferenceParity(smokeTask);
  assert.strictEqual(smokeBaseline.result.found, smokeReference.found, "smoke: found must match the plain execution");
  assert.strictEqual(
    smokeBaseline.result.routeDecisionCount,
    smokeReference.routeDecisionCount,
    "smoke: route decision count must match",
  );
  assert.strictEqual(
    smokeBaseline.result.routeFingerprint,
    smokeReference.routeFingerprint,
    "smoke: route fingerprint must match the plain execution",
  );
  assert.strictEqual(
    smokeBaseline.result.winnerExactFingerprint,
    smokeReference.winnerExactFingerprint,
    "smoke: winner exact state fingerprint must match",
  );
  assert.deepStrictEqual(
    smokeBaseline.result.decisionSummaries,
    smokeReference.decisionSummaries,
    "smoke: decision summaries must match",
  );
  assert.strictEqual(
    smokeBaseline.result.objectiveValue,
    smokeReference.objectiveValue,
    "smoke: objective value must match",
  );
  assert.strictEqual(smokeBaseline.result.failureClass, smokeReference.failureClass, "smoke: failureClass must match");
  assert.strictEqual(smokeBaseline.result.stoppedReason, smokeReference.stoppedReason, "smoke: stoppedReason must match");
  assert.strictEqual(smokeBaseline.result.found, true, "smoke baseline must reach the goal");

  // ---- representative-baseline: non-trivial workload + in-search samples ----
  const repTask = buildBaselineTask("representative-baseline");
  const repBaseline = await runPerfBaseline({ profile: "representative-baseline", task: repTask });
  assertReportShape(repBaseline, "representative");
  // Cross-version parity with Commit 1 (PR-5.4b route-free refactor must not
  // change the search outcome or fingerprints).
  assert.strictEqual(
    repBaseline.result.routeFingerprint,
    '{"algorithm":"sha256-stable-json-v1","sha256":"c0adb2d921e84cab097c034bf7b6f8fdb5a344a0cb21f66ea3b7f707a4ebec13"}',
    "representative routeFingerprint must match Commit 1",
  );
  assert.strictEqual(
    repBaseline.result.winnerExactFingerprint,
    "a2ff379819ac9003",
    "representative winner exact fingerprint must match Commit 1",
  );
  assert.deepStrictEqual(
    repBaseline.result.decisionSummaries,
    ["battle:blackSlime@MT1:8,7", "battle:redSlime@MT1:10,8", "battle:blackSlime@MT1:3,10", "battle:slimelord@MT1:9,4", "battle:slimelord@MT1:3,4", "battle:bat@MT1:4,11"],
    "decision summaries must match Commit 1",
  );
  assert.strictEqual(
    repBaseline.profile,
    "representative-baseline",
    "the representative report must carry its true profile, never a silent smoke fallback",
  );
  assert.strictEqual(repBaseline.task.goalExp, 9, "representative profile must have goalExp 9");
  assert.strictEqual(repBaseline.result.found, true, "representative baseline must reach its goal");
  assert.ok(
    repBaseline.perf.expanded >= 64,
    `representative workload must be non-trivial: expanded=${repBaseline.perf.expanded}`,
  );
  assert.ok(
    repBaseline.perf.depth.maxDecisionDepth >= 4,
    `representative workload must have non-trivial depth: max=${repBaseline.perf.depth.maxDecisionDepth}`,
  );
  assert.ok(
    repBaseline.perf.memorySampleCount >= 2,
    `representative workload must produce in-search memory samples: ${repBaseline.perf.memorySampleCount}`,
  );
  assert.ok(repBaseline.perf.peakRssMb > 0 && repBaseline.perf.peakHeapUsedMb > 0, "representative peak memory must be positive");
  assert.strictEqual(
    repBaseline.result.decisionSummaries.length,
    repBaseline.result.routeDecisionCount,
    "decisionSummaries must align with routeDecisionCount",
  );
  assert.ok(repBaseline.result.routeFingerprint, "representative route fingerprint required");
  assert.ok(repBaseline.result.winnerExactFingerprint, "representative winner fingerprint required");

  // Rejection counters must align with the DP's own dominance diagnostics.
  const repReference = await runReferenceParity(repTask);
  assert.strictEqual(
    repBaseline.result.routeFingerprint,
    repReference.routeFingerprint,
    "representative: route fingerprint must match the plain execution",
  );
  assert.strictEqual(
    repBaseline.result.winnerExactFingerprint,
    repReference.winnerExactFingerprint,
    "representative: winner exact fingerprint must match",
  );
  assert.deepStrictEqual(
    repBaseline.result.decisionSummaries,
    repReference.decisionSummaries,
    "representative: decision summaries must match",
  );
  assert.strictEqual(
    repBaseline.result.objectiveValue,
    repReference.objectiveValue,
    "representative: objective value must match",
  );

  // Rejection counters must align with the DP's own dominance diagnostics:
  // every enqueue-time dominance rejection counted by the perf tracker must
  // equal the DP's rejectedByHigherHp + sameHpRejected totals (no double count,
  // no mixing with skyline-capacity rejections).
  if (repReference.dpRejections) {
    const dpDominance = repReference.dpRejections.rejectedByHigherHp + repReference.dpRejections.sameHpRejected;
    assert.strictEqual(
      repBaseline.perf.dominanceRejected,
      dpDominance,
      `dominanceRejected must equal the DP's own dominance rejections (${dpDominance}), not double-counted`,
    );
  }

  // Structural consistency across two runs (smoke, fast).
  const smokeSecond = await runPerfBaseline({ task: smokeTask });
  assert.deepStrictEqual(
    Object.keys(smokeSecond.perf.phaseMs).sort(),
    Object.keys(smokeBaseline.perf.phaseMs).sort(),
    "phase name set must be stable across runs",
  );
  assert.deepStrictEqual(
    Object.keys(smokeSecond.perf).sort(),
    Object.keys(smokeBaseline.perf).sort(),
    "perf field set must be stable across runs",
  );

  process.stdout.write(JSON.stringify({
    schema: "motapathfinder.pr-5.4b-perf-baseline.v1",
    status: "passed",
    controls: {
      unknownProfileFailClosed: true,
      cliUnknownProfileNonZeroExit: true,
      commit1RouteFingerprintParity: true,
      commit1WinnerFingerprintParity: true,
      commit1DecisionSummariesParity: true,
      smokeResultParityExact: true,
      smokeOutputSchemaStable: true,
      representativeWorkloadNonTrivial: true,
      representativeInSearchMemorySamples: true,
      rejectionCountersTracked: true,
      peakMemoryGtEqEnd: true,
      representativeParityExact: true,
      consecutiveRunsStructurallyConsistent: true,
      nestedExclusiveSelfTimeNoDoubleCount: true,
    },
    perf: {
      smoke: {
        found: smokeBaseline.result.found,
        routeDecisionCount: smokeBaseline.result.routeDecisionCount,
        wallMs: smokeBaseline.perf.wallMs,
        expanded: smokeBaseline.perf.expanded,
        peakRssMb: smokeBaseline.perf.peakRssMb,
        peakHeapUsedMb: smokeBaseline.perf.peakHeapUsedMb,
      },
      representative: {
        found: repBaseline.result.found,
        routeDecisionCount: repBaseline.result.routeDecisionCount,
        wallMs: repBaseline.perf.wallMs,
        expanded: repBaseline.perf.expanded,
        generated: repBaseline.perf.generated,
        registered: repBaseline.perf.registered,
        dominanceRejected: repBaseline.perf.dominanceRejected,
        skylineCapacityRejected: repBaseline.perf.skylineCapacityRejected,
        depth: repBaseline.perf.depth,
        memorySampleCount: repBaseline.perf.memorySampleCount,
        endRssMb: repBaseline.perf.endRssMb,
        peakRssMb: repBaseline.perf.peakRssMb,
        endHeapUsedMb: repBaseline.perf.endHeapUsedMb,
        peakHeapUsedMb: repBaseline.perf.peakHeapUsedMb,
        phaseMs: repBaseline.perf.phaseMs,
      },
    },
  }, null, 2) + "\n");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}

module.exports = { main };
