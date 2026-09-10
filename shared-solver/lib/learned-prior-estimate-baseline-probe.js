"use strict";

// PR-5.25f Estimate-Only Battle Baseline Probe.
//
// Answers exactly one question with ONE fixed, unfitted baseline:
//
//   On UNIQUE-SIGNATURE, BATTLE-ONLY, SAME-KIND decisions, does the frozen
//   PR-5.25d model beat a simple "prefer the cheaper / shorter immediate
//   fight" heuristic?
//
// Frozen protocol (no fitting, no weight tuning, no feature sweep):
//   ESTIMATE_BASELINE = LEXICOGRAPHIC_LOWER_IS_BETTER
//   PRIMARY_KEY_1     = estimate.damage   (lower is better)
//   TIE_BREAK_KEY_2   = estimate.turn     (lower is better)
//   both equal        = tie
//
// Fairness: if ANY same-kind battle alternative lacks a valid estimate.damage
// or estimate.turn, the decision is non-evaluable for the baseline.  The final
// comparison recomputes BOTH the full model and the estimate baseline on the
// EXACT SAME intersection subset; the model is never scored on a larger set.
//
// No new training recipe, no model change, no extra fit objective, no corpus
// expansion, no rollouts, no MCGS.

const prior = require("./learned-action-prior");
const experiment = require("./learned-prior-nonoverlap-experiment");
const withinKind = require("./learned-prior-within-kind-diagnostic");

const BATTLE_KIND = "battle";

function battleKindIndex() {
  const index = prior.FEATURE_SCHEMA.actionKinds.indexOf(BATTLE_KIND);
  return index === -1 ? 0 : index;
}

function estimateIsValid(estimate) {
  return Boolean(estimate && estimate.damage != null && estimate.turn != null);
}

// Generic rank of the chosen item among `otherValues` using a comparator that
// returns -1 (other is better), 0 (tie) or 1 (other is worse).
function normalizedRank(chosenValue, otherValues, compareOtherToChosen) {
  let better = 0;
  let ties = 0;
  for (const other of otherValues) {
    const comparison = compareOtherToChosen(other, chosenValue);
    if (comparison < 0) better += 1;
    else if (comparison === 0) ties += 1;
  }
  const size = otherValues.length + 1;
  const rank = 1 + better + ties * 0.5;
  return { rank, size, normalizedRank: size > 1 ? (rank - 1) / (size - 1) : 0 };
}

function higherScoreIsBetter(otherScore, chosenScore) {
  if (otherScore > chosenScore) return -1;
  if (otherScore === chosenScore) return 0;
  return 1;
}

function lexicographicLowerIsBetter(otherEstimate, chosenEstimate) {
  if (otherEstimate.damage < chosenEstimate.damage) return -1;
  if (otherEstimate.damage > chosenEstimate.damage) return 1;
  if (otherEstimate.turn < chosenEstimate.turn) return -1;
  if (otherEstimate.turn > chosenEstimate.turn) return 1;
  return 0;
}

function mean(values) {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function perDecisionMetrics(model, entry, sameKindIndices) {
  const scores = entry.vectors.map((vector) => model.score(vector));
  const chosenScore = scores[entry.chosenIndex];
  const otherScoreValues = sameKindIndices
    .filter((index) => index !== entry.chosenIndex)
    .map((index) => scores[index]);
  const modelRank = normalizedRank(chosenScore, otherScoreValues, higherScoreIsBetter);

  const chosenEstimate = entry.actionEstimates[entry.chosenIndex];
  const otherEstimates = sameKindIndices
    .filter((index) => index !== entry.chosenIndex)
    .map((index) => entry.actionEstimates[index]);
  const estimateRank = normalizedRank(chosenEstimate, otherEstimates, lexicographicLowerIsBetter);

  return {
    modelRank: modelRank.rank,
    modelNormalizedRank: modelRank.normalizedRank,
    estimateRank: estimateRank.rank,
    estimateNormalizedRank: estimateRank.normalizedRank,
    withinKindSize: sameKindIndices.length,
  };
}

function runEstimateBaselineProbe(options) {
  const prepared = experiment.prepareNonOverlapExperiment(options);
  const { modelConfig, corpus, distinct, train, heldOut, trainEntries, trained, heldOutUnseenEntries } = prepared;
  const battleKind = battleKindIndex();

  // Evaluation set: unique-signature, battle-only, same-kind.
  const uniqueEntries = withinKind.dedupeBySignature(heldOutUnseenEntries);
  const battleChosen = [];
  for (const entry of uniqueEntries) {
    if (experiment.kindIndexOfVector(entry.vectors[entry.chosenIndex]) !== battleKind) continue;
    battleChosen.push(entry);
  }
  const records = [];
  for (const entry of battleChosen) {
    const sameKindIndices = [];
    entry.vectors.forEach((vector, index) => {
      if (experiment.kindIndexOfVector(vector) === battleKind) sameKindIndices.push(index);
    });
    if (sameKindIndices.length < 2) continue; // no same-kind alternative to rank against
    const estimatesValid = Boolean(entry.actionEstimates)
      && sameKindIndices.every((index) => estimateIsValid(entry.actionEstimates[index]));
    records.push({ entry, sameKindIndices, estimatesValid });
  }
  const sameKindEvaluable = records.length;
  const intersection = records.filter((record) => record.estimatesValid);

  const perDecision = intersection.map((record) => ({
    signature: record.entry.signature,
    routeId: record.entry.routeId,
    ...perDecisionMetrics(trained.model, record.entry, record.sameKindIndices),
  }));

  const fullModelMeanNormalizedRank = mean(perDecision.map((row) => row.modelNormalizedRank));
  const estimateOnlyMeanNormalizedRank = mean(perDecision.map((row) => row.estimateNormalizedRank));
  const fullModelTop1Rate = perDecision.length > 0
    ? perDecision.filter((row) => row.modelRank === 1).length / perDecision.length
    : null;
  const estimateOnlyTop1Rate = perDecision.length > 0
    ? perDecision.filter((row) => row.estimateRank === 1).length / perDecision.length
    : null;

  // Transparency only: the model's rank over the wider same-kind-evaluable set
  // (before the estimate-validity intersection), to show the subset shift.
  const referenceAllSameKind = records.map((record) => (
    perDecisionMetrics(trained.model, record.entry, record.sameKindIndices)
  ));

  const primaryComparison = fullModelMeanNormalizedRank != null
    && estimateOnlyMeanNormalizedRank != null
    && fullModelMeanNormalizedRank < estimateOnlyMeanNormalizedRank;

  // Tie diagnostics: a lexicographic baseline over (damage, turn) can approach
  // 0.5 either because it is genuinely non-predictive OR because many same-kind
  // alternatives carry identical estimates.  These counts separate the two.
  const tieDiagnostics = (() => {
    let decisionsWithChosenEstimateTied = 0;
    let decisionsAllAlternativesTiedWithChosen = 0;
    let decisionsWithUniqueChosenEstimate = 0;
    let totalTiesWithChosen = 0;
    const sizeHistogram = {};
    const fullyTiedSignatures = new Set();
    for (const record of intersection) {
      const chosen = record.entry.actionEstimates[record.entry.chosenIndex];
      const others = record.sameKindIndices
        .filter((index) => index !== record.entry.chosenIndex)
        .map((index) => record.entry.actionEstimates[index]);
      const ties = others.filter((other) => (
        other.damage === chosen.damage && other.turn === chosen.turn
      )).length;
      totalTiesWithChosen += ties;
      if (ties > 0) decisionsWithChosenEstimateTied += 1;
      if (others.length > 0 && ties === others.length) {
        decisionsAllAlternativesTiedWithChosen += 1;
        fullyTiedSignatures.add(record.entry.signature);
      }
      if (ties === 0) decisionsWithUniqueChosenEstimate += 1;
      sizeHistogram[record.sameKindIndices.length] = (sizeHistogram[record.sameKindIndices.length] || 0) + 1;
    }
    return {
      decisionsWithChosenEstimateTied,
      decisionsAllAlternativesTiedWithChosen,
      decisionsWithUniqueChosenEstimate,
      totalTiesWithChosen,
      sameKindSizeHistogram: sizeHistogram,
      fullyTiedSignatures,
    };
  })();

  // Subset where EVERY same-kind alternative ties with the chosen estimate: the
  // estimate baseline is exactly 0.5 there by construction, so any full-model
  // gain is pure tie-breaking beyond estimate.damage/turn.
  const rankBySignature = new Map(perDecision.map((row) => [row.signature, row]));
  const fullyTiedRows = intersection
    .map((record) => rankBySignature.get(record.entry.signature))
    .filter((row) => row && tieDiagnostics.fullyTiedSignatures.has(row.signature));
  const fullyTiedSubset = {
    decisions: fullyTiedRows.length,
    fullModelMeanNormalizedRank: mean(fullyTiedRows.map((row) => row.modelNormalizedRank)),
    estimateOnlyMeanNormalizedRank: mean(fullyTiedRows.map((row) => row.estimateNormalizedRank)),
    uniformBaselineMeanNormalizedRank: 0.5,
    note: "estimate baseline is 0.5 by construction here (every alternative ties with the chosen); any full-model gain is tie-breaking beyond estimate.damage/turn",
  };

  return {
    modelConfig,
    modelExactness: {
      featureSchema: prior.FEATURE_SCHEMA.version,
      featureDim: prior.FEATURE_DIM,
      hiddenDim: modelConfig.hiddenDim,
      objective: "softplus(-(chosen-neg)) pairwise ranking",
      seed: modelConfig.seed,
      noNewTrainingRecipe: true,
      noModelChange: true,
      noExtraFitObjective: true,
      deterministicModelReproduction: true,
      unchangedFrom: "PR-5.25d",
    },
    protocol: {
      evaluation: "UNIQUE_SIGNATURE + BATTLE_ONLY + SAME_KIND_ONLY",
      estimateBaseline: "LEXICOGRAPHIC_LOWER_IS_BETTER",
      primaryKey1: "estimate.damage (lower is better)",
      tieBreakKey2: "estimate.turn (lower is better)",
      bothEqual: "tie",
      noFitting: true,
      noWeightTuning: true,
      noSweep: true,
      fairnessNote: "both the full model and the estimate baseline are scored on the exact same estimate-valid intersection subset",
    },
    corpus: {
      replayedFiles: corpus.replayedFiles,
      distinctRoutes: distinct.length,
      modeHistogram: corpus.modeHistogram,
    },
    split: {
      rule: corpus.analysis.splitRule,
      trainRouteCount: train.length,
      trainDecisions: trainEntries.length,
      heldOutRouteCount: heldOut.length,
      heldOutUnseenDecisions: heldOutUnseenEntries.length,
      heldOutDistinctUnseenSignatures: uniqueEntries.length,
    },
    counts: {
      uniqueUnseenSignatures: uniqueEntries.length,
      uniqueBattleChosenSignatures: battleChosen.length,
      uniqueBattleSameKindEvaluable: sameKindEvaluable,
      estimateEvaluable: intersection.length,
      intersection: intersection.length,
      droppedForMissingEstimate: sameKindEvaluable - intersection.length,
    },
    intersection: {
      decisions: perDecision.length,
      fullModelMeanNormalizedRank,
      estimateOnlyMeanNormalizedRank,
      uniformBaselineMeanNormalizedRank: 0.5,
      fullModelTop1Rate,
      estimateOnlyTop1Rate,
      generatedFullModelMinusEstimate: fullModelMeanNormalizedRank != null
        ? fullModelMeanNormalizedRank - estimateOnlyMeanNormalizedRank
        : null,
    },
    referenceFullSameKindSet: {
      decisions: referenceAllSameKind.length,
      fullModelMeanNormalizedRank: mean(referenceAllSameKind.map((row) => row.modelNormalizedRank)),
      note: "transparency only; this is the pre-intersection set, not the comparison set",
    },
    estimateTieDiagnostics: tieDiagnostics,
    fullyTiedEstimateSubset: fullyTiedSubset,
    primaryComparison: {
      rule: "FULL_MODEL_RANK < ESTIMATE_ONLY_RANK",
      value: primaryComparison,
    },
    verdict: primaryComparison
      ? "EVIDENCE_BEYOND_DAMAGE_TURN_ESTIMATE_OBSERVED"
      : "NO_EVIDENCE_BEYOND_DAMAGE_TURN_ESTIMATE",
    verdictCaveat: "even the positive verdict is NOT strategic planning; it only excludes the single estimate.damage/turn lexicographic heuristic",
  };
}

module.exports = {
  BATTLE_KIND,
  battleKindIndex,
  estimateIsValid,
  lexicographicLowerIsBetter,
  normalizedRank,
  runEstimateBaselineProbe,
};
