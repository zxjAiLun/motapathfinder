"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { runAdaptiveSegmentPlanner } = require("./lib/adaptive-segment-planner");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { getMilestoneSpec } = require("./lib/milestone-spec");
const { loadProject } = require("./lib/project-loader");
const { buildSolverSnapshot } = require("./lib/route-snapshot");
const { buildDominanceKey } = require("./lib/state-key");
const { buildRouteRecord, createStateFromSnapshot, readRouteFile, writeRouteFile } = require("./lib/route-store");
const { StaticSimulator } = require("./lib/simulator");

const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");

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

function routeCachePath(routeFile) {
  return `${routeFile}.state-cache.json`;
}

function readReplayCache(routeFile, projectRoot, rank) {
  const cacheFile = routeCachePath(routeFile);
  if (!fs.existsSync(cacheFile)) return null;
  const routeStat = fs.statSync(routeFile);
  const cache = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  if (!cache || !cache.state || !cache.source) return null;
  if (cache.source.routeFile !== routeFile) return null;
  if (cache.source.projectRoot !== projectRoot) return null;
  if (cache.source.rank !== rank) return null;
  if (cache.source.traceVersion !== 2) return null;
  if (cache.source.size !== routeStat.size) return null;
  if (cache.source.mtimeMs !== routeStat.mtimeMs) return null;
  if (!Array.isArray(cache.state.routeTrace)) return null;
  return cache.state;
}

function writeReplayCache(routeFile, projectRoot, rank, state) {
  const routeStat = fs.statSync(routeFile);
  const cacheFile = routeCachePath(routeFile);
  fs.writeFileSync(cacheFile, `${JSON.stringify({
    schema: "motapathfinder.replay-state-cache.v1",
    createdAt: new Date().toISOString(),
    source: {
      routeFile,
      projectRoot,
      rank,
      size: routeStat.size,
      mtimeMs: routeStat.mtimeMs,
      traceVersion: 2,
    },
    state,
  })}\n`, "utf8");
}

function makeSimulator(project, args) {
  return new StaticSimulator(project, {
    stopFloorId: args["stop-floor"] || "MT11",
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
  try {
    if (typeof simulator.enumerateFloorFlyActions === "function") {
      actions.push(...(simulator.enumerateFloorFlyActions(state) || []));
    }
  } catch (error) {
  }
  return actions.find((action) => action.summary === summary) || null;
}

function buildTraceSnapshot(project, state) {
  if (!state) return null;
  const snapshot = buildSolverSnapshot(project, state, { floorIds: [state.floorId].filter(Boolean) });
  snapshot.partial = true;
  return snapshot;
}

function decisionTraceEntry(project, decision, preState, postState) {
  return {
    actionEntry: decision,
    preSnapshot: preState ? buildTraceSnapshot(project, preState) : (decision.preSnapshot || null),
    postSnapshot: postState ? buildTraceSnapshot(project, postState) : (decision.postSnapshot || null),
    preStateKey: preState ? buildDominanceKey(preState) : (decision.preStateKey || null),
    postStateKey: postState ? buildDominanceKey(postState) : (decision.postStateKey || null),
  };
}

function replayRouteFile(simulator, routeFile, rank, useSnapshot, useCache, projectRoot) {
  const record = readRouteFile(routeFile);
  if (useSnapshot && record.final && record.final.snapshot) {
    const state = createStateFromSnapshot(simulator.project, record.final.snapshot, {
      rank: rank || "chaos",
      route: Array.isArray(record.rawRoute) ? record.rawRoute : [],
      decisionDepth: record.stats && record.stats.depth,
      notes: record.notes,
    });
    state.routeTrace = (record.decisions || []).map((decision) => decisionTraceEntry(simulator.project, decision, null, null));
    return state;
  }
  if (useCache) {
    const cached = readReplayCache(routeFile, projectRoot || "", rank || "chaos");
    if (cached) return cached;
  }
  let state = simulator.createInitialState({ rank: rank || "chaos" });
  let routeTrace = [];
  for (const decision of record.decisions || []) {
    const preState = state;
    const action = findAction(simulator, state, decision.summary);
    if (!action) throw new Error(`Unable to replay start route at ${decision.index}: ${decision.summary}`);
    if (Object.prototype.hasOwnProperty.call(state, "routeTrace")) delete state.routeTrace;
    state = simulator.applyAction(state, action);
    routeTrace = routeTrace.concat(decisionTraceEntry(simulator.project, decision, preState, state));
  }
  state.routeTrace = routeTrace;
  if (useCache) writeReplayCache(routeFile, projectRoot || "", rank || "chaos", state);
  return state;
}

function compactSegmentResult(segment) {
  return {
    segmentId: segment.segmentId,
    label: segment.label,
    found: segment.found,
    startCandidatesTried: segment.startCandidatesTried,
    candidateCount: (segment.candidates || []).length,
    failureClass: segment.failureClass || (segment.failurePropagation && segment.failurePropagation.failureClass),
    backtrack: segment.backtrack || null,
    candidates: (segment.candidates || []).map((candidate) => ({
      id: candidate.id,
      hero: candidate.hero,
      effectiveHero: candidate.effectiveHero,
      tags: candidate.tags,
      routeLength: candidate.routeLength,
    })),
  };
}

function guiCommand(projectRootArg, outPath) {
  const routePath = path.relative(__dirname, outPath).startsWith("..")
    ? outPath
    : path.relative(__dirname, outPath);
  return [
    "cd shared-solver",
    "node route-gui.js \\",
    `  --project-root="${projectRootArg}" \\`,
    `  --route-file=${routePath} \\`,
    "  --live=1 \\",
    "  --headless=0 \\",
    "  --runtime-auto-battle=1 \\",
    "  --runtime-auto-pickup=1",
  ].join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRootArg = args["project-root"] || "../Only upV2.1/Only upV2.1";
  const projectRoot = path.resolve(projectRootArg);
  const rank = args.rank || "chaos";
  const project = loadProject(projectRoot);
  const simulator = makeSimulator(project, args);
  const routeName = args["route-name"] || "onlyup-chaos-mt5-blueking";
  const spec = getMilestoneSpec(project, routeName);
  const startRoute = args["start-route"] ? path.resolve(args["start-route"]) : null;
  const initialState = startRoute
    ? replayRouteFile(
      simulator,
      startRoute,
      rank,
      parseBoolean(args["start-route-snapshot"], false),
      parseBoolean(args["start-route-cache"], true),
      projectRoot
    )
    : simulator.createInitialState({ rank });
  const result = runAdaptiveSegmentPlanner(simulator, initialState, spec, {
    fromMilestoneId: args["from-milestone"] || null,
    toMilestoneId: args["to-milestone"] || null,
    candidateLimit: optionalNumber(args["candidate-limit"]) || 8,
    dpKeyMode: args["dp-key-mode"] || null,
    maxExpansions: optionalNumber(args["max-expansions"]),
    maxRuntimeMs: optionalNumber(args["max-runtime-ms"]),
    stopOnFirstGoal: args["stop-on-first-goal"] == null ? null : parseBoolean(args["stop-on-first-goal"], false),
    maxAdaptiveRepairs: optionalNumber(args["max-adaptive-repairs"]) ?? 2,
    repairActionCandidates: optionalNumber(args["repair-action-candidates"]) || 8,
    repairTileCandidates: optionalNumber(args["repair-tile-candidates"]) || 6,
    repairIntentRecords: optionalNumber(args["repair-intent-records"]) || null,
    repairRecordsPerIntent: optionalNumber(args["repair-records-per-intent"]) || null,
    repairMaxIntents: optionalNumber(args["repair-max-intents"]) || null,
    repairBranchLimit: optionalNumber(args["repair-branch-limit"]) || 3,
    intentDepth: optionalNumber(args["intent-depth"]) || 3,
    intentNodeLimit: optionalNumber(args["intent-node-limit"]) || optionalNumber(args["max-intent-nodes"]) || 120,
    battleThresholds: parseBoolean(args["battle-thresholds"], true),
    repairMaxExpansions: optionalNumber(args["repair-max-expansions"]) || 2500,
    repairMaxRuntimeMs: optionalNumber(args["repair-max-runtime-ms"]) || 10000,
    repairGoalSkylineLimit: optionalNumber(args["repair-goal-skyline-limit"]) || optionalNumber(args["candidate-limit"]) || 8,
    repairRollbackSegments: optionalNumber(args["repair-rollback-segments"]) || null,
    windowRepairMaxExpansions: optionalNumber(args["window-repair-max-expansions"]) || null,
    windowRepairMaxRuntimeMs: optionalNumber(args["window-repair-max-runtime-ms"]) || null,
    windowRepairKeyMode: args["window-repair-key-mode"] || null,
    windowRepairPriorityMode: args["window-repair-priority-mode"] || null,
    enableWindowRepair: parseBoolean(args["window-repair"], true),
    enableFailureBacktracking: parseBoolean(args["failure-backtracking"], true),
    backtrackCandidateLimit: optionalNumber(args["backtrack-candidate-limit"]) || null,
    backtrackMaxExpansions: optionalNumber(args["backtrack-max-expansions"]) || null,
    backtrackMaxRuntimeMs: optionalNumber(args["backtrack-max-runtime-ms"]) || null,
  });
  const summary = {
    routeName,
    found: result.found,
    reachedMilestone: result.reachedMilestone,
    failedSegmentId: result.failedSegment && result.failedSegment.segmentId,
    completedSegments: (result.segmentResults || []).filter((segment) => segment.found).map((segment) => segment.segmentId),
    insertedSegments: ((result.adaptive || {}).insertedSegments || []).map((segment) => ({
      id: segment.id,
      label: segment.label,
      generatedBy: segment.generatedBy,
      goal: segment.goal,
    })),
    attempts: (result.adaptive || {}).attempts || [],
    segments: (result.segmentResults || []).map(compactSegmentResult),
  };
  console.log(JSON.stringify(summary, null, 2));

  const out = args.out ? path.resolve(args.out) : null;
  if (out && result.found && result.finalCandidate && result.finalCandidate.state) {
    const finalState = result.finalCandidate.state;
    finalState.route = Array.isArray(result.finalCandidate.route) ? result.finalCandidate.route.slice() : finalState.route;
    finalState.routeTrace = Array.isArray(result.finalCandidate.trace) ? result.finalCandidate.trace.slice() : finalState.routeTrace;
    const routeRecord = buildRouteRecord({
      project,
      simulator,
      finalState,
      options: {
        projectRoot,
        solver: "adaptive-segment-dp",
        profile: routeName,
        rank,
        toFloor: finalState.floorId,
        goalType: "adaptive-milestone",
        metadata: {
          kind: "adaptive-segment-dp",
          adaptiveSegmentDp: {
            routeName,
            finalMilestoneId: result.reachedMilestone,
            completedSegments: summary.completedSegments,
            insertedSegments: summary.insertedSegments,
            attempts: summary.attempts,
            repairBranches: ((result.adaptive || {}).repairBranches || []),
            selectedBranch: (result.adaptive || {}).selectedBranch,
            candidateIds: (result.finalCandidates || []).map((candidate) => candidate.id),
          },
        },
      },
    });
    writeRouteFile(out, routeRecord);
    console.log(`Route written: ${out}`);
    console.log("GUI replay:");
    console.log(guiCommand(projectRootArg, out));
  }
  if (args["save-effective-spec"] && result.effectiveSpec) {
    const specOut = path.resolve(args["save-effective-spec"]);
    fs.mkdirSync(path.dirname(specOut), { recursive: true });
    fs.writeFileSync(specOut, `${JSON.stringify(result.effectiveSpec, null, 2)}\n`, "utf8");
    console.log(`Effective spec written: ${specOut}`);
  }
  if (result.failedSegment && parseBoolean(args["print-failures"], true)) {
    console.log(`Segment failure: ${JSON.stringify(result.failedSegment, null, 2)}`);
  }
}

main();
