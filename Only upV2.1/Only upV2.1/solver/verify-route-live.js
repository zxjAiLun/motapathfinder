"use strict";

const path = require("path");

const fs = require("fs");

const { replayRouteRecordLive } = require("./lib/live-replay");
const { parseKeyValueArgs, resolveProjectRoot } = require("./lib/cli-options");
const { readRouteFile } = require("./lib/route-store");
const { main: oldMain } = require("./verify-mt1-mt3-live");

async function main() {
  const args = parseKeyValueArgs(process.argv.slice(2));
  args.projectRoot = resolveProjectRoot(args, path.resolve(__dirname, ".."));
  if (args["route-file"]) {
    const routeFile = resolveRouteFile(args["route-file"]);
    const routeRecord = readRouteFile(routeFile);
    console.log(`Replaying saved route file: ${routeFile}`);
    await replayRouteRecordLive(routeRecord, args);
    return;
  }
  await oldMain();
}

function resolveRouteFile(routeFile) {
  if (path.isAbsolute(routeFile)) return routeFile;
  const cwdPath = path.resolve(process.cwd(), routeFile);
  if (fs.existsSync(cwdPath)) return cwdPath;
  const solverPath = path.resolve(__dirname, routeFile);
  if (fs.existsSync(solverPath)) return solverPath;
  return solverPath;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  main,
};
