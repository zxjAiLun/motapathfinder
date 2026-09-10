"use strict";

// PR-5.25e State-Conditional Signal Probe.
//
// Cheap diagnostic on the ALREADY-FROZEN PR-5.25d model.  No retraining, no
// model change, no data change, no rollouts.  It removes the global action-kind
// base rate from the ranking metric by scoring the chosen action ONLY against
// legal alternatives of the SAME action kind:
//
//   WITHIN_KIND_RANK = rank of the chosen action among legal same-kind actions
//
// If the chosen action is the only legal action of its kind, that decision is
// not evaluable and is excluded.  The uniform baseline within a k-element
// same-kind set is 0.5 by construction, and the train action-kind prior is
// CONSTANT across same-kind actions, so its within-kind rank is exactly 0.5 --
// a built-in check that the diagnostic has removed the kind base rate.
//
// Question answered: besides learning "which action kind is more common", has
// the model learned "given this action kind, which one should be chosen now"?

const prior = require("./learned-action-prior");
const experiment = require("./learned-prior-nonoverlap-experiment");

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

function runWithinKindDiagnostic(options) {
  const prepared = experiment.prepareNonOverlapExperiment(options);
  const { modelConfig, corpus, distinct, train, heldOut, trainEntries, trained, heldOutUnseenEntries } = prepared;

  // References from the frozen Step 1 run (same entries, same model).
  const overallMicro = prior.evaluateChosenRank(trained.model, heldOutUnseenEntries);
  const kindPriorOverall = experiment.kindPriorBaseline(trainEntries, heldOutUnseenEntries);

  const withinKind = aggregateWithinKind(trained.model, heldOutUnseenEntries);
  const kindPriorWithinKind = aggregateWithinKind(
    experiment.buildKindPriorModel(trainEntries).model,
    heldOutUnseenEntries,
  );
  // Built-in sanity: the kind prior is constant within a kind, so its mean
  // within-kind rank must be exactly 0.5 on any evaluable set.
  const kindPriorWithinKindRank = kindPriorWithinKind.modelMeanNormalizedRank;

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
      retrainedForThisDiagnostic: false,
      note: "same deterministic frozen PR-5.25d model reproduced by the shared preparation path; no model/data/config change",
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
    },
    referenceOverall: {
      modelMicroMeanNormalizedRank: overallMicro.meanNormalizedRank,
      kindPriorMicroMeanNormalizedRank: kindPriorOverall.meanNormalizedRank,
      uniform: 0.5,
    },
    withinKind,
    kindPriorWithinKindCheck: {
      observedMeanNormalizedRank: kindPriorWithinKindRank,
      expected: 0.5,
      passed: kindPriorWithinKindRank == null ? false : Math.abs(kindPriorWithinKindRank - 0.5) < 1e-9,
      rationale: "the kind prior is constant across same-kind actions, so its within-kind rank is 0.5 exactly",
    },
    verdict: withinKind.beatsUniform
      ? "WITHIN_KIND_SIGNAL_ABOVE_UNIFORM"
      : "WITHIN_KIND_NO_SIGNAL_ABOVE_UNIFORM",
  };
}

module.exports = {
  aggregateWithinKind,
  kindNameOfIndex,
  runWithinKindDiagnostic,
  withinKindDecision,
};
