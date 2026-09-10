"use strict";

// PR-5.25h Kind-Prior + Within-Kind Residual Policy.
//
// Hypothesis: cross-kind calibration and within-kind discrimination should be
// FACTORIZED instead of forced into one monolithic pairwise scorer.  5.25e/f
// showed the MLP can learn within-kind structure (battle 0.3965); 5.25d/g showed
// its cross-kind ranking is WORSE than a trivial train kind prior (0.3581 >
// 0.3399).  So keep the kind prior for cross-kind and let the MLP learn only
// within-kind residuals.
//
// Frozen:
//   FEATURE_SCHEMA_V2 (41 dims) / corpus / max-reached split / 16 hidden /
//   seed 52501 / epochs 300 / lr 0.05 / T = 1.0.
// Changed: MONOLITHIC_PAIRWISE -> SAME_KIND_RESIDUAL_PAIRWISE + FIXED_KIND_PRIOR.
//
// Composition (no tunable weight, no calibration sweep):
//   residualCentered(a) = r(a) - logsumexp(r(b), b in same kind) + log(N_k)
//   finalScore(a)       = log(P_train(kind = k)) + residualCentered(a)
// If the residual is flat within a kind, residualCentered = 0 and
// finalScore = log(kindPrior) EXACTLY, so the treatment degenerates to the
// kind-prior control rather than to something arbitrary.
//
// Offline gates:
//   OVERALL_GATE      = TREATMENT_OVERALL_MICRO < KIND_PRIOR_CONTROL_MICRO
//   CHANGEFLOOR_GATE  = TREATMENT_UNIQUE_CHANGEFLOOR < 0.5
//                       AND < V2 monolithic anchor (0.8125)
// Both pass -> same-round rollout with CONTROL = kind-prior-only policy,
// TREATMENT = kind-prior + within-kind residual, true MT5 blueKing terminal.

const prior = require("./learned-action-prior");
const inventory = require("./learned-prior-corpus-inventory");
const dataset = require("./learned-prior-dataset");
const experiment = require("./learned-prior-nonoverlap-experiment");
const withinKind = require("./learned-prior-within-kind-diagnostic");
const repair = require("./learned-prior-changefloor-repair-experiment");

const V2_MONOLITHIC_CHANGEFLOOR_ANCHOR = 0.8125;
const EXTENSION_SEED = (prior.DEFAULT_CONFIG.seed ^ 0x9e3779b9) >>> 0;

function logSumExp(values) {
  let max = -Infinity;
  for (const value of values) if (value > max) max = value;
  if (!Number.isFinite(max)) return -Infinity;
  let sum = 0;
  for (const value of values) sum += Math.exp(value - max);
  return max + Math.log(sum);
}

// finalScore(a) = log P(kind(a)) + residualCentered(a); residualCentered is
// zero when the residual is flat inside a kind, so treatment degrades exactly
// to the kind-prior control.
function computeHierarchicalScores(vectors, residualScores, kindProbability) {
  const groups = new Map();
  for (let index = 0; index < vectors.length; index += 1) {
    const kind = prior.actionKindIndexOfVector(vectors[index]);
    if (!groups.has(kind)) groups.set(kind, []);
    groups.get(kind).push(index);
  }
  const scores = new Array(vectors.length).fill(0);
  for (const [kind, indices] of groups) {
    const probability = kindProbability[kind];
    const logPrior = Math.log(probability == null || probability <= 0 ? 1e-12 : probability);
    const logZ = logSumExp(indices.map((index) => residualScores[index]));
    const logN = Math.log(indices.length);
    for (const index of indices) {
      scores[index] = logPrior + (residualScores[index] - logZ + logN);
    }
  }
  return scores;
}

// residualModel === null -> pure kind-prior policy (control).
function makeHierarchicalScorer(residualModel, kindProbability) {
  return (vectors) => {
    const residualScores = residualModel
      ? vectors.map((vector) => residualModel.score(vector))
      : vectors.map(() => 0);
    return computeHierarchicalScores(vectors, residualScores, kindProbability);
  };
}

// Set-aware ranking (a score may depend on the whole legal action set).
function evaluateWithSetScorer(scoreVectors, entries) {
  let count = 0;
  let normalizedSum = 0;
  let top1 = 0;
  for (const entry of entries) {
    const scores = scoreVectors(entry.vectors);
    const chosenScore = scores[entry.chosenIndex];
    let better = 0;
    let ties = 0;
    for (let index = 0; index < scores.length; index += 1) {
      if (index === entry.chosenIndex) continue;
      if (scores[index] > chosenScore) better += 1;
      else if (scores[index] === chosenScore) ties += 1;
    }
    const rank = 1 + better + ties * 0.5;
    const size = scores.length;
    normalizedSum += size > 1 ? (rank - 1) / (size - 1) : 0;
    if (rank === 1) top1 += 1;
    count += 1;
  }
  return {
    count,
    meanNormalizedRank: count > 0 ? normalizedSum / count : null,
    top1Rate: count > 0 ? top1 / count : null,
  };
}

// Same-kind supervision inventory over TRAIN.  If changeFloor has zero
// same-kind supervised decisions the round is blocked: the residual scorer has
// nothing to learn changeFloor from.
function preflightSameKindSupervision(trainRecords) {
  const kinds = prior.FEATURE_SCHEMA.actionKinds;
  const byKind = {};
  let decisions = 0;
  let supervisedDecisions = 0;
  let pairCount = 0;
  const supervisedSignatures = new Set();
  for (const route of trainRecords) {
    for (const decision of route.decisionRecords) {
      decisions += 1;
      const vectors = decision.vectorsV2;
      const chosenKind = prior.actionKindIndexOfVector(vectors[decision.chosenIndex]);
      const label = kinds[chosenKind];
      if (!byKind[label]) byKind[label] = { decisions: 0, supervisedDecisions: 0, pairCount: 0, distinctSignatures: new Set() };
      byKind[label].decisions += 1;
      let negatives = 0;
      for (let index = 0; index < vectors.length; index += 1) {
        if (index === decision.chosenIndex) continue;
        if (prior.actionKindIndexOfVector(vectors[index]) === chosenKind) negatives += 1;
      }
      if (negatives > 0) {
        supervisedDecisions += 1;
        pairCount += negatives;
        byKind[label].supervisedDecisions += 1;
        byKind[label].pairCount += negatives;
        byKind[label].distinctSignatures.add(decision.signature);
        supervisedSignatures.add(decision.signature);
      }
    }
  }
  const serializableByKind = Object.keys(byKind).reduce((map, label) => {
    map[label] = {
      decisions: byKind[label].decisions,
      supervisedDecisions: byKind[label].supervisedDecisions,
      pairCount: byKind[label].pairCount,
      distinctSignatures: byKind[label].distinctSignatures.size,
    };
    return map;
  }, {});
  const changeFloorSupervised = byKind.changeFloor ? byKind.changeFloor.supervisedDecisions : 0;
  return {
    trainDecisions: decisions,
    sameKindSupervisedDecisions: supervisedDecisions,
    distinctSupervisedSignatures: supervisedSignatures.size,
    pairCount,
    byKind: serializableByKind,
    changeFloorSupervisedDecisions: changeFloorSupervised,
    blocked: changeFloorSupervised === 0,
  };
}

function runHierarchicalRollout(simulator, scorer, options) {
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
    const vectors = actions.map((action) => prior.encodeFeaturesV2(state, action, { floorOrder }));
    const scores = scorer(vectors);
    const index = prior.sampleSoftmaxIndex(scores, temperature, rng);
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
  if (!terminal) terminal = repair.isBlueKingTerminal(state);
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

function runHierarchicalResidualExperiment(options) {
  const config = options || {};
  const corpus = config.corpus || inventory.inventoryCorpus({ captureDecisions: true });
  const { distinct } = inventory.dedupeBySignatureSequence(corpus.distinctRouteRecords);
  const { train } = inventory.splitByMaxReachedFloor(distinct);

  const preflight = preflightSameKindSupervision(train);

  // V2 monolithic anchor (unchanged 5.25g control) and V2 same-kind residual.
  const preparedMonolithic = experiment.prepareNonOverlapExperiment({
    corpus,
    vectorKey: "vectorsV2",
    modelConfig: Object.assign({}, prior.DEFAULT_CONFIG, {
      featureDim: prior.FEATURE_DIM_V2,
      mlpInit: { baseFeatureDim: prior.FEATURE_DIM, extensionSeed: EXTENSION_SEED },
    }),
  });
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
  const controlScorer = makeHierarchicalScorer(null, kindPrior.probability);
  const treatmentScorer = makeHierarchicalScorer(preparedResidual.trained.model, kindPrior.probability);

  const unseen = preparedResidual.heldOutUnseenEntries;
  const controlOverall = evaluateWithSetScorer(controlScorer, unseen);
  const treatmentOverall = evaluateWithSetScorer(treatmentScorer, unseen);

  const unique = withinKind.dedupeBySignature(unseen);
  const monolithicChangeFloor = withinKind.perKindRow(
    withinKind.aggregateWithinKind(preparedMonolithic.trained.model, unique), "changeFloor",
  ).meanNormalizedRank;
  const residualAgg = withinKind.aggregateWithinKind(preparedResidual.trained.model, unique);
  const treatmentChangeFloor = withinKind.perKindRow(residualAgg, "changeFloor").meanNormalizedRank;
  const treatmentBattle = withinKind.perKindRow(residualAgg, "battle").meanNormalizedRank;

  const overallGate = treatmentOverall.meanNormalizedRank != null
    && controlOverall.meanNormalizedRank != null
    && treatmentOverall.meanNormalizedRank < controlOverall.meanNormalizedRank;
  const changeFloorGate = treatmentChangeFloor != null
    && treatmentChangeFloor < 0.5
    && treatmentChangeFloor < monolithicChangeFloor;
  const rolloutEligible = overallGate && changeFloorGate;

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
      control.push(runHierarchicalRollout(simulator, controlScorer, {
        mode: "control", seed, horizon, temperature: prior.DEFAULT_CONFIG.temperature, floorOrder: project.floorOrder,
      }));
      treatment.push(runHierarchicalRollout(simulator, treatmentScorer, {
        mode: "treatment", seed, horizon, temperature: prior.DEFAULT_CONFIG.temperature, floorOrder: project.floorOrder,
      }));
    }
    rolloutReport = {
      horizon,
      temperature: prior.DEFAULT_CONFIG.temperature,
      rolloutsPerArm: rollouts,
      control: repair.aggregateArm(control),
      treatment: repair.aggregateArm(treatment),
      terminalPredicate: "state.floorId === 'MT5' && state.floorStates.MT5.removed['6,7']",
      seedSchedule: { baseSeed, rule: "baseSeed + index * 7919 (matched across arms)" },
    };
  }

  return {
    preflight,
    protocol: {
      kept: ["FEATURE_SCHEMA_V2", "corpus", "maxReachedSplit", "16Hidden", "seed", "epochs", "lr"],
      changed: "MONOLITHIC_PAIRWISE -> SAME_KIND_RESIDUAL_PAIRWISE + FIXED_KIND_PRIOR",
      controlPolicy: "TRAIN_KIND_PRIOR_ONLY",
      treatmentPolicy: "TRAIN_KIND_PRIOR + V2_WITHIN_KIND_RESIDUAL",
      composition: "finalScore(a) = log(P_train(kind(a))) + (r(a) - logsumexp_sameKind(r) + log(N_k))",
      degenerateProperty: "flat residual within a kind => finalScore = log(kindPrior) exactly",
      tunableWeights: "none",
    },
    metrics: {
      controlOverallMicro: controlOverall.meanNormalizedRank,
      treatmentOverallMicro: treatmentOverall.meanNormalizedRank,
      controlOverallCount: controlOverall.count,
      uniqueChangeFloorMonolithicAnchor: monolithicChangeFloor,
      uniqueChangeFloorTreatment: treatmentChangeFloor,
      uniqueChangeFloorCount: withinKind.perKindRow(residualAgg, "changeFloor").evaluableDecisions,
      uniqueBattleTreatment: treatmentBattle,
      uniqueBattleCount: withinKind.perKindRow(residualAgg, "battle").evaluableDecisions,
      uniqueAggregateTreatment: residualAgg.modelMeanNormalizedRank,
    },
    gates: {
      OVERALL_GATE: {
        rule: "TREATMENT_OVERALL_MICRO < KIND_PRIOR_CONTROL_MICRO",
        treatment: treatmentOverall.meanNormalizedRank,
        control: controlOverall.meanNormalizedRank,
        passed: overallGate,
      },
      CHANGEFLOOR_GATE: {
        rule: "TREATMENT_UNIQUE_CHANGEFLOOR < 0.5 AND < V2 monolithic anchor",
        treatment: treatmentChangeFloor,
        monolithicAnchor: monolithicChangeFloor,
        passed: changeFloorGate,
      },
    },
    rolloutEligible,
    rollouts: rolloutReport,
    verdict: preflight.blocked
      ? "BLOCKED_BY_NO_CHANGEFLOOR_WITHIN_KIND_SUPERVISION"
      : (rolloutEligible ? "HIERARCHICAL_RESIDUAL_PASSED_OFFLINE" : "HIERARCHICAL_RESIDUAL_FAILED_OFFLINE"),
  };
}

module.exports = {
  EXTENSION_SEED,
  V2_MONOLITHIC_CHANGEFLOOR_ANCHOR,
  computeHierarchicalScores,
  evaluateWithSetScorer,
  logSumExp,
  makeHierarchicalScorer,
  preflightSameKindSupervision,
  runHierarchicalResidualExperiment,
  runHierarchicalRollout,
};
