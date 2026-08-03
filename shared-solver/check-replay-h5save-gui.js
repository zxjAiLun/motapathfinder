"use strict";

const assert = require("node:assert");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright-core");

const {
  FIXED_INPUTS,
  ensureFixedRoute,
} = require("./audit-replay-start-offset-contract");
const { createGuiServer } = require("./route-gui");
const { loadProject } = require("./lib/project-loader");
const {
  buildRuntimeSnapshotIdentity,
  buildRuntimeSnapshotIdentityPair,
  findBrowserExecutable,
  prepareReplayRouteRecord,
  projectSupportsRuntimeAutoBattle,
} = require("./lib/live-replay");
const {
  buildResumeArtifact,
  cloneJson,
  encodeH5SavePackage,
} = require("./lib/replay-resume-artifact");
const { loadResumeArtifactForGui } = require("./lib/replay-resume-gui");

const CHECK_SCHEMA = "motapathfinder.pr-5.1c1-replay-h5save-gui.v1";

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function makeStubSession(state) {
  const status = Object.assign({
    state: "idle",
    currentStep: 1,
    totalSteps: 0,
    selectedStep: 1,
    lastCompletedStep: 0,
    stepStatuses: {},
  }, state || {});
  return {
    getStatus() {
      return cloneJson(status);
    },
    async getStatusAsync() {
      return cloneJson(status);
    },
    selectStep() {
      return cloneJson(status);
    },
    pause() {
      return cloneJson(status);
    },
    async close() {
      return cloneJson(status);
    },
  };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address()));
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function fetchJson(baseUrl, pathname) {
  const response = await fetch(`${baseUrl}${pathname}`);
  const data = await response.json();
  assert.strictEqual(response.status, 200, `${pathname} should return 200`);
  return data;
}

function writePackage(projectRoot, outDir, savePackage, name) {
  const filePath = path.join(outDir, `${name}.h5save`);
  fs.writeFileSync(filePath, encodeH5SavePackage(projectRoot, savePackage), "utf8");
  return filePath;
}

function runtimeSnapshotWithStartBaseline(snapshot, startSnapshot) {
  const runtimeSnapshot = cloneJson(snapshot);
  const startFlags = startSnapshot && startSnapshot.flags || {};
  const startLeaveLoc = startFlags.__leaveLoc__;
  if (startLeaveLoc && typeof startLeaveLoc === "object") {
    runtimeSnapshot.flags = runtimeSnapshot.flags || {};
    runtimeSnapshot.flags.__leaveLoc__ = Object.assign(
      {},
      cloneJson(startLeaveLoc),
      cloneJson(runtimeSnapshot.flags.__leaveLoc__ || {}),
    );
  }
  const startFloors = startSnapshot && startSnapshot.floors || {};
  runtimeSnapshot.floors = runtimeSnapshot.floors || {};
  Object.entries(startFloors).forEach(([floorId, floor]) => {
    if (!Object.prototype.hasOwnProperty.call(runtimeSnapshot.floors, floorId)) {
      runtimeSnapshot.floors[floorId] = cloneJson(floor);
    }
  });
  return runtimeSnapshot;
}

function buildFixture(input, outDir) {
  const project = loadProject(input.projectRoot);
  const runtimeRouteRecord = prepareReplayRouteRecord(input.routeRecord, input.projectRoot);
  const checkpointStep = 1;
  const decisions = runtimeRouteRecord.decisions || [];
  requireCondition(decisions.length >= 2, "GUI resume fixture requires at least two route decisions");

  const boundarySnapshot = cloneJson(decisions[checkpointStep - 1].postSnapshot);
  const finalSnapshot = cloneJson(runtimeRouteRecord.final.snapshot);
  const boundaryRuntimeSnapshot = runtimeSnapshotWithStartBaseline(
    boundarySnapshot,
    runtimeRouteRecord.start.snapshot,
  );
  const finalRuntimeSnapshot = runtimeSnapshotWithStartBaseline(
    finalSnapshot,
    runtimeRouteRecord.start.snapshot,
  );
  const identityOptions = {
    projectRoot: input.projectRoot,
    runtimeAutoBattle: projectSupportsRuntimeAutoBattle(input.projectRoot),
    routeStartSnapshot: runtimeRouteRecord.start.snapshot,
  };
  const boundaryIdentity = buildRuntimeSnapshotIdentityPair(
    boundarySnapshot,
    boundaryRuntimeSnapshot,
    identityOptions,
  );
  const finalIdentity = buildRuntimeSnapshotIdentityPair(
    finalSnapshot,
    finalRuntimeSnapshot,
    identityOptions,
  );
  requireCondition(boundaryIdentity.matches, "GUI resume boundary fixture identity must match");
  requireCondition(finalIdentity.matches, "GUI resume final fixture identity must match");

  const suffix = cloneJson(decisions.slice(checkpointStep));
  const saveData = {
    floorId: boundarySnapshot.floorId,
    hero: cloneJson(boundarySnapshot.hero),
    route: "gui-prefix-fixture",
    __toReplay__: "gui-encoded-suffix",
    __solverReplay__: suffix,
  };
  const artifact = buildResumeArtifact({
    project,
    projectRoot: input.projectRoot,
    routeRecord: input.routeRecord,
    routeFile: input.routeFile,
    checkpointStep,
    boundarySnapshot,
    boundaryRuntimeSnapshot,
    boundaryIdentity,
    finalSnapshot,
    finalRuntimeSnapshot,
    finalIdentity,
    nativeSaveData: saveData,
    structuredSuffix: suffix,
    encodedSuffix: saveData.__toReplay__,
    nativeName: "GUI Fixture",
    nativeVersion: "Ver 5.1c",
  });
  const savePackage = {
    name: "GUI Fixture",
    version: "Ver 5.1c",
    data: saveData,
    __solverResumeArtifact__: artifact,
  };
  return {
    project,
    runtimeRouteRecord,
    checkpointStep,
    artifact,
    savePackage,
    h5saveFile: writePackage(input.projectRoot, outDir, savePackage, "verified"),
  };
}

function buildLegacyPackage(fixture, input, outDir) {
  const identityOptions = {
    projectRoot: input.projectRoot,
    runtimeAutoBattle: projectSupportsRuntimeAutoBattle(input.projectRoot),
  };
  const legacyArtifact = cloneJson(fixture.artifact);
  ["boundary", "continuation"].forEach((sectionName) => {
    const section = legacyArtifact[sectionName];
    const snapshot = sectionName === "continuation"
      ? section.finalSnapshot
      : section.snapshot;
    const identity = buildRuntimeSnapshotIdentity(snapshot, identityOptions);
    section.runtimeSnapshotIdentity = identity;
    section.capturedRuntimeSnapshotIdentity = identity;
    section.identityMatches = true;
  });
  const legacyPackage = cloneJson(fixture.savePackage);
  legacyPackage.__solverResumeArtifact__ = legacyArtifact;
  return {
    artifact: legacyArtifact,
    h5saveFile: writePackage(input.projectRoot, outDir, legacyPackage, "legacy"),
  };
}

async function checkGuiApi({ project, routeRecord, routeFile, resumeInfo, label }) {
  const server = createGuiServer({
    routeRecord,
    routeFile,
    session: makeStubSession(),
    project,
    debug: true,
    resumeInfo,
  });
  const address = await listen(server);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const routeResponse = await fetchJson(baseUrl, "/api/route");
    const resumeResponse = await fetchJson(baseUrl, "/api/resume");
    assert.deepStrictEqual(routeResponse.resume, resumeInfo, `${label}: route API resume payload`);
    assert.deepStrictEqual(resumeResponse, resumeInfo, `${label}: resume API payload`);
    return {
      routeSchema: routeResponse.schema,
      decisionCount: routeResponse.decisionCount,
      status: resumeResponse.status,
      failureCode: resumeResponse.failure && resumeResponse.failure.code || null,
    };
  } finally {
    await closeServer(server);
  }
}

async function checkGuiDomSmoke({ project, resumeInfo }) {
  const browserPath = findBrowserExecutable();
  assert.ok(browserPath, "Chrome/Edge executable is required for GUI DOM smoke");
  const server = createGuiServer({
    routeRecord: null,
    routeFile: null,
    session: makeStubSession({ state: "unavailable", resumeOnly: true }),
    project,
    debug: true,
    resumeInfo,
  });
  const address = await listen(server);
  const browser = await chromium.launch({
    executablePath: browserPath,
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => {
      const element = document.querySelector("#resume-status");
      return element && element.textContent.includes("Legacy / route unverified");
    });
    const text = await page.locator("#resume-status").innerText();
    assert.ok(text.includes("Route: not checked"), "legacy DOM must show route not checked");
    assert.ok(!text.includes("mismatch"), "legacy DOM must not show route mismatch");
    return {
      status: resumeInfo.status,
      containsLegacyBadge: text.includes("Legacy / route unverified"),
      containsNotChecked: text.includes("Route: not checked"),
      containsMismatch: text.includes("mismatch"),
    };
  } finally {
    await browser.close();
    await closeServer(server);
  }
}

async function checkRouteGuiCli({ projectRoot, h5saveFile, allowUnverifiedRoute, expectedStatus, expectedFailureCode }) {
  const args = [
    "route-gui.js",
    `--project-root=${projectRoot}`,
    `--h5save=${h5saveFile}`,
    "--open=0",
    "--live=0",
    "--port=0",
  ];
  if (allowUnverifiedRoute) args.push("--allow-unverified-route=1");
  const child = childProcess.spawn(process.execPath, args, {
    cwd: __dirname,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  let settled = false;
  let timeout;
  const ready = new Promise((resolve, reject) => {
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const inspect = () => {
      const match = stdout.match(/Route GUI: (http:\/\/127\.0\.0\.1:\d+\/?)/);
      if (!match) return;
      settled = true;
      clearTimeout(timeout);
      resolve(match[1]);
    };
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      inspect();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", fail);
    child.once("exit", (code) => {
      if (!settled) {
        fail(new Error(`route-gui CLI exited before listen: ${code}\n${stdout}\n${stderr}`));
      }
    });
    timeout = setTimeout(() => {
      fail(new Error(`route-gui CLI did not listen in time\n${stdout}\n${stderr}`));
    }, 15000);
  });
  let exitPromise;
  try {
    const baseUrl = (await ready).replace(/\/$/, "");
    const resume = await fetchJson(baseUrl, "/api/resume");
    assert.strictEqual(resume.status, expectedStatus, `route-gui CLI ${expectedStatus} status`);
    if (expectedFailureCode) {
      assert.strictEqual(resume.failure && resume.failure.code, expectedFailureCode, "route-gui CLI failure code");
    }
    assert.ok(stdout.includes("Resume artifact:"), "route-gui CLI prints resume artifact path");
    exitPromise = new Promise((resolve, reject) => {
      if (child.exitCode != null) {
        resolve(child.exitCode);
        return;
      }
      const onExit = (code) => {
        clearTimeout(forceTimer);
        clearTimeout(failTimer);
        resolve(code);
      };
      child.once("exit", onExit);
      child.kill();
      const forceTimer = setTimeout(() => {
        if (child.exitCode == null) child.kill();
      }, 1000);
      const failTimer = setTimeout(() => {
        if (child.exitCode == null) {
          reject(new Error(`route-gui CLI did not exit after cleanup\n${stdout}\n${stderr}`));
        }
      }, 5000);
    });
    const exitCode = await exitPromise;
    return {
      status: resume.status,
      failureCode: resume.failure && resume.failure.code || null,
      routeFilePrinted: /^Route file: (?!unavailable)/m.test(stdout),
      metadataOnlyPrinted: stdout.includes("metadata only"),
      exitCode,
    };
  } finally {
    clearTimeout(timeout);
    if (child.exitCode == null) child.kill();
    if (exitPromise) await exitPromise;
  }
}

async function main() {
  const source = FIXED_INPUTS.find((candidate) => candidate.tower === "whiteisland");
  assert.ok(source, "WhiteIsland fixed route input is required");
  const input = ensureFixedRoute(source);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "motapathfinder-pr-5.1c-gui-"));

  try {
    const fixture = buildFixture(input, outDir);
    const verified = loadResumeArtifactForGui({
      project: fixture.project,
      projectRoot: input.projectRoot,
      h5saveFile: fixture.h5saveFile,
      routeRecord: input.routeRecord,
      routeFile: input.routeFile,
      allowUnverifiedRoute: false,
    });
    assert.strictEqual(verified.status, "verified", "verified h5save must be shown as verified");
    assert.strictEqual(verified.mode, "verified");
    assert.strictEqual(verified.routeVerified, true);
    assert.strictEqual(verified.projectFingerprintMatches, true);
    assert.strictEqual(verified.routeFingerprintMatches, true);
    assert.strictEqual(verified.payloadBinding.verified, true);
    assert.strictEqual(verified.boundary.executedStepCount, fixture.checkpointStep);
    assert.strictEqual(verified.boundary.nextStep, fixture.checkpointStep + 1);
    assert.strictEqual(verified.boundary.identityMatches, true);
    assert.strictEqual(verified.boundary.nextDecision.index, fixture.checkpointStep + 1);
    assert.strictEqual(verified.continuation.suffixDecisionCount, input.routeRecord.decisions.length - fixture.checkpointStep);
    assert.strictEqual(verified.continuation.identityMatches, true);
    const verifiedApi = await checkGuiApi({
      project: fixture.project,
      routeRecord: input.routeRecord,
      routeFile: input.routeFile,
      resumeInfo: verified,
      label: "verified",
    });
    const verifiedCli = await checkRouteGuiCli({
      projectRoot: input.projectRoot,
      h5saveFile: fixture.h5saveFile,
      allowUnverifiedRoute: false,
      expectedStatus: "verified",
    });

    const tamperedPackage = cloneJson(fixture.savePackage);
    tamperedPackage.__solverResumeArtifact__.boundary.snapshot.hero.hp =
      Number(tamperedPackage.__solverResumeArtifact__.boundary.snapshot.hero.hp || 0) + 1;
    const tamperedFile = writePackage(input.projectRoot, outDir, tamperedPackage, "tampered-boundary");
    const failed = loadResumeArtifactForGui({
      project: fixture.project,
      projectRoot: input.projectRoot,
      h5saveFile: tamperedFile,
      routeRecord: input.routeRecord,
      routeFile: input.routeFile,
      allowUnverifiedRoute: false,
    });
    assert.strictEqual(failed.status, "failed", "tampered h5save must be shown as failed");
    assert.strictEqual(failed.failure.code, "REPLAY_RESUME_RUNTIME_IDENTITY_MISMATCH");
    const failedApi = await checkGuiApi({
      project: fixture.project,
      routeRecord: input.routeRecord,
      routeFile: input.routeFile,
      resumeInfo: failed,
      label: "failed",
    });
    const failedCli = await checkRouteGuiCli({
      projectRoot: input.projectRoot,
      h5saveFile: tamperedFile,
      allowUnverifiedRoute: false,
      expectedStatus: "failed",
      expectedFailureCode: "REPLAY_RESUME_RUNTIME_IDENTITY_MISMATCH",
    });

    const missing = loadResumeArtifactForGui({
      project: fixture.project,
      projectRoot: input.projectRoot,
      h5saveFile: path.join(outDir, "missing.h5save"),
      routeRecord: input.routeRecord,
      routeFile: input.routeFile,
      allowUnverifiedRoute: false,
    });
    assert.strictEqual(missing.status, "failed", "missing h5save must be shown as failed");
    assert.strictEqual(missing.failure.code, "REPLAY_RESUME_H5SAVE_INVALID");
    const missingCli = await checkRouteGuiCli({
      projectRoot: input.projectRoot,
      h5saveFile: path.join(outDir, "missing.h5save"),
      allowUnverifiedRoute: false,
      expectedStatus: "failed",
      expectedFailureCode: "REPLAY_RESUME_H5SAVE_INVALID",
    });

    const legacyFixture = buildLegacyPackage(fixture, input, outDir);
    const legacy = loadResumeArtifactForGui({
      project: fixture.project,
      projectRoot: input.projectRoot,
      h5saveFile: legacyFixture.h5saveFile,
      routeRecord: null,
      routeFile: null,
      allowUnverifiedRoute: true,
    });
    assert.strictEqual(legacy.status, "legacy", "explicit route-unverified mode must be shown as legacy");
    assert.strictEqual(legacy.mode, "legacy");
    assert.strictEqual(legacy.routeVerified, false);
    assert.strictEqual(legacy.routeFingerprintMatches, null, "legacy route fingerprint must be not checked");
    const legacyApi = await checkGuiApi({
      project: fixture.project,
      routeRecord: null,
      routeFile: null,
      resumeInfo: legacy,
      label: "legacy",
    });
    assert.strictEqual(legacyApi.decisionCount, 0, "legacy metadata-only GUI must not invent route decisions");
    const legacyDom = await checkGuiDomSmoke({
      project: fixture.project,
      resumeInfo: legacy,
    });
    const legacyCli = await checkRouteGuiCli({
      projectRoot: input.projectRoot,
      h5saveFile: legacyFixture.h5saveFile,
      allowUnverifiedRoute: true,
      expectedStatus: "legacy",
    });
    assert.strictEqual(legacyCli.routeFilePrinted, false, "legacy CLI must not print a route file");
    assert.strictEqual(legacyCli.metadataOnlyPrinted, true, "legacy CLI must identify metadata-only mode");

    process.stdout.write(`${JSON.stringify({
      schema: CHECK_SCHEMA,
      status: "passed",
      input: {
        tower: input.tower,
        routeFile: input.routeFile,
        checkpointStep: fixture.checkpointStep,
      },
      verified: {
        status: verified.status,
        routeVerified: verified.routeVerified,
        nextStep: verified.boundary.nextStep,
        nextDecision: verified.boundary.nextDecision,
        suffixDecisionCount: verified.continuation.suffixDecisionCount,
        api: verifiedApi,
        cli: verifiedCli,
      },
      legacy: {
        status: legacy.status,
        routeVerified: legacy.routeVerified,
        api: legacyApi,
        dom: legacyDom,
        cli: legacyCli,
      },
      failure: {
        tamperedBoundary: failed.failure.code,
        missingH5save: missing.failure.code,
        api: failedApi,
        cli: {
          tamperedBoundary: failedCli,
          missingH5save: missingCli,
        },
      },
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
