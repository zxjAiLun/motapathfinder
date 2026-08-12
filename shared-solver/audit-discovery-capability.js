"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  auditDiscoveryCapability,
  buildBlindDiscoverySpec,
} = require("./lib/discovery-capability-audit");

const DEFAULT_ROUTE_NAME = "onlyup-chaos-mt5-blueking";

function parseArgs(argv) {
  return argv.reduce((result, arg) => {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) result[match[1]] = match[2];
    return result;
  }, {});
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function main(argv) {
  const args = parseArgs(argv || process.argv.slice(2));
  const routeName = args["route-name"] || DEFAULT_ROUTE_NAME;
  const milestoneFile = path.resolve(__dirname, "milestones", `${routeName}.json`);
  if (!fs.existsSync(milestoneFile)) {
    throw new Error(`Unknown milestone route: ${routeName}`);
  }
  const rawSpec = JSON.parse(fs.readFileSync(milestoneFile, "utf8"));
  const options = {
    fromMilestoneId: args["from-milestone"] || null,
    targetMilestoneId: args["to-milestone"] || null,
    routeFixture: args["route-fixture"] || null,
  };
  const report = auditDiscoveryCapability(rawSpec, options);
  if (args["out-blind-spec"]) {
    writeJson(path.resolve(args["out-blind-spec"]), buildBlindDiscoverySpec(rawSpec, options));
  }
  if (args.out) writeJson(path.resolve(args.out), report);
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
