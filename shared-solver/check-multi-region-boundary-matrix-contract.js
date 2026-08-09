"use strict";

/**
 * TEST GRADE: unit-plus-micro
 *
 * PR-5.5b — Multi-Region Boundary Corpus Expansion.
 *
 * RESEARCH / EVIDENCE ONLY.  No production/default behavior change; the
 * campaigns execute through the STANDARD V2 machinery (runMilestoneGraph +
 * materializeNextRegionFrontier), R0 stays on the approved MT1 default
 * candidate, every later region stays production-region.
 *
 * The goal of this round is to EXPAND the real multi-Region corpus and hunt for
 * the FIRST REAL candidate merge witness.  Until a merge appears, NO key
 * refinement happens.  If a real merge appears, a minimal witness artifact
 * (field-level candidate-projection diff + boundary/CEGAR evidence) is saved to
 * runs/generated/ and the contract stops with needs-review (non-zero exit).
 *
 * Workload matrix (18 workloads):
 *   R0 frontier variants (explicit goals, P2-3 closed):
 *     exp2, exp6, exp8, exp9, tileRemoved(MT1 4,1)  (x entryA)
 *   R1 boundary variants (x R0 exp6, calibrated goals so R1 really searches):
 *     floor-entry A (MT1 5,7), floor-entry B (MT1 9,7),
 *     floor-entry C (MT1 3,7), inventory-use policy,
 *     battle-only flag-carry policy
 *   PR-5.5c expansion:
 *     cross-products (r0-exp2/exp9/tile4_1 x entryB/entryC/inventoryUse/flagCarry),
 *     mutation-divergence (r0-tile2_1-entryA: different carried floor-mutation
 *     history than tile4_1),
 *     3-region chain, 4-region chain (R0->R1->R2->R3)
 *   (the PR-5.5c deep-search fixture was REMOVED: it produced no corpus
 *   increment — post 10->10 — while r0-exp2-entryB reached 26 samples; see
 *   P2-3.  Depth doubling does not enrich semantic diversity.)
 *   PR-5.5c Cross-Topology / Inventory Collision Hunt:
 *     cross-tower workload (wi-a1-door-key-entryA): R0 approved OnlyUp MT1 ->
 *     R1 REAL second tower (whiteisland A1) where the search must pick up
 *     yellow keys and OPEN a door — genuine inventory acquire/consume
 *     (inventory distinct > 1) and floor mutations; the cross-tower boundary
 *     carries the MT1 history into A1's arrival semantics (visitedFloors > 1).
 *     Per-region projects: each region context loads ITS OWN tower project.
 *
 * PR-5.5c Continuation: semantic-diversity report (distinct production-identity
 * dimension values per workload + TRUE global union across all records) and a
 * semantic gate — every workload must vary >= 2 values in at least one
 * dimension, and the global corpus must cover mutation / reachability / flags /
 * legal actions with >= 2 distinct values each.  inventory / visitedFloors are
 * reported (constancy is a finding, not a gate requirement).  This replaces
 * "more samples" as the success measure.
 *
 * Per-workload evidence: 3-layer corpus + statePartition + boundaryPartition
 * + CEGAR + coverage metadata (id, r0Goal, r0TerminalCandidateCount, r1Start,
 * r1Scope, r1ActionKinds, boundaryTransformKind, chainLength).
 *
 * Collision scoping (P1-1): every group key is the REAL production competition
 * scope — state partition by region-execution-context + candidate key, boundary
 * partition and CEGAR by boundaryIndex + candidate key, witness grouped with
 * the same scopes.  Candidate key reuse across boundaries is NOT a merge.
 *
 * Legal semantics (P1-2): coverage, signatures and behavior CEGAR use the
 * region's production legal-action provider (buildSegmentActionProvider), so
 * raw primitive actions forbidden by the policy never enter the classification;
 * parity (legal subset of raw) is asserted on every record.
 *
 * Coverage gates (no merge-free claim without coverage):
 *   pre-boundary terminals >= 2, boundary-transfer >= 2,
 *   post-boundary samples >= 2, >= 1 distinct LEGAL action kind,
 *   zero parity violations; observed legal kinds within the region policy.
 *
 * Controls (6): all-colliding (scoped), HP-only dominance-safe,
 * boundary-semantic-drift, post-boundary-action-drift, raw-vs-legal,
 * cross-boundary key reuse (neutral).
 *
 * Verdict: NO_COLLISION_OBSERVED (pinned; any real merge -> witness artifact in
 * runs/generated/ + needs-review).
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { loadProject } = require("./lib/project-loader");
const { compileTowerIR } = require("./lib/tower-ir");
const { makeSimulator, createStartState, materializeNextRegionFrontier, exactStateFingerprint } = require("./lib/solver-job");
const { runMilestoneGraph, buildSegmentActionProvider } = require("./lib/segment-dp");
const { buildRegionMilestoneSpec } = require("./lib/region-spec");
const { listFloorMutationSummary } = require("./lib/state");
const { buildStateBehavior, buildStateProjection, classifyPair } = require("./lib/key-dependency-corpus");
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
const WITNESS_DIR = path.join(ROOT, "runs", "generated", "mr-boundary-corpus");

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
  if (goal.type === "tileRemoved") {
    return Boolean(state.floorId === goal.floorId
      && ((state.floorStates && state.floorStates[goal.floorId] && state.floorStates[goal.floorId].removed || {})[`${goal.x},${goal.y}`] || false));
  }
  return false;
};

// R0 goals are EXPLICIT (P2-3): never inherit the smoke spec's goal implicitly.
const R0_GOALS = [
  { id: "exp2", goal: { type: "heroAtLeast", floorId: "MT1", minHero: { exp: 2 } } },
  { id: "exp6", goal: { type: "heroAtLeast", floorId: "MT1", minHero: { exp: 6 } } },
  { id: "exp8", goal: { type: "heroAtLeast", floorId: "MT1", minHero: { exp: 8 } } },
  { id: "exp9", goal: { type: "heroAtLeast", floorId: "MT1", minHero: { exp: 9 } } },
  { id: "tile4_1", goal: { type: "tileRemoved", floorId: "MT1", x: 4, y: 1 } },
];

// R1 boundary variants (all unapproved region ids -> production fallback).
// R1 goals are STATICALLY CALIBRATED per workload so the R1 search is real
// (not trivially satisfied by the R0-carried exp): exp ladders where the tower
// allows, tileRemoved targets for high-clear R0s.
function r1EntryA(goal) {
  return {
    ...JSON.parse(JSON.stringify(smokeSpec)),
    id: "onlyup-5.5b-entry-a",
    start: { type: "floor", floorId: "MT1", x: 5, y: 7, direction: "down" },
    goal: JSON.parse(JSON.stringify(goal)),
  };
}
function r1EntryB(goal) {
  return {
    ...JSON.parse(JSON.stringify(smokeSpec)),
    id: "onlyup-5.5b-entry-b",
    start: { type: "floor", floorId: "MT1", x: 9, y: 7, direction: "down" },
    goal: JSON.parse(JSON.stringify(goal)),
  };
}
function r1EntryC(goal) {
  return {
    ...JSON.parse(JSON.stringify(smokeSpec)),
    id: "onlyup-5.5b-entry-c",
    start: { type: "floor", floorId: "MT1", x: 3, y: 7, direction: "down" },
    goal: JSON.parse(JSON.stringify(goal)),
  };
}
function r1InventoryUse(goal) {
  return {
    ...r1EntryA(goal),
    id: "onlyup-5.5b-inventory-use",
    actionPolicy: {
      allowedFloors: ["MT1"],
      actionKinds: ["battle", "event", "pickup", "interactPickup", "equip", "openDoor", "useTool", "changeFloor", "floorFly"],
    },
  };
}
function r1FlagCarry(goal) {
  return {
    ...r1EntryA(goal),
    id: "onlyup-5.5b-flag-carry",
    actionPolicy: { allowedFloors: ["MT1"], actionKinds: ["battle"] },
  };
}

const R1_GOAL_EXP4 = { type: "heroAtLeast", floorId: "MT1", minHero: { exp: 4 } };
const R1_GOAL_EXP8 = { type: "heroAtLeast", floorId: "MT1", minHero: { exp: 8 } };
const R1_GOAL_TILE411 = { type: "tileRemoved", floorId: "MT1", x: 4, y: 11 };

const R1_VARIANTS = [
  { id: "entryA", builder: r1EntryA, boundaryTransformKind: "floor-entry-A", note: "floor entry MT1 (5,7), battle/event" },
  { id: "entryB", builder: r1EntryB, boundaryTransformKind: "floor-entry-B", note: "floor entry MT1 (9,7), battle/event" },
  { id: "entryC", builder: r1EntryC, boundaryTransformKind: "floor-entry-C", note: "floor entry MT1 (3,7), battle/event" },
  { id: "inventoryUse", builder: r1InventoryUse, boundaryTransformKind: "floor-entry-carry-inventory-use", note: "entry + carried inventory use (pickup/equip/openDoor/useTool/changeFloor)" },
  { id: "flagCarry", builder: r1FlagCarry, boundaryTransformKind: "floor-entry-carry-flags-battle-only", note: "entry + carried flags, battle-only" },
];

// R0 variant workloads: each R0 goal x entryA R1, with a calibrated R1 goal.
function r0VariantWorkloads() {
  return R0_GOALS.map((r0) => ({
    id: `r0-${r0.id}-entryA`,
    chainLength: 2,
    r0Goal: r0.goal,
    r1Goal: r0.id === "exp2" ? R1_GOAL_EXP4 : (r0.id === "exp6" ? R1_GOAL_EXP8 : R1_GOAL_TILE411),
    r1: null, // built in main via the variant builder
    r1Id: "entryA",
    r1Note: "floor entry MT1 (5,7), battle/event",
  }));
}

// R1 variant workloads: R0 exp6 x each R1 variant, R1 goal exp8.
function r1VariantWorkloads() {
  return R1_VARIANTS.map((r1) => ({
    id: `exp6-${r1.id}`,
    chainLength: 2,
    r0Goal: { type: "heroAtLeast", floorId: "MT1", minHero: { exp: 6 } },
    r1Goal: R1_GOAL_EXP8,
    r1: null,
    r1Builder: r1.builder,
    r1Id: r1.id,
    r1Note: r1.note,
    boundaryTransformKind: r1.boundaryTransformKind,
  }));
}

// Chain workload: R0(exp6) -> R1(entryA, exp8) -> R2(entryB, exp8).
function chainWorkload() {
  return {
    id: "chain-exp6-entryA-entryB",
    chainLength: 3,
    r0Goal: { type: "heroAtLeast", floorId: "MT1", minHero: { exp: 6 } },
    r1Goal: R1_GOAL_EXP8,
    r2Goal: R1_GOAL_EXP8,
    r1: null,
    r2: null,
    r1Id: "entryA",
    r2Id: "entryB",
    boundaryTransformKind: "chain-floor-entry-A-then-B",
  };
}

// PR-5.5c expansion: cross-products (R0 goal x non-entryA R1 variants) to vary
// the pre-boundary terminal diversity across different R1 structures.
function xprodWorkloads() {
  return [
    {
      id: "r0-exp2-entryB",
      chainLength: 2,
      r0Goal: { type: "heroAtLeast", floorId: "MT1", minHero: { exp: 2 } },
      r1Goal: R1_GOAL_EXP4,
      r1Id: "entryB",
      boundaryTransformKind: "floor-entry-B",
    },
    {
      id: "r0-exp9-entryB",
      chainLength: 2,
      r0Goal: { type: "heroAtLeast", floorId: "MT1", minHero: { exp: 9 } },
      r1Goal: R1_GOAL_TILE411,
      r1Id: "entryB",
      boundaryTransformKind: "floor-entry-B",
    },
    {
      id: "r0-tile4_1-entryC",
      chainLength: 2,
      r0Goal: { type: "tileRemoved", floorId: "MT1", x: 4, y: 1 },
      r1Goal: R1_GOAL_TILE411,
      r1Id: "entryC",
      boundaryTransformKind: "floor-entry-C",
    },
    {
      id: "r0-exp8-inventoryUse",
      chainLength: 2,
      r0Goal: { type: "heroAtLeast", floorId: "MT1", minHero: { exp: 8 } },
      r1Goal: R1_GOAL_TILE411,
      r1Id: "inventoryUse",
      boundaryTransformKind: "floor-entry-carry-inventory-use",
    },
    {
      id: "r0-exp2-flagCarry",
      chainLength: 2,
      r0Goal: { type: "heroAtLeast", floorId: "MT1", minHero: { exp: 2 } },
      r1Goal: R1_GOAL_EXP4,
      r1Id: "flagCarry",
      boundaryTransformKind: "floor-entry-carry-flags-battle-only",
    },
  ];
}

// PR-5.5c Continuation: mutation-divergence workload — R0 clears tile (2,1)
// instead of (4,1), so the carried floor-mutation history differs from every
// existing R0 variant (different removed-tile set feeding R1).
function mutationDivergenceWorkload() {
  return {
    id: "r0-tile2_1-entryA",
    chainLength: 2,
    r0Goal: { type: "tileRemoved", floorId: "MT1", x: 2, y: 1 },
    r1Goal: R1_GOAL_TILE411,
    r1Id: "entryA",
    boundaryTransformKind: "floor-entry-mutation-divergence",
  };
}

// PR-5.5d: Start door-key workload — the OnlyUp Start floor (TRACKED, same
// project) has a real sealed key room: entry at (6,4) is INSIDE the room with
// the green keys (24); the goal opens the green door at (5,5).  Real inventory
// acquire (pickup green key) -> consume (openDoor) with the door removed on the
// same transition.  The cross-floor boundary carries MT1 history and executes
// Start's arrival, so states span 2 visited floors.  Start's own stairs are
// steel/special-door-blocked (no keys on the floor), so a changeFloor edge is
// NOT produced — visitedFloors hole stays honestly partial.
function r1StartDoorKeySpec() {
  return {
    ...JSON.parse(JSON.stringify(smokeSpec)),
    id: "onlyup-5.5d-start",
    scope: { floors: ["Start"] },
    actionPolicy: {
      allowedFloors: ["Start"],
      actionKinds: ["battle", "event", "pickup", "interactPickup", "equip", "openDoor", "useTool", "changeFloor"],
    },
    start: { type: "floor", floorId: "Start", x: 6, y: 4, direction: "down" },
    goal: { type: "tileRemoved", floorId: "Start", x: 5, y: 5 },
  };
}

function startDoorKeyWorkload() {
  return {
    id: "start-door-key-entryA",
    chainLength: 2,
    r0Goal: { type: "heroAtLeast", floorId: "MT1", minHero: { exp: 2 } },
    r1Id: "start-door-key",
    boundaryTransformKind: "floor-entry-door-key-real-tower",
    note: "OnlyUp Start sealed key room: real green-key acquire + openDoor consume (tracked, same project)",
  };
}

const WORKLOADS_ALL = [
  ...r0VariantWorkloads(),
  ...r1VariantWorkloads(),
  chainWorkload(),
  ...xprodWorkloads(),
  mutationDivergenceWorkload(),
  chain4Workload(),
  startDoorKeyWorkload(),
];

// PR-5.5c expansion: 4-region chain (R0 -> R1 -> R2 -> R3), three boundaries.
function chain4Workload() {
  return {
    id: "chain4-exp6-entryA-entryB-entryC",
    chainLength: 4,
    r0Goal: { type: "heroAtLeast", floorId: "MT1", minHero: { exp: 6 } },
    r1Goal: R1_GOAL_EXP8,
    r2Goal: R1_GOAL_EXP8,
    r3Goal: R1_GOAL_EXP8,
    r1Id: "entryA",
    r2Id: "entryB",
    r3Id: "entryC",
    boundaryTransformKind: "chain-floor-entry-A-B-C",
  };
}

const WORKLOAD_SUBSET = (process.env.MR_WORKLOAD_SUBSET || "all").trim();
const WORKLOADS = WORKLOAD_SUBSET === "all"
  ? WORKLOADS_ALL
  : WORKLOADS_ALL.filter((wl) => WORKLOAD_SUBSET.split(",").includes(wl.id));

function r1SpecFor(wl) {
  if (wl.r1) return wl.r1;
  if (wl.r1Id === "entryA") return r1EntryA(wl.r1Goal);
  if (wl.r1Id === "entryB") return r1EntryB(wl.r1Goal);
  if (wl.r1Id === "entryC") return r1EntryC(wl.r1Goal);
  if (wl.r1Id === "inventoryUse") return r1InventoryUse(wl.r1Goal);
  if (wl.r1Id === "flagCarry") return r1FlagCarry(wl.r1Goal);
  if (wl.r1Id === "start-door-key") return r1StartDoorKeySpec();
  throw new Error(`unknown r1 variant ${wl.r1Id}`);
}

function r2SpecFor(wl) {
  return r1EntryB(wl.r2Goal);
}

function r3SpecFor(wl) {
  return r1EntryC(wl.r3Goal);
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

function buildExecuteConfig(regionSpec, searchOverride) {
  const root = ONLY_UP_ROOT;
  const proj = project;
  const task = compileExecutableSolveTask({
    schema: "motapathfinder.solve-task.v1",
    tower: { id: TOWER_ID, projectRoot: root, region: { spec: regionSpec } },
    objective: { mode: "max-final-hp" },
    search: searchOverride || searchConfig(),
    verification: { strictReplay: false },
  });
  const executeConfig = { ...(task.executeConfig || {}) };
  const resolution = resolveDpKeyProfile({
    project: proj,
    regionSpec,
    simulator: makeSimulator(proj, regionSpec, task),
    dpKeyProfile: null,
    options: { towerId: TOWER_ID },
  });
  if (resolution.builder) executeConfig.dpStateKeyBuilder = resolution.builder;
  return { task, executeConfig, resolution };
}

function regionContextFor(spec, index) {
  // Production-faithful project semantics: a chain is a SINGLE project (the
  // same as executeSolveJobV2, which loads one project per task).  The shared
  // project is enforced by a fail-fast gate in main()/runChain; regionContext
  // still carries the project so the corpus machinery is project-consistent.
  const proj = project;
  const simulator = makeSimulator(proj, spec, {});
  // The legal provider is built from the ACTUAL production milestone segment
  // (the same segment buildRegionMilestoneSpec hands to the region search), so
  // segment.goal / presentTiles / resource-timing / annotation semantics all
  // participate — not just actionPolicy.  policyOnlyProvider is kept for the
  // parity diagnostic (actionPolicy-only approximation vs full segment).
  const milestoneSpec = buildRegionMilestoneSpec(proj, spec);
  const segment = ((milestoneSpec && milestoneSpec.milestones) || [])[0] || {};
  return {
    id: `R${index}`,
    simulator,
    project: proj,
    ir: compileTowerIR(proj, spec, { towerId: TOWER_ID }),
    goalPredicate: goalPredicateFor(spec.goal),
    spec,
    segment,
    // Production-legal action semantics: the shadow's coverage, signatures and
    // behavior CEGAR use the SAME provider the segment search uses (built from
    // the region's ACTUAL milestone segment), so raw primitive actions
    // forbidden by the policy never enter the research classification.
    legalActionProvider: buildSegmentActionProvider(simulator, segment),
    policyOnlyProvider: buildSegmentActionProvider(simulator, { actionPolicy: spec.actionPolicy || {} }),
  };
}

// Executes a chain mirroring executeSolveJobV2's loop.  Returns per-boundary
// evidence (pre candidates, materialized inputs, post records, region result).
// searchOverrides (optional): per-region search config override, e.g. the deep
// R1 budget { 1: deepSearch }.
function runChain(regionSpecs, searchOverrides) {
  const contexts = regionSpecs.map(regionContextFor);
  const profiles = regionSpecs.map((spec, index) => buildExecuteConfig(spec, searchOverrides && searchOverrides[index]));
  const boundaries = [];
  let previousTerminals = null;
  for (let i = 0; i < regionSpecs.length; i += 1) {
    const spec = regionSpecs[i];
    const ctx = contexts[i];
    const cfg = profiles[i];
    if (i === 0) {
      const start = createStartState(ctx.project, ctx.simulator, spec, "chaos");
      const result = runMilestoneGraph(ctx.simulator, start, buildRegionMilestoneSpec(ctx.project, spec), {
        ...cfg.executeConfig,
        objectiveSpec: null,
        shouldStop: () => false,
      });
      assert.strictEqual(result.found, true, `R${i} must complete (${spec.id})`);
      assert.strictEqual(cfg.resolution.effectiveProfile, EXPERIMENTAL_PROFILE, `R0 must run the candidate default`);
      previousTerminals = result.finalCandidates;
      continue;
    }
    // Boundary i-1 -> i with a REAL floor entry (all R1/R2 variants use floor),
    // executed in the DESTINATION region's own project.
    const inputFrontier = materializeNextRegionFrontier(previousTerminals, spec, { project: ctx.project, simulator: ctx.simulator });
    assert.ok(inputFrontier.length >= 1, `boundary ${i - 1} must carry inputs`);
    previousTerminals.forEach((candidate, index) => {
      const entry = inputFrontier[index];
      const preLoc = candidate.state.hero.loc;
      const postLoc = entry.state.hero.loc;
      assert.notDeepStrictEqual({ x: preLoc.x, y: preLoc.y }, { x: postLoc.x, y: postLoc.y },
        `boundary ${i - 1} must relocate the hero (index ${index})`);
      assert.notStrictEqual(entry.inputCarriedExactFingerprint, entry.exactBoundaryStateFingerprint,
        `boundary ${i - 1} must change the exact identity (index ${index})`);
      assert.ok(entry.state.flags && entry.state.flags.__leaveLoc__,
        `boundary ${i - 1} must record __leaveLoc__ (index ${index})`);
    });
    const records = [];
    const result = runMilestoneGraph(ctx.simulator, inputFrontier[0].state, buildRegionMilestoneSpec(ctx.project, spec), {
      ...cfg.executeConfig,
      objectiveSpec: null,
      initialFrontier: inputFrontier,
      candidateKeyShadowRecorder: (record) => records.push(record),
      shouldStop: () => false,
    });
    assert.strictEqual(result.found, true, `R${i} must complete (${spec.id})`);
    assert.strictEqual(cfg.resolution.effectiveProfile, PRODUCTION_PROFILE, `R${i} must stay production (unapproved)`);
    assert.strictEqual(cfg.resolution.selectionReason, "scope-unapproved-fallback", `R${i} must be scope-unapproved-fallback`);
    assert.ok(records.length > 0, `R${i} post-boundary corpus must be non-empty`);
    boundaries.push({
      index: i - 1,
      regionA: contexts[i - 1],
      regionB: ctx,
      preCandidates: previousTerminals,
      inputFrontier,
      postRecords: records,
      // Raw recorder payloads WITH transition provenance (parent key /
      // parent inventory / parent mutations / action kind+summary) — the
      // hole-closure detectors need REAL parent -> action -> child edges.
      postRawRecords: records,
      entryTransformApplied: true,
      result,
    });
    previousTerminals = result.finalCandidates;
  }
  return { contexts, boundaries, profiles };
}

function analyzeChain(boundaries, candidateProfile, candidateKeyBuilder) {
  const corpus = buildMultiRegionCorpus({
    boundaries,
    project,
    candidateProfile,
    candidateKeyBuilder,
    exactKeyConfig: { dpKeyMode: "region" },
  });
  // Raw transition-provenance recorder payloads for the hole-closure detectors
  // (parent state key / parent inventory / parent mutations / action kind).
  corpus.postRawRecords = (boundaries || []).reduce((acc, b) => acc.concat(b.postRawRecords || []), []);
  corpus.entryTransformsApplied = (boundaries || []).filter((b) => b.entryTransformApplied === true).length;
  const statePartition = auditStatePartition(corpus.records);
  const boundaryPartition = auditBoundaryPartition(corpus.preBoundaryRecords, corpus.boundaryRecords);
  const cegar = runMergeGroupCegar({
    preBoundaryRecords: corpus.preBoundaryRecords,
    boundaryRecords: corpus.boundaryRecords,
    postBoundaryRecords: corpus.postBoundaryRecords,
    candidateProfile,
  });
  return { corpus, statePartition, boundaryPartition, cegar };
}

// Coverage uses PRODUCTION-LEGAL action semantics (records carry the legal
// action signature + kinds from the region's ACTUAL milestone-segment provider).
// Parity contract (the provider IS the production semantics, so the meaningful
// guarantees are):
//   - legal action kinds must be within the region's action policy (checked
//     per workload as legalKindsWithinPolicy);
//   - segment parity: the actionPolicy-only provider approximation must match
//     the ACTUAL segment provider on every corpus state (0 divergence means the
//     full production semantics — goal/presentTiles/resource-timing — add no
//     extra filtering on this fixture set; the shadow always uses the actual
//     segment provider regardless).
// Raw-vs-legal summary differences are INHERENT to production filtering
// (unsupported events, presentTiles protection, resource timing, provider-added
// interactPickup/floorFly) and are covered by the rawVsLegalControl.
function coverageOf(analysis) {
  const pre = analysis.corpus.preBoundaryRecords.length;
  const boundary = analysis.corpus.boundaryRecords.length;
  const post = analysis.corpus.postBoundaryRecords.length;
  const actionKinds = new Set();
  let segmentParityViolations = 0;
  analysis.corpus.postBoundaryRecords.forEach((record) => {
    (record.legalActionKinds || []).forEach((kind) => actionKinds.add(kind));
    const ctx = record.regionContext;
    // Segment parity: actual milestone-segment provider vs actionPolicy-only
    // approximation must agree on every corpus state.
    if (typeof ctx.legalActionProvider === "function" && typeof ctx.policyOnlyProvider === "function") {
      const actual = ctx.legalActionProvider(null, record.state).map((a) => a.summary).sort();
      const approx = ctx.policyOnlyProvider(null, record.state).map((a) => a.summary).sort();
      if (JSON.stringify(actual) !== JSON.stringify(approx)) segmentParityViolations += 1;
    }
  });
  return {
    preTerminalCount: pre,
    boundaryTransferCount: boundary,
    postSampleCount: post,
    distinctLegalActionKinds: actionKinds.size,
    legalKinds: Array.from(actionKinds).sort(),
    segmentParityViolations,
    ok: pre >= 2 && boundary >= 2 && post >= 2 && actionKinds.size >= 1 && segmentParityViolations === 0,
  };
}

function rawActionSignatureOf(regionContext, state) {
  try {
    return ((regionContext.simulator.enumeratePrimitiveActions(state) || {}).actions || [])
      .map((action) => action.summary)
      .sort();
  } catch (error) {
    return [];
  }
}

// PR-5.5c Continuation: semantic diversity report.  Collects DISTINCT values of
// the production-identity dimensions observed in a corpus.  Dimensions are read
// from the already-computed production DP key JSON (regionKey /
// reachableEndpointsKey / mutations) plus the raw state fields and the legal
// action signatures (no re-simulation).
function collectSemanticValues(records) {
  const sets = {
    regionKey: new Set(),
    reachableEndpoints: new Set(),
    mutationSummary: new Set(),
    inventory: new Set(),
    flags: new Set(),
    visitedFloors: new Set(),
    legalActionSet: new Set(),
    loc: new Set(),
    productionIdentity: new Set(),
    candidateIdentity: new Set(),
  };
  records.forEach((record) => {
    const state = record.state;
    try {
      const key = JSON.parse(record.productionDpKey || "{}");
      sets.regionKey.add(key.regionKey);
      sets.reachableEndpoints.add(key.reachableEndpointsKey);
      sets.mutationSummary.add(JSON.stringify(key.mutations || []));
    } catch (error) {
      // productionDpKey not JSON-decomposable (e.g. control overrides): skip
    }
    sets.inventory.add(JSON.stringify(state.inventory || {}));
    sets.flags.add(JSON.stringify(state.flags || {}));
    sets.visitedFloors.add(JSON.stringify(Object.keys(state.visitedFloors || {}).sort()));
    sets.legalActionSet.add(JSON.stringify(record.legalActionSignature || []));
    const loc = (state.hero && state.hero.loc) || {};
    sets.loc.add(`${loc.x},${loc.y}`);
    sets.productionIdentity.add(record.productionDpKey);
    sets.candidateIdentity.add(record.candidateDpKey);
  });
  return sets;
}

function sizesOf(sets) {
  return {
    regionKey: sets.regionKey.size,
    reachableEndpoints: sets.reachableEndpoints.size,
    mutationSummary: sets.mutationSummary.size,
    inventory: sets.inventory.size,
    flags: sets.flags.size,
    visitedFloors: sets.visitedFloors.size,
    legalActionSet: sets.legalActionSet.size,
    loc: sets.loc.size,
    productionIdentity: sets.productionIdentity.size,
    candidateIdentity: sets.candidateIdentity.size,
  };
}

function semanticDiversityOf(analysis) {
  return sizesOf(collectSemanticValues(analysis.corpus.records));
}

// TRUE global diversity: union the actual value sets across ALL workloads'
// records (never max() of per-workload counts — that would only prove
// per-workload variation, not cross-workload identity).
function globalSemanticDiversityOf(workloadAnalyses) {
  const allRecords = workloadAnalyses.reduce((acc, analysis) => acc.concat(analysis.corpus.records), []);
  return sizesOf(collectSemanticValues(allRecords));
}

// Synthetic aggregation regression control: per-workload counts of 1 must union
// to a global count of 2 (and shared sets must union, not max).
function semanticAggregationControl() {
  const mkRecord = (inventory, regionKey, mutations, loc) => ({
    productionDpKey: JSON.stringify({ regionKey, reachableEndpointsKey: "RE", mutations }),
    state: { inventory, flags: {}, visitedFloors: { MT1: true }, hero: { loc } },
    legalActionSignature: [],
  });
  const w1 = { corpus: { records: [
    mkRecord({ a: 1 }, "RK1", [{ floorId: "MT1", removed: ["1,1"] }], { x: 0, y: 0 }),
    mkRecord({ a: 1 }, "RK1", [{ floorId: "MT1", removed: ["1,2"] }], { x: 0, y: 1 }),
  ] } };
  const w2 = { corpus: { records: [
    mkRecord({ b: 1 }, "RK2", [{ floorId: "MT1", removed: ["1,2"] }], { x: 1, y: 0 }),
    mkRecord({ b: 1 }, "RK2", [{ floorId: "MT1", removed: ["1,3"] }], { x: 1, y: 1 }),
  ] } };
  const d1 = semanticDiversityOf(w1);
  const d2 = semanticDiversityOf(w2);
  assert.strictEqual(d1.inventory, 1, "aggregation control: W1 inventory per-workload distinct must be 1");
  assert.strictEqual(d2.inventory, 1, "aggregation control: W2 inventory per-workload distinct must be 1");
  assert.strictEqual(d1.mutationSummary, 2, "aggregation control: W1 mutation distinct must be 2");
  assert.strictEqual(d2.mutationSummary, 2, "aggregation control: W2 mutation distinct must be 2");
  const globalTwo = globalSemanticDiversityOf([w1, w2]);
  assert.strictEqual(globalTwo.inventory, 2, "aggregation control: GLOBAL inventory union must be 2 (not max(1,1)=1)");
  // {M1,M2} ∪ {M2,M3} = {M1,M2,M3} = 3 distinct (not max(2,2)=2)
  assert.strictEqual(globalTwo.mutationSummary, 3, "aggregation control: GLOBAL mutation union must be 3 (not max(2,2)=2)");
  return { globalInventoryUnion: globalTwo.inventory, globalMutationUnion: globalTwo.mutationSummary };
}

// Canonical mutation summary fingerprint.  BOTH sides of a transition must use
// this SAME helper (the recorder stores parentMutations with the identical
// expression in dp-search), so a no-mutation edge is [] == [] — a raw
// floorStates object like {"removed":{},"replaced":{}} would otherwise compare
// unequal and create a false "mutation changed" signal.
function mutationSummaryFingerprintOf(floorStates) {
  return JSON.stringify(listFloorMutationSummary(floorStates || {}));
}

// P1-3 hole-closure evidence (fail-closed): inventory and visitedFloors need
// dedicated TRANSITION-LEVEL evidence, not just distinct counts.  The inventory
// detector walks REAL parent -> action -> child edges from the recorder's
// transition provenance (parentInventory / parentMutations / actionKind):
//   acquire  = child.inventory[key] > parent.inventory[key] on an edge whose
//              action kind is an acquisition kind (pickup / interactPickup).
//   consume  = child.inventory[key] < parent.inventory[key] on an edge whose
//              action kind is a consumption kind (openDoor / useTool) AND the
//              CANONICAL child mutation summary differs from the CANONICAL
//              parent mutation summary (the door really changed on the SAME
//              transition).  A state-pair Cartesian product is NOT transition
//              evidence, and a key decrease alone is NOT consume evidence.
function inventoryHoleClosureOf(analysis) {
  const edges = analysis.corpus.postRawRecords || [];
  const distinct = new Set(edges.map((r) => JSON.stringify(r.state.inventory || {})));
  const acquireKinds = new Set(["pickup", "interactPickup"]);
  const consumeKinds = new Set(["openDoor", "useTool"]);
  let acquireExecuted = false;
  let acquireKey = null;
  let acquireAction = null;
  let consumeExecuted = false;
  let consumeKey = null;
  let consumeAction = null;
  edges.forEach((record) => {
    const child = record.state.inventory || {};
    if (record.parentInventory == null) return; // no parent edge -> no transition evidence
    const parent = record.parentInventory;
    const kind = record.actionKind;
    const keys = new Set([...Object.keys(child), ...Object.keys(parent)]);
    keys.forEach((key) => {
      const cv = Number(child[key] || 0);
      const pv = Number(parent[key] || 0);
      if (cv > pv && acquireKinds.has(kind) && !acquireExecuted) {
        acquireExecuted = true;
        acquireKey = key;
        acquireAction = kind;
      }
      if (pv > cv && consumeKinds.has(kind) && !consumeExecuted) {
        // door really changed on THIS transition: canonical child mutations
        // differ from the CANONICAL parent snapshot (same representation as
        // the recorder's parentMutations).
        if (mutationSummaryFingerprintOf(record.state.floorStates) !== record.parentMutations) {
          consumeExecuted = true;
          consumeKey = key;
          consumeAction = kind;
        }
      }
    });
  });
  return {
    distinctInventories: distinct.size,
    acquireExecuted,
    acquireKey,
    acquireAction,
    consumeExecuted,
    consumeKey,
    consumeAction,
    filled: distinct.size >= 2 && acquireExecuted && consumeExecuted,
  };
}

// Synthetic controls for the inventory transition detector:
//   negative-1 — two states with different inventories and DIFFERENT mutations
//     but NO parent->child edge must NOT be read as acquire/consume;
//   negative-2 — a REAL openDoor edge with key 1->0 but NO canonical mutation
//     change must NOT be read as consume (representation parity guard);
//   positive  — a REAL edge chain S0 --pickup--> S1 --openDoor--> S2 with the
//     door removed on the SAME transition must be read as acquire + consume.
function inventoryTransitionControls() {
  const noMutationFp = mutationSummaryFingerprintOf({ A1: { removed: {}, replaced: {} } });
  const doorRemovedFp = mutationSummaryFingerprintOf({ A1: { removed: { "5,3": true }, replaced: {} } });
  assert.notStrictEqual(noMutationFp, doorRemovedFp, "transition control: canonical fingerprints must distinguish door removal");
  const s0 = { state: { inventory: { yellowKey: 0 }, floorStates: { A1: { removed: {} } } }, parentInventory: null, actionKind: null, parentMutations: null };
  const s1 = { state: { inventory: { yellowKey: 1 }, floorStates: { A1: { removed: { "5,3": true } } } }, parentInventory: null, actionKind: null, parentMutations: null };
  const negative1 = inventoryHoleClosureOf({ corpus: { postRawRecords: [s0, s1] } });
  assert.strictEqual(negative1.distinctInventories, 2, "transition control (negative-1): distinct inventories must be 2");
  assert.strictEqual(negative1.acquireExecuted, false, "transition control (negative-1): no parent edge must NOT be acquire");
  assert.strictEqual(negative1.consumeExecuted, false, "transition control (negative-1): no parent edge must NOT be consume");
  assert.strictEqual(negative1.filled, false, "transition control (negative-1): must not be filled without transitions");

  // negative-2: real openDoor edge, key consumed, but NO mutation change.
  const eDoorNoMutation = {
    state: { inventory: { yellowKey: 0 }, floorStates: { A1: { removed: {} } } },
    parentInventory: { yellowKey: 1 },
    parentMutations: noMutationFp,
    actionKind: "openDoor",
  };
  const negative2 = inventoryHoleClosureOf({ corpus: { postRawRecords: [eDoorNoMutation] } });
  assert.strictEqual(negative2.consumeExecuted, false, "transition control (negative-2): key decrease WITHOUT canonical mutation change must NOT be consume");
  assert.strictEqual(negative2.filled, false, "transition control (negative-2): must not be filled");

  // positive: pickup (key 0->1, no mutation change) then openDoor (key 1->0,
  // door removed on the SAME transition).
  const ePickup = {
    state: { inventory: { yellowKey: 1 }, floorStates: { A1: { removed: {} } } },
    parentInventory: { yellowKey: 0 },
    parentMutations: noMutationFp,
    actionKind: "pickup",
  };
  const eDoor = {
    state: { inventory: { yellowKey: 0 }, floorStates: { A1: { removed: { "5,3": true } } } },
    parentInventory: { yellowKey: 1 },
    parentMutations: noMutationFp,
    actionKind: "openDoor",
  };
  const positive = inventoryHoleClosureOf({ corpus: { postRawRecords: [ePickup, eDoor] } });
  assert.strictEqual(positive.acquireExecuted, true, "transition control (positive): pickup edge must be acquire");
  assert.strictEqual(positive.consumeExecuted, true, "transition control (positive): openDoor edge with canonical mutation change must be consume");
  assert.strictEqual(positive.filled, true, "transition control (positive): acquire+consume must fill");
  return { negative1Filled: negative1.filled, negative2Filled: negative2.filled, positiveFilled: positive.filled };
}

function visitedFloorsHoleClosureOf(analysis) {
  const records = analysis.corpus.records;
  const edges = analysis.corpus.postRawRecords || [];
  let maxVisitedFloorCount = 0;
  const sets = new Set();
  records.forEach((r) => {
    const floors = Object.keys(r.state.visitedFloors || {}).sort();
    sets.add(JSON.stringify(floors));
    maxVisitedFloorCount = Math.max(maxVisitedFloorCount, floors.length);
  });
  // Supplementary transition-level flags (honest current values): a real
  // changeFloor action edge, an arrival entry transform, and post-arrival
  // search records.
  const changeFloorExecuted = edges.some((r) => r.actionKind === "changeFloor");
  const arrivalExecuted = (analysis.corpus.entryTransformsApplied || 0) > 0;
  const postArrivalSearchObserved = edges.length > 0;
  return {
    maxVisitedFloorCount,
    visitedFloorSets: Array.from(sets).slice(0, 5),
    distinctSets: sets.size,
    changeFloorExecuted,
    arrivalExecuted,
    postArrivalSearchObserved,
    filled: maxVisitedFloorCount >= 2 && changeFloorExecuted,
  };
}

function hasSemanticVariation(diversity) {
  return diversity.mutationSummary >= 2
    || diversity.reachableEndpoints >= 2
    || diversity.inventory >= 2
    || diversity.flags >= 2
    || diversity.legalActionSet >= 2
    || diversity.loc >= 2;
}

function diffCandidateProjections(left, right) {
  const differing = { structuralCandidate: [], resourceIdentity: [], eventHazardLabel: [] };
  const diffKeys = (a, b, out) => {
    const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
    keys.forEach((key) => {
      const av = a ? a[key] : undefined;
      const bv = b ? b[key] : undefined;
      if (JSON.stringify(av) !== JSON.stringify(bv)) out.push({ field: key, a: av, b: bv });
    });
  };
  diffKeys(left.structuralCandidate, right.structuralCandidate, differing.structuralCandidate);
  diffKeys(left.resourceIdentity, right.resourceIdentity, differing.resourceIdentity);
  diffKeys(left.eventHazardLabel, right.eventHazardLabel, differing.eventHazardLabel);
  return differing;
}

// Field-level diff of the PRODUCTION identity decomposition (P1-3): why does
// the production identity think the two states differ, beyond the candidate
// projection?  Compares regionKey / reachableEndpointsKey / mutationSummary /
// exactDpKey / hero / equipment / inventory / flags / visitedFloors /
// eventHazardLabel / loc / floorId (nested objects compared structurally).
function diffProductionIdentity(projA, projB) {
  const diffKeys = (a, b, out) => {
    const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
    keys.forEach((key) => {
      const av = a ? a[key] : undefined;
      const bv = b ? b[key] : undefined;
      if (JSON.stringify(av) !== JSON.stringify(bv)) out.push({ field: key, a: av, b: bv });
    });
  };
  const differing = [];
  diffKeys(projA, projB, differing);
  return differing;
}

function productionProjectionOf(ctx, state) {
  const proj = buildStateProjection(ctx.simulator, ctx.project, ctx.ir, state, {
    goalPredicate: ctx.goalPredicate,
    dpKeyMode: "region",
  });
  return {
    regionKey: proj.legacyReference.regionKey,
    reachableEndpointsKey: proj.legacyReference.reachableEndpointsKey,
    mutationSummary: proj.legacyReference.mutationSummary,
    exactDpKey: proj.legacyReference.exactDpKey,
    hero: proj.resourceIdentity.hero,
    equipment: proj.resourceIdentity.equipment,
    inventory: proj.resourceIdentity.inventory,
    flags: proj.resourceIdentity.flags,
    visitedFloors: proj.resourceIdentity.visitedFloors,
    eventHazardLabel: proj.eventHazardLabel,
    loc: state.hero && state.hero.loc,
    floorId: state.floorId,
  };
}

// Minimal witness artifact for the FIRST real merge: field-level candidate
// projection diff (empty means "candidate says equal") + PRODUCTION identity
// decomposition diff (why production says different) + boundary/CEGAR evidence.
// Merge groups are scoped exactly like the audits (region scope for the state
// partition, boundary scope for the boundary partition) — never cross-scope.
function captureMergeWitness(wl, analysis) {
  const witness = {
    workloadId: wl.id,
    capturedAt: new Date().toISOString(),
    statePartition: {
      splitExactKeyCount: analysis.statePartition.splitExactKeyCount,
      mergedCandidateKeyCount: analysis.statePartition.mergedCandidateKeyCount,
      partitionRelation: analysis.statePartition.partitionRelation,
      perScope: analysis.statePartition.perScope,
    },
    boundaryPartition: analysis.boundaryPartition,
    cegar: {
      unsafeCount: analysis.cegar.unsafeCount,
      boundaryInequivalentGroups: analysis.cegar.boundaryInequivalentGroups,
      unsafeWitnesses: analysis.cegar.unsafeWitnesses,
    },
    mergeGroups: [],
  };
  // State-partition merge groups are scoped by region execution context.
  const byScope = new Map();
  analysis.corpus.records.forEach((record) => {
    const scope = `${record.regionContext.id}|${record.candidateDpKey}`;
    if (!byScope.has(scope)) byScope.set(scope, []);
    byScope.get(scope).push(record);
  });
  byScope.forEach((members, scope) => {
    const distinctExact = new Set(members.map((m) => m.productionDpKey));
    if (distinctExact.size <= 1) return;
    const byExact = new Map();
    members.forEach((record) => { if (!byExact.has(record.productionDpKey)) byExact.set(record.productionDpKey, record); });
    const reps = Array.from(byExact.values());
    const first = reps[0];
    const ctx = first.regionContext;
    const groups = reps.slice(1).map((other) => {
      const projA = productionProjectionOf(ctx, first.state);
      const projB = productionProjectionOf(ctx, other.state);
      return {
        scope,
        layer: other.layer,
        boundaryIndex: other.boundaryIndex,
        regionId: other.regionId,
        productionKeyA: first.productionDpKey,
        productionKeyB: other.productionDpKey,
        exactFingerprintA: first.exactStateFingerprint,
        exactFingerprintB: other.exactStateFingerprint,
        hpA: first.hp,
        hpB: other.hp,
        candidateProjectionDiff: first.candidateProjection && other.candidateProjection
          ? diffCandidateProjections(first.candidateProjection, other.candidateProjection)
          : null,
        productionIdentityDiff: diffProductionIdentity(projA, projB),
        productionProjectionA: projA,
        productionProjectionB: projB,
        legalActionsA: first.legalActionSignature,
        legalActionsB: other.legalActionSignature,
        terminalA: first.terminalProjection,
        terminalB: other.terminalProjection,
      };
    });
    witness.mergeGroups.push({ scope, candidateKey: members[0].candidateDpKey, memberCount: members.length, groups });
  });
  fs.mkdirSync(WITNESS_DIR, { recursive: true });
  const file = path.join(WITNESS_DIR, `witness-${wl.id}.json`);
  fs.writeFileSync(file, JSON.stringify(witness, null, 2));
  return file;
}

// --- Controls ---------------------------------------------------------------

function allCollidingControl(boundaries) {
  const broken = analyzeChain(boundaries, CANDIDATE_PROFILE, () => "ALL-COLLIDING");
  assert.ok(
    broken.statePartition.mergedCandidateKeyCount > 0,
    "negative control: all-colliding key must produce scoped state merges",
  );
  assert.ok(
    broken.boundaryPartition.inequivalentGroupCount > 0,
    "negative control: all-colliding key must be boundary-inequivalent",
  );
  assert.ok(broken.cegar.unsafeCount > 0, "negative control: all-colliding key must be unsafe under CEGAR");
  // Scoped isolation: the scoped audit reports merges per region scope; a merge
  // group never spans region contexts (records with the same candidate key in
  // different scopes never share a group).
  const scopedGroups = new Map();
  broken.corpus.records.forEach((record) => {
    const scope = `${record.regionContext.id}|${record.candidateDpKey}`;
    if (!scopedGroups.has(scope)) scopedGroups.set(scope, new Set());
    scopedGroups.get(scope).add(record.productionDpKey);
  });
  let crossScopeMerge = 0;
  const recordsByScope = new Map();
  broken.corpus.records.forEach((record) => {
    const scope = `${record.regionContext.id}|${record.candidateDpKey}`;
    if (!recordsByScope.has(scope)) recordsByScope.set(scope, []);
    recordsByScope.get(scope).push(record);
  });
  scopedGroups.forEach((exactSet, scope) => {
    if (exactSet.size <= 1) return;
    const scopesInGroup = new Set((recordsByScope.get(scope) || []).map((r) => r.regionContext.id));
    if (scopesInGroup.size > 1) crossScopeMerge += 1;
  });
  assert.strictEqual(crossScopeMerge, 0, "negative control: merge groups must never span region scopes");
  return { detected: true, scopedMerges: broken.statePartition.mergedCandidateKeyCount };
}

// Neutral control (P1-1): a candidate key REUSED across two different
// boundaries must NOT be reported as a merge — it never competes in one DP.
// Positive (constructed): two records in the SAME boundary with the same
// candidate key and different production identities MUST be detected as a real
// merge by the scoped audit.
function crossBoundaryReuseControl(boundaries) {
  const corpus = buildMultiRegionCorpus({
    boundaries,
    project,
    candidateProfile: CANDIDATE_PROFILE,
    exactKeyConfig: { dpKeyMode: "region" },
  });
  const keysByBoundary = new Map();
  corpus.records.forEach((record) => {
    if (!keysByBoundary.has(record.boundaryIndex)) keysByBoundary.set(record.boundaryIndex, new Set());
    keysByBoundary.get(record.boundaryIndex).add(record.candidateDpKey);
  });
  const b0Keys = keysByBoundary.get(0) || new Set();
  const b1Keys = keysByBoundary.get(1) || new Set();
  const shared = Array.from(b0Keys).filter((key) => b1Keys.has(key));
  assert.ok(shared.length > 0, "cross-boundary control: the chain must reuse candidate keys across boundaries");

  // Neutral: scoped audit must report ZERO merges (per boundary AND overall).
  const partition = auditStatePartition(corpus.records);
  assert.strictEqual(partition.mergedCandidateKeyCount, 0, "cross-boundary key reuse must NOT be a merge (scoped audit)");
  Object.keys(partition.byBoundary || {}).forEach((b) => {
    assert.strictEqual(partition.byBoundary[b].mergedCandidateKeyCount, 0, `cross-boundary control: boundary ${b} must have no internal merge`);
  });

  // Positive (constructed): same boundary, two production identities -> one
  // candidate key -> the scoped audit MUST detect a real merge.
  const ctx = boundaries[0].regionA;
  const m1 = boundaries[0].preCandidates[0].state;
  const m2 = boundaries[0].preCandidates[1].state;
  const keyBuilder = () => "SAME-BOUNDARY-POSITIVE";
  const recordOptions = {
    regionContext: ctx,
    project,
    candidateProfile: CANDIDATE_PROFILE,
    candidateKeyBuilder: keyBuilder,
    exactKeyConfig: { dpKeyMode: "region" },
  };
  const p1 = { ...buildCorpusRecord({
    ...recordOptions, state: m1, layer: "pre-boundary", regionIndex: 0, regionId: ctx.id,
    extra: { boundaryIndex: 0, localIndex: 0 },
  }), productionDpKey: "POS-EXACT-1" };
  const p2 = { ...buildCorpusRecord({
    ...recordOptions, state: m2, layer: "pre-boundary", regionIndex: 0, regionId: ctx.id,
    extra: { boundaryIndex: 0, localIndex: 1 },
  }), productionDpKey: "POS-EXACT-2" };
  const positive = auditStatePartition([p1, p2]);
  assert.ok(positive.mergedCandidateKeyCount >= 1, "cross-boundary control (positive): same-boundary merge must be detected");
  // P1-3: the witness path must ACTUALLY execute on a constructed collision and
  // produce an explainable artifact (not just exist in static code).
  const witness = witnessPathControl([p1, p2]);
  return {
    sharedKeyCount: shared.length,
    scopedMerges: partition.mergedCandidateKeyCount,
    sameBoundaryMergeDetected: positive.mergedCandidateKeyCount,
    ...witness,
  };
}

// P1-3: run captureMergeWitness on a CONSTRUCTED same-scope collision, re-read
// the JSON artifact, and verify it explains WHY production differs (beyond the
// exactDpKey hash).  Artifact is removed afterwards.
function witnessPathControl(positiveRecords) {
  const fakeAnalysis = {
    corpus: { records: positiveRecords },
    statePartition: auditStatePartition(positiveRecords),
    boundaryPartition: { boundaryTransferEquivalent: true, groupsAudited: 0, inequivalentGroupCount: 0, groups: [], witnesses: [] },
    cegar: { unsafeCount: 0, boundaryInequivalentGroups: 0, unsafeWitnesses: [] },
  };
  const file = captureMergeWitness({ id: "witness-path-control" }, fakeAnalysis);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } finally {
    fs.unlinkSync(file);
  }
  assert.ok(parsed.mergeGroups.length > 0, "witness control: merge groups must be emitted");
  const group = parsed.mergeGroups[0];
  assert.ok(String(group.scope).includes("SAME-BOUNDARY-POSITIVE"), "witness control: scope must be the constructed same-boundary scope");
  assert.ok(group.groups.length > 0, "witness control: merge pair must be emitted");
  const pair = group.groups[0];
  assert.ok(pair.productionProjectionA && pair.productionProjectionB, "witness control: production projections must be present");
  assert.ok(pair.productionKeyA !== pair.productionKeyB, "witness control: production keys must differ");
  assert.ok(Array.isArray(pair.productionIdentityDiff), "witness control: production identity diff must be an array");
  const explanatory = (pair.productionIdentityDiff || []).filter((d) => d.field !== "exactDpKey");
  assert.ok(explanatory.length > 0,
    `witness control: production identity diff must explain WHY production differs (fields: ${(pair.productionIdentityDiff || []).map((d) => d.field).join(",")})`);
  return {
    witnessArtifactExecuted: true,
    explanatoryFields: explanatory.map((d) => d.field),
  };
}

// Raw-vs-legal control (P1-2): two states whose RAW action sets differ ONLY
// through policy-forbidden actions have EQUAL production-legal action sets and
// must NOT classify unsafe.  MT1's events are policy-filtered (unsupported), so
// an event-only policy makes the raw battle differences forbidden and the legal
// sets equal.
function rawVsLegalControl(campaign) {
  const ctx = campaign.boundaries[0].regionB;
  const m1 = campaign.boundaries[0].inputFrontier[0].state;
  const m2 = campaign.boundaries[0].inputFrontier[1].state;
  const raw1 = rawActionSignatureOf(ctx, m1);
  const raw2 = rawActionSignatureOf(ctx, m2);
  assert.notDeepStrictEqual(raw1, raw2, "raw-vs-legal control: raw action sets must differ");
  const eventOnlyProvider = buildSegmentActionProvider(ctx.simulator, {
    actionPolicy: { allowedFloors: ["MT1"], actionKinds: ["event"] },
  });
  const legal1 = eventOnlyProvider(null, m1).map((action) => action.summary).sort();
  const legal2 = eventOnlyProvider(null, m2).map((action) => action.summary).sort();
  assert.deepStrictEqual(legal1, legal2, "raw-vs-legal control: production-legal action sets must be equal");
  // The raw differences must all be policy-forbidden kinds (battles under the
  // event-only policy).
  const forbiddenKinds = new Set(["event"]);
  raw1.forEach((summary) => {
    const kind = String(summary).split(":")[0];
    if (!legal1.includes(summary)) {
      assert.ok(!forbiddenKinds.has(kind), `raw-vs-legal control: raw-only action kind must be policy-forbidden (got ${kind})`);
    }
  });
  const options = {
    goalPredicate: ctx.goalPredicate,
    actionProvider: (state) => eventOnlyProvider(null, state),
  };
  const b1 = buildStateBehavior(ctx.simulator, ctx.project, ctx.ir, m1, options);
  const b2 = buildStateBehavior(ctx.simulator, ctx.project, ctx.ir, m2, options);
  const classification = classifyPair(b1, b2);
  assert.notStrictEqual(classification.classification, "unsafe",
    `raw-vs-legal control: policy-forbidden raw differences must not classify unsafe (got ${classification.classification})`);
  return { rawSetsDiffer: true, legalSetsEqual: true, classification: classification.classification };
}

// HP-only divergence within one post-boundary semantic identity must NOT be
// boundary-inequivalent and must pass classifyPair (dominance-safe).
function dominanceSafeControl(boundaries) {
  const firstBoundary = boundaries[0];
  const ctx = firstBoundary.regionB;
  const base = firstBoundary.inputFrontier[0].state;
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
    ...recordOptions, state: m1, layer: "boundary-transfer", regionIndex: 1, regionId: ctx.id,
    extra: { boundaryIndex: 0, localIndex: 0, postBoundaryExactFingerprint: exactStateFingerprint(m1) },
  });
  const b2 = buildCorpusRecord({
    ...recordOptions, state: m2, layer: "boundary-transfer", regionIndex: 1, regionId: ctx.id,
    extra: { boundaryIndex: 0, localIndex: 1, postBoundaryExactFingerprint: exactStateFingerprint(m2) },
  });
  assert.strictEqual(b1.productionDpKey, b2.productionDpKey, "dominance control: post semantic identities equal");
  assert.notStrictEqual(b1.exactStateFingerprint, b2.exactStateFingerprint, "dominance control: exact diverges (HP)");
  const pre1 = { ...buildCorpusRecord({
    ...recordOptions, state: m1, layer: "pre-boundary", regionIndex: 0, regionId: "R0",
    extra: { boundaryIndex: 0, localIndex: 0, preBoundaryStateFingerprint: exactStateFingerprint(m1) },
  }), productionDpKey: "PRE-EXACT-1" };
  const pre2 = { ...buildCorpusRecord({
    ...recordOptions, state: m2, layer: "pre-boundary", regionIndex: 0, regionId: "R0",
    extra: { boundaryIndex: 0, localIndex: 1, preBoundaryStateFingerprint: exactStateFingerprint(m2) },
  }), productionDpKey: "PRE-EXACT-2" };
  const partition = auditBoundaryPartition([pre1, pre2], [b1, b2]);
  const group = partition.groups.find((g) => g.candidateKey === "DOMINANCE-CONTROL");
  assert.ok(group, "dominance control: merge group must be audited");
  assert.strictEqual(group.boundaryEquivalent, true, "dominance control: must be boundary-equivalent");
  assert.strictEqual(partition.inequivalentGroupCount, 0, "dominance control: HP-only divergence not inequivalent");
  const cegar = runMergeGroupCegar({
    preBoundaryRecords: [pre1, pre2],
    boundaryRecords: [b1, b2],
    postBoundaryRecords: [],
    candidateProfile: CANDIDATE_PROFILE,
  });
  assert.strictEqual(cegar.unsafeCount, 0, "dominance control: must pass CEGAR");
  return { safe: true };
}

// Same forced candidate key; materialized post-boundary production identities
// DIFFER -> Stage 1 must immediately flag boundary-inequivalent (no classifyPair).
function boundarySemanticDriftControl(boundaries) {
  const firstBoundary = boundaries[0];
  const ctx = firstBoundary.regionB;
  const m1 = firstBoundary.inputFrontier[0].state;
  const m2 = firstBoundary.inputFrontier[1].state;
  const keyBuilder = () => "SEMANTIC-DRIFT";
  const recordOptions = {
    regionContext: ctx,
    project,
    candidateProfile: CANDIDATE_PROFILE,
    candidateKeyBuilder: keyBuilder,
    exactKeyConfig: { dpKeyMode: "region" },
  };
  const b1 = buildCorpusRecord({
    ...recordOptions, state: m1, layer: "boundary-transfer", regionIndex: 1, regionId: ctx.id,
    extra: { boundaryIndex: 0, localIndex: 0, postBoundaryExactFingerprint: exactStateFingerprint(m1) },
  });
  const b2 = buildCorpusRecord({
    ...recordOptions, state: m2, layer: "boundary-transfer", regionIndex: 1, regionId: ctx.id,
    extra: { boundaryIndex: 0, localIndex: 1, postBoundaryExactFingerprint: exactStateFingerprint(m2) },
  });
  const pre1 = { ...buildCorpusRecord({
    ...recordOptions, state: m1, layer: "pre-boundary", regionIndex: 0, regionId: "R0",
    extra: { boundaryIndex: 0, localIndex: 0 },
  }), productionDpKey: "PRE-EXACT-1" };
  const pre2 = { ...buildCorpusRecord({
    ...recordOptions, state: m2, layer: "pre-boundary", regionIndex: 0, regionId: "R0",
    extra: { boundaryIndex: 0, localIndex: 1 },
  }), productionDpKey: "PRE-EXACT-2" };
  const partition = auditBoundaryPartition([pre1, pre2], [b1, b2]);
  const group = partition.groups.find((g) => g.candidateKey === "SEMANTIC-DRIFT");
  assert.ok(group, "semantic-drift control: merge group must be audited");
  assert.strictEqual(group.boundaryEquivalent, false, "semantic-drift control: different post semantic identities must be inequivalent");
  const cegar = runMergeGroupCegar({
    preBoundaryRecords: [pre1, pre2],
    boundaryRecords: [b1, b2],
    postBoundaryRecords: [],
    candidateProfile: CANDIDATE_PROFILE,
  });
  assert.ok(cegar.unsafeCount >= 1, "semantic-drift control: Stage 1 must flag unsafe");
  assert.ok(cegar.unsafeWitnesses.some((w) => w.stage === "boundary-transfer"), "semantic-drift control: must be boundary-transfer stage");
  return { detected: true };
}

// Same post-boundary semantic identity (overridden) but REAL legal-action
// drift between the materialized states -> classifyPair must flag unsafe.
function postBoundaryActionDriftControl(boundaries) {
  const firstBoundary = boundaries[0];
  const ctx = firstBoundary.regionB;
  const m1 = firstBoundary.inputFrontier[0].state;
  const m2 = firstBoundary.inputFrontier[1].state;
  const sig1 = legalActionSignatureOf(ctx, m1);
  const sig2 = legalActionSignatureOf(ctx, m2);
  assert.notDeepStrictEqual(sig1, sig2, "action-drift control: states must have different legal actions");
  const keyBuilder = () => "ACTION-DRIFT";
  const recordOptions = {
    regionContext: ctx,
    project,
    candidateProfile: CANDIDATE_PROFILE,
    candidateKeyBuilder: keyBuilder,
    exactKeyConfig: { dpKeyMode: "region" },
  };
  const b1 = { ...buildCorpusRecord({
    ...recordOptions, state: m1, layer: "boundary-transfer", regionIndex: 1, regionId: ctx.id,
    extra: { boundaryIndex: 0, localIndex: 0, postBoundaryExactFingerprint: exactStateFingerprint(m1) },
  }), productionDpKey: "POST-SEMANTIC-SAME" };
  const b2 = { ...buildCorpusRecord({
    ...recordOptions, state: m2, layer: "boundary-transfer", regionIndex: 1, regionId: ctx.id,
    extra: { boundaryIndex: 0, localIndex: 1, postBoundaryExactFingerprint: exactStateFingerprint(m2) },
  }), productionDpKey: "POST-SEMANTIC-SAME" };
  const pre1 = { ...buildCorpusRecord({
    ...recordOptions, state: m1, layer: "pre-boundary", regionIndex: 0, regionId: "R0",
    extra: { boundaryIndex: 0, localIndex: 0 },
  }), productionDpKey: "PRE-EXACT-1" };
  const pre2 = { ...buildCorpusRecord({
    ...recordOptions, state: m2, layer: "pre-boundary", regionIndex: 0, regionId: "R0",
    extra: { boundaryIndex: 0, localIndex: 1 },
  }), productionDpKey: "PRE-EXACT-2" };
  const cegar = runMergeGroupCegar({
    preBoundaryRecords: [pre1, pre2],
    boundaryRecords: [b1, b2],
    postBoundaryRecords: [],
    candidateProfile: CANDIDATE_PROFILE,
  });
  assert.ok(cegar.unsafeCount >= 1, "action-drift control: classifyPair must flag unsafe");
  assert.ok(cegar.unsafeWitnesses.some((w) => w.stage === "post-boundary-behavior"), "action-drift control: must be behavior stage");
  return { detected: true };
}

function legalActionSignatureOf(ctx, state) {
  try {
    const actions = typeof ctx.legalActionProvider === "function"
      ? (ctx.legalActionProvider(null, state) || [])
      : (((ctx.simulator.enumeratePrimitiveActions(state) || {}).actions) || []);
    return actions.map((action) => action.summary).sort();
  } catch (error) {
    return ["__enumerateError__"];
  }
}

async function main() {
  assert.strictEqual(CANDIDATE_PROFILE, "without-start-component", "candidate identity must be untouched");
  fs.mkdirSync(WITNESS_DIR, { recursive: true });

  // P1-2 fail-fast: production executeSolveJobV2 loads ONE project per chain;
  // the research corpus must be production-faithful, so no region spec may
  // declare a different project root.  (The earlier cross-tower whiteisland
  // exploration was harness-only and is NOT part of the production-faithful
  // corpus; whiteisland data is untracked in git, so CI cannot reproduce it.)
  WORKLOADS.forEach((wl) => {
    const regionSpecs = [r0SpecFor(wl.r0Goal), r1SpecFor(wl)];
    if (wl.chainLength >= 3) regionSpecs.push(r2SpecFor(wl));
    if (wl.chainLength >= 4) regionSpecs.push(r3SpecFor(wl));
    // The invariant is that every region in the chain shares ONE project root
    // (production executeSolveJobV2 loads a single project per task).  Roots
    // may be expressed as absolute paths or relative to the repo root; resolve
    // both to absolute before comparing.
    const resolvedRoots = regionSpecs.map((spec) => {
      const root = (spec && spec.projectRoot) || ONLY_UP_ROOT;
      return path.isAbsolute(root) ? root : path.resolve(ROOT, root);
    });
    const firstRoot = resolvedRoots[0];
    resolvedRoots.forEach((root) => {
      assert.strictEqual(root, firstRoot, `${wl.id}: all regions in a chain must use the SAME (tracked) project — cross-project chains are not production-faithful`);
    });
  });

  // Controls run once on a fixed exp6-entryA chain (reused campaign).
  const controlChain = runChain([r0SpecFor({ type: "heroAtLeast", floorId: "MT1", minHero: { exp: 6 } }), r1EntryA(R1_GOAL_EXP8)]);
  const controls = {
    allColliding: allCollidingControl(controlChain.boundaries),
    dominanceSafe: dominanceSafeControl(controlChain.boundaries),
    boundarySemanticDrift: boundarySemanticDriftControl(controlChain.boundaries),
    postBoundaryActionDrift: postBoundaryActionDriftControl(controlChain.boundaries),
    rawVsLegal: rawVsLegalControl(controlChain),
  };
  // Cross-boundary neutral control needs the 3-region chain (two boundaries).
  const chainCampaign = runChain([r0SpecFor({ type: "heroAtLeast", floorId: "MT1", minHero: { exp: 6 } }), r1EntryA(R1_GOAL_EXP8), r1EntryB(R1_GOAL_EXP8)]);
  const crossBoundary = crossBoundaryReuseControl(chainCampaign.boundaries);

  const workloadResults = [];
  const workloadAnalyses = [];
  let needsReview = false;
  const witnessFiles = [];

  for (const wl of WORKLOADS) {
    const regionSpecs = [r0SpecFor(wl.r0Goal), r1SpecFor(wl)];
    if (wl.chainLength >= 3) regionSpecs.push(r2SpecFor(wl));
    if (wl.chainLength >= 4) regionSpecs.push(r3SpecFor(wl));
    const searchOverrides = wl.r1Search ? { 1: wl.r1Search } : null;
    const campaign = runChain(regionSpecs, searchOverrides);
    const analysis = analyzeChain(campaign.boundaries, CANDIDATE_PROFILE, null);
    const coverage = coverageOf(analysis);

    const r1Spec = regionSpecs[1];
    const r1ActionKinds = ((r1Spec.actionPolicy || {}).actionKinds || []).slice();
    // Workload-specific policy assertion: observed legal kinds must be within
    // the region's allowed action kinds (P1-2: coverage uses legal semantics).
    const legalKindsWithinPolicy = (coverage.legalKinds || []).every((kind) => r1ActionKinds.includes(kind));
    // Workload-specific carry evidence (P2): the boundary must actually carry
    // the R0 terminal's inventory / flag VALUES into the R1 input states.
    const r0Terminal = campaign.boundaries[0].preCandidates[0].state;
    const inputs = campaign.boundaries[0].inputFrontier || [];
    let inventoryCarryEvidence = true;
    let flagValueCarryEvidence = true;
    if (wl.r1Id === "inventoryUse") {
      inventoryCarryEvidence = inputs.some((entry) =>
        JSON.stringify(entry.state.inventory || {}) === JSON.stringify(r0Terminal.inventory || {}));
    }
    if (wl.r1Id === "flagCarry") {
      const flagKeys = ["hatred", "autoBattle", "shiqu"];
      const r0Flags = flagKeys
        .filter((k) => r0Terminal.flags && r0Terminal.flags[k] != null)
        .map((k) => [k, r0Terminal.flags[k]]);
      flagValueCarryEvidence = r0Flags.length > 0 && inputs.some((entry) =>
        r0Flags.every(([k, v]) => entry.state.flags && entry.state.flags[k] === v));
    }
    const result = {
      id: wl.id,
      r0Goal: JSON.parse(JSON.stringify(wl.r0Goal)),
      r0TerminalCandidateCount: campaign.boundaries[0].preCandidates.length,
      r1Start: JSON.parse(JSON.stringify(r1Spec.start || {})),
      r1Scope: JSON.parse(JSON.stringify(r1Spec.scope || {})),
      r1ActionKinds: r1ActionKinds.slice(),
      boundaryTransformKind: wl.boundaryTransformKind || "floor-entry",
      chainLength: wl.chainLength,
      coverage,
      semanticDiversity: semanticDiversityOf(analysis),
      legalKindsWithinPolicy,
      inventoryCarryEvidence,
      flagValueCarryEvidence,
      layers: analysis.corpus.layers,
      statePartition: analysis.statePartition,
      boundaryPartition: analysis.boundaryPartition,
      cegar: analysis.cegar,
    };
    workloadResults.push(result);
    workloadAnalyses.push(analysis);
    assert.ok(legalKindsWithinPolicy, `${wl.id}: observed legal action kinds must be within the region's action policy`);
    assert.ok(inventoryCarryEvidence, `${wl.id}: inventory-carry workload must observe the R0 inventory value in a boundary input`);
    assert.ok(flagValueCarryEvidence, `${wl.id}: flag-carry workload must observe the R0 flag VALUE preserved in a boundary input`);

    const hasMerge = analysis.statePartition.mergedCandidateKeyCount > 0
      || analysis.boundaryPartition.inequivalentGroupCount > 0
      || analysis.cegar.unsafeCount > 0;
    if (hasMerge) {
      needsReview = true;
      witnessFiles.push(captureMergeWitness(wl, analysis));
    }
  }

  const coverageMet = workloadResults.every((r) => r.coverage.ok);
  const failingCoverage = workloadResults.filter((r) => !r.coverage.ok)
    .map((r) => `${r.id}:${JSON.stringify(r.coverage)}`);
  // PR-5.5c Continuation semantic gate: every workload must exhibit >= 2
  // distinct values in at least one production-identity semantic dimension,
  // and the GLOBAL corpus (true union across all records) must cover the
  // mutation / reachability / flags / legal-action dimensions with >= 2
  // distinct values each.  inventory / visitedFloors are NOT part of the gate
  // (auto-pickup constancy is a finding, not a gate requirement).
  const everyWorkloadHasSemanticVariation = workloadResults.every((r) => hasSemanticVariation(r.semanticDiversity));
  const globalSemanticDiversity = globalSemanticDiversityOf(workloadAnalyses);
  const globalSemanticCoverage = ["mutationSummary", "reachableEndpoints", "flags", "legalActionSet"]
    .every((dim) => (globalSemanticDiversity[dim] || 0) >= 2);
  const semanticGateMet = everyWorkloadHasSemanticVariation && globalSemanticCoverage;
  // P1-3: hole-closure evidence over the FULL production-faithful corpus.
  const mergedAnalysis = { corpus: { records: [], preBoundaryRecords: [], boundaryRecords: [], postBoundaryRecords: [], postRawRecords: [], entryTransformsApplied: 0 } };
  workloadAnalyses.forEach((analysis) => {
    mergedAnalysis.corpus.records = mergedAnalysis.corpus.records.concat(analysis.corpus.records);
    mergedAnalysis.corpus.postBoundaryRecords = mergedAnalysis.corpus.postBoundaryRecords.concat(analysis.corpus.postBoundaryRecords);
    mergedAnalysis.corpus.postRawRecords = mergedAnalysis.corpus.postRawRecords.concat(analysis.corpus.postRawRecords || []);
    mergedAnalysis.corpus.entryTransformsApplied += analysis.corpus.entryTransformsApplied || 0;
  });
  const inventoryHoleClosure = inventoryHoleClosureOf(mergedAnalysis);
  const visitedFloorsHoleClosure = visitedFloorsHoleClosureOf(mergedAnalysis);
  const inventoryTransitionControlsResult = inventoryTransitionControls();
  // Fail-closed consistency: a filled claim MUST be backed by its evidence.
  if (inventoryHoleClosure.filled) {
    assert.ok(inventoryHoleClosure.distinctInventories >= 2, "inventory hole filled claim requires >=2 distinct inventories");
    assert.ok(inventoryHoleClosure.acquireExecuted && inventoryHoleClosure.consumeExecuted, "inventory hole filled claim requires acquire AND consume transition evidence");
  }
  if (visitedFloorsHoleClosure.filled) {
    assert.ok(visitedFloorsHoleClosure.maxVisitedFloorCount >= 2, "visitedFloors hole filled claim requires a state on >=2 floors");
    assert.ok(visitedFloorsHoleClosure.changeFloorExecuted, "visitedFloors hole filled claim requires a real changeFloor transition");
  }
  assert.strictEqual(inventoryTransitionControlsResult.negative1Filled, false, "transition control (negative-1): state-pair diversity must not be read as acquire/consume");
  assert.strictEqual(inventoryTransitionControlsResult.negative2Filled, false, "transition control (negative-2): key decrease without canonical mutation change must not be consume");
  assert.strictEqual(inventoryTransitionControlsResult.positiveFilled, true, "transition control (positive): real pickup->openDoor edges must fill");
  const semanticNarrownessFindings = {
    inventory: inventoryHoleClosure.filled
      ? `filled: ${inventoryHoleClosure.distinctInventories} distinct, acquire=${inventoryHoleClosure.acquireKey}, consume=${inventoryHoleClosure.consumeKey}`
      : `OPEN: no tracked single-project fixture provides real inventory acquire->consume (MT1 has none; sample floors are wall-blocked / wrong-key / search-explosive; Start seals its keys inside the door ring)`,
    visitedFloors: visitedFloorsHoleClosure.filled
      ? `filled: maxVisitedFloorCount=${visitedFloorsHoleClosure.maxVisitedFloorCount}`
      : `OPEN: no tracked single-project fixture reaches a second floor via a real transition (MT1 stairs unreachable; whiteisland data is untracked in git)`,
  };
  // Synthetic aggregation regression control: per-workload counts of 1 must
  // union to global counts > 1 (locks the global-union semantics).
  const aggregationControl = semanticAggregationControl();

  const verdict = needsReview
    ? (workloadResults.some((r) => r.cegar.unsafeCount > 0 || r.boundaryPartition.inequivalentGroupCount > 0)
      ? "UNSAFE_COLLISION_OBSERVED"
      : "REAL_COLLISION_OBSERVED")
    : "NO_COLLISION_OBSERVED";

  assert.ok(coverageMet, `coverage thresholds must be met on every workload: ${failingCoverage.join("; ")}`);
  assert.ok(semanticGateMet, `semantic diversity gate must be met (every workload >=2 in one dimension; global union of mutation/reachability/flags/legalActions >=2): ${JSON.stringify(globalSemanticDiversity)}`);
  assert.strictEqual(verdict, "NO_COLLISION_OBSERVED", "first real merge must stop with needs-review (no silent upgrade)");

  process.stdout.write(JSON.stringify({
    schema: "motapathfinder.pr-5.5b-multi-region-boundary-matrix.v1",
    status: "passed",
    controls: {
      productionBehaviorUntouched: true,
      candidateIdentityUntouched: CANDIDATE_PROFILE === "without-start-component",
      verdictPinnedNoCollision: true,
      coverageThresholdsMet: coverageMet,
      semanticGateMet,
      everyWorkloadHasSemanticVariation,
      globalSemanticCoverage,
      semanticAggregationControl: {
        globalInventoryUnion: aggregationControl.globalInventoryUnion,
        globalMutationUnion: aggregationControl.globalMutationUnion,
      },
      allCollidingDetected: controls.allColliding.detected,
      allCollidingScopedIsolation: controls.allColliding.scopedMerges > 0,
      dominanceSafeControl: controls.dominanceSafe.safe,
      boundarySemanticDriftDetected: controls.boundarySemanticDrift.detected,
      postBoundaryActionDriftDetected: controls.postBoundaryActionDrift.detected,
      rawVsLegalControl: controls.rawVsLegal.legalSetsEqual && controls.rawVsLegal.classification !== "unsafe",
      crossBoundaryKeyReuseNotAMerge: crossBoundary.scopedMerges === 0,
      crossBoundaryReusedKeys: crossBoundary.sharedKeyCount,
      sameBoundaryMergeDetected: crossBoundary.sameBoundaryMergeDetected,
      witnessArtifactExecuted: crossBoundary.witnessArtifactExecuted === true,
      witnessExplanatoryFields: crossBoundary.explanatoryFields || [],
      needsReview: false,
    },
    controlsDetail: {
      allColliding: controls.allColliding,
      rawVsLegal: controls.rawVsLegal,
      crossBoundaryReuse: crossBoundary,
    },
    coverageSummary: {
      workloads: workloadResults.length,
      preTerminalSamples: workloadResults.reduce((s, r) => s + r.layers["pre-boundary"], 0),
      boundarySamples: workloadResults.reduce((s, r) => s + r.layers["boundary-transfer"], 0),
      postBoundarySamples: workloadResults.reduce((s, r) => s + r.layers["post-boundary"], 0),
      totalMergedCandidateKeyCount: workloadResults.reduce((s, r) => s + r.statePartition.mergedCandidateKeyCount, 0),
      totalBoundaryInequivalentGroups: workloadResults.reduce((s, r) => s + r.boundaryPartition.inequivalentGroupCount, 0),
      totalUnsafe: workloadResults.reduce((s, r) => s + r.cegar.unsafeCount, 0),
    },
    globalSemanticDiversity,
    semanticNarrownessFindings,
    inventoryHoleClosure,
    visitedFloorsHoleClosure,
    inventoryTransitionControls: inventoryTransitionControlsResult,
    holeClosureSummary: {
      inventoryFilled: inventoryHoleClosure.filled,
      visitedFloorsFilled: visitedFloorsHoleClosure.filled,
    },
    workloads: workloadResults,
    verdict,
  }, null, 2) + "\n");
}

function r0SpecFor(goal) {
  // R0 must be the NORMALIZED approved spec (the approved baseline fingerprint
  // is computed on the normalized representation), with an EXPLICIT goal.
  const spec = JSON.parse(JSON.stringify(smokeSpec));
  spec.goal = JSON.parse(JSON.stringify(goal));
  const task = compileExecutableSolveTask({
    schema: "motapathfinder.solve-task.v1",
    tower: { id: TOWER_ID, projectRoot: ONLY_UP_ROOT, region: { spec } },
    objective: { mode: "max-final-hp" },
    search: searchConfig(),
    verification: { strictReplay: false },
  });
  return (task.normalizedTask || task).tower.region.spec;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  });
}

module.exports = { main };
