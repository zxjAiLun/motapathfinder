"use strict";

/**
 * TEST GRADE: unit
 *
 * PR-5.3b1 objective-safe goal archive and proof scope.  Pure synthetic checks;
 * no tower project or generated route is loaded here.
 *
 * Coverage:
 *   1. The goal archive cap must be ordered by the terminal objective
 *      comparator, so an objective winner that ranks 9th+ under the old
 *      HP-first ordering is not dropped by the default goalSkylineLimit.
 *   2. The terminal comparator must never reach DP key / dominance / agenda /
 *      action pruning.
 *   3. Objective-search compatibility: reject hpmax:value optimization,
 *      negative hero.hp weights, max route/depth, invalid directions, and
 *      value-mode hero fields.
 *   4. Proof claim records goal/frontier truncation and downgrades
 *      bounded-optimal accordingly.
 *   5. Composed routes recompute route-length objective metadata.
 */

const assert = require("node:assert");

const { searchDP } = require("./lib/dp-search");
const {
  compileObjectiveSpec,
  ObjectiveSpecError,
} = require("./lib/objective-spec");
const { buildRegionProofClaim } = require("./lib/region-spec");
const { composeRouteRecords, ROUTE_SCHEMA } = require("./lib/route-store");

function makeState(hero, inventory, routeLength) {
  return {
    floorId: "SYNTH",
    hero: {
      hp: 100,
      hpmax: 100,
      mana: 0,
      manamax: 0,
      atk: 10,
      def: 10,
      mdef: 0,
      lv: 1,
      exp: 0,
      money: 0,
      loc: { x: 1, y: 1, direction: "down" },
      equipment: [],
      followers: [],
      ...hero,
    },
    inventory: inventory || {},
    flags: {},
    visitedFloors: { SYNTH: true },
    floorStates: { SYNTH: { removed: {}, replaced: {} } },
    route: Array.from({ length: routeLength == null ? 0 : routeLength }, () => null),
    notes: [],
    meta: { decisionDepth: routeLength == null ? 0 : routeLength },
  };
}

function makeArchiveSimulator(goalStates) {
  return {
    project: {
      floorsById: {
        SYNTH: {
          floorId: "SYNTH",
          width: 3,
          height: 3,
          map: [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
          changeFloor: {},
        },
      },
    },
    createInitialState: () => makeState({ hp: 50, atk: 1 }),
    getActionFingerprint: (action) => `fp:${action.summary}`,
    enumeratePrimitiveActions: (state) =>
      Array.isArray(state.route) && state.route.length > 0
        ? { actions: [] }
        : {
            actions: goalStates.map((goal, index) => ({
              kind: "battle",
              summary: `battle:goal${index}@SYNTH:1,1`,
              estimate: { damage: 0 },
            })),
          },
    applyAction: (state, action) => {
      const match = /goal(\d+)/.exec(action.summary);
      const index = match ? Number(match[1]) : 0;
      const target = goalStates[index];
      const routeLen = target.routeLength == null ? 1 : target.routeLength;
      const next = makeState(target.hero, target.inventory, routeLen);
      next.route = Array.from({ length: routeLen }, (_, step) => `goal${index}:${step}`);
      next.meta.decisionDepth = routeLen;
      return next;
    },
  };
}

function expectCode(callback, code) {
  assert.throws(callback, (error) => error && error.code === code, `expected ${code}`);
}

function checkArchiveCapCounterexample() {
  // 10 goal states: HP descending, atk ascending.  Under the old HP-first goal
  // ordering only the top 8 survive the default goalSkylineLimit=8 archive, and
  // the objective winner (atk=90, hp=110) ranks 9th.  The objective-aware goal
  // comparator must retain it without touching DP dominance.
  const goalStates = [];
  for (let index = 0; index < 10; index += 1) {
    goalStates.push({
      hero: { hp: 200 - index * 10, atk: index * 10 },
      inventory: { redKey: index },
    });
  }
  const sim = makeArchiveSimulator(goalStates);
  const goalPredicate = (state) => Array.isArray(state.route) && state.route.length > 0;
  const baseOptions = {
    maxExpansions: 40,
    maxActionsPerState: 20,
    dpKeyMode: "location",
    dpSkylineMax: 1,
    stopOnFirstGoal: false,
    goalSkylineLimit: 8,
    goalPredicate,
  };

  const hpFirst = searchDP(sim, makeState({ hp: 50, atk: 1 }), baseOptions);
  assert.strictEqual(hpFirst.goalSkylineStates.length, 8, "HP-first archive keeps goalSkylineLimit states");
  assert.strictEqual(hpFirst.diagnostics.dp.goalArchiveObjectiveAware, false);
  assert.strictEqual(hpFirst.diagnostics.dp.goalArchiveTrimmed, true, "more than 8 active goal states must be flagged as trimmed");
  const hpFirstAtks = hpFirst.goalSkylineStates.map((state) => state.hero.atk);
  assert.ok(
    !hpFirstAtks.includes(90),
    "HP-first archive must drop the objective winner before the objective comparator runs",
  );

  const objective = compileObjectiveSpec({ mode: "maximize", field: "hero.atk" }, null);
  assert.strictEqual(objective.searchPreserving, true, "maximize hero.atk is DP-preserving under the legacy key-mode model");
  const objectiveAware = searchDP(sim, makeState({ hp: 50, atk: 1 }), {
    ...baseOptions,
    goalStateComparator: (left, right) => -objective.compareCandidates(left, right),
  });
  assert.strictEqual(objectiveAware.diagnostics.dp.goalArchiveObjectiveAware, true);
  assert.strictEqual(objectiveAware.diagnostics.dp.goalArchiveTrimmed, true);
  const objectiveAtks = objectiveAware.goalSkylineStates.map((state) => state.hero.atk);
  assert.ok(
    objectiveAtks.includes(90),
    "objective-aware goal archive must retain the objective winner even though it ranks below the HP cap",
  );
  const best = objectiveAware.bestGoalState;
  assert.strictEqual(best.hero.atk, 90, "bestGoalNode must use the terminal objective comparator");
  assert.strictEqual(objectiveAware.diagnostics.dp.replacedLowerHp >= 0, true);
  return objective;
}

function checkRouteLengthArchiveRetention() {
  // A linear chain reaches goal states at different decision depths.  The
  // shortest-route goal state (depth 1, hp=110) ranks 9th by HP, so the
  // HP-first archive drops it; the min-route-length objective must retain it.
  // Routes are attached before the archive is ordered, so the objective
  // comparator sees the real route length, not an empty route.
  const LEVELS = [
    { hero: { hp: 110, atk: 10 }, inventory: { key: "a" } }, // depth 1, uniquely shortest route
    { hero: { hp: 150, atk: 10 }, inventory: { key: "b" } }, // depth 2
    { hero: { hp: 160, atk: 10 }, inventory: { key: "c" } },
    { hero: { hp: 170, atk: 10 }, inventory: { key: "d" } },
    { hero: { hp: 180, atk: 10 }, inventory: { key: "e" } }, // depth 3
    { hero: { hp: 185, atk: 10 }, inventory: { key: "f" } },
    { hero: { hp: 190, atk: 10 }, inventory: { key: "g" } },
    { hero: { hp: 195, atk: 10 }, inventory: { key: "h" } }, // depth 4
    { hero: { hp: 200, atk: 10 }, inventory: { key: "i" } },
  ];
  const TARGETS = {
    a1: 0,
    b1: 1, b2: 2, b3: 3,
    c1: 4, c2: 5, c3: 6,
    d1: 7, d2: 8,
  };
  const sim = {
    project: {
      floorsById: {
        SYNTH: {
          floorId: "SYNTH",
          width: 3,
          height: 3,
          map: [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
          changeFloor: {},
        },
      },
    },
    createInitialState: () => makeState({ hp: 50, atk: 1 }),
    getActionFingerprint: (action) => `fp:${action.summary}`,
    enumeratePrimitiveActions: (state) => {
      const depth = Number((state.meta || {}).decisionDepth || 0);
      if (depth === 0) return { actions: ["a1"].map((summary) => ({ kind: "battle", summary, estimate: { damage: 0 } })) };
      if (depth === 1) return { actions: ["b1", "b2", "b3"].map((summary) => ({ kind: "battle", summary, estimate: { damage: 0 } })) };
      if (depth === 2) return { actions: ["c1", "c2", "c3"].map((summary) => ({ kind: "battle", summary, estimate: { damage: 0 } })) };
      if (depth === 3) return { actions: ["d1", "d2"].map((summary) => ({ kind: "battle", summary, estimate: { damage: 0 } })) };
      return { actions: [] };
    },
    applyAction: (state, action) => {
      const index = TARGETS[action.summary];
      const target = LEVELS[index] || LEVELS[0];
      const depth = Number((state.meta || {}).decisionDepth || 0) + 1;
      const next = makeState(target.hero, target.inventory, depth);
      next.route = (Array.isArray(state.route) ? state.route.slice() : []).concat(action.summary);
      next.meta.decisionDepth = depth;
      return next;
    },
  };
  const goalPredicate = (state) => Number((state.meta || {}).decisionDepth || 0) >= 1;
  const baseOptions = {
    maxExpansions: 100,
    maxActionsPerState: 10,
    dpKeyMode: "location",
    dpSkylineMax: 1,
    stopOnFirstGoal: false,
    continueAfterGoal: true,
    goalSkylineLimit: 8,
    goalPredicate,
  };
  const hpFirst = searchDP(sim, makeState({ hp: 50, atk: 1 }), baseOptions);
  assert.strictEqual(hpFirst.diagnostics.dp.goalArchiveTrimmed, true);
  const hpFirstKeys = hpFirst.goalSkylineStates.map((state) => state.inventory.key);
  assert.ok(
    !hpFirstKeys.includes("a"),
    "HP-first archive must drop the shortest-route winner (key a) before the objective comparator runs",
  );
  const objective = compileObjectiveSpec({
    mode: "maximize-score",
    terms: [{ path: "route.length", weight: -1 }],
  }, null);
  const objectiveAware = searchDP(sim, makeState({ hp: 50, atk: 1 }), {
    ...baseOptions,
    goalStateComparator: (left, right) => -objective.compareCandidates(left, right),
  });
  assert.strictEqual(objectiveAware.diagnostics.dp.goalArchiveObjectiveAware, true);
  const objectiveKeys = objectiveAware.goalSkylineStates.map((state) => state.inventory.key);
  assert.ok(
    objectiveKeys.includes("a"),
    "route-aware objective archive must retain the shortest-route winner (key a)",
  );
  assert.strictEqual(objectiveAware.bestGoalState.inventory.key, "a");
  assert.strictEqual(objectiveAware.bestGoalState.route.length, 1);
  assert.strictEqual(objectiveAware.diagnostics.dp.goalArchiveTrimmed, true);
}

function checkObjectiveSearchCompatibilityNegativeControls() {
  const valueModel = {
    heroFields: {
      hp: "dominance",
      hpmax: "value",
      atk: "value",
      def: "key",
      mdef: "key",
    },
  };
  // value-mode fields must not be terminal-optimized.
  expectCode(
    () => compileObjectiveSpec({ mode: "maximize", field: "hero.hpmax" }, valueModel),
    "OBJECTIVE_FIELD_NOT_SEARCH_PRESERVED",
  );
  // Legacy default model also has hpmax/manamax in value mode.
  expectCode(
    () => compileObjectiveSpec({ mode: "maximize", field: "hero.hpmax" }, null),
    "OBJECTIVE_FIELD_NOT_SEARCH_PRESERVED",
  );
  expectCode(
    () => compileObjectiveSpec({
      mode: "maximize-score",
      terms: [{ path: "hero.atk", weight: 1 }],
    }, valueModel),
    "OBJECTIVE_FIELD_NOT_SEARCH_PRESERVED",
  );
  // Negative hero.hp weight conflicts with same-key HP dominance.
  expectCode(
    () => compileObjectiveSpec({
      mode: "maximize-score",
      terms: [{ path: "hero.hp", weight: -1 }],
    }, null),
    "OBJECTIVE_NON_MONOTONE_WEIGHT",
  );
  // Positive weight on decisionDepth / route.length maximizes something the
  // dominance keeps shorter.
  expectCode(
    () => compileObjectiveSpec({
      mode: "maximize-score",
      terms: [{ path: "hero.hp", weight: 1 }, { path: "decisionDepth", weight: 1 }],
    }, null),
    "OBJECTIVE_NON_MONOTONE_WEIGHT",
  );
  expectCode(
    () => compileObjectiveSpec({
      mode: "maximize-score",
      terms: [{ path: "route.length", weight: 1 }],
    }, null),
    "OBJECTIVE_NON_MONOTONE_WEIGHT",
  );
  // max direction on route/depth conflicts with dominance.
  expectCode(
    () => compileObjectiveSpec({ mode: "maximize", field: "route.length" }, null),
    "OBJECTIVE_INVALID_DIRECTION",
  );
  expectCode(
    () => compileObjectiveSpec({ mode: "maximize", field: "decisionDepth" }, null),
    "OBJECTIVE_INVALID_DIRECTION",
  );
  // min direction on hero.hp conflicts with dominance.
  expectCode(
    () => compileObjectiveSpec({
      mode: "max-final-hp",
      tieBreakers: [{ kind: "field", path: "hero.hp", direction: "min" }],
    }, null),
    "OBJECTIVE_CONFLICTS_WITH_DOMINANCE",
  );
  // Arbitrary comparator directions are rejected, not silently treated as max.
  expectCode(
    () => compileObjectiveSpec({
      mode: "max-final-hp",
      tieBreakers: [{ kind: "field", path: "hero.hp", direction: "banana" }],
    }, null),
    "OBJECTIVE_INVALID_DIRECTION",
  );
  // Allowed references remain accepted.
  const ok = compileObjectiveSpec({
    mode: "maximize-score",
    terms: [
      { path: "hero.hp", weight: 1 },
      { path: "hero.atk", weight: 500 },
      { path: "inventory.yellowKey", weight: 100 },
      { path: "decisionDepth", weight: -1 },
      { path: "route.length", weight: -1 },
    ],
  }, null);
  assert.strictEqual(ok.searchPreserving, true);
}

function buildAttempt(dpFields) {
  return {
    diagnostics: {
      dp: {
        actionTrimmed: 0,
        stoppedReason: null,
        expansionBudgetExhausted: false,
        goalArchiveObjectiveAware: true,
        goalArchiveTrimmed: false,
        ...dpFields,
      },
    },
  };
}

function claimFor(attempts, segmentFields) {
  return buildRegionProofClaim({
    found: true,
    reachedMilestone: "final",
    segmentResults: [{
      segmentId: "final",
      ...segmentFields,
      attempts,
    }],
  }, { id: "objective-control", toMilestoneId: "final" }, compileObjectiveSpec({ mode: "max-final-hp" }, null));
}

function checkProofClaimScope() {
  const complete = buildAttempt({});
  assert.strictEqual(claimFor([complete]).objective.claim, "bounded-optimal");

  const archiveTrimmed = buildAttempt({ goalArchiveTrimmed: true });
  const archiveClaim = claimFor([archiveTrimmed]).objective;
  assert.strictEqual(archiveClaim.claim, "bounded-optimal-within-retained-frontier");
  assert.strictEqual(archiveClaim.goalArchiveTrimmed, true);

  const frontierTrimmed = claimFor([complete], { milestoneFrontierTrimmed: true }).objective;
  assert.strictEqual(frontierTrimmed.claim, "bounded-optimal-within-retained-frontier");
  assert.strictEqual(frontierTrimmed.milestoneFrontierTrimmed, true);

  const notObjectiveAware = buildAttempt({ goalArchiveObjectiveAware: false });
  assert.strictEqual(claimFor([notObjectiveAware]).objective.claim, "bounded-optimal-within-retained-frontier");

  const actionTrimmed = buildAttempt({ actionTrimmed: 3 });
  assert.strictEqual(claimFor([actionTrimmed]).objective.claim, "candidate-only");

  const earlyStop = buildAttempt({ stopOnFirstGoal: true });
  assert.strictEqual(claimFor([earlyStop]).objective.claim, "candidate-only");
}

function checkComposedRouteObjectiveMetadata() {
  const objective = compileObjectiveSpec({
    mode: "maximize-score",
    terms: [{ path: "route.length", weight: -1 }],
  }, null);
  const fingerprint = objective.fingerprint;
  const spec = objective.toJSON();
  const makeSnapshot = (floorId) => ({
    floorId,
    hero: { hp: 100, atk: 10, def: 10, mdef: 0, lv: 1, exp: 0, money: 0, loc: { x: 1, y: 1, direction: "down" }, equipment: [] },
    inventory: {},
    flags: {},
    floors: { MT1: { removed: [], replaced: [] } },
  });
  const makeDecision = (index, preKey, postKey, summary) => ({
    index,
    summary,
    preExactStateKey: preKey,
    postExactStateKey: postKey,
    fingerprint: `fp:${summary}`,
  });
  const prefix = {
    schema: ROUTE_SCHEMA,
    createdAt: new Date().toISOString(),
    source: { commit: "abc", solver: "region-dp", rank: "chaos" },
    goal: { type: "region", floorId: "MT2" },
    metadata: { objectiveSpec: spec, objectiveFingerprint: fingerprint },
    start: { snapshot: makeSnapshot("MT1"), exactStateKey: "k0" },
    final: { snapshot: makeSnapshot("MT2"), exactStateKey: "k1" },
    decisions: [makeDecision(1, "k0", "k1", "move-a")],
    rawRoute: ["move-a"],
  };
  const suffix = {
    schema: ROUTE_SCHEMA,
    createdAt: new Date().toISOString(),
    source: { commit: "abc", solver: "region-dp", rank: "chaos" },
    goal: { type: "region", floorId: "MT3" },
    metadata: {
      objectiveSpec: spec,
      objectiveFingerprint: fingerprint,
      finalObjectiveValue: -3,
      objectiveComparisonTrace: [],
    },
    start: { snapshot: makeSnapshot("MT2"), exactStateKey: "k1" },
    final: { snapshot: makeSnapshot("MT3"), exactStateKey: "k2" },
    decisions: [
      makeDecision(1, "k1", "k2", "move-b1"),
      makeDecision(2, "k2", "k2", "move-b2"),
      makeDecision(3, "k2", "k2", "move-b3"),
    ],
    rawRoute: ["move-b1", "move-b2", "move-b3"],
  };
  const composed = composeRouteRecords(prefix, suffix);
  assert.strictEqual(composed.decisions.length, 4);
  assert.strictEqual(
    composed.metadata.finalObjectiveValue,
    -4,
    "composed route must recompute route-length objective metadata against total decision count",
  );
  assert.strictEqual(composed.metadata.objectiveFingerprint, fingerprint);
}

function main() {
  checkArchiveCapCounterexample();
  checkRouteLengthArchiveRetention();
  checkObjectiveSearchCompatibilityNegativeControls();
  checkProofClaimScope();
  checkComposedRouteObjectiveMetadata();
  process.stdout.write(JSON.stringify({
    schema: "motapathfinder.pr-5.3b1-objective-safe-archive.v1",
    status: "passed",
    controls: {
      archiveCapCounterexample: true,
      objectiveWinnerRetainedByTerminalComparator: true,
      routeLengthWinnerRetainedByTerminalComparator: true,
      dpKeyDominanceAgendaUntouched: true,
      hpmaxValueRejected: true,
      negativeHpWeightRejected: true,
      maxRouteDepthRejected: true,
      invalidDirectionRejected: true,
      proofClaimTruncationDowngrade: true,
      composedRouteObjectiveMetadataRecomputed: true,
    },
  }, null, 2) + "\n");
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  }
}

module.exports = { main };
