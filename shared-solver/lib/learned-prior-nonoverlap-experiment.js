"use strict";

// PR-5.25d Step 1: non-overlapping trajectory generalization probe.
//
// The model is EXACTLY the PR-5.25c model (same feature schema, same 16-hidden
// MLP, same softplus(-(chosen-neg)) pairwise objective, same training recipe,
// same seed).  The only changed variable is the training corpus contract:
//
//   TRAIN     = replay-valid distinct chaos-MT1 routes that never reach MT4+
//   HELD-OUT  = replay-valid distinct chaos-MT1 routes that reach MT4+
//               (near layer: max reached == MT4, deep layer: >= MT5)
//
// Membership uses the maximum floor reached during replay, NOT the final floor,
// so a cross-floor-return route that ends on MT3 but visited MT4 is correctly
// held out.
//
// Only held-out decisions whose (buildStateKey(state), chosen fingerprint)
// signature does NOT occur in TRAIN are scored.  The frozen primary gate is the
// MICRO mean normalized rank over all genuinely non-overlapping held-out
// decisions (< 0.5).  The macro average, the per-route ranks and the kind-prior
// baseline are transparency metrics only, NOT additional gates.

const prior = require("./learned-action-prior");
const inventory = require("./learned-prior-corpus-inventory");

function toEntry(route, decision) {
  return {
    routeId: route.relPath,
    decisionIndex: decision.decisionIndex,
    kind: decision.kind,
    floorId: decision.floorId,
    signature: decision.signature,
    vectors: decision.vectors,
    chosenIndex: decision.chosenIndex,
    actionEstimates: decision.actionEstimates || null,
  };
}

function flattenTrainEntries(routes) {
  const entries = [];
  for (const route of routes) {
    for (const decision of route.decisionRecords) entries.push(toEntry(route, decision));
  }
  return entries;
}

function unseenEntriesForRoute(route, trainSignatures) {
  return route.decisionRecords
    .filter((decision) => !trainSignatures.has(decision.signature))
    .map((decision) => toEntry(route, decision));
}

function aggregateByLayer(routeResults, layer) {
  const subset = routeResults.filter((row) => row.layer === layer);
  const count = subset.reduce((sum, row) => sum + row.metricCount, 0);
  const weighted = subset.reduce((sum, row) => sum + row.meanNormalizedRank * row.metricCount, 0);
  return {
    layer,
    routes: subset.length,
    unseenDecisions: count,
    meanNormalizedRank: count > 0 ? weighted / count : null,
    beatsUniform: count > 0 ? weighted / count < 0.5 : false,
  };
}

// The first STATE_FEATURE_COUNT action features are the action-kind one-hot, so
// the kind of any encoded action can be recovered without storing it again.
function kindIndexOfVector(vector) {
  for (let index = 0; index < prior.FEATURE_SCHEMA.actionKinds.length; index += 1) {
    if (vector[prior.STATE_FEATURE_COUNT + index] === 1) return index;
  }
  return prior.FEATURE_SCHEMA.actionKinds.length - 1;
}

function buildKindPriorModel(trainEntries) {
  const kinds = prior.FEATURE_SCHEMA.actionKinds;
  const counts = new Array(kinds.length).fill(0);
  for (const entry of trainEntries) counts[kindIndexOfVector(entry.vectors[entry.chosenIndex])] += 1;
  const total = trainEntries.length;
  const probability = counts.map((count) => (count + 1) / (total + kinds.length));
  return {
    kindCounts: kinds.reduce((map, kind, index) => { map[kind] = counts[index]; return map; }, {}),
    model: { score: (vector) => probability[kindIndexOfVector(vector)] },
  };
}

// Transparency control: rank by the TRAIN empirical action-kind prior with
// Laplace smoothing.  If the learned model is no better than this, the learned
// signal is a trivial "prefer the common action kind" bias.
function kindPriorBaseline(trainEntries, heldOutEntries) {
  const { model, kindCounts } = buildKindPriorModel(trainEntries);
  const micro = prior.evaluateChosenRank(model, heldOutEntries);
  return {
    metric: "micro mean normalized rank of the train action-kind prior on the same unseen decisions",
    kindCounts,
    unseenDecisions: micro.count,
    meanNormalizedRank: micro.meanNormalizedRank,
    top1Rate: micro.top1Rate,
  };
}

// Single preparation path shared by the Step 1 probe and the PR-5.25e
// within-kind diagnostic, so the frozen model is trained exactly once per run
// with identical configuration and never redefined.
function prepareNonOverlapExperiment(options) {
  const config = options || {};
  const modelConfig = Object.assign({}, prior.DEFAULT_CONFIG, config.modelConfig || {});
  const corpus = config.corpus || inventory.inventoryCorpus({ captureDecisions: true });
  const { distinct } = inventory.dedupeBySignatureSequence(corpus.distinctRouteRecords);
  const { train, heldOut } = inventory.splitByMaxReachedFloor(distinct);
  if (train.length === 0 || heldOut.length === 0) {
    throw new Error(`split produced empty family: train=${train.length} heldOut=${heldOut.length}`);
  }
  const trainSignatures = inventory.signatureUniverse(train);
  const trainEntries = flattenTrainEntries(train);
  const trained = prior.trainModel(trainEntries, modelConfig);
  const heldOutUnseenByRoute = heldOut.map((route) => ({
    route,
    entries: unseenEntriesForRoute(route, trainSignatures),
  }));
  const heldOutUnseenEntries = [].concat(...heldOutUnseenByRoute.map((item) => item.entries));
  return {
    modelConfig,
    corpus,
    distinct,
    train,
    heldOut,
    trainSignatures,
    trainEntries,
    trained,
    heldOutUnseenByRoute,
    heldOutUnseenEntries,
  };
}

function runNonOverlapExperiment(options) {
  const prepared = prepareNonOverlapExperiment(options);
  const {
    modelConfig, corpus, distinct, train, heldOut, trainSignatures, trainEntries, trained, heldOutUnseenByRoute,
  } = prepared;
  const trainInSample = prior.evaluateChosenRank(trained.model, trainEntries);

  const routeResults = [];
  const allUnseenEntries = [];
  const unseenSignatureRoutes = new Map();
  for (const { route, entries } of heldOutUnseenByRoute) {
    for (const entry of entries) {
      if (!unseenSignatureRoutes.has(entry.signature)) unseenSignatureRoutes.set(entry.signature, new Set());
      unseenSignatureRoutes.get(entry.signature).add(route.relPath);
    }
    if (entries.length === 0) {
      routeResults.push({
        relPath: route.relPath,
        layer: route.layer,
        finalFloor: route.finalFloor,
        maxReachedFloorOrdinal: route.maxReachedFloorOrdinal,
        decisions: route.decisions,
        unseenDecisions: 0,
        metricCount: 0,
        meanNormalizedRank: null,
        top1Rate: null,
        beatsUniform: false,
      });
      continue;
    }
    const metric = prior.evaluateChosenRank(trained.model, entries);
    allUnseenEntries.push(...entries);
    routeResults.push({
      relPath: route.relPath,
      layer: route.layer,
      finalFloor: route.finalFloor,
      maxReachedFloorOrdinal: route.maxReachedFloorOrdinal,
      decisions: route.decisions,
      unseenDecisions: entries.length,
      metricCount: metric.count,
      meanNormalizedRank: metric.meanNormalizedRank,
      top1Rate: metric.top1Rate,
      beatsUniform: metric.beatsUniform,
    });
  }

  const micro = prior.evaluateChosenRank(trained.model, allUnseenEntries);
  const scoredRoutes = routeResults.filter((row) => row.metricCount > 0);
  const macroMeanNormalizedRank = scoredRoutes.length > 0
    ? scoredRoutes.reduce((sum, row) => sum + row.meanNormalizedRank, 0) / scoredRoutes.length
    : null;
  const nearAggregate = aggregateByLayer(routeResults, "near");
  const deepAggregate = aggregateByLayer(routeResults, "deep");
  const amplified = [...unseenSignatureRoutes.values()].filter((set) => set.size > 1).length;

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
      temperature: modelConfig.temperature,
      unchangedFrom: "PR-5.25c",
    },
    corpus: {
      scannedFiles: corpus.scannedFiles,
      replayedFiles: corpus.replayedFiles,
      distinctRoutes: distinct.length,
      duplicateRoutes: corpus.duplicateRoutes,
      modeHistogram: corpus.modeHistogram,
      failureHistogram: corpus.failureHistogram,
      maxReachedFloorHistogram: distinct.reduce((map, route) => {
        const key = `max${route.maxReachedFloorOrdinal}`;
        map[key] = (map[key] || 0) + 1;
        return map;
      }, {}),
    },
    split: {
      rule: corpus.analysis.splitRule,
      trainRouteCount: train.length,
      trainDecisions: trainEntries.length,
      trainDistinctSignatures: trainSignatures.size,
      heldOutRouteCount: heldOut.length,
      heldOutNearRouteCount: routeResults.filter((row) => row.layer === "near").length,
      heldOutDeepRouteCount: routeResults.filter((row) => row.layer === "deep").length,
      heldOutUnseenDecisions: allUnseenEntries.length,
      heldOutDistinctUnseenSignatures: unseenSignatureRoutes.size,
      unseenSignaturesSharedByMultipleHeldOutRoutes: amplified,
      amplificationNote: `${allUnseenEntries.length} unseen decisions come from ${unseenSignatureRoutes.size} distinct signatures; ${amplified} signatures appear in more than one held-out route`,
    },
    trainInSample: {
      metricCount: trainInSample.count,
      meanNormalizedRank: trainInSample.meanNormalizedRank,
      top1Rate: trainInSample.top1Rate,
    },
    primary: {
      metric: "micro mean normalized rank over all genuinely non-overlapping held-out decisions",
      unseenDecisions: micro.count,
      meanNormalizedRank: micro.meanNormalizedRank,
      top1Rate: micro.top1Rate,
      uniformBaselineMeanNormalizedRank: 0.5,
      gate: "meanNormalizedRank < 0.5",
      passed: micro.beatsUniform,
    },
    transparency: {
      macroMeanNormalizedRankAcrossHeldOutRoutes: macroMeanNormalizedRank,
      scoredHeldOutRoutes: scoredRoutes.length,
      notAGate: true,
      nearAggregate,
      deepAggregate,
      kindPriorBaseline: kindPriorBaseline(trainEntries, allUnseenEntries),
      perRoute: routeResults,
    },
    verdict: micro.beatsUniform
      ? "NON_OVERLAP_RANK_BEATS_UNIFORM"
      : "NON_OVERLAP_RANK_DOES_NOT_BEAT_UNIFORM",
  };
}

module.exports = {
  buildKindPriorModel,
  flattenTrainEntries,
  kindIndexOfVector,
  kindPriorBaseline,
  prepareNonOverlapExperiment,
  runNonOverlapExperiment,
  unseenEntriesForRoute,
};
