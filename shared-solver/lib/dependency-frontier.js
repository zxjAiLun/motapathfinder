"use strict";

/**
 * PR-5.25n — Frontier-Conditioned Resource-State Skyline Search.
 *
 * PROTOCOL BOUNDARIES:
 *   1. ZERO_AUTHORED_TARGET_COORDINATES = TRUE
 *      No corridor floors, no startNodeId, no goalNodeId, no MT2, no 6,0 or 6,12
 *      are passed as inputs.
 *      Only initialState (e.g. CHAOS MT1) and terminalGoal ({ type: "floorReached", floorId: "MT3" })
 *      are provided.
 *   2. TARGET_TRANSITION_DISCOVERY = DERIVED_FROM_PROJECT_AND_TERMINAL_GOAL
 *      Floor envelope MT1->MT2->MT3 and target transitions entering terminalGoal
 *      are derived strictly and automatically via buildPlanningFloorEnvelope() and
 *      buildFloorTransitionGraph(). Supports multiple target transitions by unioning.
 *   3. PRE_GOAL_STRATEGIC_UNIVERSE = EXCLUDES_POST_GOAL_TARGET_FLOOR_CONTENT
 *      ALL_STRATEGIC_POIS includes all strategic nodes on envelope floors before
 *      the terminal floor, plus the terminal transitions themselves and corridor mutations.
 *      Post-goal target floor content is excluded from the compression denominator.
 *   4. DYNAMIC_RELATIVE_FLOOR_RESOLUTION = TRUE
 *      All relative floor transitions (:next / :before) are resolved dynamically
 *      via resolveRelativeFloor(project, ...). No hardcoded floor mappings.
 *   5. UNIFIED_MUTATION_IDENTITY = TRUE
 *      Mutations consistently use mutation:hook:floorId:at.
 *   6. BOUNDED_ALTERNATIVE_DEPENDENCY_PATHS = TRUE
 *      Frontier is formed by the union of prerequisites from bounded alternative
 *      paths to the discovered target transition(s) and intermediate corridor resources,
 *      replacing distance slack.
 *   7. WITNESS_IS_EVALUATOR_ONLY = TRUE
 *      The witness route is opened ONLY after the frontier is constructed and frozen.
 */

const { buildFloorTransitionGraph, buildPlanningFloorEnvelope, buildAutomaticMacroGraph } = require("./automatic-macro-graph");
const { distinctAlternativePaths } = require("./automatic-dependency-planner");
const { actionToSemanticIdentity, poiToSemanticIdentity, transportSignature } = require("./transport-collapse");
const { readRouteRecord, replayRoute } = require("./learned-prior-dataset");

/**
 * Autonomous route-free construction of strategic universe and dependency frontier.
 *
 * Signature: buildDependencyFrontier(project, initialState, terminalGoal, options)
 */
function buildDependencyFrontier(project, initialState, terminalGoal, options) {
  const config = options || {};
  if (!project || !initialState || !terminalGoal) {
    throw new Error("buildDependencyFrontier requires project, initialState, and terminalGoal");
  }

  // --- 1. Autonomous Floor Envelope Discovery ---
  const envelope = buildPlanningFloorEnvelope(project, initialState, terminalGoal.floorId);
  const floorIds = envelope.floorIds;
  const floorSet = new Set(floorIds);
  const preGoalFloorSet = new Set(floorIds.filter((f) => f !== terminalGoal.floorId));

  // --- 2. Autonomous Target Transition Discovery ---
  const transitionGraph = buildFloorTransitionGraph(project);
  const targetTransitions = transitionGraph.edges.filter((edge) =>
    edge.targetFloorId === terminalGoal.floorId && preGoalFloorSet.has(edge.floorId));

  if (targetTransitions.length === 0) {
    throw new Error(`No static floor transition enters target ${terminalGoal.floorId} from pre-goal envelope [${Array.from(preGoalFloorSet).join(", ")}]`);
  }

  const derivedTargetPoiIdentities = targetTransitions.map((t) => {
    const [x, y] = t.at.split(",").map(Number);
    return poiToSemanticIdentity({
      floorId: t.floorId,
      x,
      y,
      kind: "changeFloor",
      transition: t.transition,
    }, project);
  });

  // --- 3. Build Automatic Macro Graph ---
  const macroGraph = buildAutomaticMacroGraph(project, initialState, terminalGoal, config);

  // --- 4. Pre-Goal Strategic Universe (enemy, door, item, changeFloor, event, mutation) ---
  // Excludes post-goal target floor content from the compression denominator.
  const strategicKinds = new Set(["enemy", "door", "item", "changeFloor", "event"]);
  const allStrategicPoisSet = new Set();

  for (const node of macroGraph.nodes) {
    if (node.floorId && preGoalFloorSet.has(node.floorId) && strategicKinds.has(node.kind)) {
      allStrategicPoisSet.add(poiToSemanticIdentity(node, project));
    } else if (node.kind === "mutation" && node.floorId && preGoalFloorSet.has(node.floorId)) {
      allStrategicPoisSet.add(poiToSemanticIdentity(node, project));
    }
  }

  // Also include the terminal transition(s) themselves in the pre-goal strategic universe
  for (const tid of derivedTargetPoiIdentities) {
    allStrategicPoisSet.add(tid);
  }

  const allStrategicPois = Array.from(allStrategicPoisSet).sort();

  // --- 5. Bounded Alternative Dependency Paths (Union over all target transitions & resources) ---
  const frontierSet = new Set();
  const alternativeLimit = config.alternativeLimit == null ? 20 : config.alternativeLimit;
  let totalAlternativePaths = 0;

  // 5a. Alternative paths from source:initial to EVERY discovered target transition
  for (const t of targetTransitions) {
    const targetPoiId = `${t.floorId}:changeFloor:${t.at}`;
    const targetPaths = distinctAlternativePaths(project, initialState, macroGraph, "source:initial", targetPoiId, alternativeLimit);
    totalAlternativePaths += targetPaths.length;
    targetPaths.forEach((p) => {
      p.path.filter((id) => !id.includes("component") && !id.startsWith("source:") && !id.startsWith("goal:"))
        .forEach((id) => {
          const node = macroGraph.nodes.find((n) => n.id === id);
          if (node) frontierSet.add(poiToSemanticIdentity(node, project));
        });
    });
  }

  // 5b. Alternative paths to resource targets on all intermediate pre-goal floors
  const resourceNodes = macroGraph.nodes.filter((n) =>
    preGoalFloorSet.has(n.floorId) && n.floorId !== initialState.floorId && n.kind === "item");
  resourceNodes.forEach((rn) => {
    const rPaths = distinctAlternativePaths(project, initialState, macroGraph, "source:initial", rn.id, 6);
    rPaths.forEach((p) => {
      p.path.filter((id) => !id.includes("component") && !id.startsWith("source:") && !id.startsWith("goal:"))
        .forEach((id) => {
          const node = macroGraph.nodes.find((n) => n.id === id);
          if (node) frontierSet.add(poiToSemanticIdentity(node, project));
        });
    });
  });

  // 5c. Dynamic return transitions between envelope floors (resource detours)
  const returnEdges = transitionGraph.edges.filter((e) =>
    preGoalFloorSet.has(e.floorId) &&
    preGoalFloorSet.has(e.targetFloorId) &&
    e.targetFloorId !== terminalGoal.floorId);
  returnEdges.forEach((re) => {
    const [rx, ry] = re.at.split(",").map(Number);
    frontierSet.add(`changeFloor:${re.floorId}:${rx},${ry}->${re.targetFloorId}`);
  });

  const frontier = Array.from(frontierSet).sort();

  return {
    targetTransitionDiscovery: "DERIVED_FROM_PROJECT_AND_TERMINAL_GOAL",
    noAuthoredTargetCoordinate: true,
    derivedFloorEnvelope: floorIds,
    derivedPreGoalFloors: Array.from(preGoalFloorSet),
    derivedTargetTransitions: targetTransitions,
    derivedTargetPoiIdentities,
    allStrategicPois,
    allStrategicPoiCount: allStrategicPois.length,
    frontierSet,
    frontier,
    frontierCount: frontier.length,
    alternativePathsCount: totalAlternativePaths,
  };
}

/**
 * Phase 1 evaluation: witness recall scoring against the frozen frontier.
 *
 * REPLAY PROTOCOL:
 *   1. Replay witnessRouteRecord strictly with learned-prior-dataset.replayRoute.
 *   2. Identify firstEntry: first replay state on intermediate floor.
 *   3. Identify unlockState: first replay state where legal forward changeFloor to goal exists.
 *   4. Extract OBSERVED_PRE_UNLOCK_STATE_CHANGES: actions between firstEntry and unlockState
 *      where transportSignature(pre) !== transportSignature(post).
 *   5. Match against frozen frontierSet via semantic POI identity.
 */
function evaluateWitnessRecall(project, witnessRelPath, frontierSet, allStrategicPoiCount, intermediateFloorId, goalFloorId) {
  const targetIntermediate = intermediateFloorId || "MT2";
  const targetGoal = goalFloorId || "MT3";

  const entry = readRouteRecord(witnessRelPath);
  const replay = replayRoute(entry, project);

  let firstEntryIdx = -1;
  let unlockIdx = -1;

  for (let i = 0; i < replay.examples.length; i += 1) {
    const ex = replay.examples[i];
    if (firstEntryIdx === -1 && ex.state.floorId === targetIntermediate) {
      firstEntryIdx = i;
    }
    const hasGoalForward = ex.legalActions.some((a) =>
      a.kind === "changeFloor" &&
      a.floorId === targetIntermediate &&
      a.changeFloor &&
      (a.changeFloor.floorId === ":next" || a.changeFloor.floorId === targetGoal));
    if (hasGoalForward) {
      unlockIdx = i;
      break;
    }
  }

  const firstEntryFound = firstEntryIdx !== -1;
  const unlockStateFound = unlockIdx !== -1;

  const observedPrecursors = [];
  if (firstEntryFound && unlockStateFound) {
    for (let i = firstEntryIdx; i < unlockIdx; i += 1) {
      const ex = replay.examples[i];
      const chosen = ex.legalActions[ex.chosenIndex];
      const nextState = replay.examples[i + 1].state;
      if (transportSignature(ex.state) !== transportSignature(nextState)) {
        const identity = actionToSemanticIdentity(chosen, ex.state, nextState, project);
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
  const oracleValid = firstEntryFound && unlockStateFound && oracleCount > 0;

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
    firstEntryFound,
    unlockStateFound,
    targetIntermediate,
    targetGoal,
    firstEntryStep: firstEntryIdx,
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
  buildDependencyFrontier,
  evaluateWitnessRecall,
};
