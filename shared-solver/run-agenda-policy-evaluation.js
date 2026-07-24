"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { loadProject } = require("./lib/project-loader");
const { StaticSimulator } = require("./lib/simulator");

const {
  aggregateLedgerCosts,
  aggregateRepeats,
  aggregateSegmentReport,
  buildSegmentRegressionFromBaseline,
  buildBudgetPlan,
  buildRegressionFromBaseline,
  buildSegmentedChildArgs,
  getPolicyMatrix,
  range,
  strictReplayRoute,
} = require("./lib/agenda-policy-evaluation");

const DEFAULT_PROJECT_ROOT = path.resolve(
  __dirname,
  "..",
  "Only upV2.1",
  "Only upV2.1",
);
const DEFAULT_MT7_ROUTE = path.join(
  __dirname,
  "routes",
  "latest",
  "adaptive-mt7-left-sword.route.json",
);

function parseArgs(argv) {
  return argv.reduce((result, arg) => {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) result[match[1]] = match[2];
    return result;
  }, {});
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseList(value, fallback) {
  if (value == null || value === "") return fallback;
  return String(value)
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item) && item > 0);
}

function parseBoolean(value, fallback) {
  if (value == null) return fallback;
  if (["1", "true", "on"].includes(String(value).toLowerCase())) return true;
  if (["0", "false", "off"].includes(String(value).toLowerCase())) return false;
  return fallback;
}

function resolvePath(value, fallback) {
  if (value == null || value === "") return fallback;
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}

function safeFilePart(value) {
  return String(value || "run").replace(/[^A-Za-z0-9_.-]+/g, "_");
}

function readGitCommit() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: __dirname,
    encoding: "utf8",
    windowsHide: true,
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function readJsonResult(filePath) {
  if (!fs.existsSync(filePath)) {
    return { exists: false, valid: false, value: null, error: "file-missing" };
  }
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {
        exists: true,
        valid: false,
        value: null,
        error: "report-not-object",
      };
    }
    return {
      exists: true,
      valid: true,
      value,
      error: null,
    };
  } catch (error) {
    return {
      exists: true,
      valid: false,
      value: null,
      error: String(error.message || error),
    };
  }
}

function makeReplayContext(projectRoot) {
  const project = loadProject(projectRoot);
  const simulator = new StaticSimulator(project, {
    stopFloorId: "MT6",
    battleResolver: new FunctionBackedBattleResolver(project),
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFightToLevelUp: false,
    enableResourcePocket: false,
    enableResourceCluster: false,
    enableResourceChain: false,
    searchGraphMode: "primitive",
  });
  return { project, simulator };
}

function buildSearchConfig(config, policy, budgetPlan, report) {
  const attempts = (report && report.segmentResults || [])
    .flatMap((segment) => segment.attempts || [])
    .map((attempt) => (attempt.diagnostics && attempt.diagnostics.dp) || {})
    .filter(Boolean);
  const first = attempts[0] || {};
  return {
    agendaMode: policy.agendaMode,
    fairnessEvery: policy.fairnessEvery,
    priorityMode: first.priorityMode || null,
    keyMode: first.keyMode || config.dpKeyMode || "segment-default",
    dpSkylineMax: number(config.dpSkylineMax, 4),
    maxExpansions: budgetPlan.maxExpansions,
    maxRuntimeMs: budgetPlan.maxRuntimeMs,
    maxActionsPerState: number(config.maxActionsPerState, 256),
    maxHeapMb: first.maxHeapMb || null,
    actionProviderMode: first.actionProviderMode || null,
    budgetScope: config.budgetScope || "per-attempt",
    budgetKind: budgetPlan.kind,
    budgetValue: budgetPlan.value,
  };
}

function applyLedgerBackedMetrics(aggregate, ledgerCosts) {
  if (!ledgerCosts) {
    return {
      metrics: aggregate.metrics,
      segmentMetrics: aggregate.segments,
    };
  }
  const metrics = {
    ...aggregate.metrics,
    expansions: ledgerCosts.totalExpansions,
    wallMs: ledgerCosts.totalWallMs,
    expansionsToFinalRequestedMilestone:
      ledgerCosts.expansionsToFinalRequestedMilestone ??
      aggregate.metrics.expansionsToFinalRequestedMilestone,
    wallMsToFinalRequestedMilestone:
      ledgerCosts.wallMsToFinalRequestedMilestone ??
      aggregate.metrics.wallMsToFinalRequestedMilestone,
    attemptsToFinalRequestedMilestone:
      ledgerCosts.attemptsToFinalRequestedMilestone ??
      aggregate.metrics.attemptsToFinalRequestedMilestone,
    cumulativeFirstGoalExpansion:
      ledgerCosts.expansionsToFinalRequestedMilestone ??
      aggregate.metrics.cumulativeFirstGoalExpansion,
    cumulativeFirstGoalWallMs:
      ledgerCosts.wallMsToFinalRequestedMilestone ??
      aggregate.metrics.cumulativeFirstGoalWallMs,
  };
  const segmentMetrics = aggregate.segments.map((segment) => {
    const cost = ledgerCosts.bySegment[segment.segmentId];
    if (!cost) return segment;
    return {
      ...segment,
      attempts: cost.attempts,
      metrics: {
        ...segment.metrics,
        expansions: cost.expansions,
        wallMs: cost.wallMs,
        attempts: cost.attempts,
        cumulativeExpansionsToFirstGoal:
          cost.expansionsToFirstGoal ??
          segment.metrics.cumulativeExpansionsToFirstGoal,
        cumulativeWallMsToFirstGoal:
          cost.wallMsToFirstGoal ??
          segment.metrics.cumulativeWallMsToFirstGoal,
      },
    };
  });
  return { metrics, segmentMetrics };
}

function buildRunEntry({
  config,
  policy,
  budgetPlan,
  repeat,
  reportPath,
  outPath,
  child,
  reportResult,
  replayContext,
  startedAt,
  runProvenance,
}) {
  const report = reportResult.value;
  const aggregate = aggregateSegmentReport(report);
  const ledger = report && report.evaluationAttemptLedger || [];
  const finalSegmentId = aggregate.segments.length > 0
    ? aggregate.segments[aggregate.segments.length - 1].segmentId
    : null;
  const ledgerCosts = aggregateLedgerCosts(ledger, { finalSegmentId });
  const ledgerProjection = applyLedgerBackedMetrics(aggregate, ledgerCosts);
  const routeResult = readJsonResult(outPath);
  let strictReplay;
  if (routeResult.valid) {
    try {
      strictReplay = strictReplayRoute(
        replayContext.project,
        replayContext.simulator,
        routeResult.value,
      );
      strictReplay.routeFile = outPath;
    } catch (error) {
      strictReplay = {
        performed: true,
        valid: false,
        stepsAttempted: 0,
        stepsCompleted: 0,
        failureStep: null,
        failureReason: "strict-replay-runner-error",
        expectedStateKey: null,
        actualStateKey: null,
        finalState: null,
        error: String(error.message || error),
        routeFile: outPath,
      };
    }
  } else {
    strictReplay = {
      performed: false,
      valid: false,
      stepsAttempted: 0,
      stepsCompleted: 0,
      failureStep: null,
      failureReason: routeResult.error === "file-missing"
        ? "route-file-missing"
        : "route-file-invalid",
      expectedStateKey: null,
      actualStateKey: null,
      finalState: null,
      error: routeResult.error === "file-missing" ? null : routeResult.error,
      routeFile: null,
    };
  }
  strictReplay.scope = config.mode === "full-milestone"
    ? "full-route"
    : "generated-suffix-from-start-snapshot";
  const finalState = strictReplay.finalState;
  const firstAttempt = (report && report.segmentResults || [])
    .flatMap((segment) => segment.attempts || [])
    .find((attempt) => attempt.diagnostics && attempt.diagnostics.dp);
  const dp = firstAttempt && firstAttempt.diagnostics.dp;
  const childSolverCommit = report && report.provenance
    ? report.provenance.solverCommit || null
    : null;
  const observedCommits = [
    runProvenance && runProvenance.startedCommit,
    childSolverCommit,
    runProvenance && runProvenance.finishedCommit,
  ].filter(Boolean);
  const commitStable = observedCommits.length > 1
    ? observedCommits.every((commit) => commit === observedCommits[0])
    : runProvenance && runProvenance.commitStable != null
      ? runProvenance.commitStable
      : null;
  return {
    policy: policy.id,
    repeat,
    found: aggregate.found,
    reachedMilestone: aggregate.reachedMilestone,
    failedSegmentId: aggregate.failedSegmentId,
    segmentMetrics: ledgerProjection.segmentMetrics,
    strictReplay,
    finalState,
    finalHp: finalState && finalState.hero ? Number(finalState.hero.hp || 0) : null,
    budget: {
      ...budgetPlan,
      scope: report && report.budget && report.budget.scope
        ? report.budget.scope
        : config.budgetScope || "per-attempt",
      requestedExpansions: report && report.budget
        ? report.budget.requestedExpansions
        : budgetPlan.maxExpansions,
      requestedRuntimeMs: report && report.budget
        ? report.budget.requestedRuntimeMs
        : budgetPlan.maxRuntimeMs,
      consumedExpansions: report && report.budget
        ? report.budget.consumedExpansions
        : ledgerProjection.metrics.expansions,
      consumedWallMs: report && report.budget
        ? report.budget.consumedWallMs
        : ledgerProjection.metrics.wallMs,
      stoppedReason: report && report.budget ? report.budget.stoppedReason : null,
    },
    metrics: {
      ...ledgerProjection.metrics,
    },
    progress: aggregate.progress,
    stoppedReasons: aggregate.stoppedReasons,
    completeWithinActionSet: aggregate.completeWithinActionSet,
    attempts: aggregate.attempts,
    searchConfig: buildSearchConfig(config, policy, budgetPlan, report),
    process: {
      status: child.status,
      signal: child.signal,
      error: child.error ? child.error.message : null,
      wallMs: Date.now() - startedAt,
      stdoutTail: String(child.stdout || "").slice(-2000),
      stderrTail: String(child.stderr || "").slice(-2000),
    },
    provenance: {
      startedCommit: runProvenance && runProvenance.startedCommit || null,
      solverCommit: childSolverCommit,
      finishedCommit: runProvenance && runProvenance.finishedCommit || null,
      commitStable,
    },
    reportFile: fs.existsSync(reportPath) ? reportPath : null,
    reportStatus: reportResult.valid
      ? "valid"
      : reportResult.error === "file-missing"
        ? "missing"
        : "invalid",
    diagnosticsVersion: dp && dp.observerVersion ? dp.observerVersion : null,
    evaluationAttemptLedger: ledger,
    ledgerConsistency: (() => {
      const ledger = report && report.evaluationAttemptLedger || [];
      if (ledger.length === 0) return null;
      const ledgerExpansions = ledger.reduce(
        (total, entry) => total + number(entry.diagnostics && entry.diagnostics.dp && entry.diagnostics.dp.expansions, 0),
        0,
      );
      const budgetExpansions = report && report.budget
        ? number(report.budget.consumedExpansions, 0)
        : ledgerProjection.metrics.expansions;
      return {
        ledgerExpansions,
        budgetExpansions,
        match: ledgerExpansions === budgetExpansions,
        delta: ledgerExpansions - budgetExpansions,
      };
    })(),
    ledgerCosts,
  };
}

function classifyRun(run) {
  if (run.process.status !== 0) return "child-process-error";
  if (run.reportStatus === "missing") return "missing-child-report";
  if (run.reportStatus === "invalid") return "invalid-child-report";
  if (run.strictReplay.performed && !run.strictReplay.valid) return "strict-replay-failure";
  if (run.found && !run.strictReplay.performed) return "strict-replay-failure";
  if (run.provenance && run.provenance.commitStable === false) return "provenance-mismatch";
  if (run.ledgerConsistency && !run.ledgerConsistency.match) return "ledger-consistency-failure";
  return run.found ? "completed" : "completed-with-search-failures";
}

function determineStoppedReason(runs) {
  const statuses = new Set((runs || []).map((run) => run.runStatus));
  if (statuses.has("child-process-error")) return "child-process-error";
  if (statuses.has("missing-child-report")) return "missing-child-report";
  if (statuses.has("invalid-child-report")) return "invalid-child-report";
  if (statuses.has("strict-replay-failure")) return "strict-replay-failure";
  if (statuses.has("provenance-mismatch")) return "provenance-mismatch";
  if (statuses.has("ledger-consistency-failure")) return "ledger-consistency-failure";
  if (statuses.has("completed-with-search-failures")) return "completed-with-search-failures";
  return "completed";
}

function runOne(config, policy, budgetPlan, repeat, outputDir, replayContext) {
  const base = `${safeFilePart(config.mode)}-${safeFilePart(policy.id)}-${budgetPlan.kind}-${budgetPlan.value}-r${repeat}`;
  const reportPath = path.join(outputDir, `${base}.json`);
  const outPath = path.join(outputDir, `${base}.route.json`);
  [reportPath, outPath].forEach((filePath) => {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });
  const args = buildSegmentedChildArgs(
    config,
    policy,
    budgetPlan,
    reportPath,
    outPath,
  );
  const startedAt = Date.now();
  const startedCommit = readGitCommit();
  const child = spawnSync(
    process.execPath,
    [path.join(__dirname, "run-segmented-dp.js"), ...args],
    {
      cwd: __dirname,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    },
  );
  const finishedCommit = readGitCommit();
  return buildRunEntry({
    config,
    policy,
    budgetPlan,
    repeat,
    reportPath,
    outPath,
    child,
    reportResult: readJsonResult(reportPath),
    replayContext,
    startedAt,
    runProvenance: {
      startedCommit,
      finishedCommit,
      commitStable: startedCommit && finishedCommit
        ? startedCommit === finishedCommit
        : null,
    },
  });
}

function addRegressions(runs) {
  const baselineByKey = new Map();
  runs.forEach((run) => {
    if (run.policy === "best-first") {
      baselineByKey.set(`${run.budget.kind}:${run.budget.value}:r${run.repeat}`, run);
    }
  });
  return runs.map((run) => ({
    ...run,
    runStatus: classifyRun(run),
    regressionFromBaseline:
      run.policy === "best-first"
        ? null
        : buildRegressionFromBaseline(
            run,
            baselineByKey.get(`${run.budget.kind}:${run.budget.value}:r${run.repeat}`),
          ),
    segmentRegressionFromBaseline:
      run.policy === "best-first"
        ? null
        : buildSegmentRegressionFromBaseline(
            run.segmentMetrics,
            (baselineByKey.get(`${run.budget.kind}:${run.budget.value}:r${run.repeat}`) || {}).segmentMetrics,
          ),
  }));
}

function aggregateSegmentRepeats(entries) {
  const byId = new Map();
  (entries || []).forEach((entry) => {
    (entry.segmentMetrics || []).forEach((segment) => {
      if (!byId.has(segment.segmentId)) byId.set(segment.segmentId, []);
      byId.get(segment.segmentId).push(segment);
    });
  });
  return Object.fromEntries(Array.from(byId.entries()).map(([segmentId, segments]) => [
    segmentId,
    {
      label: segments[0].label || null,
      foundCount: segments.filter((segment) => segment.found).length,
      repeats: segments.length,
      metrics: {
        expansions: aggregateRepeats(segments.map((segment) => ({ metrics: segment.metrics }))).metrics.expansions,
        wallMs: aggregateRepeats(segments.map((segment) => ({ metrics: segment.metrics }))).metrics.wallMs,
        cumulativeExpansionsToFirstGoal: range(segments.map(
          (segment) => segment.metrics.cumulativeExpansionsToFirstGoal,
        )),
        cumulativeWallMsToFirstGoal: range(segments.map(
          (segment) => segment.metrics.cumulativeWallMsToFirstGoal,
        )),
        frontierSize: range(segments.map((segment) => segment.metrics.frontierSize)),
        finalHp: range(segments.map((segment) => segment.finalHp)),
      },
    },
  ]));
}

function aggregateLedgerRepeats(entries) {
  const ledgerEntries = (entries || []).filter((entry) => entry.ledgerCosts);
  if (ledgerEntries.length === 0) return null;
  return {
    totalExpansions: range(ledgerEntries.map(
      (entry) => entry.ledgerCosts.totalExpansions,
    )),
    totalWallMs: range(ledgerEntries.map(
      (entry) => entry.ledgerCosts.totalWallMs,
    )),
    expansionsToFirstGoal: range(ledgerEntries.map(
      (entry) => entry.ledgerCosts.expansionsToFirstGoal,
    )),
    wallMsToFirstGoal: range(ledgerEntries.map(
      (entry) => entry.ledgerCosts.wallMsToFirstGoal,
    )),
    expansionsToFinalRequestedMilestone: range(ledgerEntries.map(
      (entry) => entry.ledgerCosts.expansionsToFinalRequestedMilestone,
    )),
    wallMsToFinalRequestedMilestone: range(ledgerEntries.map(
      (entry) => entry.ledgerCosts.wallMsToFinalRequestedMilestone,
    )),
    attemptsToFinalRequestedMilestone: range(ledgerEntries.map(
      (entry) => entry.ledgerCosts.attemptsToFinalRequestedMilestone,
    )),
  };
}

function summarizeLedgerConsistency(entries) {
  const values = (entries || [])
    .map((entry) => entry.ledgerConsistency)
    .filter(Boolean);
  if (values.length === 0) return null;
  const mismatchCount = values.filter((value) => !value.match).length;
  return {
    count: values.length,
    matchCount: values.length - mismatchCount,
    mismatchCount,
    allMatch: mismatchCount === 0,
  };
}

function buildMatrix(runs) {
  const matrix = {};
  runs.forEach((run) => {
    if (!matrix[run.policy]) matrix[run.policy] = {};
    const key = `${run.budget.kind}:${run.budget.value}`;
    if (!matrix[run.policy][key]) matrix[run.policy][key] = [];
    matrix[run.policy][key].push(run);
  });
  const summaries = {};
  Object.entries(matrix).forEach(([policy, budgets]) => {
    summaries[policy] = {};
    Object.entries(budgets).forEach(([budget, entries]) => {
      summaries[policy][budget] = {
        budget: entries[0].budget,
        repeats: aggregateRepeats(entries),
        segmentRepeats: aggregateSegmentRepeats(entries),
        ledgerCosts: aggregateLedgerRepeats(entries),
        ledgerConsistency: summarizeLedgerConsistency(entries),
        runs: entries.map((entry) => ({
          repeat: entry.repeat,
          found: entry.found,
          strictReplay: entry.strictReplay,
          runStatus: entry.runStatus,
          segmentMetrics: entry.segmentMetrics,
          metrics: entry.metrics,
          ledgerCosts: entry.ledgerCosts,
          ledgerConsistency: entry.ledgerConsistency,
          provenance: entry.provenance,
          regressionFromBaseline: entry.regressionFromBaseline,
          segmentRegressionFromBaseline: entry.segmentRegressionFromBaseline,
        })),
      };
    });
  });
  return { matrix, summaries };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.mode || "mt7-segment";
  const isMt7 = mode === "mt7-segment";
  if (!isMt7 && mode !== "full-milestone") {
    throw new Error(`Unknown evaluation mode: ${mode}`);
  }
  const config = {
    mode,
    routeName: args["route-name"] || "onlyup-chaos-mt5-blueking",
    projectRoot: resolvePath(args["project-root"], DEFAULT_PROJECT_ROOT),
    startRoute: resolvePath(
      args["start-route"],
      isMt7 ? DEFAULT_MT7_ROUTE : null,
    ),
    startRouteStep: args["start-route-step"] == null
      ? (isMt7 ? 113 : null)
      : number(args["start-route-step"], null),
    fromMilestone: args["from-milestone"] || (isMt7 ? "mt7-special80-ready" : null),
    toMilestone: args["to-milestone"] || (isMt7 ? "mt7-left-sword" : null),
    candidateLimit: number(args["candidate-limit"], 8),
    goalSkylineLimit: number(args["goal-skyline-limit"], 8),
    dpSkylineMax: number(args["dp-skyline-max"], 4),
    preserveSkylineRoles: parseBoolean(args["preserve-skyline-roles"], true),
    stopOnFirstGoal: parseBoolean(args["stop-on-first-goal"], false),
    maxActionsPerState: number(args["max-actions-per-state"], 256),
    dpKeyMode: args["dp-key-mode"] || null,
    budgetScope: args["budget-scope"] || "global-run",
  };
  const kind = args["budget-kind"] || "expansions";
  if (kind !== "expansions" && kind !== "time") {
    throw new Error(`Unknown budget kind: ${kind}`);
  }
  const budgets = parseList(
    args.budgets,
    kind === "time" ? [20000, 60000, 120000] : [500, 1000, 2000, 5000],
  );
  const policies = getPolicyMatrix(args.policies);
  const repeats = Math.max(
    1,
    Math.floor(number(args.repeats, kind === "time" ? 3 : 1)),
  );
  const outputDir = resolvePath(
    args["run-dir"],
    path.join(__dirname, "routes", "generated", "agenda-policy-evaluation"),
  );
  fs.mkdirSync(outputDir, { recursive: true });
  const replayContext = makeReplayContext(config.projectRoot);
  const startedCommit = readGitCommit();

  const runs = [];
  for (const budget of budgets) {
    const budgetPlan = buildBudgetPlan(kind, budget, {
      maxExpansionsForTime: args["time-max-expansions"],
      maxRuntimeMsForExpansions: args["expansion-max-runtime-ms"],
    });
    for (const policy of policies) {
      for (let repeat = 1; repeat <= repeats; repeat += 1) {
        console.log(
          `Evaluating ${policy.id} ${budgetPlan.kind}=${budgetPlan.value} repeat=${repeat}`,
        );
        runs.push(runOne(config, policy, budgetPlan, repeat, outputDir, replayContext));
      }
    }
  }
  const normalizedRuns = addRegressions(runs);
  const { matrix, summaries } = buildMatrix(normalizedRuns);
  const finishedCommit = readGitCommit();
  const commitStable = startedCommit && finishedCommit
    ? startedCommit === finishedCommit
    : null;
  const report = {
    schema: "agenda-policy-evaluation.v1",
    generatedAt: new Date().toISOString(),
    provenance: {
      solverCommit: finishedCommit,
      startedCommit,
      finishedCommit,
      commitStable,
      nodeVersion: process.version,
      platform: process.platform,
    },
    mode,
    input: {
      routeName: config.routeName,
      projectRoot: config.projectRoot,
      startRoute: config.startRoute,
      startRouteStep: config.startRouteStep,
      fromMilestone: config.fromMilestone,
      toMilestone: config.toMilestone,
    },
    policies,
    budgetPlan: {
      kind,
      budgets,
      repeats,
    },
    searchDefaults: config,
    runs: normalizedRuns,
    matrix,
    summaries,
    stoppedReason: determineStoppedReason(normalizedRuns),
  };
  const reportPath = resolvePath(
    args["out-report"],
    path.join(
      __dirname,
      "routes",
      "generated",
      `agenda-policy-evaluation-${safeFilePart(mode)}.json`,
    ),
  );
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Evaluation report written: ${reportPath}`);
}

if (require.main === module) main();

module.exports = {
  addRegressions,
  aggregateRepeats,
  buildMatrix,
  aggregateSegmentRepeats,
  classifyRun,
  determineStoppedReason,
  applyLedgerBackedMetrics,
  buildRunEntry,
  main,
  parseArgs,
  parseList,
};
