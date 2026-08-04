"use strict";

const fs = require("node:fs");
const path = require("node:path");

// Minimal atomic file adapter for job artifacts under runs/jobs/<jobId>.
// Job files are diagnostics/persistence, never the authority for solver
// correctness: route artifacts and strict replay verification are.
class FileJobStore {
  constructor({ root }) {
    this.root = path.resolve(root || "runs/jobs");
  }

  jobDir(jobId) {
    return path.join(this.root, jobId);
  }

  async _writeJson(jobId, name, value) {
    const dir = this.jobDir(jobId);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `.${name}.${process.pid}.${Date.now()}.tmp`);
    const target = path.join(dir, name);
    const payload = value == null ? "null\n" : `${JSON.stringify(value, null, 2)}\n`;
    fs.writeFileSync(tmp, payload, "utf8");
    try {
      const fd = fs.openSync(tmp, "r");
      try {
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    } catch (error) {
      // fsync is best-effort; do not fail the write on platforms that reject it
    }
    fs.renameSync(tmp, target);
    return target;
  }

  async _appendLine(jobId, name, value) {
    const dir = this.jobDir(jobId);
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, name);
    fs.appendFileSync(target, `${JSON.stringify(value)}\n`, "utf8");
    return target;
  }

  saveTask(jobId, task) {
    return this._writeJson(jobId, "task.json", task);
  }

  saveStatus(jobId, status) {
    return this._writeJson(jobId, "status.json", status);
  }

  appendProgress(jobId, snapshot) {
    return this._appendLine(jobId, "progress.ndjson", snapshot);
  }

  saveResult(jobId, result) {
    return this._writeJson(jobId, "result.json", result);
  }

  saveError(jobId, failure) {
    return this._writeJson(jobId, "error.json", failure);
  }

  readJson(jobId, name) {
    const target = path.join(this.jobDir(jobId), name);
    if (!fs.existsSync(target)) return null;
    return JSON.parse(fs.readFileSync(target, "utf8"));
  }

  readTask(jobId) {
    return this.readJson(jobId, "task.json");
  }

  readStatus(jobId) {
    return this.readJson(jobId, "status.json");
  }

  readResult(jobId) {
    return this.readJson(jobId, "result.json");
  }

  readError(jobId) {
    return this.readJson(jobId, "error.json");
  }

  readProgressLines(jobId) {
    const target = path.join(this.jobDir(jobId), "progress.ndjson");
    if (!fs.existsSync(target)) return [];
    return fs.readFileSync(target, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch (error) {
          return null;
        }
      })
      .filter(Boolean);
  }

  listJobs() {
    if (!fs.existsSync(this.root)) return [];
    return fs.readdirSync(this.root)
      .filter((entry) => fs.statSync(path.join(this.root, entry)).isDirectory())
      .sort();
  }
}

module.exports = { FileJobStore };
