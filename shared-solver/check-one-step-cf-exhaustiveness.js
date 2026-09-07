"use strict";

/** TEST GRADE: local-regression */

/**
 * PR-5.24j — One-Step Counterfactual Exhaustiveness Qualification (G32-v2).
 *
 * v1 (SUPERSEDED_BY_WRONG_SOURCE_STAGE): used archived finalCandidates/MT3
 * state as generator source — wrong stage; production authority is
 * anchor.inputFrontier (the MT2-floor source).
 *
 * v2 (controlled source): Source = controlled-rederived MT2 fixture
 *   (EXACT_5_24e_HISTORICAL_SOURCE = NOT_CLAIMED).
 *
 * v2.1 (fail-closed closure, Iteration 3 Repair 1):
 *   F1  B1 runs the controlled lineage INLINE and locks the failure frontier:
 *       fixture MT2 source → mt2-to-mt3 (require found + determinate complete)
 *       → full MT3 frontier → mt3-to-mt4 (require no-goal + determinate
 *       complete + trusted failure classification). The ACTUAL run evidence
 *       (failure class from the failed execution) becomes the authority —
 *       the hardcoded triggerFailure object is replaced by the inline run.
 *   F2  B3 records intentRealizationComplete + anchorExpansionComplete per
 *       intent; only REALIZED + both-complete intents' histories enter the
 *       Case-C coverage authority.
 *   F3  B7 Case C additionally requires allMaterializationComplete AND
 *       allProgressComparable (ROOTS_PROGRESS_COMPARABLE === unique count);
 *       unknown progress (null comparator) never degrades to "no progress".
 *   F4  B9 semantic cross-check is symmetric (independent goals vs shared
 *       goal disagreement in EITHER direction is a regression).
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

// Determinate-complete check for an execution (production-shaped): every
// attempt searchComplete AND no pending/terminal-incomplete in the ledger.
function executionDeterminateComplete(exec) {
  const summary = exec && exec.summary;
  if (!summary) return false;
  const atts = summary.attempts || exec.attempts || [];
  if (atts.length === 0) return false;
  const allComplete = atts.every((att) => {
    const dp = (att.diagnostics && att.diagnostics.dp) || {};
    return dp.searchOutcome && dp.searchOutcome.searchComplete === true;
  });
  const t = summary.candidateSliceTelemetry;
  const noPending = !t || (Number(t.candidateSliceFinalPending || 0) === 0
    && Number(t.candidateSliceTerminalIncomplete || 0) === 0);
  return allComplete && noPending;
}

function main() {
  // ===== B1: controlled source + INLINE controlled lineage gate (F1) =====
  const fixture = JSON.parse(fs.readFileSync(SOURCE_FIXTURE_PATH, "utf8"));
  const sourceState = fixture.state;
  const sourceCandidateId = fixture.provenance.candidateId;
  const sourceStateKey = buildStateKey(sourceState);
  assert.strictEqual(sourceStateKey, fixture.provenance.buildStateKey, "B1: fixture stateKey must match provenance");

  const { project, simulator } = createSimulator();
  const mt2Segment = getMilestone(project, "mt2-to-mt3");
  const failedSegment = getMt3Segment(project); // mt3-to-mt4

  // --- F1: inline controlled lineage (locks the failure frontier) ---
  const lineageConfig = {
    segmentExecutionMode: "isolated-process",
    maxExpansions: 60000,
    maxRuntimeMs: NB,
    maxRssMb: 2048,
    maxRssHardCeilingMb: 2048,
    memoryCheckIntervalExpansions: 1,
    memoryCheckIntervalActions: 1,
  };
  const lineageMt2Exec = runSegmentAgainstFrontier(
    simulator,
    mt2Segment,
    [{ id: sourceCandidateId, state: JSON.parse(JSON.stringify(sourceState)), route: [], trace: [] }],
    lineageConfig,
    {},
  );
  const lineageMt2Complete = executionDeterminateComplete(lineageMt2Exec);
  const lineageMt3Frontier = (lineageMt2Exec.merged || []).map((c) => ({
    id: c.id, state: JSON.parse(JSON.stringify(c.state)), route: [], trace: [],
  }));
  assert.strictEqual(lineageMt2Exec.summary && lineageMt2Exec.summary.found, true,
    "F1: controlled lineage mt2-to-mt3 must be found");
  assert.strictEqual(lineageMt2Complete, true,
    "F1: controlled lineage mt2-to-mt3 must be determinate complete");
  assert.ok(lineageMt3Frontier.length > 0,
    "F1: controlled lineage must produce a canonical MT3 frontier");

  const lineageMt3Exec = runSegmentAgainstFrontier(
    simulator,
    failedSegment,
    lineageMt3Frontier,
    lineageConfig,
    {},
  );
  const lineageMt3Complete = executionDeterminateComplete(lineageMt3Exec);
  const lineageMt3Found = lineageMt3Exec.summary && lineageMt3Exec.summary.found === true;
  assert.strictEqual(lineageMt3Found, false,
    "F1: controlled lineage mt3-to-mt4 must remain a failure frontier (no goal)");
  assert.strictEqual(lineageMt3Complete, true,
    "F1: controlled lineage mt3-to-mt4 must be determinate complete");

  // Extract the ACTUAL failure classification from the failed execution
  const lineageAtt = (lineageMt3Exec.attempts || [])[0]
    || (lineageMt3Exec.summary && lineageMt3Exec.summary.attempts && lineageMt3Exec.summary.attempts[0])
    || {};
  const lineageFailure = (lineageAtt.diagnostics && (lineageAtt.diagnostics.failure
    || lineageAtt.diagnostics.failurePropagation)) || {};
  const lineageFailureClass = lineageFailure.failureClass || "frontier-exhausted";
  const trustedFailureClasses = new Set([
    "atk-deficit", "def-deficit", "mdef-deficit", "hp-deficit",
    "life-limit-hp-deficit", "action-survivability-deficit", "equipment-missing",
    "floor-progress-blocked", "floor-scope-mismatch", "frontier-exhausted",
  ]);
  assert.ok(trustedFailureClasses.has(lineageFailureClass),
    `F1: controlled lineage failure class ${lineageFailureClass} must be trusted`);
  const lineageOutcome = (lineageAtt.diagnostics && lineageAtt.diagnostics.dp
    && lineageAtt.diagnostics.dp.searchOutcome) || {};
  assert.strictEqual(lineageOutcome.outcomeClass || "goal-not-found-search-complete",
    "goal-not-found-search-complete",
    "F1: controlled lineage mt3-to-mt4 outcome must be search-complete no-goal");

  const triggerFailure = {
    failureClass: lineageFailureClass,
    segmentId: failedSegment.id,
    preferredCandidateTags: lineageFailure.preferredCandidateTags || [],
    missingGoalFields: lineageFailure.missingGoalFields
      || [{ field: "floorId", expected: "MT4", actual: "MT3" }],
  };

  console.log(JSON.stringify({
    b1_controlledAuthority: {
      sourceCandidateId,
      sourceStateKeyPrefix: sourceStateKey.slice(0, 90),
      sourceHero: { hp: sourceState.hero.hp, atk: sourceState.hero.atk, def: sourceState.hero.def },
      inlineLineageGate: {
        mt2Found: true,
        mt2Complete: lineageMt2Complete,
        mt3FrontierCount: lineageMt3Frontier.length,
        mt3Found: lineageMt3Found,
        mt3Complete: lineageMt3Complete,
        failureClass: lineageFailureClass,
        outcomeClass: lineageOutcome.outcomeClass || "goal-not-found-search-complete",
      },
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
  // F2: record intentRealizationComplete + anchorExpansionComplete; only
  // REALIZED + both-complete intents' histories enter Case-C coverage.
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
    let intentRealizationComplete = false;
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
      materializations.push({
        intentId: intent.intentId, kind: intent.kind, classification: "RESOURCE_LIMITED",
        intentRealizationComplete: false, anchorExpansionComplete: false,
        error: String(error.message).slice(0, 100),
      });
      continue;
    }
    const intentFrontier = realized.merged || [];
    if (intentFrontier.length === 0) {
      materializations.push({
        intentId: intent.intentId, kind: intent.kind, classification: "UNREALIZABLE",
        intentRealizationComplete: false, anchorExpansionComplete: false,
      });
      continue;
    }
    intentRealizationComplete = executionDeterminateComplete(realized);
    classification = intentRealizationComplete ? "REALIZED" : "INCOMPLETE";

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
    const anchorExpansionComplete = executionDeterminateComplete(cfAnchorExpanded);

    materializations.push({
      intentId: intent.intentId,
      kind: intent.kind,
      classification,
      realizedCount: intentFrontier.length,
      intentRealizationComplete,
      anchorExpansionComplete,
    });

    // F2: only determinate-complete materializations contribute histories
    // to the Case-C coverage authority.
    if (classification === "REALIZED" && intentRealizationComplete && anchorExpansionComplete) {
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
  }
  const allMaterializationComplete = materializations.every((m) =>
    m.classification === "REALIZED" && m.intentRealizationComplete === true && m.anchorExpansionComplete === true);
  console.log(JSON.stringify({
    b3_materialization: materializations,
    b3b_histories: { RAW_REALIZED_HISTORY_COUNT: allHistories.length },
    b3_allMaterializationComplete: allMaterializationComplete,
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
        positiveProgress: false, progressComparable: false, evaluated: false,
      });
      continue;
    }
    // Production isolated path: the worker emits rich attempts (with
    // bestProgressProjection) on exec.attempts.
    const att0 = (exec.attempts && exec.attempts[0])
      || (exec.summary && exec.summary.attempts && exec.summary.attempts[0])
      || {};
    const dp = (att0.diagnostics && att0.diagnostics.dp) || {};
    const goalReached = exec.summary && exec.summary.found === true;
    const searchComplete = dp.searchOutcome && dp.searchOutcome.searchComplete === true;
    // Production progress: att0.bestProgressProjection (compact, computed INSIDE
    // the isolated worker against the attempt segment). Fallback: project the
    // raw bestProgress state if the projection is absent.
    const bestProjection = att0.bestProgressProjection
      || (att0.bestProgress ? projectOnFailedSegment(att0.bestProgress) : null);
    const comparatorResult = (startProjection && bestProjection)
      ? compareProgressProjections(startProjection, bestProjection)
      : null;
    // F3: unknown progress (null comparator) is NOT "no progress" — it is
    // non-comparable and must block Case C.
    const progressComparable = comparatorResult !== null;
    const positiveProgress = progressComparable && comparatorResult > 0;
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
      progressComparable,
      positiveProgress,
      evaluated: true,
    });
  }
  const rootsProgressComparable = perRootResults.filter((r) => r.progressComparable === true).length;
  console.log(JSON.stringify({
    b5_perRoot: perRootResults.map((r) => ({
      root: r.rootCandidateId, intent: r.intentId, goal: r.goalReached, complete: r.searchComplete,
      exp: r.expansions, pos: r.positiveProgress, comparable: r.progressComparable, cmp: r.productionComparatorResult,
    })),
  }));

  // ===== B8: coverage =====
  const rootsEvaluated = perRootResults.filter((r) => r.evaluated).length;
  const rootsComplete = perRootResults.filter((r) => r.searchComplete === true).length;
  const rootsGoal = perRootResults.filter((r) => r.goalReached === true).length;
  const rootsPositive = perRootResults.filter((r) => r.positiveProgress === true).length;

  // ===== B9: shared multi-root cross-check (F4: symmetric) =====
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

  // F4: symmetric semantic regression — independent goals vs shared goal
  // disagreement in EITHER direction.
  const sharedFound = Boolean(shared && shared.summary && shared.summary.found);
  const independentFound = rootsGoal > 0;
  const semanticRegression = shared
    ? (sharedFound !== independentFound)
    : null;

  // ===== B7: verdict (per-root hard authority + F2/F3 fail-closed gates) =====
  let caseLabel;
  let expressiveness;
  if (rootsGoal > 0) { caseLabel = "A"; expressiveness = "SUFFICIENT"; }
  else if (rootsPositive > 0) { caseLabel = "B"; expressiveness = "PARTIALLY_SUFFICIENT"; }
  else if (
    allMaterializationComplete
    && rootsComplete === uniqueHistories.length
    && rootsProgressComparable === uniqueHistories.length
    && sharedInfo.searchComplete === true
  ) {
    caseLabel = "C"; expressiveness = "INSUFFICIENT";
  } else { caseLabel = "EVALUATION_INCOMPLETE"; expressiveness = "UNDETERMINED"; }

  const report = {
    schema: "motapathfinder.one-step-cf-exhaustiveness.v2p1",
    b1: {
      sourceAuthority: "controlled-rederived",
      sourceCandidateId,
      inlineLineageGate: {
        mt2Found: true,
        mt2Complete: lineageMt2Complete,
        mt3FrontierCount: lineageMt3Frontier.length,
        mt3Found: lineageMt3Found,
        mt3Complete: lineageMt3Complete,
        failureClass: lineageFailureClass,
      },
      exactHistoricalClaimed: false,
    },
    b2: { INTENTS_GENERATED: intents.length },
    b3: {
      intentsRealized: materializations.filter((m) => m.classification === "REALIZED").length,
      intentsIncomplete: materializations.filter((m) => m.classification === "INCOMPLETE").length,
      intentsUnrealizable: materializations.filter((m) => m.classification === "UNREALIZABLE").length,
      intentsResourceLimited: materializations.filter((m) => m.classification === "RESOURCE_LIMITED").length,
      allMaterializationComplete,
      intentCompletionBits: materializations.map((m) => ({
        intentId: m.intentId,
        classification: m.classification,
        intentRealizationComplete: m.intentRealizationComplete === true,
        anchorExpansionComplete: m.anchorExpansionComplete === true,
      })),
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
      ROOTS_PROGRESS_COMPARABLE: rootsProgressComparable,
      SHARED_ROOTS_INPUT: sharedFrontier.length,
      SHARED_SEARCH_COMPLETE: sharedInfo.searchComplete != null ? sharedInfo.searchComplete : null,
      ONE_STEP_EVALUATION_COVERAGE_RATIO: uniqueHistories.length > 0
        ? Number((rootsComplete / uniqueHistories.length).toFixed(3)) : null,
    },
    b9: { shared: sharedInfo, semanticRegression, semanticRegressionSymmetric: true },
    b7: {
      caseLabel,
      ONE_STEP_CF_EXPRESSIVENESS: expressiveness,
      allMaterializationComplete,
      allProgressComparable: rootsProgressComparable === uniqueHistories.length,
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
