"use strict";

/**
 * PR-5.24b Iteration 5 Qualification — OFF/ON orchestrator.
 *
 * Executes the authorized sequence OFF-1, ON-1, OFF-2, ON-2, OFF-3, ON-3,
 * each in a FRESH child process (no RSS/lifecycle carryover), then aggregates
 * the compact per-run records into routes/generated/ and applies the cloud
 * decision tree + attribution rules. No solver code is modified.
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const RUNS = [
  { label: "OFF-1", mode: "control" },
  { label: "ON-1", mode: "candidate" },
  { label: "OFF-2", mode: "control" },
  { label: "ON-2", mode: "candidate" },
  { label: "OFF-3", mode: "control" },
  { label: "ON-3", mode: "candidate" },
];

function runOnce(label, mode) {
  const child = spawnSync(
    process.execPath,
    ["--expose-gc", path.resolve(__dirname, ".tmp-qualify-iteration5-run.js"), mode, label],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 120000 },
  );
  if (child.error) throw child.error;
  if (child.status !== 0) {
    throw new Error(`run ${label} failed (${child.status}):\n${child.stderr}\n${child.stdout}`);
  }
  const lines = child.stdout.trim().split("\n");
  return JSON.parse(lines[lines.length - 1]);
}

function main() {
  const results = [];
  for (const { label, mode } of RUNS) {
    process.stderr.write(`running ${label}...\n`);
    const record = runOnce(label, mode);
    results.push(record);
    process.stderr.write(
      `${label}: found=${record.found} outcome=${record.finalCanonicalOutcome} ` +
      `reached=${record.reachedMilestone} stop=${record.budget.stoppedReason} ` +
      `exp=${record.budget.consumedExpansions} wall=${record.wallMs}ms ` +
      `tree=${record.processTree.peakRssMb}MB pending=${record.runWide.finalPending} ` +
      `terminal=${record.runWide.terminalIncomplete} unknown=${record.runWide.unknownCompletion}\n`,
    );
  }

  const byMode = (diversity) => results.filter((r) => r.diversity === diversity);
  const summarize = (list) => ({
    runs: list.length,
    foundCount: list.filter((r) => r.found).length,
    outcomes: list.map((r) => r.finalCanonicalOutcome),
    reached: list.map((r) => r.reachedMilestone),
    failedSegments: list.map((r) => r.failedSegment && `${r.failedSegment.segmentId}:${r.failedSegment.failureClass}`),
    budgetStops: list.map((r) => r.budget.stoppedReason),
    expansions: list.map((r) => r.budget.consumedExpansions),
    wallMs: list.map((r) => r.wallMs),
    peakRssMb: list.map((r) => r.processTree.peakRssMb),
    runWidePending: list.map((r) => r.runWide.finalPending),
    runWideTerminal: list.map((r) => r.runWide.terminalIncomplete),
    runWideUnknown: list.map((r) => r.runWide.unknownCompletion),
  });

  // Attribution helper: any boundary with capacityDrops > 0?
  const capacityDropBoundaries = (list) =>
    list.flatMap((r) =>
      r.boundaries
        .filter((b) => b.capacityDrops > 0)
        .map((b) => `${r.label}/${b.segmentId}:${b.capacityDrops}`),
    );

  const aggregate = {
    schema: "motapathfinder.iteration5-requalification.v1",
    baseCommit: "4c1e4e4b8cc1ac2a08b62b234967c021421cd157",
    config: {
      route: "onlyup-chaos-mt1-mt4",
      searchIntent: "adaptive-feasible",
      adaptiveBacktrackDepth: 3,
      budgetScope: "global-run",
      maxExpansions: 50000,
      maxRuntimeMs: 30000,
      maxRssMb: 256,
      processTreeHardMb: 260,
      candidateLimit: 8,
      freshProcessPerRun: true,
    },
    control: summarize(byMode(false)),
    candidate: summarize(byMode(true)),
    attribution: {
      controlBoundariesWithCapacityDrops: capacityDropBoundaries(byMode(false)),
      candidateBoundariesWithCapacityDrops: capacityDropBoundaries(byMode(true)),
      note: "capacityDrops=0 boundaries cannot support 'retention saved a dropped route' claims; differences there are attributable to resource-diverse rollback ranking / failure-direction changes.",
    },
    runs: results,
  };

  const outDir = path.resolve(__dirname, "routes", "generated");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "iteration5-requalification.json");
  fs.writeFileSync(outPath, JSON.stringify(aggregate, null, 2));
  process.stdout.write(JSON.stringify({
    outPath,
    control: aggregate.control,
    candidate: aggregate.candidate,
    attribution: aggregate.attribution,
  }, null, 2));
}

main();
