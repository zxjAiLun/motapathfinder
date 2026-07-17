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

function attachWindowRepairReport(timeline, report) {
  const windowStart = Number(report.windowStart || 1);
  const windowEnd = Number(report.windowEnd || windowStart);
  const startIndex = windowStart - 1;
  const summary = {
    kind: "window-repair",
    profile: report.profile || null,
    windowStart,
    windowEnd,
    ok: Boolean(report.ok),
    baselineHp: report.baselineHp,
    finalHp: report.finalHp,
    stoppedReason: report.stoppedReason || null,
    farthestStage: report.farthestStage,
    bestCandidateHp: (report.windowRepair && report.windowRepair.bestCandidateHp) || null,
    acceptedId: (report.windowRepair && report.windowRepair.acceptedId) || null,
    strictReplayOk: report.strictReplayOk,
    strictFinalHp: report.strictFinalHp,
  };
  const stages = (report.stageResults || []).map((stage) => ({
    stageIndex: stage.stageIndex,
    segmentId: stage.segmentId,
    found: stage.found,
    rawCandidateCount: stage.rawCandidateCount,
    candidateCount: stage.candidateCount,
    skylineCount: stage.skylineCount,
    expansions: stage.expansions,
    frontierSize: stage.frontierSize,
    stoppedReason: stage.stoppedReason,
    candidates: (stage.candidates || []).map((c) => ({
      id: c.id,
      hp: (c.hero || {}).hp || null,
      atk: (c.effectiveHero || c.hero || {}).atk || null,
      routeLength: c.routeLength,
      baselineMatchCount: c.baselineMatchCount || 0,
      baselineMobilityMatchCount: c.baselineMobilityMatchCount || 0,
      baselinePortalMatchCount: c.baselinePortalMatchCount || 0,
      tags: c.tags || [],
    })),
  }));
  const validations = (report.validations || []).map((entry) => ({
    candidateId: entry.candidateId,
    fullReplayOk: entry.fullReplayOk,
    replayFailure: entry.replayFailure || null,
    goalFailures: entry.goalFailures || [],
    finalHp: entry.finalHp,
    baselineHp: entry.baselineHp,
    hpImproved: entry.hpImproved,
    accepted: entry.accepted,
    rejectedReason: entry.rejectedReason,
    localProbe: entry.localProbe || false,
    baselineLocalProbe: entry.baselineLocalProbe || false,
    sourceCandidateId: entry.sourceCandidateId || null,
    probeType: entry.probeType || null,
    probe: entry.probe || null,
    actionTrace: entry.actionTrace || [],
    windowActionCount: entry.windowActionCount || 0,
    baselineMatchCount: entry.baselineMatchCount || 0,
    baselineMobilityMatchCount: entry.baselineMobilityMatchCount || 0,
    baselinePortalMatchCount: entry.baselinePortalMatchCount || 0,
    tags: entry.tags || [],
  }));
  // Attach validation annotations to timeline steps in the window range.
  for (const validation of validations) {
    if (!Array.isArray(validation.actionTrace)) continue;
    for (let offset = 0; offset < validation.actionTrace.length; offset++) {
      const stepIndex = startIndex + offset;
      const step = timeline.steps && timeline.steps[stepIndex];
      if (!step) continue;
      if (!Array.isArray(step.repairAnnotations)) step.repairAnnotations = [];
      step.repairAnnotations.push({
        kind: "window-repair",
        candidateId: validation.candidateId,
        accepted: validation.accepted,
        rejectedReason: validation.rejectedReason,
        baselineHp: validation.baselineHp,
        finalHp: validation.finalHp,
        replayFailure: validation.replayFailure,
        goalFailures: validation.goalFailures,
        localProbe: validation.localProbe,
        baselineLocalProbe: validation.baselineLocalProbe,
        sourceCandidateId: validation.sourceCandidateId,
        probeType: validation.probeType,
        probe: validation.probe,
        baselineMatchCount: validation.baselineMatchCount,
        baselineMobilityMatchCount: validation.baselineMobilityMatchCount,
        baselinePortalMatchCount: validation.baselinePortalMatchCount,
        actionSummary: validation.actionTrace[offset],
        tags: validation.tags,
      });
    }
  }
  timeline.repair = {
    summary,
    windowStages: stages,
    windowValidations: validations,
    debugTrace: report.debugTrace || [],
    windowRepair: report.windowRepair || null,
  };
  return timeline;
}

function attachRepairReport(timeline, report) {
  if (!report) return timeline;
  if (report.kind === "window-repair") {
    return attachWindowRepairReport(timeline, report);
  }
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
        firstReplayFailure: attempt.firstReplayFailure || null,
        suffixBridges: attempt.suffixBridges || [],
        skippedSatisfiedSteps: attempt.skippedSatisfiedSteps || [],
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
  attachWindowRepairReport,
  main,
};
