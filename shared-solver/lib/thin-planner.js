"use strict";

/**
 * PR-5.24b Iteration 2b – Thin Canonical Planner
 *
 * Thin planner process never loads project or constructs StaticSimulator.
 * It owns: milestone history, rollback depth, global budget, compact candidate state.
 * Heavy work (project + simulator + DP) is done in fresh segment workers and
 * one-time bootstrap worker.
 *
 * Repair 1:
 *  - whole-run deadline: bootstrap + segment graph share one globalBudget created
 *    from segment-dp's authoritative createGlobalBudget (no duplicated schema)
 *  - bootstrap process-tree memory = concurrent sum (planner at spawn + worker peak)
 *  - overall process-tree qualification gates on max(bootstrap, segment) aggregate
 *  - computed (not self-attested) evidence that planner never loaded heavy modules
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
const { buildStateKey } = require("./state-key");
const { getMilestoneSpec } = require("./milestone-spec");
const {
  createGlobalBudget,
  runMilestoneGraph,
} = require("./segment-dp");

const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, "../..", "Only upV2.1", "Only upV2.1");
const PROCESS_TREE_RSS_STOP_THRESHOLD_MB = 256;
const PROCESS_TREE_RSS_HARD_CEILING_MB = 260;
const PROCESS_TREE_ALLOWED_OVERSHOOT_MB = 4;

function rssNowMb() {
  return Math.round((process.memoryUsage().rss / 1048576) * 10) / 10;
}

function heavyModuleLoadedEvidence() {
  // Computed evidence, not self-attestation: check require.cache for heavy modules
  // that must never be loaded inside the thin planner process.
  const heavyModules = [
    "./project-loader",
    "./simulator",
    "./battle-resolver",
    "./onlyup-mt1-real-route-gate",
  ];
  const loaded = [];
  for (const mod of heavyModules) {
    try {
      if (require.cache[require.resolve(mod)]) loaded.push(mod);
    } catch (_) {}
  }
  return {
    thinPlannerNeverLoadsProject: !loaded.includes("./project-loader"),
    thinPlannerNeverConstructsSimulator: !loaded.includes("./simulator"),
    heavyModulesLoadedInPlannerProcess: loaded,
  };
}

function runBootstrap(projectRoot, stopFloorId, options) {
  const opts = options || {};
  const timeoutMs = Math.max(1000, Number(opts.timeoutMs || 30000));
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tmpDir = os.tmpdir();
  const inputPath = path.join(tmpDir, `bootstrap-input-${runId}.json`);
  const outputPath = path.join(tmpDir, `bootstrap-output-${runId}.json`);
  const payload = {
    projectRoot: projectRoot || DEFAULT_PROJECT_ROOT,
    stopFloorId: stopFloorId || "MT6",
    enableFastHazardBlockIndex: true,
    enableCompiledEffectCache: false,
    autoBattleFastRejectEnabled: true,
    autoPickupEnabled: true,
    autoBattleEnabled: true,
  };
  fs.writeFileSync(inputPath, JSON.stringify(payload));
  // Release payload string before spawn measurement
  if (typeof global.gc === "function") try { global.gc(); } catch (_) {}
  const workerScript = path.resolve(__dirname, "../planner-bootstrap-worker.js");
  const rssBefore = rssNowMb();
  // Final atSpawn sample immediately before spawn (after large payload GC)
  if (typeof global.gc === "function") try { global.gc(); } catch (_) {}
  const rssAtSpawn = rssNowMb();
  const startedAt = Date.now();
  // Phase-correct spawn: worker output goes via file; do not capture stdout/stderr
  // into parent-resident buffers during the child-live phase.
  const stderrPath = path.join(tmpDir, `bootstrap-stderr-${runId}.log`);
  let stderrFd = null;
  try { stderrFd = fs.openSync(stderrPath, "w"); } catch (_) { stderrFd = null; }
  let res;
  try {
    res = childProcess.spawnSync(process.execPath, ["--expose-gc", workerScript, inputPath, outputPath], {
      timeout: timeoutMs,
      maxBuffer: 20 * 1024 * 1024,
      encoding: "utf8",
      stdio: ["ignore", "pipe", stderrFd != null ? stderrFd : "ignore"],
    });
  } finally {
    if (stderrFd != null) {
      try { fs.closeSync(stderrFd); } catch (_) {}
    }
  }
  const wallMs = Date.now() - startedAt;
  // Phase C: child exited – parent-only sampling
  const rssAfter = rssNowMb();
  let bootstrapStderr = "";
  if (fs.existsSync(stderrPath)) {
    try { bootstrapStderr = fs.readFileSync(stderrPath, "utf8"); } catch (_) { bootstrapStderr = ""; }
  }
  let out = null;
  if (fs.existsSync(outputPath)) {
    try { out = JSON.parse(fs.readFileSync(outputPath, "utf8")); } catch (_) {}
  }
  const rssAfterOutputRead = rssNowMb();
  try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch (_) {}
  try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (_) {}
  try { if (fs.existsSync(stderrPath)) fs.unlinkSync(stderrPath); } catch (_) {}

  if (res.status !== 0 || !out || !out.success) {
    const err = `Bootstrap worker failed code=${res.status} stderr=${(bootstrapStderr || (res.stderr || "")).slice(0, 2000)}`;
    throw new Error(err);
  }

  const bootstrapPeakRssMb = Number(out.bootstrapPeakRssMb || 0);
  // Phase-correct bootstrap process-tree (Iteration 2c):
  //   Phase B (child-live concurrent): rssAtSpawn + bootstrapWorkerPeak
  //   Phase C (parent-only after exit): max(rssAfter, rssAfterOutputRead)
  const bootstrapConcurrentUpperBoundMb = Math.round((rssAtSpawn + bootstrapPeakRssMb) * 10) / 10;
  const parentOnlyPostPeakMb = Math.max(rssAfter, rssAfterOutputRead);
  const bootstrapOverallPeakMb = Math.max(rssBefore, bootstrapConcurrentUpperBoundMb, parentOnlyPostPeakMb);
  // Legacy alias: aggregate = phase-correct overall peak (was: max-of-three + workerPeak)
  const bootstrapAggregateUpperBoundMb = bootstrapOverallPeakMb;
  const maxBootstrapRss = Math.max(rssBefore, rssAtSpawn, rssAfter, bootstrapPeakRssMb, bootstrapOverallPeakMb);
  return {
    projectRoot: out.projectRoot,
    projectIdentity: out.projectIdentity,
    simulatorProfile: out.simulatorProfile,
    initialState: out.initialState,
    initialStateKey: out.initialStateKey,
    difficulty: out.difficulty,
    bootstrapPeakRssMb,
    bootstrapWallMs: wallMs,
    plannerRssBeforeBootstrapMb: rssBefore,
    plannerRssAtBootstrapSpawnMb: rssAtSpawn,
    plannerRssAfterBootstrapMb: rssAfter,
    plannerRssAfterOutputReadMb: rssAfterOutputRead,
    bootstrapConcurrentUpperBoundMb,
    parentOnlyPostPeakMb,
    bootstrapOverallPeakMb,
    bootstrapAggregateUpperBoundMb,
    maxBootstrapConcurrentRssMb: bootstrapConcurrentUpperBoundMb,
    maxBootstrapRss,
  };
}

function loadMilestoneSpecThin(routeName) {
  // Authoritative milestone-spec with project=null – exact same normalization,
  // tile propagation and validation as heavy path (no duplicated schema).
  return getMilestoneSpec(null, routeName);
}

function runThinMilestoneGraph(options) {
  const config = options || {};
  const projectRoot = config.projectRoot || DEFAULT_PROJECT_ROOT;
  const routeName = config.routeName || "onlyup-chaos-mt1-mt4";
  const stopFloorId = config.stopFloorId || "MT6";

  // Whole-run lifecycle budget: bootstrap + segment graph share ONE deadline
  // created by the authoritative segment-dp schema (no duplicate budget code).
  const overallStartedAt = Date.now();
  const overallBudget = createGlobalBudget({
    budgetScope: "global-run",
    maxRuntimeMs: config.maxRuntimeMs,
    maxExpansions: config.maxExpansions,
  });
  if (config.globalBudget) {
    throw new Error("runThinMilestoneGraph owns the whole-run budget; external globalBudget is not accepted");
  }

  const plannerRssBeforeBootstrapMb = rssNowMb();
  if (typeof global.gc === "function") try { global.gc(); } catch (_) {}
  // Bootstrap consumes the SAME whole-run deadline; graph gets remaining time.
  const bootstrapTimeoutMs = overallBudget
    ? Math.max(1000, overallBudget.deadlineMs - Date.now())
    : 30000;
  const bootstrap = runBootstrap(projectRoot, stopFloorId, { timeoutMs: bootstrapTimeoutMs });

  if (typeof global.gc === "function") try { global.gc(); } catch (_) {}
  const plannerBaselineRssMb = rssNowMb();

  // Hard fail-closed: bootstrap must not exceed the whole-run deadline
  if (overallBudget && Date.now() > overallBudget.deadlineMs) {
    overallBudget.stoppedReason = "time-limit";
    throw new Error(`Bootstrap consumed whole-run deadline: bootstrapWall=${bootstrap.bootstrapWallMs}ms deadline=${overallBudget.deadlineMs - overallStartedAt}ms`);
  }

  // Verify bootstrap difficulty / identity as gates do
  const expectedChaos = { I581: 0, I582: 0, "flag:level0": 0 };
  const diff = bootstrap.difficulty;
  if (JSON.stringify(diff) !== JSON.stringify(expectedChaos)) {
    throw new Error(`Bootstrap difficulty not Chaos: ${JSON.stringify(diff)}`);
  }

  // Authoritative spec via milestone-spec (project=null) – same normalization
  // (BASE_DP, actionKinds, propagateSuccessorHardPresentTiles, validation).
  const spec = config.milestoneSpec || loadMilestoneSpecThin(routeName);
  if (config.milestoneSpec && !config.milestoneSpec.projectTitle && bootstrap.projectIdentity) {
    spec.projectTitle = bootstrap.projectIdentity.title || null;
  }

  const initialState = bootstrap.initialState;
  // Verify StateKey round-trip for bootstrap
  const recomputedKey = buildStateKey(initialState);
  if (recomputedKey !== bootstrap.initialStateKey) {
    throw new Error(`Bootstrap StateKey mismatch: ${recomputedKey} != ${bootstrap.initialStateKey}`);
  }

  const isolatedRuntimeDescriptor = {
    projectRoot: bootstrap.projectRoot,
    simulatorProfile: bootstrap.simulatorProfile,
    projectIdentity: bootstrap.projectIdentity,
  };

  // Delegate to canonical runMilestoneGraph with thin descriptor – planner never has simulator
  const thinConfig = {
    ...config,
    globalBudget: overallBudget,
    milestoneSpec: spec,
    projectRoot: undefined,
    isolatedRuntimeDescriptor,
    segmentExecutionMode: "isolated-process",
  };
  delete thinConfig.routeName;
  delete thinConfig.stopFloorId;

  const graphResult = runMilestoneGraph(null, initialState, spec, thinConfig);

  // Overall process-tree peak (phase-correct, Iteration 2c):
  // bootstrap = max(parent-before, atSpawn+workerPeak, parent-only-post)
  // segments  = max over invocations of invocationProcessTreePeakMb
  const bootstrapOverallPeakMb = Number(
    bootstrap.bootstrapOverallPeakMb || bootstrap.bootstrapAggregateUpperBoundMb || 0,
  );
  const segmentMaxAggregate = Number((graphResult.processTreeMemory && graphResult.processTreeMemory.maxAggregateConcurrentRssUpperBoundMb) || 0);
  const maxConcurrentProcessTreeRssMb = Math.max(bootstrapOverallPeakMb, segmentMaxAggregate);
  const overallOvershootMb = Math.max(0, Math.round((maxConcurrentProcessTreeRssMb - PROCESS_TREE_RSS_STOP_THRESHOLD_MB) * 10) / 10);
  const overallQualified = maxConcurrentProcessTreeRssMb <= PROCESS_TREE_RSS_HARD_CEILING_MB && overallOvershootMb <= PROCESS_TREE_ALLOWED_OVERSHOOT_MB;

  const plannerRssAtSegmentSpawnMb = Math.max(
    plannerBaselineRssMb,
    Number((graphResult.isolatedProcessTreeTelemetry && graphResult.isolatedProcessTreeTelemetry.maxPlannerRssDuringIsolatedExecutionMb) || 0),
  );
  const overallWallMs = Date.now() - overallStartedAt;

  // Computed evidence (not self-attestation): heavy modules must not be in
  // this planner process's require.cache at the end of the run.
  const heavyEvidence = heavyModuleLoadedEvidence();

  return {
    ...graphResult,
    thinPlanner: true,
    bootstrap,
    overallStartedAt,
    overallDeadlineMs: overallBudget ? overallBudget.deadlineMs : null,
    overallWallMs,
    lifecycleTelemetry: {
      plannerRssBeforeBootstrapMb,
      plannerBaselineRssMb,
      plannerRssAtSegmentSpawnMb,
      bootstrapPeakRssMb: bootstrap.bootstrapPeakRssMb,
      bootstrapConcurrentUpperBoundMb: bootstrap.bootstrapConcurrentUpperBoundMb,
      bootstrapOverallPeakMb,
      bootstrapWallMs: bootstrap.bootstrapWallMs,
      maxBootstrapConcurrentRssMb: bootstrap.bootstrapConcurrentUpperBoundMb,
      segmentMaxAggregateConcurrentRssUpperBoundMb: segmentMaxAggregate,
      maxConcurrentProcessTreeRssMb,
      overallOvershootMb,
      overallQualified,
      overallWallMs,
      requestedRuntimeMs: overallBudget ? overallBudget.requestedRuntimeMs : 0,
      isolatedInvocationCount: (graphResult.isolatedProcessTreeTelemetry && graphResult.isolatedProcessTreeTelemetry.isolatedInvocationCount) || 0,
      ...heavyEvidence,
    },
    processTreeMemory: {
      ...graphResult.processTreeMemory,
      bootstrapConcurrentUpperBoundMb: bootstrap.bootstrapConcurrentUpperBoundMb,
      bootstrapOverallPeakMb,
      segmentMaxAggregateConcurrentRssUpperBoundMb: segmentMaxAggregate,
      maxConcurrentProcessTreeRssMb,
      overshootMb: overallOvershootMb,
      qualified: overallQualified,
      overallOvershootMb,
      overallQualified,
      hardCeilingMb: PROCESS_TREE_RSS_HARD_CEILING_MB,
      stopThresholdMb: PROCESS_TREE_RSS_STOP_THRESHOLD_MB,
      allowedOvershootMb: PROCESS_TREE_ALLOWED_OVERSHOOT_MB,
      plannerBaselineRssMb,
      bootstrapPeakRssMb: bootstrap.bootstrapPeakRssMb,
    },
  };
}

module.exports = {
  runBootstrap,
  runThinMilestoneGraph,
  loadMilestoneSpecThin,
};
