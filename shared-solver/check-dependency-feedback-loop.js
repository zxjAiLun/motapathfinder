"use strict";

/**
 * TEST GRADE: real-fixture-plus-contract-plus-strict-replay
 *
 * PR-5.27a Phase 1 - dependency feedback loop contract.
 *
 * What this locks is the LOOP contract, not search quality:
 *   1. one bounded local execution per round, with a global budget
 *   2. an experimentKey is burned when SELECTED, whether or not it produced a
 *      checkpoint - so a dead alternative is never retried
 *   3. the round-0 (initial) selection is burned too, otherwise a later round can
 *      legitimately re-select the identical triple
 *   4. every accepted checkpoint is strict-replay valid
 *   5. a loop that stops without the terminal goal always reports a reason
 *   6. the loop is route-free: no route fixture, prefix, authored milestone,
 *      authored event order, authored resource threshold or floor decomposition
 *      is accepted as input
 *
 * The worlds are the real tower project with only the local work budget varied,
 * so nothing here is authored to make a point. The "first alternative cannot
 * continue" case is produced by shrinking the local budget (a prerequisite whose
 * search cannot finish inside 1 expansion), not by injecting a fake failure.
 */

const assert = require("node:assert");
const path = require("node:path");

const { runDependencyFeedbackLoop } = require("./lib/dependency-feedback-controller");
const { makeBlindSimulator } = require("./lib/blind-discovery-baseline");
const { loadProject } = require("./lib/project-loader");

const ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");

const TERMINAL_GOAL = { type: "floorReached", floorId: "MT3" };

function compactRounds(result) {
  return result.rounds.map((round) => ({
    round: round.round,
    kind: round.kind,
    alternativeId: round.selected ? round.selected.alternativeId : null,
    prerequisiteId: round.selected ? round.selected.prerequisiteId : null,
    experimentKey: round.selected ? round.selected.experimentKey : null,
    experimentKeyReused: round.experimentKeyReused === true,
    expansions: round.outcome ? round.outcome.expansions : null,
    checkpointCount: round.checkpointCount,
    acceptedStrictReplay: round.acceptedStrictReplay,
    verdict: round.verdict,
  }));
}

function main() {
  const project = loadProject(PROJECT_ROOT);
  const simulator = makeBlindSimulator(project);
  const initialState = simulator.createInitialState({ rank: "chaos" });
  assert.strictEqual(initialState.floorId, "MT1");
  // The initial state carries whatever the simulator itself recorded while
  // loading a fresh run. The route-free property asserted here is about search
  // INPUTS (see inputContract below), not about the state's own history.
  assert.ok(Array.isArray(initialState.route));

  const constrained = runDependencyFeedbackLoop(
    project,
    PROJECT_ROOT,
    TERMINAL_GOAL,
    initialState,
    {
      towerId: "onlyup",
      maxRounds: 3,
      maxTotalLocalExpansions: 64,
      localMaxExpansions: 1,
      candidateLimit: 8,
    },
  );

  // --- 6. route-free input contract ---------------------------------------
  assert.deepStrictEqual(constrained.inputContract.inputs, [
    "tower-project", "route-free-initial-state", "one-terminal-goal", "global-budgets",
  ]);
  assert.ok(constrained.inputContract.forbidden.includes("route-fixture"));
  assert.ok(constrained.inputContract.forbidden.includes("authored-milestone"));
  assert.ok(constrained.inputContract.forbidden.includes("authored-event-order"));
  assert.ok(constrained.inputContract.forbidden.includes("authored-resource-threshold"));
  assert.ok(constrained.inputContract.forbidden.includes("authored-floor-decomposition"));
  assert.strictEqual(constrained.inputContract.knownRouteUsed, false);
  assert.strictEqual(constrained.inputContract.authoredMilestoneUsed, false);
  assert.strictEqual(constrained.inputContract.authoredEventOrderUsed, false);
  assert.strictEqual(constrained.inputContract.authoredResourceThresholdUsed, false);
  // No floor decomposition was authored anywhere in the result.
  assert.ok(!JSON.stringify(constrained.controls).includes("MT2"));
  assert.ok(!JSON.stringify(constrained.controls).includes("MT4"));

  // --- 4/5. it either reaches the terminal goal or says why it stopped -----
  assert.strictEqual(constrained.terminal.reached, false);
  assert.strictEqual(constrained.verdict, "DEPENDENCY_FEEDBACK_LOOP_UNKNOWN_UNDER_THIS_BUDGET");
  assert.ok(constrained.terminal.terminationReason, "a non-terminal stop must report a reason");
  assert.ok([
    "no-remaining-unattempted-alternative",
    "global-local-expansion-budget-exhausted",
    "global-round-budget-exhausted",
    "initial-execution-proved-no-continuation",
  ].includes(constrained.terminal.terminationReason));

  // --- 2. the dead alternative is burned, never retried -------------------
  const stepRounds = constrained.rounds.filter((round) => round.kind === "dependency-feedback-step");
  assert.ok(stepRounds.length >= 1);
  const selectedKeys = stepRounds
    .map((round) => round.selected && round.selected.experimentKey)
    .filter((key) => key != null);
  assert.strictEqual(new Set(selectedKeys).size, selectedKeys.length, "no experimentKey may repeat");
  assert.strictEqual(constrained.globalState.experimentKeyReuseCount, 0);

  // --- 3. the round-0 selection is burned as well ------------------------
  const initialRound = constrained.rounds.find((round) => round.kind === "initial-local-execution");
  assert.ok(initialRound);
  assert.ok(initialRound.selected);
  assert.strictEqual(
    constrained.globalState.attemptedExperimentKeyCount,
    stepRounds.filter((round) => round.selected).length + 1,
    "the initial selection must be burned alongside every later one",
  );

  // --- 1. one bounded local execution per round, global budget tracked ----
  assert.strictEqual(constrained.globalState.roundCount, stepRounds.length);
  const summedExpansions = constrained.rounds
    .reduce((sum, round) => sum + (round.outcome ? round.outcome.expansions : 0), 0);
  assert.strictEqual(constrained.globalState.totalLocalExpansions, summedExpansions);
  assert.ok(constrained.globalState.totalLocalExpansions > 0);

  // --- 4. strict replay on everything the loop accepted -------------------
  const acceptedRounds = stepRounds.filter((round) => round.acceptedCheckpointId != null);
  assert.ok(acceptedRounds.length >= 1, "at least one checkpoint must be accepted");
  assert.ok(acceptedRounds.every((round) => round.acceptedStrictReplay === true));
  assert.strictEqual(constrained.allAcceptedCheckpointsStrictReplay, true);

  // --- 2b. a constrained budget really is the binding constraint ----------
  // With localMaxExpansions = 1 the expected outcome is NOT a terminal reach;
  // this is the control that the loop reports honestly rather than inventing one.
  assert.strictEqual(constrained.route, null);

  // --- and the same contract holds when the loop is given more room -------
  const roomier = runDependencyFeedbackLoop(
    project,
    PROJECT_ROOT,
    TERMINAL_GOAL,
    simulator.createInitialState({ rank: "chaos" }),
    {
      towerId: "onlyup",
      maxRounds: 4,
      maxTotalLocalExpansions: 256,
      localMaxExpansions: 64,
      candidateLimit: 8,
    },
  );
  const roomierSteps = roomier.rounds.filter((round) => round.kind === "dependency-feedback-step");
  const roomierKeys = roomierSteps
    .map((round) => round.selected && round.selected.experimentKey)
    .filter((key) => key != null);
  assert.strictEqual(new Set(roomierKeys).size, roomierKeys.length);
  assert.strictEqual(roomier.globalState.experimentKeyReuseCount, 0);
  assert.strictEqual(roomier.globalState.repeatedCheckpointStateCount, 0);
  assert.ok(roomierSteps.filter((round) => round.acceptedCheckpointId != null)
    .every((round) => round.acceptedStrictReplay === true));
  // It moves across alternatives rather than grinding one, which is the whole
  // point of a feedback loop.
  const roomierAlternatives = new Set(roomierSteps
    .map((round) => round.selected && round.selected.alternativeId)
    .filter(Boolean));
  assert.ok(roomierAlternatives.size >= 2, `expected to switch alternatives, saw ${[...roomierAlternatives]}`);
  // Distinct checkpoint states, not the same state re-derived.
  assert.strictEqual(
    roomier.globalState.visitedExactCheckpointStateCount,
    new Set(roomier.globalState.visitedExactCheckpointStates).size,
  );
  assert.ok(roomier.globalState.visitedExactCheckpointStateCount >= 2);

  process.stdout.write(`${JSON.stringify({
    status: "passed",
    properties: {
      ROUTE_FREE_INPUT_CONTRACT: true,
      EXPERIMENT_KEY_BURNED_ON_SELECTION: true,
      INITIAL_SELECTION_BURNED: true,
      NO_EXPERIMENT_KEY_REUSE: true,
      ACCEPTED_CHECKPOINTS_STRICT_REPLAY: true,
      NON_TERMINAL_STOP_ALWAYS_REPORTS_REASON: true,
      ALTERNATIVE_SWITCHING_OBSERVED: true,
    },
    constrained: {
      rounds: compactRounds(constrained),
      globalState: { ...constrained.globalState, attemptedExperimentKeys: undefined, visitedExactCheckpointStates: undefined },
      terminal: { reached: constrained.terminal.reached, terminationReason: constrained.terminal.terminationReason },
      verdict: constrained.verdict,
    },
    roomier: {
      rounds: compactRounds(roomier),
      globalState: { ...roomier.globalState, attemptedExperimentKeys: undefined, visitedExactCheckpointStates: undefined },
      terminal: { reached: roomier.terminal.reached, terminationReason: roomier.terminal.terminationReason },
      verdict: roomier.verdict,
    },
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main };
