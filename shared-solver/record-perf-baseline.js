"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const { parseKeyValueArgs } = require("./lib/cli-options");

const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, "../Only upV2.1/Only upV2.1");

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function parseJsonLine(stdout, prefix) {
  const line = String(stdout || "")
    .split(/\r?\n/)
    .find((entry) => entry.startsWith(prefix));
  if (!line) return null;
  return JSON.parse(line.slice(prefix.length));
}

function metricFromRun(name, command, stdout, status) {
  const perf = parseJsonLine(stdout, "Perf: ") || {};
  const diagnostics = parseJsonLine(stdout, "Diagnostics main view: ") || {};
  const expanded = number(perf.expanded || perf.expandedStates);
  const phaseMs = perf.phaseMs || {};
  const cache = diagnostics.actionExpansionCache || {};
  const mainCache = cache.main || {};
  const workerCache = cache.workers || {};
  const resourceClusterCache = mainCache.resourceCluster || workerCache.resourceCluster || {};
  const battleCache = mainCache.battleResolver || workerCache.battleResolver || {};
  const confluence = diagnostics.confluence || {};
  const graph = diagnostics.graph || {};
  const best = diagnostics.best || {};
  return {
    name,
    command,
    status,
    updatedAt: new Date().toISOString(),
    expandedPerSec: number(perf.expandedPerSec || perf.expansionsPerSec),
    generatedPerSec: number(perf.generatedPerSec),
    enumerateActionsMsPerState: expanded > 0 ? number(phaseMs.enumerateActions) / expanded : 0,
    resourceClusterMsPerState: number(resourceClusterCache.avgComputeMs || resourceClusterCache.avgMsSaved),
    actionCacheHitRate: number((mainCache.primitiveActions || {}).hitRate),
    battleCacheHitRate: number((battleCache.battleEstimate || battleCache).hitRate),
    resourceClusterCacheHitRate: number(resourceClusterCache.hitRate),
    confluenceRejects: number(confluence.rejectedByHigherHp),
    goalFound: !String(stdout || "").includes("No terminal "),
    bestProgress: {
      graphMode: graph.mode || null,
      primitiveFallbackStates: number(graph.primitiveFallbackStates),
      floor: best.bestProgressFloor || null,
      stage: best.bestProgressStage == null ? null : Number(best.bestProgressStage),
      bestSeenFloor: best.bestSeenFloor || null,
      bestSeenStage: best.bestSeenStage == null ? null : Number(best.bestSeenStage),
    },
  };
}

function runBenchmark(args) {
  const profile = args.profile || "linear-main";
  const targetFloor = args["to-floor"] || "MT5";
  const maxExpansions = args["max-expansions"] || "500";
  const parallel = args.parallel || "0";
  const name = args.name || `${profile}-${targetFloor}-${parallel === "1" ? "parallel" : "serial"}`;
  const command = [
    "run-route.js",
    `--profile=${profile}`,
    `--to-floor=${targetFloor}`,
    `--parallel=${parallel}`,
    "--resource-pocket-mode=lite",
    "--resource-cluster=1",
    "--resource-chain=0",
    `--max-expansions=${maxExpansions}`,
    "--perf=1",
    "--diagnostics=1",
    "--checkpoint-save=0",
  ];
  command.push(`--project-root=${args["project-root"] || DEFAULT_PROJECT_ROOT}`);
  if (parallel === "1") {
    command.push(`--workers=${args.workers || 8}`);
    command.push(`--topk-batch-size=${args["topk-batch-size"] || 128}`);
    command.push(`--worker-chunk-size=${args["worker-chunk-size"] || 8}`);
  }
  const result = spawnSync(process.execPath, command, {
    cwd: __dirname,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    throw new Error(`Benchmark failed with status ${result.status}`);
  }
  return metricFromRun(name, command, result.stdout, result.status);
}

function main() {
  const args = parseKeyValueArgs(process.argv.slice(2));
  const outputPath = path.resolve(__dirname, args.out || "profiles/perf-baseline.json");
  const baseline = readJson(outputPath, { version: 1, benchmarks: {} });
  if (!baseline.benchmarks) baseline.benchmarks = {};
  const metric = runBenchmark(args);
  baseline.updatedAt = metric.updatedAt;
  baseline.benchmarks[metric.name] = metric;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ written: path.relative(process.cwd(), outputPath), benchmark: metric.name }, null, 2));
}

if (require.main === module) {
  main();
}
