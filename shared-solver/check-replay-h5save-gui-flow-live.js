"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  FIXED_INPUTS,
  ensureFixedRoute,
} = require("./audit-replay-start-offset-contract");
const { createGuiServer } = require("./route-gui");
const { exportH5Segment } = require("./export-h5-segment");
const { loadProject } = require("./lib/project-loader");
const { findBrowserExecutable } = require("./lib/live-replay");
const { ReplayResumeController } = require("./lib/replay-resume-controller");

const TIMEOUT_MS = 30000;

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
    getStatus: () => status,
    getStatusAsync: async () => status,
    selectStep: () => status,
    pause: () => status,
    close: async () => status,
  };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address()));
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (server && typeof server.closeAllConnections === "function") server.closeAllConnections();
    server.close(resolve);
  });
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

async function main() {
  assert.ok(findBrowserExecutable(), "Chrome/Edge executable is required for GUI resume live smoke");
  const input = ensureFixedRoute(FIXED_INPUTS.find((candidate) => candidate.tower === "whiteisland"));
  const project = loadProject(input.projectRoot);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "motapathfinder-pr-5.2a-gui-live-"));
  let server = null;
  let controller = null;
  try {
    const exported = await exportH5Segment({
      routeRecord: input.routeRecord,
      routeFile: input.routeFile,
      projectRoot: input.projectRoot,
      checkpointStep: 0,
      outDir,
      timeoutMs: TIMEOUT_MS,
    });
    const content = fs.readFileSync(exported.h5saveFile, "utf8");
    controller = new ReplayResumeController({
      project,
      projectRoot: input.projectRoot,
      routeRecord: input.routeRecord,
      routeFile: input.routeFile,
      liveOptions: {
        headless: "1",
        timeoutMs: TIMEOUT_MS,
        runtimeAutoBattle: false,
        runtimeAutoPickup: true,
      },
    });
    server = createGuiServer({
      routeRecord: input.routeRecord,
      routeFile: input.routeFile,
      session: makeStubSession(),
      project,
      debug: true,
      resumeController: controller,
    });
    const address = await listen(server);
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const loaded = await requestJson(baseUrl, "/api/resume/load", {
      fileName: path.basename(exported.h5saveFile),
      content,
    });
    assert.strictEqual(loaded.status, "verified", "real exported h5save must be verified before start");

    const started = await requestJson(baseUrl, "/api/resume/start", {});
    assert.strictEqual(started.operation.state, "paused", "real runtime must pause at verified boundary");
    assert.strictEqual(started.operation.boundaryVerification.identityMatches, true);
    assert.strictEqual(started.operation.nextDecisionVerification.nextDecisionMatches, true);

    const accepted = await requestJson(baseUrl, "/api/resume/play", { stepDelayMs: 1000 }, 202);
    assert.strictEqual(accepted.accepted, true, "play must return an asynchronous acknowledgement");
    const pauseRequested = await requestJson(baseUrl, "/api/resume/pause", {});
    assert.ok(["pausing", "paused"].includes(pauseRequested.operation.state));
    let finalStatus = await requestJson(baseUrl, "/api/resume/status");
    const pauseDeadline = Date.now() + TIMEOUT_MS;
    while (Date.now() < pauseDeadline && finalStatus.operation && ["running", "pausing"].includes(finalStatus.operation.state)) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      finalStatus = await requestJson(baseUrl, "/api/resume/status");
    }
    assert.strictEqual(finalStatus.operation.state, "paused", "pause must stop between suffix decisions");
    assert.ok(finalStatus.operation.currentSuffixStep > 0, "pause smoke must complete at least one suffix decision");
    assert.ok(finalStatus.operation.currentSuffixStep < finalStatus.operation.totalSuffixSteps, "pause smoke must leave work to resume");
    const pausedStep = finalStatus.operation.currentSuffixStep;

    const resumed = await requestJson(baseUrl, "/api/resume/play", { stepDelayMs: 0 }, 202);
    assert.strictEqual(resumed.accepted, true, "resume play must be acknowledged asynchronously");
    finalStatus = await requestJson(baseUrl, "/api/resume/status");
    const deadline = Date.now() + TIMEOUT_MS;
    while (Date.now() < deadline && finalStatus.operation && ["running", "pausing"].includes(finalStatus.operation.state)) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      finalStatus = await requestJson(baseUrl, "/api/resume/status");
    }
    assert.strictEqual(finalStatus.operation.state, "completed", "real GUI resume must complete suffix");
    assert.strictEqual(finalStatus.operation.finalVerification.identityMatches, true);
    assert.strictEqual(finalStatus.operation.finalVerification.displayMatches, true);

    process.stdout.write(`${JSON.stringify({
      schema: "motapathfinder.pr-5.2b-replay-h5save-gui-robustness-live.v1",
      status: "passed",
      input: {
        tower: input.tower,
        routeFile: input.routeFile,
        checkpointStep: exported.checkpointStep,
      },
      uploaded: loaded.status,
      playAccepted: accepted.accepted,
      pauseState: pausedStep,
      resumed: resumed.accepted,
      boundaryIdentityMatches: started.operation.boundaryVerification.identityMatches,
      nextDecisionMatches: started.operation.nextDecisionVerification.nextDecisionMatches,
      suffixDecisionCount: finalStatus.operation.totalSuffixSteps,
      finalIdentityMatches: finalStatus.operation.finalVerification.identityMatches,
      finalDisplayMatches: finalStatus.operation.finalVerification.displayMatches,
    }, null, 2)}\n`);
  } finally {
    if (controller) await controller.close().catch(() => null);
    if (server) await closeServer(server).catch(() => null);
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exit(1);
  });
}

module.exports = { main };
