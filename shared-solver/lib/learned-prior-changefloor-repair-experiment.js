"use strict";

// PR-5.25g ChangeFloor Destination Semantics Repair.
//
// First representation change in this line.  FEATURE_SCHEMA_V1 encodes a
// changeFloor action as kind + path + direction + in-floor target dx/dy, so the
// model knows "I will take a stair" but NOT "which floor it leads to" -- even
// though the simulator/route action carries that destination and the action
// fingerprint includes it.  This matches the near-inverted V1 changeFloor rank.
//
// V2 = V1 + exactly ONE action feature:
//   changeFloorDestinationDelta = clamp((floorOrdinal(resolvedDestination)
//                                        - floorOrdinal(currentFloor)) / 10, -1, 1)
// applied only to kind === "changeFloor" (0 otherwise); an unresolvable
// destination fails closed upstream.
//
// Protocol (frozen): same 15 train routes / 9 held-out routes / max-reached
// split / 16-hidden MLP / pairwise objective / seed 52501 / epochs 300 /
// lr 0.05 / T=1.0.  No capacity, objective, corpus, recipe or temperature
// change, and no second new feature.
//
//   CHANGEFLOOR_PRIMARY = V2 unique changeFloor rank < 0.5
//                         AND V2 unique changeFloor rank < V1 unique changeFloor rank
//   OVERALL_GATE        = V2 overall micro rank < kind-prior micro rank
//   BATTLE_PRESERVATION = report only (transparency, not a gate)
//
// If BOTH gates pass, the same round runs matched CONTROL(uniform) /
// TREATMENT(V2) rollouts against the TRUE terminal predicate
// (MT5 blueKing@6,7 defeated), not simulator stopFloorId = MT11.

const prior = require("./learned-action-prior");
const inventory = require("./learned-prior-corpus-inventory");
const dataset = require("./learned-prior-dataset");
const experiment = require("./learned-prior-nonoverlap-experiment");
const withinKind = require("./learned-prior-within-kind-diagnostic");

const V1_VECTOR_KEY = "vectors";
const V2_VECTOR_KEY = "vectorsV2";
const EXTENSION_SEED = (prior.DEFAULT_CONFIG.seed ^ 0x9e3779b9) >>> 0;

// True qualification terminal: blueKing at MT5:6,7 defeated.
function isBlueKingTerminal(state) {
  if (!state || state.floorId !== "MT5") return false;
  const floorState = (state.floorStates || {}).MT5 || {};
  return Boolean(floorState.removed && floorState.removed["6,7"]);
}

function runBlueKingRollout(simulator, model, options) {
  const config = options || {};
  const mode = config.mode === "treatment" ? "treatment" : "control";
  const horizon = config.horizon == null ? 96 : config.horizon;
  const temperature = config.temperature == null ? 1 : config.temperature;
  const floorOrder = config.floorOrder;
  const rng = prior.mulberry32((config.seed == null ? 1 : config.seed) >>> 0);
  let state = simulator.createInitialState({ rank: "chaos" });
  let steps = 0;
  let terminal = false;
  let errorClass = null;
  let maxFloorId = state.floorId;
  let maxFloorOrdinal = prior.floorOrdinal(state.floorId);
  let reachedMt3 = maxFloorOrdinal >= 3;
  let reachedMt4 = maxFloorOrdinal >= 4;
  let reachedMt5 = maxFloorOrdinal >= 5;

  for (let step = 0; step < horizon; step += 1) {
    if (isBlueKingTerminal(state)) {
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
    let index;
    if (mode === "control") {
      index = Math.floor(rng() * actions.length);
    } else {
      const scores = actions.map((action) => model.score(
        prior.encodeFeaturesV2(state, action, { floorOrder }),
      ));
      index = prior.sampleSoftmaxIndex(scores, temperature, rng);
    }
    try {
      state = simulator.applyAction(state, actions[index], { storeRoute: false });
    } catch (error) {
      errorClass = "apply-error";
      break;
    }
    steps += 1;
    const ordinal = prior.floorOrdinal(state.floorId);
    if (ordinal > maxFloorOrdinal) {
      maxFloorOrdinal = ordinal;
      maxFloorId = state.floorId;
    }
    if (ordinal >= 3) reachedMt3 = true;
    if (ordinal >= 4) reachedMt4 = true;
    if (ordinal >= 5) reachedMt5 = true;
  }
  if (!terminal) terminal = isBlueKingTerminal(state);
  return {
    seed: config.seed,
    mode,
    steps,
    terminal,
    maxFloorId,
    maxFloorOrdinal,
    reachedMt3,
    reachedMt4,
    reachedMt5,
    errorClass,
  };
}

function aggregateArm(results) {
  const total = results.length;
  const count = (predicate) => results.filter(predicate).length;
  const rate = (value) => (total > 0 ? value / total : 0);
  const terminal = count((result) => result.terminal);
  const mt3 = count((result) => result.reachedMt3);
  const mt4 = count((result) => result.reachedMt4);
  const mt5 = count((result) => result.reachedMt5);
  return {
    rollouts: total,
    terminalBlueKing: terminal,
    terminalBlueKingRate: rate(terminal),
    mt3Reach: mt3,
    mt3ReachRate: rate(mt3),
    mt4Reach: mt4,
    mt4ReachRate: rate(mt4),
    mt5Reach: mt5,
    mt5ReachRate: rate(mt5),
    errorRollouts: count((result) => result.errorClass),
    meanSteps: total > 0 ? results.reduce((sum, result) => sum + result.steps, 0) / total : 0,
    maxFloorOrdinal: total > 0 ? Math.max(...results.map((result) => result.maxFloorOrdinal)) : 0,
    maxFloorHistogram: results.reduce((map, result) => {
      map[result.maxFloorId] = (map[result.maxFloorId] || 0) + 1;
      return map;
    }, {}),
  };
}

function runChangeFloorRepairExperiment(options) {
  const config = options || {};
  const corpus = config.corpus || inventory.inventoryCorpus({ captureDecisions: true });

  // V1 control: unchanged encoder, unchanged init.
  const preparedV1 = experiment.prepareNonOverlapExperiment({
    corpus,
    vectorKey: V1_VECTOR_KEY,
    modelConfig: Object.assign({}, prior.DEFAULT_CONFIG, { featureDim: prior.FEATURE_DIM }),
  });
  // V2 treatment: +1 feature; the first 40 input columns and the output layer
  // are initialised by the identical base stream.
  const preparedV2 = experiment.prepareNonOverlapExperiment({
    corpus,
    vectorKey: V2_VECTOR_KEY,
    modelConfig: Object.assign({}, prior.DEFAULT_CONFIG, {
      featureDim: prior.FEATURE_DIM_V2,
      mlpInit: { baseFeatureDim: prior.FEATURE_DIM, extensionSeed: EXTENSION_SEED },
    }),
  });

  const kindPriorModel = experiment.buildKindPriorModel(preparedV1.trainEntries).model;

  const v1Micro = prior.evaluateChosenRank(preparedV1.trained.model, preparedV1.heldOutUnseenEntries);
  const v2Micro = prior.evaluateChosenRank(preparedV2.trained.model, preparedV2.heldOutUnseenEntries);
  const kindPriorMicro = prior.evaluateChosenRank(kindPriorModel, preparedV1.heldOutUnseenEntries);

  // Unique-signature per-kind ranks (shared dedup key, so V1 and V2 see the
  // exact same decisions).
  const uniqueV1 = withinKind.dedupeBySignature(preparedV1.heldOutUnseenEntries);
  const uniqueV2 = withinKind.dedupeBySignature(preparedV2.heldOutUnseenEntries);
  const aggV1 = withinKind.aggregateWithinKind(preparedV1.trained.model, uniqueV1);
  const aggV2 = withinKind.aggregateWithinKind(preparedV2.trained.model, uniqueV2);
  const changeFloorV1 = withinKind.perKindRow(aggV1, "changeFloor");
  const changeFloorV2 = withinKind.perKindRow(aggV2, "changeFloor");
  const battleV2 = withinKind.perKindRow(aggV2, "battle");

  // Occurrence-weighted transparency (the gate uses the unique-signature numbers).
  const occV1 = withinKind.aggregateWithinKind(preparedV1.trained.model, preparedV1.heldOutUnseenEntries);
  const occV2 = withinKind.aggregateWithinKind(preparedV2.trained.model, preparedV2.heldOutUnseenEntries);
  const occurrenceChangeFloorV1 = withinKind.perKindRow(occV1, "changeFloor");
  const occurrenceChangeFloorV2 = withinKind.perKindRow(occV2, "changeFloor");
  const occurrenceBattleV1 = withinKind.perKindRow(occV1, "battle");
  const occurrenceBattleV2 = withinKind.perKindRow(occV2, "battle");

  const changeFloorGate = changeFloorV2.meanNormalizedRank != null
    && changeFloorV2.meanNormalizedRank < 0.5
    && changeFloorV2.meanNormalizedRank < changeFloorV1.meanNormalizedRank;
  const overallGate = v2Micro.meanNormalizedRank != null
    && kindPriorMicro.meanNormalizedRank != null
    && v2Micro.meanNormalizedRank < kindPriorMicro.meanNormalizedRank;
  const rolloutEligible = changeFloorGate && overallGate;

  let rolloutReport = null;
  if (rolloutEligible && config.runRollouts !== false) {
    const project = config.project || dataset.loadGameProject();
    const simulator = dataset.createSimulator(project);
    const rollouts = config.rollouts == null ? 32 : config.rollouts;
    const horizon = config.horizon == null ? 96 : config.horizon;
    const baseSeed = config.baseSeed == null ? 52501 : config.baseSeed;
    const seeds = Array.from({ length: rollouts }, (unused, index) => (baseSeed + index * 7919) >>> 0);
    const control = [];
    const treatment = [];
    for (const seed of seeds) {
      control.push(runBlueKingRollout(simulator, preparedV2.trained.model, {
        mode: "control", seed, horizon, temperature: prior.DEFAULT_CONFIG.temperature, floorOrder: project.floorOrder,
      }));
      treatment.push(runBlueKingRollout(simulator, preparedV2.trained.model, {
        mode: "treatment", seed, horizon, temperature: prior.DEFAULT_CONFIG.temperature, floorOrder: project.floorOrder,
      }));
    }
    rolloutReport = {
      horizon,
      temperature: prior.DEFAULT_CONFIG.temperature,
      rolloutsPerArm: rollouts,
      terminalPredicate: "state.floorId === 'MT5' && state.floorStates.MT5.removed['6,7']",
      stopFloorIdUsed: false,
      seedSchedule: { baseSeed, rule: "baseSeed + index * 7919 (matched across arms)" },
      control: aggregateArm(control),
      treatment: aggregateArm(treatment),
    };
  }

  return {
    modelExactness: {
      control: "FEATURE_SCHEMA_V1 (unchanged)",
      treatment: "FEATURE_SCHEMA_V2 (+changeFloorDestinationDelta only)",
      featureDimV1: prior.FEATURE_DIM,
      featureDimV2: prior.FEATURE_DIM_V2,
      unchanged: ["hiddenDim", "objective", "trainCorpus", "trainingRecipe", "temperature"],
      mlpInitPolicy: "V2 first 40 input columns and the output layer use the identical V1 base stream; only column 41 uses a separate deterministic stream",
      extensionSeed: EXTENSION_SEED,
    },
    split: {
      rule: corpus.analysis.splitRule,
      trainRouteCount: preparedV1.train.length,
      trainDecisions: preparedV1.trainEntries.length,
      heldOutRouteCount: preparedV1.heldOut.length,
      heldOutUnseenDecisions: preparedV1.heldOutUnseenEntries.length,
      uniqueUnseenSignatures: uniqueV1.length,
    },
    metrics: {
      overallMicroV1: v1Micro.meanNormalizedRank,
      overallMicroV2: v2Micro.meanNormalizedRank,
      kindPriorMicro: kindPriorMicro.meanNormalizedRank,
      uniqueChangeFloorV1: changeFloorV1.meanNormalizedRank,
      uniqueChangeFloorV2: changeFloorV2.meanNormalizedRank,
      uniqueChangeFloorV1Count: changeFloorV1.evaluableDecisions,
      uniqueChangeFloorV2Count: changeFloorV2.evaluableDecisions,
      uniqueBattleV2: battleV2.meanNormalizedRank,
      uniqueBattleV1: withinKind.perKindRow(aggV1, "battle").meanNormalizedRank,
      uniqueBattleV2Count: battleV2.evaluableDecisions,
      uniqueAggregateV2: aggV2.modelMeanNormalizedRank,
      uniqueAggregateV1: aggV1.modelMeanNormalizedRank,
      occurrenceChangeFloorV1: occurrenceChangeFloorV1.meanNormalizedRank,
      occurrenceChangeFloorV2: occurrenceChangeFloorV2.meanNormalizedRank,
      occurrenceChangeFloorV1Count: occurrenceChangeFloorV1.evaluableDecisions,
      occurrenceChangeFloorV2Count: occurrenceChangeFloorV2.evaluableDecisions,
      occurrenceBattleV1: occurrenceBattleV1.meanNormalizedRank,
      occurrenceBattleV2: occurrenceBattleV2.meanNormalizedRank,
      uniqueChangeFloorSampleNote: `${changeFloorV2.evaluableDecisions} unique-signature changeFloor decisions; the < 0.5 gate is evaluated on this small set`,
    },
    gates: {
      CHANGEFLOOR_PRIMARY: {
        rule: "V2 unique changeFloor rank < 0.5 AND < V1 unique changeFloor rank",
        v2: changeFloorV2.meanNormalizedRank,
        v1: changeFloorV1.meanNormalizedRank,
        passed: changeFloorGate,
      },
      OVERALL_GATE: {
        rule: "V2 overall micro rank < kind-prior micro rank",
        v2: v2Micro.meanNormalizedRank,
        kindPrior: kindPriorMicro.meanNormalizedRank,
        passed: overallGate,
      },
      BATTLE_PRESERVATION: {
        rule: "report only (transparency, not a gate)",
        v2UniqueBattleWithinKindRank: battleV2.meanNormalizedRank,
      },
    },
    rolloutEligible,
    rollouts: rolloutReport,
    verdict: rolloutEligible
      ? "REPRESENTATION_REPAIR_PASSED_OFFLINE"
      : "REPRESENTATION_REPAIR_FAILED_OFFLINE",
  };
}

module.exports = {
  aggregateArm,
  isBlueKingTerminal,
  runBlueKingRollout,
  runChangeFloorRepairExperiment,
};
