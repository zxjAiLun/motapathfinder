#!/usr/bin/env node
"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const { URL } = require("url");

const { readRouteFile } = require("./lib/route-store");
const {
  buildRouteSummary,
  buildStepDetail,
  findDivergence,
} = require("./lib/route-inspector");
const { ReplaySession } = require("./lib/replay-session");
const { loadProject } = require("./lib/project-loader");
const { parseKeyValueArgs, resolveProjectRoot } = require("./lib/cli-options");
const { decodeH5SavePackage } = require("./lib/replay-resume-artifact");
const { loadResumeArtifactForGui } = require("./lib/replay-resume-gui");
const { ReplayResumeController } = require("./lib/replay-resume-controller");

const GUI_DIR = path.resolve(__dirname, "gui");
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function parseBoolean(value, fallback) {
  if (value == null) return fallback;
  if (value === true || value === "1" || value === "true" || value === "on")
    return true;
  if (value === false || value === "0" || value === "false" || value === "off")
    return false;
  return fallback;
}

function parseNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function parseFromStep(value) {
  return value == null ? 1 : value;
}

function resolveRouteFile(inputPath, projectRoot) {
  if (!inputPath) throw new Error("Missing required --route-file=<path>.");
  const candidates = [
    path.resolve(process.cwd(), inputPath),
    projectRoot ? path.resolve(projectRoot, inputPath) : null,
    projectRoot ? path.resolve(projectRoot, "solver", inputPath) : null,
    path.resolve(__dirname, inputPath),
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  return found || candidates[0];
}

function resolveH5SaveFile(inputPath, projectRoot) {
  if (!inputPath) return null;
  const candidates = [
    path.resolve(process.cwd(), inputPath),
    projectRoot ? path.resolve(projectRoot, inputPath) : null,
    path.resolve(__dirname, inputPath),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function resolveEmbeddedRouteFile(routePath, projectRoot) {
  if (!routePath) return null;
  const repoRoot = path.resolve(__dirname, "..");
  const candidates = [
    path.resolve(process.cwd(), routePath),
    path.resolve(repoRoot, routePath),
    projectRoot ? path.resolve(projectRoot, routePath) : null,
    path.resolve(__dirname, routePath),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function emptyRouteRecord() {
  return {
    schema: "motapathfinder.route-gui-resume-only.v1",
    source: {},
    goal: {},
    stats: {},
    start: {},
    final: {},
    decisions: [],
    notes: [],
  };
}

function unavailableSession(resumeInfo) {
  const error = new Error(
    resumeInfo && resumeInfo.failure && resumeInfo.failure.message
      ? resumeInfo.failure.message
      : "Route file is unavailable; this GUI is showing resume artifact metadata only.",
  );
  error.code = resumeInfo && resumeInfo.failure && resumeInfo.failure.code
    ? resumeInfo.failure.code
    : "REPLAY_GUI_ROUTE_REQUIRED";
  error.statusCode = 409;
  const status = {
    state: "unavailable",
    currentStep: 1,
    totalSteps: 0,
    selectedStep: 1,
    lastCompletedStep: 0,
    stepStatuses: {},
    busy: false,
    resumeOnly: true,
    lastError: {
      code: error.code,
      message: error.message,
    },
    lastMismatch: null,
  };
  const normalizeStep = (step) => {
    const number = step == null || step === "" ? 1 : Number(step);
    if (!Number.isInteger(number) || number < 0 || number > 1) {
      const rangeError = new Error(
        `Replay step ${step} is out of range; expected an integer in [0, 1].`,
      );
      rangeError.code = "REPLAY_STEP_OUT_OF_RANGE";
      rangeError.statusCode = 400;
      throw rangeError;
    }
    return 1;
  };
  const rejected = () => Promise.reject(error);
  return {
    normalizeStep,
    getStatus() { return Object.assign({}, status); },
    async getStatusAsync() { return Object.assign({}, status); },
    selectStep() { return Object.assign({}, status); },
    pause() { return Object.assign({}, status); },
    close: async () => Object.assign({}, status, { state: "closed" }),
    start: rejected,
    play: rejected,
    step: rejected,
    restart: rejected,
    jumpToStep: rejected,
  };
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload, null, 2));
}

function sendError(response, error, debug) {
  sendJson(response, error.statusCode || 500, {
    ok: false,
    error: error.message || String(error),
    code: error.code || null,
    requestedStep: error.requestedStep == null ? null : error.requestedStep,
    totalSteps: error.totalSteps == null ? null : error.totalSteps,
    stack: debug ? error.stack : undefined,
  });
}

function readJsonBody(request, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = "";
    let settled = false;
    request.on("data", (chunk) => {
      if (settled) return;
      body += chunk;
      if (body.length > maxBytes) {
        settled = true;
        const error = new Error("Request body too large.");
        error.statusCode = 413;
        reject(error);
        request.resume();
      }
    });
    request.on("end", () => {
      if (settled) return;
      settled = true;
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        error.statusCode = 400;
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function serveStatic(requestPath, response) {
  const relative =
    requestPath === "/" ? "index.html" : requestPath.replace(/^\/gui\//, "");
  const normalized = path.normalize(relative).replace(/^([.][.][\/\\])+/, "");
  const filePath = path.resolve(GUI_DIR, normalized);
  if (!filePath.startsWith(GUI_DIR + path.sep) && filePath !== GUI_DIR) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500);
      response.end(error.code === "ENOENT" ? "Not Found" : "Server Error");
      return;
    }
    response.writeHead(200, {
      "Content-Type":
        MIME_TYPES[path.extname(filePath).toLowerCase()] ||
        "application/octet-stream",
    });
    response.end(content);
  });
}

function openBrowser(url) {
  let command;
  let args;
  if (process.platform === "darwin") {
    command = "open";
    args = [url];
  } else if (process.platform === "win32") {
    command = "cmd";
    args = ["/c", "start", "", url];
  } else {
    command = "xdg-open";
    args = [url];
  }
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
}

function createGuiServer({
  routeRecord,
  routeFile,
  session,
  project,
  debug,
  baselineRecord,
  baselineFile,
  resumeInfo,
  resumeController,
}) {
  const displayRouteRecord = routeRecord || emptyRouteRecord();
  const routeSummary = buildRouteSummary(displayRouteRecord, routeFile, project);
  const baselineSummary = baselineRecord
    ? buildRouteSummary(baselineRecord, baselineFile, project)
    : null;
  const divergence =
    baselineSummary && routeRecord
      ? findDivergence(displayRouteRecord, baselineRecord)
      : null;
  async function currentResumeStatus() {
    if (resumeController && typeof resumeController.getStatusAsync === "function") {
      return resumeController.getStatusAsync();
    }
    return resumeInfo || {
      status: "not-loaded",
      mode: "none",
      requested: false,
    };
  }
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    try {
      if (
        request.method === "GET" &&
        (url.pathname === "/" || url.pathname.startsWith("/gui/"))
      ) {
        serveStatic(url.pathname, response);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/route") {
        sendJson(response, 200, {
          ...routeSummary,
          resume: await currentResumeStatus(),
          baseline: baselineSummary
            ? {
                divergence: divergence || { identical: true },
                summary: baselineSummary,
              }
            : null,
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/route/compare") {
        sendJson(response, 200, {
          ok: true,
          baselineFile: baselineFile || null,
          divergence: divergence || { identical: true },
          solverSummary: routeSummary,
          baselineSummary,
        });
        return;
      }

      if (
        request.method === "GET" &&
        (url.pathname === "/api/resume" || url.pathname === "/api/resume/status")
      ) {
        sendJson(response, 200, await currentResumeStatus());
        return;
      }

      if (
        request.method === "POST" &&
        url.pathname.startsWith("/api/resume/")
      ) {
        if (!resumeController) {
          throw Object.assign(new Error("Interactive resume controller is unavailable."), {
            code: "REPLAY_RESUME_CONTROLLER_UNAVAILABLE",
            statusCode: 409,
          });
        }
        const body = await readJsonBody(request, 32 * 1024 * 1024);
        if (url.pathname === "/api/resume/load") {
          sendJson(response, 200, await resumeController.load({
            fileName: body.fileName || body.name,
            content: body.content,
          }));
          return;
        }
        if (url.pathname === "/api/resume/start") {
          sendJson(response, 200, await resumeController.start({
            liveOptions: body.liveOptions || {},
          }));
          return;
        }
        if (url.pathname === "/api/resume/play") {
          sendJson(response, 202, resumeController.play({ stepDelayMs: body.stepDelayMs }));
          return;
        }
        if (url.pathname === "/api/resume/pause") {
          sendJson(response, 200, resumeController.pause());
          return;
        }
        if (url.pathname === "/api/resume/step") {
          sendJson(response, 200, await resumeController.step({
            stepDelayMs: body.stepDelayMs,
          }));
          return;
        }
        if (url.pathname === "/api/resume/close") {
          sendJson(response, 200, await resumeController.close());
          return;
        }
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Not Found");
        return;
      }

      const stepMatch = url.pathname.match(/^\/api\/route\/step\/(\d+)$/);
      if (request.method === "GET" && stepMatch) {
        sendJson(
          response,
          200,
          buildStepDetail(displayRouteRecord, Number(stepMatch[1]), project),
        );
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/session/status") {
        sendJson(response, 200, await session.getStatusAsync());
        return;
      }

      if (
        request.method === "POST" &&
        url.pathname.startsWith("/api/session/")
      ) {
        const body = await readJsonBody(request);
        if (url.pathname === "/api/session/start") {
          sendJson(
            response,
            200,
            await session.start({
              fromStep: body.fromStep,
              liveOptions: body.liveOptions || {},
            }),
          );
          return;
        }
        if (url.pathname === "/api/session/play") {
          session.play({ stepDelayMs: body.stepDelayMs }).catch(() => {});
          sendJson(response, 200, { ok: true });
          return;
        }
        if (url.pathname === "/api/session/pause") {
          sendJson(response, 200, session.pause());
          return;
        }
        if (url.pathname === "/api/session/step") {
          sendJson(
            response,
            200,
            await session.step({ stepDelayMs: body.stepDelayMs }),
          );
          return;
        }
        if (url.pathname === "/api/session/restart") {
          sendJson(response, 200, await session.restart());
          return;
        }
        if (url.pathname === "/api/session/jump") {
          sendJson(response, 200, await session.jumpToStep(body.step));
          return;
        }
        if (url.pathname === "/api/session/select-step") {
          sendJson(response, 200, session.selectStep(body.step));
          return;
        }
        if (url.pathname === "/api/session/close") {
          sendJson(response, 200, await session.close());
          return;
        }
      }

      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not Found");
    } catch (error) {
      sendError(response, error, debug);
    }
  });
  return server;
}

async function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server.address()));
  });
}

async function main() {
  const args = parseKeyValueArgs(process.argv.slice(2));
  const projectRoot = resolveProjectRoot(args, path.resolve(__dirname, ".."));
  const project = loadProject(projectRoot);
  const allowUnverifiedRoute = parseBoolean(args["allow-unverified-route"], false);
  const h5saveFile = args.h5save
    ? resolveH5SaveFile(args.h5save, projectRoot)
    : null;
  let decodedResume = null;
  if (h5saveFile) {
    try {
      decodedResume = decodeH5SavePackage(projectRoot, h5saveFile);
    } catch (error) {
      decodedResume = null;
    }
  }
  let routeFile = null;
  if (args["route-file"]) {
    routeFile = resolveRouteFile(args["route-file"], projectRoot);
  } else if (h5saveFile && !allowUnverifiedRoute) {
    routeFile = resolveEmbeddedRouteFile(
      decodedResume && decodedResume.artifact && decodedResume.artifact.routeFile,
      projectRoot,
    );
  } else if (!h5saveFile) {
    routeFile = resolveRouteFile(args["route-file"], projectRoot);
  }
  const routeRecord = routeFile ? readRouteFile(routeFile) : null;
  const resumeInfo = loadResumeArtifactForGui({
    project,
    projectRoot,
    h5saveFile,
    routeRecord,
    routeFile,
    allowUnverifiedRoute,
  });
  const live = parseBoolean(args.live, false);
  const host = args.host || "127.0.0.1";
  const port = parseNumber(args.port, 0);
  const open = parseBoolean(args.open, true);
  // Keep the raw CLI value so ReplaySession.normalizeStep() owns the same
  // HTTP/API validation contract.  In particular, --from-step=abc must not
  // silently become step 1.
  const fromStep = parseFromStep(args["from-step"]);
  const baselineFile = args["baseline-route"]
    ? resolveRouteFile(args["baseline-route"], projectRoot)
    : null;
  const baselineRecord = baselineFile ? readRouteFile(baselineFile) : null;
  const liveOptions = {
    browser: args.browser,
    headless: args.headless != null ? args.headless : "0",
    keepOpen: parseBoolean(args["keep-open"], true),
    stepDelayMs: parseNumber(args["step-delay-ms"], 1400),
    fastForwardDelayMs: parseNumber(args["fast-forward-delay-ms"], 0),
    timeoutMs: parseNumber(args["timeout-ms"], 30000),
    downloadsDir: args["downloads-dir"],
    fromStep,
  };
  const resumeController = new ReplayResumeController({
    project,
    projectRoot,
    routeRecord,
    routeFile,
    allowUnverifiedRoute,
    h5saveFile,
    liveOptions,
  });
  const session = routeRecord
    ? new ReplaySession({
        routeRecord,
        projectRoot,
        liveOptions,
      })
    : unavailableSession(resumeInfo);
  // Validate before creating the HTTP server or opening a browser.  This is
  // the process-level CLI gate; API/session validation remains the same
  // contract for requests made after the GUI is already running.
  session.normalizeStep(fromStep);
  const server = createGuiServer({
    routeRecord,
    routeFile,
    session,
    project,
    debug: parseBoolean(args.debug, false),
    baselineRecord,
    baselineFile,
    resumeInfo,
    resumeController,
  });
  const address = await listen(server, host, port);
  const guiUrl = `http://${host}:${address.port}/`;
  console.log(`Route GUI: ${guiUrl}`);
  if (routeFile) console.log(`Route file: ${routeFile}`);
  if (h5saveFile) console.log(`Resume artifact: ${h5saveFile}`);
  if (!routeFile) console.log("Route file: unavailable; showing resume artifact metadata only.");
  if (open) openBrowser(guiUrl);

  const shutdown = async () => {
    console.log("\nClosing Route GUI...");
    await session.close().catch(() => null);
    await resumeController.close().catch(() => null);
    await new Promise((resolve) => server.close(resolve));
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  if (live && routeRecord) {
    console.log(`Starting live runtime at step ${fromStep}...`);
    session.start({ fromStep }).catch((error) => {
      console.error(`Live session failed: ${error.message}`);
    });
  }
}

if (require.main === module) {
  main().catch((error) => {
    const code = error && error.code ? `${error.code}: ` : "";
    console.error(`${code}${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  createGuiServer,
  parseArgs: parseKeyValueArgs,
  parseFromStep,
  resolveEmbeddedRouteFile,
  resolveH5SaveFile,
};
