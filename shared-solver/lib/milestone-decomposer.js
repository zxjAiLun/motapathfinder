"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { buildDominanceKey } = require("./state-key");
const { cloneState, getTileDefinitionAt } = require("./state");
const {
  buildSegmentActionProvider,
  buildSegmentGoalPredicate,
  runMilestoneGraph,
  searchSegmentDP,
  summarizeEffectiveHero,
  summarizeHero,
} = require("./segment-dp");
const { getTiming, resourceTimingScore } = require("./resource-timing-model");
const {
  discoverBattleResourceTargets,
  findResourceDeferralProof,
} = require("./resource-deferral-planner");

const CACHE_SCHEMA = "motapathfinder.segment-decomposition-cache.v7";
const REPORT_SCHEMA = "motapathfinder.milestone-decomposition.v1";
const DEFERRED_RESOURCE_PENALTY = 1000000000000000;

const DEFAULT_TIERS = Object.freeze({
  quick: { maxExpansions: 160, maxRuntimeMs: 600 },
  probe: { maxExpansions: 400, maxRuntimeMs: 1500 },
  normal: { maxExpansions: 2500, maxRuntimeMs: 8000 },
  escalated: { maxExpansions: 10000, maxRuntimeMs: 30000 },
});

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      result[key] = stableValue(value[key]);
      return result;
    }, {});
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function hashValue(value) {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

function routeEntrySummary(entry) {
  if (typeof entry === "string") return entry;
  return entry && typeof entry.summary === "string" ? entry.summary : "";
}

function compactState(state) {
  if (!state) return null;
  return {
    floorId: state.floorId,
    hero: summarizeHero(state),
    effectiveHero: summarizeEffectiveHero(state),
    routeLength: Array.isArray(state.route) ? state.route.length : 0,
    decisionDepth: Number((state.meta || {}).decisionDepth || 0),
    resourceTiming: cloneJson(getTiming(state)),
    stateKey: buildDominanceKey(state),
  };
}

function sampleMemory() {
  const memory = process.memoryUsage();
  return {
    heapUsedMb: memory.heapUsed / 1024 / 1024,
    rssMb: memory.rss / 1024 / 1024,
  };
}

function collectSearchGarbage(simulator) {
  if (simulator && typeof simulator.clearActionExpansionCaches === "function") {
    simulator.clearActionExpansionCaches();
  }
  if (typeof global.gc === "function") global.gc();
}

class BudgetLedger {
  constructor(options) {
    const config = options || {};
    this.startedAt = Date.now();
    this.maxRuntimeMs = Math.max(1, number(config.maxRuntimeMs, 600000));
    this.maxHeapMb = Math.max(1, number(config.maxHeapMb, 1024));
    this.maxNodes = Math.max(1, number(config.maxNodes, 64));
    this.entries = [];
    this.nodes = 0;
    this.expansions = 0;
    this.peakHeapMb = 0;
    this.peakRssMb = 0;
    this.stoppedReason = null;
    this.sample();
  }

  sample() {
    const memory = sampleMemory();
    this.peakHeapMb = Math.max(this.peakHeapMb, memory.heapUsedMb);
    this.peakRssMb = Math.max(this.peakRssMb, memory.rssMb);
    if (!this.stoppedReason && memory.heapUsedMb > this.maxHeapMb) {
      this.stoppedReason = "global-memory-limit";
    }
    if (!this.stoppedReason && Date.now() - this.startedAt >= this.maxRuntimeMs) {
      this.stoppedReason = "global-time-limit";
    }
    return memory;
  }

  remainingRuntimeMs() {
    return Math.max(0, this.maxRuntimeMs - (Date.now() - this.startedAt));
  }

  canContinue() {
    this.sample();
    return !this.stoppedReason;
  }

  beginNode() {
    if (!this.canContinue()) return false;
    if (this.nodes >= this.maxNodes) {
      this.stoppedReason = "decomposition-node-limit";
      return false;
    }
    this.nodes += 1;
    return true;
  }

  record(entry) {
    const diagnostics = (entry && entry.diagnostics) || {};
    this.expansions += number(diagnostics.expansions, 0);
    const memory = this.sample();
    this.entries.push({
      ...entry,
      elapsedMs: Date.now() - this.startedAt,
      heapUsedMb: Number(memory.heapUsedMb.toFixed(1)),
      rssMb: Number(memory.rssMb.toFixed(1)),
    });
  }

  summary() {
    this.sample();
    return {
      maxRuntimeMs: this.maxRuntimeMs,
      maxHeapMb: this.maxHeapMb,
      maxNodes: this.maxNodes,
      elapsedMs: Date.now() - this.startedAt,
      nodes: this.nodes,
      expansions: this.expansions,
      peakHeapMb: Number(this.peakHeapMb.toFixed(1)),
      peakRssMb: Number(this.peakRssMb.toFixed(1)),
      stoppedReason: this.stoppedReason,
      entries: this.entries.slice(),
    };
  }
}

function projectSignature(project) {
  const files = [];
  const projectDir = project && project.projectDir;
  if (projectDir && fs.existsSync(projectDir)) {
    const visit = (directory) => {
      fs.readdirSync(directory, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name))
        .forEach((entry) => {
          const full = path.join(directory, entry.name);
          if (entry.isDirectory()) {
            if (entry.name === "floors") visit(full);
            return;
          }
          if (!entry.name.endsWith(".js")) return;
          const stat = fs.statSync(full);
          files.push({
            file: path.relative(projectDir, full).replace(/\\/g, "/"),
            size: stat.size,
            mtimeMs: Math.floor(stat.mtimeMs),
          });
        });
    };
    visit(projectDir);
  }
  return hashValue({
    root: project && project.root,
    title: project && project.data && project.data.firstData && project.data.firstData.title,
    floorOrder: (project && project.floorOrder) || [],
    files,
  });
}

class SegmentSearchCache {
  constructor(options) {
    const config = options || {};
    this.directory = config.directory || null;
    this.projectSignature = config.projectSignature || "unknown-project";
    this.enabled = config.enabled !== false && Boolean(this.directory);
    this.stats = { hits: 0, misses: 0, writes: 0, invalid: 0 };
    if (this.enabled) fs.mkdirSync(this.directory, { recursive: true });
  }

  key(startState, segment, dp) {
    return hashValue({
      schema: CACHE_SCHEMA,
      projectSignature: this.projectSignature,
      startStateKey: {
        dominance: buildDominanceKey(startState),
        hp: number(((startState || {}).hero || {}).hp, 0),
        hpmax: number(((startState || {}).hero || {}).hpmax, 0),
      },
      goal: segment && segment.goal,
      actionPolicy: segment && segment.actionPolicy,
      dp,
    });
  }

  file(key) {
    return path.join(this.directory, `${key}.json`);
  }

  get(startState, segment, dp) {
    if (!this.enabled) return null;
    const key = this.key(startState, segment, dp);
    const file = this.file(key);
    if (!fs.existsSync(file)) {
      this.stats.misses += 1;
      return null;
    }
    try {
      const record = JSON.parse(fs.readFileSync(file, "utf8"));
      if (
        record.schema !== CACHE_SCHEMA ||
        record.projectSignature !== this.projectSignature ||
        record.key !== key
      ) {
        this.stats.invalid += 1;
        return null;
      }
      this.stats.hits += 1;
      return record.result;
    } catch (error) {
      this.stats.invalid += 1;
      return null;
    }
  }

  put(startState, segment, dp, result) {
    if (!this.enabled) return;
    const key = this.key(startState, segment, dp);
    const payload = {
      schema: CACHE_SCHEMA,
      projectSignature: this.projectSignature,
      key,
      result: cloneJson(result),
    };
    fs.writeFileSync(this.file(key), `${JSON.stringify(payload)}\n`, "utf8");
    this.stats.writes += 1;
  }
}

function stateForSegmentCache(state, startState) {
  if (!state) return null;
  const prefixLength = Array.isArray(startState && startState.route)
    ? startState.route.length
    : 0;
  const compact = cloneState(state);
  const timing = getTiming(state);
  if (timing) {
    compact.resourceTiming = {
      model: timing.model,
      retainedOptionValue: number(timing.retainedOptionValue, 0),
      projectedDamageSaving: number(timing.projectedDamageSaving, 0),
      newlySurvivableTargets: number(timing.newlySurvivableTargets, 0),
      roles: Array.isArray(timing.roles) ? timing.roles.slice() : [],
      resources: (timing.resources || []).map((resource) => ({
        key: resource.key,
        summary: resource.summary,
        kind: resource.kind,
        retainedResourceValue: number(resource.retainedResourceValue, 0),
        deferPremium: number(resource.deferPremium, 0),
        projectedDamageSaving: number(resource.projectedDamageSaving, 0),
        newlySurvivableTargets: number(resource.newlySurvivableTargets, 0),
        roles: Array.isArray(resource.roles) ? resource.roles.slice() : [],
      })),
    };
  }
  compact.route = (compact.route || []).slice(prefixLength);
  if (Array.isArray(compact.routeTrace)) {
    const tracePrefix = Array.isArray(startState && startState.routeTrace)
      ? startState.routeTrace.length
      : 0;
    compact.routeTrace = compact.routeTrace.slice(tracePrefix);
  }
  return compact;
}

function restoreSegmentCacheState(state, startState) {
  if (!state) return null;
  return {
    ...state,
    route: (Array.isArray(startState && startState.route) ? startState.route : [])
      .concat(state.route || []),
    ...(Array.isArray(state.routeTrace)
      ? {
          routeTrace: (Array.isArray(startState && startState.routeTrace)
            ? startState.routeTrace
            : []).concat(state.routeTrace),
        }
      : {}),
  };
}

function segmentResultForCache(result, startState) {
  return {
    found: result.found,
    goalSkyline: (result.goalSkyline || []).map((candidate) => ({
      ...candidate,
      state: stateForSegmentCache(candidate.state, startState),
    })),
    bestSeen: stateForSegmentCache(result.bestSeen, startState),
    bestProgress: stateForSegmentCache(result.bestProgress, startState),
    landmarkArchive: (result.landmarkArchive || []).map((record) => ({
      ...record,
      state: stateForSegmentCache(record.state, startState),
    })),
    diagnostics: cloneJson(result.diagnostics || {}),
  };
}

function hydrateSegmentResult(cached, segmentId, startState) {
  return {
    segmentId,
    found: Boolean(cached && cached.found),
    goalSkyline: ((cached && cached.goalSkyline) || []).map((candidate) => ({
      ...candidate,
      state: restoreSegmentCacheState(candidate.state, startState),
    })),
    bestSeen: restoreSegmentCacheState(cached && cached.bestSeen, startState),
    bestProgress: restoreSegmentCacheState(cached && cached.bestProgress, startState),
    landmarkArchive: ((cached && cached.landmarkArchive) || []).map((record) => ({
      ...record,
      state: restoreSegmentCacheState(record.state, startState),
    })),
    diagnostics: (cached && cached.diagnostics) || {},
    cached: true,
  };
}

function canonicalDp(tier, options, ledger) {
  const config = options || {};
  const source = (config.tiers && config.tiers[tier]) || DEFAULT_TIERS[tier] || DEFAULT_TIERS.normal;
  return {
    keyMode: config.keyMode || "location",
    stopOnFirstGoal: config.stopOnFirstGoal === true,
    maxActionsPerState: number(config.maxActionsPerState, 9999),
    maxExpansions: Math.max(1, number(source.maxExpansions, DEFAULT_TIERS.normal.maxExpansions)),
    maxRuntimeMs: Math.max(1, Math.min(
      number(source.maxRuntimeMs, DEFAULT_TIERS.normal.maxRuntimeMs),
      ledger
        ? Math.max(1, ledger.remainingRuntimeMs() - Math.min(1000, Math.floor(ledger.maxRuntimeMs * 0.1)))
        : Number.MAX_SAFE_INTEGER,
    )),
    maxHeapMb: Math.max(1, number(config.maxHeapMb, ledger ? ledger.maxHeapMb : 1024)),
    goalSkylineLimit: Math.max(1, number(config.goalSkylineLimit, tier === "quick" || tier === "probe" ? 1 : tier === "normal" ? 2 : 4)),
    dpSkylineMax: Math.max(1, number(config.dpSkylineMax, tier === "quick" || tier === "probe" ? 1 : tier === "normal" ? 2 : 4)),
    resourceTimingModel: config.resourceTimingModel || "breakpoint-v1",
    resourceTimingTargetLimit: Math.max(1, number(config.resourceTimingTargetLimit, 16)),
    resourceTimingResourceLimit: Math.max(1, number(config.resourceTimingResourceLimit, 4)),
    resourceTimingThresholdLimit: Math.max(1, number(config.resourceTimingThresholdLimit, 3)),
    resourceTimingSkylineMax: Math.max(1, Math.min(4, number(config.resourceTimingSkylineMax, 4))),
    resourceTimingCalculateThresholds: config.resourceTimingCalculateThresholds === true,
    resourceDeferralEnabled: config.resourceDeferralEnabled === true,
    resourceDeferralLimit: Math.max(1, number(config.resourceDeferralLimit, 2)),
    resourceDeferralMaxExpansions: Math.max(1, number(config.resourceDeferralMaxExpansions, 600)),
    resourceDeferralMaxRuntimeMs: Math.max(1, number(config.resourceDeferralMaxRuntimeMs, 5000)),
    resourceDeferralMinSaving: Math.max(0, number(config.resourceDeferralMinSaving, 5000)),
    preserveSkylineRoles: config.preserveSkylineRoles !== false,
    landmarkArchiveLimit: Math.max(0, number(
      config.landmarkArchiveLimit,
      tier === "quick" || tier === "probe" ? 12 : tier === "normal" ? 16 : 24,
    )),
  };
}

function runCachedSegmentSearch(simulator, startState, segment, tier, context) {
  const config = context || {};
  const ledger = config.ledger;
  const cache = config.cache;
  if (ledger && !ledger.canContinue()) return null;
  const dp = canonicalDp(tier, config, ledger);
  const runnable = {
    ...cloneJson(segment),
    dp: { ...((segment || {}).dp || {}), ...dp },
  };
  const cached = cache && cache.get(startState, runnable, dp);
  if (cached) {
    const hydrated = hydrateSegmentResult(cached, runnable.id, startState);
    if (ledger) {
      ledger.record({
        kind: config.kind || "segment-search",
        nodeId: config.nodeId || null,
        segmentId: runnable.id,
        tier,
        cached: true,
        found: hydrated.found,
        diagnostics: (((hydrated || {}).diagnostics || {}).dp) || {},
      });
    }
    return hydrated;
  }
  const result = searchSegmentDP(simulator, startState, runnable, {
    candidateLimit: dp.goalSkylineLimit,
    preserveSkylineRoles: true,
    captureTrace: false,
    dpOverrides: dp,
  });
  if (cache) cache.put(startState, runnable, dp, segmentResultForCache(result, startState));
  delete result.rawResult;
  if (ledger) {
    ledger.record({
      kind: config.kind || "segment-search",
      nodeId: config.nodeId || null,
      segmentId: runnable.id,
      tier,
      cached: false,
      found: result.found,
      diagnostics: (((result || {}).diagnostics || {}).dp) || {},
    });
  }
  collectSearchGarbage(simulator);
  return result;
}

function shouldEscalate(result) {
  const dp = result && result.diagnostics && result.diagnostics.dp;
  if (!dp || result.found) return false;
  if (number(dp.actionTrimmed, 0) > 0) return false;
  if (dp.completeWithinActionSet === true && number(dp.frontierSize, 0) === 0) return false;
  return (
    dp.stoppedReason === "time-limit" ||
    dp.stoppedReason === "memory-limit" ||
    dp.expansionBudgetExhausted === true ||
    number(dp.frontierSize, 0) > 0
  );
}

function runTieredSearch(simulator, startState, segment, context) {
  const config = context || {};
  const tiers = config.tiersToRun || ["probe", "normal"];
  let result = null;
  for (const tier of tiers) {
    if (
      result &&
      !shouldEscalate(result) &&
      !(config.continueAfterFound === true && result.found)
    ) break;
    result = runCachedSegmentSearch(simulator, startState, segment, tier, config);
    if (!result || (result.found && config.continueAfterFound !== true)) break;
  }
  return result;
}

function inferAllowedFloors(project, startFloorId, targetFloorId) {
  const order = (project && project.floorOrder) || [];
  const start = order.indexOf(startFloorId);
  const target = order.indexOf(targetFloorId);
  if (start < 0 || target < 0) return [startFloorId, targetFloorId].filter(Boolean);
  const rollbackFloors = start === target ? 2 : 1;
  const low = Math.max(0, Math.min(start, target) - rollbackFloors);
  const high = Math.max(start, target);
  return order.slice(low, high + 1);
}

function inferChangeFloorKeys(project, floorIds) {
  const keys = [];
  (floorIds || []).forEach((floorId) => {
    const floor = project && project.floorsById && project.floorsById[floorId];
    Object.keys((floor && floor.changeFloor) || {}).forEach((coordinate) => {
      keys.push(`${floorId}:${coordinate}`);
    });
  });
  return keys.sort();
}

function normalizeTargetSegment(project, initialState, segment, options) {
  const config = options || {};
  const target = cloneJson(segment || {});
  target.id = target.id || "auto-decompose-final-goal";
  target.label = target.label || "Auto-decomposed final goal";
  target.goal = target.goal || {};
  const inferredFloors = inferAllowedFloors(
    project,
    initialState && initialState.floorId,
    target.goal.floorId || (initialState && initialState.floorId),
  );
  const allowedFloors = config.allowedFloors ||
    ((target.actionPolicy || {}).allowedFloors || []).concat(inferredFloors)
      .filter((value, index, all) => value && all.indexOf(value) === index);
  target.actionPolicy = {
    actionKinds: ["battle", "pickup", "equip", "openDoor", "useTool", "changeFloor", "event"],
    forbidUnsupportedEvents: true,
    ...(target.actionPolicy || {}),
    allowedFloors,
    allowChangeFloors: ((target.actionPolicy || {}).allowChangeFloors || [])
      .concat(inferChangeFloorKeys(project, allowedFloors))
      .filter((value, index, all) => value && all.indexOf(value) === index),
  };
  target.dp = {
    keyMode: "location",
    stopOnFirstGoal: false,
    goalSkylineLimit: 4,
    dpSkylineMax: 4,
    preserveSkylineRoles: true,
    ...(target.dp || {}),
  };
  return target;
}

function parseActionTarget(summary) {
  const normalized = String(summary || "").replace(/^auto:/, "");
  let match = /^(battle|pickup|openDoor|event):[^@]+@([^:]+):(\d+),(\d+)$/.exec(normalized);
  if (match) {
    return {
      kind: match[1],
      floorId: match[2],
      x: Number(match[3]),
      y: Number(match[4]),
    };
  }
  match = /^changeFloor@([^:]+):(\d+),(\d+)$/.exec(normalized);
  if (match) {
    return {
      kind: "changeFloor",
      floorId: match[1],
      x: Number(match[2]),
      y: Number(match[3]),
    };
  }
  match = /^equip:([^@]+)(?:@.*)?$/.exec(normalized);
  if (match) return { kind: "equip", itemId: match[1] };
  return null;
}

function findActionBySummary(simulator, state, summary) {
  const actions = [];
  try {
    actions.push(...((simulator.enumeratePrimitiveActions(state) || {}).actions || []));
  } catch (error) {
  }
  try {
    actions.push(...(simulator.enumerateActions(state) || []));
  } catch (error) {
  }
  try {
    if (typeof simulator.enumerateInteractPickupActions === "function") {
      actions.push(...(simulator.enumerateInteractPickupActions(state) || []));
    }
  } catch (error) {
  }
  return actions.find((action) => action && action.summary === summary) || null;
}

function findActionByRouteEntry(simulator, state, entry) {
  const summary = routeEntrySummary(entry);
  const source = entry && typeof entry === "object"
    ? entry.actionEntry || entry
    : null;
  const expectedPath = source && Array.isArray(source.path) ? source.path : null;
  let actions = [];
  try {
    actions.push(...((simulator.enumeratePrimitiveActions(state) || {}).actions || []));
  } catch (error) {
  }
  try {
    actions.push(...(simulator.enumerateActions(state) || []));
  } catch (error) {
  }
  const matching = actions.filter(
    (action) => action && action.summary === summary,
  );
  if (!expectedPath) {
    return matching
      .map((action) => {
        try {
          const nextState = simulator.applyAction(state, action);
          return { action, hp: number((nextState.hero || {}).hp, 0) };
        } catch (error) {
          return null;
        }
      })
      .filter(Boolean)
      .sort((left, right) => right.hp - left.hp)[0]?.action ||
      findActionBySummary(simulator, state, summary);
  }
  const expectedPathKey = JSON.stringify(expectedPath);
  return matching.find(
    (action) => JSON.stringify(action.path || []) === expectedPathKey,
  ) || matching[0] || findActionBySummary(simulator, state, summary);
}

function findPickupActionByTarget(simulator, state, summary) {
  const target = parseActionTarget(summary);
  if (!target || target.kind !== "pickup") return null;
  const actions = [];
  try {
    actions.push(...((simulator.enumeratePrimitiveActions(state) || {}).actions || []));
  } catch (error) {
  }
  try {
    if (typeof simulator.enumerateInteractPickupActions === "function") {
      actions.push(...(simulator.enumerateInteractPickupActions(state) || []));
    }
  } catch (error) {
  }
  return actions.find((action) => {
    if (!action || !["pickup", "interactPickup"].includes(action.kind)) return false;
    const actionTarget = action.target || action;
    const floorId = action.floorId || actionTarget.floorId;
    const itemId = action.itemId || action.id;
    return floorId === target.floorId &&
      Number(actionTarget.x) === target.x &&
      Number(actionTarget.y) === target.y &&
      (!itemId || itemId === target.id);
  }) || null;
}

function stateDelta(before, after) {
  const beforeHero = summarizeHero(before);
  const afterHero = summarizeHero(after);
  const beforeEquipment = new Set(beforeHero.equipment || []);
  const afterEquipment = (afterHero.equipment || []).filter((item) => !beforeEquipment.has(item));
  return {
    floorChanged: before.floorId !== after.floorId,
    hp: number(afterHero.hp, 0) - number(beforeHero.hp, 0),
    atk: number(afterHero.atk, 0) - number(beforeHero.atk, 0),
    def: number(afterHero.def, 0) - number(beforeHero.def, 0),
    mdef: number(afterHero.mdef, 0) - number(beforeHero.mdef, 0),
    lv: number(afterHero.lv, 0) - number(beforeHero.lv, 0),
    hatred: number(((after || {}).flags || {}).hatred, 0) -
      number(((before || {}).flags || {}).hatred, 0),
    equipmentAdded: afterEquipment,
  };
}

function isCombatStateTransition(project, summary, delta) {
  if (!String(summary || "").startsWith("battle:")) return false;
  const normalHatredDelta = number((((project || {}).values || {}).hatred), 0);
  return number((delta || {}).hatred, 0) !== normalHatredDelta;
}

function isPureHpResourceDelta(delta) {
  const change = delta || {};
  return Boolean(
    number(change.hp, 0) > 0 &&
    number(change.atk, 0) <= 0 &&
    number(change.def, 0) <= 0 &&
    number(change.mdef, 0) <= 0 &&
    number(change.lv, 0) <= 0 &&
    !change.floorChanged &&
    (change.equipmentAdded || []).length === 0
  );
}

function isDeferredHpResourceDelta(delta) {
  const change = delta || {};
  const hpGain = number(change.hp, 0);
  if (hpGain <= 0) return false;
  if (isPureHpResourceDelta(change)) return hpGain >= 50000;
  const bundledProgress =
    Math.max(0, number(change.atk, 0)) * 100 +
    Math.max(0, number(change.def, 0)) * 100 +
    Math.max(0, number(change.mdef, 0)) * 10 +
    Math.max(0, number(change.lv, 0)) * 10000 +
    ((change.equipmentAdded || []).length * 10000);
  return hpGain >= Math.max(50000, bundledProgress * 5);
}

function buildLandmarkGoal(before, after, summary, finalGoal) {
  const target = parseActionTarget(summary);
  const delta = stateDelta(before, after);
  const goal = {
    type: "autoCausalLandmark",
    floorId: after.floorId,
  };
  if (target && ["battle", "pickup", "openDoor", "event"].includes(target.kind)) {
    goal.removedTiles = [{ floorId: target.floorId, x: target.x, y: target.y }];
  }
  const minHero = {};
  const afterHero = summarizeHero(after);
  if (number(delta.hp, 0) > 0 && isDeferredHpResourceDelta(delta)) {
    minHero.hp = afterHero.hp;
  }
  if (delta.atk > 0) minHero.atk = afterHero.atk;
  if (delta.def > 0) minHero.def = afterHero.def;
  if (delta.mdef > 0) minHero.mdef = afterHero.mdef;
  if (delta.lv > 0) minHero.lv = afterHero.lv;
  if (Object.keys(minHero).length > 0) goal.minHero = minHero;
  const equipment = delta.equipmentAdded.length > 0
    ? delta.equipmentAdded
    : target && target.kind === "equip"
      ? [target.itemId]
      : [];
  if (equipment.length > 0) goal.equipmentIncludes = equipment;
  const inheritedPresent = (finalGoal && finalGoal.presentTiles) || [];
  if (inheritedPresent.length > 0) {
    goal.preferredPresentTiles = cloneJson(inheritedPresent);
  }
  return goal;
}

function isMeaningfulLandmark(goal, delta) {
  const change = delta || {};
  return Boolean(
    (goal.removedTiles && goal.removedTiles.length) ||
    (goal.anyRemovedTiles && goal.anyRemovedTiles.length) ||
    (goal.equipmentIncludes && goal.equipmentIncludes.length) ||
    number(change.atk, 0) > 0 ||
    number(change.def, 0) > 0 ||
    number(change.mdef, 0) > 0 ||
    number(change.lv, 0) > 0 ||
    number(change.hp, 0) > 0,
  );
}

function landmarkSignature(goal) {
  const compact = cloneJson(goal || {});
  delete compact.type;
  delete compact.preferredPresentTiles;
  return hashValue(compact);
}

function buildLandmarkSegment(index, goal, targetSegment, summary) {
  return {
    id: `auto-landmark-${String(index).padStart(2, "0")}-${landmarkSignature(goal).slice(0, 8)}`,
    label: `Auto landmark ${index}: ${summary}`,
    generated: true,
    generatedBy: {
      mode: "causal-decomposition",
      sourceSummary: summary,
      hardPresentSource: (goal.presentTiles || []).length > 0 ? "inherited-final-goal" : null,
    },
    goal: cloneJson(goal),
    actionPolicy: cloneJson(targetSegment.actionPolicy),
    dp: {
      keyMode: "location",
      stopOnFirstGoal: false,
      maxActionsPerState: 9999,
      maxExpansions: DEFAULT_TIERS.normal.maxExpansions,
      maxRuntimeMs: DEFAULT_TIERS.normal.maxRuntimeMs,
      goalSkylineLimit: 4,
      dpSkylineMax: 4,
      preserveSkylineRoles: true,
    },
  };
}

function replayScoutDecisions(simulator, startState, scoutState, finalGoal, maxCandidates) {
  const startRouteLength = Array.isArray(startState.route) ? startState.route.length : 0;
  const deltaEntries = (Array.isArray(scoutState && scoutState.route) ? scoutState.route : [])
    .slice(startRouteLength)
    .map(routeEntrySummary)
    .filter((summary) => summary && !summary.startsWith("auto:"));
  let state = cloneState(startState);
  const candidates = [];
  const seen = new Set();
  let consumedHpResources = 0;
  const consumedHpResourceKeys = [];
  const consumedHpResourceRecords = [];
  for (const [decisionIndex, summary] of deltaEntries.entries()) {
    const action = findActionBySummary(simulator, state, summary);
    if (!action) break;
    const before = state;
    state = simulator.applyAction(state, action);
    const goal = buildLandmarkGoal(before, state, summary, finalGoal);
    const delta = stateDelta(before, state);
    if (isDeferredHpResourceDelta(delta)) {
      consumedHpResources += 1;
      consumedHpResourceKeys.push(summary);
      consumedHpResourceRecords.push({
        summary,
        hpGain: number(delta.hp, 0),
        decisionIndex,
      });
    }
    if (!isMeaningfulLandmark(goal, delta)) continue;
    const signature = landmarkSignature(goal);
    if (seen.has(signature)) continue;
    seen.add(signature);
    candidates.push({
      id: `landmark-candidate-${decisionIndex + 1}-${signature.slice(0, 8)}`,
      decisionIndex,
      summary,
      goal,
      signature,
      state: cloneState(state),
      causalScore:
        (delta.floorChanged ? 1000000 : 0) +
        delta.equipmentAdded.length * 2000000 +
        Math.max(0, delta.atk) * 10000 +
        Math.max(0, delta.def) * 12000 +
        Math.max(0, delta.mdef) * 1000 +
        Math.max(0, delta.hp) +
        Math.max(0, delta.lv) * 500000,
      delta,
      combatStateTransition: isCombatStateTransition(simulator.project, summary, delta),
      consumedHpResources,
      consumedHpResourceKeys: consumedHpResourceKeys.slice(),
      consumedHpResourceRecords: cloneJson(consumedHpResourceRecords),
    });
    if (candidates.length >= Math.max(1, number(maxCandidates, 24))) break;
  }
  return candidates;
}

function traceHpResourceRecords(simulator, startState, endState) {
  const startRouteLength = Array.isArray(startState.route) ? startState.route.length : 0;
  const summaries = (Array.isArray(endState && endState.route) ? endState.route : [])
    .slice(startRouteLength)
    .map(routeEntrySummary)
    .filter((summary) => summary && !summary.startsWith("auto:"));
  let state = cloneState(startState);
  const records = [];
  for (const [decisionIndex, summary] of summaries.entries()) {
    const action = findActionBySummary(simulator, state, summary);
    if (!action) break;
    const before = state;
    state = simulator.applyAction(state, action);
    const delta = stateDelta(before, state);
    if (isDeferredHpResourceDelta(delta)) {
      records.push({ summary, hpGain: number(delta.hp, 0), decisionIndex });
    }
  }
  const bySummary = new Map();
  records.forEach((record) => {
    const existing = bySummary.get(record.summary);
    if (!existing || record.hpGain > existing.hpGain) bySummary.set(record.summary, record);
  });
  return Array.from(bySummary.values()).sort((left, right) => left.summary.localeCompare(right.summary));
}

function traceHpResourceKeys(simulator, startState, endState) {
  return traceHpResourceRecords(simulator, startState, endState).map((record) => record.summary);
}

function tileRemoved(project, state, tile) {
  const current = getTileDefinitionAt(project, state, tile.floorId, tile.x, tile.y);
  return !current || current.id === "none" || current.cls === "empty";
}

function goalProgressScore(project, state, goal) {
  if (!state) return -Number.MAX_SAFE_INTEGER;
  let score = 0;
  const hero = summarizeHero(state);
  const effective = summarizeEffectiveHero(state);
  if (goal.floorId && state.floorId === goal.floorId) score += 100000000;
  (goal.equipmentIncludes || []).forEach((item) => {
    if ((hero.equipment || []).includes(item)) score += 500000000;
  });
  (goal.removedTiles || []).forEach((tile) => {
    if (tileRemoved(project, state, tile)) score += 100000000;
  });
  (goal.anyRemovedTiles || []).forEach((tile) => {
    if (tileRemoved(project, state, tile)) score += 50000000;
  });
  (goal.presentTiles || []).forEach((tile) => {
    if (!tileRemoved(project, state, tile)) score += 10000000;
    else score -= 200000000;
  });
  Object.entries(goal.minHero || {}).forEach(([field, expected]) => {
    const actual = number(hero[field], 0);
    score += Math.min(1, actual / Math.max(1, number(expected, 1))) * 20000000;
  });
  Object.entries(goal.minEffectiveHero || {}).forEach(([field, expected]) => {
    const actual = number(effective[field], 0);
    score += Math.min(1, actual / Math.max(1, number(expected, 1))) * 30000000;
  });
  score += number(hero.hp, 0);
  return score;
}

function targetBalanceRatio(state, goal) {
  const target = goal || {};
  const effective = summarizeEffectiveHero(state);
  const hero = summarizeHero(state);
  const ratios = [];
  Object.entries(target.minEffectiveHero || {}).forEach(([field, expected]) => {
    if (number(expected, 0) > 0) ratios.push(number(effective[field], 0) / number(expected, 1));
  });
  Object.entries(target.minHero || {}).forEach(([field, expected]) => {
    if (field !== "hp" && number(expected, 0) > 0) ratios.push(number(hero[field], 0) / number(expected, 1));
  });
  return ratios.length > 0 ? Math.min(...ratios.map((value) => Math.min(1, value))) : 0;
}

function targetBalanceScore(state, goal) {
  const hero = summarizeHero(state);
  const effective = summarizeEffectiveHero(state);
  const target = goal || {};
  const coverageRatios = [];
  Object.entries(target.minEffectiveHero || {}).forEach(([field, expected]) => {
    if (number(expected, 0) > 0) {
      coverageRatios.push(Math.min(1, number(effective[field], 0) / number(expected, 1)));
    }
  });
  Object.entries(target.minHero || {}).forEach(([field, expected]) => {
    if (field !== "hp" && number(expected, 0) > 0) {
      coverageRatios.push(Math.min(1, number(hero[field], 0) / number(expected, 1)));
    }
  });
  const coverage = coverageRatios.reduce((sum, value) => sum + value, 0);
  return targetBalanceRatio(state, target) * 1000000000000 +
    coverage * 10000000000 +
    number(hero.hp, 0) * 1000;
}

function shouldReplaceCheckpointState(
  currentState,
  candidateState,
  finalGoal,
  currentResourceCost,
  candidateResourceCost,
) {
  if (!candidateState) return false;
  if (!currentState) return true;
  const resourceDelta = number(candidateResourceCost, 0) -
    number(currentResourceCost, 0);
  if (resourceDelta !== 0) return resourceDelta < 0;
  const hpDelta = number((candidateState.hero || {}).hp, 0) -
    number((currentState.hero || {}).hp, 0);
  if (hpDelta !== 0) return hpDelta > 0;
  return targetBalanceScore(candidateState, finalGoal) >
    targetBalanceScore(currentState, finalGoal);
}

function countProgressOptions(simulator, state, actionProvider) {
  try {
    return (actionProvider(simulator, state) || []).filter((action) =>
      action && ["battle", "pickup", "equip", "openDoor", "event", "useTool"].includes(action.kind),
    ).length;
  } catch (error) {
    return 0;
  }
}

function bestProgressState(result) {
  if (!result) return null;
  if (result.found && result.goalSkyline && result.goalSkyline[0]) {
    return result.goalSkyline[0].state;
  }
  return result.bestProgress || result.bestSeen || null;
}

function collectLandmarkCandidates(simulator, startState, searchResult, targetSegment, maxCandidates) {
  const finalGoal = (targetSegment && targetSegment.goal) || {};
  const sources = [{ role: "current-frontier", score: 0, state: startState }];
  const primary = bestProgressState(searchResult);
  if (primary) sources.push({ role: "best-progress", score: 0, state: primary });
  (searchResult && searchResult.goalSkyline || []).forEach((record) => {
    if (record && record.state) {
      sources.push({
        ...record,
        role: "goal-skyline",
        score: targetBalanceScore(record.state, finalGoal),
      });
    }
  });
  (searchResult && searchResult.landmarkArchive || []).forEach((record) => {
    if (record && record.state) sources.push(record);
  });
  sources.forEach((source) => {
    source.consumedHpResourceRecords = traceHpResourceRecords(simulator, startState, source.state);
    source.consumedHpResourceKeys = source.consumedHpResourceRecords.map((record) => record.summary);
    source.consumedHpResources = source.consumedHpResourceKeys.length;
  });
  const bySignature = new Map();
  const keepCandidate = (enriched) => {
    const existing = bySignature.get(enriched.signature);
    const enrichedPriority =
      (enriched.sourceRole === "mobility" ? 1000000000000000 : 0) +
      (enriched.sourceRole === "current-frontier" ? 500000000000000 : 0) +
      targetBalanceScore(enriched.state, finalGoal) -
      enriched.decisionIndex * 1000 +
      enriched.causalScore;
    const existingPriority = existing
      ? (existing.sourceRole === "mobility" ? 1000000000000000 : 0) +
        (existing.sourceRole === "current-frontier" ? 500000000000000 : 0) +
        targetBalanceScore(existing.state, finalGoal) -
        existing.decisionIndex * 1000 +
        existing.causalScore
      : -Infinity;
    if (!existing || enrichedPriority > existingPriority) {
      bySignature.set(enriched.signature, enriched);
    }
  };
  sources.forEach((source) => {
    const replayedCandidates = replayScoutDecisions(
      simulator,
      startState,
      source.state,
      finalGoal,
      maxCandidates,
    );
    const confirmedResources = new Map(
      (source.consumedHpResourceRecords || []).map((record) => [record.summary, record]),
    );
    replayedCandidates
      .flatMap((candidate) => candidate.consumedHpResourceRecords || [])
      .forEach((record) => {
        const existing = confirmedResources.get(record.summary);
        if (!existing || number(record.hpGain, 0) > number(existing.hpGain, 0)) {
          confirmedResources.set(record.summary, record);
        }
      });
    source.consumedHpResourceRecords = Array.from(confirmedResources.values());
    source.consumedHpResourceKeys = source.consumedHpResourceRecords
      .map((record) => record.summary)
      .sort();
    source.consumedHpResources = source.consumedHpResourceKeys.length;
    replayedCandidates.forEach((candidate) => {
        keepCandidate({
          ...candidate,
          sourceRole:
            source.role === "mobility" && /^changeFloor@|^floorFly:/.test(candidate.summary || "")
              ? "mobility"
              : source.role === "mobility"
                ? "mobility-path"
                : source.role || "archive",
          archiveScore: number(source.score, 0),
        });
      });
  });
  const actionProvider = buildSegmentActionProvider(simulator, targetSegment);
  sources.slice(0, 12).forEach((source) => {
    let actions = [];
    try {
      actions = actionProvider(simulator, source.state) || [];
    } catch (error) {
      return;
    }
    actions.slice(0, 16).forEach((action) => {
      if (!action || !["battle", "pickup", "equip", "openDoor", "event", "changeFloor", "floorFly"].includes(action.kind)) return;
      let after;
      try {
        after = simulator.applyAction(source.state, action);
      } catch (error) {
        return;
      }
      const goal = buildLandmarkGoal(source.state, after, action.summary, finalGoal);
      const delta = stateDelta(source.state, after);
      if (!isMeaningfulLandmark(goal, delta)) return;
      const signature = landmarkSignature(goal);
      const decisionIndex = Math.max(
        0,
        (Array.isArray(after.route) ? after.route.length : 0) -
        (Array.isArray(startState.route) ? startState.route.length : 0) - 1,
      );
      keepCandidate({
        id: `frontier-candidate-${decisionIndex + 1}-${signature.slice(0, 8)}`,
        decisionIndex,
        summary: action.summary,
        goal,
        signature,
        state: cloneState(after),
        sourceRole: action.kind === "changeFloor" || action.kind === "floorFly"
          ? "mobility"
          : source.role === "current-frontier"
            ? "current-frontier"
            : "frontier-action",
        archiveScore: number(source.score, 0),
        causalScore:
          (action.kind === "changeFloor" || action.kind === "floorFly" ? 1000000 : 0) +
          delta.equipmentAdded.length * 2000000 +
          Math.max(0, delta.atk) * 10000 +
          Math.max(0, delta.def) * 12000 +
          Math.max(0, delta.mdef) * 1000 +
          Math.max(0, delta.hp) +
          Math.max(0, delta.lv) * 500000,
        delta,
        combatStateTransition: isCombatStateTransition(
          simulator.project,
          action.summary,
          delta,
        ),
        consumedHpResources: number(source.consumedHpResources, 0) + (isDeferredHpResourceDelta(delta) ? 1 : 0),
        consumedHpResourceKeys: Array.from(new Set([
          ...(source.consumedHpResourceKeys || []),
          ...(isDeferredHpResourceDelta(delta) ? [action.summary] : []),
        ])).sort(),
        consumedHpResourceRecords: (source.consumedHpResourceRecords || []).concat(
          isDeferredHpResourceDelta(delta)
            ? [{ summary: action.summary, hpGain: number(delta.hp, 0), decisionIndex }]
            : [],
        ),
      });
    });
  });
  const ranked = Array.from(bySignature.values())
    .sort((left, right) => {
      const mobility = (right.sourceRole === "mobility" ? 1 : 0) - (left.sourceRole === "mobility" ? 1 : 0);
      const current = (right.sourceRole === "current-frontier" ? 1 : 0) - (left.sourceRole === "current-frontier" ? 1 : 0);
      return mobility || current || right.causalScore - left.causalScore || left.decisionIndex - right.decisionIndex;
    });
  const limit = Math.max(1, number(maxCandidates, 24));
  const selected = [];
  const selectedSignatures = new Set();
  const keep = (candidate) => {
    if (!candidate || selected.length >= limit || selectedSignatures.has(candidate.signature)) return;
    selectedSignatures.add(candidate.signature);
    selected.push(candidate);
  };
  keep(ranked.find((candidate) => candidate.sourceRole === "mobility"));
  ranked.filter((candidate) => candidate.sourceRole === "current-frontier").slice(0, 2).forEach(keep);
  keep(ranked
    .filter((candidate) => candidate.sourceRole === "best-progress")
    .sort((left, right) => number((right.state.hero || {}).hp, 0) - number((left.state.hero || {}).hp, 0))[0]);
  keep(ranked.slice().sort((left, right) =>
    number((right.state.hero || {}).hp, 0) - number((left.state.hero || {}).hp, 0) ||
    right.causalScore - left.causalScore,
  )[0]);
  ranked.forEach(keep);
  return selected;
}

function selectProbeCandidates(candidates, limit) {
  const max = Math.max(1, number(limit, 6));
  const selected = [];
  const seen = new Set();
  const keep = (candidate, probeRole) => {
    if (!candidate || seen.has(candidate.signature) || selected.length >= max) return;
    seen.add(candidate.signature);
    selected.push({ ...candidate, probeRole });
  };
  const records = (candidates || []).slice();
  records
    .filter((candidate) => candidate.sourceRole === "current-frontier")
    .sort((left, right) => right.causalScore - left.causalScore || left.summary.localeCompare(right.summary))
    .slice(0, 2)
    .forEach((candidate) => keep(candidate, "current-frontier"));
  keep(records.find((candidate) => candidate.sourceRole === "mobility"), "mobility");
  keep(records
    .filter((candidate) => candidate.sourceRole === "counterfactual-protected")
    .sort((left, right) =>
      number(right.protectedResourceGain, 0) - number(left.protectedResourceGain, 0) ||
      number(right.protectedBalanceRatio, 0) - number(left.protectedBalanceRatio, 0) ||
      right.decisionIndex - left.decisionIndex ||
      right.causalScore - left.causalScore,
    )[0], "counterfactual-protected");
  keep(records
    .filter((candidate) => candidate.sourceRole === "counterfactual-protected")
    .sort((left, right) => {
      const leftEffective = summarizeEffectiveHero(left.state);
      const rightEffective = summarizeEffectiveHero(right.state);
      return number(rightEffective.atk, 0) - number(leftEffective.atk, 0) ||
        number(rightEffective.def, 0) - number(leftEffective.def, 0) ||
        number(rightEffective.mdef, 0) - number(leftEffective.mdef, 0) ||
        number((right.state.hero || {}).hp, 0) - number((left.state.hero || {}).hp, 0);
    })[0], "counterfactual-protected-combat");
  keep(records
    .filter((candidate) => candidate.sourceRole === "counterfactual-protected")
    .sort((left, right) =>
      number(left.consumedHpResources, 0) - number(right.consumedHpResources, 0) ||
      number((right.delta || {}).atk, 0) - number((left.delta || {}).atk, 0) ||
      number((right.delta || {}).def, 0) - number((left.delta || {}).def, 0) ||
      number((right.delta || {}).mdef, 0) - number((left.delta || {}).mdef, 0) ||
      right.causalScore - left.causalScore,
    )[0], "counterfactual-protected-preparation");
  keep(records
    .filter((candidate) =>
      String(candidate.summary || "").startsWith("battle:") &&
      candidate.combatStateTransition === true,
    )
    .sort((left, right) =>
      number(right.downstreamScore, 0) - number(left.downstreamScore, 0) ||
      number((right.state.hero || {}).hp, 0) - number((left.state.hero || {}).hp, 0) ||
      right.causalScore - left.causalScore,
    )[0], "combat-state-transition");
  keep(records.find((candidate) => candidate.sourceRole === "survival"), "survival");
  keep(records.slice().sort((left, right) => right.causalScore - left.causalScore)[0], "highest-causal-gain");
  keep(records.slice().sort((left, right) => number((right.state.hero || {}).hp, 0) - number((left.state.hero || {}).hp, 0))[0], "highest-hp");
  keep(records.slice().sort((left, right) => left.decisionIndex - right.decisionIndex)[0], "earliest");
  records.forEach((candidate) => keep(candidate, "ranked"));
  return selected;
}

function selectBranchCandidates(candidates, limit) {
  const max = Math.max(1, number(limit, 3));
  const selected = [];
  const seen = new Set();
  const keep = (candidate, role) => {
    if (!candidate || seen.has(candidate.signature) || selected.length >= max) return;
    seen.add(candidate.signature);
    selected.push({ ...candidate, selectedRole: role });
  };
  const ordered = (candidates || []).slice();
  keep(ordered.slice().sort((left, right) => right.branchScore - left.branchScore)[0], "best-downstream");
  keep(ordered.slice().sort((left, right) =>
    number(right.resourceTimingScore, 0) - number(left.resourceTimingScore, 0) ||
    number(right.downstreamScore, 0) - number(left.downstreamScore, 0) ||
    number((right.state.hero || {}).hp, 0) - number((left.state.hero || {}).hp, 0),
  )[0], "resource-timing-breakpoint");
  keep(ordered
    .filter((candidate) =>
      number((candidate.delta || {}).atk, 0) > 0 ||
      number((candidate.delta || {}).def, 0) > 0 ||
      number((candidate.delta || {}).mdef, 0) > 0,
    )
    .sort((left, right) =>
      number(right.preparationEfficiency, 0) - number(left.preparationEfficiency, 0) ||
      number((right.state.hero || {}).hp, 0) - number((left.state.hero || {}).hp, 0) ||
      number(right.downstreamScore, 0) - number(left.downstreamScore, 0),
    )[0], "stat-preparation-efficiency");
  const protectedCandidates = ordered.filter(
    (candidate) => candidate.sourceRole === "counterfactual-protected",
  );
  keep(protectedCandidates.slice().sort((left, right) =>
    number(left.consumedHpResources, 0) - number(right.consumedHpResources, 0) ||
    number((right.delta || {}).atk, 0) - number((left.delta || {}).atk, 0) ||
    number((right.delta || {}).def, 0) - number((left.delta || {}).def, 0) ||
    number((right.delta || {}).mdef, 0) - number((left.delta || {}).mdef, 0) ||
    right.causalScore - left.causalScore,
  )[0], "counterfactual-preparation");
  const resourceCandidates = ordered.filter(
    (candidate) => number(candidate.consumedHpResources, 0) > 0,
  );
  const balancedResource = resourceCandidates.slice().sort((left, right) =>
    number(left.consumedHpResources, 0) - number(right.consumedHpResources, 0) ||
    number(right.balanceRatio, 0) - number(left.balanceRatio, 0) ||
    number(right.downstreamScore, 0) - number(left.downstreamScore, 0) ||
    right.branchScore - left.branchScore ||
    left.summary.localeCompare(right.summary),
  )[0];
  const highestHpResource = resourceCandidates.slice().sort((left, right) =>
    number(left.consumedHpResources, 0) - number(right.consumedHpResources, 0) ||
    number((right.state.hero || {}).hp, 0) - number((left.state.hero || {}).hp, 0) ||
    number(right.balanceRatio, 0) - number(left.balanceRatio, 0),
  )[0];
  const balancedResourceHp = number((((balancedResource || {}).state || {}).hero || {}).hp, 0);
  const highestResourceHp = number((((highestHpResource || {}).state || {}).hero || {}).hp, 0);
  const canPreferResourceHp = number((highestHpResource || {}).parentResourceCost, 0) > 0;
  keep(
    canPreferResourceHp && highestResourceHp >= Math.max(1, balancedResourceHp) * 4
      ? highestHpResource
      : balancedResource,
    canPreferResourceHp && highestResourceHp >= Math.max(1, balancedResourceHp) * 4
      ? "resource-timing-high-hp"
      : "resource-timing-diversity",
  );
  keep(ordered
    .filter((candidate) =>
      String(candidate.summary || "").startsWith("battle:") &&
      candidate.combatStateTransition === true,
    )
    .sort((left, right) =>
      number(right.downstreamScore, 0) - number(left.downstreamScore, 0) ||
      number((right.state.hero || {}).hp, 0) - number((left.state.hero || {}).hp, 0) ||
      right.branchScore - left.branchScore,
    )[0], "combat-state-transition");
  keep(protectedCandidates.slice().sort((left, right) =>
    number(right.protectedBalanceRatio, 0) - number(left.protectedBalanceRatio, 0) ||
    right.branchScore - left.branchScore,
  )[0], "counterfactual-balance");
  keep(protectedCandidates.slice().sort((left, right) => {
    const leftEffective = summarizeEffectiveHero(left.state);
    const rightEffective = summarizeEffectiveHero(right.state);
    return number(rightEffective.atk, 0) - number(leftEffective.atk, 0) ||
      number(rightEffective.def, 0) - number(leftEffective.def, 0) ||
      number(rightEffective.mdef, 0) - number(leftEffective.mdef, 0) ||
      right.branchScore - left.branchScore;
  })[0], "counterfactual-combat");
  const current = ordered.filter((candidate) => candidate.sourceRole === "current-frontier");
  keep(
    current.slice().sort((left, right) => right.branchScore - left.branchScore || left.summary.localeCompare(right.summary))[0],
    "current-frontier-downstream",
  );
  keep(ordered.slice().sort((left, right) => {
    const hp = number((right.state.hero || {}).hp, 0) - number((left.state.hero || {}).hp, 0);
    return hp || right.causalScore - left.causalScore;
  })[0], "highest-hp");
  current
    .slice()
    .sort((left, right) => right.causalScore - left.causalScore || left.summary.localeCompare(right.summary))
    .forEach((candidate) => keep(candidate, "current-frontier-causal"));
  keep(ordered.find((candidate) => candidate.sourceRole === "mobility"), "mobility");
  keep(ordered.slice().sort((left, right) => right.causalScore - left.causalScore)[0], "causal-gain");
  ordered
    .slice()
    .sort((left, right) => right.branchScore - left.branchScore)
    .forEach((candidate) => keep(candidate, "ranked"));
  return selected;
}

function decompositionNodeSignature(node) {
  return hashValue({
    stateKey: buildDominanceKey(node.state),
    milestoneSignatures: (node.milestones || []).map((segment) => landmarkSignature(segment.goal)),
  });
}

function startsNewCausalPhase(node, candidate) {
  const delta = (candidate && candidate.delta) || {};
  return Boolean(
    !node ||
    node.depth === 0 ||
    node.depth % 4 === 0 ||
    delta.floorChanged ||
    ((delta.equipmentAdded || []).length > 0) ||
    number(delta.atk, 0) >= 100 ||
    number(delta.def, 0) >= 100 ||
    number(delta.mdef, 0) >= 500 ||
    number(delta.lv, 0) > 0
  );
}

function findPreMobilityPreparationId(candidates, mobilityCandidates, targetFloorId) {
  const records = candidates || [];
  const mobilityFloors = new Set(
    (mobilityCandidates || records)
      .filter((candidate) => candidate.selectedRole === "mobility" || candidate.sourceRole === "mobility")
      .map((candidate) => candidate.state && candidate.state.floorId)
      .filter(Boolean),
  );
  if (targetFloorId) mobilityFloors.add(targetFloorId);
  if (mobilityFloors.size === 0) return null;
  const preparation = records
    .filter((candidate) => {
      if (
        candidate.selectedRole === "mobility" ||
        candidate.sourceRole === "mobility" ||
        number(candidate.consumedHpResources, 0) > 0
      ) return false;
      const visited = candidate.state && candidate.state.visitedFloors;
      const visitedFloors = new Set(Array.isArray(visited) ? visited : Object.keys(visited || {}));
      return number(candidate.preparationEfficiency, 0) > 0 &&
        Array.from(mobilityFloors).some((floorId) => !visitedFloors.has(floorId));
    })
    .sort((left, right) =>
      number(right.preparationEfficiency, 0) - number(left.preparationEfficiency, 0) ||
      number(right.branchScore, 0) - number(left.branchScore, 0),
    )[0];
  return preparation ? preparation.id : null;
}

function selectNextDecompositionNodes(nodes, limit) {
  const max = Math.max(1, number(limit, 3));
  const selected = [];
  const seen = new Set();
  const keep = (node, role) => {
    if (!node) return;
    const signature = decompositionNodeSignature(node);
    if (seen.has(signature) || selected.length >= max) return;
    seen.add(signature);
    selected.push({ ...node, beamRole: role });
  };
  const candidates = (nodes || []).slice();
  keep(candidates
    .filter((candidate) => number(candidate.resourceTimingScore, 0) > 0)
    .slice()
    .sort((left, right) =>
      number(right.resourceTimingScore, 0) - number(left.resourceTimingScore, 0) ||
      number(right.score, 0) - number(left.score, 0),
    )[0], "resource-timing-option");
  const nearTarget = candidates.filter((node) => node.nearTarget === true);
  if (nearTarget.length > 0) {
    const minimumResourceCost = Math.min(
      ...nearTarget.map((node) => number(node.resourceCost, 0)),
    );
    const minimumResourceTier = nearTarget.filter(
      (node) => number(node.resourceCost, 0) === minimumResourceCost,
    );
    const mobilityFloors = new Set(
      minimumResourceTier
        .filter((node) => node.selectedRole === "mobility")
        .map((node) => node.state && node.state.floorId)
        .filter(Boolean),
    );
    if (mobilityFloors.size > 0) {
      const preparation = candidates
        .filter((node) => {
          if (node.nearTarget === true || number(node.resourceCost, 0) !== minimumResourceCost) return false;
          const visited = node.state && node.state.visitedFloors;
          const visitedFloors = new Set(Array.isArray(visited) ? visited : Object.keys(visited || {}));
          return Array.from(mobilityFloors).some((floorId) => !visitedFloors.has(floorId));
        })
        .sort((left, right) =>
          number(right.score, 0) - number(left.score, 0) ||
          number((right.state.hero || {}).hp, 0) - number((left.state.hero || {}).hp, 0),
        )[0];
      keep(preparation, "pre-mobility-preparation");
    }
    keep(minimumResourceTier.slice().sort((left, right) =>
      number((right.combatRole || {}).atk, 0) - number((left.combatRole || {}).atk, 0) ||
      number((right.combatRole || {}).def, 0) - number((left.combatRole || {}).def, 0) ||
      number((right.state.hero || {}).hp, 0) - number((left.state.hero || {}).hp, 0) ||
      right.score - left.score,
    )[0], "near-target-min-resource-atk");
    keep(minimumResourceTier.slice().sort((left, right) =>
      number((right.combatRole || {}).def, 0) - number((left.combatRole || {}).def, 0) ||
      number((right.combatRole || {}).atk, 0) - number((left.combatRole || {}).atk, 0) ||
      number((right.state.hero || {}).hp, 0) - number((left.state.hero || {}).hp, 0) ||
      right.score - left.score,
    )[0], "near-target-min-resource-def");
    const nextResourceCost = nearTarget
      .map((node) => number(node.resourceCost, 0))
      .filter((cost) => cost > minimumResourceCost)
      .sort((left, right) => left - right)[0];
    const nextResourceTier = nearTarget
      .filter((node) => number(node.resourceCost, 0) === nextResourceCost);
    const nextResourceBalanced = nextResourceTier
      .slice()
      .sort((left, right) =>
        number(right.balanceScore, 0) - number(left.balanceScore, 0) ||
        number(right.optionalityScore, 0) - number(left.optionalityScore, 0) ||
        number((right.state.hero || {}).hp, 0) - number((left.state.hero || {}).hp, 0),
      )[0];
    const nextResourceHighestHp = nextResourceTier
      .slice()
      .sort((left, right) =>
        number((right.state.hero || {}).hp, 0) - number((left.state.hero || {}).hp, 0) ||
        number(right.balanceScore, 0) - number(left.balanceScore, 0),
      )[0];
    keep(
      minimumResourceCost > 0
        ? nextResourceHighestHp
        : nextResourceBalanced,
      minimumResourceCost > 0
        ? "near-target-next-resource-hp"
        : "near-target-next-resource-balance",
    );
    keep(minimumResourceTier.slice().sort((left, right) =>
      number((right.state.hero || {}).hp, 0) - number((left.state.hero || {}).hp, 0) ||
      number(right.balanceScore, 0) - number(left.balanceScore, 0),
    )[0], "near-target-min-resource-hp");
    minimumResourceTier
      .slice()
      .sort((left, right) => number(right.balanceScore, 0) - number(left.balanceScore, 0))
      .forEach((node) => keep(node, "near-target-min-resource-fill"));
  }
  keep(candidates.slice().sort((left, right) => right.score - left.score)[0], "best-progress");
  keep(candidates.slice().sort((left, right) => {
    const hp = number((right.state.hero || {}).hp, 0) - number((left.state.hero || {}).hp, 0);
    return hp || right.score - left.score;
  })[0], "highest-hp");
  keep(candidates.slice().sort((left, right) =>
    number(left.resourceCost, 0) - number(right.resourceCost, 0) ||
    right.score - left.score,
  )[0], "resource-conserving");
  keep(candidates.slice().sort((left, right) =>
    number(right.balanceScore, 0) - number(left.balanceScore, 0) || right.score - left.score,
  )[0], "combat-balance");
  const byLineage = new Map();
  candidates.forEach((node) => {
    const lineage = node.beamGroup || node.lineage || node.id;
    if (!byLineage.has(lineage)) byLineage.set(lineage, []);
    byLineage.get(lineage).push(node);
  });
  Array.from(byLineage.entries())
    .map(([lineage, records]) => {
      const ranked = records.slice().sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
      return { lineage, node: ranked[0] };
    })
    .sort((left, right) => right.node.score - left.node.score || left.lineage.localeCompare(right.lineage))
    .forEach((record) => keep(record.node, "lineage-representative"));
  const currentByLineage = new Map();
  const currentByLineageRole = new Map();
  candidates
    .filter((node) => String(node.selectedRole || "").startsWith("current-frontier"))
    .sort((left, right) => right.score - left.score)
    .forEach((node) => {
      const lineage = node.lineage || node.id;
      const role = node.selectedRole || "current-frontier";
      if (!currentByLineage.has(lineage)) currentByLineage.set(lineage, node);
      const diversityKey = `${lineage}|${role}`;
      if (!currentByLineageRole.has(diversityKey)) currentByLineageRole.set(diversityKey, node);
    });
  const currentCandidates = candidates
    .filter((node) => String(node.selectedRole || "").startsWith("current-frontier"))
    .sort((left, right) => right.score - left.score);
  const diverseCurrent = Array.from(currentByLineage.values())
    .sort((left, right) => right.score - left.score)
    .slice(0, 2);
  diverseCurrent.forEach((node, index) => keep(node, `current-frontier-${index + 1}`));
  Array.from(currentByLineageRole.values())
    .sort((left, right) => right.score - left.score)
    .forEach((node) => keep(node, "current-frontier-role"));
  currentCandidates.forEach((node) => keep(node, "current-frontier-fill"));
  keep(candidates.find((node) => node.selectedRole === "mobility"), "mobility");
  keep(candidates.find((node) => node.selectedRole === "causal-gain"), "causal-gain");
  keep(candidates.slice().sort((left, right) => {
    const hp = number((right.state.hero || {}).hp, 0) - number((left.state.hero || {}).hp, 0);
    return hp || right.score - left.score;
  })[0], "highest-hp");
  candidates
    .slice()
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .forEach((node) => keep(node, "ranked"));
  return selected;
}

function selectDeferredDecompositionNodes(nodes, limit) {
  const max = Math.max(1, number(limit, 3));
  const selected = [];
  const seen = new Set();
  const keep = (node, role) => {
    if (!node || selected.length >= max) return;
    const signature = decompositionNodeSignature(node);
    if (seen.has(signature)) return;
    seen.add(signature);
    selected.push({ ...node, beamRole: role });
  };
  const records = (nodes || []).slice();
  keep(records
    .filter((node) => number(node.resourceTimingScore, 0) > 0)
    .slice()
    .sort((left, right) =>
      number(right.resourceTimingScore, 0) - number(left.resourceTimingScore, 0) ||
      number(right.score, 0) - number(left.score, 0),
    )[0], "deferred-resource-timing");
  keep(records.slice().sort((left, right) =>
    number(right.balanceScore, 0) - number(left.balanceScore, 0) ||
    number(right.score, 0) - number(left.score, 0),
  )[0], "deferred-best-balance");
  keep(records.slice().sort((left, right) =>
    number(right.score, 0) - number(left.score, 0) ||
    number(right.balanceScore, 0) - number(left.balanceScore, 0),
  )[0], "deferred-best-progress");
  keep(records.slice().sort((left, right) =>
    number((right.state.hero || {}).hp, 0) - number((left.state.hero || {}).hp, 0) ||
    number(right.balanceScore, 0) - number(left.balanceScore, 0),
  )[0], "deferred-highest-hp");
  records
    .sort((left, right) => number(right.balanceScore, 0) - number(left.balanceScore, 0))
    .forEach((node) => keep(node, "deferred-fill"));
  return selected;
}

function chainMilestones(milestones, targetSegment) {
  const chained = (milestones || []).map((segment, index) => ({
    ...cloneJson(segment),
    startFrom: index > 0 ? milestones[index - 1].id : null,
  }));
  const final = {
    ...cloneJson(targetSegment),
    startFrom: chained.length > 0 ? chained[chained.length - 1].id : null,
  };
  return chained.concat(final);
}

function tileIdentity(tile) {
  return `${tile.floorId}:${tile.x},${tile.y}`;
}

function propagateFuturePresentTiles(segments) {
  const source = cloneJson(segments || []);
  return source.map((segment, index) => {
    const futureTiles = new Map();
    source.slice(index).forEach((future) => {
      ((future.goal || {}).presentTiles || []).forEach((tile) => {
        futureTiles.set(tileIdentity(tile), tile);
      });
    });
    if (futureTiles.size === 0) return segment;
    const protectedTiles = new Map();
    ((segment.actionPolicy || {}).protectedTiles || []).forEach((tile) => {
      protectedTiles.set(tileIdentity(tile), tile);
    });
    futureTiles.forEach((tile, key) => protectedTiles.set(key, tile));
    segment.goal = segment.goal || {};
    segment.goal.presentTiles = Array.from(futureTiles.values());
    segment.actionPolicy = {
      ...(segment.actionPolicy || {}),
      protectedTiles: Array.from(protectedTiles.values()),
    };
    return segment;
  });
}

function refineMilestoneHpFloors(milestones) {
  return (milestones || []).map((segment) => {
    const refined = cloneJson(segment);
    const selectedStateHp = number(
      ((refined.generatedBy || {}).selectedStateHp),
      0,
    );
    if (!refined.generated || selectedStateHp <= 0) return refined;
    refined.goal = refined.goal || {};
    refined.goal.minHero = refined.goal.minHero || {};
    refined.goal.minHero.hp = Math.max(
      number(refined.goal.minHero.hp, 0),
      selectedStateHp,
    );
    refined.generatedBy = {
      ...(refined.generatedBy || {}),
      validationRefinement: "hp-counterexample",
    };
    return refined;
  });
}

function validateGeneratedSpec(simulator, initialState, milestones, targetSegment, options) {
  const config = options || {};
  const validationTotalRuntimeMs = Math.max(
    1,
    number(config.validationMaxRuntimeMs, 30000),
  );
  const validationSegmentRuntimeMs = validationTotalRuntimeMs;
  const spec = {
    routeName: config.routeName || "auto-decomposed-route",
    generated: true,
    schema: "motapathfinder.generated-milestone-spec.v1",
    milestones: propagateFuturePresentTiles(
      chainMilestones(milestones, targetSegment),
    ).map((segment) => ({
      ...segment,
      dp: {
        ...(segment.dp || {}),
        ...(segment.generated && config.validationStopOnFirstGoal === true
          ? { stopOnFirstGoal: true }
          : {}),
        maxRuntimeMs: Math.min(
          number((segment.dp || {}).maxRuntimeMs, validationSegmentRuntimeMs),
          validationSegmentRuntimeMs,
        ),
      },
    })),
  };
  const result = runMilestoneGraph(simulator, initialState, spec, {
    candidateLimit: number(config.candidateLimit, 4),
    preserveSkylineRoles: true,
    dpSkylineMax: 4,
    goalSkylineLimit: 4,
    enableFailureBacktracking: false,
    backtrackCandidateLimit: 8,
    backtrackMaxExpansions: number(config.validationMaxExpansions, 10000),
    backtrackMaxRuntimeMs: validationSegmentRuntimeMs,
    deadlineMs: Date.now() + validationTotalRuntimeMs,
    maxHeapMb: number(config.maxHeapMb, 1024),
  });
  return { spec, result };
}

function minimizeMilestones(simulator, initialState, milestones, targetSegment, options) {
  const config = options || {};
  const validate = config.validateGeneratedSpecFn || validateGeneratedSpec;
  let current = (milestones || []).slice();
  const attempts = [];
  if (config.enabled === false || current.length < 2) return { milestones: current, attempts };
  for (let index = current.length - 1; index >= 0; index -= 1) {
    if (config.ledger && !config.ledger.canContinue()) break;
    const candidate = current.slice(0, index).concat(current.slice(index + 1));
    const validation = validate(simulator, initialState, candidate, targetSegment, {
      ...config,
      routeName: `${config.routeName || "auto-decomposed-route"}-minimize-${index}`,
      validationMaxExpansions: number(config.minimizeMaxExpansions, DEFAULT_TIERS.normal.maxExpansions),
      validationMaxRuntimeMs: Math.min(
        number(config.minimizeMaxRuntimeMs, DEFAULT_TIERS.normal.maxRuntimeMs),
        config.ledger ? config.ledger.remainingRuntimeMs() : Number.MAX_SAFE_INTEGER,
      ),
    });
    attempts.push({
      removedSegmentId: current[index].id,
      found: validation.result.found,
      failedSegmentId: validation.result.failedSegment && validation.result.failedSegment.segmentId,
    });
    if (validation.result.found) current = candidate;
  }
  return { milestones: current, attempts };
}

function strictGoalValidation(project, simulator, state, targetSegment) {
  const predicate = buildSegmentGoalPredicate(project, targetSegment, simulator);
  try {
    return predicate(state)
      ? { passed: true, failures: [] }
      : { passed: false, failures: ["final-goal-predicate-failed"] };
  } catch (error) {
    return { passed: false, failures: [error.message] };
  }
}

function strictCandidateRouteValidation(simulator, initialState, candidate, targetSegment) {
  const route = Array.isArray(candidate && candidate.route)
    ? candidate.route
    : Array.isArray(candidate && candidate.state && candidate.state.route)
      ? candidate.state.route
      : [];
  const prefixLength = Array.isArray(initialState && initialState.route)
    ? initialState.route.length
    : 0;
  if (route.length < prefixLength) {
    return {
      passed: false,
      failures: ["candidate-route-shorter-than-prefix"],
      replayFailure: { routeLength: route.length, prefixLength },
      state: null,
    };
  }
  let state = cloneState(initialState);
  const suffix = route.slice(prefixLength);
  for (const [offset, entry] of suffix.entries()) {
    const summary = routeEntrySummary(entry);
    if (String(summary || "").startsWith("auto:")) {
      const explicitSummary = String(summary).slice("auto:".length);
      const explicitAction = findActionBySummary(
        simulator,
        state,
        explicitSummary,
      ) || findPickupActionByTarget(simulator, state, explicitSummary);
      if (explicitAction) state = simulator.applyAction(state, explicitAction);
      continue;
    }
    const action = findActionByRouteEntry(simulator, state, entry);
    if (!action) {
      return {
        passed: false,
        failures: ["candidate-route-action-unavailable"],
        replayFailure: {
          routeIndex: prefixLength + offset,
          suffixIndex: offset,
          summary,
          floorId: state.floorId,
          hero: summarizeHero(state),
        },
        state,
      };
    }
    state = simulator.applyAction(state, action);
  }
  if (Array.isArray(state.route)) {
    state.route = state.route.filter(
      (entry) => !String(routeEntrySummary(entry) || "").startsWith("auto:"),
    );
  }
  const goalValidation = strictGoalValidation(
    simulator.project,
    simulator,
    state,
    targetSegment,
  );
  return {
    ...goalValidation,
    replayFailure: null,
    state,
  };
}

function classifyStop(result, ledger) {
  if (ledger && ledger.stoppedReason) return ledger.stoppedReason;
  const dp = result && result.diagnostics && result.diagnostics.dp;
  const failure = result && result.diagnostics && result.diagnostics.failure;
  if (dp && number(dp.actionTrimmed, 0) > 0) return "action-scope-incomplete";
  if (failure && failure.failureClass === "present-tile-overconstrained") return "model-overconstrained";
  if (dp && dp.completeWithinActionSet === true && number(dp.frontierSize, 0) === 0) {
    return "complete-action-space-exhausted";
  }
  if (shouldEscalate(result)) return "budget-exhausted-with-live-frontier";
  return (failure && failure.failureClass) || "no-progress-landmark";
}

function runMilestoneDecomposer(simulator, initialState, targetSegment, options) {
  const config = options || {};
  const ledger = config.ledger || new BudgetLedger({
    maxRuntimeMs: config.globalRuntimeMs,
    maxHeapMb: config.globalMaxHeapMb,
    maxNodes: config.maxNodes,
  });
  const cache = config.cache || new SegmentSearchCache({
    directory: config.cacheDirectory,
    enabled: config.cacheEnabled !== false,
    projectSignature: projectSignature(simulator.project),
  });
  const target = normalizeTargetSegment(simulator.project, initialState, targetSegment, config);
  const maxDepth = Math.max(1, number(config.maxDepth, 24));
  const branchWidth = Math.max(1, number(config.branchWidth, 3));
  const maxLandmarks = Math.max(1, number(config.maxLandmarks, 24));
  const probeLandmarks = Math.max(1, number(config.probeLandmarks, 6));
  const targetActionProvider = buildSegmentActionProvider(simulator, target);
  const queue = [{
    id: "decompose-root",
    state: cloneState(initialState),
    milestones: [],
    depth: 0,
    score: goalProgressScore(simulator.project, initialState, target.goal),
    parentId: null,
    lineage: "root",
    balanceScore: targetBalanceScore(initialState, target.goal),
    resourceCost: 0,
    consumedHpResourceKeys: [],
    nearTarget: targetBalanceRatio(initialState, target.goal) >= 0.45,
    combatRole: summarizeEffectiveHero(initialState),
    optionalityScore: countProgressOptions(simulator, initialState, targetActionProvider),
  }];
  const visitedBestHp = new Map();
  const progressBestHp = new Map();
  const decompositionNodes = [];
  const landmarkCandidates = [];
  const twoSidedProbes = [];
  const backtrackedBranches = [];
  const deferredBeamNodes = [];
  let selected = null;
  let lastSearch = null;

  while ((queue.length > 0 || deferredBeamNodes.length > 0) && ledger.beginNode()) {
    if (queue.length === 0) {
      const resumed = selectDeferredDecompositionNodes(deferredBeamNodes, branchWidth);
      const resumedIds = new Set(resumed.map((candidate) => candidate.id));
      for (let index = deferredBeamNodes.length - 1; index >= 0; index -= 1) {
        if (resumedIds.has(deferredBeamNodes[index].id)) deferredBeamNodes.splice(index, 1);
      }
      resumed.forEach((candidate) => {
        queue.push(candidate);
        backtrackedBranches.push({ nodeId: candidate.id, reason: "decomposition-beam-resumed" });
      });
    }
    queue.sort((left, right) => left.depth - right.depth || right.score - left.score || left.id.localeCompare(right.id));
    const node = queue.shift();
    const signature = decompositionNodeSignature(node);
    const progressSignature = buildDominanceKey(node.state);
    const nodeHp = number((node.state.hero || {}).hp, 0);
    if (
      number(visitedBestHp.get(signature), -1) >= nodeHp ||
      number(progressBestHp.get(progressSignature), -1) >= nodeHp
    ) {
      backtrackedBranches.push({
        nodeId: node.id,
        reason: "dominated-decomposition-state",
        hp: nodeHp,
      });
      continue;
    }
    visitedBestHp.set(signature, nodeHp);
    progressBestHp.set(progressSignature, nodeHp);
    const nodeRecord = {
      id: node.id,
      parentId: node.parentId,
      depth: node.depth,
      score: node.score,
      balanceScore: node.balanceScore,
      resourceCost: node.resourceCost,
      consumedHpResourceKeys: cloneJson(node.consumedHpResourceKeys || []),
      nearTarget: node.nearTarget,
      optionalityScore: node.optionalityScore,
      resourceTimingScore: number(node.resourceTimingScore, 0),
      resourceTiming: cloneJson(getTiming(node.state)),
      selectedRole: node.selectedRole || null,
      beamRole: node.beamRole || null,
      lineage: node.lineage,
      state: compactState(node.state),
      milestoneIds: node.milestones.map((segment) => segment.id),
    };
    decompositionNodes.push(nodeRecord);

    // The root scout builds the initial landmark archive. Later nodes already
    // carry a verified action trace, so a quick target probe is sufficient
    // until the generated milestone chain is validated as a whole.
    const tiersToRun = node.depth === 0 || node.depth % 4 === 0 || targetBalanceRatio(node.state, target.goal) >= 0.45
      ? ["probe", "normal"]
      : ["probe"];
    let direct = runTieredSearch(simulator, node.state, target, {
      ...config,
      ledger,
      cache,
      nodeId: node.id,
      kind: "direct-target",
      tiersToRun,
      maxHeapMb: ledger.maxHeapMb,
    });
    lastSearch = direct;
    if (!direct) break;
    nodeRecord.direct = {
      found: direct.found,
      best: compactState(bestProgressState(direct)),
      diagnostics: cloneJson((direct.diagnostics || {}).dp || {}),
    };
    if (direct.found && direct.goalSkyline && direct.goalSkyline.length > 0) {
      selected = {
        node,
        finalSearch: direct,
        candidate: direct.goalSkyline[0],
      };
      break;
    }
    if (node.depth >= maxDepth) {
      backtrackedBranches.push({ nodeId: node.id, reason: "decomposition-depth-limit" });
      continue;
    }
    let scoutState = bestProgressState(direct);
    if (!scoutState) {
      backtrackedBranches.push({ nodeId: node.id, reason: classifyStop(direct, ledger) });
      continue;
    }
    let candidates = collectLandmarkCandidates(
      simulator,
      node.state,
      direct,
      target,
      maxLandmarks,
    ).filter((candidate) => !node.milestones.some((segment) => landmarkSignature(segment.goal) === candidate.signature));
    if (candidates.length === 0 && shouldEscalate(direct) && !tiersToRun.includes("normal")) {
      const recovery = runTieredSearch(simulator, node.state, target, {
        ...config,
        ledger,
        cache,
        nodeId: node.id,
        kind: "direct-target-recovery",
        tiersToRun: ["normal", "escalated"],
        maxHeapMb: ledger.maxHeapMb,
      });
      if (recovery) {
        direct = recovery;
        lastSearch = recovery;
        nodeRecord.direct = {
          found: recovery.found,
          best: compactState(bestProgressState(recovery)),
          diagnostics: cloneJson((recovery.diagnostics || {}).dp || {}),
          recovered: true,
        };
        if (recovery.found && recovery.goalSkyline && recovery.goalSkyline.length > 0) {
          selected = {
            node,
            finalSearch: recovery,
            candidate: recovery.goalSkyline[0],
          };
          break;
        }
        scoutState = bestProgressState(recovery);
        candidates = collectLandmarkCandidates(
          simulator,
          node.state,
          recovery,
          target,
          maxLandmarks,
        ).filter((candidate) => !node.milestones.some((segment) => landmarkSignature(segment.goal) === candidate.signature));
      }
    }
    const statPreparationCandidate = candidates.some((candidate) =>
      number((candidate.delta || {}).atk, 0) > 0 ||
      number((candidate.delta || {}).def, 0) > 0 ||
      number((candidate.delta || {}).mdef, 0) > 0 ||
      number((candidate.delta || {}).lv, 0) > 0 ||
      ((candidate.delta || {}).equipmentAdded || []).length > 0,
    );
    const resourceRecords = new Map();
    if (statPreparationCandidate) {
      candidates.forEach((candidate) => {
        const records = (candidate.consumedHpResourceRecords || []).concat(
          isDeferredHpResourceDelta(candidate.delta)
            ? [{
                summary: candidate.summary,
                hpGain: number((candidate.delta || {}).hp, 0),
                decisionIndex: candidate.decisionIndex,
              }]
            : [],
        );
        records.forEach((record) => {
          if (!record || !record.summary) return;
          const existing = resourceRecords.get(record.summary);
          if (!existing || number(record.hpGain, 0) > number(existing.hpGain, 0)) {
            resourceRecords.set(record.summary, record);
          }
        });
      });
    }
    const deferredResources = Array.from(resourceRecords.values())
      .sort((left, right) =>
        number(right.hpGain, 0) - number(left.hpGain, 0) ||
        number(right.decisionIndex, 0) - number(left.decisionIndex, 0) ||
        left.summary.localeCompare(right.summary),
      )
      .slice(0, Math.max(1, number(config.counterfactualResourceLimit, 2)));
    const resourceDeferralEnabled =
      config.resourceTimingModel === "breakpoint-v2" ||
      config.resourceDeferralEnabled === true;
    const resourceDeferralSummaries = new Set();
    if (resourceDeferralEnabled && statPreparationCandidate && ledger.canContinue()) {
      const discoveredResources = discoverBattleResourceTargets(
        simulator,
        node.state,
        target,
        {
          allowedFloors: (target.actionPolicy || {}).allowedFloors,
          limit: Math.max(1, number(config.resourceDeferralLimit, 2) * 4),
        },
      )
        .filter((resource) => number(resource.baselineDamage, 0) >= number(config.resourceDeferralMinSaving, 5000))
        .slice(0, Math.max(1, number(config.resourceDeferralLimit, 2)));
      for (const resource of discoveredResources) {
        if (!ledger.canContinue()) break;
        resourceDeferralSummaries.add(resource.summary);
        const proof = findResourceDeferralProof(simulator, node.state, resource, {
          model: "breakpoint-v2",
          minDamageSaving: number(config.resourceDeferralMinSaving, 5000),
          maxExpansions: number(config.resourceDeferralMaxExpansions, 600),
          maxRuntimeMs: Math.min(
            number(config.resourceDeferralMaxRuntimeMs, 5000),
            Math.max(1, ledger.remainingRuntimeMs()),
          ),
          goalSkylineLimit: 4,
          dpSkylineMax: 4,
          landmarkArchiveLimit: 24,
          allowedFloors: (target.actionPolicy || {}).allowedFloors,
          captureTrace: config.captureTrace === true,
        });
        if (!proof.found || !(proof.proofs || [])[0]) {
          backtrackedBranches.push({
            nodeId: node.id,
            reason: "resource-deferral-proof-failed",
            summary: resource.summary,
            diagnostics: cloneJson(proof.diagnostics || null),
            stoppedReason: proof.stoppedReason,
          });
          continue;
        }
        const bestProof = proof.proofs[0];
        const proofDelta = stateDelta(node.state, bestProof.state);
        const deferralGoal = cloneJson(proof.segment.goal);
        const deferralCandidate = {
          id: `resource-deferral-${node.id}-${resource.summary}`,
          decisionIndex: -1,
          summary: resource.summary,
          goal: deferralGoal,
          signature: landmarkSignature(deferralGoal),
          state: cloneState(bestProof.state),
          causalScore:
            Math.max(0, number(proofDelta.atk, 0)) * 10000 +
            Math.max(0, number(proofDelta.def, 0)) * 12000 +
            Math.max(0, number(proofDelta.mdef, 0)) * 1000 +
            Math.max(0, number(proofDelta.hp, 0)),
          delta: proofDelta,
          sourceRole: "counterfactual-resource-deferral",
          protectedResource: cloneJson(resource.resourceTile),
          protectedResourceGain: 0,
          resourceDeferral: true,
          resourceDeferralProof: {
            model: proof.model,
            resource: cloneJson(proof.resource),
            baseline: cloneJson(proof.baseline),
            selected: {
              damage: bestProof.deferredDamage,
              damageSaving: bestProof.damageSaving,
              hp: bestProof.hp,
              hero: cloneJson(bestProof.hero),
              effectiveHero: cloneJson(bestProof.effectiveHero),
              routeLength: bestProof.routeLength,
              proofActions: cloneJson(bestProof.proofActions),
            },
            candidateCount: proof.proofs.length,
            diagnostics: cloneJson(proof.diagnostics || null),
          },
          consumedHpResources: 0,
          consumedHpResourceKeys: [],
          consumedHpResourceRecords: [],
        };
        candidates.push(deferralCandidate);
      }
    }
    for (const [resourceIndex, deferredResource] of deferredResources.entries()) {
      if (!ledger.canContinue()) break;
      if (resourceDeferralSummaries.has(deferredResource.summary)) continue;
      const deferredTarget = parseActionTarget(deferredResource.summary);
      if (
        !deferredTarget ||
        !["battle", "pickup", "openDoor", "event"].includes(deferredTarget.kind) ||
        tileRemoved(simulator.project, node.state, deferredTarget)
      ) continue;
      const protectedTile = {
        floorId: deferredTarget.floorId,
        x: deferredTarget.x,
        y: deferredTarget.y,
      };
      const alternativeResourceTiles = deferredResources
        .filter((record) => record.summary !== deferredResource.summary)
        .map((record) => parseActionTarget(record.summary))
        .filter((record) =>
          record &&
          ["battle", "pickup", "openDoor", "event"].includes(record.kind) &&
          !tileRemoved(simulator.project, node.state, record),
        )
        .map((record) => ({ floorId: record.floorId, x: record.x, y: record.y }));
      const resourceDependentPrep = candidates
        .filter((candidate) =>
          (candidate.consumedHpResourceKeys || []).includes(deferredResource.summary) &&
          !isDeferredHpResourceDelta(candidate.delta) &&
          (
            number((candidate.delta || {}).atk, 0) > 0 ||
            number((candidate.delta || {}).def, 0) > 0 ||
            number((candidate.delta || {}).mdef, 0) > 0 ||
            number((candidate.delta || {}).lv, 0) > 0 ||
            ((candidate.delta || {}).equipmentAdded || []).length > 0 ||
            ((candidate.goal || {}).removedTiles || []).length > 0
          ),
        )
        .sort((left, right) =>
          targetBalanceRatio(right.state, target.goal) - targetBalanceRatio(left.state, target.goal) ||
          right.causalScore - left.causalScore ||
          left.decisionIndex - right.decisionIndex,
        )[0];
      const protectedTarget = cloneJson(target);
      protectedTarget.id = `${target.id}-protect-${deferredTarget.floorId}-${deferredTarget.x}-${deferredTarget.y}`;
      protectedTarget.goal = alternativeResourceTiles.length > 0
        ? {
            type: "autoCounterfactualResourceOrder",
            anyRemovedTiles: alternativeResourceTiles,
            presentTiles: Array.from(new Map([
              ...((target.goal && target.goal.presentTiles) || []),
              protectedTile,
            ].map((tile) => [`${tile.floorId}:${tile.x},${tile.y}`, tile])).values()),
          }
        : resourceDependentPrep
          ? {
              ...cloneJson(resourceDependentPrep.goal),
              type: "autoCounterfactualPreparation",
              presentTiles: Array.from(new Map([
                ...((target.goal && target.goal.presentTiles) || []),
                protectedTile,
              ].map((tile) => [`${tile.floorId}:${tile.x},${tile.y}`, tile])).values()),
            }
        : {
          ...(protectedTarget.goal || {}),
        presentTiles: Array.from(new Map([
          ...((protectedTarget.goal && protectedTarget.goal.presentTiles) || []),
          protectedTile,
        ].map((tile) => [`${tile.floorId}:${tile.x},${tile.y}`, tile])).values()),
        };
      protectedTarget.actionPolicy = {
        ...(protectedTarget.actionPolicy || {}),
        protectedTiles: Array.from(new Map([
          ...((protectedTarget.actionPolicy && protectedTarget.actionPolicy.protectedTiles) || []),
          protectedTile,
        ].map((tile) => [`${tile.floorId}:${tile.x},${tile.y}`, tile])).values()),
      };
      const protectedSearch = runTieredSearch(simulator, node.state, protectedTarget, {
        ...config,
        ledger,
        cache,
        nodeId: node.id,
        kind: "counterfactual-resource-probe",
        tiersToRun: alternativeResourceTiles.length > 0 || resourceDependentPrep
          ? ["probe", "normal"]
          : resourceIndex === 0 && (
          node.depth === 0 || targetBalanceRatio(node.state, target.goal) >= 0.5
        )
          ? ["probe", "normal", "escalated"]
          : ["probe", "normal"],
        continueAfterFound: alternativeResourceTiles.length > 0 || Boolean(resourceDependentPrep),
        goalSkylineLimit: alternativeResourceTiles.length > 0 || resourceDependentPrep ? 4 : undefined,
        dpSkylineMax: alternativeResourceTiles.length > 0 || resourceDependentPrep ? 4 : undefined,
        maxHeapMb: ledger.maxHeapMb,
      });
      if (protectedSearch) {
        const protectedCandidates = collectLandmarkCandidates(
          simulator,
          node.state,
          protectedSearch,
          target,
          maxLandmarks,
        )
          .filter((candidate) => !tileRemoved(simulator.project, candidate.state, protectedTile))
          .map((candidate) => ({
            ...candidate,
            sourceRole: "counterfactual-protected",
            protectedResource: protectedTile,
            protectedResourceGain: number(deferredResource.hpGain, 0),
            protectedBalanceRatio: targetBalanceRatio(candidate.state, target.goal),
          }));
        const merged = new Map(candidates.map((candidate) => [candidate.signature, candidate]));
        protectedCandidates.forEach((candidate) => {
          const existing = merged.get(candidate.signature);
          const candidateCost = number(candidate.consumedHpResources, 0);
          const existingCost = existing ? number(existing.consumedHpResources, 0) : Number.MAX_SAFE_INTEGER;
          if (!existing || candidateCost < existingCost || (candidateCost === existingCost && candidate.causalScore > existing.causalScore)) {
            merged.set(candidate.signature, candidate);
          }
        });
        candidates = Array.from(merged.values());
      }
    }
    if (candidates.length === 0) {
      backtrackedBranches.push({ nodeId: node.id, reason: "no-progress-landmark" });
      continue;
    }
    const probedCandidates = selectProbeCandidates(candidates, probeLandmarks);
    const statPrepAvailable = probedCandidates.some((candidate) =>
      (
        number((candidate.delta || {}).atk, 0) > 0 ||
        number((candidate.delta || {}).def, 0) > 0 ||
        number((candidate.delta || {}).mdef, 0) > 0 ||
        number((candidate.delta || {}).lv, 0) > 0 ||
        ((candidate.delta || {}).equipmentAdded || []).length > 0
      ),
    );
    for (const candidate of probedCandidates) {
      // Cached search results hydrate full states. Reclaim the previous
      // iteration before the ledger samples memory for the next search.
      collectSearchGarbage(simulator);
      candidate.parentResourceCost = number(node.resourceCost, 0);
      const landmarkSegment = buildLandmarkSegment(
        node.milestones.length + 1,
        candidate.goal,
        target,
        candidate.summary,
      );
      if (candidate.protectedResource) {
        const protectedTile = candidate.protectedResource;
        landmarkSegment.actionPolicy = landmarkSegment.actionPolicy || {};
        landmarkSegment.goal.presentTiles = Array.from(new Map([
          ...((landmarkSegment.goal && landmarkSegment.goal.presentTiles) || []),
          protectedTile,
        ].map((tile) => [`${tile.floorId}:${tile.x},${tile.y}`, tile])).values());
        landmarkSegment.actionPolicy.protectedTiles = Array.from(new Map([
          ...((landmarkSegment.actionPolicy && landmarkSegment.actionPolicy.protectedTiles) || []),
          protectedTile,
        ].map((tile) => [`${tile.floorId}:${tile.x},${tile.y}`, tile])).values());
      }
      const checkpointSearch = runTieredSearch(simulator, node.state, landmarkSegment, {
        ...config,
        ledger,
        cache,
        nodeId: node.id,
        kind: "start-to-checkpoint",
        tiersToRun: ["probe"],
        continueAfterFound: true,
        goalSkylineLimit: 4,
        dpSkylineMax: 4,
        maxHeapMb: ledger.maxHeapMb,
      });
      const checkpointCandidates = ((checkpointSearch && checkpointSearch.goalSkyline) || [])
        .filter((record) =>
          record &&
          record.state &&
          (!candidate.protectedResource || !tileRemoved(
            simulator.project,
            record.state,
            candidate.protectedResource,
          )),
        )
        .sort((left, right) =>
          number((right.state.hero || {}).hp, 0) - number((left.state.hero || {}).hp, 0) ||
          targetBalanceScore(right.state, target.goal) - targetBalanceScore(left.state, target.goal),
        );
      const checkpointResourceRecords = checkpointCandidates.length > 0
        ? traceHpResourceRecords(simulator, node.state, checkpointCandidates[0].state)
        : [];
      if (
        checkpointCandidates.length > 0 &&
        shouldReplaceCheckpointState(
          candidate.state,
          checkpointCandidates[0].state,
          target.goal,
          candidate.consumedHpResources,
          checkpointResourceRecords.length,
        )
      ) {
        candidate.state = cloneState(checkpointCandidates[0].state);
        candidate.delta = stateDelta(node.state, candidate.state);
        candidate.consumedHpResourceRecords = checkpointResourceRecords;
        candidate.consumedHpResourceKeys = candidate.consumedHpResourceRecords
          .map((record) => record.summary)
          .sort();
        candidate.consumedHpResources = candidate.consumedHpResourceKeys.length;
      }
      candidate.segment = landmarkSegment;
      const probe = runTieredSearch(simulator, candidate.state, target, {
        ...config,
        ledger,
        cache,
        nodeId: node.id,
        kind: "downstream-probe",
        tiersToRun: ["quick"],
        maxHeapMb: ledger.maxHeapMb,
      });
      const downstream = bestProgressState(probe) || candidate.state;
      candidate.downstreamScore = goalProgressScore(simulator.project, downstream, target.goal);
      candidate.balanceRatio = targetBalanceRatio(candidate.state, target.goal);
      candidate.deferredResource = Boolean(
        statPrepAvailable &&
        (
          number(candidate.consumedHpResources, 0) > 0 ||
          (
            number((candidate.delta || {}).hp, 0) > 0 &&
            number((candidate.delta || {}).atk, 0) <= 0 &&
            number((candidate.delta || {}).def, 0) <= 0 &&
            number((candidate.delta || {}).mdef, 0) <= 0 &&
            number((candidate.delta || {}).lv, 0) <= 0
          )
        )
      );
      candidate.nonProgressBattle = Boolean(
        statPrepAvailable &&
        String(candidate.summary || "").startsWith("battle:") &&
        candidate.combatStateTransition !== true &&
        number((candidate.delta || {}).hp, 0) <= 0 &&
        number((candidate.delta || {}).atk, 0) <= 0 &&
        number((candidate.delta || {}).def, 0) <= 0 &&
        number((candidate.delta || {}).mdef, 0) <= 0 &&
        number((candidate.delta || {}).lv, 0) <= 0
      );
      candidate.timingPenalty = candidate.deferredResource || candidate.nonProgressBattle
        ? DEFERRED_RESOURCE_PENALTY
        : 0;
      candidate.resourceTiming = getTiming(candidate.state);
      candidate.resourceTimingScore = candidate.resourceTiming
        ? resourceTimingScore(candidate.resourceTiming)
        : 0;
      candidate.preparationEfficiency = (candidate.delta || {}).floorChanged
        ? 0
        : candidate.causalScore / (1 + Math.max(0, -number((candidate.delta || {}).hp, 0)));
      candidate.branchScore =
        candidate.downstreamScore * 1000 +
        candidate.preparationEfficiency * 100000000 +
        candidate.causalScore -
        candidate.decisionIndex * 100 +
        candidate.resourceTimingScore * 1000 +
        (candidate.resourceDeferral ? 500000000000 : 0) +
        (candidate.sourceRole === "mobility" ? 500000000000 : 0) -
        candidate.timingPenalty;
      candidate.downstreamFound = Boolean(probe && probe.found);
      const record = {
        nodeId: node.id,
        candidateId: candidate.id,
        summary: candidate.summary,
        goal: cloneJson(candidate.goal),
        decisionIndex: candidate.decisionIndex,
        causalScore: candidate.causalScore,
        sourceRole: candidate.sourceRole,
        resourceDeferral: candidate.resourceDeferral === true,
        resourceDeferralProof: cloneJson(candidate.resourceDeferralProof || null),
        protectedResource: cloneJson(candidate.protectedResource || null),
        protectedResourceGain: number(candidate.protectedResourceGain, 0),
        protectedBalanceRatio: number(candidate.protectedBalanceRatio, 0),
        downstreamScore: candidate.downstreamScore,
        balanceRatio: candidate.balanceRatio,
        branchScore: candidate.branchScore,
        deferredResource: candidate.deferredResource,
        nonProgressBattle: candidate.nonProgressBattle,
        combatStateTransition: candidate.combatStateTransition === true,
        timingPenalty: candidate.timingPenalty,
        resourceTimingScore: candidate.resourceTimingScore,
        resourceTiming: cloneJson(candidate.resourceTiming),
        preparationEfficiency: candidate.preparationEfficiency,
        consumedHpResources: number(candidate.consumedHpResources, 0),
        consumedHpResourceKeys: cloneJson(candidate.consumedHpResourceKeys || []),
        downstreamFound: candidate.downstreamFound,
        state: compactState(candidate.state),
      };
      landmarkCandidates.push(record);
      twoSidedProbes.push({
        nodeId: node.id,
        candidateId: candidate.id,
        startToCheckpoint: {
          found: Boolean(checkpointSearch && checkpointSearch.found),
          source: checkpointCandidates.length > 0
            ? "segment-dp-skyline"
            : candidate.sourceRole === "current-frontier"
              ? "current-frontier-action"
              : "verified-scout-trace",
          best: compactState(candidate.state),
          diagnostics: cloneJson(
            (checkpointSearch && checkpointSearch.diagnostics && checkpointSearch.diagnostics.dp) || {},
          ),
        },
        checkpointToTarget: {
          found: candidate.downstreamFound,
          best: compactState(downstream),
          diagnostics: cloneJson((probe && probe.diagnostics && probe.diagnostics.dp) || {}),
        },
      });
    }
    const selectedCandidates = selectBranchCandidates(
      probedCandidates,
      Math.max(branchWidth, probeLandmarks),
    );
    collectSearchGarbage(simulator);
    const preMobilityPreparationId = findPreMobilityPreparationId(
      selectedCandidates,
      candidates,
      target.goal && target.goal.floorId,
    );
    for (const [branchIndex, candidate] of selectedCandidates.entries()) {
      collectSearchGarbage(simulator);
      const segment = candidate.segment || buildLandmarkSegment(node.milestones.length + 1, candidate.goal, target, candidate.summary);
      const selectedOptimizationTiers =
        number(node.resourceCost, 0) === 0 &&
        number(candidate.consumedHpResources, 0) === 0 &&
        (["combat-state-transition", "mobility"].includes(candidate.selectedRole) ||
          candidate.id === preMobilityPreparationId)
          ? ["normal", "escalated"]
          : ["normal"];
      const selectedCheckpointSearch = runTieredSearch(simulator, node.state, segment, {
        ...config,
        ledger,
        cache,
        nodeId: node.id,
        kind: "selected-checkpoint-optimization",
        tiersToRun: selectedOptimizationTiers,
        continueAfterFound: true,
        goalSkylineLimit: 4,
        dpSkylineMax: 4,
        maxHeapMb: ledger.maxHeapMb,
      });
      const selectedCheckpointCandidates = (
        (selectedCheckpointSearch && selectedCheckpointSearch.goalSkyline) || []
      )
        .filter((record) =>
          record &&
          record.state &&
          (!candidate.protectedResource || !tileRemoved(
            simulator.project,
            record.state,
            candidate.protectedResource,
          )),
        )
        .sort((left, right) =>
          number((right.state.hero || {}).hp, 0) - number((left.state.hero || {}).hp, 0) ||
          targetBalanceScore(right.state, target.goal) - targetBalanceScore(left.state, target.goal),
        );
      const selectedCheckpointResourceRecords = selectedCheckpointCandidates.length > 0
        ? traceHpResourceRecords(
            simulator,
            node.state,
            selectedCheckpointCandidates[0].state,
          )
        : [];
      if (
        selectedCheckpointCandidates.length > 0 &&
        shouldReplaceCheckpointState(
          candidate.state,
          selectedCheckpointCandidates[0].state,
          target.goal,
          candidate.consumedHpResources,
          selectedCheckpointResourceRecords.length,
        )
      ) {
        candidate.state = cloneState(selectedCheckpointCandidates[0].state);
        candidate.delta = stateDelta(node.state, candidate.state);
        candidate.consumedHpResourceRecords = selectedCheckpointResourceRecords;
        candidate.consumedHpResourceKeys = candidate.consumedHpResourceRecords
          .map((record) => record.summary)
          .sort();
        candidate.consumedHpResources = candidate.consumedHpResourceKeys.length;
      }
      const probeRecord = twoSidedProbes.find(
        (record) => record.nodeId === node.id && record.candidateId === candidate.id,
      );
      if (probeRecord) {
        probeRecord.selectedOptimization = {
          found: Boolean(selectedCheckpointSearch && selectedCheckpointSearch.found),
          best: compactState(candidate.state),
          diagnostics: cloneJson(
            (selectedCheckpointSearch && selectedCheckpointSearch.diagnostics && selectedCheckpointSearch.diagnostics.dp) || {},
          ),
        };
      }
      const childResourceKeys = Array.from(new Set([
        ...(node.consumedHpResourceKeys || []),
        ...(candidate.consumedHpResourceKeys || []),
      ])).sort();
      const childSegment = cloneJson(segment);
      childSegment.generatedBy = {
        ...(childSegment.generatedBy || {}),
        selectedStateHp: number((candidate.state.hero || {}).hp, 0),
      };
      const child = {
        id: `${node.id}.${branchIndex + 1}`,
        parentId: node.id,
        state: cloneState(candidate.state),
        milestones: node.milestones.concat(childSegment),
        depth: node.depth + 1,
        score: candidate.branchScore,
        balanceScore: targetBalanceScore(candidate.state, target.goal),
        resourceTimingScore: number(candidate.resourceTimingScore, 0),
        resourceCost: childResourceKeys.length,
        consumedHpResourceKeys: childResourceKeys,
        nearTarget: targetBalanceRatio(candidate.state, target.goal) >= 0.45,
        combatRole: summarizeEffectiveHero(candidate.state),
        optionalityScore: countProgressOptions(simulator, candidate.state, targetActionProvider),
        selectedRole: candidate.selectedRole,
        beamGroup: node.lineage || node.id,
      };
      child.lineage = startsNewCausalPhase(node, candidate) ? child.id : node.lineage;
      const childSignature = decompositionNodeSignature(child);
      const childProgressSignature = buildDominanceKey(child.state);
      const childHp = number((child.state.hero || {}).hp, 0);
      if (
        number(visitedBestHp.get(childSignature), -1) >= childHp ||
        number(progressBestHp.get(childProgressSignature), -1) >= childHp
      ) {
        backtrackedBranches.push({
          nodeId: child.id,
          reason: "dominated-decomposition-state",
          hp: childHp,
        });
        continue;
      }
      queue.push(child);
    }
    const childDepth = node.depth + 1;
    const sameDepth = queue.filter((candidate) => candidate.depth === childDepth);
    if (sameDepth.length > branchWidth) {
      const kept = selectNextDecompositionNodes(sameDepth, branchWidth);
      const keptIds = new Set(kept.map((candidate) => candidate.id));
      sameDepth.forEach((candidate) => {
        if (!keptIds.has(candidate.id)) {
          deferredBeamNodes.push(candidate);
          backtrackedBranches.push({
            nodeId: candidate.id,
            reason: "decomposition-beam-deferred",
            resourceCost: candidate.resourceCost,
            nearTarget: candidate.nearTarget,
            selectedRole: candidate.selectedRole || null,
            state: compactState(candidate.state),
          });
        }
      });
      const otherDepths = queue.filter((candidate) => candidate.depth !== childDepth);
      queue.length = 0;
      queue.push(...otherDepths, ...kept);
    }
    collectSearchGarbage(simulator);
  }

  let validation = null;
  let minimized = { milestones: selected ? selected.node.milestones : [], attempts: [] };
  if (selected) {
    let validationMilestones = selected.node.milestones;
    validation = validateGeneratedSpec(
      simulator,
      initialState,
      validationMilestones,
      target,
      {
        ...config,
        routeName: config.routeName,
        validationMaxExpansions: DEFAULT_TIERS.escalated.maxExpansions,
        validationMaxRuntimeMs: Math.max(1, Math.min(
          number(config.validationProbeRuntimeMs, 5000),
          ledger.remainingRuntimeMs() - 1000,
        )),
      },
    );
    collectSearchGarbage(simulator);
    if (
      !validation.result.found &&
      ledger.canContinue() &&
      ledger.remainingRuntimeMs() > 1000
    ) {
      validationMilestones = refineMilestoneHpFloors(validationMilestones);
      minimized = { milestones: validationMilestones, attempts: [] };
      validation = validateGeneratedSpec(
        simulator,
        initialState,
        validationMilestones,
        target,
        {
          ...config,
          routeName: config.routeName,
          validationMaxExpansions: DEFAULT_TIERS.escalated.maxExpansions,
          validationMaxRuntimeMs: Math.max(1, ledger.remainingRuntimeMs() - 1000),
          validationStopOnFirstGoal: true,
        },
      );
      collectSearchGarbage(simulator);
    }
    if (validation.result.found && config.minimize !== false) {
      minimized = minimizeMilestones(simulator, initialState, validationMilestones, target, {
        ...config,
        ledger,
        routeName: config.routeName,
      });
      if (minimized.milestones.length !== validationMilestones.length) {
        validation = validateGeneratedSpec(simulator, initialState, minimized.milestones, target, {
          ...config,
          routeName: config.routeName,
          validationMaxExpansions: DEFAULT_TIERS.escalated.maxExpansions,
          validationMaxRuntimeMs: Math.max(1, ledger.remainingRuntimeMs() - 1000),
        });
      }
    }
  }
  const finalCandidate = validation && validation.result.found
    ? validation.result.finalCandidate
    : selected && selected.candidate;
  const strictRouteResult = finalCandidate && finalCandidate.state
    ? strictCandidateRouteValidation(simulator, initialState, finalCandidate, target)
    : { passed: false, failures: ["missing-final-candidate"] };
  if (strictRouteResult.passed && strictRouteResult.state) {
    finalCandidate.state = strictRouteResult.state;
    finalCandidate.route = Array.isArray(strictRouteResult.state.route)
      ? strictRouteResult.state.route.slice()
      : [];
  }
  const strictReplay = {
    passed: strictRouteResult.passed,
    failures: strictRouteResult.failures || [],
    replayFailure: strictRouteResult.replayFailure || null,
  };
  const generatedProfileVerified = Boolean(
    selected &&
    validation &&
    validation.result.found &&
    finalCandidate &&
    strictReplay.passed,
  );
  const found = Boolean(selected && finalCandidate && strictReplay.passed);
  const stoppedReason = generatedProfileVerified
    ? "goal-reached-and-validated"
    : found
      ? "route-found-profile-validation-failed"
    : validation && !validation.result.found
      ? "generated-profile-validation-failed"
      : classifyStop(lastSearch, ledger);
  const effectiveSpec = validation
    ? validation.spec
    : {
        routeName: config.routeName || "auto-decomposed-route",
        generated: true,
        schema: "motapathfinder.generated-milestone-spec.v1",
        milestones: chainMilestones(minimized.milestones, target),
      };
  return {
    schema: REPORT_SCHEMA,
    found,
    generatedProfileVerified,
    finalCandidate: found ? finalCandidate : null,
    finalCandidates: generatedProfileVerified
      ? validation.result.finalCandidates
      : found
        ? [finalCandidate]
        : [],
    reachedMilestone: found ? target.id : null,
    failedSegment: found ? null : validation && validation.result.failedSegment,
    profileValidationFailure: !generatedProfileVerified && validation
      ? validation.result.failedSegment
      : null,
    segmentResults: validation ? validation.result.segmentResults : [],
    effectiveSpec,
    decomposition: {
      budgetLedger: ledger.summary(),
      decompositionNodes,
      landmarkCandidates,
      twoSidedProbes,
      selectedBranch: selected ? selected.node.id : null,
      backtrackedBranches,
      generatedMilestonesBeforeMinimize: selected ? selected.node.milestones.map((segment) => segment.id) : [],
      generatedMilestonesAfterMinimize: minimized.milestones.map((segment) => segment.id),
      minimizationAttempts: minimized.attempts,
      cacheStats: cloneJson(cache.stats),
      peakHeapMb: ledger.summary().peakHeapMb,
      peakRssMb: ledger.summary().peakRssMb,
      strictReplay,
      replayFailure: strictReplay.replayFailure || null,
      finalGoalFailures: strictReplay.failures,
      stoppedReason,
    },
  };
}

module.exports = {
  BudgetLedger,
  CACHE_SCHEMA,
  REPORT_SCHEMA,
  SegmentSearchCache,
  buildLandmarkGoal,
  collectLandmarkCandidates,
  inferAllowedFloors,
  isCombatStateTransition,
  isMeaningfulLandmark,
  inferChangeFloorKeys,
  isDeferredHpResourceDelta,
  landmarkSignature,
  minimizeMilestones,
  normalizeTargetSegment,
  projectSignature,
  propagateFuturePresentTiles,
  refineMilestoneHpFloors,
  replayScoutDecisions,
  runMilestoneDecomposer,
  selectBranchCandidates,
  selectNextDecompositionNodes,
  selectDeferredDecompositionNodes,
  findPreMobilityPreparationId,
  selectProbeCandidates,
  shouldReplaceCheckpointState,
  shouldEscalate,
  stableStringify,
  strictCandidateRouteValidation,
};
