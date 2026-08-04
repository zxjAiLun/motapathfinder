"use strict";

const assert = require("node:assert");
const path = require("node:path");

const { findBrowserExecutable, replayRouteFile, verifyRouteObjective } = require("./lib/live-replay");
const { runObjectiveRoute } = require("./check-objective-spec-contract");

const ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");

async function main() {
  assert.ok(findBrowserExecutable(), "Chrome/Edge executable is required for ObjectiveSpec live replay");
  const route = runObjectiveRoute();
  await replayRouteFile(route, {
    projectRoot: PROJECT_ROOT,
    headless: "1",
    keepOpen: false,
    timeoutMs: 30000,
    stepDelayMs: 0,
    fastForwardDelayMs: 0,
    runtimeAutoBattle: 1,
  });
  const objective = verifyRouteObjective(route, route.final.snapshot, route.decisions.length);
  assert.strictEqual(objective.matches, true);
  process.stdout.write(JSON.stringify({
    schema: "motapathfinder.pr-5.3b-objective-live.v1",
    status: "passed",
    objectiveFingerprint: objective.fingerprint,
    finalObjectiveValue: objective.value,
    decisionCount: route.decisions.length,
    strictReplayRecomputed: true,
  }, null, 2) + "\n");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  });
}

module.exports = { main };
