"use strict";

/**
 * TEST GRADE: unit-plus-micro
 *
 * PR-5.9c Reachability Rebase Cost Attribution — observation only.
 *
 * Instruments safe-fast reachability nodes only when explicitly requested.
 * It records which consumers read eager node.state/node.key and which nodes
 * actually escape through emitted action.travelState. No lazy state, alternate
 * visited representation, or action semantics are introduced here.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { loadProject } = require("./lib/project-loader");
const { buildReplayRouteFingerprint } = require("./lib/replay-resume-artifact");
const { compileExecutableSolveTask } = require("./lib/solve-task");
const { executeSolveJob, exactStateFingerprint, makeSimulator } = require("./lib/solver-job");

const ROOT = path.resolve(__dirname, "..");
const ONLY_UP_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");
const SMOKE_SPEC_FILE = path.join(ROOT, "towers", "onlyup", "region-specs", "region-output-contract-smoke.json");
const EXPECTED_WINNER_EXACT = "a2ff379819ac9003";
const EXPECTED_ROUTE_SHA256 = "c0adb2d921e84cab097c034bf7b6f8fdb5a344a0cb21f66ea3b7f707a4ebec13";
const EXPECTED_OBJECTIVE_VALUE = 1346;

function buildTask() {
  const spec = JSON.parse(fs.readFileSync(SMOKE_SPEC_FILE, "utf8"));
  spec.goal = { type: "heroAtLeast", floorId: "MT1", minHero: { exp: 9 } };
  return compileExecutableSolveTask({
    schema: "motapathfinder.solve-task.v1",
    tower: { id: "onlyup-smoke", projectRoot: ONLY_UP_ROOT, region: { spec } },
    objective: { mode: "max-final-hp" },
    search: {
      algorithm: "segment-dp",
      maxExpansions: 3000,
      maxRuntimeMs: 0,
      candidateLimit: 2,
      goalSkylineLimit: 8,
    },
    verification: { strictReplay: true },
  });
}

async function main() {
  const task = buildTask();
  const defaultSimulator = makeSimulator(
    loadProject(ONLY_UP_ROOT),
    task.normalizedTask.tower.region.spec,
    task,
  );
  assert.strictEqual(defaultSimulator.getReachabilityRebaseAttribution(), null,
    "rebase attribution must remain default-off");

  const originalLog = console.log;
  console.log = () => {};
  let execution;
  try {
    execution = await executeSolveJob(task, {
      jobId: "reachability-rebase-attribution",
      onProgress: () => {},
      shouldStop: () => false,
      context: { reachabilityRebaseAttribution: true },
    });
  } finally {
    console.log = originalLog;
  }

  const attempt = execution.result.segmentResults[0].attempts[0];
  const dp = attempt.diagnostics.dp;
  const winnerState = execution.result.finalCandidate.state;
  const routeFingerprint = buildReplayRouteFingerprint(execution.routeRecord);
  const attribution = execution.simulator.getReachabilityRebaseAttribution();
  const exactCache = execution.simulator.getReachabilityCacheStats();
  const skeletonCache = execution.simulator.getActionExpansionCacheStats().reachabilitySkeleton;

  assert.strictEqual(execution.result.found, true);
  assert.strictEqual(execution.strictReplayVerified, true);
  assert.strictEqual(exactStateFingerprint(winnerState), EXPECTED_WINNER_EXACT);
  assert.strictEqual(routeFingerprint.sha256, EXPECTED_ROUTE_SHA256);
  assert.strictEqual(execution.objectiveValue.value, EXPECTED_OBJECTIVE_VALUE);
  assert.strictEqual(Number(dp.expansions), 116);
  assert.ok(attribution, "explicit diagnostic run must expose attribution");
  assert.strictEqual(attribution.rebases, skeletonCache.rebases);
  assert.strictEqual(attribution.skeletonBuildRebases, skeletonCache.builds);
  assert.strictEqual(attribution.skeletonHitRebases, skeletonCache.hits);
  assert.strictEqual(attribution.materializedNodes, skeletonCache.nodesRebased);
  assert.strictEqual(attribution.dominanceKeyBuilds, exactCache.dominanceKeyBuilds);
  assert.strictEqual(attribution.stateCloneLowerBound, attribution.materializedNodes);
  assert.strictEqual(
    exactCache.stateClones - attribution.stateCloneLowerBound,
    skeletonCache.safetyClassifications,
    "non-node clones must be the one stability probe per exact miss",
  );
  assert.ok(attribution.uniqueTravelStateNodes > 0, "real actions must carry travel states");
  assert.ok(attribution.uniqueTravelStateNodes < attribution.materializedNodes,
    "real workload must prove eager materialization beyond travel-state escapes");
  assert.ok(attribution.materializedNodesWithoutTravelStateEscape > 0);
  assert.deepStrictEqual({
    rebases: attribution.rebases,
    materializedNodes: attribution.materializedNodes,
    stateAccesses: attribution.stateAccesses,
    nodeKeyPropertyAccesses: attribution.nodeKeyPropertyAccesses,
    emittedActionsWithTravelState: attribution.emittedActionsWithTravelState,
    uniqueTravelStateNodes: attribution.uniqueTravelStateNodes,
    materializedNodesWithoutTravelStateEscape: attribution.materializedNodesWithoutTravelStateEscape,
  }, {
    rebases: 123,
    materializedNodes: 6526,
    stateAccesses: 333011,
    nodeKeyPropertyAccesses: 0,
    emittedActionsWithTravelState: 760,
    uniqueTravelStateNodes: 566,
    materializedNodesWithoutTravelStateEscape: 5960,
  }, "real rebase allocation/consumption baseline must remain pinned");
  assert.deepStrictEqual(attribution.consumers, {
    battle: { stateAccesses: 52356, uniqueStateNodes: 6185, keyAccesses: 0, uniqueKeyNodes: 0, emittedActions: 289, uniqueTravelStateNodes: 289 },
    changeFloor: { stateAccesses: 49509, uniqueStateNodes: 6185, keyAccesses: 0, uniqueKeyNodes: 0, emittedActions: 29, uniqueTravelStateNodes: 29 },
    door: { stateAccesses: 74220, uniqueStateNodes: 6185, keyAccesses: 0, uniqueKeyNodes: 0, emittedActions: 0, uniqueTravelStateNodes: 0 },
    equipment: { stateAccesses: 0, uniqueStateNodes: 0, keyAccesses: 0, uniqueKeyNodes: 0, emittedActions: 0, uniqueTravelStateNodes: 0 },
    event: { stateAccesses: 99076, uniqueStateNodes: 6185, keyAccesses: 0, uniqueKeyNodes: 0, emittedActions: 116, uniqueTravelStateNodes: 116 },
    floorFly: { stateAccesses: 2282, uniqueStateNodes: 163, keyAccesses: 0, uniqueKeyNodes: 0, emittedActions: 326, uniqueTravelStateNodes: 163 },
    interactPickup: { stateAccesses: 2608, uniqueStateNodes: 163, keyAccesses: 0, uniqueKeyNodes: 0, emittedActions: 0, uniqueTravelStateNodes: 0 },
    pickup: { stateAccesses: 49480, uniqueStateNodes: 6185, keyAccesses: 0, uniqueKeyNodes: 0, emittedActions: 0, uniqueTravelStateNodes: 0 },
    regionSignature: { stateAccesses: 3480, uniqueStateNodes: 341, keyAccesses: 0, uniqueKeyNodes: 0, emittedActions: 0, uniqueTravelStateNodes: 0 },
    tool: { stateAccesses: 0, uniqueStateNodes: 0, keyAccesses: 0, uniqueKeyNodes: 0, emittedActions: 0, uniqueTravelStateNodes: 0 },
  }, "consumer attribution must remain complete with no unscoped bucket");

  process.stdout.write(`${JSON.stringify({
    schema: "motapathfinder.reachability-rebase-attribution-check.v1",
    status: "passed",
    controls: {
      observationOnly: true,
      attributionDefaultOff: true,
      lazyStateNotImplemented: true,
      visitedRepresentationUnchanged: true,
      actionSemanticsUnchanged: true,
      pinnedWinnerRouteObjectiveScale: true,
      strictReplayVerified: true,
    },
    workload: {
      id: "onlyup-mt1-exp9-candidate-default",
      expansions: Number(dp.expansions),
      winnerExactFingerprint: exactStateFingerprint(winnerState),
      routeFingerprint: routeFingerprint.sha256,
      objectiveValue: execution.objectiveValue.value,
    },
    exactCache,
    skeletonCache,
    attribution,
    verdict: "EAGER_TRAVEL_STATE_MATERIALIZATION_OVERBUILD",
  }, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  });
}

module.exports = { main };
