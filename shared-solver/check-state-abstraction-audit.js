"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { buildReport } = require("./audit-state-abstraction");

const ROOT = path.resolve(__dirname, "..");
const REPORT = path.resolve(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "pr-4.5a-state-abstraction-audit.json",
);
const MARKDOWN = path.resolve(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "pr-4.5a-state-abstraction-audit.md",
);

assert.strictEqual(fs.existsSync(REPORT), true, "PR-4.5a report must exist");
assert.strictEqual(fs.existsSync(MARKDOWN), true, "PR-4.5a markdown report must exist");

const report = JSON.parse(fs.readFileSync(REPORT, "utf8"));
assert.strictEqual(report.schema, "motapathfinder.pr-4.5a-state-abstraction-audit.v1");
assert.strictEqual(report.scope.shadowOnly, true);
assert.strictEqual(report.scope.productionSemanticChange, false);
assert.strictEqual(report.scope.productionDpKeyChanged, false);
assert.strictEqual(report.scope.productionDominanceChanged, false);
assert.strictEqual(report.scope.productionAgendaChanged, false);
assert.strictEqual(report.scope.productionCapacityChanged, false);
assert.strictEqual(report.scope.productionDefaultStrategyChanged, false);
assert.strictEqual(report.corpus.leftCandidateId, "mt2-local-3582:candidate-6");
assert.strictEqual(report.corpus.rightCandidateId, "mt2-local-3582:candidate-7");
assert.strictEqual(report.corpus.decisionStart, 14);
assert.strictEqual(report.corpus.decisionEnd, 20);
assert.strictEqual(report.corpus.sourceCandidateExactKeysMatchArtifact, true);
assert.strictEqual(report.replay.errors.length, 0);
assert.strictEqual(report.replay.exactRejoinAtDecision20, true);
assert.strictEqual(report.actionSuccessorAudit.projection.name, "current-floor-mutation-only-v1-shadow");
assert.ok(report.actionSuccessorAudit.projectedCollisionCount > 0, "candidate pair must collide under the shadow projection");
assert.strictEqual(report.actionSuccessorAudit.actionSetEquivalentAtAllCollisions, true);
assert.strictEqual(report.actionSuccessorAudit.projectedSuccessorSetEquivalentAtAllCollisions, true);
assert.ok(Array.isArray(report.exactKeySplitContribution.topLevel));
assert.ok(report.exactKeySplitContribution.topLevel.some((field) => field.field === "mutations"));
assert.ok(report.exactKeySplitContribution.topLevel.some((field) => field.field === "mutations" && field.exclusiveSplitPairCount > 0));
assert.ok(report.triggeredAutoEvents.classification);
assert.ok(report.directionDependencyRegistry.registry.some((entry) => entry.id === "floor-transition.change-floor-fallback"));
assert.ok(report.provenance.productionStateKeySha256);

// The fixture is a report artifact; this live rebuild proves the audit code
// still agrees with it without changing any production solver behavior.
const rebuilt = buildReport();
assert.strictEqual(rebuilt.scope.productionSemanticChange, false);
assert.strictEqual(rebuilt.replay.exactRejoinAtDecision20, true);
assert.strictEqual(rebuilt.actionSuccessorAudit.actionSetEquivalentAtAllCollisions, true);
assert.strictEqual(rebuilt.actionSuccessorAudit.projectedSuccessorSetEquivalentAtAllCollisions, true);

console.log("PR-4.5a state abstraction audit checks: passed");
