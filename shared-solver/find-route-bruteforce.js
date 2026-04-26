"use strict";

const fs = require("fs");
const path = require("path");

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { buildConfluenceDominanceOptions, buildResourcePocketSearchOptions, parseBooleanFlag, parseKeyValueArgs, parseOptionalNumber, resolveProjectRoot, shouldEnableResourcePocket } = require("./lib/cli-options");
const { loadProject } = require("./lib/project-loader");
const { buildRouteRecord, readRouteFile, writeRouteFile } = require("./lib/route-store");
const { searchExhaustiveParallel } = require("./lib/exhaustive-parallel");
const { searchTopK } = require("./lib/search");
const { createSearchProfile } = require("./lib/search-profiles");
const { StaticSimulator } = require("./lib/simulator");
const { getDecisionDepth } = require("./lib/state");

function parseCsv(value) {
  if (!value) return null;
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function parseRegionScopes(value) {
  if (!value) return null;
  return value.split(";").map((entry) => {
    const match = /^([^:]+):(\d+),(\d+),(\d+),(\d+)$/.exec(entry.trim());
    if (!match) throw new Error(`Invalid --region-scope entry: ${entry}`);
    return {
      floorId: match[1],
      x1: Math.min(Number(match[2]), Number(match[4])),
      y1: Math.min(Number(match[3]), Number(match[5])),
      x2: Math.max(Number(match[2]), Number(match[4])),
      y2: Math.max(Number(match[3]), Number(match[5])),
    };
  });
}

function resolveExistingPath(solverRoot, projectRoot, filePath) {
  if (!filePath) return null;
  if (path.isAbsolute(filePath)) return filePath;
  const candidates = [
    path.resolve(process.cwd(), filePath),
    path.resolve(solverRoot, filePath),
    path.resolve(projectRoot, filePath),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[1];
}

function readStateFile(filePath) {
  const state = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!state || !state.floorId || !state.hero || !state.floorStates) {
    throw new Error(`Invalid --start-state JSON: ${filePath}`);
  }
  return state;
}

function summarizeState(state) {
  if (!state) return "none";
  return `floor=${state.floorId} hp=${state.hero.hp} atk=${state.hero.atk} def=${state.hero.def} mdef=${state.hero.mdef} decisions=${getDecisionDepth(state)} routeLen=${(state.route || []).length}`;
}

function findActionForRouteEntry(simulator, state, entry) {
  const actions = simulator.enumerateActions(state);
  if (entry.fingerprint) {
    const matched = actions.find((action) => simulator.getActionFingerprint(action) === entry.fingerprint);
    if (matched) return matched;
  }
  if (entry.summary) return actions.find((action) => action.summary === entry.summary) || null;
  return null;
}

function replayStartRoute(simulator, initialState, routeRecord) {
  const entries = Array.isArray(routeRecord.decisions) && routeRecord.decisions.length > 0
    ? routeRecord.decisions
    : (routeRecord.rawRoute || []).map((summary) => ({ summary }));
  let state = initialState;
  entries.forEach((entry, index) => {
    const action = findActionForRouteEntry(simulator, state, entry);
    if (!action) throw new Error(`Unable to replay --start-route at decision ${index + 1}: ${entry.summary || entry.fingerprint}`);
    state = simulator.applyAction(state, action);
  });
  return state;
}

function buildBfsOptions(args, projectRoot, toFloor, stagePolicyDefault) {
  return {
    projectRoot,
    toFloor,
    toX: parseOptionalNumber(args["to-x"]),
    toY: parseOptionalNumber(args["to-y"]),
    workers: parseOptionalNumber(args.workers),
    workerChunkSize: parseOptionalNumber(args["worker-chunk-size"]),
    maxExpanded: Number(args["max-expanded"] || args["max-expansions"] || 200000),
    maxDepth: parseOptionalNumber(args["max-depth"]) == null ? 300 : parseOptionalNumber(args["max-depth"]),
    frontierCap: parseOptionalNumber(args["frontier-cap"]),
    actionAllowlist: parseCsv(args["action-kind-allow"] || args["action-allowlist"] || args.actions),
    floorScope: parseCsv(args["floor-scope"]),
    regionScopes: parseRegionScopes(args["region-scope"]),
    perf: parseBooleanFlag(args.perf, false),
    autoPickupEnabled: parseBooleanFlag(args["auto-pickup"], true),
    autoBattleEnabled: parseBooleanFlag(args["auto-battle"], true),
    enableFightToLevelUp: parseBooleanFlag(args["fight-to-levelup"], stagePolicyDefault),
    enableResourcePocket: shouldEnableResourcePocket(args, true),
    enableResourceCluster: parseBooleanFlag(args["resource-cluster"], true),
    enableResourceChain: parseBooleanFlag(args["resource-chain"], true),
    resourcePocketSearchOptions: buildResourcePocketSearchOptions(args),
  };
}

function printOracleDiff(result, context) {
  const stats = result.stats || {};
  const goalState = result.goalState || result.finalState || null;
  console.log(`Oracle diff: ${JSON.stringify({
    algorithm: context.algorithm,
    foundGoal: Boolean(result.foundGoal),
    stopReason: stats.stopReason || null,
    incomplete: Boolean(stats.incomplete),
    incompleteReason: stats.incompleteReason || null,
    startFloor: context.initialState && context.initialState.floorId,
    goalFloor: goalState && goalState.floorId,
    decisions: goalState ? getDecisionDepth(goalState) - getDecisionDepth(context.initialState) : null,
    routeLength: Array.isArray(result.route) ? result.route.length : null,
    expanded: result.expansions,
    generated: stats.generated,
    duplicate: stats.duplicate,
    actionFiltered: stats.actionFiltered,
    scopeFiltered: stats.scopeFiltered,
    frontierDropped: stats.frontierDropped,
    floorScope: context.bfsOptions.floorScope || null,
    actionAllowlist: context.bfsOptions.actionAllowlist || null,
  })}`);
}

async function main() {
  const args = parseKeyValueArgs(process.argv.slice(2));
  const solverRoot = __dirname;
  const projectRoot = resolveProjectRoot(args, path.resolve(__dirname, ".."));
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
    enableResourcePocket: shouldEnableResourcePocket(args, true),
    enableResourceCluster: parseBooleanFlag(args["resource-cluster"], true),
    enableResourceChain: parseBooleanFlag(args["resource-chain"], true),
    resourcePocketSearchOptions: buildResourcePocketSearchOptions(args),
  });
  const baseInitialState = simulator.createInitialState({ rank });
  if (args["start-route"] && args["start-state"]) {
    throw new Error("Pass only one of --start-route or --start-state.");
  }
  const startRoutePath = resolveExistingPath(solverRoot, projectRoot, args["start-route"]);
  const startStatePath = resolveExistingPath(solverRoot, projectRoot, args["start-state"]);
  const startRouteRecord = startRoutePath ? readRouteFile(startRoutePath) : null;
  const initialState = startStatePath
    ? readStateFile(startStatePath)
    : (startRouteRecord ? replayStartRoute(simulator, baseInitialState, startRouteRecord) : baseInitialState);
  const profile = createSearchProfile(profileName, simulator, {
    maxActionsPerState: parseOptionalNumber(args["max-actions-per-state"]),
    perStateLimit: parseOptionalNumber(args["per-state-limit"]),
    targetFloorId: toFloor,
  });

  const algorithm = args.algorithm || "bfs";
  if (!["bfs", "topk"].includes(algorithm)) {
    throw new Error(`Unsupported algorithm: ${algorithm}. Expected "bfs" or "topk".`);
  }
  const bfsOptions = buildBfsOptions(args, projectRoot, toFloor, stagePolicyDefault);
  const result = algorithm === "bfs"
    ? await searchExhaustiveParallel(simulator, initialState, bfsOptions)
    : await searchTopK(simulator, initialState, {
        ...profile,
        ...buildConfluenceDominanceOptions(args, profile.enableConfluenceHpDominance, profile.confluenceRoutePolicy),
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
        parallel: parseBooleanFlag(args.parallel, false),
        workers: parseOptionalNumber(args.workers),
        topKBatchSize: parseOptionalNumber(args["topk-batch-size"]),
        workerChunkSize: parseOptionalNumber(args["worker-chunk-size"]),
        projectRoot,
        profileName,
        targetFloorId: toFloor,
        autoPickupEnabled: parseBooleanFlag(args["auto-pickup"], true),
        autoBattleEnabled: parseBooleanFlag(args["auto-battle"], true),
        enableFightToLevelUp: parseBooleanFlag(args["fight-to-levelup"], stagePolicyDefault),
        enableResourcePocket: shouldEnableResourcePocket(args, true),
        enableResourceCluster: parseBooleanFlag(args["resource-cluster"], true),
        enableResourceChain: parseBooleanFlag(args["resource-chain"], true),
        resourcePocketSearchOptions: buildResourcePocketSearchOptions(args),
        maxDepth,
        selectStateActions: maxDepth == null ? profile.selectStateActions : (state, actions, options) => {
          if (getDecisionDepth(state) >= maxDepth) return [];
          if (typeof profile.selectStateActions === "function") return profile.selectStateActions(state, actions, options);
          if (options && options.maxActionsPerState != null) return actions.slice(0, Number(options.maxActionsPerState));
          return actions;
        },
      });

  if (parseBooleanFlag(args["oracle-diff"], false)) {
    printOracleDiff(result, { algorithm, initialState, bfsOptions });
  }

  if (!result.foundGoal || !result.goalState) {
    console.log(`No terminal ${toFloor} route found under profile=${profileName}, expanded=${result.expansions}.`);
    if (result.bestProgressState || result.bestSeenState) {
      console.log(`Best progress: ${summarizeState(result.bestProgressState)}`);
      console.log(`Best seen: ${summarizeState(result.bestSeenState)}`);
    }
    if (result.stats) console.log(`Stats: ${JSON.stringify(result.stats)}`);
    if (result.stats && result.stats.incomplete) {
      console.log(`Incomplete BFS claim: ${result.stats.incompleteReason || result.stats.stopReason}; do not treat this as proof that no route exists.`);
    }
    if (parseBooleanFlag(args["fail-on-miss"], false)) process.exitCode = 1;
    return;
  }

  const outPath = path.resolve(projectRoot, args.out || `routes/latest/mt1-${toFloor.toLowerCase()}.route.json`);
  const record = buildRouteRecord({
    project,
    simulator,
    initialState,
    finalState: result.goalState,
    nodes: result.searchNodes || result.actionEntries || null,
    options: {
      projectRoot,
      toFloor,
      profile: profileName,
      rank,
      solver: "bruteforce",
      startRoute: startRoutePath ? path.relative(projectRoot, startRoutePath) : null,
      startState: startStatePath ? path.relative(projectRoot, startStatePath) : null,
      expanded: result.expansions,
      generated: (result.diagnostics && result.diagnostics.generated) || (result.stats && result.stats.generated),
    },
  });
  writeRouteFile(outPath, record);

  const hero = record.final.snapshot.hero;
  console.log(`Route written: ${path.relative(projectRoot, outPath)}`);
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
