"use strict";

/** TEST GRADE: local-regression */

/**
 * PR-5.22e Auto-Battle Safe Fast-Reject Production Fast Path & Paired A/B Qualification Contract.
 *
 * Verifies:
 * 1. 100% exact deterministic search parity between OFF (production skip disabled)
 *    and ON (production skip enabled) across expansions, generated, registered,
 *    frontierSize, stoppedReason, bestProgress stateKey, and bestProgress meta.
 * 2. Production counter conservation in ON mode:
 *    - scanFastRejectSkipped > 0
 *    - scanBattleResolverEvaluateCalls_ON + scanFastRejectSkipped === scanBattleResolverEvaluateCalls_OFF
 *    - scanFastRejectChecks === scanFastRejectDefinitelyReject + scanFastRejectUnknown
 *    - scanBattleCandidateChecks === scanBattleRejectedBlockedSpecial + scanBattleRejectedNoResolver + scanFastRejectSkipped + scanBattleResolverEvaluateCalls
 *    - reverifyBattleResolverEvaluateCalls_ON === reverifyBattleResolverEvaluateCalls_OFF (reverify remains 100% authoritative)
 * 3. MT1 Real Route Gate under ON mode: 10/10 decisions fingerprint-matched with full strict replay parity.
 * 4. Paired A/B benchmark (5 alternating pairs) on fixed expansion workload to verify throughput improvement.
 */

const path = require("node:path");
const assert = require("node:assert");
const { loadProject } = require("./lib/project-loader");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { StaticSimulator } = require("./lib/simulator");
const { searchDP } = require("./lib/dp-search");
const { createNoStateChangeChoiceResolver, runOnlyUpMt1RealRouteGate } = require("./lib/onlyup-mt1-real-route-gate");
const { buildStateKey } = require("./lib/state-key");
const { createPerfTracker, setActivePerfTracker } = require("./lib/perf");

const PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");

function createSimulator(project, fastRejectEnabled) {
  const choiceResolver = createNoStateChangeChoiceResolver();
  return new StaticSimulator(project, {
    stopFloorId: "MT6",
    battleResolver: new FunctionBackedBattleResolver(project, { enableFastReject: true }),
    searchGraphMode: "primitive",
    enableFightToLevelUp: false,
    enableResourcePocket: false,
    enableResourceCluster: false,
    enableResourceChain: false,
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    autoBattleFastRejectEnabled: Boolean(fastRejectEnabled),
    choiceResolver,
  });
}

function runFrozen100Search(project, fastRejectEnabled) {
  const sim = createSimulator(project, fastRejectEnabled);
  const tracker = createPerfTracker({ enabled: true, profileExpansionCost: true });
  setActivePerfTracker(tracker);
  const startedAt = Date.now();
  let result;
  try {
    result = searchDP(sim, sim.createInitialState(), {
      maxExpansions: 100,
      stopFloorId: "MT6",
      targetFloorId: "MT6",
    });
  } finally {
    setActivePerfTracker(null);
  }
  const wallMs = Date.now() - startedAt;
  const snapshot = tracker.snapshot({
    expanded: result.expansions,
    generated: result.diagnostics.generated,
    registered: result.diagnostics.registered,
    duplicates: result.diagnostics.skipped["dp-lower-hp-same-state"] + result.diagnostics.skipped["dp-same-hp-not-shorter"],
    frontierSize: result.frontierSize,
    simulatorCacheStats: sim.getActionExpansionCacheStats(),
  });

  return { result, sim, wallMs, snapshot };
}

function runFixedWorkloadBenchmark(project, fastRejectEnabled, maxExpansions = 400) {
  const sim = createSimulator(project, fastRejectEnabled);
  const tracker = createPerfTracker({ enabled: true, profileExpansionCost: true });
  setActivePerfTracker(tracker);
  const startedAt = process.hrtime.bigint();
  let result;
  try {
    result = searchDP(sim, sim.createInitialState(), {
      maxExpansions,
      stopFloorId: "MT6",
      targetFloorId: "MT6",
    });
  } finally {
    setActivePerfTracker(null);
  }
  const wallMs = Number((process.hrtime.bigint() - startedAt) / 1000000n);
  const snapshot = tracker.snapshot({
    expanded: result.expansions,
    generated: result.diagnostics.generated,
    registered: result.diagnostics.registered,
    duplicates: result.diagnostics.skipped["dp-lower-hp-same-state"] + result.diagnostics.skipped["dp-same-hp-not-shorter"],
    frontierSize: result.frontierSize,
    simulatorCacheStats: sim.getActionExpansionCacheStats(),
  });

  const sub = snapshot.expansionCost.timingDirectional.inclusiveSubsystems.stabilizeState;
  const cnt = sub.counters;

  return {
    wallMs,
    expansions: result.expansions,
    msPerExpansion: result.expansions > 0 ? wallMs / result.expansions : 0,
    scanBattleResolverEvaluateCalls: cnt.scanBattleResolverEvaluateCalls,
    scanFastRejectSkipped: cnt.scanFastRejectSkipped,
    scanBattleEvaluationMs: sub.subphases.scanBattleEvaluationMs,
    stabilizationMs: sub.totalMs,
  };
}

function main() {
  const project = loadProject(PROJECT_ROOT);

  // -------------------------------------------------------------------------
  // 1. Frozen 100-expansion Deterministic Parity & Production Counter Conservation
  // -------------------------------------------------------------------------
  const runOFF = runFrozen100Search(project, false);
  const runON = runFrozen100Search(project, true);

  const resOFF = runOFF.result;
  const resON = runON.result;

  assert.strictEqual(resON.expansions, 100, "ON expansions must equal 100");
  assert.strictEqual(resON.expansions, resOFF.expansions, "Expansions parity mismatch");
  assert.strictEqual(resON.diagnostics.generated, resOFF.diagnostics.generated, "Generated count parity mismatch");
  assert.strictEqual(resON.diagnostics.registered, resOFF.diagnostics.registered, "Registered count parity mismatch");
  assert.strictEqual(resON.frontierSize, resOFF.frontierSize, "Frontier size parity mismatch");
  assert.strictEqual(resON.stoppedReason, resOFF.stoppedReason, "Stopped reason parity mismatch");

  const bestKeyOFF = buildStateKey(resOFF.bestProgressState);
  const bestKeyON = buildStateKey(resON.bestProgressState);
  assert.strictEqual(bestKeyON, bestKeyOFF, "Best progress stateKey parity mismatch");

  const metaOFF = JSON.stringify(resOFF.bestProgressState && resOFF.bestProgressState.meta);
  const metaON = JSON.stringify(resON.bestProgressState && resON.bestProgressState.meta);
  assert.strictEqual(metaON, metaOFF, "Best progress meta parity mismatch");

  const cntOFF = runOFF.snapshot.expansionCost.timingDirectional.inclusiveSubsystems.stabilizeState.counters;
  const cntON = runON.snapshot.expansionCost.timingDirectional.inclusiveSubsystems.stabilizeState.counters;

  // Counter assertions for ON
  assert.ok(cntON.scanFastRejectSkipped > 0, "scanFastRejectSkipped must be > 0 in ON mode");
  assert.strictEqual(
    cntON.scanFastRejectChecks,
    cntON.scanFastRejectDefinitelyReject + cntON.scanFastRejectUnknown,
    "scanFastRejectChecks must equal definitelyReject + unknown",
  );
  assert.strictEqual(
    cntON.scanFastRejectSkipped,
    cntON.scanFastRejectDefinitelyReject,
    "scanFastRejectSkipped must equal definitelyReject",
  );
  assert.strictEqual(
    cntON.scanBattleCandidateChecks,
    cntON.scanBattleRejectedBlockedSpecial + cntON.scanBattleRejectedNoResolver + cntON.scanFastRejectSkipped + cntON.scanBattleResolverEvaluateCalls,
    "scanBattleCandidateChecks conservation in ON mode",
  );
  assert.strictEqual(
    cntON.scanBattleResolverEvaluateCalls + cntON.scanFastRejectSkipped,
    cntOFF.scanBattleResolverEvaluateCalls,
    "Total scan evaluated + skipped in ON must strictly equal scan evaluated in OFF",
  );
  assert.strictEqual(
    cntON.reverifyBattleResolverEvaluateCalls,
    cntOFF.reverifyBattleResolverEvaluateCalls,
    "Reverify evaluate calls must be 100% identical between OFF and ON (reverify untouched)",
  );

  // -------------------------------------------------------------------------
  // 2. MT1 Real Route Gate in Production ON Mode
  // -------------------------------------------------------------------------
  const gateResult = runOnlyUpMt1RealRouteGate({ autoBattleFastRejectEnabled: true });
  assert.strictEqual(gateResult.verdict, "REAL_MT1_GATE_PASSED", "MT1 gate verdict mismatch");
  assert.strictEqual(gateResult.failureReason, null, "MT1 gate failureReason must be null");
  assert.deepStrictEqual(gateResult.mismatches, [], "MT1 gate strict replay reported mismatches");
  assert.strictEqual(gateResult.metrics.fingerprintMatchedDecisionCount, 10, "MT1 gate must match 10/10 decisions");

  // -------------------------------------------------------------------------
  // 3. Paired A/B Benchmark (5 Alternating Pairs)
  // -------------------------------------------------------------------------
  const pairs = [];
  const PAIR_COUNT = 5;
  const WORKLOAD_EXPANSIONS = 400;

  for (let i = 1; i <= PAIR_COUNT; i++) {
    let offMetrics;
    let onMetrics;
    if (i % 2 === 1) {
      // Odd pair: OFF then ON
      offMetrics = runFixedWorkloadBenchmark(project, false, WORKLOAD_EXPANSIONS);
      onMetrics = runFixedWorkloadBenchmark(project, true, WORKLOAD_EXPANSIONS);
    } else {
      // Even pair: ON then OFF
      onMetrics = runFixedWorkloadBenchmark(project, true, WORKLOAD_EXPANSIONS);
      offMetrics = runFixedWorkloadBenchmark(project, false, WORKLOAD_EXPANSIONS);
    }

    const msPerExpDelta = offMetrics.msPerExpansion - onMetrics.msPerExpansion;
    const msPerExpRatio = offMetrics.msPerExpansion > 0 ? msPerExpDelta / offMetrics.msPerExpansion : 0;
    const wallRatio = offMetrics.wallMs > 0 ? (offMetrics.wallMs - onMetrics.wallMs) / offMetrics.wallMs : 0;

    pairs.push({
      pair: i,
      order: i % 2 === 1 ? "OFF->ON" : "ON->OFF",
      off: offMetrics,
      on: onMetrics,
      speedupMsPerExpansion: msPerExpDelta,
      improvementRatio: msPerExpRatio,
      wallImprovementRatio: wallRatio,
    });
  }

  const sortedRatios = pairs.map((p) => p.improvementRatio).sort((a, b) => a - b);
  const medianImprovementRatio = sortedRatios[Math.floor(sortedRatios.length / 2)];
  const positivePairs = pairs.filter((p) => p.improvementRatio > 0).length;

  const summary = {
    schema: "motapathfinder.auto-battle-fast-reject-production.v1",
    status: "passed",
    verdict: "PRODUCTION_FAST_PATH_QUALIFIED",
    frozen100Parity: {
      expansions: resON.expansions,
      generated: resON.diagnostics.generated,
      registered: resON.diagnostics.registered,
      frontierSize: resON.frontierSize,
      stoppedReason: resON.stoppedReason,
      exactBestProgressKeyMatched: true,
      exactMetaMatched: true,
      scanEvaluatesSaved: cntON.scanFastRejectSkipped,
      scanEvaluatesBefore: cntOFF.scanBattleResolverEvaluateCalls,
      scanEvaluatesAfter: cntON.scanBattleResolverEvaluateCalls,
      evaluatesReductionRatio: Number((cntON.scanFastRejectSkipped / cntOFF.scanBattleResolverEvaluateCalls).toFixed(4)),
    },
    mt1GateVerified: {
      verdict: gateResult.verdict,
      decisionsReplayed: gateResult.recordedDecisionCount,
      strictReplayClean: gateResult.mismatches.length === 0,
    },
    pairedBenchmark: {
      pairCount: PAIR_COUNT,
      workloadExpansions: WORKLOAD_EXPANSIONS,
      positivePairs,
      medianImprovementRatio: Number(medianImprovementRatio.toFixed(4)),
      pairs,
    },
    promotionDecision: {
      criteriaMet: medianImprovementRatio >= 0.03 && positivePairs >= 4,
      verdict: (medianImprovementRatio >= 0.03 && positivePairs >= 4) ? "PROMOTE" : "REJECT",
    },
  };

  console.log(JSON.stringify(summary, null, 2));

  // Promotion criteria assertions
  assert.ok(positivePairs >= 4, `Expected at least 4 positive pairs, got ${positivePairs}`);
  assert.ok(medianImprovementRatio >= 0.03, `Expected median improvement >= 3%, got ${(medianImprovementRatio * 100).toFixed(2)}%`);
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
