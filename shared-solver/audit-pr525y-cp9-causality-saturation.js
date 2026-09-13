"use strict";
/**
 * PR-5.25y - CP9 Causality and Rank20 Saturation Diagnostic.
 *
 * REPLAY / COUNTERFACTUAL + one observational 2,000-expansion run.
 * No search policy change.
 *
 * PHASE 1  cp#9 deletion probe (the PR-5.25w method applied one link later):
 *          replay decisions 0..8 (WITH cp#8), SKIP decision #9
 *          (battle:redBat@MT1:10,1), then attempt decisions #10..end verbatim.
 *          Records the redBat transition delta, the suffix outcome, the world
 *          deficit at failure, and the direct step-10 skeleton viability.
 *
 * PHASE 2  rank20 saturation snapshot: run the frozen MT4 configuration with
 *          a 2,000-expansion cap and the lifecycle observer; capture the rank
 *          composition (pending/kept per class, rank-20 cutoff position) of
 *          every trim that drops an oracle key, especially the trim that
 *          drops cp#9. CP9_KEY_AFFECTS_SEARCH_DECISIONS = FALSE - the keys
 *          only filter the observer's log.
 *
 * Case classification for the cp#9 drop trim:
 *   A: rank10 fills most of the cap          -> guided vs investment allocation
 *   B: rank20 exceeds the remaining capacity -> binary class too coarse
 *   C: cp#9 within the rank20 cutoff yet dropped -> lifecycle bug
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
const { cloneState } = require("./lib/state");

const PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const FIXTURE = path.resolve(__dirname, "routes", "fixtures", "mt1-mt4-hp6428-best.route.json");
const CP9_SUMMARY_MARKER = "battle:redBat@MT1:10,1";
const CP9_DECISION_INDEX = 9;
const DIAGNOSTIC_MAX_EXPANSIONS = 2000;
const DEFAULT_OUT = path.resolve(__dirname, "routes", "generated", "pr525y-cp9-causality-saturation.json");

const FROZEN = {
  initialRank: "chaos",
  region: ["MT1", "MT2", "MT3", "MT4"],
  goalFloorId: "MT4",
  maxRuntimeMs: 180000,
  maxRssMb: 2048,
  maxExpansions: DIAGNOSTIC_MAX_EXPANSIONS,
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

/** PHASE 1: full oracle replay with per-step pre-states. */
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

/** PHASE 1: cp#9 immediate delta. */
function cp9Delta(before, after) {
  const fields = ["hp", "hpmax", "mana", "manamax", "atk", "def", "mdef", "money", "exp", "lv"];
  const scalarDelta = {};
  for (const f of fields) {
    if (before.hero[f] !== after.hero[f]) scalarDelta[f] = { before: before.hero[f], after: after.hero[f] };
  }
  const inventoryChanges = {};
  for (const key of new Set([...Object.keys(before.inventory || {}), ...Object.keys(after.inventory || {})])) {
    if ((before.inventory || {})[key] !== (after.inventory || {})[key]) {
      inventoryChanges[key] = { before: (before.inventory || {})[key] || 0, after: (after.inventory || {})[key] || 0 };
    }
  }
  const flagsChanges = {};
  for (const key of new Set([...Object.keys(before.flags || {}), ...Object.keys(after.flags || {})])) {
    if ((before.flags || {})[key] !== (after.flags || {})[key]) {
      flagsChanges[key] = { before: (before.flags || {})[key] || null, after: (after.flags || {})[key] || null };
    }
  }
  return {
    scalarDelta,
    inventoryChanges,
    flagsChanges,
    floorId: after.floorId,
    floorChanged: before.floorId !== after.floorId,
    transportSignatureChanged: transportSignature(before) !== transportSignature(after),
  };
}

/** PHASE 1: cp#9 deletion probe - replay 0..8, skip 9, attempt 10..end. */
function deletionProbe(simulator, decisions, preStates) {
  const skipIndex = CP9_DECISION_INDEX;
  let state = cloneState(preStates[skipIndex]);
  const skipped = decisions[skipIndex];
  const result = {
    skippedDecision: { step: skipIndex, kind: skipped.kind, summary: skipped.summary },
    suffixStart: skipIndex + 1,
    steps: [],
  };
  for (let i = skipIndex + 1; i < decisions.length; i += 1) {
    const decision = decisions[i];
    const resolved = resolveDecision(simulator, state, decision);
    if (!resolved || !resolved.action) {
      result.ok = false;
      result.firstSuffixFailureStep = i;
      result.failureReason = resolved ? resolved.reason : "resolve-returned-null";
      result.failureDecision = { step: i, kind: decision.kind, summary: decision.summary };
      result.failureState = cloneState(state);
      result.worldDeficitVsOraclePreState = worldDeficit(state, preStates[i]);
      return result;
    }
    let postState = null;
    try {
      postState = simulator.applyAction(state, resolved.action, { storeRoute: true });
    } catch (error) {
      result.ok = false;
      result.firstSuffixFailureStep = i;
      result.failureReason = `apply-action-threw: ${error.message}`;
      result.failureState = cloneState(state);
      return result;
    }
    if (!postState || !postState.hero || postState.hero.hp <= 0) {
      result.ok = false;
      result.firstSuffixFailureStep = i;
      result.failureReason = "lethal-transition";
      result.failureState = cloneState(state);
      return result;
    }
    result.steps.push({ step: i, summary: resolved.action.summary, matchType: resolved.matchType || null });
    state = postState;
  }
  result.ok = true;
  result.finalFloorId = state.floorId;
  result.finalHeroHp = state.hero.hp;
  return result;
}

function worldDeficit(probeState, oraclePreState) {
  const fields = ["hp", "atk", "def", "mdef", "exp", "lv"];
  const scalarDelta = {};
  for (const f of fields) {
    if (probeState.hero[f] !== oraclePreState.hero[f]) {
      scalarDelta[f] = { probe: probeState.hero[f], oracle: oraclePreState.hero[f] };
    }
  }
  return { scalarDelta };
}

/** Direct viability evaluation of a recorded battle decision at an arbitrary state. */
function evaluateBattleForDecision(simulator, state, decision) {
  const summaryParts = (decision.summary || "").split("@");
  const targetPart = (summaryParts[1] || "").split(":");
  const enemyId = (summaryParts[0] || "").split(":")[1] || null;
  const evaluation = simulator.battleResolver.evaluateBattle(
    state,
    targetPart[0] || state.floorId,
    Number(targetPart[1]),
    Number(targetPart[2]),
    enemyId,
  );
  return {
    supported: evaluation ? Boolean(evaluation.supported) : null,
    damage: evaluation && evaluation.damageInfo && evaluation.damageInfo.damage != null ? evaluation.damageInfo.damage : null,
    heroHp: state.hero.hp,
    heroAtk: state.hero.atk,
    heroDef: state.hero.def,
    winnable: evaluation && evaluation.damageInfo && evaluation.damageInfo.damage != null,
    lethal: evaluation && evaluation.damageInfo && evaluation.damageInfo.damage != null
      ? evaluation.damageInfo.damage >= state.hero.hp
      : null,
  };
}

function main() {
  const outPath = (() => {
    const arg = process.argv.slice(2).find((t) => t.startsWith("--out="));
    return arg ? path.resolve(arg.slice("--out=".length)) : DEFAULT_OUT;
  })();

  const project = loadProject(PROJECT_ROOT);
  const simulator = makeSimulator(project);
  const record = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
  const decisions = Array.isArray(record.decisions) ? record.decisions : [];

  // --- PHASE 1: oracle replay + cp#9 deletion probe ---
  const oracle = replayOracle(simulator, decisions);
  const cp9Pre = oracle.preStates[CP9_DECISION_INDEX];
  const cp9Post = (() => {
    const resolved = resolveDecision(simulator, cp9Pre, decisions[CP9_DECISION_INDEX]);
    if (!resolved || !resolved.action) throw new Error("cp9 decision failed to resolve on oracle replay");
    return simulator.applyAction(cp9Pre, resolved.action, { storeRoute: true });
  })();
  const cp9DeltaResult = cp9Delta(cp9Pre, cp9Post);
  const cp9Key = buildStateKey(cp9Post);
  console.log(`Phase 1: cp#9 = decision ${CP9_DECISION_INDEX} (${decisions[CP9_DECISION_INDEX].summary}); post-key ${cp9Key.slice(0, 60)}...`);
  console.log(`  cp#9 immediate delta: ${JSON.stringify(cp9DeltaResult.scalarDelta)}`);

  const probe = deletionProbe(simulator, decisions, oracle.preStates);
  if (probe.ok) {
    console.log(`Phase 1: cp9-skipped suffix REACHES ${probe.finalFloorId} (hp ${probe.finalHeroHp}) - CP9_SUFFIX_CRITICAL = FALSE for this oracle`);
  } else {
    console.log(`Phase 1: cp9-skipped suffix FAILS at step ${probe.firstSuffixFailureStep} (${probe.failureReason})`);
    console.log(`  failing decision: ${JSON.stringify(probe.failureDecision)}`);
    if (probe.worldDeficitVsOraclePreState) {
      console.log(`  world deficit vs oracle: ${JSON.stringify(probe.worldDeficitVsOraclePreState.scalarDelta)}`);
    }
  }

  // Direct viability of the failing decision's battle at the probe state.
  let failingViability = null;
  if (probe.ok === false && probe.failureState && probe.failureDecision.kind === "battle") {
    failingViability = evaluateBattleForDecision(simulator, probe.failureState, probe.failureDecision);
    // And at the ORACLE pre-state of the same step (for the comparison).
    const oracleViability = evaluateBattleForDecision(simulator, oracle.preStates[probe.firstSuffixFailureStep], probe.failureDecision);
    failingViability.oracleComparison = oracleViability;
    console.log(`  failing battle viability at probe state: ${JSON.stringify(failingViability)}`);
  }

  // --- PHASE 2: 2,000-expansion observational run under the frozen MT4 config ---
  const initialState = simulator.createInitialState({ rank: FROZEN.initialRank });
  const isGoalState = (s) => s.floorId === FROZEN.goalFloorId;
  const frontierReport = buildDependencyFrontier(project, initialState, { type: "floorReached", floorId: FROZEN.goalFloorId });

  const oracleKeys = new Set(oracle.preStates.map((s) => buildStateKey(s)));
  const cp9Events = [];
  const dropTrimsWithOracleDrops = [];
  let totalEvents = 0;
  let cp9FateObserved = false;
  let cp9Fate = null;
  const onCandidateLifecycle = (event) => {
    totalEvents += 1;
    if (oracleKeys.has(event.exactKey)) {
      if (event.type === "dropped") {
        dropTrimsWithOracleDrops.push({
          exactKey: event.exactKey,
          rankClass: event.rankClass,
          nodePendingSeq: event.nodePendingSeq,
          trim: event.trim,
        });
      }
      if (event.exactKey === cp9Key) {
        cp9Events.push(event);
        if ((event.type === "dropped" || event.type === "expanded") && !cp9FateObserved) {
          cp9FateObserved = true;
          cp9Fate = event.type;
        }
      }
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

  console.log(`Phase 2: observational run done found=${result.found} strategic=${result.strategicExpansions} ` +
    `dropped=${result.candidatesDropped} stopped=${result.stoppedReason} wall=${result.wallMs}ms; ` +
    `events=${totalEvents}, cp9 events=${cp9Events.length}, fate=${cp9Fate || "NOT_OBSERVED_WITHIN_BUDGET"}`);
  for (const d of dropTrimsWithOracleDrops.slice(0, 10)) {
    console.log(`  oracle drop: rankClass=${d.rankClass} seq=${d.nodePendingSeq} pending=${JSON.stringify(d.trim.pendingRankCounts)} kept=${JSON.stringify(d.trim.keptRankCounts)} rank20CutoffSeq=${d.trim.rank20CutoffPendingSeq}`);
  }

  const summary = {
    milestone: "PR-5.25y",
    audit: "CP9_CAUSALITY_AND_RANK20_SATURATION",
    searchRun: "DIAGNOSTIC_ONLY_2000_EXPANSIONS",
    cp9KeyAffectsSearchDecisions: false,
    frozen: FROZEN,
    cp9: {
      decisionIndex: CP9_DECISION_INDEX,
      summary: decisions[CP9_DECISION_INDEX].summary,
      immediateDelta: cp9DeltaResult,
      postKey: cp9Key,
    },
    phase1DeletionProbe: probe,
    failingBattleViability: failingViability,
    phase2: {
      found: result.found,
      strategicExpansions: result.strategicExpansions,
      candidatesDropped: result.candidatesDropped,
      stoppedReason: result.stoppedReason,
      combatProgressGenerated: result.combatProgressGenerated,
      combatProgressAdmittedGenerated: result.combatProgressAdmittedGenerated,
      fifoHeadProtected: result.fifoHeadProtected,
      deepestReachedFloorOrdinal: result.deepestReachedFloorOrdinal,
      totalLifecycleEvents: totalEvents,
      cp9EventCount: cp9Events.length,
      cp9Fate,
      cp9Events,
      dropTrimsWithOracleDrops,
    },
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`  artifact: ${path.relative(process.cwd(), outPath)}`);
}

main();
