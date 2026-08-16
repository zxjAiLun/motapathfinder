"use strict";

const crypto = require("node:crypto");

const { analyzeBattleViabilityBlocker } = require("./strategic-battle-viability");

const PREREQUISITE_SCHEMA = "motapathfinder.strategic-battle-stage-prerequisite.v1";

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}

function boundaryFromStructural(first) {
  const target = first && first.exactStateClassification && first.exactStateClassification.target;
  return {
    floorId: first.floorId,
    x: first.x,
    y: first.y,
    enemyId: first.tileId || (target && target.enemyId) || null,
  };
}

function buildBattleStageCompletionPredicate(options) {
  const { simulator, boundary, stageGoal } = options;
  return function battleStageCompletionPredicate(state) {
    const analysis = analyzeBattleViabilityBlocker(simulator, state, boundary);
    if (stageGoal === "damageable") {
      return analysis.stage === "lethal" || analysis.stage === "viable";
    }
    return false;
  };
}

/**
 * Compile exactly one battle-stage prerequisite. PR-5.19f first version only
 * supports:
 *
 *   attack-blocked -> make-damageable
 *
 * The parentDependency remains the original T, so the existing
 * parent-continuation machinery can be reused without a second stack.
 */
function compileBattleStagePrerequisite(options) {
  const config = options || {};
  const {
    project,
    simulator,
    state,
    parentDependency,
    structuralAccess,
    sourceAttemptId,
    sourceExactStateFingerprint,
    stageGoal,
  } = config;
  if (!project || !simulator || !state || !parentDependency || !structuralAccess) {
    throw new Error("compileBattleStagePrerequisite requires project, simulator, state, parentDependency, and structuralAccess");
  }
  const requestedStageGoal = stageGoal || "damageable";
  if (requestedStageGoal !== "damageable") return null;
  const first = structuralAccess.firstObservedUnresolvedBoundary;
  if (!first || !first.exactStateClassification || first.exactStateClassification.kind !== "battle-unsurvivable") {
    return null;
  }
  const boundary = boundaryFromStructural(first);
  if (!boundary.floorId || boundary.x == null || boundary.y == null || !boundary.enemyId) {
    return null;
  }
  const beforeAnalysis = analyzeBattleViabilityBlocker(simulator, state, boundary);
  if (beforeAnalysis.stage !== "attack-blocked") return null;
  const prerequisite = {
    schema: PREREQUISITE_SCHEMA,
    id: hash(`battle-stage-prerequisite|${parentDependency.id}|${boundary.floorId}|${boundary.x},${boundary.y}|${boundary.enemyId}|${requestedStageGoal}`),
    kind: "battle-stage-prerequisite",
    stageGoal: requestedStageGoal,
    capability: "damageability",
    parentDependency,
    boundary,
    beforeAnalysis,
    completionPredicate: buildBattleStageCompletionPredicate({
      simulator,
      boundary,
      stageGoal: requestedStageGoal,
    }),
    provenance: {
      sourceAttemptId: sourceAttemptId || null,
      sourceExactStateFingerprint: sourceExactStateFingerprint || null,
      structuralPathEvidence: structuralAccess.structuralMinimumPathBoundaries || [],
      firstObservedUnresolvedBoundary: {
        ...first,
        exactStateClassification: first.exactStateClassification,
      },
      topologicalModel: "static-grid-walk-adjacency-counterfactual",
      dynamicCausalProof: "not-proven",
      knownRouteUsed: false,
      authoredIdUsed: false,
    },
  };
  return prerequisite;
}

module.exports = {
  PREREQUISITE_SCHEMA,
  buildBattleStageCompletionPredicate,
  compileBattleStagePrerequisite,
};
