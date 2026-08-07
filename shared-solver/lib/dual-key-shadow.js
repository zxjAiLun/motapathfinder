"use strict";

/**
 * PR-5.4c Commit 2 — Dual-Key Registry Shadow (observation only).
 *
 * In canonical searchDP, the production exact-key registry is the sole
 * decision maker.  This module observes, per registered state, what WOULD
 * happen if the candidate key (TowerIR StructuralKey + ResourceIdentity +
 * EventHazardLabel, HP as dominance only) were used instead:
 *
 *   - candidate key buckets (simulating the candidate registry)
 *   - dominance-safe classification reusing the Commit 1 classifier over
 *     COMPLETE travel variant sets
 *   - shadow keep / reject-dominated / replace-dominated / collision / unsafe /
 *     analysis-error decisions
 *   - decision disagreement with production (especially
 *     production-kept-but-shadow-would-reject, the potential reduction source)
 *
 * Unsafe / analysis-error / unclassified are fail-visible: diagnostics++
 * witness saved, production continues unchanged.  The contract mode
 * failOnUnsafeForContract throws instead so contracts can assert.
 */

const { performance } = require("node:perf_hooks");
const { fingerprintJson } = require("./solve-task");
const { exactStateFingerprint } = require("./solver-job");
const { buildDpStateKey } = require("./dp-search");
const {
  buildCandidateDpKey,
  buildStateBehavior,
  classifyPair,
} = require("./key-dependency-corpus");

function heroHp(state) {
  return Number(state && state.hero && state.hero.hp || 0);
}

function createDualKeyShadow(options) {
  const config = options || {};
  const simulator = config.simulator;
  const project = config.project;
  const ir = config.ir;
  const goalPredicate = config.goalPredicate || null;
  const failOnUnsafe = config.failOnUnsafeForContract === true;
  const maxWitnesses = Number(config.maxWitnesses || 20);

  const diagnostics = {
    enabled: true,
    statesRecorded: 0,
    productionRegistered: 0,
    productionRejected: 0,
    productionUniqueKeys: 0,
    candidateUniqueKeys: 0,
    shadowWouldRegister: 0,
    productionKeptShadowKept: 0,
    productionKeptShadowRejected: 0,
    productionRejectedShadowKept: 0,
    productionRejectedShadowRejected: 0,
    shadowKeep: 0,
    shadowRejectDominated: 0,
    shadowReplaceDominated: 0,
    shadowCollision: 0,
    shadowUnsafeMerge: 0,
    shadowAnalysisError: 0,
    shadowUnclassified: 0,
    collisions: 0,
    candidateKeyBuildMs: 0,
    candidateKeyBuildCount: 0,
    candidateKeyCacheHits: 0,
    candidateKeyCacheMisses: 0,
    productionKeyBuildMs: 0,
    productionKeyBuildCount: 0,
  };

  const candidateKeyCache = new Map(); // exactDpKey -> candidateKey
  const behaviorCache = new Map(); // stateFingerprint -> behavior entry
  const buckets = new Map(); // candidateKey -> [ { state, behavior, hp } ]
  const productionKeptExactKeys = new Set();
  const productionKeptShadowRejectedWitnesses = [];
  const unsafeWitnesses = [];
  const analysisErrorWitnesses = [];

  function buildCandidateKey(exactDpKey, state) {
    if (candidateKeyCache.has(exactDpKey)) {
      diagnostics.candidateKeyCacheHits += 1;
      return candidateKeyCache.get(exactDpKey);
    }
    diagnostics.candidateKeyCacheMisses += 1;
    const started = performance.now();
    const candidateKey = typeof config.candidateKeyBuilder === "function"
      ? config.candidateKeyBuilder(state)
      : buildCandidateDpKey(simulator, project, ir, state, { goalPredicate });
    diagnostics.candidateKeyBuildMs += performance.now() - started;
    diagnostics.candidateKeyBuildCount += 1;
    candidateKeyCache.set(exactDpKey, candidateKey);
    // Reference production key build cost for comparison (region mode walk).
    const productionStarted = performance.now();
    buildDpStateKey(simulator, state, { dpKeyMode: "region", solverModel: config.solverModel, model: config.model });
    diagnostics.productionKeyBuildMs += performance.now() - productionStarted;
    diagnostics.productionKeyBuildCount += 1;
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

  function recordDisagreement(productionKept, shadowWouldRegisterThisRecord, record, shadowDecision) {
    if (productionKept && shadowWouldRegisterThisRecord) diagnostics.productionKeptShadowKept += 1;
    else if (productionKept && !shadowWouldRegisterThisRecord) {
      diagnostics.productionKeptShadowRejected += 1;
      if (productionKeptShadowRejectedWitnesses.length < maxWitnesses) {
        productionKeptShadowRejectedWitnesses.push({
          exactDpKey: record.exactDpKey,
          candidateKey: record.candidateKey,
          productionDecision: record.productionDecision,
          shadowDecision,
          hp: heroHp(record.state),
          loc: `${record.state.hero.loc.x},${record.state.hero.loc.y}`,
        });
      }
    } else if (!productionKept && shadowWouldRegisterThisRecord) diagnostics.productionRejectedShadowKept += 1;
    else diagnostics.productionRejectedShadowRejected += 1;
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
    const productionKept = record.productionDecision !== "reject";
    if (productionKept) {
      diagnostics.productionRegistered += 1;
      productionKeptExactKeys.add(exactDpKey);
    } else {
      diagnostics.productionRejected += 1;
    }

    const candidateKey = buildCandidateKey(exactDpKey, state);
    record.candidateKey = candidateKey;

    const bucket = buckets.get(candidateKey);
    if (!bucket || bucket.length === 0) {
      buckets.set(candidateKey, [{ state, behavior: null, hp: heroHp(state) }]);
      diagnostics.shadowKeep += 1;
      diagnostics.shadowWouldRegister += 1;
      recordDisagreement(productionKept, true, record, "shadowKeep");
      return;
    }

    // Collision: classify the new state against the bucket (complete variant
    // sets, dominance-aware).
    diagnostics.collisions += 1;
    const newBehavior = getBehavior(state);
    const newEntry = { state, behavior: newBehavior, hp: heroHp(state) };
    let dominated = false;
    let replaces = false;
    let collision = false;
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
      if (result.classification === "equivalent") { collision = true; break; }
      if (result.classification === "dominance-safe") {
        if (member.hp >= newEntry.hp) dominated = true;
        else replaces = true;
      }
    }

    if (unsafe) {
      diagnostics.shadowUnsafeMerge += 1;
      pushFailWitness(unsafe, record, "shadowUnsafeMerge");
      if (failOnUnsafe) throw new Error(`candidate key shadow unsafe merge: ${unsafe.reason || ""}`);
      diagnostics.shadowWouldRegister += 1;
      recordDisagreement(productionKept, true, record, "shadowUnsafeMerge");
      return;
    }
    if (analysisError) {
      diagnostics.shadowAnalysisError += 1;
      pushFailWitness(analysisError, record, "shadowAnalysisError");
      if (failOnUnsafe) throw new Error(`candidate key shadow analysis error: ${analysisError.reason || ""}`);
      diagnostics.shadowWouldRegister += 1;
      recordDisagreement(productionKept, true, record, "shadowAnalysisError");
      return;
    }
    if (unclassified) {
      diagnostics.shadowUnclassified += 1;
      pushFailWitness(unclassified, record, "shadowUnclassified");
      if (failOnUnsafe) throw new Error(`candidate key shadow unclassified: ${unclassified.reason || ""}`);
      diagnostics.shadowWouldRegister += 1;
      recordDisagreement(productionKept, true, record, "shadowUnclassified");
      return;
    }
    if (dominated) {
      diagnostics.shadowRejectDominated += 1;
      recordDisagreement(productionKept, false, record, "shadowRejectDominated");
      return;
    }
    if (collision) {
      diagnostics.shadowCollision += 1;
      diagnostics.shadowWouldRegister += 1;
      recordDisagreement(productionKept, true, record, "shadowCollision");
      return;
    }
    if (replaces) {
      diagnostics.shadowReplaceDominated += 1;
      diagnostics.shadowWouldRegister += 1;
      buckets.set(candidateKey, [newEntry]);
      recordDisagreement(productionKept, true, record, "shadowReplaceDominated");
      return;
    }
    // Neither dominated nor dominating: a distinct state in the bucket.
    diagnostics.shadowKeep += 1;
    diagnostics.shadowWouldRegister += 1;
    bucket.push(newEntry);
    recordDisagreement(productionKept, true, record, "shadowKeep");
  }

  function snapshot() {
    const shadowWouldRegister = Array.from(buckets.values()).reduce((sum, bucket) => sum + bucket.length, 0);
    return {
      enabled: diagnostics.enabled,
      statesRecorded: diagnostics.statesRecorded,
      productionRegistered: diagnostics.productionRegistered,
      productionRejected: diagnostics.productionRejected,
      productionUniqueKeys: productionKeptExactKeys.size,
      candidateUniqueKeys: buckets.size,
      shadowWouldRegister,
      hypotheticalReduction: Math.max(0, productionKeptExactKeys.size - shadowWouldRegister),
      productionKeptShadowKept: diagnostics.productionKeptShadowKept,
      productionKeptShadowRejected: diagnostics.productionKeptShadowRejected,
      productionRejectedShadowKept: diagnostics.productionRejectedShadowKept,
      productionRejectedShadowRejected: diagnostics.productionRejectedShadowRejected,
      shadowKeep: diagnostics.shadowKeep,
      shadowRejectDominated: diagnostics.shadowRejectDominated,
      shadowReplaceDominated: diagnostics.shadowReplaceDominated,
      shadowCollision: diagnostics.shadowCollision,
      shadowUnsafeMerge: diagnostics.shadowUnsafeMerge,
      shadowAnalysisError: diagnostics.shadowAnalysisError,
      shadowUnclassified: diagnostics.shadowUnclassified,
      collisions: diagnostics.collisions,
      candidateKeyBuildMs: Number(diagnostics.candidateKeyBuildMs.toFixed(2)),
      candidateKeyBuildCount: diagnostics.candidateKeyBuildCount,
      candidateKeyAvgMs: diagnostics.candidateKeyBuildCount > 0
        ? Number((diagnostics.candidateKeyBuildMs / diagnostics.candidateKeyBuildCount).toFixed(3))
        : 0,
      productionKeyBuildMs: Number(diagnostics.productionKeyBuildMs.toFixed(2)),
      productionKeyBuildCount: diagnostics.productionKeyBuildCount,
      productionKeyAvgMs: diagnostics.productionKeyBuildCount > 0
        ? Number((diagnostics.productionKeyBuildMs / diagnostics.productionKeyBuildCount).toFixed(2))
        : 0,
      candidateKeyCacheHits: diagnostics.candidateKeyCacheHits,
      candidateKeyCacheMisses: diagnostics.candidateKeyCacheMisses,
      productionKeptShadowRejectedWitnesses: productionKeptShadowRejectedWitnesses.slice(0, maxWitnesses),
      unsafeWitnesses: unsafeWitnesses.slice(0, maxWitnesses),
      analysisErrorWitnesses: analysisErrorWitnesses.slice(0, maxWitnesses),
    };
  }

  return { registerRecord, snapshot };
}

module.exports = {
  createDualKeyShadow,
  heroHp,
};
