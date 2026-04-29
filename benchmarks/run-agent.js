#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");

function parseArgs(argv) {
  return (argv || []).reduce((result, token) => {
    const match = String(token).match(/^--([^=]+)=(.*)$/);
    if (match) result[match[1]] = match[2];
    return result;
  }, {});
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Failed to read JSON ${filePath}: ${error.message}`);
  }
}

function safeName(value) {
  return String(value || "run").replace(/[^A-Za-z0-9_.-]+/g, "_");
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function resolvePath(filePath) {
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(repoRoot, filePath);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function runCommand(command, options) {
  const result = spawnSync(command[0], command.slice(1), {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...(options.env || {}),
    },
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 20,
  });
  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error ? String(result.error.stack || result.error.message || result.error) : null,
  };
}

function taskOutputPaths(runDir, taskId) {
  const taskDir = path.join(runDir, safeName(taskId));
  ensureDir(taskDir);
  return {
    taskDir,
    route: path.join(taskDir, "route.json"),
    metrics: path.join(taskDir, "metrics.json"),
    diagnostics: path.join(taskDir, "diagnostics.json"),
    report: path.join(taskDir, "agent-report.md"),
    stdout: path.join(taskDir, "stdout.log"),
    stderr: path.join(taskDir, "stderr.log"),
  };
}

function writeLogs(paths, result) {
  fs.writeFileSync(paths.stdout, result.stdout || "");
  fs.writeFileSync(paths.stderr, result.stderr || "");
}

function readOptionalJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return readJson(filePath);
}

function writeDefaultReport(paths, task, result, metrics) {
  const lines = [];
  lines.push(`# Agent Report: ${task.taskId}`);
  lines.push("");
  lines.push(`- Found: ${Boolean(metrics && metrics.found)}`);
  lines.push(`- Exit Status: ${result.status == null ? "null" : result.status}`);
  lines.push(`- Route: \`${path.relative(repoRoot, paths.route)}\``);
  lines.push(`- Metrics: \`${path.relative(repoRoot, paths.metrics)}\``);
  lines.push(`- Diagnostics: \`${path.relative(repoRoot, paths.diagnostics)}\``);
  if (result.error) lines.push(`- Error: ${result.error}`);
  fs.writeFileSync(paths.report, `${lines.join("\n")}\n`);
}

function builtinRegionCommand(task, paths) {
  return [
    process.execPath,
    path.join(repoRoot, "shared-solver", "run-region-dp.js"),
    `--project-root=${resolvePath(task.projectRoot)}`,
    `--region-spec=${resolvePath(task.regionSpec)}`,
    `--out=${paths.route}`,
    `--metrics=${paths.metrics}`,
    `--diagnostics=${paths.diagnostics}`,
  ].concat((task.args || []).map(String));
}

function agentCommand(agent, task, paths) {
  if (Array.isArray(agent.command) && agent.command.length > 0) {
    return agent.command.map((token) => String(token)
      .replace(/\{taskId\}/g, task.taskId)
      .replace(/\{node\}/g, process.execPath)
      .replace(/\{repoRoot\}/g, repoRoot)
      .replace(/\{regionSpec\}/g, resolvePath(task.regionSpec || ""))
      .replace(/\{projectRoot\}/g, resolvePath(task.projectRoot || ""))
      .replace(/\{runDir\}/g, paths.taskDir)
      .replace(/\{route\}/g, paths.route)
      .replace(/\{metrics\}/g, paths.metrics)
      .replace(/\{diagnostics\}/g, paths.diagnostics)
      .replace(/\{report\}/g, paths.report));
  }
  return builtinRegionCommand(task, paths);
}

function validateTaskOutputs(paths) {
  const missing = [];
  for (const [name, filePath] of Object.entries({
    route: paths.route,
    metrics: paths.metrics,
    diagnostics: paths.diagnostics,
    report: paths.report,
  })) {
    if (!fs.existsSync(filePath)) missing.push(name);
  }
  return missing;
}

function proofAwareness(metrics, diagnostics) {
  const proofClaim = (metrics && metrics.proofClaim) || (diagnostics && diagnostics.proofClaim) || null;
  if (!proofClaim) return false;
  return typeof proofClaim.proofLevel === "string" &&
    typeof proofClaim.completeWithinActionSet === "boolean" &&
    proofClaim.actionTrimmed != null;
}

function diagnosticsQuality(diagnostics) {
  if (!diagnostics) return false;
  if (diagnostics.failedSegmentId) return true;
  if (Array.isArray(diagnostics.segments) && diagnostics.segments.length > 0) return true;
  return Boolean(diagnostics.proofClaim);
}

function engineeringDiscipline(agent, paths, metrics, missingOutputs) {
  const required = Array.isArray(agent.requiredOutputs) ? agent.requiredOutputs : [];
  const missingRequired = required.filter((name) => {
    const key = name.replace(/\.json$|\.md$/g, "").replace(/-/g, "");
    if (name === "route.json") return !fs.existsSync(paths.route);
    if (name === "metrics.json") return !fs.existsSync(paths.metrics);
    if (name === "diagnostics.json") return !fs.existsSync(paths.diagnostics);
    if (name === "agent-report.md") return !fs.existsSync(paths.report);
    return missingOutputs.includes(key) || !fs.existsSync(path.join(paths.taskDir, name));
  });
  return {
    passed: missingRequired.length === 0 && Number((metrics || {}).illegalWrites || 0) === 0,
    missingRequired,
    illegalWrites: Number((metrics || {}).illegalWrites || 0),
  };
}

function taskScore(metrics, diagnostics, discipline) {
  const found = Boolean(metrics && metrics.found);
  const liveVerified = Boolean(metrics && metrics.liveVerified);
  const proof = proofAwareness(metrics, diagnostics);
  const diagnostic = diagnosticsQuality(diagnostics);
  const complete = Boolean(metrics && metrics.completeWithinActionSet);
  let score = 0;
  if (found) score += 30;
  if (liveVerified) score += 20;
  if (proof) score += 15;
  if (complete) score += 10;
  if (diagnostic) score += 10;
  if (discipline.passed) score += 10;
  const wallMs = Number((metrics || {}).wallMs || 0);
  if (wallMs > 0 && wallMs < 10000) score += 5;
  return score;
}

function runTask(agent, suite, task, runDir) {
  const paths = taskOutputPaths(runDir, task.taskId);
  const startedAt = Date.now();
  const command = agentCommand(agent, task, paths);
  const result = runCommand(command, {
    env: {
      AGENT_RUN_DIR: paths.taskDir,
      AGENT_ROUTE_OUT: paths.route,
      AGENT_METRICS_OUT: paths.metrics,
      AGENT_DIAGNOSTICS_OUT: paths.diagnostics,
      AGENT_REPORT_OUT: paths.report,
      BENCHMARK_SUITE_ID: suite.id,
      BENCHMARK_TASK_ID: task.taskId,
    },
  });
  writeLogs(paths, result);
  const metrics = readOptionalJson(paths.metrics);
  const diagnostics = readOptionalJson(paths.diagnostics);
  if (!fs.existsSync(paths.report)) writeDefaultReport(paths, task, result, metrics);
  const missingOutputs = validateTaskOutputs(paths);
  const discipline = engineeringDiscipline(agent, paths, metrics, missingOutputs);
  const proof = proofAwareness(metrics, diagnostics);
  const diagnostic = diagnosticsQuality(diagnostics);
  return {
    taskId: task.taskId,
    enabled: task.enabled !== false,
    command: command.map((part) => part.includes(" ") ? JSON.stringify(part) : part).join(" "),
    status: result.status,
    signal: result.signal,
    wallMs: Date.now() - startedAt,
    found: Boolean(metrics && metrics.found),
    liveVerified: Boolean(metrics && metrics.liveVerified),
    missingOutputs,
    evaluation: {
      score: taskScore(metrics, diagnostics, discipline),
      proofAwareness: proof,
      diagnosticsQuality: diagnostic,
      engineeringDiscipline: discipline.passed,
      completeWithinActionSet: Boolean(metrics && metrics.completeWithinActionSet),
      proofLevel: (metrics && metrics.proofLevel) || null,
      generalizedTower: task.tower || null,
      trapCoverage: (task.expectedTraps || []).length,
      cost: {
        expansions: Number((metrics || {}).expansions || 0),
        wallMs: Number((metrics || {}).wallMs || 0),
        routeLength: Number((metrics || {}).routeLength || 0),
      },
      discipline,
    },
    outputDir: path.relative(repoRoot, paths.taskDir),
    metrics,
    diagnosticsSummary: diagnostics ? {
      found: diagnostics.found,
      reachedMilestone: diagnostics.reachedMilestone,
      failedSegmentId: diagnostics.failedSegmentId,
    } : null,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.agent || !args.suite) {
    console.log("Usage: node benchmarks/run-agent.js --agent=agents/<agent>/agent.json --suite=benchmarks/public/region-suite.json");
    return;
  }
  const agentPath = resolvePath(args.agent);
  const suitePath = resolvePath(args.suite);
  const agent = readJson(agentPath);
  const suite = readJson(suitePath);
  const agentName = safeName(agent.name || path.basename(path.dirname(agentPath)));
  const suiteId = safeName(suite.id || path.basename(suitePath, ".json"));
  const runDir = resolvePath(args["run-dir"] || path.join("runs", timestamp(), agentName, suiteId));
  ensureDir(runDir);

  const tasks = (suite.tasks || []).filter((task) => task.enabled !== false || args["include-disabled"] === "1");
  const results = tasks.map((task) => runTask(agent, suite, task, runDir));
  const summary = {
    kind: "agent-benchmark",
    leaderboard: suite.leaderboard || "agent-from-scratch",
    evaluationDimensions: suite.evaluationDimensions || [
      "solvingAbility",
      "proofAwareness",
      "generalization",
      "engineeringDiscipline",
      "debuggingAbility",
      "trapResistance",
      "cost",
      "reproducibility",
    ],
    agent: {
      name: agent.name || agentName,
      file: path.relative(repoRoot, agentPath),
    },
    suite: {
      id: suite.id || suiteId,
      file: path.relative(repoRoot, suitePath),
    },
    runDir: path.relative(repoRoot, runDir),
    totals: {
      tasks: results.length,
      found: results.filter((result) => result.found).length,
      proofAware: results.filter((result) => result.evaluation.proofAwareness).length,
      diagnosticsQuality: results.filter((result) => result.evaluation.diagnosticsQuality).length,
      engineeringDiscipline: results.filter((result) => result.evaluation.engineeringDiscipline).length,
      failedProcess: results.filter((result) => result.status !== 0).length,
      missingOutputs: results.filter((result) => result.missingOutputs.length > 0).length,
      score: results.reduce((sum, result) => sum + result.evaluation.score, 0),
    },
    results,
  };
  const resultsDir = resolvePath("benchmarks/results");
  ensureDir(resultsDir);
  const resultFile = path.join(resultsDir, `${suiteId}-${agentName}-${timestamp()}.json`);
  fs.writeFileSync(resultFile, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Benchmark result written: ${resultFile}`);
  if (summary.totals.failedProcess > 0 || summary.totals.missingOutputs > 0) process.exitCode = 1;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  }
}
