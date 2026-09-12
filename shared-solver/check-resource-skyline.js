"use strict";

/**
 * PR-5.25n — Frontier-Conditioned Resource-State Skyline Search.
 *
 * PHASE 0: Preflight Cleanups & Autonomous Target Verification
 *   - Pre-goal strategic universe (excluding post-goal target floor content).
 *   - Unified mutation identity (mutation:hook:floor:at).
 *   - Dynamic relative floor resolution (no hardcoded MT mappings).
 *   - Autonomous target transition discovery & 100% witness recall verification.
 *
 * PHASE 1: Resource Variant Pressure Measurement
 *   - Measure MT2 expanded states grouped by strict structural state key.
 *   - Pairwise non-scalar Pareto dominance comparison.
 *   - Metrics: MT2_EXPANDED_STATES, STRUCTURAL_GROUP_COUNT, MULTI_VARIANT_GROUP_COUNT,
 *              RESOURCE_VARIANT_STATE_COUNT, PARETO_NONDOMINATED_COUNT, PARETO_DOMINATED_COUNT.
 *
 * PHASE 2: Pareto Resource Skyline Priority Qualification
 *   CONTROL   = 5.25m autonomous frontier bounded-fair dual queue
 *   TREATMENT = Identical search + Pareto resource skyline priority within structural groups
 *               (nondominated -> guided heap; dominated -> neutral queue; NO PRUNING)
 *   BUDGET    = 180s / 2048MB / 120k expansions (per-search child process isolation)
 *   GATE      = CHAOS_MT1_TO_MT3 == FOUND && STRICT_REPLAY_VALID
 *
 * Usage:
 *   node check-resource-skyline.js [--smoke] [--phase1-only] [--out=PATH]
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const { loadProject } = require("./lib/project-loader");
const { StaticSimulator } = require("./lib/simulator");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { createTransportCollapsedSearch } = require("./lib/transport-collapse");
const { buildDependencyFrontier, evaluateWitnessRecall } = require("./lib/dependency-frontier");
const { verifyStrictReplay: verifyStrictReplayShared } = require("./lib/strict-replay");

const PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const DEFAULT_RESULT_PATH = path.resolve(__dirname, "routes", "generated", "resource-skyline-phase1.result.json");
const WITNESS_REL_PATH = "shared-solver/routes/fixtures/mt1-mt3-i893-hp8425.route.json";

function parseArgs(argv) {
  const args = {
    smoke: false,
    phase1Only: false,
    out: DEFAULT_RESULT_PATH,
    child: false,
    arm: null,
    trackPressure: false,
    maxExpansions: 120000,
    maxRuntimeMs: 180000,
    maxRssMb: 2048,
    json: null,
  };
  for (const token of argv.slice(2)) {
    if (token === "--smoke") { args.smoke = true; continue; }
    if (token === "--phase1-only") { args.phase1Only = true; continue; }
    if (token === "--child") { args.child = true; continue; }
    if (token === "--track-pressure") { args.trackPressure = true; continue; }
    const match = /^--([a-zA-Z-]+)=(.*)$/.exec(token);
    if (!match) continue;
    const [, key, value] = match;
    if (key === "arm") args.arm = value;
    else if (key === "out") args.out = path.resolve(__dirname, value);
    else if (key === "json") args.json = value;
    else if (key === "max-expansions") args.maxExpansions = Number(value);
    else if (key === "max-runtime-ms") args.maxRuntimeMs = Number(value);
    else if (key === "max-rss-mb") args.maxRssMb = Number(value);
  }
  if (args.smoke) {
    args.maxExpansions = 4000;
    args.maxRuntimeMs = 20000;
    if (args.out === DEFAULT_RESULT_PATH) {
      args.out = path.resolve(__dirname, "routes", "generated", "resource-skyline.smoke.result.json");
    }
  }
  return args;
}

function requireCondition(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details || null;
    throw error;
  }
}

function makeSimulator(project) {
  return new StaticSimulator(project, {
    stopFloorId: "MT11",
    battleResolver: new FunctionBackedBattleResolver(project),
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    searchGraphMode: "primitive",
    walkReachabilityMode: "safe-fast",
  });
}

/**
 * Strict replay gate. Delegates to the shared implementation so that every
 * autonomous qualification harness uses the SAME acceptance rule, including
 * terminal-state equality and post-replay goal re-verification.
 */
function verifyStrictReplay(simulator, route, options) {
  return verifyStrictReplayShared(simulator, route, options);
}

// ---------------------------------------------------------------------------
// Child process runner (for process-wide RSS isolation)
// ---------------------------------------------------------------------------

function runChild(args) {
  const project = loadProject(PROJECT_ROOT);
  const simulator = makeSimulator(project);
  const initialState = simulator.createInitialState({ rank: "chaos" });
  const terminalGoal = { type: "floorReached", floorId: "MT3" };

  const isGoalState = (state) => state.floorId === "MT3";
  const allowedFloors = ["MT1", "MT2", "MT3"];

  const search = createTransportCollapsedSearch(simulator);
  const frontierReport = buildDependencyFrontier(project, initialState, terminalGoal);
  const frontierSet = frontierReport.frontierSet;

  const resourceSkylinePriority = args.arm === "treatment";
  const trackResourcePressure = args.trackPressure === true;

  const result = search.search(initialState, {
    isGoalState,
    allowedFloors,
    maxExpansions: args.maxExpansions,
    maxRuntimeMs: args.maxRuntimeMs,
    maxRssMb: args.maxRssMb,
    frontierSet,
    resourceSkylinePriority,
    trackResourcePressure,
  });

  let replay = null;
  if (result.found && result.route) {
    replay = verifyStrictReplay(simulator, result.route, {
      initialState,
      isGoalState,
      expectedFinalState: result.finalState,
      routeTrace: result.routeTrace,
    });
  }

  const summary = {
    arm: args.arm,
    budget: {
      maxExpansions: args.maxExpansions,
      maxRuntimeMs: args.maxRuntimeMs,
      maxRssMb: args.maxRssMb,
    },
    found: result.found,
    replayValid: replay ? replay.ok : null,
    replayReason: replay && !replay.ok ? replay.reason : null,
    routeLength: result.route ? result.route.length : null,
    stoppedReason: result.stoppedReason,
    searchComplete: result.searchComplete,
    wallMs: result.wallMs,
    peakRssMb: result.peakRssMb,
    registrySize: result.registrySize,
    duplicatesSkipped: result.duplicatesSkipped,
    strategicExpansions: result.strategicExpansions,
    strategicBranches: result.strategicBranches,
    exactSuccessors: result.exactSuccessors,
    guidedExpansions: result.guidedExpansions,
    neutralExpansions: result.neutralExpansions,
    transportActionsAbsorbed: result.transportActionsAbsorbed,
    transportClosureVisited: result.transportClosureVisited,
    closureTruncations: result.closureTruncations,
    closureStateVisitsTotal: result.closureStateVisitsTotal,
    distinctClosureExactKeysGlobal: result.distinctClosureExactKeysGlobal,
    repeatedClosureExactKeyVisits: result.repeatedClosureExactKeyVisits,
    repeatFraction: result.repeatFraction,
    topRepeatedExactKeys: result.topRepeatedExactKeys,
    signatureCalls: result.signatureCalls,
    signatureWallMs: result.signatureWallMs,
    deepestFloorOrdinal: result.deepestFloorOrdinal,
    deepestFloorHistogram: result.deepestFloorHistogram,
    deepestStrategicDepth: result.deepestStrategicDepth,
    resourceVariantPressure: result.resourceVariantPressure,
  };

  fs.writeFileSync(args.json, JSON.stringify(summary));
}

function spawnArm(args, arm, trackPressure = false) {
  const jsonPath = path.join(os.tmpdir(), `skyline-${process.pid}-${arm}.json`);
  const childArgs = [
    __filename, "--child", `--arm=${arm}`, `--json=${jsonPath}`,
    `--max-expansions=${args.maxExpansions}`, `--max-runtime-ms=${args.maxRuntimeMs}`,
    `--max-rss-mb=${args.maxRssMb}`,
  ];
  if (trackPressure) childArgs.push("--track-pressure");
  const spawned = spawnSync(process.execPath, childArgs, { encoding: "utf8" });
  if (spawned.status !== 0) {
    throw new Error(`child (${arm}) failed: ${spawned.stderr || spawned.stdout}`);
  }
  const summary = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  try { fs.unlinkSync(jsonPath); } catch (_) { /* best effort */ }
  return summary;
}

// ---------------------------------------------------------------------------
// Main Orchestrator
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv);
  if (args.child) {
    runChild(args);
    return;
  }

  console.log("PR-5.25n — Frontier-Conditioned Resource-State Skyline Search");

  const project = loadProject(PROJECT_ROOT);
  const simulator = makeSimulator(project);
  const initialState = simulator.createInitialState({ rank: "chaos" });
  const terminalGoal = { type: "floorReached", floorId: "MT3" };

  // --- Phase 0: Preflight cleanups & Autonomous target discovery ---
  const frontierReport = buildDependencyFrontier(project, initialState, terminalGoal);

  console.log("  Phase 0 Autonomous Target Discovery & Preflight Cleanups:");
  console.log(`    derived floor envelope:     ${frontierReport.derivedFloorEnvelope.join(" -> ")}`);
  console.log(`    derived target transitions: ${frontierReport.derivedTargetTransitions.map((t) => `${t.floorId}:${t.at}->${t.targetFloorId}`).join(", ")}`);
  console.log(`    derived target POI IDs:     ${frontierReport.derivedTargetPoiIdentities.join(", ")}`);
  console.log(`    TARGET_TRANSITION_DISCOVERY:${frontierReport.targetTransitionDiscovery}`);
  console.log(`    NO_AUTHORED_COORDINATE:     ${frontierReport.noAuthoredTargetCoordinate}`);
  console.log(`    ALL_STRATEGIC_POIS:         ${frontierReport.allStrategicPoiCount} (post-goal MT3 excluded)`);
  console.log(`    FRONTIER:                   ${frontierReport.frontierCount}`);

  requireCondition(
    frontierReport.targetTransitionDiscovery === "DERIVED_FROM_PROJECT_AND_TERMINAL_GOAL",
    "Target transition must be derived from project and terminal goal",
  );
  requireCondition(
    frontierReport.noAuthoredTargetCoordinate === true,
    "Target coordinates must not be authored inputs",
  );

  const intermediateFloor = frontierReport.derivedTargetTransitions[0].floorId;
  const witnessEval = evaluateWitnessRecall(
    project,
    WITNESS_REL_PATH,
    frontierReport.frontierSet,
    frontierReport.allStrategicPoiCount,
    intermediateFloor,
    terminalGoal.floorId,
  );

  console.log("  Phase 0 Witness Recall Verification:");
  console.log(`    ORACLE_VALID:               ${witnessEval.oracleValid}`);
  console.log(`    oracle_count:               ${witnessEval.oracle_count}`);
  console.log(`    frontier_count:             ${witnessEval.frontier_count}`);
  console.log(`    all_strategic_poi_count:    ${witnessEval.all_strategic_poi_count}`);
  console.log(`    intersection_count:         ${witnessEval.intersection_count}`);
  console.log(`    observed_pre_unlock_recall: ${witnessEval.observed_pre_unlock_recall}`);
  console.log(`    frontier_fraction:          ${witnessEval.frontier_fraction_of_all_strategic_pois.toFixed(4)}`);
  console.log(`    missed_by_kind:             ${JSON.stringify(witnessEval.missed_by_kind)}`);
  console.log(`    PHASE_0_GATE:               ${witnessEval.phase1Pass ? "PASS" : "FAIL"}`);

  requireCondition(witnessEval.oracleValid, "ORACLE_VALID must be true", witnessEval);
  requireCondition(witnessEval.phase1Pass, "Witness recall must be 1.0", witnessEval);

  // --- Phase 1: Measure MT2 Resource Variant Pressure ---
  console.log("  Phase 1 Resource Variant Pressure Measurement:");
  console.log(`    running baseline autonomous search (control) with resource telemetry...`);
  const control = spawnArm(args, "control", true);

  const pressure = control.resourceVariantPressure || {
    mt2ExpandedStates: 0,
    structuralGroupCount: 0,
    multiVariantGroupCount: 0,
    resourceVariantStateCount: 0,
    maxVariantsInGroup: 0,
    paretoNondominatedCount: 0,
    paretoDominatedCount: 0,
    dominatedFraction: 0,
    multiVariantFraction: 0,
  };

  console.log(`    control run: strategic=${control.strategicExpansions} deepest=${control.deepestFloorOrdinal} stopped=${control.stoppedReason} wall=${control.wallMs}ms rss=${control.peakRssMb}MB`);
  console.log("    MT2 Resource-State Pressure Telemetry:");
  console.log(`      MT2_EXPANDED_STATES:          ${pressure.mt2ExpandedStates}`);
  console.log(`      STRUCTURAL_GROUP_COUNT:       ${pressure.structuralGroupCount}`);
  console.log(`      MULTI_VARIANT_GROUP_COUNT:    ${pressure.multiVariantGroupCount}`);
  console.log(`      RESOURCE_VARIANT_STATE_COUNT: ${pressure.resourceVariantStateCount}`);
  console.log(`      MAX_VARIANTS_IN_GROUP:        ${pressure.maxVariantsInGroup}`);
  console.log(`      PARETO_NONDOMINATED_COUNT:    ${pressure.paretoNondominatedCount}`);
  console.log(`      PARETO_DOMINATED_COUNT:       ${pressure.paretoDominatedCount}`);
  console.log(`      DOMINATED_FRACTION:           ${(pressure.dominatedFraction * 100).toFixed(2)}%`);
  console.log(`      MULTI_VARIANT_FRACTION:       ${(pressure.multiVariantFraction * 100).toFixed(2)}%`);

  if (args.phase1Only) {
    const artifact = {
      milestone: "PR-5.25n",
      phase0: { frontierReport, witnessEval },
      phase1: { control, pressure },
      phase2: null,
      verdict: "PHASE_1_MEASURED_PHASE_2_NOT_RUN",
    };
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, JSON.stringify(artifact, null, 2));
    console.log(`  result artifact:           ${path.relative(path.resolve(__dirname, ".."), args.out)}`);
    return;
  }

  // --- Phase 2: Pareto Resource Skyline Priority Qualification ---
  console.log("  Phase 2 Pareto Resource Skyline Priority Qualification:");
  console.log(`    running treatment (Pareto skyline priority dual queue)...`);
  const treatment = spawnArm(args, "treatment", false);
  console.log(`    treatment: found=${treatment.found} strategic=${treatment.strategicExpansions} (guided=${treatment.guidedExpansions} neutral=${treatment.neutralExpansions}) deepest=${treatment.deepestFloorOrdinal} stopped=${treatment.stoppedReason} wall=${treatment.wallMs}ms rss=${treatment.peakRssMb}MB`);

  let phase2Verdict = "LOCAL_GATE_FAILED";
  let primarySignal = false;
  if (treatment.found && treatment.replayValid) {
    if (!control.found) {
      phase2Verdict = "PARETO_RESOURCE_SKYLINE_SIGNAL_OBSERVED";
      primarySignal = true;
    } else {
      phase2Verdict = "BOTH_ARMS_FOUND";
    }
  } else if (!treatment.found && !control.found) {
    phase2Verdict = "NEITHER_ARM_FOUND_LOCAL_GATE_FAILED";
  } else {
    phase2Verdict = "CONTROL_ONLY_FOUND_ANOMALY";
  }

  console.log(`  PHASE_2_GATE:              ${primarySignal ? "PASS" : "FAIL"}`);
  console.log(`  verdict:                   ${phase2Verdict}`);

  const artifact = {
    milestone: "PR-5.25n",
    timestamp: new Date().toISOString(),
    protocol: {
      terminalGoal,
      budget: {
        maxRuntimeMs: args.maxRuntimeMs,
        maxRssMb: args.maxRssMb,
        maxExpansions: args.maxExpansions,
      },
    },
    phase0: {
      frontierReport: {
        targetTransitionDiscovery: frontierReport.targetTransitionDiscovery,
        noAuthoredTargetCoordinate: frontierReport.noAuthoredTargetCoordinate,
        derivedFloorEnvelope: frontierReport.derivedFloorEnvelope,
        derivedPreGoalFloors: frontierReport.derivedPreGoalFloors,
        derivedTargetTransitions: frontierReport.derivedTargetTransitions,
        derivedTargetPoiIdentities: frontierReport.derivedTargetPoiIdentities,
        allStrategicPoiCount: frontierReport.allStrategicPoiCount,
        frontierCount: frontierReport.frontierCount,
        alternativePathsCount: frontierReport.alternativePathsCount,
      },
      witnessEval,
    },
    phase1: {
      pressure,
    },
    phase2: {
      control,
      treatment,
      primarySignal,
      verdict: phase2Verdict,
    },
  };

  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, JSON.stringify(artifact, null, 2));
  console.log(`  result artifact:           ${path.relative(path.resolve(__dirname, ".."), args.out)}`);
}

module.exports = {
  main,
  verifyStrictReplay,
};

if (require.main === module) {
  main();
}
