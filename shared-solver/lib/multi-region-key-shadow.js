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

function legalActionSignature(simulator, state) {
  try {
    const enumerated = simulator.enumeratePrimitiveActions(state);
    return ((enumerated && enumerated.actions) || [])
      .map((action) => action.summary)
      .sort();
  } catch (error) {
    return ["__enumerateError__"];
  }
}

// regionContext = { id, simulator, ir, goalPredicate }
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
    legalActionSignature: legalActionSignature(regionContext.simulator, state),
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

// A. State partition: exact DP key -> candidate DP key.
function auditStatePartition(records) {
  const exactToCandidate = new Map();
  const candidateToExact = new Map();
  const byLayer = {};
  const byBoundary = {};
  for (const record of records) {
    const exact = record.productionDpKey;
    const candidate = record.candidateDpKey;
    if (!exactToCandidate.has(exact)) exactToCandidate.set(exact, new Set());
    exactToCandidate.get(exact).add(candidate);
    if (!candidateToExact.has(candidate)) candidateToExact.set(candidate, new Set());
    candidateToExact.get(candidate).add(exact);
    byLayer[record.layer] = (byLayer[record.layer] || 0) + 1;
    byBoundary[`b${record.boundaryIndex}`] = (byBoundary[`b${record.boundaryIndex}`] || 0) + 1;
  }
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
  const summarizeRecords = (layerRecords) => {
    const exactMap = new Map();
    const candidateMap = new Map();
    layerRecords.forEach((record) => {
      if (!exactMap.has(record.productionDpKey)) exactMap.set(record.productionDpKey, new Set());
      exactMap.get(record.productionDpKey).add(record.candidateDpKey);
      if (!candidateMap.has(record.candidateDpKey)) candidateMap.set(record.candidateDpKey, new Set());
      candidateMap.get(record.candidateDpKey).add(record.productionDpKey);
    });
    return summarize(exactMap, candidateMap);
  };
  const perLayer = {};
  Object.keys(byLayer).forEach((layer) => {
    perLayer[layer] = {
      ...summarizeRecords(records.filter((r) => r.layer === layer)),
      sampleCount: byLayer[layer],
    };
  });
  const perBoundary = {};
  Object.keys(byBoundary).forEach((key) => {
    perBoundary[key] = {
      ...summarizeRecords(records.filter((r) => r.boundaryIndex === Number(key.slice(1)))),
      sampleCount: byBoundary[key],
    };
  });
  return {
    ...summarize(exactToCandidate, candidateToExact),
    uniqueExactKeys: exactToCandidate.size,
    uniqueCandidateKeys: candidateToExact.size,
    byLayer: perLayer,
    byBoundary: perBoundary,
  };
}

function pairKey(boundaryIndex, localIndex) {
  return `${boundaryIndex}:${localIndex}`;
}

// B. Boundary partition: pre-boundary candidate key -> post-boundary SEMANTIC
// identity (production DP key in the destination region's own context).
// boundaryIndex + localIndex pair pre-boundary and boundary-transfer records.
function auditBoundaryPartition(preBoundaryRecords, boundaryRecords) {
  const postByPair = new Map();
  boundaryRecords.forEach((post) => postByPair.set(pairKey(post.boundaryIndex, post.localIndex), post));
  const byCandidate = new Map();
  preBoundaryRecords.forEach((pre) => {
    if (!byCandidate.has(pre.candidateDpKey)) byCandidate.set(pre.candidateDpKey, []);
    byCandidate.get(pre.candidateDpKey).push({
      pre,
      post: postByPair.get(pairKey(pre.boundaryIndex, pre.localIndex)),
    });
  });
  const groups = [];
  const witnesses = [];
  let inequivalentGroupCount = 0;
  byCandidate.forEach((members, candidateKey) => {
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
