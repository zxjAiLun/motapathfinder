"use strict";

const path = require("path");

const fs = require("fs");

const { replayRouteRecordLive } = require("./lib/live-replay");
const { readRouteFile } = require("./lib/route-store");
const { main: oldMain } = require("./verify-mt1-mt3-live");

function parseArgs(argv) {
  return argv.reduce((result, token) => {
    const flag = token.match(/^--([^=]+)$/);
    if (flag) {
      result[flag[1]] = "1";
      return result;
    }
    const match = token.match(/^--([^=]+)=(.*)$/);
    if (match) result[match[1]] = match[2];
    return result;
  }, {});
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
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
