"use strict";

/**
 * PR-5.24b Iteration 6 Repair 2 — 2x2 SITE ATTRIBUTION authority rounds.
 *
 * Four fresh-process rounds on the same commit (00992dc solver behavior):
 *   A = ANCHOR_OFF / REPLAY_OFF  (baseline)
 *   B = ANCHOR_ON  / REPLAY_OFF  (anchor-only)
 *   C = ANCHOR_OFF / REPLAY_ON   (replay-only)
 *   D = ANCHOR_ON  / REPLAY_ON   (full Iteration 6)
 * Frozen contracts: 30s / 50k / 256MB stop / 260 hard / candidateLimit 8 /
 * adaptiveDepth 3 / milestoneFrontierResourceDiversity=true.
 *
 * This round is SITE_ATTRIBUTION, not a capability qualification: no run may
 * be reported as EXHAUSTED; RESOURCE_LIMITED classification stays fail-closed.
 */

const path = require("node:path");
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

const PROJECT_ROOT = path.resolve(process.env.SOLVER_DIR, "..", "Only upV2.1", "Only upV2.1");
const SITE = process.argv[2] || "A"; // A | B | C | D
const SITES = {
  A: { anchor: false, replay: false },
  B: { anchor: true, replay: false },
  C: { anchor: false, replay: true },
  D: { anchor: true, replay: true },
};
const site = SITES[SITE] || SITES.A;

function classifyRun(result) {
  const ledger = result.executionCompletionLedger || [];
  const pending = ledger.reduce((s, e) => s + Number(e.finalPending || 0), 0);
  const terminal = ledger.reduce((s, e) => s + Number(e.terminalIncomplete || 0), 0);
  const unknown = ledger.filter(
    (e) => e.searchComplete !== true && e.searchComplete !== false,
  ).length;
  const budgetStop = result.budget && result.budget.stoppedReason;
  const evalStops = new Set(
    (result.evaluationAttemptLedger || [])
      .map((att) => att.diagnostics && att.diagnostics.dp && att.diagnostics.dp.stoppedReason)
      .filter(Boolean),
  );
  const memoryStop = evalStops.has("rss-limit") || evalStops.has("heap-limit");
  const resourceStops = new Set(["rss-limit", "heap-limit", "time-limit", "expansion-limit"]);
  let finalCanonicalOutcome;
  if (result.found) finalCanonicalOutcome = "FOUND";
  else if (
    memoryStop || pending > 0 || (budgetStop && resourceStops.has(budgetStop))
  ) finalCanonicalOutcome = "RESOURCE_LIMITED";
  else if (terminal > 0 || unknown > 0) finalCanonicalOutcome = "INCOMPLETE_SCOPE";
  else if (result.cancelled) finalCanonicalOutcome = "CANCELLED";
  else finalCanonicalOutcome = "EXHAUSTED";
  return { pending, terminal, unknown, budgetStop, finalCanonicalOutcome };
}

function main() {
  const project = loadProject(PROJECT_ROOT);
  const { createNoStateChangeChoiceResolver } = require(path.join(SOLVER_LIB, "onlyup-mt1-real-route-gate"));
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
    enableFailureIntentAnchorRanking: site.anchor,
    enableFailureIntentReplayRanking: site.replay,
    captureSelectionAudit: true,
  });
  const wallMs = Date.now() - startedAt;
  assert.strictEqual(choiceResolver.unresolved.length, 0, "main run must leave no unresolved choices");

  const cls = classifyRun(result);
  const failed = result.failedSegment || null;
  const backtrack = (failed && failed.backtrack) || null;
  const intentRanking = backtrack && backtrack.failureIntentRanking
    ? {
        anchorActivated: backtrack.failureIntentRanking.anchor
          ? Boolean(backtrack.failureIntentRanking.anchor.activated) : false,
        replayActivated: backtrack.failureIntentRanking.replay
          ? Boolean(backtrack.failureIntentRanking.replay.activated) : false,
        events: (backtrack.failureIntentRanking.events || []).map((e) => ({
          phase: e.phase,
          depth: e.depth,
          waveIndex: e.waveIndex,
          replaySegmentId: e.replaySegmentId,
          inputCandidateCount: e.inputCandidateCount,
          candidateLimit: e.candidateLimit,
          activated: e.activated,
          reason: e.reason || null,
          topCandidateBefore: e.topCandidateBefore,
          topCandidateAfter: e.topCandidateAfter,
          promotedCandidateIds: e.promotedCandidateIds,
          selectedCandidateIds: e.selectedCandidateIds,
          evidenceCandidates: e.evidenceCandidates || [],
        })),
      }
    : null;

  const ledger = result.executionCompletionLedger || [];
  const adaptivePhases = {};
  ledger.forEach((e) => { adaptivePhases[e.phase] = (adaptivePhases[e.phase] || 0) + 1; });

  process.stdout.write(JSON.stringify({
    site: SITE,
    anchorIntent: site.anchor,
    replayIntent: site.replay,
    found: Boolean(result.found),
    finalCanonicalOutcome: cls.finalCanonicalOutcome,
    reachedMilestone: result.reachedMilestone || null,
    failedSegment: failed
      ? {
          segmentId: failed.segmentId || null,
          failureClass: failed.failureClass ||
            (failed.failurePropagation && failed.failurePropagation.primaryFailureClass) || null,
        }
      : null,
    budget: {
      stoppedReason: cls.budgetStop || null,
      consumedExpansions: result.budget ? result.budget.consumedExpansions : null,
    },
    wallMs,
    processTree: {
      peakRssMb: result.processTreeMemory
        ? result.processTreeMemory.maxAggregateConcurrentRssUpperBoundMb : null,
      qualified: result.processTreeMemory ? result.processTreeMemory.qualified : null,
    },
    runWide: {
      executions: ledger.length,
      finalPending: cls.pending,
      terminalIncomplete: cls.terminal,
      unknownCompletion: cls.unknown,
    },
    adaptive: {
      triggered: Boolean(backtrack && backtrack.attempted),
      phases: adaptivePhases,
      waveAttempts: (backtrack && backtrack.attempts) ? backtrack.attempts.length : 0,
    },
    failureIntentRanking: intentRanking,
  }) + "\\n");
}

main();
`;

const fs = require("node:fs");
const os = require("node:os");
const CHILD_PATH = path.join(os.tmpdir(), "iteration6c-site-child.js");
fs.writeFileSync(CHILD_PATH, CHILD_SOURCE);

function runRound(site) {
  const res = spawnSync(
    process.execPath,
    ["--expose-gc", CHILD_PATH, site],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 180000, env: { ...process.env, SOLVER_DIR: path.resolve(__dirname, "..", "..") } },
  );
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`round ${site} failed (${res.status}): ${res.stderr}\n${res.stdout}`);
  }
  const lines = res.stdout.trim().split("\n");
  return JSON.parse(lines[lines.length - 1]);
}

function main() {
  const sites = {};
  for (const site of ["A", "B", "C", "D"]) {
    const record = runRound(site);
    sites[site] = record;
    process.stderr.write(
      `${site} (anchor=${record.anchorIntent}/replay=${record.replayIntent}): ` +
      `found=${record.found} outcome=${record.finalCanonicalOutcome} ` +
      `stop=${record.budget.stoppedReason} exp=${record.budget.consumedExpansions} ` +
      `wall=${record.wallMs} tree=${record.processTree.peakRssMb} ` +
      `pend=${record.runWide.finalPending} waves=${record.adaptive.waveAttempts} ` +
      `failed=${record.failedSegment ? record.failedSegment.segmentId + ":" + record.failedSegment.failureClass : "none"}\n`,
    );
  }

  const aggregate = {
    schema: "motapathfinder.iteration6-site-attribution.v1",
    baseCommit: "00992dc (dev; iteration-6 repair 2: site-split gates + event telemetry)",
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
      milestoneFrontierResourceDiversity: true,
      freshProcessPerRound: true,
      purpose: "SITE_ATTRIBUTION (not capability qualification)",
    },
    sites,
  };
  process.stdout.write(JSON.stringify(aggregate, null, 2) + "\n");
}

main();
