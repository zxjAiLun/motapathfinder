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

const { selectCandidateSkyline, rankCandidatesByPreferredTags } = __testHooks;

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

  // --- Gate 6 (determinism): compare the FULL selected candidate IDs (the
  // fixture's shuffle does not change IDs, and comparing IDs rather than
  // hero JSON also catches inventory-only selection differences). ---
  const baselineIds = frontier.map((record) => record.id).sort();
  for (const seed of [1, 7, 42, 20260830]) {
    const shuffledFrontier = runSelection(shuffled(candidates, seed));
    const shuffledIds = shuffledFrontier.map((record) => record.id).sort();
    assert.deepStrictEqual(
      shuffledIds,
      baselineIds,
      `determinism gate: shuffled input (seed=${seed}) must select the identical candidate set`,
    );
  }

  // --- Gate 7 (live resource-diverse tag): the non-anchor diversity
  // selections (B/C/D) must carry the `resource-diverse` tag so that
  // failure-driven rollback ranking can actually prefer them. ---
  const byId = new Map(frontier.map((record) => [record.id, record]));
  for (const id of ["B", "C", "D"]) {
    const record = byId.get(id);
    assert.ok(
      record,
      `tag gate: candidate ${id} must be selected for the tag assertion`,
    );
    assert.ok(
      record.tags.includes("resource-diverse"),
      `tag gate: selected investment candidate ${id} must carry the live resource-diverse tag (got [${record.tags.join(",")}])`,
    );
  }

  // --- Gate 8 (rollback ranking liveness): rankCandidatesByPreferredTags
  // with the resource-diverse preferred tag must actually promote B/C/D
  // over untagged pure-stat fillers. ---
  const ranked = rankCandidatesByPreferredTags(frontier, ["resource-diverse"]);
  const rankedIds = ranked.map((record) => record.id);
  const firstFillerIndex = rankedIds.findIndex((id) => String(id).startsWith("filler-"));
  const lastInvestmentIndex = Math.max(
    rankedIds.indexOf("B"),
    rankedIds.indexOf("C"),
    rankedIds.indexOf("D"),
  );
  assert.ok(
    firstFillerIndex > lastInvestmentIndex,
    `ranking gate: resource-diverse preferred tag must rank investment candidates (B/C/D, last at ${lastInvestmentIndex}) ahead of pure-stat fillers (first at ${firstFillerIndex}); got [${rankedIds.join(",")}]`,
  );

  // --- Gate 9 (Pareto priority): with capacity tight, an unselected
  // nondominated candidate must never lose a non-anchor slot to a dominated
  // candidate. Constructed counterexample: P is dominated by nobody (unique
  // inventory dimension), Q is dominated by A on every dimension but has
  // higher novelty against the current selection than P. Q must NOT consume
  // a slot while P remains unselected. ---
  gateParetoPriority();

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

  // --- Gate 10 (complete-search-aware failure classification, P1-A) ---
  gateIncompleteFloorSearchClassification();

  console.log(JSON.stringify({
    schema: "motapathfinder.milestone-resource-diversity.v2",
    contractStatus: "passed",
    candidateLimit: CANDIDATE_LIMIT,
    inputCandidates: candidates.length,
    uniqueDpKeyCandidates: frontier.milestoneFrontierCandidateCount,
    selected: Array.from(selectedIds).sort(),
    anchorRetained: selectedIds.has("A"),
    inventoryDistinctRetained: selectedIds.has("B") && selectedIds.has("C"),
    equipmentDistinctRetained: selectedIds.has("D"),
    resourceDiverseTagged: frontier
      .filter((record) => record.tags.includes("resource-diverse"))
      .map((record) => record.id)
      .sort(),
    fillerCount,
    legacyDroppedInvestmentCandidate:
      !legacyIds.has("B") || !legacyIds.has("C") || !legacyIds.has("D"),
    determinism: "4/4 shuffled inputs select identical ID sets",
    rollbackRankingLiveness: true,
    paretoPriority: "enforced (see pareto gate)",
    incompleteFloorSearchClassification: "enforced (see classification gate)",
    noManualItemHints: true,
  }, null, 2));
}

function gateIncompleteFloorSearchClassification() {
  // P1-A contract: floor-progress-blocked (and its resource-diverse repair
  // direction) is ONLY legitimate after a genuinely complete search.
  //
  //   INCOMPLETE_FLOOR_SEARCH:
  //     searchComplete = false
  //     missing floorId
  //     goal floor allowed
  //     → MUST NOT floor-progress-blocked
  //     → MUST NOT emit resource-diverse preferred repair
  //
  // Also verifies the scope-violation split still works when the goal floor is
  // genuinely out of scope, and that a COMPLETE search DOES produce
  // floor-progress-blocked with the resource-diverse direction.
  const { classifySegmentFailure } = __testHooks;
  const segment = {
    id: "synthetic-floor-segment",
    label: "Synthetic floor segment",
    goal: { floorId: "F2" },
    actionPolicy: { allowedFloors: ["F1", "F2"], actionKinds: ["battle", "pickup", "changeFloor"] },
    dp: {},
  };
  const missingFloor = [{ field: "floorId", expected: "F2", actual: "F1" }];

  // 1. Incomplete search (time/expansion slice stop with a live frontier):
  //    must classify as floor-search-incomplete, never floor-progress-blocked,
  //    and must NOT carry the resource-diverse repair direction.
  const incompleteOutcome = {
    goalFound: false,
    frontierExhausted: false,
    budgetExhausted: true,
    searchComplete: false,
    outcomeClass: "goal-not-found-search-incomplete",
  };
  const incomplete = classifySegmentFailure(missingFloor, segment, [], incompleteOutcome);
  assert.ok(
    !incomplete.allFailureClasses.some((c) => c.failureClass === "floor-progress-blocked"),
    `classification gate: an INCOMPLETE search (searchComplete=false) must never be classified floor-progress-blocked (got ${incomplete.failureClass})`,
  );
  assert.ok(
    !incomplete.preferredCandidateTags.includes("resource-diverse"),
    `classification gate: an INCOMPLETE search must not emit the resource-diverse preferred repair direction (got [${incomplete.preferredCandidateTags.join(",")}])`,
  );
  assert.strictEqual(
    incomplete.failureClass,
    "floor-search-incomplete",
    `classification gate: an INCOMPLETE floor search must classify as floor-search-incomplete, got ${incomplete.failureClass}`,
  );

  // 2. Complete search with the goal floor in scope: floor-progress-blocked
  //    WITH the resource-diverse direction is the correct classification.
  const completeOutcome = {
    goalFound: false,
    frontierExhausted: true,
    budgetExhausted: false,
    searchComplete: true,
    outcomeClass: "goal-not-found-search-complete",
  };
  const complete = classifySegmentFailure(missingFloor, segment, [], completeOutcome);
  assert.strictEqual(
    complete.failureClass,
    "floor-progress-blocked",
    `classification gate: a COMPLETE search failing to reach an in-scope goal floor must classify as floor-progress-blocked, got ${complete.failureClass}`,
  );
  assert.ok(
    complete.preferredCandidateTags.includes("resource-diverse"),
    `classification gate: floor-progress-blocked must carry the live resource-diverse preferred tag (got [${complete.preferredCandidateTags.join(",")}])`,
  );

  // 3. True scope violation (goal floor outside allowedFloors): still
  //    floor-scope-mismatch regardless of completion.
  const outOfScopeSegment = {
    id: "synthetic-oos-segment",
    label: "Synthetic out-of-scope segment",
    goal: { floorId: "F9" },
    actionPolicy: { allowedFloors: ["F1", "F2"], actionKinds: ["battle", "pickup", "changeFloor"] },
    dp: {},
  };
  const outOfScopeMissing = [{ field: "floorId", expected: "F9", actual: "F1" }];
  const oos = classifySegmentFailure(outOfScopeMissing, outOfScopeSegment, [], completeOutcome);
  assert.strictEqual(
    oos.failureClass,
    "floor-scope-mismatch",
    `classification gate: a goal floor outside allowedFloors must classify as floor-scope-mismatch, got ${oos.failureClass}`,
  );

  // 4. Scope violation via forbidden floor-transit action kinds: when neither
  //    changeFloor nor floorFly is permitted, the goal floor is structurally
  //    unreachable — floor-scope-mismatch even though the floor is listed.
  const noTransitSegment = {
    id: "synthetic-no-transit-segment",
    label: "Synthetic no-transit segment",
    goal: { floorId: "F2" },
    actionPolicy: { allowedFloors: ["F1", "F2"], actionKinds: ["battle", "pickup"] },
    dp: {},
  };
  const noTransit = classifySegmentFailure(missingFloor, noTransitSegment, [], completeOutcome);
  assert.strictEqual(
    noTransit.failureClass,
    "floor-scope-mismatch",
    `classification gate: forbidden floor-transit action kinds must classify as floor-scope-mismatch, got ${noTransit.failureClass}`,
  );

  // 5. Unknown outcome (legacy callers without searchOutcome): conservative —
  //    must NOT claim floor-progress-blocked (fail-closed like P1-A intends).
  const legacy = classifySegmentFailure(missingFloor, segment, [], null);
  assert.ok(
    !legacy.allFailureClasses.some((c) => c.failureClass === "floor-progress-blocked"),
    `classification gate: a null searchOutcome (legacy caller) must not be classified floor-progress-blocked (got ${legacy.failureClass})`,
  );
}

function gateParetoPriority() {
  // Capacity 4: 1 anchor seat (A, hp/atk/def winner) + 3 free slots.
  //
  //   A  : anchor, no inventory.
  //   P  : nondominated (unique genericKeyP),        novelty 1.
  //   P2 : nondominated (unique genericKeyP2),       novelty 1.
  //   R  : nondominated, strictly dominates Q.
  //   Q  : DOMINATED by R (same genericKeyQ item, strictly lower stats).
  //
  // The nondominated set is {A, P, P2, R} (4 candidates) and capacity is 4:
  // every nondominated candidate must be placed (P/P2 via Pareto-first
  // novelty, R via novelty or the leftover pass) BEFORE the dominated Q can
  // consume any non-anchor slot. Q must be capacity-dropped.
  const limit = 4;
  const segment = {
    id: "pareto-gate",
    label: "Pareto priority gate",
    goal: { floorId: "F1" },
    actionPolicy: {},
    dp: { keyMode: "location", goalSkylineLimit: limit },
  };
  const candidates = [
    { id: "A", state: syntheticState({ hp: 12000, atk: 120, def: 100, exp: 500 }) },
    { id: "P", state: syntheticState({ hp: 9000, atk: 100, def: 80, exp: 400, inventory: { genericKeyP: 1 } }) },
    { id: "P2", state: syntheticState({ hp: 8900, atk: 99, def: 79, exp: 390, inventory: { genericKeyP2: 1 } }) },
    { id: "R", state: syntheticState({ hp: 9500, atk: 101, def: 81, exp: 420, inventory: { genericKeyQ: 5 } }) },
    { id: "Q", state: syntheticState({ hp: 9400, atk: 100, def: 80, exp: 410, inventory: { genericKeyQ: 5 } }) },
  ];
  const frontier = selectCandidateSkyline(syntheticSimulator(), candidates, segment, {
    candidateLimit: limit,
    preserveSkylineRoles: true,
    milestoneFrontierResourceDiversity: true,
  });
  const selected = new Set(frontier.map((record) => record.id));
  assert.strictEqual(
    frontier.length,
    limit,
    `pareto gate: frontier must hold exactly ${limit} candidates, got ${frontier.length}`,
  );
  assert.ok(selected.has("A"), "pareto gate: highest-hp anchor A must be retained");
  // Hard invariant: while nondominated candidates exist, no dominated candidate
  // may consume a non-anchor slot. Here ALL four nondominated candidates
  // (A/P/P2/R) must be placed and the dominated Q must be the drop.
  for (const id of ["P", "P2", "R"]) {
    assert.ok(
      selected.has(id),
      `pareto gate: nondominated candidate ${id} must be selected (got [${Array.from(selected).join(",")}])`,
    );
  }
  assert.ok(
    !selected.has("Q"),
    `pareto gate: dominated candidate Q must NOT be selected while nondominated candidates remain unselected (got [${Array.from(selected).join(",")}])`,
  );
  // Pareto survivors must carry the live tags.
  for (const id of ["P", "P2", "R"]) {
    const record = frontier.find((entry) => entry.id === id);
    assert.ok(
      record.tags.includes("resource-diverse"),
      `pareto gate: nondominated selection ${id} must carry the resource-diverse tag (got [${record.tags.join(",")}])`,
    );
    assert.ok(
      record.tags.includes("resource-pareto"),
      `pareto gate: nondominated selection ${id} must carry the resource-pareto diagnostic tag (got [${record.tags.join(",")}])`,
    );
  }

  // Tighter capacity (3): only A + two slots remain. The two slots must go to
  // nondominated candidates — the dominated Q must still lose to BOTH the
  // novelty winner (P) and the zero-novelty nondominated leftover pass.
  const tightLimit = 3;
  const tightSegment = {
    id: "pareto-gate-tight",
    label: "Pareto priority gate (tight)",
    goal: { floorId: "F1" },
    actionPolicy: {},
    dp: { keyMode: "location", goalSkylineLimit: tightLimit },
  };
  const tightFrontier = selectCandidateSkyline(
    syntheticSimulator(),
    candidates,
    tightSegment,
    {
      candidateLimit: tightLimit,
      preserveSkylineRoles: true,
      milestoneFrontierResourceDiversity: true,
    },
  );
  const tightSelected = new Set(tightFrontier.map((record) => record.id));
  assert.ok(tightSelected.has("A"), "pareto gate (tight): anchor A must be retained");
  assert.ok(
    tightSelected.has("P"),
    `pareto gate (tight): novelty-winning nondominated P must be selected (got [${Array.from(tightSelected).join(",")}])`,
  );
  assert.ok(
    !tightSelected.has("Q"),
    `pareto gate (tight): dominated Q must not take the final slot over a nondominated leftover (got [${Array.from(tightSelected).join(",")}])`,
  );
  const finalSlot = Array.from(tightSelected).find((id) => !["A", "P"].includes(id));
  assert.ok(
    finalSlot === "P2" || finalSlot === "R",
    `pareto gate (tight): the final slot must go to a nondominated candidate (P2 or R), got ${finalSlot}`,
  );
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  }
}

module.exports = { main };
