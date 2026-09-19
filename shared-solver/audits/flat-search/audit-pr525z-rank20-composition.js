"use strict";
/**
 * PR-5.25z - Rank20 Identity and Variant Composition Audit.
 *
 * OBSERVATION ONLY. SEARCH_POLICY_CHANGE = NONE.
 *
 * PR-5.25y Repair 1 established that cp#9 (battle:redBat@MT1:10,1) is dropped by
 * the ordinary rank-20 (rank, insertion) fill, not by FIFO head displacement.
 * The remaining question is what the rank-20 class is actually competing OVER:
 *
 *   World 1 - a few strategic actions with many resource/path VARIANTS
 *   World 2 - genuinely many different investment opportunities
 *
 * Those two worlds call for completely different next mechanisms, so this audit
 * measures which one holds before any value function is designed.
 *
 * PHASE 1  rank-20 semantic identity composition at the trim that drops cp#9:
 *          distinct identities, multiplicity histogram, top identities, by kind,
 *          by floor, and cp#9's same-identity counts.
 *
 * PHASE 2  for cp#9's SAME-IDENTITY peers only: structural groups
 *          (buildStructuralStateKey), resource vectors (extractResourceVector),
 *          and unweighted Pareto status within the dropped node's own
 *          structural group (paretoDominates). All three are the existing
 *          weight-free tools from lib/resource-skyline.js.
 *
 * Boundaries held:
 *   - No candidate is removed, reordered, or promoted from any of this.
 *   - A structural key is a strong analytical abstraction, NOT a proven
 *     future-legality equivalence; a Pareto-dominated candidate is NOT deleted.
 *   - The oracle refines only WHICH identity to report on; it never affects a
 *     search decision (CP9_KEY_AFFECTS_SEARCH_DECISIONS = FALSE).
 *
 * Case classification (PR-5.25z):
 *   Z-A  distinctIdentities <= rank20CapacityUnderPureFill
 *        AND cp#9's identity is unrepresented in the pure fill
 *        -> duplicate variants crowded out a NEW identity (diversity pressure)
 *   Z-B  cp#9's identity DOES have pure-fill-kept members
 *        Z-B1  cp#9 is Pareto-dominated by a same-structural-group retained peer
 *        Z-B2  cp#9 is nondominated or dominates retained peers
 *   Z-C  distinctIdentities > rank20CapacityUnderPureFill
 *        -> diversity alone cannot fit every long-term action
 */

const fs = require("fs");
const path = require("path");

const { loadProject } = require("../../lib/project-loader");
const { StaticSimulator } = require("../../lib/simulator");
const { FunctionBackedBattleResolver } = require("../../lib/battle-resolver");
const { createTransportCollapsedSearch } = require("../../lib/transport-collapse");
const { buildDependencyFrontier } = require("../../lib/dependency-frontier");
const { resolveRecordedAction } = require("../../lib/route-store");
const { buildStateKey } = require("../../lib/state-key");
const { cloneState } = require("../../lib/state");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..", "Only upV2.1", "Only upV2.1");
const FIXTURE = path.resolve(__dirname, "..", "..", "routes", "fixtures", "mt1-mt4-hp6428-best.route.json");
const CP9_SUMMARY_MARKER = "battle:redBat@MT1:10,1";
const CP9_DECISION_INDEX = 9;
const DEFAULT_OUT = path.resolve(__dirname, "..", "..", "routes", "generated", "pr525z-rank20-composition.json");

const FROZEN = {
  initialRank: "chaos",
  region: ["MT1", "MT2", "MT3", "MT4"],
  goalFloorId: "MT4",
  maxExpansions: 8000,
  maxRuntimeMs: 0,
  maxRssMb: 2048,
  pendingCandidateCap: 1024,
};

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

function resolveDecision(simulator, state, decision) {
  const actions = (simulator.enumeratePrimitiveActions(state) || {}).actions || [];
  return resolveRecordedAction(simulator, state, {
    ...decision,
    postExactStateKey: decision.postExactStateKey || decision.postStateKey || null,
  }, { candidates: actions });
}

function replayOracle(simulator, decisions) {
  let state = simulator.createInitialState({ rank: FROZEN.initialRank });
  const preStates = [];
  for (let i = 0; i < decisions.length; i += 1) {
    preStates.push(cloneState(state));
    const resolved = resolveDecision(simulator, state, decisions[i]);
    if (!resolved || !resolved.action) throw new Error(`oracle replay failed at decision ${i}: ${resolved && resolved.reason}`);
    state = simulator.applyAction(state, resolved.action, { storeRoute: true });
    if (!state || !state.hero || state.hero.hp <= 0) throw new Error(`oracle replay died at decision ${i}`);
  }
  return { preStates, finalState: state };
}

/**
 * Mechanistic PR-5.25z classification. Decision order matters: Z-C (diversity
 * cannot fit) is checked before Z-A, and Z-A requires that cp#9's own identity
 * had NO pure-fill seat - otherwise the failure was resource selection within an
 * identity, not identity crowding.
 */
function classifyComposition({ composition, sameIdentityPeers, cap, pureFillKept, pureFillRank20CutoffPendingSeq, droppedPendingSeq }) {
  const distinct = composition ? composition.rank20DistinctIdentities : null;
  const capacity = cap == null ? null : cap; // rank20 capacity under pure fill equals what the trim reported
  const sameIdentityKept = sameIdentityPeers ? sameIdentityPeers.pureFillKeptCount : null;
  const evidence = {
    rank20Pending: composition ? composition.rank20Pending : null,
    rank20DistinctIdentities: distinct,
    rank20CapacityUnderPureFill: capacity,
    cp9SameIdentityPending: sameIdentityPeers ? sameIdentityPeers.pendingCount : null,
    cp9SameIdentityPureFillKept: sameIdentityKept,
    cp9SameIdentityDropped: sameIdentityPeers ? sameIdentityPeers.droppedCount : null,
    cp9SameIdentityDistinctStructuralKeys: sameIdentityPeers ? sameIdentityPeers.distinctStructuralKeys : null,
    cp9SameStructuralGroupSize: sameIdentityPeers ? sameIdentityPeers.structuralGroupSize : null,
    cp9PureFillKept: pureFillKept,
    cp9PureFillRank20CutoffPendingSeq: pureFillRank20CutoffPendingSeq,
    cp9PendingSeq: droppedPendingSeq,
  };
  // The rank-20 seat count available under the pure fill, as measured.
  const rank20Seats = evidence.rank20CapacityUnderPureFill;
  if (distinct != null && rank20Seats != null && distinct > rank20Seats) {
    return { case: "Z-C_DIVERSITY_CANNOT_FIT_ALL", evidence };
  }
  if (sameIdentityKept != null && sameIdentityKept > 0) {
    // cp#9's identity WAS represented among the pure-fill survivors, so the
    // failure is resource selection WITHIN an identity, not identity crowding.
    // Counters come from the complete same-structural-group peer set, so the
    // classification does not depend on the truncated evidence window.
    const dominatedByRetainedCount = sameIdentityPeers.dominatedByRetainedCount || 0;
    const dominatesRetainedCount = sameIdentityPeers.dominatesRetainedCount || 0;
    const incomparableRetainedCount = sameIdentityPeers.incomparableRetainedCount || 0;
    let pareto;
    if (dominatedByRetainedCount > 0) pareto = `DOMINATED_BY_${dominatedByRetainedCount}`;
    else if (dominatesRetainedCount > 0) pareto = `DOMINATES_${dominatesRetainedCount}`;
    else if (incomparableRetainedCount > 0) pareto = `INCOMPARABLE_${incomparableRetainedCount}`;
    else pareto = "NO_SAME_STRUCTURAL_GROUP_RETAINED_PEER";
    evidence.cp9SameGroupKeptCount = sameIdentityPeers.sameGroupKeptCount;
    evidence.cp9DominatedByRetainedCount = dominatedByRetainedCount;
    evidence.cp9DominatesRetainedCount = dominatesRetainedCount;
    evidence.cp9IncomparableRetainedCount = incomparableRetainedCount;
    // Z-B1 means a same-structural-group retained peer is resource-wise at least
    // as good on EVERY dimension - i.e. the search may hold the same world with
    // a stronger hero, so chasing this exact oracle key would be misdirected.
    const caseName = dominatedByRetainedCount > 0
      ? "Z-B1_DOMINATED_BY_RETAINED_VARIANT"
      : "Z-B2_RESOURCE_SELECTION_MISALIGNED";
    return { case: caseName, withinIdentityParetoStatus: pareto, evidence };
  }
  // No same-identity pure-fill seat. If distinct identities still fit the seats,
  // duplicate variants crowded out a new identity.
  if (distinct != null && rank20Seats != null && distinct <= rank20Seats) {
    return { case: "Z-A_DUPLICATE_VARIANT_DIVERSITY_PRESSURE", evidence };
  }
  return { case: "Z-UNCLASSIFIED", evidence };
}

function main() {
  const cliArgs = process.argv.slice(2);
  const outPath = (() => {
    const arg = cliArgs.find((t) => t.startsWith("--out="));
    return arg ? path.resolve(arg.slice("--out=".length)) : DEFAULT_OUT;
  })();

  const project = loadProject(PROJECT_ROOT);
  const simulator = makeSimulator(project);
  const record = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
  const decisions = Array.isArray(record.decisions) ? record.decisions : [];

  // --- oracle (read-only; only selects WHICH identity to report on) ---
  // The tracked key is the POST-state of decision #9: the world the search would
  // hold AFTER buying the redBat investment. That is the node whose loss is the
  // first oracle-prefix loss.
  const oracle = replayOracle(simulator, decisions);
  const cp9Pre = oracle.preStates[CP9_DECISION_INDEX];
  const cp9Post = (() => {
    const resolved = resolveDecision(simulator, cp9Pre, decisions[CP9_DECISION_INDEX]);
    if (!resolved || !resolved.action) throw new Error("cp9 decision failed to resolve on oracle replay");
    return simulator.applyAction(cp9Pre, resolved.action, { storeRoute: true });
  })();
  const cp9Key = buildStateKey(cp9Post);
  const oracleKeys = new Set(oracle.preStates.map((s) => buildStateKey(s)));
  const cp9Summary = decisions[CP9_DECISION_INDEX].summary;
  if (cp9Summary !== CP9_SUMMARY_MARKER) {
    console.log(`  WARNING: oracle decision ${CP9_DECISION_INDEX} summary "${cp9Summary}" != expected "${CP9_SUMMARY_MARKER}"`);
  }

  const initialState = simulator.createInitialState({ rank: FROZEN.initialRank });
  const isGoalState = (s) => s.floorId === FROZEN.goalFloorId;
  const frontierReport = buildDependencyFrontier(project, initialState, {
    type: "floorReached", floorId: FROZEN.goalFloorId,
  });

  const cp9Drop = { event: null, trim: null };
  let cp9ExpandedEarly = false;
  let totalEvents = 0;
  const onCandidateLifecycle = (event) => {
    totalEvents += 1;
    if (event.exactKey !== cp9Key) return;
    if (event.type === "expanded") cp9ExpandedEarly = true;
    if (event.type === "dropped" && !cp9Drop.event) {
      cp9Drop.event = event;
      cp9Drop.trim = event.trim || null;
    }
  };

  const search = createTransportCollapsedSearch(simulator);
  console.log(`PR-5.25z rank20 identity/variant composition audit (observation only)`);
  console.log(`  frozen: expansions=${FROZEN.maxExpansions} noWallLimit cap=${FROZEN.pendingCandidateCap} ` +
    `region=${FROZEN.region.join(",")} goal=${FROZEN.goalFloorId}`);
  const result = search.search(initialState, {
    isGoalState,
    allowedFloors: FROZEN.region,
    maxExpansions: FROZEN.maxExpansions,
    maxRuntimeMs: FROZEN.maxRuntimeMs,
    maxRssMb: FROZEN.maxRssMb,
    frontierSet: frontierReport.frontierSet,
    resourceSkylinePriority: true,
    pendingCandidateCap: FROZEN.pendingCandidateCap,
    onCandidateLifecycle,
    lifecyclePeerComposition: true,
  });

  console.log(`  run: found=${result.found} expansions=${result.strategicExpansions} dropped=${result.candidatesDropped} ` +
    `stopped=${result.stoppedReason} wall=${result.wallMs}ms events=${totalEvents}`);
  console.log(`  cp9 fate: ${cp9Drop.event ? "DROPPED_OBSERVED" : (cp9ExpandedEarly ? "EXPANDED_BEFORE_DROP" : "NOT_OBSERVED")}`);

  const composition = cp9Drop.trim ? cp9Drop.trim.rank20Composition : null;
  const sameIdentityPeers = cp9Drop.event ? cp9Drop.event.sameIdentityPeers : null;
  const droppedPendingSeq = cp9Drop.event ? cp9Drop.event.nodePendingSeq : null;
  const pureFillRank20CutoffPendingSeq = cp9Drop.trim ? cp9Drop.trim.pureFillRank20CutoffPendingSeq : null;
  const rank20Seats = cp9Drop.trim
    ? Math.max(0, FROZEN.pendingCandidateCap - cp9Drop.trim.rank0PlusRank10Pending)
    : null;

  let classification = null;
  if (cp9Drop.event && cp9Drop.trim) {
    classification = classifyComposition({
      composition,
      sameIdentityPeers,
      cap: rank20Seats,
      pureFillKept: cp9Drop.event.pureFillKept,
      pureFillRank20CutoffPendingSeq,
      droppedPendingSeq,
    });
    if (composition) {
      console.log(`  RANK20_PENDING = ${composition.rank20Pending}`);
      console.log(`  RANK20_DISTINCT_SEMANTIC_IDENTITIES = ${composition.rank20DistinctIdentities}`);
      console.log(`  RANK20_CAPACITY_UNDER_PURE_FILL = ${rank20Seats}`);
      console.log(`  RANK20_DUPLICATE_IDENTITIES = ${composition.rank20DuplicateIdentities}`);
      console.log(`  TOP_IDENTITY_MULTIPLICITIES = ${JSON.stringify(composition.topIdentities.slice(0, 8))}`);
      console.log(`  CP9_SEMANTIC_IDENTITY = ${sameIdentityPeers ? sameIdentityPeers.identity : "<unknown>"}`);
      console.log(`  CP9_SAME_IDENTITY_PENDING_COUNT = ${sameIdentityPeers ? sameIdentityPeers.pendingCount : null}`);
      console.log(`  CP9_SAME_IDENTITY_PURE_FILL_KEPT_COUNT = ${sameIdentityPeers ? sameIdentityPeers.pureFillKeptCount : null}`);
      console.log(`  CP9_SAME_IDENTITY_DROPPED_COUNT = ${sameIdentityPeers ? sameIdentityPeers.droppedCount : null}`);
      console.log(`  CP9_SAME_IDENTITY_DISTINCT_STRUCTURAL_KEYS = ${sameIdentityPeers ? sameIdentityPeers.distinctStructuralKeys : null}`);
      console.log(`  CP9_SAME_STRUCTURAL_GROUP_SIZE = ${sameIdentityPeers ? sameIdentityPeers.structuralGroupSize : null}`);
      console.log(`  CP9_PARETO_STATUS_WITHIN_SAME_STRUCTURAL_GROUP = ${classification && classification.withinIdentityParetoStatus ? classification.withinIdentityParetoStatus : "n/a (no same-identity seat)"}`);
    }
    console.log(`  COMPOSITION_CASE = ${classification.case}`);
    console.log(`  EVIDENCE = ${JSON.stringify(classification.evidence)}`);
  } else {
    console.log(`  COMPOSITION_CASE = NOT_OBSERVED (cp#9 never reached a trim within budget)`);
  }

  const summary = {
    milestone: "PR-5.25z",
    audit: "RANK20_IDENTITY_AND_VARIANT_COMPOSITION_AUDIT",
    searchPolicyChange: "NONE",
    searchRun: "FIXED_WORK_8000_EXPANSIONS_OBSERVATION_ONLY",
    cp9KeyAffectsSearchDecisions: false,
    structuralKeyIsProvenFutureLegalityEquivalence: false,
    frozen: FROZEN,
    oracle: {
      cp9DecisionIndex: CP9_DECISION_INDEX,
      cp9Summary,
      cp9SummaryMatchesExpectedMarker: cp9Summary === CP9_SUMMARY_MARKER,
      oracleKeyCount: oracleKeys.size,
    },
    run: {
      found: result.found,
      strategicExpansions: result.strategicExpansions,
      candidatesDropped: result.candidatesDropped,
      stoppedReason: result.stoppedReason,
      wallMs: result.wallMs,
      deepestReachedFloorOrdinal: result.deepestReachedFloorOrdinal,
      fifoHeadProtected: result.fifoHeadProtected,
      totalLifecycleEvents: totalEvents,
      cp9Fate: cp9Drop.event ? "dropped" : (cp9ExpandedEarly ? "expanded" : "not_observed"),
    },
    composition,
    rank20CapacityUnderPureFill: rank20Seats,
    sameIdentityPeers,
    classification,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`  artifact: ${path.relative(process.cwd(), outPath)}`);
}

main();
