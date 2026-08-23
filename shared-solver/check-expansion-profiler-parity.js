"use strict";

/** TEST GRADE: local-regression */

/**
 * PR-5.22a Parity and Overhead Qualification Checker for Expansion-Cost Profiler.
 *
 * Verifies:
 * 1. Profiler OFF maintains 100% exact consistency with the 100-expansion frozen regression contract.
 * 2. Profiler ON produces 100% identical deterministic search results (expansions, generated, registered,
 *    frontierSize, stoppedReason, and exact bestProgress state key).
 * 3. Expansion cost report satisfies self-time mutual exclusivity, coverage ratio, inclusive metrics,
 *    and bounded slow-expansion sampling.
 * 4. Measures directional profiler overhead across multiple A/B iterations.
 */

const assert = require("node:assert");
const { loadProject } = require("./lib/project-loader");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { StaticSimulator } = require("./lib/simulator");
const { searchDP } = require("./lib/dp-search");
const { createNoStateChangeChoiceResolver } = require("./lib/onlyup-mt1-real-route-gate");
const { buildStateKey } = require("./lib/state-key");
const { getDecisionDepth, getRawRouteLength } = require("./lib/state");
const { createPerfTracker, setActivePerfTracker } = require("./lib/perf");

const EXPECTED_FRONTIER_SIZE = 53;
const EXPECTED_REGISTERED = 171;
const EXPECTED_GENERATED = 342;
const EXPECTED_STOPPED_REASON = null;
const EXPECTED_BEST_PROGRESS_KEY = JSON.stringify({
  floorId: "MT2",
  progressSig: "1:MT1,MT2:MT1,MT2:2",
  hero: {
    x: 5,
    y: 1,
    direction: null,
    hp: 5524,
    hpmax: 9999,
    mana: 0,
    manamax: -1,
    atk: 21,
    def: 19,
    mdef: 130,
    money: 0,
    exp: 9,
    lv: 3,
    equipment: [],
    followers: [],
  },
  inventory: {
    I600: 1,
    book: 1,
    fly: 1,
  },
  flags: {
    __leaveLoc__: {
      MT1: {
        x: 6,
        y: 0,
        direction: "up",
      },
    },
    autoBattle: 1,
    hatred: 44,
    shiqu: 1,
  },
  visitedFloors: ["MT1", "MT2"],
  mutations: [
    {
      floorId: "MT1",
      removed: [
        "0,11", "1,11", "1,2", "1,5", "10,1", "10,11", "10,3", "10,5", "10,7", "10,8",
        "11,11", "11,2", "11,5", "12,11", "2,1", "2,11", "2,3", "2,5", "2,7", "2,8",
        "3,10", "3,2", "3,4", "3,6", "3,9", "4,1", "4,11", "4,3", "4,7", "5,1",
        "5,11", "5,3", "5,6", "5,8", "7,1", "7,11", "7,3", "7,6", "7,8", "8,11",
        "8,3", "8,7", "9,10", "9,2", "9,4", "9,6", "9,9",
      ],
      replaced: [],
    },
    {
      floorId: "MT2",
      removed: ["2,3", "3,2", "4,1", "5,1", "7,1"],
      replaced: [],
    },
  ],
});

function createTestSimulator(project) {
  const choiceResolver = createNoStateChangeChoiceResolver();
  return new StaticSimulator(project, {
    stopFloorId: "MT6",
    battleResolver: new FunctionBackedBattleResolver(project),
    searchGraphMode: "primitive",
    enableFightToLevelUp: false,
    enableResourcePocket: false,
    enableResourceCluster: false,
    enableResourceChain: false,
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    choiceResolver,
  });
}

function runSearchOnce(project, options = {}) {
  const sim = createTestSimulator(project);
  let tracker = null;
  if (options.profileExpansionCost) {
    tracker = createPerfTracker({ enabled: true, profileExpansionCost: true });
    setActivePerfTracker(tracker);
  }
  const startedAt = Date.now();
  let result;
  try {
    result = searchDP(sim, sim.createInitialState(), {
      maxExpansions: 100,
      stopFloorId: "MT6",
      targetFloorId: "MT6",
    });
  } finally {
    if (options.profileExpansionCost) {
      setActivePerfTracker(null);
    }
  }
  const wallMs = Date.now() - startedAt;
  const snapshot = tracker ? tracker.snapshot({
    expanded: result.expansions,
    generated: result.diagnostics.generated,
    registered: result.diagnostics.registered,
    duplicates: result.diagnostics.skipped["dp-lower-hp-same-state"] + result.diagnostics.skipped["dp-same-hp-not-shorter"],
    frontierSize: result.frontierSize,
    simulatorCacheStats: sim.getActionExpansionCacheStats(),
  }) : null;

  return {
    result,
    sim,
    wallMs,
    snapshot,
  };
}

function median(values) {
  if (!values || values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function main() {
  const project = loadProject("Only upV2.1/Only upV2.1");

  // 1. Run single OFF and ON for strict assertion
  const runOff = runSearchOnce(project, { profileExpansionCost: false });
  const runOn = runSearchOnce(project, { profileExpansionCost: true });

  // Assert OFF matches expected contract
  assert.strictEqual(runOff.result.expansions, 100);
  assert.strictEqual(runOff.result.frontierSize, EXPECTED_FRONTIER_SIZE);
  assert.strictEqual(runOff.result.diagnostics.registered, EXPECTED_REGISTERED);
  assert.strictEqual(runOff.result.diagnostics.generated, EXPECTED_GENERATED);
  assert.strictEqual(runOff.result.stoppedReason, EXPECTED_STOPPED_REASON);
  assert.strictEqual(buildStateKey(runOff.result.bestProgressState), EXPECTED_BEST_PROGRESS_KEY);

  // Assert ON produces 100% identical deterministic outcomes
  assert.strictEqual(runOn.result.expansions, runOff.result.expansions, "Expansions must be identical");
  assert.strictEqual(runOn.result.frontierSize, runOff.result.frontierSize, "Frontier size must be identical");
  assert.strictEqual(runOn.result.diagnostics.registered, runOff.result.diagnostics.registered, "Registered count must be identical");
  assert.strictEqual(runOn.result.diagnostics.generated, runOff.result.diagnostics.generated, "Generated count must be identical");
  assert.strictEqual(runOn.result.stoppedReason, runOff.result.stoppedReason, "Stopped reason must be identical");
  assert.strictEqual(buildStateKey(runOn.result.bestProgressState), buildStateKey(runOff.result.bestProgressState), "Best progress stateKey must be identical");
  assert.deepStrictEqual(runOn.result.bestProgressState.meta, runOff.result.bestProgressState.meta, "Best progress meta must be identical");

  // 2. Validate Expansion Cost Report
  assert.ok(runOn.snapshot && runOn.snapshot.expansionCost, "expansionCost report must be present");
  const report = runOn.snapshot.expansionCost;

  // Validate deterministic section
  assert.strictEqual(report.deterministic.expansions, 100);
  assert.strictEqual(report.deterministic.registered, EXPECTED_REGISTERED);
  assert.strictEqual(report.deterministic.generated, EXPECTED_GENERATED);
  assert.strictEqual(report.deterministic.frontierSize, EXPECTED_FRONTIER_SIZE);
  assert.ok(report.deterministic.cacheHitMiss.reachabilitySkeleton.hits > 0);
  assert.ok(report.deterministic.cacheHitMiss.battleEstimate.hits > 0);

  // Validate timingDirectional section
  const timing = report.timingDirectional;
  assert.ok(typeof timing.wallMs === "number" && timing.wallMs > 0);
  assert.ok(typeof timing.expansionWallMs === "number" && timing.expansionWallMs > 0);
  assert.ok(typeof timing.attributedSelfMs === "number" && timing.attributedSelfMs > 0);
  assert.ok(timing.coverageRatio > 0.70 && timing.coverageRatio <= 1.05, `coverage ratio must be reasonable: ${timing.coverageRatio}`);

  // Top level self times
  const topLevels = timing.topLevelSelfMs;
  assert.ok(typeof topLevels.walkReachability === "number" && topLevels.walkReachability >= 0);
  assert.ok(typeof topLevels.primitiveEnumeration === "number" && topLevels.primitiveEnumeration >= 0);
  assert.ok(typeof topLevels.actionEvaluation === "number" && topLevels.actionEvaluation >= 0);
  assert.ok(typeof topLevels.applyAction === "number" && topLevels.applyAction >= 0);
  assert.ok(typeof topLevels.stabilization === "number" && topLevels.stabilization >= 0);
  assert.ok(typeof topLevels.stateKeyAndDominance === "number" && topLevels.stateKeyAndDominance >= 0);
  assert.ok(typeof topLevels.frontierQueue === "number" && topLevels.frontierQueue >= 0);
  assert.ok(typeof topLevels.otherExpansionOverhead === "number" && topLevels.otherExpansionOverhead >= 0);

  // Top level percentages sum close to 100%
  const percentages = timing.topLevelSelfPercentages;
  const pctSum = Object.values(percentages).reduce((sum, p) => sum + p, 0);
  assert.ok(Math.abs(pctSum - 100) < 1.0, `Percentages must sum to ~100%, got ${pctSum}`);

  // Inclusive subsystems
  const inclusive = timing.inclusiveSubsystems;
  assert.ok(inclusive.walkReachability.calls > 0);
  assert.ok(inclusive.enumeratePrimitiveActions.calls > 0);
  assert.ok(inclusive.applyAction.calls > 0);
  assert.ok(inclusive.stabilizeState.calls > 0);
  assert.strictEqual(inclusive.frontierQueue.pops, 100);

  // Slow expansion samples
  assert.ok(Array.isArray(timing.slowExpansionSamples));
  assert.ok(timing.slowExpansionSamples.length > 0 && timing.slowExpansionSamples.length <= 20);
  for (let i = 1; i < timing.slowExpansionSamples.length; i++) {
    assert.ok(
      timing.slowExpansionSamples[i - 1].totalSelfMs >= timing.slowExpansionSamples[i].totalSelfMs,
      "Slow expansion samples must be sorted descending by totalSelfMs",
    );
  }

  // 3. Multi-round overhead measurement
  const rounds = 5;
  const offTimes = [];
  const onTimes = [];
  for (let i = 0; i < rounds; i++) {
    offTimes.push(runSearchOnce(project, { profileExpansionCost: false }).wallMs);
    onTimes.push(runSearchOnce(project, { profileExpansionCost: true }).wallMs);
  }

  const offMedianWallMs = median(offTimes);
  const onMedianWallMs = median(onTimes);
  const overheadRatio = offMedianWallMs > 0 ? Number(((onMedianWallMs - offMedianWallMs) / offMedianWallMs).toFixed(3)) : 0;

  const output = {
    schema: "motapathfinder.expansion-profiler-parity.v1",
    status: "passed",
    verdict: "EXPANSION_PROFILER_PARITY_VERIFIED",
    deterministicParity: {
      expansions: runOn.result.expansions,
      generated: runOn.result.diagnostics.generated,
      registered: runOn.result.diagnostics.registered,
      frontierSize: runOn.result.frontierSize,
      stoppedReason: runOn.result.stoppedReason,
      exactBestProgressKeyMatched: true,
      exactMetaMatched: true,
    },
    profilerOverhead: {
      rounds,
      offMedianWallMs,
      onMedianWallMs,
      overheadRatio,
    },
    sampleAttribution: {
      expansionWallMs: timing.expansionWallMs,
      attributedSelfMs: timing.attributedSelfMs,
      coverageRatio: timing.coverageRatio,
      topLevelSelfMs: timing.topLevelSelfMs,
      topLevelSelfPercentages: timing.topLevelSelfPercentages,
      slowExpansionCount: timing.slowExpansionSamples.length,
    },
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
