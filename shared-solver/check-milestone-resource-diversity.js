"use strict";

/** TEST GRADE: local-regression */

/**
 * PR-5.24b Iteration 5 – Milestone Frontier Resource-Diversity Gate
 *
 * Synthetic, tower-free contract over selectCandidateSkyline's
 * resource-diversity selection (adaptive repair frontier):
 *
 *  1. ANCHOR RETENTION: the highest-hp and best-combat anchors are always
 *     retained, together with the atk/def/exp resource anchors.
 *  2. INVENTORY-DISTINCT RETENTION: a candidate that is NOT a role winner
 *     (slightly lower HP/combat) but holds a generic inventory dimension no
 *     other candidate holds must be retained instead of being capacity-dropped.
 *  3. EQUIPMENT-DISTINCT RETENTION: same for a distinct equipment signature.
 *  4. CAPACITY UNCHANGED: the candidate limit is exactly the configured limit
 *     (diversity must never widen the enumeration).
 *  5. NO MANUAL ITEM HINTS: the fixture uses synthetic generic item ids; the
 *     algorithm must not know any tower-specific item semantics.
 *  6. DETERMINISM: shuffling the input order must not change the selected
 *     StateKey set.
 */

const assert = require("node:assert");
const { __testHooks } = require("./lib/segment-dp");

const { selectCandidateSkyline } = __testHooks;

// Minimal simulator stub: buildDpStateKey with keyMode "location" only reads
// state fields and simulator.solverModel (undefined -> default model).
function syntheticSimulator() {
  return {
    project: { floorsById: {}, mapTilesByNumber: {} },
    solverModel: undefined,
  };
}

function syntheticState(overrides) {
  const config = overrides || {};
  return {
    floorId: config.floorId || "F1",
    hero: {
      hp: config.hp != null ? config.hp : 1000,
      atk: config.atk != null ? config.atk : 50,
      def: config.def != null ? config.def : 40,
      mdef: config.mdef != null ? config.mdef : 10,
      lv: config.lv != null ? config.lv : 1,
      exp: config.exp != null ? config.exp : 0,
      money: config.money != null ? config.money : 0,
      loc: { x: 1, y: 1 },
      equipment: Array.isArray(config.equipment)
        ? config.equipment.slice()
        : [],
    },
    inventory: Object.assign({}, config.inventory || {}),
    flags: {},
    visitedFloors: {},
    floorStates: {},
    route: config.route || [],
  };
}

const CANDIDATE_LIMIT = 8;

function buildFixtureCandidates() {
  // All candidates share the same floor so the DP key differs only by the
  // resource dimensions under test (hero stats / inventory / equipment).
  // The fillers deliberately have HIGHER HP than the investment candidates
  // B/C/D/E: the legacy hp-first weighted ordering capacity-drops B/C/D/E in
  // favor of pure stat fillers – exactly the milestone-boundary regression
  // this iteration repairs.
  return [
    // A: the high-HP / high-combat anchor with an empty inventory.
    {
      id: "A",
      state: syntheticState({ hp: 12000, atk: 120, def: 100, exp: 400 }),
    },
    // F..M: pure stat fillers between A and the investment candidates.
    ...Array.from({ length: 8 }, (_, index) => ({
      id: `filler-${index}`,
      state: syntheticState({
        hp: 11900 - index * 100,
        atk: 119 - index,
        def: 99 - index,
        exp: 399 - index,
      }),
    })),
    // B: lower HP/combat but holds a generic inventory dimension (item
    // counts) that no other candidate holds.
    {
      id: "B",
      state: syntheticState({
        hp: 11000,
        atk: 118,
        def: 98,
        exp: 380,
        inventory: { genericKeyA: 2, genericGemA: 1 },
      }),
    },
    // C: lower HP/combat but a different generic inventory mix.
    {
      id: "C",
      state: syntheticState({
        hp: 10900,
        atk: 117,
        def: 97,
        exp: 375,
        inventory: { genericKeyB: 3 },
      }),
    },
    // D: lower stats but a distinct equipment signature.
    {
      id: "D",
      state: syntheticState({
        hp: 10500,
        atk: 116,
        def: 96,
        exp: 370,
        equipment: ["genericSword", "genericShield"],
      }),
    },
    // E: money/lv investment variant.
    {
      id: "E",
      state: syntheticState({
        hp: 10400,
        atk: 115,
        def: 95,
        exp: 360,
        money: 500,
        lv: 3,
      }),
    },
  ];
}

const SEGMENT = {
  id: "synthetic-segment",
  label: "Synthetic segment",
  goal: { floorId: "F1" },
  actionPolicy: {},
  dp: { keyMode: "location", goalSkylineLimit: CANDIDATE_LIMIT },
};

function runSelection(candidates, options) {
  return selectCandidateSkyline(
    syntheticSimulator(),
    candidates,
    SEGMENT,
    Object.assign(
      {
        candidateLimit: CANDIDATE_LIMIT,
        preserveSkylineRoles: true,
        milestoneFrontierResourceDiversity: true,
      },
      options || {},
    ),
  );
}

function shuffled(list, seed) {
  // Deterministic Fisher-Yates with a small LCG.
  const arr = list.slice();
  let state = seed >>> 0;
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function main() {
  const candidates = buildFixtureCandidates();

  // --- Gate 4 (capacity) ---
  const frontier = runSelection(candidates);
  assert.strictEqual(
    frontier.length,
    CANDIDATE_LIMIT,
    `capacity gate: frontier must hold exactly ${CANDIDATE_LIMIT} candidates, got ${frontier.length}`,
  );
  assert.strictEqual(
    frontier.milestoneFrontierCandidateCount,
    candidates.length,
    "capacity gate: unique dp-key candidate count must be reported",
  );

  const selectedIds = new Set(frontier.map((record) => record.id));

  // --- Gate 1 (anchors) ---
  assert.ok(selectedIds.has("A"), "anchor gate: highest-hp/best-combat anchor A must be retained");
  const hpWinner = frontier.reduce((best, record) =>
    record.hero.hp > best.hero.hp ? record : best);
  assert.strictEqual(hpWinner.id, "A", "anchor gate: A must remain the highest-hp candidate");
  const scoreWinner = frontier.reduce((best, record) =>
    record.score > best.score ? record : best);
  assert.strictEqual(scoreWinner.id, "A", "anchor gate: A must remain the best-combat candidate");

  // --- Gate 2 (inventory-distinct) ---
  assert.ok(
    selectedIds.has("B"),
    "inventory gate: generic inventory-distinct candidate B must be retained (not capacity-dropped)",
  );
  assert.ok(
    selectedIds.has("C"),
    "inventory gate: generic inventory-distinct candidate C must be retained (not capacity-dropped)",
  );

  // --- Gate 3 (equipment-distinct) ---
  assert.ok(
    selectedIds.has("D"),
    "equipment gate: generic equipment-distinct candidate D must be retained (not capacity-dropped)",
  );

  // Money/lv investment variant should survive through novelty or Pareto
  // protection; pure stat fillers must be the ones dropped.
  const fillerCount = Array.from(selectedIds).filter((id) =>
    String(id).startsWith("filler-")).length;
  assert.ok(
    fillerCount <= 3,
    `diversity gate: at most 3 pure stat fillers should occupy the frontier (got ${fillerCount}); resource-investment variants take priority`,
  );

  // --- Legacy comparison (documents the regression being fixed) ---
  const legacyFrontier = runSelection(candidates, {
    milestoneFrontierResourceDiversity: false,
  });
  const legacyIds = new Set(legacyFrontier.map((record) => record.id));
  assert.ok(
    !legacyIds.has("B") || !legacyIds.has("C") || !legacyIds.has("D"),
    "legacy gate: the legacy weighted ordering must demonstrate the capacity-drop of at least one resource-investment candidate on this fixture (otherwise the fixture proves nothing)",
  );

  // --- Gate 6 (determinism) ---
  const baselineKeys = frontier
    .map((record) => JSON.stringify(record.hero) + "|" + JSON.stringify(record.hero.equipment))
    .sort();
  for (const seed of [1, 7, 42, 20260830]) {
    const shuffledFrontier = runSelection(shuffled(candidates, seed));
    const shuffledKeys = shuffledFrontier
      .map((record) => JSON.stringify(record.hero) + "|" + JSON.stringify(record.hero.equipment))
      .sort();
    assert.deepStrictEqual(
      shuffledKeys,
      baselineKeys,
      `determinism gate: shuffled input (seed=${seed}) must select the identical candidate set`,
    );
  }

  // --- Diversity disabled must not crash and keeps legacy semantics ---
  const offFrontier = runSelection(candidates, {
    milestoneFrontierResourceDiversity: false,
    preserveSkylineRoles: false,
  });
  assert.ok(
    offFrontier.length > 0 && offFrontier.length <= CANDIDATE_LIMIT,
    "legacy gate: selection with diversity disabled must stay within capacity",
  );

  // --- Resource signature sanity (generic only) ---
  const frontierTags = frontier.flatMap((record) => record.tags);
  assert.ok(
    frontierTags.includes("highest-hp"),
    "tag gate: highest-hp role tag must still be assigned",
  );

  console.log(JSON.stringify({
    schema: "motapathfinder.milestone-resource-diversity.v1",
    contractStatus: "passed",
    candidateLimit: CANDIDATE_LIMIT,
    inputCandidates: candidates.length,
    uniqueDpKeyCandidates: frontier.milestoneFrontierCandidateCount,
    selected: Array.from(selectedIds).sort(),
    anchorRetained: selectedIds.has("A"),
    inventoryDistinctRetained: selectedIds.has("B") && selectedIds.has("C"),
    equipmentDistinctRetained: selectedIds.has("D"),
    fillerCount,
    legacyDroppedInvestmentCandidate:
      !legacyIds.has("B") || !legacyIds.has("C") || !legacyIds.has("D"),
    determinism: "4/4 shuffled inputs select identical sets",
    noManualItemHints: true,
  }, null, 2));
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  }
}

module.exports = { main };
