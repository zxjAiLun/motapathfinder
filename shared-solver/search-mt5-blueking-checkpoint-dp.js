"use strict";

const path = require("node:path");

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { formatActionLabel } = require("./lib/enemy-labels");
const { loadProject } = require("./lib/project-loader");
const { readRouteFile, buildRouteRecord, writeRouteFile } = require("./lib/route-store");
const { searchDP } = require("./lib/dp-search");
const { DIRECTIONS, DIRECTION_DELTAS, coordinateKey } = require("./lib/reachability");
const { StaticSimulator } = require("./lib/simulator");
const { getTileDefinitionAt } = require("./lib/state");

const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const DEFAULT_START_ROUTE = path.join(__dirname, "routes", "fixtures", "mt1-mt3-i893-hp8425.route.json");
const DEFAULT_OUT_ROUTE = path.join(__dirname, "routes", "latest", "mt5-blueking-checkpoint-dp.route.json");
const TARGET = { floorId: "MT5", x: 6, y: 7, enemyId: "blueKing", name: "织光仙子" };
const ALLOWED_FLOORS = new Set(["MT3", "MT4", "MT5"]);
const ALLOWED_STAIRS = new Set([
  "changeFloor@MT3:6,0",
  "changeFloor@MT4:6,0",
  "changeFloor@MT4:6,12",
  "changeFloor@MT5:6,12",
]);

function parseArgs(argv) {
  return argv.reduce((result, arg) => {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) result[match[1]] = match[2];
    return result;
  }, {});
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function string(value, fallback) {
  return value == null || value === "" ? fallback : String(value);
}

function makeSimulator(projectRoot) {
  const project = loadProject(projectRoot);
  return new StaticSimulator(project, {
    stopFloorId: "MT6",
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

function primitiveActions(simulator, state) {
  return simulator.enumeratePrimitiveActions(state).actions || [];
}

function enumerateAllowedStairActions(simulator, state) {
  const floor = simulator.project.floorsById && simulator.project.floorsById[state.floorId];
  const changes = (floor && floor.changeFloor) || {};
  if (!Object.keys(changes).length) return [];
  let reachability;
  try {
    reachability = simulator.getWalkReachability(state);
  } catch (error) {
    return [];
  }
  const bestBySummary = new Map();
  for (const node of Object.values((reachability && reachability.visited) || {})) {
    const nodeState = node.state || state;
    for (const direction of DIRECTIONS) {
      const delta = DIRECTION_DELTAS[direction];
      const targetX = Number(node.x) + delta.x;
      const targetY = Number(node.y) + delta.y;
      const changeFloor = changes[coordinateKey(targetX, targetY)];
      if (!changeFloor) continue;
      const summary = `changeFloor@${nodeState.floorId}:${targetX},${targetY}`;
      if (!ALLOWED_STAIRS.has(summary)) continue;
      const action = {
        kind: "changeFloor",
        floorId: nodeState.floorId,
        stance: { x: node.x, y: node.y },
        direction,
        x: targetX,
        y: targetY,
        path: Array.isArray(node.path) ? node.path.slice() : [],
        travelState: nodeState,
        changeFloor,
        summary,
      };
      const existing = bestBySummary.get(summary);
      if (!existing || (action.path || []).length < (existing.path || []).length) {
        bestBySummary.set(summary, action);
      }
    }
  }
  return Array.from(bestBySummary.values());
}

function enumerateDpActions(simulator, state) {
  const battleActions = simulator.enumerateBattleActionsOnly(state);
  const equipActions = simulator.equipmentResolver.enumerateActions({
    project: simulator.project,
    state,
  });
  return battleActions.concat(equipActions, enumerateAllowedStairActions(simulator, state));
}

function findAction(simulator, state, summary) {
  return primitiveActions(simulator, state).find((action) => action.summary === summary)
    || simulator.enumerateActions(state).find((action) => action.summary === summary)
    || null;
}

function replayRoute(simulator, routeFile) {
  let state = simulator.createInitialState({ rank: "chaos" });
  const prefix = [];
  for (const decision of readRouteFile(routeFile).decisions || []) {
    const action = findAction(simulator, state, decision.summary);
    if (!action) throw new Error(`Unable to replay ${decision.summary}`);
    state = simulator.applyAction(state, action, { storeRoute: false });
    prefix.push(decision.summary);
  }
  state.route = prefix;
  return state;
}

function allowedAction(action, state) {
  if (!action) return false;
  if (action.kind === "changeFloor") return ALLOWED_STAIRS.has(action.summary);
  if (!ALLOWED_FLOORS.has(action.floorId || state.floorId)) return false;
  return action.kind === "battle" || action.kind === "equip";
}

function isTargetDefeated(project, state) {
  return getTileDefinitionAt(project, state, TARGET.floorId, TARGET.x, TARGET.y) == null;
}

function compactHero(state) {
  const hero = state.hero || {};
  return {
    floorId: state.floorId,
    hp: hero.hp,
    atk: hero.atk,
    def: hero.def,
    mdef: hero.mdef,
    lv: hero.lv,
    exp: hero.exp,
    loc: hero.loc,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = path.resolve(args["project-root"] || DEFAULT_PROJECT_ROOT);
  const startRouteFile = path.resolve(args["start-route"] || DEFAULT_START_ROUTE);
  const outRouteFile = path.resolve(args.out || DEFAULT_OUT_ROUTE);
  const simulator = makeSimulator(projectRoot);
  const initialState = replayRoute(simulator, startRouteFile);
  const result = searchDP(simulator, initialState, {
    maxExpansions: number(args["max-expansions"], 5000),
    maxRuntimeMs: number(args["time-limit-ms"], 15000),
    maxActionsPerState: number(args["max-actions-per-state"], 9999),
    dpKeyMode: string(args["dp-key-mode"], "mutation"),
    dpAgendaMode: string(args["dp-agenda"], "best-first"),
    dpPriorityMode: string(args["dp-priority-mode"], "combat-first"),
    stopOnFirstGoal: args["stop-on-first-goal"] !== "0",
    targetFloorId: "MT5",
    actionProvider: enumerateDpActions,
    actionFilter: allowedAction,
    goalPredicate: (state) => isTargetDefeated(simulator.project, state),
  });
  const finalState = result.bestGoalState || result.bestSeenState || result.bestProgressState;
  let routeWriteError = null;
  if (finalState) {
    try {
      const routeRecord = buildRouteRecord({
        project: simulator.project,
        simulator,
        finalState,
        options: {
          projectRoot,
          solver: "mt5-blueking-checkpoint-dp",
          profile: "mt3-mt5-bounded-dp",
          rank: "chaos",
          toFloor: "MT5",
          goalType: result.bestGoalState ? "defeat-tile" : "best-progress",
          expanded: result.expansions,
          generated: result.diagnostics && result.diagnostics.generated,
          metadata: {
            kind: result.bestGoalState ? "best-goal-under-budget" : "best-seen",
            target: TARGET,
            allowedFloors: Array.from(ALLOWED_FLOORS),
            allowedStairs: Array.from(ALLOWED_STAIRS),
            allowedActionKinds: ["battle", "equip", "changeFloor"],
            dp: result.diagnostics && result.diagnostics.dp,
          },
        },
      });
      writeRouteFile(outRouteFile, routeRecord);
    } catch (error) {
      routeWriteError = error;
    }
  }

  console.log(JSON.stringify({
    found: Boolean(result.bestGoalState),
    routeFile: finalState && !routeWriteError ? path.relative(process.cwd(), outRouteFile) : null,
    routeWriteError: routeWriteError ? routeWriteError.message : null,
    expansions: result.expansions,
    frontierRemaining: result.frontierSize,
    diagnostics: {
      dp: result.diagnostics && result.diagnostics.dp,
      skipped: result.diagnostics && result.diagnostics.skipped,
      byActionType: result.diagnostics && result.diagnostics.byActionType,
    },
    final: finalState ? compactHero(finalState) : null,
    routeTail: finalState && Array.isArray(finalState.route)
      ? finalState.route.slice(-30).map((summary) => formatActionLabel(simulator.project, summary))
      : [],
  }, null, 2));
}

if (require.main === module) main();
