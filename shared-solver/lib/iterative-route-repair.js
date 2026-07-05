"use strict";

const { buildRouteRecord, createStateFromSnapshot, normalizeAction } = require("./route-store");
const { buildRouteTimeline } = require("./route-debugger");
const { auditRouteForExpensivePicks } = require("./route-audit");
const { tryRepairRouteRecursive } = require("./route-repair-runner");
const { searchSegmentDP } = require("./segment-dp");

function actionKey(action) {
  const normalized = normalizeAction(action || {});
  return normalized.fingerprint || normalized.summary || normalized.kind || "";
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

function runSuffixBridge(project, simulator, state, expected, options) {
  const config = options || {};
  const normalized = normalizeAction(expected || {});
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
      keyMode: "region",
      stopOnFirstGoal: false,
      goalSkylineLimit: 8,
      dpSkylineMax: 1,
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
    });
  } catch (error) {
    return { ok: false, error: error && error.message ? error.message : String(error), actions: [] };
  }
  const dp = (result && result.diagnostics && result.diagnostics.dp) || {};
  const goalCandidate = result && result.goalSkyline && result.goalSkyline[0];
  const finalState = (result && result.bestGoalState)
    || (result && result.firstGoalState)
    || (goalCandidate && goalCandidate.state)
    || null;
  if (!finalState) {
    return {
      ok: false,
      actions: [],
      expansions: Number(dp.expansions || 0),
      stoppedReason: dp.stoppedReason || null,
      frontierSize: dp.frontierSize,
    };
  }
  const trace = Array.isArray(goalCandidate && goalCandidate.trace)
    ? goalCandidate.trace
    : Array.isArray(finalState.routeTrace)
      ? finalState.routeTrace
      : [];
  const actions = trace.map((entry) => entry && entry.actionEntry).filter(Boolean);
  return {
    ok: true,
    finalState,
    actions,
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

function replayActionEntries(project, simulator, routeRecord, entries, options) {
  const config = options || {};
  const snapshot = routeRecord && routeRecord.start && routeRecord.start.snapshot;
  if (!snapshot) return { ok: false, failure: { reason: "missing-start-snapshot", stepIndex: 0 } };
  const initialState = createStateFromSnapshot(project, snapshot, { rank: (routeRecord.source || {}).rank || "chaos" });
  let state = initialState;
  const resolvedActions = [];
  const consumedIndices = new Set();
  const skippedSatisfiedSteps = [];
  const suffixBridges = [];
  let firstReplayFailure = null;
  const suffixBridgeEnabled = config.suffixBridge !== false && config.suffixBridge !== 0 && config.suffixBridge !== "0";
  const maxSuffixBridges = Math.max(0, Number(config.maxSuffixBridges == null ? 3 : config.maxSuffixBridges));
  for (let index = 0; index < entries.length; index += 1) {
    if (consumedIndices.has(index)) {
      skippedSatisfiedSteps.push({ stepIndex: index + 1, summary: entries[index] && entries[index].summary, reason: "consumed-by-bridge" });
      continue;
    }
    const expected = entries[index];
    let action = resolveReplayAction(simulator, state, expected);
    if (!action) {
      const satisfied = decisionSatisfied(state, expected);
      if (satisfied.satisfied) {
        skippedSatisfiedSteps.push({ stepIndex: index + 1, summary: expected && expected.summary, reason: satisfied.reason });
        continue;
      }
      const currentReplayFailure = {
        reason: "action-unavailable",
        stepIndex: index + 1,
        summary: expected && expected.summary,
      };
      if (!firstReplayFailure) firstReplayFailure = currentReplayFailure;
      if (!suffixBridgeEnabled) {
        return {
          ok: false,
          failure: currentReplayFailure,
          failureState: state,
          resolvedActions,
          remainingEntries: entries.slice(index),
          skippedSatisfiedSteps,
          suffixBridges,
          firstReplayFailure,
        };
      }
      if (suffixBridges.length >= maxSuffixBridges) {
        return {
          ok: false,
          failure: { ...currentReplayFailure, reason: "suffix-bridge-limit" },
          failureState: state,
          resolvedActions,
          remainingEntries: entries.slice(index),
          skippedSatisfiedSteps,
          suffixBridges,
          firstReplayFailure,
        };
      }
      const bridge = runSuffixBridge(project, simulator, state, expected, config);
      const bridgeReport = {
        failureStepIndex: index + 1,
        expectedSummary: expected && expected.summary,
        status: bridge.ok ? "found" : "failed",
        actions: (bridge.actions || []).map((entry) => normalizeAction(entry)),
        consumedFutureSteps: [],
        expansions: bridge.expansions || 0,
        stoppedReason: bridge.stoppedReason || null,
        error: bridge.error || null,
      };
      suffixBridges.push(bridgeReport);
      if (!bridge.ok) {
        return {
          ok: false,
          failure: { ...currentReplayFailure, reason: "suffix-bridge-failed", bridge: bridgeReport },
          failureState: state,
          resolvedActions,
          remainingEntries: entries.slice(index),
          skippedSatisfiedSteps,
          suffixBridges,
          firstReplayFailure,
        };
      }
      state = bridge.finalState;
      resolvedActions.push(...bridge.actions);
      bridgeReport.consumedFutureSteps = consumeFutureMatches(entries, index + 1, bridge.actions, consumedIndices);
      const afterBridgeSatisfied = decisionSatisfied(state, expected);
      if (afterBridgeSatisfied.satisfied) {
        skippedSatisfiedSteps.push({ stepIndex: index + 1, summary: expected && expected.summary, reason: afterBridgeSatisfied.reason });
        continue;
      }
      action = resolveReplayAction(simulator, state, expected);
      if (!action) {
        return {
          ok: false,
          failure: { ...currentReplayFailure, reason: "suffix-bridge-target-unavailable", bridge: bridgeReport },
          failureState: state,
          resolvedActions,
          remainingEntries: entries.slice(index),
          skippedSatisfiedSteps,
          suffixBridges,
          firstReplayFailure,
        };
      }
    }
    try {
      state = simulator.applyAction(state, action);
      resolvedActions.push(action);
    } catch (error) {
      return {
        ok: false,
        failure: {
          reason: "apply-failed",
          stepIndex: index + 1,
          summary: expected && expected.summary,
          error: error && error.message ? error.message : String(error),
        },
      };
    }
  }
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
  consumeFutureMatches,
  decisionSatisfied,
  replayRouteRecord,
  resolveReplayAction,
  runSuffixBridge,
  runIterativeRouteRepair,
};
