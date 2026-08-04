"use strict";

const assert = require("node:assert");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const { ReplaySession } = require("./lib/replay-session");
const { findBrowserExecutable } = require("./lib/live-replay");
const { readRouteFile } = require("./lib/route-store");

const ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");
const SPEC_FILE = path.join(ROOT, "towers", "onlyup", "region-specs", "region-output-contract-smoke.json");
const OUTPUT_FILE = path.join(__dirname, "routes", "generated", "solver-model-runtime-boundary", "onlyup-smoke.route.json");

function runRouteGenerator() {
  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  const result = childProcess.spawnSync(process.execPath, [
    path.join(__dirname, "run-region-dp.js"),
    `--project-root=${PROJECT_ROOT}`,
    `--region-spec=${SPEC_FILE}`,
    `--out=${OUTPUT_FILE}`,
    "--max-expansions=1000",
    "--max-runtime-ms=10000",
    "--stop-on-first-goal=0",
    "--print-failures=0",
    "--structured-errors=1",
  ], {
    cwd: __dirname,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.strictEqual(
    result.status,
    0,
    `compact route generation failed: ${result.stderr || result.stdout}`,
  );
  assert.ok(fs.existsSync(OUTPUT_FILE), "compact route output must exist");
  return readRouteFile(OUTPUT_FILE);
}

async function main() {
  assert.ok(findBrowserExecutable(), "Chrome/Edge executable is required for compact-model live smoke");
  const routeRecord = runRouteGenerator();
  const modelMetadata = routeRecord.metadata || {};
  const startSnapshot = routeRecord.start && routeRecord.start.snapshot;
  assert.strictEqual(startSnapshot.partial, true, "solver start snapshot must be partial");
  assert.deepStrictEqual(
    modelMetadata.solverSnapshotHeroFields,
    ["hp", "atk", "def", "mdef", "lv", "exp", "equipment"],
    "route metadata must record active solver snapshot fields",
  );
  ["hpmax", "mana", "manamax", "money", "followers"].forEach((field) => {
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(startSnapshot.hero, field),
      false,
      `solver snapshot must omit disabled hero.${field}`,
    );
  });

  const session = new ReplaySession({
    routeRecord,
    projectRoot: PROJECT_ROOT,
    liveOptions: {
      headless: "1",
      keepOpen: false,
      stepDelayMs: 0,
      fastForwardDelayMs: 0,
      timeoutMs: 30000,
      runtimeAutoBattle: 1,
    },
  });
  try {
    await session.start({ fromStep: 1 });
    const paused = await session.getStatusAsync();
    assert.strictEqual(paused.state, "paused", "compact replay must pause at boundary");
    assert.strictEqual(paused.runtimeSnapshotIdentityMatches, true, "partial boundary comparison must pass");
    assert.strictEqual(paused.runtimeSnapshotComparisonKind, "partial-solver-vs-runtime-raw");
    assert.strictEqual(paused.runtimeSnapshotRawIdentityMatches, false, "partial and raw identities must remain distinct");
    assert.strictEqual(paused.runtimeProjectedSolverStateMatches, true, "compact projected solver identity must pass");

    const rawBoundary = await session.runtime.page.evaluate(() => {
      const hero = (core.status || {}).hero || {};
      return { hpmax: hero.hpmax, mana: hero.mana, manamax: hero.manamax, money: hero.money };
    });
    assert.strictEqual(rawBoundary.hpmax, 9999, "runtime hpmax must retain native value");
    assert.strictEqual(rawBoundary.manamax, -1, "runtime manamax must retain native value");
    assert.strictEqual(rawBoundary.mana, 0, "runtime mana must retain native value");
    assert.strictEqual(rawBoundary.money, 0, "runtime money must retain native value");
    assert.strictEqual(session.lastRuntimeSnapshot.hero.hpmax, 9999, "raw capture must retain hpmax");
    assert.strictEqual(session.lastRuntimeSnapshot.hero.manamax, -1, "raw capture must retain manamax");

    await session.play({ stepDelayMs: 0 });
    const completed = await session.getStatusAsync();
    assert.strictEqual(completed.state, "completed", "compact replay must complete");
    assert.strictEqual(completed.runtimeSnapshotIdentityMatches, true, "partial final comparison must pass");
    assert.strictEqual(completed.runtimeProjectedSolverStateMatches, true, "compact final projected identity must pass");
    const rawFinal = await session.runtime.page.evaluate(() => {
      const hero = (core.status || {}).hero || {};
      return { hpmax: hero.hpmax, mana: hero.mana, manamax: hero.manamax, money: hero.money };
    });
    assert.deepStrictEqual(rawFinal, rawBoundary, "disabled runtime fields must remain unchanged after replay");

    process.stdout.write(JSON.stringify({
      schema: "motapathfinder.pr-5.3a1-compact-runtime-boundary.v1",
      status: "passed",
      route: path.relative(ROOT, OUTPUT_FILE),
      solverModelFingerprint: modelMetadata.solverModelFingerprint,
      solverSnapshotHeroFields: modelMetadata.solverSnapshotHeroFields,
      boundary: {
        partial: startSnapshot.partial,
        runtimeSnapshotIdentityMatches: paused.runtimeSnapshotIdentityMatches,
        runtimeSnapshotRawIdentityMatches: paused.runtimeSnapshotRawIdentityMatches,
        runtimeProjectedSolverStateMatches: paused.runtimeProjectedSolverStateMatches,
        nativeHero: rawBoundary,
      },
      final: {
        state: completed.state,
        runtimeSnapshotIdentityMatches: completed.runtimeSnapshotIdentityMatches,
        runtimeProjectedSolverStateMatches: completed.runtimeProjectedSolverStateMatches,
        nativeHero: rawFinal,
      },
    }, null, 2) + "\n");
  } finally {
    await session.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}

module.exports = { main, runRouteGenerator };
