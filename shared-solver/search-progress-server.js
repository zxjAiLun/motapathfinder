"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { argumentsOf } = require("./run-durable-search");

function createProgressServer(runDir, options = {}) {
  const page = fs.readFileSync(path.join(__dirname, "gui/search-progress.html"));
  const towerRoot = options.towerRoot ? path.resolve(options.towerRoot) : null;
  let project = null;
  let sim = null;
  let mapData = null;

  const mapDataFile = path.join(__dirname, "profiles/trial-map-data.json");
  if (fs.existsSync(mapDataFile)) {
    try { mapData = JSON.parse(fs.readFileSync(mapDataFile, "utf8")); } catch (e) {}
  }

  if (towerRoot && fs.existsSync(path.join(towerRoot, "project"))) {
    try {
      const { loadProject } = require("./lib/project-loader");
      const { makeSimulator } = require("./lib/durable-search");
      const { buildMapMetadata } = require("./lib/route-debugger");
      project = loadProject(towerRoot);
      const configPath = path.join(__dirname, "profiles/neko-zero-key.json");
      const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, "utf8")) : { allowedFloors: [] };
      sim = makeSimulator(project, config);
      if (!mapData) mapData = buildMapMetadata(project);
    } catch (error) {
      console.warn("Simulator initialization for visual overlay failed:", error.message);
    }
  }

  const { buildBattleOverlay } = require("./lib/route-debugger");
  const overlayCache = new Map();

  return http.createServer((request, response) => {
    const host = (request.headers.host || "").split(":")[0];
    if (!["localhost", "127.0.0.1"].includes(host)) { response.writeHead(403); response.end("Forbidden host"); return; }
    if (request.method !== "GET") { response.writeHead(405, { Allow: "GET" }); response.end("Read only"); return; }

    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");

    const [urlPath, queryString] = request.url.split("?");
    const params = new URLSearchParams(queryString || "");

    if (urlPath === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(page);
      return;
    }

    if (urlPath === "/api/status") {
      try {
        const data = fs.readFileSync(path.join(runDir, "status.json"));
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        response.end(data);
      } catch (error) {
        response.writeHead(error.code === "ENOENT" ? 404 : 503, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: error.code === "ENOENT" ? "Not available yet" : "Temporarily unavailable" }));
      }
      return;
    }

    if (urlPath === "/api/map-data") {
      if (mapData) {
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify(mapData));
      } else {
        response.writeHead(404, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "Map data not available" }));
      }
      return;
    }

    if (urlPath === "/api/view-state") {
      let stateId = params.get("id");
      const mode = params.get("mode") || "auto"; // "auto", "progress", "entry"
      try {
        if (!stateId) {
          try {
            const status = JSON.parse(fs.readFileSync(path.join(runDir, "status.json"), "utf8"));
            stateId = (status.current && status.current.id) ||
              (status.history && status.history.length && status.history[status.history.length - 1].id) ||
              (status.initial && "initial");
          } catch (e) {}
        }
        if (!stateId) {
          response.writeHead(404, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ error: "No active state id" }));
          return;
        }
        if (!/^[a-zA-Z0-9_-]+$/.test(stateId)) {
          response.writeHead(400, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ error: "Invalid state id" }));
          return;
        }

        const baseFile = stateId === "initial"
          ? path.join(runDir, "initial.json")
          : path.join(runDir, "states", `${stateId}.json`);
        const progressFile = path.join(runDir, "states", `${stateId}-progress.json`);
        const hasProgress = fs.existsSync(progressFile);

        let targetFile = baseFile;
        let isProgress = false;
        if (mode === "progress" && hasProgress) {
          targetFile = progressFile;
          isProgress = true;
        } else if (mode === "auto" && hasProgress) {
          targetFile = progressFile;
          isProgress = true;
        }

        if (!fs.existsSync(targetFile)) {
          if (fs.existsSync(baseFile)) {
            targetFile = baseFile;
            isProgress = false;
          } else {
            response.writeHead(404, { "Content-Type": "application/json" });
            response.end(JSON.stringify({ error: "State file not found" }));
            return;
          }
        }

        const cacheKey = `${stateId}:${isProgress ? "prog" : "entry"}`;
        let overlay = overlayCache.get(cacheKey);
        const state = JSON.parse(fs.readFileSync(targetFile, "utf8"));
        if (!overlay && project && sim) {
          try {
            overlay = buildBattleOverlay(project, sim, state);
            if (overlayCache.size > 200) {
              const firstKey = overlayCache.keys().next().value;
              overlayCache.delete(firstKey);
            }
            overlayCache.set(cacheKey, overlay);
          } catch (e) {}
        }
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ state, overlay, isProgress, hasProgress }));
      } catch (error) {
        response.writeHead(500, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: error.message }));
      }
      return;
    }

    if (urlPath.startsWith("/assets/")) {
      const subPath = urlPath.slice("/assets/".length);
      // Only allow materials/*.png, images/*.png
      if (!/^(materials|images)\/[a-zA-Z0-9_.-]+\.(png|jpg|jpeg)$/.test(subPath)) {
        response.writeHead(403);
        response.end("Forbidden asset");
        return;
      }
      const assetFile = towerRoot ? path.join(towerRoot, "project", subPath) : null;
      if (assetFile && fs.existsSync(assetFile)) {
        const data = fs.readFileSync(assetFile);
        response.writeHead(200, {
          "Content-Type": subPath.endsWith(".png") ? "image/png" : "image/jpeg",
          "Content-Length": data.length,
          "Cache-Control": "public, max-age=86400"
        });
        response.end(data);
      } else {
        response.writeHead(404);
        response.end("Asset not found");
      }
      return;
    }

    if (urlPath === "/route.json") {
      try {
        const data = fs.readFileSync(path.join(runDir, "verified.route.json"));
        response.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": 'attachment; filename="verified.route.json"'
        });
        response.end(data);
      } catch (error) {
        response.writeHead(error.code === "ENOENT" ? 404 : 503, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: error.code === "ENOENT" ? "Not available yet" : "Temporarily unavailable" }));
      }
      return;
    }

    response.writeHead(404);
    response.end("Not found");
  });
}

if (require.main === module) {
  const args = argumentsOf(process.argv.slice(2));
  if (!args["run-dir"]) throw new Error("--run-dir= required");
  const port = Number(args.port || 8787);
  const towerRoot = args["tower-root"] ? path.resolve(args["tower-root"]) : null;
  createProgressServer(path.resolve(args["run-dir"]), { towerRoot }).listen(port, "127.0.0.1", () =>
    console.log(`Read-only progress with game board: http://127.0.0.1:${port}`)
  );
}

module.exports = { createProgressServer };
