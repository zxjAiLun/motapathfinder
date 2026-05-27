"use strict";

const { buildDpStateKey } = require("./dp-search");
const { getFloorOrder } = require("./floor-id");
const { getDecisionDepth, cloneState } = require("./state");
const {
  buildMonsterOnlyActionProvider,
  tryReachAndBattleBatch,
  closeStateForBattleFrontier,
  selectMonsterOnlySuccessors,
} = require("./reach-and-battle-oracle");

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

function routeLength(candidateOrState) {
  if (Array.isArray(candidateOrState && candidateOrState.route))
    return candidateOrState.route.length;
  return getDecisionDepth(candidateOrState || {});
}

function routePatchSummaries(routePatch) {
  return (routePatch || [])
    .map((entry) =>
      typeof entry === "string" ? entry : entry && entry.summary,
    )
    .filter(Boolean);
}

// =========================================================================
// Current-Reachable Battle Successor Enumeration
//
// Only looks at enemies reachable on the CURRENT floor via walk reachability.
// No portal BFS, no floorFly, no all-floor scanning.
// =========================================================================

function enumerateCurrentReachableBattleSuccessors(
  simulator,
  state,
  targets,
  options,
) {
  const config = options || {};
  const maxSuccessorsPerTarget = number(config.maxSuccessorsPerTarget, 4);

  // Build position map for quick adjacency lookup
  const targetByPos = new Map();
  for (const t of targets) {
    if (t.x != null && t.y != null && t.floorId === state.floorId) {
      const key = `${t.x},${t.y}`;
      if (!targetByPos.has(key)) targetByPos.set(key, t);
    }
  }

  if (targetByPos.size === 0) return { ok: true, results: [], diagnostics: {} };

  // Current-floor fast path
  const closed = closeStateForBattleFrontier(simulator, state, {
    goal: {},
    actionPolicy: {},
  });
  const reachability = simulator.getWalkReachability(closed);
  const visited = reachability.visited || {};

  const allResults = [];
  let battleMatchNodes = 0;
  let battleTargetChecks = 0;
  let battleEvaluateCalls = 0;

  const DIRS = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ];

  for (const node of Object.values(visited)) {
    battleMatchNodes += 1;
    const nodeState = node.state;
    const loc = (nodeState.hero && nodeState.hero.loc) || {};
    const nx = Number(loc.x);
    const ny = Number(loc.y);
    if (isNaN(nx) || isNaN(ny)) continue;

    for (const [dx, dy] of DIRS) {
      battleTargetChecks += 1;
      const adjKey = `${nx + dx},${ny + dy}`;
      const matchedTarget = targetByPos.get(adjKey);
      if (!matchedTarget) continue;

      const battleAction = {
        kind: "battle",
        summary: matchedTarget.summary,
        floorId: matchedTarget.floorId,
        target: { x: matchedTarget.x, y: matchedTarget.y },
        enemyId: matchedTarget.enemyId,
      };

      try {
        const postState = simulator.applyAction(nodeState, battleAction, {
          storeRoute: false,
        });
        battleEvaluateCalls += 1;
        allResults.push({
          postState,
          battleAction,
          routePatch: [battleAction],
          preHp: nodeState.hero ? nodeState.hero.hp : 0,
          target: matchedTarget,
        });
      } catch (error) {}
    }
  }

  // Per-target successor selection
  const byTarget = new Map();
  for (const r of allResults) {
    const key = (r.target && r.target.summary) || "?";
    const bucket = byTarget.get(key) || [];
    bucket.push(r);
    if (!byTarget.has(key)) byTarget.set(key, bucket);
  }

  const selectedByTarget = [];
  for (const group of byTarget.values()) {
    const selected = selectMonsterOnlySuccessors(
      simulator,
      group,
      { goal: {}, actionPolicy: {} },
      maxSuccessorsPerTarget,
      null,
    );
    selectedByTarget.push(...selected);
  }

  return {
    ok: true,
    results: selectedByTarget,
    diagnostics: {
      battleMatchNodes,
      battleTargetChecks,
      battleEvaluateCalls,
      reachabilityNodes: Object.keys(visited).length,
      currentFloorTargets: targetByPos.size,
      totalFloorTargets: targets.length,
    },
  };
}

// =========================================================================
// Mobility Successor Enumeration
//
// changeFloor / floorFly as independent macro successors,
// NOT tied to any monster target.
// =========================================================================

function enumerateMobilitySuccessors(simulator, state, options) {
  const config = options || {};
  const discoveryMode = config.portalDiscoveryMode || "legacy";

  let actions = [];
  // changeFloor: respect portalDiscoveryMode for safety
  if (discoveryMode === "fast") {
    const { discoverChangeFloorActions } = require("./reach-and-battle-oracle");
    actions = actions.concat(discoverChangeFloorActions(simulator, state));
  } else {
    const primitive = simulator.enumeratePrimitiveActions(state).actions || [];
    actions = actions.concat(primitive.filter((a) => a.kind === "changeFloor"));
  }

  // floorFly
  if (typeof simulator.enumerateFloorFlyActions === "function") {
    actions = actions.concat(simulator.enumerateFloorFlyActions(state));
  }

  // Dedup by summary
  const seen = new Set();
  const unique = [];
  for (const action of actions) {
    const summary = action.summary || "";
    if (seen.has(summary)) continue;
    seen.add(summary);
    unique.push(action);
  }
  actions = unique;

  const results = [];
  for (const action of actions) {
    try {
      const postState = simulator.applyAction(state, action, {
        storeRoute: false,
      });
      results.push({
        postState,
        action,
        routePatch: [action],
        kind: "mobility",
      });
    } catch (error) {}
  }

  return {
    results,
    diagnostics: {
      mobilityActionsConsidered: actions.length,
      mobilitySuccessors: results.length,
    },
  };
}

// =========================================================================
// Fetch targets for current-reachable mode (current floor only)
// =========================================================================

function fetchCurrentFloorTargets(simulator, state, segment, options) {
  const config = options || {};
  const policy = (segment || {}).actionPolicy || {};
  const goal = (segment || {}).goal || {};
  const project = simulator.project;
  const floor = project.floorsById[state.floorId];
  if (!floor) return [];

  const height =
    floor.height || (Array.isArray(floor.map) ? floor.map.length : 0);
  const width = floor.width || 0;
  const reachableBattleSummaries = new Set();
  try {
    (simulator.enumeratePrimitiveActions(state).actions || [])
      .filter((a) => a.kind === "battle" && a.summary)
      .forEach((a) => reachableBattleSummaries.add(a.summary));
  } catch (e) {}

  const targets = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const { getTileDefinitionAt } = require("./state");
      const tile = getTileDefinitionAt(project, state, state.floorId, x, y);
      if (!tile || !tile.cls || tile.cls.indexOf("enemy") !== 0) continue;
      const enemyId = tile.id;
      if (!enemyId) continue;

      const preservedKey = `${state.floorId}:${x},${y}`;
      const isProtected = (goal.presentTiles || []).some(
        (p) => `${p.floorId}:${p.x},${p.y}` === preservedKey,
      );
      if (isProtected) continue;

      const summary = `battle:${enemyId}@${state.floorId}:${x},${y}`;
      targets.push({
        kind: "battle",
        summary,
        floorId: state.floorId,
        x,
        y,
        enemyId,
        reachableNow: reachableBattleSummaries.has(summary),
        monsterTarget: true,
      });
    }
  }

  // Score sort + special target prioritization
  const {
    scoreMonsterTarget,
    matchesSpecialTarget,
  } = require("./reach-and-battle-oracle");
  const specialPatterns = config.specialTargets || [];
  if (specialPatterns.length > 0) {
    const special = [];
    const rest = [];
    for (const t of targets) {
      if (matchesSpecialTarget(t.summary, specialPatterns)) special.push(t);
      else rest.push(t);
    }
    special.sort(
      (a, b) =>
        scoreMonsterTarget(simulator, b, state, {
          goal,
          actionPolicy: policy,
        }) -
        scoreMonsterTarget(simulator, a, state, { goal, actionPolicy: policy }),
    );
    rest.sort(
      (a, b) =>
        scoreMonsterTarget(simulator, b, state, {
          goal,
          actionPolicy: policy,
        }) -
        scoreMonsterTarget(simulator, a, state, { goal, actionPolicy: policy }),
    );
    targets.length = 0;
    targets.push(...special, ...rest);
  } else {
    targets.sort(
      (a, b) =>
        scoreMonsterTarget(simulator, b, state, {
          goal,
          actionPolicy: policy,
        }) -
        scoreMonsterTarget(simulator, a, state, { goal, actionPolicy: policy }),
    );
  }

  const maxTargets = number(config.maxTargetsPerState, 24);
  return targets.slice(0, maxTargets);
}

module.exports = {
  enumerateCurrentReachableBattleSuccessors,
  enumerateMobilitySuccessors,
  fetchCurrentFloorTargets,
};
