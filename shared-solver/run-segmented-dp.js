"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { getMilestoneSpec } = require("./lib/milestone-spec");
const { loadProject } = require("./lib/project-loader");
const { buildSolverSnapshot } = require("./lib/route-snapshot");
const {
  buildRouteRecord,
  readRouteFile,
  writeRouteFile,
} = require("./lib/route-store");
const { runMilestoneGraph } = require("./lib/segment-dp");
const { buildSolverDoctorReport } = require("./lib/solver-doctor");
const { StaticSimulator } = require("./lib/simulator");
const { buildDominanceKey } = require("./lib/state-key");
const {
  loadStartState,
  summarizeStartState,
} = require("./lib/start-state-loader");

const DEFAULT_PROJECT_ROOT = path.resolve(
  __dirname,
  "..",
  "Only upV2.1",
  "Only upV2.1",
);

function parseArgs(argv) {
  return argv.reduce((result, arg) => {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) result[match[1]] = match[2];
    return result;
  }, {});
}

function parseBoolean(value, fallback) {
  if (value == null) return fallback;
  if (value === "1" || value === "true" || value === "on") return true;
  if (value === "0" || value === "false" || value === "off") return false;
  return fallback;
}

function optionalNumber(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function makeSimulator(project) {
  return new StaticSimulator(project, {
    stopFloorId: "MT6",
    battleResolver: new FunctionBackedBattleResolver(project),
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFightToLevelUp: false,
    enableResourcePocket: false,
    enableResourceCluster: false,
    enableResourceChain: false,
    searchGraphMode: "primitive",
  });
}

function findAction(simulator, state, summary) {
  const actions = [];
  try {
    actions.push(...(simulator.enumeratePrimitiveActions(state).actions || []));
  } catch (error) {}
  try {
    actions.push(...(simulator.enumerateActions(state) || []));
  } catch (error) {}
  try {
    if (typeof simulator.enumerateInteractPickupActions === "function") {
      actions.push(...(simulator.enumerateInteractPickupActions(state) || []));
    }
  } catch (error) {}
  try {
    if (typeof simulator.enumerateFloorFlyActions === "function") {
      actions.push(...(simulator.enumerateFloorFlyActions(state) || []));
    }
  } catch (error) {}
  return actions.find((action) => action.summary === summary) || null;
}

function buildTraceSnapshot(project, state) {
  if (!state) return null;
  const snapshot = buildSolverSnapshot(project, state, {
    floorIds: [state.floorId].filter(Boolean),
  });
  snapshot.partial = true;
  return snapshot;
}

function decisionTraceEntry(project, decision, preState, postState) {
  return {
    actionEntry: decision,
    preSnapshot: preState
      ? buildTraceSnapshot(project, preState)
      : decision.preSnapshot || null,
    postSnapshot: postState
      ? buildTraceSnapshot(project, postState)
      : decision.postSnapshot || null,
    preStateKey: preState
      ? buildDominanceKey(preState)
      : decision.preStateKey || null,
    postStateKey: postState
      ? buildDominanceKey(postState)
      : decision.postStateKey || null,
  };
}

function replayRouteFile(simulator, routeFile, options) {
  const config = options || {};
  const maxDecisions = optionalNumber(config.maxDecisions);
  let state = simulator.createInitialState({ rank: "chaos" });
  let routeTrace = [];
  const record = readRouteFile(routeFile);
  const decisions = (record.decisions || []).slice(
    0,
    maxDecisions == null ? undefined : maxDecisions,
  );
  for (const decision of decisions) {
    const preState = state;
    const action = findAction(simulator, state, decision.summary);
    if (!action)
      throw new Error(
        `Unable to replay start route at ${decision.index}: ${decision.summary}`,
      );
    if (Object.prototype.hasOwnProperty.call(state, "routeTrace"))
      delete state.routeTrace;
    state = simulator.applyAction(state, action);
    routeTrace = routeTrace.concat(
      decisionTraceEntry(simulator.project, decision, preState, state),
    );
  }
  state.routeTrace = routeTrace;
  return state;
}

function compactSegmentResult(segment) {
  return {
    segmentId: segment.segmentId,
    label: segment.label,
    found: segment.found,
    startCandidatesTried: segment.startCandidatesTried,
    candidateCount: (segment.candidates || []).length,
    candidates: (segment.candidates || []).map((candidate) => ({
      id: candidate.id,
      hero: candidate.hero,
      effectiveHero: candidate.effectiveHero,
      tags: candidate.tags,
      routeLength: candidate.routeLength,
      resourceTiming: candidate.resourceTiming || null,
    })),
    attempts: (segment.attempts || []).map((attempt) => ({
      startCandidateId: attempt.startCandidateId,
      found: attempt.found,
      goalCount: attempt.goalCount,
      resourceTiming: attempt.diagnostics && attempt.diagnostics.dp
        ? attempt.diagnostics.dp.resourceTiming || { model: "off" }
        : { model: "off" },
    })),
    failurePropagation: segment.failurePropagation || null,
  };
}

function writeJsonFile(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function compactCandidate(candidate) {
  if (!candidate) return null;
  return {
    id: candidate.id || null,
    hero: candidate.hero || null,
    effectiveHero: candidate.effectiveHero || null,
    tags: candidate.tags || [],
    routeLength: candidate.routeLength || null,
    score: candidate.score || null,
  };
}

function buildSegmentedReport({
  args,
  projectRoot,
  routeName,
  spec,
  startRoute,
  startRouteStep,
  startStateFile,
  initialState,
  result,
  doctor,
  summary,
}) {
  return {
    kind: "segmented-dp-diagnosis",
    routeName,
    projectRoot,
    startRoute,
    startRouteStep,
    startStateFile,
    fromMilestone: args["from-milestone"] || null,
    toMilestone: args["to-milestone"] || null,
    found: result.found,
    reachedMilestone: result.reachedMilestone,
    failedSegmentId: result.failedSegment && result.failedSegment.segmentId,
    doctor: result.found ? null : doctor,
    initialState: {
      floorId: initialState.floorId,
      hero: initialState.hero,
      routeLength: Array.isArray(initialState.route) ? initialState.route.length : 0,
      traceLength: Array.isArray(initialState.routeTrace) ? initialState.routeTrace.length : 0,
    },
    dp: {
      candidateLimit: optionalNumber(args["candidate-limit"]) || 8,
      dpKeyMode: args["dp-key-mode"] || null,
      maxExpansions: optionalNumber(args["max-expansions"]),
      maxRuntimeMs: optionalNumber(args["max-runtime-ms"]),
      stopOnFirstGoal:
        args["stop-on-first-goal"] == null
          ? null
          : parseBoolean(args["stop-on-first-goal"], false),
      dpSkylineMax: optionalNumber(args["dp-skyline-max"]),
      preserveSkylineRoles: parseBoolean(args["preserve-skyline-roles"], false),
      goalSkylineLimit: optionalNumber(args["goal-skyline-limit"]),
      agendaMode: args["agenda-mode"] || null,
      fairnessEvery: optionalNumber(args["fairness-every"]),
      maxActionsPerState: optionalNumber(args["max-actions-per-state"]),
    },
    summary,
    milestones: (spec.milestones || []).map((milestone) => ({
      id: milestone.id,
      label: milestone.label,
      goal: milestone.goal,
      actionPolicy: milestone.actionPolicy,
      dp: milestone.dp,
    })),
    segmentResults: result.segmentResults || [],
    failedSegment: result.failedSegment || null,
    checkpoints: result.checkpointResults || [],
    finalCandidates: (result.finalCandidates || []).map(compactCandidate),
  };
}

function sanitizeFilePart(value) {
  return String(value || "checkpoint").replace(/[^A-Za-z0-9_.-]+/g, "_");
}

function routePrefixLength(initialState) {
  return Array.isArray((initialState || {}).route)
    ? initialState.route.length
    : 0;
}

function tracePrefixLength(initialState) {
  return Array.isArray((initialState || {}).routeTrace)
    ? initialState.routeTrace.length
    : 0;
}

function applyCandidateRouteFromStart(finalState, candidate, initialState) {
  const prefixLength = routePrefixLength(initialState);
  const tracePrefix = tracePrefixLength(initialState);
  finalState.route = Array.isArray(candidate.route)
    ? candidate.route.slice(prefixLength)
    : finalState.route;
  finalState.routeTrace = Array.isArray(candidate.trace)
    ? candidate.trace.slice(tracePrefix)
    : finalState.routeTrace;
}

function saveUniqueCheckpointRoutes({
  args,
  project,
  projectRoot,
  simulator,
  initialState,
  routeName,
  spec,
  result,
  rank,
}) {
  if (!parseBoolean(args["save-unique-checkpoints"], true)) return [];
  const checkpoints = (result.checkpointResults || []).filter(
    (checkpoint) => checkpoint.uniqueFeasibleRoute,
  );
  if (checkpoints.length === 0) return [];
  const checkpointDir = path.resolve(
    args["checkpoint-dir"] ||
      path.join("routes", "latest", "checkpoints", routeName),
  );
  const written = [];
  checkpoints.forEach((checkpoint) => {
    const candidate = checkpoint.candidates && checkpoint.candidates[0];
    if (!candidate || !candidate.state) return;
    const finalState = candidate.state;
    applyCandidateRouteFromStart(finalState, candidate, initialState);
    const filePath = path.join(
      checkpointDir,
      `${sanitizeFilePart(checkpoint.segmentId)}.route.json`,
    );
    const routeRecord = buildRouteRecord({
      project,
      simulator,
      initialState,
      finalState,
      options: {
        projectRoot,
        solver: "segmented-dp",
        profile: routeName,
        rank,
        toFloor: finalState.floorId,
        goalType: "milestone-checkpoint",
        metadata: {
          kind: "segmented-dp-checkpoint",
          segmentedDp: {
            routeName,
            milestoneIds: spec.milestones.map((milestone) => milestone.id),
            checkpointSegmentId: checkpoint.segmentId,
            uniqueFeasibleRoute: true,
            candidateId: candidate.id,
          },
        },
      },
    });
    writeRouteFile(filePath, routeRecord);
    written.push(filePath);
  });
  return written;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = path.resolve(
    args["project-root"] || DEFAULT_PROJECT_ROOT,
  );
  const project = loadProject(projectRoot);
  const simulator = makeSimulator(project);
  const routeName = args["route-name"] || "onlyup-chaos-mt5-blueking";
  const spec = getMilestoneSpec(project, routeName);
  const startStateFile = args["start-state"]
    ? path.resolve(args["start-state"])
    : null;
  const startRoute = args["start-route"]
    ? path.resolve(args["start-route"])
    : null;
  const startRouteStep = optionalNumber(args["start-route-step"]);
  if (startStateFile && startRoute) {
    throw new Error("Pass only one of --start-state or --start-route.");
  }
  const loadedStart = startStateFile
    ? loadStartState(project, startStateFile, { rank: args.rank || "chaos" })
    : null;
  const initialState = loadedStart
    ? loadedStart.state
    : startRoute
      ? replayRouteFile(simulator, startRoute, {
          maxDecisions: startRouteStep,
        })
      : simulator.createInitialState({ rank: args.rank || "chaos" });
  if (loadedStart) {
    console.log(`Start state: ${summarizeStartState(initialState)}`);
    console.log(`Start state file: ${loadedStart.file}`);
  }
  const result = runMilestoneGraph(simulator, initialState, spec, {
    fromMilestoneId: args["from-milestone"] || null,
    toMilestoneId: args["to-milestone"] || null,
    candidateLimit: optionalNumber(args["candidate-limit"]) || 8,
    dpKeyMode: args["dp-key-mode"] || null,
    maxExpansions: optionalNumber(args["max-expansions"]),
    maxRuntimeMs: optionalNumber(args["max-runtime-ms"]),
    stopOnFirstGoal:
      args["stop-on-first-goal"] == null
        ? null
        : parseBoolean(args["stop-on-first-goal"], false),
    dpSkylineMax: optionalNumber(args["dp-skyline-max"]),
    preserveSkylineRoles: parseBoolean(args["preserve-skyline-roles"], false),
    goalSkylineLimit: optionalNumber(args["goal-skyline-limit"]),
    agendaMode: args["agenda-mode"] || null,
    fairnessEvery: optionalNumber(args["fairness-every"]),
    maxActionsPerState: optionalNumber(args["max-actions-per-state"]),
    resourceTimingModel: args["resource-timing-model"] || "breakpoint-v1",
    resourceTimingTargetLimit: optionalNumber(args["resource-timing-target-limit"]) || 16,
    resourceTimingResourceLimit: optionalNumber(args["resource-timing-resource-limit"]) || 4,
    resourceTimingThresholdLimit: optionalNumber(args["resource-timing-threshold-limit"]) || 3,
    resourceTimingSkylineMax: optionalNumber(args["resource-timing-skyline-max"]) || 4,
    resourceTimingCalculateThresholds: parseBoolean(args["resource-timing-calculate-thresholds"], false),
  });
  const doctor = buildSolverDoctorReport(result);
  const summary = {
    routeName,
    found: result.found,
    reachedMilestone: result.reachedMilestone,
    failedSegmentId: result.failedSegment && result.failedSegment.segmentId,
    doctor: result.found ? null : doctor,
    completedSegments: result.segmentResults
      .filter((segment) => segment.found)
      .map((segment) => segment.segmentId),
    segments: result.segmentResults.map(compactSegmentResult),
    checkpoints: (result.checkpointResults || []).map((checkpoint) => ({
      segmentId: checkpoint.segmentId,
      uniqueFeasibleRoute: checkpoint.uniqueFeasibleRoute,
      candidateCount: checkpoint.candidateCount,
    })),
  };
  console.log(JSON.stringify(summary, null, 2));

  const report = args.report ? path.resolve(args.report) : null;
  if (report) {
    writeJsonFile(
      report,
      buildSegmentedReport({
        args,
        projectRoot,
        routeName,
        spec,
        startRoute,
        startRouteStep,
        startStateFile,
        initialState,
        result,
        doctor,
        summary,
      }),
    );
    console.log(`Report written: ${report}`);
  }

  const checkpointFiles = saveUniqueCheckpointRoutes({
    args,
    project,
    projectRoot,
    simulator,
    initialState,
    routeName,
    spec,
    result,
    rank: args.rank || "chaos",
  });
  checkpointFiles.forEach((filePath) =>
    console.log(`Checkpoint written: ${filePath}`),
  );

  const out = args.out ? path.resolve(args.out) : null;
  if (
    out &&
    result.found &&
    result.finalCandidate &&
    result.finalCandidate.state
  ) {
    const finalState = result.finalCandidate.state;
    applyCandidateRouteFromStart(finalState, result.finalCandidate, initialState);
    const routeRecord = buildRouteRecord({
      project,
      simulator,
      initialState,
      finalState,
      options: {
        projectRoot,
        solver: "segmented-dp",
        profile: routeName,
        rank: args.rank || "chaos",
        toFloor: finalState.floorId,
        goalType: "milestone",
        metadata: {
          kind: "segmented-dp",
          segmentedDp: {
            routeName,
            milestoneIds: spec.milestones.map((milestone) => milestone.id),
            finalMilestoneId: result.reachedMilestone,
            completedSegments: summary.completedSegments,
            segmentResults: summary.segments,
            candidateIds: (result.finalCandidates || []).map(
              (candidate) => candidate.id,
            ),
            dpKeyMode: args["dp-key-mode"] || "segment-default",
            stopOnFirstGoal:
              args["stop-on-first-goal"] == null
                ? false
                : parseBoolean(args["stop-on-first-goal"], false),
          },
        },
      },
    });
    writeRouteFile(out, routeRecord);
    console.log(`Route written: ${out}`);
  }
  if (result.failedSegment && parseBoolean(args["print-failures"], true)) {
    console.log(doctor.line);
    console.log(
      `Segment failure: ${JSON.stringify(result.failedSegment, null, 2)}`,
    );
  }
}

main();
