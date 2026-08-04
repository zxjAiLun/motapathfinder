"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const { TowerRegistry } = require("./tower-registry");
const { createJobApi } = require("./job-api");
const { createRouter, serveLauncherStatic } = require("./router");
const { SolverJobManager } = require("../lib/solver-job-manager");
const { FileJobStore } = require("../lib/file-job-store");

const DEFAULT_TOWER_CONFIG = path.join(__dirname, "..", "launcher-towers.json");

function parseArgs(argv) {
  const args = {};
  for (const token of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(token);
    if (!match) continue;
    args[match[1]] = match[2];
  }
  return args;
}

function defaultTowerConfig() {
  const baseDir = path.resolve(__dirname, "..", "..");
  return {
    towers: [
      {
        id: "onlyup-v2.1",
        label: "Only Up V2.1",
        projectRoot: path.relative(baseDir, path.join(baseDir, "Only upV2.1", "Only upV2.1")),
        regionSpecRoot: path.relative(baseDir, path.join(baseDir, "towers", "onlyup", "region-specs")),
        rank: "chaos",
      },
    ],
  };
}

function createLauncherServer(options) {
  const config = options || {};
  const host = config.host || "127.0.0.1";
  const port = Number(config.port || 0);
  const jobsRoot = config.jobsRoot || path.join(__dirname, "..", "runs", "jobs");
  const maxConcurrentJobs = Math.max(1, Number(config.maxConcurrentJobs || 1));
  const uiRoot = config.uiRoot || path.join(__dirname, "ui");

  fs.mkdirSync(jobsRoot, { recursive: true });

  // Tower registry: use the provided config file, or write/use a default config
  // pointing at the canonical towers checked into the repo.
  let towerConfigPath = config.towerConfig || null;
  if (!towerConfigPath || !fs.existsSync(towerConfigPath)) {
    towerConfigPath = path.join(jobsRoot, "..", "launcher-towers.json");
    if (!fs.existsSync(towerConfigPath)) {
      fs.writeFileSync(towerConfigPath, `${JSON.stringify(defaultTowerConfig(), null, 2)}\n`, "utf8");
    }
  }
  const registry = new TowerRegistry({
    configPath: towerConfigPath,
    baseDir: path.resolve(__dirname, "..", ".."),
  });

  const jobStore = new FileJobStore({ root: jobsRoot });
  const manager = new SolverJobManager({
    maxConcurrentJobs,
    jobStore,
    context: {},
  });

  const api = createJobApi({ manager, jobStore, registry, context: {} });
  const routes = api.routes.concat([
    {
      method: "GET",
      pattern: "/",
      handler: ({ res }) => {
        const staticFile = serveLauncherStatic(uiRoot, "index.html");
        res.writeHead(200, { "Content-Type": staticFile.type });
        res.end(fs.readFileSync(staticFile.file));
      },
    },
    {
      method: "GET",
      pattern: "/:resource",
      handler: ({ res, params }) => {
        const staticFile = serveLauncherStatic(uiRoot, params.resource);
        if (!staticFile) {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("not found");
          return;
        }
        res.writeHead(200, { "Content-Type": staticFile.type });
        res.end(fs.readFileSync(staticFile.file));
      },
    },
  ]);
  const router = createRouter(routes);
  const server = http.createServer(router);

  return {
    server,
    manager,
    jobStore,
    registry,
    host,
    port,
    async listen() {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => resolve());
      });
      return server.address().port;
    },
    async close() {
      await new Promise((resolve) => {
        server.close(() => resolve());
        setTimeout(resolve, 2000);
      });
    },
  };
}

module.exports = { createLauncherServer, defaultTowerConfig, parseArgs };
