"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { parseKeyValueArgs } = require("./lib/cli-options");
const { executeActionList } = require("./lib/events");
const { getMilestoneSpec } = require("./lib/milestone-spec");
const { loadProject } = require("./lib/project-loader");
const {
  buildProjectFingerprint,
  buildRegionSpecIdentity,
  buildStartCheckpoint,
  validateRegionEntryContract,
} = require("./lib/region-entry-validator");
const { buildRegionMilestoneSpec, buildRegionProofClaim, loadRegionSpec } = require("./lib/region-spec");
const { buildRouteRecord, readRouteFile, writeRouteFile } = require("./lib/route-store");
const { runMilestoneGraph } = require("./lib/segment-dp");
const { StaticSimulator } = require("./lib/simulator");

const PREFLIGHT_SCHEMA = "motapathfinder.region-entry-preflight.v1";
const STRUCTURED_ERROR_SCHEMA = "motapathfinder.region-dp-error.v1";
let runnerStage = "startup";

function parseBoolean(value, fallback) {
  if (value == null) return fallback;
  if (value === true || value === "1" || value === "true" || value === "on") return true;
  if (value === false || value === "0" || value === "false" || value === "off") return false;
  return fallback;
}

function parseOptionalNumber(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveMaybeRelative(filePath, baseDir) {
  if (!filePath) return null;
  if (path.isAbsolute(filePath)) return filePath;
  const cwdPath = path.resolve(process.cwd(), filePath);
  if (fs.existsSync(cwdPath)) return cwdPath;
  return path.resolve(baseDir || process.cwd(), filePath);
}

function removeExistingRouteOutput(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return false;
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error(`Route output path is not a file: ${filePath}`);
  fs.unlinkSync(filePath);
  return true;
}

function solverRelativePath(filePath) {
  return path.relative(__dirname, filePath).replace(/\\/g, "/") || ".";
}

function makeSimulator(project, spec, args) {
  const simulatorConfig = spec.simulator || {};
  return new StaticSimulator(project, {
    solverModel: spec.model || null,
    stopFloorId: args["stop-floor"] || simulatorConfig.stopFloorId || null,
    battleResolver: new FunctionBackedBattleResolver(project, {
      autoLevelUp: simulatorConfig.autoLevelUp !== false,
    }),
    autoPickupEnabled: parseBoolean(args["auto-pickup"], parseBoolean(simulatorConfig.autoPickupEnabled, true)),
    autoBattleEnabled: parseBoolean(args["auto-battle"], parseBoolean(simulatorConfig.autoBattleEnabled, true)),
    enableFightToLevelUp: parseBoolean(args["fight-to-levelup"], parseBoolean(simulatorConfig.enableFightToLevelUp, false)),
    enableResourcePocket: false,
    enableResourceCluster: false,
    enableResourceChain: false,
    searchGraphMode: args["search-graph"] || simulatorConfig.searchGraphMode || "primitive",
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

function replayRouteFile(simulator, routeFile, rank) {
  let state = simulator.createInitialState({ rank });
  const record = readRouteFile(routeFile);
  for (const decision of record.decisions || []) {
    const action = findAction(simulator, state, decision.summary);
    if (!action) throw new Error(`Unable to replay start route at ${decision.index}: ${decision.summary}`);
    state = simulator.applyAction(state, action);
  }
  return state;
}

function createWhiteislandTrialState(project, simulator, rank) {
  const state = simulator.createInitialState({ rank });
  const choices = (((project.floorsById.Start || {}).events || {})["3,3"] || [])[0] || {};
  const trialChoice = (choices.choices || []).find((choice) => choice.text === "试炼间");
  if (!trialChoice) throw new Error("whiteislandTrial start requested but Start 3,3 does not contain 试炼间 choice");
  executeActionList(project, state, trialChoice.action || [], { floorId: "Start" }, { choiceResolver: simulator.choiceResolver });
  return simulator.stabilizeState(state);
}

function summarizeSegment(segment) {
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
    failurePropagation: segment.failurePropagation || null,
  };
}

function finalMetrics(result, wallMs, regionSpec, routeRecord, proofClaim) {
  const finalState = result.finalCandidate && result.finalCandidate.state;
  const hero = (finalState && finalState.hero) || {};
  return {
    taskId: regionSpec.id,
    found: Boolean(result.found),
    liveVerified: false,
    proofLevel: proofClaim.proofLevel,
    completeWithinActionSet: proofClaim.completeWithinActionSet,
    proofClaim,
    expansions: (result.segmentResults || []).reduce((sum, segment) => {
      const attempts = segment.attempts || [];
      return sum + attempts.reduce((inner, attempt) => inner + Number((((attempt.diagnostics || {}).dp || {}).expansions) || 0), 0);
    }, 0),
    wallMs,
    final: finalState ? {
      floorId: finalState.floorId,
      hp: Number(hero.hp || 0),
      atk: Number(hero.atk || 0),
      def: Number(hero.def || 0),
      mdef: Number(hero.mdef || 0),
      exp: Number(hero.exp || 0),
    } : null,
    routeLength: routeRecord ? (routeRecord.decisions || []).length : 0,
    illegalWrites: 0,
  };
}

function routeFinalSummary(state) {
  const hero = (state && state.hero) || {};
  const loc = hero.loc || {};
  return {
    floorId: state && state.floorId || null,
    hero: {
      hp: Number(hero.hp || 0),
      hpmax: Number(hero.hpmax || 0),
      mana: Number(hero.mana || 0),
      manamax: Number(hero.manamax || 0),
      atk: Number(hero.atk || 0),
      def: Number(hero.def || 0),
      mdef: Number(hero.mdef || 0),
      money: Number(hero.money || 0),
      exp: Number(hero.exp || 0),
      lv: Number(hero.lv || 0),
      loc: {
        x: Number(loc.x || 0),
        y: Number(loc.y || 0),
        direction: loc.direction || null,
      },
      equipment: Array.isArray(hero.equipment) ? hero.equipment.slice() : [],
    },
  };
}

function runPrefixMilestone(project, simulator, regionSpec, args, rank) {
  const prefix = regionSpec.start && regionSpec.start.milestonePrefix;
  if (!prefix) return null;
  const prefixSpec = getMilestoneSpec(project, prefix.routeName || regionSpec.milestoneRoute);
  const result = runMilestoneGraph(simulator, simulator.createInitialState({ rank }), prefixSpec, {
    fromMilestoneId: prefix.fromMilestoneId || null,
    toMilestoneId: prefix.toMilestoneId,
    candidateLimit: parseOptionalNumber(args["prefix-candidate-limit"]) || Number(prefix.candidateLimit || (regionSpec.search || {}).candidateLimit || 4),
    maxExpansions: parseOptionalNumber(args["prefix-max-expansions"]) || null,
    maxRuntimeMs: parseOptionalNumber(args["prefix-max-runtime-ms"]) || null,
    stopOnFirstGoal: args["prefix-stop-on-first-goal"] == null ? null : parseBoolean(args["prefix-stop-on-first-goal"], false),
  });
  if (!result.found || !result.finalCandidate || !result.finalCandidate.state) {
    const failedSegment = result.failedSegment || {};
    const attempts = failedSegment.attempts || [];
    const dpAttempts = attempts.map((attempt) => attempt.diagnostics && attempt.diagnostics.dp || {});
    const usedExpansions = dpAttempts.reduce((sum, dp) => sum + Number(dp.expansions || 0), 0);
    const expansionBudgetExhausted = dpAttempts.some((dp) => dp.expansionBudgetExhausted === true);
    const primaryFailureClass = failedSegment.failurePropagation && failedSegment.failurePropagation.primaryFailureClass || failedSegment.failureClass || null;
    const error = new Error(`Prefix milestone failed before region ${regionSpec.id}`);
    error.runnerDetails = {
      stage: "prefix-milestone",
      regionId: regionSpec.id,
      failedSegmentId: failedSegment.segmentId || null,
      termination: expansionBudgetExhausted ? "prefix-budget-exhausted" : "prefix-milestone-failed",
      failureClass: expansionBudgetExhausted ? "prefix-budget-exhausted" : (primaryFailureClass || "prefix-milestone-failed"),
      primaryFailureClass,
      usedExpansions,
      configuredMaxExpansions: parseOptionalNumber(args["prefix-max-expansions"]),
      configuredMaxRuntimeMs: parseOptionalNumber(args["prefix-max-runtime-ms"]),
    };
    throw error;
  }
  return result.finalCandidate.state;
}

function createStartState(project, simulator, regionSpec, args, rank, specDir) {
  if (args["start-route"]) return replayRouteFile(simulator, path.resolve(args["start-route"]), rank);
  if (regionSpec.start && regionSpec.start.routeFile) {
    return replayRouteFile(simulator, resolveMaybeRelative(regionSpec.start.routeFile, specDir), rank);
  }
  const prefixState = runPrefixMilestone(project, simulator, regionSpec, args, rank);
  if (prefixState) return prefixState;
  if ((regionSpec.start || {}).type === "whiteislandTrial") {
    return createWhiteislandTrialState(project, simulator, rank);
  }
  return simulator.createInitialState({ rank });
}

function writeJsonIfRequested(filePath, value) {
  if (!filePath) return;
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(value, null, 2)}\n`);
}

function buildPreflightSummary(regionSpec, regionSpecPath, projectRoot, outPath, project, validation) {
  const boundary = validation.boundary || {
    prefix: null,
    fromMilestoneId: null,
    toMilestoneId: null,
    prefixResolved: false,
    rangeResolved: false,
  };
  return {
    kind: "region-entry-preflight",
    schema: PREFLIGHT_SCHEMA,
    valid: validation.valid,
    regionId: regionSpec.id,
    projectRoot: solverRelativePath(projectRoot),
    regionSpec: solverRelativePath(regionSpecPath),
    outputPath: outPath ? solverRelativePath(outPath) : null,
    startCheckpoint: buildStartCheckpoint(regionSpec),
    milestoneOrder: validation.effectiveMilestones.map((milestone) => milestone.id),
    boundary: {
      fromMilestoneId: boundary.fromMilestoneId || null,
      toMilestoneId: boundary.toMilestoneId || null,
      prefixResolved: Boolean(boundary.prefixResolved),
      rangeResolved: Boolean(boundary.rangeResolved),
    },
    checks: {
      regionSpecLoaded: true,
      projectLoaded: Boolean(project),
      milestoneSpecBuilt: Boolean(validation.milestoneSpec),
      prefixBoundaryResolved: Boolean(boundary.prefixResolved),
      outputPathParseable: Boolean(outPath),
    },
    errors: validation.errors,
  };
}

function runValidationOnly(args) {
  runnerStage = "load-region-spec";
  const regionSpecPath = path.resolve(args["region-spec"]);
  const regionSpec = loadRegionSpec(regionSpecPath);
  const projectRoot = path.resolve(args["project-root"] || regionSpec.projectRoot || ".");
  const outPath = args.out ? path.resolve(args.out) : null;
  runnerStage = "load-project";
  const project = loadProject(projectRoot);
  runnerStage = "validate-entry-contract";
  const validation = validateRegionEntryContract(regionSpec, project, {
    specFile: regionSpecPath,
    projectRoot,
    outFile: outPath,
  });
  const summary = buildPreflightSummary(regionSpec, regionSpecPath, projectRoot, outPath, project, validation);
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.valid) process.exitCode = 2;
}

function buildSummary(regionSpec, result, metrics, routePath, proofClaim) {
  return {
    kind: "region-dp",
    regionId: regionSpec.id,
    label: regionSpec.label,
    tower: regionSpec.tower,
    found: result.found,
    proofClaim,
    model: regionSpec.model || null,
    routeFile: routePath || null,
    reachedMilestone: result.reachedMilestone,
    failedSegmentId: result.failedSegment && result.failedSegment.segmentId,
    scope: regionSpec.scope || null,
    search: regionSpec.search || null,
    resourceTimingPolicy: regionSpec.resourceTimingPolicy || null,
    expectedRegressionTraps: regionSpec.expectedRegressionTraps || [],
    metrics,
    segments: (result.segmentResults || []).map(summarizeSegment),
  };
}

function printReplayCommand(projectRoot, routePath) {
  if (!routePath) return;
  console.log("GUI replay command:");
  console.log(`node shared-solver/route-gui.js --project-root=${JSON.stringify(projectRoot)} --route-file=${JSON.stringify(routePath)} --live=1 --headless=0 --runtime-auto-battle=1 --runtime-auto-pickup=1`);
}

function main() {
  const args = parseKeyValueArgs(process.argv.slice(2));
  if (args["validate-only"]) {
    if (!args["region-spec"]) {
      throw new Error("--validate-only=1 requires --region-spec");
    }
    runValidationOnly(args);
    return;
  }
  const startedAt = Date.now();
  if (args.help || args.h || !args["region-spec"]) {
    console.log([
      "Usage:",
      "  node shared-solver/run-region-dp.js --project-root=<tower-root> --region-spec=<spec.json> --out=<route.json>",
      "",
      "Optional:",
      "  --metrics=<metrics.json>",
      "  --diagnostics=<diagnostics.json>",
      "  --start-route=<route.json>",
      "  --candidate-limit=<n>",
      "  --max-expansions=<n>",
      "  --max-runtime-ms=<n>",
      "  --stop-on-first-goal=0|1",
      "  --validate-only=1",
      "  --structured-errors=1",
    ].join("\n"));
    return;
  }

  const requestedOutputPath = args.out ? path.resolve(args.out) : null;
  runnerStage = "cleanup-output";
  removeExistingRouteOutput(requestedOutputPath);
  runnerStage = "load-region-spec";
  const regionSpecPath = path.resolve(args["region-spec"]);
  const regionSpec = loadRegionSpec(regionSpecPath);
  const specDir = path.dirname(regionSpecPath);
  const projectRoot = path.resolve(args["project-root"] || regionSpec.projectRoot || ".");
  const rank = args.rank || regionSpec.rank || "chaos";
  runnerStage = "load-project";
  const project = loadProject(projectRoot);
  runnerStage = "build-start-state";
  const simulator = makeSimulator(project, regionSpec, args);
  const initialState = createStartState(project, simulator, regionSpec, args, rank, specDir);
  runnerStage = "build-milestone-spec";
  const milestoneSpec = buildRegionMilestoneSpec(project, regionSpec);
  const search = regionSpec.search || {};
  const dpBudget = search.dpBudget || {};
  runnerStage = "run-region-dp";
  const result = runMilestoneGraph(simulator, initialState, milestoneSpec, {
    fromMilestoneId: args["from-milestone"] || regionSpec.fromMilestoneId || null,
    toMilestoneId: args["to-milestone"] || regionSpec.toMilestoneId || null,
    candidateLimit: parseOptionalNumber(args["candidate-limit"]) || Number(search.candidateLimit || 8),
    dpKeyMode: args["dp-key-mode"] || search.dpKeyMode || null,
    maxExpansions: parseOptionalNumber(args["max-expansions"]) || dpBudget.maxExpansions || null,
    maxRuntimeMs: parseOptionalNumber(args["max-runtime-ms"]) || dpBudget.maxRuntimeMs || null,
    stopOnFirstGoal: args["stop-on-first-goal"] == null
      ? (search.stopOnFirstGoal == null ? null : parseBoolean(search.stopOnFirstGoal, false))
      : parseBoolean(args["stop-on-first-goal"], false),
    enableFailureBacktracking: parseBoolean(args["failure-backtracking"], parseBoolean(regionSpec.enableFailureBacktracking, true)),
  });
  const proofClaim = buildRegionProofClaim(result, regionSpec);

  let routeRecord = null;
  let routePath = requestedOutputPath;
  if (routePath && result.found && result.finalCandidate && result.finalCandidate.state) {
    const finalState = result.finalCandidate.state;
    finalState.route = Array.isArray(result.finalCandidate.route) ? result.finalCandidate.route.slice() : finalState.route;
    const regionSpecIdentity = buildRegionSpecIdentity(regionSpec, regionSpecPath);
    const projectFingerprint = buildProjectFingerprint(project);
    const regionDpMetadata = {
      regionId: regionSpec.id,
      regionSpec: path.relative(process.cwd(), regionSpecPath),
      regionSpecIdentity,
      projectFingerprint,
      solverModelFingerprint: regionSpec.model && regionSpec.model.fingerprint || null,
      reachedMilestone: result.reachedMilestone || null,
      milestoneRoute: regionSpec.milestoneRoute || null,
      fromMilestoneId: args["from-milestone"] || regionSpec.fromMilestoneId || null,
      toMilestoneId: args["to-milestone"] || regionSpec.toMilestoneId || null,
      scope: regionSpec.scope || null,
      search,
      candidateLimit: parseOptionalNumber(args["candidate-limit"]) || Number(search.candidateLimit || 8),
      proofClaim,
    };
    routeRecord = buildRouteRecord({
      project,
      simulator,
      initialState,
      finalState,
      options: {
        projectRoot,
        solver: "region-dp",
        profile: regionSpec.id,
        rank,
        toFloor: finalState.floorId,
        goalType: "region",
        snapshotFloors: (regionSpec.scope || {}).floors,
        metadata: {
          kind: "region-dp",
          regionDp: regionDpMetadata,
        },
      },
    });
    regionDpMetadata.primitiveDecisionCount = (routeRecord.decisions || []).length;
    regionDpMetadata.final = routeFinalSummary(finalState);
    writeRouteFile(routePath, routeRecord);
  } else {
    routePath = null;
  }

  const metrics = finalMetrics(result, Date.now() - startedAt, regionSpec, routeRecord, proofClaim);
  const summary = buildSummary(regionSpec, result, metrics, routePath, proofClaim);
  console.log(JSON.stringify(summary, null, 2));
  if (routePath) {
    console.log(`Route written: ${routePath}`);
    printReplayCommand(projectRoot, routePath);
  }
  if (result.failedSegment && parseBoolean(args["print-failures"], true)) {
    console.log(`Region failure: ${JSON.stringify(result.failedSegment, null, 2)}`);
  }
  writeJsonIfRequested(args.metrics, metrics);
  writeJsonIfRequested(args.diagnostics, summary);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    const args = parseKeyValueArgs(process.argv.slice(2));
    if (parseBoolean(args["structured-errors"], false)) {
      const details = error && error.runnerDetails || {};
      console.error(JSON.stringify({
        kind: "region-dp-error",
        schema: STRUCTURED_ERROR_SCHEMA,
        valid: false,
        regionId: details.regionId || null,
        stage: details.stage || runnerStage,
        termination: details.termination || "runner-error",
        failureClass: details.failureClass || "runner-error",
        primaryFailureClass: details.primaryFailureClass || null,
        failedSegmentId: details.failedSegmentId || null,
        usedExpansions: details.usedExpansions == null ? null : details.usedExpansions,
        configuredMaxExpansions: details.configuredMaxExpansions == null ? null : details.configuredMaxExpansions,
        configuredMaxRuntimeMs: details.configuredMaxRuntimeMs == null ? null : details.configuredMaxRuntimeMs,
        errorType: error && error.name || "Error",
        message: error && error.message ? error.message : String(error),
      }, null, 2));
    } else {
      console.error(error && error.stack ? error.stack : String(error));
    }
    process.exitCode = 1;
  }
}
