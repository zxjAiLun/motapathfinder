"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { buildRouteFingerprint, loadCheckpointStore, mergeCheckpointPoolIntoStore, saveCheckpointStore, selectCheckpointSeeds } = require("./lib/checkpoint-store");
const { parseKeyValueArgs, resolveProjectRoot } = require("./lib/cli-options");
const { createCheckpointPool } = require("./lib/floor-checkpoints");
const { loadProject } = require("./lib/project-loader");
const { summarizePruning } = require("./lib/pruning-diagnostics");
const { applyConfigDefaults, loadSolverConfig } = require("./lib/solver-config");
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
    enableResourceChain: true,
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
  assert.strictEqual(merged["search-graph"], "macro");
  assert.strictEqual(merged["confluence-route-policy"], "ignore-length");
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
  assert.strictEqual(overview.beam.dropped, 11);
  assert.strictEqual(overview.quota.dropped, 19);
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
  const clusterDiagnostics = simulator.getResourceClusterDiagnostics();
  assert.ok(Number(clusterDiagnostics.dpStates || 0) > 0, "resourceCluster DP diagnostics should be visible");
  assert.ok(!actions.some((action) => action.kind === "battle"), "macro graph should suppress primitive battles when macro actions exist");
  assert.ok(graphStats.primitiveActionsSuppressed > 0, "macro graph should count suppressed primitive actions");
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
    tags: ["skyline", "skyline-highest-hp", "skyline-shortest-route", "skyline-near-level", "skyline-most-keys", "skyline-best-scout"],
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
}

function main() {
  const projectRoot = resolveProjectRoot({}, path.resolve(__dirname, ".."));
  const project = loadProject(projectRoot);
  testConfig(projectRoot, project);
  testPruningOverview();
  testMacroGraph(project);
  testCheckpointStore(projectRoot, project);
  console.log(JSON.stringify({ ok: true, checks: ["config", "pruning", "macroGraph", "checkpointStore"] }, null, 2));
}

if (require.main === module) {
  main();
}
