"use strict";

/** TEST GRADE: local-regression */

/**
 * PR-5.24b Iteration 2b Repair 1 – Thin Canonical Planner Gate
 *
 * Verifies (whole lifecycle):
 *  - Clean thin runtime measured in an isolated child that never imports heavy modules
 *    (neverLoadsProject/neverConstructsSimulator are computed from require.cache, not self-attested)
 *  - Whole-run budget: bootstrap + segment graph share ONE 30s deadline (budget identity,
 *    requestedRuntimeMs reported as original 30000, overallWallMs hard-gated)
 *  - Bootstrap process-tree memory = concurrent sum (planner at spawn + worker peak),
 *    overall peak = max(bootstrap aggregate, segment aggregate), gated ≤260/4
 *  - Thin normalized milestones === heavy getMilestoneSpec(project).milestones (deep equal)
 *  - Successor presentTiles propagation semantics locked by micro fixture
 *  - Thin-vs-current isolated parity for MT1→MT2 (same initialState, segment, budget)
 *  - Envelope is mandatory fail-closed in segment worker (negative probe)
 *  - Global budget authority / StateKey / Profile / projectIdentity pass via thin path
 */

const assert = require("node:assert");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { loadProject } = require("./lib/project-loader");
const { StaticSimulator } = require("./lib/simulator");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { buildStateKey } = require("./lib/state-key");
const { getMilestoneSpec, propagateSuccessorHardPresentTiles } = require("./lib/milestone-spec");
const { runSegmentAgainstFrontier, runSegmentAgainstFrontierLocal } = require("./lib/segment-dp");
const { loadMilestoneSpecThin } = require("./lib/thin-planner");
const { FIRST_REGION_TARGET_FLOOR_ID, createNoStateChangeChoiceResolver } = require("./lib/onlyup-mt1-real-route-gate");

const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");

function runCleanThinRuntimeChild(config) {
  const childScript = path.resolve(__dirname, "check-thin-planner-runtime-child.js");
  const payload = JSON.stringify(config);
  const res = spawnSync(process.execPath, ["--expose-gc", childScript], {
    input: payload,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
    timeout: 120000,
  });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`Clean thin runtime child failed code=${res.status} stderr=${(res.stderr||"").slice(0,3000)} stdout=${(res.stdout||"").slice(0,2000)}`);
  }
  const lines = res.stdout.trim().split("\n");
  return { thinResult: JSON.parse(lines[lines.length - 1]), runtimeEvidence: res.stderr };
}

function main() {
  console.log("== Thin Planner Clean Runtime (isolated child, no heavy imports) ==");
  const { thinResult, runtimeEvidence } = runCleanThinRuntimeChild({
    routeName: "onlyup-chaos-mt1-mt4",
    maxExpansions: 50000,
    maxRuntimeMs: 30000,
    maxRssMb: 256,
    adaptiveBacktrackDepth: 3,
    searchIntent: "adaptive-feasible",
    budgetScope: "global-run",
    stopFloorId: FIRST_REGION_TARGET_FLOOR_ID,
    projectRoot: DEFAULT_PROJECT_ROOT,
  });
  console.log(`Child runtime evidence: ${runtimeEvidence.trim().split("\n").pop()}`);

  const bootstrap = thinResult.bootstrap;
  assert.ok(bootstrap && bootstrap.simulatorProfile, "Bootstrap must return simulatorProfile");
  assert.ok(bootstrap.initialStateKey, "Bootstrap must have initialStateKey");

  // --- P1-1: whole-run budget identity (bootstrap included in 30s) ---
  assert.ok(thinResult.budget, "Thin must have budget");
  assert.strictEqual(thinResult.budget.scope, "global-run");
  assert.strictEqual(thinResult.budget.requestedRuntimeMs, 30000, "requestedRuntimeMs must report original 30000, not post-bootstrap remainder");
  assert.ok(thinResult.overallStartedAt && thinResult.overallDeadlineMs, "Thin must expose whole-run deadline");
  assert.ok(thinResult.lifecycleTelemetry.overallWallMs > 0, "overallWallMs must be measured");
  assert.ok(
    thinResult.lifecycleTelemetry.overallWallMs <= 30000,
    `Whole-run wall (bootstrap + graph) ${thinResult.lifecycleTelemetry.overallWallMs}ms exceeds 30000ms`,
  );
  assert.ok(
    thinResult.lifecycleTelemetry.overallWallMs >= thinResult.lifecycleTelemetry.bootstrapWallMs,
    "overallWallMs must include bootstrap wall time",
  );

  // --- P1-2: overall process-tree peak (bootstrap concurrent sum included) ---
  const thinProcessTree = thinResult.processTreeMemory;
  assert.ok(thinProcessTree, "Thin result must have processTreeMemory");
  assert.ok(
    thinProcessTree.bootstrapAggregateUpperBoundMb >=
      Math.round((Math.max(bootstrap.plannerRssAtBootstrapSpawnMb, bootstrap.plannerRssAfterBootstrapMb) + bootstrap.bootstrapPeakRssMb) * 10) / 10 - 0.5,
    `bootstrapAggregateUpperBoundMb ${thinProcessTree.bootstrapAggregateUpperBoundMb} must be a concurrent sum (planner + worker), not max()`,
  );
  assert.ok(
    thinProcessTree.maxConcurrentProcessTreeRssMb >= thinProcessTree.bootstrapAggregateUpperBoundMb,
    "overall peak must include bootstrap aggregate",
  );
  assert.ok(
    thinProcessTree.maxConcurrentProcessTreeRssMb >= thinProcessTree.segmentMaxAggregateConcurrentRssUpperBoundMb - 0.5,
    "overall peak must include segment aggregate",
  );
  assert.ok(thinProcessTree.maxConcurrentProcessTreeRssMb <= 260, `Thin overall processTree ${thinProcessTree.maxConcurrentProcessTreeRssMb} > 260`);
  assert.ok(thinProcessTree.overshootMb <= 4, `Thin overall overshoot ${thinProcessTree.overshootMb} > 4`);
  assert.strictEqual(thinProcessTree.qualified, true, "Overall process-tree qualification must pass");

  // --- P1-3: clean RSS + computed (not self-attested) heavy-module evidence ---
  const plannerBaseline = thinResult.lifecycleTelemetry.plannerBaselineRssMb;
  assert.ok(typeof plannerBaseline === "number" && plannerBaseline > 0, "plannerBaselineRssMb must be measured");
  assert.ok(plannerBaseline < 65, `Clean thin planner baseline ${plannerBaseline} not thin (<65) – heavy ~70`);
  if (plannerBaseline > 45) {
    console.warn(`Clean thin planner baseline ${plannerBaseline}MB above 45MB target (heavy ~70MB) – optimization candidate, not hard failure`);
  }
  assert.strictEqual(thinResult.lifecycleTelemetry.thinPlannerNeverLoadsProject, true, "Computed evidence: project-loader must not be in planner require.cache");
  assert.strictEqual(thinResult.lifecycleTelemetry.thinPlannerNeverConstructsSimulator, true, "Computed evidence: simulator must not be in planner require.cache");
  assert.deepStrictEqual(
    thinResult.lifecycleTelemetry.heavyModulesLoadedInPlannerProcess,
    [],
    "No heavy module may be loaded in the thin planner process",
  );

  // --- Isolated invocation identity gates via thin path ---
  assert.ok(thinResult.isolatedProcessTreeTelemetry.isolatedInvocationCount > 0, "Thin must have isolated invocations");
  const thinRecords = thinResult.isolatedProcessTreeTelemetry.records || [];
  thinRecords.forEach((rec) => {
    assert.strictEqual(rec.stateRoundTripIdentity, true, `Thin record ${rec.segmentId} stateRoundTripIdentity false`);
    assert.strictEqual(rec.simulatorProfileIdentity, true, `Thin record ${rec.segmentId} profileIdentity false`);
    if (rec.expectedProjectIdentity) {
      assert.strictEqual(rec.projectIdentityMatch, true, `Thin record ${rec.segmentId} projectIdentityMatch false`);
      assert.ok(rec.appliedProjectIdentity, `Thin record ${rec.segmentId} missing appliedProjectIdentity`);
    }
  });

  // --- Heavy side (separate from clean thin measurement) ---
  console.log("== Thin Milestone Normalization Parity (MT1→MT4) ==");
  const project = loadProject(DEFAULT_PROJECT_ROOT);
  const heavySpec = getMilestoneSpec(project, "onlyup-chaos-mt1-mt4");
  const thinSpec = loadMilestoneSpecThin("onlyup-chaos-mt1-mt4");
  assert.deepStrictEqual(
    thinSpec.milestones,
    heavySpec.milestones,
    "Thin (project=null) milestones must deep-equal heavy getMilestoneSpec(project).milestones",
  );

  // --- Micro fixture: successor presentTiles propagation semantics ---
  const fixture = [
    { id: "m1", label: "M1", goal: { floorId: "MT1", presentTiles: [{ floorId: "MT1", x: 1, y: 1 }] } },
    { id: "m2", label: "M2", startFrom: "m1", goal: { floorId: "MT2", presentTiles: [{ floorId: "MT2", x: 2, y: 2 }] } },
  ];
  const propagated = propagateSuccessorHardPresentTiles(fixture);
  const m1Tiles = propagated[0].goal.presentTiles;
  assert.strictEqual(m1Tiles.length, 2, "Successor hard presentTiles must propagate to predecessor");
  assert.ok(m1Tiles.some((t) => t.propagatedFromMilestone === "m2"), "Propagated tile must carry propagatedFromMilestone");
  assert.ok(m1Tiles.some((t) => t.floorId === "MT1" && t.x === 1 && t.y === 1), "Original tile preserved");
  assert.ok(!m1Tiles.some((t) => t.floorId === "MT2" && !t.propagatedFromMilestone), "Successor tile only appears via propagation");
  const noPropagate = propagateSuccessorHardPresentTiles([
    { id: "m1", label: "M1", goal: { floorId: "MT1" } },
    { id: "m2", label: "M2", startFrom: "m1", goal: { floorId: "MT2", presentTiles: [{ floorId: "MT2", x: 2, y: 2 }] } },
  ]);
  assert.ok(!Array.isArray(noPropagate[0].goal.presentTiles) || noPropagate[0].goal.presentTiles.length === 1,
    "Unrelated successor tiles still propagate into predecessor's presentTiles list");

  console.log("== Thin-vs-Current Isolated Parity (MT1→MT2) ==");
  const heavySimulator = new StaticSimulator(project, {
    stopFloorId: FIRST_REGION_TARGET_FLOOR_ID,
    battleResolver: new FunctionBackedBattleResolver(project, { enableFastReject: true }),
    autoBattleFastRejectEnabled: true,
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFastHazardBlockIndex: true,
    enableCompiledEffectCache: false,
    choiceResolver: createNoStateChangeChoiceResolver(),
  });
  const heavyInitialState = heavySimulator.createInitialState();
  const heavyKey = buildStateKey(heavyInitialState);
  assert.strictEqual(heavyKey, bootstrap.initialStateKey, "Heavy vs bootstrap initial StateKey must match (same Chaos start)");

  const spec = heavySpec;
  const mt1ToMt2 = spec.milestones.find((s) => s.id === "mt1-to-mt2");
  const frontier = [{ id: "initial#0", state: heavyInitialState, tags: ["initial"] }];
  const probeConfig = { maxExpansions: 8000, maxRuntimeMs: 30000, maxRssMb: 1024, candidateLimit: 8, segmentExecutionMode: "isolated-process" };
  const heavyIsolated = runSegmentAgainstFrontier(heavySimulator, mt1ToMt2, frontier, probeConfig, {});
  const thinDescriptor = { projectRoot: bootstrap.projectRoot, simulatorProfile: bootstrap.simulatorProfile, projectIdentity: bootstrap.projectIdentity };
  const thinIsolated = runSegmentAgainstFrontier(null, mt1ToMt2, frontier, { ...probeConfig, isolatedRuntimeDescriptor: thinDescriptor }, {});
  assert.strictEqual(heavyIsolated.merged.length, thinIsolated.merged.length, `Thin vs heavy goalCount mismatch heavy=${heavyIsolated.merged.length} thin=${thinIsolated.merged.length}`);
  const heavyKeys = heavyIsolated.merged.map((c) => buildStateKey(c.state)).sort();
  const thinKeys = thinIsolated.merged.map((c) => buildStateKey(c.state)).sort();
  assert.deepStrictEqual(heavyKeys, thinKeys, "Thin vs heavy sorted StateKeys mismatch");
  assert.strictEqual(heavyIsolated.memoryLimited, thinIsolated.memoryLimited, "Thin vs heavy memoryLimited mismatch");
  assert.strictEqual(heavyIsolated.memoryStopReason, thinIsolated.memoryStopReason, "Thin vs heavy stopReason mismatch");
  const heavyFailure = heavyIsolated.summary && heavyIsolated.summary.failurePropagation ? heavyIsolated.summary.failurePropagation.failureClass : null;
  const thinFailure = thinIsolated.summary && thinIsolated.summary.failurePropagation ? thinIsolated.summary.failurePropagation.failureClass : null;
  assert.strictEqual(heavyFailure, thinFailure, "Thin vs heavy failureClass mismatch");
  assert.strictEqual(thinIsolated.telemetry.simulatorProfileIdentity, true);
  assert.strictEqual(thinIsolated.telemetry.projectIdentityMatch, true, "Thin isolated telemetry must verify projectIdentity");
  assert.ok(thinIsolated.telemetry.appliedProjectIdentity, "Thin isolated telemetry must return appliedProjectIdentity");

  console.log("== Envelope Fail-Closed Negative Probes ==");
  const os = require("node:os");
  const fs = require("node:fs");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "envelope-probe-"));
  const workerScript = path.resolve(__dirname, "segment-worker.js");
  const inputPath = path.join(tmpDir, "input.json");
  const outputPath = path.join(tmpDir, "output.json");
  const envelopePath = path.join(tmpDir, "envelope.json");
  fs.writeFileSync(inputPath, JSON.stringify({
    invocationId: "probe-1",
    projectRoot: DEFAULT_PROJECT_ROOT,
    simulatorProfile: { stopFloorId: "MT6" },
    segment: { id: "probe", label: "probe" },
    inputFrontier: [],
    parentInputStateKeys: [],
  }));
  try {
    // Probe 1: isolated invocation without envelope -> protocol error
    const probe1 = spawnSync(process.execPath, [workerScript, inputPath, outputPath], { encoding: "utf8", timeout: 20000 });
    assert.strictEqual(probe1.status, 5, `Missing envelope must exit 5, got ${probe1.status}`);
    assert.match(probe1.stderr || "", /Missing required envelope/, "Missing envelope must be diagnosed");
    // Probe 2: envelope invocationId mismatch -> protocol error
    fs.writeFileSync(envelopePath, JSON.stringify({ invocationId: "other", workerMaxRssMb: 100, workerHardCeilingMb: 104 }));
    const probe2 = spawnSync(process.execPath, [workerScript, inputPath, outputPath, envelopePath], { encoding: "utf8", timeout: 20000 });
    assert.strictEqual(probe2.status, 5, `invocationId mismatch must exit 5, got ${probe2.status}`);
    assert.match(probe2.stderr || "", /invocationId mismatch/, "invocationId mismatch must be diagnosed");
    // Probe 3: invalid workerMaxRssMb (0) -> protocol error
    fs.writeFileSync(envelopePath, JSON.stringify({ invocationId: "probe-1", workerMaxRssMb: 0, workerHardCeilingMb: 104 }));
    const probe3 = spawnSync(process.execPath, [workerScript, inputPath, outputPath, envelopePath], { encoding: "utf8", timeout: 20000 });
    assert.strictEqual(probe3.status, 5, `Invalid workerMaxRssMb must exit 5, got ${probe3.status}`);
    assert.match(probe3.stderr || "", /Invalid envelope workerMaxRssMb/, "Invalid workerMaxRssMb must be diagnosed");
    // Probe 4: NaN workerHardCeilingMb -> protocol error
    fs.writeFileSync(envelopePath, JSON.stringify({ invocationId: "probe-1", workerMaxRssMb: 100, workerHardCeilingMb: "abc" }));
    const probe4 = spawnSync(process.execPath, [workerScript, inputPath, outputPath, envelopePath], { encoding: "utf8", timeout: 20000 });
    assert.strictEqual(probe4.status, 5, `Invalid workerHardCeilingMb must exit 5, got ${probe4.status}`);
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }

  console.log(`Parity heavy vs thin MT1→MT2: both found ${heavyIsolated.merged.length} candidates, keys identical`);

  const summary = {
    schema: "motapathfinder.thin-planner.v1",
    contractStatus: "passed",
    thinPlanner: {
      neverLoadsProject: thinResult.lifecycleTelemetry.thinPlannerNeverLoadsProject,
      neverConstructsSimulator: thinResult.lifecycleTelemetry.thinPlannerNeverConstructsSimulator,
      heavyModulesLoadedInPlannerProcess: thinResult.lifecycleTelemetry.heavyModulesLoadedInPlannerProcess,
      plannerBaselineRssMb: plannerBaseline,
      maxConcurrentProcessTreeRssMb: thinProcessTree.maxConcurrentProcessTreeRssMb,
      bootstrapPeakRssMb: bootstrap.bootstrapPeakRssMb,
      bootstrapAggregateUpperBoundMb: thinProcessTree.bootstrapAggregateUpperBoundMb,
      isolatedInvocationCount: thinResult.isolatedProcessTreeTelemetry.isolatedInvocationCount,
      processTreeQualified: thinProcessTree.qualified,
    },
    lifecycleBudget: {
      requestedRuntimeMs: thinResult.budget.requestedRuntimeMs,
      overallWallMs: thinResult.lifecycleTelemetry.overallWallMs,
      bootstrapWallMs: thinResult.lifecycleTelemetry.bootstrapWallMs,
      wholeRunWithinDeadline: thinResult.lifecycleTelemetry.overallWallMs <= 30000,
    },
    milestoneParity: {
      thinVsHeavyMilestonesDeepEqual: true,
      successorPresentTilesPropagationLocked: true,
    },
    parity: {
      heavyVsThinStateKeyIdentity: true,
      mt1ToMt2GoalCount: heavyIsolated.merged.length,
      projectIdentityMatch: true,
    },
    run: {
      found: thinResult.found,
      reachedMilestone: thinResult.reachedMilestone,
      segmentSummaries: thinResult.segmentResults.map((s) => ({ id: s.segmentId, found: s.found, candidates: (s.candidates || []).length })),
    },
  };
  console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) {
  try { main(); } catch (e) { console.error(e && e.stack ? e.stack : String(e)); process.exit(1); }
}
module.exports = { main };
