"use strict";

/** TEST GRADE: integration-local */

/**
 * PR-5.22a First-Region Direct Gate with Expansion Profiler.
 *
 * Runs the first-region real-route gate under standard budget with opt-in expansion profiling
 * and validates that gate diagnostics, resource limits, and attribution breakdown are coherent.
 */

const assert = require("node:assert");
const { profileFirstRegionSearch } = require("./check-expansion-cost-attribution");

function main() {
  const result = profileFirstRegionSearch();
  assert.ok(result.searchResult, "Search result must exist");
  assert.ok(result.report, "Attribution report must exist");

  const report = result.report;
  const timing = report.timingDirectional;

  assert.ok(timing.expansionWallMs > 0);
  assert.ok(timing.attributedSelfMs > 0);
  assert.ok(timing.coverageRatio >= 0.70 && timing.coverageRatio <= 1.05);

  const output = {
    schema: "motapathfinder.onlyup-first-region-expansion-profile.v1",
    status: "passed",
    verdict: "FIRST_REGION_EXPANSION_PROFILED",
    expansions: result.searchResult.expansions,
    wallMs: result.wallMs,
    peakRssMb: result.peakRssMb,
    coverageRatio: timing.coverageRatio,
    topLevelSelfPercentages: timing.topLevelSelfPercentages,
    perExpansionAverages: timing.perExpansionAverages,
    slowExpansionSampleCount: timing.slowExpansionSamples.length,
  };

  console.log(JSON.stringify(output, null, 2));
  return output;
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
};
