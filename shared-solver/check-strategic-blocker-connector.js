"use strict";

/** TEST GRADE: integration-local */

const assert = require("node:assert");
const path = require("node:path");

const { makeBlindSimulator, readBlindGoal } = require("./lib/blind-discovery-baseline");
const { loadProject } = require("./lib/project-loader");
const {
  analyzeTerminalBlocker,
  intermediateKind,
  runBlockerDerivedConnector,
} = require("./lib/strategic-blocker");
const { verifyConnectorChain } = require("./lib/strategic-connector");
const { runStrategicD2Search } = require("./lib/strategic-d2-search");
const { createMt5EntryState, detachCheckpoint } = require("./qualify-blind-discovery");

const ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");
const GOAL_FILE = path.join(__dirname, "blind-goals", "onlyup-mt5-blueking.json");

function main() {
  const includeQualification1000 = process.argv.includes("--qualification-1000");
  const project = loadProject(PROJECT_ROOT);
  const initialState = detachCheckpoint(createMt5EntryState(project));
  const terminalGoal = readBlindGoal(GOAL_FILE).goal;
  const simulator = makeBlindSimulator(project);

  // --- Blocker analysis: named intermediate dependency -----------------------
  const blocker = analyzeTerminalBlocker(simulator, initialState, terminalGoal);
  assert.strictEqual(blocker.stage, "attack-blocked");
  assert.ok(blocker.attackMargin < 0);
  assert.strictEqual(intermediateKind(blocker.stage), "combat-power");

  // --- Synthetic control: bounded optimizer over an injected metric ----------
  function makeSyntheticSimulator() {
    const edges = {
      0: [{ kind: "a", to: 1 }],
      1: [{ kind: "b", to: 2 }],
      2: [{ kind: "c", to: 3 }],
      3: [],
    };
    return {
      enumeratePrimitiveActions(state) {
        return {
          actions: (edges[state.value] || []).map((action) => ({
            ...action,
            summary: `${action.kind}:${state.value}->${action.to}`,
          })),
        };
      },
      applyAction(_state, action) {
        return { value: action.to };
      },
      getActionFingerprint(action) {
        return `${action.kind}|${action.to}`;
      },
    };
  }
  const syntheticSimulator = makeSyntheticSimulator();
  const syntheticKeyState = (state) => String(state.value);
  const syntheticCopyState = (state) => ({ value: state.value });
  const syntheticResult = runBlockerDerivedConnector({
    simulator: syntheticSimulator,
    sourceState: { value: 0 },
    terminalGoal: { type: "bossDefeated", floorId: "X", x: 0, y: 0, enemyId: "boss" },
    metric: (state) => state.value,
    maxExpansions: 20,
    maxDepth: 5,
    keyState: syntheticKeyState,
    copyState: syntheticCopyState,
  });
  assert.strictEqual(syntheticResult.status, "improved");
  assert.strictEqual(syntheticResult.bestScore, 3);
  assert.strictEqual(syntheticResult.chain.length, 3);
  assert.strictEqual(syntheticResult.stoppedReason, "frontier-exhausted");
  assert.strictEqual(syntheticResult.frontierExhausted, true);
  const syntheticReplay = verifyConnectorChain(syntheticSimulator, { value: 0 }, syntheticResult, {
    keyState: syntheticKeyState,
    copyState: syntheticCopyState,
  });
  assert.strictEqual(syntheticReplay.valid, true);
  assert.strictEqual(syntheticReplay.postExactStateKey, "3");

  // --- Real control: intermediate combat-power step improves the blocker -----
  const realResult = runBlockerDerivedConnector({
    simulator,
    sourceState: initialState,
    terminalGoal,
    maxExpansions: 64,
    maxDepth: 8,
  });
  assert.strictEqual(realResult.targetKind, "combat-power");
  assert.strictEqual(realResult.status, "improved");
  assert.ok(realResult.beforeBlocker.attackMargin < 0);
  assert.ok(realResult.afterBlocker.attackMargin > realResult.beforeBlocker.attackMargin);
  assert.ok(realResult.blockerProgressDelta > 0);
  assert.ok(realResult.chain.length > 0);
  assert.ok(["budget-exhausted", "frontier-exhausted", "frontier-trimmed"].includes(realResult.stoppedReason));
  assert.strictEqual(typeof realResult.frontierExhausted, "boolean");
  const realReplay = verifyConnectorChain(simulator, initialState, realResult);
  assert.strictEqual(realReplay.valid, true);
  assert.strictEqual(realReplay.postExactStateKey, realResult.postExactStateKey);

  // --- Shared total-work budget edge controls ---------------------------------
  // These run through the full strategic D2 search so the shared budget is
  // exercised exactly where PR-5.18d integrated it, not just inside the local
  // connector.
  const runSharedBudgetCase = (options) => runStrategicD2Search({
    project,
    projectRoot: PROJECT_ROOT,
    initialState,
    terminalGoal,
    simulatorFactory: () => makeBlindSimulator(project),
    connectorMode: "blocker-derived",
    enableConnector: true,
    lazyDrainEvery: 1,
    ...options,
  });

  // Case 0: maxTotalSearchExpansions=0 means zero shared budget; not even the
  // first strategic expansion may start.
  const zeroCapStopsBeforeFirstExpansion = runSharedBudgetCase({
    maxExpansions: 8,
    connectorMaxExpansions: 20,
    connectorMaxCalls: 4,
    maxTotalSearchExpansions: 0,
  });
  assert.strictEqual(zeroCapStopsBeforeFirstExpansion.stats.totalSearchExpansions, 0);
  assert.strictEqual(zeroCapStopsBeforeFirstExpansion.stats.expansions, 0);
  assert.strictEqual(zeroCapStopsBeforeFirstExpansion.stats.blockerConnectorCalls, 0);
  assert.strictEqual(zeroCapStopsBeforeFirstExpansion.outcome.totalSearchBudgetExhausted, true);
  assert.strictEqual(zeroCapStopsBeforeFirstExpansion.outcome.budgetExhausted, true);
  assert.strictEqual(zeroCapStopsBeforeFirstExpansion.outcome.frontierExhausted, false);
  assert.strictEqual(zeroCapStopsBeforeFirstExpansion.outcome.searchComplete, false);
  assert.strictEqual(zeroCapStopsBeforeFirstExpansion.outcome.stoppedReason, "total-search-budget");

  // Case 1: one strategic expansion has already consumed 1 of 2 total units;
  // the connector may consume exactly the remaining 1, then no strategic
  // expansion may occur before the loop re-checks the shared cap.
  const remainingOneConnectorOnly = runSharedBudgetCase({
    maxExpansions: 8,
    connectorMaxExpansions: 20,
    connectorMaxCalls: 4,
    maxTotalSearchExpansions: 2,
  });
  assert.strictEqual(remainingOneConnectorOnly.stats.totalSearchExpansions, 2);
  assert.strictEqual(remainingOneConnectorOnly.stats.expansions, 1);
  assert.strictEqual(remainingOneConnectorOnly.stats.blockerConnectorCalls, 1);
  assert.strictEqual(remainingOneConnectorOnly.stats.blockerConnectorExpansions, 1);
  assert.strictEqual(remainingOneConnectorOnly.stats.blockerConnectorBudgetExhausted, 1);
  assert.strictEqual(remainingOneConnectorOnly.outcome.totalSearchBudgetExhausted, true);
  assert.strictEqual(remainingOneConnectorOnly.outcome.strategicBudgetExhausted, false);
  assert.strictEqual(remainingOneConnectorOnly.outcome.budgetExhausted, true);
  assert.strictEqual(remainingOneConnectorOnly.outcome.frontierExhausted, false);
  assert.strictEqual(remainingOneConnectorOnly.outcome.searchComplete, false);
  assert.strictEqual(remainingOneConnectorOnly.outcome.stoppedReason, "total-search-budget");

  // Case 2: total cap is already exhausted after one strategic expansion;
  // the queued connector must not start with a zero (or Math.max-forced 1)
  // budget.
  const remainingZeroConnectorNotStarted = runSharedBudgetCase({
    maxExpansions: 8,
    connectorMaxExpansions: 20,
    connectorMaxCalls: 4,
    maxTotalSearchExpansions: 1,
  });
  assert.strictEqual(remainingZeroConnectorNotStarted.stats.totalSearchExpansions, 1);
  assert.strictEqual(remainingZeroConnectorNotStarted.stats.expansions, 1);
  assert.strictEqual(remainingZeroConnectorNotStarted.stats.blockerConnectorCalls, 0);
  assert.strictEqual(remainingZeroConnectorNotStarted.stats.blockerConnectorExpansions, 0);
  assert.strictEqual(remainingZeroConnectorNotStarted.outcome.totalSearchBudgetExhausted, true);
  assert.strictEqual(remainingZeroConnectorNotStarted.outcome.budgetExhausted, true);
  assert.strictEqual(remainingZeroConnectorNotStarted.outcome.stoppedReason, "total-search-budget");

  // Case 3: connector asks for 20 expansions but only 3 shared units remain;
  // the effective connector budget must be clamped to 3 and total work must
  // stop exactly at the cap.
  const remainingThreeClamped = runSharedBudgetCase({
    maxExpansions: 8,
    connectorMaxExpansions: 20,
    connectorMaxCalls: 4,
    maxTotalSearchExpansions: 4,
  });
  assert.strictEqual(remainingThreeClamped.stats.totalSearchExpansions, 4);
  assert.strictEqual(remainingThreeClamped.stats.expansions, 1);
  assert.strictEqual(remainingThreeClamped.stats.blockerConnectorCalls, 1);
  assert.strictEqual(remainingThreeClamped.stats.blockerConnectorExpansions, 3);
  assert.strictEqual(remainingThreeClamped.outcome.totalSearchBudgetExhausted, true);
  assert.strictEqual(remainingThreeClamped.outcome.frontierExhausted, false);
  assert.strictEqual(remainingThreeClamped.outcome.searchComplete, false);
  assert.strictEqual(remainingThreeClamped.outcome.stoppedReason, "total-search-budget");

  const sharedBudgetEdgeControls = [
    zeroCapStopsBeforeFirstExpansion,
    remainingOneConnectorOnly,
    remainingZeroConnectorNotStarted,
    remainingThreeClamped,
  ].map((result) => ({
    totalSearchExpansions: result.stats.totalSearchExpansions,
    strategicExpansions: result.stats.expansions,
    blockerConnectorCalls: result.stats.blockerConnectorCalls,
    blockerConnectorExpansions: result.stats.blockerConnectorExpansions,
    blockerConnectorStoppedReasonCounts: {
      budgetExhausted: result.stats.blockerConnectorBudgetExhausted,
      frontierExhausted: result.stats.blockerConnectorFrontierExhausted,
      frontierTrimmed: result.stats.blockerConnectorFrontierTrimmed,
    },
    outcome: {
      totalSearchBudgetExhausted: result.outcome.totalSearchBudgetExhausted,
      strategicBudgetExhausted: result.outcome.strategicBudgetExhausted,
      budgetExhausted: result.outcome.budgetExhausted,
      frontierExhausted: result.outcome.frontierExhausted,
      searchComplete: result.outcome.searchComplete,
      stoppedReason: result.outcome.stoppedReason,
    },
  }));

  // --- Same-total-work A/B: blocker connector vs strategic-only --------------
  const run = (label, options) => {
    const result = runStrategicD2Search({
      project,
      projectRoot: PROJECT_ROOT,
      initialState,
      terminalGoal,
      simulatorFactory: () => makeBlindSimulator(project),
      ...options,
    });
    return {
      label,
      totalSearchExpansions: result.stats.totalSearchExpansions,
      strategicExpansions: result.stats.expansions,
      connectorExpansions: result.stats.connectorExpansions,
      blockerConnectorExpansions: result.stats.blockerConnectorExpansions,
      blockerConnectorCalls: result.stats.blockerConnectorCalls,
      bestAttackMargin: result.bestTerminalBlocker.attackMargin,
      bestProgressScore: result.bestTerminalBlocker.progressScore,
      goalFound: result.outcome.goalFound,
      terminalActionGenerated: result.stats.terminalActionGenerated,
      connectorResolved: result.stats.connectorResolved,
      blockerConnectorImproved: result.stats.blockerConnectorImproved,
      blockerConnectorNoImprovement: result.stats.blockerConnectorNoImprovement,
      budgetExhausted: result.outcome.budgetExhausted,
      strategicBudgetExhausted: result.outcome.strategicBudgetExhausted,
      totalSearchBudgetExhausted: result.outcome.totalSearchBudgetExhausted,
      stoppedReason: result.outcome.stoppedReason,
      wallMs: result.outcome.wallMs,
    };
  };
  const baseline = run("baseline-strategic", { maxExpansions: 200, enableConnector: false });
  const candidate = run("candidate-blocker", {
    maxExpansions: 120,
    connectorMode: "blocker-derived",
    connectorMaxExpansions: 20,
    connectorMaxCalls: 4,
  });
  assert.strictEqual(candidate.totalSearchExpansions, baseline.totalSearchExpansions);
  assert.ok(candidate.blockerConnectorImproved > 0);
  // Attack margin is negative when attack-blocked; the blocker connector must
  // not make the best terminal blocker progress worse than the strategic-only
  // baseline at the same total work. Whether it advances is recorded in the
  // round result, not asserted here (a valid NOT_PROMOTED round may match).
  assert.ok(candidate.bestAttackMargin >= baseline.bestAttackMargin);

  let qualification1000WorkAb = null;
  if (includeQualification1000) {
    const baseline1000 = run("baseline-strategic-1000", {
      maxExpansions: 1000,
      enableConnector: false,
    });
    const candidate1000 = run("candidate-blocker-1000", {
      maxExpansions: 600,
      connectorMode: "blocker-derived",
      connectorMaxExpansions: 50,
      connectorMaxCalls: 8,
      maxTotalSearchExpansions: 1000,
    });
    assert.strictEqual(baseline1000.totalSearchExpansions, 1000);
    assert.strictEqual(candidate1000.totalSearchExpansions, 1000);
    assert.strictEqual(candidate1000.strategicExpansions, 600);
    assert.strictEqual(candidate1000.blockerConnectorExpansions, 400);
    assert.strictEqual(candidate1000.blockerConnectorCalls, 8);
    assert.strictEqual(candidate1000.blockerConnectorImproved, 8);
    assert.strictEqual(candidate1000.blockerConnectorNoImprovement, 0);
    assert.strictEqual(candidate1000.bestAttackMargin, baseline1000.bestAttackMargin);
    assert.strictEqual(candidate1000.terminalActionGenerated, 0);
    assert.strictEqual(candidate1000.budgetExhausted, true);
    assert.strictEqual(candidate1000.stoppedReason, "strategic-and-total-search-budget");
    qualification1000WorkAb = { baseline: baseline1000, candidate: candidate1000 };
  }

  process.stdout.write(`${JSON.stringify({
    status: "passed",
    blockerAnalysis: {
      stage: blocker.stage,
      attackMargin: blocker.attackMargin,
      intermediateKind: intermediateKind(blocker.stage),
    },
    syntheticBlockerControl: {
      status: syntheticResult.status,
      bestScore: syntheticResult.bestScore,
      chainLength: syntheticResult.chain.length,
      replayValid: syntheticReplay.valid,
    },
    realBlockerControl: {
      status: realResult.status,
      targetKind: realResult.targetKind,
      beforeAttackMargin: realResult.beforeBlocker.attackMargin,
      afterAttackMargin: realResult.afterBlocker.attackMargin,
      blockerProgressDelta: realResult.blockerProgressDelta,
      chainLength: realResult.chain.length,
      replayValid: realReplay.valid,
      stoppedReason: realResult.stoppedReason,
    },
    sharedBudgetEdgeControls,
    sameTotalWorkAb: { baseline, candidate },
    qualification1000WorkAb,
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main };
