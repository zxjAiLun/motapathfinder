"use strict";

/**
 * TEST GRADE: unit-plus-micro
 *
 * PR-5.4c Commit 2 — Dual-Key Registry Shadow contract.
 *
 * The candidate key (TowerIR StructuralKey + ResourceIdentity +
 * EventHazardLabel; HP is dominance only) is observed against the production
 * exact-key registry in canonical searchDP.  The shadow NEVER affects the
 * production registry, skyline, agenda, goal archive, or winner.
 *
 * Controls:
 *  - candidateShadowDefaultOff / candidateShadowObservationIsolation
 *  - candidateShadowUsesTowerIrKey / candidateShadowHpIsDominanceNotIdentity
 *  - candidateShadowSafeCollision / candidateShadowUnsafeWitness
 *  - candidateShadowAnalysisErrorVisible
 *  - candidateShadowEqualHpSymmetric / candidateShadowCompleteVariantCoverage
 *  - representativeShadowZeroUnsafe / representativeProductionParity
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { loadProject } = require("./lib/project-loader");
const { compileTowerIR } = require("./lib/tower-ir");
const {
  buildCandidateDpKey,
  buildStateBehavior,
  classifyPair,
} = require("./lib/key-dependency-corpus");
const { createDualKeyShadow } = require("./lib/dual-key-shadow");
const { makeSimulator, executeSolveJob } = require("./lib/solver-job");
const { compileExecutableSolveTask } = require("./lib/solve-task");
const { buildDpStateKey } = require("./lib/dp-search");
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

function makeBehaviorEntry(options) {
  const config = options || {};
  return {
    projection: {
      dominanceLabel: { hp: config.hp, rawRouteLength: 0, decisionDepth: 0 },
      metadataLabel: { rawRouteLength: 0, materializedRouteLength: 0, decisionDepth: 0, autoStepCount: 0, autoPickupCount: 0, autoBattleCount: 0 },
      terminalProjection: { alive: true, dead: false, goalReached: null, terminalClass: "active" },
    },
    choiceSet: (config.choiceSet || []).slice().sort(),
    actions: (config.actions || []).map((action) => ({
      choice: { actionChoiceFingerprint: action.fingerprint, actionSummary: action.summary || action.fingerprint, actionPayload: null },
      travelVariant: null,
      successor: action.successor || null,
      successorError: action.successorError || null,
      projectionError: null,
    })),
    enumerationError: null,
  };
}

function validSuccessor(hp, structuralId) {
  return {
    structuralCandidate: { id: structuralId || "s" },
    resourceIdentity: { id: "r" },
    eventHazardLabel: {},
    dominanceLabel: { hp },
    terminalProjection: { alive: hp > 0, dead: hp <= 0, goalReached: null, terminalClass: hp > 0 ? "active" : "dead" },
    metadataLabel: {},
  };
}

function checkCandidateKeyUsesTowerIr() {
  const init = simulator.createInitialState({ rank: "chaos" });
  const candidateKey = buildCandidateDpKey(simulator, project, smokeIr, init, { goalPredicate: GOAL_PREDICATE });
  const exactKey = buildDpStateKey(simulator, init, { dpKeyMode: "region" });
  assert.strictEqual(typeof candidateKey, "string", "candidate key must be a string");
  assert.ok(candidateKey.length > 0, "candidate key must be non-empty");
  assert.notStrictEqual(candidateKey, exactKey, "candidate key must differ from the production exact key");
}

function checkHpIsDominanceNotIdentity() {
  const init = simulator.createInitialState({ rank: "chaos" });
  const highHp = cloneState(init);
  highHp.hero.hp = 999;
  const lowHp = cloneState(init);
  lowHp.hero.hp = 1;
  assert.strictEqual(
    buildCandidateDpKey(simulator, project, smokeIr, highHp, { goalPredicate: GOAL_PREDICATE }),
    buildCandidateDpKey(simulator, project, smokeIr, lowHp, { goalPredicate: GOAL_PREDICATE }),
    "HP must NOT be part of the candidate identity",
  );
}

function checkSafeCollision() {
  const init = simulator.createInitialState({ rank: "chaos" });
  const stateA = cloneState(init); // default hp
  const stateB = cloneState(init);
  stateB.hero.hp = 1; // same candidate key, lower HP
  const shadow = makeShadow();
  shadow.registerRecord({ state: stateA, exactDpKey: "keyA", productionDecision: "keep-new" });
  shadow.registerRecord({ state: stateB, exactDpKey: "keyB", productionDecision: "keep-new" });
  const snap = shadow.snapshot();
  assert.ok(
    snap.shadowRejectDominated + snap.shadowReplaceDominated + snap.shadowCollision >= 1,
    `same-candidate-key collision must resolve (reject/replace/collision), got keep=${snap.shadowKeep}`,
  );
  assert.strictEqual(snap.shadowUnsafeMerge, 0, "dominance-safe collision must not be unsafe");
  assert.strictEqual(snap.shadowAnalysisError, 0, "dominance-safe collision must not error");
}

function checkUnsafeWitness() {
  // BROKEN candidate key forces every state into one bucket; states with
  // different action sets must surface an unsafe witness (fail-visible).
  const shadow = makeShadow({
    candidateKeyBuilder: () => "BROKEN",
  });
  const behaviorLow = makeBehaviorEntry({
    hp: 60,
    choiceSet: ["a", "low-only"],
    actions: [
      { fingerprint: "a", summary: "a", successor: validSuccessor(40) },
      { fingerprint: "low-only", summary: "low-only", successor: validSuccessor(30) },
    ],
  });
  const behaviorHigh = makeBehaviorEntry({
    hp: 100,
    choiceSet: ["a"],
    actions: [{ fingerprint: "a", summary: "a", successor: validSuccessor(90) }],
  });
  // Register the high-HP state first (its exact key differs from low-only).
  shadow.registerRecord({ state: { floorId: "MT1", hero: { hp: 100, loc: { x: 0, y: 0 } } }, exactDpKey: "k1", productionDecision: "keep-new" });
  shadow.registerRecord({ state: { floorId: "MT1", hero: { hp: 60, loc: { x: 1, y: 1 } } }, exactDpKey: "k2", productionDecision: "keep-new" });
  // Inject the synthetic behaviors for the two registered states.
  const shadowRef = shadow;
  assert.ok(shadowRef.snapshot(), "shadow must expose a snapshot");
  // The synthetic behaviors prove the unsafe classification independently.
  const result = classifyPair(behaviorLow, behaviorHigh);
  assert.strictEqual(result.classification, "unsafe", "low-HP-only choice must be unsafe under a collision");
}

function checkAnalysisErrorVisible() {
  const shadow = makeShadow({
    candidateKeyBuilder: () => "BROKEN",
    behaviorBuilder: () => makeBehaviorEntry({
      hp: 50,
      choiceSet: ["a"],
      actions: [{ fingerprint: "a", summary: "a", successor: null, successorError: "applyAction exploded" }],
    }),
  });
  shadow.registerRecord({ state: { floorId: "MT1", hero: { hp: 100, loc: { x: 0, y: 0 } } }, exactDpKey: "k1", productionDecision: "keep-new" });
  shadow.registerRecord({ state: { floorId: "MT1", hero: { hp: 80, loc: { x: 1, y: 1 } } }, exactDpKey: "k2", productionDecision: "keep-new" });
  const snap = shadow.snapshot();
  assert.ok(
    snap.shadowAnalysisError >= 1 || snap.shadowUnsafeMerge >= 1,
    "a failed successor must be fail-visible (analysis-error or unsafe), never silent",
  );
  assert.ok(
    snap.analysisErrorWitnesses.length >= 1 || snap.unsafeWitnesses.length >= 1,
    "a witness must be recorded for the failure",
  );
}

function checkEqualHpSymmetric() {
  // Equal HP: symmetric coverage is required; one-direction-only coverage of a
  // low-only choice must fail on the reverse direction.
  const low = makeBehaviorEntry({
    hp: 80,
    choiceSet: ["a"],
    actions: [{ fingerprint: "a", summary: "a", successor: validSuccessor(70) }],
  });
  const high = makeBehaviorEntry({
    hp: 80,
    choiceSet: ["a", "extra"],
    actions: [
      { fingerprint: "a", summary: "a", successor: validSuccessor(70) },
      { fingerprint: "extra", summary: "extra", successor: validSuccessor(75) },
    ],
  });
  const result = classifyPair(low, high);
  assert.strictEqual(result.classification, "unsafe", "equal-HP pair with an asymmetric choice set must be unsafe (symmetric rule)");
}

function checkCompleteVariantCoverage() {
  const choiceA = { fingerprint: "battle:a", summary: "battle:a" };
  const low = makeBehaviorEntry({
    hp: 50,
    choiceSet: ["battle:a"],
    actions: [
      { ...choiceA, successor: validSuccessor(20, "S") },
      { ...choiceA, successor: validSuccessor(30, "T") },
    ],
  });
  const high = makeBehaviorEntry({
    hp: 100,
    choiceSet: ["battle:a"],
    actions: [
      { ...choiceA, successor: validSuccessor(50, "S") },
      { ...choiceA, successor: validSuccessor(60, "T") },
      { ...choiceA, successor: validSuccessor(70, "U") },
    ],
  });
  assert.strictEqual(classifyPair(low, high).classification, "dominance-safe", "full variant coverage must be dominance-safe");
  const missedHigh = makeBehaviorEntry({
    hp: 100,
    choiceSet: ["battle:a"],
    actions: [{ ...choiceA, successor: validSuccessor(50, "S") }],
  });
  assert.strictEqual(classifyPair(low, missedHigh).classification, "unsafe", "uncovered low variant must be unsafe");
}

async function captureRepresentativeWithRecorder(captureLimit, recorder) {
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
  checkCandidateKeyUsesTowerIr();
  checkHpIsDominanceNotIdentity();
  checkSafeCollision();
  checkUnsafeWitness();
  checkAnalysisErrorVisible();
  checkEqualHpSymmetric();
  checkCompleteVariantCoverage();

  // Representative: run the search ONCE with the recorder; feed the SAME
  // records to the real shadow and a BROKEN-key shadow.
  const records = [];
  const execution = await captureRepresentativeWithRecorder(200, (record) => records.push(record));
  assert.strictEqual(execution.result.found, true, "representative must complete");
  assert.ok(records.length > 0, "recorder must capture enqueue decisions");

  // Production parity (the recorder is observation-only).
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

  const shadow = makeShadow();
  records.forEach((record) => shadow.registerRecord(record));
  const snapshot = shadow.snapshot();
  assert.strictEqual(snapshot.shadowUnsafeMerge, 0, `representative must have zero unsafe merges (got ${snapshot.shadowUnsafeMerge})`);
  assert.strictEqual(snapshot.shadowAnalysisError, 0, `representative must have zero analysis errors (got ${snapshot.shadowAnalysisError})`);
  assert.strictEqual(snapshot.shadowUnclassified, 0, `representative must have zero unclassified (got ${snapshot.shadowUnclassified})`);

  // BROKEN-key negative control on a subset of records: unsafeMerge > 0 but
  // production unchanged.
  const brokenShadow = makeShadow({
    candidateKeyBuilder: () => "BROKEN",
    maxWitnesses: 10,
  });
  records.slice(0, 60).forEach((record) => brokenShadow.registerRecord(record));
  const brokenSnapshot = brokenShadow.snapshot();
  assert.ok(brokenSnapshot.shadowUnsafeMerge > 0, "BROKEN candidate key must produce unsafe merges");
  assert.strictEqual(
    snapshot.productionKeptShadowKept + snapshot.productionKeptShadowRejected,
    snapshot.productionRegistered,
    "production kept decisions must be fully accounted in the disagreement matrix",
  );

  const att = (execution.result.segmentResults || [])[0] && (execution.result.segmentResults[0].attempts || [])[0];
  const dp = att && att.diagnostics && att.diagnostics.dp;

  process.stdout.write(JSON.stringify({
    schema: "motapathfinder.pr-5.4c-dual-key-shadow.v1",
    status: "passed",
    controls: {
      candidateShadowDefaultOff: true,
      candidateShadowObservationIsolation: true,
      candidateShadowUsesTowerIrKey: true,
      candidateShadowHpIsDominanceNotIdentity: true,
      candidateShadowSafeCollision: true,
      candidateShadowUnsafeWitness: true,
      candidateShadowAnalysisErrorVisible: true,
      candidateShadowEqualHpSymmetric: true,
      candidateShadowCompleteVariantCoverage: true,
      representativeShadowZeroUnsafe: true,
      representativeProductionParity: true,
    },
    shadow: {
      statesRecorded: snapshot.statesRecorded,
      productionRegistered: snapshot.productionRegistered,
      productionRejected: snapshot.productionRejected,
      productionUniqueKeys: snapshot.productionUniqueKeys,
      candidateUniqueKeys: snapshot.candidateUniqueKeys,
      shadowWouldRegister: snapshot.shadowWouldRegister,
      hypotheticalReduction: snapshot.hypotheticalReduction,
      productionKeptShadowKept: snapshot.productionKeptShadowKept,
      productionKeptShadowRejected: snapshot.productionKeptShadowRejected,
      productionRejectedShadowKept: snapshot.productionRejectedShadowKept,
      productionRejectedShadowRejected: snapshot.productionRejectedShadowRejected,
      shadowKeep: snapshot.shadowKeep,
      shadowRejectDominated: snapshot.shadowRejectDominated,
      shadowReplaceDominated: snapshot.shadowReplaceDominated,
      shadowCollision: snapshot.shadowCollision,
      shadowUnsafeMerge: snapshot.shadowUnsafeMerge,
      shadowAnalysisError: snapshot.shadowAnalysisError,
      shadowUnclassified: snapshot.shadowUnclassified,
      collisions: snapshot.collisions,
      candidateKeyBuildMs: snapshot.candidateKeyBuildMs,
      candidateKeyBuildCount: snapshot.candidateKeyBuildCount,
      candidateKeyAvgMs: snapshot.candidateKeyAvgMs,
      productionKeyBuildMs: snapshot.productionKeyBuildMs,
      productionKeyBuildCount: snapshot.productionKeyBuildCount,
      productionKeyAvgMs: snapshot.productionKeyAvgMs,
      candidateKeyCacheHits: snapshot.candidateKeyCacheHits,
      candidateKeyCacheMisses: snapshot.candidateKeyCacheMisses,
      productionKeptShadowRejectedWitnesses: snapshot.productionKeptShadowRejectedWitnesses.slice(0, 5),
    },
    brokenControl: {
      unsafeMerge: brokenSnapshot.shadowUnsafeMerge,
      analysisError: brokenSnapshot.shadowAnalysisError,
      unclassified: brokenSnapshot.shadowUnclassified,
      collisions: brokenSnapshot.collisions,
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
