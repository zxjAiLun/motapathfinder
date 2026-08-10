"use strict";

/**
 * PR-5.6b observation-only Mota Eval vector.
 *
 * The eval vector is a projection of state that already exists: the goal
 * dependency graph (current/downstream completion, irreversible landmarks,
 * next-landmark reachability) plus the admissible-v1 feasibility bounds.  It
 * adds one thing the graph does not carry: per-stage, per-field resource
 * margins, so a bottleneck can be named rather than summed into one scalar.
 *
 * TRUTHFULNESS RULES (Repair 1).  Every number this module emits must be
 * either exact or explicitly marked as not-known:
 *
 *   - An unknown or mismatched segment id throws.  It never silently
 *     evaluates stage 0 under someone else's label.
 *   - `currentGoal.completion` is the graph PROJECTION, not the production
 *     goal predicate.  When a goal carries clauses the graph cannot project
 *     (actionSurvivable / resourceDeferral), `reached` is null, never true.
 *   - Passing admissible bounds is `bounds-pass`, not `viable`.  Necessary
 *     conditions that were never declared cannot be reported as satisfied.
 *   - Components that do not apply (no downstream stage, no stat requirement
 *     in horizon) are null and are excluded from the UI average, rather than
 *     being folded in as zero.
 *
 * HARD BOUNDARY: nothing in this module may reach the DP key, same-key
 * dominance, the agenda, candidate capacity, or any correctness pruning.  The
 * vector is read after the fact by audits and UI.  `projectPlanHealthForUi()`
 * is explicitly a display compression and is not a search quantity.
 */

const { compileAdmissibleFeasibilityBounds } = require("./goal-feasibility-bounds");

const EVAL_SCHEMA = "motapathfinder.eval.v1";

const STAT_REQUIREMENT_KINDS = ["hero-min", "effective-hero-min"];

/**
 * Goal clauses the production predicate (`missingGoalFields`) evaluates but the
 * goal dependency graph does not project.  Both need a simulator to resolve
 * battle damage/survivability, which the graph deliberately does not hold.  A
 * goal carrying any of these cannot be declared reached from projection alone.
 */
const NON_PROJECTABLE_GOAL_CLAUSES = ["actionSurvivable", "resourceDeferral"];

/**
 * Stages counted as "near-term" when naming the bottleneck: the current
 * milestone plus the next one.  Taking the min over every remaining stage
 * instead reads as distance-to-endgame, not resource safety -- on the tracked
 * MT5 chain the whole-horizon min lands on an MT6 level requirement 6
 * milestones out, which says nothing about whether the next gate is passable.
 * The full horizon is still reported under `fullHorizon` so nothing is
 * silently truncated.
 */
const DEFAULT_MARGIN_HORIZON = 2;

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function effectiveHeroValue(state, field) {
  const hero = (state || {}).hero || {};
  const flags = (state || {}).flags || {};
  return Math.floor(
    number(hero[field], 0) * number(flags[`__${field}_buff__`], 1),
  );
}

function actualStatValue(state, requirement) {
  if (requirement.kind === "effective-hero-min") {
    return effectiveHeroValue(state, requirement.field);
  }
  return number(((state || {}).hero || {})[requirement.field], 0);
}

function boundedRatio(actual, required) {
  const target = number(required, 0);
  if (target <= 0) return 1;
  return Math.max(0, Math.min(1, number(actual, 0) / target));
}

function statFieldLabel(requirement) {
  return requirement.kind === "effective-hero-min"
    ? `effective.${requirement.field}`
    : requirement.field;
}

function resolveMarginHorizon(value) {
  if (value == null) return DEFAULT_MARGIN_HORIZON;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(
      `marginHorizon must be a finite number >= 1, received ${JSON.stringify(value)}`,
    );
  }
  return Math.floor(parsed);
}

/**
 * Per (stage, stat field) margin over the stages inside the horizon, starting
 * at the current one.  Margins are signed absolute differences, not ratios: a
 * route may legitimately shed HP between milestones while ATK/DEF/EXP must keep
 * climbing, and only the signed per-field view shows that.
 */
function collectResourceMargins(stages, state, currentIndex, horizon) {
  const margins = [];
  const limit = Number.isFinite(horizon)
    ? currentIndex + Math.max(1, Math.floor(horizon)) - 1
    : Infinity;
  for (const stage of stages) {
    if (stage.index < currentIndex || stage.index > limit) continue;
    for (const requirement of stage.requirements || []) {
      if (!STAT_REQUIREMENT_KINDS.includes(requirement.kind)) continue;
      const required = number(requirement.required, 0);
      const actual = actualStatValue(state, requirement);
      margins.push({
        stageId: stage.id,
        stageIndex: stage.index,
        stagesAhead: stage.index - currentIndex,
        field: statFieldLabel(requirement),
        kind: requirement.kind,
        required,
        actual,
        margin: actual - required,
        ratio: boundedRatio(actual, required),
        met: actual >= required,
      });
    }
  }
  return margins;
}

/**
 * The bottleneck is the least-covered remaining requirement by ratio.  Ties
 * break toward the nearest stage, because a deficit two milestones out has
 * more route left in which to be closed than the same deficit right now.
 */
function selectBottleneck(margins) {
  let bottleneck = null;
  for (const entry of margins) {
    if (entry.met) continue;
    if (!bottleneck) {
      bottleneck = entry;
      continue;
    }
    if (entry.ratio < bottleneck.ratio) {
      bottleneck = entry;
      continue;
    }
    if (entry.ratio === bottleneck.ratio && entry.stagesAhead < bottleneck.stagesAhead) {
      bottleneck = entry;
    }
  }
  return bottleneck;
}

/**
 * Which goal clauses the graph projection actually covers.  Reported so a
 * consumer can tell "requirements satisfied" from "requirements checked".
 */
function summarizeGoalProjectionCoverage(segment) {
  const goal = (segment || {}).goal || {};
  const unprojectable = NON_PROJECTABLE_GOAL_CLAUSES.filter((clause) => goal[clause]);
  return {
    complete: unprojectable.length === 0,
    unprojectableClauses: unprojectable,
  };
}

/**
 * Which admissible-v1 necessary conditions the segment actually declared
 * evidence for.  `compileAdmissibleFeasibilityBounds` only reports `unknown`
 * when there is NO evidence at all, so a segment declaring (say) a complete
 * floor graph and nothing else would otherwise read as fully checked.
 */
function summarizeFeasibilityCoverage(segment, evidence) {
  const goal = (segment || {}).goal || {};
  const covered = [];
  const uncovered = [];
  const record = (condition, isCovered) =>
    (isCovered ? covered : uncovered).push(condition);

  if (goal.floorId) record(`floor:${goal.floorId}`, evidence.floorGraphComplete === true);
  for (const field of Object.keys(goal.minHero || {})) {
    record(
      `hero:${field}`,
      Object.prototype.hasOwnProperty.call(evidence.optimisticHeroGain || {}, field),
    );
  }
  for (const field of Object.keys(goal.minEffectiveHero || {})) {
    record(
      `effectiveHero:${field}`,
      Object.prototype.hasOwnProperty.call(evidence.optimisticEffectiveHeroGain || {}, field),
    );
  }
  for (const itemId of goal.equipmentIncludes || []) {
    record(`equipment:${itemId}`, (evidence.equipmentSourceItems || []).includes(String(itemId)));
  }
  // Protected present tiles need no declared evidence: the evaluator reads the
  // live tile directly, so declaring the goal clause is itself the evidence.
  for (const tile of goal.presentTiles || []) {
    record(`presentTile:${tile.floorId}:${tile.x},${tile.y}`, true);
  }

  return {
    coveredConditions: covered,
    uncoveredConditions: uncovered,
    evidenceCompleteForDeclaredGoal: uncovered.length === 0 && covered.length > 0,
  };
}

/**
 * Three-state feasibility.  `bounds-pass` deliberately does NOT mean viable:
 * admissible-v1 is a necessary-condition refuter, so passing it only means no
 * declared condition was violated.  Claiming a route exists needs a witness
 * (a successful downstream probe or a verified route), which this module does
 * not have.
 */
function summarizeFeasibility(project, segment, state) {
  if (!segment) {
    return {
      verdict: "unknown-evidence",
      reason: "no-segment-supplied",
      coveredConditions: [],
      uncoveredConditions: [],
      evidenceCompleteForDeclaredGoal: false,
      evidence: null,
    };
  }
  const compiled = compileAdmissibleFeasibilityBounds(project, segment);
  const verdict = compiled.evaluate(state);
  const coverage = summarizeFeasibilityCoverage(segment, compiled.evidence || {});
  if (verdict.feasible === false) {
    return {
      verdict: "proven-impossible",
      reason: verdict.reason,
      current: verdict.current,
      target: verdict.target,
      bound: verdict.bound,
      witness: verdict.witness || null,
      ...coverage,
      evidence: compiled.evidence,
    };
  }
  if (!coverage.evidenceCompleteForDeclaredGoal) {
    return {
      verdict: "unknown-evidence",
      reason: coverage.coveredConditions.length === 0
        ? "no-admissible-bounds-declared"
        : "admissible-bounds-incomplete-for-declared-goal",
      ...coverage,
      evidence: compiled.evidence,
    };
  }
  return {
    verdict: "bounds-pass",
    reason: "no-declared-necessary-condition-violated",
    ...coverage,
    evidence: compiled.evidence,
  };
}

function resolveStage(stages, currentSegmentId, provided) {
  if (stages.length === 0) {
    throw new Error("computeEvalVector requires a goalDependencyGraph with at least one stage");
  }
  if (!provided) return stages[0];
  const stage = stages.find((entry) => entry.id === currentSegmentId);
  if (!stage) {
    throw new Error(
      `Unknown eval segment ${JSON.stringify(currentSegmentId)}; known stages: ${
        stages.map((entry) => entry.id).join(", ")}`,
    );
  }
  return stage;
}

/**
 * @param {object} project loaded h5mota project
 * @param {object} state solver state to evaluate
 * @param {object} options
 * @param {object} options.goalDependencyGraph compiled graph (required)
 * @param {string} [options.currentSegmentId] defaults to the first stage
 * @param {object} [options.segment] must match currentSegmentId when supplied
 * @param {number} [options.marginHorizon] stages counted for the bottleneck
 */
function computeEvalVector(project, state, options) {
  const config = options || {};
  const graph = config.goalDependencyGraph;
  if (!graph || !Array.isArray(graph.stages)) {
    throw new Error("computeEvalVector requires a compiled goalDependencyGraph");
  }
  const stage = resolveStage(
    graph.stages,
    config.currentSegmentId,
    config.currentSegmentId != null,
  );
  const currentSegmentId = stage.id;
  const currentIndex = stage.index;
  // A caller-supplied segment that disagrees with the resolved stage would
  // produce a vector whose feasibility describes a different milestone than
  // its completion.  Refuse rather than emit the blend.
  if (config.segment && config.segment.id != null && config.segment.id !== currentSegmentId) {
    throw new Error(
      `segment ${JSON.stringify(config.segment.id)} does not match currentSegmentId ${
        JSON.stringify(currentSegmentId)}`,
    );
  }
  const projection = graph.project(state, currentSegmentId);
  const segment = config.segment || stage.segment || null;

  const horizon = resolveMarginHorizon(config.marginHorizon);
  const margins = collectResourceMargins(graph.stages, state, currentIndex, horizon);
  const bottleneck = selectBottleneck(margins);
  const fullHorizonMargins = collectResourceMargins(graph.stages, state, currentIndex, Infinity);
  const fullHorizonBottleneck = selectBottleneck(fullHorizonMargins);
  const feasibility = summarizeFeasibility(project, segment, state);
  const goalCoverage = summarizeGoalProjectionCoverage(segment);

  // `dependencyStageCount` counts the current stage too; downstream means
  // strictly after it.
  const downstreamStageCount = Math.max(0, projection.dependencyStageCount - 1);
  const downstreamApplicable = downstreamStageCount > 0;
  const resourceApplicable = margins.length > 0;

  return {
    schema: EVAL_SCHEMA,
    currentSegmentId,
    floorId: (state || {}).floorId || null,
    feasibility,
    currentGoal: {
      segmentId: currentSegmentId,
      projectedCompletion: projection.completion,
      requirementsMet: projection.requirementsMet,
      requirementsTotal: projection.requirementsTotal,
      floorMatch: projection.floorMatch,
      // Tri-state.  `null` means the production predicate checks clauses this
      // projection cannot see, so "reached" is genuinely not known here.
      reached: projection.completion >= 1
        ? (goalCoverage.complete ? true : null)
        : false,
      reachedReason: projection.completion >= 1 && !goalCoverage.complete
        ? "goal-not-fully-projectable"
        : null,
      projectionCoverage: goalCoverage,
      missingProtectedTiles: projection.missingProtectedTiles || [],
    },
    downstream: {
      applicable: downstreamApplicable,
      stageCount: downstreamStageCount,
      projectedCompletion: downstreamApplicable ? projection.downstreamCompletion : null,
      requirementsMet: downstreamApplicable ? projection.downstreamRequirementsMet : null,
      requirementsTotal: downstreamApplicable ? projection.downstreamRequirementsTotal : null,
    },
    landmarks: {
      irreversibleLandmarksMet: projection.irreversibleLandmarksMet,
      nextLandmarkReachable: projection.nextLandmarkReachable,
      nextLandmarkDistance: projection.nextLandmarkDistance,
    },
    resources: {
      // criticalRatio is the worst-covered stat requirement within the margin
      // horizon.  It is a min, not a blend, so the number always points at a
      // nameable witness.
      applicable: resourceApplicable,
      horizon,
      criticalRatio: resourceApplicable ? (bottleneck ? bottleneck.ratio : 1) : null,
      bottleneck,
      unmetCount: margins.filter((entry) => !entry.met).length,
      requirementCount: margins.length,
      margins,
      // Reported so a near-term-clean state cannot hide a late-route wall.
      fullHorizon: {
        criticalRatio: fullHorizonMargins.length > 0
          ? (fullHorizonBottleneck ? fullHorizonBottleneck.ratio : 1)
          : null,
        bottleneck: fullHorizonBottleneck,
        unmetCount: fullHorizonMargins.filter((entry) => !entry.met).length,
        requirementCount: fullHorizonMargins.length,
      },
    },
    statDeficit: projection.statDeficit,
  };
}

/**
 * UI-only compression of the vector into a 0-100 band.  This exists so the
 * display layer has one agreed formula instead of several ad-hoc ones; it is
 * NOT a probability, NOT a win rate, and must never enter the DP key,
 * dominance, agenda, candidate capacity, or any pruning decision.
 *
 * Only applicable components are averaged.  A final milestone has no
 * downstream stage, and folding that in as zero would cap a fully completed
 * plan at 67.
 */
function projectPlanHealthForUi(vector) {
  if (!vector || vector.schema !== EVAL_SCHEMA) {
    throw new Error("projectPlanHealthForUi requires a motapathfinder.eval.v1 vector");
  }
  if (vector.feasibility.verdict === "proven-impossible") {
    return {
      score: 0,
      band: "proven-impossible",
      uiProjectionOnly: true,
      components: null,
      appliedComponents: [],
    };
  }
  const components = {
    currentGoal: vector.currentGoal.projectedCompletion,
    downstream: vector.downstream.applicable ? vector.downstream.projectedCompletion : null,
    resourceSafety: vector.resources.applicable ? vector.resources.criticalRatio : null,
  };
  const applied = Object.entries(components).filter(([, value]) => value != null);
  const score = applied.length > 0
    ? Math.round(
      (applied.reduce((sum, [, value]) => sum + value, 0) / applied.length) * 100,
    )
    : null;
  return {
    score,
    band: vector.feasibility.verdict === "bounds-pass" ? "bounds-pass" : "unknown-evidence",
    uiProjectionOnly: true,
    components,
    appliedComponents: applied.map(([name]) => name),
  };
}

module.exports = {
  DEFAULT_MARGIN_HORIZON,
  EVAL_SCHEMA,
  NON_PROJECTABLE_GOAL_CLAUSES,
  collectResourceMargins,
  computeEvalVector,
  projectPlanHealthForUi,
  selectBottleneck,
  summarizeFeasibilityCoverage,
  summarizeGoalProjectionCoverage,
};
