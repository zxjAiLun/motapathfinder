"use strict";

/**
 * PR-5.24b Iteration 2b – Thin Planner Bootstrap Worker
 *
 * One-time heavy process that owns project + StaticSimulator.
 * Thin planner process never calls loadProject() or new StaticSimulator().
 *
 * Input:  { projectRoot, stopFloorId, enableFastHazardBlockIndex, enableCompiledEffectCache, autoBattleFastRejectEnabled, autoPickupEnabled, autoBattleEnabled }
 * Output: { projectIdentity, simulatorProfile, initialState, initialStateKey, ... , bootstrapPeakRssMb }
 */

const fs = require("node:fs");
const path = require("node:path");
const { loadProject } = require("./lib/project-loader");
const { StaticSimulator } = require("./lib/simulator");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { buildStateKey } = require("./lib/state-key");
const { createNoStateChangeChoiceResolver } = require("./lib/onlyup-mt1-real-route-gate");

function buildSimulatorProfile(simulator) {
  return {
    stopFloorId: simulator.stopFloorId || "MT11",
    enableFastHazardBlockIndex: simulator.enableFastHazardBlockIndex !== false,
    enableCompiledEffectCache: Boolean(simulator.enableCompiledEffectCache),
    autoPickupEnabled: simulator.autoResolver ? Boolean(simulator.autoResolver.autoPickupEnabled) : true,
    autoBattleEnabled: simulator.autoResolver ? Boolean(simulator.autoResolver.autoBattleEnabled) : true,
    autoBattleFastRejectEnabled: simulator.autoResolver ? simulator.autoResolver.enableFastRejectSkip === true : false,
    battleResolverEnableFastReject: simulator.battleResolver && typeof simulator.battleResolver.fastRejectClassifier === "function",
    battleResolverType: simulator.battleResolver ? simulator.battleResolver.constructor.name : null,
    walkReachabilityMode: simulator.walkReachabilityMode || null,
    searchGraphMode: simulator.searchGraphMode || null,
    unsupported: false,
    unsupportedReason: null,
  };
}

function main() {
  const [,, inputPath, outputPath] = process.argv;
  if (!inputPath || !outputPath) {
    console.error("Usage: node planner-bootstrap-worker.js <inputPath> <outputPath>");
    process.exit(1);
  }
  const raw = fs.readFileSync(inputPath, "utf8");
  const req = JSON.parse(raw);
  const projectRoot = req.projectRoot || path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
  const stopFloorId = req.stopFloorId || "MT6";

  const rssBefore = Math.round((process.memoryUsage().rss / 1048576) * 10) / 10;
  const project = loadProject(projectRoot);
  const choiceResolver = createNoStateChangeChoiceResolver();
  const simulator = new StaticSimulator(project, {
    stopFloorId,
    battleResolver: new FunctionBackedBattleResolver(project, { enableFastReject: req.battleResolverEnableFastReject !== false }),
    autoBattleFastRejectEnabled: req.autoBattleFastRejectEnabled !== false,
    autoPickupEnabled: req.autoPickupEnabled !== false,
    autoBattleEnabled: req.autoBattleEnabled !== false,
    enableFastHazardBlockIndex: req.enableFastHazardBlockIndex !== false,
    enableCompiledEffectCache: Boolean(req.enableCompiledEffectCache),
    choiceResolver,
  });

  const rssAfterLoad = Math.round((process.memoryUsage().rss / 1048576) * 10) / 10;
  const initialState = simulator.createInitialState();
  const rssAfterState = Math.round((process.memoryUsage().rss / 1048576) * 10) / 10;

  // Verify identity like gates do
  const firstData = (project.data || {}).firstData || {};
  const projectIdentity = {
    title: firstData.title || null,
    startFloorId: firstData.floorId || null,
    startLoc: firstData.hero && firstData.hero.loc ? { x: firstData.hero.loc.x, y: firstData.hero.loc.y } : null,
    floorCount: Object.keys(project.floorsById || {}).length,
    stopFloorId,
  };

  const simulatorProfile = buildSimulatorProfile(simulator);
  const initialStateKey = buildStateKey(initialState);
  // Difficulty snapshot
  const difficultySnapshot = (state) => {
    const inv = (state && state.inventory) || {};
    const flags = (state && state.flags) || {};
    const norm = (v) => (v == null || v === false ? 0 : v === true ? 1 : Number.isFinite(Number(v)) ? Number(v) : 0);
    return { I581: norm(inv.I581), I582: norm(inv.I582), "flag:level0": norm(flags.level0) };
  };

  const rssPeak = Math.max(rssBefore, rssAfterLoad, rssAfterState, Math.round((process.memoryUsage().rss / 1048576) * 10) / 10);
  const heapUsed = Math.round((process.memoryUsage().heapUsed / 1048576) * 10) / 10;

  const out = {
    success: true,
    projectRoot,
    projectIdentity,
    simulatorProfile,
    initialState,
    initialStateKey,
    initialHero: initialState.hero ? { hp: initialState.hero.hp, atk: initialState.hero.atk, def: initialState.hero.def, mdef: initialState.hero.mdef, lv: initialState.hero.lv, exp: initialState.hero.exp, loc: initialState.hero.loc } : null,
    difficulty: difficultySnapshot(initialState),
    bootstrapPeakRssMb: rssPeak,
    bootstrapRssBeforeMb: rssBefore,
    bootstrapRssAfterLoadMb: rssAfterLoad,
    bootstrapRssAfterStateMb: rssAfterState,
    bootstrapHeapUsedMb: heapUsed,
  };

  fs.writeFileSync(outputPath, JSON.stringify(out));
  process.exit(0);
}

if (require.main === module) main();
