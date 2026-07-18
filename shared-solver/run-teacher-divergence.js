"use strict";

/**
 * CLI: teacher-forced divergence audit (test-side diagnostics).
 *
 * Example:
 *   node run-teacher-divergence.js \
 *     --route=routes/fixtures/mt1-mt3-i893-hp8425.route.json \
 *     --out=routes/generated/teacher-divergence.report.json
 *
 * Production search must never consume teacher actions from this report.
 */

const fs = require("node:fs");
const path = require("node:path");

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const {
  parseBooleanFlag,
  parseKeyValueArgs,
  parseOptionalNumber,
} = require("./lib/cli-options");
const { loadProject } = require("./lib/project-loader");
const { readRouteFile } = require("./lib/route-store");
const { StaticSimulator } = require("./lib/simulator");
const {
  formatDivergenceReport,
  runTeacherDivergenceAudit,
} = require("./lib/teacher-divergence-audit");

function resolveMaybe(value) {
  if (!value) return null;
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}

function main(argv) {
  const args = parseKeyValueArgs(argv);

  const projectRoot = resolveMaybe(args["project-root"])
    || path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
  const routePath = resolveMaybe(args.route)
    || path.join(__dirname, "routes", "fixtures", "mt1-mt3-i893-hp8425.route.json");
  const outPath = resolveMaybe(args.out);
  const stopFloorId = args["stop-floor"] || "MT6";
  const fromStep = parseOptionalNumber(args["from-step"]);
  const toStep = parseOptionalNumber(args["to-step"]);
  const siblingLimit = parseOptionalNumber(args["sibling-limit"]);
  const keyMode = args["key-mode"] || "location";
  const enableResourceTiming = parseBooleanFlag(args["enable-resource-timing"], false);
  const forceKeepTeacher = !parseBooleanFlag(args["no-force-keep-teacher"], false);
  const quiet = parseBooleanFlag(args.quiet, false);
  const maxReportSteps = parseOptionalNumber(args["max-report-steps"]) || 40;

  if (!fs.existsSync(routePath)) {
    throw new Error(`route not found: ${routePath}`);
  }

  const project = loadProject(projectRoot);
  const simulator = new StaticSimulator(project, {
    stopFloorId,
    battleResolver: new FunctionBackedBattleResolver(project),
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFightToLevelUp: false,
    enableResourcePocket: false,
    enableResourceCluster: false,
    enableResourceChain: false,
    searchGraphMode: "primitive",
  });
  const route = readRouteFile(routePath);
  const report = runTeacherDivergenceAudit(simulator, route, {
    fromStep: fromStep == null ? 0 : fromStep,
    toStep: toStep == null ? undefined : toStep,
    siblingLimit: siblingLimit == null ? 12 : siblingLimit,
    forceKeepTeacher,
    enableResourceTiming,
    dpKeyOptions: { keyMode },
  });

  report.meta = {
    projectRoot,
    routePath,
    generatedAt: new Date().toISOString(),
    note: "test-side diagnostics only; do not feed teacher actions into production search",
  };

  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    // Strip full dpKey strings from every step if huge? Keep them for diagnosis.
    fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (!quiet) {
    console.log(formatDivergenceReport(report, { maxSteps: maxReportSteps }));
    if (outPath) console.log(`wrote ${outPath}`);
  }

  if (!report.ok) process.exitCode = 2;
  return report;
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  }
}

module.exports = { main };
