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
const RESOURCE_CLUSTER_MODE_PRESETS = {
  off: null,
  lite: {
    maxDepth: 3,
    maxNodes: 36,
    branchLimit: 4,
    frontierLimit: 24,
    resultLimit: 4,
    maxClusterActions: 12,
  },
  normal: {
    maxDepth: 5,
    maxNodes: 200,
    branchLimit: 6,
    frontierLimit: 64,
    resultLimit: 6,
    maxClusterActions: 12,
  },
  deep: {
    maxDepth: 8,
    maxNodes: 1000,
    branchLimit: 8,
    frontierLimit: 160,
    resultLimit: 8,
    maxClusterActions: 12,
  },
};
const DEFAULT_RESOURCE_CLUSTER_MODE = "normal";
const DEFAULT_RESOURCE_CHAIN_ENABLED = false;

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

function parseListFlag(value) {
  if (value == null || value === "") return [];
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
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
  const legacy = (args || {})["resource-pocket"];
  if (legacy != null && parseBooleanFlag(legacy, true) === false) return "off";
  const mode = String(((args || {})["resource-pocket-mode"] || "")).trim().toLowerCase();
  if (mode) {
    if (!Object.prototype.hasOwnProperty.call(RESOURCE_POCKET_MODE_PRESETS, mode)) {
      throw new Error(`Invalid --resource-pocket-mode=${mode}. Expected off, lite, normal, or deep.`);
    }
    return mode;
  }
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

function normalizeResourceClusterMode(args, defaultMode) {
  const legacy = (args || {})["resource-cluster"];
  if (legacy != null && parseBooleanFlag(legacy, true) === false) return "off";
  const mode = String(((args || {})["resource-cluster-mode"] || "")).trim().toLowerCase();
  if (mode) {
    if (!Object.prototype.hasOwnProperty.call(RESOURCE_CLUSTER_MODE_PRESETS, mode)) {
      throw new Error(`Invalid --resource-cluster-mode=${mode}. Expected off, lite, normal, or deep.`);
    }
    return mode;
  }
  if (legacy != null && parseBooleanFlag(legacy, false) === true) return defaultMode || DEFAULT_RESOURCE_CLUSTER_MODE;
  return defaultMode || null;
}

function shouldEnableResourceCluster(args, defaultValue) {
  const mode = normalizeResourceClusterMode(args, defaultValue ? DEFAULT_RESOURCE_CLUSTER_MODE : null);
  if (mode === "off") return false;
  if (mode) return true;
  return parseBooleanFlag((args || {})["resource-cluster"], defaultValue);
}

function buildResourceClusterSearchOptions(args, defaultMode) {
  const mode = normalizeResourceClusterMode(args, defaultMode || DEFAULT_RESOURCE_CLUSTER_MODE);
  const preset = mode && mode !== "off" ? RESOURCE_CLUSTER_MODE_PRESETS[mode] : null;
  const optionMap = {
    maxDepth: "resource-cluster-max-depth",
    maxNodes: "resource-cluster-max-nodes",
    branchLimit: "resource-cluster-branch-limit",
    frontierLimit: "resource-cluster-frontier-limit",
    resultLimit: "resource-cluster-result-limit",
    maxClusterActions: "resource-cluster-max-actions",
    maxOutputActions: "resource-cluster-max-output-actions",
    clusterRepresentatives: "resource-cluster-representatives",
    clusterLinkDistance: "resource-cluster-link-distance",
    clusterExpansionDistance: "resource-cluster-expansion-distance",
    foundationCandidateClusters: "resource-cluster-foundation-candidate-clusters",
    foundationMaxClusters: "resource-cluster-foundation-max-clusters",
    foundationRepresentatives: "resource-cluster-foundation-representatives",
    foundationFrontierLimit: "resource-cluster-foundation-frontier-limit",
    foundationLimit: "resource-cluster-foundation-limit",
    minCandidateActions: "resource-cluster-min-candidates",
    minResourceSignals: "resource-cluster-min-signals",
  };
  const options = preset ? { ...preset, mode } : {};
  Object.entries(optionMap).forEach(([key, argName]) => {
    const parsed = parseOptionalNumber((args || {})[argName]);
    if (parsed !== undefined) options[key] = parsed;
  });
  if ((args || {})["resource-cluster-group-local"] != null) {
    options.groupLocalClusters = parseBooleanFlag(args["resource-cluster-group-local"], true);
  }
  if ((args || {})["resource-cluster-compose-local"] != null) {
    options.composeLocalClusters = parseBooleanFlag(args["resource-cluster-compose-local"], true);
  }
  return Object.keys(options).length > 0 ? options : undefined;
}

function shouldEnableResourceChain(args, defaultValue) {
  return parseBooleanFlag((args || {})["resource-chain"], defaultValue);
}

function buildResourceChainOptions(args, defaults) {
  const config = defaults || {};
  const floorIds = parseListFlag((args || {})["resource-chain-floors"] || config.floorIds || config.floors);
  const floorOrders = parseListFlag((args || {})["resource-chain-floor-orders"] || config.floorOrders)
    .map(Number)
    .filter((value) => Number.isFinite(value));
  const minScore = parseOptionalNumber((args || {})["resource-chain-min-score"] || config.minScore);
  const options = {};
  if (floorIds.length > 0) options.floorIds = floorIds;
  if (floorOrders.length > 0) options.floorOrders = floorOrders;
  if (minScore !== undefined) options.minScore = minScore;
  return Object.keys(options).length > 0 ? options : undefined;
}

function buildConfluenceDominanceOptions(args, profileDefault, profileRoutePolicy) {
  const routePolicy = String((args || {})["confluence-route-policy"] || profileRoutePolicy || "slack").trim() || "slack";
  if (!["slack", "ignore-length"].includes(routePolicy)) {
    throw new Error(`Invalid --confluence-route-policy=${routePolicy}. Expected slack or ignore-length.`);
  }
  const profileName = String((args || {}).profile || (args || {}).profileName || "").trim();
  const defaultIgnoreLengthProfiles = profileName && profileName !== "linear-main"
    ? `linear-main,${profileName}`
    : "linear-main";
  const ignoreLengthFloors = parseListFlag((args || {})["confluence-ignore-length-floors"]);
  const ignoreLengthProfiles = parseListFlag((args || {})["confluence-ignore-length-profiles"] || defaultIgnoreLengthProfiles);
  const options = {
    enableConfluenceHpDominance: parseBooleanFlag((args || {}).confluence, Boolean(profileDefault)),
    confluenceRoutePolicy: routePolicy,
    confluenceRouteSlack: Number((args || {})["confluence-route-slack"] || 12),
    confluenceRepresentatives: Number((args || {})["confluence-representatives"] || 3),
    confluenceMinFloorOrder: Number((args || {})["confluence-min-floor"] || 1),
    confluenceIgnoreLengthFloors: ignoreLengthFloors,
    confluenceIgnoreLengthProfiles: ignoreLengthProfiles,
    confluenceIgnoreUnsafe: parseBooleanFlag((args || {})["confluence-ignore-unsafe"], profileName === "canonical-bfs"),
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
  DEFAULT_RESOURCE_CLUSTER_MODE,
  DEFAULT_RESOURCE_CHAIN_ENABLED,
  RESOURCE_CLUSTER_MODE_PRESETS,
  RESOURCE_POCKET_MODE_PRESETS,
  buildActionExpansionCacheOptions,
  buildConfluenceDominanceOptions,
  buildResourceChainOptions,
  buildResourceClusterSearchOptions,
  buildResourcePocketSearchOptions,
  normalizeResourceClusterMode,
  normalizeResourcePocketMode,
  parseKeyValueArgs,
  parseBooleanFlag,
  parseListFlag,
  parseOptionalNumber,
  resolveProjectRoot,
  shouldEnableResourceChain,
  shouldEnableResourceCluster,
  shouldEnableResourcePocket,
};
