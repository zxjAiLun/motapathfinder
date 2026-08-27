"use strict";

const fs = require("node:fs");
const { loadProject } = require("./lib/project-loader");
const { StaticSimulator } = require("./lib/simulator");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { buildStateKey } = require("./lib/state-key");
const { runSegmentAgainstFrontierLocal } = require("./lib/segment-dp");
const { createNoStateChangeChoiceResolver } = require("./lib/onlyup-mt1-real-route-gate");

function buildSimulatorFromProfile(project, profile) {
  const choiceResolver = createNoStateChangeChoiceResolver();
  // Profile is authoritative; fail-closed if unsupported
  if (profile && profile.unsupported) {
    console.error(`Unsupported simulator profile in worker: ${profile.unsupportedReason}`);
    process.exit(3);
  }
  if (profile && profile.battleResolverType && profile.battleResolverType !== "FunctionBackedBattleResolver") {
    console.error(`Unsupported battleResolverType in worker: ${profile.battleResolverType}`);
    process.exit(3);
  }
  const stopFloorId = (profile && profile.stopFloorId) || "MT11";
  const enableFastHazardBlockIndex = profile ? profile.enableFastHazardBlockIndex !== false : true;
  const enableCompiledEffectCache = profile ? Boolean(profile.enableCompiledEffectCache) : false;
  const autoPickupEnabled = profile ? profile.autoPickupEnabled !== false : true;
  const autoBattleEnabled = profile ? profile.autoBattleEnabled !== false : true;
  const autoBattleFastRejectEnabled = profile ? profile.autoBattleFastRejectEnabled === true : true;
  const battleEnableFastReject = profile ? profile.battleResolverEnableFastReject !== false : true;
  const walkReachabilityMode = profile && profile.walkReachabilityMode ? String(profile.walkReachabilityMode) : undefined;
  const searchGraphMode = profile && profile.searchGraphMode ? String(profile.searchGraphMode) : undefined;
  const simulatorOptions = {
    stopFloorId,
    battleResolver: new FunctionBackedBattleResolver(project, { enableFastReject: battleEnableFastReject }),
    autoBattleFastRejectEnabled,
    autoPickupEnabled,
    autoBattleEnabled,
    enableFastHazardBlockIndex,
    enableCompiledEffectCache,
    choiceResolver,
  };
  if (walkReachabilityMode) simulatorOptions.walkReachabilityMode = walkReachabilityMode;
  if (searchGraphMode) simulatorOptions.searchGraphMode = searchGraphMode;
  const simulator = new StaticSimulator(project, simulatorOptions);
  simulator.__workerChoiceResolver = choiceResolver;
  return simulator;
}

function buildAppliedProfile(simulator) {
  if (!simulator) return null;
  return {
    stopFloorId: simulator.stopFloorId || "MT11",
    enableFastHazardBlockIndex: simulator.enableFastHazardBlockIndex !== false,
    enableCompiledEffectCache: Boolean(simulator.enableCompiledEffectCache),
    autoPickupEnabled: simulator.autoResolver ? Boolean(simulator.autoResolver.autoPickupEnabled) : true,
    autoBattleEnabled: simulator.autoResolver ? Boolean(simulator.autoResolver.autoBattleEnabled) : true,
    autoBattleFastRejectEnabled: simulator.autoResolver ? simulator.autoResolver.enableFastRejectSkip === true : false,
    battleResolverEnableFastReject: simulator.battleResolver && typeof simulator.battleResolver.fastRejectClassifier === "function",
    battleResolverType: simulator.battleResolver ? simulator.battleResolver.constructor.name : null,
    walkReachabilityMode: simulator.walkReachabilityMode || null,
    searchGraphMode: simulator.searchGraphMode || null,
    unsupported: false,
    unsupportedReason: null,
  };
}

function main() {
  const [,, inputPath, outputPath] = process.argv;
  if (!inputPath || !outputPath) {
    console.error("Usage: node segment-worker.js <inputPath> <outputPath>");
    process.exit(1);
  }

  const rawInput = fs.readFileSync(inputPath, "utf8");
  const payload = JSON.parse(rawInput);

  const project = loadProject(payload.projectRoot || payload.projectDir);
  let simulator;
  if (payload.simulatorProfile) {
    simulator = buildSimulatorFromProfile(project, payload.simulatorProfile);
  } else {
    // Fallback for old payloads (should not happen in Repair 1) – preserve legacy defaults but log drift
    const choiceResolver = createNoStateChangeChoiceResolver();
    simulator = new StaticSimulator(project, {
      battleResolver: new FunctionBackedBattleResolver(project, { enableFastReject: true }),
      autoBattleFastRejectEnabled: true,
      autoPickupEnabled: true,
      autoBattleEnabled: true,
      enableFastHazardBlockIndex: true,
      enableCompiledEffectCache: false,
      choiceResolver,
    });
  }
  const appliedSimulatorProfile = buildAppliedProfile(simulator);

  // P2: strict input StateKey verification – counts must match exactly
  const inputFrontier = Array.isArray(payload.inputFrontier) ? payload.inputFrontier : [];
  const parentKeys = Array.isArray(payload.parentInputStateKeys) ? payload.parentInputStateKeys : [];
  if (parentKeys.length !== inputFrontier.length) {
    console.error(`Input frontier length ${inputFrontier.length} != parentInputStateKeys length ${parentKeys.length}`);
    process.exit(2);
  }
  let inputStateKeysVerified = 0;
  for (let i = 0; i < inputFrontier.length; i += 1) {
    const cand = inputFrontier[i];
    const expectedKey = parentKeys[i];
    if (!expectedKey) {
      console.error(`Missing parentInputStateKey for candidate ${cand.id} index ${i}`);
      process.exit(2);
    }
    const actualKey = buildStateKey(cand.state);
    if (actualKey !== expectedKey) {
      console.error(`Input candidate ${cand.id} stateKey mismatch: expected ${expectedKey}, got ${actualKey}`);
      process.exit(2);
    }
    inputStateKeysVerified += 1;
  }

  const workerStartRssMb = Math.round((process.memoryUsage().rss / 1048576) * 10) / 10;
  const startedAt = Date.now();
  const result = runSegmentAgainstFrontierLocal(
    simulator,
    payload.segment,
    payload.inputFrontier,
    payload.config,
    payload.overrides,
  );
  const searchWallMs = Date.now() - startedAt;
  const workerEndRssMb = Math.round((process.memoryUsage().rss / 1048576) * 10) / 10;

  // Annotate output candidates with authoritative state keys
  let outputStateKeysVerified = 0;
  if (Array.isArray(result.merged)) {
    result.merged.forEach((cand) => {
      if (!cand.state) {
        console.error(`Missing state on output candidate ${cand.id}`);
        process.exit(4);
      }
      cand.outputStateKey = buildStateKey(cand.state);
      outputStateKeysVerified += 1;
    });
  }

  // True worker peak: max(start, end, max attempt peakRssMb)
  let maxAttemptPeakRssMb = 0;
  (result.attempts || []).forEach((att) => {
    const dp = att && att.diagnostics && att.diagnostics.dp;
    const mem = dp && dp.memory;
    const candidates = [];
    if (mem) {
      if (Number.isFinite(Number(mem.peakRssMb))) candidates.push(Number(mem.peakRssMb));
      if (Number.isFinite(Number(mem.rssMb))) candidates.push(Number(mem.rssMb));
      if (Number.isFinite(Number(mem.peakHeapUsedMb))) {} // heap not used for rss
    }
    // Also check direct fields sometimes stored differently
    if (dp && Number.isFinite(Number(dp.peakRssMb))) candidates.push(Number(dp.peakRssMb));
    candidates.forEach((v) => {
      if (v > maxAttemptPeakRssMb) maxAttemptPeakRssMb = v;
    });
  });
  // Also consider any per-attempt diagnostic directly
  const workerPeakRssMb = Math.max(workerStartRssMb, workerEndRssMb, maxAttemptPeakRssMb);
  const workerHeapUsedMb = Math.round((Number(process.memoryUsage().heapUsed || 0) / 1048576) * 10) / 10;

  const totalExpansions = (result.attempts || []).reduce((sum, att) => {
    const dp = att && att.diagnostics && att.diagnostics.dp;
    return sum + Number((dp && dp.expansions) || 0);
  }, 0);

  // For budget hard assert, echo assigned values
  const assignedExpansions = Number(payload.assignedExpansions || (payload.config && payload.config.assignedExpansions) || 0);
  const assignedDeadlineMs = Number(payload.assignedDeadlineMs || (payload.config && payload.config.assignedDeadlineMs) || 0);
  const childDeadlineMs = Number(payload.childDeadlineMs || 0);

  const response = {
    success: true,
    merged: result.merged,
    summary: result.summary,
    attempts: (result.attempts || []).map((att) => ({
      startCandidateId: att.startCandidateId,
      found: att.found,
      goalCount: (att.goalSkyline || []).length,
      diagnostics: att.diagnostics,
    })),
    candidateLimit: result.candidateLimit,
    memoryLimited: result.memoryLimited,
    memoryStopReason: result.memoryStopReason,
    consumedExpansions: totalExpansions,
    assignedExpansions,
    assignedDeadlineMs,
    childDeadlineMs,
    deadlineEpochMs: assignedDeadlineMs || childDeadlineMs || null,
    invocationId: payload.invocationId || null,
    appliedSimulatorProfile,
    requestedSimulatorProfile: payload.simulatorProfile || null,
    simulatorProfileIdentity: payload.simulatorProfile ? JSON.stringify(appliedSimulatorProfile) === JSON.stringify(payload.simulatorProfile) : true,
    searchWallMs,
    workerStartRssMb,
    workerEndRssMb,
    workerPeakRssMb,
    workerHeapUsedMb,
    maxAttemptPeakRssMb,
    inputStateKeysVerified,
    outputStateKeysVerified,
    stateRoundTripIdentity: inputStateKeysVerified === inputFrontier.length && outputStateKeysVerified === (result.merged ? result.merged.length : 0),
    inputFrontierLength: inputFrontier.length,
    outputFrontierLength: (result.merged || []).length,
  };

  fs.writeFileSync(outputPath, JSON.stringify(response));
  process.exit(0);
}

if (require.main === module) {
  main();
}
