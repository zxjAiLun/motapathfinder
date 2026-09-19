"use strict";

// Repair evidence and intent construction only: no branch lifecycle or scheduler.
const { buildCounterfactualRepairIntents } = require("../counterfactual-repair");

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * PR-5.27e - Failure-conditioned resource-repair trigger.
 *
 * A branch qualifies for resource-repair experiments ONLY when the normal
 * dependency planner has no executable prerequisite AND the blocking evidence is
 * a battle-feasibility failure with the CURRENT resources
 * (`unbeatable-at-current-stats` / `lethal-at-current-hp`).
 *
 * Deliberately narrow: if any alternative exposes an executable/complete leading
 * prerequisite, repair MUST NOT activate, otherwise the planner degenerates into
 * "always farm resources first".
 */
const RESOURCE_REPAIR_TRIGGER_STATUSES = new Set([
  "unbeatable-at-current-stats",
  "lethal-at-current-hp",
]);

/**
 * PR-5.27f - Same-prerequisite identity.
 *
 * A conversion claim is only meaningful for ONE specific battle: the same
 * prerequisite node, on the same floor, at the same coordinate. Statuses alone
 * cannot carry that, because the replan may surface an entirely different
 * battle that happens to be viable.
 */
function prerequisiteIdentityOf(identity) {
  if (!identity) return null;
  const sourceNodeId = identity.sourceNodeId != null
    ? String(identity.sourceNodeId)
    : (identity.prerequisiteId != null ? String(identity.prerequisiteId) : null);
  if (sourceNodeId == null) return null;
  const floorId = identity.floorId != null ? String(identity.floorId) : null;
  const x = identity.x == null ? null : number(identity.x, null);
  const y = identity.y == null ? null : number(identity.y, null);
  return [
    sourceNodeId,
    floorId == null ? "-" : floorId,
    x == null || y == null ? "-" : `${x},${y}`,
  ].join("|");
}

/** Normalizes either planner shape into `{ sourceNodeId, floorId, x, y }`. */
function normalizePrerequisiteIdentity(source) {
  if (!source) return null;
  const target = source.target || {};
  const sourceNodeId = source.sourceNodeId != null
    ? String(source.sourceNodeId)
    : (source.prerequisiteId != null ? String(source.prerequisiteId) : null);
  if (sourceNodeId == null) return null;
  const floorId = source.floorId != null
    ? source.floorId
    : (source.targetFloorId != null ? source.targetFloorId : (target.floorId != null ? target.floorId : null));
  const x = source.x != null ? number(source.x, null)
    : (source.targetX != null ? number(source.targetX, null) : (target.x != null ? number(target.x, null) : null));
  const y = source.y != null ? number(source.y, null)
    : (source.targetY != null ? number(source.targetY, null) : (target.y != null ? number(target.y, null) : null));
  return { sourceNodeId, floorId: floorId == null ? null : String(floorId), x, y };
}

function evaluateResourceRepairTrigger(evaluation) {
  if (!evaluation || evaluation.canAdvance) {
    return {
      triggered: false,
      reason: "normal-dependency-can-advance",
      blockedStatuses: [],
      blockedPrerequisites: [],
    };
  }
  if (evaluation.feedbackClass !== "no-currently-executable-leading-prerequisite") {
    return {
      triggered: false,
      reason: "blocked-for-a-non-viability-reason",
      blockedStatuses: [],
      blockedPrerequisites: [],
    };
  }
  const blockedStatuses = [];
  const blockedPrerequisites = [];
  for (const alternative of evaluation.alternatives || []) {
    const leading = alternative.leadingPrerequisite || null;
    const status = ((leading || {}).evidence || {}).status
      || alternative.leadingStatus
      || null;
    if (!status || !RESOURCE_REPAIR_TRIGGER_STATUSES.has(status)) continue;
    blockedStatuses.push(status);
    const normalized = normalizePrerequisiteIdentity(leading);
    blockedPrerequisites.push({
      ...(normalized || { sourceNodeId: null, floorId: null, x: null, y: null }),
      kind: leading ? (leading.kind || null) : null,
      alternativeId: alternative.alternativeId || null,
      statusBefore: status,
      identity: prerequisiteIdentityOf(normalized),
      evidenceBefore: leading ? { ...(leading.evidence || {}) } : null,
    });
  }
  if (blockedStatuses.length === 0) {
    return {
      triggered: false,
      reason: "no-battle-feasibility-blocked-prerequisite",
      blockedStatuses,
      blockedPrerequisites,
    };
  }
  return {
    triggered: true,
    reason: "battle-prerequisite-unattainable-with-current-resources",
    blockedStatuses,
    blockedPrerequisites,
  };
}

/**
 * PR-5.27f - Battle-relevance gate (narrow, first version).
 *
 * A battle-feasibility repair must make POSITIVE PERSISTENT COMBAT RESOURCE
 * PROGRESS: ATK / DEF / MDEF / HP / LV / EXP / equipment. Deliberately NOT a
 * scalar score and NOT a general "usefulness" filter: money, inventory and
 * multi-step EXP preparation all stay allowed.
 *
 * The single rejected shape is the one actually observed in 5.27e (70 of 73
 * selections): a pure path/unlock whose combat-resource delta is entirely zero,
 * which can be re-generated at every new exact state without ever touching the
 * battle that triggered the repair.
 */
function isBattleRelevantRepairIntent(intent) {
  const delta = (intent || {}).structuralDelta || {};
  const combatGain = number(delta.atk, 0) > 0
    || number(delta.def, 0) > 0
    || number(delta.mdef, 0) > 0
    || number(delta.hp, 0) > 0
    || number(delta.lv, 0) > 0
    || number(delta.exp, 0) > 0
    || (Array.isArray(delta.equipment) && delta.equipment.length > 0);
  if (combatGain) return { relevant: true, reason: "positive-combat-resource-delta" };
  const kind = String((intent || {}).kind || "");
  if (kind === "path/unlock" || /path|unlock/.test(kind)) {
    return { relevant: false, reason: "pure-path-unlock-without-combat-resource-delta" };
  }
  return { relevant: true, reason: "non-path-intent-retained" };
}

/**
 * Re-reads the SAME prerequisite identities from a replanned evaluation.
 * Reuses the planner's own battle-evidence objects; this never recomputes
 * damage, it only reports what the planner already decided.
 */
function collectReplannedPrerequisiteStatuses(afterEvaluation) {
  const statuses = new Map();
  const plan = afterEvaluation && afterEvaluation.context ? afterEvaluation.context.plan : null;
  for (const alternative of ((plan || {}).alternatives || [])) {
    for (const prereq of (alternative.prerequisites || [])) {
      const identity = prerequisiteIdentityOf(normalizePrerequisiteIdentity(prereq));
      if (!identity) continue;
      const status = ((prereq.evidence || {}).status) || "complete";
      const previous = statuses.get(identity);
      if (previous === "viable-at-current-state") continue;
      statuses.set(identity, status);
    }
  }
  return statuses;
}

/**
 * PR-5.27g - Same as `collectReplannedPrerequisiteStatuses`, but keeps the
 * planner's own battle-evidence objects so the outcome classifier can compare
 * survival deficits. Never recomputes damage; reports what the planner decided.
 */
function collectReplannedPrerequisiteEvidence(afterEvaluation) {
  const evidence = new Map();
  const plan = afterEvaluation && afterEvaluation.context ? afterEvaluation.context.plan : null;
  for (const alternative of ((plan || {}).alternatives || [])) {
    for (const prereq of (alternative.prerequisites || [])) {
      const identity = prerequisiteIdentityOf(normalizePrerequisiteIdentity(prereq));
      if (!identity) continue;
      const status = ((prereq.evidence || {}).status) || "complete";
      const previous = evidence.get(identity);
      if (previous && previous.status === "viable-at-current-state") continue;
      evidence.set(identity, { status, evidence: { ...((prereq || {}).evidence || {}) } });
    }
  }
  return evidence;
}

/**
 * survivalDeficit = damage - currentHp for a lethal blocker (smaller is better).
 * Null-safe: any missing side returns null and the classifier falls back to
 * status-only comparison instead of inventing a number.
 */
function survivalDeficitOf(battleEvidence) {
  const damage = number((battleEvidence || {}).damage, NaN);
  const currentHp = number((battleEvidence || {}).currentHp, NaN);
  if (!Number.isFinite(damage) || !Number.isFinite(currentHp)) return null;
  return damage - currentHp;
}

/**
 * PR-5.27g - Repair outcome against the SAME blocker identity.
 *
 *   CONVERTED   before unbeatable|lethal  -> after viable-at-current-state
 *   IMPROVED    lethal: survivalDeficit strictly decreased (still lethal)
 *               unbeatable -> lethal
 *   NO_PROGRESS same blocker evidence did not improve (incl. lethal with equal
 *               or worse deficit, unbeatable -> unbeatable, missing evidence)
 *   NOT_PRESENT identity absent from the replanned alternatives
 *
 * No scoring, no weights: these are the only classes and they are computed
 * purely from before/after status and the planner's own battle evidence.
 */
function classifyRepairOutcome({ beforeStatus, beforeEvidence, afterStatus, afterEvidence }) {
  if (afterStatus === "NOT_PRESENT_IN_REPLANNED_ALTERNATIVES") return "NOT_PRESENT";
  const before = String(beforeStatus || "");
  const after = String(afterStatus || "");
  if (RESOURCE_REPAIR_TRIGGER_STATUSES.has(before) && after === "viable-at-current-state") {
    return "CONVERTED";
  }
  if (before === "unbeatable-at-current-stats" && after === "lethal-at-current-hp") {
    return "IMPROVED";
  }
  if (before === "lethal-at-current-hp" && after === "lethal-at-current-hp") {
    const deficitBefore = survivalDeficitOf(beforeEvidence);
    const deficitAfter = survivalDeficitOf(afterEvidence);
    if (deficitBefore != null && deficitAfter != null && deficitAfter < deficitBefore) {
      return "IMPROVED";
    }
  }
  return "NO_PROGRESS";
}

/** Aggregate one repair attempt's per-identity outcomes into a single verdict. */
function aggregateRepairOutcome(identityOutcomes) {
  const outcomes = new Set(identityOutcomes || []);
  if (outcomes.size === 0) return null;
  if (outcomes.has("CONVERTED")) return "CONVERTED";
  if (outcomes.has("IMPROVED")) return "IMPROVED";
  if (outcomes.has("NO_PROGRESS")) return "NO_PROGRESS";
  return "NOT_PRESENT";
}

/**
 * Builds the conditionally generated resource-repair experiments for a blocked
 * checkpoint. Reuses the existing counterfactual repair generator rather than
 * inventing a weighted resource score.
 */
function buildResourceRepairExperiments({
  simulator,
  checkpoint,
  trigger,
  candidateLimit,
}) {
  if (!trigger || trigger.triggered !== true) return [];
  const intents = buildCounterfactualRepairIntents({
    simulator,
    startCandidates: [{ id: checkpoint.id, state: checkpoint.state }],
    triggerFailure: "unbeatable-battle-prerequisite",
    failedSegment: null,
    candidateLimit,
  });
  return intents.map((intent, index) => ({
    ...intent,
    experimentKind: "resource-repair",
    repairIndex: index,
    blockedStatuses: trigger.blockedStatuses.slice(),
    blockedPrerequisites: (trigger.blockedPrerequisites || []).map((entry) => ({ ...entry })),
    originCheckpointId: checkpoint.id,
  }));
}

module.exports = {
  RESOURCE_REPAIR_TRIGGER_STATUSES,
  aggregateRepairOutcome,
  classifyRepairOutcome,
  collectReplannedPrerequisiteEvidence,
  collectReplannedPrerequisiteStatuses,
  prerequisiteIdentityOf,
  normalizePrerequisiteIdentity,
  evaluateResourceRepairTrigger,
  isBattleRelevantRepairIntent,
  buildResourceRepairExperiments,
  survivalDeficitOf,
};
