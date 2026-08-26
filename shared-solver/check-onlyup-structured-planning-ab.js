"use strict";

/** TEST GRADE: local-regression */

/**
 * PR-5.23b Search Retention Shape & Floor-Boundary Structured Planning A/B Gate.
 *
 * Compares:
 *   A (Baseline): Flat Canonical DP search directly from MT1 -> MT6 with
 *                 captureFloorCheckpoints: false (uncontaminated canonical search).
 *   B (Candidate): Floor-Boundary Structured Planning Slice with process-isolated
 *                  segment lifecycles, Pareto checkpoint representative selection,
 *                  true memory release across stage boundaries, and strict replay.
 *
 * Hard constraints:
 *   - Production fast paths ON: autoBattleFastRejectEnabled=true, enableFastHazardBlockIndex=true.
 *   - Fail-closed native VM: enableCompiledEffectCache=false.
 *   - Chaos difficulty, start MT1, target MT6, 50k expansions, 30s wall, 256 MB RSS.
 */

const fs = require("node:fs");
const assert = require("node:assert");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { loadProject } = require("./lib/project-loader");
const { StaticSimulator } = require("./lib/simulator");
const { searchDP } = require("./lib/dp-search");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { selectParetoRepresentatives } = require("./lib/floor-checkpoints");
const { buildStateKey } = require("./lib/state-key");
const { resolveRecordedAction } = require("./lib/route-store");
const {
  EVIDENCE_SCHEMA,
  FIRST_REGION_TARGET_FLOOR_ID,
  MAX_EXPANDED_STATES,
  RSS_LIMIT_BYTES,
  WALL_LIMIT_MS,
  createNoStateChangeChoiceResolver,
  difficultySnapshot,
  isDecisionEntry,
  runOnlyUpFirstRegionRealRouteGate,
} = require("./lib/onlyup-mt1-real-route-gate");

const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const CHAOS_DIFFICULTY = { I581: 0, I582: 0, "flag:level0": 0 };

function serializeForGuard(value) {
  return JSON.stringify(value || {}, Object.keys(value || {}).sort());
}

/**
 * Executes a single floor stage search inside an isolated process.
 */
function runStageSubprocess(stageConfig) {
  const project = loadProject(DEFAULT_PROJECT_ROOT);
  const choiceResolver = createNoStateChangeChoiceResolver();
  const simulator = new StaticSimulator(project, {
    stopFloorId: stageConfig.targetFloorId || FIRST_REGION_TARGET_FLOOR_ID,
    battleResolver: new FunctionBackedBattleResolver(project, { enableFastReject: true }),
    autoBattleFastRejectEnabled: true,
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFastHazardBlockIndex: true,
    enableCompiledEffectCache: false,
    choiceResolver,
  });

  const startedAt = Date.now();
  let peakRssBytes = process.memoryUsage().rss;
  const edge = `${stageConfig.fromFloor}->${stageConfig.toFloor}`;
  const aggregatedPool = { edges: {} };
  let stageExpansions = 0;
  const inputFrontier = stageConfig.inputFrontier || [];

  for (let c = 0; c < inputFrontier.length; c++) {
    const candidate = inputFrontier[c];
    const candidateState = candidate.state;
    const res = searchDP(simulator, candidateState, {
      maxExpansions: stageConfig.stageMaxExpansions || 1500,
      maxRuntimeMs: stageConfig.stageMaxRuntimeMs || 10000,
      stopFloorId: stageConfig.targetFloorId || FIRST_REGION_TARGET_FLOOR_ID,
      targetFloorId: stageConfig.toFloor,
      captureFloorCheckpoints: true,
      sourceRepresentativeId: candidate.lineageId || candidate.id || `rep#${c}`,
      shouldStop: () => {
        const currentRss = process.memoryUsage().rss;
        peakRssBytes = Math.max(peakRssBytes, currentRss);
        return currentRss >= RSS_LIMIT_BYTES;
      },
    });

    stageExpansions += res.expansions;
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);

    const edgeCheckpoints = (res.checkpointPool && res.checkpointPool.edges[edge]) || [];
    if (edgeCheckpoints.length > 0) {
      if (!aggregatedPool.edges[edge]) aggregatedPool.edges[edge] = [];
      aggregatedPool.edges[edge].push(...edgeCheckpoints);
    }
  }

  const selectedReps = selectParetoRepresentatives(aggregatedPool, edge, {
    limit: stageConfig.repsLimit || 8,
  });

  return {
    edge,
    fromFloor: stageConfig.fromFloor,
    toFloor: stageConfig.toFloor,
    stageExpansions,
    checkpointPoolSize: (aggregatedPool.edges[edge] || []).length,
    repsCount: selectedReps.length,
    stagePeakRssMb: Math.round((peakRssBytes / 1048576) * 10) / 10,
    wallMs: Date.now() - startedAt,
    representatives: selectedReps.map((r) => ({
      id: r.id,
      lineageId: r.lineageId,
      sourceRepresentativeId: r.sourceRepresentativeId,
      role: r.representativeRole,
      roles: r.roles,
      hero: r.hero,
      route: r.route,
      routeLength: r.routeLength,
      state: r.state,
    })),
  };
}

/**
 * Strict Replay validator for a retained Pareto representative route.
 */
function verifyRepresentativeStrictReplay(project, rep) {
  const choiceResolver = createNoStateChangeChoiceResolver();
  const simulator = new StaticSimulator(project, {
    stopFloorId: FIRST_REGION_TARGET_FLOOR_ID,
    battleResolver: new FunctionBackedBattleResolver(project, { enableFastReject: true }),
    autoBattleFastRejectEnabled: true,
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFastHazardBlockIndex: true,
    enableCompiledEffectCache: false,
    choiceResolver,
  });

  let replayState = simulator.createInitialState();
  const initialDifficulty = difficultySnapshot(replayState);
  assert.deepStrictEqual(
    initialDifficulty,
    CHAOS_DIFFICULTY,
    "Replay must start on Chaos difficulty"
  );

  const route = Array.isArray(rep.route) ? rep.route : [];
  assert.ok(route.length > 0, `Rep ${rep.id} must have non-empty route`);

  let decisionsReplayed = 0;
  let identityGradedDecisions = 0;

  for (let index = 0; index < route.length; index += 1) {
    const entry = route[index];
    if (!isDecisionEntry(entry)) continue;

    const resolved = resolveRecordedAction(simulator, replayState, entry, {
      requireFingerprintMatch: true,
    });
    assert.ok(
      resolved != null && resolved.action != null,
      `Replay action not enumerated at step ${index} for rep ${rep.id}`
    );

    decisionsReplayed += 1;
    if (resolved.matchType === "identity" || resolved.fingerprintMatches) {
      identityGradedDecisions += 1;
    }

    replayState = simulator.applyAction(replayState, resolved.action, { storeRoute: true });
  }

  assert.strictEqual(
    replayState.floorId,
    rep.state.floorId,
    `Floor mismatch on rep ${rep.id}: expected ${rep.state.floorId}, got ${replayState.floorId}`
  );

  const replayedStateKey = buildStateKey(replayState);
  const targetStateKey = buildStateKey(rep.state);
  assert.strictEqual(
    replayedStateKey,
    targetStateKey,
    `StateKey mismatch on rep ${rep.id}`
  );

  const replayedDifficulty = difficultySnapshot(replayState);
  assert.deepStrictEqual(
    replayedDifficulty,
    CHAOS_DIFFICULTY,
    "Difficulty drift detected during replay"
  );
  assert.strictEqual(
    choiceResolver.unresolved.length,
    0,
    `Unresolved choice decisions during replay of rep ${rep.id}`
  );

  return {
    passed: true,
    decisionsReplayed,
    identityGradedDecisions,
    finalFloorId: replayState.floorId,
    exactStateKey: replayedStateKey,
  };
}

function main() {
  if (process.argv.includes("--stage-mode=stdin")) {
    const rawInput = fs.readFileSync(0, "utf8");
    const stageConfig = JSON.parse(rawInput);
    const stageResult = runStageSubprocess(stageConfig);
    console.log(JSON.stringify(stageResult));
    return;
  }

  const baselineMode = process.argv.includes("--baseline-only");
  if (baselineMode) {
    const baselineResult = runOnlyUpFirstRegionRealRouteGate({
      autoBattleFastRejectEnabled: true,
      enableFastHazardBlockIndex: true,
      enableCompiledEffectCache: false,
    });
    console.log(JSON.stringify(baselineResult));
    return;
  }

  const project = loadProject(DEFAULT_PROJECT_ROOT);

  // --- Subprocess helper ---
  const spawnStage = (stageConfig) => {
    const proc = spawnSync(
      process.execPath,
      [__filename, "--stage-mode=stdin"],
      {
        input: JSON.stringify(stageConfig),
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      }
    );
    if (proc.error) throw proc.error;
    if (proc.status !== 0) {
      throw new Error(`Stage subprocess failed (code ${proc.status}):\n${proc.stderr}\n${proc.stdout}`);
    }
    const lines = proc.stdout.trim().split("\n");
    return JSON.parse(lines[lines.length - 1]);
  };

  const spawnBaseline = () => {
    const proc = spawnSync(process.execPath, [__filename, "--baseline-only"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    if (proc.error) throw proc.error;
    if (proc.status !== 0) {
      throw new Error(`Baseline subprocess failed (code ${proc.status}):\n${proc.stderr}\n${proc.stdout}`);
    }
    const lines = proc.stdout.trim().split("\n");
    return JSON.parse(lines[lines.length - 1]);
  };

  // --- 1. Evaluate Baseline A (Flat Canonical DP) in Clean Subprocess ---
  const baselineA = spawnBaseline();
  assert.strictEqual(baselineA.verdict, "REAL_FIRST_REGION_GATE_FAILED");
  assert.strictEqual(baselineA.failureReason, "RESOURCE_LIMIT");
  assert.ok(["rss", "wall"].includes(baselineA.bindingConstraint));

  // --- 2. Evaluate Candidate B Stage 1 (MT1 -> MT2) in Clean Subprocess ---
  const initialSimulator = new StaticSimulator(project, {
    stopFloorId: FIRST_REGION_TARGET_FLOOR_ID,
    battleResolver: new FunctionBackedBattleResolver(project, { enableFastReject: true }),
    autoBattleFastRejectEnabled: true,
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFastHazardBlockIndex: true,
    enableCompiledEffectCache: false,
  });

  const stage1Result = spawnStage({
    fromFloor: "MT1",
    toFloor: "MT2",
    stageMaxExpansions: 1500,
    stageMaxRuntimeMs: 10000,
    repsLimit: 8,
    inputFrontier: [
      {
        id: "root",
        lineageId: "root",
        state: initialSimulator.createInitialState(),
        role: "initial",
      },
    ],
  });

  assert.strictEqual(stage1Result.edge, "MT1->MT2");
  assert.ok(stage1Result.checkpointPoolSize > 0, "Stage 1 must find checkpoints");
  assert.ok(stage1Result.repsCount >= 3, "Stage 1 must produce >= 3 Pareto reps");

  // Verify diversity of Pareto roles
  const stage1Roles = stage1Result.representatives.map((r) => r.role);
  assert.ok(stage1Roles.includes("highest-hp"), "Must contain highest-hp representative");
  assert.ok(
    stage1Roles.some((role) =>
      ["highest-atk", "highest-def", "highest-mdef", "highest-combat"].includes(role)
    ),
    "Must contain at least one combat investment representative"
  );

  // --- 3. Strict Replay Verification on ALL Retained Stage 1 Representatives ---
  let totalIdentityGradedDecisions = 0;
  let replayPassCount = 0;

  stage1Result.representatives.forEach((rep) => {
    const replaySummary = verifyRepresentativeStrictReplay(project, rep);
    assert.strictEqual(replaySummary.passed, true);
    totalIdentityGradedDecisions += replaySummary.identityGradedDecisions;
    replayPassCount += 1;
  });

  assert.strictEqual(
    replayPassCount,
    stage1Result.representatives.length,
    "All retained Stage 1 representatives must pass 100% strict replay"
  );

  // --- 4. Evaluate Candidate B Stage 2 (MT2 -> MT3) with Clean Stage Memory ---
  // In Stage 2, inputFrontier receives the 8 serialized representatives.
  // The Stage 1 heap/nodes are completely released by OS process boundary.
  const stage2Result = spawnStage({
    fromFloor: "MT2",
    toFloor: "MT3",
    stageMaxExpansions: 1500,
    stageMaxRuntimeMs: 10000,
    repsLimit: 8,
    inputFrontier: stage1Result.representatives,
  });

  const totalCandidateExpansions = stage1Result.stageExpansions + stage2Result.stageExpansions;
  const overallPeakRssMb = Math.max(stage1Result.stagePeakRssMb, stage2Result.stagePeakRssMb);

  const summary = {
    schema: "motapathfinder.structured-planning-ab.v1",
    contractStatus: "passed",
    baselineA: {
      mode: "flat-canonical-dp",
      captureFloorCheckpoints: false,
      verdict: baselineA.verdict,
      failureReason: baselineA.failureReason,
      bindingConstraint: baselineA.bindingConstraint,
      expansions: baselineA.metrics.expansions,
      wallMs: baselineA.metrics.wallMs,
      peakRssMb: baselineA.metrics.peakRssMb,
      deepestFloor: baselineA.bestProgress ? baselineA.bestProgress.floorId : "MT2",
    },
    candidateB: {
      mode: "floor-boundary-pareto-structured-planning",
      captureFloorCheckpoints: true,
      verdict: "STRUCTURED_PLANNING_STOPPED",
      failureReason: stage2Result.repsCount > 0 ? null : "NO_FORWARD_CHECKPOINTS",
      deepestFloor: stage2Result.repsCount > 0 ? "MT3" : "MT2",
      totalExpansions: totalCandidateExpansions,
      wallMs: stage1Result.wallMs + stage2Result.wallMs,
      peakRssMb: overallPeakRssMb,
      stage1: {
        edge: stage1Result.edge,
        expansions: stage1Result.stageExpansions,
        checkpointPoolSize: stage1Result.checkpointPoolSize,
        repsCount: stage1Result.repsCount,
        stagePeakRssMb: stage1Result.stagePeakRssMb,
        repsRoles: stage1Roles,
        representatives: stage1Result.representatives.map((r) => ({
          id: r.id,
          lineageId: r.lineageId,
          role: r.role,
          roles: r.roles,
          hero: r.hero,
          routeLength: r.routeLength,
        })),
      },
      stage2: {
        attempted: true,
        edge: stage2Result.edge,
        expansions: stage2Result.stageExpansions,
        checkpointPoolSize: stage2Result.checkpointPoolSize,
        repsCount: stage2Result.repsCount,
        stagePeakRssMb: stage2Result.stagePeakRssMb,
      },
      strictReplay: {
        representativesReplayed: stage1Result.representatives.length,
        representativesReplayPassed: replayPassCount,
        replayFailures: 0,
        identityGradedDecisions: totalIdentityGradedDecisions,
      },
    },
    mechanismQualification: {
      canonicalCheckpointCapture: true,
      paretoDiversity: true,
      allRetainedRepsStrictReplay: true,
      stage1Released: true,
      stage2Attempted: true,
    },
    capabilityQualification: {
      deepestFloor: stage2Result.repsCount > 0 ? "MT3" : "MT2",
      reachedMT3: stage2Result.repsCount > 0,
      reachedMT6: false,
    },
    promotion: false,
  };

  console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  }
}

module.exports = {
  main,
  runStageSubprocess,
  verifyRepresentativeStrictReplay,
};
