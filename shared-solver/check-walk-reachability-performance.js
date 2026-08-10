"use strict";

/**
 * TEST GRADE: diagnostic benchmark
 *
 * Runs the tracked MT4 -> MT5 entry branching workload in separate Node
 * processes with the explicit legacy rollback and the default safe-fast walk
 * mode.  Search/key work is fixed; exact final state, route, replay, and scale
 * parity are mandatory.  Timing is directional and never a correctness gate.
 */

const assert = require("node:assert");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const HARNESS = path.join(__dirname, "check-real-route-performance-qualification.js");
const CASE_ID = "mt4-manual-to-mt5-entry";

function runMode(mode) {
  const child = spawnSync(process.execPath, [
    HARNESS,
    `--case=${CASE_ID}`,
    "--order=B",
    "--max-expansions=100",
    `--walk-mode=${mode}`,
  ], {
    cwd: __dirname,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (child.status !== 0) {
    throw new Error(
      `walk benchmark ${mode} failed (${child.status}): ${child.stderr || child.stdout}`,
    );
  }
  const result = JSON.parse(child.stdout);
  return result.results[0].runs[0];
}

function compactRun(run) {
  return {
    mode: run.performance.walkReachabilityMode,
    wallMs: Number(run.performance.wallMs.toFixed(1)),
    reachabilityMs: Number(run.performance.reachabilityTotalMs.toFixed(1)),
    applyMs: Number(run.performance.applyMs.toFixed(1)),
    keyBuildMs: Number(run.performance.keyBuildMs.toFixed(1)),
    reachabilityComputations: run.performance.reachabilityComputations,
    reachabilityCache: run.performance.reachabilityCache,
    peakHeapUsedMb: Number(run.performance.peakHeapUsedMb.toFixed(1)),
    peakRssMb: Number(run.performance.peakRssMb.toFixed(1)),
    scale: run.scale,
    finalExactStateFingerprint: run.finalExactStateFingerprint,
    routeFingerprint: run.strictReplay.routeFingerprint,
    strictReplayVerified: run.strictReplay.verified,
  };
}

function main() {
  const legacy = runMode("legacy-exact");
  const fast = runMode("safe-fast");
  assert.ok(legacy.found && fast.found, "both walk modes must find the tracked route target");
  assert.ok(legacy.strictReplay.verified && fast.strictReplay.verified, "strict replay must pass in both modes");
  assert.strictEqual(fast.finalExactStateFingerprint, legacy.finalExactStateFingerprint, "final state parity");
  assert.strictEqual(fast.strictReplay.routeFingerprint, legacy.strictReplay.routeFingerprint, "route parity");
  assert.deepStrictEqual(fast.scale, legacy.scale, "fixed search scale parity");
  assert.strictEqual(legacy.performance.reachabilityCache.safeFastBuilds, 0, "rollback must not use fast path");
  assert.ok(fast.performance.reachabilityCache.safeFastBuilds > 0, "safe mode must exercise fast path");

  const wallFactor = fast.performance.wallMs / legacy.performance.wallMs;
  const reachabilityFactor = fast.performance.reachabilityTotalMs /
    legacy.performance.reachabilityTotalMs;
  process.stdout.write(`${JSON.stringify({
    schema: "motapathfinder.walk-reachability-performance.v1",
    status: "passed",
    workload: {
      caseId: CASE_ID,
      fixture: "mt1-mt4-hp4459-atk421-def318-mdef5012.route.json",
      keySide: "B-without-start-component-research-injection",
      maxExpansions: 100,
      independentProcesses: true,
      timingVerdict: "directional-not-pinned",
    },
    legacyExact: compactRun(legacy),
    safeFast: compactRun(fast),
    comparison: {
      exactFinalState: true,
      exactRoute: true,
      exactScale: true,
      strictReplayBoth: true,
      wallFactorSafeFastOverLegacy: Number(wallFactor.toFixed(3)),
      wallSpeedup: Number((1 / wallFactor).toFixed(2)),
      reachabilityFactorSafeFastOverLegacy: Number(reachabilityFactor.toFixed(3)),
      reachabilitySpeedup: Number((1 / reachabilityFactor).toFixed(2)),
    },
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main };
