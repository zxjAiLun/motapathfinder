"use strict";

const { estimateBattleSurvivability } = require("./battle-thresholds");
const { getFloorOrder } = require("./floor-id");
const { cloneState, getTileDefinitionAt } = require("./state");

const BLOCKER_TILE_NUMBER = 1;

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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

function effectiveHeroValue(state, field) {
  const hero = (state || {}).hero || {};
  const flags = (state || {}).flags || {};
  return Math.floor(
    number(hero[field], 0) * number(flags[`__${field}_buff__`], 1),
  );
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

function parseChangeFloorSummary(summary) {
  const match = /^changeFloor@([^:]+):(\d+),(\d+)$/.exec(summary || "");
  return match ? `${match[1]}:${match[2]},${match[3]}` : null;
}

function isAllowedChangeFloor(action, state, policy) {
  const allowed = new Set((policy.allowChangeFloors || []).map(String));
  const changeKey = parseChangeFloorSummary(action.summary);
  if (changeKey && allowed.has(changeKey)) return true;
  const floorId = action.floorId || state.floorId;
  if (policy.allowedFloors && !policy.allowedFloors.includes(floorId))
    return false;
  const targetFloor = action.changeFloor && action.changeFloor.floorId;
  return (
    !targetFloor ||
    !policy.allowedFloors ||
    policy.allowedFloors.includes(targetFloor)
  );
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

function isTileBlocking(project, tileNumber) {
  const def = project.mapTilesByNumber[String(tileNumber)];
  if (!def) return false;
  if (def.cls && def.cls.indexOf("enemy") === 0) return false;
  if (def.trigger === "openDoor") return false;
  if (def.cls === "items") return false;
  return def.canPass !== true;
}

function protectPresentTiles(project, state, segment) {
  const goal = (segment || {}).goal || {};
  const saved = [];
  for (const required of goal.presentTiles || []) {
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
        const isProtected = (goal.presentTiles || []).some(
          (p) => `${p.floorId}:${p.x},${p.y}` === preservedKey,
        );
        if (isProtected) continue;

        targets.push({
          kind: "battle",
          summary: `battle:${enemyId}@${floorId}:${x},${y}`,
          floorId,
          x,
          y,
          enemyId,
          monsterTarget: true,
        });
      }
    }
  }

  return targets;
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
    .sort(
      (left, right) =>
        summarizeHero(right.state).hp - summarizeHero(left.state).hp,
    )
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
      const actionTileKey = parseActionTileKey(action.summary);
      const hitsProtected = (goal.presentTiles || []).some(
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
      } catch (error) {}
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
  const results = [];
  for (const floorResult of floorResults) {
    const closed = floorResult.state;
    const travelActions = floorResult.travelActions;
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
        const routePatch = travelActions.concat(battleAction);
        results.push({
          postState,
          battleAction,
          routePatch,
          preHp: nodeState.hero ? nodeState.hero.hp : 0,
        });
      } catch (error) {}
    }
  }

  if (results.length === 0)
    return { ok: false, reason: "battle-not-reachable" };
  if (stats)
    stats.successorCandidatesBeforeCap =
      Number(stats.successorCandidatesBeforeCap || 0) + results.length;
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

function matchesSpecialTarget(summary, specialTargets) {
  if (!summary || !Array.isArray(specialTargets) || specialTargets.length === 0)
    return null;
  for (const pattern of specialTargets) {
    if (pattern === summary) return pattern;
    if (pattern.includes("*@")) {
      const prefix = pattern.slice(0, pattern.indexOf("*@"));
      const suffix = pattern.slice(pattern.indexOf("*@") + 1);
      if (summary.startsWith(prefix) && summary.endsWith(suffix)) {
        const middle = summary.slice(
          prefix.length,
          summary.length - suffix.length,
        );
        if (middle.length > 0) return pattern;
      }
    }
  }
  return null;
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
    } catch (error) {}
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
          const isProtected = (goal.presentTiles || []).some(
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

    // Prioritize special targets: sort each group independently, specials first
    const specialPatterns = (config || {}).specialTargets || [];
    let specialVisible = 0;
    let specialAfterCap = 0;

    const byScore = (a, b) =>
      scoreMonsterTarget(simulator, b, state, segment) -
      scoreMonsterTarget(simulator, a, state, segment);

    if (specialPatterns.length > 0) {
      specialVisible = targets.filter((t) =>
        matchesSpecialTarget(t.summary, specialPatterns),
      ).length;
      // Partition, sort each group independently, then concat (specials first)
      const special = [];
      const rest = [];
      for (const target of targets) {
        if (matchesSpecialTarget(target.summary, specialPatterns)) {
          special.push(target);
        } else {
          rest.push(target);
        }
      }
      special.sort(byScore);
      rest.sort(byScore);
      targets.length = 0;
      targets.push(...special, ...rest);
    } else {
      targets.sort(byScore);
    }
    const cappedTargets = targets.slice(0, maxTargets);

    if (specialPatterns.length > 0) {
      specialAfterCap = cappedTargets.filter((t) =>
        matchesSpecialTarget(t.summary, specialPatterns),
      ).length;
    }

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
      if (targets.length > maxTargets)
        stats.statesWithTargetCap = Number(stats.statesWithTargetCap || 0) + 1;
      if (specialPatterns.length > 0) {
        stats.specialTargetVisible =
          Number(stats.specialTargetVisible || 0) + specialVisible;
        stats.specialTargetAfterCap =
          Number(stats.specialTargetAfterCap || 0) + specialAfterCap;
        stats.specialTargetCapDrops =
          Number(stats.specialTargetCapDrops || 0) +
          Math.max(0, specialVisible - specialAfterCap);
      }
    }
    return cappedTargets;
  };
}

module.exports = {
  BLOCKER_TILE_NUMBER,
  buildMonsterOnlyActionProvider,
  closeStateForBattleFrontier,
  enumerateMonsterTargets,
  isTileBlocking,
  oracleFindFloorState,
  oracleFindFloorStates,
  protectPresentTiles,
  restorePresentTiles,
  selectMonsterOnlySuccessors,
  tryReachAndBattle,
};
