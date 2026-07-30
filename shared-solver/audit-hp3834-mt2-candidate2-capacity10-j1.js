"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { loadProject } = require("./lib/project-loader");
const { buildStateKey } = require("./lib/state-key");
const { buildRouteRecord, resolveRecordedAction } = require("./lib/route-store");
const { cloneState } = require("./lib/state");
const { strictReplayRoute } = require("./lib/agenda-policy-evaluation");
const {
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
const DEFAULT_REPORT = path.resolve(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "mt2-candidate2-capacity10-j.json",
);

function parseArgs(argv) {
  return argv.reduce((result, token) => {
    const match = /^--([^=]+)=(.*)$/.exec(token);
    if (match) result[match[1]] = match[2];
    return result;
  }, {});
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function gitCommit() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" });
  return result.status === 0 ? String(result.stdout || "").trim() || null : null;
}

function cleanWorktree() {
  const result = spawnSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" });
  return result.status === 0 && String(result.stdout || "").trim() === "";
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function relative(file) {
  return path.relative(ROOT, file) || ".";
}

function summarizeReplay(result) {
  return {
    performed: Boolean(result && result.performed),
    valid: Boolean(result && result.valid),
    stepsAttempted: Number(result && result.stepsAttempted || 0),
    stepsCompleted: Number(result && result.stepsCompleted || 0),
    failureStep: result && result.failureStep != null ? result.failureStep : null,
    failureReason: result && result.failureReason || null,
    expectedStateKey: result && result.expectedStateKey || null,
    actualStateKey: result && result.actualStateKey || null,
    error: result && result.error || null,
  };
}

function checkpointCandidate(report, segmentId, candidateId) {
  const checkpoint = (report.candidate2NaturalRun && report.candidate2NaturalRun.search && report.candidate2NaturalRun.search.checkpointResults || [])
    .find((entry) => entry.segmentId === segmentId);
  return checkpoint && (checkpoint.candidates || []).find((candidate) => candidate.id === candidateId) || null;
}

function successfulHpAttempt(report) {
  const segment = (report.candidate2NaturalRun && report.candidate2NaturalRun.search && report.candidate2NaturalRun.search.segmentResults || [])
    .find((entry) => entry.segmentId === "mt2-hp3834");
  return segment && (segment.attempts || []).find((attempt) => attempt.found === true) || null;
}

function replayRouteFromState(project, simulator, initialState, record) {
  let state = cloneState(initialState);
  const states = [state];
  const errors = [];
  for (let index = 0; index < (record.decisions || []).length; index += 1) {
    const decision = record.decisions[index];
    let resolved;
    try {
      resolved = resolveRecordedAction(simulator, state, decision, { project });
    } catch (error) {
      errors.push({ index: decision.index || index + 1, reason: String(error.message || error) });
      break;
    }
    if (!resolved || !resolved.action) {
      errors.push({ index: decision.index || index + 1, reason: resolved && resolved.reason || "action-unavailable" });
      break;
    }
    try {
      const applied = simulator.applyAction(state, resolved.action, { storeRoute: false });
      const successors = Array.isArray(applied) ? applied : [applied];
      state = successors.find((candidate) => (
        !decision.postExactStateKey || buildStateKey(candidate) === decision.postExactStateKey
      )) || successors[0];
      if (!state) throw new Error("no-successor");
      state.meta = { ...(state.meta || {}), decisionDepth: (initialState.meta && initialState.meta.decisionDepth || 0) + index + 1 };
      states.push(state);
    } catch (error) {
      errors.push({ index: decision.index || index + 1, reason: String(error.message || error) });
      break;
    }
  }
  return { states, state, errors };
}

function buildWinningRouteEvidence(projectRoot, project, simulator, report, teacherRoute, teacherReplay) {
  const attempt = successfulHpAttempt(report);
  const winningHpAttemptStartCandidateId = attempt && attempt.startCandidateId || null;
  const localCandidate = winningHpAttemptStartCandidateId
    ? checkpointCandidate(report, "mt2-local-3582", winningHpAttemptStartCandidateId)
    : null;
  const winningLocalCheckpointExactStateKey = localCandidate && localCandidate.state
    ? buildStateKey(localCandidate.state)
    : null;
  const teacherEntryExactStateKey = buildStateKey(teacherReplay.states[12]);
  const teacherLocalExactStateKey = buildStateKey(teacherReplay.states[14]);
  const teacherFinalExactStateKey = buildStateKey(teacherReplay.states[23]);
  const winningLocalMatchesTeacherDecision14 = winningLocalCheckpointExactStateKey === teacherLocalExactStateKey;
  const finalCandidate = checkpointCandidate(
    report,
    "mt2-hp3834",
    report.exactHp3834Reachability && report.exactHp3834Reachability.finalCandidateId || "mt2-hp3834:candidate-0",
  ) || checkpointCandidate(report, "mt2-hp3834", "mt2-hp3834:candidate-0");
  const gateState = teacherReplay.states.find((state) => (
    buildStateKey(state) === report.mt1Setup.candidate2.exactStateKey
  ));
  const initialState = gateState && cloneState(gateState);
  let routeRecord = null;
  let routeBuildError = null;
  let routeReplay = null;
  let strictReplay = null;
  try {
    if (!finalCandidate || !finalCandidate.state) throw new Error("winning HP checkpoint candidate missing");
    if (!initialState) throw new Error("teacher gate exact start state missing");
    const finalRoute = Array.isArray(finalCandidate.route) ? finalCandidate.route.slice() : [];
    const naturalRouteDecisionCount = Number(
      report.strictRouteReplay && report.strictRouteReplay.natural && report.strictRouteReplay.natural.routeDecisionCount || 0,
    );
    const routePrefixLength = Math.max(0, finalRoute.length - naturalRouteDecisionCount);
    const finalState = cloneState(finalCandidate.state);
    finalState.route = finalRoute.slice(routePrefixLength);
    routeRecord = buildRouteRecord({
      project,
      simulator,
      initialState,
      finalState,
      options: {
        projectRoot,
        solver: "pr-4.4j1-winning-ancestry-postprocess",
        profile: "best-first-10x10x4",
        rank: "chaos",
        toFloor: finalCandidate.state.floorId,
        goalType: "milestone-counterfactual",
        commit: gitCommit(),
      },
    });
    strictReplay = strictReplayRoute(project, simulator, routeRecord);
    routeReplay = replayRouteFromState(project, simulator, initialState, routeRecord);
  } catch (error) {
    routeBuildError = String(error.message || error);
  }
  const replayStates = routeReplay && routeReplay.states || [];
  const replayKeys = replayStates.map((state) => buildStateKey(state));
  const exactIndices = (key) => replayKeys
    .map((candidateKey, index) => candidateKey === key ? index : null)
    .filter((index) => index != null);
  const winningRouteContainsTeacherEntryExact = exactIndices(teacherEntryExactStateKey).length > 0;
  const winningRouteContainsTeacherLocalExact = exactIndices(teacherLocalExactStateKey).length > 0;
  const winningRouteFinalMatchesTeacherDecision23 = Boolean(
    replayKeys.length > 0 && replayKeys[replayKeys.length - 1] === teacherFinalExactStateKey,
  );
  const winningRouteStrictReplay = summarizeReplay(strictReplay);
  return {
    winningHpAttemptStartCandidateId,
    winningLocalCheckpointExactStateKey,
    winningLocalMatchesTeacherDecision14,
    winningRouteContainsTeacherEntryExact,
    winningRouteContainsTeacherLocalExact,
    winningRouteFinalMatchesTeacherDecision23,
    winningRouteStrictReplay,
    winningRouteDecisionCount: routeRecord ? routeRecord.decisions.length : 0,
    winningRouteExactStateIndices: {
      teacherEntry: exactIndices(teacherEntryExactStateKey),
      teacherLocal: exactIndices(teacherLocalExactStateKey),
      teacherFinal: exactIndices(teacherFinalExactStateKey),
    },
    routeBuildError,
    knownExactWitnessCapacityRecoveryEstablished: Boolean(
      report.teacherEntryRawRetention && report.teacherEntryRawRetention.retained &&
      report.teacherEntrySegmentRetention && report.teacherEntrySegmentRetention.retained &&
      report.teacherEntryMergedRetention && report.teacherEntryMergedRetention.retained &&
      winningRouteContainsTeacherEntryExact &&
      winningRouteContainsTeacherLocalExact &&
      winningRouteFinalMatchesTeacherDecision23 &&
      winningRouteStrictReplay.performed &&
      winningRouteStrictReplay.valid,
    ),
    teacherEntryExactStateKey,
    teacherLocalExactStateKey,
    teacherFinalExactStateKey,
  };
}

function buildMarkdown(report) {
  const winner = report.winningAncestry || {};
  const replay = winner.winningRouteStrictReplay || {};
  const drop = report.exactLifecycleOutcome && report.exactLifecycleOutcome.firstExactLineageDrop || {};
  return [
    "# PR-4.4j1 artifact contract closure",
    "",
    "Status: **" + report.status + "**",
    "",
    "## First exact-lineage drop",
    "",
    "- decision: **" + drop.decisionIndex + "**",
    "- classification: **" + drop.classification + "**",
    "- generated: **" + Boolean(report.exactLifecycleOutcome && report.exactLifecycleOutcome.decisions13To23.find((entry) => entry.decisionIndex === 15).generated) + "**",
    "- postRejoined: **" + Boolean(report.exactLifecycleOutcome && report.exactLifecycleOutcome.decisions13To23.find((entry) => entry.decisionIndex === 15).postRejoined) + "**",
    "- exact rejoin decisions include 15: **" + Boolean((report.exactLifecycleOutcome && report.exactLifecycleOutcome.exactRejoinDecisions || []).includes(15)) + "**",
    "",
    "## Winning HP3834 ancestry",
    "",
    "- winning HP attempt start: **" + winner.winningHpAttemptStartCandidateId + "**",
    "- winning local checkpoint matches teacher decision-14: **" + winner.winningLocalMatchesTeacherDecision14 + "**",
    "- route contains teacher entry exact: **" + winner.winningRouteContainsTeacherEntryExact + "**",
    "- route contains teacher local exact: **" + winner.winningRouteContainsTeacherLocalExact + "**",
    "- route final matches teacher decision-23: **" + winner.winningRouteFinalMatchesTeacherDecision23 + "**",
    "- winning route strict replay: **" + replay.stepsCompleted + "/" + replay.stepsAttempted + ", valid=" + replay.valid + "**",
    "- known exact witness capacity recovery: **" + winner.knownExactWitnessCapacityRecoveryEstablished + "**",
    "",
    "## Boundary",
    "",
    "- retained matrix completion: **" + report.retainedMatrixCompletion.classification + "**",
    "- global default change recommended: **" + report.globalDefaultChangeRecommended + "**",
    "- production semantic change: **" + report.productionSemanticChange + "**",
    "",
    "## Provenance",
    "",
    "- source j artifact data commit: " + (report.provenance && report.provenance.dataGenerationCommit),
    "- j1 post-process commit: " + report.j1Provenance.postProcessCommit,
  ].join("\n") + "\n";
}

function main(argv) {
  const args = parseArgs(argv);
  const reportFile = path.resolve(args.out || DEFAULT_REPORT);
  const outMarkdown = path.resolve(args["out-md"] || reportFile.replace(/\.json$/i, ".md"));
  const projectRoot = path.resolve(args["project-root"] || DEFAULT_PROJECT_ROOT);
  const teacherRouteFile = path.resolve(args["teacher-route"] || DEFAULT_TEACHER_ROUTE);
  const report = readJson(reportFile);
  const project = loadProject(projectRoot);
  const simulator = makeSimulator(project);
  const teacherRoute = readJson(teacherRouteFile);
  const teacherReplay = replayRoute(project, simulator, teacherRoute);
  const winningAncestry = buildWinningRouteEvidence(
    projectRoot,
    project,
    simulator,
    report,
    teacherRoute,
    teacherReplay,
  );
  const decision15 = report.exactLifecycleOutcome && report.exactLifecycleOutcome.decisions13To23
    .find((entry) => entry.decisionIndex === 15);
  const firstDrop = report.exactLifecycleOutcome && report.exactLifecycleOutcome.firstExactLineageDrop;
  const firstDropContract = Boolean(
    firstDrop &&
    firstDrop.decisionIndex === 15 &&
    firstDrop.classification === "pre-state-replaced-by-continuation-compatible-witness" &&
    decision15 && decision15.generated === false &&
    decision15.postRejoined === true &&
    (report.exactLifecycleOutcome.exactRejoinDecisions || []).includes(15),
  );
  const j1Gates = {
    firstExactLineageDropContract: firstDropContract,
    winningHpAttemptIdentified: Boolean(winningAncestry.winningHpAttemptStartCandidateId),
    winningLocalCheckpointIdentified: Boolean(winningAncestry.winningLocalCheckpointExactStateKey),
    winningLocalMatchesTeacherDecision14: winningAncestry.winningLocalMatchesTeacherDecision14,
    winningRouteContainsTeacherEntryExact: winningAncestry.winningRouteContainsTeacherEntryExact,
    winningRouteContainsTeacherLocalExact: winningAncestry.winningRouteContainsTeacherLocalExact,
    winningRouteFinalMatchesTeacherDecision23: winningAncestry.winningRouteFinalMatchesTeacherDecision23,
    winningRouteStrictReplayAttempted: winningAncestry.winningRouteStrictReplay.performed,
    winningRouteStrictReplayCompleted: winningAncestry.winningRouteStrictReplay.stepsAttempted === 13 &&
      winningAncestry.winningRouteStrictReplay.stepsCompleted === 13,
    winningRouteStrictReplayValid: winningAncestry.winningRouteStrictReplay.valid,
    hardTilesExactSeven: Array.isArray(report.hardTiles) && report.hardTiles.length === 7 && report.hardTiles.every((tile) => tile.present === true),
    retainedMatrixInconclusive: report.retainedMatrixCompletion && report.retainedMatrixCompletion.classification === "inconclusive",
    globalDefaultNotEstablished: report.globalDefaultChangeRecommended === "not-established",
    knownExactWitnessCapacityRecoveryEstablished: winningAncestry.knownExactWitnessCapacityRecoveryEstablished,
  };
  const failedJ1Gates = Object.entries(j1Gates).filter(([, value]) => value !== true).map(([name]) => name);
  report.winningAncestry = winningAncestry;
  report.firstExactLineageDropContract = firstDropContract;
  report.knownExactWitnessCapacityRecoveryEstablished = winningAncestry.knownExactWitnessCapacityRecoveryEstablished;
  report.j1Gates = j1Gates;
  report.j1FailedGates = failedJ1Gates;
  report.status = failedJ1Gates.length === 0 ? "completed" : "failed";
  report.auditStatus = report.status;
  report.j1Provenance = {
    postProcessCommit: gitCommit(),
    worktreeCleanAtStart: cleanWorktree(),
    sourceReportSha256: sha256(reportFile),
    sourceReport: relative(reportFile),
  };
  if (report.provenance) report.provenance.worktreeCleanAtFinish = cleanWorktree();
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + "\n", "utf8");
  fs.writeFileSync(outMarkdown, buildMarkdown(report), "utf8");
  console.log(JSON.stringify({ status: report.status, failedJ1Gates, winningAncestry, j1Gates }, null, 2));
  if (failedJ1Gates.length > 0) process.exitCode = 1;
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { buildWinningRouteEvidence, main };
