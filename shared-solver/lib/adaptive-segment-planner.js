"use strict";

const { runMilestoneGraph, summarizeEffectiveHero, summarizeHero } = require("./segment-dp");
const { scanResourceIntents } = require("./resource-intent-scanner");
const { estimateBattleSurvivability } = require("./battle-thresholds");
const { resolveRelativeFloor } = require("./floor-transitions");
const { getTileDefinitionAt } = require("./state");

const DEFAULT_ACTION_KINDS = ["battle", "pickup", "equip", "openDoor", "useTool", "changeFloor", "floorFly", "event"];

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
  if (failureClass && failureClass !== "unknown") return false;
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
  const kindBonus = action.kind === "pickup" || action.kind === "interactPickup" ? 150000
    : action.kind === "equip" ? 140000
      : action.kind === "battle" ? 90000
        : action.kind === "openDoor" || action.kind === "useTool" || action.kind === "floorFly" ? 30000
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
  const segments = buildRepairSegments(simulator, result, options);
  return segments[0] || null;
}

function buildIntentRepairSegment(selectedIntent, failedSegmentId, failureClass, missingGoalFields, config) {
  const maxExpansions = number(config.repairMaxExpansions, 2500);
  const maxRuntimeMs = number(config.repairMaxRuntimeMs, 10000);
  return {
    id: `auto-repair-${failedSegmentId || "segment"}-${number(config.repairIndex, 0) + 1}-${selectedIntent.kind}`,
    label: `自动修复 ${failedSegmentId || "segment"}：${failureClass}/${selectedIntent.kind}`,
    generated: true,
    generatedBy: {
      mode: "resource-intent-scanner",
      failureClass,
      intentKind: selectedIntent.kind,
      desiredStats: selectedIntent.desiredStats,
      failedSegmentId,
      missingGoalFields: cloneJson(missingGoalFields),
      intents: (config.allIntents || [selectedIntent]).map((intent) => ({
        kind: intent.kind,
        primaryStat: intent.primaryStat,
        score: Math.round(intent.score),
        goal: intent.goal,
        targetBattle: intent.targetBattle,
        candidates: (intent.records || []).map((record) => ({
          actionSummary: record.actionSummary,
          actionChain: record.actionChain,
          actionKind: record.actionKind,
          tile: record.tile,
          score: record.score,
          damage: record.damage,
          delta: record.delta,
          frontierDelta: record.frontierDelta,
          targetBattleImpact: record.targetBattleImpact,
        })),
      })),
    },
    goal: selectedIntent.goal,
    actionPolicy: selectedIntent.actionPolicy,
    dp: {
      keyMode: config.repairKeyMode || "region",
      priorityMode: selectedIntent.kind === "stat-hp" || selectedIntent.kind === "life-limit-hp-prep" || selectedIntent.kind === "blocked-hp-resource" ? "default" : "combat-first",
      stopOnFirstGoal: false,
      maxActionsPerState: number(config.repairMaxActionsPerState, 9999),
      maxExpansions,
      maxRuntimeMs,
      goalSkylineLimit: number(config.repairGoalSkylineLimit, config.candidateLimit || 8),
    },
  };
}

function buildFallbackRepairSegment(failedSegmentId, failureClass, missingGoalFields, frontier, repairCandidates, config) {
  const tileCandidates = repairCandidates.filter((candidate) => candidate.tile).slice(0, Math.max(1, number(config.repairTileCandidates, 6)));
  if (tileCandidates.length === 0) return null;
  const floors = new Set();
  for (const candidate of frontier || []) {
    if (candidate && candidate.state && candidate.state.floorId) floors.add(candidate.state.floorId);
  }
  tileCandidates.forEach((candidate) => floors.add(candidate.tile.floorId));
  const visibleChangeFloors = collectVisibleChangeFloors(config.simulator, frontier);
  const maxExpansions = number(config.repairMaxExpansions, 2500);
  const maxRuntimeMs = number(config.repairMaxRuntimeMs, 10000);
  return {
    id: `auto-repair-${failedSegmentId || "segment"}-${number(config.repairIndex, 0) + 1}-fallback`,
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
      priorityMode: failureClass === "hp-deficit" || failureClass === "action-survivability-deficit" || failureClass === "life-limit-hp-deficit" ? "default" : "combat-first",
      stopOnFirstGoal: false,
      maxActionsPerState: number(config.repairMaxActionsPerState, 9999),
      maxExpansions,
      maxRuntimeMs,
      goalSkylineLimit: number(config.repairGoalSkylineLimit, config.candidateLimit || 8),
    },
  };
}

function shouldBuildWindowRepair(failureClass) {
  return [
    "hp-deficit",
    "action-survivability-deficit",
    "life-limit-hp-deficit",
    "def-deficit",
    "target-action-unreachable",
    "route-quality-floor-not-met",
  ].includes(failureClass);
}

function changeFloorTargetAllowed(project, allowedFloors, key) {
  const match = /^([^:]+):(\d+),(\d+)$/.exec(String(key || ""));
  if (!match) return true;
  const sourceFloorId = match[1];
  const loc = `${match[2]},${match[3]}`;
  if (!allowedFloors.has(sourceFloorId)) return false;
  const floor = project && project.floorsById && project.floorsById[sourceFloorId];
  const changeFloor = floor && floor.changeFloor && floor.changeFloor[loc];
  if (!changeFloor || !changeFloor.floorId) return true;
  try {
    return allowedFloors.has(resolveRelativeFloor(project, sourceFloorId, changeFloor.floorId));
  } catch (error) {
    return false;
  }
}

function unionActionPolicy(segments, project) {
  const sustainActionKinds = new Set(["battle", "pickup", "interactPickup", "equip", "changeFloor", "floorFly"]);
  const actionKinds = new Set(["battle", "pickup", "interactPickup", "equip", "changeFloor"]);
  const allowedFloors = new Set();
  const rawAllowChangeFloors = new Set();
  let forbidUnsupportedEvents = true;
  (segments || []).forEach((segment) => {
    const policy = (segment || {}).actionPolicy || {};
    (policy.actionKinds || []).forEach((kind) => {
      if (sustainActionKinds.has(kind)) actionKinds.add(kind);
    });
    (policy.allowedFloors || []).forEach((floorId) => allowedFloors.add(floorId));
    (policy.allowChangeFloors || []).forEach((key) => rawAllowChangeFloors.add(key));
    if (policy.forbidUnsupportedEvents === false) forbidUnsupportedEvents = false;
  });
  const allowChangeFloors = Array.from(rawAllowChangeFloors)
    .filter((key) => changeFloorTargetAllowed(project, allowedFloors, key));
  return {
    actionKinds: Array.from(actionKinds).sort(),
    forbidUnsupportedEvents,
    ...(allowedFloors.size > 0 ? { allowedFloors: Array.from(allowedFloors).sort() } : {}),
    ...(allowChangeFloors.length > 0 ? { allowChangeFloors: allowChangeFloors.sort() } : {}),
    maxFloorFlyPerTarget: 1,
    resourceTimingMode: "sustain-prep",
  };
}

function defaultRepairRollbackSegments(failureClass, config) {
  if (config && config.repairRollbackSegments != null) return number(config.repairRollbackSegments, 3);
  if (failureClass === "route-quality-floor-not-met") return 7;
  if (failureClass === "life-limit-hp-deficit") return 7;
  if (failureClass === "action-survivability-deficit") return 5;
  return 3;
}

function qualityFloorHero(qualityFloor) {
  return (qualityFloor && (qualityFloor.minHero || qualityFloor.hero)) || {};
}

function qualityFloorFields(qualityFloor) {
  const configured = qualityFloor && qualityFloor.mustNotLoseFields;
  return Array.isArray(configured) && configured.length > 0
    ? configured
    : ["hp", "atk", "def", "mdef", "lv"];
}

function mergeQualityFloorIntoGoal(goal, qualityFloor) {
  const next = cloneJson(goal || {});
  if (!qualityFloor) return next;
  const qualityHero = qualityFloorHero(qualityFloor);
  const minHero = { ...(next.minHero || {}) };
  qualityFloorFields(qualityFloor).forEach((field) => {
    const expected = Number(qualityHero[field] || 0);
    if (expected > 0) minHero[field] = Math.max(Number(minHero[field] || 0), expected);
  });
  if (qualityFloor.mustReachSameFloor !== false && qualityFloor.floorId) {
    next.floorId = next.floorId || qualityFloor.floorId;
  }
  next.minHero = minHero;
  next.qualityFloor = {
    label: qualityFloor.label || null,
    sourceFile: qualityFloor.sourceFile || null,
    minHero: cloneJson(qualityFloor.minHero || qualityFloor.hero || {}),
    mustReachSameFloor: qualityFloor.mustReachSameFloor !== false,
    mustNotLoseFields: qualityFloorFields(qualityFloor),
    sameLevelMustNotLoseExp: qualityFloor.sameLevelMustNotLoseExp !== false,
  };
  return next;
}

function buildWindowRepairSegment(result, spec, options) {
  const config = options || {};
  if (config.enableWindowRepair === false) return null;
  const failed = result && result.failedSegment;
  const failedSegmentId = failed && failed.segmentId;
  const failureClass = inferFailureClass(result);
  if (!failedSegmentId || !shouldBuildWindowRepair(failureClass)) return null;
  const milestones = (spec || {}).milestones || [];
  const failedIndex = milestones.findIndex((segment) => segment.id === failedSegmentId);
  if (failedIndex < 0) return null;
  const fromIndex = config.fromMilestoneId
    ? milestones.findIndex((segment) => segment.id === config.fromMilestoneId)
    : -1;
  const lowerBound = fromIndex >= 0 ? fromIndex + 1 : 0;
  const rollback = Math.max(1, defaultRepairRollbackSegments(failureClass, config));
  const startIndex = Math.max(lowerBound, failedIndex - rollback);
  if (startIndex >= failedIndex) return null;
  const windowSegments = milestones.slice(startIndex, failedIndex + 1);
  const failedSpecSegment = milestones[failedIndex];
  const qualityFloor = failureClass === "route-quality-floor-not-met" ? config.qualityFloor : null;
  return {
    id: `auto-window-${failedSegmentId || "segment"}-${number(config.repairIndex, 0) + 1}`,
    label: `自动合并窗口 ${windowSegments[0].id}..${failedSegmentId}`,
    generated: true,
    generatedBy: {
      mode: "adaptive-window-repair",
      failureClass,
      failedSegmentId,
      replaceFromSegmentId: windowSegments[0].id,
      replaceToSegmentId: failedSegmentId,
      rollbackSegments: failedIndex - startIndex,
      windowSegmentIds: windowSegments.map((segment) => segment.id),
      missingGoalFields: cloneJson(inferMissingGoalFields(result)),
      reason: "downstream failure may require reordering sustain resources across multiple previous milestones",
    },
    startFrom: windowSegments[0].startFrom || null,
    goal: mergeQualityFloorIntoGoal((failedSpecSegment || {}).goal || {}, qualityFloor),
    actionPolicy: unionActionPolicy(windowSegments, config.simulator && config.simulator.project),
    dp: {
      keyMode: config.windowRepairKeyMode || "region",
      priorityMode: config.windowRepairPriorityMode ||
        (failureClass === "life-limit-hp-deficit" || failureClass === "route-quality-floor-not-met" ? "resource-first" : "default"),
      agendaMode: config.windowRepairAgendaMode ||
        (failureClass === "life-limit-hp-deficit" || failureClass === "route-quality-floor-not-met" ? "fifo" : "best-first"),
      resourceTimingMode: "sustain-prep",
      resourceLookahead: config.windowRepairLookahead === true,
      resourceLookaheadActions: number(config.windowRepairLookaheadActions, 8),
      stopOnFirstGoal: false,
      maxActionsPerState: number(config.windowRepairMaxActionsPerState, 9999),
      maxExpansions: number(
        config.windowRepairMaxExpansions,
        failureClass === "route-quality-floor-not-met"
          ? Math.max(9000, number(config.repairMaxExpansions, 2500) * 4)
          : Math.max(6000, number(config.repairMaxExpansions, 2500) * 3)
      ),
      maxRuntimeMs: number(
        config.windowRepairMaxRuntimeMs,
        failureClass === "route-quality-floor-not-met"
          ? Math.max(24000, number(config.repairMaxRuntimeMs, 10000) * 2)
          : Math.max(18000, number(config.repairMaxRuntimeMs, 10000) * 2)
      ),
      goalSkylineLimit: number(config.repairGoalSkylineLimit, config.candidateLimit || 8),
    },
  };
}

function buildConvergenceSplitSegments(simulator, result, intents, failedSegmentId, failureClass, missingGoalFields, config) {
  if (failureClass !== "life-limit-hp-deficit" && failureClass !== "action-survivability-deficit") return [];
  if (!intents || intents.length === 0) return [];
  const maxSplits = Math.max(1, number(config.convergenceSplitLimit, 3));
  const maxExpansions = number(config.convergenceSplitMaxExpansions, Math.max(1500, number(config.repairMaxExpansions, 2500)));
  const maxRuntimeMs = number(config.convergenceSplitMaxRuntimeMs, Math.max(8000, number(config.repairMaxRuntimeMs, 10000)));
  const splits = [];
  for (const intent of intents) {
    if (splits.length >= maxSplits) break;
    if (!intent.goal || (!intent.goal.minHero && !intent.goal.anyRemovedTiles && !intent.goal.actionSurvivable)) continue;
    const intentFloors = new Set();
    for (const record of intent.records || []) {
      if (record.tile) intentFloors.add(record.tile.floorId);
    }
    (intent.actionPolicy.allowedFloors || []).forEach((f) => intentFloors.add(f));
    splits.push({
      id: `auto-convergence-${failedSegmentId || "segment"}-${splits.length + 1}-${intent.kind}`,
      label: `自动收敛点 ${intent.kind}`,
      generated: true,
      generatedBy: {
        mode: "convergence-split",
        failureClass,
        intentKind: intent.kind,
        desiredStats: intent.desiredStats,
        failedSegmentId,
      },
      goal: intent.goal,
      actionPolicy: {
        ...intent.actionPolicy,
        forbidUnsupportedEvents: true,
      },
      dp: {
        keyMode: config.repairKeyMode || "region",
        priorityMode: intent.kind === "stat-hp" || intent.kind === "life-limit-hp-prep" || intent.kind === "blocked-hp-resource" ? "default" : "combat-first",
        stopOnFirstGoal: false,
        maxActionsPerState: number(config.repairMaxActionsPerState, 9999),
        maxExpansions,
        maxRuntimeMs,
        goalSkylineLimit: number(config.repairGoalSkylineLimit, config.candidateLimit || 8),
      },
    });
  }
  return splits;
}

function buildRepairSegments(simulator, result, options) {
  const config = options || {};
  const failed = result && result.failedSegment;
  const failedSegmentId = failed && failed.segmentId;
  const failureClass = inferFailureClass(result);
  const missingGoalFields = inferMissingGoalFields(result);
  const frontier = result && result.finalCandidates;
  const windowRepair = buildWindowRepairSegment(result, config.currentSpec, { ...config, simulator });
  if (failureClass === "route-quality-floor-not-met") {
    return windowRepair ? [windowRepair] : [];
  }
  if (config.enableAutoSplit !== false && shouldAutoSplit(result)) {
    const splitSegment = buildAutoSplitSegment(result, config.currentSpec, config);
    if (splitSegment) return windowRepair ? [windowRepair, splitSegment] : [splitSegment];
  }
  const intents = scanResourceIntents(simulator, frontier, {
    failureClass,
    missingGoalFields,
  }, {
    maxIntentRecords: config.repairIntentRecords || config.repairActionCandidates || 24,
    recordsPerIntent: config.repairRecordsPerIntent || config.repairTileCandidates || 6,
    maxIntents: config.repairMaxIntents || 6,
    intentDepth: config.intentDepth || 1,
    maxIntentNodes: config.intentNodeLimit || config.maxIntentNodes || 80,
    targetBattle: config.targetBattle || null,
  });
  if (intents.length > 0) {
    const branchLimit = Math.max(1, number(config.repairBranchLimit, 1));
    const convergenceSplits = config.enableConvergenceSplit !== false
      ? buildConvergenceSplitSegments(simulator, result, intents, failedSegmentId, failureClass, missingGoalFields, config)
      : [];
    if (convergenceSplits.length > 0) {
      return convergenceSplits;
    }
    const intentSegments = intents.slice(0, branchLimit).map((intent) =>
      buildIntentRepairSegment(intent, failedSegmentId, failureClass, missingGoalFields, { ...config, allIntents: intents })
    );
    return windowRepair ? [windowRepair].concat(intentSegments).slice(0, branchLimit) : intentSegments;
  }
  const repairCandidates = collectRepairCandidates(simulator, frontier, failureClass, config);
  const fallback = buildFallbackRepairSegment(failedSegmentId, failureClass, missingGoalFields, frontier, repairCandidates, { ...config, simulator });
  return [windowRepair, fallback].filter(Boolean);
}

function cloneSpecWithInsertedSegment(spec, failedSegmentId, repairSegment) {
  const next = cloneJson(spec);
  if (
    repairSegment &&
    repairSegment.generatedBy &&
    repairSegment.generatedBy.mode === "adaptive-window-repair"
  ) {
    const fromId = repairSegment.generatedBy.replaceFromSegmentId;
    const toId = repairSegment.generatedBy.replaceToSegmentId || failedSegmentId;
    const fromIndex = (next.milestones || []).findIndex((milestone) => milestone.id === fromId);
    const toIndex = (next.milestones || []).findIndex((milestone) => milestone.id === toId);
    if (fromIndex < 0 || toIndex < fromIndex) return null;
    const after = next.milestones[toIndex + 1] || null;
    if (after && after.startFrom === toId) after.startFrom = repairSegment.id;
    next.milestones.splice(fromIndex, toIndex - fromIndex + 1, repairSegment);
    return next;
  }
  const index = (next.milestones || []).findIndex((milestone) => milestone.id === failedSegmentId);
  if (index < 0) return null;
  const previous = next.milestones[index - 1] || null;
  const failed = next.milestones[index];
  repairSegment.startFrom = failed.startFrom || (previous && previous.id) || null;
  failed.startFrom = repairSegment.id;
  next.milestones.splice(index, 0, repairSegment);
  return next;
}

function compactAdaptiveAttempt(index, result, insertedSegments) {
  return {
    index,
    found: result.found,
    reachedMilestone: result.reachedMilestone,
    failedSegmentId: result.failedSegment && result.failedSegment.segmentId,
    insertedSegments: insertedSegments.map((segment) => segment.id),
    segmentResults: (result.segmentResults || []).map((segment) => ({
      segmentId: segment.segmentId,
      found: segment.found,
      candidateCount: (segment.candidates || []).length,
      failureClass: segment.failureClass ||
        (segment.failurePropagation && (segment.failurePropagation.failureClass || segment.failurePropagation.primaryFailureClass)),
    })),
  };
}

function resultBestCandidateScore(result) {
  const candidates = result && result.finalCandidates;
  if (Array.isArray(candidates) && candidates.length > 0) {
    return candidates.reduce((best, candidate) => {
      const hero = (candidate && candidate.hero) || summarizeHero(candidate && candidate.state);
      const effectiveHero = (candidate && candidate.effectiveHero) || summarizeEffectiveHero(candidate && candidate.state);
      const routeLength = Array.isArray(candidate && candidate.route) ? candidate.route.length : 0;
      const score = number(hero.hp, 0) * 1000000 +
        number(hero.lv, 0) * 100000000000 +
        number(hero.exp, 0) * 10000000 +
        number(effectiveHero.atk, 0) * 10000 +
        number(effectiveHero.def, 0) * 8000 +
        number(effectiveHero.mdef, 0) * 1000 -
        routeLength;
      return Math.max(best, score);
    }, 0);
  }
  const candidate = result && result.finalCandidate;
  if (candidate) {
    const hero = candidate.hero || summarizeHero(candidate.state);
    const effectiveHero = candidate.effectiveHero || summarizeEffectiveHero(candidate.state);
    const routeLength = Array.isArray(candidate.route) ? candidate.route.length : 0;
    return number(hero.hp, 0) * 1000000 +
      number(hero.lv, 0) * 100000000000 +
      number(hero.exp, 0) * 10000000 +
      number(effectiveHero.atk, 0) * 10000 +
      number(effectiveHero.def, 0) * 8000 +
      number(effectiveHero.mdef, 0) * 1000 -
      routeLength;
  }
  return 0;
}

function scoreRepairBranch(branch, failedSegmentId) {
  const result = branch.result || {};
  const completed = (result.segmentResults || []).filter((segment) => segment.found).length;
  const repairSummary = (result.segmentResults || []).find((segment) => segment.segmentId === branch.repairSegment.id);
  const originalSummary = (result.segmentResults || []).find((segment) => segment.segmentId === failedSegmentId);
  const intentKind = branch.repairSegment && branch.repairSegment.generatedBy && branch.repairSegment.generatedBy.intentKind;
  const failureClass = branch.repairSegment && branch.repairSegment.generatedBy && branch.repairSegment.generatedBy.failureClass;
  const repairMode = branch.repairSegment && branch.repairSegment.generatedBy && branch.repairSegment.generatedBy.mode;
  const foundRepair = Boolean(repairSummary && repairSummary.found);
  const intentPriority =
    foundRepair && failureClass === "life-limit-hp-deficit" && intentKind === "blocked-hp-resource" ? 200000000000000 :
      foundRepair && failureClass === "life-limit-hp-deficit" && intentKind === "life-limit-hp-prep" ? 150000000000000 :
        0;
  const windowPriority =
    repairMode === "adaptive-window-repair" && (failureClass === "life-limit-hp-deficit" || failureClass === "route-quality-floor-not-met")
      ? 120000000000000
      : 0;
  return (result.found ? 1000000000000000 : 0) +
    (originalSummary && originalSummary.found ? 500000000000000 : 0) +
    (repairSummary && repairSummary.found ? 100000000000000 : 0) +
    windowPriority +
    intentPriority +
    completed * 1000000000 +
    resultBestCandidateScore(result);
}

function buildAdaptiveReturn(result, spec, attempts, insertedSegments, repairBranches, selectedBranch) {
  return {
    ...result,
    adaptive: {
      enabled: true,
      attempts,
      insertedSegments,
      repairCount: insertedSegments.length,
      repairBranches,
      selectedBranch,
    },
    effectiveSpec: spec,
  };
}

function adaptiveGraphConfig(config) {
  return {
    ...(config || {}),
    enableFailureBacktracking: (config || {}).enableFailureBacktracking === undefined
      ? true
      : config.enableFailureBacktracking,
  };
}

function retargetGraphConfigForRepair(graphConfig, repairSegment) {
  const config = graphConfig || {};
  if (
    !repairSegment ||
    !repairSegment.generatedBy ||
    repairSegment.generatedBy.mode !== "adaptive-window-repair" ||
    !config.toMilestoneId
  ) {
    return config;
  }
  const replacedIds = new Set(repairSegment.generatedBy.windowSegmentIds || []);
  if (
    replacedIds.has(config.toMilestoneId) ||
    repairSegment.generatedBy.replaceToSegmentId === config.toMilestoneId
  ) {
    return {
      ...config,
      toMilestoneId: repairSegment.id,
    };
  }
  return config;
}

function preScanProactiveMilestones(simulator, initialState, spec, config) {
  if (config.enableProactiveScan === false) return spec;
  const milestones = (spec || {}).milestones || [];
  const proactive = [];
  for (const segment of milestones) {
    const goal = segment.goal || {};
    if (!goal.actionSurvivable || !goal.actionSurvivable.summary) continue;
    const target = goal.actionSurvivable.summary;
    try {
      const threshold = estimateBattleSurvivability(simulator, initialState, target, { skipMinHp: true });
      if (!threshold || !threshold.supported || threshold.survivable) continue;
      const intents = scanResourceIntents(simulator, [{
        id: "proactive-scan",
        state: initialState,
        route: Array.isArray(initialState.route) ? initialState.route.slice() : [],
      }], {
        failureClass: (threshold.riskTags || []).includes("life-limit") ? "life-limit-hp-deficit" : "action-survivability-deficit",
        missingGoalFields: [{
          field: "actionSurvivable",
          expected: `hp > ${threshold.currentDamage}`,
          actual: threshold.currentHp,
          action: target,
          damage: threshold.currentDamage,
          riskTags: threshold.riskTags,
          special: threshold.special,
        }],
      }, {
        maxIntentRecords: config.proactiveIntentRecords || 16,
        recordsPerIntent: 4,
        maxIntents: 3,
        intentDepth: config.proactiveIntentDepth || 1,
        maxIntentNodes: 60,
        targetBattle: { floorId: threshold.floorId, x: threshold.x, y: threshold.y, enemyId: threshold.enemyId },
      });
      for (const intent of intents) {
        if (!intent.goal || (!intent.goal.minHero && !intent.goal.anyRemovedTiles)) continue;
        proactive.push({
          id: `proactive-${segment.id}-${intent.kind}`,
          label: `主动扫描 ${intent.kind}（${segment.id}）`,
          generated: true,
          generatedBy: {
            mode: "proactive-scan",
            targetSegmentId: segment.id,
            intentKind: intent.kind,
            failureClass: (threshold.riskTags || []).includes("life-limit") ? "life-limit-hp-deficit" : "action-survivability-deficit",
          },
          goal: intent.goal,
          actionPolicy: {
            ...intent.actionPolicy,
            forbidUnsupportedEvents: true,
          },
          dp: {
            keyMode: "region",
            priorityMode: "default",
            stopOnFirstGoal: false,
            maxExpansions: number(config.proactiveMaxExpansions, 2000),
            maxRuntimeMs: number(config.proactiveMaxRuntimeMs, 8000),
            goalSkylineLimit: number(config.proactiveGoalSkylineLimit, 4),
          },
        });
      }
    } catch (error) {
      continue;
    }
  }
  if (proactive.length === 0) return spec;
  const next = cloneJson(spec);
  const targetIndex = milestones.findIndex((m) => {
    const g = m.goal || {};
    return g.actionSurvivable && g.actionSurvivable.summary;
  });
  if (targetIndex < 0) return spec;
  const targetSegment = next.milestones[targetIndex];
  for (let i = proactive.length - 1; i >= 0; i -= 1) {
    proactive[i].startFrom = i === 0 ? (targetSegment.startFrom || null) : proactive[i - 1].id;
    next.milestones.splice(targetIndex, 0, proactive[i]);
  }
  targetSegment.startFrom = proactive[proactive.length - 1].id;
  return next;
}

function runAdaptiveSegmentPlanner(simulator, initialState, milestoneSpec, options) {
  const config = options || {};
  let graphConfig = adaptiveGraphConfig(config);
  const maxRepairs = Math.max(0, number(config.maxAdaptiveRepairs, 2));
  let spec = preScanProactiveMilestones(simulator, initialState, cloneJson(milestoneSpec), config);
  const attempts = [];
  const insertedSegments = [];
  const repairBranches = [];
  let selectedBranch = null;
  for (let repairIndex = 0; repairIndex <= maxRepairs; repairIndex += 1) {
    const result = runMilestoneGraph(simulator, initialState, spec, graphConfig);
    attempts.push(compactAdaptiveAttempt(repairIndex, result, insertedSegments));
    if (result.found || repairIndex >= maxRepairs || !result.failedSegment) {
      return buildAdaptiveReturn(result, spec, attempts, insertedSegments, repairBranches, selectedBranch);
    }
    const failedSegmentId = result.failedSegment.segmentId;
    const repairSegments = buildRepairSegments(simulator, result, { ...config, currentSpec: spec, repairIndex });
    if (repairSegments.length === 0) {
      return {
        ...result,
        adaptive: {
          enabled: true,
          attempts,
          insertedSegments,
          repairCount: insertedSegments.length,
          repairBranches,
          selectedBranch,
          stoppedReason: "no-repair-segment-generated",
        },
        effectiveSpec: spec,
      };
    }
    const branches = [];
    repairSegments.forEach((repairSegment, branchIndex) => {
      const nextSpec = cloneSpecWithInsertedSegment(spec, failedSegmentId, repairSegment);
      if (!nextSpec) {
        repairBranches.push({
          repairIndex,
          branchIndex,
          insertedSegmentId: repairSegment.id,
          intentKind: repairSegment.generatedBy && repairSegment.generatedBy.intentKind,
          error: "failed-segment-not-found",
        });
        return;
      }
      const branchGraphConfig = retargetGraphConfigForRepair(graphConfig, repairSegment);
      const branchResult = runMilestoneGraph(simulator, initialState, nextSpec, branchGraphConfig);
      const repairSummary = (branchResult.segmentResults || []).find((segment) => segment.segmentId === repairSegment.id);
      const originalSummary = (branchResult.segmentResults || []).find((segment) => segment.segmentId === failedSegmentId);
      const branch = {
        repairIndex,
        branchIndex,
        repairSegment,
        nextSpec,
        graphConfig: branchGraphConfig,
        result: branchResult,
      };
      branch.score = scoreRepairBranch(branch, failedSegmentId);
      const summary = {
        repairIndex,
        branchIndex,
        insertedSegmentId: repairSegment.id,
        intentKind: repairSegment.generatedBy && repairSegment.generatedBy.intentKind,
        foundRepair: Boolean(repairSummary && repairSummary.found),
        foundOriginalAfterRepair: Boolean((originalSummary && originalSummary.found) || branchResult.found),
        found: Boolean(branchResult.found),
        reachedMilestone: branchResult.reachedMilestone,
        failedSegmentId: branchResult.failedSegment && branchResult.failedSegment.segmentId,
        score: Math.round(branch.score),
      };
      repairBranches.push(summary);
      branches.push(branch);
    });
    if (branches.length === 0) {
      return {
        ...result,
        adaptive: {
          enabled: true,
          attempts,
          insertedSegments,
          repairCount: insertedSegments.length,
          repairBranches,
          selectedBranch,
          stoppedReason: "failed-segment-not-found",
        },
        effectiveSpec: spec,
      };
    }
    branches.sort((left, right) => right.score - left.score);
    const selected = branches[0];
    selectedBranch = repairBranches.findIndex((branch) =>
      branch.repairIndex === selected.repairIndex && branch.branchIndex === selected.branchIndex
    );
    insertedSegments.push(selected.repairSegment);
    if (selected.result.found) {
      return buildAdaptiveReturn(selected.result, selected.nextSpec, attempts, insertedSegments, repairBranches, selectedBranch);
    }
    spec = selected.nextSpec;
    graphConfig = selected.graphConfig || graphConfig;
  }
  throw new Error("unreachable adaptive planner exit");
}

module.exports = {
  buildRepairSegment,
  buildRepairSegments,
  collectRepairCandidates,
  runAdaptiveSegmentPlanner,
};
