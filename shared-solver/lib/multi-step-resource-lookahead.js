"use strict";

/**
 * PR-5.25a — Multi-Step Resource Lookahead evaluator (Repair 2).
 *
 * Repair 2 closes the last two contract gaps from the Repair 1 review:
 *
 *   Prerequisite IDENTITY (not just existence):
 *     Each blocked resource carries requiredBlockerKeys — the specific alive
 *     enemies that stand between the hero's currently reachable region and
 *     that resource (computed by a BFS flood-fill on the map grid with alive
 *     enemies as walls). A blocked resource enters a plan IFF its ACTUAL
 *     blocker has been defeated within that plan. An unrelated battle never
 *     unlocks it. When the blocker cannot be determined reliably → UNKNOWN
 *     (never assumable).
 *
 *   Alternative group INTEGRITY:
 *     Blocked resources are assigned to the same alternative group as their
 *     blocker (the guard that unlocks them). Floor-wide blocked injection is
 *     eliminated — plans draw from exactly ONE group, including blocked
 *     members. MAX_ALTERNATIVES bounds the full projected resource space.
 *
 * Everything else (frozen params, one-shot consumption, level-up engine,
 * multi-step battle cost recomputation, UNKNOWN-not-BLOCKED for events,
 * priority-only output) is unchanged.
 */

const { getTileDefinitionAt } = require("./state");

const FROZEN_PARAMS = {
  LOOKAHEAD_DEPTH: 3,
  MAX_PLANS: 24,
  MAX_ALTERNATIVES: 4,
  KEY_BATTLES_SAMPLED: 6,
  TIE_BREAK: "enumeration-order",
};

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// ---------- abstract battle model ----------
function abstractBattleCost(hero, enemy) {
  const atk = number(hero.atk, 0);
  const def = number(hero.def, 0);
  const mdef = number(hero.mdef, 0);
  const enemyHp = number(enemy && enemy.hp, 0);
  const enemyAtk = number(enemy && enemy.atk, 0);
  const enemyDef = number(enemy && enemy.def, 0);
  const perTurn = Math.max(atk - enemyDef, 0);
  if (perTurn <= 0) return { survivable: false, turns: Infinity, damage: Infinity };
  const turns = Math.max(1, Math.ceil(enemyHp / perTurn));
  const damageWithMdef = Math.max(0, turns * Math.max(enemyAtk - def - mdef, 0));
  return { survivable: damageWithMdef < number(hero.hp, 0), turns, damage: damageWithMdef };
}

// ---------- level-up model ----------
function levelUpGains(levelUp, currentLv, currentExp, gainedExp) {
  let lv = currentLv;
  let exp = currentExp + gainedExp;
  let atk = 0;
  let def = 0;
  let guard = 0;
  for (;;) {
    guard += 1;
    if (guard > 20) break;
    const next = (levelUp || []).find((entry, idx) => idx > 0 && Number(entry.need) > 0 && exp >= Number(entry.need) && Number(entry.need) > (lv > 1 ? Number(((levelUp || [])[lv - 1] || {}).need) || 0 : 0));
    if (!next) break;
    const actions = Array.isArray(next.action) ? next.action : [];
    for (const a of actions) {
      if (a && a.type === "setValue" && a.name === "status:atk" && a.operator === "+=") atk += Number(a.value) || 0;
      if (a && a.type === "setValue" && a.name === "status:def" && a.operator === "+=") def += Number(a.value) || 0;
    }
    lv += 1;
  }
  return { lv, atk, def };
}

// ---------- BFS blocker identity ----------
/**
 * Flood-fill from the hero's current position over PASSABLE, non-enemy tiles.
 * Returns:
 *   reachable: Set of "x,y" the hero can walk to right now (ignoring enemies
 *              as walls — enemies are the boundary).
 *   boundaryEnemies: Map "x,y" (enemy position) → reachable cell it is
 *                   adjacent to. These are the FIRST-layer blockers.
 *
 * For a blocked resource at (tx,ty): its required blockers = the alive
 * enemies adjacent to the current reachable region that lie on any path
 * toward it. We approximate with a second BFS through enemy tiles: expand
 * through boundary enemies; the enemies encountered on the way to (tx,ty)
 * are its prerequisite chain. The FIRST enemy on any such path is the
 * immediate blocker.
 */
function computeBlockerTopology(project, state, floorId) {
  const floor = project.floorsById[floorId];
  if (!floor) return { reachable: new Set(), boundaryEnemies: new Map() };
  const floorState = (state.floorStates || {})[floorId] || {};
  const removed = floorState.replaced || {};
  const map = floor.map || [];
  const width = floor.width || 0;
  const height = floor.height || 0;
  const heroX = number(state.hero && state.hero.loc && state.hero.loc.x, -1);
  const heroY = number(state.hero && state.hero.loc && state.hero.loc.y, -1);

  const isPassable = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    if (removed[`${x},${y}`]) return false;
    const tileNumber = (map[y] || [])[x];
    if (!tileNumber) return true; // h5mota: 0/absent = empty walkable floor
    const tile = project.mapTilesByNumber[String(tileNumber)];
    if (!tile) return false;
    if (tile.cls === "enemys") return false; // enemies are walls for this BFS
    if (tile.cls === "autotile" && tile.noPass) return false;
    if (tile.canPass === false) return false;
    return true;
  };
  const isEnemyAt = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    if (removed[`${x},${y}`]) return false;
    const tileNumber = (map[y] || [])[x];
    if (!tileNumber) return false;
    const tile = project.mapTilesByNumber[String(tileNumber)];
    return Boolean(tile && tile.cls === "enemys" && tile.id);
  };

  // BFS 1: reachable passable region from hero.
  const reachable = new Set();
  const boundaryEnemies = new Map(); // "ex,ey" -> first reachable cell adjacent
  if (heroX >= 0 && heroY >= 0) {
    const queue = [[heroX, heroY]];
    reachable.add(`${heroX},${heroY}`);
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    while (queue.length > 0) {
      const [cx, cy] = queue.shift();
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        const key = `${nx},${ny}`;
        if (reachable.has(key)) continue;
        if (isPassable(nx, ny)) {
          reachable.add(key);
          queue.push([nx, ny]);
        } else if (isEnemyAt(nx, ny)) {
          if (!boundaryEnemies.has(key)) {
            boundaryEnemies.set(key, `${cx},${cy}`);
          }
        }
      }
    }
  }
  return { reachable, boundaryEnemies };
}

/**
 * For each blocked resource, find its immediate blocker: the boundary enemy
 * that lies on a BFS path (through enemy tiles) toward the resource. We do a
 * multi-source BFS from ALL boundary enemies simultaneously, expanding through
 * enemy tiles, and record which boundary enemy is the "owner" of each reached
 * cell. The first boundary enemy whose expansion reaches the resource's
 * adjacent cell is the immediate blocker for that resource.
 */
function assignBlockers(project, state, floorId, blockedResources) {
  const floor = project.floorsById[floorId];
  if (!floor || blockedResources.length === 0) {
    blockedResources.forEach((r) => { r.requiredBlockerKeys = null; r.prerequisiteKnown = false; });
    return;
  }
  const floorState = (state.floorStates || {})[floorId] || {};
  const removed = floorState.removed || {};
  const map = floor.map || [];
  const width = floor.width || 0;
  const height = floor.height || 0;

  const { reachable, boundaryEnemies } = computeBlockerTopology(project, state, floorId);

  const isEnemyAt = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    if (removed[`${x},${y}`]) return false;
    const tileNumber = (map[y] || [])[x];
    if (!tileNumber) return false;
    const tile = project.mapTilesByNumber[String(tileNumber)];
    return Boolean(tile && tile.cls === "enemys" && tile.id);
  };
  const isPassableTile = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    if (removed[`${x},${y}`]) return false;
    const tileNumber = (map[y] || [])[x];
    if (!tileNumber) return true; // h5mota: 0/absent = empty walkable floor
    const tile = project.mapTilesByNumber[String(tileNumber)];
    if (!tile) return false;
    if (tile.cls === "enemys") return false;
    if (tile.cls === "autotile" && tile.noPass) return false;
    if (tile.canPass === false) return false;
    return true;
  };

  // Multi-source BFS from boundary enemies, expanding through enemy tiles AND
  // passable tiles behind them (the blocked corridor interior).
  const owner = new Map(); // "x,y" -> boundary enemy key that first reached it
  const queue = [];
  for (const enemyKey of boundaryEnemies.keys()) {
    const [ex, ey] = enemyKey.split(",").map(Number);
    owner.set(enemyKey, enemyKey); // each boundary enemy owns itself
    queue.push([ex, ey, enemyKey]);
  }
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let bfsDepth = 0;
  const maxBfsDepth = 400; // bounded: covers any single-floor corridor
  while (queue.length > 0 && bfsDepth < maxBfsDepth) {
    bfsDepth += 1;
    const [cx, cy, source] = queue.shift();
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      const key = `${nx},${ny}`;
      if (owner.has(key)) continue;
      if (isEnemyAt(nx, ny)) {
        owner.set(key, source);
        queue.push([nx, ny, source]);
      } else if (isPassableTile(nx, ny)) {
        // Passable tiles BEHIND boundary enemies: blocked corridor interior.
        owner.set(key, source);
        queue.push([nx, ny, source]);
      }
      // walls and removed tiles are terminal — no expansion
    }
  }

  // For each blocked resource, find the owner of its own cell or any adjacent cell.
  for (const record of blockedResources) {
    const ownKey = `${record.x},${record.y}`;
    let blocker = owner.get(ownKey) || null;
    if (!blocker) {
      for (const [dx, dy] of DIRS) {
        const adjKey = `${record.x + dx},${record.y + dy}`;
        if (owner.has(adjKey)) {
          blocker = owner.get(adjKey);
          break;
        }
      }
    }
    if (blocker && boundaryEnemies.has(blocker)) {
      record.requiredBlockerKeys = [blocker];
      record.prerequisiteKnown = true;
    } else {
      // Cannot determine a reliable blocker → UNKNOWN (never assumable).
      record.requiredBlockerKeys = null;
      record.prerequisiteKnown = false;
    }
  }
}

// ---------- prerequisite-aware extraction with group integrity ----------
function extractResourcesWithPrerequisites(project, simulator, state, options) {
  const config = options || {};
  const floorId = state.floorId;
  const floor = project.floorsById[floorId];
  if (!floor) return { obtainable: [], blocked: [], unknowns: [], alternativeGroups: [] };
  const maxPerKind = number(config.maxPerKind, 12);

  // 1) Authoritative obtainable set via action enumeration.
  let actions = [];
  try {
    actions = (simulator.enumeratePrimitiveActions(state) || {}).actions || [];
  } catch (_) {
    actions = [];
  }
  const obtainableKeys = new Set();
  for (const action of actions) {
    if (action.kind === "battle" && action.target) {
      obtainableKeys.add(`battle:${action.floorId || floorId}:${action.target.x},${action.target.y}`);
    } else if ((action.kind === "pickup" || action.kind === "interactPickup") && (action.x != null)) {
      obtainableKeys.add(`pickup:${action.floorId || floorId}:${action.x},${action.y}`);
    }
  }

  // 2) Scan map; classify resources.
  const floorState = (state.floorStates || {})[floorId] || {};
  const removed = floorState.removed || {};
  const obtainable = [];
  const blocked = [];
  const unknowns = [];
  const width = floor.width || 0;
  const height = floor.height || 0;
  const map = floor.map || [];
  for (let y = 0; y < height && (obtainable.length + blocked.length) < maxPerKind * 2; y += 1) {
    const row = map[y] || [];
    for (let x = 0; x < width && (obtainable.length + blocked.length) < maxPerKind * 2; x += 1) {
      if (removed[`${x},${y}`]) continue;
      const tileNumber = row[x];
      if (!tileNumber) continue;
      const tile = getTileDefinitionAt(project, state, floorId, x, y);
      if (!tile) continue;
      if (tile.cls === "enemys" && tile.id) {
        const enemy = project.enemysById && project.enemysById[tile.id];
        if (!enemy) {
          unknowns.push({ kind: "battle", id: tile.id, floorId, x, y, reason: "unknown-enemy" });
          continue;
        }
        if (enemy.special != null && Number(enemy.special) !== 0) {
          unknowns.push({ kind: "battle", id: tile.id, floorId, x, y, reason: "special-effect" });
          continue;
        }
        const record = { kind: "battle", id: tile.id, floorId, x, y, enemy, isDirectlyObtainable: false };
        if (obtainableKeys.has(`battle:${floorId}:${x},${y}`)) {
          record.isDirectlyObtainable = true;
          obtainable.push(record);
        } else {
          blocked.push(record);
        }
      } else if (tile.cls === "items" && tile.id) {
        const item = project.itemsById && project.itemsById[tile.id];
        if (!item) {
          unknowns.push({ kind: "pickup", id: tile.id, floorId, x, y, reason: "unknown-item" });
          continue;
        }
        const record = { kind: "pickup", id: tile.id, floorId, x, y, item, isDirectlyObtainable: false };
        if (obtainableKeys.has(`pickup:${floorId}:${x},${y}`)) {
          record.isDirectlyObtainable = true;
          obtainable.push(record);
        } else {
          blocked.push(record);
        }
      }
    }
  }

  // 3) Assign BLOCKER IDENTITY to blocked resources (Repair 2 P1-1).
  assignBlockers(project, state, floorId, blocked);

  // 4) Alternative grouping: obtainable by stance-proximity; blocked resources
  //    join the group of their BLOCKER (group integrity — Repair 2 P1-2).
  const CLUSTER_RADIUS = 6;
  const clusters = [];
  const actionStanceByKey = new Map();
  for (const action of actions) {
    if (action.kind === "battle" && action.target) {
      actionStanceByKey.set(`battle:${action.floorId || floorId}:${action.target.x},${action.target.y}`, action.stance || null);
    } else if ((action.kind === "pickup" || action.kind === "interactPickup") && action.x != null) {
      actionStanceByKey.set(`pickup:${action.floorId || floorId}:${action.x},${action.y}`, action.stance || null);
    }
  }

  // Obtainable grouping (stance-proximity clustering).
  obtainable.forEach((record) => {
    const key = `${record.kind}:${record.floorId}:${record.x},${record.y}`;
    const stance = actionStanceByKey.get(key);
    if (!stance) {
      record.groupIndex = clusters.length;
      clusters.push([record]);
      return;
    }
    let placed = false;
    for (let ci = 0; ci < clusters.length; ci += 1) {
      const rep = clusters[ci][0];
      const repKey = `${rep.kind}:${rep.floorId}:${rep.x},${rep.y}`;
      const repStance = actionStanceByKey.get(repKey);
      if (repStance) {
        const dist = Math.abs((repStance.x || 0) - (stance.x || 0)) + Math.abs((repStance.y || 0) - (stance.y || 0));
        if (dist <= CLUSTER_RADIUS) {
          clusters[ci].push(record);
          record.groupIndex = ci;
          placed = true;
          break;
        }
      }
    }
    if (!placed) {
      record.groupIndex = clusters.length;
      clusters.push([record]);
    }
  });

  // Blocker-to-group map: which obtainable battle is each blocker?
  const blockerKeyToGroup = new Map();
  obtainable.forEach((record) => {
    if (record.kind === "battle") {
      blockerKeyToGroup.set(`${record.x},${record.y}`, record.groupIndex);
    }
  });

  // Blocked resources join their blocker's group (or their own new group when
  // the blocker is not obtainable / prerequisite unknown).
  const unknownBlocked = [];
  blocked.forEach((record) => {
    if (record.prerequisiteKnown && record.requiredBlockerKeys && record.requiredBlockerKeys.length > 0) {
      const blockerKey = record.requiredBlockerKeys[0];
      const group = blockerKeyToGroup.get(blockerKey);
      if (group != null) {
        record.groupIndex = group;
        clusters[group].push(record);
        return;
      }
    }
    // Prerequisite unknown → its own isolated group (never mixed into others).
    record.groupIndex = clusters.length;
    record.prerequisiteUnknown = true;
    unknownBlocked.push(record);
    clusters.push([record]);
  });

  return {
    obtainable,
    blocked,
    unknowns,
    alternativeGroups: clusters,
    unknownBlocked,
  };
}

// ---------- evaluator factory ----------
function createMultiStepResourceLookahead(project, options) {
  const config = options || {};
  const params = {
    ...FROZEN_PARAMS,
    ...(config.params || {}),
  };
  const levelUp = project.data && project.data.firstData && project.data.firstData.levelUp;
  let simulatorRef = config.simulator || null;

  const keyBattlesFor = (terminalGoal) => {
    if (Array.isArray(config.keyBattles) && config.keyBattles.length > 0) {
      return config.keyBattles;
    }
    const goalFloor = project.floorsById[terminalGoal.floorId];
    if (!goalFloor) return [];
    const enemies = [];
    const map = goalFloor.map || [];
    for (let y = 0; y < (goalFloor.height || 0); y += 1) {
      const row = map[y] || [];
      for (let x = 0; x < (goalFloor.width || 0); x += 1) {
        const tileNumber = row[x];
        if (!tileNumber) continue;
        const tileDef = project.mapTilesByNumber[String(tileNumber)];
        if (!tileDef || tileDef.cls !== "enemys" || !tileDef.id) continue;
        const enemy = project.enemysById && project.enemysById[tileDef.id];
        if (!enemy) continue;
        enemies.push({ enemyId: tileDef.id, enemy, x, y });
      }
    }
    enemies.sort((a, b) => (b.enemy.atk * b.enemy.hp) - (a.enemy.atk * a.enemy.hp));
    return enemies.slice(0, params.KEY_BATTLES_SAMPLED).map((e) => ({
      enemyId: e.enemyId, enemy: e.enemy, x: e.x, y: e.y,
    }));
  };

  const applyBattleToAbstractHero = (abstractHero, opp) => {
    const cost = abstractBattleCost(abstractHero, opp.enemy);
    if (!cost.survivable) return null;
    return {
      hp: abstractHero.hp - cost.damage,
      atk: abstractHero.atk,
      def: abstractHero.def,
      mdef: abstractHero.mdef,
      lv: abstractHero.lv,
      exp: abstractHero.exp + number(opp.enemy.exp, 0),
    };
  };

  const applyPickupToAbstractHero = (abstractHero, opp) => {
    const item = opp.item || {};
    const next = { ...abstractHero };
    next.atk += number(item.atk, 0);
    next.def += number(item.def, 0);
    next.mdef += number(item.mdef, 0);
    next.hp += number(item.hp, 0);
    next.exp += number(item.exp, 0);
    const unknown = item.atk == null && item.def == null && item.mdef == null && item.hp == null && item.exp == null;
    return { hero: next, unknown };
  };

  const evaluate = (state, terminalGoal) => {
    if (!simulatorRef) {
      return {
        score: 0, feasibility: "UNKNOWN", plansConsidered: 0, bestProjectedPlan: null,
        usefulThresholds: [], uncertainty: { unknownEvents: 0, unknownPlans: 0, reason: "no-simulator" }, trace: [],
      };
    }
    const hero = state.hero || {};
    const abstractHero0 = {
      hp: number(hero.hp, 0), atk: number(hero.atk, 0), def: number(hero.def, 0),
      mdef: number(hero.mdef, 0), lv: number(hero.lv, 1), exp: number(hero.exp, 0),
    };

    const { obtainable, blocked, unknowns, alternativeGroups, unknownBlocked } =
      extractResourcesWithPrerequisites(project, simulatorRef, state, { maxPerKind: 12 });

    // Cap alternatives (frozen param bounds the FULL projected space —
    // obtainable AND blocked members are inside their groups).
    const activeGroups = alternativeGroups.slice(0, params.MAX_ALTERNATIVES);

    const keyBattles = keyBattlesFor(terminalGoal);
    const baselineCosts = keyBattles.map((kb) => abstractBattleCost(abstractHero0, kb.enemy));
    const baselineFeasible = baselineCosts.filter((c) => c.survivable).length;
    const INFEASIBLE_PENALTY = 1e7;
    const baselineWorstDamage = baselineCosts.reduce((m, c) => Math.max(m, c.survivable ? c.damage : INFEASIBLE_PENALTY), 0);

    const plans = [];
    const trace = [];
    let unknownPlans = 0;

    const scorePlan = (planAbstractHero) => {
      const costs = keyBattles.map((kb) => abstractBattleCost(planAbstractHero, kb.enemy));
      const feasible = costs.filter((c) => c.survivable).length;
      const worstDamageProxy = costs.reduce((m, c) => Math.max(m, c.survivable ? c.damage : INFEASIBLE_PENALTY), 0);
      return feasible * 1e9 - worstDamageProxy * 1e3 + planAbstractHero.hp;
    };

    for (let gi = 0; gi < activeGroups.length && plans.length < params.MAX_PLANS; gi += 1) {
      const group = activeGroups[gi]; // ALL members (obtainable + blocked owned by this group)
      const used = new Set();
      const seq = [];
      const defeatedBlockers = new Set(); // "x,y" of blockers defeated in this plan

      const extend = (depth, abstractHero, hasUnknown) => {
        if (plans.length >= params.MAX_PLANS) return;
        if (depth >= params.LOOKAHEAD_DEPTH) {
          plans.push({ seq: seq.slice(), abstractHero, groupIndex: gi, hasUnknown });
          if (hasUnknown) unknownPlans += 1;
          return;
        }
        for (const opp of group) {
          if (plans.length >= params.MAX_PLANS) return;
          const oppKey = `${opp.kind}:${opp.floorId}:${opp.x},${opp.y}`;
          if (used.has(oppKey)) continue;

          // PREREQUISITE IDENTITY: a blocked resource enters the plan IFF its
          // actual blocker has been defeated in this plan (or it is directly
          // obtainable). Unknown-prerequisite resources never enter.
          if (!opp.isDirectlyObtainable) {
            if (!opp.prerequisiteKnown || !opp.requiredBlockerKeys) continue; // UNKNOWN → skip
            const satisfied = opp.requiredBlockerKeys.every((bk) => defeatedBlockers.has(bk));
            if (!satisfied) continue;
          }

          used.add(oppKey);
          seq.push(opp);
          let nextHero = null;
          let unknown = hasUnknown;
          if (opp.kind === "battle") {
            nextHero = applyBattleToAbstractHero(abstractHero, opp);
            if (nextHero == null) {
              plans.push({ seq: seq.slice(), abstractHero: null, dead: true, groupIndex: gi, hasUnknown });
              if (hasUnknown) unknownPlans += 1;
              seq.pop();
              used.delete(oppKey);
              continue;
            }
            // Register this battle's position as a defeated blocker.
            defeatedBlockers.add(`${opp.x},${opp.y}`);
            const gains = levelUpGains(levelUp, abstractHero.lv, abstractHero.exp, number(opp.enemy.exp, 0));
            nextHero.lv = gains.lv;
            nextHero.atk += gains.atk;
            nextHero.def += gains.def;
          } else {
            const applied = applyPickupToAbstractHero(abstractHero, opp);
            nextHero = applied.hero;
            unknown = unknown || applied.unknown;
          }
          extend(depth + 1, nextHero, unknown);
          seq.pop();
          used.delete(oppKey);
          if (opp.kind === "battle") defeatedBlockers.delete(`${opp.x},${opp.y}`);
        }
        if (seq.length > 0) {
          plans.push({ seq: seq.slice(), abstractHero, groupIndex: gi, hasUnknown });
          if (hasUnknown) unknownPlans += 1;
        }
      };
      extend(0, abstractHero0, false);
    }

    let bestScore = -Infinity;
    let bestPlan = null;
    for (const plan of plans) {
      if (plan.dead || !plan.abstractHero) continue;
      const score = scorePlan(plan.abstractHero);
      if (score > bestScore) {
        bestScore = score;
        bestPlan = plan;
      }
    }

    const goalEnemy = keyBattles.find((kb) => kb.enemyId === terminalGoal.enemyId);
    let feasibility = "UNKNOWN";
    if (goalEnemy) {
      if (bestPlan && bestPlan.abstractHero) {
        const goalCost = abstractBattleCost(bestPlan.abstractHero, goalEnemy.enemy);
        feasibility = goalCost.survivable ? "FEASIBLE" : "UNRESOLVED";
      } else {
        const goalCost = abstractBattleCost(abstractHero0, goalEnemy.enemy);
        feasibility = goalCost.survivable ? "FEASIBLE" : "UNRESOLVED";
      }
    } else if (keyBattles.length > 0) {
      feasibility = baselineFeasible >= keyBattles.length ? "FEASIBLE" : "UNRESOLVED";
    }

    const feasibilityGain = bestPlan && bestPlan.abstractHero
      ? (keyBattles.map((kb) => abstractBattleCost(bestPlan.abstractHero, kb.enemy)).filter((c) => c.survivable).length - baselineFeasible)
      : 0;
    const score = feasibilityGain * 1e9
      + (bestScore === -Infinity ? 0 : bestScore * 1e-3)
      + number(hero.hp, 0) * 1e-6
      + number(hero.exp, 0) * 1e-3;

    const usefulThresholds = keyBattles.map((kb, i) => ({
      enemyId: kb.enemyId,
      minHpRough: baselineCosts[i] && baselineCosts[i].survivable
        ? Math.ceil(baselineCosts[i].damage) + 1 : null,
    }));

    if (bestPlan) {
      trace.push({
        baseline: {
          feasibleKeyBattles: baselineFeasible,
          worstDamage: baselineWorstDamage >= INFEASIBLE_PENALTY ? null : baselineWorstDamage,
        },
        alternativeGroupIndex: bestPlan.groupIndex,
        alternativeGroupsConsidered: activeGroups.length,
        plan: bestPlan.seq.map((opp) => ({
          kind: opp.kind, id: opp.id, at: `${opp.floorId}:${opp.x},${opp.y}`,
        })),
        projected: bestPlan.abstractHero ? {
          hp: Math.round(bestPlan.abstractHero.hp),
          atk: bestPlan.abstractHero.atk,
          def: bestPlan.abstractHero.def,
          mdef: bestPlan.abstractHero.mdef,
          lv: bestPlan.abstractHero.lv,
          exp: bestPlan.abstractHero.exp,
          feasibleKeyBattles: keyBattles.map((kb) => abstractBattleCost(bestPlan.abstractHero, kb.enemy)).filter((c) => c.survivable).length,
        } : null,
        feasibility,
      });
    }

    return {
      score,
      feasibility,
      plansConsidered: plans.length,
      bestProjectedPlan: bestPlan ? bestPlan.seq.map((opp) => `${opp.kind}:${opp.id}@${opp.floorId}:${opp.x},${opp.y}`) : null,
      usefulThresholds,
      uncertainty: {
        unknownEvents: unknowns.length,
        unknownPlans,
        blockedResources: blocked.length,
        unknownPrerequisiteBlocked: unknownBlocked.length,
      },
      trace,
    };
  };

  return {
    evaluate,
    params,
    setSimulator(sim) { simulatorRef = sim; },
  };
}

module.exports = {
  createMultiStepResourceLookahead,
  FROZEN_PARAMS,
  abstractBattleCost,
  levelUpGains,
  extractResourcesWithPrerequisites,
  computeBlockerTopology,
  assignBlockers,
};
