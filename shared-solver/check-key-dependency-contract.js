"use strict";

/**
 * TEST GRADE: unit-plus-micro
 *
 * PR-5.4c Commit 1 Repair 2 — normalized Key Dependency Corpus contract.
 *
 * 1. Action choice identity excludes HP/travel; same target with different
 *    travelState/path yields the same actionChoiceFingerprint and different
 *    travelVariantFingerprint.  Truly different choices remain distinguishable.
 * 2. Missing / failed successor evidence is fail-visible: analysis-error, never
 *    silently judged safe.
 * 3. Terminal projection (alive/dead/goalReached/terminalClass) uses the real
 *    workload goal predicate and participates in classification.
 * 4. Witnesses use explicit lowHpState / highHpState direction.
 * 5. Representative re-analysis: analysisErrorCount = 0, unsafe counts split
 *    by action-choice / travel-variant / successor / terminal cause.
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
  buildActionChoiceIdentity,
  buildActionTravelVariant,
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

const GOAL_PREDICATE = (state) => Boolean(state.hero && (state.hero.exp || 0) >= 9);

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
        materializedRouteLength: config.materializedRouteLength != null ? config.materializedRouteLength : 0,
        decisionDepth: config.decisionDepth != null ? config.decisionDepth : 0,
      },
      metadataLabel: {
        rawRouteLength: config.rawRouteLength != null ? config.rawRouteLength : 0,
        materializedRouteLength: config.materializedRouteLength != null ? config.materializedRouteLength : 0,
        decisionDepth: config.decisionDepth != null ? config.decisionDepth : 0,
        autoStepCount: config.autoStepCount != null ? config.autoStepCount : 0,
        autoPickupCount: config.autoPickupCount != null ? config.autoPickupCount : 0,
        autoBattleCount: config.autoBattleCount != null ? config.autoBattleCount : 0,
      },
      terminalProjection: config.terminal || { alive: true, dead: false, goalReached: null, terminalClass: "active" },
    },
    choiceSet: (config.choiceSet || []).slice().sort(),
    actions: (config.actions || []).map((action) => ({
      choice: { actionChoiceFingerprint: action.fingerprint, actionSummary: action.summary || action.fingerprint, actionPayload: action.payload || null },
      travelVariant: action.travelVariant || null,
      successor: action.successor || null,
      successorError: action.successorError || null,
      projectionError: action.projectionError || null,
    })),
    enumerationError: config.enumerationError || null,
  };
}

function validSuccessor(hp, extra) {
  return {
    structuralCandidate: { id: "s" },
    resourceIdentity: { id: "r" },
    eventHazardLabel: {},
    dominanceLabel: { hp },
    terminalProjection: { alive: hp > 0, dead: hp <= 0, goalReached: null, terminalClass: hp > 0 ? "active" : "dead" },
    metadataLabel: {},
    ...(extra || {}),
  };
}

function checkChoiceIdentityExcludesHp() {
  const baseTravel = JSON.parse(JSON.stringify(simulator.createInitialState({ rank: "chaos" })));
  const travelHigh = JSON.parse(JSON.stringify(baseTravel));
  travelHigh.hero.hp = 100;
  const travelLow = JSON.parse(JSON.stringify(baseTravel));
  travelLow.hero.hp = 40;
  const actionHigh = { kind: "battle", summary: "battle:slime@MT1:1,1", floorId: "MT1", target: { x: 1, y: 1 }, enemyId: "slime", path: ["up"], travelState: travelHigh };
  const actionLow = { kind: "battle", summary: "battle:slime@MT1:1,1", floorId: "MT1", target: { x: 1, y: 1 }, enemyId: "slime", path: ["up", "up"], travelState: travelLow };
  const choiceHigh = buildActionChoiceIdentity(actionHigh);
  const choiceLow = buildActionChoiceIdentity(actionLow);
  assert.strictEqual(choiceHigh.actionChoiceFingerprint, choiceLow.actionChoiceFingerprint, "HP/travel differences must NOT change the choice identity");
  const variantHigh = buildActionTravelVariant(actionHigh, simulator, project, smokeIr, { goalPredicate: GOAL_PREDICATE });
  const variantLow = buildActionTravelVariant(actionLow, simulator, project, smokeIr, { goalPredicate: GOAL_PREDICATE });
  assert.ok(variantHigh && variantLow, "travel variants must be built");
  assert.notStrictEqual(variantHigh.travelVariantFingerprint, variantLow.travelVariantFingerprint, "travel variants must differ (path/HP)");
}

function checkChoiceIdentityDistinguishesChoices() {
  const actionC = { kind: "battle", summary: "battle:slime@MT1:1,1", floorId: "MT1", target: { x: 1, y: 1 }, enemyId: "slime" };
  const actionD = { kind: "battle", summary: "battle:slime@MT1:1,1", floorId: "MT1", target: { x: 5, y: 5 }, enemyId: "slime" };
  assert.strictEqual(actionC.summary, actionD.summary, "summaries must be identical");
  assert.notStrictEqual(
    buildActionChoiceIdentity(actionC).actionChoiceFingerprint,
    buildActionChoiceIdentity(actionD).actionChoiceFingerprint,
    "different target must yield different choice fingerprints",
  );
}

function checkMissingSuccessorFailVisible() {
  const left = makeBehaviorEntry({
    hp: 50,
    choiceSet: ["battle:a"],
    actions: [{ fingerprint: "battle:a", summary: "battle:a", successor: validSuccessor(40) }],
  });
  const right = makeBehaviorEntry({
    hp: 80,
    choiceSet: ["battle:a"],
    actions: [{ fingerprint: "battle:a", summary: "battle:a", successor: null, successorError: "applyAction exploded" }],
  });
  const result = classifyPair(left, right);
  assert.strictEqual(result.classification, "analysis-error", "failed successor must be fail-visible, never safe");
}

function checkTerminalDifferential() {
  // Low-HP goal reached, high-HP not => unsafe terminal.
  const low = makeBehaviorEntry({
    hp: 30,
    terminal: { alive: true, dead: false, goalReached: true, terminalClass: "goal" },
    choiceSet: ["a"],
    actions: [{ fingerprint: "a", summary: "a", successor: validSuccessor(30) }],
  });
  const high = makeBehaviorEntry({
    hp: 100,
    terminal: { alive: true, dead: false, goalReached: false, terminalClass: "active" },
    choiceSet: ["a"],
    actions: [{ fingerprint: "a", summary: "a", successor: validSuccessor(100) }],
  });
  const goalResult = classifyPair(low, high);
  assert.strictEqual(goalResult.classification, "unsafe", "goal reached by low-HP but not high-HP must be unsafe");
  assert.ok(goalResult.terminalDiffs && goalResult.terminalDiffs.length > 0, "terminal diff must be recorded");
}

function checkWitnessDirection() {
  const low = makeBehaviorEntry({
    hp: 40,
    choiceSet: ["a", "low-only"],
    actions: [
      { fingerprint: "a", summary: "a", successor: validSuccessor(30) },
      { fingerprint: "low-only", summary: "low-only", successor: validSuccessor(20) },
    ],
  });
  const high = makeBehaviorEntry({
    hp: 90,
    choiceSet: ["a"],
    actions: [{ fingerprint: "a", summary: "a", successor: validSuccessor(80) }],
  });
  const result = classifyPair(low, high);
  assert.strictEqual(result.classification, "unsafe", "low-HP-only choice must be unsafe");
  assert.ok(result.actionOnlyLow && result.actionOnlyLow.length > 0, "actionOnlyLow must be populated");
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
  checkChoiceIdentityExcludesHp();
  checkChoiceIdentityDistinguishesChoices();
  checkMissingSuccessorFailVisible();
  checkTerminalDifferential();
  checkWitnessDirection();

  const { execution, captured } = await captureRepresentative(200);
  assert.strictEqual(execution.result.found, true, "representative must complete");
  assert.ok(captured.length > 0, "corpus must capture states");

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

  const entries = captured.map((state) => ({
    state,
    projection: buildStateProjection(simulator, project, smokeIr, state, { goalPredicate: GOAL_PREDICATE }),
  }));
  const analysis = analyzeKeyDependencyCorpus(entries, (state) =>
    require("./lib/key-dependency-corpus").buildStateBehavior(simulator, project, smokeIr, state, { goalPredicate: GOAL_PREDICATE }),
  );

  assert.strictEqual(analysis.capturedStateCount, captured.length, "analysis must cover the full corpus");
  assert.ok(analysis.behaviorKeyCollisions.collisionGroupCount > 0, "candidate collisions must exist");
  assert.ok(analysis.behaviorKeyCollisions.statesInCollisionGroups > 1, "more than one state in collisions");
  assert.strictEqual(analysis.unclassifiedCount, 0, "no unclassified pairs allowed");
  assert.strictEqual(analysis.analysisErrorCount, 0, "no analysis errors allowed on the representative corpus");

  const att = (execution.result.segmentResults || [])[0] && (execution.result.segmentResults[0].attempts || [])[0];
  const dp = att && att.diagnostics && att.diagnostics.dp;

  process.stdout.write(JSON.stringify({
    schema: "motapathfinder.pr-5.4c-key-dependency-corpus.v1",
    status: "passed",
    controls: {
      choiceIdentityExcludesHp: true,
      choiceIdentityDistinguishesChoices: true,
      missingSuccessorFailVisible: true,
      terminalDifferential: true,
      witnessDirectionExplicit: true,
      representativeCollisionsNonEmpty: true,
      analysisErrorZero: true,
      unclassifiedZero: true,
      productionParityPreserved: true,
    },
    corpus: {
      capturedStateCount: analysis.capturedStateCount,
      behaviorKeyCollisions: analysis.behaviorKeyCollisions,
      structuralResourceCollisions: analysis.structuralResourceCollisions,
      candidateGroupsAnalyzed: analysis.candidateGroupsAnalyzed,
      statesInCandidateCollisionGroups: analysis.statesInCandidateCollisionGroups,
      classificationCounts: analysis.classificationCounts,
      dominanceSafeCount: analysis.dominanceSafeCount,
      metadataOnlyCount: analysis.metadataOnlyCount,
      unsafeCount: analysis.unsafeCount,
      analysisErrorCount: analysis.analysisErrorCount,
      unclassifiedCount: analysis.unclassifiedCount,
      mismatchBreakdown: analysis.mismatchBreakdown,
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
