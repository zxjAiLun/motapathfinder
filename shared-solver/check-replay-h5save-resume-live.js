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
const {
  buildRuntimeSnapshotIdentityPair,
  captureRuntimeSnapshot,
  executeRouteDecision,
  findBrowserExecutable,
  launchRuntimeSession,
  prepareReplayRouteRecord,
  projectSupportsRuntimeAutoBattle,
  routeSnapshotFloors,
  stabilizeRuntime,
  waitForRuntimeIdle,
} = require("./lib/live-replay");
const {
  decodeH5SavePackage,
  loadRuntimeSaveData,
  summarizeResumeDecision,
  validateResumeArtifact,
} = require("./lib/replay-resume-artifact");
const { exportH5Segment } = require("./export-h5-segment");

const TIMEOUT_MS = 30000;

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function displayOfSnapshot(snapshot) {
  const hero = (snapshot && snapshot.hero) || {};
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
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "motapathfinder-pr-5.1b-"));

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
    const project = loadProject(projectRoot);
    const validation = validateResumeArtifact(decoded.artifact, { project, routeRecord });
    const artifact = decoded.artifact;
    const runtimeRouteRecord = prepareReplayRouteRecord(routeRecord, projectRoot);
    const runtimeAutoBattle = projectSupportsRuntimeAutoBattle(projectRoot);
    const identityOptions = {
      projectRoot,
      runtimeAutoBattle,
      routeStartSnapshot: runtimeRouteRecord.start.snapshot,
    };

    assert.deepStrictEqual(
      Object.keys(decoded.savePackage),
      ["name", "version", "data", "__solverResumeArtifact__"],
      "h5save package fields",
    );
    assert.strictEqual(validation.projectFingerprintMatches, true, "project fingerprint validation");
    assert.strictEqual(validation.routeFingerprintMatches, true, "route fingerprint validation");
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

    const projectMismatch = cloneJson(artifact);
    projectMismatch.projectFingerprint.fingerprintSha256 = "0".repeat(64);
    assert.throws(
      () => validateResumeArtifact(projectMismatch, { project, routeRecord }),
      (error) => error && error.code === "REPLAY_RESUME_PROJECT_FINGERPRINT_MISMATCH",
      "project fingerprint mismatch control",
    );
    const routeMismatch = cloneJson(artifact);
    routeMismatch.routeFingerprint.sha256 = "0".repeat(64);
    assert.throws(
      () => validateResumeArtifact(routeMismatch, { project, routeRecord }),
      (error) => error && error.code === "REPLAY_RESUME_ROUTE_FINGERPRINT_MISMATCH",
      "route fingerprint mismatch control",
    );

    const projectMismatchCli = runCli([
      `--project-root=${wrongProject.projectRoot}`,
      `--h5save=${exported.h5saveFile}`,
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

    const runtime = await launchRuntimeSession(runtimeRouteRecord, {
      projectRoot,
      headless: "1",
      timeoutMs: TIMEOUT_MS,
      runtimeAutoBattle,
      runtimeAutoPickup: true,
    });
    try {
      await loadRuntimeSaveData(runtime.page, decoded.saveData, {
        runtimeAutoBattle,
        runtimeAutoPickup: true,
      });
      await waitForRuntimeIdle(runtime.page, TIMEOUT_MS);
      await stabilizeRuntime(runtime.page, TIMEOUT_MS, runtime.options);

      const loadedSnapshot = await captureRuntimeSnapshot(runtime.page, {
        verifyFloors: routeSnapshotFloors(runtimeRouteRecord, {}),
      });
      const loadedIdentity = buildRuntimeSnapshotIdentityPair(
        artifact.boundary.snapshot,
        loadedSnapshot,
        identityOptions,
      );
      assert.strictEqual(loadedIdentity.matches, true, "fresh runtime boundary identity");
      assert.strictEqual(loadedIdentity.expected, artifact.boundary.runtimeSnapshotIdentity, "fresh runtime expected boundary identity");
      assert.strictEqual(loadedIdentity.actual, artifact.boundary.capturedRuntimeSnapshotIdentity, "fresh runtime captured boundary identity");
      assert.deepStrictEqual(displayOfSnapshot(loadedSnapshot), displayOfSnapshot(artifact.boundary.snapshot), "fresh runtime boundary display");

      const stepResults = [];
      for (let index = checkpointStep; index < routeRecord.decisions.length; index += 1) {
        const result = await executeRouteDecision(runtime, routeRecord.decisions[index], {
          timeoutMs: TIMEOUT_MS,
          idleTimeoutMs: TIMEOUT_MS,
          stepDelayMs: 0,
          runtimeAutoBattle,
          runtimeAutoPickup: true,
          routeStartSnapshot: runtimeRouteRecord.start.snapshot,
        });
        assert.strictEqual(result.ok, true, `fresh runtime continuation step ${index + 1}`);
        assert.strictEqual(result.runtimeSnapshotIdentityMatches, true, `fresh runtime continuation identity ${index + 1}`);
        stepResults.push({ index: index + 1, summary: routeRecord.decisions[index].summary });
      }

      const finalSnapshot = await captureRuntimeSnapshot(runtime.page, {
        verifyFloors: routeSnapshotFloors(runtimeRouteRecord, {}),
      });
      const finalIdentity = buildRuntimeSnapshotIdentityPair(
        artifact.continuation.finalSnapshot,
        finalSnapshot,
        identityOptions,
      );
      assert.strictEqual(finalIdentity.matches, true, "fresh runtime final identity");
      assert.strictEqual(finalIdentity.expected, artifact.continuation.runtimeSnapshotIdentity, "fresh runtime expected final identity");
      assert.strictEqual(finalIdentity.actual, artifact.continuation.capturedRuntimeSnapshotIdentity, "fresh runtime captured final identity");
      assert.deepStrictEqual(displayOfSnapshot(finalSnapshot), displayOfSnapshot(routeRecord.final.snapshot), "fresh runtime final display");

      process.stdout.write(`${JSON.stringify({
        schema: "motapathfinder.pr-5.1b-h5save-resume-live.v1",
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
        },
        boundary: {
          loadedRuntimeIdentityMatches: loadedIdentity.matches,
          nextDecision: artifact.boundary.nextDecision,
          displayed: displayOfSnapshot(loadedSnapshot),
        },
        continuation: {
          steps: stepResults,
          finalIdentityMatches: finalIdentity.matches,
          displayed: displayOfSnapshot(finalSnapshot),
        },
        mismatchControls: [
          { id: "project-fingerprint-mismatch", errorCode: projectMismatchCli.errorCode, runtimeLaunched: false },
          { id: "route-fingerprint-mismatch", errorCode: routeMismatchCli.errorCode, runtimeLaunched: false },
        ],
      }, null, 2)}\n`);
    } finally {
      await Promise.allSettled([
        runtime.context && runtime.context.close ? runtime.context.close() : Promise.resolve(),
        runtime.browser && runtime.browser.close ? runtime.browser.close() : Promise.resolve(),
        runtime.server && runtime.server.close ? runtime.server.close() : Promise.resolve(),
      ]);
    }
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
