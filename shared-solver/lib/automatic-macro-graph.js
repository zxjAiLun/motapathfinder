"use strict";

const crypto = require("node:crypto");

const { resolveRelativeFloor } = require("./floor-transitions");
const { compileTowerIR, stableStringify } = require("./tower-ir");

const SCHEMA = "motapathfinder.automatic-macro-graph.v1";
const CARDINAL_DELTAS = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];
const MUTATION_ACTION_TYPES = new Set([
  "setValue",
  "setHero",
  "setEnemy",
  "openDoor",
  "hide",
  "show",
  "setBlock",
  "changeFloor",
]);

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function coordinateKey(x, y) {
  return `${Number(x)},${Number(y)}`;
}

function resolveStaticTargetFloor(project, sourceFloorId, transition) {
  if (!transition || !transition.floorId) return null;
  try {
    return resolveRelativeFloor(project, sourceFloorId, transition.floorId);
  } catch (_error) {
    return null;
  }
}

function buildFloorTransitionGraph(project) {
  const edges = [];
  const adjacency = {};
  for (const floorId of project.floorOrder || []) {
    const floor = project.floorsById[floorId];
    if (!floor) continue;
    adjacency[floorId] = adjacency[floorId] || [];
    for (const [at, transition] of Object.entries(floor.changeFloor || {}).sort()) {
      const targetFloorId = resolveStaticTargetFloor(project, floorId, transition);
      edges.push({ floorId, at, targetFloorId, transition });
      if (targetFloorId && project.floorsById[targetFloorId] && !adjacency[floorId].includes(targetFloorId)) {
        adjacency[floorId].push(targetFloorId);
      }
    }
    adjacency[floorId].sort();
  }
  return { adjacency, edges };
}

function shortestFloorPath(project, startFloorId, targetFloorId) {
  const graph = buildFloorTransitionGraph(project);
  if (startFloorId === targetFloorId) return { floorIds: [startFloorId], graph };
  const queue = [startFloorId];
  const parent = new Map([[startFloorId, null]]);
  while (queue.length > 0 && !parent.has(targetFloorId)) {
    const floorId = queue.shift();
    for (const next of graph.adjacency[floorId] || []) {
      if (parent.has(next)) continue;
      parent.set(next, floorId);
      queue.push(next);
    }
  }
  if (!parent.has(targetFloorId)) {
    throw new Error(`No static floor-transition path from ${startFloorId} to ${targetFloorId}`);
  }
  const floorIds = [];
  for (let cursor = targetFloorId; cursor != null; cursor = parent.get(cursor)) floorIds.push(cursor);
  floorIds.reverse();
  return { floorIds, graph };
}

function reachableFloors(adjacency, startFloorId) {
  const queue = [startFloorId];
  const seen = new Set([startFloorId]);
  while (queue.length > 0) {
    const floorId = queue.shift();
    for (const next of adjacency[floorId] || []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

function buildPlanningFloorEnvelope(project, initialState, targetFloorId, options) {
  const config = options || {};
  const shortest = shortestFloorPath(project, initialState.floorId, targetFloorId);
  if (config.envelopeMode !== "state-visible-revisitable") {
    return {
      selection: "shortest-static-changeFloor-path",
      floorIds: shortest.floorIds,
      graph: shortest.graph,
    };
  }
  const visible = new Set([
    ...Object.keys(initialState.visitedFloors || {}).filter((floorId) => initialState.visitedFloors[floorId]),
    ...shortest.floorIds,
  ]);
  const restricted = {};
  const reverse = {};
  for (const floorId of visible) {
    restricted[floorId] = (shortest.graph.adjacency[floorId] || []).filter((next) => visible.has(next));
    reverse[floorId] = reverse[floorId] || [];
  }
  for (const [from, targets] of Object.entries(restricted)) {
    for (const to of targets) {
      reverse[to] = reverse[to] || [];
      reverse[to].push(from);
    }
  }
  const reachableFromStart = reachableFloors(restricted, initialState.floorId);
  const canReturnToTarget = reachableFloors(reverse, targetFloorId);
  const floorIds = Array.from(project.floorOrder || [])
    .filter((floorId) => visible.has(floorId) && reachableFromStart.has(floorId) && canReturnToTarget.has(floorId));
  shortest.floorIds.forEach((floorId) => {
    if (!floorIds.includes(floorId)) floorIds.push(floorId);
  });
  return {
    selection: "state-visible-static-revisit-closure",
    floorIds,
    graph: shortest.graph,
    visibleFloorIds: Array.from(visible).sort(),
  };
}

function walkActions(value, visitor, context) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walkActions(entry, visitor, { ...context, path: `${context.path}[${index}]` }));
    return;
  }
  if (!value || typeof value !== "object") return;
  visitor(value, context);
  for (const [key, child] of Object.entries(value)) {
    if (key === "floorId" || key === "loc") continue;
    if (child && typeof child === "object") {
      walkActions(child, visitor, { ...context, path: `${context.path}.${key}` });
    }
  }
}

function mutationEffects(value, source) {
  const effects = [];
  walkActions(value, (action, context) => {
    if (!action.type || !MUTATION_ACTION_TYPES.has(action.type)) return;
    effects.push({
      type: action.type,
      name: action.name || null,
      operator: action.operator || null,
      value: action.value == null ? null : String(action.value),
      floorId: action.floorId || null,
      loc: Array.isArray(action.loc) ? action.loc.slice(0, 2) : null,
      number: action.number == null ? null : String(action.number),
      source,
      sourcePath: context.path,
    });
  }, { path: source });
  return effects;
}

function conditionExpressions(value) {
  const conditions = [];
  walkActions(value, (action) => {
    if (typeof action.condition === "string" && !conditions.includes(action.condition)) {
      conditions.push(action.condition);
    }
  }, { path: "condition-scan" });
  return conditions.sort();
}

function eventFeatures(value) {
  const features = new Set();
  walkActions(value, (action) => {
    if (action.type === "shop") features.add("shop");
    if (action.type === "choices") features.add("choice");
    if (action.type === "changeFloor") features.add("changeFloor");
    if (action.type === "openDoor") features.add("openDoor");
    if (action.type === "setValue" || action.type === "setHero" || action.type === "setEnemy") {
      features.add("stateMutation");
    }
  }, { path: "feature-scan" });
  return Array.from(features).sort();
}

function floorHookRecords(floorId, floor) {
  const records = [];
  const keyedHooks = ["events", "autoEvent", "beforeBattle", "afterBattle", "afterGetItem", "afterOpenDoor"];
  for (const hook of keyedHooks) {
    for (const [at, payload] of Object.entries(floor[hook] || {}).sort()) {
      const effects = mutationEffects(payload, `${hook}:${floorId}:${at}`);
      const conditions = conditionExpressions(payload);
      const features = eventFeatures(payload);
      if (effects.length > 0 || conditions.length > 0 || features.length > 0) {
        records.push({ hook, floorId, at, effects, conditions, features });
      }
    }
  }
  for (const hook of ["firstArrive", "eachArrive"]) {
    const effects = mutationEffects(floor[hook] || [], `${hook}:${floorId}`);
    const conditions = conditionExpressions(floor[hook] || []);
    const features = eventFeatures(floor[hook] || []);
    if (effects.length > 0 || conditions.length > 0 || features.length > 0) {
      records.push({ hook, floorId, at: null, effects, conditions, features });
    }
  }
  return records;
}

function itemRole(project, itemId) {
  const item = project.itemsById[itemId] || {};
  if (item.cls === "equips") return "equipment";
  if (item.cls === "tools" || /Key$/i.test(itemId)) return "key-or-tool";
  if (item.cls === "constants") return "permanent-item";
  return "consumable-resource";
}

function landingCoordinate(project, targetFloorId, transition) {
  if (!targetFloorId || !transition) return null;
  if (Array.isArray(transition.loc) && transition.loc.length === 2
    && transition.loc.every((entry) => Number.isFinite(Number(entry)))) {
    return { x: Number(transition.loc[0]), y: Number(transition.loc[1]) };
  }
  if (!transition.stair) return null;
  const floor = project.floorsById[targetFloorId];
  if (!floor) return null;
  for (let y = 0; y < floor.height; y += 1) {
    for (let x = 0; x < floor.width; x += 1) {
      const number = floor.map && floor.map[y] && floor.map[y][x];
      const tile = number == null ? null : project.mapTilesByNumber[String(number)];
      if (tile && tile.id === transition.stair) return { x, y };
    }
  }
  return null;
}

function endpointNodeIds(ir, floorId, x, y) {
  const key = `${floorId}:${coordinateKey(x, y)}`;
  const result = [];
  const componentId = ir.indexes.componentByCoordinate[key];
  if (componentId) result.push(componentId);
  for (const poiId of ir.indexes.poiByCoordinate[key] || []) result.push(poiId);
  return result;
}

function buildAutomaticMacroGraph(project, initialState, terminalGoal, options) {
  const config = options || {};
  if (!project || !initialState || !terminalGoal) {
    throw new Error("Automatic macro graph requires project, initial state, and terminal goal");
  }
  if (terminalGoal.type !== "bossDefeated") {
    throw new Error(`Unsupported automatic macro goal: ${terminalGoal.type}`);
  }
  const corridor = buildPlanningFloorEnvelope(project, initialState, terminalGoal.floorId, config);
  const floorIds = corridor.floorIds;
  const floorSet = new Set(floorIds);
  const ir = compileTowerIR(project, {
    id: "automatic-blind-corridor",
    scope: { floors: floorIds },
    actionPolicy: {},
  }, { towerId: config.towerId || "blind-tower" });
  const nodes = [];
  const edges = [];
  const nodeIds = new Set();
  const edgeIds = new Set();
  const addNode = (node) => {
    if (nodeIds.has(node.id)) return;
    nodeIds.add(node.id);
    nodes.push(node);
  };
  const addEdge = (edge) => {
    const id = edge.id || `${edge.kind}:${edge.from}->${edge.to}`;
    if (edgeIds.has(id)) return;
    edgeIds.add(id);
    edges.push({ ...edge, id });
  };

  addNode({ id: "source:initial", kind: "source", floorId: initialState.floorId, evidence: "hard-runtime" });
  addNode({ id: "goal:terminal", kind: "terminal-goal", floorId: terminalGoal.floorId, goal: terminalGoal, evidence: "hard-input" });
  if ((project.defaultFlags || {}).enableAddPoint) {
    addNode({
      id: "mechanic:add-point",
      kind: "mechanic",
      role: "stat-allocation",
      evidence: "hard-project-flag",
    });
  }
  for (const component of ir.components) {
    addNode({
      id: component.componentId,
      kind: "walk-component",
      floorId: component.floorId,
      staticCellCount: component.staticCells.length,
      evidence: "hard-static-topology",
    });
  }

  const targetPoiIds = [];
  const itemSuppliers = {};
  for (const poi of ir.pois) {
    const node = {
      id: poi.poiId,
      kind: poi.kind,
      floorId: poi.floorId,
      x: poi.x,
      y: poi.y,
      tileId: poi.tileId,
      evidence: "hard-static-tower",
      role: null,
      requirements: null,
    };
    if (poi.kind === "item") {
      node.role = itemRole(project, poi.tileId);
      node.itemClass = (project.itemsById[poi.tileId] || {}).cls || null;
      itemSuppliers[poi.tileId] = itemSuppliers[poi.tileId] || [];
      itemSuppliers[poi.tileId].push(poi.poiId);
    } else if (poi.kind === "door") {
      const tileNumber = project.mapNumbersById[poi.tileId];
      const tile = tileNumber == null ? null : project.mapTilesByNumber[String(tileNumber)];
      node.role = "resource-gate";
      node.requirements = { ...((tile && tile.doorInfo && tile.doorInfo.keys) || {}) };
    } else if (poi.kind === "enemy") {
      const isTarget = poi.floorId === terminalGoal.floorId
        && poi.x === Number(terminalGoal.x)
        && poi.y === Number(terminalGoal.y)
        && poi.tileId === terminalGoal.enemyId;
      node.role = isTarget ? "terminal-boss" : "combat-gate-candidate";
      node.requirements = { kind: "simulator-battle-survivability", enemyId: poi.tileId };
      node.evidence = isTarget ? "hard-terminal-match" : "inspection-candidate";
      if (isTarget) targetPoiIds.push(poi.poiId);
    } else if (poi.kind === "changeFloor") {
      node.role = "floor-transition";
    } else if (poi.kind === "event") {
      node.role = "scripted-event";
    }
    addNode(node);
    for (const componentId of poi.adjacentComponentIds || []) {
      addEdge({
        kind: "static-adjacency",
        from: componentId,
        to: poi.poiId,
        evidence: "hard-static-topology",
        traversability: poi.kind === "event" ? "event-semantics" : "conditional-on-poi-resolution",
      });
      addEdge({
        kind: "static-adjacency",
        from: poi.poiId,
        to: componentId,
        evidence: "hard-static-topology",
        traversability: "after-poi-resolution",
      });
    }
  }
  const poiCoordinates = new Map();
  for (const poi of ir.pois) {
    const key = `${poi.floorId}:${coordinateKey(poi.x, poi.y)}`;
    if (!poiCoordinates.has(key)) poiCoordinates.set(key, []);
    poiCoordinates.get(key).push(poi.poiId);
  }
  for (const poi of ir.pois) {
    for (const direction of CARDINAL_DELTAS) {
      const adjacentIds = poiCoordinates.get(
        `${poi.floorId}:${coordinateKey(poi.x + direction.x, poi.y + direction.y)}`,
      ) || [];
      for (const adjacentId of adjacentIds) {
        if (adjacentId === poi.poiId) continue;
        addEdge({
          kind: "poi-contact",
          from: poi.poiId,
          to: adjacentId,
          evidence: "hard-static-topology",
          traversability: "conditional-on-target-resolution-after-source-resolution",
        });
      }
    }
  }
  if (targetPoiIds.length !== 1) {
    throw new Error(`Terminal boss must match exactly one TowerIR POI; matched ${targetPoiIds.length}`);
  }
  addEdge({ kind: "goal-satisfaction", from: targetPoiIds[0], to: "goal:terminal", evidence: "hard-terminal-match" });

  for (const node of nodes.filter((entry) => entry.kind === "door")) {
    for (const [itemId, amount] of Object.entries(node.requirements || {}).sort()) {
      for (const supplierId of itemSuppliers[itemId] || []) {
        addEdge({
          kind: "resource-supply-candidate",
          from: supplierId,
          to: node.id,
          resource: { itemId, amount },
          evidence: "hard-requirement-candidate-supplier",
        });
      }
    }
  }

  for (const source of endpointNodeIds(
    ir,
    initialState.floorId,
    initialState.hero.loc.x,
    initialState.hero.loc.y,
  )) {
    addEdge({ kind: "initial-location", from: "source:initial", to: source, evidence: "hard-runtime" });
  }

  for (const transitionEdge of corridor.graph.edges) {
    if (!floorSet.has(transitionEdge.floorId) || !floorSet.has(transitionEdge.targetFloorId)) continue;
    const [x, y] = transitionEdge.at.split(",").map(Number);
    const sourceIds = (ir.indexes.poiByCoordinate[`${transitionEdge.floorId}:${transitionEdge.at}`] || [])
      .filter((id) => nodes.some((node) => node.id === id && node.kind === "changeFloor"));
    const landing = landingCoordinate(project, transitionEdge.targetFloorId, transitionEdge.transition);
    if (!landing) continue;
    const targets = endpointNodeIds(ir, transitionEdge.targetFloorId, landing.x, landing.y);
    for (const source of sourceIds) {
      for (const target of targets) {
        addEdge({
          kind: "floor-transition",
          from: source,
          to: target,
          sourceFloorId: transitionEdge.floorId,
          targetFloorId: transitionEdge.targetFloorId,
          sourceLoc: { x, y },
          targetLoc: landing,
          evidence: "hard-static-transition",
        });
      }
    }
  }

  const hookRecords = [];
  for (const floorId of floorIds) {
    const floor = project.floorsById[floorId];
    for (const record of floorHookRecords(floorId, floor)) {
      hookRecords.push(record);
      const mutationId = `mutation:${record.hook}:${floorId}:${record.at || "arrival"}`;
      addNode({
        id: mutationId,
        kind: "mutation",
        floorId,
        at: record.at,
        hook: record.hook,
        effects: record.effects,
        conditions: record.conditions,
        features: record.features,
        role: record.features.includes("shop") ? "shop" : "scripted-mutation",
        evidence: "hard-script-static",
      });
      if (record.at) {
        const [x, y] = record.at.split(",").map(Number);
        for (const source of endpointNodeIds(ir, floorId, x, y)) {
          addEdge({ kind: "script-trigger", from: source, to: mutationId, evidence: "hard-hook-location" });
        }
        if (record.effects.some((effect) => effect.type === "openDoor")) {
          for (const target of (ir.indexes.poiByCoordinate[`${floorId}:${record.at}`] || [])) {
            if (nodes.some((node) => node.id === target && node.kind === "door")) {
              addEdge({ kind: "scripted-mutation-target", from: mutationId, to: target, evidence: "hard-hook-location" });
            }
          }
        }
      }
    }
  }

  const mutationNodes = nodes.filter((node) => node.kind === "mutation");
  for (const writer of mutationNodes) {
    const writtenNames = writer.effects
      .filter((effect) => effect.type === "setValue" && effect.name)
      .map((effect) => effect.name);
    for (const name of writtenNames) {
      const flagName = name.startsWith("flag:") ? name.slice("flag:".length) : name;
      for (const reader of mutationNodes) {
        if (reader.id === writer.id) continue;
        if (!(reader.conditions || []).some((condition) => condition.includes(name) || condition.includes(`flag:${flagName}`))) continue;
        addEdge({
          kind: "state-mutation-dependency-candidate",
          from: writer.id,
          to: reader.id,
          resource: { stateName: name },
          evidence: "static-write-condition-match",
        });
      }
    }
  }

  nodes.sort((left, right) => left.id.localeCompare(right.id));
  edges.sort((left, right) => left.id.localeCompare(right.id));
  const countsByKind = {};
  nodes.forEach((node) => { countsByKind[node.kind] = (countsByKind[node.kind] || 0) + 1; });
  const suppliedResources = new Set(edges
    .filter((edge) => edge.kind === "resource-supply-candidate" && edge.resource)
    .map((edge) => edge.resource.itemId));
  const unresolvedResourceRequirements = [];
  for (const node of nodes.filter((entry) => entry.kind === "door")) {
    for (const [itemId, amount] of Object.entries(node.requirements || {}).sort()) {
      if (!suppliedResources.has(itemId)) {
        unresolvedResourceRequirements.push({ nodeId: node.id, itemId, amount });
      }
    }
  }
  const graph = {
    schema: SCHEMA,
    inputContract: {
      inputs: ["tower-project", "canonical-initial-state", "terminal-goal"],
      forbidden: ["route-fixture", "route-prefix", "milestone", "event-order", "resource-threshold"],
      knownRouteUsed: false,
      milestoneUsed: false,
    },
    source: {
      initialFloorId: initialState.floorId,
      targetFloorId: terminalGoal.floorId,
      target: terminalGoal,
      towerIrFingerprint: ir.irFingerprint,
    },
    floorCorridor: {
      selection: corridor.selection,
      floorIds,
      ...(corridor.visibleFloorIds ? { visibleFloorIds: corridor.visibleFloorIds } : {}),
    },
    nodes,
    edges,
    hookRecords,
    summary: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      countsByKind,
      targetPoiId: targetPoiIds[0],
      unresolvedCombatGateCount: nodes.filter((node) => node.role === "combat-gate-candidate").length,
      unresolvedResourceRequirements,
      mutationDependencyEdgeCount: edges.filter((edge) => edge.kind === "state-mutation-dependency-candidate").length,
      dependencyCompleteness: "candidate-graph-not-proof",
    },
  };
  graph.graphFingerprint = sha256(stableStringify(graph)).slice(0, 16);
  return graph;
}

module.exports = {
  SCHEMA,
  buildAutomaticMacroGraph,
  buildFloorTransitionGraph,
  buildPlanningFloorEnvelope,
  floorHookRecords,
  mutationEffects,
  conditionExpressions,
  eventFeatures,
  shortestFloorPath,
};
