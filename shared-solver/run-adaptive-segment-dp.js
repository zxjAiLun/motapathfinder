"use strict";

const path = require("node:path");

const { runAdaptiveSegmentPlanner } = require("./lib/adaptive-segment-planner");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { getMilestoneSpec } = require("./lib/milestone-spec");
const { loadProject } = require("./lib/project-loader");
const { buildRouteRecord, readRouteFile, writeRouteFile } = require("./lib/route-store");
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
  return (simulator.enumeratePrimitiveActions(state).actions || []).find((action) => action.summary === summary)
    || simulator.enumerateActions(state).find((action) => action.summary === summary)
    || null;
}

function replayRouteFile(simulator, routeFile, rank) {
  let state = simulator.createInitialState({ rank: rank || "chaos" });
  const record = readRouteFile(routeFile);
  for (const decision of record.decisions || []) {
    const action = findAction(simulator, state, decision.summary);
    if (!action) throw new Error(`Unable to replay start route at ${decision.index}: ${decision.summary}`);
    state = simulator.applyAction(state, action);
  }
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
    "  --headless=0",
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
    ? replayRouteFile(simulator, startRoute, rank)
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
    repairMaxExpansions: optionalNumber(args["repair-max-expansions"]) || 2500,
    repairMaxRuntimeMs: optionalNumber(args["repair-max-runtime-ms"]) || 10000,
    repairGoalSkylineLimit: optionalNumber(args["repair-goal-skyline-limit"]) || optionalNumber(args["candidate-limit"]) || 8,
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
  if (result.failedSegment && parseBoolean(args["print-failures"], true)) {
    console.log(`Segment failure: ${JSON.stringify(result.failedSegment, null, 2)}`);
  }
}

main();
