"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { loadProject } = require("./lib/project-loader");
const { StaticSimulator } = require("./lib/simulator");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { auditRouteForExpensivePicks, verifyRepairMilestones } = require("./lib/route-audit");
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
  if (args.help || args.h) {
    console.log([
      "Usage:",
      "  node shared-solver/route-audit.js --timeline=<file> --project-root=<dir> --out=<json>",
      "",
      "Options:",
      "  --min-damage-delta=<n>      minimum damage savings to flag a step (default 1000)",
      "  --min-savings-ratio=<0-1>   minimum relative savings (default 0.15)",
      "  --max-intents=<n>           max intents per finding (default 4)",
      "  --verify=0|1                run segment DP validation per repair milestone (default 0)",
      "  --max-runtime-ms=<n>        per-milestone DP budget (default 8000)",
      "  --out=<file>                write JSON output",
    ].join("\n"));
    return;
  }
  const timelinePath = path.resolve(args.timeline);
  const projectRoot = path.resolve(args["project-root"] || DEFAULT_PROJECT_ROOT);
  const timeline = JSON.parse(fs.readFileSync(timelinePath, "utf8"));
  const project = loadProject(projectRoot);
  const simulator = new StaticSimulator(project, {
    battleResolver: new FunctionBackedBattleResolver(project),
  });
  const result = auditRouteForExpensivePicks(simulator, project, timeline, {
    minDamageDelta: parseOptionalNumber(args["min-damage-delta"]) || 1000,
    minSavingsRatio: parseOptionalNumber(args["min-savings-ratio"]) || 0.15,
    maxIntents: parseOptionalNumber(args["max-intents"]) || 4,
  });
  let verification = null;
  if (args.verify !== "0" && args.verify !== "false") {
    verification = verifyRepairMilestones(simulator, project, timeline, result.milestones, {
      maxExpansions: parseOptionalNumber(args["max-expansions"]) || 4000,
      maxRuntimeMs: parseOptionalNumber(args["max-runtime-ms"]) || 8000,
    });
  }
  const summary = {
    timeline: timelinePath,
    projectRoot,
    findings: result.findings.map((finding) => ({
      stepIndex: finding.stepIndex,
      stepSummary: finding.stepSummary,
      floorId: finding.floorId,
      picked: finding.picked,
      cheaper: finding.cheaper,
      bestSaving: finding.bestSaving,
      savingsRatio: Math.round(finding.savingsRatio * 1000) / 1000,
    })),
    intents: result.intents.map((entry) => ({
      stepIndex: entry.finding.stepIndex,
      kind: entry.intent.kind,
      primaryStat: entry.intent.primaryStat,
      score: Math.round(entry.intent.score),
      topActions: (entry.intent.records || []).slice(0, 3).map((record) => ({
        actionSummary: record.actionSummary,
        actionKind: record.actionKind,
        damage: record.damage,
        blockerBattle: record.blockerBattle,
        blockedResource: record.blockedResource,
      })),
    })),
    milestones: result.milestones,
    verification: verification
      ? {
          results: verification.results,
          foundCount: verification.results.filter((r) => r.found).length,
          improvedCount: verification.results.filter((r) => r.improved).length,
          byReason: verification.results.reduce((acc, r) => {
            acc[r.reason] = (acc[r.reason] || 0) + 1;
            return acc;
          }, {}),
        }
      : null,
  };
  const json = JSON.stringify(summary, null, 2);
  if (args.out) {
    fs.writeFileSync(path.resolve(args.out), `${json}\n`);
    console.log(`Audit written: ${path.resolve(args.out)}`);
  } else {
    console.log(json);
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
