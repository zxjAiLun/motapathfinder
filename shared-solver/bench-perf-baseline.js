"use strict";

/**
 * PR-5.4b Commit 1 (Repair) — deterministic performance baseline.
 *
 * Two fixed workloads:
 * - "smoke-contract": the smoke region with its default goal (exp 2).  Tiny
 *   search (~2 expansions).  Used ONLY for contract checks and CI; NOT used
 *   for performance conclusions.
 * - "representative-baseline": a fixed MT1 segment with a deeper goal
 *   (exp 9), which produces a meaningful frontier and route depth (avg depth
 *   ~8, max ~12, ~100+ expansions).  Used to compare Commit 1 vs Commit 2.
 *
 * Both run through the canonical segment-DP path with the perf tracker active.
 * Memory peaks are sampled synchronously INSIDE the search loop (a setInterval
 * sampler cannot run during CPU-bound search).  Output schema:
 * motapathfinder.perf-baseline.v1.
 */

const fs = require("node:fs");
const path = require("node:path");

const { compileExecutableSolveTask } = require("./lib/solve-task");
const { executeSolveJob } = require("./lib/solver-job");
const { createPerfTracker, setActivePerfTracker } = require("./lib/perf");
const { buildReplayRouteFingerprint } = require("./lib/replay-resume-artifact");
const { exactStateFingerprint } = require("./lib/solver-job");

const ROOT = path.resolve(__dirname, "..");
const SMOKE_SPEC_FILE = path.join(ROOT, "towers", "onlyup", "region-specs", "region-output-contract-smoke.json");
const ONLY_UP_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");

const BASELINE_SCHEMA = "motapathfinder.perf-baseline.v1";

const PROFILES = {
  "smoke-contract": {
    maxExpansions: 1000,
    maxRuntimeMs: 10000,
    candidateLimit: 2,
    goalExp: 2,
  },
  "representative-baseline": {
    maxExpansions: 3000,
    maxRuntimeMs: 0,
    candidateLimit: 2,
    goalExp: 9,
  },
};

function buildBaselineTask(profile) {
  const config = PROFILES[profile] || PROFILES["smoke-contract"];
  const spec = JSON.parse(fs.readFileSync(SMOKE_SPEC_FILE, "utf8"));
  spec.goal = { type: "heroAtLeast", floorId: "MT1", minHero: { exp: config.goalExp } };
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
      maxExpansions: config.maxExpansions,
      maxRuntimeMs: config.maxRuntimeMs,
      candidateLimit: config.candidateLimit,
      goalSkylineLimit: 8,
    },
    verification: { strictReplay: false },
  });
}

function collectSearchDepth(execution) {
  // The DP depth lives on each segment attempt's diagnostics.dp.depth.
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

function collectResultParity(execution, task) {
  const record = execution.routeRecord || null;
  const decisions = (record && record.decisions) || [];
  const winnerState = execution.result && execution.result.finalCandidate && execution.result.finalCandidate.state;
  const routeFingerprint = record ? buildReplayRouteFingerprint(record) : null;
  // The DP's own dominance diagnostics (for rejection-counter alignment).
  const att = (execution.result && execution.result.segmentResults || [])[0]
    && (execution.result.segmentResults[0].attempts || [])[0];
  const dpDiag = att && att.diagnostics && att.diagnostics.dp;
  return {
    found: Boolean(execution.result && execution.result.found),
    failureClass: execution.result && execution.result.failedSegment && execution.result.failedSegment.failureClass || null,
    stoppedReason: execution.result && execution.result.stoppedReason || null,
    routeDecisionCount: decisions.length,
    routeFingerprint: routeFingerprint ? routeFingerprint.hash || JSON.stringify(routeFingerprint) : null,
    winnerExactFingerprint: winnerState ? exactStateFingerprint(winnerState) : null,
    decisionSummaries: decisions.map((decision) => (decision && decision.summary) || (decision && decision.kind) || String(decision)),
    objectiveValue: execution.objectiveValue ? execution.objectiveValue.value : null,
    taskFingerprint: task && task.taskFingerprint || null,
    dpRejections: dpDiag
      ? {
          rejectedByHigherHp: Number(dpDiag.rejectedByHigherHp || 0),
          sameHpRejected: Number(dpDiag.sameHpRejected || 0),
        }
      : null,
  };
}

async function runPerfBaseline(options) {
  const config = options || {};
  const profile = config.profile || "smoke-contract";
  const task = config.task || buildBaselineTask(profile);
  const tracker = createPerfTracker({ enabled: true });
  setActivePerfTracker(tracker);

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
    const parity = collectResultParity(execution, task);
    const endRssMb = Number(perf.rssMb);
    const endHeapUsedMb = Number(perf.heapUsedMb);
    // Peak RSS: process-level high-water (maxRSS) is authoritative, with the
    // in-loop sampled peak and the end RSS as supplemental maxima.
    const maxRssKb = Number((process.resourceUsage && process.resourceUsage().maxRSS) || 0);
    const peakRssMb = Math.max(maxRssKb / 1024, Number(perf.peakRssMb || 0), endRssMb);
    const peakHeapUsedMb = Math.max(Number(perf.peakHeapUsedMb || 0), endHeapUsedMb);
    return {
      schema: BASELINE_SCHEMA,
      profile,
      task: {
        taskFingerprint: task.taskFingerprint,
        regionId: task.normalizedTask.tower.region.spec.id,
        goalExp: (task.normalizedTask.tower.region.spec.goal || {}).minHero
          ? (task.normalizedTask.tower.region.spec.goal.minHero).exp
          : null,
        search: {
          maxExpansions: Number(search.maxExpansions),
          maxRuntimeMs: Number(search.maxRuntimeMs),
          candidateLimit: Number(search.candidateLimit),
          goalSkylineLimit: Number(search.goalSkylineLimit),
        },
      },
      result: parity,
      perf: {
        wallMs,
        cpuUserMs: perf.cpuUserMs,
        cpuSystemMs: perf.cpuSystemMs,
        cpuUtilization: perf.cpuUtilization,
        endRssMb: Number(endRssMb.toFixed(1)),
        endHeapUsedMb: Number(endHeapUsedMb.toFixed(1)),
        peakRssMb: Number(peakRssMb.toFixed(1)),
        peakHeapUsedMb: Number(peakHeapUsedMb.toFixed(1)),
        maxRssKb,
        memorySampleCount: perf.memorySampleCount,
        expanded: perf.expanded,
        generated: perf.generated,
        registered: perf.registered,
        dominanceRejected: Number(perf.dominanceRejected || 0),
        skylineCapacityRejected: Number(perf.skylineCapacityRejected || 0),
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
      },
    };
  } finally {
    setActivePerfTracker(null);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const outputPath = args.includes("--output") ? args[args.indexOf("--output") + 1] : null;
  const profileArg = args.includes("--profile") ? args[args.indexOf("--profile") + 1] : null;
  const profile = PROFILES[profileArg] ? profileArg : "smoke-contract";
  const report = await runPerfBaseline({ profile });
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

module.exports = { BASELINE_SCHEMA, PROFILES, buildBaselineTask, collectResultParity, runPerfBaseline, main };
