"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
const { buildStateKey } = require("./state-key");

const PROCESS_TREE_RSS_STOP_THRESHOLD_MB = 256;
const PROCESS_TREE_RSS_HARD_CEILING_MB = 260;
const PROCESS_TREE_ALLOWED_OVERSHOOT_MB = 4;
const CHILD_EXIT_RESERVE_MS = 2000;

function numericOption(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveStartCandidateLimit(segment, config, overrides, frontierLength) {
  return numericOption(
    overrides && overrides.startCandidateLimit,
    numericOption(
      config && config.startCandidateLimit,
      numericOption(
        segment && segment.dp && segment.dp.startCandidateLimit,
        frontierLength == null ? null : (frontierLength || 1)
      )
    )
  );
}

function segmentCandidateLimit(segment, config, overrides) {
  return numericOption(
    overrides && overrides.candidateLimit,
    numericOption(
      config && config.candidateLimit,
      numericOption(segment && segment.dp && segment.dp.goalSkylineLimit, 8)
    )
  );
}

function buildSimulatorProfile(simulator) {
  if (!simulator) return null;
  const profile = {
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
  // Detect unsupported customizations that cannot be safely replicated in worker
  if (simulator.solverModel && simulator.solverModel.explicit) {
    profile.unsupported = true;
    profile.unsupportedReason = "custom-solverModel explicit not serializable";
  }
  if (simulator.battleResolver && simulator.battleResolver.constructor) {
    const name = simulator.battleResolver.constructor.name;
    if (name !== "FunctionBackedBattleResolver") {
      profile.unsupported = true;
      profile.unsupportedReason = `unsupported battleResolver ${name} – isolated backend only supports FunctionBackedBattleResolver`;
    }
  }
  // Resource macro flags not part of canonical isolated path – treat as unsupported if enabled
  if (simulator.enableResourceChain || simulator.enableResourceCluster || simulator.enableResourcePocket || simulator.enableFightToLevelUp) {
    profile.unsupported = true;
    profile.unsupportedReason = "resource macro enabled (resourceChain/cluster/pocket/fightToLevelUp) not serialized for isolated mode";
  }
  return profile;
}

function executeIsolatedSegment(options) {
  const { simulator, segment, frontier, config, overrides, isolatedRuntimeDescriptor, descriptor } = options;
  const runtimeDescriptor = isolatedRuntimeDescriptor || descriptor || null;
  const projectRoot = (runtimeDescriptor && runtimeDescriptor.projectRoot) ||
    (simulator && simulator.project && (simulator.project.root || simulator.project.projectRoot)) ||
    (config && (config.projectRoot || config.projectPath)) ||
    path.resolve(__dirname, "../..", "Only upV2.1", "Only upV2.1");

  // P2: use proper resolver for startLimit (not candidateLimit)
  const resolvedStartLimit = resolveStartCandidateLimit(segment, config || {}, overrides || {}, (frontier || []).length);
  const startLimit = resolvedStartLimit != null ? Math.max(1, Number(resolvedStartLimit)) : (frontier || []).length;
  const inputFrontier = (frontier || []).slice(0, startLimit);
  const candidateLimit = segmentCandidateLimit(segment, config || {}, overrides || {});

  const globalBudget = config && config.globalBudget;
  const now = Date.now();
  let assignedDeadlineMs;
  let assignedRuntimeMs;
  let globalRemainingExpansions = null;
  let globalRemainingRuntimeMs = null;

  if (globalBudget && globalBudget.deadlineMs != null && Number.isFinite(Number(globalBudget.deadlineMs))) {
    assignedDeadlineMs = Number(globalBudget.deadlineMs);
    globalRemainingRuntimeMs = Math.max(0, assignedDeadlineMs - now);
  } else if (config && config.deadlineMs != null && Number.isFinite(Number(config.deadlineMs))) {
    assignedDeadlineMs = Number(config.deadlineMs);
    globalRemainingRuntimeMs = Math.max(0, assignedDeadlineMs - now);
  } else {
    assignedRuntimeMs = Math.max(0, Number((config && config.maxRuntimeMs) || 30000));
    assignedDeadlineMs = now + assignedRuntimeMs;
    globalRemainingRuntimeMs = assignedRuntimeMs;
  }
  if (assignedRuntimeMs == null) {
    assignedRuntimeMs = globalRemainingRuntimeMs;
  }

  if (globalBudget && globalBudget.requestedExpansions > 0) {
    globalRemainingExpansions = Math.max(0, globalBudget.requestedExpansions - globalBudget.consumedExpansions);
  }

  let assignedExpansions;
  if (globalRemainingExpansions != null) {
    assignedExpansions = globalRemainingExpansions;
  } else {
    assignedExpansions = Number((config && config.maxExpansions) || 50000);
    if (!Number.isFinite(assignedExpansions) || assignedExpansions <= 0) assignedExpansions = 50000;
  }

  // Fail-closed if already exhausted before spawn
  if (globalBudget && ((globalRemainingExpansions != null && globalRemainingExpansions <= 0) || (globalRemainingRuntimeMs != null && globalRemainingRuntimeMs <= 0))) {
    globalBudget.stoppedReason = globalRemainingRuntimeMs <= 0 ? "time-limit" : "expansion-limit";
    return {
      segment,
      inputFrontier,
      merged: [],
      attempts: [],
      summary: {
        segmentId: segment.id,
        label: segment.label,
        found: false,
        startCandidatesTried: 0,
        candidates: [],
        attempts: [],
        failurePropagation: {
          failureClass: "budget-exhausted",
          primaryFailureClass: "budget-exhausted",
          reason: globalBudget.stoppedReason,
        },
      },
      candidateLimit,
      memoryLimited: false,
      memoryStopReason: null,
      telemetry: {
        plannerRssBeforeSpawnMb: Math.round((process.memoryUsage().rss / 1048576) * 10) / 10,
        plannerRssAfterSpawnMb: Math.round((process.memoryUsage().rss / 1048576) * 10) / 10,
        workerPeakRssMb: 0,
        workerStartRssMb: 0,
        aggregateConcurrentRssUpperBoundMb: Math.round((process.memoryUsage().rss / 1048576) * 10) / 10,
        processWallMs: 0,
        assignedExpansions,
        consumedExpansions: 0,
        deadlineEpochMs: assignedDeadlineMs,
        inputStateKeysVerified: 0,
        outputStateKeysVerified: 0,
        // Pre-spawn budget exhaustion: no worker ran, so no round-trip was performed.
        // (false with zero verified counts and consumedExpansions=0 marks "not run",
        //  not a verification failure)
        stateRoundTripIdentity: false,
        executed: false,
      },
    };
  }

  // Repair 2: three-point planner RSS sampling – beforeSerialization / atSpawn / afterSpawn
  const plannerRssBeforeSerializationMb = Math.round((process.memoryUsage().rss / 1048576) * 10) / 10;

  // Child search reserve: don't expand parent deadline, reserve 2s inside child slice
  const childDeadlineMs = assignedRuntimeMs > CHILD_EXIT_RESERVE_MS ? assignedDeadlineMs - CHILD_EXIT_RESERVE_MS : assignedDeadlineMs;
  const childSearchRuntimeMs = assignedRuntimeMs > CHILD_EXIT_RESERVE_MS ? assignedRuntimeMs - CHILD_EXIT_RESERVE_MS : Math.max(1, assignedRuntimeMs);

  const simulatorProfile = runtimeDescriptor ? runtimeDescriptor.simulatorProfile : buildSimulatorProfile(simulator);
  if (!simulatorProfile) {
    throw new Error("Missing simulatorProfile for isolated execution – need simulator or isolatedRuntimeDescriptor");
  }
  if (simulatorProfile && simulatorProfile.unsupported) {
    const plannerRssAfterSpawnMb = plannerRssBeforeSerializationMb;
    return {
      segment,
      inputFrontier,
      merged: [],
      attempts: [],
      summary: {
        segmentId: segment.id,
        label: segment.label,
        found: false,
        startCandidatesTried: inputFrontier.length,
        candidates: [],
        attempts: [],
        failurePropagation: {
          failureClass: "unsupported-simulator-profile",
          primaryFailureClass: "unsupported-simulator-profile",
          reason: simulatorProfile.unsupportedReason,
        },
      },
      candidateLimit,
      memoryLimited: false,
      memoryStopReason: null,
      telemetry: {
        plannerRssBeforeSerializationMb,
        plannerRssAtSpawnMb: plannerRssBeforeSerializationMb,
        plannerRssBeforeSpawnMb: plannerRssBeforeSerializationMb,
        plannerRssAfterSpawnMb,
        workerPeakRssMb: 0,
        workerStartRssMb: 0,
        aggregateConcurrentRssUpperBoundMb: Math.max(plannerRssBeforeSerializationMb, plannerRssAfterSpawnMb),
        processWallMs: 0,
        assignedExpansions,
        consumedExpansions: 0,
        deadlineEpochMs: assignedDeadlineMs,
        inputStateKeysVerified: 0,
        outputStateKeysVerified: 0,
        stateRoundTripIdentity: false,
        simulatorProfileIdentity: false,
        requestedSimulatorProfile: simulatorProfile,
        appliedSimulatorProfile: null,
      },
    };
  }

  const parentInputStateKeys = inputFrontier.map((cand) => buildStateKey(cand.state));
  // P2: strict count check before spawn (fail-closed if parent keys count mismatched)
  if (parentInputStateKeys.length !== inputFrontier.length) {
    throw new Error(`Input frontier length ${inputFrontier.length} != parentInputStateKeys length ${parentInputStateKeys.length}`);
  }

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tmpDir = os.tmpdir();
  const inputPath = path.join(tmpDir, `segment-input-${runId}.json`);
  const outputPath = path.join(tmpDir, `segment-output-${runId}.json`);

  // Build child globalBudget if parent had global budget authority
  let childGlobalBudget = null;
  if (globalBudget) {
    childGlobalBudget = {
      scope: "global-run",
      requestedExpansions: assignedExpansions,
      requestedRuntimeMs: childSearchRuntimeMs,
      consumedExpansions: 0,
      consumedWallMs: 0,
      startedAt: Date.now(),
      deadlineMs: childDeadlineMs,
      stoppedReason: null,
    };
  }

  const runIdForEnvelope = runId; // stable invocationId for both files
  const envelopePath = path.join(tmpDir, `segment-envelope-${runId}.json`);

  // Compute effective thresholds once (independent of RSS)
  const requestedStopMb = Number((config && config.maxRssMb) || PROCESS_TREE_RSS_STOP_THRESHOLD_MB);
  const requestedHardMb = Number((config && config.maxRssHardCeilingMb) || PROCESS_TREE_RSS_HARD_CEILING_MB);
  const effectiveStopThresholdMb = Number.isFinite(requestedStopMb) && requestedStopMb > 0 ? requestedStopMb : PROCESS_TREE_RSS_STOP_THRESHOLD_MB;
  const effectiveHardThresholdMb = Number.isFinite(requestedHardMb) && requestedHardMb > effectiveStopThresholdMb ? requestedHardMb : effectiveStopThresholdMb + PROCESS_TREE_ALLOWED_OVERSHOOT_MB;

  // Build large immutable payload A (state/frontier/segment/profile) – without authoritative workerMax
  // WorkerMax will be supplied via tiny envelope B after atSpawn
  let workerPayloadA = {
    projectRoot,
    segment,
    inputFrontier,
    parentInputStateKeys,
    simulatorProfile,
    expectedProjectIdentity: runtimeDescriptor ? runtimeDescriptor.projectIdentity : null,
    assignedExpansions,
    assignedDeadlineMs,
    childDeadlineMs,
    invocationId: runIdForEnvelope,
    config: {
      ...(config || {}),
      globalBudget: childGlobalBudget,
      deadlineMs: childDeadlineMs,
      maxExpansions: assignedExpansions,
      maxRuntimeMs: childSearchRuntimeMs,
      // Placeholder – will be overridden by envelope's authoritative value
      maxRssMb: Math.max(1, effectiveStopThresholdMb - plannerRssBeforeSerializationMb),
      maxRssHardCeilingMb: Math.max(1, effectiveHardThresholdMb - plannerRssBeforeSerializationMb),
      assignedExpansions,
      assignedDeadlineMs: childDeadlineMs,
      deadlineEpochMs: undefined,
    },
    overrides: overrides || {},
  };

  // Serialize and write large payload A
  let payloadJsonA = JSON.stringify(workerPayloadA);
  fs.writeFileSync(inputPath, payloadJsonA);
  // Release large transient allocations before FINAL atSpawn
  payloadJsonA = null;
  workerPayloadA = null;
  if (typeof global.gc === "function") {
    try { global.gc(); } catch (_) {}
  }
  const plannerRssAtSpawnMb = Math.round((process.memoryUsage().rss / 1048576) * 10) / 10;

  // Authoritative worker headroom based on FINAL atSpawn (phase-correct model):
  // only parent RSS that is resident while the child is live (atSpawn) is charged
  // against the process-tree budget. Parent-only growth after child exit is a
  // separate phase and cannot shrink the child's envelope.
  // Both grants carry a sampling margin: the worker's DP memory checks run after
  // each action batch, so transient clones can overshoot between two checks. The
  // margins keep the phase-B concurrent sum (atSpawn + workerPeak) within the
  // 256 stop / 260 hard ceilings even with one batch of sampling overshoot.
  const WORKER_STOP_SAMPLING_MARGIN_MB = 4;
  const WORKER_HARD_SAMPLING_MARGIN_MB = 2;
  const workerMaxRssMb = Math.max(1, effectiveStopThresholdMb - plannerRssAtSpawnMb - WORKER_STOP_SAMPLING_MARGIN_MB);
  const workerHardCeilingMb = Math.max(1, effectiveHardThresholdMb - plannerRssAtSpawnMb - WORKER_HARD_SAMPLING_MARGIN_MB);

  // Write tiny envelope B (authoritative execution limits) – minimal serialization cost after FINAL sample
  const envelope = {
    invocationId: runIdForEnvelope,
    workerMaxRssMb,
    workerHardCeilingMb,
    effectiveStopThresholdMb,
    effectiveHardThresholdMb,
  };
  fs.writeFileSync(envelopePath, JSON.stringify(envelope));

  const workerScript = path.resolve(__dirname, "../segment-worker.js");
  const spawnTimeout = Math.max(1000, assignedRuntimeMs + 1000);
  const spawnStartedAt = Date.now();

  let childExitCode = -1;
  let spawnError = null;
  let spawnStderr = "";

  // Phase-correct spawn: worker returns data via output file (existing protocol), so
  // stdout must not accumulate in parent-resident buffers. stderr goes to a temp file
  // that is read only AFTER the child exits (parent-only phase).
  const stderrPath = path.join(tmpDir, `segment-stderr-${runId}.log`);
  let stderrFd = null;
  try { stderrFd = fs.openSync(stderrPath, "w"); } catch (_) { stderrFd = null; }
  try {
    const spawnRes = childProcess.spawnSync(process.execPath, ["--expose-gc", workerScript, inputPath, outputPath, envelopePath], {
      timeout: spawnTimeout,
      stdio: ["ignore", "ignore", stderrFd != null ? stderrFd : "ignore"],
    });
    childExitCode = spawnRes.status;
    if (spawnRes.error) spawnError = spawnRes.error;
  } catch (err) {
    spawnError = err;
  } finally {
    if (stderrFd != null) {
      try { fs.closeSync(stderrFd); } catch (_) {}
    }
  }
  // Phase C begins here: child has fully exited; parent-only RSS sampling.
  const plannerRssAfterChildExitMb = Math.round((process.memoryUsage().rss / 1048576) * 10) / 10;
  if (fs.existsSync(stderrPath)) {
    try { spawnStderr = fs.readFileSync(stderrPath, "utf8"); } catch (_) { spawnStderr = ""; }
  }
  const processWallMs = Date.now() - spawnStartedAt;

  let workerResponse = null;
  if (fs.existsSync(outputPath)) {
    try {
      workerResponse = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    } catch (_) {}
  }
  const plannerRssAfterOutputReadMb = Math.round((process.memoryUsage().rss / 1048576) * 10) / 10;

  // Cleanup temp files (including tiny envelope and stderr capture)
  try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch (_) {}
  try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (_) {}
  try { if (fs.existsSync(envelopePath)) fs.unlinkSync(envelopePath); } catch (_) {}
  try { if (fs.existsSync(stderrPath)) fs.unlinkSync(stderrPath); } catch (_) {}

  if (childExitCode !== 0 || !workerResponse || !workerResponse.success) {
    const isTimeout = spawnError && spawnError.code === "ETIMEDOUT";
    const failureClass = isTimeout ? "time-limit" : "subprocess-execution-failed";
    const failureReason = isTimeout ? "child worker execution timed out" : `child worker exited with code ${childExitCode}: ${spawnStderr.slice(0, 2000)}`;
    if (globalBudget) {
      if (isTimeout) globalBudget.stoppedReason = "time-limit";
      globalBudget.consumedWallMs = Date.now() - globalBudget.startedAt;
    }
    // Phase-correct invocation peak: only genuinely concurrent RSS is summed.
    const concurrentChildPhaseUpperBoundMb = plannerRssAtSpawnMb; // worker never reported a peak
    const parentOnlyPostPeakMb = Math.max(plannerRssAfterChildExitMb, plannerRssAfterOutputReadMb);
    const invocationProcessTreePeakMb = Math.max(
      plannerRssBeforeSerializationMb,
      concurrentChildPhaseUpperBoundMb,
      parentOnlyPostPeakMb,
    );
    return {
      segment,
      inputFrontier,
      merged: [],
      attempts: [],
      summary: {
        segmentId: segment.id,
        label: segment.label,
        found: false,
        startCandidatesTried: inputFrontier.length,
        candidates: [],
        attempts: [],
        failurePropagation: {
          failureClass,
          primaryFailureClass: failureClass,
          reason: failureReason,
        },
      },
      candidateLimit,
      memoryLimited: false,
      memoryStopReason: null,
      telemetry: {
        plannerRssBeforeSerializationMb,
        plannerRssAtSpawnMb,
        plannerRssBeforeSpawnMb: plannerRssAtSpawnMb,
        plannerRssAfterSpawnMb: plannerRssAfterChildExitMb,
        plannerRssAfterChildExitMb,
        plannerRssAfterOutputReadMb,
        workerPeakRssMb: 0,
        workerStartRssMb: 0,
        aggregateConcurrentRssUpperBoundMb: invocationProcessTreePeakMb,
        maxPlannerRssDuringIsolatedExecutionMb: parentOnlyPostPeakMb,
        maxWorkerPeakRssMb: 0,
        maxAggregateConcurrentRssUpperBoundMb: invocationProcessTreePeakMb,
        concurrentChildPhaseUpperBoundMb,
        parentOnlyPostPeakMb,
        invocationProcessTreePeakMb,
        isolatedInvocationCount: 1,
        invocationId: runId,
        processWallMs,
        assignedExpansions,
        consumedExpansions: 0,
        deadlineEpochMs: assignedDeadlineMs,
        inputStateKeysVerified: 0,
        outputStateKeysVerified: 0,
        stateRoundTripIdentity: false,
        simulatorProfileIdentity: false,
        requestedSimulatorProfile: simulatorProfile,
        appliedSimulatorProfile: workerResponse ? workerResponse.appliedSimulatorProfile : null,
      },
    };
  }

  // P1-1: hard assert worker consumed <= assigned BEFORE updating ledger
  const consumedExpansions = Number(workerResponse.consumedExpansions || 0);
  const workerAssignedExpansions = Number(workerResponse.assignedExpansions || assignedExpansions);
  if (globalBudget && consumedExpansions > workerAssignedExpansions) {
    throw new Error(`Worker budget overrun: consumed ${consumedExpansions} > assigned ${workerAssignedExpansions}`);
  }
  if (globalBudget && consumedExpansions > assignedExpansions) {
    throw new Error(`Worker budget overrun vs parent assigned: consumed ${consumedExpansions} > parent assigned ${assignedExpansions}`);
  }
  // Wall check: worker search should not exceed assignedRuntimeMs (with small grace)
  const workerSearchWallMs = Number(workerResponse.searchWallMs || 0);
  if (globalBudget && workerSearchWallMs > assignedRuntimeMs + 500) {
    // Allow 500ms grace for process exit, but hard fail if significantly over
    throw new Error(`Worker wall overrun: searchWallMs ${workerSearchWallMs} > assignedRuntimeMs ${assignedRuntimeMs}`);
  }

  // P2: strict StateKey protocol – input count already verified by worker, but parent verifies output strictly
  const merged = workerResponse.merged || [];
  // Verify every output has outputStateKey and matches parent recomputed key (fail-closed)
  let outputStateKeysVerified = 0;
  for (const cand of merged) {
    if (!cand.outputStateKey) {
      throw new Error(`Missing outputStateKey on output candidate ${cand.id}: subprocess protocol failure`);
    }
    const parentKey = buildStateKey(cand.state);
    if (parentKey !== cand.outputStateKey) {
      throw new Error(`Round-trip stateKey mismatch on output candidate ${cand.id}: worker ${cand.outputStateKey} !== parent ${parentKey}`);
    }
    outputStateKeysVerified += 1;
  }
  // P2 strict: worker must explicitly report input verification count – no fallback
  if (workerResponse.inputStateKeysVerified == null) {
    throw new Error(`Missing inputStateKeysVerified in worker response (IPC protocol requires explicit count)`);
  }
  const inputStateKeysVerified = Number(workerResponse.inputStateKeysVerified);
  if (!Number.isInteger(inputStateKeysVerified)) {
    throw new Error(`Invalid inputStateKeysVerified ${workerResponse.inputStateKeysVerified}`);
  }
  // If worker reported frontier length, hard assert match
  if (workerResponse.inputFrontierLength != null && workerResponse.inputFrontierLength !== inputFrontier.length) {
    throw new Error(`Worker inputFrontierLength ${workerResponse.inputFrontierLength} != parent ${inputFrontier.length}`);
  }
  if (inputStateKeysVerified !== inputFrontier.length) {
    throw new Error(`Input StateKey verification count ${inputStateKeysVerified} != inputFrontier length ${inputFrontier.length}`);
  }
  if (outputStateKeysVerified !== merged.length) {
    throw new Error(`Output StateKey verification count ${outputStateKeysVerified} != merged length ${merged.length}`);
  }
  const stateRoundTripIdentity = inputStateKeysVerified === inputFrontier.length && outputStateKeysVerified === merged.length;

  // Update parent global budget authoritatively AFTER assertions
  if (globalBudget) {
    globalBudget.consumedExpansions += consumedExpansions;
    globalBudget.consumedWallMs = Date.now() - globalBudget.startedAt;
    if (workerResponse.memoryLimited && (globalBudget.stoppedReason == null)) {
      globalBudget.stoppedReason = workerResponse.memoryStopReason;
    }
  }

  // Simulator profile identity check (Repair 2)
  const requestedSimulatorProfile = simulatorProfile;
  const appliedSimulatorProfile = workerResponse.appliedSimulatorProfile || null;
  let simulatorProfileIdentity = false;
  if (appliedSimulatorProfile && requestedSimulatorProfile) {
    try {
      simulatorProfileIdentity = JSON.stringify(appliedSimulatorProfile) === JSON.stringify(requestedSimulatorProfile);
    } catch (_) {
      simulatorProfileIdentity = false;
    }
    if (!simulatorProfileIdentity) {
      throw new Error(`Simulator profile mismatch: requested ${JSON.stringify(requestedSimulatorProfile)} != applied ${JSON.stringify(appliedSimulatorProfile)}`);
    }
  } else if (!appliedSimulatorProfile && requestedSimulatorProfile) {
    // Worker didn't return profile – treat as mismatch unless worker is old (fail-closed)
    throw new Error(`Missing appliedSimulatorProfile in worker response`);
  } else {
    simulatorProfileIdentity = true;
  }

  // P2-2: projectIdentity verification (thin path)
  const expectedProjectIdentity = runtimeDescriptor ? runtimeDescriptor.projectIdentity : null;
  const appliedProjectIdentity = workerResponse.appliedProjectIdentity || null;
  let projectIdentityMatch = true;
  if (expectedProjectIdentity) {
    if (!appliedProjectIdentity) {
      throw new Error("Missing appliedProjectIdentity in worker response (expected projectIdentity verification)");
    }
    try {
      const expectedStr = JSON.stringify(expectedProjectIdentity);
      const appliedStr = JSON.stringify(appliedProjectIdentity);
      projectIdentityMatch = expectedStr === appliedStr;
      if (!projectIdentityMatch) {
        throw new Error(`ProjectIdentity mismatch: expected ${expectedStr} != applied ${appliedStr}`);
      }
    } catch (e) {
      throw new Error(`ProjectIdentity comparison failed: ${e.message}`);
    }
  }

  const workerPeakRssMb = Number(workerResponse.workerPeakRssMb || 0);
  const workerStartRssMb = Number(workerResponse.workerStartRssMb || 0);
  const workerEndRssMb = Number(workerResponse.workerEndRssMb || 0);
  // Phase-correct invocation peak (Iteration 2c):
  //   Phase A (parent-only before child):      plannerRssBeforeSerializationMb
  //   Phase B (child-live concurrent):          plannerRssAtSpawnMb + workerPeakRssMb
  //   Phase C (parent-only after child exits):  max(afterChildExit, afterOutputRead)
  // Only genuinely concurrent RSS is summed; post-child parent growth cannot be
  // retroactively charged against the child-live phase.
  const concurrentChildPhaseUpperBoundMb = Math.round((plannerRssAtSpawnMb + workerPeakRssMb) * 10) / 10;
  const parentOnlyPostPeakMb = Math.max(plannerRssAfterChildExitMb, plannerRssAfterOutputReadMb);
  const invocationProcessTreePeakMb = Math.max(
    plannerRssBeforeSerializationMb,
    concurrentChildPhaseUpperBoundMb,
    parentOnlyPostPeakMb,
  );
  const aggregateConcurrentRssUpperBoundMb = invocationProcessTreePeakMb;
  const maxPlannerRss = parentOnlyPostPeakMb;

  return {
    segment,
    inputFrontier,
    merged,
    attempts: workerResponse.attempts || [],
    summary: workerResponse.summary || {},
    candidateLimit: workerResponse.candidateLimit || candidateLimit,
    memoryLimited: Boolean(workerResponse.memoryLimited),
    memoryStopReason: workerResponse.memoryStopReason || null,
    telemetry: {
      plannerRssBeforeSerializationMb,
      plannerRssAtSpawnMb,
      plannerRssBeforeSpawnMb: plannerRssAtSpawnMb,
      plannerRssAfterSpawnMb: plannerRssAfterChildExitMb,
      plannerRssAfterChildExitMb,
      plannerRssAfterOutputReadMb,
      workerStartRssMb,
      workerEndRssMb,
      workerPeakRssMb,
      aggregateConcurrentRssUpperBoundMb,
      maxPlannerRssDuringIsolatedExecutionMb: maxPlannerRss,
      maxWorkerPeakRssMb: workerPeakRssMb,
      maxAggregateConcurrentRssUpperBoundMb: aggregateConcurrentRssUpperBoundMb,
      concurrentChildPhaseUpperBoundMb,
      parentOnlyPostPeakMb,
      invocationProcessTreePeakMb,
      isolatedInvocationCount: 1,
      invocationId: runId,
      processWallMs,
      searchWallMs: workerResponse.searchWallMs || processWallMs,
      assignedExpansions,
      consumedExpansions,
      deadlineEpochMs: assignedDeadlineMs,
      childDeadlineMs,
      workerMaxRssMb,
      inputStateKeysVerified,
      outputStateKeysVerified,
      stateRoundTripIdentity,
      simulatorProfileIdentity,
      requestedSimulatorProfile,
      appliedSimulatorProfile,
      projectIdentityMatch,
      expectedProjectIdentity,
      appliedProjectIdentity,
    },
  };
}

module.exports = {
  executeIsolatedSegment,
  PROCESS_TREE_RSS_STOP_THRESHOLD_MB,
  PROCESS_TREE_RSS_HARD_CEILING_MB,
  PROCESS_TREE_ALLOWED_OVERSHOOT_MB,
};
