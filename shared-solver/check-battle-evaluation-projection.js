"use strict";

/**
 * TEST GRADE: unit-plus-micro
 *
 * PR-5.9f Battle Evaluation Projection Repair.
 *
 * Runs independent A/B/B/A samples. Control materializes every enemy-adjacent
 * travel stance before evaluation; repair evaluates against a short-lived
 * immutable base-state + stance projection and materializes only viable
 * emitted battle actions.
 */

const assert = require("node:assert");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildBattleEvaluationProjection,
  canProjectBattleEvaluation,
  FunctionBackedBattleResolver,
} = require("./lib/battle-resolver");
const { buildReplayRouteFingerprint } = require("./lib/replay-resume-artifact");
const { compileExecutableSolveTask, fingerprintJson } = require("./lib/solve-task");
const { executeSolveJob, exactStateFingerprint } = require("./lib/solver-job");
const { cloneState } = require("./lib/state");

const ROOT = path.resolve(__dirname, "..");
const ONLY_UP_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");
const SMOKE_SPEC_FILE = path.join(ROOT, "towers", "onlyup", "region-specs", "region-output-contract-smoke.json");
const EXPECTED_WINNER_EXACT = "a2ff379819ac9003";
const EXPECTED_ROUTE_SHA256 = "c0adb2d921e84cab097c034bf7b6f8fdb5a344a0cb21f66ea3b7f707a4ebec13";
const EXPECTED_CORPUS = "2ac91e5d1ce0aed2";

function buildTask() {
  const spec = JSON.parse(fs.readFileSync(SMOKE_SPEC_FILE, "utf8"));
  spec.goal = { type: "heroAtLeast", floorId: "MT1", minHero: { exp: 9 } };
  return compileExecutableSolveTask({
    schema: "motapathfinder.solve-task.v1",
    tower: { id: "onlyup-smoke", projectRoot: ONLY_UP_ROOT, region: { spec } },
    objective: { mode: "max-final-hp" },
    search: {
      algorithm: "segment-dp",
      maxExpansions: 3000,
      maxRuntimeMs: 0,
      candidateLimit: 2,
      goalSkylineLimit: 8,
      captureExpandedStates: true,
      captureExpandedStateLimit: 256,
    },
    verification: { strictReplay: true },
  });
}

function actionSuccessorCorpus(simulator, states) {
  const corpus = states.map((state) => {
    const actions = ((simulator.enumeratePrimitiveActions(cloneState(state)) || {}).actions || [])
      .map((action) => ({
        fingerprint: simulator.getActionFingerprint(action),
        summary: action.summary,
        path: Array.isArray(action.path) ? action.path.slice() : [],
        travelExact: action.travelState ? exactStateFingerprint(action.travelState) : null,
        successorExact: exactStateFingerprint(simulator.applyAction(cloneState(state), action, { storeRoute: false })),
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    return { stateExact: exactStateFingerprint(state), actions };
  }).sort((left, right) => left.stateExact.localeCompare(right.stateExact));
  return {
    stateCount: corpus.length,
    actionCount: corpus.reduce((sum, entry) => sum + entry.actions.length, 0),
    fingerprint: fingerprintJson(corpus),
  };
}

async function runSample(repair) {
  const originalLog = console.log;
  let execution;
  console.log = () => {};
  try {
    execution = await executeSolveJob(buildTask(), {
      jobId: `battle-evaluation-projection-${repair ? "repair" : "control"}`,
      onProgress: () => {},
      shouldStop: () => false,
      context: {
        reachabilityRebaseAttribution: true,
        enableReachabilitySkeletonCache: true,
        enableTopologyFirstMaterialization: true,
        enableBattleEvaluationProjection: repair,
      },
    });
  } finally {
    console.log = originalLog;
  }
  const attempt = execution.result.segmentResults[0].attempts[0];
  const dp = attempt.diagnostics.dp;
  const states = dp.capturedExpandedStates || [];
  return {
    mode: repair ? "repair" : "control",
    correctness: {
      found: execution.result.found,
      strictReplayVerified: execution.strictReplayVerified,
      winnerExactFingerprint: exactStateFingerprint(execution.result.finalCandidate.state),
      routeFingerprint: buildReplayRouteFingerprint(execution.routeRecord).sha256,
      objectiveValue: execution.objectiveValue.value,
      expansions: Number(dp.expansions),
      acceptedStates: Number(dp.acceptedStates),
    },
    corpus: actionSuccessorCorpus(execution.simulator, states),
    attribution: execution.simulator.getReachabilityRebaseAttribution(),
    reachabilityCost: execution.simulator.getReachabilityCacheStats(),
    skeletonCost: execution.simulator.getActionExpansionCacheStats().reachabilitySkeleton,
  };
}

function runChild(mode) {
  const child = spawnSync(process.execPath, [__filename, `--sample=${mode}`], {
    cwd: __dirname,
    encoding: "utf8",
    maxBuffer: 12 * 1024 * 1024,
  });
  if (child.status !== 0) throw new Error(child.stderr || child.stdout);
  return JSON.parse(child.stdout);
}

function projectionIsolationControl() {
  const base = {
    floorId: "SYN",
    hero: { hp: 10, loc: { x: 1, y: 2, direction: "left" }, steps: 5 },
    inventory: { key: 1 },
    flags: { marker: 1 },
    floorStates: {},
  };
  const projection = buildBattleEvaluationProjection(base, {
    x: 4,
    y: 6,
    distance: 3,
    path: ["right", "down"],
  });
  assert.deepStrictEqual(projection.hero.loc, { x: 4, y: 6, direction: "down" });
  assert.strictEqual(projection.hero.steps, 8);
  assert.strictEqual(projection.inventory, base.inventory);
  assert.strictEqual(projection.flags, base.flags);
  assert.ok(Object.isFrozen(projection));
  assert.ok(Object.isFrozen(projection.hero));
  assert.ok(Object.isFrozen(projection.hero.loc));
  assert.deepStrictEqual(base.hero.loc, { x: 1, y: 2, direction: "left" });
  assert.strictEqual(base.hero.steps, 5);
  const materialized = cloneState(base);
  materialized.hero.loc = cloneState(projection.hero.loc);
  materialized.hero.steps = projection.hero.steps;
  const cacheKey = FunctionBackedBattleResolver.prototype.battleEstimateCacheKey;
  assert.strictEqual(
    cacheKey.call({}, projection, "SYN", 7, 8, "enemy"),
    cacheKey.call({}, materialized, "SYN", 7, 8, "enemy")
  );
  assert.strictEqual(canProjectBattleEvaluation({
    enableBattleEvaluationProjection: true,
    reachability: { getLookupState() {}, materializeNodeState() {} },
  }), true);
  assert.strictEqual(canProjectBattleEvaluation({
    enableBattleEvaluationProjection: true,
    reachability: { visited: {} },
  }), false);
  return {
    projectionShortLivedAndBaseUnchanged: true,
    projectedStanceMatchesMaterializedStance: true,
    battleCacheKeyExact: true,
    legacyExactReachabilityBypassesProjection: true,
  };
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
  const expectedCorrectness = {
    found: true,
    strictReplayVerified: true,
    winnerExactFingerprint: EXPECTED_WINNER_EXACT,
    routeFingerprint: EXPECTED_ROUTE_SHA256,
    objectiveValue: 1346,
    expansions: 116,
    acceptedStates: 156,
  };
  const expectedCorpus = { stateCount: 116, actionCount: 434, fingerprint: EXPECTED_CORPUS };
  samples.forEach((sample) => {
    assert.deepStrictEqual(sample.correctness, expectedCorrectness);
    assert.deepStrictEqual(sample.corpus, expectedCorpus);
  });
  const candidateOutcomeShape = (sample) => Object.fromEntries(Object.entries(
    sample.attribution.consumers.battle.candidateOutcomes
  ).map(([name, outcome]) => [name, {
    events: outcome.events,
    uniqueNodes: outcome.uniqueNodes,
  }]));
  const expectedCandidateOutcomes = candidateOutcomeShape(controls[0]);
  samples.forEach((sample) => {
    assert.deepStrictEqual(candidateOutcomeShape(sample), expectedCandidateOutcomes);
  });
  controls.forEach((sample) => {
    assert.strictEqual(sample.attribution.materializedNodes, 722);
    assert.strictEqual(sample.attribution.materializedNodesWithoutTravelStateEscape, 156);
    assert.strictEqual(sample.reachabilityCost.stateClones, 845);
  });
  repairs.forEach((sample) => {
    assert.strictEqual(sample.attribution.materializedNodes, 566);
    assert.strictEqual(sample.attribution.uniqueTravelStateNodes, 566);
    assert.strictEqual(sample.attribution.materializedNodesWithoutTravelStateEscape, 0);
    assert.strictEqual(sample.reachabilityCost.stateClones, 689);
    assert.strictEqual(sample.reachabilityCost.dominanceKeyBuilds, 0);
    assert.strictEqual(sample.skeletonCost.nodesMaterialized, 566);
    assert.strictEqual(sample.attribution.consumers.battle.uniqueStateNodes, 289);
    assert.strictEqual(sample.attribution.consumers.battle.uniqueTravelStateNodes, 289);
  });

  const projectionControls = projectionIsolationControl();
  process.stdout.write(`${JSON.stringify({
    schema: "motapathfinder.battle-evaluation-projection-check.v1",
    status: "passed",
    controls: {
      ...projectionControls,
      battleCandidateOutcomeParity: true,
      actionSuccessorExactParity: true,
      winnerRouteObjectiveScalePinned: true,
      strictReplayParity: true,
      legacyExactPathUnchanged: true,
    },
    workload: expectedCorrectness,
    corpus: expectedCorpus,
    structuralDelta: {
      materializedNodes: { control: 722, repair: 566 },
      reachabilityStateClones: { control: 845, repair: 689 },
      materializedWithoutTravelStateEscape: { control: 156, repair: 0 },
      dominanceKeyBuilds: { control: 0, repair: 0 },
      battleMaterializedNodes: { control: 568, repair: 289 },
      battleEmittedTravelStateNodes: { control: 289, repair: 289 },
    },
    verdict: "BATTLE_EVALUATION_PROJECTION_PROMOTED",
  }, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  });
}

module.exports = { main };
