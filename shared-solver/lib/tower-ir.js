"use strict";

/**
 * TowerIR v1 compiler — deterministic, serializable static topology for a
 * single Region.  Compiles a project + RegionSpec into an immutable graph of
 * walkable components and interaction POIs.  The IR is observation-only in
 * Commit 3 (shadow): it never participates in the production DP key, action
 * enumeration, dominance, or winner selection.
 *
 * schema: motapathfinder.tower-ir.v1
 */

const crypto = require("node:crypto");

const {
  DIRECTIONS,
  DIRECTION_DELTAS,
  coordinateKey,
  isDoorTile,
  isEnemyTile,
} = require("./reachability");

const TOWER_IR_SCHEMA = "motapathfinder.tower-ir.v1";

function stableValue(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stableValue);
  return Object.keys(value)
    .sort()
    .reduce((acc, key) => {
      acc[key] = stableValue(value[key]);
      return acc;
    }, {});
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

// Static, state-independent classification of a base-map cell.  Mirrors the
// walk's isEndpointTile / isTransitTile predicates (step-simulator.js) applied
// to the BASE tile definition (no removed/replaced overlay).
function classifyStaticCell(project, floor, x, y) {
  const key = coordinateKey(x, y);
  if ((floor.changeFloor || {})[key]) {
    const target = floor.changeFloor[key];
    return {
      kind: "changeFloor",
      tileId: null,
      transition: {
        targetFloorId: target.floorId || null,
        stair: target.stair || null,
      },
    };
  }
  const baseNumber = floor.map && floor.map[y] && floor.map[y][x];
  const tile = baseNumber == null ? null : project.mapTilesByNumber[String(baseNumber)];
  if (!tile) return { kind: "transit", tileId: null };
  if (tile.cls === "items") return { kind: "item", tileId: tile.id || String(baseNumber) };
  if (isEnemyTile(tile)) return { kind: "enemy", tileId: tile.id || String(baseNumber) };
  if (isDoorTile(tile)) return { kind: "door", tileId: tile.id || String(baseNumber) };
  if (tile.trigger != null && tile.trigger !== "null" && tile.trigger !== "passNet") {
    return { kind: "toolSensitive", tileId: tile.id || String(baseNumber) };
  }
  if (tile.canPass === true) return { kind: "transit", tileId: null };
  return { kind: "obstacle", tileId: tile.id || String(baseNumber) };
}

// Per-floor event presence (state-independent structure summary).
function eventSummaryAt(floor, x, y) {
  const event = (floor.events || {})[coordinateKey(x, y)];
  if (!event) return null;
  return {
    enable: event.enable != null ? event.enable : null,
    trigger: event.trigger || null,
  };
}

function buildSourceFingerprint(project, regionSpec) {
  const scope = (regionSpec && regionSpec.scope) || {};
  const floors = (scope.floors || []).slice().sort();
  const floorSummaries = floors.map((floorId) => {
    const floor = project.floorsById[floorId];
    if (!floor) return { floorId, missing: true };
    const changeFloorKeys = Object.keys(floor.changeFloor || {})
      .sort()
      .map((key) => `${key}=>${(floor.changeFloor[key] || {}).floorId || (floor.changeFloor[key] || {}).stair || ""}`);
    const eventKeys = Object.keys(floor.events || {}).sort();
    const mapDigest = floor.map
      ? sha256Hex(floor.map.map((row) => (row || []).join(",")).join("|")).slice(0, 16)
      : null;
    return {
      floorId,
      width: floor.width,
      height: floor.height,
      mapDigest,
      changeFloorKeys: changeFloorKeys.slice(0, 400),
      eventCount: eventKeys.length,
      eventKeySample: eventKeys.slice(0, 200),
    };
  });
  const actionPolicy = {
    actionKinds: ((regionSpec && regionSpec.actionPolicy && regionSpec.actionPolicy.actionKinds) || []).slice().sort(),
    allowedFloors: ((regionSpec && regionSpec.actionPolicy && regionSpec.actionPolicy.allowedFloors) || []).slice().sort(),
  };
  return sha256Hex(stableStringify({
    regionId: (regionSpec && regionSpec.id) || null,
    start: (regionSpec && regionSpec.start) || null,
    scope: scope,
    floors: floorSummaries,
    actionPolicy,
  }));
}

function compileTowerIR(project, regionSpec, options) {
  const config = options || {};
  const scope = (regionSpec && regionSpec.scope && Array.isArray(regionSpec.scope.floors))
    ? regionSpec.scope.floors.slice()
    : [];
  if (scope.length === 0) {
    throw new Error("TowerIR compile requires a non-empty region scope.floors");
  }
  for (const floorId of scope) {
    if (!project.floorsById[floorId]) {
      throw new Error(`TowerIR scope references unknown floor: ${floorId}`);
    }
  }

  const towerId = config.towerId || (project.data && project.data.title) || "unknown-tower";
  const regionId = (regionSpec && regionSpec.id) || null;
  const sourceFingerprint = buildSourceFingerprint(project, regionSpec);

  const floors = [];
  const components = [];
  const pois = [];
  const edges = [];
  const componentByCoordinate = {};
  const poiByCoordinate = {};

  for (const floorId of scope) {
    const floor = project.floorsById[floorId];
    const { width, height } = floor;

    // Pass 1: classify every cell; static transit cells go into a grid map.
    const cellKind = [];
    const staticCells = [];
    const poiCells = [];
    for (let y = 0; y < height; y += 1) {
      cellKind[y] = [];
      for (let x = 0; x < width; x += 1) {
        const cls = classifyStaticCell(project, floor, x, y);
        const eventSummary = eventSummaryAt(floor, x, y);
        cellKind[y][x] = cls.kind;
        if (cls.kind === "transit") {
          staticCells.push({ x, y });
        } else if (cls.kind !== "obstacle") {
          poiCells.push({ x, y, cls, eventSummary });
        }
      }
    }

    // Pass 2: flood-fill static transit cells into components.
    const componentOf = {};
    const nextComponentId = () => `floor:${floorId}:component:${components.length}`;
    const keyOf = (x, y) => coordinateKey(x, y);
    for (const cell of staticCells) {
      const startKey = keyOf(cell.x, cell.y);
      if (componentOf[startKey] != null) continue;
      const componentId = nextComponentId();
      const componentCells = [];
      const queue = [cell];
      componentOf[startKey] = componentId;
      while (queue.length > 0) {
        const { x, y } = queue.shift();
        componentCells.push({ x, y });
        for (const direction of DIRECTIONS) {
          const dx = DIRECTION_DELTAS[direction].x;
          const dy = DIRECTION_DELTAS[direction].y;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (cellKind[ny][nx] !== "transit") continue;
          const nKey = keyOf(nx, ny);
          if (componentOf[nKey] != null) continue;
          componentOf[nKey] = componentId;
          queue.push({ x: nx, y: ny });
        }
      }
      components.push({ componentId, floorId, staticCells: componentCells, boundaryPoiIds: [] });
    }

    // Pass 3: POIs — non-transit interaction cells + transit cells with events.
    const componentIndex = new Map(components.map((c) => [c.componentId, c]));
    const poiIndex = new Map();
    const adjacentComponentsOf = (x, y) => {
      const result = [];
      for (const direction of DIRECTIONS) {
        const dx = DIRECTION_DELTAS[direction].x;
        const dy = DIRECTION_DELTAS[direction].y;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (cellKind[ny][nx] !== "transit") continue;
        const componentId = componentOf[keyOf(nx, ny)];
        if (componentId && !result.includes(componentId)) result.push(componentId);
      }
      return result;
    };
    const registerPoi = (x, y, kind, tileId, eventSummary, transition) => {
      const mutationKey = `${floorId}:${coordinateKey(x, y)}`;
      const poiId = `${floorId}:${kind}:${x},${y}${tileId ? ":" + tileId : ""}`;
      const adjacentComponentIds = adjacentComponentsOf(x, y);
      pois.push({
        poiId,
        floorId,
        x,
        y,
        kind,
        tileId,
        adjacentComponentIds,
        mutationKey,
        transition: transition || null,
        eventSummary: eventSummary || null,
      });
      const poiRef = pois[pois.length - 1];
      if (!poiByCoordinate[mutationKey]) poiByCoordinate[mutationKey] = [];
      if (!poiByCoordinate[mutationKey].includes(poiId)) poiByCoordinate[mutationKey].push(poiId);
      adjacentComponentIds.forEach((componentId) => {
        const component = componentIndex.get(componentId);
        if (component && !component.boundaryPoiIds.includes(poiId)) {
          component.boundaryPoiIds.push(poiId);
        }
        if (!poiRef.adjacentComponentIds.includes(componentId)) poiRef.adjacentComponentIds.push(componentId);
      });
      return poiId;
    };
    for (const { x, y, cls, eventSummary } of poiCells) {
      registerPoi(x, y, cls.kind, cls.tileId, eventSummary, cls.transition || null);
    }
    // Transit cells that carry an event also produce an event POI (the cell is
    // both a static cell and an interaction endpoint).
    for (const cell of staticCells) {
      const eventSummary = eventSummaryAt(floor, cell.x, cell.y);
      if (eventSummary) {
        registerPoi(cell.x, cell.y, "event", null, eventSummary, null);
      }
    }
    // ANY cell carrying an event (including non-transit trigger/enemy/item
    // cells) produces an event POI so the shadow's event endpoints match the
    // legacy endpoint scan, which lists events regardless of the tile kind.
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (cellKind[y][x] === "transit") continue;
        if ((floor.changeFloor || {})[coordinateKey(x, y)]) continue;
        const eventSummary = eventSummaryAt(floor, x, y);
        if (eventSummary) {
          registerPoi(x, y, "event", null, eventSummary, null);
        }
      }
    }

    const componentIds = components.filter((c) => c.floorId === floorId).map((c) => c.componentId);
    const poiIds = pois.filter((p) => p.floorId === floorId).map((p) => p.poiId);
    floors.push({ floorId, width, height, componentIds, poiIds });
  }

  // Pass 4: edges — component-to-component via POIs that sit between two
  // components (these are the dynamic blockers that may bridge components once
  // removed/replaced).
  const edgeIndex = new Map();
  let edgeOrdinal = 0;
  pois.forEach((poi) => {
    const { adjacentComponentIds } = poi;
    if (!Array.isArray(adjacentComponentIds)) return;
    for (let i = 0; i < adjacentComponentIds.length; i += 1) {
      for (let j = i + 1; j < adjacentComponentIds.length; j += 1) {
        const from = adjacentComponentIds[i];
        const to = adjacentComponentIds[j];
        const edgeKey = `${from}|${to}`;
        if (edgeIndex.has(edgeKey)) continue;
        edgeIndex.set(edgeKey, true);
        edges.push({
          edgeId: `edge:${edgeOrdinal}`,
          from,
          to,
          kind: "poi-bridge",
          poiId: poi.poiId,
        });
        edgeOrdinal += 1;
      }
    }
  });

  // Populate componentByCoordinate from components (static transit cells).
  components.forEach((component) => {
    component.staticCells.forEach(({ x, y }) => {
      componentByCoordinate[`${component.floorId}:${coordinateKey(x, y)}`] = component.componentId;
    });
  });

  // Stable indexes over sorted keys.
  const componentByCoordinateSorted = {};
  Object.entries(componentByCoordinate)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .forEach(([key, componentId]) => {
      componentByCoordinateSorted[key] = componentId;
    });
  const poiByCoordinateSorted = {};
  Object.entries(poiByCoordinate)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .forEach(([key, poiId]) => {
      poiByCoordinateSorted[key] = poiId;
    });

  const ir = {
    schema: TOWER_IR_SCHEMA,
    towerId,
    regionId,
    sourceFingerprint,
    scope: { floorIds: scope.slice().sort() },
    floors,
    components,
    pois,
    edges,
    indexes: {
      componentByCoordinate,
      poiByCoordinate,
      mutationKeyToPoiIds: poiByCoordinate,
    },
  };
  ir.irFingerprint = sha256Hex(stableStringify(ir)).slice(0, 16);
  return ir;
}

module.exports = {
  TOWER_IR_SCHEMA,
  buildSourceFingerprint,
  classifyStaticCell,
  compileTowerIR,
  stableStringify,
};
