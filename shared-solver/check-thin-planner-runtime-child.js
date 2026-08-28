"use strict";

/** TEST GRADE: local-regression */

/**
 * Thin Planner Clean Runtime Child
 * Only imports thin-planner + minimal dependencies to avoid heavy checker pollution.
 * Used by check-thin-planner.js to measure clean plannerBaselineRssMb.
 *
 * Prints runtime evidence to stderr, full thin result as last stdout line.
 */

const { runThinMilestoneGraph } = require("./lib/thin-planner");

function main() {
  const raw = require("fs").readFileSync(0, "utf8");
  const config = raw ? JSON.parse(raw) : {};
  const result = runThinMilestoneGraph({
    routeName: config.routeName || "onlyup-chaos-mt1-mt4",
    maxExpansions: config.maxExpansions || 50000,
    maxRuntimeMs: config.maxRuntimeMs || 30000,
    maxRssMb: config.maxRssMb || 256,
    adaptiveBacktrackDepth: config.adaptiveBacktrackDepth || 3,
    searchIntent: config.searchIntent || "adaptive-feasible",
    budgetScope: "global-run",
    stopFloorId: config.stopFloorId || "MT6",
    projectRoot: config.projectRoot,
  });

  console.error(JSON.stringify({
    plannerBaselineRssMb: result.lifecycleTelemetry.plannerBaselineRssMb,
    maxPlannerRssAtSegmentSpawnMb: result.lifecycleTelemetry.plannerRssAtSegmentSpawnMb,
    maxConcurrentProcessTreeRssMb: result.lifecycleTelemetry.maxConcurrentProcessTreeRssMb,
    bootstrapAggregateUpperBoundMb: result.lifecycleTelemetry.bootstrapAggregateUpperBoundMb,
    overallWallMs: result.lifecycleTelemetry.overallWallMs,
    requestedRuntimeMs: result.lifecycleTelemetry.requestedRuntimeMs,
    found: result.found,
    reachedMilestone: result.reachedMilestone,
  }));

  // Full thin result as last line for parent to parse (clean measurement)
  console.log(JSON.stringify(result));
}

if (require.main === module) {
  try { main(); } catch (e) { console.error(e && e.stack ? e.stack : String(e)); process.exit(1); }
}
