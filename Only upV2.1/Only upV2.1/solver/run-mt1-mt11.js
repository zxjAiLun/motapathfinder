"use strict";

const path = require("path");

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { evaluateExpression } = require("./lib/expression");
const { loadProject } = require("./lib/project-loader");
const { formatScore, getFloorOrder } = require("./lib/score");
const { searchTopK } = require("./lib/search");
const { createSearchProfile } = require("./lib/search-profiles");
const { summarizeStageObjective } = require("./lib/stage-policy");
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

function summarizeAction(action) {
  const details = [];
  if (action.stance) details.push(`from=${action.stance.x},${action.stance.y}`);
  if (action.target) details.push(`to=${action.target.x},${action.target.y}`);
  else if (action.x != null && action.y != null) details.push(`to=${action.x},${action.y}`);
  if (action.direction) details.push(`dir=${action.direction}`);
  if (action.tool) details.push(`tool=${action.tool}`);
  if (action.estimate) {
    details.push(`dmg=${Number(action.estimate.damage || 0)}`);
    if (action.estimate.hpDelta != null) details.push(`hpDelta=${Number(action.estimate.hpDelta || 0)}`);
    details.push(`exp=${Number(action.estimate.exp || 0)}`);
    details.push(`money=${Number(action.estimate.money || 0)}`);
    if (action.estimate.lv) details.push(`lvDelta=${Number(action.estimate.lv || 0)}`);
    if (action.estimate.score) details.push(`score=${Math.round(Number(action.estimate.score || 0))}`);
  }
  const plan = Array.isArray(action.plan) ? ` plan=[${action.plan.join(" -> ")}]` : "";
  return `${action.kind}: ${action.summary}${details.length ? ` (${details.join(" ")})` : ""}${plan}`;
}


function summarizeReplayConfidence(state, liveVerified) {
  if (!state) {
    return {
      liveVerified: false,
      status: "no-state",
      verifiedFloor: null,
      routeLength: 0,
      unsupportedNoteCount: 0,
      unsupportedNotesPreview: [],
    };
  }
  const notes = state.notes || [];
  const unsupportedNotes = notes.filter((note) => /unsupported|未支持|not supported/i.test(String(note)));
  return {
    liveVerified: Boolean(liveVerified),
    status: liveVerified ? "live-verified" : "not-live-verified",
    verifiedFloor: liveVerified ? state.floorId : null,
    solverFloor: state.floorId,
    routeLength: Array.isArray(state.route) ? state.route.length : 0,
    unsupportedNoteCount: unsupportedNotes.length,
    unsupportedNotesPreview: unsupportedNotes.slice(0, 5),
    hazardStats: state.meta && state.meta.hazardStats ? state.meta.hazardStats : null,
  };
}

function printActionsForState(label, simulator, state, limit) {
  if (!state) return;
  const actions = simulator.enumerateActions(state);
  const grouped = actions.reduce((result, action) => {
    const key = action.kind === "useTool" && action.tool ? `${action.kind}:${action.tool}` : action.kind;
    result[key] = Number(result[key] || 0) + 1;
    return result;
  }, {});
  console.log(`${label} actions (${actions.length}): ${JSON.stringify(grouped)}`);
  actions.slice(0, limit || 40).forEach((action, index) => {
    console.log(`  ${String(index + 1).padStart(2, "0")}. ${summarizeAction(action)}`);
  });
}

function getNextLevelInfo(project, state) {
  const entries = (((project || {}).data || {}).firstData || {}).levelUp || [];
  const level = Number((state.hero || {}).lv || 0);
  const next = entries[level] || null;
  if (!next) return null;
  const need = Number(evaluateExpression(next.need, project, state, { floorId: state.floorId }) || 0);
  const exp = Number((state.hero || {}).exp || 0);
  return {
    level,
    exp,
    need,
    deficit: Math.max(0, need - exp),
  };
}

function summarizeNextGateDeficit(project, simulator, state) {
  if (!state) return null;
  const currentFloorOrder = getFloorOrder(state.floorId);
  const actions = simulator.enumerateActions(state);
  const forwardChangeFloors = actions.filter((action) => {
    if (action.kind !== "changeFloor") return false;
    const targetFloorId = action.changeFloor && action.changeFloor.floorId;
    if (targetFloorId === ":next") return true;
    return getFloorOrder(targetFloorId) > currentFloorOrder;
  });
  const battleActions = actions.filter((action) => action.kind === "battle");
  const resourcePocketActions = actions.filter((action) => action.kind === "resourcePocket");
  const fightToLevelUpActions = actions.filter((action) => action.kind === "fightToLevelUp");
  const totalAvailableExp = battleActions.reduce((sum, action) => sum + Number((action.estimate || {}).exp || 0), 0);
  const totalAvailableDamage = battleActions.reduce((sum, action) => sum + Number((action.estimate || {}).damage || 0), 0);
  const minDamageBattle = battleActions.reduce((best, action) => {
    if (!best) return action;
    return Number((action.estimate || {}).damage || 0) < Number((best.estimate || {}).damage || 0) ? action : best;
  }, null);
  const nextLevel = getNextLevelInfo(project, state);
  const reasons = [];
  if (forwardChangeFloors.length === 0) reasons.push("no-forward-changeFloor-action");
  if (nextLevel && nextLevel.deficit > 0 && totalAvailableExp < nextLevel.deficit) reasons.push("insufficient-visible-exp-for-levelup");
  if (battleActions.length === 0) reasons.push("no-visible-battle-actions");

  return {
    floorId: state.floorId,
    currentFloorOrder,
    forwardChangeFloorCount: forwardChangeFloors.length,
    forwardChangeFloors: forwardChangeFloors.map((action) => action.summary),
    visibleBattleCount: battleActions.length,
    resourcePocketCount: resourcePocketActions.length,
    fightToLevelUpCount: fightToLevelUpActions.length,
    resourcePockets: resourcePocketActions.slice(0, 5).map((action) => ({
      summary: action.summary,
      exp: Number((action.estimate || {}).exp || 0),
      hpDelta: Number((action.estimate || {}).hpDelta || 0),
      lv: Number((action.estimate || {}).lv || 0),
      stopReasons: (action.estimate || {}).stopReasons || [],
      plan: action.plan || [],
    })),
    fightToLevelUps: fightToLevelUpActions.slice(0, 5).map((action) => ({
      summary: action.summary,
      exp: Number((action.estimate || {}).exp || 0),
      damage: Number((action.estimate || {}).damage || 0),
      plan: action.plan || [],
    })),
    totalAvailableExp,
    totalAvailableDamage,
    minDamageBattle: minDamageBattle ? {
      summary: minDamageBattle.summary,
      damage: Number((minDamageBattle.estimate || {}).damage || 0),
      exp: Number((minDamageBattle.estimate || {}).exp || 0),
    } : null,
    nextLevel,
    reasons,
  };
}

function printStateSummary(label, simulator, state, options) {
  if (!state) return;
  const config = options || {};
  console.log(
    `${label}: floor=${state.floorId} hp=${state.hero.hp} atk=${state.hero.atk} def=${state.hero.def} mdef=${state.hero.mdef} ` +
      `score=${formatScore(simulator.score(state))} decisions=${getDecisionDepth(state)} routeLen=${state.route.length}`
  );
  if (state.meta && state.meta.hazardStats) {
    console.log(`Hazards: ${JSON.stringify(state.meta.hazardStats)}`);
  }
  if (config.printBestRoute) {
    state.route.forEach((step) => console.log(`  ${step}`));
  }
  const notes = Object.keys(countNotes(state.notes || []));
  if (notes.length > 0) {
    console.log("Notes:");
    notes.slice(0, 12).forEach((note) => console.log(`  ${note}`));
  }
}

function printProgressDebug(project, simulator, result, args) {
  const bestProgressState = result.bestProgressState || result.bestSeenState;
  if (parseBooleanFlag(args["print-best-progress-route"], false)) {
    printStateSummary("Best progress", simulator, bestProgressState, { printBestRoute: true });
  }
  if (parseBooleanFlag(args["print-best-progress-actions"], false)) {
    const nextLevel = bestProgressState ? getNextLevelInfo(project, bestProgressState) : null;
    if (nextLevel) {
      console.log(`Best progress next level: lv=${nextLevel.level} exp=${nextLevel.exp} need=${nextLevel.need} deficit=${nextLevel.deficit}`);
    }
    printActionsForState("Best progress", simulator, bestProgressState, Number(args["action-limit"] || 60));
  }
  if (parseBooleanFlag(args["print-stage-objective"], parseBooleanFlag(args.diagnostics, false))) {
    console.log(`Stage objective: ${JSON.stringify(summarizeStageObjective(simulator, bestProgressState, { targetFloorId: args["to-floor"] || simulator.stopFloorId }))}`);
  }
  if (parseBooleanFlag(args["print-next-gate-deficit"], false)) {
    console.log(`Next gate deficit: ${JSON.stringify(summarizeNextGateDeficit(project, simulator, bestProgressState))}`);
  }
  if (parseBooleanFlag(args.perf, false) && result.diagnostics && result.diagnostics.perf) {
    console.log(`Perf: ${JSON.stringify(result.diagnostics.perf)}`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = path.resolve(__dirname, "..");
  const project = loadProject(projectRoot);
  const targetFloor = args["to-floor"] || "MT11";
  const profileName = args.profile || "default";
  const stagePolicyDefault = profileName.indexOf("stage-mt1-mt11") === 0;

  const simulator = new StaticSimulator(project, {
    stopFloorId: targetFloor,
    battleResolver: new FunctionBackedBattleResolver(project),
    autoPickupEnabled: parseBooleanFlag(args["auto-pickup"], true),
    autoBattleEnabled: parseBooleanFlag(args["auto-battle"], true),
    enableFightToLevelUp: parseBooleanFlag(args["fight-to-levelup"], stagePolicyDefault),
    enableResourcePocket: parseBooleanFlag(args["resource-pocket"], stagePolicyDefault),
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

  const profile = createSearchProfile(profileName, simulator, {
    maxActionsPerState: parseOptionalNumber(args["max-actions-per-state"]),
    perStateLimit: parseOptionalNumber(args["per-state-limit"]),
    targetFloorId: targetFloor,
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
    safeDominanceMode: parseBooleanFlag(args["safe-dominance-mode"], true),
  });

  console.log(`Expansions: ${result.expansions}`);
  console.log(`Frontier remaining: ${result.frontierSize}`);
  if (parseBooleanFlag(args.diagnostics, false)) {
    console.log(`Registered states: ${result.diagnostics.registered}`);
    console.log(`Trimmed states: ${result.diagnostics.trimmed}`);
    console.log(`Skipped states: ${JSON.stringify(result.diagnostics.skipped)}`);
    if (parseBooleanFlag(args["print-action-stats"], false)) {
      console.log(`Action stats: ${JSON.stringify(result.diagnostics.byActionType)}`);
      console.log(`Action role stats: ${JSON.stringify(result.diagnostics.byActionRole)}`);
      console.log(`Floor stats: ${JSON.stringify(result.diagnostics.byFloor)}`);
      console.log(`Stage stats: ${JSON.stringify(result.diagnostics.byStage)}`);
      console.log(`Suspicious stats: ${JSON.stringify(result.diagnostics.suspicious)}`);
      console.log(`Safe dominance stats: ${JSON.stringify(result.diagnostics.safeDominance || {})}`);
      console.log(`Frontier stats: ${JSON.stringify(result.diagnostics.frontier || {})}`);
      console.log(`Dropped progress actions: ${JSON.stringify(result.diagnostics.droppedProgressActions || {})}`);
    }
    printStateSummary("Best seen", simulator, result.bestSeenState, {
      printBestRoute: parseBooleanFlag(args["print-best-route"], false),
    });
    console.log(`Best seen replay confidence: ${JSON.stringify(summarizeReplayConfidence(result.bestSeenState, false))}`);
    console.log(`Best progress replay confidence: ${JSON.stringify(summarizeReplayConfidence(result.bestProgressState, false))}`);
    printProgressDebug(project, simulator, result, args);
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
    console.log(`  replayConfidence=${JSON.stringify(summarizeReplayConfidence(state, false))}`);
    state.route.forEach((step) => console.log(`  ${step}`));
  });
}

if (require.main === module) {
  main();
}
