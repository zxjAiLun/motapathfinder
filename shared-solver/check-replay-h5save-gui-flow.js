"use strict";

const assert = require("node:assert");
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
  buildRuntimeSnapshotIdentityPair,
  prepareReplayRouteRecord,
  projectSupportsRuntimeAutoBattle,
} = require("./lib/live-replay");
const {
  buildResumeArtifact,
  cloneJson,
  encodeH5SavePackage,
  resumeError,
  validateResumeArtifact,
  verifyResumeNextDecision,
  verifyRuntimeResumeSnapshot,
} = require("./lib/replay-resume-artifact");
const { ReplayResumeController } = require("./lib/replay-resume-controller");
const { ReplayResumeSession } = require("./lib/replay-resume-session");

const CHECK_SCHEMA = "motapathfinder.pr-5.2c-replay-h5save-gui-status-controls.v1";

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function makeStubSession() {
  const status = {
    state: "idle",
    currentStep: 1,
    totalSteps: 0,
    selectedStep: 1,
    lastCompletedStep: 0,
    stepStatuses: {},
  };
  return {
    getStatus: () => cloneJson(status),
    getStatusAsync: async () => cloneJson(status),
    selectStep: () => cloneJson(status),
    pause: () => cloneJson(status),
    close: async () => cloneJson(status),
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

async function requestJson(baseUrl, pathname, body, expectedStatus = 200) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: body == null ? "GET" : "POST",
    headers: body == null ? undefined : { "Content-Type": "application/json" },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  assert.strictEqual(response.status, expectedStatus, `${pathname} should return ${expectedStatus}: ${JSON.stringify(data)}`);
  return data;
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

function buildFixture(input) {
  const project = loadProject(input.projectRoot);
  const runtimeRouteRecord = prepareReplayRouteRecord(input.routeRecord, input.projectRoot);
  const checkpointStep = 1;
  const decisions = runtimeRouteRecord.decisions || [];
  requireCondition(decisions.length >= 2, "GUI resume flow fixture requires at least two route decisions");

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
    route: "gui-flow-fixture",
    __toReplay__: "gui-flow-encoded-suffix",
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
    nativeName: "GUI Flow Fixture",
    nativeVersion: "Ver 5.2a",
  });
  const savePackage = {
    name: "GUI Flow Fixture",
    version: "Ver 5.2a",
    data: saveData,
    __solverResumeArtifact__: artifact,
  };
  return {
    project,
    runtimeRouteRecord,
    checkpointStep,
    suffix,
    boundaryRuntimeSnapshot,
    finalRuntimeSnapshot,
    artifact,
    savePackage,
    packageText: encodeH5SavePackage(input.projectRoot, savePackage),
  };
}

function makeFakeReplayApi(
  fixture,
  { failBoundary = false, holdSuffix = false, failSuffix = false } = {},
) {
  const lifecycle = { closed: false };
  let shouldFailSuffix = failSuffix;
  let releaseSuffix;
  const suffixStarted = new Promise((resolve) => {
    releaseSuffix = resolve;
  });
  let suffixStartedResolve;
  const suffixStartedSignal = new Promise((resolve) => {
    suffixStartedResolve = resolve;
  });
  const api = {
    validateResumeArtifact,
    verifyResumeNextDecision,
    launchRuntimeSession: async () => ({
      page: { snapshot: null },
      verifyFloors: [],
      url: "fake://resume-runtime",
      downloadsDir: null,
      browser: { close: async () => { lifecycle.closed = true; } },
      server: { close: async () => { lifecycle.closed = true; } },
    }),
    loadRuntimeSaveData: async (page) => {
      page.snapshot = cloneJson(fixture.boundaryRuntimeSnapshot);
    },
    waitForRuntimeIdle: async () => {},
    stabilizeRuntime: async () => {},
    captureRuntimeSnapshot: async (page) => cloneJson(page.snapshot),
    describeRuntimeStatus: async (page) => ({
      floorId: page.snapshot && page.snapshot.floorId,
      hero: page.snapshot && page.snapshot.hero,
    }),
    verifyRuntimeResumeSnapshot: (artifact, phase, snapshot, options) => {
      if (failBoundary && phase === "boundary") {
        throw resumeError(
          "REPLAY_RESUME_BOUNDARY_RUNTIME_MISMATCH",
          "Synthetic boundary gate mismatch.",
        );
      }
      return verifyRuntimeResumeSnapshot(artifact, phase, snapshot, options);
    },
    executeRouteDecision: async (runtime, decision) => {
      if (holdSuffix) {
        suffixStartedResolve();
        await suffixStarted;
      }
      runtime.page.snapshot = runtimeSnapshotWithStartBaseline(
        decision.postSnapshot,
        fixture.runtimeRouteRecord.start.snapshot,
      );
      if (shouldFailSuffix) {
        return {
          ok: false,
          actual: cloneJson(runtime.page.snapshot),
          mismatch: "Synthetic suffix mismatch.",
        };
      }
      return {
        ok: true,
        actual: cloneJson(runtime.page.snapshot),
        mismatch: null,
      };
    },
  };
  api.lifecycle = lifecycle;
  api.controls = {
    suffixStarted: suffixStartedSignal,
    releaseSuffix: () => releaseSuffix(),
    setFailSuffix: (value) => { shouldFailSuffix = value === true; },
  };
  return api;
}

async function checkGuiFlow({ input, fixture }) {
  let session;
  const controller = new ReplayResumeController({
    project: fixture.project,
    projectRoot: input.projectRoot,
    routeRecord: input.routeRecord,
    routeFile: input.routeFile,
    allowUnverifiedRoute: false,
    liveOptions: { headless: "1", timeoutMs: 5000 },
    sessionFactory: (options) => {
      session = new ReplayResumeSession(Object.assign({}, options, {
        replayApi: makeFakeReplayApi(fixture),
      }));
      return session;
    },
  });
  const server = createGuiServer({
    routeRecord: input.routeRecord,
    routeFile: input.routeFile,
    session: makeStubSession(),
    project: fixture.project,
    debug: true,
    resumeController: controller,
  });
  const address = await listen(server);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const loaded = await requestJson(baseUrl, "/api/resume/load", {
      fileName: "uploaded-flow.h5save",
      content: fixture.packageText,
    });
    assert.strictEqual(loaded.status, "verified", "uploaded h5save must validate before runtime start");
    assert.strictEqual(loaded.operation, null, "upload must not start a runtime implicitly");

    const notStartedPlay = await requestJson(baseUrl, "/api/resume/play", {}, 409);
    assert.strictEqual(notStartedPlay.code, "REPLAY_RESUME_NOT_STARTED");

    const started = await requestJson(baseUrl, "/api/resume/start", {});
    assert.strictEqual(started.status, "verified");
    assert.strictEqual(started.operation.state, "paused", "boundary gate must pause before suffix execution");
    assert.strictEqual(started.operation.currentSuffixStep, 0);
    assert.strictEqual(started.operation.boundaryVerification.identityMatches, true);
    assert.strictEqual(started.operation.nextDecisionVerification.nextDecisionMatches, true);

    const accepted = await requestJson(baseUrl, "/api/resume/play", { stepDelayMs: 0 }, 202);
    assert.strictEqual(accepted.accepted, true, "play must acknowledge asynchronously");
    let played = await requestJson(baseUrl, "/api/resume/status");
    const playDeadline = Date.now() + 2000;
    while (played.operation && played.operation.state === "running" && Date.now() < playDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      played = await requestJson(baseUrl, "/api/resume/status");
    }
    assert.strictEqual(played.operation.state, "completed", "accepted play must finish the suffix");

    const restarted = await requestJson(baseUrl, "/api/resume/start", {});
    assert.strictEqual(restarted.operation.state, "paused");

    let status = restarted;
    for (let index = 0; index < fixture.suffix.length; index += 1) {
      status = await requestJson(baseUrl, "/api/resume/step", { stepDelayMs: 0 });
      assert.strictEqual(status.operation.currentSuffixStep, index + 1);
      assert.strictEqual(status.operation.stepStatuses[String(fixture.suffix[index].index)], "ok");
    }
    assert.strictEqual(status.operation.state, "completed", "suffix completion must run final verification");
    assert.strictEqual(status.operation.finalVerification.identityMatches, true);
    assert.strictEqual(status.operation.nextStep, null);

    const invalid = await requestJson(baseUrl, "/api/resume/load", {
      fileName: "invalid.h5save",
      content: "not-a-valid-h5save",
    });
    assert.strictEqual(invalid.status, "failed");
    assert.strictEqual(invalid.failure.code, "REPLAY_RESUME_H5SAVE_INVALID");

    return {
      uploaded: loaded.status,
      playAccepted: accepted.accepted,
      boundary: started.operation.boundaryVerification.identityMatches,
      nextDecision: started.operation.nextDecisionVerification.nextDecisionMatches,
      suffixSteps: fixture.suffix.length,
      final: status.operation.finalVerification.identityMatches,
      invalidUpload: invalid.failure.code,
    };
  } finally {
    await controller.close();
    await closeServer(server);
  }
}

async function checkLegacyApi({ input, fixture }) {
  const controller = new ReplayResumeController({
    project: fixture.project,
    projectRoot: input.projectRoot,
    routeRecord: null,
    routeFile: null,
    allowUnverifiedRoute: true,
    liveOptions: { headless: "1" },
  });
  const server = createGuiServer({
    routeRecord: null,
    routeFile: null,
    session: makeStubSession(),
    project: fixture.project,
    debug: true,
    resumeController: controller,
  });
  const address = await listen(server);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const loaded = await requestJson(baseUrl, "/api/resume/load", {
      fileName: "legacy-flow.h5save",
      content: fixture.packageText,
    });
    assert.strictEqual(loaded.status, "legacy");
    const codes = {};
    for (const endpoint of ["start", "step", "play"]) {
      const body = endpoint === "step" ? { stepDelayMs: 0 } : {};
      const result = await requestJson(baseUrl, `/api/resume/${endpoint}`, body, 409);
      codes[endpoint] = result.code;
      assert.strictEqual(result.code, "REPLAY_RESUME_INTERACTIVE_REQUIRES_VERIFIED_ARTIFACT");
    }
    return { status: loaded.status, rejectionCodes: codes };
  } finally {
    await controller.close();
    await closeServer(server);
  }
}

async function checkGateFailureCleanup({ input, fixture }) {
  const replayApi = makeFakeReplayApi(fixture, { failBoundary: true });
  const controller = new ReplayResumeController({
    project: fixture.project,
    projectRoot: input.projectRoot,
    routeRecord: input.routeRecord,
    routeFile: input.routeFile,
    liveOptions: { headless: "1", timeoutMs: 5000 },
    sessionFactory: (options) => new ReplayResumeSession(Object.assign({}, options, { replayApi })),
  });
  const server = createGuiServer({
    routeRecord: input.routeRecord,
    routeFile: input.routeFile,
    session: makeStubSession(),
    project: fixture.project,
    debug: true,
    resumeController: controller,
  });
  const address = await listen(server);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await requestJson(baseUrl, "/api/resume/load", {
      fileName: "gate-failure.h5save",
      content: fixture.packageText,
    });
    const failed = await requestJson(baseUrl, "/api/resume/start", {}, 409);
    assert.strictEqual(failed.code, "REPLAY_RESUME_BOUNDARY_RUNTIME_MISMATCH");
    const status = await requestJson(baseUrl, "/api/resume/status");
    assert.strictEqual(status.operation.state, "failed");
    assert.strictEqual(status.operation.lastError.code, "REPLAY_RESUME_BOUNDARY_RUNTIME_MISMATCH");
    assert.strictEqual(status.operation.browserUrl, null, "failed gate must close the runtime");
    assert.strictEqual(replayApi.lifecycle.closed, true, "failed gate must close browser/server resources");
    assert.ok(status.operation.runtimeDisplay.floorId, "failed gate must preserve the last captured display");
    assert.ok(
      status.operation.runtimeStatus && status.operation.runtimeStatus.floorId,
      "failed gate must preserve the last runtime status",
    );
    return {
      failureCode: failed.code,
      state: status.operation.state,
      runtimeClosed: replayApi.lifecycle.closed,
      preservedFloor: status.operation.runtimeDisplay.floorId,
      preservedRuntimeStatus: status.operation.runtimeStatus.floorId,
    };
  } finally {
    await controller.close();
    await closeServer(server);
  }
}

async function checkPlayStateControls({ input, fixture }) {
  const replayApi = makeFakeReplayApi(fixture, { holdSuffix: true });
  const controller = new ReplayResumeController({
    project: fixture.project,
    projectRoot: input.projectRoot,
    routeRecord: input.routeRecord,
    routeFile: input.routeFile,
    liveOptions: { headless: "1", timeoutMs: 5000 },
    sessionFactory: (options) => new ReplayResumeSession(Object.assign({}, options, { replayApi })),
  });
  const server = createGuiServer({
    routeRecord: input.routeRecord,
    routeFile: input.routeFile,
    session: makeStubSession(),
    project: fixture.project,
    debug: true,
    resumeController: controller,
  });
  const address = await listen(server);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await requestJson(baseUrl, "/api/resume/load", {
      fileName: "play-state-controls.h5save",
      content: fixture.packageText,
    });
    await requestJson(baseUrl, "/api/resume/start", {});

    const accepted = await requestJson(baseUrl, "/api/resume/play", {}, 202);
    assert.strictEqual(accepted.accepted, true);
    await replayApi.controls.suffixStarted;
    const busy = await requestJson(baseUrl, "/api/resume/play", {}, 409);
    assert.strictEqual(busy.code, "REPLAY_RESUME_BUSY");
    replayApi.controls.releaseSuffix();

    let status = await requestJson(baseUrl, "/api/resume/status");
    const completionDeadline = Date.now() + 2000;
    while (status.operation && status.operation.state === "running" && Date.now() < completionDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      status = await requestJson(baseUrl, "/api/resume/status");
    }
    assert.strictEqual(status.operation.state, "completed");
    const completed = await requestJson(baseUrl, "/api/resume/play", {}, 409);
    assert.strictEqual(completed.code, "REPLAY_RESUME_INVALID_STATE");

    replayApi.controls.setFailSuffix(true);
    await requestJson(baseUrl, "/api/resume/start", {});
    await requestJson(baseUrl, "/api/resume/play", {}, 202);
    status = await requestJson(baseUrl, "/api/resume/status");
    const failureDeadline = Date.now() + 2000;
    while (status.operation && status.operation.state === "running" && Date.now() < failureDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      status = await requestJson(baseUrl, "/api/resume/status");
    }
    assert.strictEqual(status.operation.state, "failed");
    const failed = await requestJson(baseUrl, "/api/resume/play", {}, 409);
    assert.strictEqual(failed.code, "REPLAY_RESUME_INVALID_STATE");

    return {
      busy: busy.code,
      completed: completed.code,
      failed: failed.code,
    };
  } finally {
    replayApi.controls.releaseSuffix();
    await controller.close();
    await closeServer(server);
  }
}

async function checkGuiDom({ input, fixture }) {
  let session;
  const controller = new ReplayResumeController({
    project: fixture.project,
    projectRoot: input.projectRoot,
    routeRecord: input.routeRecord,
    routeFile: input.routeFile,
    liveOptions: { headless: "1", timeoutMs: 5000 },
    sessionFactory: (options) => {
      session = new ReplayResumeSession(Object.assign({}, options, {
        replayApi: makeFakeReplayApi(fixture),
      }));
      return session;
    },
  });
  const server = createGuiServer({
    routeRecord: input.routeRecord,
    routeFile: input.routeFile,
    session: makeStubSession(),
    project: fixture.project,
    debug: true,
    resumeController: controller,
  });
  const address = await listen(server);
  const browserPath = require("./lib/live-replay").findBrowserExecutable();
  assert.ok(browserPath, "Chrome/Edge executable is required for GUI flow DOM smoke");
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelector("#resume-file") && document.querySelector("#resume-dropzone"));
    const controls = await page.locator("#resume-operation-controls").innerText();
    assert.ok(controls.includes("Load / Start Resume"));
    assert.ok(controls.includes("Step Suffix"));
    const shell = await page.locator("#resume-status").innerText();
    assert.ok(shell.includes("No resume artifact loaded."));

    await page.setInputFiles("#resume-file", {
      name: "picker-flow.h5save",
      mimeType: "text/plain",
      buffer: Buffer.from(fixture.packageText, "utf8"),
    });
    await page.waitForFunction(() => document.querySelector("#resume-status").textContent.includes("Verified"));
    const encoded = Buffer.from(fixture.packageText, "utf8").toString("base64");
    await page.evaluate(({ encoded, name }) => {
      const bytes = Uint8Array.from(atob(encoded), (value) => value.charCodeAt(0));
      const file = new File([bytes], name, { type: "text/plain" });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      document.querySelector("#resume-dropzone").dispatchEvent(new DragEvent("drop", {
        bubbles: true,
        dataTransfer,
      }));
    }, { encoded, name: "drop-flow.h5save" });
    await page.waitForFunction(() => document.querySelector("#resume-status").textContent.includes("drop-flow.h5save"));
    await page.click("#resume-start");
    await page.waitForFunction(() => document.querySelector("#resume-status").textContent.includes("Boundary gate") && document.querySelector("#resume-status").textContent.includes("verified"));
    await page.click("#resume-step");
    await page.waitForFunction(() => document.querySelector("#resume-status").textContent.includes("Final gate") && document.querySelector("#resume-status").textContent.includes("✓ verified"));
    return {
      fileInput: await page.locator("#resume-file").count(),
      dropzone: await page.locator("#resume-dropzone").count(),
      hasBoundaryLabel: controls.includes("Load / Start Resume"),
      hasSuffixStep: controls.includes("Step Suffix"),
      initialText: shell,
      pickerUpload: true,
      dropUpload: true,
      boundaryAndFinalRendered: true,
    };
  } finally {
    await browser.close();
    await controller.close();
    await closeServer(server);
  }
}

async function main() {
  const input = ensureFixedRoute(FIXED_INPUTS.find((candidate) => candidate.tower === "whiteisland"));
  const fixture = buildFixture(input);
  const flow = await checkGuiFlow({ input, fixture });
  const legacy = await checkLegacyApi({ input, fixture });
  const gateFailure = await checkGateFailureCleanup({ input, fixture });
  const playStates = await checkPlayStateControls({ input, fixture });
  const dom = await checkGuiDom({ input, fixture });
  process.stdout.write(`${JSON.stringify({
    schema: CHECK_SCHEMA,
    status: "passed",
    input: {
      tower: input.tower,
      routeFile: input.routeFile,
      checkpointStep: fixture.checkpointStep,
    },
    flow,
    legacy,
    gateFailure,
    playStates,
    dom,
  }, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exit(1);
  });
}

module.exports = { main };
