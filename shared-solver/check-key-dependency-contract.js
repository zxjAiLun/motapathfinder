"use strict";

/**
 * TEST GRADE: unit-plus-micro
 *
 * PR-5.4c Commit 1 — Key Dependency Corpus contract (observation only).
 *
 * Captures real DP states from the representative workload and records, per
 * state: current exact DP key, structural projection (legacy region signature
 * + TowerIR reachability), resource projection (hero/inventory/flags), event
 * projection, legal action set and per-action successor fingerprints.  The
 * dependency analysis reports which candidate fields actually vary and whether
 * any decomposition produces "merge hazard" candidates (same decomposition,
 * different action sets or successors).  Production results must stay byte-for-
 * byte identical (Commit 2 parity).
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { loadProject } = require("./lib/project-loader");
const { compileTowerIR } = require("./lib/tower-ir");
const {
  analyzeKeyDependencyCorpus,
  buildStateDecomposition,
} = require("./lib/key-dependency-corpus");
const { makeSimulator, executeSolveJob } = require("./lib/solver-job");
const { compileExecutableSolveTask } = require("./lib/solve-task");

const ROOT = path.resolve(__dirname, "..");
const ONLY_UP_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");
const SMOKE_SPEC_FILE = path.join(ROOT, "towers", "onlyup", "region-specs", "region-output-contract-smoke.json");

const project = loadProject(ONLY_UP_ROOT);
const smokeSpec = JSON.parse(fs.readFileSync(SMOKE_SPEC_FILE, "utf8"));
const smokeIr = compileTowerIR(project, smokeSpec, { towerId: "onlyup-smoke" });

// Commit 2 reference fingerprints (must stay byte-for-byte identical).
const COMMIT2_REPRESENTATIVE_ROUTE_FINGERPRINT =
  '{"algorithm":"sha256-stable-json-v1","sha256":"c0adb2d921e84cab097c034bf7b6f8fdb5a344a0cb21f66ea3b7f707a4ebec13"}';
const COMMIT2_REPRESENTATIVE_WINNER_FINGERPRINT = "a2ff379819ac9003";

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
  const { execution, captured } = await captureRepresentative(50);
  assert.strictEqual(execution.result.found, true, "representative must complete");
  assert.ok(captured.length > 0, "corpus must capture states");

  // Commit 2 production parity (the corpus is observation only).
  const routeFingerprint = execution.routeRecord
    ? (require("./lib/replay-resume-artifact").buildReplayRouteFingerprint(execution.routeRecord))
    : null;
  assert.strictEqual(
    routeFingerprint ? routeFingerprint.hash || JSON.stringify(routeFingerprint) : null,
    COMMIT2_REPRESENTATIVE_ROUTE_FINGERPRINT,
    "routeFingerprint must match Commit 2",
  );
  const winnerState = execution.result.finalCandidate && execution.result.finalCandidate.state;
  assert.ok(winnerState, "winner state required");
  assert.strictEqual(
    require("./lib/solver-job").exactStateFingerprint(winnerState),
    COMMIT2_REPRESENTATIVE_WINNER_FINGERPRINT,
    "winner exact fingerprint must match Commit 2",
  );

  const simulator = makeSimulator(project, smokeSpec, {});
  const entries = captured.map((state, index) => {
    const decomposition = buildStateDecomposition(simulator, project, smokeIr, state);
    assert.strictEqual(typeof decomposition.exactKey, "string", `state ${index}: exactKey required`);
    assert.ok(decomposition.structural && decomposition.structural.floorId, `state ${index}: structural projection required`);
    assert.ok(decomposition.towerIr, `state ${index}: TowerIR projection required`);
    assert.ok(decomposition.resource && decomposition.resource.hero, `state ${index}: resource projection required`);
    assert.ok(decomposition.event, `state ${index}: event projection required`);
    assert.ok(Array.isArray(decomposition.actionSet), `state ${index}: actionSet required`);
    assert.ok(Array.isArray(decomposition.actions), `state ${index}: action records required`);
    const nonNullSuccessors = decomposition.actions.filter((record) => record.successorFingerprint != null).length;
    if (decomposition.actions.length > 0) {
      assert.ok(nonNullSuccessors > 0, `state ${index}: at least one action must have a successor fingerprint`);
    }
    return { index, state, decomposition };
  });

  const analysis = analyzeKeyDependencyCorpus(entries);
  assert.strictEqual(analysis.stateCount, entries.length, "analysis must cover the full corpus");
  assert.ok(analysis.uniqueExactKeys >= 1, "unique exact keys required");
  assert.ok(analysis.uniqueStructuralSignatures >= 1, "unique structural signatures required");
  assert.ok(typeof analysis.mergeHazardCount === "number", "merge hazard count required");
  assert.ok(typeof analysis.byHazardKind === "object", "hazard kind breakdown required");

  const att = (execution.result.segmentResults || [])[0] && (execution.result.segmentResults[0].attempts || [])[0];
  const dp = att && att.diagnostics && att.diagnostics.dp;

  process.stdout.write(JSON.stringify({
    schema: "motapathfinder.pr-5.4c-key-dependency-corpus.v1",
    status: "passed",
    controls: {
      corpusCaptured: true,
      exactKeyRecorded: true,
      structuralProjectionRecorded: true,
      towerIrProjectionRecorded: true,
      resourceProjectionRecorded: true,
      eventProjectionRecorded: true,
      actionAndSuccessorFingerprintsRecorded: true,
      dependencyAnalysisProduced: true,
      productionParityPreserved: true,
    },
    corpus: {
      capturedCount: captured.length,
      uniqueExactKeys: analysis.uniqueExactKeys,
      uniqueStructuralSignatures: analysis.uniqueStructuralSignatures,
      uniqueResourceLabels: analysis.uniqueResourceLabels,
      uniqueEventLabels: analysis.uniqueEventLabels,
      uniqueDecompositions: analysis.uniqueDecompositions,
      heroFieldVariance: analysis.heroFieldVariance,
      inventoryVariance: analysis.inventoryVariance,
      flagsVariance: analysis.flagsVariance,
      mergeHazardCount: analysis.mergeHazardCount,
      mergeHazardCandidates: analysis.mergeHazardCandidates.slice(0, 20),
      byHazardKind: analysis.byHazardKind,
      exactKeyMergeHazardCount: analysis.exactKeyMergeHazardCount,
      exactKeyMergeHazardCandidates: analysis.exactKeyMergeHazardCandidates.slice(0, 10),
      exactKeyGroupsWithMultipleStates: analysis.exactKeyGroupsWithMultipleStates,
    },
    productionParity: {
      routeFingerprint: COMMIT2_REPRESENTATIVE_ROUTE_FINGERPRINT,
      winnerExactFingerprint: COMMIT2_REPRESENTATIVE_WINNER_FINGERPRINT,
      expanded: dp && dp.expansions,
      generated: dp && dp.generatedActions,
      registered: dp && dp.keptActions,
    },
    towerIr: {
      irFingerprint: smokeIr.irFingerprint,
      componentCount: smokeIr.components.length,
      poiCount: smokeIr.pois.length,
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
