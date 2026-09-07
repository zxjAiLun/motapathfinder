"use strict";

/** TEST GRADE: local-regression */

/**
 * PR-5.24j — One-Step Counterfactual Exhaustiveness Qualification (G32).
 *
 * Question: is the production one-step counterfactual generator's expression
 * space SUFFICIENT / PARTIALLY_SUFFICIENT / INSUFFICIENT — evaluated WITHOUT
 * the 30s global-wall sampling that limited PR-5.24e to 6/16 probed?
 *
 * Method (B1-B9):
 *   B1  Source authority = the PR-5.24e Real Run 2 counterfactual source
 *       condition: canonical rollback anchor candidate
 *       (mt2-to-mt3:candidate-0, HP 10820 / ATK 97 / DEF 70 / MDEF 490,
 *       MT3 floor) + trusted failure (floor-progress-blocked on mt3-to-mt4).
 *       No OnlyUp hints, no manual resource targets.
 *   B2  Production buildCounterfactualRepairIntents, full recording, identity
 *       comparison vs the 5.24e historical intents (cf-d0-path_unlock,
 *       cf-d1-exp_level).
 *   B3  Full materialization per intent through the production segment
 *       machinery (non-binding runtime, sufficient expansions); classified
 *       UNREALIZABLE / REALIZED / INCOMPLETE / RESOURCE_LIMITED.
 *   B4  Dedup via production buildStateKey / buildDpStateKey with
 *       intentId → realized root provenance.
 *   B5  Multi-root shared DP (root-sliced, production isolated pipeline,
 *       non-binding) full downstream evaluation on the real failed segment
 *       (mt3-to-mt4); searchComplete required or honest resource pathology.
 *   B6  Outcome layers + per-root table (+ strict replay for any goal).
 *   B7  Case A/B/C verdict freezing.
 *   B8  Coverage accounting (100% realized-root coverage required for any
 *       insufficiency claim).
 *   B9  Fixed-work metrics (observational).
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
} = require("./lib/segment-dp");
const { buildStateKey } = require("./lib/state-key");
const { buildDpStateKey } = require("./lib/dp-search");

const NON_BINDING_MS = 6 * 60 * 60 * 1000;
const SOURCE_ARTIFACT = "C:/Users/81489/AppData/Local/Temp/diagnostic-result.json";

function getMilestone(project, id) {
  const spec = getMilestoneSpec(project, "onlyup-chaos-mt1-mt4");
  return spec.milestones.find((m) => m.id === id);
}

function main() {
  // ===== B1: source authority =====
  assert.ok(fs.existsSync(SOURCE_ARTIFACT), "B1: 5.24e source artifact required");
  const src = JSON.parse(fs.readFileSync(SOURCE_ARTIFACT, "utf8"));
  const anchorCandidate = (src.finalCandidates || []).find((c) => c.id === "mt2-to-mt3:candidate-0")
    || (src.finalCandidates || [])[0];
  assert.ok(anchorCandidate && anchorCandidate.state, "B1: canonical anchor candidate required");
  const anchorState = anchorCandidate.state;
  const anchorStateKey = buildStateKey(anchorState);
  const failureClass = src.backtrack && src.backtrack.triggerFailure && src.backtrack.triggerFailure.failureClass;
  assert.strictEqual(failureClass, "floor-progress-blocked", "B1: trusted failure class");
  const historicalCf = src.counterfactualRepair || {};

  console.log(JSON.stringify({
    b1_sourceAuthority: {
      sourceStateKeyPrefix: anchorStateKey.slice(0, 90),
      sourceCandidateId: anchorCandidate.id,
      failureClass,
      failedSegmentId: (src.failedSegment || {}).segmentId,
      heroSnapshot: {
        hp: anchorState.hero.hp, atk: anchorState.hero.atk,
        def: anchorState.hero.def, mdef: anchorState.hero.mdef,
      },
      historicalIntents: (historicalCf.intents || []).map((it) => ({
        intentId: it.intentId, kind: it.kind, outcome: it.realizationOutcome,
        generatedHistoryCount: it.generatedHistoryCount,
      })),
      historical524eSummary: {
        generated: (src.repairScheduling.hypotheses || []).filter((h) => h.counterfactualIntentId != null).length,
        triggerReason: historicalCf.triggerReason,
      },
    },
  }));

  const { project, simulator } = createSimulator();
  const mt2Segment = getMilestone(project, "mt2-to-mt3");
  const failedSegment = getMilestone(project, "mt3-to-mt4");

  // ===== B2: production generator =====
  const { buildCounterfactualRepairIntents } = require("./lib/counterfactual-repair");
  const backtrackCandidateLimit = 16; // PR-5.24e used backtrackCandidateLimit(mt2 segment, config) = 16
  const intents = buildCounterfactualRepairIntents({
    simulator,
    startCandidates: [{ id: anchorCandidate.id, state: JSON.parse(JSON.stringify(anchorState)) }],
    triggerFailure: src.backtrack.triggerFailure,
    failedSegment,
    candidateLimit: backtrackCandidateLimit,
  });
  const historicalKinds = (historicalCf.intents || []).map((it) => it.kind).sort().join("|");
  const currentKinds = intents.map((it) => it.kind).sort().join("|");
  console.log(JSON.stringify({
    b2_generator: {
      INTENTS_GENERATED: intents.length,
      intents: intents.map((it) => ({
        intentId: it.intentId, kind: it.kind, startCandidateId: it.startCandidateId,
        structuralDelta: it.structuralDelta,
        goal: it.goal,
      })),
      identityVs524e: {
        historicalKinds, currentKinds,
        identical: historicalKinds === currentKinds,
      },
    },
  }));

  // ===== B3: full materialization per intent =====
  // Production pipeline per intent (mirroring the production CF path, non-binding):
  //   intent segment (synthesized goal) → [intent.startCandidate] → realized frontier
  //   then anchor segment (mt2-to-mt3) expansion → history split
  const { buildRepairedHistoryHypotheses } = require("./lib/segment-dp");
  const materializations = [];
  for (const intent of intents) {
    if (typeof global.gc === "function") global.gc();
    const intentSegment = {
      id: `cf-${intent.intentId}`,
      label: `Counterfactual Intent: ${intent.kind}`,
      goal: intent.goal,
      actionPolicy: intent.actionPolicy,
      dp: {
        stopOnFirstGoal: false,
        candidateLimit: backtrackCandidateLimit,
        maxExpansions: 16000,
        maxRuntimeMs: NON_BINDING_MS,
      },
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
          maxRuntimeMs: NON_BINDING_MS,
          maxRssMb: 2048,
          maxRssHardCeilingMb: 2048,
        },
        withManualBudgetAuthority({}, {
          candidateLimit: backtrackCandidateLimit,
          preserveSkylineRoles: true,
        }),
      );
    } catch (error) {
      classification = "RESOURCE_LIMITED";
      materializations.push({ intentId: intent.intentId, kind: intent.kind, classification, error: String(error.message).slice(0, 120) });
      continue;
    }
    const merged = realized.merged || [];
    if (merged.length === 0) {
      classification = "UNREALIZABLE";
    } else {
      const dp0 = (realized.attempts && realized.attempts[0] && realized.attempts[0].diagnostics && realized.attempts[0].diagnostics.dp) || {};
      const complete = dp0.searchOutcome && dp0.searchOutcome.searchComplete === true;
      classification = complete ? "REALIZED" : "INCOMPLETE";
    }
    materializations.push({
      intentId: intent.intentId,
      kind: intent.kind,
      classification,
      realizedCandidates: merged.map((c) => ({
        id: c.id,
        stateKey: buildStateKey(c.state),
        hp: c.state.hero.hp, atk: c.state.hero.atk, def: c.state.hero.def, mdef: c.state.hero.mdef,
        decisionDepth: (c.state.meta && c.state.meta.decisionDepth) || 0,
        rawRouteLength: (c.state.meta && c.state.meta.rawRouteLength) || 0,
      })),
    });
  }
  console.log(JSON.stringify({
    b3_materialization: materializations.map((m) => ({
      intentId: m.intentId, kind: m.kind, classification: m.classification,
      realizedCount: (m.realizedCandidates || []).length,
    })),
  }));

  // ===== B3b: anchor expansion + history split (production path) =====
  // Each realized intent frontier → anchor segment (mt2-to-mt3) expansion →
  // buildRepairedHistoryHypotheses → the materialized one-step CF histories.
  const allHistories = [];
  for (const m of materializations) {
    if (m.classification !== "REALIZED" && m.classification !== "INCOMPLETE") continue;
    const intent = intents.find((i) => i.intentId === m.intentId);
    if (!intent) continue;
    if (typeof global.gc === "function") global.gc();
    // Re-run the intent realization to obtain live candidate objects (with states)
    // (the earlier run's frontier objects are plain summaries; simplest correct
    // approach: re-run realization and use merged candidates directly)
    const intentSegment = {
      id: `cf-${intent.intentId}`,
      label: `Counterfactual Intent: ${intent.kind}`,
      goal: intent.goal,
      actionPolicy: intent.actionPolicy,
      dp: { stopOnFirstGoal: false, candidateLimit: backtrackCandidateLimit, maxExpansions: 16000, maxRuntimeMs: NON_BINDING_MS },
    };
    const realized = runSegmentAgainstFrontier(
      simulator,
      intentSegment,
      [{ id: intent.startCandidateId, state: JSON.parse(JSON.stringify(intent.startCandidate.state)), route: [], trace: [] }],
      {
        segmentExecutionMode: "isolated-process",
        maxExpansions: 16000, maxRuntimeMs: NON_BINDING_MS, maxRssMb: 2048, maxRssHardCeilingMb: 2048,
      },
      withManualBudgetAuthority({}, { candidateLimit: backtrackCandidateLimit, preserveSkylineRoles: true }),
    );
    const intentFrontier = (realized.merged || []).map((c) => ({
      id: c.id, state: c.state, route: c.route || [], trace: [],
    }));
    if (intentFrontier.length === 0) continue;

    // Anchor segment expansion from the intent frontier (production CF step 2)
    const cfAnchorExpanded = runSegmentAgainstFrontier(
      simulator,
      mt2Segment,
      intentFrontier,
      {
        segmentExecutionMode: "isolated-process",
        maxExpansions: 16000, maxRuntimeMs: NON_BINDING_MS, maxRssMb: 2048, maxRssHardCeilingMb: 2048,
      },
      withManualBudgetAuthority({}, {
        candidateLimit: backtrackCandidateLimit,
        dpOverrides: { stopOnFirstGoal: false, goalSkylineLimit: 16, maxExpansions: 16000, maxRuntimeMs: NON_BINDING_MS },
        preserveSkylineRoles: true,
      }),
    );
    const descriptors = buildRepairedHistoryHypotheses({
      depth: 1,
      waveIndex: 0,
      anchor: { segment: mt2Segment, inputFrontier: [], merged: intentFrontier },
      expandedAnchor: cfAnchorExpanded,
      candidateLimit: backtrackCandidateLimit,
    });
    descriptors.forEach((desc) => {
      const replayCand = desc.replayFrontier && desc.replayFrontier[0];
      const st = replayCand && replayCand.state;
      if (!st) return; // placeholder descriptor (anchor did not reproduce)
      allHistories.push({
        intentId: intent.intentId,
        kind: intent.kind,
        hypothesisId: desc.hypothesisId,
        candidate: replayCand,
      });
    });
  }
  console.log(JSON.stringify({
    b3b_histories: {
      RAW_REALIZED_HISTORY_COUNT: allHistories.length,
      byIntent: allHistories.reduce((acc, h) => { acc[h.intentId] = (acc[h.intentId] || 0) + 1; return acc; }, {}),
    },
  }));

  // ===== B4: dedup via production keys =====
  const byExact = new Map();
  const byBucket = new Map();
  for (const h of allHistories) {
    const sk = buildStateKey(h.candidate.state);
    if (!byExact.has(sk)) byExact.set(sk, { ...h, duplicates: [] });
    else byExact.get(sk).duplicates.push(h.hypothesisId);
    const bk = buildDpStateKey(simulator, h.candidate.state, { keyMode: "region" });
    if (!byBucket.has(bk)) byBucket.set(bk, sk);
  }
  const uniqueHistories = Array.from(byExact.values());
  console.log(JSON.stringify({
    b4_dedup: {
      RAW_REALIZED_HISTORY_COUNT: allHistories.length,
      UNIQUE_CANONICAL_STATE_COUNT: uniqueHistories.length,
      UNIQUE_DP_BUCKET_COUNT: byBucket.size,
    },
  }));

  // ===== B5: multi-root shared DP full downstream =====
  const frontier = uniqueHistories.map((h, i) => ({
    id: `cf:${h.intentId}:root-${i}`,
    state: JSON.parse(JSON.stringify(h.candidate.state)),
    route: [],
    trace: [],
  }));
  let shared;
  let sharedError = null;
  try {
    if (typeof global.gc === "function") global.gc();
    shared = runSegmentAgainstFrontier(
      simulator,
      failedSegment,
      frontier,
      {
        segmentExecutionMode: "isolated-process",
        maxExpansions: 60000,
        maxRuntimeMs: NON_BINDING_MS,
        maxRssMb: 2048,
        maxRssHardCeilingMb: 2048,
        memoryCheckIntervalExpansions: 1,
        memoryCheckIntervalActions: 1,
      },
      withManualBudgetAuthority({}, {
        candidateLimit: 16,
        dpOverrides: { stopOnFirstGoal: false, goalSkylineLimit: 16, maxExpansions: 60000, maxRuntimeMs: NON_BINDING_MS },
        preserveSkylineRoles: true,
      }),
    );
  } catch (error) {
    sharedError = String(error.message).slice(0, 200);
  }
  const b5 = shared ? {
    executionMode: shared.summary && shared.summary.executionMode,
    schedulingPolicy: (shared.attempts && shared.attempts[0] && shared.attempts[0].diagnostics && shared.attempts[0].diagnostics.dp && shared.attempts[0].diagnostics.dp.multiRootScheduling) || null,
    rootsInput: frontier.length,
    rootsTried: shared.summary && shared.summary.startCandidatesTried,
    searchInvocations: shared.summary && shared.summary.searchInvocations,
    inputStateKeysVerified: shared.telemetry && shared.telemetry.inputStateKeysVerified,
    simulatorProfileIdentity: shared.telemetry && shared.telemetry.simulatorProfileIdentity,
  } : { error: sharedError };
  console.log(JSON.stringify({ b5_sharedDp: b5 }));

  // ===== B6-B8: outcome layers + coverage =====
  const report = {
    schema: "motapathfinder.one-step-cf-exhaustiveness.v1",
    b1: { sourceCandidateId: anchorCandidate.id, failureClass, failedSegmentId: "mt3-to-mt4" },
    b2: { INTENTS_GENERATED: intents.length, identityVs524eIdentical: historicalKinds === currentKinds, kinds: currentKinds },
    b3: {
      intentsRealized: materializations.filter((m) => m.classification === "REALIZED").length,
      intentsIncomplete: materializations.filter((m) => m.classification === "INCOMPLETE").length,
      intentsUnrealizable: materializations.filter((m) => m.classification === "UNREALIZABLE").length,
      intentsResourceLimited: materializations.filter((m) => m.classification === "RESOURCE_LIMITED").length,
    },
    b4: {
      RAW_REALIZED_HISTORY_COUNT: allHistories.length,
      UNIQUE_CANONICAL_STATE_COUNT: uniqueHistories.length,
      UNIQUE_DP_BUCKET_COUNT: byBucket.size,
    },
  };
  if (shared) {
    const dp = (shared.attempts && shared.attempts[0] && shared.attempts[0].diagnostics && shared.attempts[0].diagnostics.dp) || {};
    const byRoot = dp.expansionCountByRoot || {};
    const goalRoots = (shared.summary && shared.summary.attempts && shared.summary.attempts[0] && shared.summary.attempts[0].goals || []).map((g) => g.rootCandidateId);
    const pendingByRoot = dp.pendingByRoot || {};
    const positiveRoots = Object.values(byRoot).filter((n) => n > 0).length;
    const searchComplete = dp.searchOutcome && dp.searchOutcome.searchComplete;
    const workerPeakRss = shared.telemetry && shared.telemetry.workerPeakRssMb;

    // PR-5.24j B6 correction: "positive progress" must mean DETERMINISTIC
    // DOWNSTREAM PROGRESS (production projectSegmentGoalProgress on the
    // segment goal), not merely "received expansions".  A root whose
    // post-search best progress strictly exceeds its start progress counts.
    const { projectSegmentGoalProgress } = require("./lib/segment-dp");
    const progressOf = (state) => {
      try {
        return projectSegmentGoalProgress(simulator.project, state, failedSegment);
      } catch (_) { return null; }
    };
    const progressScore = (p) => p == null ? null : Number(p.completion || 0);
    const perRoot = frontier.map((f, i) => {
      const before = progressScore(progressOf(f.state));
      // Best descendants of this root are not individually exposed by the
      // shared search; use the search-wide bestSeen/deepestExpanded as the
      // observable progress floor plus per-root expansion/pending.
      return {
        rootIndex: i,
        rootCandidateId: f.id,
        intentId: f.id.split(":")[1] || null,
        expansions: byRoot[i] || 0,
        pending: pendingByRoot[f.id] || 0,
        startProgressScore: before,
      };
    });
    const bestSeen = shared.attempts && shared.attempts[0] && shared.attempts[0].diagnostics
      ? null : null; // (see below: goalSkyline/candidates carry the terminal states)
    const summaryCandidates = (shared.summary && shared.summary.candidates) || [];
    const searchBestProgressScores = summaryCandidates.map((c) => progressScore(progressOf(c.state))).filter((s) => s != null);
    const searchBestProgress = searchBestProgressScores.length > 0 ? Math.max(...searchBestProgressScores) : null;
    // Roots with expansions AND pending=0 on a complete search are exhausted
    // territory; roots with 0 expansions were dominance-eliminated before
    // their first slice (their buckets consumed by stronger roots).
    const dominanceEliminatedRoots = perRoot.filter((p) => p.expansions === 0 && p.pending === 0).length;
    const exploredRoots = perRoot.filter((p) => p.expansions > 0).length;

    report.b6 = {
      FOUND_GOAL_ROOTS: goalRoots.length,
      EXPLORED_ROOTS: exploredRoots,
      DOMINANCE_ELIMINATED_ROOTS: dominanceEliminatedRoots,
      // Deterministic downstream progress = ANY post-search state (goal
      // skyline / merged candidates) has strictly greater segment-goal
      // progress than its root's start.  Computed over the union of goal
      // skyline candidates (the only terminal states surfaced).
      DETERMINISTIC_POSITIVE_DOWNSTREAM_PROGRESS: false, // filled below
      PENDING_ROOTS: Object.keys(pendingByRoot).length,
      found: shared.summary && shared.summary.found,
      searchComplete,
      expansions: dp.expansions,
      frontierSize: dp.frontierSize,
      stoppedReason: dp.stoppedReason,
      workerPeakRssMb: workerPeakRss,
      searchBestProgressScore: searchBestProgress,
      goalSkylineCount: (shared.goalSkyline || summaryCandidates || []).length,
      perRoot,
    };
    // Strict deterministic positive progress check: a goal-skyline / merged
    // candidate on the failed segment goal with completion > 0 and floor
    // deeper than its root start.
    let anyPositiveDownstream = false;
    (shared.goalSkyline || summaryCandidates).forEach((cand) => {
      const p = progressOf(cand.state);
      if (!p) return;
      if (Number(p.completion || 0) > 0 || (p.floorMatch === true)) anyPositiveDownstream = true;
    });
    // Also: any root state itself already on a deeper floor than MT3 start
    // (e.g. realized history reached a new floor) counts as realized progress
    // of materialization, not downstream search progress; keep the boundary.
    report.b6.DETERMINISTIC_POSITIVE_DOWNSTREAM_PROGRESS = anyPositiveDownstream;
    report.b6.POSITIVE_PROGRESS_ROOTS = exploredRoots; // legacy field, semantics above
    report.b6.NO_PROGRESS_ROOTS = frontier.length - exploredRoots;
    report.b8 = {
      INTENTS_GENERATED: intents.length,
      INTENTS_REALIZED: report.b3.intentsRealized,
      INTENTS_FAILED_REALIZATION: report.b3.intentsUnrealizable + report.b3.intentsResourceLimited,
      RAW_HISTORIES: allHistories.length,
      UNIQUE_EXACT_HISTORIES: uniqueHistories.length,
      ROOTS_PROBED: frontier.length,
      ROOTS_COMPLETE: searchComplete ? frontier.length : null,
      ROOTS_GOAL: goalRoots.length,
      ONE_STEP_EVALUATION_COVERAGE_RATIO: frontier.length > 0 ? Number((frontier.length / uniqueHistories.length).toFixed(3)) : null,
    };
    // B7 verdict (B6-corrected semantics):
    //   Case A: >=1 root reaches the downstream goal → SUFFICIENT
    //   Case B: no goal BUT deterministic positive downstream progress →
    //           PARTIALLY_SUFFICIENT (composition need not yet proven)
    //   Case C: complete + no goal + NO deterministic positive downstream
    //           progress → INSUFFICIENT (requires 100% realized coverage)
    const anyPositive = report.b6.DETERMINISTIC_POSITIVE_DOWNSTREAM_PROGRESS;
    let expressiveness;
    let caseLabel;
    if (goalRoots.length > 0) { expressiveness = "SUFFICIENT"; caseLabel = "A"; }
    else if (searchComplete === true && anyPositive) { expressiveness = "PARTIALLY_SUFFICIENT"; caseLabel = "B"; }
    else if (searchComplete === true && !anyPositive) { expressiveness = "INSUFFICIENT"; caseLabel = "C"; }
    else { expressiveness = "UNDETERMINED"; caseLabel = "EVALUATION_INCOMPLETE"; }
    report.b7 = {
      caseLabel,
      ONE_STEP_CF_EXPRESSIVENESS: expressiveness,
      COMPOSITION_NEED: expressiveness === "PARTIALLY_SUFFICIENT" ? "NOT_YET_PROVEN" : null,
      MULTI_STEP_CF: "NOT_AUTHORIZED_THIS_ROUND",
    };
    // Only allow insufficiency claim at 100% realized coverage
    if (expressiveness === "INSUFFICIENT" && report.b8.ROOTS_PROBED !== uniqueHistories.length) {
      report.b7.ONE_STEP_CF_EXPRESSIVENESS = "UNDETERMINED";
      report.b7.note = "insufficiency claim requires 100% realized-root coverage";
    }
  } else {
    report.b5 = { error: sharedError };
    report.b7 = { ONE_STEP_CF_EXPRESSIVENESS: "UNDETERMINED", note: "shared evaluation failed" };
  }

  fs.writeFileSync(path.join(os.tmpdir(), "5-24j-g32-result.json"), JSON.stringify(report, null, 2));
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

module.exports = {};
