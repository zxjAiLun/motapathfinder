"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { loadProject } = require("./lib/project-loader");
const { readRouteFile, writeRouteFile } = require("./lib/route-store");
const { StaticSimulator } = require("./lib/simulator");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { planBlockerRepairs, summarizePlan } = require("./lib/route-audit-repair");
const { tryRepairRoute, replaceStepSummary } = require("./lib/route-repair-runner");
const { parseKeyValueArgs } = require("./lib/cli-options");

const DEFAULT_PROJECT_ROOT = path.resolve(
  __dirname,
  "..",
  "Only upV2.1",
  "Only upV2.1",
);

function parseOptionalNumber(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function main() {
  const args = parseKeyValueArgs(process.argv.slice(2));
  if (args.help || args.h || !args["audit"] || !args["timeline"] || !args["route"]) {
    console.log([
      "Usage:",
      "  node shared-solver/route-repair.js --route=<file> --timeline=<file> --audit=<file> [--out=<file>]",
      "",
      "Options:",
      "  --project-root=<dir>       tower project root (default Only upV2.1/Only upV2.1)",
      "  --max-runtime-ms=<n>       per-repair milestone DP budget (default 6000)",
      "  --max-expansions=<n>       per-repair milestone DP expansion cap (default 3000)",
      "  --max-blockers-per-step=<n> cap blocker candidates considered per step (default 1)",
      "  --out=<file>               write repaired route.json",
    ].join("\n"));
    return;
  }
  const routeFile = path.resolve(args.route);
  const timelineFile = path.resolve(args.timeline);
  const auditFile = path.resolve(args.audit);
  const projectRoot = path.resolve(args["project-root"] || DEFAULT_PROJECT_ROOT);
  const route = readRouteFile(routeFile);
  const timeline = JSON.parse(fs.readFileSync(timelineFile, "utf8"));
  const audit = JSON.parse(fs.readFileSync(auditFile, "utf8"));
  const project = loadProject(projectRoot);
  const simulator = new StaticSimulator(project, {
    battleResolver: new FunctionBackedBattleResolver(project),
  });
  const repairs = planBlockerRepairs(simulator, project, timeline, audit, {
    maxIntents: parseOptionalNumber(args["max-intents"]) || 1,
  });
  const perStep = new Map();
  for (const repair of repairs) {
    const list = perStep.get(repair.stepIndex) || [];
    list.push(repair);
    perStep.set(repair.stepIndex, list);
  }
  const maxBlockers = parseOptionalNumber(args["max-blockers-per-step"]) || 1;
  const repairEntries = [];
  for (const [stepIndex, list] of perStep) {
    const finding = (audit.findings || []).find((f) => f.stepIndex === stepIndex);
    const cheaper = finding && finding.cheaper ? finding.cheaper : null;
    const limited = list.slice(0, maxBlockers);
    repairEntries.push({
      stepIndex,
      milestones: limited.map((entry) => entry.milestone),
      cheaper,
    });
  }
  const result = tryRepairRoute(simulator, project, route, timeline, repairEntries, {
    maxExpansions: parseOptionalNumber(args["max-expansions"]) || 3000,
    maxRuntimeMs: parseOptionalNumber(args["max-runtime-ms"]) || 6000,
  });
  let repairedRoute = route;
  for (const repair of result.repairedSteps) {
    const next = replaceStepSummary(repairedRoute, repair.stepIndex, repair.newSummary);
    if (next) repairedRoute = next;
  }
  const summary = {
    kind: "route-repair",
    route: routeFile,
    audit: auditFile,
    projectRoot,
    plan: summarizePlan(repairs),
    attempts: result.results,
    repairedSteps: result.repairedSteps,
    repairedCount: result.repairedSteps.length,
    statusCounts: result.results.reduce((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {}),
  };
  const json = JSON.stringify(summary, null, 2);
  if (args.out) {
    fs.writeFileSync(path.resolve(args.out), `${json}\n`);
    console.log(`Repair report written: ${path.resolve(args.out)}`);
  } else {
    console.log(json);
  }
  if (args["out-route"] && result.repairedSteps.length > 0) {
    const outRouteFile = path.resolve(args["out-route"]);
    writeRouteFile(outRouteFile, repairedRoute);
    console.log(`Repaired route written: ${outRouteFile}`);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  }
}
