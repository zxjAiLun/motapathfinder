"use strict";

/**
 * TEST GRADE: unit-plus-micro
 *
 * PR-5.5a — Multi-Region Candidate-Key Shadow & Boundary Corpus.
 *
 * RESEARCH / EVIDENCE ONLY.  No production/default behavior change: the
 * campaign is executed through the STANDARD V2 machinery (runMilestoneGraph +
 * materializeNextRegionFrontier), Region A stays on the approved MT1 default
 * candidate, Region B stays production-region.  The dual-key shadow is purely
 * observational.
 *
 * Fixture (deliberately small but discriminative):
 *   R0 = approved MT1 (exp>=9) -> default candidate, multiple terminal
 *        candidates with distinct HP / entry positions (boundary-sensitive).
 *   R1 = unapproved Region (different id -> production fallback) with a
 *        reachable goal; at least pickup/battle/entry behaviors in its corpus.
 *
 * Three corpus layers: pre-boundary (R0 terminals), boundary-transfer
 * (materialized R1 inputs), post-boundary (R1 reachable enqueue states).
 *
 * Audits:
 *   A. state partition    exact -> candidate (split/merge/relation), per layer.
 *   B. boundary partition pre-boundary candidate key -> post-boundary exact
 *      fingerprint (boundary-transfer equivalence).
 *   Ordered CEGAR: boundary-transfer equivalence first (decisive), then
 *   legal-action / successor / terminal / dominance via classifyPair.
 *
 * Negative control: the SAME corpus with an all-colliding candidate builder
 * must surface boundary-inequivalent groups (proves fail-visible detection).
 *
 * Verdict: NO_COLLISION_OBSERVED | MULTI_REGION_PROMOTION_CANDIDATE |
 *          MULTI_REGION_KEY_REFINEMENT_REQUIRED.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { loadProject } = require("./lib/project-loader");
const { compileTowerIR } = require("./lib/tower-ir");
const { makeSimulator, createStartState, materializeNextRegionFrontier } = require("./lib/solver-job");
const { runMilestoneGraph } = require("./lib/segment-dp");
const { buildRegionMilestoneSpec } = require("./lib/region-spec");
const { compileExecutableSolveTask } = require("./lib/solve-task");
const { resolveDpKeyProfile, EXPERIMENTAL_PROFILE, PRODUCTION_PROFILE } = require("./lib/guarded-candidate-key");
const {
  auditBoundaryPartition,
  auditStatePartition,
  buildMultiRegionCorpus,
  runMergeGroupCegar,
} = require("./lib/multi-region-key-shadow");

const ROOT = path.resolve(__dirname, "..");
const ONLY_UP_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");
const SMOKE_SPEC_FILE = path.join(ROOT, "towers", "onlyup", "region-specs", "region-output-contract-smoke.json");

const project = loadProject(ONLY_UP_ROOT);
const smokeSpec = JSON.parse(fs.readFileSync(SMOKE_SPEC_FILE, "utf8"));
const smokeIr = compileTowerIR(project, smokeSpec, { towerId: "onlyup-smoke" });

const CANDIDATE_PROFILE = "without-start-component";
const GOAL_PREDICATE = (state) => Boolean(state.floorId === "MT1" && state.hero && (state.hero.exp || 0) >= 4);

function normalizedSmokeSpec() {
  const task = compileExecutableSolveTask({
    schema: "motapathfinder.solve-task.v1",
    tower: { id: "onlyup-smoke", projectRoot: ONLY_UP_ROOT, region: { spec: JSON.parse(JSON.stringify(smokeSpec)) } },
    objective: { mode: "max-final-hp" },
    search: { algorithm: "segment-dp", maxExpansions: 4000, maxRuntimeMs: 0, candidateLimit: 2, goalSkylineLimit: 8 },
    verification: { strictReplay: false },
  });
  return (task.normalizedTask || task).tower.region.spec;
}

// R1: unapproved Region (different id -> structural fingerprint drift ->
// production fallback).  MT1 floor, reachable goal exp>=4; its corpus covers
// pickup / battle / entry behaviors.
function unapprovedRegionB() {
  const base = JSON.parse(JSON.stringify(smokeSpec));
  return {
    ...base,
    id: "onlyup-5.5a-region-b",
    goal: { type: "heroAtLeast", floorId: "MT1", minHero: { exp: 4 } },
  };
}

function searchConfig() {
  return {
    algorithm: "segment-dp",
    maxExpansions: 4000,
    maxRuntimeMs: 0,
    candidateLimit: 2,
    goalSkylineLimit: 8,
  };
}

function buildExecuteConfig(regionSpec, towerId) {
  const task = compileExecutableSolveTask({
    schema: "motapathfinder.solve-task.v1",
    tower: { id: towerId, projectRoot: ONLY_UP_ROOT, region: { spec: regionSpec } },
    objective: { mode: "max-final-hp" },
    search: searchConfig(),
    verification: { strictReplay: false },
  });
  const executeConfig = { ...(task.executeConfig || {}) };
  const resolution = resolveDpKeyProfile({
    project,
    regionSpec,
    simulator: makeSimulator(project, regionSpec, task),
    dpKeyProfile: null,
    options: { towerId },
  });
  if (resolution.builder) executeConfig.dpStateKeyBuilder = resolution.builder;
  return { task, executeConfig, resolution };
}

// Mirrors executeSolveJobV2's per-region loop using the same functions.
async function runCampaign() {
  const r0Spec = normalizedSmokeSpec();
  const r1Spec = unapprovedRegionB();

  const simA = makeSimulator(project, r0Spec, {});
  const simB = makeSimulator(project, r1Spec, {});
  const towerId = "onlyup-smoke";

  const cfgA = buildExecuteConfig(r0Spec, towerId);
  const cfgB = buildExecuteConfig(r1Spec, towerId);

  // Region A: approved MT1, default -> candidate.
  const startA = createStartState(project, simA, r0Spec, "chaos");
  const recordsA = [];
  const resultA = runMilestoneGraph(simA, startA, buildRegionMilestoneSpec(project, r0Spec), {
    ...cfgA.executeConfig,
    objectiveSpec: null,
    candidateKeyShadowRecorder: (record) => recordsA.push(record),
    shouldStop: () => false,
  });
  assert.strictEqual(resultA.found, true, "R0 must complete");
  assert.ok(Array.isArray(resultA.finalCandidates) && resultA.finalCandidates.length >= 2,
    "R0 must produce multiple terminal candidates for a discriminative corpus");
  assert.strictEqual(cfgA.resolution.effectiveProfile, EXPERIMENTAL_PROFILE, "R0 must run the candidate default");

  // Boundary transfer: what Region B ACTUALLY receives.
  const inputFrontier = materializeNextRegionFrontier(resultA.finalCandidates, r1Spec, { project, simulator: simB });
  assert.ok(inputFrontier.length >= 2, "boundary must carry multiple materialized inputs");

  // Region B: unapproved -> production fallback.
  const recordsB = [];
  const resultB = runMilestoneGraph(simB, inputFrontier[0].state, buildRegionMilestoneSpec(project, r1Spec), {
    ...cfgB.executeConfig,
    objectiveSpec: null,
    initialFrontier: inputFrontier,
    candidateKeyShadowRecorder: (record) => recordsB.push(record),
    shouldStop: () => false,
  });
  assert.strictEqual(resultB.found, true, "R1 must complete");
  assert.strictEqual(cfgB.resolution.effectiveProfile, PRODUCTION_PROFILE, "R1 must stay production (unapproved scope)");
  assert.strictEqual(cfgB.resolution.selectionReason, "scope-unapproved-fallback", "R1 must carry scope-unapproved-fallback");

  return {
    regionA: { terminalCandidates: resultA.finalCandidates },
    regionB: { records: recordsB, inputFrontier },
    simA,
    simB,
    profileA: cfgA.resolution,
    profileB: cfgB.resolution,
    scaleA: resultA.finalCandidates.length,
    scaleB: recordsB.length,
  };
}

function analyzeCorpus(campaign, candidateProfile, candidateKeyBuilder) {
  const corpus = buildMultiRegionCorpus({
    regionA: campaign.regionA,
    regionB: campaign.regionB,
    simulatorA: campaign.simA,
    simulatorB: campaign.simB,
    project,
    ir: smokeIr,
    goalPredicate: GOAL_PREDICATE,
    candidateProfile,
    candidateKeyBuilder,
    exactKeyConfig: { dpKeyMode: "region" },
  });
  const statePartition = auditStatePartition(corpus.records);
  const boundaryPartition = auditBoundaryPartition(corpus.preBoundaryRecords, corpus.boundaryRecords);
  const cegar = runMergeGroupCegar({
    preBoundaryRecords: corpus.preBoundaryRecords,
    boundaryRecords: corpus.boundaryRecords,
    postBoundaryRecords: corpus.postBoundaryRecords,
    simulator: campaign.simB,
    project,
    ir: smokeIr,
    goalPredicate: GOAL_PREDICATE,
    candidateProfile,
  });
  return { corpus, statePartition, boundaryPartition, cegar };
}

function verdictOf(statePartition, boundaryPartition, cegar) {
  if (statePartition.mergedCandidateKeyCount === 0) return "NO_COLLISION_OBSERVED";
  if (cegar.unsafeCount === 0 && boundaryPartition.inequivalentGroupCount === 0) return "MULTI_REGION_PROMOTION_CANDIDATE";
  return "MULTI_REGION_KEY_REFINEMENT_REQUIRED";
}

async function main() {
  const campaign = await runCampaign();

  // Real profile: current multi-Region evidence.
  const analysis = analyzeCorpus(campaign, CANDIDATE_PROFILE, null);
  const verdict = verdictOf(analysis.statePartition, analysis.boundaryPartition, analysis.cegar);
  assert.ok(
    ["NO_COLLISION_OBSERVED", "MULTI_REGION_PROMOTION_CANDIDATE"].includes(verdict),
    `real-profile verdict must be a safe outcome, got ${verdict}`,
  );

  // Negative control: all-colliding candidate builder must surface
  // boundary-inequivalent groups (fail-visible detection).
  const broken = analyzeCorpus(campaign, CANDIDATE_PROFILE, () => "ALL-COLLIDING");
  assert.ok(
    broken.boundaryPartition.inequivalentGroupCount > 0,
    "negative control: all-colliding key must be detected as boundary-inequivalent",
  );
  assert.ok(
    broken.cegar.unsafeCount > 0,
    "negative control: all-colliding key must be unsafe under ordered CEGAR",
  );

  process.stdout.write(JSON.stringify({
    schema: "motapathfinder.pr-5.5a-multi-region-key-shadow.v1",
    status: "passed",
    controls: {
      productionBehaviorUntouched: true,
      r0DefaultCandidate: campaign.profileA.effectiveProfile === EXPERIMENTAL_PROFILE,
      r1ProductionFallback: campaign.profileB.effectiveProfile === PRODUCTION_PROFILE,
      r0TerminalCandidates: campaign.scaleA,
      r1PostBoundarySamples: campaign.scaleB,
      layers: analysis.corpus.layers,
      statePartition: {
        splitExactKeyCount: analysis.statePartition.splitExactKeyCount,
        mergedCandidateKeyCount: analysis.statePartition.mergedCandidateKeyCount,
        partitionRelation: analysis.statePartition.partitionRelation,
        uniqueExactKeys: analysis.statePartition.uniqueExactKeys,
        uniqueCandidateKeys: analysis.statePartition.uniqueCandidateKeys,
        byLayer: analysis.statePartition.byLayer,
      },
      boundaryPartition: {
        boundaryTransferEquivalent: analysis.boundaryPartition.boundaryTransferEquivalent,
        groupsAudited: analysis.boundaryPartition.groupsAudited,
        inequivalentGroupCount: analysis.boundaryPartition.inequivalentGroupCount,
        groups: analysis.boundaryPartition.groups,
      },
      cegar: {
        unsafeCount: analysis.cegar.unsafeCount,
        boundaryInequivalentGroups: analysis.cegar.boundaryInequivalentGroups,
        safePreBoundaryGroups: analysis.cegar.safePreBoundaryGroups,
        safePostBoundaryGroups: analysis.cegar.safePostBoundaryGroups,
        behaviorAudited: analysis.cegar.behaviorAudited,
      },
      negativeControl: {
        boundaryInequivalentGroupsDetected: broken.boundaryPartition.inequivalentGroupCount,
        unsafeDetected: broken.cegar.unsafeCount,
        failVisible: true,
      },
    },
    verdict,
  }, null, 2) + "\n");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  });
}

module.exports = { main };
