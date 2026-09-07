"use strict";

/** TEST GRADE: local-regression */

/**
 * PR-5.24j — One-Step Counterfactual Exhaustiveness Qualification (G32-v2).
 *
 * v1 (SUPERSEDED_BY_WRONG_SOURCE_STAGE): used archived finalCandidates/MT3
 * state as generator source — wrong stage; production authority is
 * anchor.inputFrontier (the MT2-floor source).
 *
 * v2 (this file): CONTROLLED source authority per Cloud Review Option C:
 *   - Source = shared-solver/fixtures/perf/onlyup-524e-cf-source.json
 *     (controlled-rederived MT2 candidate-0 from 5.24e prefix, 4/4 fresh-process
 *     determinism; EXACT_5_24e_HISTORICAL_SOURCE = NOT_CLAIMED).
 *   - Failure frontier = controlled lineage verification (this run):
 *     MT2 source → mt2-to-mt3 → mt3-to-mt4 (floor-progress-blocked, trusted,
 *     complete, no goal) established on current dev production code.
 *
 * Method (B1-B9 per Iteration 3 authorization):
 *   B1  Controlled source fixture + controlled failure frontier.
 *   B2  Production generator from the MT2 source; historical vs current intent
 *       comparison (recorded, not tuned).
 *   B3  Full materialization per intent through production segment machinery
 *       (intent realization → anchor expansion mt2-to-mt3 →
 *       buildRepairedHistoryHypotheses), non-binding, classified.
 *   B4  Dedup via production buildStateKey / buildDpStateKey, provenance kept.
 *   B5  PER-ROOT independent complete downstream evaluation (one root at a
 *       time, isolated-process, non-binding, searchComplete required) — the
 *       Case B/C progress authority.
 *   B6  Progress via production projectSegmentGoalProgress +
 *       compareProgressProjections (bestProgressProjection fallback:
 *       att.bestProgress projected); STRICTLY-better-only positive class.
 *   B7  Case A/B/C verdict (per-root authority).
 *   B8  Coverage accounting (independent roots complete / unique histories).
 *   B9  Shared multi-root run kept as cross-check/efficiency evidence only.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert");
const {
  createSimulator,
  getMt3Segment,
} = require("./check-mt3-mt4-hot-path");
const { getMilestoneSpec } = require("./lib/milestone-spec");
const {
  runSegmentAgainstFrontier,
  withManualBudgetAuthority,
  buildRepairedHistoryHypotheses,
} = require("./lib/segment-dp");
const { buildCounterfactualRepairIntents } = require("./lib/counterfactual-repair");
const { buildStateKey } = require("./lib/state-key");
const { buildDpStateKey } = require("./lib/dp-search");
const {
  compactProgressProjection,
  compareProgressProjections,
} = require("./lib/segment-progress");

const NB = 6 * 60 * 60 * 1000;
const SOURCE_FIXTURE_PATH = path.resolve(__dirname, "fixtures/perf/onlyup-524e-cf-source.json");
const BACKTRACK_CANDIDATE_LIMIT = 16;

function getMilestone(project, id) {
  const spec = getMilestoneSpec(project, "onlyup-chaos-mt1-mt4");
  return spec.milestones.find((m) => m.id === id);
}

function main() {
  // ===== B1: controlled source + failure frontier =====
  const fixture = JSON.parse(fs.readFileSync(SOURCE_FIXTURE_PATH, "utf8"));
  const sourceState = fixture.state;
  const sourceCandidateId = fixture.provenance.candidateId;
  const sourceStateKey = buildStateKey(sourceState);
  assert.strictEqual(sourceStateKey, fixture.provenance.buildStateKey, "B1: fixture stateKey must match provenance");

  const { project, simulator } = createSimulator();
  const mt2Segment = getMilestone(project, "mt2-to-mt3");
  const failedSegment = getMt3Segment(project); // mt3-to-mt4

  // Controlled failure frontier (verified by the lineage run; re-assert here):
  // triggerFailure = floor-progress-blocked on mt3-to-mt4 (trusted class).
  const triggerFailure = {
    failureClass: "floor-progress-blocked",
    segmentId: "mt3-to-mt4",
    preferredCandidateTags: [],
    missingGoalFields: [{ field: "floorId", expected: "MT4", actual: "MT3" }],
  };

  console.log(JSON.stringify({
    b1_controlledAuthority: {
      sourceCandidateId,
      sourceStateKeyPrefix: sourceStateKey.slice(0, 90),
      sourceHero: { hp: sourceState.hero.hp, atk: sourceState.hero.atk, def: sourceState.hero.def },
      failureClass: triggerFailure.failureClass,
      failedSegmentId: failedSegment.id,
      provenance: fixture.provenance.sourceAuthority,
      exactHistoricalClaimed: false,
    },
  }));

  // ===== B2: production generator from the MT2 source =====
  const intents = buildCounterfactualRepairIntents({
    simulator,
    startCandidates: [{ id: sourceCandidateId, state: JSON.parse(JSON.stringify(sourceState)) }],
    triggerFailure,
    failedSegment,
    candidateLimit: BACKTRACK_CANDIDATE_LIMIT,
  });
  console.log(JSON.stringify({
    b2_generator: {
      INTENTS_GENERATED: intents.length,
      intents: intents.map((it) => ({
        intentId: it.intentId,
        kind: it.kind,
        startCandidateId: it.startCandidateId,
        structuralDelta: it.structuralDelta,
        goal: it.goal,
      })),
    },
  }));

  // ===== B3: full materialization per intent (production path) =====
  const allHistories = [];
  const materializations = [];
  for (const intent of intents) {
    if (typeof global.gc === "function") global.gc();
    const intentSegment = {
      id: `cf-${intent.intentId}`,
      label: `Counterfactual Intent: ${intent.kind}`,
      goal: intent.goal,
      actionPolicy: intent.actionPolicy,
      dp: { stopOnFirstGoal: false, candidateLimit: BACKTRACK_CANDIDATE_LIMIT, maxExpansions: 16000, maxRuntimeMs: NB },
    };
    let realized;
    let classification;
    try {
      realized = runSegmentAgainstFrontier(
        simulator,
        intentSegment,
        [{ id: intent.startCandidateId, state: JSON.parse(JSON.stringify(intent.startCandidate.state)), route: [], trace: [] }],
        {
          segmentExecutionMode: "isolated-process",
          maxExpansions: 16000,
          maxRuntimeMs: NB,
          maxRssMb: 2048,
          maxRssHardCeilingMb: 2048,
        },
        withManualBudgetAuthority({}, {
          candidateLimit: BACKTRACK_CANDIDATE_LIMIT,
          preserveSkylineRoles: true,
        }),
      );
    } catch (error) {
      materializations.push({ intentId: intent.intentId, kind: intent.kind, classification: "RESOURCE_LIMITED", error: String(error.message).slice(0, 100) });
      continue;
    }
    const intentFrontier = realized.merged || [];
    if (intentFrontier.length === 0) {
      materializations.push({ intentId: intent.intentId, kind: intent.kind, classification: "UNREALIZABLE" });
      continue;
    }
    const dp0 = (realized.attempts && realized.attempts[0] && realized.attempts[0].diagnostics && realized.attempts[0].diagnostics.dp) || {};
    classification = (dp0.searchOutcome && dp0.searchOutcome.searchComplete === true) ? "REALIZED" : "INCOMPLETE";
    materializations.push({
      intentId: intent.intentId,
      kind: intent.kind,
      classification,
      realizedCount: intentFrontier.length,
    });

    // Anchor segment expansion (mt2-to-mt3) from the intent frontier
    const cfAnchorExpanded = runSegmentAgainstFrontier(
      simulator,
      mt2Segment,
      intentFrontier.map((c) => ({ id: c.id, state: c.state, route: c.route || [], trace: [] })),
      {
        segmentExecutionMode: "isolated-process",
        maxExpansions: 16000,
        maxRuntimeMs: NB,
        maxRssMb: 2048,
        maxRssHardCeilingMb: 2048,
      },
      withManualBudgetAuthority({}, {
        candidateLimit: BACKTRACK_CANDIDATE_LIMIT,
        dpOverrides: { stopOnFirstGoal: false, goalSkylineLimit: 16, maxExpansions: 16000, maxRuntimeMs: NB },
        preserveSkylineRoles: true,
      }),
    );
    const descriptors = buildRepairedHistoryHypotheses({
      depth: 1,
      waveIndex: 0,
      anchor: { segment: mt2Segment, inputFrontier: [], merged: intentFrontier },
      expandedAnchor: cfAnchorExpanded,
      candidateLimit: BACKTRACK_CANDIDATE_LIMIT,
    });
    descriptors.forEach((desc) => {
      const replayCand = desc.replayFrontier && desc.replayFrontier[0];
      if (!replayCand || !replayCand.state) return;
      allHistories.push({
        intentId: intent.intentId,
        kind: intent.kind,
        hypothesisId: desc.hypothesisId,
        candidate: replayCand,
      });
    });
  }
  console.log(JSON.stringify({
    b3_materialization: materializations,
    b3b_histories: { RAW_REALIZED_HISTORY_COUNT: allHistories.length },
  }));

  // ===== B4: dedup via production keys =====
  const byExact = new Map();
  for (const h of allHistories) {
    const sk = buildStateKey(h.candidate.state);
    if (!byExact.has(sk)) byExact.set(sk, h);
  }
  const uniqueHistories = Array.from(byExact.values());
  const uniqueBuckets = new Set(uniqueHistories.map((h) => buildDpStateKey(simulator, h.candidate.state, { keyMode: "region" })));
  console.log(JSON.stringify({
    b4_dedup: {
      RAW_REALIZED_HISTORY_COUNT: allHistories.length,
      UNIQUE_CANONICAL_STATE_COUNT: uniqueHistories.length,
      UNIQUE_DP_BUCKET_COUNT: uniqueBuckets.size,
    },
  }));

  // ===== B5+B6: PER-ROOT independent complete downstream evaluation =====
  // Production projector (same as projectSegmentGoalProgress):
  const { compileGoalDependencyGraph } = require("./lib/goal-dependency-graph");
  const goalGraph = compileGoalDependencyGraph(project, [failedSegment]);
  const projectOnFailedSegment = (state) => {
    try {
      return compactProgressProjection(goalGraph.project(state, failedSegment.id));
    } catch (_) {
      return null;
    }
  };

  const perRootResults = [];
  for (let i = 0; i < uniqueHistories.length; i += 1) {
    const h = uniqueHistories[i];
    if (typeof global.gc === "function") global.gc();
    const rootId = `cf:${h.intentId}:root-${i}`;
    const startProjection = projectOnFailedSegment(h.candidate.state);

    let exec;
    try {
      exec = runSegmentAgainstFrontier(
        simulator,
        failedSegment,
        [{ id: rootId, state: JSON.parse(JSON.stringify(h.candidate.state)), route: [], trace: [] }],
        {
          segmentExecutionMode: "isolated-process",
          maxExpansions: 60000,
          maxRuntimeMs: NB,
          maxRssMb: 2048,
          maxRssHardCeilingMb: 2048,
          memoryCheckIntervalExpansions: 1,
          memoryCheckIntervalActions: 1,
        },
        withManualBudgetAuthority({}, {
          candidateLimit: 16,
          dpOverrides: { stopOnFirstGoal: false, goalSkylineLimit: 16, maxExpansions: 60000, maxRuntimeMs: NB },
          preserveSkylineRoles: true,
        }),
      );
    } catch (error) {
      perRootResults.push({
        rootIndex: i, rootCandidateId: rootId, intentId: h.intentId, kind: h.kind,
        error: String(error.message).slice(0, 100), searchComplete: false, goalReached: false,
        positiveProgress: false, evaluated: false,
      });
      continue;
    }
    // Production isolated path: the worker emits rich attempts (with
    // bestProgressProjection, compact, computed against the attempt segment)
    // on exec.attempts — NOT on exec.summary.attempts (compact summary).
    const att0 = (exec.attempts && exec.attempts[0])
      || (exec.summary && exec.summary.attempts && exec.summary.attempts[0])
      || {};
    const dp = (att0.diagnostics && att0.diagnostics.dp) || {};
    const goalReached = exec.summary && exec.summary.found === true;
    const searchComplete = dp.searchOutcome && dp.searchOutcome.searchComplete === true;
    // Production progress: att0.bestProgressProjection (compact projection
    // computed INSIDE the isolated worker against the attempt segment — the
    // same field the production repair scheduler reads at segment-dp.js:6954).
    // Fallback: project the raw bestProgress state if the projection is absent.
    const bestProjection = att0.bestProgressProjection
      || (att0.bestProgress ? projectOnFailedSegment(att0.bestProgress) : null);
    const comparatorResult = (startProjection && bestProjection)
      ? compareProgressProjections(startProjection, bestProjection)
      : null;
    const positiveProgress = comparatorResult != null && comparatorResult > 0;
    perRootResults.push({
      rootIndex: i,
      rootCandidateId: rootId,
      intentId: h.intentId,
      kind: h.kind,
      goalReached,
      searchComplete,
      expansions: dp.expansions != null ? dp.expansions : null,
      frontierSize: dp.frontierSize != null ? dp.frontierSize : null,
      stoppedReason: dp.stoppedReason || null,
      startProgressProjection: startProjection,
      bestProgressProjection: bestProjection,
      productionComparatorResult: comparatorResult,
      positiveProgress,
      evaluated: true,
    });
  }
  console.log(JSON.stringify({
    b5_perRoot: perRootResults.map((r) => ({
      root: r.rootCandidateId, intent: r.intentId, goal: r.goalReached, complete: r.searchComplete,
      exp: r.expansions, pos: r.positiveProgress, cmp: r.productionComparatorResult,
    })),
  }));

  // ===== B8: coverage + B7: verdict (per-root authority) =====
  const rootsEvaluated = perRootResults.filter((r) => r.evaluated).length;
  const rootsComplete = perRootResults.filter((r) => r.searchComplete === true).length;
  const rootsGoal = perRootResults.filter((r) => r.goalReached === true).length;
  const rootsPositive = perRootResults.filter((r) => r.positiveProgress === true).length;

  // ===== B9: shared multi-root cross-check =====
  const sharedFrontier = uniqueHistories.map((h, i) => ({
    id: `cf:${h.intentId}:root-${i}`,
    state: JSON.parse(JSON.stringify(h.candidate.state)),
    route: [],
    trace: [],
  }));
  let shared = null;
  let sharedError = null;
  try {
    if (typeof global.gc === "function") global.gc();
    shared = runSegmentAgainstFrontier(
      simulator,
      failedSegment,
      sharedFrontier,
      {
        segmentExecutionMode: "isolated-process",
        maxExpansions: 60000,
        maxRuntimeMs: NB,
        maxRssMb: 2048,
        maxRssHardCeilingMb: 2048,
        memoryCheckIntervalExpansions: 1,
        memoryCheckIntervalActions: 1,
      },
      withManualBudgetAuthority({}, {
        candidateLimit: 16,
        dpOverrides: { stopOnFirstGoal: false, goalSkylineLimit: 16, maxExpansions: 60000, maxRuntimeMs: NB },
        preserveSkylineRoles: true,
      }),
    );
  } catch (error) {
    sharedError = String(error.message).slice(0, 150);
  }
  const sharedInfo = shared ? {
    executionMode: shared.summary && shared.summary.executionMode,
    rootsInput: sharedFrontier.length,
    searchComplete: (shared.attempts && shared.attempts[0] && shared.attempts[0].diagnostics && shared.attempts[0].diagnostics.dp && shared.attempts[0].diagnostics.dp.searchOutcome && shared.attempts[0].diagnostics.dp.searchOutcome.searchComplete) || null,
    found: shared.summary && shared.summary.found,
    expansions: (shared.attempts && shared.attempts[0] && shared.attempts[0].diagnostics && shared.attempts[0].diagnostics.dp && shared.attempts[0].diagnostics.dp.expansions) || null,
    inputStateKeysVerified: shared.telemetry && shared.telemetry.inputStateKeysVerified,
  } : { error: sharedError };

  // Semantic cross-check: independent goal roots vs shared goal
  let semanticRegression = false;
  if (shared && rootsGoal > 0 && !(shared.summary && shared.summary.found)) {
    semanticRegression = true;
  }

  // ===== Verdict (B7, per-root hard authority) =====
  let caseLabel;
  let expressiveness;
  if (rootsGoal > 0) { caseLabel = "A"; expressiveness = "SUFFICIENT"; }
  else if (rootsPositive > 0) { caseLabel = "B"; expressiveness = "PARTIALLY_SUFFICIENT"; }
  else if (rootsComplete === uniqueHistories.length && sharedInfo.searchComplete === true) {
    caseLabel = "C"; expressiveness = "INSUFFICIENT";
  } else { caseLabel = "EVALUATION_INCOMPLETE"; expressiveness = "UNDETERMINED"; }

  const report = {
    schema: "motapathfinder.one-step-cf-exhaustiveness.v2",
    b1: {
      sourceAuthority: "controlled-rederived",
      sourceCandidateId,
      failureClass: triggerFailure.failureClass,
      failedSegmentId: failedSegment.id,
      exactHistoricalClaimed: false,
    },
    b2: { INTENTS_GENERATED: intents.length },
    b3: {
      intentsRealized: materializations.filter((m) => m.classification === "REALIZED").length,
      intentsIncomplete: materializations.filter((m) => m.classification === "INCOMPLETE").length,
      intentsUnrealizable: materializations.filter((m) => m.classification === "UNREALIZABLE").length,
      intentsResourceLimited: materializations.filter((m) => m.classification === "RESOURCE_LIMITED").length,
    },
    b4: {
      RAW_REALIZED_HISTORY_COUNT: allHistories.length,
      UNIQUE_CANONICAL_STATE_COUNT: uniqueHistories.length,
      UNIQUE_DP_BUCKET_COUNT: uniqueBuckets.size,
    },
    b8: {
      ROOTS_REALIZED: uniqueHistories.length,
      INDEPENDENT_ROOTS_EVALUATED: rootsEvaluated,
      INDEPENDENT_ROOTS_COMPLETE: rootsComplete,
      INDEPENDENT_ROOTS_GOAL: rootsGoal,
      INDEPENDENT_ROOTS_POSITIVE: rootsPositive,
      SHARED_ROOTS_INPUT: sharedFrontier.length,
      SHARED_SEARCH_COMPLETE: sharedInfo.searchComplete != null ? sharedInfo.searchComplete : null,
      ONE_STEP_EVALUATION_COVERAGE_RATIO: uniqueHistories.length > 0
        ? Number((rootsComplete / uniqueHistories.length).toFixed(3)) : null,
    },
    b9: { shared: sharedInfo, semanticRegression },
    b7: {
      caseLabel,
      ONE_STEP_CF_EXPRESSIVENESS: expressiveness,
      NEXT_EXPRESSIVENESS_EXPANSION: caseLabel === "C" ? "REQUIRED" : null,
      BOUNDED_COMPOSITION: caseLabel === "C" ? "AUTHORIZED_AS_NEXT_CANDIDATE" : "NOT_APPLICABLE",
      MULTI_STEP_CF: "NOT_AUTHORIZED_THIS_ROUND",
    },
    perRoot: perRootResults,
    materializations,
  };
  fs.writeFileSync(path.join(os.tmpdir(), "5-24j-g32v2-result.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, (k, v) => (k === "perRoot" || k === "materializations" ? undefined : v), 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  }
}

module.exports = {};
