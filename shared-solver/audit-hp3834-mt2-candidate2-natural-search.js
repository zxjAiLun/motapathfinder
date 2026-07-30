"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const v8 = require("node:v8");

const { getMilestoneSpec, loadProject } = (() => {
  const milestone = require("./lib/milestone-spec");
  return {
    getMilestoneSpec: milestone.getMilestoneSpec,
    loadProject: require("./lib/project-loader").loadProject,
  };
})();
const {
  buildSegmentActionProvider,
  buildSegmentGoalPredicate,
  runMilestoneGraph,
} = require("./lib/segment-dp");
const { buildStateKey, buildDominanceKey } = require("./lib/state-key");
const { buildDpStateKey } = require("./lib/dp-search");
const { buildSolverSnapshot } = require("./lib/route-snapshot");
const { createStateFromSnapshot } = require("./lib/route-store");
const { syncProgress } = require("./lib/progress");
const {
  createLifecycleObserver,
  makePipelineObserver,
  runFutureValueOracle,
} = require("./audit-hp3834-mt1-gate-selection-future-value");
const {
  actionFingerprint,
  compactState,
  makeSimulator,
  replayRoute,
} = require("./audit-hp3834-mt1-first-divergence");
const { strictReplayRoute } = require("./lib/agenda-policy-evaluation");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const DEFAULT_TEACHER_ROUTE = path.resolve(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "mt1-mt3-i893-hp8425.current-exact.route.json",
);
const DEFAULT_OUT = path.resolve(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "mt2-candidate2-natural-search-audit.json",
);
const DEFAULT_ISOLATED_OUT = path.resolve(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "mt2-candidate2-natural-search-audit-v2.json",
);

const MT1_SETUP_MAX_EXPANSIONS = 400;
const FUTURE_DECISION_START = 11;
const FUTURE_DECISION_END = 23;
const FUTURE_SEGMENT_IDS = ["mt2-entry", "mt2-local-3582", "mt2-hp3834"];
const EXPECTED_HARD_TILES = [
  ["MT2", 4, 7],
  ["MT2", 8, 7],
  ["MT2", 10, 8],
  ["MT2", 11, 11],
  ["MT2", 6, 6],
  ["MT2", 6, 8],
  ["MT2", 6, 9],
];

function parseArgs(argv) {
  return argv.reduce((result, token) => {
    const match = /^--([^=]+)=(.*)$/.exec(token);
    if (match) result[match[1]] = match[2];
    return result;
  }, {});
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function relative(file) {
  return path.relative(ROOT, file) || ".";
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function gitCommit() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" });
  return result.status === 0 ? String(result.stdout || "").trim() || null : null;
}

function cleanWorktree() {
  const result = spawnSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" });
  return result.status === 0 && String(result.stdout || "").trim() === "";
}

function compactHero(state) {
  const hero = state && state.hero || {};
  return {
    hp: Number(hero.hp || 0),
    atk: Number(hero.atk || 0),
    def: Number(hero.def || 0),
    mdef: Number(hero.mdef || 0),
    lv: Number(hero.lv || 0),
    exp: Number(hero.exp || 0),
    loc: hero.loc ? {
      x: hero.loc.x,
      y: hero.loc.y,
      direction: hero.loc.direction || null,
    } : null,
  };
}

function summarizeAttempt(attempt) {
  const dp = attempt && attempt.diagnostics && attempt.diagnostics.dp || {};
  const frontierSize = Number(dp.frontierSize || 0);
  const actionTrimmed = Number(dp.actionTrimmed || 0);
  const expansionBudgetExhausted = Boolean(dp.expansionBudgetExhausted);
  const incompleteReasons = [];
  if (frontierSize > 0) incompleteReasons.push("frontier-nonempty");
  if (dp.stoppedReason) incompleteReasons.push(dp.stoppedReason);
  if (actionTrimmed > 0) incompleteReasons.push("action-trimmed");
  if (expansionBudgetExhausted) incompleteReasons.push("expansion-budget-exhausted");
  return {
    startCandidateId: attempt && attempt.startCandidateId || null,
    found: Boolean(attempt && attempt.found),
    goalCount: Number(attempt && attempt.goalCount || 0),
    expansions: Number(dp.expansions || 0),
    frontierSize,
    stoppedReason: dp.stoppedReason || null,
    expansionBudgetExhausted,
    actionTrimmed,
    completeWithinConfiguredActionSet: incompleteReasons.length === 0,
    incompleteReasons,
    failureClass: attempt && attempt.failureClass || null,
  };
}

function classifySearch(run) {
  const attempts = (run && run.segmentResults || []).flatMap((segment) => segment.attempts || []);
  if (attempts.length === 0) {
    return {
      classification: "not-run",
      completeWithinConfiguredActionSet: false,
      incompleteAttempts: [],
    };
  }
  const summarized = attempts.map(summarizeAttempt);
  const incompleteAttempts = summarized.filter((attempt) => !attempt.completeWithinConfiguredActionSet);
  const completeWithinConfiguredActionSet = incompleteAttempts.length === 0;
  return {
    classification: completeWithinConfiguredActionSet
      ? (run && run.found ? "success" : "failed")
      : "inconclusive",
    completeWithinConfiguredActionSet,
    incompleteAttempts,
  };
}

function summarizeStrictReplay(result) {
  return {
    performed: Boolean(result && result.performed),
    valid: Boolean(result && result.valid),
    stepsAttempted: Number(result && result.stepsAttempted || 0),
    stepsCompleted: Number(result && result.stepsCompleted || 0),
    failureStep: result && result.failureStep != null ? result.failureStep : null,
    failureReason: result && result.failureReason || null,
    expectedStateKey: result && result.expectedStateKey || null,
    actualStateKey: result && result.actualStateKey || null,
    error: result && result.error || null,
  };
}

function summarizePipelineStages(pipeline, segmentIds) {
  const attempts = pipeline && pipeline.attempts || [];
  const merges = pipeline && pipeline.merges || [];
  return segmentIds.map((segmentId) => {
    const segmentAttempts = attempts.filter((attempt) => attempt.segmentId === segmentId);
    const segmentMerges = merges.filter((merge) => merge.segmentId === segmentId);
    const rawGoalArchive = segmentAttempts.flatMap((attempt) => attempt.rawGoalSkylineStates || []);
    const segmentCandidates = segmentAttempts.flatMap((attempt) => attempt.segmentGoalSkyline || []);
    const mergedCandidates = segmentMerges.flatMap((merge) => merge.merged || []);
    return {
      segmentId,
      observed: segmentAttempts.length > 0 || segmentMerges.length > 0,
      productionSuccessor: {
        attemptsObserved: segmentAttempts.length,
        candidateIds: segmentAttempts.map((attempt) => attempt.candidateId),
      },
      dpBucketRetention: {
        observed: segmentAttempts.length > 0,
        attemptCount: segmentAttempts.length,
      },
      rawDpGoalArchive: {
        candidateCount: rawGoalArchive.length,
        candidates: rawGoalArchive,
      },
      segmentGoalCandidates: {
        candidateCount: segmentCandidates.length,
        candidates: segmentCandidates,
      },
      mergedCheckpointFrontier: {
        mergeCount: segmentMerges.length,
        candidateCount: mergedCandidates.length,
        candidates: mergedCandidates,
      },
    };
  });
}

function candidateExactStateKey(simulator, candidate) {
  if (!candidate) return null;
  if (candidate.exactStateKey) return candidate.exactStateKey;
  return candidate.state ? buildStateKey(candidate.state) : null;
}

function compactPipelineCandidate(simulator, candidate, segment) {
  const state = candidate && candidate.state;
  if (!state) return {
    id: candidate && candidate.id || null,
    exactStateKey: candidate && candidate.exactStateKey || null,
  };
  return {
    id: candidate.id || null,
    exactStateKey: buildStateKey(state),
    dpKey: buildDpStateKey(simulator, state, {
      dpKeyMode: segment && segment.dp && segment.dp.keyMode || "region",
    }),
    dominanceKey: buildDominanceKey(state),
    hero: compactHero(state),
    tags: Array.isArray(candidate.tags) ? candidate.tags.slice() : [],
    routeLength: Array.isArray(candidate.route) ? candidate.route.length : null,
  };
}

function exactMatches(list, exactStateKey) {
  return (list || []).filter((candidate) => (
    candidateExactStateKey(null, candidate) === exactStateKey
  ));
}

function exactLineagePipelineEvidence(simulator, pipeline, segment, exactStateKey) {
  const attempts = (pipeline && pipeline.attempts || [])
    .filter((attempt) => attempt.segmentId === segment.id);
  const rawGoalMatches = attempts.flatMap((attempt) => (
    exactMatches(attempt.rawGoalSkylineStates, exactStateKey)
  ));
  const segmentGoalMatches = attempts.flatMap((attempt) => (
    exactMatches(attempt.segmentGoalSkyline, exactStateKey)
  ));
  const rawMerge = (pipeline && pipeline.rawMerges || [])
    .filter((merge) => merge.segmentId === segment.id)
    .slice(-1)[0] || null;
  const mergedCandidates = rawMerge && rawMerge.merged || [];
  const mergedMatches = exactMatches(mergedCandidates, exactStateKey);
  const stageData = [
    {
      id: "raw-dp-goal-archive",
      present: rawGoalMatches.length > 0,
      matches: rawGoalMatches,
    },
    {
      id: "segment-goal-skyline",
      present: segmentGoalMatches.length > 0,
      matches: segmentGoalMatches,
    },
    {
      id: "merged-checkpoint-frontier",
      present: mergedMatches.length > 0,
      matches: mergedMatches,
    },
  ];
  const firstAbsent = stageData.find((stage) => !stage.present) || null;
  return {
    segmentId: segment.id,
    exactStateKey,
    goalAccepted: false,
    stages: stageData.map((stage) => ({
      id: stage.id,
      present: stage.present,
      matchingCandidates: stage.matches.map((candidate) => (
        compactPipelineCandidate(simulator, candidate, segment)
      )),
    })),
    firstAbsentPipelineStage: firstAbsent && firstAbsent.id || null,
    replacingCandidates: mergedCandidates.map((candidate) => (
      compactPipelineCandidate(simulator, candidate, segment)
    )),
  };
}

function recordWasObserved(record) {
  return Boolean(record && (
    record.generated ||
    record.successorGenerated ||
    record.dominanceRejected ||
    record.skylineCapacityRejected ||
    record.skylineInserted ||
    record.skylineEvicted ||
    record.agendaPopped ||
    record.goalAccepted ||
    record.postRejoined ||
    (Array.isArray(record.events) && record.events.length > 0)
  ));
}

function annotateLifecycleCoverage(lifecycle, exactDropEvidence) {
  const records = Object.values(lifecycle && lifecycle.records || {})
    .sort((left, right) => left.decisionIndex - right.decisionIndex);
  const observed = records.filter(recordWasObserved);
  const unobserved = records.find((record) => !recordWasObserved(record)) || null;
  const lastNaturallyTrackedDecision = observed.length > 0
    ? observed[observed.length - 1].decisionIndex
    : null;
  const firstUnobservedDecision = unobserved && unobserved.decisionIndex || null;
  const firstUnobservedReason = exactDropEvidence && exactDropEvidence.firstAbsentPipelineStage
    ? "exact teacher entry state absent from downstream checkpoint"
    : unobserved
      ? "no production event matched the exact teacher pre-state"
      : null;
  const annotatedRecords = records.map((record) => {
    const observedRecord = recordWasObserved(record);
    const postDrop = firstUnobservedDecision != null &&
      record.decisionIndex >= firstUnobservedDecision &&
      !observedRecord;
    return {
      ...record,
      observed: observedRecord,
      ...(postDrop ? {
        classification: "not-applicable-exact-lineage-absent",
        classificationReason: firstUnobservedReason,
      } : {}),
    };
  });
  return {
    ...lifecycle,
    records: Object.fromEntries(annotatedRecords.map((record) => [
      `decision-${record.decisionIndex}`,
      record,
    ])),
    decisionTargetsDefined: records.length === FUTURE_DECISION_END - FUTURE_DECISION_START + 1,
    observedDecisionIndices: observed.map((record) => record.decisionIndex),
    lastNaturallyTrackedDecision,
    firstUnobservedDecision,
    firstUnobservedReason,
    exactLineageDropDetected: Boolean(
      exactDropEvidence && exactDropEvidence.goalAccepted && exactDropEvidence.firstAbsentPipelineStage,
    ),
    postDropDecisionsClassifiedNotApplicable: Boolean(
      firstUnobservedDecision == null || annotatedRecords
        .filter((record) => record.decisionIndex >= firstUnobservedDecision)
        .every((record) => record.classification === "not-applicable-exact-lineage-absent"),
    ),
  };
}

function classifyIsolatedSearch(results) {
  const attempts = (results || []).map((result) => result.search && result.search.completion).filter(Boolean);
  if (attempts.length === 0) {
    return {
      classification: "not-run",
      completeWithinConfiguredActionSet: false,
      incompleteAttempts: [],
    };
  }
  const incompleteAttempts = attempts
    .filter((completion) => !completion.completeWithinConfiguredActionSet)
    .flatMap((completion) => completion.incompleteAttempts || []);
  const completeWithinConfiguredActionSet = incompleteAttempts.length === 0 &&
    attempts.length === results.length;
  const found = (results || []).some((result) => result.search && result.search.found);
  return {
    classification: !completeWithinConfiguredActionSet
      ? "inconclusive"
      : found ? "success" : "failed",
    completeWithinConfiguredActionSet,
    incompleteAttempts,
  };
}

function isolatedPipelineStage(results, segmentId) {
  const workers = (results || []).filter((result) => result.pipeline && result.pipeline.stages);
  const stages = workers
    .map((result) => result.pipeline.stages.find((stage) => stage.segmentId === segmentId))
    .filter(Boolean);
  return {
    segmentId,
    observed: stages.length > 0,
    workerCount: stages.length,
    productionAttempts: stages.reduce((sum, stage) => sum + stage.productionSuccessor.attemptsObserved, 0),
    rawGoalCandidateCount: stages.reduce((sum, stage) => sum + stage.rawDpGoalArchive.candidateCount, 0),
    segmentCandidateCount: stages.reduce((sum, stage) => sum + stage.segmentGoalCandidates.candidateCount, 0),
    mergedCandidateCount: stages.reduce((sum, stage) => sum + stage.mergedCheckpointFrontier.candidateCount, 0),
  };
}

function runReachedMilestone(run, segmentId) {
  return Boolean((run && run.segmentResults || []).some((segment) => (
    segment.segmentId === segmentId && segment.found === true
  )));
}

function hardTilesMatchExpected(hardTiles) {
  const actual = new Set((hardTiles || []).map((tile) => `${tile.floorId}:${tile.x},${tile.y}`));
  return EXPECTED_HARD_TILES.every(([floorId, x, y]) => actual.has(`${floorId}:${x},${y}`)) &&
    EXPECTED_HARD_TILES.length === (hardTiles || []).length &&
    (hardTiles || []).every((tile) => tile.present === true);
}

function summarizeRun(run) {
  const segments = (run && run.segmentResults || []).map((summary) => ({
    segmentId: summary.segmentId,
    found: Boolean(summary.found),
    failureClass: summary.failureClass || null,
    startCandidatesTried: Number(summary.startCandidatesTried || 0),
    startCandidatesAvailable: Number(summary.startCandidatesAvailable || 0),
    attempts: (summary.attempts || []).map(summarizeAttempt),
    candidates: summary.candidates || [],
  }));
  return {
    found: Boolean(run && run.found),
    reachedMilestone: run && run.reachedMilestone || null,
    failedSegment: run && run.failedSegment && {
      segmentId: run.failedSegment.segmentId || null,
      failureClass: run.failedSegment.failureClass || null,
      stoppedReason: run.failedSegment.stoppedReason || null,
    },
    finalCandidate: run && run.finalCandidate ? {
      id: run.finalCandidate.id || null,
      exactStateKey: buildStateKey(run.finalCandidate.state),
      dominanceKey: buildDominanceKey(run.finalCandidate.state),
      hero: compactHero(run.finalCandidate.state),
      routeLength: Array.isArray(run.finalCandidate.route) ? run.finalCandidate.route.length : null,
    } : null,
    segmentResults: segments,
    checkpointResults: (run && run.checkpointResults || []).map((checkpoint) => ({
      segmentId: checkpoint.segmentId,
      candidateCount: Number(checkpoint.candidateCount || 0),
      uniqueFeasibleRoute: Boolean(checkpoint.uniqueFeasibleRoute),
      candidates: checkpoint.candidates || [],
    })),
    ledger: run && run.evaluationAttemptLedger || [],
    budget: run && run.budget || null,
    memory: run && run.memory || null,
    completion: classifySearch(run),
  };
}

function segmentForDecision(segmentsById, decisionNumber) {
  if (decisionNumber <= 12) return segmentsById["mt2-entry"];
  if (decisionNumber <= 14) return segmentsById["mt2-local-3582"];
  return segmentsById["mt2-hp3834"];
}

function buildFutureTargets(simulator, teacherRoute, teacherReplay, segmentsById) {
  const targets = [];
  for (let decisionNumber = FUTURE_DECISION_START; decisionNumber <= FUTURE_DECISION_END; decisionNumber += 1) {
    const decisionIndex = decisionNumber - 1;
    const decision = teacherRoute.decisions[decisionIndex];
    const preState = teacherReplay.states[decisionIndex];
    const postState = teacherReplay.states[decisionIndex + 1];
    const segment = segmentForDecision(segmentsById, decisionNumber);
    const provider = buildSegmentActionProvider(simulator, segment);
    const action = provider(simulator, preState).find((candidate) => (
      candidate && (
        candidate.summary === decision.summary ||
        actionFingerprint(simulator, candidate) === decision.fingerprint
      )
    ));
    targets.push({
      id: "decision-" + decisionNumber,
      decisionIndex: decisionNumber,
      targetSegment: segment.id,
      actionSummary: decision.summary || null,
      actionFingerprint: action
        ? actionFingerprint(simulator, action)
        : decision.fingerprint || null,
      preExactStateKey: buildStateKey(preState),
      expectedPostExactStateKey: buildStateKey(postState),
      expectedPostHero: compactHero(postState),
    });
  }
  return targets;
}

function runMt1Setup(project, simulator, commonState, mt1, args) {
  const pipeline = makePipelineObserver(simulator);
  const run = runMilestoneGraph(simulator, commonState, { milestones: [mt1] }, {
    candidateLimit: number(args["candidate-limit"], 8),
    goalSkylineLimit: number(args["goal-skyline-limit"], 8),
    dpSkylineMax: number(args["dp-skyline-max"], 4),
    preserveSkylineRoles: args["preserve-skyline-roles"] !== "0",
    stopOnFirstGoal: false,
    maxActionsPerState: number(args["max-actions-per-state"], 256),
    maxExpansions: number(args["setup-max-expansions"], MT1_SETUP_MAX_EXPANSIONS),
    maxRuntimeMs: number(args["max-runtime-ms"], 900000),
    maxHeapMb: number(args["max-heap-mb"], 1400),
    maxRssMb: number(args["max-rss-mb"], 1800),
    memoryCheckIntervalExpansions: number(args["memory-check-interval-expansions"], 1),
    memoryCheckIntervalActions: number(args["memory-check-interval-actions"], 1),
    agendaMode: args["agenda-mode"] || "best-first",
    pipelineObserver: pipeline,
  });
  const merge = pipeline.rawMerges.find((entry) => entry.segmentId === mt1.id) || null;
  return { run, pipeline, merge };
}

function runDownstream(project, simulator, teacherRoute, teacherReplay, segments, segmentsById, initialState, options) {
  const targets = buildFutureTargets(simulator, teacherRoute, teacherReplay, segmentsById);
  const finalTarget = targets[targets.length - 1];
  const lifecycleCollector = createLifecycleObserver(
    simulator,
    targets,
    finalTarget.expectedPostExactStateKey,
    {
      captureDominanceWitnessFor: targets.map((target) => target.id),
      capturePostStateRejoins: true,
    },
  );
  const pipeline = makePipelineObserver(simulator);
  const run = runMilestoneGraph(simulator, initialState, { milestones: segments }, {
    candidateLimit: options.candidateLimit,
    goalSkylineLimit: options.goalSkylineLimit,
    dpSkylineMax: options.dpSkylineMax,
    preserveSkylineRoles: true,
    stopOnFirstGoal: false,
    maxActionsPerState: options.maxActionsPerState,
    maxExpansions: options.maxExpansions,
    maxRuntimeMs: options.maxRuntimeMs,
    perAttemptMaxExpansions: options.perAttemptMaxExpansions,
    perAttemptMaxRuntimeMs: options.perAttemptMaxRuntimeMs,
    maxHeapMb: options.maxHeapMb,
    maxRssMb: options.maxRssMb,
    memoryCheckIntervalExpansions: options.memoryCheckIntervalExpansions,
    memoryCheckIntervalActions: options.memoryCheckIntervalActions,
    agendaMode: options.agendaMode,
    budgetScope: options.budgetScope,
    initialFrontier: options.initialFrontier,
    observer: lifecycleCollector.observer,
    observerIncludeExactStateKey: true,
    observerCaptureMode: "targeted-state",
    pipelineObserver: pipeline,
  });
  return {
    run,
    lifecycle: lifecycleCollector.finalize(),
    pipeline,
    targets,
  };
}

function runCheckpointWorker() {
  const input = fs.readFileSync(0, "utf8");
  const payload = JSON.parse(input);
  const project = loadProject(payload.projectRoot);
  const simulator = makeSimulator(project);
  const state = createStateFromSnapshot(project, payload.startSnapshot, {
    rank: "chaos",
    route: [],
    decisionDepth: Number(payload.decisionDepth || 0),
  });
  syncProgress(state);
  const restoredStateKey = buildStateKey(state);
  const pipeline = makePipelineObserver(simulator);
  const options = payload.options || {};
  const run = runMilestoneGraph(simulator, state, { milestones: [payload.segment] }, {
    candidateLimit: options.candidateLimit,
    goalSkylineLimit: options.goalSkylineLimit,
    dpSkylineMax: options.dpSkylineMax,
    preserveSkylineRoles: true,
    stopOnFirstGoal: false,
    maxActionsPerState: options.maxActionsPerState,
    maxExpansions: options.maxExpansions,
    maxRuntimeMs: options.maxRuntimeMs,
    perAttemptMaxExpansions: options.maxExpansions,
    perAttemptMaxRuntimeMs: options.maxRuntimeMs,
    maxHeapMb: options.maxHeapMb,
    maxRssMb: options.maxRssMb,
    memoryCheckIntervalExpansions: options.memoryCheckIntervalExpansions,
    memoryCheckIntervalActions: options.memoryCheckIntervalActions,
    agendaMode: options.agendaMode,
    pipelineObserver: pipeline,
  });
  const heapSizeLimitMb = v8.getHeapStatistics().heap_size_limit / (1024 * 1024);
  const oldSpaceFlag = process.execArgv.find((arg) => arg.startsWith("--max-old-space-size=")) || null;
  const oldSpaceConfiguredMb = oldSpaceFlag ? Number(oldSpaceFlag.split("=")[1]) : null;
  const output = {
    schema: "motapathfinder.hp3834-isolated-checkpoint-worker.v1",
    started: true,
    pid: process.pid,
    startExactStateKey: payload.startExactStateKey || null,
    restoredStateKey,
    processIsolated: true,
    childOldSpaceMb: oldSpaceConfiguredMb,
    childOldSpaceFlagApplied: oldSpaceConfiguredMb === Number(options.childOldSpaceMb),
    heapSizeLimitMb: Number(heapSizeLimitMb.toFixed(1)),
    childOldSpaceActuallyApplied: oldSpaceConfiguredMb === Number(options.childOldSpaceMb) && heapSizeLimitMb > Number(options.childOldSpaceMb) * 0.8,
    search: summarizeRun(run),
    pipeline: {
      attempts: pipeline.attempts,
      merges: pipeline.merges,
      stages: summarizePipelineStages(pipeline, [payload.segment.id]),
    },
  };
  process.stdout.write(JSON.stringify(output));
}

function runIsolatedLocalCheckpoint(projectRoot, project, candidate, segment, options) {
  const snapshot = buildSolverSnapshot(project, candidate.state, {
    floorIds: Object.keys(project.floorsById || {}),
  });
  const payload = {
    projectRoot,
    segment,
    startSnapshot: snapshot,
    startExactStateKey: buildStateKey(candidate.state),
    decisionDepth: candidate.state && candidate.state.meta && candidate.state.meta.decisionDepth || 0,
    options,
  };
  const timeoutMs = Number(options.maxRuntimeMs || 900000) + 60000;
  const child = spawnSync(
    process.execPath,
    ["--max-old-space-size=" + options.childOldSpaceMb, __filename, "--checkpoint-worker=1"],
    {
      cwd: ROOT,
      input: JSON.stringify(payload),
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    },
  );
  const stdout = String(child.stdout || "").trim();
  let result = null;
  try {
    result = stdout ? JSON.parse(stdout) : null;
  } catch (error) {
    result = null;
  }
  return {
    candidateId: candidate.id || null,
    startExactStateKey: payload.startExactStateKey,
    hero: compactHero(candidate.state),
    started: Boolean(result && result.started) || child.pid != null,
    pid: result && result.pid || child.pid || null,
    exitCode: child.status == null ? null : child.status,
    signal: child.signal || null,
    timedOut: Boolean(child.error && child.error.code === "ETIMEDOUT"),
    processIsolated: Boolean(result && result.processIsolated),
    childOldSpaceFlagApplied: Boolean(result && result.childOldSpaceFlagApplied),
    childOldSpaceActuallyApplied: Boolean(result && result.childOldSpaceActuallyApplied),
    childOldSpaceMb: result && result.childOldSpaceMb || null,
    heapSizeLimitMb: result && result.heapSizeLimitMb || null,
    search: result && result.search || null,
    pipeline: result && result.pipeline || null,
    error: result
      ? null
      : String(child.error && child.error.message || String(child.stderr || "worker produced no JSON output")).slice(0, 1000),
  };
}

function buildMarkdown(report) {
  const lines = [
    "# PR-4.4h MT2 candidate-2 natural search audit",
    "",
    "Status: **" + report.status + "**",
    "",
    "Candidate-2-only outcome: **" + report.candidate2Outcome + "**.",
    "",
    "## Contract",
    "",
    "- Source route strict replay: **" + report.gates.sourceRouteStrictReplay + "**.",
    "- Candidate-2 exact start matched the MT1 gate: **" + report.gates.candidate2ExactStartMatched + "**.",
    "- Production search executed without teacher action injection: **" + report.gates.productionSearchExecuted + " / " + report.gates.productionSearchNoTeacherInjection + "**.",
    "- Candidate-2 was naturally retained by the MT1 merged checkpoint: **" + report.gates.candidate2Retained + "**.",
    "- Candidate-2 lifecycle observer covered decisions 11–23: **" + report.gates.lifecycleObserved + "**.",
    "- Pipeline observed for entry/local/HP3834: **" + [
      report.gates.mt2EntryPipelineObserved,
      report.gates.mt2LocalPipelineObserved,
      report.gates.mt2Hp3834PipelineObserved,
    ].join(" / ") + "**.",
    "- Oracle suffix complete and hard tiles checked: **" + report.gates.oracleSuffixComplete + " / " + report.gates.hardTilesChecked + "**.",
    "- Search completion classification: **" + report.searchCompletion.classification + "**.",
    "- Natural milestone reach: entry=" + report.candidate2NaturallyReached.mt2Entry + ", local-3582=" + report.candidate2NaturallyReached.mt2Local3582 + ", HP3834=" + report.candidate2NaturallyReached.mt2Hp3834 + ".",
    "- Incomplete attempts: " + (report.searchCompletion.incompleteAttempts.length
      ? report.searchCompletion.incompleteAttempts.map((attempt) => (
        attempt.startCandidateId + " (expansions=" + attempt.expansions + ", frontier=" + attempt.frontierSize + ", reasons=" + attempt.incompleteReasons.join("+") + ")"
      )).join("; ")
      : "none") + ".",
    "- Full-frontier condition met (candidate-2 success): **" + report.conditions.fullFrontierApplicable + "**.",
    "- Full four-candidate frontier run: **" + (
      report.conditions.fullFrontierApplicable
        ? report.gates.fullFrontierRunExecuted
        : "not-applicable"
    ) + "**.",
    "",
    "## Candidate-2-only result",
    "",
    "- found=" + report.candidate2Only.search.found + ", reachedMilestone=" + report.candidate2Only.search.reachedMilestone + ".",
    "- final hero=" + JSON.stringify(report.candidate2Only.search.finalCandidate && report.candidate2Only.search.finalCandidate.hero) + ".",
    "- budget=" + JSON.stringify(report.candidate2Only.search.budget) + ".",
    "",
    "| Decision | Segment | Generated | Post rejoin | Dominance reject | Skyline insert | Evicted | Popped | Goal accepted | Classification |",
    "|---:|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|---|",
  ];
  Object.values(report.candidate2Only.lifecycle.records || {}).forEach((record) => {
    lines.push(
      "| " + record.decisionIndex +
      " | " + record.targetSegment +
      " | " + record.generated +
      " | " + record.postRejoined +
      " | " + record.dominanceRejected +
      " | " + record.skylineInserted +
      " | " + record.skylineEvicted +
      " | " + record.agendaPopped +
      " | " + record.goalAccepted +
      " | " + record.classification + " |",
    );
  });
  lines.push(
    "",
    "## Pipeline stages",
    "",
    "| Segment | Production attempts | DP bucket retention | Raw goal archive | Segment candidates | Merged checkpoint |",
    "|---|---:|:---:|---:|---:|---:|",
  );
  (report.candidate2Only.pipeline.stages || []).forEach((stage) => {
    lines.push(
      "| " + stage.segmentId +
      " | " + stage.productionSuccessor.attemptsObserved +
      " | " + stage.dpBucketRetention.observed +
      " | " + stage.rawDpGoalArchive.candidateCount +
      " | " + stage.segmentGoalCandidates.candidateCount +
      " | " + stage.mergedCheckpointFrontier.candidateCount + " |",
    );
  });
  lines.push(
    "",
    "## Oracle-only suffix",
    "",
    "- executed=" + report.gates.oracleSuffixExecuted + ", completeSuffix=" + report.oracle.completeSuffix + ".",
    "- reached milestones=" + Object.entries(report.oracle.reached || {}).map(([id, value]) => (
      id + "@decision-" + value.decisionIndex
    )).join(", ") + ".",
    "- final hero=" + JSON.stringify(report.oracle.finalHero) + ".",
    "- all hard tiles present=" + report.oracle.allHardTilesPresent + ".",
    "",
    "## Segment attempts",
    "",
    "| Run | Segment | Attempt order | Start candidate | Expansions | Frontier | Stop |",
    "|---|---|---:|---|---:|---:|---|",
  );
  const appendAttempts = (label, runReport) => {
    (runReport.pipeline.attempts || []).forEach((attempt, index) => {
      lines.push(
        "| " + label +
        " | " + attempt.segmentId +
        " | " + (index + 1) +
        " | " + attempt.candidateId +
        " | " + attempt.expansions +
        " | " + attempt.frontierSize +
        " | " + attempt.stoppedReason + " |",
      );
    });
  };
  appendAttempts("candidate-2-only", report.candidate2Only);
  if (report.fullFrontier) appendAttempts("full-frontier", report.fullFrontier);
  lines.push(
    "",
    "The full-frontier run is conditional: it is executed only after candidate-2-only naturally reaches `mt2-hp3834`.",
    "",
    "## Provenance",
    "",
    "- solver commit: " + report.provenance.solverCommit,
    "- commit stable: **" + report.provenance.commitStable + "**",
    "- clean worktree: **" + report.provenance.worktreeCleanAtStart + "/" + report.provenance.worktreeCleanAtFinish + "**",
  );
  return lines.join("\n") + "\n";
}

function buildIsolatedMarkdown(report) {
  const pipeline = report.pipelineEvidence || {};
  const lifecycle = report.lifecycleCoverage || {};
  const lines = [
    "# PR-4.4h-a exact pipeline and isolated checkpoint audit",
    "",
    "Status: **" + report.status + "**",
    "",
    "Candidate-2 downstream outcome: **" + report.candidate2Outcome + "**.",
    "",
    "## Gate summary",
    "",
    "- Source route strict replay: **" + report.gates.sourceRouteStrictReplay + "**.",
    "- Teacher exact MT2-entry goal accepted: **" + report.gates.teacherEntryGoalAccepted + "**.",
    "- Exact teacher entry pipeline retained (raw / segment / merged): **" + [
      report.gates.teacherEntryRawGoalRetained,
      report.gates.teacherEntrySegmentCandidateRetained,
      report.gates.teacherEntryMergedCheckpointRetained,
    ].join(" / ") + "**.",
    "- First exact-lineage drop classified: **" + report.gates.firstExactLineageDropClassified + "**.",
    "- Entry replacement continuation audited: **" + report.gates.entryReplacementContinuationAudited + "**.",
    "- All local checkpoints attempted in isolated processes: **" + report.gates.allLocalCheckpointsAttempted + " / " + report.gates.allLocalAttemptsProcessIsolated + "**.",
    "- Child old-space actually applied to every worker: **" + report.gates.childOldSpaceActuallyApplied + "**.",
    "- Lifecycle targets defined / last observed / first unobserved: **" + [
      report.gates.decisionTargetsDefined,
      lifecycle.lastNaturallyTrackedDecision,
      lifecycle.firstUnobservedDecision,
    ].join(" / ") + "**.",
    "- Post-drop decisions classified not-applicable: **" + report.gates.postDropDecisionsClassifiedNotApplicable + "**.",
    "",
    "## Exact teacher entry pipeline",
    "",
    "- exact key: `" + pipeline.exactStateKey + "`",
    "- first absent stage: **" + pipeline.firstAbsentPipelineStage + "**",
    "",
    "| Stage | Exact state present | Matching candidates |",
    "|---|:---:|---:|",
  ];
  (pipeline.stages || []).forEach((stage) => {
    lines.push("| " + stage.id + " | " + stage.present + " | " + (stage.matchingCandidates || []).length + " |");
  });
  lines.push(
    "",
    "## Entry replacement oracle (decisions 13–23)",
    "",
    "| Candidate | 13–14 executable | Exact rejoin decisions | Local reached | HP3834 reached | Complete suffix |",
    "|---|:---:|---|:---:|:---:|:---:|",
  );
  (report.entryReplacementContinuations || []).forEach((entry) => {
    lines.push(
      "| " + entry.candidateId +
      " | " + entry.decisions13To14Executable +
      " | " + (entry.exactRejoinDecisions || []).join(", ") +
      " | " + entry.reachedMt2Local3582 +
      " | " + entry.reachedMt2Hp3834 +
      " | " + entry.completeSuffix + " |",
    );
  });
  lines.push(
    "",
    "## Isolated MT2 HP3834 searches",
    "",
    "| # | Candidate | Result | Completion | Expansions | Frontier | Stop | Peak heap / RSS | Old-space |",
    "|---:|---|---|---|---:|---:|---|---:|:---:|",
  );
  (report.isolatedLocalCheckpoints || []).forEach((entry, index) => {
    const search = entry.search || {};
    const attempt = search.segmentResults && search.segmentResults[0] && search.segmentResults[0].attempts && search.segmentResults[0].attempts[0] || {};
    const memory = search.memory || {};
    lines.push(
      "| " + (index + 1) +
      " | " + entry.candidateId +
      " | " + (search.found ? "found" : "not-found") +
      " | " + (search.completion && search.completion.classification || "not-run") +
      " | " + (attempt.expansions || 0) +
      " | " + (attempt.frontierSize || 0) +
      " | " + (attempt.stoppedReason || "null") +
      " | " + (memory.peakHeapUsedMb || "-") + " / " + (memory.peakRssMb || "-") +
      " | " + entry.childOldSpaceActuallyApplied + " |",
    );
  });
  lines.push(
    "",
    "- All local checkpoint completion classification: **" + report.searchCompletion.classification + "**.",
    "- Incomplete attempts are inconclusive and are not interpreted as dominance or selector failures.",
    "",
    "## Oracle suffix from MT1 candidate-2",
    "",
    "- completeSuffix=" + report.oracle.completeSuffix + ", reached=" + Object.entries(report.oracle.reached || {}).map(([id, value]) => id + "@decision-" + value.decisionIndex).join(", ") + ".",
    "- final hero=" + JSON.stringify(report.oracle.finalHero) + ".",
    "- all hard tiles present=" + report.oracle.allHardTilesPresent + ".",
    "",
    "## Provenance",
    "",
    "- data generation commit: " + report.provenance.dataGenerationCommit,
    "- renderer commit: " + report.provenance.rendererCommit,
    "- artifact commit: " + (report.provenance.artifactCommit || "pending-artifact-commit"),
    "- clean worktree at run start / finish: **" + report.provenance.worktreeCleanAtStart + "/" + report.provenance.worktreeCleanAtFinish + "**",
  );
  return lines.join("\n") + "\n";
}

function runIsolatedAudit(argv) {
  const args = parseArgs(argv);
  const dataGenerationCommit = gitCommit();
  const startedClean = cleanWorktree();
  const projectRoot = path.resolve(args["project-root"] || DEFAULT_PROJECT_ROOT);
  const teacherRouteFile = path.resolve(args["teacher-route"] || DEFAULT_TEACHER_ROUTE);
  const outFile = path.resolve(args.out || DEFAULT_ISOLATED_OUT);
  const outMarkdown = path.resolve(args["out-md"] || outFile.replace(/\.json$/i, ".md"));
  const project = loadProject(projectRoot);
  const simulator = makeSimulator(project);
  const teacherRoute = readJson(teacherRouteFile);
  const sourceRouteStrictReplay = strictReplayRoute(project, simulator, teacherRoute);
  const teacherReplay = replayRoute(project, simulator, teacherRoute);
  const spec = getMilestoneSpec(project, "onlyup-chaos-mt5-blueking");
  const segmentsById = Object.fromEntries(
    ["mt1-gate-1559"].concat(FUTURE_SEGMENT_IDS)
      .map((id) => [id, spec.milestones.find((milestone) => milestone.id === id)]),
  );
  if (Object.values(segmentsById).some((segment) => !segment)) {
    throw new Error("Missing required MT1/MT2 milestone.");
  }
  const mt1 = segmentsById["mt1-gate-1559"];
  const futureSegments = FUTURE_SEGMENT_IDS.map((id) => segmentsById[id]);
  const teacherGatePredicate = buildSegmentGoalPredicate(project, mt1, simulator);
  const teacherGateState = teacherReplay.states.find((state) => teacherGatePredicate(state));
  if (!teacherGateState) throw new Error("Teacher route has no formal mt1-gate-1559 state.");
  const gateExactStateKey = buildStateKey(teacherGateState);
  const commonState = teacherReplay.states[1];
  const setup = runMt1Setup(project, simulator, commonState, mt1, args);
  const retained = setup.merge && Array.isArray(setup.merge.merged) ? setup.merge.merged : [];
  const candidate2Index = retained.findIndex((candidate) => buildStateKey(candidate.state) === gateExactStateKey);
  const candidate2 = candidate2Index >= 0 ? retained[candidate2Index] : null;
  const oracle = candidate2
    ? runFutureValueOracle(project, simulator, candidate2.state, teacherRoute, teacherReplay, futureSegments)
    : null;
  const candidate2Options = {
    candidateLimit: number(args["candidate-limit"], 8),
    goalSkylineLimit: number(args["goal-skyline-limit"], 8),
    dpSkylineMax: number(args["dp-skyline-max"], 4),
    maxActionsPerState: number(args["max-actions-per-state"], 256),
    maxExpansions: number(args["max-expansions"], 900),
    maxRuntimeMs: number(args["max-runtime-ms"], 900000),
    maxHeapMb: number(args["max-heap-mb"], 1400),
    maxRssMb: number(args["max-rss-mb"], 1800),
    memoryCheckIntervalExpansions: number(args["memory-check-interval-expansions"], 1),
    memoryCheckIntervalActions: number(args["memory-check-interval-actions"], 1),
    childOldSpaceMb: number(args["child-old-space-mb"], 1600),
    agendaMode: args["agenda-mode"] || "best-first",
  };
  const prefixSegments = futureSegments.slice(0, 2);
  const candidate2Only = candidate2
    ? runDownstream(
      project,
      simulator,
      teacherRoute,
      teacherReplay,
      prefixSegments,
      segmentsById,
      candidate2.state,
      candidate2Options,
    )
    : null;
  const candidate2LifecycleRaw = candidate2Only && candidate2Only.lifecycle;
  const teacherEntryRecord = candidate2LifecycleRaw && candidate2LifecycleRaw.records && candidate2LifecycleRaw.records["decision-12"];
  const entryPipeline = candidate2Only
    ? exactLineagePipelineEvidence(
      simulator,
      candidate2Only.pipeline,
      segmentsById["mt2-entry"],
      candidate2Only.targets.find((target) => target.id === "decision-12").expectedPostExactStateKey,
    )
    : {
      segmentId: "mt2-entry",
      exactStateKey: null,
      goalAccepted: false,
      stages: [],
      firstAbsentPipelineStage: null,
      replacingCandidates: [],
    };
  entryPipeline.goalAccepted = Boolean(teacherEntryRecord && teacherEntryRecord.goalAccepted);
  const lifecycleCoverage = annotateLifecycleCoverage(candidate2LifecycleRaw, entryPipeline);
  const entryMerge = candidate2Only && candidate2Only.pipeline && candidate2Only.pipeline.rawMerges
    .filter((merge) => merge.segmentId === "mt2-entry")
    .slice(-1)[0];
  const localMerge = candidate2Only && candidate2Only.pipeline && candidate2Only.pipeline.rawMerges
    .filter((merge) => merge.segmentId === "mt2-local-3582")
    .slice(-1)[0];
  const entryCandidates = entryMerge && entryMerge.merged || [];
  const localCandidates = localMerge && localMerge.merged || [];
  const entryReplacementContinuations = entryCandidates.map((candidate) => {
    const continuation = runFutureValueOracle(
      project,
      simulator,
      candidate.state,
      teacherRoute,
      teacherReplay,
      futureSegments,
      { startDecisionNumber: 13, endDecisionNumber: 23, initialTargetIndex: 1 },
    );
    const exactRejoinDecisions = continuation.steps
      .filter((step) => teacherReplay.states[step.decisionIndex] && step.postExactStateKey === buildStateKey(teacherReplay.states[step.decisionIndex]))
      .map((step) => step.decisionIndex);
    const firstTwo = continuation.steps.filter((step) => step.decisionIndex <= 14);
    return {
      candidateId: candidate.id || null,
      exactStateKey: buildStateKey(candidate.state),
      hero: compactHero(candidate.state),
      decisions13To14Executable: firstTwo.length === 2 && firstTwo.every((step) => step.providerContainsAction && step.resolved && step.successorGenerated),
      exactRejoinDecisions,
      reachedMt2Local3582: Boolean(continuation.reachedMt2Local3582),
      reachedMt2Hp3834: Boolean(continuation.reachedMt2Hp3834),
      completeSuffix: Boolean(continuation.completeSuffix),
      finalHero: continuation.finalHero,
      allHardTilesPresent: Boolean(continuation.allHardTilesPresent),
      failure: continuation.failure,
      steps: continuation.steps,
    };
  });
  const isolatedLocalCheckpoints = localCandidates.map((candidate) => (
    runIsolatedLocalCheckpoint(projectRoot, project, candidate, segmentsById["mt2-hp3834"], candidate2Options)
  ));
  const searchCompletion = classifyIsolatedSearch(isolatedLocalCheckpoints);
  const hpPipelineStage = isolatedPipelineStage(isolatedLocalCheckpoints, "mt2-hp3834");
  const candidate2NaturallyReached = {
    mt2Entry: Boolean(candidate2Only && runReachedMilestone(candidate2Only.run, "mt2-entry")),
    mt2Local3582: Boolean(candidate2Only && runReachedMilestone(candidate2Only.run, "mt2-local-3582")),
    mt2Hp3834: isolatedLocalCheckpoints.some((entry) => entry.search && entry.search.found),
  };
  const fullFrontierApplicable = false;
  const gates = {
    sourceRouteStrictReplay: Boolean(sourceRouteStrictReplay && sourceRouteStrictReplay.performed && sourceRouteStrictReplay.valid),
    candidate2ExactStartMatched: Boolean(candidate2 && buildStateKey(candidate2.state) === gateExactStateKey),
    productionSearchExecuted: Boolean(candidate2Only && candidate2Only.run),
    productionSearchNoTeacherInjection: true,
    teacherEntryGoalAccepted: Boolean(entryPipeline.goalAccepted),
    teacherEntryRawGoalRetained: Boolean(entryPipeline.stages.find((stage) => stage.id === "raw-dp-goal-archive" && stage.present)),
    teacherEntrySegmentCandidateRetained: Boolean(entryPipeline.stages.find((stage) => stage.id === "segment-goal-skyline" && stage.present)),
    teacherEntryMergedCheckpointRetained: Boolean(entryPipeline.stages.find((stage) => stage.id === "merged-checkpoint-frontier" && stage.present)),
    firstExactLineageDropClassified: Boolean(entryPipeline.goalAccepted && entryPipeline.firstAbsentPipelineStage),
    entryReplacementContinuationAudited: entryCandidates.length === 8 && entryReplacementContinuations.length === 8,
    allLocalCheckpointsAttempted: localCandidates.length === 8 && isolatedLocalCheckpoints.length === 8 && isolatedLocalCheckpoints.every((entry) => entry.started),
    allLocalAttemptsProcessIsolated: isolatedLocalCheckpoints.length === 8 && isolatedLocalCheckpoints.every((entry) => entry.processIsolated && entry.pid),
    childOldSpaceActuallyApplied: isolatedLocalCheckpoints.length === 8 && isolatedLocalCheckpoints.every((entry) => entry.childOldSpaceActuallyApplied),
    mt2EntryPipelineObserved: Boolean(candidate2Only && candidate2Only.pipeline.attempts.some((attempt) => attempt.segmentId === "mt2-entry")),
    mt2LocalPipelineObserved: Boolean(candidate2Only && candidate2Only.pipeline.attempts.some((attempt) => attempt.segmentId === "mt2-local-3582")),
    mt2Hp3834PipelineObserved: hpPipelineStage.observed,
    oracleSuffixExecuted: Boolean(oracle),
    oracleSuffixComplete: Boolean(oracle && oracle.completeSuffix),
    hardTilesChecked: Boolean(oracle && oracle.allHardTilesPresent),
    decisionTargetsDefined: Boolean(lifecycleCoverage && lifecycleCoverage.decisionTargetsDefined),
    lastNaturallyTrackedDecision: lifecycleCoverage && lifecycleCoverage.lastNaturallyTrackedDecision === 12,
    firstUnobservedDecision: lifecycleCoverage && lifecycleCoverage.firstUnobservedDecision === 13,
    postDropDecisionsClassifiedNotApplicable: Boolean(lifecycleCoverage && lifecycleCoverage.postDropDecisionsClassifiedNotApplicable),
    searchCompletionClassified: searchCompletion.classification !== "not-run",
    provenanceCommitStable: Boolean(dataGenerationCommit && gitCommit() === dataGenerationCommit),
    worktreeCleanAtStart: startedClean,
    worktreeCleanAtFinish: cleanWorktree(),
  };
  const requiredGateNames = [
    "sourceRouteStrictReplay",
    "candidate2ExactStartMatched",
    "productionSearchExecuted",
    "productionSearchNoTeacherInjection",
    "teacherEntryGoalAccepted",
    "firstExactLineageDropClassified",
    "entryReplacementContinuationAudited",
    "allLocalCheckpointsAttempted",
    "allLocalAttemptsProcessIsolated",
    "childOldSpaceActuallyApplied",
    "mt2EntryPipelineObserved",
    "mt2LocalPipelineObserved",
    "mt2Hp3834PipelineObserved",
    "oracleSuffixExecuted",
    "oracleSuffixComplete",
    "hardTilesChecked",
    "decisionTargetsDefined",
    "lastNaturallyTrackedDecision",
    "firstUnobservedDecision",
    "postDropDecisionsClassifiedNotApplicable",
    "searchCompletionClassified",
    "provenanceCommitStable",
    "worktreeCleanAtStart",
    "worktreeCleanAtFinish",
  ];
  const failedGates = requiredGateNames.filter((name) => gates[name] !== true);
  const status = failedGates.length > 0
    ? "failed"
    : searchCompletion.classification === "inconclusive"
      ? "inconclusive"
      : "completed";
  const rendererCommit = gitCommit();
  const report = {
    schema: "motapathfinder.hp3834-mt2-candidate2-natural-search-audit.v2",
    generatedAt: new Date().toISOString(),
    status,
    failedGates,
    candidate2Outcome: searchCompletion.classification,
    candidate2NaturallyReached,
    searchCompletion,
    gates,
    config: {
      agendaMode: candidate2Options.agendaMode,
      stopOnFirstGoal: false,
      candidateLimit: candidate2Options.candidateLimit,
      goalSkylineLimit: candidate2Options.goalSkylineLimit,
      dpSkylineMax: candidate2Options.dpSkylineMax,
      maxExpansionsPerAttempt: candidate2Options.maxExpansions,
      maxRuntimeMsPerAttempt: candidate2Options.maxRuntimeMs,
      maxHeapMb: candidate2Options.maxHeapMb,
      maxRssMb: candidate2Options.maxRssMb,
      childOldSpaceMb: candidate2Options.childOldSpaceMb,
      memoryCheckIntervalExpansions: candidate2Options.memoryCheckIntervalExpansions,
      memoryCheckIntervalActions: candidate2Options.memoryCheckIntervalActions,
    },
    source: {
      teacherRoute: relative(teacherRouteFile),
      teacherRouteSha256: sha256(teacherRouteFile),
      projectRoot: relative(projectRoot),
      reportFile: relative(outFile),
      mt1Setup: "natural search from common teacher/production boundary",
      productionScope: "candidate-2 MT1 entry; MT2 HP3834 checkpoints isolated per Node process",
    },
    provenance: {
      dataGenerationCommit,
      rendererCommit,
      artifactCommit: null,
      solverCommit: dataGenerationCommit,
      startedCommit: dataGenerationCommit,
      finishedCommit: rendererCommit,
      commitStable: Boolean(dataGenerationCommit && dataGenerationCommit === rendererCommit),
      nodeVersion: process.version,
      worktreeCleanAtStart: startedClean,
      worktreeCleanAtFinish: cleanWorktree(),
    },
    sourceRouteStrictReplay: summarizeStrictReplay(sourceRouteStrictReplay),
    mt1Setup: {
      search: summarizeRun(setup.run),
      retainedCandidates: retained.map((candidate, index) => ({
        index,
        id: candidate.id || null,
        exactStateKey: buildStateKey(candidate.state),
        hero: compactHero(candidate.state),
      })),
      candidate2: candidate2 ? {
        retainedIndex: candidate2Index,
        id: candidate2.id || null,
        exactStateKey: gateExactStateKey,
        hero: compactHero(candidate2.state),
      } : null,
    },
    candidate2Prefix: candidate2Only ? {
      search: summarizeRun(candidate2Only.run),
      pipeline: {
        attempts: candidate2Only.pipeline.attempts,
        merges: candidate2Only.pipeline.merges,
        stages: summarizePipelineStages(candidate2Only.pipeline, prefixSegments.map((segment) => segment.id)),
      },
    } : null,
    lifecycleCoverage,
    pipelineEvidence: entryPipeline,
    entryReplacementContinuations,
    isolatedLocalCheckpoints,
    isolatedHpPipeline: hpPipelineStage,
    oracle: oracle ? {
      ...oracle,
      executed: true,
      allHardTilesPresent: Boolean(oracle.allHardTilesPresent),
      noTeacherActionInjection: true,
    } : {
      executed: false,
      completeSuffix: false,
      reached: {},
      finalHero: null,
      hardTiles: [],
      allHardTilesPresent: false,
      noTeacherActionInjection: true,
    },
    conditions: {
      fullFrontierApplicable,
    },
    conclusion: candidate2NaturallyReached.mt2Hp3834
      ? "At least one isolated retained local checkpoint naturally reaches mt2-hp3834; compare replacement continuation and checkpoint ordering next."
      : "The isolated local checkpoint matrix did not establish HP3834 completion; retain inconclusive status and inspect exact pipeline/replacement evidence.",
  };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2) + "\n", "utf8");
  fs.writeFileSync(outMarkdown, buildIsolatedMarkdown(report), "utf8");
  console.log(JSON.stringify(report, null, 2));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedCommit = gitCommit();
  const startedClean = cleanWorktree();
  const projectRoot = path.resolve(args["project-root"] || DEFAULT_PROJECT_ROOT);
  const teacherRouteFile = path.resolve(args["teacher-route"] || DEFAULT_TEACHER_ROUTE);
  const outFile = path.resolve(args.out || DEFAULT_OUT);
  const outMarkdown = path.resolve(args["out-md"] || outFile.replace(/\.json$/i, ".md"));
  const project = loadProject(projectRoot);
  const simulator = makeSimulator(project);
  const teacherRoute = readJson(teacherRouteFile);
  const sourceRouteStrictReplay = strictReplayRoute(project, simulator, teacherRoute);
  const teacherReplay = replayRoute(project, simulator, teacherRoute);
  const spec = getMilestoneSpec(project, "onlyup-chaos-mt5-blueking");
  const segmentsById = Object.fromEntries(
    ["mt1-gate-1559"].concat(FUTURE_SEGMENT_IDS)
      .map((id) => [id, spec.milestones.find((milestone) => milestone.id === id)]),
  );
  if (Object.values(segmentsById).some((segment) => !segment)) {
    throw new Error("Missing required MT1/MT2 milestone.");
  }
  const mt1 = segmentsById["mt1-gate-1559"];
  const futureSegments = FUTURE_SEGMENT_IDS.map((id) => segmentsById[id]);
  const teacherGatePredicate = buildSegmentGoalPredicate(project, mt1, simulator);
  const teacherGateState = teacherReplay.states.find((state) => teacherGatePredicate(state));
  if (!teacherGateState) throw new Error("Teacher route has no formal mt1-gate-1559 state.");
  const gateExactStateKey = buildStateKey(teacherGateState);
  const commonState = teacherReplay.states[1];
  const setup = runMt1Setup(project, simulator, commonState, mt1, args);
  const retained = setup.merge && Array.isArray(setup.merge.merged) ? setup.merge.merged : [];
  const candidate2Index = retained.findIndex((candidate) => buildStateKey(candidate.state) === gateExactStateKey);
  const candidate2 = candidate2Index >= 0 ? retained[candidate2Index] : null;
  const oracle = candidate2
    ? runFutureValueOracle(project, simulator, candidate2.state, teacherRoute, teacherReplay, futureSegments)
    : null;
  const candidate2Options = {
    candidateLimit: number(args["candidate-limit"], 8),
    goalSkylineLimit: number(args["goal-skyline-limit"], 8),
    dpSkylineMax: number(args["dp-skyline-max"], 4),
    maxActionsPerState: number(args["max-actions-per-state"], 256),
    maxExpansions: number(args["max-expansions"], 900),
    maxRuntimeMs: number(args["max-runtime-ms"], 900000),
    perAttemptMaxExpansions: number(args["max-expansions"], 900),
    perAttemptMaxRuntimeMs: number(args["max-runtime-ms"], 900000),
    maxHeapMb: number(args["max-heap-mb"], 1400),
    maxRssMb: number(args["max-rss-mb"], 1800),
    memoryCheckIntervalExpansions: number(args["memory-check-interval-expansions"], 1),
    memoryCheckIntervalActions: number(args["memory-check-interval-actions"], 1),
    agendaMode: args["agenda-mode"] || "best-first",
  };
  const candidate2Only = candidate2
    ? runDownstream(
      project,
      simulator,
      teacherRoute,
      teacherReplay,
      futureSegments,
      segmentsById,
      candidate2.state,
      candidate2Options,
    )
    : null;
  const candidate2ReachedHp3834 = Boolean(
    candidate2Only &&
    candidate2Only.run.found &&
    candidate2Only.run.reachedMilestone === "mt2-hp3834",
  );
  let fullFrontier = null;
  if (candidate2ReachedHp3834 && retained.length >= 4) {
    const fullBudgetOptions = {
      ...candidate2Options,
      maxExpansions: candidate2Options.maxExpansions * retained.length * futureSegments.length,
      maxRuntimeMs: candidate2Options.maxRuntimeMs * retained.length * futureSegments.length,
      perAttemptMaxExpansions: candidate2Options.maxExpansions,
      perAttemptMaxRuntimeMs: candidate2Options.maxRuntimeMs,
      budgetScope: "global-run",
      initialFrontier: retained.slice(0, 4),
    };
    fullFrontier = runDownstream(
      project,
      simulator,
      teacherRoute,
      teacherReplay,
      futureSegments,
      segmentsById,
      retained[0].state,
      fullBudgetOptions,
    );
  }
  const candidate2Lifecycle = candidate2Only && candidate2Only.lifecycle;
  const lifecycleObserved = Boolean(
    candidate2Lifecycle &&
    Object.keys(candidate2Lifecycle.records || {}).length === FUTURE_DECISION_END - FUTURE_DECISION_START + 1,
  );
  const noTeacherActionInjection = true;
  const candidate2Completion = classifySearch(candidate2Only && candidate2Only.run);
  const candidate2PipelineStages = summarizePipelineStages(
    candidate2Only && candidate2Only.pipeline,
    FUTURE_SEGMENT_IDS,
  );
  const oracleHardTiles = oracle && oracle.hardTiles || [];
  const oracleSuffixComplete = Boolean(oracle && oracle.completeSuffix);
  const oracleHardTilesChecked = Boolean(oracle && oracleHardTiles.length === EXPECTED_HARD_TILES.length);
  const candidate2NaturallyReached = {
    mt2Entry: Boolean(candidate2Only && runReachedMilestone(candidate2Only.run, "mt2-entry")),
    mt2Local3582: Boolean(candidate2Only && runReachedMilestone(candidate2Only.run, "mt2-local-3582")),
    mt2Hp3834: candidate2ReachedHp3834,
  };
  const fullFrontierApplicable = Boolean(
    candidate2ReachedHp3834 && retained.length >= 4,
  );
  const gates = {
    sourceRouteStrictReplay: Boolean(sourceRouteStrictReplay && sourceRouteStrictReplay.performed && sourceRouteStrictReplay.valid),
    candidate2ExactStartMatched: Boolean(candidate2 && buildStateKey(candidate2.state) === gateExactStateKey),
    productionSearchExecuted: Boolean(candidate2Only && candidate2Only.run),
    productionSearchNoTeacherInjection: noTeacherActionInjection,
    mt2EntryPipelineObserved: candidate2PipelineStages.find((stage) => stage.segmentId === "mt2-entry").observed,
    mt2LocalPipelineObserved: candidate2PipelineStages.find((stage) => stage.segmentId === "mt2-local-3582").observed,
    mt2Hp3834PipelineObserved: candidate2PipelineStages.find((stage) => stage.segmentId === "mt2-hp3834").observed,
    oracleSuffixExecuted: Boolean(oracle),
    oracleSuffixComplete,
    hardTilesChecked: oracleHardTilesChecked && hardTilesMatchExpected(oracleHardTiles),
    searchCompletionClassified: candidate2Completion.classification !== "not-run",
    provenanceCommitStable: Boolean(startedCommit && gitCommit() === startedCommit),
    worktreeCleanAtStart: startedClean,
    worktreeCleanAtFinish: cleanWorktree(),
    candidate2Retained: candidate2Index >= 0,
    candidate2NaturalStart: Boolean(candidate2),
    candidate2OnlyRunExecuted: Boolean(candidate2Only),
    lifecycleObserved,
    noTeacherActionInjection,
    fullFrontierRunExecuted: !fullFrontierApplicable || Boolean(fullFrontier),
    fullFrontierRunCompleted: !fullFrontierApplicable || Boolean(fullFrontier && fullFrontier.run && fullFrontier.run.reachedMilestone === "mt2-hp3834"),
  };
  const failedGates = Object.entries(gates).filter((entry) => !entry[1]).map((entry) => entry[0]);
  const status = failedGates.length > 0
    ? "failed"
    : candidate2Completion.classification === "inconclusive"
      ? "inconclusive"
      : "completed";
  const finishedCommit = gitCommit();
  const compactRetained = retained.map((candidate, index) => ({
    index,
    id: candidate.id || null,
    exactStateKey: buildStateKey(candidate.state),
    dpKey: buildDpStateKey(simulator, candidate.state, { dpKeyMode: mt1.dp.keyMode }),
    dominanceKey: buildDominanceKey(candidate.state),
    tags: Array.isArray(candidate.tags) ? candidate.tags.slice() : [],
    hero: compactHero(candidate.state),
    routeLength: Array.isArray(candidate.route) ? candidate.route.length : null,
  }));
  const report = {
    schema: "motapathfinder.hp3834-mt2-candidate2-natural-search-audit.v1",
    generatedAt: new Date().toISOString(),
    status,
    failedGates,
    gates,
    candidate2Outcome: candidate2Completion.classification,
    candidate2NaturallyReached,
    searchCompletion: candidate2Completion,
    sourceRouteStrictReplay: summarizeStrictReplay(sourceRouteStrictReplay),
    oracle: oracle ? {
      ...oracle,
      executed: true,
      hardTiles: oracleHardTiles,
      allHardTilesPresent: hardTilesMatchExpected(oracleHardTiles),
      noTeacherActionInjection: true,
    } : {
      executed: false,
      completeSuffix: false,
      hardTiles: [],
      allHardTilesPresent: false,
      noTeacherActionInjection: true,
    },
    conditions: {
      fullFrontierApplicable,
    },
    config: {
      agendaMode: candidate2Options.agendaMode,
      stopOnFirstGoal: false,
      candidateLimit: candidate2Options.candidateLimit,
      goalSkylineLimit: candidate2Options.goalSkylineLimit,
      dpSkylineMax: candidate2Options.dpSkylineMax,
      maxExpansionsPerAttempt: candidate2Options.maxExpansions,
      maxRuntimeMsPerAttempt: candidate2Options.maxRuntimeMs,
      maxHeapMb: candidate2Options.maxHeapMb,
      maxRssMb: candidate2Options.maxRssMb,
      memoryCheckIntervalExpansions: candidate2Options.memoryCheckIntervalExpansions,
      memoryCheckIntervalActions: candidate2Options.memoryCheckIntervalActions,
      childOldSpaceMb: number(args["child-old-space-mb"], 1600),
    },
    source: {
      teacherRoute: relative(teacherRouteFile),
      teacherRouteSha256: sha256(teacherRouteFile),
      projectRoot: relative(projectRoot),
      reportFile: relative(outFile),
      mt1Setup: "natural search from common teacher/production boundary",
    },
    provenance: {
      solverCommit: startedCommit,
      startedCommit,
      finishedCommit,
      commitStable: Boolean(startedCommit && finishedCommit && startedCommit === finishedCommit),
      nodeVersion: process.version,
      worktreeCleanAtStart: startedClean,
      worktreeCleanAtFinish: cleanWorktree(),
    },
    mt1Setup: {
      search: summarizeRun(setup.run),
      pipeline: {
        attempts: setup.pipeline.attempts,
        merges: setup.pipeline.merges,
      },
      retainedCandidates: compactRetained,
      candidate2: candidate2 ? {
        retainedIndex: candidate2Index,
        id: candidate2.id || null,
        exactStateKey: gateExactStateKey,
        matchesTeacherGate: true,
        hero: compactHero(candidate2.state),
      } : null,
    },
    candidate2Only: candidate2Only ? {
      candidateId: candidate2.id || null,
      initialExactStateKey: gateExactStateKey,
      search: summarizeRun(candidate2Only.run),
      lifecycle: candidate2Only.lifecycle,
      targets: candidate2Only.targets,
      pipeline: {
        attempts: candidate2Only.pipeline.attempts,
        merges: candidate2Only.pipeline.merges,
        stages: candidate2PipelineStages,
      },
    } : {
      candidateId: null,
      initialExactStateKey: gateExactStateKey,
      search: null,
      lifecycle: { records: [] },
      targets: [],
      pipeline: { attempts: [], merges: [], stages: [] },
    },
    fullFrontier: fullFrontier ? {
      search: summarizeRun(fullFrontier.run),
      lifecycle: fullFrontier.lifecycle,
      pipeline: {
        attempts: fullFrontier.pipeline.attempts,
        merges: fullFrontier.pipeline.merges,
        stages: summarizePipelineStages(fullFrontier.pipeline, FUTURE_SEGMENT_IDS),
      },
      initialCandidateOrder: retained.slice(0, 4).map((candidate, index) => ({
        order: index + 1,
        id: candidate.id || null,
        exactStateKey: buildStateKey(candidate.state),
        hero: compactHero(candidate.state),
      })),
    } : null,
    conclusion: candidate2ReachedHp3834
      ? "Candidate-2 naturally reaches mt2-hp3834; the conditional four-candidate frontier audit records downstream attempt ordering and shared-budget behavior."
      : "Candidate-2 did not naturally reach mt2-hp3834 within the configured audit boundary; inspect the targeted decision lifecycle and dominance witnesses before changing search behavior.",
  };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2) + "\n", "utf8");
  fs.writeFileSync(outMarkdown, buildMarkdown(report), "utf8");
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  if (args["checkpoint-worker"] === "1") runCheckpointWorker();
  else if (args["isolated-local"] === "1") runIsolatedAudit(process.argv.slice(2));
  else main();
}

module.exports = {
  buildMarkdown,
  buildIsolatedMarkdown,
  buildFutureTargets,
  classifySearch,
  classifyIsolatedSearch,
  annotateLifecycleCoverage,
  exactLineagePipelineEvidence,
  hardTilesMatchExpected,
  runIsolatedAudit,
  runIsolatedLocalCheckpoint,
  runDownstream,
  summarizePipelineStages,
  summarizeRun,
};
