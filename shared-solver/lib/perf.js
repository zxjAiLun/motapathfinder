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
  const phaseMs = {};
  const phaseSelfMs = {};
  const phaseStack = [];
  const counters = {
    expanded: 0,
    generated: 0,
    registered: 0,
    duplicates: 0,
  };
  let peakRssBytes = 0;
  let peakHeapBytes = 0;
  let memorySampleCount = 0;
  let lastLiveAt = startedAt;
  const liveIntervalMs = Number(config.liveIntervalMs || 5000);

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

      if (profileExpansionCost && currentExpansion) {
        currentExpansion.phaseSelf[name] = (currentExpansion.phaseSelf[name] || 0) + selfElapsed;
      }
    }
  }

  async function timePhaseAsync(name, fn) {
    if (!enabled || typeof fn !== "function") return fn();
    const started = nowMs();
    try {
      return await fn();
    } finally {
      const elapsed = nowMs() - started;
      const bucket = ensurePhase(name);
      bucket.ms += elapsed;
      bucket.count += 1;
      const selfBucket = ensureSelfPhase(name);
      selfBucket.ms += elapsed;
      selfBucket.count += 1;
    }
  }

  function increment(name, amount) {
    if (!enabled) return;
    counters[name] = Number(counters[name] || 0) + Number(amount || 1);
  }

  function getCounter(name) {
    return Number(counters[name] || 0);
  }

  function recordMemorySample(memory) {
    if (!enabled || !memory) return;
    memorySampleCount += 1;
    if (memory.heapUsed > peakHeapBytes) peakHeapBytes = memory.heapUsed;
    if (memory.rss > peakRssBytes) peakRssBytes = memory.rss;
  }

  function beginExpansion(expansionIndex, state, frontierBefore) {
    if (!enabled || !profileExpansionCost) return null;
    currentExpansion = {
      expansionIndex,
      floorId: state ? state.floorId : "unknown",
      decisionDepth: state && state.meta && typeof state.meta.decisionDepth === "number"
        ? state.meta.decisionDepth
        : 0,
      frontierBefore: Number(frontierBefore || 0),
      startedAt: nowMs(),
      phaseSelf: {},
    };
    return currentExpansion;
  }

  function endExpansion(expansionIndex, state, frontierAfter, details) {
    if (!enabled || !profileExpansionCost || !currentExpansion) return;
    const endedAt = nowMs();
    const totalSelfMs = Math.max(0, endedAt - currentExpansion.startedAt);
    const phaseSelf = currentExpansion.phaseSelf;
    let dominantPhase = "otherExpansionOverhead";
    let maxPhaseMs = 0;
    Object.entries(phaseSelf).forEach(([phase, ms]) => {
      if (phase !== "expansion" && ms > maxPhaseMs) {
        maxPhaseMs = ms;
        dominantPhase = phase;
      }
    });

    const sample = {
      expansionIndex,
      floorId: state ? state.floorId : currentExpansion.floorId,
      decisionDepth: details && typeof details.decisionDepth === "number"
        ? details.decisionDepth
        : currentExpansion.decisionDepth,
      totalSelfMs: Number(totalSelfMs.toFixed(3)),
      dominantPhase,
      actionsGenerated: Number((details && details.actionsGenerated) || 0),
      reachableNodes: Number((details && details.reachableNodes) || 0),
      battleEstimateMisses: Number((details && details.battleEstimateMisses) || 0),
      stabilizationIterations: Number((details && details.stabilizationIterations) || 0),
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
    const wallMs = nowMs() - startedAt;
    const cpu = process.cpuUsage(startedCpu);
    const cpuUserMs = cpu.user / 1000;
    const cpuSystemMs = cpu.system / 1000;
    const cpuMs = cpuUserMs + cpuSystemMs;
    const expanded = Number((extra && extra.expanded) || counters.expanded || 0);
    const generated = Number((extra && extra.generated) || counters.generated || 0);
    const registered = Number((extra && extra.registered) || counters.registered || 0);
    const duplicates = Number((extra && extra.duplicates) || counters.duplicates || 0);
    const frontierSize = Number((extra && extra.frontierSize) || 0);

    const self = Object.fromEntries(Object.entries(phaseSelfMs).map(([k, v]) => [k, v.ms]));
    const incl = Object.fromEntries(Object.entries(phaseMs).map(([k, v]) => [k, v.ms]));
    const counts = Object.fromEntries(Object.entries(phaseMs).map(([k, v]) => [k, v.count]));

    const walkReachabilitySelfMs = Number(self.reachability || self.walkReachability || 0);
    const primitiveEnumerationSelfMs = Number(self.enumerateActions || self.primitiveEnumeration || 0);
    const actionEvaluationSelfMs = Number(self.sortActions || self.actionEvaluation || 0);
    const applyActionSelfMs = Number(self.applyAction || 0);
    const stabilizationSelfMs = Number(self.stabilization || 0);
    const stateKeyAndDominanceSelfMs = Number(
      (self.buildDpStateKey || 0) + (self.dominance || 0) + (self.buildStateKey || 0)
    );
    const frontierQueueSelfMs = Number(self.frontierQueue || 0);

    const attributedSelfMs = walkReachabilitySelfMs + primitiveEnumerationSelfMs + actionEvaluationSelfMs +
                             applyActionSelfMs + stabilizationSelfMs + stateKeyAndDominanceSelfMs + frontierQueueSelfMs;

    const expansionInclusiveMs = Number(incl.expansion || 0);
    const frontierPopInclusiveMs = Number(incl.frontierQueue || 0);
    const effectiveExpansionWallMs = expansionInclusiveMs > 0
      ? (expansionInclusiveMs + (self.frontierQueue || 0))
      : (attributedSelfMs > 0 ? attributedSelfMs : wallMs);

    const otherExpansionOverheadSelfMs = Math.max(0, Number(self.expansion || (effectiveExpansionWallMs - attributedSelfMs) || 0));
    const totalAttributedWithOverhead = attributedSelfMs + otherExpansionOverheadSelfMs;
    const baseForPercentage = totalAttributedWithOverhead > 0 ? totalAttributedWithOverhead : (effectiveExpansionWallMs > 0 ? effectiveExpansionWallMs : 1);

    const topLevelSelfMs = {
      walkReachability: Number(walkReachabilitySelfMs.toFixed(3)),
      primitiveEnumeration: Number(primitiveEnumerationSelfMs.toFixed(3)),
      actionEvaluation: Number(actionEvaluationSelfMs.toFixed(3)),
      applyAction: Number(applyActionSelfMs.toFixed(3)),
      stabilization: Number(stabilizationSelfMs.toFixed(3)),
      stateKeyAndDominance: Number(stateKeyAndDominanceSelfMs.toFixed(3)),
      frontierQueue: Number(frontierQueueSelfMs.toFixed(3)),
      otherExpansionOverhead: Number(otherExpansionOverheadSelfMs.toFixed(3)),
    };

    const topLevelSelfPercentages = {
      walkReachability: Number(((walkReachabilitySelfMs / baseForPercentage) * 100).toFixed(2)),
      primitiveEnumeration: Number(((primitiveEnumerationSelfMs / baseForPercentage) * 100).toFixed(2)),
      actionEvaluation: Number(((actionEvaluationSelfMs / baseForPercentage) * 100).toFixed(2)),
      applyAction: Number(((applyActionSelfMs / baseForPercentage) * 100).toFixed(2)),
      stabilization: Number(((stabilizationSelfMs / baseForPercentage) * 100).toFixed(2)),
      stateKeyAndDominance: Number(((stateKeyAndDominanceSelfMs / baseForPercentage) * 100).toFixed(2)),
      frontierQueue: Number(((frontierQueueSelfMs / baseForPercentage) * 100).toFixed(2)),
      otherExpansionOverhead: Number(((otherExpansionOverheadSelfMs / baseForPercentage) * 100).toFixed(2)),
    };

    const coverageRatio = baseForPercentage > 0 ? Number((attributedSelfMs / baseForPercentage).toFixed(4)) : 1;

    const simStats = (extra && extra.simulatorCacheStats) || {};
    const skeletonStats = simStats.reachabilitySkeleton || {};
    const reachabilityStats = simStats.reachability || {};
    const battleResolverStats = simStats.battleResolver || {};
    const battleEstimateStats = battleResolverStats.battleEstimate || {};

    const inclusiveSubsystems = {
      walkReachability: {
        calls: Number(counts.reachability || counts.walkReachability || 0),
        totalMs: Number((incl.reachability || incl.walkReachability || 0).toFixed(3)),
        maxMs: Number((extra && extra.maxReachabilityMs || 0).toFixed(3)),
        skeletonHits: Number(skeletonStats.hits || 0),
        skeletonMisses: Number(skeletonStats.misses || 0),
        rebases: Number(skeletonStats.rebases || 0),
        nodesMaterialized: Number(skeletonStats.nodesMaterialized || 0),
        nodesExpanded: Number(reachabilityStats.nodesExpanded || 0),
        safeFastBuilds: Number(reachabilityStats.safeFastBuilds || 0),
        legacyExactBuilds: Number(reachabilityStats.legacyExactBuilds || 0),
      },
      enumeratePrimitiveActions: {
        calls: Number(counts.enumerateActions || 0),
        actionsProduced: generated,
        totalMs: Number((incl.enumerateActions || 0).toFixed(3)),
      },
      battleEstimates: {
        calls: Number((battleEstimateStats.hits || 0) + (battleEstimateStats.misses || 0)),
        hits: Number(battleEstimateStats.hits || 0),
        misses: Number(battleEstimateStats.misses || 0),
        totalMs: Number((battleEstimateStats.computeMs || 0).toFixed(3)),
      },
      applyAction: {
        calls: Number(counts.applyAction || 0),
        totalMs: Number((incl.applyAction || 0).toFixed(3)),
      },
      stabilizeState: {
        calls: Number(counts.stabilization || 0),
        iterations: Number((extra && extra.stabilizationIterations) || counts.stabilization || 0),
        totalMs: Number((incl.stabilization || 0).toFixed(3)),
      },
      buildStateKey: {
        calls: Number(counts.buildStateKey || 0),
        totalMs: Number((incl.buildStateKey || 0).toFixed(3)),
      },
      buildDpStateKey: {
        calls: Number(counts.buildDpStateKey || 0),
        totalMs: Number((incl.buildDpStateKey || 0).toFixed(3)),
      },
      dominance: {
        lookups: Number(counts.dominance || 0),
        rejects: Number((extra && extra.dominanceRejects) || duplicates),
        replaces: Number((extra && extra.dominanceReplaces) || 0),
        totalMs: Number((incl.dominance || 0).toFixed(3)),
      },
      frontierQueue: {
        pushes: registered,
        pops: expanded,
        ranks: Number(counts.frontierQueue || 0),
        totalMs: Number((incl.frontierQueue || 0).toFixed(3)),
      },
    };

    const msPerExpansion = expanded > 0 ? Number((effectiveExpansionWallMs / expanded).toFixed(4)) : 0;
    const expansionsPerSec = effectiveExpansionWallMs > 0 ? Number((expanded / (effectiveExpansionWallMs / 1000)).toFixed(2)) : 0;
    const msPerGeneratedAction = generated > 0 ? Number((effectiveExpansionWallMs / generated).toFixed(4)) : 0;
    const generatedPerSec = effectiveExpansionWallMs > 0 ? Number((generated / (effectiveExpansionWallMs / 1000)).toFixed(2)) : 0;

    return {
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
          stateKeyBuilds: Number(counts.buildStateKey || 0),
          dpStateKeyBuilds: Number(counts.buildDpStateKey || 0),
        },
        stabilizationIterations: Number((extra && extra.stabilizationIterations) || counts.stabilization || 0),
        bestProgress: (extra && extra.bestProgress) || null,
      },
      timingDirectional: {
        wallMs: Number(wallMs.toFixed(3)),
        cpuUserMs: Number(cpuUserMs.toFixed(3)),
        cpuSystemMs: Number(cpuSystemMs.toFixed(3)),
        cpuMs: Number(cpuMs.toFixed(3)),
        cpuUtilization: Number((wallMs > 0 ? (cpuUserMs + cpuSystemMs) / wallMs : 0).toFixed(3)),
        expansionWallMs: Number(effectiveExpansionWallMs.toFixed(3)),
        attributedSelfMs: Number(attributedSelfMs.toFixed(3)),
        unattributedMs: Number(otherExpansionOverheadSelfMs.toFixed(3)),
        coverageRatio,
        topLevelSelfMs,
        topLevelSelfPercentages,
        inclusiveSubsystems,
        perExpansionAverages: {
          msPerExpansion,
          expansionsPerSec,
          msPerGeneratedAction,
          generatedPerSec,
        },
        slowExpansionSamples: slowExpansionSamples.slice(),
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

    const baseSnapshot = {
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
      phaseMs: Object.fromEntries(Object.entries(phaseMs).map(([key, value]) => [key, value.ms])),
      phaseCounts: Object.fromEntries(Object.entries(phaseMs).map(([key, value]) => [key, value.count])),
      phaseSelfMs: Object.fromEntries(Object.entries(phaseSelfMs).map(([key, value]) => [key, value.ms])),
      ...(extra || {}),
    };

    if (profileExpansionCost) {
      baseSnapshot.expansionCost = getExpansionCostReport(extra);
    }
    return baseSnapshot;
  }

  function formatLiveSummary(extra) {
    const data = snapshot(extra);
    const phase = data.phaseMs || {};
    const counts = data.phaseCounts || {};
    const avg = (name, denominator) => {
      const value = Number(phase[name] || 0);
      const count = denominator != null ? denominator : Number(counts[name] || 0);
      return count > 0 ? value / count : 0;
    };
    return JSON.stringify({
      expandedPerSec: Number(data.expandedPerSec.toFixed(2)),
      generatedPerSec: Number(data.generatedPerSec.toFixed(2)),
      applyActionMsPerAction: Number(avg("applyAction", data.generated).toFixed(4)),
      enumerateActionsMsPerState: Number(avg("enumerateActions", data.expanded).toFixed(4)),
      stateKeyMsPerState: Number(avg("buildStateKey").toFixed(4)),
      cloneMsPerAction: Number(avg("cloneState").toFixed(4)),
      sortMsPerLoop: Number(avg("sortFrontier").toFixed(4)),
      rssMb: Number(data.rssMb.toFixed(1)),
      heapUsedMb: Number(data.heapUsedMb.toFixed(1)),
      cpuUtilization: Number((data.cpuUtilization || 0).toFixed(2)),
      eventLoopUtilization: data.eventLoopUtilization == null ? null : Number(data.eventLoopUtilization.toFixed(4)),
    });
  }

  function maybePrintLive(extra) {
    if (!enabled) return;
    const current = nowMs();
    if (current - lastLiveAt < liveIntervalMs) return;
    lastLiveAt = current;
    console.log(`Perf live: ${formatLiveSummary(extra)}`);
  }

  function finish(extra) {
    const data = snapshot(extra);
    if (config.outputPath) {
      fs.mkdirSync(path.dirname(config.outputPath), { recursive: true });
      fs.writeFileSync(config.outputPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    }
    return data;
  }

  return {
    enabled,
    profileExpansionCost,
    addPhase,
    timePhase,
    timePhaseAsync,
    increment,
    getCounter,
    recordMemorySample,
    beginExpansion,
    endExpansion,
    getExpansionCostReport,
    snapshot,
    formatLiveSummary,
    maybePrintLive,
    finish,
  };
}

function setActivePerfTracker(tracker) {
  activeTracker = tracker || null;
}

function getActivePerfTracker() {
  return activeTracker;
}

function timeActivePhase(name, fn) {
  const tracker = getActivePerfTracker();
  if (!tracker || !tracker.enabled) return fn();
  return tracker.timePhase(name, fn);
}

module.exports = {
  createPerfTracker,
  getActivePerfTracker,
  setActivePerfTracker,
  timeActivePhase,
};
