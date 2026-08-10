"use strict";

/**
 * TEST GRADE: unit-plus-micro
 *
 * PR-5.6b eval vector contract (observation-only).
 *
 * 1. Synthetic stage graph: per-field margins are signed, cover every remaining
 *    stage, and the bottleneck names the least-covered requirement.
 * 2. Real MT5 milestone chain: mt5-first-sweep -> mt5-third-gate is the tracked
 *    case where HP legitimately drops (136514 -> 105138) while ATK/DEF/EXP must
 *    keep climbing, so a scalar HP-shaped eval would rank it backwards.
 * 3. Feasibility never reports an unconfigured milestone as viable.
 * 4. The UI projection is a display compression only and stays out of search.
 */

const assert = require("node:assert");
const path = require("node:path");

const {
  EVAL_SCHEMA,
  computeEvalVector,
  projectPlanHealthForUi,
} = require("./lib/eval-vector");
const { compileGoalDependencyGraph } = require("./lib/goal-dependency-graph");
const { getMilestoneSpec } = require("./lib/milestone-spec");
const { loadProject } = require("./lib/project-loader");

const ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");
const ROUTE_NAME = "onlyup-chaos-mt5-blueking";
const SOURCE_SEGMENT_ID = "mt5-first-sweep";
const DOWNSTREAM_SEGMENT_ID = "mt5-third-gate";

function syntheticProject() {
  return {
    floorsById: {
      F1: { width: 1, height: 1, map: [[0]], changeFloor: {} },
      F2: { width: 1, height: 1, map: [[0]], changeFloor: {} },
    },
    mapTilesByNumber: {},
  };
}

function syntheticState(hero) {
  return {
    floorId: "F1",
    hero: { hp: 0, atk: 0, def: 0, mdef: 0, lv: 1, exp: 0, equipment: [], loc: { x: 0, y: 0 }, ...hero },
    inventory: {},
    flags: {},
    visitedFloors: { F1: true },
    floorStates: {},
    route: [],
    meta: { decisionDepth: 0, rawRouteLength: 0 },
  };
}

function syntheticSegments() {
  return [
    {
      id: "stage-a",
      goal: { type: "heroAtLeast", floorId: "F1", minHero: { atk: 100, def: 100 } },
      actionPolicy: { allowChangeFloors: [] },
    },
    {
      id: "stage-b",
      goal: { type: "heroAtLeast", floorId: "F1", minHero: { atk: 200, def: 400 } },
      actionPolicy: { allowChangeFloors: [] },
    },
  ];
}

function checkSyntheticMargins() {
  const project = syntheticProject();
  const graph = compileGoalDependencyGraph(project, syntheticSegments());
  const state = syntheticState({ atk: 100, def: 100 });
  const vector = computeEvalVector(project, state, {
    goalDependencyGraph: graph,
    currentSegmentId: "stage-a",
  });

  assert.strictEqual(vector.schema, EVAL_SCHEMA);
  assert.strictEqual(vector.currentGoal.completion, 1, "stage-a requirements are met");
  assert.strictEqual(vector.currentGoal.reached, true);

  // Margins must span the current stage AND every stage ahead, so a state that
  // clears the current milestone can still show a downstream deficit.
  const fields = vector.resources.margins.map((entry) => `${entry.stageId}:${entry.field}`);
  assert.deepStrictEqual(fields.sort(), [
    "stage-a:atk", "stage-a:def", "stage-b:atk", "stage-b:def",
  ], "margins cover current and downstream stat requirements");

  const stageBDef = vector.resources.margins.find((entry) =>
    entry.stageId === "stage-b" && entry.field === "def");
  assert.strictEqual(stageBDef.margin, -300, "signed margin exposes the raw shortfall");
  assert.strictEqual(stageBDef.met, false);
  assert.strictEqual(stageBDef.stagesAhead, 1);

  // stage-b def is 100/400 = 0.25, stage-b atk is 100/200 = 0.5.
  assert.strictEqual(vector.resources.bottleneck.field, "def", "worst ratio wins");
  assert.strictEqual(vector.resources.bottleneck.stageId, "stage-b");
  assert.strictEqual(vector.resources.criticalRatio, 0.25);
  assert.strictEqual(vector.resources.unmetCount, 2);

  // A state that is strictly worse on the bottleneck must not out-rank this one
  // on criticalRatio, even though both clear the current milestone identically.
  const weaker = computeEvalVector(project, syntheticState({ atk: 100, def: 100, hp: 999999 }), {
    goalDependencyGraph: graph,
    currentSegmentId: "stage-a",
  });
  assert.strictEqual(
    weaker.resources.criticalRatio,
    vector.resources.criticalRatio,
    "huge HP must not inflate a resource-safety reading that HP does not gate",
  );

  return {
    marginCount: vector.resources.margins.length,
    bottleneck: `${vector.resources.bottleneck.stageId}:${vector.resources.bottleneck.field}`,
    criticalRatio: vector.resources.criticalRatio,
  };
}

function checkUnknownEvidenceIsNotViable() {
  const project = syntheticProject();
  const graph = compileGoalDependencyGraph(project, syntheticSegments());
  const vector = computeEvalVector(project, syntheticState({ atk: 500, def: 500 }), {
    goalDependencyGraph: graph,
    currentSegmentId: "stage-a",
  });
  // The synthetic segments declare no admissibleBounds, so "no necessary
  // condition violated" is vacuous and must not be reported as viable.
  assert.strictEqual(vector.feasibility.verdict, "unknown");
  assert.strictEqual(vector.feasibility.reason, "no-admissible-bounds-declared");

  const health = projectPlanHealthForUi(vector);
  assert.strictEqual(health.band, "unknown-evidence", "unknown evidence is surfaced, not hidden");
  assert.strictEqual(health.uiProjectionOnly, true);
  return { verdict: vector.feasibility.verdict, band: health.band };
}

function checkTrackedMt5Chain() {
  const project = loadProject(PROJECT_ROOT);
  const milestoneSpec = getMilestoneSpec(project, ROUTE_NAME);
  const sourceIndex = milestoneSpec.milestones.findIndex((segment) =>
    segment.id === SOURCE_SEGMENT_ID);
  assert.ok(sourceIndex >= 0, "tracked MT5 source milestone must exist");
  const dependencySegments = milestoneSpec.milestones.slice(sourceIndex);
  const graph = compileGoalDependencyGraph(project, dependencySegments);

  const sourceGoal = dependencySegments[0].goal.minHero;
  const downstream = dependencySegments.find((segment) => segment.id === DOWNSTREAM_SEGMENT_ID);
  const downstreamGoal = downstream.goal.minHero;
  assert.ok(
    downstreamGoal.hp < sourceGoal.hp && downstreamGoal.atk > sourceGoal.atk,
    "tracked chain must be the HP-drops-while-ATK-climbs case",
  );

  // Candidate A: exactly clears the current sweep, and is a dead end on ATK.
  const atSweep = {
    floorId: "MT5",
    hero: { ...sourceGoal, lv: 1, equipment: [], loc: { x: 0, y: 0 } },
    inventory: {},
    flags: {},
    visitedFloors: { MT5: true },
    floorStates: {},
    route: [],
    meta: { decisionDepth: 0, rawRouteLength: 0 },
  };
  // Candidate B: 30k less HP, but already past the third gate's ATK/DEF/EXP.
  const preparedForGate = {
    ...atSweep,
    hero: {
      ...atSweep.hero,
      hp: sourceGoal.hp - 30000,
      atk: downstreamGoal.atk,
      def: downstreamGoal.def,
      mdef: downstreamGoal.mdef,
      exp: downstreamGoal.exp,
    },
  };

  const sweepVector = computeEvalVector(project, atSweep, {
    goalDependencyGraph: graph,
    currentSegmentId: SOURCE_SEGMENT_ID,
  });
  const preparedVector = computeEvalVector(project, preparedForGate, {
    goalDependencyGraph: graph,
    currentSegmentId: SOURCE_SEGMENT_ID,
  });

  assert.strictEqual(sweepVector.currentGoal.reached, true, "candidate A clears the sweep");
  assert.ok(
    preparedVector.downstream.completion > sweepVector.downstream.completion,
    "the lower-HP but gate-ready candidate must read as more downstream-ready",
  );
  assert.ok(
    preparedVector.resources.criticalRatio > sweepVector.resources.criticalRatio,
    "resource safety must follow the binding stat, not raw HP",
  );

  // The whole point of the four-layer split: candidate A looks perfect on the
  // current milestone and still carries the worse forward position.
  const sweepHealth = projectPlanHealthForUi(sweepVector);
  const preparedHealth = projectPlanHealthForUi(preparedVector);
  assert.ok(
    preparedHealth.score > sweepHealth.score,
    "plan health must not be dominated by current-goal completion alone",
  );

  const bottleneck = sweepVector.resources.bottleneck;
  assert.ok(bottleneck, "an unmet downstream requirement must be nameable");
  assert.notStrictEqual(bottleneck.field, "hp", "the MT5 bottleneck is not HP");

  return {
    sourceSegmentId: SOURCE_SEGMENT_ID,
    downstreamSegmentId: DOWNSTREAM_SEGMENT_ID,
    stageCount: graph.stages.length,
    atSweep: {
      currentCompletion: Number(sweepVector.currentGoal.completion.toFixed(4)),
      downstreamCompletion: Number(sweepVector.downstream.completion.toFixed(4)),
      criticalRatio: Number(sweepVector.resources.criticalRatio.toFixed(4)),
      bottleneck: `${bottleneck.stageId}:${bottleneck.field}`,
      planHealth: sweepHealth.score,
    },
    preparedForGate: {
      currentCompletion: Number(preparedVector.currentGoal.completion.toFixed(4)),
      downstreamCompletion: Number(preparedVector.downstream.completion.toFixed(4)),
      criticalRatio: Number(preparedVector.resources.criticalRatio.toFixed(4)),
      bottleneck: preparedVector.resources.bottleneck
        ? `${preparedVector.resources.bottleneck.stageId}:${preparedVector.resources.bottleneck.field}`
        : null,
      planHealth: preparedHealth.score,
    },
  };
}

function main() {
  process.stdout.write(`${JSON.stringify({
    schema: "motapathfinder.eval-vector-contract.v1",
    status: "passed",
    controls: {
      productionDpKeyUntouched: true,
      productionDominanceUntouched: true,
      productionAgendaUntouched: true,
      candidateCapacityUntouched: true,
      observationOnly: true,
      planHealthIsUiProjectionOnly: true,
      planHealthIsNotAProbability: true,
    },
    syntheticMargins: checkSyntheticMargins(),
    unknownEvidence: checkUnknownEvidenceIsNotViable(),
    trackedMt5Chain: checkTrackedMt5Chain(),
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main };
