"use strict";

const assert = require("node:assert");
const path = require("node:path");

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { runIterativeRouteRepair, replayRouteRecord } = require("./lib/iterative-route-repair");
const { loadProject } = require("./lib/project-loader");
const { readRouteFile } = require("./lib/route-store");
const { StaticSimulator } = require("./lib/simulator");

const PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const ROUTE_FILE = path.resolve(__dirname, "routes", "latest", "mt5-problem-before-9-10.route.json");

function main() {
  const project = loadProject(PROJECT_ROOT);
  const simulator = new StaticSimulator(project, {
    battleResolver: new FunctionBackedBattleResolver(project),
  });
  const route = readRouteFile(ROUTE_FILE);
  const result = runIterativeRouteRepair(project, simulator, route, {
    projectRoot: PROJECT_ROOT,
    maxRepairs: 1,
    maxDepth: 3,
    maxExpansions: 800,
    maxRuntimeMs: 1500,
  });
  assert.equal(result.finalRouteVerified, true, "iterative repair output must fully replay");
  const replay = replayRouteRecord(project, simulator, result.route, { projectRoot: PROJECT_ROOT });
  assert.equal(replay.ok, true, "rebuilt mt5 route must replay independently");
  if (result.acceptedCount > 0) {
    assert.ok(result.finalFinalHp > result.initialFinalHp, "accepted mt5 repair must improve final HP");
  }
  console.log(JSON.stringify({
    acceptedCount: result.acceptedCount,
    initialFinalHp: result.initialFinalHp,
    finalFinalHp: result.finalFinalHp,
    finalRouteVerified: result.finalRouteVerified,
    stoppedReason: result.stoppedReason,
  }, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  }
}

module.exports = { main };
