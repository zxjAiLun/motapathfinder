"use strict";

/**
 * PR-5.20c native H5 static floor adapter.
 *
 * Maps ONE event-free H5 floor into the restricted static combat-economy problem
 * of `static-combat-economy-core.js`. It is a data mapper and nothing else:
 *
 *   - it only ever reads an H5-shaped project object that is ALREADY in memory;
 *   - it never touches the filesystem, never requires the project loader, never
 *     loads functions.js, and never evaluates or pattern-matches a script string
 *     to guess what an effect does;
 *   - it never calls the battle resolver, simulator or event resolver.
 *
 * What it proves is therefore narrow and deliberately so: that a floor whose
 * semantics are already inside the static subdomain can be mapped mechanically,
 * with the mapping auditable cell by cell. It is NOT a claim of semantic
 * equivalence with arbitrary H5 `functions.js` behaviour.
 *
 * Everything outside that subdomain fails the whole floor closed. An unsupported
 * cell is never quietly rewritten into a wall so the rest can still be solved:
 * that would silently answer a different question than the one asked.
 *
 * The goal is the floor's unique `changeFloor` tile and it is TERMINAL. This round
 * does not execute the next floor, and the core's goalArchive must not be read as
 * a cross-floor continuation archive.
 */

const WALL = "#";
const FLOOR = ".";

/**
 * Exact canonical `itemEffect` contract. A standard gem or potion is accepted only
 * when its effect string is character-for-character one of the two canonical forms
 * below. No regex, no partial match, no arbitrary-expression interpretation: a
 * custom effect is unsupported, not "probably equivalent".
 */
const CANONICAL_RESOURCE_ITEMS = {
  redJewel: { attribute: "atk", valueKey: "redJewel" },
  blueJewel: { attribute: "def", valueKey: "blueJewel" },
  greenJewel: { attribute: "mdef", valueKey: "greenJewel" },
  redPotion: { attribute: "hp", valueKey: "redPotion" },
  bluePotion: { attribute: "hp", valueKey: "bluePotion" },
  yellowPotion: { attribute: "hp", valueKey: "yellowPotion" },
  greenPotion: { attribute: "hp", valueKey: "greenPotion" },
};

function canonicalEffectWithoutRatio(attribute, valueKey) {
  return `core.status.hero.${attribute} += core.values.${valueKey}`;
}

function canonicalEffectWithRatio(attribute, valueKey) {
  return `core.status.hero.${attribute} += core.values.${valueKey} * core.status.thisMap.ratio`;
}

// Floor-level keys that mean "this floor runs script": any non-empty value fails.
const FLOOR_EVENT_KEYS = [
  "events",
  "autoEvent",
  "firstArrive",
  "eachArrive",
  "parallelDo",
  "beforeBattle",
  "afterBattle",
  "afterGetItem",
  "afterOpenDoor",
  "cannotMove",
  "cannotMoveIn",
  "item_ratio",
  "flags",
];

// Tile triggers this round can express. Anything else -- openDoor, action, pushBox,
// pickaxe/bomb-sensitive tiles, custom triggers -- fails the floor closed.
const SUPPORTED_TRIGGERS = new Set(["getItem", "battle", "changeFloor"]);

// Enemy fields that carry an ability or an economy this subdomain does not model.
const FORBIDDEN_ENEMY_KEYS = [
  "special", "n", "together", "notBomb", "value", "add", "zoneSquare", "range",
  "double", "counter", "vampire", "hpBuff", "atkBuff", "defBuff", "magic",
  "firstAttack", "poison", "weak", "curse", "charge", "bomb", "ambush",
];
const ZERO_ONLY_ENEMY_KEYS = ["money", "exp", "point"];

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

function isEmptyValue(value) {
  if (value == null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  if (typeof value === "string") return value.length === 0;
  if (typeof value === "number") return value === 0;
  return false;
}

function coordinateKey(x, y) {
  return `${x},${y}`;
}

/**
 * Deterministic ordering so an unsupported report is comparable run to run:
 * floor-level findings (no coordinates) first, then row-major, then by reason.
 */
function sortUnsupported(entries) {
  return entries.slice().sort((left, right) => {
    const leftFloor = left.floorId == null ? "" : String(left.floorId);
    const rightFloor = right.floorId == null ? "" : String(right.floorId);
    if (leftFloor !== rightFloor) return leftFloor < rightFloor ? -1 : 1;
    const leftY = left.y == null ? -1 : left.y;
    const rightY = right.y == null ? -1 : right.y;
    if (leftY !== rightY) return leftY - rightY;
    const leftX = left.x == null ? -1 : left.x;
    const rightX = right.x == null ? -1 : right.x;
    if (leftX !== rightX) return leftX - rightX;
    if (left.reason !== right.reason) return left.reason < right.reason ? -1 : 1;
    return 0;
  });
}

function buildResourceGain(item, tileId, values, ratio) {
  const canonical = CANONICAL_RESOURCE_ITEMS[tileId];
  if (canonical == null) return { ok: false, reason: `unsupported-item:${tileId}` };
  if (item == null || typeof item !== "object") {
    return { ok: false, reason: `unknown-item:${tileId}` };
  }
  if (item.cls !== "items") return { ok: false, reason: `unsupported-item-class:${tileId}` };
  // A usable/equippable item is a different mechanic even under a known id.
  for (const key of ["useItemEffect", "canUseItemEffect", "equip", "equipType", "hideStatus"]) {
    if (item[key] != null) {
      return { ok: false, reason: `unsupported-item-field:${tileId}.${key}` };
    }
  }
  if (!isNonEmptyString(item.itemEffect)) {
    return { ok: false, reason: `missing-item-effect:${tileId}` };
  }
  const withoutRatio = canonicalEffectWithoutRatio(canonical.attribute, canonical.valueKey);
  const withRatio = canonicalEffectWithRatio(canonical.attribute, canonical.valueKey);
  let useRatio;
  if (item.itemEffect === withoutRatio) useRatio = false;
  else if (item.itemEffect === withRatio) useRatio = true;
  else return { ok: false, reason: `custom-item-effect:${tileId}` };

  const base = values[canonical.valueKey];
  if (!isPositiveInt(base)) {
    return { ok: false, reason: `unsupported-item-value:${canonical.valueKey}` };
  }
  const multiplier = useRatio ? ratio : 1;
  if (!isPositiveInt(multiplier)) {
    return { ok: false, reason: `unsupported-floor-ratio:${tileId}` };
  }
  const amount = base * multiplier;
  if (!isPositiveInt(amount)) {
    return { ok: false, reason: `unsupported-item-amount:${tileId}` };
  }
  return { ok: true, attribute: canonical.attribute, amount };
}

function buildMonsterStats(enemy, tileId) {
  if (enemy == null || typeof enemy !== "object") {
    return { ok: false, reason: `unknown-enemy:${tileId}` };
  }
  if (!isPositiveInt(enemy.hp)) return { ok: false, reason: `unsupported-enemy-hp:${tileId}` };
  if (!isNonNegativeInt(enemy.atk)) return { ok: false, reason: `unsupported-enemy-atk:${tileId}` };
  if (!isNonNegativeInt(enemy.def)) return { ok: false, reason: `unsupported-enemy-def:${tileId}` };
  for (const key of FORBIDDEN_ENEMY_KEYS) {
    if (!isEmptyValue(enemy[key])) {
      return { ok: false, reason: `special-enemy-field:${tileId}.${key}` };
    }
  }
  for (const key of ZERO_ONLY_ENEMY_KEYS) {
    if (enemy[key] != null && enemy[key] !== 0) {
      return { ok: false, reason: `enemy-economy-field:${tileId}.${key}` };
    }
  }
  return { ok: true, hp: enemy.hp, atk: enemy.atk, def: enemy.def };
}

/**
 * Core of both public entry points. Walks the floor cell by cell and either builds
 * the static problem or reports every reason the floor is out of subdomain.
 */
function analyzeH5StaticFloor(project) {
  const unsupported = [];
  const source = project && typeof project === "object" ? project : null;
  if (source == null) {
    return { eligible: false, floorId: null, unsupported: [{ floorId: null, x: null, y: null, reason: "project-must-be-an-object" }], problem: null, provenance: null };
  }
  const firstData = (source.data || {}).firstData;
  const floorId = firstData == null ? null : firstData.floorId;
  const fail = (reason, x, y) => {
    unsupported.push({ floorId: floorId == null ? null : floorId, x: x == null ? null : x, y: y == null ? null : y, reason });
  };
  const bail = () => ({
    eligible: false,
    floorId: floorId == null ? null : floorId,
    unsupported: sortUnsupported(unsupported),
    problem: null,
    provenance: null,
  });

  if (firstData == null || typeof firstData !== "object") {
    fail("missing-first-data");
    return bail();
  }
  if (!isNonEmptyString(floorId)) {
    fail("missing-first-data-floor-id");
    return bail();
  }
  const floor = (source.floorsById || {})[floorId];
  if (floor == null || typeof floor !== "object") {
    fail("unknown-floor");
    return bail();
  }
  const heroSource = firstData.hero;
  if (heroSource == null || typeof heroSource !== "object") {
    fail("missing-first-data-hero");
    return bail();
  }
  const hero = {
    hp: heroSource.hp,
    atk: heroSource.atk,
    def: heroSource.def,
    mdef: heroSource.mdef,
  };
  if (!isPositiveInt(hero.hp)) fail("unsupported-hero-hp");
  for (const key of ["atk", "def", "mdef"]) {
    if (!isNonNegativeInt(hero[key])) fail(`unsupported-hero-${key}`);
  }
  for (const key of ["money", "exp", "level", "lv", "steps"]) {
    if (heroSource[key] != null && heroSource[key] !== 0) {
      fail(`unsupported-hero-economy:${key}`);
    }
  }
  if (!isEmptyValue(heroSource.items)) fail("unsupported-hero-items");
  if (!isEmptyValue(heroSource.equipment)) fail("unsupported-hero-equipment");
  if (!isEmptyValue(heroSource.flags)) fail("unsupported-hero-flags");
  const loc = heroSource.loc;
  if (loc == null || !isNonNegativeInt(loc.x) || !isNonNegativeInt(loc.y)) {
    fail("missing-hero-loc");
    return bail();
  }

  // Floor-level script hooks.
  for (const key of FLOOR_EVENT_KEYS) {
    if (!isEmptyValue(floor[key])) fail(`floor-event:${key}`);
  }

  const map = floor.map;
  if (!Array.isArray(map) || map.length === 0 || !Array.isArray(map[0])) {
    fail("unsupported-floor-map");
    return bail();
  }
  const height = map.length;
  const width = map[0].length;
  for (let y = 0; y < height; y += 1) {
    if (!Array.isArray(map[y]) || map[y].length !== width) fail(`floor-map-not-rectangular:${y}`);
  }
  if (floor.width != null && floor.width !== width) fail("floor-width-mismatch");
  if (floor.height != null && floor.height !== height) fail("floor-height-mismatch");

  // Exactly one changeFloor tile, and it is the terminal goal for this round.
  const changeFloor = floor.changeFloor || {};
  const exitKeys = Object.keys(changeFloor);
  if (exitKeys.length === 0) {
    fail("missing-floor-exit");
  } else if (exitKeys.length > 1) {
    fail(`multiple-floor-exits:${exitKeys.length}`);
  }
  let goal = null;
  if (exitKeys.length === 1) {
    const parts = exitKeys[0].split(",");
    const gx = Number(parts[0]);
    const gy = Number(parts[1]);
    if (parts.length !== 2 || !isNonNegativeInt(gx) || !isNonNegativeInt(gy) ||
        gx >= width || gy >= height) {
      fail(`unsupported-floor-exit:${exitKeys[0]}`);
    } else {
      goal = { x: gx, y: gy };
    }
  }
  const values = source.values || {};
  const ratio = floor.ratio == null ? 1 : floor.ratio;
  const tilesByNumber = source.mapTilesByNumber || {};
  const itemsById = source.itemsById || {};
  const enemysById = source.enemysById || {};

  const grid = [];
  const interactions = [];
  const provenanceByIndex = [];
  for (let y = 0; y < height; y += 1) {
    let row = "";
    for (let x = 0; x < width; x += 1) {
      const number = map[y][x];
      const isGoalCell = goal != null && goal.x === x && goal.y === y;
      if (!isNonNegativeInt(number)) {
        fail(`unsupported-map-number:${String(number)}`, x, y);
        row += WALL;
        continue;
      }
      if (number === 0) {
        if (isGoalCell) fail("floor-exit-without-tile", x, y);
        row += FLOOR;
        continue;
      }
      const tile = tilesByNumber[String(number)] == null
        ? tilesByNumber[number]
        : tilesByNumber[String(number)];
      if (tile == null || typeof tile !== "object" || !isNonEmptyString(tile.id)) {
        // Never guessed as floor or wall: an unknown tile fails the floor.
        fail(`unknown-map-number:${number}`, x, y);
        row += WALL;
        continue;
      }
      const trigger = tile.trigger == null || tile.trigger === "null" ? null : tile.trigger;
      if (trigger != null && !SUPPORTED_TRIGGERS.has(trigger)) {
        fail(`unsupported-tile-trigger:${tile.id}:${trigger}`, x, y);
        row += WALL;
        continue;
      }
      if (!isEmptyValue(tile.event) || !isEmptyValue(tile.script) ||
          !isEmptyValue(tile.afterGetItem) || !isEmptyValue(tile.afterBattle)) {
        fail(`tile-script:${tile.id}`, x, y);
        row += WALL;
        continue;
      }
      if (isGoalCell) {
        if (trigger !== "changeFloor") {
          fail(`floor-exit-tile-mismatch:${tile.id}`, x, y);
          row += WALL;
          continue;
        }
        // The exit is terminal: reaching it ends this problem, it is not executed.
        row += FLOOR;
        continue;
      }
      if (trigger === "changeFloor") {
        fail(`unregistered-change-floor-tile:${tile.id}`, x, y);
        row += WALL;
        continue;
      }
      const onStart = loc.x === x && loc.y === y;
      if (trigger === "battle") {
        if (tile.cls !== "enemys" && tile.cls !== "enemy48") {
          fail(`unsupported-enemy-class:${tile.id}:${String(tile.cls)}`, x, y);
          row += WALL;
          continue;
        }
        const stats = buildMonsterStats(enemysById[tile.id], tile.id);
        if (!stats.ok) {
          fail(stats.reason, x, y);
          row += WALL;
          continue;
        }
        if (onStart) {
          fail(`interaction-on-hero-start:${tile.id}`, x, y);
          row += FLOOR;
          continue;
        }
        const id = `${floorId}:${x},${y}:${tile.id}`;
        interactions.push({ kind: "monster", id, x, y, hp: stats.hp, atk: stats.atk, def: stats.def });
        provenanceByIndex.push({
          interactionIndex: interactions.length - 1,
          id,
          kind: "monster",
          floorId,
          x,
          y,
          tileNumber: number,
          tileId: tile.id,
        });
        row += FLOOR;
        continue;
      }
      if (trigger === "getItem") {
        if (tile.cls !== "items") {
          fail(`unsupported-item-class:${tile.id}:${String(tile.cls)}`, x, y);
          row += WALL;
          continue;
        }
        const gain = buildResourceGain(itemsById[tile.id], tile.id, values, ratio);
        if (!gain.ok) {
          fail(gain.reason, x, y);
          row += WALL;
          continue;
        }
        if (onStart) {
          fail(`interaction-on-hero-start:${tile.id}`, x, y);
          row += FLOOR;
          continue;
        }
        const id = `${floorId}:${x},${y}:${tile.id}`;
        interactions.push({ kind: "resource", id, x, y, [gain.attribute]: gain.amount });
        provenanceByIndex.push({
          interactionIndex: interactions.length - 1,
          id,
          kind: "resource",
          floorId,
          x,
          y,
          tileNumber: number,
          tileId: tile.id,
        });
        row += FLOOR;
        continue;
      }
      // No trigger: pure terrain. Passability must be stated explicitly.
      if (tile.canPass === true) {
        row += FLOOR;
        continue;
      }
      if (tile.canPass === false) {
        row += WALL;
        continue;
      }
      fail(`unknown-tile-passability:${tile.id}`, x, y);
      row += WALL;
    }
    grid.push(row);
  }

  if (goal != null && grid[goal.y][goal.x] === WALL) fail("floor-exit-not-reachable-terrain", goal.x, goal.y);
  if (grid[loc.y] == null || grid[loc.y][loc.x] !== FLOOR) fail("hero-start-not-open-terrain", loc.x, loc.y);
  const seenIds = new Set();
  for (const interaction of interactions) {
    if (seenIds.has(interaction.id)) fail(`duplicate-interaction-id:${interaction.id}`, interaction.x, interaction.y);
    seenIds.add(interaction.id);
  }
  if (unsupported.length > 0) return bail();

  return {
    eligible: true,
    floorId,
    unsupported: [],
    problem: {
      id: floorId,
      grid,
      start: { x: loc.x, y: loc.y },
      goal,
      hero,
      interactions,
    },
    provenance: {
      floorId,
      byIndex: provenanceByIndex,
      byId: provenanceByIndex.reduce((accumulator, entry) => {
        accumulator[entry.id] = entry;
        return accumulator;
      }, {}),
    },
  };
}

/**
 * Read-only eligibility probe. Reports every reason the floor is outside the
 * static subdomain without building a problem, so a caller can see the full list
 * rather than the first failure.
 */
function inspectH5StaticFloorEligibility(project) {
  const analysis = analyzeH5StaticFloor(project);
  return {
    eligible: analysis.eligible,
    floorId: analysis.floorId,
    unsupported: analysis.unsupported,
    interactionCount: analysis.problem == null ? 0 : analysis.problem.interactions.length,
  };
}

/**
 * Full adaptation. On success returns the static core problem plus per-interaction
 * provenance; on any unsupported finding returns `problem: null` and the reasons.
 * There is deliberately no partial mode.
 */
function adaptH5StaticFloor(project) {
  const analysis = analyzeH5StaticFloor(project);
  return {
    eligible: analysis.eligible,
    floorId: analysis.floorId,
    unsupported: analysis.unsupported,
    problem: analysis.problem,
    provenance: analysis.provenance,
  };
}

/**
 * Translate a static-core route back into H5 cell steps. Every step is checked
 * against the recorded provenance, so a route that names an interaction the
 * adaptation never produced is an error rather than a silently mapped step.
 */
function mapStaticRouteToH5Steps(adaptation, route) {
  if (adaptation == null || !adaptation.eligible || adaptation.provenance == null) {
    return { ok: false, reason: "adaptation-not-eligible", steps: [] };
  }
  const byIndex = adaptation.provenance.byIndex;
  const steps = [];
  const source = route || [];
  for (let index = 0; index < source.length; index += 1) {
    const step = source[index];
    if (step == null || !isNonNegativeInt(step.interactionIndex)) {
      return { ok: false, reason: `malformed-route-step:${index}`, steps: [] };
    }
    const record = byIndex[step.interactionIndex];
    if (record == null) {
      return { ok: false, reason: `unknown-route-step:${index}`, steps: [] };
    }
    if (record.id !== step.id || record.kind !== step.kind) {
      return { ok: false, reason: `route-step-provenance-mismatch:${index}`, steps: [] };
    }
    steps.push({
      routeIndex: index,
      interactionIndex: record.interactionIndex,
      id: record.id,
      kind: record.kind,
      floorId: record.floorId,
      x: record.x,
      y: record.y,
      tileNumber: record.tileNumber,
      tileId: record.tileId,
    });
  }
  return { ok: true, reason: null, steps };
}

module.exports = {
  CANONICAL_RESOURCE_ITEMS,
  adaptH5StaticFloor,
  inspectH5StaticFloorEligibility,
  mapStaticRouteToH5Steps,
};
