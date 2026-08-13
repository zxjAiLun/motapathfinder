"use strict";

/** TEST GRADE: integration-local */

const assert = require("node:assert");
const path = require("node:path");

const { makeBlindSimulator, readBlindGoal } = require("./lib/blind-discovery-baseline");
const { loadProject } = require("./lib/project-loader");
const { cloneState, removeTileAt } = require("./lib/state");
const {
  enumerateStrategicActions,
  runStrategicD2Search,
} = require("./lib/strategic-d2-search");
const {
  buildStrategicOptionMap,
  diffStrategicOptionMaps,
} = require("./lib/strategic-option-map");
const { createMt5EntryState, detachCheckpoint } = require("./qualify-blind-discovery");

const ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");
const GOAL_FILE = path.join(__dirname, "blind-goals", "onlyup-mt5-blueking.json");

function main() {
  const project = loadProject(PROJECT_ROOT);
  const initialState = detachCheckpoint(createMt5EntryState(project));
  const floorIds = ["MT4", "MT5"];
  const initialOptions = buildStrategicOptionMap(project, initialState, { floorIds });
  assert.strictEqual(initialOptions.floors.MT4.grid[3][7], "item:I621");
  assert.strictEqual(initialOptions.floors.MT4.grid[3][8], "enemy:skeletonKing");
  const removedState = cloneState(initialState);
  removeTileAt(removedState, "MT4", 7, 3);
  const removedOptions = buildStrategicOptionMap(project, removedState, { floorIds });
  assert.strictEqual(removedOptions.floors.MT4.grid[3][7], null);
  assert.notStrictEqual(removedOptions.fingerprint, initialOptions.fingerprint);
  assert.deepStrictEqual(
    diffStrategicOptionMaps(initialOptions, removedOptions).consumed.map((entry) => entry.key),
    ["MT4:7,3"],
  );

  const simulator = makeBlindSimulator(project);
  const rootActions = enumerateStrategicActions(simulator, initialState, {
    compareLegacyFilter: true,
  });
  assert.ok(rootActions.actions.length > 0);
  assert.strictEqual(rootActions.actions.some((action) => action.kind === "floorFly"), false);
  const withFloorFly = enumerateStrategicActions(simulator, initialState, {
    includeFloorFly: true,
  });
  assert.ok(withFloorFly.actions.some((action) => action.kind === "floorFly"));

  const terminalGoal = readBlindGoal(GOAL_FILE).goal;
  const localClosure = runStrategicD2Search({
    project,
    projectRoot: PROJECT_ROOT,
    initialState,
    terminalGoal: {
      type: "bossDefeated",
      floorId: "MT5",
      x: 8,
      y: 11,
      enemyId: "skeletonKing",
    },
    simulatorFactory: () => makeBlindSimulator(project),
    maxExpansions: 4,
  });
  assert.strictEqual(localClosure.outcome.goalFound, true);
  assert.strictEqual(localClosure.outcome.firstGoalExpansion, 1);
  assert.ok(localClosure.replay && localClosure.replay.valid);
  assert.strictEqual(localClosure.verdict, "D2_STRATEGIC_SEARCH_STRICT_REPLAY_VERIFIED");
  const result = runStrategicD2Search({
    project,
    projectRoot: PROJECT_ROOT,
    initialState,
    terminalGoal,
    simulatorFactory: () => makeBlindSimulator(project),
    maxExpansions: 64,
  });
  assert.strictEqual(result.inputContract.knownRouteUsed, false);
  assert.deepStrictEqual(result.controls.pruning, ["exact-state-merge-only"]);
  assert.strictEqual(result.controls.supplementalActionKinds.floorFly, "deferred-from-minimal-D2-vertical-slice");
  assert.strictEqual(result.outcome.goalFound, false);
  assert.strictEqual(result.outcome.budgetExhausted, true);
  assert.strictEqual(result.outcome.searchComplete, false);
  assert.strictEqual(result.stats.expansions, 64);
  assert.ok(result.stats.generated > result.stats.expansions);
  assert.ok(result.stats.exactMerged > 0);
  assert.ok(result.stats.optionMapsObserved > 1);
  assert.ok(result.stats.optionChangingTransitions > 0);
  assert.ok(result.stats.implicitOptionConsumptions > 0);
  assert.ok(result.stats.maxStrategicDepth > 0);
  assert.strictEqual(result.stats.generatedByKind.floorFly, undefined);
  assert.deepStrictEqual(
    Object.keys(result.stats.expandedByQueue).sort(),
    result.controls.agendaQueues.slice().sort(),
  );
  assert.ok(result.frontierWitnesses.every((witness) => witness && witness.optionMapFingerprint));
  assert.ok(result.stats.implicitOptionConsumptionSamples.some((sample) =>
    sample.consumed.some((entry) => entry.key === "MT4:7,3" && entry.tileId === "I621")));

  process.stdout.write(`${JSON.stringify({
    status: "passed",
    inputContract: result.inputContract,
    optionMap: {
      representation: result.controls.optionMap,
      initialFingerprint: initialOptions.fingerprint,
      initialCounts: initialOptions.counts,
      removedI621Fingerprint: removedOptions.fingerprint,
    },
    actionBoundary: {
      primitiveVariants: rootActions.rawVariantCount,
      optionalFloorFlyVariants: withFloorFly.rawVariantCount - rootActions.rawVariantCount,
      defaultFloorFlyDeferred: true,
    },
    outcome: result.outcome,
    stats: {
      expansions: result.stats.expansions,
      generated: result.stats.generated,
      accepted: result.stats.accepted,
      exactMerged: result.stats.exactMerged,
      optionMapsObserved: result.stats.optionMapsObserved,
      optionChangingTransitions: result.stats.optionChangingTransitions,
      implicitOptionConsumptions: result.stats.implicitOptionConsumptions,
      maxStrategicDepth: result.stats.maxStrategicDepth,
      expandedByQueue: result.stats.expandedByQueue,
    },
    i621AutoConsumptionObserved: true,
    localStrictReplayControl: {
      goalFound: localClosure.outcome.goalFound,
      firstGoalExpansion: localClosure.outcome.firstGoalExpansion,
      replay: localClosure.replay,
    },
    frontierWitnesses: result.frontierWitnesses,
    verdict: result.verdict,
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main };
