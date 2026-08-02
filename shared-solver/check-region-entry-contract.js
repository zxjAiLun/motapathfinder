"use strict";

const assert = require("node:assert");
const fs = require("node:fs");

const {
  CONTROLS,
  CONTRACT_SCHEMA,
  DEFAULT_OUT,
  NEGATIVE_CONTROLS,
  buildReport,
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

function assertControl(control, expectedId) {
  assert.strictEqual(control.id, expectedId);
  assert.ok(control.specIdentity, `${expectedId}: spec identity`);
  assert.ok(/^[a-f0-9]{64}$/.test(control.specIdentity.sourceSha256), `${expectedId}: source hash`);
  assert.ok(/^[a-f0-9]{64}$/.test(control.specIdentity.normalizedSha256), `${expectedId}: normalized spec hash`);
  assert.ok(control.projectIdentity, `${expectedId}: project identity`);
  assert.ok(/^[a-f0-9]{64}$/.test(control.projectIdentity.fingerprintSha256), `${expectedId}: project fingerprint`);
  assert.ok(Array.isArray(control.milestoneOrder) && control.milestoneOrder.length > 0, `${expectedId}: milestone order`);
  assert.ok(control.startCheckpoint && typeof control.startCheckpoint.type === "string", `${expectedId}: start checkpoint`);
  assert.strictEqual(control.entryValidation.valid, true, `${expectedId}: entry validation`);
  assert.deepStrictEqual(control.entryValidation.errors, [], `${expectedId}: entry validation errors`);

  const execution = control.execution;
  assert.ok(execution && typeof execution === "object", `${expectedId}: execution report`);
  assert.ok(["found", "not-found", "runner-error"].includes(execution.status), `${expectedId}: execution status`);
  assert.ok(Object.prototype.hasOwnProperty.call(execution, "reachedMilestone"), `${expectedId}: reached milestone field`);
  assert.ok(Object.prototype.hasOwnProperty.call(execution, "failureClass"), `${expectedId}: failure class field`);
  assert.ok(Number.isFinite(execution.routePrimitiveCount) && execution.routePrimitiveCount >= 0, `${expectedId}: route primitive count`);
  assert.ok(execution.budgetUsage && execution.budgetUsage.configuredProbe, `${expectedId}: budget usage`);
  assert.ok(execution.budgetUsage.configuredProbe.maxExpansions > 0, `${expectedId}: max expansions`);
  assert.ok(execution.budgetUsage.configuredProbe.maxRuntimeMs > 0, `${expectedId}: max runtime`);

  const provenance = control.outputProvenance;
  assert.strictEqual(provenance.entrypoint, "shared-solver/run-region-dp.js", `${expectedId}: entrypoint provenance`);
  assert.strictEqual(provenance.liveVerified, false, `${expectedId}: live verification boundary`);
  assert.strictEqual(provenance.probeMode, "bounded-entry-probe", `${expectedId}: probe mode`);
  assertCommandHas(provenance.command, "--project-root=", `${expectedId}: runner command`);
  assertCommandHas(provenance.command, "--region-spec=", `${expectedId}: runner command`);
  assertCommandHas(provenance.command, "--out=", `${expectedId}: runner command`);

  assert.strictEqual(control.runnerProbe.invoked, true, `${expectedId}: probe invoked`);
  assert.strictEqual(control.runnerProbe.mode, "bounded-entry-probe", `${expectedId}: probe mode`);
  assert.ok(control.runnerProbe.summaryParsed || control.runnerProbe.errorCode || control.runnerProbe.exitCode !== 0,
    `${expectedId}: probe must produce a summary or an explicit runner failure`);
}

function assertNegativeControl(control, expected) {
  assert.strictEqual(control.id, expected.id);
  assert.strictEqual(control.expectedError, expected.expectedError, `${expected.id}: expected error`);
  assert.strictEqual(control.rejected, true, `${expected.id}: rejection`);
  assert.ok(control.observedErrors.includes(expected.expectedError), `${expected.id}: observed error code`);
  assert.ok(/^[a-f0-9]{64}$/.test(control.specNormalizedSha256), `${expected.id}: normalized hash`);
}

function assertReport(report) {
  assert.strictEqual(report.schema, CONTRACT_SCHEMA);
  assert.strictEqual(report.status, "completed");
  assert.strictEqual(report.provenance.mode, "shadow-only");
  assert.strictEqual(report.provenance.entrypoint, "shared-solver/run-region-dp.js");
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

  assert.strictEqual(report.contract.id, "PR-4.8a");
  assert.ok(report.contract.unifiedEntry.command.includes("run-region-dp.js"));
  assert.deepStrictEqual(report.contract.fixedControls, CONTROLS.map((control) => control.id));
  assert.deepStrictEqual(report.contract.negativeControls, NEGATIVE_CONTROLS.map((control) => control.id));
  assert.strictEqual(report.contract.deterministicLiveRebuild, true);
  assert.ok(report.contract.requiredReportFields.includes("specIdentity"));
  assert.ok(report.contract.requiredReportFields.includes("budgetUsage"));

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
  assertReport(saved);
  const rebuilt = buildReport();
  assertReport(rebuilt);
  assert.deepStrictEqual(normalizeReport(rebuilt), normalizeReport(saved), "full report rebuild must be deterministic");
  process.stdout.write(`region entry contract check passed (${saved.controls.length} controls, ${saved.negativeControls.length} negative controls)\n`);
}

if (require.main === module) main();

module.exports = {
  assertReport,
  main,
  normalizeReport,
};
