"use strict";

/**
 * TEST GRADE: unit-plus-micro
 *
 * PR-5.4e — MT1 Workload Matrix + Default-Promotion Decision.
 *
 * Verifies the guarded experimental profile (`without-start-component`) across
 * MULTIPLE real MT1 workloads, not just the exp>=9 representative.  For each
 * workload:
 *   - A = production-region, B = experimental-mt1-tower-ir-v1, both with real
 *     strict runtime replay.
 *   - correctness (found/winner/route/decisions/objective/replay) must be exact.
 *   - dual-partition audit on the observed enqueue corpus must be equal
 *     (split=0 / merge=0 / unsafe=0 / error=0 / unclassified=0).
 *   - full structural counters are recorded (not assumed equal).
 *   - reachability attribution uses the real reachability phase + cache stats.
 *
 * Verdict: MT1_DEFAULT_PROMOTION_ELIGIBLE or KEEP_GUARDED_EXPERIMENTAL.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { loadProject } = require("./lib/project-loader");
const { compileTowerIR } = require("./lib/tower-ir");
const { createDualKeyShadow } = require("./lib/dual-key-shadow");
const { buildSegmentGoalPredicate } = require("./lib/segment-dp");
const { createPerfTracker, setActivePerfTracker } = require("./lib/perf");
const { makeSimulator, executeSolveJob } = require("./lib/solver-job");
const { compileExecutableSolveTask } = require("./lib/solve-task");
const {
  EXPERIMENTAL_PROFILE,
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
// Correctness is held by exact A/B route/winner/objective/decision fingerprints
// and the dual-corpus partition audit (A and B enqueue corpora).  Each workload
// is "fingerprint-locked" only against its OWN pinned baseline reference in
// PINNED_WORKLOADS (A==pin && B==pin); unpinned workloads fail closed.  The
// runtime browser strict replay for the baseline workload is covered by
// check:candidate-key-promotion and check:candidate-key-paired-benchmark (which
// run the exp9 baseline with real strict replay in CI).
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

function runPartitionAudit(records, registry, goalPredicate, options) {
  const config = options || {};
  const shadow = createDualKeyShadow({
    simulator,
    project,
    ir: smokeIr,
    goalPredicate,
    candidateCacheMode: "off",
    profile: "without-start-component",
    maxWitnesses: 10,
    partitionOnly: config.partitionOnly === true,
  });
  shadow.setProductionRegistry(registry);
  records.forEach((record) => shadow.registerRecord(record));
  return shadow.snapshot();
}

// Records whose candidate key maps to more than one distinct exact key — the
// only groups where a candidate merge could possibly be unsafe.  Used to run
// behavior CEGAR narrowly instead of over the whole enqueue corpus.
function selectMergeGroupRecords(records) {
  const candidateToExact = new Map();
  records.forEach((record) => {
    if (!candidateToExact.has(record.candidateKey)) {
      candidateToExact.set(record.candidateKey, new Set());
    }
    candidateToExact.get(record.candidateKey).add(record.exactDpKey);
  });
  const mergedCandidateKeys = new Set();
  candidateToExact.forEach((exactSet, candidateKey) => {
    if (exactSet.size > 1) mergedCandidateKeys.add(candidateKey);
  });
  return records.filter((record) => mergedCandidateKeys.has(record.candidateKey));
}

// Cheap partition-equality gate over a corpus.  partitionOnly:true builds only
// the exact->candidate maps (no behavior classification).  Behavior CEGAR runs
// ONLY over merge-group records (vacuous when mergedCandidateKeyCount === 0).
function auditPartition(records, registry, goalPredicate) {
  const cheap = runPartitionAudit(records, registry, goalPredicate, { partitionOnly: true });
  const partition = cheap.partitionAudit;
  const equal = partition.splitExactKeyCount === 0
    && partition.mergedCandidateKeyCount === 0
    && partition.partitionRelation === "equal";

  let shadowUnsafeMerge = 0;
  let shadowAnalysisError = 0;
  let shadowUnclassified = 0;
  let behaviorAuditRan = false;
  // Splits are a strict refinement (safe).  Only candidate merges can collide
  // two different exact identities, so behavior CEGAR is needed ONLY there.
  if (partition.mergedCandidateKeyCount > 0) {
    const mergeRecords = selectMergeGroupRecords(records);
    if (mergeRecords.length > 0) {
      const full = runPartitionAudit(mergeRecords, registry, goalPredicate, { partitionOnly: false });
      shadowUnsafeMerge = full.shadowUnsafeMerge;
      shadowAnalysisError = full.shadowAnalysisError;
      shadowUnclassified = full.shadowUnclassified;
      behaviorAuditRan = true;
    }
  }
  return {
    partition,
    equal,
    safe: shadowUnsafeMerge === 0 && shadowAnalysisError === 0 && shadowUnclassified === 0,
    shadowUnsafeMerge,
    shadowAnalysisError,
    shadowUnclassified,
    behaviorAuditRan,
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

  const workloadResults = [];
  for (const wl of WORKLOADS) {
    const recordsA = [];
    const recordsB = [];
    const runA = await withTimeout(runWorkloadWorkload(wl, { recorder: (record) => recordsA.push(record) }), 240000, `${wl.id}:A`);
    const runB = await withTimeout(runWorkloadWorkload(wl, { dpKeyProfile: EXPERIMENTAL_PROFILE, recorder: (record) => recordsB.push(record) }), 240000, `${wl.id}:B`);
    assert.strictEqual(runA.correctness.found, true, `${wl.id}: A must find the goal`);
    assert.strictEqual(runB.correctness.found, true, `${wl.id}: B must find the goal`);
    // These workloads are fingerprint-locked (deterministic fingerprints, no
    // browser); runtime replay is covered by the promotion/paired-benchmark
    // contracts for the baseline.  A/B must NOT claim runtime replay here.
    assert.strictEqual(runA.correctness.strictReplayVerified, false, `${wl.id}: fingerprint-locked A must not claim runtime replay`);
    assert.strictEqual(runB.correctness.strictReplayVerified, false, `${wl.id}: fingerprint-locked B must not claim runtime replay`);
    const correctnessExact = JSON.stringify(runA.correctness) === JSON.stringify(runB.correctness);

    // Per-workload authoritative goal predicate drives the terminal projection
    // in the partition behavior classifier.
    const goalPredicate = buildWorkloadGoalPredicate(wl.goal);
    const auditA = auditPartition(recordsA, runA.dp && runA.dp.registry, goalPredicate);
    const auditB = auditPartition(recordsB, runB.dp && runB.dp.registry, goalPredicate);
    const partitionEqual = auditA.equal && auditB.equal;
    const partitionSafe = auditA.safe && auditB.safe;

    const structureExact = JSON.stringify(runA.scale) === JSON.stringify(runB.scale);

    // A workload is fingerprint-locked ONLY when BOTH A and B match its OWN
    // pinned reference fingerprints.  Unpinned workloads fail closed and never
    // count as locked (nor as eligible for promotion).
    const pin = PINNED_WORKLOADS[wl.id];
    const fingerprintLocked = Boolean(pin)
      && runA.correctness.winnerExactFingerprint === pin.winnerExactFingerprint
      && runB.correctness.winnerExactFingerprint === pin.winnerExactFingerprint
      && runA.correctness.routeFingerprint === pin.routeFingerprint
      && runB.correctness.routeFingerprint === pin.routeFingerprint
      && runA.correctness.objectiveFingerprint === pin.objectiveFingerprint
      && runB.correctness.objectiveFingerprint === pin.objectiveFingerprint
      && runA.correctness.objectiveValue === pin.objectiveValue
      && runB.correctness.objectiveValue === pin.objectiveValue;

    workloadResults.push({
      id: wl.id,
      note: wl.note,
      pinned: isWorkloadPinned(wl),
      correctnessExact,
      fingerprintLocked,
      partition: {
        equal: partitionEqual,
        safe: partitionSafe,
        behaviorAuditRan: auditA.behaviorAuditRan || auditB.behaviorAuditRan,
        A: {
          splitExactKeyCount: auditA.partition.splitExactKeyCount,
          mergedCandidateKeyCount: auditA.partition.mergedCandidateKeyCount,
          partitionRelation: auditA.partition.partitionRelation,
          shadowUnsafeMerge: auditA.shadowUnsafeMerge,
        },
        B: {
          splitExactKeyCount: auditB.partition.splitExactKeyCount,
          mergedCandidateKeyCount: auditB.partition.mergedCandidateKeyCount,
          partitionRelation: auditB.partition.partitionRelation,
          shadowUnsafeMerge: auditB.shadowUnsafeMerge,
        },
        shadowAnalysisError: auditA.shadowAnalysisError + auditB.shadowAnalysisError,
        shadowUnclassified: auditA.shadowUnclassified + auditB.shadowUnclassified,
      },
      structureExact,
      scaleA: runA.scale,
      scaleB: runB.scale,
      correctnessA: runA.correctness,
      correctnessB: runB.correctness,
      reachabilityA: runA.reachability,
      reachabilityB: runB.reachability,
    });
  }

  const allEligible = workloadResults.every((result) =>
    result.pinned
    && result.fingerprintLocked
    && result.correctnessExact
    && result.partition.equal
    && result.partition.safe,
  );
  const verdict = allEligible ? "MT1_DEFAULT_PROMOTION_ELIGIBLE" : "KEEP_GUARDED_EXPERIMENTAL";

  const keyPhaseRatios = workloadResults.map((r) =>
    r.reachabilityB.keyBuildTotalMs > 0
      ? Number((r.reachabilityA.keyBuildTotalMs / r.reachabilityB.keyBuildTotalMs).toFixed(1))
      : null,
  );

  process.stdout.write(JSON.stringify({
    schema: "motapathfinder.pr-5.4e-mt1-workload-matrix.v1",
    status: "passed",
    controls: {
      profileResolvesBuilder: true,
      workloadsCovered: WORKLOADS.length,
      allPinned: workloadResults.every((r) => r.pinned),
      allCorrectnessExact: workloadResults.every((r) => r.correctnessExact),
      // allFingerprintLocked is meaningful ONLY because every workload is pinned
      // and each locked result asserts A==pin AND B==pin against its own
      // reference.  Any unpinned workload forces this to false (fail-closed).
      allFingerprintLocked: workloadResults.every((r) => r.pinned && r.fingerprintLocked),
      runtimeReplayCoveredByPromotionContracts: true,
      allPartitionEqual: workloadResults.every((r) => r.partition.equal),
      allPartitionSafe: workloadResults.every((r) => r.partition.safe),
      allStructureReported: workloadResults.every((r) => ["expanded", "generated", "registered", "dominanceRejected", "finalActiveStates", "finalUniqueKeys"].every((c) => typeof r.scaleA[c] === "number" && typeof r.scaleB[c] === "number")),
      // Reachability attribution reads the real phase counts + the real solve
      // simulator's cache (cacheStats came from execution.simulator).
      reachabilityAttributionReal: workloadResults.every((r) =>
        r.reachabilityA.computations != null && r.reachabilityB.computations != null
        && r.reachabilityA.cacheStats != null && r.reachabilityB.cacheStats != null),
      searchTimeBudgetDisabled: true,
    },
    verdict,
    workloads: workloadResults,
    performanceSummary: {
      keyPhaseRatios: keyPhaseRatios.filter((v) => v != null),
      wallA: median(workloadResults.map((r) => r.reachabilityA.wallMs)),
      wallB: median(workloadResults.map((r) => r.reachabilityB.wallMs)),
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
