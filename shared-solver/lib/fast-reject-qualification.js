"use strict";

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return defaultValue;
}

/**
 * Authoritative fast-reject qualification resolver.
 * Evaluates whether auto-battle fast reject optimization should be enabled
 * on both the resolver qualification layer and the simulator production bypass layer.
 *
 * Strict policy: Default is ALWAYS FALSE (fail-closed) unless explicitly qualified
 * or bound to a trusted canonical OnlyUp profile/spec.
 *
 * @param {Object} [options]
 * @param {Object} [options.args] - Parsed CLI arguments
 * @param {Object} [options.spec] - Tower region/trial spec
 * @param {Object} [options.regionSpec] - Tower region spec alias
 * @param {Object} [options.task] - Solver job task
 * @param {Object} [options.runtimeOptions] - Runtime options
 * @param {Object} [options.config] - Simulator/Searcher config
 * @param {boolean} [options.explicit] - Direct qualification boolean
 * @returns {boolean}
 */
function resolveFastRejectQualification(options = {}) {
  if (typeof options.explicit === "boolean") {
    return options.explicit;
  }

  // 1. CLI flag takes precedence when explicitly supplied
  if (options.args && options.args["fast-reject"] !== undefined) {
    return parseBoolean(options.args["fast-reject"], false);
  }

  // 2. Direct runtime options overrides (highest programmatic precedence)
  if (options.runtimeOptions) {
    if (options.runtimeOptions.autoBattleFastRejectQualified === true || options.runtimeOptions.enableFastReject === true) {
      return true;
    }
    if (options.runtimeOptions.autoBattleFastRejectQualified === false || options.runtimeOptions.enableFastReject === false) {
      return false;
    }
  }

  // 3. Simulator/Searcher config overrides
  if (options.config) {
    if (options.config.autoBattleFastRejectQualified === true || options.config.enableFastReject === true) {
      return true;
    }
    if (options.config.autoBattleFastRejectQualified === false || options.config.enableFastReject === false) {
      return false;
    }
  }

  // 4. Task qualification
  if (options.task && options.task.autoBattleFastRejectQualified === true) {
    return true;
  }

  // 5. Region/Trial Spec qualification
  const spec = options.spec || options.regionSpec;
  if (spec) {
    if (spec.autoBattleFastRejectQualified === true) return true;
    if (spec.simulator && spec.simulator.autoBattleFastRejectQualified === true) return true;
    if (spec.tower === "onlyup") return true;
  }

  // 6. Default fail-closed
  return false;
}

module.exports = {
  parseBoolean,
  resolveFastRejectQualification,
};
