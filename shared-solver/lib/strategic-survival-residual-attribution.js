"use strict";

const { recordedActionVariantIdentity } = require("./route-store");
const { verifyConnectorChain } = require("./strategic-connector");

function edgeActionVariantIdentity(edge) {
  if (!edge || !edge.action) return null;
  try {
    return recordedActionVariantIdentity(edge.action);
  } catch (_error) {
    return edge.fingerprint || null;
  }
}

function equivalentEdge(left, right) {
  return Boolean(left && right) &&
    left.preExactStateKey === right.preExactStateKey &&
    left.postExactStateKey === right.postExactStateKey &&
    edgeActionVariantIdentity(left) === edgeActionVariantIdentity(right);
}

function isNamedPositiveBattleOpportunity(edge) {
  return Boolean(edge && edge.action &&
    edge.action.kind === "battle" &&
    edge.action.enemyId &&
    edge.deltaSurvivalMargin != null &&
    edge.deltaSurvivalMargin > 0);
}

function firstPrefixCompatibleReplayValidResidual(options) {
  const config = options || {};
  const simulator = config.simulator;
  const selectedWitness = config.selectedWitness;
  const selectedPostState = config.selectedPostState;
  const snapshot = config.snapshot || {};
  if (snapshot.captureComplete !== true) return null;
  const edges = Array.isArray(snapshot.edges) ? snapshot.edges : [];
  const selectedEdges = selectedWitness && selectedWitness.witnessEdges;
  const selectedSourceExactStateKey = selectedWitness && selectedWitness.sourceExactStateKey;
  const selectedPostExactStateKey = selectedWitness && selectedWitness.postExactStateKey;
  const selectedOrdinal = selectedWitness && selectedWitness.discoveryOrdinal;
  if (!Array.isArray(selectedEdges) || selectedPostExactStateKey == null) return null;

  for (let index = 0; index < edges.length; index += 1) {
    const edge = edges[index];
    const ordinal = edge.discoveryOrdinal == null ? index + 1 : edge.discoveryOrdinal;
    if (selectedOrdinal != null && ordinal <= selectedOrdinal) continue;
    if (!isNamedPositiveBattleOpportunity(edge)) continue;
    const candidateEdges = Array.isArray(edge.witnessEdges) ? edge.witnessEdges : [];
    if (selectedSourceExactStateKey && candidateEdges[0] &&
        candidateEdges[0].preExactStateKey !== selectedSourceExactStateKey) continue;
    if (!findExactPrefix(selectedEdges, candidateEdges)) continue;
    const suffix = candidateEdges.slice(selectedEdges.length);
    const replay = verifyConnectorChain(simulator, selectedPostState, suffix, {
      expectedPostExactStateKey: edge.postExactStateKey,
    });
    if (!replay.valid) continue;
    return {
      edge,
      candidateEdges,
      suffix,
      replay,
      discoveryOrdinal: ordinal,
    };
  }
  return null;
}

function attributePostO3ResidualPrefix(options) {
  const config = options || {};
  const simulator = config.simulator;
  const selectedPrefixEdges = config.selectedPrefixEdges;
  const selectedPostState = config.selectedPostState;
  const selectedPostExactStateKey = config.selectedPostExactStateKey;
  const selectedSourceExactStateKey = config.selectedSourceExactStateKey;
  const selectedOrdinal = config.selectedDiscoveryOrdinal;
  const snapshot = config.snapshot || {};
  const edges = Array.isArray(snapshot.edges) ? snapshot.edges : [];
  const captureComplete = snapshot.captureComplete === true;
  const candidates = [];
  if (!Array.isArray(selectedPrefixEdges) || selectedPostExactStateKey == null) {
    return {
      schema: "motapathfinder.strategic-post-o3-residual-prefix-attribution.v1",
      classification: "CAPTURE-INCOMPLETE",
      captureComplete: false,
      observedEdges: snapshot.edgesObserved == null ? edges.length : snapshot.edgesObserved,
      capturedEdges: edges.length,
      selectedPrefixLength: Array.isArray(selectedPrefixEdges) ? selectedPrefixEdges.length : 0,
      selectedPostExactStateKey: selectedPostExactStateKey || null,
      candidates,
    };
  }

  for (let index = 0; index < edges.length; index += 1) {
    const edge = edges[index];
    const ordinal = edge.discoveryOrdinal == null ? index + 1 : edge.discoveryOrdinal;
    if (selectedOrdinal != null && ordinal <= selectedOrdinal) continue;
    if (!isNamedPositiveBattleOpportunity(edge)) continue;
    const candidateEdges = Array.isArray(edge.witnessEdges) ? edge.witnessEdges : [];
    const sourceCompatible = !selectedSourceExactStateKey || !candidateEdges[0] ||
      candidateEdges[0].preExactStateKey === selectedSourceExactStateKey;
    const prefixCompatible = sourceCompatible && findExactPrefix(selectedPrefixEdges, candidateEdges);
    if (!prefixCompatible) {
      candidates.push(compactCandidate(edge, ordinal, null, -1, [], null));
      continue;
    }
    const suffix = candidateEdges.slice(selectedPrefixEdges.length);
    const replay = verifyConnectorChain(simulator, selectedPostState, suffix, {
      expectedPostExactStateKey: edge.postExactStateKey,
    });
    candidates.push(compactCandidate(
      edge,
      ordinal,
      "exact-prefix-only",
      selectedPrefixEdges.length,
      suffix,
      replay,
    ));
  }

  const validCandidates = candidates.filter((candidate) => candidate.suffixReplayValid === true);
  const compatibleReplayFailures = candidates.filter((candidate) =>
    candidate.compatibilityKind === "exact-prefix-only" && candidate.suffixReplayValid === false);
  const incompatibleCandidates = candidates.filter((candidate) => !candidate.compatibilityKind);
  let classification;
  if (!captureComplete) {
    classification = "CAPTURE-INCOMPLETE";
  } else if (validCandidates.length > 0) {
    classification = "P1";
  } else if (compatibleReplayFailures.length > 0) {
    classification = "P3";
  } else if (incompatibleCandidates.length > 0) {
    classification = "P2";
  } else {
    classification = "P4";
  }
  return {
    schema: "motapathfinder.strategic-post-o3-residual-prefix-attribution.v1",
    classification,
    captureComplete,
    observedEdges: snapshot.edgesObserved == null ? edges.length : snapshot.edgesObserved,
    capturedEdges: edges.length,
    captureLimit: snapshot.maxEdges == null ? null : snapshot.maxEdges,
    selectedPrefixLength: selectedPrefixEdges.length,
    selectedDiscoveryOrdinal: selectedOrdinal == null ? null : selectedOrdinal,
    selectedPostExactStateKey,
    laterPositiveOpportunityCount: candidates.length,
    candidates,
  };
}

function findExactPrefix(prefix, candidate) {
  if (!Array.isArray(prefix) || !Array.isArray(candidate) || prefix.length > candidate.length) {
    return false;
  }
  return prefix.every((edge, index) => equivalentEdge(edge, candidate[index]));
}

function findRerootStart(candidate, postExactStateKey) {
  if (!Array.isArray(candidate) || postExactStateKey == null) return -1;
  return candidate.findIndex((edge) => edge && edge.preExactStateKey === postExactStateKey);
}

function compactCandidate(edge, ordinal, compatibilityKind, compatibilityStartEdge, suffix, replay) {
  const action = edge.action || {};
  return {
    candidateTarget: edge.actionTargetSignature || action.summary || null,
    candidateDiscoveryOrdinal: ordinal,
    candidateDiscoveryExpansion: edge.expansion,
    candidateDiscoveryDepth: edge.depth,
    sourceExactStateKey: edge.sourceExactStateKey || null,
    candidatePreExactStateKey: edge.preExactStateKey || null,
    candidatePostExactStateKey: edge.postExactStateKey || null,
    compatibilityKind,
    compatibilityStartEdge,
    suffixLength: suffix.length,
    suffixReplayValid: replay ? replay.valid : null,
    replayFailureReason: replay ? replay.failureReason || null : "branch-incompatible",
    expectedPostExactStateKey: edge.postExactStateKey || null,
  };
}

/**
 * PR-5.19n observation-only paid witness graph attribution.
 *
 * This helper never creates a solver node or schedules work. It only checks
 * whether later positive battle edges can be replayed from a selected witness
 * post-state using evidence retained by the same failed connector attempt.
 */
function attributeResidualPaidWitnessGraph(options) {
  const config = options || {};
  const simulator = config.simulator;
  const selectedWitness = config.selectedWitness;
  const selectedPostState = config.selectedPostState;
  const snapshot = config.snapshot || {};
  const edges = Array.isArray(snapshot.edges) ? snapshot.edges : [];
  const captureComplete = snapshot.captureComplete === true;
  const selectedEdges = selectedWitness && selectedWitness.witnessEdges;
  const selectedSourceExactStateKey = selectedWitness && selectedWitness.sourceExactStateKey;
  const selectedPostExactStateKey = selectedWitness && selectedWitness.postExactStateKey;
  const selectedOrdinal = selectedWitness && selectedWitness.discoveryOrdinal;
  const candidates = [];

  for (let index = 0; index < edges.length; index += 1) {
    const edge = edges[index];
    const ordinal = edge.discoveryOrdinal == null ? index + 1 : edge.discoveryOrdinal;
    if (selectedOrdinal != null && ordinal <= selectedOrdinal) continue;
    if (!isNamedPositiveBattleOpportunity(edge)) continue;

    const candidateEdges = Array.isArray(edge.witnessEdges) ? edge.witnessEdges : [];
    if (selectedSourceExactStateKey && candidateEdges[0] &&
        candidateEdges[0].preExactStateKey !== selectedSourceExactStateKey) {
      candidates.push(compactCandidate(edge, ordinal, null, -1, [], null));
      continue;
    }
    const prefixCompatible = findExactPrefix(selectedEdges, candidateEdges);
    let compatibilityKind = null;
    let compatibilityStartEdge = -1;
    if (prefixCompatible) {
      compatibilityKind = "prefix-compatible";
      compatibilityStartEdge = selectedEdges.length;
    } else {
      const rerootStart = findRerootStart(candidateEdges, selectedPostExactStateKey);
      if (rerootStart >= 0) {
        compatibilityKind = "exact-state-reroot-compatible";
        compatibilityStartEdge = rerootStart;
      }
    }

    if (!compatibilityKind) {
      candidates.push(compactCandidate(
        edge,
        ordinal,
        null,
        -1,
        [],
        null,
      ));
      continue;
    }

    const suffix = candidateEdges.slice(compatibilityStartEdge);
    const replay = verifyConnectorChain(simulator, selectedPostState, suffix, {
      expectedPostExactStateKey: edge.postExactStateKey,
    });
    candidates.push(compactCandidate(
      edge,
      ordinal,
      compatibilityKind,
      compatibilityStartEdge,
      suffix,
      replay,
    ));
  }

  const validCandidates = candidates.filter((candidate) => candidate.suffixReplayValid === true);
  const compatibleReplayFailures = candidates.filter((candidate) =>
    candidate.compatibilityKind && candidate.suffixReplayValid === false);
  const incompatibleCandidates = candidates.filter((candidate) => !candidate.compatibilityKind);
  let classification;
  if (!captureComplete) {
    classification = "CAPTURE-INCOMPLETE";
  } else if (validCandidates.length > 0) {
    classification = "R1";
  } else if (compatibleReplayFailures.length > 0) {
    classification = "R3";
  } else if (incompatibleCandidates.length > 0) {
    classification = "R2";
  } else {
    classification = "R4";
  }

  return {
    schema: "motapathfinder.strategic-survival-residual-attribution.v1",
    classification,
    captureComplete,
    observedEdges: snapshot.edgesObserved == null ? edges.length : snapshot.edgesObserved,
    capturedEdges: edges.length,
    captureLimit: snapshot.maxEdges == null ? null : snapshot.maxEdges,
    selectedDiscoveryOrdinal: selectedOrdinal == null ? null : selectedOrdinal,
    selectedSourceExactStateKey: selectedSourceExactStateKey || null,
    selectedPostExactStateKey: selectedPostExactStateKey || null,
    laterPositiveOpportunityCount: candidates.length,
    candidates,
  };
}

module.exports = {
  attributeResidualPaidWitnessGraph,
  attributePostO3ResidualPrefix,
  equivalentEdge,
  firstPrefixCompatibleReplayValidResidual,
  findExactPrefix,
  findRerootStart,
};
