"use strict";

const fs = require("node:fs");
const { loadProject } = require("./lib/project-loader");
const { StaticSimulator } = require("./lib/simulator");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { buildStateKey } = require("./lib/state-key");
const { runSegmentAgainstFrontierLocal } = require("./lib/segment-dp");
const { createNoStateChangeChoiceResolver } = require("./lib/onlyup-mt1-real-route-gate");
// PR-5.24c Iteration 2 Repair 1 – compact progress projection (P1-D).
const { compactProgressProjection } = require("./lib/segment-progress");
const { projectSegmentGoalProgress } = require("./lib/segment-dp");

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
  const enableHazardBlockIndexMemoization = profile ? profile.enableHazardBlockIndexMemoization !== false : true;
  const enableFastBattleEstimateCache = profile ? profile.enableFastBattleEstimateCache !== false : true;
  const enableCompiledEffectCache = profile ? Boolean(profile.enableCompiledEffectCache) : false;
  const autoPickupEnabled = profile ? profile.autoPickupEnabled !== false : true;
  const autoBattleEnabled = profile ? profile.autoBattleEnabled !== false : true;
  const autoBattleFastRejectEnabled = profile ? profile.autoBattleFastRejectEnabled === true : true;
  const battleEnableFastReject = profile ? profile.battleResolverEnableFastReject !== false : true;
  const walkReachabilityMode = profile && profile.walkReachabilityMode ? String(profile.walkReachabilityMode) : undefined;
  const searchGraphMode = profile && profile.searchGraphMode ? String(profile.searchGraphMode) : undefined;
  const simulatorOptions = {
    stopFloorId,
    battleResolver: new FunctionBackedBattleResolver(project, {
      enableFastReject: battleEnableFastReject,
      enableFastBattleEstimateCache,
    }),
    autoBattleFastRejectEnabled,
    autoPickupEnabled,
    autoBattleEnabled,
    enableFastHazardBlockIndex,
    enableHazardBlockIndexMemoization,
    enableFastBattleEstimateCache,
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
    enableHazardBlockIndexMemoization: simulator.enableHazardBlockIndexMemoization !== false,
    enableFastBattleEstimateCache: simulator.battleResolver ? simulator.battleResolver.enableFastBattleEstimateCache !== false : true,
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
  const [,, inputPath, outputPath, envelopePath] = process.argv;
  if (!inputPath || !outputPath) {
    console.error("Usage: node segment-worker.js <inputPath> <outputPath> [envelopePath]");
    process.exit(1);
  }

  const rawInput = fs.readFileSync(inputPath, "utf8");
  const payload = JSON.parse(rawInput);

  // P2-3: envelope is required for isolated invocations (fail-closed)
  const isIsolatedInvocation = Boolean(payload.invocationId);
  if (isIsolatedInvocation) {
    if (!envelopePath || !fs.existsSync(envelopePath)) {
      console.error(`Missing required envelope for isolated invocation ${payload.invocationId || "unknown"}`);
      process.exit(5);
    }
    // Validate envelope fields before proceeding
    try {
      const envelopeRaw = fs.readFileSync(envelopePath, "utf8");
      const envelope = JSON.parse(envelopeRaw);
      if (!envelope || typeof envelope.workerMaxRssMb !== "number" || !Number.isFinite(envelope.workerMaxRssMb) || envelope.workerMaxRssMb <= 0) {
        console.error(`Invalid envelope workerMaxRssMb: ${envelope && envelope.workerMaxRssMb}`);
        process.exit(5);
      }
      if (typeof envelope.workerHardCeilingMb !== "number" || !Number.isFinite(envelope.workerHardCeilingMb) || envelope.workerHardCeilingMb <= 0) {
        console.error(`Invalid envelope workerHardCeilingMb`);
        process.exit(5);
      }
      if (!envelope.invocationId || envelope.invocationId !== payload.invocationId) {
        console.error(`Envelope invocationId mismatch: envelope ${envelope && envelope.invocationId} vs payload ${payload.invocationId}`);
        process.exit(5);
      }
      // Apply authoritative envelope values
      payload.config = payload.config || {};
      payload.config.maxRssMb = Number(envelope.workerMaxRssMb);
      payload.config.maxRssHardCeilingMb = Number(envelope.workerHardCeilingMb);
    } catch (e) {
      console.error(`Failed to validate envelope ${envelopePath}: ${e.message}`);
      process.exit(5);
    }
  } else if (envelopePath && fs.existsSync(envelopePath)) {
    // Non-isolated but envelope provided – still apply if valid (defensive)
    try {
      const envelope = JSON.parse(fs.readFileSync(envelopePath, "utf8"));
      if (envelope && typeof envelope.workerMaxRssMb === "number" && payload.config) {
        payload.config.maxRssMb = Number(envelope.workerMaxRssMb);
      }
      if (envelope && typeof envelope.workerHardCeilingMb === "number" && payload.config) {
        payload.config.maxRssHardCeilingMb = Number(envelope.workerHardCeilingMb);
      }
    } catch (_) {}
  }

  const project = loadProject(payload.projectRoot || payload.projectDir);

  // P2-2: verify projectIdentity if expected provided
  let appliedProjectIdentity = null;
  let projectIdentityMatch = true;
  if (payload.expectedProjectIdentity) {
    const firstData = (project.data || {}).firstData || {};
    appliedProjectIdentity = {
      title: firstData.title || null,
      startFloorId: firstData.floorId || null,
      startLoc: firstData.hero && firstData.hero.loc ? { x: firstData.hero.loc.x, y: firstData.hero.loc.y } : null,
      floorCount: Object.keys(project.floorsById || {}).length,
      stopFloorId: (payload.simulatorProfile && payload.simulatorProfile.stopFloorId) || null,
    };
    const expected = payload.expectedProjectIdentity;
    const keys = Object.keys(expected);
    for (const k of keys) {
      if (JSON.stringify(expected[k]) !== JSON.stringify(appliedProjectIdentity[k])) {
        console.error(`ProjectIdentity mismatch on ${k}: expected ${JSON.stringify(expected[k])} vs applied ${JSON.stringify(appliedProjectIdentity[k])}`);
        process.exit(5);
      }
    }
    projectIdentityMatch = true;
  }
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

  if (payload.mode === "batch" || Array.isArray(payload.jobs)) {
    runBatchWorker(payload, outputPath, project, simulator, appliedSimulatorProfile);
    return;
  }

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

  // PR-5.24c Repair 1a (G13b) – compact probe/global authority telemetry so
  // the isolated wall-probe contract is verifiable from the parent without
  // any route/state dumps:
  //   probeDeadlineMs       epoch-absolute LOCAL probe authority
  //   globalDeadlineMs      the child's TRUE global authority (never probe-clamped)
  //   probeDeadlinePrecedesGlobal     true when the probe wall actually bound runtime
  //   childGlobalStopReason the child globalBudget stop (probe must never set it)
  const childGlobalBudgetForTelemetry =
    (payload.config && payload.config.globalBudget) || null;
  const probeDeadlineMsForTelemetry =
    payload.config && payload.config.probeDeadlineMs != null
      ? Number(payload.config.probeDeadlineMs)
      : null;
  const globalDeadlineMsForTelemetry = childGlobalBudgetForTelemetry
    && childGlobalBudgetForTelemetry.deadlineMs != null
    ? Number(childGlobalBudgetForTelemetry.deadlineMs)
    : null;
  const probeDeadlinePrecedesGlobal = probeDeadlineMsForTelemetry != null &&
    globalDeadlineMsForTelemetry != null &&
    probeDeadlineMsForTelemetry < globalDeadlineMsForTelemetry;
  const childGlobalStopReason = childGlobalBudgetForTelemetry
    ? (childGlobalBudgetForTelemetry.stoppedReason || null)
    : null;

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
      // PR-5.24c Iteration 2 Repair 1 (P1-D) – COMPACT progress projection
      // instead of the raw route-attached bestProgressState. The projection
      // is computed INSIDE the child against the attempt's segment; the full
      // state (hero/inventory/flags/floorStates/route) never crosses the
      // child/parent boundary.
      bestProgressProjection: (() => {
        if (!att.bestProgress) return null;
        try {
          return compactProgressProjection(
            projectSegmentGoalProgress(project, att.bestProgress, payload.segment),
          );
        } catch (error) {
          return null;
        }
      })(),
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
    appliedProjectIdentity: typeof appliedProjectIdentity !== "undefined" ? appliedProjectIdentity : null,
    expectedProjectIdentity: payload.expectedProjectIdentity || null,
    projectIdentityMatch: typeof projectIdentityMatch !== "undefined" ? projectIdentityMatch : true,
    searchWallMs,
    // PR-5.24c Repair 1a (G13b) – compact probe/global authority telemetry.
    probeDeadlineMs: probeDeadlineMsForTelemetry,
    globalDeadlineMs: globalDeadlineMsForTelemetry,
    probeDeadlinePrecedesGlobal,
    childGlobalStopReason,
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

function runBatchWorker(payload, outputPath, project, simulator, appliedSimulatorProfile) {
  const workerStartRssMb = Math.round((process.memoryUsage().rss / 1048576) * 10) / 10;
  const childGlobalBudget = {
    scope: "global-run",
    requestedExpansions: Number(payload.assignedExpansions || (payload.config && payload.config.maxExpansions) || 50000),
    requestedRuntimeMs: Number(payload.childSearchRuntimeMs || (payload.config && payload.config.maxRuntimeMs) || 30000),
    consumedExpansions: 0,
    consumedWallMs: 0,
    startedAt: Date.now(),
    deadlineMs: Number(payload.childDeadlineMs || (Date.now() + 30000)),
    stoppedReason: null,
  };

  const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
  const results = [];
  let totalSearchWallMs = 0;
  let maxAttemptPeakRssMb = workerStartRssMb;

  for (let jIdx = 0; jIdx < jobs.length; jIdx += 1) {
    const job = jobs[jIdx];
    const now = Date.now();

    const remainingExpansions = childGlobalBudget
      ? Math.max(0, childGlobalBudget.requestedExpansions - childGlobalBudget.consumedExpansions)
      : Infinity;
    const remainingWallMs = childGlobalBudget && childGlobalBudget.deadlineMs
      ? Math.max(0, childGlobalBudget.deadlineMs - now)
      : Infinity;

    if (childGlobalBudget && (childGlobalBudget.stoppedReason || remainingExpansions <= 0 || remainingWallMs <= 0)) {
      if (!childGlobalBudget.stoppedReason) {
        childGlobalBudget.stoppedReason = remainingWallMs <= 0 ? "time-limit" : "expansion-limit";
      }
      results.push({
        jobId: job.jobId,
        executed: false,
        notRunReason: childGlobalBudget.stoppedReason,
        inputFrontierLength: (job.inputFrontier || []).length,
        inputStateKeysVerified: (job.parentInputStateKeys || []).length,
        merged: [],
        attempts: [],
        consumedExpansions: 0,
        searchWallMs: 0,
        summary: {
          segmentId: job.segment.id,
          label: job.segment.label,
          found: false,
          startCandidatesTried: 0,
          candidates: [],
          attempts: [],
          executionNotRunReason: childGlobalBudget.stoppedReason,
          candidateSliceTelemetry: {
            candidateSliceInitialAttempts: 0,
            candidateSliceLocalTimeouts: 0,
            candidateSliceLocalExpansionStops: 0,
            candidateSliceDeferredRetries: 0,
            candidateSliceRecoveredToExhausted: 0,
            candidateSliceRecoveredToFound: 0,
            candidateSliceStillIncompleteAtGlobalStop: (job.inputFrontier || []).length,
            unusedGlobalWallMsAtReturn: Math.max(0, remainingWallMs),
            candidateSliceFinalFound: 0,
            candidateSliceFinalComplete: 0,
            candidateSliceFinalPending: (job.inputFrontier || []).length,
            candidateSliceTerminalIncomplete: 0,
            candidateSliceSearchComplete: false,
          },
          failurePropagation: {
            failureClass: "budget-exhausted",
            primaryFailureClass: "budget-exhausted",
            reason: childGlobalBudget.stoppedReason,
          },
        },
      });
      continue;
    }

    // State isolation: fresh clone of inputFrontier
    const jobInputFrontier = JSON.parse(JSON.stringify(job.inputFrontier || []));
    const parentKeys = Array.isArray(job.parentInputStateKeys) ? job.parentInputStateKeys : [];
    if (parentKeys.length !== jobInputFrontier.length) {
      console.error(`Job ${job.jobId}: inputFrontier length ${jobInputFrontier.length} != parentInputStateKeys length ${parentKeys.length}`);
      process.exit(2);
    }
    let inputStateKeysVerified = 0;
    for (let i = 0; i < jobInputFrontier.length; i += 1) {
      const cand = jobInputFrontier[i];
      const expectedKey = parentKeys[i];
      const actualKey = buildStateKey(cand.state);
      if (actualKey !== expectedKey) {
        console.error(`Job ${job.jobId} input candidate ${cand.id} stateKey mismatch`);
        process.exit(2);
      }
      inputStateKeysVerified += 1;
    }

    // Fresh choice resolver per job to ensure zero state leakage
    simulator.__workerChoiceResolver = createNoStateChangeChoiceResolver();
    simulator.choiceResolver = simulator.__workerChoiceResolver;

    const jobStartWallMs = Date.now();
    const jobStartExpansions = childGlobalBudget ? childGlobalBudget.consumedExpansions : 0;
    const jobLocalProbeCap = job.probeExpansionCap != null
      ? jobStartExpansions + Number(job.probeExpansionCap)
      : (payload.config && payload.config.probeExpansionCap != null
        ? jobStartExpansions + Number(payload.config.probeExpansionCap)
        : null);

    // PR-5.24f Iteration 1 Repair 1: Per-job wall authority rebased at job start using duration probeWallMs!
    const jobLocalDeadline = job.probeWallMs != null
      ? Math.min(childGlobalBudget ? childGlobalBudget.deadlineMs : Infinity, jobStartWallMs + Number(job.probeWallMs))
      : (job.probeDeadlineMs != null
        ? Math.min(childGlobalBudget ? childGlobalBudget.deadlineMs : Infinity, Number(job.probeDeadlineMs))
        : (childGlobalBudget ? childGlobalBudget.deadlineMs : undefined));

    const jobConfig = {
      ...(payload.config || {}),
      ...(job.config || {}),
      globalBudget: childGlobalBudget,
      probeExpansionCap: jobLocalProbeCap,
      probeDeadlineMs: jobLocalDeadline,
      maxRssMb: payload.config ? payload.config.maxRssMb : 256,
      maxRssHardCeilingMb: payload.config ? payload.config.maxRssHardCeilingMb : 260,
    };

    const jobStartedAt = jobStartWallMs;

    const result = runSegmentAgainstFrontierLocal(
      simulator,
      job.segment,
      jobInputFrontier,
      jobConfig,
      job.overrides || {},
    );

    const jobWallMs = Date.now() - jobStartedAt;
    totalSearchWallMs += jobWallMs;
    const jobConsumedExpansions = (childGlobalBudget ? childGlobalBudget.consumedExpansions : 0) - jobStartExpansions;

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

    (result.attempts || []).forEach((att) => {
      const dp = att && att.diagnostics && att.diagnostics.dp;
      const mem = dp && dp.memory;
      if (mem) {
        if (Number.isFinite(Number(mem.peakRssMb)) && Number(mem.peakRssMb) > maxAttemptPeakRssMb) {
          maxAttemptPeakRssMb = Number(mem.peakRssMb);
        }
        if (Number.isFinite(Number(mem.rssMb)) && Number(mem.rssMb) > maxAttemptPeakRssMb) {
          maxAttemptPeakRssMb = Number(mem.rssMb);
        }
      }
      if (dp && Number.isFinite(Number(dp.peakRssMb)) && Number(dp.peakRssMb) > maxAttemptPeakRssMb) {
        maxAttemptPeakRssMb = Number(dp.peakRssMb);
      }
    });

    results.push({
      jobId: job.jobId,
      executed: true,
      merged: result.merged,
      attempts: result.attempts,
      summary: result.summary,
      candidateLimit: result.candidateLimit,
      memoryLimited: Boolean(result.memoryLimited),
      memoryStopReason: result.memoryStopReason || null,
      consumedExpansions: jobConsumedExpansions,
      searchWallMs: jobWallMs,
      jobStartWallMs,
      effectiveProbeDeadlineMs: jobLocalDeadline,
      allocatedProbeWallMs: job.probeWallMs != null ? Number(job.probeWallMs) : null,
      inputStateKeysVerified,
      outputStateKeysVerified,
      inputFrontierLength: jobInputFrontier.length,
    });
  }

  const workerEndRssMb = Math.round((process.memoryUsage().rss / 1048576) * 10) / 10;
  const peakRssMb = Math.max(workerStartRssMb, workerEndRssMb, maxAttemptPeakRssMb);

  const batchResponse = {
    success: true,
    appliedSimulatorProfile,
    totalConsumedExpansions: childGlobalBudget ? childGlobalBudget.consumedExpansions : 0,
    totalSearchWallMs,
    workerStartRssMb,
    workerEndRssMb,
    peakRssMb,
    results,
  };

  fs.writeFileSync(outputPath, JSON.stringify(batchResponse));
  process.exit(0);
}

if (require.main === module) {
  main();
}
