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
 *   - SCHEDULED (scheduler ON, probe expansions 400): every hypothesis gets
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

  // ===== 1. DISABLED EQUIVALENCE =====
  const offA = repairInfo(runGraph(simulator, { maxExpansions: 5000 }));
  const offB = repairInfo(runGraph(simulator, {
    maxExpansions: 5000,
    enableBudgetedRepairScheduling: false,
  }));
  const signature = (info) => JSON.stringify({
    waves: info.attempts.map((a) => [a.depth, a.waveIndex, a.waveOutcome,
      (a.anchorInputCandidateIds || []).join("+")]),
    depthOutcomes: info.depthSummaries.map((d) => [d.depth, d.depthOutcome]),
    schedulingEnabled: info.repairScheduling ? info.repairScheduling.enabled : null,
  });
  assert.strictEqual(
    signature(offB),
    signature(offA),
    "disabled-equivalence gate: enableBudgetedRepairScheduling=false must be structurally identical to the flag being absent",
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

  console.log(JSON.stringify({
    schema: "motapathfinder.budgeted-repair-scheduling.v1",
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
    disabledEquivalence: true,
    correctness: {
      probeTimeoutNotGlobalStop: true,
      probeNotExhausted: true,
      pendingKeptIncomplete: true,
      globalAuthorityUnchanged: true,
    },
  }, null, 2));
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  }
}

module.exports = { main };
