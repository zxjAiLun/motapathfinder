"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { buildRouteFingerprint, loadCheckpointStore, mergeCheckpointPoolIntoStore, prependCheckpointPoolRoutePrefix, sanitizeCheckpointStore, saveCheckpointStore, selectCheckpointSeeds } = require("./lib/checkpoint-store");
const { buildResourceChainOptions, buildResourceClusterSearchOptions, parseKeyValueArgs, resolveProjectRoot } = require("./lib/cli-options");
const { createCheckpointPool } = require("./lib/floor-checkpoints");
const { loadProject } = require("./lib/project-loader");
const { summarizeConfluence, summarizePruning } = require("./lib/pruning-diagnostics");
const { applyConfigDefaults, loadSolverConfig } = require("./lib/solver-config");
const { createSearchProfile } = require("./lib/search-profiles");
const { StaticSimulator } = require("./lib/simulator");

function buildSimulator(project, targetFloorId) {
  return new StaticSimulator(project, {
    stopFloorId: targetFloorId || "MT2",
    battleResolver: new FunctionBackedBattleResolver(project),
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFightToLevelUp: true,
    enableResourcePocket: true,
    enableResourceCluster: true,
    resourceClusterOptions: buildResourceClusterSearchOptions({ "resource-cluster-mode": "normal" }),
    enableResourceChain: true,
    resourceChainOptions: buildResourceChainOptions({ "resource-chain-floors": "MT2" }),
    searchGraphMode: "macro",
  });
}

function testConfig(projectRoot, project) {
  const args = parseKeyValueArgs(["--to-floor=MT5", "--floor-order=A,B,C"]);
  const config = loadSolverConfig(projectRoot, project, args);
  const merged = applyConfigDefaults(args, config);
  assert.strictEqual(config.profileName, "linear-main");
  assert.strictEqual(config.routeContext.targetFloor, "MT5");
  assert.strictEqual(config.routeContext.getFloorOrder("B"), 2);
  assert.strictEqual(merged["resource-pocket-mode"], "lite");
  assert.strictEqual(merged["resource-cluster-mode"], "normal");
  assert.strictEqual(merged["resource-chain"], "1");
  assert.strictEqual(merged["resource-chain-floors"], "MT2");
  assert.strictEqual(merged["search-graph"], "macro");
  assert.strictEqual(merged["confluence-route-policy"], "ignore-length");
  assert.strictEqual(merged["confluence-ignore-length-floors"], "MT1,MT2,MT3,MT4,MT5");
}

function testPrimaryProfiles(project) {
  const simulator = buildSimulator(project, "MT2");
  const linear = createSearchProfile("linear-main", simulator, { targetFloorId: "MT2" });
  const resourcePrep = createSearchProfile("resource-prep-main", simulator, { targetFloorId: "MT2" });
  const debugLocal = createSearchProfile("debug-local-resource", simulator, { targetFloorId: "MT2" });
  assert.strictEqual(linear.searchGraphMode, "macro");
  assert.strictEqual(linear.confluenceRoutePolicy, "slack", "linear-main code default should stay conservative; project config may opt into ignore-length");
  assert.strictEqual(typeof resourcePrep.sortStateActions, "function");
  assert.strictEqual(typeof debugLocal.sortStateActions, "function");
  assert.ok(Number(debugLocal.maxActionsPerState || 0) <= Number(resourcePrep.maxActionsPerState || 9999));
  assert.strictEqual(typeof createSearchProfile("stage-mt1-mt11", simulator, { targetFloorId: "MT2" }).sortStateActions, "function");
  assert.strictEqual(typeof createSearchProfile("stage-mt1-mt11-resource-prep", simulator, { targetFloorId: "MT2" }).sortStateActions, "function");
}

function testPruningOverview() {
  const overview = summarizePruning({
    pruneReasons: {
      "same-state": 2,
      "safe-exact-same-state": 3,
      "best-dominates": 5,
      "bucket-dominates": 7,
      beamDropped: 11,
    },
    confluenceDominance: {
      enabled: true,
      routePolicy: "ignore-length",
      rejectedByHigherHp: 13,
      replacedLowerHp: 17,
      ignoredRouteLengthRejects: 2,
      ignoredRouteLengthReplacements: 3,
      unsafeFloorDowngrades: 4,
      nonWhitelistedFloorDowngrades: 1,
      byFloor: { MT1: { rejectedByHigherHp: 13 } },
      representativesByKeyMax: 3,
      examples: [{ reason: "sample" }],
    },
    frontier: { beamDropped: 11 },
    quota: { dropped: 19, byActionType: { monster: 19 } },
  });
  assert.strictEqual(overview.exactDuplicate.dropped, 5);
  assert.strictEqual(overview.dominance.dropped, 12);
  assert.strictEqual(overview.confluenceHp.rejectedByHigherHp, 13);
  assert.strictEqual(overview.confluenceHp.routePolicy, "ignore-length");
  assert.strictEqual(overview.confluenceHp.ignoredRouteLengthRejects, 2);
  assert.strictEqual(overview.confluenceHp.unsafeFloorDowngrades, 4);
  assert.strictEqual(overview.confluenceHp.nonWhitelistedFloorDowngrades, 1);
  assert.strictEqual(overview.confluenceHp.byFloor.MT1.rejectedByHigherHp, 13);
  assert.strictEqual(overview.beam.dropped, 11);
  assert.strictEqual(overview.quota.dropped, 19);
  const confluence = summarizeConfluence({
    confluenceDominance: {
      enabled: true,
      routePolicy: "ignore-length",
      rejectedByHigherHp: 13,
      replacedLowerHp: 17,
      nonWhitelistedFloorDowngrades: 1,
      byFloor: { MT1: { rejectedByHigherHp: 13 } },
      representativesByKeyMax: 3,
    },
  });
  assert.deepStrictEqual(confluence, {
    enabled: true,
    routePolicy: "ignore-length",
    rejectedByHigherHp: 13,
    replacedLowerHp: 17,
    unsafeFloorDowngrades: 0,
    nonWhitelistedFloorDowngrades: 1,
    representativesByKeyMax: 3,
    byFloor: { MT1: { rejectedByHigherHp: 13 } },
  });
}

function testMacroGraph(project) {
  const simulator = buildSimulator(project, "MT2");
  const state = simulator.createInitialState({ rank: "chaos" });
  const graphStats = {
    mode: "macro",
    statesWithMacroActions: 0,
    primitiveFallbackStates: 0,
    primitiveActionsSuppressed: 0,
    expandedByKind: {},
  };
  const actions = simulator.enumerateActions(state, { searchGraphMode: "macro", graphStats });
  assert.ok(actions.some((action) => action.kind === "resourceCluster"), "macro graph should expose resourceCluster");
  const clusterActions = actions.filter((action) => action.kind === "resourceCluster");
  assert.ok(clusterActions.every((action) => (action.planEntries || []).length > 1), "real tower resourceCluster should output local foundation plans");
  assert.ok(
    clusterActions.some((action) => (action.planEntries || []).some((entry) => /^(battle|pickup|event|openDoor|useTool)@/.test(entry.clusterActionId || "") || /^equip@/.test(entry.clusterActionId || ""))),
    "real tower resourceCluster should expose stable cluster resource ids"
  );
  const clusterDiagnostics = simulator.getResourceClusterDiagnostics();
  assert.strictEqual(clusterDiagnostics.mode, "normal");
  assert.ok(Number(clusterDiagnostics.candidateStates || 0) > 0, "resourceCluster should only run after candidate gating");
  assert.ok(Number(clusterDiagnostics.localClustersDetected || 0) > 0, "resourceCluster should split real candidates into local clusters");
  assert.ok(Number(clusterDiagnostics.dpStates || 0) > 0, "resourceCluster DP diagnostics should be visible");
  assert.ok(!actions.some((action) => action.kind === "battle"), "macro graph should suppress primitive battles when macro actions exist");
  assert.ok(graphStats.primitiveActionsSuppressed > 0, "macro graph should count suppressed primitive actions");
  assert.strictEqual(simulator.shouldEnumerateResourceCluster(state, []), false, "resourceCluster should skip states without candidates");
  assert.strictEqual(simulator.shouldEnumerateResourceChain({ floorId: "MT1" }), false, "resourceChain should skip floors outside its gate");
  assert.strictEqual(simulator.shouldEnumerateResourceChain({ floorId: "MT2" }), true, "resourceChain should run on configured floors");
  const cacheStats = simulator.getActionExpansionCacheStats();
  assert.ok(cacheStats.reachability && cacheStats.reachability.hitRate != null, "cache diagnostics should include hitRate");
  assert.ok(cacheStats.reachability.avgComputeMs != null, "cache diagnostics should include avgComputeMs");
  assert.ok(cacheStats.resourceCluster && cacheStats.resourceCluster.estimatedMsSaved != null, "cache diagnostics should include estimatedMsSaved");
  assert.throws(
    () => simulator.enumerateActions(state, { searchGraphMode: "invalid" }),
    /Expected primitive, macro, or hybrid/,
    "search graph mode should be explicit"
  );
}

function testCheckpointStore(projectRoot, project) {
  const config = loadSolverConfig(projectRoot, project, {});
  const pool = createCheckpointPool();
  pool.edges["MT1->MT2"] = [{
    id: "MT1->MT2#synthetic",
    edge: "MT1->MT2",
    fromFloorId: "MT1",
    toFloorId: "MT2",
    routeLength: 1,
    decisionDepth: 1,
    hero: { hp: 100, atk: 10, def: 5, mdef: 0, lv: 1, exp: 0, money: 0, equipment: [] },
    equipment: [],
    inventory: {},
    tags: ["skyline", "skyline-highest-hp", "skyline-highest-combat", "skyline-fastest", "skyline-shortest-route", "skyline-near-level", "skyline-most-keys", "skyline-best-scout"],
    skylineKey: "10|5|0|1|0||",
    scout: { score: 1 },
    score: 100,
    route: ["changeFloor@MT1:6,0"],
    state: {
      floorId: "MT2",
      hero: { hp: 100, atk: 10, def: 5, mdef: 0, lv: 1, exp: 0, money: 0, equipment: [], loc: { x: 6, y: 0 } },
      heroLoc: { x: 6, y: 0 },
      inventory: {},
      route: ["changeFloor@MT1:6,0"],
      meta: { decisionDepth: 1 },
    },
  }];
  const fingerprint = buildRouteFingerprint(project, config.routeContext);
  const store = mergeCheckpointPoolIntoStore({
    version: 1,
    projectId: config.projectId,
    profile: config.profileName,
    routeFingerprint: fingerprint,
    edges: {},
  }, pool, {
    projectId: config.projectId,
    profile: config.profileName,
    routeFingerprint: fingerprint,
  });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mota-checkpoint-"));
  const filePath = path.join(tmpDir, "linear-main.checkpoint-skyline.json");
  saveCheckpointStore(filePath, store);
  const loaded = loadCheckpointStore(filePath, {
    project,
    projectId: config.projectId,
    profile: config.profileName,
    routeContext: config.routeContext,
    routeFingerprint: fingerprint,
  });
  assert.strictEqual(loaded.usable, true);
  const seeds = selectCheckpointSeeds(loaded.store, config.routeContext, "MT2", { maxSeeds: 2 });
  assert.ok(seeds.length > 0, "checkpoint store should produce reusable seeds");

  const seedPool = createCheckpointPool();
  seedPool.edges["MT2->MT3"] = [{
    id: "MT2->MT3#suffix",
    edge: "MT2->MT3",
    fromFloorId: "MT2",
    toFloorId: "MT3",
    routeLength: 1,
    decisionDepth: 1,
    hero: { hp: 100, atk: 10, def: 5, mdef: 0, lv: 1, exp: 0, money: 0, equipment: [] },
    equipment: [],
    inventory: {},
    tags: ["skyline-highest-hp"],
    skylineKey: "10|5|0|1|0||",
    scout: { score: 1 },
    score: 100,
    route: ["changeFloor@MT3:6,12"],
    state: {
      floorId: "MT3",
      hero: { hp: 100, atk: 10, def: 5, mdef: 0, lv: 1, exp: 0, money: 0, equipment: [], loc: { x: 6, y: 12 } },
      heroLoc: { x: 6, y: 12 },
      inventory: {},
      route: ["changeFloor@MT3:6,12"],
      meta: { decisionDepth: 1 },
    },
  }];
  prependCheckpointPoolRoutePrefix(seedPool, ["changeFloor@MT1:6,0"], 5);
  assert.deepEqual(seedPool.edges["MT2->MT3"][0].route, ["changeFloor@MT1:6,0", "changeFloor@MT3:6,12"], "seeded checkpoint routes should be promoted to full prefixes before saving");
  assert.deepEqual(seedPool.edges["MT2->MT3"][0].state.route, ["changeFloor@MT1:6,0", "changeFloor@MT3:6,12"], "seeded checkpoint state routes should be promoted with the checkpoint");
  assert.equal(seedPool.edges["MT2->MT3"][0].decisionDepth, 6, "seeded checkpoint decision depth should include the prefix primitive depth");
  assert.equal(seedPool.edges["MT2->MT3"][0].state.meta.decisionDepth, 6, "seeded checkpoint state depth should include the prefix primitive depth");

  const dirtyStore = JSON.parse(JSON.stringify(store));
  dirtyStore.edges["MT2->MT3"] = {
    buckets: {
      "10|5|0|1|0||": {
        highestHp: seedPool.edges["MT2->MT3"][0],
      },
    },
  };
  dirtyStore.edges["MT2->MT3"].buckets["10|5|0|1|0||"].highestHp.route = ["changeFloor@MT3:6,12"];
  dirtyStore.edges["MT2->MT3"].buckets["10|5|0|1|0||"].highestHp.state.route = ["changeFloor@MT3:6,12"];
  const cleaned = sanitizeCheckpointStore(dirtyStore, (checkpoint) => {
    const route = checkpoint.route || [];
    return route[0] === "changeFloor@MT1:6,0" ? { ok: true } : { ok: false, reason: "route-not-replayable-from-start" };
  });
  assert.equal(cleaned.removed, 1, "checkpoint store sanitizer should drop stale suffix-only checkpoint routes");
  assert.equal(cleaned.store.edges["MT2->MT3"], undefined, "empty dirty checkpoint edge should be removed after sanitization");
}

function main() {
  const projectRoot = resolveProjectRoot(
    { "project-root": path.resolve(__dirname, "../Only upV2.1/Only upV2.1") },
    path.resolve(__dirname, "..")
  );
  const project = loadProject(projectRoot);
  testConfig(projectRoot, project);
  testPrimaryProfiles(project);
  testPruningOverview();
  testMacroGraph(project);
  testCheckpointStore(projectRoot, project);
  console.log(JSON.stringify({ ok: true, checks: ["config", "profiles", "pruning", "macroGraph", "checkpointStore"] }, null, 2));
}

if (require.main === module) {
  main();
}
