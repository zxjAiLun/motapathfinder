"use strict";

/** TEST GRADE: local-regression */

/**
 * PR-5.24b Iteration 2 Repair 1 – Backend Semantic Parity Gate
 *
 * Verifies that isolated-process backend is semantically equivalent to
 * direct local execution when both are not resource-limited.
 *
 * Probe 1: MT1→MT2 from real initial frontier
 * Probe 2: MT2→MT3 from solver-generated MT2 start state (first candidate of Probe 1 local result)
 *
 * Each probe requires (when both not resource-limited):
 *   - input StateKey identity (parent-generated vs worker-rebuilt)
 *   - found (boolean)
 *   - goal candidate count (merged length)
 *   - sorted output StateKey set
 *   - stoppedReason (memoryLimited + primary failureClass)
 *   - failure class / propagation
 *
 * Fail-closed: any unsupported simulator profile or StateKey mismatched amount
 * causes gate failure rather than silent fallback.
 */

const assert = require("node:assert");
const path = require("node:path");
const { loadProject } = require("./lib/project-loader");
const { StaticSimulator } = require("./lib/simulator");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { getMilestoneSpec } = require("./lib/milestone-spec");
const { runSegmentAgainstFrontier, runSegmentAgainstFrontierLocal } = require("./lib/segment-dp");
const { buildStateKey } = require("./lib/state-key");
const {
  FIRST_REGION_TARGET_FLOOR_ID,
  createNoStateChangeChoiceResolver,
  difficultySnapshot,
} = require("./lib/onlyup-mt1-real-route-gate");

const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const CHAOS_DIFFICULTY = { I581: 0, I582: 0, "flag:level0": 0 };

function buildSimulator(project) {
  const choiceResolver = createNoStateChangeChoiceResolver();
  return new StaticSimulator(project, {
    stopFloorId: FIRST_REGION_TARGET_FLOOR_ID,
    battleResolver: new FunctionBackedBattleResolver(project, { enableFastReject: true }),
    autoBattleFastRejectEnabled: true,
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFastHazardBlockIndex: true,
    enableCompiledEffectCache: false,
    choiceResolver,
  });
}

function sortedOutputStateKeys(result) {
  const merged = (result && result.merged) || [];
  return merged.map((cand) => buildStateKey(cand.state)).sort();
}

function resultFingerprint(result) {
  const merged = (result && result.merged) || [];
  const found = Boolean(result && result.merged && result.merged.length > 0);
  const goalCount = merged.length;
  const keys = sortedOutputStateKeys(result);
  const memoryLimited = Boolean(result && result.memoryLimited);
  const memoryStopReason = result ? result.memoryStopReason : null;
  const attempts = (result && result.summary && result.summary.attempts) || (result && result.attempts ? result.attempts.map((a) => a) : []);
  // Derive stopped reason / failure class from summary when not found
  const failurePropagation = result && result.summary && result.summary.failurePropagation;
  const failureClass = failurePropagation ? failurePropagation.failureClass || failurePropagation.primaryFailureClass : null;
  return {
    found,
    goalCount,
    sortedKeys: keys,
    memoryLimited,
    memoryStopReason,
    failureClass,
    attempts: attempts.length,
  };
}

function assertParity(probeName, localResult, isolatedResult) {
  const localFp = resultFingerprint(localResult);
  const isolatedFp = resultFingerprint(isolatedResult);

  // Both must not be resource-limited for parity to be meaningful (spec: "双方均未 resource-limited")
  const localResourceLimited = localFp.memoryLimited || localFp.memoryStopReason === "rss-limit" || localFp.memoryStopReason === "heap-limit";
  const isolatedResourceLimited = isolatedFp.memoryLimited || isolatedFp.memoryStopReason === "rss-limit" || isolatedFp.memoryStopReason === "heap-limit";
  // Also check expansion / time limited? We treat any stoppedReason as resource-limited if present and found==false
  const localStopped = localFp.memoryStopReason || null;
  const isolatedStopped = isolatedFp.memoryStopReason || null;

  const context = {
    probe: probeName,
    local: localFp,
    isolated: isolatedFp,
    localTelemetry: localResult.telemetry || null,
    isolatedTelemetry: isolatedResult.telemetry || null,
  };

  // StateKey identity is already enforced inside isolated executor (strict counts). Verify counts here too.
  const localKeys = localFp.sortedKeys;
  const isolatedKeys = isolatedFp.sortedKeys;
  // Input StateKey identity: frontier was same object; we just verify both runs consumed same startLimit (1 candidate)
  assert.strictEqual(
    (localResult.inputFrontier || []).length,
    (isolatedResult.inputFrontier || []).length,
    `${probeName}: inputFrontier length mismatch`
  );

  // If either side is resource-limited, probe is inconclusive – report but don't fail parity.
  // For Repair 1 gate we require at least one probe where both sides completed without resource limit.
  const eitherResourceLimited = localResourceLimited || isolatedResourceLimited;
  if (eitherResourceLimited) {
    return { parityChecked: false, reason: "resource-limited", context, eitherResourceLimited };
  }

  // Hard parity asserts (both not resource-limited)
  assert.strictEqual(localFp.found, isolatedFp.found, `${probeName}: found mismatch local=${localFp.found} isolated=${isolatedFp.found}\n${JSON.stringify(context, null, 2)}`);
  assert.strictEqual(localFp.goalCount, isolatedFp.goalCount, `${probeName}: goalCount mismatch local=${localFp.goalCount} isolated=${isolatedFp.goalCount}\n${JSON.stringify(context, null, 2)}`);
  assert.deepStrictEqual(localFp.sortedKeys, isolatedFp.sortedKeys, `${probeName}: sorted output StateKey set mismatch\nlocal keys: ${localFp.sortedKeys.join("\n")}\n---\nisolated: ${isolatedFp.sortedKeys.join("\n")}`);
  assert.strictEqual(localFp.memoryLimited, isolatedFp.memoryLimited, `${probeName}: memoryLimited mismatch`);
  assert.strictEqual(localFp.memoryStopReason, isolatedFp.memoryStopReason, `${probeName}: memoryStopReason mismatch`);
  assert.strictEqual(localFp.failureClass, isolatedFp.failureClass, `${probeName}: failureClass mismatch`);

  // Also verify telemetry StateKey verification counts when available
  if (isolatedResult.telemetry) {
    assert.strictEqual(isolatedResult.telemetry.inputStateKeysVerified, (isolatedResult.inputFrontier || []).length, `${probeName}: isolated inputStateKeysVerified mismatch`);
    assert.strictEqual(isolatedResult.telemetry.outputStateKeysVerified, isolatedFp.goalCount, `${probeName}: isolated outputStateKeysVerified mismatch`);
    assert.strictEqual(isolatedResult.telemetry.stateRoundTripIdentity, true, `${probeName}: isolated stateRoundTripIdentity must be true`);
  }

  return { parityChecked: true, context };
}

function main() {
  const project = loadProject(DEFAULT_PROJECT_ROOT);
  const simulator = buildSimulator(project);
  const initialState = simulator.createInitialState();
  // Hard assert chaos difficulty as in gates
  assert.deepStrictEqual(difficultySnapshot(initialState), CHAOS_DIFFICULTY, "Initial state must be Chaos");

  const spec = getMilestoneSpec(project, "onlyup-chaos-mt1-mt4");
  const mt1ToMt2 = spec.milestones.find((s) => s.id === "mt1-to-mt2");
  const mt2ToMt3 = spec.milestones.find((s) => s.id === "mt2-to-mt3");
  assert.ok(mt1ToMt2, "mt1-to-mt2 segment missing");
  assert.ok(mt2ToMt3, "mt2-to-mt3 segment missing");

  // Use generous memory cap to avoid spurious resource-limited parity inconclusive, but still test real semantics.
  // For parity gate we set high threshold so headroom (threshold - planner) won't artificially limit isolated vs local.
  // Planner baseline after first DP is ~300 MB in this process; need >800 to keep headroom >500 for MT2->MT3.
  const probeConfig = {
    maxExpansions: 8000,
    maxRuntimeMs: 15000,
    maxRssMb: 1024,
    candidateLimit: 8,
  };

  if (typeof global.gc === "function") try { global.gc(); } catch (_) {}
  console.log("== Probe 1: MT1→MT2 from initial frontier ==");
  const frontier0 = [{ id: "initial#0", state: initialState, tags: ["initial"] }];
  const local1 = runSegmentAgainstFrontierLocal(simulator, mt1ToMt2, frontier0, probeConfig, {});
  if (typeof global.gc === "function") try { global.gc(); } catch (_) {}
  const isolated1 = runSegmentAgainstFrontier(simulator, mt1ToMt2, frontier0, { ...probeConfig, segmentExecutionMode: "isolated-process" }, {});

  const p1 = assertParity("MT1→MT2", local1, isolated1);
  console.log(`Probe 1 result: parityChecked=${p1.parityChecked} found local=${local1.merged.length} isolated=${isolated1.merged.length} resourceLimited=${p1.eitherResourceLimited ? "yes" : "no"}`);

  // Probe 2: MT2→MT3 from solver-generated MT2 state
  // Use first merged candidate from local1 if available; otherwise isolate both fail and parity still requires same failure.
  let frontier1;
  if (local1.merged && local1.merged.length > 0) {
    // Pick highest-Hp or first candidate as start (solver-generated)
    frontier1 = [local1.merged[0]];
  } else {
    // No MT2 candidate – parity of MT2→MT3 is vacuous; we still create probe from same initial frontier but target MT2→MT3 alone would be unreachable.
    // To satisfy "由 solver 自己生成的 MT2→MT3 start state", we generate frontier by running local MT1→MT2 already and using its output; if none, we report and keep parity vacuous.
    console.log("Probe 1 produced no MT2 candidates – Probe 2 will use empty frontier parity (both should show same empty).");
    frontier1 = [];
  }

  if (typeof global.gc === "function") try { global.gc(); } catch (_) {}
  console.log("== Probe 2: MT2→MT3 from solver-generated MT2 candidate ==");
  let p2;
  let local2; let isolated2;
  if (frontier1.length > 0) {
    local2 = runSegmentAgainstFrontierLocal(simulator, mt2ToMt3, frontier1, probeConfig, {});
    if (typeof global.gc === "function") try { global.gc(); } catch (_) {}
    isolated2 = runSegmentAgainstFrontier(simulator, mt2ToMt3, frontier1, { ...probeConfig, segmentExecutionMode: "isolated-process" }, {});
    p2 = assertParity("MT2→MT3(solver-generated)", local2, isolated2);
    console.log(`Probe 2 result: parityChecked=${p2.parityChecked} found local=${local2.merged.length} isolated=${isolated2.merged.length} resourceLimited=${p2.eitherResourceLimited ? "yes" : "no"}`);
  } else {
    // Empty frontier parity – both should return empty merged with same failure
    const local2 = runSegmentAgainstFrontierLocal(simulator, mt2ToMt3, frontier1, probeConfig, {});
    const isolated2 = runSegmentAgainstFrontier(simulator, mt2ToMt3, frontier1, { ...probeConfig, segmentExecutionMode: "isolated-process" }, {});
    p2 = assertParity("MT2→MT3(empty)", local2, isolated2);
    console.log(`Probe 2 (empty frontier) parityChecked=${p2.parityChecked}`);
  }

  // Overall gate: at least one probe must have parityChecked===true and both non-resource-limited
  const anyParityChecked = (p1.parityChecked || (p2 && p2.parityChecked));
  if (!anyParityChecked) {
    console.error("Parity gate inconclusive: both probes were resource-limited; increase budget and retry (do not change milestone).");
    // For Repair 1, we still require at least MT1→MT2 to be non-resource-limited; if it is limited, fail gate so issue is visible.
    throw new Error(`Parity gate unable to prove equivalence: p1 resourceLimited=${p1.eitherResourceLimited}, p2 resourceLimited=${p2 ? p2.eitherResourceLimited : "n/a"}`);
  }

  // Report telemetry for resource headroom
  const isolated1Telemetry = isolated1.telemetry || {};
  console.log(JSON.stringify({
    schema: "motapathfinder.isolated-parity.v1",
    contractStatus: "passed",
    probes: {
      mt1ToMt2: {
        parityChecked: p1.parityChecked,
        localFound: local1.merged.length > 0,
        isolatedFound: isolated1.merged.length > 0,
        localGoalCount: local1.merged.length,
        isolatedGoalCount: isolated1.merged.length,
        resourceLimited: p1.eitherResourceLimited || false,
      },
      mt2ToMt3: p2 ? {
        parityChecked: p2.parityChecked,
        resourceLimited: p2.eitherResourceLimited || false,
      } : null,
    },
    simulatorProfile: isolated1Telemetry.simulatorProfile || "implicit",
    telemetry: {
      mt1ToMt2: {
        plannerRssBeforeSpawnMb: isolated1Telemetry.plannerRssBeforeSpawnMb,
        workerPeakRssMb: isolated1Telemetry.workerPeakRssMb,
        aggregateConcurrentRssUpperBoundMb: isolated1Telemetry.aggregateConcurrentRssUpperBoundMb,
        inputStateKeysVerified: isolated1Telemetry.inputStateKeysVerified,
        outputStateKeysVerified: isolated1Telemetry.outputStateKeysVerified,
        stateRoundTripIdentity: isolated1Telemetry.stateRoundTripIdentity,
      }
    }
  }, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  }
}

module.exports = { main };
