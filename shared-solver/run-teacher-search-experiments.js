"use strict";

/**
 * Observer-only teacher search experiments. This intentionally skips the
 * teacher-forced audit so agenda experiments measure search time, not audit
 * replay time. The teacher route is used only to build exact state indexes.
 */

const fs = require("node:fs");
const path = require("node:path");

const {
  parseBooleanFlag,
  parseKeyValueArgs,
  parseOptionalNumber,
} = require("./lib/cli-options");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { loadProject } = require("./lib/project-loader");
const { readRouteFile } = require("./lib/route-store");
const { StaticSimulator } = require("./lib/simulator");
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
  if (!segment) throw new Error(`segment id not found: ${segmentId}`);
  return segment;
}

function optionalNumber(args, key, fallback) {
  const value = parseOptionalNumber(args[key]);
  return value == null ? fallback : value;
}

function runOne(simulator, route, segment, options) {
  const fromStep = options.fromStep;
  const toStep = options.toStep;
  const teacherIndex = buildTeacherStepIndex(simulator, route, {
    fromStep,
    toStep,
  });
  const startState = teacherIndex.statesBefore[fromStep];
  if (!startState) throw new Error(`teacher pre-state unavailable at step ${fromStep}`);
  const dpOverrides = {
    maxExpansions: options.maxExpansions,
    maxRuntimeMs: options.maxRuntimeMs,
    maxActionsPerState: options.maxActionsPerState,
    maxHeapMb: options.maxHeapMb,
  };
  if (options.agendaMode) dpOverrides.agendaMode = options.agendaMode;
  if (options.priorityMode) dpOverrides.priorityMode = options.priorityMode;
  if (options.keyMode) dpOverrides.keyMode = options.keyMode;
  if (options.dpSkylineMax != null) dpOverrides.dpSkylineMax = options.dpSkylineMax;
  return runTeacherSearchObservation(simulator, startState, segment, {
    teacherIndex,
    fromStep,
    toStep,
    searchOptions: { dpOverrides },
  });
}

function buildExperimentOptions(args, overrides) {
  const base = {
    fromStep: optionalNumber(args, "from-step", 113),
    toStep: optionalNumber(args, "to-step", 123),
    maxExpansions: optionalNumber(args, "search-max-expansions", 6000),
    maxRuntimeMs: optionalNumber(args, "search-max-runtime-ms", 20000),
    maxActionsPerState: optionalNumber(args, "search-max-actions-per-state", 256),
    maxHeapMb: optionalNumber(args, "search-max-heap-mb", 0),
    agendaMode: args["search-agenda-mode"] || null,
    priorityMode: args["search-priority-mode"] || null,
    keyMode: args["search-key-mode"] || null,
    dpSkylineMax: parseOptionalNumber(args["search-dp-skyline-max"]),
  };
  return { ...base, ...(overrides || {}) };
}

function buildMatrix(args) {
  const mode = args.mode || "baseline";
  const base = buildExperimentOptions(args);
  if (mode === "matrix") {
    return [
      { id: "baseline", options: { ...base } },
      {
        id: "runtime-only",
        options: { ...base, maxRuntimeMs: Math.max(base.maxRuntimeMs, 60000) },
      },
      {
        id: "expansion-only",
        options: {
          ...base,
          maxExpansions: Math.max(base.maxExpansions, 20000),
          maxRuntimeMs: Math.max(base.maxRuntimeMs, 60000),
        },
      },
      { id: "fifo", options: { ...base, agendaMode: "fifo" } },
    ];
  }
  if (mode === "direct-start") {
    const values = String(args["direct-expansions"] || "1,5,20")
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isFinite(value) && value > 0);
    return values.map((maxExpansions) => ({
      id: `direct-start-${maxExpansions}`,
      options: {
        ...base,
        maxExpansions,
        maxRuntimeMs: Math.max(base.maxRuntimeMs, 60000),
      },
    }));
  }
  return [{ id: mode, options: base }];
}

function main(argv) {
  const args = parseKeyValueArgs(argv);
  const projectRoot = resolveMaybe(args["project-root"])
    || path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
  const routePath = resolveMaybe(args.route)
    || path.join(__dirname, "routes", "latest", "adaptive-mt7-left-sword.route.json");
  const segmentFile = resolveMaybe(args["segment-file"])
    || path.join(__dirname, "milestones", "onlyup-chaos-mt5-blueking.json");
  const segment = loadSegmentFile(
    segmentFile,
    args["segment-id"] || "mt7-left-sword",
  );
  const route = readRouteFile(routePath);
  const project = loadProject(projectRoot);
  const simulator = new StaticSimulator(project, {
    stopFloorId: args["stop-floor"] || "MT6",
    battleResolver: new FunctionBackedBattleResolver(project),
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFightToLevelUp: false,
    enableResourcePocket: false,
    enableResourceCluster: false,
    enableResourceChain: false,
    searchGraphMode: "primitive",
  });
  const results = [];
  for (const experiment of buildMatrix(args)) {
    const startedAt = Date.now();
    const observation = runOne(simulator, route, segment, experiment.options);
    const { rawResult: _rawResult, ...observationReport } = observation;
    results.push({
      id: experiment.id,
      options: experiment.options,
      elapsedMs: Date.now() - startedAt,
      observation: observationReport,
    });
  }
  const report = {
    version: "teacher-search-experiments.v1",
    mode: args.mode || "baseline",
    routePath,
    segmentFile,
    segmentId: segment.id || null,
    results,
    generatedAt: new Date().toISOString(),
    note: "observer-only diagnostics; teacher route supplies exact indexes, never search actions",
  };
  const outPath = resolveMaybe(args.out);
  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (!parseBooleanFlag(args.quiet, false)) {
    results.forEach(({ id, observation }) => {
      console.log(
        `${id}: stopped=${observation.stoppedReason || "none"} ` +
        `expansions=${observation.expansions} ` +
        `firstObserved=${observation.firstObservedSearchDivergenceStep == null ? "none" : observation.firstObservedSearchDivergenceStep} ` +
        `firstInconclusive=${observation.firstInconclusiveStep == null ? "none" : observation.firstInconclusiveStep}`,
      );
    });
    if (outPath) console.log(`wrote ${outPath}`);
  }
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

module.exports = {
  buildMatrix,
  main,
  runOne,
};
