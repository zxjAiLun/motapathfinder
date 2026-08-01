"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const { getMilestoneSpec } = require("./lib/milestone-spec");
const { loadProject } = require("./lib/project-loader");
const { buildStateKey } = require("./lib/state-key");
const { buildRouteRecord, resolveRecordedAction } = require("./lib/route-store");
const { cloneState } = require("./lib/state");
const { strictReplayRoute } = require("./lib/agenda-policy-evaluation");
const { runIsolatedLocalCheckpoint } = require("./audit-hp3834-mt2-candidate2-natural-search");
const { makeSimulator, replayRoute } = require("./audit-hp3834-mt1-first-divergence");

const ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const TEACHER_ROUTE = path.resolve(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "mt1-mt3-i893-hp8425.current-exact.route.json",
);
const J_REPORT = path.resolve(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "mt2-candidate2-capacity10-j.json",
);
const BASELINE_REPORT = path.resolve(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "mt2-candidate2-natural-search-audit-v2.json",
);
const DEFAULT_OUT = path.resolve(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "mt2-candidate2-capacity10-j2.json",
);

const CONCLUSION =
  "The joint 10/10/4 configuration naturally reproduced the exact teacher HP3834 terminal state through an alternate mutation ancestry. " +
  "The winning route did not pass through the exact teacher entry or teacher-local checkpoint, so known exact teacher-witness capacity recovery remains not-established.";

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
  try {
    return require("node:child_process")
      .execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" })
      .trim();
  } catch (error) {
    return null;
  }
}

function relative(file) {
  return path.relative(ROOT, file) || ".";
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 16);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonicalize(value[key]);
    return result;
  }, {});
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function valueHash(value) {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function valuesEqual(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function parseStateKey(value) {
  if (!value) return null;
  try {
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch (error) {
    return null;
  }
}

function exactKey(candidate) {
  if (!candidate) return null;
  return candidate.exactStateKey || (candidate.state ? buildStateKey(candidate.state) : null);
}

function stageFor(report, segmentId) {
  const stages = report && report.candidate2NaturalRun && report.candidate2NaturalRun.pipeline
    ? report.candidate2NaturalRun.pipeline.stages
    : report && report.candidate2Prefix && report.candidate2Prefix.pipeline
      ? report.candidate2Prefix.pipeline.stages
      : report && report.candidate2Only && report.candidate2Only.pipeline
        ? report.candidate2Only.pipeline.stages
        : [];
  return (stages || []).find((stage) => stage.segmentId === segmentId) || null;
}

function findStageCandidate(stage, collection, stateKey) {
  const candidates = stage && stage[collection] && Array.isArray(stage[collection].candidates)
    ? stage[collection].candidates
    : [];
  return candidates.find((candidate) => exactKey(candidate) === stateKey) || null;
}

function indexOfStageCandidate(stage, collection, stateKey) {
  const candidates = stage && stage[collection] && Array.isArray(stage[collection].candidates)
    ? stage[collection].candidates
    : [];
  return candidates.findIndex((candidate) => exactKey(candidate) === stateKey);
}

function candidateId(stage, collection, stateKey) {
  const candidate = findStageCandidate(stage, collection, stateKey);
  return candidate && candidate.id || null;
}

function candidateRank(stage, collection, stateKey) {
  const index = indexOfStageCandidate(stage, collection, stateKey);
  return index < 0 ? null : index;
}

function sortedArray(value) {
  return Array.isArray(value) ? value.map(String).sort() : [];
}

function diffObject(left, right) {
  const a = left && typeof left === "object" ? left : {};
  const b = right && typeof right === "object" ? right : {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return Array.from(keys).sort().reduce((diff, key) => {
    const leftValue = a[key];
    const rightValue = b[key];
    if (leftValue && rightValue && typeof leftValue === "object" && typeof rightValue === "object" &&
      !Array.isArray(leftValue) && !Array.isArray(rightValue)) {
      const nested = diffObject(leftValue, rightValue);
      if (Object.keys(nested).length > 0) diff[key] = nested;
    } else if (JSON.stringify(leftValue) !== JSON.stringify(rightValue)) {
      diff[key] = { winner: leftValue === undefined ? null : leftValue, teacher: rightValue === undefined ? null : rightValue };
    }
    return diff;
  }, {});
}

function mutationMap(state) {
  return Object.fromEntries((state && state.mutations || []).map((mutation) => [
    mutation.floorId,
    new Set(sortedArray(mutation.removed)),
  ]));
}

function mutationDiff(winnerState, teacherState) {
  const winnerMap = mutationMap(winnerState);
  const teacherMap = mutationMap(teacherState);
  const floorIds = new Set([...Object.keys(winnerMap), ...Object.keys(teacherMap)]);
  const onlyWinner = [];
  const onlyTeacher = [];
  const perFloor = {};
  for (const floorId of Array.from(floorIds).sort()) {
    const winner = winnerMap[floorId] || new Set();
    const teacher = teacherMap[floorId] || new Set();
    const winnerOnly = Array.from(winner).filter((tile) => !teacher.has(tile)).sort();
    const teacherOnly = Array.from(teacher).filter((tile) => !winner.has(tile)).sort();
    if (winnerOnly.length > 0 || teacherOnly.length > 0) {
      perFloor[floorId] = { onlyInWinner: winnerOnly, onlyInTeacher: teacherOnly };
    }
    winnerOnly.forEach((tile) => onlyWinner.push(`${floorId}:${tile}`));
    teacherOnly.forEach((tile) => onlyTeacher.push(`${floorId}:${tile}`));
  }
  return { perFloor, mutationsOnlyInWinner: onlyWinner, mutationsOnlyInTeacher: onlyTeacher };
}

function buildExactDiff(winnerKey, teacherKey) {
  const winner = parseStateKey(winnerKey) || {};
  const teacher = parseStateKey(teacherKey) || {};
  const mutations = mutationDiff(winner, teacher);
  const heroDiff = diffObject(winner.hero, teacher.hero);
  const inventoryDiff = diffObject(winner.inventory, teacher.inventory);
  const flagsDiff = diffObject(winner.flags, teacher.flags);
  const visitedFloorsDiff = diffObject(winner.visitedFloors, teacher.visitedFloors);
  const progressDiff = diffObject(winner.progressSig, teacher.progressSig);
  return {
    winnerExactStateKey: winnerKey,
    teacherExactStateKey: teacherKey,
    winnerExactStateKeyHash: hash(winnerKey),
    teacherExactStateKeyHash: hash(teacherKey),
    heroDiff,
    inventoryDiff,
    flagsDiff,
    visitedFloorsDiff,
    progressDiff,
    mt2MutationDiff: mutations.perFloor.MT2 || {},
    mutationsOnlyInWinner: mutations.mutationsOnlyInWinner,
    mutationsOnlyInTeacher: mutations.mutationsOnlyInTeacher,
    resourceEquivalent: Object.keys(heroDiff).length === 0 &&
      Object.keys(inventoryDiff).length === 0 &&
      Object.keys(flagsDiff).length === 0 &&
      Object.keys(visitedFloorsDiff).length === 0,
    exactEquivalent: winnerKey === teacherKey,
  };
}

function replayRecord(project, simulator, initialState, record) {
  let state = cloneState(initialState);
  const states = [state];
  const errors = [];
  for (const decision of record.decisions || []) {
    try {
      const resolved = resolveRecordedAction(simulator, state, decision, { project });
      if (!resolved || !resolved.action) throw new Error(resolved && resolved.reason || "action-unavailable");
      const applied = simulator.applyAction(state, resolved.action, { storeRoute: false });
      const successors = Array.isArray(applied) ? applied : [applied];
      state = successors.find((candidate) => !decision.postExactStateKey || buildStateKey(candidate) === decision.postExactStateKey) || successors[0];
      if (!state) throw new Error("no-successor");
      states.push(state);
    } catch (error) {
      errors.push({ decisionIndex: decision.index, reason: String(error.message || error) });
      break;
    }
  }
  return { states, state, errors };
}

function compactHero(state) {
  const hero = state && state.hero || {};
  return {
    hp: hero.hp,
    atk: hero.atk,
    def: hero.def,
    mdef: hero.mdef,
    lv: hero.lv,
    exp: hero.exp,
    loc: hero.loc ? { x: hero.loc.x, y: hero.loc.y, direction: hero.loc.direction || null } : null,
  };
}

function compactDecision(decision, absoluteDecisionIndex, fallbackAction) {
  const action = fallbackAction && typeof fallbackAction === "object" ? fallbackAction : null;
  return {
    decisionIndex: absoluteDecisionIndex,
    actionSummary: decision.actionSummary || decision.action && decision.action.summary || action && action.summary || null,
    actionFingerprint: decision.actionFingerprint || decision.action && decision.action.fingerprint || action && action.fingerprint || null,
    preExactStateKey: decision.preExactStateKey || null,
    postExactStateKey: decision.postExactStateKey || decision.expectedPostExactStateKey || null,
  };
}

function buildPrefixBranch(projectRoot, project, simulator, gateState, checkpoint, entryStage, localStage, sourceEntryCandidate) {
  const gateDepth = Number(gateState.meta && gateState.meta.decisionDepth || 0);
  const sourceRoute = Array.isArray(checkpoint.state && checkpoint.state.route)
    ? checkpoint.state.route.slice()
    : [];
  const suffixDecisionCount = Math.max(0, Number(checkpoint.state && checkpoint.state.meta && checkpoint.state.meta.decisionDepth || 0) - gateDepth);
  const routePrefixLength = Math.max(0, sourceRoute.length - suffixDecisionCount);
  const finalState = cloneState(checkpoint.state);
  finalState.route = sourceRoute.slice(routePrefixLength);
  const suffixActions = finalState.route.slice();
  let routeRecord = null;
  let strict = null;
  let replay = null;
  let error = null;
  try {
    routeRecord = buildRouteRecord({
      project,
      simulator,
      initialState: gateState,
      finalState,
      options: {
        projectRoot,
        solver: "pr-4.4j2-ancestry-postprocess",
        profile: "best-first-10x10x4",
        rank: "chaos",
        toFloor: finalState.floorId,
        goalType: "ancestry-prefix",
        commit: gitCommit(),
      },
    });
    strict = strictReplayRoute(project, simulator, routeRecord);
    replay = replayRecord(project, simulator, gateState, routeRecord);
  } catch (caught) {
    error = String(caught.message || caught);
  }
  const states = replay && replay.states || [];
  const decisions = (routeRecord && routeRecord.decisions || []).map((decision, index) => ({
    ...compactDecision(decision, gateDepth + index + 1, suffixActions[index]),
    postHero: compactHero(states[index + 1]),
  }));
  const stateAt = (absoluteDecisionIndex) => {
    const index = absoluteDecisionIndex - gateDepth;
    return states[index] || null;
  };
  const entryState = stateAt(12);
  const localState = stateAt(14);
  const entryKey = entryState ? buildStateKey(entryState) : null;
  const localKey = localState ? buildStateKey(localState) : null;
  return {
    checkpointCandidateId: checkpoint.id || null,
    checkpointExactStateKey: exactKey(checkpoint),
    routePrefixLength,
    routeSuffixActionCount: finalState.route.length,
    sourceDecisionDepth: checkpoint.state && checkpoint.state.meta && checkpoint.state.meta.decisionDepth || null,
    gateDecisionDepth: gateDepth,
    replay: {
      performed: Boolean(routeRecord),
      valid: Boolean(strict && strict.valid),
      stepsAttempted: routeRecord ? routeRecord.decisions.length : 0,
      stepsCompleted: replay ? replay.states.length - 1 : 0,
      errors: replay ? replay.errors : [],
      error,
    },
    decisions,
    decision12EntryExactStateKey: entryKey,
    decision12EntryExactStateKeyHash: hash(entryKey),
    decision12EntryCandidateId: sourceEntryCandidate && sourceEntryCandidate.id || null,
    decision12EntryStageCandidateId: candidateId(entryStage, "mergedCheckpointFrontier", entryKey),
    decision14LocalExactStateKey: localKey,
    decision14LocalExactStateKeyHash: hash(localKey),
    decision14LocalCandidateId: candidateId(localStage, "mergedCheckpointFrontier", localKey),
  };
}

function firstExactRejoin(leftStates, rightStates, baseDecisionDepth) {
  const start = 1;
  const count = Math.min(leftStates.length, rightStates.length);
  for (let index = start; index < count; index += 1) {
    if (buildStateKey(leftStates[index]) === buildStateKey(rightStates[index])) return baseDecisionDepth + index;
  }
  return null;
}

function buildFullAlternate(projectRoot, project, simulator, gateState, localCheckpoint, finalCheckpoint) {
  const gateDepth = Number(gateState.meta && gateState.meta.decisionDepth || 0);
  const localRoute = localCheckpoint.state.route || [];
  const finalRoute = finalCheckpoint.state.route || [];
  const finalState = cloneState(finalCheckpoint.state);
  const localSuffix = localRoute.slice(Math.max(0, localRoute.length - 4));
  finalState.route = localSuffix.concat(finalRoute.slice(13));
  try {
    const routeRecord = buildRouteRecord({
      project,
      simulator,
      initialState: gateState,
      finalState,
      options: {
        projectRoot,
        solver: "pr-4.4j2-shared-continuation",
        profile: "best-first-10x10x4",
        rank: "chaos",
        toFloor: finalState.floorId,
        goalType: "alternate-ancestry-continuation",
        commit: gitCommit(),
      },
    });
    const strict = strictReplayRoute(project, simulator, routeRecord);
    const replay = replayRecord(project, simulator, gateState, routeRecord);
    return {
      performed: true,
      valid: Boolean(strict && strict.valid),
      stepsAttempted: routeRecord.decisions.length,
      stepsCompleted: replay.states.length - 1,
      finalExactStateKey: routeRecord.final && routeRecord.final.exactStateKey || null,
      finalMatchesTarget: Boolean(routeRecord.final && routeRecord.final.exactStateKey === buildStateKey(finalCheckpoint.state)),
      states: replay.states,
      error: replay.errors.length > 0 ? replay.errors : null,
      firstExactRejoinDecision: null,
      gateDepth,
    };
  } catch (error) {
    return {
      performed: true,
      valid: false,
      stepsAttempted: 0,
      stepsCompleted: 0,
      finalExactStateKey: null,
      finalMatchesTarget: false,
      states: [],
      error: String(error.message || error),
      firstExactRejoinDecision: null,
      gateDepth,
    };
  }
}

function compactWorker(worker) {
  const search = worker && worker.search || {};
  const finalCandidate = search.finalCandidate && {
    id: search.finalCandidate.id || null,
    exactStateKey: search.finalCandidate.exactStateKey || null,
    hero: search.finalCandidate.hero || null,
    routeLength: search.finalCandidate.routeLength || null,
  };
  return {
    candidateId: worker && worker.candidateId || null,
    startExactStateKey: worker && worker.startExactStateKey || null,
    startExactStateKeyHash: hash(worker && worker.startExactStateKey),
    hero: worker && worker.hero || null,
    processIsolated: Boolean(worker && worker.processIsolated),
    pid: worker && worker.pid || null,
    exitCode: worker && worker.exitCode,
    signal: worker && worker.signal || null,
    timedOut: Boolean(worker && worker.timedOut),
    snapshotRoundTripExact: Boolean(worker && worker.snapshotRoundTripExact),
    childOldSpaceActuallyApplied: Boolean(worker && worker.childOldSpaceActuallyApplied),
    workerReportValid: Boolean(worker && worker.workerReportValid),
    search: {
      found: Boolean(search.found),
      reachedMilestone: search.reachedMilestone || null,
      finalCandidate,
      segmentResults: (search.segmentResults || []).map((segment) => ({
        segmentId: segment.segmentId,
        found: Boolean(segment.found),
        attempts: (segment.attempts || []).map((attempt) => ({
          startCandidateId: attempt.startCandidateId || null,
          found: Boolean(attempt.found),
          expansions: attempt.expansions,
          frontierSize: attempt.frontierSize,
          stoppedReason: attempt.stoppedReason || null,
          expansionBudgetExhausted: Boolean(attempt.expansionBudgetExhausted),
        })),
      })),
      memory: search.memory || null,
      completion: search.completion || null,
    },
    pipeline: {
      stages: (worker && worker.pipeline && worker.pipeline.stages || []).map((stage) => ({
        segmentId: stage.segmentId,
        rawGoalCandidateCount: stage.rawDpGoalArchive && stage.rawDpGoalArchive.candidateCount || 0,
        segmentCandidateCount: stage.segmentGoalCandidates && stage.segmentGoalCandidates.candidateCount || 0,
        mergedCandidateCount: stage.mergedCheckpointFrontier && stage.mergedCheckpointFrontier.candidateCount || 0,
        mergedCandidateIds: (stage.mergedCheckpointFrontier && stage.mergedCheckpointFrontier.candidates || []).map((candidate) => candidate.id),
      })),
    },
    error: worker && worker.error || null,
  };
}

function baselinePresence(report, stateKey, segmentId) {
  const stage = stageFor(report, segmentId);
  const rawIndex = indexOfStageCandidate(stage, "rawDpGoalArchive", stateKey);
  const segmentIndex = indexOfStageCandidate(stage, "segmentGoalCandidates", stateKey);
  const mergedIndex = indexOfStageCandidate(stage, "mergedCheckpointFrontier", stateKey);
  return {
    rawGoalArchive: { present: rawIndex >= 0, rank: rawIndex >= 0 ? rawIndex : null },
    segmentCheckpoint: { present: segmentIndex >= 0, rank: segmentIndex >= 0 ? segmentIndex : null },
    mergedCheckpoint: {
      present: mergedIndex >= 0,
      rank: mergedIndex >= 0 ? mergedIndex : null,
      candidateId: mergedIndex >= 0 ? stage.mergedCheckpointFrontier.candidates[mergedIndex].id : null,
    },
  };
}

function baselineAttemptEvidence(report, stateKey, candidateIdValue) {
  const search = report && report.candidate2Prefix && report.candidate2Prefix.search || {};
  const segment = (search.segmentResults || []).find((entry) => entry.segmentId === "mt2-hp3834");
  const attempts = segment && segment.attempts || [];
  const sameIdAttempts = attempts.filter((attempt) => attempt.startCandidateId === candidateIdValue);
  const isolatedSameId = (report && report.isolatedLocalCheckpoints || [])
    .filter((attempt) => attempt.candidateId === candidateIdValue);
  const localStage = stageFor(report, "mt2-local-3582");
  const matchingLocal = ["rawDpGoalArchive", "segmentGoalCandidates", "mergedCheckpointFrontier"].flatMap((collection) => {
    const candidates = localStage && localStage[collection] && localStage[collection].candidates || [];
    return candidates.filter((candidate) => exactKey(candidate) === stateKey).map((candidate) => ({ collection, id: candidate.id || null }));
  });
  return {
    matchingWinnerLocalInBaseline: matchingLocal,
    sameCandidateIdAttempts: sameIdAttempts.map((attempt) => ({
      startCandidateId: attempt.startCandidateId,
      found: Boolean(attempt.found),
      expansions: attempt.expansions,
      frontierSize: attempt.frontierSize,
      stoppedReason: attempt.stoppedReason || null,
    })).concat(isolatedSameId.map((attempt) => ({
      startCandidateId: attempt.candidateId,
      startExactStateKey: attempt.startExactStateKey || null,
      startExactStateKeyMatches: attempt.startExactStateKey === stateKey,
      found: Boolean(attempt.search && attempt.search.found),
      expansions: attempt.search && attempt.search.expansions,
      frontierSize: attempt.search && attempt.search.frontierSize,
      stoppedReason: attempt.search && attempt.search.stoppedReason || null,
    }))),
    actualWinnerLocalAttemptExecuted: matchingLocal.length > 0 || isolatedSameId.some((attempt) => attempt.startExactStateKey === stateKey),
  };
}

function sourceCheckpoint(report, segmentId, candidateIdValue) {
  const checkpoint = report && report.candidate2NaturalRun && report.candidate2NaturalRun.search &&
    (report.candidate2NaturalRun.search.checkpointResults || [])
      .find((entry) => entry.segmentId === segmentId);
  return checkpoint && (checkpoint.candidates || []).find((candidate) => candidate.id === candidateIdValue) || null;
}

function entryAttribution(stage, checkpointCandidate) {
  const stateKey = exactKey(checkpointCandidate);
  return {
    candidateId: checkpointCandidate && checkpointCandidate.id || null,
    exactStateKey: stateKey,
    rawSortRank: candidateRank(stage, "rawDpGoalArchive", stateKey),
    selectedArchiveRank: candidateRank(stage, "segmentGoalCandidates", stateKey),
    segmentRetained: Boolean(findStageCandidate(stage, "segmentGoalCandidates", stateKey)),
    mergedRetained: Boolean(findStageCandidate(stage, "mergedCheckpointFrontier", stateKey)),
  };
}

function findFirstDivergence(winnerDecisions, teacherDecisions) {
  const count = Math.min(winnerDecisions.length, teacherDecisions.length);
  for (let index = 0; index < count; index += 1) {
    const winner = winnerDecisions[index];
    const teacher = teacherDecisions[index];
    if (winner.actionFingerprint !== teacher.actionFingerprint) {
      return {
        decisionIndex: winner.decisionIndex,
        winnerActionSummary: winner.actionSummary,
        teacherActionSummary: teacher.actionSummary,
        winnerActionFingerprint: winner.actionFingerprint,
        teacherActionFingerprint: teacher.actionFingerprint,
        arrayIndex: index,
      };
    }
  }
  if (winnerDecisions.length !== teacherDecisions.length) {
    const index = count;
    const winner = winnerDecisions[index] || {};
    const teacher = teacherDecisions[index] || {};
    return {
      decisionIndex: winner.decisionIndex || teacher.decisionIndex || null,
      winnerActionSummary: winner.actionSummary || null,
      teacherActionSummary: teacher.actionSummary || null,
      winnerActionFingerprint: winner.actionFingerprint || null,
      teacherActionFingerprint: teacher.actionFingerprint || null,
      arrayIndex: index,
    };
  }
  return null;
}

function buildMarkdown(report) {
  const diff = report.candidate6VsTeacherLocal;
  const ancestry = report.ancestryComparison;
  const baseline = report.baseline8CrossCheck;
  const workers = report.isolatedWorkerComparison.workers || [];
  return [
    "# PR-4.4j2 candidate-2 ancestry attribution",
    "",
    `Status: **${report.status}**`,
    "",
    "## Corrected conclusion",
    "",
    report.conclusion,
    "",
    "## candidate-6 vs teacher-local exact diff",
    "",
    `- resourceEquivalent: **${diff.resourceEquivalent}**`,
    `- exactEquivalent: **${diff.exactEquivalent}**`,
    `- heroDiff: \`${JSON.stringify(diff.heroDiff)}\``,
    `- inventoryDiff: \`${JSON.stringify(diff.inventoryDiff)}\``,
    `- flagsDiff: \`${JSON.stringify(diff.flagsDiff)}\``,
    `- MT2 mutation diff: \`${JSON.stringify(diff.mt2MutationDiff)}\``,
    `- mutations only in winner: **${diff.mutationsOnlyInWinner.join(", ") || "none"}**`,
    `- mutations only in teacher: **${diff.mutationsOnlyInTeacher.join(", ") || "none"}**`,
    "",
    "## Replayed ancestry prefix",
    "",
    `- source: natural MT1 candidate-2 gate, decision depth **${ancestry.gateDecisionDepth}**`,
    `- first divergence decision: **${ancestry.firstDivergenceDecision}**`,
    `- first divergence actions: **${ancestry.firstDivergenceActions.winner}** vs **${ancestry.firstDivergenceActions.teacherLocal}**`,
    `- candidate-6 decision-12 entry: **${ancestry.winningBranch.decision12EntryCandidateId}**`,
    `- candidate-7 decision-12 entry: **${ancestry.teacherLocalBranch.decision12EntryCandidateId}**`,
    `- candidate-6 decision-14 local: **${ancestry.winningBranch.decision14LocalCandidateId}**`,
    `- candidate-7 decision-14 local: **${ancestry.teacherLocalBranch.decision14LocalCandidateId}**`,
    `- first exact rejoin under shared continuation: **${ancestry.firstExactRejoinDecision}**`,
    `- prefix replay: **${ancestry.winningBranch.replay.stepsCompleted}/${ancestry.winningBranch.replay.stepsAttempted}** and **${ancestry.teacherLocalBranch.replay.stepsCompleted}/${ancestry.teacherLocalBranch.replay.stepsAttempted}**`,
    `- shared continuation final exact match: **${ancestry.sharedContinuation.teacherLocalBranch.finalMatchesTarget}**`,
    "",
    "## Baseline-8 cross-check",
    "",
    `- winner entry raw / segment / merged: **${baseline.winnerEntry.rawGoalArchive.present} / ${baseline.winnerEntry.segmentCheckpoint.present} / ${baseline.winnerEntry.mergedCheckpoint.present}**`,
    `- winner local raw / segment / merged: **${baseline.winnerLocal.rawGoalArchive.present} / ${baseline.winnerLocal.segmentCheckpoint.present} / ${baseline.winnerLocal.mergedCheckpoint.present}**`,
    `- baseline executed the exact winner-local HP attempt: **${baseline.winnerLocalAttempt.actualWinnerLocalAttemptExecuted}**`,
    `- entryRetainedUnder8 / localRetainedUnder8 / exactLocalAttemptExecutedUnder8: **${baseline.entryRetainedUnder8} / ${baseline.localRetainedUnder8} / ${baseline.exactLocalAttemptExecutedUnder8}**`,
    `- capacity dependency classification: **${baseline.classification}**`,
    `- classification reason: ${baseline.classificationReason}`,
    "",
    "## Worker cache contract",
    "",
    `- reused: **${report.workerCache.reused}**`,
    `- candidateExactKeysMatch / configMatch / milestoneMatch: **${report.workerCache.candidateExactKeysMatch} / ${report.workerCache.configMatch} / ${report.workerCache.milestoneMatch}**`,
    "- cache key: `" + report.workerCache.cacheKey + "`",
    `- cache key source: **${report.workerCache.cacheKeySource}**`,
    `- rejection reasons: **${report.workerCache.rejectionReasons.join(", ") || "none"}**`,
    "",
    "## Isolated candidate workers",
    "",
    "| Candidate | Found | Reached | Expansions | Stop | Report valid |",
    "|---|---:|---|---:|---|---:|",
    ...workers.map((worker) => {
      const attempt = worker.search.segmentResults[0] && worker.search.segmentResults[0].attempts[0] || {};
      return `| ${worker.candidateId} | ${worker.search.found} | ${worker.search.reachedMilestone || "-"} | ${attempt.expansions || "-"} | ${attempt.stoppedReason || "-"} | ${worker.workerReportValid} |`;
    }),
    "",
    "## Verdict",
    "",
    `- terminalExactConvergenceViaAlternateAncestry: **${report.verdict.terminalExactConvergenceViaAlternateAncestry}**`,
    `- knownExactTeacherWitnessRecovery: **${report.verdict.knownExactTeacherWitnessRecovery}**`,
    `- winningAncestryCapacityDependency: **${report.verdict.winningAncestryCapacityDependency}**`,
    `- globalDefaultChangeRecommended: **${report.verdict.globalDefaultChangeRecommended}**`,
    `- failedGates: **${report.failedGates.join(", ") || "none"}**`,
    "",
    "No production solver, DP key, dominance comparator, agenda default, or milestone definition was changed.",
    "",
    "## Provenance",
    "",
    `- j artifact: \`${relative(J_REPORT)}\``,
    `- baseline-8 artifact: \`${relative(BASELINE_REPORT)}\``,
    `- j2 generation commit: \`${report.provenance.generationCommit}\``,
  ].join("\n") + "\n";
}

function buildReport() {
  const j = readJson(J_REPORT);
  if (j.conclusionContract) delete j.conclusionContract.contractClosedBy;
  const baseline = readJson(BASELINE_REPORT);
  const project = loadProject(PROJECT_ROOT);
  const simulator = makeSimulator(project);
  const teacherRoute = readJson(TEACHER_ROUTE);
  const teacherReplay = replayRoute(project, simulator, teacherRoute);
  const gateState = teacherReplay.states.find((state) => buildStateKey(state) === j.mt1Setup.candidate2.exactStateKey);
  if (!gateState) throw new Error("candidate-2 gate state not found in teacher replay");
  const entryStage = stageFor(j, "mt2-entry");
  const localStage = stageFor(j, "mt2-local-3582");
  const winningEntrySource = sourceCheckpoint(j, "mt2-entry", "mt2-entry:candidate-0");
  const teacherEntrySource = sourceCheckpoint(j, "mt2-entry", "mt2-entry:candidate-3");
  const localCheckpoint = j.candidate2NaturalRun.search.checkpointResults
    .find((entry) => entry.segmentId === "mt2-local-3582");
  const winningCheckpoint = localCheckpoint && localCheckpoint.candidates.find((candidate) => candidate.id === "mt2-local-3582:candidate-6");
  const teacherLocalCheckpoint = localCheckpoint && localCheckpoint.candidates.find((candidate) => candidate.id === "mt2-local-3582:candidate-7");
  const finalCheckpoint = j.candidate2NaturalRun.search.checkpointResults
    .find((entry) => entry.segmentId === "mt2-hp3834");
  const finalCandidate = finalCheckpoint && finalCheckpoint.candidates[0];
  if (!winningCheckpoint || !teacherLocalCheckpoint || !finalCandidate || !winningEntrySource || !teacherEntrySource) {
    throw new Error("j checkpoint evidence is incomplete");
  }

  const teacherLocalKey = j.winningAncestry.teacherLocalExactStateKey;
  const winningLocalKey = j.winningAncestry.winningLocalCheckpointExactStateKey;
  const diff = buildExactDiff(winningLocalKey, teacherLocalKey);
  const winningBranch = buildPrefixBranch(ROOT, project, simulator, gateState, winningCheckpoint, entryStage, localStage, winningEntrySource);
  const teacherLocalBranch = buildPrefixBranch(ROOT, project, simulator, gateState, teacherLocalCheckpoint, entryStage, localStage, teacherEntrySource);
  const winningEntry = entryAttribution(entryStage, winningEntrySource);
  const teacherEntry = entryAttribution(entryStage, teacherEntrySource);
  const winningFull = buildFullAlternate(ROOT, project, simulator, gateState, winningCheckpoint, finalCandidate);
  const teacherLocalFull = buildFullAlternate(ROOT, project, simulator, gateState, teacherLocalCheckpoint, finalCandidate);
  const firstDivergence = findFirstDivergence(winningBranch.decisions, teacherLocalBranch.decisions);
  const rejoinDecision = winningFull.states.length > 0 && teacherLocalFull.states.length > 0
    ? firstExactRejoin(winningFull.states, teacherLocalFull.states, winningFull.gateDepth)
    : null;
  const ancestryComparison = {
    source: "natural MT1 candidate-2 gate replay",
    gateExactStateKey: buildStateKey(gateState),
    gateExactStateKeyHash: hash(buildStateKey(gateState)),
    gateDecisionDepth: Number(gateState.meta && gateState.meta.decisionDepth || 0),
    firstDivergenceDecision: firstDivergence && firstDivergence.decisionIndex,
    firstDivergenceActions: {
      winner: firstDivergence && firstDivergence.winnerActionSummary,
      teacherLocal: firstDivergence && firstDivergence.teacherActionSummary,
      winnerFingerprint: firstDivergence && firstDivergence.winnerActionFingerprint,
      teacherLocalFingerprint: firstDivergence && firstDivergence.teacherActionFingerprint,
    },
    winningBranch: {
      winningEntryCandidateId: winningEntry.candidateId,
      winningEntryExactStateKey: winningEntry.exactStateKey,
      winningEntryRawSortRank: winningEntry.rawSortRank,
      winningEntrySelectedArchiveRank: winningEntry.selectedArchiveRank,
      winningEntrySegmentRetained: winningEntry.segmentRetained,
      winningEntryMergedRetained: winningEntry.mergedRetained,
      winningLocalCandidateId: winningBranch.decision14LocalCandidateId,
      winningLocalExactStateKey: winningBranch.decision14LocalExactStateKey,
      ...winningBranch,
    },
    teacherLocalBranch: {
      teacherEntryCandidateId: teacherEntry.candidateId,
      teacherEntryExactStateKey: teacherEntry.exactStateKey,
      teacherEntryRawSortRank: teacherEntry.rawSortRank,
      teacherEntrySelectedArchiveRank: teacherEntry.selectedArchiveRank,
      teacherEntrySegmentRetained: teacherEntry.segmentRetained,
      teacherEntryMergedRetained: teacherEntry.mergedRetained,
      teacherLocalCandidateId: teacherLocalBranch.decision14LocalCandidateId,
      teacherLocalExactStateKey: teacherLocalBranch.decision14LocalExactStateKey,
      ...teacherLocalBranch,
    },
    sharedContinuation: {
      winningBranch: {
        performed: winningFull.performed,
        valid: winningFull.valid,
        stepsAttempted: winningFull.stepsAttempted,
        stepsCompleted: winningFull.stepsCompleted,
        finalMatchesTarget: winningFull.finalMatchesTarget,
      },
      teacherLocalBranch: {
        performed: teacherLocalFull.performed,
        valid: teacherLocalFull.valid,
        stepsAttempted: teacherLocalFull.stepsAttempted,
        stepsCompleted: teacherLocalFull.stepsCompleted,
        finalMatchesTarget: teacherLocalFull.finalMatchesTarget,
      },
    },
    firstExactRejoinDecision: rejoinDecision,
  };

  const winningEntryKey = winningEntry.exactStateKey;
  const baselineEntry = baselinePresence(baseline, winningEntryKey, "mt2-entry");
  const baselineLocal = baselinePresence(baseline, winningLocalKey, "mt2-local-3582");
  const winnerLocalAttempt = baselineAttemptEvidence(baseline, winningLocalKey, winningBranch.decision14LocalCandidateId);
  const workerOptions = {
    candidateLimit: 10,
    goalSkylineLimit: 10,
    dpSkylineMax: 4,
    maxActionsPerState: 256,
    maxExpansions: 900,
    maxRuntimeMs: 900000,
    maxHeapMb: 1400,
    maxRssMb: 1800,
    memoryCheckIntervalExpansions: 1,
    memoryCheckIntervalActions: 1,
    childOldSpaceMb: 1600,
    agendaMode: "best-first",
    goalArchiveAudit: null,
  };
  const workerMilestoneId = "onlyup-chaos-mt5-blueking";
  const workerSegmentId = "mt2-hp3834";
  const spec = getMilestoneSpec(project, workerMilestoneId);
  const hpSegment = spec.milestones.find((segment) => segment.id === workerSegmentId);
  const currentWorkerExactKeys = [
    exactKey(winningCheckpoint),
    exactKey(teacherLocalCheckpoint),
  ];
  const solverIdentity = j.provenance && (
    j.provenance.solverCommit ||
    j.provenance.dataGenerationCommit ||
    j.provenance.generationCommit
  ) || null;
  const sourceReportSha256 = sha256(J_REPORT);
  const workerCacheInput = {
    candidateExactStateKeys: currentWorkerExactKeys,
    workerOptions,
    milestoneId: workerMilestoneId,
    segmentId: workerSegmentId,
    projectIdentity: relative(PROJECT_ROOT),
    solverIdentity,
    sourceReportSha256,
  };
  const currentWorkerCacheKey = valueHash(workerCacheInput);
  const previousJ2 = fs.existsSync(DEFAULT_OUT) ? readJson(DEFAULT_OUT) : null;
  const previousWorkers = previousJ2 && previousJ2.isolatedWorkerComparison &&
    previousJ2.isolatedWorkerComparison.workers;
  const previousCache = previousJ2 && previousJ2.workerCache || null;
  const previousConfig = previousJ2 && previousJ2.isolatedWorkerComparison &&
    previousJ2.isolatedWorkerComparison.config;
  const previousCandidateIdsMatch = Array.isArray(previousWorkers) &&
    previousWorkers.length === currentWorkerExactKeys.length &&
    previousWorkers.map((worker) => worker.candidateId).join(",") ===
      [winningCheckpoint.id, teacherLocalCheckpoint.id].join(",");
  const candidateExactKeysMatch = previousCandidateIdsMatch && previousWorkers.every((worker, index) => (
    worker.startExactStateKey === currentWorkerExactKeys[index]
  ));
  const configMatch = previousCandidateIdsMatch && valuesEqual(previousConfig, workerOptions);
  const milestoneMatch = previousCandidateIdsMatch && previousWorkers.every((worker) => (
    worker.search && worker.search.reachedMilestone === workerSegmentId &&
    (worker.search.segmentResults || []).some((segment) => segment.segmentId === workerSegmentId)
  ));
  const previousSourceReportShaMatch = Boolean(
    previousJ2 && previousJ2.provenance &&
    previousJ2.provenance.jReportSha256AfterConclusionCorrection === sourceReportSha256,
  );
  const previousCachedSolverIdentity = previousCache && (
    previousCache.solverIdentity ||
    previousCache.cacheKeyInput && previousCache.cacheKeyInput.solverIdentity
  );
  const previousCachedSourceReportSha256 = previousCache && (
    previousCache.sourceReportSha256 ||
    previousCache.cacheKeyInput && previousCache.cacheKeyInput.sourceReportSha256
  );
  const solverIdentityMatch = Boolean(
    previousCache
      ? previousCachedSolverIdentity === solverIdentity && previousCachedSourceReportSha256 === sourceReportSha256
      : previousSourceReportShaMatch,
  );
  const storedCacheKeyMatch = Boolean(previousCache && previousCache.cacheKey === currentWorkerCacheKey);
  const legacyCacheIdentityMatch = Boolean(
    !previousCache && candidateExactKeysMatch && configMatch && milestoneMatch && solverIdentityMatch,
  );
  const cacheKeyMatches = storedCacheKeyMatch || legacyCacheIdentityMatch;
  const cacheRejectionReasons = [];
  if (previousWorkers && !previousCandidateIdsMatch) cacheRejectionReasons.push("candidate-id-set-mismatch");
  if (previousWorkers && !candidateExactKeysMatch) cacheRejectionReasons.push("candidate-exact-state-key-mismatch");
  if (previousWorkers && !configMatch) cacheRejectionReasons.push("worker-options-mismatch");
  if (previousWorkers && !milestoneMatch) cacheRejectionReasons.push("milestone-or-segment-mismatch");
  if (previousWorkers && !previousSourceReportShaMatch) cacheRejectionReasons.push("source-report-identity-mismatch");
  if (previousWorkers && !solverIdentityMatch) cacheRejectionReasons.push("solver-identity-mismatch");
  if (previousWorkers && !cacheKeyMatches) cacheRejectionReasons.push("worker-cache-key-mismatch");
  if (!previousWorkers) cacheRejectionReasons.push("no-reusable-worker-cache");
  const reusableWorkers = previousWorkers && cacheKeyMatches ? previousWorkers : null;
  const workers = reusableWorkers || [winningCheckpoint, teacherLocalCheckpoint]
    .map((candidate) => runIsolatedLocalCheckpoint(PROJECT_ROOT, project, candidate, hpSegment, workerOptions))
    .map(compactWorker);
  const workerStartKeysMatch = workers.every((worker, index) => (
    worker.startExactStateKey === currentWorkerExactKeys[index]
  ));
  const workerMilestoneMatch = workers.every((worker) => (
    worker.search && (worker.search.segmentResults || []).some((segment) => segment.segmentId === workerSegmentId)
  ));
  const workerCache = {
    reused: Boolean(reusableWorkers),
    candidateExactKeysMatch: workerStartKeysMatch,
    configMatch: reusableWorkers ? configMatch : true,
    milestoneMatch: workerMilestoneMatch,
    solverIdentity,
    sourceReportSha256,
    solverIdentityMatch: reusableWorkers ? solverIdentityMatch : true,
    sourceReportShaMatch: reusableWorkers ? previousSourceReportShaMatch : true,
    cacheKey: currentWorkerCacheKey,
    cacheKeyMatches: reusableWorkers ? cacheKeyMatches : true,
    cacheKeySource: reusableWorkers
      ? (previousCache ? "stored" : "legacy-derived-from-exact-key-config-milestone-identity")
      : "new-worker-run",
    cacheKeyInput: workerCacheInput,
    rejectionReasons: reusableWorkers ? [] : cacheRejectionReasons,
  };
  workerCache.identityValidated = Boolean(
    workerCache.candidateExactKeysMatch &&
    workerCache.configMatch &&
    workerCache.milestoneMatch &&
    workerCache.solverIdentityMatch &&
    workerCache.sourceReportShaMatch &&
    workerCache.cacheKeyMatches,
  );
  const entryRetainedUnder8 = Boolean(
    baselineEntry.rawGoalArchive.present &&
    baselineEntry.segmentCheckpoint.present &&
    baselineEntry.mergedCheckpoint.present,
  );
  const localRetainedUnder8 = Boolean(
    baselineLocal.rawGoalArchive.present ||
    baselineLocal.segmentCheckpoint.present ||
    baselineLocal.mergedCheckpoint.present,
  );
  const exactLocalAttemptExecutedUnder8 = Boolean(winnerLocalAttempt.actualWinnerLocalAttemptExecuted);
  const baselineEvidence = {
    entryRetainedUnder8,
    localRetainedUnder8,
    exactLocalAttemptExecutedUnder8,
    classification: entryRetainedUnder8 && !localRetainedUnder8 && !exactLocalAttemptExecutedUnder8
      ? "insufficient-existing-evidence"
      : "evidence-inconsistent",
    classificationReason: entryRetainedUnder8 && !localRetainedUnder8 && !exactLocalAttemptExecutedUnder8
      ? "baseline retains the winner entry but contains no exact winner-local checkpoint or corresponding downstream attempt"
      : "baseline evidence does not support the expected entry-retained/local-absent classification",
  };
  const baselineClassification = baselineEvidence.classification;
  const teacherFinalExactStateKey = j.winningAncestry.teacherFinalExactStateKey;
  const workerSuccess = workers.every((worker) => (
    worker.processIsolated &&
    worker.exitCode === 0 &&
    worker.signal === null &&
    !worker.timedOut &&
    worker.snapshotRoundTripExact &&
    worker.workerReportValid &&
    worker.search.found &&
    worker.search.reachedMilestone === workerSegmentId &&
    worker.search.finalCandidate &&
    worker.search.finalCandidate.exactStateKey === teacherFinalExactStateKey
  ));
  const sharedContinuationSuccess = Boolean(
    ancestryComparison.sharedContinuation.winningBranch.valid &&
    ancestryComparison.sharedContinuation.winningBranch.stepsAttempted === 13 &&
    ancestryComparison.sharedContinuation.winningBranch.stepsCompleted === 13 &&
    ancestryComparison.sharedContinuation.winningBranch.finalMatchesTarget &&
    ancestryComparison.sharedContinuation.teacherLocalBranch.valid &&
    ancestryComparison.sharedContinuation.teacherLocalBranch.stepsAttempted === 13 &&
    ancestryComparison.sharedContinuation.teacherLocalBranch.stepsCompleted === 13 &&
    ancestryComparison.sharedContinuation.teacherLocalBranch.finalMatchesTarget,
  );
  const j2Gates = {
    workerCacheIdentityValidated: workerCache.identityValidated,
    workerCount: workers.length === 2,
    workerProcessIsolated: workers.every((worker) => worker.processIsolated),
    workerCleanExit: workers.every((worker) => worker.exitCode === 0 && worker.signal === null && !worker.timedOut),
    workerSnapshotRoundTripExact: workers.every((worker) => worker.snapshotRoundTripExact),
    workerReportsValid: workers.every((worker) => worker.workerReportValid),
    workerFoundTarget: workers.every((worker) => worker.search.found === true),
    workerReachedTargetMilestone: workers.every((worker) => worker.search.reachedMilestone === workerSegmentId),
    workerSearchContract: workerSuccess,
    workerFinalExactMatchesTeacherDecision23: workers.every((worker) => (
      worker.search.finalCandidate && worker.search.finalCandidate.exactStateKey === teacherFinalExactStateKey
    )),
    sharedContinuation13Of13: sharedContinuationSuccess,
    firstDivergenceDerived: Boolean(firstDivergence),
    firstDivergenceDecision11: ancestryComparison.firstDivergenceDecision === 11,
    firstDivergenceWinnerFingerprint: ancestryComparison.firstDivergenceActions.winnerFingerprint === "battle|MT1|4|1|skeleton",
    firstDivergenceTeacherFingerprint: ancestryComparison.firstDivergenceActions.teacherLocalFingerprint === "battle|MT1|8|1|skeleton",
    firstExactRejoinDecision20: ancestryComparison.firstExactRejoinDecision === 20,
    baselineClassificationSupported: baselineClassification === "insufficient-existing-evidence",
    terminalExactConvergenceViaAlternateAncestry: Boolean(
      j.winningAncestry.winningRouteFinalMatchesTeacherDecision23 &&
      j.winningAncestry.winningRouteStrictReplay.valid,
    ),
  };
  const failedGates = Object.entries(j2Gates)
    .filter(([, passed]) => passed !== true)
    .map(([name]) => name);

  j.conclusion = CONCLUSION;
  j.conclusionContract = {
    correctedBy: "PR-4.4j2",
    terminalExactConvergenceViaAlternateAncestry: true,
    knownExactTeacherWitnessRecovery: "not-established",
    winningAncestryCapacityDependency: baselineClassification,
  };
  fs.writeFileSync(J_REPORT, JSON.stringify(j, null, 2) + "\n", "utf8");
  const report = {
    schema: "motapathfinder.hp3834-mt2-candidate2-capacity10-ancestry.v1",
    generatedAt: new Date().toISOString(),
    status: failedGates.length === 0 ? "completed" : "completed-with-contract-gaps",
    auditStatus: failedGates.length === 0 ? "completed" : "contract-gaps",
    productionSemanticChange: false,
    conclusion: CONCLUSION,
    candidate6VsTeacherLocal: diff,
    ancestryComparison,
    winningEntryAttribution: {
      winningEntryCandidateId: winningEntry.candidateId,
      winningEntryExactStateKey: winningEntry.exactStateKey,
      winningEntryRawSortRank: winningEntry.rawSortRank,
      winningEntrySelectedArchiveRank: winningEntry.selectedArchiveRank,
      winningEntrySegmentRetained: winningEntry.segmentRetained,
      winningEntryMergedRetained: winningEntry.mergedRetained,
      teacherEntryCandidateId: teacherEntry.candidateId,
      teacherEntryExactStateKey: teacherEntry.exactStateKey,
      teacherEntryRawSortRank: teacherEntry.rawSortRank,
      teacherEntrySelectedArchiveRank: teacherEntry.selectedArchiveRank,
      teacherEntrySegmentRetained: teacherEntry.segmentRetained,
      teacherEntryMergedRetained: teacherEntry.mergedRetained,
    },
    baseline8CrossCheck: {
      artifact: relative(BASELINE_REPORT),
      winnerEntry: baselineEntry,
      winnerLocal: baselineLocal,
      winnerLocalAttempt,
      entryRetainedUnder8: baselineEvidence.entryRetainedUnder8,
      localRetainedUnder8: baselineEvidence.localRetainedUnder8,
      exactLocalAttemptExecutedUnder8: baselineEvidence.exactLocalAttemptExecutedUnder8,
      classification: baselineEvidence.classification,
      classificationReason: baselineEvidence.classificationReason,
      winnerLineageCapacityDependency: baselineClassification,
    },
    isolatedWorkerComparison: {
      config: workerOptions,
      workers,
      sameConfig: workerCache.configMatch,
      workerCount: workers.length,
      allReportsValid: workers.every((worker) => worker.workerReportValid),
    },
    workerCache,
    j2Gates,
    failedGates,
    verdict: {
      terminalExactConvergenceViaAlternateAncestry: Boolean(
        j.winningAncestry.winningRouteFinalMatchesTeacherDecision23 &&
        j.winningAncestry.winningRouteStrictReplay.valid,
      ),
      knownExactTeacherWitnessRecovery: "not-established",
      winningAncestryCapacityDependency: baselineClassification,
      globalDefaultChangeRecommended: "not-established",
    },
    provenance: {
      generationCommit: gitCommit(),
      jReport: relative(J_REPORT),
      jReportSha256AfterConclusionCorrection: sha256(J_REPORT),
      baselineReport: relative(BASELINE_REPORT),
      baselineReportSha256: sha256(BASELINE_REPORT),
      teacherRoute: relative(TEACHER_ROUTE),
      teacherRouteSha256: sha256(TEACHER_ROUTE),
    },
  };
  return report;
}

function main(argv) {
  const args = parseArgs(argv);
  const outFile = path.resolve(args.out || DEFAULT_OUT);
  const outMarkdown = path.resolve(args["out-md"] || outFile.replace(/\.json$/i, ".md"));
  const report = buildReport();
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2) + "\n", "utf8");
  fs.writeFileSync(outMarkdown, buildMarkdown(report), "utf8");
  console.log(JSON.stringify({
    status: report.status,
    conclusion: report.conclusion,
    firstDivergenceDecision: report.ancestryComparison.firstDivergenceDecision,
    firstExactRejoinDecision: report.ancestryComparison.firstExactRejoinDecision,
    winnerLineageCapacityDependency: report.verdict.winningAncestryCapacityDependency,
    workers: report.isolatedWorkerComparison.workers.map((worker) => ({
      candidateId: worker.candidateId,
      found: worker.search.found,
      reachedMilestone: worker.search.reachedMilestone,
      workerReportValid: worker.workerReportValid,
    })),
  }, null, 2));
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { buildExactDiff, buildReport, main };
