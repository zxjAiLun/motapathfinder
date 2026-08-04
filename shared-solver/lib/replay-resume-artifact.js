"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { buildProjectFingerprint } = require("./region-entry-validator");
const {
  buildRuntimeSnapshotIdentity,
  buildRuntimeSnapshotIdentityPair,
  prepareReplayRouteRecord,
  projectSupportsRuntimeAutoBattle,
} = require("./live-replay");

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

function hashStableJson(value) {
  return `sha256:${sha256(stableStringify(value))}`;
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
  const objectiveFingerprint = routeRecord && routeRecord.metadata && routeRecord.metadata.objectiveFingerprint;
  if (objectiveFingerprint) input.objectiveFingerprint = objectiveFingerprint;
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

function buildNativeSavePayloadSha256(saveData) {
  return hashStableJson(stripResumeHelpers(saveData));
}

function buildStructuredSuffixSha256(suffix) {
  return hashStableJson(Array.isArray(suffix) ? suffix : []);
}

function buildEncodedSuffixSha256(encodedSuffix) {
  return hashStableJson(String(encodedSuffix == null ? "" : encodedSuffix));
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
  nativeSaveData,
  structuredSuffix,
  encodedSuffix,
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
      nativeSavePayloadSha256: nativeSaveData ? buildNativeSavePayloadSha256(nativeSaveData) : null,
      structuredSuffixSha256: structuredSuffix ? buildStructuredSuffixSha256(structuredSuffix) : null,
      encodedSuffixSha256: encodedSuffix != null ? buildEncodedSuffixSha256(encodedSuffix) : null,
    },
  };
}

function resumeRuntimeIdentityOptions(projectRoot, routeRecord) {
  const runtimeRouteRecord = routeRecord && projectRoot
    ? prepareReplayRouteRecord(routeRecord, projectRoot)
    : routeRecord;
  return {
    projectRoot: projectRoot || null,
    runtimeAutoBattle: projectRoot ? projectSupportsRuntimeAutoBattle(projectRoot) : false,
    routeStartSnapshot: projectRoot && runtimeRouteRecord && runtimeRouteRecord.start
      ? runtimeRouteRecord.start.snapshot
      : null,
  };
}

function verifyStoredRuntimeIdentity(artifact, sectionName, routeSnapshot, projectRoot, routeRecord) {
  const section = artifact[sectionName] || {};
  const storedSnapshot = sectionName === "continuation" ? section.finalSnapshot : section.snapshot;
  const identityOptions = resumeRuntimeIdentityOptions(projectRoot, routeRecord);
  let expected;
  let actual;
  let matches;
  if (routeRecord && routeSnapshot) {
    const pair = buildRuntimeSnapshotIdentityPair(routeSnapshot, storedSnapshot, identityOptions);
    expected = pair.expected;
    actual = pair.actual;
    matches = pair.matches;
  } else {
    actual = buildRuntimeSnapshotIdentity(storedSnapshot, identityOptions);
    expected = actual;
    matches = Boolean(actual && section.runtimeSnapshotIdentity === section.capturedRuntimeSnapshotIdentity);
  }
  if (
    !section.identityMatches ||
    !matches ||
    section.runtimeSnapshotIdentity !== expected ||
    section.capturedRuntimeSnapshotIdentity !== actual
  ) {
    throw resumeError(
      "REPLAY_RESUME_RUNTIME_IDENTITY_MISMATCH",
      `${sectionName} runtime snapshot identity does not match its stored snapshot and route boundary.`,
    );
  }
  return { expected, actual, matches };
}

function resumeSnapshotDisplay(snapshot) {
  const hero = snapshot && snapshot.hero || {};
  const loc = hero.loc || {};
  return {
    floorId: snapshot && snapshot.floorId || null,
    x: loc.x,
    y: loc.y,
    direction: loc.direction,
    hp: hero.hp,
    atk: hero.atk,
    def: hero.def,
    mdef: hero.mdef,
  };
}

function verifyRuntimeResumeSnapshot(artifact, phase, actualSnapshot, {
  projectRoot,
  routeRecord,
} = {}) {
  const sectionName = phase === "final" ? "continuation" : "boundary";
  const errorCode = phase === "final"
    ? "REPLAY_RESUME_FINAL_RUNTIME_MISMATCH"
    : "REPLAY_RESUME_BOUNDARY_RUNTIME_MISMATCH";
  const section = artifact && artifact[sectionName] || {};
  const storedSnapshot = sectionName === "continuation" ? section.finalSnapshot : section.snapshot;
  const routeSnapshot = phase === "final"
    ? section.routeFinalSnapshot
    : section.routeSnapshot;
  const identityOptions = resumeRuntimeIdentityOptions(projectRoot, routeRecord);
  const identity = routeRecord && routeSnapshot
    ? buildRuntimeSnapshotIdentityPair(routeSnapshot, actualSnapshot, identityOptions)
    : {
      expected: section.runtimeSnapshotIdentity,
      actual: buildRuntimeSnapshotIdentity(actualSnapshot, identityOptions),
      matches: Boolean(section.capturedRuntimeSnapshotIdentity && section.capturedRuntimeSnapshotIdentity === buildRuntimeSnapshotIdentity(actualSnapshot, identityOptions)),
    };
  const displayMatches = stableStringify(resumeSnapshotDisplay(actualSnapshot)) === stableStringify(resumeSnapshotDisplay(storedSnapshot));
  if (
    !identity.matches ||
    identity.expected !== section.runtimeSnapshotIdentity ||
    identity.actual !== section.capturedRuntimeSnapshotIdentity ||
    !displayMatches
  ) {
    throw resumeError(
      errorCode,
      `Loaded runtime ${phase} does not match the embedded resume artifact boundary.`,
    );
  }
  return {
    identityMatches: true,
    expectedRuntimeSnapshotIdentity: identity.expected,
    runtimeSnapshotIdentity: identity.actual,
    displayMatches,
  };
}

function verifyResumeNextDecision(artifact, solverReplay, { routeRecord, projectRoot } = {}) {
  const suffix = Array.isArray(solverReplay) ? solverReplay : [];
  const boundary = artifact && artifact.boundary || {};
  if (suffix.length !== Number((artifact.continuation || {}).suffixDecisionCount)) {
    throw resumeError(
      "REPLAY_RESUME_STRUCTURED_SUFFIX_MISMATCH",
      "Loaded structured suffix length does not match the resume artifact.",
    );
  }
  const actualNextDecision = summarizeResumeDecision(suffix[0] || null);
  if (stableStringify(actualNextDecision) !== stableStringify(boundary.nextDecision)) {
    throw resumeError(
      "REPLAY_RESUME_NEXT_DECISION_MISMATCH",
      "Loaded structured suffix first decision does not match the resume artifact.",
    );
  }
  if (routeRecord) {
    const runtimeRouteRecord = projectRoot
      ? prepareReplayRouteRecord(routeRecord, projectRoot)
      : routeRecord;
    const step = Number(boundary.executedStepCount);
    const expectedNextDecision = summarizeResumeDecision((runtimeRouteRecord.decisions || [])[step] || null);
    if (stableStringify(actualNextDecision) !== stableStringify(expectedNextDecision)) {
      throw resumeError(
        "REPLAY_RESUME_NEXT_DECISION_MISMATCH",
        "Loaded structured suffix first decision does not match the selected route.",
      );
    }
  }
  return { nextDecisionMatches: true, nextDecision: actualNextDecision };
}

function validateResumeArtifact(artifact, {
  project,
  routeRecord,
  projectRoot,
  saveData,
  requireRoute = false,
  allowUnverifiedRoute = false,
} = {}) {
  if (!artifact || artifact.schema !== RESUME_ARTIFACT_SCHEMA) {
    throw resumeError(
      "REPLAY_RESUME_ARTIFACT_SCHEMA_MISMATCH",
      `Unsupported replay resume artifact schema: ${artifact && artifact.schema || "missing"}.`,
    );
  }
  if (requireRoute && !routeRecord && !allowUnverifiedRoute) {
    throw resumeError(
      "REPLAY_RESUME_ROUTE_REQUIRED",
      "A route file is required to verify an embedded replay resume artifact; pass --allow-unverified-route=1 only for legacy replay.",
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
  const step = Number(boundary.executedStepCount);
  const nextStep = Number(boundary.nextStep);
  if (
    !Number.isInteger(step) ||
    step < 0 ||
    !Number.isInteger(nextStep) ||
    !boundary.snapshot ||
    !boundary.routeSnapshot ||
    !continuation.finalSnapshot ||
    !continuation.routeFinalSnapshot ||
    boundary.identityMatches !== true ||
    continuation.identityMatches !== true ||
    !boundary.runtimeSnapshotIdentity ||
    !boundary.capturedRuntimeSnapshotIdentity ||
    !continuation.runtimeSnapshotIdentity ||
    !continuation.capturedRuntimeSnapshotIdentity ||
    !artifact.nativeSave ||
    !artifact.nativeSave.nativeSavePayloadSha256 ||
    !artifact.nativeSave.structuredSuffixSha256 ||
    !artifact.nativeSave.encodedSuffixSha256
  ) {
    throw resumeError(
      "REPLAY_RESUME_BOUNDARY_INVALID",
      "Replay resume artifact has an invalid boundary snapshot or step.",
    );
  }
  if (nextStep !== step + 1) {
    throw resumeError(
      "REPLAY_RESUME_BOUNDARY_INVALID",
      "Replay resume artifact next step does not follow the executed step count.",
    );
  }
  if (routeRecord) {
    const runtimeRouteRecord = projectRoot
      ? prepareReplayRouteRecord(routeRecord, projectRoot)
      : routeRecord;
    const decisions = runtimeRouteRecord.decisions || [];
    if (step > decisions.length) {
      throw resumeError(
        "REPLAY_RESUME_BOUNDARY_ROUTE_MISMATCH",
        "Replay resume boundary step is outside the selected route.",
      );
    }
    const routeBoundary = step === 0
      ? runtimeRouteRecord.start
      : decisions[step - 1];
    if (!routeBoundary) {
      throw resumeError(
        "REPLAY_RESUME_BOUNDARY_ROUTE_MISMATCH",
        "Replay resume boundary is missing from the selected route.",
      );
    }
    const expectedBoundarySnapshot = step === 0
      ? runtimeRouteRecord.start.snapshot
      : routeBoundary.postSnapshot;
    const expectedBoundaryExactStateKey = routeBoundary.exactStateKey || routeBoundary.postExactStateKey || null;
    if (
      artifact.boundary.exactStateKey !== expectedBoundaryExactStateKey ||
      stableStringify(artifact.boundary.routeSnapshot) !== stableStringify(expectedBoundarySnapshot)
    ) {
      throw resumeError(
        "REPLAY_RESUME_BOUNDARY_ROUTE_MISMATCH",
        "Replay resume boundary metadata does not match the selected route boundary.",
      );
    }
    const expectedNextDecision = summarizeResumeDecision(decisions[step] || null);
    if (stableStringify(artifact.boundary.nextDecision) !== stableStringify(expectedNextDecision)) {
      throw resumeError(
        "REPLAY_RESUME_NEXT_DECISION_MISMATCH",
        "Replay resume next decision does not match the selected route.",
      );
    }
    if (Number(continuation.suffixDecisionCount) !== decisions.length - step) {
      throw resumeError(
        "REPLAY_RESUME_CONTINUATION_ROUTE_MISMATCH",
        "Replay resume suffix decision count does not match the selected route.",
      );
    }
    if (
      continuation.finalExactStateKey !== (runtimeRouteRecord.final && runtimeRouteRecord.final.exactStateKey) ||
      stableStringify(continuation.routeFinalSnapshot) !== stableStringify(runtimeRouteRecord.final && runtimeRouteRecord.final.snapshot)
    ) {
      throw resumeError(
        "REPLAY_RESUME_CONTINUATION_ROUTE_MISMATCH",
        "Replay resume final metadata does not match the selected route.",
      );
    }
    if (saveData && stableStringify(saveData.__solverReplay__) !== stableStringify(decisions.slice(step))) {
      throw resumeError(
        "REPLAY_RESUME_STRUCTURED_SUFFIX_ROUTE_MISMATCH",
        "Embedded structured suffix does not match the selected route suffix.",
      );
    }
  }

  verifyStoredRuntimeIdentity(
    artifact,
    "boundary",
    artifact.boundary.routeSnapshot,
    projectRoot,
    routeRecord,
  );
  verifyStoredRuntimeIdentity(
    artifact,
    "continuation",
    artifact.continuation.routeFinalSnapshot,
    projectRoot,
    routeRecord,
  );

  if (saveData) {
    if (buildNativeSavePayloadSha256(saveData) !== artifact.nativeSave.nativeSavePayloadSha256) {
      throw resumeError(
        "REPLAY_RESUME_NATIVE_PAYLOAD_MISMATCH",
        "Native save payload does not match the embedded resume artifact.",
      );
    }
    if (buildStructuredSuffixSha256(saveData.__solverReplay__) !== artifact.nativeSave.structuredSuffixSha256) {
      throw resumeError(
        "REPLAY_RESUME_STRUCTURED_SUFFIX_MISMATCH",
        "Structured suffix does not match the embedded resume artifact.",
      );
    }
    if (buildEncodedSuffixSha256(saveData.__toReplay__) !== artifact.nativeSave.encodedSuffixSha256) {
      throw resumeError(
        "REPLAY_RESUME_ENCODED_SUFFIX_MISMATCH",
        "Encoded native suffix does not match the embedded resume artifact.",
      );
    }
  }
  return {
    projectFingerprintMatches: Boolean(project),
    routeFingerprintMatches: Boolean(routeRecord),
    boundaryValid: true,
    routeVerified: Boolean(routeRecord),
    payloadBindingVerified: Boolean(saveData),
  };
}

function loadLzString(projectRoot) {
  return require(path.join(projectRoot, "libs", "thirdparty", "lz-string.min.js"));
}

function encodeH5SavePackage(projectRoot, savePackage) {
  return loadLzString(projectRoot).compressToBase64(JSON.stringify(savePackage));
}

function decodeH5SavePackageText(projectRoot, encodedText) {
  const lzString = loadLzString(projectRoot);
  let savePackage;
  try {
    const decoded = lzString.decompressFromBase64(String(encodedText || "").trim());
    savePackage = JSON.parse(decoded);
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

function decodeH5SavePackage(projectRoot, filePath) {
  try {
    return decodeH5SavePackageText(projectRoot, fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error && error.code === "REPLAY_RESUME_H5SAVE_INVALID") throw error;
    throw resumeError("REPLAY_RESUME_H5SAVE_INVALID", `Unable to read h5save: ${error.message}`);
  }
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
  buildEncodedSuffixSha256,
  buildNativeSavePayloadSha256,
  buildReplayRouteFingerprint,
  buildResumeArtifact,
  buildStructuredSuffixSha256,
  captureRuntimeSaveData,
  cloneJson,
  decodeH5SavePackage,
  decodeH5SavePackageText,
  encodeH5SavePackage,
  loadRuntimeSaveData,
  resumeError,
  stableStringify,
  stripResumeHelpers,
  summarizeResumeDecision,
  validateResumeArtifact,
  verifyResumeNextDecision,
  verifyRuntimeResumeSnapshot,
};
