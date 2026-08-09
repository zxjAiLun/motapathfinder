"use strict";

/**
 * TEST GRADE: unit-plus-micro
 *
 * PR-5.5a Repair — Multi-Region Candidate-Key Shadow & Boundary Corpus.
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
 *   R1 = unapproved Region (different id -> production fallback) with a REAL
 *        non-trivial floor entry: start.type="floor" so applyRegionEntry
 *        performs entry relocation + __leaveLoc__ + applyFloorArrival.  Its
 *        actionPolicy matches the smoke spec (battle / event), giving at least
 *        two behavior kinds in the post-boundary corpus.
 *
 * Per-region context: pre-boundary uses R0's simulator / TowerIR / goal
 * predicate; boundary-transfer + post-boundary + behavior CEGAR use R1's own
 * simulator / TowerIR / goal predicate (never a shared R0 IR).
 *
 * Audits:
 *   A. state partition    exact -> candidate (split/merge/relation), per layer.
 *   B. boundary partition pre-boundary candidate key -> post-boundary SEMANTIC
 *      identity (production DP key).  Full-exact-fingerprint divergence within
 *      one semantic identity is diagnostic only (HP/dominance-level) and is
 *      handed to classifyPair, never treated as unsafe by itself.
 *   Ordered CEGAR: boundary-transfer equivalence on semantic identity first
 *   (decisive), then legal-action / successor / terminal / dominance via
 *   classifyPair on the materialized post-boundary states.
 *
 * Controls:
 *   - all-colliding candidate builder must be detected boundary-inequivalent
 *     (fail-visible).
 *   - dominance-safe control: two pre-boundary states differing ONLY in
 *     position + HP, forced into one candidate key, materialize to the SAME
 *     post-boundary production identity with HP-only divergence -> must NOT be
 *     flagged boundary-inequivalent and must pass classifyPair dominance logic.
 *
 * Verdict PINNED this round: NO_COLLISION_OBSERVED (a merge, even a safe one,
 * must explicitly change the verdict, not silently drift).
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { loadProject } = require("./lib/project-loader");
const { compileTowerIR } = require("./lib/tower-ir");
const { makeSimulator, createStartState, materializeNextRegionFrontier, exactStateFingerprint } = require("./lib/solver-job");
const { runMilestoneGraph } = require("./lib/segment-dp");
const { buildRegionMilestoneSpec } = require("./lib/region-spec");
const { compileExecutableSolveTask } = require("./lib/solve-task");
const { resolveDpKeyProfile, EXPERIMENTAL_PROFILE, PRODUCTION_PROFILE } = require("./lib/guarded-candidate-key");
const {
  auditBoundaryPartition,
  auditStatePartition,
  buildCorpusRecord,
  buildMultiRegionCorpus,
  runMergeGroupCegar,
} = require("./lib/multi-region-key-shadow");

const ROOT = path.resolve(__dirname, "..");
const ONLY_UP_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");
const SMOKE_SPEC_FILE = path.join(ROOT, "towers", "onlyup", "region-specs", "region-output-contract-smoke.json");

const project = loadProject(ONLY_UP_ROOT);
const smokeSpec = JSON.parse(fs.readFileSync(SMOKE_SPEC_FILE, "utf8"));

const CANDIDATE_PROFILE = "without-start-component";
const TOWER_ID = "onlyup-smoke";

const goalPredicateFor = (goal) => (state) => {
  if (goal.type === "heroAtLeast") {
    const min = goal.minHero || {};
    return Boolean(state.floorId === goal.floorId
      && Object.keys(min).every((field) => Number(state.hero[field] || 0) >= Number(min[field])));
  }
  return false;
};

function normalizedSmokeSpec() {
  const task = compileExecutableSolveTask({
    schema: "motapathfinder.solve-task.v1",
    tower: { id: TOWER_ID, projectRoot: ONLY_UP_ROOT, region: { spec: JSON.parse(JSON.stringify(smokeSpec)) } },
    objective: { mode: "max-final-hp" },
    search: { algorithm: "segment-dp", maxExpansions: 4000, maxRuntimeMs: 0, candidateLimit: 2, goalSkylineLimit: 8 },
    verification: { strictReplay: false },
  });
  return (task.normalizedTask || task).tower.region.spec;
}

// R1: unapproved Region with a REAL non-trivial floor entry:
//   - different id -> structural fingerprint drift -> production fallback
//   - start.type="floor" -> applyRegionEntry performs entry relocation,
//     __leaveLoc__ recording, and applyFloorArrival (boundary mutation)
//   - entry tile (5,7) is a walkable MT1 cell, distinct from R0 terminals
//   - actionPolicy matches the smoke spec (battle / event behaviors)
function unapprovedRegionB() {
  const base = JSON.parse(JSON.stringify(smokeSpec));
  return {
    ...base,
    id: "onlyup-5.5a-region-b",
    start: { type: "floor", floorId: "MT1", x: 5, y: 7, direction: "down" },
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

function buildExecuteConfig(regionSpec) {
  const task = compileExecutableSolveTask({
    schema: "motapathfinder.solve-task.v1",
    tower: { id: TOWER_ID, projectRoot: ONLY_UP_ROOT, region: { spec: regionSpec } },
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
    options: { towerId: TOWER_ID },
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
  const irA = compileTowerIR(project, r0Spec, { towerId: TOWER_ID });
  const irB = compileTowerIR(project, r1Spec, { towerId: TOWER_ID });
  const goalPredicateA = goalPredicateFor(r0Spec.goal);
  const goalPredicateB = goalPredicateFor(r1Spec.goal);

  const cfgA = buildExecuteConfig(r0Spec);
  const cfgB = buildExecuteConfig(r1Spec);

  // Region A: approved MT1, default -> candidate.
  const startA = createStartState(project, simA, r0Spec, "chaos");
  const resultA = runMilestoneGraph(simA, startA, buildRegionMilestoneSpec(project, r0Spec), {
    ...cfgA.executeConfig,
    objectiveSpec: null,
    shouldStop: () => false,
  });
  assert.strictEqual(resultA.found, true, "R0 must complete");
  assert.ok(Array.isArray(resultA.finalCandidates) && resultA.finalCandidates.length >= 2,
    "R0 must produce multiple terminal candidates for a discriminative corpus");
  assert.strictEqual(cfgA.resolution.effectiveProfile, EXPERIMENTAL_PROFILE, "R0 must run the candidate default");

  // Boundary transfer: what Region B ACTUALLY receives.  R1 has a real floor
  // entry, so the transform MUST be non-trivial.
  const inputFrontier = materializeNextRegionFrontier(resultA.finalCandidates, r1Spec, { project, simulator: simB });
  assert.ok(inputFrontier.length >= 2, "boundary must carry multiple materialized inputs");
  resultA.finalCandidates.forEach((candidate, index) => {
    const entry = inputFrontier[index];
    assert.ok(entry, `boundary input ${index} must exist`);
    const preLoc = candidate.state.hero.loc;
    const postLoc = entry.state.hero.loc;
    assert.notDeepStrictEqual(
      { x: preLoc.x, y: preLoc.y },
      { x: postLoc.x, y: postLoc.y },
      `entry transform must relocate the hero (index ${index})`,
    );
    assert.notStrictEqual(
      entry.inputCarriedExactFingerprint,
      entry.exactBoundaryStateFingerprint,
      `entry transform must change the exact boundary identity (index ${index})`,
    );
    assert.ok(
      entry.state.flags && entry.state.flags.__leaveLoc__,
      `entry transform must record __leaveLoc__ (index ${index})`,
    );
  });

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
  assert.ok(recordsB.length > 0, "R1 post-boundary corpus must be non-empty");

  return {
    regionA: {
      simulator: simA,
      ir: irA,
      goalPredicate: goalPredicateA,
      terminalCandidates: resultA.finalCandidates,
    },
    regionB: {
      simulator: simB,
      ir: irB,
      goalPredicate: goalPredicateB,
      records: recordsB,
      inputFrontier,
    },
    profileA: cfgA.resolution,
    profileB: cfgB.resolution,
    scaleB: recordsB.length,
  };
}

function analyzeCorpus(campaign, candidateProfile, candidateKeyBuilder) {
  const corpus = buildMultiRegionCorpus({
    regionA: campaign.regionA,
    regionB: campaign.regionB,
    project,
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
    regionB: {
      simulator: campaign.regionB.simulator,
      project,
      ir: campaign.regionB.ir,
      goalPredicate: campaign.regionB.goalPredicate,
    },
    candidateProfile,
  });
  return { corpus, statePartition, boundaryPartition, cegar };
}

// P1-3 / control: a candidate merge whose members materialize to the SAME
// post-boundary semantic identity (production key) with HP-only exact-fingerprint
// divergence must NOT be flagged boundary-inequivalent; it must pass the
// dominance-aware classifyPair.  The pre-boundary production identities are
// synthesized as distinct (this simulates "candidate merged different pre
// identities"); the post-boundary states are REAL materialized states differing
// only in HP (same production key — HP is a dominance label, not identity).
function dominanceSafeBoundaryControl(campaign) {
  const ctx = campaign.regionB;
  const base = ctx.inputFrontier[0].state;
  const m1 = JSON.parse(JSON.stringify(base));
  const m2 = JSON.parse(JSON.stringify(base));
  m1.hero.hp = 1000;
  m2.hero.hp = 500;

  const keyBuilder = () => "DOMINANCE-CONTROL";
  const recordOptions = {
    regionContext: ctx,
    project,
    candidateProfile: CANDIDATE_PROFILE,
    candidateKeyBuilder: keyBuilder,
    exactKeyConfig: { dpKeyMode: "region" },
  };
  const b1 = buildCorpusRecord({
    ...recordOptions,
    state: m1,
    layer: "boundary-transfer",
    regionIndex: 1,
    regionId: "R1",
    extra: { postBoundaryExactFingerprint: exactStateFingerprint(m1) },
  });
  const b2 = buildCorpusRecord({
    ...recordOptions,
    state: m2,
    layer: "boundary-transfer",
    regionIndex: 1,
    regionId: "R1",
    extra: { postBoundaryExactFingerprint: exactStateFingerprint(m2) },
  });
  assert.strictEqual(b1.productionDpKey, b2.productionDpKey, "control: post-boundary semantic identities must be equal");
  assert.notStrictEqual(b1.exactStateFingerprint, b2.exactStateFingerprint, "control: exact fingerprints must diverge (HP only)");

  const pre1 = { ...buildCorpusRecord({
    ...recordOptions, state: m1, layer: "pre-boundary", regionIndex: 0, regionId: "R0",
    extra: { boundaryIndex: 0, preBoundaryStateFingerprint: exactStateFingerprint(m1) },
  }), productionDpKey: "PRE-EXACT-1" };
  const pre2 = { ...buildCorpusRecord({
    ...recordOptions, state: m2, layer: "pre-boundary", regionIndex: 0, regionId: "R0",
    extra: { boundaryIndex: 1, preBoundaryStateFingerprint: exactStateFingerprint(m2) },
  }), productionDpKey: "PRE-EXACT-2" };
  assert.notStrictEqual(pre1.productionDpKey, pre2.productionDpKey, "control: pre-boundary production identities must differ");

  const boundaryPartition = auditBoundaryPartition([pre1, pre2], [b1, b2]);
  const group = boundaryPartition.groups.find((g) => g.candidateKey === "DOMINANCE-CONTROL");
  assert.ok(group, "control: the forced merge group must be audited");
  assert.strictEqual(group.boundaryEquivalent, true, "control: semantic-identity boundary equivalence must hold");
  assert.strictEqual(group.postExactFingerprints, 2, "control: exact-fingerprint divergence must be reported (diagnostic)");
  assert.strictEqual(boundaryPartition.inequivalentGroupCount, 0, "control: HP-only divergence must NOT be boundary-inequivalent");

  const cegar = runMergeGroupCegar({
    preBoundaryRecords: [pre1, pre2],
    boundaryRecords: [b1, b2],
    postBoundaryRecords: [],
    regionB: { simulator: ctx.simulator, project, ir: ctx.ir, goalPredicate: ctx.goalPredicate },
    candidateProfile: CANDIDATE_PROFILE,
  });
  assert.strictEqual(cegar.unsafeCount, 0, "control: dominance-safe merge must pass CEGAR");
  return { semanticIdentityGateHolds: true, exactDivergenceReported: group.postExactFingerprints };
}

async function main() {
  const campaign = await runCampaign();

  // Real profile: current multi-Region evidence.
  const analysis = analyzeCorpus(campaign, CANDIDATE_PROFILE, null);
  const verdict = analysis.statePartition.mergedCandidateKeyCount === 0
    ? "NO_COLLISION_OBSERVED"
    : (analysis.cegar.unsafeCount === 0 && analysis.boundaryPartition.inequivalentGroupCount === 0
      ? "MULTI_REGION_PROMOTION_CANDIDATE"
      : "MULTI_REGION_KEY_REFINEMENT_REQUIRED");
  // PINNED this round: an observation upgrade (e.g., to PROMOTION_CANDIDATE)
  // must be an explicit, reviewed change — never silent drift.
  assert.strictEqual(verdict, "NO_COLLISION_OBSERVED", "verdict is pinned to NO_COLLISION_OBSERVED this round");

  // Negative control: all-colliding candidate builder must surface
  // boundary-inequivalent groups (fail-visible).
  const broken = analyzeCorpus(campaign, CANDIDATE_PROFILE, () => "ALL-COLLIDING");
  assert.ok(
    broken.boundaryPartition.inequivalentGroupCount > 0,
    "negative control: all-colliding key must be detected as boundary-inequivalent",
  );
  assert.ok(
    broken.cegar.unsafeCount > 0,
    "negative control: all-colliding key must be unsafe under ordered CEGAR",
  );

  // P1-3 control: HP-only divergence after boundary must be dominance-handled,
  // not flagged unsafe by exact-fingerprint equality.
  const dominanceControl = dominanceSafeBoundaryControl(campaign);

  process.stdout.write(JSON.stringify({
    schema: "motapathfinder.pr-5.5a-multi-region-key-shadow.v1",
    status: "passed",
    controls: {
      productionBehaviorUntouched: true,
      r0DefaultCandidate: campaign.profileA.effectiveProfile === EXPERIMENTAL_PROFILE,
      r1ProductionFallback: campaign.profileB.effectiveProfile === PRODUCTION_PROFILE,
      r1RealFloorEntryApplied: true,
      boundaryTransformAssertions: {
        heroRelocated: true,
        exactIdentityChanged: true,
        leaveLocRecorded: true,
      },
      r0TerminalCandidates: campaign.regionA.terminalCandidates.length,
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
      dominanceSafeControl: {
        semanticIdentityGateHolds: dominanceControl.semanticIdentityGateHolds,
        exactDivergenceReportedAsDiagnostic: dominanceControl.exactDivergenceReported,
        unsafe: 0,
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
