"use strict";

const assert = require("node:assert");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  FIXED_INPUTS,
  ensureFixedRoute,
} = require("./audit-replay-start-offset-contract");
const { loadProject } = require("./lib/project-loader");
const { findBrowserExecutable } = require("./lib/live-replay");
const {
  decodeH5SavePackage,
  encodeH5SavePackage,
  summarizeResumeDecision,
  validateResumeArtifact,
} = require("./lib/replay-resume-artifact");
const { exportH5Segment, openNativeReplay } = require("./export-h5-segment");

const TIMEOUT_MS = 30000;

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function runCli(args) {
  const result = childProcess.spawnSync(process.execPath, ["export-h5-segment.js", ...args], {
    cwd: __dirname,
    encoding: "utf8",
    timeout: TIMEOUT_MS,
    windowsHide: true,
  });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  const match = output.match(/REPLAY_RESUME_[A-Z_]+/);
  return {
    exitCode: result.status,
    output,
    errorCode: match ? match[0] : null,
  };
}

function assertCliMismatch(result, expectedCode, label) {
  assert.notStrictEqual(result.exitCode, 0, `${label}: CLI must reject`);
  assert.strictEqual(result.errorCode, expectedCode, `${label}: error code`);
  assert.ok(!result.output.includes("Replay opened:"), `${label}: native replay must not open`);
  assert.ok(!result.output.includes("Runtime URL:"), `${label}: runtime URL must not be printed`);
}

function assertCliSuccess(result, label) {
  assert.strictEqual(result.exitCode, 0, `${label}: CLI must succeed\n${result.output}`);
  assert.strictEqual(result.errorCode, null, `${label}: no resume error code`);
  assert.ok(result.output.includes("Replay opened:"), `${label}: native replay opened`);
  assert.ok(result.output.includes("Runtime URL:"), `${label}: runtime URL printed`);
}

function writeTamperedH5Save(projectRoot, outDir, savePackage, id, mutate) {
  const tampered = cloneJson(savePackage);
  mutate(tampered);
  const filePath = path.join(outDir, `${id}.h5save`);
  fs.writeFileSync(filePath, encodeH5SavePackage(projectRoot, tampered), "utf8");
  return filePath;
}

function displayOfStatus(status) {
  const hero = status && status.hero || {};
  const loc = hero.loc || {};
  return {
    floorId: status && status.floorId || null,
    x: loc.x,
    y: loc.y,
    direction: loc.direction,
    hp: hero.hp,
    atk: hero.atk,
    def: hero.def,
    mdef: hero.mdef,
  };
}

async function main() {
  const browserInput = FIXED_INPUTS.find((candidate) => candidate.tower === "whiteisland");
  const wrongProjectInput = FIXED_INPUTS.find((candidate) => candidate.tower === "onlyup");
  assert.ok(browserInput, "WhiteIsland fixed route input is required");
  assert.ok(wrongProjectInput, "OnlyUp fixed route input is required for mismatch control");
  assert.ok(findBrowserExecutable(), "Chrome/Edge executable is required for h5save live smoke");

  const input = ensureFixedRoute(browserInput);
  const wrongProject = ensureFixedRoute(wrongProjectInput);
  const routeRecord = input.routeRecord;
  const projectRoot = input.projectRoot;
  const routeFile = input.routeFile;
  const checkpointStep = 1;
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "motapathfinder-pr-5.1b1-"));

  try {
    const exported = await exportH5Segment({
      routeRecord,
      routeFile,
      projectRoot,
      checkpointStep,
      outDir,
      timeoutMs: TIMEOUT_MS,
    });
    const decoded = decodeH5SavePackage(projectRoot, exported.h5saveFile);
    const artifact = decoded.artifact;
    const project = loadProject(projectRoot);
    const validation = validateResumeArtifact(decoded.artifact, {
      project,
      routeRecord,
      projectRoot,
      saveData: decoded.saveData,
      requireRoute: true,
    });

    assert.deepStrictEqual(
      Object.keys(decoded.savePackage),
      ["name", "version", "data", "__solverResumeArtifact__"],
      "h5save package fields",
    );
    assert.strictEqual(validation.projectFingerprintMatches, true, "project fingerprint validation");
    assert.strictEqual(validation.routeFingerprintMatches, true, "route fingerprint validation");
    assert.strictEqual(validation.payloadBindingVerified, true, "native/suffix payload binding");
    assert.strictEqual(artifact.boundary.executedStepCount, checkpointStep, "boundary executed step count");
    assert.strictEqual(artifact.boundary.nextStep, checkpointStep + 1, "boundary next step");
    assert.strictEqual(artifact.boundary.exactStateKey, routeRecord.decisions[checkpointStep - 1].postExactStateKey, "boundary exact state key");
    assert.deepStrictEqual(artifact.boundary.routeSnapshot, routeRecord.decisions[checkpointStep - 1].postSnapshot, "route boundary snapshot preserved");
    assert.strictEqual(artifact.boundary.identityMatches, true, "exported boundary identity");
    assert.strictEqual(artifact.boundary.runtimeSnapshotIdentity, artifact.boundary.capturedRuntimeSnapshotIdentity, "exported boundary identity hashes");
    assert.deepStrictEqual(artifact.boundary.nextDecision, summarizeResumeDecision(routeRecord.decisions[checkpointStep]), "next decision contract");
    assert.strictEqual(artifact.continuation.suffixDecisionCount, routeRecord.decisions.length - checkpointStep, "suffix count");
    assert.strictEqual(artifact.continuation.finalExactStateKey, routeRecord.final.exactStateKey, "final exact state key");
    assert.deepStrictEqual(artifact.continuation.routeFinalSnapshot, routeRecord.final.snapshot, "route final snapshot preserved");
    assert.strictEqual(artifact.continuation.identityMatches, true, "exported final identity");
    assert.strictEqual(artifact.continuation.runtimeSnapshotIdentity, artifact.continuation.capturedRuntimeSnapshotIdentity, "exported final identity hashes");

    const loaderResult = await openNativeReplay({
      projectRoot,
      saveData: decoded.saveData,
      resumeArtifact: artifact,
      routeRecord,
      encodedSuffixRoute: decoded.saveData.__toReplay__,
      rank: decoded.saveData.hard || "chaos",
      timeoutMs: TIMEOUT_MS,
      headless: true,
      keepOpen: false,
      autoPlay: true,
      runtimeAutoBattle: false,
      runtimeAutoPickup: true,
      postStabilize: false,
    });
    assert.strictEqual(loaderResult.artifactValidation.routeVerified, true, "loader route verification");
    assert.strictEqual(loaderResult.artifactValidation.payloadBindingVerified, true, "loader payload binding");
    assert.strictEqual(loaderResult.boundaryVerification.identityMatches, true, "loader-owned boundary identity");
    assert.strictEqual(loaderResult.boundaryVerification.displayMatches, true, "loader-owned boundary display");
    assert.strictEqual(loaderResult.nextDecisionVerification.nextDecisionMatches, true, "loader-owned next decision");
    assert.strictEqual(loaderResult.suffixDecisionCountBeforeBoundaryVerification, 0, "no suffix decision before boundary verification");
    assert.strictEqual(loaderResult.finalVerification.identityMatches, true, "loader-owned final identity");
    assert.strictEqual(loaderResult.finalVerification.displayMatches, true, "loader-owned final display");
    assert.strictEqual(loaderResult.suffixDecisionCount, routeRecord.decisions.length - checkpointStep, "loader suffix execution count");

    const projectMismatchCli = runCli([
      `--project-root=${wrongProject.projectRoot}`,
      `--h5save=${exported.h5saveFile}`,
      `--route-file=${routeFile}`,
    ]);
    assertCliMismatch(
      projectMismatchCli,
      "REPLAY_RESUME_PROJECT_FINGERPRINT_MISMATCH",
      "project fingerprint CLI mismatch",
    );
    const routeMismatchCli = runCli([
      `--project-root=${projectRoot}`,
      `--h5save=${exported.h5saveFile}`,
      `--route-file=${wrongProject.routeFile}`,
    ]);
    assertCliMismatch(
      routeMismatchCli,
      "REPLAY_RESUME_ROUTE_FINGERPRINT_MISMATCH",
      "route fingerprint CLI mismatch",
    );
    const routeRequiredCli = runCli([
      `--project-root=${projectRoot}`,
      `--h5save=${exported.h5saveFile}`,
    ]);
    assertCliMismatch(
      routeRequiredCli,
      "REPLAY_RESUME_ROUTE_REQUIRED",
      "route file required by default",
    );
    const legacyUnverifiedRouteCli = runCli([
      `--project-root=${projectRoot}`,
      `--h5save=${exported.h5saveFile}`,
      "--allow-unverified-route=1",
    ]);
    assertCliSuccess(legacyUnverifiedRouteCli, "explicit legacy unverified-route mode");

    const tamperControls = [
      {
        id: "tampered-native-save-payload",
        expectedCode: "REPLAY_RESUME_NATIVE_PAYLOAD_MISMATCH",
        mutate: (savePackage) => {
          savePackage.data.hero.hp = Number(savePackage.data.hero.hp || 0) + 1;
        },
      },
      {
        id: "tampered-boundary-snapshot",
        expectedCode: "REPLAY_RESUME_RUNTIME_IDENTITY_MISMATCH",
        mutate: (savePackage) => {
          savePackage.__solverResumeArtifact__.boundary.snapshot.hero.hp += 1;
        },
      },
      {
        id: "tampered-structured-suffix",
        expectedCode: "REPLAY_RESUME_STRUCTURED_SUFFIX_ROUTE_MISMATCH",
        mutate: (savePackage) => {
          savePackage.data.__solverReplay__[0].summary = `${savePackage.data.__solverReplay__[0].summary}:tampered`;
        },
      },
      {
        id: "tampered-final-snapshot",
        expectedCode: "REPLAY_RESUME_RUNTIME_IDENTITY_MISMATCH",
        mutate: (savePackage) => {
          savePackage.__solverResumeArtifact__.continuation.finalSnapshot.hero.hp += 1;
        },
      },
    ];
    const tamperResults = tamperControls.map((control) => {
      const tamperedFile = writeTamperedH5Save(projectRoot, outDir, decoded.savePackage, control.id, control.mutate);
      const result = runCli([
        `--project-root=${projectRoot}`,
        `--h5save=${tamperedFile}`,
        `--route-file=${routeFile}`,
      ]);
      assertCliMismatch(result, control.expectedCode, control.id);
      return {
        id: control.id,
        errorCode: result.errorCode,
        suffixExecutedBeforeReject: false,
      };
    });

    process.stdout.write(`${JSON.stringify({
      schema: "motapathfinder.pr-5.1b1-loader-owned-resume-live.v1",
      status: "passed",
      input: {
        tower: input.tower,
        routeFile,
        checkpointStep,
      },
      package: {
        artifactSchema: artifact.schema,
        topLevelKeys: Object.keys(decoded.savePackage),
        projectFingerprintMatches: validation.projectFingerprintMatches,
        routeFingerprintMatches: validation.routeFingerprintMatches,
        payloadBindingVerified: validation.payloadBindingVerified,
      },
      loaderOwned: {
        boundaryIdentityMatches: loaderResult.boundaryVerification.identityMatches,
        boundaryDisplayMatches: loaderResult.boundaryVerification.displayMatches,
        nextDecisionMatches: loaderResult.nextDecisionVerification.nextDecisionMatches,
        suffixDecisionCountBeforeBoundaryVerification: loaderResult.suffixDecisionCountBeforeBoundaryVerification,
        suffixDecisionCount: loaderResult.suffixDecisionCount,
        finalIdentityMatches: loaderResult.finalVerification.identityMatches,
        finalDisplayMatches: loaderResult.finalVerification.displayMatches,
        finalDisplay: displayOfStatus(loaderResult.status),
      },
      routePolicy: {
        defaultRouteRequiredErrorCode: routeRequiredCli.errorCode,
        legacyUnverifiedRouteAllowed: legacyUnverifiedRouteCli.exitCode === 0,
      },
      mismatchControls: [
        { id: "project-fingerprint-mismatch", errorCode: projectMismatchCli.errorCode, suffixExecutedBeforeReject: false },
        { id: "route-fingerprint-mismatch", errorCode: routeMismatchCli.errorCode, suffixExecutedBeforeReject: false },
        { id: "route-file-required", errorCode: routeRequiredCli.errorCode, suffixExecutedBeforeReject: false },
        ...tamperResults,
      ],
    }, null, 2)}\n`);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  });
}

module.exports = { main };
