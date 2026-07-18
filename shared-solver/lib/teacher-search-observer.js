"use strict";

/**
 * Collects real searchDP observer events against a known teacher route.
 *
 * This module is test-side diagnostics only. It never supplies teacher
 * actions to searchDP; it only indexes the expected exact pre/post states and
 * classifies events emitted by the production action provider and DP.
 */

const { searchSegmentDP } = require("./segment-dp");
const {
  createStateFromSnapshot,
  resolveRecordedAction,
} = require("./route-store");
const { buildStateKey } = require("./state-key");

const OBSERVER_VERSION = "teacher-search-observer.v1.2";

const OUTCOMES = Object.freeze([
  "teacher-pre-state-not-reached",
  "teacher-pre-state-pending-at-budget",
  "teacher-action-not-generated",
  "teacher-action-provider-error",
  "teacher-action-trimmed",
  "teacher-action-apply-error",
  "teacher-post-dominance-rejected",
  "teacher-post-skyline-rejected",
  "teacher-post-inserted",
  "teacher-post-evicted",
  "teacher-step-survived",
]);

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function exactStateKey(state) {
  if (!state || typeof state !== "object") return null;
  try {
    return buildStateKey(state);
  } catch (error) {
    return null;
  }
}

function actionFingerprint(simulator, action) {
  if (!action) return null;
  if (action.fingerprint) return action.fingerprint;
  if (simulator && typeof simulator.getActionFingerprint === "function") {
    try {
      return simulator.getActionFingerprint(action);
    } catch (error) {
      return null;
    }
  }
  return null;
}

function canonicalRecordedActionFingerprint(simulator, decision, action) {
  if (simulator && typeof simulator.getActionFingerprint === "function") {
    try {
      const fingerprint = simulator.getActionFingerprint(decision || action);
      if (fingerprint) return fingerprint;
    } catch (error) {
      /* fall through to the route record fingerprint */
    }
  }
  return (decision && decision.fingerprint) || actionFingerprint(simulator, action);
}

function addIndex(map, key, value) {
  if (!key) return;
  const list = map.get(key) || [];
  list.push(value);
  map.set(key, list);
}

function applyRecordedAction(simulator, state, action, expectedPostExactStateKey) {
  if (!action) return null;
  let result;
  try {
    result = simulator.applyAction(state, action, { storeRoute: false });
  } catch (error) {
    return null;
  }
  const states = Array.isArray(result) ? result : [result];
  if (expectedPostExactStateKey) {
    const exactMatch = states.find(
      (candidate) => exactStateKey(candidate) === expectedPostExactStateKey,
    );
    if (exactMatch) return exactMatch;
  }
  return states[0] || null;
}

function restoreRecordedSnapshot(simulator, snapshot, decisionDepth) {
  if (!snapshot || !simulator || !simulator.project) return null;
  try {
    const state = createStateFromSnapshot(simulator.project, snapshot, {
      decisionDepth,
      route: [],
    });
    state.meta = {
      ...(state.meta || {}),
      decisionDepth,
    };
    return state;
  } catch (error) {
    return null;
  }
}

/**
 * Build exact teacher-step expectations. Legacy route records without exact
 * keys are upgraded in memory by replaying their recorded actions.
 */
function buildTeacherStepIndex(simulator, routeRecord, options) {
  const config = options || {};
  const decisions = Array.isArray(routeRecord && routeRecord.decisions)
    ? routeRecord.decisions
    : [];
  const selectedFrom = Math.max(0, number(config.fromStep, 0));
  const selectedTo = Math.min(
    decisions.length,
    number(config.toStep, decisions.length),
  );
  let state = config.initialState || simulator.createInitialState(
    config.initialStateOptions || { rank: "chaos" },
  );
  const statesBefore = [];
  const steps = [];
  let replayStateAvailable = false;

  for (let index = 0; index < decisions.length; index += 1) {
    const decision = decisions[index] || {};
    const inReplayWindow = index >= selectedFrom && index < selectedTo;
    const snapshotState = restoreRecordedSnapshot(
      simulator,
      decision.preSnapshot,
      index,
    );
    const continueReplay = inReplayWindow && index > selectedFrom && replayStateAvailable;
    if (snapshotState && !continueReplay) state = snapshotState;
    statesBefore[index] = state;
    const preExactStateKey = inReplayWindow
      ? exactStateKey(state)
      : decision.preExactStateKey || exactStateKey(state);
    let action = null;
    let resolveReason = null;
    const replayForExactPost = !snapshotState || inReplayWindow;
    let after = replayForExactPost
      ? null
      : restoreRecordedSnapshot(simulator, decision.postSnapshot, index + 1);
    if (replayForExactPost || !after) {
      try {
        const resolved = resolveRecordedAction(simulator, state, decision, {
          project: simulator.project,
        });
        action = resolved.action || null;
        resolveReason = resolved.reason || null;
      } catch (error) {
        resolveReason = error && error.message ? error.message : String(error);
      }
      after = applyRecordedAction(simulator, state, action, null);
    } else {
      resolveReason = "route-snapshot";
    }
    const fingerprint = canonicalRecordedActionFingerprint(simulator, decision, action);
    const postExactStateKey = exactStateKey(after) || decision.postExactStateKey || null;
    steps.push({
      step: index,
      summary: decision.summary || (action && action.summary) || null,
      kind: decision.kind || (action && action.kind) || null,
      actionFingerprint: fingerprint,
      preExactStateKey,
      postExactStateKey,
      recordedPostExactStateKey: decision.postExactStateKey || null,
      postExactStateMismatch: Boolean(
        decision.postExactStateKey &&
        postExactStateKey &&
        decision.postExactStateKey !== postExactStateKey,
      ),
      resolved: Boolean(after && (action || decision.fingerprint || decision.postExactStateKey)),
      resolveReason,
    });
    if (after) state = after;
    replayStateAvailable = Boolean(inReplayWindow && after);
  }

  return {
    version: OBSERVER_VERSION,
    decisionCount: decisions.length,
    steps,
    statesBefore,
    finalState: state,
  };
}

function createRecord(step) {
  return {
    step: step.step,
    summary: step.summary,
    actionFingerprint: step.actionFingerprint,
    preExactStateKey: step.preExactStateKey,
    postExactStateKey: step.postExactStateKey,
    preReached: false,
    preExpanded: false,
    actionGenerated: false,
    actionProviderError: false,
    actionTrimmed: false,
    actionApplyError: false,
    postDominanceRejected: false,
    postSkylineRejected: false,
    postInserted: false,
    postEvicted: false,
    postPopped: false,
    goalAccepted: false,
    budgetPending: false,
    candidateIds: [],
    successorIds: [],
    teacherPreNodeIds: [],
    poppedTeacherPreNodeIds: [],
    pendingTeacherPreNodeIds: [],
    teacherPreNodeDetails: [],
    teacherPostNodeIds: [],
    poppedTeacherPostNodeIds: [],
    evictedBeforePopNodeIds: [],
    teacherPostNodeDetails: [],
    competitionSamples: {
      earliest: [],
      latest: [],
      closestRank: [],
    },
    popsWhilePending: 0,
    evidence: [],
    outcome: null,
  };
}

function rememberEvidence(record, event) {
  if (!record || record.evidence.length >= 12) return;
  record.evidence.push({
    eventType: event.eventType,
    reasonCode: event.reasonCode || null,
    nodeId: event.nodeId == null ? null : event.nodeId,
    candidateId: event.candidateId || null,
    successorId: event.successorId || null,
    evictedNodeId: event.evictedNodeId == null ? null : event.evictedNodeId,
  });
}

function addUnique(list, value) {
  if (value != null && !list.includes(value)) list.push(value);
}

function agendaRankFields(rank) {
  if (!rank || typeof rank !== "object") return [];
  if (rank.priorityMode === "resource-first") {
    return [
      "sourceActionRank", "atk", "def", "mdef", "lv", "exp", "hp",
      "bestFloorRank", "currentFloorRank", "finiteNextDistance",
      "nextDistance", "decisionDepth", "routeLength", "sequence",
    ];
  }
  return [
    "bestFloorRank", "finiteNextDistance", "nextDistance",
    ...(rank.priorityMode === "combat-first"
      ? ["currentFloorRank", "sourceActionRank", "atk", "def", "mdef", "lv", "exp", "hp"]
      : ["currentFloorRank", "sourceActionRank", "hp", "atk", "def", "mdef", "lv", "exp"]),
    "decisionDepth", "routeLength", "sequence",
  ];
}

function rankDifferenceReason(teacherRank, competitorRank) {
  if (!teacherRank || !competitorRank) return null;
  for (const field of agendaRankFields(teacherRank)) {
    const teacher = teacherRank[field];
    const competitor = competitorRank[field];
    if (teacher !== competitor) return { field, teacher, competitor };
  }
  return null;
}

function rankDifferenceDistance(reason) {
  if (!reason) return Number.POSITIVE_INFINITY;
  const teacher = Number(reason.teacher);
  const competitor = Number(reason.competitor);
  if (!Number.isFinite(teacher) || !Number.isFinite(competitor)) return Number.POSITIVE_INFINITY;
  return Math.abs(teacher - competitor);
}

function compactCompetitionSample(event, reason) {
  return {
    nodeId: event.nodeId == null ? null : event.nodeId,
    parentId: event.parentId == null ? null : event.parentId,
    floorId: event.floorId || null,
    hero: event.hero || null,
    decisionDepth: event.decisionDepth == null ? null : event.decisionDepth,
    action: event.action || null,
    agendaRank: event.agendaRank || null,
    poppedAtExpansion: event.popExpansion == null ? null : event.popExpansion,
    rankDifferenceReason: reason,
  };
}

function addCompetitionSample(record, event, teacherRank) {
  if (!record || !event || event.nodeId == null) return;
  const reason = rankDifferenceReason(teacherRank, event.agendaRank);
  const sample = compactCompetitionSample(event, reason);
  const distance = rankDifferenceDistance(reason);
  const samples = record.competitionSamples;
  if (samples.earliest.length < 4) samples.earliest.push(sample);
  samples.latest.push(sample);
  if (samples.latest.length > 4) samples.latest.shift();
  samples.closestRank.push({ sample, distance });
  samples.closestRank.sort((left, right) => left.distance - right.distance);
  if (samples.closestRank.length > 4) samples.closestRank.length = 4;
  record.popsWhilePending += 1;
}

function finalizeCompetitionSamples(samples) {
  return {
    earliest: samples.earliest.slice(),
    latest: samples.latest.slice(),
    closestRank: samples.closestRank.map((entry) => entry && entry.sample ? entry.sample : entry),
  };
}

function buildSearchConfig(segment, searchOptions, dp) {
  const overrides = (searchOptions && searchOptions.dpOverrides) || {};
  const segmentDp = (segment && segment.dp) || {};
  const policy = (segment && segment.actionPolicy) || {};
  return {
    agendaMode: dp && dp.agendaMode != null
      ? dp.agendaMode
      : overrides.agendaMode || segmentDp.agendaMode || "best-first",
    priorityMode: dp && dp.priorityMode != null
      ? dp.priorityMode
      : overrides.dpPriorityMode || overrides.priorityMode || segmentDp.dpPriorityMode || segmentDp.priorityMode || "default",
    keyMode: dp && dp.keyMode != null
      ? dp.keyMode
      : overrides.dpKeyMode || overrides.keyMode || segmentDp.dpKeyMode || segmentDp.keyMode || "region",
    dpSkylineMax: dp && dp.dpSkylineMax != null
      ? dp.dpSkylineMax
      : overrides.dpSkylineMax || segmentDp.dpSkylineMax || 1,
    maxExpansions: dp && dp.maxExpansions != null
      ? dp.maxExpansions
      : overrides.maxExpansions || segmentDp.maxExpansions || null,
    maxRuntimeMs: dp && dp.maxRuntimeMs != null
      ? dp.maxRuntimeMs
      : overrides.maxRuntimeMs || segmentDp.maxRuntimeMs || null,
    maxActionsPerState: dp && dp.maxActionsPerState != null
      ? dp.maxActionsPerState
      : overrides.maxActionsPerState || segmentDp.maxActionsPerState || null,
    maxHeapMb: dp && dp.maxHeapMb != null
      ? dp.maxHeapMb
      : overrides.maxHeapMb || segmentDp.maxHeapMb || null,
    actionProviderMode: dp && dp.actionProviderMode != null
      ? dp.actionProviderMode
      : overrides.actionProviderMode || segmentDp.actionProviderMode || policy.actionProviderMode || "primitive",
  };
}

function compactTeacherNodeDetail(meta) {
  if (!meta) return null;
  return {
    nodeId: meta.nodeId,
    parentId: meta.parentId,
    floorId: meta.floorId,
    hero: meta.hero,
    decisionDepth: meta.decisionDepth,
    action: meta.action,
    agendaRank: meta.agendaRank,
    enqueueExpansion: meta.enqueueExpansion,
    expansionsCompletedAtEnqueue: meta.expansionsCompletedAtEnqueue,
    enqueueElapsedMs: meta.enqueueElapsedMs,
    agendaSizeAfterInsert: meta.agendaSizeAfterInsert,
    popExpansion: meta.popExpansion,
    expansionsCompletedBeforePop: meta.expansionsCompletedBeforePop,
    popElapsedMs: meta.popElapsedMs,
    queueAgeExpansions: meta.queueAgeExpansions,
    queueAgeMs: meta.queueAgeMs,
  };
}

function createTeacherSearchObserver(teacherIndex, options) {
  const config = options || {};
  const allSteps = Array.isArray(teacherIndex && teacherIndex.steps)
    ? teacherIndex.steps
    : [];
  const fromStep = Math.max(0, number(config.fromStep, 0));
  const toStep = Math.min(
    allSteps.length,
    number(config.toStep, allSteps.length),
  );
  const steps = allSteps
    .slice(fromStep, toStep)
    .map(createRecord);
  const byPreExact = new Map();
  const byPostExact = new Map();
  steps.forEach((step) => {
    addIndex(byPreExact, step.preExactStateKey, step);
    addIndex(byPostExact, step.postExactStateKey, step);
  });
  const activeByExact = new Map();
  const nodeMetaById = new Map();
  const budgetStops = [];
  let eventCount = 0;

  const actionMatches = (eventAction, step) => Boolean(
    eventAction &&
    eventAction.fingerprint &&
    step.actionFingerprint &&
    eventAction.fingerprint === step.actionFingerprint,
  );

  const preMatches = (event, requireAction) => (byPreExact.get(event.exactStateKey) || [])
    .filter((step) => {
      if (requireAction && !actionMatches(event.action, step)) return false;
      if (event.nodeId == null || step.teacherPreNodeIds.length === 0) return true;
      return step.teacherPreNodeIds.includes(event.nodeId);
    });
  const postMatches = (event, requireAction) => (byPostExact.get(event.exactStateKey) || [])
    .filter((step) => !requireAction || actionMatches(event.action, step));

  const mark = (records, field, event) => {
    records.forEach((record) => {
      record[field] = true;
      record.preReached = true;
      rememberEvidence(record, event);
      addUnique(record.candidateIds, event.candidateId);
      addUnique(record.successorIds, event.successorId);
    });
  };

  const updateActive = (event, add) => {
    if (!event.exactStateKey) return;
    const nodeId = event.nodeId != null
      ? event.nodeId
      : event.evictedNodeId == null
        ? null
        : event.evictedNodeId;
    const current = activeByExact.get(event.exactStateKey) || new Set();
    if (add) {
      current.add(nodeId == null ? event.exactStateKey : nodeId);
      activeByExact.set(event.exactStateKey, current);
      return;
    }
    if (nodeId == null) {
      activeByExact.delete(event.exactStateKey);
      return;
    }
    current.delete(nodeId);
    if (current.size === 0) activeByExact.delete(event.exactStateKey);
    else activeByExact.set(event.exactStateKey, current);
  };

  const rememberNode = (event) => {
    if (!event || event.nodeId == null) return;
    const previous = nodeMetaById.get(event.nodeId) || {};
    nodeMetaById.set(event.nodeId, {
      ...previous,
      nodeId: event.nodeId,
      parentId: event.parentId == null
        ? previous.parentId == null ? null : previous.parentId
        : event.parentId,
      floorId: event.floorId || previous.floorId || null,
      hero: event.hero || previous.hero || null,
      decisionDepth: event.decisionDepth == null
        ? previous.decisionDepth == null ? null : previous.decisionDepth
        : event.decisionDepth,
      action: event.action || previous.action || null,
      agendaRank: event.agendaRank || previous.agendaRank || null,
      enqueueExpansion: event.enqueueExpansion == null ? previous.enqueueExpansion : event.enqueueExpansion,
      expansionsCompletedAtEnqueue: event.expansionsCompletedAtEnqueue == null
        ? previous.expansionsCompletedAtEnqueue
        : event.expansionsCompletedAtEnqueue,
      enqueueElapsedMs: event.enqueueElapsedMs == null ? previous.enqueueElapsedMs : event.enqueueElapsedMs,
      agendaSizeAfterInsert: event.agendaSizeAfterInsert == null
        ? previous.agendaSizeAfterInsert
        : event.agendaSizeAfterInsert,
      popExpansion: event.popExpansion == null ? previous.popExpansion : event.popExpansion,
      expansionsCompletedBeforePop: event.expansionsCompletedBeforePop == null
        ? previous.expansionsCompletedBeforePop
        : event.expansionsCompletedBeforePop,
      popElapsedMs: event.popElapsedMs == null ? previous.popElapsedMs : event.popElapsedMs,
      queueAgeExpansions: event.queueAgeExpansions == null
        ? previous.queueAgeExpansions
        : event.queueAgeExpansions,
      queueAgeMs: event.queueAgeMs == null ? previous.queueAgeMs : event.queueAgeMs,
    });
  };

  const activeTeacherPreNodeIds = (record) => {
    const active = activeByExact.get(record.preExactStateKey);
    if (!active) return [];
    return record.teacherPreNodeIds.filter((nodeId) => active.has(nodeId));
  };

  const attachNodeDetail = (record, field, nodeId) => {
    if (!record || nodeId == null) return;
    const detail = compactTeacherNodeDetail(nodeMetaById.get(nodeId));
    if (!detail) return;
    const list = record[field];
    const existing = list.find((entry) => entry.nodeId === nodeId);
    if (existing) Object.assign(existing, detail);
    else list.push(detail);
  };

  const associateTeacherPreNode = (records, nodeId) => {
    if (nodeId == null) return;
    records.forEach((record) => {
      addUnique(record.teacherPreNodeIds, nodeId);
      attachNodeDetail(record, "teacherPreNodeDetails", nodeId);
    });
  };

  const associateTeacherPostNode = (records, nodeId) => {
    if (nodeId == null) return;
    records.forEach((record) => {
      addUnique(record.teacherPostNodeIds, nodeId);
      attachNodeDetail(record, "teacherPostNodeDetails", nodeId);
    });
  };

  const onEvent = (event) => {
    eventCount += 1;
    if (!event || !event.eventType) return;
    rememberNode(event);
    if (event.nodeId != null) {
      steps.forEach((record) => {
        if (record.teacherPreNodeIds.includes(event.nodeId)) {
          attachNodeDetail(record, "teacherPreNodeDetails", event.nodeId);
        }
        if (record.teacherPostNodeIds.includes(event.nodeId)) {
          attachNodeDetail(record, "teacherPostNodeDetails", event.nodeId);
        }
      });
    }
    if (event.eventType === "candidateGenerated") {
      mark(preMatches(event, true), "actionGenerated", event);
      return;
    }
    if (event.eventType === "candidateRejected") {
      if (event.reasonCode === "action-trimmed") {
        mark(preMatches(event, true), "actionTrimmed", event);
      } else if (event.reasonCode === "action-apply-error") {
        mark(preMatches(event, true), "actionApplyError", event);
      } else if (event.reasonCode === "dominance-rejected") {
        mark(postMatches(event, true), "postDominanceRejected", event);
      } else if (event.reasonCode === "skyline-capacity-rejected") {
        mark(postMatches(event, true), "postSkylineRejected", event);
      }
      return;
    }
    if (event.eventType === "actionProviderError") {
      mark(preMatches(event, false), "actionProviderError", event);
      return;
    }
    if (event.eventType === "skylineInserted") {
      const records = postMatches(event, true);
      mark(records, "postInserted", event);
      records.forEach((record) => {
        associateTeacherPostNode([record], event.nodeId);
        const nextRecords = (byPreExact.get(event.exactStateKey) || [])
          .filter((next) => next.step === record.step + 1);
        associateTeacherPreNode(nextRecords, event.nodeId);
      });
      if (event.parentId == null && !event.action) {
        associateTeacherPreNode(byPreExact.get(event.exactStateKey) || [], event.nodeId);
      }
      updateActive(event, true);
      return;
    }
    if (event.eventType === "skylineEvicted") {
      postMatches(event, false).forEach((record) => {
        const evictedNodeId = event.evictedNodeId;
        if (!record.teacherPostNodeIds.includes(evictedNodeId)) return;
        if (record.poppedTeacherPostNodeIds.includes(evictedNodeId)) return;
        record.postEvicted = true;
        addUnique(record.evictedBeforePopNodeIds, evictedNodeId);
        rememberEvidence(record, event);
        addUnique(record.candidateIds, event.candidateId);
        addUnique(record.successorIds, event.successorId);
      });
      updateActive(event, false);
      return;
    }
    if (event.eventType === "agendaPopped") {
      const preRecords = preMatches(event, false);
      preRecords.forEach((record) => {
        associateTeacherPreNode([record], event.nodeId);
        record.preReached = true;
        record.preExpanded = true;
        addUnique(record.poppedTeacherPreNodeIds, event.nodeId);
        rememberEvidence(record, event);
      });
      steps.forEach((record) => {
        const pendingNodeIds = activeTeacherPreNodeIds(record);
        if (pendingNodeIds.length === 0 || pendingNodeIds.includes(event.nodeId)) return;
        const teacherMeta = nodeMetaById.get(pendingNodeIds[0]);
        addCompetitionSample(record, event, teacherMeta && teacherMeta.agendaRank);
      });
      postMatches(event, false)
        .filter((record) => record.teacherPostNodeIds.includes(event.nodeId))
        .forEach((record) => {
          record.postPopped = true;
          addUnique(record.poppedTeacherPostNodeIds, event.nodeId);
          rememberEvidence(record, event);
        });
      updateActive(event, false);
      return;
    }
    if (event.eventType === "goalAccepted") {
      mark(postMatches(event, true), "goalAccepted", event);
      return;
    }
    if (event.eventType === "budgetStopped") {
      budgetStops.push({
        reasonCode: event.reasonCode || null,
        frontierSize: number(event.frontierSize, 0),
        expansions: number(event.expansions, 0),
      });
      if (number(event.frontierSize, 0) > 0) {
        steps.forEach((record) => {
          const pendingNodeIds = activeTeacherPreNodeIds(record);
          record.pendingTeacherPreNodeIds = pendingNodeIds.slice();
          if (!record.preExpanded && pendingNodeIds.length > 0) {
            record.budgetPending = true;
            rememberEvidence(record, event);
          }
        });
      }
    }
  };

  const finalize = (searchResult) => {
    steps.forEach((record) => {
      record.pendingTeacherPreNodeIds = activeTeacherPreNodeIds(record);
      record.competitionSamples = finalizeCompetitionSamples(record.competitionSamples);
      if (record.postEvicted) record.outcome = "teacher-post-evicted";
      else if (record.postDominanceRejected) record.outcome = "teacher-post-dominance-rejected";
      else if (record.postSkylineRejected) record.outcome = "teacher-post-skyline-rejected";
      else if (record.actionProviderError) record.outcome = "teacher-action-provider-error";
      else if (record.actionApplyError) record.outcome = "teacher-action-apply-error";
      else if (record.actionTrimmed) record.outcome = "teacher-action-trimmed";
      else if (record.actionGenerated && record.postInserted) record.outcome = "teacher-step-survived";
      else if (record.postInserted) record.outcome = "teacher-post-inserted";
      else if (record.preExpanded && !record.actionGenerated) record.outcome = "teacher-action-not-generated";
      else if (record.budgetPending) record.outcome = "teacher-pre-state-pending-at-budget";
      else record.outcome = "teacher-pre-state-not-reached";
    });
    const divergenceOutcomes = new Set([
      "teacher-action-not-generated",
      "teacher-action-provider-error",
      "teacher-action-trimmed",
      "teacher-action-apply-error",
      "teacher-post-dominance-rejected",
      "teacher-post-skyline-rejected",
      "teacher-post-evicted",
    ]);
    const firstObserved = steps.find((record) => divergenceOutcomes.has(record.outcome));
    const firstInconclusive = steps.find(
      (record) => record.outcome === "teacher-pre-state-pending-at-budget",
    );
    const outcomeCounts = Object.fromEntries(OUTCOMES.map((outcome) => [outcome, 0]));
    steps.forEach((record) => {
      if (outcomeCounts[record.outcome] != null) outcomeCounts[record.outcome] += 1;
    });
    const dp = searchResult && searchResult.diagnostics && searchResult.diagnostics.dp;
    return {
      version: OBSERVER_VERSION,
      fromStep,
      toStep,
      decisionCount: allSteps.length,
      eventCount,
      budgetStops,
      stoppedReason: dp && dp.stoppedReason || null,
      expansions: searchResult && searchResult.expansions || 0,
      frontierSize: searchResult && searchResult.frontierSize || 0,
      foundGoal: Boolean(searchResult && (searchResult.bestGoalState || searchResult.goalState)),
      firstObservedSearchDivergenceStep: firstObserved ? firstObserved.step : null,
      firstInconclusiveStep: firstInconclusive ? firstInconclusive.step : null,
      outcomeCounts,
      steps,
    };
  };

  return {
    observer: {
      includeExactStateKey: true,
      onEvent,
    },
    finalize,
  };
}

function runTeacherSearchObservation(simulator, startState, segment, options) {
  const config = options || {};
  const collector = createTeacherSearchObserver(config.teacherIndex, config);
  const result = searchSegmentDP(simulator, startState, segment, {
    ...(config.searchOptions || {}),
    observer: collector.observer,
  });
  const dp = result && result.diagnostics && result.diagnostics.dp;
  return {
    ...collector.finalize(result),
    searchConfig: buildSearchConfig(segment, config.searchOptions, dp),
    stoppedReason: dp && dp.stoppedReason || null,
    expansions: dp && dp.expansions || 0,
    frontierSize: dp && dp.frontierSize || 0,
    foundGoal: Boolean(result && result.found),
    rawResult: result,
  };
}

module.exports = {
  OBSERVER_VERSION,
  OUTCOMES,
  buildTeacherStepIndex,
  createTeacherSearchObserver,
  runTeacherSearchObservation,
};
