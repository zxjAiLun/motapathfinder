"use strict";

const assert = require("node:assert");
const fs = require("node:fs");

const {
  CONTRACT_SCHEMA,
  DEFAULT_OUT,
  DEFAULT_OUT_MD,
  buildReport,
  markdownReport,
} = require("./audit-replay-h5save-resume-contract");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeReport(value) {
  const normalized = JSON.parse(JSON.stringify(value));
  if (normalized.provenance) delete normalized.provenance.generationCommit;
  return normalized;
}

function assertReport(report) {
  assert.strictEqual(report.schema, CONTRACT_SCHEMA);
  assert.strictEqual(report.status, "completed");
  assert.strictEqual(report.provenance.mode, "replay-runtime-h5save-resume-artifact");
  assert.strictEqual(report.provenance.deterministicFullReportRebuild, true);
  assert.strictEqual(report.provenance.liveRuntimeExecuted, false);
  assert.strictEqual(report.provenance.productionReplayRuntimeChanged, true);
  assert.strictEqual(report.provenance.productionSolverChanged, false);
  assert.strictEqual(report.provenance.productionDpKeyChanged, false);
  assert.strictEqual(report.provenance.productionDominanceChanged, false);
  assert.strictEqual(report.provenance.productionAgendaChanged, false);
  assert.strictEqual(report.provenance.productionCapacityChanged, false);
  assert.strictEqual(report.provenance.productionDefaultPolicyChanged, false);
  assert.strictEqual(report.provenance.routeSelectionSemanticsChanged, false);
  assert.strictEqual(report.scope.replayRuntimeHardening, true);
  assert.strictEqual(report.scope.noProductionSolverSearchSemanticsChange, true);

  assert.deepStrictEqual(
    report.h5savePackage.topLevelKeys,
    ["name", "version", "data", "__solverResumeArtifact__"],
  );
  assert.strictEqual(report.h5savePackage.encoding, "lz-string base64 JSON");
  assert.strictEqual(report.h5savePackage.artifactSchema, "motapathfinder.replay-resume-artifact.v1");

  assert.strictEqual(report.boundary.executedStepCount, 1);
  assert.strictEqual(report.boundary.nextStep, 2);
  assert.strictEqual(report.boundary.exactStateKeyMatchesRoute, true);
  assert.strictEqual(report.boundary.nextDecision.index, 2);
  assert.strictEqual(report.boundary.nextDecision.kind, "battle");
  assert.strictEqual(report.boundary.routeSnapshotStored, true);
  assert.strictEqual(report.boundary.runtimeSnapshotStored, true);
  assert.strictEqual(report.boundary.identityMatches, true);
  assert.strictEqual(report.boundary.runtimeSnapshotIdentity, report.boundary.capturedRuntimeSnapshotIdentity);

  assert.strictEqual(report.continuation.suffixDecisionCount, 1);
  assert.strictEqual(report.continuation.finalExactStateKeyMatchesRoute, true);
  assert.strictEqual(report.continuation.routeFinalSnapshotStored, true);
  assert.strictEqual(report.continuation.finalRuntimeSnapshotStored, true);
  assert.strictEqual(report.continuation.identityMatches, true);
  assert.strictEqual(report.continuation.runtimeSnapshotIdentity, report.continuation.capturedRuntimeSnapshotIdentity);

  assert.strictEqual(report.freshRuntime.required, true);
  assert.strictEqual(report.freshRuntime.liveRuntimeExecuted, false);
  assert.strictEqual(report.freshRuntime.liveChecker, "shared-solver/check-replay-h5save-resume-live.js");

  assert.deepStrictEqual(
    report.mismatchControls.map((control) => control.id),
    ["project-fingerprint-mismatch", "route-fingerprint-mismatch"],
  );
  assert.deepStrictEqual(
    report.mismatchControls.map((control) => control.expectedErrorCode),
    ["REPLAY_RESUME_PROJECT_FINGERPRINT_MISMATCH", "REPLAY_RESUME_ROUTE_FINGERPRINT_MISMATCH"],
  );
}

async function main() {
  assert.ok(fs.existsSync(DEFAULT_OUT), "saved h5save resume report must exist");
  assert.ok(fs.existsSync(DEFAULT_OUT_MD), "saved h5save resume markdown must exist");
  const saved = readJson(DEFAULT_OUT);
  const savedMarkdown = fs.readFileSync(DEFAULT_OUT_MD, "utf8");
  assertReport(saved);
  assert.ok(savedMarkdown.includes(CONTRACT_SCHEMA), "markdown schema");

  const rebuilt = buildReport();
  assertReport(rebuilt);
  assert.deepStrictEqual(normalizeReport(rebuilt), normalizeReport(saved), "full report rebuild must be deterministic");
  assert.strictEqual(markdownReport(rebuilt), savedMarkdown, "markdown rebuild must be deterministic");
  process.stdout.write("replay h5save resume contract check passed (artifact schema, boundary, continuation, mismatch controls)\n");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  });
}

module.exports = { assertReport, main, normalizeReport };
