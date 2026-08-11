"use strict";

/**
 * PR-5.6b Eval A1 — MT5 near-term admissible feasibility surface.
 *
 * Scope note, established by measurement before any bound was written:
 *
 * `admissible-v1` reads `optimisticHeroGain` as a per-segment CONSTANT, so a
 * sound value must hold for every state inside the segment -- i.e. it must
 * assume the segment's whole resource pool is still untouched.  Measured
 * against the real MT4+MT5 pool, that constant can never refute a third-gate
 * candidate on any of hp/atk/def/mdef/exp: the pool alone clears every
 * threshold.  Stat bounds therefore contribute coverage, not pruning, at this
 * segment.  The clauses that CAN hard-refute here are the floor graph and
 * protected tiles, and those are computed exactly.
 *
 * Two tower mechanics would silently break admissibility if folded into the
 * constant, so both are excluded and reported:
 *   - level-up grants atk/def cumulatively (1.27e18 from lv4), which would
 *     inflate the bound past any possible threshold;
 *   - level 5 grants item I608, and levels 9/14/19/25 double it, multiplying
 *     all subsequent battle exp by up to 32x.
 * Both are state-dependent and belong to a later remaining-resource layer.
 *
 * Everything here is observation-only: it produces evidence for audits and the
 * eval vector, and never reaches the DP key, dominance, the agenda, candidate
 * capacity, or any pruning decision.
 */

const { getTileDefinitionAt } = require("./state");
const { executeItemEffect } = require("./effect-vm");

const STAT_FIELDS = ["hp", "atk", "def", "mdef", "lv", "exp"];

// Goal clauses admissible-v1 has no representation for.  A segment carrying
// any of these cannot be declared evidence-complete, so it stays unknown
// rather than being promoted on the strength of the clauses it CAN check.
const UNSUPPORTED_GOAL_CLAUSES = [
  "removedTiles",
  "presentTiles",
  "equipmentIncludes",
  "actionSurvivable",
  "resourceDeferral",
  "anyRemovedTiles",
];

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveGatewayTarget(project, floorId, target) {
  if (target !== ":next" && target !== ":before") return String(target);
  const order = project.floorOrder || [];
  const index = order.indexOf(floorId);
  if (index < 0) return null;
  return target === ":next" ? order[index + 1] : order[index - 1] || null;
}

/**
 * Resolve the floor graph the segment's action policy actually permits.
 * `allowChangeFloors` carries stair summaries like "MT4:6,12", which are
 * mapped back through the project's real changeFloor tiles, including :next /
 * :before floor-order aliases.  The graph is only marked complete when every
 * declared gateway resolves, since an unresolved gateway means the declared
 * edge set is not the true edge set.
 */
function buildFloorGraph(project, segment) {
  const policy = (segment && segment.actionPolicy) || {};
  const allowedFloors = (policy.allowedFloors || []).map(String);
  const declared = (policy.allowChangeFloors || []).map(String);
  const summaryPattern = /^([^:]+):(\d+),(\d+)$/;
  const edges = [];
  const unresolved = [];
  for (const summary of declared) {
    const match = summaryPattern.exec(summary);
    if (!match) { unresolved.push(summary); continue; }
    const floorId = match[1];
    const floor = project.floorsById[floorId];
    const gateway = floor && floor.changeFloor && floor.changeFloor[`${match[2]},${match[3]}`];
    const target = gateway && resolveGatewayTarget(project, floorId, gateway.floorId);
    if (!target) { unresolved.push(summary); continue; }
    edges.push({ from: floorId, to: String(target) });
  }
  const complete = declared.length > 0 && unresolved.length === 0;
  const adjacency = {};
  for (const edge of edges) {
    if (!adjacency[edge.from]) adjacency[edge.from] = [];
    if (!adjacency[edge.from].includes(edge.to)) adjacency[edge.from].push(edge.to);
  }
  return { complete, edges, adjacency, unresolved, allowedFloors };
}

/**
 * Measure one item's real stat delta by executing the tower's own item effect.
 * Runs twice from different hero baselines: a delta that changes with the
 * baseline is proportional (e.g. `atk *= 1.05`) and cannot enter a constant
 * pool, so it is reported as non-constant instead of being approximated.
 */
function measureItemGain(project, floorId, item) {
  const makeState = (base) => ({
    floorId,
    hero: {
      hp: base, atk: base, def: base, mdef: base, exp: base, lv: 1,
      money: base, mana: base, equipment: [], loc: { x: 0, y: 0 },
    },
    inventory: {}, flags: {}, visitedFloors: {}, floorStates: {},
    route: [], notes: [], meta: { decisionDepth: 0, rawRouteLength: 0 },
  });
  const snapshot = (state) =>
    STAT_FIELDS.reduce((acc, field) => { acc[field] = number(state.hero[field], 0); return acc; }, {});
  const deltaOf = (state, before) =>
    STAT_FIELDS.reduce((acc, field) => {
      const delta = number(state.hero[field], 0) - before[field];
      if (delta !== 0) acc[field] = delta;
      return acc;
    }, {});

  const low = makeState(0);
  const lowBefore = snapshot(low);
  try { executeItemEffect(project, low, item); } catch (error) {
    return { kind: "error", message: error && error.message };
  }
  const lowDelta = deltaOf(low, lowBefore);
  const granted = Object.keys(low.inventory || {}).filter((id) => number(low.inventory[id], 0) > 0);
  if (granted.length > 0) return { kind: "grants-inventory", delta: lowDelta, granted };
  if (Object.keys(lowDelta).length === 0) return { kind: "no-stat-gain" };

  const high = makeState(1000000);
  const highBefore = snapshot(high);
  try { executeItemEffect(project, high, item); } catch (error) {
    return { kind: "error", message: error && error.message };
  }
  const highDelta = deltaOf(high, highBefore);
  if (JSON.stringify(lowDelta) !== JSON.stringify(highDelta)) {
    return { kind: "non-constant", delta: lowDelta, highDelta };
  }
  return { kind: "constant", delta: lowDelta };
}

/**
 * Sum every constant stat gain still physically present on the segment's
 * allowed floors, plus the exp carried by remaining enemy tiles.  Guard
 * rewards need no separate term: a battle's guards are removed with the
 * defeated enemy, so each enemy tile's exp is awarded at most once.
 */
function buildGainPool(project, segment) {
  const policy = (segment && segment.actionPolicy) || {};
  const floors = (policy.allowedFloors || []).map(String);
  const totals = {};
  const itemSources = [];
  const enemySources = [];
  const nonConstant = [];
  const inventoryGrants = [];
  const errors = [];

  for (const floorId of floors) {
    const floor = project.floorsById[floorId];
    if (!floor) continue;
    const scanState = { floorId, hero: {}, inventory: {}, flags: {}, floorStates: {} };
    for (let y = 0; y < number(floor.height, 0); y += 1) {
      for (let x = 0; x < number(floor.width, 0); x += 1) {
        const tile = getTileDefinitionAt(project, scanState, floorId, x, y);
        if (!tile || !tile.id) continue;
        const at = `${floorId}:${x},${y}`;
        if (project.itemsById[tile.id]) {
          const measured = measureItemGain(project, floorId, project.itemsById[tile.id]);
          if (measured.kind === "error") { errors.push({ id: tile.id, at, message: measured.message }); continue; }
          if (measured.kind === "no-stat-gain") continue;
          if (measured.kind === "grants-inventory") {
            inventoryGrants.push({ id: tile.id, at, granted: measured.granted });
            continue;
          }
          if (measured.kind === "non-constant") {
            nonConstant.push({ id: tile.id, at, lowDelta: measured.delta, highDelta: measured.highDelta });
            continue;
          }
          itemSources.push({ id: tile.id, at, delta: measured.delta });
          for (const [field, value] of Object.entries(measured.delta)) {
            totals[field] = number(totals[field], 0) + value;
          }
        } else if (project.enemysById[tile.id]) {
          const enemy = project.enemysById[tile.id];
          const exp = number(enemy.exp, 0);
          const point = number(enemy.point, 0);
          enemySources.push({ id: tile.id, at, exp, point });
          if (exp) totals.exp = number(totals.exp, 0) + exp;
          // `point` becomes atk only when the tower enables add-point; Only Up
          // has enableAddPoint=false, so it is recorded but never summed.
        }
      }
    }
  }

  return {
    floors,
    totals,
    itemSources,
    enemySources,
    nonConstant,
    inventoryGrants,
    errors,
    addPointEnabled: Boolean((project.defaultFlags || {}).enableAddPoint),
  };
}

/**
 * Enumerate the level-up mechanics that make a constant stat/exp bound unsound,
 * so the caller can state explicitly why they are excluded rather than
 * silently omitting them.
 */
function summarizeLevelUpRisk(project, heroLv) {
  const entries = (((project.data || {}).firstData || {}).levelUp) || [];
  const startLv = number(heroLv, 0);
  let atk = 0;
  let def = 0;
  let mdef = 0;
  const expMultiplierGrants = [];
  for (let index = startLv; index < entries.length; index += 1) {
    for (const action of entries[index].action || []) {
      if (!action || action.type !== "setValue") continue;
      const value = Number(action.value);
      if (action.name === "status:atk" && action.operator === "+=" && Number.isFinite(value)) atk += value;
      if (action.name === "status:def" && action.operator === "+=" && Number.isFinite(value)) def += value;
      if (action.name === "status:mdef" && action.operator === "+=" && Number.isFinite(value)) mdef += value;
      if (action.name === "item:I608") {
        expMultiplierGrants.push({ atLevel: index, operator: action.operator || "=", value: action.value });
      }
    }
  }
  return {
    applicable: startLv < entries.length,
    heroLv: startLv,
    entriesTotal: entries.length,
    remainingGrants: { atk, def, mdef },
    expMultiplierGrants,
    // I608 starts at 2 and doubles at each later grant.
    maxExpMultiplier: expMultiplierGrants.length > 0
      ? 2 ** expMultiplierGrants.length
      : 1,
  };
}

function unsupportedGoalClauses(goal) {
  return UNSUPPORTED_GOAL_CLAUSES.filter((clause) => {
    const value = (goal || {})[clause];
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  });
}

/**
 * Compile an `admissibleBounds` block for one segment, together with the
 * provenance of every number in it and an explicit statement of which declared
 * goal fields are covered.  A segment carrying clauses admissible-v1 cannot
 * express is returned as unsupported instead of partially bounded.
 */
function buildSegmentAdmissibleBounds(project, segment, options) {
  const config = options || {};
  const goal = (segment && segment.goal) || {};
  const unsupported = unsupportedGoalClauses(goal);
  if (unsupported.length > 0) {
    return {
      segmentId: segment && segment.id,
      supported: false,
      reason: "unsupported-goal-clauses",
      unsupportedClauses: unsupported,
    };
  }

  const graph = buildFloorGraph(project, segment);
  const pool = buildGainPool(project, segment);
  const levelUp = summarizeLevelUpRisk(project, config.heroLv);

  const optimisticHeroGain = {};
  for (const field of Object.keys(goal.minHero || {})) {
    const poolValue = number(pool.totals[field], 0);
    if (poolValue <= 0) continue;
    // exp is multiplied by I608 once level 5 is reached, so the constant pool
    // alone is not an upper bound unless the multiplier is applied too.
    optimisticHeroGain[field] = field === "exp"
      ? poolValue * levelUp.maxExpMultiplier
      : poolValue;
  }
  // atk/def are unbounded-in-practice while level-ups remain, so declaring a
  // constant for them would be unsound. Omit rather than inflate.
  const omittedForLevelUp = [];
  if (levelUp.applicable) {
    for (const field of ["atk", "def"]) {
      if (Object.prototype.hasOwnProperty.call(optimisticHeroGain, field)) {
        delete optimisticHeroGain[field];
        omittedForLevelUp.push(field);
      }
    }
  }

  const declaredFields = Object.keys(goal.minHero || {});
  const coveredFields = Object.keys(optimisticHeroGain).sort();
  const uncoveredFields = declaredFields.filter((f) => !coveredFields.includes(f)).sort();

  const admissibleBounds = { optimisticHeroGain };
  if (graph.complete) {
    admissibleBounds.floorGraph = {
      complete: true,
      floorFly: false,
      edges: graph.adjacency,
    };
  }

  return {
    segmentId: segment.id,
    supported: true,
    admissibleBounds,
    provenance: {
      floors: pool.floors,
      floorGraph: {
        complete: graph.complete,
        edges: graph.edges,
        unresolvedGateways: graph.unresolved,
      },
      gainPool: pool.totals,
      itemSourceCount: pool.itemSources.length,
      enemySourceCount: pool.enemySources.length,
      nonConstantItems: pool.nonConstant,
      inventoryGrantingItems: pool.inventoryGrants,
      measurementErrors: pool.errors,
      addPointEnabled: pool.addPointEnabled,
      levelUp,
      omittedForLevelUp,
      expMultiplierApplied: levelUp.maxExpMultiplier,
    },
    coverage: {
      floorGraphComplete: graph.complete,
      declaredFields: declaredFields.sort(),
      coveredFields,
      uncoveredFields,
      evidenceCompleteForDeclaredGoal: graph.complete && uncoveredFields.length === 0,
    },
  };
}

module.exports = {
  STAT_FIELDS,
  UNSUPPORTED_GOAL_CLAUSES,
  buildFloorGraph,
  buildGainPool,
  buildSegmentAdmissibleBounds,
  measureItemGain,
  summarizeLevelUpRisk,
};
