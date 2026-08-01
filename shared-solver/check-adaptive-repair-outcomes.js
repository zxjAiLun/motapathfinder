"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  CASES,
  CONTRACT_SCHEMA,
  DEFAULT_OUT,
  DEFAULT_OUT_MD,
  REPAIR_BUDGET,
  buildReport,
} = require("./audit-adaptive-repair-outcomes");

function normalizeReport(value) {
  const normalized = JSON.parse(JSON.stringify(value));
  delete normalized.generatedAt;
  if (normalized.provenance) delete normalized.provenance.generationCommit;
  return normalized;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function assertCommonContract(report) {
  assert.strictEqual(report.schema, CONTRACT_SCHEMA);
  assert.strictEqual(report.status, "completed");
  assert.strictEqual(report.contract.id, "PR-4.6a");
  assert.strictEqual(report.contract.maxRepairs, 1);
  assert.strictEqual(report.contract.fixedCaseCount, 5);
  assert.deepStrictEqual(report.contract.terminationReasons, [
    "repair-success",
    "repair-rejected",
    "repair-incomplete",
  ]);
  assert.strictEqual(report.contract.unresolvedOutcome, "repair-incomplete");
  assert.strictEqual(report.contract.syntheticControlLabel, "synthetic-contract-only");
  assert.strictEqual(report.provenance.mode, "shadow-only");
  assert.strictEqual(report.cases.length, 5);
  report.cases.forEach((item) => {
    assert.strictEqual(item.baselineOutcome.status, "failed", item.id);
    assert.strictEqual(item.baselineOutcome.failureClass, item.failureClass, item.id);
    assert.ok(item.selectedRepairIntent, item.id);
    assert.ok(item.generatedRepairSegment, item.id);
    assert.ok(item.generatedRepairSegment.generatedBy, item.id);
    assert.deepStrictEqual(item.repairBudget, REPAIR_BUDGET, item.id);
    assert.strictEqual(item.repairAttempt.index, 1, item.id);
    assert.strictEqual(item.repairAttempt.maxRepairCount, 1, item.id);
    assert.strictEqual(item.repairAttempt.recursion, false, item.id);
    assert.strictEqual(item.repairAttempt.appliedRepairCount, 1, item.id);
    assert.strictEqual(item.repairAttempt.outcomeEvidence, "synthetic-contract-only", item.id);
    assert.strictEqual(item.scope.shadowOnly, true, item.id);
    assert.strictEqual(item.scope.productionDpKeyChanged, false, item.id);
    assert.strictEqual(item.scope.productionDominanceChanged, false, item.id);
    assert.strictEqual(item.scope.productionAgendaChanged, false, item.id);
    assert.strictEqual(item.scope.productionCapacityChanged, false, item.id);
    assert.strictEqual(item.scope.productionDefaultPolicyChanged, false, item.id);
    assert.strictEqual(item.scope.describesCompleteOnlyUpRoute, false, item.id);
    assert.ok(["success", "rejected", "repair-incomplete"].includes(item.repairedOutcome), item.id);
    assert.strictEqual(
      item.terminationReason,
      item.repairedOutcome === "success"
        ? "repair-success"
        : item.repairedOutcome === "rejected"
          ? "repair-rejected"
          : "repair-incomplete",
      item.id
    );
  });
}

function assertFailureIntentMapping(report) {
  const byId = new Map(report.cases.map((item) => [item.id, item]));
  const expectations = {
    "atk-deficit-positive": {
      failureClass: "atk-deficit",
      intent: "attack-resource-or-best-combat",
      mode: "contract-adapter",
      outcome: "success",
      termination: "repair-success",
    },
    "action-survivability-deficit": {
      failureClass: "action-survivability-deficit",
      intent: "hp-high-survival-low-damage",
      mode: "adaptive-window-repair",
      outcome: "repair-incomplete",
      termination: "repair-incomplete",
    },
    "target-action-unreachable": {
      failureClass: "target-action-unreachable",
      intent: "blocker-open-door-change-floor-whitelist",
      mode: "adaptive-window-repair",
      outcome: "success",
      termination: "repair-success",
    },
    "present-tile-overconstrained": {
      failureClass: "present-tile-overconstrained",
      intent: "presentTiles-to-preferredPresentTiles",
      mode: "contract-adapter",
      outcome: "rejected",
      termination: "repair-rejected",
    },
    "budget-or-action-scope-exhausted": {
      failureClass: "budget-or-action-scope-exhausted",
      intent: "auto-split-or-action-scope-expansion",
      mode: "auto-segment-split",
      outcome: "repair-incomplete",
      termination: "repair-incomplete",
    },
  };
  Object.entries(expectations).forEach(([id, expected]) => {
    const item = byId.get(id);
    assert.ok(item, id);
    assert.strictEqual(item.failureClass, expected.failureClass, id);
    assert.strictEqual(item.selectedRepairIntent, expected.intent, id);
    assert.strictEqual(item.plannerProbe.mode, expected.mode, id);
    assert.strictEqual(item.generatedRepairSegment.generatedBy.mode, expected.mode, id);
    assert.strictEqual(item.repairedOutcome, expected.outcome, id);
    assert.strictEqual(item.terminationReason, expected.termination, id);
  });
  assert.strictEqual(byId.get("action-survivability-deficit").baselineOutcome.failureClassAliases[0], "hp-deficit");
  assert.strictEqual(byId.get("present-tile-overconstrained").generatedRepairSegment.generatedBy.downgrade, true);
  assert.strictEqual(byId.get("budget-or-action-scope-exhausted").plannerProbe.usedExistingPlanner, true);
}

function assertControls(report) {
  assert.strictEqual(report.controls.positiveRepairSuccess, "atk-deficit-positive");
  assert.strictEqual(report.controls.negativeRepairRejected, "present-tile-overconstrained");
  assert.strictEqual(report.controls.incompleteRepair, "action-survivability-deficit");
  assert.strictEqual(report.controls.autoSplit, "budget-or-action-scope-exhausted");
  assert.strictEqual(report.controls.deterministicLiveRebuild, true);
  assert.ok(report.cases.some((item) => item.repairedOutcome === "success"));
  assert.ok(report.cases.some((item) => item.repairedOutcome === "rejected"));
  assert.ok(report.cases.some((item) => item.repairedOutcome === "repair-incomplete"));
}

function main() {
  assert.ok(fs.existsSync(DEFAULT_OUT), `missing report: ${DEFAULT_OUT}`);
  assert.ok(fs.existsSync(DEFAULT_OUT_MD), `missing markdown report: ${DEFAULT_OUT_MD}`);
  const report = readJson(DEFAULT_OUT);
  assertCommonContract(report);
  assertFailureIntentMapping(report);
  assertControls(report);
  assert.deepStrictEqual(CASES.map((item) => item.id), report.cases.map((item) => item.id));

  const rebuilt = buildReport();
  assert.deepStrictEqual(normalizeReport(rebuilt), normalizeReport(report));
  const markdown = fs.readFileSync(DEFAULT_OUT_MD, "utf8");
  assert.ok(markdown.includes("PR-4.6a Adaptive Repair Outcome Contract"));
  assert.ok(markdown.includes("synthetic-contract-only"));
  assert.ok(markdown.includes("Production DP keys, dominance, agenda, capacity, and default policy are unchanged."));
  process.stdout.write(`adaptive repair outcome contract ok: ${report.cases.length} cases\n`);
}

if (require.main === module) main();

module.exports = { main, normalizeReport };
