"use strict";

const { buildDpStateKey, searchDP } = require("./dp-search");
const { formatActionLabel } = require("./enemy-labels");
const { getTileDefinitionAt, cloneState } = require("./state");

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function effectiveHeroValue(state, field) {
  const hero = (state || {}).hero || {};
  const flags = (state || {}).flags || {};
  return Math.floor(number(hero[field], 0) * number(flags[`__${field}_buff__`], 1));
}

function summarizeHero(state) {
  const hero = (state || {}).hero || {};
  return {
    hp: number(hero.hp, 0),
    atk: number(hero.atk, 0),
    def: number(hero.def, 0),
    mdef: number(hero.mdef, 0),
    lv: number(hero.lv, 0),
    exp: number(hero.exp, 0),
    money: number(hero.money, 0),
    equipment: Array.isArray(hero.equipment) ? hero.equipment.slice() : [],
  };
}

function summarizeEffectiveHero(state) {
  const hero = summarizeHero(state);
  return {
    hp: hero.hp,
    atk: effectiveHeroValue(state, "atk"),
    def: effectiveHeroValue(state, "def"),
    mdef: effectiveHeroValue(state, "mdef"),
    lv: hero.lv,
    exp: hero.exp,
  };
}

function hasEquipment(state, itemId) {
  return Array.isArray(((state || {}).hero || {}).equipment) && state.hero.equipment.includes(itemId);
}

function findPrimitiveAction(simulator, state, summary) {
  try {
    return (simulator.enumeratePrimitiveActions(state).actions || []).find((action) => action.summary === summary) || null;
  } catch (error) {
    return null;
  }
}

function checkMinFields(actual, expected, prefix, missing) {
  Object.entries(expected || {}).forEach(([field, value]) => {
    const got = number(actual[field], 0);
    if (got < Number(value)) {
      missing.push({ field: `${prefix}.${field}`, expected: Number(value), actual: got });
    }
  });
}

function missingGoalFields(project, simulator, state, segment) {
  const goal = (segment || {}).goal || {};
  const missing = [];
  if (goal.floorId && state.floorId !== goal.floorId) {
    missing.push({ field: "floorId", expected: goal.floorId, actual: state.floorId });
  }
  checkMinFields(summarizeHero(state), goal.minHero, "hero", missing);
  checkMinFields(summarizeEffectiveHero(state), goal.minEffectiveHero, "effectiveHero", missing);
  (goal.equipmentIncludes || []).forEach((itemId) => {
    if (!hasEquipment(state, itemId)) missing.push({ field: "equipment", expected: itemId, actual: summarizeHero(state).equipment });
  });
  if (goal.type === "bossDefeated" || goal.type === "tileRemoved") {
    const tile = getTileDefinitionAt(project, state, goal.floorId, goal.x, goal.y);
    if (tile != null) {
      missing.push({
        field: "tileRemoved",
        expected: `${goal.floorId}:${goal.x},${goal.y}=removed`,
        actual: tile.id || tile.number,
      });
    }
  }
  (goal.removedTiles || []).forEach((required) => {
    const tile = getTileDefinitionAt(project, state, required.floorId, required.x, required.y);
    if (tile != null) {
      missing.push({
        field: "removedTiles",
        expected: `${required.floorId}:${required.x},${required.y}=removed`,
        actual: tile.id || tile.number,
      });
    }
  });
  (goal.presentTiles || []).forEach((required) => {
    const tile = getTileDefinitionAt(project, state, required.floorId, required.x, required.y);
    if (tile == null) {
      missing.push({
        field: "presentTiles",
        expected: `${required.floorId}:${required.x},${required.y}=present`,
        actual: "removed-or-missing",
      });
    }
  });
  if (goal.actionSurvivable && goal.actionSurvivable.summary) {
    const action = findPrimitiveAction(simulator, state, goal.actionSurvivable.summary);
    if (!action) {
      missing.push({ field: "actionSurvivable", expected: goal.actionSurvivable.summary, actual: "missing-action" });
    } else {
      const damage = number((action.estimate || {}).damage, Number.POSITIVE_INFINITY);
      if (goal.actionSurvivable.exactDamage != null && damage !== Number(goal.actionSurvivable.exactDamage)) {
        missing.push({ field: "actionDamage", expected: Number(goal.actionSurvivable.exactDamage), actual: damage });
      }
      if (!(number((state.hero || {}).hp, 0) > damage)) {
        missing.push({ field: "actionSurvivable", expected: `hp > ${damage}`, actual: number((state.hero || {}).hp, 0) });
      }
    }
  }
  return missing;
}

function buildSegmentGoalPredicate(project, segment, simulator) {
  return (state) => missingGoalFields(project, simulator, state, segment).length === 0;
}

function parseActionTileKey(summary) {
  const match = /^[^@]+@([^:]+):(\d+),(\d+)(?:\b|$)/.exec(String(summary || ""));
  if (!match) return null;
  return `${match[1]}:${match[2]},${match[3]}`;
}

function isRequiredTileStillPresent(project, state, required) {
  return getTileDefinitionAt(project, state, required.floorId, required.x, required.y) != null;
}

function goalActionScore(simulator, state, action, segment) {
  const goal = (segment || {}).goal || {};
  let score = 0;
  const actionTileKey = parseActionTileKey(action && action.summary);
  for (const required of goal.removedTiles || []) {
    const requiredKey = `${required.floorId}:${required.x},${required.y}`;
    if (actionTileKey === requiredKey && isRequiredTileStillPresent(simulator.project, state, required)) {
      score += 10000000;
    }
  }
  for (const preserved of goal.presentTiles || []) {
    const preservedKey = `${preserved.floorId}:${preserved.x},${preserved.y}`;
    if (actionTileKey === preservedKey && isRequiredTileStillPresent(simulator.project, state, preserved)) {
      score -= 10000000;
    }
  }
  if (action && action.kind === "equip") {
    for (const itemId of goal.equipmentIncludes || []) {
      if (String(action.summary || "") === `equip:${itemId}` && !hasEquipment(state, itemId)) score += 12000000;
    }
  }
  if (action && action.kind === "changeFloor" && goal.floorId && action.changeFloor && action.changeFloor.floorId === goal.floorId) {
    score += 500000;
  }
  return score;
}

function segmentPreviewScore(simulator, state, action) {
  if (!action || action.kind === "changeFloor") return 0;
  try {
    const preview = simulator.applyAction(state, action, { storeRoute: false });
    const beforeHero = summarizeHero(state);
    const afterHero = summarizeHero(preview);
    const beforeEffective = summarizeEffectiveHero(state);
    const afterEffective = summarizeEffectiveHero(preview);
    const equipmentGain = afterHero.equipment.filter((itemId) => !beforeHero.equipment.includes(itemId)).length;
    return Math.max(0,
      (afterHero.hp - beforeHero.hp) +
      (afterEffective.atk - beforeEffective.atk) * 50000 +
      (afterEffective.def - beforeEffective.def) * 40000 +
      (afterEffective.mdef - beforeEffective.mdef) * 5000 +
      (afterHero.exp - beforeHero.exp) * 1500 +
      equipmentGain * 300000
    );
  } catch (error) {
    return 0;
  }
}

function annotateSegmentAction(simulator, state, action, segment) {
  const goalScore = goalActionScore(simulator, state, action, segment);
  const dpConfig = (segment || {}).dp || {};
  const previewScore = dpConfig.enablePreviewScore === false
    ? 0
    : dpConfig.enablePreviewScore === "required"
      ? (goalScore > 0 ? segmentPreviewScore(simulator, state, action) : 0)
      : segmentPreviewScore(simulator, state, action);
  const score = goalScore + previewScore;
  if (score === 0) return action;
  return {
    ...action,
    estimate: {
      ...(action.estimate || {}),
      segmentPreviewScore: score,
    },
  };
}

function parseChangeFloorSummary(summary) {
  const match = /^changeFloor@([^:]+):(\d+),(\d+)$/.exec(summary || "");
  return match ? `${match[1]}:${match[2]},${match[3]}` : null;
}

function isAllowedChangeFloor(action, state, policy) {
  const allowed = new Set((policy.allowChangeFloors || []).map(String));
  const changeKey = parseChangeFloorSummary(action.summary);
  if (changeKey && allowed.has(changeKey)) return true;
  const floorId = action.floorId || state.floorId;
  if (policy.allowedFloors && !policy.allowedFloors.includes(floorId)) return false;
  const targetFloor = action.changeFloor && action.changeFloor.floorId;
  return !targetFloor || !policy.allowedFloors || policy.allowedFloors.includes(targetFloor);
}

function isAllowedAction(action, state, segment, simulator) {
  const policy = (segment || {}).actionPolicy || {};
  const goal = (segment || {}).goal || {};
  const allowedKinds = new Set(policy.actionKinds || ["battle", "pickup", "equip", "openDoor", "useTool", "changeFloor", "event"]);
  if (!action || !allowedKinds.has(action.kind)) return false;
  if (action.kind === "resourcePocket" || action.kind === "resourceCluster" || action.kind === "resourceChain" || action.kind === "fightToLevelUp") return false;
  if (action.kind === "event" && policy.forbidUnsupportedEvents !== false && (action.unsupported || action.hasStateChange === false)) return false;
  const actionTileKey = parseActionTileKey(action.summary);
  for (const preserved of goal.presentTiles || []) {
    const preservedKey = `${preserved.floorId}:${preserved.x},${preserved.y}`;
    if (actionTileKey === preservedKey && isRequiredTileStillPresent(simulator.project, state, preserved)) return false;
  }
  if (action.kind === "changeFloor") return isAllowedChangeFloor(action, state, policy);
  const floorId = action.floorId || state.floorId;
  return !policy.allowedFloors || policy.allowedFloors.includes(floorId);
}

function buildSegmentActionProvider(simulator, segment) {
  return (unusedSimulator, state) => (simulator.enumeratePrimitiveActions(state).actions || [])
    .filter((action) => isAllowedAction(action, state, segment, simulator))
    .map((action) => annotateSegmentAction(simulator, state, action, segment));
}

function routeLength(state) {
  return Array.isArray((state || {}).route) ? state.route.length : 0;
}

function goalCandidateScore(state) {
  const hero = summarizeHero(state);
  const effective = summarizeEffectiveHero(state);
  return hero.hp +
    effective.atk * 100000 +
    effective.def * 80000 +
    effective.mdef * 8000 +
    hero.exp * 1000 -
    routeLength(state) * 10;
}

function compareCandidateStates(left, right) {
  if (!right) return -1;
  if (!left) return 1;
  const leftHero = summarizeHero(left);
  const rightHero = summarizeHero(right);
  const hpDiff = rightHero.hp - leftHero.hp;
  if (hpDiff !== 0) return hpDiff;
  for (const field of ["atk", "def", "mdef"]) {
    const diff = effectiveHeroValue(right, field) - effectiveHeroValue(left, field);
    if (diff !== 0) return diff;
  }
  if (rightHero.exp !== leftHero.exp) return rightHero.exp - leftHero.exp;
  return routeLength(left) - routeLength(right);
}

function addTag(record, tag) {
  if (!record.tags.includes(tag)) record.tags.push(tag);
}

function selectGoalSkyline(simulator, states, segment, options) {
  const limit = Math.max(1, number((options || {}).candidateLimit || (segment.dp || {}).goalSkylineLimit, 8));
  const keyMode = ((segment.dp || {}).keyMode || "region");
  const byKey = new Map();
  (states || []).filter(Boolean).forEach((state) => {
    const key = buildDpStateKey(simulator, state, { dpKeyMode: keyMode });
    const existing = byKey.get(key);
    if (!existing || compareCandidateStates(state, existing) < 0) byKey.set(key, state);
  });
  const records = Array.from(byKey.values()).map((state, index) => ({
    id: `${segment.id || "segment"}#${index}`,
    state,
    route: Array.isArray(state.route) ? state.route.slice() : [],
    hero: summarizeHero(state),
    effectiveHero: summarizeEffectiveHero(state),
    score: goalCandidateScore(state),
    tags: [],
  }));
  const rolePickers = [
    ["highest-hp", (left, right) => summarizeHero(right.state).hp - summarizeHero(left.state).hp],
    ["highest-atk", (left, right) => right.effectiveHero.atk - left.effectiveHero.atk],
    ["highest-def", (left, right) => right.effectiveHero.def - left.effectiveHero.def],
    ["highest-mdef", (left, right) => right.effectiveHero.mdef - left.effectiveHero.mdef],
    ["highest-exp", (left, right) => right.hero.exp - left.hero.exp],
    ["shortest", (left, right) => left.route.length - right.route.length],
    ["best-combat", (left, right) => right.score - left.score],
  ];
  rolePickers.forEach(([tag, compare]) => {
    const winner = records.slice().sort(compare)[0];
    if (winner) addTag(winner, tag);
  });
  return records
    .sort((left, right) => {
      const tagDiff = right.tags.length - left.tags.length;
      if (tagDiff !== 0) return tagDiff;
      return compareCandidateStates(left.state, right.state);
    })
    .slice(0, limit);
}

function compactState(state) {
  if (!state) return null;
  return {
    floorId: state.floorId,
    hero: summarizeHero(state),
    effectiveHero: summarizeEffectiveHero(state),
    routeTail: Array.isArray(state.route) ? state.route.slice(-12) : [],
  };
}

function summarizeSegmentFailure(project, segment, result, simulator) {
  const best = (result && (result.bestProgressState || result.bestSeenState)) || null;
  return {
    failedSegmentId: segment.id,
    label: segment.label,
    bestSeen: compactState(best),
    missingGoalFields: best ? missingGoalFields(project, simulator, best, segment) : [{ field: "state", expected: "reachable", actual: "none" }],
    diagnostics: {
      actionTrimmed: result && result.diagnostics && result.diagnostics.dp && result.diagnostics.dp.actionTrimmed,
      frontierRemaining: result && result.frontierSize,
      rejectedByHigherHp: result && result.diagnostics && result.diagnostics.dp && result.diagnostics.dp.rejectedByHigherHp,
      replacedLowerHp: result && result.diagnostics && result.diagnostics.dp && result.diagnostics.dp.replacedLowerHp,
    },
    recommendedNext: [
      "increase segment candidate limit",
      "rerun previous milestone with location key",
      "expand allowed action floors",
    ],
  };
}

function searchSegmentDP(simulator, startState, segment, options) {
  const config = options || {};
  const dpConfig = {
    ...(segment.dp || {}),
    ...(config.dpOverrides || {}),
  };
  const prefixRoute = Array.isArray(config.prefixRoute) ? config.prefixRoute : (Array.isArray(startState.route) ? startState.route : []);
  const seed = cloneState(startState);
  seed.route = prefixRoute.slice();
  const result = searchDP(simulator, seed, {
    targetFloorId: segment.goal && segment.goal.floorId,
    maxExpansions: number(dpConfig.maxExpansions, 8000),
    maxActionsPerState: number(dpConfig.maxActionsPerState, 9999),
    maxRuntimeMs: number(dpConfig.maxRuntimeMs, 15000),
    dpKeyMode: dpConfig.keyMode || dpConfig.dpKeyMode || "region",
    dpAgendaMode: dpConfig.agendaMode || "best-first",
    stopOnFirstGoal: dpConfig.stopOnFirstGoal === true,
    goalSkylineLimit: number(dpConfig.goalSkylineLimit, 8),
    actionProvider: buildSegmentActionProvider(simulator, segment),
    goalPredicate: buildSegmentGoalPredicate(simulator.project, segment, simulator),
  });
  const goalStates = Array.isArray(result.goalSkylineStates) && result.goalSkylineStates.length > 0
    ? result.goalSkylineStates
    : [result.bestGoalState || result.goalState].filter(Boolean);
  const goalSkyline = selectGoalSkyline(simulator, goalStates, segment, {
    candidateLimit: config.candidateLimit || dpConfig.goalSkylineLimit,
  });
  return {
    segmentId: segment.id,
    found: goalSkyline.length > 0,
    startCandidateId: config.candidateId || null,
    goalSkyline,
    bestSeen: result.bestSeenState,
    bestProgress: result.bestProgressState,
    diagnostics: {
      dp: result.diagnostics && result.diagnostics.dp,
      actionTrimmed: result.diagnostics && result.diagnostics.dp && result.diagnostics.dp.actionTrimmed,
      rejectedByHigherHp: result.diagnostics && result.diagnostics.dp && result.diagnostics.dp.rejectedByHigherHp,
      replacedLowerHp: result.diagnostics && result.diagnostics.dp && result.diagnostics.dp.replacedLowerHp,
      failure: goalSkyline.length > 0 ? null : summarizeSegmentFailure(simulator.project, segment, result, simulator),
      actionScope: segment.actionPolicy || {},
    },
    rawResult: result,
  };
}

function milestoneRange(milestoneSpec, fromMilestoneId, toMilestoneId) {
  const milestones = milestoneSpec.milestones || [];
  const fromIndex = fromMilestoneId ? milestones.findIndex((milestone) => milestone.id === fromMilestoneId) : -1;
  const toIndex = toMilestoneId ? milestones.findIndex((milestone) => milestone.id === toMilestoneId) : -1;
  if (fromMilestoneId && fromIndex < 0) return [];
  if (toMilestoneId && toIndex < 0) return [];
  const startIndex = fromMilestoneId ? fromIndex + 1 : 0;
  const endIndex = toMilestoneId ? toIndex : milestones.length - 1;
  if (startIndex < 0 || endIndex < 0 || startIndex > endIndex) return [];
  return milestones.slice(startIndex, endIndex + 1);
}

function mergeMilestoneFrontier(simulator, candidates, segment, options) {
  const states = (candidates || []).map((candidate) => candidate.state).filter(Boolean);
  const selected = selectGoalSkyline(simulator, states, segment, options);
  return selected.map((record, index) => ({
    id: `${segment.id}:candidate-${index}`,
    state: record.state,
    route: record.route,
    hero: record.hero,
    effectiveHero: record.effectiveHero,
    tags: record.tags,
    score: record.score,
  }));
}

function runMilestoneGraph(simulator, initialState, milestoneSpec, options) {
  const config = options || {};
  const segments = milestoneRange(milestoneSpec, config.fromMilestoneId, config.toMilestoneId);
  let frontier = [{
    id: "initial#0",
    state: cloneState(initialState),
    route: Array.isArray(initialState.route) ? initialState.route.slice() : [],
    hero: summarizeHero(initialState),
    effectiveHero: summarizeEffectiveHero(initialState),
    tags: ["initial"],
    score: goalCandidateScore(initialState),
  }];
  const segmentResults = [];
  for (const segment of segments) {
    const nextCandidates = [];
    const attempts = [];
    for (const candidate of frontier) {
      const result = searchSegmentDP(simulator, candidate.state, segment, {
        candidateId: candidate.id,
        prefixRoute: candidate.route,
        candidateLimit: config.candidateLimit || (segment.dp && segment.dp.goalSkylineLimit),
        dpOverrides: {
          ...(config.dpKeyMode ? { keyMode: config.dpKeyMode } : {}),
          ...(config.maxExpansions ? { maxExpansions: config.maxExpansions } : {}),
          ...(config.maxRuntimeMs ? { maxRuntimeMs: config.maxRuntimeMs } : {}),
          ...(config.stopOnFirstGoal != null ? { stopOnFirstGoal: config.stopOnFirstGoal } : {}),
        },
      });
      attempts.push(result);
      result.goalSkyline.forEach((goal) => nextCandidates.push({
        ...goal,
        id: `${segment.id}:${candidate.id}:${goal.id}`,
      }));
    }
    const merged = mergeMilestoneFrontier(simulator, nextCandidates, segment, {
      candidateLimit: config.candidateLimit || (segment.dp && segment.dp.goalSkylineLimit),
    });
    segmentResults.push({
      segmentId: segment.id,
      label: segment.label,
      found: merged.length > 0,
      startCandidatesTried: frontier.length,
      candidates: merged.map((candidate) => ({
        id: candidate.id,
        hero: candidate.hero,
        effectiveHero: candidate.effectiveHero,
        tags: candidate.tags,
        routeLength: candidate.route.length,
      })),
      attempts: attempts.map((attempt) => ({
        startCandidateId: attempt.startCandidateId,
        found: attempt.found,
        goalCount: attempt.goalSkyline.length,
        diagnostics: attempt.diagnostics,
      })),
    });
    if (merged.length === 0) {
      return {
        found: false,
        reachedMilestone: segment.startFrom || null,
        failedSegment: segmentResults[segmentResults.length - 1],
        finalCandidates: frontier,
        segmentResults,
      };
    }
    frontier = merged;
  }
  const final = frontier.slice().sort((left, right) => right.score - left.score)[0] || null;
  return {
    found: Boolean(final),
    reachedMilestone: segments.length ? segments[segments.length - 1].id : null,
    failedSegment: null,
    finalCandidate: final,
    finalCandidates: frontier,
    segmentResults,
  };
}

module.exports = {
  buildSegmentActionProvider,
  buildSegmentGoalPredicate,
  runMilestoneGraph,
  searchSegmentDP,
  summarizeEffectiveHero,
  summarizeHero,
  summarizeSegmentFailure,
};
