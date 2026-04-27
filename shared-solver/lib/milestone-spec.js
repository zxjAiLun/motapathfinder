"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_ROUTE_NAME = "onlyup-chaos-mt5-blueking";
const MILESTONE_DIR = path.resolve(__dirname, "..", "milestones");

const DEFAULT_ACTION_KINDS = [
  "battle",
  "pickup",
  "equip",
  "openDoor",
  "useTool",
  "changeFloor",
  "event",
];

const BASE_DP = {
  keyMode: "region",
  stopOnFirstGoal: false,
  maxActionsPerState: 9999,
  maxExpansions: 8000,
  maxRuntimeMs: 15000,
  goalSkylineLimit: 8,
};

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function routeFilePath(routeName) {
  const name = routeName || DEFAULT_ROUTE_NAME;
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(name)) throw new Error(`Invalid milestone route name: ${name}`);
  return path.join(MILESTONE_DIR, `${name}.json`);
}

function loadMilestoneData(routeName) {
  const name = routeName || DEFAULT_ROUTE_NAME;
  const filePath = routeFilePath(name);
  if (!fs.existsSync(filePath)) throw new Error(`Unknown milestone route: ${name}`);
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Failed to parse milestone route ${name}: ${error.message}`);
  }
}

function normalizeMilestone(milestone) {
  return {
    ...milestone,
    goal: cloneJson(milestone.goal || {}),
    actionPolicy: {
      actionKinds: DEFAULT_ACTION_KINDS.slice(),
      forbidUnsupportedEvents: true,
      ...(milestone.actionPolicy || {}),
    },
    dp: {
      ...BASE_DP,
      ...(milestone.dp || {}),
    },
  };
}

function validateTileList(routeName, milestone, fieldName, errors) {
  const tiles = ((milestone.goal || {})[fieldName]) || [];
  if (!Array.isArray(tiles)) {
    errors.push(`${routeName}/${milestone.id}: goal.${fieldName} must be an array`);
    return;
  }
  tiles.forEach((tile, index) => {
    if (!tile || typeof tile.floorId !== "string" || tile.x == null || tile.y == null) {
      errors.push(`${routeName}/${milestone.id}: goal.${fieldName}[${index}] must include floorId/x/y`);
    }
  });
}

function validateMilestoneSpec(spec) {
  const errors = [];
  if (!spec || typeof spec !== "object") {
    throw new Error("Milestone spec must be an object");
  }
  const routeName = spec.routeName;
  if (!routeName || typeof routeName !== "string") errors.push("routeName is required");
  if (!Array.isArray(spec.milestones) || spec.milestones.length === 0) errors.push(`${routeName || "unknown"}: milestones must be a non-empty array`);

  const seen = new Set();
  const previousIds = new Set();
  (spec.milestones || []).forEach((milestone, index) => {
    if (!milestone || typeof milestone !== "object") {
      errors.push(`${routeName}: milestones[${index}] must be an object`);
      return;
    }
    if (!milestone.id || typeof milestone.id !== "string") errors.push(`${routeName}: milestones[${index}] missing id`);
    if (milestone.id && seen.has(milestone.id)) errors.push(`${routeName}: duplicate milestone id ${milestone.id}`);
    if (milestone.id) seen.add(milestone.id);
    if (!milestone.label || typeof milestone.label !== "string") errors.push(`${routeName}/${milestone.id || index}: label is required`);
    if (!milestone.goal || typeof milestone.goal !== "object") errors.push(`${routeName}/${milestone.id || index}: goal is required`);
    if (milestone.startFrom && !previousIds.has(milestone.startFrom)) {
      errors.push(`${routeName}/${milestone.id}: startFrom must reference a previous milestone: ${milestone.startFrom}`);
    }
    validateTileList(routeName, milestone, "removedTiles", errors);
    validateTileList(routeName, milestone, "presentTiles", errors);
    validateTileList(routeName, milestone, "preferredPresentTiles", errors);
    if (milestone.id) previousIds.add(milestone.id);
  });

  if (errors.length > 0) {
    throw new Error(`Invalid milestone spec:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }
}

function normalizeSpec(project, rawSpec, requestedRouteName) {
  const spec = cloneJson(rawSpec);
  if (requestedRouteName && spec.routeName !== requestedRouteName) {
    throw new Error(`Milestone route mismatch: requested ${requestedRouteName}, file contains ${spec.routeName}`);
  }
  spec.milestones = (spec.milestones || []).map(normalizeMilestone);
  spec.projectTitle = project && project.data && project.data.firstData ? project.data.firstData.title : null;
  validateMilestoneSpec(spec);
  return spec;
}

function getMilestoneSpec(project, routeName) {
  const name = routeName || DEFAULT_ROUTE_NAME;
  return normalizeSpec(project, loadMilestoneData(name), name);
}

function listMilestones(project, routeName) {
  return getMilestoneSpec(project, routeName).milestones;
}

function getMilestoneById(project, routeName, milestoneId) {
  return listMilestones(project, routeName).find((milestone) => milestone.id === milestoneId) || null;
}

module.exports = {
  DEFAULT_ROUTE_NAME,
  getMilestoneById,
  getMilestoneSpec,
  listMilestones,
  validateMilestoneSpec,
};
