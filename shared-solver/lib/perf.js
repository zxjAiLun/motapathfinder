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
  const startedAt = nowMs();
  const startedCpu = process.cpuUsage();
  const startedElu = performance.eventLoopUtilization ? performance.eventLoopUtilization() : null;
  const phaseMs = {};
  const counters = {
    expanded: 0,
    generated: 0,
    registered: 0,
    duplicates: 0,
  };
  let lastLiveAt = startedAt;
  const liveIntervalMs = Number(config.liveIntervalMs || 5000);

  function ensurePhase(name) {
    if (!phaseMs[name]) phaseMs[name] = createPhaseBucket();
    return phaseMs[name];
  }

  function addPhase(name, ms) {
    if (!enabled) return;
    const bucket = ensurePhase(name);
    bucket.ms += ms;
    bucket.count += 1;
  }

  function timePhase(name, fn) {
    if (!enabled || typeof fn !== "function") return fn();
    const started = nowMs();
    try {
      return fn();
    } finally {
      addPhase(name, nowMs() - started);
    }
  }

  async function timePhaseAsync(name, fn) {
    if (!enabled || typeof fn !== "function") return fn();
    const started = nowMs();
    try {
      return await fn();
    } finally {
      addPhase(name, nowMs() - started);
    }
  }

  function increment(name, amount) {
    if (!enabled) return;
    counters[name] = Number(counters[name] || 0) + Number(amount || 1);
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
    return {
      wallMs,
      cpuUserMs,
      cpuSystemMs,
      cpuUtilization: wallMs > 0 ? (cpuUserMs + cpuSystemMs) / wallMs : 0,
      eventLoopUtilization: elu ? elu.utilization : null,
      expanded,
      generated,
      registered,
      duplicates,
      expandedPerSec: wallMs > 0 ? expanded / (wallMs / 1000) : 0,
      generatedPerSec: wallMs > 0 ? generated / (wallMs / 1000) : 0,
      rssMb: memory.rss / 1024 / 1024,
      heapUsedMb: memory.heapUsed / 1024 / 1024,
      phaseMs: Object.fromEntries(Object.entries(phaseMs).map(([key, value]) => [key, value.ms])),
      phaseCounts: Object.fromEntries(Object.entries(phaseMs).map(([key, value]) => [key, value.count])),
      ...(extra || {}),
    };
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
    addPhase,
    timePhase,
    timePhaseAsync,
    increment,
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
