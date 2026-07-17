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
const { runRouteWindowRepair } = require("./lib/route-window-repair");
const { parseBooleanFlag, parseKeyValueArgs } = require("./lib/cli-options");

const DEFAULT_PROJECT_ROOT = path.resolve(
  __dirname,
  "..",
  "Only upV2.1",
  "Only upV2.1",
);

const WINDOW_PROFILE_FILES = {
  mt5: path.resolve(__dirname, "profiles", "window-mt5.json"),
};

function parseOptionalNumber(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function numberArg(args, name, fallback) {
  const parsed = parseOptionalNumber(args[name]);
  return parsed == null ? fallback : parsed;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function main() {
  const args = parseKeyValueArgs(process.argv.slice(2));
  const mode = args.mode || "sequential";
  const missingRequired = !args.route || (mode === "independent" && (!args.audit || !args.timeline)) || (mode === "window" && !args["window-profile"]);
  if (args.help || args.h || missingRequired) {
    console.log([
      "Usage:",
      "  node shared-solver/route-repair.js --route=<file> [--out=<file>] [--out-route=<file>]",
      "  node shared-solver/route-repair.js --mode=independent --route=<file> --timeline=<file> --audit=<file>",
      "  node shared-solver/route-repair.js --mode=window --route=<file> --window-profile=<name|json>",
      "",
      "Options:",
      "  --project-root=<dir>       tower project root (default Only upV2.1/Only upV2.1)",
      "  --mode=<name>              sequential (default), independent, or window",
      "  --max-repairs=<n>          accepted sequential repairs (default 20)",
      "  --suffix-bridge=0|1        repair unavailable suffix actions with segment DP (default 1)",
      "  --max-suffix-bridges=<n>   bridge attempts per candidate (default 3)",
      "  --suffix-max-expansions=<n> per-bridge expansion cap (default 2000)",
      "  --suffix-max-runtime-ms=<n> per-bridge runtime budget (default 3000)",
      "  --suffix-goal-skyline-limit=<n> bridge skyline candidates (default 4)",
      "  --suffix-finalists=<n>     candidates receiving full suffix replay (default 2)",
      "  --suffix-lookahead-steps=<n> strict short replay length (default 8)",
      "  --suffix-max-search-nodes=<n> candidate node budget per route patch (default 16)",
      "  --min-damage-delta=<n>     audit threshold for sequential mode (default 1000)",
      "  --min-savings-ratio=<n>    audit savings ratio for sequential mode (default 0.15)",
      "  --max-runtime-ms=<n>       per-round milestone DP budget (default 1500)",
      "  --max-expansions=<n>       per-round milestone DP expansion cap (default 800)",
      "  --max-depth=<n>            recursion depth for sequential blocker clearing (default 3)",
      "  --blocker-radius=<n>       radius used to discover blockers around the cheaper target (default 4)",
      "  --max-blockers-per-step=<n> cap blocker candidates considered per step (default 1)",
      "  --window-profile=<name|json>  window profile name (mt5) or JSON object",
      "  --window-max-expansions=<n>   per-stage DP expansion cap (default 12000)",
      "  --window-max-runtime-ms=<n>   per-stage DP runtime budget (default 30000)",
      "  --window-candidate-limit=<n>  candidates preserved per stage (default 4)",
      "  --window-goal-skyline-limit=<n> goal skyline slots per stage (default 8)",
      "  --disable-floor-fly        omit floorFly from actionKinds (force changeFloor)",
      "  --enable-floor-fly-final-stage  re-enable floorFly for the last DP stage only",
      "  --max-floor-fly-per-target=<n> deprioritize floorFly: keep only N per target (default 1)",
      "  --window-preserve-prefix=<n> keep first N baseline window actions before DP",
      "  --window-baseline-local-probe=0|1  try bounded swaps in the baseline window (default 1)",
      "  --window-baseline-local-depth=<n> baseline-local swap depth (default 3)",
      "  --window-baseline-local-beam=<n> baseline-local beam width (default 1)",
      "  --window-local-probe=0|1  try bounded insert/swap repair when direct candidates fail (default 1)",
      "  --window-local-probe-candidate-limit=<n> raw final candidates probed (default 32)",
      "  --window-local-probe-swap-candidate-limit=<n> insertion seeds receiving swap probes (default 4)",
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
  if (mode === "window") {
    const profileArg = args["window-profile"];
    let profile = null;
    // 1. Built-in alias → load from file
    if (WINDOW_PROFILE_FILES[profileArg]) {
      const aliasPath = WINDOW_PROFILE_FILES[profileArg];
      if (!fs.existsSync(aliasPath)) {
        console.error(`Built-in profile '${profileArg}' file missing: ${aliasPath}`);
        process.exitCode = 1;
        return;
      }
      try {
        profile = JSON.parse(fs.readFileSync(aliasPath, "utf8"));
      } catch (error) {
        console.error(`Failed to parse built-in profile file: ${aliasPath}: ${error.message}`);
        process.exitCode = 1;
        return;
      }
    }
    // 2. File path
    if (!profile) {
      const profilePath = path.resolve(profileArg);
      if (fs.existsSync(profilePath)) {
        try {
          profile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
        } catch (error) {
          console.error(`Failed to parse window profile file: ${profilePath}: ${error.message}`);
          process.exitCode = 1;
          return;
        }
      }
    }
    // 3. Inline JSON
    if (!profile) {
      try {
        profile = JSON.parse(profileArg);
      } catch (error) {
        console.error(`Unknown window profile: ${profileArg} (not a built-in name, file path, or JSON)`);
        process.exitCode = 1;
        return;
      }
    }
    const baselineHpArg = parseOptionalNumber(args["window-baseline-hp"]);
    const windowResult = runRouteWindowRepair(project, simulator, route, profile, {
      projectRoot,
      windowStart: numberArg(args, "window-start", profile.windowStart),
      windowEnd: numberArg(args, "window-end", profile.windowEnd),
      baselineHp: baselineHpArg != null ? baselineHpArg : null,
      windowMaxExpansions: numberArg(args, "window-max-expansions", 12000),
      windowMaxRuntimeMs: numberArg(args, "window-max-runtime-ms", 30000),
      windowCandidateLimit: numberArg(args, "window-candidate-limit", 4),
      windowGoalSkylineLimit: numberArg(args, "window-goal-skyline-limit", 8),
      windowFloors: profile.floors,
      disableFloorFly: parseBooleanFlag(args["disable-floor-fly"], false),
      enableFloorFlyFinalStage: parseBooleanFlag(args["enable-floor-fly-final-stage"], false),
      maxFloorFlyPerTarget: parseOptionalNumber(args["max-floor-fly-per-target"]),
      preserveWindowPrefix: numberArg(args, "window-preserve-prefix", 0),
      baselineLocalProbe: parseBooleanFlag(args["window-baseline-local-probe"], true),
      baselineLocalProbeLimit: numberArg(args, "window-baseline-local-probe-limit", 40),
      baselineLocalProbeDepth: numberArg(args, "window-baseline-local-depth", 3),
      baselineLocalProbeBeamWidth: numberArg(args, "window-baseline-local-beam", 1),
      localProbe: parseBooleanFlag(args["window-local-probe"], true),
      localProbeCandidateLimit: numberArg(args, "window-local-probe-candidate-limit", 32),
      localProbeInsertionLimit: numberArg(args, "window-local-probe-insertion-limit", 40),
      localProbeInsertionSeedLimit: numberArg(args, "window-local-probe-seed-limit", 3),
      localProbeSwapLimit: numberArg(args, "window-local-probe-swap-limit", 60),
      localProbeSwapCandidateLimit: numberArg(args, "window-local-probe-swap-candidate-limit", 4),
    });
    const windowReport = {
      kind: "window-repair",
      mode: "window",
      route: routeFile,
      projectRoot,
      profile: profile.id,
      windowStart: windowResult.windowStart,
      windowEnd: windowResult.windowEnd,
      preserveWindowPrefix: numberArg(args, "window-preserve-prefix", 0),
      ok: windowResult.ok,
      baselineHp: windowResult.baselineHp,
      finalHp: windowResult.finalHp,
      stoppedReason: windowResult.stoppedReason,
      farthestStage: windowResult.farthestStage,
      stageResults: windowResult.stageResults,
      validations: (windowResult.validations || []).map((entry) => ({
        candidateId: entry.candidateId,
        hero: entry.hero || null,
        effectiveHero: entry.effectiveHero || null,
        tags: entry.tags || [],
        baselineMatchCount: entry.baselineMatchCount || 0,
        baselineMobilityMatchCount: entry.baselineMobilityMatchCount || 0,
        baselinePortalMatchCount: entry.baselinePortalMatchCount || 0,
        windowActionCount: entry.windowActionCount || 0,
        actionTrace: entry.actionTrace || [],
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
      })),
      baselineLocalProbeAttempts: windowResult.baselineLocalProbeAttempts || [],
      localProbeAttempts: windowResult.localProbeAttempts || [],
      accepted: windowResult.accepted,
      rebuildError: windowResult.rebuildError,
      strictReplayOk: windowResult.strictReplayOk,
      strictFinalHp: windowResult.strictFinalHp,
      strictGoalFailures: windowResult.strictGoalFailures,
      debugTrace: windowResult.debugTrace || [],
      windowRepair: {
        finalGoal: windowResult.finalGoal,
        stages: (windowResult.stageResults || []).map((stage) => ({
          stageIndex: stage.stageIndex,
          found: stage.found,
          candidateCount: stage.candidateCount,
          skylineCount: stage.skylineCount,
          expansions: stage.expansions,
          stoppedReason: stage.stoppedReason,
          candidates: stage.candidates,
        })),
        bestCandidateHp: windowResult.bestCandidateHp || null,
        acceptedId: windowResult.accepted ? windowResult.accepted.candidateId : null,
        baselineLocalProbeAttempts: windowResult.baselineLocalProbeAttempts || [],
        localProbeAttempts: windowResult.localProbeAttempts || [],
      },
    };
    if (args.out) {
      const outFile = path.resolve(args.out);
      writeJson(outFile, windowReport);
      console.log(`Window repair report written: ${outFile}`);
    } else {
      console.log(JSON.stringify(windowReport, null, 2));
    }
    if (args["out-route"] && windowResult.ok && windowResult.route) {
      const outRouteFile = path.resolve(args["out-route"]);
      fs.mkdirSync(path.dirname(outRouteFile), { recursive: true });
      writeRouteFile(outRouteFile, windowResult.route);
      console.log(`Repaired route written: ${outRouteFile}`);
    }
    return;
  }
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
      suffixGoalSkylineLimit: parseOptionalNumber(args["suffix-goal-skyline-limit"]) || 4,
      suffixFinalists: parseOptionalNumber(args["suffix-finalists"]) || 2,
      suffixLookaheadSteps: parseOptionalNumber(args["suffix-lookahead-steps"]) || 8,
      suffixMaxSearchNodes: parseOptionalNumber(args["suffix-max-search-nodes"]) || 16,
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
