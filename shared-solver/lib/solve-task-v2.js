"use strict";

const fs = require("node:fs");

const {
  SOLVE_TASK_SCHEMA,
  SolveTaskError,
  buildEffectiveSearch,
  compileSolveTask,
  fingerprintJson,
  normalizeRegionPart,
  normalizeSearch,
  resolveEffectiveRank,
  stripExternalCompiledMarker,
} = require("./solve-task");
const { compileObjectiveSpec } = require("./objective-spec");
const { normalizeSolverModel } = require("./solver-model");
const { loadProject } = require("./project-loader");
const { buildProjectFingerprint } = require("./region-entry-validator");

// v2 schema carries an ORDERED, non-empty region sequence plus a single
// task-level SolverModel / Objective / Search.  v1 is left untouched; a v2
// single-region task is NOT the same schema as v1, so their fingerprints and
// execution semantics never collide.
const SOLVE_TASK_V2_SCHEMA = "motapathfinder.solve-task.v2";

const DEFAULT_REGION_CANDIDATE_LIMIT_SOURCE = "candidateLimit";

// Region entries in v2 must not smuggle per-region overrides that v2 does not
// support (per-region objective / model / search).  Unknown keys are ignored
// only when they are presentation metadata; these override keys are rejected.
const UNSUPPORTED_REGION_KEYS = ["objective", "model", "search", "dpBudget", "verification"];

class SolveTaskV2Error extends Error {
  constructor(code, message, path) {
    super(message);
    this.name = "SolveTaskV2Error";
    this.code = code;
    this.path = path || null;
  }
}

function fail(code, message, path) {
  throw new SolveTaskV2Error(code, message, path);
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

// v1 already rejects maxExpansions=0 and normalizes the search budget.  For v2
// the task-level search is the authority; regionCandidateLimit is a NEW v2
// field that caps the terminal frontier carried between regions.  Its default
// inherits candidateLimit, and the inheritance is made explicit in the
// normalized task so preflight and execution never disagree.
function normalizeV2Search(rawSearch) {
  const search = normalizeSearch(rawSearch);
  const raw = rawSearch || {};
  if (raw.regionCandidateLimit != null) {
    const parsed = Number(raw.regionCandidateLimit);
    if (!Number.isFinite(parsed) || parsed < 1) {
      fail("INVALID_TASK", "search.regionCandidateLimit must be >= 1", "search.regionCandidateLimit");
    }
    search.regionCandidateLimit = parsed;
    search.regionCandidateLimitSource = "explicit";
  } else {
    search.regionCandidateLimit = search.candidateLimit;
    search.regionCandidateLimitSource = DEFAULT_REGION_CANDIDATE_LIMIT_SOURCE;
  }
  return search;
}

function normalizeRegions(rawTask) {
  const tower = (rawTask && rawTask.tower) || {};
  const rawRegions = Array.isArray(tower.regions) ? tower.regions : null;
  if (!rawRegions) {
    fail("INVALID_TASK", "tower.regions is required and must be an ordered, non-empty array", "tower.regions");
  }
  if (rawRegions.length === 0) {
    fail("INVALID_TASK", "tower.regions must be non-empty", "tower.regions");
  }
  return rawRegions.map((rawRegion, index) => {
    if (!rawRegion || typeof rawRegion !== "object" || Array.isArray(rawRegion)) {
      fail("INVALID_TASK", `tower.regions[${index}] must be an object`, `tower.regions[${index}]`);
    }
    // v2 does not support per-region objective/model/search overrides.
    for (const key of UNSUPPORTED_REGION_KEYS) {
      if (rawRegion[key] != null) {
        fail(
          "INVALID_TASK",
          `per-region ${key} is not supported in solve-task.v2; use the task-level ${key}`,
          `tower.regions[${index}].${key}`,
        );
      }
    }
    return { spec: normalizeRegionPart(rawRegion, null), raw: rawRegion };
  });
}

function resolveV2ProjectFingerprint(rawTask, context) {
  const tower = (rawTask && rawTask.tower) || {};
  const provided = tower.projectFingerprint ||
    (context && context.projectFingerprint) ||
    null;
  const projectRoot = tower.projectRoot || (context && context.projectRoot) || null;
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

function hashableRegionSpec(regionSpec) {
  const hashable = cloneJson(regionSpec);
  delete hashable.sourceFile;
  delete hashable.label;
  delete hashable.projectRoot;
  delete hashable.rank;
  return hashable;
}

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
  "regionCandidateLimit",
];

function compileSolveTaskV2(rawTask, context) {
  const raw = stripExternalCompiledMarker(rawTask);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    fail("INVALID_TASK", "SolveTask must be an object", "task");
  }
  if (raw.schema != null && raw.schema !== SOLVE_TASK_V2_SCHEMA) {
    fail("INVALID_TASK", `unsupported task schema: ${raw.schema}`, "schema");
  }
  const tower = raw.tower && typeof raw.tower === "object" ? raw.tower : {};
  if (!tower.id || typeof tower.id !== "string") {
    fail("INVALID_TASK", "tower.id is required", "tower.id");
  }
  const regions = normalizeRegions(raw);
  const firstSpec = regions[0].spec;
  const rank = resolveEffectiveRank(raw, firstSpec);

  // v2 REQUIRES an explicit task-level SolverModel: with multiple RegionSpecs
  // their default models could disagree, so the model must be unambiguous.
  if (raw.model == null) {
    fail("INVALID_TASK", "solve-task.v2 requires an explicit task.model", "model");
  }
  const model = normalizeSolverModel(stripExternalCompiledMarker(raw.model));

  const rawObjective = stripExternalCompiledMarker(raw.objective || null);
  const objective = compileObjectiveSpec(rawObjective, model, {
    ...((context || {}).objectiveOptions || {}),
  });

  const search = normalizeV2Search(raw.search);
  const projectFingerprint = resolveV2ProjectFingerprint(raw, context);
  const verification = {
    strictReplay: raw.verification == null
      ? true
      : Boolean(raw.verification.strictReplay),
  };
  const projectRoot = tower.projectRoot || (context && context.projectRoot) || null;
  if (projectRoot != null && typeof projectRoot !== "string") {
    fail("INVALID_TASK", "tower.projectRoot must be a string", "tower.projectRoot");
  }

  // Effective per-region search: the task-level search is the authority, and a
  // region spec's own search only fills fields the task did not set (same
  // precedence as v1's buildEffectiveSearch).  Per-region explicit overrides
  // are rejected above.
  const effectiveRegions = regions.map(({ spec }) => ({
    spec,
    effectiveSearch: buildEffectiveSearch(raw, spec),
  }));

  const searchHashable = FINGERPRINT_SEARCH_FIELDS.reduce((result, key) => {
    result[key] = search[key];
    return result;
  }, {});
  const actionPolicyHashable = cloneJson(search.actionPolicy || {});
  const fingerprintPayload = {
    schema: SOLVE_TASK_V2_SCHEMA,
    towerId: tower.id,
    towerFingerprint: projectFingerprint,
    rank,
    regions: effectiveRegions.map(({ spec }) => hashableRegionSpec(spec)),
    solverModelFingerprint: model.fingerprint,
    objectiveFingerprint: objective.explicit ? objective.fingerprint : null,
    search: searchHashable,
    actionPolicy: actionPolicyHashable,
    verification,
  };
  const taskFingerprint = fingerprintJson(fingerprintPayload);
  const towerFingerprint = projectFingerprint;
  const regionFingerprints = effectiveRegions.map(({ spec }) => fingerprintJson(hashableRegionSpec(spec)));
  const solverModelFingerprint = model.fingerprint;
  const objectiveFingerprint = objective.explicit ? objective.fingerprint : null;

  const normalizedTask = {
    schema: SOLVE_TASK_V2_SCHEMA,
    tower: {
      id: tower.id,
      projectRoot,
      projectFingerprint,
      rank,
      regions: effectiveRegions.map(({ spec }) => ({ spec })),
    },
    model,
    objective: objective.explicit ? objective.toJSON() : null,
    search,
    verification,
  };

  const executeConfig = {
    candidateLimit: search.candidateLimit,
    regionCandidateLimit: search.regionCandidateLimit,
    goalSkylineLimit: search.goalSkylineLimit,
    dpSkylineMax: search.dpSkylineMax,
    dpKeyMode: search.dpKeyMode || firstSpec.search.dpKeyMode || null,
    maxExpansions: search.maxExpansions,
    maxRuntimeMs: search.maxRuntimeMs,
    maxActionsPerState: search.maxActionsPerState,
    stopOnFirstGoal: search.stopOnFirstGoal,
    rank,
    ...(search.actionPolicy ? { actionPolicy: search.actionPolicy } : {}),
  };

  return {
    compiled: true,
    schema: SOLVE_TASK_V2_SCHEMA,
    taskFingerprint,
    towerFingerprint,
    regionFingerprints,
    solverModelFingerprint,
    objectiveFingerprint,
    normalizedTask,
    executeConfig,
    objective,
    search,
    verification,
    regions: effectiveRegions,
    toJSON() {
      return cloneJson(normalizedTask);
    },
  };
}

function validateSolveTaskV2(rawTask, context) {
  compileSolveTaskV2(rawTask, context);
  return true;
}

// Executable v2 variant: the project must load with a real fingerprint.  Also
// rejects cross-tower/project region specs (all regions belong to the tower).
function compileExecutableSolveTaskV2(rawTask, context) {
  const task = compileSolveTaskV2(rawTask, context);
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
  SOLVE_TASK_V2_SCHEMA,
  SOLVE_TASK_SCHEMA,
  SolveTaskV2Error,
  compileExecutableSolveTaskV2,
  compileSolveTaskV2,
  normalizeV2Search,
  validateSolveTaskV2,
};
