"use strict";

const crypto = require("node:crypto");

const { buildFullStructuralAccessAttribution } = require("./strategic-dependency-attribution");

const PREREQUISITE_SCHEMA = "motapathfinder.strategic-battle-access-prerequisite.v1";

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}

function evaluateBattleViability(simulator, state, boundary) {
  if (!simulator || !simulator.battleResolver || typeof simulator.battleResolver.evaluateBattle !== "function") {
    return { supported: false, damage: null, heroHp: null, viable: false, reason: "battle-resolver-unavailable" };
  }
  const heroHp = Number((state.hero || {}).hp || 0);
  let evaluation;
  try {
    evaluation = simulator.battleResolver.evaluateBattle(
      state,
      boundary.floorId,
      boundary.x,
      boundary.y,
      boundary.enemyId,
    );
  } catch (error) {
    return { supported: false, damage: null, heroHp, viable: false, reason: error && error.message || "battle-evaluation-error" };
  }
  const damage = evaluation && evaluation.damageInfo && evaluation.damageInfo.damage != null
    ? Number(evaluation.damageInfo.damage)
    : null;
  return {
    supported: Boolean(evaluation && evaluation.supported),
    damage,
    heroHp,
    viable: Boolean(evaluation && evaluation.supported) && damage != null && damage < heroHp,
    reason: evaluation && evaluation.reason ? evaluation.reason : null,
  };
}

function buildBattleAccessCompletionPredicate(options) {
  const { simulator, boundary } = options;
  return function battleAccessCompletionPredicate(state) {
    return evaluateBattleViability(simulator, state, boundary).viable;
  };
}

/**
 * Compile exactly one layer: parent dependency T has a structural
 * firstObservedUnresolvedBoundary B that is currently battle-unsurvivable.
 * P(B) means "make this exact battle viable at the current exact state"; the
 * compiler does not predict any boundary after B.
 */
function compileBattleAccessPrerequisite(options) {
  const config = options || {};
  const {
    project,
    simulator,
    state,
    parentDependency,
    structuralAccess,
    sourceAttemptId,
    sourceExactStateFingerprint,
  } = config;
  if (!project || !simulator || !state || !parentDependency || !structuralAccess) {
    throw new Error("compileBattleAccessPrerequisite requires project, simulator, state, parentDependency, and structuralAccess");
  }
  const first = structuralAccess.firstObservedUnresolvedBoundary;
  if (!first || !first.exactStateClassification || first.exactStateClassification.kind !== "battle-unsurvivable") {
    return null;
  }
  const boundary = {
    floorId: first.floorId,
    x: first.x,
    y: first.y,
    enemyId: first.tileId || (first.exactStateClassification.target || {}).enemyId || null,
  };
  if (!boundary.floorId || boundary.x == null || boundary.y == null || !boundary.enemyId) {
    return null;
  }
  const viability = evaluateBattleViability(simulator, state, boundary);
  if (viability.viable) return null;
  const prerequisite = {
    schema: PREREQUISITE_SCHEMA,
    id: hash(`battle-access-prerequisite|${parentDependency.id}|${boundary.floorId}|${boundary.x},${boundary.y}|${boundary.enemyId}`),
    kind: "battle-access-prerequisite",
    capability: "survival",
    parentDependency: {
      id: parentDependency.id,
      kind: parentDependency.kind,
      capability: parentDependency.capability,
      target: parentDependency.target,
    },
    boundary,
    beforeViability: viability,
    completionPredicate: buildBattleAccessCompletionPredicate({
      simulator,
      boundary,
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
  buildBattleAccessCompletionPredicate,
  compileBattleAccessPrerequisite,
  evaluateBattleViability,
};
