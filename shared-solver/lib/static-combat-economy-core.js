"use strict";

/**
 * PR-5.20a static combat-economy core.
 *
 * A deliberately small, self-contained correctness solver for ONE restricted
 * problem class: a rectangular static map, a hero with hp/atk/def/mdef, plain
 * monsters with hp/atk/def, and one-time attribute resources. Nothing else.
 * There are no events, flags, equipment, keys, money, exp, skills or monster
 * special abilities, and `validateStaticCombatEconomyProblem` rejects any input
 * that mentions them rather than silently ignoring the field.
 *
 * This module does NOT read H5Mota data and makes no claim about supporting it.
 * It shares no code with the strategic D2 search and does not touch the
 * canonical DP.
 *
 * The route is discovered automatically: no hand-written path, no manual
 * checkpoints, no goal decomposition and no monster ordering hints. The only
 * decisions the search takes are "which reachable interaction to consume next";
 * plain walking is collapsed by BFS because it carries no decision.
 */

const STATIC_SCHEMA = "motapathfinder.static-combat-economy-core.v1";

const FORBIDDEN_PROBLEM_KEYS = [
  "events",
  "event",
  "flags",
  "flag",
  "equipment",
  "equips",
  "keys",
  "key",
  "money",
  "gold",
  "coins",
  "exp",
  "experience",
  "level",
  "skills",
  "skill",
  "items",
  "shops",
  "shop",
  "npc",
  "npcs",
];

const FORBIDDEN_MONSTER_KEYS = [
  "special",
  "specials",
  "ability",
  "abilities",
  "firstAttack",
  "magic",
  "poison",
  "weak",
  "hpBuff",
  "atkBuff",
  "defBuff",
  "n",
  "double",
  "counter",
  "vampire",
  "money",
  "exp",
  "point",
  "skill",
];

const RESOURCE_ATTRIBUTES = ["hp", "atk", "def", "mdef"];

const WALL = "#";
const FLOOR = ".";

function isSafeInt(value) {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isNonNegativeInt(value) {
  return isSafeInt(value) && value >= 0;
}

function isPositiveInt(value) {
  return isSafeInt(value) && value > 0;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

/**
 * Structural + semantic validation. Returns { valid, errors, problem } where
 * `problem` is a normalized copy (only on success). Anything outside the static
 * schema is an error, not a warning: this benchmark is only meaningful if the
 * input really is event-free.
 */
function validateStaticCombatEconomyProblem(input) {
  const errors = [];
  const problem = input && typeof input === "object" ? input : null;
  if (!problem) {
    return { valid: false, errors: ["problem-must-be-an-object"], problem: null };
  }
  for (const key of FORBIDDEN_PROBLEM_KEYS) {
    if (Object.prototype.hasOwnProperty.call(problem, key)) {
      errors.push(`forbidden-problem-field:${key}`);
    }
  }
  const grid = problem.grid;
  if (!Array.isArray(grid) || grid.length === 0) {
    errors.push("grid-must-be-a-non-empty-array");
  }
  let height = 0;
  let width = 0;
  if (Array.isArray(grid) && grid.length > 0) {
    height = grid.length;
    if (!isNonEmptyString(grid[0])) {
      errors.push("grid-rows-must-be-non-empty-strings");
    } else {
      width = grid[0].length;
      for (let y = 0; y < height; y += 1) {
        if (!isNonEmptyString(grid[y]) || grid[y].length !== width) {
          errors.push(`grid-row-not-rectangular:${y}`);
        }
      }
    }
  }
  const hero = problem.hero;
  if (!hero || typeof hero !== "object") {
    errors.push("hero-must-be-an-object");
  } else {
    if (!isPositiveInt(hero.hp)) errors.push("hero.hp-must-be-a-positive-integer");
    for (const key of ["atk", "def", "mdef"]) {
      if (!isNonNegativeInt(hero[key])) {
        errors.push(`hero.${key}-must-be-a-non-negative-integer`);
      }
    }
    for (const key of Object.keys(hero)) {
      if (!["hp", "atk", "def", "mdef"].includes(key)) {
        errors.push(`forbidden-hero-field:${key}`);
      }
    }
  }
  const inBounds = (x, y) => isNonNegativeInt(x) && isNonNegativeInt(y) &&
    y < height && x < width;
  const cellAt = (x, y) => grid[y][x];
  const checkPoint = (point, label) => {
    if (!point || typeof point !== "object" || !inBounds(point.x, point.y)) {
      errors.push(`${label}-must-be-in-bounds`);
      return false;
    }
    if (cellAt(point.x, point.y) === WALL) {
      errors.push(`${label}-must-not-be-a-wall`);
      return false;
    }
    return true;
  };
  const startOk = checkPoint(problem.start, "start");
  const goalOk = checkPoint(problem.goal, "goal");

  const interactions = problem.interactions;
  const normalizedInteractions = [];
  const occupied = new Map();
  if (!Array.isArray(interactions)) {
    errors.push("interactions-must-be-an-array");
  } else {
    for (let index = 0; index < interactions.length; index += 1) {
      const raw = interactions[index];
      const label = `interactions[${index}]`;
      if (!raw || typeof raw !== "object") {
        errors.push(`${label}-must-be-an-object`);
        continue;
      }
      if (!inBounds(raw.x, raw.y) || cellAt(raw.x, raw.y) === WALL) {
        errors.push(`${label}-must-be-on-a-non-wall-cell`);
        continue;
      }
      const cellKey = `${raw.x},${raw.y}`;
      if (occupied.has(cellKey)) {
        errors.push(`${label}-duplicates-cell:${cellKey}`);
      } else {
        occupied.set(cellKey, index);
      }
      if (startOk && problem.start.x === raw.x && problem.start.y === raw.y) {
        errors.push(`${label}-must-not-sit-on-start`);
      }
      if (raw.kind === "monster") {
        for (const key of ["hp", "atk", "def"]) {
          if (!isNonNegativeInt(raw[key])) {
            errors.push(`${label}.${key}-must-be-a-non-negative-integer`);
          }
        }
        if (!isPositiveInt(raw.hp)) errors.push(`${label}.hp-must-be-positive`);
        for (const key of Object.keys(raw)) {
          if (FORBIDDEN_MONSTER_KEYS.includes(key)) {
            errors.push(`forbidden-monster-field:${label}.${key}`);
          } else if (!["kind", "id", "x", "y", "hp", "atk", "def"].includes(key)) {
            errors.push(`unknown-monster-field:${label}.${key}`);
          }
        }
        normalizedInteractions.push({
          kind: "monster",
          id: isNonEmptyString(raw.id) ? raw.id : `monster@${cellKey}`,
          x: raw.x,
          y: raw.y,
          hp: raw.hp,
          atk: raw.atk,
          def: raw.def,
        });
      } else if (raw.kind === "resource") {
        const gain = {};
        let gainCount = 0;
        for (const key of Object.keys(raw)) {
          if (["kind", "id", "x", "y"].includes(key)) continue;
          if (!RESOURCE_ATTRIBUTES.includes(key)) {
            errors.push(`forbidden-resource-field:${label}.${key}`);
            continue;
          }
          if (!isPositiveInt(raw[key])) {
            errors.push(`${label}.${key}-must-be-a-positive-integer`);
            continue;
          }
          gain[key] = raw[key];
          gainCount += 1;
        }
        if (gainCount === 0) errors.push(`${label}-must-grant-at-least-one-attribute`);
        normalizedInteractions.push({
          kind: "resource",
          id: isNonEmptyString(raw.id) ? raw.id : `resource@${cellKey}`,
          x: raw.x,
          y: raw.y,
          gain,
        });
      } else {
        errors.push(`${label}.kind-must-be-monster-or-resource`);
      }
    }
  }
  if (goalOk && occupied.has(`${problem.goal.x},${problem.goal.y}`)) {
    errors.push("goal-must-not-sit-on-an-interaction");
  }
  if (errors.length > 0) return { valid: false, errors, problem: null };
  return {
    valid: true,
    errors: [],
    problem: {
      schema: STATIC_SCHEMA,
      id: isNonEmptyString(problem.id) ? problem.id : "static-problem",
      width,
      height,
      grid: grid.slice(),
      start: { x: problem.start.x, y: problem.start.y },
      goal: { x: problem.goal.x, y: problem.goal.y },
      hero: {
        hp: hero.hp,
        atk: hero.atk,
        def: hero.def,
        mdef: hero.mdef,
      },
      interactions: normalizedInteractions,
    },
  };
}

/**
 * Fixed plain-combat contract: no first strike, no special abilities.
 * The hero needs strictly more atk than the monster's def to land damage;
 * mdef is subtracted ONCE from the accumulated counterattack damage.
 */
function computeStaticBattleOutcome(hero, monster) {
  const damagePerHit = hero.atk - monster.def;
  if (damagePerHit <= 0) {
    return {
      attackBlocked: true,
      canFight: false,
      hits: null,
      counterRounds: null,
      damage: null,
      attackDeficit: monster.def - hero.atk + 1,
      survivalDeficit: null,
    };
  }
  const hits = Math.ceil(monster.hp / damagePerHit);
  const counterRounds = hits - 1;
  const perRound = Math.max(0, monster.atk - hero.def);
  const damage = Math.max(0, counterRounds * perRound - hero.mdef);
  const canFight = damage < hero.hp;
  return {
    attackBlocked: false,
    canFight,
    hits,
    counterRounds,
    damage,
    attackDeficit: 0,
    survivalDeficit: canFight ? 0 : damage - hero.hp + 1,
  };
}

function cellIndex(problem, x, y) {
  return y * problem.width + x;
}

function buildInteractionIndex(problem) {
  const byCell = new Map();
  for (let index = 0; index < problem.interactions.length; index += 1) {
    const interaction = problem.interactions[index];
    byCell.set(cellIndex(problem, interaction.x, interaction.y), index);
  }
  return byCell;
}

/**
 * BFS-collapsed movement. Walking over free cells carries no decision, so the
 * whole connected free area is one node. Un-consumed interaction cells block
 * movement and are reported as the frontier: those are the only real choices.
 */
function computeStaticReachableRegion(problem, originIndex, consumed, interactionByCell) {
  const byCell = interactionByCell || buildInteractionIndex(problem);
  const total = problem.width * problem.height;
  const visited = new Uint8Array(total);
  const region = new Uint8Array(total);
  const frontierInteractions = [];
  const frontierSeen = new Set();
  const queue = [originIndex];
  visited[originIndex] = 1;
  region[originIndex] = 1;
  let goalReachable = false;
  const goalIndex = cellIndex(problem, problem.goal.x, problem.goal.y);
  if (originIndex === goalIndex) goalReachable = true;
  while (queue.length > 0) {
    const current = queue.pop();
    const cx = current % problem.width;
    const cy = (current - cx) / problem.width;
    const neighbours = [
      [cx, cy - 1],
      [cx, cy + 1],
      [cx - 1, cy],
      [cx + 1, cy],
    ];
    for (const [nx, ny] of neighbours) {
      if (nx < 0 || ny < 0 || nx >= problem.width || ny >= problem.height) continue;
      const next = cellIndex(problem, nx, ny);
      if (visited[next]) continue;
      if (problem.grid[ny][nx] === WALL) {
        visited[next] = 1;
        continue;
      }
      const interactionIndex = byCell.has(next) ? byCell.get(next) : -1;
      if (interactionIndex >= 0 && !consumed.has(interactionIndex)) {
        if (!frontierSeen.has(interactionIndex)) {
          frontierSeen.add(interactionIndex);
          frontierInteractions.push(interactionIndex);
        }
        continue;
      }
      visited[next] = 1;
      region[next] = 1;
      if (next === goalIndex) goalReachable = true;
      queue.push(next);
    }
  }
  frontierInteractions.sort((left, right) => left - right);
  return { region, frontierInteractions, goalReachable };
}

/**
 * Legal macro actions: consume a frontier resource, or fight a frontier monster
 * that is actually survivable. Attack-blocked or lethal monsters are not
 * actions; they are blockers and feed describeStaticBlockerDeficit instead.
 */
function enumerateStaticMacroActions(problem, state) {
  const actions = [];
  for (const interactionIndex of state.frontierInteractions) {
    const interaction = problem.interactions[interactionIndex];
    if (interaction.kind === "resource") {
      actions.push({ interactionIndex, kind: "resource", id: interaction.id });
      continue;
    }
    const outcome = computeStaticBattleOutcome(state.hero, interaction);
    if (outcome.canFight) {
      actions.push({
        interactionIndex,
        kind: "monster",
        id: interaction.id,
        damage: outcome.damage,
      });
    }
  }
  return actions;
}

function applyStaticMacroAction(problem, state, action, interactionByCell) {
  const interaction = problem.interactions[action.interactionIndex];
  const hero = { ...state.hero };
  if (interaction.kind === "resource") {
    for (const attribute of RESOURCE_ATTRIBUTES) {
      if (interaction.gain[attribute] != null) {
        hero[attribute] += interaction.gain[attribute];
      }
    }
  } else {
    const outcome = computeStaticBattleOutcome(state.hero, interaction);
    if (!outcome.canFight) return null;
    hero.hp -= outcome.damage;
  }
  const consumed = new Set(state.consumed);
  consumed.add(action.interactionIndex);
  const originIndex = cellIndex(problem, interaction.x, interaction.y);
  const reach = computeStaticReachableRegion(problem, originIndex, consumed, interactionByCell);
  return {
    hero,
    consumed,
    originIndex,
    region: reach.region,
    frontierInteractions: reach.frontierInteractions,
    goalReachable: reach.goalReachable,
  };
}

function bitsetToString(bits) {
  let out = "";
  for (let index = 0; index < bits.length; index += 1) out += bits[index] ? "1" : "0";
  return out;
}

/**
 * Two states are structurally interchangeable exactly when they have consumed
 * the same interactions and can currently reach the same cells. Order of
 * consumption is not part of the key, which is what collapses permutations.
 */
function buildStaticStructuralKey(consumed, region) {
  const consumedList = Array.from(consumed).sort((left, right) => left - right);
  return `${consumedList.join(",")}|${bitsetToString(region)}`;
}

function dominatesStatic(left, right) {
  return left.hp >= right.hp && left.atk >= right.atk &&
    left.def >= right.def && left.mdef >= right.mdef;
}

/**
 * Pareto insert within ONE structural bucket. A state may only be discarded by
 * a state that is no worse in all four attributes, which is safe because every
 * attribute is monotonically good: more hp survives more, more atk needs fewer
 * hits, more def and mdef reduce damage.
 */
function insertStaticParetoState(bucket, hero) {
  for (const existing of bucket) {
    if (dominatesStatic(existing, hero)) return { inserted: false, dominated: 0 };
  }
  let dominated = 0;
  for (let index = bucket.length - 1; index >= 0; index -= 1) {
    if (dominatesStatic(hero, bucket[index])) {
      bucket.splice(index, 1);
      dominated += 1;
    }
  }
  bucket.push({ hp: hero.hp, atk: hero.atk, def: hero.def, mdef: hero.mdef });
  return { inserted: true, dominated };
}

/**
 * Lexicographic deficit of the blockers on the current frontier: how much atk
 * is still missing (first) and how much survivability is still missing (second).
 * Zero on both means nothing reachable is blocking right now.
 */
function describeStaticBlockerDeficit(problem, state) {
  let attackDeficit = 0;
  let survivalDeficit = 0;
  const blockers = [];
  for (const interactionIndex of state.frontierInteractions) {
    const interaction = problem.interactions[interactionIndex];
    if (interaction.kind !== "monster") continue;
    const outcome = computeStaticBattleOutcome(state.hero, interaction);
    if (outcome.canFight) continue;
    if (outcome.attackBlocked) {
      blockers.push({ interactionIndex, id: interaction.id, kind: "attack-blocked" });
      if (attackDeficit === 0 || outcome.attackDeficit < attackDeficit) {
        attackDeficit = outcome.attackDeficit;
      }
    } else {
      blockers.push({ interactionIndex, id: interaction.id, kind: "lethal" });
      if (survivalDeficit === 0 || outcome.survivalDeficit < survivalDeficit) {
        survivalDeficit = outcome.survivalDeficit;
      }
    }
  }
  return { attackDeficit, survivalDeficit, blockers };
}

function compareDeficit(left, right) {
  if (left.attackDeficit !== right.attackDeficit) {
    return left.attackDeficit - right.attackDeficit;
  }
  return left.survivalDeficit - right.survivalDeficit;
}

function buildInitialState(problem, interactionByCell) {
  const originIndex = cellIndex(problem, problem.start.x, problem.start.y);
  const consumed = new Set();
  const reach = computeStaticReachableRegion(problem, originIndex, consumed, interactionByCell);
  return {
    hero: { ...problem.hero },
    consumed,
    originIndex,
    region: reach.region,
    frontierInteractions: reach.frontierInteractions,
    goalReachable: reach.goalReachable,
  };
}

const CONSERVE_HP = "CONSERVE_HP";
const BREAK_BOTTLENECK = "BREAK_BOTTLENECK";
const STAGNATION_LIMIT = 4;
const BREAK_BOTTLENECK_WINDOW = 4;

function conserveHpRank(entry) {
  return [-entry.hero.hp, -entry.hero.atk, -entry.hero.def, -entry.hero.mdef, entry.id];
}

// Prefer the smallest remaining deficit, then the strongest attack, then the
// state most willing to have spent hp. This is the "invest now" ordering.
function breakBottleneckRank(entry) {
  return [
    entry.deficit.attackDeficit,
    entry.deficit.survivalDeficit,
    -entry.hero.atk,
    entry.hero.hp,
    entry.id,
  ];
}

function compareRank(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function selectFrontierIndex(frontier, mode) {
  const rankOf = mode === BREAK_BOTTLENECK ? breakBottleneckRank : conserveHpRank;
  let bestIndex = 0;
  let bestRank = rankOf(frontier[0]);
  for (let index = 1; index < frontier.length; index += 1) {
    const rank = rankOf(frontier[index]);
    if (compareRank(rank, bestRank) < 0) {
      bestIndex = index;
      bestRank = rank;
    }
  }
  return bestIndex;
}

function reconstructRoute(nodes, nodeId) {
  const steps = [];
  let current = nodeId;
  while (current != null) {
    const node = nodes.get(current);
    if (!node || node.parentId == null) break;
    steps.push(node.action);
    current = node.parentId;
  }
  steps.reverse();
  return steps;
}

/**
 * Adaptive static solver. The mode only reorders the frontier: legal actions and
 * the Pareto rule are identical in both modes, so switching can never make an
 * illegal route legal or discard a state that a different order would have kept.
 *
 * status:
 *   SOLVED         frontier exhausted and a goal route was found -> hp-optimal
 *   RESOURCE_LIMIT expansion budget reached (a route may be present but is NOT
 *                  proven optimal). Never reported as UNSOLVABLE.
 *   UNSOLVABLE     frontier exhausted with no goal route
 */
function solveStaticCombatEconomy(problem, options) {
  const config = options || {};
  const maxExpandedStates = isPositiveInt(config.maxExpandedStates)
    ? config.maxExpandedStates
    : 200000;
  const adaptive = config.adaptive !== false;
  const interactionByCell = buildInteractionIndex(problem);
  const buckets = new Map();
  const nodes = new Map();
  let nextId = 0;

  const initial = buildInitialState(problem, interactionByCell);
  const initialDeficit = describeStaticBlockerDeficit(problem, initial);
  const rootId = nextId += 1;
  nodes.set(rootId, { parentId: null, action: null });
  const frontier = [{ id: rootId, ...initial, deficit: initialDeficit }];
  const rootKey = buildStaticStructuralKey(initial.consumed, initial.region);
  buckets.set(rootKey, []);
  insertStaticParetoState(buckets.get(rootKey), initial.hero);

  let expanded = 0;
  let generated = 1;
  let dominated = 0;
  let peakFrontier = 1;
  let modeSwitches = 0;
  let mode = CONSERVE_HP;
  let stagnation = 0;
  let breakBottleneckRemaining = 0;
  let bestDeficit = initialDeficit;
  let bestGoalNodeId = null;
  let bestGoalHero = null;

  const considerGoal = (entry) => {
    if (!entry.goalReachable) return;
    if (bestGoalHero == null || entry.hero.hp > bestGoalHero.hp) {
      bestGoalHero = { ...entry.hero };
      bestGoalNodeId = entry.id;
    }
  };
  considerGoal(frontier[0]);

  let limitReached = false;
  while (frontier.length > 0) {
    if (expanded >= maxExpandedStates) {
      limitReached = true;
      break;
    }
    const pickIndex = selectFrontierIndex(frontier, mode);
    const entry = frontier.splice(pickIndex, 1)[0];
    expanded += 1;

    if (compareDeficit(entry.deficit, bestDeficit) < 0) {
      bestDeficit = entry.deficit;
      stagnation = 0;
    } else {
      stagnation += 1;
    }
    if (mode === BREAK_BOTTLENECK) {
      breakBottleneckRemaining -= 1;
      if (breakBottleneckRemaining <= 0) {
        mode = CONSERVE_HP;
        stagnation = 0;
      }
    } else if (adaptive && stagnation >= STAGNATION_LIMIT) {
      mode = BREAK_BOTTLENECK;
      breakBottleneckRemaining = BREAK_BOTTLENECK_WINDOW;
      modeSwitches += 1;
      stagnation = 0;
    }

    for (const action of enumerateStaticMacroActions(problem, entry)) {
      const next = applyStaticMacroAction(problem, entry, action, interactionByCell);
      if (!next) continue;
      generated += 1;
      const key = buildStaticStructuralKey(next.consumed, next.region);
      if (!buckets.has(key)) buckets.set(key, []);
      const insertion = insertStaticParetoState(buckets.get(key), next.hero);
      // Count both directions of pruning: states rejected because an existing
      // bucket entry already dominates them, and states evicted by this one.
      if (!insertion.inserted) {
        dominated += 1;
        continue;
      }
      dominated += insertion.dominated;
      const nodeId = nextId += 1;
      nodes.set(nodeId, {
        parentId: entry.id,
        action: { interactionIndex: action.interactionIndex, kind: action.kind, id: action.id },
      });
      const nextEntry = {
        id: nodeId,
        ...next,
        deficit: describeStaticBlockerDeficit(problem, next),
      };
      considerGoal(nextEntry);
      frontier.push(nextEntry);
      if (frontier.length > peakFrontier) peakFrontier = frontier.length;
    }
  }

  let status;
  if (limitReached) status = "RESOURCE_LIMIT";
  else if (bestGoalNodeId != null) status = "SOLVED";
  else status = "UNSOLVABLE";

  return {
    status,
    route: bestGoalNodeId == null ? null : reconstructRoute(nodes, bestGoalNodeId),
    finalHero: bestGoalHero,
    expanded,
    generated,
    dominated,
    peakFrontier,
    modeSwitches,
  };
}

/**
 * Unpruned oracle: depth-first over EVERY legal macro action sequence, with no
 * structural key and no Pareto dominance. Only usable on tiny problems, which is
 * exactly what it is for -- proving the pruned solver did not lose the optimum.
 */
function solveStaticCombatEconomyExhaustive(problem, options) {
  const config = options || {};
  const maxSequences = isPositiveInt(config.maxSequences) ? config.maxSequences : 2000000;
  const interactionByCell = buildInteractionIndex(problem);
  let sequences = 0;
  let found = false;
  let bestHero = null;
  let bestRoute = null;
  let exhausted = true;

  const walk = (state, route) => {
    if (!exhausted) return;
    sequences += 1;
    if (sequences > maxSequences) {
      exhausted = false;
      return;
    }
    if (state.goalReachable) {
      found = true;
      if (bestHero == null || state.hero.hp > bestHero.hp) {
        bestHero = { ...state.hero };
        bestRoute = route.slice();
      }
    }
    for (const action of enumerateStaticMacroActions(problem, state)) {
      const next = applyStaticMacroAction(problem, state, action, interactionByCell);
      if (!next) continue;
      route.push({
        interactionIndex: action.interactionIndex,
        kind: action.kind,
        id: action.id,
      });
      walk(next, route);
      route.pop();
    }
  };
  walk(buildInitialState(problem, interactionByCell), []);

  return {
    status: exhausted ? (found ? "SOLVED" : "UNSOLVABLE") : "RESOURCE_LIMIT",
    found,
    finalHero: bestHero,
    route: bestRoute,
    sequences,
    exhausted,
  };
}

/**
 * Strict replay: every step must be a legal action from the state it is applied
 * to, and the goal must be reachable at the end. This is what stops a solver
 * bug from being reported as a success.
 */
function replayStaticCombatEconomyRoute(problem, route) {
  const interactionByCell = buildInteractionIndex(problem);
  let state = buildInitialState(problem, interactionByCell);
  const steps = route || [];
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const legal = enumerateStaticMacroActions(problem, state)
      .find((action) => action.interactionIndex === step.interactionIndex);
    if (!legal) {
      return { valid: false, reason: `illegal-step:${index}`, finalHero: null, goalReachable: false };
    }
    const next = applyStaticMacroAction(problem, state, legal, interactionByCell);
    if (!next) {
      return { valid: false, reason: `unapplicable-step:${index}`, finalHero: null, goalReachable: false };
    }
    state = next;
  }
  if (!state.goalReachable) {
    return {
      valid: false,
      reason: "goal-not-reachable-after-route",
      finalHero: { ...state.hero },
      goalReachable: false,
    };
  }
  return { valid: true, reason: null, finalHero: { ...state.hero }, goalReachable: true };
}

module.exports = {
  STATIC_SCHEMA,
  applyStaticMacroAction,
  buildStaticStructuralKey,
  computeStaticBattleOutcome,
  computeStaticReachableRegion,
  describeStaticBlockerDeficit,
  enumerateStaticMacroActions,
  insertStaticParetoState,
  replayStaticCombatEconomyRoute,
  solveStaticCombatEconomy,
  solveStaticCombatEconomyExhaustive,
  validateStaticCombatEconomyProblem,
};
