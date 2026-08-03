"use strict";

const {
  decodeH5SavePackage,
  validateResumeArtifact,
} = require("./replay-resume-artifact");

const GUI_RESUME_STATUS_SCHEMA = "motapathfinder.route-gui-resume-status.v1";

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function displaySnapshot(snapshot) {
  const hero = snapshot && snapshot.hero || {};
  const loc = hero.loc || {};
  return {
    floorId: snapshot && snapshot.floorId || null,
    x: loc.x == null ? null : loc.x,
    y: loc.y == null ? null : loc.y,
    direction: loc.direction || null,
    hp: hero.hp == null ? null : hero.hp,
    atk: hero.atk == null ? null : hero.atk,
    def: hero.def == null ? null : hero.def,
    mdef: hero.mdef == null ? null : hero.mdef,
  };
}

function errorSummary(error) {
  if (!error) return null;
  return {
    code: error.code || null,
    message: error.message || String(error),
  };
}

function fingerprintMatchState(validation, failure, field, mismatchCode) {
  if (validation) {
    if (field === "route" && validation.routeVerified !== true) return null;
    return validation[`${field}FingerprintMatches`] === true ? true : null;
  }
  return failure && failure.code === mismatchCode ? false : null;
}

function bindingSummary(nativeSave, validation) {
  const data = nativeSave || {};
  return {
    nativeSavePayloadSha256: data.nativeSavePayloadSha256 || null,
    structuredSuffixSha256: data.structuredSuffixSha256 || null,
    encodedSuffixSha256: data.encodedSuffixSha256 || null,
    nativeSavePayloadBound: Boolean(data.nativeSavePayloadSha256),
    structuredSuffixBound: Boolean(data.structuredSuffixSha256),
    encodedSuffixBound: Boolean(data.encodedSuffixSha256),
    verified: Boolean(validation && validation.payloadBindingVerified),
  };
}

function sectionSummary(section, final) {
  const data = section || {};
  return {
    executedStepCount: final ? null : data.executedStepCount == null ? null : data.executedStepCount,
    nextStep: final ? null : data.nextStep == null ? null : data.nextStep,
    suffixDecisionCount: final ? data.suffixDecisionCount == null ? null : data.suffixDecisionCount : null,
    exactStateKey: final ? data.finalExactStateKey || null : data.exactStateKey || null,
    identityMatches: data.identityMatches === true,
    runtimeSnapshotIdentity: data.runtimeSnapshotIdentity || null,
    capturedRuntimeSnapshotIdentity: data.capturedRuntimeSnapshotIdentity || null,
    routeDisplay: displaySnapshot(final ? data.routeFinalSnapshot : data.routeSnapshot),
    runtimeDisplay: displaySnapshot(final ? data.finalSnapshot : data.snapshot),
    nextDecision: final ? null : cloneJson(data.nextDecision || null),
  };
}

function baseStatus({ h5saveFile, routeFile, allowUnverifiedRoute }) {
  return {
    schema: GUI_RESUME_STATUS_SCHEMA,
    requested: Boolean(h5saveFile),
    status: h5saveFile ? "failed" : "not-loaded",
    mode: h5saveFile ? "failed" : "none",
    h5saveFile: h5saveFile || null,
    routeFile: routeFile || null,
    allowUnverifiedRoute: allowUnverifiedRoute === true,
    routeVerified: false,
    projectFingerprintMatches: null,
    routeFingerprintMatches: null,
    artifactSchema: null,
    nativeSave: {
      name: null,
      version: null,
      format: null,
    },
    payloadBinding: bindingSummary(null, null),
    boundary: sectionSummary(null, false),
    continuation: sectionSummary(null, true),
    failure: null,
  };
}

function buildResumeGuiStatus({
  h5saveFile,
  routeFile,
  allowUnverifiedRoute,
  decoded,
  validation,
  failure,
} = {}) {
  const result = baseStatus({ h5saveFile, routeFile, allowUnverifiedRoute });
  if (!h5saveFile) return result;

  const artifact = decoded && decoded.artifact;
  const nativeSave = artifact && artifact.nativeSave || {};
  result.artifactSchema = artifact && artifact.schema || null;
  result.nativeSave = {
    name: nativeSave.name || null,
    version: nativeSave.version || null,
    format: nativeSave.format || null,
  };
  result.payloadBinding = bindingSummary(nativeSave, validation);
  result.boundary = sectionSummary(artifact && artifact.boundary, false);
  result.continuation = sectionSummary(artifact && artifact.continuation, true);
  result.projectFingerprintMatches = fingerprintMatchState(
    validation,
    failure,
    "project",
    "REPLAY_RESUME_PROJECT_FINGERPRINT_MISMATCH",
  );
  result.routeFingerprintMatches = fingerprintMatchState(
    validation,
    failure,
    "route",
    "REPLAY_RESUME_ROUTE_FINGERPRINT_MISMATCH",
  );
  result.routeVerified = validation ? validation.routeVerified === true : false;
  result.status = failure ? "failed" : result.routeVerified ? "verified" : "legacy";
  result.mode = result.status;
  result.failure = errorSummary(failure);
  return result;
}

function loadResumeArtifactForGui({
  project,
  projectRoot,
  h5saveFile,
  routeRecord,
  routeFile,
  allowUnverifiedRoute,
} = {}) {
  if (!h5saveFile) {
    return buildResumeGuiStatus({ routeFile, allowUnverifiedRoute });
  }

  let decoded;
  try {
    decoded = decodeH5SavePackage(projectRoot, h5saveFile);
  } catch (error) {
    return buildResumeGuiStatus({
      h5saveFile,
      routeFile,
      allowUnverifiedRoute,
      failure: error,
    });
  }

  let validation = null;
  let failure = null;
  try {
    validation = validateResumeArtifact(decoded.artifact, {
      project,
      routeRecord,
      projectRoot,
      saveData: decoded.saveData,
      requireRoute: true,
      allowUnverifiedRoute: allowUnverifiedRoute === true,
    });
  } catch (error) {
    failure = error;
  }
  return buildResumeGuiStatus({
    h5saveFile,
    routeFile,
    allowUnverifiedRoute,
    decoded,
    validation,
    failure,
  });
}

module.exports = {
  GUI_RESUME_STATUS_SCHEMA,
  buildResumeGuiStatus,
  displaySnapshot,
  loadResumeArtifactForGui,
};
