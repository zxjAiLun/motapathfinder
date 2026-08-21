"use strict";

const crypto = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");

const { strictReplayRoute } = require("./agenda-policy-evaluation");
const { buildSegmentGoalPredicate } = require("./segment-dp");
const { buildRouteRecord, recordedActionVariantIdentity } = require("./route-store");
const { buildStateKey } = require("./state-key");
const { cloneState } = require("./state");
const { diffStrategicOptionMaps } = require("./strategic-option-map");
const {
  aggregateVariantsIntoTransitions,
  createStrategicStateIndexCache,
  diffReachablePoiSets,
  explicitActionTargetKey,
  futureOptionScore,
  mutationCount,
  selectCanonicalPostState,
  summarizeResourceDelta,
  terminalBattleProjection,
} = require("./strategic-transition");
const {
  buildTerminalChoiceTarget,
  runLocalConnector,
  verifyConnectorChain,
} = require("./strategic-connector");
const {
  analyzeTerminalBlocker,
  runBlockerDerivedConnector,
} = require("./strategic-blocker");
const {
  compileDependenciesFromTransitions,
  compileUnreachableTerminalDependencies,
  createDependencyAttemptDedupe,
  dependencyAttemptId,
  runDependencyConnector,
  selectFeedbackAwareDependencyAttempts,
} = require("./strategic-dependency");
const {
  buildDependencyAccessAttribution,
  buildFullStructuralAccessAttribution,
  createDependencyAccessObserver,
} = require("./strategic-dependency-attribution");
const { compileBattleAccessPrerequisite, evaluateBattleViability } = require("./strategic-access-prerequisite");
const { compileBattleStagePrerequisite } = require("./strategic-battle-stage-prerequisite");
const { createLethalSurvivalObserver } = require("./strategic-lethal-survival-observer");
const { createSurvivalEdgeObserver } = require("./strategic-survival-edge-observer");
const {
  attributeResidualPaidWitnessGraph,
  attributePostO3ResidualPrefix,
  firstPrefixCompatibleReplayValidResidual,
} = require("./strategic-survival-residual-attribution");
const { compileSurvivalOpportunityPrerequisite } = require("./strategic-survival-opportunity-prerequisite");
const { analyzeBattleViabilityBlocker } = require("./strategic-battle-viability");
const {
  dependencyTargetFloorId,
  isNodeDescendantOf,
  parentContinuationId,
  parentContinuationKey,
  shouldReactivateMergedParentContinuation,
} = require("./strategic-parent-continuation");
const { HierarchyPriorityController } = require("./strategic-hierarchy-priority");
const { AnchorExpansionRequestQueue } = require("./strategic-anchor-expansion-request");
const { LazyWorkQueue } = require("./strategic-lazy-work");
const {
  createChildNode,
  createRootNode,
  reconstructActionEntries,
} = require("./search-nodes");

const SCHEMA = "motapathfinder.strategic-d2-search.v3";

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}

/**
 * PR-5.19u pure pre-charge semantic vector builder. Shared by the charge site
 * and the root compile-site candidate pool so the two never drift. Only
 * pre-charge observable inputs are allowed; connector outcomes, expansions,
 * productive labels, continuations, and O1-O4 results are deliberately absent.
 * `enemyId/x/y` are identity fields handled separately, never inside the
 * semantic vector, so they can never act as separators.
 */
function buildRootAttemptSemanticVector(options) {
  const config = options || {};
  const prerequisite = config.prerequisite;
  const sourceNode = config.sourceNode;
  const beforeBattle = config.beforeBattle || null;
  const projection = config.projection || null;
  const compiledCandidateRank = config.compiledCandidateRank;
  const compiledCandidateCount = config.compiledCandidateCount;
  return {
    prerequisiteKind: (prerequisite && prerequisite.kind) || null,
    stageGoal: (prerequisite && prerequisite.stageGoal) || null,
    parentDependencyKind: (prerequisite && prerequisite.parentDependency &&
      prerequisite.parentDependency.kind) || null,
    parentDependencyCapability: (prerequisite && prerequisite.parentDependency &&
      prerequisite.parentDependency.capability) || null,
    reachableAtCompileTime: Boolean(prerequisite && prerequisite.provenance &&
      prerequisite.provenance.reachableAtCompileTime),
    sourceDepth: number(sourceNode && sourceNode.depth, 0),
    sourceFloor: (sourceNode && sourceNode.state && sourceNode.state.floorId) || null,
    beforeStage: beforeBattle ? beforeBattle.stage : null,
    attackMargin: beforeBattle && beforeBattle.attackMargin != null
      ? beforeBattle.attackMargin
      : null,
    damage: beforeBattle && beforeBattle.damage != null ? beforeBattle.damage : null,
    survivalMargin: beforeBattle && beforeBattle.survivalMargin != null
      ? beforeBattle.survivalMargin
      : null,
    sourceTerminalProgressScore: projection && projection.progressScore != null
      ? projection.progressScore
      : null,
    compiledCandidateRank: compiledCandidateRank == null
      ? null
      : number(compiledCandidateRank, 0),
    compiledCandidateCount: compiledCandidateCount == null
      ? null
      : number(compiledCandidateCount, 0),
  };
}

/**
 * Canonical/stable serializer: recursive key-sort so structurally equal
 * objects hash identically regardless of key insertion order. Used for
 * semantic fingerprints instead of hash(JSON.stringify(object)).
 */
function stableSerialize(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashStable(value) {
  return hash(stableSerialize(value));
}

function buildTemporalVector(entry) {
  if (!entry || entry.temporal == null) return null;
  return {
    callOrdinal: entry.callOrdinal == null ? null : entry.callOrdinal,
    expansionAtCharge: entry.temporal.expansionAtCharge == null
      ? null
      : entry.temporal.expansionAtCharge,
  };
}

const RETRY_REQUIRED_METRICS = [
  "attackMargin",
  "survivalMargin",
  "sourceTerminalProgressScore",
  "damage",
  "reachableAtCompileTime",
];
const RETRY_HIGHER_BETTER = new Set([
  "attackMargin",
  "survivalMargin",
  "sourceTerminalProgressScore",
]);
const RETRY_LOWER_BETTER = new Set(["damage"]);
const RETRY_CONTEXT_KEYS = [
  "sourceDepth",
  "sourceFloor",
  "beforeStage",
  "stageGoal",
  "compiledCandidateRank",
  "compiledCandidateCount",
];

function retryBoundaryIdentityKey(identity) {
  if (!identity) return "null";
  return [identity.floorId, identity.enemyId, identity.x, identity.y]
    .map((value) => (value == null ? "null" : String(value)))
    .join("|");
}

function compareRootRetryMetrics(retrySemantic, earlierSemantic) {
  const improvedFields = [];
  const regressedFields = [];
  const equalFields = [];
  const missingFields = [];
  for (const metric of RETRY_REQUIRED_METRICS) {
    const retryValue = retrySemantic[metric];
    const earlierValue = earlierSemantic[metric];
    if (retryValue == null || earlierValue == null) {
      missingFields.push(metric);
      continue;
    }
    if (isDeepStrictEqual(retryValue, earlierValue)) {
      equalFields.push(metric);
      continue;
    }
    let improved;
    if (metric === "reachableAtCompileTime") {
      improved = retryValue === true && earlierValue === false;
    } else if (RETRY_HIGHER_BETTER.has(metric)) {
      improved = retryValue > earlierValue;
    } else if (RETRY_LOWER_BETTER.has(metric)) {
      improved = retryValue < earlierValue;
    } else {
      improved = false;
    }
    if (improved) improvedFields.push(metric);
    else regressedFields.push(metric);
  }
  return { improvedFields, regressedFields, equalFields, missingFields };
}

function retryContextDifferenceKeys(retrySemantic, earlierSemantic) {
  return RETRY_CONTEXT_KEYS.filter((key) =>
    !isDeepStrictEqual(retrySemantic[key], earlierSemantic[key]));
}

/**
 * PR-5.19v pure pre-charge retry novelty classification. Compares only root
 * calls charged before any hierarchy activation, grouped by prerequisiteId +
 * full boundary identity. Each retry is compared against ALL earlier calls in
 * its group. Only pre-charge metrics drive improved/regressed/equal/missing;
 * context fields are reported separately as contextDifferenceKeys and never
 * count as metric improvement. No post-search fields (productive/satisfied/
 * materialized/continuation) are read here.
 */
function classifyPairwiseRetryComparison(retryCall, earlierCall) {
  const metric = compareRootRetryMetrics(retryCall.semantic, earlierCall.semantic);
  const contextDifferenceKeys = retryContextDifferenceKeys(retryCall.semantic, earlierCall.semantic);
  const exactSemanticEqual = isDeepStrictEqual(retryCall.semantic, earlierCall.semantic);
  let classification;
  if (exactSemanticEqual) {
    classification = "EXACT-SEMANTIC-RETRY";
  } else if (metric.missingFields.length > 0) {
    classification = "EVIDENCE-INCOMPLETE";
  } else if (metric.improvedFields.length > 0 && metric.regressedFields.length > 0) {
    classification = "MIXED-TRADEOFF";
  } else if (metric.improvedFields.length > 0) {
    classification = "CURRENT-ATTEMPT-IMPROVES";
  } else if (metric.regressedFields.length > 0) {
    classification = "PRIOR-ATTEMPT-DOMINATES";
  } else {
    classification = "METRIC-TIE-CONTEXT-ONLY";
  }
  return {
    earlierCallOrdinal: earlierCall.callOrdinal,
    earlierAttemptId: earlierCall.attemptId,
    classification,
    improvedFields: metric.improvedFields.slice(),
    regressedFields: metric.regressedFields.slice(),
    equalFields: metric.equalFields.slice(),
    missingFields: metric.missingFields.slice(),
    contextDifferenceKeys: contextDifferenceKeys.slice(),
    exactSemanticEqual,
  };
}

// Pure retry-level aggregation: decisive earlier witnesses determine the level.
// Priority per retry (ordered): EXACT > PRIOR-DOMINATES > METRIC-TIE > INCOMPLETE ...
// The retry-level classification reports the decisive witness kind, but only
// once strong non-improving witnesses are absent do incomplete comparisons take
// effect.
function aggregateRetryLevelClassification(pairwiseComparisons) {
  const decisivePairs = (targetClassification) =>
    pairwiseComparisons.filter((entry) => entry.classification === targetClassification);
  const firstMatch = (target) => {
    const matches = decisivePairs(target);
    return matches.length > 0 ? matches.map((entry) => entry.earlierCallOrdinal) : [];
  };
  const exactPairs = decisivePairs("EXACT-SEMANTIC-RETRY");
  if (exactPairs.length > 0) {
    return { classification: "EXACT-SEMANTIC-RETRY", decisiveEarlierCallOrdinals: exactPairs.map((e) => e.earlierCallOrdinal) };
  }
  const dominancePairs = decisivePairs("PRIOR-ATTEMPT-DOMINATES");
  if (dominancePairs.length > 0) {
    return { classification: "PRIOR-ATTEMPT-DOMINATES", decisiveEarlierCallOrdinals: dominancePairs.map((e) => e.earlierCallOrdinal) };
  }
  const tiePairs = decisivePairs("METRIC-TIE-CONTEXT-ONLY");
  if (tiePairs.length > 0) {
    return { classification: "METRIC-TIE-CONTEXT-ONLY", decisiveEarlierCallOrdinals: tiePairs.map((e) => e.earlierCallOrdinal) };
  }
  if (pairwiseComparisons.some((entry) => entry.classification === "EVIDENCE-INCOMPLETE")) {
    return {
      classification: "EVIDENCE-INCOMPLETE",
      decisiveEarlierCallOrdinals: decisivePairs("EVIDENCE-INCOMPLETE").map((e) => e.earlierCallOrdinal),
    };
  }
  if (pairwiseComparisons.some((entry) => entry.classification === "MIXED-TRADEOFF")) {
    return { classification: "MIXED-TRADEOFF", decisiveEarlierCallOrdinals: firstMatch("MIXED-TRADEOFF") };
  }
  if (pairwiseComparisons.some((entry) => entry.classification === "CURRENT-ATTEMPT-IMPROVES")) {
    return { classification: "CURRENT-ATTEMPT-IMPROVES", decisiveEarlierCallOrdinals: firstMatch("CURRENT-ATTEMPT-IMPROVES") };
  }
  return { classification: "EVIDENCE-INCOMPLETE", decisiveEarlierCallOrdinals: [] };
}

function classifyPreHierarchyRootRetryNovelty(rootCalls) {
  const preHierarchyCalls = (rootCalls || []).filter((call) =>
    call && call.temporal && call.temporal.firstHierarchyActivationOccurred === false);
  const groups = new Map();
  for (const call of preHierarchyCalls) {
    const key = `${call.prerequisiteId || "?"}|${retryBoundaryIdentityKey(call.identity)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(call);
  }
  const comparisons = [];
  const repeatGroups = [];
  for (const [groupKey, groupCalls] of groups.entries()) {
    groupCalls.sort((left, right) => left.callOrdinal - right.callOrdinal);
    if (groupCalls.length > 1) {
      repeatGroups.push({
        groupKey,
        prerequisiteId: groupCalls[0].prerequisiteId,
        identity: groupCalls[0].identity,
        callOrdinals: groupCalls.map((call) => call.callOrdinal),
      });
    }
    for (let index = 0; index < groupCalls.length; index += 1) {
      const retry = groupCalls[index];
      const base = {
        callOrdinal: retry.callOrdinal,
        attemptId: retry.attemptId,
        prerequisiteId: retry.prerequisiteId,
        parentDependencyId: retry.parentDependencyId,
        groupKey,
        identity: retry.identity,
      };
      if (index === 0) {
        comparisons.push({
          ...base,
          classification: "FIRST-SEEN",
          comparedCallOrdinals: [],
          pairwiseComparisons: [],
          improvedFields: [],
          regressedFields: [],
          equalFields: [],
          missingFields: [],
          contextDifferenceKeys: [],
          exactSemanticEqual: false,
          decisiveEarlierCallOrdinals: [],
        });
        continue;
      }
      const earlierCalls = groupCalls.slice(0, index);
      const pairwiseComparisons = earlierCalls.map((earlier) =>
        classifyPairwiseRetryComparison(retry, earlier));
      const aggregated = aggregateRetryLevelClassification(pairwiseComparisons);
      const union = (key) => Array.from(new Set(
        pairwiseComparisons.flatMap((entry) => entry[key] || []),
      ));
      comparisons.push({
        ...base,
        classification: aggregated.classification,
        comparedCallOrdinals: earlierCalls.map((call) => call.callOrdinal),
        pairwiseComparisons,
        improvedFields: union("improvedFields"),
        regressedFields: union("regressedFields"),
        equalFields: union("equalFields"),
        missingFields: union("missingFields"),
        contextDifferenceKeys: union("contextDifferenceKeys"),
        exactSemanticEqual: pairwiseComparisons.some((entry) => entry.exactSemanticEqual),
        decisiveEarlierCallOrdinals: aggregated.decisiveEarlierCallOrdinals,
      });
    }
  }
  return {
    rootCallCount: preHierarchyCalls.length,
    repeatGroupCount: repeatGroups.length,
    repeatGroups,
    comparisons,
  };
}

function classifyRootRetryOfflineVerdict(preChargeComparisons, postSearchEvaluation) {
  const comparisons = preChargeComparisons || [];
  const nonImprovingClassifications = new Set([
    "PRIOR-ATTEMPT-DOMINATES",
    "METRIC-TIE-CONTEXT-ONLY",
    "EXACT-SEMANTIC-RETRY",
  ]);
  const evaluationsByCall = new Map();
  for (const entry of postSearchEvaluation || []) {
    if (entry == null || entry.callOrdinal == null) continue;
    const entries = evaluationsByCall.get(entry.callOrdinal) || [];
    entries.push(entry);
    evaluationsByCall.set(entry.callOrdinal, entries);
  }
  const incompleteOrdinals = [];
  const productiveFlaggedOrdinals = [];
  const nonProductiveFlaggedOrdinals = [];
  const missingEvaluationCallOrdinals = [];
  for (const entry of comparisons) {
    if (entry.classification === "EVIDENCE-INCOMPLETE") {
      incompleteOrdinals.push(entry.callOrdinal);
      continue;
    }
    if (!nonImprovingClassifications.has(entry.classification)) continue;
    const evaluationEntries = evaluationsByCall.get(entry.callOrdinal) || [];
    if (evaluationEntries.length !== 1 || typeof evaluationEntries[0].productive !== "boolean") {
      if (!missingEvaluationCallOrdinals.includes(entry.callOrdinal)) {
        missingEvaluationCallOrdinals.push(entry.callOrdinal);
      }
      continue;
    }
    if (evaluationEntries[0].productive) productiveFlaggedOrdinals.push(entry.callOrdinal);
    else nonProductiveFlaggedOrdinals.push(entry.callOrdinal);
  }
  const sortedMissing = missingEvaluationCallOrdinals.slice().sort((a, b) => a - b);
  // Priority: PRODUCTIVE > EVIDENCE-INCOMPLETE (pre-charge or linkage) > TRACE-LOCAL > NO-PRECHARGE.
  if (productiveFlaggedOrdinals.length > 0) {
    return {
      verdict: "PRODUCTIVE-ROOT-WOULD-BE-FLAGGED",
      productiveFlaggedCallOrdinals: productiveFlaggedOrdinals.slice().sort((a, b) => a - b),
      nonProductiveFlaggedCallOrdinals: nonProductiveFlaggedOrdinals.slice().sort((a, b) => a - b),
      incompleteCallOrdinals: incompleteOrdinals.slice().sort((a, b) => a - b),
      missingEvaluationCallOrdinals: sortedMissing,
    };
  }
  if (incompleteOrdinals.length > 0 || sortedMissing.length > 0) {
    return {
      verdict: "EVIDENCE-INCOMPLETE",
      productiveFlaggedCallOrdinals: [],
      nonProductiveFlaggedCallOrdinals: nonProductiveFlaggedOrdinals.slice().sort((a, b) => a - b),
      incompleteCallOrdinals: incompleteOrdinals.slice().sort((a, b) => a - b),
      missingEvaluationCallOrdinals: sortedMissing,
    };
  }
  if (nonProductiveFlaggedOrdinals.length > 0) {
    return {
      verdict: "TRACE-LOCAL-NONPRODUCTIVE-DOMINATED-RETRY-OBSERVED",
      productiveFlaggedCallOrdinals: [],
      nonProductiveFlaggedCallOrdinals: nonProductiveFlaggedOrdinals.slice().sort((a, b) => a - b),
      incompleteCallOrdinals: [],
      missingEvaluationCallOrdinals: sortedMissing,
    };
  }
  return {
    verdict: "NO-PRECHARGE-NONIMPROVING-RETRY",
    productiveFlaggedCallOrdinals: [],
    nonProductiveFlaggedCallOrdinals: [],
    incompleteCallOrdinals: [],
    missingEvaluationCallOrdinals: sortedMissing,
  };
}

/**
 * PR-5.19u pure classification. U2/U3 are mutually exclusive:
 *   U2 = partial collision (>=1 but not all failed roots equal the productive root)
 *   U3 = ALL failed roots semantically equal the productive root AND a real
 *        temporal separator exists (callOrdinal / expansionAtCharge).
 *        If semantic collides but temporal is unavailable or cannot separate,
 *        the result is U4 with reason "semantic-collision-without-temporal-separator".
 *   U1 = no collision and at least one single semantic feature separates from all
 *   U1-COMBINATION-ONLY = no collision, distinct from all, but only in combination
 *   U4 = otherwise / insufficient evidence
 * All equality (semantic fields, temporal fields, object values) uses
 * isDeepStrictEqual, never !== or stringify.
 */
function classifyRootAttemptSeparability(productiveCall, failedRoots) {
  const semanticKeys = failedRoots.length > 0
    ? Object.keys(productiveCall.semantic)
    : [];
  const failedCollisions = failedRoots.filter((failed) =>
    isDeepStrictEqual(failed.semantic, productiveCall.semantic));
  const anyCollision = failedCollisions.length > 0;
  const allFailedEqualToProductive = failedRoots.length > 0 &&
    failedCollisions.length === failedRoots.length;
  const distinctFromAllFailedRoots = failedRoots.length > 0 &&
    failedRoots.every((failed) => !isDeepStrictEqual(failed.semantic, productiveCall.semantic));
  const singleFeatureSeparators = semanticKeys.filter((key) => {
    const productiveValue = productiveCall.semantic[key];
    return failedRoots.every((failed) =>
      !isDeepStrictEqual(failed.semantic[key], productiveValue));
  });
  const productiveTemporal = buildTemporalVector(productiveCall);
  const failedTemporals = failedRoots.map(buildTemporalVector);
  const temporalProvided = productiveTemporal != null &&
    failedTemporals.every((temporal) => temporal != null);
  const temporalKeys = productiveTemporal != null ? Object.keys(productiveTemporal) : [];
  const singleTemporalSeparators = temporalKeys.filter((key) => {
    const productiveValue = productiveTemporal[key];
    return failedTemporals.every((failed) =>
      failed != null && !isDeepStrictEqual(failed[key], productiveValue));
  });
  let classification = "U4";
  let reason = null;
  if (anyCollision && !allFailedEqualToProductive) {
    classification = "U2";
  } else if (allFailedEqualToProductive) {
    if (temporalProvided && singleTemporalSeparators.length > 0) {
      classification = "U3";
    } else {
      classification = "U4";
      reason = "semantic-collision-without-temporal-separator";
    }
  } else if (singleFeatureSeparators.length > 0) {
    classification = "U1";
  } else if (distinctFromAllFailedRoots) {
    classification = "U1-COMBINATION-ONLY";
  }
  return {
    classification,
    reason,
    singleFeatureSeparators,
    singleTemporalSeparators,
    collisionAttemptIds: failedCollisions.map((failed) => failed.attemptId),
    distinctFromAllFailedRoots,
    vectorEqualityDetails: {
      anyCollision,
      allFailedEqualToProductive,
      collisionAttemptIds: failedCollisions.map((failed) => failed.attemptId),
      productiveSemanticFingerprint: hashStable(productiveCall.semantic),
      failedSemanticFingerprints: failedRoots.map((failed) => ({
        attemptId: failed.attemptId,
        fingerprint: hashStable(failed.semantic),
      })),
      temporalProvided,
      singleTemporalSeparators,
    },
  };
}

class BinaryHeap {
  constructor(compare) {
    this.compare = compare;
    this.items = [];
  }

  push(item) {
    this.items.push(item);
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.compare(this.items[index], this.items[parent]) <= 0) break;
      [this.items[index], this.items[parent]] = [this.items[parent], this.items[index]];
      index = parent;
    }
  }

  pop() {
    if (this.items.length === 0) return null;
    const first = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0) {
      this.items[0] = last;
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        let best = index;
        if (left < this.items.length && this.compare(this.items[left], this.items[best]) > 0) best = left;
        if (right < this.items.length && this.compare(this.items[right], this.items[best]) > 0) best = right;
        if (best === index) break;
        [this.items[index], this.items[best]] = [this.items[best], this.items[index]];
        index = best;
      }
    }
    return first;
  }

  get length() {
    return this.items.length;
  }
}

function heroScore(state) {
  const hero = (state || {}).hero || {};
  return number(hero.atk, 0) * 1000000 +
    number(hero.def, 0) * 1000000 +
    number(hero.mdef, 0) * 1000 +
    number(hero.lv, 0) * 100000 +
    number(hero.exp, 0);
}

function goalPriority(simulator, state, terminalGoal) {
  const projection = terminalBattleProjection(simulator, state, terminalGoal);
  const onGoalFloor = state.floorId === terminalGoal.floorId ? 1 : 0;
  const progress = projection && projection.progressScore != null
    ? projection.progressScore
    : -1000000000;
  return onGoalFloor * 10000000000000 + progress + heroScore(state);
}

function incomingBlockerBonus(node) {
  const transition = node.strategicTransition;
  if (!transition || !transition.terminalBlockerDelta || transition.terminalBlockerDelta.delta == null) {
    return 0;
  }
  return transition.terminalBlockerDelta.delta > 0 ? 1000000 : 0;
}

function terminalProgressTerm(simulator, state, terminalGoal) {
  const projection = terminalBattleProjection(simulator, state, terminalGoal);
  return projection && projection.progressScore != null ? projection.progressScore : -1000000000;
}

function compareBy(score) {
  return (left, right) => score(left) - score(right) || right.order - left.order;
}

function makeAgenda(simulator, terminalGoal) {
  const definitions = [
    {
      id: "terminal-blocker-progress",
      compare: compareBy((node) =>
        goalPriority(simulator, node.state, terminalGoal) + incomingBlockerBonus(node)),
    },
    {
      id: "survival",
      compare: compareBy((node) => number((node.state.hero || {}).hp, 0)),
    },
    {
      id: "combat-power",
      compare: compareBy((node) => heroScore(node.state)),
    },
    {
      id: "future-reachable-options",
      compare: compareBy((node) =>
        futureOptionScore(node.reachablePoi) * 1000000 +
        terminalProgressTerm(simulator, node.state, terminalGoal)),
    },
    {
      id: "low-irreversible-cost",
      compare: compareBy((node) => {
        const cost = (node.strategicTransition && node.strategicTransition.irreversibleCost) ||
          { total: 0 };
        return -number(cost.total, 0) * 1000000 - node.depth;
      }),
    },
    {
      id: "novel-semantic-state",
      compare: compareBy((node) => {
        const transition = node.strategicTransition;
        if (!transition) return 0;
        return (transition.newlyDiscoveredPOIs || []).length * 1000000000 -
          (transition.noLongerReachablePOIs || []).length * 1000 +
          node.depth;
      }),
    },
  ];
  return {
    definitions,
    queues: definitions.map((definition) => new BinaryHeap(definition.compare)),
    cursor: 0,
    push(node) {
      this.queues.forEach((queue) => queue.push(node));
    },
    pop(expanded) {
      for (let attempts = 0; attempts < this.queues.length; attempts += 1) {
        const queueIndex = this.cursor % this.queues.length;
        this.cursor += 1;
        const queue = this.queues[queueIndex];
        let node = queue.pop();
        while (node && expanded.has(node.nodeId)) node = queue.pop();
        if (node) return { node, queueId: this.definitions[queueIndex].id };
      }
      return null;
    },
    activeSize(expanded) {
      const ids = new Set();
      this.queues.forEach((queue) => queue.items.forEach((node) => {
        if (!expanded.has(node.nodeId)) ids.add(node.nodeId);
      }));
      return ids.size;
    },
  };
}

function compactWitness(simulator, terminalGoal, nodes, node, role) {
  const hero = (node.state || {}).hero || {};
  const transition = node.strategicTransition;
  return {
    role,
    nodeId: node.nodeId,
    depth: node.depth,
    floorId: node.state.floorId,
    hero: {
      hp: number(hero.hp, 0),
      atk: number(hero.atk, 0),
      def: number(hero.def, 0),
      mdef: number(hero.mdef, 0),
      lv: number(hero.lv, 0),
      exp: number(hero.exp, 0),
      equipment: Array.isArray(hero.equipment) ? hero.equipment.slice() : [],
    },
    optionCounts: { ...node.optionMap.counts },
    optionMapFingerprint: node.optionMap.fingerprint,
    reachablePoiCounts: node.reachablePoi ? { ...node.reachablePoi.counts } : null,
    reachablePoiFingerprint: node.reachablePoi ? node.reachablePoi.fingerprint : null,
    mutationCount: mutationCount(node.state),
    terminalBattle: terminalBattleProjection(simulator, node.state, terminalGoal),
    incomingTransition: transition ? {
      choice: transition.choiceLabel,
      targetPOI: transition.targetPOI,
      travelVariantCount: transition.travelVariantCount,
      exactPostStateCount: transition.exactPostStateCount,
      selectedVariant: transition.selectedVariant,
      newlyReachablePOIs: transition.newlyReachablePOIs,
      newlyDiscoveredPOIs: transition.newlyDiscoveredPOIs,
      noLongerReachablePOIs: transition.noLongerReachablePOIs,
      consumedOpportunities: transition.consumedOpportunities,
      irreversibleCost: transition.irreversibleCost,
      terminalBlockerDelta: transition.terminalBlockerDelta,
    } : null,
    lastActions: reconstructActionEntries(nodes, node)
      .slice(-6)
      .map((entry) => entry.summary),
  };
}

function enumerateStrategicActions(simulator, state, options) {
  const config = options || {};
  const raw = simulator.enumeratePrimitiveActions(state).actions || [];
  const additions = [];
  if (config.includeInteractPickup !== false && typeof simulator.enumerateInteractPickupActions === "function") {
    additions.push(...(simulator.enumerateInteractPickupActions(state) || []));
  }
  if (config.includeFloorFly === true && typeof simulator.enumerateFloorFlyActions === "function") {
    additions.push(...(simulator.enumerateFloorFlyActions(state) || []));
  }
  const byVariant = new Map();
  raw.concat(additions).forEach((action) => {
    if (!action) return;
    const key = recordedActionVariantIdentity(action);
    if (!byVariant.has(key)) byVariant.set(key, action);
  });
  const compareLegacyFilter = Boolean(config.compareLegacyFilter);
  const filtered = compareLegacyFilter
    ? simulator.sortActions(state, Array.from(byVariant.values()))
    : Array.from(byVariant.values());
  const filteredVariants = new Set(filtered.map(recordedActionVariantIdentity));
  return {
    actions: Array.from(byVariant.values()),
    rawVariantCount: byVariant.size,
    rawChoiceCount: new Set(Array.from(byVariant.values()).map((action) =>
      simulator.getActionFingerprint(action) || action.summary)).size,
    legacyVisibleVariantCount: filteredVariants.size,
    recoveredFromLegacyHeuristicFilter: Array.from(byVariant.keys())
      .filter((key) => !filteredVariants.has(key)).length,
  };
}

function compactTransition(transition, post, newlyDiscoveredPOIs) {
  return {
    schema: transition.schema,
    choice: transition.choice,
    choiceLabel: transition.choiceLabel,
    kind: transition.kind,
    targetPOI: transition.targetPOI,
    travelVariantCount: transition.travelVariantCount,
    exactPostStateCount: transition.exactPostStateCount,
    selectedVariant: post.appliedBy.summary,
    resourceDelta: post.resourceDelta,
    terminalBlockerDelta: post.terminalBlockerDelta,
    irreversibleCost: post.irreversibleCost,
    consumedOpportunities: post.consumedOpportunities,
    newlyReachablePOIs: post.newlyReachablePOIs,
    newlyDiscoveredPOIs,
    noLongerReachablePOIs: post.noLongerReachablePOIs,
    stillPresentButUnreachable: post.stillPresentButUnreachable,
  };
}

function compactPostTransition(post, choiceLabel, targetPOI) {
  return {
    schema: "motapathfinder.strategic-transition.v1",
    choice: choiceLabel,
    choiceLabel,
    kind: post.appliedBy ? post.appliedBy.kind : "unknown",
    targetPOI,
    travelVariantCount: 1,
    exactPostStateCount: 1,
    selectedVariant: post.appliedBy ? post.appliedBy.summary : null,
    resourceDelta: post.resourceDelta,
    terminalBlockerDelta: post.terminalBlockerDelta,
    irreversibleCost: post.irreversibleCost,
    consumedOpportunities: post.consumedOpportunities,
    newlyReachablePOIs: post.newlyReachablePOIs,
    noLongerReachablePOIs: post.noLongerReachablePOIs,
    stillPresentButUnreachable: post.stillPresentButUnreachable,
  };
}

function chainIrreversibleCost(chain) {
  const result = { battles: 0, doors: 0, events: 0, consumedItems: 0, consumedTools: 0, total: 0 };
  (chain || []).forEach((action) => {
    const kind = action && action.kind;
    if (kind === "battle") result.battles += 1;
    else if (kind === "openDoor") result.doors += 1;
    else if (kind === "event") result.events += 1;
    else if (kind === "pickup" || kind === "interactPickup") result.consumedItems += 1;
    else if (kind === "useTool") result.consumedTools += 1;
  });
  result.total = result.battles + result.doors + result.events + result.consumedItems + result.consumedTools;
  return result;
}

function hasTerminalBattleAction(actions, terminalGoal) {
  return (actions || []).some((action) =>
    action.kind === "battle" &&
    (action.floorId || (action.travelState && action.travelState.floorId)) === terminalGoal.floorId &&
    Number(action.x != null ? action.x : (action.target || {}).x) === Number(terminalGoal.x) &&
    Number(action.y != null ? action.y : (action.target || {}).y) === Number(terminalGoal.y));
}

function buildStrictReplayEvidence(project, simulatorFactory, projectRoot, initialState, goalNode, nodes, stats) {
  if (!goalNode) return null;
  const entries = reconstructActionEntries(nodes, goalNode);
  const finalState = cloneState(goalNode.state);
  finalState.route = entries;
  const routeRecord = buildRouteRecord({
    project,
    simulator: simulatorFactory(),
    initialState,
    finalState,
    options: {
      projectRoot,
      solver: "strategic-d2-search",
      profile: "terminal-only-strategic-frontier-v3",
      rank: ((initialState.meta || {}).rank) || "chaos",
      toFloor: goalNode.state.floorId,
      goalType: "bossDefeated",
      snapshotFloors: Object.keys(goalNode.state.visitedFloors || {}),
      expanded: stats.expansions,
      generated: stats.generated,
      metadata: {
        allowedInputs: ["tower", "route-free-current-state", "terminal-goal"],
        strategicDecisionCount: entries.length,
      },
    },
  });
  const replay = strictReplayRoute(project, simulatorFactory(), routeRecord);
  return {
    valid: Boolean(replay.valid),
    stepsAttempted: number(replay.stepsAttempted, 0),
    stepsCompleted: number(replay.stepsCompleted, 0),
    failureReason: replay.failureReason || null,
    routeRecord,
  };
}

function runStrategicD2Search(options) {
  const config = options || {};
  const { project, projectRoot, initialState, terminalGoal } = config;
  const simulatorFactory = config.simulatorFactory;
  if (!project || !initialState || !terminalGoal || typeof simulatorFactory !== "function") {
    throw new Error("Strategic D2 search requires project, projectRoot, initialState, terminalGoal, and simulatorFactory");
  }
  const simulator = simulatorFactory();
  const goalPredicate = buildSegmentGoalPredicate(project, { goal: terminalGoal }, simulator);
  const floorIds = Array.from(new Set([
    ...Object.keys(initialState.visitedFloors || {}),
    initialState.floorId,
    terminalGoal.floorId,
  ].filter(Boolean)));
  const stateIndex = createStrategicStateIndexCache(project, simulator, { floorIds });
  const rootState = cloneState(initialState);
  rootState.route = [];
  const rootKey = buildStateKey(rootState);
  const root = createRootNode(rootState, rootKey);
  const rootIndex = stateIndex.get(rootState);
  root.optionMap = rootIndex.optionMap;
  root.reachablePoi = rootIndex.reachablePoi;
  root.seenReachablePoiKeys = new Set(root.reachablePoi.entries.map((entry) => entry.key));
  root.order = 0;
  const agenda = makeAgenda(simulator, terminalGoal);
  agenda.push(root);
  const nodes = new Map([[root.nodeId, root]]);
  const seenExact = new Map([[rootKey, root.nodeId]]);
  const expanded = new Set();
  const maxExpansions = Math.max(1, number(config.maxExpansions, 1000));
  const startedAt = Date.now();
  const enableLazyWork = config.enableLazyWork !== false;
  const enableConnector = config.enableConnector !== false;
  const connectorMaxExpansions = Math.max(1, number(config.connectorMaxExpansions, 128));
  const connectorMaxDepth = Math.max(1, number(config.connectorMaxDepth, 8));
  const connectorMaxCalls = Math.max(0, number(config.connectorMaxCalls, 16));
  const lazyDrainEvery = Math.max(1, number(config.lazyDrainEvery, 8));
  const floorFlyMode = config.floorFlyMode === "lazy" ? "lazy" : "off";
  const connectorMode = config.connectorMode === "battle-access-prerequisite"
    ? "battle-access-prerequisite"
    : config.connectorMode === "dependency-derived"
      ? "dependency-derived"
      : config.connectorMode === "blocker-derived" ? "blocker-derived" : "terminal";
  const dependencyConnectorMaxCalls = Math.max(0, number(
    config.dependencyConnectorMaxCalls,
    connectorMaxCalls,
  ));
  const dependencyConnectorMaxCandidatesPerNode = Math.max(1, number(
    config.dependencyConnectorMaxCandidatesPerNode,
    4,
  ));
  const dependencyAttemptMaxOutstanding = Math.max(1, number(
    config.dependencyAttemptMaxOutstanding,
    1,
  ));
  const enableDependencyAccessAttribution = config.enableDependencyAccessAttribution !== false;
  const enableBattleViabilityAttribution = config.enableBattleViabilityAttribution !== false;
  const enableParentDependencyContinuation = config.enableParentDependencyContinuation === true;
  const enableHierarchicalCallAllocation = config.enableHierarchicalCallAllocation === true;
  const enableBattleStagePrerequisiteDecomposition = config.enableBattleStagePrerequisiteDecomposition === true;
  const enableContinuationAnchorExpansionScheduling =
    config.enableContinuationAnchorExpansionScheduling === true;
  const enableLethalSurvivalAttribution = config.enableLethalSurvivalAttribution === true;
  const enableSurvivalEdgeAttribution = config.enableSurvivalEdgeAttribution === true;
  const enableSurvivalOpportunityPrerequisite = config.enableSurvivalOpportunityPrerequisite === true;
  const enableSurvivalResidualAttribution = config.enableSurvivalResidualAttribution === true;
  const enableSurvivalResidualRecovery = config.enableSurvivalResidualRecovery === true;
  const enableSecondSurvivalResidualRecovery =
    config.enableSecondSurvivalResidualRecovery === true;
  const enableO4ContinuationAttribution = config.enableO4ContinuationAttribution === true;
  const enableHierarchyCallAttribution = config.enableHierarchyCallAttribution === true;
  const enableHierarchyCallChronology = config.enableHierarchyCallChronology === true;
  const enableRootAttemptSeparabilityAttribution =
    config.enableRootAttemptSeparabilityAttribution === true;
  const enableRootRetryNoveltyAttribution = config.enableRootRetryNoveltyAttribution === true;
  const enablePostResidualAttribution = config.enablePostResidualAttribution === true;
  const maxTotalSearchExpansions = config.maxTotalSearchExpansions == null
    ? null
    : Math.max(0, number(config.maxTotalSearchExpansions, 0));
  const lazyWork = new LazyWorkQueue();
  const stats = {
    expansions: 0,
    generated: 0,
    accepted: 0,
    exactMerged: 0,
    applyRejected: 0,
    rawVariants: 0,
    legacyVisibleVariants: 0,
    recoveredFromLegacyHeuristicFilter: 0,
    optionMapsObserved: 1,
    optionChangingTransitions: 0,
    implicitOptionConsumptions: 0,
    implicitOptionConsumptionSamples: [],
    expandedByQueue: {},
    generatedByKind: {},
    uniqueChoiceCount: 0,
    travelVariantAliasCount: 0,
    terminalActionGenerated: 0,
    maxStrategicDepth: 0,
    maxFrontierSize: 1,
    deferredPostStates: 0,
    canonicalSelectionReasons: {},
    transitionsWithNewlyReachable: 0,
    transitionsWithLostReachability: 0,
    transitionsConsumingOpportunities: 0,
    transitionsWithTerminalBlockerImprovement: 0,
    transitionsWithLineageNovelty: 0,
    connectorCalls: 0,
    connectorResolved: 0,
    connectorBudgetExhausted: 0,
    connectorFrontierExhausted: 0,
    connectorFrontierTrimmed: 0,
    connectorExpansions: 0,
    connectorChainActions: 0,
    lazyDeferredPostsMaterialized: 0,
    lazyFloorFlyChoicesMaterialized: 0,
    lazyFloorFlyVariantsEnumerated: 0,
    lazyFloorFlyExactPostsObserved: 0,
    lazyFloorFlyExactPostsDeferred: 0,
    lazyConnectorChoicesMaterialized: 0,
    blockerConnectorCalls: 0,
    blockerConnectorImproved: 0,
    blockerConnectorNoImprovement: 0,
    blockerConnectorExpansions: 0,
    blockerConnectorBudgetExhausted: 0,
    blockerConnectorFrontierExhausted: 0,
    blockerConnectorFrontierTrimmed: 0,
    blockerConnectorChainActions: 0,
    dependencyCompiledCandidates: 0,
    dependencyConnectorCalls: 0,
    dependencyConnectorSatisfied: 0,
    dependencyConnectorNoSatisfied: 0,
    dependencyConnectorExpansions: 0,
    dependencyConnectorBudgetExhausted: 0,
    dependencyConnectorFrontierExhausted: 0,
    dependencyConnectorFrontierTrimmed: 0,
    dependencyConnectorChainActions: 0,
    terminalPrerequisiteSatisfied: 0,
    dependencySatisfied: 0,
    dependencyStateCreated: 0,
    dependencyGlobalBlockerAdvanced: 0,
    newTerminalRelevantDependencyReached: 0,
    dependencyWitnesses: [],
    dependencyAttemptWitnesses: [],
    dependencyAccessAttributions: [],
    battleAccessPrerequisiteCompiled: 0,
    battleAccessPrerequisiteCalls: 0,
    battleAccessPrerequisiteSatisfied: 0,
    battleAccessPrerequisiteNoSatisfied: 0,
    battleAccessPrerequisiteExpansions: 0,
    battleAccessPrerequisiteStateCreated: 0,
    battleAccessPrerequisiteGlobalBlockerAdvanced: 0,
    battleAccessPrerequisiteWitnesses: [],
    parentDependencyContinuationsCreated: 0,
    parentDependencyContinuationsMerged: 0,
    parentDependencyContinuationMergeReactivationBlocked: 0,
    parentDependencyContinuationResumes: 0,
    parentDependencyContinuationLineageRejected: 0,
    parentDependencyContinuationCalls: 0,
    parentDependencyContinuationWaitingForParentFloor: 0,
    parentDependencyContinuationParentFloorReached: 0,
    parentDependencyContinuationParentReachable: 0,
    parentDependencyContinuationParentBlocked: 0,
    parentDependencyContinuationNextPrerequisiteCompiled: 0,
    parentDependencyContinuationWitnesses: [],
    hierarchyPriorityActivations: 0,
    rootLevelCalls: 0,
    continuationDerivedCalls: 0,
    rootAttemptsDeferredForHierarchy: 0,
    childPrerequisitesCompiled: 0,
    childPrerequisitesScheduled: 0,
    childPrerequisitesExecuted: 0,
    childPrerequisitesSatisfied: 0,
    maxHierarchyDepthAttempted: 0,
    battleStagePrerequisitesCompiled: 0,
    battleStagePrerequisitesScheduled: 0,
    battleStagePrerequisitesExecuted: 0,
    battleStagePrerequisitesSatisfied: 0,
    canonicalSuccessorEdgeCount: 0,
    canonicalExpansionSummaryCount: 0,
    canonicalFloorTransitionActionCount: 0,
    canonicalSuccessorEdgeAttributions: [],
    continuationAnchorExpansionRequests: 0,
    continuationAnchorExpansionSelections: 0,
    continuationAnchorExpansionAlreadyExpandedSkips: 0,
    continuationAnchorExpansionInactiveSkips: 0,
    anchorExpansionWitnesses: [],
    lethalSurvivalAttributions: [],
    lethalSurvivalEdgeAttributions: [],
    survivalOpportunityPrerequisitesCompiled: 0,
    survivalOpportunityPrerequisitesWitnessBacked: 0,
    survivalOpportunityPrerequisitesSatisfied: 0,
    survivalOpportunityPrerequisiteStateCreated: 0,
    survivalOpportunityWitnesses: [],
    survivalOpportunityResidualAttributions: [],
    survivalOpportunityResidualRecoverySelected: 0,
    survivalOpportunityResidualReplayValid: 0,
    survivalOpportunityResidualPrerequisiteSatisfied: 0,
    survivalOpportunityResidualPrerequisiteStateCreated: 0,
    survivalOpportunityResidualRecoveries: [],
    paidResidualRecoveriesUsed: 0,
    survivalOpportunitySecondResidualRecoverySelected: 0,
    survivalOpportunitySecondResidualReplayValid: 0,
    survivalOpportunitySecondResidualPrerequisiteSatisfied: 0,
    survivalOpportunitySecondResidualPrerequisiteStateCreated: 0,
    survivalOpportunitySecondResidualMaterialized: 0,
    o4ContinuationAttributions: [],
    hierarchyCallAllocationAttribution: null,
    hierarchyCallChronology: null,
    rootAttemptSeparabilityAttribution: null,
    rootRetryNoveltyAttribution: null,
    rootLevelCompiledCapBlockedSelectionEvents: 0,
    rootLevelCapBlockedCompiledCandidateInstances: 0,
    rootLevelCompiledOutstandingBlockedSelectionEvents: 0,
    rootLevelCompiledDedupRejectedSelectionEvents: 0,
    survivalOpportunityPostResidualAttributions: [],
  };
  const observedChoices = new Set();
  const dependencyAttemptDedupe = createDependencyAttemptDedupe();
  const parentContinuationRecords = new Map();
  const seenParentContinuationResumes = new Set();
  const parkedParentContinuations = new Map();
  const maxPaidResidualRecoveries = enableSecondSurvivalResidualRecovery ? 2 : 1;
  let paidResidualRecoveriesUsed = 0;
  const hierarchyChronology = enableHierarchyCallChronology ? {
    calls: [],
    checkpoints: {
      firstContinuationCreated: null,
      firstHierarchyActivation: null,
      firstLevelOneCallCharged: null,
    },
  } : null;
  const rootAttemptSeparabilityCalls = enableRootAttemptSeparabilityAttribution ||
    enableRootRetryNoveltyAttribution ? [] : null;
  const rootCompileEvents = enableRootAttemptSeparabilityAttribution ? [] : null;
  let hierarchyChronologyFirstContinuationRecorded = false;
  let hierarchyChronologyFirstActivationRecorded = false;
  let hierarchyChronologyFirstLevelOneRecorded = false;
  function recordHierarchyChronologyCheckpoint(event, expansion) {
    if (!hierarchyChronology) return;
    hierarchyChronology.checkpoints[event] = {
      expansion,
      callOrdinal: stats.battleAccessPrerequisiteCalls,
      callsSpent: stats.battleAccessPrerequisiteCalls,
      rootCallsSpent: stats.rootLevelCalls,
      childCallsSpent: stats.continuationDerivedCalls,
      callsRemaining: Math.max(0, dependencyConnectorMaxCalls - stats.battleAccessPrerequisiteCalls),
    };
  }
  const hierarchyPriority = new HierarchyPriorityController();
  const nodeCreatedAtExpansion = new Map([[0, 0]]);
  const nodeExpansionOrdinal = new Map();
  const nodeExpansionSummaries = new Map();
  const canonicalSuccessorEdges = [];
  const anchorExpansionRequests = new AnchorExpansionRequestQueue(hash);
  const bestByRole = new Map(agenda.definitions.map((definition) => [definition.id, root]));
  const bestTerminalBlocker = { progressScore: null, attackMargin: null, stage: null, nodeId: null };
  function observeTerminalBlocker(node, projection) {
    if (!projection) return;
    const score = projection.progressScore;
    if (score != null && (bestTerminalBlocker.progressScore == null || score > bestTerminalBlocker.progressScore)) {
      bestTerminalBlocker.progressScore = score;
      bestTerminalBlocker.attackMargin = projection.attackMargin;
      bestTerminalBlocker.stage = projection.stage;
      bestTerminalBlocker.nodeId = node.nodeId;
    }
  }
  const totalSearchWork = () =>
    stats.expansions + stats.connectorExpansions + stats.blockerConnectorExpansions +
    stats.dependencyConnectorExpansions + stats.battleAccessPrerequisiteExpansions;
  const remainingTotalSearchWork = () => maxTotalSearchExpansions == null
    ? Infinity
    : Math.max(0, maxTotalSearchExpansions - totalSearchWork());
  const hasRemainingTotalSearchBudget = () =>
    maxTotalSearchExpansions == null || totalSearchWork() < maxTotalSearchExpansions;
  const connectorExpansionBudget = () => {
    if (maxTotalSearchExpansions == null) return connectorMaxExpansions;
    return Math.max(0, Math.min(
      connectorMaxExpansions,
      Math.floor(remainingTotalSearchWork()),
    ));
  };
  observeTerminalBlocker(root, terminalBattleProjection(simulator, root.state, terminalGoal));
  let nextNodeId = 1;
  let goalNode = goalPredicate(root.state) ? root : null;
  let firstGoalExpansion = goalNode ? 0 : null;

  function enqueueParentContinuationForState(node) {
    if (!enableParentDependencyContinuation || !node || !node.state) return;
    const exactStateKey = buildStateKey(node.state);
    for (const [parkedKey, continuation] of parkedParentContinuations.entries()) {
      const parentDependency = continuation.parentDependency;
      const targetFloor = dependencyTargetFloorId(parentDependency && parentDependency.target);
      if (targetFloor == null || node.state.floorId !== targetFloor) continue;
      if (!isNodeDescendantOf(nodes, node, continuation.anchorNodeId)) {
        stats.parentDependencyContinuationLineageRejected += 1;
        continue;
      }
      const resumeKey = parentContinuationKey(parentDependency.id, exactStateKey);
      if (seenParentContinuationResumes.has(resumeKey)) continue;
      seenParentContinuationResumes.add(resumeKey);
      parkedParentContinuations.delete(parkedKey);
      stats.parentDependencyContinuationResumes += 1;
      lazyWork.enqueue({
        kind: "parent-dependency-continuation",
        sourceNodeId: node.nodeId,
        continuation,
      });
    }
  }

  function activateHierarchyPriority(continuation) {
    if (!enableHierarchicalCallAllocation || !continuation) return;
    if (hierarchyPriority.activate(continuation.id)) {
      stats.hierarchyPriorityActivations += 1;
      if (enableHierarchyCallChronology && !hierarchyChronologyFirstActivationRecorded) {
        hierarchyChronologyFirstActivationRecorded = true;
        recordHierarchyChronologyCheckpoint("firstHierarchyActivation", stats.expansions);
      }
    }
  }

  function releaseHierarchyPriorityForCall(work) {
    if (!enableHierarchicalCallAllocation || !work) return;
    hierarchyPriority.releaseForCall(work.originContinuationId || null);
  }

  function releaseHierarchyPriorityForContinuation(continuation) {
    if (!enableHierarchicalCallAllocation || !continuation) return;
    hierarchyPriority.releaseContinuation(continuation.id);
  }

  function lineageEligibleDescendants(anchorNode, targetFloor, options) {
    const config = options || {};
    const descendants = [];
    for (const node of nodes.values()) {
      if (!node || !node.state) continue;
      if (config.excludeAnchor && node.nodeId === anchorNode.nodeId) continue;
      if (targetFloor != null && node.state.floorId !== targetFloor) continue;
      if (!isNodeDescendantOf(nodes, node, anchorNode.nodeId)) continue;
      if (config.nodeIdUpperBoundExclusive != null &&
          node.nodeId >= config.nodeIdUpperBoundExclusive) continue;
      descendants.push(node);
    }
    descendants.sort((left, right) => left.nodeId - right.nodeId);
    return descendants;
  }

  function createParentDependencyContinuation(prerequisite, sourceNode, finalNode, postStateFinalCreated, hierarchyLevel) {
    if (!enableParentDependencyContinuation) {
      return { continuation: null, created: false, lifecycle: "disabled" };
    }
    const parentDependency = prerequisite && prerequisite.parentDependency;
    if (!parentDependency || !parentDependency.id || !parentDependency.target) {
      return { continuation: null, created: false, lifecycle: "missing-parent-dependency" };
    }
    const postExactStateKey = buildStateKey(finalNode.state);
    const key = parentContinuationKey(parentDependency.id, postExactStateKey);
    const targetFloor = dependencyTargetFloorId(parentDependency.target);
    const historicalDescendants = lineageEligibleDescendants(finalNode, null, {
      nodeIdUpperBoundExclusive: nextNodeId,
      excludeAnchor: true,
    });
    const historicalTargetFloorDescendants = historicalDescendants
      .filter((node) => node.state.floorId === targetFloor);
    const existing = parentContinuationRecords.get(key);
    if (existing) {
      stats.parentDependencyContinuationsMerged += 1;
      const parkedContinuationIds = new Set(
        Array.from(parkedParentContinuations.values()).map((continuation) => continuation.id),
      );
      const shouldReactivate = shouldReactivateMergedParentContinuation(
        existing,
        hierarchyPriority.activeContinuationIds(),
        parkedContinuationIds,
      );
      if (shouldReactivate) {
        activateHierarchyPriority(existing);
        return { continuation: existing, created: false, lifecycle: "merged-active-or-parked" };
      }
      stats.parentDependencyContinuationMergeReactivationBlocked += 1;
      return { continuation: existing, created: false, lifecycle: "merged-completed-no-reactivation" };
    }
    const continuation = {
      id: parentContinuationId(parentDependency.id, postExactStateKey),
      kind: "parent-dependency-continuation",
      parentDependency,
      satisfiedPrerequisiteId: prerequisite.id,
      sourceExactStateKey: buildStateKey(sourceNode.state),
      postExactStateKey,
      postStateFinalCreated: Boolean(postStateFinalCreated),
      anchorNodeId: finalNode.nodeId,
      hierarchyLevel: Math.max(0, number(hierarchyLevel, 0)) + 1,
      createdAtExpansion: stats.expansions,
      createdNextNodeId: nextNodeId,
      callsRemainingAtCreation: Math.max(
        0,
        dependencyConnectorMaxCalls - stats.battleAccessPrerequisiteCalls,
      ),
      eligibleHistoricalDescendantsAtCreation: historicalDescendants.length,
      eligibleHistoricalTargetFloorDescendants: historicalTargetFloorDescendants.length,
      retroactiveResumeCandidateNodeIds: historicalTargetFloorDescendants
        .map((node) => node.nodeId),
      futureDescendantsObservedAfterCreation: 0,
      priorityStillActiveAtSearchEnd: false,
      provenance: {
        topologicalModel: "hierarchical-prerequisite-intent-preservation",
        dynamicCausalProof: "not-proven",
        knownRouteUsed: false,
        authoredIdUsed: false,
      },
    };
    parentContinuationRecords.set(key, continuation);
    stats.parentDependencyContinuationsCreated += 1;
    if (enableHierarchyCallChronology && !hierarchyChronologyFirstContinuationRecorded) {
      hierarchyChronologyFirstContinuationRecorded = true;
      recordHierarchyChronologyCheckpoint("firstContinuationCreated", stats.expansions);
    }
    lazyWork.enqueue({
      kind: "parent-dependency-continuation",
      sourceNodeId: finalNode.nodeId,
      continuation,
    });
    activateHierarchyPriority(continuation);
    return { continuation, created: true, lifecycle: "created-active" };
  }

  function requestContinuationAnchorExpansion(continuation, anchorNodeId, targetFloor) {
    if (!enableContinuationAnchorExpansionScheduling || !continuation || anchorNodeId == null) return;
    const anchorNode = nodes.get(anchorNodeId);
    const result = anchorExpansionRequests.request({
      continuationId: continuation.id,
      anchorNodeId,
      requestedAtExpansion: stats.expansions,
      targetFloor,
      anchorExists: Boolean(anchorNode),
      anchorExpanded: Boolean(anchorNode) && expanded.has(anchorNodeId),
    });
    if (result.accepted) stats.continuationAnchorExpansionRequests += 1;
  }

  function selectPendingAnchorExpansion() {
    if (!enableContinuationAnchorExpansionScheduling) return null;
    const result = anchorExpansionRequests.select({
      evaluate(request) {
        const anchorNode = nodes.get(request.anchorNodeId);
        let continuation = null;
        for (const candidate of parentContinuationRecords.values()) {
          if (candidate.id === request.continuationId) {
            continuation = candidate;
            break;
          }
        }
        return {
          anchorExists: Boolean(anchorNode),
          anchorExpanded: Boolean(anchorNode) && expanded.has(request.anchorNodeId),
          continuationActive: Boolean(continuation) && hierarchyPriority
            .activeContinuationIds()
            .includes(request.continuationId),
          continuationParked: Boolean(continuation) && parkedParentContinuations.has(
            parentContinuationKey(
              continuation.parentDependency.id,
              continuation.postExactStateKey,
            ),
          ),
        };
      },
    });
    if (result.type === "skipped") {
      if (result.reason === "already-expanded-or-anchor-missing") {
        stats.continuationAnchorExpansionAlreadyExpandedSkips += 1;
      } else if (result.reason === "inactive-continuation") {
        stats.continuationAnchorExpansionInactiveSkips += 1;
      }
      return null;
    }
    if (result.type !== "selected") return null;
    const anchorNode = nodes.get(result.request.anchorNodeId);
    stats.continuationAnchorExpansionSelections += 1;
    if (stats.anchorExpansionWitnesses.length < 64) {
      stats.anchorExpansionWitnesses.push({
        continuationId: result.request.continuationId,
        anchorNodeId: result.request.anchorNodeId,
        requestedAtExpansion: result.request.requestedAtExpansion,
        selectedAtExpansion: stats.expansions,
        selectionDelay: stats.expansions - result.request.requestedAtExpansion,
        targetFloor: result.request.targetFloor,
      });
    }
    return {
      node: anchorNode,
      queueId: "parent-continuation-anchor",
      anchorExpansionRequestId: result.request.fingerprint,
    };
  }

  function processParentDependencyContinuation(work) {
    const sourceNode = nodes.get(work.sourceNodeId);
    const continuation = work.continuation;
    if (!sourceNode || !continuation || !continuation.parentDependency) {
      lazyWork.reject(work, "missing-parent-continuation-source");
      return true;
    }
    if (!isNodeDescendantOf(nodes, sourceNode, continuation.anchorNodeId)) {
      lazyWork.reject(work, "parent-continuation-source-not-descendant-of-anchor");
      return true;
    }
    stats.parentDependencyContinuationCalls += 1;
    const parentDependency = continuation.parentDependency;
    const targetFloor = dependencyTargetFloorId(parentDependency.target);
    const currentExactStateKey = buildStateKey(sourceNode.state);
    seenParentContinuationResumes.add(parentContinuationKey(parentDependency.id, currentExactStateKey));
    const witness = {
      continuationId: continuation.id,
      parentDependencyId: parentDependency.id,
      satisfiedPrerequisiteId: continuation.satisfiedPrerequisiteId,
      sourceExactStateFingerprint: hash(continuation.sourceExactStateKey),
      postExactStateFingerprint: hash(continuation.postExactStateKey),
      currentExactStateFingerprint: hash(currentExactStateKey),
      anchorNodeId: continuation.anchorNodeId,
      continuationCreatedAtExpansion: continuation.createdAtExpansion,
      callsRemainingAtContinuationCreation: continuation.callsRemainingAtCreation,
      eligibleHistoricalDescendantsAtCreation: continuation.eligibleHistoricalDescendantsAtCreation,
      eligibleHistoricalTargetFloorDescendants: continuation.eligibleHistoricalTargetFloorDescendants,
      retroactiveResumeCandidateNodeIds: continuation.retroactiveResumeCandidateNodeIds,
      futureDescendantsObservedAfterCreation: continuation.futureDescendantsObservedAfterCreation,
      priorityStillActiveAtSearchEnd: continuation.priorityStillActiveAtSearchEnd,
      currentFloorId: sourceNode.state.floorId,
      targetFloorId: targetFloor,
      status: null,
      statusReason: null,
      finalCreated: continuation.postStateFinalCreated,
      nextPrerequisiteId: null,
      prerequisiteKind: null,
      stageGoal: null,
      nextBoundary: null,
    };

    if (targetFloor == null || sourceNode.state.floorId !== targetFloor) {
      witness.status = "waiting-for-parent-floor";
      witness.statusReason = targetFloor == null
        ? "parent-target-floor-unknown"
        : "post-state-not-on-parent-target-floor";
      parkedParentContinuations.set(
        parentContinuationKey(parentDependency.id, continuation.postExactStateKey),
        continuation,
      );
      requestContinuationAnchorExpansion(
        continuation,
        continuation.anchorNodeId,
        targetFloor,
      );
      stats.parentDependencyContinuationWaitingForParentFloor += 1;
      if (stats.parentDependencyContinuationWitnesses.length < 64) {
        stats.parentDependencyContinuationWitnesses.push(witness);
      }
      lazyWork.resolve(work, "parent-dependency-continuation-waiting-for-parent-floor");
      return true;
    }

    let structuralAccess = null;
    try {
      structuralAccess = buildFullStructuralAccessAttribution({
        project,
        simulator,
        state: sourceNode.state,
        target: parentDependency.target,
      });
    } catch (_error) {
      structuralAccess = null;
    }

    if (structuralAccess && structuralAccess.firstObservedUnresolvedBoundary) {
      const first = structuralAccess.firstObservedUnresolvedBoundary;
      witness.nextBoundary = {
        floorId: first.floorId,
        x: first.x,
        y: first.y,
        kind: first.exactStateClassification.kind,
      };
      if (first.exactStateClassification.kind === "battle-unsurvivable") {
        const nextBoundary = {
          floorId: first.floorId,
          x: first.x,
          y: first.y,
          enemyId: first.tileId || (first.exactStateClassification.target || {}).enemyId || null,
        };
        let nextPrerequisite = null;
        let nextStageGoal = null;
        try {
          const stageAnalysis = analyzeBattleViabilityBlocker(
            simulator,
            sourceNode.state,
            nextBoundary,
          );
          if (enableBattleStagePrerequisiteDecomposition && stageAnalysis.stage === "attack-blocked") {
            nextPrerequisite = compileBattleStagePrerequisite({
              project,
              simulator,
              state: sourceNode.state,
              parentDependency,
              structuralAccess,
              sourceAttemptId: continuation.id,
              sourceExactStateFingerprint: hash(currentExactStateKey),
              stageGoal: "damageable",
            });
            nextStageGoal = nextPrerequisite ? nextPrerequisite.stageGoal : null;
          }
          if (!nextPrerequisite) {
            nextPrerequisite = compileBattleAccessPrerequisite({
              project,
              simulator,
              state: sourceNode.state,
              parentDependency,
              structuralAccess,
              sourceAttemptId: continuation.id,
              sourceExactStateFingerprint: hash(currentExactStateKey),
            });
            nextStageGoal = null;
          }
        } catch (_error) {
          nextPrerequisite = null;
          nextStageGoal = null;
        }
        if (nextPrerequisite) {
          stats.parentDependencyContinuationNextPrerequisiteCompiled += 1;
          if (nextPrerequisite.kind === "battle-stage-prerequisite") {
            stats.battleStagePrerequisitesCompiled += 1;
            nextStageGoal = nextPrerequisite.stageGoal;
          }
          if (continuation.hierarchyLevel > 0) {
            stats.childPrerequisitesCompiled += 1;
          }
          witness.nextPrerequisiteId = nextPrerequisite.id;
          witness.prerequisiteKind = nextPrerequisite.kind;
          witness.stageGoal = nextStageGoal;
          const queuedBattleAccess = lazyWork.queued()
            .filter((item) => item.kind === "battle-access-prerequisite-choice").length;
          const selected = selectFeedbackAwareDependencyAttempts({
            candidates: [nextPrerequisite],
            sourceState: sourceNode.state,
            dedupe: dependencyAttemptDedupe,
            maxCalls: dependencyConnectorMaxCalls,
            callsExecuted: stats.battleAccessPrerequisiteCalls,
            queuedCount: queuedBattleAccess,
            maxOutstanding: dependencyAttemptMaxOutstanding,
          });
          if (selected.length > 0) {
            const childHierarchyLevel = Math.max(1, number(continuation.hierarchyLevel, 1));
            lazyWork.enqueue({
              kind: "battle-access-prerequisite-choice",
              sourceNodeId: sourceNode.nodeId,
              prerequisite: nextPrerequisite,
              hierarchyLevel: childHierarchyLevel,
              originContinuationId: continuation.id,
            });
            stats.childPrerequisitesScheduled += 1;
            if (nextPrerequisite.kind === "battle-stage-prerequisite") {
              stats.battleStagePrerequisitesScheduled += 1;
            }
            witness.status = "next-prerequisite-compiled";
            witness.statusReason = nextPrerequisite.kind === "battle-stage-prerequisite"
              ? "first-unresolved-boundary-is-attack-blocked-and-decomposed-to-damageable"
              : "first-unresolved-boundary-is-battle-unsurvivable";
          } else {
            witness.status = "next-prerequisite-not-schedulable";
            if (stats.battleAccessPrerequisiteCalls >= dependencyConnectorMaxCalls) {
              witness.statusReason = "call-cap-exhausted";
            } else if (queuedBattleAccess >= dependencyAttemptMaxOutstanding) {
              witness.statusReason = "outstanding-barrier";
            } else if (dependencyAttemptDedupe.has(nextPrerequisite, sourceNode.state)) {
              witness.statusReason = "attempt-deduplicated";
            } else {
              witness.statusReason = "no-selection";
            }
            if (enableHierarchicalCallAllocation &&
                witness.statusReason === "outstanding-barrier") {
              lazyWork.enqueue({
                kind: "parent-dependency-continuation",
                sourceNodeId: sourceNode.nodeId,
                continuation,
              });
            } else {
              releaseHierarchyPriorityForContinuation(continuation);
            }
          }
        } else {
          witness.status = "parent-blocked-by-unsupported-boundary";
          witness.statusReason = "battle-boundary-no-longer-unresolved-or-compile-failed";
        }
      } else {
        stats.parentDependencyContinuationParentBlocked += 1;
        witness.status = "parent-blocked-by-unsupported-boundary";
        witness.statusReason = `unresolved-boundary-kind:${first.exactStateClassification.kind}`;
      }
    } else if (structuralAccess && structuralAccess.floorScoped &&
        structuralAccess.minStructuralBoundaryCrossings != null) {
      let parentCompletable = false;
      if (typeof parentDependency.completionPredicate === "function") {
        try {
          parentCompletable = parentDependency.completionPredicate(sourceNode.state);
        } catch (_error) {
          parentCompletable = false;
        }
      }
      stats.parentDependencyContinuationParentFloorReached += 1;
      stats.parentDependencyContinuationParentReachable += 1;
      witness.status = parentCompletable
        ? "parent-completable-at-current-state"
        : "parent-target-reachable";
      witness.statusReason = parentCompletable
        ? "parent-completion-predicate-satisfied"
        : "structural-path-clear-but-parent-completion-predicate-not-satisfied";
    } else {
      stats.parentDependencyContinuationParentBlocked += 1;
      witness.status = "parent-blocked-no-structural-path";
      witness.statusReason = structuralAccess && structuralAccess.evidence && structuralAccess.evidence.reason
        ? structuralAccess.evidence.reason
        : "structural-attribution-unavailable";
    }

    if (!["waiting-for-parent-floor", "next-prerequisite-compiled"].includes(witness.status) &&
        witness.statusReason !== "outstanding-barrier") {
      releaseHierarchyPriorityForContinuation(continuation);
    }
    if (stats.parentDependencyContinuationWitnesses.length < 64) {
      stats.parentDependencyContinuationWitnesses.push(witness);
    }
    lazyWork.resolve(work, `parent-dependency-continuation-${witness.status}`);
    return true;
  }

  function acceptLazyChild(parentNode, afterState, action, strategicTransition) {
    const exactKey = buildStateKey(afterState);
    if (seenExact.has(exactKey)) {
      const existing = nodes.get(seenExact.get(exactKey));
      enqueueParentContinuationForState(existing);
      return { node: existing, created: false, exactKey };
    }
    const child = createChildNode(
      parentNode,
      afterState,
      exactKey,
      {
        ...action,
        fingerprint: simulator.getActionFingerprint(action),
      },
      nextNodeId,
      nextNodeId,
    );
    nextNodeId += 1;
    const indexed = stateIndex.get(afterState);
    child.optionMap = indexed.optionMap;
    child.reachablePoi = indexed.reachablePoi;
    const newlyDiscoveredPOIs = indexed.reachablePoi.entries
      .filter((entry) => !parentNode.seenReachablePoiKeys.has(entry.key));
    child.seenReachablePoiKeys = new Set(parentNode.seenReachablePoiKeys);
    newlyDiscoveredPOIs.forEach((entry) => child.seenReachablePoiKeys.add(entry.key));
    if (strategicTransition) strategicTransition.newlyDiscoveredPOIs = newlyDiscoveredPOIs;
    child.strategicTransition = strategicTransition;
    if (strategicTransition && strategicTransition.terminalBlockerDelta) {
      observeTerminalBlocker(child, strategicTransition.terminalBlockerDelta.after);
    }
    nodes.set(child.nodeId, child);
    seenExact.set(exactKey, child.nodeId);
    nodeCreatedAtExpansion.set(child.nodeId, stats.expansions);
    agenda.push(child);
    stats.accepted += 1;
    stats.maxStrategicDepth = Math.max(stats.maxStrategicDepth, child.depth);
    if (newlyDiscoveredPOIs.length > 0) stats.transitionsWithLineageNovelty += 1;
    agenda.definitions.forEach((definition) => {
      const existing = bestByRole.get(definition.id);
      if (!existing || definition.compare(child, existing) > 0) {
        bestByRole.set(definition.id, child);
      }
    });
    enqueueParentContinuationForState(child);
    return { node: child, created: true, exactKey };
  }

  function buildMacroTransition(beforeNode, afterState, chain, terminalGoalArg) {
    const indexed = stateIndex.get(afterState);
    const beforeOptionMap = beforeNode.optionMap;
    const beforeReachable = beforeNode.reachablePoi;
    const optionDelta = diffStrategicOptionMaps(beforeOptionMap, indexed.optionMap);
    const reachableDelta = diffReachablePoiSets(beforeReachable, indexed.reachablePoi, {
      project: simulator.project,
      state: afterState,
    });
    const beforeProjection = terminalBattleProjection(simulator, beforeNode.state, terminalGoalArg);
    const afterProjection = terminalBattleProjection(simulator, afterState, terminalGoalArg);
    const beforeScore = beforeProjection && beforeProjection.progressScore != null
      ? beforeProjection.progressScore
      : null;
    const afterScore = afterProjection && afterProjection.progressScore != null
      ? afterProjection.progressScore
      : null;
    const lastAction = chain && chain.length > 0 ? chain[chain.length - 1] : null;
    const beforeReachableKeys = new Set((beforeReachable.entries || []).map((entry) => entry.key));
    return {
      schema: "motapathfinder.strategic-transition.v1",
      choice: lastAction ? lastAction.summary : `connector-chain(${chain.length})`,
      choiceLabel: lastAction ? lastAction.summary : `connector-chain(${chain.length})`,
      kind: lastAction ? lastAction.kind : "connector-chain",
      targetPOI: lastAction ? explicitActionTargetKey(lastAction) : null,
      travelVariantCount: 1,
      exactPostStateCount: 1,
      selectedVariant: lastAction ? lastAction.summary : null,
      resourceDelta: summarizeResourceDelta(beforeNode.state, afterState),
      terminalBlockerDelta: {
        before: beforeProjection,
        after: afterProjection,
        delta: beforeScore != null && afterScore != null ? afterScore - beforeScore : null,
        improved: beforeScore != null && afterScore != null && afterScore > beforeScore,
        supported: Boolean(beforeProjection && afterProjection && beforeProjection.supported && afterProjection.supported),
      },
      irreversibleCost: chainIrreversibleCost(chain),
      consumedOpportunities: optionDelta.consumed.map((entry) => ({
        key: entry.key,
        kind: entry.kind,
        tileId: entry.tileId,
        role: "implicit",
        wasReachableBefore: beforeReachableKeys.has(entry.key),
      })),
      newlyReachablePOIs: reachableDelta.newlyReachable,
      noLongerReachablePOIs: reachableDelta.noLongerReachable,
      stillPresentButUnreachable: reachableDelta.stillPresentButUnreachable,
    };
  }

  function materializeConnectorChain(sourceNode, connectorResult) {
    const replay = verifyConnectorChain(simulator, sourceNode.state, connectorResult);
    if (!replay.valid) {
      return { ok: false, reason: replay.failureReason || "strict-replay-failed" };
    }
    let current = sourceNode;
    const steps = replay.replaySteps || [];
    const macroTransition = buildMacroTransition(
      sourceNode,
      replay.finalState,
      connectorResult.chain,
      terminalGoal,
    );
    let finalCreated = false;
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index];
      const accepted = acceptLazyChild(
        current,
        step.state,
        step.action,
        index === steps.length - 1 ? macroTransition : null,
      );
      current = accepted.node;
      if (index === steps.length - 1) finalCreated = accepted.created;
    }
    return steps.length > 0
      ? { ok: true, finalNode: current, finalState: current.state, finalCreated }
      : { ok: false, reason: "empty-chain" };
  }

  function buildResidualCandidateWitness(candidateEdge, candidateEdges, discoveryOrdinal) {
    return {
      action: candidateEdge.action,
      actionTargetSignature: candidateEdge.actionTargetSignature,
      preExactStateKey: candidateEdge.preExactStateKey,
      postExactStateKey: candidateEdge.postExactStateKey,
      sourceExactStateKey: candidateEdge.sourceExactStateKey,
      witnessEdges: candidateEdges,
      witnessChain: candidateEdges.map((edge) => edge.action),
      witnessChainSummary: candidateEdges.map((edge) =>
        edge.action && (edge.action.summary || edge.action.kind || "step")),
      discoveryOrdinal,
      discoveryExpansion: candidateEdge.expansion,
      discoveryDepth: candidateEdge.depth,
      beforeStage: candidateEdge.beforeStage,
      afterStage: candidateEdge.afterStage,
      beforeSurvivalMargin: candidateEdge.beforeSurvivalMargin,
      afterSurvivalMargin: candidateEdge.afterSurvivalMargin,
      deltaHP: candidateEdge.deltaHP,
      deltaDamage: candidateEdge.deltaDamage,
      deltaSurvivalMargin: candidateEdge.deltaSurvivalMargin,
      resourceDelta: candidateEdge.resourceDelta,
    };
  }

  function buildSatisfiedResidualResult(prerequisite, sourceExactStateKey, selection) {
    const candidateEdge = selection.edge;
    return {
      status: "satisfied",
      stoppedReason: "satisfied",
      dependencyId: prerequisite.id,
      sourceExactStateKey,
      postExactStateKey: candidateEdge.postExactStateKey,
      edges: selection.suffix,
      chain: selection.suffix.map((edge) => edge.action),
      chainSummary: selection.suffix.map((edge) =>
        edge.action && (edge.action.summary || edge.action.kind || "step")),
      expansions: 0,
      generated: 0,
      applyErrors: 0,
      frontierSize: 0,
      frontierTrimmed: 0,
    };
  }

  /**
   * PR-5.19r observation-only attribution of the O4 continuation boundary.
   * Reuses the existing enumeration/aggregation path to classify legal
   * strategic successors from the O4 materialized exact state. Never creates
   * nodes, enqueues work, or mutates search state; failures are swallowed.
   */
  function attributeO4ContinuationBoundary(o4Node, continuationId, parentTargetFloorId) {
    const state = o4Node.state;
    const enumerated = enumerateStrategicActions(simulator, state, {
      includeFloorFly: false,
    });
    const aggregation = aggregateVariantsIntoTransitions({
      simulator,
      state,
      actions: enumerated.actions,
      terminalGoal,
      stateIndex,
      beforeOptionMap: o4Node.optionMap,
      beforeReachable: o4Node.reachablePoi,
    });
    const postFloorCounts = {};
    const transitionsToParentFloor = [];
    const directChangeFloorToParent = [];
    const transitionKindCounts = {};
    let transitionsTotal = 0;
    for (const transition of aggregation.transitions) {
      transitionsTotal += 1;
      const kind = transition.kind || "unknown";
      transitionKindCounts[kind] = number(transitionKindCounts[kind], 0) + 1;
      for (const post of transition.postStates) {
        const postFloor = (post.state || {}).floorId;
        if (postFloor != null) {
          postFloorCounts[postFloor] = number(postFloorCounts[postFloor], 0) + 1;
        }
        if (parentTargetFloorId != null && postFloor === parentTargetFloorId) {
          transitionsToParentFloor.push({
            choice: transition.choiceLabel,
            kind,
            travelVariantCount: transition.travelVariants.length,
          });
          if (kind === "changeFloor" && directChangeFloorToParent.length < 8) {
            directChangeFloorToParent.push(transition.choiceLabel);
          }
        }
      }
    }
    return {
      schema: "motapathfinder.strategic-o4-continuation-boundary-attribution.v1",
      continuationId,
      o4NodeId: o4Node.nodeId,
      o4FloorId: state.floorId,
      parentTargetFloorId: parentTargetFloorId == null ? null : parentTargetFloorId,
      o4ExactStateKey: buildStateKey(state),
      successorAttribution: {
        supported: true,
        rawActionVariantCount: enumerated.rawVariantCount,
        transitionsTotal,
        transitionKindCounts,
        postFloorCounts,
        transitionsToParentFloorCount: transitionsToParentFloor.length,
        transitionsToParentFloor: transitionsToParentFloor.slice(0, 8),
        directChangeFloorToParentCount: directChangeFloorToParent.length,
        directChangeFloorToParentChoices: directChangeFloorToParent.slice(0, 8),
      },
    };
  }

  function drainOneLazyItem() {
    const queuedParentContinuation = connectorMode === "battle-access-prerequisite"
      ? lazyWork.queued().find((item) =>
        item.kind === "parent-dependency-continuation" &&
        item.sourceNodeId != null &&
        nodes.has(item.sourceNodeId))
      : null;
    const queuedDependency = queuedParentContinuation || (connectorMode === "dependency-derived"
      ? lazyWork.queued().find((item) =>
        item.kind === "dependency-connector-choice" &&
        item.sourceNodeId != null &&
        nodes.has(item.sourceNodeId))
      : connectorMode === "battle-access-prerequisite"
        ? lazyWork.queued().find((item) =>
          item.kind === "battle-access-prerequisite-choice" &&
          item.sourceNodeId != null &&
          nodes.has(item.sourceNodeId))
        : null);
    const work = queuedDependency || lazyWork.dequeue((item) =>
      item.sourceNodeId != null && !nodes.has(item.sourceNodeId));
    if (!work) return false;

    if (work.kind === "parent-dependency-continuation") {
      return processParentDependencyContinuation(work);
    }

    if (work.kind === "deferred-exact-post") {
      const parentNode = nodes.get(work.sourceNodeId);
      const post = work.post;
      if (!parentNode || !post) {
        lazyWork.reject(work, "missing-source-or-post");
        return true;
      }
      if (seenExact.has(post.stateKey)) {
        lazyWork.reject(work, "exact-state-already-seen");
        return true;
      }
      const strategicTransition = compactPostTransition(post, work.choiceLabel, work.targetPOI);
      const accepted = acceptLazyChild(parentNode, post.state, post.appliedBy, strategicTransition);
      if (!accepted.created) {
        lazyWork.reject(work, "exact-state-merged");
        return true;
      }
      if (goalPredicate(post.state)) {
        goalNode = accepted.node;
        firstGoalExpansion = stats.expansions;
      }
      stats.lazyDeferredPostsMaterialized += 1;
      lazyWork.resolve(work, "materialized-deferred-post");
      return true;
    }

    if (work.kind === "floorfly-choice") {
      const sourceNode = nodes.get(work.sourceNodeId);
      if (!sourceNode) {
        lazyWork.reject(work, "missing-source");
        return true;
      }
      let actions = [];
      try {
        actions = (simulator.enumerateFloorFlyActions(sourceNode.state) || [])
          .filter((action) => action.targetFloorId === work.targetFloorId);
      } catch (_error) {
        actions = [];
      }
      if (actions.length === 0) {
        lazyWork.reject(work, "no-floorfly-variants");
        return true;
      }
      stats.lazyFloorFlyVariantsEnumerated += actions.length;
      const aggregation = aggregateVariantsIntoTransitions({
        simulator,
        state: sourceNode.state,
        actions,
        terminalGoal,
        stateIndex,
        beforeOptionMap: sourceNode.optionMap,
        beforeReachable: sourceNode.reachablePoi,
        choiceKeyBuilder: () => `floorFly|targetFloor:${work.targetFloorId}`,
        choiceLabelBuilder: () => `floorFly:${work.targetFloorId}`,
        targetPOIBuilder: () => `floor:${work.targetFloorId}`,
      });
      stats.lazyFloorFlyExactPostsObserved += aggregation.transitions.reduce(
        (sum, transition) => sum + transition.postStates.length,
        0,
      );
      let materialized = 0;
      for (const transition of aggregation.transitions) {
        const selection = selectCanonicalPostState(transition, { goalPredicate });
        if (!selection) continue;
        for (const post of transition.postStates) {
          if (post.stateKey === selection.postState.stateKey || seenExact.has(post.stateKey)) continue;
          lazyWork.enqueue({
            kind: "deferred-exact-post",
            sourceNodeId: sourceNode.nodeId,
            choiceLabel: transition.choiceLabel,
            targetPOI: transition.targetPOI,
            post,
          });
          stats.deferredPostStates += 1;
          stats.lazyFloorFlyExactPostsDeferred += 1;
        }
        const post = selection.postState;
        const strategicTransition = compactTransition(transition, post, []);
        const accepted = acceptLazyChild(sourceNode, post.state, post.appliedBy, strategicTransition);
        materialized += 1;
        if (goalPredicate(post.state)) {
          goalNode = accepted.node;
          firstGoalExpansion = stats.expansions;
          break;
        }
      }
      if (materialized === 0) {
        lazyWork.reject(work, "no-applicable-floorfly-posts");
        return true;
      }
      stats.lazyFloorFlyChoicesMaterialized += 1;
      lazyWork.resolve(work, "resolved-floorfly-choice");
      return true;
    }

    if (work.kind === "connector-choice") {
      const sourceNode = nodes.get(work.sourceNodeId);
      if (!sourceNode) {
        lazyWork.reject(work, "missing-source");
        return true;
      }
      if (stats.connectorCalls >= connectorMaxCalls) {
        lazyWork.reject(work, "connector-call-cap");
        return true;
      }
      const budget = connectorExpansionBudget();
      if (budget <= 0) {
        lazyWork.reject(work, "connector-total-search-budget-exhausted");
        return true;
      }
      stats.connectorCalls += 1;
      const result = runLocalConnector({
        simulator,
        sourceState: sourceNode.state,
        target: work.target,
        maxExpansions: budget,
        maxDepth: connectorMaxDepth,
      });
      stats.connectorExpansions += result.expansions;
      if (result.status !== "resolved") {
        if (result.status === "budget-exhausted") stats.connectorBudgetExhausted += 1;
        else if (result.status === "frontier-exhausted") stats.connectorFrontierExhausted += 1;
        else if (result.status === "frontier-trimmed") stats.connectorFrontierTrimmed += 1;
        lazyWork.reject(work, `connector-${result.status}`);
        return true;
      }
      const materialized = materializeConnectorChain(sourceNode, result);
      if (!materialized.ok) {
        lazyWork.reject(work, `connector-chain-apply-error:${materialized.reason}`);
        return true;
      }
      stats.connectorResolved += 1;
      stats.connectorChainActions += result.chain.length;
      if (goalPredicate(materialized.finalState)) {
        goalNode = materialized.finalNode;
        firstGoalExpansion = stats.expansions;
      }
      stats.lazyConnectorChoicesMaterialized += 1;
      lazyWork.resolve(work, materialized.finalCreated ? "connector-chain-materialized" : "connector-chain-merged");
      return true;
    }

    if (work.kind === "blocker-connector-choice") {
      const sourceNode = nodes.get(work.sourceNodeId);
      if (!sourceNode) {
        lazyWork.reject(work, "missing-source");
        return true;
      }
      if (stats.blockerConnectorCalls >= connectorMaxCalls) {
        lazyWork.reject(work, "blocker-connector-call-cap");
        return true;
      }
      const budget = connectorExpansionBudget();
      if (budget <= 0) {
        lazyWork.reject(work, "blocker-connector-total-search-budget-exhausted");
        return true;
      }
      stats.blockerConnectorCalls += 1;
      const result = runBlockerDerivedConnector({
        simulator,
        sourceState: sourceNode.state,
        terminalGoal,
        maxExpansions: budget,
        maxDepth: connectorMaxDepth,
      });
      stats.blockerConnectorExpansions += result.expansions;
      if (result.stoppedReason === "budget-exhausted") stats.blockerConnectorBudgetExhausted += 1;
      else if (result.stoppedReason === "frontier-exhausted") stats.blockerConnectorFrontierExhausted += 1;
      else if (result.stoppedReason === "frontier-trimmed") stats.blockerConnectorFrontierTrimmed += 1;
      if (result.status === "improved") stats.blockerConnectorImproved += 1;
      else stats.blockerConnectorNoImprovement += 1;
      if (result.chain.length === 0) {
        lazyWork.reject(work, `blocker-connector-${result.status}`);
        return true;
      }
      const materialized = materializeConnectorChain(sourceNode, result);
      if (!materialized.ok) {
        lazyWork.reject(work, `blocker-connector-chain-apply-error:${materialized.reason}`);
        return true;
      }
      stats.blockerConnectorChainActions += result.chain.length;
      if (goalPredicate(materialized.finalState)) {
        goalNode = materialized.finalNode;
        firstGoalExpansion = stats.expansions;
      }
      lazyWork.resolve(work, materialized.finalCreated
        ? "blocker-connector-chain-materialized"
        : "blocker-connector-chain-merged");
      return true;
    }

    if (work.kind === "dependency-connector-choice") {
      const sourceNode = nodes.get(work.sourceNodeId);
      const dependency = work.dependency;
      if (!sourceNode || !dependency || typeof dependency.completionPredicate !== "function") {
        lazyWork.reject(work, "missing-source-or-dependency");
        return true;
      }
      if (stats.dependencyConnectorCalls >= dependencyConnectorMaxCalls) {
        lazyWork.reject(work, "dependency-connector-call-cap");
        return true;
      }
      const budget = connectorExpansionBudget();
      if (budget <= 0) {
        lazyWork.reject(work, "dependency-connector-total-search-budget-exhausted");
        return true;
      }
      stats.dependencyConnectorCalls += 1;
      const accessObserver = connectorMode === "dependency-derived" && enableDependencyAccessAttribution
        ? createDependencyAccessObserver({
            project,
            target: dependency.target,
            maxApproaches: 3,
          })
        : null;
      const result = runDependencyConnector({
        simulator,
        sourceState: sourceNode.state,
        dependency,
        maxExpansions: budget,
        maxDepth: connectorMaxDepth,
        observer: accessObserver && accessObserver.observe,
      });
      const attemptId = dependencyAttemptId(dependency, sourceNode.state);
      if (stats.dependencyAttemptWitnesses.length < dependencyConnectorMaxCalls) {
        stats.dependencyAttemptWitnesses.push({
          semanticDependencyId: dependency.id,
          attemptId,
          sourceNodeId: sourceNode.nodeId,
          sourceExactStateFingerprint: dependency.provenance &&
            dependency.provenance.sourceExactStateFingerprint,
          kind: dependency.kind,
          capability: dependency.capability,
          target: dependency.target,
          status: result.status,
          stoppedReason: result.stoppedReason,
          expansions: result.expansions,
        });
      }
      if (accessObserver) {
        try {
          const attribution = buildDependencyAccessAttribution({
            project,
            simulator,
            dependency,
            connectorResult: result,
            observer: accessObserver,
            attemptId,
            sourceNodeId: sourceNode.nodeId,
            sourceExactStateFingerprint: dependency.provenance &&
              dependency.provenance.sourceExactStateFingerprint,
          });
          if (stats.dependencyAccessAttributions.length < dependencyConnectorMaxCalls) {
            stats.dependencyAccessAttributions.push(attribution);
          }
        } catch (_error) {
          // attribution is observation-only and must not affect search
        }
      }
      stats.dependencyConnectorExpansions += result.expansions;
      if (result.stoppedReason === "budget-exhausted") stats.dependencyConnectorBudgetExhausted += 1;
      else if (result.stoppedReason === "frontier-exhausted") stats.dependencyConnectorFrontierExhausted += 1;
      else if (result.stoppedReason === "frontier-trimmed") stats.dependencyConnectorFrontierTrimmed += 1;
      if (result.status !== "satisfied") {
        stats.dependencyConnectorNoSatisfied += 1;
        lazyWork.reject(work, `dependency-connector-${result.stoppedReason}`);
        return true;
      }
      if (result.chain.length === 0) {
        lazyWork.reject(work, "dependency-connector-empty-chain");
        return true;
      }
      const bestBeforeMaterialize = bestTerminalBlocker.progressScore;
      const materialized = materializeConnectorChain(sourceNode, result);
      if (!materialized.ok) {
        lazyWork.reject(work, `dependency-connector-chain-apply-error:${materialized.reason}`);
        return true;
      }
      let completionStillTrue = false;
      try {
        completionStillTrue = dependency.completionPredicate(materialized.finalState);
      } catch (_error) {
        completionStillTrue = false;
      }
      if (!completionStillTrue) {
        lazyWork.reject(work, "dependency-completion-not-preserved-after-replay");
        return true;
      }
      stats.dependencyConnectorSatisfied += 1;
      stats.terminalPrerequisiteSatisfied += 1;
      stats.dependencySatisfied += 1;
      stats.dependencyConnectorChainActions += result.chain.length;
      if (materialized.finalCreated) stats.dependencyStateCreated += 1;
      const finalProjection = terminalBattleProjection(simulator, materialized.finalState, terminalGoal);
      const reachedNewBest = materialized.finalCreated &&
        bestBeforeMaterialize != null &&
        finalProjection && finalProjection.progressScore != null &&
        finalProjection.progressScore > bestBeforeMaterialize;
      if (reachedNewBest) {
        stats.dependencyGlobalBlockerAdvanced += 1;
        stats.newTerminalRelevantDependencyReached += 1;
      }
      if (stats.dependencyWitnesses.length < 8) {
        stats.dependencyWitnesses.push({
          dependencyId: dependency.id,
          kind: dependency.kind,
          capability: dependency.capability,
          target: dependency.target,
          sourceNodeId: sourceNode.nodeId,
          chainActions: result.chain.length,
          beforeProgressScore: dependency.beforeBlocker && dependency.beforeBlocker.progressScore,
          afterProgressScore: finalProjection && finalProjection.progressScore,
          expectedProgressScore: dependency.afterBlocker && dependency.afterBlocker.progressScore,
          finalCreated: materialized.finalCreated,
          reachedNewBest,
          sourceStateFingerprint: dependency.provenance &&
            dependency.provenance.sourceExactStateFingerprint,
          acquisitionMechanism: dependency.target && dependency.target.acquisition
            ? dependency.target.acquisition.mechanism
            : null,
        });
      }
      if (goalPredicate(materialized.finalState)) {
        goalNode = materialized.finalNode;
        firstGoalExpansion = stats.expansions;
      }
      lazyWork.resolve(work, materialized.finalCreated
        ? "dependency-prerequisite-materialized"
        : "dependency-prerequisite-merged");
      return true;
    }

    if (work.kind === "battle-access-prerequisite-choice") {
      const sourceNode = nodes.get(work.sourceNodeId);
      const prerequisite = work.prerequisite;
      if (!sourceNode || !prerequisite || typeof prerequisite.completionPredicate !== "function") {
        lazyWork.reject(work, "missing-source-or-prerequisite");
        return true;
      }
      if (stats.battleAccessPrerequisiteCalls >= dependencyConnectorMaxCalls) {
        lazyWork.reject(work, "battle-access-prerequisite-call-cap");
        return true;
      }
      const budget = connectorExpansionBudget();
      if (budget <= 0) {
        lazyWork.reject(work, "battle-access-prerequisite-total-search-budget-exhausted");
        return true;
      }
      stats.battleAccessPrerequisiteCalls += 1;
      const attemptId = dependencyAttemptId(prerequisite, sourceNode.state);
      if (enableHierarchyCallChronology) {
        const callHierarchyLevel = number(work.hierarchyLevel, 0);
        hierarchyChronology.calls.push({
          callOrdinal: stats.battleAccessPrerequisiteCalls,
          hierarchyLevel: callHierarchyLevel,
          attemptId,
          expansionAtCharge: stats.expansions,
          callsRemainingAfter: Math.max(
            0,
            dependencyConnectorMaxCalls - stats.battleAccessPrerequisiteCalls,
          ),
          firstHierarchyActivationOccurred: stats.hierarchyPriorityActivations > 0,
          activeContinuationCount: enableHierarchicalCallAllocation
            ? hierarchyPriority.activeContinuationIds().length
            : null,
        });
        if (!hierarchyChronologyFirstLevelOneRecorded && callHierarchyLevel >= 1) {
          hierarchyChronologyFirstLevelOneRecorded = true;
          recordHierarchyChronologyCheckpoint("firstLevelOneCallCharged", stats.expansions);
        }
      }
      const beforeViability = evaluateBattleViability(simulator, sourceNode.state, prerequisite.boundary);
      const beforeBattle = enableBattleViabilityAttribution
        ? analyzeBattleViabilityBlocker(simulator, sourceNode.state, prerequisite.boundary)
        : null;
      if ((enableRootAttemptSeparabilityAttribution || enableRootRetryNoveltyAttribution) &&
          number(work.hierarchyLevel, 0) === 0) {
        const boundary = prerequisite.boundary || {};
        const projection = terminalBattleProjection(simulator, sourceNode.state, terminalGoal);
        const selectionContext = work.selectionContext || {};
        const semantic = buildRootAttemptSemanticVector({
          prerequisite,
          sourceNode,
          beforeBattle,
          projection,
          compiledCandidateRank: selectionContext.compiledCandidateRank,
          compiledCandidateCount: selectionContext.compiledCandidateCount,
        });
        rootAttemptSeparabilityCalls.push({
          callOrdinal: stats.battleAccessPrerequisiteCalls,
          attemptId,
          prerequisiteId: prerequisite.id,
          parentDependencyId: (prerequisite.parentDependency || {}).id || null,
          sourceNodeId: sourceNode.nodeId,
          identity: {
            floorId: boundary.floorId || null,
            enemyId: boundary.enemyId || null,
            x: boundary.x != null ? boundary.x : null,
            y: boundary.y != null ? boundary.y : null,
          },
          semantic,
          compileEventOrdinal: selectionContext.compileEventOrdinal == null
            ? null
            : number(selectionContext.compileEventOrdinal, 0),
          candidateLocalRank: selectionContext.candidateLocalRank == null
            ? null
            : number(selectionContext.candidateLocalRank, 0),
          temporal: {
            expansionAtCharge: stats.expansions,
            firstHierarchyActivationOccurred: stats.hierarchyPriorityActivations > 0,
            activeContinuationCount: enableHierarchicalCallAllocation
              ? hierarchyPriority.activeContinuationIds().length
              : null,
            callsRemainingAfter: Math.max(
              0,
              dependencyConnectorMaxCalls - stats.battleAccessPrerequisiteCalls,
            ),
          },
        });
      }
      const attemptBase = {
        attemptId,
        prerequisiteId: prerequisite.id,
        prerequisiteKind: prerequisite.kind,
        stageGoal: prerequisite.stageGoal || null,
        parentDependencyId: prerequisite.parentDependency.id,
        boundary: prerequisite.boundary,
        sourceNodeId: sourceNode.nodeId,
        sourceExactStateFingerprint: prerequisite.provenance &&
          prerequisite.provenance.sourceExactStateFingerprint,
        hierarchyLevel: number(work.hierarchyLevel, 0),
        originContinuationId: work.originContinuationId || null,
        beforeViability,
        beforeStage: beforeBattle ? beforeBattle.stage : null,
        battleBefore: beforeBattle ? {
          stage: beforeBattle.stage,
          supported: beforeBattle.supported,
          heroHp: beforeBattle.heroHp,
          heroAtk: beforeBattle.heroAtk,
          enemyDef: beforeBattle.enemyDef,
          attackMargin: beforeBattle.attackMargin,
          damage: beforeBattle.damage,
          survivalMargin: beforeBattle.survivalMargin,
          reason: beforeBattle.reason,
        } : null,
      };
      const isLethalHierarchyChild = prerequisite.kind === "battle-access-prerequisite" &&
        number(work.hierarchyLevel, 0) > 0 &&
        beforeBattle && beforeBattle.stage === "lethal";
      const lethalSurvivalObserver = enableLethalSurvivalAttribution && isLethalHierarchyChild
        ? createLethalSurvivalObserver({
            simulator,
            sourceState: sourceNode.state,
            boundary: prerequisite.boundary,
            maxSamples: 50,
          })
        : null;
      const enableEffectiveSurvivalEdgeObservation =
        enableSurvivalEdgeAttribution ||
        enableSurvivalOpportunityPrerequisite ||
        enableSurvivalResidualAttribution ||
        enableSurvivalResidualRecovery;
      const lethalSurvivalEdgeObserver = enableEffectiveSurvivalEdgeObservation && isLethalHierarchyChild
        ? createSurvivalEdgeObserver({
            simulator,
            sourceState: sourceNode.state,
            boundary: prerequisite.boundary,
            maxEdges: 400,
          })
        : null;
      const result = runDependencyConnector({
        simulator,
        sourceState: sourceNode.state,
        dependency: prerequisite,
        maxExpansions: budget,
        maxDepth: connectorMaxDepth,
        observer: (entry) => {
          if (lethalSurvivalObserver) lethalSurvivalObserver.observe(entry);
          if (lethalSurvivalEdgeObserver) lethalSurvivalEdgeObserver.observeState(entry);
        },
        edgeObserver: lethalSurvivalEdgeObserver && lethalSurvivalEdgeObserver.observeEdge,
      });
      if (lethalSurvivalObserver) {
        if (stats.lethalSurvivalAttributions.length < 16) {
          stats.lethalSurvivalAttributions.push({
            attemptId,
            prerequisiteId: prerequisite.id,
            hierarchyLevel: number(work.hierarchyLevel, 0),
            boundary: prerequisite.boundary,
            connectorResult: {
              status: result.status,
              stoppedReason: result.stoppedReason,
              expansions: result.expansions,
              generated: result.generated,
              applyErrors: result.applyErrors,
              frontierSize: result.frontierSize,
              frontierTrimmed: result.frontierTrimmed,
            },
            ...lethalSurvivalObserver.report(),
          });
        }
      }
      if (lethalSurvivalEdgeObserver && enableSurvivalEdgeAttribution) {
        if (stats.lethalSurvivalEdgeAttributions.length < 16) {
          stats.lethalSurvivalEdgeAttributions.push({
            attemptId,
            prerequisiteId: prerequisite.id,
            hierarchyLevel: number(work.hierarchyLevel, 0),
            boundary: prerequisite.boundary,
            connectorResult: {
              status: result.status,
              stoppedReason: result.stoppedReason,
              expansions: result.expansions,
              generated: result.generated,
              applyErrors: result.applyErrors,
              frontierSize: result.frontierSize,
              frontierTrimmed: result.frontierTrimmed,
            },
            ...lethalSurvivalEdgeObserver.report(),
          });
        }
      }
      if (enableSurvivalOpportunityPrerequisite && isLethalHierarchyChild &&
          result.status === "not-satisfied" && lethalSurvivalEdgeObserver) {
        const witness = lethalSurvivalEdgeObserver.firstPositiveOpportunityWitness();
        if (witness) {
          const opportunityPrerequisite = compileSurvivalOpportunityPrerequisite({
            project,
            parentDependency: prerequisite.parentDependency,
            boundary: prerequisite.boundary,
            witness,
            originFailedAttemptId: attemptId,
            originContinuationId: work.originContinuationId || null,
          });
          if (opportunityPrerequisite) {
            stats.survivalOpportunityPrerequisitesCompiled += 1;
            stats.survivalOpportunityPrerequisitesWitnessBacked += 1;
            const witnessEdges = witness.witnessEdges && witness.witnessEdges.length > 0
              ? witness.witnessEdges
              : [{
                  action: witness.action,
                  fingerprint: typeof simulator.getActionFingerprint === "function"
                    ? simulator.getActionFingerprint(witness.action)
                    : null,
                  preExactStateKey: witness.preExactStateKey,
                  postExactStateKey: witness.postExactStateKey,
                }];
            const replay = verifyConnectorChain(
              simulator,
              sourceNode.state,
              witnessEdges,
              { expectedPostExactStateKey: witness.postExactStateKey },
            );
            const completionAfterReplay = replay.valid &&
              opportunityPrerequisite.completionPredicate(replay.finalState);
            let replayValid = replay.valid;
            let materialized = null;
            let parentContinuationId = null;
            let parentContinuationCreated = false;
            if (replayValid && completionAfterReplay) {
              const opportunityResult = {
                status: "satisfied",
                stoppedReason: "satisfied",
                dependencyId: opportunityPrerequisite.id,
                sourceExactStateKey: buildStateKey(sourceNode.state),
                postExactStateKey: witness.postExactStateKey,
                edges: witnessEdges,
                chain: witness.witnessChain,
                chainSummary: witness.witnessChainSummary,
                expansions: 0,
                generated: 0,
                applyErrors: 0,
                frontierSize: 0,
                frontierTrimmed: 0,
              };
              materialized = materializeConnectorChain(sourceNode, opportunityResult);
            }
            if (materialized && materialized.ok) {
              let continuationPrerequisite = opportunityPrerequisite;
              let continuationSourceNode = sourceNode;
              let continuationFinalNode = materialized.finalNode;
              let continuationFinalCreated = materialized.finalCreated;
              let secondResidualMaterialized = false;
              const canAttemptResidualRecovery = enableSurvivalResidualRecovery &&
                paidResidualRecoveriesUsed < maxPaidResidualRecoveries &&
                stats.survivalOpportunityPrerequisitesSatisfied > 0;
              if (canAttemptResidualRecovery) {
                const snapshot = lethalSurvivalEdgeObserver.snapshot();
                const residualSelection = firstPrefixCompatibleReplayValidResidual({
                  simulator,
                  selectedWitness: witness,
                  selectedPostState: replay.finalState,
                  snapshot,
                });
                const residualRecord = {
                  sourceType: "paid-residual-witness-suffix",
                  originFailedAttemptId: attemptId,
                  originSelectedOpportunityId: opportunityPrerequisite.id,
                  originSnapshotCaptureComplete: snapshot.captureComplete,
                  selectedResidualOpportunityId: null,
                  selectedResidualTarget: null,
                  selectionPolicy: "first-prefix-compatible-replay-valid-residual-by-bfs-discovery",
                  residualRecoverySelected: Boolean(residualSelection),
                  residualReplayValid: false,
                  residualPrerequisiteSatisfied: false,
                  residualSearchExpansions: 0,
                  connectorCallsCharged: 0,
                  suffixLength: 0,
                  candidateDiscoveryOrdinal: residualSelection
                    ? residualSelection.discoveryOrdinal
                    : null,
                  candidateDiscoveryExpansion: residualSelection
                    ? residualSelection.edge.expansion
                    : null,
                  candidateDiscoveryDepth: residualSelection
                    ? residualSelection.edge.depth
                    : null,
                  materialized: false,
                  finalCreated: false,
                  parentContinuationId: null,
                  parentContinuationCreated: false,
                  status: residualSelection ? "selected" : "not-selected",
                  statusReason: residualSelection
                    ? "first-prefix-compatible-replay-valid-residual-by-bfs-discovery"
                    : snapshot.captureComplete
                      ? "no-prefix-compatible-replay-valid-residual"
                      : "capture-incomplete",
                  recoveryIndex: paidResidualRecoveriesUsed + 1,
                };
                if (residualSelection) {
                  const candidateEdge = residualSelection.edge;
                  const candidateAction = candidateEdge.action;
                  const candidateEdges = residualSelection.candidateEdges;
                  const candidateWitness = {
                    action: candidateAction,
                    actionTargetSignature: candidateEdge.actionTargetSignature,
                    preExactStateKey: candidateEdge.preExactStateKey,
                    postExactStateKey: candidateEdge.postExactStateKey,
                    sourceExactStateKey: candidateEdge.sourceExactStateKey,
                    witnessEdges: candidateEdges,
                    witnessChain: candidateEdges.map((edge) => edge.action),
                    witnessChainSummary: candidateEdges.map((edge) =>
                      edge.action && (edge.action.summary || edge.action.kind || "step")),
                    discoveryOrdinal: residualSelection.discoveryOrdinal,
                    discoveryExpansion: candidateEdge.expansion,
                    discoveryDepth: candidateEdge.depth,
                    beforeStage: candidateEdge.beforeStage,
                    afterStage: candidateEdge.afterStage,
                    beforeSurvivalMargin: candidateEdge.beforeSurvivalMargin,
                    afterSurvivalMargin: candidateEdge.afterSurvivalMargin,
                    deltaHP: candidateEdge.deltaHP,
                    deltaDamage: candidateEdge.deltaDamage,
                    deltaSurvivalMargin: candidateEdge.deltaSurvivalMargin,
                    resourceDelta: candidateEdge.resourceDelta,
                  };
                  const residualPrerequisite = compileSurvivalOpportunityPrerequisite({
                    project,
                    parentDependency: prerequisite.parentDependency,
                    boundary: prerequisite.boundary,
                    witness: candidateWitness,
                    originFailedAttemptId: attemptId,
                    originContinuationId: work.originContinuationId || null,
                    selectionPolicy: "first-prefix-compatible-replay-valid-residual-by-bfs-discovery",
                    sourceType: "paid-residual-witness-suffix",
                  });
                  const selectedPostExactStateKey = buildStateKey(materialized.finalState);
                  const selectedPostStateMatches = selectedPostExactStateKey === witness.postExactStateKey;
                  const residualReplay = selectedPostStateMatches
                    ? verifyConnectorChain(
                        simulator,
                        materialized.finalState,
                        residualSelection.suffix,
                        { expectedPostExactStateKey: candidateEdge.postExactStateKey },
                      )
                    : { valid: false, failureReason: "selected-o2-post-exact-state-mismatch" };
                  const residualCompletion = residualPrerequisite && residualReplay.valid
                    ? residualPrerequisite.completionPredicate(residualReplay.finalState)
                    : false;
                  residualRecord.selectedResidualOpportunityId = residualPrerequisite
                    ? residualPrerequisite.id
                    : null;
                  residualRecord.selectedResidualTarget = residualPrerequisite
                    ? residualPrerequisite.target
                    : null;
                  residualRecord.residualReplayValid = residualReplay.valid;
                  residualRecord.residualPrerequisiteSatisfied = residualCompletion;
                  residualRecord.suffixLength = residualSelection.suffix.length;
                  residualRecord.replayFailureReason = residualReplay.failureReason || null;
                  if (residualPrerequisite) {
                    stats.survivalOpportunityPrerequisitesCompiled += 1;
                    stats.survivalOpportunityPrerequisitesWitnessBacked += 1;
                  }
                  if (residualReplay.valid) stats.survivalOpportunityResidualReplayValid += 1;
                  if (residualCompletion) stats.survivalOpportunityResidualPrerequisiteSatisfied += 1;
                  if (residualPrerequisite && residualReplay.valid && residualCompletion) {
                    const residualResult = {
                      status: "satisfied",
                      stoppedReason: "satisfied",
                      dependencyId: residualPrerequisite.id,
                      sourceExactStateKey: selectedPostExactStateKey,
                      postExactStateKey: candidateEdge.postExactStateKey,
                      edges: residualSelection.suffix,
                      chain: residualSelection.suffix.map((edge) => edge.action),
                      chainSummary: residualSelection.suffix.map((edge) =>
                        edge.action && (edge.action.summary || edge.action.kind || "step")),
                      expansions: 0,
                      generated: 0,
                      applyErrors: 0,
                      frontierSize: 0,
                      frontierTrimmed: 0,
                    };
                    const residualMaterialized = materializeConnectorChain(
                      materialized.finalNode,
                      residualResult,
                    );
                    if (residualMaterialized.ok) {
                      stats.survivalOpportunityPrerequisitesSatisfied += 1;
                      if (residualMaterialized.finalCreated) {
                        stats.survivalOpportunityPrerequisiteStateCreated += 1;
                        stats.survivalOpportunityResidualPrerequisiteStateCreated += 1;
                      }
                      continuationPrerequisite = residualPrerequisite;
                      continuationSourceNode = materialized.finalNode;
                      continuationFinalNode = residualMaterialized.finalNode;
                      continuationFinalCreated = residualMaterialized.finalCreated;
                      stats.survivalOpportunityResidualRecoverySelected += 1;
                      paidResidualRecoveriesUsed += 1;
                      stats.paidResidualRecoveriesUsed = paidResidualRecoveriesUsed;
                      residualRecord.materialized = true;
                      residualRecord.finalCreated = residualMaterialized.finalCreated;
                      residualRecord.status = "materialized";
                      residualRecord.statusReason = "residual-prefix-replay-and-discrete-completion-pass";
                      if (enablePostResidualAttribution) {
                        const postO3Attribution = attributePostO3ResidualPrefix({
                          simulator,
                          selectedPrefixEdges: candidateEdges,
                          selectedPostState: residualMaterialized.finalState,
                          selectedPostExactStateKey: candidateEdge.postExactStateKey,
                          selectedSourceExactStateKey: candidateWitness.sourceExactStateKey,
                          selectedDiscoveryOrdinal: residualSelection.discoveryOrdinal,
                          snapshot,
                        });
                        if (stats.survivalOpportunityPostResidualAttributions.length < 16) {
                          stats.survivalOpportunityPostResidualAttributions.push({
                            originFailedAttemptId: attemptId,
                            originO2OpportunityId: opportunityPrerequisite.id,
                            originO3OpportunityId: residualPrerequisite.id,
                            originSnapshotCaptureComplete: snapshot.captureComplete,
                            selectedPrefixLength: candidateEdges.length,
                            selectedPrefixPostExactStateKey: candidateEdge.postExactStateKey,
                            ...postO3Attribution,
                          });
                        }
                      }
                      if (stats.survivalOpportunityResidualRecoveries.length < 16) {
                        stats.survivalOpportunityResidualRecoveries.push(residualRecord);
                      }
                      if (enableSecondSurvivalResidualRecovery && paidResidualRecoveriesUsed === 1) {
                        const o3PostExactStateKey = buildStateKey(residualMaterialized.finalState);
                        const o3PostStateMatches = o3PostExactStateKey === candidateEdge.postExactStateKey;
                        const secondSelection = o3PostStateMatches
                          ? firstPrefixCompatibleReplayValidResidual({
                            simulator,
                            selectedWitness: candidateWitness,
                            selectedPostState: residualMaterialized.finalState,
                            snapshot,
                          })
                          : null;
                        const secondRecord = {
                          sourceType: "paid-residual-witness-suffix",
                          recoveryIndex: 2,
                          originFailedAttemptId: attemptId,
                          originSelectedOpportunityId: residualPrerequisite.id,
                          originSnapshotCaptureComplete: snapshot.captureComplete,
                          selectedResidualOpportunityId: null,
                          selectedResidualTarget: null,
                          selectionPolicy: "first-prefix-compatible-replay-valid-residual-by-bfs-discovery",
                          residualRecoverySelected: Boolean(secondSelection),
                          residualReplayValid: false,
                          residualPrerequisiteSatisfied: false,
                          residualSearchExpansions: 0,
                          connectorCallsCharged: 0,
                          suffixLength: 0,
                          candidateDiscoveryOrdinal: secondSelection
                            ? secondSelection.discoveryOrdinal
                            : null,
                          candidateDiscoveryExpansion: secondSelection
                            ? secondSelection.edge.expansion
                            : null,
                          candidateDiscoveryDepth: secondSelection
                            ? secondSelection.edge.depth
                            : null,
                          materialized: false,
                          finalCreated: false,
                          parentContinuationId: null,
                          parentContinuationCreated: false,
                          status: secondSelection ? "selected" : "not-selected",
                          statusReason: secondSelection
                            ? "first-prefix-compatible-replay-valid-residual-by-bfs-discovery"
                            : !o3PostStateMatches
                              ? "selected-o3-post-exact-state-mismatch"
                              : snapshot.captureComplete
                                ? "no-prefix-compatible-replay-valid-residual"
                                : "capture-incomplete",
                          selectedSourcePostExactStateKey: o3PostExactStateKey,
                        };
                        if (secondSelection) {
                          stats.survivalOpportunitySecondResidualRecoverySelected += 1;
                          const secondCandidateEdge = secondSelection.edge;
                          const secondCandidateWitness = buildResidualCandidateWitness(
                            secondCandidateEdge,
                            secondSelection.candidateEdges,
                            secondSelection.discoveryOrdinal,
                          );
                          const secondPrerequisite = compileSurvivalOpportunityPrerequisite({
                            project,
                            parentDependency: prerequisite.parentDependency,
                            boundary: prerequisite.boundary,
                            witness: secondCandidateWitness,
                            originFailedAttemptId: attemptId,
                            originContinuationId: work.originContinuationId || null,
                            selectionPolicy: "first-prefix-compatible-replay-valid-residual-by-bfs-discovery",
                            sourceType: "paid-residual-witness-suffix",
                          });
                          const secondReplay = secondPrerequisite
                            ? verifyConnectorChain(
                              simulator,
                              residualMaterialized.finalState,
                              secondSelection.suffix,
                              { expectedPostExactStateKey: secondCandidateEdge.postExactStateKey },
                            )
                            : { valid: false, failureReason: "second-residual-prerequisite-compile-failed" };
                          let secondCompletion = false;
                          if (secondPrerequisite && secondReplay.valid) {
                            try {
                              secondCompletion = secondPrerequisite.completionPredicate(secondReplay.finalState);
                            } catch (_error) {
                              secondCompletion = false;
                            }
                          }
                          secondRecord.selectedResidualOpportunityId = secondPrerequisite
                            ? secondPrerequisite.id
                            : null;
                          secondRecord.selectedResidualTarget = secondPrerequisite
                            ? secondPrerequisite.target
                            : null;
                          secondRecord.residualReplayValid = secondReplay.valid;
                          secondRecord.residualPrerequisiteSatisfied = secondCompletion;
                          secondRecord.suffixLength = secondSelection.suffix.length;
                          secondRecord.replayFailureReason = secondReplay.failureReason || null;
                          if (secondPrerequisite) {
                            stats.survivalOpportunityPrerequisitesCompiled += 1;
                            stats.survivalOpportunityPrerequisitesWitnessBacked += 1;
                          }
                          if (secondReplay.valid) {
                            stats.survivalOpportunityResidualReplayValid += 1;
                            stats.survivalOpportunitySecondResidualReplayValid += 1;
                          }
                          if (secondCompletion) {
                            stats.survivalOpportunityResidualPrerequisiteSatisfied += 1;
                            stats.survivalOpportunitySecondResidualPrerequisiteSatisfied += 1;
                          }
                          if (secondPrerequisite && secondReplay.valid && secondCompletion) {
                            const secondMaterialized = materializeConnectorChain(
                              residualMaterialized.finalNode,
                              buildSatisfiedResidualResult(
                                secondPrerequisite,
                                o3PostExactStateKey,
                                secondSelection,
                              ),
                            );
                            if (secondMaterialized.ok) {
                              stats.survivalOpportunityPrerequisitesSatisfied += 1;
                              stats.survivalOpportunitySecondResidualPrerequisiteStateCreated +=
                                secondMaterialized.finalCreated ? 1 : 0;
                              stats.survivalOpportunityResidualPrerequisiteStateCreated +=
                                secondMaterialized.finalCreated ? 1 : 0;
                              stats.survivalOpportunityResidualRecoverySelected += 1;
                              paidResidualRecoveriesUsed += 1;
                              stats.paidResidualRecoveriesUsed = paidResidualRecoveriesUsed;
                              continuationPrerequisite = secondPrerequisite;
                              continuationSourceNode = residualMaterialized.finalNode;
                              continuationFinalNode = secondMaterialized.finalNode;
                              continuationFinalCreated = secondMaterialized.finalCreated;
                              secondResidualMaterialized = true;
                              secondRecord.materialized = true;
                              secondRecord.finalCreated = secondMaterialized.finalCreated;
                              secondRecord.status = "materialized";
                              secondRecord.statusReason = "second-residual-replay-and-discrete-completion-pass";
                              residualRecord.supersededBySecondResidual = true;
                              residualRecord.supersededByRecoveryIndex = 2;
                              stats.survivalOpportunitySecondResidualMaterialized += 1;
                            } else {
                              secondRecord.status = "not-materialized";
                              secondRecord.statusReason = secondMaterialized.reason || "materialization-failed";
                            }
                          } else {
                            secondRecord.status = "replay-or-completion-failed";
                            secondRecord.statusReason = secondReplay.failureReason ||
                              "second-residual-discrete-completion-failed";
                          }
                        }
                        if (stats.survivalOpportunityResidualRecoveries.length < 16) {
                          stats.survivalOpportunityResidualRecoveries.push(secondRecord);
                        }
                      }
                    } else {
                      residualRecord.status = "not-materialized";
                      residualRecord.statusReason = residualMaterialized.reason || "materialization-failed";
                      if (stats.survivalOpportunityResidualRecoveries.length < 16) {
                        stats.survivalOpportunityResidualRecoveries.push(residualRecord);
                      }
                    }
                  } else {
                    residualRecord.status = "replay-or-completion-failed";
                    residualRecord.statusReason = residualReplay.failureReason ||
                      "residual-discrete-completion-failed";
                  }
                }
              }
              if (enableSurvivalResidualAttribution) {
                const residualAttribution = attributeResidualPaidWitnessGraph({
                  simulator,
                  selectedWitness: witness,
                  selectedPostState: replay.finalState,
                  snapshot: lethalSurvivalEdgeObserver.snapshot(),
                });
                if (stats.survivalOpportunityResidualAttributions.length < 16) {
                  stats.survivalOpportunityResidualAttributions.push({
                    opportunityId: opportunityPrerequisite.id,
                    parentDependencyId: prerequisite.parentDependency.id,
                    originFailedAttemptId: attemptId,
                    originContinuationId: work.originContinuationId || null,
                    target: opportunityPrerequisite.target,
                    ...residualAttribution,
                  });
                }
              }
              stats.survivalOpportunityPrerequisitesSatisfied += 1;
              if (materialized.finalCreated) {
                stats.survivalOpportunityPrerequisiteStateCreated += 1;
              }
              const continuationResult = createParentDependencyContinuation(
                continuationPrerequisite,
                continuationSourceNode,
                continuationFinalNode,
                continuationFinalCreated,
                number(work.hierarchyLevel, 0),
              );
              if (continuationResult.continuation) {
                parentContinuationId = continuationResult.continuation.id;
                parentContinuationCreated = continuationResult.created;
                const residualRecords = stats.survivalOpportunityResidualRecoveries;
                const residualRecord = [...residualRecords].reverse()
                  .find((entry) => entry.status === "materialized") || null;
                if (residualRecord && residualRecord.status === "materialized") {
                  residualRecord.parentContinuationId = parentContinuationId;
                  residualRecord.parentContinuationCreated = parentContinuationCreated;
                }
              }
              if (enableO4ContinuationAttribution && secondResidualMaterialized &&
                  parentContinuationId && continuationFinalNode) {
                try {
                  const boundary = attributeO4ContinuationBoundary(
                    continuationFinalNode,
                    parentContinuationId,
                    dependencyTargetFloorId(prerequisite.parentDependency.target),
                  );
                  if (stats.o4ContinuationAttributions.length < 4) {
                    stats.o4ContinuationAttributions.push(boundary);
                  }
                } catch (_error) {
                  // observation-only; must never affect the search
                }
              }
            }
            if (stats.survivalOpportunityWitnesses.length < 16) {
              stats.survivalOpportunityWitnesses.push({
                opportunityId: opportunityPrerequisite.id,
                parentDependencyId: prerequisite.parentDependency.id,
                originFailedAttemptId: attemptId,
                originContinuationId: work.originContinuationId || null,
                target: opportunityPrerequisite.target,
                targetSignature: opportunityPrerequisite.targetSignature,
                selectionPolicy: opportunityPrerequisite.selectionPolicy,
                discoveryOrdinal: witness.discoveryOrdinal,
                discoveryExpansion: witness.discoveryExpansion,
                discoveryDepth: witness.discoveryDepth,
                deltaSurvivalMargin: witness.deltaSurvivalMargin,
                deltaHP: witness.deltaHP,
                deltaDamage: witness.deltaDamage,
                resourceDelta: witness.resourceDelta,
                witnessChainLength: witness.witnessChain.length,
                witnessChainSummary: witness.witnessChainSummary,
                replayValid,
                completionAfterReplay,
                materialized: Boolean(materialized && materialized.ok),
                finalCreated: materialized ? materialized.finalCreated : false,
                parentContinuationId,
                parentContinuationCreated,
              });
            }
          }
        }
      }
      const battleCallHierarchyLevel = Math.max(0, number(work.hierarchyLevel, 0));
      stats.maxHierarchyDepthAttempted = Math.max(
        stats.maxHierarchyDepthAttempted,
        battleCallHierarchyLevel,
      );
      if (battleCallHierarchyLevel === 0) {
        stats.rootLevelCalls += 1;
      } else {
        stats.continuationDerivedCalls += 1;
        stats.childPrerequisitesExecuted += 1;
      }
      if (prerequisite.kind === "battle-stage-prerequisite") {
        stats.battleStagePrerequisitesExecuted += 1;
      }
      releaseHierarchyPriorityForCall(work);
      stats.battleAccessPrerequisiteExpansions += result.expansions;
      if (result.status !== "satisfied") {
        stats.battleAccessPrerequisiteNoSatisfied += 1;
        if (stats.battleAccessPrerequisiteWitnesses.length < dependencyConnectorMaxCalls) {
          stats.battleAccessPrerequisiteWitnesses.push({
            ...attemptBase,
            status: result.status,
            stoppedReason: result.stoppedReason,
            expansions: result.expansions,
          });
        }
        lazyWork.reject(work, `battle-access-prerequisite-${result.stoppedReason}`);
        return true;
      }
      if (result.chain.length === 0) {
        lazyWork.reject(work, "battle-access-prerequisite-empty-chain");
        return true;
      }
      const bestBeforeMaterialize = bestTerminalBlocker.progressScore;
      const materialized = materializeConnectorChain(sourceNode, result);
      if (!materialized.ok) {
        lazyWork.reject(work, `battle-access-prerequisite-chain-apply-error:${materialized.reason}`);
        return true;
      }
      let completionStillTrue = false;
      try {
        completionStillTrue = prerequisite.completionPredicate(materialized.finalState);
      } catch (_error) {
        completionStillTrue = false;
      }
      if (!completionStillTrue) {
        lazyWork.reject(work, "battle-access-prerequisite-not-preserved-after-replay");
        return true;
      }
      stats.battleAccessPrerequisiteSatisfied += 1;
      if (battleCallHierarchyLevel > 0) stats.childPrerequisitesSatisfied += 1;
      if (prerequisite.kind === "battle-stage-prerequisite") {
        stats.battleStagePrerequisitesSatisfied += 1;
      }
      if (materialized.finalCreated) stats.battleAccessPrerequisiteStateCreated += 1;
      let structuralBefore = null;
      let structuralAfter = null;
      try {
        structuralBefore = buildFullStructuralAccessAttribution({
          project,
          simulator,
          state: sourceNode.state,
          target: prerequisite.parentDependency.target,
        });
        structuralAfter = buildFullStructuralAccessAttribution({
          project,
          simulator,
          state: materialized.finalState,
          target: prerequisite.parentDependency.target,
        });
      } catch (_error) {
        structuralBefore = null;
        structuralAfter = null;
      }
      const finalProjection = terminalBattleProjection(simulator, materialized.finalState, terminalGoal);
      const afterBattle = enableBattleViabilityAttribution
        ? analyzeBattleViabilityBlocker(simulator, materialized.finalState, prerequisite.boundary)
        : null;
      const reachedNewBest = materialized.finalCreated &&
        bestBeforeMaterialize != null &&
        finalProjection && finalProjection.progressScore != null &&
        finalProjection.progressScore > bestBeforeMaterialize;
      if (reachedNewBest) stats.battleAccessPrerequisiteGlobalBlockerAdvanced += 1;
      const parentContinuationResult = createParentDependencyContinuation(
        prerequisite,
        sourceNode,
        materialized.finalNode,
        materialized.finalCreated,
        work.hierarchyLevel || 0,
      );
      const parentContinuation = parentContinuationResult.continuation;
      if (stats.battleAccessPrerequisiteWitnesses.length < dependencyConnectorMaxCalls) {
        stats.battleAccessPrerequisiteWitnesses.push({
          ...attemptBase,
          status: result.status,
          stoppedReason: result.stoppedReason,
          expansions: result.expansions,
          chainActions: result.chain.length,
          chainSummary: result.chain.map((action) => action.summary || action.kind || "step"),
          resourceDelta: summarizeResourceDelta(sourceNode.state, materialized.finalState),
          final: {
            floorId: materialized.finalState.floorId,
            hp: number((materialized.finalState.hero || {}).hp, 0),
            atk: number((materialized.finalState.hero || {}).atk, 0),
            def: number((materialized.finalState.hero || {}).def, 0),
            mdef: number((materialized.finalState.hero || {}).mdef, 0),
          },
          finalCreated: materialized.finalCreated,
          parentDependencyContinuationId: parentContinuation ? parentContinuation.id : null,
          parentDependencyContinuationCreated: parentContinuationResult.created,
          parentDependencyContinuationMergeLifecycle: parentContinuationResult.lifecycle,
          reachedNewBest,
          afterStage: afterBattle ? afterBattle.stage : null,
          battleAfter: afterBattle ? {
            stage: afterBattle.stage,
            supported: afterBattle.supported,
            heroHp: afterBattle.heroHp,
            heroAtk: afterBattle.heroAtk,
            enemyDef: afterBattle.enemyDef,
            attackMargin: afterBattle.attackMargin,
            damage: afterBattle.damage,
            survivalMargin: afterBattle.survivalMargin,
            reason: afterBattle.reason,
          } : null,
          structuralCrossingsBefore: structuralBefore
            ? structuralBefore.minStructuralBoundaryCrossings
            : null,
          structuralCrossingsAfter: structuralAfter
            ? structuralAfter.minStructuralBoundaryCrossings
            : null,
          structuralAfter: structuralAfter ? {
            available: structuralAfter.floorScoped === true &&
              structuralAfter.minStructuralBoundaryCrossings != null,
            reason: structuralAfter.floorScoped === true &&
              structuralAfter.minStructuralBoundaryCrossings != null
                ? "ok"
                : !structuralAfter.floorScoped
                  ? "target-not-on-current-floor"
                  : structuralAfter.evidence && structuralAfter.evidence.reason
                    ? "no-structural-path"
                    : "attribution-unavailable",
            floorScoped: structuralAfter.floorScoped,
            minStructuralBoundaryCrossings: structuralAfter.minStructuralBoundaryCrossings,
            firstObservedUnresolvedBoundary: structuralAfter.firstObservedUnresolvedBoundary
              ? {
                  floorId: structuralAfter.firstObservedUnresolvedBoundary.floorId,
                  x: structuralAfter.firstObservedUnresolvedBoundary.x,
                  y: structuralAfter.firstObservedUnresolvedBoundary.y,
                  kind: structuralAfter.firstObservedUnresolvedBoundary.exactStateClassification.kind,
                }
              : null,
            unavailableReason: structuralAfter.evidence && structuralAfter.evidence.reason
              ? structuralAfter.evidence.reason
              : structuralAfter.floorScoped
                ? null
                : "full structural access attribution is only computed on the current floor",
          } : {
            available: false,
            reason: "attribution-error",
            floorScoped: false,
            minStructuralBoundaryCrossings: null,
            firstObservedUnresolvedBoundary: null,
            unavailableReason: "structural attribution failed",
          },
          firstUnresolvedBefore: structuralBefore && structuralBefore.firstObservedUnresolvedBoundary
            ? {
                floorId: structuralBefore.firstObservedUnresolvedBoundary.floorId,
                x: structuralBefore.firstObservedUnresolvedBoundary.x,
                y: structuralBefore.firstObservedUnresolvedBoundary.y,
                kind: structuralBefore.firstObservedUnresolvedBoundary.exactStateClassification.kind,
              }
            : null,
          firstUnresolvedAfter: structuralAfter && structuralAfter.firstObservedUnresolvedBoundary
            ? {
                floorId: structuralAfter.firstObservedUnresolvedBoundary.floorId,
                x: structuralAfter.firstObservedUnresolvedBoundary.x,
                y: structuralAfter.firstObservedUnresolvedBoundary.y,
                kind: structuralAfter.firstObservedUnresolvedBoundary.exactStateClassification.kind,
              }
            : null,
        });
      }
      if (goalPredicate(materialized.finalState)) {
        goalNode = materialized.finalNode;
        firstGoalExpansion = stats.expansions;
      }
      lazyWork.resolve(work, materialized.finalCreated
        ? "battle-access-prerequisite-materialized"
        : "battle-access-prerequisite-merged");
      return true;
    }

    lazyWork.reject(work, "unknown-kind");
    return true;
  }

  while (!goalNode && stats.expansions < maxExpansions && hasRemainingTotalSearchBudget()) {
    if (enableLazyWork && lazyWork.activeSize() > 0 && stats.expansions > 0 &&
        stats.expansions % lazyDrainEvery === 0) {
      drainOneLazyItem();
      if (goalNode || !hasRemainingTotalSearchBudget()) break;
    }
    let selected = selectPendingAnchorExpansion();
    if (!selected) selected = agenda.pop(expanded);
    if (!selected && enableLazyWork && lazyWork.activeSize() > 0 && hasRemainingTotalSearchBudget()) {
      drainOneLazyItem();
      if (goalNode || !hasRemainingTotalSearchBudget()) break;
      selected = selectPendingAnchorExpansion() || agenda.pop(expanded);
    }
    if (!selected || !hasRemainingTotalSearchBudget()) break;
    const node = selected.node;
    if (!hasRemainingTotalSearchBudget()) break;
    expanded.add(node.nodeId);
    stats.expansions += 1;
    stats.expandedByQueue[selected.queueId] = number(stats.expandedByQueue[selected.queueId], 0) + 1;
    let enumerated;
    try {
      enumerated = enumerateStrategicActions(simulator, node.state, {
        compareLegacyFilter: stats.expansions === 1,
        includeFloorFly: false,
      });
    } catch (_error) {
      continue;
    }
    stats.rawVariants += enumerated.rawVariantCount;
    stats.legacyVisibleVariants += enumerated.legacyVisibleVariantCount;
    stats.recoveredFromLegacyHeuristicFilter += enumerated.recoveredFromLegacyHeuristicFilter;
    const aggregation = aggregateVariantsIntoTransitions({
      simulator,
      state: node.state,
      actions: enumerated.actions,
      terminalGoal,
      stateIndex,
      beforeOptionMap: node.optionMap,
      beforeReachable: node.reachablePoi,
    });
    stats.applyRejected += aggregation.rejectedVariantCount;
    stats.travelVariantAliasCount += Math.max(0, aggregation.variantCount - aggregation.choiceCount);
    const expansionSummary = {
      nodeId: node.nodeId,
      expansionOrdinal: stats.expansions,
      rawActionCount: enumerated.rawVariantCount,
      strategicTransitionCount: aggregation.transitions.length,
      applyRejectedCount: aggregation.rejectedVariantCount,
      canonicalPosts: {
        newChildCount: 0,
        exactMergeCount: 0,
        deferredPostCount: 0,
      },
      floorTransitionActions: [],
    };
    for (const transition of aggregation.transitions) {
      let transitionDeferredCount = 0;
      stats.generated += 1;
      observedChoices.add(transition.choice);
      for (const variant of transition.travelVariants) {
        const kind = variant.kind || "unknown";
        stats.generatedByKind[kind] = number(stats.generatedByKind[kind], 0) + 1;
        if (
          variant.kind === "battle" &&
          variant.floorId === terminalGoal.floorId &&
          Number(variant.x) === Number(terminalGoal.x) &&
          Number(variant.y) === Number(terminalGoal.y)
        ) stats.terminalActionGenerated += 1;
      }
      const unionNewlyReachable = new Set();
      const unionNoLongerReachable = new Set();
      let transitionConsumesOpportunities = false;
      let transitionTerminalBlockerImproved = false;
      for (const post of transition.postStates) {
        post.newlyReachablePOIs.forEach((entry) => unionNewlyReachable.add(entry.key));
        post.noLongerReachablePOIs.forEach((entry) => unionNoLongerReachable.add(entry.key));
        if (post.consumedOpportunities.length > 0) transitionConsumesOpportunities = true;
        if (post.terminalBlockerDelta && post.terminalBlockerDelta.improved) {
          transitionTerminalBlockerImproved = true;
        }
        const implicit = post.consumedOpportunities.filter((entry) => entry.role === "implicit");
        if (implicit.length > 0) {
          stats.implicitOptionConsumptions += implicit.length;
          if (stats.implicitOptionConsumptionSamples.length < 12) {
            stats.implicitOptionConsumptionSamples.push({
              action: transition.choiceLabel,
              explicitTarget: transition.targetPOI,
              consumed: implicit.map((entry) => ({ key: entry.key, kind: entry.kind, tileId: entry.tileId })),
            });
          }
        }
      }
      if (unionNewlyReachable.size > 0) stats.transitionsWithNewlyReachable += 1;
      if (unionNoLongerReachable.size > 0) stats.transitionsWithLostReachability += 1;
      if (transitionConsumesOpportunities) stats.transitionsConsumingOpportunities += 1;
      if (transitionTerminalBlockerImproved) stats.transitionsWithTerminalBlockerImprovement += 1;
      if (transition.postStates.some((post) =>
        post.optionDelta.consumed.length > 0 || post.optionDelta.created.length > 0)) {
        stats.optionChangingTransitions += 1;
      }
      const selection = selectCanonicalPostState(transition, { goalPredicate });
      if (!selection) continue;
      const post = selection.postState;
      stats.canonicalSelectionReasons[selection.reason] =
        number(stats.canonicalSelectionReasons[selection.reason], 0) + 1;
      const exactKey = post.stateKey;
      // 5.18c: non-canonical exact posts become recoverable lazy work instead of
      // a silently discarded count.
      if (enableLazyWork) {
        for (const candidate of transition.postStates) {
          if (candidate.stateKey === exactKey) continue;
          if (seenExact.has(candidate.stateKey)) continue;
          lazyWork.enqueue({
            kind: "deferred-exact-post",
            sourceNodeId: node.nodeId,
            choiceLabel: transition.choiceLabel,
            targetPOI: transition.targetPOI,
            post: candidate,
          });
          stats.deferredPostStates += 1;
          transitionDeferredCount += 1;
        }
      } else {
        const deferredCandidateCount = transition.postStates
          .filter((candidate) => candidate.stateKey !== exactKey && !seenExact.has(candidate.stateKey))
          .length;
        stats.deferredPostStates += deferredCandidateCount;
        transitionDeferredCount += deferredCandidateCount;
      }
      if (seenExact.has(exactKey)) {
        const targetNode = nodes.get(seenExact.get(exactKey));
        enqueueParentContinuationForState(targetNode);
        stats.exactMerged += 1;
        expansionSummary.canonicalPosts.exactMergeCount += 1;
        expansionSummary.canonicalPosts.deferredPostCount += transitionDeferredCount;
        canonicalSuccessorEdges.push({
          fromNodeId: node.nodeId,
          targetNodeId: targetNode.nodeId,
          actionKind: post.appliedBy.kind || null,
          actionSummary: post.appliedBy.summary || transition.choiceLabel,
          sourceFloor: node.state.floorId,
          targetFloor: post.state.floorId,
          disposition: "exact-merge",
        });
        stats.canonicalSuccessorEdgeCount += 1;
        if (post.state.floorId !== node.state.floorId) {
          expansionSummary.floorTransitionActions.push({
            actionSummary: post.appliedBy.summary || transition.choiceLabel,
            kind: post.appliedBy.kind || null,
            sourceFloor: node.state.floorId,
            resultingFloor: post.state.floorId,
            disposition: "exact-merge",
          });
          stats.canonicalFloorTransitionActionCount += 1;
        }
        continue;
      }
      const child = createChildNode(
        node,
        post.state,
        exactKey,
        {
          ...post.appliedBy,
          fingerprint: simulator.getActionFingerprint(post.appliedBy),
        },
        nextNodeId,
        nextNodeId,
      );
      nextNodeId += 1;
      child.optionMap = post.optionMap;
      child.reachablePoi = post.reachablePoi;
      const newlyDiscoveredPOIs = post.reachablePoi.entries
        .filter((entry) => !node.seenReachablePoiKeys.has(entry.key));
      child.seenReachablePoiKeys = new Set(node.seenReachablePoiKeys);
      newlyDiscoveredPOIs.forEach((entry) => child.seenReachablePoiKeys.add(entry.key));
      if (newlyDiscoveredPOIs.length > 0) stats.transitionsWithLineageNovelty += 1;
      child.strategicTransition = compactTransition(transition, post, newlyDiscoveredPOIs);
      if (child.strategicTransition && child.strategicTransition.terminalBlockerDelta) {
        observeTerminalBlocker(child, child.strategicTransition.terminalBlockerDelta.after);
      }
      nodes.set(child.nodeId, child);
      seenExact.set(exactKey, child.nodeId);
      nodeCreatedAtExpansion.set(child.nodeId, stats.expansions);
      agenda.push(child);
      stats.accepted += 1;
      stats.maxStrategicDepth = Math.max(stats.maxStrategicDepth, child.depth);
      expansionSummary.canonicalPosts.newChildCount += 1;
      expansionSummary.canonicalPosts.deferredPostCount += transitionDeferredCount;
      canonicalSuccessorEdges.push({
        fromNodeId: node.nodeId,
        targetNodeId: child.nodeId,
        actionKind: post.appliedBy.kind || null,
        actionSummary: post.appliedBy.summary || transition.choiceLabel,
        sourceFloor: node.state.floorId,
        targetFloor: child.state.floorId,
        disposition: "new-child",
      });
      stats.canonicalSuccessorEdgeCount += 1;
      if (child.state.floorId !== node.state.floorId) {
        expansionSummary.floorTransitionActions.push({
          actionSummary: post.appliedBy.summary || transition.choiceLabel,
          kind: post.appliedBy.kind || null,
          sourceFloor: node.state.floorId,
          resultingFloor: child.state.floorId,
          disposition: "new-child",
        });
        stats.canonicalFloorTransitionActionCount += 1;
      }
      agenda.definitions.forEach((definition) => {
        const existing = bestByRole.get(definition.id);
        if (!existing || definition.compare(child, existing) > 0) {
          bestByRole.set(definition.id, child);
        }
      });
      enqueueParentContinuationForState(child);
      if (selection.reason === "goal-reached") {
        goalNode = child;
        firstGoalExpansion = stats.expansions;
        break;
      }
    }

    nodeExpansionOrdinal.set(node.nodeId, stats.expansions);
    nodeExpansionSummaries.set(node.nodeId, expansionSummary);
    stats.canonicalExpansionSummaryCount += 1;

    // 5.18c/5.18d/5.18e/5.19b: enqueue the selected connector work.
    if (enableConnector && enableLazyWork) {
      if (connectorMode === "battle-access-prerequisite") {
        const queuedCount = lazyWork.queued()
          .filter((work) => work.kind === "battle-access-prerequisite-choice").length;
        if (enableHierarchicalCallAllocation && hierarchyPriority.isActive()) {
          if (queuedCount < dependencyAttemptMaxOutstanding) {
            stats.rootAttemptsDeferredForHierarchy += 1;
          }
        } else if (queuedCount < dependencyAttemptMaxOutstanding) {
          const reachableCandidates = compileDependenciesFromTransitions({
            project,
            simulator,
            terminalGoal,
            state: node.state,
            transitions: aggregation.transitions,
            maxCandidates: dependencyConnectorMaxCandidatesPerNode,
          });
          const unreachableCandidates = compileUnreachableTerminalDependencies({
            project,
            simulator,
            terminalGoal,
            state: node.state,
            reachablePoi: node.reachablePoi,
            optionMap: node.optionMap,
            maxCandidates: dependencyConnectorMaxCandidatesPerNode,
          });
          const candidates = unreachableCandidates
            .concat(reachableCandidates)
            .sort((left, right) => {
              const leftReachable = left.provenance.reachableAtCompileTime ? 1 : 0;
              const rightReachable = right.provenance.reachableAtCompileTime ? 1 : 0;
              return leftReachable - rightReachable ||
                ((right.provenance.expectedCapabilityDelta.progressScore || 0) -
                  (left.provenance.expectedCapabilityDelta.progressScore || 0)) ||
                left.id.localeCompare(right.id);
            });
          const compiledPrerequisites = [];
          for (const dependency of candidates) {
            if (compiledPrerequisites.length >= dependencyConnectorMaxCandidatesPerNode) break;
            let structuralAccess;
            try {
              structuralAccess = buildFullStructuralAccessAttribution({
                project,
                simulator,
                state: node.state,
                target: dependency.target,
              });
            } catch (_error) {
              structuralAccess = null;
            }
            if (!structuralAccess || !structuralAccess.firstObservedUnresolvedBoundary) continue;
            const prerequisite = compileBattleAccessPrerequisite({
              project,
              simulator,
              state: node.state,
              parentDependency: dependency,
              structuralAccess,
              sourceAttemptId: null,
              sourceExactStateFingerprint: dependency.provenance &&
                dependency.provenance.sourceExactStateFingerprint,
            });
            if (!prerequisite) continue;
            stats.battleAccessPrerequisiteCompiled += 1;
            compiledPrerequisites.push(prerequisite);
          }
          let separabilityEvent = null;
          if (enableRootAttemptSeparabilityAttribution && compiledPrerequisites.length > 0) {
            let projection = null;
            try {
              projection = terminalBattleProjection(simulator, node.state, terminalGoal);
            } catch (_error) {
              projection = null;
            }
            const eventCandidates = compiledPrerequisites.map((prerequisite, index) => {
              let candidateBattle = null;
              try {
                candidateBattle = analyzeBattleViabilityBlocker(
                  simulator,
                  node.state,
                  prerequisite.boundary,
                );
              } catch (_error) {
                candidateBattle = null;
              }
              const boundary = prerequisite.boundary || {};
              return {
                dependencyAttemptId: dependencyAttemptId(prerequisite, node.state),
                prerequisiteId: prerequisite.id,
                localRank: index + 1,
                selected: false,
                dedupeSeenBeforeSelection: dependencyAttemptDedupe.has(prerequisite, node.state),
                identity: {
                  floorId: boundary.floorId || null,
                  enemyId: boundary.enemyId || null,
                  x: boundary.x != null ? boundary.x : null,
                  y: boundary.y != null ? boundary.y : null,
                },
                semantic: buildRootAttemptSemanticVector({
                  prerequisite,
                  sourceNode: node,
                  beforeBattle: candidateBattle,
                  projection,
                  compiledCandidateRank: index + 1,
                  compiledCandidateCount: compiledPrerequisites.length,
                }),
              };
            });
            separabilityEvent = {
              compileEventOrdinal: rootCompileEvents.length + 1,
              expansionAtCompile: stats.expansions,
              sourceNodeId: node.nodeId,
              sourceDepth: number(node.depth, 0),
              sourceFloor: node.state.floorId,
              callsExecuted: stats.battleAccessPrerequisiteCalls,
              callsRemainingBefore: Math.max(
                0,
                dependencyConnectorMaxCalls - stats.battleAccessPrerequisiteCalls,
              ),
              queuedCount,
              maxOutstanding: dependencyAttemptMaxOutstanding,
              selectedCount: 0,
              candidates: eventCandidates,
            };
          }
          const selectedAttempts = selectFeedbackAwareDependencyAttempts({
            candidates: compiledPrerequisites,
            sourceState: node.state,
            dedupe: dependencyAttemptDedupe,
            maxCalls: dependencyConnectorMaxCalls,
            callsExecuted: stats.battleAccessPrerequisiteCalls,
            queuedCount,
            maxOutstanding: dependencyAttemptMaxOutstanding,
          });
          if (enableHierarchyCallAttribution && selectedAttempts.length === 0 &&
              compiledPrerequisites.length > 0) {
            if (stats.battleAccessPrerequisiteCalls >= dependencyConnectorMaxCalls) {
              stats.rootLevelCompiledCapBlockedSelectionEvents += 1;
              stats.rootLevelCapBlockedCompiledCandidateInstances += compiledPrerequisites.length;
            } else if (queuedCount >= dependencyAttemptMaxOutstanding) {
              stats.rootLevelCompiledOutstandingBlockedSelectionEvents += 1;
            } else {
              stats.rootLevelCompiledDedupRejectedSelectionEvents += 1;
            }
          }
          for (const prerequisite of selectedAttempts) {
            const localRank = compiledPrerequisites.indexOf(prerequisite) + 1;
            lazyWork.enqueue({
              kind: "battle-access-prerequisite-choice",
              sourceNodeId: node.nodeId,
              prerequisite,
              hierarchyLevel: 0,
              originContinuationId: null,
              selectionContext: enableRootAttemptSeparabilityAttribution ? {
                compileEventOrdinal: separabilityEvent ? separabilityEvent.compileEventOrdinal : null,
                compiledCandidateRank: localRank,
                compiledCandidateCount: compiledPrerequisites.length,
                candidateLocalRank: localRank,
              } : null,
            });
          }
          if (separabilityEvent) {
            const selectedIds = new Set(selectedAttempts.map((prerequisite) => prerequisite.id));
            for (const candidate of separabilityEvent.candidates) {
              candidate.selected = selectedIds.has(candidate.prerequisiteId);
            }
            separabilityEvent.selectedCount = selectedAttempts.length;
            rootCompileEvents.push(separabilityEvent);
            separabilityEvent = null;
          }
        }
      } else if (connectorMode === "dependency-derived") {
        const queuedCount = lazyWork.queued()
          .filter((work) => work.kind === "dependency-connector-choice").length;
        const remainingSlots = dependencyConnectorMaxCalls -
          stats.dependencyConnectorCalls - queuedCount;
        if (remainingSlots > 0) {
          const reachableCandidates = compileDependenciesFromTransitions({
            project,
            simulator,
            terminalGoal,
            state: node.state,
            transitions: aggregation.transitions,
            maxCandidates: dependencyConnectorMaxCandidatesPerNode,
          });
          const unreachableCandidates = compileUnreachableTerminalDependencies({
            project,
            simulator,
            terminalGoal,
            state: node.state,
            reachablePoi: node.reachablePoi,
            optionMap: node.optionMap,
            maxCandidates: dependencyConnectorMaxCandidatesPerNode,
          });
          const candidates = unreachableCandidates
            .concat(reachableCandidates)
            .sort((left, right) => {
              const leftReachable = left.provenance.reachableAtCompileTime ? 1 : 0;
              const rightReachable = right.provenance.reachableAtCompileTime ? 1 : 0;
              return leftReachable - rightReachable ||
                ((right.provenance.expectedCapabilityDelta.progressScore || 0) -
                  (left.provenance.expectedCapabilityDelta.progressScore || 0)) ||
                left.id.localeCompare(right.id);
            });
          stats.dependencyCompiledCandidates += candidates.length;
          const queuedCount = lazyWork.queued()
            .filter((work) => work.kind === "dependency-connector-choice").length;
          const selectedAttempts = selectFeedbackAwareDependencyAttempts({
            candidates,
            sourceState: node.state,
            dedupe: dependencyAttemptDedupe,
            maxCalls: dependencyConnectorMaxCalls,
            callsExecuted: stats.dependencyConnectorCalls,
            queuedCount,
            maxOutstanding: dependencyAttemptMaxOutstanding,
          });
          for (const dependency of selectedAttempts) {
            lazyWork.enqueue({
              kind: "dependency-connector-choice",
              sourceNodeId: node.nodeId,
              dependency,
            });
          }
        }
      } else if (connectorMode === "blocker-derived") {
        if (stats.blockerConnectorCalls < connectorMaxCalls) {
          const blocker = analyzeTerminalBlocker(simulator, node.state, terminalGoal);
          if (blocker.stage === "attack-blocked" || blocker.stage === "lethal") {
            lazyWork.enqueue({
              kind: "blocker-connector-choice",
              sourceNodeId: node.nodeId,
            });
          }
        }
      } else if (stats.connectorCalls < connectorMaxCalls &&
          !hasTerminalBattleAction(enumerated.actions, terminalGoal)) {
        lazyWork.enqueue({
          kind: "connector-choice",
          sourceNodeId: node.nodeId,
          target: buildTerminalChoiceTarget(terminalGoal),
        });
      }
    }
    if (enableLazyWork && floorFlyMode === "lazy" &&
        typeof simulator.enumerateFloorFlyActions === "function") {
      const flyTargets = new Set();
      try {
        simulator.enumerateFloorFlyActions(node.state).forEach((action) => {
          if (action.targetFloorId) flyTargets.add(action.targetFloorId);
        });
      } catch (_error) {
        // leave empty
      }
      for (const targetFloorId of flyTargets) {
        lazyWork.enqueue({
          kind: "floorfly-choice",
          sourceNodeId: node.nodeId,
          targetFloorId,
        });
      }
    }

    stats.maxFrontierSize = Math.max(stats.maxFrontierSize, agenda.activeSize(expanded));
  }
  stats.optionMapsObserved = stateIndex.optionMaps.size;
  stats.uniqueChoiceCount = observedChoices.size;
  stats.totalSearchExpansions = totalSearchWork();
  if (enableO4ContinuationAttribution && stats.o4ContinuationAttributions.length > 0) {
    for (const boundary of stats.o4ContinuationAttributions) {
      boundary.o4NodeExpanded = expanded.has(boundary.o4NodeId);
      boundary.o4NodeExpansionOrdinal = nodeExpansionOrdinal.get(boundary.o4NodeId) || null;
      boundary.continuationWitnesses = stats.parentDependencyContinuationWitnesses
        .filter((witness) => witness.continuationId === boundary.continuationId)
        .map((witness) => ({
          status: witness.status,
          statusReason: witness.statusReason,
          currentFloorId: witness.currentFloorId,
          targetFloorId: witness.targetFloorId,
          nextPrerequisiteId: witness.nextPrerequisiteId,
        }));
      boundary.anchorExpansionWitnesses = stats.anchorExpansionWitnesses
        .filter((witness) => witness.continuationId === boundary.continuationId)
        .slice(0, 8);
      boundary.searchEndExpansions = stats.expansions;
    }
  }
  if (enableHierarchyCallAttribution) {
    const originOpportunityWitnesses = new Map();
    const originOpportunityMaterializations = new Map();
    const originResidualMaterializations = new Map();
    const originContinuations = new Map();
    for (const witness of stats.survivalOpportunityWitnesses) {
      const attemptId = witness.originFailedAttemptId;
      if (!attemptId) continue;
      originOpportunityWitnesses.set(attemptId, number(originOpportunityWitnesses.get(attemptId), 0) + 1);
      if (witness.materialized) {
        originOpportunityMaterializations.set(
          attemptId,
          number(originOpportunityMaterializations.get(attemptId), 0) + 1,
        );
      }
      if (witness.materialized && witness.parentContinuationId) {
        if (!originContinuations.has(attemptId)) originContinuations.set(attemptId, new Set());
        originContinuations.get(attemptId).add(witness.parentContinuationId);
      }
    }
    for (const recovery of stats.survivalOpportunityResidualRecoveries) {
      const attemptId = recovery.originFailedAttemptId;
      if (!attemptId) continue;
      if (recovery.materialized) {
        originResidualMaterializations.set(
          attemptId,
          number(originResidualMaterializations.get(attemptId), 0) + 1,
        );
      }
      if (recovery.materialized && recovery.parentContinuationId) {
        if (!originContinuations.has(attemptId)) originContinuations.set(attemptId, new Set());
        originContinuations.get(attemptId).add(recovery.parentContinuationId);
      }
    }
    const perCall = stats.battleAccessPrerequisiteWitnesses.map((witness) => {
      const attemptId = witness.attemptId;
      const directSatisfied = witness.status === "satisfied";
      const opportunityWitnesses = attemptId == null
        ? 0
        : number(originOpportunityWitnesses.get(attemptId), 0);
      const opportunityMaterializations = attemptId == null
        ? 0
        : number(originOpportunityMaterializations.get(attemptId), 0);
      const residualMaterializations = attemptId == null
        ? 0
        : number(originResidualMaterializations.get(attemptId), 0);
      const derivedContinuationCount = attemptId == null || !originContinuations.has(attemptId)
        ? 0
        : originContinuations.get(attemptId).size;
      const directContinuationCount = witness.parentDependencyContinuationCreated ? 1 : 0;
      const derivedMaterializedProgress = opportunityMaterializations + residualMaterializations;
      return {
        attemptId: attemptId == null ? null : attemptId,
        hierarchyLevel: number(witness.hierarchyLevel, 0),
        connectorOutcome: {
          satisfied: directSatisfied,
          stoppedReason: witness.stoppedReason || (directSatisfied ? "satisfied" : null),
          expansions: number(witness.expansions, 0),
          chainActions: number(witness.chainActions, 0),
        },
        derivedProgress: {
          opportunityWitnesses,
          opportunityMaterializations,
          residualMaterializations,
          finalContinuationCreated: Math.max(directContinuationCount, derivedContinuationCount),
        },
        productive: directSatisfied || derivedMaterializedProgress > 0,
      };
    });
    const levelBuckets = { "0": null, "1": null, "2+": null };
    const bucketKey = (level) => (level <= 0 ? "0" : level === 1 ? "1" : "2+");
    for (const key of Object.keys(levelBuckets)) {
      levelBuckets[key] = {
        calls: 0,
        directSatisfied: 0,
        connectorNotSatisfied: 0,
        failedWithRecoveredProgress: 0,
        failedWithoutRecoveredProgress: 0,
        recoveredOpportunityMaterializations: 0,
        residualMaterializations: 0,
        expansions: 0,
        chainActions: 0,
        stoppedReasons: {},
      };
    }
    for (const entry of perCall) {
      const bucket = levelBuckets[bucketKey(entry.hierarchyLevel)];
      bucket.calls += 1;
      if (entry.connectorOutcome.satisfied) {
        bucket.directSatisfied += 1;
      } else {
        bucket.connectorNotSatisfied += 1;
        if (entry.productive) bucket.failedWithRecoveredProgress += 1;
        else bucket.failedWithoutRecoveredProgress += 1;
      }
      bucket.recoveredOpportunityMaterializations += entry.derivedProgress.opportunityMaterializations;
      bucket.residualMaterializations += entry.derivedProgress.residualMaterializations;
      bucket.expansions += entry.connectorOutcome.expansions;
      bucket.chainActions += entry.connectorOutcome.chainActions;
      const reason = entry.connectorOutcome.stoppedReason || "unknown";
      bucket.stoppedReasons[reason] = number(bucket.stoppedReasons[reason], 0) + 1;
    }
    const metricsPerLevel = {};
    for (const key of Object.keys(levelBuckets)) {
      const bucket = levelBuckets[key];
      const productiveCount = bucket.directSatisfied + bucket.failedWithRecoveredProgress;
      metricsPerLevel[key] = {
        directConnectorSatisfactionRate: bucket.calls > 0
          ? Math.round((bucket.directSatisfied / bucket.calls) * 100) / 100
          : null,
        productiveCallRate: bucket.calls > 0
          ? Math.round((productiveCount / bucket.calls) * 100) / 100
          : null,
      };
    }
    const continuationBlocks = {
      callCapExhausted: 0,
      outstandingBarrier: 0,
      attemptDeduplicated: 0,
      noSelection: 0,
    };
    for (const witness of stats.parentDependencyContinuationWitnesses) {
      if (witness.status !== "next-prerequisite-not-schedulable") continue;
      const reason = witness.statusReason || "no-selection";
      if (reason === "call-cap-exhausted") continuationBlocks.callCapExhausted += 1;
      else if (reason === "outstanding-barrier") continuationBlocks.outstandingBarrier += 1;
      else if (reason === "attempt-deduplicated") continuationBlocks.attemptDeduplicated += 1;
      else continuationBlocks.noSelection += 1;
    }
    const rejectedQueuedWork = {
      count: 0,
      reasons: {},
    };
    for (const reason of Object.keys((lazyWork.snapshot().rejectedByKind) || {})) {
      if (String(reason).startsWith("battle-access-prerequisite")) {
        const count = lazyWork.snapshot().rejectedByKind[reason] || 0;
        rejectedQueuedWork.count += count;
        rejectedQueuedWork.reasons[reason] = count;
      }
    }
    stats.hierarchyCallAllocationAttribution = {
      schema: "motapathfinder.strategic-hierarchy-call-allocation-attribution.v2",
      charged: {
        total: stats.battleAccessPrerequisiteCalls,
        rootLevel: stats.rootLevelCalls,
        childLevel: stats.continuationDerivedCalls,
        maxDepthAttempted: stats.maxHierarchyDepthAttempted,
      },
      perCall,
      byLevel: levelBuckets,
      metricsPerLevel,
      unchargedAttempts: {
        rootDeferredForHierarchy: stats.rootAttemptsDeferredForHierarchy,
        rootCompiledNotSelected: {
          capBlockedSelectionEvents: stats.rootLevelCompiledCapBlockedSelectionEvents,
          capBlockedCompiledCandidateInstances: stats.rootLevelCapBlockedCompiledCandidateInstances,
          outstandingBlockedSelectionEvents: stats.rootLevelCompiledOutstandingBlockedSelectionEvents,
          dedupRejectedSelectionEvents: stats.rootLevelCompiledDedupRejectedSelectionEvents,
        },
        continuationBlocks,
        rejectedQueuedWork,
      },
    };
  }
  if (enableHierarchyCallChronology && hierarchyChronology) {
    const originOpportunityMaterializations = new Map();
    const originResidualMaterializations = new Map();
    for (const witness of stats.survivalOpportunityWitnesses) {
      const attemptId = witness.originFailedAttemptId;
      if (!attemptId) continue;
      if (witness.materialized) {
        originOpportunityMaterializations.set(
          attemptId,
          number(originOpportunityMaterializations.get(attemptId), 0) + 1,
        );
      }
    }
    for (const recovery of stats.survivalOpportunityResidualRecoveries) {
      const attemptId = recovery.originFailedAttemptId;
      if (!attemptId) continue;
      if (recovery.materialized) {
        originResidualMaterializations.set(
          attemptId,
          number(originResidualMaterializations.get(attemptId), 0) + 1,
        );
      }
    }
    for (const entry of hierarchyChronology.calls) {
      const directSatisfied = Boolean(stats.battleAccessPrerequisiteWitnesses
        .find((witness) => witness.attemptId === entry.attemptId &&
          witness.status === "satisfied"));
      const derivedMaterializedProgress =
        number(originOpportunityMaterializations.get(entry.attemptId), 0) +
        number(originResidualMaterializations.get(entry.attemptId), 0);
      entry.directSatisfied = directSatisfied;
      entry.productive = directSatisfied || derivedMaterializedProgress > 0;
    }
    const rootCalls = hierarchyChronology.calls.filter((entry) => entry.hierarchyLevel === 0);
    const firstActivation = hierarchyChronology.checkpoints.firstHierarchyActivation;
    const rootCallsAnalysis = {
      total: rootCalls.length,
      beforeFirstHierarchyActivation: firstActivation == null
        ? null
        : rootCalls.filter((entry) => entry.callOrdinal <= firstActivation.callOrdinal).length,
      afterFirstHierarchyActivation: firstActivation == null
        ? null
        : rootCalls.filter((entry) => entry.callOrdinal > firstActivation.callOrdinal).length,
      productive: rootCalls.filter((entry) => entry.productive).length,
      failedWithoutRecoveredProgress: rootCalls.filter((entry) =>
        !entry.productive && !entry.directSatisfied).length,
      byOrdinal: rootCalls.map((entry) => ({
        callOrdinal: entry.callOrdinal,
        productive: entry.productive,
        directSatisfied: entry.directSatisfied,
        firstHierarchyActivationOccurredAtCharge: entry.firstHierarchyActivationOccurred,
        callsRemainingAfter: entry.callsRemainingAfter,
      })),
    };
    stats.hierarchyCallChronology = {
      schema: "motapathfinder.strategic-hierarchy-call-chronology-attribution.v1",
      calls: hierarchyChronology.calls,
      checkpoints: hierarchyChronology.checkpoints,
      rootCallsAnalysis,
    };
  }
  if (enableRootAttemptSeparabilityAttribution && rootAttemptSeparabilityCalls && rootCompileEvents) {
    const originOpportunityMaterializations = new Map();
    const originResidualMaterializations = new Map();
    for (const witness of stats.survivalOpportunityWitnesses) {
      const attemptId = witness.originFailedAttemptId;
      if (!attemptId) continue;
      if (witness.materialized) {
        originOpportunityMaterializations.set(
          attemptId,
          number(originOpportunityMaterializations.get(attemptId), 0) + 1,
        );
      }
    }
    for (const recovery of stats.survivalOpportunityResidualRecoveries) {
      const attemptId = recovery.originFailedAttemptId;
      if (!attemptId) continue;
      if (recovery.materialized) {
        originResidualMaterializations.set(
          attemptId,
          number(originResidualMaterializations.get(attemptId), 0) + 1,
        );
      }
    }
    const directSatisfiedByAttempt = new Map();
    for (const witness of stats.battleAccessPrerequisiteWitnesses) {
      if (witness.status === "satisfied" && witness.attemptId != null) {
        directSatisfiedByAttempt.set(witness.attemptId, true);
      }
    }
    for (const entry of rootAttemptSeparabilityCalls) {
      const directSatisfied = directSatisfiedByAttempt.has(entry.attemptId);
      const derivedMaterializedProgress =
        number(originOpportunityMaterializations.get(entry.attemptId), 0) +
        number(originResidualMaterializations.get(entry.attemptId), 0);
      entry.label = {
        directSatisfied,
        productive: directSatisfied || derivedMaterializedProgress > 0,
      };
    }
    const chargedToSelectedCandidate = rootAttemptSeparabilityCalls.map((call) => {
      const event = rootCompileEvents.find((entry) =>
        entry.compileEventOrdinal === call.compileEventOrdinal);
      const selectedCandidates = event
        ? event.candidates.filter((candidate) =>
          candidate.selected && candidate.dependencyAttemptId === call.attemptId)
        : [];
      return {
        callOrdinal: call.callOrdinal,
        attemptId: call.attemptId,
        compileEventOrdinal: call.compileEventOrdinal,
        matchedSelectedCandidateCount: selectedCandidates.length,
        matchedSemanticEqual: selectedCandidates.length === 1 &&
          isDeepStrictEqual(selectedCandidates[0].semantic, call.semantic),
      };
    });
    const chargedEventSummaries = rootAttemptSeparabilityCalls.map((call) => {
      const event = rootCompileEvents.find((entry) =>
        entry.compileEventOrdinal === call.compileEventOrdinal);
      const candidates = event ? event.candidates : [];
      return {
        callOrdinal: call.callOrdinal,
        compileEventOrdinal: call.compileEventOrdinal,
        expansionAtCharge: call.temporal.expansionAtCharge,
        selectedAttemptId: call.attemptId,
        selectedLocalRank: call.candidateLocalRank,
        candidateCount: candidates.length,
        selectedCount: event ? event.selectedCount : null,
        positiveAttackMarginCandidateCount: candidates.filter((candidate) =>
          candidate.semantic.attackMargin != null && candidate.semantic.attackMargin > 0).length,
      };
    });
    const productiveRoots = rootAttemptSeparabilityCalls.filter((entry) => entry.label.productive);
    const failedRoots = rootAttemptSeparabilityCalls.filter((entry) => !entry.label.productive);
    const separability = productiveRoots.length === 1
      ? classifyRootAttemptSeparability(productiveRoots[0], failedRoots)
      : {
        classification: "U4",
        singleFeatureSeparators: [],
        collisionAttemptIds: [],
        distinctFromAllFailedRoots: false,
        vectorEqualityDetails: null,
      };
    separability.productiveRootCount = productiveRoots.length;
    separability.failedRootCount = failedRoots.length;
    let availability = null;
    if (productiveRoots.length === 1) {
      const productiveRoot = productiveRoots[0];
      const productiveEvent = rootCompileEvents.find((event) =>
        event.candidates.some((candidate) =>
          candidate.selected && candidate.dependencyAttemptId === productiveRoot.attemptId));
      const earlierEvents = productiveEvent
        ? rootCompileEvents.filter((event) =>
          event.compileEventOrdinal < productiveEvent.compileEventOrdinal)
        : [];
      const earlierCandidates = [];
      for (const event of earlierEvents) {
        for (const candidate of event.candidates) {
          earlierCandidates.push({ ...candidate, _compileEventOrdinal: event.compileEventOrdinal });
        }
      }
      const positiveMarginCandidates = earlierCandidates.filter((candidate) =>
        candidate.semantic.attackMargin != null && candidate.semantic.attackMargin > 0);
      const sameAttemptCandidates = earlierCandidates.filter((candidate) =>
        candidate.dependencyAttemptId === productiveRoot.attemptId);
      const productiveCandidate = productiveEvent
        ? productiveEvent.candidates.find((candidate) =>
          candidate.selected && candidate.dependencyAttemptId === productiveRoot.attemptId)
        : null;
      const productiveIdentity = productiveCandidate ? productiveCandidate.identity : null;
      const boundaryIdentityMatch = (candidate) => productiveIdentity &&
        candidate.identity.floorId === productiveIdentity.floorId &&
        candidate.identity.enemyId === productiveIdentity.enemyId &&
        candidate.identity.x === productiveIdentity.x &&
        candidate.identity.y === productiveIdentity.y;
      const sameBoundaryIdentityCandidates = earlierCandidates.filter(boundaryIdentityMatch);
      const samePrerequisiteIdCandidates = earlierCandidates.filter((candidate) =>
        productiveCandidate != null && candidate.prerequisiteId === productiveCandidate.prerequisiteId);
      let verdict;
      if (sameAttemptCandidates.length > 0) {
        verdict = "PRODUCTIVE-ATTEMPT-APPEARED-EARLIER";
      } else if (positiveMarginCandidates.length > 0) {
        verdict = "POSITIVE-MARGIN-CANDIDATE-IN-EARLIER-POOL";
      } else {
        verdict = "NO-EARLIER-POSITIVE-ATTACK-MARGIN-OR-EXACT-ATTEMPT-EVIDENCE";
      }
      availability = {
        signalDefinition: {
          name: "positive-attack-margin",
          definition: "attackMargin > 0",
          note: "boundary/prerequisite identity counts are independent diagnostics and do not imply productivity",
        },
        productiveAttemptId: productiveRoot.attemptId,
        productiveEventOrdinal: productiveEvent ? productiveEvent.compileEventOrdinal : null,
        productiveEventExpansion: productiveEvent ? productiveEvent.expansionAtCompile : null,
        earlierEventCount: earlierEvents.length,
        earlierCandidateCount: earlierCandidates.length,
        positiveAttackMarginCandidateCount: positiveMarginCandidates.length,
        sameAttemptCandidateCount: sameAttemptCandidates.length,
        sameBoundaryIdentityCandidateCount: sameBoundaryIdentityCandidates.length,
        samePrerequisiteIdCandidateCount: samePrerequisiteIdCandidates.length,
        positiveAttackMarginCandidates: positiveMarginCandidates.slice(0, 8).map((candidate) => ({
          compileEventOrdinal: candidate._compileEventOrdinal,
          localRank: candidate.localRank,
          selected: candidate.selected,
          attemptId: candidate.dependencyAttemptId,
          attackMargin: candidate.semantic.attackMargin,
          damage: candidate.semantic.damage,
          enemyId: candidate.identity.enemyId,
          x: candidate.identity.x,
          y: candidate.identity.y,
        })),
        verdict,
      };
    }
    stats.rootAttemptSeparabilityAttribution = {
      schema: "motapathfinder.strategic-root-attempt-separability-attribution.v3",
      rootCompileEvents,
      rootCalls: rootAttemptSeparabilityCalls,
      chargedToSelectedCandidate,
      chargedEventSummaries,
      separability,
      availability,
    };
  }
  if (enableRootRetryNoveltyAttribution && rootAttemptSeparabilityCalls) {
    const originOpportunityMaterializations = new Map();
    const originResidualMaterializations = new Map();
    for (const witness of stats.survivalOpportunityWitnesses) {
      const attemptId = witness.originFailedAttemptId;
      if (!attemptId) continue;
      if (witness.materialized) {
        originOpportunityMaterializations.set(
          attemptId,
          number(originOpportunityMaterializations.get(attemptId), 0) + 1,
        );
      }
    }
    for (const recovery of stats.survivalOpportunityResidualRecoveries) {
      const attemptId = recovery.originFailedAttemptId;
      if (!attemptId) continue;
      if (recovery.materialized) {
        originResidualMaterializations.set(
          attemptId,
          number(originResidualMaterializations.get(attemptId), 0) + 1,
        );
      }
    }
    const directSatisfiedByAttempt = new Map();
    for (const witness of stats.battleAccessPrerequisiteWitnesses) {
      if (witness.status === "satisfied" && witness.attemptId != null) {
        directSatisfiedByAttempt.set(witness.attemptId, true);
      }
    }
    const labeledCalls = rootAttemptSeparabilityCalls.map((call) => {
      const directSatisfied = directSatisfiedByAttempt.has(call.attemptId);
      const derivedMaterializedProgress =
        number(originOpportunityMaterializations.get(call.attemptId), 0) +
        number(originResidualMaterializations.get(call.attemptId), 0);
      return {
        callOrdinal: call.callOrdinal,
        attemptId: call.attemptId,
        prerequisiteId: call.prerequisiteId,
        parentDependencyId: call.parentDependencyId,
        identity: call.identity,
        semantic: call.semantic,
        temporal: {
          firstHierarchyActivationOccurred: call.temporal.firstHierarchyActivationOccurred,
        },
        label: {
          directSatisfied,
          productive: directSatisfied || derivedMaterializedProgress > 0,
        },
      };
    });
    const retryAttribution = classifyPreHierarchyRootRetryNovelty(labeledCalls);
    const offlineVerdictResult = classifyRootRetryOfflineVerdict(
      retryAttribution.comparisons,
      labeledCalls.map((call) => ({
        callOrdinal: call.callOrdinal,
        productive: call.label.productive,
      })),
    );
    stats.rootRetryNoveltyAttribution = {
      schema: "motapathfinder.strategic-root-retry-novelty-attribution.v2",
      rootCallCount: retryAttribution.rootCallCount,
      repeatGroupCount: retryAttribution.repeatGroupCount,
      repeatGroups: retryAttribution.repeatGroups,
      preChargeComparisons: retryAttribution.comparisons,
      postSearchEvaluation: labeledCalls.map((call) => ({
        callOrdinal: call.callOrdinal,
        attemptId: call.attemptId,
        productive: call.label.productive,
        directSatisfied: call.label.directSatisfied,
      })),
      verdict: offlineVerdictResult.verdict,
      productiveFlaggedCallOrdinals: offlineVerdictResult.productiveFlaggedCallOrdinals,
      nonProductiveFlaggedCallOrdinals: offlineVerdictResult.nonProductiveFlaggedCallOrdinals,
      incompleteCallOrdinals: offlineVerdictResult.incompleteCallOrdinals,
      missingEvaluationCallOrdinals: offlineVerdictResult.missingEvaluationCallOrdinals,
    };
  }
  const frontierSize = agenda.activeSize(expanded);
  const activeLazyWork = lazyWork.activeSize();
  const strategicBudgetExhausted = !goalNode && stats.expansions >= maxExpansions &&
    (frontierSize > 0 || activeLazyWork > 0);
  const totalSearchBudgetExhausted = !goalNode && maxTotalSearchExpansions != null &&
    stats.totalSearchExpansions >= maxTotalSearchExpansions &&
    (frontierSize > 0 || activeLazyWork > 0);
  const budgetExhausted = strategicBudgetExhausted || totalSearchBudgetExhausted;
  function canonicalGraphReachability(anchorNodeId, targetFloor) {
    const adjacency = new Map();
    for (const edge of canonicalSuccessorEdges) {
      if (!adjacency.has(edge.fromNodeId)) adjacency.set(edge.fromNodeId, []);
      adjacency.get(edge.fromNodeId).push(edge);
    }
    const visited = new Set();
    const queue = [{ nodeId: anchorNodeId, depth: 0, path: [] }];
    const targetCandidateNodeIds = [];
    let shortestEdgeDepth = null;
    let shortestPathDispositionSummary = null;
    while (queue.length > 0) {
      const entry = queue.shift();
      if (visited.has(entry.nodeId)) continue;
      visited.add(entry.nodeId);
      const node = nodes.get(entry.nodeId);
      if (node && node.state && node.state.floorId === targetFloor) {
        targetCandidateNodeIds.push(entry.nodeId);
        if (shortestEdgeDepth == null) {
          shortestEdgeDepth = entry.depth;
          const counts = {};
          for (const edge of entry.path) {
            counts[edge.disposition] = (counts[edge.disposition] || 0) + 1;
          }
          shortestPathDispositionSummary = counts;
        }
      }
      for (const edge of adjacency.get(entry.nodeId) || []) {
        queue.push({
          nodeId: edge.targetNodeId,
          depth: entry.depth + 1,
          path: entry.path.concat([edge]),
        });
      }
    }
    return {
      canonicalGraphReachableTargetFloor: shortestEdgeDepth != null,
      canonicalGraphShortestEdgeDepth: shortestEdgeDepth,
      canonicalGraphTargetFloorCandidateNodeIds: targetCandidateNodeIds.slice(0, 32),
      canonicalGraphPathDispositionSummary: shortestPathDispositionSummary || {},
    };
  }

  function finalizeCanonicalSuccessorEdgeAttribution() {
    for (const continuation of parentContinuationRecords.values()) {
      const anchorNodeId = continuation.anchorNodeId;
      const targetFloor = dependencyTargetFloorId(continuation.parentDependency.target);
      const expansionOrdinal = nodeExpansionOrdinal.get(anchorNodeId) || null;
      const summary = nodeExpansionSummaries.get(anchorNodeId) || null;
      stats.canonicalSuccessorEdgeAttributions.push({
        continuationId: continuation.id,
        anchorNodeId,
        anchorCreatedAtExpansion: nodeCreatedAtExpansion.get(anchorNodeId) || null,
        anchorExpansionOrdinal: expansionOrdinal,
        anchorWasExpandedAtContinuationCreation: expansionOrdinal != null &&
          expansionOrdinal <= continuation.createdAtExpansion,
        anchorEverExpanded: expansionOrdinal != null,
        anchorExpandedBeforeContinuation: expansionOrdinal != null &&
          expansionOrdinal <= continuation.createdAtExpansion,
        anchorExpandedAfterContinuation: expansionOrdinal != null &&
          expansionOrdinal > continuation.createdAtExpansion,
        outgoing: summary,
        ...canonicalGraphReachability(anchorNodeId, targetFloor),
      });
    }
  }

  function finalizeParentContinuationTelemetry() {
    for (const continuation of parentContinuationRecords.values()) {
      const anchorNode = nodes.get(continuation.anchorNodeId);
      if (!anchorNode) continue;
      const targetFloor = dependencyTargetFloorId(continuation.parentDependency.target);
      const futureTargetFloorDescendants = lineageEligibleDescendants(
        anchorNode,
        targetFloor,
        { excludeAnchor: true },
      ).filter((node) => node.nodeId >= continuation.createdNextNodeId);
      continuation.futureDescendantsObservedAfterCreation = futureTargetFloorDescendants.length;
      continuation.priorityStillActiveAtSearchEnd = hierarchyPriority
        .activeContinuationIds()
        .includes(continuation.id);
      for (const witness of stats.parentDependencyContinuationWitnesses) {
        if (witness.continuationId !== continuation.id) continue;
        witness.futureDescendantsObservedAfterCreation =
          continuation.futureDescendantsObservedAfterCreation;
        witness.priorityStillActiveAtSearchEnd =
          continuation.priorityStillActiveAtSearchEnd;
      }
    }
  }
  finalizeParentContinuationTelemetry();
  finalizeCanonicalSuccessorEdgeAttribution();
  const frontierExhausted = !goalNode && frontierSize === 0;
  const deferredWorkRemaining = !goalNode && activeLazyWork > 0;
  let stoppedReason = "frontier-exhausted";
  if (goalNode) stoppedReason = "goal-found";
  else if (strategicBudgetExhausted && totalSearchBudgetExhausted) stoppedReason = "strategic-and-total-search-budget";
  else if (strategicBudgetExhausted) stoppedReason = "strategic-budget";
  else if (totalSearchBudgetExhausted) stoppedReason = "total-search-budget";
  else if (deferredWorkRemaining) stoppedReason = "deferred-work-remaining";
  const replay = goalNode
    ? buildStrictReplayEvidence(
        project,
        simulatorFactory,
        projectRoot,
        initialState,
        goalNode,
        nodes,
        stats,
      )
    : null;
  return {
    schema: SCHEMA,
    inputContract: {
      allowedInputs: ["tower", "route-free-current-state", "terminal-goal"],
      forbiddenInputs: [
        "route-fixture",
        "route-prefix",
        "intermediate-milestone",
        "authored-event-order",
        "authored-resource-threshold",
      ],
      knownRouteUsed: false,
    },
    controls: {
      maxExpansions,
      maxRuntimeMs: 0,
      actionSource: "complete-primitive-actions-before-legacy-heuristic-filter",
      supplementalActionKinds: {
        interactPickup: "enabled",
        floorFly: floorFlyMode === "lazy"
          ? "lazy-choice-level-resolution"
          : "deferred-from-minimal-D2-vertical-slice",
      },
      pruning: ["exact-state-merge-only"],
      agendaQueues: agenda.definitions.map((definition) => definition.id),
      optionMap: "base-2d-grid-plus-sparse-state-mutations",
      reachablePoi: "walk-reachability-adjacency-index-with-before-after-diff",
      transitionContract: {
        choiceAggregation: "path-independent-action-fingerprint",
        travelVariants: "kept-inside-transition-one-frontier-slot-per-choice",
        reachablePoiDiff: "newly-reachable-vs-no-longer-reachable-poi-diff",
        opportunityCost: "active-vs-implicit-consumption-plus-still-present-but-unreachable",
        terminalBlockerDelta: "terminal-battle-stage-and-progress-before-after",
        retentionRule: "goal-state > future-reachable-positive-options > terminal-blocker-progress > hp > fewer-mutations > deterministic-state-key",
      },
      lazyResolution: {
        enabled: enableLazyWork,
        deferredExactPosts: enableLazyWork ? "recoverable-via-lazy-queue" : "recorded-not-expanded",
        floorFly: floorFlyMode === "lazy" ? "lazy-choice-level-resolution" : "off",
        localDpConnector: enableConnector
          ? "enabled-bounded-local-primitive-connector"
          : "disabled",
      },
      connector: {
        enabled: enableConnector,
        mode: connectorMode,
        maxExpansions: connectorMaxExpansions,
        maxDepth: connectorMaxDepth,
        maxCalls: connectorMaxCalls,
        target: connectorMode === "battle-access-prerequisite"
          ? "battle-access-prerequisite-one-layer"
          : connectorMode === "dependency-derived"
            ? "dependency-compiled-discrete-prerequisite"
            : connectorMode === "blocker-derived"
              ? "blocker-derived-intermediate-optimizer"
              : "terminal-boss-choice-when-not-directly-enumerable",
        budgetScope: maxTotalSearchExpansions == null
          ? "connector-expansions-are-additional-to-strategic-frontier-expansions"
          : "shared-total-search-work-budget",
        maxTotalSearchExpansions,
        battleViabilityAttribution: connectorMode === "battle-access-prerequisite"
          ? enableBattleViabilityAttribution
            ? "observation-only-attack-blocked-lethal-viable"
            : "disabled"
          : null,
        parentDependencyContinuation: connectorMode === "battle-access-prerequisite"
          ? enableParentDependencyContinuation
            ? "intent-preservation-by-parent-dependency-id-plus-exact-state-key"
            : "disabled"
          : null,
        hierarchicalCallAllocation: connectorMode === "battle-access-prerequisite"
          ? enableHierarchicalCallAllocation
            ? "active-hierarchy-priority-with-feedback-release"
            : "disabled"
          : null,
        battleStagePrerequisiteDecomposition: connectorMode === "battle-access-prerequisite"
          ? enableBattleStagePrerequisiteDecomposition
            ? "continuation-derived-attack-blocked-to-damageable-only"
            : "disabled"
          : null,
        continuationAnchorExpansionScheduling: connectorMode === "battle-access-prerequisite"
          ? enableContinuationAnchorExpansionScheduling
            ? "one-shot-active-continuation-anchor-expansion-request"
            : "disabled"
          : null,
        lethalSurvivalAttribution: connectorMode === "battle-access-prerequisite"
          ? enableLethalSurvivalAttribution
            ? "observation-only-depth-two-lethal-child"
            : "disabled"
          : null,
        survivalEdgeAttribution: connectorMode === "battle-access-prerequisite"
          ? enableSurvivalEdgeAttribution
            ? "observation-only-generated-primitive-edge-causal-attribution"
            : "disabled"
          : null,
        survivalOpportunityPrerequisite: connectorMode === "battle-access-prerequisite"
          ? enableSurvivalOpportunityPrerequisite
            ? "witness-backed-first-positive-named-opportunity"
            : "disabled"
          : null,
        dependencyConnector: connectorMode === "dependency-derived" ? {
          maxCalls: dependencyConnectorMaxCalls,
          maxCandidatesPerNode: dependencyConnectorMaxCandidatesPerNode,
          maxOutstandingAttempts: dependencyAttemptMaxOutstanding,
          scheduling: "feedback-aware-one-outstanding-attempt",
          vocabulary: ["equipment-acquisition", "resource/power-opportunity-acquisition"],
          successCondition: "dependency-completionPredicate-only-not-scalar-optimization",
          accessAttribution: enableDependencyAccessAttribution
            ? "observation-only-best-approach-and-boundary"
            : "disabled",
        } : null,
      },
      completenessLimitations: [
        "exact-state-merge-only-no-dominance",
        "connector-is-bounded-local-search-not-canonical-correctness-proof",
        "lazy-resolution-is-demand-driven-not-exhaustive",
      ],
    },
    outcome: {
      goalFound: Boolean(goalNode),
      frontierExhausted,
      strategicBudgetExhausted,
      totalSearchBudgetExhausted,
      budgetExhausted,
      stoppedReason,
      deferredWorkRemaining,
      searchComplete: Boolean(goalNode || (frontierExhausted && !deferredWorkRemaining)),
      firstGoalExpansion,
      frontierSize,
      wallMs: Date.now() - startedAt,
    },
    stats,
    bestTerminalBlocker: {
      progressScore: bestTerminalBlocker.progressScore,
      attackMargin: bestTerminalBlocker.attackMargin,
      stage: bestTerminalBlocker.stage,
      nodeId: bestTerminalBlocker.nodeId,
    },
    lazyWork: lazyWork.snapshot(),
    frontierWitnesses: agenda.definitions.map((definition) =>
      compactWitness(
        simulator,
        terminalGoal,
        nodes,
        bestByRole.get(definition.id),
        definition.id,
      )),
    best: goalNode ? {
      nodeId: goalNode.nodeId,
      exactStateFingerprint: hash(goalNode.stateKey),
      strategicDecisionCount: reconstructActionEntries(nodes, goalNode).length,
      hero: { ...(goalNode.state.hero || {}) },
      optionCounts: goalNode.optionMap.counts,
      incomingTransition: goalNode.strategicTransition ? compactWitness(
        simulator,
        terminalGoal,
        nodes,
        goalNode,
        "best",
      ).incomingTransition : null,
    } : null,
    replay: replay ? {
      valid: replay.valid,
      stepsAttempted: replay.stepsAttempted,
      stepsCompleted: replay.stepsCompleted,
      failureReason: replay.failureReason,
      routeFingerprint: hash(JSON.stringify(replay.routeRecord.decisions.map((decision) => decision.summary))),
    } : null,
    routeRecord: replay && replay.routeRecord,
    verdict: goalNode && replay && replay.valid
      ? "D2_STRATEGIC_SEARCH_STRICT_REPLAY_VERIFIED"
      : goalNode
        ? "D2_STRATEGIC_SEARCH_REPLAY_FAILED"
        : budgetExhausted
          ? "D2_STRATEGIC_SEARCH_INCOMPLETE_WITHIN_BUDGET"
          : deferredWorkRemaining
            ? "D2_STRATEGIC_SEARCH_INCOMPLETE_WITH_DEFERRED_WORK"
          : "D2_STRATEGIC_SEARCH_FRONTIER_EXHAUSTED",
  };
}

module.exports = {
  buildRootAttemptSemanticVector,
  classifyPreHierarchyRootRetryNovelty,
  classifyRootAttemptSeparability,
  classifyRootRetryOfflineVerdict,
  enumerateStrategicActions,
  runStrategicD2Search,
};
