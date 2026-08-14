"use strict";

const crypto = require("node:crypto");

const { buildStateKey } = require("./state-key");
const { listFloorMutationSummary } = require("./state");
const {
  createStrategicOptionMapCache,
  diffStrategicOptionMaps,
  tileDefinitionAt,
} = require("./strategic-option-map");

const TRANSITION_SCHEMA = "motapathfinder.strategic-transition.v1";
const REACHABLE_SCHEMA = "motapathfinder.reachable-poi-index.v1";

const POI_KINDS = ["item", "enemy", "door", "portal", "event", "upgrade"];
const ADJACENCY = [[0, 0], [0, -1], [1, 0], [0, 1], [-1, 0]];

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}

function mutationCount(state) {
  return listFloorMutationSummary((state || {}).floorStates || {})
    .reduce((sum, floor) => sum + (floor.removed || []).length + (floor.replaced || []).length, 0);
}

function portalTileId(raw) {
  if (raw == null) return null;
  if (typeof raw === "string") return raw;
  if (typeof raw === "object") {
    return String(raw.floorId || raw.toFloorId || raw.toFloor || "portal");
  }
  return String(raw);
}

function classifyTilePoi(project, state, floorId, x, y) {
  const floor = project.floorsById[floorId];
  if (!floor || x < 0 || y < 0 || x >= floor.width || y >= floor.height) return null;
  const key = `${x},${y}`;
  if ((floor.changeFloor || {})[key]) {
    return { kind: "portal", tileId: portalTileId((floor.changeFloor || {})[key]) };
  }
  const tile = tileDefinitionAt(project, state, floorId, x, y);
  if (!tile) return null;
  if (tile.cls === "items") return { kind: "item", tileId: tile.id || null };
  if (String(tile.cls || "").startsWith("enemy")) return { kind: "enemy", tileId: tile.id || null };
  if (tile.trigger === "openDoor") return { kind: "door", tileId: tile.id || null };
  if (tile.cls === "upgrades") return { kind: "upgrade", tileId: tile.id || null };
  if (tile.trigger != null && tile.trigger !== "null" && tile.trigger !== "passNet") {
    return { kind: "event", tileId: tile.id || null };
  }
  return null;
}

/**
 * Index of every option point (item, enemy, door, portal, event, upgrade)
 * currently reachable from the hero on the current floor.
 *
 * Reachability is derived from the simulator's own walk reachability scan
 * (the same scan that drives primitive action enumeration), so the index
 * cannot disagree with what the simulator can actually generate next.
 * Tile lookups use the root state of the scan; per-node event effects are
 * deliberately not materialized here.
 */
function buildReachablePoiIndex(project, simulator, state, reachability) {
  const scan = reachability || simulator.getWalkReachability(state);
  const floorId = state.floorId;
  const byKind = {};
  POI_KINDS.forEach((kind) => {
    byKind[kind] = new Map();
  });
  const scanned = new Set();
  Object.values(scan.visited || {}).forEach((node) => {
    ADJACENCY.forEach(([deltaX, deltaY]) => {
      const key = `${node.x + deltaX},${node.y + deltaY}`;
      if (scanned.has(key)) return;
      scanned.add(key);
      const poi = classifyTilePoi(project, state, floorId, node.x + deltaX, node.y + deltaY);
      if (!poi) return;
      const entry = {
        key: `${floorId}:${key}`,
        floorId,
        x: node.x + deltaX,
        y: node.y + deltaY,
        kind: poi.kind,
        tileId: poi.tileId,
      };
      if (!byKind[poi.kind].has(entry.key)) byKind[poi.kind].set(entry.key, entry);
    });
  });
  const entries = [];
  const counts = { total: 0 };
  POI_KINDS.forEach((kind) => {
    const list = Array.from(byKind[kind].values())
      .sort((left, right) => left.key.localeCompare(right.key));
    counts[kind] = list.length;
    counts.total += list.length;
    entries.push(...list);
  });
  return {
    schema: REACHABLE_SCHEMA,
    floorId,
    lookupMode: "walk-reachability-adjacency-root-state-static",
    nodeCount: Object.keys(scan.visited || {}).length,
    counts,
    entries,
    fingerprint: hash(JSON.stringify(entries.map((entry) => [entry.key, entry.kind, entry.tileId]))),
  };
}

/**
 * Per-state cache of { optionMap, reachablePoi }. Option maps share by sparse
 * mutation identity; reachability shares only by exact state key. The
 * simulator may internally reuse a topology skeleton after its own safety
 * classification, but this layer must not bypass that classification because
 * hazards, flags, auto-events, or inventory can make equal topology behave
 * differently.
 */
function createStrategicStateIndexCache(project, simulator, options) {
  const optionMaps = createStrategicOptionMapCache(project, options);
  const reachableByStateKey = new Map();
  return {
    optionMaps,
    get(state) {
      const stateKey = buildStateKey(state);
      let entry = reachableByStateKey.get(stateKey);
      if (!entry) {
        const optionMap = optionMaps.get(state);
        const reachablePoi = buildReachablePoiIndex(project, simulator, state);
        entry = { stateKey, optionMap, reachablePoi };
        reachableByStateKey.set(stateKey, entry);
      }
      return entry;
    },
    get size() {
      return reachableByStateKey.size;
    },
  };
}

function poiCoordinates(entry) {
  if (entry.floorId != null && entry.x != null && entry.y != null) {
    return { floorId: entry.floorId, x: Number(entry.x), y: Number(entry.y) };
  }
  const separator = String(entry.key || "").lastIndexOf(":");
  const coordinate = separator >= 0 ? String(entry.key).slice(separator + 1) : "";
  const [x, y] = coordinate.split(",").map(Number);
  return {
    floorId: separator >= 0 ? String(entry.key).slice(0, separator) : null,
    x,
    y,
  };
}

function poiStillPresent(project, state, entry) {
  const location = poiCoordinates(entry);
  if (!location.floorId || !Number.isFinite(location.x) || !Number.isFinite(location.y)) return false;
  const current = classifyTilePoi(project, state, location.floorId, location.x, location.y);
  return Boolean(current && current.kind === entry.kind && current.tileId === entry.tileId);
}

function diffReachablePoiSets(before, after, options) {
  const config = options || {};
  const beforeByKey = new Map((before.entries || []).map((entry) => [entry.key, entry]));
  const afterByKey = new Map((after.entries || []).map((entry) => [entry.key, entry]));
  const isPresent = typeof config.isPresent === "function"
    ? config.isPresent
    : (entry) => poiStillPresent(config.project, config.state, entry);
  const newlyReachable = Array.from(afterByKey.values())
    .filter((entry) => !beforeByKey.has(entry.key))
    .sort((left, right) => left.key.localeCompare(right.key));
  const noLongerReachable = Array.from(beforeByKey.values())
    .filter((entry) => !afterByKey.has(entry.key))
    .sort((left, right) => left.key.localeCompare(right.key));
  return {
    newlyReachable,
    noLongerReachable,
    // Consumed from the map entirely vs. still on the map but no longer reachable.
    consumed: noLongerReachable.filter((entry) => !isPresent(entry)),
    stillPresentButUnreachable: noLongerReachable.filter((entry) => isPresent(entry)),
  };
}

function terminalBattleProjection(simulator, state, terminalGoal) {
  if (!terminalGoal || terminalGoal.type !== "bossDefeated") return null;
  try {
    const evaluation = simulator.battleResolver.evaluateBattle(
      state,
      terminalGoal.floorId,
      terminalGoal.x,
      terminalGoal.y,
      terminalGoal.enemyId,
    );
    const damage = evaluation && evaluation.damageInfo && evaluation.damageInfo.damage;
    const enemyDef = evaluation && evaluation.enemyInfo && evaluation.enemyInfo.def;
    const attackMargin = enemyDef == null
      ? null
      : number(((state || {}).hero || {}).atk, 0) - number(enemyDef, 0);
    const survivalMargin = damage == null ? null : number((state.hero || {}).hp, 0) - number(damage, 0);
    const stage = !evaluation || !evaluation.supported
      ? "unsupported"
      : damage == null
        ? "attack-blocked"
        : survivalMargin < 0
          ? "lethal"
          : "viable";
    const stageRank = { unsupported: 0, "attack-blocked": 1, lethal: 2, viable: 3 }[stage];
    const metric = stage === "attack-blocked" ? attackMargin : survivalMargin;
    return {
      supported: Boolean(evaluation && evaluation.supported),
      damage: damage == null ? null : number(damage, null),
      margin: survivalMargin,
      attackMargin,
      stage,
      stageRank,
      progressScore: metric == null ? null : stageRank * 1000000000000 + metric,
    };
  } catch (_error) {
    return null;
  }
}

function buildTerminalBlockerDelta(beforeProjection, afterState, simulator, terminalGoal) {
  const after = terminalBattleProjection(simulator, afterState, terminalGoal);
  const beforeScore = beforeProjection && beforeProjection.progressScore != null
    ? beforeProjection.progressScore
    : null;
  const afterScore = after && after.progressScore != null ? after.progressScore : null;
  return {
    before: beforeProjection,
    after,
    delta: beforeScore != null && afterScore != null ? afterScore - beforeScore : null,
    improved: beforeScore != null && afterScore != null && afterScore > beforeScore,
    supported: Boolean(beforeProjection && after && beforeProjection.supported && after.supported),
  };
}

function summarizeResourceDelta(beforeState, afterState) {
  const beforeHero = (beforeState || {}).hero || {};
  const afterHero = (afterState || {}).hero || {};
  return {
    hp: number(afterHero.hp, 0) - number(beforeHero.hp, 0),
    atk: number(afterHero.atk, 0) - number(beforeHero.atk, 0),
    def: number(afterHero.def, 0) - number(beforeHero.def, 0),
    mdef: number(afterHero.mdef, 0) - number(beforeHero.mdef, 0),
    lv: number(afterHero.lv, 0) - number(beforeHero.lv, 0),
    exp: number(afterHero.exp, 0) - number(beforeHero.exp, 0),
    equipmentCount: number((afterHero.equipment || []).length, 0) -
      number((beforeHero.equipment || []).length, 0),
    floorMutationDelta: mutationCount(afterState) - mutationCount(beforeState),
  };
}

function buildIrreversibleCost(action) {
  const kind = action && action.kind ? action.kind : "unknown";
  const battles = kind === "battle" ? 1 : 0;
  const doors = kind === "openDoor" ? 1 : 0;
  const events = kind === "event" ? 1 : 0;
  const consumedItems = kind === "pickup" || kind === "interactPickup" ? 1 : 0;
  const consumedTools = kind === "useTool" ? 1 : 0;
  const total = battles + doors + events + consumedItems + consumedTools;
  return { battles, doors, events, consumedItems, consumedTools, total };
}

function explicitActionTargetKey(action) {
  if (!action) return null;
  const floorId = action.floorId || (action.travelState && action.travelState.floorId);
  const target = action.target || {};
  const x = action.x != null ? action.x : target.x;
  const y = action.y != null ? action.y : target.y;
  return floorId && x != null && y != null ? `${floorId}:${x},${y}` : null;
}

/**
 * Path-independent identity of a strategic choice. Two travel variants that
 * execute the same POI through different paths or stances must share one
 * choice key; for interactPickup the stance direction is explicitly dropped.
 */
function choiceKeyOf(simulator, action) {
  const fingerprint = simulator.getActionFingerprint(action) || action.summary;
  if (action.kind === "interactPickup") {
    return fingerprint.split("|").slice(0, 5).join("|");
  }
  return fingerprint;
}

/**
 * "未来还能合法获取多少有用物品" — future-reachable positive options,
 * used by both the canonical retention rule and the future-reachable-options
 * agenda queue. Items and upgrades weigh most, enemies (exp sources) next,
 * portals last.
 */
function futureOptionScore(reachablePoi) {
  const counts = (reachablePoi && reachablePoi.counts) || {};
  return number(counts.item, 0) * 1000000 +
    number(counts.upgrade, 0) * 1000000 +
    number(counts.enemy, 0) * 1000 +
    number(counts.portal, 0);
}

function comparePostStates(left, right) {
  const futureLeft = futureOptionScore(left.reachablePoi);
  const futureRight = futureOptionScore(right.reachablePoi);
  if (futureLeft !== futureRight) return futureLeft - futureRight;
  const marginLeft = left.terminalBlockerDelta && left.terminalBlockerDelta.after &&
    left.terminalBlockerDelta.after.progressScore != null
    ? left.terminalBlockerDelta.after.progressScore
    : -1000000000000;
  const marginRight = right.terminalBlockerDelta && right.terminalBlockerDelta.after &&
    right.terminalBlockerDelta.after.progressScore != null
    ? right.terminalBlockerDelta.after.progressScore
    : -1000000000000;
  if (marginLeft !== marginRight) return marginLeft - marginRight;
  const hpLeft = number(((left.state || {}).hero || {}).hp, 0);
  const hpRight = number(((right.state || {}).hero || {}).hp, 0);
  if (hpLeft !== hpRight) return hpLeft - hpRight;
  const mutationLeft = mutationCount(left.state);
  const mutationRight = mutationCount(right.state);
  if (mutationLeft !== mutationRight) return mutationRight - mutationLeft;
  return left.stateKey < right.stateKey ? 1 : -1;
}

function buildTransitionPostState(options) {
  const {
    simulator,
    stateIndex,
    beforeState,
    beforeOptionMap,
    beforeReachable,
    beforeTerminalProjection,
    afterState,
    action,
    terminalGoal,
  } = options;
  const stateKey = buildStateKey(afterState);
  const indexed = stateIndex.get(afterState);
  const optionDelta = diffStrategicOptionMaps(beforeOptionMap, indexed.optionMap);
  const reachableDelta = diffReachablePoiSets(beforeReachable, indexed.reachablePoi, {
    project: simulator.project,
    state: afterState,
  });
  const explicitTarget = explicitActionTargetKey(action);
  const beforeReachableKeys = new Set((beforeReachable.entries || []).map((entry) => entry.key));
  const consumedOpportunities = optionDelta.consumed.map((entry) => ({
    key: entry.key,
    kind: entry.kind,
    tileId: entry.tileId,
    role: entry.key === explicitTarget ? "active" : "implicit",
    wasReachableBefore: beforeReachableKeys.has(entry.key),
  }));
  return {
    stateKey,
    state: afterState,
    optionMap: indexed.optionMap,
    reachablePoi: indexed.reachablePoi,
    optionDelta,
    reachableDelta,
    consumedOpportunities,
    newlyReachablePOIs: reachableDelta.newlyReachable,
    noLongerReachablePOIs: reachableDelta.noLongerReachable,
    stillPresentButUnreachable: reachableDelta.stillPresentButUnreachable,
    resourceDelta: summarizeResourceDelta(beforeState, afterState),
    irreversibleCost: buildIrreversibleCost(action),
    terminalBlockerDelta: buildTerminalBlockerDelta(
      beforeTerminalProjection,
      afterState,
      simulator,
      terminalGoal,
    ),
    appliedBy: action,
    appliedByVariants: [action.summary],
  };
}

/**
 * Collapses raw primitive action variants into one StrategicTransition per
 * strategic choice. Travel variants stay inside the transition and the
 * frontier gets exactly one slot per choice; distinct exact post states are
 * all materialized so the canonical retention rule can compare them, and
 * non-canonical ones are reported as deferred (resolved lazily in 5.18c).
 */
function aggregateVariantsIntoTransitions(options) {
  const {
    simulator,
    state,
    actions,
    terminalGoal,
    stateIndex,
    beforeOptionMap,
    beforeReachable,
    choiceKeyBuilder,
    choiceLabelBuilder,
    targetPOIBuilder,
  } = options;
  const groups = new Map();
  (actions || []).forEach((action) => {
    if (!action) return;
    const key = typeof choiceKeyBuilder === "function"
      ? choiceKeyBuilder(action)
      : choiceKeyOf(simulator, action);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(action);
  });
  // The terminal battle projection of the pre-transition state is identical
  // for every post state of every choice; compute it exactly once.
  const beforeTerminalProjection = terminalBattleProjection(simulator, state, terminalGoal);
  const transitions = [];
  let rejectedVariantCount = 0;
  for (const [choiceKey, variants] of groups) {
    const postStateByKey = new Map();
    for (const action of variants) {
      let afterState;
      try {
        afterState = simulator.applyAction(state, action, { storeRoute: false });
      } catch (_error) {
        rejectedVariantCount += 1;
        continue;
      }
      afterState.route = [];
      const stateKey = buildStateKey(afterState);
      if (postStateByKey.has(stateKey)) {
        postStateByKey.get(stateKey).appliedByVariants.push(action.summary);
        continue;
      }
      postStateByKey.set(stateKey, buildTransitionPostState({
        simulator,
        stateIndex,
        beforeState: state,
        beforeOptionMap,
        beforeReachable,
        beforeTerminalProjection,
        afterState,
        action,
        terminalGoal,
      }));
    }
    const postStates = Array.from(postStateByKey.values());
    const resolvedVariantCount = postStates.reduce(
      (sum, post) => sum + post.appliedByVariants.length,
      0,
    );
    const first = variants[0];
    transitions.push({
      schema: TRANSITION_SCHEMA,
      choice: choiceKey,
      choiceLabel: typeof choiceLabelBuilder === "function"
        ? choiceLabelBuilder(first, choiceKey)
        : (first.summary || choiceKey),
      kind: first.kind || "unknown",
      targetPOI: typeof targetPOIBuilder === "function"
        ? targetPOIBuilder(first, choiceKey)
        : explicitActionTargetKey(first),
      travelVariants: variants.map((action) => ({
        summary: action.summary,
        kind: action.kind || "unknown",
        fingerprint: simulator.getActionFingerprint(action) || action.summary,
        floorId: action.floorId || (action.travelState && action.travelState.floorId) || null,
        x: action.x != null ? action.x : ((action.target || {}).x != null ? action.target.x : null),
        y: action.y != null ? action.y : ((action.target || {}).y != null ? action.target.y : null),
      })),
      travelVariantCount: variants.length,
      postStates,
      exactPostStateCount: postStates.length,
      rejectedVariantCount: variants.length - resolvedVariantCount,
    });
  }
  return {
    transitions,
    choiceCount: groups.size,
    variantCount: (actions || []).length,
    rejectedVariantCount,
  };
}

/**
 * Canonical post-state scheduling for the 5.18b incomplete slice: a goal state
 * always wins; otherwise the state preserving the most currently reachable
 * positive options wins, then terminal blocker progress, hp, fewer map
 * mutations, and deterministic state-key order. Non-canonical exact posts are
 * recorded as deferred work, not claimed as safely pruned.
 */
function selectCanonicalPostState(transition, options) {
  const config = options || {};
  const postStates = transition.postStates || [];
  if (postStates.length === 0) return null;
  if (typeof config.goalPredicate === "function") {
    const goalPost = postStates.find((post) => config.goalPredicate(post.state));
    if (goalPost) return { postState: goalPost, reason: "goal-reached" };
  }
  if (postStates.length === 1) return { postState: postStates[0], reason: "only-post-state" };
  const best = postStates.reduce(
    (current, post) => (!current || comparePostStates(post, current) > 0 ? post : current),
    null,
  );
  return { postState: best, reason: "future-options-retained" };
}

module.exports = {
  TRANSITION_SCHEMA,
  aggregateVariantsIntoTransitions,
  buildReachablePoiIndex,
  buildTerminalBlockerDelta,
  choiceKeyOf,
  comparePostStates,
  createStrategicStateIndexCache,
  diffReachablePoiSets,
  explicitActionTargetKey,
  futureOptionScore,
  mutationCount,
  poiStillPresent,
  selectCanonicalPostState,
  summarizeResourceDelta,
  terminalBattleProjection,
};
