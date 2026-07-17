"use strict";

const { cloneState, getTileDefinitionAt } = require("./state");
const { estimateBattleSurvivability, parseBattleSummary } = require("./battle-thresholds");
const { searchSegmentDP, summarizeEffectiveHero, summarizeHero } = require("./segment-dp");

const MODEL_VERSION = "breakpoint-v2";

const DEFAULTS = Object.freeze({
  model: MODEL_VERSION,
  maxExpansions: 600,
  maxRuntimeMs: 5000,
  goalSkylineLimit: 4,
  dpSkylineMax: 4,
  minDamageSaving: 5000,
  landmarkArchiveLimit: 24,
});

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resourceTile(summary) {
  const target = parseBattleSummary(summary);
  if (!target) return null;
  return {
    floorId: target.floorId,
    x: target.x,
    y: target.y,
  };
}

function discoverBattleResourceTargets(simulator, state, segment, options) {
  const config = options || {};
  const policy = (segment && segment.actionPolicy) || {};
  const floors = (config.allowedFloors || policy.allowedFloors || [state.floorId])
    .filter((value, index, all) => value && all.indexOf(value) === index);
  const protectedKeys = new Set(
    ((segment && segment.goal && segment.goal.removedTiles) || [])
      .map((tile) => `${tile.floorId}:${tile.x},${tile.y}`),
  );
  const targets = [];
  floors.forEach((floorId) => {
    const floor = simulator.project && simulator.project.floorsById && simulator.project.floorsById[floorId];
    const height = Number(floor && (floor.height || (Array.isArray(floor.map) ? floor.map.length : 0)) || 0);
    const width = Number(floor && floor.width || 0);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const tile = getTileDefinitionAt(simulator.project, state, floorId, x, y);
        if (!tile || !String(tile.cls || "").startsWith("enemy")) continue;
        const summary = `battle:${tile.id}@${floorId}:${x},${y}`;
        if (protectedKeys.has(`${floorId}:${x},${y}`)) continue;
        const cost = evaluateResourceCost(simulator, state, summary);
        if (!cost.supported || !Number.isFinite(cost.damage)) continue;
        targets.push({
          summary,
          resourceTile: { floorId, x, y },
          baselineDamage: cost.damage,
          roleKey: "map-battle-resource",
          proofActions: [summary],
        });
      }
    }
  });
  return targets
    .sort((left, right) => number(right.baselineDamage, 0) - number(left.baselineDamage, 0) || left.summary.localeCompare(right.summary))
    .slice(0, Math.max(1, number(config.limit, 8)));
}

function tilePresent(project, state, tile) {
  return Boolean(
    tile &&
    getTileDefinitionAt(project, state, tile.floorId, tile.x, tile.y) != null,
  );
}

function evaluateResourceCost(simulator, state, summary) {
  const target = parseBattleSummary(summary);
  if (!target) {
    return {
      supported: false,
      reason: "non-battle-resource-cost-not-supported",
      summary,
    };
  }
  const result = estimateBattleSurvivability(simulator, state, target, {
    skipMinHp: true,
  });
  if (!result || !result.supported) {
    return {
      supported: false,
      reason: result && result.reason || "unsupported-battle-resource",
      summary,
      target,
    };
  }
  return {
    supported: true,
    summary,
    target,
    damage: number(result.currentDamage, Number.POSITIVE_INFINITY),
    turn: number(result.currentTurn, 0),
    survivable: result.survivable === true,
    hp: number((state.hero || {}).hp, 0),
  };
}

function compareProofs(left, right) {
  return number(right.damageSaving, 0) - number(left.damageSaving, 0) ||
    number(right.survivable ? 1 : 0, 0) - number(left.survivable ? 1 : 0, 0) ||
    number(right.hp, 0) - number(left.hp, 0) ||
    number(left.routeLength, Number.MAX_SAFE_INTEGER) - number(right.routeLength, Number.MAX_SAFE_INTEGER);
}

function buildDeferralSegment(startState, resource, options) {
  const config = { ...DEFAULTS, ...(options || {}) };
  const tile = resource.resourceTile || resourceTile(resource.summary);
  const allowedFloors = (config.allowedFloors || resource.allowedFloors || [])
    .filter((value, index, all) => value && all.indexOf(value) === index);
  const allowChangeFloors = config.allowChangeFloors || resource.allowChangeFloors || allowedFloors.flatMap((floorId) => {
    const floor = simulatorProjectForOptions(config) && simulatorProjectForOptions(config).floorsById
      ? simulatorProjectForOptions(config).floorsById[floorId]
      : null;
    return Object.keys((floor && floor.changeFloor) || {})
      .map((coordinate) => `${floorId}:${coordinate}`);
  });
  const protectedTiles = tile ? [tile] : [];
  return {
    id: `resource-deferral-${String(resource.summary || "resource")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .slice(0, 72)}`,
    label: `Defer ${resource.summary}`,
    generated: true,
    generatedBy: {
      mode: MODEL_VERSION,
      sourceSummary: resource.summary,
    },
    goal: {
      type: "resourceDeferral",
      floorId: config.targetFloorId || startState.floorId,
      minHero: resource.minHero || undefined,
      minEffectiveHero: resource.minEffectiveHero || undefined,
      presentTiles: protectedTiles,
      resourceDeferral: {
        resourceSummary: resource.summary,
        baselineDamage: number(resource.baselineDamage, 0),
        maxDamage: number(resource.maxDamage, Number.POSITIVE_INFINITY),
        minDamageSaving: number(resource.minDamageSaving, config.minDamageSaving),
        requireSurvivable: resource.requireSurvivable !== false,
      },
    },
    actionPolicy: {
      actionKinds: ["battle", "pickup", "equip", "openDoor", "useTool", "changeFloor", "event"],
      forbidUnsupportedEvents: true,
      allowedFloors,
      allowChangeFloors,
      protectedTiles,
      ...(resource.actionPolicy || {}),
    },
    dp: {
      keyMode: "location",
      stopOnFirstGoal: false,
      goalSkylineLimit: config.goalSkylineLimit,
      dpSkylineMax: config.dpSkylineMax,
      priorityMode: "resource-first",
      preserveSkylineRoles: true,
      landmarkArchiveLimit: config.landmarkArchiveLimit,
    },
  };
}

function simulatorProjectForOptions(options) {
  return options && options.project ? options.project : null;
}

function selectProofCandidates(simulator, startState, result, resource, options) {
  const config = { ...DEFAULTS, ...(options || {}) };
  const records = [
    ...((result && result.goalSkyline) || []),
    ...((result && result.landmarkArchive) || []),
  ];
  const baselineDamage = number(resource.baselineDamage, 0);
  return records
    .filter((record) => record && record.state)
    .map((record) => {
      const state = record.state;
      const cost = evaluateResourceCost(simulator, state, resource.summary);
      const routeLength = Array.isArray(state.route) ? state.route.length : 0;
      return {
        state,
        route: Array.isArray(state.route) ? state.route.slice() : [],
        summary: resource.summary,
        baselineDamage,
        deferredDamage: cost.damage,
        damageSaving: baselineDamage - number(cost.damage, baselineDamage),
        survivable: Boolean(cost.survivable),
        hp: number((state.hero || {}).hp, 0),
        hero: summarizeHero(state),
        effectiveHero: summarizeEffectiveHero(state),
        routeLength,
        targetPresent: tilePresent(simulator.project, state, resource.resourceTile),
        roleKey: resource.roleKey || "retained-resource-option",
        proofActions: resource.proofActions || [],
      };
    })
    .filter((proof) => proof.targetPresent && proof.survivable && proof.damageSaving >= config.minDamageSaving)
    .sort(compareProofs)
    .slice(0, Math.max(1, config.goalSkylineLimit));
}

function findResourceDeferralProof(simulator, startState, resource, options) {
  const config = { ...DEFAULTS, ...(options || {}) };
  if (!simulator || !startState || !resource || !resource.summary) {
    return { found: false, stoppedReason: "invalid-resource-deferral-input" };
  }
  const tile = resource.resourceTile || resourceTile(resource.summary);
  const baseline = resource.baselineDamage != null
    ? { supported: true, damage: Number(resource.baselineDamage), survivable: false }
    : evaluateResourceCost(simulator, startState, resource.summary);
  if (!baseline.supported) {
    return {
      found: false,
      stoppedReason: "resource-cost-unsupported",
      baseline: baseline,
    };
  }
  if (!tile || !tilePresent(simulator.project, startState, tile)) {
    return {
      found: false,
      stoppedReason: "resource-not-present",
      baseline,
      resourceTile: tile,
    };
  }
  const normalizedResource = {
    ...resource,
    resourceTile: tile,
    baselineDamage: baseline.damage,
    maxDamage: baseline.damage - config.minDamageSaving,
    minDamageSaving: config.minDamageSaving,
  };
  const segment = buildDeferralSegment(startState, normalizedResource, {
    ...config,
    project: simulator.project,
  });
  const result = searchSegmentDP(simulator, cloneState(startState), segment, {
    candidateLimit: config.goalSkylineLimit,
    preserveSkylineRoles: true,
    captureTrace: config.captureTrace === true,
    dpOverrides: {
      maxExpansions: config.maxExpansions,
      maxRuntimeMs: config.maxRuntimeMs,
      goalSkylineLimit: config.goalSkylineLimit,
      dpSkylineMax: config.dpSkylineMax,
      landmarkArchiveLimit: config.landmarkArchiveLimit,
      stopOnFirstGoal: false,
      preserveSkylineRoles: true,
      resourceTimingModel: "off",
    },
  });
  const proofs = selectProofCandidates(
    simulator,
    startState,
    result,
    normalizedResource,
    config,
  );
  return {
    found: proofs.length > 0,
    model: MODEL_VERSION,
    resource: {
      summary: resource.summary,
      tile,
      baselineDamage: baseline.damage,
      minDamageSaving: config.minDamageSaving,
      maxDamage: normalizedResource.maxDamage,
    },
    segment,
    proofs,
    baseline,
    diagnostics: result && result.diagnostics,
    bestProgress: result && result.bestProgress,
    stoppedReason: proofs.length > 0
      ? null
      : result && result.diagnostics && result.diagnostics.dp && result.diagnostics.dp.stoppedReason ||
        "no-deferral-proof",
  };
}

module.exports = {
  DEFAULTS,
  MODEL_VERSION,
  buildDeferralSegment,
  discoverBattleResourceTargets,
  evaluateResourceCost,
  findResourceDeferralProof,
  resourceTile,
};
