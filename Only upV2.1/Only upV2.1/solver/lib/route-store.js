"use strict";

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

const { getDecisionDepth } = require("./state");
const { buildDominanceKey } = require("./state-key");
const { isDecisionStep } = require("./updown-candidate-policy");
const { buildSolverSnapshot } = require("./route-snapshot");

const ROUTE_SCHEMA = "motapathfinder.route.v1";

function cloneJson(value) {
  if (value == null) return null;
  return JSON.parse(JSON.stringify(value));
}

function compactObject(object) {
  return Object.keys(object || {}).reduce((result, key) => {
    const value = object[key];
    if (value == null) return result;
    if (Array.isArray(value) && value.length === 0) return result;
    if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) return result;
    result[key] = value;
    return result;
  }, {});
}

function parseArgsSummary(summary) {
  const match = /^(pickup|battle|openDoor):([^@]+)@([^:]+):(\d+),(\d+)$/.exec(summary || "");
  if (!match) return null;
  return {
    kind: match[1],
    id: match[2],
    floorId: match[3],
    x: Number(match[4]),
    y: Number(match[5]),
  };
}

function normalizePoint(point, floorId) {
  if (!point) return null;
  if (point.x == null || point.y == null) return null;
  return {
    floorId: point.floorId || floorId || null,
    x: Number(point.x),
    y: Number(point.y),
  };
}

function normalizeChangeFloor(changeFloor) {
  if (!changeFloor) return null;
  if (typeof changeFloor === "string") return { floorId: changeFloor };
  return cloneJson(changeFloor);
}

function normalizeEstimate(estimate) {
  if (!estimate) return null;
  return compactObject({
    damage: estimate.damage,
    turn: estimate.turn,
    money: estimate.money,
    exp: estimate.exp,
    guards: estimate.guards,
    score: estimate.score,
    stopReasons: estimate.stopReasons,
  });
}

function normalizeAction(action) {
  if (!action || !action.kind) throw new Error("Cannot normalize missing route action.");
  const parsed = parseArgsSummary(action.summary);
  const floorId = action.floorId || (action.travelState && action.travelState.floorId) || (parsed && parsed.floorId) || null;
  const target = normalizePoint(action.target, floorId) || normalizePoint(
    action.x != null && action.y != null ? { x: action.x, y: action.y } : null,
    floorId
  );
  const normalized = compactObject({
    kind: action.kind,
    summary: action.summary || action.kind,
    floorId,
    path: Array.isArray(action.path) ? action.path.slice() : [],
    stance: normalizePoint(action.stance, floorId),
    target,
    direction: action.direction || null,
    tool: action.tool || null,
    equipId: action.equipId || null,
    equipType: action.equipType == null ? null : action.equipType,
    enemyId: action.enemyId || (action.kind === "battle" && parsed ? parsed.id : null),
    itemId: action.itemId || (action.kind === "pickup" && parsed ? parsed.id : null),
    doorId: action.doorId || (action.kind === "openDoor" && parsed ? parsed.id : null),
    event: action.kind === "event" ? {
      choicePath: Array.isArray(action.choicePath) ? action.choicePath.slice() : [],
      unsupported: Boolean(action.unsupported),
    } : null,
    changeFloor: normalizeChangeFloor(action.changeFloor),
    estimate: normalizeEstimate(action.estimate),
  });
  normalized.fingerprint = fingerprintAction(normalized);
  return normalized;
}

function targetLoc(action) {
  const target = action && action.target;
  return target && target.x != null && target.y != null ? `${target.x},${target.y}` : ",";
}

function changeFloorDestination(action) {
  const changeFloor = action && action.changeFloor;
  if (!changeFloor) return "|,";
  const floorId = changeFloor.floorId || changeFloor.toFloor || changeFloor.floor || "";
  const x = changeFloor.x != null ? changeFloor.x : (changeFloor.loc && changeFloor.loc.x != null ? changeFloor.loc.x : "");
  const y = changeFloor.y != null ? changeFloor.y : (changeFloor.loc && changeFloor.loc.y != null ? changeFloor.loc.y : "");
  return `${floorId}|${x},${y}`;
}

function fingerprintAction(action) {
  const floorId = action.floorId || (action.target && action.target.floorId) || (action.stance && action.stance.floorId) || "";
  if (action.kind === "pickup") return `pickup|${floorId}|${targetLoc(action)}|${action.itemId || ""}`;
  if (action.kind === "battle") return `battle|${floorId}|${targetLoc(action)}|${action.enemyId || ""}`;
  if (action.kind === "openDoor") return `openDoor|${floorId}|${targetLoc(action)}|${action.doorId || ""}`;
  if (action.kind === "useTool") return `useTool|${floorId}|${targetLoc(action)}|${action.tool || ""}`;
  if (action.kind === "equip") return `equip|${action.equipId || ""}`;
  if (action.kind === "changeFloor") return `changeFloor|${floorId}|${targetLoc(action)}|${changeFloorDestination(action)}`;
  if (action.kind === "event") return `event|${floorId}|${targetLoc(action)}|${(((action.event || {}).choicePath) || []).join(".")}`;
  return `${action.kind || "unknown"}|${floorId}|${targetLoc(action)}|${action.summary || ""}`;
}

function writeRouteFile(filePath, routeRecord) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(routeRecord, null, 2)}\n`, "utf8");
}

function readRouteFile(filePath) {
  const record = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!record || record.schema !== ROUTE_SCHEMA) {
    throw new Error(`Unsupported route schema in ${filePath}: ${record && record.schema}`);
  }
  return record;
}

function getGitCommit(projectRoot) {
  try {
    return childProcess.execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || null;
  } catch (error) {
    return null;
  }
}

function buildFloorRange(toFloor) {
  const match = /^MT(\d+)$/.exec(toFloor || "");
  if (!match) return null;
  const floors = [];
  for (let index = 1; index <= Number(match[1]); index += 1) floors.push(`MT${index}`);
  return floors;
}

function resolveSnapshotFloors(project, initialState, finalState, options) {
  const configured = options && options.snapshotFloors;
  if (Array.isArray(configured) && configured.length > 0) return configured;
  const ranged = buildFloorRange((options && options.toFloor) || (finalState && finalState.floorId));
  if (ranged) return ranged.filter((floorId) => project.floorsById[floorId]);
  return Array.from(new Set([initialState.floorId, finalState.floorId])).filter(Boolean);
}

function findActionBySummary(simulator, state, summary) {
  return simulator.enumerateActions(state).find((action) => action.summary === summary);
}

function pushDecision(context, action) {
  const { project, simulator, decisions, snapshotOptions } = context;
  const preState = context.currentState;
  const preSnapshot = buildSolverSnapshot(project, preState, snapshotOptions);
  const normalized = normalizeAction(action);
  const postState = simulator.applyAction(preState, action);
  const postSnapshot = buildSolverSnapshot(project, postState, snapshotOptions);
  decisions.push({
    index: decisions.length + 1,
    ...normalized,
    preStateKey: buildDominanceKey(preState),
    postStateKey: buildDominanceKey(postState),
    preSnapshot,
    postSnapshot,
  });
  context.currentState = postState;
}

function replayDecisionSummary(context, summary) {
  const action = findActionBySummary(context.simulator, context.currentState, summary);
  if (!action) throw new Error(`Unable to reconstruct action while saving route: ${summary}`);
  if ((action.kind === "resourcePocket" || action.kind === "fightToLevelUp") && Array.isArray(action.plan)) {
    action.plan.forEach((nestedSummary) => replayDecisionSummary(context, nestedSummary));
    return;
  }
  pushDecision(context, action);
}

function buildRouteRecord(input) {
  const { project, simulator, finalState } = input;
  const options = input.options || {};
  const initialState = input.initialState || simulator.createInitialState({ rank: options.rank || "chaos" });
  const snapshotFloors = resolveSnapshotFloors(project, initialState, finalState, options);
  const snapshotOptions = { floorIds: snapshotFloors };
  const decisions = [];
  const context = {
    project,
    simulator,
    decisions,
    snapshotOptions,
    currentState: initialState,
  };
  (finalState.route || []).filter(isDecisionStep).forEach((summary) => replayDecisionSummary(context, summary));
  const finalSnapshot = buildSolverSnapshot(project, context.currentState, snapshotOptions);
  const expectedKey = buildDominanceKey(finalState);
  const actualKey = buildDominanceKey(context.currentState);
  const notes = Array.isArray(finalState.notes) ? finalState.notes.slice() : [];
  if (expectedKey !== actualKey) {
    notes.push(`route-store: reconstructed dominance key differs from source final key; source=${expectedKey}; reconstructed=${actualKey}`);
  }
  const projectRoot = options.projectRoot || path.resolve(__dirname, "..", "..");
  return {
    schema: ROUTE_SCHEMA,
    createdAt: new Date().toISOString(),
    source: {
      commit: options.commit === undefined ? getGitCommit(projectRoot) : options.commit,
      solver: options.solver || "bruteforce",
      profile: options.profile || null,
      rank: options.rank || "chaos",
      projectTitle: project.data && project.data.firstData ? project.data.firstData.title : null,
    },
    goal: {
      type: options.goalType || "floor",
      floorId: options.toFloor || finalState.floorId,
    },
    stats: {
      expanded: options.expanded == null ? null : Number(options.expanded),
      generated: options.generated == null ? null : Number(options.generated),
      depth: getDecisionDepth(context.currentState),
      routeLength: Array.isArray(finalState.route) ? finalState.route.length : 0,
    },
    start: {
      snapshot: buildSolverSnapshot(project, initialState, snapshotOptions),
      stateKey: buildDominanceKey(initialState),
    },
    final: {
      snapshot: finalSnapshot,
      stateKey: actualKey,
      floorId: context.currentState.floorId,
    },
    decisions,
    rawRoute: Array.isArray(finalState.route) ? finalState.route.slice() : [],
    notes,
  };
}

module.exports = {
  ROUTE_SCHEMA,
  buildRouteRecord,
  fingerprintAction,
  normalizeAction,
  readRouteFile,
  writeRouteFile,
};
