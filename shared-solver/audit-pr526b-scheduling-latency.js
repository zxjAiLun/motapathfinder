"use strict";
/**
 * PR-5.26b - Retained Candidate Scheduling Latency Audit.
 *
 * PURE DIAGNOSTIC. SEARCH_POLICY_CHANGE = NONE, CAP_CHANGE = NONE,
 * BUDGET_CHANGE = NONE. The single difference from the frozen MT4
 * configuration is that the run is fixed-work (MAX_EXPANSIONS = 8000,
 * MAX_RUNTIME_MS = 0) instead of wall-limited, because PR-5.26a already
 * established cp#9's retention fate deterministically at exactly this workload.
 *
 * WHY THIS EXISTS
 * ---------------
 * After PR-5.26a, cp#9's exact state is registered and retained at equal fixed
 * work - it is no longer the cap-drop victim - but it is still never expanded.
 * The surviving question is not "was it covered?" (it was: the canonical node
 * exists) but "why did a retained, causally-important node never get a neutral
 * expansion slot within the budget?".
 *
 * PHASE 1 (no search): replay the tracked MT4 oracle to regenerate cp#9's exact
 * state key with the current buildStateKey().
 *
 * PHASE 2: one fixed-work run with emitPendingSnapshot, recording for cp#9:
 *   registeredAtExpansion, nodeId, pendingSeq, dropped, expanded,
 *   stillPendingAtEnd, neutral queue position, guided admission.
 *
 * CLASSIFICATION is mechanical and the raw metrics are always reported, so a
 * reader can re-derive the verdict:
 *   SURVIVED                        - expanded within budget
 *   S_E_DROPPED                     - regression: 5.26a should prevent this
 *   S_A_LATE_GENERATION             - registered too late to ever be reached:
 *                                     the remaining backlog could not drain in
 *                                     the expansions that were left. Cut point =
 *                                     maxExpansions - liveAhead/serviceRate.
 *   S_C_AT_HEAD_BUT_UNSERVED        - sat at/near the neutral head and was still
 *                                     not served: bookkeeping/lifecycle problem
 *   S_B_NEUTRAL_SCHEDULING_LATENCY  - registered early enough that it is not a
 *                                     late-generation problem, yet a live backlog
 *                                     still stood ahead of it when the budget ended
 *
 * Uses ONLY the oracle's cp#9 exact key for post-hoc lookup. Oracle keys never
 * enter the search: ORACLE_KEYS_AFFECT_SEARCH_DECISIONS = FALSE.
 */

const fs = require("fs");
const path = require("path");

const { loadProject } = require("./lib/project-loader");
const { StaticSimulator } = require("./lib/simulator");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { createTransportCollapsedSearch } = require("./lib/transport-collapse");
const { buildDependencyFrontier } = require("./lib/dependency-frontier");
const { resolveRecordedAction } = require("./lib/route-store");
const { buildStateKey } = require("./lib/state-key");
const { classifyStage } = require("./audit-pr525t-oracle-survival");

const PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const ORACLE_FIXTURE = path.resolve(__dirname, "routes", "fixtures", "mt1-mt4-hp6428-best.route.json");
const DEFAULT_OUT = path.resolve(__dirname, "routes", "generated", "pr526b-scheduling-latency.json");

const FROZEN = {
  initialRank: "chaos",
  region: ["MT1", "MT2", "MT3", "MT4"],
  goalFloorId: "MT4",
  maxExpansions: 8000,
  maxRuntimeMs: 0,
  maxRssMb: 2048,
  pendingCandidateCap: 1024,
  rank20DynamicPareto: true,
};

// cp#9 in the tracked fixture is 0-indexed decision 9
// (battle:redBat@MT1:10,1); its post-state is the prefix's first known causal
// breakpoint (PR-5.25y). CP9_DECISION_INDEX is a prop, not oracle knowledge
// injected into the search.
const CP9_DECISION_INDEX = 9;
const NEAR_HEAD_TOLERANCE = 2;

function makeSimulator(project) {
  return new StaticSimulator(project, {
    stopFloorId: "MT11",
    battleResolver: new FunctionBackedBattleResolver(project),
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    searchGraphMode: "primitive",
    walkReachabilityMode: "safe-fast",
  });
}

/** Phase 1: replay the tracked oracle and capture the cp#9 post-state exact key. */
function buildCp9Key(simulator) {
  const record = JSON.parse(fs.readFileSync(ORACLE_FIXTURE, "utf8"));
  const decisions = Array.isArray(record.decisions) ? record.decisions : [];
  if (decisions.length === 0) throw new Error("oracle fixture has no decisions");
  if (CP9_DECISION_INDEX >= decisions.length) throw new Error("oracle fixture is shorter than cp#9");

  let state = simulator.createInitialState({ rank: FROZEN.initialRank });
  if (state.floorId !== "MT1") throw new Error("canonical CHAOS initial state is not on MT1");

  let preKey = null;
  for (let i = 0; i <= CP9_DECISION_INDEX; i += 1) {
    if (i === CP9_DECISION_INDEX) preKey = buildStateKey(state);
    const actions = (simulator.enumeratePrimitiveActions(state) || {}).actions || [];
    const resolved = resolveRecordedAction(simulator, state, {
      ...decisions[i],
      postExactStateKey: decisions[i].postStateKey || decisions[i].postExactStateKey || null,
    }, { candidates: actions });
    if (!resolved || !resolved.action) {
      throw new Error(`oracle replay failed at decision ${i} (${decisions[i].summary}): ${resolved && resolved.reason}`);
    }
    state = simulator.applyAction(state, resolved.action, { storeRoute: true });
    if (!state || !state.hero || state.hero.hp <= 0) throw new Error(`oracle replay died at decision ${i}`);
  }
  return {
    decisionIndex: CP9_DECISION_INDEX,
    summary: decisions[CP9_DECISION_INDEX].summary || null,
    preKey,
    postKey: buildStateKey(state),
    postHp: state.hero ? state.hero.hp : null,
    postFloorId: state.floorId,
  };
}

function main() {
  const outPath = (() => {
    const arg = process.argv.slice(2).find((t) => t.startsWith("--out="));
    return arg ? path.resolve(arg.slice("--out=".length)) : DEFAULT_OUT;
  })();

  const project = loadProject(PROJECT_ROOT);
  const simulator = makeSimulator(project);

  const cp9 = buildCp9Key(simulator);

  const initial = simulator.createInitialState({ rank: FROZEN.initialRank });
  const frontier = buildDependencyFrontier(project, initial, {
    type: "floorReached",
    floorId: FROZEN.goalFloorId,
  });

  const events = [];
  const result = createTransportCollapsedSearch(simulator).search(initial, {
    isGoalState: (state) => state.floorId === FROZEN.goalFloorId,
    allowedFloors: FROZEN.region,
    maxExpansions: FROZEN.maxExpansions,
    maxRuntimeMs: FROZEN.maxRuntimeMs,
    maxRssMb: FROZEN.maxRssMb,
    frontierSet: frontier.frontierSet,
    resourceSkylinePriority: true,
    pendingCandidateCap: FROZEN.pendingCandidateCap,
    rank20DynamicPareto: FROZEN.rank20DynamicPareto,
    emitPendingSnapshot: true,
    onCandidateLifecycle: (event) => {
      if (event.exactKey === cp9.postKey) events.push(event);
      return null;
    },
  });

  const snapshot = result.pendingSnapshot;
  const types = new Set(events.map((e) => e.type));
  const registered = [...events].reverse().find((e) => e.type === "registered") || null;
  const inSnapshot = snapshot ? snapshot.nodes.find((n) => n.exactKey === cp9.postKey) || null : null;

  const stage = classifyStage(events);
  const stillPending = Boolean(inSnapshot);
  const registeredAt = registered ? registered.registeredAtStrategicExpansion : null;
  const waited = registeredAt == null ? null : FROZEN.maxExpansions - registeredAt;

  const neutralServiceRate = result.strategicExpansions > 0
    ? snapshot.neutralExpansions / result.strategicExpansions
    : 0;
  const liveAhead = inSnapshot ? inSnapshot.neutralQueueLiveAhead : null;
  // Expansions the neutral lane still needed to clear the backlog that remained
  // ahead of cp#9 at the moment the budget ended.
  const drainRemaining = liveAhead == null || neutralServiceRate <= 0 ? null : liveAhead / neutralServiceRate;
  // Registering after this expansion means the run could never have reached the
  // node even if the lane had dedicated every remaining slot to draining ahead.
  const lateGenerationCut = drainRemaining == null ? null : FROZEN.maxExpansions - drainRemaining;
  const nearHead = liveAhead != null && liveAhead <= NEAR_HEAD_TOLERANCE;

  let verdict;
  if (types.has("expanded")) verdict = "SURVIVED";
  else if (types.has("dropped")) verdict = "S_E_DROPPED";
  else if (!stillPending) verdict = "S_UNKNOWN_NOT_IN_PENDING_SNAPSHOT";
  else if (nearHead && waited != null && waited <= NEAR_HEAD_TOLERANCE) verdict = "S_A_LATE_GENERATION";
  else if (lateGenerationCut != null && registeredAt != null && registeredAt >= lateGenerationCut) verdict = "S_A_LATE_GENERATION";
  else if (nearHead) verdict = "S_C_AT_HEAD_BUT_UNSERVED";
  else verdict = "S_B_NEUTRAL_SCHEDULING_LATENCY";

  const summary = {
    milestone: "PR-5.26b",
    audit: "RETAINED_CANDIDATE_SCHEDULING_LATENCY",
    searchPolicyChange: "NONE",
    oracleUse: "POST_HOC_LOOKUP_ONLY",
    oracleKeysAffectSearchDecisions: false,
    frozen: FROZEN,
    cp9: {
      decisionIndex: cp9.decisionIndex,
      summary: cp9.summary,
      postKey: cp9.postKey,
      postHp: cp9.postHp,
      postFloorId: cp9.postFloorId,
      generated: types.has("strategicGenerated"),
      duplicateSkipped: types.has("duplicateSkipped"),
      registered: types.has("registered"),
      dropped: types.has("dropped"),
      expanded: types.has("expanded"),
      survivalStage: stage,
      alsoSeenAsDuplicateVariant: types.has("duplicateSkipped") && types.has("registered"),
      nodeId: registered ? registered.nodeId : null,
      pendingSeq: registered ? registered.pendingSeq : null,
      registeredAtExpansion: registeredAt,
      waitedExpansions: waited,
      stillPendingAtEnd: stillPending,
      guidedAdmitted: registered && registered.guidedAdmitted ? true : (inSnapshot ? inSnapshot.guidedAdmitted : null),
      rankClass: inSnapshot ? inSnapshot.rankClass : null,
      combatProgress: inSnapshot ? inSnapshot.combatProgress : null,
      neutralQueueAbsoluteIndex: inSnapshot ? inSnapshot.neutralQueueAbsoluteIndex : null,
      neutralQueueIndexFromHead: inSnapshot ? inSnapshot.neutralQueueIndexFromHead : null,
      neutralQueueDistanceFromHead: liveAhead,
    },
    queue: runtimeQueueSummary(snapshot, neutralServiceRate, drainRemaining),
    search: {
      found: result.found,
      strategicExpansions: result.strategicExpansions,
      candidatesDropped: result.candidatesDropped,
      deepestReachedFloorOrdinal: result.deepestReachedFloorOrdinal,
      deepestStrategicDepth: result.deepestStrategicDepth,
      stoppedReason: result.stoppedReason,
      rank20ParetoRescuedTotal: result.rank20ParetoRescuedTotal,
      rank20ParetoChangedTrims: result.rank20ParetoChangedTrims,
    },
    verdict,
    verdictBasis: {
      neutralServiceRate,
      drainRemainingExpansions: drainRemaining,
      lateGenerationCutExpansion: lateGenerationCut,
      nearHeadToleranceExpansions: NEAR_HEAD_TOLERANCE,
      note: "S_B means: registered before the late-generation cut, yet a live backlog still stood ahead of it at budget end.",
    },
    pendingSnapshot: snapshot,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`);

  console.log("PR-5.26b retained candidate scheduling latency audit");
  console.log(`  cp#9 (${cp9.summary}) postKey=${cp9.postKey}`);
  console.log(`  search: found=${result.found} exp=${result.strategicExpansions} dropped=${result.candidatesDropped} ` +
    `deepest=${result.deepestReachedFloorOrdinal} stopped=${result.stoppedReason}`);
  console.log(`  CP9: generated=${summary.cp9.generated} duplicateSkipped=${summary.cp9.duplicateSkipped} ` +
    `registered=${summary.cp9.registered} dropped=${summary.cp9.dropped} expanded=${summary.cp9.expanded}`);
  console.log(`  CP9_SURVIVAL_STAGE = ${stage}`);
  console.log(`  CP9_REGISTERED_AT_EXPANSION = ${registeredAt}`);
  console.log(`  CP9_WAITED_EXPANSIONS = ${waited}`);
  console.log(`  CP9_STILL_PENDING_AT_END = ${stillPending}`);
  console.log(`  CP9_NEUTRAL_DISTANCE_FROM_HEAD = ${liveAhead}`);
  console.log(`  CP9_GUIDED_ADMITTED = ${summary.cp9.guidedAdmitted}`);
  console.log(`  queue: guidedExpansions=${snapshot.guidedExpansions} neutralExpansions=${snapshot.neutralExpansions} ` +
    `neutralHead=${snapshot.neutralHead} liveNeutralPending=${snapshot.liveNeutralPending} ` +
    `guidedHeapLiveCount=${snapshot.guidedHeapLiveCount}`);
  console.log(`  neutralServiceRate=${neutralServiceRate.toFixed(4)} drainRemainingExpansions=${drainRemaining == null ? "n/a" : drainRemaining.toFixed(1)} lateGenerationCutExpansion=${lateGenerationCut == null ? "n/a" : lateGenerationCut.toFixed(0)}`);
  console.log(`  VERDICT = ${verdict}`);
  console.log(`  artifact: ${path.relative(process.cwd(), outPath)}`);
}

function runtimeQueueSummary(snapshot, neutralServiceRate, drainRemaining) {
  const byRank = {};
  const byKind = {};
  for (const node of snapshot.nodes) {
    byRank[node.rankClass] = (byRank[node.rankClass] || 0) + 1;
    if (node.rankClass === 20) {
      const key = node.combatProgress ? "combatProgress" : "other";
      byKind[key] = (byKind[key] || 0) + 1;
    }
  }
  return {
    guidedExpansions: snapshot.guidedExpansions,
    neutralExpansions: snapshot.neutralExpansions,
    neutralHead: snapshot.neutralHead,
    neutralQueueLength: snapshot.neutralQueueLength,
    livePendingTotal: snapshot.livePendingTotal,
    liveNeutralPending: snapshot.liveNeutralPending,
    guidedHeapLiveCount: snapshot.guidedHeapLiveCount,
    pendingByRankClass: byRank,
    neutralServiceRate,
    drainRemainingExpansions: drainRemaining,
    pendingPoolSaturated: snapshot.livePendingTotal >= snapshot.pendingCapacityHint,
  };
}

main();
