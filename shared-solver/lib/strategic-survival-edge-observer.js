"use strict";

const crypto = require("node:crypto");

const { buildStateKey } = require("./state-key");
const { analyzeBattleViabilityBlocker } = require("./strategic-battle-viability");

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resourceDelta(preState, postState) {
  const pre = (preState && preState.hero) || {};
  const post = (postState && postState.hero) || {};
  return {
    hp: number(post.hp, 0) - number(pre.hp, 0),
    atk: number(post.atk, 0) - number(pre.atk, 0),
    def: number(post.def, 0) - number(pre.def, 0),
    mdef: number(post.mdef, 0) - number(pre.mdef, 0),
    exp: number(post.exp, 0) - number(pre.exp, 0),
  };
}

function actionIdentity(simulator, action) {
  const target = action && action.target ? action.target : {};
  return {
    kind: action && action.kind ? action.kind : null,
    summary: action && action.summary ? action.summary : null,
    fingerprint: typeof simulator.getActionFingerprint === "function" && action
      ? simulator.getActionFingerprint(action)
      : null,
    floorId: action && action.floorId != null
      ? action.floorId
      : action && action.travelState && action.travelState.floorId != null
        ? action.travelState.floorId
        : null,
    x: action && action.x != null ? action.x : target.x != null ? target.x : null,
    y: action && action.y != null ? action.y : target.y != null ? target.y : null,
    enemyId: action && action.enemyId != null
      ? action.enemyId
      : target.enemyId != null ? target.enemyId : null,
    itemId: action && action.itemId != null
      ? action.itemId
      : target.itemId != null ? target.itemId : null,
  };
}

function targetSignature(identity) {
  return [
    identity.kind || "action",
    identity.summary || "unknown",
    identity.floorId || "",
    identity.x == null ? "" : identity.x,
    identity.y == null ? "" : identity.y,
    identity.enemyId || identity.itemId || "",
  ].join("|");
}

/**
 * PR-5.19k observation-only survival opportunity edge attribution.
 *
 * It observes expanded connector states and every successfully applied
 * primitive transition (before seenExact suppression). bestSurvivalMargin is
 * attribution only and never influences search.
 */
function createSurvivalEdgeObserver(options) {
  const config = options || {};
  const { simulator, sourceState, boundary, maxEdges } = config;
  const sourceAnalysis = analyzeBattleViabilityBlocker(simulator, sourceState, boundary);
  const stateByKey = new Map();
  const edges = [];
  const positiveByKind = {};
  const targetSources = new Map();
  const edgeLimit = Math.max(0, number(maxEdges, 400));
  let rootKey = null;
  let bestState = null;
  let edgesObserved = 0;
  let captureTruncated = false;

  function observeState(entry) {
    if (!entry || !entry.state) return;
    if (rootKey == null && (!entry.chain || entry.chain.length === 0)) rootKey = entry.key;
    const analysis = analyzeBattleViabilityBlocker(simulator, entry.state, boundary);
    const stateRecord = {
      key: entry.key,
      fingerprint: hash(buildStateKey(entry.state)),
      chain: (entry.chain || []).map((action) => action.summary || action.kind || "step"),
      analysis,
    };
    stateByKey.set(entry.key, stateRecord);
    if (analysis.survivalMargin != null &&
        (bestState == null || analysis.survivalMargin > bestState.analysis.survivalMargin)) {
      bestState = stateRecord;
    }
  }

  function observeEdge(entry) {
    if (!entry || !entry.preState || !entry.postState) return;
    const before = analyzeBattleViabilityBlocker(simulator, entry.preState, boundary);
    const after = analyzeBattleViabilityBlocker(simulator, entry.postState, boundary);
    const beforeMargin = before.survivalMargin;
    const afterMargin = after.survivalMargin;
    const deltaMargin = beforeMargin == null || afterMargin == null
      ? null
      : afterMargin - beforeMargin;
    const deltaHp = number((entry.postState.hero || {}).hp, 0) -
      number((entry.preState.hero || {}).hp, 0);
    const deltaDamage = before.damage == null || after.damage == null
      ? null
      : after.damage - before.damage;
    const identity = actionIdentity(simulator, entry.action);
    const signature = targetSignature(identity);
    const witnessEdges = (entry.witnessEdges && entry.witnessEdges.length > 0)
      ? entry.witnessEdges
      : [{
          action: entry.action,
          fingerprint: typeof simulator.getActionFingerprint === "function"
            ? simulator.getActionFingerprint(entry.action)
            : null,
          preExactStateKey: entry.preExactStateKey,
          postExactStateKey: entry.postExactStateKey,
        }];
    const edge = {
      expansion: entry.expansion,
      depth: entry.depth,
      preExactStateKey: entry.preExactStateKey,
      postExactStateKey: entry.postExactStateKey,
      sourceExactStateKey: entry.sourceExactStateKey ||
        (witnessEdges.length > 0 ? witnessEdges[0].preExactStateKey : entry.preExactStateKey),
      witnessEdges,
      witnessChain: (entry.chainBefore || []).concat([entry.action]),
      witnessChainSummary: (entry.chainBefore || []).concat([entry.action])
        .map((action) => action.summary || action.kind || "step"),
      preStateFingerprint: hash(entry.preExactStateKey),
      postStateFingerprint: hash(entry.postExactStateKey),
      postAlreadySeen: Boolean(entry.postAlreadySeen),
      action: identity,
      actionTargetSignature: signature,
      beforeStage: before.stage,
      afterStage: after.stage,
      beforeSurvivalMargin: beforeMargin,
      afterSurvivalMargin: afterMargin,
      deltaHP: deltaHp,
      deltaDamage,
      deltaSurvivalMargin: deltaMargin,
      resourceDelta: resourceDelta(entry.preState, entry.postState),
    };
    edgesObserved += 1;
    edge.discoveryOrdinal = edgesObserved;
    if (edges.length < edgeLimit) edges.push(edge);
    else captureTruncated = true;
    if (deltaMargin != null && deltaMargin > 0) {
      positiveByKind[identity.kind || "unknown"] =
        number(positiveByKind[identity.kind || "unknown"], 0) + 1;
      if (!targetSources.has(signature)) targetSources.set(signature, new Set());
      targetSources.get(signature).add(edge.preStateFingerprint);
    }
  }

  function firstPositiveOpportunityWitness() {
    for (const edge of edges) {
      if (!(edge.deltaSurvivalMargin != null && edge.deltaSurvivalMargin > 0)) continue;
      return {
        discoveryOrdinal: edge.discoveryOrdinal,
        action: edge.action,
        actionTargetSignature: edge.actionTargetSignature,
        preExactStateKey: edge.preExactStateKey,
        postExactStateKey: edge.postExactStateKey,
        sourceExactStateKey: edge.sourceExactStateKey,
        witnessEdges: edge.witnessEdges,
        witnessChain: edge.witnessChain,
        witnessChainSummary: edge.witnessChainSummary,
        discoveryExpansion: edge.expansion,
        discoveryDepth: edge.depth,
        beforeStage: edge.beforeStage,
        afterStage: edge.afterStage,
        beforeSurvivalMargin: edge.beforeSurvivalMargin,
        afterSurvivalMargin: edge.afterSurvivalMargin,
        deltaHP: edge.deltaHP,
        deltaDamage: edge.deltaDamage,
        deltaSurvivalMargin: edge.deltaSurvivalMargin,
        resourceDelta: edge.resourceDelta,
      };
    }
    return null;
  }

  function edgeDelta(edge) {
    return edge.deltaSurvivalMargin == null ? -Infinity : edge.deltaSurvivalMargin;
  }

  function report() {
    const positiveEdges = edges.filter((edge) => edgeDelta(edge) > 0);
    const neutralEdges = edges.filter((edge) => edgeDelta(edge) === 0);
    const negativeEdges = edges.filter((edge) => edgeDelta(edge) < 0);
    const topPositiveEdges = positiveEdges
      .slice()
      .sort((left, right) => edgeDelta(right) - edgeDelta(left) ||
        (right.deltaHP - left.deltaHP))
      .slice(0, 20)
      .map((edge) => ({
        expansion: edge.expansion,
        depth: edge.depth,
        preStateFingerprint: edge.preStateFingerprint,
        postStateFingerprint: edge.postStateFingerprint,
        postAlreadySeen: edge.postAlreadySeen,
        action: edge.action,
        actionTargetSignature: edge.actionTargetSignature,
        beforeStage: edge.beforeStage,
        afterStage: edge.afterStage,
        beforeSurvivalMargin: edge.beforeSurvivalMargin,
        afterSurvivalMargin: edge.afterSurvivalMargin,
        deltaHP: edge.deltaHP,
        deltaDamage: edge.deltaDamage,
        deltaSurvivalMargin: edge.deltaSurvivalMargin,
        resourceDelta: edge.resourceDelta,
      }));
    const positiveOpportunityTargetsSeenAcrossMultipleSources = Array.from(targetSources.entries())
      .filter(([, sources]) => sources.size > 1)
      .map(([signature, sources]) => ({
        signature,
        sourceCount: sources.size,
        sources: Array.from(sources).slice(0, 8),
      }))
      .sort((left, right) => right.sourceCount - left.sourceCount)
      .slice(0, 16);

    const bestChain = bestState ? bestState.chain : [];
    const bestChainEdgeDecomposition = [];
    let currentKey = rootKey;
    for (let index = 0; index < bestChain.length && currentKey != null; index += 1) {
      const actionSummary = bestChain[index];
      const matching = edges.find((edge) =>
        edge.preExactStateKey === currentKey &&
        edge.action.summary === actionSummary &&
        edge.depth === index);
      if (!matching) break;
      bestChainEdgeDecomposition.push({
        index,
        action: matching.action,
        beforeSurvivalMargin: matching.beforeSurvivalMargin,
        afterSurvivalMargin: matching.afterSurvivalMargin,
        deltaHP: matching.deltaHP,
        deltaDamage: matching.deltaDamage,
        deltaSurvivalMargin: matching.deltaSurvivalMargin,
        resourceDelta: matching.resourceDelta,
      });
      currentKey = matching.postExactStateKey;
    }

    return {
      source: {
        stage: sourceAnalysis.stage,
        hp: number((sourceState.hero || {}).hp, 0),
        damage: sourceAnalysis.damage,
        survivalMargin: sourceAnalysis.survivalMargin,
      },
      aggregate: {
        edgesObserved,
        totalEdgesObserved: edgesObserved,
        capturedEdges: edges.length,
        captureLimit: edgeLimit,
        captureComplete: !captureTruncated,
        positiveSurvivalEdges: positiveEdges.length,
        neutralEdges: neutralEdges.length,
        negativeSurvivalEdges: negativeEdges.length,
        positiveByActionKind: positiveByKind,
        positiveUniqueActionTargets: targetSources.size,
        positiveOpportunityTargetsSeenAcrossMultipleSources,
        topPositiveEdges,
      },
      bestChainEdgeDecomposition,
    };
  }

  function snapshot() {
    return {
      edges: edges.slice(),
      edgesObserved,
      capturedEdges: edges.length,
      maxEdges: edgeLimit,
      captureComplete: !captureTruncated,
      rootKey,
    };
  }

  return { observeState, observeEdge, report, snapshot, firstPositiveOpportunityWitness };
}

module.exports = {
  createSurvivalEdgeObserver,
};
