"use strict";

const path = require("node:path");

const { parseBattleSummary } = require("./battle-thresholds");
const { cloneState, getTileDefinitionAt } = require("./state");
const { scanResourceIntents } = require("./resource-intent-scanner");
const { createStateFromSnapshot } = require("./route-store");

const DEFAULT_REPAIR_OPTIONS = {
  blockerRadius: 4,
  intentDepth: 1,
  maxIntentNodes: 60,
  maxIntentRecords: 12,
  recordsPerIntent: 4,
  maxIntents: 2,
  requireClear: true,
};

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isEnemyTile(project, tile) {
  if (!tile) return false;
  if (tile.cls && String(tile.cls).indexOf("enemy") === 0) return true;
  if (tile.trigger === "battle") return true;
  return Boolean(project.enemysById && tile.id && project.enemysById[tile.id]);
}

function isDoorTile(tile) {
  if (!tile) return false;
  return tile.trigger === "openDoor";
}

function coordinateKey(x, y) {
  return `${x},${y}`;
}

function isReachableViaWalk(simulator, state, floorId, x, y) {
  if (floorId !== state.floorId) return false;
  const reachability = simulator.getWalkReachability(state);
  return Boolean(reachability && reachability.visited && reachability.visited[coordinateKey(x, y)]);
}

function findBlockerCandidates(simulator, state, targetBattle, options) {
  const radius = Math.max(1, number(options.blockerRadius, 4));
  const floorId = targetBattle.floorId;
  const floor = simulator.project.floorsById[floorId];
  if (!floor) return [];
  const blockers = [];
  const seen = new Set();
  for (let y = Math.max(0, targetBattle.y - radius); y <= Math.min(floor.height - 1, targetBattle.y + radius); y += 1) {
    for (let x = Math.max(0, targetBattle.x - radius); x <= Math.min(floor.width - 1, targetBattle.x + radius); x += 1) {
      const tile = getTileDefinitionAt(simulator.project, state, floorId, x, y);
      if (!tile) continue;
      const enemy = isEnemyTile(simulator.project, tile);
      const door = isDoorTile(tile);
      if (!enemy && !door) continue;
      if (x === Number(targetBattle.x) && y === Number(targetBattle.y)) continue;
      const key = `${tile.id}@${floorId}:${x},${y}`;
      if (seen.has(key)) continue;
      const alreadyReachable = isReachableViaWalk(simulator, state, floorId, x, y);
      if (alreadyReachable) continue;
      seen.add(key);
      blockers.push({
        kind: enemy ? "enemy" : "door",
        enemyId: enemy ? tile.id : null,
        doorId: door ? tile.id : null,
        floorId,
        x,
        y,
        name: tile.name || tile.id,
      });
    }
  }
  return blockers;
}

function synthesizeFailureForBlocker(blocker, finding) {
  const reasonField = blocker.kind === "enemy"
    ? {
        field: "actionSurvivable",
        expected: `battle:${blocker.enemyId}@${blocker.floorId}:${blocker.x},${blocker.y}`,
        actual: "blocker-walk-unreachable",
        damage: 0,
      }
    : {
        field: "removedTiles",
        expected: `${blocker.floorId}:${blocker.x},${blocker.y}=removed`,
        actual: "door-blocker",
      };
  return {
    failureClass: blocker.kind === "enemy" ? "target-action-unreachable" : "target-tile-not-cleared",
    missingGoalFields: [reasonField],
    targetBlocker: blocker,
    cheaper: finding && finding.cheaper,
  };
}

function buildBlockerRepairMilestone(simulator, intent, blocker, finding, options) {
  const primaryRecord = (intent.records && intent.records[0]) || null;
  const actionSummary = primaryRecord ? primaryRecord.actionSummary : null;
  const floorId = blocker.floorId;
  const id = `route-audit-repair:step-${finding.stepIndex}:${blocker.kind}:${blocker.enemyId || blocker.doorId}@${floorId}:${blocker.x},${blocker.y}`;
  const goal = {
    type: "adaptiveResourceIntent",
    floorId,
  };
  if (actionSummary && actionSummary.startsWith("battle:")) {
    goal.actionSurvivable = { summary: actionSummary };
  } else if (actionSummary && (actionSummary.startsWith("pickup:") || actionSummary.startsWith("interactPickup:"))) {
    goal.tileRemoved = actionSummary.split(":").slice(1).join(":");
  } else if (actionSummary && actionSummary.startsWith("openDoor:")) {
    goal.actionSurvivable = { summary: actionSummary };
  } else if (blocker.kind === "enemy") {
    goal.actionSurvivable = {
      summary: `battle:${blocker.enemyId}@${floorId}:${blocker.x},${blocker.y}`,
    };
  } else if (blocker.kind === "door") {
    goal.presentTiles = [{ floorId, x: blocker.x, y: blocker.y, reason: "door blocker" }];
    goal.removedTiles = [{ floorId, x: blocker.x, y: blocker.y }];
  }
  const policy = intent.actionPolicy || {
    actionKinds: ["battle", "pickup", "equip", "openDoor", "useTool", "changeFloor", "floorFly", "event"],
  };
  const floorOrder = simulator.project.floorOrder || [];
  const blockerIndex = floorOrder.indexOf(floorId);
  const blockerAllowed = new Set([floorId]);
  if (blockerIndex >= 0) {
    for (let i = 0; i < floorOrder.length; i += 1) {
      if (Math.abs(i - blockerIndex) <= 1) blockerAllowed.add(floorOrder[i]);
    }
  }
  return {
    id,
    label: `Route-audit clear blocker ${blocker.kind} ${blocker.enemyId || blocker.doorId}@${floorId}:${blocker.x},${blocker.y}`,
    startFrom: "previous",
    goal,
    actionPolicy: {
      actionKinds: policy.actionKinds || ["battle", "pickup", "equip", "openDoor", "useTool", "changeFloor", "floorFly", "event"],
      allowedFloors: Array.from(blockerAllowed).sort(),
      allowChangeFloors: policy.allowChangeFloors || undefined,
      forbidUnsupportedEvents: true,
    },
    dp: {
      keyMode: "region",
      stopOnFirstGoal: true,
      goalSkylineLimit: 8,
      dpSkylineMax: 1,
      maxExpansions: 4000,
      maxRuntimeMs: 8000,
    },
    _meta: {
      generatedBy: "route-audit-blocker-repair",
      source: "route-audit",
      stepIndex: finding.stepIndex,
      blockerKind: blocker.kind,
      blocker: {
        floorId,
        x: blocker.x,
        y: blocker.y,
        enemyId: blocker.enemyId,
        doorId: blocker.doorId,
        name: blocker.name,
      },
      topAction: actionSummary,
      topIntentKind: intent.kind,
    },
  };
}

function planBlockerRepairs(simulator, project, timeline, auditResult, options) {
  const config = { ...DEFAULT_REPAIR_OPTIONS, ...(options || {}) };
  const repairs = [];
  const steps = Array.isArray(timeline && timeline.steps) ? timeline.steps : [];
  const verification = auditResult && auditResult.verification ? auditResult.verification : auditResult;
  const verificationResults = (verification && verification.results) || [];
  for (const result of verificationResults) {
    if (result.reason !== "cheaper-unreachable") continue;
    const stepIndex = result.stepIndex;
    const preStep = steps[stepIndex - 1];
    if (!preStep || !preStep.snapshot) continue;
    let startState;
    try {
      startState = createStateFromSnapshot(project, preStep.snapshot, { rank: "chaos" });
    } catch (error) {
      continue;
    }
    const cheaperRecord = (auditResult.findings || []).find((f) => f.stepIndex === stepIndex);
    const cheaperSummary = cheaperRecord && cheaperRecord.cheaper && cheaperRecord.cheaper[0]
      ? cheaperRecord.cheaper[0].summary
      : null;
    const targetBattle = parseBattleSummary(cheaperSummary);
    if (!targetBattle) continue;
    const blockers = findBlockerCandidates(simulator, startState, targetBattle, config);
    if (blockers.length === 0) continue;
    for (const blocker of blockers) {
      const failure = synthesizeFailureForBlocker(blocker, cheaperRecord);
      let intent;
      try {
        const scanned = scanResourceIntents(simulator, [{ id: `route-audit-blocker:${stepIndex}`, state: startState }], failure, {
          intentDepth: config.intentDepth,
          maxIntentNodes: config.maxIntentNodes,
          maxIntentRecords: config.maxIntentRecords,
          recordsPerIntent: config.recordsPerIntent,
          maxIntents: config.maxIntents,
          includeBlockedResources: true,
        });
        intent = scanned && scanned[0];
      } catch (error) {
        intent = null;
      }
      if (!intent) continue;
      const milestone = buildBlockerRepairMilestone(simulator, intent, blocker, cheaperRecord, config);
      repairs.push({
        stepIndex,
        blocker,
        intent,
        milestone,
      });
    }
  }
  return repairs;
}

function summarizePlan(repairs) {
  return {
    repairCount: repairs.length,
    byStep: repairs.reduce((acc, repair) => {
      acc[repair.stepIndex] = (acc[repair.stepIndex] || 0) + 1;
      return acc;
    }, {}),
    byBlockerKind: repairs.reduce((acc, repair) => {
      const k = repair.blocker.kind;
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {}),
    milestones: repairs.map((repair) => repair.milestone),
  };
}

module.exports = {
  planBlockerRepairs,
  findBlockerCandidates,
  summarizePlan,
  buildBlockerRepairMilestone,
  DEFAULT_REPAIR_OPTIONS,
};
