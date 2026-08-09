"use strict";

/**
 * PR-5.5b — Multi-Region Dual-Key Shadow Corpus (research only).
 *
 * Observation-only machinery.  It NEVER participates in frontier pruning,
 * dominance, candidate ranking, checkpoint selection, or route composition.
 *
 * The corpus samples three layers around EVERY Region boundary in a chain:
 *   pre-boundary      : Region i terminal candidates (before materialization).
 *   boundary-transfer : materializeNextRegionFrontier output — the ACTUAL input
 *                       states Region i+1 receives (entry mutation applied).
 *   post-boundary     : Region i+1 reachable enqueue states.
 *
 * PER-REGION CONTEXT: each layer uses its OWN region's simulator, TowerIR and
 * goal predicate (region i for pre-boundary; region i+1 for boundary-transfer,
 * post-boundary and all behavior CEGAR).  A shared IR would ask "state inside
 * the wrong region's topology".  The region context travels on every record so
 * multi-boundary chains never mix simulators / IRs / goal predicates.
 *
 * Every record carries the exact (production) identity, the candidate identity,
 * the exact state fingerprint (diagnostics only), the legal action signature,
 * the terminal/goal projection, and boundary provenance.  boundaryIndex +
 * localIndex pair the pre-boundary and boundary-transfer layers per boundary.
 *
 * Two audits:
 *   A. state partition    : exact DP key -> candidate DP key (split / merge /
 *                           partitionRelation), per layer and per boundary.
 *   B. boundary partition : pre-boundary candidate key -> post-boundary
 *                           SEMANTIC identity (production DP key).  A candidate
 *                           merge is boundary-inequivalent ONLY when the
 *                           materialized states have DIFFERENT production keys.
 *                           Full-exact-fingerprint divergence (HP / dominance-
 *                           level differences within one production key) is
 *                           reported as diagnostics and handed to the
 *                           dominance-aware classifyPair, NOT treated as unsafe.
 *
 * Ordered CEGAR for real merge groups:
 *   1. boundary-transfer equivalence on semantic identity (decisive)
 *   2. legal-action / successor / terminal / dominance (classifyPair, reused
 *      from key-dependency-corpus) on the post-boundary materialized states,
 *      always in the destination region's own context.
 */

const { exactStateFingerprint } = require("./solver-job");
const { buildDpStateKey } = require("./dp-search");
const {
  buildCandidateDpKey,
  buildCandidateProjection,
  buildStateBehavior,
  classifyPair,
  buildTerminalProjection,
} = require("./key-dependency-corpus");
const { heroHp } = require("./dual-key-shadow");

// Production-legal action signature: uses the region's legal action provider
// (built from the region's action policy via buildSegmentActionProvider) when
// present, so the shadow sees the SAME legal action semantics as the segment
// search.  Without a provider it falls back to raw primitive enumeration.
function legalActionSignature(regionContext, state) {
  try {
    const actions = typeof regionContext.legalActionProvider === "function"
      ? (regionContext.legalActionProvider(null, state) || [])
      : (((regionContext.simulator.enumeratePrimitiveActions(state)) || {}).actions || []);
    return actions
      .map((action) => action.summary)
      .sort();
  } catch (error) {
    return ["__enumerateError__"];
  }
}

// regionContext = { id, simulator, project, ir, goalPredicate, legalActionProvider? }
function buildCorpusRecord(input) {
  const {
    regionContext,
    project,
    candidateProfile,
    candidateKeyBuilder,
    exactKeyConfig,
    state,
    layer,
    regionIndex,
    regionId,
  } = input;
  const candidateOptions = { goalPredicate: regionContext.goalPredicate, profile: candidateProfile };
  const candidateDpKey = typeof candidateKeyBuilder === "function"
    ? candidateKeyBuilder(state)
    : buildCandidateDpKey(regionContext.simulator, project, regionContext.ir, state, candidateOptions);
  const candidateProjection = typeof candidateKeyBuilder === "function"
    ? null
    : buildCandidateProjection(regionContext.simulator, project, regionContext.ir, state, candidateOptions);
  return {
    layer,
    regionIndex,
    regionId,
    exactStateFingerprint: exactStateFingerprint(state),
    productionDpKey: buildDpStateKey(regionContext.simulator, state, exactKeyConfig || { dpKeyMode: "region" }),
    candidateDpKey,
    candidateProjection,
    legalActionSignature: legalActionSignature(regionContext, state),
    terminalProjection: buildTerminalProjection(state, regionContext.goalPredicate),
    hp: heroHp(state),
    regionContext,
    ...(input.extra || {}),
    state,
  };
}

// Builds the 3-layer corpus across all boundaries of a chain.
//   boundaries: [{ index, regionA, regionB, preCandidates, inputFrontier, postRecords }]
//   regionA/B: { id, simulator, ir, goalPredicate }
//   project, candidateProfile, exactKeyConfig, candidateKeyBuilder (optional control)
function buildMultiRegionCorpus(input) {
  const { boundaries, project, candidateProfile, candidateKeyBuilder, exactKeyConfig } = input;
  const recordBase = {
    project,
    candidateProfile,
    candidateKeyBuilder,
    exactKeyConfig,
  };
  const preBoundaryRecords = [];
  const boundaryRecords = [];
  const postBoundaryRecords = [];
  (boundaries || []).forEach((b, boundaryIndex) => {
    (b.preCandidates || []).forEach((candidate, localIndex) => {
      preBoundaryRecords.push(buildCorpusRecord({
        ...recordBase,
        regionContext: b.regionA,
        state: candidate && candidate.state,
        layer: "pre-boundary",
        regionIndex: boundaryIndex,
        regionId: b.regionA.id,
        extra: {
          boundaryIndex,
          localIndex,
          preBoundaryStateFingerprint: exactStateFingerprint(candidate && candidate.state),
        },
      }));
    });
    (b.inputFrontier || []).forEach((entry, localIndex) => {
      boundaryRecords.push(buildCorpusRecord({
        ...recordBase,
        regionContext: b.regionB,
        state: entry && entry.state,
        layer: "boundary-transfer",
        regionIndex: boundaryIndex + 1,
        regionId: b.regionB.id,
        extra: {
          boundaryIndex,
          localIndex,
          regionInputIndex: entry && entry.regionInputIndex != null ? entry.regionInputIndex : localIndex,
          preBoundaryStateFingerprint: entry && entry.inputCarriedExactFingerprint,
          postBoundaryExactFingerprint: entry && entry.exactBoundaryStateFingerprint,
          inputCarriedExactFingerprint: entry && entry.inputCarriedExactFingerprint,
        },
      }));
    });
    (b.postRecords || []).forEach((record) => {
      postBoundaryRecords.push(buildCorpusRecord({
        ...recordBase,
        regionContext: b.regionB,
        state: record && record.state,
        layer: "post-boundary",
        regionIndex: boundaryIndex + 1,
        regionId: b.regionB.id,
        extra: {
          boundaryIndex,
          searchExactDpKey: record && record.exactDpKey,
          productionDecision: record && record.productionDecision,
        },
      }));
    });
  });
  const records = [...preBoundaryRecords, ...boundaryRecords, ...postBoundaryRecords];
  return {
    preBoundaryRecords,
    boundaryRecords,
    postBoundaryRecords,
    records,
    boundaries: (boundaries || []).map((b) => ({
      index: b.index,
      regionA: b.regionA.id,
      regionB: b.regionB.id,
    })),
    layers: {
      "pre-boundary": preBoundaryRecords.length,
      "boundary-transfer": boundaryRecords.length,
      "post-boundary": postBoundaryRecords.length,
    },
  };
}

// A. State partition: exact DP key -> candidate DP key, SCOPED by the region
// execution context (regionContext.id).  Records only compete with records in
// the SAME region's DP; a candidate key appearing in two different regions or
// boundaries is key reuse, NOT a merge.  Top-level counts aggregate per-scope
// results (a merge is counted only within one scope).
function auditStatePartition(records) {
  const scopeKey = (record) => `${(record.regionContext && record.regionContext.id) || "?"}`;
  const summarize = (exactMap, candidateMap) => {
    let splitExactKeyCount = 0;
    let mergedCandidateKeyCount = 0;
    exactMap.forEach((set) => { if (set.size > 1) splitExactKeyCount += 1; });
    candidateMap.forEach((set) => { if (set.size > 1) mergedCandidateKeyCount += 1; });
    let partitionRelation = "equal";
    if (splitExactKeyCount > 0 && mergedCandidateKeyCount > 0) partitionRelation = "non-comparable";
    else if (splitExactKeyCount > 0) partitionRelation = "strict-refinement";
    else if (mergedCandidateKeyCount > 0) partitionRelation = "strict-coarsening";
    return { splitExactKeyCount, mergedCandidateKeyCount, partitionRelation };
  };
  const buildMaps = (layerRecords) => {
    const exactToCandidate = new Map();
    const candidateToExact = new Map();
    layerRecords.forEach((record) => {
      if (!exactToCandidate.has(record.productionDpKey)) exactToCandidate.set(record.productionDpKey, new Set());
      exactToCandidate.get(record.productionDpKey).add(record.candidateDpKey);
      if (!candidateToExact.has(record.candidateDpKey)) candidateToExact.set(record.candidateDpKey, new Set());
      candidateToExact.get(record.candidateDpKey).add(record.productionDpKey);
    });
    return { exactToCandidate, candidateToExact };
  };
  // Per-scope maps (scopes never mix).
  const scopeRecords = new Map();
  records.forEach((record) => {
    const scope = scopeKey(record);
    if (!scopeRecords.has(scope)) scopeRecords.set(scope, []);
    scopeRecords.get(scope).push(record);
  });
  const perScope = {};
  let splitExactKeyCount = 0;
  let mergedCandidateKeyCount = 0;
  let uniqueExactKeys = 0;
  let uniqueCandidateKeys = 0;
  scopeRecords.forEach((scopeRecs, scope) => {
    const maps = buildMaps(scopeRecs);
    const stats = summarize(maps.exactToCandidate, maps.candidateToExact);
    perScope[scope] = {
      ...stats,
      uniqueExactKeys: maps.exactToCandidate.size,
      uniqueCandidateKeys: maps.candidateToExact.size,
      sampleCount: scopeRecs.length,
    };
    splitExactKeyCount += stats.splitExactKeyCount;
    mergedCandidateKeyCount += stats.mergedCandidateKeyCount;
    uniqueExactKeys += maps.exactToCandidate.size;
    uniqueCandidateKeys += maps.candidateToExact.size;
  });
  let partitionRelation = "equal";
  if (splitExactKeyCount > 0 && mergedCandidateKeyCount > 0) partitionRelation = "non-comparable";
  else if (splitExactKeyCount > 0) partitionRelation = "strict-refinement";
  else if (mergedCandidateKeyCount > 0) partitionRelation = "strict-coarsening";

  // Per-layer and per-boundary breakdowns, each aggregated per scope.
  const layers = new Set(records.map((r) => r.layer));
  const byLayer = {};
  layers.forEach((layer) => {
    const layerRecords = records.filter((r) => r.layer === layer);
    const perLayerScope = new Map();
    layerRecords.forEach((record) => {
      const scope = scopeKey(record);
      if (!perLayerScope.has(scope)) perLayerScope.set(scope, []);
      perLayerScope.get(scope).push(record);
    });
    let split = 0;
    let merged = 0;
    perLayerScope.forEach((scopeRecs) => {
      const stats = summarize(buildMaps(scopeRecs).exactToCandidate, buildMaps(scopeRecs).candidateToExact);
      split += stats.splitExactKeyCount;
      merged += stats.mergedCandidateKeyCount;
    });
    let relation = "equal";
    if (split > 0 && merged > 0) relation = "non-comparable";
    else if (split > 0) relation = "strict-refinement";
    else if (merged > 0) relation = "strict-coarsening";
    byLayer[layer] = { splitExactKeyCount: split, mergedCandidateKeyCount: merged, partitionRelation: relation, sampleCount: layerRecords.length };
  });

  const boundaries = new Set(records.map((r) => r.boundaryIndex));
  const byBoundary = {};
  boundaries.forEach((boundaryIndex) => {
    const bRecords = records.filter((r) => r.boundaryIndex === boundaryIndex);
    const perBScope = new Map();
    bRecords.forEach((record) => {
      const scope = scopeKey(record);
      if (!perBScope.has(scope)) perBScope.set(scope, []);
      perBScope.get(scope).push(record);
    });
    let split = 0;
    let merged = 0;
    perBScope.forEach((scopeRecs) => {
      const stats = summarize(buildMaps(scopeRecs).exactToCandidate, buildMaps(scopeRecs).candidateToExact);
      split += stats.splitExactKeyCount;
      merged += stats.mergedCandidateKeyCount;
    });
    let relation = "equal";
    if (split > 0 && merged > 0) relation = "non-comparable";
    else if (split > 0) relation = "strict-refinement";
    else if (merged > 0) relation = "strict-coarsening";
    byBoundary[`b${boundaryIndex}`] = { splitExactKeyCount: split, mergedCandidateKeyCount: merged, partitionRelation: relation, sampleCount: bRecords.length };
  });

  return {
    splitExactKeyCount,
    mergedCandidateKeyCount,
    partitionRelation,
    uniqueExactKeys,
    uniqueCandidateKeys,
    byLayer,
    byBoundary,
    perScope,
  };
}

function pairKey(boundaryIndex, localIndex) {
  return `${boundaryIndex}:${localIndex}`;
}

// B. Boundary partition: pre-boundary candidate key -> post-boundary SEMANTIC
// identity (production DP key in the destination region's own context).
// boundaryIndex + localIndex pair pre-boundary and boundary-transfer records.
// Groups are scoped by (boundaryIndex, candidateDpKey): a candidate key reused
// across two different boundaries is NOT a merge.
function auditBoundaryPartition(preBoundaryRecords, boundaryRecords) {
  const postByPair = new Map();
  boundaryRecords.forEach((post) => postByPair.set(pairKey(post.boundaryIndex, post.localIndex), post));
  const byCandidate = new Map();
  preBoundaryRecords.forEach((pre) => {
    const scopeKeyValue = `${pre.boundaryIndex}|${pre.candidateDpKey}`;
    if (!byCandidate.has(scopeKeyValue)) byCandidate.set(scopeKeyValue, []);
    byCandidate.get(scopeKeyValue).push({
      pre,
      post: postByPair.get(pairKey(pre.boundaryIndex, pre.localIndex)),
    });
  });
  const groups = [];
  const witnesses = [];
  let inequivalentGroupCount = 0;
  byCandidate.forEach((members, scopeKeyValue) => {
    const candidateKey = members[0].pre.candidateDpKey;
    const distinctExact = new Set(members.map((m) => m.pre.productionDpKey));
    if (distinctExact.size <= 1) return;
    const postSemanticKeys = new Set(members.map((m) => m.post && m.post.productionDpKey).filter(Boolean));
    const postExactFps = new Set(members.map((m) => m.post && (m.post.postBoundaryExactFingerprint || m.post.exactStateFingerprint)).filter(Boolean));
    const boundaryEquivalent = postSemanticKeys.size === 1;
    groups.push({
      candidateKey,
      memberCount: members.length,
      distinctExactKeys: distinctExact.size,
      boundaryEquivalent,
      postSemanticKeys: postSemanticKeys.size,
      postExactFingerprints: postExactFps.size,
    });
    if (!boundaryEquivalent) {
      inequivalentGroupCount += 1;
      witnesses.push({
        candidateKey,
        members: members.map((m) => ({
          exactDpKey: m.pre.productionDpKey,
          hp: m.pre.hp,
          boundaryIndex: m.pre.boundaryIndex,
          postBoundaryProductionDpKey: m.post && m.post.productionDpKey,
        })),
      });
    }
  });
  return {
    boundaryTransferEquivalent: inequivalentGroupCount === 0,
    groupsAudited: groups.length,
    inequivalentGroupCount,
    groups,
    witnesses,
  };
}

function groupByKey(records, keyFn) {
  const map = new Map();
  for (const record of records) {
    const key = keyFn(record);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(record);
  }
  return map;
}

function distinctExactKeyCount(records) {
  return new Set(records.map((record) => record.productionDpKey)).size;
}

// One representative per distinct exact fingerprint (keeps HP/dominance-level
// diversity for the dominance-aware classifier).
function representativesByExactFingerprint(records) {
  const byFp = new Map();
  for (const record of records) {
    if (!byFp.has(record.exactStateFingerprint)) byFp.set(record.exactStateFingerprint, record);
  }
  return Array.from(byFp.values());
}

function classifyPairUnsafe(classification) {
  return classification.classification === "unsafe"
    || classification.classification === "analysis-error"
    || classification.classification === "unclassified";
}

function classifyBehaviorUnsafe(ctx, candidateProfile, first, other) {
  const options = { goalPredicate: ctx.goalPredicate, profile: candidateProfile };
  // Production-legal action semantics: when the region context carries a legal
  // action provider (built from its action policy), the classifier uses it so
  // raw primitive actions that the production policy forbids never enter
  // successor / choice comparison.
  if (typeof ctx.legalActionProvider === "function") {
    options.actionProvider = (state) => ctx.legalActionProvider(null, state);
  }
  const left = buildStateBehavior(ctx.simulator, ctx.project, ctx.ir, first.state, options);
  const right = buildStateBehavior(ctx.simulator, ctx.project, ctx.ir, other.state, options);
  return classifyPair(left, right);
}

// Ordered CEGAR over real merge groups.
//   pre-boundary groups: boundary-transfer equivalence on SEMANTIC identity
//     FIRST (decisive); when equivalent, confirm via classifyPair over the
//     materialized post-boundary states (exact-fingerprint divergence here is
//     the HP/dominance-level difference classifyPair decides).
//   post-boundary groups: behavior CEGAR via classifyPair.
// Groups are scoped per (boundaryIndex, candidateKey); behavior always runs in
// the destination region's own context (carried on the records).
function runMergeGroupCegar(input) {
  const { preBoundaryRecords, boundaryRecords, postBoundaryRecords, candidateProfile } = input;
  const postByPair = new Map();
  boundaryRecords.forEach((post) => postByPair.set(pairKey(post.boundaryIndex, post.localIndex), post));
  const unsafeWitnesses = [];
  let unsafeCount = 0;
  let boundaryInequivalentGroups = 0;
  let safePreBoundaryGroups = 0;
  let safePostBoundaryGroups = 0;
  let behaviorAudited = 0;

  // Stage 1: pre-boundary merge groups per boundary.
  const preGroups = groupByKey(preBoundaryRecords, (r) => `${r.boundaryIndex}|${r.candidateDpKey}`);
  preGroups.forEach((members) => {
    if (distinctExactKeyCount(members) <= 1) return;
    const candidateKey = members[0].candidateDpKey;
    const paired = members.map((member) => ({ member, post: postByPair.get(pairKey(member.boundaryIndex, member.localIndex)) }));
    const postSemanticKeys = new Set(paired.map((p) => p.post && p.post.productionDpKey).filter(Boolean));
    if (postSemanticKeys.size > 1) {
      unsafeCount += 1;
      boundaryInequivalentGroups += 1;
      unsafeWitnesses.push({
        stage: "boundary-transfer",
        candidateKey,
        reason: "candidate-merged pre-boundary states materialize to different post-boundary semantic (production) identities",
        members: paired.map((p) => ({
          exactDpKey: p.member.productionDpKey,
          hp: p.member.hp,
          boundaryIndex: p.member.boundaryIndex,
          postBoundaryProductionDpKey: p.post && p.post.productionDpKey,
        })),
      });
      return;
    }
    const postRecords = paired.map((p) => p.post).filter(Boolean);
    if (postRecords.length === 0) return;
    const reps = representativesByExactFingerprint(postRecords);
    const first = reps[0];
    let unsafe = false;
    for (const other of reps.slice(1)) {
      behaviorAudited += 1;
      const classification = classifyBehaviorUnsafe(first.regionContext, candidateProfile, first, other);
      if (classifyPairUnsafe(classification)) {
        unsafe = true;
        unsafeCount += 1;
        unsafeWitnesses.push({
          stage: "post-boundary-behavior",
          candidateKey,
          reason: classification.reason || classification.classification,
        });
        break;
      }
    }
    if (!unsafe) safePreBoundaryGroups += 1;
  });

  // Stage 2: post-boundary merge groups per boundary.
  const postGroups = groupByKey(postBoundaryRecords, (r) => `${r.boundaryIndex}|${r.candidateDpKey}`);
  postGroups.forEach((members) => {
    if (distinctExactKeyCount(members) <= 1) return;
    const candidateKey = members[0].candidateDpKey;
    const reps = representativesByExactFingerprint(members);
    const first = reps[0];
    for (const other of reps.slice(1)) {
      behaviorAudited += 1;
      const classification = classifyBehaviorUnsafe(first.regionContext, candidateProfile, first, other);
      if (classifyPairUnsafe(classification)) {
        unsafeCount += 1;
        unsafeWitnesses.push({
          stage: "post-boundary-behavior",
          candidateKey,
          reason: classification.reason || classification.classification,
        });
        return;
      }
    }
    safePostBoundaryGroups += 1;
  });

  return {
    unsafeCount,
    boundaryInequivalentGroups,
    safePreBoundaryGroups,
    safePostBoundaryGroups,
    behaviorAudited,
    unsafeWitnesses: unsafeWitnesses.slice(0, 10),
  };
}

module.exports = {
  auditBoundaryPartition,
  auditStatePartition,
  buildCorpusRecord,
  buildMultiRegionCorpus,
  legalActionSignature,
  runMergeGroupCegar,
};
