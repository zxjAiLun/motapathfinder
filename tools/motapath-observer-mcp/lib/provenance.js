"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { execSync } = require("node:child_process");

const shaCache = new Map(); // key: `${filePath}:${mtimeMs}:${size}` -> sha256 hex
let cachedGitSha = null;

function computeSha256(filePathOrBuffer) {
  if (Buffer.isBuffer(filePathOrBuffer) || typeof filePathOrBuffer === "string" && !fs.existsSync(filePathOrBuffer)) {
    return crypto.createHash("sha256").update(filePathOrBuffer).digest("hex");
  }

  const filePath = path.resolve(filePathOrBuffer);
  try {
    const stat = fs.statSync(filePath);
    const cacheKey = `${filePath}:${stat.mtimeMs}:${stat.size}`;
    const cached = shaCache.get(cacheKey);
    if (cached) return cached;

    const hash = crypto.createHash("sha256");
    const buffer = fs.readFileSync(filePath);
    hash.update(buffer);
    const digest = hash.digest("hex");

    if (shaCache.size > 200) {
      const firstKey = shaCache.keys().next().value;
      shaCache.delete(firstKey);
    }
    shaCache.set(cacheKey, digest);
    return digest;
  } catch (error) {
    return null;
  }
}

function resolveGitSha(repoRoot) {
  if (cachedGitSha) return cachedGitSha;
  try {
    const stdout = execSync("git rev-parse HEAD", {
      cwd: repoRoot || process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
    });
    cachedGitSha = stdout.trim();
    return cachedGitSha;
  } catch (e) {
    // Check if there is a release manifest or derivation file with git sha or bundle hash
    const manifestPath = path.join(repoRoot || process.cwd(), "bundle-manifest.json");
    if (fs.existsSync(manifestPath)) {
      try {
        const hash = computeSha256(manifestPath);
        return `bundle-${hash.slice(0, 12)}`;
      } catch (err) {}
    }
    return "unknown";
  }
}

function getHostName() {
  return os.hostname();
}

function buildProvenance({ host, runId, releaseId, gitSha, file, filePath, mtime }) {
  let fileSha = null;
  let fileMtime = mtime || null;
  let relFile = file;

  if (filePath && fs.existsSync(filePath)) {
    try {
      const stat = fs.statSync(filePath);
      fileMtime = fileMtime || stat.mtime.toISOString();
      fileSha = computeSha256(filePath);
      if (!relFile) {
        relFile = path.basename(filePath);
      }
    } catch (e) {}
  }

  return {
    host: host || getHostName(),
    run_id: runId || null,
    release_id: releaseId || null,
    git_sha: gitSha || resolveGitSha(),
    file: relFile || null,
    file_sha256: fileSha || null,
    mtime: fileMtime || null,
    read_at: new Date().toISOString(),
  };
}

module.exports = {
  computeSha256,
  resolveGitSha,
  getHostName,
  buildProvenance,
};
