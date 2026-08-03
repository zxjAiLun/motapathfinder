"use strict";

const path = require("node:path");

const {
  decodeH5SavePackage,
  decodeH5SavePackageText,
  resumeError,
} = require("./replay-resume-artifact");
const {
  loadResumeArtifactForGui,
} = require("./replay-resume-gui");
const { ReplayResumeSession } = require("./replay-resume-session");

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function uploadName(value) {
  const name = path.basename(String(value || "resume.h5save")).trim();
  return name ? name.slice(0, 160) : "resume.h5save";
}

class ReplayResumeController {
  constructor({
    project,
    projectRoot,
    routeRecord,
    routeFile,
    allowUnverifiedRoute,
    h5saveFile,
    liveOptions,
    sessionFactory,
  } = {}) {
    this.project = project;
    this.projectRoot = projectRoot;
    this.routeRecord = routeRecord || null;
    this.routeFile = routeFile || null;
    this.allowUnverifiedRoute = allowUnverifiedRoute === true;
    this.liveOptions = liveOptions || {};
    this.sessionFactory = typeof sessionFactory === "function"
      ? sessionFactory
      : (options) => new ReplayResumeSession(options);
    this.session = null;
    this.decoded = null;
    this.resumeInfo = null;

    if (h5saveFile) {
      try {
        this.decoded = decodeH5SavePackage(projectRoot, h5saveFile);
      } catch (error) {
        this.decoded = null;
      }
    }
    this.resumeInfo = loadResumeArtifactForGui({
      project,
      projectRoot,
      h5saveFile: h5saveFile || null,
      routeRecord,
      routeFile,
      allowUnverifiedRoute: this.allowUnverifiedRoute,
    });
  }

  getStatus() {
    return Object.assign({}, cloneJson(this.resumeInfo || {
      status: "not-loaded",
      mode: "none",
      requested: false,
    }), {
      operation: this.session ? this.session.getStatus() : null,
    });
  }

  async getStatusAsync() {
    return Object.assign({}, cloneJson(this.resumeInfo || {
      status: "not-loaded",
      mode: "none",
      requested: false,
    }), {
      operation: this.session ? await this.session.getStatusAsync() : null,
    });
  }

  async closeSession() {
    if (!this.session) return;
    await this.session.close().catch(() => null);
    this.session = null;
  }

  async load({ fileName, content } = {}) {
    if (typeof content !== "string" || !content.trim()) {
      throw resumeError(
        "REPLAY_RESUME_H5SAVE_INVALID",
        "Uploaded h5save content is empty.",
      );
    }
    await this.closeSession();
    const label = uploadName(fileName);
    let decoded = null;
    try {
      decoded = decodeH5SavePackageText(this.projectRoot, content);
    } catch (error) {
      this.decoded = null;
      this.resumeInfo = loadResumeArtifactForGui({
        project: this.project,
        projectRoot: this.projectRoot,
        h5saveFile: label,
        h5saveText: content,
        routeRecord: this.routeRecord,
        routeFile: this.routeFile,
        allowUnverifiedRoute: this.allowUnverifiedRoute,
      });
      return this.getStatus();
    }
    this.decoded = decoded;
    this.resumeInfo = loadResumeArtifactForGui({
      project: this.project,
      projectRoot: this.projectRoot,
      h5saveFile: label,
      h5saveText: content,
      routeRecord: this.routeRecord,
      routeFile: this.routeFile,
      allowUnverifiedRoute: this.allowUnverifiedRoute,
    });
    return this.getStatus();
  }

  createSession() {
    if (!this.decoded || this.resumeInfo.status !== "verified") {
      const error = resumeError(
        "REPLAY_RESUME_INTERACTIVE_REQUIRES_VERIFIED_ARTIFACT",
        "Interactive resume requires a verified h5save artifact and route.",
      );
      throw error;
    }
    return this.sessionFactory({
      project: this.project,
      projectRoot: this.projectRoot,
      routeRecord: this.routeRecord,
      decoded: this.decoded,
      resumeInfo: this.resumeInfo,
      liveOptions: this.liveOptions,
    });
  }

  async start({ liveOptions } = {}) {
    if (!this.session) this.session = this.createSession();
    return this.session.start({
      liveOptions: Object.assign({}, this.liveOptions, liveOptions || {}),
    }).then(() => this.getStatus());
  }

  play({ stepDelayMs } = {}) {
    if (!this.session) this.session = this.createSession();
    const playPromise = this.session.startPlay({ stepDelayMs });
    playPromise.catch(() => {});
    return {
      ok: true,
      accepted: true,
      state: "running",
      operation: this.session.getStatus(),
    };
  }

  pause() {
    if (!this.session) return this.getStatus();
    this.session.pause();
    return this.getStatus();
  }

  async step({ stepDelayMs } = {}) {
    if (!this.session) this.session = this.createSession();
    await this.session.step({ stepDelayMs });
    return this.getStatus();
  }

  async close() {
    await this.closeSession();
    return this.getStatus();
  }
}

module.exports = {
  ReplayResumeController,
  uploadName,
};
