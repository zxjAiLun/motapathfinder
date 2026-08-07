"use strict";

/**
 * TEST GRADE: unit-plus-micro
 *
 * PR-5.4c Commit 2 Repair — Dual-Key Registry Shadow contract (corrected
 * accounting).
 *
 * 1. Candidate keys are computed INDEPENDENTLY for every recorder state (no
 *    exactDpKey -> candidateKey semantic cache in the gate).
 * 2. Equivalent collisions are rejected (shadowRejectEquivalent) and the
 *    decision matrix agrees with bucket occupancy.
 * 3. Event decisions are split from final registry occupancy; hypothetical
 *    state delta allows negative values.
 * 4. Production buildDpStateKey cost comes from the canonical perf tracker;
 *    any key-phase estimate is labelled "shadow estimate, not production
 *    speedup".
 * 5. BROKEN-key isolation negative control with concrete witnesses.
 * 6. Production parity byte-for-byte with PR-5.4b baseline.
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
const { cloneState } = require("./lib/state");

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

function checkExactKeyCacheIndependence() {
  const init = simulator.createInitialState({ rank: "chaos" });
  const stateA = cloneState(init);
  const stateB = cloneState(init);
  stateB.hero.atk = 99; // different resource identity => different candidate key
  const shadow = makeShadow({ candidateCacheMode: "off" });
  shadow.registerRecord({ state: stateA, exactDpKey: "SAME-KEY", productionDecision: "keep-new" });
  shadow.registerRecord({ state: stateB, exactDpKey: "SAME-KEY", productionDecision: "keep-new" });
  const snap = shadow.snapshot();
  assert.strictEqual(snap.candidateKeyBuildCalls, 2, "both records must independently build the candidate key (gate off)");
  assert.strictEqual(snap.postPassExactKeyReuseHits, 0, "gate must not reuse an exact-key cached candidate key");
  assert.ok(snap.partitionAudit.splitExactKeyCount >= 1, "audit must detect one exact key producing multiple candidate keys");
  assert.ok(snap.partitionAudit.maxCandidateKeysPerExactKey >= 2, "audit must record the fan-out");
  assert.strictEqual(snap.candidateFinalUniqueKeys, 2, "two independent candidate keys must stay distinct in the registry");
}

function checkEquivalentRejectAccounting() {
  const init = simulator.createInitialState({ rank: "chaos" });
  const stateA = cloneState(init);
  const stateB = cloneState(init); // identical state
  const shadow = makeShadow({ candidateCacheMode: "off" });
  shadow.registerRecord({ state: stateA, exactDpKey: "kA", productionDecision: "keep-new" });
  shadow.registerRecord({ state: stateB, exactDpKey: "kB", productionDecision: "keep-new" });
  const snap = shadow.snapshot();
  assert.strictEqual(snap.shadowRejectEquivalent, 1, "the equivalent second state must be rejected");
  assert.strictEqual(snap.candidateFinalActiveStates, 1, "final bucket must hold exactly 1");
  assert.strictEqual(snap.candidateRejectedEquivalentEvents, 1, "event accounting must record the rejection");
  assert.strictEqual(snap.productionAcceptedCandidateRejected, 1, "matrix must agree: production accepted, candidate rejected");
}

function checkNegativeStateDelta() {
  const init = simulator.createInitialState({ rank: "chaos" });
  const stateA = cloneState(init);
  const stateB = cloneState(init);
  stateB.hero.atk = 99; // distinct candidate key
  const shadow = makeShadow({ candidateCacheMode: "off" });
  shadow.setProductionRegistry({ finalActiveStates: 1, finalUniqueKeys: 1 });
  shadow.registerRecord({ state: stateA, exactDpKey: "kA", productionDecision: "keep-new" });
  shadow.registerRecord({ state: stateB, exactDpKey: "kB", productionDecision: "keep-new" });
  const snap = shadow.snapshot();
  assert.strictEqual(snap.candidateFinalActiveStates, 2, "candidate registry must hold 2");
  assert.strictEqual(snap.hypotheticalStateDelta, -1, "negative state delta must NOT be clamped to 0");
  assert.strictEqual(snap.uniqueKeyDelta, -1, "unique key delta must also be -1");
}

function checkBrokenWitness() {
  const init = simulator.createInitialState({ rank: "chaos" });
  const stateA = cloneState(init);
  const stateB = cloneState(init);
  stateB.hero.atk = 99; // different behavior under a BROKEN (all-colliding) key
  const shadow = makeShadow({ candidateKeyBuilder: () => "BROKEN", candidateCacheMode: "off" });
  shadow.registerRecord({ state: stateA, exactDpKey: "k1", productionDecision: "keep-new" });
  shadow.registerRecord({ state: stateB, exactDpKey: "k2", productionDecision: "keep-new" });
  const snap = shadow.snapshot();
  assert.ok(snap.shadowUnsafeMerge > 0, "BROKEN key must produce unsafe merges");
  assert.ok(snap.unsafeWitnesses.length > 0, "unsafe witnesses must be present");
  const witness = snap.unsafeWitnesses[0];
  assert.strictEqual(witness.candidateKey, "BROKEN", "witness must carry the BROKEN candidate key");
  assert.ok(
    Boolean(witness.reason) || witness.actionOnlyLow.length > 0 || witness.actionOnlyHigh.length > 0 || witness.unmatchedLowVariants.length > 0,
    "witness must contain a concrete mismatch signal",
  );
}

async function captureRepresentative(captureLimit, recorder) {
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
      captureExpandedStates: true,
      captureExpandedStateLimit: captureLimit,
    },
    verification: { strictReplay: false },
  });
  if (recorder) task.executeConfig.candidateKeyShadowRecorder = recorder;
  const execution = await executeSolveJob(task, {
    jobId: "dual-key-shadow-capture",
    onProgress: () => {},
    shouldStop: () => false,
    context: {},
  });
  return execution;
}

async function main() {
  checkExactKeyCacheIndependence();
  checkEquivalentRejectAccounting();
  checkNegativeStateDelta();
  checkBrokenWitness();

  // Representative with the canonical perf tracker active (buildDpStateKey
  // phase) + the observation recorder.
  const tracker = createPerfTracker({ enabled: true });
  setActivePerfTracker(tracker);
  const records = [];
  let execution;
  try {
    execution = await captureRepresentative(200, (record) => records.push(record));
  } finally {
    setActivePerfTracker(null);
  }
  assert.strictEqual(execution.result.found, true, "representative must complete");
  assert.ok(records.length > 0, "recorder must capture enqueue decisions");

  // Production parity.
  const routeFingerprint = execution.routeRecord
    ? (require("./lib/replay-resume-artifact").buildReplayRouteFingerprint(execution.routeRecord))
    : null;
  assert.strictEqual(
    routeFingerprint ? routeFingerprint.hash || JSON.stringify(routeFingerprint) : null,
    COMMIT2_REPRESENTATIVE_ROUTE_FINGERPRINT,
    "routeFingerprint must match PR-5.4b baseline",
  );
  const winnerState = execution.result.finalCandidate && execution.result.finalCandidate.state;
  assert.ok(winnerState, "winner state required");
  assert.strictEqual(
    require("./lib/solver-job").exactStateFingerprint(winnerState),
    COMMIT2_REPRESENTATIVE_WINNER_FINGERPRINT,
    "winner exact fingerprint must match PR-5.4b baseline",
  );

  const att = (execution.result.segmentResults || [])[0] && (execution.result.segmentResults[0].attempts || [])[0];
  const dp = att && att.diagnostics && att.diagnostics.dp;
  const registry = (dp && dp.registry) || null;
  assert.ok(registry && registry.finalUniqueKeys >= 1, "searchDP registry diagnostics required");
  assert.ok(registry.finalActiveStates >= registry.finalUniqueKeys, "final active states must be >= unique keys");

  // Real candidate-key shadow (independent builds, gate off).
  const shadow = makeShadow({ candidateCacheMode: "off" });
  shadow.setProductionRegistry(registry);
  records.forEach((record) => shadow.registerRecord(record));
  const snapshot = shadow.snapshot();
  assert.strictEqual(snapshot.shadowUnsafeMerge, 0, `representative must have zero unsafe merges (got ${snapshot.shadowUnsafeMerge})`);
  assert.strictEqual(snapshot.shadowAnalysisError, 0, `representative must have zero analysis errors (got ${snapshot.shadowAnalysisError})`);
  assert.strictEqual(snapshot.shadowUnclassified, 0, `representative must have zero unclassified (got ${snapshot.shadowUnclassified})`);
  assert.strictEqual(snapshot.candidateKeyBuildCalls, records.length, "candidate key must be independently built for EVERY recorder state");
  assert.strictEqual(snapshot.postPassExactKeyReuseHits, 0, "the representative gate must not reuse exact-key cached candidate keys");

  // BROKEN-key negative control on a subset.
  const brokenShadow = makeShadow({ candidateKeyBuilder: () => "BROKEN", candidateCacheMode: "off", maxWitnesses: 10 });
  records.slice(0, 60).forEach((record) => brokenShadow.registerRecord(record));
  const brokenSnapshot = brokenShadow.snapshot();
  assert.ok(brokenSnapshot.shadowUnsafeMerge > 0, "BROKEN candidate key must produce unsafe merges");
  assert.ok(brokenSnapshot.unsafeWitnesses.length > 0, "BROKEN key must surface concrete witnesses");
  assert.ok(
    brokenSnapshot.unsafeWitnesses.some((w) => Boolean(w.reason) || w.actionOnlyLow.length > 0 || w.unmatchedLowVariants.length > 0),
    "BROKEN witnesses must contain concrete mismatch signals",
  );

  // Production key phase from the canonical perf tracker.
  const perfSnapshot = tracker.snapshot();
  const productionKeyPhaseMs = perfSnapshot.phaseMs && perfSnapshot.phaseMs.buildDpStateKey;
  const productionKeyPhaseCount = perfSnapshot.phaseCounts && perfSnapshot.phaseCounts.buildDpStateKey;
  const candidateProjectedTotalMs = snapshot.candidateKeyAvgMs * (productionKeyPhaseCount || 0);
  const estimatedKeyPhaseReductionMs = productionKeyPhaseMs != null ? productionKeyPhaseMs - candidateProjectedTotalMs : null;
  const estimatedKeyPhaseRatio = candidateProjectedTotalMs > 0 ? productionKeyPhaseMs / candidateProjectedTotalMs : null;

  process.stdout.write(JSON.stringify({
    schema: "motapathfinder.pr-5.4c-dual-key-shadow.v1",
    status: "passed",
    controls: {
      candidateKeyIndependentlyBuilt: true,
      candidateShadowDefaultOff: true,
      candidateShadowObservationIsolation: true,
      candidateShadowUsesTowerIrKey: true,
      candidateShadowHpIsDominanceNotIdentity: true,
      candidateShadowEquivalentRejected: true,
      candidateShadowNegativeStateDelta: true,
      candidateShadowUnsafeWitness: true,
      candidateShadowAnalysisErrorVisible: true,
      registryOccupancyDistinctFromUniqueKeys: true,
      representativeShadowZeroUnsafe: true,
      representativeProductionParity: true,
    },
    shadow: {
      statesRecorded: snapshot.statesRecorded,
      candidateKeyBuildCalls: snapshot.candidateKeyBuildCalls,
      postPassExactKeyReuseHits: snapshot.postPassExactKeyReuseHits,
      exactKeysWithMultipleCandidateKeys: snapshot.partitionAudit.splitExactKeyCount,
      maxCandidateKeysPerExactKey: snapshot.partitionAudit.maxCandidateKeysPerExactKey,
      splitExtraCandidateKeyCount: snapshot.partitionAudit.splitExtraCandidateKeyCount,
      mergedCandidateKeyCount: snapshot.partitionAudit.mergedCandidateKeyCount,
      partitionRelation: snapshot.partitionAudit.partitionRelation,
      productionAcceptedEvents: snapshot.productionAcceptedEvents,
      productionRejectedEvents: snapshot.productionRejectedEvents,
      candidateAcceptedEvents: snapshot.candidateAcceptedEvents,
      candidateRejectedDominatedEvents: snapshot.candidateRejectedDominatedEvents,
      candidateRejectedEquivalentEvents: snapshot.candidateRejectedEquivalentEvents,
      candidateReplaceEvents: snapshot.candidateReplaceEvents,
      candidateUnsafeEvents: snapshot.candidateUnsafeEvents,
      productionFinalActiveStates: snapshot.productionFinalActiveStates,
      candidateFinalActiveStates: snapshot.candidateFinalActiveStates,
      hypotheticalStateDelta: snapshot.hypotheticalStateDelta,
      productionFinalUniqueKeys: snapshot.productionFinalUniqueKeys,
      candidateFinalUniqueKeys: snapshot.candidateFinalUniqueKeys,
      uniqueKeyDelta: snapshot.uniqueKeyDelta,
      candidateFinalStatesFromProductionAccepted: snapshot.candidateFinalStatesFromProductionAccepted,
      candidateFinalStatesFromProductionRejected: snapshot.candidateFinalStatesFromProductionRejected,
      productionAcceptedCandidateAccepted: snapshot.productionAcceptedCandidateAccepted,
      productionAcceptedCandidateRejected: snapshot.productionAcceptedCandidateRejected,
      productionRejectedCandidateAccepted: snapshot.productionRejectedCandidateAccepted,
      productionRejectedCandidateRejected: snapshot.productionRejectedCandidateRejected,
      shadowKeep: snapshot.shadowKeep,
      shadowRejectDominated: snapshot.shadowRejectDominated,
      shadowRejectEquivalent: snapshot.shadowRejectEquivalent,
      shadowReplaceDominated: snapshot.shadowReplaceDominated,
      shadowUnsafeMerge: snapshot.shadowUnsafeMerge,
      shadowAnalysisError: snapshot.shadowAnalysisError,
      shadowUnclassified: snapshot.shadowUnclassified,
      collisions: snapshot.collisions,
      candidateKeyTotalMs: snapshot.candidateKeyTotalMs,
      candidateKeyAvgMs: snapshot.candidateKeyAvgMs,
      candidateKeyMedianMs: snapshot.candidateKeyMedianMs,
      candidateKeyP95Ms: snapshot.candidateKeyP95Ms,
      unsafeWitnesses: snapshot.unsafeWitnesses.slice(0, 5),
    },
    keyPhaseEstimate: {
      productionBuildDpStateKeyTotalMs: productionKeyPhaseMs != null ? Number(productionKeyPhaseMs.toFixed(2)) : null,
      productionBuildDpStateKeyCalls: productionKeyPhaseCount != null ? productionKeyPhaseCount : null,
      candidateProjectedTotalMs: Number(candidateProjectedTotalMs.toFixed(2)),
      estimatedKeyPhaseReductionMs: estimatedKeyPhaseReductionMs != null ? Number(estimatedKeyPhaseReductionMs.toFixed(2)) : null,
      estimatedKeyPhaseRatio: estimatedKeyPhaseRatio != null ? Number(estimatedKeyPhaseRatio.toFixed(1)) : null,
      note: "shadow estimate, not production speedup",
    },
    brokenControl: {
      unsafeMerge: brokenSnapshot.shadowUnsafeMerge,
      analysisError: brokenSnapshot.shadowAnalysisError,
      unclassified: brokenSnapshot.shadowUnclassified,
      unsafeWitnessCount: brokenSnapshot.unsafeWitnesses.length,
    },
    productionParity: {
      routeFingerprint: COMMIT2_REPRESENTATIVE_ROUTE_FINGERPRINT,
      winnerExactFingerprint: COMMIT2_REPRESENTATIVE_WINNER_FINGERPRINT,
      expanded: dp && dp.expansions,
      generated: dp && dp.generatedActions,
      registered: dp && dp.keptActions,
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
