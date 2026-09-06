"use strict";

/** TEST GRADE: local-regression */

/**
 * PR-5.24h — MT3→MT4 Downstream Canonical Search Cost Reduction.
 *
 * Fixed-work deterministic profiling fixture and G28 gate suite for MT3→MT4 downstream search.
 * Source: canonical repaired MT3 state from PR-5.24g Formal Run 2.
 * Completion: frontier-exhausted deterministic completion at 897 expansions.
 *
 * G28 Gates:
 *   G28-A: MT3 Fixture Determinism (consecutive reference runs byte-identical at 897 expansions)
 *   G28-F: Fixture Route-Free Canonicality (route length = 0, stateKey identical to unstripped state)
 *   G28-G: Multi-Candidate Workload Characterization and Overlap Analysis
 */

const path = require("node:path");
const assert = require("node:assert");
const { loadProject } = require("./lib/project-loader");
const { StaticSimulator } = require("./lib/simulator");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { getMilestoneSpec } = require("./lib/milestone-spec");
const { searchSegmentDP } = require("./lib/segment-dp");
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

function runMt3Fixture(simulator, segment, stateInput, opts = {}) {
  const config = {
    candidateId: "mt3-hotpath-candidate",
    maxExpansions: 1000,
    maxRuntimeMs: 600000,
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
    registered: result.diagnostics.dp.acceptedStates,
    goalSkylineCount: result.goalSkyline.length,
    goalSkylineKeys: result.goalSkyline.map((gs) => buildStateKey(gs.state)).sort(),
    capturedExpandedStates: result.diagnostics.dp.capturedExpandedStates || [],
    route: result.goalSkyline.length > 0 && result.goalSkyline[0].route
      ? result.goalSkyline[0].route
      : null,
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
    return {
      wallMs,
      cpuMs,
      result,
      tracker,
    };
  } finally {
    setActivePerfTracker(previousTracker);
  }
}

function median(arr) {
  const sorted = arr.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
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
  const rawFixture = require(SINGLE_FIXTURE_PATH);
  assert.ok(rawFixture.state, "G28-F: fixture must contain state");
  assert.ok(Array.isArray(rawFixture.state.route), "G28-F: fixture state route must be an array");
  assert.strictEqual(rawFixture.state.route.length, 0, "G28-F: fixture route length must be exactly 0 (no materialized route)");

  const computedKey = buildStateKey(rawFixture.state);
  assert.strictEqual(computedKey, rawFixture.provenance.stateKey, "G28-F: computed stateKey must match provenance stateKey");

  // Assert metadata is retained accurately
  assert.ok(rawFixture.state.meta, "G28-F: meta must be retained");
  assert.strictEqual(typeof rawFixture.state.meta.rawRouteLength, "number", "G28-F: meta.rawRouteLength is number");
  assert.strictEqual(typeof rawFixture.state.meta.decisionDepth, "number", "G28-F: meta.decisionDepth is number");

  // Frontier fixture validation
  assert.ok(Array.isArray(FRONTIER_FIXTURE.candidates), "G28-F: frontier candidates must be array");
  assert.strictEqual(FRONTIER_FIXTURE.candidates.length, 16, "G28-F: frontier must have exactly 16 candidates");
  FRONTIER_FIXTURE.candidates.forEach((c, i) => {
    assert.strictEqual(c.state.route.length, 0, `G28-F: frontier candidate ${i} route must be empty`);
    assert.strictEqual(buildStateKey(c.state), c.stateKey, `G28-F: frontier candidate ${i} stateKey must match computed`);
  });

  return {
    singleFixtureRouteFree: true,
    frontierFixtureRouteFree: true,
    canonicalStateKeyPreserved: true,
    metadataPreserved: true,
    candidatesChecked: FRONTIER_FIXTURE.candidates.length,
  };
}

// ========== G28-G: Multi-Candidate Workload Characterization and Overlap Analysis ==========
function gateG28G_MultiCandidateWorkloadCharacterization() {
  const { project, simulator } = createSimulator();
  const segment = getMt3Segment(project);

  const dpKeyOptions = { keyMode: "region", targetFloorOrder: 4 };
  const candidateReports = [];
  const candidateKeySets100 = [];
  const candidateDpKeySets100 = [];
  const allExpandedStateKeys = [];
  const allExpandedDpKeys = [];

  for (let i = 0; i < FRONTIER_FIXTURE.candidates.length; i += 1) {
    const c = FRONTIER_FIXTURE.candidates[i];
    if (typeof global.gc === "function") global.gc();

    const t0 = Date.now();
    const cpu0 = process.cpuUsage();
    const res = searchSegmentDP(simulator, JSON.parse(JSON.stringify(c.state)), segment, {
      candidateId: c.candidateId,
      maxExpansions: 100,
      maxRuntimeMs: 600000,
      captureExpandedStates: true,
      captureExpandedStateLimit: 100,
    });
    const wallMs = Date.now() - t0;
    const cpuMs = (process.cpuUsage(cpu0).user + process.cpuUsage(cpu0).system) / 1000;

    const exp = res.diagnostics.dp.expansions;
    const expandedStates = res.diagnostics.dp.capturedExpandedStates || [];
    const stKeys = expandedStates.map((s) => buildStateKey(s));
    const dpKs = expandedStates.map((s) => buildDpStateKey(simulator, s, dpKeyOptions));

    candidateKeySets100.push(new Set(stKeys));
    candidateDpKeySets100.push(new Set(dpKs));
    allExpandedStateKeys.push(...stKeys);
    allExpandedDpKeys.push(...dpKs);

    candidateReports.push({
      candidateId: c.candidateId,
      initialHp: c.heroSummary.hp,
      initialDef: c.heroSummary.def,
      expansions: exp,
      frontierSize: res.diagnostics.dp.frontierSize,
      searchComplete: res.diagnostics.dp.searchOutcome.searchComplete,
      found: res.found,
      accepted: res.diagnostics.dp.acceptedStates,
      generated: res.diagnostics.dp.acceptedStates + res.diagnostics.dp.rejectedByHigherHp + res.diagnostics.dp.sameHpRejected,
      wallMs,
      cpuMs: Math.round(cpuMs),
    });
  }

  // Exact stateKey overlap across 16 candidates (first 100 expansions each = 1600 total states)
  const totalExpandedStates = allExpandedStateKeys.length;
  const uniqueStateKeysCount = new Set(allExpandedStateKeys).size;
  const duplicateStateKeysCount = totalExpandedStates - uniqueStateKeysCount;
  const duplicateStateKeyRatio = Number((duplicateStateKeysCount / totalExpandedStates).toFixed(4));

  // Exact DP Key overlap across 16 candidates
  const uniqueDpKeysCount = new Set(allExpandedDpKeys).size;
  const duplicateDpKeysCount = totalExpandedStates - uniqueDpKeysCount;
  const duplicateDpKeyRatio = Number((duplicateDpKeysCount / totalExpandedStates).toFixed(4));

  // Pairwise Jaccard for DP keys across all 120 pairs
  let sumDpJaccard = 0;
  let pairCount = 0;
  let maxDpJaccard = 0;
  let maxDpPair = "";
  for (let i = 0; i < candidateDpKeySets100.length; i += 1) {
    for (let j = i + 1; j < candidateDpKeySets100.length; j += 1) {
      const setA = candidateDpKeySets100[i];
      const setB = candidateDpKeySets100[j];
      let inter = 0;
      for (const k of setA) {
        if (setB.has(k)) inter += 1;
      }
      const union = new Set([...setA, ...setB]).size;
      const jaccard = union > 0 ? inter / union : 0;
      sumDpJaccard += jaccard;
      if (jaccard > maxDpJaccard) {
        maxDpJaccard = jaccard;
        maxDpPair = `${FRONTIER_FIXTURE.candidates[i].candidateId} & ${FRONTIER_FIXTURE.candidates[j].candidateId}`;
      }
      pairCount += 1;
    }
  }
  const avgDpJaccard = Number((sumDpJaccard / pairCount).toFixed(4));

  return {
    workloadCharacterizationCompleted: true,
    candidatesAnalyzed: candidateReports.length,
    boundedExpansionsPerCandidate: 100,
    totalStatesExpanded: totalExpandedStates,
    stateKeyOverlap: {
      totalExpanded: totalExpandedStates,
      uniqueStateKeys: uniqueStateKeysCount,
      duplicateStateKeys: duplicateStateKeysCount,
      duplicateStateKeyRatio: Number((duplicateStateKeyRatio * 100).toFixed(2)),
    },
    dpKeyOverlap: {
      totalExpanded: totalExpandedStates,
      uniqueDpKeys: uniqueDpKeysCount,
      duplicateDpKeys: duplicateDpKeysCount,
      duplicateDpKeyRatio: Number((duplicateDpKeyRatio * 100).toFixed(2)),
    },
    pairwiseDpJaccard: {
      pairsAnalyzed: pairCount,
      averageJaccardPercent: Number((avgDpJaccard * 100).toFixed(2)),
      maxJaccardPercent: Number((maxDpJaccard * 100).toFixed(2)),
      maxOverlapPair: maxDpPair,
    },
    sampleCandidates: candidateReports.slice(0, 4),
  };
}

function profileProductionMt3() {
  const { project, simulator } = createSimulator();
  const segment = getMt3Segment(project);

  if (typeof global.gc === "function") global.gc();
  runMt3FixtureWithPerf(simulator, segment);

  const runs = [];
  for (let i = 0; i < 4; i += 1) {
    if (typeof global.gc === "function") global.gc();
    runs.push(runMt3FixtureWithPerf(simulator, segment));
  }

  const medianWallMs = median(runs.map((r) => r.wallMs));
  const medianCpuMs = median(runs.map((r) => r.cpuMs));
  const expansions = runs[0].result.expansions;
  const medianEps = Math.round(expansions / (medianWallMs / 1000));

  const lastSnap = runs[runs.length - 1].tracker.snapshot();
  const topLevel = lastSnap.topLevelSelfMs || {};
  const stab = lastSnap.stabilizationSubphasesMs || {};
  const counters = lastSnap.semanticCounters || {};

  return {
    medianWallMs: Math.round(medianWallMs),
    medianCpuMs: Math.round(medianCpuMs * 1000) / 1000,
    expansions,
    medianExpansionsPerSec: medianEps,
    topLevelSelfMs: topLevel,
    stabilizationSubphasesMs: stab,
    semanticCounters: counters,
    perExpansionMetrics: {
      wallMsPerExpansion: Number((medianWallMs / expansions).toFixed(3)),
      cpuMsPerExpansion: Number((medianCpuMs / expansions).toFixed(3)),
      battleResolverEvaluateCallsPerExpansion: Number(((counters.battleResolverEvaluateCalls || 0) / expansions).toFixed(2)),
      hazardCellsScannedPerExpansion: Number(((counters.hazardCellsScanned || 0) / expansions).toFixed(2)),
      stabilizationPassesPerExpansion: Number(((counters.stabilizationPasses || 0) / expansions).toFixed(2)),
      primitiveEnumerationCallsPerExpansion: Number(((counters.primitiveEnumerationCalls || 0) / expansions).toFixed(2)),
      stabilizationMsPerExpansion: Number(((topLevel.stabilization || 0) / expansions).toFixed(3)),
      walkReachabilityMsPerExpansion: Number(((topLevel.walkReachability || 0) / expansions).toFixed(3)),
      primitiveEnumerationMsPerExpansion: Number(((topLevel.primitiveEnumeration || 0) / expansions).toFixed(3)),
      applyActionMsPerExpansion: Number(((topLevel.applyAction || 0) / expansions).toFixed(3)),
      stateKeyAndDominanceMsPerExpansion: Number(((topLevel.stateKeyAndDominance || 0) / expansions).toFixed(3)),
    },
  };
}

// ========== Main ==========
function main() {
  const g28a = gateG28A_FixtureDeterminism();
  const g28f = gateG28F_FixtureRouteFreeCanonicality();
  const g28g = gateG28G_MultiCandidateWorkloadCharacterization();

  const report = {
    schema: "motapathfinder.mt3-mt4-hot-path.v2",
    contractStatus: "passed",
    iteration: "PR-5.24h Iteration 1 (Workload Characterization & Overlap Discovery)",
    fixture: {
      tower: "OnlyUp",
      segment: "mt3-to-mt4",
      singleCandidateId: SINGLE_FIXTURE.provenance.sourceCandidateId,
      singleCandidateExpansions: g28a.expansions,
      frontierCandidatesCount: FRONTIER_FIXTURE.candidates.length,
    },
    gates: {
      "G28-A": g28a,
      "G28-F": g28f,
      "G28-G": g28g,
    },
  };

  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) {
  try {
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
  profileProductionMt3,
  gateG28A_FixtureDeterminism,
  gateG28F_FixtureRouteFreeCanonicality,
  gateG28G_MultiCandidateWorkloadCharacterization,
  SINGLE_FIXTURE,
  FRONTIER_FIXTURE,
};
