"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");

const { normalizeRegionSpec, validateRegionSpec } = require("./region-spec");
const { compileObjectiveSpec } = require("./objective-spec");
const { normalizeSolverModel, SOLVER_MODEL_SCHEMA } = require("./solver-model");
const { loadProject } = require("./project-loader");
const { buildProjectFingerprint } = require("./region-entry-validator");

const SOLVE_TASK_SCHEMA = "motapathfinder.solve-task.v1";
const SUPPORTED_ALGORITHMS = ["segment-dp"];

const DEFAULT_SEARCH = {
  algorithm: "segment-dp",
  maxExpansions: 50000,
  maxRuntimeMs: 0,
  maxActionsPerState: 256,
  candidateLimit: 8,
  goalSkylineLimit: 8,
  dpSkylineMax: 1,
  stopOnFirstGoal: false,
};

// Search fields that participate in the task fingerprint.  Fields that are
// purely local (absolute project root, labels, output paths) are excluded.
const FINGERPRINT_SEARCH_FIELDS = [
  "algorithm",
  "maxExpansions",
  "maxRuntimeMs",
  "maxActionsPerState",
  "candidateLimit",
  "goalSkylineLimit",
  "dpSkylineMax",
  "stopOnFirstGoal",
  "dpKeyMode",
];

class SolveTaskError extends Error {
  constructor(code, message, path) {
    super(message);
    this.name = "SolveTaskError";
    this.code = code;
    this.path = path || null;
  }
}

function fail(code, message, path) {
  throw new SolveTaskError(code, message, path);
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableValue(value[key]);
    return result;
  }, {});
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function fingerprintJson(value) {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex").slice(0, 16);
}

function finiteNumber(value, label, minInclusive) {
  if (value == null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    fail("INVALID_TASK", `${label} must be a finite number`, label);
  }
  if (minInclusive != null && parsed < minInclusive) {
    fail("INVALID_TASK", `${label} must be >= ${minInclusive}`, label);
  }
  return parsed;
}

// External JSON input must never be trusted as already-compiled.  The internal
// compiled marker is only meaningful for objects built inside this process.
function stripExternalCompiledMarker(value) {
  const copy = cloneJson(value);
  if (copy && typeof copy === "object") delete copy.compiled;
  return copy;
}

function normalizeSearch(rawSearch) {
  const search = { ...DEFAULT_SEARCH, ...(rawSearch || {}) };
  if (!SUPPORTED_ALGORITHMS.includes(String(search.algorithm || ""))) {
    fail("INVALID_TASK", `search.algorithm must be one of ${SUPPORTED_ALGORITHMS.join(", ")}`, "search.algorithm");
  }
  // maxExpansions=0 is rejected: searchDP would execute it as 1000, so the
  // fingerprint would not match the real execution budget.
  search.maxExpansions = finiteNumber(search.maxExpansions, "search.maxExpansions", 1) ?? DEFAULT_SEARCH.maxExpansions;
  search.maxRuntimeMs = finiteNumber(search.maxRuntimeMs, "search.maxRuntimeMs", 0) ?? DEFAULT_SEARCH.maxRuntimeMs;
  search.maxActionsPerState = finiteNumber(search.maxActionsPerState, "search.maxActionsPerState", 1) ?? DEFAULT_SEARCH.maxActionsPerState;
  search.candidateLimit = finiteNumber(search.candidateLimit, "search.candidateLimit", 1) ?? DEFAULT_SEARCH.candidateLimit;
  search.goalSkylineLimit = finiteNumber(search.goalSkylineLimit, "search.goalSkylineLimit", 1) ?? DEFAULT_SEARCH.goalSkylineLimit;
  search.dpSkylineMax = finiteNumber(search.dpSkylineMax, "search.dpSkylineMax", 1) ?? DEFAULT_SEARCH.dpSkylineMax;
  if (search.stopOnFirstGoal != null) search.stopOnFirstGoal = Boolean(search.stopOnFirstGoal);
  if (search.dpKeyMode != null && !["region", "location", "mutation"].includes(String(search.dpKeyMode))) {
    fail("INVALID_TASK", `search.dpKeyMode must be region/location/mutation`, "search.dpKeyMode");
  }
  if (search.actionPolicy != null) {
    if (typeof search.actionPolicy !== "object" || Array.isArray(search.actionPolicy)) {
      fail("INVALID_TASK", "search.actionPolicy must be an object", "search.actionPolicy");
    }
    if (Array.isArray(search.actionPolicy.actionKinds) && search.actionPolicy.actionKinds.length === 0) {
      fail("INVALID_TASK", "search.actionPolicy.actionKinds must be non-empty", "search.actionPolicy.actionKinds");
    }
  }
  return search;
}

const BUDGET_KEYS = [
  "maxExpansions",
  "maxRuntimeMs",
  "maxActionsPerState",
  "candidateLimit",
  "goalSkylineLimit",
  "dpSkylineMax",
];

function pickDefined(source, keys) {
  return keys.reduce((result, key) => {
    if (source && source[key] != null) result[key] = source[key];
    return result;
  }, {});
}

// Effective search merges budgets with fixed priority:
//   task.search top-level > task.search.dpBudget > regionSpec.search top-level
//   > regionSpec.search.dpBudget > regionSpec.dpBudget > SolveTask defaults
function buildEffectiveSearch(rawTask, regionSpec) {
  const rawSearch = (rawTask && rawTask.search) || {};
  const regionSearch = (regionSpec && regionSpec.search) || {};
  const mergedBudget = {
    ...pickDefined(regionSpec && regionSpec.dpBudget, BUDGET_KEYS),
    ...pickDefined(regionSearch.dpBudget, BUDGET_KEYS),
    ...pickDefined(regionSearch, BUDGET_KEYS),
    ...pickDefined(rawSearch.dpBudget, BUDGET_KEYS),
    ...pickDefined(rawSearch, BUDGET_KEYS),
  };
  const merged = {
    ...regionSearch,
    ...rawSearch,
    ...mergedBudget,
  };
  delete merged.dpBudget;
  return normalizeSearch(merged);
}

function resolveEffectiveRank(rawTask, regionSpec) {
  return (rawTask && rawTask.tower && rawTask.tower.rank) ||
    (regionSpec && regionSpec.rank) ||
    "chaos";
}

// The project fingerprint must reflect the actual tower content, not just the
// tower id.  A provided fingerprint is verified against the project; when none
// is provided it is computed from the project at projectRoot.  If the project
// cannot be loaded (e.g. synthetic tasks), the provided fingerprint is kept.
function resolveProjectFingerprint(rawTask, regionSpec, context) {
  const tower = (rawTask && rawTask.tower) || {};
  const provided = tower.projectFingerprint ||
    (context && context.projectFingerprint) ||
    null;
  const projectRoot = tower.projectRoot || (regionSpec && regionSpec.projectRoot) || (context && context.projectRoot) || null;
  if (projectRoot) {
    let actual = null;
    try {
      if (fs.existsSync(projectRoot)) {
        const project = loadProject(projectRoot);
        actual = buildProjectFingerprint(project).fingerprintSha256;
      }
    } catch (error) {
      actual = null;
    }
    if (actual) {
      if (provided) {
        const providedValue = typeof provided === "string"
          ? provided
          : (provided && provided.fingerprintSha256) || null;
        if (providedValue && providedValue !== actual) {
          fail("INVALID_TASK", "tower.projectFingerprint does not match the project at projectRoot", "tower.projectFingerprint");
        }
      }
      return actual;
    }
  }
  return provided || null;
}

function normalizeRegionPart(rawRegion, context) {
  if (!rawRegion || typeof rawRegion !== "object" || Array.isArray(rawRegion)) {
    fail("INVALID_TASK", "tower.region.spec is required", "region.spec");
  }
  // External region specs must not smuggle a local sourceFile that affects
  // identity or relative path resolution.
  const rawSpec = stripExternalCompiledMarker(rawRegion.spec || rawRegion);
  delete rawSpec.sourceFile;
  const spec = normalizeRegionSpec(rawSpec, null);
  validateRegionSpec(spec);
  return spec;
}

function compileSolveTask(rawTask, context) {
  const raw = stripExternalCompiledMarker(rawTask);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    fail("INVALID_TASK", "SolveTask must be an object", "task");
  }
  if (raw.schema != null && raw.schema !== SOLVE_TASK_SCHEMA) {
    fail("INVALID_TASK", `unsupported task schema: ${raw.schema}`, "schema");
  }
  const tower = raw.tower && typeof raw.tower === "object" ? raw.tower : {};
  if (!tower.id || typeof tower.id !== "string") {
    fail("INVALID_TASK", "tower.id is required", "tower.id");
  }
  const regionSpec = normalizeRegionPart(tower.region || (raw.region ? { spec: raw.region } : null), context);

  const rawModel = raw.model == null
    ? (regionSpec.model || null)
    : stripExternalCompiledMarker(raw.model);
  const model = rawModel == null ? null : normalizeSolverModel(rawModel);

  // Objective is always recompiled from the raw JSON; an external compiled:true
  // marker is stripped so it cannot bypass Objective-Search compatibility.
  const rawObjective = stripExternalCompiledMarker(
    raw.objective == null ? regionSpec.objective || null : raw.objective,
  );
  const objective = compileObjectiveSpec(rawObjective, model, {
    ...((context || {}).objectiveOptions || {}),
  });

  const search = buildEffectiveSearch(raw, regionSpec);
  const effectiveRank = resolveEffectiveRank(raw, regionSpec);
  const projectFingerprint = resolveProjectFingerprint(raw, regionSpec, context);

  const verification = {
    strictReplay: raw.verification == null
      ? true
      : Boolean(raw.verification.strictReplay),
  };

  const projectRoot = tower.projectRoot || regionSpec.projectRoot || (context && context.projectRoot) || null;
  if (projectRoot != null && typeof projectRoot !== "string") {
    fail("INVALID_TASK", "tower.projectRoot must be a string", "tower.projectRoot");
  }

  // Fingerprint binds everything that changes solver behavior across launches:
  // tower identity, effective project fingerprint, effective rank, normalized
  // region spec, model, objective, effective search, action policy,
  // verification policy, and schema version.  It excludes jobId, createdAt,
  // absolute project root, UI labels, and progress parameters.  The effective
  // search and rank are the exact values used to execute the task, so the
  // fingerprint cannot drift from execution semantics.
  const regionHashable = cloneJson(regionSpec);
  delete regionHashable.sourceFile;
  delete regionHashable.label;
  delete regionHashable.projectRoot;
  delete regionHashable.rank;
  const searchHashable = FINGERPRINT_SEARCH_FIELDS.reduce((result, key) => {
    result[key] = search[key];
    return result;
  }, {});
  const actionPolicyHashable = cloneJson(search.actionPolicy || {});
  const fingerprintPayload = {
    schema: SOLVE_TASK_SCHEMA,
    towerId: tower.id,
    towerFingerprint: projectFingerprint,
    rank: effectiveRank,
    regionSpec: regionHashable,
    solverModelFingerprint: model ? model.fingerprint : null,
    objectiveFingerprint: objective.explicit ? objective.fingerprint : null,
    search: searchHashable,
    actionPolicy: actionPolicyHashable,
    verification,
  };
  const taskFingerprint = fingerprintJson(fingerprintPayload);

  const towerFingerprint = projectFingerprint;
  const regionFingerprint = fingerprintJson(regionHashable);
  const solverModelFingerprint = model ? model.fingerprint : null;
  const objectiveFingerprint = objective.explicit ? objective.fingerprint : null;

  const normalizedTask = {
    schema: SOLVE_TASK_SCHEMA,
    tower: {
      id: tower.id,
      projectRoot,
      projectFingerprint,
      rank: effectiveRank,
      region: { spec: regionSpec },
    },
    model: model || null,
    objective: objective.explicit ? objective.toJSON() : null,
    search,
    verification,
  };

  const executeConfig = {
    candidateLimit: search.candidateLimit,
    goalSkylineLimit: search.goalSkylineLimit,
    dpSkylineMax: search.dpSkylineMax,
    dpKeyMode: search.dpKeyMode || regionSpec.search.dpKeyMode || null,
    maxExpansions: search.maxExpansions,
    maxRuntimeMs: search.maxRuntimeMs,
    maxActionsPerState: search.maxActionsPerState,
    stopOnFirstGoal: search.stopOnFirstGoal,
    rank: effectiveRank,
    captureExpandedStates: search.captureExpandedStates === true ? true : undefined,
    captureExpandedStateLimit: Number(search.captureExpandedStateLimit || 0) || undefined,
    ...(search.actionPolicy ? { actionPolicy: search.actionPolicy } : {}),
  };

  return {
    compiled: true,
    schema: SOLVE_TASK_SCHEMA,
    taskFingerprint,
    towerFingerprint,
    regionFingerprint,
    solverModelFingerprint,
    objectiveFingerprint,
    normalizedTask,
    executeConfig,
    objective, // compiled objective for in-process execution
    search,
    verification,
    toJSON() {
      return cloneJson(normalizedTask);
    },
  };
}

function validateSolveTask(rawTask, context) {
  compileSolveTask(rawTask, context);
  return true;
}

// Executable-job variant: requires the project root to exist and actually be
// loadable with a real project fingerprint, so a misspelled or malformed
// projectRoot fails before a worker is spawned.  The supplied fingerprint can
// never substitute for the actual project fingerprint here: the project is
// loaded and its real fingerprint is computed; a supplied fingerprint must
// match it.  Template tasks that only carry a trusted fingerprint can still use
// compileSolveTask.
function compileExecutableSolveTask(rawTask, context) {
  const task = compileSolveTask(rawTask, context);
  const projectRoot = task.normalizedTask.tower.projectRoot;
  if (!projectRoot || typeof projectRoot !== "string" || !fs.existsSync(projectRoot)) {
    fail("INVALID_TASK", "tower.projectRoot must exist to submit an executable job", "tower.projectRoot");
  }
  let actual = null;
  try {
    const project = loadProject(projectRoot);
    actual = buildProjectFingerprint(project).fingerprintSha256;
  } catch (error) {
    fail(
      "INVALID_TASK",
      `project at projectRoot could not be loaded: ${error && error.message ? error.message : String(error)}`,
      "tower.projectRoot",
    );
  }
  if (!actual) {
    fail("INVALID_TASK", "project fingerprint is empty; the project at projectRoot could not be loaded", "tower.projectFingerprint");
  }
  const supplied = task.normalizedTask.tower.projectFingerprint;
  if (supplied && supplied !== actual) {
    fail("INVALID_TASK", "tower.projectFingerprint does not match the project at projectRoot", "tower.projectFingerprint");
  }
  return task;
}

module.exports = {
  SOLVE_TASK_SCHEMA,
  SolveTaskError,
  buildEffectiveSearch,
  compileExecutableSolveTask,
  compileSolveTask,
  fingerprintJson,
  normalizeRegionPart,
  normalizeSearch,
  resolveEffectiveRank,
  stripExternalCompiledMarker,
  validateSolveTask,
};
