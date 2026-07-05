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

function attachRepairReport(timeline, report) {
  if (!report) return timeline;
  const summary = {
    acceptedCount: Number(report.acceptedCount || 0),
    baselineFinalHp: report.baselineFinalHp,
    finalFinalHp: report.candidateFinalHp,
    finalRouteVerified: Boolean(report.finalRouteVerified),
    stoppedReason: report.stoppedReason || null,
  };
  const attempts = [];
  for (const iteration of report.iterations || []) {
    for (const attempt of iteration.candidateAttempts || []) {
      const annotation = {
        iterationIndex: iteration.iterationIndex,
        sourceStepIndex: attempt.sourceStepIndex,
        originalSummary: attempt.originalSummary,
        cheaperSummary: attempt.patch && attempt.patch.cheaperSummary,
        patchActions: attempt.patch ? (attempt.patch.actions || []).map((action) => action.summary) : [],
        accepted: Boolean(attempt.accepted),
        rejectedReason: attempt.rejectedReason || null,
        baselineFinalHp: iteration.baselineFinalHp,
        candidateFinalHp: attempt.candidateFinalHp,
        replayFailure: attempt.replayFailure || null,
        outputStartStep: attempt.outputStartStep || null,
        outputActionCount: attempt.outputActionCount || 0,
      };
      attempts.push(annotation);
      const stepIndex = annotation.accepted && annotation.outputStartStep
        ? annotation.outputStartStep
        : annotation.sourceStepIndex;
      const step = timeline.steps && timeline.steps[stepIndex];
      if (step) {
        if (!Array.isArray(step.repairAnnotations)) step.repairAnnotations = [];
        step.repairAnnotations.push(annotation);
      }
      if (annotation.accepted && annotation.outputStartStep && annotation.outputActionCount > 1) {
        for (let offset = 1; offset < annotation.outputActionCount; offset += 1) {
          const patchStep = timeline.steps && timeline.steps[annotation.outputStartStep + offset];
          if (!patchStep) continue;
          if (!Array.isArray(patchStep.repairAnnotations)) patchStep.repairAnnotations = [];
          patchStep.repairAnnotations.push({ ...annotation, patchActionOffset: offset });
        }
      }
    }
  }
  timeline.repair = { summary, attempts };
  return timeline;
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
    actionInspectorMode: args["action-inspector-mode"] || (args["action-inspector-pre"] ? "pre" : "post"),
    candidateLimit: args["candidate-limit"],
    stopOnError: args["stop-on-error"] !== "0",
    includeStack: args["include-stack"] === "1",
  });
  if (args["repair-report"]) {
    const repairReport = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), args["repair-report"]), "utf8"));
    attachRepairReport(timeline, repairReport);
  }
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
  attachRepairReport,
  main,
};
