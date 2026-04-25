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
  return { message: error.message || String(error), stack: error.stack || null };
}

class ReplaySession {
  constructor({ routeRecord, projectRoot, liveOptions, onEvent } = {}) {
    this.routeRecord = routeRecord;
    this.decisions = (routeRecord && routeRecord.decisions) || [];
    this.projectRoot = projectRoot;
    this.liveOptions = liveOptions || {};
    this.onEvent = typeof onEvent === "function" ? onEvent : null;
    this.state = "idle";
    this.currentStep = 1;
    this.selectedStep = 1;
    this.lastCompletedStep = 0;
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
    const number = parseNumber(step, 1);
    return Math.max(1, Math.min(total + 1, Math.floor(number)));
  }

  async start({ fromStep } = {}) {
    if (this.isBusy) throw new Error("Replay session is busy.");
    this.isBusy = true;
    this.state = "starting";
    this.lastError = null;
    this.lastMismatch = null;
    this.pauseRequested = false;
    this.stepStatuses = {};
    this.emit("starting");
    try {
      await this.closeRuntimeOnly();
      const targetStep = this.normalizeStep(fromStep || this.liveOptions.fromStep || 1);
      this.currentStep = 1;
      this.selectedStep = targetStep;
      this.lastCompletedStep = 0;
      this.runtime = await launchRuntimeSession(this.routeRecord, Object.assign({}, this.liveOptions, { projectRoot: this.projectRoot }));
      const initial = await verifyInitialRuntimeSnapshot(this.runtime, this.routeRecord);
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
      result = await executeRouteDecision(this.runtime, decision, Object.assign({}, this.liveOptions, {
        stepDelayMs: visibleDelay == null ? this.liveOptions.stepDelayMs : visibleDelay,
        traceLive: traceLive == null ? this.liveOptions.traceLive : traceLive,
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
    if (!this.runtime || !this.runtime.page) return null;
    try {
      return await describeRuntimeStatus(this.runtime.page);
    } catch (error) {
      return { error: error.message };
    }
  }

  getStatus() {
    return {
      state: this.state,
      currentStep: this.currentStep,
      totalSteps: this.totalSteps(),
      selectedStep: this.selectedStep,
      lastCompletedStep: this.lastCompletedStep,
      browserUrl: this.runtime ? this.runtime.url : null,
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
    return status;
  }
}

module.exports = { ReplaySession };
