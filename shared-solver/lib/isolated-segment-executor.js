"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
const { buildStateKey } = require("./state-key");

function executeIsolatedSegment(options) {
  const { simulator, segment, frontier, config, overrides } = options;
  const projectRoot = (simulator && simulator.project && (simulator.project.root || simulator.project.projectRoot)) ||
    (config && (config.projectRoot || config.projectPath)) ||
    path.resolve(__dirname, "../..", "Only upV2.1", "Only upV2.1");

  const startLimit = (config && config.candidateLimit != null)
    ? Math.max(1, Number(config.candidateLimit))
    : (frontier || []).length;
  const inputFrontier = (frontier || []).slice(0, startLimit);

  const globalBudget = config && config.globalBudget;
  const deadlineEpochMs = (globalBudget && globalBudget.deadlineMs) ||
    (config && config.deadlineMs) ||
    (Date.now() + Number((config && config.maxRuntimeMs) || 30000));
  const globalRemainingExpansions = globalBudget && globalBudget.requestedExpansions > 0
    ? Math.max(0, globalBudget.requestedExpansions - globalBudget.consumedExpansions)
    : Number((config && config.maxExpansions) || 50000);
  const globalRemainingRuntimeMs = Math.max(0, deadlineEpochMs - Date.now());

  if (globalBudget && (globalRemainingExpansions <= 0 || globalRemainingRuntimeMs <= 0)) {
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
      candidateLimit: startLimit,
      memoryLimited: false,
      memoryStopReason: null,
    };
  }

  const plannerRssBeforeSpawnMb = Math.round((process.memoryUsage().rss / 1048576) * 10) / 10;
  const parentInputStateKeys = inputFrontier.map((cand) => buildStateKey(cand.state));

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tmpDir = os.tmpdir();
  const inputPath = path.join(tmpDir, `segment-input-${runId}.json`);
  const outputPath = path.join(tmpDir, `segment-output-${runId}.json`);

  const workerPayload = {
    projectRoot,
    segment,
    inputFrontier,
    parentInputStateKeys,
    config: {
      ...(config || {}),
      globalBudget: undefined,
      deadlineEpochMs,
      maxExpansions: globalRemainingExpansions,
      maxRuntimeMs: globalRemainingRuntimeMs,
    },
    overrides: overrides || {},
  };

  fs.writeFileSync(inputPath, JSON.stringify(workerPayload));

  const workerScript = path.resolve(__dirname, "../segment-worker.js");
  const spawnTimeout = Math.max(1000, globalRemainingRuntimeMs + 2000);
  const spawnStartedAt = Date.now();

  let childExitCode = -1;
  let spawnError = null;
  let spawnStderr = "";

  try {
    const spawnRes = childProcess.spawnSync(process.execPath, ["--expose-gc", workerScript, inputPath, outputPath], {
      timeout: spawnTimeout,
      maxBuffer: 50 * 1024 * 1024,
      encoding: "utf8",
    });
    childExitCode = spawnRes.status;
    spawnStderr = spawnRes.stderr || "";
    if (spawnRes.error) spawnError = spawnRes.error;
  } catch (err) {
    spawnError = err;
  }

  const plannerRssAfterSpawnMb = Math.round((process.memoryUsage().rss / 1048576) * 10) / 10;
  const processWallMs = Date.now() - spawnStartedAt;

  let workerResponse = null;
  if (fs.existsSync(outputPath)) {
    try {
      workerResponse = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    } catch (_) {}
  }

  // Cleanup temp files
  try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch (_) {}
  try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (_) {}

  if (childExitCode !== 0 || !workerResponse || !workerResponse.success) {
    const isTimeout = spawnError && spawnError.code === "ETIMEDOUT";
    const failureClass = isTimeout ? "time-limit" : "subprocess-execution-failed";
    const failureReason = isTimeout ? "child worker execution timed out" : `child worker exited with code ${childExitCode}: ${spawnStderr}`;

    if (globalBudget) {
      if (isTimeout) globalBudget.stoppedReason = "time-limit";
      globalBudget.consumedWallMs = Date.now() - globalBudget.startedAt;
    }

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
      candidateLimit: startLimit,
      memoryLimited: false,
      memoryStopReason: null,
      telemetry: {
        plannerRssBeforeSpawnMb,
        plannerRssAfterSpawnMb,
        workerPeakRssMb: 0,
        aggregateConcurrentRssUpperBoundMb: Math.max(plannerRssBeforeSpawnMb, plannerRssAfterSpawnMb),
        processWallMs,
      },
    };
  }

  // Round-trip state key verification on returned merged candidates
  const merged = workerResponse.merged || [];
  for (const cand of merged) {
    const parentKey = buildStateKey(cand.state);
    if (cand.outputStateKey && parentKey !== cand.outputStateKey) {
      throw new Error(`Round-trip stateKey mismatch on output candidate ${cand.id}: worker ${cand.outputStateKey} !== parent ${parentKey}`);
    }
  }

  // Update parent global budget authoritatively
  const consumedExpansions = Number(workerResponse.consumedExpansions || 0);
  if (globalBudget) {
    globalBudget.consumedExpansions += consumedExpansions;
    globalBudget.consumedWallMs = Date.now() - globalBudget.startedAt;
    if (workerResponse.memoryLimited && (globalBudget.stoppedReason == null)) {
      globalBudget.stoppedReason = workerResponse.memoryStopReason;
    }
  }

  const workerPeakRssMb = Number(workerResponse.workerPeakRssMb || 0);
  const aggregateConcurrentRssUpperBoundMb = Math.round((Math.max(plannerRssBeforeSpawnMb, plannerRssAfterSpawnMb) + workerPeakRssMb) * 10) / 10;

  return {
    segment,
    inputFrontier,
    merged,
    attempts: workerResponse.attempts || [],
    summary: workerResponse.summary || {},
    candidateLimit: workerResponse.candidateLimit || startLimit,
    memoryLimited: Boolean(workerResponse.memoryLimited),
    memoryStopReason: workerResponse.memoryStopReason || null,
    telemetry: {
      plannerRssBeforeSpawnMb,
      plannerRssAfterSpawnMb,
      workerPeakRssMb,
      aggregateConcurrentRssUpperBoundMb,
      processWallMs,
      searchWallMs: workerResponse.searchWallMs || processWallMs,
    },
  };
}

module.exports = {
  executeIsolatedSegment,
};
