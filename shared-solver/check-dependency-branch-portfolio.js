"use strict";

/**
 * TEST GRADE: synthetic-contract-plus-forced-backtrack-plus-route-stitching
 *
 * PR-5.27b - persistent branch portfolio contract.
 *
 * The world is SYNTHETIC ON PURPOSE. The property under test is "the planner
 * really goes wrong, remembers why, returns to an older still-valid state,
 * takes a different path, and stitches a complete replayable route". Waiting for
 * the real tower to happen to produce that shape is not a contract test, so the
 * dependency contexts and local executions are scripted to guarantee it:
 *
 *   root
 *    |- A   (chosen first)
 *    |   \- A1  -> dead end, local execution proves no continuation
 *    \- B   (must be reached only by returning to root after A1 dies)
 *        \- B1  -> terminal
 *
 * Every accepted checkpoint is strict-replay valid, and the returned route must
 * be the CONCATENATION of the local segments from the original initial state,
 * not merely the last segment.
 */

const assert = require("node:assert");
const path = require("node:path");

const { runDependencyFeedbackLoop } = require("./lib/dependency-feedback-controller");

const TERMINAL_GOAL = { type: "floorReached", floorId: "MT_FINAL" };
const PROJECT_ROOT = path.resolve(__dirname, "..");

function syntheticState(node) {
  // Minimal shape that `buildStateKey` accepts, so the loop fingerprints real
  // state objects rather than opaques. `__node` carries the script identity.
  // The hero stats vary per node so that distinct nodes produce distinct state
  // keys - otherwise a generic-state fingerprint would collapse them and the
  // dedup under test would be measuring the fixture rather than the loop.
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
// Each "state" is a tiny descriptor. Local executions are scripted per node.
const NODES = {
  ROOT: { id: "ROOT", ordinal: 0, floorId: "MT1", decision: "enter@MT1:0,0" },

  // Branch A is chosen first (best leading survival margin). Its child A1 is a
  // proven dead end: the local execution returns zero checkpoints with
  // searchComplete = true.
  A: { id: "A", ordinal: 1, floorId: "MT1", decision: "battle:A@MT1:1,1" },
  A1: { id: "A1", ordinal: 2, floorId: "MT1", decision: "battle:A1@MT1:1,2" },

  // Branch B is only viable after A1 dies and A is exhausted.
  B: { id: "B", ordinal: 3, floorId: "MT2", decision: "changeFloor@MT1:6,0" },
  B1: { id: "B1", ordinal: 4, floorId: "MT_FINAL", decision: "battle:B1@MT2:3,3" },
};

// Plan script: for a given state, which alternatives/prerequisites are offered,
// and in what order (the loop's ranking then picks from these).
const PLAN = {
  ROOT: [
    // alternative "A" first: larger survival margin, so it wins the ranking.
    { alt: "A", prereq: "A", status: "viable-at-current-state", margin: 500, expands: 3, yields: ["A"] },
    { alt: "B", prereq: "B", status: "viable-at-current-state", margin: 100, expands: 3, yields: ["B"] },
  ],
  A: [
    { alt: "A", prereq: "A1", status: "viable-at-current-state", margin: 500, expands: 2, yields: ["A1"] },
  ],
  A1: [
    // Dead end: the local execution will prove exhaustion.
    { alt: "A", prereq: "A1-dead-end", status: "viable-at-current-state", margin: 500, expands: 1, yields: [] },
  ],
  B: [
    { alt: "B", prereq: "B1", status: "viable-at-current-state", margin: 100, expands: 2, yields: ["B1"] },
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

function scriptFor(plan, alternativeId, prerequisiteId) {
  const entry = (plan.alternatives || []).find((alternative) => alternative.id === alternativeId);
  if (!entry || !entry.__script) return null;
  const script = entry.__script;
  if (script.prereq !== prerequisiteId) return null;
  return script;
}

function executeLocal(project, projectRoot, state, plan, options) {
  const node = state.__node;
  const entries = PLAN[node.id] || [];
  // The real executor is handed a plan whose alternatives were already reordered
  // by the controller so that the SELECTED alternative is first, and it then takes
  // the first viable leading prerequisite. Mirroring that ordering is essential:
  // otherwise this stub would always run the same alternative no matter what the
  // loop chose, and the backtracking under test would never happen.
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

function main() {
  const rootState = syntheticState(NODES.ROOT);
  const result = runDependencyFeedbackLoop(
    { floors: {} },
    PROJECT_ROOT,
    TERMINAL_GOAL,
    rootState,
    {
      maxRounds: 8,
      maxTotalLocalExpansions: 100,
      localMaxExpansions: 10,
      candidateLimit: 4,
      buildDependencyContext: buildContext,
      executeLocalDependency: executeLocal,
    },
  );
  const stepRounds = result.rounds.filter((round) => round.kind === "dependency-feedback-step");
  const branchById = new Map(result.branches.map((branch) => [branch.branchId, branch]));

  // --- terminal reached at all ---------------------------------------------
  assert.strictEqual(result.terminal.reached, true, `expected terminal, got ${result.terminal.terminationReason}`);
  assert.strictEqual(result.terminal.terminationClass, "TERMINAL_GOAL_REACHED");
  assert.strictEqual(result.verdict, "DEPENDENCY_FEEDBACK_LOOP_REACHED_TERMINAL_WITH_STRICT_REPLAY");

  // --- the dead end was really entered and really died ---------------------
  const visitedNodes = localExecutionLog.map((entry) => entry.node);
  assert.ok(visitedNodes.includes("A1"), `A1 must be attempted, saw ${visitedNodes}`);
  const deadEndAttempt = result.attempts.find((attempt) => attempt.expansions === 1);
  assert.ok(deadEndAttempt, "the dead-end experiment must be recorded");
  assert.strictEqual(deadEndAttempt.outcome, "exhausted");
  const exhausted = result.branches.filter((branch) => branch.status === "exhausted");
  assert.ok(exhausted.length >= 1, "the dead end must exhaust its branch");
  assert.strictEqual(
    result.globalState.exhaustedBranchCount,
    exhausted.length,
  );

  // --- BACKTRACK_TO_OLDER_BRANCH_OBSERVED ----------------------------------
  const backtracks = stepRounds.filter((round) => round.backtrackedToOlderBranch === true);
  assert.ok(backtracks.length >= 1, "a backtrack to an older branch must be observed");
  assert.strictEqual(result.globalState.backtrackCount, backtracks.length);

  // --- SELECTED_BRANCH_PARENT_IS_NOT_PREVIOUS_ROUND ------------------------
  // The purest form of the property: the round that advances after the dead end
  // must NOT be the branch the previous round advanced into.
  const deadEndRound = stepRounds.find((round) => round.verdict === "LOCAL_EXECUTION_PRODUCED_NO_CHECKPOINT");
  assert.ok(deadEndRound, "the dead-end round must be visible");
  const afterDeadEnd = stepRounds.filter((round) => round.round > deadEndRound.round)[0];
  assert.ok(afterDeadEnd, "the loop must continue after the dead end rather than stopping");
  assert.strictEqual(
    afterDeadEnd.selectedBranchParentIsPreviousRound,
    false,
    "after a dead end the loop must select from an older branch, not the last one",
  );
  const previousAccepted = deadEndRound.acceptedBranchId;
  assert.notStrictEqual(afterDeadEnd.selected.branchId, previousAccepted);

  // --- SIBLING_BRANCH_SELECTED --------------------------------------------
  // After the dead end the loop must advance toward a different alternative from
  // a branch that is NOT part of the failed continuation. Returning to the
  // dead-end branch itself, or to a descendant of it, would be a retry rather
  // than a backtrack; returning to an ancestor (here: root) and choosing a
  // different alternative is the correct behaviour.
  const chosen = branchById.get(afterDeadEnd.selected.branchId);
  assert.ok(chosen, "the chosen branch must exist");
  assert.notStrictEqual(
    chosen.branchId,
    deadEndRound.selected.branchId,
    "must not simply retry the dead-end branch",
  );
  // Walk up from the chosen branch and confirm it is not a descendant of the
  // failed branch (i.e. the loop did not continue deeper down the dead path).
  let cursor = chosen.branchId;
  const ancestry = [];
  while (cursor) {
    ancestry.push(cursor);
    cursor = (branchById.get(cursor) || {}).parentBranchId;
  }
  assert.strictEqual(
    ancestry.includes(deadEndRound.selected.branchId),
    false,
    `chosen branch ${chosen.branchId} must not descend from the failed branch ${deadEndRound.selected.branchId}`,
  );
  // ...and the alternative it chose must differ from the one the failed path used.
  const failedAlternative = deadEndRound.selected.alternativeId;
  assert.notStrictEqual(
    afterDeadEnd.selected.alternativeId,
    failedAlternative,
    "a backtrack must choose a different alternative than the failed path",
  );

  // --- FAILED_BRANCH_NOT_RETRIED ------------------------------------------
  const failedBranchId = deadEndRound.selected.branchId;
  const retried = stepRounds.filter((round) => round.round > deadEndRound.round
    && round.selected && round.selected.branchId === failedBranchId
    && round.verdict !== "LOCAL_EXECUTION_PRODUCED_NO_CHECKPOINT");
  assert.strictEqual(retried.length, 0, "a proven-dead branch must not be advanced into again");
  assert.strictEqual(branchById.get(failedBranchId).status, "exhausted");

  // --- no experiment key reuse -------------------------------------------
  assert.strictEqual(result.globalState.experimentKeyReuseCount, 0);
  const keys = result.attempts.map((attempt) => attempt.experimentKey);
  assert.strictEqual(new Set(keys).size, keys.length, "experiment keys must be unique");

  // --- route stitching ----------------------------------------------------
  // The returned route is the WINNING path: every local segment from the original
  // initial state to the terminal branch, and NOT the union of abandoned attempts.
  // The A branch was explored and abandoned, so its decision must not appear.
  assert.ok(Array.isArray(result.route), "a terminal result must return a route");
  assert.deepStrictEqual(
    result.route.map((decision) => decision.summary),
    [
      NODES.B.decision,       // root -> B   (the sibling chosen after the dead end)
      NODES.B1.decision,      // B -> B1     (terminal)
    ],
    "the route must concatenate the accepted local segments of the winning path",
  );
  assert.strictEqual(
    result.route.map((decision) => decision.summary).includes(NODES.A.decision),
    false,
    "an abandoned branch's decision must not leak into the returned route",
  );
  assert.strictEqual(result.routeProvenance.startsAtOriginalInitialState, true);
  // Three local executions contributed checkpoints along this path (root->A shot,
  // then root->B, then B->B1); two of them lie on the winning path.
  assert.strictEqual(result.routeProvenance.localSegmentCount, 3);
  assert.strictEqual(result.routeProvenance.cumulativeDecisionCount, 2);

  // The returned route must contain more than the final segment alone, which is
  // the exact regression this property exists to prevent.
  const finalSegment = [NODES.B1.decision];
  assert.notDeepStrictEqual(result.route.map((d) => d.summary), finalSegment);

  // --- every accepted checkpoint replays ----------------------------------
  for (const round of stepRounds) {
    if (round.acceptedBranchId == null) continue;
    assert.strictEqual(round.acceptedStrictReplay, true, `round ${round.round} accepted checkpoint must replay`);
  }
  assert.strictEqual(result.allAcceptedCheckpointsStrictReplay, true);

  // --- Phase 2: hard global budget ceiling ---------------------------------
  // Previously the loop only pre-checked `total >= max` and then issued the local
  // call with the FULL local budget, so a late round could overshoot the global
  // ceiling. The bound itself must hold, not just the accounting identity.
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
    },
  );
  assert.ok(
    bounded.globalState.totalLocalExpansions <= 5,
    `global budget must be a hard ceiling, got ${bounded.globalState.totalLocalExpansions}`,
  );
  assert.strictEqual(bounded.globalState.totalLocalExpansionsWithinBudget, true);
  // The first round may take 4; the second may take at most the remaining 1.
  const boundedSteps = bounded.rounds.filter((round) => round.outcome != null);
  assert.ok(boundedSteps.length >= 2, "the bounded run must still make progress past round 0");
  // The first round gets the full local budget; every later round can only get
  // what is left of the global one. Assert the INVARIANT rather than a magic
  // number: after the first round, each round's grant is exactly the remaining
  // global budget (or the local cap, whichever is smaller).
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
  // The accounting identity is also still checked, so the bound assertion is not
  // a substitute for it.
  assert.strictEqual(
    bounded.globalState.totalLocalExpansions,
    bounded.rounds.reduce((sum, round) => sum + (round.outcome ? round.outcome.expansions : 0), 0),
  );

  process.stdout.write(`${JSON.stringify({
    status: "passed",
    properties: {
      BACKTRACK_TO_OLDER_BRANCH_OBSERVED: true,
      SELECTED_BRANCH_PARENT_IS_NOT_PREVIOUS_ROUND: true,
      FAILED_BRANCH_NOT_RETRIED: true,
      SIBLING_BRANCH_SELECTED: true,
      EXPIRED_DEAD_END_MARKED_EXHAUSTED: true,
      RETURNED_ROUTE_STARTS_AT_ORIGINAL_INITIAL_STATE: true,
      RETURNED_ROUTE_INCLUDES_EVERY_LOCAL_SEGMENT: true,
      FULL_STRICT_REPLAY: true,
      TERMINAL_GOAL_REACHED_AFTER_FULL_REPLAY: true,
      GLOBAL_EXPANSION_BUDGET_IS_A_HARD_CEILING: true,
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
