"use strict";

/**
 * TEST GRADE: unit-plus-micro
 *
 * PR-5.4f — MT1 Workload Matrix: Default Promotion + Explicit Rollback parity.
 *
 * PR-5.4e already qualified the candidate partition safety across 6 real MT1
 * workloads.  This gate re-verifies ONLY the promotion wiring (Gate E / H):
 * for each workload, the omitted-profile default, the explicit experimental
 * profile, and the explicit production-region rollback must all resolve to the
 * right effective profile, and the default + explicit candidate outputs must be
 * byte-exact with each other and with the per-workload pinned baseline, while
 * the rollback stays on the production key path.
 *
 * Verdict: MT1_DEFAULT_PROMOTION_ACCEPTED or PROMOTION_REJECTED.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { loadProject } = require("./lib/project-loader");
const { compileTowerIR } = require("./lib/tower-ir");
const { buildSegmentGoalPredicate } = require("./lib/segment-dp");
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

// Authoritative per-workload goal predicate, derived from the workload's own
// normalized goal via the same evaluator the segment DP uses.  The terminal
// projection (goal/dead/active) in the behavior classifier MUST reflect the
// workload's real goal, never a shared exp>=9 stand-in.
function buildWorkloadGoalPredicate(goal) {
  return buildSegmentGoalPredicate(project, { goal }, simulator);
}

const COMMIT2_REPRESENTATIVE_ROUTE_FINGERPRINT =
  '{"algorithm":"sha256-stable-json-v1","sha256":"c0adb2d921e84cab097c034bf7b6f8fdb5a344a0cb21f66ea3b7f707a4ebec13"}';
const COMMIT2_REPRESENTATIVE_WINNER_FINGERPRINT = "a2ff379819ac9003";
const COMMIT2_OBJECTIVE_FINGERPRINT = "b54217a839b77018";

// Pinned approved per-workload baselines.  A workload is "fingerprint-locked"
// ONLY when BOTH A and B match its OWN pinned reference fingerprints (winner /
// route / objective fingerprint / objective value).  The exp9 baseline pins
// come from the closed PR-5.4c/5.4d certification; the remaining workloads were
// pinned when this matrix was first certified.  Any workload WITHOUT a pin is
// fail-closed: it is reported not fingerprint-locked and cannot be promoted.
const PINNED_WORKLOADS = {
  "exp9-maxfinalhp": {
    winnerExactFingerprint: COMMIT2_REPRESENTATIVE_WINNER_FINGERPRINT,
    routeFingerprint: COMMIT2_REPRESENTATIVE_ROUTE_FINGERPRINT,
    objectiveFingerprint: COMMIT2_OBJECTIVE_FINGERPRINT,
    objectiveValue: 1346,
  },
  "exp6-maxfinalhp": {
    winnerExactFingerprint: "00263e2f4529f32b",
    routeFingerprint: '{"algorithm":"sha256-stable-json-v1","sha256":"f375f94a34a7ce018656df555251684c9164b211ebe8e5a87ff8747dec482558"}',
    objectiveFingerprint: "b54217a839b77018",
    objectiveValue: 1242,
  },
  "exp8-maxfinalhp": {
    winnerExactFingerprint: "4e6c8915fe03e65e",
    routeFingerprint: '{"algorithm":"sha256-stable-json-v1","sha256":"9406654d1fbdaf2651b1cc580d8a58237531d7fc26b918a613ef19e18170c8cd"}',
    objectiveFingerprint: "b54217a839b77018",
    objectiveValue: 1308,
  },
  "exp9-maxatk": {
    winnerExactFingerprint: "d885f53ee61e396b",
    routeFingerprint: '{"algorithm":"sha256-stable-json-v1","sha256":"10ad0368e484030ea0c891ea4a55e056700ee6b27922f6b1bf417892dbc52ef9"}',
    objectiveFingerprint: "7f16d6a7576b114a",
    objectiveValue: 21,
  },
  "tile4_1-maxfinalhp": {
    winnerExactFingerprint: "ec78c20a8c2c47e2",
    routeFingerprint: '{"algorithm":"sha256-stable-json-v1","sha256":"e4027694a3f23977938eabe6848dbbd9e8168214926fa52f8dfe3a54c9f6ed6c"}',
    objectiveFingerprint: "b54217a839b77018",
    objectiveValue: 1539,
  },
  "tile2_1-maxfinalhp": {
    winnerExactFingerprint: "21e8a075df3344a9",
    routeFingerprint: '{"algorithm":"sha256-stable-json-v1","sha256":"d13631cfb59818a859d1393eccd7ab63c6293d2c0f59787b4b80be7e1dd751b3"}',
    objectiveFingerprint: "b54217a839b77018",
    objectiveValue: 2638,
  },
};

// Whether a workload has been certified against an approved pinned baseline.
function isWorkloadPinned(wl) {
  return Boolean(PINNED_WORKLOADS[wl.id]);
}

// Real MT1 workloads (all verified reachable): goal x objective combinations.
// PR-5.4f promotion-parity matrix.  For EACH workload we run three profiles:
//   D = omitted (new implicit default)      -> must promote to candidate (approved MT1)
//   C = explicit experimental-mt1-tower-ir-v1
//   R = explicit production-region rollback -> must stay production (never auto-promotes)
// and require D == C == pinned baseline (winner/route/objective/value) plus
// effective-profile diagnostics.  PR-5.4e already certified partition safety,
// so this gate re-verifies ONLY the promotion wiring (no behavior CEGAR).
//
// Each workload is "fingerprint-locked" only against its OWN pinned baseline
// reference in PINNED_WORKLOADS; unpinned workloads fail closed.  The runtime
// browser strict replay for the representative is covered by the promotion and
// paired-benchmark contracts.
//
// MT1_WORKLOAD_SUBSET env var can limit the matrix for fast local checks; CI
// runs the full matrix.
const WORKLOADS_ALL = [
  { id: "exp9-maxfinalhp", goal: { type: "heroAtLeast", floorId: "MT1", minHero: { exp: 9 } }, objective: { mode: "max-final-hp" }, note: "baseline representative" },
  { id: "exp6-maxfinalhp", goal: { type: "heroAtLeast", floorId: "MT1", minHero: { exp: 6 } }, objective: { mode: "max-final-hp" }, note: "lower hero threshold" },
  { id: "exp8-maxfinalhp", goal: { type: "heroAtLeast", floorId: "MT1", minHero: { exp: 8 } }, objective: { mode: "max-final-hp" }, note: "mid hero threshold" },
  { id: "exp9-maxatk", goal: { type: "heroAtLeast", floorId: "MT1", minHero: { exp: 9 } }, objective: { mode: "maximize", field: "hero.atk" }, note: "second objective" },
  { id: "tile4_1-maxfinalhp", goal: { type: "tileRemoved", floorId: "MT1", x: 4, y: 1 }, objective: { mode: "max-final-hp" }, note: "real tile endpoint" },
  { id: "tile2_1-maxfinalhp", goal: { type: "tileRemoved", floorId: "MT1", x: 2, y: 1 }, objective: { mode: "max-final-hp" }, note: "real tile endpoint 2" },
];
const WORKLOAD_SUBSET = (process.env.MT1_WORKLOAD_SUBSET || "all").trim();
const WORKLOADS = WORKLOAD_SUBSET === "all"
  ? WORKLOADS_ALL
  : WORKLOADS_ALL.filter((wl) => WORKLOAD_SUBSET.split(",").includes(wl.id));

async function runWorkloadWorkload(wl, options) {
  const config = options || {};
  const spec = JSON.parse(JSON.stringify(smokeSpec));
  spec.goal = JSON.parse(JSON.stringify(wl.goal));
  const task = compileExecutableSolveTask({
    schema: "motapathfinder.solve-task.v1",
    tower: { id: "onlyup-smoke", projectRoot: ONLY_UP_ROOT, region: { spec } },
    objective: JSON.parse(JSON.stringify(wl.objective)),
    search: { algorithm: "segment-dp", maxExpansions: 4000, maxRuntimeMs: 0, candidateLimit: 2, goalSkylineLimit: 8 },
    verification: { strictReplay: config.strictReplay === true },
  });
  if (config.dpKeyProfile) task.executeConfig.dpKeyProfile = config.dpKeyProfile;
  if (config.recorder) task.executeConfig.candidateKeyShadowRecorder = config.recorder;
  const tracker = createPerfTracker({ enabled: true });
  setActivePerfTracker(tracker);
  let execution;
  try {
    const originalLog = console.log;
    console.log = () => {};
    try {
      execution = await executeSolveJob(task, {
        jobId: "mt1-workload-matrix",
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
    profileSelection: execution.profileSelection || null,
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
      found: execution.result.found,
      winnerExactFingerprint: winnerState ? require("./lib/solver-job").exactStateFingerprint(winnerState) : null,
      routeFingerprint: routeFingerprint ? routeFingerprint.hash || JSON.stringify(routeFingerprint) : null,
      decisionSummaries: execution.routeRecord ? execution.routeRecord.decisions.map((decision) => decision.summary) : null,
      objectiveFingerprint: execution.objectiveValue ? execution.objectiveValue.fingerprint : null,
      objectiveValue: execution.objectiveValue ? execution.objectiveValue.value : null,
      strictReplayVerified: execution.strictReplayVerified,
    },
    reachability: {
      computations: perf.phaseCounts && perf.phaseCounts.reachability != null ? Number(perf.phaseCounts.reachability) : null,
      totalMs: perf.phaseMs && perf.phaseMs.reachability != null ? Number(perf.phaseMs.reachability.toFixed(2)) : null,
      keyBuildCalls: perf.phaseCounts && perf.phaseCounts.buildDpStateKey != null ? Number(perf.phaseCounts.buildDpStateKey) : null,
      keyBuildTotalMs: perf.phaseMs && perf.phaseMs.buildDpStateKey != null ? Number(perf.phaseMs.buildDpStateKey.toFixed(2)) : null,
      wallMs: Number(perf.wallMs.toFixed(2)),
      // Read from the simulator the solve ACTUALLY used (executeSolveJob owns
      // its simulator internally).  The outer module `simulator` never ran the
      // search, so its cache stats would be all-zero and meaningless.
      cacheStats: execution.simulator
        ? execution.simulator.getReachabilityCacheStats()
        : null,
    },
  };
}

function median(values) {
  if (!values || values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

async function main() {
  // Profile resolution sanity once.
  const referenceTask = (() => {
    const spec = JSON.parse(JSON.stringify(smokeSpec));
    spec.goal = JSON.parse(JSON.stringify(WORKLOADS[0].goal));
    return compileExecutableSolveTask({
      schema: "motapathfinder.solve-task.v1",
      tower: { id: "onlyup-smoke", projectRoot: ONLY_UP_ROOT, region: { spec } },
      objective: JSON.parse(JSON.stringify(WORKLOADS[0].objective)),
      search: { algorithm: "segment-dp", maxExpansions: 4000, maxRuntimeMs: 0, candidateLimit: 2, goalSkylineLimit: 8 },
      verification: { strictReplay: false },
    });
  })();
  const normalizedSpec = (referenceTask.normalizedTask || referenceTask).tower.region.spec;
  const resolution = resolveDpKeyProfile({
    project,
    regionSpec: normalizedSpec,
    simulator,
    dpKeyProfile: EXPERIMENTAL_PROFILE,
    options: { towerId: "onlyup-smoke", goalPredicate: buildWorkloadGoalPredicate(WORKLOADS[0].goal) },
  });
  assert.ok(resolution.builder, "experimental profile must resolve a builder");

  // Profile resolution sanity: the implicit default on the approved MT1 scope
  // must promote to the candidate builder (Gate A), while the explicit
  // production-region rollback must stay production (Gate B).
  const implicitDefault = resolveDpKeyProfile({
    project,
    regionSpec: normalizedSpec,
    simulator,
    dpKeyProfile: null,
    options: { towerId: "onlyup-smoke", goalPredicate: buildWorkloadGoalPredicate(WORKLOADS[0].goal) },
  });
  assert.ok(implicitDefault.builder, "implicit default on approved MT1 must resolve a candidate builder");
  assert.strictEqual(implicitDefault.effectiveProfile, EXPERIMENTAL_PROFILE, "implicit default must resolve to experimental on approved scope");
  assert.strictEqual(implicitDefault.selectionReason, "approved-mt1-default", "implicit default must carry approved-mt1-default reason");

  const workloadResults = [];
  for (const wl of WORKLOADS) {
    // D = omitted profile (new implicit default), C = explicit candidate,
    // R = explicit production-region rollback.
    const runD = await withTimeout(runWorkloadWorkload(wl), 240000, `${wl.id}:D`);
    const runC = await withTimeout(runWorkloadWorkload(wl, { dpKeyProfile: EXPERIMENTAL_PROFILE }), 240000, `${wl.id}:C`);
    const runR = await withTimeout(runWorkloadWorkload(wl, { dpKeyProfile: PRODUCTION_PROFILE }), 240000, `${wl.id}:R`);
    assert.strictEqual(runD.correctness.found, true, `${wl.id}: default must find the goal`);
    assert.strictEqual(runC.correctness.found, true, `${wl.id}: explicit candidate must find the goal`);
    assert.strictEqual(runR.correctness.found, true, `${wl.id}: rollback must find the goal`);
    // These workloads are fingerprint-locked (deterministic fingerprints, no
    // browser); runtime replay is covered by the promotion/paired-benchmark
    // contracts for the representative.  None may claim runtime replay here.
    assert.strictEqual(runD.correctness.strictReplayVerified, false, `${wl.id}: default must not claim runtime replay`);
    assert.strictEqual(runC.correctness.strictReplayVerified, false, `${wl.id}: candidate must not claim runtime replay`);
    assert.strictEqual(runR.correctness.strictReplayVerified, false, `${wl.id}: rollback must not claim runtime replay`);

    const pin = PINNED_WORKLOADS[wl.id];
    const pinned = isWorkloadPinned(wl);
    const matchesPin = (correctness) => Boolean(pin)
      && correctness.winnerExactFingerprint === pin.winnerExactFingerprint
      && correctness.routeFingerprint === pin.routeFingerprint
      && correctness.objectiveFingerprint === pin.objectiveFingerprint
      && correctness.objectiveValue === pin.objectiveValue;

    const defaultCandidateParity = JSON.stringify(runD.correctness) === JSON.stringify(runC.correctness);
    const defaultPromotes = runD.profileSelection.effectiveProfile === EXPERIMENTAL_PROFILE
      && runD.profileSelection.selectionReason === "approved-mt1-default";
    const candidateExplicit = runC.profileSelection.effectiveProfile === EXPERIMENTAL_PROFILE
      && runC.profileSelection.selectionReason === "explicit-experimental";
    const rollbackEffective = runR.profileSelection.effectiveProfile === PRODUCTION_PROFILE
      && runR.profileSelection.selectionReason === "explicit-rollback";
    const structureCandidateParity = JSON.stringify(runD.scale) === JSON.stringify(runC.scale);

    workloadResults.push({
      id: wl.id,
      note: wl.note,
      pinned,
      defaultPromotes,
      candidateExplicit,
      rollbackEffective,
      defaultCandidateParity,
      defaultMatchesPin: matchesPin(runD.correctness),
      candidateMatchesPin: matchesPin(runC.correctness),
      rollbackMatchesPin: matchesPin(runR.correctness),
      structureCandidateParity,
      scaleD: runD.scale,
      scaleC: runC.scale,
      scaleR: runR.scale,
      correctnessD: runD.correctness,
      correctnessC: runC.correctness,
      correctnessR: runR.correctness,
      profileD: runD.profileSelection,
      profileC: runC.profileSelection,
      profileR: runR.profileSelection,
      reachabilityD: runD.reachability,
      reachabilityC: runC.reachability,
      reachabilityR: runR.reachability,
    });
  }

  const allPromoted = workloadResults.every((result) =>
    result.pinned
    && result.defaultPromotes
    && result.candidateExplicit
    && result.rollbackEffective
    && result.defaultCandidateParity
    && result.defaultMatchesPin
    && result.candidateMatchesPin
    && result.rollbackMatchesPin
    && result.structureCandidateParity,
  );
  const verdict = allPromoted ? "MT1_DEFAULT_PROMOTION_ACCEPTED" : "PROMOTION_REJECTED";

  const keyPhaseRatios = workloadResults.map((r) =>
    r.reachabilityC.keyBuildTotalMs > 0
      ? Number((r.reachabilityD.keyBuildTotalMs / r.reachabilityC.keyBuildTotalMs).toFixed(1))
      : null,
  );

  process.stdout.write(JSON.stringify({
    schema: "motapathfinder.pr-5.4f-mt1-default-promotion-matrix.v1",
    status: "passed",
    controls: {
      profileResolvesBuilder: true,
      implicitDefaultPromotesToCandidate: workloadResults.every((r) => r.defaultPromotes),
      allPinned: workloadResults.every((r) => r.pinned),
      allDefaultCandidateParity: workloadResults.every((r) => r.defaultCandidateParity),
      allDefaultMatchesPin: workloadResults.every((r) => r.defaultMatchesPin),
      allCandidateMatchesPin: workloadResults.every((r) => r.candidateMatchesPin),
      allRollbackMatchesPin: workloadResults.every((r) => r.rollbackMatchesPin),
      allRollbackEffective: workloadResults.every((r) => r.rollbackEffective),
      allCandidateExplicit: workloadResults.every((r) => r.candidateExplicit),
      allStructureReported: workloadResults.every((r) => ["expanded", "generated", "registered", "dominanceRejected", "finalActiveStates", "finalUniqueKeys"].every((c) => typeof r.scaleD[c] === "number" && typeof r.scaleC[c] === "number" && typeof r.scaleR[c] === "number")),
      reachabilityAttributionReal: workloadResults.every((r) =>
        r.reachabilityD.computations != null && r.reachabilityC.computations != null
        && r.reachabilityD.cacheStats != null && r.reachabilityC.cacheStats != null),
      searchTimeBudgetDisabled: true,
    },
    verdict,
    workloads: workloadResults,
    performanceSummary: {
      keyPhaseRatios: keyPhaseRatios.filter((v) => v != null),
      wallD: median(workloadResults.map((r) => r.reachabilityD.wallMs)),
      wallC: median(workloadResults.map((r) => r.reachabilityC.wallMs)),
      wallR: median(workloadResults.map((r) => r.reachabilityR.wallMs)),
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
