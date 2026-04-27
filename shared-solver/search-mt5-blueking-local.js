"use strict";

const path = require("node:path");

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { formatActionLabel } = require("./lib/enemy-labels");
const { loadProject } = require("./lib/project-loader");
const { readRouteFile, buildRouteRecord, writeRouteFile } = require("./lib/route-store");
const { DIRECTIONS, DIRECTION_DELTAS, coordinateKey, reconstructPath } = require("./lib/reachability");
const { StaticSimulator } = require("./lib/simulator");
const { cloneState, getTileDefinitionAt, listFloorMutationSummary } = require("./lib/state");

const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const DEFAULT_START_ROUTE = path.join(__dirname, "routes", "fixtures", "mt1-mt4-hp6428-best.route.json");
const DEFAULT_OUT_ROUTE = path.join(__dirname, "routes", "latest", "mt5-blueking-local.route.json");
const LOCAL_STAIR_COORDINATE = "6,12";

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

function booleanArg(value, fallback) {
  if (value == null) return fallback;
  if (value === "0" || value === "false" || value === "off") return false;
  if (value === "1" || value === "true" || value === "on") return true;
  return fallback;
}

function stableObject(object) {
  return Object.keys(object || {})
    .sort()
    .reduce((result, key) => {
      const value = object[key];
      if (value == null || value === 0) return result;
      result[key] = value;
      return result;
    }, {});
}

function localMutationSummary(state) {
  return listFloorMutationSummary(state.floorStates || {})
    .filter((entry) => entry.floorId === "MT4" || entry.floorId === "MT5")
    .map((entry) => ({
      floorId: entry.floorId,
      removed: entry.removed,
      replaced: entry.replaced,
    }));
}

function buildRegionSignature(simulator, state, keyMode) {
  if (keyMode !== "region") {
    return {
      regionKey: "",
      reachableEndpointsKey: "",
    };
  }
  try {
    const signature = simulator.buildReachableRegionSignature(state);
    return {
      regionKey: signature.regionKey || "",
      reachableEndpointsKey: signature.reachableEndpointsKey || "",
    };
  } catch (error) {
    const hero = state.hero || {};
    return {
      regionKey: `${state.floorId}:${hero.loc && hero.loc.x},${hero.loc && hero.loc.y}`,
      reachableEndpointsKey: "",
    };
  }
}

function buildLocalDpKey(simulator, state, keyMode) {
  const hero = state.hero || {};
  const region = buildRegionSignature(simulator, state, keyMode);
  return JSON.stringify({
    floorId: state.floorId,
    keyMode,
    region,
    hero: {
      atk: number(hero.atk, 0),
      def: number(hero.def, 0),
      mdef: number(hero.mdef, 0),
      lv: number(hero.lv, 0),
      exp: number(hero.exp, 0),
      money: number(hero.money, 0),
      equipment: Array.isArray(hero.equipment) ? hero.equipment.slice().sort() : [],
    },
    inventory: stableObject(state.inventory),
    flags: stableObject(state.flags),
    mutations: localMutationSummary(state),
  });
}

function buildLocalNodeKey(simulator, state, keyMode, mt5Entries, mt5Returns) {
  return [
    buildLocalDpKey(simulator, state, keyMode),
    `mt5Entries:${mt5Entries}`,
    `mt5Returns:${mt5Returns}`,
  ].join("|");
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
    searchGraphMode: "macro",
  });
}

function primitiveActions(simulator, state) {
  return simulator.enumeratePrimitiveActions(state).actions || [];
}

function localSearchActions(simulator, state, node, config) {
  const actions = simulator.enumerateBattleActionsOnly(state)
    .filter((action) => isAllowedAction(action, state, node));
  const canUseStair =
    (state.floorId === "MT4" && node.mt5Entries < config.maxMt5Entries) ||
    (state.floorId === "MT5" && node.mt5Returns < config.maxMt5Returns);
  if (canUseStair && (state.floorId === "MT4" || state.floorId === "MT5")) {
    const floor = simulator.project.floorsById[state.floorId];
    const reachability = simulator.getWalkReachability(state);
    Object.values(reachability.visited || {}).forEach((visited) => {
      DIRECTIONS.forEach((direction) => {
        const delta = DIRECTION_DELTAS[direction];
        const x = visited.x + delta.x;
        const y = visited.y + delta.y;
        const changeFloor = (floor.changeFloor || {})[coordinateKey(x, y)];
        if (!changeFloor || coordinateKey(x, y) !== LOCAL_STAIR_COORDINATE) return;
        const pathToStance = reconstructPath(reachability, visited.x, visited.y) || [];
        const travelState = cloneState(state);
        simulator.moveHero(travelState, pathToStance, { x: visited.x, y: visited.y }, direction);
        actions.push({
          kind: "changeFloor",
          floorId: state.floorId,
          stance: { x: visited.x, y: visited.y },
          direction,
          x,
          y,
          path: pathToStance,
          travelState,
          changeFloor,
          summary: `changeFloor@${state.floorId}:${x},${y}`,
        });
      });
    });
  }
  return actions;
}

function findAction(simulator, state, summary) {
  return primitiveActions(simulator, state).find((action) => action.summary === summary)
    || simulator.enumerateActions(state).find((action) => action.summary === summary)
    || null;
}

function replayRoute(simulator, routeFile) {
  let state = simulator.createInitialState({ rank: "chaos" });
  for (const decision of readRouteFile(routeFile).decisions || []) {
    const action = findAction(simulator, state, decision.summary);
    if (!action) throw new Error(`Unable to replay ${decision.summary}`);
    state = simulator.applyAction(state, action);
  }
  return state;
}

function isBlueKingDefeated(project, state) {
  return getTileDefinitionAt(project, state, "MT5", 6, 7) == null;
}

function isAllowedAction(action, state, node) {
  if (!action) return false;
  if (action.kind === "battle") return action.floorId === "MT4" || action.floorId === "MT5";
  if (action.kind !== "changeFloor") return false;
  if (state.floorId === "MT4") return action.summary === `changeFloor@MT4:${LOCAL_STAIR_COORDINATE}`;
  if (state.floorId === "MT5") return action.summary === `changeFloor@MT5:${LOCAL_STAIR_COORDINATE}`;
  return false;
}

function actionPriority(action) {
  if (action.kind === "changeFloor") return 100000000;
  const estimate = action.estimate || {};
  const enemyId = action.enemyId || "";
  let bonus = 0;
  if (enemyId === "blueKing") bonus += 10000000000;
  if (enemyId === "greenKing") bonus += 900000000;
  if (enemyId === "blueKnight" || enemyId === "goldSlime") bonus += 800000000;
  if (enemyId === "poisonSkeleton" || enemyId === "poisonBat" || enemyId === "skeletonPriest" || enemyId === "skeletonKing") bonus += 700000000;
  if (enemyId === "devilWarrior" || enemyId === "skeletonPresbyter") bonus += 600000000;
  if (enemyId === "skeletonKnight" || enemyId === "demonPriest" || enemyId === "evilHero" || enemyId === "goldHornSlime") bonus += 400000000;
  return bonus + number(estimate.exp, 0) * 3000000 - number(estimate.damage, 0) * 30;
}

function statePriority(project, state, routeLength, mode) {
  const hero = state.hero || {};
  const progressScore = (
    (state.floorId === "MT5" ? 1000000000000 : 0) +
    number(hero.lv, 0) * 100000000000 +
    number(hero.atk, 0) * 50000000 +
    number(hero.def, 0) * 50000000 +
    number(hero.mdef, 0) * 100000 +
    number(hero.exp, 0) * 100000 +
    number(hero.hp, 0) * 10 -
    routeLength * 1000
  );
  const attributeScore = (
    number(hero.lv, 0) * 100000000000 +
    number(hero.atk, 0) * 100000000 +
    number(hero.def, 0) * 100000000 +
    number(hero.mdef, 0) * 150000 +
    number(hero.exp, 0) * 100000 +
    number(hero.hp, 0) * 10 -
    routeLength * 1000
  );
  if (mode === "boss-readiness") {
    const boss = (project.enemysById || {}).blueKing || {};
    const bossDef = number(boss.def, 0);
    const atk = number(hero.atk, 0);
    const canDamageBoss = atk > bossDef ? 1 : 0;
    return (
      canDamageBoss * 10000000000000000 +
      Math.min(atk, bossDef) * 1000000000000 +
      number(hero.def, 0) * 1000000000 +
      number(hero.mdef, 0) * 1000000 +
      number(hero.exp, 0) * 100000 +
      number(hero.hp, 0) * 10 -
      routeLength * 1000
    );
  }
  return mode === "attributes" ? attributeScore : progressScore;
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

class BinaryHeap {
  constructor(compare) {
    this.compare = compare;
    this.items = [];
  }

  get length() {
    return this.items.length;
  }

  push(value) {
    this.items.push(value);
    this.bubbleUp(this.items.length - 1);
  }

  pop() {
    if (this.items.length === 0) return null;
    const result = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0) {
      this.items[0] = last;
      this.sinkDown(0);
    }
    return result;
  }

  bubbleUp(index) {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.compare(this.items[index], this.items[parent]) <= 0) break;
      const tmp = this.items[parent];
      this.items[parent] = this.items[index];
      this.items[index] = tmp;
      index = parent;
    }
  }

  sinkDown(index) {
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let best = index;
      if (left < this.items.length && this.compare(this.items[left], this.items[best]) > 0) best = left;
      if (right < this.items.length && this.compare(this.items[right], this.items[best]) > 0) best = right;
      if (best === index) break;
      const tmp = this.items[index];
      this.items[index] = this.items[best];
      this.items[best] = tmp;
      index = best;
    }
  }
}

function reconstruct(nodes, nodeId) {
  const route = [];
  let current = nodeId;
  while (current >= 0) {
    const node = nodes[current];
    if (node.action) route.push(node.action.summary);
    current = node.parentId;
  }
  return route.reverse();
}

function searchLocal(simulator, startState, options) {
  const config = options || {};
  const maxExpansions = number(config.maxExpansions, 200000);
  const maxFrontier = number(config.maxFrontier, 20000);
  const branchLimit = number(config.branchLimit, 9999);
  const keyMode = String(config.keyMode || "region");
  const searchConfig = {
    maxMt5Entries: number(config.maxMt5Entries, 2),
    maxMt5Returns: number(config.maxMt5Returns, 1),
    bestMode: String(config.bestMode || "boss-readiness"),
  };
  const project = simulator.project;
  const root = {
    id: 0,
    parentId: -1,
    action: null,
    state: startState,
    key: null,
    routeLength: 0,
    hasEnteredMt5: startState.floorId === "MT5",
    mt5Entries: startState.floorId === "MT5" ? 1 : 0,
    mt5Returns: 0,
    priority: statePriority(project, startState, 0, "progress"),
    bestPriority: statePriority(project, startState, 0, searchConfig.bestMode),
  };
  root.key = buildLocalNodeKey(simulator, startState, keyMode, root.mt5Entries, root.mt5Returns);
  const nodes = [root];
  const frontier = new BinaryHeap((left, right) => nodes[left].priority - nodes[right].priority);
  frontier.push(0);
  const bestByKey = new Map([[root.key, 0]]);
  const skipped = { lethal: 0, dominated: 0, invalid: 0, disallowed: 0, stale: 0, frontierCap: 0, invalidExamples: [] };
  let bestSeen = 0;
  let goalNode = -1;
  let expansions = 0;

  while (frontier.length > 0 && expansions < maxExpansions) {
    if (frontier.length > maxFrontier) {
      skipped.frontierCap += 1;
      break;
    }
    const nodeId = frontier.pop();
    const node = nodes[nodeId];
    if (bestByKey.get(node.key) !== nodeId) {
      skipped.stale += 1;
      continue;
    }
    expansions += 1;
    if (node.bestPriority > nodes[bestSeen].bestPriority) bestSeen = nodeId;
    if (isBlueKingDefeated(project, node.state)) {
      goalNode = nodeId;
      break;
    }

    const actions = localSearchActions(simulator, node.state, node, searchConfig)
      .filter((action) => {
        if (action.kind !== "battle") return true;
        const damage = number((action.estimate || {}).damage, Number.POSITIVE_INFINITY);
        const ok = Number.isFinite(damage) && damage < number((node.state.hero || {}).hp, 0);
        if (!ok) skipped.lethal += 1;
        return ok;
      })
      .sort((left, right) => actionPriority(right) - actionPriority(left))
      .slice(0, branchLimit);

    for (const action of actions) {
      let nextState;
      try {
        nextState = simulator.applyAction(node.state, action, { storeRoute: false });
      } catch (error) {
        skipped.invalid += 1;
        if (skipped.invalidExamples.length < 8) {
          skipped.invalidExamples.push({
            action: action.summary,
            floorId: node.state.floorId,
            loc: (node.state.hero || {}).loc,
            error: error.message,
          });
        }
        continue;
      }
      const enteredMt5 = node.state.floorId !== "MT5" && nextState.floorId === "MT5";
      const returnedMt4 = node.state.floorId === "MT5" && nextState.floorId === "MT4";
      const mt5Entries = node.mt5Entries + (enteredMt5 ? 1 : 0);
      const mt5Returns = node.mt5Returns + (returnedMt4 ? 1 : 0);
      const key = buildLocalNodeKey(simulator, nextState, keyMode, mt5Entries, mt5Returns);
      const existingNodeId = bestByKey.get(key);
      if (existingNodeId != null && number((nodes[existingNodeId].state.hero || {}).hp, 0) >= number((nextState.hero || {}).hp, 0)) {
        skipped.dominated += 1;
        continue;
      }
      const routeLength = node.routeLength + 1;
      const nextNode = {
        id: nodes.length,
        parentId: nodeId,
        action,
        state: nextState,
        key,
        routeLength,
        hasEnteredMt5: node.hasEnteredMt5 || nextState.floorId === "MT5",
        mt5Entries,
        mt5Returns,
        priority: statePriority(project, nextState, routeLength, "progress"),
        bestPriority: statePriority(project, nextState, routeLength, searchConfig.bestMode),
      };
      nodes.push(nextNode);
      bestByKey.set(key, nextNode.id);
      frontier.push(nextNode.id);
    }
  }

  return {
    found: goalNode >= 0,
    nodeId: goalNode >= 0 ? goalNode : bestSeen,
    expansions,
    nodes,
    frontierRemaining: frontier.length,
    skipped,
    keyMode,
    searchConfig,
  };
}

function replaySuffix(simulator, startRouteFile, suffix) {
  let state = replayRoute(simulator, startRouteFile);
  for (const summary of suffix) {
    const action = findAction(simulator, state, summary);
    if (!action) throw new Error(`Unable to replay suffix action ${summary}`);
    state = simulator.applyAction(state, action);
  }
  return state;
}

function tryReplaySuffix(simulator, startRouteFile, suffix) {
  try {
    return { state: replaySuffix(simulator, startRouteFile, suffix), error: null };
  } catch (error) {
    return { state: null, error };
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = path.resolve(args["project-root"] || DEFAULT_PROJECT_ROOT);
  const startRouteFile = path.resolve(args["start-route"] || DEFAULT_START_ROUTE);
  const outRouteFile = path.resolve(args.out || DEFAULT_OUT_ROUTE);
  const writeRoute = booleanArg(args["write-route"], true);
  const simulator = makeSimulator(projectRoot);
  const startState = replayRoute(simulator, startRouteFile);
  const result = searchLocal(simulator, startState, {
    maxExpansions: args["max-expansions"],
    maxFrontier: args["max-frontier"],
    branchLimit: args["branch-limit"],
    keyMode: args["key-mode"] || args["dp-key-mode"],
    maxMt5Entries: args["max-mt5-entries"],
    maxMt5Returns: args["max-mt5-returns"],
    bestMode: args["best-mode"],
  });
  const node = result.nodes[result.nodeId];
  const suffix = reconstruct(result.nodes, result.nodeId);
  const replayed = tryReplaySuffix(simulator, startRouteFile, suffix);
  const finalState = replayed.state || node.state;
  const replayValid = replayed.error == null;
  let routeWriteError = null;
  if (writeRoute && replayValid) {
    try {
      const routeRecord = buildRouteRecord({
        project: simulator.project,
        simulator,
        finalState,
        options: {
          projectRoot,
          solver: "mt5-blueking-local-dp",
          profile: "mt4-mt5-local-no-stair-loop",
          rank: "chaos",
          toFloor: "MT5",
          goalType: result.found ? "defeat-tile" : "best-progress",
          expanded: result.expansions,
          metadata: {
            kind: result.found ? "goal" : "best-progress",
            target: { floorId: "MT5", x: 6, y: 7, enemyId: "blueKing", name: "织光仙子" },
            rules: {
              allowedFloors: ["MT4", "MT5"],
              allowedActions: ["battle", "changeFloor@MT4:6,12", "changeFloor@MT5:6,12"],
              noStairLoop: "bounded",
              maxMt5Entries: result.searchConfig.maxMt5Entries,
              maxMt5Returns: result.searchConfig.maxMt5Returns,
              bestMode: result.searchConfig.bestMode,
              localDpKey: result.keyMode === "region"
                ? "floor+reachable-region+combat+inventory+flags+MT4/MT5 mutations; hp skyline"
                : "floor+combat+inventory+flags+MT4/MT5 mutations; hp skyline",
              keyMode: result.keyMode,
            },
            search: {
              expansions: result.expansions,
              nodes: result.nodes.length,
              frontierRemaining: result.frontierRemaining,
              skipped: result.skipped,
              replayValid,
              replayError: replayed.error ? replayed.error.message : null,
            },
          },
        },
      });
    writeRouteFile(outRouteFile, routeRecord);
    } catch (error) {
      routeWriteError = error;
    }
  }

  console.log(JSON.stringify({
    found: result.found,
    routeFile: writeRoute && replayValid && !routeWriteError ? path.relative(process.cwd(), outRouteFile) : null,
    replayValid,
    replayError: replayed.error ? replayed.error.message : null,
    routeWriteError: routeWriteError ? routeWriteError.message : null,
    expansions: result.expansions,
    keyMode: result.keyMode,
    searchConfig: result.searchConfig,
    nodes: result.nodes.length,
    frontierRemaining: result.frontierRemaining,
    skipped: result.skipped,
    final: compactHero(finalState),
    suffix: suffix.map((summary) => formatActionLabel(simulator.project, summary)),
  }, null, 2));
}

if (require.main === module) main();
