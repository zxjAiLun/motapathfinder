"use strict";

const fs = require("fs");
const path = require("path");

const { configureFloorOrder } = require("./floor-id");
const { parseBooleanFlag } = require("./cli-options");

function readJsonIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function parseFloorOrder(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string") {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return null;
}

function boolToArg(value) {
  if (value == null) return undefined;
  return value ? "1" : "0";
}

function defaultProjectId(projectRoot, project) {
  const title = project && project.data && project.data.firstData && project.data.firstData.title;
  return title || path.basename(projectRoot);
}

function normalizeDefaults(profileConfig) {
  const defaults = { ...((profileConfig || {}).defaults || {}) };
  const result = {};
  const mappings = {
    resourcePocketMode: "resource-pocket-mode",
    resourceCluster: "resource-cluster",
    resourceChain: "resource-chain",
    fightToLevelUp: "fight-to-levelup",
    searchGraph: "search-graph",
    checkpointReuse: "checkpoint-reuse",
    checkpointSave: "checkpoint-save",
    confluence: "confluence",
    confluenceRoutePolicy: "confluence-route-policy",
    confluenceRouteSlack: "confluence-route-slack",
    confluenceRepresentatives: "confluence-representatives",
    confluenceMinFloor: "confluence-min-floor",
  };
  Object.entries(mappings).forEach(([source, target]) => {
    if (defaults[source] == null) return;
    result[target] = typeof defaults[source] === "boolean" ? boolToArg(defaults[source]) : String(defaults[source]);
  });
  return result;
}

function getProfileConfig(rawConfig, profileName) {
  return ((rawConfig || {}).profiles || {})[profileName] || {};
}

function resolveProfileName(args, rawConfig) {
  return args.profile || (rawConfig && rawConfig.profile) || "default";
}

function resolveConfigPath(projectRoot, args) {
  const configured = args.config || "solver.config.json";
  return path.isAbsolute(configured) ? configured : path.resolve(projectRoot, configured);
}

function createRouteContext(project, rawConfig, args) {
  const configuredFloorOrder = parseFloorOrder(args["floor-order"]) ||
    parseFloorOrder(rawConfig && rawConfig.route && rawConfig.route.floorOrder) ||
    ((project || {}).floorOrder || []).slice();
  const floorOrder = configuredFloorOrder.length > 0 ? configuredFloorOrder : ((project || {}).floorOrder || []).slice();
  const floorIndexById = {};
  floorOrder.forEach((floorId, index) => {
    floorIndexById[floorId] = index + 1;
  });
  const startFloor = args["from-floor"] || (rawConfig && rawConfig.route && rawConfig.route.startFloor) || floorOrder[0] || "MT1";
  const targetFloor = args["to-floor"] || (rawConfig && rawConfig.route && rawConfig.route.targetFloor) || floorOrder[floorOrder.length - 1] || "MT11";
  const getConfiguredFloorOrder = (floorId) => {
    if (floorIndexById[floorId] != null) return floorIndexById[floorId];
    return -1;
  };
  return {
    floorOrder,
    floorIndexById,
    startFloor,
    targetFloor,
    targetIndex: getConfiguredFloorOrder(targetFloor),
    getFloorOrder: getConfiguredFloorOrder,
    isForwardFloorChange: (fromFloorId, toFloorId) => getConfiguredFloorOrder(toFloorId) > getConfiguredFloorOrder(fromFloorId),
  };
}

function loadSolverConfig(projectRoot, project, args) {
  const configPath = resolveConfigPath(projectRoot, args || {});
  const rawConfig = readJsonIfExists(configPath) || {};
  const profileName = resolveProfileName(args || {}, rawConfig);
  const profileConfig = getProfileConfig(rawConfig, profileName);
  const inheritedProfileName = profileConfig.extends || profileName;
  const searchDefaults = normalizeDefaults(profileConfig);
  const routeContext = createRouteContext(project, rawConfig, args || {});
  configureFloorOrder(routeContext.floorOrder);
  const checkpointPath =
    (args || {})["checkpoint-store"] ||
    (rawConfig.checkpoints && rawConfig.checkpoints.path) ||
    `solver/checkpoints/${profileName}.checkpoint-skyline.json`;
  const checkpointEnabled = parseBooleanFlag((args || {})["checkpoint-enabled"], rawConfig.checkpoints ? rawConfig.checkpoints.enabled !== false : true);
  return {
    configPath: fs.existsSync(configPath) ? configPath : null,
    rawConfig,
    projectRoot,
    projectId: (rawConfig.project && rawConfig.project.id) || defaultProjectId(projectRoot, project),
    profileName,
    inheritedProfileName,
    routeContext,
    searchDefaults,
    checkpointConfig: {
      enabled: checkpointEnabled,
      path: path.isAbsolute(checkpointPath) ? checkpointPath : path.resolve(projectRoot, checkpointPath),
      relativePath: checkpointPath,
    },
  };
}

function applyConfigDefaults(args, resolvedConfig) {
  const merged = { ...(args || {}) };
  Object.entries((resolvedConfig && resolvedConfig.searchDefaults) || {}).forEach(([key, value]) => {
    if (merged[key] == null) merged[key] = value;
  });
  if (resolvedConfig && resolvedConfig.profileName && merged.profile == null) merged.profile = resolvedConfig.profileName;
  if (resolvedConfig && resolvedConfig.routeContext && merged["to-floor"] == null) merged["to-floor"] = resolvedConfig.routeContext.targetFloor;
  if (resolvedConfig && resolvedConfig.checkpointConfig && merged["checkpoint-store"] == null) {
    merged["checkpoint-store"] = resolvedConfig.checkpointConfig.relativePath;
  }
  return merged;
}

module.exports = {
  applyConfigDefaults,
  loadSolverConfig,
};
