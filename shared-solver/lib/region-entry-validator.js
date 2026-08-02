"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { buildRegionMilestoneSpec } = require("./region-spec");

const SUPPORTED_GOAL_TYPES = new Set(["heroAtLeast", "bossDefeated", "tileRemoved"]);
const SUPPORTED_ACTION_KINDS = new Set([
  "battle",
  "pickup",
  "interactPickup",
  "equip",
  "openDoor",
  "useTool",
  "changeFloor",
  "floorFly",
  "event",
]);

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function addError(errors, code, detail) {
  if (errors.some((entry) => entry.code === code)) return;
  errors.push({ code, detail });
}

function pathIsParseable(filePath) {
  if (typeof filePath !== "string" || filePath.length === 0) return false;
  const parsed = path.parse(filePath);
  return Boolean(parsed.root && parsed.dir != null && parsed.base);
}

function extractGoalEntries(milestoneSpec) {
  return milestoneSpec && Array.isArray(milestoneSpec.milestones)
    ? milestoneSpec.milestones.map((milestone) => ({
      id: milestone.id,
      goal: milestone.goal || {},
      dp: milestone.dp || {},
      actionPolicy: milestone.actionPolicy || {},
      startFrom: milestone.startFrom || null,
    }))
    : [];
}

function checkMilestoneGraph(milestoneSpec, errors) {
  const milestones = extractGoalEntries(milestoneSpec);
  const ids = new Set();
  milestones.forEach((milestone) => {
    if (ids.has(milestone.id)) addError(errors, "duplicate-milestone-id", `duplicate milestone id: ${milestone.id}`);
    ids.add(milestone.id);
  });

  const edges = new Map();
  milestones.forEach((milestone) => {
    if (milestone.startFrom && !ids.has(milestone.startFrom)) {
      addError(errors, "dangling-startFrom", `${milestone.id} starts from missing milestone ${milestone.startFrom}`);
    }
    edges.set(milestone.id, milestone.startFrom || null);
  });

  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      addError(errors, "cyclic-milestone-dependency", `cycle reaches ${id}`);
      return;
    }
    visiting.add(id);
    const parent = edges.get(id);
    if (parent) visit(parent);
    visiting.delete(id);
    visited.add(id);
  }
  ids.forEach(visit);
}

function checkGoalTypes(milestoneSpec, errors) {
  extractGoalEntries(milestoneSpec).forEach((milestone) => {
    const type = milestone.goal && milestone.goal.type;
    if (!SUPPORTED_GOAL_TYPES.has(type)) {
      addError(errors, "unsupported-goal-type", `${milestone.id} uses unsupported goal type ${type || "<missing>"}`);
    }
  });
}

function projectFloorIds(project) {
  return new Set(Object.keys((project && project.floorsById) || {}));
}

function checkGoalFloors(milestoneSpec, floors, errors) {
  extractGoalEntries(milestoneSpec).forEach((milestone) => {
    const goal = milestone.goal || {};
    if (goal.floorId && !floors.has(goal.floorId)) {
      addError(errors, "unknown-floor", `${milestone.id} goal references unknown floor ${goal.floorId}`);
    }
    ["removedTiles", "anyRemovedTiles", "presentTiles", "preferredPresentTiles"].forEach((fieldName) => {
      (goal[fieldName] || []).forEach((tile) => {
        if (tile && tile.floorId && !floors.has(tile.floorId)) {
          addError(errors, "unknown-floor", `${milestone.id} goal.${fieldName} references unknown floor ${tile.floorId}`);
        }
      });
    });
  });
}

function checkMilestoneActionPolicies(milestoneSpec, scopeFloors, floors, errors) {
  extractGoalEntries(milestoneSpec).forEach((milestone) => {
    const policy = milestone.actionPolicy || {};
    if (policy.actionKinds != null && (!Array.isArray(policy.actionKinds) || policy.actionKinds.length === 0)) {
      addError(errors, "invalid-action-scope", `${milestone.id} actionKinds must be non-empty`);
    }
    (policy.actionKinds || []).forEach((actionKind) => {
      if (!SUPPORTED_ACTION_KINDS.has(actionKind)) {
        addError(errors, "unsupported-action-kind", `${milestone.id} uses unsupported action kind ${actionKind}`);
      }
    });
    (policy.allowedFloors || []).forEach((floorId) => {
      if (!scopeFloors.includes(floorId)) {
        addError(errors, "illegal-action-policy-floor", `${milestone.id} action policy floor ${floorId} is outside the region scope`);
      }
      if (!floors.has(floorId)) {
        addError(errors, "unknown-floor", `${milestone.id} action policy references unknown floor ${floorId}`);
      }
    });
  });
}

function checkPositiveBudget(budget, label, errors) {
  if (!budget || typeof budget !== "object") {
    addError(errors, "invalid-dp-budget", `${label} budget is missing`);
    return;
  }
  ["maxExpansions", "maxRuntimeMs"].forEach((field) => {
    const value = Number(budget[field]);
    if (!Number.isFinite(value) || value <= 0) {
      addError(errors, "invalid-dp-budget", `${label}.${field} must be finite and positive`);
    }
  });
}

function resolveBoundaryReferences(milestoneSpec, spec, errors) {
  const milestones = (milestoneSpec && milestoneSpec.milestones) || [];
  const ids = new Set(milestones.map((milestone) => milestone.id));
  const prefix = spec && spec.start && spec.start.milestonePrefix || null;
  const fromMilestoneId = spec && spec.fromMilestoneId || (prefix && prefix.toMilestoneId) || null;
  const toMilestoneId = spec && spec.toMilestoneId || null;
  if (prefix && typeof prefix.routeName !== "string" && !spec.milestoneRoute) {
    addError(errors, "invalid-start-checkpoint", "milestonePrefix.routeName is required when milestoneRoute is absent");
  }
  if (fromMilestoneId && !ids.has(fromMilestoneId)) {
    addError(errors, "unknown-start-checkpoint", `unknown from/prefix milestone ${fromMilestoneId}`);
  }
  if (toMilestoneId && !ids.has(toMilestoneId)) {
    addError(errors, "unknown-start-checkpoint", `unknown to milestone ${toMilestoneId}`);
  }
  const fromIndex = fromMilestoneId ? milestones.findIndex((milestone) => milestone.id === fromMilestoneId) : -1;
  const toIndex = toMilestoneId ? milestones.findIndex((milestone) => milestone.id === toMilestoneId) : -1;
  if (fromIndex >= 0 && toIndex >= 0 && fromIndex >= toIndex) {
    addError(errors, "invalid-milestone-range", `${fromMilestoneId} must precede ${toMilestoneId}`);
  }
  return {
    prefix: cloneJson(prefix),
    fromMilestoneId,
    toMilestoneId,
    fromIndex,
    toIndex,
    prefixResolved: !prefix || (!prefix.toMilestoneId || ids.has(prefix.toMilestoneId)) && (!prefix.fromMilestoneId || ids.has(prefix.fromMilestoneId)),
    rangeResolved: (!fromMilestoneId || fromIndex >= 0) && (!toMilestoneId || toIndex >= 0) && !(fromIndex >= 0 && toIndex >= 0 && fromIndex >= toIndex),
  };
}

function effectiveMilestones(milestoneSpec, spec) {
  const milestones = (milestoneSpec && milestoneSpec.milestones) || [];
  const prefix = spec && spec.start && spec.start.milestonePrefix;
  const fromId = spec && spec.fromMilestoneId || (prefix && prefix.toMilestoneId) || null;
  const toId = spec && spec.toMilestoneId || null;
  const fromIndex = fromId ? milestones.findIndex((milestone) => milestone.id === fromId) : -1;
  const toIndex = toId ? milestones.findIndex((milestone) => milestone.id === toId) : -1;
  const startIndex = fromIndex >= 0 ? fromIndex + 1 : 0;
  const endIndex = toIndex >= 0 ? toIndex : milestones.length - 1;
  if (startIndex > endIndex) return [];
  return milestones.slice(startIndex, endIndex + 1);
}

function effectiveActionScopeFloors(milestoneSpec, spec, scopeFloors) {
  const result = scopeFloors.slice();
  const prefix = spec && spec.start && spec.start.milestonePrefix;
  const fromId = spec && spec.fromMilestoneId || (prefix && prefix.toMilestoneId) || null;
  if (!fromId) return result;
  const boundary = ((milestoneSpec && milestoneSpec.milestones) || []).find((milestone) => milestone.id === fromId);
  const boundaryFloors = boundary && boundary.actionPolicy && boundary.actionPolicy.allowedFloors;
  (boundaryFloors || []).forEach((floorId) => {
    if (!result.includes(floorId)) result.push(floorId);
  });
  return result;
}

function buildStartCheckpoint(spec) {
  const start = spec && spec.start || {};
  const prefix = start.milestonePrefix || null;
  return {
    type: start.type || (prefix ? "milestonePrefix" : "initial"),
    floorId: start.floorId || null,
    routeFile: start.routeFile || null,
    routeName: prefix && prefix.routeName || null,
    fromMilestoneId: prefix && prefix.fromMilestoneId || null,
    toMilestoneId: prefix && prefix.toMilestoneId || null,
  };
}

function validateRegionEntryContract(spec, project, paths) {
  const errors = [];
  const input = paths || {};
  if (!spec || typeof spec !== "object") {
    addError(errors, "invalid-region-spec", "RegionSpec must be an object");
    return { valid: false, errors, milestoneSpec: null, effectiveMilestones: [], boundary: null };
  }

  if (!pathIsParseable(input.specFile)) addError(errors, "unparseable-input-path", "region spec path is not parseable");
  if (!pathIsParseable(input.projectRoot)) addError(errors, "unparseable-input-path", "project root path is not parseable");
  if (!pathIsParseable(input.outFile)) addError(errors, "unparseable-output-path", "output path is not parseable");
  if (!fs.existsSync(input.specFile || "")) addError(errors, "missing-input-path", `region spec does not exist: ${input.specFile}`);
  if (!fs.existsSync(input.projectRoot || "")) addError(errors, "missing-input-path", `project root does not exist: ${input.projectRoot}`);

  const floors = projectFloorIds(project);
  const scopeFloors = Array.isArray(spec.scope && spec.scope.floors) ? spec.scope.floors : [];
  scopeFloors.forEach((floorId) => {
    if (!floors.has(floorId)) addError(errors, "unknown-floor", `scope references unknown floor ${floorId}`);
  });
  const allowedFloors = Array.isArray(spec.actionPolicy && spec.actionPolicy.allowedFloors)
    ? spec.actionPolicy.allowedFloors
    : scopeFloors;
  allowedFloors.forEach((floorId) => {
    if (!scopeFloors.includes(floorId)) addError(errors, "illegal-action-policy-floor", `action policy floor ${floorId} is outside the region scope`);
    if (!floors.has(floorId)) addError(errors, "unknown-floor", `action policy references unknown floor ${floorId}`);
  });
  if (!Array.isArray(spec.actionPolicy && spec.actionPolicy.actionKinds) || spec.actionPolicy.actionKinds.length === 0) {
    addError(errors, "invalid-action-scope", "RegionSpec actionKinds must be non-empty");
  }
  (spec.actionPolicy && spec.actionPolicy.actionKinds || []).forEach((actionKind) => {
    if (!SUPPORTED_ACTION_KINDS.has(actionKind)) addError(errors, "unsupported-action-kind", `unsupported action kind ${actionKind}`);
  });

  checkPositiveBudget(spec.search && spec.search.dpBudget, `${spec.id || "region"}.search.dpBudget`, errors);

  const rawMilestones = Array.isArray(spec.segments)
    ? spec.segments.map((segment, index) => ({
      id: segment && segment.id || `${spec.id || "region"}-${index + 1}`,
      goal: segment && segment.goal || {},
      dp: segment && segment.dp || {},
      actionPolicy: segment && segment.actionPolicy || {},
      startFrom: segment && segment.startFrom || null,
    }))
    : null;
  if (rawMilestones) {
    const rawMilestoneSpec = { milestones: rawMilestones };
    checkMilestoneGraph(rawMilestoneSpec, errors);
    checkGoalTypes(rawMilestoneSpec, errors);
    checkGoalFloors(rawMilestoneSpec, floors, errors);
    const activeRawMilestones = effectiveMilestones(rawMilestoneSpec, spec);
    checkMilestoneActionPolicies({ milestones: activeRawMilestones }, effectiveActionScopeFloors(rawMilestoneSpec, spec, scopeFloors), floors, errors);
    rawMilestones.forEach((milestone) => checkPositiveBudget(milestone.dp, `${milestone.id}.dp`, errors));
  }

  let milestoneSpec = null;
  try {
    milestoneSpec = buildRegionMilestoneSpec(project, spec);
  } catch (error) {
    addError(errors, "invalid-milestone-graph", error.message);
  }

  const referenceSpec = milestoneSpec || (rawMilestones ? { milestones: rawMilestones } : null);
  let boundary = null;
  let activeEntries = [];
  if (referenceSpec) {
    checkMilestoneGraph(referenceSpec, errors);
    checkGoalTypes(referenceSpec, errors);
    checkGoalFloors(referenceSpec, floors, errors);
    boundary = resolveBoundaryReferences(referenceSpec, spec, errors);
    activeEntries = effectiveMilestones(referenceSpec, spec);
    checkMilestoneActionPolicies({ milestones: activeEntries }, effectiveActionScopeFloors(referenceSpec, spec, scopeFloors), floors, errors);
    activeEntries.forEach((milestone) => checkPositiveBudget(milestone.dp, `${milestone.id}.dp`, errors));
  }

  return {
    valid: errors.length === 0,
    errors,
    milestoneSpec,
    effectiveMilestones: activeEntries,
    boundary,
  };
}

module.exports = {
  SUPPORTED_ACTION_KINDS,
  SUPPORTED_GOAL_TYPES,
  buildStartCheckpoint,
  effectiveMilestones,
  validateRegionEntryContract,
};
