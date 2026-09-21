"use strict";

/**
 * PR-5.29b — Forward Blocker Feasibility Audit (Shadow-Only).
 *
 * Formal 4-Tier Analysis:
 *   Tier 1 (Forward Cut): Reachable free region -> forward boundary interactions ->
 *          topological proof of whether unexecutable blockers form an inescapable cut.
 *   Tier 2 (Deficit Vectors): For each blocker, compute mathematical resource deficit
 *          (minAtkForPositiveDamage, hpDeficit, defDeficit, expToLevel).
 *   Tier 3 (Preparation Envelope): Compute reachable capability envelope from current
 *          state across current and accessible past floors (gems, potions, viable monster EXP).
 *   Tier 4 (Classification): Categorize root bottleneck into one of four causal classes:
 *          A. no-forward-cut
 *          B. resource-feasibility-deficit
 *          C. preparation-available-but-not-realized
 *          D. capability-realized-but-not-propagated
 */

const { getFloorOrder, estimateGoalRelativeDistance, estimateNextFloorDistance } = require("./score");
const { cloneState } = require("./state");

const SCHEMA = "motapathfinder.forward-blocker-feasibility-audit.v1";

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// ---------------------------------------------------------------------------
// Helpers: Item stat values & Level-Up projections
// ---------------------------------------------------------------------------

function getItemStatGain(project, itemId) {
  const v = project.values || {};
  const ratio = 1;
  if (itemId === "redGem") return { hp: 0, atk: number(v.redGem, 1) * ratio, def: 0, exp: 0 };
  if (itemId === "blueGem") return { hp: 0, atk: 0, def: number(v.blueGem, 1) * ratio, exp: 0 };
  if (itemId === "greenGem") return { hp: 0, atk: 0, def: 0, exp: 0 };
  if (itemId === "I576") return { hp: 0, atk: number(v.redGem, 1) * 2 * ratio, def: 0, exp: 0 }; // 高阶红宝石 (+2)
  if (itemId === "I584") return { hp: 0, atk: number(v.redGem, 1) * 5 * ratio, def: 0, exp: 0 }; // 极品红宝石 (+5)
  if (itemId === "I635") return { hp: 0, atk: number(v.redGem, 1) * 10 * ratio, def: 0, exp: 0 }; // 殿堂红宝石 (+10)
  if (itemId === "redPotion") return { hp: number(v.redPotion, 100) * ratio, atk: 0, def: 0, exp: 0 };
  if (itemId === "bluePotion") return { hp: number(v.bluePotion, 200) * ratio, atk: 0, def: 0, exp: 0 };
  if (itemId === "yellowPotion") return { hp: number(v.yellowPotion, 400) * ratio, atk: 0, def: 0, exp: 0 };
  if (itemId === "greenPotion") return { hp: number(v.greenPotion, 800) * ratio, atk: 0, def: 0, exp: 0 };
  if (itemId === "poisonWine") return { hp: number(v.greenPotion, 800) * 2 * ratio, atk: 0, def: 0, exp: 0 };
  if (itemId === "weakWine") return { hp: number(v.greenPotion, 800) * 4 * ratio, atk: 0, def: 0, exp: 0 };
  if (itemId === "I572") return { hp: number(v.greenPotion, 800) * 8 * ratio, atk: 0, def: 0, exp: 0 };
  if (itemId === "I619") return { hp: number(v.greenPotion, 800) * 32 * ratio, atk: 0, def: 0, exp: 0 };
  if (itemId === "I621") return { hp: number(v.greenPotion, 800) * 128 * ratio, atk: 0, def: 0, exp: 0 };
  return { hp: 0, atk: 0, def: 0, exp: 0 };
}

function projectLevelUps(project, currentLv, currentExp, additionalExp) {
  const totalExp = currentExp + additionalExp;
  const levelUpTable = (project.data && project.data.firstData && project.data.firstData.levelUp) || [];
  let projectedLv = currentLv;
  let gainedAtk = 0;
  let gainedDef = 0;

  for (let lv = currentLv + 1; lv < levelUpTable.length; lv++) {
    const entry = levelUpTable[lv];
    if (entry && totalExp >= entry.need) {
      projectedLv = lv;
      if (Array.isArray(entry.action)) {
        for (const act of entry.action) {
          if (act.type === "setValue") {
            if (act.name === "status:atk") gainedAtk += number(act.value, 0);
            if (act.name === "status:def") gainedDef += number(act.value, 0);
          }
        }
      }
    } else {
      break;
    }
  }

  const nextLevelEntry = levelUpTable[projectedLv + 1] || null;
  const expToNextLevel = nextLevelEntry ? Math.max(0, nextLevelEntry.need - totalExp) : null;

  return {
    projectedLv,
    levelsGained: projectedLv - currentLv,
    gainedAtk,
    gainedDef,
    totalExp,
    expToNextLevel,
  };
}

// ---------------------------------------------------------------------------
// Tier 1: Reachable Free Region & Boundary Interactions
// ---------------------------------------------------------------------------

function computeReachableFloorRegion(simulator, state) {
  const project = simulator.project;
  const floorId = state.floorId;
  const floor = project.floorsById[floorId];
  if (!floor) return { reachableTiles: new Set(), boundaryObstacles: new Map() };

  const floorState = (state.floorStates && state.floorStates[floorId]) || { removed: {} };
  const removed = floorState.removed || {};

  const startLoc = `${state.hero.loc.x},${state.hero.loc.y}`;
  const reachableTiles = new Set([startLoc]);
  const boundaryObstacles = new Map(); // loc -> { x, y, tileId, cls, name, enemy }

  const q = [{ x: state.hero.loc.x, y: state.hero.loc.y }];

  while (q.length > 0) {
    const { x, y } = q.shift();
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= floor.width || ny >= floor.height) continue;
      const nkey = `${nx},${ny}`;
      if (reachableTiles.has(nkey)) continue;

      const num = floor.map[ny][nx];
      if (num === 0 || removed[nkey]) {
        reachableTiles.add(nkey);
        q.push({ x: nx, y: ny });
        continue;
      }

      const tile = project.mapTilesByNumber[String(num)];
      if (!tile || tile.id === "blueWall") continue;

      if (tile.id === "downFloor" || tile.id === "upFloor" || tile.cls === "items") {
        reachableTiles.add(nkey);
        q.push({ x: nx, y: ny });
      } else {
        // Obstacle bordering the reachable free region
        const enemy = project.enemysById[tile.id] || null;
        boundaryObstacles.set(nkey, {
          x: nx,
          y: ny,
          loc: nkey,
          tileId: tile.id,
          cls: tile.cls,
          name: tile.name || tile.id,
          enemy,
        });
      }
    }
  }

  return { reachableTiles, boundaryObstacles };
}

// ---------------------------------------------------------------------------
// Tier 2: Deficit Vector Computation for Boundary Obstacles
// ---------------------------------------------------------------------------

function evaluateBoundaryObstacleDeficits(simulator, state, obstacle) {
  const hero = state.hero || {};
  const heroHp = number(hero.hp, 0);
  const heroAtk = number(hero.atk, 0);
  const heroDef = number(hero.def, 0);

  if (obstacle.cls === "enemys" && obstacle.enemy) {
    const enemy = obstacle.enemy;
    const enemyDef = number(enemy.def, 0);
    const enemyAtk = number(enemy.atk, 0);
    const enemyHp = number(enemy.hp, 0);

    const minAtkForPositiveDamage = enemyDef + 1;
    const atkDeficit = Math.max(0, minAtkForPositiveDamage - heroAtk);

    // Battle simulation
    let battleSupported = true;
    let damage = null;
    let turns = null;
    let heroPerDamage = 0;
    let monsterPerDamage = 0;

    try {
      const res = simulator.battleResolver.evaluateBattle(state, state.floorId, obstacle.x, obstacle.y, obstacle.tileId);
      battleSupported = res && res.supported !== false;
      if (res && res.damageInfo) {
        damage = res.damageInfo.damage;
        turns = res.damageInfo.turn;
        heroPerDamage = res.damageInfo.hero_per_damage;
        monsterPerDamage = res.damageInfo.per_damage;
      }
    } catch (_e) {
      battleSupported = false;
    }

    let status = "unsupported";
    if (damage == null) {
      status = "unbeatable-at-current-stats";
    } else if (damage >= heroHp) {
      status = "lethal-at-current-hp";
    } else {
      status = "viable-at-current-state";
    }

    const hpDeficit = damage != null ? Math.max(0, damage + 1 - heroHp) : Infinity;

    return {
      kind: "battle",
      obstacle,
      status,
      battleSupported,
      enemy: { id: obstacle.tileId, name: obstacle.name, hp: enemyHp, atk: enemyAtk, def: enemyDef, exp: enemy.exp || 0 },
      deficits: {
        minAtkForPositiveDamage,
        atkDeficit,
        damage,
        turns,
        hpDeficit: Number.isFinite(hpDeficit) ? hpDeficit : null,
        positiveDamagePossible: heroAtk > enemyDef,
      },
      executable: status === "viable-at-current-state",
    };
  }

  if (obstacle.tileId && obstacle.tileId.includes("Door")) {
    const reqKeys = (obstacle.tileId.startsWith("yellow") && "yellowKey") ||
      (obstacle.tileId.startsWith("blue") && "blueKey") ||
      (obstacle.tileId.startsWith("green") && "greenKey") || "special";
    const available = number((state.inventory || {})[reqKeys], 0);
    const keyDeficit = Math.max(0, 1 - available);
    return {
      kind: "door",
      obstacle,
      status: keyDeficit === 0 ? "viable-at-current-state" : "key-deficit",
      deficits: { requiredKey: reqKeys, keyDeficit },
      executable: keyDeficit === 0,
    };
  }

  return {
    kind: "other",
    obstacle,
    status: "unknown",
    deficits: {},
    executable: false,
  };
}

// ---------------------------------------------------------------------------
// Tier 1 (Continued): Topological Forward Cut Proof
// ---------------------------------------------------------------------------

function proveForwardCut(project, floorId, startLoc, goalLoc, evaluatedObstacles) {
  const floor = project.floorsById[floorId];
  if (!floor) return { forwardCutEstablished: false, reason: "floor not found" };

  const [gx, gy] = goalLoc.split(",").map(Number);
  const [sx, sy] = startLoc.split(",").map(Number);

  const unexecutableBlockerLocs = new Set(
    evaluatedObstacles.filter((o) => !o.executable).map((o) => `${o.obstacle.x},${o.obstacle.y}`),
  );

  // BFS 1: Is goal reachable from start when unexecutable blockers are treated as IMPASSABLE?
  function isReachable(blockedSet) {
    const visited = new Set([startLoc]);
    const q = [{ x: sx, y: sy }];
    while (q.length > 0) {
      const { x, y } = q.shift();
      if (x === gx && y === gy) return true;
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= floor.width || ny >= floor.height) continue;
        const nkey = `${nx},${ny}`;
        if (visited.has(nkey)) continue;

        if (blockedSet.has(nkey)) continue;

        const num = floor.map[ny][nx];
        if (num === 0) {
          visited.add(nkey);
          q.push({ x: nx, y: ny });
          continue;
        }

        const tile = project.mapTilesByNumber[String(num)];
        if (!tile || tile.id === "blueWall") continue;

        visited.add(nkey);
        q.push({ x: nx, y: ny });
      }
    }
    return false;
  }

  // Reachable with ALL non-walls passable (does a path exist at all)?
  const pathExistsWithoutBlockers = isReachable(new Set());
  // Reachable when unexecutable blockers are blocked?
  const pathExistsWithBlockers = isReachable(unexecutableBlockerLocs);

  const forwardCutEstablished = pathExistsWithoutBlockers && !pathExistsWithBlockers;

  return {
    forwardCutEstablished,
    pathExistsWithoutBlockers,
    pathExistsWithBlockers,
    unexecutableBlockersCount: unexecutableBlockerLocs.size,
    cutBlockers: evaluatedObstacles.filter((o) => !o.executable),
    hasLegalBypass: pathExistsWithBlockers,
    staticBypassExists: pathExistsWithBlockers,
  };
}

// ---------------------------------------------------------------------------
// Tier 3: Reachable Preparation Envelope Computation
// ---------------------------------------------------------------------------

function computeReachablePreparationEnvelope(simulator, state) {
  const project = simulator.project;
  const currentFloorId = state.floorId;

  // Track all reachable items and viable battles across accessible floors
  // Allowed floors in neko zero-key: TS11, TS12, TS13
  const candidateFloors = ["TS13", "TS12", "TS11"];
  const reachablePickups = [];
  const viableBattles = [];

  let sumItemHp = 0;
  let sumItemAtk = 0;
  let sumItemDef = 0;
  let sumBattleExp = 0;
  let sumBattleDamage = 0;

  for (const fId of candidateFloors) {
    const floor = project.floorsById[fId];
    if (!floor) continue;
    const floorState = (state.floorStates && state.floorStates[fId]) || { removed: {} };
    const removed = floorState.removed || {};

    for (let y = 0; y < floor.height; y++) {
      for (let x = 0; x < floor.width; x++) {
        const loc = `${x},${y}`;
        if (removed[loc]) continue;
        const num = floor.map[y][x];
        const tile = project.mapTilesByNumber[String(num)];
        if (!tile || tile.id === "blueWall" || tile.id === "0") continue;

        if (tile.cls === "items") {
          // Check if item is reachable
          // For simplicity and admissibility, item is reachable if it's not behind an undefeated monster
          // Or we evaluate its stat contribution to the theoretical upper bound
          const gain = getItemStatGain(project, tile.id);
          reachablePickups.push({ floorId: fId, loc, id: tile.id, name: tile.name, gain });
          sumItemHp += gain.hp;
          sumItemAtk += gain.atk;
          sumItemDef += gain.def;
        } else if (tile.cls === "enemys") {
          const e = project.enemysById[tile.id];
          if (!e) continue;
          // Evaluate if battle is currently viable
          try {
            const res = simulator.battleResolver.evaluateBattle(state, fId, x, y, tile.id);
            if (res && res.damageInfo && res.damageInfo.damage < state.hero.hp) {
              viableBattles.push({ floorId: fId, loc, id: tile.id, name: tile.name, exp: e.exp || 0, damage: res.damageInfo.damage });
              sumBattleExp += (e.exp || 0);
              sumBattleDamage += res.damageInfo.damage;
            }
          } catch (_e) {}
        }
      }
    }
  }

  // Project level-ups from all reachable viable monster EXP
  const hero = state.hero || {};
  const currentLv = number(hero.lv, 1);
  const currentExp = number(hero.exp, 0);
  const currentAtk = number(hero.atk, 0);
  const currentDef = number(hero.def, 0);
  const currentHp = number(hero.hp, 0);

  const levelUpProjection = projectLevelUps(project, currentLv, currentExp, sumBattleExp);

  const envelopeMaxAtk = currentAtk + sumItemAtk + levelUpProjection.gainedAtk;
  const envelopeMaxDef = currentDef + sumItemDef + levelUpProjection.gainedDef;
  const envelopeMaxHp = Math.max(0, currentHp + sumItemHp - sumBattleDamage);

  return {
    currentStats: { hp: currentHp, atk: currentAtk, def: currentDef, lv: currentLv, exp: currentExp },
    reachablePickupsCount: reachablePickups.length,
    viableBattlesCount: viableBattles.length,
    availableGains: {
      itemHp: sumItemHp,
      itemAtk: sumItemAtk,
      itemDef: sumItemDef,
      battleExp: sumBattleExp,
      battleDamageCost: sumBattleDamage,
    },
    levelUpProjection,
    envelopeMaxStats: {
      atk: envelopeMaxAtk,
      def: envelopeMaxDef,
      hp: envelopeMaxHp,
      lv: levelUpProjection.projectedLv,
      exp: levelUpProjection.totalExp,
    },
    optimisticComponentWiseUpperBound: {
      atk: envelopeMaxAtk,
      def: envelopeMaxDef,
      hp: envelopeMaxHp,
      lv: levelUpProjection.projectedLv,
      exp: levelUpProjection.totalExp,
    },
  };
}

// ---------------------------------------------------------------------------
// Tier 4: Classification & Causal Provenance
// ---------------------------------------------------------------------------

function classifyForwardBlockerFeasibility({ cutResult, evaluatedBlockers, envelope, searchObserved }) {
  // A. no-forward-cut
  if (!cutResult.forwardCutEstablished) {
    return {
      classification: "A: no-forward-cut",
      reason: "Unexecutable blockers do not form an inescapable cut; a legal bypass exists to the stage goal.",
    };
  }

  // Calculate the minimal attack threshold across the cut blockers
  const cutBattleBlockers = evaluatedBlockers.filter((b) => !b.executable && b.kind === "battle");
  const minRequiredAtkToBreakAnyCutBlocker = cutBattleBlockers.length > 0
    ? Math.min(...cutBattleBlockers.map((b) => b.deficits.minAtkForPositiveDamage))
    : 0;

  // B. resource-feasibility-deficit
  if (envelope.envelopeMaxStats.atk < minRequiredAtkToBreakAnyCutBlocker) {
    return {
      classification: "B: resource-feasibility-deficit",
      reason: `Reachable preparation envelope maximum ATK (${envelope.envelopeMaxStats.atk}) cannot satisfy the minimum required ATK (${minRequiredAtkToBreakAnyCutBlocker}) to deal positive damage to any cut blocker.`,
      gap: {
        envelopeMaxAtk: envelope.envelopeMaxStats.atk,
        minRequiredAtk: minRequiredAtkToBreakAnyCutBlocker,
        unclosableDeficit: minRequiredAtkToBreakAnyCutBlocker - envelope.envelopeMaxStats.atk,
      },
    };
  }

  // If envelope CAN reach sufficient ATK, check search observations
  const searchMaxAtk = (searchObserved && searchObserved.maxAtkSeen) || envelope.currentStats.atk;

  // C. preparation-available-but-not-realized
  if (searchMaxAtk < minRequiredAtkToBreakAnyCutBlocker) {
    return {
      classification: "C: preparation-available-but-not-realized",
      reason: `Reachable preparation envelope can achieve ATK ${envelope.envelopeMaxStats.atk} (>= ${minRequiredAtkToBreakAnyCutBlocker}), but search only realized max ATK ${searchMaxAtk}. The search did not harvest available preparations.`,
      gap: {
        envelopeMaxAtk: envelope.envelopeMaxStats.atk,
        searchMaxAtk,
        minRequiredAtk: minRequiredAtkToBreakAnyCutBlocker,
      },
    };
  }

  // D. capability-realized-but-not-propagated
  return {
    classification: "D: capability-realized-but-not-propagated",
    reason: `Sufficient capability (ATK ${searchMaxAtk} >= ${minRequiredAtkToBreakAnyCutBlocker}) was realized during search, but was not propagated forward to challenge the cut blocker (discarded by agenda, dominance, or route death).`,
    gap: {
      searchMaxAtk,
      minRequiredAtk: minRequiredAtkToBreakAnyCutBlocker,
    },
  };
}

// ---------------------------------------------------------------------------
// Top-Level Audit Entrypoint
// ---------------------------------------------------------------------------

function auditForwardBlockerFeasibility(simulator, frontierState, stageGoal, options) {
  const config = options || {};
  const project = simulator.project;

  // Step 1: Reachable Free Region
  const { reachableTiles, boundaryObstacles } = computeReachableFloorRegion(simulator, frontierState);

  // Step 2: Boundary Obstacle Deficits
  const evaluatedBlockers = Array.from(boundaryObstacles.values()).map((obs) =>
    evaluateBoundaryObstacleDeficits(simulator, frontierState, obs),
  );

  // Step 3: Forward Cut Proof
  // Find upFloor location on TS13
  const floor13 = project.floorsById[frontierState.floorId];
  let upFloorLoc = "11,11";
  for (let y = 0; y < floor13.height; y++) {
    for (let x = 0; x < floor13.width; x++) {
      const num = floor13.map[y][x];
      const tile = project.mapTilesByNumber[String(num)];
      if (tile && tile.id === "upFloor") upFloorLoc = `${x},${y}`;
    }
  }

  const startLoc = `${frontierState.hero.loc.x},${frontierState.hero.loc.y}`;
  const cutResult = proveForwardCut(project, frontierState.floorId, startLoc, upFloorLoc, evaluatedBlockers);

  // Step 4: Reachable Preparation Envelope
  const envelope = computeReachablePreparationEnvelope(simulator, frontierState);

  // Step 5: Classification
  const classificationResult = classifyForwardBlockerFeasibility({
    cutResult,
    evaluatedBlockers,
    envelope,
    searchObserved: config.searchObserved || {},
  });

  return {
    schema: SCHEMA,
    generatedAt: new Date().toISOString(),
    frontierState: {
      floorId: frontierState.floorId,
      loc: { ...frontierState.hero.loc },
      hero: { hp: frontierState.hero.hp, atk: frontierState.hero.atk, def: frontierState.hero.def, lv: frontierState.hero.lv, exp: frontierState.hero.exp },
    },
    goalTarget: { floorId: stageGoal.floorId, loc: upFloorLoc },
    tier1_forwardCut: {
      established: cutResult.forwardCutEstablished,
      reachableFreeRegionSize: reachableTiles.size,
      boundaryObstacleCount: boundaryObstacles.size,
      unexecutableBlockersCount: cutResult.unexecutableBlockersCount,
      hasLegalBypass: cutResult.hasLegalBypass,
      staticBypassExists: cutResult.staticBypassExists,
    },
    tier2_blockerDeficits: evaluatedBlockers.map((b) => ({
      loc: `${b.obstacle.x},${b.obstacle.y}`,
      tileId: b.obstacle.tileId,
      name: b.obstacle.name,
      kind: b.kind,
      status: b.status,
      executable: b.executable,
      deficits: b.deficits,
    })),
    tier3_preparationEnvelope: envelope,
    tier4_classification: classificationResult,
  };
}

module.exports = {
  SCHEMA,
  getItemStatGain,
  projectLevelUps,
  computeReachableFloorRegion,
  evaluateBoundaryObstacleDeficits,
  proveForwardCut,
  computeReachablePreparationEnvelope,
  classifyForwardBlockerFeasibility,
  auditForwardBlockerFeasibility,
};
