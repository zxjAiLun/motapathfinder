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
 * HARD BOUNDARY: nothing in this module may reach the DP key, same-key
 * dominance, the agenda, candidate capacity, or any correctness pruning.  The
 * vector is read after the fact by audits and UI.  `projectPlanHealthForUi()`
 * is explicitly a display compression and is not a search quantity.
 */

const { compileAdmissibleFeasibilityBounds } = require("./goal-feasibility-bounds");

const EVAL_SCHEMA = "motapathfinder.eval.v1";

const STAT_REQUIREMENT_KINDS = ["hero-min", "effective-hero-min"];

/**
 * Stages counted as "near-term" when naming the bottleneck: the current
 * milestone plus the next one.  Taking the min over every remaining stage
 * instead reads as distance-to-endgame, not resource safety -- on the tracked
 * MT5 chain the whole-horizon min lands on an MT6 level requirement 6 milestones
 * out, which says nothing about whether the next gate is passable.  The full
 * horizon is still reported under `fullHorizon` so nothing is silently
 * truncated.
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

/**
 * Per (stage, stat field) margin over every remaining stage, including the
 * current one.  Margins are signed absolute differences, not ratios: a route
 * may legitimately shed HP between milestones while ATK/DEF/EXP must keep
 * climbing, and only the signed per-field view shows that.
 */
function collectResourceMargins(stages, state, currentIndex, horizon) {
  const margins = [];
  const limit = Number.isFinite(horizon) ? currentIndex + Math.max(1, horizon) - 1 : Infinity;
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

function summarizeFeasibility(project, segment, state) {
  if (!segment) {
    return { verdict: "unknown", reason: "no-segment-supplied", evidence: null };
  }
  const compiled = compileAdmissibleFeasibilityBounds(project, segment);
  const verdict = compiled.evaluate(state);
  if (verdict.feasible === false) {
    return {
      verdict: "proven-impossible",
      reason: verdict.reason,
      current: verdict.current,
      target: verdict.target,
      bound: verdict.bound,
      witness: verdict.witness || null,
      evidence: compiled.evidence,
    };
  }
  // `unknown: true` means the segment declared no admissible bounds at all, so
  // "no necessary condition was violated" is vacuous.  Never report that as
  // viable -- an unconfigured milestone is not a cleared one.
  if (verdict.unknown === true) {
    return {
      verdict: "unknown",
      reason: "no-admissible-bounds-declared",
      evidence: compiled.evidence,
    };
  }
  return {
    verdict: "viable",
    reason: "no-necessary-condition-violation",
    evidence: compiled.evidence,
  };
}

function resolveStageIndex(stages, currentSegmentId) {
  const stage = stages.find((entry) => entry.id === currentSegmentId);
  return stage ? stage.index : 0;
}

/**
 * @param {object} project loaded h5mota project
 * @param {object} state solver state to evaluate
 * @param {object} options
 * @param {object} options.goalDependencyGraph compiled graph (required)
 * @param {string} [options.currentSegmentId] defaults to the first stage
 * @param {object} [options.segment] segment whose admissible bounds to evaluate
 * @param {number} [options.marginHorizon] stages counted for the bottleneck
 */
function computeEvalVector(project, state, options) {
  const config = options || {};
  const graph = config.goalDependencyGraph;
  if (!graph || !Array.isArray(graph.stages)) {
    throw new Error("computeEvalVector requires a compiled goalDependencyGraph");
  }
  const currentSegmentId = config.currentSegmentId != null
    ? config.currentSegmentId
    : (graph.stages[0] && graph.stages[0].id) || null;
  const currentIndex = resolveStageIndex(graph.stages, currentSegmentId);
  const projection = graph.project(state, currentSegmentId);
  const segment = config.segment ||
    (graph.stages[currentIndex] && graph.stages[currentIndex].segment) ||
    null;

  const horizon = Math.max(1, number(config.marginHorizon, DEFAULT_MARGIN_HORIZON));
  const margins = collectResourceMargins(graph.stages, state, currentIndex, horizon);
  const bottleneck = selectBottleneck(margins);
  const unmet = margins.filter((entry) => !entry.met);
  const fullHorizonMargins = collectResourceMargins(graph.stages, state, currentIndex, Infinity);
  const fullHorizonBottleneck = selectBottleneck(fullHorizonMargins);
  const feasibility = summarizeFeasibility(project, segment, state);

  return {
    schema: EVAL_SCHEMA,
    currentSegmentId,
    floorId: (state || {}).floorId || null,
    feasibility,
    currentGoal: {
      segmentId: currentSegmentId,
      completion: projection.completion,
      requirementsMet: projection.requirementsMet,
      requirementsTotal: projection.requirementsTotal,
      floorMatch: projection.floorMatch,
      reached: projection.completion >= 1,
      missingProtectedTiles: projection.missingProtectedTiles || [],
    },
    downstream: {
      stageCount: projection.dependencyStageCount,
      completion: projection.downstreamCompletion,
      requirementsMet: projection.downstreamRequirementsMet,
      requirementsTotal: projection.downstreamRequirementsTotal,
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
      horizon,
      criticalRatio: bottleneck ? bottleneck.ratio : 1,
      bottleneck,
      unmetCount: unmet.length,
      requirementCount: margins.length,
      margins,
      // Reported so a near-term-clean state cannot hide a late-route wall.
      fullHorizon: {
        criticalRatio: fullHorizonBottleneck ? fullHorizonBottleneck.ratio : 1,
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
    };
  }
  const components = {
    currentGoal: vector.currentGoal.completion,
    downstream: vector.downstream.completion,
    resourceSafety: vector.resources.criticalRatio,
  };
  const values = Object.values(components);
  const score = Math.round(
    (values.reduce((sum, value) => sum + value, 0) / values.length) * 100,
  );
  return {
    score,
    band: vector.feasibility.verdict === "unknown" ? "unknown-evidence" : "viable",
    uiProjectionOnly: true,
    components,
  };
}

module.exports = {
  DEFAULT_MARGIN_HORIZON,
  EVAL_SCHEMA,
  collectResourceMargins,
  computeEvalVector,
  projectPlanHealthForUi,
  selectBottleneck,
};
