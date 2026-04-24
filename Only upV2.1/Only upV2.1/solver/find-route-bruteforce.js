"use strict";

const path = require("path");

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { loadProject } = require("./lib/project-loader");
const { buildRouteRecord, writeRouteFile } = require("./lib/route-store");
const { searchExhaustiveParallel } = require("./lib/exhaustive-parallel");
const { searchTopK } = require("./lib/search");
const { createSearchProfile } = require("./lib/search-profiles");
const { StaticSimulator } = require("./lib/simulator");
const { getDecisionDepth } = require("./lib/state");

function parseArgs(argv) {
  return argv.reduce((result, token) => {
    const flag = token.match(/^--([^=]+)$/);
    if (flag) {
      result[flag[1]] = "1";
      return result;
    }
    const match = token.match(/^--([^=]+)=(.*)$/);
    if (match) result[match[1]] = match[2];
    return result;
  }, {});
}

function parseBooleanFlag(value, defaultValue) {
  if (value == null) return defaultValue;
  if (value === "1" || value === "true" || value === "on") return true;
  if (value === "0" || value === "false" || value === "off") return false;
  return defaultValue;
}

function parseOptionalNumber(value) {
  if (value == null) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function summarizeState(state) {
  if (!state) return "none";
  return `floor=${state.floorId} hp=${state.hero.hp} atk=${state.hero.atk} def=${state.hero.def} mdef=${state.hero.mdef} decisions=${getDecisionDepth(state)} routeLen=${(state.route || []).length}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const solverRoot = __dirname;
  const projectRoot = path.resolve(__dirname, "..");
  const project = loadProject(projectRoot);
  const toFloor = args["to-floor"] || "MT11";
  const profileName = args.profile || "stage-mt1-mt11";
  const rank = args.rank || "chaos";
  const stagePolicyDefault = profileName.indexOf("stage-mt1-mt11") === 0;
  const maxDepth = parseOptionalNumber(args["max-depth"]);

  const simulator = new StaticSimulator(project, {
    stopFloorId: toFloor,
    battleResolver: new FunctionBackedBattleResolver(project),
    autoPickupEnabled: parseBooleanFlag(args["auto-pickup"], true),
    autoBattleEnabled: parseBooleanFlag(args["auto-battle"], true),
    enableFightToLevelUp: parseBooleanFlag(args["fight-to-levelup"], stagePolicyDefault),
    enableResourcePocket: parseBooleanFlag(args["resource-pocket"], stagePolicyDefault),
  });
  const initialState = simulator.createInitialState({ rank });
  const profile = createSearchProfile(profileName, simulator, {
    maxActionsPerState: parseOptionalNumber(args["max-actions-per-state"]),
    perStateLimit: parseOptionalNumber(args["per-state-limit"]),
    targetFloorId: toFloor,
  });

  const algorithm = args.algorithm || (args.workers != null ? "bfs" : "topk");
  const result = algorithm === "bfs"
    ? await searchExhaustiveParallel(simulator, initialState, {
        projectRoot,
        toFloor,
        workers: parseOptionalNumber(args.workers),
        workerChunkSize: parseOptionalNumber(args["worker-chunk-size"]),
        maxExpanded: Number(args["max-expanded"] || args["max-expansions"] || 200000),
        maxDepth: maxDepth == null ? 300 : maxDepth,
        perf: parseBooleanFlag(args.perf, false),
        autoPickupEnabled: parseBooleanFlag(args["auto-pickup"], true),
        autoBattleEnabled: parseBooleanFlag(args["auto-battle"], true),
        enableFightToLevelUp: parseBooleanFlag(args["fight-to-levelup"], stagePolicyDefault),
        enableResourcePocket: parseBooleanFlag(args["resource-pocket"], stagePolicyDefault),
      })
    : searchTopK(simulator, initialState, {
        ...profile,
        topK: Number(args["top-k"] || 3),
        maxExpansions: Number(args["max-expanded"] || args["max-expansions"] || 200),
        beamWidth: parseOptionalNumber(args["beam-width"]),
        perFloorBeamWidth: parseOptionalNumber(args["per-floor-beam-width"]),
        perRegionBeamWidth: parseOptionalNumber(args["per-region-beam-width"]),
        maxActionsPerState: parseOptionalNumber(args["max-actions-per-state"]) != null ? parseOptionalNumber(args["max-actions-per-state"]) : profile.maxActionsPerState,
        disableDominance: parseBooleanFlag(args["disable-dominance"], false),
        dominanceMode: args["dominance-mode"],
        safeDominanceMode: parseBooleanFlag(args["safe-dominance-mode"], true),
        perf: parseBooleanFlag(args.perf, false),
        selectStateActions: maxDepth == null ? profile.selectStateActions : (state, actions, options) => {
          if (getDecisionDepth(state) >= maxDepth) return [];
          if (typeof profile.selectStateActions === "function") return profile.selectStateActions(state, actions, options);
          if (options && options.maxActionsPerState != null) return actions.slice(0, Number(options.maxActionsPerState));
          return actions;
        },
      });

  if (!result.foundGoal || !result.goalState) {
    console.log(`No terminal ${toFloor} route found under profile=${profileName}, expanded=${result.expansions}.`);
    if (result.bestProgressState || result.bestSeenState) {
      console.log(`Best progress: ${summarizeState(result.bestProgressState)}`);
      console.log(`Best seen: ${summarizeState(result.bestSeenState)}`);
    }
    if (result.stats) console.log(`Stats: ${JSON.stringify(result.stats)}`);
    if (parseBooleanFlag(args["fail-on-miss"], false)) process.exitCode = 1;
    return;
  }

  const outPath = path.resolve(solverRoot, args.out || `routes/latest/mt1-${toFloor.toLowerCase()}.route.json`);
  const record = buildRouteRecord({
    project,
    simulator,
    initialState,
    finalState: result.goalState,
    options: {
      projectRoot,
      toFloor,
      profile: profileName,
      rank,
      solver: "bruteforce",
      expanded: result.expansions,
      generated: (result.diagnostics && result.diagnostics.generated) || (result.stats && result.stats.generated),
    },
  });
  writeRouteFile(outPath, record);

  const hero = record.final.snapshot.hero;
  console.log(`Route written: ${path.relative(solverRoot, outPath)}`);
  console.log(`Decisions: ${record.decisions.length}`);
  console.log(`Expansions: ${result.expansions}`);
  console.log(`Final: floor=${record.final.floorId} hp=${hero.hp} atk=${hero.atk} def=${hero.def} mdef=${hero.mdef}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  });
}
