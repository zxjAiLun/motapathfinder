"use strict";

const { compileSolveTask, compileExecutableSolveTask, SolveTaskError } = require("../lib/solve-task");
const { SolverJobError } = require("../lib/solver-job");
const { createSolveTaskErrorResult } = require("../lib/solver-job-manager");
const { buildRegionMilestoneSpec } = require("../lib/region-spec");
const { effectiveSegmentBudgets } = require("../lib/segment-dp");
const { loadProject } = require("../lib/project-loader");

const TERMINAL_STATES = ["completed", "failed", "cancelled"];

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 4 * 1024 * 1024) {
        reject(new Error("request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error(`invalid JSON body: ${error.message}`));
      }
    });
    req.on("error", reject);
  });
}

function writeJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Last-Event-ID",
  });
  res.end(`${JSON.stringify(payload)}\n`);
}

function jobSummaryFromStatus(status, extra) {
  const progress = status && status.lastProgress || {};
  return {
    id: status && status.id,
    state: status && status.state,
    taskFingerprint: status && status.taskFingerprint,
    createdAt: status && status.createdAt,
    startedAt: status && status.startedAt,
    finishedAt: status && status.finishedAt,
    phase: progress.phase || null,
    bestKnown: progress.bestKnown || null,
    failure: status && status.failure || null,
    ...(extra || {}),
  };
}

function createJobApi({ manager, jobStore, registry, context }) {
  const routes = [];

  const validateTask = async (ctx) => {
    const { req, res } = ctx;
    let body;
    try {
      body = await readBody(req);
    } catch (error) {
      writeJson(res, 400, { valid: false, failure: { failureClass: "INVALID_TASK", code: "INVALID_TASK", message: error.message } });
      return;
    }
    try {
      const task = compileSolveTask(body, context);
      const objective = task.objective;
      // Effective per-segment budgets: the task search overrides the
      // RegionSpec/segment budgets, so preflight reports what will actually be
      // executed, not what the RegionSpec ships.  A build failure must not be
      // silently swallowed as "valid with no segments".
      let effectiveSegments = [];
      let effectiveSegmentsStatus = "ok";
      let effectiveSegmentsFailure = null;
      const projectRoot = task.normalizedTask.tower.projectRoot;
      if (projectRoot) {
        try {
          const project = loadProject(projectRoot);
          const milestoneSpec = buildRegionMilestoneSpec(project, task.normalizedTask.tower.region.spec);
          effectiveSegments = effectiveSegmentBudgets(milestoneSpec, task.executeConfig);
        } catch (error) {
          effectiveSegmentsStatus = "unavailable";
          effectiveSegmentsFailure = {
            failureClass: "PLANNING_PREFLIGHT_FAILED",
            code: "PLANNING_PREFLIGHT_FAILED",
            message: error && error.message ? error.message : String(error),
            retryable: false,
          };
          writeJson(res, 400, {
            valid: false,
            failure: effectiveSegmentsFailure,
            effectiveSegmentsStatus,
          });
          return;
        }
      } else {
        effectiveSegmentsStatus = "not-applicable";
      }
      writeJson(res, 200, {
        valid: true,
        normalizedTask: task.toJSON(),
        identity: {
          taskFingerprint: task.taskFingerprint,
          towerFingerprint: task.towerFingerprint,
          regionFingerprint: task.regionFingerprint,
          solverModelFingerprint: task.solverModelFingerprint,
          objectiveFingerprint: task.objectiveFingerprint,
        },
        objective: {
          explicit: objective.explicit,
          searchPreserving: objective.searchPreserving,
          terminalOnly: objective.terminalOnly,
          mode: objective.mode,
          fingerprint: objective.fingerprint,
        },
        effectiveSearch: task.normalizedTask.search,
        effectiveSegments,
        effectiveSegmentsStatus,
      });
    } catch (error) {
      writeJson(res, 400, {
        valid: false,
        failure: createSolveTaskErrorResult(error),
      });
    }
  };

  const createJob = async (ctx) => {
    const { req, res } = ctx;
    let body;
    try {
      body = await readBody(req);
    } catch (error) {
      writeJson(res, 400, { failure: { failureClass: "INVALID_TASK", code: "INVALID_TASK", message: error.message } });
      return;
    }
    try {
      const job = manager.submit(body);
      const status = job.toJSON();
      writeJson(res, 202, {
        job: jobSummaryFromStatus(status, { phase: status.lastProgress && status.lastProgress.phase || "queued" }),
      });
    } catch (error) {
      if (error instanceof SolveTaskError || (error && error.code === "INVALID_TASK")) {
        writeJson(res, 400, { failure: createSolveTaskErrorResult(error) });
      } else {
        writeJson(res, 500, { failure: { failureClass: "INTERNAL_ERROR", message: error.message } });
      }
    }
  };

  const jobExists = (jobId) => {
    if (manager.getJob(jobId)) return true;
    if (jobStore && jobStore.readStatus(jobId)) return true;
    return false;
  };

  const listJobs = (ctx) => {
    const { res } = ctx;
    const live = manager.snapshot().map((status) => jobSummaryFromStatus(status));
    const ids = new Set(live.map((entry) => entry.id));
    const stored = [];
    if (jobStore) {
      jobStore.listJobs().forEach((jobId) => {
        if (ids.has(jobId)) return;
        const status = jobStore.readStatus(jobId);
        if (!status) return;
        const interrupted = !TERMINAL_STATES.includes(status.state);
        stored.push(jobSummaryFromStatus(status, {
          interrupted,
          state: interrupted ? "interrupted" : status.state,
        }));
      });
    }
    const merged = live.concat(stored).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    writeJson(res, 200, { jobs: merged });
  };

  const getJob = (ctx) => {
    const { res, params } = ctx;
    const jobId = params.jobId;
    const job = manager.getJob(jobId);
    if (job) {
      const task = job.task && job.task.normalizedTask ? job.task.toJSON() : (job.task || null);
      writeJson(res, 200, { job: jobSummaryFromStatus(job.toJSON()), task });
      return;
    }
    if (jobStore && jobStore.readStatus(jobId)) {
      const status = jobStore.readStatus(jobId);
      const interrupted = !TERMINAL_STATES.includes(status.state);
      writeJson(res, 200, {
        job: jobSummaryFromStatus(status, {
          interrupted,
          state: interrupted ? "interrupted" : status.state,
        }),
        task: jobStore.readTask(jobId) || null,
      });
      return;
    }
    writeJson(res, 404, { failure: { failureClass: "JOB_NOT_FOUND", code: "JOB_NOT_FOUND", message: `job not found: ${jobId}` } });
  };

  const getJobResult = (ctx) => {
    const { res, params } = ctx;
    const jobId = params.jobId;
    const job = manager.getJob(jobId);
    if (job) {
      writeJson(res, 200, { result: job.result || null, state: job.state });
      return;
    }
    if (jobStore && jobStore.readResult(jobId)) {
      writeJson(res, 200, { result: jobStore.readResult(jobId), state: jobStore.readStatus(jobId).state });
      return;
    }
    writeJson(res, 404, { failure: { failureClass: "JOB_NOT_FOUND", code: "JOB_NOT_FOUND", message: `job not found: ${jobId}` } });
  };

  const getJobRoute = (ctx) => {
    const { req, res, params } = ctx;
    const jobId = params.jobId;
    const job = manager.getJob(jobId);
    const result = job ? job.result : (jobStore ? jobStore.readResult(jobId) : null);
    const record = result && result.route && result.route.record;
    if (!record) {
      writeJson(res, 404, { failure: { failureClass: "ROUTE_NOT_FOUND", code: "ROUTE_NOT_FOUND", message: `route not found for job: ${jobId}` } });
      return;
    }
    const json = JSON.stringify(record, null, 2);
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${jobId}.route.json"`,
      "Access-Control-Allow-Origin": "*",
    });
    res.end(`${json}\n`);
  };

  const cancelJob = (ctx) => {
    const { res, params } = ctx;
    const jobId = params.jobId;
    try {
      const cancelled = manager.cancel(jobId);
      if (!cancelled && !jobExists(jobId)) {
        writeJson(res, 404, { failure: { failureClass: "JOB_NOT_FOUND", code: "JOB_NOT_FOUND", message: `job not found: ${jobId}` } });
        return;
      }
      writeJson(res, 202, { cancelled: true, jobId });
    } catch (error) {
      if (error instanceof SolverJobError && error.code === "JOB_INVALID_STATE_TRANSITION") {
        writeJson(res, 409, { failure: { failureClass: "JOB_INVALID_STATE_TRANSITION", code: error.code, message: error.message } });
      } else {
        writeJson(res, 500, { failure: { failureClass: "INTERNAL_ERROR", message: error.message } });
      }
    }
  };

  const jobEvents = (ctx) => {
    const { req, res, params } = ctx;
    const jobId = params.jobId;
    if (!jobExists(jobId)) {
      writeJson(res, 404, { failure: { failureClass: "JOB_NOT_FOUND", code: "JOB_NOT_FOUND", message: `job not found: ${jobId}` } });
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    res.write("retry: 2000\n\n");

    const lastEventId = Number(req.headers["last-event-id"]) || 0;
    let closed = false;
    let terminalSent = false;
    let heartbeat = null;
    let unsubscribe = () => {};

    const send = (sequence, event, payload) => {
      if (closed) return;
      const data = typeof payload === "string" ? payload : JSON.stringify(payload);
      res.write(`id: ${sequence}\nevent: ${event}\ndata: ${data}\n\n`);
    };

    const sendSnapshot = (snapshot, isTerminal) => {
      if (!snapshot) return;
      const seq = Number(snapshot.sequence) || 0;
      send(seq, isTerminal ? "terminal" : "progress", snapshot);
      if (isTerminal || TERMINAL_STATES.includes(snapshot.phase)) {
        terminalSent = true;
        if (!closed) {
          closed = true;
          if (heartbeat) clearInterval(heartbeat);
          unsubscribe();
          res.end();
        }
      }
    };

    // 1) Replay persisted progress lines with sequence > lastEventId.
    let latestSequence = lastEventId;
    if (jobStore) {
      jobStore.readProgressLines(jobId).forEach((snapshot) => {
        const seq = Number(snapshot.sequence) || 0;
        if (seq <= lastEventId) return;
        latestSequence = Math.max(latestSequence, seq);
        sendSnapshot(snapshot, TERMINAL_STATES.includes(snapshot.phase));
        if (terminalSent) return;
      });
    }

    // 2) If the job is terminal already (stored or live) and terminal not yet
    // sent, send the terminal snapshot and close.
    const job = manager.getJob(jobId);
    if (!terminalSent) {
      const liveProgress = job && job.lastProgress;
      const storedStatus = jobStore && jobStore.readStatus(jobId);
      const storedLast = storedStatus && storedStatus.lastProgress;
      const terminalSnapshot = liveProgress && TERMINAL_STATES.includes(liveProgress.phase)
        ? liveProgress
        : (storedLast && TERMINAL_STATES.includes(storedLast.phase) ? storedLast : null);
      if (terminalSnapshot) {
        sendSnapshot(terminalSnapshot, true);
      }
    }

    // 3) Subscribe to live progress for a running job.
    if (!terminalSent && job) {
      unsubscribe = manager.subscribe(jobId, (snapshot) => {
        sendSnapshot(snapshot, TERMINAL_STATES.includes(snapshot.phase));
      });
    } else if (!terminalSent) {
      // Stored, non-terminal (interrupted) job: no live worker is attached.
      const storedStatus = jobStore && jobStore.readStatus(jobId);
      sendSnapshot({
        schema: "motapathfinder.solver-progress.v1",
        jobId,
        taskFingerprint: storedStatus && storedStatus.taskFingerprint || null,
        sequence: latestSequence + 1,
        timestamp: new Date().toISOString(),
        status: "interrupted",
        phase: "interrupted",
        segment: null,
        search: {},
        budget: null,
        bestKnown: null,
        proof: null,
      }, true);
    }

    if (!terminalSent) {
      heartbeat = setInterval(() => {
        if (closed) return;
        send(latestSequence, "heartbeat", { ts: new Date().toISOString() });
      }, 20000);
    }

    req.on("close", () => {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe();
      try { res.end(); } catch (error) { /* ignore */ }
    });
  };

  const towerList = (ctx) => {
    const { res } = ctx;
    try {
      writeJson(res, 200, { towers: registry.listTowers() });
    } catch (error) {
      writeJson(res, 500, { failure: { failureClass: "INTERNAL_ERROR", message: error.message } });
    }
  };

  const towerGet = (ctx) => {
    const { res, params } = ctx;
    try {
      writeJson(res, 200, { tower: registry.getTower(params.towerId) });
    } catch (error) {
      writeJson(res, 404, { failure: { failureClass: "REGISTRY_TOWER_NOT_FOUND", code: error.code, message: error.message } });
    }
  };

  const regionList = (ctx) => {
    const { res, params } = ctx;
    try {
      writeJson(res, 200, { regions: registry.listRegions(params.towerId) });
    } catch (error) {
      writeJson(res, 404, { failure: { failureClass: error.code || "REGISTRY_TOWER_NOT_FOUND", code: error.code, message: error.message } });
    }
  };

  const regionGet = (ctx) => {
    const { res, params } = ctx;
    try {
      const loaded = registry.loadRegion(params.towerId, params.regionId);
      writeJson(res, 200, {
        region: {
          id: params.regionId,
          spec: loaded.spec,
          regionFingerprint: loaded.regionFingerprint,
        },
      });
    } catch (error) {
      const status = error && error.code === "REGISTRY_PATH_ESCAPE" ? 400 : 404;
      writeJson(res, status, { failure: { failureClass: error.code || "REGISTRY_REGION_NOT_FOUND", code: error.code, message: error.message } });
    }
  };

  const health = (ctx) => {
    const { res } = ctx;
    writeJson(res, 200, {
      status: "ok",
      schema: "motapathfinder.launcher.health.v1",
      version: "1",
      liveJobs: manager.running,
      queuedJobs: manager.queued,
    });
  };

  const add = (method, pattern, handler) => routes.push({ method, pattern, handler });

  add("GET", "/api/health", health);
  add("GET", "/api/towers", towerList);
  add("GET", "/api/towers/:towerId", towerGet);
  add("GET", "/api/towers/:towerId/regions", regionList);
  add("GET", "/api/towers/:towerId/regions/:regionId", regionGet);
  add("POST", "/api/tasks/validate", validateTask);
  add("POST", "/api/jobs", createJob);
  add("GET", "/api/jobs", listJobs);
  add("GET", "/api/jobs/:jobId", getJob);
  add("GET", "/api/jobs/:jobId/result", getJobResult);
  add("GET", "/api/jobs/:jobId/route", getJobRoute);
  add("POST", "/api/jobs/:jobId/cancel", cancelJob);
  add("GET", "/api/jobs/:jobId/events", jobEvents);
  add("OPTIONS", "/api/*", (req, res) => writeJson(res, 204, {}));

  return { routes, jobEvents, validateTask, createJob };
}

module.exports = { createJobApi, jobSummaryFromStatus };
