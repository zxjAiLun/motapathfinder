"use strict";

/** TEST GRADE: local-regression */

/**
 * PR-5.24b Iteration 6 — Failure-Conditioned Adaptive Investment Gate
 *
 * Synthetic A/B contract over rankCandidatesByFailureIntent():
 *
 * Positive (floor-progress-blocked, a trusted COMPLETE failure):
 *   A = currently stronger HP/combat, NO failure-relevant investment
 *       opportunity nearby
 *   B = currently weaker, but a generic pickup/equip/path opportunity exists
 *       near it that improves the resources the failure asked for
 *   → INTENT_ACTIVATED = TRUE
 *   → B_RANKS_ABOVE_A = TRUE
 *   → NO_ITEM_ID_HINT / NO_MONSTER_HINT / NO_ROUTE_HINT (generic ids only)
 *
 * Negative (floor-search-incomplete — an INCOMPLETE failure):
 *   → INTENT_ACTIVATED = FALSE
 *   → ORDER_IDENTICAL_TO_LEGACY = TRUE
 *
 * Determinism: shuffled inputs must produce identical ranked ID sequences.
 */

const assert = require("node:assert");
const { __testHooks } = require("./lib/segment-dp");

const { rankCandidatesByFailureIntent, rankCandidatesByPreferredTags } = __testHooks;

// ---------------------------------------------------------------------------
// Minimal synthetic simulator: S1 floor; candidates stand at 0,0; the world
// contains ONLY generic tiles. B's neighborhood has a generic attack crystal
// (an atk-improving pickup) and a generic defender monster; A's neighborhood
// is empty. All ids are generic — no OnlyUp semantics anywhere.
// ---------------------------------------------------------------------------
function makeProject() {
  return {
    floorOrder: ["S1"],
    floorsById: {
      S1: {
        floorId: "S1",
        width: 3,
        height: 1,
        map: [[0, 0, 0]],
        changeFloor: {},
      },
    },
    mapTilesByNumber: {
      "0": { id: "empty", cls: "terrains", canPass: true },
      "2": { id: "genericAttackCrystal", cls: "items", canPass: true },
      "3": { id: "genericDefender", cls: "enemy48", canPass: false },
    },
  };
}

function makeSyntheticSimulator() {
  // The "world" is candidate-relative: whether an opportunity exists near a
  // candidate is encoded in that candidate's OWN floorStates (tiles already
  // consumed by its history vs still present). The simulator itself is
  // generic and identical for all candidates.
  const project = makeProject();
  project.floorsById.S1.map[0][1] = 2; // genericAttackCrystal at 1,0
  project.floorsById.S1.map[0][2] = 3; // genericDefender at 2,0
  return {
    project,
    solverModel: undefined,
    enumeratePrimitiveActions(state) {
      const actions = [];
      const hero = state.hero || {};
      const floorState = ((state.floorStates || {}).S1 || {}).removed || {};
      // Generic pickup: walk right and pick the attack crystal (if still there).
      if (state.floorId === "S1" && !floorState["1,0"] && hero.loc.x === 0) {
        actions.push({
          kind: "pickup",
          summary: "pickup:genericAttackCrystal@S1:1,0",
          floorId: "S1",
          target: { x: 1, y: 0 },
        });
      }
      // Generic battle: walk right and fight the defender (if still there).
      if (state.floorId === "S1" && !floorState["2,0"] && hero.loc.x <= 1) {
        actions.push({
          kind: "battle",
          summary: "battle:genericDefender@S1:2,0",
          floorId: "S1",
          target: { x: 2, y: 0 },
          estimate: { damage: 10, turn: 3 },
        });
      }
      return { actions };
    },
    enumerateInteractPickupActions() {
      return [];
    },
    enumerateFloorFlyActions() {
      return [];
    },
    applyAction(state, action) {
      const next = JSON.parse(JSON.stringify(state));
      if (action.kind === "pickup" && action.summary.includes("genericAttackCrystal")) {
        next.hero.atk += 20;
        next.hero.loc = { x: 1, y: 0 };
        next.floorStates = next.floorStates || {};
        next.floorStates.S1 = next.floorStates.S1 || { removed: {} };
        next.floorStates.S1.removed["1,0"] = true;
      } else if (action.kind === "battle" && action.summary.includes("genericDefender")) {
        next.hero.hp -= 10;
        next.hero.def += 15;
        next.hero.loc = { x: 2, y: 0 };
        next.floorStates = next.floorStates || {};
        next.floorStates.S1 = next.floorStates.S1 || { removed: {} };
        next.floorStates.S1.removed["2,0"] = true;
      } else {
        return null;
      }
      return next;
    },
    buildReachableRegionSignature(state) {
      return { regionKey: state.floorId, reachableEndpointsKey: `${state.floorId}:0,0` };
    },
  };
}

function makeState(overrides) {
  const config = overrides || {};
  return {
    floorId: "S1",
    hero: {
      loc: { x: 0, y: 0 },
      hp: config.hp != null ? config.hp : 1000,
      atk: config.atk != null ? config.atk : 50,
      def: config.def != null ? config.def : 40,
      mdef: config.mdef != null ? config.mdef : 10,
      lv: 1,
      exp: 0,
      money: 0,
      equipment: [],
    },
    inventory: {},
    flags: {},
    visitedFloors: {},
    floorStates: config.floorStates || {},
    route: config.route || [],
  };
}

const COMPLETE_FAILURE = {
  segmentId: "synthetic-segment",
  failureClass: "floor-progress-blocked",
  failureReason: "complete search could not progress to the target floor",
  missingGoalFields: [{ field: "floorId", expected: "S9", actual: "S1" }],
  preferredCandidateTags: ["highest-hp", "best-combat"],
};

const INCOMPLETE_FAILURE = {
  segmentId: "synthetic-segment",
  failureClass: "floor-search-incomplete",
  failureReason: "search stopped before completion",
  missingGoalFields: [{ field: "floorId", expected: "S9", actual: "S1" }],
  preferredCandidateTags: ["highest-hp", "best-combat"],
};

function shuffled(list, seed) {
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
  // ---- Positive gate: floor-progress-blocked (trusted complete failure) ----
  // Candidate-relative worlds: B's history left the generic attack crystal
  // and defender UNCONSUMED near its position (failure-relevant investment
  // opportunities that improve atk/def — exactly what a floor-progress-blocked
  // failure asks for). A's history already consumed both (no nearby
  // opportunities), but A currently has higher HP/combat.
  const opportunitySim = makeSyntheticSimulator();
  const candidates = [
    {
      id: "A",
      state: makeState({
        hp: 12000, atk: 120, def: 100,
        floorStates: { S1: { removed: { "1,0": true, "2,0": true }, replaced: {} } },
      }),
      hero: { hp: 12000, atk: 120, def: 100, mdef: 10, lv: 1, exp: 0, money: 0, equipment: [] },
      tags: ["highest-hp"],
      score: 100,
      route: [],
    },
    {
      id: "B",
      state: makeState({
        hp: 9000, atk: 100, def: 80,
        floorStates: { S1: { removed: {}, replaced: {} } },
      }),
      hero: { hp: 9000, atk: 100, def: 80, mdef: 10, lv: 1, exp: 0, money: 0, equipment: [] },
      tags: [],
      score: 80,
      route: [],
    },
  ];

  const result = rankCandidatesByFailureIntent(
    opportunitySim,
    candidates,
    COMPLETE_FAILURE,
    COMPLETE_FAILURE.preferredCandidateTags,
    {},
  );
  assert.strictEqual(
    result.activated,
    true,
    `positive gate: floor-progress-blocked must activate the failure-intent ranking (telemetry: ${JSON.stringify(result.telemetry)})`,
  );
  assert.ok(
    result.telemetry.candidatesWithEvidence >= 1,
    "positive gate: at least one candidate must carry failure-relevant evidence",
  );
  const rankedIds = result.ranked.map((candidate) => candidate.id);
  assert.strictEqual(rankedIds[0], "B", `positive gate: B must rank above A (got [${rankedIds.join(",")}])`);

  // No OnlyUp hints anywhere in the mechanism: the gate itself only knows
  // generic ids; assert the synthetic world ids are generic.
  const serialized = JSON.stringify(result.telemetry);
  assert.ok(!/I893|redWizard|yellowKey|greenKing|MT[0-9]/.test(serialized + JSON.stringify(candidates.map((c) => c.id))),
    "no-hint gate: no OnlyUp item/monster/floor ids may appear in the ranking evidence");

  // ---- Determinism: shuffled inputs → identical ranked sequences ----
  const baselineOrder = result.ranked.map((c) => c.id).join(",");
  for (const seed of [1, 7, 42, 20260831]) {
    const shuffledResult = rankCandidatesByFailureIntent(
      opportunitySim,
      shuffled(candidates, seed),
      COMPLETE_FAILURE,
      COMPLETE_FAILURE.preferredCandidateTags,
      {},
    );
    assert.strictEqual(
      shuffledResult.ranked.map((c) => c.id).join(","),
      baselineOrder,
      `determinism gate: shuffled input (seed=${seed}) must produce the identical ranking`,
    );
  }

  // ---- Negative gate: floor-search-incomplete must NOT activate ----
  const legacyOrder = rankCandidatesByPreferredTags(
    candidates,
    INCOMPLETE_FAILURE.preferredCandidateTags,
  ).map((c) => c.id).join(",");
  const negative = rankCandidatesByFailureIntent(
    opportunitySim,
    candidates,
    INCOMPLETE_FAILURE,
    INCOMPLETE_FAILURE.preferredCandidateTags,
    {},
  );
  assert.strictEqual(
    negative.activated,
    false,
    `negative gate: floor-search-incomplete must never activate investment ranking (got ${JSON.stringify(negative.telemetry)})`,
  );
  assert.strictEqual(
    negative.ranked.map((c) => c.id).join(","),
    legacyOrder,
    "negative gate: with the ranking inactive the order must be identical to legacy",
  );

  // ---- No-evidence world: no usable evidence → legacy order ----
  const emptyCandidates = [
    {
      id: "A",
      state: makeState({
        hp: 12000, atk: 120, def: 100,
        floorStates: { S1: { removed: { "1,0": true, "2,0": true }, replaced: {} } },
      }),
      hero: { hp: 12000, atk: 120, def: 100, mdef: 10, lv: 1, exp: 0, money: 0, equipment: [] },
      tags: ["highest-hp"],
      score: 100,
      route: [],
    },
    {
      id: "B",
      state: makeState({
        hp: 9000, atk: 100, def: 80,
        floorStates: { S1: { removed: { "1,0": true, "2,0": true }, replaced: {} } },
      }),
      hero: { hp: 9000, atk: 100, def: 80, mdef: 10, lv: 1, exp: 0, money: 0, equipment: [] },
      tags: [],
      score: 80,
      route: [],
    },
  ];
  const emptySim = makeSyntheticSimulator();
  const emptyLegacy = rankCandidatesByPreferredTags(
    emptyCandidates,
    COMPLETE_FAILURE.preferredCandidateTags,
  ).map((c) => c.id).join(",");
  const emptyResult = rankCandidatesByFailureIntent(
    emptySim,
    emptyCandidates,
    COMPLETE_FAILURE,
    COMPLETE_FAILURE.preferredCandidateTags,
    {},
  );
  assert.strictEqual(
    emptyResult.activated,
    false,
    "no-evidence gate: a world with no failure-relevant opportunities must not activate",
  );
  assert.strictEqual(
    emptyResult.ranked.map((c) => c.id).join(","),
    emptyLegacy,
    "no-evidence gate: without evidence the order must equal the legacy order",
  );

  console.log(JSON.stringify({
    schema: "motapathfinder.failure-conditioned-investment.v1",
    contractStatus: "passed",
    positive: {
      intentActivated: true,
      rankedOrder: rankedIds,
      bRanksAboveA: rankedIds[0] === "B",
      telemetry: result.telemetry,
    },
    negative: {
      incompleteFailureActivated: false,
      orderIdenticalToLegacy: true,
    },
    noEvidence: {
      activated: false,
      orderIdenticalToLegacy: true,
    },
    determinism: "4/4 shuffled inputs rank identically",
    noItemOrMonsterOrRouteHints: true,
  }, null, 2));
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  }
}

module.exports = { main };
