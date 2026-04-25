"use strict";

const fs = require("fs");
const path = require("path");

const RESOURCE_POCKET_MODE_PRESETS = {
  off: null,
  lite: {
    maxDepth: 4,
    maxNodes: 20,
    branchLimit: 5,
    frontierLimit: 8,
    resultLimit: 3,
  },
  normal: {
    maxDepth: 8,
    maxNodes: 100,
    branchLimit: 8,
    frontierLimit: 24,
    resultLimit: 5,
  },
  deep: {
    maxDepth: 12,
    maxNodes: 500,
    branchLimit: 14,
    frontierLimit: 64,
    resultLimit: 8,
  },
};

function parseBooleanFlag(value, defaultValue) {
  if (value == null) return defaultValue;
  if (value === true || value === "1" || value === "true" || value === "on") return true;
  if (value === false || value === "0" || value === "false" || value === "off") return false;
  return defaultValue;
}

function parseOptionalNumber(value) {
  if (value == null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function parseKeyValueArgs(argv) {
  return (argv || []).reduce((result, token) => {
    const flag = String(token).match(/^--([^=]+)$/);
    if (flag) {
      result[flag[1]] = "1";
      return result;
    }
    const match = String(token).match(/^--([^=]+)=(.*)$/);
    if (match) result[match[1]] = match[2];
    return result;
  }, {});
}

function resolveProjectRoot(argsOrArgv, fallbackRoot) {
  const args = Array.isArray(argsOrArgv) ? parseKeyValueArgs(argsOrArgv) : (argsOrArgv || {});
  const configuredRoot = args["project-root"] || process.env.MOTA_PROJECT_ROOT;
  const projectRoot = path.resolve(configuredRoot || fallbackRoot || process.cwd());
  const projectDir = path.join(projectRoot, "project");
  if (!fs.existsSync(projectDir)) {
    throw new Error(`Invalid project root: ${projectRoot} (missing ${projectDir}). Pass --project-root=/path/to/tower-root.`);
  }
  return projectRoot;
}

function normalizeResourcePocketMode(args) {
  const mode = String(((args || {})["resource-pocket-mode"] || "")).trim().toLowerCase();
  if (mode) {
    if (!Object.prototype.hasOwnProperty.call(RESOURCE_POCKET_MODE_PRESETS, mode)) {
      throw new Error(`Invalid --resource-pocket-mode=${mode}. Expected off, lite, normal, or deep.`);
    }
    return mode;
  }
  const legacy = (args || {})["resource-pocket"];
  if (legacy != null && parseBooleanFlag(legacy, true) === false) return "off";
  return null;
}

function shouldEnableResourcePocket(args, defaultValue) {
  const mode = normalizeResourcePocketMode(args);
  if (mode === "off") return false;
  if (mode) return true;
  return parseBooleanFlag((args || {})["resource-pocket"], defaultValue);
}

function buildResourcePocketSearchOptions(args) {
  const mode = normalizeResourcePocketMode(args);
  const preset = mode && mode !== "off" ? RESOURCE_POCKET_MODE_PRESETS[mode] : null;
  const optionMap = {
    maxDepth: "resource-pocket-max-depth",
    maxNodes: "resource-pocket-max-nodes",
    branchLimit: "resource-pocket-branch-limit",
    frontierLimit: "resource-pocket-frontier-limit",
    resultLimit: "resource-pocket-result-limit",
  };
  const options = preset ? { ...preset } : {};
  Object.entries(optionMap).forEach(([key, argName]) => {
    const parsed = parseOptionalNumber((args || {})[argName]);
    if (parsed !== undefined) options[key] = parsed;
  });
  if ((args || {})["resource-pocket-continue-after-forward-change-floor"] != null) {
    options.continueAfterForwardChangeFloor = parseBooleanFlag(
      args["resource-pocket-continue-after-forward-change-floor"],
      false
    );
  }
  return Object.keys(options).length > 0 ? options : undefined;
}

module.exports = {
  RESOURCE_POCKET_MODE_PRESETS,
  buildResourcePocketSearchOptions,
  normalizeResourcePocketMode,
  parseKeyValueArgs,
  parseBooleanFlag,
  parseOptionalNumber,
  resolveProjectRoot,
  shouldEnableResourcePocket,
};
