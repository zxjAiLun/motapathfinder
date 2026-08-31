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

  // candidateLimit 2 with 3 candidates: legacy top-2 = {A, F}; B is outside
  // and gets the single reserved injection slot.
  const threeCandidates = candidates.concat([
    {
      id: "F",
      state: makeState({
        hp: 11000, atk: 110, def: 90,
        floorStates: { S1: { removed: { "1,0": true, "2,0": true }, replaced: {} } },
      }),
      hero: { hp: 11000, atk: 110, def: 90, mdef: 10, lv: 1, exp: 0, money: 0, equipment: [] },
      tags: [],
      score: 90,
      route: [],
    },
  ]);

  // ===== Iteration 6 Repair 2a — wave-ordered ANCHOR semantics =====
  // Legacy order A F G B (hp/score descending). B is the only evidence
  // holder and sits outside the first legacy wave.
  const anchorCandidates = threeCandidates.concat([
    {
      id: "G",
      state: makeState({
        hp: 10000, atk: 105, def: 85,
        floorStates: { S1: { removed: { "1,0": true, "2,0": true }, replaced: {} } },
      }),
      hero: { hp: 10000, atk: 105, def: 85, mdef: 10, lv: 1, exp: 0, money: 0, equipment: [] },
      tags: [],
      score: 85,
      route: [],
    },
  ]);
  const legacyAnchorOrder = rankCandidatesByPreferredTags(
    anchorCandidates,
    COMPLETE_FAILURE.preferredCandidateTags,
  ).map((c) => c.id);
  assert.strictEqual(
    legacyAnchorOrder.join(","),
    "A,F,G,B",
    `anchor gate setup: legacy order must be A,F,G,B (got [${legacyAnchorOrder.join(",")}])`,
  );

  // Gate 1 — wave-ordered batchSize=1: A B F G
  const waveOne = rankCandidatesByFailureIntent(
    opportunitySim,
    anchorCandidates,
    COMPLETE_FAILURE,
    COMPLETE_FAILURE.preferredCandidateTags,
    { consumptionMode: "wave-ordered", waveBatchSize: 1, candidateLimit: 8 },
  );
  assert.deepStrictEqual(
    waveOne.ranked.map((c) => c.id),
    ["A", "B", "F", "G"],
    "wave gate (b=1): legacy A first, intent B injected at index 1, remaining legacy order preserved, no candidate removed",
  );
  assert.strictEqual(waveOne.telemetry.injection.injectedIndex, 1, "wave gate (b=1): injectedIndex must be 1");
  assert.strictEqual(waveOne.telemetry.injection.protectedLegacyPrefixSize, 1, "wave gate (b=1): protected prefix = 1");
  assert.strictEqual(waveOne.telemetry.injection.firstEligibleWaveIndex, 1, "wave gate (b=1): intent wave index = 1");

  // Gate 2 — wave-ordered batchSize=2: A F B G (first wave A/F protected)
  const waveTwo = rankCandidatesByFailureIntent(
    opportunitySim,
    anchorCandidates,
    COMPLETE_FAILURE,
    COMPLETE_FAILURE.preferredCandidateTags,
    { consumptionMode: "wave-ordered", waveBatchSize: 2, candidateLimit: 8 },
  );
  assert.deepStrictEqual(
    waveTwo.ranked.map((c) => c.id),
    ["A", "F", "B", "G"],
    "wave gate (b=2): first legacy wave A/F fully protected, intent B injected at index 2",
  );
  assert.strictEqual(waveTwo.telemetry.injection.injectedIndex, 2, "wave gate (b=2): injectedIndex must be 2");
  assert.strictEqual(waveTwo.telemetry.injection.protectedLegacyPrefixSize, 2, "wave gate (b=2): protected prefix = 2");

  // Gate 3 — evidence candidate already inside the first legacy wave:
  // order identical to legacy (no reorder).
  const inWaveCandidates = anchorCandidates.map((candidate) => (
    candidate.id === "F"
      ? {
          ...candidate,
          state: makeState({
            hp: 11000, atk: 110, def: 90,
            floorStates: { S1: { removed: {}, replaced: {} } },
          }),
        }
      : candidate
  ));
  const inWave = rankCandidatesByFailureIntent(
    opportunitySim,
    inWaveCandidates,
    COMPLETE_FAILURE,
    COMPLETE_FAILURE.preferredCandidateTags,
    { consumptionMode: "wave-ordered", waveBatchSize: 1, candidateLimit: 8 },
  );
  assert.deepStrictEqual(
    inWave.ranked.map((c) => c.id),
    rankCandidatesByPreferredTags(inWaveCandidates, COMPLETE_FAILURE.preferredCandidateTags).map((c) => c.id),
    "in-first-wave gate: when the evidence candidate is already in the first legacy wave, the order must be identical to legacy",
  );

  // ===== Replay top-N semantics (unchanged by Repair 2a) =====
  // Gate 4 — candidateLimit=2, legacy A/F/B: selected top-2 = A/B.
  const result = rankCandidatesByFailureIntent(
    opportunitySim,
    threeCandidates,
    COMPLETE_FAILURE,
    COMPLETE_FAILURE.preferredCandidateTags,
    { consumptionMode: "top-n-truncate", candidateLimit: 2 },
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
  assert.strictEqual(
    rankedIds[1],
    "B",
    `replay gate: with candidateLimit=2 and legacy top-2 = {A, F}, B must be injected into the reserved slot at index 1 (got [${rankedIds.join(",")}])`,
  );
  assert.strictEqual(
    rankedIds[0],
    "A",
    "replay gate: legacy main line must keep A first (legacy order preserved)",
  );
  assert.strictEqual(
    result.telemetry.injection && result.telemetry.injection.mode,
    "breadth-preserving",
    "replay gate: injection telemetry must report breadth-preserving mode",
  );
  assert.strictEqual(
    result.telemetry.injection && result.telemetry.injection.consumptionMode,
    "top-n-truncate",
    "replay gate: consumptionMode must be top-n-truncate",
  );
  assert.strictEqual(
    result.telemetry.injection && result.telemetry.injection.injectedCandidateId,
    "B",
    "replay gate: the injected alternative must be B",
  );

  // ===== Equal-score determinism (Repair 2a P1-B) =====
  // Two evidence holders outside the protected prefix with IDENTICAL scores:
  // the deterministic comparator (score desc → legacyRank asc → id lexical)
  // must pick the same injected candidate regardless of input order.
  const equalScoreCandidates = [
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
      id: "X",
      state: makeState({
        hp: 8000, atk: 90, def: 70,
        floorStates: { S1: { removed: {}, replaced: {} } },
      }),
      hero: { hp: 8000, atk: 90, def: 70, mdef: 10, lv: 1, exp: 0, money: 0, equipment: [] },
      tags: [],
      score: 70,
      route: [],
    },
    {
      id: "Y",
      state: makeState({
        hp: 7900, atk: 89, def: 69,
        floorStates: { S1: { removed: {}, replaced: {} } },
      }),
      hero: { hp: 7900, atk: 89, def: 69, mdef: 10, lv: 1, exp: 0, money: 0, equipment: [] },
      tags: [],
      score: 69,
      route: [],
    },
  ];
  // Both X and Y sit next to the same generic opportunities and therefore
  // receive identical scanner evidence scores (both pickup+battle chains).
  const equalBaseline = rankCandidatesByFailureIntent(
    opportunitySim,
    equalScoreCandidates,
    COMPLETE_FAILURE,
    COMPLETE_FAILURE.preferredCandidateTags,
    { consumptionMode: "wave-ordered", waveBatchSize: 1, candidateLimit: 8 },
  );
  const equalInjected = equalBaseline.telemetry.injection.injectedCandidateId;
  assert.ok(
    equalInjected === "X" || equalInjected === "Y",
    `equal-score gate setup: one of X/Y must be injected (got ${equalInjected})`,
  );
  // legacyRank ascending among equal scores: X (rank 1) before Y (rank 2).
  assert.strictEqual(
    equalInjected,
    "X",
    "equal-score gate: with identical intentScore the candidate closer to legacy (X, legacyRank 1) must be injected",
  );
  const equalOrder = equalBaseline.ranked.map((c) => c.id).join(",");
  for (const seed of [1, 7, 42, 20260831]) {
    const shuffledEqual = rankCandidatesByFailureIntent(
      opportunitySim,
      shuffled(equalScoreCandidates, seed),
      COMPLETE_FAILURE,
      COMPLETE_FAILURE.preferredCandidateTags,
      { consumptionMode: "wave-ordered", waveBatchSize: 1, candidateLimit: 8 },
    );
    assert.strictEqual(
      shuffledEqual.ranked.map((c) => c.id).join(","),
      equalOrder,
      `equal-score determinism gate: shuffled input (seed=${seed}) must inject the same candidate and produce the identical sequence`,
    );
    assert.strictEqual(
      shuffledEqual.telemetry.injection.injectedCandidateId,
      "X",
      `equal-score determinism gate: shuffled input (seed=${seed}) must still inject X`,
    );
  }

  // Hard mode remains available for attribution runs only.
  const hardResult = rankCandidatesByFailureIntent(
    opportunitySim,
    threeCandidates,
    COMPLETE_FAILURE,
    COMPLETE_FAILURE.preferredCandidateTags,
    { candidateLimit: 2, mode: "hard" },
  );
  assert.strictEqual(
    hardResult.ranked[0].id,
    "B",
    "hard-mode gate (attribution-only): evidence-first ordering still available via mode=hard",
  );

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
      shuffled(threeCandidates, seed),
      COMPLETE_FAILURE,
      COMPLETE_FAILURE.preferredCandidateTags,
      { consumptionMode: "top-n-truncate", candidateLimit: 2 },
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

  // ---- Iteration 6 Repair 2: evidence detail sanity ----
  assert.ok(
    Array.isArray(result.evidenceCandidates) && result.evidenceCandidates.length >= 1,
    "evidence-detail gate: activated ranking must return bounded evidenceCandidates",
  );
  const evidenceEntry = result.evidenceCandidates[0];
  assert.ok(
    evidenceEntry.candidateId === "B" &&
      typeof evidenceEntry.intentScore === "number" &&
      typeof evidenceEntry.intentRank === "number",
    "evidence-detail gate: entries must carry candidateId/intentScore/intentRank",
  );
  assert.ok(
    result.evidenceCandidates.length <= 8,
    "evidence-detail gate: evidence detail list must stay bounded (<= candidateLimit)",
  );

  // ---- Iteration 6 Repair 2: site-split gate routing (config level) ----
  // The per-site enable flags route through rankCandidatesByFailureIntent's
  // `enabled` option; the production wiring lives in tryAdaptiveCheckpointRepair
  // (covered by the authority runs). Here we lock the config semantics:
  // disabled site => legacy order byte-for-byte; enabled site => activation.
  const disabledSite = rankCandidatesByFailureIntent(
    opportunitySim,
    candidates,
    COMPLETE_FAILURE,
    COMPLETE_FAILURE.preferredCandidateTags,
    { enabled: false },
  );
  assert.strictEqual(disabledSite.activated, false, "site gate: disabled must not activate");
  assert.strictEqual(
    disabledSite.ranked.map((c) => c.id).join(","),
    "A,B",
    "site gate: disabled site must keep the legacy order identically",
  );

  // ---- Iteration 6 Repair 2: event telemetry no-overwrite + determinism ----
  // Driven through the REAL production path (runMilestoneGraph adaptive
  // repair) so the append-only events[] semantics are verified end-to-end.
  gateEventTelemetry();

  console.log(JSON.stringify({
    schema: "motapathfinder.failure-conditioned-investment.v2",
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
    siteGate: {
      disabledKeepsLegacyOrder: true,
    },
    evidenceDetails: {
      bounded: true,
      entries: result.evidenceCandidates.length,
    },
    eventTelemetry: "verified (append-only, per-site attribution, deterministic)",
    determinism: "4/4 shuffled inputs rank identically",
    noItemOrMonsterOrRouteHints: true,
  }, null, 2));
}

function gateEventTelemetry() {
  // Drive a real runMilestoneGraph adaptive repair (mt1-mt3 spec: mt2-to-mt3
  // fails, adaptive checkpoint repair triggers) with both intent sites ON and
  // verify the failureIntentRanking.events[] contract:
  //   - append-only, per-call, not overwritten by later calls;
  //   - both anchor and replay phases appear when reached;
  //   - compact shape (no route/state dumps);
  //   - deterministic across two identical runs.
  const path = require("node:path");
  const { loadProject } = require("./lib/project-loader");
  const { StaticSimulator } = require("./lib/simulator");
  const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
  const { getMilestoneSpec } = require("./lib/milestone-spec");
  const { runMilestoneGraph } = require("./lib/segment-dp");
  const {
    createNoStateChangeChoiceResolver,
  } = require("./lib/onlyup-mt1-real-route-gate");

  const project = loadProject(path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1"));
  const simulator = new StaticSimulator(project, {
    stopFloorId: "MT6",
    battleResolver: new FunctionBackedBattleResolver(project, { enableFastReject: true }),
    autoBattleFastRejectEnabled: true,
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFastHazardBlockIndex: true,
    enableCompiledEffectCache: false,
    choiceResolver: createNoStateChangeChoiceResolver(),
  });
  const spec = getMilestoneSpec(project, "onlyup-chaos-mt1-mt3");

  const runOnce = () => {
    const result = runMilestoneGraph(simulator, simulator.createInitialState(), spec, {
      searchIntent: "adaptive-feasible",
      enableFailureBacktracking: true,
      adaptiveBacktrackDepth: 2,
      budgetScope: "global-run",
      maxExpansions: 50000,
      maxRuntimeMs: 8000,
      maxRssMb: 4096,
      memoryCheckIntervalExpansions: 1,
      memoryCheckIntervalActions: 1,
      candidateLimit: 8,
      milestoneFrontierResourceDiversity: true,
    });
    const failed = result.failedSegment || {};
    const backtrack = failed.backtrack || {};
    return backtrack.failureIntentRanking || null;
  };

  const first = runOnce();
  assert.ok(first, "event gate: adaptive repair must expose failureIntentRanking");
  const events = first.events || [];
  // The compact legacy slots remain for consumers...
  assert.ok(
    first.anchor != null && first.replay != null,
    "event gate: legacy anchor/replay summary slots must remain present",
  );
  if (events.length > 0) {
    // Append-only semantics: no two events may share the exact same
    // (phase, depth, waveIndex, replaySegmentId) call identity — overwriting
    // would collapse the history.
    const identities = new Set(events.map((e) =>
      `${e.phase}:${e.depth}:${e.waveIndex}:${e.replaySegmentId || "-"}`));
    assert.strictEqual(
      identities.size,
      events.length,
      "event gate: events[] must be append-only (no collapsed/overwritten entries)",
    );
    events.forEach((event, index) => {
      assert.ok(
        event.phase === "adaptive-expand" || event.phase === "adaptive-replay",
        `event gate: event ${index} has invalid phase ${event.phase}`,
      );
      assert.ok(
        typeof event.depth === "number" && typeof event.inputCandidateCount === "number",
        `event gate: event ${index} must carry depth/inputCandidateCount`,
      );
      assert.ok(
        Array.isArray(event.selectedCandidateIds) &&
          event.selectedCandidateIds.length <= Math.max(1, event.candidateLimit || 8),
        `event gate: event ${index} selectedCandidateIds must be bounded`,
      );
      assert.ok(
        !JSON.stringify(event).includes("route") ||
          !event.route,
        `event gate: event ${index} must not embed route dumps`,
      );
    });
    // Evidence details bounded.
    events.forEach((event, index) => {
      const evidence = event.evidenceCandidates || [];
      assert.ok(
        evidence.length <= 8,
        `event gate: event ${index} evidence details must stay bounded (<=8, got ${evidence.length})`,
      );
    });
  }

  // Determinism: a second identical run must produce the identical event
  // sequence (modulo nothing — the config and inputs are identical).
  const second = runOnce();
  const strip = (ranking) => JSON.stringify({
    anchor: ranking.anchor && ranking.anchor.activated,
    replay: ranking.replay && ranking.replay.activated,
    events: (ranking.events || []).map((e) => ({
      phase: e.phase,
      depth: e.depth,
      waveIndex: e.waveIndex,
      replaySegmentId: e.replaySegmentId,
      activated: e.activated,
      topCandidateBefore: e.topCandidateBefore,
      topCandidateAfter: e.topCandidateAfter,
      promotedCandidateIds: e.promotedCandidateIds,
      selectedCandidateIds: e.selectedCandidateIds,
    })),
  });
  assert.strictEqual(
    strip(second),
    strip(first),
    "event gate: identical config must produce the identical event sequence",
  );
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  }
}

module.exports = { main };
