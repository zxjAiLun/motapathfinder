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
const DEFAULT_TARGET = { floorId: "MT5", x: 6, y: 7, enemyId: "blueKing", name: "织光仙子" };

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

function parseTarget(value) {
  if (!value) return { ...DEFAULT_TARGET };
  const match = /^([^:]+):(\d+),(\d+):([^:]+)(?::(.+))?$/.exec(String(value));
  if (!match) return { ...DEFAULT_TARGET };
  return {
    floorId: match[1],
    x: Number(match[2]),
    y: Number(match[3]),
    enemyId: match[4],
    name: match[5] || match[4],
  };
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

function actionAllowedByScope(action, scope) {
  if (action.kind === "battle" || action.kind === "changeFloor") return true;
  if (scope === "battle-door") return action.kind === "openDoor";
  if (scope === "battle-door-tool") return action.kind === "openDoor" || action.kind === "useTool";
  if (scope === "local-full") {
    if (action.kind === "event") return action.hasStateChange === true && !action.unsupported;
    return ["pickup", "equip", "openDoor", "useTool"].includes(action.kind);
  }
  return false;
}

function primitiveLocalActions(simulator, state, node, config) {
  if (config.actionScope === "battle-only") {
    return simulator.enumerateBattleActionsOnly(state);
  }
  return primitiveActions(simulator, state).filter((action) => actionAllowedByScope(action, config.actionScope));
}

function localSearchActions(simulator, state, node, config) {
  const actions = primitiveLocalActions(simulator, state, node, config)
    .filter((action) => isAllowedAction(action, state, node, config));
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

function isTargetDefeated(project, state, target) {
  return getTileDefinitionAt(project, state, target.floorId, target.x, target.y) == null;
}

function isAllowedAction(action, state, node, config) {
  if (!action) return false;
  if (action.kind !== "changeFloor") {
    return (action.floorId || state.floorId) === "MT4" || (action.floorId || state.floorId) === "MT5";
  }
  if (state.floorId === "MT4") return action.summary === `changeFloor@MT4:${LOCAL_STAIR_COORDINATE}`;
  if (state.floorId === "MT5") {
    if (action.summary === `changeFloor@MT5:${LOCAL_STAIR_COORDINATE}`) return true;
    return Boolean(config && config.allowForwardMt5Stair && action.summary === "changeFloor@MT5:6,0");
  }
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

function isEnemyTile(project, tile) {
  return Boolean(tile && tile.id && project.enemysById && project.enemysById[tile.id]);
}

function isDoorTile(tile) {
  return Boolean(tile && (tile.trigger === "openDoor" || tile.cls === "animates" || /Door$/.test(String(tile.id || ""))));
}

function isHardWall(tile) {
  if (!tile) return false;
  if (tile.canPass === true) return false;
  if (tile.noPass === true) return true;
  if (tile.cls === "autotile" || tile.cls === "unknown") return true;
  return false;
}

function targetPathMetrics(simulator, state, target) {
  const project = simulator.project;
  const floor = project.floorsById && project.floorsById[target.floorId];
  if (!floor || state.floorId !== target.floorId) {
    return {
      onTargetFloor: false,
      reachableNow: false,
      blockerCount: Number.POSITIVE_INFINITY,
      enemyBlockers: Number.POSITIVE_INFINITY,
      doorBlockers: Number.POSITIVE_INFINITY,
      distance: Number.POSITIVE_INFINITY,
      path: [],
    };
  }

  const startKeys = new Set();
  try {
    const reachability = simulator.getWalkReachability(state);
    if (reachability && reachability.visited) {
      for (const visited of Object.values(reachability.visited)) {
        startKeys.add(coordinateKey(visited.x, visited.y));
      }
    }
  } catch (error) {
    // Fall back to the current hero location below.
  }
  const hero = state.hero || {};
  if (hero.loc) startKeys.add(coordinateKey(hero.loc.x, hero.loc.y));

  const targetStanceKeys = new Set();
  for (const direction of DIRECTIONS) {
    const delta = DIRECTION_DELTAS[direction];
    const x = target.x - delta.x;
    const y = target.y - delta.y;
    if (x >= 0 && y >= 0 && x < floor.width && y < floor.height) {
      targetStanceKeys.add(coordinateKey(x, y));
    }
  }

  const dist = new Map();
  const queue = [];
  for (const key of startKeys) {
    dist.set(key, { cost: 0, enemyBlockers: 0, doorBlockers: 0, distance: 0, path: [] });
    queue.push(key);
  }

  let best = null;
  while (queue.length > 0) {
    queue.sort((left, right) => {
      const a = dist.get(left);
      const b = dist.get(right);
      return (a.cost - b.cost) || (a.distance - b.distance);
    });
    const key = queue.shift();
    const current = dist.get(key);
    if (targetStanceKeys.has(key)) {
      best = current;
      break;
    }
    const [xText, yText] = key.split(",");
    const x = Number(xText);
    const y = Number(yText);
    for (const direction of DIRECTIONS) {
      const delta = DIRECTION_DELTAS[direction];
      const nextX = x + delta.x;
      const nextY = y + delta.y;
      if (nextX < 0 || nextY < 0 || nextX >= floor.width || nextY >= floor.height) continue;
      if (nextX === target.x && nextY === target.y) continue;
      const tile = getTileDefinitionAt(project, state, target.floorId, nextX, nextY);
      if (isHardWall(tile) && !isEnemyTile(project, tile) && !isDoorTile(tile)) continue;
      const enemyBlocker = isEnemyTile(project, tile) ? 1 : 0;
      const doorBlocker = isDoorTile(tile) ? 1 : 0;
      const stepCost = enemyBlocker + doorBlocker;
      const nextKey = coordinateKey(nextX, nextY);
      const next = {
        cost: current.cost + stepCost,
        enemyBlockers: current.enemyBlockers + enemyBlocker,
        doorBlockers: current.doorBlockers + doorBlocker,
        distance: current.distance + 1,
        path: current.path.concat(tile && stepCost > 0 ? [{ x: nextX, y: nextY, id: tile.id, kind: enemyBlocker ? "enemy" : "door" }] : []),
      };
      const existing = dist.get(nextKey);
      if (
        !existing ||
        next.cost < existing.cost ||
        (next.cost === existing.cost && next.distance < existing.distance)
      ) {
        dist.set(nextKey, next);
        queue.push(nextKey);
      }
    }
  }

  if (!best) {
    return {
      onTargetFloor: true,
      reachableNow: false,
      blockerCount: Number.POSITIVE_INFINITY,
      enemyBlockers: Number.POSITIVE_INFINITY,
      doorBlockers: Number.POSITIVE_INFINITY,
      distance: Number.POSITIVE_INFINITY,
      path: [],
    };
  }

  const firstBlocker = best.path.find((entry) => entry.kind === "enemy") || null;
  let nextBlockerDamage = null;
  let nextBlockerHpDeficit = 0;
  let canFightNextBlocker = true;
  if (firstBlocker) {
    try {
      const battle = simulator.battleResolver.evaluateBattle(state, target.floorId, firstBlocker.x, firstBlocker.y, firstBlocker.id);
      nextBlockerDamage = battle && battle.damageInfo ? battle.damageInfo.damage : null;
      canFightNextBlocker = nextBlockerDamage != null && Number(nextBlockerDamage) < Number((state.hero || {}).hp || 0);
      nextBlockerHpDeficit = nextBlockerDamage == null
        ? Number.POSITIVE_INFINITY
        : Math.max(0, Number(nextBlockerDamage) + 1 - Number((state.hero || {}).hp || 0));
    } catch (error) {
      nextBlockerDamage = null;
      nextBlockerHpDeficit = Number.POSITIVE_INFINITY;
      canFightNextBlocker = false;
    }
  }

  return {
    onTargetFloor: true,
    reachableNow: best.cost === 0,
    blockerCount: best.cost,
    enemyBlockers: best.enemyBlockers,
    doorBlockers: best.doorBlockers,
    distance: best.distance,
    path: best.path,
    firstBlocker,
    nextBlockerDamage,
    nextBlockerHpDeficit,
    canFightNextBlocker,
  };
}

function incrementCounter(object, key, amount) {
  const normalizedKey = key || "unknown";
  object[normalizedKey] = number(object[normalizedKey], 0) + number(amount, 1);
}

function actionKind(action) {
  if (!action) return "unknown";
  if (action.kind === "changeFloor") return action.summary || "changeFloor";
  return action.kind || "unknown";
}

function createActionDiagnostics() {
  return {
    generated: 0,
    eligible: 0,
    selected: 0,
    accepted: 0,
    trimmedByBranchLimit: 0,
    byKind: {
      generated: {},
      eligible: {},
      selected: {},
      accepted: {},
      lethal: {},
      dominated: {},
      invalid: {},
      keyReplacementCap: {},
    },
  };
}

function statePriority(simulator, state, routeLength, mode, target) {
  const project = simulator.project;
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
    const boss = (project.enemysById || {})[(target || DEFAULT_TARGET).enemyId] || {};
    const bossDef = number(boss.def, 0);
    const atk = number(hero.atk, 0);
    const canDamageBoss = atk > bossDef ? 1 : 0;
    const targetPath = targetPathMetrics(simulator, state, target || DEFAULT_TARGET);
    const finiteBlockers = Number.isFinite(targetPath.blockerCount) ? targetPath.blockerCount : 99;
    const finiteDistance = Number.isFinite(targetPath.distance) ? targetPath.distance : 99;
    const nextBlockerHpDeficit = Number.isFinite(targetPath.nextBlockerHpDeficit) ? targetPath.nextBlockerHpDeficit : 9999999;
    const targetPathScore = (
      (targetPath.onTargetFloor ? 1 : 0) * 1000000000000000000 +
      (targetPath.reachableNow ? 1 : 0) * 500000000000000000 +
      Math.max(0, 30 - finiteBlockers) * 10000000000000000 +
      (targetPath.canFightNextBlocker ? 1 : 0) * 5000000000000000 -
      nextBlockerHpDeficit * 100000000 -
      finiteDistance * 1000000000
    );
    return (
      canDamageBoss * 10000000000000000000 +
      targetPathScore +
      Math.min(atk, bossDef) * 10000000000 +
      number(hero.def, 0) * 10000000 +
      number(hero.mdef, 0) * 10000 +
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

function compactNodeForDiagnostics(project, simulator, node, target) {
  return {
    id: node.id,
    routeLength: node.routeLength,
    lastAction: node.action ? formatActionLabel(project, node.action) : null,
    priority: node.priority,
    bestPriority: node.bestPriority,
    mt5Entries: node.mt5Entries,
    mt5Returns: node.mt5Returns,
    final: compactHero(node.state),
    blocker: analyzeBossBlocker(project, simulator, node.state, target),
  };
}

function analyzeBossBlocker(project, simulator, state, target) {
  const enemy = (project.enemysById || {})[target.enemyId] || {};
  const hero = state.hero || {};
  const tile = getTileDefinitionAt(project, state, target.floorId, target.x, target.y);
  const bossDef = number(enemy.def, 0);
  const atk = number(hero.atk, 0);
  const hp = number(hero.hp, 0);
  let reachableNow = false;
  let battleEstimate = null;
  if (state.floorId === target.floorId && tile) {
    try {
      const battle = simulator.enumerateBattleActionsOnly(state)
        .find((action) => action.enemyId === target.enemyId && action.target && action.target.x === target.x && action.target.y === target.y);
      reachableNow = Boolean(battle);
      battleEstimate = battle ? battle.estimate || null : null;
    } catch (error) {
      reachableNow = false;
    }
  }
  const canBreakDefense = atk > bossDef;
  const hpDeficit = battleEstimate && battleEstimate.damage != null
    ? Math.max(0, Number(battleEstimate.damage || 0) + 1 - hp)
    : 0;
  let reason = "unknown-or-hp-or-reachability";
  if (!tile) reason = "target-cleared";
  else if (!canBreakDefense) reason = "atk-deficit";
  else if (!reachableNow) reason = "not-reachable";
  else if (hpDeficit > 0) reason = "hp-deficit";
  const targetPath = targetPathMetrics(simulator, state, target);
  return {
    target,
    tileExists: Boolean(tile),
    reachableNow,
    bossDef,
    atk,
    atkDeficit: Math.max(0, bossDef + 1 - atk),
    canBreakDefense,
    hp,
    hpDeficit,
    battleEstimate,
    targetPath,
    reason,
  };
}

function estimateGoalUpperBound(project, simulator, state, node, config) {
  const hero = state.hero || {};
  const actions = localSearchActions(simulator, state, node, {
    ...config,
    enableUpperBoundPruning: false,
  });
  let immediateAtkGain = 0;
  let immediateExpGain = 0;
  for (const action of actions) {
    const estimate = action.estimate || {};
    immediateAtkGain += number(estimate.atk || estimate.atkDelta, 0);
    immediateExpGain += number(estimate.exp || estimate.expDelta, 0);
  }
  return {
    atk: number(hero.atk, 0),
    immediateAtkGain,
    immediateExpGain,
    optimisticAtk: number(hero.atk, 0) + immediateAtkGain,
    proofGrade: false,
    note: "single-frontier-bound-only",
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
    maxKeyReplacements: number(config.maxKeyReplacements, 8),
    maxRouteLength: number(config.maxRouteLength, 80),
    bestMode: String(config.bestMode || "boss-readiness"),
    queueMode: String(config.queueMode || "boss-readiness"),
    actionScope: String(config.actionScope || "battle-only"),
    allowForwardMt5Stair: config.allowForwardMt5Stair === true,
    enableUpperBoundPruning: config.enableUpperBoundPruning === true,
    target: config.target || { ...DEFAULT_TARGET },
    frontierSamples: number(config.frontierSamples, 8),
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
    priority: statePriority(simulator, startState, 0, searchConfig.queueMode, searchConfig.target),
    bestPriority: statePriority(simulator, startState, 0, searchConfig.bestMode, searchConfig.target),
  };
  root.key = buildLocalNodeKey(simulator, startState, keyMode, root.mt5Entries, root.mt5Returns);
  const nodes = [root];
  const frontier = new BinaryHeap((left, right) => nodes[left].priority - nodes[right].priority);
  frontier.push(0);
  const bestByKey = new Map([[root.key, 0]]);
  const skipped = { lethal: 0, dominated: 0, invalid: 0, disallowed: 0, stale: 0, frontierCap: 0, keyReplacementCap: 0, routeLengthCap: 0, atkUpperBoundInsufficient: 0, invalidExamples: [] };
  const actionDiagnostics = createActionDiagnostics();
  const keyReplacementCounts = new Map();
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
    if (isTargetDefeated(project, node.state, searchConfig.target)) {
      goalNode = nodeId;
      break;
    }
    if (node.routeLength >= searchConfig.maxRouteLength) {
      skipped.routeLengthCap += 1;
      continue;
    }

    if (searchConfig.enableUpperBoundPruning) {
      const blocker = analyzeBossBlocker(project, simulator, node.state, searchConfig.target);
      const bound = estimateGoalUpperBound(project, simulator, node.state, node, searchConfig);
      if (bound.proofGrade && blocker.reason === "atk-deficit" && bound.optimisticAtk <= blocker.bossDef) {
        skipped.atkUpperBoundInsufficient += 1;
        continue;
      }
    }

    const generatedActions = localSearchActions(simulator, node.state, node, searchConfig);
    actionDiagnostics.generated += generatedActions.length;
    for (const action of generatedActions) incrementCounter(actionDiagnostics.byKind.generated, actionKind(action));

    const eligibleActions = generatedActions
      .filter((action) => {
        if (action.kind !== "battle") return true;
        const damage = number((action.estimate || {}).damage, Number.POSITIVE_INFINITY);
        const ok = Number.isFinite(damage) && damage < number((node.state.hero || {}).hp, 0);
        if (!ok) {
          skipped.lethal += 1;
          incrementCounter(actionDiagnostics.byKind.lethal, actionKind(action));
        }
        return ok;
      })
      .sort((left, right) => actionPriority(right) - actionPriority(left));
    actionDiagnostics.eligible += eligibleActions.length;
    for (const action of eligibleActions) incrementCounter(actionDiagnostics.byKind.eligible, actionKind(action));

    const actions = eligibleActions.slice(0, branchLimit);
    actionDiagnostics.selected += actions.length;
    actionDiagnostics.trimmedByBranchLimit += Math.max(0, eligibleActions.length - actions.length);
    for (const action of actions) incrementCounter(actionDiagnostics.byKind.selected, actionKind(action));

    for (const action of actions) {
      let nextState;
      try {
        nextState = simulator.applyAction(node.state, action, { storeRoute: false });
      } catch (error) {
        skipped.invalid += 1;
        incrementCounter(actionDiagnostics.byKind.invalid, actionKind(action));
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
        incrementCounter(actionDiagnostics.byKind.dominated, actionKind(action));
        continue;
      }
      const replacementCount = number(keyReplacementCounts.get(key), 0);
      if (existingNodeId != null && replacementCount >= searchConfig.maxKeyReplacements) {
        skipped.keyReplacementCap += 1;
        incrementCounter(actionDiagnostics.byKind.keyReplacementCap, actionKind(action));
        continue;
      }
      if (existingNodeId != null) keyReplacementCounts.set(key, replacementCount + 1);
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
        priority: statePriority(simulator, nextState, routeLength, searchConfig.queueMode, searchConfig.target),
        bestPriority: statePriority(simulator, nextState, routeLength, searchConfig.bestMode, searchConfig.target),
      };
      nodes.push(nextNode);
      bestByKey.set(key, nextNode.id);
      frontier.push(nextNode.id);
      actionDiagnostics.accepted += 1;
      incrementCounter(actionDiagnostics.byKind.accepted, actionKind(action));
    }
  }

  const frontierSample = frontier.items
    .slice()
    .sort((left, right) => nodes[right].priority - nodes[left].priority)
    .slice(0, Math.max(0, searchConfig.frontierSamples))
    .map((nodeId) => compactNodeForDiagnostics(project, simulator, nodes[nodeId], searchConfig.target));

  return {
    found: goalNode >= 0,
    nodeId: goalNode >= 0 ? goalNode : bestSeen,
    expansions,
    nodes,
    frontierRemaining: frontier.length,
    skipped,
    actionDiagnostics,
    frontierSample,
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
  const target = parseTarget(args.target);
  const result = searchLocal(simulator, startState, {
    maxExpansions: args["max-expansions"],
    maxFrontier: args["max-frontier"],
    branchLimit: args["branch-limit"],
    keyMode: args["key-mode"] || args["dp-key-mode"],
    maxMt5Entries: args["max-mt5-entries"],
    maxMt5Returns: args["max-mt5-returns"],
    maxKeyReplacements: args["max-key-replacements"],
    maxRouteLength: args["max-route-length"],
    bestMode: args["best-mode"],
    queueMode: args["queue-mode"],
    actionScope: args["action-scope"],
    allowForwardMt5Stair: booleanArg(args["allow-forward-mt5-stair"], false),
    enableUpperBoundPruning: booleanArg(args["upper-bound-pruning"], false),
    frontierSamples: args["frontier-samples"],
    target,
  });
  const node = result.nodes[result.nodeId];
  const suffix = reconstruct(result.nodes, result.nodeId);
  const replayed = tryReplaySuffix(simulator, startRouteFile, suffix);
  const finalState = replayed.state || node.state;
  const replayValid = replayed.error == null;
  const bossBlocker = analyzeBossBlocker(simulator.project, simulator, finalState, result.searchConfig.target);
  const goalUpperBound = estimateGoalUpperBound(simulator.project, simulator, finalState, node, result.searchConfig);
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
            target: result.searchConfig.target,
            bossBlocker,
            goalUpperBound,
            rules: {
              allowedFloors: ["MT4", "MT5"],
              actionScope: result.searchConfig.actionScope,
              allowedActions: ["battle", "changeFloor@MT4:6,12", "changeFloor@MT5:6,12"],
              noStairLoop: "bounded",
              maxMt5Entries: result.searchConfig.maxMt5Entries,
              maxMt5Returns: result.searchConfig.maxMt5Returns,
              maxKeyReplacements: result.searchConfig.maxKeyReplacements,
              maxRouteLength: result.searchConfig.maxRouteLength,
              bestMode: result.searchConfig.bestMode,
              queueMode: result.searchConfig.queueMode,
              allowForwardMt5Stair: result.searchConfig.allowForwardMt5Stair,
              enableUpperBoundPruning: result.searchConfig.enableUpperBoundPruning,
              frontierSamples: result.searchConfig.frontierSamples,
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
              actionDiagnostics: result.actionDiagnostics,
              frontierSample: result.frontierSample,
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
    actionDiagnostics: result.actionDiagnostics,
    frontierSample: result.frontierSample,
    bossBlocker,
    goalUpperBound,
    final: compactHero(finalState),
    suffix: suffix.map((summary) => formatActionLabel(simulator.project, summary)),
  }, null, 2));
}

if (require.main === module) main();
