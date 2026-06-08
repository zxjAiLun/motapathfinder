"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { parseKeyValueArgs, parseListFlag, resolveProjectRoot } = require("./lib/cli-options");
const { loadProject } = require("./lib/project-loader");
const { readRouteFile } = require("./lib/route-store");
const { buildRouteTimeline } = require("./lib/route-debugger");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { StaticSimulator } = require("./lib/simulator");

function resolveRouteFile(value) {
  if (!value) throw new Error("Missing --route=<file> or --route-file=<file>.");
  return path.resolve(process.cwd(), value);
}

function defaultOutFile(routeFile) {
  const base = path.basename(routeFile, ".route.json");
  return path.resolve(__dirname, "routes", "debug", `${base}.timeline.json`);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function makeSimulator(project) {
  return new StaticSimulator(project, {
    stopFloorId: null,
    battleResolver: new FunctionBackedBattleResolver(project),
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFightToLevelUp: false,
    enableResourcePocket: false,
    enableResourceCluster: false,
    enableResourceChain: false,
    searchGraphMode: "primitive",
  });
}

function main() {
  const args = parseKeyValueArgs(process.argv.slice(2));
  const projectRoot = resolveProjectRoot(
    args,
    path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1"),
  );
  const routeFile = resolveRouteFile(args.route || args["route-file"]);
  const outFile = path.resolve(process.cwd(), args.out || defaultOutFile(routeFile));
  const project = loadProject(projectRoot);
  const simulator = makeSimulator(project);
  const routeRecord = readRouteFile(routeFile);
  const floorIds = parseListFlag(args["snapshot-floors"]);
  const timeline = buildRouteTimeline(project, simulator, routeRecord, {
    routeFile,
    snapshotFloorIds: floorIds.length > 0 ? floorIds : undefined,
    battleOverlay: args["battle-overlay"] || "visible",
    actionInspector: args["action-inspector"] || "visible",
    candidateLimit: args["candidate-limit"],
    stopOnError: args["stop-on-error"] !== "0",
    includeStack: args["include-stack"] === "1",
  });
  writeJson(outFile, timeline);
  console.log(`Route timeline written: ${outFile}`);
  console.log(
    `steps=${timeline.stats.stepCount}, decisions=${timeline.stats.decisionCount}, error=${timeline.stats.endedWithError}`,
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  }
}

module.exports = {
  main,
};
