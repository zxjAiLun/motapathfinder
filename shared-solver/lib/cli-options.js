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
const DEFAULT_RESOURCE_POCKET_MODE = "lite";

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

function findConfiguredProjectRoot(baseRoot) {
  const root = path.resolve(baseRoot || process.cwd());
  const candidates = [];
  const visit = (dir, depth) => {
    if (depth > 4) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      return;
    }
    const hasProject = fs.existsSync(path.join(dir, "project"));
    const hasConfig = fs.existsSync(path.join(dir, "solver.config.json"));
    if (hasProject && hasConfig) {
      candidates.push(dir);
      return;
    }
    entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules")
      .forEach((entry) => visit(path.join(dir, entry.name), depth + 1));
  };
  visit(root, 0);
  return candidates.length === 1 ? candidates[0] : null;
}

function resolveProjectRoot(argsOrArgv, fallbackRoot) {
  const args = Array.isArray(argsOrArgv) ? parseKeyValueArgs(argsOrArgv) : (argsOrArgv || {});
  const configuredRoot = args["project-root"] || process.env.MOTA_PROJECT_ROOT;
  let projectRoot = path.resolve(configuredRoot || fallbackRoot || process.cwd());
  const projectDir = path.join(projectRoot, "project");
  if (!fs.existsSync(projectDir)) {
    const discoveredRoot = !configuredRoot ? findConfiguredProjectRoot(projectRoot) : null;
    if (discoveredRoot) return discoveredRoot;
    throw new Error(`Invalid project root: ${projectRoot} (missing ${projectDir}). Pass --project-root=/path/to/tower-root.`);
  }
  return projectRoot;
}

function normalizeResourcePocketMode(args, defaultMode) {
  const mode = String(((args || {})["resource-pocket-mode"] || "")).trim().toLowerCase();
  if (mode) {
    if (!Object.prototype.hasOwnProperty.call(RESOURCE_POCKET_MODE_PRESETS, mode)) {
      throw new Error(`Invalid --resource-pocket-mode=${mode}. Expected off, lite, normal, or deep.`);
    }
    return mode;
  }
  const legacy = (args || {})["resource-pocket"];
  if (legacy != null && parseBooleanFlag(legacy, true) === false) return "off";
  if (legacy != null && parseBooleanFlag(legacy, false) === true) return defaultMode || DEFAULT_RESOURCE_POCKET_MODE;
  return defaultMode || null;
}

function shouldEnableResourcePocket(args, defaultValue) {
  const mode = normalizeResourcePocketMode(args, defaultValue ? DEFAULT_RESOURCE_POCKET_MODE : null);
  if (mode === "off") return false;
  if (mode) return true;
  return parseBooleanFlag((args || {})["resource-pocket"], defaultValue);
}

function buildResourcePocketSearchOptions(args, defaultMode) {
  const mode = normalizeResourcePocketMode(args, defaultMode || DEFAULT_RESOURCE_POCKET_MODE);
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

function buildConfluenceDominanceOptions(args, profileDefault, profileRoutePolicy) {
  const routePolicy = String((args || {})["confluence-route-policy"] || profileRoutePolicy || "slack").trim() || "slack";
  if (!["slack", "ignore-length"].includes(routePolicy)) {
    throw new Error(`Invalid --confluence-route-policy=${routePolicy}. Expected slack or ignore-length.`);
  }
  const options = {
    enableConfluenceHpDominance: parseBooleanFlag((args || {}).confluence, Boolean(profileDefault)),
    confluenceRoutePolicy: routePolicy,
    confluenceRouteSlack: Number((args || {})["confluence-route-slack"] || 12),
    confluenceRepresentatives: Number((args || {})["confluence-representatives"] || 3),
    confluenceMinFloorOrder: Number((args || {})["confluence-min-floor"] || 1),
  };
  if (!Number.isFinite(options.confluenceRouteSlack)) options.confluenceRouteSlack = 12;
  if (!Number.isFinite(options.confluenceRepresentatives)) options.confluenceRepresentatives = 3;
  if (!Number.isFinite(options.confluenceMinFloorOrder)) options.confluenceMinFloorOrder = 1;
  return options;
}

function buildActionExpansionCacheOptions(args) {
  const actionExpansionCacheLimit =
    parseOptionalNumber((args || {})["action-cache-limit"]) ??
    parseOptionalNumber((args || {})["action-expansion-cache-limit"]);
  const battleEstimateCacheLimit =
    parseOptionalNumber((args || {})["battle-cache-limit"]) ??
    parseOptionalNumber((args || {})["battle-estimate-cache-limit"]);
  const options = {
    enableActionExpansionCache: parseBooleanFlag((args || {})["action-expansion-cache"], true),
    enableBattleEstimateCache: parseBooleanFlag((args || {})["battle-estimate-cache"], true),
  };
  if (actionExpansionCacheLimit !== undefined) options.actionExpansionCacheLimit = actionExpansionCacheLimit;
  if (battleEstimateCacheLimit !== undefined) options.battleEstimateCacheLimit = battleEstimateCacheLimit;
  return options;
}

module.exports = {
  DEFAULT_RESOURCE_POCKET_MODE,
  RESOURCE_POCKET_MODE_PRESETS,
  buildActionExpansionCacheOptions,
  buildConfluenceDominanceOptions,
  buildResourcePocketSearchOptions,
  normalizeResourcePocketMode,
  parseKeyValueArgs,
  parseBooleanFlag,
  parseOptionalNumber,
  resolveProjectRoot,
  shouldEnableResourcePocket,
};
