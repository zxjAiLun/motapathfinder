"use strict";

const assert = require("assert");
const fs = require("fs");
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
  assert.strictEqual(report.contract.id, "PR-4.6a1");
  assert.strictEqual(report.contract.maxRepairs, 1);
  assert.strictEqual(report.contract.fixedCaseCount, 5);
  assert.strictEqual(report.contract.expectedObservedMustMatch, true);
  assert.strictEqual(report.contract.syntheticControlLabel, "synthetic-contract-executed");
  assert.strictEqual(report.provenance.mode, "shadow-only");
  assert.strictEqual(report.provenance.syntheticSimulator, "shared-solver/adaptive-repair-synthetic-simulator.js");
  assert.strictEqual(report.cases.length, 5);
  report.cases.forEach((item) => {
    assert.ok(item.baselineAttempt, item.id);
    assert.strictEqual(item.baselineOutcome.status, "failed", item.id);
    assert.strictEqual(item.baselineOutcome.failureClass, item.failureClass, item.id);
    assert.ok(item.selectedRepairIntent, item.id);
    assert.ok(item.generatedRepairSegment, item.id);
    assert.deepStrictEqual(item.repairBudget, REPAIR_BUDGET, item.id);
    assert.strictEqual(item.execution.runner, "runAdaptiveSegmentPlanner", item.id);
    assert.strictEqual(item.execution.options.maxAdaptiveRepairs, 1, item.id);
    assert.strictEqual(item.execution.options.enableConvergenceSplit, false, item.id);
    assert.strictEqual(item.repairAttempt.maxRepairCount, 1, item.id);
    assert.strictEqual(item.repairAttempt.recursion, false, item.id);
    assert.ok(item.oneRepairClosure.orchestratorAttemptCount <= 2, item.id);
    assert.ok(item.oneRepairClosure.executedAttemptCount <= 2, item.id);
    assert.ok(item.oneRepairClosure.insertedSegmentCount <= 1, item.id);
    assert.ok(item.oneRepairClosure.repairIndexes.every((index) => index === 0), item.id);
    assert.strictEqual(item.oneRepairClosure.stoppedAfterOneRepair, true, item.id);
    assert.strictEqual(item.expectedOutcome, item.observedOutcome, item.id);
    assert.ok(["success", "rejected", "repair-incomplete"].includes(item.observedOutcome), item.id);
    assert.strictEqual(
      item.terminationReason,
      item.observedOutcome === "success"
        ? "repair-success"
        : item.observedOutcome === "rejected"
          ? "repair-rejected"
          : "repair-incomplete",
      item.id
    );
    assert.strictEqual(item.scope.shadowOnly, true, item.id);
    assert.strictEqual(item.scope.productionDpKeyChanged, false, item.id);
    assert.strictEqual(item.scope.productionDominanceChanged, false, item.id);
    assert.strictEqual(item.scope.productionAgendaChanged, false, item.id);
    assert.strictEqual(item.scope.productionCapacityChanged, false, item.id);
    assert.strictEqual(item.scope.productionDefaultPolicyChanged, false, item.id);
    assert.strictEqual(item.scope.describesCompleteOnlyUpRoute, false, item.id);
  });
}

function assertObservedExecution(report) {
  const byId = new Map(report.cases.map((item) => [item.id, item]));
  const expected = {
    "atk-deficit-positive": {
      failureClass: "atk-deficit",
      outcome: "success",
      mode: "resource-intent-scanner",
      intentKind: "stat-atk",
      mappingFamily: "attack-resource-or-best-combat",
    },
    "action-survivability-deficit": {
      failureClass: "action-survivability-deficit",
      outcome: "repair-incomplete",
      mode: "adaptive-window-repair",
      intentKind: null,
      mappingFamily: "hp-high-survival-low-damage",
    },
    "target-action-unreachable": {
      failureClass: "target-action-unreachable",
      outcome: "success",
      mode: "adaptive-window-repair",
      intentKind: null,
      mappingFamily: "adaptive-window-change-floor-repair",
    },
    "present-tile-overconstrained": {
      failureClass: "present-tile-overconstrained",
      outcome: "rejected",
      mode: "contract-adapter",
      intentKind: "presentTiles-to-preferredPresentTiles",
      mappingFamily: "presentTiles-relaxation",
    },
    "budget-or-action-scope-exhausted": {
      failureClass: "budget-or-action-scope-exhausted",
      outcome: "repair-incomplete",
      mode: "auto-segment-split",
      intentKind: null,
      mappingFamily: "auto-split-or-action-scope-expansion",
    },
  };
  Object.entries(expected).forEach(([id, expectation]) => {
    const item = byId.get(id);
    assert.ok(item, id);
    assert.strictEqual(item.failureClass, expectation.failureClass, id);
    assert.strictEqual(item.observedOutcome, expectation.outcome, id);
    assert.strictEqual(item.plannerProbe.mode, expectation.mode, id);
    assert.strictEqual(item.generatedRepairSegment.generatedBy.mode, expectation.mode, id);
    assert.strictEqual(item.mapping.family, expectation.mappingFamily, id);
    if (expectation.intentKind) {
      assert.strictEqual(item.generatedRepairSegment.generatedBy.intentKind, expectation.intentKind, id);
      assert.strictEqual(item.mapping.observedIntentKind, expectation.intentKind, id);
    }
    if (id === "action-survivability-deficit") {
      assert.strictEqual(item.baselineOutcome.failureClassAliases[0], "hp-deficit");
      assert.strictEqual(item.effectiveRepairBudget.maxExpansions, REPAIR_BUDGET.repairMaxExpansions);
      assert.strictEqual(item.effectiveRepairBudget.maxRuntimeMs, REPAIR_BUDGET.repairMaxRuntimeMs);
    }
    if (id === "target-action-unreachable") {
      assert.ok(item.generatedRepairSegment.actionPolicy.actionKinds.includes("changeFloor"));
      assert.ok(!item.selectedRepairIntent.includes("blocker-open-door-change-floor-whitelist"));
      assert.ok(item.mapping.note.includes("not claimed"));
    }
    if (id === "budget-or-action-scope-exhausted") {
      assert.strictEqual(item.effectiveRepairBudget.maxExpansions, REPAIR_BUDGET.repairMaxExpansions);
      assert.strictEqual(item.effectiveRepairBudget.maxRuntimeMs, REPAIR_BUDGET.repairMaxRuntimeMs);
      assert.strictEqual(item.oneRepairClosure.orchestratorAttemptCount, 2);
      assert.strictEqual(item.oneRepairClosure.stoppedReason, "max-repair-count");
    }
  });
}

function assertOutcomeSemantics(report) {
  const rejected = report.cases.find((item) => item.observedOutcome === "rejected");
  assert.ok(rejected);
  assert.strictEqual(rejected.repairAttempt.executed, false);
  assert.strictEqual(rejected.repairAttempt.appliedRepairCount, 0);
  assert.strictEqual(rejected.insertedSegmentId, null);
  assert.strictEqual(rejected.repairBranches.length, 0);
  assert.strictEqual(rejected.admissibilityValidator.accepted, false);
  assert.ok(rejected.admissibilityValidator.reason);

  report.cases
    .filter((item) => item.observedOutcome === "success" || item.observedOutcome === "repair-incomplete")
    .forEach((item) => {
      assert.strictEqual(item.repairAttempt.executed, true, item.id);
      assert.strictEqual(item.repairAttempt.appliedRepairCount, 1, item.id);
      assert.ok(item.insertedSegmentId, item.id);
      assert.strictEqual(item.oneRepairClosure.insertedSegmentCount, 1, item.id);
      assert.ok(item.repairedAttempt, item.id);
      if (item.observedOutcome === "success") {
        assert.strictEqual(item.repairedAttempt.found, true, item.id);
      } else {
        assert.strictEqual(item.repairedAttempt.found, false, item.id);
        assert.ok(item.oneRepairClosure.stoppedReason, item.id);
      }
    });
}

function assertControls(report) {
  assert.strictEqual(report.controls.positiveRepairSuccess, "atk-deficit-positive");
  assert.strictEqual(report.controls.negativeRepairRejected, "present-tile-overconstrained");
  assert.strictEqual(report.controls.incompleteRepair, "action-survivability-deficit");
  assert.strictEqual(report.controls.autoSplit, "budget-or-action-scope-exhausted");
  assert.strictEqual(report.controls.deterministicLiveRebuild, true);
  assert.strictEqual(report.controls.observedFromRunner, true);
}

function main() {
  assert.ok(fs.existsSync(DEFAULT_OUT), `missing report: ${DEFAULT_OUT}`);
  assert.ok(fs.existsSync(DEFAULT_OUT_MD), `missing markdown report: ${DEFAULT_OUT_MD}`);
  const report = readJson(DEFAULT_OUT);
  assertCommonContract(report);
  assertObservedExecution(report);
  assertOutcomeSemantics(report);
  assertControls(report);
  assert.deepStrictEqual(CASES.map((item) => item.id), report.cases.map((item) => item.id));

  const rebuilt = buildReport();
  assert.deepStrictEqual(normalizeReport(rebuilt), normalizeReport(report));
  const markdown = fs.readFileSync(DEFAULT_OUT_MD, "utf8");
  assert.ok(markdown.includes("observed from executed synthetic runs"));
  assert.ok(markdown.includes("maxAdaptiveRepairs=1"));
  assert.ok(markdown.includes("300-expansion / 2000-ms"));
  assert.ok(markdown.includes("not a claim of a complete OnlyUp route"));
  process.stdout.write(`adaptive repair executed one-repair controls ok: ${report.cases.length} cases\n`);
}

if (require.main === module) main();

module.exports = { main, normalizeReport };
