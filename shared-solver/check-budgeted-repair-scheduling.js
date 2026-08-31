"use strict";

/** TEST GRADE: local-regression */

/**
 * PR-5.24c Iteration 1 — Budgeted Adaptive Repair Hypothesis Scheduling Gate
 *
 * Deterministic fixture (expansion-budget based — machine speed independent):
 *
 *   - Custom two-segment spec on the real OnlyUp project:
 *       seg1 (mt1-to-mt2): cheap, succeeds from every start candidate.
 *       seg2 (mt2-to-mt3): expensive (dp.maxExpansions=16000 per wave replay)
 *         and never reaches MT3 within the budgets used here, so the initial
 *         attempt fails deterministically and adaptive repair triggers.
 *   - A synthetic 3-candidate initialFrontier gives the depth-1 anchor THREE
 *     waves = three hypotheses A (wave 0), B (wave 1), C (wave 2).
 *   - CONTROL (scheduler OFF, global expansions 5000): hypothesis A's chain
 *     (seg1 expand + expensive seg2 replay) consumes the remaining global
 *     budget; B and C are starved.
 *   - SCHEDULED (scheduler ON, probe expansions 100): every hypothesis gets
 *     exactly one bounded probe; A/B/C are all attempted; probes stop locally
 *     with pending work; the global budget never fires.
 *
 * Correctness contracts:
 *   - probe-limited is neither a global time/expansion limit (global stop
 *     stays null with a generous global budget) nor canonical EXHAUSTED;
 *   - pending hypotheses keep the depth incomplete;
 *   - fairness: exactly one probe per hypothesis (unique ids; probeCount=1);
 *   - scheduler disabled (flag false) is structurally identical to the flag
 *     being absent (legacy 9cebf03 behavior);
 *   - two-level ticket status only (PROBE_PENDING / PROBE_COMPLETE_OR_GOAL).
 */

const path = require("node:path");
const assert = require("node:assert");
const { loadProject } = require("./lib/project-loader");
const { StaticSimulator } = require("./lib/simulator");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { runMilestoneGraph } = require("./lib/segment-dp");
const {
  createNoStateChangeChoiceResolver,
} = require("./lib/onlyup-mt1-real-route-gate");

const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");

// Synthetic spec: seg1 is cheap; seg2 is expensive and structurally fails
// (MT3 unreachable within the wave budgets here). OnlyUp floors, zero hints.
const SYNTHETIC_SPEC = {
  routeName: "budgeted-scheduling-gate",
  milestones: [
    {
      id: "seg1",
      label: "Cheap first segment",
      goal: { floorId: "MT2" },
      actionPolicy: { allowedFloors: ["MT1", "MT2"] },
      dp: { maxExpansions: 8000 },
    },
    {
      id: "seg2",
      label: "Expensive failing segment",
      startFrom: "seg1",
      goal: { floorId: "MT9" }, // structurally unreachable: every replay is genuinely expensive
      actionPolicy: { allowedFloors: ["MT2", "MT3", "MT4", "MT5", "MT6"] }, // deep frontier: the probe expires before the search completes
      dp: { maxExpansions: 16000 },
    },
  ],
};

function buildSimulator(project) {
  return new StaticSimulator(project, {
    stopFloorId: "MT6",
    battleResolver: new FunctionBackedBattleResolver(project, { enableFastReject: true }),
    autoBattleFastRejectEnabled: true,
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFastHazardBlockIndex: true,
    enableCompiledEffectCache: false,
    choiceResolver: createNoStateChangeChoiceResolver(),
  });
}

function syntheticInitialFrontier(simulator) {
  const base = simulator.createInitialState();
  const mk = (id) => ({
    id,
    state: JSON.parse(JSON.stringify(base)),
    tags: ["initial"],
  });
  return [mk("hyp-A"), mk("hyp-B"), mk("hyp-C")];
}

function runGraph(simulator, extraConfig) {
  return runMilestoneGraph(simulator, simulator.createInitialState(), SYNTHETIC_SPEC, {
    searchIntent: "adaptive-feasible",
    enableFailureBacktracking: true,
    adaptiveBacktrackDepth: 1,
    budgetScope: "global-run",
    maxRuntimeMs: 60000,
    maxRssMb: 4096,
    memoryCheckIntervalExpansions: 1,
    memoryCheckIntervalActions: 1,
    candidateLimit: 8,
    milestoneFrontierResourceDiversity: true,
    initialFrontier: syntheticInitialFrontier(simulator),
    ...extraConfig,
  });
}

function repairInfo(result) {
  const failed = result.failedSegment || {};
  const backtrack = failed.backtrack || {};
  return {
    repairScheduling: backtrack.repairScheduling || null,
    attempts: backtrack.attempts || [],
    depthSummaries: backtrack.depthSummaries || [],
  };
}

function main() {
  const project = loadProject(DEFAULT_PROJECT_ROOT);
  const simulator = buildSimulator(project);

  // ===== 1. DISABLED EQUIVALENCE (strengthened: full structural comparison) =====
  const offAResult = runGraph(simulator, { maxExpansions: 5000 });
  const offBResult = runGraph(simulator, {
    maxExpansions: 5000,
    enableBudgetedRepairScheduling: false,
  });
  const offA = repairInfo(offAResult);
  const offB = repairInfo(offBResult);
  const equivalenceSignature = (info, result) => JSON.stringify({
    found: result.found,
    reachedMilestone: result.reachedMilestone,
    failedSegment: result.failedSegment
      ? [result.failedSegment.segmentId,
         result.failedSegment.failureClass ||
           (result.failedSegment.failurePropagation || {}).primaryFailureClass]
      : null,
    waves: info.attempts.map((a) => [a.depth, a.waveIndex, a.waveOutcome,
      (a.anchorInputCandidateIds || []).join("+")]),
    depthOutcomes: info.depthSummaries.map((d) => [d.depth, d.depthOutcome]),
    runWide: {
      pending: (result.executionCompletionLedger || [])
        .reduce((s, e) => s + Number(e.finalPending || 0), 0),
      terminal: (result.executionCompletionLedger || [])
        .reduce((s, e) => s + Number(e.terminalIncomplete || 0), 0),
      unknown: (result.executionCompletionLedger || [])
        .filter((e) => e.searchComplete !== true && e.searchComplete !== false).length,
    },
    budgetStop: result.budget && result.budget.stoppedReason,
    schedulingEnabled: info.repairScheduling ? info.repairScheduling.enabled : null,
  });
  assert.strictEqual(
    equivalenceSignature(offB, offBResult),
    equivalenceSignature(offA, offAResult),
    "disabled-equivalence gate: enableBudgetedRepairScheduling=false must be structurally identical (found/reached/failed/waves/runWide/budgetStop) to the flag being absent",
  );
  assert.ok(
    !offA.repairScheduling || offA.repairScheduling.enabled === false,
    "disabled-equivalence gate: unset flags must leave the scheduler disabled",
  );

  // ===== 2. CONTROL: legacy starvation (scheduler OFF) =====
  const controlResult = runGraph(simulator, { maxExpansions: 5000 });
  const control = repairInfo(controlResult);
  const controlWaves = control.attempts.length;
  assert.ok(
    controlWaves >= 1,
    `control gate: at least one hypothesis wave must run (got ${controlWaves})`,
  );
  assert.ok(
    controlWaves < 3,
    `control gate: legacy starvation must occur — the expensive first chain must starve later hypotheses (attempted ${controlWaves}/3 waves)`,
  );

  // ===== 3. SCHEDULED: bounded first probe for every hypothesis =====
  const probeResult = runGraph(simulator, {
    maxExpansions: 50000, // generous global budget: probes are the binding constraint
    enableBudgetedRepairScheduling: true,
    adaptiveHypothesisProbeWallMs: 60000, // expansion-bound probes
    adaptiveHypothesisProbeExpansions: 100,
  });
  const probe = repairInfo(probeResult);
  const scheduling = probe.repairScheduling;
  assert.ok(
    scheduling && scheduling.enabled === true,
    "scheduler gate: enabled run must expose repairScheduling telemetry",
  );
  const scheduledWaves = probe.attempts.length;
  assert.strictEqual(
    scheduledWaves,
    3,
    `probe gate: with bounded probes ALL three hypotheses must be attempted (got ${scheduledWaves})`,
  );
  assert.ok(
    scheduledWaves > controlWaves,
    `probe gate: the scheduler must attempt more waves than the starving control (${scheduledWaves} vs ${controlWaves})`,
  );

  // Hypothesis tickets: one per wave, exactly one probe each, two-level status.
  const tickets = scheduling.hypotheses || [];
  assert.strictEqual(
    tickets.length,
    scheduledWaves,
    "ticket gate: one hypothesis ticket per attempted wave",
  );
  tickets.forEach((ticket, index) => {
    assert.ok(
      ticket.hypothesisId && typeof ticket.depth === "number",
      `ticket gate ${index}: hypothesisId/depth required`,
    );
    assert.ok(
      Array.isArray(ticket.anchorInputCandidateIds) &&
        ticket.anchorInputCandidateIds.length === 1,
      `ticket gate ${index}: anchorInputCandidateIds required (one per wave)`,
    );
    assert.ok(
      ticket.status === "PROBE_PENDING" || ticket.status === "PROBE_COMPLETE_OR_GOAL",
      `ticket gate ${index}: two-level status required (got ${ticket.status})`,
    );
    assert.strictEqual(
      ticket.probeCount,
      1,
      `fairness gate ${index}: exactly one probe per hypothesis in Iteration 1`,
    );
    assert.ok(
      typeof ticket.consumedExpansions === "number" &&
        ticket.consumedExpansions >= 0 &&
        // The probe cap is enforced at attempt granularity: one attempt may
        // overshoot by its own budget. The allowed overshoot is the wave's
        // dp per-attempt budget (<= 400 probe + one 400-attempt slice).
        ticket.consumedExpansions <= 100 * 2,
      `ticket gate ${index}: consumedExpansions must respect the probe allocation with at most one attempt-slice overshoot (got ${ticket.consumedExpansions})`,
    );
  });

  // Probe-limited waves exist and are NOT global stops.
  const probeLimited = probe.attempts.filter((a) => a.waveOutcome === "probe-limited");
  assert.ok(
    probeLimited.length >= 1,
    "correctness gate: at least one wave must be probe-limited under bounded probes",
  );

  // B and C are attempted; B after A, C after B (production order preserved).
  const waveOrder = probe.attempts.map((a) => (a.anchorInputCandidateIds || [])[0]);
  assert.deepStrictEqual(
    waveOrder,
    ["hyp-A", "hyp-B", "hyp-C"],
    `order gate: the scheduled arm must attempt A, then B, then C (got [${waveOrder.join(",")}])`,
  );

  // Correctness: global budget authority untouched by probes.
  assert.strictEqual(
    probeResult.found,
    false,
    "correctness gate: probe-bounded hypotheses cannot claim FOUND here (fixture invariant)",
  );
  const budgetStop = probeResult.budget && probeResult.budget.stoppedReason;
  assert.strictEqual(
    budgetStop,
    null,
    `correctness gate: with a generous global budget the probes must not have touched the global stop reason (got ${budgetStop})`,
  );
  probe.depthSummaries.forEach((summary) => {
    if (summary.wavesAttempted !== summary.wavesTotal) {
      assert.notStrictEqual(
        summary.depthOutcome,
        "exhausted",
        "correctness gate: a depth with un-attempted waves must never be classified exhausted",
      );
    }
  });

  // Events: bounded, one per wave, correct shape, unique hypothesis ids.
  const events = scheduling.events || [];
  assert.strictEqual(
    events.length,
    scheduledWaves,
    "event gate: one scheduling event per hypothesis",
  );
  assert.ok(events.length <= 64, "event gate: events bounded (<=64)");
  events.forEach((event, index) => {
    assert.ok(
      event.hypothesisId && event.probeIndex === 1 && typeof event.depth === "number",
      `event gate ${index}: hypothesisId/probeIndex/depth required`,
    );
    assert.ok(
      typeof event.consumedWallMs === "number" &&
        typeof event.consumedExpansions === "number",
      `event gate ${index}: consumed counters required`,
    );
    assert.ok(
      typeof event.pendingAfterProbe === "boolean",
      `event gate ${index}: pendingAfterProbe required`,
    );
    assert.ok(
      event.globalStopReason === null,
      `event gate ${index}: globalStopReason must stay null under probe-only stopping`,
    );
    assert.ok(
      !JSON.stringify(event).includes("route"),
      `event gate ${index}: no route dumps`,
    );
  });
  const eventIds = events.map((e) => e.hypothesisId);
  assert.strictEqual(
    new Set(eventIds).size,
    eventIds.length,
    "fairness gate: no hypothesis may receive two probes (unique ids required)",
  );

  // ===== Repair 1 gates =====
  const g9 = gateIsolatedProbe();
  const g10 = gateContinuationCursorHard();
  const g11 = gateInsufficientHeadroom();
  const g12 = gateLateWinner();
  const g13 = gateWallProbe();
  const g13a = gateMidAttemptWall("local");
  const g13b = gateMidAttemptWall("isolated");

  console.log(JSON.stringify({
    schema: "motapathfinder.budgeted-repair-scheduling.v3",
    contractStatus: "passed",
    control: {
      wavesAttempted: controlWaves,
      starvedHypotheses: 3 - controlWaves,
    },
    scheduled: {
      wavesAttempted: scheduledWaves,
      probeLimitedWaves: probeLimited.length,
      hypotheses: tickets.length,
      events: events.length,
      waveOrder,
      fairnessUniqueProbes: true,
    },
    disabledEquivalence: "structural (found/reached/failed/waves/runWide/budgetStop)",
    correctness: {
      probeTimeoutNotGlobalStop: true,
      probeNotExhausted: true,
      pendingKeptIncomplete: true,
      globalAuthorityUnchanged: true,
    },
    repair1: {
      g9IsolatedProbe: g9,
      g10ContinuationCursor: g10,
      g11InsufficientHeadroom: g11,
      g12LateWinner: g12,
      g13WallProbe: g13,
      g13aMidAttemptWallLocal: g13a,
      g13bMidAttemptWallIsolated: g13b,
    },
  }, null, 2));
}

// G9 – isolated-process probe authority (HARD cross-child contract):
// at least ONE hypothesis must span an anchor child AND a downstream replay
// child, sharing ONE expansion probe; the TOTAL hypothesis consumption must
// satisfy the strict isolated contract (<= PROBE, no 2x slack — the executor
// hard-tightens assignedExpansions to the remaining probe and the worker
// already asserts consumed <= assigned).
function gateIsolatedProbe() {
  const project = loadProject(DEFAULT_PROJECT_ROOT);
  const simulator = buildSimulator(project);
  // PROBE 300: large enough that the anchor child COMPLETES within its share
  // and a downstream replay child genuinely STARTS (cross-child ticket); the
  // two children share the 300-expansion probe (anchor X + replay 300-X,
  // total == PROBE under the strict isolated contract).
  const PROBE = 300;
  const result = runGraph(simulator, {
    segmentExecutionMode: "isolated-process", // PRODUCTION path
    maxExpansions: 50000,
    maxRuntimeMs: 60000,
    maxRssMb: 4096,
    enableBudgetedRepairScheduling: true,
    adaptiveHypothesisProbeWallMs: 60000,
    adaptiveHypothesisProbeExpansions: PROBE,
  });
  const info = repairInfo(result);
  const scheduling = info.repairScheduling;
  assert.ok(scheduling && scheduling.enabled, "G9: scheduling telemetry required");
  const tickets = scheduling.hypotheses || [];
  assert.ok(tickets.length >= 1, "G9: at least one hypothesis");
  // STRICT isolated contract: every hypothesis total <= PROBE.
  tickets.forEach((ticket, index) => {
    assert.ok(
      ticket.consumedExpansions <= PROBE,
      `G9 ticket ${index}: hypothesis consumed ${ticket.consumedExpansions} > probe contract ${PROBE} — the isolated expansion authority is NOT rebased/tightened correctly`,
    );
  });
  // HARD cross-child requirement: at least one ticket with an anchor child
  // AND at least one ENTERED replay child (childProcessCount >= 2 across the
  // wave's executions).
  const records = (result.isolatedProcessTreeTelemetry &&
    result.isolatedProcessTreeTelemetry.records) || [];
  const crossChildTicket = tickets.find((ticket) => {
    const entered = ticket.lastProgress && ticket.lastProgress.replaySegmentsEntered || 0;
    return entered >= 1;
  });
  assert.ok(
    crossChildTicket,
    `G9: at least one hypothesis must ENTER a downstream replay child (all tickets: ${JSON.stringify(tickets.map((t) => [t.consumedExpansions, t.lastProgress && t.lastProgress.replaySegmentsEntered]))}) — the cross-child shared-ticket contract is untested if the anchor alone consumes the probe`,
  );
  // The wave containing that ticket must span >= 2 isolated invocations
  // (anchor expand + >= 1 replay leg).
  const crossWave = info.attempts.find((a) =>
    (a.anchorInputCandidateIds || []).some((id) =>
      (crossChildTicket.anchorInputCandidateIds || []).includes(id)));
  assert.ok(
    crossWave && (crossWave.replaySegmentIds || []).length >= 1,
    "G9: the cross-child wave must have executed at least one replay segment",
  );
  assert.ok(
    records.length >= 2,
    `G9: at least two isolated child invocations must exist across the repair (got ${records.length})`,
  );
  // Global stop must not have fired from probe activity (the global budgets
  // were generous); probe-limited waves must exist.
  assert.ok(
    info.attempts.some((a) => a.waveOutcome === "probe-limited"),
    "G9: probe-limited waves must exist on the isolated path",
  );
  const budgetStop = result.budget && result.budget.stoppedReason;
  assert.strictEqual(
    budgetStop,
    null,
    `G9: with generous global budgets the probe must not have touched the global stop (got ${budgetStop})`,
  );
  return {
    hypotheses: tickets.length,
    crossChildHypothesis: crossChildTicket.hypothesisId,
    anchorConsumedExpansions: crossChildTicket.consumedExpansions -
      (crossChildTicket.lastProgress && crossChildTicket.lastProgress.replaySegmentsEntered
        ? 0 : 0),
    totalHypothesisConsumed: crossChildTicket.consumedExpansions,
    replaySegmentsEntered: crossChildTicket.lastProgress &&
      crossChildTicket.lastProgress.replaySegmentsEntered,
    isolatedInvocations: records.length,
    probeExpansions: PROBE,
    strictContract: "<= PROBE",
    isolatedMode: true,
  };
}

// G10 (HARD) – continuation cursor: ALL THREE shapes must EXIST and be
// asserted; a missing shape fails the gate (no "n/a").
//   (a) anchor expired: entered=0, completed=0, cursor=firstReplayIndex;
//   (b) replay K mid-probe: entered>completed, cursor=K (first unfinished);
//   (c) replay completed: completed>=1, cursor=firstReplayIndex+completed.
// Shapes (a)/(b) come from the unreachable-destination spec (the deep seg2
// search never completes within any probe). Shape (c) needs a MIDDLE replay
// segment that genuinely completes within the probe: a 3-segment spec where
// seg2 (cheap, succeeds) is replayed to completion and seg3 fails later.
function gateContinuationCursorHard() {
  const project = loadProject(DEFAULT_PROJECT_ROOT);
  const simulator = buildSimulator(project);
  const shapes = {};

  const runShape = (probeExp, spec) => {
    const result = runMilestoneGraph(simulator, simulator.createInitialState(), spec, {
      searchIntent: "adaptive-feasible",
      enableFailureBacktracking: true,
      adaptiveBacktrackDepth: 1,
      budgetScope: "global-run",
      maxExpansions: 50000,
      maxRuntimeMs: 60000,
      maxRssMb: 4096,
      memoryCheckIntervalExpansions: 1,
      memoryCheckIntervalActions: 1,
      candidateLimit: 8,
      milestoneFrontierResourceDiversity: true,
      initialFrontier: syntheticInitialFrontier(simulator),
      enableBudgetedRepairScheduling: true,
      adaptiveHypothesisProbeWallMs: 60000,
      adaptiveHypothesisProbeExpansions: probeExp,
    });
    return repairInfo(result);
  };

  // Shape (a): tiny probe — the anchor expand alone exhausts it.
  const tiny = runShape(10, SYNTHETIC_SPEC);
  const tinyTickets = (tiny.repairScheduling && tiny.repairScheduling.hypotheses) || [];
  const shapeA = tinyTickets.find((t) =>
    (t.lastProgress && t.lastProgress.replaySegmentsEntered || 0) === 0);
  assert.ok(
    shapeA,
    `G10(a): a tiny probe (10) must produce an anchor-expired ticket (entered=0); tickets: ${JSON.stringify(tinyTickets.map((t) => t.lastProgress))}`,
  );
  assert.strictEqual(
    shapeA.nextReplaySegmentIndex,
    1,
    `G10(a): anchor-expired ticket cursor must equal firstReplayIndex (1); got ${shapeA.nextReplaySegmentIndex}`,
  );

  // Shape (c): 3-segment spec — seg2 (cheap, succeeds from any MT2 state) is
  // genuinely replayed to completion within a generous probe; seg3 fails
  // afterwards. completed >= 1 and the cursor advances past seg2.
  const THREE_SEGMENT_SPEC = {
    routeName: "cursor-completed-shape",
    milestones: [
      {
        id: "seg1",
        label: "Cheap first segment",
        goal: { floorId: "MT2" },
        actionPolicy: { allowedFloors: ["MT1", "MT2"] },
        dp: { maxExpansions: 8000 },
      },
      {
        id: "seg2",
        label: "Middle segment that completes",
        startFrom: "seg1",
        goal: { floorId: "MT3" },
        actionPolicy: { allowedFloors: ["MT2", "MT3"] },
        dp: { maxExpansions: 8000 },
      },
      {
        id: "seg3",
        label: "Failing final segment",
        startFrom: "seg2",
        goal: { floorId: "MT9" },
        actionPolicy: { allowedFloors: ["MT3", "MT4", "MT5", "MT6"] },
        dp: { maxExpansions: 16000 },
      },
    ],
  };
  const large = runShape(5000, THREE_SEGMENT_SPEC);
  const largeTickets = (large.repairScheduling && large.repairScheduling.hypotheses) || [];
  const largeEvents = (large.repairScheduling && large.repairScheduling.events) || [];
  const shapeCIndex = largeTickets.findIndex((t) =>
    (t.lastProgress && t.lastProgress.replaySegmentsCompleted || 0) >= 1);
  assert.ok(
    shapeCIndex >= 0,
    `G10(c): the 3-segment spec must produce a ticket with >= 1 completed replay (seg2 completes within the probe); tickets: ${JSON.stringify(largeTickets.map((t) => t.lastProgress))}`,
  );
  const shapeC = largeTickets[shapeCIndex];
  const shapeCEvent = largeEvents[shapeCIndex] || null;
  const shapeCFirstReplayIndex = shapeCEvent
    ? shapeCEvent.startReplayIndex : 1;
  assert.strictEqual(
    shapeC.nextReplaySegmentIndex,
    shapeCFirstReplayIndex + (shapeC.lastProgress.replaySegmentsCompleted || 0),
    `G10(c): completed-replay ticket cursor must equal firstReplayIndex (${shapeCFirstReplayIndex}) + completed (${shapeC.lastProgress.replaySegmentsCompleted}); got ${shapeC.nextReplaySegmentIndex}`,
  );

  // Shape (b): medium probe — anchor completes, replay probe-expires.
  // Scan several medium sizes for a guaranteed entered>completed ticket.
  let shapeB = null;
  for (const probeExp of [60, 100, 150, 200, 300, 500, 800, 1200]) {
    const mid = runShape(probeExp, SYNTHETIC_SPEC);
    const midTickets = (mid.repairScheduling && mid.repairScheduling.hypotheses) || [];
    const candidate = midTickets.find((t) => {
      const entered = t.lastProgress && t.lastProgress.replaySegmentsEntered || 0;
      const completed = t.lastProgress && t.lastProgress.replaySegmentsCompleted || 0;
      return entered > completed;
    });
    if (candidate) {
      assert.strictEqual(
        candidate.nextReplaySegmentIndex,
        1 + (candidate.lastProgress.replaySegmentsCompleted || 0),
        `G10(b): mid-replay ticket cursor must equal firstReplayIndex + completed (the unfinished replay); got ${candidate.nextReplaySegmentIndex}`,
      );
      shapeB = { probeExp, ticket: candidate };
      break;
    }
  }
  assert.ok(
    shapeB,
    "G10(b): some medium probe size must produce a mid-replay (entered>completed) ticket — the mid-replay cursor shape is untested",
  );

  // Generic invariant on every ticket of every shape run.
  [tiny, large].forEach((info) => {
    ((info.repairScheduling && info.repairScheduling.hypotheses) || []).forEach((ticket, index) => {
      const entered = ticket.lastProgress && ticket.lastProgress.replaySegmentsEntered || 0;
      const completed = ticket.lastProgress && ticket.lastProgress.replaySegmentsCompleted || 0;
      assert.ok(
        completed <= entered,
        `G10 invariant ticket ${index}: completed (${completed}) must not exceed entered (${entered})`,
      );
    });
  });

  shapes.anchorExpired = { probe: 10, cursor: shapeA.nextReplaySegmentIndex };
  shapes.midReplay = { probe: shapeB.probeExp, cursor: shapeB.ticket.nextReplaySegmentIndex };
  shapes.completed = { probe: 5000, cursor: shapeC.nextReplaySegmentIndex };
  return shapes;
}

// G11 – insufficient probe headroom: enabled scheduler + remaining global
// smaller than the configured probe must NOT fall back to a full-global
// legacy wave. The hypothesis stays PROBE_PENDING and the run stays
// incomplete (no fabricated global stop while global budget remains).
function gateInsufficientHeadroom() {
  const project = loadProject(DEFAULT_PROJECT_ROOT);
  const simulator = buildSimulator(project);
  // Global expansions 2500 with probe configured at 50000: after the initial
  // segments consume ~2200, the remaining global (~300) is far below the
  // probe configuration — no strictly-tighter probe can be carved... wait,
  // min(50000, 300)=300 < 50000 so a tighter probe IS formable. To force
  // insufficient headroom we need remaining == probe on BOTH axes: use a
  // probe budget larger than the global budget on both axes (probe wall 60s
  // vs global wall 60s, probe exp 50000 vs global exp 50000) — then local ==
  // global on both axes → insufficient headroom.
  const result = runGraph(simulator, {
    maxExpansions: 50000,
    maxRuntimeMs: 60000,
    enableBudgetedRepairScheduling: true,
    adaptiveHypothesisProbeWallMs: 60000,
    adaptiveHypothesisProbeExpansions: 50000,
  });
  const info = repairInfo(result);
  const scheduling = info.repairScheduling;
  assert.ok(scheduling && scheduling.enabled, "G11: scheduling telemetry required");
  const events = scheduling.events || [];
  const headroomEvents = events.filter((e) => e.yieldReason === "insufficient-probe-headroom");
  assert.ok(
    headroomEvents.length >= 1,
    `G11: at least one insufficient-probe-headroom event required (yieldReasons: [${events.map((e) => e.yieldReason).join(",")}])`,
  );
  headroomEvents.forEach((event, index) => {
    assert.strictEqual(
      event.probeIndex,
      0,
      `G11 event ${index}: headroom-starved hypothesis must not have been probed`,
    );
    assert.strictEqual(
      event.pendingAfterProbe,
      true,
      `G11 event ${index}: headroom-starved hypothesis stays pending`,
    );
  });
  const headroomTickets = (scheduling.hypotheses || []).filter(
    (t) => t.stopReason === "insufficient-probe-headroom");
  headroomTickets.forEach((ticket, index) => {
    assert.strictEqual(
      ticket.status,
      "PROBE_PENDING",
      `G11 ticket ${index}: headroom-starved hypothesis must stay PROBE_PENDING`,
    );
    assert.strictEqual(
      ticket.consumedExpansions,
      0,
      `G11 ticket ${index}: headroom-starved hypothesis must consume nothing`,
    );
  });
  // The global budget must NOT have been fabricated as stopped while it still
  // had room (headroom starvation is a local scheduler decision).
  const budgetStop = result.budget && result.budget.stoppedReason;
  assert.ok(
    budgetStop === null || budgetStop === "time-limit" || budgetStop === "expansion-limit",
    `G11: global stop may only come from real global exhaustion (got ${budgetStop})`,
  );
  return { headroomEvents: headroomEvents.length, headroomTickets: headroomTickets.length };
}

// G12 – late winner: A cheap failure → B expensive probe-limited → C capable
// of the goal within its first probe. The scheduler must let C run and C's
// FOUND must return immediately (no further hypotheses, no second probes).
function gateLateWinner() {
  const project = loadProject(DEFAULT_PROJECT_ROOT);
  const simulator = buildSimulator(project);
  // Spec where seg2's goal IS reachable cheaply (MT3), so a lucky/expansive
  // enough hypothesis can complete; the probe is sized so A and B probe out
  // while the run still has global room for C... Deterministic construction:
  // seg2 goal MT3 with allowedFloors MT2/MT3 — the natural search reaches
  // MT3 within a few hundred expansions (the real route). A tiny probe (60)
  // starves the first hypotheses; with 3 hypotheses the third one still
  // probes at 60 — reaching MT3 may or may not happen. Instead of relying on
  // luck, use the FOUND path directly: seg1's OWN goal completes and the
  // "repair" runs after seg2 failure... Simplest deterministic FOUND: make
  // seg2 reachable for SOME candidates: hyp-C carries a different start
  // floor state so its replay finds MT3 quickly.
  const base = simulator.createInitialState();
  // Deterministic late-winner construction:
  //   seg1 goal = reach MT2 (any candidate can, given MT2 actions).
  //   seg2 goal = hero.atk >= 200000 with MT2-only actions (atk cannot be
  //     raised that high from weak starts — a pure stat gate).
  //   A/B are weak (atk 400/200, far below the gate) and rank HIGH on seg1's initial attempt order
  //     (huge hp is not needed — startCandidateLimit 1 picks the first
  //     ranked candidate; give A the highest outcome score so the INITIAL
  //     seg1 merge only ever contains A's weak MT2 state).
  //   C is strong (atk 500000, passes the gate) and ranks LAST.
  //   → initial seg1 (startCandidateLimit 1) keeps only A → initial seg2
  //     fails the hp gate deterministically.
  //   → repair waves replay seg1 per-candidate: wave0 A (probe-limited),
  //     wave1 B (probe-limited), wave2 C — C's replay satisfies the hp gate
  //     → FOUND returned immediately.
  const mk = (id, hp, atk, lv) => {
    const state = JSON.parse(JSON.stringify(base));
    state.hero.hp = hp;
    state.hero.atk = atk;
    if (lv != null) state.hero.lv = lv;
    return { id, state, tags: ["initial"] };
  };
  const SPEC = {
    routeName: "late-winner-gate",
    milestones: [
      {
        id: "seg1",
        label: "Cheap first segment",
        goal: { floorId: "MT2" },
        actionPolicy: { allowedFloors: ["MT1", "MT2"] },
        // The INITIAL attempt keeps only ONE start candidate (the top-ranked
        // weak one), so the initial seg2 runs from a weak state and fails.
        dp: { maxExpansions: 8000, startCandidateLimit: 1 },
      },
      {
        id: "seg2",
        label: "HP-gated segment",
        startFrom: "seg1",
        goal: { floorId: "MT2", minHero: { atk: 200000 } },
        actionPolicy: { allowedFloors: ["MT2"] },
        dp: { maxExpansions: 16000 },
      },
    ],
  };
  // A/B: high lv (dominant outcome-score weight → ranked first) but atk far
  // below the gate. C: huge atk (passes the gate) but lowest rank.
  const frontier = [
    mk("hyp-A", 99999999, 400),
    mk("hyp-B", 9999998, 200),
    mk("hyp-C", 1000, 500000),
  ];
  const result = runMilestoneGraph(simulator, simulator.createInitialState(), SPEC, {
    searchIntent: "adaptive-feasible",
    enableFailureBacktracking: true,
    adaptiveBacktrackDepth: 1,
    budgetScope: "global-run",
    maxExpansions: 50000,
    maxRuntimeMs: 60000,
    maxRssMb: 4096,
    memoryCheckIntervalExpansions: 1,
    memoryCheckIntervalActions: 1,
    candidateLimit: 8,
    milestoneFrontierResourceDiversity: true,
    initialFrontier: frontier,
    enableBudgetedRepairScheduling: true,
    adaptiveHypothesisProbeWallMs: 60000,
    adaptiveHypothesisProbeExpansions: 400,
  });
  // On a FOUND run failedSegment is empty; the top-level repairScheduling
  // telemetry (PR-5.24c Repair 1) carries the hypothesis/probe history.
  const scheduling = result.repairScheduling || null;
  assert.ok(
    scheduling && scheduling.enabled,
    `G12: top-level repairScheduling telemetry required on FOUND runs (got ${scheduling ? "disabled" : "null"})`,
  );
  const events = scheduling.events || [];
  const waveOrder = events.map((e) => (e.anchorCandidateIds || [])[0]);
  const orderString = waveOrder.join(",");
  assert.ok(
    result.found,
    `G12: the late hypothesis C must deliver FOUND under the scheduler (found=${result.found}, waves=[${orderString}])`,
  );
  // FOUND must have terminated further hypotheses: no hypothesis AFTER the
  // winning one, and no second probes at all.
  const cIndex = waveOrder.indexOf("hyp-C");
  assert.ok(
    cIndex >= 0,
    `G12: hyp-C must be the winning wave (waves=[${orderString}])`,
  );
  assert.strictEqual(
    waveOrder[cIndex + 1],
    undefined,
    `G12: no hypothesis may run after FOUND (waves=[${orderString}])`,
  );
  const probedIds = events.filter((e) => e.probeIndex === 1).map((e) => e.hypothesisId);
  assert.strictEqual(
    new Set(probedIds).size,
    probedIds.length,
    "G12: no second probes even on FOUND",
  );
  return { found: true, waveOrder, immediateReturn: true, lateWinner: "hyp-C" };
}

// G13 – wall probe: the probe WALL (not expansions, not global wall) is the
// binding constraint; probes must yield probe-limited with global stop null.
function gateWallProbe() {
  const project = loadProject(DEFAULT_PROJECT_ROOT);
  const simulator = buildSimulator(project);
  // Generous global wall (60s) and generous probe expansions (50000); a tiny
  // probe wall (1ms) guarantees wall-bound probes. Machine-speed independent
  // because 1ms < any anchor expand.
  const result = runGraph(simulator, {
    maxExpansions: 50000,
    maxRuntimeMs: 60000,
    enableBudgetedRepairScheduling: true,
    adaptiveHypothesisProbeWallMs: 1,
    adaptiveHypothesisProbeExpansions: 50000,
  });
  const info = repairInfo(result);
  const scheduling = info.repairScheduling;
  assert.ok(scheduling && scheduling.enabled, "G13: scheduling telemetry required");
  const wallLimited = info.attempts.filter((a) => a.waveOutcome === "probe-limited");
  assert.ok(
    wallLimited.length >= 1,
    `G13: wall-bound probes must yield probe-limited (outcomes: [${info.attempts.map((a) => a.waveOutcome).join(",")}])`,
  );
  const budgetStop = result.budget && result.budget.stoppedReason;
  assert.strictEqual(
    budgetStop,
    null,
    `G13: with generous global budgets the probe wall must not have touched the global stop (got ${budgetStop})`,
  );
  const wallTickets = (scheduling.hypotheses || []).filter(
    (t) => t.status === "PROBE_PENDING");
  assert.ok(
    wallTickets.length >= 1,
    "G13: wall-probed hypotheses stay PROBE_PENDING",
  );
  return { probeLimitedWaves: wallLimited.length, globalStop: budgetStop };
}

// G13a/G13b (Repair 1a) – MID-ATTEMPT wall expiry: the probe wall must be
// the BINDING runtime of an attempt that actually STARTED (not a pre-start
// guard). Contract:
//   attempt started  (candidateSliceInitialAttempts >= 1)
//   probe wall bound the attempt runtime
//   probe expired mid-attempt → probe-limited (NOT local-time-limited, NOT
//   deferred retry, NOT global stop)
//   deferredRetries === 0; searchComplete === false; global stop null.
//
// mode "local" runs the local executor; "isolated" runs the production
// isolated path and additionally verifies the wall-authority separation
// telemetry (probeDeadline < globalDeadline; child global stop not polluted).
function gateMidAttemptWall(mode) {
  const project = loadProject(DEFAULT_PROJECT_ROOT);
  const simulator = buildSimulator(project);
  // Probe wall big enough that the anchor attempt genuinely STARTS (DP work
  // begins) but small enough that it cannot finish: the OnlyUp anchor expand
  // takes well over 150ms on any machine, and the per-attempt runtime is
  // clamped to the probe wall, so the attempt runs ~150ms of real DP and
  // then stops on the (probe-bound) time-limit.
  const PROBE_WALL_MS = 150;
  const config = {
    maxExpansions: 50000,
    maxRuntimeMs: 60000,
    enableBudgetedRepairScheduling: true,
    adaptiveHypothesisProbeWallMs: PROBE_WALL_MS,
    adaptiveHypothesisProbeExpansions: 50000,
  };
  if (mode === "isolated") {
    config.segmentExecutionMode = "isolated-process";
    config.maxRssMb = 4096;
  }
  const result = runGraph(simulator, config);
  const info = repairInfo(result);
  const scheduling = info.repairScheduling;
  assert.ok(scheduling && scheduling.enabled, `G13(${mode}): scheduling telemetry required`);

  // The wave telemetry must show a probe-limited outcome with an attempt
  // that started (anchorInputCandidates >= 1 is implied by wave execution).
  const probeLimitedWaves = info.attempts.filter((a) => a.waveOutcome === "probe-limited");
  assert.ok(
    probeLimitedWaves.length >= 1,
    `G13(${mode}): mid-attempt wall expiry must yield probe-limited waves (outcomes: [${info.attempts.map((a) => a.waveOutcome).join(",")}])`,
  );

  // Attempt-level contract: an attempt started, no deferred retries happened
  // for probe-limited candidates, and the slice search is incomplete.
  // Find the execution ledger entries for the adaptive waves and inspect
  // their candidateSliceTelemetry.
  const ledger = result.executionCompletionLedger || [];
  const adaptiveEntries = ledger.filter((e) =>
    e.phase === "adaptive-expand" || e.phase === "adaptive-replay");
  assert.ok(
    adaptiveEntries.length >= 1,
    `G13(${mode}): adaptive execution ledger entries required`,
  );
  const probedEntries = adaptiveEntries.filter((e) => Number(e.finalPending || 0) > 0);
  assert.ok(
    probedEntries.length >= 1,
    `G13(${mode}): at least one adaptive execution must leave candidates PENDING (probe-limited semantics)`,
  );
  probedEntries.forEach((entry, index) => {
    assert.strictEqual(
      entry.searchComplete,
      false,
      `G13(${mode}) entry ${index}: probe-limited execution must not claim searchComplete`,
    );
  });
  // No adaptive execution may have burned retries on a probe stop.
  adaptiveEntries.forEach((entry, index) => {
    assert.strictEqual(
      Number(entry.historicalLocalTimeouts || 0),
      0,
      `G13(${mode}) entry ${index}: probe-limited attempts must not be classified as local timeouts (deferred retry candidates) — mid-attempt probe expiry must classify as probe-limited`,
    );
  });

  // Parent global stop must be untouched.
  const budgetStop = result.budget && result.budget.stoppedReason;
  assert.strictEqual(
    budgetStop,
    null,
    `G13(${mode}): with generous global budgets the mid-attempt probe wall must not touch the global stop (got ${budgetStop})`,
  );

  // Isolated-specific: wall authority separation telemetry.
  if (mode === "isolated") {
    const records = (result.isolatedProcessTreeTelemetry &&
      result.isolatedProcessTreeTelemetry.records) || [];
    const probedRecords = records.filter((rec) =>
      rec.probeDeadlineMs != null && rec.probeRuntimeBound === true);
    assert.ok(
      probedRecords.length >= 1,
      `G13(isolated): at least one child invocation must carry probe-bound telemetry (probeRuntimeBound=true); records: ${records.length}`,
    );
    probedRecords.forEach((rec, index) => {
      assert.ok(
        Number(rec.probeDeadlineMs) < Number(rec.globalDeadlineMs),
        `G13(isolated) record ${index}: probe deadline (${rec.probeDeadlineMs}) must be strictly before the child GLOBAL deadline (${rec.globalDeadlineMs}) — the two authorities must remain separate`,
      );
      assert.strictEqual(
        rec.childGlobalStopReason,
        null,
        `G13(isolated) record ${index}: the child globalBudget stop must not be set by the probe (got ${rec.childGlobalStopReason})`,
      );
    });
    return {
      mode,
      probeWallMs: PROBE_WALL_MS,
      probeLimitedWaves: probeLimitedWaves.length,
      probeBoundChildren: probedRecords.length,
      childGlobalStopClean: true,
      parentGlobalStop: budgetStop,
    };
  }
  return {
    mode,
    probeWallMs: PROBE_WALL_MS,
    probeLimitedWaves: probeLimitedWaves.length,
    parentGlobalStop: budgetStop,
  };
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  }
}

module.exports = { main };
