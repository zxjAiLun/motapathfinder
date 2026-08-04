"use strict";

const crypto = require("node:crypto");

const SOLVER_MODEL_SCHEMA = "motapathfinder.solver-model.v1";
const SOLVER_MODEL_MODES = [
  "disabled",
  "value",
  "dominance",
  "key",
  "objective",
  "snapshot-only",
];
const SUPPORTED_SOLVER_MODEL_MODES = [
  "disabled",
  "value",
  "key",
  "snapshot-only",
];
const SOLVER_HERO_FIELDS = [
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
  "equipment",
  "followers",
];
const SOLVER_MECHANICS = ["keys", "doors", "pointAllocation"];

// This is intentionally conservative. A RegionSpec without an explicit model
// must retain the historical solver state and key semantics.
const LEGACY_HERO_FIELDS = {
  hp: "dominance",
  hpmax: "value",
  mana: "key",
  manamax: "value",
  atk: "key",
  def: "key",
  mdef: "key",
  lv: "key",
  exp: "key",
  money: "key",
  equipment: "key",
  followers: "key",
};

const LEGACY_MECHANICS = {
  keys: true,
  doors: true,
  pointAllocation: true,
};

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function stableModelPayload(heroFields, mechanics) {
  return {
    heroFields: SOLVER_HERO_FIELDS.reduce((result, field) => {
      result[field] = heroFields[field];
      return result;
    }, {}),
    mechanics: Object.keys(mechanics || {})
      .sort()
      .reduce((result, key) => {
        result[key] = mechanics[key];
        return result;
      }, {}),
  };
}

function modelFingerprint(heroFields, mechanics) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(stableModelPayload(heroFields, mechanics)))
    .digest("hex")
    .slice(0, 16);
}

function buildModel({ explicit, mode, heroFields, mechanics, capabilities }) {
  const payload = stableModelPayload(heroFields, mechanics);
  return {
    schema: SOLVER_MODEL_SCHEMA,
    explicit: Boolean(explicit),
    mode: mode || (explicit ? "manual" : "legacy"),
    heroFields: payload.heroFields,
    mechanics: payload.mechanics,
    capabilities: cloneJson(capabilities || {}),
    fingerprint: modelFingerprint(payload.heroFields, payload.mechanics),
  };
}

function collectModelErrors(rawModel) {
  const errors = [];
  const internalNormalizedModel = rawModel &&
    rawModel.schema === SOLVER_MODEL_SCHEMA &&
    typeof rawModel.fingerprint === "string";
  if (rawModel == null) return errors;
  if (typeof rawModel !== "object" || Array.isArray(rawModel)) {
    return ["model must be an object"];
  }
  if (rawModel.heroFields != null &&
      (typeof rawModel.heroFields !== "object" || Array.isArray(rawModel.heroFields))) {
    errors.push("model.heroFields must be an object");
  }
  if (rawModel.mechanics != null &&
      (typeof rawModel.mechanics !== "object" || Array.isArray(rawModel.mechanics))) {
    errors.push("model.mechanics must be an object");
  } else if (
    rawModel.mechanics != null &&
    Object.keys(rawModel.mechanics).length > 0 &&
    !internalNormalizedModel
  ) {
    errors.push("model.mechanics is not part of authoritative SolverModel v1");
  }
  const heroFields = rawModel.heroFields || {};
  Object.keys(heroFields).forEach((field) => {
    if (!SOLVER_HERO_FIELDS.includes(field)) {
      errors.push(`model.heroFields.${field} is not supported`);
      return;
    }
    const mode = String(heroFields[field]);
    if (!SOLVER_MODEL_MODES.includes(mode)) {
      errors.push(
        `model.heroFields.${field} must be one of ${SOLVER_MODEL_MODES.join(", ")}`,
      );
      return;
    }
    if (mode === "objective") {
      errors.push(`model.heroFields.${field} objective mode is reserved for a later contract`);
    } else if (mode === "dominance" && field !== "hp") {
      errors.push(`model.heroFields.${field} dominance mode is only implemented for hp`);
    }
  });
  if (rawModel.capabilities != null &&
      (typeof rawModel.capabilities !== "object" || Array.isArray(rawModel.capabilities))) {
    errors.push("model.capabilities must be an object");
  } else {
    SOLVER_MECHANICS.forEach((mechanic) => {
      if (rawModel.capabilities && Object.prototype.hasOwnProperty.call(rawModel.capabilities, mechanic)) {
        errors.push(`model.capabilities.${mechanic} is not part of authoritative SolverModel v1`);
      }
    });
  }
  return errors;
}

function normalizeSolverModel(rawModel) {
  if (rawModel == null) {
    return buildModel({
      explicit: false,
      mode: "legacy",
      heroFields: LEGACY_HERO_FIELDS,
      mechanics: LEGACY_MECHANICS,
    });
  }

  const raw = rawModel.model && !rawModel.heroFields && !rawModel.mechanics
    ? rawModel.model
    : rawModel;
  const errors = collectModelErrors(raw);
  if (errors.length > 0) {
    throw new Error(`Invalid SolverModel:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }

  const heroFields = {
    ...LEGACY_HERO_FIELDS,
    ...(raw.heroFields || {}),
  };
  // Mechanics are deliberately absent from the authoritative explicit v1
  // contract.  The simulator's existing action/effect rules remain the
  // source of truth until a mechanics-aware contract is implemented.
  const mechanics = {};
  const capabilities = {
    ...(raw.capabilities || {}),
  };

  // Capabilities are a compact authoring convenience. Explicit heroFields
  // remain the final values when both forms are provided.
  ["mana", "hpmax", "manamax"].forEach((field) => {
    if (capabilities[field] === false && !(raw.heroFields && field in raw.heroFields)) {
      heroFields[field] = "disabled";
    }
  });
  return buildModel({
    explicit: true,
    mode: raw.mode || "manual",
    heroFields,
    mechanics,
    capabilities,
  });
}

function validateSolverModel(rawModel) {
  normalizeSolverModel(rawModel);
  return true;
}

function getSolverModel(state, override, simulatorModel) {
  if (override != null) return normalizeSolverModel(override);
  if (simulatorModel != null) {
    return simulatorModel.schema === SOLVER_MODEL_SCHEMA
      ? simulatorModel
      : normalizeSolverModel(simulatorModel);
  }
  return normalizeSolverModel(null);
}

function isSolverFieldMaintained(model, field) {
  const mode = model && model.heroFields && model.heroFields[field];
  return mode !== "disabled" && mode !== "snapshot-only";
}

function projectHeroForSolverModel(hero, model) {
  if (!model || !model.explicit) return hero;
  const source = hero || {};
  const projected = {};
  if (source.loc != null) projected.loc = cloneJson(source.loc);
  if (source.steps != null) projected.steps = source.steps;
  if (source.statistics != null) projected.statistics = cloneJson(source.statistics);
  SOLVER_HERO_FIELDS.forEach((field) => {
    if (!isSolverFieldMaintained(model, field)) return;
    if (Object.prototype.hasOwnProperty.call(source, field)) {
      projected[field] = cloneJson(source[field]);
    }
  });
  return projected;
}

function projectSolverState(state, modelOverride) {
  if (!state || !state.hero) return state;
  if (!state.meta) state.meta = {};
  const embeddedModel = state.meta.solverModel;
  const modelSource = modelOverride != null ? modelOverride : embeddedModel;
  if (modelSource == null) return state;
  const model = normalizeSolverModel(modelSource);
  delete state.meta.solverModel;
  if (!model.explicit) return state;
  state.meta.modelFingerprint = model.fingerprint;
  state.hero = projectHeroForSolverModel(state.hero, model);
  return state;
}

function getSolverSnapshotHeroFields(model) {
  const normalized = model == null
    ? normalizeSolverModel(null)
    : (model.schema === SOLVER_MODEL_SCHEMA ? model : normalizeSolverModel(model));
  if (!normalized.explicit) return null;
  return SOLVER_HERO_FIELDS.filter((field) => isSolverFieldMaintained(normalized, field));
}

module.exports = {
  LEGACY_HERO_FIELDS,
  LEGACY_MECHANICS,
  SOLVER_HERO_FIELDS,
  SOLVER_MECHANICS,
  SOLVER_MODEL_MODES,
  SUPPORTED_SOLVER_MODEL_MODES,
  SOLVER_MODEL_SCHEMA,
  getSolverModel,
  getSolverSnapshotHeroFields,
  isSolverFieldMaintained,
  normalizeSolverModel,
  projectHeroForSolverModel,
  projectSolverState,
  validateSolverModel,
};
