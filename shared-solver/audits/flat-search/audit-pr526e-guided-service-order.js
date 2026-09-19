"use strict";

/**
 * PR-5.26e Phase 3 - Guided Equal-Score Service Order Audit.
 *
 * Diagnostic only. Oracle keys are post-hoc filters; they never enter search
 * decisions. The fixed workload intentionally has no priorityMap, so every
 * guided admission follows the current fallback score of 100.
 */

const fs = require("fs");
const path = require("path");

const { buildDependencyFrontier } = require("../../lib/dependency-frontier");
const { createTransportCollapsedSearch } = require("../../lib/transport-collapse");
const { buildStateKey } = require("../../lib/state-key");
const { loadProject } = require("../../lib/project-loader");
const {
  buildOracleCheckpoints,
  makeSimulator,
  PROJECT_ROOT,
} = require("./audit-pr525t-oracle-survival");

const DEFAULT_OUT = path.resolve(__dirname, "..", "..", "routes", "generated", "pr526e-guided-service-order.json");
const FROZEN = {
  initialRank: "chaos",
  region: ["MT1", "MT2", "MT3", "MT4"],
  goalFloorId: "MT4",
  maxExpansions: 12000,
  maxRuntimeMs: 0,
  maxRssMb: 2048,
  pendingCandidateCap: 1024,
  rank20DynamicPareto: true,
  neutralParetoSubstitution: true,
  priorityMap: "ABSENT",
};

function summarizeTarget(events, exactKey) {
  const classified = [...events].reverse().find((event) => event.type === "classified") || null;
  const registered = [...events].reverse().find((event) => event.type === "registered") || null;
  const guided = [...events].reverse().find((event) => event.type === "guidedAdmitted") || null;
  const expanded = [...events].reverse().find((event) => event.type === "expanded") || null;
  return {
    exactKey,
    generated: events.some((event) => event.type === "strategicGenerated"),
    duplicateSkipped: events.some((event) => event.type === "duplicateSkipped"),
    registered: Boolean(registered),
    registeredAt: registered ? registered.registeredAtStrategicExpansion : null,
    pendingSeq: registered ? registered.pendingSeq : null,
    score: guided ? guided.score : null,
    guidedLiveCountAtRegistration: guided ? guided.guidedLiveCountAtRegistration : null,
    guidedSameScoreLiveCountAtRegistration: guided ? guided.guidedSameScoreLiveCountAtRegistration : null,
    expandedAt: expanded ? expanded.strategicExpansion : null,
    expanded: Boolean(expanded),
    dropped: events.some((event) => event.type === "dropped"),
    frontierGuided: classified ? classified.frontierGuided === true : null,
    guidedAdmitted: classified ? classified.guidedAdmitted === true : null,
    combatProgress: classified ? classified.combatProgress === true : null,
    identity: classified ? classified.identity || null : null,
  };
}

function main() {
  const arg = process.argv.slice(2).find((token) => token.startsWith("--out="));
  const outPath = arg ? path.resolve(arg.slice("--out=".length)) : DEFAULT_OUT;
  const project = loadProject(PROJECT_ROOT);
  const simulator = makeSimulator(project);
  const oracle = buildOracleCheckpoints(simulator);
  const cp14 = oracle.allSteps.find((step) => step.step === 14);
  const cp16 = oracle.allSteps.find((step) => step.step === 16);
  if (!cp14 || !cp16) throw new Error("oracle fixture is missing cp#14 or cp#16");
  const targetKeys = new Set([cp14.postKey, cp16.postKey]);
  const lifecycle = new Map();
  let totalEvents = 0;

  const initialState = simulator.createInitialState({ rank: FROZEN.initialRank });
  const frontierReport = buildDependencyFrontier(project, initialState, {
    type: "floorReached",
    floorId: FROZEN.goalFloorId,
  });
  const result = createTransportCollapsedSearch(simulator).search(initialState, {
    isGoalState: (state) => state.floorId === FROZEN.goalFloorId,
    allowedFloors: FROZEN.region,
    maxExpansions: FROZEN.maxExpansions,
    maxRuntimeMs: FROZEN.maxRuntimeMs,
    maxRssMb: FROZEN.maxRssMb,
    frontierSet: frontierReport.frontierSet,
    resourceSkylinePriority: true,
    pendingCandidateCap: FROZEN.pendingCandidateCap,
    rank20DynamicPareto: FROZEN.rank20DynamicPareto,
    neutralParetoSubstitution: FROZEN.neutralParetoSubstitution,
    emitGuidedServiceTelemetry: true,
    onCandidateLifecycle: (event) => {
      totalEvents += 1;
      if (!targetKeys.has(event.exactKey)) return null;
      const list = lifecycle.get(event.exactKey) || [];
      list.push(event);
      lifecycle.set(event.exactKey, list);
      return null;
    },
  });

  const targets = {
    cp14: summarizeTarget(lifecycle.get(cp14.postKey) || [], cp14.postKey),
    cp16: summarizeTarget(lifecycle.get(cp16.postKey) || [], cp16.postKey),
  };
  const summary = {
    milestone: "PR-5.26e",
    audit: "GUIDED_EQUAL_SCORE_SERVICE_ORDER",
    searchPolicyChange: "NONE",
    oracleUse: "POST_HOC_LOOKUP_ONLY",
    oracleKeysAffectSearchDecisions: false,
    frozen: FROZEN,
    priorityMapPresent: false,
    guidedScoreHistogram: result.guidedScoreHistogram,
    totalLifecycleEvents: totalEvents,
    search: {
      found: result.found,
      strategicExpansions: result.strategicExpansions,
      candidatesDropped: result.candidatesDropped,
      stoppedReason: result.stoppedReason,
      searchComplete: result.searchComplete,
      deepestReachedFloorOrdinal: result.deepestReachedFloorOrdinal,
      deepestStrategicDepth: result.deepestStrategicDepth,
      peakRssMb: result.peakRssMb,
      wallMs: result.wallMs,
    },
    diagnosticIncompleteDueToRss: result.stoppedReason === "rss-limit" && result.strategicExpansions < FROZEN.maxExpansions,
    targets,
    verdict: {
      allGuidedScore100: result.guidedScoreHistogram && Object.keys(result.guidedScoreHistogram).length === 1 && result.guidedScoreHistogram["100"] > 0,
      equalScoreBacklogObserved: [targets.cp14, targets.cp16].some((target) =>
        target.guidedSameScoreLiveCountAtRegistration != null && target.guidedSameScoreLiveCountAtRegistration > 1),
      guidedFailureSubclass: "NOT_YET_ISOLATED",
      candidateMechanismGap: "EQUAL_SCORE_GUIDED_SERVICE_ORDER",
    },
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log("PR-5.26e guided equal-score service-order audit");
  console.log(`  fixed work: ${FROZEN.maxExpansions} expansions / no wall limit / cap ${FROZEN.pendingCandidateCap} / rss ${FROZEN.maxRssMb}MB`);
  console.log(`  search: found=${result.found} strategic=${result.strategicExpansions} stopped=${result.stoppedReason} rss=${result.peakRssMb}MB`);
  console.log(`  priorityMap present=${summary.priorityMapPresent} score histogram=${JSON.stringify(result.guidedScoreHistogram)}`);
  for (const [name, target] of Object.entries(targets)) {
    console.log(`  ${name}: registeredAt=${target.registeredAt} score=${target.score} ` +
      `guidedLive=${target.guidedLiveCountAtRegistration} sameScoreLive=${target.guidedSameScoreLiveCountAtRegistration} ` +
      `expandedAt=${target.expandedAt} dropped=${target.dropped}`);
  }
  console.log(`  DIAGNOSTIC_INCOMPLETE_DUE_TO_RSS = ${summary.diagnosticIncompleteDueToRss}`);
  console.log(`  artifact: ${path.relative(process.cwd(), outPath)}`);
}

if (require.main === module) main();

module.exports = { FROZEN, main, summarizeTarget };
