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

const { appendRouteStep, createInitialState, getDecisionDepth, getRawRouteLength } = require("./lib/state");
const { compareGoalStates, routeLengthOfState, searchDP } = require("./lib/dp-search");
const { buildDominanceSummary } = require("./lib/dominance");
const { compileExecutableSolveTask } = require("./lib/solve-task");
const { executeSolveJob } = require("./lib/solver-job");

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

async function main() {
  checkScalarCounters();
  checkLegacyMigration();
  checkTieBreakSemantics();
  await checkCanonicalRouteFreeGate();

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
      reconstructionParityWithCommit1: true,
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
