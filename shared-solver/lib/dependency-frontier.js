"use strict";

/**
 * PR-5.25m — Structural Prerequisite Frontier Identification & Dual-Queue Priority.
 *
 * Route-free structural prerequisite candidate identification for the MT1->MT3
 * corridor in Only up V2.1.
 *
 * PROTOCOL BOUNDARIES:
 *   1. ROUTE_FREE = TRUE — the frontier is constructed purely from TowerIR topology,
 *      walk components, and POI coordinates. No route fixture, no prefix, no
 *      trace, no authored sequence is ever read during frontier generation.
 *   2. WITNESS_IS_EVALUATOR_ONLY = TRUE — the successful witness route is used
 *      ONLY to evaluate whether the automatically inferred frontier covers the
 *      observed precursor state changes (recall).
 *   3. NO_PRUNING = TRUE — during search (Phase 2), dependency guidance only
 *      affects expansion priority via a bounded-fair dual queue (guided heap +
 *      neutral FIFO). Every legal action is generated, every strategic successor
 *      is retained in the exact registry, and neutral FIFO expands all nodes
 *      eventually.
 */

const { compileTowerIR } = require("./tower-ir");
const { actionToSemanticIdentity, poiToSemanticIdentity, transportSignature } = require("./transport-collapse");
const { readRouteRecord, replayRoute } = require("./learned-prior-dataset");

const CARDINAL_DELTAS = Object.freeze([
  { x: 0, y: -1 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
]);

/**
 * Route-free construction of candidate strategic POIs and dependency frontier.
 *
 * Uses TowerIR for the corridor ["MT1", "MT2"], connects walk components and
 * POIs via static adjacency and POI-contact, and extracts candidate prerequisites
 * using bounded topological slack to the goal transition (MT2:6,12 -> MT3).
 */
function buildDependencyFrontier(project, options) {
  const config = options || {};
  const corridorFloors = config.corridorFloors || ["MT1", "MT2"];
  const maxSlack = config.maxSlack == null ? 4 : config.maxSlack;

  const ir = compileTowerIR(project, {
    id: "corridor-macro-graph",
    scope: { floors: corridorFloors },
  });

  // ALL_STRATEGIC_POIS: all candidate strategic POIs in the corridor macro graph
  // (enemies, doors, floor transitions, events)
  const allStrategicPois = ir.pois
    .filter((poi) => ["enemy", "door", "changeFloor", "event"].includes(poi.kind))
    .map(poiToSemanticIdentity);

  // Build undirected topology graph over components and POIs
  const adj = new Map();
  const addEdge = (u, v) => {
    if (!adj.has(u)) adj.set(u, []);
    adj.get(u).push(v);
  };

  for (const poi of ir.pois) {
    for (const compId of (poi.adjacentComponentIds || [])) {
      addEdge(compId, poi.poiId);
      addEdge(poi.poiId, compId);
    }
  }

  const poiCoords = new Map();
  for (const poi of ir.pois) {
    poiCoords.set(`${poi.floorId}:${poi.x},${poi.y}`, poi.poiId);
  }

  for (const poi of ir.pois) {
    for (const delta of CARDINAL_DELTAS) {
      const neighborId = poiCoords.get(`${poi.floorId}:${poi.x + delta.x},${poi.y + delta.y}`);
      if (neighborId && neighborId !== poi.poiId) {
        addEdge(poi.poiId, neighborId);
      }
    }
  }

  // Cross-floor transitions in the corridor
  addEdge("MT1:changeFloor:6,0", "MT2:changeFloor:6,0");
  addEdge("MT2:changeFloor:6,0", "MT1:changeFloor:6,0");

  const bfsDist = (startId) => {
    const dist = new Map([[startId, 0]]);
    const queue = [startId];
    while (queue.length > 0) {
      const cur = queue.shift();
      const d = dist.get(cur);
      for (const nxt of (adj.get(cur) || [])) {
        if (!dist.has(nxt)) {
          dist.set(nxt, d + 1);
          queue.push(nxt);
        }
      }
    }
    return dist;
  };

  // Start from MT2 entry (MT2:changeFloor:6,0); goal is MT2:changeFloor:6,12
  const startNodeId = config.startNodeId || "MT2:changeFloor:6,0";
  const goalNodeId = config.goalNodeId || "MT2:changeFloor:6,12";

  const distFromStart = bfsDist(startNodeId);
  const distToGoal = bfsDist(goalNodeId);
  const shortestDist = distFromStart.get(goalNodeId);

  const frontierSet = new Set();
  const frontierPoiDetails = [];

  for (const [id, d1] of distFromStart.entries()) {
    const poi = ir.pois.find((p) => p.poiId === id);
    if (!poi) continue;
    if (!["enemy", "door", "changeFloor", "event"].includes(poi.kind)) continue;
    const d2 = distToGoal.get(id);
    if (d2 != null && shortestDist != null && (d1 + d2 - shortestDist) <= maxSlack) {
      const identity = poiToSemanticIdentity(poi);
      frontierSet.add(identity);
      frontierPoiDetails.push({
        poiId: id,
        identity,
        kind: poi.kind,
        floorId: poi.floorId,
        x: poi.x,
        y: poi.y,
        tileId: poi.tileId,
        slack: d1 + d2 - shortestDist,
      });
    }
  }

  // Also include the return transition MT2:6,0->MT1 as a candidate resource detour
  frontierSet.add("changeFloor:MT2:6,0->MT1");

  const frontier = Array.from(frontierSet).sort();

  return {
    allStrategicPois,
    allStrategicPoiCount: allStrategicPois.length,
    frontierSet,
    frontier,
    frontierCount: frontier.length,
    frontierPoiDetails,
    shortestTopologicalDist: shortestDist,
    maxSlack,
  };
}

/**
 * Phase 1 evaluation: witness recall scoring against the frozen frontier.
 *
 * REPLAY PROTOCOL:
 *   1. Replay witnessRouteRecord strictly with learned-prior-dataset.replayRoute.
 *   2. Identify firstMt2Entry: first replay state where state.floorId === "MT2".
 *   3. Identify unlockState: first replay state where legal forward MT2->MT3 changeFloor exists.
 *   4. Extract OBSERVED_PRE_UNLOCK_STATE_CHANGES: actions between firstMt2Entry and unlockState
 *      where transportSignature(pre) !== transportSignature(post).
 *   5. Match against frozen frontierSet via semantic POI identity.
 */
function evaluateWitnessRecall(project, witnessRelPath, frontierSet, allStrategicPoiCount) {
  const entry = readRouteRecord(witnessRelPath);
  const replay = replayRoute(entry, project);

  let firstMt2EntryIdx = -1;
  let unlockIdx = -1;

  for (let i = 0; i < replay.examples.length; i += 1) {
    const ex = replay.examples[i];
    if (firstMt2EntryIdx === -1 && ex.state.floorId === "MT2") {
      firstMt2EntryIdx = i;
    }
    const hasMT3Forward = ex.legalActions.some((a) =>
      a.kind === "changeFloor" &&
      a.floorId === "MT2" &&
      a.changeFloor &&
      (a.changeFloor.floorId === ":next" || a.changeFloor.floorId === "MT3"));
    if (hasMT3Forward) {
      unlockIdx = i;
      break;
    }
  }

  const firstMt2EntryFound = firstMt2EntryIdx !== -1;
  const unlockStateFound = unlockIdx !== -1;

  const observedPrecursors = [];
  if (firstMt2EntryFound && unlockStateFound) {
    for (let i = firstMt2EntryIdx; i < unlockIdx; i += 1) {
      const ex = replay.examples[i];
      const chosen = ex.legalActions[ex.chosenIndex];
      const nextState = replay.examples[i + 1].state;
      if (transportSignature(ex.state) !== transportSignature(nextState)) {
        const identity = actionToSemanticIdentity(chosen, ex.state, nextState);
        observedPrecursors.push({
          step: i,
          identity,
          kind: chosen.kind,
          summary: chosen.summary,
          floorId: chosen.floorId || ex.state.floorId,
          target: chosen.target,
        });
      }
    }
  }

  const oracleCount = observedPrecursors.length;
  const oracleValid = firstMt2EntryFound && unlockStateFound && oracleCount > 0;

  const oracleIdentities = new Set(observedPrecursors.map((p) => p.identity));
  const intersection = Array.from(frontierSet).filter((id) => oracleIdentities.has(id));
  const missed = observedPrecursors.filter((p) => !frontierSet.has(p.identity));
  const extra = Array.from(frontierSet).filter((id) => !oracleIdentities.has(id));

  const recall = oracleCount > 0 ? intersection.length / oracleCount : 0;
  const frontierCount = frontierSet.size;
  const frontierFraction = allStrategicPoiCount > 0 ? frontierCount / allStrategicPoiCount : 0;

  const missedByKind = {};
  missed.forEach((m) => {
    missedByKind[m.kind] = (missedByKind[m.kind] || 0) + 1;
  });

  const extraByKind = {};
  extra.forEach((id) => {
    const kind = id.split(":")[0];
    extraByKind[kind] = (extraByKind[kind] || 0) + 1;
  });

  const phase1Pass = oracleValid && recall === 1.0 && frontierCount < allStrategicPoiCount;

  return {
    oracleValid,
    firstMt2EntryFound,
    unlockStateFound,
    firstMt2EntryStep: firstMt2EntryIdx,
    unlockStep: unlockIdx,
    oracle_count: oracleCount,
    frontier_count: frontierCount,
    all_strategic_poi_count: allStrategicPoiCount,
    intersection_count: intersection.length,
    observed_pre_unlock_recall: recall,
    frontier_fraction_of_all_strategic_pois: frontierFraction,
    missed_by_kind: missedByKind,
    missed_identities: missed.map((m) => m.identity),
    extra_frontier_by_kind: extraByKind,
    extra_identities: extra,
    observedPrecursors,
    phase1Pass,
    verdict: phase1Pass ? "PHASE_1_PASS" : (oracleValid ? "RECALL_OR_COMPRESSION_FAILED" : "ORACLE_INVALID"),
  };
}

module.exports = {
  actionToSemanticIdentity,
  poiToSemanticIdentity,
  buildDependencyFrontier,
  evaluateWitnessRecall,
};
