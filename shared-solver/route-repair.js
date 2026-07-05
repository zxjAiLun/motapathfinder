"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { loadProject } = require("./lib/project-loader");
const { readRouteFile, writeRouteFile } = require("./lib/route-store");
const { StaticSimulator } = require("./lib/simulator");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { planBlockerRepairs, summarizePlan } = require("./lib/route-audit-repair");
const { tryRepairRoute, replaceStepSummary } = require("./lib/route-repair-runner");
const { runIterativeRouteRepair } = require("./lib/iterative-route-repair");
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

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function main() {
  const args = parseKeyValueArgs(process.argv.slice(2));
  const mode = args.mode || "sequential";
  const missingRequired = !args.route || (mode === "independent" && (!args.audit || !args.timeline));
  if (args.help || args.h || missingRequired) {
    console.log([
      "Usage:",
      "  node shared-solver/route-repair.js --route=<file> [--out=<file>] [--out-route=<file>]",
      "  node shared-solver/route-repair.js --mode=independent --route=<file> --timeline=<file> --audit=<file>",
      "",
      "Options:",
      "  --project-root=<dir>       tower project root (default Only upV2.1/Only upV2.1)",
      "  --mode=<name>              sequential (default) or independent",
      "  --max-repairs=<n>          accepted sequential repairs (default 20)",
      "  --suffix-bridge=0|1        repair unavailable suffix actions with segment DP (default 1)",
      "  --max-suffix-bridges=<n>   bridge attempts per candidate (default 3)",
      "  --suffix-max-expansions=<n> per-bridge expansion cap (default 2000)",
      "  --suffix-max-runtime-ms=<n> per-bridge runtime budget (default 3000)",
      "  --min-damage-delta=<n>     audit threshold for sequential mode (default 1000)",
      "  --min-savings-ratio=<n>    audit savings ratio for sequential mode (default 0.15)",
      "  --max-runtime-ms=<n>       per-round milestone DP budget (default 1500)",
      "  --max-expansions=<n>       per-round milestone DP expansion cap (default 800)",
      "  --max-depth=<n>            recursion depth for sequential blocker clearing (default 3)",
      "  --blocker-radius=<n>       radius used to discover blockers around the cheaper target (default 4)",
      "  --max-blockers-per-step=<n> cap blocker candidates considered per step (default 1)",
      "  --out=<file>               write repair report",
      "  --out-route=<file>         write re-priced route.json (only when repairedCount > 0)",
    ].join("\n"));
    return;
  }
  const routeFile = path.resolve(args.route);
  const projectRoot = path.resolve(args["project-root"] || DEFAULT_PROJECT_ROOT);
  const route = readRouteFile(routeFile);
  const project = loadProject(projectRoot);
  const simulator = new StaticSimulator(project, {
    battleResolver: new FunctionBackedBattleResolver(project),
  });
  if (mode !== "independent") {
    const iterative = runIterativeRouteRepair(project, simulator, route, {
      projectRoot,
      maxRepairs: parseOptionalNumber(args["max-repairs"]) || 20,
      maxExpansions: parseOptionalNumber(args["max-expansions"]) || 800,
      maxRuntimeMs: parseOptionalNumber(args["max-runtime-ms"]) || 1500,
      maxDepth: parseOptionalNumber(args["max-depth"]) || 3,
      blockerRadius: parseOptionalNumber(args["blocker-radius"]) || 4,
      minDamageDelta: parseOptionalNumber(args["min-damage-delta"]) || 1000,
      minSavingsRatio: parseOptionalNumber(args["min-savings-ratio"]) || 0.15,
      candidateLimit: parseOptionalNumber(args["candidate-limit"]) || 200,
      suffixBridge: args["suffix-bridge"] !== "0" && args["suffix-bridge"] !== "false",
      maxSuffixBridges: parseOptionalNumber(args["max-suffix-bridges"]) || 3,
      suffixMaxExpansions: parseOptionalNumber(args["suffix-max-expansions"]) || 2000,
      suffixMaxRuntimeMs: parseOptionalNumber(args["suffix-max-runtime-ms"]) || 3000,
    });
    const summary = {
      kind: "iterative-route-repair",
      mode: "sequential",
      route: routeFile,
      projectRoot,
      iterations: iterative.iterations,
      acceptedCount: iterative.acceptedCount,
      baselineFinalHp: iterative.initialFinalHp,
      candidateFinalHp: iterative.finalFinalHp,
      finalRouteVerified: iterative.finalRouteVerified,
      replayFailure: iterative.replayFailure,
      stoppedReason: iterative.stoppedReason,
    };
    if (args.out) {
      const outFile = path.resolve(args.out);
      writeJson(outFile, summary);
      console.log(`Repair report written: ${outFile}`);
    } else {
      console.log(JSON.stringify(summary, null, 2));
    }
    if (args["out-route"] && iterative.acceptedCount > 0 && iterative.finalRouteVerified) {
      const outRouteFile = path.resolve(args["out-route"]);
      fs.mkdirSync(path.dirname(outRouteFile), { recursive: true });
      writeRouteFile(outRouteFile, iterative.route);
      console.log(`Repaired route written: ${outRouteFile}`);
    }
    return;
  }
  const timelineFile = path.resolve(args.timeline);
  const auditFile = path.resolve(args.audit);
  const timeline = JSON.parse(fs.readFileSync(timelineFile, "utf8"));
  const audit = JSON.parse(fs.readFileSync(auditFile, "utf8"));
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
  const maxDepth = parseOptionalNumber(args["max-depth"]) || 3;
  const result = tryRepairRoute(simulator, project, route, timeline, repairEntries, {
    maxExpansions: parseOptionalNumber(args["max-expansions"]) || 800,
    maxRuntimeMs: parseOptionalNumber(args["max-runtime-ms"]) || 1500,
    maxDepth,
    blockerRadius: parseOptionalNumber(args["blocker-radius"]) || 4,
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
  if (args.out) {
    const outFile = path.resolve(args.out);
    writeJson(outFile, summary);
    console.log(`Repair report written: ${outFile}`);
  } else {
    console.log(JSON.stringify(summary, null, 2));
  }
  if (args["out-route"] && result.repairedSteps.length > 0) {
    const outRouteFile = path.resolve(args["out-route"]);
    fs.mkdirSync(path.dirname(outRouteFile), { recursive: true });
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
