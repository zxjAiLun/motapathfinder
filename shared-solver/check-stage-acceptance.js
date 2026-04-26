"use strict";

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const {
  buildActionExpansionCacheOptions,
  buildConfluenceDominanceOptions,
  buildResourceChainOptions,
  buildResourceClusterSearchOptions,
  buildResourcePocketSearchOptions,
  parseBooleanFlag,
  parseKeyValueArgs,
  resolveProjectRoot,
  shouldEnableResourceChain,
  shouldEnableResourceCluster,
  shouldEnableResourcePocket,
} = require("./lib/cli-options");
const { loadProject } = require("./lib/project-loader");
const { getProgress } = require("./lib/progress");
const { getFloorOrder } = require("./lib/score");
const { createSearchProfile } = require("./lib/search-profiles");
const { searchTopK } = require("./lib/search");
const { StaticSimulator } = require("./lib/simulator");

function parseArgs(argv) {
  return parseKeyValueArgs(argv);
}

function parseList(value, fallback) {
  if (!value) return fallback;
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function unsupportedNoteCount(state) {
  return ((state && state.notes) || []).filter((note) => /unsupported|未支持|not supported/i.test(String(note))).length;
}

function runStage(project, targetFloor, args) {
  const cacheOptions = buildActionExpansionCacheOptions(args);
  const simulator = new StaticSimulator(project, {
    stopFloorId: targetFloor,
    battleResolver: new FunctionBackedBattleResolver(project, cacheOptions),
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFightToLevelUp: true,
    enableResourcePocket: shouldEnableResourcePocket(args, true),
    enableResourceCluster: shouldEnableResourceCluster(args, true),
    enableResourceChain: shouldEnableResourceChain(args, false),
    searchGraphMode: args["search-graph"] || "macro",
    primitiveFallbackMode: args["primitive-fallback"] || "auto",
    resourcePocketSearchOptions: buildResourcePocketSearchOptions(args),
    resourceClusterOptions: buildResourceClusterSearchOptions(args),
    resourceChainOptions: buildResourceChainOptions(args),
    enableActionExpansionCache: cacheOptions.enableActionExpansionCache,
    actionExpansionCacheLimit: cacheOptions.actionExpansionCacheLimit,
  });
  const profileName = args.profile || "linear-main";
  const profile = createSearchProfile(profileName, simulator, {
    targetFloorId: targetFloor,
    maxActionsPerState: args["max-actions-per-state"] ? Number(args["max-actions-per-state"]) : undefined,
  });
  const initialState = simulator.createInitialState({ rank: args.rank || "chaos" });
  const result = searchTopK(simulator, initialState, {
    ...profile,
    topK: 1,
    maxExpansions: Number(args[`max-expansions-${targetFloor.toLowerCase()}`] || args["max-expansions"] || 300),
    beamWidth: args["beam-width"] ? Number(args["beam-width"]) : undefined,
    perFloorBeamWidth: args["per-floor-beam-width"] ? Number(args["per-floor-beam-width"]) : undefined,
    perRegionBeamWidth: args["per-region-beam-width"] ? Number(args["per-region-beam-width"]) : undefined,
    maxActionsPerState: args["max-actions-per-state"] ? Number(args["max-actions-per-state"]) : profile.maxActionsPerState,
    safeDominanceMode: true,
    searchGraphMode: args["search-graph"] || profile.searchGraphMode || "macro",
    primitiveFallbackMode: args["primitive-fallback"] || "auto",
    resourceClusterOptions: buildResourceClusterSearchOptions(args),
    ...buildConfluenceDominanceOptions(args, profile.enableConfluenceHpDominance, profile.confluenceRoutePolicy),
  });
  const bestProgress = result.bestProgressState || result.bestSeenState || null;
  return {
    targetFloor,
    profile: profileName,
    foundGoal: result.foundGoal,
    expanded: result.expansions,
    bestProgress: bestProgress ? {
      floorId: bestProgress.floorId,
      stageIndex: getProgress(bestProgress).stageIndex,
      routeLength: Array.isArray(bestProgress.route) ? bestProgress.route.length : 0,
    } : null,
    liveReplayMatched: false,
    liveReplayNote: "not-run-by-static-stage-acceptance; use npm run check:live:progress for MT3/MT5 runtime parity",
    unsupportedNotes: unsupportedNoteCount(bestProgress),
    diagnostics: {
      frontierTopBuckets: (((result.diagnostics || {}).frontier || {}).topBuckets || []).slice(0, 5),
      droppedProgressActions: (result.diagnostics || {}).droppedProgressActions || {},
      graph: (result.diagnostics || {}).graph || {},
      confluence: (result.diagnostics || {}).confluenceDominance || {},
      resourceCluster: (result.diagnostics || {}).resourceCluster || {},
      checkpoints: (result.diagnostics || {}).checkpoints || {},
      best: (result.diagnostics || {}).best || {},
    },
  };
}

function progressFloorOrder(result) {
  return getFloorOrder(result && result.bestProgress && result.bestProgress.floorId);
}

function validateResults(results, args) {
  const failures = [];
  const minProgressFloor = args["min-progress-floor"];
  if (minProgressFloor) {
    const minOrder = getFloorOrder(minProgressFloor);
    results.forEach((result) => {
      if (progressFloorOrder(result) < minOrder) {
        failures.push(`${result.targetFloor}: bestProgress ${result.bestProgress && result.bestProgress.floorId} < ${minProgressFloor}`);
      }
    });
  }
  results.forEach((result) => {
    if (Number(result.unsupportedNotes || 0) > 0) failures.push(`${result.targetFloor}: unsupportedNotes=${result.unsupportedNotes}`);
    const droppedProgress = Number((((result.diagnostics || {}).droppedProgressActions || {}).total) || 0);
    if (droppedProgress > 0) failures.push(`${result.targetFloor}: droppedProgressActions=${droppedProgress}`);
  });
  if (parseBooleanFlag(args["fail-on-miss"], false)) {
    results.forEach((result) => {
      if (!result.foundGoal) failures.push(`${result.targetFloor}: goal not found`);
    });
  }
  return failures;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const project = loadProject(resolveProjectRoot(process.argv.slice(2), __dirname + "/../Only upV2.1/Only upV2.1"));
  const targets = parseList(args.targets, ["MT3", "MT5", "MT7", "MT11"]);
  const results = targets.map((targetFloor) => runStage(project, targetFloor, args));
  const failures = validateResults(results, args);
  const summary = {
    semantics: "static heuristic beam-search acceptance; liveReplayMatched is false unless a live verifier is run separately",
    gate: {
      minProgressFloor: args["min-progress-floor"] || null,
      failOnMiss: parseBooleanFlag(args["fail-on-miss"], false),
      failures,
    },
    results,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (parseBooleanFlag(args["fail-on-regress"], true) && failures.length > 0) process.exitCode = 2;
}

main();
