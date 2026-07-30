"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { getMilestoneSpec, loadProject } = (() => {
  const milestone = require("./lib/milestone-spec");
  return {
    getMilestoneSpec: milestone.getMilestoneSpec,
    loadProject: require("./lib/project-loader").loadProject,
  };
})();
const {
  buildSegmentActionProvider,
  buildSegmentGoalPredicate,
  runMilestoneGraph,
} = require("./lib/segment-dp");
const { resolveRecordedAction } = require("./lib/route-store");
const { strictReplayRoute } = require("./lib/agenda-policy-evaluation");
const { cloneState, getTileDefinitionAt } = require("./lib/state");
const { buildDominanceKey, buildStateKey } = require("./lib/state-key");
const { buildDpStateKey } = require("./lib/dp-search");
const {
  actionFingerprint,
  compactState,
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
  "mt1-gate-1559-selection-future-value-audit.json",
);
const LIFECYCLE_DECISION_START = 3;
const LIFECYCLE_DECISION_END = 10;
const FUTURE_DECISION_START = 11;
const FUTURE_DECISION_END = 23;

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

function compactHero(state) {
  const hero = state && state.hero || {};
  return {
    hp: Number(hero.hp || 0),
    atk: Number(hero.atk || 0),
    def: Number(hero.def || 0),
    mdef: Number(hero.mdef || 0),
    lv: Number(hero.lv || 0),
    exp: Number(hero.exp || 0),
    loc: hero.loc ? { x: hero.loc.x, y: hero.loc.y, direction: hero.loc.direction || null } : null,
  };
}

function compactAction(simulator, action) {
  if (!action) return null;
  return {
    kind: action.kind || null,
    summary: action.summary || null,
    fingerprint: actionFingerprint(simulator, action),
  };
}

function compactEvent(event) {
  return {
    eventType: event.eventType,
    reasonCode: event.reasonCode || null,
    nodeId: event.nodeId == null ? null : event.nodeId,
    parentId: event.parentId == null ? null : event.parentId,
    candidateId: event.candidateId || null,
    successorId: event.successorId || null,
    evictedNodeId: event.evictedNodeId == null ? null : event.evictedNodeId,
    replacementNodeId: event.replacementNodeId == null ? null : event.replacementNodeId,
    exactStateKey: event.exactStateKey || null,
    dpKey: event.dpKey || null,
    hero: event.hero || null,
    action: event.action || null,
    decisionDepth: event.decisionDepth == null ? null : event.decisionDepth,
    popExpansion: event.popExpansion == null ? null : event.popExpansion,
    frontierSize: event.frontierSize == null ? null : event.frontierSize,
    dominanceWitnesses: Array.isArray(event.dominanceWitnesses)
      ? event.dominanceWitnesses.slice(0, 4)
      : [],
    dominanceComparison: event.dominanceComparison || null,
    dominanceStateDiff: event.dominanceStateDiff || null,
    dominanceWitnessStates: Array.isArray(event.dominanceWitnessStates)
      ? event.dominanceWitnessStates.slice(0, 4).map((state) => compactState(state))
      : [],
  };
}

function compactCandidate(simulator, candidate, segment) {
  if (!candidate || !candidate.state) return null;
  return {
    id: candidate.id || null,
    exactStateKey: buildStateKey(candidate.state),
    dpKey: buildDpStateKey(simulator, candidate.state, {
      dpKeyMode: segment && segment.dp && segment.dp.keyMode || "region",
    }),
    dominanceKey: buildDominanceKey(candidate.state),
    hero: candidate.hero || compactHero(candidate.state),
    effectiveHero: candidate.effectiveHero || null,
    tags: Array.isArray(candidate.tags) ? candidate.tags.slice() : [],
    score: candidate.score == null ? null : candidate.score,
    routeLength: Array.isArray(candidate.route)
      ? candidate.route.length
      : Array.isArray(candidate.state.route)
        ? candidate.state.route.length
        : 0,
  };
}

function actionMatches(simulator, action, decision) {
  if (!action || !decision) return false;
  const expected = decision.fingerprint || decision.actionFingerprint || null;
  const actual = actionFingerprint(simulator, action);
  if (expected && expected === actual) return true;
  return Boolean(decision.summary && action.summary === decision.summary);
}

function createLifecycleObserver(simulator, targets, gateExactStateKey, options) {
  const observerOptions = options || {};
  const continuationBoundaries = observerOptions.continuationBoundaries || {};
  const witnessTargets = new Set(observerOptions.captureDominanceWitnessFor || []);
  const byCandidate = new Map();
  const byNode = new Map();
  const records = new Map(targets.map((target) => [target.id, {
    ...target,
    candidateIds: [],
    nodeIds: [],
    generated: false,
    successorGenerated: false,
    dominanceRejected: false,
    skylineCapacityRejected: false,
    skylineInserted: false,
    skylineEvicted: false,
    agendaPopped: false,
    goalAccepted: false,
    postRejoined: false,
    postRejoinEvents: [],
    rejectedReasons: [],
    events: [],
  }]));
  const goalEvents = [];
  const eventCounts = {};
  const addUnique = (list, value) => {
    if (value != null && !list.includes(value)) list.push(value);
  };
  const addEvent = (record, event) => {
    eventCounts[event.eventType] = Number(eventCounts[event.eventType] || 0) + 1;
    if (record && record.events.length < 200) record.events.push(compactEvent(event));
  };
  const targetForCandidate = (candidateId) => {
    const id = candidateId && byCandidate.get(candidateId);
    return id ? records.get(id) : null;
  };
  const targetForNode = (nodeId) => {
    const id = nodeId != null && byNode.get(nodeId);
    return id ? records.get(id) : null;
  };
  const observer = {
    includeExactStateKey: true,
    dominanceCaptureMode: witnessTargets.size > 0 ? "targeted-state" : "off",
    shouldCaptureDominanceWitness(meta) {
      if (witnessTargets.size === 0 || !meta || !meta.state) return false;
      const exactStateKey = buildStateKey(meta.state);
      const fingerprint = actionFingerprint(simulator, meta.action);
      return Array.from(witnessTargets).some((id) => {
        const record = records.get(id);
        return record &&
          record.expectedPostExactStateKey === exactStateKey &&
          (!record.actionFingerprint || record.actionFingerprint === fingerprint);
      });
    },
    onEvent(event) {
      if (!event || !event.eventType) return;
      if (observerOptions.capturePostStateRejoins === true) {
        records.forEach((record) => {
          const eventAction = event.action || {};
          const samePostState = record.expectedPostExactStateKey === event.exactStateKey;
          const sameAction = record.actionFingerprint
            ? record.actionFingerprint === eventAction.fingerprint
            : record.actionSummary && record.actionSummary === eventAction.summary;
          const postStateEvent = ["candidateRejected", "skylineInserted", "goalAccepted"].includes(event.eventType);
          if (samePostState && sameAction && postStateEvent) {
            record.postRejoined = true;
            if (record.postRejoinEvents.length < 20) record.postRejoinEvents.push(compactEvent(event));
          }
        });
      }
      if (event.eventType === "goalAccepted") {
        goalEvents.push(compactEvent(event));
        if (goalEvents.length > 400) goalEvents.shift();
        records.forEach((record) => {
          if (record.expectedPostExactStateKey === event.exactStateKey) {
            record.goalAccepted = true;
            addEvent(record, event);
          }
        });
      }
      if (event.eventType === "candidateGenerated") {
        records.forEach((record) => {
          if (
            record.preExactStateKey === event.exactStateKey &&
            record.actionSummary === event.action.summary && record.actionFingerprint === event.action.fingerprint
          ) {
            addUnique(record.candidateIds, event.candidateId);
            if (event.candidateId) byCandidate.set(event.candidateId, record.id);
            record.generated = true;
            addEvent(record, event);
          } else if (
            record.preExactStateKey === event.exactStateKey &&
            record.actionSummary === event.action.summary && !record.actionFingerprint
          ) {
            addUnique(record.candidateIds, event.candidateId);
            if (event.candidateId) byCandidate.set(event.candidateId, record.id);
            record.generated = true;
            addEvent(record, event);
          }
        });
      }
      const record = targetForCandidate(event.candidateId) ||
        targetForNode(event.nodeId) ||
        targetForNode(event.evictedNodeId);
      if (!record) return;
      addEvent(record, event);
      if (event.eventType === "candidateRejected") {
        if (event.reasonCode !== "action-trimmed") record.successorGenerated = true;
        if (!record.rejectedReasons.includes(event.reasonCode)) record.rejectedReasons.push(event.reasonCode);
        if (event.reasonCode === "dominance-rejected") record.dominanceRejected = true;
        if (event.reasonCode === "skyline-capacity-rejected") record.skylineCapacityRejected = true;
      } else if (event.eventType === "skylineInserted") {
        record.successorGenerated = true;
        record.skylineInserted = true;
        addUnique(record.nodeIds, event.nodeId);
        if (event.nodeId != null) byNode.set(event.nodeId, record.id);
      } else if (event.eventType === "skylineEvicted") {
        record.skylineEvicted = true;
      } else if (event.eventType === "agendaPopped") {
        record.agendaPopped = true;
      }
    },
  };
  const finalize = () => ({
    eventCounts,
    goalEvents,
    gateGoalEvents: goalEvents.filter((event) => event.exactStateKey === gateExactStateKey),
      records: Object.fromEntries(Array.from(records.entries()).map(([id, record]) => [id, {
      ...record,
      ...(continuationBoundaries[record.decisionIndex] || {}),
      classification: record.postRejoined && record.generated === false
        ? "pre-state-replaced-by-continuation-compatible-witness"
        : continuationBoundaries[record.decisionIndex] &&
        record.generated === false &&
        record.dominanceRejected === false &&
        record.skylineInserted === false
        ? continuationBoundaries[record.decisionIndex].classification
        : record.goalAccepted
        ? "goal-accepted"
        : record.dominanceRejected
          ? "dominance-rejected"
          : record.skylineCapacityRejected
            ? "skyline-capacity-rejected"
            : record.skylineEvicted && !record.agendaPopped
              ? "skyline-evicted"
              : record.skylineInserted
                ? "skyline-retained-or-pending"
                : record.generated
                  ? "candidate-generated-no-lifecycle"
                    : "candidate-not-generated",
    }])),
  });
  return { observer, finalize };
}

function makePipelineObserver(simulator) {
  const attempts = [];
  const merges = [];
  const rawMerges = [];
  return {
    attempts,
    merges,
    rawMerges,
    onAttempt(payload) {
      const attempt = payload.attempt;
      attempts.push({
        segmentId: payload.segment.id,
        candidateId: payload.candidate && payload.candidate.id || null,
        expansions: attempt && attempt.diagnostics && attempt.diagnostics.dp && attempt.diagnostics.dp.expansions,
        frontierSize: attempt && attempt.diagnostics && attempt.diagnostics.dp && attempt.diagnostics.dp.frontierSize,
        stoppedReason: attempt && attempt.diagnostics && attempt.diagnostics.dp && attempt.diagnostics.dp.stoppedReason || null,
        rawGoalSkylineStates: ((attempt && attempt.rawResult && attempt.rawResult.goalSkylineStates) || [])
          .map((state) => compactCandidate(simulator, { state }, payload.segment)),
        segmentGoalSkyline: (attempt && attempt.goalSkyline || [])
          .map((candidate) => compactCandidate(simulator, candidate, payload.segment)),
      });
    },
    onMerge(payload) {
      rawMerges.push({
        segmentId: payload.segment.id,
        nextCandidates: payload.nextCandidates || [],
        merged: payload.merged || [],
      });
      merges.push({
        segmentId: payload.segment.id,
        nextCandidates: (payload.nextCandidates || [])
          .map((candidate) => compactCandidate(simulator, candidate, payload.segment)),
        merged: (payload.merged || [])
          .map((candidate) => compactCandidate(simulator, candidate, payload.segment)),
      });
    },
  };
}

function stagePresence(list, exactStateKey) {
  const matches = (list || []).filter((candidate) => candidate && candidate.exactStateKey === exactStateKey);
  return {
    present: matches.length > 0,
    matches,
  };
}

function hardTileStatus(project, state, segment) {
  const tiles = ((segment || {}).goal || {}).presentTiles || [];
  return tiles.map((tile) => ({
    floorId: tile.floorId,
    x: tile.x,
    y: tile.y,
    reason: tile.reason || null,
    present: getTileDefinitionAt(project, state, tile.floorId, tile.x, tile.y) != null,
  }));
}

function providerForTarget(simulator, segments, targetIndex, state, decision) {
  const segment = segments[Math.min(targetIndex, segments.length - 1)];
  const provider = buildSegmentActionProvider(simulator, segment);
  let actions = [];
  let providerError = null;
  try {
    actions = provider(simulator, state);
  } catch (error) {
    providerError = String(error.message || error);
  }
  return {
    segment,
    provider,
    actions: Array.isArray(actions) ? actions : [],
    providerError,
    containsAction: !providerError && actions.some((action) => actionMatches(simulator, action, decision)),
  };
}

function runFutureValueOracle(project, simulator, startState, teacherRoute, teacherReplay, segments) {
  let state = cloneState(startState);
  let targetIndex = 0;
  const decisions = teacherRoute.decisions.slice(FUTURE_DECISION_START - 1, FUTURE_DECISION_END);
  const steps = [];
  let failure = null;
  const reached = {};
  for (const decision of decisions) {
    if (!state) {
      failure = { decisionIndex: decision.index, reason: "state-unavailable" };
      break;
    }
    const target = providerForTarget(simulator, segments, targetIndex, state, decision);
    const resolved = target.providerError == null
      ? resolveRecordedAction(simulator, state, decision, {
          project,
          candidates: target.actions,
        })
      : { action: null, reason: target.providerError };
    let nextState = null;
    let applyError = null;
    if (resolved.action) {
      try {
        const result = simulator.applyAction(state, resolved.action, { storeRoute: false });
        const successors = Array.isArray(result) ? result : [result];
        nextState = successors.filter(Boolean)[0] || null;
      } catch (error) {
        applyError = String(error.message || error);
      }
    }
    const step = {
      decisionIndex: decision.index,
      action: {
        summary: decision.summary || null,
        kind: decision.kind || null,
        fingerprint: decision.fingerprint || decision.actionFingerprint || null,
      },
      targetSegment: target.segment && target.segment.id,
      providerContainsAction: target.containsAction,
      providerError: target.providerError,
      resolved: Boolean(resolved.action),
      resolveReason: resolved.matchType || resolved.reason || null,
      successorGenerated: Boolean(nextState),
      postExactStateKey: nextState ? buildStateKey(nextState) : null,
      postDominanceKey: nextState ? buildDominanceKey(nextState) : null,
      hero: nextState ? compactHero(nextState) : null,
      reachedMilestone: null,
      error: applyError,
    };
    if (nextState && target.segment && buildSegmentGoalPredicate(project, target.segment, simulator)(nextState)) {
      reached[target.segment.id] = {
        decisionIndex: decision.index,
        exactStateKey: buildStateKey(nextState),
        hero: compactHero(nextState),
      };
      step.reachedMilestone = target.segment.id;
      targetIndex += 1;
    }
    steps.push(step);
    state = nextState;
    if (!resolved.action || !nextState) {
      failure = {
        decisionIndex: decision.index,
        reason: applyError || resolved.reason || "successor-not-generated",
      };
      break;
    }
  }
  const hpSegment = segments[segments.length - 1];
  const reachedHp3834 = Boolean(reached[hpSegment.id]);
  return {
    decisionRange: [FUTURE_DECISION_START, FUTURE_DECISION_END],
    steps,
    failure,
    completeSuffix: steps.length === decisions.length && !failure,
    reached,
    reachedMt2Entry: Boolean(reached["mt2-entry"]),
    reachedMt2Local3582: Boolean(reached["mt2-local-3582"]),
    reachedMt2Hp3834: reachedHp3834,
    final: state ? compactState(state) : null,
    finalHero: state ? compactHero(state) : null,
    hardTiles: hardTileStatus(project, state, hpSegment),
    allHardTilesPresent: Boolean(state && hardTileStatus(project, state, hpSegment).every((tile) => tile.present)),
    teacherExpectedFinal: teacherReplay.states[FUTURE_DECISION_END]
      ? compactState(teacherReplay.states[FUTURE_DECISION_END])
      : null,
  };
}

function buildMarkdown(report) {
  const gate = report.pipeline.teacherGate;
  const lines = [
    "# PR-4.4g MT1 gate selection and future-value audit",
    "",
    "Status: **" + report.status + "**",
    "",
    "## Gate contract",
    "",
    "- Failed gates: " + (report.failedGates.join(", ") || "none") + ".",
    "- Search boundary: found=" + report.search.found + ", expansions=" + report.search.expansions + ", frontier=" + report.search.frontierSize + ", stoppedReason=" + report.search.stoppedReason + ", expansionBudgetExhausted=" + report.search.expansionBudgetExhausted + ".",
    "- Search completed within configured action set: **" + report.gates.searchCompletedWithinConfiguredActionSet + "**.",
    "- Pipeline retention gates (raw DP / segment skyline / merged checkpoint): **" + report.gates.teacherGateRawDpGoalSkylineRetained + " / " + report.gates.teacherGateSegmentGoalSkylineRetained + " / " + report.gates.teacherGateMergedCheckpointRetained + "**.",
    "- Future-value contract gates (complete suffix / hard tiles present): **" + report.gates.futureValueCompleteSuffix + " / " + report.gates.futureValueHardTilesPresent + "**.",
    "",
    "## Teacher-compatible gate lifecycle",
    "",
    "| Decision | Generated | Dominance reject | Skyline insert | Evicted | Popped | Goal accepted | Classification |",
    "|---:|:---:|:---:|:---:|:---:|:---:|:---:|---|",
  ];
  report.lifecycle.records.forEach((record) => {
    lines.push(
      "| " + record.decisionIndex +
      " | " + record.generated +
      " | " + record.dominanceRejected +
      " | " + record.skylineInserted +
      " | " + record.skylineEvicted +
      " | " + record.agendaPopped +
      " | " + record.goalAccepted +
      " | " + record.classification + " |",
    );
  });
  lines.push(
    "",
    "- Teacher gate exact key naturally goalAccepted: **" + gate.goalAccepted + "**.",
    "- Teacher gate raw DP goal skyline: **" + gate.rawDpGoalSkyline.present + "**.",
    "- Teacher gate segment goal skyline: **" + gate.segmentGoalSkyline.present + "**.",
    "- Teacher gate merged milestone checkpoint: **" + gate.mergedCheckpoint.present + "**.",
    "",
    "## Future-value oracle",
    "",
    "| Start | Complete suffix | MT2 entry | MT2 local-3582 | HP3834 | Hard tiles present | Final HP |",
    "|---|:---:|:---:|:---:|:---:|:---:|---:|",
  );
  report.futureValue.forEach((entry) => {
    lines.push(
      "| " + entry.label +
      " | " + entry.audit.completeSuffix +
      " | " + entry.audit.reachedMt2Entry +
      " | " + entry.audit.reachedMt2Local3582 +
      " | " + entry.audit.reachedMt2Hp3834 +
      " | " + entry.audit.allHardTilesPresent +
      " | " + String(entry.audit.finalHero && entry.audit.finalHero.hp) + " |",
    );
  });
  lines.push(
    "",
    "The audit is oracle-only. It does not inject teacher decisions into production search and does not modify dominance, DP keys, skyline limits, checkpoint selection, or agenda defaults.",
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
  const project = loadProject(projectRoot);
  const simulator = makeSimulator(project);
  const teacherRoute = readJson(teacherRouteFile);
  const productionRoute = readJson(productionRouteFile);
  const teacherStrictReplay = strictReplayRoute(project, simulator, teacherRoute);
  const productionStrictReplay = strictReplayRoute(project, simulator, productionRoute);
  const teacherReplay = replayRoute(project, simulator, teacherRoute);
  const productionReplay = replayRoute(project, simulator, productionRoute);
  const spec = getMilestoneSpec(project, "onlyup-chaos-mt5-blueking");
  const segmentsById = Object.fromEntries(
    ["mt1-gate-1559", "mt2-entry", "mt2-local-3582", "mt2-hp3834"]
      .map((id) => [id, spec.milestones.find((milestone) => milestone.id === id)]),
  );
  if (Object.values(segmentsById).some((segment) => !segment)) {
    throw new Error("Missing required MT1/MT2 milestone.");
  }
  const mt1 = segmentsById["mt1-gate-1559"];
  const teacherGatePredicate = buildSegmentGoalPredicate(project, mt1, simulator);
  const teacherGateStateIndex = teacherReplay.states.findIndex((state) => teacherGatePredicate(state));
  if (teacherGateStateIndex < 0) throw new Error("Teacher route has no formal mt1-gate-1559 state.");
  const teacherGateState = teacherReplay.states[teacherGateStateIndex];
  const gateExactStateKey = buildStateKey(teacherGateState);
  const lifecycleTargets = [];
  for (let decisionNumber = LIFECYCLE_DECISION_START; decisionNumber <= LIFECYCLE_DECISION_END; decisionNumber += 1) {
    const decisionIndex = decisionNumber - 1;
    const decision = teacherRoute.decisions[decisionIndex];
    const preState = teacherReplay.states[decisionIndex];
    const postState = teacherReplay.states[decisionIndex + 1];
    const provider = buildSegmentActionProvider(simulator, mt1);
    const action = provider(simulator, preState).find((candidate) => candidate.summary === decision.summary);
    lifecycleTargets.push({
      id: "decision-" + decisionNumber,
      decisionIndex: decisionNumber,
      actionSummary: decision.summary,
      actionFingerprint: actionFingerprint(simulator, action),
      preExactStateKey: buildStateKey(preState),
      expectedPostExactStateKey: buildStateKey(postState),
    });
  }
  const lifecycleCollector = createLifecycleObserver(simulator, lifecycleTargets, gateExactStateKey, {
    continuationBoundaries: {
      3: {
        classification: "pre-state-replaced-by-continuation-compatible-witness",
        exactRejoinedAtDecision: 4,
      },
    },
  });
  const pipelineCollector = makePipelineObserver(simulator);
  const maxExpansions = number(args["max-expansions"], 400);
  const maxRuntimeMs = number(args["max-runtime-ms"], 900000);
  const run = runMilestoneGraph(simulator, teacherReplay.states[1], { milestones: [mt1] }, {
    candidateLimit: number(args["candidate-limit"], 8),
    goalSkylineLimit: number(args["goal-skyline-limit"], 8),
    dpSkylineMax: number(args["dp-skyline-max"], 4),
    preserveSkylineRoles: args["preserve-skyline-roles"] !== "0",
    stopOnFirstGoal: false,
    maxActionsPerState: number(args["max-actions-per-state"], 256),
    maxExpansions,
    maxRuntimeMs,
    maxHeapMb: number(args["max-heap-mb"], 1400),
    maxRssMb: number(args["max-rss-mb"], 1800),
    memoryCheckIntervalExpansions: number(args["memory-check-interval-expansions"], 1),
    memoryCheckIntervalActions: number(args["memory-check-interval-actions"], 1),
    agendaMode: args["agenda-mode"] || "best-first",
    observer: lifecycleCollector.observer,
    observerIncludeExactStateKey: true,
    pipelineObserver: pipelineCollector,
  });
  const lifecycle = lifecycleCollector.finalize();
  const teacherGateLifecycle = lifecycle.records["decision-" + LIFECYCLE_DECISION_END];
  const attempt = pipelineCollector.attempts[0] || null;
  const merge = pipelineCollector.merges[0] || null;
  const rawDpGoalSkyline = stagePresence(attempt && attempt.rawGoalSkylineStates, gateExactStateKey);
  const segmentGoalSkyline = stagePresence(attempt && attempt.segmentGoalSkyline, gateExactStateKey);
  const mergedCheckpoint = stagePresence(merge && merge.merged, gateExactStateKey);
  const nextCandidate = stagePresence(merge && merge.nextCandidates, gateExactStateKey);
  const gate = {
    exactStateKey: gateExactStateKey,
    goalAccepted: Boolean(teacherGateLifecycle && teacherGateLifecycle.goalAccepted),
    rawDpGoalSkyline,
    segmentGoalSkyline,
    nextCandidate,
    mergedCheckpoint,
    lifecycle: teacherGateLifecycle || null,
    stages: {
      searchGoalAccepted: teacherGateLifecycle && teacherGateLifecycle.goalAccepted
        ? "goal-accepted"
        : "goal-not-accepted",
      dpGoalSkyline: rawDpGoalSkyline.present
        ? "dp-goal-skyline-retained"
        : teacherGateLifecycle && teacherGateLifecycle.goalAccepted
          ? "dp-goal-skyline-dropped"
          : "not-reached",
      segmentGoalSelection: segmentGoalSkyline.present
        ? "segment-goal-selection-retained"
        : rawDpGoalSkyline.present
          ? "segment-goal-selection-dropped"
          : "not-reached",
      milestoneCheckpoint: mergedCheckpoint.present
        ? "checkpoint-retained"
        : segmentGoalSkyline.present
          ? "milestone-checkpoint-dropped"
          : "not-reached",
    },
  };
  const futureSegments = [
    segmentsById["mt2-entry"],
    segmentsById["mt2-local-3582"],
    segmentsById["mt2-hp3834"],
  ];
  const futureValue = [{
    label: "teacher-compatible MT1 gate",
    exactStateKey: gateExactStateKey,
    dpKey: buildDpStateKey(simulator, teacherGateState, { dpKeyMode: mt1.dp.keyMode }),
    tags: ["oracle-teacher-gate"],
    state: compactState(teacherGateState),
    audit: runFutureValueOracle(project, simulator, teacherGateState, teacherRoute, teacherReplay, futureSegments),
  }];
  const rawMerge = pipelineCollector.rawMerges[0] || null;
  ((rawMerge && rawMerge.merged) || []).forEach((candidate, index) => {
    futureValue.push({
      label: "retained MT1 checkpoint " + (index + 1),
      exactStateKey: buildStateKey(candidate.state),
      dpKey: buildDpStateKey(simulator, candidate.state, { dpKeyMode: mt1.dp.keyMode }),
      tags: candidate.tags || [],
      state: compactState(candidate.state),
      audit: runFutureValueOracle(project, simulator, candidate.state, teacherRoute, teacherReplay, futureSegments),
    });
  });
  const searchDiagnostics = run && run.segmentResults && run.segmentResults[0] &&
    run.segmentResults[0].attempts && run.segmentResults[0].attempts[0] &&
    run.segmentResults[0].attempts[0].diagnostics &&
    run.segmentResults[0].attempts[0].diagnostics.dp || {};
  const searchFound = Boolean(run && run.found && run.reachedMilestone === mt1.id);
  const inputGates = {
    teacherStrictReplay: Boolean(teacherStrictReplay && teacherStrictReplay.valid),
    productionStrictReplay: Boolean(productionStrictReplay && productionStrictReplay.valid),
    commonExactState: buildStateKey(teacherReplay.states[1]) === buildStateKey(productionReplay.states[1]),
    commonDominanceState: buildDominanceKey(teacherReplay.states[1]) === buildDominanceKey(productionReplay.states[1]),
    searchExecuted: Boolean(run && run.segmentResults && run.segmentResults.length > 0),
    searchCompletedWithinConfiguredActionSet: Boolean(
      searchDiagnostics.frontierSize === 0 &&
      !searchDiagnostics.stoppedReason &&
      !searchDiagnostics.expansionBudgetExhausted,
    ),
  };
  const gates = {
    ...inputGates,
    teacherGateGoalAccepted: gate.goalAccepted,
    teacherGateRawDpGoalSkylineRetained: rawDpGoalSkyline.present,
    teacherGateSegmentGoalSkylineRetained: segmentGoalSkyline.present,
    teacherGateMergedCheckpointRetained: mergedCheckpoint.present,
    teacherGateCheckpointPipelineObserved: Boolean(attempt && merge),
    teacherGateFutureReachedHp3834: Boolean(futureValue[0].audit.reachedMt2Hp3834),
    futureValueAuditExecuted: futureValue.length >= 1 && futureValue.every((entry) => entry.audit && Array.isArray(entry.audit.steps)),
    futureValueCompleteSuffix: futureValue.length >= 1 && futureValue.every((entry) => entry.audit && entry.audit.completeSuffix),
    futureValueHardTilesPresent: futureValue.length >= 1 && futureValue.every((entry) => entry.audit && entry.audit.allHardTilesPresent),
  };
  const failedGates = Object.entries(gates).filter((entry) => !entry[1]).map((entry) => entry[0]);
  const inconclusive = inputGates.teacherStrictReplay &&
    inputGates.productionStrictReplay &&
    inputGates.commonExactState &&
    inputGates.commonDominanceState &&
    !gate.goalAccepted &&
    searchDiagnostics.stoppedReason === "time-limit";
  const status = failedGates.some((name) => inputGates[name] === false)
    ? "failed"
    : inconclusive
      ? "inconclusive"
      : failedGates.length > 0
        ? "failed"
        : "completed";
  const finishedCommit = gitCommit();
  const report = {
    schema: "motapathfinder.hp3834-mt1-gate-selection-future-value-audit.v1",
    generatedAt: new Date().toISOString(),
    status,
    inconclusive,
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
      exactStateEqual: inputGates.commonExactState,
      dominanceKeyEqual: inputGates.commonDominanceState,
      teacher: compactState(teacherReplay.states[1]),
      production: compactState(productionReplay.states[1]),
    },
    teacherGate: {
      stateIndex: teacherGateStateIndex,
      state: compactState(teacherGateState),
      exactStateKey: gateExactStateKey,
      dpKey: buildDpStateKey(simulator, teacherGateState, { dpKeyMode: mt1.dp.keyMode }),
    },
    lifecycle: {
      decisionRange: [LIFECYCLE_DECISION_START, LIFECYCLE_DECISION_END],
      records: Object.values(lifecycle.records),
      goalEvents: lifecycle.goalEvents,
      gateGoalEvents: lifecycle.gateGoalEvents,
    },
    pipeline: {
      teacherGate: gate,
      attempts: pipelineCollector.attempts,
      merges: pipelineCollector.merges,
    },
    search: {
      found: searchFound,
      reachedMilestone: run && run.reachedMilestone || null,
      expansions: searchDiagnostics.expansions,
      frontierSize: searchDiagnostics.frontierSize,
      stoppedReason: searchDiagnostics.stoppedReason || null,
      expansionBudgetExhausted: Boolean(searchDiagnostics.expansionBudgetExhausted),
      memory: searchDiagnostics.memory || null,
      childOldSpaceMb: number(args["child-old-space-mb"], 1600),
      ledger: run && run.evaluationAttemptLedger || [],
    },
    futureValue,
    routeChecks: {
      teacherStrictReplay,
      productionStrictReplay,
      teacherReplayErrors: teacherReplay.errors,
      productionReplayErrors: productionReplay.errors,
    },
    conclusion: gate.goalAccepted
      ? "The teacher-compatible MT1 gate was traced through natural goal acceptance, goal/segment skyline, merged checkpoint stages, and oracle-only MT2/HP3834 continuation."
      : "The teacher-compatible MT1 gate was not naturally goalAccepted within the configured search boundary; checkpoint selection is not evaluated as causal.",
  };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2) + "\n", "utf8");
  fs.writeFileSync(outMarkdown, buildMarkdown(report), "utf8");
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) main();

module.exports = {
  createLifecycleObserver,
  makePipelineObserver,
  runFutureValueOracle,
};
