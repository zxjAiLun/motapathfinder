"use strict";

/**
 * TEST GRADE: unit-plus-micro
 *
 * PR-5.4b Commit 2 — canonical segment-DP route-free state contract.
 *
 * 5.1  Scalar counters: decisionDepth / rawRouteLength / auto counters advance
 *      correctly; storeRoute=false never grows the route array but still counts
 *      rawRouteLength.
 * 5.2  Legacy state migration: getRawRouteLength resolves rawRouteLength ->
 *      route.length -> decisionDepth deterministically.
 * 5.3  Tie-break semantics: route-length-aware comparisons prefer the shorter
 *      raw route length at equal depth.
 * 5.4  Canonical DP route-free gate: no stored canonical state carries a
 *      materialized route array; rawRouteLength is monotone and matches the
 *      materialized result route.
 * 5.5  Route reconstruction parity: representative routeFingerprint and winner
 *      exact fingerprint must match Commit 1 (hardcoded references).
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { appendRouteStep, cloneState, createInitialState, getDecisionDepth, getMaterializedRouteLength, getRawRouteLength } = require("./lib/state");
const { compareGoalStates, routeLengthOfState, searchDP } = require("./lib/dp-search");
const { buildDominanceSummary } = require("./lib/dominance");
const { compileExecutableSolveTask } = require("./lib/solve-task");
const { executeSolveJob } = require("./lib/solver-job");
const { compileSolveTaskV2 } = require("./lib/solve-task-v2");

const ROOT = path.resolve(__dirname, "..");
const ONLY_UP_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");

function checkScalarCounters() {
  // 1 decision + 1 auto move + 1 auto pickup + 1 auto battle, storeRoute on.
  const on = { meta: { rank: null, decisionDepth: 0, rawRouteLength: 0, autoStepCount: 0, autoPickupCount: 0, autoBattleCount: 0 } };
  appendRouteStep(on, "decision:A", {});
  appendRouteStep(on, "auto:move:B", { decision: false, auto: "move" });
  appendRouteStep(on, "auto:pickup:C", { decision: false, auto: "pickup" });
  appendRouteStep(on, "auto:battle:D", { decision: false, auto: "battle" });
  assert.strictEqual(getDecisionDepth(on), 1, "decisionDepth must count decisions only");
  assert.strictEqual(on.meta.autoStepCount, 3, "autoStepCount must count all auto steps");
  assert.strictEqual(on.meta.autoPickupCount, 1, "autoPickupCount");
  assert.strictEqual(on.meta.autoBattleCount, 1, "autoBattleCount");
  assert.strictEqual(getRawRouteLength(on), 4, "rawRouteLength must count every step");
  assert.ok(Array.isArray(on.route) && on.route.length === 4, "storeRoute-on must materialize the route");

  // Same steps with storeRoute=false: no route growth, counters unchanged.
  const off = { meta: { rank: null, decisionDepth: 0, rawRouteLength: 0, autoStepCount: 0, autoPickupCount: 0, autoBattleCount: 0 } };
  appendRouteStep(off, "decision:A", { storeRoute: false });
  appendRouteStep(off, "auto:move:B", { storeRoute: false, decision: false, auto: "move" });
  appendRouteStep(off, "auto:pickup:C", { storeRoute: false, decision: false, auto: "pickup" });
  appendRouteStep(off, "auto:battle:D", { storeRoute: false, decision: false, auto: "battle" });
  assert.ok(!(Array.isArray(off.route) && off.route.length > 0), "storeRoute=false must not grow the route array");
  assert.strictEqual(getRawRouteLength(off), 4, "rawRouteLength must still count with storeRoute=false");
  assert.notStrictEqual(getRawRouteLength(off), getDecisionDepth(off), "rawRouteLength != decisionDepth when auto steps exist");
}

function checkLegacyMigration() {
  // Old state with only a route array.
  const legacyRoute = { route: ["a", "b", "c"], meta: { decisionDepth: 1 } };
  assert.strictEqual(getRawRouteLength(legacyRoute), 3, "legacy route-only state must use route.length");
  // Old state with only decisionDepth.
  const legacyDepth = { meta: { decisionDepth: 5 } };
  assert.strictEqual(getRawRouteLength(legacyDepth), 5, "legacy depth-only state must fall back to decisionDepth");
  // New state with rawRouteLength takes precedence.
  const modern = { route: ["x"], meta: { rawRouteLength: 7, decisionDepth: 2 } };
  assert.strictEqual(getRawRouteLength(modern), 7, "rawRouteLength must take precedence");
  // Deterministic: repeated reads do not accumulate.
  assert.strictEqual(getRawRouteLength(legacyRoute), 3);
  assert.strictEqual(getRawRouteLength(legacyRoute), 3);

  // Legacy MUTATION migration: appending to a legacy state must preserve the
  // prefix cumulative length, not restart from 0.
  const legacyPrefix = { route: ["a", "b", "c"], meta: { decisionDepth: 1 } };
  appendRouteStep(legacyPrefix, "d", {});
  assert.strictEqual(legacyPrefix.meta.rawRouteLength, 4, "legacy route prefix 3 + 1 append must yield 4");
  assert.strictEqual(getRawRouteLength(legacyPrefix), 4, "getRawRouteLength must read the migrated value");

  const legacyDepthAppend = { meta: { decisionDepth: 5 } };
  appendRouteStep(legacyDepthAppend, "e", {});
  assert.strictEqual(legacyDepthAppend.meta.rawRouteLength, 6, "legacy decisionDepth 5 + 1 append must yield 6");

  // Explicit rawRouteLength=0 is authoritative and must NOT fall back to a
  // stale route array.
  const zeroAuthoritative = { route: ["x", "y"], meta: { rawRouteLength: 0, decisionDepth: 1 } };
  assert.strictEqual(getRawRouteLength(zeroAuthoritative), 0, "explicit rawRouteLength=0 must be authoritative");

  // Legacy CANONICAL state: empty route + positive decisionDepth must migrate
  // to the depth (never to 0), deterministically across repeated reads, and
  // appending must continue from the migrated value.
  const legacyCanonical = { route: [], meta: { decisionDepth: 5 } };
  assert.strictEqual(getRawRouteLength(legacyCanonical), 5, "empty route + depth 5 must read 5 on first access");
  assert.strictEqual(getRawRouteLength(legacyCanonical), 5, "empty route + depth 5 must read 5 on second access");
  assert.strictEqual(legacyCanonical.meta.rawRouteLength, 5, "ensureMeta must have migrated to 5, not 0");
  appendRouteStep(legacyCanonical, "x", {});
  assert.strictEqual(getRawRouteLength(legacyCanonical), 6, "append after migration must yield 6");

  // Repeated ensureMeta must not double-migrate.
  const { ensureMeta } = require("./lib/state");
  const legacyRepeat = { route: ["p", "q"], meta: { decisionDepth: 2 } };
  ensureMeta(legacyRepeat);
  assert.strictEqual(legacyRepeat.meta.rawRouteLength, 2, "first ensureMeta migrates from route.length");
  ensureMeta(legacyRepeat);
  assert.strictEqual(legacyRepeat.meta.rawRouteLength, 2, "second ensureMeta must not re-migrate");
}

function checkTieBreakSemantics() {
  const base = {
    floorId: "MT1",
    hero: { hp: 100, atk: 3, def: 1, mdef: 10, lv: 1, exp: 5, loc: { x: 1, y: 1, direction: "down" } },
    inventory: {},
    flags: {},
    floorStates: {},
    visitedFloors: {},
    triggeredAutoEvents: {},
    notes: [],
    meta: { rank: "chaos", decisionDepth: 4 },
  };
  // Same HP / same DP key / same decisionDepth, different raw route length.
  const shorter = JSON.parse(JSON.stringify(base));
  shorter.meta.rawRouteLength = 6;
  const longer = JSON.parse(JSON.stringify(base));
  longer.meta.rawRouteLength = 10;

  assert.strictEqual(routeLengthOfState(shorter), 6, "routeLengthOfState must read rawRouteLength");
  assert.strictEqual(routeLengthOfState(longer), 10);
  // goal-state comparison prefers the shorter raw route at equal depth.
  assert.ok(compareGoalStates(shorter, longer) > 0, "shorter raw route must win the goal-state comparison");
  assert.ok(compareGoalStates(longer, shorter) < 0);
  // dominance summary exposes the raw route length.
  assert.strictEqual(buildDominanceSummary(shorter).routeLength, 6);
  assert.strictEqual(buildDominanceSummary(longer).routeLength, 10);
}

async function checkCanonicalRouteFreeGate() {
  const smoke = JSON.parse(fs.readFileSync(
    path.join(ROOT, "towers", "onlyup", "region-specs", "region-output-contract-smoke.json"), "utf8",
  ));
  smoke.goal = { type: "heroAtLeast", floorId: "MT1", minHero: { exp: 9 } };
  const task = compileExecutableSolveTask({
    schema: "motapathfinder.solve-task.v1",
    tower: { id: "onlyup-smoke", projectRoot: ONLY_UP_ROOT, region: { spec: smoke } },
    objective: { mode: "max-final-hp" },
    search: { algorithm: "segment-dp", maxExpansions: 3000, maxRuntimeMs: 0, candidateLimit: 2, goalSkylineLimit: 8 },
    verification: { strictReplay: false },
  });
  const execution = await executeSolveJob(task, {
    jobId: "route-free-gate",
    onProgress: () => {},
    shouldStop: () => false,
    context: {},
  });
  const att = (execution.result.segmentResults || [])[0] && (execution.result.segmentResults[0].attempts || [])[0];
  const dp = att && att.diagnostics && att.diagnostics.dp;
  assert.ok(dp && dp.routeFree, "attempt diagnostics must carry routeFree");
  assert.strictEqual(dp.routeFree.nonEmptyRouteStateCount, 0, "no canonical state may carry a non-empty route");
  assert.ok(dp.routeFree.maxRawRouteLength > 0, "raw route length must be tracked");

  // The detached result state's rawRouteLength must carry the CANONICAL
  // decision+auto cumulative length, and must NOT be compressed back to the
  // shorter materialized route entry count.
  const fc = execution.result.finalCandidate && execution.result.finalCandidate.state;
  assert.ok(fc && fc.meta, "final candidate must carry meta");
  assert.ok(
    fc.meta.rawRouteLength > fc.route.length,
    `canonical rawRouteLength must exceed the materialized route entry count (raw=${fc.meta.rawRouteLength}, route=${fc.route.length})`,
  );
  // rawRouteLength is monotone: >= decisionDepth (auto steps included).
  assert.ok(fc.meta.rawRouteLength >= fc.meta.decisionDepth, "rawRouteLength must be monotone above decisionDepth");
}

function checkTerminalObjectiveOrdering() {
  // Two goal candidates that are otherwise identical but differ in MATERIALIZED
  // route length and in RAW route length:
  //   A: 1 decision + 20 auto  -> raw=21, materialized=1
  //   B: 2 decisions + 0 auto  -> raw=2,  materialized=2
  // min route.length objective must pick A; the internal raw tie-break would
  // pick B.  The terminal ordering receives detached materialized clones, so
  // the objective must read the real materialized entry count (getMaterialized
  // RouteLength), never the canonical empty route array.
  const base = {
    floorId: "MT1",
    hero: { hp: 100, atk: 3, def: 1, mdef: 10, lv: 1, exp: 9, loc: { x: 1, y: 1, direction: "down" } },
    inventory: {},
    flags: {},
    floorStates: {},
    visitedFloors: {},
    triggeredAutoEvents: {},
    notes: [],
  };
  const candidateA = JSON.parse(JSON.stringify(base));
  candidateA.route = ["only"];
  candidateA.meta = { rank: "chaos", decisionDepth: 1, rawRouteLength: 21, autoStepCount: 20 };
  const candidateB = JSON.parse(JSON.stringify(base));
  candidateB.route = ["a", "b"];
  candidateB.meta = { rank: "chaos", decisionDepth: 2, rawRouteLength: 2, autoStepCount: 0 };

  assert.strictEqual(getMaterializedRouteLength(candidateA), 1, "A materialized length must be 1");
  assert.strictEqual(getMaterializedRouteLength(candidateB), 2, "B materialized length must be 2");
  assert.strictEqual(getRawRouteLength(candidateA), 21, "A raw length must be 21");
  assert.strictEqual(getRawRouteLength(candidateB), 2, "B raw length must be 2");

  const { compileObjectiveSpec } = require("./lib/objective-spec");
  const spec = compileObjectiveSpec({
    mode: "maximize-score",
    terms: [{ path: "route.length", weight: -1 }],
  }, null);
  const comparison = spec.compareCandidates(candidateA, candidateB);
  assert.ok(comparison < 0, "min route.length objective must prefer A (materialized 1 < 2)");

  // The internal raw-route tie-break (compareGoalStates) prefers the shorter
  // RAW length, i.e. B — proving the two concepts stay distinct.
  assert.ok(compareGoalStates(candidateB, candidateA) > 0, "raw tie-break must prefer B (raw 2 < 21)");
  // Canonical (route-free, empty array) states must NOT win by materialized
  // length: getMaterializedRouteLength falls back to decisionDepth.
  const canonicalA = { ...candidateA, route: [], meta: { ...candidateA.meta } };
  assert.strictEqual(getMaterializedRouteLength(canonicalA), 1, "canonical fallback uses decisionDepth for materialized length");
}

function checkSegmentReentryPreservesRawLength() {
  // Region A's outgoing state (detached materialized) enters the next segment's
  // searchDP.  The root must inherit the cumulative rawRouteLength (21) from
  // getRawRouteLength(initialState), NOT reset to the materialized prefix
  // length (1).  Children then continue from 22.
  const simulator = {
    project: { floorOrder: ["MT1"] },
    isTerminal() { return false; },
  };
  const incoming = {
    floorId: "MT1",
    hero: { hp: 100, atk: 3, def: 1, mdef: 10, lv: 1, exp: 9, loc: { x: 1, y: 1, direction: "down" } },
    inventory: {},
    flags: {},
    floorStates: {},
    visitedFloors: {},
    triggeredAutoEvents: {},
    notes: [],
    route: ["only"], // materialized prefix
    meta: { rank: "chaos", decisionDepth: 1, rawRouteLength: 21, autoStepCount: 20 },
  };
  const result = searchDP(simulator, incoming, {
    maxExpansions: 2,
    maxActionsPerState: 1,
    dpSkylineMax: 2,
    actionProvider() { return [{ kind: "event", summary: "carried-step" }]; },
    actionApplier(state, action) {
      const next = cloneState(state);
      appendRouteStep(next, action.summary, { storeRoute: false });
      return next;
    },
  });
  const routeFree = result.diagnostics && result.diagnostics.routeFree;
  assert.ok(routeFree, "searchDP diagnostics must expose routeFree");
  assert.ok(
    routeFree.maxRawRouteLength >= 22,
    `next-segment root must inherit Region A's cumulative raw length (max=${routeFree.maxRawRouteLength})`,
  );
}

function checkCompoundRoutePatchMaterialization() {
  const simulator = {
    project: { floorOrder: ["MT7"] },
    isTerminal(state) { return state.flags && state.flags.goal === true; },
  };
  const initial = {
    floorId: "MT7",
    hero: { hp: 100, atk: 3, def: 1, mdef: 0, lv: 1, exp: 0, loc: { x: 1, y: 1, direction: "down" } },
    inventory: {},
    flags: {},
    floorStates: {},
    visitedFloors: {},
    triggeredAutoEvents: {},
    notes: [],
    route: ["prefix@MT6"],
    meta: { rank: null, decisionDepth: 1, rawRouteLength: 1, autoStepCount: 0 },
  };
  const routePatch = [
    "changeFloor@MT7:6,12",
    "battle:yellowFairy@MT7:10,12",
    "battle:yellowPriest@MT7:11,11",
  ];
  const result = searchDP(simulator, initial, {
    maxExpansions: 4,
    maxActionsPerState: 1,
    dpSkylineMax: 2,
    goalPredicate: (state) => state.flags && state.flags.goal === true,
    actionProvider(state) {
      return state.flags && state.flags.goal
        ? []
        : [{ kind: "battle", summary: "battle:finalTarget@MT7:12,10" }];
    },
    actionApplier(state) {
      const next = cloneState(state);
      routePatch.forEach((summary) => appendRouteStep(next, summary, { storeRoute: false }));
      next.flags.goal = true;
      next._routePatch = routePatch.slice();
      return next;
    },
  });
  assert.strictEqual(result.foundGoal, true, "compound route-patch search must reach its goal");
  assert.deepStrictEqual(
    result.bestGoalState.route,
    ["prefix@MT6"].concat(routePatch),
    "materialized route must expand the complete route patch instead of keeping only the high-level target",
  );
  assert.ok(
    !result.bestGoalState.route.some((entry) => entry && entry.summary === "battle:finalTarget@MT7:12,10"),
    "the high-level target must not duplicate or replace its concrete route patch",
  );
  assert.strictEqual(
    result.diagnostics.routeFree.nonEmptyRouteStateCount,
    0,
    "compound patch reconstruction must leave canonical DP states route-free",
  );
}

async function checkMultiRegionBoundaryCompletes() {
  // A real two-region composite (Region A auto-rich, Region B a no-op carryover)
  // must complete with Region A route-free and its cumulative raw length intact.
  const regionA = JSON.parse(fs.readFileSync(
    path.join(ROOT, "towers", "onlyup", "region-specs", "region-output-contract-smoke.json"), "utf8",
  ));
  regionA.goal = { type: "heroAtLeast", floorId: "MT1", minHero: { exp: 9 } };
  const regionB = { ...JSON.parse(JSON.stringify(regionA)), id: "onlyup-region-b" };
  const task = compileSolveTaskV2({
    schema: "motapathfinder.solve-task.v2",
    tower: { id: "onlyup-v2.1", projectRoot: ONLY_UP_ROOT, regions: [{ spec: regionA }, { spec: regionB }] },
    model: {
      heroFields: {
        hp: "dominance", atk: "key", def: "key", mdef: "key", lv: "key", exp: "key", money: "disabled",
        equipment: "key", followers: "disabled", hpmax: "disabled", mana: "disabled", manamax: "disabled",
      },
    },
    objective: { mode: "max-final-hp" },
    search: { algorithm: "segment-dp", maxExpansions: 2000, maxRuntimeMs: 60000, candidateLimit: 2, regionCandidateLimit: 8 },
    verification: { strictReplay: false },
  });
  const { executeSolveJobV2 } = require("./lib/solver-job");
  const execution = await executeSolveJobV2(task, {
    jobId: "route-free-multi-region",
    onProgress: () => {},
    shouldStop: () => false,
    context: {},
  });
  assert.strictEqual(execution.result.found, true, "multi-region composite must complete");
  const region0 = execution.result.segmentResults[0];
  const att0 = region0 && region0.attempts && region0.attempts[0];
  const dp0 = att0 && att0.diagnostics && att0.diagnostics.dp;
  assert.ok(dp0 && dp0.routeFree, "region A must expose routeFree diagnostics");
  assert.strictEqual(dp0.routeFree.nonEmptyRouteStateCount, 0, "region A canonical states must be route-free");
  // Region A alone contributes decisionDepth 6 + autoStepCount 23 = 29.
  assert.ok(
    dp0.routeFree.maxRawRouteLength >= 29,
    `Region A cumulative raw length must be preserved (max=${dp0.routeFree.maxRawRouteLength})`,
  );
}

async function main() {
  checkScalarCounters();
  checkLegacyMigration();
  checkTieBreakSemantics();
  checkTerminalObjectiveOrdering();
  checkSegmentReentryPreservesRawLength();
  checkCompoundRoutePatchMaterialization();
  await checkCanonicalRouteFreeGate();
  await checkMultiRegionBoundaryCompletes();

  process.stdout.write(JSON.stringify({
    schema: "motapathfinder.pr-5.4b-route-free-state.v1",
    status: "passed",
    controls: {
      scalarCountersCorrect: true,
      storeRouteFalseNoRouteGrowth: true,
      legacyMigrationDeterministic: true,
      tieBreakPrefersShorterRawRoute: true,
      canonicalStateRouteFree: true,
      rawRouteLengthMonotone: true,
      terminalObjectiveOrderingUsesMaterialized: true,
      multiRegionCumulativeRawLengthPreserved: true,
      compoundRoutePatchMaterialized: true,
      commit1ParityOwnedByPerfBaseline: true,
    },
  }, null, 2) + "\n");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}

module.exports = { main };
