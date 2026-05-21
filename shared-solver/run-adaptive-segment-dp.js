"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { runAdaptiveSegmentPlanner } = require("./lib/adaptive-segment-planner");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { getMilestoneSpec } = require("./lib/milestone-spec");
const { loadProject } = require("./lib/project-loader");
const { buildSolverSnapshot } = require("./lib/route-snapshot");
const { buildDominanceKey } = require("./lib/state-key");
const { buildRouteRecord, createStateFromSnapshot, fingerprintAction, readRouteFile, writeRouteFile } = require("./lib/route-store");
const { buildSolverDoctorReport } = require("./lib/solver-doctor");
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

function readReplayCache(routeFile, projectRoot, rank, captureTrace) {
  const cacheFile = routeCachePath(routeFile);
  if (!fs.existsSync(cacheFile)) return null;
  const routeStat = fs.statSync(routeFile);
  const cache = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  if (!cache || !cache.state || !cache.source) return null;
  if (cache.source.routeFile !== routeFile) return null;
  if (cache.source.projectRoot !== projectRoot) return null;
  if (cache.source.rank !== rank) return null;
  const expectedTraceVersion = captureTrace ? 2 : 3;
  if (cache.source.traceVersion !== expectedTraceVersion) return null;
  if (cache.source.size !== routeStat.size) return null;
  if (cache.source.mtimeMs !== routeStat.mtimeMs) return null;
  if (captureTrace && !Array.isArray(cache.state.routeTrace)) return null;
  return cache.state;
}

function writeReplayCache(routeFile, projectRoot, rank, state, captureTrace) {
  const routeStat = fs.statSync(routeFile);
  const cacheFile = routeCachePath(routeFile);
  const cacheState = captureTrace
    ? state
    : (() => {
      const cloned = JSON.parse(JSON.stringify(state));
      delete cloned.routeTrace;
      return cloned;
    })();
  fs.writeFileSync(cacheFile, `${JSON.stringify({
    schema: "motapathfinder.replay-state-cache.v1",
    createdAt: new Date().toISOString(),
    source: {
      routeFile,
      projectRoot,
      rank,
      size: routeStat.size,
      mtimeMs: routeStat.mtimeMs,
      traceVersion: captureTrace ? 2 : 3,
    },
    state: cacheState,
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

function samePath(left, right) {
  const leftPath = Array.isArray(left) ? left : [];
  const rightPath = Array.isArray(right) ? right : [];
  if (leftPath.length !== rightPath.length) return false;
  for (let index = 0; index < leftPath.length; index += 1) {
    if (leftPath[index] !== rightPath[index]) return false;
  }
  return true;
}

function replayActionScore(simulator, state, action, expected) {
  const summary = typeof expected === "string" ? expected : expected && expected.summary;
  let score = action && action.summary === summary ? 1000000 : 0;
  if (!action || !expected || typeof expected === "string") return score;
  let fingerprint = null;
  try {
    fingerprint = fingerprintAction(action);
  } catch (error) {
    fingerprint = action.fingerprint || null;
  }
  if (expected.fingerprint && fingerprint === expected.fingerprint) score += 500000;
  if (expected.kind && action.kind === expected.kind) score += 100000;
  if (samePath(action.path, expected.path)) score += 50000;
  if (expected.floorId && action.floorId === expected.floorId) score += 10000;
  if (expected.target && action.target && expected.target.x === action.target.x && expected.target.y === action.target.y) score += 10000;
  if (expected.stance && action.stance && expected.stance.x === action.stance.x && expected.stance.y === action.stance.y) score += 5000;
  if (expected.direction && action.direction === expected.direction) score += 1000;
  if (expected.enemyId && action.enemyId === expected.enemyId) score += 1000;
  if (expected.itemId && action.itemId === expected.itemId) score += 1000;
  if (expected.doorId && action.doorId === expected.doorId) score += 1000;
  if (expected.targetFloorId && action.targetFloorId === expected.targetFloorId) score += 1000;
  if (expected.postStateKey) {
    try {
      const postState = simulator.applyAction(state, action, { storeRoute: false });
      if (buildDominanceKey(postState) === expected.postStateKey) score += 1000000;
    } catch (error) {
      score -= 1000000;
    }
  }
  return score;
}

function findAction(simulator, state, expected) {
  const summary = typeof expected === "string" ? expected : expected && expected.summary;
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
  const matching = actions.filter((action) => action && action.summary === summary);
  if (matching.length <= 1) return matching[0] || null;
  return matching
    .map((action) => ({ action, score: replayActionScore(simulator, state, action, expected) }))
    .sort((left, right) => right.score - left.score)[0].action;
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

function replayRouteFile(simulator, routeFile, rank, useSnapshot, useCache, projectRoot, captureTrace) {
  const keepTrace = captureTrace === true;
  const record = readRouteFile(routeFile);
  if (useSnapshot && record.final && record.final.snapshot) {
    const state = createStateFromSnapshot(simulator.project, record.final.snapshot, {
      rank: rank || "chaos",
      route: Array.isArray(record.rawRoute) ? record.rawRoute : [],
      decisionDepth: record.stats && record.stats.depth,
      notes: record.notes,
    });
    if (keepTrace) state.routeTrace = (record.decisions || []).map((decision) => decisionTraceEntry(simulator.project, decision, null, null));
    return state;
  }
  if (useCache) {
    const cached = readReplayCache(routeFile, projectRoot || "", rank || "chaos", keepTrace);
    if (cached) return cached;
  }
  let state = simulator.createInitialState({ rank: rank || "chaos" });
  let routeTrace = [];
  for (const decision of record.decisions || []) {
    const preState = state;
    const action = findAction(simulator, state, decision);
    if (!action) throw new Error(`Unable to replay start route at ${decision.index}: ${decision.summary}`);
    if (Object.prototype.hasOwnProperty.call(state, "routeTrace")) delete state.routeTrace;
    state = simulator.applyAction(state, action);
    if (keepTrace) routeTrace = routeTrace.concat(decisionTraceEntry(simulator.project, decision, preState, state));
  }
  if (keepTrace) state.routeTrace = routeTrace;
  else if (Object.prototype.hasOwnProperty.call(state, "routeTrace")) delete state.routeTrace;
  if (useCache) writeReplayCache(routeFile, projectRoot || "", rank || "chaos", state, keepTrace);
  return state;
}

function replaySummaries(simulator, startState, summaries) {
  let state = JSON.parse(JSON.stringify(startState));
  for (const [index, summary] of (summaries || []).entries()) {
    const action = findAction(simulator, state, summary);
    if (!action) throw new Error(`Unable to replay quality baseline at ${index + 1}: ${summary}`);
    if (Object.prototype.hasOwnProperty.call(state, "routeTrace")) delete state.routeTrace;
    state = simulator.applyAction(state, action);
  }
  if (Object.prototype.hasOwnProperty.call(state, "routeTrace")) delete state.routeTrace;
  return state;
}

function heroQualityFloor(state) {
  const hero = (state && state.hero) || {};
  return {
    hp: Number(hero.hp || 0),
    atk: Number(hero.atk || 0),
    def: Number(hero.def || 0),
    mdef: Number(hero.mdef || 0),
    lv: Number(hero.lv || 0),
    exp: Number(hero.exp || 0),
  };
}

function loadQualityBaseline(simulator, baselineArg, rank, projectRoot) {
  if (!baselineArg) return null;
  const baselineFile = path.isAbsolute(baselineArg)
    ? baselineArg
    : path.resolve(__dirname, baselineArg);
  const fixture = JSON.parse(fs.readFileSync(baselineFile, "utf8"));
  if (fixture.schema !== "motapathfinder.baseline-route.v1") {
    throw new Error(`Unsupported quality baseline schema: ${fixture.schema || "missing"}`);
  }
  const startRoute = path.isAbsolute(fixture.startRoute || "")
    ? fixture.startRoute
    : path.resolve(__dirname, fixture.startRoute || "");
  const startState = replayRouteFile(simulator, startRoute, rank, false, true, projectRoot, false);
  const finalState = replaySummaries(simulator, startState, fixture.route || []);
  return {
    label: fixture.label || fixture.id || path.basename(baselineFile),
    floorId: (fixture.target && fixture.target.floorId) || finalState.floorId,
    minHero: heroQualityFloor(finalState),
    mustReachSameFloor: !fixture.compare || fixture.compare.mustReachSameFloor !== false,
    mustNotLoseFields: (fixture.compare && fixture.compare.mustNotLoseFields) || ["hp", "atk", "def", "mdef", "lv"],
    sameLevelMustNotLoseExp: !fixture.compare || fixture.compare.sameLevelMustNotLoseExp !== false,
    sourceFile: path.relative(__dirname, baselineFile),
  };
}

function compactSegmentResult(segment) {
  const failurePropagation = segment.failurePropagation || {};
  return {
    segmentId: segment.segmentId,
    label: segment.label,
    found: segment.found,
    startCandidatesTried: segment.startCandidatesTried,
    candidateCount: (segment.candidates || []).length,
    failureClass: segment.failureClass || failurePropagation.failureClass || failurePropagation.primaryFailureClass,
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
  const qualityFloor = loadQualityBaseline(
    simulator,
    args["quality-baseline"] || null,
    rank,
    projectRoot
  );
  const startRoute = args["start-route"] ? path.resolve(args["start-route"]) : null;
  const captureTrace = parseBoolean(args["capture-trace"], false);
  const initialState = startRoute
    ? replayRouteFile(
      simulator,
      startRoute,
      rank,
      parseBoolean(args["start-route-snapshot"], false),
      parseBoolean(args["start-route-cache"], true),
      projectRoot,
      captureTrace
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
    windowRepairAgendaMode: args["window-repair-agenda-mode"] || null,
    windowRepairLookahead: parseBoolean(args["window-repair-lookahead"], false),
    windowRepairLookaheadActions: optionalNumber(args["window-repair-lookahead-actions"]) || null,
    enableWindowRepair: parseBoolean(args["window-repair"], true),
    enableFailureBacktracking: parseBoolean(args["failure-backtracking"], true),
    backtrackCandidateLimit: optionalNumber(args["backtrack-candidate-limit"]) || null,
    backtrackMaxExpansions: optionalNumber(args["backtrack-max-expansions"]) || null,
    backtrackMaxRuntimeMs: optionalNumber(args["backtrack-max-runtime-ms"]) || null,
    qualityFloor,
    captureTrace,
    startCandidateLimit: optionalNumber(args["start-candidate-limit"]) || null,
  });
  const doctor = buildSolverDoctorReport(result);
  const summary = {
    routeName,
    found: result.found,
    reachedMilestone: result.reachedMilestone,
    failedSegmentId: result.failedSegment && result.failedSegment.segmentId,
    doctor: result.found ? null : doctor,
    qualityFloor: result.qualityFloor || (qualityFloor ? { passed: false, floor: qualityFloor } : null),
    completedSegments: (result.segmentResults || []).filter((segment) => segment.found).map((segment) => segment.segmentId),
    insertedSegments: ((result.adaptive || {}).insertedSegments || []).map((segment) => ({
      id: segment.id,
      label: segment.label,
      generatedBy: segment.generatedBy,
      goal: segment.goal,
    })),
    repairBranches: (result.adaptive || {}).repairBranches || [],
    selectedBranch: (result.adaptive || {}).selectedBranch,
    attempts: (result.adaptive || {}).attempts || [],
    segments: (result.segmentResults || []).map(compactSegmentResult),
  };
  console.log(JSON.stringify(summary, null, 2));

  const out = args.out ? path.resolve(args.out) : null;
  if (out && !result.found && parseBoolean(args["remove-stale-out"], true) && fs.existsSync(out)) {
    fs.unlinkSync(out);
    console.log(`Removed stale route output after failed run: ${out}`);
  }
  if (out && result.found && result.finalCandidate && result.finalCandidate.state) {
    const finalState = result.finalCandidate.state;
    const fullRoute = Array.isArray(result.finalCandidate.route) ? result.finalCandidate.route.slice() : (Array.isArray(finalState.route) ? finalState.route.slice() : []);
    const fullTrace = Array.isArray(result.finalCandidate.trace) ? result.finalCandidate.trace.slice() : (Array.isArray(finalState.routeTrace) ? finalState.routeTrace.slice() : []);
    const prefixLength = startRoute && Array.isArray(initialState.route) ? initialState.route.length : 0;
    finalState.route = prefixLength > 0 ? fullRoute.slice(prefixLength) : fullRoute;
    if (captureTrace) {
      finalState.routeTrace = prefixLength > 0 ? fullTrace.slice(prefixLength) : fullTrace;
    } else if (Object.prototype.hasOwnProperty.call(finalState, "routeTrace")) {
      delete finalState.routeTrace;
    }
    const routeRecord = buildRouteRecord({
      project,
      simulator,
      initialState: startRoute ? initialState : undefined,
      finalState,
      options: {
        projectRoot,
        solver: "adaptive-segment-dp",
        profile: routeName,
        rank,
        toFloor: finalState.floorId,
        goalType: "adaptive-milestone",
        allowRouteMismatch: parseBoolean(args["allow-route-mismatch"], false),
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
            qualityFloor,
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
    console.log(doctor.line);
    console.log(`Segment failure: ${JSON.stringify(result.failedSegment, null, 2)}`);
  }
}

main();
