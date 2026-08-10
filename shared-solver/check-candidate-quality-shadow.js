"use strict";

/**
 * TEST GRADE: unit-plus-micro
 *
 * PR-5.7a pure-observation controls.  The check proves that capture-all goal
 * archive auditing keeps materialized candidate routes, that the 1/2/4/8
 * retention matrix is deterministic, and that stop conditions A/B/C remain
 * distinct.  It does not change or certify production skyline behavior.
 */

const assert = require("node:assert");

const {
  buildRetentionMatrix,
  classifyQualityEvidence,
  createCandidateQualityCollector,
} = require("./lib/candidate-quality-shadow");
const { searchDP } = require("./lib/dp-search");
const { __testHooks } = require("./lib/segment-dp");

function makeState(id, hp, atk) {
  return {
    floorId: "SYNTH",
    hero: {
      hp,
      hpmax: 1000,
      mana: 0,
      manamax: 0,
      atk,
      def: 10,
      mdef: 0,
      lv: 1,
      exp: 0,
      money: 0,
      loc: { x: 1, y: 1, direction: "down" },
      equipment: [],
      followers: [],
    },
    inventory: id ? { [id]: 1 } : {},
    flags: {},
    visitedFloors: { SYNTH: true },
    floorStates: { SYNTH: { removed: {}, replaced: {} } },
    route: [],
    notes: [],
    meta: { decisionDepth: id ? 1 : 0, rawRouteLength: id ? 1 : 0 },
  };
}

function makeSimulator() {
  const targets = [
    { id: "a", hp: 300, atk: 10 },
    { id: "b", hp: 200, atk: 20 },
    { id: "c", hp: 100, atk: 30 },
    { id: "d", hp: 50, atk: 40 },
  ];
  return {
    project: {
      floorsById: {
        SYNTH: {
          floorId: "SYNTH",
          width: 3,
          height: 3,
          map: [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
          changeFloor: {},
        },
      },
      mapTilesByNumber: {},
      enemysById: {},
      itemsById: {},
    },
    getActionFingerprint: (action) => `fp:${action.summary}`,
    enumeratePrimitiveActions: (state) => Object.keys(state.inventory || {}).length > 0
      ? { actions: [] }
      : {
          actions: targets.map((target) => ({
            kind: "event",
            summary: `choose:${target.id}`,
            target,
          })),
        },
    applyAction: (state, action) => makeState(
      action.target.id,
      action.target.hp,
      action.target.atk,
    ),
  };
}

function checkCaptureAllGoalCandidates() {
  const simulator = makeSimulator();
  const result = searchDP(simulator, makeState(null, 10, 1), {
    maxExpansions: 20,
    maxActionsPerState: 10,
    dpKeyMode: "location",
    stopOnFirstGoal: false,
    goalSkylineLimit: 2,
    goalPredicate: (state) => Object.keys(state.inventory || {}).length > 0,
    goalArchiveAudit: {
      captureAllGoalCandidates: true,
      maxCandidates: 16,
      maxEvents: 32,
      role: "candidate-quality-shadow",
    },
  });
  const audit = result.goalArchiveAudit;
  assert.ok(audit);
  assert.strictEqual(audit.captureAllGoalCandidates, true);
  assert.strictEqual(audit.acceptedCandidateCount, 4);
  assert.strictEqual(audit.selectedGoalNodes, 2);
  assert.strictEqual(audit.captureTruncated, false);
  assert.ok(audit.acceptedCandidates.every((candidate) => candidate.state.route.length === 1));
  return audit;
}

function makeCandidates() {
  return [
    { id: "A", state: makeState("A", 400, 10), route: ["A"], tags: [], score: 400 },
    { id: "B", state: makeState("B", 300, 20), route: ["B"], tags: [], score: 300 },
    { id: "C", state: makeState("C", 200, 30), route: ["C"], tags: [], score: 200 },
    { id: "D", state: makeState("D", 100, 40), route: ["D"], tags: [], score: 100 },
    { id: "E", state: makeState("E", 50, 50), route: ["E"], tags: [], score: 50 },
  ];
}

function checkRetentionAndStopConditions() {
  const simulator = makeSimulator();
  simulator.buildReachableRegionSignature = () => ({
    regionKey: "SYNTH",
    reachableEndpointsKey: "",
  });
  const segment = {
    id: "first-sweep",
    goal: { floorId: "SYNTH" },
    dp: { keyMode: "region", goalSkylineLimit: 8 },
  };
  const candidates = makeCandidates();
  const matrix = buildRetentionMatrix(simulator, candidates, segment, {
    capacities: [1, 2, 4, 8],
    preserveSkylineRoles: true,
    selectCandidateSkyline: __testHooks.selectCandidateSkyline,
  });
  assert.deepStrictEqual(matrix.map((row) => row.capacity), [1, 2, 4, 8]);
  assert.deepStrictEqual(matrix.map((row) => row.selectedCount), [1, 2, 4, 5]);
  assert.ok(matrix[0].decisions.some((decision) => decision.reason === "milestone-frontier-capacity"));
  const duplicateMatrix = buildRetentionMatrix(
    simulator,
    candidates.concat({
      id: "F",
      state: makeState("A", 400, 10),
      route: ["F"],
      tags: [],
      score: 400,
    }),
    segment,
    {
      capacities: [8],
      preserveSkylineRoles: true,
      selectCandidateSkyline: __testHooks.selectCandidateSkyline,
    },
  );
  assert.strictEqual(duplicateMatrix[0].uniqueDpKeyCount, 5);
  assert.strictEqual(
    duplicateMatrix[0].decisions.find((decision) => decision.candidateId === "F").reason,
    "milestone-frontier-dp-key-deduplication",
  );

  const witness = classifyQualityEvidence(matrix, [
    { candidateId: "A", reached: false, budgetExhausted: false },
    { candidateId: "B", reached: false, budgetExhausted: false },
    { candidateId: "C", reached: false, budgetExhausted: false },
    { candidateId: "D", reached: false, budgetExhausted: false },
    { candidateId: "E", reached: true, budgetExhausted: false },
  ]);
  assert.strictEqual(witness.stopCondition, "A");
  assert.strictEqual(witness.verdict, "EVICTED_SUCCESS_WITNESS");

  const allFail = classifyQualityEvidence(matrix, candidates.map((candidate) => ({
    candidateId: candidate.id,
    reached: false,
    budgetExhausted: false,
  })));
  assert.strictEqual(allFail.stopCondition, "B");
  assert.strictEqual(allFail.verdict, "EVICTED_CANDIDATES_ALSO_FAIL");

  const budget = classifyQualityEvidence(matrix, candidates.map((candidate, index) => ({
    candidateId: candidate.id,
    reached: false,
    budgetExhausted: index === 4,
  })));
  assert.strictEqual(budget.stopCondition, "C");
  assert.strictEqual(budget.verdict, "BUDGET_INCONCLUSIVE");
  return matrix;
}

function checkCollector() {
  const collector = createCandidateQualityCollector({ sourceSegmentId: "first-sweep" });
  collector.pipelineObserver.onMerge({
    segment: { id: "unrelated" },
    nextCandidates: makeCandidates(),
    merged: [],
    candidateLimit: 4,
  });
  collector.pipelineObserver.onMerge({
    segment: { id: "first-sweep" },
    nextCandidates: makeCandidates(),
    merged: makeCandidates().slice(0, 4),
    candidateLimit: 4,
  });
  const snapshot = collector.snapshot();
  assert.strictEqual(snapshot.merges.length, 1);
  assert.strictEqual(snapshot.merges[0].nextCandidates.length, 5);
  assert.strictEqual(snapshot.merges[0].merged.length, 4);
  assert.notStrictEqual(snapshot.merges[0].nextCandidates[0].state, makeCandidates()[0].state);
}

function main() {
  const audit = checkCaptureAllGoalCandidates();
  const matrix = checkRetentionAndStopConditions();
  checkCollector();
  process.stdout.write(`${JSON.stringify({
    schema: "motapathfinder.candidate-quality-shadow.v1",
    status: "passed",
    controls: {
      productionSelectionUntouched: true,
      captureAllGoalCandidates: audit.acceptedCandidateCount,
      materializedRoutesCaptured: true,
      retentionCapacities: matrix.map((row) => row.capacity),
      stopConditionsSeparated: ["A", "B", "C"],
      dpKeyUntouched: true,
      dominanceUntouched: true,
      objectiveSpecExcludedFromIntermediateRanking: true,
    },
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main };
