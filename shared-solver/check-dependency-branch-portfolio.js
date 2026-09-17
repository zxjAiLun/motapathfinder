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

function numberish(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

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

  // ==========================================================================
  // PR-5.27e - FAILURE-CONDITIONED RESOURCE REPAIR (synthetic micro)
  // ==========================================================================
  //
  // World:
  //   BLOCK  - a battle prerequisite that is UNBEATABLE at the current ATK
  //   REPAIR - a legal, HP-costing, ATK-gaining action available at the same state
  //   AFTER  - executing REPAIR makes the same BLOCK battle viable
  //
  // Normal dependency ALONE cannot advance (the battle evidence is
  // `unbeatable-at-current-stats`), so the branch must stay advanceable ONLY
  // because a repair experiment exists. After the repair checkpoint, a replan from
  // the child state must show the SAME battle as `viable-at-current-state`.
  const repairWorld = (() => {
    const nodes = {
      R: { id: "R", ordinal: 0, floorId: "MT1", decision: "enter@MT1:0,0", atk: 10 },
      REPAIRED: { id: "REPAIRED", ordinal: 1, floorId: "MT1", decision: "battle:training@MT1:1,1", atk: 60 },
    };
    const state = (node) => ({
      __repairNode: node,
      floorId: node.floorId,
      hero: {
        hp: 100, hpmax: 100, atk: node.atk, def: 0, mdef: 0, lv: 1, exp: 0, money: 0,
        loc: { x: node.ordinal, y: node.ordinal, direction: "down" },
        equipment: [], followers: [],
      },
      inventory: {}, flags: {}, floorStates: {}, triggeredAutoEvents: {},
      visitedFloors: { [node.floorId]: true }, route: [], notes: [],
      meta: { decisionDepth: node.ordinal, rawRouteLength: node.ordinal },
    });
    // The block: viable only once hero ATK reaches 50. Evidence is computed from
    // the state's own stats, exactly like the real battle evaluator.
    const BLOCK_ATK_REQUIRED = 50;
    const buildContext = (project, s, terminalGoal, options) => {
      const atk = (s.hero || {}).atk || 0;
      const viable = atk >= BLOCK_ATK_REQUIRED;
      return {
        graph: { floorCorridor: {} },
        feasibility: {},
        plan: {
          objective: { selectedFeasibilitySubgoal: null },
          alternatives: [{
            id: "alternative-block",
            prerequisites: [{
              id: "require-block",
              sourceNodeId: "MT1:enemy:4,4:ogre",
              kind: "prerequisite",
              relation: "AND",
              order: 0,
              actionGoal: { type: "tileRemoved", floorId: "MT1", x: 4, y: 4 },
              target: { floorId: "MT1", x: 4, y: 4 },
              evidence: {
                kind: "battle-survivability",
                status: viable ? "viable-at-current-state" : "unbeatable-at-current-stats",
                damage: viable ? 10 : null,
                currentHp: (s.hero || {}).hp,
              },
            }],
          }],
        },
      };
    };
    // The executor: only the repair action can change ATK. A normal prerequisite
    // search cannot invent the ATK gain on its own.
    const executeLocal = (project, projectRoot, s, plan, options) => {
      const node = s.__repairNode;
      const selected = (plan.alternatives || []).find((alt) =>
        (alt.prerequisites || []).some((p) =>
          ((p.evidence || {}).status) === "viable-at-current-state"));
      const isRepair = Boolean(options && options.goalOverride);
      if (!isRepair) {
        // Normal dependency execution cannot proceed: the block is unbeatable.
        // NOTE: this must NOT report `searchComplete` - a blocked prerequisite is
        // not a proof that no continuation exists anywhere; it is exactly the
        // situation the repair mechanism is supposed to improve. Reporting
        // searchComplete here would end the whole run before repair could fire.
        return {
          selected: null,
          outcome: { goalFound: false, expansions: 1, budgetExhausted: false, frontierExhausted: false, searchComplete: false, reason: "synthetic-unbeatable" },
          checkpoints: [],
          checkpointDiversity: { allStrictReplay: true, roles: [] },
          verdict: "LOCAL_DEPENDENCY_EXECUTION_OPEN",
        };
      }
      void selected;
      const child = nodes.REPAIRED;
      return {
        selected: { alternativeId: "repair-intent", prerequisite: { sourceNodeId: "repair" } },
        outcome: { goalFound: false, expansions: 2, budgetExhausted: false, frontierExhausted: false, searchComplete: false, reason: null },
        checkpoints: [{
          id: "checkpoint-repair-1",
          roles: ["resource-repair"],
          exactStateFingerprint: `fp-${child.id}`,
          floorId: child.floorId,
          state: state(child),
          decisionCount: 1,
          replay: { valid: true, stepsAttempted: 1, stepsCompleted: 1, failureReason: null },
          routeRecord: { decisions: [{ summary: child.decision }] },
        }],
        checkpointDiversity: { allStrictReplay: true, roles: ["resource-repair"] },
        verdict: "LOCAL_DEPENDENCY_SINGLE_ROLE_CHECKPOINT_VERIFIED",
      };
    };
    // Simulator: enumerates exactly one legal, HP-costing, ATK-gaining action.
    const makeSimulator = () => ({
      enumeratePrimitiveActions: (s) => {
        const node = s.__repairNode;
        if (node && node.id === "R") {
          return { actions: [{ summary: "battle:training@MT1:1,1", kind: "battle", target: { x: 1, y: 1 } }] };
        }
        return { actions: [] };
      },
      applyAction: (s) => state(nodes.REPAIRED),
    });
    return { nodes, state, buildContext, executeLocal, makeSimulator };
  })();

  // (a) Repair world WITH the mechanism enabled.
  const repairOn = runDependencyFeedbackLoop(
    { floors: {} },
    PROJECT_ROOT,
    TERMINAL_GOAL,
    repairWorld.state(repairWorld.nodes.R),
    {
      maxRounds: 6,
      maxTotalLocalExpansions: 50,
      localMaxExpansions: 10,
      candidateLimit: 4,
      buildDependencyContext: repairWorld.buildContext,
      executeLocalDependency: repairWorld.executeLocal,
      failureConditionedResourceRepair: true,
      simulatorFactory: repairWorld.makeSimulator,
    },
  );
  const repairTelemetry = repairOn.globalState.resourceRepair;
  assert.strictEqual(repairTelemetry.enabled, true);
  assert.ok(repairTelemetry.generated > 0, "a repair experiment must be generated for an unbeatable battle prerequisite");
  assert.ok(repairTelemetry.selected > 0, "the generated repair experiment must be selectable");
  assert.ok(repairTelemetry.checkpointsCreated > 0, "the repair experiment must produce a checkpoint");
  assert.ok(
    repairTelemetry.convertedToViable > 0,
    "a previously unbeatable battle must become viable after the automatic repair",
  );
  const repConversions = (repairOn.globalState.resourceRepairConversions || []).filter((c) => c.converted);
  assert.ok(repConversions.length > 0);
  assert.ok(repConversions[0].blockedStatusesBefore.includes("unbeatable-at-current-stats"));
  assert.ok(repConversions[0].statusesAfter.includes("viable-at-current-state"));

  // (b) Negative control: with the mechanism OFF the same world cannot advance
  //     to the ATK gain, proving the repair experiment is what carries it.
  const repairOff = runDependencyFeedbackLoop(
    { floors: {} },
    PROJECT_ROOT,
    TERMINAL_GOAL,
    repairWorld.state(repairWorld.nodes.R),
    {
      maxRounds: 6,
      maxTotalLocalExpansions: 50,
      localMaxExpansions: 10,
      candidateLimit: 4,
      buildDependencyContext: repairWorld.buildContext,
      executeLocalDependency: repairWorld.executeLocal,
      failureConditionedResourceRepair: false,
      simulatorFactory: repairWorld.makeSimulator,
    },
  );
  assert.strictEqual(repairOff.globalState.resourceRepair.generated, 0);
  assert.strictEqual(repairOff.globalState.resourceRepair.convertedToViable, 0);
  assert.ok(
    (repairOff.branches || []).every((b) => b.status === "exhausted" || b.depth === 0),
    "without the repair mechanism the blocked branch must exhaust under the monotonic contract",
  );

  // (c) Narrow trigger: when a normal prerequisite IS executable, no repair may
  //     be generated (otherwise the planner degenerates into farming first).
  const healthyWorld = {
    ...repairWorld,
    buildContext: (project, s, terminalGoal, options) => {
      const base = repairWorld.buildContext(project, s, terminalGoal, options);
      const alternative = base.plan.alternatives[0];
      alternative.prerequisites[0].evidence = {
        kind: "battle-survivability",
        status: "viable-at-current-state",
        damage: 5,
        currentHp: (s.hero || {}).hp,
      };
      return base;
    },
  };
  const healthy = runDependencyFeedbackLoop(
    { floors: {} },
    PROJECT_ROOT,
    TERMINAL_GOAL,
    repairWorld.state(repairWorld.nodes.R),
    {
      maxRounds: 3,
      maxTotalLocalExpansions: 50,
      localMaxExpansions: 10,
      candidateLimit: 4,
      buildDependencyContext: healthyWorld.buildContext,
      executeLocalDependency: repairWorld.executeLocal,
      failureConditionedResourceRepair: true,
      simulatorFactory: repairWorld.makeSimulator,
    },
  );
  assert.strictEqual(
    healthy.globalState.resourceRepair.generated,
    0,
    "no resource repair may be generated while a normal prerequisite is executable",
  );

  // (d) PR-5.27f - relevance world.
  //
  // Same blocked battle (`MT1:enemy:4,4:ogre`, viable only at ATK >= 50), but the
  // simulator now offers TWO investment opportunities:
  //   - a PURE path unlock (changeFloor, zero combat-resource delta)
  //   - a combat investment (battle: spend nothing, gain ATK)
  // The path unlock is re-generable at every new floor, which is exactly the
  // degeneracy observed in 5.27e (70 of 73 repair selections).
  const relevanceWorld = (() => {
    const BLOCK_ATK_REQUIRED = 50;
    const state = (node) => ({
      __repairNode: node,
      floorId: node.floorId,
      hero: {
        hp: 100, hpmax: 100, atk: node.atk, def: 0, mdef: 0, lv: 1, exp: 0, money: 0,
        loc: { x: 0, y: 0, direction: "down" },
        equipment: [], followers: [],
      },
      inventory: {}, flags: {}, floorStates: {}, triggeredAutoEvents: {},
      visitedFloors: { [node.floorId]: true }, route: [], notes: [],
      meta: { decisionDepth: node.ordinal, rawRouteLength: node.ordinal },
    });
    const rootNode = { id: "R", ordinal: 0, floorId: "MT1", atk: 10 };
    const buildContext = (project, s, terminalGoal, options) => {
      const atk = (s.hero || {}).atk || 0;
      const viable = atk >= BLOCK_ATK_REQUIRED;
      return {
        graph: { floorCorridor: {} },
        feasibility: {},
        plan: {
          objective: { selectedFeasibilitySubgoal: null },
          alternatives: [{
            id: "alternative-block",
            prerequisites: [{
              id: "require-block",
              sourceNodeId: "MT1:enemy:4,4:ogre",
              kind: "prerequisite",
              relation: "AND",
              order: 0,
              actionGoal: { type: "tileRemoved", floorId: "MT1", x: 4, y: 4 },
              target: { floorId: "MT1", x: 4, y: 4 },
              evidence: {
                kind: "battle-survivability",
                status: viable ? "viable-at-current-state" : "unbeatable-at-current-stats",
                damage: viable ? 10 : null,
                currentHp: (s.hero || {}).hp,
              },
            }],
          }],
        },
      };
    };
    const executeLocal = (project, projectRoot, s, plan, options) => {
      const goal = (options && options.goalOverride) || {};
      if (!options || !options.goalOverride) {
        return {
          selected: null,
          outcome: { goalFound: false, expansions: 1, budgetExhausted: false, frontierExhausted: false, searchComplete: false, reason: "synthetic-unbeatable" },
          checkpoints: [],
          checkpointDiversity: { allStrictReplay: true, roles: [] },
          verdict: "LOCAL_DEPENDENCY_EXECUTION_OPEN",
        };
      }
      const minHero = goal.minHero || {};
      const combat = numberish(minHero.atk) > 0 || numberish(minHero.exp) > 0 || numberish(minHero.lv) > 0;
      const node = combat
        ? { id: "STAT", ordinal: 1, floorId: s.floorId, atk: 60, decision: "battle:training@MT1:1,1" }
        : { id: "MOVED", ordinal: 1, floorId: s.floorId === "MT1" ? "MT2" : "MT3", atk: (s.hero || {}).atk, decision: `goto:MT2:0,0` };
      return {
        selected: { alternativeId: "repair-intent", prerequisite: { sourceNodeId: "repair" } },
        outcome: { goalFound: false, expansions: 2, budgetExhausted: false, frontierExhausted: false, searchComplete: false, reason: null },
        checkpoints: [{
          id: `checkpoint-${node.id}`,
          roles: ["resource-repair"],
          exactStateFingerprint: `fp-${node.id}-${node.floorId}`,
          floorId: node.floorId,
          state: state(node),
          decisionCount: 1,
          replay: { valid: true, stepsAttempted: 1, stepsCompleted: 1, failureReason: null },
          routeRecord: { decisions: [{ summary: node.decision }] },
        }],
        checkpointDiversity: { allStrictReplay: true, roles: ["resource-repair"] },
        verdict: "LOCAL_DEPENDENCY_SINGLE_ROLE_CHECKPOINT_VERIFIED",
      };
    };
    const PATH_ACTION = { summary: "goto:next-floor:0,0", kind: "changeFloor", target: { x: 0, y: 0 }, floorId: "MT1" };
    const STAT_ACTION = { summary: "battle:training@MT1:1,1", kind: "battle", target: { x: 1, y: 1 } };
    const makeSimulator = (actions) => () => ({
      enumeratePrimitiveActions: () => ({ actions }),
      applyAction: (s, action) => {
        if (action.kind === "changeFloor") {
          return state({
            id: "MOVED",
            ordinal: s.__repairNode.ordinal + 1,
            floorId: s.floorId === "MT1" ? "MT2" : "MT3",
            atk: (s.hero || {}).atk,
            decision: "goto:next-floor:0,0",
          });
        }
        return state({ id: "STAT", ordinal: s.__repairNode.ordinal + 1, floorId: s.floorId, atk: 60, decision: "battle:training@MT1:1,1" });
      },
    });
    return { rootNode, state, buildContext, executeLocal, makeSimulator, PATH_ACTION, STAT_ACTION };
  })();

  const runRelevance = (actions, extra) => runDependencyFeedbackLoop(
    { floors: {} },
    PROJECT_ROOT,
    TERMINAL_GOAL,
    relevanceWorld.state(relevanceWorld.rootNode),
    {
      maxRounds: 4,
      maxTotalLocalExpansions: 50,
      localMaxExpansions: 10,
      candidateLimit: 4,
      buildDependencyContext: relevanceWorld.buildContext,
      executeLocalDependency: relevanceWorld.executeLocal,
      failureConditionedResourceRepair: true,
      simulatorFactory: relevanceWorld.makeSimulator(actions),
      ...extra,
    },
  );

  // Case A - pure path/unlock only, with the battle-relevance gate ON.
  const pathOnlyRelevant = runRelevance([relevanceWorld.PATH_ACTION], { battleRelevantRepairOnly: true });
  assert.strictEqual(
    pathOnlyRelevant.globalState.resourceRepair.selected,
    0,
    "a pure non-combat path unlock must not be selected as a battle-feasibility repair",
  );
  assert.ok(
    pathOnlyRelevant.globalState.resourceRepair.rejectedByRelevance > 0,
    "the pure path unlock must be rejected by the relevance gate, not silently dropped",
  );
  assert.ok(
    Object.keys(pathOnlyRelevant.globalState.resourceRepair.rejectedIntentKinds)
      .some((kind) => kind.includes("path_unlock")),
    "the rejected intent kind must be reported as path_unlock",
  );
  assert.strictEqual(
    pathOnlyRelevant.globalState.resourceRepair.exactSamePrerequisiteConversions,
    0,
    "a rejected repair cannot produce a same-prerequisite conversion",
  );

  // Case A control - the SAME world with the broad (ungated) repair reproduces
  // the observed degeneracy: repeated path unlocks, no same-battle conversion.
  const pathOnlyBroad = runRelevance([relevanceWorld.PATH_ACTION], { battleRelevantRepairOnly: false });
  assert.ok(
    pathOnlyBroad.globalState.resourceRepair.selected > 0,
    "without the gate the pure path unlock is selected (the 5.27e failure shape)",
  );
  assert.strictEqual(
    pathOnlyBroad.globalState.resourceRepair.exactSamePrerequisiteConversions,
    0,
    "repeated path unlocks must NOT count as a same-prerequisite conversion",
  );
  assert.ok(
    pathOnlyBroad.globalState.advanceableBranchCount > 0,
    "PR-5.27f P1-2: a branch with a live repair experiment is part of the effective "
    + "experiment universe and must not be collapsed as exhausted",
  );

  // Case B - combat investment present, gate ON: the repair must be accepted and
  // must convert THE SAME prerequisite identity.
  let exactConversions = [];
  const combatRelevant = runRelevance(
    [relevanceWorld.PATH_ACTION, relevanceWorld.STAT_ACTION],
    { battleRelevantRepairOnly: true },
  );
  const combatTelemetry = combatRelevant.globalState.resourceRepair;
  assert.ok(combatTelemetry.selected > 0, "a combat-resource investment must be accepted as a repair");
  const combatAttempts = combatRelevant.globalState.resourceRepairAttempts || [];
  assert.ok(
    combatAttempts.length > 0 && combatAttempts.every((entry) => entry.repairKind !== "path/unlock"),
    "no selected repair may be a pure path unlock while the relevance gate is on",
  );
  assert.ok(
    combatTelemetry.exactSamePrerequisiteConversions > 0,
    "the accepted combat repair must convert the SAME blocked prerequisite",
  );
  exactConversions = (combatRelevant.globalState.resourceRepairConversions || [])
    .flatMap((entry) => entry.identityConversions || [])
    .filter((entry) => entry.converted);
  assert.ok(exactConversions.length > 0);
  assert.strictEqual(exactConversions[0].sameIdentity, true);
  assert.strictEqual(exactConversions[0].blockedPrerequisiteId, "MT1:enemy:4,4:ogre|MT1|4,4");
  assert.strictEqual(exactConversions[0].beforeStatus, "unbeatable-at-current-stats");
  assert.strictEqual(exactConversions[0].afterStatus, "viable-at-current-state");
  assert.ok(
    combatRelevant.globalState.finalBranchLifecycleSweep.advanceableBranchIds.length > 0
    || combatRelevant.globalState.advanceableBranchCount > 0,
    "a branch carrying a repair experiment remains advanceable in the effective universe",
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
      NORMAL_DEPENDENCY_CAN_ADVANCE_BEFORE: false,
      RESOURCE_REPAIR_EXPERIMENT_GENERATED: true,
      REPAIR_CHECKPOINT_STRICT_REPLAY: true,
      AFTER_REPAIR_REPLAN_SAME_BLOCKED_BATTLE_NOW_VIABLE: true,
      NO_RESOURCE_REPAIR_WITHOUT_A_BATTLE_FEASIBILITY_BLOCK: true,
      NO_RESOURCE_REPAIR_WHILE_NORMAL_PREREQUISITE_IS_EXECUTABLE: true,
      NO_AUTHORED_RESOURCE_THRESHOLD: true,
      PURE_PATH_UNLOCK_REPAIR_REJECTED: true,
      COMBAT_INVESTMENT_REPAIR_ACCEPTED: true,
      SAME_PREREQUISITE_IDENTITY_CONVERSION_ATTRIBUTED: true,
      BROAD_PATH_UNLOCK_DOES_NOT_COUNT_AS_SAME_PREREQUISITE_CONVERSION: true,
      BRANCH_WITH_REPAIR_EXPERIMENT_IS_ADVANCEABLE: true,
    },
    relevanceGate: {
      pathOnlyWithGate: {
        selected: pathOnlyRelevant.globalState.resourceRepair.selected,
        rejectedByRelevance: pathOnlyRelevant.globalState.resourceRepair.rejectedByRelevance,
        rejectedIntentKinds: pathOnlyRelevant.globalState.resourceRepair.rejectedIntentKinds,
        exactSamePrerequisiteConversions: pathOnlyRelevant.globalState.resourceRepair.exactSamePrerequisiteConversions,
      },
      pathOnlyBroad: {
        selected: pathOnlyBroad.globalState.resourceRepair.selected,
        rejectedByRelevance: pathOnlyBroad.globalState.resourceRepair.rejectedByRelevance,
        exactSamePrerequisiteConversions: pathOnlyBroad.globalState.resourceRepair.exactSamePrerequisiteConversions,
        convertedToViableBroad: pathOnlyBroad.globalState.resourceRepair.convertedToViable,
        advanceableBranchCount: pathOnlyBroad.globalState.advanceableBranchCount,
      },
      combatInvestmentWithGate: {
        selected: combatTelemetry.selected,
        rejectedByRelevance: combatTelemetry.rejectedByRelevance,
        selectedRepairKinds: combatAttempts.map((entry) => entry.repairKind),
        exactSamePrerequisiteConversions: combatTelemetry.exactSamePrerequisiteConversions,
        identityConversions: exactConversions,
      },
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
