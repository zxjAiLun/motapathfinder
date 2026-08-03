"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { getMilestoneSpec, validateMilestoneSpec } = require("./milestone-spec");
const { normalizeSolverModel, validateSolverModel } = require("./solver-model");

const DEFAULT_SEARCH = {
  algorithm: "segment-dp",
  dpKeyMode: "region",
  candidateLimit: 8,
  stopOnFirstGoal: false,
};

const DEFAULT_ACTION_KINDS = ["battle", "pickup", "interactPickup", "equip", "openDoor", "useTool", "changeFloor", "floorFly", "event"];

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Failed to read region spec ${filePath}: ${error.message}`);
  }
}

function parseBoolean(value, fallback) {
  if (value == null) return fallback;
  if (value === true || value === "1" || value === "true" || value === "on") return true;
  if (value === false || value === "0" || value === "false" || value === "off") return false;
  return fallback;
}

function normalizeRegionSearch(spec) {
  const search = {
    ...DEFAULT_SEARCH,
    ...(spec.search || {}),
  };
  if (spec.dpKeyMode != null) search.dpKeyMode = spec.dpKeyMode;
  if (spec.candidateLimit != null) search.candidateLimit = Number(spec.candidateLimit);
  if (spec.stopOnFirstGoal != null) search.stopOnFirstGoal = parseBoolean(spec.stopOnFirstGoal, search.stopOnFirstGoal);
  if (spec.dpBudget || spec.searchBudget) {
    search.dpBudget = {
      ...(spec.dpBudget || {}),
      ...(spec.searchBudget || {}),
      ...((search || {}).dpBudget || {}),
    };
  }
  search.candidateLimit = Number.isFinite(Number(search.candidateLimit)) ? Number(search.candidateLimit) : DEFAULT_SEARCH.candidateLimit;
  search.stopOnFirstGoal = parseBoolean(search.stopOnFirstGoal, DEFAULT_SEARCH.stopOnFirstGoal);
  return search;
}

function normalizeRegionSpec(rawSpec, sourceFile) {
  const spec = cloneJson(rawSpec || {});
  spec.sourceFile = sourceFile || spec.sourceFile || null;
  spec.search = normalizeRegionSearch(spec);
  spec.rank = spec.rank || "chaos";
  spec.start = spec.start || { type: "initial" };
  spec.scope = spec.scope || {};
  if (spec.model == null && spec.solverModel != null) spec.model = spec.solverModel;
  delete spec.solverModel;
  if (spec.model != null) spec.model = normalizeSolverModel(spec.model);
  spec.actionPolicy = {
    actionKinds: DEFAULT_ACTION_KINDS.slice(),
    ...(spec.actionPolicy || {}),
  };
  if (!spec.actionPolicy.allowedFloors && Array.isArray(spec.scope.floors)) {
    spec.actionPolicy.allowedFloors = spec.scope.floors.slice();
  }
  spec.resourceTimingPolicy = spec.resourceTimingPolicy || {
    mode: "unspecified",
  };
  spec.expectedRegressionTraps = Array.isArray(spec.expectedRegressionTraps)
    ? spec.expectedRegressionTraps
    : [];
  return spec;
}

function validateGoalLike(goal, prefix, errors) {
  if (!goal || typeof goal !== "object") {
    errors.push(`${prefix}: goal is required`);
    return;
  }
  if (!goal.type || typeof goal.type !== "string") errors.push(`${prefix}: goal.type is required`);
  if (goal.floorId != null && typeof goal.floorId !== "string") errors.push(`${prefix}: goal.floorId must be a string`);
  if ((goal.type === "bossDefeated" || goal.type === "tileRemoved") && (goal.x == null || goal.y == null)) {
    errors.push(`${prefix}: ${goal.type} goal must include x/y`);
  }
}

function validateRegionSpec(spec) {
  const errors = [];
  if (!spec || typeof spec !== "object") throw new Error("RegionSpec must be an object");
  if (!spec.id || typeof spec.id !== "string") errors.push("RegionSpec.id is required");
  if (!spec.tower || typeof spec.tower !== "string") errors.push(`${spec.id || "unknown"}: tower is required`);
  if (!spec.rank || typeof spec.rank !== "string") errors.push(`${spec.id || "unknown"}: rank is required`);
  if (!spec.start || typeof spec.start !== "object") errors.push(`${spec.id || "unknown"}: start is required`);
  if (!spec.scope || !Array.isArray(spec.scope.floors) || spec.scope.floors.length === 0) {
    errors.push(`${spec.id || "unknown"}: scope.floors must be a non-empty array`);
  }
  if (!spec.search || spec.search.algorithm !== "segment-dp") {
    errors.push(`${spec.id || "unknown"}: search.algorithm must be segment-dp`);
  }
  if (!["region", "location", "mutation"].includes(String((spec.search || {}).dpKeyMode || ""))) {
    errors.push(`${spec.id || "unknown"}: search.dpKeyMode must be region/location/mutation`);
  }
  if (!Number.isFinite(Number((spec.search || {}).candidateLimit)) || Number((spec.search || {}).candidateLimit) < 1) {
    errors.push(`${spec.id || "unknown"}: search.candidateLimit must be positive`);
  }
  if (!Array.isArray((spec.actionPolicy || {}).actionKinds) || spec.actionPolicy.actionKinds.length === 0) {
    errors.push(`${spec.id || "unknown"}: actionPolicy.actionKinds must be a non-empty array`);
  }
  if (!spec.milestoneRoute && !Array.isArray(spec.segments)) {
    validateGoalLike(spec.goal, spec.id || "unknown", errors);
  }
  if (Array.isArray(spec.segments)) {
    spec.segments.forEach((segment, index) => validateGoalLike(segment.goal, `${spec.id}/segments[${index}]`, errors));
  }
  if (!spec.resourceTimingPolicy || typeof spec.resourceTimingPolicy !== "object") {
    errors.push(`${spec.id || "unknown"}: resourceTimingPolicy is required`);
  }
  if (spec.model != null) {
    try {
      validateSolverModel(spec.model);
    } catch (error) {
      errors.push(`${spec.id || "unknown"}: ${error.message}`);
    }
  }
  if (!Array.isArray(spec.expectedRegressionTraps) || spec.expectedRegressionTraps.length === 0) {
    errors.push(`${spec.id || "unknown"}: expectedRegressionTraps must be a non-empty array`);
  }
  if (errors.length > 0) {
    throw new Error(`Invalid RegionSpec:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }
  return true;
}

function loadRegionSpec(filePath) {
  const resolved = path.resolve(filePath);
  const spec = normalizeRegionSpec(readJson(resolved), resolved);
  validateRegionSpec(spec);
  return spec;
}

function normalizeDirectRegionMilestoneSpec(project, regionSpec) {
  const segments = Array.isArray(regionSpec.segments) && regionSpec.segments.length > 0
    ? regionSpec.segments
    : [{
      id: `${regionSpec.id}-goal`,
      label: regionSpec.label || regionSpec.id,
      goal: regionSpec.goal,
      actionPolicy: regionSpec.actionPolicy,
      dp: regionSpec.dp,
    }];
  const spec = {
    routeName: regionSpec.id,
    milestones: segments.map((segment, index) => ({
      id: segment.id || `${regionSpec.id}-${index + 1}`,
      label: segment.label || segment.id || `${regionSpec.id} segment ${index + 1}`,
      startFrom: segment.startFrom || (index > 0 ? (segments[index - 1].id || `${regionSpec.id}-${index}`) : undefined),
      goal: segment.goal || {},
      actionPolicy: {
        allowedFloors: ((segment.actionPolicy || {}).allowedFloors) || ((regionSpec.scope || {}).floors),
        actionKinds: regionSpec.actionPolicy.actionKinds,
        ...(regionSpec.actionPolicy || {}),
        ...(segment.actionPolicy || {}),
      },
      dp: {
        keyMode: regionSpec.search.dpKeyMode,
        stopOnFirstGoal: regionSpec.search.stopOnFirstGoal,
        ...(regionSpec.search.dpBudget || {}),
        ...(regionSpec.dp || {}),
        ...(segment.dp || {}),
      },
    })),
  };
  validateMilestoneSpec(spec);
  spec.projectTitle = project && project.data && project.data.firstData ? project.data.firstData.title : null;
  return spec;
}

function buildRegionMilestoneSpec(project, regionSpec) {
  if (regionSpec.milestoneRoute) return getMilestoneSpec(project, regionSpec.milestoneRoute);
  return normalizeDirectRegionMilestoneSpec(project, regionSpec);
}

function iterAttemptDpDiagnostics(result) {
  const items = [];
  for (const segment of (result || {}).segmentResults || []) {
    for (const attempt of segment.attempts || []) {
      const dp = ((attempt.diagnostics || {}).dp) || {};
      items.push({
        segmentId: segment.segmentId,
        label: segment.label,
        found: attempt.found,
        dp,
      });
    }
  }
  return items;
}

function buildRegionProofClaim(result, regionSpec) {
  const attempts = iterAttemptDpDiagnostics(result);
  const actionTrimmed = attempts.reduce((sum, attempt) => sum + Number(attempt.dp.actionTrimmed || 0), 0);
  const stoppedReasons = attempts
    .map((attempt) => attempt.dp.stoppedReason)
    .filter(Boolean);
  const expansionBudgetExhaustedSegments = attempts
    .filter((attempt) => attempt.dp.expansionBudgetExhausted)
    .map((attempt) => attempt.segmentId);
  const stopOnFirstGoalSegments = attempts
    .filter((attempt) => attempt.dp.stopOnFirstGoal)
    .map((attempt) => attempt.segmentId);
  const finalSegmentId = ((result || {}).reachedMilestone) || regionSpec.toMilestoneId || null;
  const unsafeStopOnFirstGoalSegments = stopOnFirstGoalSegments
    .filter((segmentId) => segmentId !== finalSegmentId);
  const completeWithinActionSet = actionTrimmed === 0 &&
    stoppedReasons.length === 0 &&
    expansionBudgetExhaustedSegments.length === 0 &&
    unsafeStopOnFirstGoalSegments.length === 0;
  const proofLevel = !result || !result.found
    ? "not-found"
    : completeWithinActionSet
      ? "bounded-complete"
      : "candidate";
  const notes = [];
  if (actionTrimmed > 0) notes.push("actionTrimmed > 0: action cap affected completeness");
  if (stoppedReasons.length > 0) notes.push(`stoppedReason present: ${[...new Set(stoppedReasons)].join(",")}`);
  if (expansionBudgetExhaustedSegments.length > 0) notes.push(`expansion budget exhausted: ${[...new Set(expansionBudgetExhaustedSegments)].join(",")}`);
  if (unsafeStopOnFirstGoalSegments.length > 0) notes.push(`non-final stopOnFirstGoal=true: ${[...new Set(unsafeStopOnFirstGoalSegments)].join(",")}`);
  return {
    found: Boolean(result && result.found),
    proofLevel,
    completeWithinActionSet,
    actionTrimmed,
    stoppedReasons: [...new Set(stoppedReasons)],
    expansionBudgetExhausted: expansionBudgetExhaustedSegments.length > 0,
    expansionBudgetExhaustedSegments: [...new Set(expansionBudgetExhaustedSegments)],
    stopOnFirstGoalSegments: [...new Set(stopOnFirstGoalSegments)],
    unsafeStopOnFirstGoal: unsafeStopOnFirstGoalSegments.length > 0,
    unsafeStopOnFirstGoalSegments: [...new Set(unsafeStopOnFirstGoalSegments)],
    notes,
  };
}

module.exports = {
  DEFAULT_SEARCH,
  buildRegionMilestoneSpec,
  buildRegionProofClaim,
  loadRegionSpec,
  normalizeRegionSpec,
  validateRegionSpec,
};
