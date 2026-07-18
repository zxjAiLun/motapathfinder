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
  mergeTeacherSearchObservation,
  runTeacherDivergenceAudit,
} = require("./lib/teacher-divergence-audit");
const {
  buildTeacherStepIndex,
  runTeacherSearchObservation,
} = require("./lib/teacher-search-observer");

function resolveMaybe(value) {
  if (!value) return null;
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}

function loadSegmentFile(filePath, segmentId) {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!segmentId) return parsed;
  const candidates = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.milestones)
      ? parsed.milestones
      : Array.isArray(parsed.segments)
        ? parsed.segments
        : [];
  const segment = candidates.find((entry) => entry && entry.id === segmentId);
  if (!segment) {
    throw new Error(`segment id not found in ${filePath}: ${segmentId}`);
  }
  return segment;
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
  const segmentFile = resolveMaybe(args["segment-file"]);
  const segmentId = args["segment-id"] || null;
  const observeSearch = parseBooleanFlag(args["observe-search"], false);
  const searchMaxExpansions = parseOptionalNumber(args["search-max-expansions"]);
  const searchMaxRuntimeMs = parseOptionalNumber(args["search-max-runtime-ms"]);
  const searchMaxActionsPerState = parseOptionalNumber(args["search-max-actions-per-state"]);
  const searchMaxHeapMb = parseOptionalNumber(args["search-max-heap-mb"]);
  const searchAgendaMode = args["search-agenda-mode"] || null;
  const searchPriorityMode = args["search-priority-mode"] || null;
  const searchKeyMode = args["search-key-mode"] || null;
  const searchDpSkylineMax = parseOptionalNumber(args["search-dp-skyline-max"]);
  const continuationAuditEnabled = parseBooleanFlag(args["continuation-audit"], false);
  const captureDominanceWitnesses = parseBooleanFlag(args["capture-dominance-witnesses"], continuationAuditEnabled);
  const dominanceTargetStep = parseOptionalNumber(args["dominance-target-step"]);
  const continuationWindows = String(args["continuation-windows"] || "1,3,until-failure")
    .split(",")
    .map((value) => {
      const parsed = Number(value.trim());
      return Number.isFinite(parsed) ? parsed : value.trim();
    })
    .filter((value) => value !== "");

  if (!fs.existsSync(routePath)) {
    throw new Error(`route not found: ${routePath}`);
  }

  const project = loadProject(projectRoot);
  let segment = null;
  if (segmentFile) {
    if (!fs.existsSync(segmentFile)) throw new Error(`segment file not found: ${segmentFile}`);
    segment = loadSegmentFile(segmentFile, segmentId);
  }
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
  let report = runTeacherDivergenceAudit(simulator, route, {
    fromStep: fromStep == null ? 0 : fromStep,
    toStep: toStep == null ? undefined : toStep,
    siblingLimit: siblingLimit == null ? 12 : siblingLimit,
    forceKeepTeacher,
    enableResourceTiming,
    dpKeyOptions: { keyMode },
    segment,
  });

  if (observeSearch) {
    if (!segment) throw new Error("--observe-search=1 requires --segment-file=...");
    const startIndex = fromStep == null ? 0 : Math.max(0, fromStep);
    const teacherIndex = buildTeacherStepIndex(simulator, route, {
      fromStep: startIndex,
      toStep: toStep == null ? undefined : toStep,
    });
    const startState = teacherIndex.statesBefore[startIndex];
    if (!startState) throw new Error(`teacher pre-state unavailable at step ${startIndex}`);
    const dpOverrides = {};
    if (searchMaxExpansions != null) dpOverrides.maxExpansions = searchMaxExpansions;
    if (searchMaxRuntimeMs != null) dpOverrides.maxRuntimeMs = searchMaxRuntimeMs;
    if (searchMaxActionsPerState != null) dpOverrides.maxActionsPerState = searchMaxActionsPerState;
    if (searchMaxHeapMb != null) dpOverrides.maxHeapMb = searchMaxHeapMb;
    if (searchAgendaMode) dpOverrides.agendaMode = searchAgendaMode;
    if (searchPriorityMode) dpOverrides.priorityMode = searchPriorityMode;
    if (searchKeyMode) dpOverrides.keyMode = searchKeyMode;
    if (searchDpSkylineMax != null) dpOverrides.dpSkylineMax = searchDpSkylineMax;
    if (captureDominanceWitnesses) {
      dpOverrides.observerCaptureMode = continuationAuditEnabled ? "targeted-state" : "compact";
      dpOverrides.observerCaptureWitnessStates = continuationAuditEnabled;
      dpOverrides.observerCaptureDominanceWitnesses = true;
    }
    const observation = runTeacherSearchObservation(simulator, startState, segment, {
      teacherIndex,
      fromStep: startIndex,
      toStep: toStep == null ? undefined : toStep,
      searchOptions: { dpOverrides },
      captureDominanceWitnesses,
      captureDominanceWitnessStates: continuationAuditEnabled,
      dominanceTargetStep,
      continuationAudit: continuationAuditEnabled
        ? { windows: continuationWindows, maxWitnesses: 1 }
        : null,
    });
    report = mergeTeacherSearchObservation(report, observation);
  }

  report.meta = {
    projectRoot,
    routePath,
    segmentFile,
    segmentId,
    segment: segment ? { id: segment.id || null, label: segment.label || null } : null,
    observeSearch,
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
