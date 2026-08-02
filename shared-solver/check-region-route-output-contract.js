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
} = require("./audit-region-route-output-contract");

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

function assertPreflight(control, expectedId) {
  const preflight = control.preflight;
  assert.strictEqual(preflight.exitCode, 0, `${expectedId}: preflight exit`);
  assert.strictEqual(preflight.summaryParsed, true, `${expectedId}: preflight parsed`);
  assert.strictEqual(preflight.summary.valid, true, `${expectedId}: preflight valid`);
  assert.strictEqual(preflight.summary.schema, "motapathfinder.region-entry-preflight.v1", `${expectedId}: preflight schema`);
  assert.strictEqual(preflight.summary.regionId, expectedId, `${expectedId}: preflight region`);
  assert.deepStrictEqual(preflight.summary.errors, [], `${expectedId}: preflight errors`);
  assert.strictEqual(preflight.outputPathExistsAfter, false, `${expectedId}: preflight must not write route`);
  assertCommandHas(preflight.command, "--validate-only=1", `${expectedId}: preflight command`);
}

function assertPositiveControl(control, expectedId) {
  const expected = CONTROL_EXPECTATIONS[expectedId];
  assert.ok(expected, `${expectedId}: missing fixed expectation`);
  assert.strictEqual(control.id, expectedId);
  assert.strictEqual(control.entryValidation.valid, true, `${expectedId}: entry validation`);
  assert.deepStrictEqual(control.entryValidation.errors, [], `${expectedId}: entry errors`);
  assertPreflight(control, expectedId);

  const probe = control.runnerProbe;
  assert.strictEqual(probe.exitCode, expected.exitCode, `${expectedId}: runner exit`);
  assert.strictEqual(probe.summaryParsed, true, `${expectedId}: runner summary`);
  assert.strictEqual(probe.summary.found, expected.found, `${expectedId}: runner found`);
  assert.strictEqual(probe.errorEvidence, null, `${expectedId}: runner stderr evidence`);
  assert.strictEqual(probe.outputPathExistsAfter, true, `${expectedId}: route output exists`);
  assert.strictEqual(probe.routeReadError, null, `${expectedId}: route read error`);
  assertCommandHas(probe.command, "--project-root=", `${expectedId}: runner command`);
  assertCommandHas(probe.command, "--region-spec=", `${expectedId}: runner command`);
  assertCommandHas(probe.command, "--out=", `${expectedId}: runner command`);
  assertCommandHas(probe.command, "--structured-errors=1", `${expectedId}: runner command`);

  assert.ok(/^[a-f0-9]{64}$/.test(control.specIdentity.sourceSha256), `${expectedId}: spec source hash`);
  assert.ok(/^[a-f0-9]{64}$/.test(control.specIdentity.normalizedSha256), `${expectedId}: spec normalized hash`);
  assert.ok(/^[a-f0-9]{64}$/.test(control.projectIdentity.fingerprintSha256), `${expectedId}: project fingerprint`);
  assert.ok(/^[a-f0-9]{64}$/.test(control.projectIdentity.structuralFingerprintSha256), `${expectedId}: project structural fingerprint`);

  const route = control.routeOutput;
  assert.strictEqual(route.schema, "motapathfinder.route.v1", `${expectedId}: route schema`);
  assert.strictEqual(route.metadata.regionSpecId, expectedId, `${expectedId}: route metadata region ID`);
  assert.strictEqual(route.metadata.regionSpecIdentity.id, expectedId, `${expectedId}: route metadata spec ID`);
  assert.strictEqual(route.metadata.regionSpecIdentity.sourceSha256, control.specIdentity.sourceSha256, `${expectedId}: route source hash`);
  assert.strictEqual(route.metadata.regionSpecIdentity.normalizedSha256, control.specIdentity.normalizedSha256, `${expectedId}: route normalized hash`);
  assert.strictEqual(route.metadata.projectFingerprint.fingerprintSha256, control.projectIdentity.fingerprintSha256, `${expectedId}: route project fingerprint`);
  assert.strictEqual(route.metadata.projectFingerprint.structuralFingerprintSha256, control.projectIdentity.structuralFingerprintSha256, `${expectedId}: route structural fingerprint`);
  assert.deepStrictEqual(route.metadata.projectFingerprint.fingerprintInputs, ["data", "floorOrder", "floorsById", "enemysById", "itemsById", "mapTilesByNumber"], `${expectedId}: route fingerprint inputs`);
  assert.strictEqual(route.reachedMilestone, expected.reachedMilestone, `${expectedId}: reached milestone`);
  assert.strictEqual(route.metadata.reachedMilestone, expected.reachedMilestone, `${expectedId}: metadata reached milestone`);
  assert.strictEqual(route.routePrimitiveCount, expected.primitiveDecisionCount, `${expectedId}: primitive decisions`);
  assert.strictEqual(route.metadata.primitiveDecisionCount, expected.primitiveDecisionCount, `${expectedId}: metadata primitive decisions`);
  assert.deepStrictEqual(route.final, expected.final, `${expectedId}: final floor/hero`);

  assert.strictEqual(control.execution.status, "found", `${expectedId}: execution status`);
  assert.strictEqual(control.execution.routePrimitiveCount, expected.primitiveDecisionCount, `${expectedId}: execution primitive count`);
  assert.deepStrictEqual(control.execution.final, expected.final, `${expectedId}: execution final`);
  assert.strictEqual(control.replay.everyDecisionReparsed, true, `${expectedId}: every decision reparsed`);
  assert.strictEqual(control.replay.reparsedDecisionCount, expected.primitiveDecisionCount, `${expectedId}: replay decision count`);
  assert.strictEqual(control.replay.persistedMacroActionCount, 0, `${expectedId}: persisted macro actions`);
  assert.strictEqual(control.replay.finalExactStateMatches, true, `${expectedId}: replay exact final`);
  assert.strictEqual(control.replay.finalSummaryMatches, true, `${expectedId}: replay summary final`);
  assert.deepStrictEqual(control.replay.final, expected.final, `${expectedId}: replay final`);
  assert.strictEqual(control.outputProvenance.routeWritten, true, `${expectedId}: route provenance`);
  assert.strictEqual(control.outputProvenance.outputPathExistsAfterRun, true, `${expectedId}: route provenance output`);
}

function assertNegativeControl(control, expectedId) {
  const expected = NEGATIVE_CONTROLS.find((candidate) => candidate.id === expectedId);
  assert.ok(expected, `${expectedId}: fixed negative expectation`);
  assert.strictEqual(control.id, expectedId);
  assert.strictEqual(control.expectedStatus, expected.expectedStatus, `${expectedId}: expected status`);
  assert.strictEqual(control.expectedRunnerExitCode, expected.expectedRunnerExitCode, `${expectedId}: expected runner exit`);
  assert.strictEqual(control.entryValidation.valid, true, `${expectedId}: source validation`);
  assertPreflight(control, control.specIdentity.id);
  assert.strictEqual(control.runnerProbe.exitCode, expected.expectedRunnerExitCode, `${expectedId}: runner exit`);
  assert.strictEqual(control.runnerProbe.staleRouteExistedBeforeRunner, true, `${expectedId}: stale route seed`);
  assert.strictEqual(control.runnerProbe.harnessRemovedOutput, false, `${expectedId}: harness cleanup`);
  assert.strictEqual(control.runnerProbe.runnerOwnedCleanup, true, `${expectedId}: runner cleanup`);
  assert.strictEqual(control.staleRouteExistedBeforeRunner, true, `${expectedId}: report stale route seed`);
  assert.strictEqual(control.harnessRemovedOutput, false, `${expectedId}: report harness cleanup`);
  assert.strictEqual(control.runnerOwnedCleanup, true, `${expectedId}: report runner cleanup`);
  assert.strictEqual(control.routeOutputExistsAfterRun, false, `${expectedId}: route output after not-found`);
  assert.strictEqual(control.outputProvenance.routeWritten, false, `${expectedId}: route provenance`);
  if (expected.expectedStatus === "not-found") {
    assert.strictEqual(control.runnerProbe.summaryParsed, true, `${expectedId}: runner summary`);
    assert.strictEqual(control.runnerProbe.summary.found, false, `${expectedId}: runner must not find`);
    assert.strictEqual(control.runnerProbe.errorEvidence, null, `${expectedId}: runner error evidence`);
  } else {
    assert.strictEqual(control.runnerProbe.summaryParsed, false, `${expectedId}: structured failure must not emit summary`);
    assert.strictEqual(control.runnerProbe.errorEvidence.stage, expected.expectedError.stage, `${expectedId}: error stage`);
    assert.strictEqual(control.runnerProbe.errorEvidence.termination, expected.expectedError.termination, `${expectedId}: error termination`);
    assert.strictEqual(control.runnerProbe.errorEvidence.failureClass, expected.expectedError.failureClass, `${expectedId}: error failure class`);
    assert.strictEqual(control.runnerProbe.errorEvidence.failedSegmentId, expected.expectedError.failedSegmentId, `${expectedId}: error failed segment`);
  }
  assertCommandHas(control.runnerProbe.command, "--structured-errors=1", `${expectedId}: runner command`);
}

function assertValidateOnlyPreservation(report) {
  const preservation = report.validateOnlyPreservation;
  assert.ok(preservation, "validate-only preservation report");
  assert.strictEqual(preservation.exitCode, 0, "validate-only preservation exit");
  assert.strictEqual(preservation.summaryParsed, true, "validate-only preservation summary");
  assert.strictEqual(preservation.errorEvidence, null, "validate-only preservation error");
  assert.strictEqual(preservation.staleRouteExistedBeforeRunner, true, "validate-only stale seed");
  assert.strictEqual(preservation.harnessRemovedOutput, false, "validate-only harness cleanup");
  assert.strictEqual(preservation.runnerDeletedOutput, false, "validate-only runner deletion");
  assert.strictEqual(preservation.outputPathExistsAfterRunner, true, "validate-only output preservation");
  assert.strictEqual(preservation.routePreserved, true, "validate-only route preserved");
  assertCommandHas(preservation.command, "--validate-only=1", "validate-only preservation command");
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
  assertValidateOnlyPreservation(report);
  assert.strictEqual(report.contract.id, "PR-4.8b1");
  assert.strictEqual(report.contract.title, "Runner-owned Output Cleanup");
  assert.deepStrictEqual(report.contract.fixedControls, CONTROLS.map((control) => control.id));
  assert.deepStrictEqual(report.contract.negativeControls, NEGATIVE_CONTROLS.map((control) => control.id));
  assert.deepStrictEqual(report.contract.fixedExpectedControlOutcomes, CONTROL_EXPECTATIONS);
  assert.strictEqual(report.controls.length, CONTROLS.length);
  report.controls.forEach((control, index) => assertPositiveControl(control, CONTROLS[index].id));
  assert.strictEqual(report.negativeControls.length, NEGATIVE_CONTROLS.length);
  report.negativeControls.forEach((control, index) => assertNegativeControl(control, NEGATIVE_CONTROLS[index].id));
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
  process.stdout.write(`runner-owned output cleanup contract check passed (${saved.controls.length} positive controls, ${saved.negativeControls.length} negative controls)\n`);
}

if (require.main === module) main();

module.exports = {
  assertReport,
  main,
  normalizeReport,
};
