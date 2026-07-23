"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  aggregateRepeats,
  aggregateSegmentReport,
  buildBudgetPlan,
  buildRegressionFromBaseline,
  buildSegmentedChildArgs,
  getPolicyMatrix,
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

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return null;
  }
}

function routeFinalState(routeFile) {
  const route = readJson(routeFile);
  if (!route) return null;
  const final = route.final || {};
  const snapshot = final.snapshot || route.snapshot || null;
  return snapshot
    ? {
        floorId: snapshot.floorId || route.floorId || null,
        hero: snapshot.hero || null,
        inventory: snapshot.inventory || null,
        flags: snapshot.flags || null,
        stateKey: final.stateKey || route.stateKey || null,
      }
    : null;
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
    budgetKind: budgetPlan.kind,
    budgetValue: budgetPlan.value,
  };
}

function buildRunEntry({
  config,
  policy,
  budgetPlan,
  repeat,
  reportPath,
  outPath,
  child,
  report,
  startedAt,
}) {
  const aggregate = aggregateSegmentReport(report);
  const finalState = routeFinalState(outPath);
  const routeExists = Boolean(finalState);
  const strictReplay = {
    valid: Boolean(child.status === 0 && report && report.found && routeExists),
    performed: Boolean(report && report.found),
    routeFile: routeExists ? outPath : null,
    error:
      child.status !== 0
        ? child.error
          ? child.error.message
          : `child exited with status ${child.status}`
        : report && report.found && !routeExists
          ? "segmented report found but route output is missing"
          : null,
  };
  const firstAttempt = (report && report.segmentResults || [])
    .flatMap((segment) => segment.attempts || [])
    .find((attempt) => attempt.diagnostics && attempt.diagnostics.dp);
  const dp = firstAttempt && firstAttempt.diagnostics.dp;
  return {
    policy: policy.id,
    budget: budgetPlan,
    repeat,
    found: aggregate.found,
    reachedMilestone: aggregate.reachedMilestone,
    failedSegmentId: aggregate.failedSegmentId,
    segmentMetrics: aggregate.segments,
    strictReplay,
    finalState,
    metrics: {
      ...aggregate.metrics,
      firstGoalExpansion: Number.isFinite(aggregate.metrics.firstGoalExpansion)
        ? aggregate.metrics.firstGoalExpansion
        : null,
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
    reportFile: fs.existsSync(reportPath) ? reportPath : null,
    diagnosticsVersion: dp && dp.observerVersion ? dp.observerVersion : null,
  };
}

function runOne(config, policy, budgetPlan, repeat, outputDir) {
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
  return buildRunEntry({
    config,
    policy,
    budgetPlan,
    repeat,
    reportPath,
    outPath,
    child,
    report: readJson(reportPath),
    startedAt,
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
    regressionFromBaseline:
      run.policy === "best-first"
        ? null
        : buildRegressionFromBaseline(
            run,
            baselineByKey.get(`${run.budget.kind}:${run.budget.value}:r${run.repeat}`),
          ),
  }));
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
        runs: entries.map((entry) => ({
          repeat: entry.repeat,
          found: entry.found,
          strictReplay: entry.strictReplay,
          segmentMetrics: entry.segmentMetrics,
          metrics: entry.metrics,
          regressionFromBaseline: entry.regressionFromBaseline,
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
        runs.push(runOne(config, policy, budgetPlan, repeat, outputDir));
      }
    }
  }
  const normalizedRuns = addRegressions(runs);
  const { matrix, summaries } = buildMatrix(normalizedRuns);
  const report = {
    schema: "agenda-policy-evaluation.v1",
    generatedAt: new Date().toISOString(),
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
    stoppedReason: normalizedRuns.some((run) => run.process.error)
      ? "child-process-error"
      : "completed",
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
  buildRunEntry,
  main,
  parseArgs,
  parseList,
  routeFinalState,
};
