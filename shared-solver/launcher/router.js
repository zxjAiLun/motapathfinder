"use strict";

const path = require("node:path");
const fs = require("node:fs");

function matchRoute(pattern, pathname) {
  const patternParts = String(pattern).split("/").filter(Boolean);
  const pathParts = pathname.split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;
  if (patternParts.some((part, index) => part === "*")) {
    // wildcard terminal pattern (OPTIONS /api/*)
    if (patternParts[patternParts.length - 1] !== "*") return null;
    if (!pathname.startsWith("/api/")) return null;
    return {};
  }
  const params = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const patternPart = patternParts[index];
    if (patternPart.startsWith(":")) {
      params[patternPart.slice(1)] = decodeURIComponent(pathParts[index]);
    } else if (patternPart !== pathParts[index]) {
      return null;
    }
  }
  return params;
}

function createRouter(routes) {
  return async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const pathname = url.pathname;
    for (const route of routes) {
      if (route.method !== req.method) continue;
      const params = matchRoute(route.pattern, pathname);
      if (params === null) continue;
      try {
        await route.handler({ req, res, params, query: url.searchParams });
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(`${JSON.stringify({ failure: { failureClass: "INTERNAL_ERROR", message: error.message } })}\n`);
      }
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(`${JSON.stringify({ failure: { failureClass: "NOT_FOUND", message: `not found: ${req.method} ${pathname}` } })}\n`);
  };
}

function serveLauncherStatic(uiRoot, resourcePath) {
  const allowed = new Set(["index.html", "app.js", "style.css"]);
  if (!allowed.has(resourcePath)) return null;
  const file = path.join(uiRoot, resourcePath);
  if (!fs.existsSync(file)) return null;
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
  };
  return { file, type: types[path.extname(file)] || "application/octet-stream" };
}

module.exports = { createRouter, matchRoute, serveLauncherStatic };
