"use strict";

const assert = require("node:assert");
const fs = require("node:fs");

const {
  CONTRACT_SCHEMA,
  DEFAULT_OUT,
  DEFAULT_OUT_MD,
  buildReport,
  markdownReport,
} = require("./audit-replay-flag-merge-cli-contract");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeReport(value) {
  const normalized = JSON.parse(JSON.stringify(value));
  delete normalized.generatedAt;
  if (normalized.provenance) delete normalized.provenance.generationCommit;
  return normalized;
}

function assertReport(report) {
  assert.strictEqual(report.schema, CONTRACT_SCHEMA);
  assert.strictEqual(report.status, "completed");
  assert.strictEqual(report.provenance.mode, "replay-runtime-flag-merge-cli");
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
  assert.strictEqual(report.scope.shadowOnly, false);
  assert.strictEqual(report.scope.replayRuntimeHardening, true);
  assert.strictEqual(report.scope.noProductionSolverSearchSemanticsChange, true);

  const cli = report.controls.directCli;
  assert.strictEqual(cli.rawInput, "abc");
  assert.notStrictEqual(cli.exitCode, 0);
  assert.strictEqual(cli.errorCode, "REPLAY_STEP_OUT_OF_RANGE");
  assert.strictEqual(cli.serverStarted, false);
  assert.strictEqual(cli.browserOpened, false);
  assert.strictEqual(cli.runtimeStarted, false);

  const control = report.controls.checkpointContinuation;
  assert.strictEqual(control.sourceFloor, "A1");
  assert.strictEqual(control.checkpointFloor, "A2");
  assert.match(control.actions.initialChangeFloor, /^changeFloor@A1:/);
  assert.match(control.actions.checkpointChangeFloor, /^changeFloor@A2:/);
  assert.match(control.actions.floorFly, /^floorFly:A2@A1:/);
  assert.strictEqual(control.flyRecordPosition, true);
  assert.deepStrictEqual(control.expectedBaseline, { x: 6, y: 6, direction: "down" });
  assert.deepStrictEqual(control.expectedCurrentLeaveLoc, { x: 11, y: 2, direction: "down" });
  assert.strictEqual(control.continuation.state, "completed");
  assert.strictEqual(control.continuation.runtimeSnapshotIdentityMatches, true);
  assert.strictEqual(control.continuation.runtimeProjectedSolverStateMatches, true);
  assert.deepStrictEqual(control.continuation.finalHeroLoc, { x: 11, y: 2, direction: "down" });
  assert.deepStrictEqual(control.continuation.finalLeaveLoc.Start, control.expectedBaseline);
  assert.deepStrictEqual(control.continuation.finalLeaveLoc.A2, control.expectedCurrentLeaveLoc);
  assert.strictEqual(control.mismatchControls.length, 2);
  control.mismatchControls.forEach((mismatch) => {
    assert.strictEqual(mismatch.identityMatches, false);
    assert.ok(mismatch.mismatch);
    assert.match(mismatch.expectedRuntimeSnapshotIdentity, /^sha256:[a-f0-9]{64}$/);
    assert.match(mismatch.divergentRuntimeSnapshotIdentity, /^sha256:[a-f0-9]{64}$/);
  });
}

async function main() {
  assert.ok(fs.existsSync(DEFAULT_OUT), "saved checkpoint flag merge report must exist");
  assert.ok(fs.existsSync(DEFAULT_OUT_MD), "saved checkpoint flag merge markdown must exist");
  const saved = readJson(DEFAULT_OUT);
  const savedMarkdown = fs.readFileSync(DEFAULT_OUT_MD, "utf8");
  assert.ok(savedMarkdown.includes(CONTRACT_SCHEMA), "markdown schema");
  assertReport(saved);

  const rebuilt = await buildReport();
  assertReport(rebuilt);
  assert.deepStrictEqual(normalizeReport(rebuilt), normalizeReport(saved), "full report rebuild must be deterministic");
  assert.strictEqual(markdownReport(rebuilt), savedMarkdown, "markdown rebuild must be deterministic");
  process.stdout.write("replay flag merge and CLI gate contract check passed (per-floor continuation, mismatch, direct CLI)\n");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  });
}

module.exports = { assertReport, main, normalizeReport };
