"use strict";

/**
 * TEST GRADE: unit-plus-micro
 *
 * PR-5.9e Remaining Materialization Attribution.
 *
 * Proves that topology-first nodes materialized without a final travel-state
 * escape are exclusively battle stances rejected before action emission. This
 * is observation-only: no resolver selection or battle semantics change.
 */

const assert = require("node:assert");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const { ReachabilityRebaseAttribution } = require("./lib/reachability-rebase-attribution");
const { buildReplayRouteFingerprint } = require("./lib/replay-resume-artifact");
const { compileExecutableSolveTask } = require("./lib/solve-task");
const { executeSolveJob, exactStateFingerprint } = require("./lib/solver-job");

const ROOT = path.resolve(__dirname, "..");
const ONLY_UP_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");
const SMOKE_SPEC_FILE = path.join(ROOT, "towers", "onlyup", "region-specs", "region-output-contract-smoke.json");
const EXPECTED_WINNER_EXACT = "a2ff379819ac9003";
const EXPECTED_ROUTE_SHA256 = "c0adb2d921e84cab097c034bf7b6f8fdb5a344a0cb21f66ea3b7f707a4ebec13";

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

async function runSample(observe) {
  const originalLog = console.log;
  let execution;
  console.log = () => {};
  try {
    execution = await executeSolveJob(buildTask(), {
      jobId: `remaining-materialization-${observe ? "observed" : "control"}`,
      onProgress: () => {},
      shouldStop: () => false,
      context: {
        reachabilityRebaseAttribution: observe,
        enableReachabilitySkeletonCache: true,
        enableTopologyFirstMaterialization: true,
        enableBattleEvaluationProjection: false,
      },
    });
  } finally {
    console.log = originalLog;
  }
  const attempt = execution.result.segmentResults[0].attempts[0];
  const dp = attempt.diagnostics.dp;
  return {
    observe,
    correctness: {
      found: execution.result.found,
      strictReplayVerified: execution.strictReplayVerified,
      winnerExactFingerprint: exactStateFingerprint(execution.result.finalCandidate.state),
      routeFingerprint: buildReplayRouteFingerprint(execution.routeRecord).sha256,
      objectiveValue: execution.objectiveValue.value,
      expansions: Number(dp.expansions),
      acceptedStates: Number(dp.acceptedStates),
    },
    reachabilityCost: {
      stateClones: execution.simulator.getReachabilityCacheStats().stateClones,
      dominanceKeyBuilds: execution.simulator.getReachabilityCacheStats().dominanceKeyBuilds,
    },
    attribution: execution.simulator.getReachabilityRebaseAttribution(),
  };
}

function runChild(observe) {
  const child = spawnSync(process.execPath, [__filename, `--sample=${observe ? "observed" : "control"}`], {
    cwd: __dirname,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (child.status !== 0) throw new Error(child.stderr || child.stdout);
  return JSON.parse(child.stdout);
}

function syntheticUnionControl() {
  const attribution = new ReachabilityRebaseAttribution();
  let observer = null;
  const state = { marker: "synthetic" };
  const node = {
    get state() {
      if (observer) observer("state", state);
      return state;
    },
    __topologyFirstMaterialization: {
      setAccessObserver: (nextObserver) => { observer = nextObserver; },
    },
  };
  const reachability = {
    visited: { "0,0": node },
    diagnostics: {
      mode: "safe-fast",
      topologyFirstMaterialization: true,
      skeletonBuilt: true,
    },
  };
  attribution.instrumentReachability(reachability);
  attribution.withConsumer("battle", () => {
    void node.state;
    attribution.recordTopologyNodeCost({ type: "state-clone", node });
    attribution.recordCandidateOutcome("battle", "lethal", node);
    attribution.recordCandidateOutcome("battle", "no-damage-info", node);
  });
  const report = attribution.report();
  assert.strictEqual(report.materializedNodesWithoutTravelStateEscape, 1);
  assert.deepStrictEqual(report.materializedWithoutTravelStateConsumerSignatures, { battle: 1 });
  assert.deepStrictEqual(report.unescapedCandidateOutcomeSignatures, {
    battle: { "lethal+no-damage-info": 1 },
  });
  return true;
}

async function main() {
  const sampleArg = process.argv.find((value) => value.startsWith("--sample="));
  if (sampleArg) {
    process.stdout.write(`${JSON.stringify(await runSample(sampleArg.endsWith("observed")))}\n`);
    return;
  }

  const control = runChild(false);
  const observed = runChild(true);
  const pinnedCorrectness = {
    found: true,
    strictReplayVerified: true,
    winnerExactFingerprint: EXPECTED_WINNER_EXACT,
    routeFingerprint: EXPECTED_ROUTE_SHA256,
    objectiveValue: 1346,
    expansions: 116,
    acceptedStates: 156,
  };
  assert.deepStrictEqual(control.correctness, pinnedCorrectness);
  assert.deepStrictEqual(observed.correctness, pinnedCorrectness);
  assert.deepStrictEqual(control.reachabilityCost, observed.reachabilityCost);
  assert.strictEqual(control.attribution, null);

  const attribution = observed.attribution;
  assert.strictEqual(attribution.materializedNodes, 722);
  assert.strictEqual(attribution.uniqueTravelStateNodes, 566);
  assert.strictEqual(attribution.materializedNodesWithoutTravelStateEscape, 156);
  assert.deepStrictEqual(attribution.materializedWithoutTravelStateConsumerSignatures, { battle: 156 });
  assert.deepStrictEqual(attribution.unescapedCandidateOutcomeSignatures, {
    battle: {
      "enemy-adjacency+lethal": 119,
      "enemy-adjacency+lethal+no-damage-info": 6,
      "enemy-adjacency+no-damage-info": 31,
    },
  });
  const battle = attribution.consumers.battle;
  assert.strictEqual(battle.materializedWithoutTravelStateEscape, 156);
  assert.deepStrictEqual(battle.candidateOutcomes, {
    "dedup-inserted": { events: 289, uniqueNodes: 289, materializedWithoutTravelStateEscape: 0 },
    "enemy-adjacency": { events: 642, uniqueNodes: 568, materializedWithoutTravelStateEscape: 156 },
    lethal: { events: 147, uniqueNodes: 142, materializedWithoutTravelStateEscape: 125 },
    "no-damage-info": { events: 206, uniqueNodes: 200, materializedWithoutTravelStateEscape: 37 },
    viable: { events: 289, uniqueNodes: 289, materializedWithoutTravelStateEscape: 0 },
  });
  assert.ok(!Object.prototype.hasOwnProperty.call(battle.candidateOutcomes, "unsupported"));
  assert.ok(!Object.prototype.hasOwnProperty.call(battle.candidateOutcomes, "dedup-rejected"));
  assert.ok(!Object.prototype.hasOwnProperty.call(battle.candidateOutcomes, "dedup-replaced"));

  process.stdout.write(`${JSON.stringify({
    schema: "motapathfinder.remaining-materialization-attribution-check.v1",
    status: "passed",
    controls: {
      observationDefaultOff: true,
      observationOnlyExactParity: true,
      observationOnlyCostParity: true,
      overlapCountedBySetUnion: syntheticUnionControl(),
      resolverSelectionUntouched: true,
      battleSemanticsUntouched: true,
    },
    workload: pinnedCorrectness,
    materialization: {
      topologyMaterializedNodes: attribution.materializedNodes,
      uniqueTravelStateNodes: attribution.uniqueTravelStateNodes,
      remainingNodes: attribution.materializedNodesWithoutTravelStateEscape,
      consumerSignatures: attribution.materializedWithoutTravelStateConsumerSignatures,
      battleOutcomeSignatures: attribution.unescapedCandidateOutcomeSignatures.battle,
      battleCandidateOutcomes: battle.candidateOutcomes,
    },
    conclusion: {
      mechanism: "BATTLE_PRE_ACTION_REJECTION_MATERIALIZATION",
      dedupContribution: 0,
      repairUpperBoundNodes: 156,
      nextRepairScope: "project battle stance into evaluation without cloning mutable travel state; materialize only viable emitted actions",
    },
    verdict: "REMAINING_MATERIALIZATION_ATTRIBUTED",
  }, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  });
}

module.exports = { main };
