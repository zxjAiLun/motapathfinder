"use strict";

const assert = require("node:assert");
const fs = require("node:fs");

const {
  CONTRACT_SCHEMA,
  DEFAULT_OUT,
  DEFAULT_OUT_MD,
  FIXED_INPUTS,
  buildReport,
  markdownReport,
} = require("./audit-replay-start-offset-contract");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeReport(value) {
  const normalized = JSON.parse(JSON.stringify(value));
  delete normalized.generatedAt;
  if (normalized.provenance) delete normalized.provenance.generationCommit;
  return normalized;
}

function assertValidControl(control, input, expectedRequested) {
  const effective = expectedRequested === 0 ? 1 : expectedRequested;
  assert.strictEqual(control.requestedFromStep, expectedRequested, `${control.id}: requested offset`);
  assert.strictEqual(control.routeLength, input.decisionCount, `${control.id}: route length`);
  assert.strictEqual(control.start.state, "paused", `${control.id}: paused state`);
  assert.strictEqual(control.start.currentStep, effective, `${control.id}: current step`);
  assert.strictEqual(control.start.lastCompletedStep, effective - 1, `${control.id}: last completed`);
  assert.strictEqual(control.start.effectiveFromStep, effective, `${control.id}: effective offset`);
  assert.strictEqual(control.start.resumedExactStateKey, control.start.expectedExactStateKey, `${control.id}: resumed exact state`);
  assert.strictEqual(control.start.nextDecision.index, effective, `${control.id}: next decision index`);
  assert.ok(control.start.nextDecision.summary, `${control.id}: next decision summary`);
  assert.ok(control.start.displayed.floorId, `${control.id}: displayed floor`);
  assert.ok(control.start.displayed.hero && control.start.displayed.hero.hp != null, `${control.id}: displayed hero`);
  assert.deepStrictEqual(control.start.executedPrefix, Array.from({ length: effective - 1 }, (_, index) => index + 1), `${control.id}: prefix side effects`);
  assert.strictEqual(control.continuation.state, "completed", `${control.id}: continuation state`);
  assert.strictEqual(control.continuation.lastCompletedStep, input.decisionCount, `${control.id}: final last completed`);
  assert.strictEqual(control.continuation.finalExpectedExactStateKey, input.finalExactStateKey, `${control.id}: final expected key`);
  assert.strictEqual(control.continuation.finalExactStateKey, input.finalExactStateKey, `${control.id}: final exact key`);
  assert.strictEqual(control.continuation.finalExactStateMatches, true, `${control.id}: final exact match`);
  assert.strictEqual(control.continuation.allDecisionSideEffectsApplied, true, `${control.id}: side effects`);
  assert.deepStrictEqual(control.continuation.executedSteps, Array.from({ length: input.decisionCount }, (_, index) => index + 1), `${control.id}: executed steps`);
  assert.ok(control.continuation.displayed.floorId, `${control.id}: final displayed floor`);
  assert.ok(control.continuation.displayed.hero && control.continuation.displayed.hero.hp != null, `${control.id}: final displayed hero`);
}

function assertReport(report) {
  assert.strictEqual(report.schema, CONTRACT_SCHEMA);
  assert.strictEqual(report.status, "completed");
  assert.strictEqual(report.provenance.mode, "replay-contract-shadow");
  assert.strictEqual(report.provenance.fixedInputSource, "PR-4.8b OnlyUp and WhiteIsland short route outputs");
  assert.strictEqual(report.provenance.deterministicFullReportRebuild, true);
  assert.strictEqual(report.provenance.liveRuntimeExecuted, false);
  assert.strictEqual(report.provenance.productionSolverChanged, false);
  assert.strictEqual(report.provenance.productionDpKeyChanged, false);
  assert.strictEqual(report.provenance.productionDominanceChanged, false);
  assert.strictEqual(report.provenance.productionAgendaChanged, false);
  assert.strictEqual(report.provenance.productionCapacityChanged, false);
  assert.strictEqual(report.provenance.productionDefaultPolicyChanged, false);
  assert.strictEqual(report.provenance.routeSelectionSemanticsChanged, false);
  assert.strictEqual(report.scope.productionSearchSemanticsChanged, false);
  assert.deepStrictEqual(report.contract.fixedInputs, FIXED_INPUTS.map((input) => input.id));
  assert.deepStrictEqual(report.contract.requiredControls, [
    "from-step=0",
    "from-step=1",
    "from-step=routeLength",
    "checkpoint + from-step",
    "from-step=routeLength+1",
    "from-step=-1",
    "from-step=non-integer",
  ]);
  assert.strictEqual(report.inputs.length, FIXED_INPUTS.length);

  report.inputs.forEach((input, inputIndex) => {
    const expectedInput = FIXED_INPUTS[inputIndex];
    assert.strictEqual(input.id, expectedInput.id);
    assert.strictEqual(input.schema, "motapathfinder.route.v1");
    assert.strictEqual(input.sourceProfile, expectedInput.controlId);
    assert.strictEqual(input.decisionCount, 2, `${input.id}: fixed route length`);
    assert.match(input.routeSignature, /^[a-f0-9]{64}$/);
    assert.match(input.startExactStateKey, /^\{/);
    assert.match(input.finalExactStateKey, /^\{/);
    assert.strictEqual(input.controls.length, 4, `${input.id}: valid controls`);
    assertValidControl(input.controls[0], input, 0);
    assertValidControl(input.controls[1], input, 1);
    assertValidControl(input.controls[2], input, input.decisionCount);
    const checkpoint = input.controls[3];
    assert.strictEqual(checkpoint.kind, "checkpoint-plus-offset");
    assert.strictEqual(checkpoint.checkpoint.sourceRouteProfile, expectedInput.controlId);
    assert.strictEqual(checkpoint.checkpoint.sourceStep, 1);
    assert.match(checkpoint.checkpoint.checkpointExactStateKey, /^\{/);
    assert.strictEqual(checkpoint.checkpoint.checkpointRouteLength, 1);
    assertValidControl(checkpoint, { ...input, decisionCount: 1, finalExactStateKey: input.finalExactStateKey }, 1);

    assert.strictEqual(input.outOfRangeControls.length, 3, `${input.id}: out-of-range controls`);
    input.outOfRangeControls.forEach((control) => {
      assert.strictEqual(control.kind, "out-of-range");
      assert.strictEqual(control.response.status, 400, `${control.id}: HTTP status`);
      assert.strictEqual(control.response.ok, false, `${control.id}: response`);
      assert.strictEqual(control.response.code, "REPLAY_STEP_OUT_OF_RANGE", `${control.id}: code`);
      assert.strictEqual(control.response.totalSteps, input.decisionCount, `${control.id}: total`);
      assert.strictEqual(control.launchCount, 0, `${control.id}: no runtime launch`);
      assert.strictEqual(control.sessionStateAfterRequest, "idle", `${control.id}: idle session`);
    });
  });
}

async function main() {
  assert.ok(fs.existsSync(DEFAULT_OUT), "saved replay start-offset report must exist");
  assert.ok(fs.existsSync(DEFAULT_OUT_MD), "saved replay start-offset markdown must exist");
  const saved = readJson(DEFAULT_OUT);
  const savedMarkdown = fs.readFileSync(DEFAULT_OUT_MD, "utf8");
  assert.ok(savedMarkdown.includes(CONTRACT_SCHEMA), "markdown schema");
  FIXED_INPUTS.forEach((input) => assert.ok(savedMarkdown.includes(input.id), `${input.id}: markdown input`));
  assertReport(saved);

  const rebuilt = await buildReport();
  assertReport(rebuilt);
  assert.deepStrictEqual(normalizeReport(rebuilt), normalizeReport(saved), "full report rebuild must be deterministic");
  assert.strictEqual(markdownReport(rebuilt), savedMarkdown, "markdown rebuild must be deterministic");
  process.stdout.write(`replay start-offset contract check passed (${saved.inputs.length} fixed inputs, ${saved.inputs.length * 4} valid controls)\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  });
}

module.exports = { assertReport, main, normalizeReport };
