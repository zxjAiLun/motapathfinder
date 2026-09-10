"use strict";

// PR-5.25i On-Policy Floor Transition Dynamics Probe.
//
// The 5.25h Repair 1 telemetry showed changeFloor being selected ~2355/3072
// steps while rollouts still only reached MT3 in 1/32 cases.  This probe asks
// the follow-up question with ZERO training and ZERO parameter change:
//
//   what are those changeFloor selections actually doing?
//
// Kept exactly: dd5e597 hierarchical policy, 32 paired seeds, H=96, T=1.0,
// CONTROL = proper kind-prior-only, TREATMENT = kind-prior + within-kind
// residual, true MT5 blueKing terminal.
//
// Telemetry added per rollout:
//   - sourceFloor -> destinationFloor transition matrix (from the resulting
//     state, so it is exact) and forward(delta>0) / backward(delta<0) totals
//   - forwardChangeFloorAvailable at each step; specifically at MT2
//   - when a forward stair is available: how often a forward changeFloor is
//     actually chosen, and (treatment) the probability mass on forward stairs
//   - immediate floor reversal (change floor, then change straight back)
//   - exact-state revisit rate / unique exact states
//   - first-hit step for MT2 / MT3
//
// The aggregates are then classified advisory into:
//   B PREREQUISITE_SEQUENCING_PROBLEM (forward stair rarely available)
//   C HORIZON_PRESSURE_OBSERVED       (forward stair appears late, then chosen)
//   A ON_POLICY_WITHIN_KIND_TRANSFER_PROBLEM (available but chosen wrongly)
//   D CYCLIC_PROPOSAL_BEHAVIOR        (high exact-state revisit / ping-pong)

const { buildStateKey } = require("./state-key");
const prior = require("./learned-action-prior");
const inventory = require("./learned-prior-corpus-inventory");
const dataset = require("./learned-prior-dataset");
const experiment = require("./learned-prior-nonoverlap-experiment");
const hierarchical = require("./learned-prior-hierarchical-residual-experiment");
const repair = require("./learned-prior-changefloor-repair-experiment");

const EXTENSION_SEED = hierarchical.EXTENSION_SEED;

// forward / backward / lateral for an enumerated changeFloor action.
function changeFloorDirection(state, action, floorOrder) {
  if (!action || action.kind !== "changeFloor") return null;
  try {
    const delta = prior.changeFloorDestinationDelta(state, action, { floorOrder });
    if (delta > 0) return "forward";
    if (delta < 0) return "backward";
    return "lateral";
  } catch (error) {
    return "unresolved";
  }
}

function runInstrumentedRollout(simulator, options) {
  const config = options || {};
  const mode = config.mode === "treatment" ? "treatment" : "control";
  const residualModel = config.residualModel || null;
  const kindProbability = config.kindProbability;
  const horizon = config.horizon == null ? 96 : config.horizon;
  const temperature = config.temperature == null ? 1 : config.temperature;
  const floorOrder = config.floorOrder;
  const rng = prior.mulberry32((config.seed == null ? 1 : config.seed) >>> 0);
  const kindNames = prior.FEATURE_SCHEMA.actionKinds;

  let state = simulator.createInitialState({ rank: "chaos" });
  const stateKeys = new Set();
  const initialKey = buildStateKey(state);
  stateKeys.add(initialKey);

  const floorTransitions = {};
  const kindHistogram = {};
  let forwardCount = 0;
  let backwardCount = 0;
  let lateralCount = 0;
  let floorChangeCount = 0;
  // NOTE: this counts CONSECUTIVE floor-change events that are mutual
  // inverses.  Non-floor-change actions (battle/event/pickup) in between do NOT
  // reset it, so it is NOT a strict "immediate" reversal; the field name says
  // what it measures.
  let consecutiveFloorChangeReversals = 0;
  let previousFloorChange = null; // { from, to }

  let stepsAtMt2 = 0;
  let mt2ForwardAvailableSteps = 0;
  let mt2ForwardChosenSteps = 0;
  let mt2ForwardLandedMt3Steps = 0;
  let forwardAvailableSteps = 0;
  let forwardChosenSteps = 0;
  let changeFloorChosenWhenForwardAvailable = 0;
  let steps = 0;
  let terminal = false;
  let errorClass = null;
  let maxFloorId = state.floorId;
  let maxFloorOrdinal = prior.floorOrdinal(state.floorId);
  let reachedMt2 = maxFloorOrdinal >= 2;
  let reachedMt3 = maxFloorOrdinal >= 3;
  let reachedMt4 = maxFloorOrdinal >= 4;
  let reachedMt5 = maxFloorOrdinal >= 5;
  let firstHitMt2Step = reachedMt2 ? 0 : null;
  let firstHitMt3Step = reachedMt3 ? 0 : null;
  let firstForwardAvailableStep = null;
  let firstMt2ForwardAvailableStep = null;
  let forwardProbabilityMassSum = 0;
  let forwardProbabilityMassSteps = 0;

  for (let step = 0; step < horizon; step += 1) {
    if (repair.isBlueKingTerminal(state)) {
      terminal = true;
      break;
    }
    let actions = [];
    try {
      actions = (simulator.enumeratePrimitiveActions(state) || {}).actions || [];
    } catch (error) {
      errorClass = "enumerate-error";
      break;
    }
    if (actions.length === 0) {
      errorClass = "no-legal-actions";
      break;
    }

    const currentFloor = state.floorId;
    const directions = actions.map((action) => changeFloorDirection(state, action, floorOrder));
    const forwardFlags = directions.map((direction) => direction === "forward");
    const forwardAvailable = forwardFlags.some(Boolean);

    if (currentFloor === "MT2") {
      stepsAtMt2 += 1;
      if (forwardAvailable) {
        mt2ForwardAvailableSteps += 1;
        if (firstMt2ForwardAvailableStep == null) firstMt2ForwardAvailableStep = step;
      }
    }    if (forwardAvailable) {
      forwardAvailableSteps += 1;
      if (firstForwardAvailableStep == null) firstForwardAvailableStep = step;
    }

    const vectors = actions.map((action) => prior.encodeFeaturesV2(state, action, { floorOrder }));
    const residualScores = residualModel ? vectors.map((vector) => residualModel.score(vector)) : vectors.map(() => 0);

    if (forwardAvailable && residualModel) {
      const probabilities = hierarchical.analyticTwoStageProbabilities(vectors, residualScores, kindProbability);
      let mass = 0;
      for (let index = 0; index < forwardFlags.length; index += 1) {
        if (forwardFlags[index]) mass += probabilities[index];
      }
      forwardProbabilityMassSum += mass;
      forwardProbabilityMassSteps += 1;
    }

    const picked = hierarchical.sampleKindThenAction(
      vectors, residualScores, kindProbability, rng, temperature, Boolean(residualModel),
    );
    const chosenKind = picked.kind;
    const chosenDirection = directions[picked.index];

    if (forwardAvailable && chosenKind === kindNames.indexOf("changeFloor")) {
      changeFloorChosenWhenForwardAvailable += 1;
      if (chosenDirection === "forward") forwardChosenSteps += 1;
    }
    // MT2-specific: this is the metric that matters for the MT2->MT3
    // prerequisite, since most "forward available" steps elsewhere are MT1.
    if (currentFloor === "MT2" && forwardAvailable && chosenDirection === "forward") {
      mt2ForwardChosenSteps += 1;
    }
    kindHistogram[kindNames[chosenKind] || `kind${chosenKind}`] = (kindHistogram[kindNames[chosenKind] || `kind${chosenKind}`] || 0) + 1;

    try {
      state = simulator.applyAction(state, actions[picked.index], { storeRoute: false });
    } catch (error) {
      errorClass = "apply-error";
      break;
    }
    steps += 1;

    if (currentFloor === "MT2" && chosenDirection === "forward" && state.floorId === "MT3") {
      mt2ForwardLandedMt3Steps += 1;
    }

    // Floor transition is read from the resulting state, so it is exact.
    if (state.floorId !== currentFloor) {
      const transition = `${currentFloor}->${state.floorId}`;
      floorTransitions[transition] = (floorTransitions[transition] || 0) + 1;
      floorChangeCount += 1;
      const direction = chosenDirection
        || (prior.floorOrdinal(state.floorId) > prior.floorOrdinal(currentFloor) ? "forward" : "backward");
      if (direction === "forward") forwardCount += 1;
      else if (direction === "backward") backwardCount += 1;
      else lateralCount += 1;
      if (previousFloorChange && previousFloorChange.from === state.floorId && previousFloorChange.to === currentFloor) {
        consecutiveFloorChangeReversals += 1;
      }
      previousFloorChange = { from: currentFloor, to: state.floorId };
    }

    const ordinal = prior.floorOrdinal(state.floorId);
    if (ordinal > maxFloorOrdinal) {
      maxFloorOrdinal = ordinal;
      maxFloorId = state.floorId;
    }
    if (ordinal >= 2) {
      reachedMt2 = true;
      if (firstHitMt2Step == null) firstHitMt2Step = step + 1;
    }
    if (ordinal >= 3) {
      reachedMt3 = true;
      if (firstHitMt3Step == null) firstHitMt3Step = step + 1;
    }
    if (ordinal >= 4) reachedMt4 = true;
    if (ordinal >= 5) reachedMt5 = true;

    // Set semantics: repeated keys do not grow the set, so uniqueExactStates is
    // the number of distinct exact states visited.
    stateKeys.add(buildStateKey(state));
  }
  if (!terminal) terminal = repair.isBlueKingTerminal(state);

  return {
    seed: config.seed,
    mode,
    steps,
    terminal,
    maxFloorId,
    maxFloorOrdinal,
    reachedMt2,
    reachedMt3,
    reachedMt4,
    reachedMt5,
    errorClass,
    floorTransitions,
    kindHistogram,
    forwardCount,
    backwardCount,
    lateralCount,
    floorChangeCount,
    consecutiveFloorChangeReversals,
    stepsAtMt2,
    mt2ForwardAvailableSteps,
    mt2ForwardChosenSteps,
    mt2ForwardLandedMt3Steps,
    forwardAvailableSteps,
    forwardChosenSteps,
    changeFloorChosenWhenForwardAvailable,
    forwardProbabilityMassSum,
    forwardProbabilityMassSteps,
    uniqueExactStates: stateKeys.size,
    rollingStates: steps + 1,
    firstHitMt2Step,
    firstHitMt3Step,
    firstForwardAvailableStep,
    firstMt2ForwardAvailableStep,
  };
}

function sumTransitions(results) {
  const merged = {};
  for (const result of results) {
    for (const [transition, count] of Object.entries(result.floorTransitions)) {
      merged[transition] = (merged[transition] || 0) + count;
    }
  }
  return merged;
}

function mergeKindHistograms(results) {
  const merged = {};
  for (const result of results) {
    for (const [kind, count] of Object.entries(result.kindHistogram)) {
      merged[kind] = (merged[kind] || 0) + count;
    }
  }
  return merged;
}

function summarize(results, horizon) {
  const total = (selector) => results.reduce((sum, result) => sum + selector(result), 0);
  const rollingStates = total((result) => result.rollingStates);
  const uniqueExactStates = total((result) => result.uniqueExactStates);
  const stepsAtMt2 = total((result) => result.stepsAtMt2);
  const forwardAvailableSteps = total((result) => result.forwardAvailableSteps);
  const forwardProbabilityMassSteps = total((result) => result.forwardProbabilityMassSteps);
  const firstMt2 = results
    .map((result) => result.firstMt2ForwardAvailableStep)
    .filter((value) => value != null);
  return {
    rollouts: results.length,
    horizon,
    floorTransitions: sumTransitions(results),
    kindHistogram: mergeKindHistograms(results),
    forwardCount: total((result) => result.forwardCount),
    backwardCount: total((result) => result.backwardCount),
    lateralCount: total((result) => result.lateralCount),
    floorChangeCount: total((result) => result.floorChangeCount),
    consecutiveFloorChangeReversals: total((result) => result.consecutiveFloorChangeReversals),
    stepsAtMt2,
    mt2ForwardAvailableSteps: total((result) => result.mt2ForwardAvailableSteps),
    mt2ForwardChosenSteps: total((result) => result.mt2ForwardChosenSteps),
    mt2ForwardLandedMt3Steps: total((result) => result.mt2ForwardLandedMt3Steps),
    forwardAvailableSteps,
    forwardChosenSteps: total((result) => result.forwardChosenSteps),
    changeFloorChosenWhenForwardAvailable: total((result) => result.changeFloorChosenWhenForwardAvailable),
    rollingStates,
    uniqueExactStates,
    revisitCount: rollingStates - uniqueExactStates,
    forwardProbabilityMassSum: total((result) => result.forwardProbabilityMassSum),
    forwardProbabilityMassSteps,
    meanForwardProbabilityMass: forwardProbabilityMassSteps > 0
      ? total((result) => result.forwardProbabilityMassSum) / forwardProbabilityMassSteps
      : null,
    firstMt2ForwardAvailableStepMin: firstMt2.length > 0 ? Math.min(...firstMt2) : null,
    firstMt2ForwardAvailableStepMean: firstMt2.length > 0
      ? firstMt2.reduce((sum, value) => sum + value, 0) / firstMt2.length
      : null,
    rolloutsReachingMt2: results.filter((result) => result.reachedMt2).length,
    rolloutsReachingMt3: results.filter((result) => result.reachedMt3).length,
    rolloutsReachingMt4: results.filter((result) => result.reachedMt4).length,
    rolloutsReachingMt5: results.filter((result) => result.reachedMt5).length,
    terminalBlueKing: results.filter((result) => result.terminal).length,
  };
}

// Advisory classification with explicit, reported criteria.  Raw numbers are
// always reported so the classification can be overridden.
function classifyBottleneck(summary, horizon) {
  const mt2ForwardFraction = summary.stepsAtMt2 > 0
    ? summary.mt2ForwardAvailableSteps / summary.stepsAtMt2
    : null;
  const consecutiveFloorChangeReversalRate = summary.floorChangeCount > 0
    ? summary.consecutiveFloorChangeReversals / summary.floorChangeCount
    : null;
  const revisitRate = summary.rollingStates > 0
    ? summary.revisitCount / summary.rollingStates
    : null;
  // MT2-specific choice rate: the only metric that reflects the MT2->MT3
  // prerequisite (aggregate "forward available" is dominated by MT1 steps).
  const mt2ForwardChoiceRateWhenAvailable = summary.mt2ForwardAvailableSteps > 0
    ? summary.mt2ForwardChosenSteps / summary.mt2ForwardAvailableSteps
    : null;
  const mt2ForwardLandedMt3Rate = summary.mt2ForwardAvailableSteps > 0
    ? summary.mt2ForwardLandedMt3Steps / summary.mt2ForwardAvailableSteps
    : null;
  const forwardAppearsLate = summary.firstMt2ForwardAvailableStepMean != null
    && summary.firstMt2ForwardAvailableStepMean >= 0.7 * horizon;

  const metrics = {
    mt2ForwardFraction,
    mt2ForwardChoiceRateWhenAvailable,
    mt2ForwardLandedMt3Rate,
    consecutiveFloorChangeReversalRate,
    revisitRate,
    forwardAppearsLate,
  };
  const criteria = {
    B: "mt2ForwardFraction < 0.5",
    C: "forwardAppearsLate (mean first MT2-forward step >= 0.7 * horizon) AND mt2ForwardChoiceRateWhenAvailable >= 0.5",
    A: "mt2ForwardChoiceRateWhenAvailable < 0.5  (MT2-specific; reversals belong to D)",
    D: "revisitRate >= 0.5 OR consecutiveFloorChangeReversalRate >= 0.3",
  };
  // All criteria that hold simultaneously: B (never unlocked) and D (ping-pong /
  // revisits) are not mutually exclusive and are usually co-mechanisms.
  const matches = {
    B_PREREQUISITE_SEQUENCING_PROBLEM: mt2ForwardFraction != null && mt2ForwardFraction < 0.5,
    C_HORIZON_PRESSURE_OBSERVED: forwardAppearsLate
      && mt2ForwardChoiceRateWhenAvailable != null && mt2ForwardChoiceRateWhenAvailable >= 0.5,
    A_ON_POLICY_WITHIN_KIND_TRANSFER_PROBLEM: mt2ForwardChoiceRateWhenAvailable != null
      && mt2ForwardChoiceRateWhenAvailable < 0.5,
    D_CYCLIC_PROPOSAL_BEHAVIOR: (revisitRate != null && revisitRate >= 0.5)
      || (consecutiveFloorChangeReversalRate != null && consecutiveFloorChangeReversalRate >= 0.3),
  };
  let primary = "UNDETERMINED";
  if (matches.B_PREREQUISITE_SEQUENCING_PROBLEM) {
    primary = "B_PREREQUISITE_SEQUENCING_PROBLEM";
  } else if (matches.C_HORIZON_PRESSURE_OBSERVED) {
    primary = "C_HORIZON_PRESSURE_OBSERVED";
  } else if (matches.A_ON_POLICY_WITHIN_KIND_TRANSFER_PROBLEM) {
    primary = "A_ON_POLICY_WITHIN_KIND_TRANSFER_PROBLEM";
  } else if (matches.D_CYCLIC_PROPOSAL_BEHAVIOR) {
    primary = "D_CYCLIC_PROPOSAL_BEHAVIOR";
  }
  const coObserved = Object.keys(matches).filter((key) => matches[key] && key !== primary);
  return { primary, coObserved, matches, metrics, criteria, advisory: true };
}

function runFloorDynamicsProbe(options) {
  const config = options || {};
  const corpus = config.corpus || inventory.inventoryCorpus({ captureDecisions: true });

  const preparedResidual = experiment.prepareNonOverlapExperiment({
    corpus,
    vectorKey: "vectorsV2",
    modelConfig: Object.assign({}, prior.DEFAULT_CONFIG, {
      featureDim: prior.FEATURE_DIM_V2,
      mlpInit: { baseFeatureDim: prior.FEATURE_DIM, extensionSeed: EXTENSION_SEED },
      supervision: "same-kind",
    }),
  });
  const kindPrior = experiment.buildKindPriorModel(preparedResidual.trainEntries);

  const project = config.project || dataset.loadGameProject();
  const simulator = dataset.createSimulator(project);
  const rollouts = config.rollouts == null ? 32 : config.rollouts;
  const horizon = config.horizon == null ? 96 : config.horizon;
  const baseSeed = config.baseSeed == null ? 52501 : config.baseSeed;
  const seeds = Array.from({ length: rollouts }, (unused, index) => (baseSeed + index * 7919) >>> 0);

  const control = [];
  const treatment = [];
  for (const seed of seeds) {
    control.push(runInstrumentedRollout(simulator, {
      mode: "control", seed, horizon, temperature: prior.DEFAULT_CONFIG.temperature,
      floorOrder: project.floorOrder, kindProbability: kindPrior.probability, residualModel: null,
    }));
    treatment.push(runInstrumentedRollout(simulator, {
      mode: "treatment", seed, horizon, temperature: prior.DEFAULT_CONFIG.temperature,
      floorOrder: project.floorOrder, kindProbability: kindPrior.probability,
      residualModel: preparedResidual.trained.model,
    }));
  }

  const controlSummary = summarize(control, horizon);
  const treatmentSummary = summarize(treatment, horizon);
  return {
    protocol: {
      kept: ["dd5e597 hierarchical policy", "32 paired seeds", "H=96", "T=1.0", "true MT5 blueKing terminal"],
      changed: "telemetry only (no training, no scorer change, no parameter change)",
      control: "PROPER_KIND_PRIOR_ONLY",
      treatment: "PROPER_KIND_PRIOR_PLUS_WITHIN_KIND_RESIDUAL",
      noRetrain: true,
      noHorizonChange: true,
    },
    control: controlSummary,
    treatment: treatmentSummary,
    classification: {
      control: classifyBottleneck(controlSummary, horizon),
      treatment: classifyBottleneck(treatmentSummary, horizon),
    },
    verdict: classifyBottleneck(treatmentSummary, horizon).primary,
  };
}

module.exports = {
  changeFloorDirection,
  classifyBottleneck,
  mergeKindHistograms,
  runFloorDynamicsProbe,
  runInstrumentedRollout,
  summarize,
};
