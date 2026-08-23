"use strict";

const fs = require("fs");
const path = require("path");
const { performance } = require("node:perf_hooks");

let activeTracker = null;

function nowMs() {
  return performance.now();
}

function createPhaseBucket() {
  return { ms: 0, count: 0 };
}

function createPerfTracker(options) {
  const config = options || {};
  const enabled = Boolean(config.enabled);
  const profileExpansionCost = Boolean(config.profileExpansionCost || config.expansionCostProfile);
  const slowExpansionLimit = Math.max(1, Number(config.slowExpansionLimit || 20));
  const startedAt = nowMs();
  const startedCpu = process.cpuUsage();
  const startedElu = performance.eventLoopUtilization ? performance.eventLoopUtilization() : null;

  // Generic legacy phases
  const phaseMs = {};
  const phaseSelfMs = {};
  const phaseStack = [];
  const counters = {
    expanded: 0,
    generated: 0,
    registered: 0,
    duplicates: 0,
  };

  // Top-level mutually exclusive buckets
  // 1. walkReachability
  // 2. primitiveEnumeration
  // 3. actionEvaluation
  // 4. applyAction
  // 5. stabilization
  // 6. stateKeyAndDominance
  // 7. frontierQueue
  // 8. otherExpansionOverhead
  const topLevelSelfMs = {
    walkReachability: 0,
    primitiveEnumeration: 0,
    actionEvaluation: 0,
    applyAction: 0,
    stabilization: 0,
    stateKeyAndDominance: 0,
    frontierQueue: 0,
    otherExpansionOverhead: 0,
  };

  const topLevelStack = [];

  // Read-only stabilization subphases
  const stabilizationSubphases = {
    hazardBuild: 0,
    pickupScan: 0,
    battleScan: 0,
    autoEvent: 0,
    applyStep: 0,
  };

  // Explicit semantic counters (separate from timer counts)
  const semanticCounters = {
    expansions: 0,
    generated: 0,
    registered: 0,
    duplicates: 0,
    primitiveEnumerationCalls: 0,
    applyActionCalls: 0,
    stabilizeStateCalls: 0,
    stabilizationPasses: 0,
    dpKeyBuildCalls: 0,
    dominanceLookupCalls: 0,
    dominanceRejects: 0,
    frontierRankCalls: 0,
    frontierPushCalls: 0,
    frontierPopCalls: 0,
  };

  let peakRssBytes = 0;
  let peakHeapBytes = 0;
  let memorySampleCount = 0;
  let totalExpansionElapsedMs = 0;

  // Expansion-level attribution state (bounded, only active when profileExpansionCost is true)
  let currentExpansion = null;
  const slowExpansionSamples = [];

  function ensurePhase(name) {
    if (!phaseMs[name]) phaseMs[name] = createPhaseBucket();
    return phaseMs[name];
  }

  function ensureSelfPhase(name) {
    if (!phaseSelfMs[name]) phaseSelfMs[name] = createPhaseBucket();
    return phaseSelfMs[name];
  }

  function addPhase(name, ms) {
    if (!enabled) return;
    const bucket = ensurePhase(name);
    bucket.ms += ms;
    bucket.count += 1;
    const selfBucket = ensureSelfPhase(name);
    selfBucket.ms += ms;
    selfBucket.count += 1;
    const parent = phaseStack[phaseStack.length - 1];
    if (parent) parent.childMs += ms;
  }

  function timePhase(name, fn) {
    if (!enabled || typeof fn !== "function") return fn();
    const started = nowMs();
    const frame = { name, childMs: 0 };
    phaseStack.push(frame);
    try {
      return fn();
    } finally {
      const elapsed = nowMs() - started;
      phaseStack.pop();
      const bucket = ensurePhase(name);
      bucket.ms += elapsed;
      bucket.count += 1;
      const selfBucket = ensureSelfPhase(name);
      const selfElapsed = Math.max(0, elapsed - frame.childMs);
      selfBucket.ms += selfElapsed;
      selfBucket.count += 1;
      const parent = phaseStack[phaseStack.length - 1];
      if (parent) parent.childMs += elapsed;
    }
  }

  function beginTopLevelPhase(name) {
    if (!enabled || !profileExpansionCost) return;
    const started = nowMs();
    topLevelStack.push({ name, started, childTopLevelMs: 0 });
  }

  function endTopLevelPhase(name) {
    if (!enabled || !profileExpansionCost) return;
    const ended = nowMs();
    const frame = topLevelStack.pop();
    if (!frame) return;
    const elapsed = Math.max(0, ended - frame.started);
    const selfElapsed = Math.max(0, elapsed - frame.childTopLevelMs);
    topLevelSelfMs[frame.name] = (topLevelSelfMs[frame.name] || 0) + selfElapsed;

    const parent = topLevelStack[topLevelStack.length - 1];
    if (parent) {
      parent.childTopLevelMs += elapsed;
    }

    if (currentExpansion) {
      currentExpansion.topLevelSelf[frame.name] = (currentExpansion.topLevelSelf[frame.name] || 0) + selfElapsed;
    }
  }

  function recordStabilizationSubphase(subphase, ms) {
    if (!enabled || !profileExpansionCost) return;
    if (stabilizationSubphases[subphase] != null) {
      stabilizationSubphases[subphase] += Math.max(0, Number(ms || 0));
    }
  }

  function timeStabilizationSubphase(subphase, fn) {
    if (!enabled || !profileExpansionCost || typeof fn !== "function") return fn();
    const started = nowMs();
    try {
      return fn();
    } finally {
      const elapsed = Math.max(0, nowMs() - started);
      recordStabilizationSubphase(subphase, elapsed);
    }
  }

  function increment(name, amount) {
    if (!enabled) return;
    const count = Number(amount || 1);
    counters[name] = (counters[name] || 0) + count;
    if (semanticCounters[name] != null) {
      semanticCounters[name] += count;
    }
  }

  function getCounter(name) {
    return Number(semanticCounters[name] || 0);
  }

  function recordMemorySample(memory) {
    if (!enabled || !memory) return;
    memorySampleCount += 1;
    if (memory.heapUsed > peakHeapBytes) peakHeapBytes = memory.heapUsed;
    if (memory.rss > peakRssBytes) peakRssBytes = memory.rss;
  }

  function beginExpansion(expansionIndex, state, frontierBefore, snapshotData) {
    if (!enabled || !profileExpansionCost) return null;
    currentExpansion = {
      expansionIndex,
      floorId: state ? state.floorId : "unknown",
      decisionDepth: state && state.meta && typeof state.meta.decisionDepth === "number"
        ? state.meta.decisionDepth
        : 0,
      frontierBefore: Number(frontierBefore || 0),
      startedAt: nowMs(),
      topLevelSelf: {},
      startReachableNodes: snapshotData ? Number(snapshotData.reachableNodes || 0) : 0,
      startBattleEstimateMisses: snapshotData ? Number(snapshotData.battleEstimateMisses || 0) : 0,
      startStabilizationPasses: Number(semanticCounters.stabilizationPasses || 0),
    };
    return currentExpansion;
  }

  function endExpansion(expansionIndex, state, frontierAfter, details) {
    if (!enabled || !profileExpansionCost || !currentExpansion) return;
    const endedAt = nowMs();
    const expansionElapsed = Math.max(0, endedAt - currentExpansion.startedAt);
    totalExpansionElapsedMs += expansionElapsed;

    const expTopLevelSelf = currentExpansion.topLevelSelf;
    let expSelfSum = 0;
    let dominantPhase = "otherExpansionOverhead";
    let maxPhaseMs = 0;
    Object.entries(expTopLevelSelf).forEach(([phase, ms]) => {
      expSelfSum += ms;
      if (ms > maxPhaseMs) {
        maxPhaseMs = ms;
        dominantPhase = phase;
      }
    });

    const expOverhead = Math.max(0, expansionElapsed - expSelfSum);
    topLevelSelfMs.otherExpansionOverhead += expOverhead;
    if (expOverhead > maxPhaseMs) {
      dominantPhase = "otherExpansionOverhead";
    }

    const endReachableNodes = details ? Number(details.reachableNodes || 0) : 0;
    const endBattleMisses = details ? Number(details.battleEstimateMisses || 0) : 0;
    const endStabilizationPasses = Number(semanticCounters.stabilizationPasses || 0);

    const reachableNodesDelta = Math.max(0, endReachableNodes - currentExpansion.startReachableNodes);
    const battleMissesDelta = Math.max(0, endBattleMisses - currentExpansion.startBattleEstimateMisses);
    const stabilizationPassesDelta = Math.max(0, endStabilizationPasses - currentExpansion.startStabilizationPasses);

    const sample = {
      expansionIndex,
      floorId: state ? state.floorId : currentExpansion.floorId,
      decisionDepth: details && typeof details.decisionDepth === "number"
        ? details.decisionDepth
        : currentExpansion.decisionDepth,
      totalSelfMs: Number(expansionElapsed.toFixed(3)),
      dominantPhase,
      actionsGenerated: Number((details && details.actionsGenerated) || 0),
      reachableNodes: reachableNodesDelta,
      battleEstimateMisses: battleMissesDelta,
      stabilizationPasses: stabilizationPassesDelta,
      frontierBefore: currentExpansion.frontierBefore,
      frontierAfter: Number(frontierAfter || 0),
    };

    if (slowExpansionSamples.length < slowExpansionLimit) {
      slowExpansionSamples.push(sample);
      slowExpansionSamples.sort((a, b) => b.totalSelfMs - a.totalSelfMs);
    } else if (sample.totalSelfMs > slowExpansionSamples[slowExpansionSamples.length - 1].totalSelfMs) {
      slowExpansionSamples[slowExpansionSamples.length - 1] = sample;
      slowExpansionSamples.sort((a, b) => b.totalSelfMs - a.totalSelfMs);
    }

    currentExpansion = null;
  }

  function getExpansionCostReport(extra) {
    const totalWallMs = nowMs() - startedAt;
    const cpu = process.cpuUsage(startedCpu);
    const cpuUserMs = cpu.user / 1000;
    const cpuSystemMs = cpu.system / 1000;
    const cpuMs = cpuUserMs + cpuSystemMs;

    const expanded = Number((extra && extra.expanded) || semanticCounters.expansions || 0);
    const generated = Number((extra && extra.generated) || semanticCounters.generated || 0);
    const registered = Number((extra && extra.registered) || semanticCounters.registered || 0);
    const duplicates = Number((extra && extra.duplicates) || semanticCounters.duplicates || 0);
    const frontierSize = Number((extra && extra.frontierSize) || 0);

    const walkReachabilitySelfMs = topLevelSelfMs.walkReachability;
    const primitiveEnumerationSelfMs = topLevelSelfMs.primitiveEnumeration;
    const actionEvaluationSelfMs = topLevelSelfMs.actionEvaluation;
    const applyActionSelfMs = topLevelSelfMs.applyAction;
    const stabilizationSelfMs = topLevelSelfMs.stabilization;
    const stateKeyAndDominanceSelfMs = topLevelSelfMs.stateKeyAndDominance;
    const frontierQueueSelfMs = topLevelSelfMs.frontierQueue;
    const otherExpansionOverheadSelfMs = topLevelSelfMs.otherExpansionOverhead;

    const attributedSelfMs = walkReachabilitySelfMs + primitiveEnumerationSelfMs +
                             actionEvaluationSelfMs + applyActionSelfMs +
                             stabilizationSelfMs + stateKeyAndDominanceSelfMs +
                             frontierQueueSelfMs;

    const expansionWallMs = totalExpansionElapsedMs > 0
      ? totalExpansionElapsedMs
      : (attributedSelfMs + otherExpansionOverheadSelfMs);

    const unattributedMs = Math.max(0, expansionWallMs - attributedSelfMs);

    // Fail-closed verification
    const sumAllTopLevel = attributedSelfMs + otherExpansionOverheadSelfMs;
    const unmappedPhaseSelfMs = Number(Math.abs(sumAllTopLevel - expansionWallMs).toFixed(3));

    const coverageRatio = expansionWallMs > 0
      ? Number((attributedSelfMs / expansionWallMs).toFixed(4))
      : 1;

    const topLevelPercentages = {
      walkReachability: Number(((walkReachabilitySelfMs / expansionWallMs) * 100).toFixed(2)),
      primitiveEnumeration: Number(((primitiveEnumerationSelfMs / expansionWallMs) * 100).toFixed(2)),
      actionEvaluation: Number(((actionEvaluationSelfMs / expansionWallMs) * 100).toFixed(2)),
      applyAction: Number(((applyActionSelfMs / expansionWallMs) * 100).toFixed(2)),
      stabilization: Number(((stabilizationSelfMs / expansionWallMs) * 100).toFixed(2)),
      stateKeyAndDominance: Number(((stateKeyAndDominanceSelfMs / expansionWallMs) * 100).toFixed(2)),
      frontierQueue: Number(((frontierQueueSelfMs / expansionWallMs) * 100).toFixed(2)),
      otherExpansionOverhead: Number(((otherExpansionOverheadSelfMs / expansionWallMs) * 100).toFixed(2)),
    };

    const simStats = (extra && extra.simulatorCacheStats) || {};
    const skeletonStats = simStats.reachabilitySkeleton || {};
    const reachabilityStats = simStats.reachability || {};
    const battleResolverStats = simStats.battleResolver || {};
    const battleEstimateStats = battleResolverStats.battleEstimate || {};

    const otherStabilizationMs = Math.max(0, stabilizationSelfMs - (
      stabilizationSubphases.hazardBuild +
      stabilizationSubphases.pickupScan +
      stabilizationSubphases.battleScan +
      stabilizationSubphases.autoEvent +
      stabilizationSubphases.applyStep
    ));

    const inclusiveSubsystems = {
      walkReachability: {
        calls: Number(skeletonStats.rebases || expanded),
        totalMs: Number(walkReachabilitySelfMs.toFixed(3)),
        skeletonHits: Number(skeletonStats.hits || 0),
        skeletonMisses: Number(skeletonStats.misses || 0),
        rebases: Number(skeletonStats.rebases || 0),
        nodesMaterialized: Number(skeletonStats.nodesMaterialized || 0),
        nodesExpanded: Number(reachabilityStats.nodesExpanded || 0),
        safeFastBuilds: Number(reachabilityStats.safeFastBuilds || 0),
        legacyExactBuilds: Number(reachabilityStats.legacyExactBuilds || 0),
      },
      enumeratePrimitiveActions: {
        calls: Number(semanticCounters.primitiveEnumerationCalls || expanded),
        actionsProduced: generated,
        totalMs: Number((primitiveEnumerationSelfMs + walkReachabilitySelfMs).toFixed(3)),
      },
      battleEstimates: {
        calls: Number((battleEstimateStats.hits || 0) + (battleEstimateStats.misses || 0)),
        hits: Number(battleEstimateStats.hits || 0),
        misses: Number(battleEstimateStats.misses || 0),
        totalMs: Number((battleEstimateStats.totalMs || 0).toFixed(3)),
      },
      applyAction: {
        calls: Number(semanticCounters.applyActionCalls || generated),
        totalMs: Number((applyActionSelfMs + stabilizationSelfMs).toFixed(3)),
      },
      stabilizeState: {
        calls: Number(semanticCounters.stabilizeStateCalls || 0),
        passes: Number(semanticCounters.stabilizationPasses || 0),
        totalMs: Number(stabilizationSelfMs.toFixed(3)),
        subphases: {
          hazardBuildMs: Number(stabilizationSubphases.hazardBuild.toFixed(3)),
          pickupScanMs: Number(stabilizationSubphases.pickupScan.toFixed(3)),
          battleScanMs: Number(stabilizationSubphases.battleScan.toFixed(3)),
          autoEventMs: Number(stabilizationSubphases.autoEvent.toFixed(3)),
          applyStepMs: Number(stabilizationSubphases.applyStep.toFixed(3)),
          otherMs: Number(otherStabilizationMs.toFixed(3)),
        },
      },
      buildStateKey: {
        calls: 0,
        totalMs: 0,
      },
      buildDpStateKey: {
        calls: Number(semanticCounters.dpKeyBuildCalls || generated),
        totalMs: Number(stateKeyAndDominanceSelfMs.toFixed(3)),
      },
      dominance: {
        lookups: Number(semanticCounters.dominanceLookupCalls || 0),
        rejects: Number(semanticCounters.dominanceRejects || duplicates),
        replaces: 0,
        totalMs: Number(stateKeyAndDominanceSelfMs.toFixed(3)),
      },
      frontierQueue: {
        pushes: Number(semanticCounters.frontierPushCalls || registered),
        pops: Number(semanticCounters.frontierPopCalls || expanded),
        ranks: Number(semanticCounters.frontierRankCalls || registered),
        totalMs: Number(frontierQueueSelfMs.toFixed(3)),
      },
    };

    const msPerExpansion = expanded > 0 ? Number((expansionWallMs / expanded).toFixed(4)) : 0;
    const expansionsPerSec = expansionWallMs > 0 ? Number(((expanded / (expansionWallMs / 1000))).toFixed(2)) : 0;
    const msPerGeneratedAction = generated > 0 ? Number((expansionWallMs / generated).toFixed(4)) : 0;
    const generatedPerSec = expansionWallMs > 0 ? Number(((generated / (expansionWallMs / 1000))).toFixed(2)) : 0;

    return {
      schema: "motapathfinder.expansion-cost-attribution.v1",
      deterministic: {
        expansions: expanded,
        generated,
        registered,
        duplicates,
        frontierSize,
        actionCounts: (extra && extra.actionCounts) || {},
        cacheHitMiss: {
          reachabilitySkeleton: {
            hits: Number(skeletonStats.hits || 0),
            misses: Number(skeletonStats.misses || 0),
            rebases: Number(skeletonStats.rebases || 0),
            nodesMaterialized: Number(skeletonStats.nodesMaterialized || 0),
          },
          battleEstimate: {
            hits: Number(battleEstimateStats.hits || 0),
            misses: Number(battleEstimateStats.misses || 0),
            stores: Number(battleEstimateStats.stores || 0),
          },
        },
        keyBuildCounts: {
          stateKeyBuilds: 0,
          dpStateKeyBuilds: Number(semanticCounters.dpKeyBuildCalls || generated),
        },
        semanticCalls: {
          primitiveEnumerations: Number(semanticCounters.primitiveEnumerationCalls || expanded),
          applyActions: Number(semanticCounters.applyActionCalls || generated),
          stabilizeStates: Number(semanticCounters.stabilizeStateCalls || 0),
          stabilizationPasses: Number(semanticCounters.stabilizationPasses || 0),
          frontierPushes: Number(semanticCounters.frontierPushCalls || registered),
          frontierPops: Number(semanticCounters.frontierPopCalls || expanded),
          frontierRanks: Number(semanticCounters.frontierRankCalls || registered),
          dominanceLookups: Number(semanticCounters.dominanceLookupCalls || 0),
          dominanceRejects: Number(semanticCounters.dominanceRejects || duplicates),
        },
        bestProgress: (extra && extra.bestProgress) || null,
      },
      timingDirectional: {
        wallMs: Number(totalWallMs.toFixed(3)),
        cpuUserMs: Number(cpuUserMs.toFixed(3)),
        cpuSystemMs: Number(cpuSystemMs.toFixed(3)),
        cpuMs: Number(cpuMs.toFixed(3)),
        cpuUtilization: totalWallMs > 0 ? Number((cpuMs / totalWallMs).toFixed(3)) : 0,
        expansionWallMs: Number(expansionWallMs.toFixed(3)),
        attributedSelfMs: Number(attributedSelfMs.toFixed(3)),
        unattributedMs: Number(unattributedMs.toFixed(3)),
        unmappedPhaseSelfMs,
        coverageRatio,
        topLevelSelfMs: {
          walkReachability: Number(walkReachabilitySelfMs.toFixed(3)),
          primitiveEnumeration: Number(primitiveEnumerationSelfMs.toFixed(3)),
          actionEvaluation: Number(actionEvaluationSelfMs.toFixed(3)),
          applyAction: Number(applyActionSelfMs.toFixed(3)),
          stabilization: Number(stabilizationSelfMs.toFixed(3)),
          stateKeyAndDominance: Number(stateKeyAndDominanceSelfMs.toFixed(3)),
          frontierQueue: Number(frontierQueueSelfMs.toFixed(3)),
          otherExpansionOverhead: Number(otherExpansionOverheadSelfMs.toFixed(3)),
        },
        topLevelSelfPercentages: topLevelPercentages,
        inclusiveSubsystems,
        perExpansionAverages: {
          msPerExpansion,
          expansionsPerSec,
          msPerGeneratedAction,
          generatedPerSec,
        },
        slowExpansionSamples: slowExpansionSamples.slice(0, slowExpansionLimit),
      },
    };
  }

  function snapshot(extra) {
    const wallMs = nowMs() - startedAt;
    const cpu = process.cpuUsage(startedCpu);
    const cpuUserMs = cpu.user / 1000;
    const cpuSystemMs = cpu.system / 1000;
    const memory = process.memoryUsage();
    const elu = startedElu && performance.eventLoopUtilization
      ? performance.eventLoopUtilization(startedElu)
      : null;
    const expanded = Number((extra && extra.expanded) || counters.expanded || 0);
    const generated = Number((extra && extra.generated) || counters.generated || 0);
    const registered = Number((extra && extra.registered) || counters.registered || 0);
    const duplicates = Number((extra && extra.duplicates) || counters.duplicates || 0);
    const report = {
      wallMs,
      cpuUserMs,
      cpuSystemMs,
      cpuUtilization: wallMs > 0 ? (cpuUserMs + cpuSystemMs) / wallMs : 0,
      eventLoopUtilization: elu ? elu.utilization : null,
      expanded,
      generated,
      registered,
      duplicates,
      ...counters,
      expandedPerSec: wallMs > 0 ? expanded / (wallMs / 1000) : 0,
      generatedPerSec: wallMs > 0 ? generated / (wallMs / 1000) : 0,
      rssMb: memory.rss / 1024 / 1024,
      heapUsedMb: memory.heapUsed / 1024 / 1024,
      peakRssMb: peakRssBytes > 0 ? peakRssBytes / 1024 / 1024 : memory.rss / 1024 / 1024,
      peakHeapUsedMb: peakHeapBytes > 0 ? peakHeapBytes / 1024 / 1024 : memory.heapUsed / 1024 / 1024,
      memorySampleCount,
      semanticCounters: { ...semanticCounters },
      phaseMs: Object.fromEntries(Object.entries(phaseMs).map(([k, v]) => [k, v.ms])),
      phaseSelfMs: Object.fromEntries(Object.entries(phaseSelfMs).map(([k, v]) => [k, v.ms])),
      phaseCounts: Object.fromEntries(Object.entries(phaseMs).map(([k, v]) => [k, v.count])),
      extra: extra || {},
      ...(extra || {}),
    };
    if (profileExpansionCost) {
      report.expansionCost = getExpansionCostReport(extra);
    }
    return report;
  }

  return {
    enabled,
    profileExpansionCost,
    addPhase,
    timePhase,
    beginTopLevelPhase,
    endTopLevelPhase,
    timeStabilizationSubphase,
    recordStabilizationSubphase,
    increment,
    getCounter,
    recordMemorySample,
    beginExpansion,
    endExpansion,
    getExpansionCostReport,
    snapshot,
  };
}

function setActivePerfTracker(tracker) {
  activeTracker = tracker;
}

function getActivePerfTracker() {
  return activeTracker;
}

function timeActivePhase(name, fn) {
  if (!activeTracker || !activeTracker.enabled) return fn();
  return activeTracker.timePhase(name, fn);
}

module.exports = {
  createPerfTracker,
  setActivePerfTracker,
  getActivePerfTracker,
  timeActivePhase,
};
