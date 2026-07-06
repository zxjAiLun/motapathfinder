"use strict";

const { buildRouteRecord, createStateFromSnapshot, normalizeAction } = require("./route-store");
const { buildRouteTimeline } = require("./route-debugger");
const { auditRouteForExpensivePicks } = require("./route-audit");
const { tryRepairRouteRecursive } = require("./route-repair-runner");
const { searchSegmentDP } = require("./segment-dp");
const { buildStateKey } = require("./state-key");

function actionKey(action) {
  const normalized = normalizeAction(action || {});
  return `${normalized.fingerprint || ""}::${normalized.summary || normalized.kind || ""}`;
}

function listReplayActions(simulator, state) {
  const actions = [];
  const seen = new Set();
  const add = (items) => {
    for (const action of items || []) {
      if (!action) continue;
      const key = actionKey(action);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      actions.push(action);
    }
  };
  try {
    const primitive = simulator.enumeratePrimitiveActions(state);
    add(primitive && primitive.actions);
  } catch (error) {
  }
  if (typeof simulator.enumerateActions === "function") {
    try {
      add(simulator.enumerateActions(state));
    } catch (error) {
    }
  }
  if (typeof simulator.enumerateInteractPickupActions === "function") {
    try {
      add(simulator.enumerateInteractPickupActions(state));
    } catch (error) {
    }
  }
  if (typeof simulator.enumerateFloorFlyActions === "function") {
    try {
      add(simulator.enumerateFloorFlyActions(state));
    } catch (error) {
    }
  }
  return actions;
}

function resolveReplayAction(simulator, state, expected) {
  const normalized = normalizeAction(expected || {});
  const actions = listReplayActions(simulator, state);
  return actions.find((action) => normalized.summary && action.summary === normalized.summary)
    || actions.find((action) => normalized.fingerprint && actionKey(action) === normalized.fingerprint)
    || null;
}

function decisionTarget(expected) {
  const normalized = normalizeAction(expected || {});
  const target = normalized.target || {};
  const floorId = target.floorId || normalized.floorId || null;
  const x = target.x == null ? normalized.x : target.x;
  const y = target.y == null ? normalized.y : target.y;
  return { normalized, floorId, x, y };
}

function decisionSatisfied(state, expected) {
  const { normalized, floorId, x, y } = decisionTarget(expected);
  if (["battle", "openDoor", "pickup", "interactPickup"].includes(normalized.kind)
    && floorId && x != null && y != null) {
    const floorState = state && state.floorStates && state.floorStates[floorId];
    if (floorState && floorState.removed && floorState.removed[`${x},${y}`]) {
      return { satisfied: true, reason: "target-already-removed" };
    }
  }
  if (normalized.kind === "equip" && normalized.equipId) {
    const equipment = (state && state.hero && state.hero.equipment) || [];
    if (equipment.includes(normalized.equipId)) {
      return { satisfied: true, reason: "already-equipped" };
    }
  }
  return { satisfied: false, reason: null };
}

function bridgeAllowedFloors(project, state, expected) {
  const order = project.floorOrder || [];
  const target = decisionTarget(expected);
  const floors = new Set([state && state.floorId, target.floorId].filter(Boolean));
  for (const floorId of Array.from(floors)) {
    const index = order.indexOf(floorId);
    if (index < 0) continue;
    if (order[index - 1]) floors.add(order[index - 1]);
    if (order[index + 1]) floors.add(order[index + 1]);
  }
  return Array.from(floors);
}

function collectBridgeCandidates(rawCandidates, limit) {
  const maxCandidates = Math.max(1, Number(limit || 4));
  const seen = new Set();
  const candidates = [];
  for (const candidate of rawCandidates || []) {
    if (!candidate || !candidate.state) continue;
    const trace = Array.isArray(candidate.trace) ? candidate.trace : [];
    const actions = trace.map((entry) => entry && entry.actionEntry).filter(Boolean);
    const traceSignature = actions.map((action) => actionKey(action)).join("|");
    const key = `${buildStateKey(candidate.state)}|${traceSignature}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      id: candidate.id || `suffix-bridge#${candidates.length}`,
      state: candidate.state,
      actions,
      hero: candidate.hero || null,
      tags: Array.isArray(candidate.tags) ? candidate.tags.slice() : [],
      targetMargin: candidate.targetMargin || null,
      traceSignature,
    });
    if (candidates.length >= maxCandidates) break;
  }
  return candidates;
}

function runSuffixBridge(project, simulator, state, expected, options) {
  const config = options || {};
  const normalized = normalizeAction(expected || {});
  const goalSkylineLimit = Math.max(1, Number(config.suffixGoalSkylineLimit || 4));
  const segment = {
    id: `route-repair-suffix:${normalized.summary || normalized.kind}`,
    label: `Reconnect suffix at ${normalized.summary || normalized.kind}`,
    startFrom: "previous",
    goal: {
      type: "suffixBridge",
      floorId: normalized.floorId || state.floorId,
      actionSurvivable: { summary: normalized.summary },
    },
    actionPolicy: {
      actionKinds: ["battle", "pickup", "interactPickup", "equip", "openDoor", "useTool", "changeFloor", "floorFly", "event"],
      allowedFloors: bridgeAllowedFloors(project, state, normalized),
      allowChangeFloors: [],
      forbidUnsupportedEvents: true,
    },
    dp: {
      keyMode: "primitive",
      stopOnFirstGoal: false,
      goalSkylineLimit,
      dpSkylineMax: goalSkylineLimit,
      preserveSkylineRoles: true,
      preserveGoalArchive: true,
      preserveSkylineAlternatives: true,
      maxExpansions: Number(config.suffixMaxExpansions || 2000),
      maxRuntimeMs: Number(config.suffixMaxRuntimeMs || 3000),
    },
  };
  let result;
  try {
    result = searchSegmentDP(simulator, state, segment, {
      captureTrace: true,
      prefixTrace: [],
      maxExpansions: segment.dp.maxExpansions,
      maxRuntimeMs: segment.dp.maxRuntimeMs,
      candidateLimit: goalSkylineLimit,
      preserveSkylineRoles: true,
    });
  } catch (error) {
    return { ok: false, error: error && error.message ? error.message : String(error), actions: [] };
  }
  const dp = (result && result.diagnostics && result.diagnostics.dp) || {};
  const rawCandidates = Array.isArray(result && result.goalSkyline) ? result.goalSkyline : [];
  if (rawCandidates.length === 0) {
    return {
      ok: false,
      actions: [],
      expansions: Number(dp.expansions || 0),
      stoppedReason: dp.stoppedReason || null,
      frontierSize: dp.frontierSize,
    };
  }
  const candidates = collectBridgeCandidates(rawCandidates, goalSkylineLimit);
  if (candidates.length === 0) {
    return {
      ok: false,
      actions: [],
      candidates: [],
      expansions: Number(dp.expansions || 0),
      stoppedReason: dp.stoppedReason || null,
      frontierSize: dp.frontierSize,
    };
  }
  return {
    ok: true,
    finalState: candidates[0].state,
    actions: candidates[0].actions,
    candidates,
    expansions: Number(dp.expansions || 0),
    stoppedReason: dp.stoppedReason || null,
  };
}

function consumeFutureMatches(entries, startIndex, actions, consumedIndices) {
  const consumed = [];
  for (const bridgeAction of actions || []) {
    const normalized = normalizeAction(bridgeAction);
    for (let cursor = startIndex; cursor < entries.length; cursor += 1) {
      if (consumedIndices.has(cursor)) continue;
      const expected = normalizeAction(entries[cursor] || {});
      if ((normalized.summary && expected.summary === normalized.summary)
        || (normalized.fingerprint && expected.fingerprint === normalized.fingerprint)) {
        consumedIndices.add(cursor);
        consumed.push(cursor + 1);
        break;
      }
    }
  }
  return consumed;
}

function cloneReplayContext(context) {
  return {
    state: context.state,
    resolvedActions: context.resolvedActions.slice(),
    consumedIndices: new Set(context.consumedIndices),
    skippedSatisfiedSteps: context.skippedSatisfiedSteps.slice(),
    suffixBridges: context.suffixBridges.slice(),
    firstReplayFailure: context.firstReplayFailure,
  };
}

function replayFailureResult(context, entries, index, failure) {
  return {
    ok: false,
    failure,
    failureState: context.state,
    resolvedActions: context.resolvedActions,
    remainingEntries: entries.slice(index),
    skippedSatisfiedSteps: context.skippedSatisfiedSteps,
    suffixBridges: context.suffixBridges,
    firstReplayFailure: context.firstReplayFailure,
    context,
    nextIndex: index,
  };
}

function advanceStrict(simulator, entries, sourceContext, startIndex, maxSteps) {
  const context = cloneReplayContext(sourceContext);
  const limit = Math.min(entries.length, startIndex + Math.max(0, maxSteps));
  let index = startIndex;
  for (; index < limit; index += 1) {
    if (context.consumedIndices.has(index)) {
      context.skippedSatisfiedSteps.push({
        stepIndex: index + 1,
        summary: entries[index] && entries[index].summary,
        reason: "consumed-by-bridge",
      });
      continue;
    }
    const expected = entries[index];
    let action = resolveReplayAction(simulator, context.state, expected);
    if (!action) {
      const satisfied = decisionSatisfied(context.state, expected);
      if (satisfied.satisfied) {
        context.skippedSatisfiedSteps.push({
          stepIndex: index + 1,
          summary: expected && expected.summary,
          reason: satisfied.reason,
        });
        continue;
      }
      const failure = {
        reason: "action-unavailable",
        stepIndex: index + 1,
        summary: expected && expected.summary,
      };
      if (!context.firstReplayFailure) context.firstReplayFailure = failure;
      return replayFailureResult(context, entries, index, failure);
    }
    try {
      context.state = simulator.applyAction(context.state, action);
      context.resolvedActions.push(action);
    } catch (error) {
      const failure = {
        reason: "apply-failed",
        stepIndex: index + 1,
        summary: expected && expected.summary,
        error: error && error.message ? error.message : String(error),
      };
      return replayFailureResult(context, entries, index, failure);
    }
  }
  return {
    ok: index >= entries.length,
    context,
    nextIndex: index,
    progressed: index - startIndex,
  };
}

function bridgeCandidateScore(candidate) {
  const hero = (candidate.previewContext && candidate.previewContext.state && candidate.previewContext.state.hero) || {};
  return {
    progress: Number(candidate.shortProgress || 0),
    hp: Number(hero.hp || 0),
    combat: Number(hero.atk || 0) + Number(hero.def || 0) + Number(hero.mdef || 0),
    actionCount: (candidate.actions || []).length,
  };
}

function compareBridgeCandidates(left, right) {
  const a = bridgeCandidateScore(left);
  const b = bridgeCandidateScore(right);
  return b.progress - a.progress
    || b.hp - a.hp
    || b.combat - a.combat
    || a.actionCount - b.actionCount
    || String(left.id).localeCompare(String(right.id));
}

function selectBridgeFinalists(candidates, limit) {
  return (candidates || [])
    .filter((candidate) => candidate.viable)
    .slice()
    .sort(compareBridgeCandidates)
    .slice(0, Math.max(1, Number(limit || 2)));
}

function prepareBridgeCandidate(simulator, entries, sourceContext, failureIndex, candidate, lookaheadSteps) {
  const context = cloneReplayContext(sourceContext);
  context.state = candidate.state;
  context.resolvedActions.push(...candidate.actions);
  const consumedFutureSteps = consumeFutureMatches(
    entries,
    failureIndex + 1,
    candidate.actions,
    context.consumedIndices,
  );
  const expected = entries[failureIndex];
  const satisfied = decisionSatisfied(context.state, expected);
  if (satisfied.satisfied) {
    context.skippedSatisfiedSteps.push({
      stepIndex: failureIndex + 1,
      summary: expected && expected.summary,
      reason: satisfied.reason,
    });
  } else {
    const action = resolveReplayAction(simulator, context.state, expected);
    if (!action) {
      return {
        id: candidate.id,
        source: candidate,
        actions: candidate.actions,
        consumedFutureSteps,
        viable: false,
        status: "target-unavailable",
        shortProgress: 0,
      };
    }
    try {
      context.state = simulator.applyAction(context.state, action);
      context.resolvedActions.push(action);
    } catch (error) {
      return {
        id: candidate.id,
        source: candidate,
        actions: candidate.actions,
        consumedFutureSteps,
        viable: false,
        status: "target-apply-failed",
        error: error && error.message ? error.message : String(error),
        shortProgress: 0,
      };
    }
  }
  const preview = advanceStrict(simulator, entries, context, failureIndex + 1, lookaheadSteps);
  const previewContext = preview.context;
  return {
    id: candidate.id,
    source: candidate,
    actions: candidate.actions,
    consumedFutureSteps,
    viable: true,
    status: preview.ok ? "short-complete" : preview.failure ? "short-blocked" : "shortlisted",
    shortProgress: preview.nextIndex - (failureIndex + 1),
    shortFailure: preview.failure || null,
    previewContext,
    nextIndex: preview.nextIndex,
  };
}

function summarizeBridgeCandidate(candidate) {
  const score = bridgeCandidateScore(candidate);
  return {
    id: candidate.id,
    tags: candidate.source && candidate.source.tags,
    targetMargin: candidate.source && candidate.source.targetMargin,
    actions: (candidate.actions || []).map((action) => normalizeAction(action)),
    consumedFutureSteps: candidate.consumedFutureSteps || [],
    status: candidate.status,
    viable: candidate.viable,
    shortProgress: score.progress,
    shortHp: score.hp,
    shortCombat: score.combat,
    shortFailure: candidate.shortFailure || null,
    shortlisted: false,
    selected: false,
    fullReplayStatus: null,
    finalHp: null,
    eliminatedReason: null,
  };
}

function chooseBestFailure(results) {
  return results.slice().sort((left, right) => {
    const leftStep = Number((left.failure || {}).stepIndex || left.nextIndex || 0);
    const rightStep = Number((right.failure || {}).stepIndex || right.nextIndex || 0);
    const leftHp = Number((left.context && left.context.state && left.context.state.hero || {}).hp || 0);
    const rightHp = Number((right.context && right.context.state && right.context.state.hero || {}).hp || 0);
    return rightStep - leftStep || rightHp - leftHp;
  })[0] || null;
}

function continueReplay(project, simulator, entries, sourceContext, startIndex, options, searchBudget) {
  const config = options || {};
  const strict = advanceStrict(simulator, entries, sourceContext, startIndex, entries.length);
  if (strict.ok) return strict;
  if (!strict.failure || strict.failure.reason !== "action-unavailable") return strict;
  const suffixBridgeEnabled = config.suffixBridge !== false && config.suffixBridge !== 0 && config.suffixBridge !== "0";
  const maxSuffixBridges = Math.max(0, Number(config.maxSuffixBridges == null ? 3 : config.maxSuffixBridges));
  if (!suffixBridgeEnabled) return strict;
  if (strict.context.suffixBridges.length >= maxSuffixBridges) {
    strict.failure = { ...strict.failure, reason: "suffix-bridge-limit" };
    return strict;
  }
  const bridge = runSuffixBridge(project, simulator, strict.context.state, entries[strict.nextIndex], config);
  const baseReport = {
    failureStepIndex: strict.nextIndex + 1,
    expectedSummary: entries[strict.nextIndex] && entries[strict.nextIndex].summary,
    status: bridge.ok ? "found" : "failed",
    actions: (bridge.actions || []).map((entry) => normalizeAction(entry)),
    consumedFutureSteps: [],
    expansions: bridge.expansions || 0,
    stoppedReason: bridge.stoppedReason || null,
    error: bridge.error || null,
    selectedCandidateId: null,
    candidates: [],
  };
  if (!bridge.ok) {
    const context = cloneReplayContext(strict.context);
    context.suffixBridges.push(baseReport);
    return replayFailureResult(context, entries, strict.nextIndex, {
      ...strict.failure,
      reason: "suffix-bridge-failed",
      bridge: baseReport,
    });
  }
  const lookaheadSteps = Math.max(1, Number(config.suffixLookaheadSteps || 8));
  const maxSearchNodes = Math.max(1, Number(config.suffixMaxSearchNodes || 16));
  const prepared = [];
  for (const candidate of bridge.candidates || []) {
    if (searchBudget.used >= maxSearchNodes) break;
    searchBudget.used += 1;
    prepared.push(prepareBridgeCandidate(
      simulator,
      entries,
      strict.context,
      strict.nextIndex,
      candidate,
      lookaheadSteps,
    ));
  }
  baseReport.searchNodesUsed = searchBudget.used;
  baseReport.searchNodeLimit = maxSearchNodes;
  const finalistsLimit = Math.max(1, Number(config.suffixFinalists || 2));
  const finalists = selectBridgeFinalists(prepared, finalistsLimit);
  const candidateSummaries = prepared.map(summarizeBridgeCandidate);
  for (const finalist of finalists) {
    const summary = candidateSummaries.find((entry) => entry.id === finalist.id);
    if (summary) summary.shortlisted = true;
  }
  for (const summary of candidateSummaries) {
    if (!summary.shortlisted) {
      summary.eliminatedReason = summary.viable ? "not-shortlisted" : summary.status;
    }
  }
  if (finalists.length === 0) {
    const context = cloneReplayContext(strict.context);
    context.suffixBridges.push({ ...baseReport, candidates: candidateSummaries });
    return replayFailureResult(context, entries, strict.nextIndex, {
      ...strict.failure,
      reason: "suffix-bridge-target-unavailable",
    });
  }
  const branchResults = [];
  for (const finalist of finalists) {
    const summaries = candidateSummaries.map((entry) => ({ ...entry }));
    const selectedSummary = summaries.find((entry) => entry.id === finalist.id);
    if (selectedSummary) selectedSummary.selected = true;
    const context = cloneReplayContext(finalist.previewContext);
    context.suffixBridges.push({
      ...baseReport,
      actions: (finalist.actions || []).map((entry) => normalizeAction(entry)),
      consumedFutureSteps: finalist.consumedFutureSteps || [],
      selectedCandidateId: finalist.id,
      candidates: summaries,
    });
    const result = continueReplay(
      project,
      simulator,
      entries,
      context,
      finalist.nextIndex,
      config,
      searchBudget,
    );
    branchResults.push({ id: finalist.id, result });
  }
  const completed = branchResults.filter((entry) => entry.result.ok).sort((left, right) =>
    Number((right.result.context.state.hero || {}).hp || 0) - Number((left.result.context.state.hero || {}).hp || 0));
  const chosenEntry = completed[0] || (() => {
    const failure = chooseBestFailure(branchResults.map((entry) => entry.result));
    return branchResults.find((entry) => entry.result === failure) || null;
  })();
  if (!chosenEntry) return strict;
  const chosen = chosenEntry.result;
  const chosenEvent = chosen.context && chosen.context.suffixBridges.slice().reverse().find((entry) =>
    entry.failureStepIndex === baseReport.failureStepIndex && entry.selectedCandidateId === chosenEntry.id);
  if (chosenEvent) {
    chosenEvent.selectedCandidateId = chosenEntry.id;
    for (const summary of chosenEvent.candidates) {
      const branch = branchResults.find((entry) => entry.id === summary.id);
      summary.selected = summary.id === chosenEntry.id;
      if (!branch) continue;
      summary.fullReplayStatus = branch.result.ok ? "completed" : "replay-failed";
      summary.finalHp = branch.result.ok
        ? Number((branch.result.context.state.hero || {}).hp || 0)
        : null;
      summary.eliminatedReason = summary.selected
        ? branch.result.ok ? null : "selected-farthest-failure"
        : branch.result.ok ? "lower-final-hp" : "replay-failed";
    }
  }
  return chosen;
}

function replayActionEntries(project, simulator, routeRecord, entries, options) {
  const config = options || {};
  const snapshot = routeRecord && routeRecord.start && routeRecord.start.snapshot;
  if (!snapshot) return { ok: false, failure: { reason: "missing-start-snapshot", stepIndex: 0 } };
  const initialState = createStateFromSnapshot(project, snapshot, { rank: (routeRecord.source || {}).rank || "chaos" });
  const continuation = continueReplay(project, simulator, entries, {
    state: initialState,
    resolvedActions: [],
    consumedIndices: new Set(),
    skippedSatisfiedSteps: [],
    suffixBridges: [],
    firstReplayFailure: null,
  }, 0, config, { used: 0 });
  if (!continuation.ok) return continuation;
  const state = continuation.context.state;
  const resolvedActions = continuation.context.resolvedActions;
  const skippedSatisfiedSteps = continuation.context.skippedSatisfiedSteps;
  const suffixBridges = continuation.context.suffixBridges;
  const firstReplayFailure = continuation.context.firstReplayFailure;
  if (config.rebuildRoute === false) {
    return { ok: true, route: routeRecord, finalState: state, actions: resolvedActions, skippedSatisfiedSteps, suffixBridges, firstReplayFailure };
  }
  let rebuilt;
  try {
    rebuilt = buildRouteRecord({
      project,
      simulator,
      initialState,
      finalState: state,
      actionEntries: resolvedActions,
      options: {
        rank: (routeRecord.source || {}).rank || "chaos",
        solver: config.solver || "iterative-route-repair",
        profile: (routeRecord.source || {}).profile || null,
        goalType: (routeRecord.goal || {}).type || "floor",
        toFloor: (routeRecord.goal || {}).floorId || state.floorId,
        metadata: routeRecord.metadata || null,
        projectRoot: config.projectRoot,
        allowRouteMismatch: true,
      },
    });
  } catch (error) {
    return {
      ok: false,
      failure: { reason: "route-rebuild-failed", error: error.message },
      firstReplayFailure,
      skippedSatisfiedSteps,
      suffixBridges,
    };
  }
  const verification = replayActionEntries(project, simulator, rebuilt, rebuilt.decisions || [], {
    ...config,
    rebuildRoute: false,
    suffixBridge: false,
  });
  if (!verification.ok) {
    return {
      ok: false,
      failure: { reason: "rebuilt-route-replay-failed", detail: verification.failure },
      firstReplayFailure,
      skippedSatisfiedSteps,
      suffixBridges,
    };
  }
  return { ok: true, route: rebuilt, finalState: verification.finalState, actions: resolvedActions, skippedSatisfiedSteps, suffixBridges, firstReplayFailure };
}

function replayRouteRecord(project, simulator, routeRecord, options) {
  return replayActionEntries(project, simulator, routeRecord, routeRecord.decisions || [], {
    ...(options || {}),
    rebuildRoute: false,
    suffixBridge: false,
  });
}

function applyPatchAndReplay(project, simulator, routeRecord, patch, options) {
  const decisions = routeRecord.decisions || [];
  const index = Number(patch.sourceStepIndex) - 1;
  if (index < 0 || index >= decisions.length) {
    return { ok: false, failure: { reason: "patch-step-out-of-range", stepIndex: patch.sourceStepIndex } };
  }
  const patchActions = patch.actions || [];
  const consumed = new Set();
  const displacedStepIndices = [];
  let anchorIndex = -1;
  for (const patchAction of patchActions) {
    const normalized = normalizeAction(patchAction);
    for (let cursor = index + 1; cursor < decisions.length; cursor += 1) {
      if (consumed.has(cursor)) continue;
      const decision = decisions[cursor];
      if ((normalized.summary && decision.summary === normalized.summary)
        || (normalized.fingerprint && decision.fingerprint === normalized.fingerprint)) {
        consumed.add(cursor);
        displacedStepIndices.push(cursor + 1);
        anchorIndex = Math.max(anchorIndex, cursor);
        break;
      }
    }
  }
  const entries = [];
  for (let cursor = 0; cursor < decisions.length; cursor += 1) {
    if (cursor === index) {
      entries.push(...patchActions);
      continue;
    }
    if (consumed.has(cursor)) {
      if (cursor === anchorIndex) entries.push(decisions[index]);
      continue;
    }
    entries.push(decisions[cursor]);
  }
  const replay = replayActionEntries(project, simulator, routeRecord, entries, options);
  if (replay.ok) {
    replay.outputStartStep = index + 1;
    replay.outputActionCount = patchActions.length;
    replay.displacedStepIndices = displacedStepIndices;
  }
  return replay;
}

function routeSignature(routeRecord) {
  return (routeRecord.decisions || []).map((decision) => decision.summary || decision.fingerprint || "").join("\n");
}

function floorIndex(project, floorId) {
  const order = project.floorOrder || [];
  const index = order.indexOf(floorId);
  return index < 0 ? Number.NEGATIVE_INFINITY : index;
}

function summarizePatch(patch) {
  if (!patch) return null;
  return {
    sourceStepIndex: patch.sourceStepIndex,
    originalSummary: patch.originalSummary,
    cheaperSummary: patch.cheaperSummary,
    actions: (patch.actions || []).map((action) => normalizeAction(action)),
  };
}

function runIterativeRouteRepair(project, simulator, routeRecord, options) {
  const config = options || {};
  const maxRepairs = Math.max(1, Number(config.maxRepairs || 20));
  let currentRoute = routeRecord;
  let baselineReplay = replayRouteRecord(project, simulator, currentRoute, config);
  if (!baselineReplay.ok) {
    return {
      route: currentRoute,
      iterations: [],
      acceptedCount: 0,
      finalRouteVerified: false,
      replayFailure: baselineReplay.failure,
      stoppedReason: "baseline-replay-failed",
    };
  }
  const initialFinalHp = Number((baselineReplay.finalState.hero || {}).hp || 0);
  const signatures = new Set([routeSignature(currentRoute)]);
  const iterations = [];
  let stoppedReason = "max-repairs";

  for (let iterationIndex = 0; iterationIndex < maxRepairs; iterationIndex += 1) {
    const timeline = buildRouteTimeline(project, simulator, currentRoute, {
      actionInspector: "visible",
      actionInspectorMode: "pre",
      candidateLimit: config.candidateLimit || 200,
      stopOnError: true,
    });
    const audit = auditRouteForExpensivePicks(simulator, project, timeline, {
      minDamageDelta: config.minDamageDelta || 1000,
      minSavingsRatio: config.minSavingsRatio == null ? 0.15 : config.minSavingsRatio,
      maxIntents: config.maxIntents || 4,
    });
    const findings = (audit.findings || []).slice().sort((left, right) =>
      Number(right.bestSaving || 0) - Number(left.bestSaving || 0)
      || Number(left.stepIndex || 0) - Number(right.stepIndex || 0));
    if (findings.length === 0) {
      stoppedReason = "no-findings";
      break;
    }
    const iteration = {
      iterationIndex,
      baselineFinalHp: Number((baselineReplay.finalState.hero || {}).hp || 0),
      candidateAttempts: [],
      acceptedPatch: null,
    };
    let accepted = null;
    for (const finding of findings) {
      const attempt = tryRepairRouteRecursive(simulator, project, currentRoute, timeline, {
        stepIndex: finding.stepIndex,
        cheaper: finding.cheaper,
      }, config);
      const report = {
        sourceStepIndex: finding.stepIndex,
        originalSummary: finding.stepSummary,
        bestSaving: finding.bestSaving,
        repairStatus: attempt.status,
        patch: summarizePatch(attempt.patch),
        replayFailure: null,
        firstReplayFailure: null,
        suffixBridges: [],
        skippedSatisfiedSteps: [],
        candidateFinalHp: null,
        accepted: false,
        rejectedReason: null,
      };
      if (!attempt.patch) {
        report.rejectedReason = attempt.status;
        iteration.candidateAttempts.push(report);
        continue;
      }
      const replay = applyPatchAndReplay(project, simulator, currentRoute, attempt.patch, config);
      report.firstReplayFailure = replay.firstReplayFailure || (replay.ok ? null : replay.failure);
      report.suffixBridges = replay.suffixBridges || [];
      report.skippedSatisfiedSteps = replay.skippedSatisfiedSteps || [];
      if (!replay.ok) {
        report.replayFailure = replay.failure;
        report.rejectedReason = replay.failure && String(replay.failure.reason || "").startsWith("suffix-bridge")
          ? replay.failure.reason
          : "full-replay-failed";
        iteration.candidateAttempts.push(report);
        continue;
      }
      const baselineState = baselineReplay.finalState;
      const candidateState = replay.finalState;
      const baselineHp = Number((baselineState.hero || {}).hp || 0);
      const candidateHp = Number((candidateState.hero || {}).hp || 0);
      report.candidateFinalHp = candidateHp;
      if (floorIndex(project, candidateState.floorId) < floorIndex(project, baselineState.floorId)) {
        report.rejectedReason = "final-floor-regressed";
      } else if (candidateHp <= baselineHp) {
        report.rejectedReason = "final-hp-not-improved";
        for (const bridge of report.suffixBridges) {
          for (const candidate of bridge.candidates || []) {
            if (candidate.fullReplayStatus === "completed" && Number(candidate.finalHp || 0) <= baselineHp) {
              candidate.fullReplayStatus = "hp-not-improved";
              candidate.eliminatedReason = "hp-not-improved";
            }
          }
        }
      } else {
        const signature = routeSignature(replay.route);
        if (signatures.has(signature)) {
          report.rejectedReason = "route-cycle";
        } else {
          report.accepted = true;
          report.outputStartStep = replay.outputStartStep;
          report.outputActionCount = replay.outputActionCount;
          report.displacedStepIndices = replay.displacedStepIndices;
          accepted = { report, replay, signature };
        }
      }
      iteration.candidateAttempts.push(report);
      if (accepted) break;
    }
    if (!accepted) {
      iterations.push(iteration);
      stoppedReason = "no-acceptable-candidate";
      break;
    }
    iteration.acceptedPatch = accepted.report;
    iteration.candidateFinalHp = accepted.report.candidateFinalHp;
    iterations.push(iteration);
    currentRoute = accepted.replay.route;
    baselineReplay = accepted.replay;
    signatures.add(accepted.signature);
  }

  const acceptedCount = iterations.filter((iteration) => iteration.acceptedPatch).length;
  const finalFinalHp = Number((baselineReplay.finalState.hero || {}).hp || 0);
  return {
    route: currentRoute,
    iterations,
    acceptedCount,
    initialFinalHp,
    finalFinalHp,
    finalRouteVerified: baselineReplay.ok,
    replayFailure: baselineReplay.ok ? null : baselineReplay.failure,
    stoppedReason,
  };
}

module.exports = {
  applyPatchAndReplay,
  collectBridgeCandidates,
  consumeFutureMatches,
  compareBridgeCandidates,
  decisionSatisfied,
  replayRouteRecord,
  resolveReplayAction,
  runSuffixBridge,
  selectBridgeFinalists,
  runIterativeRouteRepair,
};
