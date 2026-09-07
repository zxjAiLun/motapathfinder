"use strict";

/** TEST GRADE: local-regression */

/**
 * PR-5.24i — Terminal Positive Progress Counterfactual Work-Conservation.
 *
 * "Positive progress ever happened" must not permanently suppress the
 * counterfactual.  Only a positive ticket that still represents EXECUTABLE
 * normal work (ACTIONABLE positive) blocks CF.  A ticket that reached positive
 * progress but is determinately finished without a goal is
 * TERMINAL_POSITIVE_NO_GOAL and no longer blocks CF on its own.
 *
 * G31 gates:
 *   G31-A: historical no-progress CF parity (primary all NO_PROGRESS → CF)
 *   G31-B: terminal-positive-no-goal triggers CF (core gate)
 *   G31-C: actionable positive still blocks CF (probe-limited / continuation
 *          eligible / pending)
 *   G31-D: deferred normal authority preserved (deferred are fallback work,
 *          not blockers — G24-K1/K3 contract)
 *   G31-E: global/resource stop blocks CF
 *   G31-F: goal-reached excluded from terminal classification
 *   B11:   admission replay of the 9.2s Formal Run ticket trajectory
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert");
const { assessCounterfactualAdmission } = require("./lib/segment-dp");

const TICKET_BASE = {
  hypothesisId: "t0",
  depth: 1,
  counterfactualIntentId: null,
  probeCount: 1,
  anchorOutputStateKey: "real",
};

function makeTicket(overrides) {
  return {
    ...TICKET_BASE,
    status: "PROBE_COMPLETE_OR_GOAL",
    stopReason: "exhausted",
    progressClass: "NO_MEASURABLE_PROGRESS",
    continuationEligible: false,
    lastProgress: { goalReached: false },
    ...overrides,
  };
}

function admissionInput(overrides) {
  return {
    config: {},
    normalDepthTickets: [],
    deferredNormalDescriptors: [],
    depthGoalReached: false,
    globalStopReason: null,
    isTrustedCompleteFailure: true,
    failureExecutionDeterminateComplete: true,
    counterfactualAlreadyTriggered: false,
    intentGeneratorAvailable: true,
    normalFirstRoundComplete: true,
    realNormalProbedTickets: [makeTicket({})],
    primaryNoProgressReason: "primary-normal-exhausted-no-progress",
    ...overrides,
  };
}

// ========== G31-A: Historical no-progress CF parity ==========
function gateG31A_NoProgressParity() {
  const tickets = [
    makeTicket({ hypothesisId: "n0", progressClass: "NO_MEASURABLE_PROGRESS" }),
    makeTicket({ hypothesisId: "n1", progressClass: "NO_MEASURABLE_PROGRESS" }),
  ];
  const res = assessCounterfactualAdmission(admissionInput({ normalDepthTickets: tickets }));
  assert.strictEqual(res.trigger, true, "G31-A: all-NO_PROGRESS primary must trigger CF");
  assert.strictEqual(res.reason, "primary-normal-exhausted-no-progress", "G31-A: historical reason preserved");
  assert.strictEqual(res.positiveTicketCount, 0, "G31-A: zero positive tickets");
  return { noProgressParityVerified: true, trigger: res.trigger, reason: res.reason };
}

// ========== G31-B: Terminal positive no goal triggers CF (CORE) ==========
function gateG31B_TerminalPositiveNoGoal() {
  const tickets = [
    makeTicket({
      hypothesisId: "p0",
      progressClass: "SEGMENT_ADVANCE",
      status: "PROBE_COMPLETE_OR_GOAL",
      stopReason: "exhausted",
      continuationEligible: false,
      lastProgress: { goalReached: false },
    }),
    makeTicket({
      hypothesisId: "p1",
      progressClass: "WITHIN_SEGMENT_PROGRESS",
      status: "PROBE_COMPLETE_OR_GOAL",
      stopReason: "exhausted",
      continuationEligible: false,
      lastProgress: { goalReached: false },
    }),
  ];
  const res = assessCounterfactualAdmission(admissionInput({ normalDepthTickets: tickets }));
  assert.strictEqual(res.positiveTicketCount, 2, "G31-B: two positive tickets observed");
  assert.strictEqual(res.actionablePositiveTicketCount, 0, "G31-B: zero actionable positive tickets");
  assert.strictEqual(res.terminalPositiveTicketCount, 2, "G31-B: two terminal positive tickets");
  assert.strictEqual(res.hasPendingNormalWork, false, "G31-B: no pending work");
  assert.strictEqual(res.trigger, true, "G31-B: terminal-positive-no-goal MUST trigger CF (core gate)");
  assert.strictEqual(res.reason, "terminal-positive-no-goal", "G31-B: distinct trigger reason");
  return {
    terminalPositiveNoGoalVerified: true,
    trigger: res.trigger,
    reason: res.reason,
    positiveTicketCount: res.positiveTicketCount,
    actionablePositiveTicketCount: res.actionablePositiveTicketCount,
    terminalPositiveTicketCount: res.terminalPositiveTicketCount,
  };
}

// ========== G31-C: Actionable positive still blocks CF ==========
function gateG31C_ActionablePositiveBlocks() {
  const cases = [
    {
      label: "probe-limited",
      ticket: makeTicket({ progressClass: "SEGMENT_ADVANCE", stopReason: "probe-limited", status: "PROBE_PENDING" }),
    },
    {
      label: "continuation-eligible",
      ticket: makeTicket({ progressClass: "SEGMENT_ADVANCE", stopReason: "probe-limited", continuationEligible: true }),
    },
    {
      label: "pending-status",
      ticket: makeTicket({ progressClass: "WITHIN_SEGMENT_PROGRESS", status: "PROBE_PENDING", stopReason: "time-limited" }),
    },
  ];
  const results = cases.map(({ label, ticket }) => {
    const res = assessCounterfactualAdmission(admissionInput({
      normalDepthTickets: [makeTicket({}), ticket],
    }));
    assert.strictEqual(res.trigger, false, `G31-C [${label}]: actionable positive must block CF`);
    assert.strictEqual(res.reason, "normal-primary-progress", `G31-C [${label}]: historical block reason`);
    assert.strictEqual(res.actionablePositiveTicketCount, 1, `G31-C [${label}]: one actionable positive`);
    return { label, trigger: res.trigger, reason: res.reason };
  });
  return {
    actionablePositiveBlocksVerified: true,
    cases: results,
  };
}

// ========== G31-D: Deferred normal authority ==========
function gateG31D_DeferredNormalAuthority() {
  // Deferred normals are PR-5.24e fallback work: they do NOT block CF
  // (G24-K1: CF runs before secondary; G24-K3: deferred resume when CF is
  // useless).  The helper must preserve that contract verbatim.
  const terminalPositiveTickets = [
    makeTicket({ progressClass: "SEGMENT_ADVANCE", stopReason: "exhausted", continuationEligible: false }),
  ];
  const res = assessCounterfactualAdmission(admissionInput({
    normalDepthTickets: terminalPositiveTickets,
    deferredNormalDescriptors: [{ desc: "deferred-secondary" }],
  }));
  assert.strictEqual(res.trigger, true, "G31-D: deferred normals must NOT block CF (fallback semantics)");
  assert.strictEqual(res.reason, "terminal-positive-no-goal", "G31-D: terminal-positive reason");
  assert.strictEqual(res.hasDeferredNormalWork, true, "G31-D: deferred presence observable in telemetry");
  assert.strictEqual(res.deferredNormalPresent, true, "G31-D: deferredNormalPresent telemetry field");
  // And with no positives: the historical no-progress + deferred case also triggers CF.
  const resNoProgress = assessCounterfactualAdmission(admissionInput({
    deferredNormalDescriptors: [{ desc: "deferred-secondary" }],
  }));
  assert.strictEqual(resNoProgress.trigger, true, "G31-D: no-progress + deferred also triggers (K1 parity)");
  return {
    deferredNormalAuthorityVerified: true,
    deferredDoesNotBlock: true,
    deferredResumeRemainsFallback: true,
  };
}

// ========== G31-E: Global/resource stop blocks CF ==========
function gateG31E_GlobalStopBlocks() {
  const tickets = [
    makeTicket({ progressClass: "SEGMENT_ADVANCE", stopReason: "exhausted", continuationEligible: false }),
  ];
  const res = assessCounterfactualAdmission(admissionInput({
    normalDepthTickets: tickets,
    globalStopReason: "time-limit",
  }));
  assert.strictEqual(res.trigger, false, "G31-E: global stop must block CF even with terminal positives");
  assert.strictEqual(res.reason, "global-stop", "G31-E: global-stop reason");
  return { globalStopBlocksVerified: true, trigger: res.trigger, reason: res.reason };
}

// ========== G31-F: Goal reached excluded ==========
function gateG31F_GoalReachedExcluded() {
  const tickets = [
    makeTicket({
      progressClass: "SEGMENT_ADVANCE",
      status: "PROBE_COMPLETE_OR_GOAL",
      stopReason: "exhausted",
      continuationEligible: false,
      lastProgress: { goalReached: true },
    }),
  ];
  const res = assessCounterfactualAdmission(admissionInput({ normalDepthTickets: tickets }));
  // A goal-reaching ticket is ACTIONABLE positive (forward planner flow owns
  // it) — it must never be classified terminal-positive-no-goal.
  assert.strictEqual(res.terminalPositiveTicketCount, 0, "G31-F: goal-reached ticket is NOT terminal");
  assert.strictEqual(res.actionablePositiveTicketCount, 1, "G31-F: goal-reached ticket is actionable");
  assert.strictEqual(res.trigger, false, "G31-F: CF blocked");
  return {
    goalReachedExcludedVerified: true,
    terminalPositiveTicketCount: res.terminalPositiveTicketCount,
    actionablePositiveTicketCount: res.actionablePositiveTicketCount,
  };
}

// ========== B11: Admission replay of the 9.2s Formal Run trajectory ==========
function gateB11_FormalRunAdmissionReplay() {
  // Source artifact: the PR-5.24h Real Run 1 (9.2s early natural return) —
  // its depth-1 ticket trajectory is the exact real-world case the old
  // admission mis-classified: 2 positive SEGMENT_ADVANCE tickets, both
  // determinately exhausted, no continuation, no pending, 20.8s wall unused.
  const artifactPath = path.join(os.tmpdir(), "5-24h-run1-2026-09-07T07-25-09-250Z.json");
  assert.ok(fs.existsSync(artifactPath), `B11: source artifact must exist at ${artifactPath}`);
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  const hypotheses = (((artifact.result || {}).repairScheduling || {}).hypotheses) || [];
  assert.strictEqual(hypotheses.length, 2, "B11: replay source has 2 depth-1 tickets");

  // Replay the REAL tickets through the new admission helper (field-for-field;
  // only the non-serializable fields are defaulted to their frozen values).
  const replayTickets = hypotheses.map((h) => ({
    hypothesisId: h.hypothesisId,
    depth: h.depth,
    counterfactualIntentId: null,
    probeCount: h.probeCount,
    anchorOutputStateKey: h.anchorOutputStateKey != null ? "real" : null,
    status: h.status,
    stopReason: h.stopReason,
    progressClass: h.progressClass,
    continuationEligible: h.continuationEligible,
    lastProgress: h.lastProgress || { goalReached: false },
  }));
  const oldReason = (artifact.result.counterfactualRepair || {}).triggerReason;
  assert.strictEqual(oldReason, "normal-primary-progress", "B11: source artifact recorded the old block reason");

  const res = assessCounterfactualAdmission(admissionInput({
    normalDepthTickets: replayTickets,
    deferredNormalDescriptors: [],
    globalStopReason: null, // source run stoppedReason was null (natural return, wall available)
  }));
  assert.strictEqual(res.positiveTicketCount, 2, "B11: replay sees 2 positive tickets");
  assert.strictEqual(res.actionablePositiveTicketCount, 0, "B11: replay sees 0 actionable");
  assert.strictEqual(res.terminalPositiveTicketCount, 2, "B11: replay sees 2 terminal");
  assert.strictEqual(res.trigger, true, "B11: NEW admission makes the 9.2s trajectory CF-eligible");
  assert.strictEqual(res.reason, "terminal-positive-no-goal", "B11: new reason");
  return {
    formalRunAdmissionReplayVerified: true,
    sourceOldReason: oldReason,
    newReason: res.reason,
    newTriggerEligible: res.trigger,
    ticketsReplayed: replayTickets.length,
  };
}

// ========== Main ==========
function main() {
  const g31a = gateG31A_NoProgressParity();
  const g31b = gateG31B_TerminalPositiveNoGoal();
  const g31c = gateG31C_ActionablePositiveBlocks();
  const g31d = gateG31D_DeferredNormalAuthority();
  const g31e = gateG31E_GlobalStopBlocks();
  const g31f = gateG31F_GoalReachedExcluded();
  const b11 = gateB11_FormalRunAdmissionReplay();

  const report = {
    schema: "motapathfinder.terminal-positive-cf-admission.v1",
    contractStatus: "passed",
    iteration: "PR-5.24i (Terminal Positive Progress Counterfactual Work-Conservation)",
    semantics: {
      oldRule: "positiveInitial > 0 ⇒ CF blocked (normal-primary-progress)",
      newRule: "only ACTIONABLE positive (continuationEligible | PROBE_PENDING | probe-limited | goalReached) blocks CF; TERMINAL positive no-goal does not",
      triggerReasons: ["primary-normal-exhausted-no-progress", "terminal-positive-no-goal"],
      preservedVetoes: ["config-off", "goal-reached", "global-stop", "first-round-incomplete", "no-real-history", "untrusted-failure", "not-determinate", "deferred-are-fallback-not-blocker (G24-K1/K3)"],
    },
    gates: {
      "G31-A": g31a,
      "G31-B": g31b,
      "G31-C": g31c,
      "G31-D": g31d,
      "G31-E": g31e,
      "G31-F": g31f,
      "B11": b11,
    },
  };
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  }
}

module.exports = {
  gateG31A_NoProgressParity,
  gateG31B_TerminalPositiveNoGoal,
  gateG31C_ActionablePositiveBlocks,
  gateG31D_DeferredNormalAuthority,
  gateG31E_GlobalStopBlocks,
  gateG31F_GoalReachedExcluded,
  gateB11_FormalRunAdmissionReplay,
  makeTicket,
  admissionInput,
};
