"use strict";

const crypto = require("node:crypto");

const { getDecisionDepth, getRawRouteLength } = require("./state");
const {
  SOLVER_HERO_FIELDS,
  isSolverFieldMaintained,
  normalizeSolverModel,
} = require("./solver-model");

const OBJECTIVE_SPEC_SCHEMA = "motapathfinder.objective-spec.v1";
const OBJECTIVE_MODES = [
  "clear",
  "max-final-hp",
  "maximize",
  "maximize-score",
  "lexicographic",
];

const NUMERIC_HERO_FIELDS = new Set([
  "hp",
  "hpmax",
  "mana",
  "manamax",
  "atk",
  "def",
  "mdef",
  "lv",
  "exp",
  "money",
]);

const BUILTIN_COMPARATORS = {
  "max-final-hp": { kind: "field", path: "hero.hp", direction: "max" },
  "max-final-hpmax": { kind: "field", path: "hero.hpmax", direction: "max" },
  "max-final-mana": { kind: "field", path: "hero.mana", direction: "max" },
  "max-final-manamax": { kind: "field", path: "hero.manamax", direction: "max" },
  "max-final-atk": { kind: "field", path: "hero.atk", direction: "max" },
  "max-final-def": { kind: "field", path: "hero.def", direction: "max" },
  "max-final-mdef": { kind: "field", path: "hero.mdef", direction: "max" },
  "max-final-lv": { kind: "field", path: "hero.lv", direction: "max" },
  "max-final-exp": { kind: "field", path: "hero.exp", direction: "max" },
  "max-final-money": { kind: "field", path: "hero.money", direction: "max" },
  "min-decision-depth": { kind: "field", path: "decisionDepth", direction: "min" },
  "min-route-length": { kind: "field", path: "route.length", direction: "min" },
};

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

function fingerprintSpec(spec) {
  return crypto
    .createHash("sha256")
    .update(stableStringify(spec))
    .digest("hex")
    .slice(0, 16);
}

class ObjectiveSpecError extends Error {
  constructor(code, message, path) {
    super(message);
    this.name = "ObjectiveSpecError";
    this.code = code;
    this.path = path || null;
  }
}

function fail(code, message, path) {
  throw new ObjectiveSpecError(code, message, path);
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stateFromCandidate(candidate) {
  return candidate && candidate.state ? candidate.state : candidate;
}

function routeLength(state) {
  // Route length must read the unified raw route length (auto steps included),
  // not only the materialized array (which is absent during search).
  return getRawRouteLength(state);
}

function effectiveHeroValue(state, field) {
  const hero = (state && state.hero) || {};
  const flags = (state && state.flags) || {};
  return Math.floor(
    number(hero[field], 0) * number(flags[`__${field}_buff__`], 1),
  );
}

// This is the pre-ObjectiveSpec fallback. Keeping it here makes the legacy
// comparator explicit while allowing the objective comparator to be terminal
// only. It is not used for DP key construction or dominance.
function compareLegacyStates(left, right) {
  if (!right) return -1;
  if (!left) return 1;
  const leftHero = (left && left.hero) || {};
  const rightHero = (right && right.hero) || {};
  const hpDiff = number(rightHero.hp, 0) - number(leftHero.hp, 0);
  if (hpDiff !== 0) return hpDiff;
  for (const field of ["atk", "def", "mdef"]) {
    const diff = effectiveHeroValue(right, field) - effectiveHeroValue(left, field);
    if (diff !== 0) return diff;
  }
  const expDiff = number(rightHero.exp, 0) - number(leftHero.exp, 0);
  if (expDiff !== 0) return expDiff;
  return routeLength(left) - routeLength(right);
}

function maintainedHeroFields(model, options) {
  if (options && Array.isArray(options.maintainedHeroFields)) {
    return new Set(options.maintainedHeroFields);
  }
  const normalized = model == null ? normalizeSolverModel(null) : normalizeSolverModel(model);
  return new Set(SOLVER_HERO_FIELDS.filter((field) => isSolverFieldMaintained(normalized, field)));
}

function validateNumericPath(path, model, options, errorPath) {
  if (typeof path !== "string" || path.length === 0) {
    fail("OBJECTIVE_FIELD_NOT_SUPPORTED", `${errorPath} must be a supported numeric path`, errorPath);
  }
  const heroMatch = /^hero\.([A-Za-z][A-Za-z0-9_]*)$/.exec(path);
  if (heroMatch) {
    const field = heroMatch[1];
    if (!SOLVER_HERO_FIELDS.includes(field) || !NUMERIC_HERO_FIELDS.has(field)) {
      fail("OBJECTIVE_FIELD_NOT_SUPPORTED", `${errorPath} does not reference a supported numeric hero field: ${path}`, errorPath);
    }
    if (!maintainedHeroFields(model, options).has(field)) {
      fail("OBJECTIVE_FIELD_NOT_MAINTAINED", `${errorPath} references disabled or snapshot-only field: ${path}`, errorPath);
    }
    return { kind: "field", path, direction: null };
  }
  if (/^inventory\.[A-Za-z0-9_.:-]+$/.test(path)) {
    return { kind: "field", path, direction: null };
  }
  if (path === "decisionDepth") return { kind: "field", path, direction: null };
  if (path === "route.length") return { kind: "field", path, direction: null };
  fail("OBJECTIVE_FIELD_NOT_SUPPORTED", `${errorPath} does not reference a supported numeric path: ${path}`, errorPath);
}

function descriptorForField(path, direction, model, options, errorPath) {
  const descriptor = validateNumericPath(path, model, options, errorPath);
  if (direction !== "max" && direction !== "min") {
    fail("OBJECTIVE_INVALID_DIRECTION", `${errorPath}.direction must be max or min`, errorPath);
  }
  descriptor.direction = direction;
  return descriptor;
}

function normalizeBuiltinComparator(token, model, options, errorPath) {
  if (typeof token !== "string" || !Object.prototype.hasOwnProperty.call(BUILTIN_COMPARATORS, token)) {
    fail("OBJECTIVE_INVALID_TIE_BREAKER", `${errorPath} is not a supported comparator: ${token}`, errorPath);
  }
  const builtin = BUILTIN_COMPARATORS[token];
  return {
    token,
    kind: builtin.kind,
    path: builtin.path,
    direction: builtin.direction,
    ...descriptorForField(builtin.path, builtin.direction, model, options, errorPath),
  };
}

function normalizeTieBreakers(raw, model, options, errorPath) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    fail("OBJECTIVE_INVALID_TIE_BREAKER", `${errorPath} must be an array`, errorPath);
  }
  return raw.map((token, index) => {
    const itemPath = `${errorPath}[${index}]`;
    if (token && typeof token === "object" && token.kind) {
      return descriptorFromJson(token, model, options, itemPath);
    }
    return normalizeBuiltinComparator(token, model, options, itemPath);
  });
}

function normalizeTerms(raw, model, options, errorPath) {
  if (!Array.isArray(raw) || raw.length === 0) {
    fail("OBJECTIVE_INVALID_SPEC", `${errorPath} must contain at least one term`, errorPath);
  }
  return raw.map((term, index) => {
    const prefix = `${errorPath}[${index}]`;
    if (!term || typeof term !== "object" || Array.isArray(term)) {
      fail("OBJECTIVE_INVALID_SPEC", `${prefix} must be an object`, prefix);
    }
    const descriptor = validateNumericPath(term.path, model, options, `${prefix}.path`);
    const weight = term.weight;
    if (typeof weight !== "number" || !Number.isFinite(weight) || weight === 0) {
      fail("OBJECTIVE_INVALID_WEIGHT", `${prefix}.weight must be a finite non-zero number`, `${prefix}.weight`);
    }
    return {
      path: descriptor.path,
      weight,
    };
  });
}

function normalizeLexicographicItem(item, model, options, errorPath) {
  if (item && typeof item === "object" && item.kind) {
    return descriptorFromJson(item, model, options, errorPath);
  }
  if (typeof item === "string") {
    if (item === "clear") return { kind: "clear", token: "clear" };
    return normalizeBuiltinComparator(item, model, options, errorPath);
  }
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    fail("OBJECTIVE_INVALID_SPEC", `${errorPath} must be a comparator token or object`, errorPath);
  }
  if (item.mode === "clear") return { kind: "clear", token: "clear" };
  if (item.mode === "max-final-hp") {
    return normalizeBuiltinComparator("max-final-hp", model, options, errorPath);
  }
  if (item.mode === "maximize") {
    return descriptorForField(item.field, "max", model, options, `${errorPath}.field`);
  }
  if (item.mode === "maximize-score") {
    return {
      kind: "score",
      direction: "max",
      terms: normalizeTerms(item.terms, model, options, `${errorPath}.terms`),
    };
  }
  fail("OBJECTIVE_INVALID_SPEC", `${errorPath}.mode is not supported in lexicographic objectives`, `${errorPath}.mode`);
}

function descriptorToJson(descriptor) {
  if (descriptor.kind === "clear") return { kind: "clear", token: "clear" };
  if (descriptor.kind === "score") {
    return {
      kind: "score",
      direction: descriptor.direction,
      terms: cloneJson(descriptor.terms),
    };
  }
  return {
    kind: "field",
    path: descriptor.path,
    direction: descriptor.direction,
  };
}

function normalizeObjectiveSpec(rawSpec, solverModel, options) {
  if (rawSpec == null) return null;
  if (rawSpec && rawSpec.compiled === true && rawSpec.spec) return cloneJson(rawSpec.spec);
  if (typeof rawSpec !== "object" || Array.isArray(rawSpec)) {
    fail("OBJECTIVE_INVALID_SPEC", "ObjectiveSpec must be an object", "objective");
  }
  const mode = String(rawSpec.mode || "");
  if (!OBJECTIVE_MODES.includes(mode)) {
    fail("OBJECTIVE_UNSUPPORTED_MODE", `objective.mode is not supported: ${mode}`, "objective.mode");
  }
  if (rawSpec.requireGoal === false) {
    fail("OBJECTIVE_REQUIRES_GOAL", `${mode} objectives require a RegionSpec goal`, "objective.requireGoal");
  }
  if (rawSpec.terminalOnly === false) {
    fail("OBJECTIVE_TERMINAL_ONLY_REQUIRED", "ObjectiveSpec v1 only supports terminal candidate ordering", "objective.terminalOnly");
  }

  const normalized = {
    schema: OBJECTIVE_SPEC_SCHEMA,
    mode,
    requireGoal: true,
    terminalOnly: true,
  };
  if (mode === "clear") {
    normalized.tieBreakers = normalizeTieBreakers(
      rawSpec.tieBreakers,
      solverModel,
      options,
      "objective.tieBreakers",
    ).map(descriptorToJson);
  } else if (mode === "max-final-hp") {
    normalized.field = "hero.hp";
    normalized.tieBreakers = normalizeTieBreakers(
      rawSpec.tieBreakers == null ? ["min-decision-depth"] : rawSpec.tieBreakers,
      solverModel,
      options,
      "objective.tieBreakers",
    ).map(descriptorToJson);
    validateNumericPath(normalized.field, solverModel, options, "objective.field");
  } else if (mode === "maximize") {
    normalized.field = validateNumericPath(
      rawSpec.field,
      solverModel,
      options,
      "objective.field",
    ).path;
    normalized.tieBreakers = normalizeTieBreakers(
      rawSpec.tieBreakers == null ? ["min-decision-depth"] : rawSpec.tieBreakers,
      solverModel,
      options,
      "objective.tieBreakers",
    ).map(descriptorToJson);
  } else if (mode === "maximize-score") {
    normalized.terms = normalizeTerms(rawSpec.terms, solverModel, options, "objective.terms");
    normalized.tieBreakers = normalizeTieBreakers(
      rawSpec.tieBreakers == null ? ["min-decision-depth"] : rawSpec.tieBreakers,
      solverModel,
      options,
      "objective.tieBreakers",
    ).map(descriptorToJson);
  } else if (mode === "lexicographic") {
    if (!Array.isArray(rawSpec.objectives) || rawSpec.objectives.length === 0) {
      fail("OBJECTIVE_INVALID_SPEC", "objective.objectives must contain at least one item", "objective.objectives");
    }
    normalized.objectives = rawSpec.objectives.map((item, index) => descriptorToJson(
      normalizeLexicographicItem(item, solverModel, options, `objective.objectives[${index}]`),
    ));
    normalized.tieBreakers = normalizeTieBreakers(
      rawSpec.tieBreakers,
      solverModel,
      options,
      "objective.tieBreakers",
    ).map(descriptorToJson);
  }
  normalized.fingerprint = fingerprintSpec(normalized);
  return normalized;
}

function descriptorFromJson(descriptor, model, options, errorPath) {
  if (descriptor && descriptor.kind === "clear") return { kind: "clear", token: "clear" };
  if (descriptor && descriptor.kind === "score") {
    const direction = descriptor.direction || "max";
    if (direction !== "max" && direction !== "min") {
      fail("OBJECTIVE_INVALID_DIRECTION", `${errorPath}.direction must be max or min`, `${errorPath}.direction`);
    }
    return {
      kind: "score",
      direction,
      terms: normalizeTerms(descriptor.terms, model, options, `${errorPath}.terms`),
    };
  }
  return descriptorForField(
    descriptor && descriptor.path,
    descriptor && descriptor.direction,
    model,
    options,
    errorPath,
  );
}

function descriptorsForSpec(spec, model, options) {
  const tieBreakers = (spec.tieBreakers || []).map((descriptor, index) =>
    descriptorFromJson(descriptor, model, options, `objective.tieBreakers[${index}]`),
  );
  if (spec.mode === "clear") return tieBreakers;
  if (spec.mode === "max-final-hp") {
    return [descriptorForField("hero.hp", "max", model, options, "objective.field"), ...tieBreakers];
  }
  if (spec.mode === "maximize") {
    return [descriptorForField(spec.field, "max", model, options, "objective.field"), ...tieBreakers];
  }
  if (spec.mode === "maximize-score") {
    return [{ kind: "score", direction: "max", terms: normalizeTerms(spec.terms, model, options, "objective.terms") }, ...tieBreakers];
  }
  return [
    ...(spec.objectives || []).map((descriptor, index) =>
      descriptorFromJson(descriptor, model, options, `objective.objectives[${index}]`),
    ),
    ...tieBreakers,
  ];
}

// Objective–Search compatibility: the ObjectiveSpec only orders already-reached
// terminal candidates.  The DP key, same-key HP dominance, agenda, and action
// pruning decide which states survive the search.  An objective that optimizes
// a field the search can discard is not safe to call "bounded-optimal".
//
// Allowed references:
//   - hero.<field>  -> field must be `key` mode (all values are explored).
//   - hero.hp       -> max only (same-key dominance retains higher HP).
//   - inventory.*   -> inventory is part of the DP identity.
//   - decisionDepth -> min only (dominance keeps shorter depth when HP equal).
//   - route.length  -> min only.
// Rejected references fail with OBJECTIVE_FIELD_NOT_SEARCH_PRESERVED,
// OBJECTIVE_CONFLICTS_WITH_DOMINANCE, OBJECTIVE_INVALID_DIRECTION, or
// OBJECTIVE_NON_MONOTONE_WEIGHT.
function validateObjectiveSearchCompatibility(spec, descriptors, model, options) {
  // Live-replay recompiles a persisted objective from metadata without the
  // original model.  It was already validated at search preflight time, so
  // skip re-validation there and treat it as search-preserving.
  if (options && Array.isArray(options.maintainedHeroFields)) return true;
  const normalized = model == null
    ? normalizeSolverModel(null)
    : (model.schema === "motapathfinder.solver-model.v1"
      ? model
      : normalizeSolverModel(model));
  const heroFields = (normalized && normalized.heroFields) || {};
  const validateField = (path, direction, errorPath) => {
    if (path === "decisionDepth" || path === "route.length") {
      if (direction !== "min") {
        fail(
          "OBJECTIVE_INVALID_DIRECTION",
          `${errorPath} may only be optimized in the min direction; same-key dominance retains shorter depth/route`,
          errorPath,
        );
      }
      return;
    }
    const heroMatch = /^hero\.([A-Za-z][A-Za-z0-9_]*)$/.exec(path);
    if (heroMatch) {
      const field = heroMatch[1];
      if (field === "hp") {
        if (direction === "min") {
          fail(
            "OBJECTIVE_CONFLICTS_WITH_DOMINANCE",
            `${errorPath} hero.hp cannot be minimized; same-key HP dominance retains higher HP`,
            errorPath,
          );
        }
        return;
      }
      const mode = heroFields[field];
      if (mode !== "key") {
        fail(
          "OBJECTIVE_FIELD_NOT_SEARCH_PRESERVED",
          `${errorPath} references hero.${field} in ${mode || "unknown"} mode; only key-mode fields are preserved by the DP for terminal optimization`,
          errorPath,
        );
      }
      return;
    }
    // inventory.* is part of the DP identity, so both directions are safe.
  };
  const validateTerms = (terms, errorPath, direction) => {
    const effectiveWeight = (term) => {
      const weight = Number(term.weight);
      return direction === "min" ? -weight : weight;
    };
    (terms || []).forEach((term, index) => {
      const termPath = `${errorPath}[${index}]`;
      const path = term.path;
      const weight = effectiveWeight(term);
      if (path === "hero.hp") {
        if (weight < 0) {
          fail(
            "OBJECTIVE_NON_MONOTONE_WEIGHT",
            `${termPath} effective hero.hp weight (after score direction) conflicts with HP dominance; only a maximized hp term is preserved by same-key dominance`,
            termPath,
          );
        }
        return;
      }
      if (path === "decisionDepth" || path === "route.length") {
        if (weight > 0) {
          fail(
            "OBJECTIVE_NON_MONOTONE_WEIGHT",
            `${termPath} effective weight on ${path} (after score direction) conflicts with dominance; only a minimizing term is preserved`,
            termPath,
          );
        }
        return;
      }
      const heroMatch = /^hero\.([A-Za-z][A-Za-z0-9_]*)$/.exec(path);
      if (heroMatch) {
        const field = heroMatch[1];
        const mode = heroFields[field];
        if (mode !== "key") {
          fail(
            "OBJECTIVE_FIELD_NOT_SEARCH_PRESERVED",
            `${termPath} references hero.${field} in ${mode || "unknown"} mode; only key-mode fields are preserved by the DP for terminal optimization`,
            termPath,
          );
        }
      }
    });
  };
  (descriptors || []).forEach((descriptor, index) => {
    if (!descriptor || descriptor.kind === "clear") return;
    const errorPath = `objective.descriptors[${index}]`;
    if (descriptor.kind === "score") {
      validateTerms(descriptor.terms, `${errorPath}.terms`, descriptor.direction);
      return;
    }
    validateField(descriptor.path, descriptor.direction, errorPath);
  });
  void options;
  return true;
}

function readPath(state, path) {
  const source = stateFromCandidate(state) || {};
  if (path === "decisionDepth") return getDecisionDepth(source);
  if (path === "route.length") return routeLength(source);
  const heroMatch = /^hero\.([A-Za-z][A-Za-z0-9_]*)$/.exec(path);
  if (heroMatch) return number(((source.hero || {})[heroMatch[1]]), 0);
  const inventoryMatch = /^inventory\.(.+)$/.exec(path);
  if (inventoryMatch) return number(((source.inventory || {})[inventoryMatch[1]]), 0);
  return 0;
}

function evaluateDescriptor(state, descriptor) {
  if (descriptor.kind === "clear") {
    return { kind: "clear", token: "clear", value: 0 };
  }
  if (descriptor.kind === "score") {
    const terms = descriptor.terms.map((term) => {
      const value = readPath(state, term.path);
      return {
        path: term.path,
        weight: term.weight,
        value,
        contribution: value * term.weight,
      };
    });
    return {
      kind: "score",
      direction: descriptor.direction,
      value: terms.reduce((sum, term) => sum + term.contribution, 0),
      terms,
    };
  }
  return {
    kind: "field",
    path: descriptor.path,
    direction: descriptor.direction,
    value: readPath(state, descriptor.path),
  };
}

function compareDescriptorValues(left, right, descriptor) {
  if (left === right) return 0;
  if (descriptor.direction === "min") return left < right ? -1 : 1;
  return left > right ? -1 : 1;
}

function buildLegacyObjective() {
  return {
    compiled: true,
    explicit: false,
    schema: OBJECTIVE_SPEC_SCHEMA,
    mode: "legacy",
    spec: null,
    fingerprint: null,
    requireGoal: false,
    terminalOnly: true,
    searchPreserving: true,
    allowsFirstGoalStop: true,
    requiresOptimizationProof: false,
    getStopPolicy(requested) {
      return {
        requested: requested === true,
        effective: requested === true,
        allowsFirstGoalStop: true,
        forcedEarlyStop: false,
        requiresOptimizationProof: false,
      };
    },
    evaluateState() {
      return { value: null, vector: [], trace: [] };
    },
    compareCandidates(left, right) {
      return compareLegacyStates(stateFromCandidate(left), stateFromCandidate(right));
    },
    toJSON() {
      return null;
    },
  };
}

function compileObjectiveSpec(rawSpec, solverModel, options) {
  if (rawSpec && rawSpec.compiled === true) return rawSpec;
  const spec = normalizeObjectiveSpec(rawSpec, solverModel, options);
  if (!spec) return buildLegacyObjective();
  const descriptors = descriptorsForSpec(spec, solverModel, options);
  // Reject objectives that optimize fields the current DP dominance/key can
  // discard, unless a solver model is unavailable (e.g. live replay, where the
  // objective was already validated at search preflight time).
  const searchPreserving = validateObjectiveSearchCompatibility(
    spec,
    descriptors,
    solverModel,
    options,
  );
  const optimizationDescriptors = descriptors.filter((descriptor) => descriptor.kind !== "clear");
  const requiresOptimizationProof = spec.mode === "clear"
    ? false
    : optimizationDescriptors.length > 0;
  const explicit = true;
  const objective = {
    compiled: true,
    explicit,
    schema: OBJECTIVE_SPEC_SCHEMA,
    mode: spec.mode,
    spec,
    fingerprint: spec.fingerprint,
    requireGoal: true,
    terminalOnly: true,
    searchPreserving,
    allowsFirstGoalStop: spec.mode === "clear" || optimizationDescriptors.length === 0,
    requiresOptimizationProof,
    getStopPolicy(requested) {
      const requestedStop = requested === true;
      return {
        requested: requestedStop,
        effective: requestedStop,
        allowsFirstGoalStop: spec.mode === "clear" || optimizationDescriptors.length === 0,
        forcedEarlyStop: requestedStop && requiresOptimizationProof,
        requiresOptimizationProof,
      };
    },
    evaluateState(state) {
      const trace = descriptors.map((descriptor) => evaluateDescriptor(state, descriptor));
      let value = null;
      if (spec.mode === "max-final-hp" || spec.mode === "maximize" || spec.mode === "maximize-score") {
        value = trace.length > 0 ? trace[0].value : null;
      } else if (spec.mode === "lexicographic") {
        value = trace.map((entry) => entry.value);
      } else if (trace.length > 0) {
        value = trace.map((entry) => entry.value);
      }
      return { value, vector: trace.map((entry) => entry.value), trace };
    },
    compareCandidates(left, right) {
      const leftState = stateFromCandidate(left);
      const rightState = stateFromCandidate(right);
      const leftEvaluation = objective.evaluateState(leftState);
      const rightEvaluation = objective.evaluateState(rightState);
      for (let index = 0; index < descriptors.length; index += 1) {
        const difference = compareDescriptorValues(
          leftEvaluation.vector[index],
          rightEvaluation.vector[index],
          descriptors[index],
        );
        if (difference !== 0) return difference;
      }
      return compareLegacyStates(leftState, rightState);
    },
    toJSON() {
      return cloneJson(spec);
    },
  };
  return objective;
}

function validateObjectiveSpec(rawSpec, solverModel, options) {
  // Validate through the full compile path so Objective-Search compatibility
  // (field mode preservation, dominance conflicts, score direction, direction
  // legality) is enforced for direct validator callers, not only for the
  // region-spec compile path.
  compileObjectiveSpec(rawSpec, solverModel, options);
  return true;
}

function objectiveMetadata(objective, evaluation) {
  if (!objective || !objective.explicit) return null;
  const result = evaluation || objective.evaluateState(null);
  return {
    objectiveSpec: objective.toJSON(),
    objectiveFingerprint: objective.fingerprint,
    finalObjectiveValue: cloneJson(result.value),
    objectiveComparisonTrace: cloneJson(result.trace),
  };
}

// Builds the stable objective projection carried by the search's
// goalCandidateImproved events.  The search confirms a candidate is better via
// its objective comparator; the projection carries the fingerprint/value/trace
// so progress consumers never re-derive improvement themselves.  route.length
// cannot be evaluated exactly at goal-enqueue time (the full route is
// reconstructed only at the end), so it is projected as inexact with a null
// value and the accurate candidate is published after the archive rebuild.
function objectiveProjector(objective) {
  if (!objective || !objective.explicit) return null;
  const specJson = JSON.stringify(objective.spec || {});
  const hasRouteLength = specJson.includes("route.length");
  return function projectObjectiveState(state) {
    const evaluation = objective.evaluateState(state);
    return {
      objectiveFingerprint: objective.fingerprint,
      objectiveValue: hasRouteLength ? null : evaluation.value,
      objectiveComparisonTrace: hasRouteLength ? [] : evaluation.trace,
      objectiveValueExact: !hasRouteLength,
    };
  };
}

module.exports = {
  OBJECTIVE_MODES,
  OBJECTIVE_SPEC_SCHEMA,
  ObjectiveSpecError,
  compareLegacyStates,
  compileObjectiveSpec,
  fingerprintSpec,
  normalizeObjectiveSpec,
  objectiveMetadata,
  objectiveProjector,
  validateObjectiveSpec,
};
