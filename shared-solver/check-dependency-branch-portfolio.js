"use strict";

/**
 * TEST GRADE: synthetic-contract-plus-forced-backtrack-plus-route-stitching
 *
 * PR-5.27c - branch lifecycle, commitment, and full route strict replay contract.
 *
 * The world is SYNTHETIC ON PURPOSE. The property under test is "the planner
 * commits to a newly successful child lineage while it can advance, defers older
 * higher-scoring branches, falls back to the historical portfolio when the child
 * cohort blocks, marks unadvanceable branches exhausted under the monotonic
 * contract, and stitches a complete end-to-end replayable route verified from
 * the original initial state":
 *
 *   root
 *    ├─ A (margin 700) -> A1 (margin 500) -> A2 (margin 500) -> dead end
 *    └─ B (margin 600) -> B1 (terminal)
 *
 * Without commitment (commitSuccessfulLineage=false):
 *   After root -> A, the global portfolio has root (offering B with margin 600)
 *   and A (offering A1 with margin 500). Without commitment, the planner immediately
 *   jumps to root -> B because margin 600 > 500!
 * With commitment (commitSuccessfulLineage=true):
 *   The planner commits to child A -> A1 -> A2, encounters the dead end, marks
 *   it exhausted, backtracks to root, executes B, and reaches B1 (terminal).
 *
 * Every accepted checkpoint is strict-replay valid, and the returned route is
 * verified end-to-end via verifyStrictReplay from the original initial state.
 */

const assert = require("node:assert");
const path = require("node:path");

const { runDependencyFeedbackLoop } = require("./lib/dependency-feedback-controller");
const { verifyStrictReplay } = require("./lib/strict-replay");

const TERMINAL_GOAL = { type: "floorReached", floorId: "MT_FINAL" };
const PROJECT_ROOT = path.resolve(__dirname, "..");

function syntheticState(node) {
  const ordinal = Number(node.ordinal);
  return {
    __node: node,
    floorId: node.floorId,
    hero: {
      hp: 100 + ordinal, hpmax: 100 + ordinal, atk: 10 + ordinal, def: 0, mdef: 0,
      lv: 1, exp: ordinal, money: 0,
      loc: { x: ordinal, y: ordinal, direction: "down" },
      equipment: [], followers: [],
    },
    inventory: {},
    flags: {},
    floorStates: {},
    triggeredAutoEvents: {},
    visitedFloors: { [node.floorId]: true },
    route: [],
    notes: [],
    meta: { decisionDepth: ordinal, rawRouteLength: ordinal },
  };
}

// --- synthetic world ---------------------------------------------------------
const NODES = {
  ROOT: { id: "ROOT", ordinal: 0, floorId: "MT1", decision: "enter@MT1:0,0" },
  A: { id: "A", ordinal: 1, floorId: "MT1", decision: "battle:A@MT1:1,1" },
  A1: { id: "A1", ordinal: 2, floorId: "MT1", decision: "battle:A1@MT1:1,2" },
  A2: { id: "A2", ordinal: 3, floorId: "MT1", decision: "battle:A2@MT1:1,3" },
  B: { id: "B", ordinal: 4, floorId: "MT2", decision: "changeFloor@MT1:6,0" },
  B1: { id: "B1", ordinal: 5, floorId: "MT_FINAL", decision: "battle:B1@MT2:3,3" },
};

const PLAN = {
  ROOT: [
    { alt: "A", prereq: "A", status: "viable-at-current-state", margin: 700, expands: 3, yields: ["A"] },
    { alt: "B", prereq: "B", status: "viable-at-current-state", margin: 600, expands: 3, yields: ["B"] },
  ],
  A: [
    { alt: "A", prereq: "A1", status: "viable-at-current-state", margin: 500, expands: 2, yields: ["A1"] },
  ],
  A1: [
    { alt: "A", prereq: "A2", status: "viable-at-current-state", margin: 500, expands: 2, yields: ["A2"] },
  ],
  A2: [
    { alt: "A", prereq: "A2-dead-end", status: "viable-at-current-state", margin: 500, expands: 1, yields: [] },
  ],
  B: [
    { alt: "B", prereq: "B1", status: "viable-at-current-state", margin: 600, expands: 2, yields: ["B1"] },
  ],
  B1: [],
};

const localExecutionLog = [];

function buildContext(project, state, terminalGoal, options) {
  const node = state.__node;
  const entries = PLAN[node.id] || [];
  const excluded = (options || {}).excludedExperimentKeys || new Set();
  return {
    graph: { floorCorridor: {} },
    feasibility: {},
    plan: {
      objective: { selectedFeasibilitySubgoal: null },
      alternatives: entries.map((entry) => {
        const prerequisiteId = entry.prereq;
        return {
          id: `alternative-${entry.alt}`,
          prerequisites: prerequisiteId
            ? [{
              id: prerequisiteId,
              sourceNodeId: prerequisiteId,
              relation: "AND",
              order: 0,
              actionGoal: { marker: prerequisiteId },
              target: { floorId: node.floorId },
              evidence: {
                kind: "synthetic",
                status: entry.status,
                damage: 100,
                currentHp: 100 + entry.margin,
              },
            }]
            : [],
          __script: entry,
          __excluded: excluded,
        };
      }),
    },
  };
}

function executeLocal(project, projectRoot, state, plan, options) {
  const node = state.__node;
  const entries = PLAN[node.id] || [];
  const ordered = (plan.alternatives || [])
    .map((alternative) => alternative.__script)
    .filter(Boolean);
  const first = ordered.find((entry) => entry.status === "viable-at-current-state")
    || entries.find((entry) => entry.status === "viable-at-current-state")
    || null;
  const expansions = first ? first.expands : 0;
  localExecutionLog.push({ node: node.id, alternative: first ? first.alt : null, expansions, yields: first ? first.yields : [] });

  if (!first || first.yields.length === 0) {
    return {
      selected: first ? { alternativeId: `alternative-${first.alt}`, prerequisite: { sourceNodeId: first.prereq } } : null,
      outcome: {
        goalFound: false,
        expansions,
        budgetExhausted: false,
        frontierExhausted: true,
        searchComplete: true,
        reason: "synthetic-proven-dead-end",
      },
      checkpoints: [],
      checkpointDiversity: { allStrictReplay: true, roles: [] },
      verdict: "LOCAL_DEPENDENCY_EXECUTION_OPEN",
    };
  }

  const checkpoints = first.yields.map((yieldId, index) => {
    const child = NODES[yieldId];
    return {
      id: `checkpoint-${index + 1}`,
      roles: ["synthetic"],
      exactStateFingerprint: `fp-${yieldId}`,
      floorId: child.floorId,
      state: syntheticState(child),
      decisionCount: 1,
      replay: { valid: true, stepsAttempted: 1, stepsCompleted: 1, failureReason: null },
      routeRecord: { decisions: [{ summary: child.decision }] },
    };
  });
  return {
    selected: { alternativeId: `alternative-${first.alt}`, prerequisite: { sourceNodeId: first.prereq } },
    outcome: {
      goalFound: false,
      expansions,
      budgetExhausted: false,
      frontierExhausted: false,
      searchComplete: false,
      reason: null,
    },
    checkpoints,
    checkpointDiversity: { allStrictReplay: true, roles: ["synthetic"] },
    verdict: "LOCAL_DEPENDENCY_SINGLE_ROLE_CHECKPOINT_VERIFIED",
  };
}

function makeSyntheticSimulator() {
  return {
    enumeratePrimitiveActions: (state) => {
      const id = (state.__node || {}).id;
      if (id === "ROOT") {
        return { actions: [{ summary: "changeFloor@MT1:6,0", targetNode: NODES.B }, { summary: "battle:A@MT1:1,1", targetNode: NODES.A }] };
      }
      if (id === "B") {
        return { actions: [{ summary: "battle:B1@MT2:3,3", targetNode: NODES.B1 }] };
      }
      return { actions: [] };
    },
    applyAction: (state, action) => {
      return syntheticState(action.targetNode);
    },
  };
}

function main() {
  const rootState = syntheticState(NODES.ROOT);

  // --- Negative control / comparison: commitment OFF -----------------------
  // Without commitment, after ROOT->A the loop evaluates the global portfolio.
  // ROOT still has alternative B with margin 600, while child A offers A1 with margin 500.
  // Therefore the uncommitted loop immediately abandons A and jumps to ROOT->B!
  localExecutionLog.length = 0;
  const resultOff = runDependencyFeedbackLoop(
    { floors: {} },
    PROJECT_ROOT,
    TERMINAL_GOAL,
    rootState,
    {
      maxRounds: 10,
      maxTotalLocalExpansions: 100,
      localMaxExpansions: 10,
      candidateLimit: 4,
      buildDependencyContext: buildContext,
      executeLocalDependency: executeLocal,
      simulatorFactory: makeSyntheticSimulator,
    },
  );
  assert.strictEqual(resultOff.controls.commitSuccessfulLineage, false, "commitment must default OFF");
  const offExecutionSequence = localExecutionLog.map((x) => `${x.node}->${x.alternative}`);
  assert.deepStrictEqual(
    offExecutionSequence,
    ["ROOT->A", "ROOT->B", "B->B"],
    "without commitment, the planner immediately jumps to ROOT->B because margin 600 > 500",
  );

  // --- Main run: commitment ON --------------------------------------------
  localExecutionLog.length = 0;
  const result = runDependencyFeedbackLoop(
    { floors: {} },
    PROJECT_ROOT,
    TERMINAL_GOAL,
    rootState,
    {
      maxRounds: 10,
      maxTotalLocalExpansions: 100,
      localMaxExpansions: 10,
      candidateLimit: 4,
      buildDependencyContext: buildContext,
      executeLocalDependency: executeLocal,
      commitSuccessfulLineage: true,
      simulatorFactory: makeSyntheticSimulator,
    },
  );

  const stepRounds = result.rounds.filter((round) => round.kind === "dependency-feedback-step");
  const branchById = new Map(result.branches.map((branch) => [branch.branchId, branch]));

  // --- terminal reached and strict-replay verified -------------------------
  assert.strictEqual(result.terminal.reached, true, `expected terminal, got ${result.terminal.terminationReason}`);
  assert.strictEqual(result.terminal.terminationClass, "TERMINAL_GOAL_REACHED");
  assert.strictEqual(result.verdict, "DEPENDENCY_FEEDBACK_LOOP_REACHED_TERMINAL_WITH_STRICT_REPLAY");

  // --- commitment behavior verified: child lineage is continued ------------
  const onExecutionSequence = localExecutionLog.map((x) => `${x.node}->${x.alternative}`);
  assert.deepStrictEqual(
    onExecutionSequence,
    ["ROOT->A", "A->A", "A1->A", "A2->A", "ROOT->B", "B->B"],
    "with commitment, the planner continues A -> A1 -> A2 until dead end, then backtracks to ROOT->B",
  );

  // --- the dead end was reached, executed, and marked exhausted -----------
  const deadEndAttempt = result.attempts.find((attempt) => attempt.expansions === 1 && attempt.outcome === "exhausted");
  assert.ok(deadEndAttempt, "the dead-end experiment must be recorded as exhausted");
  const exhaustedBranches = result.branches.filter((branch) => branch.status === "exhausted");
  assert.ok(exhaustedBranches.length >= 1, "exhausted branch count must be >= 1");
  assert.strictEqual(result.globalState.exhaustedBranchCount, exhaustedBranches.length);

  // --- BACKTRACK_TO_OLDER_BRANCH_OBSERVED ----------------------------------
  const backtracks = stepRounds.filter((round) => round.backtrackedToOlderBranch === true);
  assert.ok(backtracks.length >= 1, "a backtrack to an older branch must be observed");
  assert.strictEqual(result.globalState.backtrackCount, backtracks.length);

  // --- SIBLING_BRANCH_SELECTED after cohort blocks ------------------------
  const deadEndRound = stepRounds.find((round) => round.verdict === "LOCAL_EXECUTION_PRODUCED_NO_CHECKPOINT");
  assert.ok(deadEndRound, "the dead-end round must be visible");
  const afterDeadEnd = stepRounds.filter((round) => round.round > deadEndRound.round)[0];
  assert.ok(afterDeadEnd, "the loop must continue after the dead end rather than stopping");
  assert.strictEqual(afterDeadEnd.selectedBranchParentIsPreviousRound, false);

  // --- no experiment key reuse -------------------------------------------
  assert.strictEqual(result.globalState.experimentKeyReuseCount, 0);
  const keys = result.attempts.map((attempt) => attempt.experimentKey);
  assert.strictEqual(new Set(keys).size, keys.length, "experiment keys must be unique");

  // --- route stitching & full route strict replay verification ------------
  assert.ok(Array.isArray(result.route), "a terminal result must return a route");
  assert.deepStrictEqual(
    result.route.map((decision) => decision.summary),
    [
      NODES.B.decision,
      NODES.B1.decision,
    ],
    "the route must concatenate the accepted local segments of the winning path",
  );
  assert.strictEqual(result.routeProvenance.startsAtOriginalInitialState, true);

  // PR-5.27c P1 assert: end-to-end full route strict replay
  assert.ok(result.fullRouteStrictReplay, "fullRouteStrictReplay result must be present");
  assert.strictEqual(result.fullRouteStrictReplay.ok, true, "full route strict replay must succeed");
  assert.strictEqual(result.routeProvenance.fullRouteStrictReplayValid, true);

  // --- telemetry: advanceable branches & unique exact states --------------
  assert.ok(typeof result.globalState.uniqueExactStateCount === "number");
  assert.ok(result.globalState.uniqueExactStateCount > 0);
  assert.ok(typeof result.globalState.advanceableBranchCount === "number");
  assert.ok(
    result.globalState.advanceableBranchCount <= result.globalState.openBranchCount,
    "exact final sweep may not report more advanceable branches than open branches",
  );

  const replayUnverified = runDependencyFeedbackLoop(
    { floors: {} },
    PROJECT_ROOT,
    TERMINAL_GOAL,
    syntheticState(NODES.ROOT),
    {
      maxRounds: 10,
      maxTotalLocalExpansions: 100,
      localMaxExpansions: 10,
      candidateLimit: 4,
      buildDependencyContext: buildContext,
      executeLocalDependency: executeLocal,
      commitSuccessfulLineage: true,
    },
  );
  assert.strictEqual(replayUnverified.terminal.reached, true);
  assert.strictEqual(replayUnverified.fullRouteStrictReplay, null);
  assert.strictEqual(
    replayUnverified.verdict,
    "DEPENDENCY_FEEDBACK_LOOP_REACHED_TERMINAL_REPLAY_UNVERIFIED",
    "a non-empty terminal route without full-route replay evidence must fail closed",
  );

  // --- Phase 2: hard global budget ceiling ---------------------------------
  localExecutionLog.length = 0;
  const bounded = runDependencyFeedbackLoop(
    { floors: {} },
    PROJECT_ROOT,
    TERMINAL_GOAL,
    syntheticState(NODES.ROOT),
    {
      maxRounds: 8,
      maxTotalLocalExpansions: 5,
      localMaxExpansions: 4,
      candidateLimit: 4,
      buildDependencyContext: buildContext,
      executeLocalDependency: executeLocal,
      commitSuccessfulLineage: true,
      simulatorFactory: makeSyntheticSimulator,
    },
  );
  assert.ok(
    bounded.globalState.totalLocalExpansions <= 5,
    `global budget must be a hard ceiling, got ${bounded.globalState.totalLocalExpansions}`,
  );
  assert.strictEqual(bounded.globalState.totalLocalExpansionsWithinBudget, true);

  const boundedSteps = bounded.rounds.filter((round) => round.outcome != null);
  assert.ok(boundedSteps.length >= 2, "the bounded run must still make progress past round 0");
  const firstRoundGrant = boundedSteps[0].outcome.expansions;
  let spent = 0;
  for (const round of boundedSteps) {
    const grant = round.outcome.expansions;
    const expectedCeiling = Math.min(4, 5 - spent);
    assert.ok(
      grant <= expectedCeiling,
      `round spent ${grant} but only ${expectedCeiling} was available (spent so far ${spent})`,
    );
    spent += grant;
  }
  assert.ok(firstRoundGrant <= 4, "the first round may not exceed the local cap");
  assert.strictEqual(
    bounded.globalState.totalLocalExpansions,
    bounded.rounds.reduce((sum, round) => sum + (round.outcome ? round.outcome.expansions : 0), 0),
  );

  process.stdout.write(`${JSON.stringify({
    status: "passed",
    properties: {
      SUCCESSFUL_CHILD_LINEAGE_IS_CONTINUED: true,
      OLDER_BETTER_SCORING_BRANCH_IS_DEFERRED_WHILE_CHILD_CAN_ADVANCE: true,
      BLOCKED_CHILD_COHORT_TRIGGERS_BACKTRACK: true,
      HISTORICAL_BRANCH_NOT_PRUNED: true,
      BACKTRACK_TO_OLDER_BRANCH_OBSERVED: true,
      SELECTED_BRANCH_PARENT_IS_NOT_PREVIOUS_ROUND: true,
      FAILED_BRANCH_NOT_RETRIED: true,
      SIBLING_BRANCH_SELECTED: true,
      EXPIRED_DEAD_END_MARKED_EXHAUSTED: true,
      RETURNED_ROUTE_STARTS_AT_ORIGINAL_INITIAL_STATE: true,
      RETURNED_ROUTE_INCLUDES_EVERY_LOCAL_SEGMENT: true,
      FULL_STRICT_REPLAY: true,
      FULL_ROUTE_STRICT_REPLAY_VALID: true,
      TERMINAL_GOAL_REACHED_AFTER_FULL_REPLAY: true,
      GLOBAL_EXPANSION_BUDGET_IS_A_HARD_CEILING: true,
      COMMITMENT_DEFAULT_IS_OFF: true,
      FULL_ROUTE_REPLAY_GATE_FAILS_CLOSED: true,
      FINAL_BRANCH_LIFECYCLE_SWEEP_IS_EXACT: true,
    },
    lineageComparison: {
      uncommittedSequence: offExecutionSequence,
      committedSequence: onExecutionSequence,
    },
    localExecutionOrder: localExecutionLog,
    branches: result.branches.map((branch) => ({
      branchId: branch.branchId, parentBranchId: branch.parentBranchId, status: branch.status,
      cumulativeDecisionCount: branch.cumulativeDecisionCount, floorId: branch.floorId,
    })),
    rounds: stepRounds.map((round) => ({
      round: round.round,
      selectedBranchId: round.selected ? round.selected.branchId : null,
      verdict: round.verdict,
      backtrackedToOlderBranch: round.backtrackedToOlderBranch,
      selectedBranchParentIsPreviousRound: round.selectedBranchParentIsPreviousRound,
      acceptedBranchId: round.acceptedBranchId,
    })),
    route: result.route.map((decision) => decision.summary),
    attempts: result.attempts,
    budgetCeiling: {
      maxTotalLocalExpansions: 5,
      localMaxExpansions: 4,
      observedTotal: bounded.globalState.totalLocalExpansions,
      perRoundExpansions: boundedSteps.map((round) => round.outcome.expansions),
      terminationReason: bounded.terminal.terminationReason,
    },
    globalState: { ...result.globalState, attemptedExperimentKeys: undefined, visitedExactCheckpointStates: undefined },
    terminal: result.terminal,
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main, NODES, PLAN, syntheticState, buildContext, executeLocal };
