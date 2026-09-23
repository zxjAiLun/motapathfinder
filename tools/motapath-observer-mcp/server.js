#!/usr/bin/env node
"use strict";

const http = require("node:http");
const readline = require("node:readline");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");

const { TOOL_DEFINITIONS } = require("./lib/tool-definitions");
const core = require("./lib/observer-core");
const { resolveGitSha } = require("./lib/provenance");

function parseArgs(argv) {
  const args = {};
  for (const raw of argv) {
    const match = raw.match(/^--([^=]+)(?:=(.*))?$/);
    if (!match) continue;
    args[match[1]] = match[2] == null ? "1" : match[2];
  }
  return args;
}

function findDefaultPaths() {
  const cwd = process.cwd();
  // Check if we are inside tools/motapath-observer-mcp or repo root or /home/ubuntu/motapath-solver
  let repoRoot = cwd;
  if (fs.existsSync(path.join(cwd, "../../shared-solver"))) {
    repoRoot = path.resolve(cwd, "../..");
  } else if (fs.existsSync(path.join(cwd, "shared-solver"))) {
    repoRoot = cwd;
  }

  let runsRoot = path.join(repoRoot, "runs");
  if (!fs.existsSync(runsRoot) && fs.existsSync("/home/ubuntu/motapath-solver/runs")) {
    runsRoot = "/home/ubuntu/motapath-solver/runs";
  }

  let defaultRunDir = path.join(runsRoot, "neko-zero-key");
  if (!fs.existsSync(defaultRunDir)) {
    // Try to find any run folder under runsRoot
    if (fs.existsSync(runsRoot)) {
      const dirs = fs.readdirSync(runsRoot, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith("."));
      if (dirs.length) defaultRunDir = path.join(runsRoot, dirs[0].name);
    }
  }

  let releaseDir = null;
  const releasesPath = path.join(path.dirname(runsRoot), "releases");
  if (fs.existsSync(releasesPath)) {
    const rels = fs.readdirSync(releasesPath, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith("."));
    if (rels.length) {
      // Pick latest by name
      rels.sort((a, b) => b.name.localeCompare(a.name));
      releaseDir = path.join(releasesPath, rels[0].name);
    }
  }

  return {
    repoRoot,
    runsRoot,
    defaultRunDir,
    releaseDir,
  };
}

async function handleJsonRpc(context, request) {
  const { jsonrpc, id, method, params } = request;
  if (jsonrpc !== "2.0") {
    return { jsonrpc: "2.0", id: id || null, error: { code: -32600, message: "Invalid Request: expected jsonrpc 2.0" } };
  }

  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        serverInfo: {
          name: "motapath-observer-mcp",
          version: "1.0.0",
        },
        capabilities: {
          tools: {},
        },
      },
    };
  }

  if (method === "notifications/initialized") {
    // Notifications do not have response
    return null;
  }

  if (method === "ping") {
    return { jsonrpc: "2.0", id, result: {} };
  }

  if (method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        tools: TOOL_DEFINITIONS,
      },
    };
  }

  if (method === "tools/call") {
    const { name, arguments: args = {} } = params || {};
    try {
      let data = null;
      switch (name) {
        case "get_runtime_status":
          data = core.getRuntimeStatus(context, args);
          break;
        case "list_durable_nodes":
          data = core.listDurableNodes(context, args);
          break;
        case "get_durable_node":
          data = core.getDurableNode(context, args.node_id, args);
          break;
        case "get_attempt_history":
          data = core.getAttemptHistory(context, args);
          break;
        case "get_search_diagnostics":
          data = core.getSearchDiagnostics(context, args);
          break;
        case "analyze_stage_candidates":
          data = core.analyzeStageCandidates(context, args);
          break;
        case "inspect_frontier_snapshot":
          data = core.inspectFrontierSnapshot(context, args);
          break;
        case "read_artifact":
          data = core.readArtifact(context, args);
          break;
        case "read_bounded_log":
          data = core.readBoundedLog(context, args);
          break;
        default:
          return {
            jsonrpc: "2.0",
            id,
            error: {
              code: -32601,
              message: `Unknown tool: ${name}`,
            },
          };
      }

      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
            },
          ],
        },
      };
    } catch (err) {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          isError: true,
          content: [
            {
              type: "text",
              text: `Error executing tool '${name}': ${err.message}`,
            },
          ],
        },
      };
    }
  }

  return {
    jsonrpc: "2.0",
    id,
    error: {
      code: -32601,
      message: `Method not found: ${method}`,
    },
  };
}

function runStdio(context) {
  process.stderr.write("[motapath-observer-mcp] Starting in stdio mode...\n");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      const parsed = JSON.parse(trimmed);
      const response = await handleJsonRpc(context, parsed);
      if (response) {
        process.stdout.write(`${JSON.stringify(response)}\n`);
      }
    } catch (err) {
      process.stdout.write(`${JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: `Parse error: ${err.message}` },
      })}\n`);
    }
  });
}

function createHttpServer(context, options = {}) {
  const { port = 8788, host = "127.0.0.1", authToken = null } = options;
  const sseSessions = new Map(); // sessionId -> response object

  const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const [urlPath, queryStr] = (req.url || "/").split("?");
    const queryParams = new URLSearchParams(queryStr || "");

    // Health check endpoint (no auth required)
    if (urlPath === "/health") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        status: "ok",
        service: "motapath-observer-mcp",
        uptime_seconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
      }));
      return;
    }

    // Authenticate if authToken is configured
    if (authToken) {
      const authHeader = req.headers.authorization || "";
      const expected = `Bearer ${authToken}`;
      if (authHeader !== expected) {
        res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({
          error: "Unauthorized: valid Bearer token required in Authorization header",
        }));
        return;
      }
    }

    // SSE endpoint (GET /sse)
    if (req.method === "GET" && (urlPath === "/sse" || urlPath === "/events")) {
      const sessionId = crypto.randomUUID();
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });

      sseSessions.set(sessionId, res);

      // Send endpoint event per MCP SSE spec
      const endpointUri = `/messages?sessionId=${sessionId}`;
      res.write(`event: endpoint\ndata: ${endpointUri}\n\n`);

      req.on("close", () => {
        sseSessions.delete(sessionId);
      });
      return;
    }

    // Message endpoint for SSE session (POST /messages?sessionId=...)
    if (req.method === "POST" && urlPath === "/messages") {
      const sessionId = queryParams.get("sessionId");
      const sseRes = sessionId ? sseSessions.get(sessionId) : null;

      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", async () => {
        try {
          const jsonRpcReq = JSON.parse(body);
          const jsonRpcRes = await handleJsonRpc(context, jsonRpcReq);

          if (jsonRpcRes) {
            // If SSE session exists, emit through SSE
            if (sseRes) {
              sseRes.write(`event: message\ndata: ${JSON.stringify(jsonRpcRes)}\n\n`);
            }
            // Also return JSON response
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify(jsonRpcRes));
          } else {
            res.writeHead(202);
            res.end();
          }
        } catch (err) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32700, message: `Parse error: ${err.message}` },
          }));
        }
      });
      return;
    }

    // Streamable HTTP endpoint (POST /mcp or POST /)
    if (req.method === "POST" && (urlPath === "/mcp" || urlPath === "/rpc" || urlPath === "/")) {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", async () => {
        try {
          const jsonRpcReq = JSON.parse(body);
          const jsonRpcRes = await handleJsonRpc(context, jsonRpcReq);

          const acceptHeader = req.headers.accept || "";
          if (acceptHeader.includes("text/event-stream")) {
            // Client requested event-stream streaming
            res.writeHead(200, {
              "Content-Type": "text/event-stream; charset=utf-8",
              "Cache-Control": "no-cache",
              "Connection": "keep-alive",
            });
            if (jsonRpcRes) {
              res.write(`event: message\ndata: ${JSON.stringify(jsonRpcRes)}\n\n`);
            }
            res.end();
          } else {
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify(jsonRpcRes || {}));
          }
        } catch (err) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32700, message: `Parse error: ${err.message}` },
          }));
        }
      });
      return;
    }

    // Fallback info page
    if (req.method === "GET" && (urlPath === "/" || urlPath === "/info")) {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        name: "motapath-observer-mcp",
        version: "1.0.0",
        description: "Strictly read-only observer MCP server for motapath durable solver",
        endpoints: {
          mcp: "POST /mcp",
          sse: "GET /sse",
          health: "GET /health",
        },
        tools_available: TOOL_DEFINITIONS.length,
      }, null, 2));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  server.listen(port, host, () => {
    console.log(`[motapath-observer-mcp] Server running at http://${host}:${port}`);
    console.log(`[motapath-observer-mcp] Endpoints:`);
    console.log(`  Streamable HTTP: POST http://${host}:${port}/mcp`);
    console.log(`  SSE Transport:   GET  http://${host}:${port}/sse`);
    console.log(`  Health Check:    GET  http://${host}:${port}/health`);
    console.log(`[motapath-observer-mcp] Auth: ${authToken ? "Bearer token enabled" : "Disabled (loopback / trusted network)"}`);
    console.log(`[motapath-observer-mcp] Primary Run Dir: ${context.runDir}`);
  });

  return server;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args.h) {
    console.log([
      "Usage: node server.js [options]",
      "",
      "Options:",
      "  --port=<port>       HTTP/SSE port (default: 8788 or OBSERVER_MCP_PORT)",
      "  --host=<host>       HTTP/SSE bind host (default: 127.0.0.1 or OBSERVER_MCP_HOST)",
      "  --run-dir=<dir>     Path to solver run directory",
      "  --runs-root=<dir>   Path to root of all runs",
      "  --repo-root=<dir>   Path to repository root",
      "  --release-dir=<dir> Path to solver release directory",
      "  --token=<token>     Bearer auth token (or OBSERVER_MCP_AUTH_TOKEN)",
      "  --stdio             Run in stdio mode instead of HTTP",
      "  --help, -h          Show this help message",
    ].join("\n"));
    return;
  }

  const defaults = findDefaultPaths();

  const context = {
    repoRoot: args["repo-root"] ? path.resolve(args["repo-root"]) : defaults.repoRoot,
    runsRoot: args["runs-root"] ? path.resolve(args["runs-root"]) : defaults.runsRoot,
    runDir: args["run-dir"] ? path.resolve(args["run-dir"]) : defaults.defaultRunDir,
    runId: args["run-dir"] ? path.basename(args["run-dir"]) : path.basename(defaults.defaultRunDir),
    releaseDir: args["release-dir"] ? path.resolve(args["release-dir"]) : defaults.releaseDir,
    releaseId: args["release-dir"] ? path.basename(args["release-dir"]) : (defaults.releaseDir ? path.basename(defaults.releaseDir) : null),
    gitSha: resolveGitSha(args["repo-root"] || defaults.repoRoot),
  };

  if (args.stdio) {
    runStdio(context);
  } else {
    const port = Number(args.port || process.env.OBSERVER_MCP_PORT || 8788);
    const host = args.host || process.env.OBSERVER_MCP_HOST || "127.0.0.1";
    const authToken = args.token || process.env.OBSERVER_MCP_AUTH_TOKEN || null;

    createHttpServer(context, { port, host, authToken });
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  createHttpServer,
  handleJsonRpc,
  findDefaultPaths,
  parseArgs,
};
