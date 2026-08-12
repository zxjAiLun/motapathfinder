"use strict";

/**
 * TEST GRADE: research qualification harness
 *
 * Replays tracked long-route fixtures into trusted simulator checkpoints, then
 * starts a fresh branching milestone search from each checkpoint.  Side A is
 * the production region key.  Side B injects the existing
 * without-start-component candidate through searchDP's research hook.
 *
 * This file MUST NOT expand resolveDpKeyProfile promotion scope.  MT2-MT5
 * candidate runs are research-only and their result can be parity, divergence,
 * or incomplete-within-budget.  A miss is never evidence that no route exists.
 */

const assert = require("node:assert");
const path = require("node:path");

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const {
  EXPERIMENTAL_PROFILE,
  PRODUCTION_PROFILE,
  resolveDpKeyProfile,
} = require("./lib/guarded-candidate-key");
const { buildCandidateDpKey } = require("./lib/key-dependency-corpus");
const { getMilestoneSpec } = require("./lib/milestone-spec");
const { createPerfTracker, setActivePerfTracker } = require("./lib/perf");
const { loadProject } = require("./lib/project-loader");
const { buildReplayRouteFingerprint } = require("./lib/replay-resume-artifact");
const { buildRouteRecord, readRouteFile } = require("./lib/route-store");
const { runMilestoneGraph } = require("./lib/segment-dp");
const { StaticSimulator } = require("./lib/simulator");
const { exactStateFingerprint } = require("./lib/solver-job");
const { compileTowerIR } = require("./lib/tower-ir");

const ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");
const ROUTE_NAME = "onlyup-chaos-mt5-blueking";
const RESEARCH_PROFILE = "without-start-component";

const FIXTURES = Object.freeze({
  mt2Hp3834: {
    file: path.join(__dirname, "routes", "fixtures", "mt1-mt2-hp3834.route.json"),
    decisionDepth: 23,
    routeLength: 77,
  },
  mt3I893Hp8425: {
    file: path.join(__dirname, "routes", "fixtures", "mt1-mt3-i893-hp8425.route.json"),
    decisionDepth: 33,
    routeLength: 111,
  },
  mt4ManualHp4459: {
    file: path.join(__dirname, "routes", "fixtures", "mt1-mt4-hp4459-atk421-def318-mdef5012.route.json"),
    decisionDepth: 54,
    routeLength: 159,
  },
  mt4BestHp6428: {
    file: path.join(__dirname, "routes", "fixtures", "mt1-mt4-hp6428-best.route.json"),
    decisionDepth: 55,
    routeLength: 133,
  },
});

const CASES = Object.freeze({
  "mt2-to-mt3-i893": {
    tier: "medium",
    defaultMaxExpansions: 600,
    fixture: "mt2Hp3834",
    fromMilestoneId: "mt2-hp3834",
    toMilestoneId: "mt3-i893-hp8425",
    floors: ["MT2", "MT3"],
    description: "MT2 hp3834 checkpoint -> MT3 I893/hp8425 milestone",
  },
  "mt3-to-mt5-blueking": {
    tier: "long",
    defaultMaxExpansions: 500,
    fixture: "mt3I893Hp8425",
    fromMilestoneId: "mt3-i893-hp8425",
    toMilestoneId: "mt5-blueking-kill",
    floors: ["MT3", "MT4", "MT5"],
    description: "MT3 I893 checkpoint -> MT5 blueKing full milestone chain",
  },
  "mt4-manual-to-mt5-entry": {
    tier: "medium",
    defaultMaxExpansions: 100,
    fixture: "mt4ManualHp4459",
    fromMilestoneId: "mt4-hp4459",
    toMilestoneId: "mt5-early-gem-entry",
    floors: ["MT3", "MT4", "MT5"],
    description: "manual MT4 key-state checkpoint -> meaningful MT5 entry target",
  },
  "mt4-best-to-mt5-entry": {
    tier: "medium",
    defaultMaxExpansions: 100,
    fixture: "mt4BestHp6428",
    fromMilestoneId: "mt4-hp4459",
    toMilestoneId: "mt5-early-gem-entry",
    floors: ["MT3", "MT4", "MT5"],
    description: "best MT4 checkpoint -> meaningful MT5 entry target",
  },
});

function parseArgs(argv) {
  const result = {};
  argv.forEach((arg) => {
    if (arg === "--contract-only") result.contractOnly = true;
    else {
      const match = /^--([^=]+)=(.*)$/.exec(arg);
      if (match) result[match[1]] = match[2];
    }
  });
  return result;
}

function optionalNumber(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`expected a finite number, got ${value}`);
  return parsed;
}

function optionEnabled(value) {
  return value == null || value !== "0";
}

function makeSimulator(project, options) {
  const config = options || {};
  return new StaticSimulator(project, {
    stopFloorId: "MT11",
    battleResolver: new FunctionBackedBattleResolver(project),
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFightToLevelUp: false,
    enableResourcePocket: false,
    enableResourceCluster: false,
    enableResourceChain: false,
    searchGraphMode: "primitive",
    walkReachabilityMode: config.walkReachabilityMode,
    enableReachabilitySkeletonCache: config.enableReachabilitySkeletonCache,
    enableTopologyFirstMaterialization: config.enableTopologyFirstMaterialization,
    enableBattleEvaluationProjection: config.enableBattleEvaluationProjection,
  });
}

function findAction(simulator, state, summary) {
  return (simulator.enumeratePrimitiveActions(state).actions || []).find((action) => action.summary === summary)
    || simulator.enumerateActions(state).find((action) => action.summary === summary)
    || null;
}

function replayFixture(simulator, fixtureFile) {
  let state = simulator.createInitialState({ rank: "chaos" });
  for (const decision of readRouteFile(fixtureFile).decisions || []) {
    const action = findAction(simulator, state, decision.summary);
    assert.ok(action, `fixture replay missing action ${decision.summary}`);
    state = simulator.applyAction(state, action);
  }
  return state;
}

function regionSpecFor(caseId, benchmarkCase) {
  return {
    id: `research-real-route-${caseId}`,
    scope: { floors: benchmarkCase.floors.slice() },
    start: { type: "checkpoint-fixture" },
    goal: { type: "milestone", id: benchmarkCase.toMilestoneId },
    actionPolicy: { mode: "milestone-spec-authoritative" },
  };
}

function createResearchCandidateBuilder(project, simulator, caseId, benchmarkCase) {
  const regionSpec = regionSpecFor(caseId, benchmarkCase);
  const ir = compileTowerIR(project, regionSpec, { towerId: `real-route-${caseId}` });
  const allowedFloors = new Set(benchmarkCase.floors);
  return {
    ir,
    builder(state) {
      if (!state || !allowedFloors.has(state.floorId)) {
        throw new Error(
          `research candidate key: floor ${state && state.floorId} outside case scope ${benchmarkCase.floors.join(",")}`,
        );
      }
      return buildCandidateDpKey(simulator, project, ir, state, {
        profile: RESEARCH_PROFILE,
      });
    },
  };
}

function cacheDelta(after, before) {
  return Object.keys(after || {}).reduce((result, key) => {
    result[key] = Number(after[key] || 0) - Number((before || {})[key] || 0);
    return result;
  }, {});
}

function sumByKind(dpRecords, field) {
  return dpRecords.reduce((total, dp) => total + Object.values(dp[field] || {})
    .reduce((sum, value) => sum + Number(value || 0), 0), 0);
}

function summarizeScale(result) {
  const dpRecords = (result.evaluationAttemptLedger || [])
    .map((entry) => entry && entry.diagnostics && entry.diagnostics.dp)
    .filter(Boolean);
  return {
    attempts: dpRecords.length,
    expanded: dpRecords.reduce((sum, dp) => sum + Number(dp.expansions || 0), 0),
    generated: sumByKind(dpRecords, "actionsGeneratedByKind"),
    acceptedStates: dpRecords.reduce((sum, dp) => sum + Number(dp.acceptedStates || 0), 0),
    dominanceRejected: dpRecords.reduce((sum, dp) => (
      sum + Number(dp.rejectedByHigherHp || 0) + Number(dp.sameHpRejected || 0)
    ), 0),
    maxFinalActiveStates: dpRecords.reduce((max, dp) => Math.max(
      max,
      Number(dp.registry && dp.registry.finalActiveStates || 0),
    ), 0),
    maxFrontierRemaining: dpRecords.reduce((max, dp) => Math.max(max, Number(dp.frontierSize || 0)), 0),
    firstGoalExpansion: dpRecords.reduce((best, dp) => {
      if (dp.firstGoalExpansion == null) return best;
      const value = Number(dp.firstGoalExpansion);
      return Number.isFinite(value) && value >= 0 && (best == null || value < best) ? value : best;
    }, null),
    goalFeasibilityPruned: dpRecords.reduce((sum, dp) => (
      sum + Number(dp.goalFeasibility && dp.goalFeasibility.pruned || 0)
    ), 0),
    goalProjectionCache: {
      hits: dpRecords.reduce((sum, dp) => sum + Number(dp.goalProjectionCache && dp.goalProjectionCache.hits || 0), 0),
      misses: dpRecords.reduce((sum, dp) => sum + Number(dp.goalProjectionCache && dp.goalProjectionCache.misses || 0), 0),
      requirementHits: dpRecords.reduce((sum, dp) => sum + Number(dp.goalProjectionCache && dp.goalProjectionCache.requirementHits || 0), 0),
      requirementMisses: dpRecords.reduce((sum, dp) => sum + Number(dp.goalProjectionCache && dp.goalProjectionCache.requirementMisses || 0), 0),
    },
    priorityModes: Array.from(new Set(dpRecords.map((dp) => dp.priorityMode || "default"))).sort(),
    stoppedReasons: Array.from(new Set(dpRecords.map((dp) => dp.stoppedReason || null))).sort(),
  };
}

function summarizeFirstGoalElapsedMs(result) {
  return (result.evaluationAttemptLedger || [])
    .map((entry) => entry && entry.diagnostics && entry.diagnostics.dp)
    .filter(Boolean)
    .reduce((best, dp) => {
      if (dp.firstGoalElapsedMs == null) return best;
      const value = Number(dp.firstGoalElapsedMs);
      return Number.isFinite(value) && value >= 0 && (best == null || value < best)
        ? value
        : best;
    }, null);
}

function compactHero(state) {
  const hero = state && state.hero || {};
  return {
    floorId: state && state.floorId || null,
    hp: Number(hero.hp || 0),
    atk: Number(hero.atk || 0),
    def: Number(hero.def || 0),
    mdef: Number(hero.mdef || 0),
    lv: Number(hero.lv || 0),
    exp: Number(hero.exp || 0),
    equipment: Array.isArray(hero.equipment) ? hero.equipment.slice() : [],
  };
}

function buildStrictReplayEvidence(project, simulator, initialState, result, benchmarkCase, side) {
  if (!result.found || !result.finalCandidate || !result.finalCandidate.state) {
    return {
      verified: false,
      status: "not-available-not-found",
      routeFingerprint: null,
      decisionCount: 0,
    };
  }
  const finalState = result.finalCandidate.state;
  const prefixLength = Array.isArray(initialState.route) ? initialState.route.length : 0;
  const fullRoute = Array.isArray(result.finalCandidate.route) ? result.finalCandidate.route : [];
  finalState.route = fullRoute.slice(prefixLength);
  const routeRecord = buildRouteRecord({
    project,
    simulator,
    initialState,
    finalState,
    options: {
      projectRoot: PROJECT_ROOT,
      solver: "real-route-performance-qualification",
      // Keep route identity independent of benchmark side.  A/B belongs in
      // research metadata, not the replay fingerprint's source.profile.
      profile: "real-route-research-qualification",
      rank: "chaos",
      toFloor: finalState.floorId,
      goalType: "milestone-research-qualification",
      snapshotFloors: benchmarkCase.floors,
      metadata: {
        researchOnly: true,
        productionPromotionChanged: false,
        candidateProfile: side === "B" ? RESEARCH_PROFILE : PRODUCTION_PROFILE,
      },
    },
  });
  const fingerprint = buildReplayRouteFingerprint(routeRecord);
  return {
    verified: true,
    status: "offline-strict-recorded-decision-replay-verified",
    routeFingerprint: fingerprint.hash || JSON.stringify(fingerprint),
    decisionCount: (routeRecord.decisions || []).length,
    decisionSummaries: (routeRecord.decisions || []).map((decision) => decision.summary),
  };
}

function runBenchmarkSide(project, milestoneSpec, caseId, benchmarkCase, side, args) {
  const simulator = makeSimulator(project, {
    walkReachabilityMode: args["walk-mode"],
    enableReachabilitySkeletonCache: optionEnabled(args["reachability-skeleton-cache"]),
    enableTopologyFirstMaterialization: optionEnabled(args["topology-first-materialization"]),
    enableBattleEvaluationProjection: optionEnabled(args["battle-evaluation-projection"]),
  });
  const fixture = FIXTURES[benchmarkCase.fixture];
  const initialState = replayFixture(simulator, fixture.file);
  const initialCheckpoint = {
    exactStateFingerprint: exactStateFingerprint(initialState),
    hero: compactHero(initialState),
    fixtureDecisionDepth: (readRouteFile(fixture.file).decisions || []).length,
    fixtureRouteLength: Number((readRouteFile(fixture.file).stats || {}).routeLength || 0),
  };
  const cacheBefore = simulator.getReachabilityCacheStats();
  const skeletonCacheBefore = simulator.getActionExpansionCacheStats().reachabilitySkeleton;
  const candidate = side === "B"
    ? createResearchCandidateBuilder(project, simulator, caseId, benchmarkCase)
    : null;
  const tracker = createPerfTracker({ enabled: true });
  const searchOptions = {
    fromMilestoneId: benchmarkCase.fromMilestoneId,
    toMilestoneId: benchmarkCase.toMilestoneId,
    candidateLimit: optionalNumber(args["candidate-limit"]) || 4,
    // Qualification must be expansion-deterministic.  Wall time is unlimited
    // unless the caller explicitly asks for a probe timeout.
    maxRuntimeMs: optionalNumber(args["max-runtime-ms"]) == null
      ? 0
      : optionalNumber(args["max-runtime-ms"]),
    dpStateKeyBuilder: candidate && candidate.builder,
    searchIntent: args["search-intent"],
    dpPriorityMode: args["priority-mode"],
    goalFeasibilityMode: args["goal-feasibility-mode"],
    adaptiveBacktrackDepth: optionalNumber(args["adaptive-backtrack-depth"]),
  };
  const requestedMaxExpansions = optionalNumber(args["max-expansions"]);
  searchOptions.maxExpansions = requestedMaxExpansions == null
    ? benchmarkCase.defaultMaxExpansions
    : requestedMaxExpansions;
  if (args["stop-on-first-goal"] != null) {
    searchOptions.stopOnFirstGoal = args["stop-on-first-goal"] === "1";
  }

  setActivePerfTracker(tracker);
  let result;
  try {
    result = runMilestoneGraph(simulator, initialState, milestoneSpec, searchOptions);
  } finally {
    setActivePerfTracker(null);
  }
  const perf = tracker.snapshot();
  const finalState = result.finalCandidate && result.finalCandidate.state;
  const strictReplay = buildStrictReplayEvidence(
    project,
    simulator,
    initialState,
    result,
    benchmarkCase,
    side,
  );
  return {
    side,
    keyMode: side === "A" ? "production-region" : `${RESEARCH_PROFILE}-research-injection`,
    found: Boolean(result.found),
    reachedMilestone: result.reachedMilestone || null,
    failedSegmentId: result.failedSegment && result.failedSegment.segmentId || null,
    searchIntent: result.searchIntent || "skyline",
    backtrack: result.failedSegment && result.failedSegment.backtrack || null,
    initialCheckpoint,
    finalExactStateFingerprint: finalState ? exactStateFingerprint(finalState) : null,
    finalHero: finalState ? compactHero(finalState) : null,
    strictReplay,
    scale: summarizeScale(result),
    performance: {
      wallMs: perf.wallMs,
      firstGoalElapsedMs: summarizeFirstGoalElapsedMs(result),
      walkReachabilityMode: simulator.walkReachabilityMode,
      reachabilitySkeletonCacheEnabled: simulator.enableReachabilitySkeletonCache,
      topologyFirstMaterializationEnabled: simulator.enableTopologyFirstMaterialization,
      battleEvaluationProjectionEnabled: simulator.enableBattleEvaluationProjection,
      peakRssMb: perf.peakRssMb,
      peakHeapUsedMb: perf.peakHeapUsedMb,
      reachabilityComputations: Number(perf.phaseCounts && perf.phaseCounts.reachability || 0),
      reachabilityTotalMs: Number(perf.phaseMs && perf.phaseMs.reachability || 0),
      enumerateMs: Number(perf.phaseMs && perf.phaseMs.enumerateActions || 0),
      applyMs: Number(perf.phaseMs && perf.phaseMs.applyAction || 0),
      keyBuildMs: Number(perf.phaseMs && perf.phaseMs.buildDpStateKey || 0),
      phaseMs: { ...(perf.phaseMs || {}) },
      phaseSelfMs: { ...(perf.phaseSelfMs || {}) },
      phaseCounts: { ...(perf.phaseCounts || {}) },
      reachabilityCache: cacheDelta(simulator.getReachabilityCacheStats(), cacheBefore),
      reachabilitySkeletonCache: cacheDelta(
        simulator.getActionExpansionCacheStats().reachabilitySkeleton,
        skeletonCacheBefore,
      ),
    },
  };
}

function compareRuns(runs) {
  const runA = runs.find((run) => run.side === "A") || null;
  const runB = runs.find((run) => run.side === "B") || null;
  if (!runA || !runB) return { verdict: "SINGLE_SIDE_OBSERVATION" };
  if (!runA.found || !runB.found) {
    return {
      verdict: "INCOMPLETE_WITHIN_BUDGET",
      bothFound: false,
      strictReplayVerifiedBoth: false,
    };
  }
  const exactFinalState = runA.finalExactStateFingerprint === runB.finalExactStateFingerprint;
  const exactRoute = runA.strictReplay.routeFingerprint === runB.strictReplay.routeFingerprint;
  const strictReplayVerifiedBoth = runA.strictReplay.verified && runB.strictReplay.verified;
  const scaleExact = JSON.stringify(runA.scale) === JSON.stringify(runB.scale);
  return {
    verdict: exactFinalState && exactRoute && strictReplayVerifiedBoth && scaleExact
      ? "RESEARCH_PARITY_OBSERVED"
      : "RESEARCH_DIVERGENCE_REVIEW_REQUIRED",
    bothFound: true,
    exactFinalState,
    exactRoute,
    scaleExact,
    strictReplayVerifiedBoth,
    wallFactorBOverA: runA.performance.wallMs > 0
      ? Number((runB.performance.wallMs / runA.performance.wallMs).toFixed(3))
      : null,
    reachabilityComputationFactorBOverA: runA.performance.reachabilityComputations > 0
      ? Number((runB.performance.reachabilityComputations / runA.performance.reachabilityComputations).toFixed(3))
      : null,
  };
}

function checkContract(project) {
  const fixtures = Object.fromEntries(Object.entries(FIXTURES).map(([id, fixture]) => {
    const record = readRouteFile(fixture.file);
    assert.strictEqual(record.schema, "motapathfinder.route.v1", `${id} schema`);
    assert.strictEqual((record.decisions || []).length, fixture.decisionDepth, `${id} decision depth`);
    assert.strictEqual(Number((record.stats || {}).routeLength), fixture.routeLength, `${id} route length`);
    return [id, {
      file: path.relative(__dirname, fixture.file),
      decisionDepth: fixture.decisionDepth,
      routeLength: fixture.routeLength,
    }];
  }));

  const scopes = {};
  Object.entries(CASES).forEach(([caseId, benchmarkCase]) => {
    const simulator = makeSimulator(project);
    const regionSpec = regionSpecFor(caseId, benchmarkCase);
    const fallback = resolveDpKeyProfile({
      project,
      simulator,
      regionSpec,
      dpKeyProfile: null,
      options: { towerId: `real-route-${caseId}` },
    });
    assert.strictEqual(fallback.effectiveProfile, PRODUCTION_PROFILE, `${caseId} implicit profile must stay production`);
    assert.strictEqual(fallback.selectionReason, "scope-unapproved-fallback", `${caseId} fallback reason`);
    assert.throws(
      () => resolveDpKeyProfile({
        project,
        simulator,
        regionSpec,
        dpKeyProfile: EXPERIMENTAL_PROFILE,
        options: { towerId: `real-route-${caseId}` },
      }),
      /approved baseline mismatch/,
      `${caseId} explicit MT1 experimental profile must fail closed outside its approved scope`,
    );
    const research = createResearchCandidateBuilder(project, simulator, caseId, benchmarkCase);
    assert.ok(research.builder, `${caseId} research builder must exist`);
    scopes[caseId] = {
      tier: benchmarkCase.tier,
      floors: benchmarkCase.floors,
      fixture: benchmarkCase.fixture,
      fromMilestoneId: benchmarkCase.fromMilestoneId,
      toMilestoneId: benchmarkCase.toMilestoneId,
      defaultMaxExpansions: benchmarkCase.defaultMaxExpansions,
      implicitProfile: fallback.effectiveProfile,
      explicitMt1ExperimentalRejected: true,
      researchInjectionAvailable: true,
    };
  });
  return { fixtures, scopes };
}

function selectedCaseIds(args) {
  const requested = args.case || "mt2-to-mt3-i893";
  if (requested === "medium") {
    return Object.keys(CASES).filter((id) => CASES[id].tier === "medium");
  }
  const ids = requested.split(",").filter(Boolean);
  ids.forEach((id) => {
    if (!CASES[id]) throw new Error(`unknown real-route benchmark case: ${id}`);
  });
  return ids;
}

function selectedSides(args) {
  const sides = String(args.order || "A/B").split("/").filter(Boolean);
  sides.forEach((side) => {
    if (side !== "A" && side !== "B") throw new Error(`unknown benchmark side: ${side}`);
  });
  return sides;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const project = loadProject(PROJECT_ROOT);
  const contract = checkContract(project);
  if (args.contractOnly) {
    process.stdout.write(`${JSON.stringify({
      schema: "motapathfinder.real-route-performance-qualification.v1",
      status: "passed",
      mode: "contract-only",
      controls: {
        allTrackedFixturesPresent: true,
        fixtureMetadataPinned: true,
        productionProfileScopeUnchanged: true,
        mt2ToMt5CandidateResearchOnly: true,
      },
      contract,
    }, null, 2)}\n`);
    return;
  }

  const caseIds = selectedCaseIds(args);
  const sides = selectedSides(args);
  const longCases = caseIds.filter((id) => CASES[id].tier === "long");
  if (longCases.length > 0 && args["allow-long"] !== "1") {
    throw new Error(`long benchmark requires --allow-long=1: ${longCases.join(",")}`);
  }
  const milestoneSpec = getMilestoneSpec(project, ROUTE_NAME);
  const results = caseIds.map((caseId) => {
    const benchmarkCase = CASES[caseId];
    const runs = sides.map((side) => runBenchmarkSide(
      project,
      milestoneSpec,
      caseId,
      benchmarkCase,
      side,
      args,
    ));
    const comparison = compareRuns(runs);
    if (args["require-parity"] === "1") {
      assert.strictEqual(
        comparison.verdict,
        "RESEARCH_PARITY_OBSERVED",
        `${caseId} must find strict-replay exact A/B parity`,
      );
    }
    return {
      id: caseId,
      tier: benchmarkCase.tier,
      description: benchmarkCase.description,
      fixture: benchmarkCase.fixture,
      floors: benchmarkCase.floors,
      fromMilestoneId: benchmarkCase.fromMilestoneId,
      toMilestoneId: benchmarkCase.toMilestoneId,
      runs,
      comparison,
    };
  });
  process.stdout.write(`${JSON.stringify({
    schema: "motapathfinder.real-route-performance-qualification.v1",
    status: "passed",
    mode: "research-benchmark",
    controls: {
      productionBehaviorUntouched: true,
      candidateIdentityUntouched: true,
      productionProfileScopeUnchanged: true,
      candidateRunsResearchOnly: true,
      routeFixtureUsedOnlyAsCheckpoint: true,
      branchingSearchExecutedAfterCheckpoint: true,
      missIsNotImpossibilityProof: true,
      serialProcessMemoryRequiresSeparateSideRunsForComparison: true,
    },
    contract,
    order: sides.join("/"),
    results,
    promotionVerdict: "NO_PRODUCTION_PROMOTION_REQUESTED",
  }, null, 2)}\n`);
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
  CASES,
  FIXTURES,
  checkContract,
  main,
};
