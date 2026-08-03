"use strict";

const {
  captureRuntimeSnapshot,
  describeRuntimeStatus,
  executeRouteDecision,
  launchRuntimeSession,
  prepareReplayRouteRecord,
  stabilizeRuntime,
  waitForRuntimeIdle,
} = require("./live-replay");
const {
  loadRuntimeSaveData,
  resumeError,
  validateResumeArtifact,
  verifyResumeNextDecision,
  verifyRuntimeResumeSnapshot,
} = require("./replay-resume-artifact");

const RESUME_SESSION_SCHEMA = "motapathfinder.replay-resume-session-status.v1";

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function errorPayload(error) {
  if (!error) return null;
  return {
    code: error.code || null,
    message: error.message || String(error),
  };
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

function defaultResumeApi() {
  return {
    captureRuntimeSnapshot,
    describeRuntimeStatus,
    executeRouteDecision,
    launchRuntimeSession,
    loadRuntimeSaveData,
    stabilizeRuntime,
    validateResumeArtifact,
    verifyResumeNextDecision,
    verifyRuntimeResumeSnapshot,
    waitForRuntimeIdle,
  };
}

class ReplayResumeSession {
  constructor({
    project,
    projectRoot,
    routeRecord,
    decoded,
    resumeInfo,
    liveOptions,
    replayApi,
    onEvent,
  } = {}) {
    this.project = project;
    this.projectRoot = projectRoot;
    this.validationRouteRecord = routeRecord || null;
    this.routeRecord = routeRecord
      ? prepareReplayRouteRecord(routeRecord, projectRoot)
      : null;
    this.decoded = decoded || null;
    this.artifact = this.decoded && this.decoded.artifact || null;
    this.resumeInfo = resumeInfo || null;
    this.liveOptions = liveOptions || {};
    this.replayApi = Object.assign(defaultResumeApi(), replayApi || {});
    this.onEvent = typeof onEvent === "function" ? onEvent : null;

    this.state = "idle";
    this.currentSuffixStep = 0;
    this.lastCompletedStep = Number(this.artifact && this.artifact.boundary && this.artifact.boundary.executedStepCount) || 0;
    this.stepStatuses = {};
    this.boundaryVerification = null;
    this.nextDecisionVerification = null;
    this.finalVerification = null;
    this.lastRuntimeSnapshot = null;
    this.lastRuntimeStatus = null;
    this.lastError = null;
    this.lastMismatch = null;
    this.runtime = null;
    this.pauseRequested = false;
    this.isBusy = false;
  }

  emit(event, payload) {
    if (this.onEvent) this.onEvent(event, payload || this.getStatus());
  }

  suffix() {
    return this.decoded && this.decoded.saveData && Array.isArray(this.decoded.saveData.__solverReplay__)
      ? this.decoded.saveData.__solverReplay__
      : [];
  }

  boundaryStep() {
    return Number(this.artifact && this.artifact.boundary && this.artifact.boundary.executedStepCount) || 0;
  }

  nextStep() {
    return this.boundaryStep() + this.currentSuffixStep + 1;
  }

  executionOptions(extra) {
    return Object.assign({}, this.liveOptions, extra || {}, {
      projectRoot: this.projectRoot,
      routeStartSnapshot: this.routeRecord && this.routeRecord.start
        ? this.routeRecord.start.snapshot || null
        : null,
    });
  }

  requireInteractiveArtifact() {
    if (!this.artifact || !this.decoded || !this.decoded.saveData) {
      throw resumeError(
        "REPLAY_RESUME_NOT_LOADED",
        "Load a h5save resume artifact before starting interactive resume.",
      );
    }
    if (!this.routeRecord) {
      throw resumeError(
        "REPLAY_RESUME_INTERACTIVE_ROUTE_REQUIRED",
        "Interactive resume requires a verified route; legacy metadata-only resume cannot start a runtime.",
      );
    }
    return this.replayApi.validateResumeArtifact(this.artifact, {
      project: this.project,
      routeRecord: this.validationRouteRecord,
      projectRoot: this.projectRoot,
      saveData: this.decoded.saveData,
      requireRoute: true,
      allowUnverifiedRoute: false,
    });
  }

  async closeRuntimeOnly() {
    if (!this.runtime) return;
    const runtime = this.runtime;
    this.runtime = null;
    await Promise.allSettled([
      runtime.browser && runtime.browser.close ? runtime.browser.close() : Promise.resolve(),
      runtime.server && runtime.server.close ? runtime.server.close() : Promise.resolve(),
    ]);
    this.lastRuntimeSnapshot = null;
    this.lastRuntimeStatus = null;
  }

  async start({ liveOptions } = {}) {
    if (this.isBusy) throw new Error("Resume session is busy.");
    this.isBusy = true;
    this.state = "starting";
    this.lastError = null;
    this.lastMismatch = null;
    this.boundaryVerification = null;
    this.nextDecisionVerification = null;
    this.finalVerification = null;
    this.currentSuffixStep = 0;
    this.stepStatuses = {};
    this.pauseRequested = false;
    this.emit("starting");
    try {
      this.requireInteractiveArtifact();
      await this.closeRuntimeOnly();
      const options = this.executionOptions(liveOptions);
      this.runtime = await this.replayApi.launchRuntimeSession(this.routeRecord, options);
      await this.replayApi.loadRuntimeSaveData(
        this.runtime.page,
        this.decoded.saveData,
        options,
      );
      await this.replayApi.waitForRuntimeIdle(this.runtime.page, Number(options.timeoutMs || options["timeout-ms"] || 30000));
      await this.replayApi.stabilizeRuntime(
        this.runtime.page,
        Number(options.timeoutMs || options["timeout-ms"] || 30000),
        options,
      );
      this.lastRuntimeSnapshot = await this.replayApi.captureRuntimeSnapshot(
        this.runtime.page,
        { verifyFloors: this.runtime.verifyFloors },
      );
      this.boundaryVerification = this.replayApi.verifyRuntimeResumeSnapshot(
        this.artifact,
        "boundary",
        this.lastRuntimeSnapshot,
        { projectRoot: this.projectRoot, routeRecord: this.routeRecord },
      );
      this.nextDecisionVerification = this.replayApi.verifyResumeNextDecision(
        this.artifact,
        this.suffix(),
        { projectRoot: this.projectRoot, routeRecord: this.routeRecord },
      );
      const suffix = this.suffix();
      if (suffix.length === 0) {
        await this.verifyFinal(options);
      } else {
        this.state = "paused";
      }
      this.emit("boundary-verified");
      return this.getStatus();
    } catch (error) {
      this.lastError = errorPayload(error);
      this.state = "failed";
      this.emit("failed", this.lastError);
      throw error;
    } finally {
      this.isBusy = false;
    }
  }

  async verifyFinal(options) {
    this.lastRuntimeSnapshot = await this.replayApi.captureRuntimeSnapshot(
      this.runtime.page,
      { verifyFloors: this.runtime.verifyFloors },
    );
    this.finalVerification = this.replayApi.verifyRuntimeResumeSnapshot(
      this.artifact,
      "final",
      this.lastRuntimeSnapshot,
      { projectRoot: this.projectRoot, routeRecord: this.routeRecord },
    );
    this.state = "completed";
    this.lastError = null;
    this.emit("final-verified");
    return this.finalVerification;
  }

  async executeOne({ stepDelayMs } = {}) {
    const suffix = this.suffix();
    if (this.currentSuffixStep >= suffix.length) {
      if (this.state !== "completed") await this.verifyFinal(this.executionOptions());
      return this.getStatus();
    }
    const decision = suffix[this.currentSuffixStep];
    const globalStep = Number(decision.index) || this.nextStep();
    this.stepStatuses[String(globalStep)] = "running";
    this.emit("step-running", { step: globalStep });
    try {
      const result = await this.replayApi.executeRouteDecision(
        this.runtime,
        decision,
        this.executionOptions({
          stepDelayMs: stepDelayMs == null ? 0 : stepDelayMs,
          idleTimeoutMs: this.liveOptions.idleTimeoutMs || this.liveOptions.timeoutMs || 30000,
          traceLive: false,
        }),
      );
      this.lastRuntimeSnapshot = result && result.actual || null;
      if (!result || !result.ok) {
        this.stepStatuses[String(globalStep)] = "failed";
        this.lastMismatch = {
          phase: "suffix",
          step: globalStep,
          summary: decision.summary || decision.fingerprint || `step ${globalStep}`,
          mismatch: result && result.mismatch || "runtime snapshot mismatch",
          expected: decision.postSnapshot || null,
          actual: result && result.actual || null,
        };
        this.lastError = errorPayload(resumeError(
          "REPLAY_RESUME_SUFFIX_STEP_MISMATCH",
          `Loaded runtime suffix step ${globalStep} does not match the route decision.`,
        ));
        this.state = "failed";
        this.emit("failed", this.lastMismatch);
        return this.getStatus();
      }
      this.stepStatuses[String(globalStep)] = "ok";
      this.currentSuffixStep += 1;
      this.lastCompletedStep = this.boundaryStep() + this.currentSuffixStep;
      this.lastMismatch = null;
      this.lastError = null;
      if (this.currentSuffixStep >= suffix.length) {
        await this.verifyFinal(this.executionOptions({ stepDelayMs: 0 }));
      }
      this.emit("step-ok", { step: globalStep });
      return this.getStatus();
    } catch (error) {
      this.stepStatuses[String(globalStep)] = "failed";
      this.lastError = errorPayload(error);
      this.state = "failed";
      this.emit("failed", this.lastError);
      return this.getStatus();
    }
  }

  async ensureStarted() {
    if (!this.runtime || ["idle", "closed"].includes(this.state)) {
      await this.start();
    }
  }

  async step({ stepDelayMs } = {}) {
    if (this.isBusy) throw new Error("Resume session is busy.");
    if (this.state === "running" || this.state === "pausing") {
      throw new Error("Cannot step while resume is running.");
    }
    await this.ensureStarted();
    this.isBusy = true;
    try {
      if (this.state !== "paused") return this.getStatus();
      this.state = "running";
      const result = await this.executeOne({ stepDelayMs });
      if (this.state === "running") this.state = "paused";
      return result;
    } finally {
      if (this.state === "running") this.state = "paused";
      this.isBusy = false;
    }
  }

  async play({ stepDelayMs } = {}) {
    if (this.isBusy) throw new Error("Resume session is busy.");
    await this.ensureStarted();
    if (this.state !== "paused") throw new Error(`Cannot play while state is ${this.state}.`);
    this.isBusy = true;
    this.pauseRequested = false;
    this.state = "running";
    this.emit("running");
    try {
      while (!this.pauseRequested && this.currentSuffixStep < this.suffix().length && this.state === "running") {
        await this.executeOne({ stepDelayMs });
      }
      if (this.state === "running" || this.state === "pausing") {
        this.state = this.currentSuffixStep >= this.suffix().length ? "completed" : "paused";
      }
      this.pauseRequested = false;
      this.emit("play-stopped");
      return this.getStatus();
    } finally {
      this.isBusy = false;
    }
  }

  pause() {
    if (this.state === "running") {
      this.pauseRequested = true;
      this.state = "pausing";
    }
    return this.getStatus();
  }

  async close() {
    await this.closeRuntimeOnly();
    this.state = "closed";
    this.emit("closed");
    return this.getStatus();
  }

  async getRuntimeStatus() {
    if (!this.runtime) return null;
    try {
      return await this.replayApi.describeRuntimeStatus(this.runtime.page || this.runtime);
    } catch (error) {
      return { error: error.message || String(error) };
    }
  }

  getStatus() {
    const suffix = this.suffix();
    const nextDecision = suffix[this.currentSuffixStep] || null;
    return {
      schema: RESUME_SESSION_SCHEMA,
      state: this.state,
      currentSuffixStep: this.currentSuffixStep,
      totalSuffixSteps: suffix.length,
      lastCompletedStep: this.lastCompletedStep,
      nextStep: this.currentSuffixStep < suffix.length ? this.nextStep() : null,
      nextDecision: nextDecision
        ? {
            index: nextDecision.index || this.nextStep(),
            kind: nextDecision.kind || "unknown",
            summary: nextDecision.summary || nextDecision.fingerprint || "",
            floorId: nextDecision.floorId || null,
          }
        : null,
      boundaryVerification: cloneJson(this.boundaryVerification),
      nextDecisionVerification: cloneJson(this.nextDecisionVerification),
      finalVerification: cloneJson(this.finalVerification),
      runtimeDisplay: displaySnapshot(this.lastRuntimeSnapshot),
      runtimeStatus: cloneJson(this.lastRuntimeStatus),
      browserUrl: this.runtime ? this.runtime.url : null,
      downloadsDir: this.runtime ? this.runtime.downloadsDir : null,
      lastError: cloneJson(this.lastError),
      lastMismatch: cloneJson(this.lastMismatch),
      stepStatuses: Object.assign({}, this.stepStatuses),
      busy: this.isBusy,
    };
  }

  async getStatusAsync() {
    this.lastRuntimeStatus = await this.getRuntimeStatus();
    return this.getStatus();
  }
}

module.exports = {
  RESUME_SESSION_SCHEMA,
  ReplayResumeSession,
  displaySnapshot,
};
