"use strict";

const { runMilestoneGraph, summarizeEffectiveHero, summarizeHero } = require("./segment-dp");
const { scanResourceIntents } = require("./resource-intent-scanner");
const { getTileDefinitionAt } = require("./state");

const DEFAULT_ACTION_KINDS = ["battle", "pickup", "equip", "openDoor", "useTool", "changeFloor", "event"];

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function compactHero(state) {
  return {
    hero: summarizeHero(state),
    effectiveHero: summarizeEffectiveHero(state),
    floorId: state && state.floorId,
    routeLength: Array.isArray(state && state.route) ? state.route.length : null,
  };
}

function actionTile(action) {
  if (!action) return null;
  const floorId = action.floorId || (action.target && action.target.floorId) || null;
  const target = action.target || {};
  const x = target.x != null ? target.x : action.x;
  const y = target.y != null ? target.y : action.y;
  if (!floorId || x == null || y == null) return null;
  return { floorId, x: Number(x), y: Number(y) };
}

function tileKey(tile) {
  return `${tile.floorId}:${tile.x},${tile.y}`;
}

function actionChangeFloorKey(action) {
  const tile = actionTile(action);
  return tile ? tileKey(tile) : null;
}

function floorOrder(project, floorId) {
  const index = (project.floorOrder || []).indexOf(floorId);
  return index < 0 ? 0 : index;
}

function effectiveValue(state, field) {
  return number((summarizeEffectiveHero(state) || {})[field], 0);
}

function statDelta(before, after, field) {
  return effectiveValue(after, field) - effectiveValue(before, field);
}

function previewAction(simulator, state, action) {
  try {
    return simulator.applyAction(state, action, { storeRoute: false });
  } catch (error) {
    return null;
  }
}

function inferFailureClass(result) {
  const failed = result && result.failedSegment;
  return (failed && (
    failed.failureClass ||
    (failed.failurePropagation && failed.failurePropagation.primaryFailureClass) ||
    (failed.failurePropagation && failed.failurePropagation.failureClass)
  )) || "unknown";
}

function inferMissingGoalFields(result) {
  const failed = result && result.failedSegment;
  if (!failed) return [];
  if (Array.isArray(failed.missingGoalFields)) return failed.missingGoalFields;
  const attempts = Array.isArray(failed.attempts) ? failed.attempts : [];
  for (const attempt of attempts) {
    const missing = attempt && attempt.diagnostics && attempt.diagnostics.failure && attempt.diagnostics.failure.missingGoalFields;
    if (Array.isArray(missing) && missing.length > 0) return missing;
  }
  return [];
}

function inferAttemptFailures(result) {
  const failed = result && result.failedSegment;
  return (Array.isArray(failed && failed.attempts) ? failed.attempts : [])
    .map((attempt) => attempt && attempt.diagnostics && attempt.diagnostics.failure)
    .filter(Boolean);
}

function inferBestSeenFailure(result) {
  const failures = inferAttemptFailures(result);
  return failures.find((failure) => failure.bestSeen) || null;
}

function findFailedSpecSegment(spec, failedSegmentId) {
  return ((spec || {}).milestones || []).find((segment) => segment.id === failedSegmentId) || null;
}

function shouldAutoSplit(result) {
  const failed = result && result.failedSegment;
  if (!failed) return false;
  const failureClass = failed.failureClass ||
    (failed.failurePropagation && (failed.failurePropagation.failureClass || failed.failurePropagation.primaryFailureClass));
  if (failureClass === "budget-or-action-scope-exhausted") return true;
  const attempts = Array.isArray(failed.attempts) ? failed.attempts : [];
  return attempts.some((attempt) => {
    const dp = attempt && attempt.diagnostics && attempt.diagnostics.dp;
    if (!dp) return false;
    return dp.stoppedReason === "time-limit" ||
      Number(dp.actionTrimmed || 0) > 0 ||
      Number(dp.statesWithActionTrim || 0) > 0;
  });
}

function buildAutoSplitSegment(result, spec, options) {
  const config = options || {};
  const failed = result && result.failedSegment;
  const failedSegmentId = failed && failed.segmentId;
  const bestFailure = inferBestSeenFailure(result);
  const bestSeen = bestFailure && bestFailure.bestSeen;
  if (!failedSegmentId || !bestSeen || !bestSeen.floorId || !bestSeen.hero) return null;
  const original = findFailedSpecSegment(spec, failedSegmentId) || {};
  const hero = bestSeen.hero || {};
  const effectiveHero = bestSeen.effectiveHero || {};
  const minHero = {};
  ["atk", "def", "mdef", "lv", "exp"].forEach((field) => {
    if (Number(hero[field] || 0) > 0) minHero[field] = Number(hero[field]);
  });
  if (Number(hero.hp || 0) > 1) minHero.hp = Number(hero.hp);
  const minEffectiveHero = {};
  ["atk", "def", "mdef"].forEach((field) => {
    if (Number(effectiveHero[field] || 0) > 0) minEffectiveHero[field] = Number(effectiveHero[field]);
  });
  return {
    id: `auto-split-${failedSegmentId}-${number(config.repairIndex, 0) + 1}`,
    label: `自动切分 ${failedSegmentId}`,
    generated: true,
    generatedBy: {
      mode: "auto-segment-split",
      failedSegmentId,
      failureClass: failed.failureClass || (failed.failurePropagation && failed.failurePropagation.primaryFailureClass) || "unknown",
      bestSeen,
      reason: "failed segment hit budget/time/action trimming; checkpointing bestSeen before retrying original goal",
    },
    goal: {
      type: "adaptiveSplitCheckpoint",
      floorId: bestSeen.floorId,
      minHero,
      minEffectiveHero,
      equipmentIncludes: (hero.equipment || []).slice(),
    },
    actionPolicy: {
      actionKinds: DEFAULT_ACTION_KINDS.slice(),
      forbidUnsupportedEvents: true,
      ...cloneJson(original.actionPolicy || {}),
    },
    dp: {
      keyMode: ((original.dp || {}).keyMode) || "region",
      priorityMode: ((original.dp || {}).priorityMode) || "combat-first",
      stopOnFirstGoal: false,
      maxActionsPerState: number((original.dp || {}).maxActionsPerState, 9999),
      maxExpansions: number(config.splitMaxExpansions, Math.max(1000, Math.floor(number((original.dp || {}).maxExpansions, 8000) / 2))),
      maxRuntimeMs: number(config.splitMaxRuntimeMs, Math.max(3000, Math.floor(number((original.dp || {}).maxRuntimeMs, 15000) / 2))),
      goalSkylineLimit: number(config.repairGoalSkylineLimit, config.candidateLimit || 8),
    },
  };
}

function scoreRepairAction(simulator, state, action, preview, failureClass) {
  if (!preview) return -Infinity;
  const beforeHero = summarizeHero(state);
  const afterHero = summarizeHero(preview);
  const hpDelta = number(afterHero.hp, 0) - number(beforeHero.hp, 0);
  const expDelta = number(afterHero.exp, 0) - number(beforeHero.exp, 0);
  const atkDelta = statDelta(state, preview, "atk");
  const defDelta = statDelta(state, preview, "def");
  const mdefDelta = statDelta(state, preview, "mdef");
  const equipmentGain = (afterHero.equipment || []).filter((itemId) => !(beforeHero.equipment || []).includes(itemId)).length;
  const damage = number(((action || {}).estimate || {}).damage, 0);
  const kindBonus = action.kind === "pickup" ? 150000
    : action.kind === "equip" ? 140000
      : action.kind === "battle" ? 90000
        : action.kind === "openDoor" || action.kind === "useTool" ? 30000
          : 0;
  let statScore = 0;
  if (failureClass === "atk-deficit") statScore = atkDelta * 120000 + expDelta * 1000;
  else if (failureClass === "def-deficit") statScore = defDelta * 100000 + expDelta * 1000;
  else if (failureClass === "mdef-deficit") statScore = mdefDelta * 12000 + expDelta * 1000;
  else if (failureClass === "hp-deficit" || failureClass === "action-survivability-deficit") statScore = hpDelta * 2 + defDelta * 50000 + mdefDelta * 4000;
  else statScore = atkDelta * 80000 + defDelta * 70000 + mdefDelta * 7000 + hpDelta + expDelta * 1000;
  const floorGain = floorOrder(simulator.project, preview.floorId) - floorOrder(simulator.project, state.floorId);
  return kindBonus + statScore + equipmentGain * 500000 + Math.max(0, floorGain) * 250000 - Math.max(0, damage) * 2;
}

function collectRepairCandidates(simulator, candidates, failureClass, options) {
  const config = options || {};
  const maxCandidates = Math.max(1, number(config.repairActionCandidates, 8));
  const records = [];
  const seen = new Set();
  for (const candidate of candidates || []) {
    const state = candidate && candidate.state;
    if (!state) continue;
    let actions = [];
    try {
      actions = simulator.enumeratePrimitiveActions(state).actions || [];
    } catch (error) {
      actions = [];
    }
    for (const action of actions) {
      if (!action || action.kind === "resourcePocket" || action.kind === "resourceCluster" || action.kind === "resourceChain" || action.kind === "fightToLevelUp") continue;
      if (!DEFAULT_ACTION_KINDS.includes(action.kind)) continue;
      if (action.kind === "changeFloor") continue;
      if (action.kind === "event" && (action.unsupported || action.hasStateChange === false)) continue;
      const tile = actionTile(action);
      if (!tile && action.kind !== "equip") continue;
      if (tile && getTileDefinitionAt(simulator.project, state, tile.floorId, tile.x, tile.y) == null) continue;
      const preview = previewAction(simulator, state, action);
      if (!preview) continue;
      const key = tile ? `${action.kind}:${tileKey(tile)}` : action.summary;
      const score = scoreRepairAction(simulator, state, action, preview, failureClass);
      const existing = seen.has(key);
      if (existing) continue;
      seen.add(key);
      records.push({
        key,
        actionSummary: action.summary,
        actionKind: action.kind,
        tile,
        score,
        startCandidateId: candidate.id,
        before: compactHero(state),
        after: compactHero(preview),
      });
    }
  }
  return records
    .sort((left, right) => right.score - left.score)
    .slice(0, maxCandidates);
}

function collectVisibleChangeFloors(simulator, candidates) {
  const keys = new Set();
  for (const candidate of candidates || []) {
    const state = candidate && candidate.state;
    if (!state) continue;
    let actions = [];
    try {
      actions = simulator.enumeratePrimitiveActions(state).actions || [];
    } catch (error) {
      actions = [];
    }
    actions
      .filter((action) => action && action.kind === "changeFloor")
      .map(actionChangeFloorKey)
      .filter(Boolean)
      .forEach((key) => keys.add(key));
  }
  return Array.from(keys);
}

function buildRepairSegment(simulator, result, options) {
  const config = options || {};
  const failed = result && result.failedSegment;
  const failedSegmentId = failed && failed.segmentId;
  const failureClass = inferFailureClass(result);
  const missingGoalFields = inferMissingGoalFields(result);
  const frontier = result && result.finalCandidates;
  if (config.enableAutoSplit !== false && shouldAutoSplit(result)) {
    const splitSegment = buildAutoSplitSegment(result, config.currentSpec, config);
    if (splitSegment) return splitSegment;
  }
  const intents = scanResourceIntents(simulator, frontier, {
    failureClass,
    missingGoalFields,
  }, {
    maxIntentRecords: config.repairIntentRecords || config.repairActionCandidates || 24,
    recordsPerIntent: config.repairRecordsPerIntent || config.repairTileCandidates || 6,
    maxIntents: config.repairMaxIntents || 6,
  });
  const selectedIntent = intents[0] || null;
  if (selectedIntent) {
    const maxExpansions = number(config.repairMaxExpansions, 2500);
    const maxRuntimeMs = number(config.repairMaxRuntimeMs, 10000);
    return {
      id: `auto-repair-${failedSegmentId || "segment"}-${number(config.repairIndex, 0) + 1}`,
      label: `自动修复 ${failedSegmentId || "segment"}：${failureClass}/${selectedIntent.kind}`,
      generated: true,
      generatedBy: {
        mode: "resource-intent-scanner",
        failureClass,
        intentKind: selectedIntent.kind,
        desiredStats: selectedIntent.desiredStats,
        failedSegmentId,
        missingGoalFields: cloneJson(missingGoalFields),
        intents: intents.map((intent) => ({
          kind: intent.kind,
          primaryStat: intent.primaryStat,
          score: Math.round(intent.score),
          goal: intent.goal,
          candidates: (intent.records || []).map((record) => ({
            actionSummary: record.actionSummary,
            actionKind: record.actionKind,
            tile: record.tile,
            score: record.score,
            damage: record.damage,
            delta: record.delta,
            frontierDelta: record.frontierDelta,
          })),
        })),
      },
      goal: selectedIntent.goal,
      actionPolicy: selectedIntent.actionPolicy,
      dp: {
        keyMode: config.repairKeyMode || "region",
        priorityMode: selectedIntent.kind === "stat-hp" ? "default" : "combat-first",
        stopOnFirstGoal: false,
        maxActionsPerState: number(config.repairMaxActionsPerState, 9999),
        maxExpansions,
        maxRuntimeMs,
        goalSkylineLimit: number(config.repairGoalSkylineLimit, config.candidateLimit || 8),
      },
    };
  }
  const repairCandidates = collectRepairCandidates(simulator, frontier, failureClass, config);
  const tileCandidates = repairCandidates.filter((candidate) => candidate.tile).slice(0, Math.max(1, number(config.repairTileCandidates, 6)));
  if (tileCandidates.length === 0) return null;
  const floors = new Set();
  for (const candidate of frontier || []) {
    if (candidate && candidate.state && candidate.state.floorId) floors.add(candidate.state.floorId);
  }
  tileCandidates.forEach((candidate) => floors.add(candidate.tile.floorId));
  const visibleChangeFloors = collectVisibleChangeFloors(simulator, frontier);
  const maxExpansions = number(config.repairMaxExpansions, 2500);
  const maxRuntimeMs = number(config.repairMaxRuntimeMs, 10000);
  return {
    id: `auto-repair-${failedSegmentId || "segment"}-${number(config.repairIndex, 0) + 1}`,
    label: `自动修复 ${failedSegmentId || "segment"}：${failureClass}`,
    generated: true,
    generatedBy: {
      failureClass,
      failedSegmentId,
      missingGoalFields: cloneJson(missingGoalFields),
      candidates: repairCandidates.map((candidate) => ({
        actionSummary: candidate.actionSummary,
        actionKind: candidate.actionKind,
        tile: candidate.tile,
        score: Math.round(candidate.score),
        before: candidate.before,
        after: candidate.after,
      })),
    },
    goal: {
      type: "adaptiveRepair",
      anyRemovedTiles: tileCandidates.map((candidate) => ({
        ...candidate.tile,
        reason: `Auto repair candidate from ${candidate.actionSummary}`,
      })),
    },
    actionPolicy: {
      actionKinds: DEFAULT_ACTION_KINDS.slice(),
      forbidUnsupportedEvents: true,
      allowedFloors: Array.from(floors).sort(),
      allowChangeFloors: visibleChangeFloors,
    },
    dp: {
      keyMode: config.repairKeyMode || "region",
      priorityMode: failureClass === "hp-deficit" || failureClass === "action-survivability-deficit" ? "default" : "combat-first",
      stopOnFirstGoal: false,
      maxActionsPerState: number(config.repairMaxActionsPerState, 9999),
      maxExpansions,
      maxRuntimeMs,
      goalSkylineLimit: number(config.repairGoalSkylineLimit, config.candidateLimit || 8),
    },
  };
}

function cloneSpecWithInsertedSegment(spec, failedSegmentId, repairSegment) {
  const next = cloneJson(spec);
  const index = (next.milestones || []).findIndex((milestone) => milestone.id === failedSegmentId);
  if (index < 0) return null;
  const previous = next.milestones[index - 1] || null;
  const failed = next.milestones[index];
  repairSegment.startFrom = failed.startFrom || (previous && previous.id) || null;
  failed.startFrom = repairSegment.id;
  next.milestones.splice(index, 0, repairSegment);
  return next;
}

function runAdaptiveSegmentPlanner(simulator, initialState, milestoneSpec, options) {
  const config = options || {};
  const maxRepairs = Math.max(0, number(config.maxAdaptiveRepairs, 2));
  let spec = cloneJson(milestoneSpec);
  const attempts = [];
  const insertedSegments = [];
  for (let repairIndex = 0; repairIndex <= maxRepairs; repairIndex += 1) {
    const result = runMilestoneGraph(simulator, initialState, spec, config);
    attempts.push({
      index: repairIndex,
      found: result.found,
      reachedMilestone: result.reachedMilestone,
      failedSegmentId: result.failedSegment && result.failedSegment.segmentId,
      insertedSegments: insertedSegments.map((segment) => segment.id),
      segmentResults: (result.segmentResults || []).map((segment) => ({
        segmentId: segment.segmentId,
        found: segment.found,
        candidateCount: (segment.candidates || []).length,
        failureClass: segment.failureClass || (segment.failurePropagation && segment.failurePropagation.failureClass),
      })),
    });
    if (result.found || repairIndex >= maxRepairs || !result.failedSegment) {
      return {
        ...result,
        adaptive: {
          enabled: true,
          attempts,
          insertedSegments,
          repairCount: insertedSegments.length,
        },
        effectiveSpec: spec,
      };
    }
    const repairSegment = buildRepairSegment(simulator, result, { ...config, currentSpec: spec, repairIndex });
    if (!repairSegment) {
      return {
        ...result,
        adaptive: {
          enabled: true,
          attempts,
          insertedSegments,
          repairCount: insertedSegments.length,
          stoppedReason: "no-repair-segment-generated",
        },
        effectiveSpec: spec,
      };
    }
    const nextSpec = cloneSpecWithInsertedSegment(spec, result.failedSegment.segmentId, repairSegment);
    if (!nextSpec) {
      return {
        ...result,
        adaptive: {
          enabled: true,
          attempts,
          insertedSegments,
          repairCount: insertedSegments.length,
          stoppedReason: "failed-segment-not-found",
        },
        effectiveSpec: spec,
      };
    }
    insertedSegments.push(repairSegment);
    spec = nextSpec;
  }
  throw new Error("unreachable adaptive planner exit");
}

module.exports = {
  buildRepairSegment,
  collectRepairCandidates,
  runAdaptiveSegmentPlanner,
};
