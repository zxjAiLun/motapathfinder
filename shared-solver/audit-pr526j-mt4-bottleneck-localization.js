"use strict";
/**
 * PR-5.26j - MT4 long-horizon bottleneck localization.
 *
 * SEARCH_POLICY_CHANGE = NONE. This round does not design a mechanism; it
 * localizes where the tracked successful MT4 trajectory dies under the healthiest
 * current configuration (`stableGuidedTieBreak` OFF, retro demotion OFF, dynamic
 * Pareto + neutral substitution ON, reclaimDroppedState ON, cap 1024), so the
 * next round can choose ONE mechanism direction instead of guessing.
 *
 * Phase 1 (static, no search): classify every strategic decision of the tracked
 * oracle route with three *generic* attributes only -
 *   FRONTIER_ELIGIBLE   identity is in the autonomous frontierSet
 *   COMBAT_PROGRESS     the generic pre->post state delta the search itself uses
 *   ORDINARY_NEUTRAL    neither
 * The name is FRONTIER_ELIGIBLE, deliberately not RANK10: real `guidedAdmitted`
 * also depends on runtime skyline history, so this is an upper bound on rank 10.
 * It answers one cheap question: how many strategic steps of a known successful
 * route are invisible to both the frontier and combat-progress classification?
 *
 * Phase 2 (fixed work): one 20000-expansion run, `MAX_RUNTIME_MS = 0`, RSS 2048MB,
 * with a read-only observer that post-hoc filters oracle exact keys and maintains
 * a 55-row fate table. It answers where the prefix actually dies and in which
 * class.
 *
 * The observer never influences the search (ORACLE_KEYS_AFFECT_SEARCH_DECISIONS =
 * FALSE), and only oracle-keyed events are retained - not the full event stream.
 */

const fs = require("fs");
const path = require("path");

const { loadProject } = require("./lib/project-loader");
const {
  createTransportCollapsedSearch,
  transportSignature,
  actionToSemanticIdentity,
  isCombatProgressTransition,
} = require("./lib/transport-collapse");
const { buildDependencyFrontier } = require("./lib/dependency-frontier");
const { resolveRecordedAction } = require("./lib/route-store");
const { buildStateKey } = require("./lib/state-key");
// Reuse the PR-5.25t oracle machinery rather than rebuilding it.
const { ORACLE_FIXTURE, PROJECT_ROOT, classifyStage, makeSimulator } = require("./audit-pr525t-oracle-survival");

const DEFAULT_OUT = path.resolve(__dirname, "routes", "generated", "pr526j-mt4-bottleneck.json");

const FROZEN = {
  initialRank: "chaos",
  region: ["MT1", "MT2", "MT3", "MT4"],
  goalFloorId: "MT4",
  maxExpansions: 20000,
  maxRuntimeMs: 0,
  maxRssMb: 2048,
  pendingCandidateCap: 1024,
  rank20DynamicPareto: true,
  neutralParetoSubstitution: true,
  stableGuidedTieBreak: false,
  retroactiveGuidedSkylineDemotion: false,
  reclaimDroppedState: true,
};

/** Phase 1: replay the tracked oracle route and classify each decision generically. */
function classifyOracleRoute(simulator, project, frontierSet) {
  const record = JSON.parse(fs.readFileSync(ORACLE_FIXTURE, "utf8"));
  const decisions = Array.isArray(record.decisions) ? record.decisions : [];
  if (decisions.length === 0) throw new Error("oracle fixture has no decisions");

  let state = simulator.createInitialState({ rank: FROZEN.initialRank });
  const rows = [];
  for (let i = 0; i < decisions.length; i += 1) {
    const decision = decisions[i];
    const preState = state;
    const preSignature = transportSignature(state);
    const actions = (simulator.enumeratePrimitiveActions(state) || {}).actions || [];
    const resolved = resolveRecordedAction(simulator, state, {
      ...decision,
      postExactStateKey: decision.postStateKey || decision.postExactStateKey || null,
    }, { candidates: actions });
    if (!resolved || !resolved.action) {
      throw new Error(`oracle replay failed to resolve decision ${i}: ${resolved && resolved.reason}`);
    }
    const action = resolved.action;
    const nextState = simulator.applyAction(state, action, { storeRoute: true });
    if (!nextState || !nextState.hero || nextState.hero.hp <= 0) throw new Error(`oracle replay died at decision ${i}`);

    const strategic = preSignature !== transportSignature(nextState);
    const identity = actionToSemanticIdentity(action, preState, nextState, project);
    const frontierEligible = frontierSet.has(identity);
    const combatProgress = isCombatProgressTransition(preState, nextState);
    rows.push({
      decisionIndex: i,
      strategic,
      actionKind: action.kind,
      semanticIdentity: identity,
      floorBefore: preState.floorId,
      floorAfter: nextState.floorId,
      frontierEligible,
      combatProgress,
      staticClass: strategic
        ? (frontierEligible ? "FRONTIER_ELIGIBLE" : (combatProgress ? "COMBAT_PROGRESS_ONLY" : "ORDINARY_NEUTRAL"))
        : null,
      postKey: buildStateKey(nextState),
    });
    state = nextState;
  }
  if (state.floorId !== FROZEN.goalFloorId) throw new Error(`oracle replay ended on ${state.floorId}, not ${FROZEN.goalFloorId}`);
  return { rows, finalFloorId: state.floorId, finalHeroHp: state.hero.hp, finalState: state };
}

/** Phase 2: fixed-work run with a read-only oracle-keyed fate table. */
function runFateTable(simulator, project, initialState, frontierReport, rows) {
  const oracleKeys = new Set(rows.map((r) => r.postKey));
  const events = new Map(); // postKey -> retained lifecycle events
  let retainedCount = 0;
  let totalEvents = 0;
  let expansionIndex = 0;
  const onCandidateLifecycle = (event) => {
    totalEvents += 1;
    if (event.type === "expanded" && event.strategicExpansion != null) expansionIndex = event.strategicExpansion;
    if (typeof event.exactKey === "string" && oracleKeys.has(event.exactKey)) {
      retainedCount += 1;
      const list = events.get(event.exactKey) || [];
      // Stamp the observed expansion index so a drop can be placed in time
      // without retaining any per-node state.
      list.push({ ...event, observedAtExpansion: expansionIndex });
      events.set(event.exactKey, list);
    }
  };

  const result = createTransportCollapsedSearch(simulator).search(initialState, {
    isGoalState: (state) => state.floorId === FROZEN.goalFloorId,
    allowedFloors: FROZEN.region,
    maxExpansions: FROZEN.maxExpansions,
    maxRuntimeMs: FROZEN.maxRuntimeMs,
    maxRssMb: FROZEN.maxRssMb,
    frontierSet: frontierReport.frontierSet,
    resourceSkylinePriority: true,
    pendingCandidateCap: FROZEN.pendingCandidateCap,
    rank20DynamicPareto: FROZEN.rank20DynamicPareto,
    neutralParetoSubstitution: FROZEN.neutralParetoSubstitution,
    stableGuidedTieBreak: FROZEN.stableGuidedTieBreak,
    retroactiveGuidedSkylineDemotion: FROZEN.retroactiveGuidedSkylineDemotion,
    reclaimDroppedState: FROZEN.reclaimDroppedState,
    onCandidateLifecycle,
  });

  const last = (list, type) => {
    for (let i = list.length - 1; i >= 0; i -= 1) if (list[i].type === type) return list[i];
    return null;
  };
  const table = rows.map((row) => {
    const list = events.get(row.postKey) || [];
    const types = new Set(list.map((e) => e.type));
    const classified = last(list, "classified");
    const dropped = last(list, "dropped");
    const expanded = last(list, "expanded");
    const registered = last(list, "registered");
    const rankClass = classified
      ? (classified.guidedAdmitted === true ? 10 : (classified.combatProgress === true ? 20 : 30))
      : null;
    return {
      decisionIndex: row.decisionIndex,
      strategic: row.strategic,
      staticClass: row.staticClass,
      semanticIdentity: row.semanticIdentity,
      floorAfter: row.floorAfter,
      seenInClosure: types.has("closureSeen"),
      generated: types.has("strategicGenerated"),
      duplicateSkipped: types.has("duplicateSkipped"),
      registered: types.has("registered"),
      dropped: types.has("dropped"),
      expanded: types.has("expanded"),
      stage: classifyStage(list),
      frontierGuided: classified ? classified.frontierGuided === true : null,
      guidedAdmitted: classified ? classified.guidedAdmitted === true : null,
      combatProgress: classified ? classified.combatProgress === true : null,
      rankClassDerived: rankClass,
      registeredAt: registered ? registered.registeredAtStrategicExpansion : null,
      droppedAt: dropped ? dropped.observedAtExpansion : null,
      expandedAt: expanded ? expanded.strategicExpansion : null,
      dropAttribution: dropped
        ? {
          pureFillKept: dropped.pureFillKept,
          displacedByFifoHeadProtection: dropped.displacedByFifoHeadProtection === true,
          rankClass: dropped.rankClass,
          rank20ParetoDominated: dropped.rank20ParetoDominated,
          skylineDominated: dropped.skylineDominated,
          olderRank20PendingCount: dropped.olderRank20PendingCount,
        }
        : null,
    };
  });

  return { result, table, retainedCount, totalEvents };
}

function main() {
  const args = process.argv.slice(2);
  const outArg = args.find((t) => t.startsWith("--out="));
  const outPath = outArg ? path.resolve(outArg.slice("--out=".length)) : DEFAULT_OUT;

  console.log("PR-5.26j MT4 long-horizon bottleneck localization");
  const project = loadProject(PROJECT_ROOT);
  const simulator = makeSimulator(project);
  const initialState = simulator.createInitialState({ rank: FROZEN.initialRank });
  const frontierReport = buildDependencyFrontier(project, initialState, { type: "floorReached", floorId: FROZEN.goalFloorId });
  const frontierSet = frontierReport.frontierSet;

  // --- Phase 1 ---------------------------------------------------------------
  const oracle = classifyOracleRoute(simulator, project, frontierSet);
  const strategic = oracle.rows.filter((r) => r.strategic);
  const byClass = (name) => strategic.filter((r) => r.staticClass === name);
  const ordinaryNeutral = byClass("ORDINARY_NEUTRAL");
  const phase1 = {
    decisions: oracle.rows.length,
    strategicCheckpoints: strategic.length,
    frontierSetSize: frontierSet.size,
    frontierEligibleCount: byClass("FRONTIER_ELIGIBLE").length,
    combatProgressOnlyCount: byClass("COMBAT_PROGRESS_ONLY").length,
    ordinaryNeutralCount: ordinaryNeutral.length,
    ordinaryNeutralSteps: ordinaryNeutral.map((r) => r.decisionIndex),
    ordinaryNeutralInSecondHalf: ordinaryNeutral.filter((r) => r.decisionIndex >= oracle.rows.length / 2).length,
    finalFloorId: oracle.finalFloorId,
    finalHeroHp: oracle.finalHeroHp,
    frontierCoverageBecomesNextBlockerSupported: ordinaryNeutral.length > 0,
    note: "FRONTIER_ELIGIBLE is an upper bound on rank 10: runtime skyline history can still reject a frontier-eligible identity.",
  };
  console.log(`Phase 1: ${phase1.decisions} decisions, ${phase1.strategicCheckpoints} strategic checkpoints; ` +
    `FRONTIER_ELIGIBLE=${phase1.frontierEligibleCount} COMBAT_PROGRESS_ONLY=${phase1.combatProgressOnlyCount} ` +
    `ORDINARY_NEUTRAL=${phase1.ordinaryNeutralCount} (steps ${JSON.stringify(phase1.ordinaryNeutralSteps)})`);

  // --- Phase 2 ---------------------------------------------------------------
  if (args.includes("--phase1-only")) {
    console.log(JSON.stringify(phase1, null, 2));
    console.log(JSON.stringify(oracle.rows.filter((r) => r.staticClass === "ORDINARY_NEUTRAL"), null, 2));
    return;
  }
  const fate = runFateTable(simulator, project, initialState, frontierReport, oracle.rows);
  const strategicRows = fate.table.filter((r) => r.strategic);
  const expandedStrategic = strategicRows.filter((r) => r.expanded);
  const notSurviving = strategicRows.filter((r) => !r.expanded);
  const lastExpanded = expandedStrategic.length === 0 ? null : expandedStrategic[expandedStrategic.length - 1].decisionIndex;
  const firstLoss = notSurviving.length === 0 ? null : notSurviving[0];
  const previousCheckpoint = firstLoss ? strategicRows.filter((r) => r.decisionIndex < firstLoss.decisionIndex).slice(-1)[0] || null : null;
  const stageCounts = notSurviving.reduce((acc, r) => {
    acc[r.stage] = (acc[r.stage] || 0) + 1;
    return acc;
  }, {});

  // Mechanical branch label for the owner's pre-declared tree; the ruling is the owner's.
  let branchCandidate = null;
  if (firstLoss) {
    if (firstLoss.stage === "NEVER_GENERATED") {
      branchCandidate = previousCheckpoint && previousCheckpoint.expanded === false ? "J-D_OR_MECHANICAL_FALLOUT_OF_UNEXPANDED_PREDECESSOR" : "J-D";
    } else if (firstLoss.stage === "DROPPED_BY_CAP") {
      branchCandidate = firstLoss.rankClassDerived === 20 ? "J-B" : (firstLoss.guidedAdmitted === true ? "J-A" : "J-C");
    } else if (firstLoss.stage === "SURVIVED") {
      branchCandidate = null;
    } else {
      branchCandidate = firstLoss.guidedAdmitted === true ? "J-A" : "J-C";
    }
  } else if (!fate.result.found) {
    branchCandidate = "J-E";
  }

  const summary = {
    milestone: "PR-5.26j",
    kind: "FINAL_BOTTLENECK_LOCALIZATION",
    searchPolicyChange: "NONE",
    oracleKeysAffectSearchDecisions: false,
    frozen: FROZEN,
    phase1StaticClassification: phase1,
    phase1Rows: oracle.rows,
    search: {
      found: fate.result.found,
      strategicExpansions: fate.result.strategicExpansions,
      stoppedReason: fate.result.stoppedReason,
      candidatesDropped: fate.result.candidatesDropped,
      droppedStatesReclaimed: fate.result.droppedStatesReclaimed,
      deepestReachedFloorOrdinal: fate.result.deepestReachedFloorOrdinal,
      deepestStrategicDepth: fate.result.deepestStrategicDepth,
      peakRssMb: fate.result.peakRssMb,
      peakHeapUsedMb: fate.result.peakHeapUsedMb,
      wallMs: fate.result.wallMs,
      registrySize: fate.result.registrySize,
      lifecycleEventsTotal: fate.totalEvents,
      lifecycleEventsOracleMatched: fate.retainedCount,
    },
    verdict: {
      lastExpandedCheckpoint: lastExpanded,
      firstNotSurvivingCheckpoint: firstLoss ? firstLoss.decisionIndex : null,
      firstLossStage: firstLoss ? firstLoss.stage : null,
      firstLossDetail: firstLoss,
      previousCheckpointExpanded: previousCheckpoint ? previousCheckpoint.expanded : null,
      previousCheckpointStage: previousCheckpoint ? previousCheckpoint.stage : null,
      survivedStrategicCheckpoints: expandedStrategic.length,
      nonSurvivingStageCounts: stageCounts,
      branchCandidate,
      branchCandidateIsOwnerRuling: false,
    },
    fateTable: fate.table,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`);

  const s = summary.search;
  console.log(`Phase 2: found=${s.found} strategic=${s.strategicExpansions} stopped=${s.stoppedReason} ` +
    `deepest=${s.deepestReachedFloorOrdinal} depth=${s.deepestStrategicDepth} rss=${s.peakRssMb}MB heap=${s.peakHeapUsedMb}MB ` +
    `wall=${s.wallMs}ms drops=${s.candidatesDropped} reclaimed=${s.droppedStatesReclaimed}`);
  console.log(`  LAST_EXPANDED_CHECKPOINT = ${lastExpanded} of ${strategicRows.length}`);
  console.log(`  FIRST_NOT_SURVIVING_CHECKPOINT = ${firstLoss ? firstLoss.decisionIndex : null}`);
  console.log(`  FIRST_LOSS_STAGE = ${firstLoss ? firstLoss.stage : null}`);
  if (firstLoss) {
    console.log(`  FIRST_LOSS: identity=${firstLoss.semanticIdentity} floor=${firstLoss.floorAfter} ` +
      `frontierGuided=${firstLoss.frontierGuided} guidedAdmitted=${firstLoss.guidedAdmitted} ` +
      `combatProgress=${firstLoss.combatProgress} rankClass=${firstLoss.rankClassDerived} ` +
      `registeredAt=${firstLoss.registeredAt} droppedAt=${firstLoss.droppedAt} expandedAt=${firstLoss.expandedAt}`);
    console.log(`  FIRST_LOSS drop attribution: ${JSON.stringify(firstLoss.dropAttribution)}`);
    console.log(`  PREVIOUS_CHECKPOINT_EXPANDED = ${summary.verdict.previousCheckpointExpanded} ` +
      `(stage ${summary.verdict.previousCheckpointStage})`);
  }
  console.log(`  survived=${expandedStrategic.length}/${strategicRows.length} nonSurviving=${JSON.stringify(stageCounts)}`);
  console.log(`  branch candidate (owner rules): ${branchCandidate}`);
  console.log(`  artifact: ${path.relative(process.cwd(), outPath)}`);
}

if (require.main === module) main();

module.exports = { FROZEN, classifyOracleRoute };
