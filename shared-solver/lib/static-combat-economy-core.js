"use strict";

/**
 * PR-5.20a/5.20b static combat-economy core.
 *
 * A deliberately small, self-contained correctness solver for ONE restricted
 * problem class: a rectangular static map, a hero with hp/atk/def/mdef, plain
 * monsters with hp/atk/def, and one-time attribute resources. Nothing else.
 * There are no events, flags, equipment, keys, money, exp, skills or monster
 * special abilities, and `validateStaticCombatEconomyProblem` rejects any input
 * that mentions them -- or any field it does not recognise at all -- rather than
 * silently ignoring it.
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

// Rejected by name so a caller cannot smuggle a non-static concept past the
// generic unknown-field check with a plausible spelling.
const FORBIDDEN_PROBLEM_KEYS = [
  "events", "event", "flags", "flag", "equipment", "equips", "keys", "key",
  "money", "gold", "coins", "exp", "experience", "level", "skills", "skill",
  "items", "shops", "shop", "npc", "npcs",
];
const ALLOWED_PROBLEM_KEYS = ["id", "grid", "start", "goal", "hero", "interactions"];
const ALLOWED_POINT_KEYS = ["x", "y"];
const ALLOWED_HERO_KEYS = ["hp", "atk", "def", "mdef"];
const ALLOWED_MONSTER_KEYS = ["kind", "id", "x", "y", "hp", "atk", "def"];
const ALLOWED_RESOURCE_KEYS = ["kind", "id", "x", "y", "hp", "atk", "def", "mdef"];

const FORBIDDEN_MONSTER_KEYS = [
  "special", "specials", "ability", "abilities", "firstAttack", "magic",
  "poison", "weak", "hpBuff", "atkBuff", "defBuff", "n", "double", "counter",
  "vampire", "money", "exp", "point", "skill",
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
 * `problem` is a normalized copy (only on success).
 *
 * The allowlists are strict on purpose: an unrecognised field is an error, not
 * a warning. Silently ignoring `problem.events` or `hero.level` would let a
 * non-static tower look like a valid static one, which is exactly the claim this
 * benchmark must not make by accident.
 */
function validateStaticCombatEconomyProblem(input) {
  const errors = [];
  const problem = input && typeof input === "object" && !Array.isArray(input) ? input : null;
  if (!problem) {
    return { valid: false, errors: ["problem-must-be-an-object"], problem: null };
  }
  for (const key of Object.keys(problem)) {
    if (FORBIDDEN_PROBLEM_KEYS.includes(key)) {
      errors.push(`forbidden-problem-field:${key}`);
    } else if (!ALLOWED_PROBLEM_KEYS.includes(key)) {
      errors.push(`unknown-problem-field:${key}`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(problem, "id") && !isNonEmptyString(problem.id)) {
    errors.push("id-must-be-a-non-empty-string");
  }

  const grid = problem.grid;
  let height = 0;
  let width = 0;
  if (!Array.isArray(grid) || grid.length === 0) {
    errors.push("grid-must-be-a-non-empty-array");
  } else {
    height = grid.length;
    if (!isNonEmptyString(grid[0])) {
      errors.push("grid-rows-must-be-non-empty-strings");
    } else {
      width = grid[0].length;
      for (let y = 0; y < height; y += 1) {
        if (!isNonEmptyString(grid[y]) || grid[y].length !== width) {
          errors.push(`grid-row-not-rectangular:${y}`);
          continue;
        }
        for (let x = 0; x < width; x += 1) {
          const cell = grid[y][x];
          // Only walls and floor. Decorative markers such as S/M/G would be
          // read as floor and quietly disagree with the interaction list.
          if (cell !== WALL && cell !== FLOOR) {
            errors.push(`grid-illegal-character:${y},${x}:${cell}`);
          }
        }
      }
    }
  }

  const hero = problem.hero && typeof problem.hero === "object" && !Array.isArray(problem.hero)
    ? problem.hero
    : null;
  if (!hero) {
    errors.push("hero-must-be-an-object");
  } else {
    if (!isPositiveInt(hero.hp)) errors.push("hero.hp-must-be-a-positive-integer");
    for (const key of ["atk", "def", "mdef"]) {
      if (!isNonNegativeInt(hero[key])) {
        errors.push(`hero.${key}-must-be-a-non-negative-integer`);
      }
    }
    for (const key of Object.keys(hero)) {
      if (!ALLOWED_HERO_KEYS.includes(key)) errors.push(`forbidden-hero-field:${key}`);
    }
  }

  const inBounds = (x, y) => isNonNegativeInt(x) && isNonNegativeInt(y) &&
    y < height && x < width;
  const cellAt = (x, y) => grid[y][x];
  const checkPoint = (point, label) => {
    const value = point && typeof point === "object" && !Array.isArray(point) ? point : null;
    if (!value) {
      errors.push(`${label}-must-be-an-object`);
      return false;
    }
    for (const key of Object.keys(value)) {
      if (!ALLOWED_POINT_KEYS.includes(key)) errors.push(`forbidden-${label}-field:${key}`);
    }
    if (!inBounds(value.x, value.y)) {
      errors.push(`${label}-must-be-in-bounds`);
      return false;
    }
    if (cellAt(value.x, value.y) === WALL) {
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
  const seenIds = new Set();
  if (!Array.isArray(interactions)) {
    errors.push("interactions-must-be-an-array");
  } else {
    for (let index = 0; index < interactions.length; index += 1) {
      const raw = interactions[index];
      const label = `interactions[${index}]`;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        errors.push(`${label}-must-be-an-object`);
        continue;
      }
      // Route identity must be stable and unambiguous, so ids are mandatory and
      // globally unique rather than defaulted from coordinates.
      if (!isNonEmptyString(raw.id)) {
        errors.push(`${label}.id-must-be-a-non-empty-string`);
      } else if (seenIds.has(raw.id)) {
        errors.push(`${label}.id-duplicates:${raw.id}`);
      } else {
        seenIds.add(raw.id);
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
          } else if (!ALLOWED_MONSTER_KEYS.includes(key)) {
            errors.push(`unknown-monster-field:${label}.${key}`);
          }
        }
        normalizedInteractions.push({
          kind: "monster",
          id: raw.id,
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
          if (!ALLOWED_RESOURCE_KEYS.includes(key)) {
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
          id: raw.id,
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
      hero: { hp: hero.hp, atk: hero.atk, def: hero.def, mdef: hero.mdef },
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
let scratchVisited = null;

function borrowScratchVisited(total) {
  if (scratchVisited == null || scratchVisited.length < total) {
    scratchVisited = new Uint8Array(total);
    return scratchVisited;
  }
  scratchVisited.fill(0, 0, total);
  return scratchVisited;
}

function computeStaticReachableRegion(problem, originIndex, consumed, interactionByCell) {
  const byCell = interactionByCell || buildInteractionIndex(problem);
  const total = problem.width * problem.height;
  // `visited` never escapes this call, so it is borrowed rather than allocated:
  // one reachability call happens per generated state and the churn is what makes
  // V8 grow its heap far beyond the live set.
  const visited = borrowScratchVisited(total);
  const region = new Uint8Array(total);
  const frontierInteractions = [];
  const frontierSeen = new Set();
  const queue = [originIndex];
  visited[originIndex] = 1;
  region[originIndex] = 1;
  const goalIndex = cellIndex(problem, problem.goal.x, problem.goal.y);
  let goalReachable = originIndex === goalIndex;
  while (queue.length > 0) {
    const current = queue.pop();
    const cx = current % problem.width;
    const cy = (current - cx) / problem.width;
    const neighbours = [[cx, cy - 1], [cx, cy + 1], [cx - 1, cy], [cx + 1, cy]];
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

/**
 * Applies one macro action. Guards its own preconditions instead of trusting the
 * caller: the interaction must be on the CURRENT frontier (so nothing unreachable
 * can be consumed) and the action's kind/id must match the real interaction (so a
 * forged or stale step cannot be replayed as if it were legal).
 */
function applyStaticMacroAction(problem, state, action, interactionByCell) {
  if (!action || !isNonNegativeInt(action.interactionIndex)) return null;
  const interaction = problem.interactions[action.interactionIndex];
  if (!interaction) return null;
  if (!state.frontierInteractions.includes(action.interactionIndex)) return null;
  if (action.kind !== interaction.kind) return null;
  if (action.id !== interaction.id) return null;
  const hero = { ...state.hero };
  if (interaction.kind === "resource") {
    for (const attribute of RESOURCE_ATTRIBUTES) {
      if (interaction.gain[attribute] != null) hero[attribute] += interaction.gain[attribute];
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

const HEX_DIGITS = "0123456789abcdef";

/**
 * Pack a cell bitset four cells per character. The encoding is injective over
 * fixed-length bitsets -- every state on one map shares that map's cell count, so
 * the same cells always give the same string and different cells never can -- but
 * one structural key is built for every generated state, so the difference between
 * one character per cell and four cells per character is the difference between
 * tens of megabytes of short-lived string churn and a few.
 */
function bitsetToString(bits) {
  let out = "";
  let nibble = 0;
  let filled = 0;
  for (let index = 0; index < bits.length; index += 1) {
    nibble = (nibble << 1) | (bits[index] ? 1 : 0);
    filled += 1;
    if (filled === 4) {
      out += HEX_DIGITS[nibble];
      nibble = 0;
      filled = 0;
    }
  }
  if (filled > 0) out += HEX_DIGITS[nibble << (4 - filled)];
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
 * Pareto insert within ONE structural bucket. A state may only be discarded by a
 * state that is no worse in all four attributes, which is safe because every
 * attribute is monotonically good: more hp survives more, more atk needs fewer
 * hits, more def and mdef reduce damage.
 *
 * Returns the node ids it evicted so the caller can retire their agenda entries
 * instead of expanding a state that is already known to be dominated.
 */
function insertStaticParetoState(bucket, hero, nodeId) {
  for (const existing of bucket) {
    if (dominatesStatic(existing, hero)) {
      return { inserted: false, dominated: 0, evictedNodeIds: [] };
    }
  }
  const evictedNodeIds = [];
  for (let index = bucket.length - 1; index >= 0; index -= 1) {
    if (dominatesStatic(hero, bucket[index])) {
      if (bucket[index].nodeId != null) evictedNodeIds.push(bucket[index].nodeId);
      bucket.splice(index, 1);
    }
  }
  bucket.push({
    hp: hero.hp,
    atk: hero.atk,
    def: hero.def,
    mdef: hero.mdef,
    nodeId: nodeId == null ? null : nodeId,
  });
  return { inserted: true, dominated: evictedNodeIds.length, evictedNodeIds };
}

/**
 * PR-5.20b goal archive. Every state that can reach the goal is offered here and
 * the non-dominated set over [hp,atk,def,mdef] is kept, so a high-hp/low-atk
 * finish and a low-hp/high-atk finish both survive instead of the second being
 * silently discarded by an hp-only comparison.
 */
function insertStaticGoalParetoState(archive, entry) {
  for (const existing of archive) {
    if (dominatesStatic(existing.hero, entry.hero)) return { inserted: false, removed: 0 };
  }
  let removed = 0;
  for (let index = archive.length - 1; index >= 0; index -= 1) {
    if (dominatesStatic(entry.hero, archive[index].hero)) {
      archive.splice(index, 1);
      removed += 1;
    }
  }
  archive.push({ hero: { ...entry.hero }, nodeId: entry.nodeId });
  return { inserted: true, removed };
}

/**
 * Lexicographic deficit of the blockers on the current frontier: how much atk is
 * still missing (first) and how much survivability is still missing (second).
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

function hasBlockerDeficit(deficit) {
  return deficit.attackDeficit > 0 || deficit.survivalDeficit > 0;
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

/**
 * Minimal array-backed binary heap; ties break on the trailing sequence key.
 *
 * The agendas store only lightweight tickets (see `buildAgendaTicket`), never the
 * state itself. That matters for memory, not just tidiness: a state pushed into
 * two agendas and expanded from one would otherwise stay alive through the other
 * agenda's stale entry, keeping its consumed Set, region bitset, frontier list and
 * blocker array resident long after the state was done with.
 */
class BinaryHeap {
  constructor(compare) {
    this.items = [];
    this.compare = compare;
  }

  get size() {
    return this.items.length;
  }

  /**
   * Replace the contents with `items` and re-heapify in place. Used purely to
   * drop accumulated stale tickets: ranks, membership and therefore pop order are
   * unchanged, because every ticket rank ends in the node id and is a total order.
   */
  rebuild(items) {
    this.items = items.slice();
    for (let index = (this.items.length >> 1) - 1; index >= 0; index -= 1) {
      this.siftDown(index);
    }
  }

  siftDown(startIndex) {
    const items = this.items;
    let index = startIndex;
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let best = index;
      if (left < items.length && this.compare(items[left], items[best]) < 0) best = left;
      if (right < items.length && this.compare(items[right], items[best]) < 0) best = right;
      if (best === index) return;
      const swap = items[best];
      items[best] = items[index];
      items[index] = swap;
      index = best;
    }
  }

  push(item) {
    const items = this.items;
    items.push(item);
    let index = items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.compare(items[index], items[parent]) >= 0) break;
      const swap = items[parent];
      items[parent] = items[index];
      items[index] = swap;
      index = parent;
    }
  }

  pop() {
    const items = this.items;
    if (items.length === 0) return null;
    const top = items[0];
    const last = items.pop();
    if (items.length > 0) {
      items[0] = last;
      this.siftDown(0);
    }
    return top;
  }
}

/**
 * The only thing an agenda is allowed to hold: a node id and its rank vector.
 * Deliberately not the entry, so expanding a state from one agenda lets it be
 * collected even while the other agenda still holds a stale ticket for it.
 */
function buildAgendaTicket(id, rank) {
  return { id, rank };
}

function compareRankArrays(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

// Highest hp first: hoard resources, pay nothing you do not have to.
function conserveHpRank(entry) {
  return [-entry.hero.hp, -entry.hero.atk, -entry.hero.def, -entry.hero.mdef, entry.id];
}

// Smallest remaining deficit, then strongest attack, then the state most willing
// to have spent hp. This is the "invest now" ordering.
function breakBottleneckRank(entry) {
  return [
    entry.deficit.attackDeficit,
    entry.deficit.survivalDeficit,
    -entry.hero.atk,
    entry.hero.hp,
    entry.id,
  ];
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
 * Adaptive static solver.
 *
 * Scheduling only. Both agendas hold the SAME set of pending states and both
 * respect the same legality and Pareto rules, so switching mode can never make
 * an illegal route legal, resurrect a dominated state, or change a structural
 * key. It only changes which pending state is looked at next.
 *
 * status:
 *   SOLVED         agendas drained and at least one goal state was found ->
 *                  goalArchive is the complete non-dominated goal set
 *   RESOURCE_LIMIT expansion budget reached; goalArchive may be non-empty but is
 *                  NOT proven complete or optimal. Never reported as UNSOLVABLE.
 *   UNSOLVABLE     agendas drained with no goal state at all
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
  const pending = new Map();
  const retired = new Set();
  let nextId = 0;

  const conserveHeap = new BinaryHeap((left, right) => compareRankArrays(left.rank, right.rank));
  const breakHeap = new BinaryHeap((left, right) => compareRankArrays(left.rank, right.rank));

  let expanded = 0;
  let generated = 0;
  let dominated = 0;
  let peakFrontier = 0;
  let modeSwitches = 0;
  let agendaRebuilds = 0;
  let mode = CONSERVE_HP;
  let stagnation = 0;
  let breakBottleneckRemaining = 0;
  let bestDeficit = null;
  const goalArchive = [];

  // Every admitted state goes into BOTH heaps as a ticket; `pending` is the single
  // source of truth both for what is still expandable AND for the state objects
  // themselves, so a state is expanded exactly once no matter which agenda reaches
  // it first, and becomes collectable the moment it leaves `pending`.
  const admit = (entry) => {
    pending.set(entry.id, entry);
    conserveHeap.push(buildAgendaTicket(entry.id, conserveHpRank(entry)));
    breakHeap.push(buildAgendaTicket(entry.id, breakBottleneckRank(entry)));
    if (pending.size > peakFrontier) peakFrontier = pending.size;
  };
  const retire = (nodeId) => {
    if (!pending.has(nodeId)) return;
    pending.delete(nodeId);
    retired.add(nodeId);
  };
  // Stale tickets are cheap but unbounded; once they dominate the agendas, rebuild
  // both from the live pending set. Pure memory hygiene: same ranks, same
  // membership, same pop order.
  const compactAgendas = () => {
    if (conserveHeap.size + breakHeap.size <= pending.size * 4 + 4096) return;
    const conserveTickets = [];
    const breakTickets = [];
    for (const entry of pending.values()) {
      conserveTickets.push(buildAgendaTicket(entry.id, conserveHpRank(entry)));
      breakTickets.push(buildAgendaTicket(entry.id, breakBottleneckRank(entry)));
    }
    conserveHeap.rebuild(conserveTickets);
    breakHeap.rebuild(breakTickets);
    agendaRebuilds += 1;
  };
  const popNext = () => {
    const heap = mode === BREAK_BOTTLENECK ? breakHeap : conserveHeap;
    for (;;) {
      const ticket = heap.pop();
      if (ticket == null) return null;
      const entry = pending.get(ticket.id);
      // Stale: already expanded from the other agenda, or Pareto-evicted.
      if (entry == null) continue;
      pending.delete(ticket.id);
      return entry;
    }
  };

  const initial = buildInitialState(problem, interactionByCell);
  const rootId = (nextId += 1);
  nodes.set(rootId, { parentId: null, action: null });
  const rootDeficit = describeStaticBlockerDeficit(problem, initial);
  const rootEntry = {
    id: rootId,
    hero: initial.hero,
    consumed: initial.consumed,
    originIndex: initial.originIndex,
    frontierInteractions: initial.frontierInteractions,
    goalReachable: initial.goalReachable,
    deficit: {
      attackDeficit: rootDeficit.attackDeficit,
      survivalDeficit: rootDeficit.survivalDeficit,
    },
  };
  const rootKey = buildStaticStructuralKey(initial.consumed, initial.region);
  buckets.set(rootKey, []);
  insertStaticParetoState(buckets.get(rootKey), initial.hero, rootId);
  generated += 1;
  bestDeficit = rootEntry.deficit;
  if (rootEntry.goalReachable) {
    insertStaticGoalParetoState(goalArchive, { hero: rootEntry.hero, nodeId: rootId });
  }
  admit(rootEntry);

  let limitReached = false;
  for (;;) {
    if (expanded >= maxExpandedStates) {
      // Only the live pending set can say whether work remains. A heap may hold
      // nothing but stale tickets, which would otherwise make an exhausted search
      // report RESOURCE_LIMIT at exactly its own expansion count.
      limitReached = pending.size > 0;
      break;
    }
    compactAgendas();
    const entry = popNext();
    if (entry == null) break;
    expanded += 1;

    if (compareDeficit(entry.deficit, bestDeficit) < 0) {
      bestDeficit = entry.deficit;
      stagnation = 0;
    } else if (hasBlockerDeficit(entry.deficit)) {
      // Only a real, currently-blocking deficit can accumulate stagnation. With
      // nothing blocked there is no bottleneck to break, so the solver must not
      // oscillate between agendas for no reason.
      stagnation += 1;
    } else {
      stagnation = 0;
    }
    if (mode === BREAK_BOTTLENECK) {
      breakBottleneckRemaining -= 1;
      if (breakBottleneckRemaining <= 0) {
        mode = CONSERVE_HP;
        stagnation = 0;
      }
    } else if (adaptive && stagnation >= STAGNATION_LIMIT && hasBlockerDeficit(bestDeficit)) {
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
      const nodeId = nextId + 1;
      const insertion = insertStaticParetoState(buckets.get(key), next.hero, nodeId);
      if (!insertion.inserted) {
        dominated += 1;
        continue;
      }
      nextId = nodeId;
      dominated += insertion.dominated;
      for (const evictedNodeId of insertion.evictedNodeIds) retire(evictedNodeId);
      nodes.set(nodeId, {
        parentId: entry.id,
        action: { interactionIndex: action.interactionIndex, kind: action.kind, id: action.id },
      });
      const nextDeficit = describeStaticBlockerDeficit(problem, next);
      const nextEntry = {
        id: nodeId,
        hero: next.hero,
        consumed: next.consumed,
        originIndex: next.originIndex,
        frontierInteractions: next.frontierInteractions,
        goalReachable: next.goalReachable,
        // No `region` and no `blockers`: the key is already built and ranking only
        // reads the two deficit numbers, so holding them would pin bytes per
        // pending state for nothing.
        deficit: {
          attackDeficit: nextDeficit.attackDeficit,
          survivalDeficit: nextDeficit.survivalDeficit,
        },
      };
      if (nextEntry.goalReachable) {
        insertStaticGoalParetoState(goalArchive, { hero: nextEntry.hero, nodeId });
      }
      admit(nextEntry);
    }
  }

  let status;
  if (limitReached) status = "RESOURCE_LIMIT";
  else if (goalArchive.length > 0) status = "SOLVED";
  else status = "UNSOLVABLE";

  const archive = goalArchive
    .map((item) => ({
      hero: { ...item.hero },
      nodeId: item.nodeId,
      route: reconstructRoute(nodes, item.nodeId),
    }))
    .sort((left, right) => right.hero.hp - left.hero.hp || left.nodeId - right.nodeId);
  const best = archive.length > 0 ? archive[0] : null;

  return {
    status,
    route: best == null ? null : best.route,
    finalHero: best == null ? null : { ...best.hero },
    goalArchive: archive,
    expanded,
    generated,
    dominated,
    peakFrontier,
    modeSwitches,
    retiredStates: retired.size,
    agendaRebuilds,
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
  const goalArchive = [];

  const walk = (state, route) => {
    if (!exhausted) return;
    sequences += 1;
    if (sequences > maxSequences) {
      exhausted = false;
      return;
    }
    if (state.goalReachable) {
      found = true;
      insertStaticGoalParetoState(goalArchive, { hero: state.hero, nodeId: null });
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
    goalArchive: goalArchive.map((item) => ({ hero: { ...item.hero } })),
    sequences,
    exhausted,
  };
}

/**
 * Strict replay: every step must be a legal action from the state it is applied
 * to AND must name the same kind/id as the interaction it points at, and the goal
 * must be reachable at the end. Checking the index alone would accept a step that
 * silently referred to a different interaction than the route claims.
 */
function replayStaticCombatEconomyRoute(problem, route) {
  const interactionByCell = buildInteractionIndex(problem);
  let state = buildInitialState(problem, interactionByCell);
  const steps = route || [];
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    if (!step || !isNonNegativeInt(step.interactionIndex)) {
      return { valid: false, reason: `malformed-step:${index}`, finalHero: null, goalReachable: false };
    }
    const interaction = problem.interactions[step.interactionIndex];
    if (!interaction) {
      return { valid: false, reason: `unknown-interaction:${index}`, finalHero: null, goalReachable: false };
    }
    if (step.kind !== interaction.kind || step.id !== interaction.id) {
      return { valid: false, reason: `step-identity-mismatch:${index}`, finalHero: null, goalReachable: false };
    }
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
  BREAK_BOTTLENECK,
  BinaryHeap,
  CONSERVE_HP,
  buildAgendaTicket,
  STATIC_SCHEMA,
  applyStaticMacroAction,
  buildStaticStructuralKey,
  computeStaticBattleOutcome,
  computeStaticReachableRegion,
  describeStaticBlockerDeficit,
  enumerateStaticMacroActions,
  insertStaticGoalParetoState,
  insertStaticParetoState,
  replayStaticCombatEconomyRoute,
  solveStaticCombatEconomy,
  solveStaticCombatEconomyExhaustive,
  validateStaticCombatEconomyProblem,
};
