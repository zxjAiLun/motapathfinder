"use strict";

/**
 * PR-5.5a — Multi-Region Dual-Key Shadow Corpus (research only).
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
 * Every record carries the exact (production) identity, the candidate identity,
 * the exact state fingerprint, the legal action signature, the terminal/goal
 * projection, and boundary provenance (inputCarried / post-boundary exact
 * fingerprints, region input index, checkpoint fingerprint).
 *
 * Two audits:
 *   A. state partition    : exact DP key -> candidate DP key
 *                           (splitExactKeyCount / mergedCandidateKeyCount /
 *                           partitionRelation), per layer and overall.
 *   B. boundary partition : pre-boundary candidate key -> post-boundary exact
 *                           fingerprint.  A candidate merge whose members
 *                           materialize to DIFFERENT post-boundary identities is
 *                           boundary-inequivalent.
 *
 * Ordered CEGAR for real merge groups (stage 1 first, decisive):
 *   1. boundary-transfer equivalence   (pre-boundary groups)
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
const { fingerprintJson } = require("./solve-task");
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

function buildCorpusRecord(input) {
  const {
    simulator,
    project,
    ir,
    goalPredicate,
    candidateProfile,
    candidateKeyBuilder,
    exactKeyConfig,
    state,
    layer,
    regionIndex,
    regionId,
  } = input;
  const candidateOptions = { goalPredicate, profile: candidateProfile };
  const candidateDpKey = typeof candidateKeyBuilder === "function"
    ? candidateKeyBuilder(state)
    : buildCandidateDpKey(simulator, project, ir, state, candidateOptions);
  const candidateProjection = typeof candidateKeyBuilder === "function"
    ? null
    : buildCandidateProjection(simulator, project, ir, state, candidateOptions);
  return {
    layer,
    regionIndex,
    regionId,
    exactStateFingerprint: exactStateFingerprint(state),
    productionDpKey: buildDpStateKey(simulator, state, exactKeyConfig || { dpKeyMode: "region" }),
    candidateDpKey,
    candidateProjection,
    legalActionSignature: legalActionSignature(simulator, state),
    terminalProjection: buildTerminalProjection(state, goalPredicate),
    hp: heroHp(state),
    ...(input.extra || {}),
    state,
  };
}

// Builds the 3-layer corpus from the two region runs.
//   regionA: { terminalCandidates }       (Region A finalCandidates)
//   regionB: { records, inputFrontier }   (Region B search records + materialized input frontier)
//   simulatorA / simulatorB, project, ir, goalPredicate, candidateProfile,
//   exactKeyConfig, candidateKeyBuilder (optional negative control)
function buildMultiRegionCorpus(input) {
  const {
    regionA,
    regionB,
    simulatorA,
    simulatorB,
    project,
    ir,
    goalPredicate,
    candidateProfile,
    candidateKeyBuilder,
    exactKeyConfig,
  } = input;
  const recordBase = {
    simulator: simulatorB,
    project,
    ir,
    goalPredicate,
    candidateProfile,
    candidateKeyBuilder,
    exactKeyConfig,
  };
  const preBoundaryRecords = (regionA.terminalCandidates || []).map((candidate, index) =>
    buildCorpusRecord({
      ...recordBase,
      simulator: simulatorA,
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
      state: entry && entry.state,
      layer: "boundary-transfer",
      regionIndex: 1,
      regionId: "R1",
      extra: {
        regionInputIndex: entry && entry.regionInputIndex != null ? entry.regionInputIndex : index,
        preBoundaryStateFingerprint: entry && entry.inputCarriedExactFingerprint,
        postBoundaryExactFingerprint: entry && entry.exactBoundaryStateFingerprint,
        inputCarriedExactFingerprint: entry && entry.inputCarriedExactFingerprint,
        checkpointFingerprint: fingerprintJson((entry && entry.ancestry) || {}),
      },
    }),
  );
  const postBoundaryRecords = (regionB.records || []).map((record) =>
    buildCorpusRecord({
      ...recordBase,
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
    const layerStats = byLayer[record.layer] || (byLayer[record.layer] = { splitExactKeyCount: 0, mergedCandidateKeyCount: 0, partitionRelation: "equal", sampleCount: 0 });
    layerStats.sampleCount += 1;
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
  return {
    ...summarize(exactToCandidate, candidateToExact),
    uniqueExactKeys: exactToCandidate.size,
    uniqueCandidateKeys: candidateToExact.size,
    byLayer: Object.keys(byLayer).reduce((acc, layer) => {
      const stats = byLayer[layer];
      const exactMap = new Map();
      const candidateMap = new Map();
      records.filter((r) => r.layer === layer).forEach((record) => {
        if (!exactMap.has(record.productionDpKey)) exactMap.set(record.productionDpKey, new Set());
        exactMap.get(record.productionDpKey).add(record.candidateDpKey);
        if (!candidateMap.has(record.candidateDpKey)) candidateMap.set(record.candidateDpKey, new Set());
        candidateMap.get(record.candidateDpKey).add(record.productionDpKey);
      });
      acc[layer] = { ...summarize(exactMap, candidateMap), sampleCount: stats.sampleCount };
      return acc;
    }, {}),
  };
}

// B. Boundary partition: pre-boundary candidate key -> post-boundary exact
// fingerprint.  materializeNextRegionFrontier preserves order, so record i of
// the pre-boundary layer pairs with record i of the boundary-transfer layer.
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
      postBoundaryExactFingerprint: post.postBoundaryExactFingerprint || post.exactStateFingerprint,
    });
  }
  const groups = [];
  const witnesses = [];
  let inequivalentGroupCount = 0;
  byCandidate.forEach((members, candidateKey) => {
    const distinctExact = new Set(members.map((m) => m.exactDpKey));
    if (distinctExact.size <= 1) return;
    const distinctPost = new Set(members.map((m) => m.postBoundaryExactFingerprint));
    const boundaryEquivalent = distinctPost.size === 1;
    groups.push({
      candidateKey,
      memberCount: members.length,
      distinctExactKeys: distinctExact.size,
      boundaryEquivalent,
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

function representativesByExactKey(records) {
  const byExact = new Map();
  for (const record of records) {
    if (!byExact.has(record.productionDpKey)) byExact.set(record.productionDpKey, record);
  }
  return Array.from(byExact.values());
}

function classifyPairUnsafe(classification) {
  return classification.classification === "unsafe"
    || classification.classification === "analysis-error"
    || classification.classification === "unclassified";
}

// Ordered CEGAR over real merge groups.
//   pre-boundary groups: boundary-transfer equivalence FIRST (decisive); when
//     equivalent, confirm via classifyPair on the materialized post-boundary
//     states (identical post-boundary fingerprints imply identical B inputs).
//   post-boundary groups: behavior CEGAR via classifyPair.
function runMergeGroupCegar(input) {
  const {
    preBoundaryRecords,
    boundaryRecords,
    postBoundaryRecords,
    simulator,
    project,
    ir,
    goalPredicate,
    candidateProfile,
  } = input;
  const behaviorOptions = { goalPredicate, profile: candidateProfile };
  const unsafeWitnesses = [];
  let unsafeCount = 0;
  let boundaryInequivalentGroups = 0;
  let safePreBoundaryGroups = 0;
  let safePostBoundaryGroups = 0;
  let behaviorAudited = 0;

  // Pair boundary records by the pre-boundary order.
  const postByIndex = new Map();
  boundaryRecords.forEach((record, index) => postByIndex.set(index, record));

  // Stage 1: pre-boundary merge groups — boundary-transfer equivalence first.
  const preByCandidate = groupByCandidate(preBoundaryRecords);
  preByCandidate.forEach((members, candidateKey) => {
    if (distinctExactKeyCount(members) <= 1) return;
    const paired = members.map((member) => ({
      member,
      post: postByIndex.get(member.boundaryIndex),
    }));
    const postFps = new Set(paired.map((p) => p.post && (p.post.postBoundaryExactFingerprint || p.post.exactStateFingerprint)));
    if (postFps.size > 1) {
      unsafeCount += 1;
      boundaryInequivalentGroups += 1;
      unsafeWitnesses.push({
        stage: "boundary-transfer",
        candidateKey,
        reason: "candidate-merged pre-boundary states materialize to different post-boundary exact identities",
        members: paired.map((p) => ({
          exactDpKey: p.member.productionDpKey,
          hp: p.member.hp,
          postBoundaryExactFingerprint: p.post && (p.post.postBoundaryExactFingerprint || p.post.exactStateFingerprint),
        })),
      });
      return;
    }
    // Boundary-equivalent: confirm via classifyPair on the materialized states.
    const postStates = paired.map((p) => p.post && p.post.state).filter(Boolean);
    const reps = representativesByExactKey(postStates.map((state, i) => ({
      productionDpKey: paired[i].member.productionDpKey,
      state,
    })));
    const classifications = [];
    const first = reps[0];
    for (const other of reps.slice(1)) {
      behaviorAudited += 1;
      const left = buildStateBehavior(simulator, project, ir, first.state, behaviorOptions);
      const right = buildStateBehavior(simulator, project, ir, other.state, behaviorOptions);
      const classification = classifyPair(left, right);
      classifications.push(classification.classification);
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
    safePreBoundaryGroups += 1;
  });

  // Stage 2: post-boundary merge groups — behavior CEGAR via classifyPair.
  const postByCandidate = groupByCandidate(postBoundaryRecords);
  postByCandidate.forEach((members, candidateKey) => {
    if (distinctExactKeyCount(members) <= 1) return;
    const reps = representativesByExactKey(members);
    const first = reps[0];
    for (const other of reps.slice(1)) {
      behaviorAudited += 1;
      const left = buildStateBehavior(simulator, project, ir, first.state, behaviorOptions);
      const right = buildStateBehavior(simulator, project, ir, other.state, behaviorOptions);
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
