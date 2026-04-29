"use strict";

const { loadProject } = require("./lib/project-loader");
const {
  cloneState,
  createInitialState,
} = require("./lib/state");
const { StaticSimulator } = require("./lib/simulator");
const {
  buildDpStateKey,
  searchDP,
} = require("./lib/dp-search");
const {
  buildSegmentActionProvider,
  buildSegmentGoalPredicate,
  runMilestoneGraph,
  searchSegmentDP,
  summarizeSegmentFailure,
} = require("./lib/segment-dp");
const { runAdaptiveSegmentPlanner } = require("./lib/adaptive-segment-planner");
const {
  buildRegionMilestoneSpec,
  buildRegionProofClaim,
  loadRegionSpec,
  normalizeRegionSpec,
  validateRegionSpec,
} = require("./lib/region-spec");
const {
  buildRouteRecord,
  readRouteFile,
  writeRouteFile,
} = require("./lib/route-store");
const { ReplaySession } = require("./lib/replay-session");
const { replayRouteRecordLive } = require("./lib/live-replay");

const PUBLIC_API_VERSION = "motapathfinder-public.v1";

function createSimulator(project, options) {
  return new StaticSimulator(project, options);
}

function enumerateActions(simulator, state, options) {
  return simulator.enumerateActions(state, options);
}

function applyAction(simulator, state, action, options) {
  return simulator.applyAction(state, action, options);
}

async function verifyRouteLive(routeRecordOrFile, options) {
  const routeRecord = typeof routeRecordOrFile === "string"
    ? readRouteFile(routeRecordOrFile)
    : routeRecordOrFile;
  return replayRouteRecordLive(routeRecord, options);
}

module.exports = {
  PUBLIC_API_VERSION,

  loadProject,
  createSimulator,
  createInitialState,
  cloneState,
  enumerateActions,
  applyAction,

  buildDpStateKey,
  buildRouteRecord,
  readRouteFile,
  writeRouteFile,

  searchDP,
  searchSegmentDP,
  runSegmentDP: searchSegmentDP,
  runMilestoneGraph,
  runAdaptiveSegmentPlanner,
  loadRegionSpec,
  normalizeRegionSpec,
  validateRegionSpec,
  buildRegionMilestoneSpec,
  buildRegionProofClaim,
  buildSegmentActionProvider,
  buildSegmentGoalPredicate,
  summarizeSegmentFailure,

  ReplaySession,
  verifyRouteLive,
  replayRouteRecordLive,
};
