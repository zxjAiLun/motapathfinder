"use strict";
/**
 * PR-5.25t - MT4 Oracle Prefix Survival Audit.
 *
 * Answers one question: the MT4 solution that provably exists (tracked 55-decision
 * fixture, executable to MT4 on the current simulator) - where does it FIRST die
 * inside the current search's candidate lifecycle?
 *
 * PHASE 1 (no search): replay the fixture from the canonical CHAOS MT1 state
 * through the same resolveRecordedAction() the strict gate uses, regenerating
 * every exact state key with the CURRENT buildStateKey(). Two sequences:
 *   ALL_ORACLE_STEPS              every replayed step
 *   STRATEGIC_ORACLE_CHECKPOINTS  only steps whose transportSignature changed
 * The strategic checkpoints are the primary lifecycle comparison sequence:
 * search-level nodes are strategic successors, while transport-only steps can
 * only appear inside local closures (observed as closureSeen).
 *
 * PHASE 2: the search is observed through the optional onCandidateLifecycle
 * callback. The observer ONLY records; return values are ignored by the search
 * and the harness filters events by oracle exact keys OUTSIDE the search.
 * ORACLE_KEYS_AFFECT_SEARCH_DECISIONS = FALSE.
 *
 * PHASE 3: one MT4 diagnostic run (frozen cap=1024 configuration, identical to
 * the PR-5.25s Phase 4 run, plus instrumentation) and the survival analysis:
 *   LAST_ORACLE_CHECKPOINT_EXPANDED
 *   FIRST_ORACLE_CHECKPOINT_NOT_SURVIVING
 *   FIRST_LOSS_STAGE in { NEVER_GENERATED, DUPLICATE_TO_EXISTING_STATE,
 *     REGISTERED_BUT_SKYLINE_DOMINATED, DROPPED_BY_CAP,
 *     KEPT_BUT_NOT_EXPANDED_BEFORE_TIMEOUT, PREVIOUS_PREFIX_NEVER_EXPANDED }
 *
 * This is a diagnostic, not a qualification: instrumentation adds overhead, so
 * wall/expansion numbers are indicative only.
 */

const fs = require("fs");
const path = require("path");

const { loadProject } = require("./lib/project-loader");
const { StaticSimulator } = require("./lib/simulator");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { createTransportCollapsedSearch, transportSignature } = require("./lib/transport-collapse");
const { buildDependencyFrontier } = require("./lib/dependency-frontier");
const { resolveRecordedAction } = require("./lib/route-store");
const { buildStateKey } = require("./lib/state-key");

const PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const ORACLE_FIXTURE = path.resolve(__dirname, "routes", "fixtures", "mt1-mt4-hp6428-best.route.json");
const DEFAULT_OUT = path.resolve(__dirname, "routes", "generated", "pr525t-oracle-survival.json");

const FROZEN = {
  initialRank: "chaos",
  region: ["MT1", "MT2", "MT3", "MT4"],
  goalFloorId: "MT4",
  maxRuntimeMs: 180000,
  maxRssMb: 2048,
  maxExpansions: 120000,
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

/** Phase 1: replay the tracked fixture and derive current-format oracle keys. */
function buildOracleCheckpoints(simulator) {
  const record = JSON.parse(fs.readFileSync(ORACLE_FIXTURE, "utf8"));
  const decisions = Array.isArray(record.decisions) ? record.decisions : [];
  if (decisions.length === 0) throw new Error("oracle fixture has no decisions");

  let state = simulator.createInitialState({ rank: FROZEN.initialRank });
  if (state.floorId !== "MT1") throw new Error("canonical CHAOS initial state is not on MT1");

  const allSteps = [];
  for (let i = 0; i < decisions.length; i += 1) {
    const decision = decisions[i];
    const preKey = buildStateKey(state);
    const preSignature = transportSignature(state);
    const actions = (simulator.enumeratePrimitiveActions(state) || {}).actions || [];
    const resolved = resolveRecordedAction(simulator, state, {
      ...decision,
      postExactStateKey: decision.postStateKey || decision.postExactStateKey || null,
    }, { candidates: actions });
    if (!resolved || !resolved.action) {
      throw new Error(`oracle replay failed to resolve decision ${i} (${decision.summary}): ${resolved && resolved.reason}`);
    }
    state = simulator.applyAction(state, resolved.action, { storeRoute: true });
    if (!state || !state.hero || state.hero.hp <= 0) throw new Error(`oracle replay died at decision ${i}`);
    const postKey = buildStateKey(state);
    const postSignature = transportSignature(state);
    allSteps.push({
      step: i,
      floorId: resolved.action.floorId || null,
      kind: resolved.action.kind,
      summary: resolved.action.summary || null,
      preKey,
      postKey,
      floorAfterId: state.floorId,
      transportOnly: preSignature === postSignature,
    });
  }

  if (state.floorId !== FROZEN.goalFloorId) {
    throw new Error(`oracle replay ended on ${state.floorId}, not ${FROZEN.goalFloorId}`);
  }

  // floorChange for step i = floorAfterId differs from the previous step's floorAfterId.
  for (let i = 0; i < allSteps.length; i += 1) {
    allSteps[i].floorChange = i === 0
      ? allSteps[i].floorAfterId !== "MT1"
      : allSteps[i].floorAfterId !== allSteps[i - 1].floorAfterId;
  }

  const strategicCheckpoints = allSteps.filter((s) => !s.transportOnly);
  return { allSteps, strategicCheckpoints, finalFloorId: state.floorId, finalHeroHp: state.hero.hp };
}

function classifyStage(cp, checkpoints, lifecycle) {
  const events = lifecycle.get(cp.postKey) || [];
  if (events.length === 0) return "NEVER_GENERATED";
  const types = new Set(events.map((e) => e.type));
  // Precedence note: a duplicateSkipped event only says this exact state was
  // already registered through another action variant; whether the prefix
  // actually died depends on what happened to that registered twin. A dropped
  // event on the same exact key means the twin itself was dropped, so the cap
  // drop - not the dedup - is the real loss stage.
  if (types.has("dropped")) return "DROPPED_BY_CAP";
  if (types.has("duplicateSkipped")) return "DUPLICATE_TO_EXISTING_STATE";
  if (types.has("registered")) {
    const classified = [...events].reverse().find((e) => e.type === "classified");
    if (classified && classified.skylineDominated === true) return "REGISTERED_BUT_SKYLINE_DOMINATED";
    return "KEPT_BUT_NOT_EXPANDED_BEFORE_TIMEOUT";
  }
  return "KEPT_BUT_NOT_EXPANDED_BEFORE_TIMEOUT";
}

function main() {
  const outPath = (() => {
    const arg = process.argv.slice(2).find((t) => t.startsWith("--out="));
    return arg ? path.resolve(arg.slice("--out=".length)) : DEFAULT_OUT;
  })();

  const project = loadProject(PROJECT_ROOT);
  const simulator = makeSimulator(project);

  // --- Phase 1: oracle -> current exact-state checkpoints (no search) ---
  const oracle = buildOracleCheckpoints(simulator);
  const oracleExactKeys = new Set(oracle.allSteps.map((s) => s.postKey));
  console.log(`Phase 1: oracle replayed to ${oracle.finalFloorId} (hp ${oracle.finalHeroHp}); ` +
    `${oracle.allSteps.length} steps, ${oracle.strategicCheckpoints.length} strategic checkpoints`);

  // --- Phase 2 + 3: one MT4 diagnostic run under the frozen cap=1024 configuration ---
  const initialState = simulator.createInitialState({ rank: FROZEN.initialRank });
  const isGoalState = (state) => state.floorId === FROZEN.goalFloorId;
  const frontierReport = buildDependencyFrontier(project, initialState, { type: "floorReached", floorId: FROZEN.goalFloorId });

  const lifecycle = new Map();
  let recordedEvents = 0;
  let totalEvents = 0;
  const mt3Arrivals = [];
  let mt3ArrivalCount = 0;
  const onCandidateLifecycle = (event) => {
    totalEvents += 1;
    if (event.type === "classified" && event.floorId === "MT3") {
      mt3ArrivalCount += 1;
      if (mt3Arrivals.length < 50) {
        mt3Arrivals.push({ exactKey: event.exactKey, hero: event.hero, frontierGuided: event.frontierGuided, guidedAdmitted: event.guidedAdmitted });
      }
    }
    if (oracleExactKeys.has(event.exactKey)) {
      recordedEvents += 1;
      let list = lifecycle.get(event.exactKey);
      if (!list) {
        list = [];
        lifecycle.set(event.exactKey, list);
      }
      list.push(event);
    }
  };

  const search = createTransportCollapsedSearch(simulator);
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
  });

  console.log(`Phase 3: search done found=${result.found} strategic=${result.strategicExpansions} ` +
    `dropped=${result.candidatesDropped} deepest=${result.deepestReachedFloorOrdinal} ` +
    `stopped=${result.stoppedReason} wall=${result.wallMs}ms rss=${result.peakRssMb}MB; ` +
    `lifecycle events total=${totalEvents} oracle-matched=${recordedEvents}`);

  // --- Survival analysis over the strategic checkpoints ---
  const checkpoints = oracle.strategicCheckpoints.map((cp) => {
    const events = lifecycle.get(cp.postKey) || [];
    const types = new Set(events.map((e) => e.type));
    const classified = [...events].reverse().find((e) => e.type === "classified") || null;
    return {
      step: cp.step,
      floorId: cp.floorAfterId,
      kind: cp.kind,
      summary: cp.summary,
      postKey: cp.postKey,
      seenInClosure: types.has("closureSeen"),
      generated: types.has("strategicGenerated"),
      duplicateSkipped: types.has("duplicateSkipped"),
      registered: types.has("registered"),
      dropped: types.has("dropped"),
      expanded: types.has("expanded"),
      frontierGuided: classified ? classified.frontierGuided === true : null,
      guidedAdmitted: classified ? classified.guidedAdmitted === true : null,
      skylineDominated: classified ? classified.skylineDominated === true : null,
      combatProgress: classified ? classified.combatProgress === true : null,
      depth: classified ? classified.depth : null,
    };
  });

  const expandedIndexes = checkpoints.filter((cp) => cp.expanded).map((cp) => cp.step);
  const lastExpandedStep = expandedIndexes.length > 0 ? expandedIndexes[expandedIndexes.length - 1] : null;
  const firstLoss = checkpoints.find((cp) => !cp.expanded) || null;
  let firstLossStage = null;
  let firstLossStep = null;
  if (firstLoss) {
    firstLossStep = firstLoss.step;
    firstLossStage = classifyStage(firstLoss, checkpoints, lifecycle);
    if (firstLossStage === "NEVER_GENERATED") {
      const idx = checkpoints.indexOf(firstLoss);
      if (idx > 0 && !checkpoints[idx - 1].expanded) {
        firstLossStage = "PREVIOUS_PREFIX_NEVER_EXPANDED";
      }
    }
  }

  const stageCounts = {};
  for (const cp of checkpoints) {
    if (!cp.expanded) {
      const stage = classifyStage(cp, checkpoints, lifecycle);
      stageCounts[stage] = (stageCounts[stage] || 0) + 1;
    }
  }

  const summary = {
    milestone: "PR-5.25t",
    audit: "MT4_ORACLE_PREFIX_SURVIVAL",
    oracleUse: "OBSERVATION_ONLY",
    oracleKeysAffectSearchDecisions: false,
    frozen: FROZEN,
    oracle: {
      fixture: path.relative(path.resolve(__dirname, ".."), ORACLE_FIXTURE),
      decisions: oracle.allSteps.length,
      strategicCheckpoints: oracle.strategicCheckpoints.length,
      finalFloorId: oracle.finalFloorId,
      finalHeroHp: oracle.finalHeroHp,
    },
    search: {
      found: result.found,
      strictReplay: "not-applicable-diagnostic",
      strategicExpansions: result.strategicExpansions,
      candidatesDropped: result.candidatesDropped,
      deepestReachedFloorOrdinal: result.deepestReachedFloorOrdinal,
      deepestStrategicDepth: result.deepestStrategicDepth,
      stoppedReason: result.stoppedReason,
      wallMs: result.wallMs,
      peakRssMb: result.peakRssMb,
      lifecycleEventsTotal: totalEvents,
      lifecycleEventsOracleMatched: recordedEvents,
      note: "instrumented diagnostic run; wall/expansion figures are indicative only",
    },
    verdict: {
      lastOracleCheckpointExpandedStep: lastExpandedStep,
      firstOracleCheckpointNotSurvivingStep: firstLossStep,
      firstLossStage,
      stageCountsOfNonSurvivingCheckpoints: stageCounts,
    },
    checkpoints,
    mt3ArrivalQuality: {
      classifiedMt3Arrivals: mt3ArrivalCount,
      samples: mt3Arrivals,
      note: "branch-D evidence: compare these against the oracle MT3-entry resource vectors",
    },
    oracleSteps: oracle.allSteps,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`);

  console.log("PR-5.25t MT4 oracle prefix survival audit");
  console.log(`  oracle: ${oracle.allSteps.length} steps -> ${oracle.strategicCheckpoints.length} strategic checkpoints`);
  console.log(`  search: found=${result.found} deepest=${result.deepestReachedFloorOrdinal} stopped=${result.stoppedReason}`);
  console.log(`  LAST_ORACLE_CHECKPOINT_EXPANDED = ${lastExpandedStep}`);
  console.log(`  FIRST_ORACLE_CHECKPOINT_NOT_SURVIVING = ${firstLossStep}`);
  console.log(`  FIRST_LOSS_STAGE = ${firstLossStage}`);
  console.log(`  non-surviving stage counts: ${JSON.stringify(stageCounts)}`);
  console.log(`  MT3 arrival states classified: ${mt3ArrivalCount}`);
  console.log(`  artifact: ${path.relative(process.cwd(), outPath)}`);
}

main();
