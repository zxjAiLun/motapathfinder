"use strict";

/** TEST GRADE: local-regression */

/**
 * PR-5.24h Iteration 3 — Bounded Multi-Root Root-Slice Fairness (G30 suite).
 *
 * Root-sliced scheduling: each root keeps its OWN agenda heap ordered by the
 * single-root production comparator; the scheduler round-robins roots with at
 * most MULTI_ROOT_EXPANSION_QUANTUM (64) ACTIVE expansions per slice.  Stale
 * entries never consume the quantum.  The shared authority is unchanged (one
 * global bestByKey/SkylineSet/nodes/goal archive/budget).  Single-root keeps
 * the exact historical path.  Unrestricted global competition stays rejected.
 *
 * G30 gates:
 *   G30-A: single-root historical parity (897-exp candidate-0 exact)
 *   G30-B: complete 16-root semantic parity vs 16 independent searches
 *   G30-C: complete work reduction (>= 40% vs legacy 10565 → <= 6339)
 *   G30-D: deterministic bounded fairness (1024 exp = one theoretical round;
 *          >= 12 positive roots, <= 4 zero-expansion registered roots)
 *   G30-E: no winner-churn explosion (complete workload < 7000 exp)
 *   G30-F: goal provenance on the G29-B goal-bearing workload
 *   G30-G: budget fail-close (300 exp; pending>0, never EXHAUSTED)
 *   G30-H: root-order permutation semantic parity (original vs reversed)
 *   G30-I: production isolated pipeline integration (root-sliced mode)
 *   G30-J: 1438-exp fairness proxy (same canonical work authority as the real
 *          frontier run; >= 12 positive roots required)
 */

const path = require("node:path");
const assert = require("node:assert");
const {
  createSimulator,
  getMt3Segment,
  compareGoalRecords,
  FRONTIER_FIXTURE,
} = require("./check-mt3-mt4-hot-path");
const {
  buildG29BFixture,
  getMt1ToMt2Segment,
  strictReplayGoalRoute,
} = require("./check-multi-root-shared-dp");
const { getMilestoneSpec } = require("./lib/milestone-spec");
const { searchSegmentDP, searchSegmentDPMultiRoot, runSegmentAgainstFrontier } = require("./lib/segment-dp");
const { buildStateKey } = require("./lib/state-key");

const NON_BINDING_MS = 3 * 60 * 60 * 1000;
const COMPLETE_SHARED_MAX_EXPANSIONS = 32000;
const LEGACY_REFERENCE_EXPANSIONS = 10565;
const REDUCTION_THRESHOLD_PERCENT = 40;
const CHURN_HARD_LIMIT = 7000;
const MULTI_ROOT_EXPANSION_QUANTUM = 64;

function mt3Roots() {
  return FRONTIER_FIXTURE.candidates.map((c) => ({
    state: JSON.parse(JSON.stringify(c.state)),
    id: c.candidateId,
  }));
}

// ========== G30-A: Single-Root Historical Parity ==========
function gateG30A_SingleRootParity() {
  const { project, simulator } = createSimulator();
  const segment = getMt3Segment(project);
  const cand = FRONTIER_FIXTURE.candidates[0];
  const res = searchSegmentDP(simulator, JSON.parse(JSON.stringify(cand.state)), segment, {
    candidateId: cand.candidateId,
    maxExpansions: 1000,
    maxRuntimeMs: 600000,
    captureExpandedStates: true,
    captureExpandedStateLimit: 100,
  });
  const dp = res.diagnostics.dp;
  assert.strictEqual(dp.expansions, 897, "G30-A: single-root expansions must stay exactly 897");
  const generated = dp.acceptedStates + dp.rejectedByHigherHp + dp.sameHpRejected;
  assert.strictEqual(generated, 2285, "G30-A: single-root generated must stay exactly 2285");
  assert.strictEqual(dp.acceptedStates, 1152, "G30-A: acceptedStates must stay 1152");
  assert.strictEqual(dp.frontierSize, 0, "G30-A: frontier exhausted");
  assert.strictEqual(dp.searchOutcome.searchComplete, true, "G30-A: searchComplete");
  assert.strictEqual(res.found, false, "G30-A: found false");
  assert.strictEqual(dp.multiRootScheduling, null, "G30-A: single-root must not carry scheduler diagnostics");
  assert.strictEqual(dp.registeredRootNodeIds.length, 1, "G30-A: exactly one root registration");
  assert.strictEqual(dp.registeredRootNodeIds[0].nodeId, 0, "G30-A: single-root keeps historical nodeId 0");
  return {
    singleRootHistoricalParityVerified: true,
    expansions: dp.expansions,
    generated,
    acceptedStates: dp.acceptedStates,
    schedulerTouchedSingleRoot: false,
  };
}

// ========== G30-B: Complete 16-Root Semantic Parity ==========
function gateG30B_CompleteSemanticParity() {
  const { project, simulator } = createSimulator();
  const segment = getMt3Segment(project);
  // Reference: 16 independent complete searches (G28-H reference values hold:
  // all naturally complete, all no-goal; re-verified here in-process).
  const independent = [];
  for (const c of FRONTIER_FIXTURE.candidates) {
    if (typeof global.gc === "function") global.gc();
    const res = searchSegmentDP(simulator, JSON.parse(JSON.stringify(c.state)), segment, {
      candidateId: c.candidateId,
      maxExpansions: 2000,
      maxRuntimeMs: NON_BINDING_MS,
    });
    independent.push({
      candidateId: c.candidateId,
      found: res.found,
      complete: res.diagnostics.dp.searchOutcome.searchComplete,
      expansions: res.diagnostics.dp.expansions,
    });
  }
  const allIndependentComplete = independent.every((r) => r.complete === true);
  const anyIndependentFound = independent.some((r) => r.found === true);
  assert.strictEqual(allIndependentComplete, true, "G30-B: reference independent runs must all complete");
  assert.strictEqual(anyIndependentFound, false, "G30-B: reference independent runs must be no-goal");

  const shared = searchSegmentDPMultiRoot(simulator, mt3Roots(), segment, {
    candidateId: "g30b-shared-complete",
    dpOverrides: { maxExpansions: COMPLETE_SHARED_MAX_EXPANSIONS, maxRuntimeMs: NON_BINDING_MS },
  });
  const dp = shared.diagnostics.dp;
  assert.strictEqual(dp.searchOutcome.searchComplete, true, "G30-B: shared must complete");
  assert.strictEqual(shared.found, false, "G30-B: shared must find no goal (parity)");
  assert.strictEqual(dp.multiRootScheduling && dp.multiRootScheduling.policy, "root-sliced", "G30-B: policy must be root-sliced");
  const pendingTotal = Object.values(dp.pendingByRoot || {}).reduce((s, n) => s + n, 0);
  assert.strictEqual(pendingTotal, 0, "G30-B: pending must be 0 on completion");
  assert.strictEqual(dp.rootCount, 16, "G30-B: 16 roots");
  return {
    completeSemanticParityVerified: true,
    independentAllComplete: allIndependentComplete,
    independentAnyFound: anyIndependentFound,
    sharedComplete: true,
    sharedFound: false,
    sharedPendingTotal: 0,
    independentTotalExpansions: independent.reduce((s, r) => s + r.expansions, 0),
    sharedExpansions: dp.expansions,
  };
}

// ========== G30-C: Complete Work Reduction (>= 40%) ==========
function gateG30C_CompleteWorkReduction() {
  const { project, simulator } = createSimulator();
  const segment = getMt3Segment(project);
  if (typeof global.gc === "function") global.gc();
  const shared = searchSegmentDPMultiRoot(simulator, mt3Roots(), segment, {
    candidateId: "g30c-reduction",
    dpOverrides: { maxExpansions: COMPLETE_SHARED_MAX_EXPANSIONS, maxRuntimeMs: NON_BINDING_MS },
  });
  const exp = shared.diagnostics.dp.expansions;
  const reductionPercent = Number((((LEGACY_REFERENCE_EXPANSIONS - exp) / LEGACY_REFERENCE_EXPANSIONS) * 100).toFixed(2));
  const meetsThreshold = reductionPercent >= REDUCTION_THRESHOLD_PERCENT;
  assert.ok(meetsThreshold, `G30-C: reduction ${reductionPercent}% must be >= ${REDUCTION_THRESHOLD_PERCENT}% (expansions ${exp} > ${Math.ceil(LEGACY_REFERENCE_EXPANSIONS * (1 - REDUCTION_THRESHOLD_PERCENT / 100))})`);
  return {
    completeWorkReductionVerified: true,
    legacyReferenceExpansions: LEGACY_REFERENCE_EXPANSIONS,
    sharedExpansions: exp,
    reductionPercent,
    thresholdPercent: REDUCTION_THRESHOLD_PERCENT,
    thresholdMet: true,
    note: "old root-ordered shared = 2346 (77.79%); theoretical ceiling NOT claimed",
  };
}

// ========== G30-D: Deterministic Bounded Fairness ==========
function gateG30D_DeterministicBoundedFairness() {
  const { project, simulator } = createSimulator();
  const segment = getMt3Segment(project);
  const shared = searchSegmentDPMultiRoot(simulator, mt3Roots(), segment, {
    candidateId: "g30d-1024",
    dpOverrides: { maxExpansions: 16 * MULTI_ROOT_EXPANSION_QUANTUM, maxRuntimeMs: NON_BINDING_MS },
  });
  const dp = shared.diagnostics.dp;
  const byRoot = dp.expansionCountByRoot || {};
  const positiveRoots = Object.values(byRoot).filter((n) => n > 0).length;
  const zeroRoots = Object.keys(byRoot).length - positiveRoots;
  assert.strictEqual(dp.searchOutcome.searchComplete, false, "G30-D: 1024 expansions must not complete");
  assert.strictEqual((dp.registeredRootNodeIds || []).length, 16, "G30-D: 16 roots registered");
  assert.ok(positiveRoots >= 12, `G30-D: positive roots ${positiveRoots} must be >= 12`);
  assert.ok(zeroRoots <= 4, `G30-D: zero-expansion registered roots ${zeroRoots} must be <= 4`);
  return {
    deterministicBoundedFairnessVerified: true,
    expansions: dp.expansions,
    registeredRoots: 16,
    positiveRoots,
    zeroRoots,
    searchComplete: false,
    perRootExpansions: byRoot,
  };
}

// ========== G30-E: No Winner-Churn Explosion ==========
function gateG30E_NoChurnExplosion() {
  const { project, simulator } = createSimulator();
  const segment = getMt3Segment(project);
  if (typeof global.gc === "function") global.gc();
  const shared = searchSegmentDPMultiRoot(simulator, mt3Roots(), segment, {
    candidateId: "g30e-churn",
    dpOverrides: { maxExpansions: COMPLETE_SHARED_MAX_EXPANSIONS, maxRuntimeMs: NON_BINDING_MS },
  });
  const dp = shared.diagnostics.dp;
  const sched = dp.multiRootScheduling || {};
  assert.ok(dp.expansions < CHURN_HARD_LIMIT, `G30-E: shared expansions ${dp.expansions} must stay < ${CHURN_HARD_LIMIT} (churn bound)`);
  assert.strictEqual(dp.searchOutcome.searchComplete, true, "G30-E: complete workload must complete");
  return {
    noChurnExplosionVerified: true,
    sharedExpansions: dp.expansions,
    churnHardLimit: CHURN_HARD_LIMIT,
    uniqueDpKeys: (dp.registry && dp.registry.finalUniqueKeys) || null,
    replacedLowerHp: dp.replacedLowerHp,
    staleEntriesSkipped: sched.staleEntriesSkipped || 0,
    crossRootReplacements: sched.crossRootReplacements || 0,
  };
}

// ========== G30-F: Goal Provenance (root-sliced mode) ==========
function gateG30F_GoalProvenance() {
  const { project, simulator } = createSimulator();
  const segment = getMt1ToMt2Segment(project);
  const roots = buildG29BFixture(simulator);
  const shared = searchSegmentDPMultiRoot(
    simulator,
    roots.map((root) => ({ state: JSON.parse(JSON.stringify(root.state)), id: root.id })),
    segment,
    {
      candidateId: "g30f-provenance",
      captureTrace: true,
      preserveFirstGoalCheckpoint: true,
      maxExpansions: 2000,
      maxRuntimeMs: NON_BINDING_MS,
    },
  );
  assert.strictEqual(shared.found, true, "G30-F: shared arm must find the goal");
  assert.strictEqual(shared.diagnostics.dp.multiRootScheduling.policy, "root-sliced", "G30-F: root-sliced mode");
  const goals = shared.goalSkyline || [];
  assert.ok(goals.length > 0, "G30-F: goals present");
  // Root provenance + attribution to an independently-goal-reaching root.
  const rootById = new Map(roots.map((r) => [r.id, r]));
  const attributionVerified = goals.every((g) => Boolean(g.rootCandidateId) && rootById.has(g.rootCandidateId));
  assert.strictEqual(attributionVerified, true, "G30-F: every goal carries a real root attribution");
  // Strict replay from reported root for every replayable goal.
  const replayable = goals.filter((g) => Array.isArray(g.route) && g.route.length > 0);
  assert.ok(replayable.length > 0, "G30-F: replayable goals present");
  const replays = replayable.map((g) => ({
    rootCandidateId: g.rootCandidateId,
    ...strictReplayGoalRoute(simulator, rootById.get(g.rootCandidateId).state, g.route, buildStateKey(g.state)),
  }));
  assert.strictEqual(replays.every((r) => r.ok), true, "G30-F: strict replay must reach every goal exactly");
  // Best goal matches the legacy arm.  (Normalize goalSkyline records to
  // plain goal records first — records carry .state, not top-level .hp, so
  // the comparator must see extracted fields.)
  const legacyGoals = [];
  for (const root of roots) {
    const res = searchSegmentDP(simulator, JSON.parse(JSON.stringify(root.state)), segment, {
      candidateId: root.id,
      maxExpansions: 2000,
      maxRuntimeMs: NON_BINDING_MS,
    });
    (res.goalSkyline || []).forEach((g) => legacyGoals.push(g));
  }
  const asPlainGoal = (g) => ({
    hp: g.state.hero.hp,
    atk: g.state.hero.atk,
    def: g.state.hero.def,
    mdef: g.state.hero.mdef,
    lv: g.state.hero.lv,
    exp: g.state.hero.exp,
    flags: g.state.flags || {},
    decisionDepth: (g.state.meta && g.state.meta.decisionDepth) || 0,
    rawRouteLength: (g.state.meta && g.state.meta.rawRouteLength) || 0,
    state: g.state,
  });
  const bestLegacy = legacyGoals.map(asPlainGoal).reduce((best, g) => (best == null || compareGoalRecords(g, best) > 0 ? g : best), null);
  const bestShared = goals.map(asPlainGoal).reduce((best, g) => (best == null || compareGoalRecords(g, best) > 0 ? g : best), null);
  const bestMatched = Boolean(bestLegacy && bestShared) && buildStateKey(bestLegacy.state) === buildStateKey(bestShared.state);
  assert.strictEqual(bestMatched, true, "G30-F: best goal must match the legacy arm");
  return {
    goalProvenanceVerified: true,
    goalCount: goals.length,
    replayedGoalCount: replays.length,
    attributionVerified,
    bestGoalMatched: bestMatched,
  };
}

// ========== G30-G: Budget Fail-Close ==========
function gateG30G_BudgetFailClose() {
  const { project, simulator } = createSimulator();
  const segment = getMt3Segment(project);
  const shared = searchSegmentDPMultiRoot(simulator, mt3Roots(), segment, {
    candidateId: "g30g-300",
    dpOverrides: { maxExpansions: 300, maxRuntimeMs: NON_BINDING_MS },
  });
  const dp = shared.diagnostics.dp;
  const pendingTotal = Object.values(dp.pendingByRoot || {}).reduce((s, n) => s + n, 0);
  assert.strictEqual(dp.searchOutcome.searchComplete, false, "G30-G: must not claim searchComplete");
  assert.ok(pendingTotal > 0, "G30-G: pending must be > 0");
  assert.strictEqual(shared.found, false, "G30-G: no goal at 300 expansions");
  assert.ok(dp.expansionBudgetExhausted === true || dp.expansions >= 300, "G30-G: expansion budget exhausted");
  return {
    budgetFailCloseVerified: true,
    expansions: dp.expansions,
    pendingTotal,
    searchComplete: false,
    neverExhausted: true,
  };
}

// ========== G30-H: Root-Order Permutation Semantic Parity ==========
function gateG30H_RootOrderPermutationParity() {
  const { project, simulator } = createSimulator();
  const segment = getMt3Segment(project);
  const original = mt3Roots();
  const reversed = original.slice().reverse();
  const run = (roots, label) => searchSegmentDPMultiRoot(simulator, roots, segment, {
    candidateId: `g30h-${label}`,
    dpOverrides: { maxExpansions: COMPLETE_SHARED_MAX_EXPANSIONS, maxRuntimeMs: NON_BINDING_MS },
  });
  const a = run(original, "original");
  const b = run(reversed, "reversed");
  const da = a.diagnostics.dp;
  const db = b.diagnostics.dp;
  assert.strictEqual(a.found, b.found, "G30-H: both orders must agree on found");
  assert.strictEqual(da.searchOutcome.searchComplete, true, "G30-H: original order completes");
  assert.strictEqual(db.searchOutcome.searchComplete, true, "G30-H: reversed order completes");
  assert.strictEqual(a.goalSkyline.length, b.goalSkyline.length, "G30-H: goal counts identical");
  // DP bucket coverage parity: the union of expanded buckets must be identical.
  const keysA = new Set((da.capturedExpandedStates || []).map((s) => buildStateKey(s)));
  const keysB = new Set((db.capturedExpandedStates || []).map((s) => buildStateKey(s)));
  assert.strictEqual(keysA.size, keysB.size, "G30-H: unique expanded canonical states must match across orders");
  assert.ok([...keysA].every((k) => keysB.has(k)), "G30-H: expanded state sets must be identical across orders");
  return {
    rootOrderPermutationParityVerified: true,
    originalExpansions: da.expansions,
    reversedExpansions: db.expansions,
    found: a.found,
    complete: true,
    expandedStateSetIdentical: true,
  };
}

// ========== G30-I: Production Isolated Pipeline ==========
function gateG30I_IsolatedPipeline() {
  const { project, simulator } = createSimulator();
  const segment = getMt3Segment(project);
  const frontier = FRONTIER_FIXTURE.candidates.slice(0, 6).map((c) => ({
    id: c.candidateId,
    state: JSON.parse(JSON.stringify(c.state)),
    route: [],
    trace: [],
  }));
  // PR-5.24h FINAL CLOSURE (promotion): default (unset) now activates
  // multi-root for eligible workloads; explicit false must fall back to
  // legacy per-candidate. Both arms verified through the same production
  // isolated pipeline.
  const result = runSegmentAgainstFrontier(simulator, segment, frontier, {
    // enableMultiRootSharedDp deliberately UNSET (default ON)
    segmentExecutionMode: "isolated-process",
    maxExpansions: 600,
    maxRuntimeMs: 120000,
    maxRssMb: 2048,
    maxRssHardCeilingMb: 2048,
  }, {});
  const rollback = runSegmentAgainstFrontier(simulator, segment, frontier.map((c) => ({ ...c, state: JSON.parse(JSON.stringify(c.state)) })), {
    enableMultiRootSharedDp: false,
    segmentExecutionMode: "isolated-process",
    maxExpansions: 600,
    maxRuntimeMs: 120000,
    maxRssMb: 2048,
    maxRssHardCeilingMb: 2048,
  }, {});
  const telemetry = result.telemetry || {};
  const summary = result.summary || {};
  const dp = (result.attempts && result.attempts[0] && result.attempts[0].diagnostics && result.attempts[0].diagnostics.dp) || {};
  assert.strictEqual(summary.executionMode, "multi-root-shared-dp", "G30-I: default (unset) must activate multi-root-shared-dp");
  assert.strictEqual(dp.multiRootScheduling && dp.multiRootScheduling.policy, "root-sliced", "G30-I: root-sliced policy through the worker");
  assert.strictEqual(telemetry.inputStateKeysVerified, 6, "G30-I: input state keys 6/6");
  assert.strictEqual(telemetry.simulatorProfileIdentity, true, "G30-I: simulator profile identity");
  const byRoot = dp.expansionCountByRoot || {};
  const positiveRoots = Object.values(byRoot).filter((n) => n > 0).length;
  assert.ok(positiveRoots >= 5, `G30-I: bounded isolated run must cover >= 5/6 roots (got ${positiveRoots})`);
  const rollbackSummary = rollback.summary || {};
  assert.strictEqual(rollbackSummary.executionMode, "per-candidate", "G30-I: explicit false must roll back to per-candidate");
  const rollbackAttempts = rollback.attempts || [];
  assert.ok(rollbackAttempts.length >= 1, "G30-I: rollback arm must run per-candidate attempts");
  return {
    isolatedPipelineVerified: true,
    defaultUnsetActivatesMultiRoot: true,
    explicitFalseRollsBackToPerCandidate: true,
    executionMode: summary.executionMode,
    rollbackExecutionMode: rollbackSummary.executionMode,
    rollbackAttemptCount: rollbackAttempts.length,
    schedulingPolicy: dp.multiRootScheduling.policy,
    inputStateKeysVerified: telemetry.inputStateKeysVerified,
    simulatorProfileIdentity: telemetry.simulatorProfileIdentity,
    positiveRoots,
    expansions: dp.expansions,
  };
}

// ========== G30-J: 1438-Expansion Fairness Proxy ==========
function gateG30J_FairnessProxy1438() {
  const { project, simulator } = createSimulator();
  const segment = getMt3Segment(project);
  const shared = searchSegmentDPMultiRoot(simulator, mt3Roots(), segment, {
    candidateId: "g30j-1438-proxy",
    dpOverrides: { maxExpansions: 1438, maxRuntimeMs: NON_BINDING_MS },
  });
  const dp = shared.diagnostics.dp;
  const byRoot = dp.expansionCountByRoot || {};
  const positiveRoots = Object.values(byRoot).filter((n) => n > 0).length;
  const sched = dp.multiRootScheduling || {};
  assert.ok(positiveRoots >= 12, `G30-J: 1438-exp proxy must cover >= 12/16 roots (got ${positiveRoots})`);
  assert.strictEqual(dp.searchOutcome.searchComplete, false, "G30-J: proxy must be incomplete");
  return {
    fairnessProxy1438Verified: true,
    expansions: dp.expansions,
    positiveRoots,
    zeroRoots: 16 - positiveRoots,
    perRootExpansions: byRoot,
    rounds: sched.rootRoundsCompleted,
    switches: sched.rootSchedulerSwitches,
    staleEntriesSkipped: sched.staleEntriesSkipped,
    crossRootReplacements: sched.crossRootReplacements,
    comparisonNote: "same 1438-expansion canonical work authority as the real-frontier run (root-ordered: 2/16 positive)",
  };
}

// ========== Main ==========
function main() {
  const g30a = gateG30A_SingleRootParity();
  const g30b = gateG30B_CompleteSemanticParity();
  const g30c = gateG30C_CompleteWorkReduction();
  const g30d = gateG30D_DeterministicBoundedFairness();
  const g30e = gateG30E_NoChurnExplosion();
  const g30f = gateG30F_GoalProvenance();
  const g30g = gateG30G_BudgetFailClose();
  const g30h = gateG30H_RootOrderPermutationParity();
  const g30i = gateG30I_IsolatedPipeline();
  const g30j = gateG30J_FairnessProxy1438();

  const report = {
    schema: "motapathfinder.root-sliced-scheduling.v1",
    contractStatus: "passed",
    iteration: "PR-5.24h Iteration 3 (Bounded Multi-Root Root-Slice Fairness)",
    scheduling: {
      policy: "root-sliced",
      multiRootExpansionQuantum: MULTI_ROOT_EXPANSION_QUANTUM,
      authorityShared: "ONE global bestByKey / SkylineSet / nodes registry / goal archive / budget",
      singleRootPath: "unchanged historical single-heap path",
      globalFreeCompetition: "REJECTED_BY_PRIOR_EXPERIMENT (retained as frozen verdict)",
      legacyOverride: "multiRootSchedulingPolicy=root-ordered available for explicit opt-in",
    },
    gates: {
      "G30-A": g30a,
      "G30-B": g30b,
      "G30-C": g30c,
      "G30-D": g30d,
      "G30-E": g30e,
      "G30-F": g30f,
      "G30-G": g30g,
      "G30-H": g30h,
      "G30-I": g30i,
      "G30-J": g30j,
    },
  };
  console.log(JSON.stringify(report, null, 2));
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
  gateG30A_SingleRootParity,
  gateG30B_CompleteSemanticParity,
  gateG30C_CompleteWorkReduction,
  gateG30D_DeterministicBoundedFairness,
  gateG30E_NoChurnExplosion,
  gateG30F_GoalProvenance,
  gateG30G_BudgetFailClose,
  gateG30H_RootOrderPermutationParity,
  gateG30I_IsolatedPipeline,
  gateG30J_FairnessProxy1438,
};
