"use strict";

/** TEST GRADE: local-regression */

/**
 * PR-5.23c Fair Multi-Representative Stage Scheduler & MT2->MT3 Capability Gate.
 *
 * Compares:
 *   A (Baseline): Flat Canonical DP search directly from MT1 -> MT6 with
 *                 captureFloorCheckpoints: false (uncontaminated canonical search).
 *   B (Candidate): Fair Multi-Representative Process-Isolated Structured Planning.
 *                  Every Stage 1 retained Pareto representative gets an isolated
 *                  search process with guaranteed non-zero search budget (zero starvation),
 *                  followed by focused multi-round strategic deep exploration.
 *
 * Hard constraints:
 *   - Production fast paths ON: autoBattleFastRejectEnabled=true, enableFastHazardBlockIndex=true.
 *   - Fail-closed native VM: enableCompiledEffectCache=false.
 *   - Chaos difficulty, start MT1, target MT6, 50k expansions, 30s wall, 256 MB RSS per process.
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
 * Executes search on a single representative in an isolated process.
 */
function runSingleRepresentativeSubprocess(config) {
  const project = loadProject(DEFAULT_PROJECT_ROOT);
  const choiceResolver = createNoStateChangeChoiceResolver();
  const simulator = new StaticSimulator(project, {
    stopFloorId: config.targetFloorId || FIRST_REGION_TARGET_FLOOR_ID,
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
  const edge = `${config.fromFloor}->${config.toFloor}`;
  const candidate = config.candidate;

  const res = searchDP(simulator, candidate.state, {
    maxExpansions: config.maxExpansions || 1500,
    maxRuntimeMs: config.maxRuntimeMs || 10000,
    stopFloorId: config.targetFloorId || FIRST_REGION_TARGET_FLOOR_ID,
    targetFloorId: config.toFloor,
    captureFloorCheckpoints: true,
    sourceRepresentativeId: candidate.lineageId || candidate.id || "root",
    shouldStop: () => {
      const currentRss = process.memoryUsage().rss;
      peakRssBytes = Math.max(peakRssBytes, currentRss);
      return currentRss >= RSS_LIMIT_BYTES;
    },
  });

  peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  const edgeCheckpoints = (res.checkpointPool && res.checkpointPool.edges[edge]) || [];

  return {
    candidateId: candidate.id,
    lineageId: candidate.lineageId || candidate.id,
    role: candidate.role || candidate.representativeRole,
    hero: candidate.hero,
    expansions: res.expansions,
    stoppedReason: res.stoppedReason,
    deepestFloor: res.bestProgressState ? res.bestProgressState.floorId : config.fromFloor,
    peakRssMb: Math.round((peakRssBytes / 1048576) * 10) / 10,
    wallMs: Date.now() - startedAt,
    checkpointCount: edgeCheckpoints.length,
    checkpoints: edgeCheckpoints.map((c) => ({
      id: c.id,
      lineageId: c.lineageId,
      sourceRepresentativeId: c.sourceRepresentativeId,
      role: c.representativeRole,
      roles: c.roles,
      hero: c.hero,
      route: c.route,
      routeLength: c.routeLength,
      state: c.state,
    })),
  };
}

/**
 * Executes a full stage search (e.g. Stage 1 MT1->MT2 root search).
 */
function runStage1Subprocess(config) {
  const project = loadProject(DEFAULT_PROJECT_ROOT);
  const choiceResolver = createNoStateChangeChoiceResolver();
  const simulator = new StaticSimulator(project, {
    stopFloorId: config.targetFloorId || FIRST_REGION_TARGET_FLOOR_ID,
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
  const edge = `${config.fromFloor}->${config.toFloor}`;
  const rootState = simulator.createInitialState();

  const res = searchDP(simulator, rootState, {
    maxExpansions: config.maxExpansions || 2000,
    maxRuntimeMs: config.maxRuntimeMs || 10000,
    stopFloorId: config.targetFloorId || FIRST_REGION_TARGET_FLOOR_ID,
    targetFloorId: config.toFloor,
    captureFloorCheckpoints: true,
    sourceRepresentativeId: "root",
    shouldStop: () => {
      const currentRss = process.memoryUsage().rss;
      peakRssBytes = Math.max(peakRssBytes, currentRss);
      return currentRss >= RSS_LIMIT_BYTES;
    },
  });

  peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  const edgeCheckpoints = (res.checkpointPool && res.checkpointPool.edges[edge]) || [];
  const selectedReps = selectParetoRepresentatives(res.checkpointPool, edge, {
    limit: config.repsLimit || 8,
  });

  return {
    edge,
    fromFloor: config.fromFloor,
    toFloor: config.toFloor,
    stageExpansions: res.expansions,
    checkpointPoolSize: edgeCheckpoints.length,
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
  // --- Subprocess dispatchers ---
  if (process.argv.includes("--stage1-mode")) {
    const rawInput = fs.readFileSync(0, "utf8");
    const config = JSON.parse(rawInput);
    const result = runStage1Subprocess(config);
    console.log(JSON.stringify(result));
    return;
  }

  if (process.argv.includes("--rep-search-mode")) {
    const rawInput = fs.readFileSync(0, "utf8");
    const config = JSON.parse(rawInput);
    const result = runSingleRepresentativeSubprocess(config);
    console.log(JSON.stringify(result));
    return;
  }

  if (process.argv.includes("--baseline-only")) {
    const baselineResult = runOnlyUpFirstRegionRealRouteGate({
      autoBattleFastRejectEnabled: true,
      enableFastHazardBlockIndex: true,
      enableCompiledEffectCache: false,
    });
    console.log(JSON.stringify(baselineResult));
    return;
  }

  const project = loadProject(DEFAULT_PROJECT_ROOT);

  // --- Subprocess spawners ---
  const spawnStage1 = (config) => {
    const proc = spawnSync(process.execPath, [__filename, "--stage1-mode"], {
      input: JSON.stringify(config),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    if (proc.error) throw proc.error;
    if (proc.status !== 0) {
      throw new Error(`Stage 1 failed (code ${proc.status}):\n${proc.stderr}\n${proc.stdout}`);
    }
    const lines = proc.stdout.trim().split("\n");
    return JSON.parse(lines[lines.length - 1]);
  };

  const spawnRepSearch = (config) => {
    const proc = spawnSync(process.execPath, [__filename, "--rep-search-mode"], {
      input: JSON.stringify(config),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    if (proc.error) throw proc.error;
    if (proc.status !== 0) {
      throw new Error(`Rep search failed (code ${proc.status}):\n${proc.stderr}\n${proc.stdout}`);
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
      throw new Error(`Baseline failed (code ${proc.status}):\n${proc.stderr}\n${proc.stdout}`);
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
  const stage1Result = spawnStage1({
    fromFloor: "MT1",
    toFloor: "MT2",
    maxExpansions: 1500,
    maxRuntimeMs: 10000,
    repsLimit: 8,
  });

  assert.strictEqual(stage1Result.edge, "MT1->MT2");
  assert.ok(stage1Result.checkpointPoolSize > 0, "Stage 1 must find checkpoints");
  assert.ok(stage1Result.repsCount >= 3, "Stage 1 must produce >= 3 Pareto reps");

  const stage1Roles = stage1Result.representatives.map((r) => r.role);
  assert.ok(stage1Roles.includes("highest-hp"), "Must contain highest-hp representative");
  assert.ok(
    stage1Roles.some((role) =>
      ["highest-atk", "highest-def", "highest-mdef", "highest-combat"].includes(role)
    ),
    "Must contain at least one combat investment representative"
  );

  // --- 3. Strict Replay Verification on ALL Retained Stage 1 Representatives ---
  let stage1IdentityGradedDecisions = 0;
  let stage1ReplayPassCount = 0;

  stage1Result.representatives.forEach((rep) => {
    const replaySummary = verifyRepresentativeStrictReplay(project, rep);
    assert.strictEqual(replaySummary.passed, true);
    stage1IdentityGradedDecisions += replaySummary.identityGradedDecisions;
    stage1ReplayPassCount += 1;
  });

  assert.strictEqual(
    stage1ReplayPassCount,
    stage1Result.representatives.length,
    "All retained Stage 1 representatives must pass 100% strict replay"
  );

  // --- 4. Fair Multi-Representative Scheduler for Stage 2 (MT2 -> MT3) ---
  // Round 1: Deterministic Fair Slices across all 8 Stage 1 representatives.
  // Each representative runs in its own freshly spawned process (Zero Starvation, Clean RSS).
  const stage2Round1Results = [];
  let stage2TotalExpansions = 0;
  let stage2TotalWallMs = 0;
  let stage2PeakRssMb = 0;
  const stage2AggregatedPool = { edges: { "MT2->MT3": [] } };

  for (let i = 0; i < stage1Result.representatives.length; i++) {
    const rep = stage1Result.representatives[i];
    const repResult = spawnRepSearch({
      candidate: rep,
      fromFloor: "MT2",
      toFloor: "MT3",
      maxExpansions: 500,
      maxRuntimeMs: 2500,
      targetFloorId: FIRST_REGION_TARGET_FLOOR_ID,
    });

    stage2Round1Results.push(repResult);
    stage2TotalExpansions += repResult.expansions;
    stage2TotalWallMs += repResult.wallMs;
    stage2PeakRssMb = Math.max(stage2PeakRssMb, repResult.peakRssMb);

    if (repResult.checkpoints && repResult.checkpoints.length > 0) {
      stage2AggregatedPool.edges["MT2->MT3"].push(...repResult.checkpoints);
    }
  }

  // Hard assertion: Zero representative starvation!
  assert.strictEqual(
    stage2Round1Results.length,
    stage1Result.representatives.length,
    "All Stage 1 representatives must be scheduled in Stage 2"
  );
  stage2Round1Results.forEach((r, idx) => {
    assert.ok(
      r.expansions > 0,
      `Representative ${idx} (${r.role}) must receive non-zero expansions (starvation forbidden!)`
    );
  });

  // Stage 2 Round 2: Focused strategic deep search on top distinct representatives if MT3 not yet found
  const stage2Round2Results = [];
  if (stage2AggregatedPool.edges["MT2->MT3"].length === 0) {
    // Select top 3 distinct strategic representatives:
    // 1. Highest HP survival representative
    // 2. Highest ATK / DEF combat representative
    // 3. Highest MDEF / EXP resource representative
    const focusRoles = ["highest-hp", "highest-atk", "highest-mdef"];
    const focusCandidates = [];
    focusRoles.forEach((role) => {
      const match = stage1Result.representatives.find((r) => r.role === role);
      if (match && !focusCandidates.includes(match)) focusCandidates.push(match);
    });

    for (const focusRep of focusCandidates) {
      const deepResult = spawnRepSearch({
        candidate: focusRep,
        fromFloor: "MT2",
        toFloor: "MT3",
        maxExpansions: 1500,
        maxRuntimeMs: 4000,
        targetFloorId: FIRST_REGION_TARGET_FLOOR_ID,
      });

      stage2Round2Results.push(deepResult);
      stage2TotalExpansions += deepResult.expansions;
      stage2TotalWallMs += deepResult.wallMs;
      stage2PeakRssMb = Math.max(stage2PeakRssMb, deepResult.peakRssMb);

      if (deepResult.checkpoints && deepResult.checkpoints.length > 0) {
        stage2AggregatedPool.edges["MT2->MT3"].push(...deepResult.checkpoints);
      }
    }
  }

  // Checkpoint selection & strict replay for Stage 2 (if any forward checkpoints found)
  const stage2Checkpoints = stage2AggregatedPool.edges["MT2->MT3"];
  const stage2Reps = selectParetoRepresentatives(stage2AggregatedPool, "MT2->MT3", { limit: 8 });

  let reachedMT3 = false;
  let stage2IdentityGradedDecisions = 0;
  if (stage2Reps.length > 0) {
    let stage2ReplayPassCount = 0;
    stage2Reps.forEach((rep) => {
      const replaySummary = verifyRepresentativeStrictReplay(project, rep);
      if (replaySummary.passed) {
        stage2IdentityGradedDecisions += replaySummary.identityGradedDecisions;
        stage2ReplayPassCount += 1;
      }
    });
    reachedMT3 = stage2ReplayPassCount === stage2Reps.length && stage2Reps.length > 0;
  }

  const globalTotalExpansions = stage1Result.stageExpansions + stage2TotalExpansions;
  const globalWallMs = stage1Result.wallMs + stage2TotalWallMs;
  const overallPeakRssMb = Math.max(stage1Result.stagePeakRssMb, stage2PeakRssMb);

  // Budget invariance assertions
  assert.ok(globalTotalExpansions <= MAX_EXPANDED_STATES, `Global expansions (${globalTotalExpansions}) exceeds 50k`);
  assert.ok(globalWallMs <= WALL_LIMIT_MS, `Global wall time (${globalWallMs}ms) exceeds 30s`);
  assert.ok(overallPeakRssMb <= 256 * 1.05, `Peak process RSS (${overallPeakRssMb}MB) exceeds limit`);

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
      mode: "fair-multi-representative-process-isolated-planning",
      captureFloorCheckpoints: true,
      verdict: "STRUCTURED_PLANNING_STOPPED",
      failureReason: reachedMT3 ? null : "NO_FORWARD_CHECKPOINTS",
      deepestFloor: reachedMT3 ? "MT3" : "MT2",
      totalExpansions: globalTotalExpansions,
      wallMs: globalWallMs,
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
        strictReplay: {
          representativesReplayed: stage1Result.representatives.length,
          representativesReplayPassed: stage1ReplayPassCount,
          replayFailures: 0,
          identityGradedDecisions: stage1IdentityGradedDecisions,
        },
      },
      stage2: {
        attempted: true,
        edge: "MT2->MT3",
        totalExpansions: stage2TotalExpansions,
        checkpointPoolSize: stage2Checkpoints.length,
        repsCount: stage2Reps.length,
        stagePeakRssMb: stage2PeakRssMb,
        perRepresentative: stage2Round1Results.map((r) => ({
          candidateId: r.candidateId,
          lineageId: r.lineageId,
          role: r.role,
          hero: r.hero,
          expansions: r.expansions,
          peakRssMb: r.peakRssMb,
          wallMs: r.wallMs,
          deepestFloor: r.deepestFloor,
          checkpointCount: r.checkpointCount,
          stoppedReason: r.stoppedReason,
        })),
        round2FocusCount: stage2Round2Results.length,
        round2Expansions: stage2Round2Results.reduce((sum, r) => sum + r.expansions, 0),
      },
    },
    mechanismQualification: {
      canonicalCheckpointCapture: true,
      paretoDiversity: true,
      allStage1RepsStrictReplay: true,
      allStage2RepsAttempted: true,
      noRepresentativeStarvation: true,
      processLifecycleIsolation: true,
    },
    capabilityQualification: {
      deepestFloor: reachedMT3 ? "MT3" : "MT2",
      reachedMT3,
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
  runStage1Subprocess,
  runSingleRepresentativeSubprocess,
  verifyRepresentativeStrictReplay,
};
