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
  for (const preferred of goal.preferredPresentTiles || []) {
    const preferredKey = `${preferred.floorId}:${preferred.x},${preferred.y}`;
    if (actionTileKey === preferredKey && isRequiredTileStillPresent(simulator.project, state, preferred)) {
      score -= 1000000;
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

function hasMissingField(missing, predicate) {
  return (missing || []).some((entry) => predicate(String((entry || {}).field || ""), entry || {}));
}

function classifySegmentFailure(missing, segment) {
  const missingFields = missing || [];
  const classes = [];
  const preferredCandidateTags = [];
  const recommendedNext = [];
  const addClass = (failureClass, reason, tags, recommendation) => {
    classes.push({ failureClass, reason });
    (tags || []).forEach((tag) => {
      if (!preferredCandidateTags.includes(tag)) preferredCandidateTags.push(tag);
    });
    if (recommendation && !recommendedNext.includes(recommendation)) recommendedNext.push(recommendation);
  };

  if (hasMissingField(missingFields, (field) => field === "presentTiles")) {
    addClass(
      "present-tile-overconstrained",
      "hard presentTiles constraint was violated before this milestone goal",
      ["best-combat", "shortest"],
      "relax non-essential presentTiles into preferredPresentTiles or add an explicit reason if it is a required later resource"
    );
  }

  if (hasMissingField(missingFields, (field) => field === "actionSurvivable", (entry) => entry.actual === "missing-action")) {
    addClass(
      "target-action-unreachable",
      "required target action is absent from the current primitive action set",
      ["shortest", "best-combat"],
      "check allowedFloors, allowChangeFloors, presentTiles, and local action scope for this segment"
    );
  }

  if (hasMissingField(missingFields, (field) => field === "hero.atk" || field === "effectiveHero.atk")) {
    addClass(
      "atk-deficit",
      "attack threshold is not met",
      ["highest-atk", "best-combat"],
      "backtrack to the previous milestone and try highest-atk or best-combat candidates"
    );
  }

  if (hasMissingField(missingFields, (field) => field === "hero.def" || field === "effectiveHero.def")) {
    addClass(
      "def-deficit",
      "defense threshold is not met",
      ["highest-def", "best-combat"],
      "backtrack to the previous milestone and try highest-def or best-combat candidates"
    );
  }

  if (hasMissingField(missingFields, (field) => field === "hero.mdef" || field === "effectiveHero.mdef")) {
    addClass(
      "mdef-deficit",
      "magic-defense threshold is not met",
      ["highest-mdef", "best-combat"],
      "backtrack to the previous milestone and try highest-mdef or best-combat candidates"
    );
  }

  if (hasMissingField(missingFields, (field) => field === "hero.hp")) {
    addClass(
      "hp-deficit",
      "HP threshold is not met",
      ["highest-hp"],
      "backtrack to the previous milestone and try highest-hp candidates"
    );
  }

  if (hasMissingField(missingFields, (field, entry) => field === "actionSurvivable" && entry.actual !== "missing-action")) {
    addClass(
      "action-survivability-deficit",
      "required action exists but current HP cannot survive it",
      ["highest-hp"],
      "backtrack to the previous milestone and try highest-hp candidates"
    );
  }

  if (hasMissingField(missingFields, (field) => field === "equipment")) {
    addClass(
      "equipment-missing",
      "required equipment is not equipped",
      ["best-combat", "shortest"],
      "check whether equip actions or the required item pickup are allowed in this segment"
    );
  }

  if (hasMissingField(missingFields, (field) => field === "tileRemoved" || field === "removedTiles")) {
    addClass(
      "target-tile-not-cleared",
      "required tile remains present at the best seen state",
      ["best-combat", "highest-atk"],
      "retry this segment with a candidate that has stronger combat or verify the target tile is reachable under the action policy"
    );
  }

  if (hasMissingField(missingFields, (field) => field === "floorId")) {
    addClass(
      "floor-scope-mismatch",
      "best seen state did not reach the target floor",
      ["shortest", "best-combat"],
      "check allowedFloors and allowChangeFloors for the segment"
    );
  }

  if (classes.length === 0) {
    addClass(
      "budget-or-action-scope-exhausted",
      "no goal state was found under the current segment budget and action policy",
      ["best-combat", "highest-hp"],
      "increase segment budget, widen action scope, or rerun the previous milestone with location key"
    );
  }

  const primary = classes[0];
  return {
    failureClass: primary.failureClass,
    failureReason: primary.reason,
    allFailureClasses: classes,
    preferredCandidateTags,
    recommendedRepair: recommendedNext[0],
    recommendedNext,
    segmentId: segment && segment.id,
  };
}

function summarizeSegmentFailure(project, segment, result, simulator) {
  const best = (result && (result.bestProgressState || result.bestSeenState)) || null;
  const missing = best ? missingGoalFields(project, simulator, best, segment) : [{ field: "state", expected: "reachable", actual: "none" }];
  const classification = classifySegmentFailure(missing, segment);
  return {
    failedSegmentId: segment.id,
    label: segment.label,
    bestSeen: compactState(best),
    missingGoalFields: missing,
    failureClass: classification.failureClass,
    failureReason: classification.failureReason,
    preferredCandidateTags: classification.preferredCandidateTags,
    recommendedRepair: classification.recommendedRepair,
    failurePropagation: classification,
    diagnostics: {
      actionTrimmed: result && result.diagnostics && result.diagnostics.dp && result.diagnostics.dp.actionTrimmed,
      frontierRemaining: result && result.frontierSize,
      rejectedByHigherHp: result && result.diagnostics && result.diagnostics.dp && result.diagnostics.dp.rejectedByHigherHp,
      replacedLowerHp: result && result.diagnostics && result.diagnostics.dp && result.diagnostics.dp.replacedLowerHp,
    },
    recommendedNext: classification.recommendedNext,
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
      goalSkyline: {
        primaryOutput: true,
        count: goalSkyline.length,
        candidates: goalSkyline.map((candidate) => ({
          id: candidate.id,
          tags: candidate.tags,
          hero: candidate.hero,
          effectiveHero: candidate.effectiveHero,
          routeLength: candidate.route.length,
        })),
      },
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

function mergeFailurePropagation(attempts) {
  const failures = (attempts || [])
    .map((attempt) => attempt && attempt.diagnostics && attempt.diagnostics.failure)
    .filter(Boolean);
  if (failures.length === 0) return null;
  const classCounts = {};
  const preferredCandidateTags = [];
  const recommendedNext = [];
  failures.forEach((failure) => {
    const failureClass = failure.failureClass || "unknown";
    classCounts[failureClass] = Number(classCounts[failureClass] || 0) + 1;
    (failure.preferredCandidateTags || []).forEach((tag) => {
      if (!preferredCandidateTags.includes(tag)) preferredCandidateTags.push(tag);
    });
    (failure.recommendedNext || []).forEach((recommendation) => {
      if (!recommendedNext.includes(recommendation)) recommendedNext.push(recommendation);
    });
  });
  const primaryFailureClass = Object.entries(classCounts)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0][0];
  return {
    primaryFailureClass,
    classCounts,
    preferredCandidateTags,
    recommendedNext,
  };
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
    const failurePropagation = mergeFailurePropagation(attempts);
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
      failurePropagation,
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
