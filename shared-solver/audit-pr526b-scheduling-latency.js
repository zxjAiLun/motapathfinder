"use strict";
/**
 * PR-5.26b Repair 1 - CP9 Registration-Time Queue Attribution.
 *
 * PURE DIAGNOSTIC. SEARCH_POLICY_CHANGE = NONE, CAP_CHANGE = NONE,
 * BUDGET_CHANGE = NONE. Same fixed workload as PR-5.26b (MAX_EXPANSIONS = 8000,
 * MAX_RUNTIME_MS = 0, cap 1024, dynamic Pareto ON) plus enqueue-time telemetry.
 *
 * WHY THIS REPAIR EXISTS
 * ----------------------
 * PR-5.26b's classifier inferred "cp#9 was registered early enough that this is
 * not a late-generation problem" by projecting the END-OF-RUN backlog (300) at
 * the WHOLE-RUN average neutral service rate (0.2905) and subtracting from
 * 8000. That answers "how much longer would the residual queue take to drain
 * from expansion 8000?" - it does NOT answer "was cp#9 registered early enough
 * when it entered at 5958?". The missing quantities were the queue state and the
 * service counters AT REGISTRATION. Owner review therefore retired the cut:
 *
 *   LATE_GENERATION_CUT_6967 = RETRACT_AS_CLASSIFICATION_BOUNDARY
 *   S_B_NEUTRAL_SCHEDULING_LATENCY = PLAUSIBLE, NOT_ESTABLISHED_BY_CURRENT_CUT
 *
 * So this script asserts no S-A/S-B verdict. It reports the registration-time
 * facts, the wait-window service counts, the window-local drain rate, and the
 * composition of what was actually ahead of cp#9 at both ends. What that implies
 * for the scheduler is a separate, owner-made decision.
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
// breakpoint (PR-5.25y). This is a prop, not oracle knowledge injected into the
// search.
const CP9_DECISION_INDEX = 9;

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

/** Composition of the live pending candidates strictly ahead of a queue index. */
function compositionOf(nodes, aheadOfIndexFromHead) {
  const byRank = { 0: 0, 10: 0, 20: 0, 30: 0 };
  let guidedAdmitted = 0;
  let combatProgress = 0;
  let total = 0;
  for (const node of nodes) {
    if (node.neutralQueueIndexFromHead == null) continue;
    if (node.neutralQueueIndexFromHead >= aheadOfIndexFromHead) continue;
    total += 1;
    byRank[node.rankClass] = (byRank[node.rankClass] || 0) + 1;
    if (node.guidedAdmitted === true) guidedAdmitted += 1;
    if (node.combatProgress === true) combatProgress += 1;
  }
  return { total, byRank, guidedAdmitted, combatProgress };
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
    emitEnqueueTelemetry: true,
    emitPendingSnapshot: true,
    onCandidateLifecycle: (event) => {
      if (event.exactKey === cp9.postKey) events.push(event);
      return null;
    },
  });

  const snapshot = result.pendingSnapshot;
  const types = new Set(events.map((e) => e.type));
  const enqueued = [...events].reverse().find((e) => e.type === "enqueued") || null;
  const registered = [...events].reverse().find((e) => e.type === "registered") || null;
  const classified = [...events].reverse().find((e) => e.type === "classified") || null;
  const inSnapshot = snapshot ? snapshot.nodes.find((n) => n.exactKey === cp9.postKey) || null : null;

  const stage = classifyStage(events);
  const stillPending = Boolean(inSnapshot);
  const registeredAt = registered ? registered.registeredAtStrategicExpansion : null;
  const waited = registeredAt == null ? null : FROZEN.maxExpansions - registeredAt;

  // --- Registration-time facts (the quantity PR-5.26b was missing) ---
  const aheadAtRegistration = enqueued ? enqueued.liveNeutralAheadAtEnqueue : null;
  const aheadAtEnd = inSnapshot ? inSnapshot.neutralQueueLiveAhead : null;
  const neutralExpansionsDuringWait = enqueued ? snapshot.neutralExpansions - enqueued.neutralExpansionsAtEnqueue : null;
  const guidedExpansionsDuringWait = enqueued ? snapshot.guidedExpansions - enqueued.guidedExpansionsAtEnqueue : null;
  const aheadRemoved = aheadAtRegistration == null || aheadAtEnd == null ? null : aheadAtRegistration - aheadAtEnd;
  // Window-local drain: how the queue ahead of cp#9 actually drained DURING ITS
  // OWN WAIT, not the whole-run average.
  const observedDrainPerExpansion = aheadRemoved == null || !waited ? null : aheadRemoved / waited;

  const wholeRunNeutralRate = result.strategicExpansions > 0
    ? snapshot.neutralExpansions / result.strategicExpansions
    : 0;
  const endProjectedDrain = aheadAtEnd == null || wholeRunNeutralRate <= 0 ? null : aheadAtEnd / wholeRunNeutralRate;

  const endComposition = inSnapshot
    ? compositionOf(snapshot.nodes, inSnapshot.neutralQueueIndexFromHead)
    : null;

  // Mechanical labels. Deliberately no S-A/S-B verdict and no arbitary "deep"
  // threshold: "deep" is not asserted, only measured.
  const labels = {
    CP9_REGISTERED_WITH_BACKLOG: aheadAtRegistration != null && aheadAtRegistration > 0,
    CP9_BACKLOG_DRAINED_PARTIALLY: aheadRemoved != null && aheadRemoved > 0 && aheadAtEnd > 0,
    CP9_BACKLOG_DRAINED_FULLY: aheadAtEnd === 0,
    CP9_STILL_AHEAD_AT_END: aheadAtEnd != null && aheadAtEnd > 0,
    CP9_LATE_GENERATION: "NOT_YET_ISOLATED",
  };

  const summary = {
    milestone: "PR-5.26b",
    repair: "REPAIR_1_CP9_REGISTRATION_TIME_QUEUE_ATTRIBUTION",
    searchPolicyChange: "NONE",
    oracleUse: "POST_HOC_LOOKUP_ONLY",
    oracleKeysAffectSearchDecisions: false,
    frozen: FROZEN,
    retractedFromPr526b: {
      LATE_GENERATION_CUT_6967: "RETRACT_AS_CLASSIFICATION_BOUNDARY",
      S_B_NEUTRAL_SCHEDULING_LATENCY: "PLAUSIBLE_NOT_ESTABLISHED_BY_CURRENT_CUT",
      why: "the cut projected the END-OF-RUN backlog at the WHOLE-RUN average service rate; it cannot show that cp#9 was registered early enough",
    },
    cp9: {
      decisionIndex: cp9.decisionIndex,
      summary: cp9.summary,
      postKey: cp9.postKey,
      postHp: cp9.postHp,
      generated: types.has("strategicGenerated"),
      duplicateSkipped: types.has("duplicateSkipped"),
      registered: types.has("registered"),
      enqueued: types.has("enqueued"),
      dropped: types.has("dropped"),
      expanded: types.has("expanded"),
      survivalStage: stage,
      alsoSeenAsDuplicateVariant: types.has("duplicateSkipped") && types.has("registered"),
      nodeId: registered ? registered.nodeId : null,
      pendingSeq: registered ? registered.pendingSeq : null,
      registeredAtExpansion: registeredAt,
      registeredAtExpansionOf: FROZEN.maxExpansions,
      waitedExpansions: waited,
      stillPendingAtEnd: stillPending,
      guidedAdmitted: classified ? classified.guidedAdmitted === true : null,
      guidedAdmittedSource: "classified event (final); at enqueue time guidedAdmitted is still false for every child",
      rankClassBeforeGuidedAdmission: enqueued ? enqueued.rankClassBeforeGuidedAdmission : null,
    },
    registrationQueue: enqueued ? {
      liveNeutralAheadAtEnqueue: enqueued.liveNeutralAheadAtEnqueue,
      liveAheadByRank: enqueued.liveAheadByRank,
      liveAheadGuidedAdmitted: enqueued.liveAheadGuidedAdmitted,
      liveAheadCombatProgress: enqueued.liveAheadCombatProgress,
      neutralHeadAtEnqueue: enqueued.neutralHeadAtEnqueue,
      neutralQueueAbsoluteIndexAtEnqueue: enqueued.neutralQueueAbsoluteIndexAtEnqueue,
      guidedExpansionsAtEnqueue: enqueued.guidedExpansionsAtEnqueue,
      neutralExpansionsAtEnqueue: enqueued.neutralExpansionsAtEnqueue,
      strategicExpansionsAtEnqueue: enqueued.strategicExpansionsAtEnqueue,
      rank20ParetoDominatedAtEnqueue: undefined,
      rank20ParetoDominatedAtEnqueueNote: "NOT_RECORDED - no trim has classified the group at enqueue time; any value would be fabricated",
    } : null,
    wait: {
      CP9_AHEAD_AT_REGISTRATION: aheadAtRegistration,
      CP9_AHEAD_AT_END: aheadAtEnd,
      AHEAD_REMOVED_DURING_WAIT: aheadRemoved,
      NEUTRAL_EXPANSIONS_DURING_WAIT: neutralExpansionsDuringWait,
      GUIDED_EXPANSIONS_DURING_WAIT: guidedExpansionsDuringWait,
      OBSERVED_AHEAD_DRAIN_PER_STRATEGIC_EXPANSION: observedDrainPerExpansion,
      END_SNAPSHOT_PROJECTED_DRAIN_AT_WHOLE_RUN_AVERAGE_SERVICE_RATE: endProjectedDrain,
      wholeRunNeutralServiceRate: wholeRunNeutralRate,
    },
    endAheadComposition: endComposition,
    labels,
    queue: {
      guidedExpansions: snapshot.guidedExpansions,
      neutralExpansions: snapshot.neutralExpansions,
      neutralHead: snapshot.neutralHead,
      neutralQueueLength: snapshot.neutralQueueLength,
      livePendingTotal: snapshot.livePendingTotal,
      liveNeutralPending: snapshot.liveNeutralPending,
      guidedHeapLiveCount: snapshot.guidedHeapLiveCount,
      pendingCapacityHint: snapshot.pendingCapacityHint,
      pendingMirrorConsistent: snapshot.pendingMirrorConsistent,
    },
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
    pendingSnapshot: snapshot,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`);

  const n = (v, d = 1) => (v == null ? "n/a" : Number(v).toFixed(d));
  console.log("PR-5.26b Repair 1 - cp#9 registration-time queue attribution");
  console.log(`  cp#9 (${cp9.summary})`);
  console.log(`  search: found=${result.found} exp=${result.strategicExpansions} dropped=${result.candidatesDropped} ` +
    `deepest=${result.deepestReachedFloorOrdinal} stopped=${result.stoppedReason}`);
  console.log(`  CP9_SURVIVAL_STAGE = ${stage}`);
  console.log(`  CP9_REGISTERED_AT_EXPANSION = ${registeredAt}_OF_${FROZEN.maxExpansions}`);
  console.log(`  CP9_LATE_GENERATION = ${labels.CP9_LATE_GENERATION}`);
  console.log(`  CP9_GUIDED_ADMITTED = ${summary.cp9.guidedAdmitted}`);
  console.log("  --- registration-time queue (the missing quantity) ---");
  if (enqueued) {
    console.log(`  CP9_AHEAD_AT_REGISTRATION = ${aheadAtRegistration}`);
    console.log(`  AHEAD_BY_RANK_AT_REGISTRATION = ${JSON.stringify(enqueued.liveAheadByRank)}`);
    console.log(`  AHEAD_GUIDED_ADMITTED_AT_REGISTRATION = ${enqueued.liveAheadGuidedAdmitted} ` +
      `AHEAD_COMBAT_PROGRESS_AT_REGISTRATION = ${enqueued.liveAheadCombatProgress}`);
    console.log(`  neutralHeadAtEnqueue=${enqueued.neutralHeadAtEnqueue} ` +
      `absoluteIndex=${enqueued.neutralQueueAbsoluteIndexAtEnqueue} ` +
      `guidedExpansions=${enqueued.guidedExpansionsAtEnqueue} neutralExpansions=${enqueued.neutralExpansionsAtEnqueue}`);
  } else {
    console.log("  CP9_AHEAD_AT_REGISTRATION = n/a (no enqueued event observed)");
  }
  console.log("  --- wait window ---");
  console.log(`  CP9_AHEAD_AT_END = ${aheadAtEnd}`);
  console.log(`  AHEAD_REMOVED_DURING_WAIT = ${aheadRemoved}`);
  console.log(`  NEUTRAL_EXPANSIONS_DURING_WAIT = ${neutralExpansionsDuringWait} ` +
    `GUIDED_EXPANSIONS_DURING_WAIT = ${guidedExpansionsDuringWait}`);
  console.log(`  OBSERVED_AHEAD_DRAIN_PER_STRATEGIC_EXPANSION = ${n(observedDrainPerExpansion, 5)} ` +
    `(whole-run neutral rate = ${n(wholeRunNeutralRate, 4)})`);
  console.log(`  END_SNAPSHOT_PROJECTED_DRAIN_AT_WHOLE_RUN_AVERAGE_SERVICE_RATE = ${n(endProjectedDrain)}`);
  console.log("  --- end-snapshot composition of the live candidates ahead ---");
  if (endComposition) {
    console.log(`  END_AHEAD_TOTAL = ${endComposition.total}`);
    console.log(`  END_AHEAD_BY_RANK = ${JSON.stringify(endComposition.byRank)}`);
    console.log(`  END_AHEAD_GUIDED_ADMITTED = ${endComposition.guidedAdmitted} ` +
      `END_AHEAD_COMBAT_PROGRESS = ${endComposition.combatProgress}`);
  }
  console.log(`  queue: livePendingTotal=${snapshot.livePendingTotal}/${snapshot.pendingCapacityHint} ` +
    `liveNeutralPending=${snapshot.liveNeutralPending} guidedHeapLiveCount=${snapshot.guidedHeapLiveCount} ` +
    `pendingMirrorConsistent=${snapshot.pendingMirrorConsistent}`);
  console.log(`  labels: ${JSON.stringify(labels)}`);
  console.log(`  artifact: ${path.relative(process.cwd(), outPath)}`);
}

main();
