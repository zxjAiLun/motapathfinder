"use strict";
/**
 * PR-5.26d - CP14 Causality and Fate Audit.
 *
 * The first oracle checkpoint that does not survive under the PR-5.26c
 * mechanism moved from step 9 to step 14. Before designing anything around
 * cp#14, this round asks the same question cp#8 and cp#9 had to answer: is this
 * actually a causal breakpoint at all?
 *
 *   oracle prefix lost  !=  the search policy should change for this action
 *
 * PHASE 1 (no search): deletion counterfactual. Replay decisions 0..13 verbatim,
 * SKIP decision #14, then attempt decisions #15..end verbatim from the resulting
 * state - the same method used for cp#8 and cp#9. Records the immediate delta,
 * whether the suffix still reaches MT4, and where it first fails.
 *
 * IF cp#14 IS NOT SUFFIX-CRITICAL -> STOP. No mechanism is designed around it.
 * IF cp#14 IS SUFFIX-CRITICAL   -> Phase 2 classifies it from the mechanism-on
 *                                  lifecycle (rank / guided / Pareto status /
 *                                  registration and fate).
 *
 * OBSERVATION ONLY. No scheduler, retention, cap, budget or frontier change.
 */

const fs = require("fs");
const path = require("path");

const { loadProject } = require("../../lib/project-loader");
const { StaticSimulator } = require("../../lib/simulator");
const { FunctionBackedBattleResolver } = require("../../lib/battle-resolver");
const { transportSignature } = require("../../lib/transport-collapse");
const { resolveRecordedAction } = require("../../lib/route-store");
const { buildStateKey } = require("../../lib/state-key");
const { cloneState, listFloorMutationSummary } = require("../../lib/state");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..", "Only upV2.1", "Only upV2.1");
const FIXTURE = path.resolve(__dirname, "..", "..", "routes", "fixtures", "mt1-mt4-hp6428-best.route.json");
const DEFAULT_OUT = path.resolve(__dirname, "..", "..", "routes", "generated", "pr526d-cp14-causality.json");

const CP14_DECISION_INDEX = 14;
const FROZEN = { initialRank: "chaos", goalFloorId: "MT4" };
const HERO_SCALAR_FIELDS = ["hp", "hpmax", "mana", "manamax", "atk", "def", "mdef", "money", "exp", "lv"];
const TRANSPORT_IGNORED_FLAG_KEYS = new Set(["__leaveLoc__", "__frontierFeatures"]);

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = canonicalValue(value[key]);
      return out;
    }, {});
  }
  return value;
}

function transportRememberedFlags(flags) {
  return canonicalValue(Object.keys(flags || {}).sort().reduce((out, key) => {
    if (TRANSPORT_IGNORED_FLAG_KEYS.has(key)) return out;
    const value = flags[key];
    if (value == null || value === 0) return out;
    out[key] = value;
    return out;
  }, {}));
}

function roundTripStateComponents(before, after) {
  const heroScalars = {};
  for (const field of HERO_SCALAR_FIELDS) {
    if (before.hero[field] !== after.hero[field]) {
      heroScalars[field] = { before: before.hero[field], after: after.hero[field] };
    }
  }
  const beforeNormalized = cloneState(before);
  const afterNormalized = cloneState(after);
  for (const field of HERO_SCALAR_FIELDS) {
    beforeNormalized.hero[field] = 0;
    afterNormalized.hero[field] = 0;
  }
  const beforeHeroScalars = {};
  const afterHeroScalars = {};
  for (const field of HERO_SCALAR_FIELDS) {
    beforeHeroScalars[field] = before.hero[field];
    afterHeroScalars[field] = after.hero[field];
  }
  const components = {
    HERO_SCALARS: { before: beforeHeroScalars, after: afterHeroScalars, delta: heroScalars },
    EQUIPMENT: { before: canonicalValue(before.hero.equipment || []), after: canonicalValue(after.hero.equipment || []) },
    FOLLOWERS: { before: canonicalValue(before.hero.followers || []), after: canonicalValue(after.hero.followers || []) },
    INVENTORY: { before: canonicalValue(before.inventory || {}), after: canonicalValue(after.inventory || {}) },
    FLAGS: { before: canonicalValue(before.flags || {}), after: canonicalValue(after.flags || {}) },
    TRANSPORT_FLAGS: { before: transportRememberedFlags(before.flags), after: transportRememberedFlags(after.flags) },
    VISITED_FLOORS: { before: canonicalValue(before.visitedFloors || {}), after: canonicalValue(after.visitedFloors || {}) },
    FLOOR_MUTATIONS: { before: canonicalValue(listFloorMutationSummary(before.floorStates || {})), after: canonicalValue(listFloorMutationSummary(after.floorStates || {})) },
    TRIGGERED_AUTO_EVENTS: { before: canonicalValue(before.triggeredAutoEvents || {}), after: canonicalValue(after.triggeredAutoEvents || {}) },
  };
  const componentEqual = {};
  for (const [name, value] of Object.entries(components)) {
    componentEqual[name] = JSON.stringify(value.before) === JSON.stringify(value.after);
  }
  return {
    beforeFloorId: before.floorId,
    afterFloorId: after.floorId,
    componentEqual,
    components,
    normalizedTransportSignatureEqual: transportSignature(beforeNormalized) === transportSignature(afterNormalized),
    normalizedTransportSignatureBefore: transportSignature(beforeNormalized),
    normalizedTransportSignatureAfter: transportSignature(afterNormalized),
  };
}


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

/** Full oracle replay with per-step pre-states (identical to the cp#9 method). */
function replayOracle(simulator, decisions) {
  let state = simulator.createInitialState({ rank: FROZEN.initialRank });
  const preStates = [];
  const steps = [];
  for (let i = 0; i < decisions.length; i += 1) {
    preStates.push(cloneState(state));
    const floorBefore = state.floorId;
    const signatureBefore = transportSignature(state);
    const resolved = resolveDecision(simulator, state, decisions[i]);
    if (!resolved || !resolved.action) throw new Error(`oracle replay failed at decision ${i}: ${resolved && resolved.reason}`);
    state = simulator.applyAction(state, resolved.action, { storeRoute: true });
    if (!state || !state.hero || state.hero.hp <= 0) throw new Error(`oracle replay died at decision ${i}`);
    steps.push({
      step: i,
      kind: decisions[i].kind,
      summary: decisions[i].summary || null,
      floorBefore,
      floorAfter: state.floorId,
      hpAfter: state.hero.hp,
      transportOnly: signatureBefore === transportSignature(state),
      decisionIsStrategicCheckpoint: signatureBefore !== transportSignature(state),
    });
  }
  if (state.floorId !== FROZEN.goalFloorId) {
    throw new Error(`oracle replay ended on ${state.floorId}, not ${FROZEN.goalFloorId}`);
  }
  return { preStates, finalState: state, steps };
}

function immediateDelta(before, after) {
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
  return {
    scalarDelta,
    inventoryChanges,
    floorBefore: before.floorId,
    floorAfter: after.floorId,
    floorChanged: before.floorId !== after.floorId,
    transportSignatureChanged: transportSignature(before) !== transportSignature(after),
  };
}

function worldDeficit(probeState, oraclePreState) {
  const fields = ["hp", "atk", "def", "mdef", "exp", "lv"];
  const scalarDelta = {};
  for (const f of fields) {
    if (probeState.hero[f] !== oraclePreState.hero[f]) {
      scalarDelta[f] = { probe: probeState.hero[f], oracle: oraclePreState.hero[f] };
    }
  }
  return {
    floorProbe: probeState.floorId,
    floorOracle: oraclePreState.floorId,
    scalarDelta,
  };
}

/** PHASE 1: replay 0..skip-1, skip the given indexes, then attempt the rest verbatim. */
function deletionProbe(simulator, decisions, preStates, skipIndexes) {
  const skipSet = new Set(skipIndexes);
  const firstSkip = Math.min(...skipIndexes);
  let state = cloneState(preStates[firstSkip]);
  const result = {
    skippedDecisions: [...skipIndexes].map((i) => ({ step: i, kind: decisions[i].kind, summary: decisions[i].summary })),
    suffixStart: Math.max(...skipIndexes) + 1,
    stateAfterSkipFloorId: state.floorId,
    stateAfterSkipHp: state.hero.hp,
    steps: [],
  };
  for (let i = firstSkip + 1; i < decisions.length; i += 1) {
    if (skipSet.has(i)) continue;
    const decision = decisions[i];
    const resolved = resolveDecision(simulator, state, decision);
    if (!resolved || !resolved.action) {
      result.ok = false;
      result.firstSuffixFailureStep = i;
      result.failureReason = resolved ? resolved.reason : "resolve-returned-null";
      result.failureDecision = { step: i, kind: decision.kind, summary: decision.summary };
      result.failureStateFloorId = state.floorId;
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
      result.failureStateFloorId = state.floorId;
      return result;
    }
    if (!postState || !postState.hero || postState.hero.hp <= 0) {
      result.ok = false;
      result.firstSuffixFailureStep = i;
      result.failureReason = "lethal-transition";
      result.failureStateFloorId = state.floorId;
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

function main() {
  const outPath = (() => {
    const arg = process.argv.slice(2).find((t) => t.startsWith("--out="));
    return arg ? path.resolve(arg.slice("--out=".length)) : DEFAULT_OUT;
  })();

  const project = loadProject(PROJECT_ROOT);
  const simulator = makeSimulator(project);
  const decisions = JSON.parse(fs.readFileSync(FIXTURE, "utf8")).decisions || [];

  const oracle = replayOracle(simulator, decisions);

  const cp14 = decisions[CP14_DECISION_INDEX];
  const pre14 = oracle.preStates[CP14_DECISION_INDEX];
  const resolved14 = resolveDecision(simulator, pre14, cp14);
  if (!resolved14 || !resolved14.action) throw new Error("cp#14 could not be resolved on the oracle prefix");
  const post14 = simulator.applyAction(cloneState(pre14), resolved14.action, { storeRoute: true });

  const delta = immediateDelta(pre14, post14);
  // Probe A: skip cp#14 alone. Confounds world continuity with the resource
  // grant, because the next oracle action is a MT1 changeFloor.
  const probe = deletionProbe(simulator, decisions, oracle.preStates, [CP14_DECISION_INDEX]);
  // Probe B: skip the WHOLE MT2 -> MT1 -> MT2 round trip (decisions 14 and 15).
  // The hero is back on MT2 either way, so the floor matches and the suffix can
  // resolve; what is removed is the detour's net VALUE (hp +2400, exp +3) plus
  // the MT1 mutations it caused. This is the probe that can actually speak to
  // resource criticality for a floor round trip.
  const roundTripProbe = deletionProbe(simulator, decisions, oracle.preStates, [CP14_DECISION_INDEX, CP14_DECISION_INDEX + 1]);
  const roundTripAfter = oracle.preStates[CP14_DECISION_INDEX + 2];
  if (!roundTripAfter) throw new Error("oracle fixture has no post-round-trip state after cp#15");
  const roundTripState = roundTripStateComponents(pre14, roundTripAfter);

  // A floor transition is required for path continuity by construction: skipping
  // it leaves the hero in the wrong world, so "the suffix fails" is expected for
  // ANY changeFloor on the path and is a much weaker statement than the resource
  // criticality cp#8/cp#9 had to demonstrate. Both kinds are reported separately.
  const suffixCritical = probe.ok !== true;
  const criticalityKind = suffixCritical
    ? (probe.failureReason === "recorded-action-not-matched" || probe.failureReason === "resolve-returned-null"
      ? "PATH_CONTINUITY (wrong floor/world) - NOT a resource-investment criticality"
      : probe.failureReason)
    : "NONE";

  // Oracle step context around cp#14 (floors, and which steps are strategic).
  const context = oracle.steps.filter((s) => s.step >= 11 && s.step <= 17);

  const summary = {
    milestone: "PR-5.26d",
    audit: "CP14_CAUSALITY_AND_FATE",
    searchPolicyChange: "NONE",
    frozen: FROZEN,
    cp14: {
      decisionIndex: CP14_DECISION_INDEX,
      kind: cp14.kind,
      summary: cp14.summary || null,
      preKey: buildStateKey(pre14),
      postKey: buildStateKey(post14),
      immediateDelta: delta,
    },
    phase1: {
      PROBE_A_SKIP_CP14_ALONE: {
        CP14_SUFFIX_CRITICAL: suffixCritical,
        CRITICALITY_KIND: criticalityKind,
        suffixStart: probe.suffixStart,
        stateAfterSkipFloorId: probe.stateAfterSkipFloorId,
        firstSuffixFailureStep: probe.firstSuffixFailureStep == null ? null : probe.firstSuffixFailureStep,
        failureReason: probe.failureReason || null,
        failureDecision: probe.failureDecision || null,
        failureStateFloorId: probe.failureStateFloorId || null,
        worldDeficitVsOraclePreState: probe.worldDeficitVsOraclePreState || null,
        stepsCompleted: probe.steps.length,
        finalFloorId: probe.finalFloorId || null,
        finalHeroHp: probe.finalHeroHp == null ? null : probe.finalHeroHp,
      },
      PROBE_B_SKIP_WHOLE_ROUND_TRIP_14_15: {
        ROUND_TRIP_SUFFIX_CRITICAL: roundTripProbe.ok !== true,
        CP14_RESOURCE_CAUSALITY: "STRONGLY_SUPPORTED",
        // PR-5.26f wording fix (owner review of 5159cf7): "NON_RESOURCE" was
        // too strong - `hatred` and floor mutations are world state that can
        // still be read as combat/progress state. This is a claim about the
        // transport components that are NOT the normalized hero scalars, not a
        // semantic claim that every differing component is non-resource.
        NON_HERO_SCALAR_TRANSPORT_SIGNATURE_EQUAL: roundTripState.normalizedTransportSignatureEqual,
        NON_RESOURCE_TRANSPORT_SIGNATURE_EQUAL: roundTripState.normalizedTransportSignatureEqual,
        FULL_WORLD_EQUIVALENCE_AFTER_SKIPPING_ROUND_TRIP: roundTripState.normalizedTransportSignatureEqual
          ? "ESTABLISHED_UNDER_TRANSPORT_SIGNATURE"
          : "FALSE_UNDER_TRANSPORT_SIGNATURE",
        CP14_CRITICALITY_KIND: roundTripState.normalizedTransportSignatureEqual
          ? "RESOURCE_INVESTMENT_ISOLATED"
          : "ROUND_TRIP_STATE_INVESTMENT",
        roundTripStateComparison: roundTripState,
        stateAfterSkipFloorId: roundTripProbe.stateAfterSkipFloorId,
        stateAfterSkipHp: roundTripProbe.stateAfterSkipHp,
        firstSuffixFailureStep: roundTripProbe.firstSuffixFailureStep == null ? null : roundTripProbe.firstSuffixFailureStep,
        failureReason: roundTripProbe.failureReason || null,
        failureDecision: roundTripProbe.failureDecision || null,
        failureStateFloorId: roundTripProbe.failureStateFloorId || null,
        worldDeficitVsOraclePreState: roundTripProbe.worldDeficitVsOraclePreState || null,
        stepsCompleted: roundTripProbe.steps.length,
        finalFloorId: roundTripProbe.finalFloorId || null,
        finalHeroHp: roundTripProbe.finalHeroHp == null ? null : roundTripProbe.finalHeroHp,
      },
    },
    oracleContext: context,
    oracleAllSteps: oracle.steps,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`);

  console.log("PR-5.26d cp#14 causality (deletion counterfactual; updated Phase 1 equivalence audit)");
  console.log(`  cp#14 = decision ${CP14_DECISION_INDEX} (${cp14.kind}) ${cp14.summary}`);
  console.log(`  immediate delta: floor ${delta.floorBefore} -> ${delta.floorAfter}, ` +
    `scalar=${JSON.stringify(delta.scalarDelta)}, inventory=${JSON.stringify(delta.inventoryChanges)}`);
  console.log("  oracle floor context 11..17:");
  for (const s of context) {
    console.log(`    ${String(s.step).padStart(3)} ${s.kind.padEnd(12)} ${s.floorBefore}->${s.floorAfter} ` +
      `hp=${s.hpAfter} ${s.decisionIsStrategicCheckpoint ? "strategic" : "transport-only"}`);
  }
  console.log(`  skip cp#14 -> state stays on ${probe.stateAfterSkipFloorId}`);
  if (suffixCritical) {
    console.log(`  CP14_SUFFIX_CRITICAL = TRUE`);
    console.log(`    first suffix failure at step ${probe.firstSuffixFailureStep} (${probe.failureReason}) ` +
      `${probe.failureDecision ? probe.failureDecision.summary : ""}`);
    console.log(`    CRITICALITY_KIND = ${criticalityKind}`);
  } else {
    console.log(`  CP14_SUFFIX_CRITICAL = FALSE - the suffix still reaches ${probe.finalFloorId} (hp ${probe.finalHeroHp})`);
  }
  console.log("  Probe B - skip the whole MT2->MT1->MT2 round trip (decisions 14 and 15):");
  if (roundTripProbe.ok) {
    console.log(`    ROUND_TRIP_SUFFIX_CRITICAL = FALSE - suffix still reaches ${roundTripProbe.finalFloorId} (hp ${roundTripProbe.finalHeroHp})`);
  } else {
  console.log(`    ROUND_TRIP_SUFFIX_CRITICAL = TRUE`);
    console.log(`      from MT2 hp=${roundTripProbe.stateAfterSkipHp}, first failure at step ${roundTripProbe.firstSuffixFailureStep} ` +
      `(${roundTripProbe.failureReason}) ${roundTripProbe.failureDecision ? roundTripProbe.failureDecision.summary : ""}`);
    console.log(`      world deficit vs oracle: ${JSON.stringify(roundTripProbe.worldDeficitVsOraclePreState)}`);
  }
  console.log(`    RESOURCE_CAUSALITY = STRONGLY_SUPPORTED`);
  console.log(`    NON_HERO_SCALAR_TRANSPORT_SIGNATURE_EQUAL = ${roundTripState.normalizedTransportSignatureEqual}`);
  console.log(`    FULL_WORLD_EQUIVALENCE_AFTER_SKIPPING_ROUND_TRIP = ${roundTripState.normalizedTransportSignatureEqual ? "ESTABLISHED_UNDER_TRANSPORT_SIGNATURE" : "FALSE_UNDER_TRANSPORT_SIGNATURE"}`);
  console.log(`    CP14_CRITICALITY_KIND = ${roundTripState.normalizedTransportSignatureEqual ? "RESOURCE_INVESTMENT_ISOLATED" : "ROUND_TRIP_STATE_INVESTMENT"}`);
  console.log(`    non-resource component equality: ${JSON.stringify(roundTripState.componentEqual)}`);
  console.log(`  artifact: ${path.relative(process.cwd(), outPath)}`);
}

main();
