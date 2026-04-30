"use strict";

var fs = require("fs");
var path = require("path");
var cp = require("child_process");
var solver = require("../../../shared-solver/public");

// ──────────────────────────────────────
// Argument parsing
// ──────────────────────────────────────

function parseArgs(argv) {
  var args = {};
  for (var i = 0; i < argv.length; i++) {
    var raw = argv[i];
    var match = raw.match(/^--([^=]+)=(.*)$/);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

function argVal(args, argKey, envKey, fallback, required) {
  if (args[argKey] !== undefined && args[argKey] !== null) return args[argKey];
  if (envKey && process.env[envKey]) return process.env[envKey];
  if (required) throw new Error("Missing required argument: --" + argKey);
  return fallback;
}

// ──────────────────────────────────────
// Simulator factory
// ──────────────────────────────────────

function createSimulatorFromSpec(project, regionSpec) {
  var cfg = regionSpec.simulator || {};
  return solver.createSimulator(project, {
    stopFloorId: cfg.stopFloorId || null,
    autoPickupEnabled: cfg.autoPickupEnabled !== false,
    autoBattleEnabled: cfg.autoBattleEnabled !== false,
    searchGraphMode: cfg.searchGraphMode || "primitive",
  });
}

// ──────────────────────────────────────
// Search with fallback parameter groups
// ──────────────────────────────────────

function runSearchAttempt(simulator, initialState, milestoneSpec, params) {
  var t0 = Date.now();
  var result = null;
  var error = null;
  try {
    result = solver.runMilestoneGraph(simulator, initialState, milestoneSpec, params);
  } catch (e) {
    error = e.message || String(e);
  }
  return { params: params, result: result, error: error, wallMs: Date.now() - t0 };
}

function segmentBudgetExhausted(seg) {
  if (!seg) return false;
  if (seg.budgetExhausted) return true;
  if (seg.failurePropagation && seg.failurePropagation.budgetExhausted) return true;
  return false;
}

function resultBudgetExhausted(result) {
  if (!result) return false;
  var segments = result.segmentResults || [];
  for (var i = 0; i < segments.length; i++) {
    if (segmentBudgetExhausted(segments[i])) return true;
  }
  if (result.failedSegment && segmentBudgetExhausted(result.failedSegment)) return true;
  return false;
}

function bestOf(attempts) {
  var best = null;
  for (var i = 0; i < attempts.length; i++) {
    var a = attempts[i];
    if (!a.result) continue;
    if (!best) { best = a; continue; }
    if (a.result.found && !best.result.found) { best = a; continue; }
  }
  if (!best) {
    for (var j = 0; j < attempts.length; j++) {
      var b = attempts[j];
      if (b.result) { best = b; break; }
    }
  }
  return best || attempts[0];
}

function runSearchWithFallback(simulator, initialState, milestoneSpec, searchConfig, dpBudget) {
  var baseParams = {
    candidateLimit: Number(searchConfig.candidateLimit) || 8,
    dpKeyMode: searchConfig.dpKeyMode || null,
    maxExpansions: dpBudget.maxExpansions || null,
    maxRuntimeMs: dpBudget.maxRuntimeMs || null,
    stopOnFirstGoal: false,
    enableFailureBacktracking: true,
  };

  var attempts = [];

  function push(params) {
    var a = runSearchAttempt(simulator, initialState, milestoneSpec, params);
    attempts.push(a);
    return a;
  }

  push(baseParams);
  if (bestOf(attempts).result && bestOf(attempts).result.found) return { best: bestOf(attempts), attempts: attempts };

  if (baseParams.candidateLimit < 12) {
    push(Object.assign({}, baseParams, { candidateLimit: 12 }));
    if (bestOf(attempts).result && bestOf(attempts).result.found) return { best: bestOf(attempts), attempts: attempts };
  }

  var altMode = baseParams.dpKeyMode === "region" ? "location"
    : (baseParams.dpKeyMode === "location" ? "region" : "region");
  push(Object.assign({}, baseParams, { dpKeyMode: altMode, candidateLimit: Math.max(baseParams.candidateLimit, 8) }));
  if (bestOf(attempts).result && bestOf(attempts).result.found) return { best: bestOf(attempts), attempts: attempts };

  var best = bestOf(attempts);
  var exhausted = resultBudgetExhausted(best ? best.result : null);
  if (exhausted || (best && !best.result.found)) {
    var doubleExpansions = baseParams.maxExpansions ? baseParams.maxExpansions * 2 : 16000;
    var doubleRuntime = baseParams.maxRuntimeMs ? baseParams.maxRuntimeMs * 2 : 30000;
    push(Object.assign({}, baseParams, {
      maxExpansions: doubleExpansions,
      maxRuntimeMs: doubleRuntime,
      candidateLimit: Math.max(baseParams.candidateLimit, 8),
    }));
    if (bestOf(attempts).result && bestOf(attempts).result.found) return { best: bestOf(attempts), attempts: attempts };
  }

  if ((baseParams.candidateLimit || 8) < 16) {
    push(Object.assign({}, baseParams, { candidateLimit: 16 }));
    if (bestOf(attempts).result && bestOf(attempts).result.found) return { best: bestOf(attempts), attempts: attempts };
  }

  return { best: bestOf(attempts), attempts: attempts };
}

// ──────────────────────────────────────
// Proof claim & downgrade logic
// ──────────────────────────────────────

function buildFinalProofClaim(result, regionSpec) {
  var claim;
  try {
    claim = solver.buildRegionProofClaim(result, regionSpec);
  } catch (e) {
    claim = {
      proofLevel: "not-found",
      completeWithinActionSet: false,
      actionTrimmed: 0,
      stoppedReasons: [],
      expansionBudgetExhausted: false,
      unsafeStopOnFirstGoal: false,
    };
  }

  if (!result || !result.found) {
    return {
      proofLevel: "not-found",
      completeWithinActionSet: false,
      actionTrimmed: (claim && claim.actionTrimmed) || 0,
      stoppedReasons: (claim && claim.stoppedReasons) || [],
      expansionBudgetExhausted: (claim && claim.expansionBudgetExhausted) || false,
      unsafeStopOnFirstGoal: (claim && claim.unsafeStopOnFirstGoal) || false,
    };
  }

  if (typeof claim !== "object" || !claim) {
    claim = {
      proofLevel: "candidate",
      completeWithinActionSet: false,
      actionTrimmed: 0,
      stoppedReasons: [],
      expansionBudgetExhausted: false,
      unsafeStopOnFirstGoal: false,
    };
  }

  var downgrade = false;
  if (claim.actionTrimmed > 0) downgrade = true;
  if (claim.expansionBudgetExhausted) downgrade = true;
  if (Array.isArray(claim.stoppedReasons) && claim.stoppedReasons.length > 0) {
    if (claim.stoppedReasons.indexOf("time-limit") >= 0) downgrade = true;
  }
  if (claim.unsafeStopOnFirstGoal) downgrade = true;

  if (downgrade || claim.proofLevel === "candidate") {
    claim.proofLevel = "candidate";
    claim.completeWithinActionSet = false;
  }

  return claim;
}

// ──────────────────────────────────────
// Output helpers
// ──────────────────────────────────────

function totalExpansions(result) {
  if (!result || !result.segmentResults) return 0;
  var sum = 0;
  for (var i = 0; i < result.segmentResults.length; i++) {
    var seg = result.segmentResults[i];
    var atts = seg.attempts || [];
    for (var j = 0; j < atts.length; j++) {
      sum += Number((((atts[j].diagnostics || {}).dp || {}).expansions) || 0);
    }
  }
  return sum;
}

function writeEmptyRouteJson(routePath, taskId) {
  try {
    fs.mkdirSync(path.dirname(routePath), { recursive: true });
  } catch (e) { /* ignore */ }
  var empty = {
    kind: "motapathfinder.route.v1",
    version: 1,
    taskId: taskId,
    decisions: [],
    metadata: { found: false, solver: "deepseek-v4-pro" },
  };
  fs.writeFileSync(routePath, JSON.stringify(empty, null, 2) + "\n");
}

function writeRouteJson(routePath, result, simulator, initialState, project, regionSpec) {
  if (!result || !result.found || !result.finalCandidate || !result.finalCandidate.state) return false;
  try {
    var finalState = result.finalCandidate.state;
    finalState.route = Array.isArray(result.finalCandidate.route)
      ? result.finalCandidate.route.slice()
      : (finalState.route || []);
    var routeRecord = solver.buildRouteRecord({
      project: project,
      simulator: simulator,
      initialState: initialState,
      finalState: finalState,
      options: {
        rank: regionSpec.rank || "chaos",
        solver: "deepseek-v4-pro",
        profile: regionSpec.id,
        toFloor: finalState.floorId,
        goalType: "region",
        metadata: {
          kind: "region-dp",
          regionDp: {
            regionId: regionSpec.id,
            search: regionSpec.search || null,
          },
        },
      },
    });
    solver.writeRouteFile(routePath, routeRecord);
    return true;
  } catch (e) {
    console.error("Failed to write route: " + (e.message || String(e)));
    return false;
  }
}

function writeMetricsJson(metricsPath, taskId, result, proofClaim, expansions, wallMs) {
  var finalState = result && result.finalCandidate ? result.finalCandidate.state : null;
  var hero = finalState ? (finalState.hero || {}) : {};
  var metrics = {
    taskId: taskId,
    found: Boolean(result && result.found),
    liveVerified: false,
    proofLevel: proofClaim.proofLevel,
    completeWithinActionSet: proofClaim.completeWithinActionSet,
    proofClaim: proofClaim,
    expansions: expansions,
    wallMs: wallMs,
    final: finalState ? {
      floorId: finalState.floorId,
      hp: Number(hero.hp || 0),
      atk: Number(hero.atk || 0),
      def: Number(hero.def || 0),
      mdef: Number(hero.mdef || 0),
      exp: Number(hero.exp || 0),
    } : null,
    routeLength: result && result.finalCandidate ? ((result.finalCandidate.route || []).length) : 0,
    illegalWrites: 0,
  };
  fs.mkdirSync(path.dirname(metricsPath), { recursive: true });
  fs.writeFileSync(metricsPath, JSON.stringify(metrics, null, 2) + "\n");
  return metrics;
}

function classifyFailureClass(result) {
  if (!result || result.found) return null;
  if (resultBudgetExhausted(result)) return "budget-exhausted";
  return "no-path";
}

function missingGoalFields(result, regionSpec) {
  var goal = regionSpec.goal || {};
  if (goal.type !== "heroAtLeast" || !goal.minHero) return [];
  var hero = (result && result.finalCandidate && result.finalCandidate.state)
    ? (result.finalCandidate.state.hero || {})
    : {};
  var missing = [];
  var keys = Object.keys(goal.minHero);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if ((hero[k] || 0) < goal.minHero[k]) missing.push(k);
  }
  return missing;
}

function segmentSummary(seg) {
  var candidates = (seg.candidates || []).map(function (c) {
    return {
      id: c.id,
      hero: c.hero,
      effectiveHero: c.effectiveHero,
      tags: c.tags,
      routeLength: c.routeLength,
    };
  });
  return {
    segmentId: seg.segmentId,
    label: seg.label,
    found: seg.found,
    candidateCount: candidates.length,
    candidates: candidates,
    failurePropagation: seg.failurePropagation || null,
  };
}

function writeDiagnosticsJson(diagPath, taskId, result, proofClaim, attempts, regionSpec) {
  var diagnostics = {
    taskId: taskId,
    found: Boolean(result && result.found),
    proofClaim: proofClaim,
    segments: (result && result.segmentResults ? result.segmentResults.map(segmentSummary) : []),
    failedSegmentId: (result && result.failedSegment) ? result.failedSegment.segmentId : null,
    failureClass: classifyFailureClass(result),
    missingGoalFields: missingGoalFields(result, regionSpec),
    attempts: (attempts || []).map(function (a, i) {
      return {
        attemptIndex: i,
        params: a.params,
        found: a.result ? a.result.found : false,
        error: a.error,
        wallMs: a.wallMs,
      };
    }),
  };
  fs.mkdirSync(path.dirname(diagPath), { recursive: true });
  fs.writeFileSync(diagPath, JSON.stringify(diagnostics, null, 2) + "\n");
  return diagnostics;
}

function writeReportMd(reportPath, taskId, found, proofLevel, routeLength, expansions, wallMs, failureClass, attempts) {
  var lines = [];
  lines.push("# Agent Report: deepseek-v4-pro");
  lines.push("");
  lines.push("## Result");
  lines.push("- Task: " + taskId);
  lines.push("- Found: " + (found ? "true" : "false"));
  lines.push("- Proof level: " + proofLevel);
  lines.push("- Route length: " + routeLength);
  lines.push("- Expansions: " + expansions);
  lines.push("- Wall ms: " + wallMs);
  lines.push("");
  lines.push("## Strategy");
  lines.push("- Algorithm: segment DP via solver.runMilestoneGraph");
  lines.push("- stopOnFirstGoal: always false (skyline candidate mode)");
  lines.push("- enableFailureBacktracking: true");
  lines.push("- Fallback attempts: " + (attempts ? attempts.length : 0));
  lines.push("");
  lines.push("## Failure / Diagnostics");
  if (found) {
    lines.push("- Route found successfully.");
    lines.push("- Proof: " + proofLevel);
  } else {
    lines.push("- Failure class: " + (failureClass || "unknown"));
    lines.push("- No valid route could be constructed within budget.");
  }
  if (attempts && attempts.length > 1) {
    lines.push("");
    lines.push("### Attempts");
    for (var i = 0; i < attempts.length; i++) {
      var a = attempts[i];
      var af = a.result && a.result.found;
      lines.push("- Attempt " + i + ": candidateLimit=" + a.params.candidateLimit + ", dpKeyMode=" + (a.params.dpKeyMode || "default") + ", found=" + af + ", wallMs=" + a.wallMs);
    }
  }

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, lines.join("\n") + "\n");
}

// ──────────────────────────────────────
// Failure output (crash / no route)
// ──────────────────────────────────────

function writeFailureOutputs(filePaths, taskId, failureClass, wallMs) {
  var failClaim = {
    proofLevel: "not-found",
    completeWithinActionSet: false,
    actionTrimmed: 0,
    stoppedReasons: [],
    expansionBudgetExhausted: false,
    unsafeStopOnFirstGoal: false,
  };
  var metrics = {
    taskId: taskId,
    found: false,
    liveVerified: false,
    proofLevel: "not-found",
    completeWithinActionSet: false,
    proofClaim: failClaim,
    expansions: 0,
    wallMs: wallMs,
    routeLength: 0,
    illegalWrites: 0,
    final: null,
  };
  var diagnostics = {
    taskId: taskId,
    found: false,
    proofClaim: failClaim,
    segments: [],
    failedSegmentId: null,
    failureClass: failureClass,
    missingGoalFields: [],
    attempts: [],
  };
  try { fs.mkdirSync(path.dirname(filePaths.metrics), { recursive: true }); } catch (e) { /* ignore */ }
  try { fs.writeFileSync(filePaths.metrics, JSON.stringify(metrics, null, 2) + "\n"); } catch (e) { console.error("Cannot write metrics: " + (e.message || String(e))); }
  try { fs.writeFileSync(filePaths.diagnostics, JSON.stringify(diagnostics, null, 2) + "\n"); } catch (e) { console.error("Cannot write diagnostics: " + (e.message || String(e))); }
  try { writeEmptyRouteJson(filePaths.route, taskId); } catch (e) { console.error("Cannot write route: " + (e.message || String(e))); }
  writeReportMd(filePaths.report, taskId, false, "not-found", 0, 0, wallMs, failureClass, []);
}

// ──────────────────────────────────────
// Whiteisland Trial subprocess (compat only)
// ──────────────────────────────────────

function runViaCanonicalSolver(filePaths, regionSpecPath, projectRoot, regionSpec) {
  var solverDir = path.resolve(__dirname, "..", "..", "..", "shared-solver");
  var canonicalScript = path.join(solverDir, "run-region-dp.js");

  var search = regionSpec.search || {};
  var dpBudget = regionSpec.dpBudget || search.dpBudget || {};

  var cmd = [
    process.execPath,
    canonicalScript,
    "--project-root=" + projectRoot,
    "--region-spec=" + regionSpecPath,
    "--out=" + filePaths.route,
    "--metrics=" + filePaths.metrics,
    "--diagnostics=" + filePaths.diagnostics,
    "--candidate-limit=" + String(search.candidateLimit || 4),
    "--stop-on-first-goal=0",
  ];

  if (search.dpKeyMode) cmd.push("--dp-key-mode=" + search.dpKeyMode);
  if (dpBudget.maxExpansions) cmd.push("--max-expansions=" + dpBudget.maxExpansions);
  if (dpBudget.maxRuntimeMs) cmd.push("--max-runtime-ms=" + dpBudget.maxRuntimeMs);

  var t0 = Date.now();
  var proc = cp.spawnSync(cmd[0], cmd.slice(1), {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 20,
  });
  var wallMs = Date.now() - t0;

  if (proc.error || proc.status !== 0) {
    writeFailureOutputs(filePaths, regionSpec.id,
      proc.error ? "subprocess-error" : "subprocess-failed", wallMs);
    if (proc.error) {
      console.error("Canonical subprocess error: " + (proc.error.message || String(proc.error)));
    } else {
      console.error("Canonical subprocess exited " + proc.status + ": " + (proc.stderr || "").slice(0, 500));
    }
    process.exitCode = 1;
    return;
  }

  var metrics = null;
  var found = false;
  var routeLength = 0;

  try {
    if (fs.existsSync(filePaths.metrics)) {
      metrics = JSON.parse(fs.readFileSync(filePaths.metrics, "utf8"));
      found = Boolean(metrics.found);
    }
  } catch (e) {
    console.error("Failed to read canonical metrics: " + (e.message || String(e)));
  }

  if (fs.existsSync(filePaths.route)) {
    try {
      var route = JSON.parse(fs.readFileSync(filePaths.route, "utf8"));
      routeLength = (route.decisions || []).length;
    } catch (e) { /* ignore */ }
  } else {
    writeEmptyRouteJson(filePaths.route, regionSpec.id);
  }

  var proofLevel = (metrics && metrics.proofLevel) || (found ? "candidate" : "not-found");
  var expansions = (metrics && metrics.expansions) || 0;

  var canonAttempts = [{
    attemptIndex: 0,
    params: { mode: "canonical-subprocess" },
    found: found,
    wallMs: wallMs,
  }];

  writeReportMd(filePaths.report, regionSpec.id, found, proofLevel,
    routeLength, expansions, wallMs,
    found ? null : "canonical-subprocess-failed", canonAttempts);
}

// ──────────────────────────────────────
// Main
// ──────────────────────────────────────

function main() {
  var startedAt = Date.now();
  var taskId = null;
  var filePaths = {};

  try {
    var args = parseArgs(process.argv.slice(2));

    taskId = argVal(args, "task-id", "BENCHMARK_TASK_ID", null, true);
    var projectRoot = argVal(args, "project-root", null, null, true);
    var regionSpecPath = argVal(args, "region-spec", null, null, true);
    var runDir = argVal(args, "run-dir", "AGENT_RUN_DIR", null, true);

    filePaths = {
      taskDir: runDir,
      route: argVal(args, "out", "AGENT_ROUTE_OUT", null, true),
      metrics: argVal(args, "metrics", "AGENT_METRICS_OUT", null, true),
      diagnostics: argVal(args, "diagnostics", "AGENT_DIAGNOSTICS_OUT", null, true),
      report: argVal(args, "report", "AGENT_REPORT_OUT", null, true),
    };

    var regionSpec = solver.loadRegionSpec(regionSpecPath);
    var start = regionSpec.start || {};

    if (start.type === "whiteislandTrial") {
      runViaCanonicalSolver(filePaths, regionSpecPath, projectRoot, regionSpec);
      return;
    }

    var project = solver.loadProject(projectRoot);
    var rank = regionSpec.rank || "chaos";
    var simulator = createSimulatorFromSpec(project, regionSpec);
    var initialState = simulator.createInitialState({ rank: rank });
    var milestoneSpec = solver.buildRegionMilestoneSpec(project, regionSpec);

    var searchConfig = regionSpec.search || {};
    var dpBudget = regionSpec.dpBudget || searchConfig.dpBudget || {};

    var fb = runSearchWithFallback(simulator, initialState, milestoneSpec, searchConfig, dpBudget);
    var best = fb.best;
    var attempts = fb.attempts;
    var result = (best && best.result) || { found: false, segmentResults: [], failedSegment: null, finalCandidate: null };

    var proofClaim = buildFinalProofClaim(result, regionSpec);
    var totalExp = totalExpansions(result);
    var totalWallMs = Date.now() - startedAt;

    if (result.found && result.finalCandidate && result.finalCandidate.state) {
      writeRouteJson(filePaths.route, result, simulator, initialState, project, regionSpec);
    } else {
      writeEmptyRouteJson(filePaths.route, taskId);
    }

    writeMetricsJson(filePaths.metrics, taskId, result, proofClaim, totalExp, totalWallMs);

    var fullAttempts = (attempts || []).map(function (a, i) {
      return {
        attemptIndex: i,
        params: a.params,
        result: a.result,
        found: Boolean(a.result && a.result.found),
        error: a.error,
        wallMs: a.wallMs,
      };
    });

    writeDiagnosticsJson(filePaths.diagnostics, taskId, result, proofClaim, fullAttempts, regionSpec);

    var routeLength = (result.finalCandidate && result.finalCandidate.route)
      ? result.finalCandidate.route.length
      : 0;

    writeReportMd(filePaths.report, taskId, result.found, proofClaim.proofLevel,
      routeLength, totalExp, totalWallMs,
      classifyFailureClass(result), fullAttempts);

  } catch (error) {
    var wallMs = Date.now() - startedAt;
    console.error(error && error.stack ? error.stack : String(error));
    if (filePaths.route && taskId) {
      writeFailureOutputs(filePaths, taskId, "crash", wallMs);
    }
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}
