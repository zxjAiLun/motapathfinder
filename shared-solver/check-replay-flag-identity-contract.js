"use strict";

const assert = require("node:assert");
const fs = require("node:fs");

const {
  CONTRACT_SCHEMA,
  DEFAULT_OUT,
  DEFAULT_OUT_MD,
  buildReport,
  markdownReport,
} = require("./audit-replay-flag-identity-contract");

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
  assert.strictEqual(report.provenance.mode, "replay-flag-identity-shadow");
  assert.strictEqual(report.provenance.deterministicFullReportRebuild, true);
  assert.strictEqual(report.provenance.liveRuntimeExecuted, false);
  assert.strictEqual(report.provenance.productionSolverChanged, false);
  assert.strictEqual(report.provenance.productionDpKeyChanged, false);
  assert.strictEqual(report.provenance.productionDominanceChanged, false);
  assert.strictEqual(report.provenance.productionAgendaChanged, false);
  assert.strictEqual(report.provenance.productionCapacityChanged, false);
  assert.strictEqual(report.provenance.productionDefaultPolicyChanged, false);
  assert.strictEqual(report.provenance.routeSelectionSemanticsChanged, false);
  assert.strictEqual(report.scope.shadowOnly, true);
  assert.strictEqual(report.scope.persistedSolverExactStateKey.includes("separately"), true);

  const cli = report.controls.cliNonnumeric;
  assert.strictEqual(cli.rawInput, "abc");
  assert.strictEqual(cli.preservedByRouteGui, "abc");
  assert.ok(cli.sessionContract.includes("HTTP 400"));
  assert.strictEqual(cli.session.rejected, true);
  assert.strictEqual(cli.session.statusCode, 400);
  assert.strictEqual(cli.session.runtimeLaunched, false);
  assert.strictEqual(cli.session.sessionState, "idle");

  const checkpoint = report.controls.checkpoint;
  assert.strictEqual(checkpoint.sourceStep, 1);
  assert.deepStrictEqual(checkpoint.expectedRuntimeFlags.__leaveLoc__.Start, {
    x: 6,
    y: 6,
    direction: "down",
  });
  assert.strictEqual(checkpoint.continuation.state, "completed");
  assert.strictEqual(checkpoint.continuation.runtimeSnapshotIdentityMatches, true);
  assert.strictEqual(
    checkpoint.continuation.runtimeSnapshotIdentity,
    checkpoint.continuation.expectedRuntimeSnapshotIdentity,
  );

  const crossFloor = report.controls.crossFloor;
  assert.strictEqual(crossFloor.flyRecordPosition, true);
  assert.match(crossFloor.actions.changeFloor, /^changeFloor@MT1:/);
  assert.match(crossFloor.actions.floorFly, /^floorFly:MT1@MT2:/);
  assert.deepStrictEqual(crossFloor.leaveLocAfterChangeFloor.MT1, {
    x: 6,
    y: 0,
    direction: "up",
  });
  assert.strictEqual(crossFloor.continuation.state, "completed");
  assert.strictEqual(crossFloor.continuation.runtimeSnapshotIdentityMatches, true);
  assert.deepStrictEqual(crossFloor.continuation.finalHeroLoc, { x: 6, y: 0, direction: "up" });
  assert.notDeepStrictEqual(
    crossFloor.mismatchControl.expectedFinalHeroLoc,
    crossFloor.mismatchControl.divergentFinalHeroLoc,
  );
  assert.strictEqual(crossFloor.mismatchControl.identityMatches, false);
  assert.ok(crossFloor.mismatchControl.mismatch);
  assert.match(crossFloor.mismatchControl.expectedRuntimeSnapshotIdentity, /^sha256:[a-f0-9]{64}$/);
  assert.match(crossFloor.mismatchControl.divergentRuntimeSnapshotIdentity, /^sha256:[a-f0-9]{64}$/);
}

async function main() {
  assert.ok(fs.existsSync(DEFAULT_OUT), "saved replay flag identity report must exist");
  assert.ok(fs.existsSync(DEFAULT_OUT_MD), "saved replay flag identity markdown must exist");
  const saved = readJson(DEFAULT_OUT);
  const savedMarkdown = fs.readFileSync(DEFAULT_OUT_MD, "utf8");
  assert.ok(savedMarkdown.includes(CONTRACT_SCHEMA), "markdown schema");
  assertReport(saved);

  const rebuilt = await buildReport();
  assertReport(rebuilt);
  assert.deepStrictEqual(normalizeReport(rebuilt), normalizeReport(saved), "full report rebuild must be deterministic");
  assert.strictEqual(markdownReport(rebuilt), savedMarkdown, "markdown rebuild must be deterministic");
  process.stdout.write("replay flag identity contract check passed (checkpoint, cross-floor, mismatch, CLI controls)\n");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  });
}

module.exports = { assertReport, main, normalizeReport };
