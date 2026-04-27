"use strict";

const path = require("node:path");

const { getMilestoneSpec } = require("./lib/milestone-spec");
const { loadProject } = require("./lib/project-loader");

const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");

function parseArgs(argv) {
  return argv.reduce((result, arg) => {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) result[match[1]] = match[2];
    return result;
  }, {});
}

function tileKey(tile) {
  if (!tile || tile.floorId == null || tile.x == null || tile.y == null) return null;
  return `${tile.floorId}:${tile.x},${tile.y}`;
}

function parseActionTileKey(summary) {
  const match = /^[^@]+@([^:]+):(\d+),(\d+)(?:\b|$)/.exec(String(summary || ""));
  return match ? `${match[1]}:${match[2]},${match[3]}` : null;
}

function goalUsedTileKeys(milestone) {
  const goal = (milestone || {}).goal || {};
  const keys = new Set();
  for (const tile of goal.removedTiles || []) {
    const key = tileKey(tile);
    if (key) keys.add(key);
  }
  if ((goal.type === "bossDefeated" || goal.type === "tileRemoved") && goal.floorId != null) {
    const key = tileKey(goal);
    if (key) keys.add(key);
  }
  const actionKey = goal.actionSurvivable && parseActionTileKey(goal.actionSurvivable.summary);
  if (actionKey) keys.add(actionKey);
  return keys;
}

function hasReason(entry) {
  return typeof (entry || {}).reason === "string" && entry.reason.trim().length > 0;
}

function auditMilestones(spec) {
  const milestones = spec.milestones || [];
  const errors = [];
  const warnings = [];
  const futureUsedByIndex = milestones.map((unused, index) => {
    const keys = new Set();
    for (let next = index + 1; next < milestones.length; next += 1) {
      for (const key of goalUsedTileKeys(milestones[next])) keys.add(key);
    }
    return keys;
  });

  milestones.forEach((milestone, index) => {
    const goal = milestone.goal || {};
    const dp = milestone.dp || {};
    const hardPresent = new Set((goal.presentTiles || []).map(tileKey).filter(Boolean));
    const softPresent = new Set((goal.preferredPresentTiles || []).map(tileKey).filter(Boolean));
    const removed = new Set((goal.removedTiles || []).map(tileKey).filter(Boolean));

    if ((dp.keyMode || dp.dpKeyMode) === "mutation" && !hasReason({ reason: dp.safeReason })) {
      errors.push(`${milestone.id}: mutation keyMode must include dp.safeReason`);
    }

    if (dp.stopOnFirstGoal === true && !hasReason({ reason: dp.firstGoalSafeReason })) {
      errors.push(`${milestone.id}: stopOnFirstGoal=true must include dp.firstGoalSafeReason`);
    }

    for (const key of softPresent) {
      if (hardPresent.has(key)) {
        errors.push(`${milestone.id}: preferredPresentTiles duplicates hard presentTiles: ${key}`);
      }
    }

    for (const key of removed) {
      if (hardPresent.has(key)) {
        errors.push(`${milestone.id}: same tile cannot be both removedTiles and presentTiles: ${key}`);
      }
    }

    for (const tile of goal.presentTiles || []) {
      const key = tileKey(tile);
      if (!key) {
        errors.push(`${milestone.id}: presentTiles entry is missing floorId/x/y`);
        continue;
      }
      if (!futureUsedByIndex[index].has(key) && !hasReason(tile)) {
        errors.push(`${milestone.id}: presentTile ${key} is not used by a later segment and has no reason`);
      }
    }

    for (const tile of goal.preferredPresentTiles || []) {
      const key = tileKey(tile);
      if (!key) {
        errors.push(`${milestone.id}: preferredPresentTiles entry is missing floorId/x/y`);
        continue;
      }
      if (!futureUsedByIndex[index].has(key) && !hasReason(tile)) {
        warnings.push(`${milestone.id}: preferredPresentTile ${key} is not used later; keep as soft hint only if it protects route quality`);
      }
    }

    if ((goal.minHero || {}).hp > 1 && !goal.toleranceNote) {
      warnings.push(`${milestone.id}: minHero.hp=${goal.minHero.hp} has no toleranceNote; verify this is not an overfitted exact threshold`);
    }

    if ((goal.removedTiles || []).length > 0 && !goal.removedTiles.some(hasReason)) {
      warnings.push(`${milestone.id}: removedTiles have no per-tile reason; verify each target is necessary for this milestone`);
    }
  });

  return {
    routeName: spec.routeName,
    milestones: milestones.length,
    errors,
    warnings,
    summary: {
      errorCount: errors.length,
      warningCount: warnings.length,
      mutationMilestones: milestones.filter((milestone) => ((milestone.dp || {}).keyMode || (milestone.dp || {}).dpKeyMode) === "mutation").length,
      firstGoalMilestones: milestones.filter((milestone) => (milestone.dp || {}).stopOnFirstGoal === true).length,
      hardPresentTiles: milestones.reduce((sum, milestone) => sum + (((milestone.goal || {}).presentTiles || []).length), 0),
      preferredPresentTiles: milestones.reduce((sum, milestone) => sum + (((milestone.goal || {}).preferredPresentTiles || []).length), 0),
    },
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = path.resolve(args["project-root"] || DEFAULT_PROJECT_ROOT);
  const routeName = args["route-name"] || "onlyup-chaos-mt5-blueking";
  const project = loadProject(projectRoot);
  const report = auditMilestones(getMilestoneSpec(project, routeName));
  console.log(JSON.stringify(report, null, 2));
  if (report.errors.length > 0) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = {
  auditMilestones,
};
