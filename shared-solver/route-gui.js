#!/usr/bin/env node
"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const { URL } = require("url");

const { readRouteFile } = require("./lib/route-store");
const { buildRouteSummary, buildStepDetail } = require("./lib/route-inspector");
const { ReplaySession } = require("./lib/replay-session");
const { loadProject } = require("./lib/project-loader");
const { parseKeyValueArgs, resolveProjectRoot } = require("./lib/cli-options");

const GUI_DIR = path.resolve(__dirname, "gui");
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function parseBoolean(value, fallback) {
  if (value == null) return fallback;
  if (value === true || value === "1" || value === "true" || value === "on") return true;
  if (value === false || value === "0" || value === "false" || value === "off") return false;
  return fallback;
}

function parseNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
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

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload, null, 2));
}

function sendError(response, error, debug) {
  sendJson(response, error.statusCode || 500, {
    ok: false,
    error: error.message || String(error),
    stack: debug ? error.stack : undefined,
  });
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) reject(new Error("Request body too large."));
    });
    request.on("end", () => {
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
  const relative = requestPath === "/" ? "index.html" : requestPath.replace(/^\/gui\//, "");
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
    response.writeHead(200, { "Content-Type": MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream" });
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

function createGuiServer({ routeRecord, routeFile, session, project, debug }) {
  const routeSummary = buildRouteSummary(routeRecord, routeFile, project);
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    try {
      if (request.method === "GET" && (url.pathname === "/" || url.pathname.startsWith("/gui/"))) {
        serveStatic(url.pathname, response);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/route") {
        sendJson(response, 200, routeSummary);
        return;
      }

      const stepMatch = url.pathname.match(/^\/api\/route\/step\/(\d+)$/);
      if (request.method === "GET" && stepMatch) {
        sendJson(response, 200, buildStepDetail(routeRecord, Number(stepMatch[1]), project));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/session/status") {
        sendJson(response, 200, await session.getStatusAsync());
        return;
      }

      if (request.method === "POST" && url.pathname.startsWith("/api/session/")) {
        const body = await readJsonBody(request);
        if (url.pathname === "/api/session/start") {
          sendJson(response, 200, await session.start({ fromStep: body.fromStep, liveOptions: body.liveOptions || {} }));
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
          sendJson(response, 200, await session.step({ stepDelayMs: body.stepDelayMs }));
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
  const routeFile = resolveRouteFile(args["route-file"], projectRoot);
  const routeRecord = readRouteFile(routeFile);
  const project = loadProject(projectRoot);
  const live = parseBoolean(args.live, false);
  const host = args.host || "127.0.0.1";
  const port = parseNumber(args.port, 0);
  const open = parseBoolean(args.open, true);
  const fromStep = parseNumber(args["from-step"], 1);
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
  const session = new ReplaySession({
    routeRecord,
    projectRoot,
    liveOptions,
  });
  const server = createGuiServer({ routeRecord, routeFile, session, project, debug: parseBoolean(args.debug, false) });
  const address = await listen(server, host, port);
  const guiUrl = `http://${host}:${address.port}/`;
  console.log(`Route GUI: ${guiUrl}`);
  console.log(`Route file: ${routeFile}`);
  if (open) openBrowser(guiUrl);

  const shutdown = async () => {
    console.log("\nClosing Route GUI...");
    await session.close().catch(() => null);
    await new Promise((resolve) => server.close(resolve));
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  if (live) {
    console.log(`Starting live runtime at step ${fromStep}...`);
    session.start({ fromStep }).catch((error) => {
      console.error(`Live session failed: ${error.message}`);
    });
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}

module.exports = { createGuiServer, parseArgs: parseKeyValueArgs };
