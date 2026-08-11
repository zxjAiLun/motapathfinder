"use strict";

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

const { createInitialState, ensureFloorState, getDecisionDepth } = require("./state");
const { buildDominanceKey, buildStateKey } = require("./state-key");
const { isDecisionStep } = require("./updown-candidate-policy");
const { buildSolverSnapshot, diffSnapshotSubset } = require("./route-snapshot");
const { compileObjectiveSpec, objectiveMetadata } = require("./objective-spec");
const { getSolverSnapshotHeroFields, normalizeSolverModel } = require("./solver-model");

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

function objectiveStateFromRouteSnapshot(snapshot, metrics) {
  const decisionDepth = typeof metrics === "object"
    ? Math.max(0, Number(metrics.decisionDepth || 0))
    : Math.max(0, Number(metrics || 0));
  const routeLength = typeof metrics === "object"
    ? Math.max(0, Number(metrics.routeLength == null ? metrics.decisionDepth : metrics.routeLength))
    : decisionDepth;
  return {
    hero: (snapshot && snapshot.hero) || {},
    inventory: (snapshot && snapshot.inventory) || {},
    route: Array.from({ length: routeLength }, () => null),
    meta: { decisionDepth },
  };
}

// Recompute objective metadata after composing routes.  The suffix metadata
// only reflects the suffix's own metrics; a composed route's route-length /
// decision-depth objective values change once prefix and suffix are
// concatenated.  decisionDepth is the composed decision count; routeLength is
// the composed full route length (rawRoute steps, which include auto-steps and
// are NOT the same as the decision count).  This is fail-closed: recompute from
// the composed final snapshot and composed metrics, or drop the stale metadata
// rather than persisting a value that strict live replay would reject.
function recomputeComposedObjectiveMetadata(metadata, finalSnapshot, metrics) {
  if (!metadata || !metadata.objectiveSpec || !metadata.objectiveFingerprint) return;
  const objective = compileObjectiveSpec(
    metadata.objectiveSpec,
    null,
    { maintainedHeroFields: metadata.solverSnapshotHeroFields },
  );
  if (!objective.explicit) return;
  const evaluation = objective.evaluateState(
    objectiveStateFromRouteSnapshot(finalSnapshot, metrics),
  );
  Object.assign(metadata, objectiveMetadata(objective, evaluation));
}

function composeRouteRecords(prefixRecord, suffixRecord, options) {
  const prefix = prefixRecord || {};
  const suffix = suffixRecord || {};
  const config = options || {};
  if (prefix.schema !== ROUTE_SCHEMA || suffix.schema !== ROUTE_SCHEMA) {
    throw new Error("route-store: composed routes require matching route schema records");
  }
  const prefixFinalExactStateKey = prefix.final && prefix.final.exactStateKey;
  const suffixStartExactStateKey = suffix.start && suffix.start.exactStateKey;
  if (!prefixFinalExactStateKey || !suffixStartExactStateKey) {
    throw new Error("route-store: composed routes require exact boundary state keys");
  }
  if (prefixFinalExactStateKey !== suffixStartExactStateKey) {
    throw new Error("route-store: composed route exact boundary mismatch");
  }
  const prefixObjectiveFingerprint = prefix.metadata && prefix.metadata.objectiveFingerprint || null;
  const suffixObjectiveFingerprint = suffix.metadata && suffix.metadata.objectiveFingerprint || null;
  if (prefixObjectiveFingerprint !== suffixObjectiveFingerprint && (prefixObjectiveFingerprint || suffixObjectiveFingerprint)) {
    throw new Error("route-store: composed route objective fingerprint mismatch");
  }
  const prefixDecisions = Array.isArray(prefix.decisions) ? prefix.decisions : [];
  const suffixDecisions = Array.isArray(suffix.decisions) ? suffix.decisions : [];
  const firstSuffixDecision = suffixDecisions[0];
  if (firstSuffixDecision && firstSuffixDecision.preExactStateKey !== prefixFinalExactStateKey) {
    throw new Error("route-store: composed route first suffix pre-state does not match boundary");
  }
  const decisions = prefixDecisions.concat(
    suffixDecisions.map((decision, index) => ({
      ...decision,
      index: prefixDecisions.length + index + 1,
    })),
  );
  const source = cloneJson(suffix.source || prefix.source || {});
  if (config.commit) source.commit = config.commit;
  const metadata = cloneJson(suffix.metadata || {}) || {};
  metadata.kind = "composed-route";
  metadata.composedFrom = {
    prefixSourceCommit: prefix.source && prefix.source.commit || null,
    suffixSourceCommit: suffix.source && suffix.source.commit || null,
    prefixGoal: cloneJson(prefix.goal),
    suffixGoal: cloneJson(suffix.goal),
    prefixDecisionCount: prefixDecisions.length,
    suffixDecisionCount: suffixDecisions.length,
    boundaryExactStateKey: prefixFinalExactStateKey,
  };
  const rawPrefix = Array.isArray(prefix.rawRoute) ? prefix.rawRoute : [];
  const rawSuffix = Array.isArray(suffix.rawRoute) ? suffix.rawRoute : [];
  const hasNumericStat = (record, field) => record.stats && record.stats[field] != null && Number.isFinite(Number(record.stats[field]));
  const notes = [];
  [...(prefix.notes || []), ...(suffix.notes || [])].forEach((note) => {
    if (!notes.includes(note)) notes.push(note);
  });
  notes.push(
    `Composed from ${config.prefixFile || "prefix route"} and ${config.suffixFile || "suffix route"}; exact boundary verified.`,
  );
  const composedRawRoute = rawPrefix.concat(rawSuffix);
  recomputeComposedObjectiveMetadata(
    metadata,
    suffix.final && suffix.final.snapshot,
    {
      decisionDepth: decisions.length,
      routeLength: composedRawRoute.length,
    },
  );
  return {
    schema: ROUTE_SCHEMA,
    createdAt: new Date().toISOString(),
    source,
    goal: cloneJson(suffix.goal || prefix.goal),
    metadata,
    stats: {
      expanded: hasNumericStat(prefix, "expanded") && hasNumericStat(suffix, "expanded")
        ? Number(prefix.stats.expanded) + Number(suffix.stats.expanded)
        : null,
      generated: hasNumericStat(prefix, "generated") && hasNumericStat(suffix, "generated")
        ? Number(prefix.stats.generated) + Number(suffix.stats.generated)
        : null,
      depth: decisions.length,
      routeLength: composedRawRoute.length,
    },
    start: cloneJson(prefix.start),
    final: cloneJson(suffix.final),
    decisions,
    rawRoute: composedRawRoute,
    notes,
  };
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
  const state = createInitialState(project, {
    rank: config.rank || null,
    solverModel: config.solverModel || null,
  });
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
  if (config.solverModel) {
    const solverModel = normalizeSolverModel(config.solverModel);
    if (solverModel.explicit) state.meta.modelFingerprint = solverModel.fingerprint;
  }
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

function resolveStartSnapshotFloors(project, initialState, options) {
  const configured = options && options.startSnapshotFloors;
  if (Array.isArray(configured) && configured.length > 0) return configured;
  const visitedFloors = Object.keys((initialState && initialState.visitedFloors) || {});
  const floorIds = visitedFloors.length > 0
    ? visitedFloors
    : Object.keys((initialState && initialState.floorStates) || {});
  floorIds.push(initialState && initialState.floorId);
  return Array.from(new Set(floorIds.filter(Boolean)))
    .filter((floorId) => project.floorsById[floorId]);
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

// A recorded choice fingerprint intentionally answers "what did the player
// choose?" and therefore does not include the walk/travel state used to reach
// that choice. Replay enumeration must retain those travel variants until the
// recorded post-state can disambiguate them. This key only removes the same
// variant returned by multiple simulator enumeration APIs.
function recordedActionVariantIdentity(action) {
  const normalized = normalizeAction(action);
  let travelStateKey = null;
  if (action && action.travelState) {
    try {
      travelStateKey = buildStateKey(action.travelState);
    } catch (error) {
      try {
        travelStateKey = JSON.stringify(action.travelState);
      } catch (nestedError) {
        travelStateKey = "unserializable-travel-state";
      }
    }
  }
  return JSON.stringify({
    choiceFingerprint: normalized.fingerprint,
    action: normalized,
    travelStateKey,
  });
}

function enumerateRecordedActionCandidates(simulator, state, actionProvider) {
  const errors = [];
  if (typeof actionProvider === "function") {
    try {
      const provided = actionProvider(simulator, state);
      const providedActions = Array.isArray(provided)
        ? provided
        : ((provided && provided.actions) || []);
      return {
        actions: providedActions,
        errors: errors.concat((provided && provided.errors) || []),
      };
    } catch (error) {
      errors.push({
        source: "action-provider",
        name: error && error.name ? error.name : "Error",
        message: error && error.message ? error.message : String(error),
      });
      return { actions: [], errors };
    }
  }
  const actions = [];
  const seen = new Set();
  const add = (list) => {
    (list || []).forEach((action) => {
      if (!action) return;
      let key;
      try {
        key = recordedActionVariantIdentity(action);
      } catch (error) {
        key = JSON.stringify({
          summary: action.summary || null,
          kind: action.kind || null,
          path: Array.isArray(action.path) ? action.path : [],
          stance: action.stance || null,
          direction: action.direction || null,
        });
      }
      if (seen.has(key)) return;
      seen.add(key);
      actions.push(action);
    });
  };
  if (typeof simulator.enumerateActions === "function") {
    try {
      add(simulator.enumerateActions(state));
    } catch (error) {
      errors.push({ source: "enumerateActions", name: error.name || "Error", message: error.message || String(error) });
    }
  }
  if (typeof simulator.enumeratePrimitiveActions === "function") {
    try {
      add(simulator.enumeratePrimitiveActions(state).actions || []);
    } catch (error) {
      errors.push({ source: "enumeratePrimitiveActions", name: error.name || "Error", message: error.message || String(error) });
    }
  }
  if (typeof simulator.enumerateInteractPickupActions === "function") {
    try {
      add(simulator.enumerateInteractPickupActions(state));
    } catch (error) {
      errors.push({ source: "enumerateInteractPickupActions", name: error.name || "Error", message: error.message || String(error) });
    }
  }
  if (typeof simulator.enumerateFloorFlyActions === "function") {
    try {
      add(simulator.enumerateFloorFlyActions(state));
    } catch (error) {
      errors.push({ source: "enumerateFloorFlyActions", name: error.name || "Error", message: error.message || String(error) });
    }
  }
  return { actions, errors };
}

function listRecordedActionCandidates(simulator, state, actionProvider) {
  return enumerateRecordedActionCandidates(simulator, state, actionProvider).actions;
}

function samePoint(left, right) {
  return Boolean(
    left &&
    right &&
    left.x != null &&
    right.x != null &&
    (!left.floorId || !right.floorId || left.floorId === right.floorId) &&
    Number(left.x) === Number(right.x) &&
    Number(left.y) === Number(right.y),
  );
}

function compareTuples(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1;
  }
  return 0;
}

function snapshotMatches(project, state, expectedSnapshot, simulator) {
  if (!project || !state || !expectedSnapshot) return false;
  try {
    const floorIds = Object.keys(expectedSnapshot.floors || {});
    const actual = buildSolverSnapshot(project, state, {
      floorIds,
      solverModel: simulator && simulator.solverModel,
    });
    return expectedSnapshot.partial
      ? diffSnapshotSubset(expectedSnapshot, actual) == null
      : JSON.stringify(actual) === JSON.stringify(expectedSnapshot);
  } catch (error) {
    return false;
  }
}

/**
 * Resolve one recorded decision against actions visible in the current state.
 * Exact post-state identity is primary; postDominanceKey is coarse evidence,
 * and summary remains only as a compatibility fallback for old route records.
 * Structured route reconstruction still uses its legacy matcher until this
 * resolver's ambiguity contract is adopted by that write path.
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
  const expectedPostDominanceKey = decision.postDominanceKey || decision.postStateKey || null;
  const expectedPostExactStateKey = decision.postExactStateKey || null;
  const expectedPostSnapshot = decision.postSnapshot || null;
  const candidateResult = Array.isArray(config.candidates)
    ? {
        actions: config.candidates,
        errors: Array.isArray(config.candidateErrors) ? config.candidateErrors : [],
      }
    : enumerateRecordedActionCandidates(simulator, state, config.actionProvider);
  const candidates = candidateResult.actions;
  const enumerationErrors = candidateResult.errors || [];
  if (enumerationErrors.length > 0) {
    const providerError = enumerationErrors.some((error) => error && error.source === "action-provider");
    return {
      action: null,
      reason: providerError ? "action-provider-error" : "action-enumeration-error",
      errorType: providerError ? "action-provider-error" : "action-enumeration-error",
      errors: enumerationErrors,
      candidates: candidates.length,
    };
  }
  const dominanceKeyBuilder = typeof config.postStateKeyBuilder === "function"
    ? config.postStateKeyBuilder
    : (nextState) => buildDominanceKey(nextState);
  const exactStateKeyBuilder = typeof config.postExactStateKeyBuilder === "function"
    ? config.postExactStateKeyBuilder
    : (nextState) => buildStateKey(nextState);
  const hasPostEvidence = Boolean(
    expectedPostDominanceKey || expectedPostExactStateKey || expectedPostSnapshot,
  );
  let best = null;
  const tied = [];
  let choiceAliasCount = 0;
  let exactPostAliasCount = 0;

  for (const action of candidates) {
    let normalized;
    try {
      normalized = normalizeAction(action);
    } catch (error) {
      continue;
    }
    let postState = null;
    let applyError = null;
    if (hasPostEvidence) {
      try {
        postState = simulator.applyAction(state, action);
      } catch (error) {
        applyError = error;
      }
    }
    const postDominanceKeyMatches = Boolean(expectedPostDominanceKey && postState) && (() => {
      try {
        return dominanceKeyBuilder(postState) === expectedPostDominanceKey;
      } catch (error) {
        return false;
      }
    })();
    const postExactStateKeyMatches = Boolean(expectedPostExactStateKey && postState) && (() => {
      try {
        return exactStateKeyBuilder(postState) === expectedPostExactStateKey;
      } catch (error) {
        return false;
      }
    })();
    const postSnapshotMatches = snapshotMatches(
      config.project || simulator.project,
      postState,
      expectedPostSnapshot,
      simulator,
    );
    const fingerprintMatches = Boolean(expectedFingerprint) && normalized.fingerprint === expectedFingerprint;
    if (fingerprintMatches) choiceAliasCount += 1;
    const pathMatches = Array.isArray(expected.path) && expected.path.length > 0 && samePath(normalized.path, expected.path);
    const structuralFields = [];
    if (expected.target) structuralFields.push(samePoint(normalized.target, expected.target));
    if (expected.stance) structuralFields.push(samePoint(normalized.stance, expected.stance));
    if (expected.direction) structuralFields.push(normalized.direction === expected.direction);
    const structuralMatches = structuralFields.length > 0 && structuralFields.every(Boolean);
    const structuralMatchCount = structuralMatches ? structuralFields.length : 0;
    if (structuralFields.length > 0 && !structuralMatches) continue;
    const summaryMatches = Boolean(expected.summary) && normalized.summary === expected.summary;
    const kindMatches = Boolean(expected.kind) && normalized.kind === expected.kind;
    const tuple = [
      postExactStateKeyMatches || postSnapshotMatches ? 1 : 0,
      postDominanceKeyMatches ? 1 : 0,
      fingerprintMatches ? 1 : 0,
      pathMatches ? 1 : 0,
      structuralMatchCount,
      summaryMatches ? 1 : 0,
      kindMatches ? 1 : 0,
    ];
    if (tuple.every((value) => value === 0)) continue;
    const matchType = postExactStateKeyMatches || postSnapshotMatches
      ? "postExactState"
      : postDominanceKeyMatches
        ? "postDominanceKey"
        : fingerprintMatches
          ? "fingerprint"
          : pathMatches
            ? "path"
            : structuralMatches
              ? "target-stance-direction"
              : summaryMatches
                ? "summary"
                : "kind";
    const candidate = {
      action,
      normalizedAction: normalized,
      tuple,
      matchType,
      postExactStateKeyMatches,
      postDominanceKeyMatches,
      postSnapshotMatches,
      fingerprintMatches,
      pathMatches,
      structuralMatches,
      summaryMatches,
      applyError: applyError ? {
        name: applyError.name || "Error",
        message: applyError.message || String(applyError),
      } : null,
      variantIdentity: recordedActionVariantIdentity(action),
    };
    if (postExactStateKeyMatches) exactPostAliasCount += 1;
    if (!best) {
      best = candidate;
      tied.length = 0;
      tied.push(candidate);
      continue;
    }
    const comparison = compareTuples(tuple, best.tuple);
    if (comparison > 0) {
      best = candidate;
      tied.length = 0;
      tied.push(candidate);
    } else if (comparison === 0) {
      tied.push(candidate);
    }
  }
  if (!best) {
    return {
      action: null,
      reason: candidates.length > 0 ? "recorded-action-not-matched" : "no-visible-actions",
      candidates: candidates.length,
      choiceAliasCount,
      exactPostAliasCount,
    };
  }
  let exactPostTieBroken = false;
  if (tied.length > 1) {
    const allTiedMatchExactPost = Boolean(expectedPostExactStateKey) &&
      tied.every((candidate) => candidate.postExactStateKeyMatches);
    if (allTiedMatchExactPost) {
      tied.sort((left, right) => left.variantIdentity.localeCompare(right.variantIdentity));
      best = tied[0];
      exactPostTieBroken = true;
    } else {
      return {
        action: null,
        reason: "ambiguous-recorded-action",
        ambiguous: true,
        candidates: candidates.length,
        choiceAliasCount,
        exactPostAliasCount,
        matches: tied.map((candidate) => ({
          fingerprint: candidate.normalizedAction.fingerprint,
          summary: candidate.normalizedAction.summary,
          tuple: candidate.tuple,
          variantIdentity: candidate.variantIdentity,
        })).sort((left, right) => left.variantIdentity.localeCompare(right.variantIdentity)),
      };
    }
  }
  return {
    ...best,
    score: best.tuple,
    postDominanceKey: best.postDominanceKeyMatches ? expectedPostDominanceKey : null,
    postStateKey: best.postDominanceKeyMatches ? expectedPostDominanceKey : null,
    postExactStateKey: best.postExactStateKeyMatches ? expectedPostExactStateKey : null,
    candidates: candidates.length,
    choiceAliasCount,
    exactPostAliasCount,
    exactPostTieBroken,
    selectedByRecordedTravelEvidence:
      exactPostAliasCount > 1 && best.pathMatches === true && !exactPostTieBroken,
    selectedVariantIdentity: best.variantIdentity,
  };
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
    preDominanceKey: buildDominanceKey(preState),
    postDominanceKey: buildDominanceKey(postState),
    preExactStateKey: buildStateKey(preState),
    postExactStateKey: buildStateKey(postState),
    preSnapshot,
    postSnapshot,
  });
  context.currentState = postState;
}

function pushStructuredDecision(context, entry) {
  const { project, decisions, snapshotOptions } = context;
  const preState = entry.preState || context.currentState || (entry.preSnapshot
      ? createStateFromSnapshot(project, entry.preSnapshot, {
          rank: context.rank || null,
          solverModel: context.solverModel,
        })
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
      postState = createStateFromSnapshot(project, postSnapshot, {
        rank: context.rank || null,
        solverModel: context.solverModel,
      });
      decisions.push({
        index: decisions.length + 1,
        ...normalized,
        preStateKey: entry.preStateKey || (preState ? buildDominanceKey(preState) : null),
        postStateKey: entry.postStateKey || entry.postDominanceKey || buildDominanceKey(postState),
        preDominanceKey: entry.preDominanceKey || entry.preStateKey || (preState ? buildDominanceKey(preState) : null),
        postDominanceKey: entry.postDominanceKey || entry.postStateKey || buildDominanceKey(postState),
        preExactStateKey: entry.preExactStateKey || (preState ? buildStateKey(preState) : null),
        postExactStateKey: entry.postExactStateKey || buildStateKey(postState),
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
    postStateKey: entry.postStateKey || entry.postDominanceKey || buildDominanceKey(postState),
    preDominanceKey: entry.preDominanceKey || entry.preStateKey || (preState ? buildDominanceKey(preState) : null),
    postDominanceKey: entry.postDominanceKey || entry.postStateKey || buildDominanceKey(postState),
    preExactStateKey: entry.preExactStateKey || (preState ? buildStateKey(preState) : null),
    postExactStateKey: entry.postExactStateKey || buildStateKey(postState),
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

function strictReplayRecordedDecisions(project, simulator, initialState, decisions) {
  let state = initialState;
  for (let index = 0; index < decisions.length; index += 1) {
    const decision = decisions[index];
    if (decision.preExactStateKey && buildStateKey(state) !== decision.preExactStateKey) {
      throw new Error(`route-store: strict replay pre-state mismatch at decision ${index + 1}`);
    }
    const resolved = resolveRecordedAction(simulator, state, decision, { project });
    if (!resolved.action) {
      throw new Error(`route-store: strict replay action mismatch at decision ${index + 1}: ${resolved.reason}`);
    }
    try {
      state = simulator.applyAction(state, resolved.action);
    } catch (error) {
      throw new Error(`route-store: strict replay apply failed at decision ${index + 1}: ${error && error.message ? error.message : String(error)}`);
    }
    if (decision.postExactStateKey && buildStateKey(state) !== decision.postExactStateKey) {
      throw new Error(`route-store: strict replay post-state mismatch at decision ${index + 1}`);
    }
  }
  return state;
}

function buildRouteRecord(input) {
  const { project, simulator, finalState } = input;
  const options = input.options || {};
  const initialState = input.initialState || simulator.createInitialState({ rank: options.rank || "chaos" });
  const structuredSource = input.nodes || input.actionEntries || finalState.routeTrace || [];
  const snapshotFloors = inferStructuredSnapshotFloors(structuredSource) || resolveSnapshotFloors(project, initialState, finalState, options);
  const solverModel = simulator && simulator.solverModel ? simulator.solverModel : null;
  const objective = compileObjectiveSpec(
    options.objectiveSpec || options.objective || null,
    solverModel,
  );
  const snapshotOptions = {
    floorIds: snapshotFloors,
    solverModel,
  };
  const startSnapshotOptions = {
    floorIds: resolveStartSnapshotFloors(project, initialState, options),
    solverModel,
  };
  const solverSnapshotHeroFields = getSolverSnapshotHeroFields(solverModel);
  // Keep the caller-owned metadata reference: run-region-dp fills the
  // primitive count and final summary after route construction.
  const routeMetadata = options.metadata == null
    ? (solverModel && solverModel.explicit || objective.explicit ? {} : null)
    : options.metadata;
  if (solverModel && solverModel.explicit) {
    const metadata = routeMetadata || {};
    metadata.solverModelFingerprint = solverModel.fingerprint;
    metadata.solverSnapshotHeroFields = solverSnapshotHeroFields || [];
  }
  if (objective.explicit) {
    routeMetadata.objectiveSpec = objective.toJSON();
    routeMetadata.objectiveFingerprint = objective.fingerprint;
  }
  const decisions = [];
  const context = {
    project,
    simulator,
    decisions,
    snapshotOptions,
    solverModel,
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
    decisions[decisions.length - 1].postDominanceKey = buildDominanceKey(context.currentState);
    decisions[decisions.length - 1].postExactStateKey = buildStateKey(context.currentState);
  }
  const expectedKey = buildDominanceKey(finalState);
  const actualKey = buildDominanceKey(context.currentState);
  const expectedExactStateKey = buildStateKey(finalState);
  const actualExactStateKey = buildStateKey(context.currentState);
  const notes = Array.isArray(finalState.notes) ? finalState.notes.slice() : [];
  if (expectedKey !== actualKey) {
    const message = `route-store: reconstructed dominance key differs from source final key; source=${expectedKey}; reconstructed=${actualKey}`;
    if (options.allowRouteMismatch !== true) throw new Error(message);
    notes.push(message);
  }
  if (expectedExactStateKey !== actualExactStateKey) {
    throw new Error(
      `route-store: reconstructed exact state differs from source final state; source=${expectedExactStateKey}; reconstructed=${actualExactStateKey}`,
    );
  }
  if (typeof options.routeRecordObserver === "function") {
    try {
      options.routeRecordObserver({
        decisions: cloneJson(decisions),
        initialState: cloneJson(initialState),
        reconstructedState: cloneJson(context.currentState),
        expectedExactStateKey,
        reconstructedExactStateKey: actualExactStateKey,
      });
    } catch (error) {
      // Route-record observation is diagnostic-only and must not affect writes.
    }
  }
  const strictFinalState = strictReplayRecordedDecisions(project, simulator, initialState, decisions);
  const strictFinalExactStateKey = buildStateKey(strictFinalState);
  if (strictFinalExactStateKey !== expectedExactStateKey) {
    throw new Error(
      `route-store: strict replay final exact state differs from source final state; source=${expectedExactStateKey}; replay=${strictFinalExactStateKey}`,
    );
  }
  if (objective.explicit) {
    // Objective metrics are split: decisionDepth is the decision count, while
    // routeLength is the FULL candidate route length (auto-steps included),
    // which is what the objective's route.length reads and what the runtime
    // replay reproduces.  The decisions-replay state may under-count auto
    // steps, so it must not drive route.length objective values.
    const fullRouteLength = Array.isArray(finalState.route)
      ? finalState.route.length
      : decisions.length;
    const objectiveEvaluationState = objectiveStateFromRouteSnapshot(strictFinalState, {
      decisionDepth: decisions.length,
      routeLength: fullRouteLength,
    });
    Object.assign(routeMetadata, objectiveMetadata(objective, objective.evaluateState(objectiveEvaluationState)));
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
    metadata: routeMetadata,
    stats: {
      expanded: options.expanded == null ? null : Number(options.expanded),
      generated: options.generated == null ? null : Number(options.generated),
      depth: structuredEntries.length > 0 ? decisions.length : getDecisionDepth(context.currentState),
      routeLength: Array.isArray(finalState.route) ? finalState.route.length : 0,
    },
    start: {
      snapshot: buildSolverSnapshot(project, initialState, startSnapshotOptions),
      stateKey: buildDominanceKey(initialState),
      dominanceKey: buildDominanceKey(initialState),
      exactStateKey: buildStateKey(initialState),
    },
    final: {
      snapshot: finalSnapshot,
      stateKey: actualKey,
      dominanceKey: actualKey,
      exactStateKey: actualExactStateKey,
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
  enumerateRecordedActionCandidates,
  listRecordedActionCandidates,
  normalizeAction,
  recordedActionVariantIdentity,
  composeRouteRecords,
  readRouteFile,
  resolveRecordedAction,
  writeRouteFile,
};
