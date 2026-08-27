"use strict";

/**
 * PR-5.24b Iteration 2b – Thin Canonical Planner
 *
 * Thin planner process never loads project or constructs StaticSimulator.
 * It owns: milestone history, rollback depth, global budget, compact candidate state.
 * Heavy work (project + simulator + DP) is done in fresh segment workers and
 * one-time bootstrap worker.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
const { buildStateKey } = require("./state-key");

const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, "../..", "Only upV2.1", "Only upV2.1");

function runBootstrap(projectRoot, stopFloorId) {
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
  const workerScript = path.resolve(__dirname, "../planner-bootstrap-worker.js");
  const rssBefore = Math.round((process.memoryUsage().rss / 1048576) * 10) / 10;
  const startedAt = Date.now();
  const res = childProcess.spawnSync(process.execPath, ["--expose-gc", workerScript, inputPath, outputPath], {
    timeout: 30000,
    maxBuffer: 20 * 1024 * 1024,
    encoding: "utf8",
  });
  const wallMs = Date.now() - startedAt;
  const rssAfter = Math.round((process.memoryUsage().rss / 1048576) * 10) / 10;
  let out = null;
  if (fs.existsSync(outputPath)) {
    try { out = JSON.parse(fs.readFileSync(outputPath, "utf8")); } catch (_) {}
  }
  try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch (_) {}
  try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (_) {}

  if (res.status !== 0 || !out || !out.success) {
    const err = `Bootstrap worker failed code=${res.status} stderr=${(res.stderr||"").slice(0,2000)}`;
    throw new Error(err);
  }

  const bootstrapPeakRssMb = Number(out.bootstrapPeakRssMb || 0);
  const maxBootstrapRss = Math.max(rssBefore, rssAfter, bootstrapPeakRssMb);
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
    plannerRssAfterBootstrapMb: rssAfter,
    maxBootstrapConcurrentRssMb: maxBootstrapRss,
  };
}

function loadMilestoneSpecThin(routeName) {
  // Thin planner loads spec without project – via raw milestone JSON
  const filePath = path.resolve(__dirname, "..", "milestones", `${routeName}.json`);
  if (!fs.existsSync(filePath)) throw new Error(`Unknown milestone route: ${routeName} at ${filePath}`);
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  // Reuse milestone-spec's normalize but without project
  const { loadMilestoneData } = (() => {
    try { return require("./milestone-spec"); } catch (_) { return null; }
  })();
  if (loadMilestoneData) {
    // Use thin load without project – call normalize with null project via internal helper if available
    // Fallback: just return raw milestones as spec
    const spec = { ...raw, milestones: raw.milestones.map(m => ({ ...m })) };
    // Ensure each milestone has dp defaults as milestone-spec does
    const BASE_DP = { keyMode: "region", stopOnFirstGoal: false, maxActionsPerState: 9999, maxExpansions: 8000, maxRuntimeMs: 15000, goalSkylineLimit: 8 };
    spec.milestones = spec.milestones.map(m => ({
      ...m,
      actionPolicy: { actionKinds: ["battle","pickup","equip","openDoor","useTool","changeFloor","event"], forbidUnsupportedEvents: true, ...(m.actionPolicy||{}) },
      dp: { ...BASE_DP, ...(m.dp||{}) },
      goal: { ...(m.goal||{}) },
    }));
    return spec;
  }
  return raw;
}

function runThinMilestoneGraph(options) {
  const config = options || {};
  const projectRoot = config.projectRoot || DEFAULT_PROJECT_ROOT;
  const routeName = config.routeName || "onlyup-chaos-mt1-mt4";
  const stopFloorId = config.stopFloorId || "MT6";

  const plannerRssBeforeBootstrapMb = Math.round((process.memoryUsage().rss / 1048576) * 10) / 10;
  if (typeof global.gc === "function") try { global.gc(); } catch (_) {}
  const bootstrap = runBootstrap(projectRoot, stopFloorId);
  if (typeof global.gc === "function") try { global.gc(); } catch (_) {}
  const plannerBaselineRssMb = Math.round((process.memoryUsage().rss / 1048576) * 10) / 10;

  // Verify bootstrap difficulty / identity as gates do
  const expectedChaos = { I581: 0, I582: 0, "flag:level0": 0 };
  const diff = bootstrap.difficulty;
  if (JSON.stringify(diff) !== JSON.stringify(expectedChaos)) {
    throw new Error(`Bootstrap difficulty not Chaos: ${JSON.stringify(diff)}`);
  }

  const spec = config.milestoneSpec || loadMilestoneSpecThin(routeName);
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
  const { runMilestoneGraph } = require("./segment-dp");
  const thinConfig = {
    ...config,
    milestoneSpec: undefined,
    projectRoot: undefined,
    isolatedRuntimeDescriptor,
    segmentExecutionMode: "isolated-process",
    // Preserve budget scope etc
  };
  // Remove routeName from thinConfig to avoid confusion – spec is already resolved
  delete thinConfig.routeName;
  delete thinConfig.stopFloorId;

  const graphResult = runMilestoneGraph(null, initialState, spec, thinConfig);

  // Lifecycle telemetry: bootstrap + segment workers are sequential, concurrent peak is max of each
  const segmentProcessTree = graphResult.processTreeMemory || graphResult.processTreeMemory;
  const segmentMaxAggregate = Number((graphResult.processTreeMemory && graphResult.processTreeMemory.maxAggregateConcurrentRssUpperBoundMb) || 0);
  const bootstrapConcurrent = Number(bootstrap.maxBootstrapConcurrentRssMb || 0);
  const maxConcurrentProcessTreeRssMb = Math.max(segmentMaxAggregate, bootstrapConcurrent, Number(bootstrap.bootstrapPeakRssMb || 0));

  // Planner atSpawn is the baseline after bootstrap, before first segment worker
  const plannerRssAtSegmentSpawnMb = plannerBaselineRssMb;

  return {
    ...graphResult,
    thinPlanner: true,
    bootstrap,
    lifecycleTelemetry: {
      plannerRssBeforeBootstrapMb,
      plannerBaselineRssMb,
      plannerRssAtSegmentSpawnMb,
      bootstrapPeakRssMb: bootstrap.bootstrapPeakRssMb,
      bootstrapWallMs: bootstrap.bootstrapWallMs,
      maxBootstrapConcurrentRssMb: bootstrapConcurrent,
      segmentMaxAggregateConcurrentRssUpperBoundMb: segmentMaxAggregate,
      maxConcurrentProcessTreeRssMb,
      isolatedInvocationCount: (graphResult.isolatedProcessTreeTelemetry && graphResult.isolatedProcessTreeTelemetry.isolatedInvocationCount) || 0,
      thinPlannerNeverLoadsProject: true,
      thinPlannerNeverConstructsSimulator: true,
    },
    processTreeMemory: {
      ...graphResult.processTreeMemory,
      maxConcurrentProcessTreeRssMb,
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
