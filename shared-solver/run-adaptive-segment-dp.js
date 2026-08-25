"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { runAdaptiveSegmentPlanner } = require("./lib/adaptive-segment-planner");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { getMilestoneSpec } = require("./lib/milestone-spec");
const { runMilestoneDecomposer } = require("./lib/milestone-decomposer");
const { loadProject } = require("./lib/project-loader");
const { buildSolverSnapshot } = require("./lib/route-snapshot");
const { buildDominanceKey } = require("./lib/state-key");
const { buildRouteRecord, createStateFromSnapshot, fingerprintAction, readRouteFile, writeRouteFile } = require("./lib/route-store");
const { buildSolverDoctorReport } = require("./lib/solver-doctor");
const { StaticSimulator } = require("./lib/simulator");
const { resolveFastRejectQualification } = require("./lib/fast-reject-qualification");

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
  const isQualified = resolveFastRejectQualification({ args });
  return new StaticSimulator(project, {
    stopFloorId: (args && args["stop-floor"]) || "MT11",
    battleResolver: new FunctionBackedBattleResolver(project, { enableFastReject: isQualified }),
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    autoBattleFastRejectEnabled: isQualified,
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

function replayRouteFile(simulator, routeFile, rank, useSnapshot, useCache, projectRoot, captureTrace, maxDecisions) {
  const keepTrace = captureTrace === true;
  const record = readRouteFile(routeFile);
  const limit = optionalNumber(maxDecisions);
  const partialReplay = limit != null;
  if (!partialReplay && useSnapshot && record.final && record.final.snapshot) {
    const state = createStateFromSnapshot(simulator.project, record.final.snapshot, {
      rank: rank || "chaos",
      route: Array.isArray(record.rawRoute) ? record.rawRoute : [],
      decisionDepth: record.stats && record.stats.depth,
      notes: record.notes,
    });
    if (keepTrace) state.routeTrace = (record.decisions || []).map((decision) => decisionTraceEntry(simulator.project, decision, null, null));
    return state;
  }
  if (!partialReplay && useCache) {
    const cached = readReplayCache(routeFile, projectRoot || "", rank || "chaos", keepTrace);
    if (cached) return cached;
  }
  let state = simulator.createInitialState({ rank: rank || "chaos" });
  let routeTrace = [];
  const decisions = (record.decisions || []).slice(0, partialReplay ? limit : undefined);
  for (const decision of decisions) {
    const preState = state;
    const action = findAction(simulator, state, decision);
    if (!action) throw new Error(`Unable to replay start route at ${decision.index}: ${decision.summary}`);
    if (Object.prototype.hasOwnProperty.call(state, "routeTrace")) delete state.routeTrace;
    state = simulator.applyAction(state, action);
    if (keepTrace) routeTrace = routeTrace.concat(decisionTraceEntry(simulator.project, decision, preState, state));
  }
  if (keepTrace) state.routeTrace = routeTrace;
  else if (Object.prototype.hasOwnProperty.call(state, "routeTrace")) delete state.routeTrace;
  if (!partialReplay && useCache) writeReplayCache(routeFile, projectRoot || "", rank || "chaos", state, keepTrace);
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

function writeJsonFile(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function autoDecomposeOptions(args, routeName) {
  return {
    routeName: `${routeName}-auto-decomposed`,
    globalRuntimeMs: optionalNumber(args["global-runtime-ms"]) || 600000,
    globalMaxHeapMb: optionalNumber(args["global-max-heap-mb"]) || 1024,
    maxNodes: optionalNumber(args["decompose-max-nodes"]) || 64,
    branchWidth: optionalNumber(args["decompose-branch-width"]) || 3,
    maxDepth: optionalNumber(args["decompose-max-depth"]) || 24,
    maxLandmarks: optionalNumber(args["decompose-max-landmarks"]) || 24,
    probeLandmarks: optionalNumber(args["decompose-probe-landmarks"]) || 6,
    candidateLimit: optionalNumber(args["candidate-limit"]) || 4,
    cacheEnabled: parseBoolean(args["decompose-cache"], true),
    cacheDirectory: path.resolve(
      args["decompose-cache-dir"] || "routes/generated/segment-decomposition-cache",
    ),
    minimize: parseBoolean(args["decompose-minimize"], true),
    allowedFloors: args["decompose-allowed-floors"]
      ? args["decompose-allowed-floors"].split(",").map((value) => value.trim()).filter(Boolean)
      : null,
    resourceTimingModel: args["resource-timing-model"] || "breakpoint-v2",
    resourceTimingTargetLimit: optionalNumber(args["resource-timing-target-limit"]) || 16,
    resourceTimingResourceLimit: optionalNumber(args["resource-timing-resource-limit"]) || 4,
    resourceTimingThresholdLimit: optionalNumber(args["resource-timing-threshold-limit"]) || 3,
    resourceTimingSkylineMax: optionalNumber(args["resource-timing-skyline-max"]) || 4,
    resourceTimingCalculateThresholds: parseBoolean(args["resource-timing-calculate-thresholds"], false),
    resourceDeferralEnabled: parseBoolean(args["resource-deferral"], true),
    resourceDeferralLimit: optionalNumber(args["resource-deferral-limit"]) || 2,
    resourceDeferralMaxExpansions: optionalNumber(args["resource-deferral-max-expansions"]) || 600,
    resourceDeferralMaxRuntimeMs: optionalNumber(args["resource-deferral-max-runtime-ms"]) || 5000,
    resourceDeferralMinSaving: optionalNumber(args["resource-deferral-min-saving"]) || 5000,
  };
}

function reexecWithGarbageCollection(args) {
  if (!parseBoolean(args["auto-decompose"], false)) return false;
  if (typeof global.gc === "function") return false;
  if (process.env.MOTAPATHFINDER_GC_REEXEC === "1") return false;
  const child = spawnSync(
    process.execPath,
    ["--expose-gc", __filename, ...process.argv.slice(2)],
    {
      stdio: "inherit",
      env: { ...process.env, MOTAPATHFINDER_GC_REEXEC: "1" },
    },
  );
  if (child.error) throw child.error;
  process.exitCode = child.status == null ? 1 : child.status;
  return true;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (reexecWithGarbageCollection(args)) return;
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
  const startRouteStep = optionalNumber(args["start-route-step"]);
  const captureTrace = parseBoolean(args["capture-trace"], false);
  const initialState = startRoute
    ? replayRouteFile(
      simulator,
      startRoute,
      rank,
      parseBoolean(args["start-route-snapshot"], false),
      parseBoolean(args["start-route-cache"], true),
      projectRoot,
      captureTrace,
      startRouteStep,
    )
    : simulator.createInitialState({ rank });
  const autoDecompose = parseBoolean(args["auto-decompose"], false);
  const targetMilestoneId = args["to-milestone"] || null;
  const targetSegment = targetMilestoneId
    ? (spec.milestones || []).find((milestone) => milestone.id === targetMilestoneId)
    : (spec.milestones || [])[spec.milestones.length - 1];
  if (autoDecompose && !targetSegment) {
    throw new Error(`Unable to resolve auto-decompose target milestone: ${targetMilestoneId || "last"}`);
  }
  const result = autoDecompose
    ? runMilestoneDecomposer(
      simulator,
      initialState,
      targetSegment,
      autoDecomposeOptions(args, routeName),
    )
    : runAdaptiveSegmentPlanner(simulator, initialState, spec, {
    searchIntent: args["search-intent"] || null,
    fromMilestoneId: args["from-milestone"] || null,
    toMilestoneId: args["to-milestone"] || null,
    candidateLimit: optionalNumber(args["candidate-limit"]) || 8,
    dpKeyMode: args["dp-key-mode"] || null,
    maxExpansions: optionalNumber(args["max-expansions"]),
    maxRuntimeMs: optionalNumber(args["max-runtime-ms"]),
    stopOnFirstGoal: args["stop-on-first-goal"] == null ? null : parseBoolean(args["stop-on-first-goal"], false),
    dpPriorityMode: args["priority-mode"] || null,
    goalFeasibilityMode: args["goal-feasibility-mode"] || null,
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
    resourceTimingModel: args["resource-timing-model"] || "breakpoint-v1",
    resourceTimingTargetLimit: optionalNumber(args["resource-timing-target-limit"]) || 16,
    resourceTimingResourceLimit: optionalNumber(args["resource-timing-resource-limit"]) || 4,
    resourceTimingThresholdLimit: optionalNumber(args["resource-timing-threshold-limit"]) || 3,
    resourceTimingSkylineMax: optionalNumber(args["resource-timing-skyline-max"]) || 4,
    resourceTimingCalculateThresholds: parseBoolean(args["resource-timing-calculate-thresholds"], false),
    resourceDeferralEnabled: parseBoolean(args["resource-deferral"], false),
    resourceDeferralLimit: optionalNumber(args["resource-deferral-limit"]) || 2,
    resourceDeferralMaxExpansions: optionalNumber(args["resource-deferral-max-expansions"]) || 600,
    resourceDeferralMaxRuntimeMs: optionalNumber(args["resource-deferral-max-runtime-ms"]) || 5000,
    resourceDeferralMinSaving: optionalNumber(args["resource-deferral-min-saving"]) || 5000,
  });
  const doctor = buildSolverDoctorReport(result);
  const summary = {
    routeName,
    found: result.found,
    generatedProfileVerified: autoDecompose
      ? result.generatedProfileVerified === true
      : null,
    profileValidationFailure: result.profileValidationFailure
      ? result.profileValidationFailure.segmentId
      : null,
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
    decomposition: result.decomposition || null,
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
    const writeFullRoute = autoDecompose && startRouteStep != null;
    finalState.route = writeFullRoute
      ? fullRoute
      : prefixLength > 0
        ? fullRoute.slice(prefixLength)
        : fullRoute;
    if (captureTrace) {
      finalState.routeTrace = prefixLength > 0 ? fullTrace.slice(prefixLength) : fullTrace;
    } else if (Object.prototype.hasOwnProperty.call(finalState, "routeTrace")) {
      delete finalState.routeTrace;
    }
    const routeRecord = buildRouteRecord({
      project,
      simulator,
      initialState: writeFullRoute
        ? simulator.createInitialState({ rank })
        : startRoute
          ? initialState
          : undefined,
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
            decomposition: result.decomposition || null,
          },
        },
      },
    });
    writeRouteFile(out, routeRecord);
    console.log(`Route written: ${out}`);
    console.log("GUI replay:");
    console.log(guiCommand(projectRootArg, out));
  }
  const effectiveSpecPath = args["out-generated-spec"] || args["save-effective-spec"];
  if (effectiveSpecPath && result.effectiveSpec) {
    const specOut = path.resolve(effectiveSpecPath);
    writeJsonFile(specOut, result.effectiveSpec);
    console.log(`Effective spec written: ${specOut}`);
  }
  const decompositionReport = args["decompose-report"];
  if (decompositionReport) {
    const reportOut = path.resolve(decompositionReport);
    writeJsonFile(reportOut, {
      kind: "milestone-decomposition-report",
      routeName,
      startRoute,
      startRouteStep,
      targetMilestoneId: targetSegment && targetSegment.id,
      found: result.found,
      decomposition: result.decomposition || null,
      summary,
    });
    console.log(`Decomposition report written: ${reportOut}`);
  }
  if (result.failedSegment && parseBoolean(args["print-failures"], true)) {
    console.log(doctor.line);
    console.log(`Segment failure: ${JSON.stringify(result.failedSegment, null, 2)}`);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  makeSimulator,
};
