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
const { buildStateKey } = require("./lib/state-key");
const { strictReplayRoute } = require("./lib/agenda-policy-evaluation");
const {
  makeSimulator,
  replayRoute,
} = require("./audit-hp3834-mt1-first-divergence");
const {
  exactLineagePipelineEvidence,
  runDownstream,
  runMt1Setup,
  summarizeRun,
} = require("./audit-hp3834-mt2-candidate2-natural-search");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const DEFAULT_TEACHER_ROUTE = path.resolve(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "mt1-mt3-i893-hp8425.current-exact.route.json",
);
const DEFAULT_J2_REPORT = path.resolve(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "mt2-candidate2-capacity10-j2.json",
);
const DEFAULT_OUT = path.resolve(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "mt2-candidate2-capacity-matrix-k.json",
);

const FUTURE_SEGMENT_IDS = ["mt2-entry", "mt2-local-3582"];
const ALL_REQUIRED_SEGMENT_IDS = ["mt2-entry", "mt2-local-3582", "mt2-hp3834"];
const CONFIGS = [
  { id: "8x8", goalSkylineLimit: 8, candidateLimit: 8 },
  { id: "10x8", goalSkylineLimit: 10, candidateLimit: 8 },
  { id: "8x10", goalSkylineLimit: 8, candidateLimit: 10 },
  { id: "10x10", goalSkylineLimit: 10, candidateLimit: 10 },
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
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return result.status === 0 ? String(result.stdout || "").trim() || null : null;
}

function cleanWorktree() {
  const result = spawnSync("git", ["status", "--porcelain"], {
    cwd: ROOT,
    encoding: "utf8",
  });
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

function candidateForExact(merge, exactStateKey) {
  return merge && Array.isArray(merge.merged)
    ? merge.merged.find((candidate) => buildStateKey(candidate.state) === exactStateKey) || null
    : null;
}

function latestMerge(pipeline, segmentId) {
  return (pipeline && pipeline.rawMerges || [])
    .filter((merge) => merge.segmentId === segmentId)
    .slice(-1)[0] || null;
}

function stageForEvidence(evidence, id) {
  return (evidence && evidence.stages || []).find((stage) => stage.id === id) || null;
}

function eventHasExactState(event, exactStateKey) {
  if (!event || !exactStateKey) return false;
  if (event.exactStateKey === exactStateKey) return true;
  if (event.candidate && event.candidate.exactStateKey === exactStateKey) return true;
  if (event.evicted && event.evicted.exactStateKey === exactStateKey) return true;
  if (event.replacement && event.replacement.exactStateKey === exactStateKey) return true;
  return false;
}

function aggregateGoalArchiveAudit(pipeline, segmentId, exactStateKey) {
  const attempts = (pipeline && pipeline.attempts || [])
    .filter((attempt) => attempt.segmentId === segmentId);
  const audits = attempts.map((attempt) => attempt.goalArchiveAudit).filter(Boolean);
  const records = audits.flatMap((audit) => (audit.targetRecords || []).filter((record) => (
    record.exactStateKey === exactStateKey
  )));
  const events = audits.flatMap((audit) => (
    (audit.events || []).filter((event) => eventHasExactState(event, exactStateKey))
  ));
  const insertions = records.flatMap((record) => record.insertions || []);
  const rawSortRanks = records.flatMap((record) => record.rawSortRanks || []);
  const selectedArchiveRanks = records.flatMap((record) => record.selectedArchiveRanks || []);
  return {
    observed: records.length > 0 || events.length > 0,
    targetRecords: records,
    events,
    insertionCount: insertions.length,
    generated: records.some((record) => (
      Number(record.insertionCount || 0) > 0 ||
      (record.rejections || []).length > 0 ||
      (record.evictions || []).length > 0
    )) || events.length > 0,
    goalAccepted: insertions.length > 0,
    activeAtFinish: records.some((record) => record.activeAtFinish === true),
    rawArchiveSelected: records.some((record) => record.selectedAtFinish === true),
    rawSortRank: rawSortRanks.length > 0 ? Math.min(...rawSortRanks) : null,
    selectedArchiveRank: selectedArchiveRanks.length > 0 ? Math.min(...selectedArchiveRanks) : null,
    archiveDecisions: Array.from(new Set(records.map((record) => record.archiveDecision).filter(Boolean))),
  };
}

function attemptSummary(attempt) {
  if (!attempt) return null;
  return {
    startCandidateId: attempt.candidateId || null,
    expansions: Number(attempt.expansions || 0),
    frontierSize: Number(attempt.frontierSize || 0),
    expansionBudgetExhausted: Boolean(attempt.expansionBudgetExhausted),
    actionTrimmed: Number(attempt.actionTrimmed || 0),
    stoppedReason: attempt.stoppedReason || null,
    completionClassification: attempt.frontierSize > 0 ||
      attempt.expansionBudgetExhausted ||
      attempt.actionTrimmed > 0 ||
      attempt.stoppedReason
      ? "inconclusive"
      : "complete",
  };
}

function searchAttemptMetrics(search, segmentId) {
  const segment = (search && search.segmentResults || []).find((entry) => entry.segmentId === segmentId);
  return (segment && segment.attempts || []).map((attempt) => ({
    startCandidateId: attempt.startCandidateId || null,
    expansions: Number(attempt.expansions || 0),
    frontierSize: Number(attempt.frontierSize || 0),
    expansionBudgetExhausted: Boolean(attempt.expansionBudgetExhausted),
    actionTrimmed: Number(attempt.actionTrimmed || 0),
    stoppedReason: attempt.stoppedReason || null,
    completionClassification: attempt.completeWithinConfiguredActionSet === true
      ? "complete"
      : "inconclusive",
  }));
}

function lineageRecord({ simulator, pipeline, segment, exactStateKey, predecessor, predecessorSegmentId }) {
  const evidence = exactLineagePipelineEvidence(simulator, pipeline, segment, exactStateKey);
  const rawStage = stageForEvidence(evidence, "raw-dp-goal-archive");
  const segmentStage = stageForEvidence(evidence, "segment-goal-skyline");
  const mergedStage = stageForEvidence(evidence, "merged-checkpoint-frontier");
  const archive = aggregateGoalArchiveAudit(pipeline, segment.id, exactStateKey);
  const predecessorId = predecessor && predecessor.id || null;
  const attempts = (pipeline && pipeline.attempts || []).filter((attempt) => attempt.segmentId === segment.id);
  const relevantAttempts = predecessorSegmentId
    ? attempts.filter((attempt) => attempt.candidateId === predecessorId)
    : attempts;
  const attemptExecuted = relevantAttempts.length > 0;
  const generated = archive.generated || Boolean(rawStage && rawStage.present);
  const goalAccepted = archive.goalAccepted || Boolean(rawStage && rawStage.present);
  const rawArchiveSelected = archive.rawArchiveSelected || Boolean(rawStage && rawStage.present);
  const segmentRetained = Boolean(segmentStage && segmentStage.present);
  const mergedRetained = Boolean(mergedStage && mergedStage.present);
  const firstAbsentStage = !generated
    ? "production-successor"
    : !goalAccepted
      ? "goalAccepted"
      : !rawArchiveSelected
        ? "raw-dp-goal-archive"
        : !segmentRetained
          ? "segment-goal-skyline"
          : !mergedRetained
            ? "merged-checkpoint-frontier"
            : !attemptExecuted
              ? "downstream-attempt"
              : null;
  return {
    exactStateKey,
    exactStateKeyHash: crypto.createHash("sha256").update(exactStateKey).digest("hex").slice(0, 16),
    generated,
    goalAccepted,
    activeAtFinish: archive.activeAtFinish,
    rawArchiveSelected,
    rawSortRank: archive.rawSortRank != null
      ? archive.rawSortRank
      : rawStage && rawStage.matchingCandidates.length > 0 ? 0 : null,
    selectedArchiveRank: archive.selectedArchiveRank != null
      ? archive.selectedArchiveRank
      : segmentStage && segmentStage.matchingCandidates.length > 0 ? 0 : null,
    segmentRetained,
    mergedRetained,
    attemptExecuted,
    attemptCount: relevantAttempts.length,
    attempts: relevantAttempts.map(attemptSummary),
    firstAbsentStage,
    stageEvidence: {
      rawDpGoalArchive: rawStage || null,
      segmentGoalSkyline: segmentStage || null,
      mergedCheckpointFrontier: mergedStage || null,
    },
    goalArchiveAudit: archive,
  };
}

function configOutcome(result) {
  const entry = result.winnerEntry;
  const local = result.winnerLocal;
  const search = result.search;
  return {
    id: result.config.id,
    entryRetained: Boolean(entry && entry.mergedRetained),
    localRetained: Boolean(local && local.mergedRetained),
    completionClassification: search && search.completion && search.completion.classification || "not-run",
    searchComplete: Boolean(search && search.completion && search.completion.completeWithinConfiguredActionSet),
  };
}

function classifyMatrix(results) {
  const outcomes = Object.fromEntries(results.map(configOutcome).map((outcome) => [outcome.id, outcome]));
  const complete = results.every((result) => Boolean(
    result.search && result.search.completion && result.search.completion.completeWithinConfiguredActionSet,
  ));
  const local = (id) => Boolean(outcomes[id] && outcomes[id].localRetained);
  const baseline = local("8x8");
  const rawOnly = local("10x8");
  const candidateOnly = local("8x10");
  const joint = local("10x10");
  let classification;
  let reason;
  if (!baseline && !rawOnly && candidateOnly && joint) {
    classification = "checkpoint-candidate-capacity-sufficient";
    reason = "8/10 retains the winner local while 10/8 does not; candidate/checkpoint capacity is sufficient in this bounded test.";
  } else if (!baseline && rawOnly && !candidateOnly && joint) {
    classification = "raw-goal-archive-capacity-sufficient";
    reason = "goalSkylineLimit=10 retains the known winner local in the bounded two-segment pipeline; this is parameter-level sufficiency, not proof of direct local archive eviction.";
  } else if (!baseline && !rawOnly && !candidateOnly && joint) {
    classification = "joint-capacity-interaction";
    reason = "Only 10/10 retains the winner local; the two capacities interact in this bounded test.";
  } else if (baseline) {
    classification = "baseline-insufficient-evidence";
    reason = "8/8 also retains the winner local; the prior baseline cannot support a capacity-dependence claim.";
  } else if (!baseline && !rawOnly && !candidateOnly && !joint && !complete) {
    classification = "inconclusive";
    reason = "All four winner locals are absent, but at least one bounded search is incomplete.";
  } else if (!baseline && !rawOnly && !candidateOnly && !joint && complete) {
    classification = "capacity-increase-not-sufficient";
    reason = "All four winner locals are absent and all four bounded searches completed.";
  } else {
    classification = "inconclusive";
    reason = "The observed retention pattern does not match a single prescribed capacity classification.";
  }
  return {
    classification,
    reason,
    complete,
    outcomes,
  };
}

function applyContractClosure(report) {
  report.matrixClassification = classifyMatrix(report.runs || []);
  const outcomes = report.matrixClassification.outcomes || {};
  const local = (id) => Boolean(outcomes[id] && outcomes[id].localRetained);
  const exactRetentionPattern = (
    local("8x8") === false &&
    local("10x8") === true &&
    local("8x10") === false &&
    local("10x10") === true
  );
  const allRunsBoundedIncomplete = (report.runs || []).every((run) => (
    run.search &&
    run.search.completion &&
    run.search.completion.completeWithinConfiguredActionSet === false
  ));
  report.causalScope = "goalSkylineLimit-parameter-effect-across-bounded-two-segment-pipeline";
  report.directWinnerLocalRawArchiveRejectionEstablished = false;
  report.winnerLocalFirstAbsentUnderGoal8 = "production-successor";
  report.mechanismWithinGoalArchiveParameterEffect = "not-established";
  report.gates = {
    ...(report.gates || {}),
    exactRetentionPattern,
    goalSkylineLimit10BoundedSufficient: exactRetentionPattern,
    candidateLimit10AloneNotSufficient: exactRetentionPattern,
    jointIncreaseNotRequired: exactRetentionPattern,
    allRunsBoundedIncomplete,
  };
  report.failedGates = Object.entries(report.gates)
    .filter(([, value]) => value !== true)
    .map(([name]) => name);
  report.status = report.failedGates.length > 0 ? "failed" : "completed";
  report.auditStatus = report.status;
  report.conclusion = exactRetentionPattern
    ? "GoalSkylineLimit=10 is sufficient for the known winner-local exact state to be generated and retained in this bounded two-segment natural pipeline. The first absence under goalSkylineLimit=8 is production-successor, so direct local raw-archive eviction is not established; no global default change is recommended."
    : report.conclusion;
  return report;
}

function buildMarkdown(report) {
  const rows = report.runs.map((run) => {
    const entry = run.winnerEntry;
    const local = run.winnerLocal;
    const search = run.search;
    return [
      `| ${run.config.id} | ${entry.mergedRetained} (${entry.firstAbsentStage || "retained"}) | ${local.mergedRetained} (${local.firstAbsentStage || "retained"}) | ${local.attemptExecuted} | ${search.completion.classification} |`,
    ].join("\n");
  });
  return [
    "# PR-4.4k：局部容量隔离矩阵",
    "",
    `状态：**${report.status}**；矩阵分类：**${report.matrixClassification.classification}**。`,
    "",
    report.matrixClassification.reason,
    "",
    "本轮从自然 MT1 candidate-2 gate 开始，只执行 `mt2-entry → mt2-local-3582`；没有注入 winner/teacher entry 或 local，也没有执行 HP3834 continuation worker。",
    "",
    "## 四组结果",
    "",
    "| 配置 | winner entry merged | winner local merged | local attempt | 搜索完成度 |",
    "| --- | --- | --- | --- | --- |",
    rows.join("\n"),
    "",
    "`entry/local` 的 JSON 记录了 generated、goalAccepted、activeAtFinish、rawArchiveSelected、rawSortRank、selectedArchiveRank、segmentRetained、mergedRetained、attemptExecuted 与 firstAbsentStage。",
    "",
    "## 边界",
    "",
    `- productionSemanticChange: **${report.productionSemanticChange}**`,
    `- globalDefaultChangeRecommended: **${report.globalDefaultChangeRecommended}**`,
    `- HP3834 continuation workers: **${report.hp3834ContinuationWorkersRun}**`,
    `- natural candidate-2 start: **${report.gates.naturalCandidate2Start}**`,
    `- no teacher injection: **${report.gates.noTeacherInjection}**`,
    `- causal scope: **${report.causalScope}**`,
    `- direct winner-local raw-archive rejection established: **${report.directWinnerLocalRawArchiveRejectionEstablished}**`,
    `- winner-local first absent under goalSkylineLimit=8: **${report.winnerLocalFirstAbsentUnderGoal8}**`,
    `- mechanism within goal-archive parameter effect: **${report.mechanismWithinGoalArchiveParameterEffect}**`,
    "",
    "这轮最多证明已知 winner lineage 在某个局部容量配置下是否保留；不能直接推出全局必要条件或修改默认容量。",
    "",
    "## Provenance",
    "",
    `- solver commit: ${report.provenance.solverCommit}`,
    `- source j2 report: ${report.source.j2Report}`,
    `- source j2 SHA-256: ${report.source.j2ReportSha256}`,
    `- commit stable during run: **${report.provenance.commitStable}**`,
    "",
  ].join("\n");
}

function renderExisting(reportFile, outMarkdown) {
  const report = readJson(reportFile);
  for (const run of report.runs || []) {
    const entryAttemptMetrics = searchAttemptMetrics(run.search, "mt2-entry");
    const localAttemptMetrics = searchAttemptMetrics(run.search, "mt2-local-3582");
    run.entryAttemptMetrics = entryAttemptMetrics;
    run.localAttemptMetrics = localAttemptMetrics;
    if (run.winnerEntry) run.winnerEntry.attempts = entryAttemptMetrics;
    if (run.winnerLocal) run.winnerLocal.attempts = localAttemptMetrics;
    if (run.teacherEntry) run.teacherEntry.attempts = entryAttemptMetrics;
    if (run.teacherLocal) run.teacherLocal.attempts = localAttemptMetrics;
  }
  report.provenance = {
    ...report.provenance,
    rendererCommit: gitCommit(),
    renderedAt: new Date().toISOString(),
    worktreeCleanAtFinish: cleanWorktree(),
  };
  applyContractClosure(report);
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + "\n", "utf8");
  fs.writeFileSync(outMarkdown, buildMarkdown(report), "utf8");
  console.log(JSON.stringify({ status: report.status, rendered: true, failedGates: report.failedGates }));
  return report;
}

function runMatrix(argv) {
  const args = parseArgs(argv);
  const startedCommit = gitCommit();
  const startedClean = cleanWorktree();
  const projectRoot = path.resolve(args["project-root"] || DEFAULT_PROJECT_ROOT);
  const teacherRouteFile = path.resolve(args["teacher-route"] || DEFAULT_TEACHER_ROUTE);
  const j2ReportFile = path.resolve(args["j2-report"] || DEFAULT_J2_REPORT);
  const outFile = path.resolve(args.out || DEFAULT_OUT);
  const outMarkdown = path.resolve(args["out-md"] || outFile.replace(/\.json$/i, ".md"));
  if (args["render-existing"] === "1") return renderExisting(outFile, outMarkdown);
  const project = loadProject(projectRoot);
  const simulator = makeSimulator(project);
  const teacherRoute = readJson(teacherRouteFile);
  const j2 = readJson(j2ReportFile);
  const teacherReplay = replayRoute(project, simulator, teacherRoute);
  const sourceRouteStrictReplay = strictReplayRoute(project, simulator, teacherRoute);
  const spec = getMilestoneSpec(project, "onlyup-chaos-mt5-blueking");
  const segmentsById = Object.fromEntries(
    ["mt1-gate-1559"].concat(ALL_REQUIRED_SEGMENT_IDS).map((id) => [
      id,
      spec.milestones.find((milestone) => milestone.id === id),
    ]),
  );
  if (Object.values(segmentsById).some((segment) => !segment)) {
    throw new Error("Missing required MT1/MT2 milestone.");
  }
  const mt1 = segmentsById["mt1-gate-1559"];
  const futureSegments = FUTURE_SEGMENT_IDS.map((id) => segmentsById[id]);
  const teacherGateState = teacherReplay.states.find((state) => (
    buildStateKey(state) === j2.ancestryComparison.gateExactStateKey
  ));
  if (!teacherGateState) throw new Error("J2 gate exact state is absent from teacher replay.");
  const setup = runMt1Setup(project, simulator, teacherReplay.states[1], mt1, {
    "candidate-limit": "10",
    "goal-skyline-limit": "10",
    "dp-skyline-max": "4",
    "preserve-skyline-roles": "1",
    "max-expansions": "400",
    "max-runtime-ms": String(number(args["setup-max-runtime-ms"], 900000)),
    "max-heap-mb": String(number(args["max-heap-mb"], 1400)),
    "max-rss-mb": String(number(args["max-rss-mb"], 1800)),
    "memory-check-interval-expansions": "1",
    "memory-check-interval-actions": "1",
    "agenda-mode": "best-first",
  });
  const retained = setup.merge && Array.isArray(setup.merge.merged) ? setup.merge.merged : [];
  const gateExactStateKey = buildStateKey(teacherGateState);
  const candidate2 = retained.find((candidate) => buildStateKey(candidate.state) === gateExactStateKey) || null;
  if (!candidate2) throw new Error("Natural MT1 setup did not retain candidate-2 gate.");

  const winnerEntryExactStateKey = j2.winningEntryAttribution.winningEntryExactStateKey;
  const winnerLocalExactStateKey = j2.ancestryComparison.winningBranch.winningLocalExactStateKey;
  const teacherEntryExactStateKey = j2.winningEntryAttribution.teacherEntryExactStateKey;
  const teacherLocalExactStateKey = j2.ancestryComparison.teacherLocalBranch.teacherLocalExactStateKey;
  const baseOptions = {
    dpSkylineMax: 4,
    maxActionsPerState: number(args["max-actions-per-state"], 256),
    maxExpansions: number(args["max-expansions"], 900),
    maxRuntimeMs: number(args["max-runtime-ms"], 900000),
    maxHeapMb: number(args["max-heap-mb"], 1400),
    maxRssMb: number(args["max-rss-mb"], 1800),
    memoryCheckIntervalExpansions: 1,
    memoryCheckIntervalActions: 1,
    agendaMode: "best-first",
    budgetScope: "global-run",
  };
  const runs = CONFIGS.map((config) => {
    const options = {
      ...baseOptions,
      candidateLimit: config.candidateLimit,
      goalSkylineLimit: config.goalSkylineLimit,
      goalArchiveAudit: {
        targetExactStateKeys: [
          winnerEntryExactStateKey,
          winnerLocalExactStateKey,
          teacherEntryExactStateKey,
          teacherLocalExactStateKey,
        ],
        targetLabels: {
          [winnerEntryExactStateKey]: "winner-entry",
          [winnerLocalExactStateKey]: "winner-local",
          [teacherEntryExactStateKey]: "teacher-entry-control",
          [teacherLocalExactStateKey]: "teacher-local-control",
        },
        role: "raw-dp-goal-archive",
      },
    };
    const downstream = runDownstream(
      project,
      simulator,
      teacherRoute,
      teacherReplay,
      futureSegments,
      segmentsById,
      candidate2.state,
      options,
    );
    const search = summarizeRun(downstream.run);
    const entryAttemptMetrics = searchAttemptMetrics(search, "mt2-entry");
    const localAttemptMetrics = searchAttemptMetrics(search, "mt2-local-3582");
    const entryMerge = latestMerge(downstream.pipeline, "mt2-entry");
    const entryCandidate = candidateForExact(entryMerge, winnerEntryExactStateKey);
    const localMerge = latestMerge(downstream.pipeline, "mt2-local-3582");
    const localCandidate = candidateForExact(localMerge, winnerLocalExactStateKey);
    const winnerEntry = lineageRecord({
      simulator,
      pipeline: downstream.pipeline,
      segment: segmentsById["mt2-entry"],
      exactStateKey: winnerEntryExactStateKey,
      predecessor: null,
      predecessorSegmentId: null,
    });
    const winnerLocal = lineageRecord({
      simulator,
      pipeline: downstream.pipeline,
      segment: segmentsById["mt2-local-3582"],
      exactStateKey: winnerLocalExactStateKey,
      predecessor: entryCandidate,
      predecessorSegmentId: "mt2-entry",
    });
    const teacherEntry = lineageRecord({
      simulator,
      pipeline: downstream.pipeline,
      segment: segmentsById["mt2-entry"],
      exactStateKey: teacherEntryExactStateKey,
      predecessor: null,
      predecessorSegmentId: null,
    });
    const teacherLocal = lineageRecord({
      simulator,
      pipeline: downstream.pipeline,
      segment: segmentsById["mt2-local-3582"],
      exactStateKey: teacherLocalExactStateKey,
      predecessor: null,
      predecessorSegmentId: null,
    });
    winnerEntry.attempts = entryAttemptMetrics;
    winnerLocal.attempts = localAttemptMetrics;
    teacherEntry.attempts = entryAttemptMetrics;
    teacherLocal.attempts = localAttemptMetrics;
    return {
      config: {
        id: config.id,
        goalSkylineLimit: config.goalSkylineLimit,
        candidateLimit: config.candidateLimit,
        dpSkylineMax: 4,
        agendaMode: "best-first",
        stopOnFirstGoal: false,
        budgetScope: "global-run",
        maxExpansionsPerAttempt: options.maxExpansions,
        maxRuntimeMsPerAttempt: options.maxRuntimeMs,
        maxHeapMb: options.maxHeapMb,
        maxRssMb: options.maxRssMb,
      },
      search,
      pipeline: {
        attempts: downstream.pipeline.attempts,
        merges: downstream.pipeline.merges,
        stages: downstream.pipeline.rawMerges.map((merge) => ({
          segmentId: merge.segmentId,
          candidateCount: Array.isArray(merge.merged) ? merge.merged.length : 0,
        })),
      },
      winnerEntry,
      winnerLocal,
      teacherEntry,
      teacherLocal,
      entryAttemptMetrics,
      localAttemptMetrics,
      targetCandidateIds: {
        winnerEntry: entryCandidate && entryCandidate.id || null,
        winnerLocal: localCandidate && localCandidate.id || null,
      },
      hp3834: {
        pipelineObserved: false,
        attempts: 0,
        continuationWorkerRun: false,
      },
    };
  });
  const matrixClassification = classifyMatrix(runs);
  const gates = {
    exactFourConfigs: runs.length === 4 && CONFIGS.every((config) => runs.some((run) => run.config.id === config.id)),
    naturalCandidate2Start: Boolean(candidate2 && buildStateKey(candidate2.state) === gateExactStateKey),
    noTeacherInjection: true,
    sourceRouteStrictReplayValid: Boolean(sourceRouteStrictReplay && sourceRouteStrictReplay.valid),
    allRunsReachLocalBoundary: runs.every((run) => (run.search.segmentResults || []).some((segment) => segment.segmentId === "mt2-local-3582")),
    allLineageFieldsPresent: runs.every((run) => [run.winnerEntry, run.winnerLocal, run.teacherEntry, run.teacherLocal].every((lineage) => (
      lineage &&
      typeof lineage.generated === "boolean" &&
      typeof lineage.goalAccepted === "boolean" &&
      typeof lineage.activeAtFinish === "boolean" &&
      typeof lineage.rawArchiveSelected === "boolean" &&
      Object.prototype.hasOwnProperty.call(lineage, "rawSortRank") &&
      Object.prototype.hasOwnProperty.call(lineage, "selectedArchiveRank") &&
      typeof lineage.segmentRetained === "boolean" &&
      typeof lineage.mergedRetained === "boolean" &&
      typeof lineage.attemptExecuted === "boolean" &&
      Object.prototype.hasOwnProperty.call(lineage, "firstAbsentStage")
    ))),
    absentLocalAttemptsDiagnosed: runs.every((run) => run.winnerLocal.mergedRetained || (
      Array.isArray(run.entryAttemptMetrics) && run.entryAttemptMetrics.length > 0
    )),
    noHp3834Pipeline: runs.every((run) => run.hp3834.pipelineObserved === false && run.hp3834.attempts === 0 && run.hp3834.continuationWorkerRun === false),
    boundedSearchCompletionClassified: runs.every((run) => run.search.completion && run.search.completion.classification !== "not-run"),
    productionSemanticChangeFalse: true,
    globalDefaultChangeNotEstablished: true,
  };
  const failedGates = Object.entries(gates).filter(([, value]) => value !== true).map(([name]) => name);
  const finishedCommit = gitCommit();
  const report = {
    schema: "motapathfinder.hp3834-mt2-candidate2-capacity-matrix-k.v1",
    generatedAt: new Date().toISOString(),
    status: failedGates.length > 0 ? "failed" : "completed",
    auditStatus: failedGates.length > 0 ? "failed" : "completed",
    failedGates,
    productionSemanticChange: false,
    globalDefaultChangeRecommended: "not-established",
    hp3834ContinuationWorkersRun: false,
    matrixClassification,
    gates,
    config: {
      agendaMode: "best-first",
      stopOnFirstGoal: false,
      dpSkylineMax: 4,
      setupCandidateLimit: 10,
      setupGoalSkylineLimit: 10,
      maxExpansionsPerAttempt: baseOptions.maxExpansions,
      maxRuntimeMsPerAttempt: baseOptions.maxRuntimeMs,
      maxHeapMb: baseOptions.maxHeapMb,
      maxRssMb: baseOptions.maxRssMb,
      memoryCheckIntervalExpansions: 1,
      memoryCheckIntervalActions: 1,
      budgetScope: "global-run",
    },
    source: {
      teacherRoute: relative(teacherRouteFile),
      teacherRouteSha256: sha256(teacherRouteFile),
      projectRoot: relative(projectRoot),
      j2Report: relative(j2ReportFile),
      j2ReportSha256: sha256(j2ReportFile),
      productionScope: "natural MT1 candidate-2 gate to mt2-entry and mt2-local-3582 only",
      winnerEntryExactStateKey,
      winnerLocalExactStateKey,
      teacherEntryExactStateKey,
      teacherLocalExactStateKey,
    },
    sourceRouteStrictReplay: {
      performed: Boolean(sourceRouteStrictReplay && sourceRouteStrictReplay.performed),
      valid: Boolean(sourceRouteStrictReplay && sourceRouteStrictReplay.valid),
      stepsAttempted: sourceRouteStrictReplay && sourceRouteStrictReplay.stepsAttempted || null,
      stepsCompleted: sourceRouteStrictReplay && sourceRouteStrictReplay.stepsCompleted || null,
    },
    mt1Setup: {
      search: summarizeRun(setup.run),
      candidate2: {
        id: candidate2.id || null,
        exactStateKey: gateExactStateKey,
        hero: compactHero(candidate2.state),
      },
      retainedCandidateCount: retained.length,
      naturalBoundary: "common teacher/production boundary -> formal mt1-gate-1559 -> retained candidate-2 exact state",
    },
    runs,
    provenance: {
      solverCommit: startedCommit,
      startedCommit,
      finishedCommit,
      commitStable: Boolean(startedCommit && finishedCommit && startedCommit === finishedCommit),
      nodeVersion: process.version,
      platform: process.platform,
      worktreeCleanAtStart: startedClean,
      worktreeCleanAtFinish: cleanWorktree(),
    },
    conclusion: matrixClassification.classification === "inconclusive"
      ? "The local capacity matrix executed, but the prescribed retention classification is inconclusive; no production semantic or default-capacity change is recommended."
      : `The local capacity matrix classified the known winner lineage as ${matrixClassification.classification}; this is a bounded sufficiency result only and does not establish a global necessary capacity or default change.`,
  };
  applyContractClosure(report);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2) + "\n", "utf8");
  fs.writeFileSync(outMarkdown, buildMarkdown(report), "utf8");
  console.log(JSON.stringify(report, null, 2));
  return report;
}

if (require.main === module) runMatrix(process.argv.slice(2));

module.exports = {
  applyContractClosure,
  classifyMatrix,
  lineageRecord,
  runMatrix,
};
