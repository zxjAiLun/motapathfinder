"use strict";

/**
 * PR-5.4b Commit 1 — deterministic performance baseline.
 *
 * Runs a FIXED OnlyUp region (the smoke region) with a FIXED task and budget
 * through the canonical segment-DP path, with the perf tracker active, and
 * emits a fixed-schema JSON report.  Does NOT change any search semantics,
 * does NOT remove state.route, does NOT build TowerIR, and does NOT introduce
 * Rust.
 *
 * Output schema: motapathfinder.perf-baseline.v1
 */

const fs = require("node:fs");
const path = require("node:path");

const { compileExecutableSolveTask } = require("./lib/solve-task");
const { executeSolveJob } = require("./lib/solver-job");
const { createPerfTracker, setActivePerfTracker } = require("./lib/perf");

const ROOT = path.resolve(__dirname, "..");
const SMOKE_SPEC_FILE = path.join(ROOT, "towers", "onlyup", "region-specs", "region-output-contract-smoke.json");
const ONLY_UP_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");

const BASELINE_SCHEMA = "motapathfinder.perf-baseline.v1";

function buildBaselineTask() {
  const spec = JSON.parse(fs.readFileSync(SMOKE_SPEC_FILE, "utf8"));
  return compileExecutableSolveTask({
    schema: "motapathfinder.solve-task.v1",
    tower: {
      id: "onlyup-smoke",
      projectRoot: ONLY_UP_ROOT,
      region: { spec },
    },
    objective: { mode: "max-final-hp" },
    search: {
      algorithm: "segment-dp",
      maxExpansions: 1000,
      maxRuntimeMs: 10000,
      candidateLimit: 2,
      goalSkylineLimit: 8,
    },
    verification: { strictReplay: false },
  });
}

function collectSearchDepth(execution) {
  // The canonical single-region result carries segment diagnostics; the DP
  // depth lives on each segment attempt's diagnostics.dp.depth.
  const diagnostics = execution && execution.result && execution.result.diagnostics;
  let depth = diagnostics && (diagnostics.depth || (diagnostics.dp && diagnostics.dp.depth));
  if (!depth) {
    const segments = (execution && execution.result && execution.result.segmentResults) || [];
    for (const segment of segments) {
      const segD = segment && segment.diagnostics;
      depth = depth || (segD && (segD.depth || (segD.dp && segD.dp.depth)));
      if (!depth && Array.isArray(segment && segment.attempts)) {
        for (const attempt of segment.attempts) {
          const attD = attempt && attempt.diagnostics;
          depth = depth || (attD && (attD.depth || (attD.dp && attD.dp.depth)));
          if (depth) break;
        }
      }
      if (depth) break;
    }
  }
  if (!depth) return null;
  return {
    avgDecisionDepth: Number(Number(depth.avgDecisionDepth || 0).toFixed(3)),
    maxDecisionDepth: Number(depth.maxDecisionDepth || 0),
  };
}

async function runPerfBaseline(options) {
  const config = options || {};
  const task = config.task || buildBaselineTask();
  const tracker = createPerfTracker({ enabled: true });
  setActivePerfTracker(tracker);

  let peakRssMb = 0;
  let peakHeapUsedMb = 0;
  const sampler = setInterval(() => {
    const memory = process.memoryUsage();
    const rss = memory.rss / 1024 / 1024;
    const heap = memory.heapUsed / 1024 / 1024;
    if (rss > peakRssMb) peakRssMb = rss;
    if (heap > peakHeapUsedMb) peakHeapUsedMb = heap;
  }, 5);

  const wallStarted = Date.now();
  try {
    const execution = await executeSolveJob(task, {
      jobId: "perf-baseline",
      onProgress: () => {},
      shouldStop: () => false,
      context: {},
    });
    const wallMs = Date.now() - wallStarted;
    const perf = tracker.snapshot({});
    const depth = collectSearchDepth(execution);
    const search = task.normalizedTask.search || {};
    // The search is synchronous, so the interval sampler cannot fire during it;
    // the post-search memory usage is the practical high-water mark for a
    // synchronous search (measured before any explicit GC).
    const peakRss = Math.max(peakRssMb, perf.rssMb);
    const peakHeap = Math.max(peakHeapUsedMb, perf.heapUsedMb);
    return {
      schema: BASELINE_SCHEMA,
      task: {
        taskFingerprint: task.taskFingerprint,
        regionId: task.normalizedTask.tower.region.spec.id,
        search: {
          maxExpansions: Number(search.maxExpansions),
          maxRuntimeMs: Number(search.maxRuntimeMs),
          candidateLimit: Number(search.candidateLimit),
          goalSkylineLimit: Number(search.goalSkylineLimit),
        },
      },
      result: {
        found: Boolean(execution.result && execution.result.found),
        strictReplayVerified: Boolean(execution.strictReplayVerified),
        routeDecisionCount: execution.routeRecord && execution.routeRecord.decisions
          ? execution.routeRecord.decisions.length
          : null,
      },
      perf: {
        wallMs,
        cpuUserMs: perf.cpuUserMs,
        cpuSystemMs: perf.cpuSystemMs,
        cpuUtilization: perf.cpuUtilization,
        rssMb: Number(perf.rssMb.toFixed(1)),
        heapUsedMb: Number(perf.heapUsedMb.toFixed(1)),
        peakRssMb: Number(peakRss.toFixed(1)),
        peakHeapUsedMb: Number(peakHeap.toFixed(1)),
        expanded: perf.expanded,
        generated: perf.generated,
        registered: perf.registered,
        dominated: Number(perf.dominated || 0),
        duplicates: perf.duplicates,
        expandedPerSec: Number(perf.expandedPerSec.toFixed(2)),
        generatedPerSec: Number(perf.generatedPerSec.toFixed(2)),
        phaseMs: perf.phaseMs,
        phaseCounts: perf.phaseCounts,
        depth,
      },
      meta: {
        ranAt: new Date().toISOString(),
        nodeVersion: process.version,
        cwd: process.cwd(),
      },
    };
  } finally {
    clearInterval(sampler);
    setActivePerfTracker(null);
  }
}

async function main() {
  const outputPath = process.argv.includes("--output")
    ? process.argv[process.argv.indexOf("--output") + 1]
    : null;
  const report = await runPerfBaseline();
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}

module.exports = { BASELINE_SCHEMA, buildBaselineTask, runPerfBaseline, main };
