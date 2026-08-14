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
  const realReplay = verifyConnectorChain(simulator, initialState, realResult);
  assert.strictEqual(realReplay.valid, true);
  assert.strictEqual(realReplay.postExactStateKey, realResult.postExactStateKey);

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
      bestAttackMargin: result.bestTerminalBlocker.attackMargin,
      bestProgressScore: result.bestTerminalBlocker.progressScore,
      goalFound: result.outcome.goalFound,
      terminalActionGenerated: result.stats.terminalActionGenerated,
      connectorResolved: result.stats.connectorResolved,
      blockerConnectorImproved: result.stats.blockerConnectorImproved,
      blockerConnectorNoImprovement: result.stats.blockerConnectorNoImprovement,
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
    },
    sameTotalWorkAb: { baseline, candidate },
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main };
