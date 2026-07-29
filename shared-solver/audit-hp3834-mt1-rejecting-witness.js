"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { getMilestoneSpec } = require("./lib/milestone-spec");
const { buildSegmentActionProvider, runMilestoneGraph } = require("./lib/segment-dp");
const { resolveRecordedAction } = require("./lib/route-store");
const { strictReplayRoute } = require("./lib/agenda-policy-evaluation");
const { cloneState, listFloorMutationSummary } = require("./lib/state");
const { buildDominanceKey, buildStateKey } = require("./lib/state-key");
const {
  actionFingerprint,
  compactState,
  createLineageObserver,
  heroSummary,
  makeSimulator,
  replayRoute,
} = require("./audit-hp3834-mt1-first-divergence");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const DEFAULT_TEACHER_ROUTE = path.resolve(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "mt1-mt3-i893-hp8425.current-exact.route.json",
);
const DEFAULT_PRODUCTION_ROUTE = path.resolve(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "mt2-local-best-first-hp4176.route.json",
);
const DEFAULT_OUT = path.resolve(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "mt1-gate-1559-rejecting-witness-continuation-audit.json",
);

function parseArgs(argv) {
  return argv.reduce((result, token) => {
    const match = /^--([^=]+)=(.*)$/.exec(token);
    if (match) result[match[1]] = match[2];
    return result;
  }, {});
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function relative(file) {
  return path.relative(ROOT, file) || ".";
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function gitCommit() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" });
  return result.status === 0 ? String(result.stdout || "").trim() || null : null;
}

function cleanWorktree() {
  const result = spawnSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" });
  return result.status === 0 && String(result.stdout || "").trim() === "";
}

function jsonClone(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function actionMatches(simulator, action, decision) {
  if (!action || !decision) return false;
  const expectedFingerprint = decision.fingerprint || decision.actionFingerprint || null;
  const actualFingerprint = actionFingerprint(simulator, action);
  if (expectedFingerprint && actualFingerprint === expectedFingerprint) return true;
  return Boolean(decision.summary && action.summary === decision.summary);
}

function compactAction(simulator, action) {
  if (!action) return null;
  return {
    kind: action.kind || null,
    summary: action.summary || null,
    fingerprint: actionFingerprint(simulator, action),
  };
}

function compactRegion(simulator, state) {
  if (!state) return null;
  try {
    const region = simulator.buildReachableRegionSignature(state);
    return {
      regionKey: region.regionKey || "",
      reachableEndpointsKey: region.reachableEndpointsKey || "",
      counts: region.counts || null,
    };
  } catch (error) {
    return {
      regionKey: null,
      reachableEndpointsKey: null,
      counts: null,
      error: String(error.message || error),
    };
  }
}

function compactStateDiff(teacherState, witnessState) {
  if (!teacherState || !witnessState) return null;
  const teacherHero = teacherState.hero || {};
  const witnessHero = witnessState.hero || {};
  const hero = {};
  ["hp", "hpmax", "atk", "def", "mdef", "lv", "exp", "money", "mana"].forEach((field) => {
    if (Number(teacherHero[field] || 0) !== Number(witnessHero[field] || 0)) {
      hero[field] = {
        teacher: Number(teacherHero[field] || 0),
        witness: Number(witnessHero[field] || 0),
      };
    }
  });
  const teacherLoc = teacherHero.loc || null;
  const witnessLoc = witnessHero.loc || null;
  const diff = {};
  if (teacherState.floorId !== witnessState.floorId || JSON.stringify(teacherLoc) !== JSON.stringify(witnessLoc)) {
    diff.location = {
      teacher: { floorId: teacherState.floorId, loc: jsonClone(teacherLoc) },
      witness: { floorId: witnessState.floorId, loc: jsonClone(witnessLoc) },
    };
  }
  if (Object.keys(hero).length > 0) diff.hero = hero;
  if (JSON.stringify(teacherState.inventory || {}) !== JSON.stringify(witnessState.inventory || {})) {
    diff.inventory = { teacher: jsonClone(teacherState.inventory || {}), witness: jsonClone(witnessState.inventory || {}) };
  }
  if (JSON.stringify(teacherState.flags || {}) !== JSON.stringify(witnessState.flags || {})) {
    diff.flags = { teacher: jsonClone(teacherState.flags || {}), witness: jsonClone(witnessState.flags || {}) };
  }
  const teacherVisited = Object.keys(teacherState.visitedFloors || {}).filter((id) => teacherState.visitedFloors[id]).sort();
  const witnessVisited = Object.keys(witnessState.visitedFloors || {}).filter((id) => witnessState.visitedFloors[id]).sort();
  if (JSON.stringify(teacherVisited) !== JSON.stringify(witnessVisited)) {
    diff.visitedFloors = { teacher: teacherVisited, witness: witnessVisited };
  }
  const teacherMutations = listFloorMutationSummary(teacherState.floorStates || {});
  const witnessMutations = listFloorMutationSummary(witnessState.floorStates || {});
  if (JSON.stringify(teacherMutations) !== JSON.stringify(witnessMutations)) {
    diff.mutations = { teacher: teacherMutations, witness: witnessMutations };
  }
  return diff;
}

function meetsGoal(state, segment) {
  if (!state || !segment || !segment.goal) return false;
  if (segment.goal.floorId && state.floorId !== segment.goal.floorId) return false;
  return Object.entries(segment.goal.minHero || {}).every(([field, value]) =>
    Number(state.hero && state.hero[field] || 0) >= Number(value),
  );
}

function chooseSuccessor(successors, expectedPostExactStateKey) {
  const list = Array.isArray(successors) ? successors.filter(Boolean) : [];
  if (list.length === 0) return null;
  if (expectedPostExactStateKey) {
    const exact = list.find((state) => buildStateKey(state) === expectedPostExactStateKey);
    if (exact) return exact;
  }
  return list[0];
}

function providerResult(simulator, provider, state, decision) {
  let actions = [];
  let error = null;
  try {
    const result = provider(simulator, state);
    actions = Array.isArray(result) ? result : (result && result.actions) || [];
  } catch (caught) {
    error = String(caught.message || caught);
  }
  return {
    actions,
    error,
    containsAction: actions.some((action) => actionMatches(simulator, action, decision)),
  };
}

function continueTeacherSuffix(project, simulator, provider, teacherStartState, witnessStartState, decisions, segment) {
  let teacherState = cloneState(teacherStartState);
  let witnessState = witnessStartState ? cloneState(witnessStartState) : null;
  const steps = [];
  let failure = null;
  let teacherReachedGoal = meetsGoal(teacherState, segment);
  let witnessReachedGoal = meetsGoal(witnessState, segment);

  for (const decision of decisions) {
    const teacherProvider = providerResult(simulator, provider, teacherState, decision);
    const witnessProvider = witnessState
      ? providerResult(simulator, provider, witnessState, decision)
      : { actions: [], error: "witness-state-unavailable", containsAction: false };
    const teacherResolved = teacherState && teacherProvider.error == null
      ? resolveRecordedAction(simulator, teacherState, decision, {
          project,
          candidates: teacherProvider.actions,
        })
      : { action: null, reason: teacherProvider.error || "teacher-state-unavailable" };
    const witnessResolved = witnessState && witnessProvider.error == null
      ? resolveRecordedAction(simulator, witnessState, decision, {
          project,
          candidates: witnessProvider.actions,
        })
      : { action: null, reason: witnessProvider.error || "witness-state-unavailable" };

    const apply = (state, resolved) => {
      if (!state || !resolved || !resolved.action) {
        return {
          action: null,
          resolved: false,
          reason: resolved && resolved.reason || "action-unresolved",
          successorGenerated: false,
          state: null,
        };
      }
      try {
        const result = simulator.applyAction(state, resolved.action, { storeRoute: false });
        const successors = Array.isArray(result) ? result : [result];
        return {
          action: compactAction(simulator, resolved.action),
          resolved: true,
          reason: resolved.matchType || null,
          successorGenerated: successors.filter(Boolean).length > 0,
          state: chooseSuccessor(successors, decision.postExactStateKey),
        };
      } catch (error) {
        return {
          action: compactAction(simulator, resolved.action),
          resolved: true,
          reason: "action-apply-error",
          successorGenerated: false,
          state: null,
          error: String(error.message || error),
        };
      }
    };

    const teacherApplied = apply(teacherState, teacherResolved);
    const witnessApplied = apply(witnessState, witnessResolved);
    const teacherNext = teacherApplied.state;
    const witnessNext = witnessApplied.state;
    const teacherPostExactStateKey = teacherNext ? buildStateKey(teacherNext) : null;
    const teacherPostDominanceKey = teacherNext ? buildDominanceKey(teacherNext) : null;
    const witnessPostExactStateKey = witnessNext ? buildStateKey(witnessNext) : null;
    const witnessPostDominanceKey = witnessNext ? buildDominanceKey(witnessNext) : null;
    const expectedTeacherPostDominanceKey = decision.postDominanceKey ||
      (teacherNext ? buildDominanceKey(teacherNext) : null);
    const step = {
      decisionIndex: decision.index,
      action: {
        summary: decision.summary || null,
        kind: decision.kind || null,
        fingerprint: decision.fingerprint || decision.actionFingerprint || null,
      },
      teacher: {
        providerContainsAction: teacherProvider.containsAction,
        providerError: teacherProvider.error,
        resolved: teacherApplied.resolved,
        resolveReason: teacherApplied.reason,
        successorGenerated: teacherApplied.successorGenerated,
        postExactStateKey: teacherPostExactStateKey,
        expectedPostExactStateKey: decision.postExactStateKey || null,
        postExactMatchesExpected: Boolean(
          teacherPostExactStateKey &&
          decision.postExactStateKey &&
          teacherPostExactStateKey === decision.postExactStateKey,
        ),
        postDominanceKey: teacherPostDominanceKey,
        expectedPostDominanceKey: expectedTeacherPostDominanceKey,
        postDominanceMatchesExpected: Boolean(
          teacherPostDominanceKey &&
          expectedTeacherPostDominanceKey &&
          teacherPostDominanceKey === expectedTeacherPostDominanceKey,
        ),
        hero: teacherNext ? heroSummary(teacherNext) : null,
        reachedGoal: meetsGoal(teacherNext, segment),
      },
      witness: {
        providerContainsAction: witnessProvider.containsAction,
        providerError: witnessProvider.error,
        resolved: witnessApplied.resolved,
        resolveReason: witnessApplied.reason,
        successorGenerated: witnessApplied.successorGenerated,
        postExactStateKey: witnessPostExactStateKey,
        postDominanceKey: witnessPostDominanceKey,
        hero: witnessNext ? heroSummary(witnessNext) : null,
        reachedGoal: meetsGoal(witnessNext, segment),
      },
      comparison: {
        exactStateEqual: Boolean(
          teacherPostExactStateKey &&
          witnessPostExactStateKey &&
          teacherPostExactStateKey === witnessPostExactStateKey,
        ),
        dominanceKeyEqual: Boolean(
          teacherPostDominanceKey &&
          witnessPostDominanceKey &&
          teacherPostDominanceKey === witnessPostDominanceKey,
        ),
        hpDeltaWitnessMinusTeacher: teacherNext && witnessNext
          ? Number(witnessNext.hero && witnessNext.hero.hp || 0) - Number(teacherNext.hero && teacherNext.hero.hp || 0)
          : null,
        stateDiff: compactStateDiff(teacherNext, witnessNext),
      },
    };
    steps.push(step);
    teacherState = teacherNext;
    witnessState = witnessNext;
    teacherReachedGoal = meetsGoal(teacherState, segment);
    witnessReachedGoal = meetsGoal(witnessState, segment);
    if (!teacherApplied.resolved || !teacherApplied.successorGenerated) {
      failure = { side: "teacher", decisionIndex: decision.index, reason: teacherApplied.reason };
      break;
    }
    if (!witnessApplied.resolved || !witnessApplied.successorGenerated) {
      failure = { side: "witness", decisionIndex: decision.index, reason: witnessApplied.reason };
      break;
    }
    if (teacherReachedGoal && witnessReachedGoal) break;
  }

  const finalTeacherHero = teacherState && teacherState.hero || {};
  const finalWitnessHero = witnessState && witnessState.hero || {};
  const resourceNonInferior = Boolean(
    teacherState &&
    witnessState &&
    ["hp", "atk", "def", "mdef", "exp"].every((field) =>
      Number(finalWitnessHero[field] || 0) >= Number(finalTeacherHero[field] || 0),
    ),
  );
  const rejoinedExact = steps.some((step) => step.comparison.exactStateEqual);
  const completeSuffix = steps.length === decisions.length &&
    steps.every((step) => step.witness.resolved && step.witness.successorGenerated);
  return {
    decisionCount: decisions.length,
    steps,
    failure,
    teacherReachedGoal,
    witnessReachedGoal,
    completeSuffix,
    resourceNonInferior,
    rejoinedExact,
    teacherFinal: teacherState ? compactState(teacherState) : null,
    witnessFinal: witnessState ? compactState(witnessState) : null,
    compatibilityVerdict: completeSuffix && witnessReachedGoal && (resourceNonInferior || rejoinedExact)
      ? "continuation-compatible"
      : "continuation-incompatible",
  };
}

function compactSearch(result) {
  const segment = result && result.segmentResults && result.segmentResults[0] || null;
  const attempt = segment && segment.attempts && segment.attempts[0] || null;
  const dp = attempt && attempt.diagnostics && attempt.diagnostics.dp || {};
  return {
    found: Boolean(result && result.found),
    reachedMilestone: result && result.reachedMilestone || null,
    segment: segment
      ? {
          id: segment.segmentId,
          found: Boolean(segment.found),
          goalCount: Array.isArray(segment.candidates) ? segment.candidates.length : 0,
          attempts: [{
            found: Boolean(attempt && attempt.found),
            expansions: dp.expansions,
            frontierSize: dp.frontierSize,
            stoppedReason: dp.stoppedReason || null,
          }],
        }
      : null,
    memory: result && result.memory || null,
  };
}

function buildMarkdown(report) {
  const witness = report.rejectingWitness;
  const continuation = report.continuation.teacher;
  const lines = [
    "# PR-4.4f MT1 rejecting-witness continuation audit",
    "",
    "Status: **" + report.status + "**",
    "",
    "## Gates",
    "",
    "| Gate | Result |",
    "|---|:---:|",
  ];
  Object.entries(report.gates).forEach(([name, value]) => {
    lines.push("| " + name + " | " + Boolean(value) + " |");
  });
  lines.push(
    "",
    "Failed gates: " + (report.failedGates.join(", ") || "none") + ".",
    "",
    "## Captured rejecting witness",
    "",
    "- Teacher action: " + report.firstDivergence.teacher.actionSummary + ".",
    "- Candidate exact key captured: **" + Boolean(witness && witness.candidate.exactStateKey) + "**.",
    "- Candidate dpKey present: **" + Boolean(witness && witness.candidate.dpKey) + "**.",
    "- Witness node: " + String(witness && witness.witness.nodeId || "n/a") + ".",
    "- Witness exact key captured: **" + Boolean(witness && witness.witness.exactStateKey) + "**.",
    "- Witness action: " + String(witness && witness.witness.action && witness.witness.action.summary || "n/a") + ".",
    "- First deciding field: " + String(witness && witness.dominanceComparison && witness.dominanceComparison.firstDecidingField || "n/a") + ".",
    "- Candidate/witness region key equal: **" + Boolean(witness && witness.regionComparison && witness.regionComparison.regionKeyEqual) + "**.",
    "",
    "## Teacher suffix continuation",
    "",
    "| Decision | Provider T/W | Successor T/W | Exact equal | Dominance equal | Witness HP delta |",
    "|---:|:---:|:---:|:---:|:---:|---:|",
  );
  continuation.steps.forEach((step) => {
    lines.push(
      "| " + step.decisionIndex +
      " | " + Boolean(step.teacher.providerContainsAction) + "/" + Boolean(step.witness.providerContainsAction) +
      " | " + Boolean(step.teacher.successorGenerated) + "/" + Boolean(step.witness.successorGenerated) +
      " | " + Boolean(step.comparison.exactStateEqual) +
      " | " + Boolean(step.comparison.dominanceKeyEqual) +
      " | " + String(step.comparison.hpDeltaWitnessMinusTeacher == null ? "n/a" : step.comparison.hpDeltaWitnessMinusTeacher) + " |",
    );
  });
  lines.push(
    "",
    "- Teacher reached MT1 gate: **" + continuation.teacherReachedGoal + "**.",
    "- Witness reached MT1 gate: **" + continuation.witnessReachedGoal + "**.",
    "- Witness resource/attribute non-inferior: **" + continuation.resourceNonInferior + "**.",
    "- Exact continuation rejoined: **" + continuation.rejoinedExact + "**.",
    "- Verdict: **" + continuation.compatibilityVerdict + "**.",
    "",
    "The audit is oracle-only for the teacher suffix. It does not inject teacher actions into production search and does not modify dominance, DP keys, skyline limits, or agenda defaults.",
    "",
    "## Search boundary",
    "",
    "- Found MT1 goal: **" + report.search.found + "**.",
    "- Expansions: " + String(report.search.segment && report.search.segment.attempts[0] && report.search.segment.attempts[0].expansions) + "; frontier: " + String(report.search.segment && report.search.segment.attempts[0] && report.search.segment.attempts[0].frontierSize) + ".",
    "- Stopped reason: " + String(report.search.segment && report.search.segment.attempts[0] && report.search.segment.attempts[0].stoppedReason || "n/a") + ".",
    "",
    "## Provenance",
    "",
    "- solver commit: " + report.provenance.solverCommit,
    "- commit stable: **" + report.provenance.commitStable + "**",
    "- clean worktree: **" + report.provenance.worktreeCleanAtStart + "/" + report.provenance.worktreeCleanAtFinish + "**",
  );
  return lines.join("\n") + "\n";
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedCommit = gitCommit();
  const startedClean = cleanWorktree();
  const projectRoot = path.resolve(args["project-root"] || DEFAULT_PROJECT_ROOT);
  const teacherRouteFile = path.resolve(args["teacher-route"] || DEFAULT_TEACHER_ROUTE);
  const productionRouteFile = path.resolve(args["production-route"] || DEFAULT_PRODUCTION_ROUTE);
  const outFile = path.resolve(args.out || DEFAULT_OUT);
  const outMarkdown = path.resolve(args["out-md"] || outFile.replace(/\.json$/i, ".md"));
  const project = require("./lib/project-loader").loadProject(projectRoot);
  const simulator = makeSimulator(project);
  const teacherRoute = readJson(teacherRouteFile);
  const productionRoute = readJson(productionRouteFile);
  const teacherStrictReplay = strictReplayRoute(project, simulator, teacherRoute);
  const productionStrictReplay = strictReplayRoute(project, simulator, productionRoute);
  const teacherReplay = replayRoute(project, simulator, teacherRoute);
  const productionReplay = replayRoute(project, simulator, productionRoute);
  const spec = getMilestoneSpec(project, "onlyup-chaos-mt5-blueking");
  const segment = spec.milestones.find((milestone) => milestone.id === "mt1-gate-1559");
  if (!segment) throw new Error("Missing mt1-gate-1559 milestone.");
  const teacherCommon = teacherReplay.states[1];
  const productionCommon = productionReplay.states[1];
  const teacherDecision = teacherRoute.decisions[1];
  const productionDecision = productionRoute.decisions[1];
  const provider = buildSegmentActionProvider(simulator, segment);
  const providerActions = provider(simulator, teacherCommon);
  const targets = [
    {
      id: "teacher-decision-2",
      actionSummary: teacherDecision.summary,
      actionFingerprint: actionFingerprint(simulator, providerActions.find((action) => action.summary === teacherDecision.summary)) || teacherDecision.fingerprint,
      expectedPostExactStateKey: buildStateKey(teacherReplay.states[2]),
      expectedPostDominanceKey: buildDominanceKey(teacherReplay.states[2]),
      providerContainsAction: providerActions.some((action) => actionMatches(simulator, action, teacherDecision)),
    },
    {
      id: "production-decision-2",
      actionSummary: productionDecision.summary,
      actionFingerprint: actionFingerprint(simulator, providerActions.find((action) => action.summary === productionDecision.summary)) || productionDecision.fingerprint,
      expectedPostExactStateKey: buildStateKey(productionReplay.states[2]),
      expectedPostDominanceKey: buildDominanceKey(productionReplay.states[2]),
      providerContainsAction: providerActions.some((action) => actionMatches(simulator, action, productionDecision)),
    },
  ];
  const collector = createLineageObserver(buildStateKey(teacherCommon), targets, {
    captureWitnessFor: ["teacher-decision-2"],
    simulator,
  });
  const maxExpansions = number(args["max-expansions"], segment.dp && segment.dp.maxExpansions || 4000);
  const maxRuntimeMs = number(args["max-runtime-ms"], segment.dp && segment.dp.maxRuntimeMs || 15000);
  const run = runMilestoneGraph(simulator, teacherCommon, { milestones: [segment] }, {
    candidateLimit: number(args["candidate-limit"], 8),
    goalSkylineLimit: number(args["goal-skyline-limit"], 8),
    dpSkylineMax: number(args["dp-skyline-max"], 4),
    preserveSkylineRoles: args["preserve-skyline-roles"] !== "0",
    stopOnFirstGoal: false,
    maxActionsPerState: number(args["max-actions-per-state"], 256),
    maxExpansions,
    maxRuntimeMs,
    agendaMode: args["agenda-mode"] || "best-first",
    observer: collector.observer,
    observerIncludeExactStateKey: true,
    observerCaptureMode: "targeted-state",
  });
  const observed = collector.finalize();
  const teacherLineage = observed.lineages["teacher-decision-2"];
  const rejectionEvent = (teacherLineage && teacherLineage.events || [])
    .find((event) => event.reasonCode === "dominance-rejected" && event.dominanceWitnessStates && event.dominanceWitnessStates.length > 0);
  const candidateState = teacherReplay.states[2];
  const witnessState = rejectionEvent && rejectionEvent.dominanceWitnessStates[0] || null;
  const witnessInfo = rejectionEvent && rejectionEvent.dominanceWitnesses && rejectionEvent.dominanceWitnesses[0] || null;
  const candidateRegion = compactRegion(simulator, candidateState);
  const witnessRegion = compactRegion(simulator, witnessState);
  const witness = rejectionEvent && witnessState
    ? {
        candidate: {
          exactStateKey: rejectionEvent.exactStateKey,
          dominanceKey: buildDominanceKey(candidateState),
          dpKey: rejectionEvent.dpKey,
          action: rejectionEvent.action,
          hero: rejectionEvent.hero,
          region: candidateRegion,
        },
        witness: {
          nodeId: witnessInfo && witnessInfo.nodeId,
          exactStateKey: buildStateKey(witnessState),
          dominanceKey: buildDominanceKey(witnessState),
          action: witnessInfo && witnessInfo.action,
          hero: heroSummary(witnessState),
          region: witnessRegion,
        },
        dominanceComparison: rejectionEvent.dominanceComparison,
        dominanceStateDiff: rejectionEvent.dominanceStateDiff,
        dominanceWitnesses: rejectionEvent.dominanceWitnesses,
        regionComparison: {
          regionKeyEqual: Boolean(candidateRegion && witnessRegion && candidateRegion.regionKey === witnessRegion.regionKey),
          reachableEndpointsKeyEqual: Boolean(candidateRegion && witnessRegion && candidateRegion.reachableEndpointsKey === witnessRegion.reachableEndpointsKey),
        },
      }
    : null;
  const teacherGoalStateIndex = teacherReplay.states.findIndex((state) => meetsGoal(state, segment));
  const suffixDecisions = teacherGoalStateIndex > 2
    ? teacherRoute.decisions.slice(2, teacherGoalStateIndex)
    : [];
  const continuation = continueTeacherSuffix(
    project,
    simulator,
    provider,
    teacherReplay.states[2],
    witnessState,
    suffixDecisions,
    segment,
  );
  const searchSummary = compactSearch(run);
  const gates = {
    teacherStrictReplay: Boolean(teacherStrictReplay && teacherStrictReplay.valid),
    productionStrictReplay: Boolean(productionStrictReplay && productionStrictReplay.valid),
    commonExactState: Boolean(teacherCommon && productionCommon && buildStateKey(teacherCommon) === buildStateKey(productionCommon)),
    commonDominanceState: Boolean(teacherCommon && productionCommon && buildDominanceKey(teacherCommon) === buildDominanceKey(productionCommon)),
    rejectingWitnessCaptured: Boolean(witness),
    searchFoundMt1Goal: Boolean(searchSummary.found && searchSummary.reachedMilestone === segment.id),
    teacherSuffixReachedMt1Goal: continuation.teacherReachedGoal,
  };
  const failedGates = Object.entries(gates).filter((entry) => !entry[1]).map((entry) => entry[0]);
  const finishedCommit = gitCommit();
  const report = {
    schema: "motapathfinder.hp3834-mt1-rejecting-witness-continuation-audit.v1",
    generatedAt: new Date().toISOString(),
    status: failedGates.length === 0 ? "completed" : "failed",
    failedGates,
    gates,
    source: {
      teacherRoute: relative(teacherRouteFile),
      productionRoute: relative(productionRouteFile),
      reportFile: relative(outFile),
      projectRoot: relative(projectRoot),
      teacherRouteSha256: sha256(teacherRouteFile),
      productionRouteSha256: sha256(productionRouteFile),
    },
    provenance: {
      solverCommit: startedCommit,
      startedCommit,
      finishedCommit,
      commitStable: Boolean(startedCommit && finishedCommit && startedCommit === finishedCommit),
      nodeVersion: process.version,
      worktreeCleanAtStart: startedClean,
      worktreeCleanAtFinish: cleanWorktree(),
    },
    commonBoundary: {
      exactStateKey: buildStateKey(teacherCommon),
      dominanceKey: buildDominanceKey(teacherCommon),
      exactStateEqual: gates.commonExactState,
      dominanceKeyEqual: gates.commonDominanceState,
      teacher: compactState(teacherCommon),
      production: compactState(productionCommon),
    },
    firstDivergence: {
      teacher: {
        decisionIndex: teacherDecision.index,
        actionSummary: teacherDecision.summary,
        actionFingerprint: teacherDecision.fingerprint || null,
        expectedPost: compactState(teacherReplay.states[2]),
      },
      production: {
        decisionIndex: productionDecision.index,
        actionSummary: productionDecision.summary,
        actionFingerprint: productionDecision.fingerprint || null,
        expectedPost: compactState(productionReplay.states[2]),
      },
    },
    routeChecks: {
      teacherStrictReplay,
      productionStrictReplay,
      teacherReplayErrors: teacherReplay.errors,
      productionReplayErrors: productionReplay.errors,
    },
    segment: {
      id: segment.id,
      goal: segment.goal,
      dp: {
        keyMode: segment.dp.keyMode,
        maxExpansions,
        maxRuntimeMs,
        dpSkylineMax: number(args["dp-skyline-max"], 4),
        candidateLimit: number(args["candidate-limit"], 8),
        goalSkylineLimit: number(args["goal-skyline-limit"], 8),
        agendaMode: args["agenda-mode"] || "best-first",
        observerCaptureMode: "targeted-state",
        observerOnly: true,
      },
    },
    search: {
      ...searchSummary,
      observerEventCounts: observed.eventCounts,
      teacherLineage: teacherLineage || null,
    },
    rejectingWitness: witness,
    continuation: {
      suffixStartDecision: suffixDecisions[0] && suffixDecisions[0].index || null,
      suffixEndDecision: suffixDecisions[suffixDecisions.length - 1] && suffixDecisions[suffixDecisions.length - 1].index || null,
      teacher: continuation,
    },
    conclusion: witness
      ? "The actual targeted dominance witness was captured and compared against the teacher decision-3-to-MT1-gate suffix."
      : "The targeted rejecting witness was not captured; no dominance conclusion is drawn.",
  };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2) + "\n", "utf8");
  fs.writeFileSync(outMarkdown, buildMarkdown(report), "utf8");
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) main();

module.exports = {
  compactStateDiff,
  continueTeacherSuffix,
  meetsGoal,
};
