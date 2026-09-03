"use strict";

/**
 * PR-5.24c Iteration 2 — F1/F2 diagnostic (NOT an authority round).
 *
 * Frozen: 30s / 50k / 256MB stop / 260 hard / isolated-process /
 * failure-intent OFF in BOTH arms.
 *
 *   F1: budgeted first-probe scheduler ON, continuation OFF
 *   F2: same first-probe config, continuation ON (second grant = 2x first)
 *
 * Records the authorized compact aggregate. May NOT claim MT4 proven /
 * exhausted / production enablement.
 */

const path = require("node:path");
const assert = require("node:assert");
const { spawnSync } = require("node:child_process");

const CHILD_SOURCE = `
"use strict";
const path = require("node:path");
const assert = require("node:assert");
const SOLVER_LIB = path.join(process.env.SOLVER_DIR, "lib");
const { loadProject } = require(path.join(SOLVER_LIB, "project-loader"));
const { StaticSimulator } = require(path.join(SOLVER_LIB, "simulator"));
const { FunctionBackedBattleResolver } = require(path.join(SOLVER_LIB, "battle-resolver"));
const { getMilestoneSpec } = require(path.join(SOLVER_LIB, "milestone-spec"));
const { runMilestoneGraph } = require(path.join(SOLVER_LIB, "segment-dp"));
const {
  FIRST_REGION_TARGET_FLOOR_ID,
  createNoStateChangeChoiceResolver,
} = require(path.join(SOLVER_LIB, "onlyup-mt1-real-route-gate"));

const PROJECT_ROOT = path.resolve(process.env.SOLVER_DIR, "..", "Only upV2.1", "Only upV2.1");
const ARM = process.argv[2] || "F1";

function main() {
  const project = loadProject(PROJECT_ROOT);
  const choiceResolver = createNoStateChangeChoiceResolver();
  const simulator = new StaticSimulator(project, {
    stopFloorId: FIRST_REGION_TARGET_FLOOR_ID,
    battleResolver: new FunctionBackedBattleResolver(project, { enableFastReject: true }),
    autoBattleFastRejectEnabled: true,
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFastHazardBlockIndex: true,
    enableCompiledEffectCache: false,
    choiceResolver,
  });
  const spec = getMilestoneSpec(project, "onlyup-chaos-mt1-mt4");
  const initialState = simulator.createInitialState();

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
    milestoneFrontierResourceDiversity: true,
    // Budgeted scheduling in BOTH arms; continuation only in F2.
    enableBudgetedRepairScheduling: true,
    enableBudgetedRepairContinuation: ARM === "F2",
    // First probe = current code defaults; second grant = 2x first (defaults).
  });
  const wallMs = Date.now() - startedAt;
  assert.strictEqual(choiceResolver.unresolved.length, 0, "main run must leave no unresolved choices");

  const ledger = result.executionCompletionLedger || [];
  const runWide = {
    executions: ledger.length,
    finalPending: ledger.reduce((s, e) => s + Number(e.finalPending || 0), 0),
    terminalIncomplete: ledger.reduce((s, e) => s + Number(e.terminalIncomplete || 0), 0),
    unknownCompletion: ledger.filter(
      (e) => e.searchComplete !== true && e.searchComplete !== false).length,
  };
  const rs = result.repairScheduling ||
    ((result.failedSegment || {}).backtrack || {}).repairScheduling || null;
  const tickets = (rs && rs.hypotheses) || [];
  const events = (rs && rs.events) || [];
  const budgetStop = result.budget && result.budget.stoppedReason;
  const resourceStops = new Set(["rss-limit", "heap-limit", "time-limit", "expansion-limit"]);
  const schedulerPending = tickets.some((t) => t.status === "PROBE_PENDING");
  let finalCanonicalOutcome;
  if (result.found) finalCanonicalOutcome = "FOUND";
  else if (budgetStop && resourceStops.has(budgetStop)) {
    finalCanonicalOutcome = "RESOURCE_LIMITED";
  } else if (runWide.finalPending > 0) {
    finalCanonicalOutcome = "RESOURCE_LIMITED";
  } else if (schedulerPending) {
    finalCanonicalOutcome = "INCOMPLETE_SCOPE";
  } else if (runWide.terminalIncomplete > 0 || runWide.unknownCompletion > 0) {
    finalCanonicalOutcome = "INCOMPLETE_SCOPE";
  } else if (result.cancelled) finalCanonicalOutcome = "CANCELLED";
  else finalCanonicalOutcome = "EXHAUSTED";

  process.stdout.write(JSON.stringify({
    arm: ARM,
    found: Boolean(result.found),
    finalCanonicalOutcome,
    reachedMilestone: result.reachedMilestone || null,
    failedSegment: result.failedSegment
      ? {
          segmentId: result.failedSegment.segmentId || null,
          failureClass: result.failedSegment.failureClass ||
            (result.failedSegment.failurePropagation || {}).primaryFailureClass || null,
        }
      : null,
    budget: {
      stoppedReason: budgetStop || null,
      consumedExpansions: result.budget ? result.budget.consumedExpansions : null,
    },
    wallMs,
    processTree: {
      peakRssMb: result.processTreeMemory
        ? result.processTreeMemory.maxAggregateConcurrentRssUpperBoundMb : null,
    },
    runWide,
    scheduling: rs ? {
      enabled: rs.enabled,
      continuationEnabled: rs.continuationEnabled,
      hypotheses: tickets.length,
      firstProbes: events.filter((e) => e.probeIndex === 1).length,
      secondGrants: events.filter((e) => e.probeIndex === 2).length,
      progressClasses: tickets.reduce((acc, t) => {
        acc[t.progressClass || "none"] = (acc[t.progressClass || "none"] || 0) + 1;
        return acc;
      }, {}),
      continuationDecisions: tickets.reduce((acc, t) => {
        acc[t.continuationDecision || "none"] = (acc[t.continuationDecision || "none"] || 0) + 1;
        return acc;
      }, {}),
      secondGrantWinners: tickets
        .filter((t) => t.grantHistory && t.grantHistory[1])
        .map((t) => ({
          hypothesisId: t.hypothesisId,
          outcome: t.grantHistory[1].outcome,
          consumed: t.grantHistory[1].consumedExpansions,
        })),
    } : null,
  }) + "\\n");
}

main();
`;

const fs = require("node:fs");
const os = require("node:os");
const CHILD_PATH = path.join(os.tmpdir(), "iteration2-f1f2-child.js");
fs.writeFileSync(CHILD_PATH, CHILD_SOURCE);

function runArm(arm) {
  const res = spawnSync(
    process.execPath,
    ["--expose-gc", CHILD_PATH, arm],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 180000, env: { ...process.env, SOLVER_DIR: path.resolve(__dirname, "..", "..") } },
  );
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`arm ${arm} failed (${res.status}): ${res.stderr}\n${res.stdout}`);
  }
  const lines = res.stdout.trim().split("\n");
  return JSON.parse(lines[lines.length - 1]);
}

function main() {
  const arms = {};
  for (const arm of ["F1", "F2"]) {
    const record = runArm(arm);
    arms[arm] = record;
    process.stderr.write(
      `${arm}: found=${record.found} outcome=${record.finalCanonicalOutcome} ` +
      `stop=${record.budget.stoppedReason} exp=${record.budget.consumedExpansions} ` +
      `wall=${record.wallMs} tree=${record.processTree.peakRssMb} pend=${record.runWide.finalPending} ` +
      `hyp=${record.scheduling ? record.scheduling.hypotheses : 0} ` +
      `grants2=${record.scheduling ? record.scheduling.secondGrants : 0}\n`,
    );
  }
  process.stdout.write(JSON.stringify({
    schema: "motapathfinder.iteration2-f1f2-diagnostic.v1",
    baseCommit: "a7ab4f6 (dev; iteration-6 repair 2a: scheduler-aware breadth injection)",
    config: {
      route: "onlyup-chaos-mt1-mt4",
      searchIntent: "adaptive-feasible",
      adaptiveBacktrackDepth: 3,
      budgetScope: "global-run",
      maxExpansions: 50000,
      maxRuntimeMs: 30000,
      maxRssMb: 256,
      processTreeHardMb: 260,
      candidateLimit: 8,
      segmentExecutionMode: "isolated-process",
      failureIntent: "OFF (both arms)",
      firstProbe: "code defaults",
      secondGrant: "2x first probe (defaults)",
    },
    purpose: "DIAGNOSTIC ONLY (not an authority round; no MT4-proven/exhausted/production claims)",
    arms,
  }, null, 2) + "\n");
}

main();
