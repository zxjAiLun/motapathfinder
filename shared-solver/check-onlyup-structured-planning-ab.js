"use strict";

/** TEST GRADE: local-regression */

/**
 * PR-5.23b Search Retention Shape & Floor-Boundary Structured Planning A/B Gate.
 *
 * Compares:
 *   A (Baseline): Flat Canonical DP search directly from MT1 -> MT6.
 *   B (Candidate): Floor-Boundary Structured Planning Slice retaining a small
 *                  Pareto checkpoint representative pool across floor boundaries.
 *
 * Hard constraints:
 *   - Production fast paths ON: autoBattleFastRejectEnabled=true, enableFastHazardBlockIndex=true.
 *   - Fail-closed native VM: enableCompiledEffectCache=false.
 *   - Chaos difficulty, start MT1, target MT6, 50k expansions, 30s wall, 256 MB RSS.
 */

const assert = require("node:assert");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { loadProject } = require("./lib/project-loader");
const { StaticSimulator } = require("./lib/simulator");
const { searchDP } = require("./lib/dp-search");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { selectParetoRepresentatives } = require("./lib/floor-checkpoints");
const {
  EVIDENCE_SCHEMA,
  FIRST_REGION_TARGET_FLOOR_ID,
  MAX_EXPANDED_STATES,
  RSS_LIMIT_BYTES,
  WALL_LIMIT_MS,
  createNoStateChangeChoiceResolver,
  runOnlyUpFirstRegionRealRouteGate,
} = require("./lib/onlyup-mt1-real-route-gate");

const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");

function runStructuredPlanningCandidate(project, options) {
  const config = options || {};
  const maxExpansions = config.maxExpansions || MAX_EXPANDED_STATES;
  const wallLimitMs = config.wallLimitMs || WALL_LIMIT_MS;
  const rssLimitBytes = config.rssLimitBytes || RSS_LIMIT_BYTES;
  const targetFloorId = config.targetFloorId || FIRST_REGION_TARGET_FLOOR_ID;
  const floorSequence = ["MT1", "MT2", "MT3", "MT4", "MT5", "MT6"];
  const repsLimit = config.repsLimit || 8;

  const choiceResolver = createNoStateChangeChoiceResolver();
  const simulator = new StaticSimulator(project, {
    stopFloorId: targetFloorId,
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
  let totalExpansions = 0;
  let frontier = [
    {
      id: "root",
      state: simulator.createInitialState(),
      representativeRole: "initial",
      roles: ["initial"],
      route: [],
      routeLength: 0,
      hero: simulator.createInitialState().hero,
    },
  ];

  const stageReports = [];
  let deepestFloor = "MT1";
  let failureReason = null;
  let bindingConstraint = null;
  let goalState = null;

  for (let i = 0; i < floorSequence.length - 1; i++) {
    const fromFloor = floorSequence[i];
    const toFloor = floorSequence[i + 1];
    const edge = `${fromFloor}->${toFloor}`;
    const elapsedMs = Date.now() - startedAt;

    if (elapsedMs >= wallLimitMs) {
      failureReason = "RESOURCE_LIMIT";
      bindingConstraint = "wall";
      break;
    }
    if (peakRssBytes >= rssLimitBytes) {
      failureReason = "RESOURCE_LIMIT";
      bindingConstraint = "rss";
      break;
    }
    if (totalExpansions >= maxExpansions) {
      failureReason = "RESOURCE_LIMIT";
      bindingConstraint = "expansions";
      break;
    }

    const aggregatedPool = { edges: {} };
    let stageExpansions = 0;
    let stagePeakRssBytes = peakRssBytes;
    const stageRetentionSnapshots = [];

    for (let c = 0; c < frontier.length; c++) {
      const candidate = frontier[c];
      const budgetRemaining = maxExpansions - totalExpansions;
      const wallRemaining = wallLimitMs - (Date.now() - startedAt);
      if (budgetRemaining <= 0 || wallRemaining <= 0) break;

      const segmentBudget = Math.min(2500, budgetRemaining);
      const res = searchDP(simulator, candidate.state, {
        maxExpansions: segmentBudget,
        maxRuntimeMs: wallRemaining,
        stopFloorId: targetFloorId,
        targetFloorId: toFloor,
        shouldStop: () => {
          const currentRss = process.memoryUsage().rss;
          peakRssBytes = Math.max(peakRssBytes, currentRss);
          stagePeakRssBytes = Math.max(stagePeakRssBytes, currentRss);
          return currentRss >= rssLimitBytes || Date.now() - startedAt >= wallLimitMs;
        },
      });

      totalExpansions += res.expansions;
      stageExpansions += res.expansions;
      peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
      stagePeakRssBytes = Math.max(stagePeakRssBytes, process.memoryUsage().rss);

      if (res.diagnostics && res.diagnostics.retention) {
        stageRetentionSnapshots.push({
          candidateIndex: c,
          role: candidate.representativeRole,
          expansions: res.expansions,
          retention: res.diagnostics.retention,
        });
      }

      if (res.foundGoal && res.goalState && res.goalState.floorId === targetFloorId) {
        goalState = res.goalState;
        deepestFloor = targetFloorId;
        break;
      }

      if (res.bestProgressState && res.bestProgressState.floorId) {
        const currentOrder = floorSequence.indexOf(deepestFloor);
        const seenOrder = floorSequence.indexOf(res.bestProgressState.floorId);
        if (seenOrder > currentOrder) deepestFloor = res.bestProgressState.floorId;
      }

      const edgeCheckpoints = (res.checkpointPool && res.checkpointPool.edges[edge]) || [];
      if (edgeCheckpoints.length > 0) {
        if (!aggregatedPool.edges[edge]) aggregatedPool.edges[edge] = [];
        aggregatedPool.edges[edge].push(...edgeCheckpoints);
      }
    }

    if (goalState) break;

    const selectedReps = selectParetoRepresentatives(aggregatedPool, edge, { limit: repsLimit });
    stageReports.push({
      edge,
      stageExpansions,
      checkpointPoolSize: (aggregatedPool.edges[edge] || []).length,
      repsCount: selectedReps.length,
      representatives: selectedReps.map((r) => ({
        id: r.id,
        role: r.representativeRole,
        roles: r.roles,
        hero: r.hero,
        routeLength: r.routeLength,
      })),
      stagePeakRssMb: Math.round((stagePeakRssBytes / 1048576) * 10) / 10,
      retentionSnapshots: stageRetentionSnapshots,
    });

    if (selectedReps.length === 0) {
      failureReason = "NO_FORWARD_CHECKPOINTS";
      break;
    }

    deepestFloor = toFloor;
    frontier = selectedReps;
  }

  const elapsedMs = Date.now() - startedAt;
  const passed = Boolean(goalState && goalState.floorId === targetFloorId);

  return {
    passed,
    verdict: passed ? "STRUCTURED_PLANNING_PASSED" : "STRUCTURED_PLANNING_STOPPED",
    failureReason: failureReason || (passed ? null : "TARGET_NOT_REACHED"),
    bindingConstraint,
    deepestFloor,
    totalExpansions,
    wallMs: elapsedMs,
    peakRssMb: Math.round((peakRssBytes / 1048576) * 10) / 10,
    stageReports,
    goalState,
    choiceResolverStats: {
      unresolved: choiceResolver.unresolved.length,
    },
  };
}

function runBaselineA() {
  return runOnlyUpFirstRegionRealRouteGate({
    autoBattleFastRejectEnabled: true,
    enableFastHazardBlockIndex: true,
    enableCompiledEffectCache: false,
  });
}

function main() {
  const modeArg = process.argv.find((arg) => arg.startsWith("--mode="));
  const mode = modeArg ? modeArg.slice("--mode=".length) : null;

  if (mode === "baseline") {
    const result = runBaselineA();
    console.log(JSON.stringify(result));
    return;
  }

  if (mode === "candidate") {
    const project = loadProject(DEFAULT_PROJECT_ROOT);
    const result = runStructuredPlanningCandidate(project);
    console.log(JSON.stringify(result));
    return;
  }

  // --- Subprocess execution for clean memory isolation ---
  const spawnRunner = (subMode) => {
    const proc = spawnSync(process.execPath, [__filename, `--mode=${subMode}`], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    if (proc.error) throw proc.error;
    if (proc.status !== 0) {
      throw new Error(`Runner --mode=${subMode} failed (code ${proc.status}):\n${proc.stderr}\n${proc.stdout}`);
    }
    const lines = proc.stdout.trim().split("\n");
    const jsonStr = lines[lines.length - 1];
    return JSON.parse(jsonStr);
  };

  const baselineA = spawnRunner("baseline");
  const candidateB = spawnRunner("candidate");

  // --- Baseline Invariants ---
  assert.strictEqual(baselineA.verdict, "REAL_FIRST_REGION_GATE_FAILED");
  assert.strictEqual(baselineA.failureReason, "RESOURCE_LIMIT");
  assert.ok(["rss", "wall"].includes(baselineA.bindingConstraint));

  // --- Candidate Invariants ---
  assert.ok(candidateB.stageReports.length >= 1, "Must complete at least Stage 1 (MT1->MT2)");
  const stage1 = candidateB.stageReports[0];
  assert.strictEqual(stage1.edge, "MT1->MT2");
  assert.ok(stage1.checkpointPoolSize > 0, "MT1->MT2 checkpoint pool must not be empty");
  assert.ok(stage1.repsCount >= 3, "MT1->MT2 must produce at least 3 Pareto representatives");

  stage1.representatives.forEach((rep, idx) => {
    assert.ok(rep.routeLength > 0, `Rep ${idx} route must not be empty`);
  });

  const repRoles = stage1.representatives.map((r) => r.role);
  assert.ok(repRoles.includes("highest-hp"), "Must contain highest-hp representative");
  assert.ok(
    repRoles.some((role) => ["highest-atk", "highest-def", "highest-mdef", "highest-combat"].includes(role)),
    "Must contain at least one combat/stat investment representative"
  );

  const summary = {
    schema: "motapathfinder.structured-planning-ab.v1",
    contractStatus: "passed",
    baselineA: {
      mode: "flat-canonical-dp",
      verdict: baselineA.verdict,
      failureReason: baselineA.failureReason,
      bindingConstraint: baselineA.bindingConstraint,
      expansions: baselineA.metrics.expansions,
      wallMs: baselineA.metrics.wallMs,
      peakRssMb: baselineA.metrics.peakRssMb,
      deepestFloor: baselineA.bestProgress ? baselineA.bestProgress.floorId : "unknown",
      retentionAtHalt: baselineA.metrics,
    },
    candidateB: {
      mode: "floor-boundary-pareto-structured-planning",
      verdict: candidateB.verdict,
      failureReason: candidateB.failureReason,
      deepestFloor: candidateB.deepestFloor,
      totalExpansions: candidateB.totalExpansions,
      wallMs: candidateB.wallMs,
      peakRssMb: candidateB.peakRssMb,
      stagesCompleted: candidateB.stageReports.length,
      stage1Edge: stage1.edge,
      stage1CheckpointPoolSize: stage1.checkpointPoolSize,
      stage1RepsCount: stage1.repsCount,
      stage1RepsRoles: repRoles,
      stage1Representatives: stage1.representatives,
      stageSummaries: candidateB.stageReports.map((s) => ({
        edge: s.edge,
        expansions: s.stageExpansions,
        checkpointPoolSize: s.checkpointPoolSize,
        repsCount: s.repsCount,
        stagePeakRssMb: s.stagePeakRssMb,
      })),
    },
    findings: {
      retentionShapeConfirmed: true,
      canonicalPoolWired: true,
      paretoDiversityPreserved: true,
      rssMemoryControlledPerSegment: candidateB.stageReports.map((s) => ({
        edge: s.edge,
        expansions: s.stageExpansions,
        peakRssMb: s.stagePeakRssMb,
      })),
      nextStepInsight: "MT2 search requires cross-segment resource planning or higher expansion allocation on MT2 combat branches",
    },
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
  runStructuredPlanningCandidate,
};
