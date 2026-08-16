"use strict";

const crypto = require("node:crypto");

const { getTileDefinitionAt } = require("./state");

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}

const PREREQUISITE_SCHEMA = {
  schema: "strategic-survival-opportunity-prerequisite",
  kind: "survival-opportunity-prerequisite",
  scope: "depth>0 lethal generic connector failure witness recovery",
};

function opportunityTargetSignature(target) {
  return [
    target.kind || "battle",
    target.floorId || "",
    target.x == null ? "" : target.x,
    target.y == null ? "" : target.y,
    target.enemyId || target.itemId || "",
  ].join("|");
}

function battleOpportunityConsumed(project, state, target) {
  if (!target || target.kind !== "battle") return false;
  const tile = getTileDefinitionAt(project, state, target.floorId, target.x, target.y);
  if (!tile) return true;
  if (target.enemyId && tile.id !== target.enemyId) return true;
  const enemyLike = Boolean(
    (typeof tile.cls === "string" && tile.cls.indexOf("enemy") === 0) ||
    (project.enemysById && tile.id && project.enemysById[tile.id]),
  );
  return !enemyLike;
}

function compileSurvivalOpportunityPrerequisite(options) {
  const config = options || {};
  const {
    project,
    parentDependency,
    boundary,
    witness,
    originFailedAttemptId,
    originContinuationId,
  } = config;
  if (!project || !parentDependency || !witness) return null;
  if (!(witness.deltaSurvivalMargin != null && witness.deltaSurvivalMargin > 0)) return null;
  if (!witness.action || witness.action.kind !== "battle") return null;
  const target = {
    kind: "battle",
    floorId: witness.action.floorId,
    x: witness.action.x,
    y: witness.action.y,
    enemyId: witness.action.enemyId || null,
  };
  if (target.floorId == null || target.x == null || target.y == null) return null;
  const targetSignature = opportunityTargetSignature(target);
  const prerequisiteId = hash([
    "survival-opportunity-prerequisite",
    parentDependency.id,
    boundary && boundary.floorId,
    boundary && boundary.x,
    boundary && boundary.y,
    boundary && boundary.enemyId,
    targetSignature,
  ].join("|"));
  return {
    schema: PREREQUISITE_SCHEMA.schema,
    kind: PREREQUISITE_SCHEMA.kind,
    id: prerequisiteId,
    parentDependency,
    boundary,
    target,
    targetSignature,
    selectionPolicy: "first-positive-named-opportunity-by-bfs-discovery",
    witnessBacked: true,
    originFailedAttemptId: originFailedAttemptId || null,
    originContinuationId: originContinuationId || null,
    witness,
    completionPredicate(state) {
      return battleOpportunityConsumed(project, state, target);
    },
  };
}

module.exports = {
  PREREQUISITE_SCHEMA,
  battleOpportunityConsumed,
  compileSurvivalOpportunityPrerequisite,
  opportunityTargetSignature,
};
