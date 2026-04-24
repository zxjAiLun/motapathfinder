"use strict";

const os = require("node:os");
const { Worker } = require("node:worker_threads");

class WorkerPool {
  constructor(workerFile, options) {
    const config = options || {};
    this.workerFile = workerFile;
    this.workerData = config.workerData || {};
    this.size = Math.max(1, Number(config.workers || Math.max(1, (os.availableParallelism ? os.availableParallelism() : os.cpus().length) - 1)));
    this.workers = [];
    this.idle = [];
    this.queue = [];
    this.nextJobId = 1;
    this.closed = false;
    for (let index = 0; index < this.size; index += 1) this.spawn(index);
  }

  spawn(index) {
    const worker = new Worker(this.workerFile, { workerData: this.workerData });
    const slot = { index, worker, current: null };
    worker.on("message", (message) => this.handleMessage(slot, message));
    worker.on("error", (error) => this.handleError(slot, error));
    worker.on("exit", (code) => {
      if (!this.closed && code !== 0) this.handleError(slot, new Error(`Worker ${slot.index} exited with code ${code}`));
    });
    this.workers.push(slot);
    this.idle.push(slot);
  }

  run(message) {
    if (this.closed) return Promise.reject(new Error("WorkerPool is closed."));
    const jobId = this.nextJobId++;
    return new Promise((resolve, reject) => {
      this.queue.push({ message: { ...message, jobId }, resolve, reject, jobId });
      this.pump();
    });
  }

  async map(items, buildMessage) {
    return Promise.all(items.map((item, index) => this.run(buildMessage(item, index))));
  }

  pump() {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const slot = this.idle.shift();
      const job = this.queue.shift();
      slot.current = job;
      slot.worker.postMessage(job.message);
    }
  }

  handleMessage(slot, message) {
    const job = slot.current;
    slot.current = null;
    this.idle.push(slot);
    if (!job) return;
    if (message && message.error) job.reject(new Error(message.error));
    else job.resolve(message);
    this.pump();
  }

  handleError(slot, error) {
    if (slot.current) {
      slot.current.reject(error);
      slot.current = null;
    }
    this.idle = this.idle.filter((item) => item !== slot);
  }

  async close() {
    this.closed = true;
    await Promise.all(this.workers.map((slot) => slot.worker.terminate().catch(() => null)));
  }
}

module.exports = {
  WorkerPool,
};
