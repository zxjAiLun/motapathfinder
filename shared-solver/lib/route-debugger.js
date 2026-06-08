"use strict";

const path = require("node:path");

const { buildSolverSnapshot } = require("./route-snapshot");
const { createStateFromSnapshot, fingerprintAction, normalizeAction } = require("./route-store");
const { cloneState, getTileDefinitionAt } = require("./state");
const { buildDominanceKey, buildStateKey } = require("./state-key");

const HERO_FIELDS = [
  "hp",
  "hpmax",
  "mana",
  "manamax",
  "atk",
  "def",
  "mdef",
  "money",
  "exp",
  "lv",
];

function cloneJson(value) {
  if (value == null) return null;
  return JSON.parse(JSON.stringify(value));
}

function stableObject(object) {
  return Object.keys(object || {})
    .sort()
    .reduce((result, key) => {
      const value = object[key];
      if (value == null) return result;
      if (value === 0) return result;
      if (Array.isArray(value) && value.length === 0) return result;
      if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) return result;
      result[key] = value;
      return result;
    }, {});
}

function sortedKeys(...objects) {
  return Array.from(new Set(objects.flatMap((object) => Object.keys(object || {})))).sort();
}

function numberDelta(before, after) {
  const left = Number(before || 0);
  const right = Number(after || 0);
  return right - left;
}

function compactHero(hero) {
  const source = hero || {};
  const result = HERO_FIELDS.reduce((summary, field) => {
    summary[field] = Number(source[field] || 0);
    return summary;
  }, {});
  result.loc = cloneJson(source.loc || {});
  result.equipment = Array.isArray(source.equipment) ? source.equipment.slice() : [];
  return result;
}

function summarizeFlags(flags) {
  const source = flags || {};
  const keys = Object.keys(source).sort();
  return {
    count: keys.length,
    keys: keys.slice(0, 80),
    values: keys.slice(0, 80).reduce((result, key) => {
      const value = source[key];
      if (value == null) return result;
      if (typeof value === "object") return result;
      result[key] = value;
      return result;
    }, {}),
  };
}

function floorMutation(state, floorId) {
  const floorState = ((state || {}).floorStates || {})[floorId] || {};
  return {
    removed: Object.keys(floorState.removed || {}).sort(),
    replaced: Object.keys(floorState.replaced || {})
      .sort()
      .map((key) => `${key}=${floorState.replaced[key]}`),
  };
}

function floorMutationsSummary(state) {
  return Object.keys((state || {}).floorStates || {})
    .sort()
    .reduce((result, floorId) => {
      const mutation = floorMutation(state, floorId);
      if (mutation.removed.length || mutation.replaced.length) result[floorId] = mutation;
      return result;
    }, {});
}

function snapshotFloorMutation(snapshot, floorId) {
  return cloneJson((((snapshot || {}).floors || {})[floorId]) || { removed: [], replaced: [] });
}

function diffPrimitiveMap(before, after, category) {
  return sortedKeys(before, after).reduce((rows, key) => {
    const oldValue = before ? before[key] : undefined;
    const newValue = after ? after[key] : undefined;
    if (JSON.stringify(oldValue) === JSON.stringify(newValue)) return rows;
    rows.push({
      category,
      key,
      before: oldValue == null ? null : oldValue,
      after: newValue == null ? null : newValue,
    });
    return rows;
  }, []);
}

function diffHero(before, after) {
  const rows = [];
  const preHero = (before || {}).hero || {};
  const postHero = (after || {}).hero || {};
  HERO_FIELDS.forEach((field) => {
    if (JSON.stringify(preHero[field]) === JSON.stringify(postHero[field])) return;
    rows.push({
      category: "hero",
      key: field,
      before: preHero[field] == null ? null : preHero[field],
      after: postHero[field] == null ? null : postHero[field],
      delta: numberDelta(preHero[field], postHero[field]),
    });
  });
  if (JSON.stringify(preHero.loc || null) !== JSON.stringify(postHero.loc || null)) {
    rows.push({
      category: "hero",
      key: "loc",
      before: cloneJson(preHero.loc || null),
      after: cloneJson(postHero.loc || null),
    });
  }
  if (JSON.stringify(preHero.equipment || []) !== JSON.stringify(postHero.equipment || [])) {
    rows.push({
      category: "hero",
      key: "equipment",
      before: cloneJson(preHero.equipment || []),
      after: cloneJson(postHero.equipment || []),
    });
  }
  return rows;
}

function setAdded(before, after) {
  return Array.from(after).filter((item) => !before.has(item)).sort();
}

function setRemoved(before, after) {
  return Array.from(before).filter((item) => !after.has(item)).sort();
}

function diffFloors(before, after) {
  const preFloors = ((before || {}).floors) || {};
  const postFloors = ((after || {}).floors) || {};
  return sortedKeys(preFloors, postFloors).flatMap((floorId) => {
    const beforeFloor = preFloors[floorId] || {};
    const afterFloor = postFloors[floorId] || {};
    return ["removed", "replaced"].reduce((rows, field) => {
      const oldSet = new Set(beforeFloor[field] || []);
      const newSet = new Set(afterFloor[field] || []);
      const added = setAdded(oldSet, newSet);
      const removed = setRemoved(oldSet, newSet);
      if (added.length || removed.length || oldSet.size !== newSet.size) {
        rows.push({
          category: "floors",
          floorId,
          key: field,
          beforeCount: oldSet.size,
          afterCount: newSet.size,
          delta: newSet.size - oldSet.size,
          added,
          removed,
        });
      }
      return rows;
    }, []);
  });
}

function buildStepDelta(beforeSnapshot, afterSnapshot) {
  const inventory = diffPrimitiveMap((beforeSnapshot || {}).inventory, (afterSnapshot || {}).inventory, "inventory");
  inventory.forEach((row) => {
    row.delta = numberDelta(row.before, row.after);
  });
  return {
    hero: diffHero(beforeSnapshot, afterSnapshot),
    inventory,
    flags: diffPrimitiveMap((beforeSnapshot || {}).flags, (afterSnapshot || {}).flags, "flags"),
    floors: diffFloors(beforeSnapshot, afterSnapshot),
  };
}

function tileIdForNumber(project, number) {
  if (number == null || number === 0) return null;
  const tile = (project.mapTilesByNumber || {})[String(number)];
  return tile && tile.id ? tile.id : `X${number}`;
}

function tileMetaForNumber(project, number) {
  if (number == null || number === 0) return null;
  const tile = (project.mapTilesByNumber || {})[String(number)] || {};
  const id = tile.id || `X${number}`;
  const cls = tile.cls || "unknown";
  const item = cls === "items" ? (project.itemsById || {})[id] : null;
  const enemy = (cls === "enemys" || cls === "enemy48") ? (project.enemysById || {})[id] : null;
  return {
    number,
    id,
    cls,
    name: tile.name || (item && item.name) || (enemy && enemy.name) || null,
    wallLike: cls === "autotile" || cls === "unknown" || /^X\d+$/.test(id),
    sprite: spriteForTile(project, { id, cls }),
  };
}

function spriteForTile(project, tile) {
  const icons = project.icons || {};
  const cls = tile && tile.cls;
  const id = tile && tile.id;
  if (!cls || !id) return null;
  if (cls === "autotile") {
    return null;
  }
  const iconGroup = icons[cls] || {};
  const index = iconGroup[id];
  if (!Number.isFinite(Number(index))) {
    if (cls === "unknown" || /^X\d+$/.test(id)) return null;
    return null;
  }
  const numeric = Number(index);
  const frame = cls === "enemy48" || cls === "npc48"
    ? { width: 32, height: 48, sheetWidth: 32 }
    : cls === "animates"
      ? { width: 32, height: 32, sheetWidth: 128 }
      : cls === "enemys"
        ? { width: 32, height: 32, sheetWidth: 64 }
        : { width: 32, height: 32, sheetWidth: 32 };
  const columns = Math.max(1, Math.floor(frame.sheetWidth / frame.width));
  const x = (numeric % columns) * frame.width;
  const y = Math.floor(numeric / columns) * frame.height;
  return {
    sheet: `materials/${cls}.png`,
    x,
    y,
    width: frame.width,
    height: frame.height,
    frameWidth: frame.width,
    frameHeight: frame.height,
  };
}

function buildMapMetadata(project) {
  const tileNumbers = new Set();
  const floors = Object.keys(project.floorsById || {})
    .sort()
    .reduce((result, floorId) => {
      const floor = project.floorsById[floorId];
      const width = Number(floor.width || (floor.map && floor.map[0] ? floor.map[0].length : 0));
      const height = Number(floor.height || (Array.isArray(floor.map) ? floor.map.length : 0));
      const map = [];
      for (let y = 0; y < height; y += 1) {
        const row = [];
        for (let x = 0; x < width; x += 1) {
          const number = floor.map && floor.map[y] ? floor.map[y][x] : 0;
          tileNumbers.add(Number(number || 0));
          row.push(tileIdForNumber(project, number));
        }
        map.push(row);
      }
      result[floorId] = {
        floorId,
        title: floor.title || floor.name || floorId,
        width,
        height,
        map,
      };
      return result;
    }, {});
  const tiles = Array.from(tileNumbers)
    .sort((a, b) => a - b)
    .reduce((result, number) => {
      const meta = tileMetaForNumber(project, number);
      if (meta) result[meta.id] = meta;
      return result;
    }, {});
  return { floors, tiles };
}

function routeTail(state, limit) {
  const route = Array.isArray((state || {}).route) ? state.route : [];
  return route.slice(Math.max(0, route.length - (limit || 8))).map((entry) =>
    typeof entry === "string" ? entry : (entry && entry.summary) || String(entry)
  );
}

function actionTarget(action) {
  const target = action && (action.target || (action.x != null && action.y != null ? action : null));
  if (!target || target.x == null || target.y == null) return null;
  return {
    floorId: target.floorId || action.floorId || null,
    x: Number(target.x),
    y: Number(target.y),
  };
}

function isEnemyTile(tile) {
  const cls = tile && tile.cls;
  return cls === "enemys" || cls === "enemy48" || (typeof cls === "string" && cls.indexOf("enemy") === 0);
}

function reachableEnemyKeys(simulator, state) {
  const keys = new Set();
  let reachability = null;
  try {
    reachability = simulator.getWalkReachability(state);
  } catch (error) {
    return keys;
  }
  const dirs = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ];
  Object.values((reachability && reachability.visited) || {}).forEach((node) => {
    const nodeState = node.state || state;
    const loc = (nodeState.hero && nodeState.hero.loc) || {};
    const x = Number(loc.x);
    const y = Number(loc.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    dirs.forEach(([dx, dy]) => {
      keys.add(`${x + dx},${y + dy}`);
    });
  });
  return keys;
}

function buildBattleOverlay(project, simulator, state, options) {
  const config = options || {};
  const mode = String(config.battleOverlay || "visible");
  if (mode === "off" || mode === "0" || mode === "false") return null;
  if (!simulator || !simulator.battleResolver || typeof simulator.battleResolver.evaluateBattle !== "function") {
    return {
      mode,
      floorId: state.floorId,
      unavailable: "battleResolver.evaluateBattle is not available",
      enemies: {},
    };
  }
  const floorId = state.floorId;
  const floor = project.floorsById[floorId];
  if (!floor) return { mode, floorId, enemies: {} };
  const reachableKeys = mode === "reachable" ? reachableEnemyKeys(simulator, state) : null;
  const height = Number(floor.height || (Array.isArray(floor.map) ? floor.map.length : 0));
  const width = Number(floor.width || (floor.map && floor.map[0] ? floor.map[0].length : 0));
  const enemies = {};
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const key = `${x},${y}`;
      if (reachableKeys && !reachableKeys.has(key)) continue;
      const tile = getTileDefinitionAt(project, state, floorId, x, y);
      if (!isEnemyTile(tile)) continue;
      const enemy = (project.enemysById || {})[tile.id] || {};
      let battle = null;
      try {
        battle = simulator.battleResolver.evaluateBattle(state, floorId, x, y, tile.id);
      } catch (error) {
        enemies[key] = {
          enemyId: tile.id,
          name: enemy.name || tile.name || tile.id,
          supported: false,
          display: "???",
          reason: error && error.message ? error.message : String(error),
        };
        continue;
      }
      const damageInfo = battle && battle.damageInfo;
      const damage = damageInfo && damageInfo.damage != null
        ? Number(damageInfo.damage)
        : null;
      enemies[key] = {
        enemyId: tile.id,
        name: enemy.name || tile.name || tile.id,
        supported: Boolean(battle && battle.supported && damage != null),
        damage,
        display: damage == null ? "???" : String(damage),
        lethal: damage != null && damage >= Number((state.hero || {}).hp || 0),
        turn: damageInfo && damageInfo.turn != null ? Number(damageInfo.turn) : null,
        exp: Number((battle && battle.enemyInfo && battle.enemyInfo.exp) || enemy.exp || 0),
        money: Number((battle && battle.enemyInfo && battle.enemyInfo.money) || enemy.money || 0),
        reason: battle && battle.supported === false ? battle.reason || null : null,
      };
    }
  }
  return {
    mode,
    floorId,
    enemyCount: Object.keys(enemies).length,
    enemies,
  };
}

function candidateKind(action) {
  const kind = action && action.kind ? String(action.kind) : "unknown";
  if (kind === "battle") return "battle";
  if (kind === "changeFloor" || kind === "floorFly" || kind === "portal") return "mobility";
  if (kind === "pickup" || kind === "interactPickup") return "resource";
  if (kind === "openDoor" || kind === "useTool" || kind === "event") return "interaction";
  if (kind === "equip") return "equipment";
  return kind;
}

function tileLabelAt(project, state, target) {
  if (!target || target.x == null || target.y == null) return null;
  const floorId = target.floorId || state.floorId;
  const tile = getTileDefinitionAt(project, state, floorId, target.x, target.y);
  if (!tile) return null;
  const item = tile.cls === "items" ? (project.itemsById || {})[tile.id] : null;
  const enemy = isEnemyTile(tile) ? (project.enemysById || {})[tile.id] : null;
  return {
    id: tile.id || null,
    cls: tile.cls || null,
    name: tile.name || (item && item.name) || (enemy && enemy.name) || null,
  };
}

function summarizeCandidate(project, state, action, index, plannedKey, battleOverlay) {
  const normalized = normalizeReplayAction(action);
  const target = actionTarget(normalized);
  const key = actionFingerprint(normalized);
  const targetKey = target && (target.floorId || state.floorId) === state.floorId
    ? `${target.x},${target.y}`
    : null;
  const battle = targetKey && battleOverlay && battleOverlay.enemies
    ? battleOverlay.enemies[targetKey] || null
    : null;
  const tile = tileLabelAt(project, state, target);
  return {
    index,
    kind: normalized.kind || "unknown",
    category: candidateKind(normalized),
    summary: normalized.summary || key || normalized.kind || "unknown",
    fingerprint: key || null,
    plannedNext: plannedKey ? key === plannedKey || normalized.summary === plannedKey : false,
    target,
    targetLabel: target ? `${target.floorId || state.floorId}:${target.x},${target.y}` : "",
    tile,
    enemyId: normalized.enemyId || (battle && battle.enemyId) || null,
    itemId: normalized.itemId || null,
    tool: normalized.tool || null,
    equipId: normalized.equipId || null,
    pathLength: Array.isArray(normalized.path) ? normalized.path.length : null,
    damage: battle && battle.damage != null ? battle.damage : null,
    lethal: battle ? Boolean(battle.lethal) : null,
    supported: battle ? Boolean(battle.supported) : null,
    reason: battle && battle.reason ? battle.reason : null,
  };
}

function buildActionInspector(project, simulator, state, options, battleOverlay) {
  const config = options || {};
  const mode = String(config.actionInspector || "visible");
  if (mode === "off" || mode === "0" || mode === "false") return null;
  if (!simulator) {
    return {
      mode,
      unavailable: "simulator is not available",
      totalActions: 0,
      shownActions: 0,
      truncated: false,
      categories: {},
      candidates: [],
    };
  }
  const plannedNextAction = config.plannedNextAction || null;
  const plannedKey = plannedNextAction
    ? actionFingerprint(normalizeReplayAction(plannedNextAction)) || plannedNextAction.summary || null
    : null;
  let actions = [];
  let error = null;
  try {
    actions = listReplayCandidates(simulator, state);
  } catch (caught) {
    error = caught && caught.message ? caught.message : String(caught);
  }
  const candidateLimit = config.candidateLimit != null
    ? config.candidateLimit
    : config.actionCandidateLimit != null
      ? config.actionCandidateLimit
      : 80;
  const limit = Math.max(0, Number(candidateLimit));
  const candidates = actions
    .slice(0, limit || actions.length)
    .map((action, index) => summarizeCandidate(project, state, action, index, plannedKey, battleOverlay));
  const categories = candidates.reduce((counts, candidate) => {
    counts[candidate.category] = Number(counts[candidate.category] || 0) + 1;
    return counts;
  }, {});
  return {
    mode,
    totalActions: actions.length,
    shownActions: candidates.length,
    truncated: limit > 0 && actions.length > limit,
    plannedNextSummary: plannedNextAction ? plannedNextAction.summary || plannedKey : null,
    plannedFoundInCandidates: candidates.some((c) => c.plannedNext),
    categories,
    candidates,
    error,
  };
}

function buildTimelineStep(project, state, options) {
  const config = options || {};
  const snapshot = buildSolverSnapshot(project, state, {
    floorIds: config.snapshotFloorIds,
  });
  const floorId = state.floorId;
  const hero = compactHero(state.hero);
  const battleOverlay = buildBattleOverlay(project, config.simulator, state, config);
  return {
    index: config.index,
    summary: config.summary,
    action: cloneJson(config.action || null),
    floorId,
    hero,
    inventory: stableObject(state.inventory),
    flagsSummary: summarizeFlags(state.flags),
    loc: cloneJson(hero.loc || null),
    stateKey: buildStateKey(state),
    dominanceKey: buildDominanceKey(state),
    routeTail: routeTail(state, config.routeTailLimit || 8),
    currentFloorMutation: snapshotFloorMutation(snapshot, floorId),
    mutations: floorMutationsSummary(state),
    snapshot,
    battleOverlay,
    actionInspector: buildActionInspector(project, config.simulator, state, config, battleOverlay),
    target: actionTarget(config.action),
    delta: config.delta || null,
    error: config.error || null,
  };
}

function snapshotFloorIds(project, routeRecord) {
  const floors = new Set();
  const addSnapshotFloors = (snapshot) => {
    Object.keys((snapshot && snapshot.floors) || {}).forEach((floorId) => floors.add(floorId));
  };
  addSnapshotFloors((routeRecord.start || {}).snapshot);
  addSnapshotFloors((routeRecord.final || {}).snapshot);
  (routeRecord.decisions || []).forEach((decision) => {
    addSnapshotFloors(decision.preSnapshot);
    addSnapshotFloors(decision.postSnapshot);
    if (decision.floorId) floors.add(decision.floorId);
    if (decision.target && decision.target.floorId) floors.add(decision.target.floorId);
  });
  if (floors.size === 0) Object.keys(project.floorsById || {}).forEach((floorId) => floors.add(floorId));
  return Array.from(floors).filter((floorId) => project.floorsById[floorId]);
}

function initialStateForRoute(project, simulator, routeRecord, options) {
  const config = options || {};
  const rank = config.rank || ((routeRecord.source || {}).rank) || "chaos";
  if ((routeRecord.start || {}).snapshot) {
    const state = createStateFromSnapshot(project, routeRecord.start.snapshot, {
      rank,
      decisionDepth: 0,
    });
    try {
      const stateKey = JSON.parse(routeRecord.start.stateKey || "{}");
      if (Array.isArray(stateKey.visitedFloors)) {
        state.visitedFloors = stateKey.visitedFloors.reduce((visited, floorId) => {
          visited[floorId] = true;
          return visited;
        }, {});
      }
    } catch (error) {}
    return state;
  }
  return simulator.createInitialState({ rank });
}

function normalizeReplayAction(decision) {
  const action = cloneJson(decision || {});
  delete action.preSnapshot;
  delete action.postSnapshot;
  delete action.preStateKey;
  delete action.postStateKey;
  if (action.target && action.x == null && action.target.x != null) action.x = action.target.x;
  if (action.target && action.y == null && action.target.y != null) action.y = action.target.y;
  return action;
}

function actionFingerprint(action) {
  try {
    return action.fingerprint || fingerprintAction(normalizeAction(action));
  } catch (error) {
    return action && action.summary ? action.summary : "";
  }
}

function listReplayCandidates(simulator, state) {
  const actions = [];
  const seen = new Set();
  const add = (list) => {
    (list || []).forEach((action) => {
      if (!action) return;
      const key = actionFingerprint(action);
      if (seen.has(key)) return;
      seen.add(key);
      actions.push(action);
    });
  };
  try {
    add(simulator.enumerateActions(state));
  } catch (error) {}
  if (typeof simulator.enumeratePrimitiveActions === "function") {
    try {
      add(simulator.enumeratePrimitiveActions(state).actions || []);
    } catch (error) {}
  }
  if (typeof simulator.enumerateInteractPickupActions === "function") {
    try {
      add(simulator.enumerateInteractPickupActions(state));
    } catch (error) {}
  }
  if (typeof simulator.enumerateFloorFlyActions === "function") {
    try {
      add(simulator.enumerateFloorFlyActions(state));
    } catch (error) {}
  }
  return actions;
}

function selectReplayAction(simulator, state, decision) {
  const expected = normalizeReplayAction(decision);
  const expectedFingerprint = expected.fingerprint || actionFingerprint(expected);
  const candidates = listReplayCandidates(simulator, state);
  return candidates.find((action) => actionFingerprint(action) === expectedFingerprint)
    || candidates.find((action) => action.summary === expected.summary)
    || expected;
}

function buildRouteTimeline(project, simulator, routeRecord, options) {
  const config = options || {};
  const floorIds = config.snapshotFloorIds || snapshotFloorIds(project, routeRecord);
  const steps = [];
  const decisions = routeRecord.decisions || [];
  let state = initialStateForRoute(project, simulator, routeRecord, config);
  const startedAt = Date.now();
  steps.push(buildTimelineStep(project, state, {
    index: 0,
    summary: "start",
    simulator,
    battleOverlay: config.battleOverlay,
    actionInspector: config.actionInspector,
    candidateLimit: config.candidateLimit,
    plannedNextAction: decisions[0] ? normalizeReplayAction(decisions[0]) : null,
    snapshotFloorIds: floorIds,
    routeTailLimit: config.routeTailLimit,
  }));

  for (const decision of decisions) {
    const index = steps.length;
    const action = selectReplayAction(simulator, state, decision);
    const displayAction = normalizeReplayAction(decision);
    const preSnapshot = buildSolverSnapshot(project, state, { floorIds });
    let preInspectorStep = null;
    if (config.actionInspectorMode === "pre" || config.actionInspector === "pre") {
      try {
        preInspectorStep = buildTimelineStep(project, state, {
          index,
          summary: decision.summary || action.summary || action.kind || `step-${index}`,
          action: displayAction,
          delta: null,
          simulator,
          battleOverlay: config.battleOverlay,
          actionInspector: config.actionInspector,
          candidateLimit: config.candidateLimit,
          plannedNextAction: displayAction,
          isPreInspector: true,
          snapshotFloorIds: floorIds,
          routeTailLimit: config.routeTailLimit,
        });
      } catch (error) {
        preInspectorStep = null;
      }
    }
    try {
      state = simulator.applyAction(state, action);
      const postSnapshot = buildSolverSnapshot(project, state, { floorIds });
      const postStep = buildTimelineStep(project, state, {
        index,
        summary: decision.summary || action.summary || action.kind || `step-${index}`,
        action: displayAction,
        delta: buildStepDelta(preSnapshot, postSnapshot),
        simulator,
        battleOverlay: config.battleOverlay,
        actionInspector: config.actionInspector,
        candidateLimit: config.candidateLimit,
        plannedNextAction: displayAction,
        snapshotFloorIds: floorIds,
        routeTailLimit: config.routeTailLimit,
      });
      if (preInspectorStep && preInspectorStep.actionInspector) {
        postStep.preInspector = preInspectorStep.actionInspector;
      }
      steps.push(postStep);
    } catch (error) {
      steps.push(buildTimelineStep(project, state, {
        index,
        summary: decision.summary || action.summary || action.kind || `step-${index}`,
        action: displayAction,
        delta: null,
        simulator,
        battleOverlay: config.battleOverlay,
        actionInspector: config.actionInspector,
        candidateLimit: config.candidateLimit,
        plannedNextAction: displayAction,
        error: {
          message: error && error.message ? error.message : String(error),
          stack: config.includeStack ? String(error && error.stack ? error.stack : "") : null,
        },
        snapshotFloorIds: floorIds,
        routeTailLimit: config.routeTailLimit,
      }));
      if (config.stopOnError !== false) break;
    }
  }

  return {
    schema: "motapathfinder.routeTimeline.v1",
    createdAt: new Date().toISOString(),
    source: {
      routeFile: config.routeFile ? path.resolve(config.routeFile) : null,
      projectRoot: project.root ? path.resolve(project.root) : null,
      routeSchema: routeRecord.schema || null,
      routeCreatedAt: routeRecord.createdAt || null,
      solver: (routeRecord.source || {}).solver || null,
      rank: (routeRecord.source || {}).rank || null,
      projectTitle: project.data && project.data.firstData
        ? project.data.firstData.title
        : null,
    },
    stats: {
      decisionCount: decisions.length,
      stepCount: steps.length,
      replayedDecisionCount: Math.max(0, steps.length - 1),
      durationMs: Date.now() - startedAt,
      endedWithError: Boolean(steps[steps.length - 1] && steps[steps.length - 1].error),
    },
    route: {
      goal: cloneJson(routeRecord.goal || null),
      stats: cloneJson(routeRecord.stats || null),
      notes: cloneJson(routeRecord.notes || []),
    },
    map: buildMapMetadata(project),
    steps,
  };
}

function replayRouteToStep(project, simulator, routeRecord, stepIndex, options) {
  const config = options || {};
  const decisions = routeRecord.decisions || [];
  const targetStep = Math.max(0, Math.min(Number(stepIndex || 0), decisions.length));
  let state = initialStateForRoute(project, simulator, routeRecord, config);
  for (let index = 0; index < targetStep; index += 1) {
    const action = selectReplayAction(simulator, state, decisions[index]);
    state = simulator.applyAction(state, action);
  }
  return {
    step: targetStep,
    state,
    snapshot: buildSolverSnapshot(project, state, {
      floorIds: config.snapshotFloorIds || snapshotFloorIds(project, routeRecord),
    }),
    stateKey: buildStateKey(state),
    dominanceKey: buildDominanceKey(state),
  };
}

function exportRouteState(project, simulator, routeRecord, stepIndex, options) {
  const replay = replayRouteToStep(project, simulator, routeRecord, stepIndex, options);
  return {
    schema: "motapathfinder.exportedState.v1",
    createdAt: new Date().toISOString(),
    step: replay.step,
    stateKey: replay.stateKey,
    dominanceKey: replay.dominanceKey,
    snapshot: replay.snapshot,
    state: cloneState(replay.state),
  };
}

module.exports = {
  buildRouteTimeline,
  buildStepDelta,
  exportRouteState,
  replayRouteToStep,
};
