"use strict";

/**
 * TEST GRADE: unit-plus-micro
 *
 * PR-5.4c Commit 1 Repair — Key Dependency Corpus contract (observation only).
 *
 * 1. TowerIR structural candidate really is the candidate (no exact loc, no
 *    legacy regionKey); same-component different-loc states collide.
 * 2. Zero candidate collisions => "insufficient-collisions", never "safe".
 * 3. Dominance-aware pair classification: dominance-safe / metadata-only /
 *    unsafe, proven by action-superset + shared-action successor behavior
 *    equality + successor HP monotonicity.
 * 4. Canonical action identity distinguishes same-summary/different-payload.
 * 5. Representative evidence: candidate collisions present, unclassified = 0.
 * 6. Production parity byte-for-byte with PR-5.4b baseline.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { loadProject } = require("./lib/project-loader");
const { compileTowerIR } = require("./lib/tower-ir");
const {
  analyzeCandidateKeyCollisions,
  analyzeKeyDependencyCorpus,
  buildActionIdentity,
  buildStateProjection,
  classifyPair,
} = require("./lib/key-dependency-corpus");
const { makeSimulator, executeSolveJob } = require("./lib/solver-job");
const { compileExecutableSolveTask } = require("./lib/solve-task");

const ROOT = path.resolve(__dirname, "..");
const ONLY_UP_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");
const SMOKE_SPEC_FILE = path.join(ROOT, "towers", "onlyup", "region-specs", "region-output-contract-smoke.json");

const project = loadProject(ONLY_UP_ROOT);
const smokeSpec = JSON.parse(fs.readFileSync(SMOKE_SPEC_FILE, "utf8"));
const smokeIr = compileTowerIR(project, smokeSpec, { towerId: "onlyup-smoke" });
const simulator = makeSimulator(project, smokeSpec, {});

// PR-5.4b baseline fingerprints.
const COMMIT2_REPRESENTATIVE_ROUTE_FINGERPRINT =
  '{"algorithm":"sha256-stable-json-v1","sha256":"c0adb2d921e84cab097c034bf7b6f8fdb5a344a0cb21f66ea3b7f707a4ebec13"}';
const COMMIT2_REPRESENTATIVE_WINNER_FINGERPRINT = "a2ff379819ac9003";

function makeBehaviorEntry(options) {
  const config = options || {};
  return {
    projection: {
      dominanceLabel: {
        hp: config.hp,
        rawRouteLength: config.rawRouteLength != null ? config.rawRouteLength : 0,
        decisionDepth: config.decisionDepth != null ? config.decisionDepth : 0,
      },
    },
    actionSet: config.actionSet || [],
    actions: (config.actions || []).map((action) => ({
      identity: { actionFingerprint: action.fingerprint, actionSummary: action.summary || action.fingerprint },
      successor: action.successor || null,
    })),
  };
}

function checkTowerIrStructuralCandidateIgnoresLoc() {
  const init = simulator.createInitialState({ rank: "chaos" });
  const component = smokeIr.components.find((entry) => entry.floorId === "MT1" && entry.staticCells.length >= 2);
  assert.ok(component, "MT1 must have a component with at least 2 cells");
  const [cellA, cellB] = component.staticCells;
  const stateA = JSON.parse(JSON.stringify(init));
  stateA.hero.loc.x = cellA.x;
  stateA.hero.loc.y = cellA.y;
  const stateB = JSON.parse(JSON.stringify(init));
  stateB.hero.loc.x = cellB.x;
  stateB.hero.loc.y = cellB.y;
  const projectionA = buildStateProjection(simulator, project, smokeIr, stateA);
  const projectionB = buildStateProjection(simulator, project, smokeIr, stateB);
  assert.strictEqual(
    projectionA.structuralCandidate.startComponentId,
    projectionB.structuralCandidate.startComponentId,
    "same component must yield the same startComponentId",
  );
  assert.strictEqual(
    projectionA.candidateFullBehaviorKey,
    projectionB.candidateFullBehaviorKey,
    "same component + same resources/events must yield the same candidate key",
  );
  // The legacy exact loc differs, but the TowerIR structural candidate does not
  // contain the exact loc and is identical for the same component.
  assert.deepStrictEqual(
    projectionA.structuralCandidate,
    projectionB.structuralCandidate,
    "the structural candidate must be identical for two positions in the same component",
  );
  assert.ok(
    !("loc" in projectionA.structuralCandidate) && !("loc" in projectionB.structuralCandidate),
    "structural candidate must not contain the exact hero loc",
  );
  assert.ok(
    !("regionKey" in projectionA.structuralCandidate),
    "structural candidate must not contain the legacy regionKey",
  );
}

function checkZeroCollisionsInsufficientEvidence() {
  const entries = [1, 2, 3].map((id) => ({
    projection: { candidateFullBehaviorKey: `key-${id}`, candidateStructuralResourceKey: `key-${id}`, legacyDecompositionKey: `key-${id}` },
  }));
  const result = analyzeCandidateKeyCollisions(entries, "candidateFullBehaviorKey");
  assert.strictEqual(result.collisionGroupCount, 0, "three distinct keys must not collide");
  assert.strictEqual(result.evidenceStatus, "insufficient-collisions", "zero collisions must be insufficient evidence, never safe");
}

function checkDominanceSafeClassification() {
  const low = makeBehaviorEntry({
    hp: 50,
    actionSet: ["battle:a", "pickup:b"],
    actions: [
      { fingerprint: "battle:a", successor: { dominanceLabel: { hp: 30 }, structuralCandidate: { id: "s" }, resourceIdentity: { id: "r" }, eventHazardLabel: {} } },
      { fingerprint: "pickup:b", successor: { dominanceLabel: { hp: 52 }, structuralCandidate: { id: "s" }, resourceIdentity: { id: "r" }, eventHazardLabel: {} } },
    ],
  });
  const high = makeBehaviorEntry({
    hp: 90,
    actionSet: ["battle:a", "battle:c", "pickup:b"],
    actions: [
      { fingerprint: "battle:a", successor: { dominanceLabel: { hp: 70 }, structuralCandidate: { id: "s" }, resourceIdentity: { id: "r" }, eventHazardLabel: {} } },
      { fingerprint: "battle:c", successor: { dominanceLabel: { hp: 60 }, structuralCandidate: { id: "s" }, resourceIdentity: { id: "r" }, eventHazardLabel: {} } },
      { fingerprint: "pickup:b", successor: { dominanceLabel: { hp: 92 }, structuralCandidate: { id: "s" }, resourceIdentity: { id: "r" }, eventHazardLabel: {} } },
    ],
  });
  const result = classifyPair(low, high);
  assert.strictEqual(result.classification, "dominance-safe", "high-HP superset + monotone HP must be dominance-safe");
}

function checkMetadataOnlyClassification() {
  const left = makeBehaviorEntry({
    hp: 80,
    rawRouteLength: 10,
    decisionDepth: 5,
    actionSet: ["a", "b"],
    actions: [
      { fingerprint: "a", successor: { dominanceLabel: { hp: 75 }, structuralCandidate: { id: "s" }, resourceIdentity: { id: "r" }, eventHazardLabel: {} } },
      { fingerprint: "b", successor: { dominanceLabel: { hp: 82 }, structuralCandidate: { id: "s" }, resourceIdentity: { id: "r" }, eventHazardLabel: {} } },
    ],
  });
  const right = makeBehaviorEntry({
    hp: 80,
    rawRouteLength: 14,
    decisionDepth: 7,
    actionSet: ["a", "b"],
    actions: [
      { fingerprint: "a", successor: { dominanceLabel: { hp: 75 }, structuralCandidate: { id: "s" }, resourceIdentity: { id: "r" }, eventHazardLabel: {} } },
      { fingerprint: "b", successor: { dominanceLabel: { hp: 82 }, structuralCandidate: { id: "s" }, resourceIdentity: { id: "r" }, eventHazardLabel: {} } },
    ],
  });
  const result = classifyPair(left, right);
  assert.strictEqual(result.classification, "metadata-only", "identical HP/behavior with only depth/counters differing must be metadata-only");
}

function checkUnsafeClassification() {
  // Same candidate key but a state whose event state adds an action the other
  // lacks (low-HP state has an action the high-HP state lacks) => unsafe.
  const low = makeBehaviorEntry({
    hp: 90,
    actionSet: ["battle:a", "event:x"],
    actions: [
      { fingerprint: "battle:a", successor: { dominanceLabel: { hp: 70 }, structuralCandidate: { id: "s" }, resourceIdentity: { id: "r" }, eventHazardLabel: {} } },
      { fingerprint: "event:x", successor: { dominanceLabel: { hp: 95 }, structuralCandidate: { id: "s" }, resourceIdentity: { id: "r" }, eventHazardLabel: {} } },
    ],
  });
  const high = makeBehaviorEntry({
    hp: 100,
    actionSet: ["battle:a"],
    actions: [
      { fingerprint: "battle:a", successor: { dominanceLabel: { hp: 80 }, structuralCandidate: { id: "s" }, resourceIdentity: { id: "r" }, eventHazardLabel: {} } },
    ],
  });
  const result = classifyPair(low, high);
  assert.strictEqual(result.classification, "unsafe", "an event-driven action present only in one state must be unsafe");

  // Shared action with different successor behavior => unsafe.
  const left = makeBehaviorEntry({
    hp: 60,
    actionSet: ["battle:a"],
    actions: [
      { fingerprint: "battle:a", successor: { dominanceLabel: { hp: 40 }, structuralCandidate: { id: "s1" }, resourceIdentity: { id: "r" }, eventHazardLabel: {} } },
    ],
  });
  const right = makeBehaviorEntry({
    hp: 70,
    actionSet: ["battle:a"],
    actions: [
      { fingerprint: "battle:a", successor: { dominanceLabel: { hp: 50 }, structuralCandidate: { id: "s2" }, resourceIdentity: { id: "r" }, eventHazardLabel: {} } },
    ],
  });
  const successorResult = classifyPair(left, right);
  assert.strictEqual(successorResult.classification, "unsafe", "different successor structural candidate must be unsafe");
}

function checkActionIdentityCollision() {
  const actionA = { kind: "battle", summary: "battle:slime@MT1:1,1", floorId: "MT1", x: 1, y: 1, target: "slime", travelState: { hero: { hp: 100, loc: { x: 0, y: 0 } } } };
  const actionB = { kind: "battle", summary: "battle:slime@MT1:1,1", floorId: "MT1", x: 1, y: 1, target: "slime", travelState: { hero: { hp: 50, loc: { x: 0, y: 0 } } } };
  const identityA = buildActionIdentity(actionA);
  const identityB = buildActionIdentity(actionB);
  assert.strictEqual(identityA.actionSummary, identityB.actionSummary, "summaries must be identical");
  assert.notStrictEqual(identityA.actionFingerprint, identityB.actionFingerprint, "different travel payloads must yield different fingerprints");
}

async function captureRepresentative(captureLimit) {
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
  const execution = await executeSolveJob(task, {
    jobId: "key-dependency-capture",
    onProgress: () => {},
    shouldStop: () => false,
    context: {},
  });
  const att = (execution.result.segmentResults || [])[0] && (execution.result.segmentResults[0].attempts || [])[0];
  const dp = att && att.diagnostics && att.diagnostics.dp;
  const captured = (dp && dp.capturedExpandedStates) || [];
  return { execution, captured };
}

async function main() {
  checkTowerIrStructuralCandidateIgnoresLoc();
  checkZeroCollisionsInsufficientEvidence();
  checkDominanceSafeClassification();
  checkMetadataOnlyClassification();
  checkUnsafeClassification();
  checkActionIdentityCollision();

  const { execution, captured } = await captureRepresentative(200);
  assert.strictEqual(execution.result.found, true, "representative must complete");
  assert.ok(captured.length > 0, "corpus must capture states");

  // PR-5.4b production parity.
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

  const entries = captured.map((state) => ({ state, projection: buildStateProjection(simulator, project, smokeIr, state) }));
  const analysis = analyzeKeyDependencyCorpus(entries, (state) =>
    require("./lib/key-dependency-corpus").buildStateBehavior(simulator, project, smokeIr, state),
  );

  assert.strictEqual(analysis.capturedStateCount, captured.length, "analysis must cover the full corpus");
  // Representative evidence must be non-trivial.
  assert.ok(
    analysis.behaviorKeyCollisions.collisionGroupCount > 0,
    `candidate key collisions must exist (got ${analysis.behaviorKeyCollisions.collisionGroupCount})`,
  );
  assert.ok(
    analysis.behaviorKeyCollisions.statesInCollisionGroups > 1,
    "more than one state must participate in candidate collisions",
  );
  assert.strictEqual(analysis.unclassifiedCount, 0, "no unclassified pairs allowed");

  const att = (execution.result.segmentResults || [])[0] && (execution.result.segmentResults[0].attempts || [])[0];
  const dp = att && att.diagnostics && att.diagnostics.dp;

  process.stdout.write(JSON.stringify({
    schema: "motapathfinder.pr-5.4c-key-dependency-corpus.v1",
    status: "passed",
    controls: {
      towerIrStructuralCandidateUsed: true,
      sameComponentCollides: true,
      zeroCollisionsInsufficientEvidence: true,
      dominanceSafeClassified: true,
      metadataOnlyClassified: true,
      unsafeClassified: true,
      actionIdentityCanonical: true,
      representativeCollisionsNonEmpty: true,
      unclassifiedZero: true,
      productionParityPreserved: true,
    },
    corpus: {
      capturedStateCount: analysis.capturedStateCount,
      behaviorKeyCollisions: analysis.behaviorKeyCollisions,
      structuralResourceCollisions: analysis.structuralResourceCollisions,
      legacyCollisions: analysis.legacyCollisions,
      candidateGroupsAnalyzed: analysis.candidateGroupsAnalyzed,
      statesInCandidateCollisionGroups: analysis.statesInCandidateCollisionGroups,
      behaviorBuilt: analysis.behaviorBuilt,
      classificationCounts: analysis.classificationCounts,
      dominanceSafeCount: analysis.dominanceSafeCount,
      metadataOnlyCount: analysis.metadataOnlyCount,
      unsafeCount: analysis.unsafeCount,
      unclassifiedCount: analysis.unclassifiedCount,
      unsafeWitnesses: analysis.unsafeWitnesses.slice(0, 10),
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
