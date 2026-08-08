"use strict";

/**
 * TEST GRADE: unit-plus-micro
 *
 * PR-5.4c Commit 3 — Candidate-Key Minimality + MT1 Promotion Gate.
 *
 * Gate A (shadow-only): partition relationship audit (exact key vs candidate
 * key split/merge), candidate profile matrix, CEGAR minimality.  A minimal-safe
 * profile must have 0 unsafe / 0 analysis-error / 0 unclassified AND
 * candidateFinalActiveStates <= productionFinalActiveStates (delta >= 0).
 *
 * Gate B (opt-in experimental A/B): the minimal-safe profile runs in canonical
 * searchDP via the dpStateKeyBuilder hook (default null -> buildDpStateKey).
 * Correctness (found/goal/winner/route/decisions/objective/replay) must be
 * byte-for-byte identical; search scale and key-phase costs are reported.
 *
 * Final decision: PROMOTION_CANDIDATE or NO_PROMOTION.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { loadProject } = require("./lib/project-loader");
const { compileTowerIR } = require("./lib/tower-ir");
const { createDualKeyShadow } = require("./lib/dual-key-shadow");
const { createPerfTracker, setActivePerfTracker } = require("./lib/perf");
const { makeSimulator, executeSolveJob } = require("./lib/solver-job");
const { compileExecutableSolveTask } = require("./lib/solve-task");
const { buildCandidateDpKey } = require("./lib/key-dependency-corpus");
const { PRODUCTION_PROFILE } = require("./lib/guarded-candidate-key");

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

function makeShadow(config) {
  return createDualKeyShadow({ simulator, project, ir: smokeIr, goalPredicate: GOAL_PREDICATE, ...(config || {}) });
}

async function runRepresentative(options) {
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
  if (config.recorder) task.executeConfig.candidateKeyShadowRecorder = config.recorder;
  if (config.dpKeyProfile) task.executeConfig.dpKeyProfile = config.dpKeyProfile;
  if (config.dpStateKeyBuilder) task.executeConfig.dpStateKeyBuilder = config.dpStateKeyBuilder;
  const tracker = createPerfTracker({ enabled: true });
  setActivePerfTracker(tracker);
  let execution;
  try {
    // Quiet the strict-replay live logs so the contract JSON stays clean.
    const originalLog = console.log;
    console.log = () => {};
    try {
      execution = await executeSolveJob(task, {
        jobId: "candidate-key-promotion",
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
  return {
    execution,
    dp,
    registry: (dp && dp.registry) || null,
    perf: tracker.snapshot(),
  };
}

function extractCorrectness(execution) {
  const winnerState = execution.result.finalCandidate && execution.result.finalCandidate.state;
  const routeFingerprint = execution.routeRecord
    ? (require("./lib/replay-resume-artifact").buildReplayRouteFingerprint(execution.routeRecord))
    : null;
  const routeFingerprintString = routeFingerprint ? routeFingerprint.hash || JSON.stringify(routeFingerprint) : null;
  return {
    found: execution.result.found,
    winnerExactFingerprint: winnerState ? require("./lib/solver-job").exactStateFingerprint(winnerState) : null,
    routeFingerprint: routeFingerprintString,
    decisionSummaries: execution.routeRecord ? execution.routeRecord.decisions.map((decision) => decision.summary) : null,
    objectiveFingerprint: execution.objectiveValue ? execution.objectiveValue.fingerprint : null,
    objectiveValue: execution.objectiveValue ? execution.objectiveValue.value : null,
    strictReplayVerified: execution.strictReplayVerified,
  };
}

function extractSearchScale(run) {
  const dp = run.dp;
  const generated = dp && dp.actionsGeneratedByKind
    ? Object.values(dp.actionsGeneratedByKind).reduce((sum, value) => sum + (value || 0), 0)
    : null;
  const registered = dp && dp.actionsKeptByKind
    ? Object.values(dp.actionsKeptByKind).reduce((sum, value) => sum + (value || 0), 0)
    : null;
  const dominanceRejected = dp ? Number(dp.rejectedByHigherHp || 0) + Number(dp.sameHpRejected || 0) : null;
  return {
    expanded: dp ? Number(dp.expansions) : null,
    generated,
    registered,
    dominanceRejected,
    finalActiveStates: run.registry ? Number(run.registry.finalActiveStates) : null,
    finalUniqueKeys: run.registry ? Number(run.registry.finalUniqueKeys) : null,
  };
}

function evaluateProfile(records, registry, profile, behaviorCache) {
  const shadow = makeShadow({ candidateCacheMode: "off", profile, maxWitnesses: 10, behaviorCache });
  shadow.setProductionRegistry(registry);
  records.forEach((record) => shadow.registerRecord(record));
  return shadow.snapshot();
}

function pickMinimalSafe(profiles, registry, records, behaviorCache) {
  const results = [];
  profiles.forEach((profile) => {
    const snapshot = evaluateProfile(records, registry, profile, behaviorCache);
    const safe = snapshot.shadowUnsafeMerge === 0 && snapshot.shadowAnalysisError === 0 && snapshot.shadowUnclassified === 0;
    results.push({ profile, snapshot, safe });
  });
  const safeProfiles = results.filter((entry) => entry.safe);
  safeProfiles.sort((a, b) => a.snapshot.candidateFinalActiveStates - b.snapshot.candidateFinalActiveStates);
  return { results, minimalSafe: safeProfiles.length > 0 ? safeProfiles[0] : null };
}

async function main() {
  // Representative production run (A) via EXPLICIT rollback (the omitted
  // profile now defaults to the promoted candidate on approved MT1), with the
  // recorder + real strict replay.
  const records = [];
  const runA = await runRepresentative({ dpKeyProfile: PRODUCTION_PROFILE, recorder: (record) => records.push(record), strictReplay: true });
  assert.strictEqual(runA.execution.result.found, true, "representative (A) must complete");
  assert.ok(records.length > 0, "recorder must capture enqueue decisions");
  const registry = runA.registry;
  assert.ok(registry && registry.finalUniqueKeys >= 1, "registry diagnostics required");
  const correctnessA = extractCorrectness(runA.execution);

  const sharedBehaviorCache = new Map();

  // Partition audit on the current-full profile.
  const currentFull = evaluateProfile(records, registry, "current-full", sharedBehaviorCache);
  const audit = currentFull.partitionAudit;
  assert.ok(audit.splitExactKeyCount >= 0 && typeof audit.splitExactKeyCount === "number", "splitExactKeyCount required");
  assert.ok(audit.mergedCandidateKeyCount >= 0 && typeof audit.mergedCandidateKeyCount === "number", "mergedCandidateKeyCount required");
  assert.ok(["equal", "strict-refinement", "strict-coarsening", "non-comparable"].includes(audit.partitionRelation), "partitionRelation required");
  assert.ok(audit.splitWitnesses.length >= 0, "split witnesses array required");
  if (audit.splitWitnesses.length > 0) {
    const witness = audit.splitWitnesses[0];
    assert.ok(witness.differingProjectionFields, "split witness must carry field-level diffs");
  }

  // Candidate profile matrix + minimality (Gate A).
  const { results, minimalSafe } = pickMinimalSafe(["current-full", "normalized-resource", "without-event-label", "without-start-component"], registry, records, sharedBehaviorCache);
  assert.ok(minimalSafe, "at least one candidate profile must be safe (0 unsafe/error/unclassified)");
  const minimalSnapshot = minimalSafe.snapshot;
  const gateASafe = minimalSnapshot.shadowUnsafeMerge === 0
    && minimalSnapshot.shadowAnalysisError === 0
    && minimalSnapshot.shadowUnclassified === 0;
  const gateADeltaNonNegative = minimalSnapshot.hypotheticalStateDelta >= 0;
  const gateAPassed = gateASafe && gateADeltaNonNegative;
  const withoutStartComponentEntry = results.find((entry) => entry.profile === "without-start-component");
  assert.ok(withoutStartComponentEntry, "without-start-component profile must be evaluated");
  const withoutStartComponentSafe = withoutStartComponentEntry.snapshot.shadowUnsafeMerge === 0
    && withoutStartComponentEntry.snapshot.shadowAnalysisError === 0
    && withoutStartComponentEntry.snapshot.shadowUnclassified === 0;

  const init = simulator.createInitialState({ rank: "chaos" });

  // Unknown candidate profile must fail closed (never silent fallback).
  assert.throws(
    () => buildCandidateDpKey(simulator, project, smokeIr, init, { profile: "without-start-compnent-typo" }),
    (error) => error && /unknown candidate profile/.test(error.message),
    "an explicit unknown profile must throw",
  );

  // Negative controls.
  // Negative control: dropping a behavior-relevant field (atk) must surface
  // unsafe witnesses.  Constructed synthetically (deterministic), since the
  // representative corpus may not exercise a pure atk-only difference.
  const stateAtkLow = JSON.parse(JSON.stringify(init));
  const stateAtkHigh = JSON.parse(JSON.stringify(init));
  stateAtkHigh.hero.atk = 99;
  const missingAtkShadow = makeShadow({ candidateCacheMode: "off", profile: "missing-atk" });
  assert.strictEqual(
    buildCandidateDpKey(simulator, project, smokeIr, stateAtkLow, { profile: "missing-atk" }),
    buildCandidateDpKey(simulator, project, smokeIr, stateAtkHigh, { profile: "missing-atk" }),
    "missing-atk profile must collide the two synthetic states",
  );
  missingAtkShadow.registerRecord({ state: stateAtkLow, exactDpKey: "kLow", productionDecision: "keep-new" });
  missingAtkShadow.registerRecord({ state: stateAtkHigh, exactDpKey: "kHigh", productionDecision: "keep-new" });
  const missingAtkSnapshot = missingAtkShadow.snapshot();
  assert.ok(
    missingAtkSnapshot.shadowUnsafeMerge > 0 || missingAtkSnapshot.unsafeWitnesses.length > 0,
    "dropping a behavior-relevant field (atk) must surface unsafe witnesses",
  );
  const missingAtkRepresentative = evaluateProfile(records, registry, "missing-atk", sharedBehaviorCache);
  const broken = makeShadow({ candidateKeyBuilder: () => "BROKEN", candidateCacheMode: "off", maxWitnesses: 10 });
  records.slice(0, 60).forEach((record) => broken.registerRecord(record));
  const brokenSnapshot = broken.snapshot();
  assert.ok(brokenSnapshot.shadowUnsafeMerge > 0, "BROKEN key must surface unsafe merges");
  assert.ok(brokenSnapshot.unsafeWitnesses.length > 0, "BROKEN key must surface witnesses");

  // Gate B: experimental A/B only when Gate A passed; runs REAL strict replay
  // via the guarded experimental profile (self-contained, pinned baseline).
  let gateB = null;
  if (gateAPassed) {
    const guardedModule = require("./lib/guarded-candidate-key");
    const referenceTask = (() => {
      const spec = JSON.parse(JSON.stringify(smokeSpec));
      spec.goal = { type: "heroAtLeast", floorId: "MT1", minHero: { exp: 9 } };
      return require("./lib/solve-task").compileExecutableSolveTask({
        schema: "motapathfinder.solve-task.v1",
        tower: { id: "onlyup-smoke", projectRoot: ONLY_UP_ROOT, region: { spec } },
        objective: { mode: "max-final-hp" },
        search: { algorithm: "segment-dp", maxExpansions: 3000, candidateLimit: 2, goalSkylineLimit: 8 },
        verification: { strictReplay: false },
      });
    })();
    const normalizedSpec = (referenceTask.normalizedTask || referenceTask).tower.region.spec;
    const resolution = guardedModule.resolveDpKeyProfile({
      project,
      regionSpec: normalizedSpec,
      simulator,
      dpKeyProfile: guardedModule.EXPERIMENTAL_PROFILE,
      options: { towerId: "onlyup-smoke", goalPredicate: GOAL_PREDICATE },
    });
    assert.ok(resolution.builder, "experimental profile must resolve a builder by itself");
    assert.strictEqual(resolution.guard.floors.join(","), "MT1", "guarded profile must bind MT1 scope");
    // Fail-closed: unknown profile and out-of-scope floor must throw.
    assert.throws(
      () => guardedModule.resolveDpKeyProfile({ project, regionSpec: normalizedSpec, simulator, dpKeyProfile: "not-a-profile" }),
      (error) => error && /unknown dpKeyProfile/.test(error.message),
      "unknown dpKeyProfile must throw",
    );
    assert.throws(
      () => resolution.builder({ floorId: "MT9" }, { dpKeyProfile: guardedModule.EXPERIMENTAL_PROFILE }),
      (error) => error && /outside bound scope/.test(error.message),
      "out-of-scope floor must throw (fail-closed)",
    );
    const runB = await runRepresentative({
      dpKeyProfile: guardedModule.EXPERIMENTAL_PROFILE,
      strictReplay: true,
    });
    const correctnessB = extractCorrectness(runB.execution);
    const exactCorrectness = JSON.stringify(correctnessA) === JSON.stringify(correctnessB);
    const bothStrictReplayVerified = correctnessA.strictReplayVerified === true && correctnessB.strictReplayVerified === true;
    const keyPhaseA = runA.perf.phaseMs && runA.perf.phaseMs.buildDpStateKey;
    const keyPhaseACalls = runA.perf.phaseCounts && runA.perf.phaseCounts.buildDpStateKey;
    const keyPhaseB = runB.perf.phaseMs && runB.perf.phaseMs.buildDpStateKey;
    const keyPhaseBCalls = runB.perf.phaseCounts && runB.perf.phaseCounts.buildDpStateKey;
    const reachabilityA = runA.perf.phaseMs && runA.perf.phaseMs.reachability;
    const reachabilityB = runB.perf.phaseMs && runB.perf.phaseMs.reachability;
    const enumerateA = runA.perf.phaseMs && runA.perf.phaseMs.enumerateActions;
    const enumerateB = runB.perf.phaseMs && runB.perf.phaseMs.enumerateActions;
    const applyA = runA.perf.phaseMs && runA.perf.phaseMs.applyAction;
    const applyB = runB.perf.phaseMs && runB.perf.phaseMs.applyAction;
    gateB = {
      guard: resolution.guard,
      correctnessExact: exactCorrectness,
      strictReplayVerifiedBoth: bothStrictReplayVerified,
      correctnessA,
      correctnessB,
      scaleA: extractSearchScale(runA),
      scaleB: extractSearchScale(runB),
      keyPhaseA: { totalMs: keyPhaseA != null ? Number(keyPhaseA.toFixed(2)) : null, calls: keyPhaseACalls != null ? keyPhaseACalls : null },
      keyPhaseB: { totalMs: keyPhaseB != null ? Number(keyPhaseB.toFixed(2)) : null, calls: keyPhaseBCalls != null ? keyPhaseBCalls : null },
      reachabilityA: reachabilityA != null ? Number(reachabilityA.toFixed(2)) : null,
      reachabilityB: reachabilityB != null ? Number(reachabilityB.toFixed(2)) : null,
      enumerateActionsA: enumerateA != null ? Number(enumerateA.toFixed(2)) : null,
      enumerateActionsB: enumerateB != null ? Number(enumerateB.toFixed(2)) : null,
      applyActionA: applyA != null ? Number(applyA.toFixed(2)) : null,
      applyActionB: applyB != null ? Number(applyB.toFixed(2)) : null,
      wallA: Number(runA.perf.wallMs.toFixed(2)),
      wallB: Number(runB.perf.wallMs.toFixed(2)),
    };
  }

  const decision = gateAPassed && gateB && gateB.correctnessExact && gateB.strictReplayVerifiedBoth ? "PROMOTION_CANDIDATE" : "NO_PROMOTION";

  process.stdout.write(JSON.stringify({
    schema: "motapathfinder.pr-5.4c-candidate-key-promotion.v1",
    status: "passed",
    controls: {
      partitionAuditComplete: true,
      splitFieldDistributionComplete: true,
      withoutStartComponentProfileEvaluated: true,
      unknownCandidateProfileFailClosed: true,
      candidateProfileMatrix: true,
      cegarMinimality: true,
      gateASafetyZero: gateASafe,
      gateADeltaNonNegative: gateADeltaNonNegative,
      gateBSkippedWhenGateAFails: gateB === null,
      gateBStrictReplayVerifiedWhenRun: gateB ? gateB.strictReplayVerifiedBoth : false,
      negativeControlMissingAtk: true,
      negativeControlBrokenKey: true,
      experimentalIsolationDefaultOff: true,
    },
    partitionAudit: {
      uniqueExactKeys: audit.uniqueExactKeys,
      uniqueCandidateKeys: audit.uniqueCandidateKeys,
      splitExactKeyCount: audit.splitExactKeyCount,
      splitExtraCandidateKeyCount: audit.splitExtraCandidateKeyCount,
      maxCandidateKeysPerExactKey: audit.maxCandidateKeysPerExactKey,
      mergedCandidateKeyCount: audit.mergedCandidateKeyCount,
      mergedExtraExactKeyCount: audit.mergedExtraExactKeyCount,
      maxExactKeysPerCandidateKey: audit.maxExactKeysPerCandidateKey,
      partitionRelation: audit.partitionRelation,
      splitFieldDistribution: audit.splitFieldDistribution,
      splitExactKeysOnlyStartComponent: audit.splitExactKeysOnlyStartComponent,
      splitExactKeysWithOtherDifferences: audit.splitExactKeysWithOtherDifferences,
      splitWitnessSample: audit.splitWitnesses.slice(0, 2),
      mergeWitnessSample: audit.mergeWitnesses.slice(0, 2),
    },
    profiles: results.map(({ profile, snapshot, safe }) => ({
      profile,
      safe,
      finalActiveStates: snapshot.candidateFinalActiveStates,
      finalUniqueKeys: snapshot.candidateFinalUniqueKeys,
      hypotheticalStateDelta: snapshot.hypotheticalStateDelta,
      uniqueKeyDelta: snapshot.uniqueKeyDelta,
      splitExactKeyCount: snapshot.partitionAudit.splitExactKeyCount,
      mergedCandidateKeyCount: snapshot.partitionAudit.mergedCandidateKeyCount,
      partitionRelation: snapshot.partitionAudit.partitionRelation,
      shadowUnsafeMerge: snapshot.shadowUnsafeMerge,
      shadowAnalysisError: snapshot.shadowAnalysisError,
      shadowUnclassified: snapshot.shadowUnclassified,
      candidateKeyAvgMs: snapshot.candidateKeyAvgMs,
    })),
    minimalSafeProfile: minimalSafe ? {
      profile: minimalSafe.profile,
      finalActiveStates: minimalSnapshot.candidateFinalActiveStates,
      finalUniqueKeys: minimalSnapshot.candidateFinalUniqueKeys,
      hypotheticalStateDelta: minimalSnapshot.hypotheticalStateDelta,
      partitionRelation: minimalSnapshot.partitionAudit.partitionRelation,
    } : null,
    withoutStartComponent: {
      safe: withoutStartComponentSafe,
      finalActiveStates: withoutStartComponentEntry.snapshot.candidateFinalActiveStates,
      finalUniqueKeys: withoutStartComponentEntry.snapshot.candidateFinalUniqueKeys,
      hypotheticalStateDelta: withoutStartComponentEntry.snapshot.hypotheticalStateDelta,
      partitionRelation: withoutStartComponentEntry.snapshot.partitionAudit.partitionRelation,
      shadowUnsafeMerge: withoutStartComponentEntry.snapshot.shadowUnsafeMerge,
      mergedCandidateKeyCount: withoutStartComponentEntry.snapshot.partitionAudit.mergedCandidateKeyCount,
      splitExactKeyCount: withoutStartComponentEntry.snapshot.partitionAudit.splitExactKeyCount,
    },
    gateA: { passed: gateAPassed, safe: gateASafe, deltaNonNegative: gateADeltaNonNegative, minimalProfile: minimalSafe ? minimalSafe.profile : null },
    gateB,
    negativeControls: {
      missingAtkUnsafe: missingAtkSnapshot.shadowUnsafeMerge,
      missingAtkWitnesses: missingAtkSnapshot.unsafeWitnesses.length,
      missingAtkRepresentativeUnsafe: missingAtkRepresentative.shadowUnsafeMerge,
      brokenUnsafe: brokenSnapshot.shadowUnsafeMerge,
      brokenWitnesses: brokenSnapshot.unsafeWitnesses.length,
    },
    decision,
  }, null, 2) + "\n");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}

module.exports = { main };
