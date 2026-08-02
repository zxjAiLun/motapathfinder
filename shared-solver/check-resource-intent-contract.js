"use strict";

const assert = require("assert");
const fs = require("fs");
const {
  CASES,
  CONTRACT_SCHEMA,
  DEFAULT_OUT,
  DEFAULT_OUT_MD,
  OUTPUT_KINDS,
  buildReport,
} = require("./audit-resource-intent-contract");

function normalizeReport(value) {
  const normalized = JSON.parse(JSON.stringify(value));
  delete normalized.generatedAt;
  if (normalized.provenance) delete normalized.provenance.generationCommit;
  return normalized;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function assertScoreAttribution(score, id) {
  const breakdown = score && score.scoreBreakdown;
  assert.ok(breakdown, `${id}: missing scanner score breakdown`);
  const expected = breakdown.attackContribution +
    breakdown.defenseContribution +
    breakdown.magicDefenseContribution +
    breakdown.hpContribution +
    breakdown.survivabilityContribution +
    breakdown.blockedResourceContribution +
    breakdown.targetBattleContribution +
    breakdown.equipmentContribution +
    breakdown.pathContribution +
    breakdown.actionKindContribution -
    breakdown.damagePenalty -
    breakdown.hpLossPenalty -
    breakdown.depthPenalty;
  assert.strictEqual(breakdown.rawTotal, expected, `${id}: scanner score raw total`);
  assert.strictEqual(breakdown.roundedTotal, score.scannerScore, `${id}: rounded total must match scanner score`);
  assert.strictEqual(score.scannerScore, Math.round(breakdown.rawTotal), `${id}: rounded scanner score`);
  assert.ok(Number.isFinite(score.scannerScore), `${id}: scanner score must be finite`);
}

function assertEvidenceRecord(record, item) {
  const id = `${item.id}:${record.sourceAction}`;
  assert.ok(record.sourceAction, `${id}: source action`);
  assert.ok(Array.isArray(record.actionChain) && record.actionChain.length > 0, `${id}: action chain`);
  assert.ok(record.targetFloor, `${id}: target floor`);
  assert.ok(record.before, `${id}: before state summary`);
  assert.ok(record.after, `${id}: after state summary`);
  assert.ok(record.beforeAfterDelta, `${id}: before/after delta`);
  assert.ok(Number.isFinite(record.damage), `${id}: damage`);
  assert.ok(record.cost && Number.isFinite(record.cost.damage), `${id}: cost`);
  assert.strictEqual(record.failureClass, item.failureClass, `${id}: failure class`);
  assert.ok(record.failureClassRelevance, `${id}: failure relevance`);
  assertScoreAttribution(record.score, id);
  assert.ok(record.generatedTemporaryGoal, `${id}: generated temporary goal`);
  assert.ok(record.actionPolicy, `${id}: action policy`);
  assert.ok(record.frontierEvidence, `${id}: frontier evidence`);
  assert.strictEqual(record.deferredResource.immediatePickup, false, `${id}: immediate pickup marker`);
}

function assertCommonContract(report) {
  assert.strictEqual(report.schema, CONTRACT_SCHEMA);
  assert.strictEqual(report.status, "completed");
  assert.strictEqual(report.contract.id, "PR-4.7a1");
  assert.deepStrictEqual(report.contract.fixedOutputKinds, OUTPUT_KINDS);
  assert.strictEqual(report.contract.deterministicFullReportRebuild, true);
  assert.strictEqual(report.provenance.mode, "shadow-only");
  assert.strictEqual(report.provenance.scanner, "shared-solver/lib/resource-intent-scanner.js");
  assert.strictEqual(report.provenance.productionPlannerChanged, false);
  assert.strictEqual(report.provenance.productionDefaultPolicyChanged, false);
  assert.strictEqual(report.scope.shadowOnly, true);
  assert.strictEqual(report.scope.productionDpKeyChanged, false);
  assert.strictEqual(report.scope.productionDominanceChanged, false);
  assert.strictEqual(report.scope.productionAgendaChanged, false);
  assert.strictEqual(report.scope.productionCapacityChanged, false);
  assert.strictEqual(report.scope.productionDefaultPolicyChanged, false);
  assert.strictEqual(report.scope.describesCompleteOnlyUpRoute, false);
  assert.strictEqual(report.cases.length, CASES.length);

  const expectedById = new Map(CASES.map((item) => [item.id, item]));
  report.cases.forEach((item) => {
    const expected = expectedById.get(item.id);
    assert.ok(expected, `unexpected case ${item.id}`);
    assert.strictEqual(item.failureClass, expected.failureClass, item.id);
    assert.strictEqual(item.outputKind, expected.outputKind, item.id);
    assert.strictEqual(item.scannerKind, expected.scannerKind, item.id);
    assert.ok(item.records.length > 0, `${item.id}: records`);
    assert.ok(item.generatedTemporaryGoal, `${item.id}: goal`);
    assert.ok(item.actionPolicy, `${item.id}: policy`);
    item.records.forEach((record) => assertEvidenceRecord(record, item));
  });

  assert.deepStrictEqual(
    report.cases.map((item) => item.id),
    CASES.map((item) => item.id),
  );
  assert.deepStrictEqual(
    Array.from(new Set(report.cases.map((item) => item.outputKind))).sort(),
    OUTPUT_KINDS.slice().sort(),
  );
}

function assertFailureControls(report) {
  const controls = report.controls.failureIntentControls;
  assert.deepStrictEqual(
    controls["atk-deficit"].observedOutputKinds,
    ["equipment", "levelup", "stat-gain"],
  );
  assert.deepStrictEqual(
    controls["hp-deficit"].observedOutputKinds,
    ["deferred-resource", "levelup", "stat-gain"],
  );
  assert.deepStrictEqual(
    controls["target-action-unreachable"].observedOutputKinds,
    ["path-blocker"],
  );

  const ordering = report.controls.strictScoreOrderingRepeatable;
  assert.strictEqual(ordering.strictScoreOrderingRepeatable, true);
  assert.deepStrictEqual(ordering.forwardInputOrder, ["candidate-low", "candidate-high"]);
  assert.deepStrictEqual(ordering.reversedInputOrder, ["candidate-high", "candidate-low"]);
  assert.strictEqual(ordering.observedOrder[0].candidateId, ordering.higherCandidate);
  assert.strictEqual(ordering.observedOrder[1].candidateId, ordering.lowerCandidate);
  assert.deepStrictEqual(ordering.observedOrder, ordering.reversedObservedOrder);
  assert.deepStrictEqual(ordering.observedOrder, ordering.repeatedOrder);
  assert.ok(ordering.observedOrder[0].scannerScore > ordering.observedOrder[1].scannerScore);
  assert.strictEqual(report.controls.equalScoreTieDeterminism.status, "not-established");

  const empty = report.controls.emptyIntentReturnsEmpty;
  assert.strictEqual(empty.returnedEmpty, true);
  assert.strictEqual(empty.intentCount, 0);
  assert.deepStrictEqual(empty.intents, []);

  const deferred = report.controls.deferredResourceNotImmediatePickup;
  assert.strictEqual(deferred.outputKind, "deferred-resource");
  assert.strictEqual(deferred.directImmediatePickupAvailable, false);
  assert.strictEqual(deferred.sourceActionKind, "battle");
  assert.strictEqual(deferred.isDeferred, true);
  assert.ok(deferred.actionChain.some((summary) => String(summary).startsWith("pickup:")));

  const path = report.controls.pathBlockerRequiresObservedFrontierAction;
  assert.strictEqual(path.sourceAction, "openDoor:lockedDoor@S1:5,0");
  assert.ok(path.targetTile && path.targetTile.x === 5 && path.targetTile.y === 0);
  assert.ok(path.newActionCount > 0);
  assert.ok(path.sampleNewActions.includes("changeFloor:S1->S2"));
  assert.strictEqual(report.controls.deterministicLiveRebuild, true);
}

function main() {
  assert.ok(fs.existsSync(DEFAULT_OUT), `missing report: ${DEFAULT_OUT}`);
  assert.ok(fs.existsSync(DEFAULT_OUT_MD), `missing markdown report: ${DEFAULT_OUT_MD}`);
  const report = readJson(DEFAULT_OUT);
  assertCommonContract(report);
  assertFailureControls(report);

  const rebuilt = buildReport();
  assert.deepStrictEqual(normalizeReport(rebuilt), normalizeReport(report));
  const markdown = fs.readFileSync(DEFAULT_OUT_MD, "utf8");
  assert.ok(markdown.includes("stat-gain"));
  assert.ok(markdown.includes("deferred-resource"));
  assert.ok(markdown.includes("strict unequal-score ordering with reversed input: passed"));
  assert.ok(markdown.includes("equal-score tie determinism: not-established"));
  assert.ok(markdown.includes("not labeled as an immediate pickup"));
  assert.ok(markdown.includes("not because the tile is merely typed as a door"));
  process.stdout.write(`resource intent evidence contract ok: ${report.cases.length} cases / ${OUTPUT_KINDS.length} output kinds\n`);
}

if (require.main === module) main();

module.exports = { main, normalizeReport };
