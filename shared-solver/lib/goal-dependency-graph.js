"use strict";

const { getTileDefinitionAt } = require("./state");

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boundedRatio(actual, required) {
  const target = Number(required);
  if (!Number.isFinite(target) || target <= 0) return 1;
  return Math.max(0, Math.min(1, number(actual, 0) / target));
}

function effectiveHeroValue(state, field) {
  const hero = (state || {}).hero || {};
  const flags = (state || {}).flags || {};
  return Math.floor(
    number(hero[field], 0) * number(flags[`__${field}_buff__`], 1),
  );
}

function hasEquipment(state, itemId) {
  return Array.isArray(((state || {}).hero || {}).equipment) &&
    state.hero.equipment.includes(itemId);
}

function coordinateKey(x, y) {
  return `${Number(x)},${Number(y)}`;
}

function floorOrder(project) {
  if (Array.isArray(project && project.floorOrder)) return project.floorOrder.slice();
  return Object.keys((project && project.floorsById) || {});
}

function resolveGatewayTarget(project, floorId, changeFloor) {
  const target = changeFloor && changeFloor.floorId;
  if (!target) return null;
  if (target !== ":next" && target !== ":before") return target;
  const order = floorOrder(project);
  const index = order.indexOf(floorId);
  if (index < 0) return null;
  return order[index + (target === ":next" ? 1 : -1)] || null;
}

function compileAllowedGateways(project, segment) {
  const allowed = new Set((((segment || {}).actionPolicy || {}).allowChangeFloors || []).map(String));
  const gateways = [];
  for (const summary of allowed) {
    const match = /^([^:]+):(\d+),(\d+)$/.exec(summary);
    if (!match) continue;
    const floorId = match[1];
    const x = Number(match[2]);
    const y = Number(match[3]);
    const floor = project && project.floorsById && project.floorsById[floorId];
    const changeFloor = floor && floor.changeFloor && floor.changeFloor[coordinateKey(x, y)];
    const targetFloorId = resolveGatewayTarget(project, floorId, changeFloor);
    if (!targetFloorId) continue;
    gateways.push({
      id: `gateway:${floorId}:${x},${y}->${targetFloorId}`,
      kind: "gateway",
      floorId,
      targetFloorId,
      x,
      y,
    });
  }
  return gateways;
}

function shortestFloorDistance(gateways, fromFloorId, toFloorId) {
  if (!toFloorId || fromFloorId === toFloorId) return 0;
  const adjacency = new Map();
  for (const gateway of gateways || []) {
    if (!adjacency.has(gateway.floorId)) adjacency.set(gateway.floorId, new Set());
    adjacency.get(gateway.floorId).add(gateway.targetFloorId);
  }
  const queue = [{ floorId: fromFloorId, distance: 0 }];
  const seen = new Set([fromFloorId]);
  while (queue.length > 0) {
    const current = queue.shift();
    for (const next of adjacency.get(current.floorId) || []) {
      if (next === toFloorId) return current.distance + 1;
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push({ floorId: next, distance: current.distance + 1 });
    }
  }
  return Number.POSITIVE_INFINITY;
}

function compileGoalStage(project, segment, index) {
  const goal = (segment || {}).goal || {};
  const requirements = [];
  const add = (entry) => requirements.push({ stageIndex: index, ...entry });
  if (goal.floorId) add({ id: `floor:${goal.floorId}`, kind: "floor", floorId: goal.floorId });
  for (const [field, required] of Object.entries(goal.minHero || {})) {
    add({ id: `hero:${field}`, kind: "hero-min", field, required: Number(required) });
  }
  for (const [field, required] of Object.entries(goal.minEffectiveHero || {})) {
    add({ id: `effectiveHero:${field}`, kind: "effective-hero-min", field, required: Number(required) });
  }
  for (const itemId of goal.equipmentIncludes || []) {
    add({ id: `equipment:${itemId}`, kind: "equipment", itemId, irreversible: true });
  }
  const removedTiles = [];
  if (goal.type === "bossDefeated" || goal.type === "tileRemoved") {
    removedTiles.push({ floorId: goal.floorId, x: goal.x, y: goal.y });
  }
  removedTiles.push(...(goal.removedTiles || []));
  for (const tile of removedTiles) {
    add({
      id: `removed:${tile.floorId}:${tile.x},${tile.y}`,
      kind: "removed-tile",
      ...tile,
      irreversible: true,
    });
  }
  if (Array.isArray(goal.anyRemovedTiles) && goal.anyRemovedTiles.length > 0) {
    add({ id: "any-removed", kind: "any-removed-tiles", tiles: goal.anyRemovedTiles.slice(), irreversible: true });
  }
  for (const tile of goal.presentTiles || []) {
    add({ id: `present:${tile.floorId}:${tile.x},${tile.y}`, kind: "present-tile", ...tile, protected: true });
  }
  return {
    id: segment && segment.id || `stage-${index}`,
    index,
    segment,
    goal,
    requirements,
    gateways: compileAllowedGateways(project, segment),
  };
}

function requirementProgress(project, state, requirement) {
  const hero = (state || {}).hero || {};
  switch (requirement.kind) {
    case "floor":
      return state.floorId === requirement.floorId ? 1 : 0;
    case "hero-min":
      return boundedRatio(hero[requirement.field], requirement.required);
    case "effective-hero-min":
      return boundedRatio(effectiveHeroValue(state, requirement.field), requirement.required);
    case "equipment":
      return hasEquipment(state, requirement.itemId) ? 1 : 0;
    case "removed-tile":
      return getTileDefinitionAt(project, state, requirement.floorId, requirement.x, requirement.y) == null ? 1 : 0;
    case "any-removed-tiles":
      return requirement.tiles.some((tile) =>
        getTileDefinitionAt(project, state, tile.floorId, tile.x, tile.y) == null,
      ) ? 1 : 0;
    case "present-tile":
      return getTileDefinitionAt(project, state, requirement.floorId, requirement.x, requirement.y) != null ? 1 : 0;
    default:
      return 0;
  }
}

function projectStage(project, stage, state) {
  const projected = stage.requirements.map((requirement) => ({
    requirement,
    progress: requirementProgress(project, state, requirement),
  }));
  const progressTotal = projected.reduce((sum, entry) => sum + entry.progress, 0);
  const requirementsMet = projected.filter((entry) => entry.progress >= 1).length;
  const missingProtectedTiles = projected
    .filter((entry) => entry.requirement.protected && entry.progress < 1)
    .map((entry) => `${entry.requirement.floorId}:${entry.requirement.x},${entry.requirement.y}`);
  const irreversibleLandmarksMet = projected.filter(
    (entry) => entry.requirement.irreversible && entry.progress >= 1,
  ).length;
  const statDeficit = projected.reduce((sum, entry) => {
    if (entry.requirement.kind !== "hero-min" && entry.requirement.kind !== "effective-hero-min") return sum;
    return sum + (1 - entry.progress);
  }, 0);
  const floorDistance = shortestFloorDistance(stage.gateways, state.floorId, stage.goal.floorId);
  return {
    stageId: stage.id,
    feasible: missingProtectedTiles.length === 0,
    floorMatch: !stage.goal.floorId || state.floorId === stage.goal.floorId,
    completion: projected.length > 0 ? progressTotal / projected.length : 0,
    requirementsMet,
    requirementsTotal: projected.length,
    missingProtectedTiles,
    irreversibleLandmarksMet,
    statDeficit,
    nextLandmarkReachable: Number.isFinite(floorDistance),
    nextLandmarkDistance: floorDistance,
  };
}

function compileGoalDependencyGraph(project, segments) {
  const stages = (segments || []).map((segment, index) => compileGoalStage(project, segment, index));
  const stageIndexById = new Map(stages.map((stage, index) => [stage.id, index]));
  return {
    schema: "motapathfinder.goal-dependency-graph.v1",
    stages,
    project(state, currentSegmentId) {
      const currentIndex = stageIndexById.has(currentSegmentId)
        ? stageIndexById.get(currentSegmentId)
        : 0;
      const projections = stages.map((stage) => projectStage(project, stage, state));
      const current = projections[currentIndex] || {
        feasible: true,
        floorMatch: true,
        completion: 0,
        requirementsMet: 0,
        requirementsTotal: 0,
        missingProtectedTiles: [],
        irreversibleLandmarksMet: 0,
        statDeficit: 0,
        nextLandmarkReachable: true,
        nextLandmarkDistance: 0,
      };
      let downstreamWeight = 0;
      let downstreamCompletion = 0;
      let downstreamRequirementsMet = 0;
      let downstreamRequirementsTotal = 0;
      let irreversibleLandmarksMet = current.irreversibleLandmarksMet;
      let statDeficit = current.statDeficit;
      for (let index = currentIndex + 1; index < projections.length; index += 1) {
        const projection = projections[index];
        const weight = 1 / (index - currentIndex);
        downstreamWeight += weight;
        downstreamCompletion += projection.completion * weight;
        downstreamRequirementsMet += projection.requirementsMet;
        downstreamRequirementsTotal += projection.requirementsTotal;
        irreversibleLandmarksMet += projection.irreversibleLandmarksMet;
        statDeficit += projection.statDeficit * weight;
      }
      const nextStage = projections.slice(currentIndex).find((projection) => projection.completion < 1) || current;
      return {
        ...current,
        dependencyStageCount: Math.max(0, projections.length - currentIndex),
        downstreamCompletion: downstreamWeight > 0 ? downstreamCompletion / downstreamWeight : 0,
        downstreamRequirementsMet,
        downstreamRequirementsTotal,
        irreversibleLandmarksMet,
        statDeficit,
        nextLandmarkReachable: nextStage.nextLandmarkReachable,
        nextLandmarkDistance: nextStage.nextLandmarkDistance,
      };
    },
  };
}

module.exports = {
  compileGoalDependencyGraph,
  compileGoalStage,
  projectStage,
  shortestFloorDistance,
};
