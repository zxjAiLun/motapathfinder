"use strict";

const assert = require("node:assert");
const fs = require("node:fs");

const {
  CONTROLS,
  CONTROL_EXPECTATIONS,
  CONTRACT_SCHEMA,
  DEFAULT_OUT,
  DEFAULT_OUT_MD,
  NEGATIVE_CONTROLS,
  buildReport,
  markdownReport,
} = require("./audit-region-entry-contract");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeReport(value) {
  const normalized = JSON.parse(JSON.stringify(value));
  delete normalized.generatedAt;
  if (normalized.provenance) delete normalized.provenance.generationCommit;
  return normalized;
}

function assertCommandHas(command, prefix, label) {
  assert.ok(Array.isArray(command), `${label}: command must be an array`);
  assert.ok(command.some((arg) => String(arg).startsWith(prefix)), `${label}: missing ${prefix}`);
}

function assertPreflight(control, expectedId, expected) {
  const preflightExpected = expected.preflight;
  const preflight = control.preflight;
  assert.ok(preflight && typeof preflight === "object", `${expectedId}: preflight report`);
  assert.strictEqual(preflight.mode, "validate-only", `${expectedId}: preflight mode`);
  assert.strictEqual(preflight.exitCode, preflightExpected.exitCode, `${expectedId}: preflight exit code`);
  assert.strictEqual(preflight.summaryParsed, preflightExpected.summaryParsed, `${expectedId}: preflight summary`);
  assert.strictEqual(preflight.summary.valid, preflightExpected.valid, `${expectedId}: preflight valid`);
  assert.strictEqual(preflight.summary.schema, "motapathfinder.region-entry-preflight.v1", `${expectedId}: preflight schema`);
  assert.strictEqual(preflight.summary.regionId, expectedId, `${expectedId}: preflight region`);
  assert.strictEqual(preflight.summary.milestoneOrder.length, expected.effectiveMilestoneCount, `${expectedId}: preflight milestone count`);
  assert.strictEqual(preflight.summary.checks.regionSpecLoaded, true, `${expectedId}: spec loaded`);
  assert.strictEqual(preflight.summary.checks.projectLoaded, true, `${expectedId}: project loaded`);
  assert.strictEqual(preflight.summary.checks.milestoneSpecBuilt, true, `${expectedId}: milestone graph built`);
  assert.strictEqual(preflight.summary.checks.prefixBoundaryResolved, true, `${expectedId}: prefix boundary`);
  assert.strictEqual(preflight.summary.checks.outputPathParseable, true, `${expectedId}: output path`);
  assert.strictEqual(preflight.errorEvidence, null, `${expectedId}: unexpected preflight error`);
  assert.strictEqual(preflight.outputPathExistsAfter, false, `${expectedId}: validate-only must not write route`);
  assertCommandHas(preflight.command, "--project-root=", `${expectedId}: preflight command`);
  assertCommandHas(preflight.command, "--region-spec=", `${expectedId}: preflight command`);
  assertCommandHas(preflight.command, "--out=", `${expectedId}: preflight command`);
  assertCommandHas(preflight.command, "--validate-only=1", `${expectedId}: preflight command`);
}

function assertControl(control, expectedId) {
  const expected = CONTROL_EXPECTATIONS[expectedId];
  assert.ok(expected, `${expectedId}: expected control map`);
  assert.strictEqual(control.id, expectedId);
  assert.ok(control.specIdentity, `${expectedId}: spec identity`);
  assert.ok(/^[a-f0-9]{64}$/.test(control.specIdentity.sourceSha256), `${expectedId}: source hash`);
  assert.ok(/^[a-f0-9]{64}$/.test(control.specIdentity.normalizedSha256), `${expectedId}: normalized spec hash`);
  assert.ok(control.projectIdentity, `${expectedId}: project identity`);
  assert.ok(/^[a-f0-9]{64}$/.test(control.projectIdentity.fingerprintSha256), `${expectedId}: project fingerprint`);
  assert.ok(/^[a-f0-9]{64}$/.test(control.projectIdentity.structuralFingerprintSha256), `${expectedId}: structural fingerprint`);
  assert.deepStrictEqual(control.projectIdentity.fingerprintInputs, ["data", "floorOrder", "floorsById", "enemysById", "itemsById", "mapTilesByNumber"], `${expectedId}: fingerprint inputs`);
  assert.strictEqual(control.milestoneOrder.length, expected.effectiveMilestoneCount, `${expectedId}: milestone order`);
  assert.ok(control.startCheckpoint && typeof control.startCheckpoint.type === "string", `${expectedId}: start checkpoint`);
  assert.strictEqual(control.entryValidation.valid, true, `${expectedId}: entry validation`);
  assert.deepStrictEqual(control.entryValidation.errors, [], `${expectedId}: entry validation errors`);
  assertPreflight(control, expectedId, expected);

  const execution = control.execution;
  assert.ok(execution && typeof execution === "object", `${expectedId}: execution report`);
  assert.strictEqual(execution.status, expected.probe.status, `${expectedId}: execution status`);
  assert.strictEqual(execution.stage, expected.probe.stage || "region-dp", `${expectedId}: execution stage`);
  assert.strictEqual(execution.termination, expected.probe.termination, `${expectedId}: execution termination`);
  assert.strictEqual(execution.failureClass, expected.probe.failureClass, `${expectedId}: execution failure class`);
  assert.strictEqual(execution.failedSegmentId, expected.probe.failedSegmentId || null, `${expectedId}: failed segment`);
  assert.ok(Object.prototype.hasOwnProperty.call(execution, "reachedMilestone"), `${expectedId}: reached milestone field`);
  assert.strictEqual(execution.routePrimitiveCount, 0, `${expectedId}: route primitive count`);
  assert.ok(execution.budgetUsage && execution.budgetUsage.configuredProbe, `${expectedId}: budget usage`);
  assert.ok(execution.budgetUsage.configuredProbe.maxExpansions > 0, `${expectedId}: max expansions`);
  assert.ok(execution.budgetUsage.configuredProbe.maxRuntimeMs > 0, `${expectedId}: max runtime`);
  assert.strictEqual(execution.budgetUsage.usedExpansions, expected.probe.usedExpansions, `${expectedId}: used expansions`);
  const configuredBudget = execution.budgetUsage.configuredProbe.prefixMaxExpansions || execution.budgetUsage.configuredProbe.maxExpansions;
  assert.ok(execution.budgetUsage.usedExpansions <= configuredBudget, `${expectedId}: expansion budget overrun`);

  const provenance = control.outputProvenance;
  assert.strictEqual(provenance.entrypoint, "shared-solver/run-region-dp.js", `${expectedId}: entrypoint provenance`);
  assert.strictEqual(provenance.liveVerified, false, `${expectedId}: live verification boundary`);
  assert.strictEqual(provenance.probeMode, "bounded-entry-probe", `${expectedId}: probe mode`);
  assertCommandHas(provenance.command, "--project-root=", `${expectedId}: runner command`);
  assertCommandHas(provenance.command, "--region-spec=", `${expectedId}: runner command`);
  assertCommandHas(provenance.command, "--out=", `${expectedId}: runner command`);
  assertCommandHas(provenance.command, "--structured-errors=1", `${expectedId}: runner command`);
  assert.strictEqual(provenance.routeWritten, expected.probe.routeWritten, `${expectedId}: route written`);
  assert.strictEqual(provenance.routeWritten, execution.found, `${expectedId}: route/found consistency`);
  assert.strictEqual(provenance.outputPathExistsAfterProbe, expected.probe.routeWritten, `${expectedId}: output provenance`);

  assert.strictEqual(control.runnerProbe.invoked, true, `${expectedId}: probe invoked`);
  assert.strictEqual(control.runnerProbe.mode, "bounded-entry-probe", `${expectedId}: probe mode`);
  assert.strictEqual(control.runnerProbe.exitCode, expected.probe.exitCode, `${expectedId}: probe exit code`);
  assert.strictEqual(control.runnerProbe.summaryParsed, expected.probe.summaryParsed, `${expectedId}: probe summary`);
  assert.strictEqual(control.runnerProbe.errorCode, null, `${expectedId}: spawn error`);
  if (expected.probe.summaryParsed) {
    assert.strictEqual(control.runnerProbe.stderrParsed, false, `${expectedId}: unexpected stderr evidence`);
    assert.strictEqual(control.runnerProbe.summary.metrics.expansions, expected.probe.usedExpansions, `${expectedId}: summary expansions`);
  } else {
    assert.strictEqual(control.runnerProbe.stderrParsed, true, `${expectedId}: structured stderr evidence`);
    assert.deepStrictEqual({
      stage: control.runnerProbe.errorEvidence.stage,
      termination: control.runnerProbe.errorEvidence.termination,
      failureClass: control.runnerProbe.errorEvidence.failureClass,
      failedSegmentId: control.runnerProbe.errorEvidence.failedSegmentId,
      usedExpansions: control.runnerProbe.errorEvidence.usedExpansions,
    }, {
      stage: expected.probe.stage,
      termination: expected.probe.termination,
      failureClass: expected.probe.failureClass,
      failedSegmentId: expected.probe.failedSegmentId,
      usedExpansions: expected.probe.usedExpansions,
    }, `${expectedId}: structured failure evidence`);
  }
}

function assertNegativeControl(control, expected) {
  assert.strictEqual(control.id, expected.id);
  assert.strictEqual(control.expectedError, expected.expectedError, `${expected.id}: expected error`);
  assert.strictEqual(control.rejected, true, `${expected.id}: rejection`);
  assert.ok(control.observedErrors.includes(expected.expectedError), `${expected.id}: observed error code`);
  assert.ok(/^[a-f0-9]{64}$/.test(control.inputSha256), `${expected.id}: input hash`);
  assert.ok(/^[a-f0-9]{64}$/.test(control.specNormalizedSha256), `${expected.id}: normalized hash`);
  assert.strictEqual(control.cli.exitCode, 2, `${expected.id}: CLI rejection exit code`);
  assert.strictEqual(control.cli.summaryParsed, true, `${expected.id}: CLI structured summary`);
  assert.strictEqual(control.cli.summary.valid, false, `${expected.id}: CLI invalid summary`);
  assert.ok(control.cli.summary.errorCodes.includes(expected.expectedError), `${expected.id}: CLI observed error code`);
  assert.strictEqual(control.cli.errorEvidence, null, `${expected.id}: unexpected CLI stderr error`);
  assert.strictEqual(control.cli.routeOutputExistsAfter, false, `${expected.id}: invalid spec must not write route`);
  assertCommandHas(control.cli.command, "--validate-only=1", `${expected.id}: CLI command`);
  assertCommandHas(control.cli.command, "--region-spec=", `${expected.id}: CLI command`);
  assertCommandHas(control.cli.command, "--out=", `${expected.id}: CLI command`);
}

function assertReport(report) {
  assert.strictEqual(report.schema, CONTRACT_SCHEMA);
  assert.strictEqual(report.status, "completed");
  assert.strictEqual(report.provenance.mode, "shadow-only");
  assert.strictEqual(report.provenance.entrypoint, "shared-solver/run-region-dp.js");
  assert.ok(/^[0-9a-f]+$/.test(report.provenance.generationCommit), "generation commit");
  assert.strictEqual(report.provenance.deterministicFullReportRebuild, true);
  assert.strictEqual(report.provenance.productionDpKeyChanged, false);
  assert.strictEqual(report.provenance.productionDominanceChanged, false);
  assert.strictEqual(report.provenance.productionAgendaChanged, false);
  assert.strictEqual(report.provenance.productionCapacityChanged, false);
  assert.strictEqual(report.provenance.productionDefaultPolicyChanged, false);
  assert.strictEqual(report.provenance.describesCompleteTowerRoute, false);
  assert.strictEqual(report.scope.shadowOnly, true);
  assert.strictEqual(report.scope.productionDpKeyChanged, false);
  assert.strictEqual(report.scope.productionDominanceChanged, false);
  assert.strictEqual(report.scope.productionAgendaChanged, false);
  assert.strictEqual(report.scope.productionCapacityChanged, false);
  assert.strictEqual(report.scope.productionDefaultPolicyChanged, false);
  assert.strictEqual(report.scope.describesCompleteTowerRoute, false);

  assert.strictEqual(report.contract.id, "PR-4.8a1");
  assert.ok(report.contract.unifiedEntry.command.includes("run-region-dp.js"));
  assert.deepStrictEqual(report.contract.fixedControls, CONTROLS.map((control) => control.id));
  assert.deepStrictEqual(report.contract.negativeControls, NEGATIVE_CONTROLS.map((control) => control.id));
  assert.strictEqual(report.contract.deterministicLiveRebuild, true);
  assert.ok(report.contract.requiredReportFields.includes("specIdentity"));
  assert.ok(report.contract.requiredReportFields.includes("budgetUsage"));
  assert.ok(report.contract.requiredReportFields.includes("preflight"));
  assert.deepStrictEqual(report.contract.fixedExpectedControlOutcomes, CONTROL_EXPECTATIONS);

  assert.strictEqual(report.controls.length, CONTROLS.length);
  const controlIds = new Set();
  report.controls.forEach((control, index) => {
    assert.ok(!controlIds.has(control.id), `duplicate control ${control.id}`);
    controlIds.add(control.id);
    assertControl(control, CONTROLS[index].id);
  });

  assert.strictEqual(report.negativeControls.length, NEGATIVE_CONTROLS.length);
  report.negativeControls.forEach((control, index) => assertNegativeControl(control, NEGATIVE_CONTROLS[index]));
}

function main() {
  const saved = readJson(DEFAULT_OUT);
  assert.ok(fs.existsSync(DEFAULT_OUT_MD), "markdown report must exist");
  const savedMarkdown = fs.readFileSync(DEFAULT_OUT_MD, "utf8");
  assert.ok(savedMarkdown.includes(CONTRACT_SCHEMA), "markdown schema");
  CONTROLS.forEach((control) => assert.ok(savedMarkdown.includes(control.id), `${control.id}: markdown control`));
  NEGATIVE_CONTROLS.forEach((control) => assert.ok(savedMarkdown.includes(control.id), `${control.id}: markdown negative control`));
  assertReport(saved);
  const rebuilt = buildReport();
  assertReport(rebuilt);
  assert.deepStrictEqual(normalizeReport(rebuilt), normalizeReport(saved), "full report rebuild must be deterministic");
  assert.strictEqual(markdownReport(rebuilt), savedMarkdown, "markdown rebuild must be deterministic");
  process.stdout.write(`region entry contract check passed (${saved.controls.length} controls, ${saved.negativeControls.length} negative controls)\n`);
}

if (require.main === module) main();

module.exports = {
  assertReport,
  main,
  normalizeReport,
};
