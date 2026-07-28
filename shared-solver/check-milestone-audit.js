"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");

const { getMilestoneSpec } = require("./lib/milestone-spec");
const { loadProject } = require("./lib/project-loader");
const { summarizeSegmentFailure } = require("./lib/segment-dp");
const {
  createInitialState,
  getTileDefinitionAt,
  removeTileAt,
} = require("./lib/state");

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

function parseTileKey(key) {
  const match = /^([^:]+):(\d+),(\d+)$/.exec(String(key || ""));
  return match ? { floorId: match[1], x: Number(match[2]), y: Number(match[3]) } : null;
}

function parseActionSummary(summary) {
  const match = /^(pickup|battle|openDoor|changeFloor|event):?([^@]*)@([^:]+):(\d+),(\d+)(?:\b|$)/.exec(String(summary || ""));
  if (!match) return null;
  return {
    kind: match[1],
    id: match[2] || null,
    floorId: match[3],
    x: Number(match[4]),
    y: Number(match[5]),
  };
}

function floorExists(project, floorId) {
  return Boolean(project && project.floorsById && project.floorsById[floorId]);
}

function coordinateInBounds(project, floorId, x, y) {
  const floor = project && project.floorsById && project.floorsById[floorId];
  if (!floor) return false;
  return x >= 0 && y >= 0 && x < Number(floor.width || 0) && y < Number(floor.height || 0);
}

function baseTileAt(project, initialState, floorId, x, y) {
  if (!floorExists(project, floorId) || !coordinateInBounds(project, floorId, x, y)) return null;
  return getTileDefinitionAt(project, initialState, floorId, x, y);
}

function expectedTileId(tile) {
  return tile && (tile.expectedId || tile.tileId || tile.id || null);
}

function expectedTileClass(tile) {
  return tile && (tile.expectedClass || tile.tileClass || tile.cls || null);
}

function auditTileReference(project, initialState, milestoneId, label, tile, errors) {
  const key = tileKey(tile);
  if (!key) {
    errors.push(`${milestoneId}: ${label} entry is missing floorId/x/y`);
    return null;
  }
  if (!floorExists(project, tile.floorId)) {
    errors.push(`${milestoneId}: ${label} ${key} references missing floor`);
    return null;
  }
  if (!coordinateInBounds(project, tile.floorId, Number(tile.x), Number(tile.y))) {
    errors.push(`${milestoneId}: ${label} ${key} is outside floor bounds`);
    return null;
  }
  const definition = baseTileAt(project, initialState, tile.floorId, Number(tile.x), Number(tile.y));
  if (!definition) {
    errors.push(`${milestoneId}: ${label} ${key} has no initial map tile`);
    return null;
  }
  const wantedId = expectedTileId(tile);
  if (wantedId && definition.id !== wantedId) {
    errors.push(`${milestoneId}: ${label} ${key} expected tile id ${wantedId}, actual ${definition.id || definition.number}`);
  }
  const wantedClass = expectedTileClass(tile);
  if (wantedClass && definition.cls !== wantedClass) {
    errors.push(`${milestoneId}: ${label} ${key} expected tile class ${wantedClass}, actual ${definition.cls || "unknown"}`);
  }
  return definition;
}

function auditActionSummaryReference(project, initialState, milestoneId, label, summary, errors) {
  const parsed = parseActionSummary(summary);
  if (!parsed) return;
  const tile = auditTileReference(project, initialState, milestoneId, label, parsed, errors);
  if (!tile) return;
  if (parsed.kind === "battle") {
    if (tile.cls !== "enemys") errors.push(`${milestoneId}: ${label} ${summary} targets non-enemy tile ${tile.id || tile.number}`);
    if (parsed.id && tile.id !== parsed.id) errors.push(`${milestoneId}: ${label} ${summary} expected enemy ${parsed.id}, actual ${tile.id || tile.number}`);
  }
  if (parsed.kind === "pickup" && tile.cls !== "items") {
    errors.push(`${milestoneId}: ${label} ${summary} targets non-item tile ${tile.id || tile.number}`);
  }
  if (parsed.kind === "openDoor" && tile.cls !== "terrains") {
    errors.push(`${milestoneId}: ${label} ${summary} targets non-terrain door tile ${tile.id || tile.number}`);
  }
}

function auditChangeFloorReference(project, initialState, milestoneId, key, errors) {
  const parsed = parseTileKey(key);
  if (!parsed) {
    errors.push(`${milestoneId}: allowChangeFloors entry is invalid: ${key}`);
    return;
  }
  const tile = auditTileReference(project, initialState, milestoneId, "allowChangeFloors", parsed, errors);
  if (!tile) return;
  const floor = project.floorsById[parsed.floorId];
  const changeFloor = floor.changeFloor || {};
  const loc = `${parsed.x},${parsed.y}`;
  if (!changeFloor[loc]) {
    errors.push(`${milestoneId}: allowChangeFloors ${key} is not a configured changeFloor coordinate`);
  }
  if (!["upFloor", "downFloor", "portal"].includes(String(tile.id || ""))) {
    errors.push(`${milestoneId}: allowChangeFloors ${key} tile is ${tile.id || tile.number}, not a stair/portal tile`);
  }
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

function auditMilestones(spec, project) {
  const milestones = spec.milestones || [];
  const errors = [];
  const warnings = [];
  const initialState = project ? createInitialState(project, { rank: "chaos" }) : null;
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

    if (goal.floorId && project && !floorExists(project, goal.floorId)) {
      errors.push(`${milestone.id}: goal.floorId references missing floor: ${goal.floorId}`);
    }

    if ((goal.type === "bossDefeated" || goal.type === "tileRemoved") && project && initialState) {
      const targetTile = auditTileReference(project, initialState, milestone.id, goal.type, goal, errors);
      if (targetTile && goal.type === "bossDefeated") {
        if (targetTile.cls !== "enemys") {
          errors.push(`${milestone.id}: bossDefeated target ${tileKey(goal)} is not an enemy tile`);
        }
        if (goal.enemyId && targetTile.id !== goal.enemyId) {
          errors.push(`${milestone.id}: bossDefeated target ${tileKey(goal)} expected ${goal.enemyId}, actual ${targetTile.id || targetTile.number}`);
        }
      }
    }

    if (project && initialState) {
      for (const tile of goal.removedTiles || []) auditTileReference(project, initialState, milestone.id, "removedTiles", tile, errors);
      for (const tile of goal.presentTiles || []) auditTileReference(project, initialState, milestone.id, "presentTiles", tile, errors);
      for (const tile of goal.preferredPresentTiles || []) auditTileReference(project, initialState, milestone.id, "preferredPresentTiles", tile, errors);
      for (const key of (milestone.actionPolicy || {}).allowChangeFloors || []) auditChangeFloorReference(project, initialState, milestone.id, key, errors);
      if (goal.actionSurvivable && goal.actionSurvivable.summary) {
        auditActionSummaryReference(project, initialState, milestone.id, "actionSurvivable", goal.actionSurvivable.summary, errors);
      }
    }

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
      if (
        !futureUsedByIndex[index].has(key) &&
        !hasReason(tile) &&
        !tile.propagatedFromMilestone
      ) {
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
  const spec = getMilestoneSpec(project, routeName);
  const report = auditMilestones(spec, project);
  if (routeName === "onlyup-chaos-mt5-blueking") {
    const hp3834 = spec.milestones.find((milestone) => milestone.id === "mt2-hp3834");
    const leftChain = spec.milestones.find((milestone) => milestone.id === "mt2-left-chain-open");
    const hardKeys = new Set((leftChain.goal.presentTiles || []).map(tileKey));
    const propagated = new Set((hp3834.goal.presentTiles || []).map(tileKey));
    for (const key of hardKeys) assert.ok(propagated.has(key), `mt2-hp3834 must preserve ${key}`);
    for (const tile of leftChain.goal.preferredPresentTiles || []) {
      assert.equal(propagated.has(tileKey(tile)), false, `soft tile must not propagate: ${tileKey(tile)}`);
    }

    const incompatibleStart = createInitialState(project, { rank: "chaos" });
    removeTileAt(incompatibleStart, "MT2", 4, 7);
    const incompatible = summarizeSegmentFailure(
      project,
      leftChain,
      { bestSeenState: incompatibleStart, frontierSize: 0, diagnostics: { dp: {} } },
      { project },
      incompatibleStart,
    );
    assert.equal(incompatible.failureClass, "upstream-checkpoint-incompatible");
    assert.equal(incompatible.upstreamCheckpointIncompatible.length, 1);

    const noReasonSegment = {
      ...leftChain,
      goal: {
        ...leftChain.goal,
        presentTiles: [leftChain.goal.presentTiles.find((tile) => tile.x === 11 && tile.y === 11)],
      },
    };
    const nonExplicitStart = createInitialState(project, { rank: "chaos" });
    removeTileAt(nonExplicitStart, "MT2", 11, 11);
    const nonExplicit = summarizeSegmentFailure(
      project,
      noReasonSegment,
      { bestSeenState: nonExplicitStart, frontierSize: 0, diagnostics: { dp: {} } },
      { project },
      nonExplicitStart,
    );
    assert.equal(nonExplicit.failureClass, "present-tile-overconstrained");
  }
  console.log(JSON.stringify(report, null, 2));
  if (report.errors.length > 0) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = {
  auditMilestones,
};
