"use strict";

/**
 * PR-5.24b Iteration 5 Qualification — single-run child (fresh process).
 *
 * argv[2] = "control" (diversity OFF) | "candidate" (diversity ON)
 * argv[3] = run label (e.g. OFF-1)
 *
 * Frozen config per cloud authorization `4c1e4e4`:
 *   onlyup-chaos-mt1-mt4 / adaptive-feasible / depth 3 / global-run
 *   50000 expansions / 30000ms / 256MB stop / process-tree 260 hard
 *   candidateLimit 8 / NO prefixes / NO manual hints / NO parameter tuning.
 *
 * Emits one compact JSON line with run-wide completion + boundary audits.
 */

const path = require("node:path");
const { loadProject } = require("./lib/project-loader");
const { StaticSimulator } = require("./lib/simulator");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { getMilestoneSpec } = require("./lib/milestone-spec");
const { runMilestoneGraph } = require("./lib/segment-dp");
const { createNoStateChangeChoiceResolver } = require("./lib/onlyup-mt1-real-route-gate");

const PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");

const MODE = process.argv[2] === "candidate";
const LABEL = process.argv[3] || (MODE ? "ON-?" : "OFF-?");

const project = loadProject(PROJECT_ROOT);
const choiceResolver = createNoStateChangeChoiceResolver();
const simulator = new StaticSimulator(project, {
  stopFloorId: "MT6",
  battleResolver: new FunctionBackedBattleResolver(project, { enableFastReject: true }),
  autoBattleFastRejectEnabled: true,
  autoPickupEnabled: true,
  autoBattleEnabled: true,
  enableFastHazardBlockIndex: true,
  enableCompiledEffectCache: false,
  choiceResolver,
});

const initialState = simulator.createInitialState();
const spec = getMilestoneSpec(project, "onlyup-chaos-mt1-mt4");

const startedAt = Date.now();
const result = runMilestoneGraph(simulator, initialState, spec, {
  searchIntent: "adaptive-feasible",
  segmentExecutionMode: "isolated-process",
  enableFailureBacktracking: true,
  adaptiveBacktrackDepth: 3,
  budgetScope: "global-run",
  maxExpansions: 50000,
  maxRuntimeMs: 30000,
  maxRssMb: 256,
  memoryCheckIntervalExpansions: 1,
  memoryCheckIntervalActions: 1,
  candidateLimit: 8,
  milestoneFrontierResourceDiversity: MODE,
  captureSelectionAudit: true,
});
const wallMs = Date.now() - startedAt;

// ---- run-wide completion ledger aggregate (authoritative semantics) ----
const ledger = result.executionCompletionLedger || [];
const runWide = {
  executions: ledger.length,
  finalFound: ledger.reduce((s, e) => s + Number(e.finalFound || 0), 0),
  finalComplete: ledger.reduce((s, e) => s + Number(e.finalComplete || 0), 0),
  finalPending: ledger.reduce((s, e) => s + Number(e.finalPending || 0), 0),
  terminalIncomplete: ledger.reduce((s, e) => s + Number(e.terminalIncomplete || 0), 0),
  unknownCompletion: ledger.filter(
    (e) => e.searchComplete !== true && e.searchComplete !== false,
  ).length,
};
runWide.searchComplete =
  runWide.finalPending === 0 && runWide.terminalIncomplete === 0 && runWide.unknownCompletion === 0;

// ---- final canonical outcome (corrected semantics, mirrors checkers) ----
const resourceStopReasons = new Set(["rss-limit", "heap-limit", "time-limit", "expansion-limit"]);
const budgetStop = result.budget && result.budget.stoppedReason;
const evalStops = new Set(
  (result.evaluationAttemptLedger || [])
    .map((att) => att.diagnostics && att.diagnostics.dp && att.diagnostics.dp.stoppedReason)
    .filter(Boolean),
);
const memoryStop = evalStops.has("rss-limit") || evalStops.has("heap-limit");
let finalCanonicalOutcome;
if (result.found) finalCanonicalOutcome = "FOUND";
else if (
  memoryStop ||
  runWide.finalPending > 0 ||
  runWide.terminalIncomplete > 0 ||
  runWide.unknownCompletion > 0 ||
  (budgetStop && resourceStopReasons.has(budgetStop))
) finalCanonicalOutcome = "RESOURCE_LIMITED";
else if (runWide.terminalIncomplete > 0 || runWide.unknownCompletion > 0)
  finalCanonicalOutcome = "INCOMPLETE_SCOPE";
else if (result.cancelled) finalCanonicalOutcome = "CANCELLED";
else finalCanonicalOutcome = "EXHAUSTED";

// ---- adaptive mechanics ----
const failed = result.failedSegment || null;
const backtrack = (failed && failed.backtrack) || null;
const depthSummaries = (backtrack && (backtrack.depthSummaries || backtrack.depths)) || [];
const attempts = (backtrack && backtrack.attempts) || [];
const ledgerPhases = {};
ledger.forEach((e) => { ledgerPhases[e.phase] = (ledgerPhases[e.phase] || 0) + 1; });

// ---- per-boundary selection audit (initial passes; compact) ----
const boundaries = (result.segmentResults || [])
  .filter((seg) => seg && seg.milestoneFrontierSelectionAudit)
  .map((seg) => {
    const audit = seg.milestoneFrontierSelectionAudit;
    return {
      segmentId: seg.segmentId,
      inputCandidates: audit.inputCandidateCount,
      uniqueDpKeys: audit.uniqueDpKeyCount,
      selected: audit.selectedCount,
      capacityDrops: (audit.decisions || []).filter(
        (d) => d.reason === "milestone-frontier-capacity",
      ).length,
      dpKeyDedupDrops: (audit.decisions || []).filter(
        (d) => d.reason === "milestone-frontier-dp-key-deduplication",
      ).length,
      resourceSignaturesSelected: audit.resourceDiversity
        ? audit.resourceDiversity.selectedResourceSignatureCount : null,
      droppedResourceDistinctFromSelected: audit.resourceDiversity
        ? audit.resourceDiversity.droppedResourceDistinctFromSelected : null,
      resourceDiverseSelected: (audit.decisions || []).filter(
        (d) => d.selected && (d.candidateRoles || []).includes("resource-diverse"),
      ).length,
      resourceParetoSelected: (audit.decisions || []).filter(
        (d) => d.selected && (d.candidateRoles || []).includes("resource-pareto"),
      ).length,
    };
  });

// ---- strict replay material (only if found; replay itself runs in the
// qualification parent on a fresh simulator per the decision tree) ----
const finalCandidates = (result.finalCandidates || []).map((c) => ({
  id: c.id,
  routeLength: Array.isArray(c.route) ? c.route.length : 0,
  finalFloorId: c.state && c.state.floorId,
}));

const out = {
  label: LABEL,
  mode: MODE ? "CANDIDATE" : "CONTROL",
  diversity: MODE,
  found: Boolean(result.found),
  finalCanonicalOutcome,
  reachedMilestone: result.reachedMilestone || null,
  failedSegment: failed
    ? {
        segmentId: failed.segmentId || null,
        failureClass: failed.failureClass ||
          (failed.failurePropagation && failed.failurePropagation.primaryFailureClass) || null,
      }
    : null,
  budget: {
    stoppedReason: budgetStop || null,
    consumedExpansions: result.budget ? result.budget.consumedExpansions : null,
    requestedExpansions: 50000,
    requestedRuntimeMs: 30000,
  },
  wallMs,
  processTree: {
    peakRssMb: result.processTreeMemory
      ? result.processTreeMemory.maxAggregateConcurrentRssUpperBoundMb : null,
    qualified: result.processTreeMemory ? result.processTreeMemory.qualified : null,
  },
  runWide,
  adaptive: {
    triggered: Boolean(backtrack && backtrack.attempted) ||
      Object.keys(ledgerPhases).some((p) => p.startsWith("adaptive")),
    ledgerPhases,
    waveAttempts: attempts.length,
    depthSummaries: depthSummaries.map((d) => ({
      depth: d.depth,
      outcome: d.depthOutcome || null,
      exhausted: Boolean(d.depthExhausted),
      stopReason: d.stopReason != null ? d.stopReason : (d.depthStopReason || null),
    })),
  },
  boundaries,
  finalCandidates,
};

process.stdout.write(JSON.stringify(out) + "\n");
