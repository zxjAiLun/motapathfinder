"use strict";

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

const { createInitialState, ensureFloorState, getDecisionDepth } = require("./state");
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
  const match = /^(pickup|battle|openDoor|getNext):([^@]+)@([^:]+):(\d+),(\d+)$/.exec(summary || "");
  if (!match) return null;
  return {
    kind: match[1] === "getNext" ? "interactPickup" : match[1],
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
    targetFloorId: action.targetFloorId || null,
    enemyId: action.enemyId || (action.kind === "battle" && parsed ? parsed.id : null),
    itemId: action.itemId || ((action.kind === "pickup" || action.kind === "interactPickup") && parsed ? parsed.id : null),
    doorId: action.doorId || (action.kind === "openDoor" && parsed ? parsed.id : null),
    event: action.kind === "event" ? {
      choicePath: Array.isArray(action.choicePath) ? action.choicePath.slice() : [],
      unsupported: Boolean(action.unsupported),
    } : null,
    changeFloor: normalizeChangeFloor(action.changeFloor),
    estimate: normalizeEstimate(action.estimate),
  });
  if (!Array.isArray(normalized.path)) normalized.path = [];
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
  if (action.kind === "interactPickup") return `interactPickup|${floorId}|${targetLoc(action)}|${action.itemId || ""}|${action.direction || ""}`;
  if (action.kind === "battle") return `battle|${floorId}|${targetLoc(action)}|${action.enemyId || ""}`;
  if (action.kind === "openDoor") return `openDoor|${floorId}|${targetLoc(action)}|${action.doorId || ""}`;
  if (action.kind === "useTool") return `useTool|${floorId}|${targetLoc(action)}|${action.tool || ""}`;
  if (action.kind === "floorFly") return `floorFly|${floorId}|${action.targetFloorId || ""}|${(action.stance || {}).x ?? ""},${(action.stance || {}).y ?? ""}`;
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

function snapshotTileIdToNumber(project, tileId) {
  if (tileId == null) return null;
  const value = String(tileId);
  const unknownMatch = /^X(\d+)$/.exec(value);
  if (unknownMatch) return Number(unknownMatch[1]);
  const number = (project.mapNumbersById || {})[value];
  if (number == null) throw new Error(`Cannot restore snapshot tile id ${value}; tile id is not in project maps.`);
  return Number(number);
}

function applySnapshotFloorMutations(project, state, snapshotFloors) {
  Object.entries(snapshotFloors || {}).forEach(([floorId, floorSnapshot]) => {
    const floorState = ensureFloorState(state, floorId);
    (floorSnapshot.removed || []).forEach((loc) => {
      const key = String(loc);
      floorState.removed[key] = true;
      delete floorState.replaced[key];
    });
    (floorSnapshot.replaced || []).forEach((entry) => {
      const match = /^(\d+),(\d+)=(.+)$/.exec(String(entry));
      if (!match) throw new Error(`Cannot restore malformed replaced tile entry: ${entry}`);
      const key = `${Number(match[1])},${Number(match[2])}`;
      floorState.replaced[key] = snapshotTileIdToNumber(project, match[3]);
      delete floorState.removed[key];
    });
  });
}

function createStateFromSnapshot(project, snapshot, options) {
  if (!snapshot || !snapshot.floorId || !snapshot.hero) {
    throw new Error("Cannot restore state from missing route snapshot.");
  }
  const config = options || {};
  const state = createInitialState(project, { rank: config.rank || null });
  state.floorId = snapshot.floorId;
  state.hero = cloneJson(snapshot.hero) || {};
  state.inventory = cloneJson(snapshot.inventory) || {};
  state.flags = cloneJson(snapshot.flags) || {};
  state.floorStates = {};
  state.visitedFloors = Object.keys(snapshot.floors || {}).reduce((visited, floorId) => {
    visited[floorId] = true;
    return visited;
  }, {});
  state.visitedFloors[state.floorId] = true;
  state.triggeredAutoEvents = {};
  state.route = Array.isArray(config.route) ? config.route.slice() : [];
  state.notes = Array.isArray(config.notes) ? config.notes.slice() : [];
  state.meta = {
    rank: config.rank || null,
    decisionDepth: Number(config.decisionDepth || 0),
    autoStepCount: Number(config.autoStepCount || 0),
    autoPickupCount: Number(config.autoPickupCount || 0),
    autoBattleCount: Number(config.autoBattleCount || 0),
  };
  applySnapshotFloorMutations(project, state, snapshot.floors || {});
  return state;
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

function inferStructuredSnapshotFloors(entries) {
  const list = Array.isArray(entries) ? entries : [];
  for (const entry of list) {
    const snapshot = (entry && (entry.postSnapshot || entry.preSnapshot)) || null;
    if (snapshot && snapshot.partial) continue;
    const floors = snapshot && snapshot.floors ? Object.keys(snapshot.floors) : [];
    if (floors.length > 0) return floors;
  }
  return null;
}

function findActionBySummary(simulator, state, summary) {
  return listActionsBySummary(simulator, state, summary)[0] || null;
}

function listActionsBySummary(simulator, state, summary) {
  const actions = [];
  const seen = new Set();
  const add = (list) => {
    (list || []).forEach((action) => {
      if (!action || action.summary !== summary) return;
      const fingerprint = action.fingerprint || fingerprintAction(normalizeAction(action));
      if (seen.has(fingerprint)) return;
      seen.add(fingerprint);
      actions.push(action);
    });
  };
  try {
    add(simulator.enumerateActions(state));
  } catch (error) {
  }
  if (typeof simulator.enumeratePrimitiveActions === "function") {
    try {
      add(simulator.enumeratePrimitiveActions(state).actions || []);
    } catch (error) {
    }
  }
  if (typeof simulator.enumerateInteractPickupActions === "function") {
    try {
      add(simulator.enumerateInteractPickupActions(state));
    } catch (error) {
    }
  }
  if (typeof simulator.enumerateFloorFlyActions === "function") {
    try {
      add(simulator.enumerateFloorFlyActions(state));
    } catch (error) {
    }
  }
  return actions;
}

function listAllActionsBySummary(simulator, state, summary) {
  const actions = [];
  const add = (list) => {
    (list || []).forEach((action) => {
      if (action && action.summary === summary) actions.push(action);
    });
  };
  try {
    add(simulator.enumerateActions(state));
  } catch (error) {
  }
  if (typeof simulator.enumeratePrimitiveActions === "function") {
    try {
      add(simulator.enumeratePrimitiveActions(state).actions || []);
    } catch (error) {
    }
  }
  if (typeof simulator.enumerateInteractPickupActions === "function") {
    try {
      add(simulator.enumerateInteractPickupActions(state));
    } catch (error) {
    }
  }
  if (typeof simulator.enumerateFloorFlyActions === "function") {
    try {
      add(simulator.enumerateFloorFlyActions(state));
    } catch (error) {
    }
  }
  return actions;
}

function listRecordedActionCandidates(simulator, state, actionProvider) {
  if (typeof actionProvider === "function") {
    try {
      const provided = actionProvider(simulator, state);
      return Array.isArray(provided) ? provided : ((provided && provided.actions) || []);
    } catch (error) {
      return [];
    }
  }
  const actions = [];
  const seen = new Set();
  const add = (list) => {
    (list || []).forEach((action) => {
      if (!action) return;
      let key;
      try {
        key = action.fingerprint || fingerprintAction(normalizeAction(action));
      } catch (error) {
        key = action.summary || action.kind || "unknown";
      }
      if (seen.has(key)) return;
      seen.add(key);
      actions.push(action);
    });
  };
  try {
    add(simulator.enumerateActions(state));
  } catch (error) {
  }
  if (typeof simulator.enumeratePrimitiveActions === "function") {
    try {
      add(simulator.enumeratePrimitiveActions(state).actions || []);
    } catch (error) {
    }
  }
  if (typeof simulator.enumerateInteractPickupActions === "function") {
    try {
      add(simulator.enumerateInteractPickupActions(state));
    } catch (error) {
    }
  }
  if (typeof simulator.enumerateFloorFlyActions === "function") {
    try {
      add(simulator.enumerateFloorFlyActions(state));
    } catch (error) {
    }
  }
  return actions;
}

function samePoint(left, right) {
  return Boolean(
    left &&
    right &&
    left.x != null &&
    right.x != null &&
    Number(left.x) === Number(right.x) &&
    Number(left.y) === Number(right.y),
  );
}

/**
 * Resolve one recorded decision against actions visible in the current state.
 * Post-state key and fingerprint are stronger evidence than a summary; summary
 * remains only as a compatibility fallback for old route records.
 */
function resolveRecordedAction(simulator, state, decision, options) {
  const config = options || {};
  if (!decision) return { action: null, reason: "missing-decision", candidates: 0 };
  let expected;
  try {
    expected = normalizeAction(decision);
  } catch (error) {
    expected = { ...decision };
  }
  const expectedFingerprint = decision.fingerprint || expected.fingerprint || null;
  const expectedPostStateKey = decision.postStateKey || null;
  const candidates = listRecordedActionCandidates(simulator, state, config.actionProvider);
  const keyBuilder = typeof config.postStateKeyBuilder === "function"
    ? config.postStateKeyBuilder
    : (nextState) => buildDominanceKey(nextState);
  const directCandidates = candidates.filter((action) => {
    try {
      const normalized = normalizeAction(action);
      return Boolean(
        (expectedFingerprint && normalized.fingerprint === expectedFingerprint) ||
        (expected.summary && normalized.summary === expected.summary) ||
        (expected.path && expected.path.length > 0 && samePath(normalized.path, expected.path)) ||
        (expected.target && samePoint(normalized.target, expected.target)) ||
        (expected.stance && samePoint(normalized.stance, expected.stance)),
      );
    } catch (error) {
      return false;
    }
  });
  const candidatesToScore = expectedPostStateKey && directCandidates.length > 0
    ? directCandidates
    : candidates;
  let best = null;

  for (const action of candidatesToScore) {
    let normalized;
    try {
      normalized = normalizeAction(action);
    } catch (error) {
      continue;
    }
    const postKeyMatches = Boolean(expectedPostStateKey) && (() => {
      try {
        const postState = simulator.applyAction(state, action);
        return keyBuilder(postState) === expectedPostStateKey;
      } catch (error) {
        return false;
      }
    })();
    const fingerprintMatches = Boolean(expectedFingerprint) && normalized.fingerprint === expectedFingerprint;
    const pathMatches = samePath(normalized.path, expected.path);
    const structuralMatches = Boolean(
      (expected.target && samePoint(normalized.target, expected.target)) ||
      (expected.stance && samePoint(normalized.stance, expected.stance)) ||
      (expected.direction && normalized.direction === expected.direction),
    );
    const summaryMatches = Boolean(expected.summary) && normalized.summary === expected.summary;
    const kindMatches = Boolean(expected.kind) && normalized.kind === expected.kind;
    let score = 0;
    let matchType = "none";
    if (postKeyMatches) {
      score += 1000000000000;
      matchType = "postStateKey";
    } else if (fingerprintMatches) {
      score += 1000000000;
      matchType = "fingerprint";
    } else if (pathMatches && expected.path && expected.path.length > 0) {
      score += 1000000;
      matchType = "path";
    } else if (structuralMatches) {
      score += 10000;
      matchType = "target-stance-direction";
    } else if (summaryMatches) {
      score += 100;
      matchType = "summary";
    }
    if (kindMatches) score += 10;
    if (score === 0) continue;
    if (!best || score > best.score) {
      best = {
        action,
        normalizedAction: normalized,
        score,
        matchType,
        postKeyMatches,
        fingerprintMatches,
        pathMatches,
        structuralMatches,
        summaryMatches,
      };
    }
  }
  if (!best) {
    return {
      action: null,
      reason: candidates.length > 0 ? "recorded-action-not-matched" : "no-visible-actions",
      candidates: candidates.length,
    };
  }
  return { ...best, candidates: candidates.length };
}

function routeEntrySummary(entry) {
  return typeof entry === "string" ? entry : (entry && entry.summary);
}

function emittedRouteSummaries(preState, postState) {
  const beforeLength = Array.isArray(preState.route) ? preState.route.length : 0;
  return (Array.isArray(postState.route) ? postState.route.slice(beforeLength) : [])
    .map(routeEntrySummary)
    .filter(Boolean);
}

function countExpectedEmissionMatches(emitted, expectedRouteEntries, startIndex) {
  if (!Array.isArray(expectedRouteEntries) || expectedRouteEntries.length === 0) return 0;
  let matches = 0;
  for (; matches < emitted.length && startIndex + matches < expectedRouteEntries.length; matches += 1) {
    if (emitted[matches] !== routeEntrySummary(expectedRouteEntries[startIndex + matches])) break;
  }
  return matches;
}

function samePath(left, right) {
  const leftPath = Array.isArray(left) ? left : [];
  const rightPath = Array.isArray(right) ? right : [];
  if (leftPath.length !== rightPath.length) return false;
  for (let index = 0; index < leftPath.length; index += 1) {
    if (leftPath[index] !== rightPath[index]) return false;
  }
  return true;
}

function scoreActionReplayMatch(context, action, expected, expectedRouteEntries, startIndex) {
  const normalized = normalizeAction(action);
  let score = 0;
  if (expected.summary && normalized.summary === expected.summary) score += 1000000;
  if (expected.fingerprint && normalized.fingerprint === expected.fingerprint) score += 500000;
  if (expected.kind && normalized.kind === expected.kind) score += 100000;
  if (samePath(normalized.path, expected.path)) score += 50000;
  if (expected.floorId && normalized.floorId === expected.floorId) score += 10000;
  if (expected.target && normalized.target && expected.target.x === normalized.target.x && expected.target.y === normalized.target.y) score += 10000;
  if (expected.stance && normalized.stance && expected.stance.x === normalized.stance.x && expected.stance.y === normalized.stance.y) score += 5000;
  if (expected.direction && normalized.direction === expected.direction) score += 1000;
  if (expected.enemyId && normalized.enemyId === expected.enemyId) score += 1000;
  if (expected.itemId && normalized.itemId === expected.itemId) score += 1000;
  if (expected.doorId && normalized.doorId === expected.doorId) score += 1000;
  if (expected.targetFloorId && normalized.targetFloorId === expected.targetFloorId) score += 1000;

  if (Array.isArray(expectedRouteEntries)) {
    try {
      const postState = context.simulator.applyAction(context.currentState, action);
      const emitted = emittedRouteSummaries(context.currentState, postState);
      const matched = countExpectedEmissionMatches(emitted, expectedRouteEntries, startIndex || 0);
      score += matched * 100000 - Math.abs(emitted.length - matched);
    } catch (error) {
      score -= 1000000;
    }
  }
  return score;
}

function selectActionBySummary(context, summary, expectedRouteEntries, startIndex) {
  const actions = listActionsBySummary(context.simulator, context.currentState, summary);
  if (actions.length <= 1 || !Array.isArray(expectedRouteEntries)) return actions[0] || null;
  let best = null;
  for (const action of actions) {
    let postState = null;
    try {
      postState = context.simulator.applyAction(context.currentState, action);
    } catch (error) {
      continue;
    }
    const emitted = emittedRouteSummaries(context.currentState, postState);
    const matched = countExpectedEmissionMatches(emitted, expectedRouteEntries, startIndex);
    const score = matched * 100000 - Math.abs(emitted.length - matched);
    if (!best || score > best.score) best = { action, emitted, matched, score };
  }
  return best ? best.action : actions[0] || null;
}

function listReplayActions(context, expected) {
  const summary = expected && expected.summary;
  const actions = summary ? listAllActionsBySummary(context.simulator, context.currentState, summary) : [];
  if (actions.length > 0) return actions;
  const fallback = [];
  const seen = new Set();
  const add = (list) => {
    (list || []).forEach((action) => {
      if (!action) return;
      const normalized = normalizeAction(action);
      if (expected && expected.kind && normalized.kind !== expected.kind) return;
      const key = normalized.fingerprint || `${normalized.kind}:${normalized.summary}`;
      if (seen.has(key)) return;
      seen.add(key);
      fallback.push(action);
    });
  };
  try {
    add(context.simulator.enumerateActions(context.currentState));
  } catch (error) {
  }
  if (typeof context.simulator.enumeratePrimitiveActions === "function") {
    try {
      add(context.simulator.enumeratePrimitiveActions(context.currentState).actions || []);
    } catch (error) {
    }
  }
  if (typeof context.simulator.enumerateInteractPickupActions === "function") {
    try {
      add(context.simulator.enumerateInteractPickupActions(context.currentState));
    } catch (error) {
    }
  }
  if (typeof context.simulator.enumerateFloorFlyActions === "function") {
    try {
      add(context.simulator.enumerateFloorFlyActions(context.currentState));
    } catch (error) {
    }
  }
  return fallback;
}

function selectStructuredReplayAction(context, entry) {
  const expected = normalizeAction(entry.actionEntry);
  const candidates = listReplayActions(context, expected);
  let best = null;
  for (const action of candidates) {
    let score = Number.NEGATIVE_INFINITY;
    try {
      score = scoreActionReplayMatch(context, action, expected, null, 0);
    } catch (error) {
      continue;
    }
    if (!best || score > best.score) best = { action, score };
  }
  return best ? best.action : null;
}

function actionFingerprintForPlanEntry(action) {
  if (!action) return "";
  const floorId = action.floorId || "";
  if (action.kind === "battle") {
    const target = action.target || {};
    return `battle|${floorId}|${target.x}|${target.y}|${action.enemyId || ""}`;
  }
  if (action.kind === "pickup") return `pickup|${floorId}|${action.x}|${action.y}|${action.itemId || ""}`;
  if (action.kind === "interactPickup") return `interactPickup|${floorId}|${action.x}|${action.y}|${action.itemId || ""}|${action.direction || ""}`;
  if (action.kind === "openDoor") {
    const target = action.target || {};
    return `openDoor|${floorId}|${target.x}|${target.y}|${action.doorId || ""}`;
  }
  if (action.kind === "useTool") {
    const target = action.target || {};
    return `useTool|${floorId}|${action.tool || ""}|${target.x ?? ""}|${target.y ?? ""}`;
  }
  if (action.kind === "equip") return `equip|${floorId}|${action.equipId || action.itemId || ""}`;
  if (action.kind === "floorFly") return `floorFly|${floorId}|${action.targetFloorId || ""}|${((action.stance || {}).x) ?? ""},${((action.stance || {}).y) ?? ""}`;
  if (action.kind === "event") {
    const choicePath = Array.isArray(action.choicePath) ? action.choicePath.join(".") : "";
    return `event|${floorId}|${action.x}|${action.y}|${action.summary || ""}|${choicePath}`;
  }
  return `${action.kind}|${action.summary || ""}`;
}

function findPrimitiveByPlanEntry(simulator, state, entry) {
  const primitiveActions = simulator.enumeratePrimitiveActions(state).actions;
  if (entry && entry.fingerprint) {
    const matched = primitiveActions.find((action) => actionFingerprintForPlanEntry(action) === entry.fingerprint);
    if (matched) return matched;
  }
  if (entry && entry.summary) return primitiveActions.find((action) => action.summary === entry.summary) || null;
  return null;
}

function hasStructuredActionFields(action) {
  if (!action || !action.kind) return false;
  if (action.kind === "equip") return Boolean(action.equipId);
  if (action.kind === "useTool") return Boolean(action.tool);
  if (action.kind === "floorFly") return Boolean(action.targetFloorId);
  if (action.kind === "battle") return Boolean(action.target && action.target.x != null && action.target.y != null && action.enemyId);
  if (action.kind === "pickup") return Boolean(action.target && action.target.x != null && action.target.y != null && action.itemId);
  if (action.kind === "interactPickup") return Boolean(action.target && action.target.x != null && action.target.y != null && action.itemId && action.direction);
  if (action.kind === "openDoor") return Boolean(action.target && action.target.x != null && action.target.y != null && action.doorId);
  if (action.kind === "changeFloor") return Boolean(action.target && action.target.x != null && action.target.y != null);
  if (action.kind === "event") return Boolean(action.target && action.target.x != null && action.target.y != null);
  return Boolean(action.summary);
}

function structuredActionEntriesFromNodes(nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) return [];
  const entries = nodes[0] && nodes[0].actionEntry !== undefined
    ? nodes.slice(1).map((node) => ({ actionEntry: node.actionEntry, preState: null, postState: node.state, postStateKey: node.stateKey }))
    : nodes.map((entry) => {
      if (entry && entry.actionEntry) return entry;
      return { actionEntry: entry, preState: null, postState: null, postStateKey: null };
    });
  if (nodes[0] && nodes[0].actionEntry !== undefined) {
    for (let index = 0; index < entries.length; index += 1) {
      entries[index].preState = nodes[index] && nodes[index].state;
      entries[index].preStateKey = nodes[index] && nodes[index].stateKey;
    }
  }
  return entries.filter((entry) => entry.actionEntry);
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

function pushStructuredDecision(context, entry) {
  const { project, decisions, snapshotOptions } = context;
  const preState = entry.preState || context.currentState || (entry.preSnapshot
    ? createStateFromSnapshot(project, entry.preSnapshot, { rank: context.rank || null })
    : null);
  const normalized = normalizeAction(entry.actionEntry);
  if (!hasStructuredActionFields(normalized)) {
    throw new Error(`Structured route action is missing replay fields: ${normalized.summary || normalized.kind}`);
  }
  let postState = entry.postState;
  const preSnapshot = entry.preSnapshot || (preState ? buildSolverSnapshot(project, preState, snapshotOptions) : null);
  const postSnapshot = entry.postSnapshot || (postState ? buildSolverSnapshot(project, postState, snapshotOptions) : null);
  if (!postState) {
    if (postSnapshot) {
      postState = createStateFromSnapshot(project, postSnapshot, { rank: context.rank || null });
      decisions.push({
        index: decisions.length + 1,
        ...normalized,
        preStateKey: entry.preStateKey || (preState ? buildDominanceKey(preState) : null),
        postStateKey: entry.postStateKey || buildDominanceKey(postState),
        preSnapshot,
        postSnapshot,
      });
      context.currentState = postState;
      return;
    }
    const replayAction = selectStructuredReplayAction(context, entry);
    if (!replayAction) {
      if (normalized.path.length > 0) {
        throw new Error(`Unable to reconstruct structured action with path while saving route: ${normalized.summary || normalized.kind}`);
      }
      pushDecision(context, entry.actionEntry);
      return;
    }
    pushDecision(context, replayAction);
    return;
  }
  decisions.push({
    index: decisions.length + 1,
    ...normalized,
    preStateKey: entry.preStateKey || (preState ? buildDominanceKey(preState) : null),
    postStateKey: entry.postStateKey || buildDominanceKey(postState),
    preSnapshot,
    postSnapshot,
  });
  context.currentState = postState;
}

function replayDecisionSummary(context, summary, expectedRouteEntries, startIndex) {
  const action = selectActionBySummary(context, summary, expectedRouteEntries, startIndex);
  if (!action) throw new Error(`Unable to reconstruct action while saving route: ${summary}`);
  if (replayMacroPlanEntries(context, action)) return;
  if ((action.kind === "resourcePocket" || action.kind === "resourceChain" || action.kind === "resourceCluster" || action.kind === "fightToLevelUp") && Array.isArray(action.plan)) {
    action.plan.forEach((nestedSummary) => replayDecisionSummary(context, nestedSummary));
    return;
  }
  pushDecision(context, action);
}

function replayMacroPlanEntries(context, actionEntry) {
  if ((actionEntry.kind === "resourcePocket" || actionEntry.kind === "resourceChain" || actionEntry.kind === "resourceCluster") && Array.isArray(actionEntry.planEntries)) {
    actionEntry.planEntries.forEach((entry) => {
      const primitiveAction = findPrimitiveByPlanEntry(context.simulator, context.currentState, entry);
      if (!primitiveAction) throw new Error(`Unable to expand ${actionEntry.kind} step while saving route: ${entry.summary || entry.fingerprint}`);
      pushDecision(context, primitiveAction);
    });
    return true;
  }
  if (actionEntry.kind === "fightToLevelUp" && Array.isArray(actionEntry.plan)) {
    actionEntry.plan.forEach((summary) => {
      const battleAction = context.simulator.enumerateBattleActionsOnly(context.currentState).find((candidate) => candidate.summary === summary);
      if (!battleAction) throw new Error(`Unable to expand fightToLevelUp step while saving route: ${summary}`);
      pushDecision(context, battleAction);
    });
    return true;
  }
  return false;
}

function replayStructuredEntry(context, entry) {
  if (entry.actionEntry && replayMacroPlanEntries(context, entry.actionEntry)) return;
  try {
    const normalized = normalizeAction(entry.actionEntry);
    if (hasStructuredActionFields(normalized)) {
      pushStructuredDecision(context, entry);
      return;
    }
  } catch (error) {
    // Fall through to summary reconstruction when a structured entry is incomplete.
  }
  if (!entry.actionEntry || !entry.actionEntry.summary) {
    throw new Error("Structured route entry is missing both replay fields and summary fallback.");
  }
  replayDecisionSummary(context, entry.actionEntry.summary);
}

function countSourceEntriesConsumed(emitted, sourceEntries, sourceIndex) {
  const matched = countExpectedEmissionMatches(emitted, sourceEntries, sourceIndex);
  return Math.max(1, matched);
}

function buildRouteRecord(input) {
  const { project, simulator, finalState } = input;
  const options = input.options || {};
  const initialState = input.initialState || simulator.createInitialState({ rank: options.rank || "chaos" });
  const structuredSource = input.nodes || input.actionEntries || finalState.routeTrace || [];
  const snapshotFloors = inferStructuredSnapshotFloors(structuredSource) || resolveSnapshotFloors(project, initialState, finalState, options);
  const snapshotOptions = { floorIds: snapshotFloors };
  const decisions = [];
  const context = {
    project,
    simulator,
    decisions,
    snapshotOptions,
    currentState: initialState,
    rank: options.rank || "chaos",
  };
  const routeEntries = Array.isArray(finalState.route) ? finalState.route : [];
  const structuredEntries = structuredActionEntriesFromNodes(structuredSource);
  if (structuredEntries.length > 0) {
    structuredEntries.forEach((entry) => replayStructuredEntry(context, entry));
  } else {
    for (let index = 0; index < routeEntries.length; index += 1) {
      const summary = routeEntrySummary(routeEntries[index]);
      if (!isDecisionStep(summary)) continue;
      const beforeLength = Array.isArray(context.currentState.route) ? context.currentState.route.length : 0;
      if (routeEntries[index] && typeof routeEntries[index] === "object" && routeEntries[index].kind) {
        replayStructuredEntry(context, { actionEntry: routeEntries[index], preState: null, postState: null, postStateKey: null });
      } else {
        replayDecisionSummary(context, summary, routeEntries, index);
      }
      const emitted = (Array.isArray(context.currentState.route) ? context.currentState.route.slice(beforeLength) : [])
        .map(routeEntrySummary)
        .filter(Boolean);
      index += countSourceEntriesConsumed(emitted, routeEntries, index) - 1;
    }
  }
  const finalSnapshot = buildSolverSnapshot(project, context.currentState, snapshotOptions);
  if (structuredEntries.length > 0 && decisions.length > 0) {
    decisions[decisions.length - 1].postSnapshot = finalSnapshot;
    decisions[decisions.length - 1].postStateKey = buildDominanceKey(context.currentState);
  }
  const expectedKey = buildDominanceKey(finalState);
  const actualKey = buildDominanceKey(context.currentState);
  const notes = Array.isArray(finalState.notes) ? finalState.notes.slice() : [];
  if (expectedKey !== actualKey) {
    const message = `route-store: reconstructed dominance key differs from source final key; source=${expectedKey}; reconstructed=${actualKey}`;
    if (options.allowRouteMismatch !== true) throw new Error(message);
    notes.push(message);
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
    metadata: options.metadata || null,
    stats: {
      expanded: options.expanded == null ? null : Number(options.expanded),
      generated: options.generated == null ? null : Number(options.generated),
      depth: structuredEntries.length > 0 ? decisions.length : getDecisionDepth(context.currentState),
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
  createStateFromSnapshot,
  fingerprintAction,
  listRecordedActionCandidates,
  normalizeAction,
  readRouteFile,
  resolveRecordedAction,
  writeRouteFile,
};
