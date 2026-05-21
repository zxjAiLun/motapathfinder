"use strict";

const path = require("node:path");

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { loadProject } = require("./lib/project-loader");
const { runProgressiveMonsterPlanner } = require("./lib/progressive-monster-planner");
const { buildRouteRecord, readRouteFile, writeRouteFile } = require("./lib/route-store");
const { StaticSimulator } = require("./lib/simulator");

const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");

function parseArgs(argv) {
  return argv.reduce((result, arg) => {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) result[match[1]] = match[2];
    return result;
  }, {});
}

function optionalNumber(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseList(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function makeSimulator(project) {
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
  });
}

function enumerateAllActions(simulator, state) {
  const actions = [];
  try {
    actions.push(...(simulator.enumeratePrimitiveActions(state).actions || []));
  } catch (error) {
  }
  try {
    actions.push(...(simulator.enumerateActions(state) || []));
  } catch (error) {
  }
  try {
    if (typeof simulator.enumerateInteractPickupActions === "function") {
      actions.push(...(simulator.enumerateInteractPickupActions(state) || []));
    }
  } catch (error) {
  }
  try {
    if (typeof simulator.enumerateFloorFlyActions === "function") {
      actions.push(...(simulator.enumerateFloorFlyActions(state) || []));
    }
  } catch (error) {
  }
  return actions;
}

function findAction(simulator, state, summary) {
  return enumerateAllActions(simulator, state).find((action) => action.summary === summary) || null;
}

function replayRouteFile(simulator, routeFile, rank) {
  const record = readRouteFile(routeFile);
  let state = simulator.createInitialState({ rank });
  for (const decision of record.decisions || []) {
    const action = findAction(simulator, state, decision.summary);
    if (!action) throw new Error(`Unable to replay start route at ${decision.index}: ${decision.summary}`);
    state = simulator.applyAction(state, action);
  }
  return state;
}

function heroSummary(state) {
  const hero = (state || {}).hero || {};
  return {
    hp: Number(hero.hp || 0),
    atk: Number(hero.atk || 0),
    def: Number(hero.def || 0),
    mdef: Number(hero.mdef || 0),
    lv: Number(hero.lv || 0),
    exp: Number(hero.exp || 0),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = path.resolve(args["project-root"] || DEFAULT_PROJECT_ROOT);
  const project = loadProject(projectRoot);
  const simulator = makeSimulator(project);
  const rank = args.rank || "chaos";
  const startRoute = args["start-route"] ? path.resolve(args["start-route"]) : null;
  const initialState = startRoute
    ? replayRouteFile(simulator, startRoute, rank)
    : simulator.createInitialState({ rank });

  const result = runProgressiveMonsterPlanner(simulator, initialState, {
    allowedFloors: parseList(args["allowed-floors"]),
    targetFloorId: args["target-floor"] || null,
    maxRounds: optionalNumber(args["max-rounds"]),
    beamWidth: optionalNumber(args.beam),
    maxTargetsPerState: optionalNumber(args["max-targets"]),
    maxSuccessorsPerTarget: optionalNumber(args["max-successors"]),
    maxRuntimeMs: optionalNumber(args["max-runtime-ms"]),
    maxHeapMb: optionalNumber(args["max-heap-mb"]),
    noProgressRounds: optionalNumber(args["no-progress-rounds"]),
    maxOracleFloorEntries: optionalNumber(args["max-oracle-floor-entries"]),
    maxPortalDepth: optionalNumber(args["max-portal-depth"]),
    specialTargets: parseList(args["special-targets"]),
  });

  const summary = {
    found: result.found,
    finalFloorId: result.bestState && result.bestState.floorId,
    bestHero: heroSummary(result.bestState),
    routeLength: (result.bestRoute || []).length,
    checkpoints: result.checkpoints,
    diagnostics: result.diagnostics,
  };
  console.log(JSON.stringify(summary, null, 2));

  const out = args.out ? path.resolve(args.out) : null;
  if (out && result.bestState) {
    const finalState = result.bestState;
    const prefixLength = startRoute && Array.isArray(initialState.route) ? initialState.route.length : 0;
    finalState.route = prefixLength > 0 ? result.bestRoute.slice(prefixLength) : result.bestRoute.slice();
    const routeRecord = buildRouteRecord({
      project,
      simulator,
      initialState: startRoute ? initialState : undefined,
      finalState,
      options: {
        projectRoot,
        solver: "progressive-monster-planner",
        profile: "progressive-monster-planner",
        rank,
        toFloor: finalState.floorId,
        goalType: "progressive-monster-planner",
        metadata: {
          kind: "progressive-monster-planner",
          progressiveMonsterPlanner: {
            found: result.found,
            checkpoints: result.checkpoints,
            diagnostics: result.diagnostics,
          },
        },
      },
    });
    writeRouteFile(out, routeRecord);
    console.log(`Route written: ${out}`);
  }
}

main();
