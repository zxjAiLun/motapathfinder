"use strict";

const { buildDpStateKey, compareDpBest, searchDP } = require("./dp-search");
const { estimateBattleSurvivability } = require("./battle-thresholds");
const {
  annotateStateResourceTiming,
  buildResourceTimingOptions,
  compareResourceTimingStates,
  getTiming,
  hasTimingConflict,
  resourceTimingRoles,
} = require("./resource-timing-model");
const { formatActionLabel } = require("./enemy-labels");
const { compareLegacyStates, objectiveProjector } = require("./objective-spec");
const { buildSolverSnapshot } = require("./route-snapshot");
const {
  cloneState,
  getDecisionDepth,
  getRawRouteLength,
  getTileDefinitionAt,
} = require("./state");
const { buildStateKey } = require("./state-key");
const { getFloorOrder } = require("./floor-id");
const { resolveRelativeFloor } = require("./floor-transitions");
const { compileGoalDependencyGraph } = require("./goal-dependency-graph");
const { compileAdmissibleFeasibilityBounds } = require("./goal-feasibility-bounds");
const reachAndBattleOracle = require("./reach-and-battle-oracle");
const { buildSearchOutcome } = require("./search-outcome");
const { executeIsolatedSegment } = require("./isolated-segment-executor");
// Iteration 6 – failure-conditioned adaptive investment. The scanner derives
// generic resource intents (atk/def/mdef/hp/path/equipment) from a trusted
// complete failure and inspects the REAL action opportunities near each
// rollback candidate. No circular dependency: the scanner does not import
// segment-dp.
const { scanResourceIntents } = require("./resource-intent-scanner");
// PR-5.24c Iteration 2 Repair 1 – shared compact progress projection and
// weightless comparator (also used by the isolated worker for IPC-safe
// progress evidence).
const {
  compactProgressProjection,
  compareProgressProjections,
  bestFrontierGoalProgress,
  bestOfProgressProjections,
} = require("./segment-progress");

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const SEARCH_INTENTS = new Set(["skyline", "first-feasible", "adaptive-feasible"]);

function resolveSearchIntentOptions(options) {
  const config = options || {};
  const searchIntent = String(config.searchIntent || "skyline");
  if (!SEARCH_INTENTS.has(searchIntent)) {
    throw new Error(
      `Unknown search intent: ${searchIntent}. Expected skyline, first-feasible, or adaptive-feasible.`,
    );
  }
  if (!["first-feasible", "adaptive-feasible"].includes(searchIntent)) return config;
  return {
    ...config,
    searchIntent,
    stopOnFirstGoal: config.stopOnFirstGoal == null ? true : config.stopOnFirstGoal,
    dpPriorityMode: config.dpPriorityMode == null && config.priorityMode == null
      ? "goal-directed"
      : config.dpPriorityMode,
    ...(searchIntent === "adaptive-feasible"
      ? {
          enableFailureBacktracking: config.enableFailureBacktracking !== false,
          adaptiveBacktrackDepth: Math.max(1, number(config.adaptiveBacktrackDepth, 3)),
          milestoneFrontierResourceDiversity:
            config.milestoneFrontierResourceDiversity !== false,
        }
      : {}),
  };
}

function heroHp(state) {
  return number(((state || {}).hero || {}).hp, 0);
}

function effectiveHeroValue(state, field) {
  const hero = (state || {}).hero || {};
  const flags = (state || {}).flags || {};
  return Math.floor(
    number(hero[field], 0) * number(flags[`__${field}_buff__`], 1),
  );
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
  return (
    Array.isArray(((state || {}).hero || {}).equipment) &&
    state.hero.equipment.includes(itemId)
  );
}

function findPrimitiveAction(simulator, state, summary) {
  try {
    return (
      (simulator.enumeratePrimitiveActions(state).actions || []).find(
        (action) => action.summary === summary,
      ) || null
    );
  } catch (error) {
    return null;
  }
}

function checkMinFields(actual, expected, prefix, missing) {
  Object.entries(expected || {}).forEach(([field, value]) => {
    const got = number(actual[field], 0);
    if (got < Number(value)) {
      missing.push({
        field: `${prefix}.${field}`,
        expected: Number(value),
        actual: got,
      });
    }
  });
}

function buildActionSurvivableMissing(simulator, state, summary, action) {
  const threshold = estimateBattleSurvivability(
    simulator,
    state,
    action || summary,
  );
  const currentHp = number((state.hero || {}).hp, 0);
  const damage =
    threshold && threshold.supported
      ? number(threshold.currentDamage, Number.POSITIVE_INFINITY)
      : number(
          ((action || {}).estimate || {}).damage,
          Number.POSITIVE_INFINITY,
        );
  const entry = {
    field: "actionSurvivable",
    expected: Number.isFinite(damage) ? `hp > ${damage}` : summary,
    actual: currentHp,
    action: summary,
  };
  if (threshold && threshold.supported) {
    entry.damage = threshold.currentDamage;
    entry.turn = threshold.currentTurn;
    entry.enemyId = threshold.enemyId;
    entry.enemyName = threshold.enemyName;
    entry.enemyLabel = threshold.enemyLabel;
    entry.riskTags = threshold.riskTags;
    entry.special = threshold.special;
    entry.minHpToSurvive = threshold.minHpToSurvive;
    entry.samples = threshold.samples;
    if (threshold.nonMonotonic) entry.nonMonotonic = true;
  } else if (action && action.estimate) {
    entry.damage = damage;
    entry.turn = number(action.estimate.turn, 0);
  }
  return entry;
}

function missingGoalFields(project, simulator, state, segment, options) {
  const config = options || {};
  const diagnostic = config.diagnostic !== false;
  const goal = (segment || {}).goal || {};
  const missing = [];
  if (goal.floorId && state.floorId !== goal.floorId) {
    missing.push({
      field: "floorId",
      expected: goal.floorId,
      actual: state.floorId,
    });
  }
  checkMinFields(summarizeHero(state), goal.minHero, "hero", missing);
  checkMinFields(
    summarizeEffectiveHero(state),
    goal.minEffectiveHero,
    "effectiveHero",
    missing,
  );
  (goal.equipmentIncludes || []).forEach((itemId) => {
    if (!hasEquipment(state, itemId))
      missing.push({
        field: "equipment",
        expected: itemId,
        actual: summarizeHero(state).equipment,
      });
  });
  if (goal.type === "bossDefeated" || goal.type === "tileRemoved") {
    const tile = getTileDefinitionAt(
      project,
      state,
      goal.floorId,
      goal.x,
      goal.y,
    );
    if (tile != null) {
      missing.push({
        field: "tileRemoved",
        expected: `${goal.floorId}:${goal.x},${goal.y}=removed`,
        actual: tile.id || tile.number,
      });
    }
  }
  (goal.removedTiles || []).forEach((required) => {
    const tile = getTileDefinitionAt(
      project,
      state,
      required.floorId,
      required.x,
      required.y,
    );
    if (tile != null) {
      missing.push({
        field: "removedTiles",
        expected: `${required.floorId}:${required.x},${required.y}=removed`,
        actual: tile.id || tile.number,
      });
    }
  });
  if (Array.isArray(goal.anyRemovedTiles) && goal.anyRemovedTiles.length > 0) {
    const matched = goal.anyRemovedTiles.some(
      (required) =>
        getTileDefinitionAt(
          project,
          state,
          required.floorId,
          required.x,
          required.y,
        ) == null,
    );
    if (!matched) {
      missing.push({
        field: "anyRemovedTiles",
        expected: goal.anyRemovedTiles.map(
          (tile) => `${tile.floorId}:${tile.x},${tile.y}=removed`,
        ),
        actual: "all-present",
      });
    }
  }
  (goal.presentTiles || []).forEach((required) => {
    const tile = getTileDefinitionAt(
      project,
      state,
      required.floorId,
      required.x,
      required.y,
    );
    if (tile == null) {
      missing.push({
        field: "presentTiles",
        expected: `${required.floorId}:${required.x},${required.y}=present`,
        actual: "removed-or-missing",
      });
    }
  });
  if (goal.resourceDeferral) {
    const deferral = goal.resourceDeferral;
    const resourceSummary = deferral.resourceSummary || deferral.summary;
    if (resourceSummary && /^battle:/.test(resourceSummary)) {
      const threshold = estimateBattleSurvivability(simulator, state, resourceSummary, {
        skipMinHp: true,
      });
      if (!threshold || !threshold.supported) {
        missing.push({
          field: "resourceDeferral",
          expected: resourceSummary,
          actual: "unsupported-resource-target",
        });
      } else {
        const maxDamage = deferral.maxDamage != null
          ? Number(deferral.maxDamage)
          : Number.POSITIVE_INFINITY;
        if (Number(threshold.currentDamage) > maxDamage) {
          missing.push({
            field: "resourceDeferral.damage",
            expected: `<= ${maxDamage}`,
            actual: threshold.currentDamage,
            baselineDamage: deferral.baselineDamage,
            saving: Number(deferral.baselineDamage || 0) - Number(threshold.currentDamage || 0),
          });
        }
        if (deferral.requireSurvivable !== false && !threshold.survivable) {
          missing.push({
            field: "resourceDeferral.survivable",
            expected: `hp > ${threshold.currentDamage}`,
            actual: number((state.hero || {}).hp, 0),
            damage: threshold.currentDamage,
          });
        }
      }
    }
  }
  if (goal.actionSurvivable && goal.actionSurvivable.summary) {
    if (
      actionTargetAlreadyRemovedByGoal(
        project,
        state,
        goal,
        goal.actionSurvivable.summary,
      )
    ) {
      return missing;
    }
    const action = findPrimitiveAction(
      simulator,
      state,
      goal.actionSurvivable.summary,
    );
    if (!action) {
      if (!diagnostic) {
        missing.push({
          field: "actionSurvivable",
          expected: goal.actionSurvivable.summary,
          actual: "missing-action",
        });
      } else {
        const threshold = estimateBattleSurvivability(
          simulator,
          state,
          goal.actionSurvivable.summary,
        );
        if (threshold && threshold.supported && !threshold.survivable) {
          missing.push(
            buildActionSurvivableMissing(
              simulator,
              state,
              goal.actionSurvivable.summary,
              null,
            ),
          );
        } else {
          missing.push({
            field: "actionSurvivable",
            expected: goal.actionSurvivable.summary,
            actual: "missing-action",
          });
        }
      }
    } else {
      const damage = number(
        (action.estimate || {}).damage,
        Number.POSITIVE_INFINITY,
      );
      if (
        goal.actionSurvivable.exactDamage != null &&
        damage !== Number(goal.actionSurvivable.exactDamage)
      ) {
        missing.push({
          field: "actionDamage",
          expected: Number(goal.actionSurvivable.exactDamage),
          actual: damage,
        });
      }
      if (!(number((state.hero || {}).hp, 0) > damage)) {
        if (diagnostic) {
          missing.push(
            buildActionSurvivableMissing(
              simulator,
              state,
              goal.actionSurvivable.summary,
              action,
            ),
          );
        } else {
          missing.push({
            field: "actionSurvivable",
            expected: Number.isFinite(damage)
              ? `hp > ${damage}`
              : goal.actionSurvivable.summary,
            actual: number((state.hero || {}).hp, 0),
            action: goal.actionSurvivable.summary,
            damage,
          });
        }
      }
    }
  }
  return missing;
}

function projectSegmentGoalProgress(project, state, segment) {
  const graph = compileGoalDependencyGraph(project, [segment]);
  return graph.project(state, segment && segment.id);
}

// PR-5.24c Iteration 2 Repair 1a – determinate replay completion.
// A replay segment counts as determinately COMPLETE only when the execution
// itself reports a canonical complete search AND no authority (probe, memory,
// resource, global) truncated it. Both the first-probe wave loop and the
// continuation loop share this single definition:
//   * probeExpired (before or after the leg)
//   * memoryLimited / resource / global stop
//   * candidateSliceSearchComplete !== true
//   * candidateSliceFinalPending > 0
//   * candidateSliceTerminalIncomplete > 0
// Any of these => NOT determinately complete: the cursor stays at K, the
// ticket never claims PROBE_COMPLETE_OR_GOAL from this leg, and the run can
// never claim canonical EXHAUSTED through this replay.
function isReplayDeterminatelyComplete(execution, options) {
  const context = options || {};
  if (context.probeExpiredBefore === true) return false;
  if (context.probeExpiredAfter === true) return false;
  if (context.resourceInterrupted === true) return false;
  const telemetry =
    execution && execution.summary && execution.summary.candidateSliceTelemetry;
  if (!telemetry) return false;
  if (telemetry.candidateSliceSearchComplete !== true) return false;
  if (Number(telemetry.candidateSliceFinalPending || 0) > 0) return false;
  if (Number(telemetry.candidateSliceTerminalIncomplete || 0) > 0) return false;
  return true;
}

// PR-5.24c Iteration 2 Repair 1b – hypothesis-level determinate outcome.
// Production pure helper used by BOTH the first-probe wave loop and the
// continuation loop. It encodes the frozen priority:
//   goal-reached
//   → probe-limited (local probe stop, no authoritative global stop)
//   → resource-limited (authoritative memory/global stop)
//   → incomplete (replay chain or anchor execution indeterminate — the
//     canonical completion contract was not satisfied somewhere)
//   → exhausted (determinate natural failure: every ENTERED execution was
//     determinately complete and the frontier is empty)
// An indeterminate chain can NEVER claim exhausted: the hypothesis stays
// PROBE_PENDING and the run can never claim canonical EXHAUSTED through it.
//
// Inputs (all from the production call sites):
//   goalReached        boolean
//   probeExpired       boolean (local probe stop occurred)
//   resourceInterrupted boolean (memory/global authoritative stop occurred)
//   enteredReplays     number of replay legs actually entered
//   completedReplays   number of determinately-completed replay legs
//   emptyFrontier      repair frontier empty at chain end
//   anchorExecution    the anchor-expand execution (for the anchor-only case:
//                      enteredReplays === 0; an empty anchor frontier may
//                      only claim exhaustion when the anchor itself was
//                      determinately complete)
//   globalStopReason   authoritative global budget stop at outcome time
function classifyAdaptiveHypothesisOutcome(shape) {
  const s = shape || {};
  if (s.goalReached === true) return "goal-reached";
  if (s.probeExpired === true && s.resourceInterrupted !== true) return "probe-limited";
  if (s.resourceInterrupted === true) return "resource-limited";
  const entered = Number(s.enteredReplays || 0);
  const completed = Number(s.completedReplays || 0);
  if (entered > 0) {
    if (completed !== entered) return "incomplete";
    // Every entered replay leg was determinately complete: a determinate
    // natural failure may claim exhaustion when the frontier is empty.
    if (s.emptyFrontier === true) return "exhausted";
    return "probe-limited";
  }
  // Anchor-only chain (no replay legs entered): an EMPTY frontier may only
  // claim exhaustion when the anchor execution itself was determinately
  // complete. A non-empty frontier simply continues (probe-limited shape
  // keeps the hypothesis pending).
  if (s.emptyFrontier === true) {
    const anchorDeterminate = isReplayDeterminatelyComplete(
      s.anchorExecution,
      { resourceInterrupted: s.resourceInterrupted === true },
    );
    return anchorDeterminate ? "exhausted" : "incomplete";
  }
  return "probe-limited";
}

function buildSegmentStateFeasibilityPredicate(project, segment, mode) {
  const normalizedMode = String(mode || "off");
  if (normalizedMode === "off") return null;
  if (!["protected-present-tiles", "admissible-v1"].includes(normalizedMode)) {
    throw new Error(
      `Unknown goal feasibility mode: ${normalizedMode}. Expected off, protected-present-tiles, or admissible-v1.`,
    );
  }
  if (normalizedMode === "admissible-v1") {
    const compiled = compileAdmissibleFeasibilityBounds(project, segment);
    return (state) => compiled.evaluate(state);
  }
  return (state) => {
    const progress = projectSegmentGoalProgress(project, state, segment);
    if (progress.feasible) return { feasible: true };
    return {
      feasible: false,
      reason: "protected-present-tile-missing",
      missingProtectedTiles: progress.missingProtectedTiles,
    };
  };
}

function buildSegmentGoalPredicate(project, segment, simulator) {
  return (state) =>
    missingGoalFields(project, simulator, state, segment, { diagnostic: false })
      .length === 0;
}

function parseActionTileKey(summary) {
  const match = /^[^@]+@([^:]+):(\d+),(\d+)(?:\b|$)/.exec(
    String(summary || ""),
  );
  if (!match) return null;
  return `${match[1]}:${match[2]},${match[3]}`;
}

function parseTileKeyParts(tileKey) {
  const match = /^([^:]+):(\d+),(\d+)$/.exec(String(tileKey || ""));
  if (!match) return null;
  return { floorId: match[1], x: Number(match[2]), y: Number(match[3]) };
}

function segmentProtectedTiles(segment) {
  const goal = (segment || {}).goal || {};
  const policy = (segment || {}).actionPolicy || {};
  const byKey = new Map();
  [...(goal.presentTiles || []), ...(policy.protectedTiles || [])].forEach(
    (tile) => {
      if (!tile || tile.floorId == null || tile.x == null || tile.y == null)
        return;
      byKey.set(`${tile.floorId}:${tile.x},${tile.y}`, tile);
    },
  );
  return Array.from(byKey.values());
}

function actionTargetsProtectedTile(action, segment) {
  const actionTileKey = parseActionTileKey(action && action.summary);
  if (!actionTileKey) return false;
  return segmentProtectedTiles(segment).some(
    (tile) => `${tile.floorId}:${tile.x},${tile.y}` === actionTileKey,
  );
}

function isRequiredTileStillPresent(project, state, required) {
  return (
    getTileDefinitionAt(
      project,
      state,
      required.floorId,
      required.x,
      required.y,
    ) != null
  );
}

function actionTargetAlreadyRemovedByGoal(project, state, goal, summary) {
  const actionTileKey = parseActionTileKey(summary);
  if (!actionTileKey) return false;
  const requiredTiles = [];
  if (
    (goal.type === "bossDefeated" || goal.type === "tileRemoved") &&
    goal.floorId != null &&
    goal.x != null &&
    goal.y != null
  ) {
    requiredTiles.push({ floorId: goal.floorId, x: goal.x, y: goal.y });
  }
  (goal.removedTiles || []).forEach((tile) => requiredTiles.push(tile));
  return requiredTiles.some(
    (tile) =>
      `${tile.floorId}:${tile.x},${tile.y}` === actionTileKey &&
      getTileDefinitionAt(project, state, tile.floorId, tile.x, tile.y) == null,
  );
}

function resolveActionTargetFloorId(project, action, state) {
  if (!action || action.kind !== "changeFloor" || !action.changeFloor) return null;
  const rawTargetFloor = action.changeFloor.floorId;
  if (!rawTargetFloor) return null;
  if (rawTargetFloor === ":next" || rawTargetFloor === ":before") {
    const floorId = action.floorId || (state && state.floorId);
    if (project && floorId) {
      try {
        return resolveRelativeFloor(project, floorId, rawTargetFloor);
      } catch (error) {
        return rawTargetFloor;
      }
    }
  }
  return rawTargetFloor;
}

function goalActionScore(simulator, state, action, segment) {
  const goal = (segment || {}).goal || {};
  let score = 0;
  const actionTileKey = parseActionTileKey(action && action.summary);
  for (const required of goal.removedTiles || []) {
    const requiredKey = `${required.floorId}:${required.x},${required.y}`;
    if (
      actionTileKey === requiredKey &&
      isRequiredTileStillPresent(simulator.project, state, required)
    ) {
      score += 10000000;
    }
  }
  for (const required of goal.anyRemovedTiles || []) {
    const requiredKey = `${required.floorId}:${required.x},${required.y}`;
    if (
      actionTileKey === requiredKey &&
      isRequiredTileStillPresent(simulator.project, state, required)
    ) {
      score += 8000000;
    }
  }
  for (const preserved of goal.presentTiles || []) {
    const preservedKey = `${preserved.floorId}:${preserved.x},${preserved.y}`;
    if (
      actionTileKey === preservedKey &&
      isRequiredTileStillPresent(simulator.project, state, preserved)
    ) {
      score -= 10000000;
    }
  }
  for (const preferred of goal.preferredPresentTiles || []) {
    const preferredKey = `${preferred.floorId}:${preferred.x},${preferred.y}`;
    if (
      actionTileKey === preferredKey &&
      isRequiredTileStillPresent(simulator.project, state, preferred)
    ) {
      score -= 1000000;
    }
  }
  if (action && action.kind === "equip") {
    for (const itemId of goal.equipmentIncludes || []) {
      if (
        String(action.summary || "") === `equip:${itemId}` &&
        !hasEquipment(state, itemId)
      )
        score += 12000000;
    }
  }
  if (
    action &&
    action.kind === "changeFloor" &&
    goal.floorId
  ) {
    const resolvedTarget = resolveActionTargetFloorId(
      simulator && simulator.project,
      action,
      state,
    );
    if (resolvedTarget === goal.floorId) {
      score += 500000;
    }
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
    const equipmentGain = afterHero.equipment.filter(
      (itemId) => !beforeHero.equipment.includes(itemId),
    ).length;
    return Math.max(
      0,
      afterHero.hp -
        beforeHero.hp +
        (afterEffective.atk - beforeEffective.atk) * 50000 +
        (afterEffective.def - beforeEffective.def) * 40000 +
        (afterEffective.mdef - beforeEffective.mdef) * 5000 +
        (afterHero.exp - beforeHero.exp) * 1500 +
        equipmentGain * 300000,
    );
  } catch (error) {
    return 0;
  }
}

function actionSurvivablePrepScore(simulator, state, action, segment) {
  const goal = (segment || {}).goal || {};
  if (!goal.actionSurvivable || !goal.actionSurvivable.summary || !action)
    return 0;
  if (action.kind === "changeFloor" || action.kind === "floorFly") return 0;
  try {
    const preview = simulator.applyAction(state, action, { storeRoute: false });
    const beforeHero = summarizeHero(state);
    const afterHero = summarizeHero(preview);
    const beforeEffective = summarizeEffectiveHero(state);
    const afterEffective = summarizeEffectiveHero(preview);
    const hpGain = afterHero.hp - beforeHero.hp;
    const atkGain = afterEffective.atk - beforeEffective.atk;
    const defGain = afterEffective.def - beforeEffective.def;
    const mdefGain = afterEffective.mdef - beforeEffective.mdef;
    const expGain = afterHero.exp - beforeHero.exp;
    const equipmentGain = afterHero.equipment.filter(
      (itemId) => !beforeHero.equipment.includes(itemId),
    ).length;
    const positivePrep =
      hpGain > 0 ||
      atkGain > 0 ||
      defGain > 0 ||
      mdefGain > 0 ||
      expGain > 0 ||
      equipmentGain > 0;
    if (!positivePrep) return 0;
    const damage = number((action.estimate || {}).damage, 0);
    return Math.max(
      0,
      hpGain * 8 +
        atkGain * 30000 +
        defGain * 140000 +
        mdefGain * 5000 +
        expGain * 2500 +
        equipmentGain * 500000 -
        Math.max(0, damage) * 0.2,
    );
  } catch (error) {
    return 0;
  }
}

function resourceTimingLookaheadScore(simulator, state, action, segment) {
  const dpConfig = (segment || {}).dp || {};
  if (dpConfig.resourceLookahead !== true) return 0;
  if (
    !action ||
    action.kind === "changeFloor" ||
    action.kind === "floorFly" ||
    action.kind === "equip"
  )
    return 0;
  let preview = null;
  try {
    preview = simulator.applyAction(state, action, { storeRoute: false });
  } catch (error) {
    return 0;
  }
  const beforeHero = summarizeHero(state);
  const beforeEffective = summarizeEffectiveHero(state);
  let nextActions = [];
  try {
    nextActions = simulator.enumeratePrimitiveActions(preview).actions || [];
  } catch (error) {
    nextActions = [];
  }
  if (typeof simulator.enumerateInteractPickupActions === "function") {
    try {
      nextActions = nextActions.concat(
        simulator.enumerateInteractPickupActions(preview) || [],
      );
    } catch (error) {}
  }
  const candidates = nextActions
    .filter((nextAction) => nextAction && nextAction.summary !== action.summary)
    .filter(
      (nextAction) =>
        nextAction.kind !== "changeFloor" && nextAction.kind !== "floorFly",
    )
    .filter((nextAction) =>
      isAllowedAction(nextAction, preview, segment, simulator),
    )
    .map((nextAction) => ({
      action: nextAction,
      prepScore: actionSurvivablePrepScore(
        simulator,
        preview,
        nextAction,
        segment,
      ),
      previewScore: segmentPreviewScore(simulator, preview, nextAction),
      damage: number((nextAction.estimate || {}).damage, 0),
    }))
    .filter((record) => record.prepScore > 0 || record.previewScore > 0)
    .sort(
      (left, right) =>
        right.prepScore +
          right.previewScore -
          (left.prepScore + left.previewScore) || left.damage - right.damage,
    )
    .slice(0, number(dpConfig.resourceLookaheadActions, 8));
  let best = 0;
  for (const record of candidates) {
    let second = null;
    try {
      second = simulator.applyAction(preview, record.action, {
        storeRoute: false,
      });
    } catch (error) {
      continue;
    }
    const afterHero = summarizeHero(second);
    const afterEffective = summarizeEffectiveHero(second);
    const hpDelta = number(afterHero.hp, 0) - number(beforeHero.hp, 0);
    const atkDelta =
      number(afterEffective.atk, 0) - number(beforeEffective.atk, 0);
    const defDelta =
      number(afterEffective.def, 0) - number(beforeEffective.def, 0);
    const mdefDelta =
      number(afterEffective.mdef, 0) - number(beforeEffective.mdef, 0);
    const expDelta = number(afterHero.exp, 0) - number(beforeHero.exp, 0);
    const score =
      hpDelta * 120 +
      number(afterHero.hp, 0) * 3000 +
      atkDelta * 30000 +
      defDelta * 120000 +
      mdefDelta * 5000 +
      expDelta * 2500 +
      (record.prepScore + record.previewScore) * 0.25;
    if (score > best) best = score;
  }
  return Math.max(0, best);
}

function usesResourceTimingMode(segment) {
  const dpConfig = (segment || {}).dp || {};
  const policy = (segment || {}).actionPolicy || {};
  return (
    dpConfig.resourceTimingMode === "sustain-prep" ||
    policy.resourceTimingMode === "sustain-prep"
  );
}

function isResourceTimingAction(simulator, state, action, segment) {
  if (!usesResourceTimingMode(segment)) return true;
  if (!action) return false;
  if (action.kind === "changeFloor" || action.kind === "floorFly") return true;
  if (goalActionScore(simulator, state, action, segment) > 0) return true;
  return actionSurvivablePrepScore(simulator, state, action, segment) > 0;
}

function annotateSegmentAction(simulator, state, action, segment) {
  const goalScore = goalActionScore(simulator, state, action, segment);
  const dpConfig = (segment || {}).dp || {};
  const prepScore = actionSurvivablePrepScore(
    simulator,
    state,
    action,
    segment,
  );
  const lookaheadScore = resourceTimingLookaheadScore(
    simulator,
    state,
    action,
    segment,
  );
  const previewScore =
    dpConfig.enablePreviewScore === false
      ? 0
      : dpConfig.enablePreviewScore === "required"
        ? goalScore > 0 || prepScore > 0 || lookaheadScore > 0
          ? segmentPreviewScore(simulator, state, action) +
            prepScore +
            lookaheadScore
          : 0
        : segmentPreviewScore(simulator, state, action);
  const score =
    goalScore +
    previewScore +
    (dpConfig.enablePreviewScore === "required"
      ? 0
      : prepScore + lookaheadScore);
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

function isAllowedChangeFloor(action, state, policy, simulator) {
  const allowed = new Set((policy.allowChangeFloors || []).map(String));
  const changeKey = parseChangeFloorSummary(action.summary);
  if (changeKey && allowed.has(changeKey)) return true;
  const floorId = action.floorId || (state && state.floorId);
  if (policy.allowedFloors && !policy.allowedFloors.includes(floorId))
    return false;
  const targetFloor = resolveActionTargetFloorId(
    simulator && simulator.project,
    action,
    state,
  );
  return (
    !targetFloor ||
    !policy.allowedFloors ||
    policy.allowedFloors.includes(targetFloor)
  );
}

function isAllowedAction(action, state, segment, simulator) {
  const policy = (segment || {}).actionPolicy || {};
  const goal = (segment || {}).goal || {};
  const allowedKinds = new Set(
    policy.actionKinds || [
      "battle",
      "pickup",
      "equip",
      "openDoor",
      "useTool",
      "changeFloor",
      "event",
    ],
  );
  if (!action || !allowedKinds.has(action.kind)) return false;
  if (
    action.kind === "resourcePocket" ||
    action.kind === "resourceCluster" ||
    action.kind === "resourceChain" ||
    action.kind === "fightToLevelUp"
  )
    return false;
  if (
    action.kind === "event" &&
    policy.forbidUnsupportedEvents !== false &&
    (action.unsupported || action.hasStateChange === false)
  )
    return false;
  if (actionTargetsProtectedTile(action, segment)) return false;
  const actionTileKey = parseActionTileKey(action.summary);
  for (const preserved of goal.presentTiles || []) {
    const preservedKey = `${preserved.floorId}:${preserved.x},${preserved.y}`;
    if (
      actionTileKey === preservedKey &&
      isRequiredTileStillPresent(simulator.project, state, preserved)
    )
      return false;
  }
  if (action.kind === "changeFloor")
    return isAllowedChangeFloor(action, state, policy, simulator);
  if (action.kind === "floorFly") {
    const targetFloor =
      action.targetFloorId || (action.target && action.target.floorId);
    return (
      !policy.allowedFloors ||
      (policy.allowedFloors.includes(action.floorId || state.floorId) &&
        policy.allowedFloors.includes(targetFloor))
    );
  }
  const floorId = action.floorId || state.floorId;
  return !policy.allowedFloors || policy.allowedFloors.includes(floorId);
}

function trimFloorFlyActions(actions, policy) {
  const maxPerTarget = Math.max(1, number(policy.maxFloorFlyPerTarget, 1));
  const floorFlyGroups = new Map();
  const kept = [];
  for (const action of actions || []) {
    if (!action || action.kind !== "floorFly") {
      kept.push(action);
      continue;
    }
    const targetFloor =
      action.targetFloorId || (action.target && action.target.floorId) || "?";
    if (!floorFlyGroups.has(targetFloor)) floorFlyGroups.set(targetFloor, []);
    floorFlyGroups.get(targetFloor).push(action);
  }
  floorFlyGroups.forEach((group) => {
    group
      .slice()
      .sort(
        (left, right) => (left.path || []).length - (right.path || []).length,
      )
      .slice(0, maxPerTarget)
      .forEach((action) => kept.push(action));
  });
  return kept;
}

function actionTravelHp(action) {
  return number((((action || {}).travelState || {}).hero || {}).hp, 0);
}

function compareSegmentActionRepresentatives(left, right) {
  const leftScore = number(
    ((left || {}).estimate || {}).segmentPreviewScore,
    0,
  );
  const rightScore = number(
    ((right || {}).estimate || {}).segmentPreviewScore,
    0,
  );
  if (leftScore !== rightScore) return rightScore - leftScore;
  const leftDamage = number(((left || {}).estimate || {}).damage, 0);
  const rightDamage = number(((right || {}).estimate || {}).damage, 0);
  if (leftDamage !== rightDamage) return leftDamage - rightDamage;
  const hpDiff = actionTravelHp(right) - actionTravelHp(left);
  if (hpDiff !== 0) return hpDiff;
  return ((left || {}).path || []).length - ((right || {}).path || []).length;
}

function deduplicateSegmentActions(actions) {
  const bySummary = new Map();
  const passthrough = [];
  for (const action of actions || []) {
    const summary = action && action.summary;
    if (!summary) {
      passthrough.push(action);
      continue;
    }
    const existing = bySummary.get(summary);
    if (
      !existing ||
      compareSegmentActionRepresentatives(action, existing) < 0
    ) {
      bySummary.set(summary, action);
    }
  }
  return passthrough.concat(Array.from(bySummary.values()));
}

function buildSegmentActionProvider(simulator, segment) {
  return (unusedSimulator, state) => {
    const policy = (segment || {}).actionPolicy || {};
    const allowedKinds = new Set(
      policy.actionKinds || [
        "battle",
        "pickup",
        "equip",
        "openDoor",
        "useTool",
        "changeFloor",
        "event",
      ],
    );
    const primitive = simulator.enumeratePrimitiveActions(state).actions || [];
    let actions = primitive;
    if (
      allowedKinds.has("interactPickup") &&
      typeof simulator.enumerateInteractPickupActions === "function"
    ) {
      actions = actions.concat(simulator.enumerateInteractPickupActions(state));
    }
    if (
      allowedKinds.has("floorFly") &&
      typeof simulator.enumerateFloorFlyActions === "function"
    ) {
      actions = actions.concat(simulator.enumerateFloorFlyActions(state));
    }
    const filtered = trimFloorFlyActions(actions, policy)
      .filter((action) => isAllowedAction(action, state, segment, simulator))
      .filter((action) =>
        isResourceTimingAction(simulator, state, action, segment),
      )
      .map((action) =>
        annotateSegmentAction(simulator, state, action, segment),
      );
    return deduplicateSegmentActions(filtered);
  };
}

function closeStateForBattleFrontier(simulator, state, segment) {
  const closed = cloneState(state);
  if (typeof simulator.stabilizeState !== "function") return closed;
  const saved = protectPresentTiles(simulator.project, closed, segment);
  try {
    return simulator.stabilizeState(closed);
  } finally {
    restorePresentTiles(saved);
  }
}

function deduplicatePortalActions(actions) {
  const battles = [];
  const portalsByTarget = new Map();
  const others = [];
  for (const action of actions || []) {
    if (!action) continue;
    if (action.kind === "battle") {
      battles.push(action);
    } else if (action.kind === "changeFloor" || action.kind === "floorFly") {
      const targetFloor =
        action.kind === "floorFly"
          ? action.targetFloorId ||
            (action.target && action.target.floorId) ||
            "?"
          : (action.changeFloor && action.changeFloor.floorId) || "?";
      const existing = portalsByTarget.get(targetFloor);
      if (
        !existing ||
        (action.path || []).length < (existing.path || []).length
      ) {
        portalsByTarget.set(targetFloor, action);
      }
    } else {
      others.push(action);
    }
  }
  return [...battles, ...portalsByTarget.values(), ...others];
}

const BLOCKER_TILE_NUMBER = 1;

function isTileBlocking(project, tileNumber) {
  const def = project.mapTilesByNumber[String(tileNumber)];
  if (!def) return false;
  if (def.cls && def.cls.indexOf("enemy") === 0) return false;
  if (def.trigger === "openDoor") return false;
  if (def.cls === "items") return false;
  return def.canPass !== true;
}

function protectPresentTiles(project, state, segment) {
  const saved = [];
  for (const required of segmentProtectedTiles(segment)) {
    const floorState = (state.floorStates || {})[required.floorId];
    if (!floorState) continue;
    const key = `${required.x},${required.y}`;
    if (floorState.removed[key]) continue;
    const tileNum = Object.prototype.hasOwnProperty.call(
      floorState.replaced,
      key,
    )
      ? floorState.replaced[key]
      : null;
    const tile =
      tileNum != null
        ? project.mapTilesByNumber[String(tileNum)]
        : getTileDefinitionAt(
            project,
            state,
            required.floorId,
            required.x,
            required.y,
          );
    if (!tile) continue;
    if (!isTileBlocking(project, BLOCKER_TILE_NUMBER)) {
      throw new Error(
        `protectPresentTiles: tile ${BLOCKER_TILE_NUMBER} is not a blocking tile`,
      );
    }
    const wasRemoved = floorState.removed[key];
    const wasReplaced = floorState.replaced[key];
    saved.push({
      floorId: required.floorId,
      key,
      wasRemoved,
      wasReplaced,
      floorState,
    });
    delete floorState.removed[key];
    floorState.replaced[key] = BLOCKER_TILE_NUMBER;
  }
  return saved;
}

function restorePresentTiles(saved) {
  for (const entry of saved) {
    if (entry.wasRemoved) {
      entry.floorState.removed[entry.key] = true;
    } else {
      delete entry.floorState.removed[entry.key];
    }
    if (entry.wasReplaced !== undefined) {
      entry.floorState.replaced[entry.key] = entry.wasReplaced;
    } else {
      delete entry.floorState.replaced[entry.key];
    }
  }
}

function enumerateMonsterTargets(simulator, state, segment) {
  const policy = (segment || {}).actionPolicy || {};
  const goal = (segment || {}).goal || {};
  const allowedFloors = policy.allowedFloors || [];
  const project = simulator.project;
  const targets = [];

  for (const floorId of allowedFloors) {
    const floor = project.floorsById[floorId];
    if (!floor) continue;
    const height =
      floor.height || (Array.isArray(floor.map) ? floor.map.length : 0);
    const width = floor.width || 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const tile = getTileDefinitionAt(project, state, floorId, x, y);
        if (!tile || !tile.cls || tile.cls.indexOf("enemy") !== 0) continue;
        const enemyId = tile.id;
        if (!enemyId) continue;

        const preservedKey = `${floorId}:${x},${y}`;
        const isProtected = segmentProtectedTiles(segment).some(
          (p) => `${p.floorId}:${p.x},${p.y}` === preservedKey,
        );
        if (isProtected) continue;

        const target = {
          kind: "battle",
          summary: `battle:${enemyId}@${floorId}:${x},${y}`,
          floorId,
          x,
          y,
          enemyId,
          monsterTarget: true,
        };
        targets.push(target);
      }
    }
  }

  return targets;
}

function isAllowedPortalAction(action, state, policy) {
  if (action.kind === "changeFloor")
    return isAllowedChangeFloor(action, state, policy);
  if (action.kind === "floorFly") {
    const targetFloor =
      action.targetFloorId || (action.target && action.target.floorId);
    if (policy.allowedFloors && !policy.allowedFloors.includes(targetFloor))
      return false;
    return true;
  }
  return true;
}

function oracleFindFloorState(
  simulator,
  state,
  targetFloorId,
  segment,
  config,
) {
  const states = oracleFindFloorStates(
    simulator,
    state,
    targetFloorId,
    segment,
    config,
  );
  return states[0] || null;
}

function floorResultIdentity(result) {
  const state = result && result.state ? result.state : {};
  const hero = state.hero || {};
  return JSON.stringify({
    floorId: state.floorId,
    loc: hero.loc || null,
    hp: number(hero.hp, 0),
    atk: number(hero.atk, 0),
    def: number(hero.def, 0),
    mdef: number(hero.mdef, 0),
    lv: number(hero.lv, 0),
    exp: number(hero.exp, 0),
    equipment: Array.isArray(hero.equipment)
      ? hero.equipment.slice().sort()
      : [],
  });
}

function selectOracleFloorResults(results, maxEntries) {
  const candidates = results.map((result) => {
    const hero = summarizeHero(result.state);
    const effective = summarizeEffectiveHero(result.state);
    const travelLength = Array.isArray(result.travelActions)
      ? result.travelActions.length
      : 0;
    return {
      ...result,
      _roleScores: {
        highestHp: hero.hp,
        shortestTravel: -travelLength,
        bestCombatStats:
          effective.atk * 100000 +
          effective.def * 80000 +
          effective.mdef * 8000 +
          hero.exp * 1000 +
          hero.hp,
        highestEffectiveDef: effective.def,
      },
    };
  });
  const selected = [];
  const seen = new Set();
  const add = (candidate) => {
    if (!candidate || selected.length >= maxEntries) return false;
    const key = floorResultIdentity(candidate);
    if (seen.has(key)) return false;
    seen.add(key);
    selected.push(candidate);
    return true;
  };
  for (const role of [
    "highestHp",
    "shortestTravel",
    "bestCombatStats",
    "highestEffectiveDef",
  ]) {
    candidates
      .slice()
      .sort((left, right) => {
        const diff = right._roleScores[role] - left._roleScores[role];
        if (diff !== 0) return diff;
        return (
          (left.travelActions || []).length - (right.travelActions || []).length
        );
      })
      .some(add);
  }
  candidates
    .slice()
    .sort((left, right) => {
      const leftHero = summarizeHero(left.state);
      const rightHero = summarizeHero(right.state);
      return rightHero.hp - leftHero.hp;
    })
    .forEach(add);
  return selected;
}

function oracleFindFloorStates(
  simulator,
  state,
  targetFloorId,
  segment,
  config,
) {
  const maxSteps = number((config || {}).maxPortalDepth, 10) * 50;
  const maxEntries = number((config || {}).maxOracleFloorEntries, 4);
  const policy = (segment || {}).actionPolicy || {};
  const goal = (segment || {}).goal || {};

  // BFS including walking, portals, and floorFly to navigate to target floor
  const queue = [{ state: cloneState(state), steps: 0, actions: [] }];
  const visited = new Set();
  const results = [];
  const posKey = (s) =>
    `${s.floorId}:${(s.hero.loc || {}).x},${(s.hero.loc || {}).y}`;
  visited.add(posKey(state));

  while (queue.length > 0) {
    const { state: current, steps, actions } = queue.shift();

    if (current.floorId === targetFloorId) {
      const closed = closeStateForBattleFrontier(simulator, current, segment);
      results.push({ state: closed, travelActions: actions });
      continue;
    }

    if (steps >= maxSteps) continue;

    // Collect portal actions: primitive changeFloor + floorFly
    let portalActions = [];
    const primitive =
      simulator.enumeratePrimitiveActions(current).actions || [];
    portalActions = portalActions.concat(
      primitive.filter((a) => a.kind === "changeFloor"),
    );
    if (typeof simulator.enumerateFloorFlyActions === "function") {
      portalActions = portalActions.concat(
        simulator.enumerateFloorFlyActions(current),
      );
    }

    for (const action of portalActions) {
      if (!isAllowedPortalAction(action, current, policy)) continue;
      // Check presentTiles: don't traverse through protected tiles
      const actionTileKey = parseActionTileKey(action.summary);
      const hitsProtected = segmentProtectedTiles(segment).some(
        (p) => `${p.floorId}:${p.x},${p.y}` === actionTileKey,
      );
      if (hitsProtected) continue;

      try {
        const next = simulator.applyAction(current, action, {
          storeRoute: false,
        });
        const key = posKey(next);
        if (visited.has(key)) continue;
        visited.add(key);
        queue.push({
          state: next,
          steps: steps + 1,
          actions: actions.concat(action),
        });
      } catch (error) {
        /* skip */
      }
    }
  }

  return selectOracleFloorResults(results, maxEntries);
}

function battleMarginForGoal(simulator, state, segment) {
  const goal = (segment || {}).goal || {};
  const targetSummary = goal.actionSurvivable && goal.actionSurvivable.summary;
  if (!targetSummary) return Number.NEGATIVE_INFINITY;
  try {
    const threshold = estimateBattleSurvivability(
      simulator,
      state,
      targetSummary,
      { skipMinHp: true },
    );
    if (!threshold || !threshold.supported) return Number.NEGATIVE_INFINITY;
    return (
      number(((state || {}).hero || {}).hp, 0) -
      number(threshold.currentDamage, Number.POSITIVE_INFINITY)
    );
  } catch (error) {
    return Number.NEGATIVE_INFINITY;
  }
}

function successorIdentity(candidate) {
  const state = candidate && candidate.postState ? candidate.postState : {};
  const hero = state.hero || {};
  return JSON.stringify({
    floorId: state.floorId,
    loc: hero.loc || null,
    hp: number(hero.hp, 0),
    atk: number(hero.atk, 0),
    def: number(hero.def, 0),
    mdef: number(hero.mdef, 0),
    lv: number(hero.lv, 0),
    exp: number(hero.exp, 0),
    equipment: Array.isArray(hero.equipment)
      ? hero.equipment.slice().sort()
      : [],
  });
}

function selectMonsterOnlySuccessors(
  simulator,
  results,
  segment,
  maxSuccessors,
  stats,
) {
  const candidates = results.map((candidate) => {
    const state = candidate.postState;
    const hero = summarizeHero(state);
    const effective = summarizeEffectiveHero(state);
    const routePatchLength = Array.isArray(candidate.routePatch)
      ? candidate.routePatch.length
      : 0;
    return {
      ...candidate,
      _roleScores: {
        highestPostHp: hero.hp,
        bestTargetMargin: battleMarginForGoal(simulator, state, segment),
        highestEffectiveDef: effective.def,
        highestEffectiveMdef: effective.mdef,
        highestCombatStats:
          effective.atk * 100000 +
          effective.def * 80000 +
          effective.mdef * 8000 +
          hero.exp * 1000 +
          hero.hp,
        shortestRoute: -routePatchLength,
      },
    };
  });
  const roles = [
    "highestPostHp",
    "bestTargetMargin",
    "highestEffectiveDef",
    "highestEffectiveMdef",
    "highestCombatStats",
    "shortestRoute",
  ];
  const selected = [];
  const seen = new Set();
  const add = (candidate, role) => {
    if (!candidate || selected.length >= maxSuccessors) return;
    const key = successorIdentity(candidate);
    if (seen.has(key)) return;
    seen.add(key);
    candidate._selectedRole = role;
    selected.push(candidate);
  };
  for (const role of roles) {
    candidates
      .slice()
      .sort((left, right) => {
        const diff = right._roleScores[role] - left._roleScores[role];
        if (diff !== 0) return diff;
        return right.preHp - left.preHp;
      })
      .some((candidate) => {
        const before = selected.length;
        add(candidate, role);
        return selected.length > before;
      });
  }
  candidates
    .slice()
    .sort((left, right) => right.preHp - left.preHp)
    .forEach((candidate) => add(candidate, "highestPreHpFallback"));
  const capped = selected.slice(0, maxSuccessors);
  if (stats) {
    if (!stats.successorSelectedByRole) stats.successorSelectedByRole = {};
    capped.forEach((candidate) => {
      const role = candidate._selectedRole || "unknown";
      stats.successorSelectedByRole[role] =
        Number(stats.successorSelectedByRole[role] || 0) + 1;
    });
  }
  return capped;
}

function tryReachAndBattle(
  simulator,
  state,
  target,
  segment,
  config,
  oracleCache,
  stats,
) {
  // First navigate to the target floor (with optional memoization)
  let floorResults;
  if (oracleCache && oracleCache.has(target.floorId)) {
    floorResults = oracleCache.get(target.floorId);
  } else {
    const floorStartedAt = Date.now();
    floorResults = oracleFindFloorStates(
      simulator,
      state,
      target.floorId,
      segment,
      config,
    );
    if (stats)
      stats.oracleFloorSearchMs =
        Number(stats.oracleFloorSearchMs || 0) + (Date.now() - floorStartedAt);
    if (oracleCache) oracleCache.set(target.floorId, floorResults);
  }
  if (!Array.isArray(floorResults) || floorResults.length === 0)
    return { ok: false, reason: "unreachable-floor" };
  if (stats) {
    stats.floorEntriesReturned =
      Number(stats.floorEntriesReturned || 0) + floorResults.length;
    stats.maxFloorEntriesReturned = Math.max(
      Number(stats.maxFloorEntriesReturned || 0),
      floorResults.length,
    );
  }
  const maxSuccessors = number((config || {}).maxSuccessorsPerTarget, 4);

  // Collect all valid postStates from different positions
  const results = [];
  for (const floorResult of floorResults) {
    const closed = floorResult.state;
    const travelActions = floorResult.travelActions;

    // Use walk reachability to find the battle action from any reachable position
    const reachabilityStartedAt = Date.now();
    const reachability = simulator.getWalkReachability(closed);
    if (stats)
      stats.oracleBattleReachabilityMs =
        Number(stats.oracleBattleReachabilityMs || 0) +
        (Date.now() - reachabilityStartedAt);
    const visited = reachability.visited || {};
    if (stats) {
      const visitedCount = Object.keys(visited).length;
      stats.reachabilityNodes =
        Number(stats.reachabilityNodes || 0) + visitedCount;
      stats.maxReachabilityNodes = Math.max(
        Number(stats.maxReachabilityNodes || 0),
        visitedCount,
      );
    }

    for (const node of Object.values(visited)) {
      const nodeState = node.state;
      const primitive =
        simulator.enumeratePrimitiveActions(nodeState).actions || [];
      const battleAction = primitive.find(
        (action) =>
          action.kind === "battle" && action.summary === target.summary,
      );
      if (!battleAction) continue;

      try {
        const postState = simulator.applyAction(nodeState, battleAction, {
          storeRoute: false,
        });
        // Build routePatch: travel actions + battle action (no walk pseudo action)
        const routePatch = travelActions.concat(battleAction);
        results.push({
          postState,
          battleAction,
          routePatch,
          preHp: nodeState.hero ? nodeState.hero.hp : 0,
        });
      } catch (error) {
        continue;
      }
    }
  }

  if (results.length === 0)
    return { ok: false, reason: "battle-not-reachable" };
  if (stats) {
    stats.successorCandidatesBeforeCap =
      Number(stats.successorCandidatesBeforeCap || 0) + results.length;
  }
  const cappedResults = selectMonsterOnlySuccessors(
    simulator,
    results,
    segment,
    maxSuccessors,
    stats,
  );
  if (stats) {
    stats.successorCandidatesAfterCap =
      Number(stats.successorCandidatesAfterCap || 0) + cappedResults.length;
    stats.successorCapDrops =
      Number(stats.successorCapDrops || 0) +
      Math.max(0, results.length - cappedResults.length);
  }
  return { ok: true, results: cappedResults };
}

function scoreMonsterTarget(simulator, target, state, segment) {
  const threshold = (() => {
    try {
      return estimateBattleSurvivability(simulator, state, target, {
        skipMinHp: true,
      });
    } catch (error) {
      return null;
    }
  })();
  // Prefer current floor targets (reachable without portal)
  const currentFloor = state.floorId === target.floorId ? 10000 : 0;
  const reachableNow = target.reachableNow ? 1000000 : 0;
  const damage =
    threshold && threshold.supported ? number(threshold.currentDamage, 0) : 0;
  const hp = number(((state || {}).hero || {}).hp, 0);
  const survivable =
    threshold && threshold.supported && hp > damage ? 50000 : 0;
  const lowDamage =
    threshold && threshold.supported ? Math.max(0, hp - damage) : 0;
  const goal = (segment || {}).goal || {};
  const goalTarget = parseTileKeyParts(
    parseActionTileKey(goal.actionSurvivable && goal.actionSurvivable.summary),
  );
  const distanceToGoalTarget =
    goalTarget && target.floorId === goalTarget.floorId
      ? 1000 -
        Math.abs(target.x - goalTarget.x) -
        Math.abs(target.y - goalTarget.y)
      : 0;
  // Prefer enemies on higher floors (closer to goal)
  const floorScore = getFloorOrder(target.floorId) * 10;
  return (
    reachableNow +
    survivable +
    currentFloor +
    lowDamage +
    distanceToGoalTarget +
    floorScore
  );
}

function buildMonsterOnlyActionProvider(simulator, segment, config, stats) {
  const policy = (segment || {}).actionPolicy || {};
  const goal = (segment || {}).goal || {};
  const maxTargets = number((config || {}).maxMonsterTargets, 64);

  return (unusedSimulator, state) => {
    const project = simulator.project;
    const allowedFloors =
      policy.allowedFloors || Object.keys(project.floorsById || {});
    const reachableBattleSummaries = new Set();
    try {
      (simulator.enumeratePrimitiveActions(state).actions || [])
        .filter((action) => action.kind === "battle" && action.summary)
        .forEach((action) => reachableBattleSummaries.add(action.summary));
    } catch (error) {
      /* ignore */
    }
    const targets = [];
    for (const floorId of allowedFloors) {
      const floor = project.floorsById[floorId];
      if (!floor) continue;
      const height =
        floor.height || (Array.isArray(floor.map) ? floor.map.length : 0);
      const width = floor.width || 0;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const tile = getTileDefinitionAt(project, state, floorId, x, y);
          if (!tile || !tile.cls || tile.cls.indexOf("enemy") !== 0) continue;
          const enemyId = tile.id;
          if (!enemyId) continue;
          const preservedKey = `${floorId}:${x},${y}`;
          const isProtected = segmentProtectedTiles(segment).some(
            (p) => `${p.floorId}:${p.x},${p.y}` === preservedKey,
          );
          if (isProtected) continue;
          const summary = `battle:${enemyId}@${floorId}:${x},${y}`;
          targets.push({
            kind: "battle",
            summary,
            floorId,
            x,
            y,
            enemyId,
            reachableNow: reachableBattleSummaries.has(summary),
            monsterTarget: true,
          });
        }
      }
    }
    targets.sort(
      (a, b) =>
        scoreMonsterTarget(simulator, b, state, segment) -
        scoreMonsterTarget(simulator, a, state, segment),
    );
    const cappedTargets = targets.slice(0, maxTargets);
    if (stats) {
      stats.targetsGenerated =
        Number(stats.targetsGenerated || 0) + targets.length;
      stats.targetsAfterCap =
        Number(stats.targetsAfterCap || 0) + cappedTargets.length;
      stats.reachableTargetsGenerated =
        Number(stats.reachableTargetsGenerated || 0) +
        targets.filter((target) => target.reachableNow).length;
      stats.reachableTargetsAfterCap =
        Number(stats.reachableTargetsAfterCap || 0) +
        cappedTargets.filter((target) => target.reachableNow).length;
      stats.targetCapDrops =
        Number(stats.targetCapDrops || 0) +
        Math.max(0, targets.length - cappedTargets.length);
      stats.maxTargetsGeneratedForState = Math.max(
        Number(stats.maxTargetsGeneratedForState || 0),
        targets.length,
      );
      stats.maxTargetsAfterCapForState = Math.max(
        Number(stats.maxTargetsAfterCapForState || 0),
        cappedTargets.length,
      );
      if (targets.length > maxTargets) stats.statesWithTargetCap += 1;
    }
    return cappedTargets;
  };
}

function routeLength(state) {
  return getRawRouteLength(state);
}

function goalCandidateScore(state) {
  const hero = summarizeHero(state);
  const effective = summarizeEffectiveHero(state);
  return (
    hero.hp +
    effective.atk * 100000 +
    effective.def * 80000 +
    effective.mdef * 8000 +
    hero.exp * 1000 -
    routeLength(state) * 10
  );
}

function candidateOutcomeScore(candidate) {
  const state = candidate && candidate.state ? candidate.state : candidate;
  const hero = summarizeHero(state);
  const effective = summarizeEffectiveHero(state);
  return (
    hero.hp * 1000000 +
    hero.lv * 100000000000 +
    hero.exp * 10000000 +
    effective.atk * 10000 +
    effective.def * 8000 +
    effective.mdef * 1000 -
    routeLength(state)
  );
}

function compareCandidateStates(left, right) {
  return compareLegacyStates(left, right);
}

function addTag(record, tag) {
  if (!record.tags.includes(tag)) record.tags.push(tag);
}

// Iteration 5 – generic resource signature for milestone frontier diversity.
// The algorithm only understands "this candidate differs from others on some
// maintainable resource dimension"; it has NO knowledge of specific item ids,
// monsters or equipment. Dimensions:
//   hero numeric fields (hp/atk/def/mdef/lv/exp/money – generic, from summarizeHero)
//   inventory entries with count > 0 (itemId -> count, sorted)
//   equipment membership (sorted set)
function buildCandidateResourceSignature(state) {
  const hero = summarizeHero(state);
  const inventory = {};
  const inventorySource = (state || {}).inventory || {};
  Object.keys(inventorySource)
    .sort()
    .forEach((itemId) => {
      const count = Number(inventorySource[itemId] || 0);
      if (count > 0) inventory[itemId] = count;
    });
  return {
    hero: {
      hp: hero.hp,
      atk: hero.atk,
      def: hero.def,
      mdef: hero.mdef,
      lv: hero.lv,
      exp: hero.exp,
      money: hero.money,
    },
    inventory,
    equipment: Array.isArray(hero.equipment)
      ? hero.equipment.slice().sort()
      : [],
  };
}

// Resource-vector projection for Pareto/novelty computations. Higher is better
// for every dimension (inventory counts, equipment membership as 0/1, hero
// numeric fields). Returns a plain map dimensionKey -> numeric value, where
// inventory dimensions are `inv:<itemId>` and equipment dimensions `eq:<itemId>`.
function resourceProjection(signature) {
  const projection = {};
  const hero = (signature || {}).hero || {};
  ["hp", "atk", "def", "mdef", "lv", "exp", "money"].forEach((field) => {
    projection[`hero:${field}`] = Number(hero[field] || 0);
  });
  const inventory = (signature || {}).inventory || {};
  Object.keys(inventory)
    .sort()
    .forEach((itemId) => {
      projection[`inv:${itemId}`] = Number(inventory[itemId] || 0);
    });
  ((signature || {}).equipment || []).forEach((itemId) => {
    projection[`eq:${itemId}`] = 1;
  });
  return projection;
}

// Dominates = >= on EVERY dimension present in either projection and > on at
// least one. Dimensions absent from one side count as 0.
function resourceDominates(left, right, dimensions) {
  let strictlyGreater = false;
  for (const dim of dimensions) {
    const leftValue = Number(left[dim] || 0);
    const rightValue = Number(right[dim] || 0);
    if (leftValue < rightValue) return false;
    if (leftValue > rightValue) strictlyGreater = true;
  }
  return strictlyGreater;
}

// Greedy resource novelty: how many dimensions the candidate improves (or
// introduces) relative to the current selected set's best values.
function resourceNovelty(projection, selectedBest, dimensions) {
  let novelty = 0;
  for (const dim of dimensions) {
    const value = Number(projection[dim] || 0);
    const best = selectedBest[dim] != null ? Number(selectedBest[dim]) : null;
    if (value > 0 && (best == null || value > best)) novelty += 1;
  }
  return novelty;
}

function buildTraceSnapshot(project, state) {
  if (!state) return null;
  const snapshot = buildSolverSnapshot(project, state, {
    floorIds: [state.floorId].filter(Boolean),
  });
  snapshot.partial = true;
  return snapshot;
}

function compactTraceEntry(project, entry) {
  if (!entry || !entry.actionEntry) return null;
  const preSnapshot =
    entry.preSnapshot || buildTraceSnapshot(project, entry.preState);
  const postSnapshot =
    entry.postSnapshot || buildTraceSnapshot(project, entry.postState);
  return {
    actionEntry: entry.actionEntry,
    preSnapshot,
    postSnapshot,
    preStateKey: entry.preStateKey || null,
    postStateKey: entry.postStateKey || null,
  };
}

function selectGoalSkyline(simulator, states, segment, options) {
  const config = options || {};
  const objective = config.objectiveSpec && config.objectiveSpec.explicit
    ? config.objectiveSpec
    : null;
  const objectiveOrdersCandidates = Boolean(
    objective && (
      objective.requiresOptimizationProof ||
      ((objective.spec || {}).tieBreakers || []).length > 0
    ),
  );
  const limit = Math.max(
    1,
    number(
      config.candidateLimit || (segment.dp || {}).goalSkylineLimit,
      8,
    ),
  );
  const keyMode = (segment.dp || {}).keyMode || "region";
  const byKey = new Map();
  (states || []).filter(Boolean).forEach((state) => {
    const stateKey = buildDpStateKey(simulator, state, { dpKeyMode: keyMode });
    const firstGoalSuffix = state === config.firstGoalState ? "\nrole:first-goal" : "";
    const traceKey = config.preserveGoalArchive === true && Array.isArray(state.routeTrace)
      ? state.routeTrace.map((entry) =>
          (entry && (entry.fingerprint || entry.summary || entry.kind)) || "unknown"
        ).join("\n")
      : null;
    const key = traceKey == null
      ? `${stateKey}${firstGoalSuffix}`
      : `${stateKey}\ntrace:${traceKey}${firstGoalSuffix}`;
    const existing = byKey.get(key);
    if (!existing || compareCandidateStates(state, existing) < 0)
      byKey.set(key, state);
  });
  const goal = (segment || {}).goal || {};
  const actionSurvivableTarget =
    goal.actionSurvivable && goal.actionSurvivable.summary
      ? goal.actionSurvivable.summary
      : null;
  const records = Array.from(byKey.values()).map((state, index) => {
    const trace = Array.isArray(state.routeTrace)
      ? state.routeTrace
          .map((entry) => compactTraceEntry(simulator.project, entry))
          .filter(Boolean)
      : [];
    if (Object.prototype.hasOwnProperty.call(state, "routeTrace"))
      delete state.routeTrace;
    let targetMargin = null;
    if (actionSurvivableTarget) {
      try {
        const threshold = estimateBattleSurvivability(
          simulator,
          state,
          actionSurvivableTarget,
          { skipMinHp: true },
        );
        if (threshold && threshold.supported) {
          targetMargin = {
            survivable: threshold.survivable,
            margin:
              number(threshold.currentHp, 0) -
              number(threshold.currentDamage, Number.POSITIVE_INFINITY),
            special: threshold.special,
            riskTags: threshold.riskTags,
          };
        }
      } catch (error) {
        targetMargin = null;
      }
    }
    return {
      id: `${segment.id || "segment"}#${index}`,
      state,
      route: Array.isArray(state.route) ? state.route.slice() : [],
      trace,
      hero: summarizeHero(state),
      effectiveHero: summarizeEffectiveHero(state),
      score: goalCandidateScore(state),
      tags: state === config.firstGoalState ? ["first-goal"] : [],
      targetMargin,
    };
  });
  const rolePickers = [
    [
      "highest-hp",
      (left, right) =>
        summarizeHero(right.state).hp - summarizeHero(left.state).hp,
    ],
    ["best-combat", (left, right) => right.score - left.score],
    [
      "highest-atk",
      (left, right) => right.effectiveHero.atk - left.effectiveHero.atk,
    ],
    [
      "highest-def",
      (left, right) => right.effectiveHero.def - left.effectiveHero.def,
    ],
    [
      "highest-mdef",
      (left, right) => right.effectiveHero.mdef - left.effectiveHero.mdef,
    ],
    ["highest-exp", (left, right) => right.hero.exp - left.hero.exp],
    ["shortest", (left, right) => left.route.length - right.route.length],
  ];
  if (actionSurvivableTarget) {
    rolePickers.push([
      "best-target-margin",
      (left, right) => {
        const leftMargin = left.targetMargin
          ? left.targetMargin.margin
          : -Infinity;
        const rightMargin = right.targetMargin
          ? right.targetMargin.margin
          : -Infinity;
        return rightMargin - leftMargin;
      },
    ]);
    rolePickers.push([
      "target-survivable",
      (left, right) => {
        const leftOk =
          left.targetMargin && left.targetMargin.survivable ? 1 : 0;
        const rightOk =
          right.targetMargin && right.targetMargin.survivable ? 1 : 0;
        return rightOk - leftOk;
      },
    ]);
  }
  const selected = [];
  const selectedIds = new Set();
  const compareGoalRecords = (left, right) => {
    if (objectiveOrdersCandidates) {
      const objectiveDiff = objective.compareCandidates(left, right);
      if (objectiveDiff !== 0) return objectiveDiff;
    }
    const tagDiff = right.tags.length - left.tags.length;
    if (tagDiff !== 0) return tagDiff;
    const stateDiff = compareCandidateStates(left.state, right.state);
    if (stateDiff !== 0) return stateDiff;
    if (objective && !objectiveOrdersCandidates) {
      const objectiveDiff = objective.compareCandidates(left, right);
      if (objectiveDiff !== 0) return objectiveDiff;
    }
    return candidateOutcomeScore(right) - candidateOutcomeScore(left);
  };
  const keepCandidate = (record) => {
    if (!record || selectedIds.has(record.id) || selected.length >= limit)
      return;
    selectedIds.add(record.id);
    selected.push(record);
  };
  rolePickers.forEach(([tag, compare]) => {
    const winner = records.slice().sort(compare)[0];
    if (winner) addTag(winner, tag);
  });
  if (config.firstGoalState) {
    keepCandidate(records.find((record) => record.state === config.firstGoalState));
  }
  if (config.preserveSkylineRoles === true) {
    rolePickers.forEach(([, compare]) =>
      keepCandidate(records.slice().sort(compare)[0]),
    );
  }
  records.sort(compareGoalRecords).forEach(keepCandidate);
  const goalSkyline = selected.slice(0, limit).sort(compareGoalRecords);
  goalSkyline.goalArchiveTrimmed = records.length > limit;
  goalSkyline.goalArchiveCandidateCount = records.length;
  return goalSkyline;
}

function normalizeCandidateRecord(candidate, index, fallbackSegmentId) {
  const state = candidate && candidate.state;
  return {
    id:
      candidate && candidate.id
        ? candidate.id
        : `${fallbackSegmentId || "segment"}#${index}`,
    state,
    route: Array.isArray(candidate && candidate.route)
      ? candidate.route.slice()
      : Array.isArray(state && state.route)
        ? state.route.slice()
        : [],
    trace: Array.isArray(candidate && candidate.trace)
      ? candidate.trace.slice()
      : [],
    hero: (candidate && candidate.hero) || summarizeHero(state),
    effectiveHero:
      (candidate && candidate.effectiveHero) || summarizeEffectiveHero(state),
    score: number(candidate && candidate.score, goalCandidateScore(state)),
    tags: Array.isArray(candidate && candidate.tags)
      ? candidate.tags.slice()
      : [],
  };
}

function selectCandidateSkyline(simulator, candidates, segment, options) {
  const config = options || {};
  const objective = config.objectiveSpec && config.objectiveSpec.explicit
    ? config.objectiveSpec
    : null;
  const objectiveOrdersCandidates = Boolean(
    objective && (
      objective.requiresOptimizationProof ||
      ((objective.spec || {}).tieBreakers || []).length > 0
    ),
  );
  const limit = Math.max(
    1,
    number(
      (options || {}).candidateLimit || (segment.dp || {}).goalSkylineLimit,
      8,
    ),
  );
  const keyMode = (segment.dp || {}).keyMode || "region";
  const byKey = new Map();
  const inputCandidates = (candidates || [])
    .filter((candidate) => candidate && candidate.state);
  const candidateKeys = new Map();
  inputCandidates.forEach((candidate) => {
    const key = buildDpStateKey(simulator, candidate.state, {
      dpKeyMode: keyMode,
    });
    candidateKeys.set(candidate.id, key);
    const existing = byKey.get(key);
    if (
      !existing ||
      compareCandidateStates(candidate.state, existing.state) < 0
    )
      byKey.set(key, candidate);
  });
  const goal = (segment || {}).goal || {};
  const actionSurvivableTarget =
    goal.actionSurvivable && goal.actionSurvivable.summary
      ? goal.actionSurvivable.summary
      : null;
  // Iteration 5 – deterministic record order: the byKey map iterates in input
  // order, so downstream stable sorts (role winners, novelty ties) could depend
  // on candidate input order. Sorting records by their DP key makes every
  // selection decision input-order independent.
  const records = Array.from(byKey.keys()).sort().map((key, index) => {
    const candidate = byKey.get(key);
    const record = normalizeCandidateRecord(candidate, index, segment.id);
    if (actionSurvivableTarget) {
      try {
        const threshold = estimateBattleSurvivability(
          simulator,
          record.state,
          actionSurvivableTarget,
          { skipMinHp: true },
        );
        if (threshold && threshold.supported) {
          record.targetMargin = {
            survivable: threshold.survivable,
            margin:
              number(threshold.currentHp, 0) -
              number(threshold.currentDamage, Number.POSITIVE_INFINITY),
          };
        }
      } catch (error) {
        record.targetMargin = null;
      }
    }
    return record;
  });
  const compareGoalRecords = (left, right) => {
    if (objectiveOrdersCandidates) {
      const objectiveDiff = objective.compareCandidates(left, right);
      if (objectiveDiff !== 0) return objectiveDiff;
    }
    const tagDiff = right.tags.length - left.tags.length;
    if (tagDiff !== 0) return tagDiff;
    const stateDiff = compareCandidateStates(left.state, right.state);
    if (stateDiff !== 0) return stateDiff;
    if (objective && !objectiveOrdersCandidates) {
      const objectiveDiff = objective.compareCandidates(left, right);
      if (objectiveDiff !== 0) return objectiveDiff;
    }
    return candidateOutcomeScore(right) - candidateOutcomeScore(left);
  };
  const rolePickers = [
    [
      "highest-hp",
      (left, right) =>
        summarizeHero(right.state).hp - summarizeHero(left.state).hp,
    ],
    ["best-combat", (left, right) => right.score - left.score],
    [
      "highest-atk",
      (left, right) => right.effectiveHero.atk - left.effectiveHero.atk,
    ],
    [
      "highest-def",
      (left, right) => right.effectiveHero.def - left.effectiveHero.def,
    ],
    [
      "highest-mdef",
      (left, right) => right.effectiveHero.mdef - left.effectiveHero.mdef,
    ],
    ["highest-exp", (left, right) => right.hero.exp - left.hero.exp],
    ["shortest", (left, right) => left.route.length - right.route.length],
  ];
  if (actionSurvivableTarget) {
    rolePickers.push([
      "best-target-margin",
      (left, right) => {
        const leftMargin = left.targetMargin
          ? left.targetMargin.margin
          : -Infinity;
        const rightMargin = right.targetMargin
          ? right.targetMargin.margin
          : -Infinity;
        return rightMargin - leftMargin;
      },
    ]);
    rolePickers.push([
      "target-survivable",
      (left, right) => {
        const leftOk =
          left.targetMargin && left.targetMargin.survivable ? 1 : 0;
        const rightOk =
          right.targetMargin && right.targetMargin.survivable ? 1 : 0;
        return rightOk - leftOk;
      },
    ]);
  }
  const selected = [];
  const selectedIds = new Set();
  const keepCandidate = (record) => {
    if (!record || selectedIds.has(record.id) || selected.length >= limit)
      return false;
    selectedIds.add(record.id);
    selected.push(record);
    return true;
  };
  rolePickers.forEach(([tag, compare]) => {
    const winner = records.slice().sort(compare)[0];
    if (winner) addTag(winner, tag);
  });
  // Iteration 5 – resource-diversity frontier selection. Under
  // preserveSkylineRoles (the adaptive repair default) the fixed role winners
  // no longer consume the whole capacity: only the conserve/combat anchors and
  // the atk/def/exp resource anchors keep mandatory seats; `shortest` loses
  // its forced seat in the investment frontier; remaining slots are filled by
  // (a) Pareto protection on the generic resource vector FIRST, then (b)
  // greedy resource novelty over remaining candidates, then (c) legacy
  // ranking fallback. Capacity stays at the configured limit (default 8) —
  // this NEVER widens the enumeration.
  const diversitySelection =
    (options || {}).milestoneFrontierResourceDiversity === true &&
    (options || {}).preserveSkylineRoles === true;
  let diversityAudit = null;
  if (diversitySelection) {
    const anchorTags = [
      "highest-hp",
      "best-combat",
      "highest-atk",
      "highest-def",
      "highest-exp",
    ];
    const anchorCompare = new Map(rolePickers);
    anchorTags.forEach((tag) => {
      const compare = anchorCompare.get(tag);
      if (!compare) return;
      keepCandidate(records.slice().sort(compare)[0]);
    });
    // Resource projections over the (dp-key deduplicated) records.
    const projections = new Map();
    records.forEach((record) => {
      projections.set(
        record.id,
        resourceProjection(buildCandidateResourceSignature(record.state)),
      );
    });
    const dimensions = new Set();
    projections.forEach((projection) => {
      Object.keys(projection).forEach((dim) => dimensions.add(dim));
    });
    const dimensionList = Array.from(dimensions).sort();
    // Pareto protection (Iteration 5 Repair 1, P1-B): nondominated candidates
    // on the resource vector may not be dropped merely because another
    // candidate has higher HP/combat. The protection is ORDERED: while any
    // unselected nondominated candidate exists, no dominated candidate may
    // consume a remaining (non-anchor) slot.
    const nondominated = records.filter((record) => {
      const projection = projections.get(record.id);
      return !records.some((other) => {
        if (other === record) return false;
        return resourceDominates(
          projections.get(other.id),
          projection,
          dimensionList,
        );
      });
    });
    const nondominatedIds = new Set(nondominated.map((record) => record.id));
    const selectedBest = {};
    const refreshSelectedBest = () => {
      Object.keys(selectedBest).forEach((key) => delete selectedBest[key]);
      selected.forEach((record) => {
        const projection = projections.get(record.id) || {};
        dimensionList.forEach((dim) => {
          const value = Number(projection[dim] || 0);
          if (
            selectedBest[dim] == null ||
            value > Number(selectedBest[dim])
          ) {
            selectedBest[dim] = value;
          }
        });
      });
    };
    refreshSelectedBest();
    // Greedy resource novelty over a restricted pool. Ties break by the legacy
    // ordering so the result is input-order independent (deterministic).
    // Phase 1 (Pareto-first): only nondominated leftovers compete.
    // Phase 2 (general novelty): all remaining candidates compete.
    // Non-anchor diversity selections are tagged `resource-diverse` (and
    // Pareto survivors additionally `resource-pareto` for diagnostics) so
    // failure-driven rollback ranking can actually prefer them.
    const noveltyFilledIds = [];
    const noveltyFill = (pool) => {
      let guard = records.length + 1;
      while (selected.length < limit && guard > 0) {
        guard -= 1;
        let bestRecord = null;
        let bestNovelty = 0;
        pool
          .filter((record) => !selectedIds.has(record.id))
          .sort(compareGoalRecords)
          .forEach((record) => {
            const novelty = resourceNovelty(
              projections.get(record.id) || {},
              selectedBest,
              dimensionList,
            );
            if (novelty > bestNovelty) {
              bestNovelty = novelty;
              bestRecord = record;
            }
          });
        if (bestNovelty === 0 || !bestRecord) break;
        keepCandidate(bestRecord);
        noveltyFilledIds.push(bestRecord.id);
        refreshSelectedBest();
      }
    };
    // Phase 1: Pareto-first novelty fill (only nondominated leftovers compete).
    noveltyFill(nondominated);
    // Phase 2: nondominated leftovers with zero novelty still outrank every
    // dominated candidate for the remaining capacity (true Pareto protection:
    // while any unselected nondominated candidate exists, no dominated
    // candidate may consume a non-anchor slot).
    const paretoLeftoverIds = [];
    nondominated
      .filter((record) => !selectedIds.has(record.id))
      .sort(compareGoalRecords)
      .forEach((record) => {
        if (keepCandidate(record)) paretoLeftoverIds.push(record.id);
      });
    // Phase 3: general novelty fill over everything remaining.
    noveltyFill(records);
    // Tag every non-anchor diversity selection so preferredCandidateTags
    // like "resource-diverse" are LIVE (rollback ranking can act on them).
    noveltyFilledIds.forEach((id) => {
      const record = records.find((entry) => entry.id === id);
      if (record) {
        addTag(record, "resource-diverse");
        if (nondominatedIds.has(id)) addTag(record, "resource-pareto");
      }
    });
    paretoLeftoverIds.forEach((id) => {
      const record = records.find((entry) => entry.id === id);
      if (record) {
        addTag(record, "resource-diverse");
        addTag(record, "resource-pareto");
      }
    });
    diversityAudit = {
      anchorTags,
      nondominatedCount: nondominated.length,
      noveltyFilled: noveltyFilledIds.length,
      paretoLeftoverKept: paretoLeftoverIds.length,
      resourceDiverseTagged: noveltyFilledIds.length + paretoLeftoverIds.length,
    };
  } else if ((options || {}).preserveSkylineRoles === true) {
    rolePickers.forEach(([, compare]) =>
      keepCandidate(records.slice().sort(compare)[0]),
    );
  }
  records.sort(compareGoalRecords).forEach(keepCandidate);
  const frontier = selected.slice(0, limit).sort(compareGoalRecords);
  frontier.milestoneFrontierTrimmed = records.length > limit;
  frontier.milestoneFrontierCandidateCount = records.length;
  if (diversityAudit) {
    frontier.milestoneFrontierDiversity = {
      ...diversityAudit,
      resourceDimensions: null,
    };
  }
  if ((options || {}).captureSelectionAudit === true) {
    const winnerByKey = new Map(
      Array.from(byKey.entries()).map(([key, candidate]) => [key, candidate.id]),
    );
    const selectedById = new Map(frontier.map((record, index) => [record.id, {
      rank: index,
      tags: Array.isArray(record.tags) ? record.tags.slice() : [],
    }]));
    // Iteration 5 – compact resource-signature statistics (no state dumps):
    // selected and dropped signatures are hashed to stable strings so the
    // qualification can report resource coverage without megabytes of output.
    const signatureDigests = new Map();
    const signatureDigest = (record) => {
      if (!signatureDigests.has(record.id)) {
        const signature = buildCandidateResourceSignature(record.state);
        signatureDigests.set(record.id, JSON.stringify(signature));
      }
      return signatureDigests.get(record.id);
    };
    const selectedSignatures = new Set(
      frontier.map((record) => signatureDigest(record)),
    );
    const droppedResourceDistinct = new Set(
      records
        .filter((record) => !selectedIds.has(record.id))
        .map((record) => signatureDigest(record)),
    );
    frontier.selectionAudit = {
      inputCandidateCount: inputCandidates.length,
      uniqueDpKeyCount: records.length,
      selectedCount: frontier.length,
      resourceDiversity: {
        enabled: diversitySelection,
        selectedResourceSignatureCount: selectedSignatures.size,
        droppedResourceSignatureCount: droppedResourceDistinct.size,
        droppedResourceDistinctFromSelected: Array.from(
          droppedResourceDistinct,
        ).filter((digest) => !selectedSignatures.has(digest)).length,
      },
      decisions: inputCandidates.map((candidate) => {
        const key = candidateKeys.get(candidate.id);
        const winnerId = winnerByKey.get(key);
        const selectedRecord = selectedById.get(candidate.id);
        if (winnerId !== candidate.id) {
          return {
            candidateId: candidate.id,
            selected: false,
            selectedRank: null,
            candidateRoles: [],
            reason: "milestone-frontier-dp-key-deduplication",
            deduplicatedByCandidateId: winnerId || null,
          };
        }
        return {
          candidateId: candidate.id,
          selected: Boolean(selectedRecord),
          selectedRank: selectedRecord ? selectedRecord.rank : null,
          candidateRoles: selectedRecord ? selectedRecord.tags : [],
          reason: selectedRecord
            ? "selected"
            : "milestone-frontier-capacity",
          deduplicatedByCandidateId: null,
        };
      }),
    };
  }
  return frontier;
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
  return (missing || []).some((entry) =>
    predicate(String((entry || {}).field || ""), entry || {}),
  );
}

function upstreamCheckpointPresentTileIssues(project, startState, segment) {
  if (!startState) return [];
  return ((segment || {}).goal || {}).presentTiles
    ? ((segment || {}).goal || {}).presentTiles.filter(
        (required) =>
          ((typeof (required || {}).reason === "string" &&
            required.reason.trim().length > 0) ||
            (typeof (required || {}).propagatedFromMilestone === "string" &&
              required.propagatedFromMilestone.length > 0)) &&
          getTileDefinitionAt(
            project,
            startState,
            required.floorId,
            required.x,
            required.y,
          ) == null,
      )
    : [];
}

function classifySegmentFailure(missing, segment, upstreamPresentTileIssues, searchOutcome) {
  const missingFields = missing || [];
  const classes = [];
  const preferredCandidateTags = [];
  const recommendedNext = [];
  // Iteration 5 Repair 1 (P1-A) – authoritative search completion. A search
  // that stopped early (time/expansion slice, resource limit, trimmed action
  // scope, cancellation) has an UNEXPLORED frontier: its failure must never
  // be read as "resources insufficient to progress" because the missing
  // progress may simply be unexplored. floor-progress-blocked (and its
  // resource-diverse repair direction) is only legitimate after a genuinely
  // complete search.
  const outcome = searchOutcome || {};
  const searchComplete = outcome.searchComplete === true;
  const addClass = (failureClass, reason, tags, recommendation) => {
    classes.push({ failureClass, reason, recommendation });
    (tags || []).forEach((tag) => {
      if (!preferredCandidateTags.includes(tag))
        preferredCandidateTags.push(tag);
    });
    if (recommendation && !recommendedNext.includes(recommendation))
      recommendedNext.push(recommendation);
  };

  if ((upstreamPresentTileIssues || []).length > 0) {
    addClass(
      "upstream-checkpoint-incompatible",
      "required hard presentTiles were already removed at the segment start checkpoint",
      ["best-combat", "shortest"],
      "backtrack to the previous milestone and regenerate a checkpoint preserving the required hard presentTiles",
    );
  } else if (hasMissingField(missingFields, (field) => field === "presentTiles")) {
    addClass(
      "present-tile-overconstrained",
      "hard presentTiles constraint was violated before this milestone goal",
      ["best-combat", "shortest"],
      "relax non-essential presentTiles into preferredPresentTiles or add an explicit reason if it is a required later resource",
    );
  }

  if (
    hasMissingField(
      missingFields,
      (field, entry) =>
        field === "actionSurvivable" && entry.actual === "missing-action",
    )
  ) {
    addClass(
      "target-action-unreachable",
      "required target action is absent from the current primitive action set",
      ["shortest", "best-combat"],
      "check allowedFloors, allowChangeFloors, presentTiles, and local action scope for this segment",
    );
  }

  if (
    hasMissingField(
      missingFields,
      (field) => field === "hero.atk" || field === "effectiveHero.atk",
    )
  ) {
    addClass(
      "atk-deficit",
      "attack threshold is not met",
      ["highest-atk", "best-combat"],
      "backtrack to the previous milestone and try highest-atk or best-combat candidates",
    );
  }

  if (
    hasMissingField(
      missingFields,
      (field) => field === "hero.def" || field === "effectiveHero.def",
    )
  ) {
    addClass(
      "def-deficit",
      "defense threshold is not met",
      ["highest-def", "best-combat"],
      "backtrack to the previous milestone and try highest-def or best-combat candidates",
    );
  }

  if (
    hasMissingField(
      missingFields,
      (field) => field === "hero.mdef" || field === "effectiveHero.mdef",
    )
  ) {
    addClass(
      "mdef-deficit",
      "magic-defense threshold is not met",
      ["highest-mdef", "best-combat"],
      "backtrack to the previous milestone and try highest-mdef or best-combat candidates",
    );
  }

  if (
    hasMissingField(
      missingFields,
      (field, entry) =>
        field === "actionSurvivable" &&
        (entry.riskTags || []).includes("life-limit"),
    )
  ) {
    addClass(
      "life-limit-hp-deficit",
      "life-limit battle threshold is not survivable at current HP",
      ["highest-hp", "highest-def", "best-combat"],
      "scan HP/def sustain resources before retrying the life-limit battle",
    );
  }

  if (hasMissingField(missingFields, (field) => field === "hero.hp")) {
    addClass(
      "hp-deficit",
      "HP threshold is not met",
      ["highest-hp"],
      "backtrack to the previous milestone and try highest-hp candidates",
    );
  }

  if (
    hasMissingField(
      missingFields,
      (field, entry) =>
        field === "actionSurvivable" && entry.actual !== "missing-action",
    )
  ) {
    addClass(
      "action-survivability-deficit",
      "required action exists but current HP cannot survive it",
      ["highest-hp", "best-combat", "highest-def", "highest-atk"],
      "backtrack to the previous milestone and try higher-HP or stronger-combat candidates",
    );
  }

  if (hasMissingField(missingFields, (field) => field === "equipment")) {
    addClass(
      "equipment-missing",
      "required equipment is not equipped",
      ["best-combat", "shortest"],
      "check whether equip actions or the required item pickup are allowed in this segment",
    );
  }

  if (
    hasMissingField(
      missingFields,
      (field) =>
        field === "tileRemoved" ||
        field === "removedTiles" ||
        field === "anyRemovedTiles",
    )
  ) {
    addClass(
      "target-tile-not-cleared",
      "required tile remains present at the best seen state",
      ["best-combat", "highest-atk"],
      "retry this segment with a candidate that has stronger combat or verify the target tile is reachable under the action policy",
    );
  }

  if (hasMissingField(missingFields, (field) => field === "floorId")) {
    // Iteration 5 – split the old floor-scope-mismatch into distinct classes.
    // True scope violation: the goal floor is not reachable under the segment's
    // own allowedFloors/allowChangeFloors/actionKinds policy (a spec/config
    // problem). Otherwise, only a GENUINELY COMPLETE search may conclude
    // "floor-progress-blocked" – the resource-diverse repair direction must
    // never fire on an incomplete search (P1-A).
    const goalFloorId = ((segment || {}).goal || {}).floorId || null;
    const policy = (segment || {}).actionPolicy || {};
    const allowedFloors = Array.isArray(policy.allowedFloors)
      ? policy.allowedFloors.map(String)
      : null;
    const actionKinds = Array.isArray(policy.actionKinds)
      ? policy.actionKinds.map(String)
      : null;
    const floorTransitKinds = ["changeFloor", "floorFly"];
    // Scope violation: either the goal floor is outside allowedFloors, or the
    // action kinds forbid every floor-transit action kind (changeFloor and
    // floorFly), making the goal floor structurally unreachable from any
    // frontier state of this segment.
    const floorTransitPermitted =
      !actionKinds || floorTransitKinds.some((kind) => actionKinds.includes(kind));
    const goalFloorInScope =
      !goalFloorId ||
      (!allowedFloors || allowedFloors.includes(String(goalFloorId)));
    const goalFloorAllowed = goalFloorInScope && floorTransitPermitted;
    if (goalFloorAllowed && searchComplete) {
      addClass(
        "floor-progress-blocked",
        "complete search could not progress to the target floor from the current frontier",
        [
          "highest-hp",
          "highest-atk",
          "highest-def",
          "highest-exp",
          "best-combat",
          "resource-diverse",
        ],
        "backtrack to the previous milestone and regenerate candidates from different resource-investment states",
      );
    } else if (goalFloorAllowed) {
      // Incomplete search (time/expansion slice stop, resource limit, action
      // scope trimming, cancellation): the frontier is unexplored, so this
      // attempt's missing floor is NOT evidence about resource histories.
      // Classify by incompleteness; no resource-diverse repair direction.
      addClass(
        "floor-search-incomplete",
        "search stopped before completion, so progress to the target floor was not established either way",
        ["highest-hp", "best-combat"],
        "complete the search (budget/slice) before drawing resource conclusions for this segment",
      );
    } else {
      addClass(
        "floor-scope-mismatch",
        "target floor is not permitted by the segment floor policy",
        ["shortest", "best-combat"],
        "check allowedFloors and allowChangeFloors for the segment",
      );
    }
  }

  if (classes.length === 0) {
    addClass(
      "budget-or-action-scope-exhausted",
      "no goal state was found under the current segment budget and action policy",
      ["best-combat", "highest-hp"],
      "increase segment budget, widen action scope, or rerun the previous milestone with location key",
    );
  }

  const failurePriority = {
    "life-limit-hp-deficit": 100,
    "target-action-unreachable": 95,
    "upstream-checkpoint-incompatible": 94,
    "present-tile-overconstrained": 90,
    "action-survivability-deficit": 85,
    "floor-scope-mismatch": 80,
    "floor-progress-blocked": 78,
    "floor-search-incomplete": 12,
    "target-tile-not-cleared": 75,
    "hp-deficit": 70,
    "def-deficit": 65,
    "mdef-deficit": 60,
    "atk-deficit": 55,
    "equipment-missing": 50,
    "budget-or-action-scope-exhausted": 10,
  };
  const primary = classes
    .slice()
    .sort(
      (left, right) =>
        number(failurePriority[right.failureClass], 0) -
        number(failurePriority[left.failureClass], 0),
    )[0];
  return {
    failureClass: primary.failureClass,
    failureReason: primary.reason,
    allFailureClasses: classes,
    preferredCandidateTags,
    recommendedRepair: primary.recommendation || recommendedNext[0],
    recommendedNext,
    segmentId: segment && segment.id,
  };
}

function summarizeSegmentFailure(project, segment, result, simulator, startState, searchOutcome) {
  const best =
    (result && (result.bestProgressState || result.bestSeenState)) || null;
  const missing = best
    ? missingGoalFields(project, simulator, best, segment)
    : [{ field: "state", expected: "reachable", actual: "none" }];
  const upstreamPresentTileIssues = upstreamCheckpointPresentTileIssues(
    project,
    startState,
    segment,
  );
  // Iteration 5 Repair 1 (P1-A) – pass the authoritative search outcome into
  // classification so "resource-diverse" repair directions only fire on
  // genuinely complete searches.
  const classification = classifySegmentFailure(
    missing,
    segment,
    upstreamPresentTileIssues,
    searchOutcome,
  );
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
    upstreamCheckpointIncompatible: upstreamPresentTileIssues.map((tile) => ({
      floorId: tile.floorId,
      x: tile.x,
      y: tile.y,
      reason: tile.reason,
      propagatedFromMilestone: tile.propagatedFromMilestone || null,
    })),
    diagnostics: {
      actionTrimmed:
        result &&
        result.diagnostics &&
        result.diagnostics.dp &&
        result.diagnostics.dp.actionTrimmed,
      frontierRemaining: result && result.frontierSize,
      rejectedByHigherHp:
        result &&
        result.diagnostics &&
        result.diagnostics.dp &&
        result.diagnostics.dp.rejectedByHigherHp,
      replacedLowerHp:
        result &&
        result.diagnostics &&
        result.diagnostics.dp &&
        result.diagnostics.dp.replacedLowerHp,
    },
    recommendedNext: classification.recommendedNext,
  };
}

// Iteration 3 – compact perf aggregate for a single DP attempt: hot phases only.
function perfSnapshotCompact(perfTracker) {
  try {
    const snap = perfTracker.snapshot();
    const phases = snap.phaseSelfMs || {};
    return {
      wallMs: Math.round(snap.wallMs),
      expanded: snap.expanded,
      generated: snap.generated,
      expandedPerSec: snap.expandedPerSec,
      phasesMs: Object.fromEntries(
        Object.entries(phases).map(([k, v]) => [k, Math.round(v)]),
      ),
      topLevelSelfMs: snap.topLevelSelfMs || null,
      stabilizationSubphasesMs: snap.stabilizationSubphasesMs || null,
    };
  } catch (_) {
    return null;
  }
}

function searchSegmentDP(simulator, startState, segment, options) {
  const config = options || {};
  // Iteration 3 – throughput profiling: install a lightweight perf tracker so the
  // canonical hot phases (buildDpStateKey / enumerateActions / sortActions /
  // applyAction / walkReachability / stabilization) are timed for every attempt.
  // Zero overhead when disabled; phase aggregates land in diagnostics.dp.perf.
  const perfEnabled = config.perfProfile === true;
  let perfTracker = null;
  let perfRestoreTracker = null;
  if (perfEnabled) {
    const { createPerfTracker, setActivePerfTracker, getActivePerfTracker } = require("./perf");
    perfTracker = createPerfTracker({ enabled: true, profileExpansionCost: true });
    const previous = getActivePerfTracker();
    setActivePerfTracker(perfTracker);
    perfRestoreTracker = () => setActivePerfTracker(previous);
  }
  try {
    return searchSegmentDPWithPerf(simulator, startState, segment, options, perfTracker, perfRestoreTracker);
  } catch (error) {
    if (perfRestoreTracker) perfRestoreTracker();
    throw error;
  }
}

function searchSegmentDPWithPerf(simulator, startState, segment, options, perfTracker, perfRestoreTracker) {
  const config = options || {};
  const dpConfig = {
    ...(segment.dp || {}),
    ...(config.dpOverrides || {}),
  };
  const maxExpansions = number(dpConfig.maxExpansions, 8000);
  const maxRuntimeMs = number(dpConfig.maxRuntimeMs, 15000);
  const maxActionsPerState = number(dpConfig.maxActionsPerState, 9999);
  const prefixRoute = Array.isArray(config.prefixRoute)
    ? config.prefixRoute
    : Array.isArray(startState.route)
      ? startState.route
      : [];
  const captureTrace = config.captureTrace === true;
  const prefixTrace = captureTrace
    ? Array.isArray(config.prefixTrace)
      ? config.prefixTrace
      : Array.isArray(startState.routeTrace)
        ? startState.routeTrace
        : []
    : [];
  const seed = cloneStateWithoutRouteTrace(startState);
  seed.route = prefixRoute.slice();
  const resourceTimingOptions = buildResourceTimingOptions(
    dpConfig,
    segment,
    config,
  );
  const resourceTimingRequested =
    dpConfig.resourceTimingModel != null ||
    config.resourceTimingModel != null ||
    dpConfig.resourceTimingPolicy != null ||
    config.resourceTimingEnabled === true;
  const resourceTimingEnabled = resourceTimingRequested && resourceTimingOptions.model !== "off";
  const resourceTimingCache = new Map();
  const goal = (segment || {}).goal || {};
  const actionSurvivableTarget =
    goal.actionSurvivable && goal.actionSurvivable.summary;
  let dominanceConfig = null;
  if (actionSurvivableTarget) {
    dominanceConfig = {
      targetSummary: actionSurvivableTarget,
      mode: "action-survivable",
      compare: (left, right) => {
        const leftHp = heroHp(left);
        const rightHp = heroHp(right);
        let leftMargin = null;
        let rightMargin = null;
        try {
          const leftThreshold = estimateBattleSurvivability(
            simulator,
            left,
            actionSurvivableTarget,
            { skipMinHp: true },
          );
          if (leftThreshold && leftThreshold.supported) {
            leftMargin =
              leftHp -
              number(leftThreshold.currentDamage, Number.POSITIVE_INFINITY);
          }
        } catch (error) {
          /* ignore */
        }
        try {
          const rightThreshold = estimateBattleSurvivability(
            simulator,
            right,
            actionSurvivableTarget,
            { skipMinHp: true },
          );
          if (rightThreshold && rightThreshold.supported) {
            rightMargin =
              rightHp -
              number(rightThreshold.currentDamage, Number.POSITIVE_INFINITY);
          }
        } catch (error) {
          /* ignore */
        }
        if (
          leftMargin != null &&
          rightMargin != null &&
          leftMargin !== rightMargin
        ) {
          return leftMargin > rightMargin;
        }
        if (leftHp !== rightHp) return leftHp > rightHp;
        const leftDepth = getDecisionDepth(left);
        const rightDepth = getDecisionDepth(right);
        if (leftDepth !== rightDepth) return leftDepth < rightDepth;
        const leftRoute = getRawRouteLength(left);
        const rightRoute = getRawRouteLength(right);
        return leftRoute < rightRoute;
      },
      describeComparison: (left, right) => {
        const margin = (state) => {
          try {
            const threshold = estimateBattleSurvivability(
              simulator,
              state,
              actionSurvivableTarget,
              { skipMinHp: true },
            );
            return threshold && threshold.supported
              ? number(state && state.hero && state.hero.hp, 0) - number(threshold.currentDamage, Number.POSITIVE_INFINITY)
              : null;
          } catch (error) {
            return null;
          }
        };
        const candidateMargin = margin(left);
        const witnessMargin = margin(right);
        return {
          mode: "action-survivable",
          targetMarginDiff: candidateMargin != null && witnessMargin != null
            ? candidateMargin - witnessMargin
            : null,
          targetMarginCandidate: candidateMargin,
          targetMarginWitness: witnessMargin,
        };
      },
    };
  }
  const originalDominanceCompare = dominanceConfig && typeof dominanceConfig.compare === "function"
    ? dominanceConfig.compare
    : null;
  const baseDominanceCompare = originalDominanceCompare
    ? (left, right) => (originalDominanceCompare(left, right) ? 1 : -1)
    : compareDpBest;
  const baseDominanceDescribe = dominanceConfig && typeof dominanceConfig.describeComparison === "function"
    ? dominanceConfig.describeComparison
    : null;
  const resourceTimingDominance = resourceTimingEnabled
    ? {
        mode: "resource-timing",
        compare: (left, right) => compareResourceTimingStates(
          left,
          right,
          baseDominanceCompare,
          resourceTimingOptions,
        ),
        hasConflict: (left, right) => hasTimingConflict(left, right, resourceTimingOptions),
        describeComparison: (left, right) => ({
          mode: "resource-timing",
          timingConflict: hasTimingConflict(left, right, resourceTimingOptions),
          timingRoles: {
            candidate: resourceTimingRoles(left),
            witness: resourceTimingRoles(right),
          },
          base: baseDominanceDescribe
            ? baseDominanceDescribe(left, right)
            : null,
        }),
      }
    : null;
  if (resourceTimingDominance) {
    dominanceConfig = {
      ...(dominanceConfig || {}),
      ...resourceTimingDominance,
    };
  }
  const actionProviderMode = String(
    dpConfig.actionProviderMode ||
      (segment.actionPolicy && segment.actionPolicy.actionProviderMode) ||
      "",
  );
  let actionProvider;
  let actionApplier = null;
  let oracleDiagnostics = null;
  if (actionProviderMode === "monster-only") {
    // Cache oracle results per floor within a single DP expansion (state is fixed)
    let oracleCache = null;
    let oracleCacheState = null;
    const oracleStats = {
      targetsGenerated: 0,
      targetsAfterCap: 0,
      reachableTargetsGenerated: 0,
      reachableTargetsAfterCap: 0,
      targetCapDrops: 0,
      statesWithTargetCap: 0,
      maxTargetsGeneratedForState: 0,
      maxTargetsAfterCapForState: 0,
      floorSearches: 0,
      floorCacheHits: 0,
      oracleCacheHitRate: 0,
      oracleFloorSearchMs: 0,
      floorEntriesReturned: 0,
      maxFloorEntriesReturned: 0,
      oracleBattleReachabilityMs: 0,
      reachabilityNodes: 0,
      maxReachabilityNodes: 0,
      battleCandidates: 0,
      successorCandidatesBeforeCap: 0,
      successorCandidatesAfterCap: 0,
      successorCapDrops: 0,
      successorSelectedByRole: {},
      successorsReturned: 0,
      routePatchTotalLength: 0,
      routePatchAvgLength: 0,
      routePatchMaxLength: 0,
      rejectedByReason: {},
    };
    oracleDiagnostics = oracleStats;
    actionProvider = reachAndBattleOracle.buildMonsterOnlyActionProvider(
      simulator,
      segment,
      dpConfig,
      oracleStats,
    );
    actionApplier = (state, target) => {
      // Reset cache if state changed (new DP expansion)
      if (state !== oracleCacheState) {
        oracleCache = new Map();
        oracleCacheState = state;
      }
      const cached = oracleCache.has(target.floorId);
      const result = reachAndBattleOracle.tryReachAndBattle(
        simulator,
        state,
        target,
        segment,
        dpConfig,
        oracleCache,
        oracleStats,
      );
      if (cached) oracleStats.floorCacheHits += 1;
      else oracleStats.floorSearches += 1;
      const floorLookups =
        oracleStats.floorSearches + oracleStats.floorCacheHits;
      oracleStats.oracleCacheHitRate =
        floorLookups > 0 ? oracleStats.floorCacheHits / floorLookups : 0;
      if (!result.ok) {
        oracleStats.rejectedByReason[result.reason] =
          (oracleStats.rejectedByReason[result.reason] || 0) + 1;
        throw new Error(`monster-only applier failed: ${result.reason}`);
      }
      oracleStats.battleCandidates += result.results.length;
      // Attach compressed routePatch (summary strings only) to each postState
      const postStates = result.results.map((r) => {
        r.postState._routePatch = r.routePatch
          .map((entry) =>
            typeof entry === "string" ? entry : entry && entry.summary,
          )
          .filter(Boolean);
        oracleStats.routePatchTotalLength += r.postState._routePatch.length;
        oracleStats.routePatchMaxLength = Math.max(
          oracleStats.routePatchMaxLength,
          r.postState._routePatch.length,
        );
        return r.postState;
      });
      oracleStats.successorsReturned += postStates.length;
      oracleStats.routePatchAvgLength =
        oracleStats.successorsReturned > 0
          ? oracleStats.routePatchTotalLength / oracleStats.successorsReturned
          : 0;
      return postStates;
    };
  } else {
    actionProvider = buildSegmentActionProvider(simulator, segment);
  }
  const dpPriorityMode = usesResourceTimingMode(segment) &&
    (!dpConfig.priorityMode || dpConfig.priorityMode === "default") &&
    !dpConfig.dpPriorityMode
    ? "resource-first"
    : dpConfig.priorityMode || dpConfig.dpPriorityMode || "default";
  const dependencyGraph = config.goalDependencyGraph || (
    dpPriorityMode === "goal-directed" && Array.isArray(config.goalDependencySegments)
      ? compileGoalDependencyGraph(simulator.project, config.goalDependencySegments)
      : null
  );
  const goalProgressProjector = dpPriorityMode === "goal-directed"
    ? dependencyGraph
      ? (state) => dependencyGraph.project(state, segment.id)
      : (state) => projectSegmentGoalProgress(simulator.project, state, segment)
    : null;
  const stateFeasibilityPredicate = buildSegmentStateFeasibilityPredicate(
    simulator.project,
    segment,
    dpConfig.goalFeasibilityMode,
  );
  const result = searchDP(simulator, seed, {
    targetFloorId: segment.goal && segment.goal.floorId,
    maxExpansions,
    maxActionsPerState,
    maxRuntimeMs,
    maxHeapMb: number(dpConfig.maxHeapMb, 0),
    maxRssMb: number(dpConfig.maxRssMb, 0),
    maxRssHardCeilingMb: number(dpConfig.maxRssHardCeilingMb, 0),
    memoryCheckIntervalExpansions: number(dpConfig.memoryCheckIntervalExpansions, 1),
    memoryCheckIntervalActions: number(dpConfig.memoryCheckIntervalActions, 1),
    rssGcFlatten: dpConfig.rssGcFlatten !== false,
    rssGcHighWaterFraction: number(dpConfig.rssGcHighWaterFraction, 0.85),
    rssGcMinIntervalExpansions: number(dpConfig.rssGcMinIntervalExpansions, 16),
    rssGcMaxIntervalExpansions: number(dpConfig.rssGcMaxIntervalExpansions, 128),
    rssGcDangerFraction: number(dpConfig.rssGcDangerFraction, 0.94),
    rssGcGoodYieldMb: number(dpConfig.rssGcGoodYieldMb, 12),
    rssGcLowYieldMb: number(dpConfig.rssGcLowYieldMb, 4),
    rssGcMinHeapGarbageMb: number(dpConfig.rssGcMinHeapGarbageMb, 16),
    memoryUsageProvider: dpConfig.memoryUsageProvider || config.memoryUsageProvider,
    dpKeyMode: dpConfig.keyMode || dpConfig.dpKeyMode || "region",
    dpAgendaMode: dpConfig.agendaMode || "best-first",
    fairnessEvery: number(dpConfig.fairnessEvery, 32),
    dpPriorityMode,
    actionProviderMode: actionProviderMode || "segment-provider",
    // The objective comparator is a pure terminal hook: it only orders the
    // reached goal archive / bestGoalNode / final goal result.  It must not
    // reach the DP key, same-key HP dominance, agenda, or intermediate pruning.
    goalStateComparator: config.objectiveSpec && config.objectiveSpec.explicit
      ? (left, right) => -config.objectiveSpec.compareCandidates(left, right)
      : undefined,
    objectiveProjector: config.objectiveSpec && config.objectiveSpec.explicit
      ? objectiveProjector(config.objectiveSpec)
      : undefined,
    observerCaptureMode: dpConfig.observerCaptureMode || config.observerCaptureMode || "off",
    observerCaptureDominanceWitnesses: dpConfig.observerCaptureDominanceWitnesses === true || config.observerCaptureDominanceWitnesses === true,
    observerCaptureWitnessStates: dpConfig.observerCaptureWitnessStates === true || config.observerCaptureWitnessStates === true,
    goalArchiveAudit: dpConfig.goalArchiveAudit || config.goalArchiveAudit || null,
    stopOnFirstGoal: dpConfig.stopOnFirstGoal === true,
    maxExpansionsAfterFirstGoal: dpConfig.maxExpansionsAfterFirstGoal,
    continueAfterGoal: dpConfig.continueAfterGoal === true,
    captureTrace,
    captureExpandedStates: dpConfig.captureExpandedStates === true || config.captureExpandedStates === true,
    captureExpandedStateLimit: number(dpConfig.captureExpandedStateLimit, config.captureExpandedStateLimit || 0),
    candidateKeyShadowRecorder: config.candidateKeyShadowRecorder || dpConfig.candidateKeyShadowRecorder || null,
    dpStateKeyBuilder: config.dpStateKeyBuilder || dpConfig.dpStateKeyBuilder || null,
    dpKeyProfile: config.dpKeyProfile || dpConfig.dpKeyProfile || null,
    initialRouteTracePrefix: prefixTrace,
    goalSkylineLimit: number(dpConfig.goalSkylineLimit, 8),
    landmarkArchiveLimit: number(dpConfig.landmarkArchiveLimit, 0),
    dpSkylineMax: resourceTimingEnabled
      ? Math.max(
        number(dpConfig.dpSkylineMax, resourceTimingOptions.skylineMax),
        resourceTimingOptions.skylineMax,
      )
      : number(dpConfig.dpSkylineMax, 1),
    preserveGoalArchive: dpConfig.preserveGoalArchive === true,
    preserveSkylineAlternatives: dpConfig.preserveSkylineAlternatives === true,
    dominanceConfig,
    skylineCompare: resourceTimingEnabled
      ? (left, right) => compareResourceTimingStates(
        left,
        right,
        baseDominanceCompare,
        resourceTimingOptions,
      )
      : null,
    skylineRoles: resourceTimingEnabled ? resourceTimingRoles : null,
    stateAnnotator: resourceTimingEnabled
      ? (nextState) => annotateStateResourceTiming(
        simulator,
        nextState,
        segment,
        resourceTimingOptions,
        { cache: resourceTimingCache },
      )
      : null,
    ...(goalProgressProjector ? { goalProgressProjector } : {}),
    ...(stateFeasibilityPredicate ? { stateFeasibilityPredicate } : {}),
    actionProvider,
    actionApplier,
    observer: config.observer,
    observerIncludeExactStateKey: config.observerIncludeExactStateKey === true,
    goalPredicate: buildSegmentGoalPredicate(
      simulator.project,
      segment,
      simulator,
    ),
    progressGoal: segment.goal || null,
  });
  const baseDpDiagnostics = (result.diagnostics && result.diagnostics.dp) || {};
  const expansionBudgetExhausted =
    typeof baseDpDiagnostics.expansionBudgetExhausted === "boolean"
      ? baseDpDiagnostics.expansionBudgetExhausted
      : Number(result.expansions || 0) >= maxExpansions &&
        Number(result.frontierSize || 0) > 0 &&
        !baseDpDiagnostics.stoppedReason &&
        !(baseDpDiagnostics.stopOnFirstGoal && result.foundGoal);
  const skylineGoalStates = Array.isArray(result.goalSkylineStates) &&
    result.goalSkylineStates.length > 0
      ? result.goalSkylineStates
      : [result.bestGoalState || result.goalState || result.firstGoalState].filter(Boolean);
  const firstGoalState = config.preserveFirstGoalCheckpoint === true
    ? result.firstGoalState
    : null;
  const goalStates = [firstGoalState, ...skylineGoalStates]
    .filter((state, index, list) => state && list.indexOf(state) === index);
  const goalSkyline = selectGoalSkyline(simulator, goalStates, segment, {
    candidateLimit: config.candidateLimit || dpConfig.goalSkylineLimit,
    objectiveSpec: config.objectiveSpec || null,
    preserveSkylineRoles:
      config.preserveSkylineRoles === true ||
      dpConfig.preserveSkylineRoles === true,
    preserveGoalArchive: dpConfig.preserveGoalArchive === true,
    firstGoalState,
  });
  const searchOutcome = buildSearchOutcome({
    goalFound: goalSkyline.length > 0,
    frontierSize: result.frontierSize,
    expansionBudgetExhausted,
    stoppedReason: baseDpDiagnostics.stoppedReason,
    cancelled: baseDpDiagnostics.cancelled,
    actionTrimmed: baseDpDiagnostics.actionTrimmed,
    stopOnFirstGoal: baseDpDiagnostics.stopOnFirstGoal,
  });
  if (perfRestoreTracker) perfRestoreTracker();
  return {
    segmentId: segment.id,
    found: goalSkyline.length > 0,
    searchOutcome,
    startCandidateId: config.candidateId || null,
    goalSkyline,
    bestSeen: result.bestSeenState,
    bestProgress: result.bestProgressState,
    deepestExpanded: result.deepestExpandedState,
    landmarkArchive: result.landmarkArchive || [],
    diagnostics: {
      dp: {
        ...baseDpDiagnostics,
        perf: perfTracker ? perfSnapshotCompact(perfTracker) : null,
        expansions: result.expansions,
        frontierSize: result.frontierSize,
        maxExpansions,
        maxRuntimeMs,
        maxActionsPerState,
        expansionBudgetExhausted,
        searchOutcome,
        goalFound: searchOutcome.goalFound,
        frontierExhausted: searchOutcome.frontierExhausted,
        budgetExhausted: searchOutcome.budgetExhausted,
        searchComplete: searchOutcome.searchComplete,
        oracle: oracleDiagnostics || null,
        depth: (result.diagnostics && result.diagnostics.depth) || null,
        routeFree: (result.diagnostics && result.diagnostics.routeFree) || null,
        capturedExpandedStates: (result.diagnostics && result.diagnostics.capturedExpandedStates) || [],
        registry: (result.diagnostics && result.diagnostics.registry) || null,
        goalProjectionCache: dependencyGraph &&
          typeof dependencyGraph.getProjectionCacheStats === "function"
          ? dependencyGraph.getProjectionCacheStats()
          : { hits: 0, misses: 0, hitRate: 0 },
        resourceTiming: resourceTimingEnabled
          ? {
              model: resourceTimingOptions.model,
              targetLimit: resourceTimingOptions.targetLimit,
              resourceLimit: resourceTimingOptions.resourceLimit,
              thresholdLimit: resourceTimingOptions.thresholdLimit,
              skylineMax: resourceTimingOptions.skylineMax,
              analyzedStates: resourceTimingCache.size,
            }
          : { model: "off" },
      },
      actionTrimmed:
        result.diagnostics &&
        result.diagnostics.dp &&
        result.diagnostics.dp.actionTrimmed,
      rejectedByHigherHp:
        result.diagnostics &&
        result.diagnostics.dp &&
        result.diagnostics.dp.rejectedByHigherHp,
      replacedLowerHp:
        result.diagnostics &&
        result.diagnostics.dp &&
        result.diagnostics.dp.replacedLowerHp,
      actionsGeneratedByKind:
        result.diagnostics &&
        result.diagnostics.dp &&
        result.diagnostics.dp.actionsGeneratedByKind,
      actionsExpandedByKind:
        result.diagnostics &&
        result.diagnostics.dp &&
        result.diagnostics.dp.actionsExpandedByKind,
      actionsKeptByKind:
        result.diagnostics &&
        result.diagnostics.dp &&
        result.diagnostics.dp.actionsKeptByKind,
      actionsDominatedByKind:
        result.diagnostics &&
        result.diagnostics.dp &&
        result.diagnostics.dp.actionsDominatedByKind,
      uniqueBattleTargets:
        result.diagnostics &&
        result.diagnostics.dp &&
        result.diagnostics.dp.uniqueBattleTargets,
      uniquePortalEntries:
        result.diagnostics &&
        result.diagnostics.dp &&
        result.diagnostics.dp.uniquePortalEntries,
      failure:
        goalSkyline.length > 0
          ? null
          : baseDpDiagnostics.stoppedReason === "heap-limit" ||
              baseDpDiagnostics.stoppedReason === "rss-limit"
            ? {
                failedSegmentId: segment.id,
                label: segment.label,
                bestSeen: compactState(result.bestProgressState || result.bestSeenState),
                missingGoalFields: [],
                failureClass: "memory-limited",
                failureReason: `search stopped after ${baseDpDiagnostics.stoppedReason}`,
                preferredCandidateTags: [],
                recommendedRepair: null,
                failurePropagation: {
                  failureClass: "memory-limited",
                  primaryFailureClass: "memory-limited",
                  reason: `search stopped after ${baseDpDiagnostics.stoppedReason}`,
                  preferredCandidateTags: [],
                  recommendedNext: [
                    "raise the soft memory cap or reduce the segment scope before retrying",
                  ],
                },
                diagnostics: {
                  frontierRemaining: result.frontierSize,
                  memory: baseDpDiagnostics.memory || null,
                },
              }
            : summarizeSegmentFailure(
                simulator.project,
                segment,
                result,
                simulator,
                startState,
                searchOutcome,
              ),
      goalSkyline: {
        primaryOutput: true,
        count: goalSkyline.length,
        goalArchiveTrimmed: goalSkyline.goalArchiveTrimmed === true,
        goalArchiveCandidateCount: goalSkyline.goalArchiveCandidateCount,
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
  const fromIndex = fromMilestoneId
    ? milestones.findIndex((milestone) => milestone.id === fromMilestoneId)
    : -1;
  const toIndex = toMilestoneId
    ? milestones.findIndex((milestone) => milestone.id === toMilestoneId)
    : -1;
  if (fromMilestoneId && fromIndex < 0) return [];
  if (toMilestoneId && toIndex < 0) return [];
  const startIndex = fromMilestoneId ? fromIndex + 1 : 0;
  const endIndex = toMilestoneId ? toIndex : milestones.length - 1;
  if (startIndex < 0 || endIndex < 0 || startIndex > endIndex) return [];
  return milestones.slice(startIndex, endIndex + 1);
}

function milestoneRangeError(milestoneSpec, fromMilestoneId, toMilestoneId) {
  const milestones = milestoneSpec.milestones || [];
  const fromIndex = fromMilestoneId
    ? milestones.findIndex((milestone) => milestone.id === fromMilestoneId)
    : -1;
  const toIndex = toMilestoneId
    ? milestones.findIndex((milestone) => milestone.id === toMilestoneId)
    : -1;
  if (fromMilestoneId && fromIndex < 0)
    return `Unknown fromMilestoneId: ${fromMilestoneId}`;
  if (toMilestoneId && toIndex < 0)
    return `Unknown toMilestoneId: ${toMilestoneId}`;
  const startIndex = fromMilestoneId ? fromIndex + 1 : 0;
  const endIndex = toMilestoneId ? toIndex : milestones.length - 1;
  if (startIndex > endIndex)
    return `Invalid milestone range: ${fromMilestoneId || "start"} is not before ${toMilestoneId || "end"}`;
  return null;
}

function mergeMilestoneFrontier(simulator, candidates, segment, options) {
  const selected = selectCandidateSkyline(
    simulator,
    candidates || [],
    segment,
    options,
  );
  const merged = selected.map((record, index) => ({
    id: `${segment.id}:candidate-${index}`,
    state: record.state,
    route: record.route,
    trace: record.trace,
    hero: record.hero,
    effectiveHero: record.effectiveHero,
    tags: record.tags,
    score: record.score,
  }));
  merged.milestoneFrontierTrimmed = selected.milestoneFrontierTrimmed === true;
  merged.milestoneFrontierCandidateCount = selected.milestoneFrontierCandidateCount;
  if (selected.milestoneFrontierDiversity) {
    merged.milestoneFrontierDiversity = selected.milestoneFrontierDiversity;
  }
  if (selected.selectionAudit) {
    merged.selectionAudit = selected.selectionAudit;
  }
  return merged;
}

function mergeFailurePropagation(attempts) {
  const failures = (attempts || [])
    .map(
      (attempt) =>
        attempt && attempt.diagnostics && attempt.diagnostics.failure,
    )
    .filter(Boolean);
  if (failures.length === 0) return null;
  const classCounts = {};
  const preferredCandidateTags = [];
  const recommendedNext = [];
  failures.forEach((failure) => {
    const failureClass = failure.failureClass || "unknown";
    classCounts[failureClass] = Number(classCounts[failureClass] || 0) + 1;
    (failure.preferredCandidateTags || []).forEach((tag) => {
      if (!preferredCandidateTags.includes(tag))
        preferredCandidateTags.push(tag);
    });
    (failure.recommendedNext || []).forEach((recommendation) => {
      if (!recommendedNext.includes(recommendation))
        recommendedNext.push(recommendation);
    });
  });
  const primaryFailureClass = Object.entries(classCounts).sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  )[0][0];
  return {
    primaryFailureClass,
    classCounts,
    preferredCandidateTags,
    recommendedNext,
  };
}

function numericOption(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function cloneStateWithoutRouteTrace(state) {
  if (!state || !Object.prototype.hasOwnProperty.call(state, "routeTrace"))
    return cloneState(state);
  const routeTrace = state.routeTrace;
  delete state.routeTrace;
  try {
    return cloneState(state);
  } finally {
    state.routeTrace = routeTrace;
  }
}

// Shared resolver for the start-candidate cap (attempts).  The execution path
// supplies the current frontier length as the floor; preflight reports the
// deterministic cap and leaves the frontier-dependent fallback as null so the
// reported value never claims to be the real executed count when it depends on
// runtime frontier sizes.
function resolveStartCandidateLimit(segment, config, overrides, frontierLength) {
  return numericOption(
    overrides && overrides.startCandidateLimit,
    numericOption(
      config && config.startCandidateLimit,
      numericOption(
        segment && segment.dp && segment.dp.startCandidateLimit,
        frontierLength == null ? null : (frontierLength || 1),
      ),
    ),
  );
}

function segmentCandidateLimit(segment, config, overrides) {
  return numericOption(
    overrides && overrides.candidateLimit,
    numericOption(
      config && config.candidateLimit,
      numericOption(segment && segment.dp && segment.dp.goalSkylineLimit, 8),
    ),
  );
}

// The top-level (task/Launcher) search budget is the authority for the main
// segment search.  Generated segments from the milestone decomposer carry their
// own dp budgets, so these overrides must apply unconditionally -- including
// maxRuntimeMs=0 (unlimited time).  Only explicitly-set fields are included so
// callers that do not provide a budget keep the segment's own budgets.
function manualSearchOverrides(config) {
  const overrides = {};
  if (config && config.maxExpansions != null) overrides.maxExpansions = config.maxExpansions;
  if (config && config.maxRuntimeMs != null) overrides.maxRuntimeMs = config.maxRuntimeMs;
  if (config && config.maxActionsPerState != null) overrides.maxActionsPerState = config.maxActionsPerState;
  if (config && config.goalSkylineLimit != null) overrides.goalSkylineLimit = config.goalSkylineLimit;
  if (config && config.dpSkylineMax != null) overrides.dpSkylineMax = config.dpSkylineMax;
  if (config && config.stopOnFirstGoal != null) overrides.stopOnFirstGoal = config.stopOnFirstGoal;
  return overrides;
}

// Effective per-attempt budgets after applying the top-level manual override.
// The task budget applies per candidate attempt (each searchSegmentDP run gets
// the full manual cap).  Attempt caps are reported per phase, computed with the
// SAME resolvers the execution path uses, so preflight never claims a value the
// executor will not honor.  Used by the Launcher preflight.
function effectiveSegmentBudgets(milestoneSpec, config) {
  const segments = milestoneRange(
    milestoneSpec,
    config && config.fromMilestoneId,
    config && config.toMilestoneId,
  );
  const overrides = manualSearchOverrides(config);
  return segments.map((segment, index) => {
    const perAttempt = {
      maxExpansions: overrides.maxExpansions != null
        ? overrides.maxExpansions
        : number((segment.dp || {}).maxExpansions, 8000),
      maxRuntimeMs: overrides.maxRuntimeMs != null
        ? overrides.maxRuntimeMs
        : number((segment.dp || {}).maxRuntimeMs, 15000),
    };
    const initialOnly = index === 0 && !(config && config.fromMilestoneId);
    const segmentConfig = config || {};
    const initialCap = resolveStartCandidateLimit(segment, segmentConfig, {}, initialOnly ? 1 : null);
    // A later segment's input frontier is produced by earlier phases and is not
    // deterministically bounded by this segment's candidateLimit (a configured
    // repair can retain more candidates via repairCandidateLimit).  When there
    // is no explicit start cap, keep initial null instead of substituting a
    // number that under-reports what the executor may attempt.
    const attemptCaps = {
      initial: initialOnly ? 1 : initialCap,
      configuredRepair: numericOption((segment.dp || {}).repairStartCandidateLimit, null),
      backtrackRetry: backtrackCandidateLimit(segment, segmentConfig),
    };
    return {
      segmentId: segment.id,
      budgetScope: "per-attempt",
      perAttempt,
      attemptCaps,
    };
  });
}

// The task-level search budget is the authority for EVERY segment DP
// execution, including repair/backtrack paths.  After a path merges its own
// (repair/backtrack) overrides, the manual overrides are applied last so
// maxRuntimeMs=0 stays unlimited on repair attempts too.
function withManualBudgetAuthority(config, overrides) {
  const merged = { ...(overrides || {}) };
  merged.dpOverrides = {
    ...(merged.dpOverrides || {}),
    ...manualSearchOverrides(config),
  };
  return merged;
}

function segmentDpOverrides(segment, config, overrides) {
  const dpConfig = (segment || {}).dp || {};
  const repair = (overrides && overrides.dpOverrides) || {};
  const generatedSegment = Boolean(segment && segment.generated);
  return {
    ...(config && config.dpKeyMode && !generatedSegment
      ? { keyMode: config.dpKeyMode }
      : {}),
    ...(config && (config.perAttemptMaxExpansions || config.maxExpansions) && !generatedSegment
      ? { maxExpansions: config.perAttemptMaxExpansions || config.maxExpansions }
      : {}),
    ...(config && (config.perAttemptMaxRuntimeMs || config.maxRuntimeMs) && !generatedSegment
      ? { maxRuntimeMs: config.perAttemptMaxRuntimeMs || config.maxRuntimeMs }
      : {}),
    ...(config && config.maxHeapMb != null
      ? { maxHeapMb: config.maxHeapMb }
      : {}),
    ...(config && config.maxRssMb != null
      ? { maxRssMb: config.maxRssMb }
      : {}),
    ...(config && config.memoryCheckIntervalExpansions != null
      ? { memoryCheckIntervalExpansions: config.memoryCheckIntervalExpansions }
      : {}),
    ...(config && config.memoryCheckIntervalActions != null
      ? { memoryCheckIntervalActions: config.memoryCheckIntervalActions }
      : {}),
    ...(config && typeof config.memoryUsageProvider === "function"
      ? { memoryUsageProvider: config.memoryUsageProvider }
      : {}),
    ...(config && config.stopOnFirstGoal != null
      ? { stopOnFirstGoal: config.stopOnFirstGoal }
      : {}),
    ...(config && config.goalSkylineLimit != null && !generatedSegment
      ? { goalSkylineLimit: config.goalSkylineLimit }
      : {}),
    ...(config && config.dpSkylineMax != null && !generatedSegment
      ? { dpSkylineMax: config.dpSkylineMax }
      : {}),
    ...(config && config.fairnessEvery != null && !generatedSegment
      ? { fairnessEvery: config.fairnessEvery }
      : {}),
    ...(config && config.agendaMode != null && !generatedSegment
      ? { agendaMode: config.agendaMode }
      : {}),
    ...(config && config.priorityMode != null
      ? { priorityMode: config.priorityMode }
      : {}),
    ...(config && config.dpPriorityMode != null
      ? { dpPriorityMode: config.dpPriorityMode }
      : {}),
    ...(config && config.goalFeasibilityMode != null
      ? { goalFeasibilityMode: config.goalFeasibilityMode }
      : {}),
    ...(config && config.maxActionsPerState != null && !generatedSegment
      ? { maxActionsPerState: config.maxActionsPerState }
      : {}),
    ...(config && config.goalArchiveAudit
      ? { goalArchiveAudit: config.goalArchiveAudit }
      : {}),
    ...(config && config.resourceTimingModel != null
      ? { resourceTimingModel: config.resourceTimingModel }
      : {}),
    ...(config && config.resourceTimingTargetLimit != null
      ? { resourceTimingTargetLimit: config.resourceTimingTargetLimit }
      : {}),
    ...(config && config.resourceTimingResourceLimit != null
      ? { resourceTimingResourceLimit: config.resourceTimingResourceLimit }
      : {}),
    ...(config && config.resourceTimingThresholdLimit != null
      ? { resourceTimingThresholdLimit: config.resourceTimingThresholdLimit }
      : {}),
    ...(config && config.resourceTimingSkylineMax != null
      ? { resourceTimingSkylineMax: config.resourceTimingSkylineMax }
      : {}),
    ...(config && config.resourceTimingCalculateThresholds != null
      ? { resourceTimingCalculateThresholds: config.resourceTimingCalculateThresholds }
      : {}),
    ...(repair.stopOnFirstGoal != null
      ? { stopOnFirstGoal: repair.stopOnFirstGoal }
      : {}),
    ...(repair.maxExpansions != null
      ? { maxExpansions: repair.maxExpansions }
      : {}),
    ...(repair.maxRuntimeMs != null
      ? { maxRuntimeMs: repair.maxRuntimeMs }
      : {}),
    ...(repair.keyMode != null ? { keyMode: repair.keyMode } : {}),
    ...(repair.dpKeyMode != null ? { dpKeyMode: repair.dpKeyMode } : {}),
    ...(repair.priorityMode != null
      ? { priorityMode: repair.priorityMode }
      : {}),
    ...(repair.dpPriorityMode != null
      ? { dpPriorityMode: repair.dpPriorityMode }
      : {}),
    ...(repair.goalFeasibilityMode != null
      ? { goalFeasibilityMode: repair.goalFeasibilityMode }
      : {}),
    ...(repair.goalSkylineLimit != null
      ? { goalSkylineLimit: repair.goalSkylineLimit }
      : {}),
    ...(repair.dpSkylineMax != null
      ? { dpSkylineMax: repair.dpSkylineMax }
      : {}),
    ...(repair.maxActionsPerState != null
      ? { maxActionsPerState: repair.maxActionsPerState }
      : {}),
    ...(repair.agendaMode != null ? { agendaMode: repair.agendaMode } : {}),
    ...(repair.dpAgendaMode != null
      ? { dpAgendaMode: repair.dpAgendaMode }
      : {}),
    ...(repair.fairnessEvery != null
      ? { fairnessEvery: repair.fairnessEvery }
      : {}),
    ...(repair.maxRuntimeMs == null && overrides && overrides.expandRuntime
      ? {
          maxRuntimeMs: Math.max(
            numericOption(dpConfig.maxRuntimeMs, 0),
            numericOption(dpConfig.maxRuntimeMs, 0) * 2,
          ),
        }
      : {}),
  };
}

function compactSegmentCandidates(candidates) {
  return (candidates || []).map((candidate) => ({
    id: candidate.id,
    hero: candidate.hero,
    effectiveHero: candidate.effectiveHero,
    tags: candidate.tags,
    routeLength: candidate.route.length,
    resourceTiming: getTiming(candidate.state)
      ? {
          retainedOptionValue: getTiming(candidate.state).retainedOptionValue,
          projectedDamageSaving: getTiming(candidate.state).projectedDamageSaving,
          newlySurvivableTargets: getTiming(candidate.state).newlySurvivableTargets,
          roles: getTiming(candidate.state).roles,
        }
      : null,
  }));
}

function buildMilestoneCheckpoint(segment, execution) {
  const candidates = (execution && execution.merged) || [];
  return {
    segmentId: segment.id,
    label: segment.label,
    uniqueFeasibleRoute: candidates.length === 1,
    candidateCount: candidates.length,
    candidates,
  };
}

function allocateGlobalAttemptBudget(options) {
  const config = options || {};
  const remainingCandidates = Math.max(1, number(config.remainingCandidates, 1));
  const allocation = {};
  if (config.remainingExpansions != null) {
    allocation.maxExpansions = Math.max(
      1,
      Math.min(
        number(config.segmentMaxExpansions, config.remainingExpansions),
        Math.floor(number(config.remainingExpansions, 0) / remainingCandidates) || 1,
      ),
    );
  }
  if (config.remainingRuntimeMs != null) {
    allocation.maxRuntimeMs = Math.max(
      1,
      Math.min(
        number(config.segmentMaxRuntimeMs, config.remainingRuntimeMs),
        Math.floor(number(config.remainingRuntimeMs, 0) / remainingCandidates) || 1,
      ),
    );
  }
  return allocation;
}

function runSegmentAgainstFrontierLocal(
  simulator,
  segment,
  frontier,
  config,
  overrides,
) {
  const objectiveSpec = config && config.objectiveSpec &&
    (!config.objectiveTerminalSegmentId || config.objectiveTerminalSegmentId === segment.id)
    ? config.objectiveSpec
    : null;
  const candidateLimit = segmentCandidateLimit(
    segment,
    config || {},
    overrides || {},
  );
  const startLimit = resolveStartCandidateLimit(
    segment,
    config || {},
    overrides || {},
    (frontier || []).length,
  );
  const inputFrontier = (frontier || []).slice(0, startLimit);
  const globalBudget = config && config.globalBudget;
  const nextCandidates = [];
  const attempts = [];
  let memoryLimited = false;
  let memoryStopReason = null;
  const lifecycle = config && config.observer ? config.observer : null;
  const goalDependencyGraph = config && config.dpPriorityMode === "goal-directed" &&
    Array.isArray(config.goalDependencySegments)
    ? compileGoalDependencyGraph(simulator.project, config.goalDependencySegments)
    : null;
  if (lifecycle && typeof lifecycle.emit === "function") {
    lifecycle.emit("segmentStarted", () => ({
      segmentId: segment.id,
      segmentIndex: Number((config && config.segmentIndex) || 0),
      segmentTotal: Number((config && config.segmentTotal) || 0),
    }));
  }
  // Iteration 4 – work-conserving candidate slice completion.
  // Fair per-candidate slices can locally stop (time or expansions) while the
  // global budget is still in the future (e.g. later candidates exhaust early
  // and release their slices). A local slice stop is therefore NOT search
  // completion for that candidate: its remaining frontier is unexplored. We
  // retry deferred locally-stopped candidates with the remaining global budget
  // until they complete, the segment is found, or the global budget actually
  // runs out.
  //
  // Repair 1 – round-aware fairness:
  //   * Each round (first pass or a deferred retry round) divides the remaining
  //     global budget by the candidates REMAINING IN THAT ROUND. Candidates that
  //     re-queue for the next round do not count toward the current round's
  //     denominator.
  //   * Incomplete accounting counts every candidate that never received a
  //     complete search: the current one, the unvisited tail of the round, and
  //     everything already re-deferred.
  //   * `completed` requires stoppedReason == null AND a genuinely complete
  //     searchOutcome; local expansion-limit is deferred like local time-limit.
  //   * Termination guard: without a finite authoritative global budget (no
  //     globalBudget with requestedRuntimeMs/requestedExpansions/deadlineMs),
  //     deferred rounds must not run at all – such candidates stay incomplete
  //     and the segment cannot claim exhaustion.
  const candidateSliceTelemetry = {
    candidateSliceInitialAttempts: 0,
    candidateSliceLocalTimeouts: 0,
    candidateSliceLocalExpansionStops: 0,
    candidateSliceDeferredRetries: 0,
    candidateSliceRecoveredToExhausted: 0,
    candidateSliceRecoveredToFound: 0,
    candidateSliceStillIncompleteAtGlobalStop: 0,
    candidateSliceTerminalIncomplete: 0,
    unusedGlobalWallMsAtReturn: null,
  };
  // Iteration 4 Repair 2 – authoritative per-candidate completion state.
  // Historical telemetry records that a local slice stop HAPPENED; this map
  // records the candidate's FINAL state after all work-conserving retries.
  // A candidate that timed out on its fair slice but completed on retry is
  // COMPLETE here – the historical timeout must not pollute final semantics.
  //   FOUND               goal reached (terminal success)
  //   COMPLETE            frontier exhausted / genuinely complete search
  //   LOCAL_INCOMPLETE_PENDING   local slice stop, retry pending or impossible
  //   TERMINAL_INCOMPLETE stoppedReason==null but searchOutcome incomplete
  //                       (e.g. actionTrimmed, cancelled) – more wall will not
  //                       fix it; never retried, never claimed complete.
  const candidateCompletion = new Map();
  const setCompletion = (candidateId, state) => {
    candidateCompletion.set(candidateId, state);
  };
  const hasFiniteGlobalBudget = Boolean(
    globalBudget &&
    (globalBudget.requestedRuntimeMs > 0 ||
      globalBudget.requestedExpansions > 0 ||
      Number.isFinite(Number(globalBudget.deadlineMs))),
  );
  const runCandidateAttempt = (candidate, attemptOrdinal, roundRemainingCandidates) => {
    const configuredRemainingRuntimeMs = config && config.deadlineMs
      ? Math.max(0, number(config.deadlineMs, 0) - Date.now())
      : null;
    const globalRemainingRuntimeMs = globalBudget && globalBudget.requestedRuntimeMs > 0
      ? Math.max(0, globalBudget.deadlineMs - Date.now())
      : null;
    const remainingRuntimeMs = configuredRemainingRuntimeMs == null
      ? globalRemainingRuntimeMs
      : globalRemainingRuntimeMs == null
        ? configuredRemainingRuntimeMs
        : Math.min(configuredRemainingRuntimeMs, globalRemainingRuntimeMs);
    const globalRemainingExpansions = globalBudget && globalBudget.requestedExpansions > 0
      ? Math.max(0, globalBudget.requestedExpansions - globalBudget.consumedExpansions)
      : null;
    if (globalBudget && (
      (globalRemainingExpansions != null && globalRemainingExpansions <= 0) ||
      (globalRemainingRuntimeMs != null && globalRemainingRuntimeMs <= 0)
    )) {
      globalBudget.stoppedReason = globalRemainingRuntimeMs != null && globalRemainingRuntimeMs <= 0
        ? "time-limit"
        : "expansion-limit";
      return { kind: "global-limited" };
    }
    // PR-5.24c – local probe budget: a wave-level deadline/expansion cap that
    // is STRICTLY tighter than the global budget. When reached, the candidate
    // yields WITHOUT touching globalBudget.stoppedReason and WITHOUT claiming
    // any completion semantics — the caller (the budgeted scheduler) marks
    // the hypothesis PROBE_PENDING and moves on.
    // Repair 1 (P1-4): the probe wall must ALSO bind INSIDE an attempt: the
    // per-attempt runtime is clamped to the remaining probe wall, and an
    // attempt whose runtime slice expired on the probe deadline classifies
    // as probe-limited (never a global timeout, never a deferred retry).
    const probeDeadlineMs = config && config.probeDeadlineMs;
    const probeExpansionCap = config && config.probeExpansionCap;
    const remainingProbeRuntimeMs = probeDeadlineMs != null &&
      Number.isFinite(Number(probeDeadlineMs))
      ? Math.max(0, Number(probeDeadlineMs) - Date.now())
      : null;
    if (probeDeadlineMs != null && remainingProbeRuntimeMs <= 0) {
      return { kind: "probe-limited" };
    }
    if (probeExpansionCap != null &&
      globalBudget && globalBudget.consumedExpansions >= probeExpansionCap) {
      return { kind: "probe-limited" };
    }
    if (remainingRuntimeMs != null && remainingRuntimeMs <= 0) {
      return { kind: "global-limited" };
    }
    const dpOverrides = segmentDpOverrides(segment, config || {}, overrides || {});
    const remainingCandidates = Math.max(1, roundRemainingCandidates);
    const globalAllocation = allocateGlobalAttemptBudget({
      remainingExpansions: globalRemainingExpansions,
      remainingRuntimeMs,
      remainingCandidates,
      segmentMaxExpansions: dpOverrides.maxExpansions,
      segmentMaxRuntimeMs: dpOverrides.maxRuntimeMs,
    });
    if (globalAllocation.maxExpansions != null)
      dpOverrides.maxExpansions = globalAllocation.maxExpansions;
    if (remainingRuntimeMs != null) {
      const fairCandidateRuntimeMs = globalAllocation.maxRuntimeMs || Math.max(
        1,
        Math.floor(remainingRuntimeMs / remainingCandidates),
      );
      dpOverrides.maxRuntimeMs = Math.max(1, Math.min(
        number(dpOverrides.maxRuntimeMs, fairCandidateRuntimeMs),
        fairCandidateRuntimeMs,
      ));
    }
    // PR-5.24c Repair 1a (P1-B) – clamp the attempt runtime to the probe wall
    // and RECORD whether the probe wall is the binding runtime authority for
    // THIS attempt. The stale pre-attempt remaining value must never be used
    // for post-attempt classification.
    let probeRuntimeWasBinding = false;
    if (remainingProbeRuntimeMs != null) {
      const preClampRuntime = number(dpOverrides.maxRuntimeMs, remainingProbeRuntimeMs);
      dpOverrides.maxRuntimeMs = Math.max(1, Math.min(
        preClampRuntime,
        remainingProbeRuntimeMs,
      ));
      probeRuntimeWasBinding =
        dpOverrides.maxRuntimeMs < preClampRuntime ||
        remainingProbeRuntimeMs <= preClampRuntime;
    }
    // PR-5.24c Repair 1 (P1-1, local side) – clamp the attempt expansions to
    // the remaining probe expansion allowance (child-local coordinates).
    if (probeExpansionCap != null && globalBudget) {
      const remainingProbeExpansions = Math.max(
        0,
        probeExpansionCap - globalBudget.consumedExpansions,
      );
      if (remainingProbeExpansions <= 0) {
        return { kind: "probe-limited" };
      }
      dpOverrides.maxExpansions = Math.min(
        number(dpOverrides.maxExpansions, remainingProbeExpansions),
        remainingProbeExpansions,
      );
    }
    if (config && config.maxHeapMb != null) {
      dpOverrides.maxHeapMb = number(config.maxHeapMb, 0);
    }
    if (config && config.maxRssMb != null) {
      dpOverrides.maxRssMb = number(config.maxRssMb, 0);
    }
    const result = searchSegmentDP(simulator, candidate.state, segment, {
      candidateId: candidate.id,
      prefixRoute: candidate.route,
      prefixTrace:
        config && config.captureTrace === true ? candidate.trace : [],
      candidateLimit,
      perfProfile: config && config.perfProfile === true,
      preserveSkylineRoles: Boolean(
        (config || {}).preserveSkylineRoles ||
        (config || {}).qualityFloor ||
        (overrides || {}).preserveSkylineRoles,
      ),
      captureTrace: config && config.captureTrace === true,
      captureExpandedStates: config && config.captureExpandedStates === true,
      captureExpandedStateLimit: config && config.captureExpandedStateLimit,
      candidateKeyShadowRecorder: config && config.candidateKeyShadowRecorder,
      dpStateKeyBuilder: config && config.dpStateKeyBuilder,
      dpKeyProfile: config && config.dpKeyProfile,
      observer: config && config.observer,
      observerIncludeExactStateKey: config && config.observerIncludeExactStateKey === true,
      observerCaptureMode: config && config.observerCaptureMode,
      observerCaptureDominanceWitnesses: config && config.observerCaptureDominanceWitnesses === true,
      observerCaptureWitnessStates: config && config.observerCaptureWitnessStates === true,
      objectiveSpec,
      goalDependencyGraph,
      goalDependencySegments: config && config.goalDependencySegments,
      dpOverrides,
    });
    attempts.push(result);
    if (config && config.pipelineObserver && typeof config.pipelineObserver.onAttempt === "function") {
      try {
        config.pipelineObserver.onAttempt({
          segment,
          candidate,
          candidateIndex: attemptOrdinal,
          attempt: result,
        });
      } catch (error) {
        // Pipeline observation is diagnostic-only and must not affect search.
      }
    }
    const dp = result && result.diagnostics && result.diagnostics.dp;
    if (dp && ["heap-limit", "rss-limit"].includes(dp.stoppedReason)) {
      memoryLimited = true;
      memoryStopReason = dp.stoppedReason;
    }
    if (globalBudget) {
      globalBudget.consumedExpansions += number(dp && dp.expansions, 0);
      globalBudget.consumedWallMs = Math.max(
        globalBudget.consumedWallMs,
        Date.now() - globalBudget.startedAt,
      );
    }
    result.goalSkyline.forEach((goal) =>
      nextCandidates.push({
        ...goal,
        id: `${segment.id}:${candidate.id}:${goal.id}`,
      }),
    );
    // Release heavy rawResult search nodes so subsequent candidate searches don't accumulate live memory
    result.rawResult = null;
    if (result.diagnostics && result.diagnostics.dp) {
      result.diagnostics.dp.goalSkyline = null;
      result.diagnostics.dp.bestSeenState = null;
      result.diagnostics.dp.bestProgressState = null;
    }
    if (typeof global.gc === "function") global.gc();
    const stoppedReason = dp && dp.stoppedReason;
    const searchOutcome = dp && dp.searchOutcome;
    const goalFound = Array.isArray(result.goalSkyline) && result.goalSkyline.length > 0;
    let kind;
    if (goalFound) {
      kind = "found";
    } else if (
      stoppedReason === "time-limit" &&
      probeRuntimeWasBinding
    ) {
      // PR-5.24c Repair 1a (P1-B) – the attempt's runtime slice was bound by
      // the PROBE wall (recorded at attempt start when the clamp actually
      // tightened the runtime): a mid-attempt probe expiry classifies as
      // probe-limited (pending, no retry, no global semantics), never a
      // deferred local timeout and never a global stop.
      kind = "probe-limited";
    } else if (
      (stoppedReason === "expansion-limit" || (dp && dp.expansionBudgetExhausted === true)) &&
      probeExpansionCap != null &&
      globalBudget &&
      globalBudget.consumedExpansions >= probeExpansionCap
    ) {
      // PR-5.24c Repair 1 (P1-1) – the attempt exhausted the PROBE expansion
      // allowance, not the global/fair slice.
      kind = "probe-limited";
    } else if (stoppedReason === "time-limit") {
      kind = "local-time-limited";
    } else if (stoppedReason === "expansion-limit" || dp && dp.expansionBudgetExhausted === true) {
      // Local fair-slice expansion exhaustion (frontier still open) is a local
      // slice stop, not search completion: the global budget may still have
      // room and the candidate must be retried work-conservingly.
      kind = "local-expansion-limited";
    } else {
      // Genuinely complete only when nothing stopped the search AND the outcome
      // explicitly reports searchComplete (frontier exhausted with a complete
      // action scope, no cancel, no early-stop). frontierExhausted alone is NOT
      // sufficient: a trimmed action scope can exhaust the trimmed frontier
      // while leaving real actions unexplored (terminal incompleteness).
      kind = (stoppedReason == null && searchOutcome && searchOutcome.searchComplete === true)
        ? "completed"
        : "incomplete";
    }
    return { kind, result };
  };

  // Work-conserving scheduler: first a fair pass over all candidates, then as
  // many retry rounds as needed for locally-stopped candidates while the
  // global budget still has room.
  const deferredQueue = [];
  let attemptOrdinal = 0;
  for (let candidateIndex = 0; candidateIndex < inputFrontier.length; candidateIndex += 1) {
    const candidate = inputFrontier[candidateIndex];
    if (lifecycle && typeof lifecycle.emit === "function") {
      lifecycle.emit("attemptStarted", () => ({
        segmentId: segment.id,
        segmentIndex: Number((config && config.segmentIndex) || 0),
        segmentTotal: Number((config && config.segmentTotal) || 0),
        attempt: attemptOrdinal + 1,
        startCandidates: inputFrontier.length,
      }));
    }
    const roundRemainingCandidates = inputFrontier.length - candidateIndex;
    const outcome = runCandidateAttempt(candidate, attemptOrdinal, roundRemainingCandidates);
    attemptOrdinal += 1;
    candidateSliceTelemetry.candidateSliceInitialAttempts += 1;
    if (outcome.kind === "global-limited") {
      // Current candidate never started; everything from here on is incomplete.
      setCompletion(candidate.id, "LOCAL_INCOMPLETE_PENDING");
      for (let tailIndex = candidateIndex + 1; tailIndex < inputFrontier.length; tailIndex += 1) {
        setCompletion(inputFrontier[tailIndex].id, "LOCAL_INCOMPLETE_PENDING");
      }
      candidateSliceTelemetry.candidateSliceStillIncompleteAtGlobalStop +=
        deferredQueue.length + (inputFrontier.length - candidateIndex);
      break;
    }
    if (outcome.kind === "probe-limited") {
      // PR-5.24c – the local probe budget expired. The candidate stays
      // pending, the unvisited tail stays pending, and NO retry is scheduled
      // (the scheduler owns the next move). Global budget semantics are
      // untouched.
      setCompletion(candidate.id, "LOCAL_INCOMPLETE_PENDING");
      for (let tailIndex = candidateIndex + 1; tailIndex < inputFrontier.length; tailIndex += 1) {
        setCompletion(inputFrontier[tailIndex].id, "LOCAL_INCOMPLETE_PENDING");
      }
      candidateSliceTelemetry.candidateSliceStillIncompleteAtGlobalStop +=
        deferredQueue.length + (inputFrontier.length - candidateIndex);
      break;
    }
    if (outcome.kind === "local-time-limited") {
      candidateSliceTelemetry.candidateSliceLocalTimeouts += 1;
      setCompletion(candidate.id, "LOCAL_INCOMPLETE_PENDING");
      deferredQueue.push(candidate);
    } else if (outcome.kind === "local-expansion-limited") {
      candidateSliceTelemetry.candidateSliceLocalExpansionStops += 1;
      setCompletion(candidate.id, "LOCAL_INCOMPLETE_PENDING");
      deferredQueue.push(candidate);
    } else if (outcome.kind === "incomplete") {
      // Terminal incompleteness (stoppedReason==null but searchOutcome not
      // complete, e.g. actionTrimmed or cancelled): more wall will not fix it.
      // Never retried, never claimed complete.
      candidateSliceTelemetry.candidateSliceTerminalIncomplete += 1;
      setCompletion(candidate.id, "TERMINAL_INCOMPLETE");
    } else if (outcome.kind === "found") {
      setCompletion(candidate.id, "FOUND");
    } else {
      setCompletion(candidate.id, "COMPLETE");
    }
    if (memoryLimited) {
      // Memory-limited attempts keep their partial results but cannot claim
      // completeness for the unvisited tail either.
      for (let tailIndex = candidateIndex + 1; tailIndex < inputFrontier.length; tailIndex += 1) {
        setCompletion(inputFrontier[tailIndex].id, "LOCAL_INCOMPLETE_PENDING");
      }
      candidateSliceTelemetry.candidateSliceStillIncompleteAtGlobalStop +=
        deferredQueue.length + (inputFrontier.length - candidateIndex - 1);
      break;
    }
  }
  // Deferred retry rounds (work-conserving): only with a finite authoritative
  // global budget (termination guard) AND remaining global room.
  while (
    deferredQueue.length > 0 &&
    hasFiniteGlobalBudget &&
    !memoryLimited
  ) {
    const globalRemainingMs = globalBudget.requestedRuntimeMs > 0
      ? globalBudget.deadlineMs - Date.now()
      : Number.POSITIVE_INFINITY;
    const globalRemainingExpansions = globalBudget.requestedExpansions > 0
      ? Math.max(0, globalBudget.requestedExpansions - globalBudget.consumedExpansions)
      : Number.POSITIVE_INFINITY;
    if (!(globalRemainingMs > 0) || !(globalRemainingExpansions > 0)) {
      candidateSliceTelemetry.candidateSliceStillIncompleteAtGlobalStop += deferredQueue.length;
      globalBudget.stoppedReason = globalBudget.stoppedReason ||
        (globalRemainingMs > 0 ? "expansion-limit" : "time-limit");
      break;
    }
    const retryRound = deferredQueue.splice(0, deferredQueue.length);
    for (let retryIndex = 0; retryIndex < retryRound.length; retryIndex += 1) {
      const candidate = retryRound[retryIndex];
      const roundRemainingCandidates = retryRound.length - retryIndex;
      const outcome = runCandidateAttempt(candidate, attemptOrdinal, roundRemainingCandidates);
      attemptOrdinal += 1;
      if (outcome.kind === "global-limited") {
        // Current retry never started; count it plus the round tail plus any
        // already re-deferred candidates.
        setCompletion(candidate.id, "LOCAL_INCOMPLETE_PENDING");
        for (let tailIndex = retryIndex + 1; tailIndex < retryRound.length; tailIndex += 1) {
          setCompletion(retryRound[tailIndex].id, "LOCAL_INCOMPLETE_PENDING");
        }
        candidateSliceTelemetry.candidateSliceStillIncompleteAtGlobalStop +=
          deferredQueue.length + (retryRound.length - retryIndex);
        break;
      }
      if (outcome.kind === "probe-limited") {
        // PR-5.24c – probe expiry mid-retry: leave everything pending, stop
        // retrying, and never touch the global stop reason.
        setCompletion(candidate.id, "LOCAL_INCOMPLETE_PENDING");
        for (let tailIndex = retryIndex + 1; tailIndex < retryRound.length; tailIndex += 1) {
          setCompletion(retryRound[tailIndex].id, "LOCAL_INCOMPLETE_PENDING");
        }
        candidateSliceTelemetry.candidateSliceStillIncompleteAtGlobalStop +=
          deferredQueue.length + (retryRound.length - retryIndex);
        break;
      }
      candidateSliceTelemetry.candidateSliceDeferredRetries += 1;
      if (outcome.kind === "local-time-limited" || outcome.kind === "local-expansion-limited") {
        setCompletion(candidate.id, "LOCAL_INCOMPLETE_PENDING");
        deferredQueue.push(candidate);
        continue;
      }
      if (outcome.kind === "incomplete") {
        candidateSliceTelemetry.candidateSliceTerminalIncomplete += 1;
        setCompletion(candidate.id, "TERMINAL_INCOMPLETE");
        continue;
      }
      if (outcome.kind === "found") {
        candidateSliceTelemetry.candidateSliceRecoveredToFound += 1;
        setCompletion(candidate.id, "FOUND");
      } else {
        candidateSliceTelemetry.candidateSliceRecoveredToExhausted += 1;
        setCompletion(candidate.id, "COMPLETE");
      }
    }
  }
  // Candidates left in the queue without a finite global budget (or after a
  // memory stop) remain incomplete – the segment cannot claim exhaustion.
  // (Rounds that exited via the budget-exhausted branch above have already
  // counted their queue; only guard-path leftovers are counted here.)
  if (deferredQueue.length > 0 && !hasFiniteGlobalBudget) {
    candidateSliceTelemetry.candidateSliceStillIncompleteAtGlobalStop += deferredQueue.length;
    for (const candidate of deferredQueue) {
      setCompletion(candidate.id, "LOCAL_INCOMPLETE_PENDING");
    }
  }
  if (globalBudget && globalBudget.requestedRuntimeMs > 0) {
    candidateSliceTelemetry.unusedGlobalWallMsAtReturn = Math.max(
      0,
      globalBudget.deadlineMs - Date.now(),
    );
  }
  // Authoritative final completion rollup (Iteration 4 Repair 2):
  //   final counts reflect the candidate's LAST state, so a locally-timed-out
  //   candidate that completed on retry counts as COMPLETE here even though
  //   candidateSliceLocalTimeouts > 0 in the historical telemetry.
  let finalFound = 0;
  let finalComplete = 0;
  let finalPending = 0;
  let finalTerminalIncomplete = 0;
  for (const state of candidateCompletion.values()) {
    if (state === "FOUND") finalFound += 1;
    else if (state === "COMPLETE") finalComplete += 1;
    else if (state === "LOCAL_INCOMPLETE_PENDING") finalPending += 1;
    else if (state === "TERMINAL_INCOMPLETE") finalTerminalIncomplete += 1;
  }
  candidateSliceTelemetry.candidateSliceFinalFound = finalFound;
  candidateSliceTelemetry.candidateSliceFinalComplete = finalComplete;
  candidateSliceTelemetry.candidateSliceFinalPending = finalPending;
  candidateSliceTelemetry.candidateSliceTerminalIncomplete = finalTerminalIncomplete;
  candidateSliceTelemetry.candidateSliceSearchComplete =
    finalPending === 0 && finalTerminalIncomplete === 0;
  if (lifecycle && typeof lifecycle.emit === "function") {
    lifecycle.emit("segmentCompleted", () => ({
      segmentId: segment.id,
      segmentIndex: Number((config && config.segmentIndex) || 0),
      segmentTotal: Number((config && config.segmentTotal) || 0),
    }));
  }
  const merged = mergeMilestoneFrontier(simulator, nextCandidates, segment, {
    candidateLimit,
    objectiveSpec,
    preserveSkylineRoles: Boolean(
      (config || {}).preserveSkylineRoles ||
        (config || {}).qualityFloor ||
        (overrides || {}).preserveSkylineRoles,
    ),
    milestoneFrontierResourceDiversity: Boolean(
      (config || {}).milestoneFrontierResourceDiversity,
    ),
    captureSelectionAudit: Boolean((config || {}).captureSelectionAudit),
  });
  if (config && config.pipelineObserver && typeof config.pipelineObserver.onMerge === "function") {
    try {
      config.pipelineObserver.onMerge({
        segment,
        inputFrontier,
        nextCandidates,
        attempts,
        merged,
        candidateLimit,
      });
    } catch (error) {
      // Pipeline observation is diagnostic-only and must not affect search.
    }
  }
  const failurePropagation = mergeFailurePropagation(attempts);
  const summary = {
    segmentId: segment.id,
    label: segment.label,
    found: merged.length > 0,
    startCandidatesTried: attempts.length,
    startCandidatesAvailable: (frontier || []).length,
    candidateSliceTelemetry,
    candidates: compactSegmentCandidates(merged),
    milestoneFrontierTrimmed: merged.milestoneFrontierTrimmed === true,
    milestoneFrontierCandidateCount: merged.milestoneFrontierCandidateCount,
    milestoneFrontierSelectionAudit: merged.selectionAudit || null,
    milestoneFrontierDiversity: merged.milestoneFrontierDiversity || null,
    attempts: attempts.map((attempt) => ({
      startCandidateId: attempt.startCandidateId,
      found: attempt.found,
      goalCount: attempt.goalSkyline.length,
      diagnostics: attempt.diagnostics,
    })),
    failurePropagation,
    memory: {
      limited: memoryLimited,
      stoppedReason: memoryStopReason,
      attemptCount: attempts.filter((attempt) => {
        const reason = attempt && attempt.diagnostics && attempt.diagnostics.dp && attempt.diagnostics.dp.stoppedReason;
        return reason === "heap-limit" || reason === "rss-limit";
      }).length,
    },
  };
  return {
    segment,
    inputFrontier,
    merged,
    attempts,
    summary,
    candidateLimit,
    memoryLimited,
    memoryStopReason,
  };
}

function runSegmentAgainstFrontier(
  simulator,
  segment,
  frontier,
  config,
  overrides,
) {
  if (config && config.segmentExecutionMode === "isolated-process") {
    return executeIsolatedSegment({
      simulator,
      segment,
      frontier,
      config,
      overrides,
      isolatedRuntimeDescriptor: config && config.isolatedRuntimeDescriptor,
    });
  }
  return runSegmentAgainstFrontierLocal(
    simulator,
    segment,
    frontier,
    config,
    overrides,
  );
}

function preferredTagScore(candidate, preferredTags) {
  const tags = new Set((candidate && candidate.tags) || []);
  return (preferredTags || []).reduce(
    (score, tag, index) =>
      score + (tags.has(tag) ? Math.max(1, preferredTags.length - index) : 0),
    0,
  );
}

function rankCandidatesByPreferredTags(candidates, preferredTags) {
  return (candidates || []).slice().sort((left, right) => {
    const tagDiff =
      preferredTagScore(right, preferredTags) -
      preferredTagScore(left, preferredTags);
    if (tagDiff !== 0) return tagDiff;
    const stateDiff = compareCandidateStates(
      left && left.state,
      right && right.state,
    );
    if (stateDiff !== 0) return stateDiff;
    return candidateOutcomeScore(right) - candidateOutcomeScore(left);
  });
}

// Iteration 6 – failure-conditioned adaptive investment ranking.
//
// Given a TRUSTED COMPLETE downstream failure (currently only
// floor-progress-blocked) and the rollback anchor frontier, ask the existing
// generic resource-intent scanner which candidates actually sit near relevant
// investment opportunities (pickup/equip/battle/path deltas that improve the
// resources the failure asked for), and rank those candidates first.
//
// Comparator (fixed, per authorization):
//   failureIntentScore DESC  (each candidate's BEST evidence record score —
//                             never an unbounded sum of many small chances)
//   → existing preferred-tag score DESC
//   → existing deterministic candidate comparator
//
// If the scanner yields no usable evidence, the returned order must be
// IDENTICAL to rankCandidatesByPreferredTags (legacy order).
// The scan is bounded by the scanner's existing small-scale constraints; no
// new search is performed. No witness/fixture/route information is visible
// here — only the candidates' own nearby generic action/value deltas.
const FAILURE_INTENT_ELIGIBLE_CLASSES = new Set(["floor-progress-blocked"]);

function failureIntentComplete(triggerFailure) {
  return (
    triggerFailure &&
    FAILURE_INTENT_ELIGIBLE_CLASSES.has(String(triggerFailure.failureClass))
  );
}

// Iteration 6 qualification: baseline mode disables the new ranking path
// entirely (order identical to pre-iteration-6 behavior) while running the
// same commit, for clean baseline-vs-candidate comparison.
// Iteration 6 Repair 2: telemetry now returns bounded per-candidate evidence
// details (top-N up to candidateLimit) so site attribution can rebuild the
// ranking history from events[] without re-deriving scanner internals.
// Iteration 6 Repair 2 — breadth-preserving injection mode.
//
// Site attribution (2x2 Linux authority) proved ANCHOR_HARD_PROMOTION_COST:
// evidence-first hard promotion collapsed wave breadth (4→2) and raised
// pending (18→32). The repair keeps the legacy ordering as the main line and
// reserves AT MOST ONE slot for the top failure-intent candidate:
//
//   candidateLimit = N  →  legacy top-(N-1) + at most 1 intent alternative
//
// Rules (per authorization):
//   no evidence            → selected set/order identical to legacy;
//   incomplete failure     → identical to legacy;
//   intent candidate already in legacy top-N → selected set unchanged;
//   intent candidate outside legacy top-N    → replaces only the LOWEST
//   priority legacy slot, at most one such replacement;
//   deterministic; no new planner; no OnlyUp hints; scanner budget unchanged.
// Iteration 6 Repair 2 — breadth-preserving injection.
//
// Site attribution (2x2 Linux authority) proved ANCHOR_HARD_PROMOTION_COST:
// evidence-first hard promotion collapsed wave breadth (4→2) and raised
// pending (18→32). The repair keeps the legacy ordering as the main line and
// reserves at most ONE slot for the top failure-intent candidate.
//
// Iteration 6 Repair 2a — the two ranking sites have DIFFERENT consumption
// semantics and must not share one insertion rule:
//
//   ANCHOR = "wave-ordered": the anchor frontier is consumed wave by wave
//     (adaptiveWaveBatchSize per wave). Injection must be SCHEDULER-AWARE:
//     the first full legacy wave is protected, the highest-evidence
//     alternative (if not already in that first wave) is moved to the head
//     of the SECOND wave (insertion index = waveBatchSize), and everything
//     else keeps its legacy order. No candidate is ever removed. With the
//     frozen batchSize=1: legacy A B C D ... + intent C → A C B D ...
//
//   REPLAY = "top-n-truncate": the replay frontier is genuinely truncated to
//     the top-N (`.slice(0, replayIntentLimit)`), so the legacy top-(N-1)
//     plus at most one intent alternative is the correct capacity semantics.
//
// Determinism: the evidence candidate selection comparator is
// intentScore desc → legacyRank asc → candidateId lexical, so equal scores
// never depend on input array order.
function breadthPreservingIntentOrder(
  legacy,
  evidenceOrder,
  mode,
  limit,
  waveBatchSize,
) {
  if (evidenceOrder.length === 0) return legacy.slice();
  if (mode === "wave-ordered") {
    const batchSize = Math.max(1, waveBatchSize || 1);
    const firstWave = new Set(legacy.slice(0, batchSize).map((c) => c.id));
    const alternative = evidenceOrder.find((id) => !firstWave.has(id));
    if (alternative == null) return legacy.slice();
    const ranked = legacy.slice();
    const alternativeIndex = ranked.findIndex((c) => c.id === alternative);
    if (alternativeIndex < 0) return legacy.slice();
    const [alternativeCandidate] = ranked.splice(alternativeIndex, 1);
    const insertAt = Math.min(batchSize, ranked.length);
    ranked.splice(insertAt, 0, alternativeCandidate);
    return ranked;
  }
  // top-n-truncate
  const topN = new Set(legacy.slice(0, limit).map((candidate) => candidate.id));
  const alternative = evidenceOrder.find((id) => !topN.has(id));
  if (alternative == null) return legacy.slice();
  const ranked = legacy.slice();
  const alternativeIndex = ranked.findIndex((candidate) => candidate.id === alternative);
  if (alternativeIndex < 0) return legacy.slice();
  const [alternativeCandidate] = ranked.splice(alternativeIndex, 1);
  const insertAt = Math.min(limit - 1, ranked.length);
  ranked.splice(insertAt, 0, alternativeCandidate);
  return ranked;
}

function rankCandidatesByFailureIntent(
  simulator,
  candidates,
  triggerFailure,
  preferredTags,
  options,
) {
  const config = options || {};
  const list = candidates || [];
  const legacy = rankCandidatesByPreferredTags(list, preferredTags);
  const legacyIndexById = new Map(legacy.map((c, index) => [c.id, index]));
  if (config.enabled === false) {
    return {
      ranked: legacy,
      activated: false,
      telemetry: { reason: "disabled-by-config" },
      evidenceCandidates: [],
    };
  }
  if (!failureIntentComplete(triggerFailure)) {
    return {
      ranked: legacy,
      activated: false,
      telemetry: {
        reason: "failure-class-not-eligible",
        failureClass: triggerFailure && triggerFailure.failureClass,
      },
      evidenceCandidates: [],
    };
  }
  const startedAt = Date.now();
  let intents = [];
  try {
    intents = scanResourceIntents(
      simulator,
      list,
      {
        failureClass: triggerFailure.failureClass,
        missingGoalFields: triggerFailure.missingGoalFields || [],
      },
      {
        maxIntentRecords: 24,
        recordsPerIntent: 6,
        maxIntents: 6,
        intentDepth: 1,
        maxIntentNodes: 80,
      },
    );
  } catch (error) {
    intents = [];
  }
  // Aggregate evidence per start candidate: keep only the BEST record score
  // (never an unbounded sum) plus its compact provenance for attribution.
  const bestEvidence = new Map();
  intents.forEach((intent) => {
    (intent.records || []).forEach((record) => {
      const candidateId = record.startCandidateId;
      if (!candidateId) return;
      const score = Number(record.score || 0);
      const existing = bestEvidence.get(candidateId);
      if (!existing || score > existing.score) {
        bestEvidence.set(candidateId, {
          score,
          actionKind: record.actionKind || null,
          category: intent.kind || null,
          delta: record.delta || null,
          frontierDelta: record.frontierDelta || null,
        });
      }
    });
  });
  const candidatesWithEvidence = Array.from(bestEvidence.keys());
  if (candidatesWithEvidence.length === 0) {
    return {
      ranked: legacy,
      activated: false,
      telemetry: {
        reason: "no-usable-evidence",
        failureClass: triggerFailure.failureClass,
        intentScanWallMs: Date.now() - startedAt,
        candidatesScored: list.length,
        candidatesWithEvidence: 0,
        intents: intents.length,
      },
      evidenceCandidates: [],
    };
  }
  const intentScore = (candidate) =>
    bestEvidence.has(candidate && candidate.id)
      ? Number(bestEvidence.get(candidate.id).score)
      : null;
  // Iteration 6 Repair 2a – breadth-preserving with site-aware consumption
  // semantics. ANCHOR fronts are consumed wave-by-wave (wave-ordered
  // injection at index=waveBatchSize, first legacy wave protected); REPLAY
  // fronts are genuinely truncated to top-N (top-n-truncate injection at
  // index=N-1). The hard evidence-first ordering remains available via
  // config.mode === "hard" for attribution purposes only.
  const hardMode = config.mode === "hard";
  const consumptionMode = config.consumptionMode === "wave-ordered"
    ? "wave-ordered"
    : "top-n-truncate";
  const breadthLimit = Math.max(1, number(config.candidateLimit, 8));
  const waveBatchSize = Math.max(1, number(config.waveBatchSize, 1));
  // Deterministic evidence ordering (Repair 2a P1-B): intentScore desc →
  // legacyRank asc → candidateId lexical. Equal scores never depend on the
  // input array order.
  const evidenceOrder = list
    .filter((candidate) => bestEvidence.has(candidate.id))
    .map((candidate) => ({
      id: candidate.id,
      score: Number(bestEvidence.get(candidate.id).score),
      legacyRank: legacyIndexById.has(candidate.id)
        ? legacyIndexById.get(candidate.id) : Number.MAX_SAFE_INTEGER,
    }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (left.legacyRank !== right.legacyRank) return left.legacyRank - right.legacyRank;
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    })
    .map((entry) => entry.id);
  let ranked;
  let injection = null;
  if (hardMode) {
    ranked = list.slice().sort((left, right) => {
      const leftScore = intentScore(left);
      const rightScore = intentScore(right);
      // Candidates WITH evidence outrank candidates without; among evidence
      // holders the best-record score decides.
      if (leftScore == null && rightScore == null) {
        // fall through to the legacy chain below
      } else if (leftScore == null) return 1;
      else if (rightScore == null) return -1;
      else if (rightScore !== leftScore) return rightScore - leftScore;
      const tagDiff =
        preferredTagScore(right, preferredTags) -
        preferredTagScore(left, preferredTags);
      if (tagDiff !== 0) return tagDiff;
      const stateDiff = compareCandidateStates(
        left && left.state,
        right && right.state,
      );
      if (stateDiff !== 0) return stateDiff;
      return candidateOutcomeScore(right) - candidateOutcomeScore(left);
    });
  } else {
    ranked = breadthPreservingIntentOrder(
      legacy,
      evidenceOrder,
      consumptionMode,
      breadthLimit,
      waveBatchSize,
    );
    const protectedPrefixSize = consumptionMode === "wave-ordered"
      ? waveBatchSize
      : breadthLimit;
    const protectedPrefix = new Set(
      legacy.slice(0, protectedPrefixSize).map((c) => c.id),
    );
    const injectedId = evidenceOrder.find((id) => !protectedPrefix.has(id)) || null;
    const injectedIndex = injectedId != null
      ? ranked.findIndex((c) => c.id === injectedId)
      : null;
    injection = {
      mode: "breadth-preserving",
      consumptionMode,
      injectedCandidateId: injectedId,
      injectedIndex: injectedIndex != null && injectedIndex >= 0 ? injectedIndex : null,
      protectedLegacyPrefixSize: protectedPrefixSize,
      firstEligibleWaveIndex: consumptionMode === "wave-ordered" ? 1 : null,
      waveBatchSize: consumptionMode === "wave-ordered" ? waveBatchSize : null,
      replacedSlot: injectedId != null && consumptionMode === "top-n-truncate"
        ? breadthLimit - 1 : null,
    };
  }
  const rankedIndexById = new Map(ranked.map((c, index) => [c.id, index]));
  const topBefore = legacy.length > 0 ? legacy[0].id : null;
  const topAfter = ranked.length > 0 ? ranked[0].id : null;
  const promotedCandidateIds = [];
  ranked.forEach((candidate, index) => {
    const before = legacyIndexById.get(candidate.id);
    if (before != null && index < before) promotedCandidateIds.push(candidate.id);
  });
  // Bounded per-candidate evidence details (top-N by intent rank, at most
  // candidateLimit entries) for site attribution. Compact deltas only.
  const evidenceDetailLimit = Math.max(1, number(config.evidenceDetailLimit, 8));
  const evidenceCandidates = ranked
    .filter((candidate) => bestEvidence.has(candidate.id))
    .slice(0, evidenceDetailLimit)
    .map((candidate) => {
      const evidence = bestEvidence.get(candidate.id);
      return {
        candidateId: candidate.id,
        intentScore: evidence.score,
        legacyRank: legacyIndexById.has(candidate.id)
          ? legacyIndexById.get(candidate.id) : null,
        intentRank: rankedIndexById.get(candidate.id),
        bestEvidenceActionKind: evidence.actionKind,
        bestEvidenceCategory: evidence.category,
        delta: evidence.delta,
        frontierDelta: evidence.frontierDelta,
      };
    });
  return {
    ranked,
    activated: true,
    telemetry: {
      failureClass: triggerFailure.failureClass,
      intentScanWallMs: Date.now() - startedAt,
      candidatesScored: list.length,
      candidatesWithEvidence: candidatesWithEvidence.length,
      intents: intents.length,
      topCandidateBefore: topBefore,
      topCandidateAfter: topAfter,
      promotedCandidateIds,
      injection,
    },
    evidenceCandidates,
  };
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

function qualityFloorMissing(candidate, qualityFloor) {
  if (!qualityFloor || !candidate || !candidate.state) return [];
  const state = candidate.state;
  const hero = summarizeHero(state);
  const expectedHero = qualityFloorHero(qualityFloor);
  const missing = [];
  const floorId = qualityFloor.floorId || qualityFloor.targetFloorId;
  if (
    qualityFloor.mustReachSameFloor !== false &&
    floorId &&
    state.floorId !== floorId
  ) {
    missing.push({
      field: "floorId",
      expected: floorId,
      actual: state.floorId,
    });
  }
  qualityFloorFields(qualityFloor).forEach((field) => {
    const expected = Number(expectedHero[field] || 0);
    if (expected > 0 && Number(hero[field] || 0) < expected) {
      missing.push({
        field: `hero.${field}`,
        expected,
        actual: Number(hero[field] || 0),
      });
    }
  });
  if (qualityFloor.sameLevelMustNotLoseExp !== false) {
    const expectedLv = Number(expectedHero.lv || 0);
    const expectedExp = Number(expectedHero.exp || 0);
    if (
      expectedLv > 0 &&
      expectedExp > 0 &&
      Number(hero.lv || 0) === expectedLv &&
      Number(hero.exp || 0) < expectedExp
    ) {
      missing.push({
        field: "hero.exp",
        expected: expectedExp,
        actual: Number(hero.exp || 0),
        reason: "same-level exp should not regress below quality floor",
      });
    }
  }
  return missing;
}

function candidateMeetsQualityFloor(candidate, qualityFloor) {
  return qualityFloorMissing(candidate, qualityFloor).length === 0;
}

function rankFinalCandidates(candidates, qualityFloor, objectiveSpec) {
  const ranked = (candidates || []).slice().sort((left, right) => {
    const leftPass = candidateMeetsQualityFloor(left, qualityFloor);
    const rightPass = candidateMeetsQualityFloor(right, qualityFloor);
    if (leftPass !== rightPass) return leftPass ? -1 : 1;
    if (objectiveSpec && objectiveSpec.explicit) {
      const objectiveDiff = objectiveSpec.compareCandidates(left, right);
      if (objectiveDiff !== 0) return objectiveDiff;
    }
    const stateDiff = compareCandidateStates(
      left && left.state,
      right && right.state,
    );
    if (stateDiff !== 0) return stateDiff;
    return candidateOutcomeScore(right) - candidateOutcomeScore(left);
  });
  return ranked;
}

function buildQualityFloorFailure(segment, candidates, qualityFloor, objectiveSpec) {
  const ranked = rankFinalCandidates(candidates || [], null, objectiveSpec);
  const best = ranked[0] || null;
  const missing = best
    ? qualityFloorMissing(best, qualityFloor)
    : [
        {
          field: "candidate",
          expected: "route meeting quality floor",
          actual: "none",
        },
      ];
  return {
    segmentId: segment && segment.id,
    label: segment && segment.label,
    found: false,
    failureClass: "route-quality-floor-not-met",
    failureReason: `best route does not meet quality floor${qualityFloor && qualityFloor.label ? `: ${qualityFloor.label}` : ""}`,
    bestSeen: best && compactState(best.state),
    missingGoalFields: missing,
    preferredCandidateTags: ["highest-hp", "highest-def", "best-combat"],
    recommendedRepair:
      "expand previous skyline and prefer higher-HP sustain/resource timing candidates before accepting this milestone",
    failurePropagation: {
      failureClass: "route-quality-floor-not-met",
      primaryFailureClass: "route-quality-floor-not-met",
      reason: "candidate route is below an explicit route-quality baseline",
      preferredCandidateTags: ["highest-hp", "highest-def", "best-combat"],
      recommendedNext: [
        "increase candidate limit for the previous milestone window",
        "rerun the window with route-quality baseline enabled",
        "preserve HP skyline candidates across floorFly/resource timing branches",
      ],
    },
    startCandidatesTried: candidates.length,
    candidates: compactSegmentCandidates(candidates),
    qualityFloor,
  };
}

function backtrackCandidateLimit(segment, config) {
  const base = numericOption(
    config && config.candidateLimit,
    numericOption(segment && segment.dp && segment.dp.goalSkylineLimit, 4),
  );
  return Math.max(
    base + 1,
    numericOption(config && config.backtrackCandidateLimit, base * 2),
    8,
  );
}

function backtrackDpOverrides(segment, config) {
  const dpConfig = (segment || {}).dp || {};
  return {
    stopOnFirstGoal: false,
    goalSkylineLimit: backtrackCandidateLimit(segment, config || {}),
    maxExpansions: numericOption(
      config && config.backtrackMaxExpansions,
      Math.max(
        numericOption(dpConfig.maxExpansions, 1000),
        numericOption(dpConfig.maxExpansions, 1000) * 2,
      ),
    ),
    maxRuntimeMs: numericOption(
      config && config.backtrackMaxRuntimeMs,
      Math.max(
        numericOption(dpConfig.maxRuntimeMs, 5000),
        numericOption(dpConfig.maxRuntimeMs, 5000) * 2,
      ),
    ),
  };
}

function tryRepairFromPreviousMilestone(
  simulator,
  segments,
  segmentIndex,
  history,
  failedExecution,
  config,
) {
  if ((config || {}).enableFailureBacktracking === false) return null;
  if (!Array.isArray(history) || history.length === 0 || segmentIndex <= 0)
    return null;
  const previous = history[history.length - 1];
  if (!previous || previous.repairExpanded) return null;
  const failedSummary = failedExecution && failedExecution.summary;
  const preferredTags =
    ((failedSummary || {}).failurePropagation || {}).preferredCandidateTags ||
    [];
  if (preferredTags.length === 0) return null;

  const previousSegment = previous.segment;
  const currentSegment = segments[segmentIndex];
  const expandedPrevious = runSegmentAgainstFrontier(
    simulator,
    previousSegment,
    previous.inputFrontier,
    config || {},
    withManualBudgetAuthority(config || {}, {
      candidateLimit: backtrackCandidateLimit(previousSegment, config || {}),
      dpOverrides: backtrackDpOverrides(previousSegment, config || {}),
      preserveSkylineRoles: true,
    }),
  );
  expandedPrevious.summary.backtrack = {
    mode: "expanded-previous-segment",
    triggeredBySegment: currentSegment.id,
    preferredCandidateTags: preferredTags,
    previousCandidateCount: previous.merged.length,
    expandedCandidateCount: expandedPrevious.merged.length,
  };
  if (expandedPrevious.merged.length === 0) {
    return { found: false, expandedPrevious, repairedCurrent: null };
  }
  if (expandedPrevious.memoryLimited) {
    return { found: false, expandedPrevious, repairedCurrent: null };
  }

  const rankedFrontier = rankCandidatesByPreferredTags(
    expandedPrevious.merged,
    preferredTags,
  ).slice(0, backtrackCandidateLimit(currentSegment, config || {}));
  const repairedCurrent = runSegmentAgainstFrontier(
    simulator,
    currentSegment,
    rankedFrontier,
    config || {},
    withManualBudgetAuthority(config || {}, {
      preserveSkylineRoles: true,
    }),
  );
  repairedCurrent.summary.backtrack = {
    mode: "retry-current-segment",
    repairedFromSegment: previousSegment.id,
    preferredCandidateTags: preferredTags,
    startCandidatesTried: rankedFrontier.length,
  };
  return {
    found: repairedCurrent.merged.length > 0,
    expandedPrevious,
    repairedCurrent,
  };
}

function toCompactLedgerExecution(execution) {
  if (!execution) return null;
  const summary = execution.summary || {};
  const compactAttempts = (summary.attempts || []).map((att) => ({
    attemptIndex: att.attemptIndex,
    startCandidateId: att.startCandidateId,
    found: att.found,
    goalCount: att.goalCount,
    missingGoalFields: att.missingGoalFields || [],
    diagnostics: {
      dp: att.diagnostics && att.diagnostics.dp ? {
        expansions: att.diagnostics.dp.expansions,
        frontierSize: att.diagnostics.dp.frontierSize,
        stoppedReason: att.diagnostics.dp.stoppedReason,
        searchOutcome: att.diagnostics.dp.searchOutcome,
        memory: att.diagnostics.dp.memory,
      } : {},
      failure: att.diagnostics && att.diagnostics.failure ? {
        failureClass: att.diagnostics.failure.failureClass,
        failureReason: att.diagnostics.failure.failureReason,
        missingGoalFields: att.diagnostics.failure.missingGoalFields,
        preferredCandidateTags: att.diagnostics.failure.preferredCandidateTags,
      } : {},
    },
  }));
  return {
    segment: { id: execution.segment ? execution.segment.id : summary.segmentId },
    // Iteration 5 Repair (P2, phase fidelity) – the stamped execution phase
    // survives compaction so ledger consumers never infer phase from index.
    executionPhase: execution.executionPhase || null,
    // Iteration 5 Repair (P1, pre-commit review) – compaction proof: a
    // first-class snapshot of the completion counters taken AT COMPACTION
    // TIME from the live candidateSliceTelemetry. appendExecutionCompletion
    // exposes it alongside its own readings so the production-path gate can
    // assert compact-before === compact-after; a compaction that loses
    // telemetry produces null proof entries that fail the gate immediately.
    compactCompletionProof: summary.candidateSliceTelemetry
      ? {
          finalFound: Number(summary.candidateSliceTelemetry.candidateSliceFinalFound || 0),
          finalComplete: Number(summary.candidateSliceTelemetry.candidateSliceFinalComplete || 0),
          finalPending: Number(summary.candidateSliceTelemetry.candidateSliceFinalPending || 0),
          terminalIncomplete: Number(summary.candidateSliceTelemetry.candidateSliceTerminalIncomplete || 0),
          searchComplete: Boolean(summary.candidateSliceTelemetry.candidateSliceSearchComplete),
        }
      : null,
    summary: {
      segmentId: summary.segmentId || (execution.segment ? execution.segment.id : null),
      attempts: compactAttempts,
      // Iteration 5 (P2 from `4246468` review) – the completion telemetry is
      // compact (counters only) and MUST survive compaction: adaptive
      // executions released for memory are still real executions whose final
      // candidate completion feeds run-wide exhaustion semantics. Dropping it
      // here previously produced searchComplete=null entries that downstream
      // checkers silently defaulted to 0/complete.
      candidateSliceTelemetry: summary.candidateSliceTelemetry || null,
      found: summary.found,
    },
    merged: [],
    inputFrontier: [],
    telemetry: execution.telemetry ? { ...execution.telemetry } : undefined,
  };
}

/**
 * PR-5.24d – Post-anchor repair-history hypothesis diversification helper.
 * Takes the re-expanded anchor execution and maps its retained output candidates
 * into distinct, bounded repaired-history hypotheses.
 *
 * Contract:
 * - Does NOT increase DP enumeration: consumes only the candidates already
 *   retained in expandedAnchor.merged.
 * - Upper bound: <= expandedAnchor.merged.length <= backtrackCandidateLimit.
 * - Single output equivalence: when expandedAnchor.merged has length <= 1,
 *   hypothesisId matches parentWaveId ('h-d${depth}w${waveIndex}').
 * - When length > 1, hypothesisId is suffixed with 'h${rank}'.
 * - Output descriptors carry:
 *   { hypothesisId, parentWaveId, depth, waveIndex, anchorOutputCandidateId, anchorOutputRank, anchorCandidate, replayFrontier: [candidate] }
 */
function buildRepairedHistoryHypotheses({
  depth,
  waveIndex,
  anchor,
  expandedAnchor,
  candidateLimit,
}) {
  const merged = expandedAnchor && Array.isArray(expandedAnchor.merged)
    ? expandedAnchor.merged
    : [];
  const limit = Math.max(1, number(candidateLimit, merged.length || 1));
  const retained = merged.slice(0, limit);
  const parentWaveId = `h-d${depth}w${waveIndex}`;
  if (retained.length === 0) {
    return [{
      hypothesisId: parentWaveId,
      parentWaveId,
      depth,
      waveIndex,
      anchorOutputCandidateId: null,
      anchorOutputRank: 0,
      anchorCandidate: null,
      replayFrontier: [],
    }];
  }
  return retained.map((candidate, rank) => {
    let stateKey = null;
    if (candidate && candidate.state) {
      try {
        stateKey = buildStateKey(candidate.state);
      } catch (_) {
        stateKey = null;
      }
    }
    let candidateId = null;
    if (candidate && candidate.id != null && String(candidate.id).length > 0) {
      candidateId = String(candidate.id);
    } else if (stateKey) {
      candidateId = stateKey;
    } else {
      candidateId = `cand-${rank}`;
    }
    const hypothesisId = retained.length === 1
      ? parentWaveId
      : `${parentWaveId}h${rank}`;
    return {
      hypothesisId,
      parentWaveId,
      depth,
      waveIndex,
      anchorOutputCandidateId: candidateId,
      anchorOutputStateKey: stateKey,
      anchorOutputRank: rank,
      anchorCandidate: candidate,
      replayFrontier: [candidate],
    };
  });
}

function tryAdaptiveCheckpointRepair(
  simulator,
  segments,
  segmentIndex,
  history,
  failedExecution,
  config,
) {
  if ((config || {}).searchIntent !== "adaptive-feasible") return null;
  if ((config || {}).enableFailureBacktracking === false) return null;
  if (!Array.isArray(history) || history.length === 0 || segmentIndex <= 0) return null;

  const failedSummary = failedExecution && failedExecution.summary;
  const failedAttempt = failedSummary && failedSummary.attempts && failedSummary.attempts[failedSummary.attempts.length - 1];
  const failedDiagnostics = (failedAttempt && failedAttempt.diagnostics) || {};
  const failure = failedDiagnostics.failure || (failedSummary && failedSummary.failurePropagation) || {};
  const preferredTags = failure.preferredCandidateTags || (failedSummary && failedSummary.failurePropagation && failedSummary.failurePropagation.preferredCandidateTags) || [];
  const missingGoalFields = failure.missingGoalFields || (failedAttempt && failedAttempt.missingGoalFields) || [];
  const triggerFailure = {
    segmentId: segments[segmentIndex].id,
    failureClass: failure.failureClass || (failedSummary && failedSummary.failureClass) || "frontier-exhausted",
    failureReason: failure.failureReason || (failedSummary && failedSummary.failureReason) || null,
    missingGoalFields,
    preferredCandidateTags: preferredTags,
    failurePropagation: failure.failurePropagation || (failedSummary && failedSummary.failurePropagation) || null,
  };

  // Iteration 6 – failure-conditioned adaptive investment. Only TRUSTED
  // COMPLETE failures may steer rollback toward investment opportunities.
  // floor-progress-blocked is only ever emitted for searchComplete===true
  // searches (Iteration 5 Repair 1 P1-A), so class eligibility here implies
  // completeness. Incomplete classes (floor-search-incomplete, budget-exhausted,
  // time/expansion/memory limits, unknown/not-run) must NEVER generate
  // investment signals.
  //
  // Iteration 6 Repair 2 – site-split gates + append-only event telemetry.
  //   enableFailureIntentAnchorRanking / enableFailureIntentReplayRanking
  //   control the two ranking sites independently; when neither is set the
  //   legacy master switch enableFailureIntentRanking applies (back-compat:
  //   unset sub-gates + unset master = enabled, exactly as HEAD).
  //   failureIntentRanking.events[] is append-only (one compact event per
  //   real ranking call) so attribution can rebuild the per-wave ranking
  //   history; the legacy anchor/replay summary slots are kept for existing
  //   consumers but attribution must read events[].
  //
  // PR-5.24b FINAL CLOSURE (P1) — the failure-intent ranking is now OFF by
  // default (opt-in). The final authority (run 33380984827) proved the
  // mechanism executes (injected + wave attempted) but shows no capability
  // benefit and a breadth/liveness regression (waves 4→2, pending 18→32),
  // so an unset configuration must reproduce Final Authority Arm A exactly:
  //
  //   enableFailureIntentRanking === true        → master opt-in; unset
  //     sub-gates follow the master (both on).
  //   enableFailureIntentAnchorRanking === true  → anchor only (master unset).
  //   enableFailureIntentReplayRanking === true  → replay only (master unset).
  //   enableFailureIntentRanking === true +
  //     enableFailureIntentReplayRanking === false → anchor on / replay off.
  //   everything unset                           → anchor=false, replay=false.
  //
  // The whole mechanism (scanner wiring, wave-ordered / top-n-truncate
  // injection, deterministic evidence ordering, append-only events, hard
  // mode) is retained as a gated experimental mechanism for future
  // scheduling/budget milestones.
  const masterIntentEnabled = (config || {}).enableFailureIntentRanking === true;
  const anchorIntentEnabled = (config || {}).enableFailureIntentAnchorRanking == null
    ? masterIntentEnabled
    : (config || {}).enableFailureIntentAnchorRanking !== false;
  const replayIntentEnabled = (config || {}).enableFailureIntentReplayRanking == null
    ? masterIntentEnabled
    : (config || {}).enableFailureIntentReplayRanking !== false;
  const FAILURE_INTENT_EVENT_LIMIT = 64;
  const failureIntentRanking = {
    anchor: { activated: false, telemetry: { reason: "not-reached" } },
    replay: { activated: false, telemetry: { reason: "not-reached" } },
    events: [],
  };
  const appendIntentEvent = (event) => {
    if (failureIntentRanking.events.length >= FAILURE_INTENT_EVENT_LIMIT) return;
    failureIntentRanking.events.push(event);
  };

  const maxDepth = Math.min(
    history.length,
    Math.max(1, numericOption(config && config.adaptiveBacktrackDepth, 3)),
  );
  const waveBatchSize = Math.max(1, numericOption(config && config.adaptiveWaveBatchSize, 1));
  const attempts = [];
  const depthSummaries = [];
  const ledgerExecutions = [];

  // PR-5.24c Iteration 1 — Budgeted Adaptive Repair Hypothesis Scheduling.
  //
  // A repair hypothesis = one anchor wave + its downstream replay chain. The
  // legacy scheduler lets each wave consume whatever remains of the global
  // wall, so ONE expensive hypothesis can starve all later ones (proven by
  // the PR-5.24b final authority: waves 4→2, pending 18→32). The budgeted
  // scheduler gives every NEW hypothesis a small bounded FIRST PROBE:
  //
  //   - wave 0 (legacy order) runs exactly as before, unmodified;
  //   - each later wave's anchor-expand + replay chain runs under a LOCAL
  //     deadline/expansion budget strictly tighter than the remaining global
  //     budget (min(probeBudget, remaining global));
  //   - when the probe expires, the hypothesis is left PROBE_PENDING (its
  //     remaining work is NOT declared impossible, NOT searchComplete, NOT
  //     EXHAUSTED) and the scheduler moves to the next hypothesis;
  //   - fairness (Iteration 1 contract): no hypothesis receives a second
  //     probe until every un-probed sibling at the same depth has had one —
  //     Iteration 1 performs at most one probe per hypothesis;
  //   - global budget / wall / RSS authority is unchanged and always wins;
  //   - scheduler is OFF by default (`enableBudgetedRepairScheduling ===
  //     true` opts in); disabled behavior is byte-equivalent to the legacy
  //     wave loop.
  const budgetedSchedulingEnabled =
    (config || {}).enableBudgetedRepairScheduling === true;
  const probeWallMs = Math.max(1, number((config || {}).adaptiveHypothesisProbeWallMs, 2000));
  const probeExpansions = Math.max(1, number((config || {}).adaptiveHypothesisProbeExpansions, 200));
  const REPAIR_SCHEDULING_EVENT_LIMIT = 64;
  const repairScheduling = {
    enabled: budgetedSchedulingEnabled,
    probeWallMs: budgetedSchedulingEnabled ? probeWallMs : null,
    probeExpansions: budgetedSchedulingEnabled ? probeExpansions : null,
    hypotheses: [],
    events: [],
  };
  const appendSchedulingEvent = (event) => {
    if (repairScheduling.events.length >= REPAIR_SCHEDULING_EVENT_LIMIT) return;
    repairScheduling.events.push(event);
  };
  // Fairness ledger: hypotheses that already consumed a probe, keyed by
  // `${depth}:${waveIndex}`; Iteration 1 never grants a second probe, so the
  // scheduler ordering contract is: strict round of first probes only.
  const probedHypotheses = new Set();
  const hypothesisTicket = (
    depth,
    waveIndex,
    anchorSegmentId,
    anchorCandidateIds,
    customHypothesisId,
    parentWaveId,
    anchorOutputCandidateId,
    anchorOutputRank,
    anchorOutputStateKey,
  ) => ({
    hypothesisId: customHypothesisId || `h-d${depth}w${waveIndex}`,
    parentWaveId: parentWaveId || `h-d${depth}w${waveIndex}`,
    depth,
    waveIndex,
    anchorSegmentId,
    anchorInputCandidateIds: anchorCandidateIds,
    anchorOutputCandidateId: anchorOutputCandidateId != null ? anchorOutputCandidateId : null,
    anchorOutputStateKey: anchorOutputStateKey != null ? anchorOutputStateKey : null,
    anchorOutputRank: anchorOutputRank != null ? anchorOutputRank : 0,
    nextReplaySegmentIndex: null,
    status: "PROBE_PENDING",
    consumedWallMs: 0,
    consumedExpansions: 0,
    anchorGenerationExpansions: 0,
    historyProbeExpansions: 0,
    anchorGenerationWallMs: 0,
    historyProbeWallMs: 0,
    probeCount: 0,
    lastProgress: null,
    stopReason: null,
    // PR-5.24c Iteration 2 – progress-gated continuation fields.
    progressClass: null,
    progressEvidence: null,
    continuationEligible: false,
    continuationDecision: null,
    continuationMode: null,
    grantHistory: [],
  });

  // PR-5.24c Iteration 2 – progress-gated second-grant scheduling.
  // Strictly opt-in; requires the Iteration 1 scheduler to be enabled too.
  const continuationEnabled =
    budgetedSchedulingEnabled &&
    (config || {}).enableBudgetedRepairContinuation === true;
  const continuationWallMs = Math.max(1, number(
    (config || {}).adaptiveHypothesisContinuationWallMs,
    probeWallMs * 2,
  ));
  const continuationExpansions = Math.max(1, number(
    (config || {}).adaptiveHypothesisContinuationExpansions,
    probeExpansions * 2,
  ));
  const continuationMaxPerDepth = Math.max(1, number(
    (config || {}).adaptiveHypothesisContinuationMaxPerDepth,
    2,
  ));
  repairScheduling.continuationEnabled = continuationEnabled;
  repairScheduling.continuationWallMs = continuationEnabled ? continuationWallMs : null;
  repairScheduling.continuationExpansions = continuationEnabled ? continuationExpansions : null;

  // Compact goal-progress projection for a state against a segment — reuses
  // the existing goal dependency graph projector (no new score invention).
  const projectGoalProgressFor = (state, segment) => {
    if (!state) return null;
    try {
      // Repair 1 (P1-D): normalize to the COMPACT projection whitelist so
      // local and isolated evidence carry exactly the same IPC-safe fields.
      return compactProgressProjection(
        projectSegmentGoalProgress(simulator.project, state, segment),
      );
    } catch (error) {
      return null;
    }
  };
  // Discrete, weightless progress comparator over the structured projection:
  // fixed lexicographic order per the authorized semantics. Returns >0 when
  // `after` is strictly better than `before`, 0 when equal, null when the
  // comparison is unavailable.
  // Repair 1: delegated to the shared lib/segment-progress.js helper (the
  // same pure function is used by the isolated worker for compact cross-
  // process progress evidence).
  const compareGoalProgress = compareProgressProjections;
  // Discrete progress classification: SEGMENT_ADVANCE > WITHIN_SEGMENT_PROGRESS
  // > NO_MEASURABLE_PROGRESS. No scalar scores anywhere.
  // Follow-up A: the within-segment comparison uses the HISTORICAL baseline
  // (original history's anchor output) as `before` and the best of the
  // repaired anchor / replay progress as `after`.
  const classifyProgress = (ticket, evidence) => {
    const completed = evidence && evidence.replaySegmentsCompleted || 0;
    if (completed >= 1) return "SEGMENT_ADVANCE";
    const cmp = compareGoalProgress(
      evidence && evidence.historicalAnchorProgress,
      evidence && evidence.goalProgressAfter,
    );
    if (cmp != null && cmp > 0) return "WITHIN_SEGMENT_PROGRESS";
    return "NO_MEASURABLE_PROGRESS";
  };
  // Fail-closed continuation eligibility: ONLY probe-limited tickets with a
  // clean global context and measurable progress may apply. Every other
  // stop class (memory/resource/global/exhausted/headroom/complete) is
  // explicitly NOT eligible.
  const isContinuationEligible = (ticket, globalStopReason) => {
    if (!continuationEnabled) return false;
    if (!ticket) return false;
    if (ticket.status !== "PROBE_PENDING") return false;
    if (ticket.probeCount !== 1) return false;
    if (ticket.stopReason !== "probe-limited") return false;
    if (globalStopReason) return false;
    if (ticket.progressClass === "NO_MEASURABLE_PROGRESS") return false;
    if (ticket.progressClass !== "SEGMENT_ADVANCE" &&
        ticket.progressClass !== "WITHIN_SEGMENT_PROGRESS") return false;
    return true;
  };
  // Local probe budget for a wave: strictly tighter than the remaining
  // global budget. PR-5.24c Repair 1 (P1-3): when the scheduler is ENABLED
  // but no strictly-tighter probe can be carved out of the remaining global
  // budget, the result is { insufficientHeadroom: true } — the caller must
  // NOT fall back to a full-global legacy wave; it leaves the hypothesis
  // PROBE_PENDING and moves on. (When the global budget is already
  // exhausted, null is returned so the global authority handles the stop.)
  // Wave 0 takes part in the first-probe round like every other hypothesis
  // (cloud-revised contract): legacy ORDER is preserved — wave 0 is simply
  // the first hypothesis to receive its bounded probe.
  const probeBudgetForWave = () => {
    if (!budgetedSchedulingEnabled) return null;
    const globalBudget = config && config.globalBudget;
    if (!globalBudget) return { insufficientHeadroom: true };
    const now = Date.now();
    const remainingWallMs = globalBudget.deadlineMs != null &&
      Number.isFinite(Number(globalBudget.deadlineMs))
      ? Math.max(0, globalBudget.deadlineMs - now)
      : null;
    const remainingExpansions = globalBudget.requestedExpansions > 0
      ? Math.max(0, globalBudget.requestedExpansions - globalBudget.consumedExpansions)
      : null;
    if ((remainingWallMs != null && remainingWallMs <= 0) ||
        (remainingExpansions != null && remainingExpansions <= 0)) {
      return null; // global budget exhausted — global authority takes over
    }
    const localWallMs = remainingWallMs != null
      ? Math.min(probeWallMs, remainingWallMs)
      : probeWallMs;
    const localExpansions = remainingExpansions != null
      ? Math.min(probeExpansions, remainingExpansions)
      : probeExpansions;
    // Strictly tighter than remaining global budget in at least one axis;
    // otherwise there is insufficient headroom for a bounded probe.
    if (localWallMs >= (remainingWallMs != null ? remainingWallMs : Infinity) &&
        localExpansions >= (remainingExpansions != null ? remainingExpansions : Infinity)) {
      return { insufficientHeadroom: true };
    }
    return { wallMs: localWallMs, deadlineMs: now + localWallMs, expansions: localExpansions };
  };

  for (let depth = 1; depth <= maxDepth; depth += 1) {
    const anchorHistoryIndex = history.length - depth;
    const anchor = history[anchorHistoryIndex];
    if (!anchor || !anchor.segment || !Array.isArray(anchor.inputFrontier) || anchor.inputFrontier.length === 0) continue;

    const anchorIntentRanking = rankCandidatesByFailureIntent(
      simulator,
      anchor.inputFrontier,
      triggerFailure,
      preferredTags,
      {
        phase: "adaptive-expand",
        enabled: anchorIntentEnabled,
        consumptionMode: "wave-ordered",
        waveBatchSize,
        candidateLimit: backtrackCandidateLimit(anchor.segment, config || {}),
        evidenceDetailLimit: backtrackCandidateLimit(anchor.segment, config || {}),
      },
    );
    failureIntentRanking.anchor = {
      activated: anchorIntentRanking.activated,
      telemetry: anchorIntentRanking.telemetry,
    };
    appendIntentEvent({
      phase: "adaptive-expand",
      depth,
      waveIndex: 0,
      anchorHistoryIndex,
      replaySegmentId: null,
      inputCandidateCount: anchor.inputFrontier.length,
      candidateLimit: backtrackCandidateLimit(anchor.segment, config || {}),
      activated: anchorIntentRanking.activated,
      reason: anchorIntentRanking.activated
        ? null
        : (anchorIntentRanking.telemetry && anchorIntentRanking.telemetry.reason) || null,
      topCandidateBefore: anchorIntentRanking.telemetry.topCandidateBefore || null,
      topCandidateAfter: anchorIntentRanking.telemetry.topCandidateAfter || null,
      promotedCandidateIds: anchorIntentRanking.telemetry.promotedCandidateIds || [],
      selectedCandidateIds: anchorIntentRanking.ranked
        .slice(0, waveBatchSize)
        .map((candidate) => candidate.id),
      consumptionMode: anchorIntentRanking.telemetry.injection
        ? anchorIntentRanking.telemetry.injection.consumptionMode : null,
      injectedCandidateId: anchorIntentRanking.telemetry.injection
        ? anchorIntentRanking.telemetry.injection.injectedCandidateId : null,
      injectedIndex: anchorIntentRanking.telemetry.injection
        ? anchorIntentRanking.telemetry.injection.injectedIndex : null,
      protectedLegacyPrefixSize: anchorIntentRanking.telemetry.injection
        ? anchorIntentRanking.telemetry.injection.protectedLegacyPrefixSize : null,
      firstEligibleWaveIndex: anchorIntentRanking.telemetry.injection
        ? anchorIntentRanking.telemetry.injection.firstEligibleWaveIndex : null,
      waveBatchSize,
      rankedCandidateIds: anchorIntentRanking.ranked
        .slice(0, Math.min(anchorIntentRanking.ranked.length, 2 * waveBatchSize + 4))
        .map((candidate) => candidate.id),
      evidenceCandidates: anchorIntentRanking.evidenceCandidates || [],
    });
    const rankedInputFrontier = anchorIntentRanking.ranked;

    const totalWaves = Math.max(1, Math.ceil(rankedInputFrontier.length / waveBatchSize));
    let depthWavesAttempted = 0;
    let depthWavesCompleted = 0;
    let depthDownstreamReplayCount = 0;
    let depthStopReason = null;
    let depthAnchorExpandedCandidates = 0;
    let depthGoalReached = false;

    for (let waveIndex = 0; waveIndex < totalWaves; waveIndex += 1) {
      const waveInputCandidates = rankedInputFrontier.slice(
        waveIndex * waveBatchSize,
        (waveIndex + 1) * waveBatchSize,
      );
      if (waveInputCandidates.length === 0) continue;

      // PR-5.24c – budgeted hypothesis scheduling for this wave.
      const hypothesisKey = `${depth}:${waveIndex}`;
      const waveProbeBudget = probeBudgetForWave();
      // P1-3 fail-closed: enabled scheduler + insufficient probe headroom
      // must NEVER degrade into a full-global legacy wave. The hypothesis
      // stays PROBE_PENDING and the scheduler moves on.
      if (budgetedSchedulingEnabled && waveProbeBudget &&
          waveProbeBudget.insufficientHeadroom === true) {
        const pendingTicket = hypothesisTicket(
          depth,
          waveIndex,
          anchor.segment.id,
          waveInputCandidates.map((candidate) => candidate.id),
        );
        pendingTicket.status = "PROBE_PENDING";
        pendingTicket.stopReason = "insufficient-probe-headroom";
        pendingTicket.progressClass = "NO_MEASURABLE_PROGRESS";
        pendingTicket.continuationDecision = "insufficient-headroom";
        repairScheduling.hypotheses.push(pendingTicket);
        appendSchedulingEvent({
          hypothesisId: pendingTicket.hypothesisId,
          probeIndex: 0,
          grantKind: "first-probe",
          depth,
          anchorCandidateIds: pendingTicket.anchorInputCandidateIds,
          startReplayIndex: anchorHistoryIndex + 1,
          endReplayIndex: anchorHistoryIndex,
          allocatedWallMs: null,
          allocatedExpansions: null,
          consumedWallMs: 0,
          consumedExpansions: 0,
          progressBefore: null,
          progressAfter: { waveOutcome: "not-started" },
          yieldReason: "insufficient-probe-headroom",
          pendingAfterProbe: true,
          globalStopReason: (config.globalBudget && config.globalBudget.stoppedReason) || null,
        });
        continue;
      }
      const schedulingWave = budgetedSchedulingEnabled && waveProbeBudget != null;
      // Fairness: Iteration 1 grants at most one probe per hypothesis; if
      // this hypothesis somehow already probed (contract guard), skip to the
      // next wave rather than double-investing.
      if (schedulingWave && probedHypotheses.has(hypothesisKey)) continue;
      if (schedulingWave) probedHypotheses.add(hypothesisKey);

      depthWavesAttempted += 1;
      const waveStartedAt = Date.now();
      const waveStartExpansions = config && config.globalBudget ? config.globalBudget.consumedExpansions : 0;
      let waveExecutions = [];
      // Local probe budget rides the dedicated probeDeadlineMs /
      // probeExpansionCap fields: the per-attempt scheduler enforces them
      // WITHOUT conflating them with the global deadline/expansion contract.
      // dpOverrides carry the same cap so the per-attempt fair slice can
      // never exceed the probe allocation either.
      const anchorConfig = {
        ...(config || {}),
        stopOnFirstGoal: undefined,
        ...(schedulingWave && waveProbeBudget
          ? {
              probeDeadlineMs: waveProbeBudget.deadlineMs,
              probeExpansionCap: waveStartExpansions + waveProbeBudget.expansions,
              maxExpansions: Math.min(
                number((config || {}).maxExpansions, waveProbeBudget.expansions),
                waveProbeBudget.expansions,
              ),
            }
          : {}),
      };

      let expandedAnchor = runSegmentAgainstFrontier(
        simulator,
        anchor.segment,
        waveInputCandidates,
        {
          ...anchorConfig,
          segmentIndex: anchorHistoryIndex,
          segmentTotal: segments.length,
          goalDependencySegments: segments.slice(anchorHistoryIndex),
        },
        withManualBudgetAuthority(anchorConfig, {
          candidateLimit: backtrackCandidateLimit(anchor.segment, config || {}),
          dpOverrides: backtrackDpOverrides(anchor.segment, config || {}),
          preserveSkylineRoles: true,
        }),
      );
      expandedAnchor.summary.backtrack = {
        mode: "adaptive-checkpoint-expand",
        depth,
        waveIndex,
        triggeredBySegment: segments[segmentIndex].id,
        preferredCandidateTags: preferredTags,
        previousCandidateCount: anchor.merged ? anchor.merged.length : 0,
        expandedCandidateCount: expandedAnchor.merged ? expandedAnchor.merged.length : 0,
      };
      // Iteration 5 Repair (P2, phase fidelity) – the execution itself carries
      // its canonical ledger phase so the run-wide ledger never has to guess
      // from array position (multi-wave repairs would otherwise mislabel
      // wave1's expand entry as an adaptive-replay).
      expandedAnchor.executionPhase = "adaptive-expand";
      waveExecutions.push(expandedAnchor);

      const anchorGenerationExpansions =
        (config && config.globalBudget ? config.globalBudget.consumedExpansions : 0) -
        waveStartExpansions;
      const anchorGenerationWallMs = Date.now() - waveStartedAt;
      const expandedAnchorCandidatesCount = expandedAnchor && expandedAnchor.summary && expandedAnchor.summary.attempts
        ? expandedAnchor.summary.attempts.reduce((sum, a) => sum + (a.goalCount || (a.found ? 1 : 0)), 0)
        : 0;
      depthAnchorExpandedCandidates += expandedAnchorCandidatesCount;

      const firstReplaySegmentForProgress =
        segments[anchorHistoryIndex + 1] &&
        segments[anchorHistoryIndex + 1] !== anchor.segment
          ? segments[anchorHistoryIndex + 1]
          : anchor.segment;
      let historicalAnchorProgress = null;
      if (budgetedSchedulingEnabled && Array.isArray(anchor.merged) && anchor.merged.length > 0) {
        historicalAnchorProgress = bestFrontierGoalProgress(
          anchor.merged,
          (state) => projectSegmentGoalProgress(
            simulator.project, state, firstReplaySegmentForProgress),
        );
      }

      // PR-5.24d – post-anchor hypothesis diversification: split retained
      // output candidates into distinct history hypotheses.
      const historyDescriptors = budgetedSchedulingEnabled
        ? buildRepairedHistoryHypotheses({
            depth,
            waveIndex,
            anchor,
            expandedAnchor,
            candidateLimit: backtrackCandidateLimit(anchor.segment, config || {}),
          })
        : [{
            hypothesisId: `h-d${depth}w${waveIndex}`,
            parentWaveId: `h-d${depth}w${waveIndex}`,
            depth,
            waveIndex,
            anchorOutputCandidateId: null,
            anchorOutputRank: 0,
            anchorCandidate: null,
            replayFrontier: expandedAnchor.merged,
          }];

      let attemptWaveOutcome = null;
      let lastWaveStopReason = null;
      let lastFailedAtIndex = null;
      let lastReplaySegments = [];
      let waveFinalFrontier = null;
      let memoryExecution = expandedAnchor.memoryLimited ? expandedAnchor : null;
      let memorySegmentIndex = expandedAnchor.memoryLimited ? anchorHistoryIndex : null;

      for (const historyDesc of historyDescriptors) {
        let ticket = null;
        if (budgetedSchedulingEnabled) {
          ticket = hypothesisTicket(
            depth,
            waveIndex,
            anchor.segment.id,
            waveInputCandidates.map((candidate) => candidate.id),
            historyDesc.hypothesisId,
            historyDesc.parentWaveId,
            historyDesc.anchorOutputCandidateId,
            historyDesc.anchorOutputRank,
            historyDesc.anchorOutputStateKey,
          );
          ticket.anchorGenerationExpansions = anchorGenerationExpansions;
          ticket.anchorGenerationExpansions = anchorGenerationExpansions;
          ticket.anchorGenerationWallMs = anchorGenerationWallMs;
          ticket.consumedExpansions = anchorGenerationExpansions;
          ticket.consumedWallMs = anchorGenerationWallMs;
          repairScheduling.hypotheses.push(ticket);
        }

        // PR-5.24d – single repaired history candidate projection.
        let repairedAnchorProgress = null;
        if (ticket && historyDesc.anchorCandidate) {
          const candState = historyDesc.anchorCandidate.state || historyDesc.anchorCandidate;
          if (candState) {
            repairedAnchorProgress = compactProgressProjection(
              projectSegmentGoalProgress(simulator.project, candState, firstReplaySegmentForProgress),
            );
          }
        } else if (ticket && Array.isArray(historyDesc.replayFrontier) && historyDesc.replayFrontier.length > 0) {
          repairedAnchorProgress = bestFrontierGoalProgress(
            historyDesc.replayFrontier,
            (state) => projectSegmentGoalProgress(simulator.project, state, firstReplaySegmentForProgress),
          );
        }
        let goalProgressAfter = repairedAnchorProgress;
        let replayBestProgress = null;

        if (ticket) {
          ticket.nextReplaySegmentIndex = anchorHistoryIndex + 1;
        }

        let historyRepairFrontier = historyDesc.replayFrontier;
        let failedAtIndex = historyRepairFrontier && historyRepairFrontier.length > 0 ? null : anchorHistoryIndex;

        // PR-5.24d Iteration 1 Repair 2: EACH repaired history gets a FRESH, INDEPENDENT
        // bounded probe budget from the remaining global budget (not a remainder of the anchor grant).
        const historyProbeBudget = budgetedSchedulingEnabled ? probeBudgetForWave() : null;
        const globalStopBeforeHistory = (config.globalBudget && config.globalBudget.stoppedReason) || null;

        // Insufficient headroom or global budget exhausted before first probe starts:
        if (budgetedSchedulingEnabled && (
            historyProbeBudget == null ||
            historyProbeBudget.insufficientHeadroom === true ||
            globalStopBeforeHistory != null)) {
          if (ticket) {
            ticket.probeCount = 0;
            ticket.status = "PROBE_PENDING";
            ticket.historyProbeExpansions = 0;
            ticket.historyProbeWallMs = 0;
            ticket.stopReason = globalStopBeforeHistory || (historyProbeBudget && historyProbeBudget.insufficientHeadroom
              ? "insufficient-probe-headroom"
              : "global-budget-exhausted");
            ticket.progressClass = "NO_MEASURABLE_PROGRESS";
            ticket.continuationEligible = false;
            ticket.continuationDecision = historyProbeBudget && historyProbeBudget.insufficientHeadroom
              ? "insufficient-headroom"
              : "not-eligible";
            ticket.lastProgress = {
              waveOutcome: ticket.stopReason,
              replaySegmentsEntered: 0,
              replaySegmentsCompleted: 0,
              failedAtSegmentId: failedAtIndex == null ? null : segments[failedAtIndex].id,
              goalReached: false,
            };
            ticket.progressEvidence = {
              replaySegmentsCompleted: 0,
              nextReplaySegmentIndex: ticket.nextReplaySegmentIndex,
              historicalAnchorProgress,
              repairedAnchorProgress,
              replayBestProgress: null,
              goalProgressAfter,
            };
            appendSchedulingEvent({
              hypothesisId: ticket.hypothesisId,
              parentWaveId: ticket.parentWaveId,
              probeIndex: 0,
              grantKind: "first-probe",
              depth,
              anchorCandidateIds: ticket.anchorInputCandidateIds,
              anchorOutputCandidateId: ticket.anchorOutputCandidateId,
              anchorOutputStateKey: ticket.anchorOutputStateKey,
              anchorOutputRank: ticket.anchorOutputRank,
              startReplayIndex: anchorHistoryIndex + 1,
              endReplayIndex: anchorHistoryIndex,
              nextReplaySegmentIndex: ticket.nextReplaySegmentIndex,
              allocatedWallMs: null,
              allocatedExpansions: null,
              consumedWallMs: ticket.consumedWallMs,
              consumedExpansions: ticket.consumedExpansions,
              anchorGenerationExpansions: ticket.anchorGenerationExpansions,
              historyProbeExpansions: 0,
              progressBefore: historicalAnchorProgress,
              repairedAnchorProgress,
              replayBestProgress: null,
              progressAfter: ticket.lastProgress,
              progressClass: ticket.progressClass,
              continuationEligible: false,
              yieldReason: "insufficient-probe-headroom",
              pendingAfterProbe: true,
              globalStopReason: globalStopBeforeHistory,
            });
          }
          continue;
        }

        if (ticket) {
          probedHypotheses.add(ticket.hypothesisId);
        }

        const historyProbeStartExpansions = config && config.globalBudget
          ? config.globalBudget.consumedExpansions : 0;
        const historyProbeStartWallMs = Date.now();
        const historyProbeExpansionCap = historyProbeBudget
          ? historyProbeStartExpansions + historyProbeBudget.expansions
          : Infinity;
        const historyProbeDeadlineMs = historyProbeBudget
          ? historyProbeStartWallMs + historyProbeBudget.wallMs
          : Infinity;

        let completedReplayCount = 0;
        let probeExpired = false;
        const replaySegments = [];
        for (
          let replayIndex = anchorHistoryIndex + 1;
          !probeExpired && historyRepairFrontier && historyRepairFrontier.length > 0 && replayIndex <= segmentIndex;
          replayIndex += 1
        ) {
          const replaySegment = segments[replayIndex];
          replaySegments.push(replaySegment);
          depthDownstreamReplayCount += 1;
          const replayProbeExpiredBefore = (() => {
            if (!budgetedSchedulingEnabled || !historyProbeBudget) return false;
            const consumedByHistoryProbe =
              (config && config.globalBudget ? config.globalBudget.consumedExpansions : 0) -
              historyProbeStartExpansions;
            return Date.now() >= historyProbeDeadlineMs ||
              consumedByHistoryProbe >= historyProbeBudget.expansions;
          })();
          const replayIntentLimit = backtrackCandidateLimit(replaySegment, config || {});
          const replayIntentRanking = rankCandidatesByFailureIntent(
            simulator,
            historyRepairFrontier,
            triggerFailure,
            preferredTags,
            {
              phase: "adaptive-replay",
              enabled: replayIntentEnabled,
              consumptionMode: "top-n-truncate",
              candidateLimit: replayIntentLimit,
              evidenceDetailLimit: replayIntentLimit,
            },
          );
          if (replayIntentRanking.activated) {
            failureIntentRanking.replay = {
              activated: true,
              telemetry: replayIntentRanking.telemetry,
            };
          }
          appendIntentEvent({
            phase: "adaptive-replay",
            depth,
            waveIndex,
            anchorHistoryIndex,
            replaySegmentId: replaySegment.id,
            inputCandidateCount: historyRepairFrontier.length,
            candidateLimit: replayIntentLimit,
            activated: replayIntentRanking.activated,
            reason: replayIntentRanking.activated
              ? null
              : (replayIntentRanking.telemetry && replayIntentRanking.telemetry.reason) || null,
            topCandidateBefore: replayIntentRanking.telemetry.topCandidateBefore || null,
            topCandidateAfter: replayIntentRanking.telemetry.topCandidateAfter || null,
            promotedCandidateIds: replayIntentRanking.telemetry.promotedCandidateIds || [],
            selectedCandidateIds: replayIntentRanking.ranked
              .slice(0, replayIntentLimit)
              .map((candidate) => candidate.id),
            evidenceCandidates: replayIntentRanking.evidenceCandidates || [],
          });
          const rankedFrontier = replayIntentRanking.ranked.slice(
            0,
            replayIntentLimit,
          );
          const replayRunConfig = budgetedSchedulingEnabled && historyProbeBudget
            ? {
                ...(config || {}),
                probeDeadlineMs: historyProbeDeadlineMs,
                probeExpansionCap: historyProbeExpansionCap,
                maxExpansions: Math.min(
                  number((config || {}).maxExpansions, historyProbeBudget.expansions),
                  historyProbeBudget.expansions,
                ),
              }
            : config || {};
          const replayed = runSegmentAgainstFrontier(
            simulator,
            replaySegment,
            rankedFrontier,
            {
              ...replayRunConfig,
              segmentIndex: replayIndex,
              segmentTotal: segments.length,
              goalDependencySegments: segments.slice(replayIndex),
            },
            withManualBudgetAuthority(replayRunConfig, {
              candidateLimit: backtrackCandidateLimit(replaySegment, config || {}),
              preserveSkylineRoles: true,
            }),
          );
          replayed.summary.backtrack = {
            mode: "adaptive-checkpoint-replay",
            depth,
            waveIndex,
            repairedFromSegment: anchor.segment.id,
            triggeredBySegment: segments[segmentIndex].id,
            preferredCandidateTags: preferredTags,
            startCandidatesTried: rankedFrontier.length,
          };
          replayed.executionPhase = "adaptive-replay";
          waveExecutions.push(replayed);
          historyRepairFrontier = replayed.merged;

          if (ticket && Array.isArray(replayed.attempts)) {
            let bestAfterProjection = null;
            replayed.attempts.forEach((att) => {
              if (!att) return;
              let projection = null;
              if (att.bestProgressProjection) {
                projection = att.bestProgressProjection;
              } else if (att.bestProgress) {
                projection = projectGoalProgressFor(att.bestProgress, replaySegment);
              }
              if (!projection) return;
              if (!bestAfterProjection) {
                bestAfterProjection = projection;
                return;
              }
              const cmp = compareGoalProgress(bestAfterProjection, projection);
              if (cmp != null && cmp > 0) bestAfterProjection = projection;
            });
            if (bestAfterProjection) {
              goalProgressAfter = bestOfProgressProjections(
                goalProgressAfter,
                bestAfterProjection,
              );
              replayBestProgress = bestOfProgressProjections(
                replayBestProgress,
                bestAfterProjection,
              );
            }
          }

          const replayProbeExpiredAfter = budgetedSchedulingEnabled && historyProbeBudget
            ? (Date.now() >= historyProbeDeadlineMs ||
               ((config && config.globalBudget ? config.globalBudget.consumedExpansions : 0) -
                historyProbeStartExpansions) >= historyProbeBudget.expansions)
            : false;
          const replayGlobalStopReason =
            (config && config.globalBudget && config.globalBudget.stoppedReason) || null;
          const replayResourceInterrupted =
            Boolean(replayed.memoryLimited) ||
            replayGlobalStopReason === "rss-limit" ||
            replayGlobalStopReason === "heap-limit" ||
            replayGlobalStopReason === "time-limit" ||
            replayGlobalStopReason === "expansion-limit";
          const replayProbeCompleted = isReplayDeterminatelyComplete(replayed, {
            probeExpiredBefore: replayProbeExpiredBefore,
            probeExpiredAfter: replayProbeExpiredAfter,
            resourceInterrupted: replayResourceInterrupted,
          });
          if (replayProbeCompleted) {
            completedReplayCount += 1;
            if (ticket) ticket.nextReplaySegmentIndex = replayIndex + 1;
          } else {
            if (ticket) ticket.nextReplaySegmentIndex = replayIndex;
          }
          if (replayed.memoryLimited) {
            memoryExecution = replayed;
            memorySegmentIndex = replayIndex;
            if (!historyRepairFrontier || historyRepairFrontier.length === 0) break;
          } else if (!historyRepairFrontier || historyRepairFrontier.length === 0) {
            failedAtIndex = replayIndex;
            break;
          }
          if (budgetedSchedulingEnabled && historyProbeBudget) {
            const consumedByHistoryProbe =
              (config && config.globalBudget ? config.globalBudget.consumedExpansions : 0) -
              historyProbeStartExpansions;
            if (Date.now() >= historyProbeDeadlineMs ||
                consumedByHistoryProbe >= historyProbeBudget.expansions) {
              probeExpired = true;
              break;
            }
          }
        }

        if (budgetedSchedulingEnabled && historyProbeBudget && !probeExpired) {
          const consumedByHistoryProbe =
            (config && config.globalBudget ? config.globalBudget.consumedExpansions : 0) -
            historyProbeStartExpansions;
          if (Date.now() >= historyProbeDeadlineMs ||
              consumedByHistoryProbe >= historyProbeBudget.expansions) {
            probeExpired = true;
          }
        }

        const historyProbeExpansions = (config && config.globalBudget ? config.globalBudget.consumedExpansions : 0) - historyProbeStartExpansions;
        const historyProbeWallMs = Date.now() - historyProbeStartWallMs;
        const historyGoalReached = Boolean(
          historyRepairFrontier && historyRepairFrontier.length > 0 &&
          replaySegments.length === (segmentIndex - anchorHistoryIndex) &&
          completedReplayCount === replaySegments.length
        );
        if (historyGoalReached) {
          depthGoalReached = true;
        }

        const waveStopReason = memoryExecution
          ? (memoryExecution.memoryStopReason || "memory-limit")
          : (config.globalBudget && config.globalBudget.stoppedReason) || null;
        let preReleaseRssMb = Math.round((process.memoryUsage().rss / 1048576) * 10) / 10;
        let postGcRssMb = preReleaseRssMb;
        let memoryRecovered = true;
        const waveResourceInterrupted =
          waveStopReason === "rss-limit" ||
          waveStopReason === "heap-limit" ||
          waveStopReason === "time-limit" ||
          waveStopReason === "expansion-limit";
        let waveOutcome = classifyAdaptiveHypothesisOutcome({
          goalReached: historyGoalReached,
          probeExpired,
          resourceInterrupted: waveResourceInterrupted,
          enteredReplays: replaySegments.length,
          completedReplays: completedReplayCount,
          emptyFrontier: !historyRepairFrontier || historyRepairFrontier.length === 0,
          anchorExecution: expandedAnchor,
          globalStopReason: waveStopReason,
        });
        if (
          !historyGoalReached &&
          waveOutcome === "resource-limited" &&
          (waveStopReason === "time-limit" || waveStopReason === "expansion-limit")
        ) {
          waveOutcome = waveStopReason === "time-limit" ? "time-limited" : "expansion-limited";
        }

        if (ticket) {
          ticket.consumedWallMs = anchorGenerationWallMs + historyProbeWallMs;
          ticket.consumedExpansions = anchorGenerationExpansions + historyProbeExpansions;
          ticket.anchorGenerationExpansions = anchorGenerationExpansions;
          ticket.historyProbeExpansions = historyProbeExpansions;
          ticket.anchorGenerationWallMs = anchorGenerationWallMs;
          ticket.historyProbeWallMs = historyProbeWallMs;
          ticket.probeCount = schedulingWave ? 1 : 0;
          ticket.stopReason = waveOutcome;
          if (historyGoalReached || waveOutcome === "exhausted") {
            ticket.status = "PROBE_COMPLETE_OR_GOAL";
          } else {
            ticket.status = "PROBE_PENDING";
          }
          ticket.lastProgress = {
            waveOutcome,
            replaySegmentsEntered: replaySegments.length,
            replaySegmentsCompleted: completedReplayCount,
            failedAtSegmentId: failedAtIndex == null ? null : segments[failedAtIndex].id,
            goalReached: historyGoalReached,
          };
          ticket.progressEvidence = {
            replaySegmentsCompleted: completedReplayCount,
            nextReplaySegmentIndex: ticket.nextReplaySegmentIndex,
            historicalAnchorProgress,
            repairedAnchorProgress,
            replayBestProgress,
            goalProgressAfter,
          };
          ticket.progressClass = classifyProgress(ticket, ticket.progressEvidence);
          const globalStopAfterProbe = (config.globalBudget && config.globalBudget.stoppedReason) || null;
          ticket.continuationEligible = isContinuationEligible(ticket, globalStopAfterProbe);
          ticket.continuationDecision = ticket.continuationEligible
            ? "eligible"
            : (ticket.stopReason === "probe-limited" && !globalStopAfterProbe
              ? "no-measurable-progress"
              : ticket.stopReason === "insufficient-probe-headroom"
                ? "insufficient-headroom"
                : "not-eligible");
          ticket.grantHistory.push({
            probeIndex: ticket.probeCount,
            grantKind: "first-probe",
            allocatedWallMs: historyProbeBudget ? historyProbeBudget.wallMs : null,
            allocatedExpansions: historyProbeBudget ? historyProbeBudget.expansions : null,
            consumedWallMs: ticket.consumedWallMs,
            consumedExpansions: ticket.consumedExpansions,
            anchorGenerationExpansions: ticket.anchorGenerationExpansions,
            historyProbeExpansions: ticket.historyProbeExpansions,
            outcome: waveOutcome,
            progressClass: ticket.progressClass,
          });
          appendSchedulingEvent({
            hypothesisId: ticket.hypothesisId,
            parentWaveId: ticket.parentWaveId,
            probeIndex: ticket.probeCount,
            grantKind: "first-probe",
            depth,
            anchorCandidateIds: ticket.anchorInputCandidateIds,
            anchorOutputCandidateId: ticket.anchorOutputCandidateId,
            anchorOutputStateKey: ticket.anchorOutputStateKey,
            anchorOutputRank: ticket.anchorOutputRank,
            startReplayIndex: anchorHistoryIndex + 1,
            endReplayIndex: anchorHistoryIndex + replaySegments.length,
            nextReplaySegmentIndex: ticket.nextReplaySegmentIndex,
            allocatedWallMs: historyProbeBudget ? historyProbeBudget.wallMs : null,
            allocatedExpansions: historyProbeBudget ? historyProbeBudget.expansions : null,
            consumedWallMs: ticket.consumedWallMs,
            consumedExpansions: ticket.consumedExpansions,
            anchorGenerationExpansions: ticket.anchorGenerationExpansions,
            historyProbeExpansions: ticket.historyProbeExpansions,
            progressBefore: historicalAnchorProgress,
            repairedAnchorProgress,
            replayBestProgress,
            progressAfter: ticket.lastProgress,
            progressClass: ticket.progressClass,
            continuationEligible: ticket.continuationEligible,
            yieldReason: probeExpired
              ? "probe-expired"
              : historyGoalReached
                ? "goal-reached"
                : null,
            pendingAfterProbe: !historyGoalReached && waveOutcome !== "exhausted",
            globalStopReason: globalStopAfterProbe,
          });
        }

        const OUTCOME_PRIORITY = {
          "goal-reached": 100,
          "probe-limited": 80,
          "resource-limited": 60,
          "time-limited": 60,
          "expansion-limited": 60,
          "incomplete": 40,
          "exhausted": 20,
        };
        if (!attemptWaveOutcome ||
            (OUTCOME_PRIORITY[waveOutcome] || 0) > (OUTCOME_PRIORITY[attemptWaveOutcome] || 0)) {
          attemptWaveOutcome = waveOutcome;
        }
        if (waveStopReason) lastWaveStopReason = waveStopReason;
        if (failedAtIndex != null) lastFailedAtIndex = failedAtIndex;
        if (replaySegments.length > 0) lastReplaySegments = replaySegments;

        if (historyGoalReached) {
          waveFinalFrontier = historyRepairFrontier;
          depthGoalReached = true;
          break;
        }
      }

      const waveConsumedExpansions = (config && config.globalBudget ? config.globalBudget.consumedExpansions : 0) - waveStartExpansions;
      const waveConsumedWallMs = Date.now() - waveStartedAt;
      const goalReached = depthGoalReached;

      const preReleaseRssMb = Math.round((process.memoryUsage().rss / 1048576) * 10) / 10;
      let postGcRssMb = preReleaseRssMb;
      let memoryRecoveryAttempted = false;
      let memoryRecovered = true;
      let releasedExecutionCount = 0;
      let releasedAttemptCount = 0;

      const recordedSegmentCandidateCounts = waveExecutions.map((entry) => ({
        segmentId: (entry.segment && entry.segment.id) || (entry.summary && entry.summary.segmentId),
        candidates: (entry.summary && entry.summary.attempts) ? entry.summary.attempts.reduce((sum, a) => sum + (a.goalCount || (a.found ? 1 : 0)), 0) : 0,
      }));

      if (!goalReached) {
        releasedExecutionCount = waveExecutions.length;
        waveExecutions.forEach((exec) => {
          releasedAttemptCount += (exec.attempts ? exec.attempts.length : 0);
          ledgerExecutions.push(toCompactLedgerExecution(exec));
          exec.inputFrontier = null;
          exec.merged = null;
          if (Array.isArray(exec.attempts)) {
            exec.attempts.forEach((att) => {
              att.rawResult = null;
              att.result = null;
              att.state = null;
              att.hero = null;
              att.goalSkyline = null;
              att.frontier = null;
              if (att.diagnostics && att.diagnostics.dp) {
                att.diagnostics.dp.goalSkyline = null;
                att.diagnostics.dp.bestSeenState = null;
                att.diagnostics.dp.bestProgressState = null;
              }
            });
            exec.attempts.length = 0;
          }
        });

        expandedAnchor = null;
        waveExecutions.length = 0;

        if (memoryExecution || preReleaseRssMb >= (config.maxRssMb || 256)) {
          memoryRecoveryAttempted = true;
          if (typeof global.gc === "function") {
            try { global.gc(); } catch (_) {}
          }
          postGcRssMb = Math.round((process.memoryUsage().rss / 1048576) * 10) / 10;
          memoryRecovered = postGcRssMb < (config.maxRssMb || 256);
        }
      } else {
        waveExecutions.forEach((exec) => {
          ledgerExecutions.push(exec);
        });
      }

      if (attemptWaveOutcome === "exhausted") {
        depthWavesCompleted += 1;
      } else if (!depthStopReason) {
        depthStopReason = lastWaveStopReason || (!memoryRecovered ? "rss-limit" : null);
      }

      attempts.push({
        depth,
        anchorSegmentId: anchor.segment.id,
        waveIndex,
        anchorInputCandidates: waveInputCandidates.length,
        anchorInputCandidateIds: waveInputCandidates
          .slice(0, waveBatchSize)
          .map((candidate) => candidate.id),
        anchorExpandedCandidates: expandedAnchorCandidatesCount,
        replaySegmentIds: lastReplaySegments.map((s) => s.id),
        failedAtSegmentId: lastFailedAtIndex == null ? null : segments[lastFailedAtIndex].id,
        segmentCandidateCounts: recordedSegmentCandidateCounts,
        waveOutcome: attemptWaveOutcome || "incomplete",
        depthConsumedExpansions: waveConsumedExpansions,
        depthConsumedWallMs: waveConsumedWallMs,
        depthStopReason: lastWaveStopReason,
        preReleaseRssMb,
        postGcRssMb,
        memoryRecoveryAttempted,
        memoryRecovered,
        releasedExecutionCount,
        releasedAttemptCount,
      });

      const pushCurrentDepthSummary = () => {
        // PR-5.24d Repair 2: if any hypothesis at this depth has status "PROBE_PENDING",
        // the depth has unfinished scheduler work and can NEVER claim exhausted.
        const hasPendingSchedulerWork = budgetedSchedulingEnabled &&
          repairScheduling.hypotheses.some((t) => t.depth === depth && t.status === "PROBE_PENDING");
        const depthOutcome = depthGoalReached
          ? "goal-reached"
          : (!hasPendingSchedulerWork && depthWavesCompleted === totalWaves && depthStopReason === null)
            ? "exhausted"
            : depthStopReason === "rss-limit" || depthStopReason === "heap-limit" || !memoryRecovered
              ? "resource-limited"
              : depthStopReason === "time-limit"
                ? "time-limited"
                : depthStopReason === "expansion-limit"
                  ? "expansion-limited"
                  : "incomplete";
        const hasDownstreamSegments = segmentIndex > anchorHistoryIndex;
        const depthExhausted = !hasPendingSchedulerWork && depthOutcome === "exhausted" && (!hasDownstreamSegments || depthDownstreamReplayCount > 0);

        depthSummaries.push({
          depth,
          anchorSegmentId: anchor.segment.id,
          wavesTotal: totalWaves,
          wavesAttempted: depthWavesAttempted,
          wavesCompleted: depthWavesCompleted,
          downstreamReplayCount: depthDownstreamReplayCount,
          anchorExpandedCandidates: depthAnchorExpandedCandidates,
          depthOutcome,
          depthExhausted,
          stopReason: depthStopReason,
        });
      };

      if (goalReached) {
        pushCurrentDepthSummary();
        return {
          found: true,
          triggerFailure,
          failureIntentRanking,
          repairScheduling,
          maxDepth,
          attempts,
          depthSummaries,
          executions: waveExecutions,
          ledgerExecutions,
          anchorHistoryIndex,
          finalFrontier: waveFinalFrontier || [],
        };
      }

      if (memoryRecoveryAttempted && !memoryRecovered) {
        pushCurrentDepthSummary();
        return {
          found: false,
          triggerFailure,
          failureIntentRanking,
          repairScheduling,
          maxDepth,
          attempts,
          depthSummaries,
          executions: [],
          ledgerExecutions,
          anchorHistoryIndex,
          memoryExecution: memoryExecution || {
            segment: anchor.segment,
            summary: {
              segmentId: anchor.segment.id,
              failureClass: "memory-limited",
              failureReason: `memory recovery failed: postGcRssMb ${postGcRssMb} >= maxRssMb ${config.maxRssMb || 256}`,
            },
            memoryLimited: true,
            memoryStopReason: "rss-limit",
          },
          memorySegmentIndex: anchorHistoryIndex,
          memoryRecoveryAttempted: true,
          memoryRecovered: false,
          preReleaseRssMb,
          postGcRssMb,
        };
      }

      if (config.globalBudget && (
        config.globalBudget.stoppedReason === "time-limit" ||
        config.globalBudget.stoppedReason === "expansion-limit"
      )) {
        pushCurrentDepthSummary();
        return {
          found: false,
          triggerFailure,
          failureIntentRanking,
          repairScheduling,
          maxDepth,
          attempts,
          depthSummaries,
          executions: [],
          ledgerExecutions,
          anchorHistoryIndex,
          memoryExecution,
          memorySegmentIndex,
        };
      }
    }

    // PR-5.24c Iteration 2 – progress-gated second-grant round (AFTER the
    // whole first round completed: the first-round barrier is structural —
    // the continuation loop only starts here). Restart-from-anchor semantics:
    // an eligible hypothesis re-runs from its original anchor candidates
    // under a fresh, larger bounded grant. probeCount <= 2 (no third grant).
    // Selection order: SEGMENT_ADVANCE before WITHIN_SEGMENT_PROGRESS, then
    // legacy wave order within a class. All probe authorities (wall local
    // authority, expansion child-local rebase, isolated-process, headroom
    // fail-closed) apply unchanged.
    if (continuationEnabled && !depthGoalReached) {
      const globalStopNow = (config.globalBudget && config.globalBudget.stoppedReason) || null;
      const depthTickets = repairScheduling.hypotheses.filter(
        (t) => t.depth === depth,
      );
      // PR-5.24d Iteration 1 Repair 2 – reinforced first-round barrier:
      // ALL hypotheses at this depth must have completed a first probe (probeCount >= 1)
      // before ANY second grant is allowed.
      const firstRoundComplete =
        depthTickets.length > 0 &&
        depthTickets.every((t) => t.probeCount >= 1);
      if (!firstRoundComplete) {
        depthTickets.filter((t) => t.continuationDecision == null).forEach((t) => {
          t.continuationDecision = t.stopReason === "insufficient-probe-headroom"
            ? "insufficient-headroom"
            : "first-round-incomplete";
        });
      } else {
        const eligible = depthTickets
          .filter((t) => isContinuationEligible(t, globalStopNow))
          .sort((left, right) => {
            // SEGMENT_ADVANCE outranks WITHIN_SEGMENT_PROGRESS; within a class
            // the original ticket order (legacy/wave order) is preserved.
            const rank = (t) => (t.progressClass === "SEGMENT_ADVANCE" ? 0 : 1);
            const rankDiff = rank(left) - rank(right);
            if (rankDiff !== 0) return rankDiff;
            return depthTickets.indexOf(left) - depthTickets.indexOf(right);
          })
          .slice(0, continuationMaxPerDepth);
        const ineligible = depthTickets.filter(
          (t) => !isContinuationEligible(t, globalStopNow) &&
            t.probeCount === 1 &&
            t.continuationDecision == null,
        );
        ineligible.forEach((t) => {
          t.continuationDecision = t.stopReason === "probe-limited" && !globalStopNow
            ? "no-measurable-progress"
            : "not-eligible";
        });
        let continuationGrants = 0;
        for (const candidateTicket of eligible) {
        if (globalStopNow) break;
        if (config.globalBudget && (
          config.globalBudget.stoppedReason === "time-limit" ||
          config.globalBudget.stoppedReason === "expansion-limit"
        )) break;
        // Continuation budget under the SAME probe authority: strictly
        // tighter than remaining global.
        const now = Date.now();
        const remainingWallMs = config.globalBudget.deadlineMs != null &&
          Number.isFinite(Number(config.globalBudget.deadlineMs))
          ? Math.max(0, config.globalBudget.deadlineMs - now)
          : null;
        const remainingExpansions = config.globalBudget.requestedExpansions > 0
          ? Math.max(0, config.globalBudget.requestedExpansions - config.globalBudget.consumedExpansions)
          : null;
        if ((remainingWallMs != null && remainingWallMs <= 0) ||
            (remainingExpansions != null && remainingExpansions <= 0)) break;
        const localWallMs = remainingWallMs != null
          ? Math.min(continuationWallMs, remainingWallMs)
          : continuationWallMs;
        const localExpansions = remainingExpansions != null
          ? Math.min(continuationExpansions, remainingExpansions)
          : continuationExpansions;
        if (localWallMs >= (remainingWallMs != null ? remainingWallMs : Infinity) &&
            localExpansions >= (remainingExpansions != null ? remainingExpansions : Infinity)) {
          candidateTicket.continuationDecision = "insufficient-headroom";
          appendSchedulingEvent({
            hypothesisId: candidateTicket.hypothesisId,
            probeIndex: 1,
            grantKind: "continuation",
            depth,
            anchorCandidateIds: candidateTicket.anchorInputCandidateIds,
            startReplayIndex: anchorHistoryIndex + 1,
            endReplayIndex: anchorHistoryIndex,
            allocatedWallMs: null,
            allocatedExpansions: null,
            consumedWallMs: 0,
            consumedExpansions: 0,
            progressBefore: null,
            progressAfter: null,
            yieldReason: "insufficient-probe-headroom",
            pendingAfterProbe: true,
            globalStopReason: (config.globalBudget && config.globalBudget.stoppedReason) || null,
          });
          continue;
        }
        const continuationBudget = {
          wallMs: localWallMs,
          deadlineMs: now + localWallMs,
          expansions: localExpansions,
        };
        // Restart-from-anchor: locate the wave's original input candidates.
        const contWaveIndex = candidateTicket.waveIndex != null
          ? candidateTicket.waveIndex
          : depthTickets.indexOf(candidateTicket);
        const waveSliceStart = contWaveIndex * waveBatchSize;
        const restartCandidates = rankedInputFrontier.slice(
          waveSliceStart,
          waveSliceStart + waveBatchSize,
        );
        if (restartCandidates.length === 0) continue;
        candidateTicket.continuationDecision = "granted";
        candidateTicket.continuationMode = "restart-from-anchor";
        candidateTicket.probeCount = 2;
        continuationGrants += 1;

        const contStartedAt = Date.now();
        const contStartExpansions = config.globalBudget.consumedExpansions;
        let contExpired = false;
        let contGoalReached = false;
        let contCompletedReplays = 0;
        const contAnchorConfig = {
          ...(config || {}),
          stopOnFirstGoal: undefined,
          probeDeadlineMs: continuationBudget.deadlineMs,
          probeExpansionCap: contStartExpansions + continuationBudget.expansions,
          maxExpansions: Math.min(
            number((config || {}).maxExpansions, continuationBudget.expansions),
            continuationBudget.expansions,
          ),
        };
        let contExpanded = runSegmentAgainstFrontier(
          simulator,
          anchor.segment,
          restartCandidates,
          {
            ...contAnchorConfig,
            segmentIndex: anchorHistoryIndex,
            segmentTotal: segments.length,
            goalDependencySegments: segments.slice(anchorHistoryIndex),
          },
          withManualBudgetAuthority(contAnchorConfig, {
            candidateLimit: backtrackCandidateLimit(anchor.segment, config || {}),
            dpOverrides: backtrackDpOverrides(anchor.segment, config || {}),
            preserveSkylineRoles: true,
          }),
        );
        contExpanded.summary.backtrack = {
          mode: "adaptive-checkpoint-expand",
          depth,
          waveIndex: contWaveIndex,
          continuation: true,
          triggeredBySegment: segments[segmentIndex].id,
        };
        let contRepairFrontier = contExpanded.merged;
        const contExecutions = [contExpanded];
        depthWavesAttempted += 1;
        depthAnchorExpandedCandidates += (contExpanded.summary && contExpanded.summary.attempts || [])
          .reduce((sum, a) => sum + (a.goalCount || (a.found ? 1 : 0)), 0);

        // PR-5.24d Iteration 1 Repair 1a – exact canonical state identity matching.
        // anchorOutputStateKey (from buildStateKey) is the authority on exact state identity.
        // candidate ID is telemetry only and cannot override a state mismatch.
        // If the second-grant winner is NOT reproduced in the restart anchor output,
        // FAIL CLOSED immediately: do NOT fall back to old rank or [0], do NOT replay
        // any sibling candidate.
        let matchedCandidate = null;
        if (Array.isArray(contRepairFrontier)) {
          if (candidateTicket.anchorOutputStateKey != null) {
            matchedCandidate = contRepairFrontier.find((c) => {
              if (!c || !c.state) return false;
              try {
                return buildStateKey(c.state) === candidateTicket.anchorOutputStateKey;
              } catch (_) {
                return false;
              }
            }) || null;
          } else if (candidateTicket.anchorOutputCandidateId != null) {
            matchedCandidate = contRepairFrontier.find(
              (c) => c && c.id != null && String(c.id) === String(candidateTicket.anchorOutputCandidateId)
            ) || null;
          } else if (contRepairFrontier.length === 1) {
            matchedCandidate = contRepairFrontier[0];
          }
        }

        if (!matchedCandidate) {
          // Fail closed: history not reproduced in restart anchor.
          const contConsumedWallMs = Date.now() - contStartedAt;
          const contConsumedExpansions =
            (config && config.globalBudget ? config.globalBudget.consumedExpansions : 0) - contStartExpansions;
          candidateTicket.consumedWallMs += contConsumedWallMs;
          candidateTicket.consumedExpansions += contConsumedExpansions;
          candidateTicket.stopReason = "incomplete";
          candidateTicket.status = "PROBE_PENDING";
          candidateTicket.continuationDecision = "history-not-reproduced";
          candidateTicket.grantHistory.push({
            probeIndex: 2,
            grantKind: "continuation",
            allocatedWallMs: continuationBudget.wallMs,
            allocatedExpansions: continuationBudget.expansions,
            consumedWallMs: contConsumedWallMs,
            consumedExpansions: contConsumedExpansions,
            outcome: "history-not-reproduced",
            progressClass: null,
          });
          appendSchedulingEvent({
            hypothesisId: candidateTicket.hypothesisId,
            parentWaveId: candidateTicket.parentWaveId,
            probeIndex: 2,
            grantKind: "continuation",
            depth,
            anchorCandidateIds: candidateTicket.anchorInputCandidateIds,
            anchorOutputCandidateId: candidateTicket.anchorOutputCandidateId,
            anchorOutputStateKey: candidateTicket.anchorOutputStateKey,
            anchorOutputRank: candidateTicket.anchorOutputRank,
            startReplayIndex: anchorHistoryIndex + 1,
            endReplayIndex: anchorHistoryIndex,
            nextReplaySegmentIndex: candidateTicket.nextReplaySegmentIndex,
            allocatedWallMs: continuationBudget.wallMs,
            allocatedExpansions: continuationBudget.expansions,
            consumedWallMs: contConsumedWallMs,
            consumedExpansions: contConsumedExpansions,
            progressBefore: null,
            progressAfter: {
              waveOutcome: "history-not-reproduced",
              replaySegmentsCompleted: 0,
              goalReached: false,
              continuationMode: "restart-from-anchor",
            },
            progressClass: null,
            yieldReason: "history-not-reproduced",
            pendingAfterProbe: true,
            globalStopReason: (config.globalBudget && config.globalBudget.stoppedReason) || null,
          });
          attempts.push({
            depth,
            anchorSegmentId: anchor.segment.id,
            waveIndex: contWaveIndex,
            anchorInputCandidates: restartCandidates.length,
            anchorInputCandidateIds: restartCandidates.map((c) => c.id),
            continuation: true,
            anchorExpandedCandidates: (contExpanded.summary && contExpanded.summary.attempts || [])
              .reduce((sum, a) => sum + (a.goalCount || (a.found ? 1 : 0)), 0),
            replaySegmentIds: [],
            waveOutcome: "incomplete",
            depthConsumedExpansions: contConsumedExpansions,
            depthConsumedWallMs: contConsumedWallMs,
            depthStopReason: null,
          });
          contExecutions.forEach((exec) => {
            ledgerExecutions.push(toCompactLedgerExecution(exec));
          });
          continue;
        }

        contRepairFrontier = [matchedCandidate];

        for (
          let replayIndex = anchorHistoryIndex + 1;
          !contExpired && contRepairFrontier && contRepairFrontier.length > 0 && replayIndex <= segmentIndex;
          replayIndex += 1
        ) {
          const replaySegment = segments[replayIndex];
          depthDownstreamReplayCount += 1;
          const contReplayConfig = {
            ...(config || {}),
            probeDeadlineMs: continuationBudget.deadlineMs,
            probeExpansionCap: contStartExpansions + continuationBudget.expansions,
            maxExpansions: Math.min(
              number((config || {}).maxExpansions, continuationBudget.expansions),
              continuationBudget.expansions,
            ),
          };
          const contReplayIntentLimit = backtrackCandidateLimit(replaySegment, config || {});
          const contRankedFrontier = rankCandidatesByPreferredTags(
            contRepairFrontier,
            preferredTags,
          ).slice(0, contReplayIntentLimit);
          const contReplayed = runSegmentAgainstFrontier(
            simulator,
            replaySegment,
            contRankedFrontier,
            {
              ...contReplayConfig,
              segmentIndex: replayIndex,
              segmentTotal: segments.length,
              goalDependencySegments: segments.slice(replayIndex),
            },
            withManualBudgetAuthority(contReplayConfig, {
              candidateLimit: contReplayIntentLimit,
              preserveSkylineRoles: true,
            }),
          );
          contReplayed.summary.backtrack = {
            mode: "adaptive-checkpoint-replay",
            depth,
            waveIndex: contWaveIndex,
            continuation: true,
            repairedFromSegment: anchor.segment.id,
            triggeredBySegment: segments[segmentIndex].id,
          };
          contReplayed.executionPhase = "adaptive-replay";
          contExecutions.push(contReplayed);
          contRepairFrontier = contReplayed.merged;
          // Iteration 2 Repair 1a (P1) – continuation replay completion uses
          // the SAME shared determinate-completion definition as the first
          // probe: probe expiry, resource/global interruption, AND the
          // canonical completion contract (candidateSliceSearchComplete +
          // finalPending===0 + terminalIncomplete===0) are all checked
          // before the increment. An indeterminate replay never advances the
          // cursor and never feeds PROBE_COMPLETE_OR_GOAL / exhausted.
          const contGlobalStopAfter =
            (config.globalBudget && config.globalBudget.stoppedReason) || null;
          const contResourceInterrupted =
            Boolean(contReplayed.memoryLimited) ||
            contGlobalStopAfter === "rss-limit" ||
            contGlobalStopAfter === "heap-limit" ||
            contGlobalStopAfter === "time-limit" ||
            contGlobalStopAfter === "expansion-limit";
          const contExpiredAfter = Date.now() >= continuationBudget.deadlineMs ||
            ((config.globalBudget.consumedExpansions - contStartExpansions) >=
              continuationBudget.expansions);
          const contReplayDeterminate = isReplayDeterminatelyComplete(contReplayed, {
            probeExpiredAfter: contExpiredAfter,
            resourceInterrupted: contResourceInterrupted,
          });
          if (contReplayDeterminate) contCompletedReplays += 1;
          if (contReplayed.memoryLimited) break;
          if (!contRepairFrontier || contRepairFrontier.length === 0) break;
          if (contExpiredAfter) { contExpired = true; break; }
        }
        if (Date.now() >= continuationBudget.deadlineMs ||
            (config.globalBudget.consumedExpansions - contStartExpansions) >=
              continuationBudget.expansions) {
          contExpired = true;
        }
        contGoalReached = Boolean(
          contRepairFrontier && contRepairFrontier.length > 0 &&
          contExecutions.length === (segmentIndex - anchorHistoryIndex + 1),
        );

        const contConsumedWallMs = Date.now() - contStartedAt;
        const contConsumedExpansions = config.globalBudget.consumedExpansions - contStartExpansions;
        // Iteration 2 Repair 1 (P1-B) – the continuation outcome must NOT
        // swallow the global/resource authority. Authoritative stops are
        // checked FIRST: a resource- or global-interrupted second grant is
        // resource-limited (canonical RESOURCE_LIMITED semantics), never
        // exhausted, never searchComplete, never PROBE_COMPLETE_OR_GOAL.
        const contGlobalStopFinal =
          (config.globalBudget && config.globalBudget.stoppedReason) || null;
        const contMemoryLimited = contExecutions.some((exec) => exec && exec.memoryLimited);
        const contResourceInterrupted =
          contMemoryLimited ||
          contGlobalStopFinal === "rss-limit" ||
          contGlobalStopFinal === "heap-limit" ||
          contGlobalStopFinal === "time-limit" ||
          contGlobalStopFinal === "expansion-limit";
        // Repair 1a: "exhausted" is only legitimate when EVERY entered replay
        // leg was determinately complete (canonical search completion, no
        // probe/resource truncation, no pending/terminal-incomplete). A
        // replay chain that stopped indeterminately (searchComplete=false,
        // finalPending>0, terminalIncomplete>0, unsupported backend, ...)
        // classifies as "incomplete" and can never claim exhaustion.
        const contEnteredReplays = Math.max(
          0, contExecutions.length - 1); // minus the anchor expand
        const contChainDeterminate =
          contCompletedReplays === contEnteredReplays && contEnteredReplays > 0;
        // Repair 1b: route the continuation outcome through the SAME shared
        // production classifier — the anchor-only empty-frontier case now
        // requires the anchor execution itself to be determinately complete
        // before "exhausted" may be claimed; an indeterminate anchor-only
        // chain classifies as "incomplete".
        const contOutcome = classifyAdaptiveHypothesisOutcome({
          goalReached: contGoalReached,
          probeExpired: contExpired,
          resourceInterrupted: contResourceInterrupted,
          enteredReplays: contEnteredReplays,
          completedReplays: contCompletedReplays,
          emptyFrontier: !contRepairFrontier || contRepairFrontier.length === 0,
          anchorExecution: contExpanded,
          globalStopReason: contGlobalStopFinal,
        });

        candidateTicket.consumedWallMs += contConsumedWallMs;
        candidateTicket.consumedExpansions += contConsumedExpansions;
        candidateTicket.stopReason = contOutcome;
        candidateTicket.status = contGoalReached || contOutcome === "exhausted"
          ? "PROBE_COMPLETE_OR_GOAL"
          : "PROBE_PENDING";
        if (contCompletedReplays > 0) {
          candidateTicket.nextReplaySegmentIndex = anchorHistoryIndex + 1 + contCompletedReplays;
        }
        candidateTicket.grantHistory.push({
          probeIndex: 2,
          grantKind: "continuation",
          allocatedWallMs: continuationBudget.wallMs,
          allocatedExpansions: continuationBudget.expansions,
          consumedWallMs: contConsumedWallMs,
          consumedExpansions: contConsumedExpansions,
          outcome: contOutcome,
          progressClass: contCompletedReplays >= 1
            ? "SEGMENT_ADVANCE"
            : null,
        });
        appendSchedulingEvent({
          hypothesisId: candidateTicket.hypothesisId,
          parentWaveId: candidateTicket.parentWaveId,
          probeIndex: 2,
          grantKind: "continuation",
          depth,
          anchorCandidateIds: candidateTicket.anchorInputCandidateIds,
          anchorOutputCandidateId: candidateTicket.anchorOutputCandidateId,
          anchorOutputRank: candidateTicket.anchorOutputRank,
          startReplayIndex: anchorHistoryIndex + 1,
          endReplayIndex: anchorHistoryIndex + contCompletedReplays + (contExpired ? 1 : 0),
          nextReplaySegmentIndex: candidateTicket.nextReplaySegmentIndex,
          allocatedWallMs: continuationBudget.wallMs,
          allocatedExpansions: continuationBudget.expansions,
          consumedWallMs: contConsumedWallMs,
          consumedExpansions: contConsumedExpansions,
          progressBefore: null,
          progressAfter: {
            waveOutcome: contOutcome,
            replaySegmentsCompleted: contCompletedReplays,
            goalReached: contGoalReached,
            continuationMode: "restart-from-anchor",
          },
          progressClass: contCompletedReplays >= 1 ? "SEGMENT_ADVANCE" : null,
          yieldReason: contGoalReached
            ? "goal-reached"
            : contExpired
              ? "probe-expired"
              : null,
          pendingAfterProbe: !contGoalReached && contOutcome !== "exhausted",
          globalStopReason: (config.globalBudget && config.globalBudget.stoppedReason) || null,
        });
        attempts.push({
          depth,
          anchorSegmentId: anchor.segment.id,
          waveIndex: depthTickets.indexOf(candidateTicket),
          anchorInputCandidates: restartCandidates.length,
          anchorInputCandidateIds: restartCandidates.map((c) => c.id),
          continuation: true,
          anchorExpandedCandidates: (contExpanded.summary && contExpanded.summary.attempts || [])
            .reduce((sum, a) => sum + (a.goalCount || (a.found ? 1 : 0)), 0),
          replaySegmentIds: contExecutions.slice(1).map((e) => e.segment && e.segment.id),
          waveOutcome: contOutcome,
          depthConsumedExpansions: contConsumedExpansions,
          depthConsumedWallMs: contConsumedWallMs,
          depthStopReason: null,
        });

        if (contGoalReached) {
          depthGoalReached = true;
          const depthOutcome = "goal-reached";
          depthSummaries.push({
            depth,
            anchorSegmentId: anchor.segment.id,
            wavesTotal: totalWaves,
            wavesAttempted: depthWavesAttempted,
            wavesCompleted: depthWavesCompleted,
            downstreamReplayCount: depthDownstreamReplayCount,
            anchorExpandedCandidates: depthAnchorExpandedCandidates,
            depthOutcome,
            depthExhausted: false,
            stopReason: depthStopReason,
          });
          return {
            found: true,
            triggerFailure,
            failureIntentRanking,
            repairScheduling,
            maxDepth,
            attempts,
            depthSummaries,
            executions: contExecutions,
            ledgerExecutions,
            anchorHistoryIndex,
            finalFrontier: contRepairFrontier,
          };
        }
        // Detach continuation executions (they failed).
        contExecutions.forEach((exec) => {
          ledgerExecutions.push(toCompactLedgerExecution(exec));
        });
        if (continuationGrants >= continuationMaxPerDepth) break;
      }
      }
    }

    if (!depthSummaries.some((d) => d.depth === depth)) {
      const hasPendingSchedulerWork = budgetedSchedulingEnabled &&
        repairScheduling.hypotheses.some((t) => t.depth === depth && t.status === "PROBE_PENDING");
      const depthOutcome = (!hasPendingSchedulerWork && depthWavesCompleted === totalWaves && depthStopReason === null)
        ? "exhausted"
        : depthStopReason === "rss-limit" || depthStopReason === "heap-limit"
          ? "resource-limited"
          : depthStopReason === "time-limit"
            ? "time-limited"
            : depthStopReason === "expansion-limit"
              ? "expansion-limited"
              : "incomplete";
      const hasDownstreamSegments = segmentIndex > anchorHistoryIndex;
      const depthExhausted = !hasPendingSchedulerWork && depthOutcome === "exhausted" && (!hasDownstreamSegments || depthDownstreamReplayCount > 0);

      depthSummaries.push({
        depth,
        anchorSegmentId: anchor.segment.id,
        wavesTotal: totalWaves,
        wavesAttempted: depthWavesAttempted,
        wavesCompleted: depthWavesCompleted,
        downstreamReplayCount: depthDownstreamReplayCount,
        anchorExpandedCandidates: depthAnchorExpandedCandidates,
        depthOutcome,
        depthExhausted,
        stopReason: depthStopReason,
      });
    }
  }

  return {
    found: false,
    triggerFailure,
    failureIntentRanking,
    repairScheduling,
    maxDepth,
    attempts,
    depthSummaries,
    executions: [],
    ledgerExecutions,
  };
}

function configuredRepairStartFrom(segment) {
  const dp = (segment || {}).dp || {};
  return (segment && segment.repairStartFrom) || dp.repairStartFrom || null;
}

function tryRepairFromConfiguredMilestone(
  simulator,
  segments,
  segmentIndex,
  history,
  failedExecution,
  config,
) {
  if ((config || {}).enableFailureBacktracking === false) return null;
  if (!Array.isArray(history) || history.length === 0) return null;
  const currentSegment = segments[segmentIndex];
  const repairStartFrom = configuredRepairStartFrom(currentSegment);
  if (!repairStartFrom) return null;
  const start = history.find(
    (entry) => entry && entry.segment && entry.segment.id === repairStartFrom,
  );
  if (!start || !Array.isArray(start.merged) || start.merged.length === 0)
    return null;

  const dpConfig = (currentSegment || {}).dp || {};
  const repairedCurrent = runSegmentAgainstFrontier(
    simulator,
    currentSegment,
    start.merged,
    config || {},
    withManualBudgetAuthority(config || {}, {
      candidateLimit: numericOption(
        dpConfig.repairCandidateLimit,
        numericOption(dpConfig.goalSkylineLimit, 8),
      ),
      startCandidateLimit: numericOption(
        dpConfig.repairStartCandidateLimit,
        start.merged.length,
      ),
      preserveSkylineRoles: true,
      dpOverrides: {
        stopOnFirstGoal: false,
        keyMode: dpConfig.keyMode,
        dpKeyMode: dpConfig.dpKeyMode,
        priorityMode: dpConfig.priorityMode,
        dpPriorityMode: dpConfig.dpPriorityMode,
        maxExpansions: numericOption(
          dpConfig.repairMaxExpansions,
          numericOption(dpConfig.maxExpansions, 0),
        ),
        maxRuntimeMs: numericOption(
          dpConfig.repairMaxRuntimeMs,
          numericOption(dpConfig.maxRuntimeMs, 0),
        ),
        goalSkylineLimit: numericOption(
          dpConfig.repairGoalSkylineLimit,
          numericOption(dpConfig.goalSkylineLimit, 8),
        ),
        maxActionsPerState: dpConfig.maxActionsPerState,
        agendaMode: dpConfig.agendaMode,
        dpAgendaMode: dpConfig.dpAgendaMode,
        fairnessEvery: dpConfig.fairnessEvery,
      },
    }),
  );
  repairedCurrent.summary.backtrack = {
    mode: "configured-milestone-window",
    repairedFromMilestone: repairStartFrom,
    triggeredBySegment: currentSegment.id,
    failedSegment:
      failedExecution &&
      failedExecution.summary &&
      failedExecution.summary.segmentId,
    startCandidateCount: start.merged.length,
    repairedCandidateCount: repairedCurrent.merged.length,
  };
  return {
    found: repairedCurrent.merged.length > 0,
    repairedCurrent,
  };
}

function createGlobalBudget(config) {
  if (!config || config.budgetScope !== "global-run") return null;
  const startedAt = Date.now();
  const requestedRuntimeMs = Math.max(0, number(config.maxRuntimeMs, 0));
  const safetyMarginMs = requestedRuntimeMs > 2000 ? 500 : 0;
  return {
    scope: "global-run",
    startedAt,
    deadlineMs: requestedRuntimeMs > 0 ? startedAt + Math.max(1000, requestedRuntimeMs - safetyMarginMs) : Number.POSITIVE_INFINITY,
    requestedExpansions: Math.max(0, number(config.maxExpansions, 0)),
    requestedRuntimeMs,
    consumedExpansions: 0,
    consumedWallMs: 0,
    stoppedReason: null,
  };
}

function summarizeGlobalBudget(budget) {
  if (!budget) return null;
  const consumedWallMs = Math.max(
    budget.consumedWallMs,
    Date.now() - budget.startedAt,
  );
  if (!budget.stoppedReason) {
    if (
      budget.requestedRuntimeMs > 0 &&
      consumedWallMs >= budget.requestedRuntimeMs
    ) {
      budget.stoppedReason = "time-limit";
    } else if (
      budget.requestedExpansions > 0 &&
      budget.consumedExpansions >= budget.requestedExpansions
    ) {
      budget.stoppedReason = "expansion-limit";
    }
  }
  return {
    scope: budget.scope,
    requestedExpansions: budget.requestedExpansions,
    requestedRuntimeMs: budget.requestedRuntimeMs,
    consumedExpansions: budget.consumedExpansions,
    consumedWallMs,
    stoppedReason: budget.stoppedReason,
  };
}

function summarizeMemoryAttempts(attempts, config) {
  const diagnostics = (attempts || [])
    .map((entry) => entry && entry.diagnostics && entry.diagnostics.dp)
    .filter(Boolean);
  const memory = diagnostics
    .map((dp) => dp.memory || {})
    .filter((entry) => Object.keys(entry).length > 0);
  const heapLimitedCount = diagnostics.filter((dp) => dp.stoppedReason === "heap-limit").length;
  const rssLimitedCount = diagnostics.filter((dp) => dp.stoppedReason === "rss-limit").length;
  const peakHeapUsedMb = memory.reduce(
    (peak, entry) => Math.max(peak, number(entry.peakHeapUsedMb, 0), number(entry.heapUsedMb, 0)),
    0,
  );
  const peakRssMb = memory.reduce(
    (peak, entry) => Math.max(peak, number(entry.peakRssMb, 0), number(entry.rssMb, 0)),
    0,
  );
  const stopped = diagnostics.find((dp) => dp.stoppedReason === "heap-limit" || dp.stoppedReason === "rss-limit");
  const firstMemory = memory[0] || {};
  return {
    maxHeapMb: config && config.maxHeapMb != null
      ? number(config.maxHeapMb, 0)
      : number(firstMemory.maxHeapMb, 0),
    maxRssMb: config && config.maxRssMb != null
      ? number(config.maxRssMb, 0)
      : number(firstMemory.maxRssMb, 0),
    memoryCheckIntervalExpansions: config && config.memoryCheckIntervalExpansions != null
      ? number(config.memoryCheckIntervalExpansions, 1)
      : number(firstMemory.memoryCheckIntervalExpansions, 1),
    memoryCheckIntervalActions: config && config.memoryCheckIntervalActions != null
      ? number(config.memoryCheckIntervalActions, 1)
      : number(firstMemory.memoryCheckIntervalActions, 1),
    peakHeapUsedMb,
    peakRssMb,
    heapLimitedCount,
    rssLimitedCount,
    stoppedReason: stopped ? stopped.stoppedReason : null,
    stoppedAtExpansion: stopped && stopped.memory ? stopped.memory.stoppedAtExpansion : null,
    stoppedAtPhase: stopped && stopped.memory ? stopped.memory.stoppedAtPhase : null,
    searchCompletion: heapLimitedCount > 0 || rssLimitedCount > 0
      ? "memory-limited"
      : "completed",
  };
}

function runMilestoneGraph(simulator, initialState, milestoneSpec, options) {
  const config = resolveSearchIntentOptions(options);
  const objective = config.objectiveSpec && config.objectiveSpec.compiled
    ? config.objectiveSpec
    : null;
  const objectiveStopPolicy = objective
    ? objective.getStopPolicy(config.stopOnFirstGoal)
    : null;
  const objectiveConfig = objective &&
    objective.requiresOptimizationProof &&
    config.stopOnFirstGoal == null
    ? { ...config, stopOnFirstGoal: false }
    : config;
  const globalBudget = objectiveConfig.globalBudget || createGlobalBudget(objectiveConfig);
  const graphConfigBase = globalBudget
    ? { ...objectiveConfig, globalBudget }
    : objectiveConfig;
  // Process-tree isolated execution telemetry (canonical qualification source)
  const isolatedProcessTreeTelemetry = {
    maxPlannerRssDuringIsolatedExecutionMb: 0,
    maxWorkerPeakRssMb: 0,
    maxAggregateConcurrentRssUpperBoundMb: 0,
    isolatedInvocationCount: 0,
    totalAssignedExpansions: 0,
    totalConsumedExpansions: 0,
    maxAssignedExpansionsPerInvocation: 0,
    maxConsumedExpansionsPerInvocation: 0,
    records: [],
  };
  const seenInvocationIds = new Set();
  const recordIsolatedTelemetry = (execution) => {
    if (!execution || !execution.telemetry) return;
    const t = execution.telemetry;
    const invocationId = t.invocationId || t.runId || null;
    if (invocationId && seenInvocationIds.has(invocationId)) return;
    if (invocationId) seenInvocationIds.add(invocationId);
    isolatedProcessTreeTelemetry.isolatedInvocationCount += 1;
    // Phase-correct invocation peak (Iteration 2c): prefer the executor's authoritative
    // invocationProcessTreePeakMb; fall back to legacy aggregate only when absent.
    const invocationPeak = Number(t.invocationProcessTreePeakMb || 0);
    const legacyAgg = Number(t.aggregateConcurrentRssUpperBoundMb || t.maxAggregateConcurrentRssUpperBoundMb || 0);
    const agg = invocationPeak > 0 ? invocationPeak : legacyAgg;
    const plannerMax = Math.max(
      Number(t.plannerRssBeforeSerializationMb || 0),
      Number(t.plannerRssBeforeSpawnMb || 0),
      Number(t.plannerRssAtSpawnMb || 0),
      Number(t.plannerRssAfterSpawnMb || 0),
      Number(t.maxPlannerRssDuringIsolatedExecutionMb || 0)
    );
    if (plannerMax > isolatedProcessTreeTelemetry.maxPlannerRssDuringIsolatedExecutionMb) isolatedProcessTreeTelemetry.maxPlannerRssDuringIsolatedExecutionMb = plannerMax;
    const workerPeak = Number(t.workerPeakRssMb || t.maxWorkerPeakRssMb || 0);
    if (workerPeak > isolatedProcessTreeTelemetry.maxWorkerPeakRssMb) isolatedProcessTreeTelemetry.maxWorkerPeakRssMb = workerPeak;
    if (agg > isolatedProcessTreeTelemetry.maxAggregateConcurrentRssUpperBoundMb) isolatedProcessTreeTelemetry.maxAggregateConcurrentRssUpperBoundMb = agg;
    if (t.assignedExpansions != null) {
      isolatedProcessTreeTelemetry.totalAssignedExpansions += Number(t.assignedExpansions || 0);
      isolatedProcessTreeTelemetry.maxAssignedExpansionsPerInvocation = Math.max(isolatedProcessTreeTelemetry.maxAssignedExpansionsPerInvocation, Number(t.assignedExpansions || 0));
    }
    if (t.consumedExpansions != null) {
      isolatedProcessTreeTelemetry.totalConsumedExpansions += Number(t.consumedExpansions || 0);
      isolatedProcessTreeTelemetry.maxConsumedExpansionsPerInvocation = Math.max(isolatedProcessTreeTelemetry.maxConsumedExpansionsPerInvocation, Number(t.consumedExpansions || 0));
    }
    isolatedProcessTreeTelemetry.records.push({ ...t, segmentId: execution.segment ? execution.segment.id : (execution.summary && execution.summary.segmentId) });
  };
  const processTreeMemoryForResult = () => {
    const overshoot = Math.max(0, Math.round((isolatedProcessTreeTelemetry.maxAggregateConcurrentRssUpperBoundMb - 256) * 10) / 10);
    return {
      maxPlannerRssDuringIsolatedExecutionMb: isolatedProcessTreeTelemetry.maxPlannerRssDuringIsolatedExecutionMb,
      maxWorkerPeakRssMb: isolatedProcessTreeTelemetry.maxWorkerPeakRssMb,
      maxAggregateConcurrentRssUpperBoundMb: isolatedProcessTreeTelemetry.maxAggregateConcurrentRssUpperBoundMb,
      isolatedInvocationCount: isolatedProcessTreeTelemetry.isolatedInvocationCount,
      assignedExpansionsTotal: isolatedProcessTreeTelemetry.totalAssignedExpansions,
      consumedExpansionsTotal: isolatedProcessTreeTelemetry.totalConsumedExpansions,
      hardCeilingMb: 260,
      stopThresholdMb: 256,
      allowedOvershootMb: 4,
      overshootMb: overshoot,
      qualified: isolatedProcessTreeTelemetry.maxAggregateConcurrentRssUpperBoundMb <= 260 && overshoot <= 4,
    };
  };
  const finishResult = (result) => ({
    ...result,
    searchIntent: config.searchIntent || "skyline",
    budget: summarizeGlobalBudget(globalBudget),
    memory: summarizeMemoryAttempts(result.evaluationAttemptLedger, objectiveConfig),
    processTreeMemory: processTreeMemoryForResult(),
    isolatedProcessTreeTelemetry: { ...isolatedProcessTreeTelemetry },
    executionCompletionLedger: [...executionCompletionLedger],
    // PR-5.24c – top-level repair-scheduling telemetry so FOUND runs (which
    // have no failedSegment) still expose the hypothesis/probe history.
    repairScheduling: lastRepairScheduling,
    objectiveStopPolicy,
  });
  const rangeError = milestoneRangeError(
    milestoneSpec,
    config.fromMilestoneId,
    config.toMilestoneId,
  );
  if (rangeError) {
    return finishResult({
      found: false,
      reachedMilestone: config.fromMilestoneId || null,
      failedSegment: {
        segmentId: config.toMilestoneId || null,
        label: "Invalid milestone range",
        found: false,
        failureClass: "invalid-milestone-range",
        failureReason: rangeError,
        startCandidatesTried: 0,
        candidates: [],
        attempts: [],
        failurePropagation: {
          primaryFailureClass: "invalid-milestone-range",
          failureClass: "invalid-milestone-range",
          recommendedNext: [
            "choose a toMilestone that appears after fromMilestone in the route spec",
          ],
        },
      },
      finalCandidates: [],
      segmentResults: [],
      checkpointResults: [],
      evaluationAttemptLedger: [],
    });
  }
  const segments = milestoneRange(
    milestoneSpec,
    config.fromMilestoneId,
    config.toMilestoneId,
  );
  const graphConfig = objective && segments.length > 0
    ? { ...graphConfigBase, objectiveTerminalSegmentId: segments[segments.length - 1].id }
    : graphConfigBase;
  const checkpointResults = [];
  const configuredInitialFrontier = Array.isArray(config.initialFrontier) && config.initialFrontier.length > 0
    ? config.initialFrontier
    : [{ id: "initial#0", state: initialState, tags: ["initial"] }];
  let frontier = configuredInitialFrontier.map((candidate, index) => {
    const candidateState = candidate && candidate.state ? candidate.state : candidate;
    const initialFrontierState = cloneStateWithoutRouteTrace(candidateState);
    return {
      id: candidate && candidate.id || "initial#" + index,
      state: initialFrontierState,
      route: Array.isArray(candidate && candidate.route)
        ? candidate.route.slice()
        : Array.isArray(candidateState && candidateState.route)
          ? candidateState.route.slice()
          : [],
      trace:
        config.captureTrace === true && Array.isArray(candidate && candidate.trace)
          ? candidate.trace.slice()
          : config.captureTrace === true && Array.isArray(candidateState && candidateState.routeTrace)
            ? candidateState.routeTrace.slice()
            : [],
      hero: candidate && candidate.hero || summarizeHero(candidateState),
      effectiveHero: candidate && candidate.effectiveHero || summarizeEffectiveHero(candidateState),
      tags: Array.isArray(candidate && candidate.tags) ? candidate.tags.slice() : ["initial"],
      score: candidate && candidate.score != null ? candidate.score : goalCandidateScore(candidateState),
    };
  });
  const segmentResults = [];
  const evaluationAttemptLedger = [];
  const appendLedger = (execution, phase) => {
    const summary = execution && execution.summary;
    if (!summary) return;
    (summary.attempts || []).forEach((attempt) => {
      evaluationAttemptLedger.push({
        segmentId: summary.segmentId,
        phase,
        startCandidateId: attempt.startCandidateId,
        found: attempt.found,
        goalCount: attempt.goalCount,
        diagnostics: attempt.diagnostics,
      });
    });
  };
  // Iteration 4 Repair 3 – run-wide execution completion ledger.
  // Every real runSegmentAgainstFrontier execution (initial, configured-repair,
  // adaptive-expand, adaptive-replay, expanded-previous, retry-current) appends
  // its OWN final candidate completion here. Adaptive executions that never
  // reach segmentResults (repair failed without memory failure) are therefore
  // still visible to run-wide exhaustion semantics. Conservative by design:
  // an adaptive execution with finalPending > 0 keeps the whole canonical run
  // from claiming EXHAUSTED, even if a later execution re-ran the same input
  // (supersession can come later if the false-negative ever matters).
  const executionCompletionLedger = [];
  const appendExecutionCompletion = (execution, phase) => {
    const summary = execution && execution.summary;
    if (!summary) return;
    const t = summary.candidateSliceTelemetry || null;
    // Iteration 6 (terminalIncomplete attribution) – classify the completion
    // source so terminal incompleteness is never conflated:
    //   not-run-budget-exhausted  execution never spawned (pre-spawn stop)
    //   unknown-completion         telemetry missing (fail-closed bug signal)
    //   (absent)                   a genuinely executed search
    let completionSource = null;
    if (t && summary.executionNotRunReason) {
      completionSource = "not-run-budget-exhausted";
    } else if (!t) {
      completionSource = "unknown-completion";
    }
    // Iteration 5 (P2 from `4246468` review) – fail-closed unknown completion.
    // An execution without candidateSliceTelemetry has UNKNOWN final completion.
    // It must surface as terminal incompleteness (INCOMPLETE_SCOPE for the run)
    // instead of silently defaulting to 0/complete.
    executionCompletionLedger.push({
      phase,
      segmentId: summary.segmentId || null,
      found: Boolean(summary.found),
      completionSource,
      executionNotRunReason: summary.executionNotRunReason || null,
      finalFound: t ? Number(t.candidateSliceFinalFound || 0) : null,
      finalComplete: t ? Number(t.candidateSliceFinalComplete || 0) : null,
      finalPending: t ? Number(t.candidateSliceFinalPending || 0) : null,
      terminalIncomplete: t
        ? Number(t.candidateSliceTerminalIncomplete || 0)
        : 1,
      searchComplete: t ? Boolean(t.candidateSliceSearchComplete) : false,
      historicalLocalTimeouts: t ? Number(t.candidateSliceLocalTimeouts || 0) : null,
      historicalLocalExpansionStops: t ? Number(t.candidateSliceLocalExpansionStops || 0) : null,
      // Iteration 5 Repair (P1, pre-commit review) – compaction proof passthrough:
      // compacted adaptive executions carry a completion snapshot taken at
      // compaction time; the production-path gate asserts ledger === proof.
      compactCompletionProof: execution.compactCompletionProof || null,
    });
  };
  const memoryLimitedSummary = (execution) => ({
    ...(execution && execution.summary || {}),
    found: Boolean(execution && execution.merged && execution.merged.length > 0),
    failureClass: "memory-limited",
    failureReason: `search stopped after ${execution && execution.memoryStopReason}`,
    failurePropagation: {
      primaryFailureClass: "memory-limited",
      failureClass: "memory-limited",
      reason: `search stopped after ${execution && execution.memoryStopReason}`,
      recommendedNext: [
        "raise the soft memory cap before attempting another segment or repair phase",
      ],
    },
  });
  const upsertSegmentSummary = (summary) => {
    const index = segmentResults.findIndex((entry) => entry.segmentId === summary.segmentId);
    if (index >= 0) segmentResults[index] = summary;
    else segmentResults.push(summary);
  };
  const upsertCheckpoint = (execution) => {
    if (!execution || !execution.merged || execution.merged.length === 0) return;
    const checkpoint = buildMilestoneCheckpoint(execution.segment, execution);
    const index = checkpointResults.findIndex((entry) => entry.segmentId === checkpoint.segmentId);
    if (index >= 0) checkpointResults[index] = checkpoint;
    else checkpointResults.push(checkpoint);
  };
  const finishMemoryLimited = (execution, executionSegmentIndex, fallbackCandidates, options = {}) => {
    const summary = memoryLimitedSummary(execution);
    upsertSegmentSummary(summary);
    upsertCheckpoint(execution);
    const retainedCandidates = (execution && execution.merged) || [];
    const finalSegment = executionSegmentIndex >= segments.length - 1;
    const found = finalSegment && retainedCandidates.length > 0;
    const finalCandidates = retainedCandidates.length > 0
      ? rankFinalCandidates(retainedCandidates, config.qualityFloor || null, config.objectiveSpec || null)
      : (fallbackCandidates || []);
    const deepestHistoryMilestone = history.length > 0 ? history[history.length - 1].segment.id : null;
    const reachedMilestone = retainedCandidates.length > 0
      ? execution.segment.id
      : (options.reachedMilestone || deepestHistoryMilestone || (execution && execution.segment && execution.segment.startFrom) || null);
    return finishResult({
      found,
      reachedMilestone,
      failedSegment: found ? null : summary,
      finalCandidate: found ? finalCandidates[0] : null,
      finalCandidates,
      segmentResults,
      checkpointResults,
      evaluationAttemptLedger,
    });
  };
  // PR-5.24c – the most recent adaptive repair's scheduling telemetry, also
  // exposed on successful (FOUND) runs.
  let lastRepairScheduling = null;
  const history = [];
  const shouldStop = typeof config.shouldStop === "function"
    ? config.shouldStop
    : () => false;
  for (
    let segmentIndex = 0;
    segmentIndex < segments.length;
    segmentIndex += 1
  ) {
    if (shouldStop()) {
      const cancelledSummary = {
        segmentId: segments[segmentIndex].id,
        label: segments[segmentIndex].label || null,
        found: false,
        failureClass: "cancelled",
        failureReason: "cancel-requested",
        failurePropagation: {
          primaryFailureClass: "cancelled",
          failureClass: "cancelled",
          reason: "cancel-requested",
        },
        startCandidatesTried: 0,
        candidates: [],
        attempts: [],
      };
      return finishResult({
        found: false,
        reachedMilestone: segments[segmentIndex].startFrom || null,
        failedSegment: cancelledSummary,
        finalCandidates: frontier || [],
        segmentResults: [...segmentResults, cancelledSummary],
        checkpointResults,
        evaluationAttemptLedger,
        stoppedReason: "cancel-requested",
        cancelled: true,
      });
    }
    if (typeof global.gc === "function") {
      try { global.gc(); } catch (_) {}
    }
    const segment = segments[segmentIndex];
    const execution = runSegmentAgainstFrontier(
      simulator,
      segment,
      frontier,
      {
        ...graphConfig,
        segmentIndex,
        segmentTotal: segments.length,
        goalDependencySegments: segments.slice(segmentIndex),
      },
      withManualBudgetAuthority(graphConfig, {
        candidateLimit: graphConfig.candidateLimit != null ? graphConfig.candidateLimit : undefined,
      }),
    );
    appendLedger(execution, "initial");
    appendExecutionCompletion(execution, "initial");
    recordIsolatedTelemetry(execution);
    if (execution.merged.length === 0) {
      if (execution.memoryLimited && (graphConfig.searchIntent !== "adaptive-feasible" || graphConfig.enableFailureBacktracking === false)) {
        return finishMemoryLimited(execution, segmentIndex, frontier);
      }
      const configuredRepair = tryRepairFromConfiguredMilestone(
        simulator,
        segments,
        segmentIndex,
        history,
        execution,
        graphConfig,
      );
      if (configuredRepair && configuredRepair.repairedCurrent) {
        appendLedger(configuredRepair.repairedCurrent, "configured-repair");
        appendExecutionCompletion(configuredRepair.repairedCurrent, "configured-repair");
        recordIsolatedTelemetry(configuredRepair.repairedCurrent);
      }
      if (configuredRepair && configuredRepair.repairedCurrent && configuredRepair.repairedCurrent.memoryLimited) {
        return finishMemoryLimited(configuredRepair.repairedCurrent, segmentIndex, frontier);
      }
      if (configuredRepair && configuredRepair.found) {
        checkpointResults.push(
          buildMilestoneCheckpoint(segment, configuredRepair.repairedCurrent),
        );
        segmentResults.push(configuredRepair.repairedCurrent.summary);
        history.push({
          segment,
          inputFrontier: configuredRepair.repairedCurrent.inputFrontier,
          merged: configuredRepair.repairedCurrent.merged,
          summary: configuredRepair.repairedCurrent.summary,
          repairExpanded: true,
        });
        frontier = configuredRepair.repairedCurrent.merged;
        continue;
      }
      const adaptiveRepair = tryAdaptiveCheckpointRepair(
        simulator,
        segments,
        segmentIndex,
        history,
        execution,
        graphConfig,
      );
      if (adaptiveRepair) {
        if (adaptiveRepair.repairScheduling) {
          lastRepairScheduling = adaptiveRepair.repairScheduling;
        }
        (adaptiveRepair.ledgerExecutions || adaptiveRepair.executions).forEach((entry, index) => {
          // Iteration 5 Repair (P2, phase fidelity) – the phase comes from the
          // execution source itself (stamped at push time), so multi-wave
          // repairs label each wave's expand entry correctly. The index-based
          // inference remains only as a legacy fallback for unstamped entries.
          const entryPhase =
            entry && entry.executionPhase
              ? entry.executionPhase
              : index === 0 ? "adaptive-expand" : "adaptive-replay";
          appendLedger(entry, entryPhase);
          appendExecutionCompletion(entry, entryPhase);
          recordIsolatedTelemetry(entry);
        });
        // Also record any memoryExecution not in ledgerExecutions (when present, it is same as one entry, but ensure)
        if (adaptiveRepair.memoryExecution) recordIsolatedTelemetry(adaptiveRepair.memoryExecution);
      }
      if (adaptiveRepair && adaptiveRepair.found) {
        const anchorIndex = adaptiveRepair.anchorHistoryIndex;
        history.splice(anchorIndex);
        segmentResults.splice(anchorIndex);
        checkpointResults.splice(anchorIndex);
        adaptiveRepair.executions.forEach((repairedExecution) => {
          segmentResults.push(repairedExecution.summary);
          checkpointResults.push(
            buildMilestoneCheckpoint(repairedExecution.segment, repairedExecution),
          );
          history.push({
            segment: repairedExecution.segment,
            inputFrontier: repairedExecution.inputFrontier,
            merged: repairedExecution.merged,
            summary: repairedExecution.summary,
            repairExpanded: true,
          });
        });
        frontier = adaptiveRepair.finalFrontier;
        continue;
      }
      if (adaptiveRepair && !adaptiveRepair.found) {
        if (adaptiveRepair.memoryExecution) {
          const failureSummary = memoryLimitedSummary(adaptiveRepair.memoryExecution);
          failureSummary.backtrack = {
            attempted: true,
            repaired: false,
            mode: "adaptive-checkpoint-window",
            maxDepth: adaptiveRepair.maxDepth || (graphConfig && graphConfig.adaptiveBacktrackDepth) || 3,
            triggerFailure: adaptiveRepair.triggerFailure,
            failureIntentRanking: adaptiveRepair.failureIntentRanking || null,
            repairScheduling: adaptiveRepair.repairScheduling || null,
            attempts: adaptiveRepair.attempts || [],
            depthSummaries: adaptiveRepair.depthSummaries || [],
            depths: adaptiveRepair.depthSummaries || [],
            memoryRecoveryAttempted: adaptiveRepair.memoryRecoveryAttempted,
            memoryRecovered: adaptiveRepair.memoryRecovered,
            preGcRssMb: adaptiveRepair.preGcRssMb,
            postGcRssMb: adaptiveRepair.postGcRssMb,
          };
          upsertSegmentSummary(failureSummary);
          return finishMemoryLimited(
            { ...adaptiveRepair.memoryExecution, summary: failureSummary },
            adaptiveRepair.memorySegmentIndex,
            frontier,
          );
        }
        if (execution && execution.summary) {
          execution.summary.backtrack = {
            attempted: true,
            repaired: false,
            mode: "adaptive-checkpoint-window",
            maxDepth: adaptiveRepair.maxDepth || (graphConfig && graphConfig.adaptiveBacktrackDepth) || 3,
            triggerFailure: adaptiveRepair.triggerFailure,
            failureIntentRanking: adaptiveRepair.failureIntentRanking || null,
            repairScheduling: adaptiveRepair.repairScheduling || null,
            attempts: adaptiveRepair.attempts || [],
            depthSummaries: adaptiveRepair.depthSummaries || [],
            depths: adaptiveRepair.depthSummaries || [],
            memoryRecoveryAttempted: adaptiveRepair.memoryRecoveryAttempted,
            memoryRecovered: adaptiveRepair.memoryRecovered,
            preGcRssMb: adaptiveRepair.preGcRssMb,
            postGcRssMb: adaptiveRepair.postGcRssMb,
          };
        }
      }
      const repair = adaptiveRepair
        ? null
        : tryRepairFromPreviousMilestone(
          simulator,
          segments,
          segmentIndex,
          history,
          execution,
          graphConfig,
        );
      if (repair && repair.expandedPrevious) {
        appendLedger(repair.expandedPrevious, "expanded-previous");
        appendExecutionCompletion(repair.expandedPrevious, "expanded-previous");
        recordIsolatedTelemetry(repair.expandedPrevious);
      }
      if (repair && repair.repairedCurrent) {
        appendLedger(repair.repairedCurrent, "retry-current");
        appendExecutionCompletion(repair.repairedCurrent, "retry-current");
        recordIsolatedTelemetry(repair.repairedCurrent);
      }
      if (repair && repair.repairedCurrent && repair.repairedCurrent.memoryLimited) {
        if (repair.expandedPrevious) {
          upsertSegmentSummary(repair.expandedPrevious.summary);
          upsertCheckpoint(repair.expandedPrevious);
        }
        return finishMemoryLimited(repair.repairedCurrent, segmentIndex, frontier);
      }
      if (repair && repair.expandedPrevious && repair.expandedPrevious.memoryLimited) {
        return finishMemoryLimited(repair.expandedPrevious, segmentIndex - 1, frontier);
      }
      if (repair && repair.found) {
        if (checkpointResults.length > 0) checkpointResults.pop();
        checkpointResults.push(
          buildMilestoneCheckpoint(
            repair.expandedPrevious.segment,
            repair.expandedPrevious,
          ),
        );
        checkpointResults.push(
          buildMilestoneCheckpoint(segment, repair.repairedCurrent),
        );
        const previousIndex = segmentResults.length - 1;
        if (previousIndex >= 0)
          segmentResults[previousIndex] = repair.expandedPrevious.summary;
        segmentResults.push(repair.repairedCurrent.summary);
        history[history.length - 1] = {
          segment: repair.expandedPrevious.segment,
          inputFrontier: repair.expandedPrevious.inputFrontier,
          merged: repair.expandedPrevious.merged,
          summary: repair.expandedPrevious.summary,
          repairExpanded: true,
        };
        history.push({
          segment,
          inputFrontier: repair.repairedCurrent.inputFrontier,
          merged: repair.repairedCurrent.merged,
          summary: repair.repairedCurrent.summary,
        });
        frontier = repair.repairedCurrent.merged;
        continue;
      }
      const failedSummary = execution.summary;
      if (configuredRepair) {
        failedSummary.backtrack = {
          attempted: true,
          repaired: false,
          mode: "configured-milestone-window",
          repairedCurrent: configuredRepair.repairedCurrent && {
            segmentId: configuredRepair.repairedCurrent.segment.id,
            found: configuredRepair.repairedCurrent.merged.length > 0,
          },
        };
      }
      if (repair) {
        failedSummary.backtrack = {
          attempted: true,
          repaired: false,
          expandedPrevious: repair.expandedPrevious && {
            segmentId: repair.expandedPrevious.segment.id,
            candidates: compactSegmentCandidates(
              repair.expandedPrevious.merged,
            ),
          },
          repairedCurrent: repair.repairedCurrent && {
            segmentId: repair.repairedCurrent.segment.id,
            found: repair.repairedCurrent.merged.length > 0,
          },
        };
      }
      if (adaptiveRepair) {
        failedSummary.backtrack = {
          attempted: true,
          repaired: false,
          mode: "adaptive-checkpoint-window",
          maxDepth: numericOption(graphConfig.adaptiveBacktrackDepth, 3),
          triggerFailure: adaptiveRepair.triggerFailure,
          failureIntentRanking: adaptiveRepair.failureIntentRanking || null,
          repairScheduling: adaptiveRepair.repairScheduling || null,
          attempts: adaptiveRepair.attempts,
          depthSummaries: adaptiveRepair.depthSummaries || [],
          depths: adaptiveRepair.depthSummaries || [],
        };
      }
      segmentResults.push(failedSummary);
      return finishResult({
        found: false,
        reachedMilestone: segment.startFrom || null,
        failedSegment: segmentResults[segmentResults.length - 1],
        finalCandidates: frontier,
        segmentResults,
        checkpointResults,
        evaluationAttemptLedger,
      });
    }
    if (execution.memoryLimited) {
      return finishMemoryLimited(execution, segmentIndex, frontier);
    }
    segmentResults.push(execution.summary);
    checkpointResults.push(buildMilestoneCheckpoint(segment, execution));
    history.push({
      segment,
      inputFrontier: frontier,
      merged: execution.merged,
      summary: execution.summary,
    });
    frontier = execution.merged;
  }
  frontier = rankFinalCandidates(frontier, config.qualityFloor || null, config.objectiveSpec || null);
  const final = frontier[0] || null;
  if (
    final &&
    config.qualityFloor &&
    !candidateMeetsQualityFloor(final, config.qualityFloor)
  ) {
    const finalSegment = segments[segments.length - 1] || null;
    const failedSummary = buildQualityFloorFailure(
      finalSegment,
      frontier,
      config.qualityFloor,
      config.objectiveSpec || null,
    );
    segmentResults.push(failedSummary);
    return finishResult({
      found: false,
      reachedMilestone: finalSegment && (finalSegment.startFrom || null),
      failedSegment: failedSummary,
      finalCandidates: frontier,
      segmentResults,
      checkpointResults,
      evaluationAttemptLedger,
      qualityFloor: {
        passed: false,
        floor: config.qualityFloor,
      },
    });
  }
  return finishResult({
    found: Boolean(final),
    reachedMilestone: segments.length ? segments[segments.length - 1].id : null,
    failedSegment: null,
    finalCandidate: final,
    finalCandidates: frontier,
    segmentResults,
    checkpointResults,
    evaluationAttemptLedger,
    qualityFloor: config.qualityFloor
      ? {
          passed: Boolean(final),
          floor: config.qualityFloor,
        }
      : null,
    objective: objective && final
      ? objective.evaluateState(final.state)
      : null,
  });
}

module.exports = {
  buildSegmentActionProvider,
  buildSegmentGoalPredicate,
  effectiveSegmentBudgets,
  manualSearchOverrides,
  resolveStartCandidateLimit,
  resolveSearchIntentOptions,
  runMilestoneGraph,
  runSegmentAgainstFrontier,
  runSegmentAgainstFrontierLocal,
  createGlobalBudget,
  summarizeGlobalBudget,
  searchSegmentDP,
  segmentCandidateLimit,
  summarizeEffectiveHero,
  summarizeHero,
  summarizeSegmentFailure,
  withManualBudgetAuthority,
  projectSegmentGoalProgress,
  isReplayDeterminatelyComplete,
  classifyAdaptiveHypothesisOutcome,
  buildRepairedHistoryHypotheses,
  __testHooks: {
    allocateGlobalAttemptBudget,
    buildRepairedHistoryHypotheses,
    BLOCKER_TILE_NUMBER: reachAndBattleOracle.BLOCKER_TILE_NUMBER,
    isTileBlocking: reachAndBattleOracle.isTileBlocking,
    closeStateForBattleFrontier:
      reachAndBattleOracle.closeStateForBattleFrontier,
    protectPresentTiles: reachAndBattleOracle.protectPresentTiles,
    restorePresentTiles: reachAndBattleOracle.restorePresentTiles,
    enumerateMonsterTargets: reachAndBattleOracle.enumerateMonsterTargets,
    oracleFindFloorState: reachAndBattleOracle.oracleFindFloorState,
    oracleFindFloorStates: reachAndBattleOracle.oracleFindFloorStates,
    tryReachAndBattle: reachAndBattleOracle.tryReachAndBattle,
    buildMonsterOnlyActionProvider:
      reachAndBattleOracle.buildMonsterOnlyActionProvider,
    actionTargetsProtectedTile,
    buildSegmentStateFeasibilityPredicate,
    isAllowedAction,
    isAllowedChangeFloor,
    resolveActionTargetFloorId,
    projectSegmentGoalProgress,
    selectCandidateSkyline,
    rankCandidatesByPreferredTags,
    rankCandidatesByFailureIntent,
    classifySegmentFailure,
  },
};
