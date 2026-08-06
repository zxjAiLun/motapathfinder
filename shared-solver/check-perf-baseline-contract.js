"use strict";

/**
 * TEST GRADE: unit-plus-micro
 *
 * PR-5.4b Commit 1 — performance baseline contract.  Verifies that the fixed
 * OnlyUp baseline:
 * 1. produces the same search result as the plain task execution (no semantic
 *    change from the perf hooks),
 * 2. emits a stable, fixed-schema report with all required perf fields,
 * 3. is structurally consistent across two consecutive runs (values may vary).
 */

const assert = require("node:assert");
const path = require("node:path");

const { compileExecutableSolveTask } = require("./lib/solve-task");
const { executeSolveJob } = require("./lib/solver-job");
const { BASELINE_SCHEMA, buildBaselineTask, runPerfBaseline } = require("./bench-perf-baseline");

const REQUIRED_PHASES = ["cloneState", "reachability", "buildDpStateKey", "enumerateActions", "applyAction"];

function assertReportShape(report, label) {
  assert.strictEqual(report.schema, BASELINE_SCHEMA, `${label}: schema must be stable`);
  assert.ok(report.task && report.task.taskFingerprint, `${label}: task fingerprint required`);
  assert.ok(report.task.regionId, `${label}: regionId required`);
  assert.ok(report.result, `${label}: result required`);
  assert.strictEqual(typeof report.perf.wallMs, "number", `${label}: wallMs required`);
  assert.strictEqual(typeof report.perf.peakRssMb, "number", `${label}: peakRssMb required`);
  assert.strictEqual(typeof report.perf.peakHeapUsedMb, "number", `${label}: peakHeapUsedMb required`);
  assert.ok(report.perf.peakRssMb > 0, `${label}: peakRssMb must be positive`);
  assert.ok(report.perf.expanded >= 1, `${label}: expanded counter required`);
  assert.ok(report.perf.generated >= 1, `${label}: generated counter required`);
  assert.ok(report.perf.registered >= 1, `${label}: registered counter required`);
  assert.ok(typeof report.perf.dominated === "number", `${label}: dominated counter required`);
  assert.strictEqual(typeof report.perf.expandedPerSec, "number", `${label}: expandedPerSec required`);
  assert.ok(report.perf.phaseMs, `${label}: phaseMs required`);
  assert.ok(report.perf.phaseCounts, `${label}: phaseCounts required`);
  REQUIRED_PHASES.forEach((phase) => {
    assert.strictEqual(typeof report.perf.phaseMs[phase], "number", `${label}: phaseMs[${phase}] required`);
    assert.ok(report.perf.phaseCounts[phase] >= 1, `${label}: phaseCounts[${phase}] must be >= 1`);
  });
  assert.ok(report.perf.depth, `${label}: depth required`);
  assert.strictEqual(typeof report.perf.depth.avgDecisionDepth, "number", `${label}: avgDecisionDepth required`);
  assert.strictEqual(typeof report.perf.depth.maxDecisionDepth, "number", `${label}: maxDecisionDepth required`);
}

async function runReferenceResult() {
  const task = buildBaselineTask();
  const execution = await executeSolveJob(task, {
    jobId: "perf-baseline-reference",
    onProgress: () => {},
    shouldStop: () => false,
    context: {},
  });
  return {
    found: Boolean(execution.result && execution.result.found),
    routeDecisionCount: execution.routeRecord && execution.routeRecord.decisions
      ? execution.routeRecord.decisions.length
      : null,
  };
}

async function main() {
  // 1. First run: full shape + result parity with the plain execution.
  const first = await runPerfBaseline();
  assertReportShape(first, "run-1");
  const reference = await runReferenceResult();
  assert.strictEqual(first.result.found, reference.found, "baseline result.found must match the plain execution");
  assert.strictEqual(
    first.result.routeDecisionCount,
    reference.routeDecisionCount,
    "baseline route decision count must match the plain execution",
  );
  assert.strictEqual(first.result.found, true, "the smoke baseline must reach the goal");

  // 2. Second run: structural consistency (same schema, same phases, same task).
  const second = await runPerfBaseline();
  assertReportShape(second, "run-2");
  assert.strictEqual(second.task.taskFingerprint, first.task.taskFingerprint, "task fingerprint must be stable");
  assert.strictEqual(second.result.found, first.result.found, "found must be stable across runs");
  assert.deepStrictEqual(
    Object.keys(second.perf.phaseMs).sort(),
    Object.keys(first.perf.phaseMs).sort(),
    "phase name set must be stable across runs",
  );
  assert.deepStrictEqual(
    Object.keys(second.perf.phaseCounts).sort(),
    Object.keys(first.perf.phaseCounts).sort(),
    "phase count key set must be stable across runs",
  );
  assert.deepStrictEqual(
    Object.keys(second.perf).sort(),
    Object.keys(first.perf).sort(),
    "perf field set must be stable across runs",
  );

  process.stdout.write(JSON.stringify({
    schema: "motapathfinder.pr-5.4b-perf-baseline.v1",
    status: "passed",
    controls: {
      resultParityWithPlainExecution: true,
      outputSchemaStable: true,
      requiredPhasesPresent: true,
      depthReported: true,
      consecutiveRunsStructurallyConsistent: true,
    },
    perf: {
      found: first.result.found,
      routeDecisionCount: first.result.routeDecisionCount,
      wallMs: first.perf.wallMs,
      peakRssMb: first.perf.peakRssMb,
      peakHeapUsedMb: first.perf.peakHeapUsedMb,
      expanded: first.perf.expanded,
      generated: first.perf.generated,
      registered: first.perf.registered,
      dominated: first.perf.dominated,
      depth: first.perf.depth,
      phaseMs: first.perf.phaseMs,
    },
  }, null, 2) + "\n");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}

module.exports = { main };
