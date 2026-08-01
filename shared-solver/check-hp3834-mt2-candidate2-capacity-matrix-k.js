"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { classifyMatrix } = require("./audit-hp3834-mt2-candidate2-capacity-matrix-k");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_REPORT = path.resolve(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "mt2-candidate2-capacity-matrix-k.json",
);
const EXPECTED = {
  "8x8": { goalSkylineLimit: 8, candidateLimit: 8 },
  "10x8": { goalSkylineLimit: 10, candidateLimit: 8 },
  "8x10": { goalSkylineLimit: 8, candidateLimit: 10 },
  "10x10": { goalSkylineLimit: 10, candidateLimit: 10 },
};

function parseArgs(argv) {
  return argv.reduce((result, token) => {
    const match = /^--([^=]+)=(.*)$/.exec(token);
    if (match) result[match[1]] = match[2];
    return result;
  }, {});
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function hasLineageFields(lineage) {
  return lineage &&
    typeof lineage.generated === "boolean" &&
    typeof lineage.goalAccepted === "boolean" &&
    typeof lineage.activeAtFinish === "boolean" &&
    typeof lineage.rawArchiveSelected === "boolean" &&
    Object.prototype.hasOwnProperty.call(lineage, "rawSortRank") &&
    Object.prototype.hasOwnProperty.call(lineage, "selectedArchiveRank") &&
    typeof lineage.segmentRetained === "boolean" &&
    typeof lineage.mergedRetained === "boolean" &&
    typeof lineage.attemptExecuted === "boolean" &&
    Object.prototype.hasOwnProperty.call(lineage, "firstAbsentStage");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const reportFile = path.resolve(args.report || DEFAULT_REPORT);
  const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
  assert(report.schema === "motapathfinder.hp3834-mt2-candidate2-capacity-matrix-k.v1", "unexpected k report schema");
  assert(report.status === "completed", `k report status is ${report.status}`);
  assert(Array.isArray(report.failedGates) && report.failedGates.length === 0, "k report has failed gates");
  assert(report.productionSemanticChange === false, "productionSemanticChange must remain false");
  assert(report.globalDefaultChangeRecommended === "not-established", "global default conclusion changed");
  assert(report.hp3834ContinuationWorkersRun === false, "HP3834 continuation worker was run");
  assert(report.provenance && report.provenance.commitStable === true, "provenance commit is not stable");
  assert(report.sourceRouteStrictReplay && report.sourceRouteStrictReplay.valid === true, "source route strict replay is invalid");
  assert(report.mt1Setup && report.mt1Setup.candidate2 && report.mt1Setup.candidate2.exactStateKey, "natural candidate-2 gate is missing");
  assert(report.gates && report.gates.naturalCandidate2Start === true, "natural candidate-2 start gate failed");
  assert(report.gates.noTeacherInjection === true, "teacher injection gate failed");
  assert(report.causalScope === "goalSkylineLimit-parameter-effect-across-bounded-two-segment-pipeline", "causal scope is missing or too broad");
  assert(report.directWinnerLocalRawArchiveRejectionEstablished === false, "direct local raw-archive rejection was incorrectly established");
  assert(report.winnerLocalFirstAbsentUnderGoal8 === "production-successor", "winner-local first absence under goal=8 changed");
  assert(report.mechanismWithinGoalArchiveParameterEffect === "not-established", "goal-archive mechanism was overclaimed");
  assert(Array.isArray(report.runs) && report.runs.length === 4, "expected four capacity runs");

  const seen = new Set();
  for (const run of report.runs) {
    const expected = EXPECTED[run.config && run.config.id];
    assert(expected, `unexpected capacity id: ${run.config && run.config.id}`);
    assert(!seen.has(run.config.id), `duplicate capacity id: ${run.config.id}`);
    seen.add(run.config.id);
    assert(run.config.goalSkylineLimit === expected.goalSkylineLimit, `${run.config.id} goal skyline mismatch`);
    assert(run.config.candidateLimit === expected.candidateLimit, `${run.config.id} candidate limit mismatch`);
    assert(run.config.dpSkylineMax === 4, `${run.config.id} dp skyline mismatch`);
    assert(run.config.agendaMode === "best-first", `${run.config.id} agenda mode mismatch`);
    assert(run.config.stopOnFirstGoal === false, `${run.config.id} stopOnFirstGoal mismatch`);
    assert(run.config.budgetScope === "global-run", `${run.config.id} budget scope mismatch`);
    assert(run.hp3834 && run.hp3834.pipelineObserved === false && run.hp3834.attempts === 0 && run.hp3834.continuationWorkerRun === false, `${run.config.id} contains HP3834 execution`);
    assert(run.search && run.search.completion && run.search.completion.classification !== "not-run", `${run.config.id} search was not classified`);
    const segmentIds = (run.search.segmentResults || []).map((segment) => segment.segmentId);
    assert(segmentIds.length === 2 && segmentIds[0] === "mt2-entry" && segmentIds[1] === "mt2-local-3582", `${run.config.id} ran outside the local boundary`);
    assert(hasLineageFields(run.winnerEntry), `${run.config.id} winner entry lineage incomplete`);
    assert(hasLineageFields(run.winnerLocal), `${run.config.id} winner local lineage incomplete`);
    assert(hasLineageFields(run.teacherEntry), `${run.config.id} teacher entry control lineage incomplete`);
    assert(hasLineageFields(run.teacherLocal), `${run.config.id} teacher local control lineage incomplete`);
    if (!run.winnerLocal.mergedRetained) {
      assert(Array.isArray(run.entryAttemptMetrics) && run.entryAttemptMetrics.length > 0, `${run.config.id} missing entry attempt diagnosis for absent local`);
    }
  }
  assert(seen.size === 4, "capacity matrix is incomplete");
  const byId = Object.fromEntries(report.runs.map((run) => [run.config.id, run]));
  assert(byId["8x8"].winnerEntry.mergedRetained === true, "8x8 winner entry regressed");
  assert(byId["10x8"].winnerEntry.mergedRetained === true, "10x8 winner entry regressed");
  assert(byId["8x10"].winnerEntry.mergedRetained === true, "8x10 winner entry regressed");
  assert(byId["10x10"].winnerEntry.mergedRetained === true, "10x10 winner entry regressed");
  assert(byId["8x8"].winnerLocal.mergedRetained === false, "8x8 winner local retention regressed");
  assert(byId["10x8"].winnerLocal.mergedRetained === true, "10x8 winner local retention regressed");
  assert(byId["8x10"].winnerLocal.mergedRetained === false, "8x10 winner local retention regressed");
  assert(byId["10x10"].winnerLocal.mergedRetained === true, "10x10 winner local retention regressed");
  assert(byId["8x8"].winnerLocal.firstAbsentStage === "production-successor", "8x8 first absence changed");
  assert(byId["8x10"].winnerLocal.firstAbsentStage === "production-successor", "8x10 first absence changed");
  assert(byId["10x8"].winnerLocal.firstAbsentStage === null, "10x8 first absence changed");
  assert(byId["10x10"].winnerLocal.firstAbsentStage === null, "10x10 first absence changed");
  assert(report.gates.exactRetentionPattern === true, "exact retention pattern gate failed");
  assert(report.gates.goalSkylineLimit10BoundedSufficient === true, "goalSkylineLimit=10 sufficiency gate failed");
  assert(report.gates.candidateLimit10AloneNotSufficient === true, "candidateLimit=10-alone gate failed");
  assert(report.gates.jointIncreaseNotRequired === true, "joint-increase gate failed");
  assert(report.gates.allRunsBoundedIncomplete === true, "bounded completeness boundary changed");
  assert(report.matrixClassification.classification === "raw-goal-archive-capacity-sufficient", "research classification changed");
  const recomputed = classifyMatrix(report.runs);
  assert(report.matrixClassification && report.matrixClassification.classification === recomputed.classification, "matrix classification is not dynamic");
  assert(report.matrixClassification.reason === recomputed.reason, "matrix classification reason is stale");
  console.log(`PR-4.4k capacity matrix: ${report.runs.length}/4 runs and contract checks passed`);
}

if (require.main === module) main();

module.exports = { main };
