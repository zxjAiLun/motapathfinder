"use strict";

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { loadProject } = require("./lib/project-loader");
const { getProgress } = require("./lib/progress");
const { createSearchProfile } = require("./lib/search-profiles");
const { searchTopK } = require("./lib/search");
const { StaticSimulator } = require("./lib/simulator");

function parseArgs(argv) {
  return argv.reduce((result, token) => {
    const match = token.match(/^--([^=]+)=(.+)$/);
    if (!match) return result;
    result[match[1]] = match[2];
    return result;
  }, {});
}

function parseList(value, fallback) {
  if (!value) return fallback;
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function unsupportedNoteCount(state) {
  return ((state && state.notes) || []).filter((note) => /unsupported|未支持|not supported/i.test(String(note))).length;
}

function runStage(project, targetFloor, args) {
  const simulator = new StaticSimulator(project, {
    stopFloorId: targetFloor,
    battleResolver: new FunctionBackedBattleResolver(project),
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFightToLevelUp: true,
    enableResourcePocket: true,
  });
  const profileName = args.profile || "stage-mt1-mt11";
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
      best: (result.diagnostics || {}).best || {},
    },
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const project = loadProject(__dirname + "/..");
  const targets = parseList(args.targets, ["MT3", "MT5", "MT7", "MT11"]);
  const results = targets.map((targetFloor) => runStage(project, targetFloor, args));
  const summary = {
    semantics: "static heuristic beam-search acceptance; liveReplayMatched is false unless a live verifier is run separately",
    results,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (process.argv.includes("--fail-on-miss") && results.some((result) => !result.foundGoal)) process.exitCode = 2;
}

main();
