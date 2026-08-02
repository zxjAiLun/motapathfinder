"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { buildProjectFingerprint } = require("./region-entry-validator");

const RESUME_ARTIFACT_SCHEMA = "motapathfinder.replay-resume-artifact.v1";

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableValue(value[key]);
    return result;
  }, {});
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function portablePath(value) {
  if (value == null || value === "") return null;
  if (!path.isAbsolute(String(value))) return String(value).replace(/\\/g, "/");
  const repoRoot = path.resolve(__dirname, "..", "..");
  const relative = path.relative(repoRoot, String(value));
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative.replace(/\\/g, "/");
  }
  return String(value).replace(/\\/g, "/");
}

function resumeError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 409;
  return error;
}

function routeDecisionFingerprintInput(decision) {
  if (!decision) return null;
  return {
    index: decision.index || null,
    kind: decision.kind || null,
    summary: decision.summary || null,
    floorId: decision.floorId || null,
    path: Array.isArray(decision.path) ? decision.path.slice() : [],
    stance: cloneJson(decision.stance),
    target: cloneJson(decision.target),
    direction: decision.direction || null,
    tool: decision.tool || null,
    equipId: decision.equipId || null,
    equipType: decision.equipType == null ? null : decision.equipType,
    targetFloorId: decision.targetFloorId || null,
    enemyId: decision.enemyId || null,
    itemId: decision.itemId || null,
    doorId: decision.doorId || null,
    event: cloneJson(decision.event),
    changeFloor: cloneJson(decision.changeFloor),
    fingerprint: decision.fingerprint || null,
    preExactStateKey: decision.preExactStateKey || null,
    postExactStateKey: decision.postExactStateKey || null,
    preSnapshot: cloneJson(decision.preSnapshot),
    postSnapshot: cloneJson(decision.postSnapshot),
  };
}

function buildReplayRouteFingerprint(routeRecord) {
  const input = {
    schema: routeRecord && routeRecord.schema || null,
    source: {
      profile: routeRecord && routeRecord.source && routeRecord.source.profile || null,
      solver: routeRecord && routeRecord.source && routeRecord.source.solver || null,
      rank: routeRecord && routeRecord.source && routeRecord.source.rank || null,
    },
    goal: cloneJson(routeRecord && routeRecord.goal),
    start: {
      exactStateKey: routeRecord && routeRecord.start && routeRecord.start.exactStateKey || null,
      snapshot: cloneJson(routeRecord && routeRecord.start && routeRecord.start.snapshot),
    },
    decisions: (routeRecord && routeRecord.decisions || []).map(routeDecisionFingerprintInput),
    final: {
      exactStateKey: routeRecord && routeRecord.final && routeRecord.final.exactStateKey || null,
      snapshot: cloneJson(routeRecord && routeRecord.final && routeRecord.final.snapshot),
    },
  };
  return {
    algorithm: "sha256-stable-json-v1",
    sha256: sha256(stableStringify(input)),
  };
}

function summarizeResumeDecision(decision) {
  if (!decision) return null;
  return {
    index: decision.index || null,
    kind: decision.kind || null,
    summary: decision.summary || decision.fingerprint || null,
    fingerprint: decision.fingerprint || null,
    floorId: decision.floorId || null,
    preExactStateKey: decision.preExactStateKey || null,
    postExactStateKey: decision.postExactStateKey || null,
  };
}

function boundaryForStep(routeRecord, checkpointStep) {
  const step = Number(checkpointStep);
  if (step === 0) return routeRecord && routeRecord.start;
  return routeRecord && routeRecord.decisions && routeRecord.decisions[step - 1];
}

function buildResumeArtifact({
  project,
  projectRoot,
  routeRecord,
  routeFile,
  checkpointStep,
  boundarySnapshot,
  boundaryRuntimeSnapshot,
  boundaryIdentity,
  finalSnapshot,
  finalRuntimeSnapshot,
  finalIdentity,
  nativeName,
  nativeVersion,
}) {
  const step = Number(checkpointStep);
  const boundary = boundaryForStep(routeRecord, step);
  const decisions = routeRecord && routeRecord.decisions || [];
  if (!Number.isInteger(step) || step < 0 || step > decisions.length) {
    throw new Error(`Invalid resume checkpoint step ${checkpointStep}; route has ${decisions.length} decisions.`);
  }
  if (!boundarySnapshot || !boundaryIdentity || !finalSnapshot || !finalIdentity) {
    throw new Error("Resume artifact requires boundary and final runtime snapshots with identities.");
  }
  return {
    schema: RESUME_ARTIFACT_SCHEMA,
    version: 1,
    createdAt: new Date().toISOString(),
    projectRoot: portablePath(projectRoot),
    routeFile: portablePath(routeFile),
    projectFingerprint: buildProjectFingerprint(project),
    routeFingerprint: buildReplayRouteFingerprint(routeRecord),
    boundary: {
      executedStepCount: step,
      nextStep: step + 1,
      exactStateKey: boundary && (boundary.exactStateKey || boundary.postExactStateKey) || null,
      routeSnapshot: cloneJson(boundarySnapshot),
      snapshot: cloneJson(boundaryRuntimeSnapshot || boundarySnapshot),
      runtimeSnapshotIdentity: boundaryIdentity.expected || null,
      capturedRuntimeSnapshotIdentity: boundaryIdentity.actual || null,
      identityMatches: boundaryIdentity.matches === true,
      nextDecision: summarizeResumeDecision(decisions[step] || null),
    },
    continuation: {
      suffixDecisionCount: Math.max(0, decisions.length - step),
      finalExactStateKey: routeRecord && routeRecord.final && routeRecord.final.exactStateKey || null,
      routeFinalSnapshot: cloneJson(finalSnapshot),
      finalSnapshot: cloneJson(finalRuntimeSnapshot || finalSnapshot),
      runtimeSnapshotIdentity: finalIdentity.expected || null,
      capturedRuntimeSnapshotIdentity: finalIdentity.actual || null,
      identityMatches: finalIdentity.matches === true,
    },
    nativeSave: {
      name: nativeName || null,
      version: nativeVersion || null,
      format: "h5mota-core.saveData + lz-string base64",
    },
  };
}

function validateResumeArtifact(artifact, { project, routeRecord } = {}) {
  if (!artifact || artifact.schema !== RESUME_ARTIFACT_SCHEMA) {
    throw resumeError(
      "REPLAY_RESUME_ARTIFACT_SCHEMA_MISMATCH",
      `Unsupported replay resume artifact schema: ${artifact && artifact.schema || "missing"}.`,
    );
  }
  if (project) {
    const expected = buildProjectFingerprint(project);
    const actual = artifact.projectFingerprint || {};
    if (
      actual.fingerprintSha256 !== expected.fingerprintSha256 ||
      actual.structuralFingerprintSha256 !== expected.structuralFingerprintSha256
    ) {
      throw resumeError(
        "REPLAY_RESUME_PROJECT_FINGERPRINT_MISMATCH",
        "Replay resume artifact project fingerprint does not match the selected project.",
      );
    }
  }
  if (routeRecord) {
    const expected = buildReplayRouteFingerprint(routeRecord);
    const actual = artifact.routeFingerprint || {};
    if (actual.sha256 !== expected.sha256) {
      throw resumeError(
        "REPLAY_RESUME_ROUTE_FINGERPRINT_MISMATCH",
        "Replay resume artifact route fingerprint does not match the selected route.",
      );
    }
  }
  const boundary = artifact.boundary || {};
  const continuation = artifact.continuation || {};
  if (
    !Number.isInteger(Number(boundary.executedStepCount)) ||
    !Number.isInteger(Number(boundary.nextStep)) ||
    !boundary.snapshot ||
    !continuation.finalSnapshot ||
    boundary.identityMatches !== true ||
    continuation.identityMatches !== true
  ) {
    throw resumeError(
      "REPLAY_RESUME_BOUNDARY_INVALID",
      "Replay resume artifact has an invalid boundary snapshot or step.",
    );
  }
  if (Number(boundary.nextStep) !== Number(boundary.executedStepCount) + 1) {
    throw resumeError(
      "REPLAY_RESUME_BOUNDARY_INVALID",
      "Replay resume artifact next step does not follow the executed step count.",
    );
  }
  return {
    projectFingerprintMatches: Boolean(project),
    routeFingerprintMatches: Boolean(routeRecord),
    boundaryValid: true,
  };
}

function loadLzString(projectRoot) {
  return require(path.join(projectRoot, "libs", "thirdparty", "lz-string.min.js"));
}

function encodeH5SavePackage(projectRoot, savePackage) {
  return loadLzString(projectRoot).compressToBase64(JSON.stringify(savePackage));
}

function decodeH5SavePackage(projectRoot, filePath) {
  const lzString = loadLzString(projectRoot);
  let savePackage;
  try {
    savePackage = JSON.parse(lzString.decompressFromBase64(fs.readFileSync(filePath, "utf8")));
  } catch (error) {
    throw resumeError("REPLAY_RESUME_H5SAVE_INVALID", `Unable to decode h5save: ${error.message}`);
  }
  if (!savePackage || !savePackage.data) {
    throw resumeError("REPLAY_RESUME_H5SAVE_INVALID", "h5save package has no native data payload.");
  }
  return {
    savePackage,
    saveData: savePackage.data,
    artifact: savePackage.__solverResumeArtifact__ || null,
  };
}

function stripResumeHelpers(saveData) {
  const data = cloneJson(saveData || {});
  delete data.__toReplay__;
  delete data.__solverReplay__;
  delete data.__solverResumeArtifact__;
  return data;
}

async function captureRuntimeSaveData(page) {
  return page.evaluate(() => core.saveData());
}

async function loadRuntimeSaveData(page, saveData, options) {
  const config = options || {};
  const nativeData = stripResumeHelpers(saveData);
  await page.evaluate(({ data, enableAutoBattle, enableAutoPickup }) => new Promise((resolve) => {
    core.loadData(data, function () {
      core.removeFlag("__fromLoad__");
      if (enableAutoPickup) core.setFlag("shiqu", 1);
      if (enableAutoBattle) core.setFlag("autoBattle", 1);
      else core.setFlag("autoBattle", 0);
      if (core.updateCheckBlock) core.updateCheckBlock();
      resolve(true);
    });
  }), {
    data: nativeData,
    enableAutoBattle: config.runtimeAutoBattle !== false,
    enableAutoPickup: config.runtimeAutoPickup !== false,
  });
}

module.exports = {
  RESUME_ARTIFACT_SCHEMA,
  buildProjectFingerprint,
  buildReplayRouteFingerprint,
  buildResumeArtifact,
  captureRuntimeSaveData,
  cloneJson,
  decodeH5SavePackage,
  encodeH5SavePackage,
  loadRuntimeSaveData,
  resumeError,
  stableStringify,
  stripResumeHelpers,
  summarizeResumeDecision,
  validateResumeArtifact,
};
