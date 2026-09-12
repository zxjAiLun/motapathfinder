"use strict";

/**
 * PR-5.25p Phase 0 strict replay hardening checks.
 *
 * Uses the tracked PR-5.25o cap=1024 winner qualification artifact (not the
 * gitignored generated route) so the contract is verifiable on a clean
 * checkout. Verifies:
 *   1. replay accepts an explicit initialState and does not mutate it;
 *   2. the resolver is restricted to the supplied primitive candidates;
 *   3. a supplied structured trace must be complete per entry (action +
 *      non-empty postExactStateKey), otherwise it fails closed;
 *   4. legacy summary-only routes stay fail-closed on ambiguity.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { loadProject } = require("./lib/project-loader");
const { StaticSimulator } = require("./lib/simulator");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { verifyStrictReplay } = require("./lib/strict-replay");

const PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const ARTIFACT_PATH = path.resolve(__dirname, "..", "docs", "260912", "qualification", "5-25o-cap1024-winner.json");

function makeSimulator(project) {
  return new StaticSimulator(project, {
    stopFloorId: "MT11",
    battleResolver: new FunctionBackedBattleResolver(project),
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    searchGraphMode: "primitive",
    walkReachabilityMode: "safe-fast",
  });
}

function main() {
  const project = loadProject(PROJECT_ROOT);
  const simulator = makeSimulator(project);
  const artifact = JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf8"));
  const winner = artifact.winner;
  assert(winner && Array.isArray(winner.route) && Array.isArray(winner.routeTrace), "winner route and trace are required");
  assert.strictEqual(winner.route.length, winner.routeTrace.length, "route and trace lengths must match");
  assert.strictEqual(artifact.qualificationProtocol.cap1024, "WINNER");

  const isGoalState = (state) => state.floorId === "MT3";
  const initialState = simulator.createInitialState({ rank: "chaos" });
  const initialSnapshot = JSON.stringify(initialState);

  const originalEnumerateActions = simulator.enumerateActions;
  simulator.enumerateActions = () => {
    throw new Error("strict replay must use the supplied primitive candidates, not extra enumeration");
  };
  const replay = verifyStrictReplay(simulator, winner.route, {
    initialState,
    isGoalState,
    routeTrace: winner.routeTrace,
  });
  simulator.enumerateActions = originalEnumerateActions;
  assert.strictEqual(replay.ok, true, `complete structured replay failed: ${replay.reason}`);
  assert.strictEqual(replay.finalFloorId, "MT3");
  assert.strictEqual(JSON.stringify(initialState), initialSnapshot, "initialState must not be mutated");
  assert.strictEqual(replay.finalKey, winner.replayFinalExactStateKey, "replay final key must match recorded provenance");

  const missingPostKey = winner.routeTrace.map((entry) => ({ ...entry }));
  delete missingPostKey[0].postExactStateKey;
  const missingPostResult = verifyStrictReplay(simulator, winner.route, { initialState, isGoalState, routeTrace: missingPostKey });
  assert.strictEqual(missingPostResult.ok, false, "trace entry without postExactStateKey must fail closed");
  assert.strictEqual(missingPostResult.reason, "step-0-incomplete-structured-trace");

  const missingAction = winner.routeTrace.map((entry) => ({ ...entry }));
  delete missingAction[0].action;
  const missingActionResult = verifyStrictReplay(simulator, winner.route, { initialState, isGoalState, routeTrace: missingAction });
  assert.strictEqual(missingActionResult.ok, false, "trace entry without action must fail closed");
  assert.strictEqual(missingActionResult.reason, "step-0-incomplete-structured-trace");

  const legacyResult = verifyStrictReplay(simulator, winner.route, { initialState, isGoalState });
  assert.strictEqual(legacyResult.ok, false, "legacy summary-only route must stay fail-closed");
  assert.match(legacyResult.reason, /ambiguous-(summary|kind)/);

  console.log("PR-5.25p Phase 0 strict replay checks passed");
  console.log(`  explicit initialState: pass (${replay.finalFloorId})`);
  console.log("  candidates-only resolver restriction: pass");
  console.log("  incomplete structured trace: fail-closed");
  console.log(`  legacy summary-only route: fail-closed (${legacyResult.reason})`);
}

main();
