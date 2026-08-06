"use strict";

/**
 * TowerIR shadow evaluator — observes a single-Region TowerIR against the
 * legacy structural reachability on the SAME states.  The shadow is
 * observation-only: it never feeds the production DP key, dominance, action
 * enumeration, or winner selection.  Production keeps using the legacy walk
 * reachability untouched.
 *
 * The shadow compares the STRUCTURAL reachability semantics: static walkable
 * components + dynamic removed/replaced overlay.  The production walk
 * reachability is HP/hazard/battle-aware (it simulates transit steps); that
 * extra semantics is NOT claimed by TowerIR v1 and is documented separately.
 */

const { getTileDefinitionAt } = require("./state");
const {
  DIRECTIONS,
  DIRECTION_DELTAS,
  coordinateKey,
  isDoorTile,
  isEnemyTile,
} = require("./reachability");
const { fingerprintJson } = require("./solve-task");

const ENDPOINT_KINDS = ["enemy", "door", "item", "event", "changeFloor"];

function projectStateToTowerIRDynamicState(ir, state) {
  const floorId = state.floorId;
  const floorState = (state.floorStates || {})[floorId] || {};
  const removed = Object.keys(floorState.removed || {})
    .sort()
    .map((key) => `${floorId}:${key}`);
  const replaced = Object.entries(floorState.replaced || {})
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, number]) => ({ key: `${floorId}:${key}`, number }));
  const heroLoc = (state.hero || {}).loc || {};
  const projection = {
    floorId,
    loc: { x: Number(heroLoc.x || 0), y: Number(heroLoc.y || 0) },
    removed,
    replaced,
  };
  projection.dynamicFingerprint = fingerprintJson({
    floorId,
    loc: projection.loc,
    removed,
    replaced,
  });
  return projection;
}

// Canonical endpoint string shared by both the legacy reference and the IR.
function canonicalEndpoint(floorId, kind, x, y, tileId, transitionTarget) {
  if (kind === "changeFloor") {
    return `changeFloor:${x},${y}->${transitionTarget || ""}`;
  }
  return `${kind}:${tileId || ""}@${x},${y}`;
}

// ---- Legacy structural reference (grid flood fill, no HP/battle/hazard) ----
// Uses the walk's exact transit/endpoint predicates against the base tile
// definition + the dynamic removed/replaced overlay.  Independent of the
// TowerIR graph machinery so the comparison is meaningful.

function legacyStaticTransit(project, state, floorId, x, y) {
  const floor = project.floorsById[floorId];
  const key = coordinateKey(x, y);
  if ((floor.changeFloor || {})[key]) return false;
  const floorState = (state.floorStates || {})[floorId] || {};
  let tile = null;
  if ((floorState.removed || {})[key]) return true;
  if ((floorState.replaced || {})[key] != null) {
    tile = project.mapTilesByNumber[String(floorState.replaced[key])];
  } else {
    const number = floor.map && floor.map[y] && floor.map[y][x];
    if (number == null) return false;
    tile = project.mapTilesByNumber[String(number)];
  }
  if (!tile) return true;
  if (tile.cls === "items") return false;
  if (tile.trigger != null && tile.trigger !== "null" && tile.trigger !== "passNet") return false;
  if (isEnemyTile(tile) || isDoorTile(tile)) return false;
  return tile.canPass === true;
}

// Shared endpoint classifier: exactly mirrors the walk mode's adjacent-cell
// endpoint scan (else-if precedence: items > enemy > door > event; removed
// tiles yield no endpoint).  Both the legacy reference and the TowerIR
// evaluator run this on their OWN reachable cell set, so endpoint differences
// can only arise from reachable-cell differences.
function collectEndpointsFromCells(project, state, floorId, cells) {
  const floor = project.floorsById[floorId];
  if (!floor) return [];
  const endpointSet = new Set();
  cells.forEach((cellKey) => {
    const [cx, cy] = cellKey.split(",").map(Number);
    for (const direction of DIRECTIONS) {
      const dx = DIRECTION_DELTAS[direction].x;
      const dy = DIRECTION_DELTAS[direction].y;
      const x = cx + dx;
      const y = cy + dy;
      const key = coordinateKey(x, y);
      const changeFloor = (floor.changeFloor || {})[key];
      if (changeFloor) {
        endpointSet.add(canonicalEndpoint(floorId, "changeFloor", x, y, null, changeFloor.floorId || changeFloor.stair || ""));
      }
      const tile = getTileDefinitionAt(project, state, floorId, x, y);
      if (!tile) continue;
      if (tile.cls === "items") endpointSet.add(canonicalEndpoint(floorId, "item", x, y, tile.id));
      else if (isEnemyTile(tile)) endpointSet.add(canonicalEndpoint(floorId, "enemy", x, y, tile.id));
      else if (isDoorTile(tile)) endpointSet.add(canonicalEndpoint(floorId, "door", x, y, tile.id));
      else if ((floor.events || {})[key]) endpointSet.add(canonicalEndpoint(floorId, "event", x, y, null));
    }
  });
  return Array.from(endpointSet).sort();
}

// Parses canonical endpoint strings back into descriptors for the IR output.
function descriptorsFromCanonicalEndpoints(floorId, endpoints) {
  return endpoints.map((entry) => {
    const match = /^([a-zA-Z]+):(.*)@(\d+),(\d+)$/.exec(entry);
    if (match) {
      return { kind: match[1], floorId, x: Number(match[3]), y: Number(match[4]), tileId: match[2] || null, targetId: null, interactable: true };
    }
    const changeMatch = /^changeFloor:(\d+),(\d+)->(.*)$/.exec(entry);
    if (changeMatch) {
      return { kind: "changeFloor", floorId, x: Number(changeMatch[1]), y: Number(changeMatch[2]), tileId: null, targetId: changeMatch[3] || null, interactable: true };
    }
    return { kind: "unknown", floorId, x: null, y: null, tileId: null, targetId: null, interactable: false };
  }).filter((entry) => entry.x != null);
}

function computeLegacyStructuralReachability(project, state) {
  const floorId = state.floorId;
  const floor = project.floorsById[floorId];
  if (!floor) {
    return { reachableCells: [], reachableEndpoints: [], startComponentId: null };
  }
  const startKey = coordinateKey(state.hero.loc.x, state.hero.loc.y);
  const visited = new Set([startKey]);
  const queue = [startKey];
  while (queue.length > 0) {
    const key = queue.shift();
    const [cx, cy] = key.split(",").map(Number);
    for (const direction of DIRECTIONS) {
      const dx = DIRECTION_DELTAS[direction].x;
      const dy = DIRECTION_DELTAS[direction].y;
      const nx = cx + dx;
      const ny = cy + dy;
      const nKey = coordinateKey(nx, ny);
      if (visited.has(nKey)) continue;
      if (nx < 0 || ny < 0 || nx >= floor.width || ny >= floor.height) continue;
      if (!legacyStaticTransit(project, state, floorId, nx, ny)) continue;
      visited.add(nKey);
      queue.push(nKey);
    }
  }
  const reachableCells = Array.from(visited).sort();
  return {
    reachableCells,
    reachableEndpoints: collectEndpointsFromCells(project, state, floorId, reachableCells),
    startComponentId: null,
  };
}

// ---- TowerIR evaluator (precomputed component graph + dynamic overlay) ----

function evaluateTowerIRReachability(ir, project, state, options) {
  const config = options || {};
  const dyn = projectStateToTowerIRDynamicState(ir, state);
  const floorId = dyn.floorId;
  const floor = ir.floors.find((entry) => entry.floorId === floorId);
  const componentByCoordinate = ir.indexes.componentByCoordinate || {};
  const poiByCoordinate = ir.indexes.poiByCoordinate || {};
  if (!floor) {
    return { startComponentId: null, reachableComponentIds: [], reachablePoiIds: [], reachableEndpointDescriptors: [], regionSemanticSignature: null, diagnostics: { unsupportedFloor: true } };
  }

  const removedKeys = new Set(dyn.removed);
  const replacedMap = new Map(dyn.replaced.map((entry) => [entry.key, entry.number]));
  const floorComponents = ir.components.filter((component) => component.floorId === floorId);
  const floorPois = ir.pois.filter((poi) => poi.floorId === floorId);
  const poiById = new Map(ir.pois.map((poi) => [poi.poiId, poi]));

  const isOpenPoi = (poi) => {
    // Removed POI -> cell is empty -> transit.  Replaced-to-transit -> transit.
    if (removedKeys.has(poi.mutationKey)) return true;
    if (replacedMap.has(poi.mutationKey)) {
      const number = replacedMap.get(poi.mutationKey);
      const tile = project.mapTilesByNumber[String(number)];
      if (!tile) return true;
      if (tile.cls === "items") return false;
      if (tile.trigger != null && tile.trigger !== "null" && tile.trigger !== "passNet") return false;
      if (isEnemyTile(tile) || isDoorTile(tile)) return false;
      return tile.canPass === true;
    }
    return false;
  };

  const openPois = floorPois.filter(isOpenPoi);
  const openPoiByCell = new Map();
  openPois.forEach((poi) => {
    const key = `${floorId}:${coordinateKey(poi.x, poi.y)}`;
    if (!openPoiByCell.has(key)) openPoiByCell.set(key, []);
    openPoiByCell.get(key).push(poi);
  });
  const firstOpenPoiAt = (x, y) => {
    const list = openPoiByCell.get(`${floorId}:${coordinateKey(x, y)}`);
    return list && list.length > 0 ? list[0] : null;
  };

  // Replaced-to-transit cells (including non-POI walls/obstacles) become
  // walkable in the dynamic overlay; they act as bridge nodes in the graph.
  const replacedTransitCells = [];
  const isTransitTileDefinition = (tile) => {
    if (!tile) return true;
    if (tile.cls === "items") return false;
    if (tile.trigger != null && tile.trigger !== "null" && tile.trigger !== "passNet") return false;
    if (isEnemyTile(tile) || isDoorTile(tile)) return false;
    return tile.canPass === true;
  };
  dyn.replaced.forEach((entry) => {
    if (entry.key.indexOf(`${floorId}:`) !== 0) return;
    const [, coord] = entry.key.split(":");
    const [x, y] = coord.split(",").map(Number);
    const tile = project.mapTilesByNumber[String(entry.number)];
    if (!isTransitTileDefinition(tile)) return;
    replacedTransitCells.push({ x, y, key: entry.key, coord });
  });
  const replacedTransitByCell = new Map(replacedTransitCells.map((cell) => [cell.key, cell]));

  // Dynamic graph: nodes are static components and open POI cells.  Edges:
  // component<->openPoi via static adjacency; openPoi<->openPoi via 4-neighbor
  // cells that are themselves open (a chain of removed cells is walkable).
  const neighborCellKeys = (x, y) => DIRECTIONS.map((direction) => ({
    x: x + DIRECTION_DELTAS[direction].x,
    y: y + DIRECTION_DELTAS[direction].y,
  }));

  // Start node: hero loc is a static transit cell -> its component.  Otherwise
  // the hero is on an open POI cell (removed/replaced) -> that cell node.
  const locKey = `${floorId}:${coordinateKey(dyn.loc.x, dyn.loc.y)}`;
  const startComponentId = componentByCoordinate[locKey] || null;
  const startOpenPoi = startComponentId == null ? firstOpenPoiAt(dyn.loc.x, dyn.loc.y) : null;
  const startReplacedCell = startComponentId == null && !startOpenPoi ? replacedTransitByCell.get(locKey) || null : null;
  if (startComponentId == null && !startOpenPoi && !startReplacedCell) {
    return {
      startComponentId: null,
      reachableComponentIds: [],
      reachablePoiIds: [],
      reachableEndpointDescriptors: [],
      regionSemanticSignature: null,
      diagnostics: { startUnresolved: true },
    };
  }

  const reachableComponents = new Set();
  const reachableOpenPois = new Set();
  const reachableReplacedCells = new Set();
  const queue = [];
  const seen = new Set();
  const pushNode = (type, id) => {
    const key = `${type}:${id}`;
    if (seen.has(key)) return;
    seen.add(key);
    queue.push({ type, id });
  };
  if (startComponentId) pushNode("component", startComponentId);
  if (startOpenPoi) pushNode("openPoi", startOpenPoi.poiId);
  if (startReplacedCell) pushNode("replacedCell", startReplacedCell.key);
  while (queue.length > 0) {
    const { type, id } = queue.shift();
    if (type === "component") {
      if (reachableComponents.has(id)) continue;
      reachableComponents.add(id);
      // Expand to open POIs statically adjacent to this component.
      const component = floorComponents.find((entry) => entry.componentId === id);
      (component ? component.boundaryPoiIds : []).forEach((poiId) => {
        const poi = poiById.get(poiId);
        if (poi && isOpenPoi(poi)) pushNode("openPoi", poiId);
      });
      // Expand to components bridged by open POIs adjacent to this component.
      openPois.forEach((poi) => {
        if (!(poi.adjacentComponentIds || []).includes(id)) return;
        (poi.adjacentComponentIds || []).forEach((other) => {
          if (other !== id) pushNode("component", other);
        });
      });
      // Expand to adjacent replaced-transit cells (walls turned walkable).
      component.staticCells.forEach(({ x, y }) => {
        neighborCellKeys(x, y).forEach(({ x: nx, y: ny }) => {
          const replaced = replacedTransitByCell.get(`${floorId}:${coordinateKey(nx, ny)}`);
          if (replaced) pushNode("replacedCell", replaced.key);
        });
      });
    } else if (type === "openPoi") {
      if (reachableOpenPois.has(id)) continue;
      reachableOpenPois.add(id);
      const poi = poiById.get(id);
      if (!poi) continue;
      (poi.adjacentComponentIds || []).forEach((componentId) => pushNode("component", componentId));
      neighborCellKeys(poi.x, poi.y).forEach(({ x, y }) => {
        const adjacentOpenPoi = firstOpenPoiAt(x, y);
        if (adjacentOpenPoi) pushNode("openPoi", adjacentOpenPoi.poiId);
        const replaced = replacedTransitByCell.get(`${floorId}:${coordinateKey(x, y)}`);
        if (replaced) pushNode("replacedCell", replaced.key);
      });
    } else {
      // replacedCell node.
      if (reachableReplacedCells.has(id)) continue;
      reachableReplacedCells.add(id);
      const cell = replacedTransitByCell.get(id);
      if (!cell) continue;
      // Adjacent static components.
      neighborCellKeys(cell.x, cell.y).forEach(({ x, y }) => {
        const componentId = componentByCoordinate[`${floorId}:${coordinateKey(x, y)}`];
        if (componentId) pushNode("component", componentId);
        const adjacentOpenPoi = firstOpenPoiAt(x, y);
        if (adjacentOpenPoi) pushNode("openPoi", adjacentOpenPoi.poiId);
        const replaced = replacedTransitByCell.get(`${floorId}:${coordinateKey(x, y)}`);
        if (replaced) pushNode("replacedCell", replaced.key);
      });
    }
  }

  // Reachable cells: static transit cells of reachable components + reachable
  // open POI cells.
  const reachableCells = new Set();
  floorComponents.forEach((component) => {
    if (!reachableComponents.has(component.componentId)) return;
    component.staticCells.forEach(({ x, y }) => {
      reachableCells.add(`${component.floorId}:${coordinateKey(x, y)}`);
    });
  });
  reachableOpenPois.forEach((poiId) => {
    const poi = poiById.get(poiId);
    if (poi) reachableCells.add(poi.mutationKey);
  });
  reachableReplacedCells.forEach((cellKey) => {
    reachableCells.add(cellKey);
  });

  // Endpoints use the shared classifier (same precedence as the legacy walk) so
  // endpoint differences can only arise from reachable-cell differences.
  const bareCells = Array.from(reachableCells).map((key) => {
    const [, coord] = key.split(":");
    return coord;
  }).sort();
  const reachableEndpointStrings = collectEndpointsFromCells(project, state, floorId, bareCells);
  const reachableEndpointDescriptors = descriptorsFromCanonicalEndpoints(floorId, reachableEndpointStrings);
  const reachablePoiIds = [];
  floorPois.forEach((poi) => {
    if (isOpenPoi(poi)) return;
    const canonical = canonicalEndpoint(poi.floorId, poi.kind, poi.x, poi.y, poi.tileId || null, (poi.transition && (poi.transition.targetFloorId || poi.transition.stair)) || null);
    if (reachableEndpointStrings.includes(canonical)) reachablePoiIds.push(poi.poiId);
  });

  const regionSemanticSignature = fingerprintJson({
    floorId,
    reachableComponents: Array.from(reachableComponents).sort(),
    reachableCells: Array.from(reachableCells).sort(),
    reachableEndpoints: reachableEndpointStrings,
  });

  return {
    startComponentId,
    reachableComponentIds: Array.from(reachableComponents).sort(),
    reachablePoiIds: reachablePoiIds.sort(),
    reachableEndpointDescriptors,
    reachableCells: Array.from(reachableCells).sort(),
    regionSemanticSignature,
    diagnostics: {
      dynamicFingerprint: dyn.dynamicFingerprint,
      removedCount: dyn.removed.length,
      replacedCount: dyn.replaced.length,
      openPoiCount: openPois.length,
      startComponentId,
    },
  };
}

// ---- Shadow comparison ----

function compareShadowSemantics(legacyResult, irResult) {
  const legacyCells = new Set(legacyResult.reachableCells);
  const irCells = new Set((irResult.reachableCells || []).map((key) => {
    const [floorId, coord] = key.split(":");
    return coord;
  }));
  const legacyEndpoints = new Set(legacyResult.reachableEndpoints);
  const irEndpoints = new Set(irResult.reachableEndpoints || []);

  const cellDiff = legacyCells.size !== irCells.size;
  const legacyOnlyEndpoints = Array.from(legacyEndpoints).filter((entry) => !irEndpoints.has(entry)).sort();
  const irOnlyEndpoints = Array.from(irEndpoints).filter((entry) => !legacyEndpoints.has(entry)).sort();

  if (cellDiff || legacyOnlyEndpoints.length > 0 || irOnlyEndpoints.length > 0) {
    let mismatchClass = null;
    if (legacyOnlyEndpoints.length > 0 || irOnlyEndpoints.length > 0) mismatchClass = "endpointSet";
    else mismatchClass = "component";
    return {
      match: false,
      mismatchClass,
      legacyOnlyEndpoints,
      irOnlyEndpoints,
      legacyCellsCount: legacyCells.size,
      irCellsCount: irCells.size,
    };
  }
  return { match: true, mismatchClass: null, legacyOnlyEndpoints: [], irOnlyEndpoints: [], legacyCellsCount: legacyCells.size, irCellsCount: irCells.size };
}

function createTowerIrShadow(ir, project, options) {
  const config = options || {};
  const diagnostics = {
    enabled: true,
    irFingerprint: ir.irFingerprint,
    statesChecked: 0,
    matches: 0,
    mismatches: 0,
    legacyElapsedMs: 0,
    towerIrElapsedMs: 0,
    cacheHits: 0,
    cacheMisses: 0,
    mismatchByClass: {},
    firstMismatchWitnesses: [],
    maxWitnesses: Number(config.maxWitnesses || 8),
  };
  const cache = new Map();
  let checked = 0;

  function checkState(state) {
    diagnostics.statesChecked += 1;
    const dyn = projectStateToTowerIRDynamicState(ir, state);
    const cacheKey = dyn.dynamicFingerprint;
    if (cache.has(cacheKey)) {
      diagnostics.cacheHits += 1;
      return cache.get(cacheKey);
    }
    diagnostics.cacheMisses += 1;

    const legacyStarted = Date.now();
    const legacyResult = computeLegacyStructuralReachability(project, state);
    diagnostics.legacyElapsedMs += Date.now() - legacyStarted;

    const irStarted = Date.now();
    const irResult = evaluateTowerIRReachability(ir, project, state);
    diagnostics.towerIrElapsedMs += Date.now() - irStarted;

    const irNormalized = {
      reachableCells: irResult.reachableCells || [],
      reachableEndpoints: (irResult.reachableEndpointDescriptors || []).map((endpoint) =>
        canonicalEndpoint(endpoint.floorId, endpoint.kind, endpoint.x, endpoint.y, endpoint.tileId, endpoint.targetId),
      ).sort(),
    };
    const comparison = compareShadowSemantics(legacyResult, irNormalized);
    const result = { legacy: legacyResult, ir: irResult, comparison };
    cache.set(cacheKey, result);

    if (comparison.match) {
      diagnostics.matches += 1;
    } else {
      diagnostics.mismatches += 1;
      diagnostics.mismatchByClass[comparison.mismatchClass] = (diagnostics.mismatchByClass[comparison.mismatchClass] || 0) + 1;
      if (diagnostics.firstMismatchWitnesses.length < diagnostics.maxWitnesses) {
        diagnostics.firstMismatchWitnesses.push({
          exactStateFingerprint: fingerprintJson(state),
          floorId: state.floorId,
          loc: `${state.hero.loc.x},${state.hero.loc.y}`,
          mutationSummary: Object.keys((state.floorStates || {})[state.floorId] || {}).join(","),
          legacyOnlyEndpoints: comparison.legacyOnlyEndpoints.slice(0, 10),
          irOnlyEndpoints: comparison.irOnlyEndpoints.slice(0, 10),
          legacySignature: fingerprintJson(legacyResult),
          towerIrSignature: irResult.regionSemanticSignature,
        });
      }
    }
    checked += 1;
    return result;
  }

  function snapshot() {
    return {
      enabled: diagnostics.enabled,
      irFingerprint: diagnostics.irFingerprint,
      statesChecked: diagnostics.statesChecked,
      matches: diagnostics.matches,
      mismatches: diagnostics.mismatches,
      legacyElapsedMs: Number(diagnostics.legacyElapsedMs.toFixed(2)),
      towerIrElapsedMs: Number(diagnostics.towerIrElapsedMs.toFixed(2)),
      cacheHits: diagnostics.cacheHits,
      cacheMisses: diagnostics.cacheMisses,
      mismatchByClass: diagnostics.mismatchByClass,
      firstMismatchWitnesses: diagnostics.firstMismatchWitnesses.slice(0, diagnostics.maxWitnesses),
    };
  }

  return {
    checkState,
    snapshot,
  };
}

module.exports = {
  ENDPOINT_KINDS,
  canonicalEndpoint,
  collectEndpointsFromCells,
  descriptorsFromCanonicalEndpoints,
  compareShadowSemantics,
  computeLegacyStructuralReachability,
  createTowerIrShadow,
  evaluateTowerIRReachability,
  legacyStaticTransit,
  projectStateToTowerIRDynamicState,
};
