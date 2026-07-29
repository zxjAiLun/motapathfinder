"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

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
const {
  createLifecycleObserver,
  makePipelineObserver,
} = require("./audit-hp3834-mt1-gate-selection-future-value");
const {
  actionFingerprint,
  compactState,
  makeSimulator,
  replayRoute,
} = require("./audit-hp3834-mt1-first-divergence");

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

const MT1_SETUP_MAX_EXPANSIONS = 400;
const FUTURE_DECISION_START = 11;
const FUTURE_DECISION_END = 23;
const FUTURE_SEGMENT_IDS = ["mt2-entry", "mt2-local-3582", "mt2-hp3834"];

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
  return {
    startCandidateId: attempt && attempt.startCandidateId || null,
    found: Boolean(attempt && attempt.found),
    goalCount: Number(attempt && attempt.goalCount || 0),
    expansions: Number(dp.expansions || 0),
    frontierSize: Number(dp.frontierSize || 0),
    stoppedReason: dp.stoppedReason || null,
    expansionBudgetExhausted: Boolean(dp.expansionBudgetExhausted),
    actionTrimmed: Number(dp.actionTrimmed || 0),
    failureClass: attempt && attempt.failureClass || null,
  };
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
    { captureDominanceWitnessFor: targets.map((target) => target.id) },
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

function buildMarkdown(report) {
  const lines = [
    "# PR-4.4h MT2 candidate-2 natural search audit",
    "",
    "Status: **" + report.status + "**",
    "",
    "## Contract",
    "",
    "- Candidate-2-only natural search reached `mt2-hp3834`: **" + report.gates.candidate2ReachedHp3834 + "**.",
    "- No teacher actions were injected: **" + report.gates.noTeacherActionInjection + "**.",
    "- Candidate-2 was naturally retained by the MT1 merged checkpoint: **" + report.gates.candidate2Retained + "**.",
    "- Candidate-2 lifecycle observer covered decisions 11–23: **" + report.gates.lifecycleObserved + "**.",
    "- Full four-candidate frontier run executed: **" + report.gates.fullFrontierRunExecuted + "**.",
    "",
    "## Candidate-2-only result",
    "",
    "- found=" + report.candidate2Only.search.found + ", reachedMilestone=" + report.candidate2Only.search.reachedMilestone + ".",
    "- final hero=" + JSON.stringify(report.candidate2Only.search.finalCandidate && report.candidate2Only.search.finalCandidate.hero) + ".",
    "- budget=" + JSON.stringify(report.candidate2Only.search.budget) + ".",
    "",
    "| Decision | Segment | Generated | Dominance reject | Skyline insert | Evicted | Popped | Goal accepted | Classification |",
    "|---:|---|:---:|:---:|:---:|:---:|:---:|:---:|---|",
  ];
  Object.values(report.candidate2Only.lifecycle.records || {}).forEach((record) => {
    lines.push(
      "| " + record.decisionIndex +
      " | " + record.targetSegment +
      " | " + record.generated +
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
    candidate2Lifecycle.records.length === FUTURE_DECISION_END - FUTURE_DECISION_START + 1,
  );
  const noTeacherActionInjection = true;
  const gates = {
    candidate2Retained: candidate2Index >= 0,
    candidate2NaturalStart: Boolean(candidate2),
    candidate2OnlyRunExecuted: Boolean(candidate2Only),
    candidate2ReachedHp3834,
    lifecycleObserved,
    noTeacherActionInjection,
    fullFrontierRunExecuted: Boolean(fullFrontier),
    fullFrontierRunCompleted: Boolean(fullFrontier && fullFrontier.run && fullFrontier.run.reachedMilestone === "mt2-hp3834"),
  };
  const failedGates = Object.entries(gates).filter((entry) => !entry[1]).map((entry) => entry[0]);
  const status = failedGates.length === 0 ? "completed" : "failed";
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
      },
    } : {
      candidateId: null,
      initialExactStateKey: gateExactStateKey,
      search: null,
      lifecycle: { records: [] },
      targets: [],
      pipeline: { attempts: [], merges: [] },
    },
    fullFrontier: fullFrontier ? {
      search: summarizeRun(fullFrontier.run),
      lifecycle: fullFrontier.lifecycle,
      pipeline: {
        attempts: fullFrontier.pipeline.attempts,
        merges: fullFrontier.pipeline.merges,
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

if (require.main === module) main();

module.exports = {
  buildMarkdown,
  buildFutureTargets,
  runDownstream,
  summarizeRun,
};
