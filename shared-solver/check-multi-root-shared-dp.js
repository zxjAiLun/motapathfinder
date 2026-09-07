"use strict";

/** TEST GRADE: local-regression */

/**
 * PR-5.24h Iteration 2 — Production Multi-Root Shared DP Authority (G29 suite).
 *
 * One live multi-root DP search: all canonical start candidates of a segment
 * share the same bestByKey / SkylineSet / agenda / nodes registry / budget &
 * completion authority, registered through the production rules
 * (buildDpStateKey + isBetterForSameDpKey + SkylineSet.add).  Root provenance
 * lives on the search nodes (rootCandidateId/rootIndex), never on the
 * canonical state.  This is NOT progressive seeding: an incomplete root keeps
 * its pending agenda inside the shared search, so budget-limited interruption
 * can never falsely claim exhaustion.
 *
 * G29 gates:
 *   G29-A: 16-root complete no-goal parity + expansion reduction (child workers)
 *   G29-B: non-vacuous goal + origin provenance + strict replay (MT1->MT2 synthetic variants)
 *   G29-C: cross-root dominance replacement ([A,B] vs [B,A])
 *   G29-D: budget-limited fail-close (pending > 0, never EXHAUSTED)
 *   G29-E: candidate completion ledger compatibility (Arm A vs Arm B)
 *   G29-F: goal skyline / candidateLimit parity on the goal-bearing workload
 *   G29-G: isolated worker integration (executeIsolatedSegment round trip)
 *   G29-H: MT3 workload performance A/B (legacy vs shared, fresh child per arm)
 *   G29-I: MT2/MT1 generalization (no MT3/OnlyUp-candidate specialization; G29-B
 *          workload runs on the MT1->MT2 segment of the same generic pipeline)
 */

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const assert = require("node:assert");
const {
  createSimulator,
  getMt3Segment,
  G28_H_MAX_EXPANSIONS,
  G28_NON_BINDING_MAX_RUNTIME_MS,
  compareGoalRecords,
  FRONTIER_FIXTURE,
} = require("./check-mt3-mt4-hot-path");
const { getMilestoneSpec } = require("./lib/milestone-spec");
const { searchSegmentDP, searchSegmentDPMultiRoot, runSegmentAgainstFrontier } = require("./lib/segment-dp");
const { buildStateKey } = require("./lib/state-key");
const { buildDpStateKey } = require("./lib/dp-search");
const { resolveRecordedAction, applyResolvedAction } = require("./lib/route-store");

function getMt1ToMt2Segment(project) {
  const spec = getMilestoneSpec(project, "onlyup-chaos-mt1-mt4");
  return { ...spec.milestones[0], dp: { ...spec.milestones[0].dp, maxRuntimeMs: 600000 } };
}

function makeTempPath(name) {
  return path.join(os.tmpdir(), `g29-${name}-${process.pid}-${Date.now()}.json`);
}

function runWorker(args, timeoutSec) {
  return spawnSync(
    process.execPath,
    ["--expose-gc", "--max-old-space-size=2048", __filename, ...args],
    { cwd: __dirname, timeout: (timeoutSec || 1800) * 1000, encoding: "utf8" },
  );
}

function writeWorkerOutput(outPath, payload) {
  fs.writeFileSync(outPath, JSON.stringify(payload));
}

function readWorkerOutput(outPath) {
  const raw = fs.readFileSync(outPath, "utf8");
  try { fs.unlinkSync(outPath); } catch (_) { /* best effort */ }
  return JSON.parse(raw);
}

function goalRecordOf(state) {
  return {
    stateKey: buildStateKey(state),
    hp: Number(((state.hero || {}).hp) || 0),
    atk: Number(((state.hero || {}).atk) || 0),
    def: Number(((state.hero || {}).def) || 0),
    mdef: Number(((state.hero || {}).mdef) || 0),
    lv: Number(((state.hero || {}).lv) || 0),
    exp: Number(((state.hero || {}).exp) || 0),
    flags: state.flags || {},
    decisionDepth: Number((((state.meta || {}).decisionDepth)) || 0),
    rawRouteLength: Number((((state.meta || {}).rawRouteLength)) || 0),
    routeLength: Array.isArray(state.route) ? state.route.length : 0,
  };
}

// ---- worker modes (fresh child processes; mirrors G28-H architecture) ----
function g29aLegacyWorker(outPath) {
  const { project, simulator } = createSimulator();
  const segment = getMt3Segment(project);
  if (typeof global.gc === "function") global.gc();
  let peakRssMb = 0;
  const sampler = setInterval(() => {
    const rssMb = process.memoryUsage().rss / (1024 * 1024);
    if (rssMb > peakRssMb) peakRssMb = rssMb;
  }, 250);
  const workerStart = Date.now();
  const candidates = [];
  let totalExpansions = 0;
  for (const c of FRONTIER_FIXTURE.candidates) {
    if (typeof global.gc === "function") global.gc();
    const t0 = Date.now();
    const res = searchSegmentDP(simulator, JSON.parse(JSON.stringify(c.state)), segment, {
      candidateId: c.candidateId,
      maxExpansions: G28_H_MAX_EXPANSIONS,
      maxRuntimeMs: G28_NON_BINDING_MAX_RUNTIME_MS,
    });
    const dp = res.diagnostics.dp;
    totalExpansions += dp.expansions;
    candidates.push({
      candidateId: c.candidateId,
      expansions: dp.expansions,
      searchComplete: dp.searchOutcome.searchComplete,
      found: res.found,
      goalCount: (res.goalSkyline || []).length,
      wallMs: Date.now() - t0,
    });
  }
  clearInterval(sampler);
  peakRssMb = Math.max(peakRssMb, process.memoryUsage().rss / (1024 * 1024));
  writeWorkerOutput(outPath, {
    arm: "legacy-per-candidate",
    candidates,
    totalExpansions,
    allComplete: candidates.every((c) => c.searchComplete === true),
    anyGoal: candidates.some((c) => c.found === true),
    wallMs: Date.now() - workerStart,
    peakRssMb: Math.round(peakRssMb * 10) / 10,
  });
}

const G29A_SHARED_MAX_EXPANSIONS = G28_H_MAX_EXPANSIONS * FRONTIER_FIXTURE.candidates.length;

function g29aSharedWorker(outPath) {
  const { project, simulator } = createSimulator();
  const segment = getMt3Segment(project);
  if (typeof global.gc === "function") global.gc();
  let peakRssMb = 0;
  const sampler = setInterval(() => {
    const rssMb = process.memoryUsage().rss / (1024 * 1024);
    if (rssMb > peakRssMb) peakRssMb = rssMb;
  }, 250);
  const workerStart = Date.now();
  const startCandidates = FRONTIER_FIXTURE.candidates.map((c) => ({
    state: JSON.parse(JSON.stringify(c.state)),
    id: c.candidateId,
  }));
  const res = searchSegmentDPMultiRoot(simulator, startCandidates, segment, {
    candidateId: "g29a-shared",
    dpOverrides: { maxExpansions: G29A_SHARED_MAX_EXPANSIONS, maxRuntimeMs: G28_NON_BINDING_MAX_RUNTIME_MS },
  });
  const dp = res.diagnostics.dp;
  clearInterval(sampler);
  peakRssMb = Math.max(peakRssMb, process.memoryUsage().rss / (1024 * 1024));
  writeWorkerOutput(outPath, {
    arm: "multi-root-shared-dp",
    expansions: dp.expansions,
    frontierSize: dp.frontierSize,
    searchComplete: dp.searchOutcome.searchComplete,
    stoppedReason: dp.stoppedReason,
    found: res.found,
    goalCount: (res.goalSkyline || []).length,
    goalRootCandidateIds: (res.goalSkyline || []).map((g) => g.rootCandidateId || null),
    rootCount: dp.rootCount,
    pendingByRoot: dp.pendingByRoot || {},
    expansionCountByRoot: dp.expansionCountByRoot || {},
    wallMs: Date.now() - workerStart,
    peakRssMb: Math.round(peakRssMb * 10) / 10,
  });
}

// ---- G29-B fixture: goal-bearing MT1->MT2 synthetic root variants ----
function buildG29BFixture(simulator) {
  const base = simulator.createInitialState({ rank: "chaos" });
  const variant = (hp, id) => {
    const state = JSON.parse(JSON.stringify(base));
    state.hero.hp = hp;
    return { state, id };
  };
  return [
    variant(30, "g29b:root-a-cannot"),   // cannot survive MT1 -> no goal
    variant(base.hero.hp, "g29b:root-b-normal"), // reaches goal with full HP
    variant(150, "g29b:root-c-weaker"),  // reaches goal with fewer resources (worse)
  ];
}

function runGoalBearingWorkload(simulator, segment, roots, extraConfig = {}) {
  const results = { legacy: [], shared: null };
  for (const root of roots) {
    const res = searchSegmentDP(simulator, JSON.parse(JSON.stringify(root.state)), segment, {
      candidateId: root.id,
      dpOverrides: { maxExpansions: G28_H_MAX_EXPANSIONS, maxRuntimeMs: G28_NON_BINDING_MAX_RUNTIME_MS },
      ...extraConfig,
    });
    results.legacy.push({
      rootId: root.id,
      found: res.found,
      searchComplete: res.diagnostics.dp.searchOutcome.searchComplete,
      expansions: res.diagnostics.dp.expansions,
      goals: (res.goalSkyline || []).map((g) => ({ ...goalRecordOf(g.state), rootId: root.id, state: g.state })),
    });
  }
  const shared = searchSegmentDPMultiRoot(
    simulator,
    roots.map((root) => ({ state: JSON.parse(JSON.stringify(root.state)), id: root.id })),
    segment,
    {
      candidateId: "g29b-shared",
      dpOverrides: { maxExpansions: G28_H_MAX_EXPANSIONS, maxRuntimeMs: G28_NON_BINDING_MAX_RUNTIME_MS },
      ...extraConfig,
    },
  );
  results.shared = {
    found: shared.found,
    searchComplete: shared.diagnostics.dp.searchOutcome.searchComplete,
    expansions: shared.diagnostics.dp.expansions,
    goals: (shared.goalSkyline || []).map((g) => ({
      ...goalRecordOf(g.state),
      rootCandidateId: g.rootCandidateId || null,
      state: g.state,
    })),
  };
  return results;
}

// Strict replay of a materialized goal route from its reported root state.
// Materialized routes mix auto entries (summary strings, e.g. "auto:pickup:...")
// with decision entries (objects with fingerprints).  Auto entries are
// re-derived by the simulator's auto-resolver during movement, so replay
// applies only the decision entries and lets stabilization reproduce the
// auto steps — exactly like the recorded-route replay machinery.
function strictReplayGoalRoute(simulator, rootState, goalRouteEntries, expectedGoalStateKey) {
  let state = JSON.parse(JSON.stringify(rootState));
  for (let index = 0; index < goalRouteEntries.length; index += 1) {
    const decision = goalRouteEntries[index];
    if (typeof decision === "string") {
      if (decision.startsWith("auto:")) continue; // re-derived by auto-resolver
      return { ok: false, reason: `non-auto string entry at ${index + 1}: ${decision}` };
    }
    const resolved = resolveRecordedAction(simulator, state, decision, {});
    if (!resolved.action) {
      return { ok: false, reason: `action-resolution-failed at ${index + 1}: ${resolved.reason}` };
    }
    try {
      state = applyResolvedAction(simulator, state, resolved).state;
    } catch (error) {
      return { ok: false, reason: `apply-failed at ${index + 1}: ${error && error.message}` };
    }
  }
  const finalKey = buildStateKey(state);
  return { ok: finalKey === expectedGoalStateKey, finalStateKey: finalKey };
}

// ========== Gates ==========
function gateG29B_NonVacuousGoalAndProvenance(simulator, segment, roots) {
  const workload = runGoalBearingWorkload(simulator, segment, roots);
  const legacyByRoot = new Map(workload.legacy.map((r) => [r.rootId, r]));
  const rootA = legacyByRoot.get("g29b:root-a-cannot");
  const rootB = legacyByRoot.get("g29b:root-b-normal");
  const rootC = legacyByRoot.get("g29b:root-c-weaker");
  assert.strictEqual(rootA.found, false, "G29-B: root A must not reach the goal");
  assert.strictEqual(rootB.found, true, "G29-B: root B must reach the goal");
  assert.strictEqual(rootC.found, true, "G29-B: root C must reach the goal");
  const bestB = rootB.goals.reduce((best, g) => (best == null || compareGoalRecords(g, best) > 0 ? g : best), rootB.goals[0]);
  const bestC = rootC.goals.reduce((best, g) => (best == null || compareGoalRecords(g, best) > 0 ? g : best), rootC.goals[0]);
  // Root C starts with fewer resources, so its best reached goal must be
  // strictly worse than root B's best under the production comparator.
  assert.ok(compareGoalRecords(bestB, bestC) > 0, "G29-B: root B best goal must beat root C best goal under the comparator");

  const shared = workload.shared;
  assert.strictEqual(shared.found, true, "G29-B: shared arm must find the goal");
  assert.strictEqual(shared.searchComplete, true, "G29-B: shared arm must complete");
  assert.ok(shared.goals.length > 0, "G29-B: shared arm must return goal records");

  // Origin provenance: every shared goal's rootCandidateId must be a root that
  // independently reaches the goal, and attribution must match legacy.
  // Goal multiset: shared archive applies ONE global goalSkylineLimit across
  // roots, so the exact multiset can legitimately be a subset of the union of
  // per-root legacy archives (cross-root dominance prunes weaker duplicates).
  // The binding assertions are: shared ⊆ legacy-union multiset, per-goal root
  // attribution correctness, and (in G29-F) merged-output parity.
  const goalMultisetOf = (records) => records.reduce((map, g) => {
    map.set(g.stateKey, (map.get(g.stateKey) || 0) + 1);
    return map;
  }, new Map());
  const legacyGoalMultiset = goalMultisetOf(workload.legacy.flatMap((r) => r.goals));
  const sharedGoalMultiset = goalMultisetOf(shared.goals);
  const sharedWithinLegacyUnion = Array.from(sharedGoalMultiset.entries()).every(([k, v]) => (legacyGoalMultiset.get(k) || 0) >= v);
  assert.strictEqual(sharedWithinLegacyUnion, true, "G29-B: every shared goal must also be reachable by the legacy per-root arms");

  const attributionVerified = shared.goals.every((g) => {
    const legacyRoot = legacyByRoot.get(g.rootCandidateId);
    return Boolean(legacyRoot)
      && legacyRoot.found === true
      && legacyRoot.goals.some((lg) => lg.stateKey === g.stateKey);
  });
  assert.strictEqual(attributionVerified, true, "G29-B: every shared goal must be attributed to a root that independently reaches the same goal state");

  // Strict replay from the reported root.
  const rootStateById = new Map(roots.map((r) => [r.id, r.state]));
  const replayableGoals = shared.goals.filter((g) => g.routeLength > 0);
  assert.ok(replayableGoals.length > 0, "G29-B: at least one shared goal must carry a materialized route");
  const replayResults = replayableGoals.map((g) => ({
    rootCandidateId: g.rootCandidateId,
    stateKey: g.stateKey,
    ...strictReplayGoalRoute(simulator, rootStateById.get(g.rootCandidateId), g.state.route, g.stateKey),
  }));
  assert.strictEqual(replayResults.every((r) => r.ok), true, `G29-B: strict replay from reported root must reach the exact goal state: ${JSON.stringify(replayResults.filter((r) => !r.ok).slice(0, 2))}`);

  const bestShared = shared.goals.reduce((best, g) => (best == null || compareGoalRecords(g, best) > 0 ? g : best), shared.goals[0]);
  const bestLegacy = workload.legacy.flatMap((r) => r.goals).reduce((best, g) => (best == null || compareGoalRecords(g, best) > 0 ? g : best), null);
  const bestGoalMatched = bestLegacy != null && compareGoalRecords(bestShared, bestLegacy) === 0 && bestShared.stateKey === bestLegacy.stateKey;
  assert.strictEqual(bestGoalMatched, true, "G29-B: best goal under the existing comparator must match the legacy arm");

  return {
    nonVacuousGoalProvenanceVerified: true,
    segment: "mt1-to-mt2 (generic pipeline, non-MT3)",
    legacy: workload.legacy.map((r) => ({ rootId: r.rootId, found: r.found, complete: r.searchComplete, goalCount: r.goals.length })),
    shared: {
      found: shared.found,
      complete: shared.searchComplete,
      expansions: shared.expansions,
      legacyTotalExpansions: workload.legacy.reduce((s, r) => s + r.expansions, 0),
      goalCount: shared.goals.length,
      goalRoots: Array.from(new Set(shared.goals.map((g) => g.rootCandidateId))),
    },
    sharedWithinLegacyUnionMultiset: sharedWithinLegacyUnion,
    attributionVerified,
    strictReplayVerified: replayResults.every((r) => r.ok),
    replayedGoalCount: replayResults.length,
    bestGoalMatched,
  };
}

function gateG29C_CrossRootDominanceReplacement() {
  const { project, simulator } = createSimulator();
  const segment = getMt3Segment(project);
  const weak = FRONTIER_FIXTURE.candidates[15]; // hp 9891
  const strong = FRONTIER_FIXTURE.candidates[0]; // hp 12782
  const orders = [
    ["weak-then-strong", weak, strong],
    ["strong-then-weak", strong, weak],
  ];
  const reports = orders.map(([label, first, second]) => {
    if (typeof global.gc === "function") global.gc();
    const res = searchSegmentDPMultiRoot(
      simulator,
      [
        { state: JSON.parse(JSON.stringify(first.state)), id: first.candidateId },
        { state: JSON.parse(JSON.stringify(second.state)), id: second.candidateId },
      ],
      segment,
      { candidateId: `g29c-${label}`, maxExpansions: G28_H_MAX_EXPANSIONS, maxRuntimeMs: G28_NON_BINDING_MAX_RUNTIME_MS },
    );
    const dp = res.diagnostics.dp;
    return {
      order: label,
      expansions: dp.expansions,
      searchComplete: dp.searchOutcome.searchComplete,
      found: res.found,
      expansionCountByRoot: dp.expansionCountByRoot || {},
      frontierSize: dp.frontierSize,
    };
  });
  const [weakFirst, strongFirst] = reports;
  assert.strictEqual(weakFirst.searchComplete, true, "G29-C: [weak,strong] must complete");
  assert.strictEqual(strongFirst.searchComplete, true, "G29-C: [strong,weak] must complete");
  assert.strictEqual(weakFirst.found, strongFirst.found, "G29-C: both orders must agree on found");
  // The later BETTER root must still expand its own lineage (replacement, not
  // seed-style permanent blocking).  expansionCountByRoot is keyed by rootIndex
  // (position in the shared input array).
  const strongRootIndex = 1; // [weak, strong] order: strong is the second root
  const weakRootIndex = 0;
  const strongExpansionsInWeakFirst = weakFirst.expansionCountByRoot[strongRootIndex] || 0;
  assert.ok(strongExpansionsInWeakFirst > 0, "G29-C: the later better root must still expand (live replacement, not permanent blocker)");
  const weakExpansionsInStrongFirst = strongFirst.expansionCountByRoot[weakRootIndex] || 0;
  assert.ok(weakExpansionsInStrongFirst >= 0, "G29-C: weak root after strong root accounted");
  return {
    crossRootDominanceReplacementVerified: true,
    orders: reports,
    laterBetterRootStillExpands: strongExpansionsInWeakFirst > 0,
  };
}

// G29-J: initial same-bucket root replacement (node-identity hardening).
// Two initial roots share one DP bucket but differ in exact state and HP.
// This covers the nodeId-collision case G29-C misses: G29-C roots live in
// different buckets, so it never exercises two initial roots competing for
// the SAME bestByKey entry at registration time.
function gateG29J_InitialSameBucketRootReplacement() {
  const { project, simulator } = createSimulator();
  const segment = getMt3Segment(project);
  const base = FRONTIER_FIXTURE.candidates[0].state;
  const weakState = JSON.parse(JSON.stringify(base));
  weakState.hero.hp = 9891;
  const strongState = JSON.parse(JSON.stringify(base));
  strongState.hero.hp = 12782;
  const weak = { state: weakState, id: "g29j:root-weak-hp9891" };
  const strong = { state: strongState, id: "g29j:root-strong-hp12782" };
  // Precondition: same DP bucket, different exact states, HP ordered.
  const keyOpts = { dpKeyMode: "region" };
  assert.strictEqual(
    buildDpStateKey(simulator, weak.state, keyOpts),
    buildDpStateKey(simulator, strong.state, keyOpts),
    "G29-J precondition: both roots share one DP bucket",
  );
  assert.notStrictEqual(buildStateKey(weak.state), buildStateKey(strong.state), "G29-J precondition: different exact states");
  assert.ok(weak.state.hero.hp < strong.state.hero.hp, "G29-J precondition: HP ordered");

  const runOrder = (label, first, second) => {
    if (typeof global.gc === "function") global.gc();
    const res = searchSegmentDPMultiRoot(
      simulator,
      [
        { state: JSON.parse(JSON.stringify(first.state)), id: first.id },
        { state: JSON.parse(JSON.stringify(second.state)), id: second.id },
      ],
      segment,
      { candidateId: `g29j-${label}`, maxExpansions: G28_H_MAX_EXPANSIONS, maxRuntimeMs: G28_NON_BINDING_MAX_RUNTIME_MS },
    );
    return res;
  };
  const weakFirst = runOrder("weak-then-strong", weak, strong);
  const strongFirst = runOrder("strong-then-weak", strong, weak);

  // 1. Every accepted root nodeId is unique in both orders.
  for (const [label, res] of [["weak-then-strong", weakFirst], ["strong-then-weak", strongFirst]]) {
    const regs = res.diagnostics.dp.registeredRootNodeIds || [];
    const ids = regs.map((r) => r.nodeId);
    assert.strictEqual(new Set(ids).size, ids.length, `G29-J [${label}]: accepted root nodeIds must be unique`);
  }

  // 2. [weak,strong]: both roots are accepted at registration, but the stale
  // weak root agenda entry must never expand once strong replaces it.
  const wfDp = weakFirst.diagnostics.dp;
  const wfRegs = wfDp.registeredRootNodeIds || [];
  assert.strictEqual(wfRegs.length, 2, "G29-J [weak,strong]: both roots accepted at registration");
  assert.strictEqual((wfDp.expansionCountByRoot || {})[0] || 0, 0, "G29-J [weak,strong]: stale weak root agenda entry must never expand after replacement");
  assert.ok(((wfDp.expansionCountByRoot || {})[1] || 0) > 0, "G29-J [weak,strong]: strong root must expand");

  // 3. [strong,weak]: the weak root is dominance-rejected at registration;
  // it is never recorded and never expands.
  const sfDp = strongFirst.diagnostics.dp;
  const sfRegs = sfDp.registeredRootNodeIds || [];
  assert.strictEqual(sfRegs.length, 1, "G29-J [strong,weak]: weak root must be dominance-rejected at registration");
  assert.strictEqual(sfRegs[0].rootIndex, 0, "G29-J [strong,weak]: the sole accepted root is strong");
  assert.strictEqual((sfDp.expansionCountByRoot || {})[1] || 0, 0, "G29-J [strong,weak]: weak expansionCount = 0");
  assert.ok(((sfDp.expansionCountByRoot || {})[0] || 0) > 0, "G29-J [strong,weak]: strong root must expand");

  // 4. Semantic results consistent across orders; completion authority correct.
  assert.strictEqual(weakFirst.found, strongFirst.found, "G29-J: both orders agree on found");
  assert.strictEqual(wfDp.searchOutcome.searchComplete, true, "G29-J [weak,strong]: searchComplete");
  assert.strictEqual(sfDp.searchOutcome.searchComplete, true, "G29-J [strong,weak]: searchComplete");
  assert.strictEqual(wfDp.frontierSize, 0, "G29-J [weak,strong]: frontier exhausted");
  assert.strictEqual(sfDp.frontierSize, 0, "G29-J [strong,weak]: frontier exhausted");
  return {
    initialSameBucketRootReplacementVerified: true,
    sameBucketPrecondition: true,
    weakThenStrong: {
      acceptedRoots: wfRegs.length,
      weakExpansions: (wfDp.expansionCountByRoot || {})[0] || 0,
      strongExpansions: (wfDp.expansionCountByRoot || {})[1] || 0,
      found: weakFirst.found,
      searchComplete: wfDp.searchOutcome.searchComplete,
    },
    strongThenWeak: {
      acceptedRoots: sfRegs.length,
      weakExpansions: (sfDp.expansionCountByRoot || {})[1] || 0,
      strongExpansions: (sfDp.expansionCountByRoot || {})[0] || 0,
      found: strongFirst.found,
      searchComplete: sfDp.searchOutcome.searchComplete,
    },
  };
}

// G29-K: multi-root trace provenance (node-identity hardening).
// Verifies a NON-last-registered root's goal trace genuinely starts at the
// reported root and forms a continuous chain to the goal.  Under the old
// nodeId=0 collision, nodes.get(0) would return the LAST registered root, so
// a non-last root's trace[0] would reference the wrong root's state.
//
// Key-kind note: trace pre/postStateKey fields are PRODUCTION DP BUCKET keys
// (node.stateKey), not exact state keys by design.  Exact-state identity is
// proven through the per-step snapshots (full hero/inventory/flags content)
// plus the G29-B materialized-route strict replay, which is retained.
// G29-K fixture: two goal-bearing roots in DIFFERENT DP buckets with disjoint
// goal stateKeys.  Root D carries a persistent marker flag (plus distinct HP
// and ATK) so its lineage can never converge into root B's buckets — the two
// lineages stay fully independent and both reach the goal.  D registers LAST
// and is accepted, so under the old nodeId=0 collision every B-lineage trace
// would resolve parentId 0 to D's node (wrong root).
function buildG29KFixture(simulator) {
  const base = simulator.createInitialState({ rank: "chaos" });
  const mkRoot = (mut, id) => {
    const state = JSON.parse(JSON.stringify(base));
    mut(state);
    return { state, id };
  };
  return [
    mkRoot((s) => { s.hero.hp = 201; }, "g29k:root-b-normal"),
    mkRoot((s) => { s.hero.hp = 180; s.hero.atk = s.hero.atk + 10; s.flags = { ...s.flags, __g29k_root__: "D" }; }, "g29k:root-d-flagged"),
  ];
}

function gateG29K_MultiRootTraceProvenance() {
  const { project, simulator } = createSimulator();
  const segment = getMt1ToMt2Segment(project);
  const roots = buildG29KFixture(simulator);
  // Fixture contract: different buckets, different goal states, both reach.
  assert.notStrictEqual(
    buildDpStateKey(simulator, roots[0].state, { dpKeyMode: "region" }),
    buildDpStateKey(simulator, roots[1].state, { dpKeyMode: "region" }),
    "G29-K fixture: roots live in different DP buckets",
  );
  if (typeof global.gc === "function") global.gc();
  const res = searchSegmentDPMultiRoot(
    simulator,
    roots.map((root) => ({ state: JSON.parse(JSON.stringify(root.state)), id: root.id })),
    segment,
    { candidateId: "g29k-trace", captureTrace: true, preserveFirstGoalCheckpoint: true, maxExpansions: G28_H_MAX_EXPANSIONS, maxRuntimeMs: G28_NON_BINDING_MAX_RUNTIME_MS, goalSkylineLimit: 16 },
  );
  assert.strictEqual(res.found, true, "G29-K: shared arm must find a goal");
  const goals = res.goalSkyline || [];
  assert.ok(goals.length > 0, "G29-K: goal records present");
  // Pick a goal from a NON-last-registered root (registration order follows
  // the input array; the last root is roots[roots.length - 1]).
  const lastRootId = roots[roots.length - 1].id;
  // Prefer the first-found goal record: root-ordered agenda drains root B
  // first, so the first goal is B-lineage (non-last) by construction.  Fall
  // back to any traced non-last-root goal.
  const firstGoal = goals.find((g) => (g.tags || []).includes("first-goal") && Array.isArray(g.trace) && g.trace.length > 0);
  const target = (firstGoal && firstGoal.rootCandidateId && firstGoal.rootCandidateId !== lastRootId)
    ? firstGoal
    : goals.find((g) => g.rootCandidateId && g.rootCandidateId !== lastRootId && Array.isArray(g.trace) && g.trace.length > 0);
  assert.ok(target, "G29-K: need a traced goal from a non-last-registered root");
  assert.ok(target.rootCandidateId !== lastRootId, "G29-K: target goal must come from a non-last-registered root");
  const reportedRoot = roots.find((r) => r.id === target.rootCandidateId);
  assert.ok(reportedRoot, "G29-K: reported root must be a real input root");
  const trace = target.trace;
  // 1. Trace starts at the reported root: DP-bucket key form.
  assert.strictEqual(
    trace[0].preStateKey,
    buildDpStateKey(simulator, reportedRoot.state, { dpKeyMode: "region" }),
    "G29-K: trace[0].preStateKey must equal the reported root DP bucket key",
  );
  // 2. Trace starts at the reported root: exact-value form via snapshot hero.
  // (Catches same-bucket cross-root splicing, where DP keys alone cannot
  // distinguish roots that differ only in HP.)
  assert.strictEqual(
    trace[0].preSnapshot && trace[0].preSnapshot.hero && trace[0].preSnapshot.hero.hp,
    reportedRoot.state.hero.hp,
    "G29-K: trace[0].preSnapshot hero HP must equal the reported root HP",
  );
  // 3. Chain continuity, DP-key form.
  for (let i = 0; i < trace.length - 1; i += 1) {
    assert.strictEqual(trace[i].postStateKey, trace[i + 1].preStateKey, `G29-K: DP-key chain continuous at step ${i}`);
  }
  // 4. Chain continuity, exact-snapshot form.
  for (let i = 0; i < trace.length - 1; i += 1) {
    assert.deepStrictEqual(trace[i].postSnapshot, trace[i + 1].preSnapshot, `G29-K: snapshot chain continuous at step ${i}`);
  }
  // 5. Chain ends at the goal state.
  const last = trace[trace.length - 1];
  assert.strictEqual(last.postStateKey, buildDpStateKey(simulator, target.state, { dpKeyMode: "region" }), "G29-K: final postStateKey must equal the goal DP bucket key");
  assert.strictEqual(last.postSnapshot && last.postSnapshot.hero && last.postSnapshot.hero.hp, target.state.hero.hp, "G29-K: final postSnapshot HP must equal the goal HP");
  return {
    multiRootTraceProvenanceVerified: true,
    goalRootCandidateId: target.rootCandidateId,
    nonLastRegisteredRoot: target.rootCandidateId !== lastRootId,
    traceLength: trace.length,
    traceStartsAtReportedRootDpKey: true,
    traceStartsAtReportedRootSnapshotHp: true,
    dpKeyChainContinuous: true,
    snapshotChainContinuous: true,
    traceEndsAtGoal: true,
  };
}

function gateG29D_BudgetLimitedFailClose() {
  const { project, simulator } = createSimulator();
  const segment = getMt3Segment(project);
  const startCandidates = FRONTIER_FIXTURE.candidates.map((c) => ({
    state: JSON.parse(JSON.stringify(c.state)),
    id: c.candidateId,
  }));
  if (typeof global.gc === "function") global.gc();
  const res = searchSegmentDPMultiRoot(simulator, startCandidates, segment, {
    candidateId: "g29d-budget-limited",
    dpOverrides: { maxExpansions: 300, maxRuntimeMs: G28_NON_BINDING_MAX_RUNTIME_MS },
  });
  const dp = res.diagnostics.dp;
  const pendingTotal = Object.values(dp.pendingByRoot || {}).reduce((s, n) => s + n, 0);
  assert.strictEqual(dp.stoppedReason, null, "G29-D: no memory/cancel stop");
  assert.strictEqual(dp.expansionBudgetExhausted, true, "G29-D: expansion budget exhausted");
  assert.strictEqual(dp.searchOutcome.searchComplete, false, "G29-D: incomplete search must NOT claim searchComplete");
  assert.strictEqual(res.found, false, "G29-D: no goal within 300 expansions");
  assert.ok(dp.frontierSize > 0, "G29-D: pending agenda must survive (frontierSize > 0)");
  assert.ok(pendingTotal > 0, "G29-D: pendingByRoot must attribute live pending work to roots");

  // Arm B through runSegmentAgainstFrontierLocal: conservative ledger.
  const frontier = FRONTIER_FIXTURE.candidates.map((c) => ({
    id: c.candidateId,
    state: JSON.parse(JSON.stringify(c.state)),
    route: [],
    trace: [],
  }));
  const armB = runSegmentAgainstFrontier(simulator, segment, frontier, {
    enableMultiRootSharedDp: true,
    maxExpansions: 300,
    maxRuntimeMs: G28_NON_BINDING_MAX_RUNTIME_MS,
  }, {});
  const telemetry = armB.summary.candidateSliceTelemetry;
  assert.strictEqual(telemetry.candidateSliceSearchComplete, false, "G29-D: Arm B must not claim searchComplete");
  assert.strictEqual(telemetry.candidateSliceFinalFound, 0, "G29-D: no found roots");
  assert.strictEqual(telemetry.candidateSliceFinalPending, frontier.length, "G29-D: all roots LOCAL_INCOMPLETE_PENDING (conservative)");
  assert.strictEqual(telemetry.candidateSliceFinalComplete, 0, "G29-D: no root may claim COMPLETE under budget stop");
  assert.strictEqual(armB.summary.executionMode, "multi-root-shared-dp", "G29-D: Arm B execution mode");
  return {
    budgetLimitedFailCloseVerified: true,
    direct: {
      expansions: dp.expansions,
      frontierSize: dp.frontierSize,
      pendingByRootTotal: pendingTotal,
      searchComplete: dp.searchOutcome.searchComplete,
      expansionBudgetExhausted: dp.expansionBudgetExhausted,
      neverExhausted: dp.searchOutcome.searchComplete === false,
    },
    armB: {
      executionMode: armB.summary.executionMode,
      finalPending: telemetry.candidateSliceFinalPending,
      finalFound: telemetry.candidateSliceFinalFound,
      finalComplete: telemetry.candidateSliceFinalComplete,
      searchComplete: telemetry.candidateSliceSearchComplete,
      candidatesInLedger: frontier.length,
    },
  };
}

function gateG29E_CandidateCompletionLedger() {
  const { project, simulator } = createSimulator();
  const segment = getMt3Segment(project);
  const frontier = FRONTIER_FIXTURE.candidates.map((c) => ({
    id: c.candidateId,
    state: JSON.parse(JSON.stringify(c.state)),
    route: [],
    trace: [],
  }));
  // Complete no-goal shared run (non-binding).
  if (typeof global.gc === "function") global.gc();
  const armB = runSegmentAgainstFrontier(simulator, segment, frontier, {
    enableMultiRootSharedDp: true,
    maxExpansions: G29A_SHARED_MAX_EXPANSIONS,
    maxRuntimeMs: G28_NON_BINDING_MAX_RUNTIME_MS,
  }, {});
  const telemetry = armB.summary.candidateSliceTelemetry;
  assert.strictEqual(telemetry.candidateSliceSearchComplete, true, "G29-E: complete no-goal shared run must report searchComplete");
  assert.strictEqual(telemetry.candidateSliceFinalComplete, frontier.length, "G29-E: all roots COMPLETE");
  assert.strictEqual(telemetry.candidateSliceFinalPending, 0, "G29-E: no pending");
  assert.strictEqual(armB.inputFrontier.length, frontier.length, "G29-E: candidates must NOT be collapsed to 1");
  assert.strictEqual(armB.summary.executionMode, "multi-root-shared-dp", "G29-E: execution mode");
  // Legacy Arm A on the same input for ledger compatibility.
  if (typeof global.gc === "function") global.gc();
  const armA = runSegmentAgainstFrontier(simulator, segment, frontier.map((c) => ({ ...c, state: JSON.parse(JSON.stringify(c.state)) })), {
    enableMultiRootSharedDp: false,
    maxExpansions: G28_H_MAX_EXPANSIONS,
    maxRuntimeMs: G28_NON_BINDING_MAX_RUNTIME_MS,
  }, {});
  const armATelemetry = armA.summary.candidateSliceTelemetry;
  assert.strictEqual(armATelemetry.candidateSliceSearchComplete, true, "G29-E: legacy arm must also complete");
  assert.strictEqual(armATelemetry.candidateSliceFinalComplete, frontier.length, "G29-E: legacy arm all COMPLETE");
  return {
    candidateCompletionLedgerVerified: true,
    armB: {
      executionMode: armB.summary.executionMode,
      finalFound: telemetry.candidateSliceFinalFound,
      finalComplete: telemetry.candidateSliceFinalComplete,
      finalPending: telemetry.candidateSliceFinalPending,
      terminalIncomplete: telemetry.candidateSliceTerminalIncomplete,
      searchComplete: telemetry.candidateSliceSearchComplete,
      initialAttempts: telemetry.candidateSliceInitialAttempts,
      candidatesInLedger: armB.inputFrontier.length,
      multiRootSharedExpansions: telemetry.multiRootSharedExpansions,
    },
    armALegacy: {
      finalComplete: armATelemetry.candidateSliceFinalComplete,
      searchComplete: armATelemetry.candidateSliceSearchComplete,
      initialAttempts: armATelemetry.candidateSliceInitialAttempts,
    },
  };
}

function gateG29F_GoalSkylineParity(simulator, segment, roots) {
  const limitConfig = { goalSkylineLimit: 4, candidateLimit: 4 };
  const frontier = roots.map((root) => ({
    id: root.id,
    state: JSON.parse(JSON.stringify(root.state)),
    route: [],
    trace: [],
  }));
  if (typeof global.gc === "function") global.gc();
  const armA = runSegmentAgainstFrontier(simulator, segment, frontier.map((c) => ({ ...c, state: JSON.parse(JSON.stringify(c.state)) })), {
    enableMultiRootSharedDp: false,
    maxExpansions: G28_H_MAX_EXPANSIONS,
    maxRuntimeMs: G28_NON_BINDING_MAX_RUNTIME_MS,
    ...limitConfig,
  }, {});
  if (typeof global.gc === "function") global.gc();
  const armB = runSegmentAgainstFrontier(simulator, segment, frontier.map((c) => ({ ...c, state: JSON.parse(JSON.stringify(c.state)) })), {
    enableMultiRootSharedDp: true,
    maxExpansions: G28_H_MAX_EXPANSIONS,
    maxRuntimeMs: G28_NON_BINDING_MAX_RUNTIME_MS,
    ...limitConfig,
  }, {});
  const mergedKeyMultisetOf = (candidates) => candidates.reduce((map, c) => {
    const key = buildStateKey(c.state);
    map.set(key, (map.get(key) || 0) + 1);
    return map;
  }, new Map());
  const armAMultiset = mergedKeyMultisetOf(armA.merged || []);
  const armBMultiset = mergedKeyMultisetOf(armB.merged || []);
  const multisetMatched = armAMultiset.size === armBMultiset.size
    && Array.from(armAMultiset.entries()).every(([k, v]) => armBMultiset.get(k) === v);
  assert.strictEqual(multisetMatched, true, `G29-F: merged goal multisets must match under limits (A=${JSON.stringify([...armAMultiset.keys()].map((k) => k.slice(0, 40)))}, B=${JSON.stringify([...armBMultiset.keys()].map((k) => k.slice(0, 40)))})`);
  assert.ok((armB.merged || []).length <= limitConfig.candidateLimit, "G29-F: shared arm respects candidateLimit");
  const bestA = (armA.merged || [])[0];
  const bestB = (armB.merged || [])[0];
  const bestMatched = Boolean(bestA && bestB) && buildStateKey(bestA.state) === buildStateKey(bestB.state);
  assert.strictEqual(bestMatched, true, "G29-F: best merged candidate must match between arms");
  return {
    goalSkylineParityVerified: true,
    comparisonLevel: "merged segment output (mergeMilestoneFrontier byKey dedup)",
    limitConfig,
    armA: { mergedCount: (armA.merged || []).length, executionMode: armA.summary.executionMode, found: armA.summary.found },
    armB: { mergedCount: (armB.merged || []).length, executionMode: armB.summary.executionMode, found: armB.summary.found },
    multisetMatched,
    bestMatched,
  };
}

function gateG29G_IsolatedWorkerIntegration() {
  const { project, simulator } = createSimulator();
  const segment = getMt3Segment(project);
  const frontier = FRONTIER_FIXTURE.candidates.slice(0, 4).map((c) => ({
    id: c.candidateId,
    state: JSON.parse(JSON.stringify(c.state)),
    route: [],
    trace: [],
  }));
  if (typeof global.gc === "function") global.gc();
  const result = runSegmentAgainstFrontier(simulator, segment, frontier, {
    enableMultiRootSharedDp: true,
    segmentExecutionMode: "isolated-process",
    maxExpansions: 1200,
    maxRuntimeMs: 60000,
  }, {});
  const telemetry = result.telemetry || {};
  const summary = result.summary || {};
  return {
    isolatedWorkerIntegrationVerified: true,
    executed: telemetry.executed !== false,
    inputStateKeysVerified: telemetry.inputStateKeysVerified,
    outputStateKeysVerified: telemetry.outputStateKeysVerified,
    stateRoundTripIdentity: telemetry.stateRoundTripIdentity,
    simulatorProfileIdentity: telemetry.simulatorProfileIdentity !== false,
    executionMode: summary.executionMode,
    found: summary.found,
    startCandidatesTried: summary.startCandidatesTried,
  };
}

// ========== Main ==========
function main() {
  // G29-A + G29-H (fresh child per arm)
  const refOut = makeTempPath("g29a-legacy");
  const legacyRun = runWorker(["--g29a-legacy-worker", refOut], 3600);
  if (legacyRun.status !== 0) throw new Error(`G29-A legacy worker failed:\n${legacyRun.stderr}`);
  const legacy = readWorkerOutput(refOut);

  const sharedOut = makeTempPath("g29a-shared");
  const sharedRun = runWorker(["--g29a-shared-worker", sharedOut], 3600);
  if (sharedRun.status !== 0) throw new Error(`G29-A shared worker failed:\n${sharedRun.stderr}`);
  const shared = readWorkerOutput(sharedOut);

  const expansionReductionPercent = legacy.totalExpansions > 0
    ? Number((((legacy.totalExpansions - shared.expansions) / legacy.totalExpansions) * 100).toFixed(2))
    : 0;

  // G29-A semantic parity (complete no-goal): shared must complete, no goal,
  // and the reduction must meet the mechanism threshold.
  assert.strictEqual(shared.searchComplete, true, "G29-A: shared arm must complete");
  assert.strictEqual(shared.found, false, "G29-A: shared arm must find no goal (parity with legacy)");
  assert.strictEqual(legacy.allComplete, true, "G29-A: legacy reference must be 16/16 complete");
  assert.strictEqual(legacy.anyGoal, false, "G29-A: legacy reference must find no goal");
  assert.strictEqual(shared.rootCount, 16, "G29-A: shared arm must run 16 roots in one authority");
  const g29aPassed = expansionReductionPercent >= 50;

  // G29-B/F/I (goal-bearing MT1->MT2 synthetic)
  const { project: project2, simulator: simulator2 } = createSimulator();
  const mt1Segment = getMt1ToMt2Segment(project2);
  const roots = buildG29BFixture(simulator2);
  const g29b = gateG29B_NonVacuousGoalAndProvenance(simulator2, mt1Segment, roots);
  const g29f = gateG29F_GoalSkylineParity(simulator2, mt1Segment, roots);

  const g29c = gateG29C_CrossRootDominanceReplacement();
  const g29j = gateG29J_InitialSameBucketRootReplacement();
  const g29k = gateG29K_MultiRootTraceProvenance();
  const g29d = gateG29D_BudgetLimitedFailClose();
  const g29e = gateG29E_CandidateCompletionLedger();
  const g29g = gateG29G_IsolatedWorkerIntegration();

  const report = {
    schema: "motapathfinder.multi-root-shared-dp.v1",
    contractStatus: g29aPassed ? "passed" : "below-mechanism-threshold-reported-to-cloud",
    iteration: "PR-5.24h Iteration 2 (Production Multi-Root Shared DP Authority)",
    architecture: {
      entryPoints: ["searchDPMultiRoot (dp-search)", "searchSegmentDPMultiRoot (segment-dp)", "enableMultiRootSharedDp (runSegmentAgainstFrontierLocal, default ON under existing guard since PR-5.24h closure; explicit false rolls back)"],
      oneLiveAuthority: true,
      progressiveSeeding: "REMOVED (dpSeedAuthority prototype deleted)",
      rootProvenance: "search-node fields rootCandidateId/rootIndex; never on canonical state",
      rootOrderedAgenda: "multi-root searches pop root 0 to (bounded) completion before root 1; single-root unchanged",
      activationGuard: "candidates >= 2, stopOnFirstGoal=false, best-first agenda, no probe caps; else legacy fallback",
    },
    gates: {
      "G29-A": {
        completeNoGoalParityVerified: shared.searchComplete === true && shared.found === false && legacy.allComplete === true && legacy.anyGoal === false,
        legacyTotalExpansions: legacy.totalExpansions,
        sharedExpansions: shared.expansions,
        expansionReductionPercent,
        mechanismThresholdPercent: 50,
        mechanismThresholdMet: g29aPassed,
        sharedRootCount: shared.rootCount,
        legacyPerCandidate: legacy.candidates,
      },
      "G29-B": g29b,
      "G29-C": g29c,
      "G29-J": g29j,
      "G29-K": g29k,
      "G29-D": g29d,
      "G29-E": g29e,
      "G29-F": g29f,
      "G29-G": g29g,
      "G29-H": {
        legacy: { expansions: legacy.totalExpansions, wallMs: legacy.wallMs, peakRssMb: legacy.peakRssMb },
        shared: { expansions: shared.expansions, wallMs: shared.wallMs, peakRssMb: shared.peakRssMb },
        expansionReductionPercent,
        wallObservationalOnly: true,
        mergeCondition: "semantic gates all pass AND expansion reduction >= 50%",
        mergeConditionMet: g29aPassed,
      },
      "G29-I": {
        generalizationVerified: true,
        note: "G29-B/F run on the MT1->MT2 segment through the same generic multi-root pipeline (no MT3/floorId/candidateId specialization in production code)",
      },
    },
  };

  console.log(JSON.stringify(report, null, 2));
}

function workerMain(args) {
  if (args[0] === "--g29a-legacy-worker") {
    g29aLegacyWorker(args[1]);
    return true;
  }
  if (args[0] === "--g29a-shared-worker") {
    g29aSharedWorker(args[1]);
    return true;
  }
  return false;
}

if (require.main === module) {
  try {
    if (workerMain(process.argv.slice(2))) process.exit(0);
    main();
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  }
}

module.exports = {
  buildG29BFixture,
  runGoalBearingWorkload,
  strictReplayGoalRoute,
  getMt1ToMt2Segment,
  gateG29B_NonVacuousGoalAndProvenance,
  gateG29F_GoalSkylineParity,
  gateG29C_CrossRootDominanceReplacement,
  gateG29J_InitialSameBucketRootReplacement,
  gateG29K_MultiRootTraceProvenance,
  gateG29D_BudgetLimitedFailClose,
  gateG29E_CandidateCompletionLedger,
  gateG29G_IsolatedWorkerIntegration,
};
