"use strict";

/**
 * PR-5.25m Repair 1 — Autonomous Structural Prerequisite Frontier & Dual-Queue Priority.
 *
 * PHASE 1: Autonomous Frontier Identification & Witness Recall Qualification
 *   1. Derived floor envelope MT1->MT2->MT3 via buildPlanningFloorEnvelope().
 *   2. Derived target transition MT2:6,12->MT3 via buildFloorTransitionGraph().
 *   3. Macro graph construction via buildAutomaticMacroGraph(project, initialState, terminalGoal).
 *   4. Bounded alternative dependency paths to discovered target transition & corridor resources.
 *   5. Frozen frontier evaluated against strictly replayed witness (observed precursors).
 *   6. Gates: TARGET_TRANSITION_DISCOVERY, NO_AUTHORED_TARGET_COORDINATE, ORACLE_VALID,
 *             OBSERVED_PRE_UNLOCK_RECALL == 1.0, FRONTIER < ALL_STRATEGIC.
 *
 * PHASE 2: Prerequisite-Prioritized Search Qualification (runs only after Phase 1 passes)
 *   CONTROL   = Repaired transport-collapsed FIFO strategic search
 *   TREATMENT = Identical search + dependency-frontier bounded-fair dual queue
 *   BUDGET    = 180s / 2048MB / 120k expansions (per-search child process isolation)
 *   GATE      = CHAOS_MT1_TO_MT3 == FOUND && STRICT_REPLAY_VALID
 *
 * Usage:
 *   node check-dependency-frontier.js [--smoke] [--phase1-only] [--out=PATH]
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
const DEFAULT_RESULT_PATH = path.resolve(__dirname, "routes", "generated", "dependency-frontier-phase1.result.json");
const WITNESS_REL_PATH = "shared-solver/routes/fixtures/mt1-mt3-i893-hp8425.route.json";

function parseArgs(argv) {
  const args = {
    smoke: false,
    phase1Only: false,
    out: DEFAULT_RESULT_PATH,
    child: false,
    arm: null,
    maxExpansions: 120000,
    maxRuntimeMs: 180000,
    maxRssMb: 2048,
    json: null,
  };
  for (const token of argv.slice(2)) {
    if (token === "--smoke") { args.smoke = true; continue; }
    if (token === "--phase1-only") { args.phase1Only = true; continue; }
    if (token === "--child") { args.child = true; continue; }
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
      args.out = path.resolve(__dirname, "routes", "generated", "dependency-frontier.smoke.result.json");
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
 * autonomous qualification harness enforces terminal-state equality and a
 * re-asserted goal predicate, not merely "steps enumerated and hero alive".
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
  let frontierSet = null;
  if (args.arm === "treatment") {
    const frontierReport = buildDependencyFrontier(project, initialState, terminalGoal);
    frontierSet = frontierReport.frontierSet;
  }

  const result = search.search(initialState, {
    isGoalState,
    allowedFloors,
    maxExpansions: args.maxExpansions,
    maxRuntimeMs: args.maxRuntimeMs,
    maxRssMb: args.maxRssMb,
    frontierSet,
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
  };

  fs.writeFileSync(args.json, JSON.stringify(summary));
}

function spawnArm(args, arm) {
  const jsonPath = path.join(os.tmpdir(), `dep-frontier-${process.pid}-${arm}.json`);
  const childArgs = [
    __filename, "--child", `--arm=${arm}`, `--json=${jsonPath}`,
    `--max-expansions=${args.maxExpansions}`, `--max-runtime-ms=${args.maxRuntimeMs}`,
    `--max-rss-mb=${args.maxRssMb}`,
  ];
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

  console.log("PR-5.25m Repair 1 — Autonomous Structural Prerequisite Frontier");

  const project = loadProject(PROJECT_ROOT);
  const simulator = makeSimulator(project);
  const initialState = simulator.createInitialState({ rank: "chaos" });
  const terminalGoal = { type: "floorReached", floorId: "MT3" };

  // --- Step 1 & 2: Route-free autonomous discovery & frontier construction ---
  const frontierReport = buildDependencyFrontier(project, initialState, terminalGoal);

  console.log("  Phase 1 Autonomous Frontier Discovery:");
  console.log(`    derived floor envelope:     ${frontierReport.derivedFloorEnvelope.join(" -> ")}`);
  console.log(`    derived target transition:  ${frontierReport.derivedTargetTransitions.map((t) => `${t.floorId}:${t.at}->${t.targetFloorId}`).join(", ")}`);
  console.log(`    derived target POI identity: ${frontierReport.derivedTargetPoiIdentities.join(", ")}`);
  console.log(`    TARGET_TRANSITION_DISCOVERY:${frontierReport.targetTransitionDiscovery}`);
  console.log(`    NO_AUTHORED_COORDINATE:     ${frontierReport.noAuthoredTargetCoordinate}`);
  console.log(`    ALL_STRATEGIC_POIS:         ${frontierReport.allStrategicPoiCount}`);
  console.log(`    FRONTIER:                   ${frontierReport.frontierCount}`);

  requireCondition(
    frontierReport.targetTransitionDiscovery === "DERIVED_FROM_PROJECT_AND_TERMINAL_GOAL",
    "Target transition must be derived from project and terminal goal",
  );
  requireCondition(
    frontierReport.noAuthoredTargetCoordinate === true,
    "Target coordinates must not be authored inputs",
  );

  // --- Step 3: Strict witness recall evaluation ---
  const witnessEval = evaluateWitnessRecall(
    project,
    WITNESS_REL_PATH,
    frontierReport.frontierSet,
    frontierReport.allStrategicPoiCount,
    "MT2",
    "MT3",
  );

  console.log("  Phase 1 Witness Recall Evaluation:");
  console.log(`    ORACLE_VALID:               ${witnessEval.oracleValid}`);
  console.log(`    oracle_count:               ${witnessEval.oracle_count}`);
  console.log(`    frontier_count:             ${witnessEval.frontier_count}`);
  console.log(`    all_strategic_poi_count:    ${witnessEval.all_strategic_poi_count}`);
  console.log(`    intersection_count:         ${witnessEval.intersection_count}`);
  console.log(`    observed_pre_unlock_recall: ${witnessEval.observed_pre_unlock_recall}`);
  console.log(`    frontier_fraction:          ${witnessEval.frontier_fraction_of_all_strategic_pois.toFixed(4)}`);
  console.log(`    missed_by_kind:             ${JSON.stringify(witnessEval.missed_by_kind)}`);
  console.log(`    extra_frontier_by_kind:     ${JSON.stringify(witnessEval.extra_frontier_by_kind)}`);
  console.log(`    PHASE_1_GATE:               ${witnessEval.phase1Pass ? "PASS" : "FAIL"}`);

  requireCondition(witnessEval.oracleValid, "ORACLE_VALID must be true", witnessEval);
  requireCondition(witnessEval.phase1Pass, "PHASE_1_PASS must pass before Phase 2", witnessEval);

  if (args.phase1Only) {
    const artifact = {
      milestone: "PR-5.25m-repair-1",
      phase1: {
        frontierReport: {
          targetTransitionDiscovery: frontierReport.targetTransitionDiscovery,
          noAuthoredTargetCoordinate: frontierReport.noAuthoredTargetCoordinate,
          derivedFloorEnvelope: frontierReport.derivedFloorEnvelope,
          derivedTargetTransitions: frontierReport.derivedTargetTransitions,
          derivedTargetPoiIdentities: frontierReport.derivedTargetPoiIdentities,
          allStrategicPoiCount: frontierReport.allStrategicPoiCount,
          frontierCount: frontierReport.frontierCount,
          alternativePathsCount: frontierReport.alternativePathsCount,
        },
        witnessEval,
      },
      phase2: null,
      verdict: "PHASE_1_PASS_PHASE_2_NOT_RUN",
    };
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, JSON.stringify(artifact, null, 2));
    console.log(`  result artifact:           ${path.relative(path.resolve(__dirname, ".."), args.out)}`);
    return;
  }

  // --- Phase 2: Prerequisite-Prioritized Search Qualification ---
  console.log("  Phase 2 prerequisite-prioritized search qualification:");
  console.log(`    budget: ${args.maxRuntimeMs / 1000}s / ${args.maxRssMb}MB / ${args.maxExpansions} expansions`);

  console.log("    running control (FIFO)...");
  const control = spawnArm(args, "control");
  console.log(`    control:   found=${control.found} strategic=${control.strategicExpansions} deepest=${control.deepestFloorOrdinal} stopped=${control.stoppedReason} wall=${control.wallMs}ms rss=${control.peakRssMb}MB`);

  console.log("    running treatment (dependency-guided dual queue)...");
  const treatment = spawnArm(args, "treatment");
  console.log(`    treatment: found=${treatment.found} strategic=${treatment.strategicExpansions} (guided=${treatment.guidedExpansions} neutral=${treatment.neutralExpansions}) deepest=${treatment.deepestFloorOrdinal} stopped=${treatment.stoppedReason} wall=${treatment.wallMs}ms rss=${treatment.peakRssMb}MB`);

  let phase2Verdict = "LOCAL_GATE_FAILED";
  let primarySignal = false;
  if (treatment.found && treatment.replayValid) {
    if (!control.found) {
      phase2Verdict = "STRUCTURAL_PREREQUISITE_PRIORITY_SIGNAL_OBSERVED";
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
    milestone: "PR-5.25m-repair-1",
    timestamp: new Date().toISOString(),
    protocol: {
      targetGoal: terminalGoal,
      budget: {
        maxRuntimeMs: args.maxRuntimeMs,
        maxRssMb: args.maxRssMb,
        maxExpansions: args.maxExpansions,
      },
    },
    phase1: {
      frontierReport: {
        targetTransitionDiscovery: frontierReport.targetTransitionDiscovery,
        noAuthoredTargetCoordinate: frontierReport.noAuthoredTargetCoordinate,
        derivedFloorEnvelope: frontierReport.derivedFloorEnvelope,
        derivedTargetTransitions: frontierReport.derivedTargetTransitions,
        derivedTargetPoiIdentities: frontierReport.derivedTargetPoiIdentities,
        allStrategicPoiCount: frontierReport.allStrategicPoiCount,
        frontierCount: frontierReport.frontierCount,
        alternativePathsCount: frontierReport.alternativePathsCount,
      },
      witnessEval,
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
