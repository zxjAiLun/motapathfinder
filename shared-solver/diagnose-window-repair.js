"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { parseKeyValueArgs } = require("./lib/cli-options");
const { loadProject } = require("./lib/project-loader");
const { buildRouteRecord, createStateFromSnapshot, readRouteFile, writeRouteFile } = require("./lib/route-store");
const { StaticSimulator } = require("./lib/simulator");
const { replayDecisionList, validateCandidateFully } = require("./lib/route-window-repair");

const DEFAULT_PROJECT_ROOT = path.resolve(
  __dirname,
  "..",
  "Only upV2.1",
  "Only upV2.1",
);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function heroSnapshot(state) {
  const hero = (state || {}).hero || {};
  return {
    floorId: state && state.floorId,
    loc: hero.loc ? { ...hero.loc } : null,
    hp: number(hero.hp, 0),
    atk: number(hero.atk, 0),
    def: number(hero.def, 0),
    mdef: number(hero.mdef, 0),
    lv: number(hero.lv, 0),
    exp: number(hero.exp, 0),
  };
}

function actionKind(summary) {
  const text = String(summary || "");
  const colon = text.indexOf(":");
  const at = text.indexOf("@");
  const end = colon >= 0 && at >= 0 ? Math.min(colon, at) : Math.max(colon, at);
  return end >= 0 ? text.slice(0, end) : (text || "unknown");
}

function actionTarget(summary) {
  const text = String(summary || "");
  const at = text.indexOf("@");
  return at >= 0 ? text.slice(at + 1) : "";
}

function decision(summary) {
  return { summary };
}

function replayTrace(simulator, startState, decisions) {
  let state = startState;
  const steps = [];
  for (let index = 0; index < decisions.length; index += 1) {
    const entry = decisions[index];
    const summary = entry.summary;
    const before = heroSnapshot(state);
    const replay = replayDecisionList(simulator, state, [entry]);
    if (!replay.ok) {
      return {
        ok: false,
        failure: { ...replay.failure, index, summary },
        steps,
        state,
      };
    }
    state = replay.state;
    const after = heroSnapshot(state);
    steps.push({
      index,
      summary,
      kind: actionKind(summary),
      target: actionTarget(summary),
      before,
      after,
      hpDelta: after.hp - before.hp,
      hpLoss: Math.max(0, before.hp - after.hp),
      hpGain: Math.max(0, after.hp - before.hp),
    });
  }
  return { ok: true, steps, state };
}

function summarizeTrace(trace) {
  const totalsByKind = {};
  for (const step of trace.steps || []) {
    if (!totalsByKind[step.kind]) {
      totalsByKind[step.kind] = { count: 0, hpLoss: 0, hpGain: 0 };
    }
    totalsByKind[step.kind].count += 1;
    totalsByKind[step.kind].hpLoss += step.hpLoss;
    totalsByKind[step.kind].hpGain += step.hpGain;
  }
  return {
    ok: trace.ok,
    failure: trace.failure || null,
    stepCount: (trace.steps || []).length,
    final: trace.state ? heroSnapshot(trace.state) : null,
    totalsByKind,
  };
}

function multisetDiff(leftSummaries, rightSummaries) {
  const rightCounts = new Map();
  for (const summary of rightSummaries) {
    rightCounts.set(summary, (rightCounts.get(summary) || 0) + 1);
  }
  const onlyLeft = [];
  for (const summary of leftSummaries) {
    const count = rightCounts.get(summary) || 0;
    if (count > 0) {
      rightCounts.set(summary, count - 1);
    } else {
      onlyLeft.push(summary);
    }
  }
  const onlyRight = [];
  for (const [summary, count] of rightCounts.entries()) {
    for (let i = 0; i < count; i += 1) onlyRight.push(summary);
  }
  return { onlyLeft, onlyRight };
}

function actionIdentity(summary) {
  const text = String(summary || "");
  if (text.startsWith("battle:")) return text;
  if (text.startsWith("pickup:")) return text;
  if (text.startsWith("interactPickup:")) return text;
  if (text.startsWith("openDoor:")) return text;
  if (text.startsWith("useTool:")) return text;
  if (text.startsWith("equip:")) return text;
  return text;
}

function uniqueSummaries(summaries) {
  const seen = new Set();
  const result = [];
  for (const summary of summaries || []) {
    const key = actionIdentity(summary);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(summary);
  }
  return result;
}

function firstDivergence(left, right) {
  const max = Math.max(left.length, right.length);
  for (let i = 0; i < max; i += 1) {
    if (left[i] !== right[i]) {
      return {
        index: i,
        baseline: left[i] || null,
        candidate: right[i] || null,
      };
    }
  }
  return null;
}

function pickCandidate(report, candidateId) {
  const validations = Array.isArray(report.validations) ? report.validations : [];
  if (candidateId) {
    const found = validations.find((entry) => entry.candidateId === candidateId);
    if (!found) throw new Error(`Candidate not found in report: ${candidateId}`);
    return found;
  }
  return validations
    .slice()
    .sort((a, b) =>
      Number(b.accepted) - Number(a.accepted)
      || number(b.finalHp, -Infinity) - number(a.finalHp, -Infinity)
      || String(a.candidateId || "").localeCompare(String(b.candidateId || "")),
    )[0] || null;
}

function buildDiagnosis(project, simulator, route, report, options) {
  const windowStart = number(options.windowStart, report.windowStart);
  const windowEnd = number(options.windowEnd, report.windowEnd);
  const startIndex = windowStart - 1;
  const endExclusive = windowEnd;
  if (startIndex < 0 || endExclusive < windowStart || endExclusive > route.decisions.length) {
    throw new Error(`Invalid window ${windowStart}-${windowEnd} for ${route.decisions.length} decisions`);
  }

  const initialState = createStateFromSnapshot(
    project,
    route.start.snapshot,
    { rank: (route.source || {}).rank || "chaos" },
  );
  const prefix = route.decisions.slice(0, startIndex);
  const prefixReplay = replayDecisionList(simulator, initialState, prefix);
  if (!prefixReplay.ok) {
    throw new Error(`Prefix replay failed: ${JSON.stringify(prefixReplay.failure)}`);
  }

  const candidate = pickCandidate(report, options.candidateId);
  if (!candidate) throw new Error("No validation candidates found in report.");

  const baselineWindow = route.decisions.slice(startIndex, endExclusive)
    .map((entry) => decision(entry.summary));
  const candidateWindow = (candidate.actionTrace || []).map(decision);
  const suffix = route.decisions.slice(endExclusive);

  const baselineTrace = replayTrace(simulator, prefixReplay.state, baselineWindow);
  const candidateTrace = replayTrace(simulator, prefixReplay.state, candidateWindow);
  const baselineSummaries = baselineWindow.map((entry) => entry.summary);
  const candidateSummaries = candidateWindow.map((entry) => entry.summary);
  const diff = multisetDiff(baselineSummaries, candidateSummaries);
  const baselineMobility = baselineTrace.steps.filter((step) =>
    step.kind === "changeFloor" || step.kind === "floorFly"
  );
  const candidateMobility = candidateTrace.steps.filter((step) =>
    step.kind === "changeFloor" || step.kind === "floorFly"
  );
  const costlyCandidateBattles = candidateTrace.steps
    .filter((step) => step.kind === "battle")
    .sort((a, b) => b.hpLoss - a.hpLoss)
    .slice(0, 12)
    .map((step) => ({
      index: step.index,
      summary: step.summary,
      hpLoss: step.hpLoss,
      beforeHp: step.before.hp,
      afterHp: step.after.hp,
      floorId: step.before.floorId,
      loc: step.before.loc,
    }));

  const baselineSummary = summarizeTrace(baselineTrace);
  const candidateSummary = summarizeTrace(candidateTrace);
  const finalGoal =
    (report.windowRepair && report.windowRepair.finalGoal) ||
    report.finalGoal ||
    null;
  const insertionProbes = probeSingleInsertions(
    project,
    simulator,
    initialState,
    prefix,
    suffix,
    candidateWindow,
    diff.onlyLeft,
    finalGoal,
    report.baselineHp,
  );
  const replacementProbes = probeSingleReplacements(
    project,
    simulator,
    initialState,
    prefix,
    suffix,
    candidateWindow,
    diff.onlyLeft,
    finalGoal,
    report.baselineHp,
  );
  const insertionReplacementProbes = probeInsertionThenReplacement(
    project,
    simulator,
    initialState,
    prefix,
    suffix,
    candidateWindow,
    diff.onlyLeft,
    finalGoal,
    report.baselineHp,
    insertionProbes,
  );
  const insertionSwapProbes = probeInsertionThenSwap(
    project,
    simulator,
    initialState,
    prefix,
    suffix,
    candidateWindow,
    finalGoal,
    report.baselineHp,
    insertionProbes,
  );
  return {
    kind: "window-repair-diagnosis",
    route: options.routeFile,
    report: options.reportFile,
    candidateId: candidate.candidateId,
    windowStart,
    windowEnd,
    baselineFinalHp: report.baselineHp,
    candidateFinalHp: candidate.finalHp,
    finalHpGap: candidate.finalHp == null || report.baselineHp == null
      ? null
      : number(report.baselineHp, 0) - number(candidate.finalHp, 0),
    candidateRejectedReason: candidate.rejectedReason || null,
    candidateGoalFailures: candidate.goalFailures || [],
    firstDivergence: firstDivergence(baselineSummaries, candidateSummaries),
    baseline: baselineSummary,
    candidate: candidateSummary,
    windowHpGap: baselineSummary.final && candidateSummary.final
      ? baselineSummary.final.hp - candidateSummary.final.hp
      : null,
    baselineOnlyActions: diff.onlyLeft,
    candidateOnlyActions: diff.onlyRight,
    insertionProbes,
    replacementProbes,
    insertionReplacementProbes,
    insertionSwapProbes,
    baselineMobility: baselineMobility.map((step) => ({
      index: step.index,
      summary: step.summary,
      before: step.before,
      after: step.after,
    })),
    candidateMobility: candidateMobility.map((step) => ({
      index: step.index,
      summary: step.summary,
      before: step.before,
      after: step.after,
    })),
    costlyCandidateBattles,
  };
}

function isProbeableSummary(summary) {
  const text = String(summary || "");
  return text.startsWith("battle:")
    || text.startsWith("pickup:")
    || text.startsWith("interactPickup:")
    || text.startsWith("openDoor:")
    || text.startsWith("useTool:")
    || text.startsWith("equip:")
    || text.startsWith("changeFloor@")
    || text.startsWith("floorFly:");
}

function probeSingleInsertions(
  project,
  simulator,
  initialState,
  prefixDecisions,
  suffixDecisions,
  candidateWindow,
  baselineOnlySummaries,
  finalGoal,
  baselineHp,
) {
  const probeActions = uniqueSummaries(baselineOnlySummaries)
    .filter(isProbeableSummary);
  const probes = [];
  for (const summary of probeActions) {
    for (let insertAt = 0; insertAt <= candidateWindow.length; insertAt += 1) {
      const patchedWindow = candidateWindow
        .slice(0, insertAt)
        .concat([decision(summary)])
        .concat(candidateWindow.slice(insertAt));
      const replay = replayDecisionList(
        simulator,
        initialState,
        []
          .concat(prefixDecisions)
          .concat(patchedWindow)
          .concat(suffixDecisions),
      );
      const goalFailures = replay.ok && finalGoal
        ? validateCandidateFully(project, replay.state, finalGoal)
        : [];
      const finalHp = replay.ok ? heroSnapshot(replay.state).hp : null;
      probes.push({
        summary,
        insertAt,
        ok: replay.ok,
        replayFailure: replay.ok ? null : replay.failure,
        goalFailures,
        finalHp,
        hpDeltaVsBaseline: finalHp == null || baselineHp == null
          ? null
          : finalHp - baselineHp,
      });
    }
  }
  return probes
    .filter((probe) => probe.ok || probe.insertAt === 0)
    .sort((left, right) =>
      Number(right.ok) - Number(left.ok)
      || (left.goalFailures || []).length - (right.goalFailures || []).length
      || number(right.finalHp, -Infinity) - number(left.finalHp, -Infinity)
      || String(left.summary).localeCompare(String(right.summary))
      || left.insertAt - right.insertAt,
    )
    .slice(0, 40);
}

function probeSingleReplacements(
  project,
  simulator,
  initialState,
  prefixDecisions,
  suffixDecisions,
  candidateWindow,
  baselineOnlySummaries,
  finalGoal,
  baselineHp,
) {
  const replacementActions = uniqueSummaries(baselineOnlySummaries)
    .filter(isProbeableSummary);
  const probes = [];
  for (let replaceAt = 0; replaceAt < candidateWindow.length; replaceAt += 1) {
    const original = candidateWindow[replaceAt] && candidateWindow[replaceAt].summary;
    for (const summary of replacementActions) {
      if (summary === original) continue;
      const patchedWindow = candidateWindow.slice();
      patchedWindow[replaceAt] = decision(summary);
      const replay = replayDecisionList(
        simulator,
        initialState,
        []
          .concat(prefixDecisions)
          .concat(patchedWindow)
          .concat(suffixDecisions),
      );
      const goalFailures = replay.ok && finalGoal
        ? validateCandidateFully(project, replay.state, finalGoal)
        : [];
      const finalHp = replay.ok ? heroSnapshot(replay.state).hp : null;
      probes.push({
        replaceAt,
        original,
        replacement: summary,
        ok: replay.ok,
        replayFailure: replay.ok ? null : replay.failure,
        goalFailures,
        finalHp,
        hpDeltaVsBaseline: finalHp == null || baselineHp == null
          ? null
          : finalHp - baselineHp,
      });
    }
  }
  return probes
    .filter((probe) => probe.ok || probe.replaceAt === 0)
    .sort((left, right) =>
      Number(right.ok) - Number(left.ok)
      || (left.goalFailures || []).length - (right.goalFailures || []).length
      || number(right.finalHp, -Infinity) - number(left.finalHp, -Infinity)
      || left.replaceAt - right.replaceAt
      || String(left.replacement).localeCompare(String(right.replacement)),
    )
    .slice(0, 40);
}

function probeInsertionThenReplacement(
  project,
  simulator,
  initialState,
  prefixDecisions,
  suffixDecisions,
  candidateWindow,
  baselineOnlySummaries,
  finalGoal,
  baselineHp,
  insertionProbes,
) {
  const replacementActions = uniqueSummaries(baselineOnlySummaries)
    .filter(isProbeableSummary);
  const seeds = (insertionProbes || [])
    .filter((probe) => probe.ok && (probe.goalFailures || []).length === 0)
    .slice()
    .sort((left, right) => number(right.finalHp, -Infinity) - number(left.finalHp, -Infinity))
    .slice(0, 3);
  const probes = [];
  for (const seed of seeds) {
    const seededWindow = candidateWindow
      .slice(0, seed.insertAt)
      .concat([decision(seed.summary)])
      .concat(candidateWindow.slice(seed.insertAt));
    for (let replaceAt = 0; replaceAt < seededWindow.length; replaceAt += 1) {
      const original = seededWindow[replaceAt] && seededWindow[replaceAt].summary;
      for (const replacement of replacementActions) {
        if (replacement === original) continue;
        const patchedWindow = seededWindow.slice();
        patchedWindow[replaceAt] = decision(replacement);
        const replay = replayDecisionList(
          simulator,
          initialState,
          []
            .concat(prefixDecisions)
            .concat(patchedWindow)
            .concat(suffixDecisions),
        );
        const goalFailures = replay.ok && finalGoal
          ? validateCandidateFully(project, replay.state, finalGoal)
          : [];
        const finalHp = replay.ok ? heroSnapshot(replay.state).hp : null;
        probes.push({
          insertedSummary: seed.summary,
          insertAt: seed.insertAt,
          replaceAt,
          original,
          replacement,
          ok: replay.ok,
          replayFailure: replay.ok ? null : replay.failure,
          goalFailures,
          finalHp,
          hpDeltaVsBaseline: finalHp == null || baselineHp == null
            ? null
            : finalHp - baselineHp,
        });
      }
    }
  }
  return probes
    .filter((probe) => probe.ok || probe.replaceAt === 0)
    .sort((left, right) =>
      Number(right.ok) - Number(left.ok)
      || (left.goalFailures || []).length - (right.goalFailures || []).length
      || number(right.finalHp, -Infinity) - number(left.finalHp, -Infinity)
      || left.insertAt - right.insertAt
      || left.replaceAt - right.replaceAt,
    )
    .slice(0, 60);
}

function bestSuccessfulProbe(diagnosis) {
  const all = []
    .concat((diagnosis.insertionSwapProbes || []).map((probe) => ({ type: "insert-swap", probe })))
    .concat((diagnosis.insertionReplacementProbes || []).map((probe) => ({ type: "insert-replace", probe })))
    .concat((diagnosis.insertionProbes || []).map((probe) => ({ type: "insert", probe })))
    .concat((diagnosis.replacementProbes || []).map((probe) => ({ type: "replace", probe })))
    .filter((entry) => entry.probe && entry.probe.ok && (entry.probe.goalFailures || []).length === 0);
  return all.sort((left, right) =>
    number(right.probe.finalHp, -Infinity) - number(left.probe.finalHp, -Infinity)
  )[0] || null;
}

function applyProbeToWindow(candidateWindow, selected) {
  let window = candidateWindow.slice();
  const probe = selected && selected.probe;
  if (!probe) return window;
  if (selected.type === "insert" || selected.type === "insert-replace" || selected.type === "insert-swap") {
    window = window
      .slice(0, probe.insertAt)
      .concat([decision(probe.insertedSummary || probe.summary)])
      .concat(window.slice(probe.insertAt));
  }
  if (selected.type === "replace" || selected.type === "insert-replace") {
    window = window.slice();
    window[probe.replaceAt] = decision(probe.replacement);
  }
  if (selected.type === "insert-swap") {
    window = window.slice();
    const left = probe.swap[0];
    const right = probe.swap[1];
    const temp = window[left];
    window[left] = window[right];
    window[right] = temp;
  }
  return window;
}

function materializeBestProbeRoute(project, simulator, route, report, diagnosis, options) {
  const selected = bestSuccessfulProbe(diagnosis);
  if (!selected) {
    return { ok: false, reason: "no-successful-probe" };
  }
  const windowStart = number(options.windowStart, report.windowStart);
  const windowEnd = number(options.windowEnd, report.windowEnd);
  const startIndex = windowStart - 1;
  const endExclusive = windowEnd;
  const candidate = pickCandidate(report, options.candidateId);
  const candidateWindow = (candidate.actionTrace || []).map(decision);
  const patchedWindow = applyProbeToWindow(candidateWindow, selected);
  const prefix = route.decisions.slice(0, startIndex);
  const suffix = route.decisions.slice(endExclusive);
  const initialState = createStateFromSnapshot(
    project,
    route.start.snapshot,
    { rank: (route.source || {}).rank || "chaos" },
  );
  const actionEntries = []
    .concat(prefix)
    .concat(patchedWindow)
    .concat(suffix);
  const replay = replayDecisionList(simulator, initialState, actionEntries);
  if (!replay.ok) {
    return { ok: false, reason: "replay-failed", failure: replay.failure, selected };
  }
  const finalGoal =
    (report.windowRepair && report.windowRepair.finalGoal) ||
    report.finalGoal ||
    null;
  const goalFailures = finalGoal
    ? validateCandidateFully(project, replay.state, finalGoal)
    : [];
  if (goalFailures.length > 0) {
    return { ok: false, reason: "goal-mismatch", goalFailures, selected };
  }
  const routeRecord = buildRouteRecord({
    project,
    simulator,
    initialState,
    finalState: replay.state,
    actionEntries,
    options: {
      rank: (route.source || {}).rank || "chaos",
      solver: "window-repair-probe",
      profile: report.profile || null,
      goalType: (route.goal || {}).type || "floor",
      toFloor: (route.goal || {}).floorId || (finalGoal && finalGoal.floorId) || replay.state.floorId,
      metadata: {
        ...(route.metadata || {}),
        windowRepairProbe: {
          sourceReport: options.reportFile,
          candidateId: candidate.candidateId,
          probeType: selected.type,
          probe: selected.probe,
        },
      },
      projectRoot: options.projectRoot || null,
    },
  });
  return {
    ok: true,
    route: routeRecord,
    selected,
    finalHp: heroSnapshot(replay.state).hp,
  };
}

function probeInsertionThenSwap(
  project,
  simulator,
  initialState,
  prefixDecisions,
  suffixDecisions,
  candidateWindow,
  finalGoal,
  baselineHp,
  insertionProbes,
) {
  const seed = (insertionProbes || [])
    .filter((probe) => probe.ok && (probe.goalFailures || []).length === 0)
    .slice()
    .sort((left, right) => number(right.finalHp, -Infinity) - number(left.finalHp, -Infinity))[0];
  if (!seed) return [];
  const seededWindow = candidateWindow
    .slice(0, seed.insertAt)
    .concat([decision(seed.summary)])
    .concat(candidateWindow.slice(seed.insertAt));
  const probes = [];
  for (let leftIndex = 0; leftIndex < seededWindow.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < seededWindow.length; rightIndex += 1) {
      const patchedWindow = seededWindow.slice();
      const tmp = patchedWindow[leftIndex];
      patchedWindow[leftIndex] = patchedWindow[rightIndex];
      patchedWindow[rightIndex] = tmp;
      const replay = replayDecisionList(
        simulator,
        initialState,
        []
          .concat(prefixDecisions)
          .concat(patchedWindow)
          .concat(suffixDecisions),
      );
      const goalFailures = replay.ok && finalGoal
        ? validateCandidateFully(project, replay.state, finalGoal)
        : [];
      const finalHp = replay.ok ? heroSnapshot(replay.state).hp : null;
      probes.push({
        insertedSummary: seed.summary,
        insertAt: seed.insertAt,
        swap: [leftIndex, rightIndex],
        leftSummary: seededWindow[leftIndex] && seededWindow[leftIndex].summary,
        rightSummary: seededWindow[rightIndex] && seededWindow[rightIndex].summary,
        ok: replay.ok,
        replayFailure: replay.ok ? null : replay.failure,
        goalFailures,
        finalHp,
        hpDeltaVsBaseline: finalHp == null || baselineHp == null
          ? null
          : finalHp - baselineHp,
      });
    }
  }
  return probes
    .filter((probe) => probe.ok || probe.swap[0] === 0)
    .sort((left, right) =>
      Number(right.ok) - Number(left.ok)
      || (left.goalFailures || []).length - (right.goalFailures || []).length
      || number(right.finalHp, -Infinity) - number(left.finalHp, -Infinity)
      || left.swap[0] - right.swap[0]
      || left.swap[1] - right.swap[1],
    )
    .slice(0, 60);
}

function main() {
  const args = parseKeyValueArgs(process.argv.slice(2));
  const routeFile = path.resolve(
    args.route || path.join(__dirname, "routes", "latest", "mt5-problem-before-9-10.route.json"),
  );
  const reportFile = path.resolve(
    args.report || path.join(__dirname, "routes", "generated", "window-repair-mt5-final-fly.json"),
  );
  const projectRoot = path.resolve(args["project-root"] || DEFAULT_PROJECT_ROOT);
  const outFile = args.out ? path.resolve(args.out) : null;
  const project = loadProject(projectRoot);
  const simulator = new StaticSimulator(project, {
    battleResolver: new FunctionBackedBattleResolver(project),
  });
  const route = readRouteFile(routeFile);
  const report = readJson(reportFile);
  const diagnosis = buildDiagnosis(project, simulator, route, report, {
    routeFile,
    reportFile,
    candidateId: args.candidate,
    windowStart: args["window-start"],
    windowEnd: args["window-end"],
  });
  if (args["out-route"]) {
    const routeResult = materializeBestProbeRoute(project, simulator, route, report, diagnosis, {
      routeFile,
      reportFile,
      projectRoot,
      candidateId: args.candidate,
      windowStart: args["window-start"],
      windowEnd: args["window-end"],
    });
    if (!routeResult.ok) {
      throw new Error(`Failed to materialize probe route: ${routeResult.reason}`);
    }
    const outRouteFile = path.resolve(args["out-route"]);
    fs.mkdirSync(path.dirname(outRouteFile), { recursive: true });
    writeRouteFile(outRouteFile, routeResult.route);
    diagnosis.materializedRoute = {
      file: outRouteFile,
      finalHp: routeResult.finalHp,
      probeType: routeResult.selected.type,
      probe: routeResult.selected.probe,
    };
    console.log(`Window repair probe route written: ${outRouteFile}`);
  }
  if (outFile) {
    writeJson(outFile, diagnosis);
    console.log(`Window repair diagnosis written: ${outFile}`);
  } else {
    console.log(JSON.stringify(diagnosis, null, 2));
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

module.exports = {
  buildDiagnosis,
  main,
};
