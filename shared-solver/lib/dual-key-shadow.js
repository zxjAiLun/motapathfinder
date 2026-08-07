"use strict";

/**
 * PR-5.4c Commit 2 Repair — Dual-Key Registry Shadow (observation only).
 *
 * Corrected accounting:
 *   1. Candidate keys are computed INDEPENDENTLY for every recorder state
 *      (no exactDpKey -> candidateKey semantic cache in the gate; a dev-only
 *      postPassExactKeyReuseHits counter exists but is never used for the
 *      promotion model).
 *   2. Equivalent collisions are rejected (shadowRejectEquivalent) and NOT
 *      registered; decision-matrix semantics agree with bucket occupancy.
 *   3. Event decisions (accepted/rejected/replace/unsafe) are split from final
 *      registry occupancy (final active states vs unique keys).
 *   4. hypotheticalStateDelta allows negative values (candidate may hold more).
 *   5. Key cost is measured independently over ALL recorder states; the
 *      production buildDpStateKey phase comes from the canonical perf tracker,
 *      and any estimate is labelled "shadow estimate, not production speedup".
 */

const { performance } = require("node:perf_hooks");
const { fingerprintJson } = require("./solve-task");
const { exactStateFingerprint } = require("./solver-job");
const { buildDpStateKey } = require("./dp-search");
const {
  buildCandidateDpKey,
  buildCandidateProjection,
  buildStateBehavior,
  classifyPair,
} = require("./key-dependency-corpus");

function heroHp(state) {
  return Number(state && state.hero && state.hero.hp || 0);
}

// Field-level difference between two candidate projections.
function diffCandidateProjections(left, right) {
  const differing = { structuralCandidate: [], resourceIdentity: [], eventHazardLabel: [] };
  const diffKeys = (a, b, out) => {
    const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
    keys.forEach((key) => {
      const av = a ? a[key] : undefined;
      const bv = b ? b[key] : undefined;
      if (JSON.stringify(av) !== JSON.stringify(bv)) out.push(key);
    });
  };
  diffKeys(left.structuralCandidate, right.structuralCandidate, differing.structuralCandidate);
  diffKeys(left.resourceIdentity, right.resourceIdentity, differing.resourceIdentity);
  diffKeys(left.eventHazardLabel, right.eventHazardLabel, differing.eventHazardLabel);
  return differing;
}

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil((p / 100) * sortedValues.length) - 1));
  return sortedValues[index];
}

function createDualKeyShadow(options) {
  const config = options || {};
  const simulator = config.simulator;
  const project = config.project;
  const ir = config.ir;
  const goalPredicate = config.goalPredicate || null;
  const failOnUnsafe = config.failOnUnsafeForContract === true;
  const maxWitnesses = Number(config.maxWitnesses || 20);
  // Dev-only cache mode; the representative gate MUST use "off".
  const candidateCacheMode = String(config.candidateCacheMode || "off");

  const diagnostics = {
    enabled: true,
    statesRecorded: 0,
    productionAcceptedEvents: 0,
    productionRejectedEvents: 0,
    candidateAcceptedEvents: 0,
    candidateRejectedDominatedEvents: 0,
    candidateRejectedEquivalentEvents: 0,
    candidateReplaceEvents: 0,
    candidateUnsafeEvents: 0,
    productionAcceptedCandidateAccepted: 0,
    productionAcceptedCandidateRejected: 0,
    productionRejectedCandidateAccepted: 0,
    productionRejectedCandidateRejected: 0,
    shadowKeep: 0,
    shadowRejectDominated: 0,
    shadowRejectEquivalent: 0,
    shadowReplaceDominated: 0,
    shadowUnsafeMerge: 0,
    shadowAnalysisError: 0,
    shadowUnclassified: 0,
    collisions: 0,
    candidateKeyBuildCalls: 0,
    candidateKeyTotalMs: 0,
    candidateKeySampleMs: [],
    postPassExactKeyReuseHits: 0,
    exactKeysWithMultipleCandidateKeys: 0,
    maxCandidateKeysPerExactKey: 0,
  };

  // Shared behavior cache across shadows/profiles avoids recomputing per-state
  // behavior (actions/successors) for every profile evaluation.
  const behaviorCache = config.behaviorCache || new Map(); // stateFingerprint -> behavior entry
  const buckets = new Map(); // candidateKey -> [ { state, behavior, hp, fromProductionAccepted } ]
  // Partition audit: exact key -> Set<candidateKey> and the reverse.
  const exactKeyToCandidateKeys = new Map(); // exactKey -> Set<candidateKey>
  const candidateKeyToExactKeys = new Map(); // candidateKey -> Set<exactKey>
  const recordsByExactKey = new Map(); // exactKey -> [record]
  const recordsByCandidateKey = new Map(); // candidateKey -> [record]
  const splitWitnesses = [];
  const mergeWitnesses = [];
  const productionAcceptedExactKeys = new Set();
  const unsafeWitnesses = [];
  const analysisErrorWitnesses = [];
  let productionFinalActiveStates = null;
  let productionFinalUniqueKeys = null;

  function buildCandidateKeyForState(state) {
    const started = performance.now();
    const candidateKey = typeof config.candidateKeyBuilder === "function"
      ? config.candidateKeyBuilder(state)
      : buildCandidateDpKey(simulator, project, ir, state, { goalPredicate, profile: config.profile });
    diagnostics.candidateKeyTotalMs += performance.now() - started;
    diagnostics.candidateKeyBuildCalls += 1;
    diagnostics.candidateKeySampleMs.push(performance.now() - started);
    return candidateKey;
  }

  function getBehavior(state) {
    const stateFingerprint = exactStateFingerprint(state);
    if (!behaviorCache.has(stateFingerprint)) {
      const builder = typeof config.behaviorBuilder === "function"
        ? config.behaviorBuilder
        : (s) => buildStateBehavior(simulator, project, ir, s, { goalPredicate });
      behaviorCache.set(stateFingerprint, builder(state));
    }
    return behaviorCache.get(stateFingerprint);
  }

  function recordDecision(productionAccepted, candidateAccepted, record) {
    if (productionAccepted && candidateAccepted) diagnostics.productionAcceptedCandidateAccepted += 1;
    else if (productionAccepted && !candidateAccepted) diagnostics.productionAcceptedCandidateRejected += 1;
    else if (!productionAccepted && candidateAccepted) diagnostics.productionRejectedCandidateAccepted += 1;
    else diagnostics.productionRejectedCandidateRejected += 1;
  }

  function pushFailWitness(result, record, label) {
    const witness = {
      classification: label,
      candidateKey: record.candidateKey,
      exactDpKey: record.exactDpKey,
      productionDecision: record.productionDecision,
      stateHp: heroHp(record.state),
      loc: `${record.state.hero.loc.x},${record.state.hero.loc.y}`,
      reason: result.reason || null,
      analysisErrors: (result.analysisErrors || []).slice(0, 4),
      unmatchedLowVariants: (result.unmatchedLowVariants || []).slice(0, 4),
      actionOnlyLow: (result.actionOnlyLow || []).slice(0, 4),
      actionOnlyHigh: (result.actionOnlyHigh || []).slice(0, 4),
      terminalDiffs: (result.terminalDiffs || []).slice(0, 4),
    };
    if (label === "shadowUnsafeMerge") {
      if (unsafeWitnesses.length < maxWitnesses) unsafeWitnesses.push(witness);
    } else if (analysisErrorWitnesses.length < maxWitnesses) {
      analysisErrorWitnesses.push(witness);
    }
    return witness;
  }

  function registerRecord(record) {
    diagnostics.statesRecorded += 1;
    const state = record.state;
    const exactDpKey = record.exactDpKey;
    const productionAccepted = record.productionDecision !== "reject";
    if (productionAccepted) {
      diagnostics.productionAcceptedEvents += 1;
      productionAcceptedExactKeys.add(exactDpKey);
    } else {
      diagnostics.productionRejectedEvents += 1;
    }

    // Independent candidate key build for EVERY recorder state (gate mode off).
    let candidateKey;
    if (candidateCacheMode === "off") {
      candidateKey = buildCandidateKeyForState(state);
    } else {
      if (exactKeyToCandidateKeys.has(exactDpKey)) {
        diagnostics.postPassExactKeyReuseHits += 1;
        candidateKey = Array.from(exactKeyToCandidateKeys.get(exactDpKey))[0];
      } else {
        candidateKey = buildCandidateKeyForState(state);
      }
    }
    record.candidateKey = candidateKey;
    record.candidateProjection = config.candidateKeyBuilder
      ? null
      : buildCandidateProjection(simulator, project, ir, state, { goalPredicate, profile: config.profile });

    // Partition audit: exactKey -> Set<candidateKey> and reverse.
    if (!exactKeyToCandidateKeys.has(exactDpKey)) {
      exactKeyToCandidateKeys.set(exactDpKey, new Set());
      recordsByExactKey.set(exactDpKey, []);
    }
    exactKeyToCandidateKeys.get(exactDpKey).add(candidateKey);
    recordsByExactKey.get(exactDpKey).push(record);
    if (!candidateKeyToExactKeys.has(candidateKey)) {
      candidateKeyToExactKeys.set(candidateKey, new Set());
      recordsByCandidateKey.set(candidateKey, []);
    }
    candidateKeyToExactKeys.get(candidateKey).add(exactDpKey);
    recordsByCandidateKey.get(candidateKey).push(record);

    const bucket = buckets.get(candidateKey);
    if (!bucket || bucket.length === 0) {
      buckets.set(candidateKey, [{ state, behavior: null, hp: heroHp(state), fromProductionAccepted: productionAccepted }]);
      diagnostics.shadowKeep += 1;
      diagnostics.candidateAcceptedEvents += 1;
      recordDecision(productionAccepted, true, record);
      return;
    }

    diagnostics.collisions += 1;
    const newBehavior = getBehavior(state);
    const newEntry = { state, behavior: newBehavior, hp: heroHp(state), fromProductionAccepted: productionAccepted };
    let dominated = false;
    let replaces = false;
    let equivalent = false;
    let unsafe = null;
    let analysisError = null;
    let unclassified = null;
    for (const member of bucket) {
      const memberBehavior = member.behavior || getBehavior(member.state);
      member.behavior = memberBehavior;
      const result = classifyPair(memberBehavior, newBehavior);
      if (result.classification === "analysis-error") { analysisError = result; break; }
      if (result.classification === "unclassified") { unclassified = result; }
      if (result.classification === "unsafe") { unsafe = result; break; }
      if (result.classification === "equivalent") { equivalent = true; break; }
      if (result.classification === "dominance-safe") {
        if (member.hp >= newEntry.hp) dominated = true;
        else replaces = true;
      }
    }

    if (unsafe) {
      diagnostics.shadowUnsafeMerge += 1;
      diagnostics.candidateUnsafeEvents += 1;
      pushFailWitness(unsafe, record, "shadowUnsafeMerge");
      if (failOnUnsafe) throw new Error(`candidate key shadow unsafe merge: ${unsafe.reason || ""}`);
      recordDecision(productionAccepted, false, record);
      return;
    }
    if (analysisError) {
      diagnostics.shadowAnalysisError += 1;
      pushFailWitness(analysisError, record, "shadowAnalysisError");
      if (failOnUnsafe) throw new Error(`candidate key shadow analysis error: ${analysisError.reason || ""}`);
      recordDecision(productionAccepted, false, record);
      return;
    }
    if (unclassified) {
      diagnostics.shadowUnclassified += 1;
      pushFailWitness(unclassified, record, "shadowUnclassified");
      if (failOnUnsafe) throw new Error(`candidate key shadow unclassified: ${unclassified.reason || ""}`);
      recordDecision(productionAccepted, false, record);
      return;
    }
    if (equivalent) {
      // Equivalent collision: rejected, NOT registered (matrix agrees).
      diagnostics.shadowRejectEquivalent += 1;
      diagnostics.candidateRejectedEquivalentEvents += 1;
      recordDecision(productionAccepted, false, record);
      return;
    }
    if (dominated) {
      diagnostics.shadowRejectDominated += 1;
      diagnostics.candidateRejectedDominatedEvents += 1;
      recordDecision(productionAccepted, false, record);
      return;
    }
    if (replaces) {
      diagnostics.shadowReplaceDominated += 1;
      diagnostics.candidateReplaceEvents += 1;
      diagnostics.candidateAcceptedEvents += 1;
      buckets.set(candidateKey, [newEntry]);
      recordDecision(productionAccepted, true, record);
      return;
    }
    // Neither dominated nor dominating: a distinct state in the bucket.
    diagnostics.shadowKeep += 1;
    diagnostics.candidateAcceptedEvents += 1;
    bucket.push(newEntry);
    recordDecision(productionAccepted, true, record);
  }

  function setProductionRegistry(registry) {
    if (registry) {
      productionFinalActiveStates = registry.finalActiveStates;
      productionFinalUniqueKeys = registry.finalUniqueKeys;
    }
  }

  function snapshot() {
    const candidateFinalActiveStates = Array.from(buckets.values()).reduce((sum, bucket) => sum + bucket.length, 0);
    const candidateFinalUniqueKeys = buckets.size;
    const candidateFinalStatesFromProductionAccepted = Array.from(buckets.values())
      .reduce((sum, bucket) => sum + bucket.filter((entry) => entry.fromProductionAccepted).length, 0);
    const candidateFinalStatesFromProductionRejected = candidateFinalActiveStates - candidateFinalStatesFromProductionAccepted;
    const sortedSamples = diagnostics.candidateKeySampleMs.slice().sort((a, b) => a - b);
    const candidateKeyAvgMs = diagnostics.candidateKeyBuildCalls > 0
      ? diagnostics.candidateKeyTotalMs / diagnostics.candidateKeyBuildCalls
      : 0;
    const candidateKeyMedianMs = percentile(sortedSamples, 50);
    const candidateKeyP95Ms = percentile(sortedSamples, 95);

    // Partition audit metrics.
    const uniqueExactKeys = exactKeyToCandidateKeys.size;
    const uniqueCandidateKeys = candidateKeyToExactKeys.size;
    let splitExactKeyCount = 0;
    let splitExtraCandidateKeyCount = 0;
    let maxCandidateKeysPerExactKey = 0;
    exactKeyToCandidateKeys.forEach((candidateSet) => {
      const size = candidateSet.size;
      if (size > 1) {
        splitExactKeyCount += 1;
        splitExtraCandidateKeyCount += size - 1;
      }
      maxCandidateKeysPerExactKey = Math.max(maxCandidateKeysPerExactKey, size);
    });
    let mergedCandidateKeyCount = 0;
    let mergedExtraExactKeyCount = 0;
    let maxExactKeysPerCandidateKey = 0;
    candidateKeyToExactKeys.forEach((exactSet) => {
      const size = exactSet.size;
      if (size > 1) {
        mergedCandidateKeyCount += 1;
        mergedExtraExactKeyCount += size - 1;
      }
      maxExactKeysPerCandidateKey = Math.max(maxExactKeysPerCandidateKey, size);
    });
    let partitionRelation = "equal";
    if (splitExactKeyCount > 0 && mergedCandidateKeyCount > 0) partitionRelation = "non-comparable";
    else if (splitExactKeyCount > 0) partitionRelation = "strict-refinement";
    else if (mergedCandidateKeyCount > 0) partitionRelation = "strict-coarsening";

    // Split field distribution: aggregate over ALL split exact keys (not just
    // the witness sample), classifying each into only-start-component or other.
    const splitFieldDistribution = {};
    let splitExactKeysOnlyStartComponent = 0;
    let splitExactKeysWithOtherDifferences = 0;
    exactKeyToCandidateKeys.forEach((candidateSet, exactDpKey) => {
      if (candidateSet.size <= 1) return;
      const records = recordsByExactKey.get(exactDpKey) || [];
      const byCandidate = new Map();
      records.forEach((record) => {
        if (!byCandidate.has(record.candidateKey)) byCandidate.set(record.candidateKey, record);
      });
      const candidateKeys = Array.from(candidateSet);
      const first = byCandidate.get(candidateKeys[0]);
      const second = byCandidate.get(candidateKeys[1]);
      if (!first || !second || !first.candidateProjection || !second.candidateProjection) return;
      const differing = diffCandidateProjections(first.candidateProjection, second.candidateProjection);
      const flatFields = [];
      Object.keys(differing).forEach((group) => {
        (differing[group] || []).forEach((field) => {
          const fullField = group === "eventHazardLabel" ? group : `${group}.${field}`;
          flatFields.push(fullField);
          splitFieldDistribution[fullField] = (splitFieldDistribution[fullField] || 0) + 1;
        });
      });
      const onlyStartComponent = flatFields.length === 1 && flatFields[0] === "structuralCandidate.startComponentId";
      if (onlyStartComponent) splitExactKeysOnlyStartComponent += 1;
      else splitExactKeysWithOtherDifferences += 1;
    });

    // Split / merge witnesses (field-level, capped).
    if (splitWitnesses.length === 0) {
      exactKeyToCandidateKeys.forEach((candidateSet, exactDpKey) => {
        if (candidateSet.size <= 1) return;
        const records = recordsByExactKey.get(exactDpKey) || [];
        const byCandidate = new Map();
        records.forEach((record) => {
          if (!byCandidate.has(record.candidateKey)) byCandidate.set(record.candidateKey, record);
        });
        const candidateKeys = Array.from(candidateSet);
        const first = byCandidate.get(candidateKeys[0]);
        const second = byCandidate.get(candidateKeys[1]);
        if (first && second && first.candidateProjection && second.candidateProjection) {
          splitWitnesses.push({
            exactDpKey,
            candidateKeys,
            differingProjectionFields: diffCandidateProjections(first.candidateProjection, second.candidateProjection),
            stateA: { hp: heroHp(first.state), loc: `${first.state.hero.loc.x},${first.state.hero.loc.y}`, triggeredAutoEvents: first.state.triggeredAutoEvents },
            stateB: { hp: heroHp(second.state), loc: `${second.state.hero.loc.x},${second.state.hero.loc.y}`, triggeredAutoEvents: second.state.triggeredAutoEvents },
          });
        }
      });
    }
    if (mergeWitnesses.length === 0) {
      candidateKeyToExactKeys.forEach((exactSet, candidateKey) => {
        if (exactSet.size <= 1) return;
        const records = recordsByCandidateKey.get(candidateKey) || [];
        const byExact = new Map();
        records.forEach((record) => {
          if (!byExact.has(record.exactDpKey)) byExact.set(record.exactDpKey, record);
        });
        const exactKeys = Array.from(exactSet);
        const first = byExact.get(exactKeys[0]);
        const second = byExact.get(exactKeys[1]);
        if (first && second) {
          mergeWitnesses.push({
            candidateKey,
            exactKeys: exactKeys.slice(0, 4),
            stateA: { hp: heroHp(first.state), loc: `${first.state.hero.loc.x},${first.state.hero.loc.y}` },
            stateB: { hp: heroHp(second.state), loc: `${second.state.hero.loc.x},${second.state.hero.loc.y}` },
          });
        }
      });
    }

    const hypotheticalStateDelta = productionFinalActiveStates != null
      ? productionFinalActiveStates - candidateFinalActiveStates
      : null;
    const uniqueKeyDelta = productionFinalUniqueKeys != null
      ? productionFinalUniqueKeys - candidateFinalUniqueKeys
      : null;

    return {
      enabled: diagnostics.enabled,
      statesRecorded: diagnostics.statesRecorded,
      candidateKeyBuildCalls: diagnostics.candidateKeyBuildCalls,
      postPassExactKeyReuseHits: diagnostics.postPassExactKeyReuseHits,
      profile: config.profile || "current-full",
      partitionAudit: {
        uniqueExactKeys,
        uniqueCandidateKeys,
        splitExactKeyCount,
        splitExtraCandidateKeyCount,
        maxCandidateKeysPerExactKey,
        mergedCandidateKeyCount,
        mergedExtraExactKeyCount,
        maxExactKeysPerCandidateKey,
        partitionRelation,
        splitFieldDistribution,
        splitExactKeysOnlyStartComponent,
        splitExactKeysWithOtherDifferences,
        splitWitnesses: splitWitnesses.slice(0, (config.maxWitnesses || 20)),
        mergeWitnesses: mergeWitnesses.slice(0, (config.maxWitnesses || 20)),
      },
      productionAcceptedEvents: diagnostics.productionAcceptedEvents,
      productionRejectedEvents: diagnostics.productionRejectedEvents,
      candidateAcceptedEvents: diagnostics.candidateAcceptedEvents,
      candidateRejectedDominatedEvents: diagnostics.candidateRejectedDominatedEvents,
      candidateRejectedEquivalentEvents: diagnostics.candidateRejectedEquivalentEvents,
      candidateReplaceEvents: diagnostics.candidateReplaceEvents,
      candidateUnsafeEvents: diagnostics.candidateUnsafeEvents,
      productionFinalActiveStates,
      candidateFinalActiveStates,
      hypotheticalStateDelta,
      productionFinalUniqueKeys,
      candidateFinalUniqueKeys,
      uniqueKeyDelta,
      candidateFinalStatesFromProductionAccepted,
      candidateFinalStatesFromProductionRejected,
      productionAcceptedCandidateAccepted: diagnostics.productionAcceptedCandidateAccepted,
      productionAcceptedCandidateRejected: diagnostics.productionAcceptedCandidateRejected,
      productionRejectedCandidateAccepted: diagnostics.productionRejectedCandidateAccepted,
      productionRejectedCandidateRejected: diagnostics.productionRejectedCandidateRejected,
      shadowKeep: diagnostics.shadowKeep,
      shadowRejectDominated: diagnostics.shadowRejectDominated,
      shadowRejectEquivalent: diagnostics.shadowRejectEquivalent,
      shadowReplaceDominated: diagnostics.shadowReplaceDominated,
      shadowUnsafeMerge: diagnostics.shadowUnsafeMerge,
      shadowAnalysisError: diagnostics.shadowAnalysisError,
      shadowUnclassified: diagnostics.shadowUnclassified,
      collisions: diagnostics.collisions,
      candidateKeyTotalMs: Number(diagnostics.candidateKeyTotalMs.toFixed(2)),
      candidateKeyAvgMs: Number(candidateKeyAvgMs.toFixed(3)),
      candidateKeyMedianMs: Number(candidateKeyMedianMs.toFixed(3)),
      candidateKeyP95Ms: Number(candidateKeyP95Ms.toFixed(3)),
      unsafeWitnesses: unsafeWitnesses.slice(0, maxWitnesses),
      analysisErrorWitnesses: analysisErrorWitnesses.slice(0, maxWitnesses),
    };
  }

  return { registerRecord, setProductionRegistry, snapshot };
}

module.exports = {
  createDualKeyShadow,
  diffCandidateProjections,
  heroHp,
};
