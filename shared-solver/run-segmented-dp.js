"use strict";

const path = require("node:path");

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { getMilestoneSpec } = require("./lib/milestone-spec");
const { loadProject } = require("./lib/project-loader");
const { buildRouteRecord, readRouteFile, writeRouteFile } = require("./lib/route-store");
const { runMilestoneGraph } = require("./lib/segment-dp");
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
  return (simulator.enumeratePrimitiveActions(state).actions || []).find((action) => action.summary === summary)
    || simulator.enumerateActions(state).find((action) => action.summary === summary)
    || null;
}

function replayRouteFile(simulator, routeFile) {
  let state = simulator.createInitialState({ rank: "chaos" });
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
    candidates: (segment.candidates || []).map((candidate) => ({
      id: candidate.id,
      hero: candidate.hero,
      effectiveHero: candidate.effectiveHero,
      tags: candidate.tags,
      routeLength: candidate.routeLength,
    })),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = path.resolve(args["project-root"] || DEFAULT_PROJECT_ROOT);
  const project = loadProject(projectRoot);
  const simulator = makeSimulator(project);
  const routeName = args["route-name"] || "onlyup-chaos-mt5-blueking";
  const spec = getMilestoneSpec(project, routeName);
  const startRoute = args["start-route"] ? path.resolve(args["start-route"]) : null;
  const initialState = startRoute
    ? replayRouteFile(simulator, startRoute)
    : simulator.createInitialState({ rank: args.rank || "chaos" });
  const result = runMilestoneGraph(simulator, initialState, spec, {
    fromMilestoneId: args["from-milestone"] || null,
    toMilestoneId: args["to-milestone"] || null,
    candidateLimit: optionalNumber(args["candidate-limit"]) || 8,
    dpKeyMode: args["dp-key-mode"] || null,
    maxExpansions: optionalNumber(args["max-expansions"]),
    maxRuntimeMs: optionalNumber(args["max-runtime-ms"]),
    stopOnFirstGoal: args["stop-on-first-goal"] == null ? null : parseBoolean(args["stop-on-first-goal"], false),
  });
  const summary = {
    routeName,
    found: result.found,
    reachedMilestone: result.reachedMilestone,
    failedSegmentId: result.failedSegment && result.failedSegment.segmentId,
    completedSegments: result.segmentResults.filter((segment) => segment.found).map((segment) => segment.segmentId),
    segments: result.segmentResults.map(compactSegmentResult),
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
            candidateIds: (result.finalCandidates || []).map((candidate) => candidate.id),
            dpKeyMode: args["dp-key-mode"] || "segment-default",
            stopOnFirstGoal: args["stop-on-first-goal"] == null ? false : parseBoolean(args["stop-on-first-goal"], false),
          },
        },
      },
    });
    writeRouteFile(out, routeRecord);
    console.log(`Route written: ${out}`);
  }
  if (result.failedSegment && parseBoolean(args["print-failures"], true)) {
    console.log(`Segment failure: ${JSON.stringify(result.failedSegment, null, 2)}`);
  }
}

main();
