"use strict";

/** TEST GRADE: integration-local */

/**
 * PR-5.22a First-Region Expansion Cost Attribution Checker.
 *
 * Runs the real OnlyUp first-region search (MT1 -> MT6) under canonical budget
 * (50000 expansions, 30000ms wall, 256MB RSS) with opt-in expansion-cost profiling.
 *
 * Objectives:
 * 1. Measure mutually exclusive self-times across 8 top-level expansion phases.
 * 2. Measure inclusive subsystem activity (calls, cache hits/misses, rebases, key builds, etc.).
 * 3. Identify and attribute primary and secondary CPU/Wall hotspots.
 * 4. Sample top-20 slow expansions without heavy memory overhead.
 * 5. Strictly enforce OPTIMIZATION_AUTHORIZED = false (measurement-only milestone).
 */

const assert = require("node:assert");
const { loadProject } = require("./lib/project-loader");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { StaticSimulator } = require("./lib/simulator");
const { searchDP } = require("./lib/dp-search");
const {
  FIRST_REGION_TARGET_FLOOR_ID,
  MAX_EXPANDED_STATES,
  RSS_LIMIT_BYTES,
  WALL_LIMIT_MS,
  createNoStateChangeChoiceResolver,
  touchesDifficulty,
} = require("./lib/onlyup-mt1-real-route-gate");
const { createPerfTracker, setActivePerfTracker } = require("./lib/perf");

function profileFirstRegionSearch(options = {}) {
  const projectRoot = options.projectRoot || "Only upV2.1/Only upV2.1";
  const project = loadProject(projectRoot);
  const choiceResolver = createNoStateChangeChoiceResolver();
  const simulator = new StaticSimulator(project, {
    stopFloorId: FIRST_REGION_TARGET_FLOOR_ID,
    battleResolver: new FunctionBackedBattleResolver(project, { enableFastReject: true }),
    searchGraphMode: "primitive",
    enableFightToLevelUp: false,
    enableResourcePocket: false,
    enableResourceCluster: false,
    enableResourceChain: false,
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    choiceResolver,
  });

  const tracker = createPerfTracker({
    enabled: true,
    profileExpansionCost: true,
    slowExpansionLimit: 20,
  });
  setActivePerfTracker(tracker);

  const maxExpandedStates = Number(options.maxExpansions || MAX_EXPANDED_STATES);
  const wallLimitMs = Number(options.wallLimitMs || WALL_LIMIT_MS);
  const startedAt = process.hrtime.bigint();
  let peakRssBytes = process.memoryUsage().rss;
  const sampleRss = () => {
    const rss = process.memoryUsage().rss;
    if (rss > peakRssBytes) peakRssBytes = rss;
    return rss;
  };
  const elapsedMs = () => Number((process.hrtime.bigint() - startedAt) / 1000000n);

  let difficultyGuardBlocked = 0;
  const initialState = simulator.createInitialState();

  let searchResult;
  try {
    searchResult = searchDP(simulator, initialState, {
      maxExpansions: maxExpandedStates,
      maxRuntimeMs: wallLimitMs,
      stopOnFirstGoal: true,
      goalPredicate: (state) => state.floorId === FIRST_REGION_TARGET_FLOOR_ID,
      targetFloorId: FIRST_REGION_TARGET_FLOOR_ID,
      actionFilter: (action) => {
        if (touchesDifficulty(action)) {
          difficultyGuardBlocked += 1;
          return false;
        }
        return true;
      },
      shouldStop: () => {
        sampleRss();
        return peakRssBytes >= RSS_LIMIT_BYTES || elapsedMs() >= wallLimitMs;
      },
    });
  } finally {
    setActivePerfTracker(null);
  }
  sampleRss();

  const wallMs = elapsedMs();
  const simStats = simulator.getActionExpansionCacheStats();

  const report = tracker.getExpansionCostReport({
    expanded: searchResult.expansions,
    generated: searchResult.diagnostics.generated,
    registered: searchResult.diagnostics.registered,
    duplicates: searchResult.diagnostics.skipped["dp-lower-hp-same-state"] +
                searchResult.diagnostics.skipped["dp-same-hp-not-shorter"],
    frontierSize: searchResult.frontierSize,
    actionCounts: searchResult.diagnostics.actionsExpandedByKind || {},
    simulatorCacheStats: simStats,
    bestProgress: searchResult.bestProgressState ? {
      floorId: searchResult.bestProgressState.floorId,
      hp: searchResult.bestProgressState.hero.hp,
      decisionDepth: searchResult.bestProgressState.meta ? searchResult.bestProgressState.meta.decisionDepth : null,
    } : null,
  });

  return {
    searchResult,
    wallMs,
    peakRssMb: Math.round((peakRssBytes / 1048576) * 10) / 10,
    difficultyGuardBlocked,
    report,
  };
}

function rankHotspots(topLevelSelfMs) {
  return Object.entries(topLevelSelfMs)
    .filter(([phase]) => phase !== "otherExpansionOverhead")
    .sort((a, b) => b[1] - a[1]);
}

function main() {
  const { searchResult, wallMs, peakRssMb, difficultyGuardBlocked, report } = profileFirstRegionSearch();

  // Assertion checks
  assert.ok(searchResult.expansions > 0, "Expansions must be > 0");
  assert.ok(report && report.deterministic && report.timingDirectional, "Report must be valid");

  const ranked = rankHotspots(report.timingDirectional.topLevelSelfMs);
  const primaryHotspot = ranked[0] ? ranked[0][0] : "unknown";
  const primaryHotspotMs = ranked[0] ? ranked[0][1] : 0;
  const primaryHotspotPct = report.timingDirectional.topLevelSelfPercentages[primaryHotspot] || 0;

  const secondaryHotspot = ranked[1] ? ranked[1][0] : "unknown";
  const secondaryHotspotMs = ranked[1] ? ranked[1][1] : 0;
  const secondaryHotspotPct = report.timingDirectional.topLevelSelfPercentages[secondaryHotspot] || 0;

  const output = {
    schema: "motapathfinder.expansion-cost-attribution.v1",
    status: "passed",
    verdict: "EXPANSION_COST_ATTRIBUTED",
    attributionVerdict: {
      primaryHotspot,
      primaryHotspotSelfMs: primaryHotspotMs,
      primaryHotspotPercentage: primaryHotspotPct,
      secondaryHotspot,
      secondaryHotspotSelfMs: secondaryHotspotMs,
      secondaryHotspotPercentage: secondaryHotspotPct,
      optimizationAuthorized: false,
    },
    gateOutcome: {
      foundGoal: searchResult.foundGoal,
      stoppedReason: searchResult.stoppedReason,
      expansions: searchResult.expansions,
      frontierSize: searchResult.frontierSize,
      wallMs,
      peakRssMb,
      bindingConstraint: peakRssBytesOverLimit(peakRssMb) ? "rss" : (wallMs >= 30000 ? "wall" : "expansions"),
      difficultyGuardBlocked,
    },
    deterministicCounters: report.deterministic,
    timingDirectional: report.timingDirectional,
  };

  console.log(JSON.stringify(output, null, 2));
  return output;
}

function peakRssBytesOverLimit(peakRssMb) {
  return peakRssMb >= 256;
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
  main,
  profileFirstRegionSearch,
};
