"use strict";

// PR-5.25e State-Conditional Signal Probe (+ Repair 1: unique-signature dedup).
//
// Cheap diagnostic on the ALREADY-FROZEN PR-5.25d model.  No new training
// recipe, no model change, no extra fit objective, no data/split change, no
// rollouts.  The deterministic model is reproduced through the shared
// preparation path.
//
// It removes the global action-kind base rate from the ranking metric by
// scoring the chosen action ONLY against legal alternatives of the SAME action
// kind:
//
//   WITHIN_KIND_RANK = rank of the chosen action among legal same-kind actions
//
// If the chosen action is the only legal action of its kind, that decision is
// not evaluable and is excluded.  The uniform baseline within a k-element
// same-kind set is 0.5 by construction, and the train action-kind prior is
// CONSTANT across same-kind actions, so its within-kind rank is exactly 0.5 --
// a built-in check that the diagnostic has removed the kind base rate.
//
// Repair 1: a decision can occur on several held-out routes, so the plain
// aggregate is DECISION-OCCURRENCE WEIGHTED and trajectory duplication can
// amplify a route fragment.  Both weightings are reported side by side:
//
//   occurrence-weighted : every held-out route occurrence counts once
//   unique-signature    : each (buildStateKey(state), chosenFingerprint)
//                         signature counts exactly once
//
// Question answered: besides learning "which action kind is more common", has
// the model learned "given this action kind, which one should be chosen now"?

const prior = require("./learned-action-prior");
const experiment = require("./learned-prior-nonoverlap-experiment");

// Advisory margin for calling a within-kind improvement "not marginal".  This is
// a reporting threshold, not a statistically established criterion.
const NOT_MARGINAL_MARGIN = 0.05;

function kindNameOfIndex(index) {
  return prior.FEATURE_SCHEMA.actionKinds[index] || `kind${index}`;
}

// Rank the chosen action among legal same-kind actions for one decision entry.
// Returns { evaluable: false } when the chosen action is the only same-kind
// legal action (no within-kind comparison available).
function withinKindDecision(model, entry) {
  const kinds = entry.vectors.map((vector) => experiment.kindIndexOfVector(vector));
  const chosenKind = kinds[entry.chosenIndex];
  const sameKindIndexes = [];
  for (let index = 0; index < kinds.length; index += 1) {
    if (kinds[index] === chosenKind) sameKindIndexes.push(index);
  }
  if (sameKindIndexes.length < 2) {
    return { evaluable: false, kind: chosenKind, size: sameKindIndexes.length };
  }
  const scores = entry.vectors.map((vector) => model.score(vector));
  const chosenScore = scores[entry.chosenIndex];
  let better = 0;
  let ties = 0;
  for (const index of sameKindIndexes) {
    if (index === entry.chosenIndex) continue;
    if (scores[index] > chosenScore) better += 1;
    else if (scores[index] === chosenScore) ties += 1;
  }
  const rank = 1 + better + ties * 0.5;
  const size = sameKindIndexes.length;
  return {
    evaluable: true,
    kind: chosenKind,
    size,
    rank,
    normalizedRank: (rank - 1) / (size - 1),
    top1: rank === 1,
  };
}

function aggregateWithinKind(model, entries) {
  let evaluable = 0;
  let normalizedSum = 0;
  let top1 = 0;
  const perKind = new Map();
  const nonEvaluableByKind = {};
  const sizeHistogram = {};
  for (const entry of entries) {
    const result = withinKindDecision(model, entry);
    const kindLabel = kindNameOfIndex(result.kind);
    if (!result.evaluable) {
      nonEvaluableByKind[kindLabel] = (nonEvaluableByKind[kindLabel] || 0) + 1;
      continue;
    }
    evaluable += 1;
    normalizedSum += result.normalizedRank;
    if (result.top1) top1 += 1;
    sizeHistogram[result.size] = (sizeHistogram[result.size] || 0) + 1;
    const bucket = perKind.get(kindLabel) || { evaluable: 0, sum: 0, top1: 0 };
    bucket.evaluable += 1;
    bucket.sum += result.normalizedRank;
    if (result.top1) bucket.top1 += 1;
    perKind.set(kindLabel, bucket);
  }
  const meanNormalizedRank = evaluable > 0 ? normalizedSum / evaluable : null;
  return {
    evaluableDecisions: evaluable,
    totalDecisions: entries.length,
    nonEvaluableDecisions: entries.length - evaluable,
    modelMeanNormalizedRank: meanNormalizedRank,
    uniformBaselineMeanNormalizedRank: 0.5,
    modelTop1Rate: evaluable > 0 ? top1 / evaluable : null,
    // Occurrence/unit label is supplied by the caller; a bare "< uniform" here
    // does not distinguish the two weightings.
    beatsUniform: meanNormalizedRank != null && meanNormalizedRank < 0.5,
    sameKindSetSizeHistogram: sizeHistogram,
    nonEvaluableByKind,
    perKind: [...perKind.entries()]
      .map(([kind, bucket]) => ({
        kind,
        evaluableDecisions: bucket.evaluable,
        meanNormalizedRank: bucket.sum / bucket.evaluable,
        top1Rate: bucket.top1 / bucket.evaluable,
        beatsUniform: bucket.sum / bucket.evaluable < 0.5,
      }))
      .sort((left, right) => right.evaluableDecisions - left.evaluableDecisions),
  };
}

// Collapse held-out entries to one per (buildStateKey, chosenFingerprint)
// signature, keeping the first occurrence.  A signature fixes the state, so the
// legal action set, evaluability and within-kind rank are identical for every
// occurrence; only the weighting changes.
function dedupeBySignature(entries) {
  const seen = new Set();
  const distinct = [];
  for (const entry of entries) {
    if (seen.has(entry.signature)) continue;
    seen.add(entry.signature);
    distinct.push(entry);
  }
  return distinct;
}

function perKindRow(aggregate, kind) {
  const row = aggregate.perKind.find((candidate) => candidate.kind === kind);
  return row || { kind, evaluableDecisions: 0, meanNormalizedRank: null, top1Rate: null, beatsUniform: false };
}

function runWithinKindDiagnostic(options) {
  const prepared = experiment.prepareNonOverlapExperiment(options);
  const { modelConfig, corpus, distinct, train, heldOut, trainEntries, trained, heldOutUnseenEntries } = prepared;

  const kindPriorModel = experiment.buildKindPriorModel(trainEntries).model;

  // References from the frozen Step 1 run (same entries, same model).
  const overallMicro = prior.evaluateChosenRank(trained.model, heldOutUnseenEntries);
  const kindPriorOverall = experiment.kindPriorBaseline(trainEntries, heldOutUnseenEntries);

  // Occurrence-weighted (Repair 0): every held-out route occurrence counts once.
  const withinKind = aggregateWithinKind(trained.model, heldOutUnseenEntries);
  const kindPriorWithinKind = aggregateWithinKind(kindPriorModel, heldOutUnseenEntries);

  // Unique-signature weighted (Repair 1): each signature counts exactly once.
  const distinctUnseenEntries = dedupeBySignature(heldOutUnseenEntries);
  const withinKindDistinct = aggregateWithinKind(trained.model, distinctUnseenEntries);
  const kindPriorWithinKindDistinct = aggregateWithinKind(kindPriorModel, distinctUnseenEntries);

  const distinctBattle = perKindRow(withinKindDistinct, "battle");
  const distinctChangeFloor = perKindRow(withinKindDistinct, "changeFloor");
  const distinctBattleMargin = distinctBattle.meanNormalizedRank == null
    ? null
    : 0.5 - distinctBattle.meanNormalizedRank;
  const distinctSignalEstablished = Boolean(
    distinctBattle.meanNormalizedRank != null
    && distinctBattle.meanNormalizedRank < 0.5 - NOT_MARGINAL_MARGIN,
  );

  return {
    modelConfig,
    modelExactness: {
      featureSchema: prior.FEATURE_SCHEMA.version,
      featureDim: prior.FEATURE_DIM,
      hiddenDim: modelConfig.hiddenDim,
      objective: "softplus(-(chosen-neg)) pairwise ranking",
      seed: modelConfig.seed,
      epochs: modelConfig.epochs,
      learningRate: modelConfig.learningRate,
      noNewTrainingRecipe: true,
      noModelChange: true,
      noExtraFitObjective: true,
      deterministicModelReproduction: true,
      note: "same deterministic frozen PR-5.25d model reproduced through the shared preparation path; no model/data/config change",
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
      heldOutDistinctUnseenSignatures: distinctUnseenEntries.length,
    },
    duplicationAmplification: {
      occurrenceDecisions: heldOutUnseenEntries.length,
      distinctSignatures: distinctUnseenEntries.length,
      amplificationFactor: distinctUnseenEntries.length > 0
        ? heldOutUnseenEntries.length / distinctUnseenEntries.length
        : null,
      note: "occurrence-weighted counts every held-out route occurrence; unique-signature counts each (buildStateKey, chosenFingerprint) once",
    },
    referenceOverall: {
      modelMicroMeanNormalizedRank: overallMicro.meanNormalizedRank,
      kindPriorMicroMeanNormalizedRank: kindPriorOverall.meanNormalizedRank,
      uniform: 0.5,
    },
    // Occurrence-weighted (unchanged from the original 5.25e evidence).
    withinKind,
    // Unique-signature weighted (Repair 1).
    withinKindDistinct,
    unique: {
      uniqueEvaluableSignatures: withinKindDistinct.evaluableDecisions,
      uniqueWithinKindAggregate: withinKindDistinct.modelMeanNormalizedRank,
      uniqueWithinKindBattle: distinctBattle.meanNormalizedRank,
      uniqueWithinKindChangeFloor: distinctChangeFloor.meanNormalizedRank,
      uniqueWithinKindTop1Rate: withinKindDistinct.modelTop1Rate,
      battleMarginBelowUniform: distinctBattleMargin,
      notMarginalMargin: NOT_MARGINAL_MARGIN,
      distinctSignalEstablished,
    },
    kindPriorWithinKindCheck: {
      occurrenceObservedMeanNormalizedRank: kindPriorWithinKind.modelMeanNormalizedRank,
      distinctObservedMeanNormalizedRank: kindPriorWithinKindDistinct.modelMeanNormalizedRank,
      expected: 0.5,
      passed: kindPriorWithinKind.modelMeanNormalizedRank != null
        && Math.abs(kindPriorWithinKind.modelMeanNormalizedRank - 0.5) < 1e-9
        && kindPriorWithinKindDistinct.modelMeanNormalizedRank != null
        && Math.abs(kindPriorWithinKindDistinct.modelMeanNormalizedRank - 0.5) < 1e-9,
      rationale: "the kind prior is constant across same-kind actions, so its within-kind rank is 0.5 exactly under either weighting",
    },
    verdict: {
      occurrenceWeightedSignal: withinKind.beatsUniform ? "OBSERVED_ABOVE_UNIFORM" : "NOT_ABOVE_UNIFORM",
      distinctSignatureSignal: distinctSignalEstablished ? "ESTABLISHED" : "NOT_ESTABLISHED",
      estimateOnlyBaseline: "NOT_YET_AUTHORIZED",
    },
  };
}

module.exports = {
  NOT_MARGINAL_MARGIN,
  aggregateWithinKind,
  dedupeBySignature,
  kindNameOfIndex,
  perKindRow,
  runWithinKindDiagnostic,
  withinKindDecision,
};
