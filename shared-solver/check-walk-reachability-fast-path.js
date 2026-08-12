"use strict";

/**
 * TEST GRADE: local-regression
 *
 * Proves that the conservative safe-fast walk path is byte-stable at the
 * action/state boundary for a tracked MT4 checkpoint, while poison, movement
 * hazards, live auto events, and direction-sensitive tools fail back to the
 * legacy exact step simulator.
 */

const assert = require("node:assert");
const path = require("node:path");

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { executeActionList } = require("./lib/events");
const { loadProject } = require("./lib/project-loader");
const { readRouteFile } = require("./lib/route-store");
const { StaticSimulator } = require("./lib/simulator");
const { exactStateFingerprint } = require("./lib/solver-job");
const { cloneState, replaceTileAt } = require("./lib/state");
const { buildStateKey } = require("./lib/state-key");
const {
  buildWalkReachability,
  normalizeWalkReachabilityMode,
  __testing,
} = require("./lib/step-simulator");

const ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");
const FIXTURE = path.join(
  __dirname,
  "routes",
  "fixtures",
  "mt1-mt4-hp4459-atk421-def318-mdef5012.route.json",
);

function makeSimulator(project, walkReachabilityMode, enableReachabilitySkeletonCache) {
  return new StaticSimulator(project, {
    stopFloorId: "MT11",
    battleResolver: new FunctionBackedBattleResolver(project),
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFightToLevelUp: false,
    enableResourcePocket: false,
    enableResourceCluster: false,
    enableResourceChain: false,
    searchGraphMode: "primitive",
    walkReachabilityMode,
    enableReachabilitySkeletonCache,
  });
}

function findAction(simulator, state, summary) {
  return (simulator.enumeratePrimitiveActions(state).actions || [])
    .find((action) => action.summary === summary)
    || simulator.enumerateActions(state).find((action) => action.summary === summary)
    || null;
}

function replayFixture(simulator) {
  let state = simulator.createInitialState({ rank: "chaos" });
  for (const decision of readRouteFile(FIXTURE).decisions || []) {
    const action = findAction(simulator, state, decision.summary);
    assert.ok(action, `fixture replay missing action ${decision.summary}`);
    state = simulator.applyAction(state, action);
  }
  return state;
}

function walkOptions(simulator, walkReachabilityMode) {
  return {
    battleResolver: simulator.battleResolver,
    executeActionList,
    choiceResolver: simulator.choiceResolver,
    stabilizeState: (state) => simulator.stabilizeState(state),
    walkReachabilityMode,
  };
}

function reachabilitySnapshot(reachability) {
  return Object.values((reachability || {}).visited || {})
    .map((node) => ({
      key: node.key,
      x: node.x,
      y: node.y,
      distance: node.distance,
      path: node.path,
      stateKey: buildStateKey(node.state),
      heroSteps: Number(node.state.hero.steps || 0),
      direction: node.state.hero.loc.direction || null,
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function actionSnapshot(simulator, state) {
  const primitive = simulator.enumeratePrimitiveActions(state);
  return (primitive.actions || []).map((action) => ({
    kind: action.kind,
    summary: action.summary,
    fingerprint: simulator.getActionFingerprint(action),
    path: action.path || [],
    travelStateKey: action.travelState ? buildStateKey(action.travelState) : null,
    travelSteps: action.travelState ? Number(action.travelState.hero.steps || 0) : null,
  }));
}

function hasSpecial(special, value) {
  if (Array.isArray(special)) return special.includes(value);
  return Number(special) === value;
}

function findDamagingZoneTile(project) {
  const entry = Object.entries(project.mapTilesByNumber || {}).find(([, tile]) => {
    const enemy = tile && project.enemysById[tile.id];
    return enemy && hasSpecial(enemy.special, 15) && Number(enemy.value || 0) > 0;
  });
  assert.ok(entry, "tracked project must expose a damaging zone enemy tile control");
  return Number(entry[0]);
}

function containsForbiddenStatePayload(value) {
  if (Array.isArray(value)) return value.some(containsForbiddenStatePayload);
  if (!value || typeof value !== "object") return false;
  const forbidden = new Set(["state", "hero", "inventory", "flags", "floorStates", "route", "meta"]);
  return Object.entries(value).some(([key, child]) =>
    forbidden.has(key) || containsForbiddenStatePayload(child));
}

function main() {
  const project = loadProject(PROJECT_ROOT);
  const replaySimulator = makeSimulator(project, "legacy-exact");
  const checkpoint = replayFixture(replaySimulator);
  assert.strictEqual(checkpoint.floorId, "MT4", "fixture checkpoint floor");

  const exact = buildWalkReachability(
    project,
    checkpoint,
    walkOptions(replaySimulator, "legacy-exact"),
  );
  const fast = buildWalkReachability(
    project,
    checkpoint,
    walkOptions(replaySimulator, "safe-fast"),
  );
  assert.strictEqual(exact.diagnostics.mode, "legacy-exact");
  assert.strictEqual(fast.diagnostics.mode, "safe-fast");
  assert.deepStrictEqual(
    reachabilitySnapshot(fast),
    reachabilitySnapshot(exact),
    "safe-fast walk closure must match exact step simulation",
  );
  assert.ok(
    fast.diagnostics.stateClones < exact.diagnostics.stateClones,
    "safe-fast path must reduce state clones on the tracked checkpoint",
  );

  const exactSimulator = makeSimulator(project, "legacy-exact");
  const fastSimulator = makeSimulator(project, "safe-fast");
  assert.deepStrictEqual(
    actionSnapshot(fastSimulator, cloneState(checkpoint)),
    actionSnapshot(exactSimulator, cloneState(checkpoint)),
    "primitive actions and travel states must remain exact",
  );
  const exactStats = exactSimulator.getReachabilityCacheStats();
  const fastStats = fastSimulator.getReachabilityCacheStats();
  assert.ok(exactStats.legacyExactBuilds > 0 && exactStats.safeFastBuilds === 0);
  assert.ok(fastStats.safeFastBuilds > 0 && fastStats.legacyExactBuilds === 0);

  const cachedSimulator = makeSimulator(project, "safe-fast", true);
  const uncachedSimulator = makeSimulator(project, "safe-fast", false);
  const hpVariant = cloneState(checkpoint);
  hpVariant.hero.hp = Number(hpVariant.hero.hp) - 1;
  const cachedFirst = cachedSimulator.getWalkReachability(cloneState(checkpoint));
  const cachedSecond = cachedSimulator.getWalkReachability(cloneState(hpVariant));
  assert.deepStrictEqual(
    reachabilitySnapshot(cachedFirst),
    reachabilitySnapshot(uncachedSimulator.getWalkReachability(cloneState(checkpoint))),
    "first skeleton build must preserve the exact-state reachability result",
  );
  assert.deepStrictEqual(
    reachabilitySnapshot(cachedSecond),
    reachabilitySnapshot(uncachedSimulator.getWalkReachability(cloneState(hpVariant))),
    "skeleton hit must rebase every node onto the current exact state",
  );
  const skeletonStats = cachedSimulator.getActionExpansionCacheStats().reachabilitySkeleton;
  assert.strictEqual(skeletonStats.hits, 1);
  assert.strictEqual(skeletonStats.misses, 1);
  assert.strictEqual(skeletonStats.stores, 1);
  assert.strictEqual(skeletonStats.builds, 1);
  assert.strictEqual(skeletonStats.rebases, 2);
  assert.strictEqual(skeletonStats.safetyClassifications, 2);
  assert.strictEqual(
    Array.from(cachedSimulator.actionExpansionCaches.reachabilitySkeleton.values())
      .filter(containsForbiddenStatePayload).length,
    0,
    "cached skeleton must contain no state/hero/inventory/flags payload",
  );

  const poison = cloneState(checkpoint);
  poison.flags.poison = true;
  assert.strictEqual(
    __testing.classifySafeStaticWalk(project, poison, walkOptions(fastSimulator, "safe-fast")).reason,
    "poison-active",
  );
  const skeletonBeforePoison = cachedSimulator.getActionExpansionCacheStats().reachabilitySkeleton;
  cachedSimulator.getWalkReachability(cloneState(poison));
  const skeletonAfterPoison = cachedSimulator.getActionExpansionCacheStats().reachabilitySkeleton;
  assert.strictEqual(skeletonAfterPoison.hits, skeletonBeforePoison.hits);
  assert.strictEqual(skeletonAfterPoison.misses, skeletonBeforePoison.misses);
  assert.strictEqual(skeletonAfterPoison.stores, skeletonBeforePoison.stores);
  assert.strictEqual(skeletonAfterPoison.unsafeBypasses, skeletonBeforePoison.unsafeBypasses + 1);
  assert.strictEqual(
    skeletonAfterPoison.safetyClassifications,
    skeletonBeforePoison.safetyClassifications + 1,
  );

  const directional = cloneState(checkpoint);
  directional.inventory.pickaxe = 1;
  assert.strictEqual(
    __testing.classifySafeStaticWalk(project, directional, walkOptions(fastSimulator, "safe-fast")).reason,
    "direction-sensitive-inventory",
  );

  const liveAutoEvent = cloneState(checkpoint);
  liveAutoEvent.floorId = "MT5";
  liveAutoEvent.hero.loc.x = 6;
  liveAutoEvent.hero.loc.y = 12;
  assert.strictEqual(
    __testing.classifySafeStaticWalk(project, liveAutoEvent, walkOptions(fastSimulator, "safe-fast")).reason,
    "live-auto-events",
  );

  const hazardous = cloneState(checkpoint);
  replaceTileAt(hazardous, "MT4", 6, 6, findDamagingZoneTile(project));
  assert.strictEqual(
    __testing.classifySafeStaticWalk(project, hazardous, walkOptions(fastSimulator, "safe-fast")).reason,
    "movement-hazards",
  );

  assert.strictEqual(normalizeWalkReachabilityMode(), "safe-fast");
  assert.strictEqual(normalizeWalkReachabilityMode("legacy-exact"), "legacy-exact");
  assert.throws(
    () => normalizeWalkReachabilityMode("unsafe-fast"),
    /Invalid walk reachability mode/,
  );

  process.stdout.write(`${JSON.stringify({
    schema: "motapathfinder.walk-reachability-fast-path.v1",
    status: "passed",
    checkpoint: {
      floorId: checkpoint.floorId,
      exactStateFingerprint: exactStateFingerprint(checkpoint),
      visitedStates: reachabilitySnapshot(exact).length,
    },
    parity: {
      reachabilityExact: true,
      primitiveActionsExact: true,
    },
    costContract: {
      legacyExact: exact.diagnostics,
      safeFast: fast.diagnostics,
      cloneReductionFactor: Number(
        (fast.diagnostics.stateClones / exact.diagnostics.stateClones).toFixed(3),
      ),
    },
    fallbackControls: {
      poison: "legacy-exact",
      directionalInventory: "legacy-exact",
      liveAutoEvents: "legacy-exact",
      movementHazards: "legacy-exact",
      explicitRollback: "legacy-exact",
    },
    skeletonCache: {
      hpVariantHit: true,
      currentStateRebaseExact: true,
      cachedValueContainsStatePayload: false,
      unsafePoisonBypassed: true,
      stats: skeletonAfterPoison,
    },
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main };
