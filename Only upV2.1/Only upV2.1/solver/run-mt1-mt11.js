"use strict";

const path = require("path");

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { loadProject } = require("./lib/project-loader");
const { formatScore } = require("./lib/score");
const { searchTopK } = require("./lib/search");
const { createSearchProfile } = require("./lib/search-profiles");
const { StaticSimulator } = require("./lib/simulator");
const { getDecisionDepth } = require("./lib/state");

function parseArgs(argv) {
  return argv.reduce((result, token) => {
    const match = token.match(/^--([^=]+)=(.+)$/);
    if (!match) return result;
    result[match[1]] = match[2];
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

function countNotes(routeOrNotes) {
  return (routeOrNotes || []).reduce((result, note) => {
    result[note] = Number(result[note] || 0) + 1;
    return result;
  }, {});
}

function printActionPreview(actions) {
  const grouped = actions.reduce((result, action) => {
    result[action.kind] = (result[action.kind] || 0) + 1;
    return result;
  }, {});

  console.log("Reachable macro actions:");
  Object.keys(grouped)
    .sort()
    .forEach((kind) => {
      console.log(`  ${kind}: ${grouped[kind]}`);
    });

  actions.slice(0, 12).forEach((action) => {
    const detail =
      action.stance && action.direction
        ? ` from ${action.stance.x},${action.stance.y} -> ${action.direction}`
        : "";
    console.log(`  - ${action.summary}${detail}`);
  });
}

function printStateSummary(label, simulator, state, options) {
  if (!state) return;
  const config = options || {};
  console.log(
    `${label}: floor=${state.floorId} hp=${state.hero.hp} atk=${state.hero.atk} def=${state.hero.def} mdef=${state.hero.mdef} ` +
      `score=${formatScore(simulator.score(state))} decisions=${getDecisionDepth(state)} routeLen=${state.route.length}`
  );
  if (config.printBestRoute) {
    state.route.forEach((step) => console.log(`  ${step}`));
  }
  const notes = Object.keys(countNotes(state.notes || []));
  if (notes.length > 0) {
    console.log("Notes:");
    notes.slice(0, 12).forEach((note) => console.log(`  ${note}`));
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = path.resolve(__dirname, "..");
  const project = loadProject(projectRoot);
  const targetFloor = args["to-floor"] || "MT11";

  const simulator = new StaticSimulator(project, {
    stopFloorId: targetFloor,
    battleResolver: new FunctionBackedBattleResolver(project),
    autoPickupEnabled: parseBooleanFlag(args["auto-pickup"], true),
    autoBattleEnabled: parseBooleanFlag(args["auto-battle"], true),
  });

  const initialState = simulator.createInitialState({
    rank: args.rank || "chaos",
  });

  console.log(`Loaded project: ${project.data.firstData.title}`);
  console.log(`Initial floor: ${initialState.floorId}`);
  console.log(`Initial hero: hp=${initialState.hero.hp}, atk=${initialState.hero.atk}, def=${initialState.hero.def}, mdef=${initialState.hero.mdef}`);
  console.log(`Auto features: pickup=${initialState.flags.shiqu !== 0 ? "on" : "off"}, battle=${initialState.flags.autoBattle !== 0 ? "on" : "off"}`);

  const initialActions = simulator.enumerateActions(initialState);
  printActionPreview(initialActions);

  const profileName = args.profile || "default";
  const profile = createSearchProfile(profileName, simulator, {
    maxActionsPerState: parseOptionalNumber(args["max-actions-per-state"]),
    perStateLimit: parseOptionalNumber(args["per-state-limit"]),
  });
  const maxActionsPerState = parseOptionalNumber(args["max-actions-per-state"]);
  console.log(`Search profile: ${profileName}`);

  const result = searchTopK(simulator, initialState, {
    ...profile,
    topK: Number(args["top-k"] || 3),
    maxExpansions: Number(args["max-expansions"] || 80),
    beamWidth: args["beam-width"] != null ? Number(args["beam-width"]) : undefined,
    perFloorBeamWidth: args["per-floor-beam-width"] != null ? Number(args["per-floor-beam-width"]) : undefined,
    perRegionBeamWidth: args["per-region-beam-width"] != null ? Number(args["per-region-beam-width"]) : undefined,
    maxActionsPerState: maxActionsPerState != null ? maxActionsPerState : profile.maxActionsPerState,
    disableDominance: parseBooleanFlag(args["disable-dominance"], false),
    dominanceMode: args["dominance-mode"],
  });

  console.log(`Expansions: ${result.expansions}`);
  console.log(`Frontier remaining: ${result.frontierSize}`);
  if (parseBooleanFlag(args.diagnostics, false)) {
    console.log(`Registered states: ${result.diagnostics.registered}`);
    console.log(`Trimmed states: ${result.diagnostics.trimmed}`);
    console.log(`Skipped states: ${JSON.stringify(result.diagnostics.skipped)}`);
    if (parseBooleanFlag(args["print-action-stats"], false)) {
      console.log(`Action stats: ${JSON.stringify(result.diagnostics.byActionType)}`);
      console.log(`Floor stats: ${JSON.stringify(result.diagnostics.byFloor)}`);
      console.log(`Stage stats: ${JSON.stringify(result.diagnostics.byStage)}`);
      console.log(`Suspicious stats: ${JSON.stringify(result.diagnostics.suspicious)}`);
    }
    printStateSummary("Best seen", simulator, result.bestSeenState, {
      printBestRoute: parseBooleanFlag(args["print-best-route"], false),
    });
  }

  if (result.results.length === 0) {
    console.log(`No terminal ${targetFloor} state found in the current search budget.`);
    console.log("Battle evaluation and ambush/between-attack walking are active; next gains will come from stronger pruning and more rule coverage.");
    return;
  }

  result.results.forEach((state, index) => {
    console.log(
      `#${index + 1} score=${formatScore(simulator.score(state))} decisions=${getDecisionDepth(state)} routeLen=${state.route.length}`
    );
    state.route.forEach((step) => console.log(`  ${step}`));
  });
}

if (require.main === module) {
  main();
}
