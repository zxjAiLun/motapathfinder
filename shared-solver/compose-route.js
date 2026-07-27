"use strict";

const childProcess = require("node:child_process");
const path = require("node:path");

const {
  composeRouteRecords,
  readRouteFile,
  writeRouteFile,
} = require("./lib/route-store");

function parseArgs(argv) {
  return argv.reduce((result, arg) => {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) result[match[1]] = match[2];
    return result;
  }, {});
}

function currentCommit() {
  const result = childProcess.spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8",
    windowsHide: true,
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function requiredPath(args, name) {
  if (!args[name]) throw new Error(`Missing --${name}=...`);
  return path.resolve(args[name]);
}

function main(argv) {
  const args = parseArgs(argv || process.argv.slice(2));
  const prefixFile = requiredPath(args, "prefix");
  const suffixFile = requiredPath(args, "suffix");
  const outFile = requiredPath(args, "out");
  const composed = composeRouteRecords(
    readRouteFile(prefixFile),
    readRouteFile(suffixFile),
    {
      commit: currentCommit(),
      prefixFile,
      suffixFile,
    },
  );
  writeRouteFile(outFile, composed);
  console.log(JSON.stringify({
    outFile,
    prefixFile,
    suffixFile,
    decisionCount: composed.decisions.length,
    boundaryExactStateKey: composed.metadata.composedFrom.boundaryExactStateKey,
    sourceCommit: composed.source.commit,
  }, null, 2));
}

if (require.main === module) main();

module.exports = { main, parseArgs };
