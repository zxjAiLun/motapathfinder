"use strict";

/**
 * TEST GRADE: unit-plus-micro
 *
 * PR-5.6b eval vector contract (observation-only), post Repair 1.
 *
 * 1. Synthetic stage graph: per-field margins are signed, cover the horizon,
 *    and the bottleneck names the least-covered requirement.
 * 2. Fail-closed API: unknown segment id, mismatched explicit segment, empty
 *    graph, and non-integer / out-of-range marginHorizon all throw rather than
 *    silently evaluating stage 0 under someone else's label.
 * 3. Projection vs production goal: a goal carrying actionSurvivable /
 *    resourceDeferral can never report reached=true from projection alone.
 * 4. Feasibility is three-state; partial admissible evidence stays unknown.
 * 5. Terminal stage: no downstream component is excluded from plan health
 *    rather than folded in as zero.
 * 6. Real MT5 chain: mt5-first-sweep -> mt5-third-gate is the tracked case
 *    where HP legitimately drops (136514 -> 105138) while ATK/DEF/EXP must keep
 *    climbing, so a scalar HP-shaped eval would rank it backwards.  The exact
 *    bottleneck witness is locked; the UI score is only order-locked because
 *    the projection formula is explicitly a placeholder.
 */

const assert = require("node:assert");
const path = require("node:path");

const {
  DEFAULT_MARGIN_HORIZON,
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
  assert.strictEqual(vector.currentGoal.projectedCompletion, 1, "stage-a requirements are met");
  assert.strictEqual(vector.resources.horizon, DEFAULT_MARGIN_HORIZON);

  // Margins must span the current stage AND the horizon, so a state that
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

  // Piling on a stat nothing in the horizon requires must not move safety.
  const padded = computeEvalVector(project, syntheticState({ atk: 100, def: 100, hp: 999999 }), {
    goalDependencyGraph: graph,
    currentSegmentId: "stage-a",
  });
  assert.strictEqual(
    padded.resources.criticalRatio,
    vector.resources.criticalRatio,
    "huge HP must not inflate a resource-safety reading that HP does not gate",
  );

  return {
    marginCount: vector.resources.margins.length,
    bottleneck: `${vector.resources.bottleneck.stageId}:${vector.resources.bottleneck.field}`,
    criticalRatio: vector.resources.criticalRatio,
  };
}

function checkFailClosedApi() {
  const project = syntheticProject();
  const graph = compileGoalDependencyGraph(project, syntheticSegments());
  const state = syntheticState({ atk: 100, def: 100 });

  // A typo'd segment id must not silently evaluate stage 0 while reporting the
  // typo back as the label.
  assert.throws(
    () => computeEvalVector(project, state, {
      goalDependencyGraph: graph,
      currentSegmentId: "stage-bb",
    }),
    /Unknown eval segment/,
    "unknown segment id must throw",
  );

  // An explicit segment disagreeing with currentSegmentId would blend one
  // milestone's completion with another's feasibility.
  assert.throws(
    () => computeEvalVector(project, state, {
      goalDependencyGraph: graph,
      currentSegmentId: "stage-a",
      segment: { id: "stage-b", goal: {} },
    }),
    /does not match currentSegmentId/,
    "mismatched explicit segment must throw",
  );

  assert.throws(
    () => computeEvalVector(project, state, {
      goalDependencyGraph: compileGoalDependencyGraph(project, []),
    }),
    /at least one stage/,
    "empty graph must throw",
  );

  for (const bad of [0, -1, "two", Number.NaN, Infinity]) {
    assert.throws(
      () => computeEvalVector(project, state, {
        goalDependencyGraph: graph,
        currentSegmentId: "stage-a",
        marginHorizon: bad,
      }),
      /marginHorizon/,
      `marginHorizon ${JSON.stringify(bad)} must be rejected`,
    );
  }

  // Fractional horizons are floored, not silently mis-applied.
  const fractional = computeEvalVector(project, state, {
    goalDependencyGraph: graph,
    currentSegmentId: "stage-a",
    marginHorizon: 2.7,
  });
  assert.strictEqual(fractional.resources.horizon, 2, "fractional horizon floors to an integer");

  // Omitting the id is still allowed and defaults to the first stage.
  const defaulted = computeEvalVector(project, state, { goalDependencyGraph: graph });
  assert.strictEqual(defaulted.currentSegmentId, "stage-a");

  return { unknownSegment: "throws", mismatchedSegment: "throws", emptyGraph: "throws", horizon: "integerized" };
}

function checkNonProjectableGoalIsNotReached() {
  const project = syntheticProject();
  // actionSurvivable is a real production clause (missingGoalFields evaluates
  // battle damage/survivability through the simulator); the dependency graph
  // cannot project it.
  const segments = [{
    id: "gated",
    goal: {
      type: "heroAtLeast",
      floorId: "F1",
      minHero: { atk: 10 },
      actionSurvivable: { summary: "battle:skeleton@F1:0,0", exactDamage: 1558 },
    },
    actionPolicy: { allowChangeFloors: [] },
  }];
  const graph = compileGoalDependencyGraph(project, segments);
  const vector = computeEvalVector(project, syntheticState({ atk: 999 }), {
    goalDependencyGraph: graph,
    currentSegmentId: "gated",
  });

  assert.strictEqual(vector.currentGoal.projectedCompletion, 1, "every projectable clause is met");
  assert.strictEqual(vector.currentGoal.reached, null, "unprojectable clauses force reached=null");
  assert.strictEqual(vector.currentGoal.reachedReason, "goal-not-fully-projectable");
  assert.deepStrictEqual(
    vector.currentGoal.projectionCoverage.unprojectableClauses,
    ["actionSurvivable"],
  );

  // A fully projectable goal still reports an exact boolean.
  const plainGraph = compileGoalDependencyGraph(project, syntheticSegments());
  const plain = computeEvalVector(project, syntheticState({ atk: 100, def: 100 }), {
    goalDependencyGraph: plainGraph,
    currentSegmentId: "stage-a",
  });
  assert.strictEqual(plain.currentGoal.reached, true);
  assert.strictEqual(plain.currentGoal.projectionCoverage.complete, true);

  // And an unmet projectable goal is a hard false, not null.
  const unmet = computeEvalVector(project, syntheticState({ atk: 1, def: 1 }), {
    goalDependencyGraph: plainGraph,
    currentSegmentId: "stage-a",
  });
  assert.strictEqual(unmet.currentGoal.reached, false);

  return {
    unprojectable: vector.currentGoal.reached,
    reason: vector.currentGoal.reachedReason,
    projectable: plain.currentGoal.reached,
    unmet: unmet.currentGoal.reached,
  };
}

function checkFeasibilityIsThreeState() {
  const project = syntheticProject();

  // No admissible bounds at all.
  const bare = compileGoalDependencyGraph(project, syntheticSegments());
  const noEvidence = computeEvalVector(project, syntheticState({ atk: 500, def: 500 }), {
    goalDependencyGraph: bare,
    currentSegmentId: "stage-a",
  });
  assert.strictEqual(noEvidence.feasibility.verdict, "unknown-evidence");
  assert.strictEqual(noEvidence.feasibility.reason, "no-admissible-bounds-declared");

  // Partial evidence: a complete floor graph but no optimistic stat bound for
  // the declared atk goal.  Passing the floor check proves nothing about atk,
  // so this must NOT be promoted to bounds-pass.
  const partialSegments = [{
    id: "partial",
    goal: { type: "heroAtLeast", floorId: "F1", minHero: { atk: 999999 } },
    admissibleBounds: { floorGraph: { complete: true, floorFly: false, edges: { F1: [] } } },
    actionPolicy: { allowChangeFloors: [] },
  }];
  const partial = computeEvalVector(project, syntheticState({ atk: 1 }), {
    goalDependencyGraph: compileGoalDependencyGraph(project, partialSegments),
    currentSegmentId: "partial",
  });
  assert.strictEqual(partial.feasibility.verdict, "unknown-evidence", "partial evidence is not a pass");
  assert.strictEqual(partial.feasibility.reason, "admissible-bounds-incomplete-for-declared-goal");
  assert.deepStrictEqual(partial.feasibility.uncoveredConditions, ["hero:atk"]);
  assert.deepStrictEqual(partial.feasibility.coveredConditions, ["floor:F1"]);

  // Complete evidence for every declared clause -> bounds-pass, never "viable".
  const completeSegments = [{
    id: "complete",
    goal: { type: "heroAtLeast", floorId: "F1", minHero: { atk: 50 } },
    admissibleBounds: {
      floorGraph: { complete: true, floorFly: false, edges: { F1: [] } },
      optimisticHeroGain: { atk: 10 },
    },
    actionPolicy: { allowChangeFloors: [] },
  }];
  const completeGraph = compileGoalDependencyGraph(project, completeSegments);
  // atk 45 + optimistic 10 = 55 >= 50, so no declared bound is violated.
  const passes = computeEvalVector(project, syntheticState({ atk: 45 }), {
    goalDependencyGraph: completeGraph,
    currentSegmentId: "complete",
  });
  assert.strictEqual(passes.feasibility.verdict, "bounds-pass");
  assert.strictEqual(passes.feasibility.evidenceCompleteForDeclaredGoal, true);
  assert.notStrictEqual(passes.feasibility.verdict, "viable", "passing bounds is not a route witness");

  // atk 1 + optimistic 10 = 11 < 50, so the goal is provably out of reach.
  const refuted = computeEvalVector(project, syntheticState({ atk: 1 }), {
    goalDependencyGraph: completeGraph,
    currentSegmentId: "complete",
  });
  assert.strictEqual(refuted.feasibility.verdict, "proven-impossible");
  assert.strictEqual(refuted.feasibility.reason, "optimistic-hero-bound-below-goal");
  assert.strictEqual(projectPlanHealthForUi(refuted).score, 0);

  return {
    noEvidence: noEvidence.feasibility.verdict,
    partialEvidence: partial.feasibility.verdict,
    completeEvidence: passes.feasibility.verdict,
    violated: refuted.feasibility.verdict,
  };
}

function checkTerminalStageHealth() {
  const project = syntheticProject();
  const graph = compileGoalDependencyGraph(project, syntheticSegments());
  // Sitting on the FINAL stage with every requirement cleared.
  const vector = computeEvalVector(project, syntheticState({ atk: 400, def: 400 }), {
    goalDependencyGraph: graph,
    currentSegmentId: "stage-b",
  });

  assert.strictEqual(vector.currentGoal.projectedCompletion, 1);
  assert.strictEqual(vector.downstream.applicable, false, "the last stage has no downstream");
  assert.strictEqual(vector.downstream.stageCount, 0, "stageCount excludes the current stage");
  assert.strictEqual(vector.downstream.projectedCompletion, null, "N/A is null, not zero");

  const health = projectPlanHealthForUi(vector);
  assert.deepStrictEqual(health.appliedComponents, ["currentGoal", "resourceSafety"]);
  assert.strictEqual(health.score, 100, "a completed final plan must not be capped at 67");

  // The non-terminal stage still counts downstream.
  const midway = computeEvalVector(project, syntheticState({ atk: 400, def: 400 }), {
    goalDependencyGraph: graph,
    currentSegmentId: "stage-a",
  });
  assert.strictEqual(midway.downstream.applicable, true);
  assert.strictEqual(midway.downstream.stageCount, 1);

  return {
    terminalScore: health.score,
    appliedComponents: health.appliedComponents,
    terminalDownstreamStageCount: vector.downstream.stageCount,
    midwayDownstreamStageCount: midway.downstream.stageCount,
  };
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
  // Lock the shape of the tracked case itself: if the milestone thresholds are
  // ever retuned so HP no longer drops, this corpus stops testing what it says.
  assert.strictEqual(sourceGoal.hp, 136514);
  assert.strictEqual(downstreamGoal.hp, 105138);
  assert.strictEqual(downstreamGoal.atk, 1097);
  assert.strictEqual(downstreamGoal.exp, 367);
  assert.ok(
    downstreamGoal.hp < sourceGoal.hp && downstreamGoal.atk > sourceGoal.atk,
    "tracked chain must be the HP-drops-while-ATK-climbs case",
  );

  const baseState = {
    floorId: "MT5",
    hero: { ...sourceGoal, lv: 1, equipment: [], loc: { x: 0, y: 0 } },
    inventory: {},
    flags: {},
    visitedFloors: { MT5: true },
    floorStates: {},
    route: [],
    meta: { decisionDepth: 0, rawRouteLength: 0 },
  };
  // Candidate A: exactly clears the current sweep, and is a dead end on EXP.
  const atSweep = baseState;
  // Candidate B: 30k less HP, but already past the third gate's ATK/DEF/EXP.
  const preparedForGate = {
    ...baseState,
    hero: {
      ...baseState.hero,
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

  assert.strictEqual(sweepVector.currentGoal.projectedCompletion, 1, "candidate A clears the sweep");
  assert.strictEqual(sweepVector.currentGoal.reached, true, "the sweep goal is fully projectable");

  // The exact witness from the delivery report, locked field by field.  A
  // weaker "bottleneck is not hp" assertion would stay green if this silently
  // became a DEF or MDEF deficit.
  const bottleneck = sweepVector.resources.bottleneck;
  assert.ok(bottleneck, "an unmet downstream requirement must be nameable");
  assert.strictEqual(bottleneck.stageId, DOWNSTREAM_SEGMENT_ID);
  assert.strictEqual(bottleneck.field, "exp");
  assert.strictEqual(bottleneck.margin, -146);
  assert.strictEqual(bottleneck.required, 367);
  assert.strictEqual(bottleneck.actual, 221);
  assert.strictEqual(bottleneck.stagesAhead, 1);

  // The full horizon must still surface the late-route wall the near-term
  // view deliberately excludes.
  assert.ok(
    sweepVector.resources.fullHorizon.requirementCount >
      sweepVector.resources.requirementCount,
    "full horizon covers more requirements than the near-term window",
  );
  assert.ok(
    sweepVector.resources.fullHorizon.criticalRatio < sweepVector.resources.criticalRatio,
    "the endgame wall is reported, not hidden",
  );

  // Ordering, not absolute scores: the UI formula is an explicit placeholder.
  assert.ok(
    preparedVector.downstream.projectedCompletion > sweepVector.downstream.projectedCompletion,
    "the lower-HP but gate-ready candidate must read as more downstream-ready",
  );
  assert.ok(
    preparedVector.resources.criticalRatio > sweepVector.resources.criticalRatio,
    "resource safety must follow the binding stat, not raw HP",
  );
  const sweepHealth = projectPlanHealthForUi(sweepVector);
  const preparedHealth = projectPlanHealthForUi(preparedVector);
  assert.ok(
    preparedHealth.score > sweepHealth.score,
    "plan health must not be dominated by current-goal completion alone",
  );
  // Component vector is locked in shape even though the scalar is tunable.
  assert.deepStrictEqual(
    sweepHealth.appliedComponents,
    ["currentGoal", "downstream", "resourceSafety"],
  );

  return {
    sourceSegmentId: SOURCE_SEGMENT_ID,
    downstreamSegmentId: DOWNSTREAM_SEGMENT_ID,
    stageCount: graph.stages.length,
    atSweep: {
      projectedCompletion: Number(sweepVector.currentGoal.projectedCompletion.toFixed(4)),
      reached: sweepVector.currentGoal.reached,
      downstreamCompletion: Number(sweepVector.downstream.projectedCompletion.toFixed(4)),
      criticalRatio: Number(sweepVector.resources.criticalRatio.toFixed(4)),
      bottleneck: `${bottleneck.stageId}:${bottleneck.field}`,
      bottleneckMargin: bottleneck.margin,
      fullHorizonBottleneck: `${sweepVector.resources.fullHorizon.bottleneck.stageId}:${
        sweepVector.resources.fullHorizon.bottleneck.field}`,
      planHealth: sweepHealth.score,
    },
    preparedForGate: {
      projectedCompletion: Number(preparedVector.currentGoal.projectedCompletion.toFixed(4)),
      downstreamCompletion: Number(preparedVector.downstream.projectedCompletion.toFixed(4)),
      criticalRatio: Number(preparedVector.resources.criticalRatio.toFixed(4)),
      bottleneck: preparedVector.resources.bottleneck
        ? `${preparedVector.resources.bottleneck.stageId}:${preparedVector.resources.bottleneck.field}`
        : null,
      planHealth: preparedHealth.score,
    },
  };
}

/**
 * Structural enforcement of the observation-only boundary.  Asserting
 * `observationOnly: true` as a literal would keep reporting green after someone
 * wires the eval vector into the agenda or a pruning decision, so instead read
 * the correctness modules and prove none of them can reach this one.
 */
function checkCorrectnessBoundary() {
  const fs = require("node:fs");
  const fenced = [
    "lib/dp-search.js",
    "lib/segment-dp.js",
    "lib/dominance.js",
    "lib/objective-spec.js",
    "lib/state-key.js",
    "lib/guarded-candidate-key.js",
    "lib/agenda-policy-evaluation.js",
  ];
  const violations = [];
  for (const relative of fenced) {
    const absolute = path.join(__dirname, relative);
    assert.ok(fs.existsSync(absolute), `fenced module ${relative} must exist`);
    const source = fs.readFileSync(absolute, "utf8");
    if (/require\(["'][^"']*eval-vector["']\)/.test(source)
      || /\bprojectPlanHealthForUi\b/.test(source)
      || /\bcomputeEvalVector\b/.test(source)) {
      violations.push(relative);
    }
  }
  assert.deepStrictEqual(
    violations,
    [],
    `correctness modules must not import the eval vector: ${violations.join(", ")}`,
  );
  return { fencedModules: fenced.length, violations: violations.length };
}

function main() {
  const boundary = checkCorrectnessBoundary();
  process.stdout.write(`${JSON.stringify({
    schema: "motapathfinder.eval-vector-contract.v1",
    status: "passed",
    controls: {
      // Structurally verified by checkCorrectnessBoundary below, not asserted.
      observationOnly: true,
      correctnessBoundary: boundary,
      planHealthIsUiProjectionOnly: true,
      planHealthIsNotAProbability: true,
      boundsPassIsNotARouteWitness: true,
      projectedCompletionIsNotProductionGoalReached: true,
    },
    syntheticMargins: checkSyntheticMargins(),
    failClosedApi: checkFailClosedApi(),
    nonProjectableGoal: checkNonProjectableGoalIsNotReached(),
    feasibilityStates: checkFeasibilityIsThreeState(),
    terminalStage: checkTerminalStageHealth(),
    trackedMt5Chain: checkTrackedMt5Chain(),
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main };
