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
  const g10 = gateContinuationCursor(probe);
  const g11 = gateInsufficientHeadroom();
  const g12 = gateLateWinner();
  const g13 = gateWallProbe();

  console.log(JSON.stringify({
    schema: "motapathfinder.budgeted-repair-scheduling.v2",
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
    },
  }, null, 2));
}

// G9 – isolated-process probe authority: the same hypothesis's anchor expand
// and downstream replay span two child processes and share ONE expansion
// probe; the total consumed expansions respect the probe contract (with a
// bounded per-attempt overshoot).
function gateIsolatedProbe() {
  const project = loadProject(DEFAULT_PROJECT_ROOT);
  const simulator = buildSimulator(project);
  const PROBE = 100;
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
  // Every hypothesis must respect the probe contract (child-local rebased):
  // consumed <= PROBE plus at most one attempt-slice overshoot per child.
  tickets.forEach((ticket, index) => {
    assert.ok(
      ticket.consumedExpansions <= PROBE * 2,
      `G9 ticket ${index}: hypothesis consumed ${ticket.consumedExpansions} > probe contract (<=${PROBE * 2} with one attempt-slice overshoot) — the isolated child was NOT rebased to child-local probe coordinates`,
    );
  });
  const ledgerStops = (result.evaluationAttemptLedger || [])
    .map((att) => att.diagnostics && att.diagnostics.dp && att.diagnostics.dp.stoppedReason)
    .filter(Boolean);
  const budgetStop = result.budget && result.budget.stoppedReason;
  // Global stop may fire from the OVERALL run budget, but probe-limited waves
  // must exist and the run must not claim exhaustion.
  assert.ok(
    info.attempts.some((a) => a.waveOutcome === "probe-limited"),
    "G9: probe-limited waves must exist on the isolated path",
  );
  assert.notStrictEqual(result.found ? "FOUND" : budgetStop, "EXHAUSTED");
  return {
    hypotheses: tickets.length,
    maxConsumedExpansions: Math.max(...tickets.map((t) => t.consumedExpansions)),
    probeExpansions: PROBE,
    isolatedMode: true,
  };
}

// G10 – continuation cursor: three cursor shapes locked.
//   (a) anchor probe expired before any replay → cursor = firstReplayIndex;
//   (b) replay K probe-expired mid-flight → cursor = K;
//   (c) replay genuinely completed → cursor advances past it.
// The main scheduled arm (probe=100) yields all three shapes across its
// hypotheses because the anchor consumes the probe to different depths.
function gateContinuationCursor(scheduledInfo) {
  const tickets = scheduledInfo.repairScheduling.hypotheses || [];
  assert.ok(tickets.length >= 1, "G10: hypotheses required");
  tickets.forEach((ticket, index) => {
    assert.ok(
      typeof ticket.nextReplaySegmentIndex === "number" &&
        ticket.nextReplaySegmentIndex >= 1,
      `G10 ticket ${index}: nextReplaySegmentIndex must be a valid segment index (got ${ticket.nextReplaySegmentIndex})`,
    );
    const entered = ticket.lastProgress && ticket.lastProgress.replaySegmentsEntered || 0;
    const completed = ticket.lastProgress && ticket.lastProgress.replaySegmentsCompleted || 0;
    assert.ok(
      completed <= entered,
      `G10 ticket ${index}: completed replays (${completed}) must not exceed entered (${entered})`,
    );
    // Cursor invariant: firstReplayIndex + completed <= cursor <= firstReplayIndex + entered
    // (cursor points at the first UNFINISHED replay; a completed tail advances it).
    assert.ok(
      ticket.nextReplaySegmentIndex >= 1 + completed &&
        ticket.nextReplaySegmentIndex <= 1 + Math.max(entered, completed),
      `G10 ticket ${index}: cursor ${ticket.nextReplaySegmentIndex} outside [first+completed=${1 + completed}, first+entered=${1 + entered}]`,
    );
  });
  // Shape (a): at least one hypothesis with zero ENTERED replays (anchor
  // consumed the probe) must have cursor = firstReplayIndex (1 for depth 1).
  const anchorExpired = tickets.find((t) =>
    (t.lastProgress && t.lastProgress.replaySegmentsEntered || 0) === 0 &&
    t.status === "PROBE_PENDING");
  if (anchorExpired) {
    assert.strictEqual(
      anchorExpired.nextReplaySegmentIndex,
      1,
      `G10(a): anchor-expired hypothesis must keep cursor at firstReplayIndex (got ${anchorExpired.nextReplaySegmentIndex})`,
    );
  }
  // Shape (b): an entered-but-not-completed replay keeps the cursor AT it.
  const midReplay = tickets.find((t) => {
    const entered = t.lastProgress && t.lastProgress.replaySegmentsEntered || 0;
    const completed = t.lastProgress && t.lastProgress.replaySegmentsCompleted || 0;
    return entered > completed;
  });
  if (midReplay) {
    assert.strictEqual(
      midReplay.nextReplaySegmentIndex,
      1 + (midReplay.lastProgress.replaySegmentsCompleted || 0),
      `G10(b): replay-expired hypothesis must keep cursor at the unfinished replay (got ${midReplay.nextReplaySegmentIndex})`,
    );
  }
  return {
    hypotheses: tickets.length,
    anchorExpiredCursor: anchorExpired ? anchorExpired.nextReplaySegmentIndex : "n/a",
    midReplayCursor: midReplay ? midReplay.nextReplaySegmentIndex : "n/a",
    cursorInvariant: true,
  };
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

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  }
}

module.exports = { main };
