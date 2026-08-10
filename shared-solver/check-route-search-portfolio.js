"use strict";

const assert = require("node:assert");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { performance } = require("node:perf_hooks");

const HARNESS = path.join(__dirname, "check-real-route-performance-qualification.js");
const DEFAULT_CASES = ["mt2-to-mt3-i893", "mt4-manual-to-mt5-entry"];

function parseArgs(argv) {
  const result = {};
  argv.forEach((arg) => {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) result[match[1]] = match[2];
  });
  return result;
}

function runCase(caseId) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      HARNESS,
      `--case=${caseId}`,
      "--order=A",
      "--max-expansions=100",
      "--walk-mode=safe-fast",
      "--search-intent=first-feasible",
    ], {
      cwd: __dirname,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${caseId} exited ${code}: ${stderr || stdout}`));
        return;
      }
      try {
        const report = JSON.parse(stdout);
        const run = report.results[0].runs[0];
        assert.strictEqual(run.found, true, `${caseId} must be found`);
        assert.strictEqual(run.strictReplay.verified, true, `${caseId} strict replay`);
        resolve({
          caseId,
          found: run.found,
          exactStateFingerprint: run.finalExactStateFingerprint,
          routeFingerprint: run.strictReplay.routeFingerprint,
          childWallMs: run.performance.wallMs,
          expanded: run.scale.expanded,
          goalProjectionCache: run.scale.goalProjectionCache,
          peakRssMb: run.performance.peakRssMb,
        });
      } catch (error) {
        reject(new Error(`${caseId} invalid result: ${error.message}\n${stdout}`));
      }
    });
  });
}

async function runWithJobs(caseIds, jobs) {
  const startedAt = performance.now();
  const results = new Array(caseIds.length);
  let cursor = 0;
  async function worker() {
    while (cursor < caseIds.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await runCase(caseIds[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(jobs, caseIds.length) }, () => worker()),
  );
  const wallMs = performance.now() - startedAt;
  return {
    jobs,
    wallMs,
    sumChildWallMs: results.reduce((sum, entry) => sum + entry.childWallMs, 0),
    results,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const caseIds = String(args.cases || DEFAULT_CASES.join(",")).split(",").filter(Boolean);
  const parallelJobs = Math.max(1, Math.floor(Number(args.jobs || 2)));
  const serial = await runWithJobs(caseIds, 1);
  const parallel = await runWithJobs(caseIds, parallelJobs);
  assert.deepStrictEqual(
    parallel.results.map((entry) => [entry.caseId, entry.exactStateFingerprint, entry.routeFingerprint]),
    serial.results.map((entry) => [entry.caseId, entry.exactStateFingerprint, entry.routeFingerprint]),
    "serial and parallel portfolios must produce exact route/state parity",
  );
  process.stdout.write(`${JSON.stringify({
    schema: "motapathfinder.route-search-portfolio.v1",
    status: "passed",
    isolation: "independent-process-per-route-case",
    cases: caseIds,
    serial,
    parallel,
    comparison: {
      exactParity: true,
      wallSpeedup: parallel.wallMs > 0 ? serial.wallMs / parallel.wallMs : null,
      wallMsSaved: serial.wallMs - parallel.wallMs,
    },
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
