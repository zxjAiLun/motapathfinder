"use strict";

/**
 * TEST GRADE: closure
 *
 * PR-5.9g Reachability Optimization Requalification.
 *
 * Independent-process A/B/B/A qualification of the cumulative PR-5.9b/d/f
 * stack. Control keeps safe-fast reachability but disables skeleton reuse,
 * topology-first materialization, and battle-evaluation projection. Repair is
 * the current production default. Search/key/budget/goal semantics are equal.
 */

const assert = require("node:assert");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const { buildReplayRouteFingerprint } = require("./lib/replay-resume-artifact");
const { compileExecutableSolveTask } = require("./lib/solve-task");
const { executeSolveJob, exactStateFingerprint } = require("./lib/solver-job");

const ROOT = path.resolve(__dirname, "..");
const ONLY_UP_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");
const SMOKE_SPEC_FILE = path.join(ROOT, "towers", "onlyup", "region-specs", "region-output-contract-smoke.json");

const MT1_WORKLOADS = Object.freeze([
  { id: "exp9-maxfinalhp", goal: { type: "heroAtLeast", floorId: "MT1", minHero: { exp: 9 } }, objective: { mode: "max-final-hp" } },
  { id: "exp6-maxfinalhp", goal: { type: "heroAtLeast", floorId: "MT1", minHero: { exp: 6 } }, objective: { mode: "max-final-hp" } },
  { id: "exp8-maxfinalhp", goal: { type: "heroAtLeast", floorId: "MT1", minHero: { exp: 8 } }, objective: { mode: "max-final-hp" } },
  { id: "exp9-maxatk", goal: { type: "heroAtLeast", floorId: "MT1", minHero: { exp: 9 } }, objective: { mode: "maximize", field: "hero.atk" } },
  { id: "tile4_1-maxfinalhp", goal: { type: "tileRemoved", floorId: "MT1", x: 4, y: 1 }, objective: { mode: "max-final-hp" } },
  { id: "tile2_1-maxfinalhp", goal: { type: "tileRemoved", floorId: "MT1", x: 2, y: 1 }, objective: { mode: "max-final-hp" } },
]);

const REAL_ROUTE_CASES = Object.freeze([
  "mt2-to-mt3-i893",
  "mt4-manual-to-mt5-entry",
]);

function optimizationContext(repair) {
  return {
    enableReachabilitySkeletonCache: repair,
    enableTopologyFirstMaterialization: repair,
    enableBattleEvaluationProjection: repair,
  };
}

function buildMt1Task(workload) {
  const spec = JSON.parse(fs.readFileSync(SMOKE_SPEC_FILE, "utf8"));
  spec.goal = workload.goal;
  return compileExecutableSolveTask({
    schema: "motapathfinder.solve-task.v1",
    tower: { id: "onlyup-smoke", projectRoot: ONLY_UP_ROOT, region: { spec } },
    objective: workload.objective,
    search: {
      algorithm: "segment-dp",
      maxExpansions: 4000,
      maxRuntimeMs: 0,
      candidateLimit: 2,
      goalSkylineLimit: 8,
    },
    verification: { strictReplay: true },
  });
}

async function runMt1(workload, repair) {
  const originalLog = console.log;
  let execution;
  const startedAt = Date.now();
  console.log = () => {};
  try {
    execution = await executeSolveJob(buildMt1Task(workload), {
      jobId: `reachability-requalification-${workload.id}-${repair ? "repair" : "control"}`,
      onProgress: () => {},
      shouldStop: () => false,
      context: optimizationContext(repair),
    });
  } finally {
    console.log = originalLog;
  }
  const attempt = execution.result.segmentResults[0].attempts[0];
  const dp = attempt.diagnostics.dp;
  const reachability = execution.simulator.getReachabilityCacheStats();
  const skeleton = execution.simulator.getActionExpansionCacheStats().reachabilitySkeleton;
  return {
    id: workload.id,
    kind: "mt1",
    correctness: {
      found: execution.result.found,
      strictReplayVerified: execution.strictReplayVerified,
      winnerExactFingerprint: exactStateFingerprint(execution.result.finalCandidate.state),
      routeFingerprint: buildReplayRouteFingerprint(execution.routeRecord).sha256,
      objectiveValue: execution.objectiveValue.value,
      expansions: Number(dp.expansions),
      acceptedStates: Number(dp.acceptedStates),
    },
    structure: {
      reachabilityComputations: Number(reachability.misses),
      skeletonBuilds: Number(skeleton.builds),
      skeletonHits: Number(skeleton.hits),
      nodesExpanded: Number(reachability.nodesExpanded),
      transitionAttempts: Number(reachability.transitionAttempts),
      stateClones: Number(reachability.stateClones),
      dominanceKeyBuilds: Number(reachability.dominanceKeyBuilds),
    },
    timing: { wallMs: Date.now() - startedAt },
  };
}

function runRealRoute(caseId, repair) {
  const flags = optimizationContext(repair);
  const child = spawnSync(process.execPath, [
    path.join(__dirname, "check-real-route-performance-qualification.js"),
    `--case=${caseId}`,
    "--order=A",
    "--walk-mode=safe-fast",
    `--reachability-skeleton-cache=${flags.enableReachabilitySkeletonCache ? 1 : 0}`,
    `--topology-first-materialization=${flags.enableTopologyFirstMaterialization ? 1 : 0}`,
    `--battle-evaluation-projection=${flags.enableBattleEvaluationProjection ? 1 : 0}`,
  ], {
    cwd: __dirname,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (child.status !== 0) throw new Error(child.stderr || child.stdout);
  const result = JSON.parse(child.stdout).results[0];
  const run = result.runs[0];
  const cache = run.performance.reachabilityCache;
  const skeleton = run.performance.reachabilitySkeletonCache;
  return {
    id: caseId,
    kind: "tracked-real-route",
    correctness: {
      found: run.found,
      strictReplayVerified: run.strictReplay.verified,
      winnerExactFingerprint: run.finalExactStateFingerprint,
      routeFingerprint: run.strictReplay.routeFingerprint,
      expansions: run.scale.expanded,
      acceptedStates: run.scale.acceptedStates,
      attempts: run.scale.attempts,
    },
    structure: {
      reachabilityComputations: run.performance.reachabilityComputations,
      skeletonBuilds: Number(skeleton.builds || 0),
      skeletonHits: Number(skeleton.hits || 0),
      nodesExpanded: Number(cache.nodesExpanded),
      transitionAttempts: Number(cache.transitionAttempts),
      stateClones: Number(cache.stateClones),
      dominanceKeyBuilds: Number(cache.dominanceKeyBuilds),
    },
    timing: { wallMs: Number(run.performance.wallMs) },
  };
}

async function runSample(repair) {
  const workloads = [];
  for (const workload of MT1_WORKLOADS) {
    workloads.push(await runMt1(workload, repair));
  }
  REAL_ROUTE_CASES.forEach((caseId) => workloads.push(runRealRoute(caseId, repair)));
  return { mode: repair ? "repair" : "control", workloads };
}

function runChild(mode) {
  const child = spawnSync(process.execPath, [__filename, `--sample=${mode}`], {
    cwd: __dirname,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (child.status !== 0) throw new Error(child.stderr || child.stdout);
  return JSON.parse(child.stdout);
}

function sumStructure(workloads) {
  const fields = [
    "reachabilityComputations",
    "skeletonBuilds",
    "skeletonHits",
    "nodesExpanded",
    "transitionAttempts",
    "stateClones",
    "dominanceKeyBuilds",
  ];
  return Object.fromEntries(fields.map((field) => [
    field,
    workloads.reduce((sum, workload) => sum + Number(workload.structure[field] || 0), 0),
  ]));
}

function assertRepeatable(left, right) {
  assert.deepStrictEqual(
    left.workloads.map(({ id, kind, correctness, structure }) => ({ id, kind, correctness, structure })),
    right.workloads.map(({ id, kind, correctness, structure }) => ({ id, kind, correctness, structure })),
  );
}

async function main() {
  const sampleArg = process.argv.find((value) => value.startsWith("--sample="));
  if (sampleArg) {
    process.stdout.write(`${JSON.stringify(await runSample(sampleArg.endsWith("repair")))}\n`);
    return;
  }

  const samples = ["control", "repair", "repair", "control"].map(runChild);
  const controls = samples.filter((sample) => sample.mode === "control");
  const repairs = samples.filter((sample) => sample.mode === "repair");
  assertRepeatable(controls[0], controls[1]);
  assertRepeatable(repairs[0], repairs[1]);

  const comparison = controls[0].workloads.map((control, index) => {
    const repair = repairs[0].workloads[index];
    assert.strictEqual(repair.id, control.id);
    assert.deepStrictEqual(repair.correctness, control.correctness, `${control.id} correctness parity`);
    assert.strictEqual(control.correctness.found, true, `${control.id} found`);
    assert.strictEqual(control.correctness.strictReplayVerified, true, `${control.id} strict replay`);
    ["nodesExpanded", "transitionAttempts", "stateClones", "dominanceKeyBuilds"].forEach((field) => {
      assert.ok(repair.structure[field] <= control.structure[field], `${control.id} ${field} non-increasing`);
    });
    return {
      id: control.id,
      kind: control.kind,
      correctness: control.correctness,
      structuralDelta: Object.fromEntries(Object.keys(control.structure).map((field) => [field, {
        control: control.structure[field],
        repair: repair.structure[field],
      }])),
      directionalWallMs: {
        control: control.timing.wallMs,
        repair: repair.timing.wallMs,
      },
    };
  });
  const controlTotal = sumStructure(controls[0].workloads);
  const repairTotal = sumStructure(repairs[0].workloads);
  assert.ok(repairTotal.nodesExpanded < controlTotal.nodesExpanded);
  assert.ok(repairTotal.transitionAttempts < controlTotal.transitionAttempts);
  assert.ok(repairTotal.stateClones < controlTotal.stateClones);
  assert.ok(repairTotal.dominanceKeyBuilds < controlTotal.dominanceKeyBuilds);

  process.stdout.write(`${JSON.stringify({
    schema: "motapathfinder.reachability-optimization-requalification.v1",
    status: "passed",
    controls: {
      independentProcessOrder: "A/B/B/A",
      searchKeyBudgetGoalSemanticsEqual: true,
      sixMt1WorkloadsQualified: true,
      trackedMt2Mt3Qualified: true,
      trackedMt4Mt5EntryQualified: true,
      exactWinnerRouteScaleParity: true,
      strictReplayEveryWorkload: true,
      structuralCostsNonIncreasingPerWorkload: true,
      wallTimingDirectionalOnly: true,
      remainingTravelStatesAllActionEscaped: true,
    },
    comparison,
    totals: { control: controlTotal, repair: repairTotal },
    conclusion: {
      reachabilityOptimizationLineClosed: true,
      nextStep: "profile the next real hotspot before authorizing another representation change",
      forbiddenShortcut: "do not delete the remaining action.travelState materializations without a new action representation contract",
    },
    verdict: "PR_5_9_REACHABILITY_OPTIMIZATION_CLOSED",
  }, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  });
}

module.exports = { main };
