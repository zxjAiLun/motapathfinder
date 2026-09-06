"use strict";

/** TEST GRADE: local-regression */

/**
 * PR-5.24h — MT3→MT4 Downstream Canonical Search Cost Reduction.
 *
 * Fixed-work deterministic profiling fixture and G28 gate suite for MT3→MT4 downstream search.
 * Source: canonical repaired MT3 states from PR-5.24g Formal Run 2.
 *
 * Terminology (Iteration 1 Repair 2, binding):
 *   buildStateKey        = CANONICAL_STATE_KEY (exact canonical state identity).
 *   buildDpStateKey      = PRODUCTION_DP_EQUIVALENCE_BUCKET_KEY.  The DP key
 *     deliberately EXCLUDES hero HP under the current implicit model; states in
 *     the same DP bucket compete through isBetterForSameDpKey (HP, then
 *     decision depth, then raw route length).  A shared DP bucket therefore
 *     does NOT imply an identical successor state and must never be used as a
 *     successor-cache key.
 *
 * G28 Gates:
 *   G28-A: MT3 Fixture Determinism (consecutive reference runs byte-identical;
 *          candidate-0 natural exhaustion = 897 expansions, generated = 2285)
 *   G28-F: Fixture Route-Free Canonicality (route length = 0, stateKey identical)
 *   G28-G: Multi-Candidate Workload Characterization (FIRST-100 window).
 *          Reports within-candidate duplicates and cross-candidate shared
 *          buckets SEPARATELY for both CANONICAL_STATE_KEY and
 *          PRODUCTION_DP_EQUIVALENCE_BUCKET_KEY, plus key multiplicity and
 *          shared-bucket resource-quality ranges.  The legacy
 *          (total - union) / total figure is reported only as
 *          GLOBAL_DUPLICATE_OCCURRENCE_RATIO (it mixes within + cross).
 *   G28-H: Full Candidate Completion Characterization — one fresh child
 *          process per candidate, non-binding runtime, bounded 2000
 *          expansions; captures expanded stateKey + DP bucket keys and goal
 *          records; reports full-work overlap with the same within/cross split.
 *   G28-I: Test-Only Multi-Root Shared-DP Feasibility (only when corrected
 *          CROSS_CANDIDATE_DP_BUCKET_OVERLAP_RATIO >= 20% on the G28-H
 *          full-work window).  16 canonical MT3 roots share ONE test-only
 *          bestByKey/dominance authority via the default-off dpSeedAuthority
 *          hook; per-root origin provenance is preserved; compared against the
 *          G28-H independent arm on semantic outcome, completion authority,
 *          origin correctness and expansion reduction.
 */

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const assert = require("node:assert");
const { loadProject } = require("./lib/project-loader");
const { StaticSimulator } = require("./lib/simulator");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { getMilestoneSpec } = require("./lib/milestone-spec");
const { searchSegmentDP, searchSegmentDPMultiRoot } = require("./lib/segment-dp");
const { buildDpStateKey } = require("./lib/dp-search");
const { buildStateKey } = require("./lib/state-key");
const { createPerfTracker, setActivePerfTracker, getActivePerfTracker } = require("./lib/perf");
const {
  FIRST_REGION_TARGET_FLOOR_ID,
  createNoStateChangeChoiceResolver,
} = require("./lib/onlyup-mt1-real-route-gate");

const PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const SINGLE_FIXTURE_PATH = path.resolve(__dirname, "fixtures/perf/onlyup-mt3-qualified-state.json");
const FRONTIER_FIXTURE_PATH = path.resolve(__dirname, "fixtures/perf/onlyup-mt3-qualified-frontier.json");

const SINGLE_FIXTURE = require(SINGLE_FIXTURE_PATH);
const FRONTIER_FIXTURE = require(FRONTIER_FIXTURE_PATH);

// G28-H / G28-I shared-arm bounded workload (non-binding runtime).
const G28_H_MAX_EXPANSIONS = 2000;
const G28_NON_BINDING_MAX_RUNTIME_MS = 3 * 60 * 60 * 1000;

function createSimulator(options = {}) {
  const project = loadProject(PROJECT_ROOT);
  const memoizationEnabled = options.memoizationEnabled !== false;
  const fastBattleEstimateCacheEnabled = options.fastBattleEstimateCacheEnabled !== false;

  const battleResolver = new FunctionBackedBattleResolver(project, {
    enableFastReject: true,
    enableFastBattleEstimateCache: fastBattleEstimateCacheEnabled,
  });

  const simulator = new StaticSimulator(project, {
    stopFloorId: FIRST_REGION_TARGET_FLOOR_ID,
    battleResolver,
    autoBattleFastRejectEnabled: true,
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFastHazardBlockIndex: true,
    enableHazardBlockIndexMemoization: memoizationEnabled,
    enableFastBattleEstimateCache: fastBattleEstimateCacheEnabled,
    enableCompiledEffectCache: false,
    choiceResolver: createNoStateChangeChoiceResolver(),
  });
  return { project, simulator };
}

function getMt3Segment(project) {
  const spec = getMilestoneSpec(project, "onlyup-chaos-mt1-mt4");
  return { ...spec.milestones[2], dp: { ...spec.milestones[2].dp, maxRuntimeMs: 600000 } };
}

function buildDpBucketKey(simulator, state) {
  // PRODUCTION_DP_EQUIVALENCE_BUCKET_KEY: deliberately HP-exclusive; same key
  // does not imply identical successor state (see header terminology).
  return buildDpStateKey(simulator, state, { keyMode: "region" });
}

function runMt3Fixture(simulator, segment, stateInput, opts = {}) {
  const config = {
    candidateId: "mt3-hotpath-candidate",
    maxExpansions: 1000,
    maxRuntimeMs: 600000,
    dpOverrides: { maxExpansions: 1000, maxRuntimeMs: 600000 },
    ...opts,
  };
  const inputState = stateInput || SINGLE_FIXTURE.state;
  const result = searchSegmentDP(simulator, JSON.parse(JSON.stringify(inputState)), segment, config);
  return {
    found: result.found,
    expansions: result.diagnostics.dp.expansions,
    frontierSize: result.diagnostics.dp.frontierSize,
    stoppedReason: result.diagnostics.dp.stoppedReason,
    searchOutcome: result.diagnostics.dp.searchOutcome,
    acceptedStates: result.diagnostics.dp.acceptedStates,
    rejectedByHigherHp: result.diagnostics.dp.rejectedByHigherHp,
    sameHpRejected: result.diagnostics.dp.sameHpRejected,
    generated: result.diagnostics.dp.acceptedStates + result.diagnostics.dp.rejectedByHigherHp + result.diagnostics.dp.sameHpRejected,
    goalSkylineCount: result.goalSkyline.length,
    goalSkylineKeys: result.goalSkyline.map((gs) => buildStateKey(gs.state)).sort(),
    capturedExpandedStates: result.diagnostics.dp.capturedExpandedStates || [],
    raw: result,
  };
}

function runMt3FixtureWithPerf(simulator, segment, stateInput, opts = {}) {
  const previousTracker = getActivePerfTracker();
  const tracker = createPerfTracker({
    enabled: true,
    profileExpansionCost: true,
    slowExpansionLimit: 10,
  });
  setActivePerfTracker(tracker);
  try {
    const runStart = Date.now();
    const cpuStart = process.cpuUsage();
    const result = runMt3Fixture(simulator, segment, stateInput, opts);
    const cpuEnd = process.cpuUsage(cpuStart);
    const wallMs = Date.now() - runStart;
    const cpuMs = (cpuEnd.user + cpuEnd.system) / 1000;
    return { wallMs, cpuMs, result, tracker };
  } finally {
    setActivePerfTracker(previousTracker);
  }
}

function median(arr) {
  const sorted = arr.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// ==== occurrence collection (stateKey + DP bucket key per expanded state) ====
function collectOccurrences(simulator, expandedStates) {
  return expandedStates.map((state) => ({
    stateKey: buildStateKey(state),
    dpKey: buildDpBucketKey(simulator, state),
    hp: Number(((state.hero || {}).hp) || 0),
    decisionDepth: Number((((state.meta || {}).decisionDepth)) || 0),
    rawRouteLength: Number((((state.meta || {}).rawRouteLength)) || 0),
  }));
}

// ==== corrected overlap analysis (within / cross / global split) ====
function computeOverlapAnalysis(occurrencesByCandidate, candidateIds) {
  const perCandidate = [];
  const stateKeySets = [];
  const dpKeySets = [];
  const stateKeyUnion = new Set();
  const dpKeyUnion = new Set();
  let totalOccurrences = 0;

  occurrencesByCandidate.forEach((occurrences, index) => {
    const stateKeys = new Set();
    const dpKeys = new Set();
    occurrences.forEach((occ) => {
      stateKeys.add(occ.stateKey);
      dpKeys.add(occ.dpKey);
      stateKeyUnion.add(occ.stateKey);
      dpKeyUnion.add(occ.dpKey);
    });
    totalOccurrences += occurrences.length;
    stateKeySets.push(stateKeys);
    dpKeySets.push(dpKeys);
    perCandidate.push({
      candidateId: candidateIds[index],
      totalOccurrences: occurrences.length,
      uniqueStateKeys: stateKeys.size,
      uniqueDpKeys: dpKeys.size,
      withinStateDuplicateOccurrences: occurrences.length - stateKeys.size,
      withinDpDuplicateOccurrences: occurrences.length - dpKeys.size,
    });
  });

  const sumUniqueStateKeys = stateKeySets.reduce((sum, set) => sum + set.size, 0);
  const sumUniqueDpKeys = dpKeySets.reduce((sum, set) => sum + set.size, 0);

  const crossSharedStateOccurrences = sumUniqueStateKeys - stateKeyUnion.size;
  const crossSharedDpBucketOccurrences = sumUniqueDpKeys - dpKeyUnion.size;

  // Cross-candidate key multiplicity (how many candidates contain each key).
  const stateKeyCandidates = new Map();
  const dpKeyCandidates = new Map();
  const dpKeyAttributes = new Map(); // per-bucket occurrence quality attributes (all occurrences)
  occurrencesByCandidate.forEach((occurrences, index) => {
    const candidateId = candidateIds[index];
    occurrences.forEach((occ) => {
      if (!stateKeyCandidates.has(occ.stateKey)) stateKeyCandidates.set(occ.stateKey, new Set());
      stateKeyCandidates.get(occ.stateKey).add(candidateId);
      if (!dpKeyCandidates.has(occ.dpKey)) dpKeyCandidates.set(occ.dpKey, new Set());
      dpKeyCandidates.get(occ.dpKey).add(candidateId);
      if (!dpKeyAttributes.has(occ.dpKey)) dpKeyAttributes.set(occ.dpKey, []);
      dpKeyAttributes.get(occ.dpKey).push({
        hp: occ.hp,
        decisionDepth: occ.decisionDepth,
        rawRouteLength: occ.rawRouteLength,
      });
    });
  });

  const multiplicityBuckets = (map, thresholds) => thresholds.map((t) => ({
    threshold: t,
    label: t === "all" ? "allCandidates" : `gte${t}Candidates`,
    count: Array.from(map.values()).filter((set) => (t === "all" ? set.size === candidateIds.length : set.size >= t)).length,
  }));

  const sharedDpBuckets = Array.from(dpKeyCandidates.entries())
    .filter(([, set]) => set.size >= 2)
    .map(([dpKey, set]) => {
      const attrs = dpKeyAttributes.get(dpKey) || [];
      return {
        dpKey: dpKey.length > 48 ? `${dpKey.slice(0, 45)}...` : dpKey,
        candidateMultiplicity: set.size,
        occurrenceCount: attrs.length,
        hpMin: Math.min(...attrs.map((a) => a.hp)),
        hpMax: Math.max(...attrs.map((a) => a.hp)),
        decisionDepthMin: Math.min(...attrs.map((a) => a.decisionDepth)),
        decisionDepthMax: Math.max(...attrs.map((a) => a.decisionDepth)),
        rawRouteLengthMin: Math.min(...attrs.map((a) => a.rawRouteLength)),
        rawRouteLengthMax: Math.max(...attrs.map((a) => a.rawRouteLength)),
      };
    })
    .sort((a, b) => b.candidateMultiplicity - a.candidateMultiplicity || b.occurrenceCount - a.occurrenceCount);

  return {
    windowTotalOccurrences: totalOccurrences,
    perCandidate,
    withinCandidate: {
      stateKeyDuplicateOccurrences: perCandidate.reduce((s, c) => s + c.withinStateDuplicateOccurrences, 0),
      dpBucketDuplicateOccurrences: perCandidate.reduce((s, c) => s + c.withinDpDuplicateOccurrences, 0),
    },
    canonicalStateKey: {
      sumUniquePerCandidate: sumUniqueStateKeys,
      globalUnionUnique: stateKeyUnion.size,
      crossCandidateSharedOccurrences: crossSharedStateOccurrences,
      crossCandidateOverlapRatioPercent: sumUniqueStateKeys > 0
        ? Number(((crossSharedStateOccurrences / sumUniqueStateKeys) * 100).toFixed(2))
        : 0,
      globalDuplicateOccurrenceRatioPercent: totalOccurrences > 0
        ? Number((((totalOccurrences - stateKeyUnion.size) / totalOccurrences) * 100).toFixed(2))
        : 0,
      multiplicity: multiplicityBuckets(stateKeyCandidates, [2, 4, 8, "all"]),
      maxCandidateMultiplicity: Math.max(...Array.from(stateKeyCandidates.values()).map((s) => s.size)),
    },
    dpBucketKey: {
      sumUniquePerCandidate: sumUniqueDpKeys,
      globalUnionUnique: dpKeyUnion.size,
      crossCandidateSharedBucketOccurrences: crossSharedDpBucketOccurrences,
      crossCandidateOverlapRatioPercent: sumUniqueDpKeys > 0
        ? Number(((crossSharedDpBucketOccurrences / sumUniqueDpKeys) * 100).toFixed(2))
        : 0,
      globalDuplicateOccurrenceRatioPercent: totalOccurrences > 0
        ? Number((((totalOccurrences - dpKeyUnion.size) / totalOccurrences) * 100).toFixed(2))
        : 0,
      multiplicity: multiplicityBuckets(dpKeyCandidates, [2, 4, 8, "all"]),
      maxCandidateMultiplicity: Math.max(...Array.from(dpKeyCandidates.values()).map((s) => s.size)),
      topSharedBuckets: sharedDpBuckets.slice(0, 20),
    },
  };
}

// ========== G28-A: MT3 Fixture Determinism ==========
function gateG28A_FixtureDeterminism() {
  const { project, simulator } = createSimulator();
  const segment = getMt3Segment(project);

  const observerConfig = { captureExpandedStates: true, captureExpandedStateLimit: 100 };
  const r1 = runMt3Fixture(simulator, segment, null, observerConfig);
  const r2 = runMt3Fixture(simulator, segment, null, observerConfig);

  assert.strictEqual(r1.found, r2.found, "G28-A: found match");
  assert.strictEqual(r1.expansions, 897, "G28-A: expansions must be exactly 897");
  assert.strictEqual(r2.expansions, 897, "G28-A: expansions must be exactly 897");
  assert.strictEqual(r1.frontierSize, 0, "G28-A: frontierSize must be 0 (exhausted)");
  assert.strictEqual(r2.frontierSize, 0, "G28-A: frontierSize must be 0 (exhausted)");
  assert.strictEqual(r1.stoppedReason, null, "G28-A: stoppedReason must be null");
  assert.strictEqual(r1.acceptedStates, r2.acceptedStates, "G28-A: acceptedStates match");
  assert.strictEqual(r1.generated, r2.generated, "G28-A: generated match (2285)");
  assert.strictEqual(r1.generated, 2285, "G28-A: authoritative generated is exactly 2285");
  assert.deepStrictEqual(r1.goalSkylineKeys, r2.goalSkylineKeys, "G28-A: goalSkylineKeys match");

  const order1 = r1.capturedExpandedStates.map((s) => buildStateKey(s));
  const order2 = r2.capturedExpandedStates.map((s) => buildStateKey(s));
  assert.strictEqual(order1.length, 100);
  assert.deepStrictEqual(order1, order2, "G28-A: first 100 expansion keys match");

  assert.deepStrictEqual(
    r1.raw.diagnostics.dp.searchOutcome,
    r2.raw.diagnostics.dp.searchOutcome,
    "G28-A: searchOutcome match",
  );

  return {
    fixtureDeterminismVerified: true,
    candidateId: SINGLE_FIXTURE.provenance.sourceCandidateId,
    expansions: r1.expansions,
    frontierSize: r1.frontierSize,
    acceptedStates: r1.acceptedStates,
    generated: r1.generated,
    first100ExpansionKeysMatched: true,
    searchComplete: r1.searchOutcome.searchComplete,
  };
}

// ========== G28-F: Fixture Route-Free Canonicality ==========
function gateG28F_FixtureRouteFreeCanonicality() {
  delete require.cache[require.resolve(SINGLE_FIXTURE_PATH)];
  const rawFixture = require(SINGLE_FIXTURE_PATH);
  assert.ok(rawFixture.state, "G28-F: fixture must contain state");
  assert.ok(Array.isArray(rawFixture.state.route), "G28-F: fixture state route must be an array");
  assert.strictEqual(rawFixture.state.route.length, 0, "G28-F: fixture route length must be exactly 0 (no materialized route)");

  const computedKey = buildStateKey(rawFixture.state);
  assert.strictEqual(computedKey, rawFixture.provenance.stateKey, "G28-F: computed stateKey must match provenance stateKey");

  assert.ok(rawFixture.state.meta, "G28-F: meta must be retained");
  assert.strictEqual(typeof rawFixture.state.meta.rawRouteLength, "number", "G28-F: meta.rawRouteLength is number");
  assert.strictEqual(typeof rawFixture.state.meta.decisionDepth, "number", "G28-F: meta.decisionDepth is number");

  const frontierRaw = require(FRONTIER_FIXTURE_PATH);
  assert.ok(Array.isArray(frontierRaw.candidates), "G28-F: frontier candidates must be array");
  assert.strictEqual(frontierRaw.candidates.length, 16, "G28-F: frontier must have exactly 16 candidates");
  frontierRaw.candidates.forEach((c, i) => {
    assert.strictEqual(c.state.route.length, 0, `G28-F: frontier candidate ${i} route must be empty`);
    assert.strictEqual(buildStateKey(c.state), c.stateKey, `G28-F: frontier candidate ${i} stateKey must match computed`);
  });

  return {
    singleFixtureRouteFree: true,
    frontierFixtureRouteFree: true,
    canonicalStateKeyPreserved: true,
    metadataPreserved: true,
    candidatesChecked: frontierRaw.candidates.length,
  };
}

// ========== G28-G: Multi-Candidate Workload Characterization (FIRST-100 window) ==========
function gateG28G_MultiCandidateWorkloadCharacterization() {
  const { project, simulator } = createSimulator();
  const segment = getMt3Segment(project);

  const candidateIds = FRONTIER_FIXTURE.candidates.map((c) => c.candidateId);
  const occurrencesByCandidate = [];
  const candidateSummaries = [];

  for (let i = 0; i < FRONTIER_FIXTURE.candidates.length; i += 1) {
    const c = FRONTIER_FIXTURE.candidates[i];
    if (typeof global.gc === "function") global.gc();

    const res = searchSegmentDP(simulator, JSON.parse(JSON.stringify(c.state)), segment, {
      candidateId: c.candidateId,
      dpOverrides: { maxExpansions: 100, maxRuntimeMs: 600000 },
      captureExpandedStates: true,
      captureExpandedStateLimit: 100,
    });

    const occurrences = collectOccurrences(simulator, res.diagnostics.dp.capturedExpandedStates || []);
    occurrencesByCandidate.push(occurrences);
    candidateSummaries.push({
      candidateId: c.candidateId,
      initialHp: c.heroSummary.hp,
      initialDef: c.heroSummary.def,
      expansions: res.diagnostics.dp.expansions,
      capturedOccurrences: occurrences.length,
    });
  }

  const analysis = computeOverlapAnalysis(occurrencesByCandidate, candidateIds);

  return {
    workloadCharacterizationCompleted: true,
    window: "FIRST_100_EXPANSIONS_PER_CANDIDATE",
    fullCompletionMeasuredByThisGate: false,
    candidatesAnalyzed: candidateIds.length,
    totalStatesExpanded: analysis.windowTotalOccurrences,
    withinCandidateDuplicates: analysis.withinCandidate,
    canonicalStateKeyOverlap: analysis.canonicalStateKey,
    dpBucketKeyOverlap: analysis.dpBucketKey,
    perCandidate: analysis.perCandidate,
    sampleCandidates: candidateSummaries.slice(0, 4),
  };
}

// ==== shared child-worker helpers (G28-H / G28-I) ====
function runWorker(args, timeoutSec) {
  const result = spawnSync(
    process.execPath,
    ["--expose-gc", "--max-old-space-size=2048", __filename, ...args],
    { cwd: __dirname, timeout: (timeoutSec || 1800) * 1000, encoding: "utf8" },
  );
  return result;
}

function writeWorkerOutput(outPath, payload) {
  fs.writeFileSync(outPath, JSON.stringify(payload));
}

function readWorkerOutput(outPath) {
  const raw = fs.readFileSync(outPath, "utf8");
  try { fs.unlinkSync(outPath); } catch (_) { /* best effort */ }
  return JSON.parse(raw);
}

function makeTempPath(name) {
  return path.join(os.tmpdir(), `g28-${name}-${process.pid}-${Date.now()}.json`);
}

// G28-H worker: one candidate, full bounded completion, keys-only capture.
function g28hWorker(candidateIndex, outPath) {
  const candidate = FRONTIER_FIXTURE.candidates[candidateIndex];
  const { project, simulator } = createSimulator();
  const segment = getMt3Segment(project);
  if (typeof global.gc === "function") global.gc();

  let peakRssMb = 0;
  const sampler = setInterval(() => {
    const rssMb = process.memoryUsage().rss / (1024 * 1024);
    if (rssMb > peakRssMb) peakRssMb = rssMb;
  }, 250);

  const t0 = Date.now();
  const res = searchSegmentDP(simulator, JSON.parse(JSON.stringify(candidate.state)), segment, {
    candidateId: candidate.candidateId,
    dpOverrides: { maxExpansions: G28_H_MAX_EXPANSIONS, maxRuntimeMs: G28_NON_BINDING_MAX_RUNTIME_MS },
    captureExpandedStates: true,
    captureExpandedStateLimit: G28_H_MAX_EXPANSIONS,
  });
  const wallMs = Date.now() - t0;
  clearInterval(sampler);
  peakRssMb = Math.max(peakRssMb, process.memoryUsage().rss / (1024 * 1024));

  const occurrences = collectOccurrences(simulator, res.diagnostics.dp.capturedExpandedStates || []);
  const goalRecords = (res.goalSkyline || []).map((gs) => ({
    stateKey: buildStateKey(gs.state),
    hp: Number(((gs.state.hero || {}).hp) || 0),
    atk: Number(((gs.state.hero || {}).atk) || 0),
    def: Number(((gs.state.hero || {}).def) || 0),
    mdef: Number(((gs.state.hero || {}).mdef) || 0),
    lv: Number(((gs.state.hero || {}).lv) || 0),
    exp: Number(((gs.state.hero || {}).exp) || 0),
    flags: gs.state.flags || {},
    decisionDepth: Number((((gs.state.meta || {}).decisionDepth)) || 0),
    rawRouteLength: Number((((gs.state.meta || {}).rawRouteLength)) || 0),
    routeLength: Array.isArray(gs.state.route) ? gs.state.route.length : 0,
  }));

  writeWorkerOutput(outPath, {
    candidateId: candidate.candidateId,
    initialHp: candidate.heroSummary.hp,
    initialDef: candidate.heroSummary.def,
    expansions: res.diagnostics.dp.expansions,
    frontierSize: res.diagnostics.dp.frontierSize,
    searchComplete: res.diagnostics.dp.searchOutcome.searchComplete,
    stoppedReason: res.diagnostics.dp.stoppedReason,
    found: res.found,
    accepted: res.diagnostics.dp.acceptedStates,
    generated: res.diagnostics.dp.acceptedStates + res.diagnostics.dp.rejectedByHigherHp + res.diagnostics.dp.sameHpRejected,
    wallMs,
    peakRssMb: Math.round(peakRssMb * 10) / 10,
    occurrences,
    goalRecords,
  });
}

// G28-I shared-arm worker: ONE live multi-root shared-DP segment search over
// all 16 roots (root-ordered agenda; per-root provenance preserved).
function g28iSharedArmWorker(outPath) {
  const { project, simulator } = createSimulator();
  const segment = getMt3Segment(project);
  if (typeof global.gc === "function") global.gc();

  let peakRssMb = 0;
  const sampler = setInterval(() => {
    const rssMb = process.memoryUsage().rss / (1024 * 1024);
    if (rssMb > peakRssMb) peakRssMb = rssMb;
  }, 250);

  const startCandidates = FRONTIER_FIXTURE.candidates.map((c, i) => ({
    state: JSON.parse(JSON.stringify(c.state)),
    id: c.candidateId,
  }));
  const t0 = Date.now();
  const res = searchSegmentDPMultiRoot(simulator, startCandidates, segment, {
    candidateId: "g28i-shared-arm",
    dpOverrides: { maxExpansions: G28_H_MAX_EXPANSIONS * FRONTIER_FIXTURE.candidates.length, maxRuntimeMs: G28_NON_BINDING_MAX_RUNTIME_MS },
  });
  const wallMs = Date.now() - t0;
  clearInterval(sampler);
  peakRssMb = Math.max(peakRssMb, process.memoryUsage().rss / (1024 * 1024));

  const dp = res.diagnostics.dp;
  writeWorkerOutput(outPath, {
    architecture: "one-live-multi-root-shared-dp-search",
    expansions: dp.expansions,
    frontierSize: dp.frontierSize,
    searchComplete: dp.searchOutcome.searchComplete,
    stoppedReason: dp.stoppedReason,
    found: res.found,
    accepted: dp.acceptedStates,
    generated: dp.acceptedStates + dp.rejectedByHigherHp + dp.sameHpRejected,
    wallMs,
    peakRssMb: Math.round(peakRssMb * 10) / 10,
    pendingByRoot: dp.pendingByRoot || {},
    expansionCountByRoot: dp.expansionCountByRoot || {},
    rootCount: dp.rootCount,
    goalRootCandidateIds: (res.goalSkyline || []).map((g) => g.rootCandidateId || null),
    goalCount: (res.goalSkyline || []).length,
  });
}

// Best-goal comparator (mirrors production compareGoalStates terminal ordering).
// Used by check-multi-root-shared-dp.js (G29-B/F) and retained for parity with
// the production terminal hook.
function effectiveHeroValueOf(stateLike, field) {
  const flags = stateLike.flags || {};
  const buff = Number(flags[`__${field}_buff__`] || 1);
  return Math.floor(Number(stateLike[field] || 0) * buff);
}

function compareGoalRecords(left, right) {
  if (!right) return 1;
  if (!left) return -1;
  const hpDiff = left.hp - right.hp;
  if (hpDiff !== 0) return hpDiff;
  for (const field of ["atk", "def", "mdef"]) {
    const diff = effectiveHeroValueOf(left, field) - effectiveHeroValueOf(right, field);
    if (diff !== 0) return diff;
  }
  for (const field of ["lv", "exp", "atk", "def", "mdef"]) {
    const diff = Number(left[field] || 0) - Number(right[field] || 0);
    if (diff !== 0) return diff;
  }
  return right.rawRouteLength - left.rawRouteLength;
}

// ========== Main ==========
function main() {
  const g28a = gateG28A_FixtureDeterminism();
  const g28f = gateG28F_FixtureRouteFreeCanonicality();
  const g28g = gateG28G_MultiCandidateWorkloadCharacterization();

  // ---- G28-H: full candidate completion characterization (child per candidate) ----
  const g28hWorkers = [];
  for (let i = 0; i < FRONTIER_FIXTURE.candidates.length; i += 1) {
    const outPath = makeTempPath(`g28h-${i}`);
    const result = runWorker(["--g28h-worker", String(i), outPath], 1800);
    if (result.status !== 0) {
      throw new Error(`G28-H worker ${i} failed (status ${result.status}):\n${result.stderr}`);
    }
    g28hWorkers.push(readWorkerOutput(outPath));
  }

  const g28hOccurrences = g28hWorkers.map((w) => w.occurrences);
  const candidateIds = g28hWorkers.map((w) => w.candidateId);
  const g28hOverlap = computeOverlapAnalysis(g28hOccurrences, candidateIds);
  const g28h = {
    fullCandidateCompletionCharacterizationCompleted: true,
    workerArchitecture: "one-fresh-child-process-per-candidate",
    maxExpansions: G28_H_MAX_EXPANSIONS,
    maxRuntimeMs: G28_NON_BINDING_MAX_RUNTIME_MS,
    candidates: g28hWorkers.map((w) => ({
      candidateId: w.candidateId,
      initialHp: w.initialHp,
      initialDef: w.initialDef,
      expansions: w.expansions,
      frontierSize: w.frontierSize,
      searchComplete: w.searchComplete,
      stoppedReason: w.stoppedReason,
      found: w.found,
      accepted: w.accepted,
      generated: w.generated,
      wallMs: w.wallMs,
      peakRssMb: w.peakRssMb,
      goalCount: w.goalRecords.length,
    })),
    allCandidatesSearchComplete: g28hWorkers.every((w) => w.searchComplete === true),
    anyGoalFound: g28hWorkers.some((w) => w.found === true),
    fullWorkOverlap: {
      window: "FULL_BOUNDED_WORKLOAD",
      withinCandidateDuplicates: g28hOverlap.withinCandidate,
      canonicalStateKeyOverlap: g28hOverlap.canonicalStateKey,
      dpBucketKeyOverlap: g28hOverlap.dpBucketKey,
    },
  };

  // ---- G28-I: test-only multi-root shared-DP feasibility (conditional) ----
  const correctedCrossDpOverlap = g28hOverlap.dpBucketKey.crossCandidateOverlapRatioPercent;
  const correctedCrossStateOverlap = g28hOverlap.canonicalStateKey.crossCandidateOverlapRatioPercent;
  let g28i;
  if (correctedCrossDpOverlap < 20) {
    g28i = {
      executed: false,
      gate: "CROSS_CANDIDATE_DP_BUCKET_OVERLAP_RATIO >= 20%",
      correctedCrossDpBucketOverlapPercent: correctedCrossDpOverlap,
      status: "SKIPPED_LOW_OVERLAP",
    };
  } else {
    const outPath = makeTempPath("g28i-shared-arm");
    const result = runWorker(["--g28i-worker", outPath], 3600);
    if (result.status !== 0) {
      throw new Error(`G28-I shared-arm worker failed (status ${result.status}):\n${result.stderr}`);
    }
    const shared = readWorkerOutput(outPath);

    const independentGoalRecords = g28hWorkers.flatMap((w) => w.goalRecords.map((g) => ({ ...g, originCandidateId: w.candidateId })));
    const sharedGoalRecords = (shared.goalRootCandidateIds || []).map((rootId, index) => ({ originCandidateId: rootId, index }));
    const goalMultisetOf = (records) => records.reduce((map, g) => {
      map.set(g.stateKey, (map.get(g.stateKey) || 0) + 1);
      return map;
    }, new Map());
    const independentGoalMultiset = goalMultisetOf(independentGoalRecords);
    const sharedAllComplete = shared.searchComplete === true;
    const sharedAnyGoal = shared.goalCount > 0;

    // Completion authority parity: if all independent searches complete and
    // no goal, the shared arm must also complete and find no goal.
    const completionAuthorityParity = g28h.allCandidatesSearchComplete && !g28h.anyGoalFound
      ? (sharedAllComplete && !sharedAnyGoal)
      : null; // goal-bearing scenario: judged via goal multiset + origins

    const totalIndependentExpansions = g28hWorkers.reduce((s, w) => s + w.expansions, 0);
    const expansionReductionRatioPercent = totalIndependentExpansions > 0
      ? Number((((totalIndependentExpansions - shared.expansions) / totalIndependentExpansions) * 100).toFixed(2))
      : 0;

    g28i = {
      executed: true,
      gate: "CROSS_CANDIDATE_DP_BUCKET_OVERLAP_RATIO >= 20%",
      correctedCrossDpBucketOverlapPercent: correctedCrossDpOverlap,
      correctedCrossStateKeyOverlapPercent: correctedCrossStateOverlap,
      status: "EXECUTED_VIA_PRODUCTION_MULTI_ROOT_API",
      sharedArm: {
        architecture: shared.architecture,
        expansions: shared.expansions,
        frontierSize: shared.frontierSize,
        searchComplete: shared.searchComplete,
        found: shared.found,
        accepted: shared.accepted,
        generated: shared.generated,
        wallMs: shared.wallMs,
        peakRssMb: shared.peakRssMb,
        pendingByRoot: shared.pendingByRoot,
        expansionCountByRoot: shared.expansionCountByRoot,
        rootCount: shared.rootCount,
        goalCount: shared.goalCount,
        goalRootCandidateIds: shared.goalRootCandidateIds,
      },
      signals: {
        INDEPENDENT_TOTAL_EXPANSIONS: totalIndependentExpansions,
        SHARED_MULTI_ROOT_EXPANSIONS: shared.expansions,
        EXPANSION_REDUCTION_RATIO_PERCENT: expansionReductionRatioPercent,
        INDEPENDENT_WALL_MS_TOTAL: g28hWorkers.reduce((s, w) => s + w.wallMs, 0),
        SHARED_WALL_MS: shared.wallMs,
        INDEPENDENT_WALL_OBSERVATIONAL_ONLY: true,
      },
      semanticParity: {
        independentFound: g28h.anyGoalFound,
        sharedFound: sharedAnyGoal,
        goalCountIndependent: independentGoalRecords.length,
        goalCountShared: shared.goalCount,
        goalMultisetMatched: independentGoalRecords.length === shared.goalCount
          ? (independentGoalRecords.length === 0 ? true : null)
          : false,
        completionAuthorityParity,
        originProvenanceVerified: sharedGoalRecords.every((g) =>
          Boolean(g.originCandidateId)
          && FRONTIER_FIXTURE.candidates.some((c) => c.candidateId === g.originCandidateId)),
      },
      testOnly: true,
    };
  }

  const report = {
    schema: "motapathfinder.mt3-mt4-hot-path.v3",
    contractStatus: "passed",
    iteration: "PR-5.24h Iteration 1 Repair 2 (Corrected Cross-Root Overlap + Multi-Root Shared-DP Feasibility)",
    terminology: {
      buildStateKey: "CANONICAL_STATE_KEY",
      buildDpStateKey: "PRODUCTION_DP_EQUIVALENCE_BUCKET_KEY",
      note: "DP key excludes HP under the current implicit model; same DP key does not imply identical successor state and must never back a successor cache.",
    },
    fixture: {
      tower: "OnlyUp",
      segment: "mt3-to-mt4",
      singleCandidateId: SINGLE_FIXTURE.provenance.sourceCandidateId,
      singleCandidateNaturalExhaustionExpansions: g28a.expansions,
      frontierCandidatesCount: FRONTIER_FIXTURE.candidates.length,
    },
    gates: {
      "G28-A": g28a,
      "G28-F": g28f,
      "G28-G": g28g,
      "G28-H": g28h,
      "G28-I": g28i,
    },
  };

  console.log(JSON.stringify(report, null, 2));
}

// ==== worker entrypoints ====
function workerMain(args) {
  if (args[0] === "--g28h-worker") {
    g28hWorker(Number(args[1]), args[2]);
    return true;
  }
  if (args[0] === "--g28i-worker") {
    g28iSharedArmWorker(args[1]);
    return true;
  }
  return false;
}

if (require.main === module) {
  try {
    if (workerMain(process.argv.slice(2))) {
      process.exit(0);
    }
    main();
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  }
}

module.exports = {
  createSimulator,
  getMt3Segment,
  runMt3Fixture,
  runMt3FixtureWithPerf,
  gateG28A_FixtureDeterminism,
  gateG28F_FixtureRouteFreeCanonicality,
  gateG28G_MultiCandidateWorkloadCharacterization,
  buildDpBucketKey,
  collectOccurrences,
  computeOverlapAnalysis,
  compareGoalRecords,
  G28_H_MAX_EXPANSIONS,
  G28_NON_BINDING_MAX_RUNTIME_MS,
  SINGLE_FIXTURE,
  FRONTIER_FIXTURE,
};
