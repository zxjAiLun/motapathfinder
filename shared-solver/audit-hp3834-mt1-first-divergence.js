"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { getMilestoneSpec } = require("./lib/milestone-spec");
const { loadProject } = require("./lib/project-loader");
const {
  buildSegmentActionProvider,
  runMilestoneGraph,
} = require("./lib/segment-dp");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const {
  resolveRecordedAction,
} = require("./lib/route-store");
const { StaticSimulator } = require("./lib/simulator");
const { buildDominanceKey, buildStateKey } = require("./lib/state-key");
const { strictReplayRoute } = require("./lib/agenda-policy-evaluation");

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
  "mt1-gate-1559-first-divergence-audit.json",
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

function booleanArg(value, fallback) {
  if (value == null) return fallback;
  return value === "1" || value === "true";
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

function makeSimulator(project) {
  return new StaticSimulator(project, {
    stopFloorId: "MT6",
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

function heroSummary(state) {
  const hero = (state && state.hero) || {};
  return {
    hp: Number(hero.hp || 0),
    atk: Number(hero.atk || 0),
    def: Number(hero.def || 0),
    mdef: Number(hero.mdef || 0),
    exp: Number(hero.exp || 0),
    lv: Number(hero.lv || 0),
    location: state && state.hero && state.hero.loc
      ? { floorId: state.floorId, x: state.hero.loc.x, y: state.hero.loc.y }
      : null,
  };
}

function compactState(state) {
  if (!state) return null;
  return {
    floorId: state.floorId,
    hero: heroSummary(state),
    exactStateKey: buildStateKey(state),
    dominanceKey: buildDominanceKey(state),
    routeTail: Array.isArray(state.route) ? state.route.slice(-12) : [],
  };
}

function replayRoute(project, simulator, record) {
  let state = simulator.createInitialState({ rank: "chaos" });
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
      const expectedPost = decision.postExactStateKey || null;
      state = successors.find((candidate) => !expectedPost || buildStateKey(candidate) === expectedPost) || successors[0];
      if (!state) throw new Error("no-successor");
      state.meta = { ...(state.meta || {}), decisionDepth: index + 1 };
      states.push(state);
    } catch (error) {
      errors.push({ index: decision.index || index + 1, reason: String(error.message || error) });
      break;
    }
  }
  return { states, state, errors };
}

function actionFingerprint(simulator, action) {
  if (!action) return null;
  if (action.fingerprint) return action.fingerprint;
  try {
    return simulator.getActionFingerprint(action);
  } catch (error) {
    return null;
  }
}

function eventAction(event) {
  return event && event.action || null;
}

function eventActionSummary(event) {
  return eventAction(event) && eventAction(event).summary;
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
    floorId: event.floorId || null,
    hero: event.hero || null,
    decisionDepth: event.decisionDepth == null ? null : event.decisionDepth,
    agendaRank: event.agendaRank || null,
    popExpansion: event.popExpansion == null ? null : event.popExpansion,
    expansions: event.expansions == null ? null : event.expansions,
    frontierSize: event.frontierSize == null ? null : event.frontierSize,
    dominanceComparison: event.dominanceComparison || null,
    dominanceWitnesses: event.dominanceWitnesses || [],
  };
}

function createLineageObserver(commonExactStateKey, targets) {
  const candidateToLineage = new Map();
  const nodeToLineage = new Map();
  const lineages = new Map(targets.map((target) => [target.id, {
    ...target,
    candidateIds: [],
    successorIds: [],
    nodeIds: [],
    activeNodeIds: new Set(),
    generated: false,
    successorGenerated: false,
    acceptedIntoSkyline: false,
    dominanceRejected: false,
    skylineCapacityRejected: false,
    skylineEvicted: false,
    agendaPopped: false,
    goalAccepted: false,
    goalNodeIds: [],
    goalExactStateKeys: [],
    events: [],
    rootCandidateIds: [],
    rootNodeIds: [],
    rootGenerated: false,
    rootSuccessorGenerated: false,
    rootAcceptedIntoSkyline: false,
    rootDominanceRejected: false,
    rootSkylineCapacityRejected: false,
    rootSkylineEvicted: false,
    rootAgendaPopped: false,
    rootGoalAccepted: false,
    rootRejectedReasons: [],
  }]));
  const eventCounts = {};
  const appendEvent = (lineage, event) => {
    eventCounts[event.eventType] = Number(eventCounts[event.eventType] || 0) + 1;
    if (lineage.events.length < 4000) lineage.events.push(compactEvent(event));
  };
  const addCandidate = (lineage, event) => {
    const candidateId = event.candidateId || null;
    if (candidateId && !lineage.candidateIds.includes(candidateId)) {
      lineage.candidateIds.push(candidateId);
      candidateToLineage.set(candidateId, lineage.id);
    }
    const successorId = event.successorId || null;
    if (successorId && !lineage.successorIds.includes(successorId)) {
      lineage.successorIds.push(successorId);
    }
  };
  const addNode = (lineage, nodeId) => {
    if (nodeId == null) return;
    if (!lineage.nodeIds.includes(nodeId)) lineage.nodeIds.push(nodeId);
    lineage.activeNodeIds.add(nodeId);
    nodeToLineage.set(nodeId, lineage.id);
  };
  const lineageFor = (event) => {
    const ids = [
      event.candidateId && candidateToLineage.get(event.candidateId),
      event.successorId && candidateToLineage.get(event.successorId),
      event.nodeId != null && nodeToLineage.get(event.nodeId),
      event.parentId != null && nodeToLineage.get(event.parentId),
      event.evictedNodeId != null && nodeToLineage.get(event.evictedNodeId),
    ].filter(Boolean);
    return ids.length > 0 ? lineages.get(ids[0]) : null;
  };
  const observer = {
    includeExactStateKey: true,
    onEvent(event) {
      if (!event || !event.eventType) return;
      const matchingTargets = event.eventType === "candidateGenerated" &&
        event.exactStateKey === commonExactStateKey
        ? Array.from(lineages.values()).filter((lineage) => lineage.actionSummary === eventActionSummary(event))
        : [];
      matchingTargets.forEach((lineage) => {
        addCandidate(lineage, event);
        if (event.candidateId && !lineage.rootCandidateIds.includes(event.candidateId)) {
          lineage.rootCandidateIds.push(event.candidateId);
        }
        lineage.rootGenerated = true;
        lineage.generated = true;
        appendEvent(lineage, event);
      });
      let lineage = lineageFor(event);
      if (!lineage && event.eventType === "skylineInserted" && event.exactStateKey) {
        lineage = Array.from(lineages.values()).find((candidate) =>
          candidate.expectedPostExactStateKey === event.exactStateKey && event.parentId === 0,
        ) || null;
      }
      if (!lineage) return;
      if (!matchingTargets.includes(lineage)) appendEvent(lineage, event);
      if (event.eventType === "candidateGenerated") {
        addCandidate(lineage, event);
        lineage.generated = true;
      } else if (event.eventType === "candidateRejected") {
        addCandidate(lineage, event);
        if (event.reasonCode !== "action-trimmed") lineage.successorGenerated = true;
        if (event.reasonCode === "dominance-rejected") lineage.dominanceRejected = true;
        if (event.reasonCode === "skyline-capacity-rejected") lineage.skylineCapacityRejected = true;
        if (lineage.rootCandidateIds.includes(event.candidateId)) {
          lineage.rootSuccessorGenerated = event.reasonCode !== "action-apply-error";
          if (!lineage.rootRejectedReasons.includes(event.reasonCode)) lineage.rootRejectedReasons.push(event.reasonCode);
          if (event.reasonCode === "dominance-rejected") lineage.rootDominanceRejected = true;
          if (event.reasonCode === "skyline-capacity-rejected") lineage.rootSkylineCapacityRejected = true;
        }
      } else if (event.eventType === "skylineInserted") {
        addCandidate(lineage, event);
        addNode(lineage, event.nodeId);
        lineage.acceptedIntoSkyline = true;
        lineage.successorGenerated = true;
        if (lineage.rootCandidateIds.includes(event.candidateId) || event.parentId === 0) {
          if (!lineage.rootNodeIds.includes(event.nodeId)) lineage.rootNodeIds.push(event.nodeId);
          lineage.rootAcceptedIntoSkyline = true;
          lineage.rootSuccessorGenerated = true;
        }
      } else if (event.eventType === "skylineEvicted") {
        lineage.skylineEvicted = true;
        if (event.evictedNodeId != null) lineage.activeNodeIds.delete(event.evictedNodeId);
        if (lineage.rootNodeIds.includes(event.evictedNodeId)) lineage.rootSkylineEvicted = true;
      } else if (event.eventType === "agendaPopped") {
        if (event.nodeId != null) lineage.activeNodeIds.delete(event.nodeId);
        lineage.agendaPopped = true;
        if (lineage.rootNodeIds.includes(event.nodeId)) lineage.rootAgendaPopped = true;
      } else if (event.eventType === "goalAccepted") {
        lineage.goalAccepted = true;
        if (event.nodeId != null && !lineage.goalNodeIds.includes(event.nodeId)) lineage.goalNodeIds.push(event.nodeId);
        if (event.exactStateKey && !lineage.goalExactStateKeys.includes(event.exactStateKey)) lineage.goalExactStateKeys.push(event.exactStateKey);
        if (lineage.rootNodeIds.includes(event.nodeId)) lineage.rootGoalAccepted = true;
      }
    },
  };
  const finalize = () => {
    const output = {};
    lineages.forEach((lineage) => {
      output[lineage.id] = {
        id: lineage.id,
        actionSummary: lineage.actionSummary,
        expectedPostExactStateKey: lineage.expectedPostExactStateKey,
        expectedPostDominanceKey: lineage.expectedPostDominanceKey,
        providerContainsAction: lineage.providerContainsAction,
        candidateIds: lineage.candidateIds,
        successorIds: lineage.successorIds,
        nodeIds: lineage.nodeIds,
        generated: lineage.generated,
        successorGenerated: lineage.successorGenerated,
        acceptedIntoSkyline: lineage.acceptedIntoSkyline,
        dominanceRejected: lineage.dominanceRejected,
        skylineCapacityRejected: lineage.skylineCapacityRejected,
        skylineEvicted: lineage.skylineEvicted,
        agendaPopped: lineage.agendaPopped,
        goalAccepted: lineage.goalAccepted,
        goalNodeIds: lineage.goalNodeIds,
        goalExactStateKeys: lineage.goalExactStateKeys,
        activeNodeIdsAtStop: Array.from(lineage.activeNodeIds),
        rootCandidateIds: lineage.rootCandidateIds,
        rootNodeIds: lineage.rootNodeIds,
        rootGenerated: lineage.rootGenerated,
        rootSuccessorGenerated: lineage.rootSuccessorGenerated,
        rootAcceptedIntoSkyline: lineage.rootAcceptedIntoSkyline,
        rootDominanceRejected: lineage.rootDominanceRejected,
        rootSkylineCapacityRejected: lineage.rootSkylineCapacityRejected,
        rootSkylineEvicted: lineage.rootSkylineEvicted,
        rootAgendaPopped: lineage.rootAgendaPopped,
        rootGoalAccepted: lineage.rootGoalAccepted,
        rootRejectedReasons: lineage.rootRejectedReasons,
        events: lineage.events,
      };
    });
    return { eventCounts, lineages: output };
  };
  return { observer, finalize };
}

function classifyLineage(lineage, search) {
  if (!lineage.providerContainsAction) return "action-provider-missing";
  if (!lineage.rootGenerated) return "candidate-not-generated";
  if (lineage.rootDominanceRejected) return "dominance-rejected";
  if (lineage.rootSkylineCapacityRejected) return "skyline-capacity-rejected";
  if (lineage.rootSkylineEvicted && !lineage.rootAgendaPopped) return "skyline-evicted";
  if (lineage.goalAccepted) return "reached-mt1-goal";
  if (lineage.rootAcceptedIntoSkyline && !lineage.rootAgendaPopped && search.frontierSize > 0) return "agenda-never-popped";
  if (lineage.rootAcceptedIntoSkyline && search.frontierSize === 0) return "frontier-exhausted-before-goal";
  return "lineage-still-alive-at-stop";
}

function compactCheckpoint(checkpoint) {
  if (!checkpoint) return null;
  const state = checkpoint.state;
  return {
    id: checkpoint.id,
    tags: checkpoint.tags || [],
    hero: checkpoint.hero || heroSummary(state),
    effectiveHero: checkpoint.effectiveHero || null,
    routeLength: checkpoint.routeLength == null ? (checkpoint.route || []).length : checkpoint.routeLength,
    exactStateKey: state ? buildStateKey(state) : null,
    dominanceKey: state ? buildDominanceKey(state) : null,
  };
}

function compactRun(result, targetStateKeys) {
  const summary = result && result.segmentResults && result.segmentResults[0] || null;
  const checkpoints = result && result.checkpointResults && result.checkpointResults[0];
  const candidates = checkpoints && checkpoints.candidates || [];
  return {
    found: Boolean(result && result.found),
    reachedMilestone: result && result.reachedMilestone || null,
    budget: result && result.budget || null,
    memory: result && result.memory || null,
    segment: summary
      ? {
          segmentId: summary.segmentId,
          found: summary.found,
          startCandidatesTried: summary.startCandidatesTried,
          goalCount: summary.candidates && summary.candidates.length || 0,
          attempts: (summary.attempts || []).map((attempt) => ({
            startCandidateId: attempt.startCandidateId,
            found: attempt.found,
            goalCount: attempt.goalCount,
            expansions: attempt.diagnostics && attempt.diagnostics.dp && attempt.diagnostics.dp.expansions,
            frontierSize: attempt.diagnostics && attempt.diagnostics.dp && attempt.diagnostics.dp.frontierSize,
            stoppedReason: attempt.diagnostics && attempt.diagnostics.dp && attempt.diagnostics.dp.stoppedReason,
          })),
        }
      : null,
    checkpointCandidates: candidates.map(compactCheckpoint),
    checkpointMatches: candidates
      .map(compactCheckpoint)
      .filter((candidate) => candidate && targetStateKeys.includes(candidate.exactStateKey))
      .map((candidate) => candidate.id),
    finalCandidateCount: result && result.finalCandidates ? result.finalCandidates.length : 0,
  };
}

function buildMarkdown(report) {
  const lines = [
    "# PR-4.4e MT1 first divergence audit",
    "",
    `Status: **${report.status}**`,
    "",
    "## Scope",
    "",
    "- Common root: state index 1, after `battle:blackSlime@MT1:8,7`.",
    "- Segment: `mt1-gate-1559`.",
    "- Search ran with the production defaults: best-first, dp skyline 4, candidate/goal skyline 8, preserve skyline roles enabled.",
    "",
    "## First route divergence",
    "",
    `- Teacher decision 2: ${report.firstDivergence.teacher.actionSummary}`,
    `- Production decision 2: ${report.firstDivergence.production.actionSummary}`,
    `- Common exact state: **${report.commonBoundary.exactStateEqual}**; common dominance state: **${report.commonBoundary.dominanceKeyEqual}**.`,
    "",
    "## Lineage result",
    "",
    "| Lineage | Provider | Candidate | Successor | Root skyline | Root dominance reject | Root evicted | Root agenda pop | Any goal | Classification |",
    "|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|---|",
  ];
  for (const lineage of Object.values(report.lineages)) {
    lines.push(`| ${lineage.id} | ${lineage.providerContainsAction} | ${lineage.generated} | ${lineage.successorGenerated} | ${lineage.rootAcceptedIntoSkyline} | ${lineage.rootDominanceRejected} | ${lineage.rootSkylineEvicted} | ${lineage.rootAgendaPopped} | ${lineage.goalAccepted} | ${lineage.classification} |`);
  }
  lines.push(
    "",
    `Search: found=${report.search.found}, expansions=${report.search.segment && report.search.segment.attempts[0] && report.search.segment.attempts[0].expansions}, frontier=${report.search.segment && report.search.segment.attempts[0] && report.search.segment.attempts[0].frontierSize}.`,
    `Route-fixture checkpoint matches: ${report.search.checkpointMatches.join(", ") || "none"}.`,
    `Teacher lineage checkpoint matches: ${report.lineages["teacher-decision-2"].checkpointMatches.length || 0}; production lineage checkpoint matches: ${report.lineages["production-decision-2"].checkpointMatches.length || 0}.`,
    "",
    "The lineage audit is diagnostic-only and does not modify dominance, DP keys, skyline size, or agenda defaults.",
    "",
    "## Provenance",
    "",
    `- solver commit: ${report.provenance.solverCommit}`,
    `- commit stable: **${report.provenance.commitStable}**`,
    `- clean worktree: **${report.provenance.worktreeCleanAtStart}/${report.provenance.worktreeCleanAtFinish}**`,
    "",
  );
  return `${lines.join("\n")}\n`;
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
  const segment = spec.milestones.find((milestone) => milestone.id === "mt1-gate-1559");
  if (!segment) throw new Error("Missing mt1-gate-1559 milestone.");
  const teacherCommon = teacherReplay.states[1];
  const productionCommon = productionReplay.states[1];
  const teacherDecision = teacherRoute.decisions[1];
  const productionDecision = productionRoute.decisions[1];
  const commonExactStateKey = buildStateKey(teacherCommon);
  const commonDominanceKey = buildDominanceKey(teacherCommon);
  const providerActions = buildSegmentActionProvider(simulator, segment)(simulator, teacherCommon);
  const targets = [
    {
      id: "teacher-decision-2",
      actionSummary: teacherDecision.summary,
      expectedPostExactStateKey: buildStateKey(teacherReplay.states[2]),
      expectedPostDominanceKey: buildDominanceKey(teacherReplay.states[2]),
      providerContainsAction: providerActions.some((action) => action.summary === teacherDecision.summary),
    },
    {
      id: "production-decision-2",
      actionSummary: productionDecision.summary,
      expectedPostExactStateKey: buildStateKey(productionReplay.states[2]),
      expectedPostDominanceKey: buildDominanceKey(productionReplay.states[2]),
      providerContainsAction: providerActions.some((action) => action.summary === productionDecision.summary),
    },
  ];
  const lineageCollector = createLineageObserver(commonExactStateKey, targets);
  const maxExpansions = number(args["max-expansions"], segment.dp && segment.dp.maxExpansions || 4000);
  const maxRuntimeMs = number(args["max-runtime-ms"], segment.dp && segment.dp.maxRuntimeMs || 15000);
  const run = runMilestoneGraph(simulator, teacherCommon, { milestones: [segment] }, {
    candidateLimit: number(args["candidate-limit"], 8),
    goalSkylineLimit: number(args["goal-skyline-limit"], 8),
    dpSkylineMax: number(args["dp-skyline-max"], 4),
    preserveSkylineRoles: booleanArg(args["preserve-skyline-roles"], true),
    stopOnFirstGoal: false,
    maxActionsPerState: number(args["max-actions-per-state"], 256),
    maxExpansions,
    maxRuntimeMs,
    agendaMode: args["agenda-mode"] || "best-first",
    observer: lineageCollector.observer,
    observerIncludeExactStateKey: true,
  });
  const observed = lineageCollector.finalize();
  const teacherGoal = teacherReplay.states.find((state) => segment.goal.floorId === state.floorId &&
    Object.entries(segment.goal.minHero || {}).every(([field, value]) => Number(state.hero[field] || 0) >= Number(value)));
  const productionGoal = productionReplay.states.find((state) => segment.goal.floorId === state.floorId &&
    Object.entries(segment.goal.minHero || {}).every(([field, value]) => Number(state.hero[field] || 0) >= Number(value)));
  const targetGoalKeys = [teacherGoal, productionGoal].filter(Boolean).map(buildStateKey);
  const compactSearch = compactRun(run, targetGoalKeys);
  const checkpointKeys = new Set((compactSearch.checkpointCandidates || [])
    .map((candidate) => candidate && candidate.exactStateKey)
    .filter(Boolean));
  const lineages = Object.fromEntries(Object.entries(observed.lineages).map(([id, lineage]) => {
    const checkpointMatches = (lineage.goalExactStateKeys || [])
      .filter((key) => checkpointKeys.has(key));
    return [id, {
      ...lineage,
      checkpointMatches,
      checkpointRetained: checkpointMatches.length > 0,
      classification: classifyLineage(lineage, compactSearch.segment && compactSearch.segment.attempts[0] || { frontierSize: 0 }),
    }];
  }));
  const finishedCommit = gitCommit();
  const report = {
    schema: "motapathfinder.hp3834-mt1-first-divergence-audit.v1",
    generatedAt: new Date().toISOString(),
    status: "completed",
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
    segment: {
      id: segment.id,
      goal: segment.goal,
      dp: {
        keyMode: segment.dp.keyMode,
        maxExpansions,
        maxRuntimeMs,
        maxActionsPerState: number(args["max-actions-per-state"], 256),
        dpSkylineMax: number(args["dp-skyline-max"], 4),
        candidateLimit: number(args["candidate-limit"], 8),
        goalSkylineLimit: number(args["goal-skyline-limit"], 8),
        preserveSkylineRoles: booleanArg(args["preserve-skyline-roles"], true),
        agendaMode: args["agenda-mode"] || "best-first",
        observerOnly: true,
      },
    },
    commonBoundary: {
      teacherState: compactState(teacherCommon),
      productionState: compactState(productionCommon),
      exactStateEqual: buildStateKey(teacherCommon) === buildStateKey(productionCommon),
      dominanceKeyEqual: buildDominanceKey(teacherCommon) === buildDominanceKey(productionCommon),
      commonExactStateKey,
      commonDominanceKey,
    },
    firstDivergence: {
      teacher: {
        decisionIndex: teacherDecision.index,
        actionSummary: teacherDecision.summary,
        expectedPost: compactState(teacherReplay.states[2]),
      },
      production: {
        decisionIndex: productionDecision.index,
        actionSummary: productionDecision.summary,
        expectedPost: compactState(productionReplay.states[2]),
      },
    },
    routeChecks: {
      teacherStrictReplay,
      productionStrictReplay,
      teacherReplayErrors: teacherReplay.errors,
      productionReplayErrors: productionReplay.errors,
      teacherGate: teacherGoal ? compactState(teacherGoal) : null,
      productionGate: productionGoal ? compactState(productionGoal) : null,
    },
    search: {
      ...compactSearch,
      observerEventCounts: observed.eventCounts,
      checkpointMatchesByLineage: Object.fromEntries(Object.entries(lineages)
        .map(([id, lineage]) => [id, lineage.checkpointMatches])),
    },
    lineages,
    conclusion: "MT1 decision-2 teacher and production lineages were tracked from their common exact root through the real mt1-gate-1559 segment search and checkpoint selection.",
  };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(outMarkdown, buildMarkdown(report), "utf8");
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) main();

module.exports = {
  classifyLineage,
  createLineageObserver,
};
