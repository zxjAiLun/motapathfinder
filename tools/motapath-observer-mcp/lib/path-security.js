"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { computeSha256 } = require("./provenance");

const DEFAULT_MAX_BYTES = 262144; // 256 KB
const HARD_MAX_BYTES = 1048576;   // 1 MB

const FORBIDDEN_FILE_PATTERNS = [
  /\.env(\..+)?$/i,
  /\.ssh/i,
  /\.git(\/|\\)/i,
  /id_rsa/i,
  /id_ed25519/i,
  /credentials/i,
  /token/i,
  /secret/i,
  /password/i,
  /\/etc\//i,
  /\\etc\\/i,
];

function sanitizeIdentifier(id) {
  if (!id || typeof id !== "string") return "";
  // Check for path traversal or dangerous characters
  if (id.includes("..") || id.includes("/") || id.includes("\\") || id.includes("\0")) {
    throw new Error(`Invalid identifier containing path separators or traversal: ${id}`);
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(id)) {
    throw new Error(`Invalid characters in identifier: ${id}`);
  }
  return id;
}

function assertSafePath(targetPath, allowedRoots = []) {
  const resolved = path.resolve(targetPath);

  // Check forbidden patterns
  for (const pattern of FORBIDDEN_FILE_PATTERNS) {
    if (pattern.test(resolved)) {
      throw new Error(`Access forbidden to path matching security blacklist: ${resolved}`);
    }
  }

  // Ensure path is within at least one allowed root
  const inAllowedRoot = allowedRoots.some((root) => {
    const resolvedRoot = path.resolve(root);
    const rel = path.relative(resolvedRoot, resolved);
    return !rel.startsWith("..") && !path.isAbsolute(rel);
  });

  if (!inAllowedRoot) {
    throw new Error(`Access denied: path is outside allowed root directories (${resolved})`);
  }

  return resolved;
}

function resolveArtifactPath(artifactType, id, context) {
  const { runDir, repoRoot, releaseDir } = context;
  const safeId = id ? sanitizeIdentifier(id) : null;

  let candidatePath = null;
  const allowedRoots = [runDir, repoRoot, releaseDir].filter(Boolean);

  switch (artifactType) {
    case "status":
      candidatePath = path.join(runDir, "status.json");
      break;
    case "journal":
      candidatePath = path.join(runDir, "journal.json");
      break;
    case "preview":
      if (safeId) {
        candidatePath = path.join(runDir, "previews", safeId.endsWith(".json") ? safeId : `${safeId}.preview.json`);
        if (!fs.existsSync(candidatePath)) {
          candidatePath = path.join(runDir, "previews", `${safeId}.json`);
        }
      } else {
        candidatePath = path.join(runDir, "preview.json");
      }
      break;
    case "task":
      if (!safeId) throw new Error("Task artifact requires an id (e.g. 0-0786ff07331034bd3fc475df-0)");
      candidatePath = path.join(runDir, "tasks", safeId.endsWith(".json") ? safeId : `${safeId}.json`);
      break;
    case "attempt":
      if (!safeId) throw new Error("Attempt artifact requires an id");
      candidatePath = path.join(runDir, "attempts", safeId.endsWith(".json") ? safeId : `${safeId}.json`);
      break;
    case "state":
      if (!safeId) throw new Error("State artifact requires a node/checkpoint id");
      candidatePath = path.join(runDir, "states", safeId.endsWith(".json") ? safeId : `${safeId}.json`);
      break;
    case "route":
      if (safeId) {
        if (repoRoot) candidatePath = path.join(repoRoot, "routes/generated", safeId.endsWith(".json") ? safeId : `${safeId}.json`);
        if (!candidatePath || !fs.existsSync(candidatePath)) {
          candidatePath = path.join(runDir, safeId.endsWith(".json") ? safeId : `${safeId}.json`);
        }
      } else {
        candidatePath = path.join(runDir, "verified.route.json");
      }
      break;
    case "probe":
      if (!safeId) throw new Error("Probe artifact requires a name (e.g. 256k, 128k)");
      candidatePath = path.join(runDir, safeId.endsWith(".json") ? safeId : `${safeId}.json`);
      break;
    case "manifest":
      if (safeId === "solver" && repoRoot) {
        candidatePath = path.join(repoRoot, "shared-solver/solver-manifest.json");
      } else if (releaseDir) {
        candidatePath = path.join(releaseDir, safeId === "derivation" ? "release-derivation.json" : (safeId === "bundle" ? "bundle-manifest.json" : "release-manifest.json"));
      } else if (repoRoot) {
        candidatePath = path.join(repoRoot, "shared-solver/solver-manifest.json");
      }
      break;
    case "log":
      if (safeId) {
        candidatePath = path.join(runDir, safeId.endsWith(".log") ? safeId : `${safeId}.log`);
      } else {
        candidatePath = path.join(runDir, "worker.log");
      }
      break;
    default:
      throw new Error(`Unknown artifact type: ${artifactType}. Allowed: status, journal, preview, task, attempt, state, route, probe, manifest, log`);
  }

  if (!candidatePath) {
    throw new Error(`Could not resolve candidate path for artifact type: ${artifactType}`);
  }

  return assertSafePath(candidatePath, allowedRoots);
}

function readBoundedFile(filePath, maxBytes = DEFAULT_MAX_BYTES) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${path.basename(resolved)}`);
  }

  const stat = fs.statSync(resolved);
  const boundedMax = Math.min(Math.max(1024, Number(maxBytes) || DEFAULT_MAX_BYTES), HARD_MAX_BYTES);
  const toRead = Math.min(stat.size, boundedMax);
  const buffer = Buffer.alloc(toRead);

  const fd = fs.openSync(resolved, "r");
  try {
    fs.readSync(fd, buffer, 0, toRead, 0);
  } finally {
    fs.closeSync(fd);
  }

  const truncated = stat.size > boundedMax;
  const sha256 = computeSha256(resolved);

  return {
    path: resolved,
    size_bytes: stat.size,
    read_bytes: toRead,
    truncated,
    mtime: stat.mtime.toISOString(),
    sha256,
    content: buffer.toString("utf8"),
  };
}

function readTailLines(filePath, maxLines = 100, pattern = null) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${path.basename(resolved)}`);
  }

  const stat = fs.statSync(resolved);
  if (stat.size === 0) {
    return { lines: [], total_lines: 0, truncated: false };
  }

  // Read up to last 256KB for tail scanning
  const readSize = Math.min(stat.size, DEFAULT_MAX_BYTES);
  const buffer = Buffer.alloc(readSize);
  const offset = stat.size - readSize;

  const fd = fs.openSync(resolved, "r");
  try {
    fs.readSync(fd, buffer, 0, readSize, offset);
  } finally {
    fs.closeSync(fd);
  }

  let text = buffer.toString("utf8");
  // If offset > 0, the first line might be incomplete; drop it
  if (offset > 0) {
    const firstNewline = text.indexOf("\n");
    if (firstNewline !== -1) {
      text = text.slice(firstNewline + 1);
    }
  }

  let lines = text.split(/\r?\n/).filter((l) => l.length > 0);

  if (pattern) {
    const regex = new RegExp(pattern, "i");
    lines = lines.filter((line) => regex.test(line));
  }

  const boundedLines = lines.slice(-Math.min(maxLines, 500));

  return {
    lines: boundedLines,
    returned_lines: boundedLines.length,
    total_available_lines: lines.length,
    file_size_bytes: stat.size,
    truncated_by_buffer: offset > 0,
    mtime: stat.mtime.toISOString(),
  };
}

module.exports = {
  DEFAULT_MAX_BYTES,
  HARD_MAX_BYTES,
  sanitizeIdentifier,
  assertSafePath,
  resolveArtifactPath,
  readBoundedFile,
  readTailLines,
};
