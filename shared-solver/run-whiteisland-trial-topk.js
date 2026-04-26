"use strict";

const fs = require("fs");
const path = require("path");

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { buildConfluenceDominanceOptions, buildResourceChainOptions, buildResourceClusterSearchOptions, buildResourcePocketSearchOptions, parseBooleanFlag, parseKeyValueArgs, parseOptionalNumber, resolveProjectRoot, shouldEnableResourceChain, shouldEnableResourceCluster, shouldEnableResourcePocket } = require("./lib/cli-options");
const { executeActionList } = require("./lib/events");
const { findContiguousTowerTerminalFloor } = require("./lib/floor-id");
const { loadProject } = require("./lib/project-loader");
const { buildRouteRecord, writeRouteFile } = require("./lib/route-store");
const { searchTopK } = require("./lib/search");
const { createSearchProfile } = require("./lib/search-profiles");
const { getDecisionDepth } = require("./lib/state");
const { StaticSimulator } = require("./lib/simulator");

function ensureTrialStart(project, simulator, rank) {
  let state = simulator.createInitialState({ rank });
  const startFloor = project.floorsById.Start;
  const choiceEvent = (((startFloor.events || {})["3,3"] || [])[0] || {}).choices || [];
  const trialChoice = choiceEvent.find((choice) => choice.text === "试炼间");
  if (!trialChoice) throw new Error("Cannot find Start 3,3 choice: 试炼间");

  executeActionList(project, state, trialChoice.action || [], { floorId: "Start" }, {
    choiceResolver: simulator.choiceResolver,
  });
  return simulator.stabilizeState(state);
}

function summarizeState(state) {
  if (!state) return null;
  return {
    floorId: state.floorId,
    winReason: state.meta && state.meta.winReason,
    decisions: getDecisionDepth(state),
    routeLength: Array.isArray(state.route) ? state.route.length : 0,
    hero: {
      hp: state.hero.hp,
      atk: state.hero.atk,
      def: state.hero.def,
      mdef: state.hero.mdef,
      lv: state.hero.lv,
      exp: state.hero.exp,
      money: state.hero.money,
      loc: state.hero.loc,
    },
  };
}

function writeStateRoute(project, simulator, initialState, finalState, outPath, options) {
  if (!finalState || !outPath) return;
  const record = buildRouteRecord({
    project,
    simulator,
    initialState,
    finalState,
    options,
  });
  writeRouteFile(outPath, record);
}

async function main() {
  const args = parseKeyValueArgs(process.argv.slice(2));
  const projectRoot = resolveProjectRoot(args, path.resolve(__dirname, ".."));
  const project = loadProject(projectRoot);
  const rank = args.rank || "chaos";
  const topK = Number(args["top-k"] || 3);
  const maxExpansions = Number(args["max-expansions"] || 5000);
  const profileName = args.profile || "default";
  const goalType = args.goal || "win";
  let targetFloorId = args["to-floor"] || null;
  const outDir = path.resolve(projectRoot, args["out-dir"] || "routes/latest");

  const simulator = new StaticSimulator(project, {
    stopFloorId: targetFloorId || "A3",
    battleResolver: new FunctionBackedBattleResolver(project, {
      autoLevelUp: parseBooleanFlag(args["auto-levelup"], false),
    }),
    autoPickupEnabled: parseBooleanFlag(args["auto-pickup"], true),
    autoBattleEnabled: parseBooleanFlag(args["auto-battle"], true),
    enableResourcePocket: shouldEnableResourcePocket(args, true),
    enableResourceChain: shouldEnableResourceChain(args, false),
    enableResourceCluster: shouldEnableResourceCluster(args, true),
    resourcePocketSearchOptions: buildResourcePocketSearchOptions(args),
    resourceChainOptions: buildResourceChainOptions(args),
    resourceClusterOptions: buildResourceClusterSearchOptions(args),
  });
  if (goalType === "win") {
    simulator.isTerminal = (state) => Boolean(state.meta && state.meta.winReason);
  }

  const initialState = ensureTrialStart(project, simulator, rank);
  targetFloorId = targetFloorId || findContiguousTowerTerminalFloor(project, initialState.floorId) || "A3";
  simulator.stopFloorId = targetFloorId;
  const profile = createSearchProfile(profileName, simulator, {
    targetFloorId: goalType === "win" ? targetFloorId : simulator.stopFloorId,
    maxActionsPerState: parseOptionalNumber(args["max-actions-per-state"]),
    perStateLimit: parseOptionalNumber(args["per-state-limit"]),
  });
  const searchOptions = {
    ...profile,
    ...buildConfluenceDominanceOptions(args, profile.enableConfluenceHpDominance, profile.confluenceRoutePolicy),
    topK,
    maxExpansions,
    beamWidth: parseOptionalNumber(args["beam-width"]),
    perFloorBeamWidth: parseOptionalNumber(args["per-floor-beam-width"]),
    perRegionBeamWidth: parseOptionalNumber(args["per-region-beam-width"]),
    maxActionsPerState: parseOptionalNumber(args["max-actions-per-state"]) || profile.maxActionsPerState,
    disableDominance: parseBooleanFlag(args["disable-dominance"], false),
    dominanceMode: args["dominance-mode"],
    safeDominanceMode: parseBooleanFlag(args["safe-dominance-mode"], true),
    perf: parseBooleanFlag(args.perf, false),
    parallel: parseBooleanFlag(args.parallel, false),
    workers: parseOptionalNumber(args.workers),
    projectRoot,
    profileName,
    targetFloorId,
    autoPickupEnabled: parseBooleanFlag(args["auto-pickup"], true),
    autoBattleEnabled: parseBooleanFlag(args["auto-battle"], true),
    enableResourcePocket: shouldEnableResourcePocket(args, true),
    enableResourceChain: shouldEnableResourceChain(args, false),
    enableResourceCluster: shouldEnableResourceCluster(args, true),
    resourcePocketSearchOptions: buildResourcePocketSearchOptions(args),
    resourceChainOptions: buildResourceChainOptions(args),
    resourceClusterOptions: buildResourceClusterSearchOptions(args),
  };

  console.log(`Loaded project: ${project.data.firstData.title}`);
  console.log(`Trial entry: Start 3,3 -> 试炼间 -> ${initialState.floorId} ${initialState.hero.loc.x},${initialState.hero.loc.y}`);
  console.log(`Auto features: pickup=${initialState.flags.shiqu !== 0 ? "on" : "off"}, battle=${initialState.flags.autoBattle !== 0 ? "on" : "off"}`);
  console.log(`Goal: ${goalType === "win" ? "win event" : targetFloorId}; topK=${topK}; maxExpansions=${maxExpansions}`);

  const startedAt = Date.now();
  const result = await searchTopK(simulator, initialState, searchOptions);
  const elapsedMs = Date.now() - startedAt;

  fs.mkdirSync(outDir, { recursive: true });
  const summary = {
    createdAt: new Date().toISOString(),
    elapsedMs,
    found: result.results.length,
    expansions: result.expansions,
    frontierSize: result.frontierSize,
    start: summarizeState(initialState),
    results: result.results.map(summarizeState),
    bestProgress: summarizeState(result.bestProgressState || result.bestSeenState),
    diagnostics: result.diagnostics,
  };
  fs.writeFileSync(path.join(outDir, "whiteisland-trial-topk.summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  const routeOptions = {
    projectRoot,
    toFloor: targetFloorId,
    goalType,
    profile: profileName,
    rank,
    solver: "whiteisland-trial-topk",
    expanded: result.expansions,
    generated: result.diagnostics && result.diagnostics.generated,
    snapshotFloors: ["Start", "A1", "A2", "A3"],
  };
  result.results.forEach((state, index) => {
    writeStateRoute(project, simulator, initialState, state, path.join(outDir, `whiteisland-trial-top${index + 1}.route.json`), routeOptions);
  });
  writeStateRoute(project, simulator, initialState, result.bestProgressState || result.bestSeenState, path.join(outDir, "whiteisland-trial-best-progress.route.json"), {
    ...routeOptions,
    metadata: { foundGoal: result.foundGoal },
  });

  console.log(`Search finished: found=${result.results.length}, expansions=${result.expansions}, frontier=${result.frontierSize}, elapsedMs=${elapsedMs}`);
  result.results.forEach((state, index) => {
    console.log(`#${index + 1} ${JSON.stringify(summarizeState(state))}`);
  });
  console.log(`Summary written: ${path.relative(projectRoot, path.join(outDir, "whiteisland-trial-topk.summary.json"))}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  });
}
