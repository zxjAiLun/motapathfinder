"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { runBlindDiscoveryBaseline } = require("./lib/blind-discovery-baseline");

const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const DEFAULT_GOAL_FILE = path.resolve(__dirname, "blind-goals", "onlyup-mt5-blueking.json");

function parseArgs(argv) {
  return argv.reduce((result, arg) => {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) result[match[1]] = match[2];
    return result;
  }, {});
}

function optionalNumber(value, fallback) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function main(argv) {
  const args = parseArgs(argv || process.argv.slice(2));
  const report = runBlindDiscoveryBaseline({
    goalFile: path.resolve(args["goal-file"] || DEFAULT_GOAL_FILE),
    projectRoot: path.resolve(args["project-root"] || DEFAULT_PROJECT_ROOT),
    maxExpansions: optionalNumber(args["max-expansions"], 1000),
    maxHeapMb: optionalNumber(args["max-heap-mb"], 2048),
    maxRssMb: optionalNumber(args["max-rss-mb"], 0),
    candidateLimit: optionalNumber(args["candidate-limit"], 8),
    goalSkylineLimit: optionalNumber(args["goal-skyline-limit"], 8),
  });
  if (args.out) {
    const output = path.resolve(args.out);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  }
}

module.exports = { main, parseArgs };
