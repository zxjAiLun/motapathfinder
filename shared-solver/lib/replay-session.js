"use strict";

const { summarizeSnapshot } = require("./route-snapshot");
const {
  describeRuntimeStatus,
  executeRouteDecision,
  launchRuntimeSession,
  verifyInitialRuntimeSnapshot,
} = require("./live-replay");

function parseNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function errorPayload(error) {
  if (!error) return null;
  return {
    message: error.message || String(error),
    code: error.code || null,
    statusCode: error.statusCode || null,
    stack: error.stack || null,
  };
}

function stepRangeError(step, total) {
  const error = new Error(
    `Replay step ${step} is out of range; expected an integer in [0, ${total}].`,
  );
  error.code = "REPLAY_STEP_OUT_OF_RANGE";
  error.statusCode = 400;
  error.requestedStep = step;
  error.totalSteps = total;
  return error;
}

const DEFAULT_LIVE_API = {
  describeRuntimeStatus,
  executeRouteDecision,
  launchRuntimeSession,
  verifyInitialRuntimeSnapshot,
};

class ReplaySession {
  constructor({ routeRecord, projectRoot, liveOptions, onEvent, replayApi } = {}) {
    this.routeRecord = routeRecord;
    this.decisions = (routeRecord && routeRecord.decisions) || [];
    this.projectRoot = projectRoot;
    this.liveOptions = liveOptions || {};
    this.onEvent = typeof onEvent === "function" ? onEvent : null;
    this.replayApi = Object.assign({}, DEFAULT_LIVE_API, replayApi || {});
    this.state = "idle";
    this.currentStep = 1;
    this.selectedStep = 1;
    this.lastCompletedStep = 0;
    this.requestedFromStep = 1;
    this.effectiveFromStep = 1;
    this.stepStatuses = {};
    this.lastError = null;
    this.lastMismatch = null;
    this.runtime = null;
    this.pauseRequested = false;
    this.isBusy = false;
  }

  emit(event, payload) {
    if (this.onEvent) this.onEvent(event, payload || this.getStatus());
  }

  totalSteps() {
    return this.decisions.length;
  }

  normalizeStep(step) {
    const total = this.totalSteps();
    const number = step == null || step === "" ? 1 : Number(step);
    if (!Number.isFinite(number) || !Number.isInteger(number) || number < 0 || number > total) {
      throw stepRangeError(step, total);
    }
    // The public contract is 1-based decision numbering.  Zero is an
    // explicit alias for the initial checkpoint, i.e. before decision 1.
    return Math.max(1, number);
  }

  async start({ fromStep, liveOptions } = {}) {
    if (this.isBusy) throw new Error("Replay session is busy.");
    const requestedFromStep =
      fromStep != null
        ? fromStep
        : liveOptions && liveOptions.fromStep != null
          ? liveOptions.fromStep
          : this.liveOptions.fromStep != null
            ? this.liveOptions.fromStep
            : 1;
    const targetStep = this.normalizeStep(requestedFromStep);
    this.isBusy = true;
    this.state = "starting";
    this.lastError = null;
    this.lastMismatch = null;
    this.pauseRequested = false;
    this.stepStatuses = {};
    this.requestedFromStep = Number(requestedFromStep);
    this.effectiveFromStep = targetStep;
    this.emit("starting");
    try {
      await this.closeRuntimeOnly();
      this.currentStep = 1;
      this.selectedStep = targetStep;
      this.lastCompletedStep = 0;
      const launchOptions = Object.assign({}, this.liveOptions, liveOptions || {}, { projectRoot: this.projectRoot });
      this.runtime = await this.replayApi.launchRuntimeSession(this.routeRecord, launchOptions);
      const initial = await this.replayApi.verifyInitialRuntimeSnapshot(this.runtime, this.routeRecord);
      if (!initial.ok) {
        this.lastMismatch = initial;
        this.state = "failed";
        throw new Error(`Initial snapshot mismatch: ${initial.mismatch}`);
      }
      if (targetStep > 1) {
        for (let step = 1; step < targetStep; step += 1) {
          await this.executeOne({ visibleDelay: 0, traceLive: false });
          if (this.state === "failed") break;
        }
      }
      if (this.state !== "failed") {
        this.currentStep = targetStep;
        this.selectedStep = targetStep;
        this.state = targetStep > this.totalSteps() ? "completed" : "paused";
      }
      this.emit("started");
      return this.getStatus();
    } catch (error) {
      this.lastError = errorPayload(error);
      this.state = "failed";
      this.emit("failed");
      throw error;
    } finally {
      this.isBusy = false;
    }
  }

  async closeRuntimeOnly() {
    if (!this.runtime) return;
    const runtime = this.runtime;
    this.runtime = null;
    await Promise.allSettled([
      runtime.browser && runtime.browser.close ? runtime.browser.close() : Promise.resolve(),
      runtime.server && runtime.server.close ? runtime.server.close() : Promise.resolve(),
    ]);
  }

  async ensureStarted() {
    if (!this.runtime || this.state === "idle" || this.state === "closed") {
      await this.start({ fromStep: this.currentStep || 1 });
    }
  }

  async executeOne({ visibleDelay, traceLive } = {}) {
    const step = this.currentStep;
    if (step > this.totalSteps()) {
      this.state = "completed";
      return this.getStatus();
    }
    const decision = this.decisions[step - 1];
    this.stepStatuses[String(step)] = "running";
    this.emit("step-running", { step });
    let result;
    try {
      result = await this.replayApi.executeRouteDecision(this.runtime, decision, Object.assign({}, this.liveOptions, {
        stepDelayMs: visibleDelay == null ? this.liveOptions.stepDelayMs : visibleDelay,
        traceLive: traceLive == null ? this.liveOptions.traceLive : traceLive,
        routeStartSnapshot: (this.routeRecord && this.routeRecord.start && this.routeRecord.start.snapshot) || null,
      }));
    } catch (error) {
      this.stepStatuses[String(step)] = "failed";
      this.lastError = errorPayload(error);
      this.state = "failed";
      this.emit("failed", this.lastError);
      return this.getStatus();
    }
    if (!result.ok) {
      this.stepStatuses[String(step)] = "failed";
      this.lastMismatch = {
        step,
        summary: decision.summary || decision.fingerprint || `step ${step}`,
        mismatch: result.mismatch,
        expected: summarizeSnapshot(decision.postSnapshot || {}),
        actual: summarizeSnapshot(result.actual || {}),
      };
      this.state = "failed";
      this.emit("failed", this.lastMismatch);
      return this.getStatus();
    }
    this.stepStatuses[String(step)] = "ok";
    this.lastCompletedStep = step;
    this.currentStep = step + 1;
    this.selectedStep = Math.min(this.currentStep, this.totalSteps());
    this.lastMismatch = null;
    if (this.currentStep > this.totalSteps()) this.state = "completed";
    this.emit("step-ok", { step });
    return this.getStatus();
  }

  async step(options = {}) {
    if (this.isBusy) throw new Error("Replay session is busy.");
    if (this.state === "running" || this.state === "pausing") throw new Error("Cannot step while replay is running.");
    this.isBusy = true;
    try {
      await this.ensureStarted();
      if (this.state !== "paused") return this.getStatus();
      this.state = "running";
      await this.executeOne({ visibleDelay: parseNumber(options.stepDelayMs, this.liveOptions.stepDelayMs || 1400) });
      if (this.state === "running") this.state = "paused";
      return this.getStatus();
    } finally {
      if (this.state === "running") this.state = "paused";
      this.isBusy = false;
    }
  }

  async play(options = {}) {
    if (this.isBusy) throw new Error("Replay session is busy.");
    if (this.state !== "paused") throw new Error(`Cannot play while state is ${this.state}.`);
    this.isBusy = true;
    this.pauseRequested = false;
    this.state = "running";
    this.emit("running");
    const delay = parseNumber(options.stepDelayMs, this.liveOptions.stepDelayMs || 1400);
    try {
      while (!this.pauseRequested && this.currentStep <= this.totalSteps() && this.state === "running") {
        await this.executeOne({ visibleDelay: delay });
      }
      if (this.state === "running" || this.state === "pausing") {
        this.state = this.currentStep > this.totalSteps() ? "completed" : "paused";
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

  async restart() {
    return this.start({ fromStep: 1 });
  }

  async jumpToStep(step) {
    const targetStep = this.normalizeStep(step);
    return this.start({ fromStep: targetStep });
  }

  selectStep(step) {
    this.selectedStep = this.normalizeStep(step);
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
      return { error: error.message };
    }
  }

  getStatus() {
    const nextDecision = this.decisions[this.currentStep - 1] || null;
    const boundary = this.currentStep <= 1
      ? this.routeRecord && this.routeRecord.start
      : this.decisions[this.currentStep - 2] || (this.routeRecord && this.routeRecord.final);
    const boundarySnapshot = boundary && boundary.snapshot
      ? boundary.snapshot
      : boundary && boundary.postSnapshot
        ? boundary.postSnapshot
        : null;
    return {
      state: this.state,
      currentStep: this.currentStep,
      totalSteps: this.totalSteps(),
      selectedStep: this.selectedStep,
      lastCompletedStep: this.lastCompletedStep,
      requestedFromStep: this.requestedFromStep,
      effectiveFromStep: this.effectiveFromStep,
      expectedExactStateKey:
        (boundary && (boundary.exactStateKey || boundary.postExactStateKey)) || null,
      expectedBoundary: boundarySnapshot
        ? {
            floorId: boundarySnapshot.floorId || null,
            hero: boundarySnapshot.hero || null,
          }
        : null,
      nextDecision: nextDecision
        ? {
            index: nextDecision.index || this.currentStep,
            kind: nextDecision.kind || "unknown",
            summary: nextDecision.summary || nextDecision.fingerprint || "",
            floorId: nextDecision.floorId || null,
          }
        : null,
      browserUrl: this.runtime ? this.runtime.url : null,
      downloadsDir: this.runtime ? this.runtime.downloadsDir : null,
      runtime: null,
      lastError: this.lastError,
      lastMismatch: this.lastMismatch,
      stepStatuses: Object.assign({}, this.stepStatuses),
      busy: this.isBusy,
    };
  }

  async getStatusAsync() {
    const status = this.getStatus();
    status.runtime = await this.getRuntimeStatus();
    status.display = status.runtime
      ? {
          floorId: status.runtime.floorId || null,
          hero: status.runtime.hero || null,
        }
      : null;
    return status;
  }
}

module.exports = { ReplaySession };
