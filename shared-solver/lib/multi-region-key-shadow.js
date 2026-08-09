"use strict";

/**
 * PR-5.5a Repair — Multi-Region Dual-Key Shadow Corpus (research only).
 *
 * Observation-only machinery.  It NEVER participates in frontier pruning,
 * dominance, candidate ranking, checkpoint selection, or route composition.
 *
 * The corpus samples three layers around a Region boundary:
 *   pre-boundary      : Region A terminal candidates (before materialization).
 *   boundary-transfer : materializeNextRegionFrontier output — the ACTUAL input
 *                       states Region B receives (entry mutation applied).
 *   post-boundary     : Region B reachable enqueue states.
 *
 * PER-REGION CONTEXT: each layer uses its own region's simulator, TowerIR, and
 * goal predicate (regionA for pre-boundary, regionB for boundary-transfer and
 * post-boundary, and for all behavior CEGAR).  A single shared IR would ask
 * "R1 state inside R0 topology" instead of "R1 state inside R1 topology".
 *
 * Every record carries the exact (production) identity, the candidate identity,
 * the exact state fingerprint (diagnostics only), the legal action signature,
 * the terminal/goal projection, and boundary provenance.
 *
 * Two audits:
 *   A. state partition    : exact DP key -> candidate DP key
 *                           (split / merge / partitionRelation), per layer.
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
 *      from key-dependency-corpus) on the post-boundary materialized states.
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

// regionContext = { simulator, ir, goalPredicate }
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
    ...(input.extra || {}),
    state,
  };
}

// Builds the 3-layer corpus from the two region runs.
//   regionA: { simulator, ir, goalPredicate, terminalCandidates }
//   regionB: { simulator, ir, goalPredicate, records, inputFrontier }
//   project, candidateProfile, exactKeyConfig,
//   candidateKeyBuilder (optional negative control)
function buildMultiRegionCorpus(input) {
  const { regionA, regionB, project, candidateProfile, candidateKeyBuilder, exactKeyConfig } = input;
  const recordBase = {
    project,
    candidateProfile,
    candidateKeyBuilder,
    exactKeyConfig,
  };
  const preBoundaryRecords = (regionA.terminalCandidates || []).map((candidate, index) =>
    buildCorpusRecord({
      ...recordBase,
      regionContext: regionA,
      state: candidate && candidate.state,
      layer: "pre-boundary",
      regionIndex: 0,
      regionId: "R0",
      extra: {
        boundaryIndex: index,
        preBoundaryStateFingerprint: exactStateFingerprint(candidate && candidate.state),
      },
    }),
  );
  const boundaryRecords = (regionB.inputFrontier || []).map((entry, index) =>
    buildCorpusRecord({
      ...recordBase,
      regionContext: regionB,
      state: entry && entry.state,
      layer: "boundary-transfer",
      regionIndex: 1,
      regionId: "R1",
      extra: {
        regionInputIndex: entry && entry.regionInputIndex != null ? entry.regionInputIndex : index,
        preBoundaryStateFingerprint: entry && entry.inputCarriedExactFingerprint,
        postBoundaryExactFingerprint: entry && entry.exactBoundaryStateFingerprint,
        inputCarriedExactFingerprint: entry && entry.inputCarriedExactFingerprint,
      },
    }),
  );
  const postBoundaryRecords = (regionB.records || []).map((record) =>
    buildCorpusRecord({
      ...recordBase,
      regionContext: regionB,
      state: record && record.state,
      layer: "post-boundary",
      regionIndex: 1,
      regionId: "R1",
      extra: {
        searchExactDpKey: record && record.exactDpKey,
        productionDecision: record && record.productionDecision,
      },
    }),
  );
  const records = [...preBoundaryRecords, ...boundaryRecords, ...postBoundaryRecords];
  return {
    preBoundaryRecords,
    boundaryRecords,
    postBoundaryRecords,
    records,
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
  for (const record of records) {
    const exact = record.productionDpKey;
    const candidate = record.candidateDpKey;
    if (!exactToCandidate.has(exact)) exactToCandidate.set(exact, new Set());
    exactToCandidate.get(exact).add(candidate);
    if (!candidateToExact.has(candidate)) candidateToExact.set(candidate, new Set());
    candidateToExact.get(candidate).add(exact);
    byLayer[record.layer] = (byLayer[record.layer] || 0) + 1;
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
  const perLayer = {};
  Object.keys(byLayer).forEach((layer) => {
    const layerRecords = records.filter((r) => r.layer === layer);
    const exactMap = new Map();
    const candidateMap = new Map();
    layerRecords.forEach((record) => {
      if (!exactMap.has(record.productionDpKey)) exactMap.set(record.productionDpKey, new Set());
      exactMap.get(record.productionDpKey).add(record.candidateDpKey);
      if (!candidateMap.has(record.candidateDpKey)) candidateMap.set(record.candidateDpKey, new Set());
      candidateMap.get(record.candidateDpKey).add(record.productionDpKey);
    });
    perLayer[layer] = { ...summarize(exactMap, candidateMap), sampleCount: byLayer[layer] };
  });
  return {
    ...summarize(exactToCandidate, candidateToExact),
    uniqueExactKeys: exactToCandidate.size,
    uniqueCandidateKeys: candidateToExact.size,
    byLayer: perLayer,
  };
}

// B. Boundary partition: pre-boundary candidate key -> post-boundary SEMANTIC
// identity (production DP key in Region B's own context).  materializeNextRegionFrontier
// preserves order, so record i of the pre-boundary layer pairs with record i of
// the boundary-transfer layer.  Full-exact-fingerprint divergence within one
// semantic identity is diagnostic only (HP/dominance-level), NOT inequivalence.
function auditBoundaryPartition(preBoundaryRecords, boundaryRecords) {
  const byCandidate = new Map();
  const n = Math.min(preBoundaryRecords.length, boundaryRecords.length);
  for (let i = 0; i < n; i += 1) {
    const pre = preBoundaryRecords[i];
    const post = boundaryRecords[i];
    if (!byCandidate.has(pre.candidateDpKey)) byCandidate.set(pre.candidateDpKey, []);
    byCandidate.get(pre.candidateDpKey).push({
      exactDpKey: pre.productionDpKey,
      hp: pre.hp,
      postProductionDpKey: post.productionDpKey,
      postExactFingerprint: post.postBoundaryExactFingerprint || post.exactStateFingerprint,
    });
  }
  const groups = [];
  const witnesses = [];
  let inequivalentGroupCount = 0;
  byCandidate.forEach((members, candidateKey) => {
    const distinctExact = new Set(members.map((m) => m.exactDpKey));
    if (distinctExact.size <= 1) return;
    const distinctPostSemantic = new Set(members.map((m) => m.postProductionDpKey));
    const distinctPostExact = new Set(members.map((m) => m.postExactFingerprint));
    const boundaryEquivalent = distinctPostSemantic.size === 1;
    groups.push({
      candidateKey,
      memberCount: members.length,
      distinctExactKeys: distinctExact.size,
      boundaryEquivalent,
      // diagnostic only: exact-fingerprint divergence within one semantic
      // identity is the HP/dominance-level difference classifyPair handles.
      postSemanticKeys: distinctPostSemantic.size,
      postExactFingerprints: distinctPostExact.size,
    });
    if (!boundaryEquivalent) {
      inequivalentGroupCount += 1;
      witnesses.push({ candidateKey, members: members.slice(0, 4) });
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

function groupByCandidate(records) {
  const map = new Map();
  for (const record of records) {
    if (!map.has(record.candidateDpKey)) map.set(record.candidateDpKey, []);
    map.get(record.candidateDpKey).push(record);
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

// Ordered CEGAR over real merge groups.
//   pre-boundary groups: boundary-transfer equivalence on SEMANTIC identity
//     FIRST (decisive); when equivalent (production keys equal), confirm via
//     classifyPair over the materialized post-boundary states — exact-fingerprint
//     divergence here is the HP/dominance-level difference classifyPair decides.
//   post-boundary groups: behavior CEGAR via classifyPair.
function runMergeGroupCegar(input) {
  const {
    preBoundaryRecords,
    boundaryRecords,
    postBoundaryRecords,
    regionB, // { simulator, project, ir, goalPredicate }
    candidateProfile,
  } = input;
  const behaviorOptions = { goalPredicate: regionB.goalPredicate, profile: candidateProfile };
  const unsafeWitnesses = [];
  let unsafeCount = 0;
  let boundaryInequivalentGroups = 0;
  let safePreBoundaryGroups = 0;
  let safePostBoundaryGroups = 0;
  let behaviorAudited = 0;

  // Pair boundary records by the pre-boundary order.
  const postByIndex = new Map();
  boundaryRecords.forEach((record, index) => postByIndex.set(index, record));

  // Stage 1: pre-boundary merge groups — boundary-transfer equivalence on the
  // post-boundary SEMANTIC identity (production DP key), not full exact state.
  const preByCandidate = groupByCandidate(preBoundaryRecords);
  preByCandidate.forEach((members, candidateKey) => {
    if (distinctExactKeyCount(members) <= 1) return;
    const paired = members.map((member) => ({
      member,
      post: postByIndex.get(member.boundaryIndex),
    }));
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
          postBoundaryProductionDpKey: p.post && p.post.productionDpKey,
          postBoundaryExactFingerprint: p.post && (p.post.postBoundaryExactFingerprint || p.post.exactStateFingerprint),
        })),
      });
      return;
    }
    // Boundary-equivalent on semantic identity: confirm via classifyPair over
    // the materialized post-boundary states (exact-fingerprint divergence here
    // is the HP/dominance-level difference classifyPair decides).
    const postRecords = paired.map((p) => p.post).filter(Boolean);
    const reps = representativesByExactFingerprint(postRecords);
    const first = reps[0];
    let classificationUnsafe = false;
    for (const other of reps.slice(1)) {
      behaviorAudited += 1;
      const left = buildStateBehavior(regionB.simulator, regionB.project, regionB.ir, first.state, behaviorOptions);
      const right = buildStateBehavior(regionB.simulator, regionB.project, regionB.ir, other.state, behaviorOptions);
      const classification = classifyPair(left, right);
      if (classifyPairUnsafe(classification)) {
        classificationUnsafe = true;
        unsafeCount += 1;
        unsafeWitnesses.push({
          stage: "post-boundary-behavior",
          candidateKey,
          reason: classification.reason || classification.classification,
        });
        break;
      }
    }
    if (!classificationUnsafe) safePreBoundaryGroups += 1;
  });

  // Stage 2: post-boundary merge groups — behavior CEGAR via classifyPair.
  const postByCandidate = groupByCandidate(postBoundaryRecords);
  postByCandidate.forEach((members, candidateKey) => {
    if (distinctExactKeyCount(members) <= 1) return;
    const reps = representativesByExactFingerprint(members);
    const first = reps[0];
    for (const other of reps.slice(1)) {
      behaviorAudited += 1;
      const left = buildStateBehavior(regionB.simulator, regionB.project, regionB.ir, first.state, behaviorOptions);
      const right = buildStateBehavior(regionB.simulator, regionB.project, regionB.ir, other.state, behaviorOptions);
      const classification = classifyPair(left, right);
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
